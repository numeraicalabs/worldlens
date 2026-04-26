"""
WorldLens Brain Auto-Population Engine
---------------------------------------
Automatically feeds the shared Knowledge Graph from all existing data sources:

Level 1 — Regex extraction from events (every poll cycle, zero AI cost)
Level 2 — Wikipedia enrichment for new nodes (async, zero cost)
Level 3 — Gemini deep extraction on high-severity events (nightly batch, 03:00 UTC)

Hooks:
  - after _poll_events()     → Level 1 + Level 2 async
  - after _poll_macro()      → macro indicator → KG nodes
  - after _poll_finance()    → ETF/ticker → KG nodes
  - daily cron 03:00 UTC     → Level 3 Gemini batch
"""
from __future__ import annotations
import asyncio
import json
import logging
import re
from datetime import datetime, date
from typing import Dict, List, Optional, Tuple

import httpx
import aiosqlite

from config import settings

logger = logging.getLogger(__name__)

# ── Import KG operations (lazy to avoid circular imports) ─────────────────────

async def _get_kg_ops():
    """Lazy import to avoid circular dependency at startup."""
    from routers.knowledge_graph import (
        upsert_node, upsert_edge, regex_extract,
        gemini_extract, ingest_extraction_result,
        RELATION_TYPES, NODE_TYPES,
    )
    return upsert_node, upsert_edge, regex_extract, gemini_extract, ingest_extraction_result


# ── Category → KG topic mapping ───────────────────────────────────────────────

EVENT_CATEGORY_TYPE: Dict[str, str] = {
    "ECONOMICS":    "indicator",
    "FINANCE":      "concept",
    "CONFLICT":     "event",
    "GEOPOLITICS":  "event",
    "POLITICS":     "entity",
    "ENERGY":       "commodity",
    "TECHNOLOGY":   "concept",
    "DISASTER":     "event",
    "HEALTH":       "event",
    "SECURITY":     "event",
    "HUMANITARIAN": "event",
    "MACRO":        "indicator",
    "TRADE":        "concept",
}

# Macro indicator → KG relation mappings (rule-based)
MACRO_RELATIONS: List[Tuple[str, str, str, str]] = [
    # (indicator_pattern, src_entity, tgt_entity, relation)
    ("inflation|CPI|PCE", "Inflation", "Central Bank Policy", "influences"),
    ("interest rate|fed funds|overnight", "Interest Rate", "Bond Markets", "influences"),
    ("GDP|growth", "GDP Growth", "Equity Markets", "correlates_with"),
    ("unemployment|NFP|payroll", "Employment", "Consumer Spending", "influences"),
    ("oil|crude|brent|WTI", "Oil Price", "Inflation", "causes"),
    ("yield curve|10-year|2-year", "Yield Curve", "Recession Risk", "influences"),
    ("dollar|DXY|USD", "US Dollar", "Emerging Markets", "influences"),
    ("VIX|volatility", "Market Volatility", "Risk Assets", "correlates_with"),
]

# ETF asset class → KG nodes
ETF_ASSET_NODES: Dict[str, List[Tuple[str, str]]] = {
    "Azionario": [
        ("Equity Markets", "concept"),
        ("Stock Market Risk", "concept"),
        ("Dividend Yield", "indicator"),
    ],
    "Obbligazionario": [
        ("Bond Markets", "concept"),
        ("Duration Risk", "concept"),
        ("Credit Spread", "indicator"),
    ],
    "Commodities": [
        ("Commodity Markets", "concept"),
        ("Inflation Hedge", "concept"),
    ],
}


# ── Level 1: Fast regex extraction from events ────────────────────────────────

