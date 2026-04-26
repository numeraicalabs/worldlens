"""
WorldLens Brain Auto-Population Engine v2
==========================================
Autonomous pipeline. Runs independently of user interactions.
Sources: SQLite events/macro/finance DB + Wikipedia + Gemini
"""
from __future__ import annotations
import asyncio, json, logging, re
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple
import httpx, aiosqlite
from config import settings

logger = logging.getLogger(__name__)

# ── Lazy KG import ────────────────────────────────────────────────────────────
async def _kg():
    from routers.knowledge_graph import upsert_node, upsert_edge, regex_extract, gemini_extract, ingest_extraction_result
    return upsert_node, upsert_edge, regex_extract, gemini_extract, ingest_extraction_result

# ── Node cache ────────────────────────────────────────────────────────────────
_ncache: Dict[str, int] = {}
_chits  = 0

async def _upsert(label: str, ntype: str, desc: str = "", conf: float = 0.9) -> Optional[int]:
    global _chits
    key = label.upper() + "|" + ntype
    if key in _ncache:
        _chits += 1
        return _ncache[key]
    upsert_node, *_ = await _kg()
    nid = await upsert_node(label, ntype, desc, conf)
    if nid:
        _ncache[key] = nid
    return nid

async def _edge(sid: int, tid: int, rel: str, ev: str = "", w: float = 1.0):
    _, upsert_edge, *_ = await _kg()
    return await upsert_edge(sid, tid, rel, ev[:300], w)

# ── Regex patterns ────────────────────────────────────────────────────────────
_CAUSAL = re.compile(r'\b(causes?|leads? to|results? in|triggers?|drives?)\b', re.I)
_CORR   = re.compile(r'\b(correlates?|tracks?|follows?|moves? with|linked to)\b', re.I)

# ── L1: Events → KG ──────────────────────────────────────────────────────────
async def auto_populate_from_events(events: List[Dict]) -> Tuple[int, int]:
    """Regex extraction from event list. Zero AI cost."""
    if not events:
        return 0, 0
    try:
        upsert_node, upsert_edge, regex_extract, *_ = await _kg()
    except Exception as e:
        logger.debug("L1 import: %s", e)
        return 0, 0

    tn = te = 0
    valuable = [e for e in events if float(e.get("severity") or 0) >= 5] or events[:30]

    for ev in valuable[:60]:
        try:
            title   = ev.get("title", "")
            summary = (ev.get("summary") or ev.get("ai_summary") or "")[:400]
            text    = f"{title}. {summary}"
            country = ev.get("country_name", "")
            cat     = ev.get("category", "")
            sev     = float(ev.get("severity") or 5)
            if len(text.strip()) < 20:
                continue

            extracted = regex_extract(text)
            nm: Dict[str, int] = {}

            if country and len(country) > 1:
                nid = await _upsert(country, "entity", f"Country: {country}", 0.95)
                if nid:
                    nm[country.upper()] = nid; tn += 1
            if cat and len(cat) > 2:
                nid = await _upsert(cat.title(), "concept", f"Event category: {cat}", 0.8)
                if nid:
                    nm[cat.upper()] = nid; tn += 1

            for n in extracted.get("nodes", []):
                lbl = (n.get("label") or "").strip()
                if not lbl or len(lbl) < 2:
                    continue
                nid = await _upsert(lbl, n.get("type", "concept"), "", float(n.get("confidence", 0.7)))
                if nid:
                    nm[lbl.upper()] = nid; tn += 1

            for e in extracted.get("edges", []):
                s = nm.get((e.get("src") or "").upper())
                t = nm.get((e.get("tgt") or "").upper())
                if s and t:
                    eid = await _edge(s, t, e.get("relation", "related"), title, sev / 10)
                    if eid:
                        te += 1
        except Exception as ex:
            logger.debug("L1 ev %s: %s", ev.get("id"), ex)

    if tn:
        logger.info("Brain L1 (events): +%d nodes +%d edges", tn, te)
    return tn, te

