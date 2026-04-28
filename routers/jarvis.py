"""
WorldLens Jarvis — KG Traversal Engine
=======================================
Multi-hop knowledge graph traversal that builds rich structured context
for AI report generation. Replaces FTS5 text chunks with graph paths.

Core concept:
  User clicks "Federal Reserve" node
  → traverse 2-3 hops: Fed → Interest Rate → Bond Markets → TLT
  → collect node descriptions + edge evidence along each path
  → pass structured graph context to Gemini (2000+ tokens output)
  → get rich narrative analysis, not 2-3 words
"""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime, date
from typing import Dict, List, Optional, Set, Tuple, Any

import aiosqlite
from fastapi import APIRouter, Depends, Body, HTTPException
from auth import require_user
from config import settings
from ai_layer import _call_claude, _get_user_ai_keys

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/jarvis", tags=["jarvis"])

# ── KG Traversal ──────────────────────────────────────────────────────────────

async def traverse_kg(
    start_label: str,
    max_hops: int = 3,
    max_nodes: int = 25,
) -> Dict[str, Any]:
    """
    Multi-hop BFS traversal from a starting node.
    Returns structured graph context: nodes, paths, evidence.
    """
    from supabase_client import get_pool
    pool = await get_pool()

    visited: Set[int]         = set()
    nodes:   Dict[int, Dict]  = {}
    edges:   List[Dict]       = []
    paths:   List[List[Dict]] = []  # each path = list of {node, edge} hops

    # Find starting node
    start_node = await _find_node(pool, start_label)
    if not start_node:
        return {"nodes": [], "edges": [], "paths": [], "center": start_label, "found": False}

    start_id = start_node["id"]
    nodes[start_id] = start_node
    visited.add(start_id)

    # BFS queue: (node_id, current_path, hop_count)
    queue = [(start_id, [{"node": start_node, "edge": None}], 0)]

    while queue and len(nodes) < max_nodes:
        node_id, current_path, hop = queue.pop(0)
        if hop >= max_hops:
            continue

        # Get neighbors
        neighbors = await _get_neighbors(pool, node_id)
        for neighbor, edge in neighbors:
            if neighbor["id"] in visited:
                continue
            if len(nodes) >= max_nodes:
                break

            visited.add(neighbor["id"])
            nodes[neighbor["id"]] = neighbor
            edges.append(edge)

            new_path = current_path + [{"node": neighbor, "edge": edge}]
            paths.append(new_path)
            queue.append((neighbor["id"], new_path, hop + 1))

    return {
        "center":     start_label,
        "center_node": start_node,
        "found":      True,
        "nodes":      list(nodes.values()),
        "edges":      edges,
        "paths":      paths,
        "hop_count":  max_hops,
    }


async def _find_node(pool, label: str) -> Optional[Dict]:
    """Find node by exact label or fuzzy match."""
    try:
        if pool:
            async with pool.acquire() as conn:
                # Exact match first
                row = await conn.fetchrow(
                    "SELECT * FROM kg_nodes WHERE LOWER(label) = LOWER($1)", label
                )
                if not row:
                    # Fuzzy match
                    row = await conn.fetchrow(
                        "SELECT * FROM kg_nodes WHERE label ILIKE $1 "
                        "ORDER BY source_count DESC LIMIT 1",
                        f"%{label}%"
                    )
                return dict(row) if row else None
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT * FROM kg_nodes WHERE LOWER(label)=LOWER(?) LIMIT 1", (label,)
                ) as c:
                    row = await c.fetchone()
                if not row:
                    async with db.execute(
                        "SELECT * FROM kg_nodes WHERE label LIKE ? ORDER BY source_count DESC LIMIT 1",
                        (f"%{label}%",)
                    ) as c:
                        row = await c.fetchone()
                return dict(row) if row else None
    except Exception as e:
        logger.warning("_find_node %s: %s", label, e)
        return None