async def auto_populate_from_events(events: List[Dict]) -> Tuple[int, int]:
    """
    Extract KG nodes/edges from freshly scraped events using regex.
    Called after every _poll_events() cycle.
    Returns (nodes_added, edges_added).
    """
    if not events:
        return 0, 0

    try:
        upsert_node, upsert_edge, regex_extract, _, _ = await _get_kg_ops()
    except Exception as e:
        logger.debug("auto_populate_from_events: import error %s", e)
        return 0, 0

    total_nodes = 0
    total_edges = 0

    # Filter to high-value events (severity >= 6 or financial categories)
    valuable = [
        e for e in events
        if (float(e.get("severity") or 0) >= 6) or
           (e.get("category", "") in ("ECONOMICS", "FINANCE", "ENERGY", "GEOPOLITICS"))
    ]
    if not valuable:
        valuable = events[:20]  # at minimum take the 20 most recent

    for ev in valuable[:50]:  # cap per cycle
        try:
            # Build rich text from event
            text_parts = [
                ev.get("title", ""),
                ev.get("summary", "") or ev.get("ai_summary", ""),
                f"Country: {ev.get('country_name', '')}",
                f"Category: {ev.get('category', '')}",
            ]
            text = ". ".join(p for p in text_parts if p and p.strip() not in (".", "Category: ", "Country: "))

            if len(text.strip()) < 20:
                continue

            # Regex extraction
            extracted = regex_extract(text)
            n_nodes = extracted.get("nodes", [])
            n_edges = extracted.get("edges", [])

            # Also add the country and category as explicit nodes
            country = ev.get("country_name", "")
            category = ev.get("category", "")
            if country and len(country) > 1:
                n_nodes.append({"label": country, "type": "entity", "confidence": 0.9})
            if category and len(category) > 2:
                n_nodes.append({"label": category.title(), "type": "concept", "confidence": 0.7})

            # Upsert nodes
            node_map: Dict[str, int] = {}
            for n in n_nodes:
                label = (n.get("label") or "").strip()
                if not label or len(label) < 2:
                    continue
                nid = await upsert_node(
                    label, n.get("type", "concept"),
                    "", float(n.get("confidence", 0.7))
                )
                if nid:
                    node_map[label.upper()] = nid
                    total_nodes += 1

            # Upsert edges
            for e in n_edges:
                src_id = node_map.get((e.get("src") or "").upper())
                tgt_id = node_map.get((e.get("tgt") or "").upper())
                if src_id and tgt_id:
                    eid = await upsert_edge(
                        src_id, tgt_id,
                        e.get("relation", "related"),
                        ev.get("title", "")[:200],
                        weight=float(ev.get("severity", 5)) / 10.0
                    )
                    if eid:
                        total_edges += 1

        except Exception as ex:
            logger.debug("auto_populate event %s: %s", ev.get("id"), ex)
            continue

    if total_nodes > 0 or total_edges > 0:
        logger.info("Brain auto-pop (events): +%d nodes +%d edges from %d events",
                    total_nodes, total_edges, len(valuable))
    return total_nodes, total_edges


# ── Level 1b: Macro indicators → KG ──────────────────────────────────────────