# ── Seed data ─────────────────────────────────────────────────────────────────
MACRO_SEED_NODES = [
    ("Federal Reserve","entity","US central bank controlling monetary policy via FOMC."),
    ("ECB","entity","European Central Bank setting eurozone interest rates."),
    ("Bank of England","entity","UK central bank setting GBP benchmark rates."),
    ("Bank of Japan","entity","Japanese central bank operating yield curve control."),
    ("Interest Rate","indicator","Central bank benchmark rate driving borrowing costs."),
    ("Inflation","indicator","CPI/PCE price level changes. Fed dual mandate component."),
    ("GDP Growth","indicator","Annual gross domestic product growth rate."),
    ("Unemployment Rate","indicator","Labor market health. Fed dual mandate component."),
    ("Yield Curve","indicator","Term structure of rates. Inversion signals recession."),
    ("10Y Treasury Yield","indicator","US 10-year yield. Global risk-free rate benchmark."),
    ("VIX","indicator","CBOE volatility index. Equity market fear gauge."),
    ("DXY","indicator","US Dollar index. Trade-weighted dollar strength."),
    ("Oil Price","commodity","Brent/WTI crude. Key inflation and growth driver."),
    ("Gold","commodity","Safe haven. Inflation hedge and dollar inverse proxy."),
    ("Copper","commodity","Industrial metal. Global economic activity barometer."),
    ("Bond Markets","concept","Fixed income. Reacts inversely to rate expectations."),
    ("Equity Markets","concept","Global stocks. Discounts future earnings and growth."),
    ("Emerging Markets","concept","EM assets. Sensitive to USD and US rate moves."),
    ("Credit Spread","indicator","Risk premium over risk-free rate. Widens in stress."),
    ("Quantitative Easing","policy","Central bank asset purchases expanding money supply."),
    ("Monetary Policy","policy","Central bank toolkit: rates, QE/QT, forward guidance."),
    ("Fiscal Policy","policy","Government spending and taxation."),
    ("Risk-On","concept","Market regime favoring risky assets."),
    ("Risk-Off","concept","Market regime of flight to safety."),
    ("Recession","event","Two quarters of negative GDP growth."),
    ("Stagflation","concept","High inflation + low/negative growth."),
    ("Yield Curve Inversion","event","Short rates exceed long rates. Recession signal."),
    ("VWCE","etf","Vanguard FTSE All-World. Global equity, 3800+ stocks."),
    ("IWDA","etf","iShares Core MSCI World. Developed markets equity."),
    ("EMAE","etf","iShares Core MSCI EM IMI. Emerging markets equity."),
    ("IBGL","etf","iShares Euro Government Bond. EUR sovereign bonds."),
    ("TLT","etf","iShares 20+ Year Treasury. US long-duration bonds."),
    ("SPY","etf","SPDR S&P 500. US large-cap equity benchmark."),
    ("QQQ","etf","Invesco Nasdaq 100. US tech-heavy equity index."),
    ("GLD","etf","SPDR Gold Shares. Physical gold price exposure."),
    ("HYG","etf","iShares High Yield Corporate Bond. Credit risk barometer."),
    ("EEM","etf","iShares MSCI Emerging Markets. EM equity benchmark."),
]