async def _get_neighbors(pool, node_id: int) -> List[Tuple[Dict, Dict]]:
    """Get all neighbors (both directions) with edge data."""
    results = []
    try:
        if pool:
            async with pool.acquire() as conn:
                # Split into two queries to avoid asyncpg CASE parameter type inference issues
                rows_out = await conn.fetch(
                    """SELECT e.id as eid, e.relation, COALESCE(e.weight,1.0) as weight,
                              COALESCE(e.evidence_text,'') as evidence_text,
                              n.id, n.label, n.type,
                              COALESCE(n.description,'') as description,
                              COALESCE(n.source_count,1) as source_count,
                              'out' as direction, e.src_id, e.tgt_id
                       FROM kg_edges e JOIN kg_nodes n ON e.tgt_id = n.id
                       WHERE e.src_id = $1 ORDER BY e.weight DESC LIMIT 12""",
                    node_id
                )
                rows_in = await conn.fetch(
                    """SELECT e.id as eid, e.relation, COALESCE(e.weight,1.0) as weight,
                              COALESCE(e.evidence_text,'') as evidence_text,
                              n.id, n.label, n.type,
                              COALESCE(n.description,'') as description,
                              COALESCE(n.source_count,1) as source_count,
                              'in' as direction, e.src_id, e.tgt_id
                       FROM kg_edges e JOIN kg_nodes n ON e.src_id = n.id
                       WHERE e.tgt_id = $1 ORDER BY e.weight DESC LIMIT 12""",
                    node_id
                )
                for r in list(rows_out) + list(rows_in):
                    d = dict(r)
                    node = {"id": d["id"], "label": d["label"], "type": d["type"],
                            "description": d["description"], "source_count": d["source_count"]}
                    edge = {"id": d["eid"], "relation": d["relation"], "weight": float(d["weight"]),
                            "evidence": d["evidence_text"], "direction": d["direction"],
                            "src_id": d["src_id"], "tgt_id": d["tgt_id"]}
                    results.append((node, edge))
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                # Outgoing edges
                async with db.execute(
                    """SELECT e.id as eid, e.src_id, e.tgt_id, e.relation,
                              COALESCE(e.weight,1.0) as weight,
                              COALESCE(e.evidence_text,'') as evidence_text,
                              n.id, n.label, n.type,
                              COALESCE(n.description,'') as description,
                              COALESCE(n.source_count,1) as source_count
                       FROM kg_edges e JOIN kg_nodes n ON e.tgt_id=n.id
                       WHERE e.src_id=? ORDER BY e.weight DESC LIMIT 12""",
                    (node_id,)
                ) as c:
                    for r in await c.fetchall():
                        d = dict(r)
                        node = {"id": d["id"], "label": d["label"], "type": d["type"],
                                "description": d["description"], "source_count": d["source_count"]}
                        edge = {"id": d["eid"], "relation": d["relation"], "weight": float(d["weight"]),
                                "evidence": d["evidence_text"], "direction": "out",
                                "src_id": d["src_id"], "tgt_id": d["tgt_id"]}
                        results.append((node, edge))
                # Incoming edges
                async with db.execute(
                    """SELECT e.id as eid, e.src_id, e.tgt_id, e.relation,
                              COALESCE(e.weight,1.0) as weight,
                              COALESCE(e.evidence_text,'') as evidence_text,
                              n.id, n.label, n.type,
                              COALESCE(n.description,'') as description,
                              COALESCE(n.source_count,1) as source_count
                       FROM kg_edges e JOIN kg_nodes n ON e.src_id=n.id
                       WHERE e.tgt_id=? ORDER BY e.weight DESC LIMIT 12""",
                    (node_id,)
                ) as c:
                    for r in await c.fetchall():
                        d = dict(r)
                        node = {"id": d["id"], "label": d["label"], "type": d["type"],
                                "description": d["description"], "source_count": d["source_count"]}
                        edge = {"id": d["eid"], "relation": d["relation"], "weight": float(d["weight"]),
                                "evidence": d["evidence_text"], "direction": "in",
                                "src_id": d["src_id"], "tgt_id": d["tgt_id"]}
                        results.append((node, edge))
    except Exception as e:
        logger.warning("_get_neighbors node_id=%s: %s", node_id, e)
    return results


# ── Graph context builder ─────────────────────────────────────────────────────

