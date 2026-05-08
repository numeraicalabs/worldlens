"""
WorldLens Global Dashboard Cache
==================================
Pre-generates rich AI content once daily (07:00 UTC) using admin Gemini key.
All users receive the same high-quality content without needing personal API keys.
Personal keys add extra personalization on top.

Cache structure (DB table: global_cache):
  - global_brief       : 500-word structured briefing (5 sections)
  - macro_narrative    : 6 indicators with 2-line AI interpretation each
  - ew_assessment      : 4-paragraph Early Warning analysis
  - top_events_parsed  : 10 events enriched with 3-sentence summaries
  - kg_connections     : Top 5 KG relationships discovered today
  - market_snapshot    : 5 KPIs with trend context
  - date               : YYYY-MM-DD

Fallback (no admin key): rule-based content from DB data alone.
"""
from __future__ import annotations
import asyncio
import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Any

import aiosqlite
from config import settings

logger = logging.getLogger(__name__)

CACHE_SCHEMA = """
CREATE TABLE IF NOT EXISTS global_cache (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    cache_date   TEXT NOT NULL UNIQUE,
    global_brief TEXT NOT NULL DEFAULT '',
    macro_narrative TEXT NOT NULL DEFAULT '[]',
    ew_assessment   TEXT NOT NULL DEFAULT '',
    top_events      TEXT NOT NULL DEFAULT '[]',
    kg_connections  TEXT NOT NULL DEFAULT '[]',
    market_snapshot TEXT NOT NULL DEFAULT '[]',
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    ai_enhanced  INTEGER NOT NULL DEFAULT 0
);
"""

# ── Rule-based fallbacks (no AI required) ─────────────────────────────────────

def _rule_macro_interp(name: str, value: Any, unit: str, prev: Any, lang: str = "it") -> str:
    """Generate a 1-line interpretation without AI."""
    try:
        v = float(value or 0)
        p = float(prev or v)
        arrow = "↑" if v > p else "↓" if v < p else "→"
        delta = abs(v - p)
    except Exception:
        return ""

    name_upper = (name or "").upper()
    it = lang == "it"

    if "CPI" in name_upper or "INFLATION" in name_upper:
        if v > 3.5:
            return ("Inflazione persistente sopra target. Pressione per mantenere tassi alti." if it else
                    "Persistent inflation above target. Pressure to keep rates elevated.")
        elif v > 2.0:
            return ("Inflazione ancora sopra target 2%. Banca centrale in modalità vigile." if it else
                    "Inflation still above 2% target. Central bank remains watchful.")
        else:
            return ("Inflazione vicina al target. Spazio per allentare la politica monetaria." if it else
                    "Inflation near target. Room to ease monetary policy.")
    elif "VIX" in name_upper:
        if v > 35:
            return ("Panico sui mercati. Stress sistemico elevato — risk-off." if it else
                    "Market panic. High systemic stress — risk-off mode.")
        elif v > 20:
            return ("Nervosismo sui mercati. Volatilità sopra la media storica." if it else
                    "Market nervousness. Volatility above historical average.")
        else:
            return ("Mercati calmi. VIX basso indica complacency — attenzione a shock." if it else
                    "Markets calm. Low VIX signals complacency — watch for shocks.")
    elif "PMI" in name_upper:
        if v > 55:
            return ("Settore in forte espansione. Ordinativi e produzione in crescita." if it else
                    "Sector in strong expansion. Orders and output growing.")
        elif v > 50:
            return ("Espansione moderata. Attività economica in territorio positivo." if it else
                    "Moderate expansion. Economic activity in positive territory.")
        else:
            return ("Contrazione del settore. Segnale di rallentamento economico." if it else
                    "Sector contraction. Signal of economic slowdown.")
    elif "GDP" in name_upper:
        if v > 3:
            return ("Crescita solida. Economia in piena espansione." if it else
                    "Solid growth. Economy in full expansion.")
        elif v > 0:
            return ("Crescita moderata. Economia avanza ma sotto il potenziale." if it else
                    "Moderate growth. Economy advancing but below potential.")
        else:
            return ("Contrazione del PIL. Rischio recessione tecnica." if it else
                    "GDP contraction. Technical recession risk.")
    elif "DXY" in name_upper or "DOLLAR" in name_upper:
        if v > 106:
            return ("Dollaro forte. Pressione su mercati emergenti e commodity." if it else
                    "Strong dollar. Pressure on emerging markets and commodities.")
        elif v < 98:
            return ("Dollaro debole. Favorisce export USA e asset rischiosi." if it else
                    "Weak dollar. Supports US exports and risk assets.")
        else:
            return f"Dollaro stabile a {v:.1f}. {'Nessun segnale direzionale forte.' if it else 'No strong directional signal.'}"
    elif "UNEMPLOYMENT" in name_upper or "DISOCCUP" in name_upper:
        if v < 4:
            return ("Mercato del lavoro teso. Pressioni salariali e inflazionistiche." if it else
                    "Tight labor market. Wage and inflationary pressures.")
        elif v < 6:
            return ("Mercato del lavoro solido. Piena occupazione sostanziale." if it else
                    "Solid labor market. Near full employment.")
        else:
            return ("Disoccupazione elevata. Domanda interna sotto pressione." if it else
                    "High unemployment. Domestic demand under pressure.")
    else:
        trend = "in aumento" if arrow == "↑" else "in calo" if arrow == "↓" else "stabile"
        trend_en = "rising" if arrow == "↑" else "falling" if arrow == "↓" else "stable"
        delta_str = f"{delta:.2f}{unit}" if delta > 0.01 else ""
        return (f"{arrow} {trend}{' di ' + delta_str if delta_str else ''}. Monitoraggio attivo." if it else
                f"{arrow} {trend_en}{' by ' + delta_str if delta_str else ''}. Monitoring active.")


