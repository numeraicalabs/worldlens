"""
WorldLens Financial Report Generator
--------------------------------------
Generates structured financial reports by querying the Knowledge Graph
and Brain, then using Gemini to produce formatted output.

Report types:
  - portfolio_stress   : ETF portfolio exposure to current KG risk nodes
  - macro_outlook      : Macro regime analysis from KG indicators
  - sector_digest      : Sector/theme deep dive from KG + events
  - geo_risk           : Geopolitical risk map from KG entity nodes
  - weekly_brief       : Full weekly intelligence brief

Endpoint: POST /api/reports/generate
"""
from __future__ import annotations
import json
import logging
from datetime import date, datetime
from typing import Optional, List, Dict

import aiosqlite
from fastapi import APIRouter, Depends, Body, HTTPException, BackgroundTasks
from auth import require_user
from config import settings
from ai_layer import _call_claude, _get_user_ai_keys
from supabase_client import get_pool

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/reports", tags=["reports"])

# ── Report templates ──────────────────────────────────────────────────────────

REPORT_TYPES = {
    "portfolio_stress": {
        "label":   "📊 Portfolio Stress Test",
        "icon":    "📊",
        "desc":    "Analisi esposizione portafoglio ETF ai rischi attuali del KG",
        "tokens":  800,
    },
    "macro_outlook": {
        "label":   "🌐 Macro Outlook",
        "icon":    "🌐",
        "desc":    "Analisi regime macroeconomico basata su indicatori KG",
        "tokens":  700,
    },
    "sector_digest": {
        "label":   "🏭 Sector Digest",
        "icon":    "🏭",
        "desc":    "Deep dive settore/tema con dati KG + eventi recenti",
        "tokens":  700,
    },
    "geo_risk": {
        "label":   "🌍 Geo Risk Report",
        "icon":    "🌍",
        "desc":    "Mappa rischio geopolitico da nodi entità nel KG",
        "tokens":  700,
    },
    "weekly_brief": {
        "label":   "📋 Weekly Intelligence Brief",
        "icon":    "📋",
        "desc":    "Brief settimanale completo: macro + geo + mercati + segnali",
        "tokens":  1200,
    },
}

# ── KG query helpers ──────────────────────────────────────────────────────────