MACRO_SEED_EDGES = [
    ("Federal Reserve","Interest Rate","influences","Fed controls fed funds rate via FOMC",2.5),
    ("ECB","Interest Rate","influences","ECB sets eurozone benchmark rate",2.5),
    ("Interest Rate","Inflation","causes","Higher rates cool borrowing and inflation",2.2),
    ("Interest Rate","Bond Markets","influences","Rate rises lower bond prices inversely",2.0),
    ("Interest Rate","Equity Markets","influences","Higher rates raise discount rate, lower valuations",1.8),
    ("Interest Rate","Emerging Markets","influences","Rising US rates strengthen USD pressuring EM",1.8),
    ("Inflation","Federal Reserve","influences","High inflation forces Fed to raise rates",2.0),
    ("Inflation","Gold","correlates_with","Gold historically hedges inflation",1.5),
    ("Inflation","Oil Price","correlates_with","Energy is major CPI component",1.6),
    ("Oil Price","Inflation","causes","Oil price spikes pass through to CPI",1.8),
    ("GDP Growth","Equity Markets","correlates_with","Earnings growth drives equity valuations",1.7),
    ("GDP Growth","Unemployment Rate","influences","Okun law: growth reduces unemployment",1.6),
    ("Unemployment Rate","Federal Reserve","influences","Fed dual mandate includes max employment",1.8),
    ("Yield Curve","Recession","happened_before","Inversion preceded all post-WWII US recessions",2.0),
    ("Yield Curve Inversion","Recession","causes","Inverted curve signals tighter credit",2.2),
    ("VIX","Risk-Off","correlates_with","VIX spike signals risk-off regime",1.8),
    ("VIX","Equity Markets","correlates_with","VIX inversely correlates with equity",1.6),
    ("DXY","Gold","contradicts","Dollar strength inversely correlates with gold",1.7),
    ("DXY","Emerging Markets","influences","Strong dollar raises EM debt burden",1.8),
    ("Quantitative Easing","Bond Markets","influences","QE suppresses yields by buying bonds",2.0),
    ("Quantitative Easing","Equity Markets","influences","QE boosts asset prices via portfolio rebalancing",1.8),
    ("Gold","Risk-Off","correlates_with","Gold rallies in risk-off regimes",1.7),
    ("TLT","Interest Rate","influences","Long-duration bond price tracks rates inversely",2.0),
    ("TLT","Bond Markets","tracks","TLT tracks 20+ year US treasury market",2.2),
    ("SPY","Equity Markets","tracks","SPY replicates S&P 500 large-cap US equity",2.5),
    ("QQQ","Equity Markets","tracks","QQQ tracks Nasdaq 100 tech-heavy index",2.3),
    ("GLD","Gold","tracks","GLD tracks spot gold price",2.5),
    ("VWCE","Equity Markets","tracks","VWCE tracks FTSE All-World global equity",2.5),
    ("IWDA","Equity Markets","tracks","IWDA tracks MSCI World developed markets",2.4),
    ("EMAE","Emerging Markets","tracks","EMAE tracks MSCI Emerging Markets",2.4),
    ("EEM","Emerging Markets","tracks","EEM tracks MSCI EM equity benchmark",2.3),
    ("IBGL","Bond Markets","tracks","IBGL tracks EUR government bond market",2.3),
    ("HYG","Credit Spread","tracks","HYG tracks US high yield credit market",2.2),
    ("Credit Spread","Risk-Off","correlates_with","Credit spread widening signals risk-off",1.8),
    ("Recession","Equity Markets","influences","Recessions trigger earnings downgrades",2.0),
    ("Stagflation","Bond Markets","influences","Stagflation is worst case for bonds",1.8),
    ("Copper","GDP Growth","correlates_with","Copper demand tracks industrial activity",1.6),
]

# ── L2: Macro seed + live indicators ─────────────────────────────────────────
async def auto_populate_from_macro(indicators: List[Dict]) -> Tuple[int, int]:
    """Seed KG with financial knowledge graph + live macro values."""
    try:
        upsert_node, upsert_edge, *_ = await _kg()
    except Exception as e:
        logger.debug("L2 import: %s", e)
        return 0, 0

    tn = te = 0
    seed_ids: Dict[str, int] = {}

    for label, ntype, desc in MACRO_SEED_NODES:
        nid = await _upsert(label, ntype, desc, 0.98)
        if nid:
            seed_ids[label] = nid; tn += 1

    for sl, tl, rel, ev, w in MACRO_SEED_EDGES:
        sid = seed_ids.get(sl); tid = seed_ids.get(tl)
        if sid and tid:
            eid = await _edge(sid, tid, rel, ev, w)
            if eid:
                te += 1

    for ind in (indicators or [])[:40]:
        name = (ind.get("name") or "").strip()
        val  = ind.get("value")
        if not name or val is None:
            continue
        unit  = ind.get("unit", "")
        cntry = ind.get("country", "Global")
        prev  = ind.get("previous")
        arrow = ""
        try:
            if prev is not None:
                arrow = "↑" if float(val) > float(prev) else "↓"
        except Exception:
            pass
        desc = f"{name}: {val} {unit} {arrow} ({cntry}) — {date.today()}"
        ntype2 = "indicator" if ind.get("category") in ("economy","finance") else "concept"
        await _upsert(name[:80], ntype2, desc, 0.95)
        tn += 1

    if tn:
        logger.info("Brain L2 (macro): +%d nodes +%d edges", tn, te)
    return tn, te