def _rule_ew_assessment(scores: Dict, events: List[Dict], lang: str = "it") -> str:
    """Generate 4-paragraph EW text without AI."""
    score = float(scores.get("global_ew_score", 5))
    macro = float(scores.get("macro_stress", 5))
    market = float(scores.get("market_stress", 5))
    vel = float(scores.get("event_velocity", 1))
    it = lang == "it"

    # Para 1: overall
    if score >= 8:
        p1 = ("Livello di minaccia globale critico. Lo score EW di {:.1f}/10 riflette una convergenza di fattori di rischio sistemici: "
              "elevata velocità degli eventi, stress macro e volatilità di mercato simultanei.").format(score) if it else \
             ("Global threat level critical. EW score of {:.1f}/10 reflects converging systemic risk factors: "
              "high event velocity, macro stress and market volatility simultaneously.").format(score)
    elif score >= 6:
        p1 = ("Livello di allerta elevato con score EW {:.1f}/10. Multipli hotspot geopolitici attivi con "
              "potenziale di escalation nel breve termine.").format(score) if it else \
             ("Elevated alert level with EW score {:.1f}/10. Multiple active geopolitical hotspots with "
              "short-term escalation potential.").format(score)
    else:
        p1 = ("Ambiente di rischio moderato. Score EW {:.1f}/10 indica stabilità relativa con "
              "rischi contenuti e gestibili.").format(score) if it else \
             ("Moderate risk environment. EW score {:.1f}/10 indicates relative stability with "
              "contained and manageable risks.").format(score)

    # Para 2: top event
    top = events[0] if events else {}
    if top:
        cat = (top.get("category") or "SECURITY").title()
        country = top.get("country_name") or "Global"
        title = top.get("title") or ""
        p2 = (f"Il principale rischio di escalation è nell'area {cat}/{country}: {title[:100]}. "
              f"Stress macro a {macro:.1f}/10, velocità eventi {vel:.1f}x rispetto alla media.") if it else \
             (f"Primary escalation risk in {cat}/{country}: {title[:100]}. "
              f"Macro stress at {macro:.1f}/10, event velocity {vel:.1f}x above average.")
    else:
        p2 = ("Nessun evento singolo dominante. Rischio distribuito su multiple regioni." if it else
              "No single dominant event. Risk distributed across multiple regions.")

    # Para 3: second-order
    if market >= 7:
        p3 = ("Effetti di secondo ordine sul mercato sottovalutati: spread creditizi in espansione, "
              "risk-off in atto. Monitorare flussi verso safe haven (oro, USD, Treasury).") if it else \
             ("Second-order market effects being underpriced: credit spreads expanding, "
              "risk-off underway. Monitor flows to safe havens (gold, USD, Treasuries).")
    elif macro >= 6:
        p3 = ("Pressioni macro strutturali: inflazione persistente o crescita sotto target. "
              "Politiche monetarie restrittive potrebbero amplificare lo stress.") if it else \
             ("Structural macro pressures: persistent inflation or below-target growth. "
              "Restrictive monetary policies could amplify stress.")
    else:
        p3 = ("Rischi sistemici contenuti. Principale vulnerabilità: possibile shock esogeno "
              "non prezzato dai mercati (evento cigno nero).") if it else \
             ("Systemic risks contained. Main vulnerability: potential exogenous shock "
              "not priced by markets (black swan event).")

    # Para 4: market implications
    p4 = ("Implicazioni per il portafoglio: in scenario risk-off, ridurre esposizione asset ciclici, "
          "aumentare duration obbligazionaria e peso oro (GLD/XGLD). "
          "Monitorare VIX sopra 25 come segnale di conferma stress.") if it else \
         ("Portfolio implications: in risk-off scenario, reduce cyclical asset exposure, "
          "increase bond duration and gold weight (GLD/XGLD). "
          "Watch VIX above 25 as stress confirmation signal.")

    return f"{p1}\n\n{p2}\n\n{p3}\n\n{p4}"