async def auto_populate_from_macro(indicators: List[Dict]) -> Tuple[int, int]:
    """
    Convert macro indicators into KG nodes with relationships.
    Called after every _poll_macro() cycle.
    """
    if not indicators:
        return 0, 0

    try:
        upsert_node, upsert_edge, _, _, _ = await _get_kg_ops()
    except Exception as e:
        logger.debug("auto_populate_from_macro: import error %s", e)
        return 0, 0

    total_nodes = 0
    total_edges = 0
    node_cache: Dict[str, int] = {}

    async def get_or_create(label: str, ntype: str, desc: str = "") -> Optional[int]:
        key = label.upper()
        if key in node_cache:
            return node_cache[key]
        nid = await upsert_node(label, ntype, desc, 0.95)
        if nid:
            node_cache[key] = nid
        return nid

    # Ensure base macro entities exist
    base_nodes = [
        ("Federal Reserve", "entity", "US central bank, controls monetary policy"),
        ("European Central Bank", "entity", "ECB, eurozone monetary policy"),
        ("US Dollar", "entity", "Reserve currency, DXY index"),
        ("Bond Markets", "concept", "Fixed income markets globally"),
        ("Equity Markets", "concept", "Global stock markets"),
        ("Inflation", "indicator", "Rate of price increase over time"),
        ("Interest Rate", "indicator", "Cost of borrowing money"),
        ("GDP Growth", "indicator", "Gross Domestic Product annual growth"),
        ("Employment", "indicator", "Labor market health indicator"),
        ("Oil Price", "commodity", "Crude oil price, key inflation driver"),
        ("Gold", "commodity", "Safe haven asset, inflation hedge"),
        ("Credit Spread", "indicator", "Risk premium over risk-free rate"),
        ("Yield Curve", "indicator", "Term structure of interest rates"),
        ("Market Volatility", "indicator", "VIX and realized vol measures"),
        ("Consumer Confidence", "indicator", "Household spending expectations"),
        ("Fiscal Policy", "policy", "Government spending and taxation"),
        ("Monetary Policy", "policy", "Central bank interest rate decisions"),
        ("Quantitative Easing", "policy", "Central bank asset purchase program"),
        ("Emerging Markets", "concept", "Developing economy financial markets"),
        ("Risk Assets", "concept", "High risk, high return assets (equities, HY)"),
    ]

    for label, ntype, desc in base_nodes:
        nid = await get_or_create(label, ntype, desc)
        if nid:
            total_nodes += 1

    # Add rule-based macro relationships
    for pattern, src_label, tgt_label, relation in MACRO_RELATIONS:
        matching = any(re.search(pattern, ind.get("name", ""), re.I) for ind in indicators)
        if not matching:
            continue
        src_id = await get_or_create(src_label, "indicator")
        tgt_id = await get_or_create(tgt_label, "concept")
        if src_id and tgt_id:
            evidence = f"Macro relationship: {src_label} {relation.replace('_',' ')} {tgt_label}"
            eid = await upsert_edge(src_id, tgt_id, relation, evidence, weight=1.5)
            if eid:
                total_edges += 1

    # Add actual indicator values as node descriptions
    for ind in indicators[:30]:
        name = (ind.get("name") or "").strip()
        value = ind.get("value")
        if not name or value is None:
            continue
        unit = ind.get("unit", "")
        country = ind.get("country", "Global")
        desc = f"{name}: {value} {unit} ({country}) — updated {date.today().isoformat()}"
        label = name[:80]
        ntype = "indicator" if ind.get("category") in ("economy", "finance") else "concept"
        nid = await get_or_create(label, ntype, desc)
        if nid:
            total_nodes += 1

    logger.info("Brain auto-pop (macro): +%d nodes +%d edges from %d indicators",
                total_nodes, total_edges, len(indicators))
    return total_nodes, total_edges


# ── Level 1c: Finance/ETF data → KG ──────────────────────────────────────────

