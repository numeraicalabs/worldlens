"""
WorldLens — Global Dependency Engine Router
=============================================
REST API for the dependency network analysis module.

Endpoints
---------
GET  /api/dependency/graph              Full graph JSON (nodes + edges)
GET  /api/dependency/stats              Graph statistics
GET  /api/dependency/path               Dependency path between two nodes
POST /api/dependency/propagate          Risk shock propagation
GET  /api/dependency/critical           Most critical nodes
GET  /api/dependency/neighbours/{id}    Node neighbourhood
POST /api/dependency/rebuild            Force graph rebuild from DB events
GET  /api/dependency/node/{id}          Single node detail

All write endpoints require authenticated user.
"""
from __future__ import annotations

import logging
import asyncio
from typing import List, Optional

import aiosqlite
from fastapi import APIRouter, Depends, Query, HTTPException, Body
from pydantic import BaseModel

from auth import require_user
from config import settings
from database import DB_PATH

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/dependency", tags=["dependency"])


# ════════════════════════════════════════════════════════════════════════════
# Helpers
# ════════════════════════════════════════════════════════════════════════════

async def _get_recent_events(limit: int = 500) -> List[dict]:
    """Pull recent events from the SQLite DB for graph ingestion."""
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """
                SELECT id, title, summary, category, country_code,
                       severity, sentiment_score, timestamp, source
                FROM   events
                ORDER  BY timestamp DESC
                LIMIT  ?
                """,
                (limit,)
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as exc:
        logger.warning("Could not load events from DB: %s", exc)
        return []


async def _engine():
    """Dependency-injected engine instance (lazy init with DB events)."""
    try:
        from analysis.graph.dependency_engine import get_engine
        events = await _get_recent_events(limit=800)
        return await get_engine(events)
    except Exception as exc:
        logger.error("DependencyEngine init failed: %s", exc)
        raise HTTPException(
            status_code=503,
            detail=f"Dependency engine unavailable: {exc}"
        )


# ════════════════════════════════════════════════════════════════════════════
# Pydantic schemas
# ════════════════════════════════════════════════════════════════════════════

class PropagateRequest(BaseModel):
    node:      str
    shock:     float = 8.0
    max_hops:  int   = 4
    damping:   float = 0.65


class RebuildRequest(BaseModel):
    event_limit: int = 800


# ════════════════════════════════════════════════════════════════════════════
# Endpoints
# ════════════════════════════════════════════════════════════════════════════

@router.get("/graph")
async def get_graph(
    min_weight:  float = Query(0.1,  ge=0.0,   le=1.0),
    node_types:  str   = Query("",   description="Comma-separated filter, e.g. country,company"),
    _user = Depends(require_user),
):
    """
    Return the full dependency graph as JSON (node-link format).

    Use `min_weight` to prune weak edges.
    Use `node_types` to filter to specific entity categories.
    """
    engine = await _engine()
    data   = engine.to_json(min_weight=min_weight)

    # Optional node-type filter
    if node_types.strip():
        allowed = set(t.strip() for t in node_types.split(",") if t.strip())
        allowed_ids = {
            n["id"] for n in data["nodes"] if n["node_type"] in allowed
        }
        data["nodes"] = [n for n in data["nodes"] if n["id"] in allowed_ids]
        data["edges"] = [
            e for e in data["edges"]
            if e["source"] in allowed_ids and e["target"] in allowed_ids
        ]
        data["stats"]["n_nodes"] = len(data["nodes"])
        data["stats"]["n_edges"] = len(data["edges"])

    return data


@router.get("/stats")
async def get_stats(_user = Depends(require_user)):
    """Graph metadata and health summary."""
    engine = await _engine()
    G      = engine.G

    from collections import Counter
    node_types = Counter(d.get("node_type","?") for _, d in G.nodes(data=True))
    edge_types = Counter(d.get("edge_type","?") for _, _, d in G.edges(data=True))

    return {
        "n_nodes":           G.number_of_nodes(),
        "n_edges":           G.number_of_edges(),
        "events_processed":  len(engine._b._seen_events),
        "node_type_counts":  dict(node_types),
        "edge_type_counts":  dict(edge_types),
        "top_critical":      engine.get_most_critical_nodes(k=5),
        "last_update":       engine._b.stats.last_update,
    }


@router.get("/path")
async def get_dependency_path(
    source:     str   = Query(...,  description="Source node (e.g. 'US', 'country:US')"),
    target:     str   = Query(...,  description="Target node (e.g. 'NVDA', 'company:NVDA')"),
    max_paths:  int   = Query(3,    ge=1, le=10),
    _user = Depends(require_user),
):
    """
    Find dependency path(s) between two nodes.

    Example: source=US&target=NVDA
    Returns all paths US → ... → NVDA with edge metadata.
    """
    engine = await _engine()
    result = engine.get_dependency_path(source, target, max_paths=max_paths)
    return result