async def get_kg_context(
    node_types: List[str],
    limit: int = 20,
    related_to: Optional[str] = None,
) -> List[Dict]:
    """Query KG for nodes of given types, optionally near a label."""
    pool = await get_pool()
    try:
        if pool:
            async with pool.acquire() as conn:
                if related_to:
                    rows = await conn.fetch(
                        """SELECT n.id, n.label, n.type, n.description, n.source_count,
                                  e.relation, n2.label as related_label
                           FROM kg_nodes n
                           JOIN kg_edges e ON (e.src_id=n.id OR e.tgt_id=n.id)
                           JOIN kg_nodes n2 ON (CASE WHEN e.src_id=n.id THEN e.tgt_id ELSE e.src_id END = n2.id)
                           WHERE n2.label ILIKE $1 AND n.type = ANY($2::text[])
                           ORDER BY n.source_count DESC, e.weight DESC
                           LIMIT $3""",
                        f"%{related_to}%", node_types, limit
                    )
                else:
                    rows = await conn.fetch(
                        """SELECT id, label, type, description, source_count
                           FROM kg_nodes
                           WHERE type = ANY($1::text[])
                           ORDER BY source_count DESC
                           LIMIT $2""",
                        node_types, limit
                    )
                return [dict(r) for r in rows]
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                ph = ",".join("?" * len(node_types))
                async with db.execute(
                    f"SELECT id, label, type, description, source_count FROM kg_nodes "
                    f"WHERE type IN ({ph}) ORDER BY source_count DESC LIMIT ?",
                    node_types + [limit]
                ) as c:
                    return [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.warning("get_kg_context: %s", e)
        return []


async def get_kg_edges_for_node(label: str, limit: int = 10) -> List[Dict]:
    """Get edges connected to a node by label."""
    pool = await get_pool()
    try:
        if pool:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT e.relation, e.weight, e.evidence_text,
                              n1.label as src_label, n2.label as tgt_label
                       FROM kg_edges e
                       JOIN kg_nodes n1 ON e.src_id = n1.id
                       JOIN kg_nodes n2 ON e.tgt_id = n2.id
                       WHERE n1.label ILIKE $1 OR n2.label ILIKE $1
                       ORDER BY e.weight DESC
                       LIMIT $2""",
                    f"%{label}%", limit
                )
                return [dict(r) for r in rows]
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    """SELECT e.relation, e.weight, e.evidence_text,
                              n1.label as src_label, n2.label as tgt_label
                       FROM kg_edges e
                       JOIN kg_nodes n1 ON e.src_id=n1.id
                       JOIN kg_nodes n2 ON e.tgt_id=n2.id
                       WHERE n1.label LIKE ? OR n2.label LIKE ?
                       ORDER BY e.weight DESC LIMIT ?""",
                    (f"%{label}%", f"%{label}%", limit)
                ) as c:
                    return [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.warning("get_kg_edges_for_node: %s", e)
        return []


async def get_recent_events(limit: int = 15, severity_min: float = 6.0) -> List[Dict]:
    """Get recent high-severity events from SQLite events table."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT title, summary, ai_summary, category, country_name,
                          severity, timestamp
                   FROM events
                   WHERE severity >= ? AND datetime(timestamp) > datetime('now','-72 hours')
                   ORDER BY severity DESC, timestamp DESC
                   LIMIT ?""",
                (severity_min, limit)
            ) as c:
                return [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.warning("get_recent_events: %s", e)
        return []


async def get_macro_indicators(limit: int = 15) -> List[Dict]:
    """Get current macro indicators."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT name, value, previous, unit, category, country, updated_at "
                "FROM macro_indicators ORDER BY updated_at DESC LIMIT ?",
                (limit,)
            ) as c:
                return [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.warning("get_macro_indicators: %s", e)
        return []


async def get_brain_context_for_report(user_id: int, topic: str) -> str:
    """Get user's brain context for a given topic."""
    try:
        from routers.brain import brain_context_for_prompt
        return await brain_context_for_prompt(user_id, topic, top_k=6)
    except Exception as e:
        logger.debug("brain context for report: %s", e)
        return ""


# ── Report builders ───────────────────────────────────────────────────────────

async def build_portfolio_stress(user_id: int, params: Dict) -> str:
    """Build context for portfolio stress test report."""
    holdings = params.get("holdings", [])  # list of {ticker, weight}
    if not holdings:
        holdings = [
            {"ticker": "VWCE", "weight": 60},
            {"ticker": "IBGL", "weight": 25},
            {"ticker": "XGLD", "weight": 15},
        ]

    # Get risk nodes from KG
    risk_nodes = await get_kg_context(["event", "indicator", "concept"], limit=15)
    macro = await get_macro_indicators(10)
    events = await get_recent_events(10, severity_min=7)
    brain_ctx = await get_brain_context_for_report(user_id, "portfolio risk ETF")

    ctx = f"""PORTFOLIO:
{json.dumps(holdings, indent=2)}

CURRENT KG RISK NODES (most cited):
{chr(10).join(f'- [{n["type"]}] {n["label"]}: {n.get("description","")[:150]}' for n in risk_nodes[:10])}

MACRO INDICATORS:
{chr(10).join(f'- {m["name"]} ({m.get("country","?")}): {m.get("value","?")} {m.get("unit","")}'  for m in macro[:8])}

HIGH SEVERITY EVENTS (last 72h):
{chr(10).join(f'- [{e.get("severity","?")}] {e["title"]} ({e.get("country_name","")})'  for e in events[:8])}
"""
    if brain_ctx:
        ctx = brain_ctx + "\n\n" + ctx
    return ctx


async def build_macro_outlook(user_id: int, params: Dict) -> str:
    """Build context for macro outlook report."""
    indicators = await get_macro_indicators(20)
    kg_indicators = await get_kg_context(["indicator", "policy"], limit=15)
    kg_edges = await get_kg_edges_for_node("Federal Reserve", 8)
    kg_edges += await get_kg_edges_for_node("Interest Rate", 6)
    events = await get_recent_events(8, severity_min=6)
    brain_ctx = await get_brain_context_for_report(user_id, "macro monetary policy inflation")

    ctx = f"""MACRO INDICATORS (live):
{chr(10).join(f'- {m["name"]}: {m.get("value","?")} {m.get("unit","")} (prev: {m.get("previous","?")})' for m in indicators[:12])}

KG MACRO NODES (shared knowledge):
{chr(10).join(f'- {n["label"]} [{n["type"]}]: {n.get("description","")[:120]}' for n in kg_indicators[:10])}

KEY RELATIONSHIPS IN KG:
{chr(10).join(f'- {e["src_label"]} --[{e["relation"]}]--> {e["tgt_label"]}: {e.get("evidence_text","")[:100]}' for e in kg_edges[:10])}

RELEVANT EVENTS:
{chr(10).join(f'- {ev["title"]} ({ev.get("category","")})'  for ev in events[:6])}
"""
    if brain_ctx:
        ctx = brain_ctx + "\n\n" + ctx
    return ctx


async def build_geo_risk(user_id: int, params: Dict) -> str:
    """Build context for geo risk report."""
    focus_region = params.get("region", "")
    geo_nodes = await get_kg_context(["entity", "event"], limit=20,
                                      related_to=focus_region if focus_region else None)
    events = await get_recent_events(15, severity_min=7)
    brain_ctx = await get_brain_context_for_report(user_id, f"geopolitical risk {focus_region}")

    # Group events by country
    by_country: Dict[str, List] = {}
    for ev in events:
        c = ev.get("country_name", "Global")
        by_country.setdefault(c, []).append(ev)

    ctx = f"""FOCUS REGION: {focus_region or 'Global'}

GEO/ENTITY NODES IN KG:
{chr(10).join(f'- {n["label"]} [{n["type"]}]: {n.get("description","")[:120]}' for n in geo_nodes[:15])}

EVENTS BY COUNTRY (last 72h, severity >= 7):
{chr(10).join(f'{country}: ' + ', '.join(e['title'][:60] for e in evs[:2]) for country, evs in list(by_country.items())[:10])}
"""
    if brain_ctx:
        ctx = brain_ctx + "\n\n" + ctx
    return ctx


async def build_weekly_brief(user_id: int, params: Dict) -> str:
    """Build context for full weekly brief."""
    macro = await get_macro_indicators(12)
    events = await get_recent_events(20, severity_min=6)
    kg_top = await get_kg_context(["indicator", "entity", "concept", "event"], limit=20)
    brain_ctx = await get_brain_context_for_report(user_id, "weekly market intelligence macro geopolitical")

    ctx = f"""WEEK: {date.today().strftime('%B %d, %Y')}

TOP KG NODES THIS WEEK:
{chr(10).join(f'- [{n["type"]}] {n["label"]} (×{n.get("source_count",1)} sources): {n.get("description","")[:100]}' for n in kg_top[:12])}

MACRO SNAPSHOT:
{chr(10).join(f'- {m["name"]}: {m.get("value","?")} {m.get("unit","")}' for m in macro[:10])}

TOP EVENTS:
{chr(10).join(f'- [{e.get("severity","?")}] [{e.get("category","")}] {e["title"]} ({e.get("country_name","")})' for e in events[:12])}
"""
    if brain_ctx:
        ctx = brain_ctx + "\n\n" + ctx
    return ctx


# ── System prompts per report type ────────────────────────────────────────────

SYSTEM_PROMPTS = {
    "portfolio_stress": """Sei un risk manager quantitativo di WorldLens.
Analizza l'esposizione del portafoglio ETF ai rischi attuali.
Usa QUESTO formato esatto:

**📊 PORTFOLIO STRESS TEST — {data}**

**Risk Score Portafoglio: [X]/10** 🟢/🟡/🟠/🔴

**Esposizioni critiche**
| ETF | Peso | Esposizione al rischio | Impatto stimato |
|-----|------|------------------------|-----------------|
[righe per ogni ETF]

**Top 3 rischi geopolitici/macro per il portafoglio**
1. 🔴 [rischio critico — ETF più esposto]
2. 🟠 [rischio alto]
3. 🟡 [rischio moderato]

**Scenario base (probabilità 60%)**
[descrizione outcome e impatto portafoglio]

**Scenario stress (probabilità 25%)**
[descrizione worst case e drawdown stimato]

**Azioni raccomandate**
• [azione immediata]
• [hedge o ribilanciamento]
• [monitoraggio]

*Analisi basata su [N] nodi KG condivisi + [M] eventi live*""",

    "macro_outlook": """Sei un macro strategist di WorldLens.
Usa QUESTO formato:

**🌐 MACRO OUTLOOK — {data}**

**Regime attuale: [RISK-ON / RISK-OFF / TRANSIZIONE]**

**Matrice macro**
| Indicatore | Valore | Trend | Impatto mercati |
|------------|--------|-------|-----------------|
[righe]

**Fed/ECB: prossime mosse**
[analisi 2-3 frasi]

**Inflazione vs Crescita**
[analisi tensione 2-3 frasi]

**Asset class: posizionamento consigliato**
• Equity: [sovrappeso/neutro/sottopeso] — [motivo]
• Bond: [sovrappeso/neutro/sottopeso] — [motivo]
• Commodities: [sovrappeso/neutro/sottopeso] — [motivo]
• Cash: [% consigliata]

**Rischi principali al macro outlook**
1. [rischio principale]
2. [rischio secondario]

*Macro intelligence da KG condiviso + dati live*""",

    "sector_digest": """Sei un analista settoriale di WorldLens.
Usa QUESTO formato:

**🏭 SECTOR DIGEST — {settore} — {data}**

**Sentiment: [BULLISH / NEUTRAL / BEARISH]**

**Driver principali**
• [driver 1 — impatto +/-]
• [driver 2]
• [driver 3]

**ETF rilevanti**
| ETF | Esposizione | Performance recente | Rischio chiave |
|-----|-------------|---------------------|----------------|
[righe]

**Relazioni KG chiave per questo settore**
[mostra le relazioni causa-effetto dal KG]

**Outlook 4 settimane**
[scenario centrale e range]

**Catalizzatori da monitorare**
• [evento atteso 1]
• [evento atteso 2]

*Sector intelligence da KG + eventi live*""",

    "geo_risk": """Sei un analista geopolitico di WorldLens.
Usa QUESTO formato:

**🌍 GEO RISK REPORT — {regione} — {data}**

**Risk Level: [X]/10** 🟢/🟡/🟠/🔴

**Hotspot attivi**
| Paese/Regione | Rischio | Tipo | Impatto mercati |
|---------------|---------|------|-----------------|
[righe]

**Timeline eventi chiave recenti**
• [data] — [evento]
• [data] — [evento]

**Esposizione asset class**
• ETF più esposti: [lista]
• Commodity impattate: [lista]
• Valute a rischio: [lista]

**Scenari**
🔴 Escalation: [scenario] → impatto [asset]
🟢 De-escalation: [scenario] → opportunità [asset]

**Raccomandazioni**
[2-3 azioni concrete per gestire il rischio]

*Geo intelligence da [N] nodi KG + eventi GDELT live*""",

    "weekly_brief": """Sei il chief analyst di WorldLens.
Produci il brief settimanale completo. Usa QUESTO formato:

**📋 WORLDLENS WEEKLY BRIEF — {data}**
*Intelligence settimanale per investitori istituzionali e avanzati*

---

**🌐 MACRO: Regime della settimana**
[2-3 frasi stato macro + regime risk-on/off]

**📊 MERCATI: Cosa si è mosso**
| Asset | Direzione | Driver principale |
|-------|-----------|-------------------|
[righe per equity, bond, commodities, crypto, forex]

**🌍 GEOPOLITICA: Top 3 sviluppi**
1. [paese/regione] — [sviluppo] — impatto: [asset]
2. [paese/regione] — [sviluppo] — impatto: [asset]
3. [paese/regione] — [sviluppo] — impatto: [asset]

**🧠 BRAIN SIGNAL: Pattern emergenti**
[Connessioni non ovvie tra eventi — il valore unico del KG]

**📈 PORTAFOGLIO: Posizionamento consigliato**
• [asset class 1]: [view]
• [asset class 2]: [view]
• [hedge]: [strumento]

**⚠ RISK RADAR: Watch list prossima settimana**
• [evento atteso 1] — [data] — [impatto potenziale]
• [evento atteso 2]
• [indicatore da monitorare]

---
*WorldLens Brain — {N} nodi KG condivisi | {M} eventi monitorati | {K} entries brain utente*""",
}


# ── Main generate endpoint ────────────────────────────────────────────────────

@router.post("/generate")
async def generate_report(
    payload: dict = Body(...),
    user=Depends(require_user),
):
    """
    Generate a financial intelligence report using KG + Brain + live data.

    body: {
      type: "portfolio_stress" | "macro_outlook" | "sector_digest" | "geo_risk" | "weekly_brief",
      params: {
        holdings: [{ticker, weight}],   # for portfolio_stress
        region: "Middle East",          # for geo_risk / sector_digest
        sector: "Technology",           # for sector_digest
      }
    }
    """
    report_type = payload.get("type", "weekly_brief")
    params      = payload.get("params", {})

    if report_type not in REPORT_TYPES:
        raise HTTPException(400, f"Unknown report type. Choose: {list(REPORT_TYPES.keys())}")

    user_id = user["id"]
    ug, ua  = await _get_user_ai_keys(user_id)
    has_ai  = bool(ug or ua)

    if not has_ai:
        # Check admin key
        from ai_layer import _resolve_provider
        provider, ai_key = _resolve_provider()
        has_ai = bool(ai_key)
        if has_ai:
            if provider == "gemini":
                ug = ai_key
            else:
                ua = ai_key

    # Build context from KG + live data
    context_builders = {
        "portfolio_stress": build_portfolio_stress,
        "macro_outlook":    build_macro_outlook,
        "sector_digest":    build_geo_risk,  # reuse geo builder with sector focus
        "geo_risk":         build_geo_risk,
        "weekly_brief":     build_weekly_brief,
    }
    builder = context_builders.get(report_type, build_weekly_brief)
    context = await builder(user_id, params)

    # Prepare system prompt
    today = date.today().strftime("%d %B %Y")
    system = SYSTEM_PROMPTS[report_type].replace("{data}", today)
    system = system.replace("{regione}", params.get("region", "Global"))
    system = system.replace("{settore}", params.get("sector", "General"))

    # Count KG stats for footer
    pool = await get_pool()
    kg_nodes = 0
    try:
        if pool:
            async with pool.acquire() as conn:
                kg_nodes = await conn.fetchval("SELECT COUNT(*) FROM kg_nodes") or 0
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                async with db.execute("SELECT COUNT(*) FROM kg_nodes") as c:
                    kg_nodes = (await c.fetchone())[0] or 0
    except Exception:
        pass

    system = system.replace("{N}", str(kg_nodes))

    report_text = None
    if has_ai:
        try:
            report_text = await _call_claude(
                context,
                system=system,
                max_tokens=REPORT_TYPES[report_type]["tokens"],
                user_gemini_key=ug,
                user_anthropic_key=ua,
            )
        except Exception as e:
            logger.warning("report generate AI error: %s", e)

    if not report_text:
        # Data-driven fallback without AI
        report_text = _build_fallback_report(report_type, context, today)

    # Save to brain
    try:
        from routers.brain import brain_ingest
        await brain_ingest(
            user_id,
            f"Generated {report_type} report: {report_text[:500]}",
            source="analysis",
            weight=2.0,
            context={"report_type": report_type, "date": today}
        )
    except Exception:
        pass

    return {
        "report":      report_text,
        "type":        report_type,
        "label":       REPORT_TYPES[report_type]["label"],
        "date":        today,
        "kg_nodes":    kg_nodes,
        "has_ai":      has_ai,
        "generated_at": datetime.utcnow().isoformat(),
    }


def _build_fallback_report(report_type: str, context: str, today: str) -> str:
    """Data-driven report when no AI key available."""
    tmpl = REPORT_TYPES[report_type]
    lines = context.split("\n")[:30]
    return (
        f"**{tmpl['icon']} {tmpl['label'].split(' — ')[0]} — {today}**\n\n"
        f"*Report generato dal Knowledge Graph (AI non disponibile — aggiungi chiave Gemini in Profilo)*\n\n"
        + "\n".join(lines) +
        "\n\n*Configura una chiave AI in Profilo → La tua chiave AI per report con analisi completa.*"
    )


@router.get("/types")
async def list_report_types(_=Depends(require_user)):
    return [
        {"id": k, **{kk: vv for kk, vv in v.items() if kk != "tokens"}}
        for k, v in REPORT_TYPES.items()
    ]