async def auto_populate_from_finance(tickers: List[Dict]) -> Tuple[int, int]:
    """
    Map ETF/ticker data to KG nodes and known relationships.
    Called after every _poll_finance() cycle.
    """
    if not tickers:
        return 0, 0

    try:
        upsert_node, upsert_edge, _, _, _ = await _get_kg_ops()
    except Exception as e:
        logger.debug("auto_populate_from_finance: import error %s", e)
        return 0, 0

    total_nodes = 0
    total_edges = 0

    # ETF database (from etf_tracker router)
    ETF_META: Dict[str, Dict] = {
        "VWCE": {"name": "Vanguard FTSE All-World", "asset": "Azionario", "region": "Globale"},
        "IWDA": {"name": "iShares Core MSCI World", "asset": "Azionario", "region": "Globale"},
        "EMAE": {"name": "iShares Core MSCI EM IMI", "asset": "Azionario", "region": "Emergenti"},
        "IBGL": {"name": "iShares Euro Gov Bond", "asset": "Obbligazionario", "region": "Europa"},
        "XGLD": {"name": "Xetra-Gold", "asset": "Commodities", "region": "Globale"},
        "SPY":  {"name": "SPDR S&P 500", "asset": "Azionario", "region": "USA"},
        "QQQ":  {"name": "Invesco Nasdaq 100", "asset": "Azionario", "region": "USA"},
        "GLD":  {"name": "SPDR Gold Shares", "asset": "Commodities", "region": "Globale"},
        "TLT":  {"name": "iShares 20+ Year Treasury", "asset": "Obbligazionario", "region": "USA"},
        "VWO":  {"name": "Vanguard FTSE EM", "asset": "Azionario", "region": "Emergenti"},
    }

    for t in tickers[:50]:
        ticker = (t.get("symbol") or t.get("ticker") or "").upper().strip()
        if not ticker:
            continue

        meta = ETF_META.get(ticker)
        if not meta:
            continue  # only process known ETFs to keep quality high

        desc = f"{meta['name']} — {meta['asset']} {meta['region']}"
        if t.get("price"):
            desc += f" | Price: {t['price']:.2f}"

        etf_id = await upsert_node(ticker, "etf", desc, 0.98)
        if etf_id:
            total_nodes += 1

            # Add asset class relationships
            asset_nodes = ETF_ASSET_NODES.get(meta["asset"], [])
            for concept_label, concept_type in asset_nodes:
                concept_id = await upsert_node(concept_label, concept_type, "", 0.9)
                if concept_id:
                    evidence = f"{ticker} ({meta['name']}) is a {meta['asset']} ETF"
                    eid = await upsert_edge(etf_id, concept_id, "tracks", evidence, weight=1.8)
                    if eid:
                        total_edges += 1

            # Region → ETF exposure
            region_map = {
                "USA":       ("United States", "entity"),
                "Globale":   ("Global Economy", "concept"),
                "Emergenti": ("Emerging Markets", "concept"),
                "Europa":    ("European Union", "entity"),
            }
            region_entry = region_map.get(meta.get("region", ""))
            if region_entry:
                region_id = await upsert_node(region_entry[0], region_entry[1], "", 0.9)
                if region_id:
                    eid = await upsert_edge(
                        etf_id, region_id, "invests_in",
                        f"{ticker} invests in {region_entry[0]}", weight=1.5
                    )
                    if eid:
                        total_edges += 1

    if total_nodes > 0:
        logger.info("Brain auto-pop (finance): +%d nodes +%d edges from %d tickers",
                    total_nodes, total_edges, len(tickers))
    return total_nodes, total_edges


# ── Level 2: Wikipedia enrichment ────────────────────────────────────────────

async def enrich_node_with_wikipedia(label: str, node_id: int):
    """
    Fetch Wikipedia summary for a node and update its description.
    Free, no auth, rate-limited naturally by being called once per new node.
    """
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                "https://en.wikipedia.org/api/rest_v1/page/summary/" +
                label.replace(" ", "_"),
                headers={"User-Agent": "WorldLens/1.0 (research tool)"}
            )
            if r.status_code != 200:
                return

            data = r.json()
            extract = data.get("extract", "")
            if not extract or len(extract) < 30:
                return

            desc = extract[:500]

            # Update node description in KG
            from supabase_client import get_pool
            pool = await get_pool()
            if pool:
                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE kg_nodes SET description=$1 WHERE id=$2 AND description=''",
                        desc, node_id
                    )
            else:
                async with aiosqlite.connect(settings.db_path) as db:
                    await db.execute(
                        "UPDATE kg_nodes SET description=? WHERE id=? AND description=''",
                        (desc, node_id)
                    )
                    await db.commit()

            logger.debug("Wikipedia enriched node %d (%s): %d chars", node_id, label, len(desc))

    except Exception as e:
        logger.debug("Wikipedia enrich %s: %s", label, e)