# ── L3: Finance/ETF → KG ─────────────────────────────────────────────────────
ETF_META: Dict[str, Tuple[str, str, str]] = {
    "VWCE":("Vanguard FTSE All-World","Equity Markets","Global Economy"),
    "IWDA":("iShares MSCI World","Equity Markets","Developed Markets"),
    "EMAE":("iShares MSCI EM IMI","Emerging Markets","Emerging Markets"),
    "IBGL":("iShares Euro Gov Bond","Bond Markets","European Union"),
    "TLT":("iShares 20Y Treasury","Bond Markets","United States"),
    "SPY":("SPDR S&P 500","Equity Markets","United States"),
    "QQQ":("Invesco Nasdaq 100","Equity Markets","United States"),
    "GLD":("SPDR Gold Shares","Gold","Global Economy"),
    "HYG":("iShares High Yield Bond","Bond Markets","United States"),
    "EEM":("iShares MSCI EM","Emerging Markets","Emerging Markets"),
    "VWO":("Vanguard FTSE EM","Emerging Markets","Emerging Markets"),
    "IAU":("iShares Gold Trust","Gold","Global Economy"),
    "BND":("Vanguard Total Bond","Bond Markets","United States"),
    "XGLD":("Xetra Gold","Gold","Global Economy"),
}

async def auto_populate_from_finance(tickers: List[Dict]) -> Tuple[int, int]:
    """ETF/ticker nodes + asset-class relationships."""
    if not tickers:
        return 0, 0
    try:
        upsert_node, upsert_edge, *_ = await _kg()
    except Exception as e:
        logger.debug("L3 import: %s", e)
        return 0, 0

    tn = te = 0
    for t in tickers[:60]:
        ticker = (t.get("symbol") or t.get("ticker") or "").upper().strip()
        if not ticker:
            continue
        meta = ETF_META.get(ticker)
        if not meta:
            continue
        name, asset_node, region_node = meta
        price = t.get("price"); chg = t.get("change_pct")
        desc = name
        if price:
            desc += f" | {price:.2f}"
        if chg:
            desc += f" | {chg:+.2f}%"
        etf_id = await _upsert(ticker, "etf", desc, 0.99)
        if not etf_id:
            continue
        tn += 1
        a_id = await _upsert(asset_node, "concept", "", 0.99)
        if a_id:
            eid = await _edge(etf_id, a_id, "tracks", f"{ticker} tracks {asset_node}", 2.0)
            if eid: te += 1
        r_ntype = "entity" if "United" in region_node or "European" in region_node else "concept"
        r_id = await _upsert(region_node, r_ntype, "", 0.95)
        if r_id:
            eid = await _edge(etf_id, r_id, "invests_in", f"{ticker} invests in {region_node}", 1.8)
            if eid: te += 1

    if tn:
        logger.info("Brain L3 (finance): +%d nodes +%d edges", tn, te)
    return tn, te

# ── L4: Wikipedia enrichment ─────────────────────────────────────────────────
async def enrich_node_with_wikipedia(label: str, node_id: int) -> bool:
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                "https://en.wikipedia.org/api/rest_v1/page/summary/" + label.replace(" ", "_"),
                headers={"User-Agent": "WorldLens/2.0"}
            )
            if r.status_code != 200:
                return False
            extract = r.json().get("extract", "")
            if not extract or len(extract) < 30:
                return False
        desc = extract[:500]
        from supabase_client import get_pool
        pool = await get_pool()
        if pool:
            async with pool.acquire() as conn:
                await conn.execute("UPDATE kg_nodes SET description=$1 WHERE id=$2 AND description=''", desc, node_id)
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute("UPDATE kg_nodes SET description=? WHERE id=? AND description=''", (desc, node_id))
                await db.commit()
        return True
    except Exception as e:
        logger.debug("Wiki %s: %s", label, e)
        return False