def _rule_global_brief(events: List[Dict], indicators: List[Dict], lang: str = "it") -> str:
    """Generate structured 300-word brief without AI."""
    it = lang == "it"
    top_events = sorted(events, key=lambda e: float(e.get("severity") or 0), reverse=True)[:8]
    cats: Dict[str, List] = {}
    for ev in top_events:
        c = (ev.get("category") or "OTHER").upper()
        cats.setdefault(c, []).append(ev)

    macro_snap = " | ".join([
        f"{m['name']}: {m.get('value', '?')} {m.get('unit', '')}"
        for m in indicators[:4]
    ])

    n_critical = sum(1 for e in events if float(e.get("severity") or 0) >= 8)
    n_high = sum(1 for e in events if 6 <= float(e.get("severity") or 0) < 8)

    if it:
        lines = [
            "**EXECUTIVE SUMMARY**",
            f"Monitoraggio attivo su {len(events)} eventi nelle ultime 72 ore. "
            f"{n_critical} eventi critici (severity ≥8), {n_high} ad alta priorità.",
            "",
            "**AMBIENTE MACRO**",
            macro_snap,
            "",
            "**RISCHIO GEOPOLITICO**",
        ]
        for cat, evs in list(cats.items())[:3]:
            lines.append(f"*{cat.title()}*: {evs[0].get('title','')[:80]} ({evs[0].get('country_name','Global')})")
        lines += ["", "**IMPLICAZIONI DI MERCATO**",
                  "Monitorare asset sensibili ai rischi identificati. "
                  "Aggiungi chiave Gemini in Profilo per analisi approfondita.",
                  "", "**WATCH LIST**",
                  "• Aggiornamento Early Warning ogni ora",
                  "• Usa Jarvis per analisi personalizzata su singoli nodi del KG",
                  "• Imposta alert su paesi e categorie critiche"]
    else:
        lines = [
            "**EXECUTIVE SUMMARY**",
            f"Active monitoring on {len(events)} events in the last 72 hours. "
            f"{n_critical} critical events (severity ≥8), {n_high} high priority.",
            "",
            "**MACRO ENVIRONMENT**",
            macro_snap,
            "",
            "**GEOPOLITICAL RISK**",
        ]
        for cat, evs in list(cats.items())[:3]:
            lines.append(f"*{cat.title()}*: {evs[0].get('title','')[:80]} ({evs[0].get('country_name','Global')})")
        lines += ["", "**MARKET IMPLICATIONS**",
                  "Monitor assets sensitive to identified risks. "
                  "Add Gemini key in Profile for deep analysis.",
                  "", "**WATCH LIST**",
                  "• Early Warning updated hourly",
                  "• Use Jarvis for personalized KG node analysis",
                  "• Set alerts on critical countries and categories"]

    return "\n".join(lines)