async def enrich_new_nodes_batch(limit: int = 20):
    """
    Find nodes with empty descriptions and enrich them via Wikipedia.
    Runs as part of the nightly batch.
    """
    from supabase_client import get_pool
    pool = await get_pool()

    nodes_to_enrich = []
    if pool:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id, label, type FROM kg_nodes WHERE description='' "
                "AND type IN ('entity','concept','etf','indicator') "
                "ORDER BY source_count DESC LIMIT $1",
                limit
            )
            nodes_to_enrich = [{"id": r["id"], "label": r["label"], "type": r["type"]} for r in rows]
    else:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id, label, type FROM kg_nodes WHERE description='' "
                "AND type IN ('entity','concept','etf','indicator') "
                "ORDER BY source_count DESC LIMIT ?",
                (limit,)
            ) as c:
                nodes_to_enrich = [dict(r) for r in await c.fetchall()]

    enriched = 0
    for node in nodes_to_enrich:
        await enrich_node_with_wikipedia(node["label"], node["id"])
        enriched += 1
        await asyncio.sleep(0.3)  # gentle rate limiting

    if enriched > 0:
        logger.info("Wikipedia enrichment: %d nodes enriched", enriched)
    return enriched


# ── Level 3: Gemini deep extraction (nightly) ─────────────────────────────────