async def enrich_new_nodes_batch(limit: int = 10) -> int:
    from supabase_client import get_pool
    pool = await get_pool()
    nodes = []
    try:
        if pool:
            async with pool.acquire() as conn:
                rows = await conn.fetch("SELECT id, label FROM kg_nodes WHERE description='' AND type IN ('entity','concept','etf','indicator') ORDER BY source_count DESC LIMIT $1", limit * 2)
                nodes = [dict(r) for r in rows]
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT id, label FROM kg_nodes WHERE description='' AND type IN ('entity','concept','etf','indicator') ORDER BY source_count DESC LIMIT ?", (limit * 2,)) as c:
                    nodes = [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.debug("enrich_new_nodes_batch: %s", e)
        return 0

    enriched = 0
    for node in nodes[:limit]:
        ok = await enrich_node_with_wikipedia(node["label"], node["id"])
        if ok:
            enriched += 1
        await asyncio.sleep(0.35)
    if enriched:
        logger.info("Brain L4 (Wikipedia): +%d enriched", enriched)
    return enriched

# ── L5: Gemini deep extraction ────────────────────────────────────────────────
async def nightly_deep_extraction() -> Tuple[int, int]:
    logger.info("Brain L5: nightly Gemini extraction…")
    from ai_layer import _resolve_provider
    provider, ai_key = _resolve_provider()
    if not ai_key:
        logger.info("Brain L5: no AI key — skipping")
        await enrich_new_nodes_batch(30)
        return 0, 0

    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""SELECT title, summary, ai_summary, category, country_name, severity FROM events WHERE datetime(timestamp) > datetime('now','-24 hours') AND (severity >= 7 OR category IN ('ECONOMICS','FINANCE','GEOPOLITICS','ENERGY')) ORDER BY severity DESC LIMIT 25""") as c:
                events = [dict(r) for r in await c.fetchall()]
            async with db.execute("""SELECT name, value, previous, unit, category, country FROM macro_indicators WHERE ABS(COALESCE(CAST(value AS REAL),0)-COALESCE(CAST(previous AS REAL),0))/(ABS(COALESCE(CAST(previous AS REAL),0.001))+0.001)>0.015 ORDER BY updated_at DESC LIMIT 10""") as c:
                macro_changes = [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.error("Brain L5 DB: %s", e)
        return 0, 0

    _, _, _, gemini_extract, ingest_extraction_result = await _kg()
    ug = ai_key if provider == "gemini" else ""
    ua = ai_key if provider == "claude" else ""
    tn = te = 0

    for i in range(0, min(len(events), 20), 5):
        batch = events[i:i+5]
        text = "\n\n---\n\n".join([f"[{ev.get('category','?')} | {ev.get('country_name','')} | Sev={ev.get('severity',5):.0f}]\n{ev.get('title','')}\n{(ev.get('summary') or ev.get('ai_summary') or '')[:400]}" for ev in batch])
        try:
            result = await gemini_extract(text, ug, ua)
            if result and result.get("nodes"):
                n, e = await ingest_extraction_result(result, -1)
                tn += n; te += e
        except Exception as ex:
            logger.debug("Brain L5 batch %d: %s", i, ex)
        await asyncio.sleep(1.2)

    if macro_changes:
        text = "Macro changes (last 24h):\n" + "\n".join([f"- {m['name']} ({m.get('country','?')}): {m.get('previous','?')} → {m.get('value','?')} {m.get('unit','')}" for m in macro_changes])
        try:
            result = await gemini_extract(text, ug, ua)
            if result and result.get("nodes"):
                n, e = await ingest_extraction_result(result, -1)
                tn += n; te += e
        except Exception as ex:
            logger.debug("Brain L5 macro: %s", ex)

    enriched = await enrich_new_nodes_batch(25)
    logger.info("Brain L5: +%d nodes +%d edges | %d wiki", tn, te, enriched)
    return tn, te

# ── L6: Cross-source synthesis ────────────────────────────────────────────────
async def cross_source_synthesis() -> int:
    """Connect geo ↔ finance nodes based on known exposure rules."""
    from supabase_client import get_pool
    pool = await get_pool()
    new_e = 0
    geo_etf_map = {
        "united states":["SPY","QQQ","TLT","HYG"],
        "usa":["SPY","QQQ"],"europe":["IBGL","VWCE"],
        "european union":["IBGL"],"china":["EEM","EMAE"],
        "emerging":["EEM","EMAE","VWO"],"japan":["VWCE","IWDA"],
        "global":["VWCE","IWDA"],
    }
    try:
        if pool:
            async with pool.acquire() as conn:
                fin = await conn.fetch("SELECT id, label FROM kg_nodes WHERE type IN ('etf','indicator') AND source_count >= 2 ORDER BY source_count DESC LIMIT 30")
                geo = await conn.fetch("SELECT id, label FROM kg_nodes WHERE type = 'entity' AND source_count >= 2 ORDER BY source_count DESC LIMIT 30")
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT id, label FROM kg_nodes WHERE type IN ('etf','indicator') AND source_count >= 2 ORDER BY source_count DESC LIMIT 30") as c: fin = [dict(r) for r in await c.fetchall()]
                async with db.execute("SELECT id, label FROM kg_nodes WHERE type = 'entity' AND source_count >= 2 ORDER BY source_count DESC LIMIT 30") as c: geo = [dict(r) for r in await c.fetchall()]

        fin_by_label = {(dict(n) if not isinstance(n, dict) else n)["label"].upper():(dict(n) if not isinstance(n, dict) else n)["id"] for n in fin}
        for gn in [dict(n) if not isinstance(n, dict) else n for n in geo]:
            gll = gn["label"].lower()
            for gk, etfs in geo_etf_map.items():
                if gk in gll:
                    for et in etfs:
                        eid_n = fin_by_label.get(et.upper())
                        if eid_n:
                            eid = await _edge(eid_n, gn["id"], "invests_in", f"{et} has exposure to {gn['label']}", 1.5)
                            if eid: new_e += 1
    except Exception as e:
        logger.warning("Brain L6: %s", e)
    if new_e:
        logger.info("Brain L6 (cross-source): +%d edges", new_e)
    return new_e

# ── Autonomous population (no user interaction needed) ────────────────────────
async def autonomous_brain_population() -> Tuple[int, int]:
    """Main autonomous job — reads from DB directly, no new_count dependency."""
    logger.info("Brain autonomous: cycle start")
    tn = te = 0

    try:
        # Always seed the macro knowledge graph
        n, e = await auto_populate_from_macro([])
        tn += n; te += e

        # Read events from last 6h directly from DB
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("""SELECT id, title, summary, ai_summary, category, country_name, severity, timestamp FROM events WHERE datetime(timestamp) > datetime('now','-6 hours') ORDER BY severity DESC, timestamp DESC LIMIT 80""") as c:
                events = [dict(r) for r in await c.fetchall()]
            async with db.execute("SELECT name, value, previous, unit, category, country, updated_at FROM macro_indicators ORDER BY updated_at DESC LIMIT 30") as c:
                indicators = [dict(r) for r in await c.fetchall()]

        if events:
            n, e = await auto_populate_from_events(events)
            tn += n; te += e

        if indicators:
            n, e = await auto_populate_from_macro(indicators)
            tn += n; te += e

        # Finance from cache
        try:
            from scheduler import get_finance_cache
            fin_data = get_finance_cache()
            if fin_data:
                n, e = await auto_populate_from_finance(list(fin_data.values())[:60])
                tn += n; te += e
        except Exception as fe:
            logger.debug("Brain L3 finance: %s", fe)

        # Wikipedia enrichment
        await enrich_new_nodes_batch(5)
        logger.info("Brain autonomous done: +%d nodes +%d edges", tn, te)

    except Exception as e:
        logger.error("Brain autonomous error: %s", e, exc_info=True)

    return tn, te

# ── Stats ─────────────────────────────────────────────────────────────────────
async def get_auto_pop_stats() -> Dict:
    from supabase_client import get_pool
    pool = await get_pool()
    try:
        if pool:
            async with pool.acquire() as conn:
                tn = await conn.fetchval("SELECT COUNT(*) FROM kg_nodes")
                te = await conn.fetchval("SELECT COUNT(*) FROM kg_edges")
                rn = await conn.fetchval("SELECT COUNT(*) FROM kg_nodes WHERE created_at > NOW() - INTERVAL '24 hours'")
                re2= await conn.fetchval("SELECT COUNT(*) FROM kg_edges WHERE created_at > NOW() - INTERVAL '24 hours'")
                top= await conn.fetch("SELECT label, type, source_count FROM kg_nodes ORDER BY source_count DESC LIMIT 5")
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT COUNT(*) as n FROM kg_nodes") as c: tn=(await c.fetchone())["n"]
                async with db.execute("SELECT COUNT(*) as n FROM kg_edges") as c: te=(await c.fetchone())["n"]
                async with db.execute("SELECT COUNT(*) as n FROM kg_nodes WHERE datetime(created_at)>datetime('now','-24 hours')") as c: rn=(await c.fetchone())["n"]
                async with db.execute("SELECT COUNT(*) as n FROM kg_edges WHERE datetime(created_at)>datetime('now','-24 hours')") as c: re2=(await c.fetchone())["n"]
                async with db.execute("SELECT label, type, source_count FROM kg_nodes ORDER BY source_count DESC LIMIT 5") as c: top=[dict(r) for r in await c.fetchall()]
        return {"total_nodes":tn,"total_edges":te,"nodes_24h":rn,"edges_24h":re2,"top_nodes":[dict(r) for r in top] if pool else top,"backend":"postgresql" if pool else "sqlite","cache_hits":_chits}
    except Exception as e:
        return {"error":str(e),"total_nodes":0,"total_edges":0}