# ── AI-enhanced generation ─────────────────────────────────────────────────────

async def _ai_global_brief(events: List[Dict], indicators: List[Dict],
                            ug: str = "", ua: str = "", lang: str = "it") -> str:
    """Generate 500-word structured briefing with AI."""
    from ai_layer import _call_claude
    ev_text = "\n".join([
        f"[{e.get('category','?')} | {e.get('country_name','Global')} | sev={float(e.get('severity') or 5):.0f}] {e.get('title','')}"
        for e in events[:12]
    ])
    macro_text = "\n".join([
        f"• {m['name']} ({m.get('country','Global')}): {m.get('value','?')} {m.get('unit','')}"
        for m in indicators[:8]
    ])
    if lang == "it":
        prompt = (
            f"Scrivi un briefing di intelligence macro completo (450-500 parole) per investitori professionali.\n\n"
            f"INDICATORI MACRO:\n{macro_text}\n\nEVENTI (72h):\n{ev_text}\n\n"
            f"Struttura esatta:\n**EXECUTIVE SUMMARY** (2-3 frasi: postura di rischio)\n\n"
            f"**AMBIENTE MACRO** (3-4 frasi con numeri specifici)\n\n"
            f"**RISCHIO GEOPOLITICO** (3-4 frasi, nomina paesi e attori specifici)\n\n"
            f"**IMPLICAZIONI DI MERCATO** (3-4 frasi: ETF, valute, commodity esposte)\n\n"
            f"**WATCH LIST** (3 segnali specifici da monitorare nei prossimi 7 giorni)\n\n"
            f"Sii diretto e specifico. Usa numeri. Niente disclaimer."
        )
    else:
        prompt = (
            f"Write a comprehensive macro intelligence briefing (450-500 words) for professional investors.\n\n"
            f"MACRO INDICATORS:\n{macro_text}\n\nEVENTS (72h):\n{ev_text}\n\n"
            f"Exact structure:\n**EXECUTIVE SUMMARY** (2-3 sentences: risk posture)\n\n"
            f"**MACRO ENVIRONMENT** (3-4 sentences with specific numbers)\n\n"
            f"**GEOPOLITICAL RISK** (3-4 sentences, name specific countries and actors)\n\n"
            f"**MARKET IMPLICATIONS** (3-4 sentences: exposed ETFs, currencies, commodities)\n\n"
            f"**WATCH LIST** (3 specific signals to monitor over the next 7 days)\n\n"
            f"Be direct and specific. Use numbers. No disclaimers."
        )
    system = ("Sei un analista geopolitico e finanziario senior di livello istituzionale." if lang == "it"
              else "You are a senior institutional-grade geopolitical and financial analyst.")
    result = await _call_claude(prompt, system=system, max_tokens=900,
                                 user_gemini_key=ug, user_anthropic_key=ua)
    return result or ""


async def _ai_event_summaries(events: List[Dict], ug: str = "", ua: str = "",
                               lang: str = "it") -> List[Dict]:
    """Add 3-sentence AI summary to each top event."""
    from ai_layer import _call_claude
    enriched = []
    for ev in events[:10]:
        title = ev.get("title") or ""
        cat = ev.get("category") or "general"
        country = ev.get("country_name") or "Global"
        sev = float(ev.get("severity") or 5)
        existing_summary = ev.get("ai_summary") or ev.get("summary") or ""

        if existing_summary and len(existing_summary) > 100:
            ev["rich_summary"] = existing_summary
        elif ug or ua:
            if lang == "it":
                p = (f"Evento: {title}\nCategoria: {cat} | Paese: {country} | Severity: {sev:.0f}/10\n\n"
                     f"Scrivi 3 frasi di contesto per un investitore: cosa è successo, "
                     f"perché è importante per i mercati, quale sviluppo monitorare. "
                     f"Max 80 parole. Niente disclaimer.")
            else:
                p = (f"Event: {title}\nCategory: {cat} | Country: {country} | Severity: {sev:.0f}/10\n\n"
                     f"Write 3 context sentences for an investor: what happened, "
                     f"why it matters for markets, what development to monitor. "
                     f"Max 80 words. No disclaimers.")
            summary = await _call_claude(p, max_tokens=120,
                                          user_gemini_key=ug, user_anthropic_key=ua)
            ev["rich_summary"] = summary or title
            await asyncio.sleep(0.3)  # rate limit
        else:
            # Rule-based: use existing summary or title
            ev["rich_summary"] = existing_summary[:300] if existing_summary else title

        enriched.append(ev)
    return enriched