def build_graph_context(traversal: Dict) -> str:
    """
    Convert KG traversal result into structured text for Gemini.
    Much richer than FTS5 chunks — includes paths, weights, evidence.
    """
    if not traversal.get("found"):
        return f"Node '{traversal['center']}' not found in knowledge graph."

    center = traversal["center_node"]
    nodes  = traversal["nodes"]
    edges  = traversal["edges"]

    lines = [
        f"=== KNOWLEDGE GRAPH: {center['label']} ===",
        f"Type: {center['type']}",
        f"Description: {center.get('description', 'No description')}",
        f"Referenced by {center.get('source_count', 0)} sources in the knowledge base.",
        "",
        f"=== DIRECT RELATIONSHIPS ({len(edges)} connections) ===",
    ]

    # Group edges by node
    node_map = {n["id"]: n for n in nodes}
    edge_map: Dict[int, List] = {}
    for e in edges:
        src_id = e.get("src_id", 0)
        tgt_id = e.get("tgt_id", 0)
        other_id = tgt_id if src_id == center["id"] else src_id
        if other_id not in edge_map:
            edge_map[other_id] = []
        edge_map[other_id].append(e)

    # Sorted by weight descending
    sorted_neighbors = sorted(edge_map.items(),
                              key=lambda x: max(e.get("weight", 0) for e in x[1]),
                              reverse=True)

    for other_id, edge_list in sorted_neighbors[:20]:
        other = node_map.get(other_id)
        if not other:
            continue
        for e in edge_list:
            rel = e.get("relation", "related")
            w   = e.get("weight", 1.0)
            ev  = e.get("evidence", "")
            direction = e.get("direction", "out")

            if direction == "out":
                arrow = f"{center['label']} --[{rel}]--> {other['label']}"
            else:
                arrow = f"{other['label']} --[{rel}]--> {center['label']}"

            lines.append(f"• {arrow} (strength: {w:.1f})")
            if ev and len(ev) > 10:
                lines.append(f"  Evidence: {ev[:200]}")
            if other.get("description"):
                lines.append(f"  Context: {other['description'][:150]}")

    # Multi-hop paths
    paths = traversal.get("paths", [])
    if paths:
        lines.extend(["", "=== MULTI-HOP PATHS (causal chains) ==="])
        seen_paths = set()
        for path in sorted(paths, key=lambda p: sum(h.get("edge", {}).get("weight", 0) or 0 for h in p), reverse=True)[:8]:
            if len(path) < 2:
                continue
            path_str = " → ".join([
                f"{h['node']['label']}({h['edge']['relation'] if h.get('edge') else 'START'})"
                for h in path
            ])
            if path_str not in seen_paths:
                seen_paths.add(path_str)
                # Format nicely
                labels = [h["node"]["label"] for h in path]
                rels   = [h["edge"]["relation"] if h.get("edge") else "" for h in path[1:]]
                path_readable = labels[0]
                for i, rel in enumerate(rels):
                    path_readable += f" --[{rel}]--> {labels[i+1]}"
                lines.append(f"• {path_readable}")

    return "\n".join(lines)


# ── Jarvis prompts ────────────────────────────────────────────────────────────

JARVIS_SYSTEM = """You are Jarvis, the AI financial intelligence analyst for WorldLens.
You have access to a structured financial knowledge graph with nodes (entities, indicators, ETFs, concepts) and edges (relationships with evidence and strength scores).

Your role:
- Provide deep, specific, actionable financial analysis
- Always connect macro → market → portfolio implications
- Use the graph relationships to explain WHY things are connected
- Give concrete investment implications (which ETFs are affected, how, why)
- Be direct and professional — no disclaimers, no hedging
- Write in the SAME LANGUAGE as the user's question

Output format: rich markdown with headers, bullets, tables where useful.
Minimum length: 400 words for node analysis, 600+ for portfolio/report requests.
DO NOT truncate. Complete your full analysis."""

JARVIS_NODE_PROMPT = """
{graph_context}

=== LIVE DATA ===
{live_context}

=== USER REQUEST ===
Provide a comprehensive financial intelligence analysis of: **{node_label}**

Cover:
1. **What it is** — definition, role in financial system
2. **Current status** — based on live data above
3. **Key relationships** — explain the most important connections in the graph
4. **Investment implications** — which ETFs/assets are most affected, how, why
5. **Risk factors** — what could change this picture
6. **Actionable signals** — what should an investor watch or do

Use the knowledge graph paths to build your reasoning chain.
"""

JARVIS_PORTFOLIO_PROMPT = """
{graph_context}

=== LIVE MACRO DATA ===
{live_context}

=== PORTFOLIO TO ANALYSE ===
{portfolio}

Provide a complete portfolio stress test and intelligence briefing:

1. **Portfolio exposure map** — for each holding, trace 2-3 hops in the KG to identify macro exposures
2. **Current risk factors** — which relationships in the graph are currently under stress
3. **Correlation matrix** — how are the holdings related to each other via the KG
4. **Scenario analysis** — what happens to the portfolio under: rate hike, recession, dollar surge, oil spike
5. **Rebalancing signals** — concrete recommendations based on current KG state
6. **Top 3 actions** — specific, actionable steps for this portfolio today
"""


# ── Live context builder ──────────────────────────────────────────────────────