async def nightly_deep_extraction():
    """
    Nightly Gemini-powered deep extraction on high-severity events (last 24h).
    Finds causal relationships and complex multi-hop connections that regex misses.
    Runs at 03:00 UTC to avoid API quota peaks.
    """
    logger.info("Nightly brain extraction starting…")

    try:
        # Get high-severity events from last 24h
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT title, summary, ai_summary, category, country_name, severity
                   FROM events
                   WHERE datetime(timestamp) > datetime('now','-24 hours')
                   AND (severity >= 7 OR category IN ('ECONOMICS','FINANCE','GEOPOLITICS','ENERGY'))
                   ORDER BY severity DESC
                   LIMIT 30""",
            ) as cur:
                events = [dict(r) for r in await cur.fetchall()]

            # Get macro indicators with significant changes
            async with db.execute(
                """SELECT name, value, previous, unit, category, country
                   FROM macro_indicators
                   WHERE ABS(CAST(value AS REAL) - CAST(previous AS REAL)) /
                         (ABS(CAST(previous AS REAL)) + 0.001) > 0.02
                   ORDER BY updated_at DESC LIMIT 15"""
            ) as cur:
                macro_changes = [dict(r) for r in await cur.fetchall()]

    except Exception as e:
        logger.error("nightly_deep_extraction: DB query error %s", e)
        return

    if not events and not macro_changes:
        logger.info("Nightly extraction: no significant events/changes found")
        return

    # Get a system-level AI key (admin key) for nightly batch
    from ai_layer import _resolve_provider
    provider, ai_key = _resolve_provider()
    if not ai_key:
        logger.warning("Nightly extraction: no AI key available — skipping Gemini phase")
        # Still run Wikipedia enrichment
        await enrich_new_nodes_batch(30)
        return

    try:
        _, _, _, gemini_extract, ingest_extraction_result = await _get_kg_ops()
    except Exception as e:
        logger.warning("nightly_deep_extraction: import error %s", e)
        return

    total_nodes = 0
    total_edges = 0

    # Process events in batches of 5 (to stay within token limits)
    batch_size = 5
    for i in range(0, min(len(events), 20), batch_size):
        batch = events[i:i+batch_size]

        # Build rich context text
        text_parts = []
        for ev in batch:
            t = ev.get("title", "")
            s = ev.get("summary") or ev.get("ai_summary") or ""
            cat = ev.get("category", "")
            country = ev.get("country_name", "")
            sev = ev.get("severity", 5)
            text_parts.append(
                f"[{cat} | {country} | Severity {sev}]\n{t}\n{s[:400]}"
            )

        combined_text = "\n\n---\n\n".join(text_parts)

        try:
            gemini_key = ai_key if provider == "gemini" else ""
            claude_key = ai_key if provider == "claude" else ""
            result = await gemini_extract(combined_text, gemini_key, claude_key)
            if result and result.get("nodes"):
                # Create a fake upload_id for tracking (use -1 for system)
                n, e = await ingest_extraction_result(result, -1)
                total_nodes += n
                total_edges += e
        except Exception as ex:
            logger.warning("nightly batch %d error: %s", i, ex)
            continue

        await asyncio.sleep(1.0)  # rate limiting between batches

    # Process macro changes
    if macro_changes:
        macro_text = "Macro indicator changes in the last 24h:\n"
        for m in macro_changes:
            prev = m.get("previous", "?")
            curr = m.get("value", "?")
            change_dir = "rose" if str(curr) > str(prev) else "fell"
            macro_text += f"- {m['name']} ({m['country']}): {change_dir} from {prev} to {curr} {m.get('unit','')}\n"

        try:
            gemini_key = ai_key if provider == "gemini" else ""
            claude_key = ai_key if provider == "claude" else ""
            result = await gemini_extract(macro_text, gemini_key, claude_key)
            if result and result.get("nodes"):
                n, e = await ingest_extraction_result(result, -1)
                total_nodes += n
                total_edges += e
        except Exception as ex:
            logger.warning("nightly macro extraction error: %s", ex)

    # Wikipedia enrichment for new nodes
    enriched = await enrich_new_nodes_batch(25)

    # Layer 3: explain top KG edges
    try:
        from brain_enhance import enrich_kg_edges_batch
        explained = await enrich_kg_edges_batch(limit=15)
    except Exception as ex:
        logger.warning("nightly edge explanation: %s", ex)
        explained = 0

    logger.info(
        "Nightly brain extraction complete: +%d nodes +%d edges | %d Wikipedia | %d edge explanations",
        total_nodes, total_edges, enriched, explained
    )


# ── Stats for admin dashboard ─────────────────────────────────────────────────

async def get_auto_pop_stats() -> Dict:
    """Return auto-population statistics for admin panel."""
    from supabase_client import get_pool
    pool = await get_pool()

    try:
        if pool:
            async with pool.acquire() as conn:
                total_nodes  = await conn.fetchval("SELECT COUNT(*) FROM kg_nodes")
                total_edges  = await conn.fetchval("SELECT COUNT(*) FROM kg_edges")
                recent_nodes = await conn.fetchval(
                    "SELECT COUNT(*) FROM kg_nodes WHERE created_at > NOW() - INTERVAL '24 hours'"
                )
                recent_edges = await conn.fetchval(
                    "SELECT COUNT(*) FROM kg_edges WHERE created_at > NOW() - INTERVAL '24 hours'"
                )
                top = await conn.fetch(
                    "SELECT label, type, source_count FROM kg_nodes ORDER BY source_count DESC LIMIT 5"
                )
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT COUNT(*) as n FROM kg_nodes") as c: total_nodes = (await c.fetchone())["n"]
                async with db.execute("SELECT COUNT(*) as n FROM kg_edges") as c: total_edges = (await c.fetchone())["n"]
                async with db.execute("SELECT COUNT(*) as n FROM kg_nodes WHERE datetime(created_at) > datetime('now','-24 hours')") as c: recent_nodes = (await c.fetchone())["n"]
                async with db.execute("SELECT COUNT(*) as n FROM kg_edges WHERE datetime(created_at) > datetime('now','-24 hours')") as c: recent_edges = (await c.fetchone())["n"]
                async with db.execute("SELECT label, type, source_count FROM kg_nodes ORDER BY source_count DESC LIMIT 5") as c: top = [dict(r) for r in await c.fetchall()]

        return {
            "total_nodes":    total_nodes,
            "total_edges":    total_edges,
            "nodes_24h":      recent_nodes,
            "edges_24h":      recent_edges,
            "top_nodes":      [dict(r) for r in top] if pool else top,
            "backend":        "postgresql" if pool else "sqlite_fallback",
        }
    except Exception as e:
        logger.warning("get_auto_pop_stats: %s", e)
        return {"total_nodes": 0, "total_edges": 0, "nodes_24h": 0, "edges_24h": 0, "top_nodes": [], "backend": "error"}