async def _ai_macro_narrative(indicators: List[Dict], ug: str = "", ua: str = "",
                               lang: str = "it") -> List[Dict]:
    """Add 2-line AI interpretation to each macro indicator."""
    from ai_layer import _call_claude
    result = []
    for m in indicators[:6]:
        val = m.get("value")
        prev = m.get("previous")
        unit = m.get("unit", "")
        name = m.get("name", "")
        country = m.get("country", "Global")

        try:
            arrow = "↑" if prev and float(val) > float(prev) else "↓" if prev and float(val) < float(prev) else ""
        except Exception:
            arrow = ""

        if ug or ua:
            if lang == "it":
                p = (f"Indicatore: {name} ({country}) = {val} {unit} {arrow}\n"
                     f"Precedente: {prev or 'N/A'}\n"
                     f"Scrivi 2 frasi di interpretazione per investitori. "
                     f"Prima frase: cosa significa il dato attuale. "
                     f"Seconda frase: implicazione per tassi/mercati. Max 40 parole totali.")
            else:
                p = (f"Indicator: {name} ({country}) = {val} {unit} {arrow}\n"
                     f"Previous: {prev or 'N/A'}\n"
                     f"Write 2 interpretation sentences for investors. "
                     f"First: what the current reading means. "
                     f"Second: implication for rates/markets. Max 40 words total.")
            interp = await _call_claude(p, max_tokens=80,
                                         user_gemini_key=ug, user_anthropic_key=ua) or ""
            await asyncio.sleep(0.2)
        else:
            interp = _rule_macro_interp(name, val, unit, prev, lang)

        m["interpretation"] = interp.strip()
        m["arrow"] = arrow
        result.append(m)
    return result