async def get_live_context(topic: str = "") -> str:
    """Fetch relevant live data from DB to enrich Jarvis responses."""
    lines = []
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row

            # Recent high-severity events
            async with db.execute(
                """SELECT title, category, country_name, severity, timestamp
                   FROM events
                   WHERE datetime(timestamp) > datetime('now','-48 hours')
                   AND severity >= 6
                   ORDER BY severity DESC LIMIT 8"""
            ) as c:
                events = [dict(r) for r in await c.fetchall()]

            # Current macro indicators
            async with db.execute(
                "SELECT name, value, previous, unit, country FROM macro_indicators "
                "ORDER BY updated_at DESC LIMIT 15"
            ) as c:
                macro = [dict(r) for r in await c.fetchall()]

        if events:
            lines.append("HIGH-SEVERITY EVENTS (last 48h):")
            for ev in events:
                lines.append(f"  [{ev.get('severity',5):.0f}/10] [{ev.get('category','')}] "
                             f"{ev.get('title','')} ({ev.get('country_name','')})")

        if macro:
            lines.append("\nMACRO INDICATORS:")
            for m in macro:
                prev = m.get("previous")
                val  = m.get("value")
                arrow = ""
                try:
                    if prev and val:
                        arrow = "↑" if float(val) > float(prev) else "↓"
                except Exception:
                    pass
                lines.append(f"  {m['name']} ({m.get('country','?')}): {val} {m.get('unit','')} {arrow}")

    except Exception as e:
        logger.debug("get_live_context: %s", e)
        lines.append("(live data unavailable)")

    return "\n".join(lines) if lines else "No live data available."


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

@router.post("/analyze-node")
async def analyze_node(payload: dict = Body(...), user=Depends(require_user)):
    """
    Jarvis node analysis — click on any KG node to get deep AI analysis.
    Uses multi-hop traversal to build rich context.
    """
    node_label = (payload.get("node") or "").strip()
    if not node_label:
        raise HTTPException(400, "node label required")

    ug, ua = await _get_user_ai_keys(user["id"])
    if not ug and not ua:
        raise HTTPException(402, "Gemini API key required. Add it in Profile → La tua chiave AI")

    # Traverse KG
    traversal    = await traverse_kg(node_label, max_hops=3, max_nodes=25)
    graph_ctx    = build_graph_context(traversal)
    live_ctx     = await get_live_context(node_label)

    prompt = JARVIS_NODE_PROMPT.format(
        graph_context=graph_ctx,
        live_context=live_ctx,
        node_label=node_label,
    )

    result = await _call_claude(
        prompt,
        system=JARVIS_SYSTEM,
        max_tokens=2500,  # Full analysis
        user_gemini_key=ug,
        user_anthropic_key=ua,
    )

    if not result:
        # Structured fallback without AI
        result = _build_fallback_analysis(traversal, live_ctx)

    # ── Self-improvement: store analysis as brain entry ──────────────────────
    try:
        from brain_entries_engine import store_analysis_as_entry
        asyncio.create_task(store_analysis_as_entry(
            query=node_label,
            analysis=result,
            source_type="jarvis",
            user_id=user.get("id", 1),
        ))
    except Exception:
        pass

    return {
        "node":         node_label,
        "analysis":     result,
        "graph":        {
            "nodes": len(traversal.get("nodes", [])),
            "edges": len(traversal.get("edges", [])),
            "paths": len(traversal.get("paths", [])),
        },
        "found":        traversal.get("found", False),
    }


@router.post("/analyze-portfolio")
async def analyze_portfolio(payload: dict = Body(...), user=Depends(require_user)):
    """
    Portfolio stress test using KG traversal.
    Each holding is traversed in the KG to map its macro exposures.
    """
    holdings = payload.get("holdings", [])  # [{ticker, weight}]
    if not holdings:
        raise HTTPException(400, "holdings required")

    ug, ua = await _get_user_ai_keys(user["id"])
    if not ug and not ua:
        raise HTTPException(402, "Gemini API key required")

    # Traverse KG for each holding
    all_contexts = []
    for h in holdings[:8]:
        ticker = h.get("ticker", "")
        weight = h.get("weight", 0)
        if not ticker:
            continue
        traversal = await traverse_kg(ticker, max_hops=2, max_nodes=15)
        ctx       = build_graph_context(traversal)
        all_contexts.append(f"=== {ticker} ({weight}%) ===\n{ctx}")

    graph_ctx  = "\n\n".join(all_contexts)
    live_ctx   = await get_live_context()
    port_str   = "\n".join([f"  {h['ticker']}: {h['weight']}%" for h in holdings])

    prompt = JARVIS_PORTFOLIO_PROMPT.format(
        graph_context=graph_ctx,
        live_context=live_ctx,
        portfolio=port_str,
    )

    result = await _call_claude(
        prompt,
        system=JARVIS_SYSTEM,
        max_tokens=3000,
        user_gemini_key=ug,
        user_anthropic_key=ua,
    )

    if not result:
        result = f"**Portfolio Analysis — {date.today()}**\n\nHoldings analyzed: {port_str}\n\n{live_ctx}"

    return {"analysis": result, "holdings": holdings}