@router.post("/propagate")
async def propagate_risk(
    body: PropagateRequest,
    _user = Depends(require_user),
):
    """
    Simulate a risk shock propagating from a source node.

    Example body:
      {"node": "US", "shock": 9.0, "max_hops": 4, "damping": 0.65}

    Returns list of affected nodes ranked by impact score.
    """
    engine = await _engine()
    result = engine.propagate_risk(
        node      = body.node,
        shock     = body.shock,
        max_hops  = body.max_hops,
        damping   = body.damping,
    )
    return result


@router.get("/critical")
async def get_critical_nodes(
    k:          int  = Query(20,  ge=1,  le=100),
    node_types: str  = Query("",  description="Comma-separated filter"),
    _user = Depends(require_user),
):
    """
    Return the k most critical nodes by composite score
    (betweenness × pagerank × risk × degree).
    """
    engine  = await _engine()
    types   = [t.strip() for t in node_types.split(",") if t.strip()] or None
    result  = engine.get_most_critical_nodes(k=k, node_types=types)
    return {"nodes": result, "total": len(result)}


@router.get("/neighbours/{node_id:path}")
async def get_neighbours(
    node_id:   str,
    direction: str = Query("both", pattern="^(in|out|both)$"),
    max_n:     int = Query(30, ge=1, le=100),
    _user = Depends(require_user),
):
    """
    Return immediate neighbours of a node.

    direction: "in" (predecessors), "out" (successors), "both"
    """
    engine = await _engine()
    return engine.get_neighbours(node_id, direction=direction, max_n=max_n)


@router.get("/node/{node_id:path}")
async def get_node(
    node_id: str,
    _user = Depends(require_user),
):
    """Full detail for a single node including neighbours and risk chain."""
    engine = await _engine()
    nid    = engine._resolve_node(node_id)
    if nid is None or nid not in engine.G:
        raise HTTPException(status_code=404, detail=f"Node '{node_id}' not found")

    d = engine.G.nodes[nid]
    neighbours = engine.get_neighbours(nid, direction="both", max_n=20)
    shock_sim  = engine.propagate_risk(nid, shock=7.0, max_hops=3)

    return {
        "node_id":    nid,
        "label":      d.get("label", nid),
        "node_type":  d.get("node_type", "?"),
        "risk_score": round(d.get("risk_score",  0.0), 2),
        "criticality":round(d.get("centrality",  0.0), 5),
        "pagerank":   round(d.get("pagerank",     0.0), 5),
        "in_degree":  engine.G.in_degree(nid),
        "out_degree": engine.G.out_degree(nid),
        "meta":       d.get("meta", {}),
        "updated_at": d.get("updated_at", ""),
        "neighbours": neighbours["neighbours"],
        "risk_propagation": {
            "shock": 7.0,
            "top_affected": shock_sim["affected"][:10],
            "critical_path_labels": shock_sim.get("critical_path_labels", []),
        },
    }


@router.post("/rebuild")
async def rebuild_graph(
    body: RebuildRequest = Body(default=RebuildRequest()),
    _user = Depends(require_user),
):
    """
    Force full graph rebuild from DB events.
    Returns new graph statistics.
    Admin use — takes ~1–3 seconds.
    """
    try:
        from analysis.graph.dependency_engine import reset_engine, get_engine
    except ImportError as exc:
        raise HTTPException(status_code=503, detail=str(exc))

    reset_engine()
    events = await _get_recent_events(limit=body.event_limit)
    engine = await get_engine(events)
    stats  = engine._b.stats
    return {
        "status":  "rebuilt",
        "n_nodes": stats.n_nodes,
        "n_edges": stats.n_edges,
        "events_processed": stats.n_events_processed,
        "last_update":      stats.last_update,
    }


@router.get("/example")
async def get_example(_user = Depends(require_user)):
    """
    Run the canonical example from the spec:
    'US sanctions impact Chinese semiconductor companies'

    Demonstrates get_dependency_path + propagate_risk.
    """
    engine = await _engine()

    path_result  = engine.get_dependency_path("US", "NVDA", max_paths=2)
    shock_result = engine.propagate_risk("US", shock=9.0, max_hops=4)

    return {
        "scenario": "US sanctions impact Chinese semiconductor companies",
        "dependency_path": path_result,
        "risk_propagation": {
            "source":      shock_result["source_label"],
            "shock":       shock_result["shock"],
            "top_10_affected": shock_result["affected"][:10],
            "critical_path_labels": shock_result.get("critical_path_labels", []),
        },
    }