async def _get_kg_connections_today() -> List[Dict]:
    """Get top KG edges discovered/updated today."""
    from supabase_client import get_pool
    pool = await get_pool()
    try:
        if pool:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT n1.label as src, e.relation, n2.label as tgt,
                              e.weight, COALESCE(e.evidence_text,'') as evidence
                       FROM kg_edges e
                       JOIN kg_nodes n1 ON n1.id = e.src_id
                       JOIN kg_nodes n2 ON n2.id = e.tgt_id
                       ORDER BY e.weight DESC, e.id DESC
                       LIMIT 8""")
                return [dict(r) for r in rows]
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    """SELECT n1.label as src, e.relation, n2.label as tgt,
                              e.weight, COALESCE(e.evidence_text,'') as evidence
                       FROM kg_edges e
                       JOIN kg_nodes n1 ON n1.id = e.src_id
                       JOIN kg_nodes n2 ON n2.id = e.tgt_id
                       ORDER BY e.weight DESC
                       LIMIT 8"""
                ) as c:
                    return [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.debug("_get_kg_connections_today: %s", e)
        return []


# ── Main cache generation ──────────────────────────────────────────────────────

async def generate_global_cache(force: bool = False, lang: str = "it") -> Dict:
    """
    Generate and store global dashboard cache.
    Called by scheduler at 07:00 UTC daily.
    Safe to call multiple times — checks if cache exists first.
    Returns the cache dict.
    """
    from ai_layer import _resolve_provider, ai_available_async

    today = date.today().isoformat()

    async with aiosqlite.connect(settings.db_path) as db:
        await db.executescript(CACHE_SCHEMA)
        await db.commit()

        if not force:
            async with db.execute(
                "SELECT * FROM global_cache WHERE cache_date=?", (today,)
            ) as c:
                existing = await c.fetchone()
            if existing and existing["global_brief"]:
                logger.info("Global cache already exists for %s", today)
                row = dict(existing)
                row["top_events"] = json.loads(row.get("top_events") or "[]")
                row["macro_narrative"] = json.loads(row.get("macro_narrative") or "[]")
                row["kg_connections"] = json.loads(row.get("kg_connections") or "[]")
                row["market_snapshot"] = json.loads(row.get("market_snapshot") or "[]")
                return row

        # Fetch source data
        async with db.execute(
            """SELECT id, title, summary, ai_summary, category, country_name,
                      severity, source_url, timestamp
               FROM events
               WHERE datetime(timestamp) > datetime('now','-72 hours')
               ORDER BY severity DESC LIMIT 20"""
        ) as c:
            events = [dict(r) for r in await c.fetchall()]

        async with db.execute(
            "SELECT name, value, previous, unit, country FROM macro_indicators "
            "ORDER BY updated_at DESC LIMIT 15"
        ) as c:
            indicators = [dict(r) for r in await c.fetchall()]

    # Resolve AI
    has_ai = await ai_available_async()
    ug = ua = ""
    if has_ai:
        provider, key = _resolve_provider()
        if provider == "gemini":
            ug = key
        else:
            ua = key

    logger.info("Generating global cache (ai=%s, events=%d, indicators=%d)",
                has_ai, len(events), len(indicators))

    # EW scores
    try:
        from routers.intelligence import compute_ew_scores
        scores = await compute_ew_scores()
    except Exception:
        scores = {"global_ew_score": 5, "macro_stress": 5,
                  "market_stress": 5, "event_velocity": 1}

    # Generate all content in parallel where possible
    if has_ai:
        brief_task    = _ai_global_brief(events, indicators, ug, ua, lang)
        events_task   = _ai_event_summaries(events, ug, ua, lang)
        macro_task    = _ai_macro_narrative(indicators, ug, ua, lang)
        ew_task       = asyncio.sleep(0)  # EW uses rule-based always

        brief = await brief_task
        enriched_events = await events_task
        macro_cards = await macro_task
    else:
        brief = _rule_global_brief(events, indicators, lang)
        enriched_events = events[:10]
        for ev in enriched_events:
            ev["rich_summary"] = ev.get("ai_summary") or ev.get("summary") or ev.get("title","")
        macro_cards = [dict(m, **{
            "interpretation": _rule_macro_interp(
                m.get("name",""), m.get("value"), m.get("unit",""), m.get("previous"), lang),
            "arrow": "↑" if m.get("previous") and float(m.get("value",0)) > float(m.get("previous",0)) else "↓"
        }) for m in indicators[:6]]

    ew_text = _rule_ew_assessment(scores, events, lang)
    kg_conn = await _get_kg_connections_today()

    # Market snapshot (top 5 most-watched KPIs)
    PRIORITY = ["VIX", "DXY", "CPI", "PMI", "GDP", "Fed", "Interest Rate",
                "S&P", "Oil", "Gold", "Nasdaq", "NFP"]
    def _sort_ind(m):
        n = (m.get("name") or "").upper()
        for i, p in enumerate(PRIORITY):
            if p.upper() in n: return i
        return 99
    market_snap = sorted(indicators, key=_sort_ind)[:5]

    # Deduplicate events across cards
    _used_ids = set()
    deduped_events = []
    for ev in enriched_events:
        eid = ev.get("id")
        if eid not in _used_ids:
            _used_ids.add(eid)
            deduped_events.append(ev)

    # Categorize events for card routing
    for ev in deduped_events:
        cat = (ev.get("category") or "other").lower()
        if float(ev.get("severity") or 0) >= 8:
            ev["card_slot"] = "critical"
        elif cat in ("economy", "finance", "markets", "trade"):
            ev["card_slot"] = "macro"
        elif cat in ("energy", "commodities"):
            ev["card_slot"] = "markets"
        else:
            ev["card_slot"] = "crisis"

    # Save to DB — try Postgres first, then SQLite
    from supabase_client import get_pool as _gp
    _pool = await _gp()
    if _pool:
        try:
            async with _pool.acquire() as conn:
                await conn.execute(
                    "INSERT INTO global_cache "
                    "(cache_date, global_brief, macro_narrative, ew_assessment, "
                    "top_events, kg_connections, market_snapshot, ai_enhanced) "
                    "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) "
                    "ON CONFLICT(cache_date) DO UPDATE SET "
                    "global_brief=EXCLUDED.global_brief, macro_narrative=EXCLUDED.macro_narrative, "
                    "ew_assessment=EXCLUDED.ew_assessment, top_events=EXCLUDED.top_events, "
                    "kg_connections=EXCLUDED.kg_connections, market_snapshot=EXCLUDED.market_snapshot, "
                    "ai_enhanced=EXCLUDED.ai_enhanced",
                    today, brief, json.dumps(macro_cards), ew_text,
                    json.dumps(deduped_events[:10]), json.dumps(kg_conn),
                    json.dumps(market_snap), int(has_ai)
                )
                logger.info("Global cache saved to PostgreSQL")
        except Exception as _e:
            logger.warning("global_cache PG save: %s", _e)
    
    # Also save to SQLite as local cache
    async with aiosqlite.connect(settings.db_path) as db:
        await db.executescript(CACHE_SCHEMA)
        await db.execute(
            """INSERT OR REPLACE INTO global_cache
               (cache_date, global_brief, macro_narrative, ew_assessment,
                top_events, kg_connections, market_snapshot, ai_enhanced)
               VALUES (?,?,?,?,?,?,?,?)""",
            (today, brief, json.dumps(macro_cards), ew_text,
             json.dumps(deduped_events[:10]), json.dumps(kg_conn),
             json.dumps(market_snap), int(has_ai))
        )
        await db.commit()

    logger.info("Global cache generated for %s (ai=%s)", today, has_ai)
    return {
        "cache_date": today,
        "global_brief": brief,
        "macro_narrative": macro_cards,
        "ew_assessment": ew_text,
        "top_events": deduped_events[:10],
        "kg_connections": kg_conn,
        "market_snapshot": market_snap,
        "ai_enhanced": has_ai,
    }


async def get_global_cache(force_refresh: bool = False) -> Optional[Dict]:
    """Get today's cache, generating it if missing."""
    today = date.today().isoformat()
    try:
        # Try Postgres first
        from supabase_client import get_pool as _gp
        _pool = await _gp()
        if _pool:
            try:
                async with _pool.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT * FROM global_cache WHERE cache_date=$1", today
                    )
                    if row and row["global_brief"]:
                        d = dict(row)
                        d["top_events"]      = json.loads(d.get("top_events") or "[]")
                        d["macro_narrative"] = json.loads(d.get("macro_narrative") or "[]")
                        d["kg_connections"]  = json.loads(d.get("kg_connections") or "[]")
                        d["market_snapshot"] = json.loads(d.get("market_snapshot") or "[]")
                        return d
            except Exception: pass
        # SQLite fallback
        async with aiosqlite.connect(settings.db_path) as db:
            await db.executescript(CACHE_SCHEMA)
            await db.commit()
            async with db.execute(
                "SELECT * FROM global_cache WHERE cache_date=?", (today,)
            ) as c:
                row = await c.fetchone()
        if row and row["global_brief"] and not force_refresh:
            d = dict(row)
            d["top_events"]      = json.loads(d.get("top_events") or "[]")
            d["macro_narrative"] = json.loads(d.get("macro_narrative") or "[]")
            d["kg_connections"]  = json.loads(d.get("kg_connections") or "[]")
            d["market_snapshot"] = json.loads(d.get("market_snapshot") or "[]")
            return d
    except Exception as e:
        logger.debug("get_global_cache read: %s", e)

    # Generate if missing
    return await generate_global_cache(force=force_refresh)