@router.post("/traverse")
async def traverse_endpoint(payload: dict = Body(...), user=Depends(require_user)):
    """Raw KG traversal — returns graph data for visualization."""
    node  = (payload.get("node") or "").strip()
    hops  = min(int(payload.get("hops", 2)), 3)
    limit = min(int(payload.get("limit", 30)), 50)
    if not node:
        raise HTTPException(400, "node required")

    traversal = await traverse_kg(node, max_hops=hops, max_nodes=limit)
    return {
        "center":  node,
        "found":   traversal.get("found", False),
        "nodes":   traversal.get("nodes", []),
        "edges":   traversal.get("edges", []),
        "paths":   [[{"label": h["node"]["label"], "type": h["node"]["type"],
                      "relation": h["edge"]["relation"] if h.get("edge") else "start"}
                     for h in path] for path in traversal.get("paths", [])[:10]],
    }


@router.get("/graph-stats")
async def graph_stats(user=Depends(require_user)):
    """KG statistics for dashboard."""
    from supabase_client import get_pool
    pool = await get_pool()
    try:
        if pool:
            async with pool.acquire() as conn:
                nodes = await conn.fetchval("SELECT COUNT(*) FROM kg_nodes")
                edges = await conn.fetchval("SELECT COUNT(*) FROM kg_edges")
                top   = await conn.fetch("SELECT label, type, source_count FROM kg_nodes ORDER BY source_count DESC LIMIT 10")
                by_type = await conn.fetch("SELECT type, COUNT(*) as n FROM kg_nodes GROUP BY type ORDER BY n DESC")
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT COUNT(*) as n FROM kg_nodes") as c: nodes = (await c.fetchone())["n"]
                async with db.execute("SELECT COUNT(*) as n FROM kg_edges") as c: edges = (await c.fetchone())["n"]
                async with db.execute("SELECT label, type, source_count FROM kg_nodes ORDER BY source_count DESC LIMIT 10") as c:
                    top = [dict(r) for r in await c.fetchall()]
                async with db.execute("SELECT type, COUNT(*) as n FROM kg_nodes GROUP BY type ORDER BY n DESC") as c:
                    by_type = [dict(r) for r in await c.fetchall()]
        return {
            "total_nodes":   nodes,
            "total_edges":   edges,
            "top_nodes":     [dict(r) for r in top] if pool else top,
            "by_type":       [dict(r) for r in by_type] if pool else by_type,
        }
    except Exception as e:
        return {"error": str(e), "total_nodes": 0, "total_edges": 0}


def _build_fallback_analysis(traversal: Dict, live_ctx: str) -> str:
    """Data-driven analysis when AI unavailable."""
    if not traversal.get("found"):
        return f"Node '{traversal['center']}' not found in knowledge graph."
    center = traversal["center_node"]
    nodes  = traversal["nodes"]
    edges  = traversal["edges"]
    lines  = [
        f"## {center['label']} — Knowledge Graph Analysis",
        f"*Type: {center['type']} | Sources: {center.get('source_count', 0)}*",
        "",
        f"**Description:** {center.get('description', 'No description available.')}",
        "",
        f"**{len(edges)} direct relationships found in the knowledge graph.**",
        "",
        "**Connected nodes:**",
    ]
    node_map = {n["id"]: n for n in nodes}
    for e in sorted(edges, key=lambda x: x.get("weight", 0), reverse=True)[:10]:
        other = node_map.get(e.get("tgt_id") if e.get("src_id") == center["id"] else e.get("src_id"))
        if other:
            lines.append(f"• **{other['label']}** ({e['relation']}, strength {e.get('weight',1):.1f})")
            if e.get("evidence"):
                lines.append(f"  *{e['evidence'][:150]}*")
    lines.extend(["", "**Live context:**", live_ctx,
                  "", "*Add your Gemini API key in Profile for full AI analysis.*"])
    return "\n".join(lines)
