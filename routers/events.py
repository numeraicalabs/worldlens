"""World Lens — Events + AI + Macro router"""
from __future__ import annotations
import json
import aiosqlite
from fastapi import APIRouter, Query, Body, HTTPException
from fastapi.responses import JSONResponse
from ai_layer import ai_score_event, ai_regional_risk, ai_answer, ai_macro_briefing
from config import settings

router = APIRouter(prefix="/api/events", tags=["events"])


def _parse_ev(r: dict) -> dict:
    ev = dict(r)
    for field in ("related_markets", "ai_tags"):
        try:
            ev[field] = json.loads(ev.get(field) or "[]")
        except Exception:
            ev[field] = []
    return ev


@router.get("")
async def get_events(
    limit: int = Query(500, le=1000),
    offset: int = Query(0, ge=0),
    category: str = Query(None),
    impact: str = Query(None),
    country: str = Query(None),
    hours: int = Query(72),
    search: str = Query(None),
    min_severity: float = Query(None),
):
    where = ["datetime(timestamp) > datetime('now', ?)"]
    params = ["-" + str(hours) + " hours"]
    if category:
        where.append("category = ?"); params.append(category.upper())
    if impact:
        where.append("impact = ?"); params.append(impact)
    if country:
        where.append("country_code = ?"); params.append(country.upper())
    if min_severity is not None:
        where.append("severity >= ?"); params.append(min_severity)
    if search:
        where.append("(title LIKE ? OR summary LIKE ?)"); params.extend(["%" + search + "%"] * 2)
    params.append(limit)
    params.append(offset)

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT *, CASE category "
            "WHEN 'ECONOMICS' THEN 1.2 WHEN 'FINANCE' THEN 1.2 "
            "WHEN 'CONFLICT' THEN 1.1 WHEN 'GEOPOLITICS' THEN 1.0 "
            "WHEN 'ENERGY' THEN 1.0 ELSE 0.9 END AS cat_weight "
            "FROM events WHERE " + " AND ".join(where) +
            " ORDER BY (severity * cat_weight) DESC, timestamp DESC LIMIT ? OFFSET ?", params
        ) as cur:
            rows = await cur.fetchall()

    return JSONResponse({"events": [_parse_ev(r) for r in rows], "count": len(rows)})


@router.get("/stats/summary")
async def stats_summary():
    async with aiosqlite.connect(settings.db_path) as db:
        async with db.execute("SELECT COUNT(*) FROM events") as c:
            total = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM events WHERE datetime(timestamp) > datetime('now','-24 hours')"
        ) as c:
            last24 = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM events WHERE impact='High' AND datetime(timestamp) > datetime('now','-24 hours')"
        ) as c:
            high24 = (await c.fetchone())[0]
        async with db.execute(
            "SELECT category, COUNT(*) FROM events GROUP BY category ORDER BY 2 DESC"
        ) as c:
            by_cat = {r[0]: r[1] for r in await c.fetchall()}
        async with db.execute(
            "SELECT country_code, country_name, COUNT(*) as n, AVG(severity) as s "
            "FROM events WHERE country_code!='XX' GROUP BY country_code ORDER BY n DESC LIMIT 10"
        ) as c:
            hotspots = [{"code": r[0], "name": r[1], "count": r[2], "avg_severity": round(r[3] or 5, 1)} for r in await c.fetchall()]
        async with db.execute(
            "SELECT AVG(severity) FROM events WHERE datetime(timestamp) > datetime('now','-24 hours')"
        ) as c:
            avg_sev = (await c.fetchone())[0] or 5.0

    return {
        "total_events": total, "last_24h": last24, "high_impact_24h": high24,
        "by_category": by_cat, "hotspots": hotspots,
        "avg_severity": round(avg_sev, 1),
        "global_risk_index": round(min(100, avg_sev * 10), 1),
    }


@router.get("/heatmap")
async def get_heatmap():
    """Country-level risk data for heatmap overlay."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT country_code, country_name, COUNT(*) as event_count, "
            "AVG(severity) as avg_severity, MAX(severity) as max_severity, "
            "SUM(CASE WHEN impact='High' THEN 1 ELSE 0 END) as high_count "
            "FROM events WHERE country_code!='XX' "
            "AND datetime(timestamp) > datetime('now','-72 hours') "
            "GROUP BY country_code ORDER BY avg_severity DESC"
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.get("/region/{country_code}/risk")
async def get_region_risk(country_code: str):
    cc = country_code.upper()
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        # Check cached risk
        async with db.execute(
            "SELECT * FROM region_risk WHERE country_code=? AND datetime(updated_at) > datetime('now','-1 hour')",
            (cc,)
        ) as c:
            cached = await c.fetchone()
        if cached:
            return dict(cached)
        # Get recent events
        async with db.execute(
            "SELECT * FROM events WHERE country_code=? ORDER BY timestamp DESC LIMIT 15", (cc,)
        ) as c:
            events = [dict(r) for r in await c.fetchall()]

    risk = await ai_regional_risk(cc, events)
    result = {
        "country_code": cc,
        "country_name": events[0].get("country_name", cc) if events else cc,
        "risk_score": risk.get("risk_score", 5.0),
        "trend": risk.get("trend", "Stable"),
        "assessment": risk.get("assessment", ""),
        "drivers": json.dumps(risk.get("drivers", [])),
        "event_count": len(events),
    }
    # Cache it
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO region_risk (country_code,country_name,risk_score,trend,assessment,event_count) "
            "VALUES (?,?,?,?,?,?)",
            (result["country_code"], result["country_name"], result["risk_score"],
             result["trend"], result["assessment"], result["event_count"])
        )
        await db.commit()
    return result


@router.post("/ai/ask")
async def ai_ask(payload: dict = Body(...)):
    question = payload.get("question", "")
    context = payload.get("context", "")
    if not question:
        return {"answer": None}
    answer = await ai_answer(question, context)
    return {"answer": answer}


@router.post("/ai/score/{event_id}")
async def score_event(event_id: str):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
            row = await c.fetchone()
    if not row:
        raise HTTPException(404, "Event not found")
    ev = dict(row)
    score = await ai_score_event(ev["title"], ev.get("summary", ""), ev["category"])
    # Cache AI fields
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE events SET ai_summary=?, ai_impact_score=?, ai_market_note=?, ai_tags=? WHERE id=?",
            (score.get("summary", ""), score.get("impact_score", 5.0),
             score.get("market_effects", ""), json.dumps(score.get("key_tags", [])), event_id)
        )
        await db.commit()
    return score


@router.get("/macro/indicators")
async def get_macro():
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM macro_indicators ORDER BY category, name") as c:
            rows = await c.fetchall()
    return [dict(r) for r in rows]


@router.get("/macro/briefing")
async def get_macro_briefing():
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM macro_indicators") as c:
            indicators = [dict(r) for r in await c.fetchall()]
        async with db.execute(
            "SELECT * FROM events WHERE impact='High' ORDER BY timestamp DESC LIMIT 5"
        ) as c:
            events = [dict(r) for r in await c.fetchall()]
    text = await ai_macro_briefing(indicators, events)
    return {"briefing": text or "Configure an AI provider in Admin → Settings to enable macro briefings."}


@router.get("/{event_id}")
async def get_event(event_id: str):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
            row = await c.fetchone()
    if not row:
        raise HTTPException(404, "Not found")
    return _parse_ev(row)


# ── Sentiment Analysis endpoint ──────────────────────
@router.post("/sentiment/{event_id}")
async def analyze_sentiment(event_id: str):
    """Run sentiment analysis on an event and cache result."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
            row = await c.fetchone()
    if not row:
        raise HTTPException(404, "Event not found")
    ev = dict(row)

    # Return cached if recent score exists
    if ev.get("sentiment_tone") and ev.get("sentiment_score") is not None:
        return {
            "score": ev["sentiment_score"],
            "tone": ev["sentiment_tone"],
            "intensity": ev["sentiment_intensity"],
            "info_type": ev["sentiment_info_type"],
            "entity_sentiments": json.loads(ev.get("sentiment_entities") or "[]"),
            "cached": True
        }

    from ai_layer import ai_sentiment
    result = await ai_sentiment(
        ev["title"], ev.get("summary", ""), ev["category"]
    )

    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE events SET sentiment_score=?, sentiment_tone=?, "
            "sentiment_intensity=?, sentiment_info_type=?, sentiment_entities=? WHERE id=?",
            (
                result.get("score", 0.0),
                result.get("tone", "Neutral"),
                result.get("intensity", "Low"),
                result.get("info_type", "News Event"),
                json.dumps(result.get("entity_sentiments", [])),
                event_id
            )
        )
        await db.commit()

    return result


# ── Show Impact endpoint ──────────────────────────────
@router.post("/impact/{event_id}")
async def show_impact(event_id: str):
    """Generate market impact analysis for an event."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
            row = await c.fetchone()
    if not row:
        raise HTTPException(404, "Event not found")
    ev = dict(row)

    # Return cached impact if present
    cached = ev.get("show_impact_cache", "")
    if cached:
        try:
            return json.loads(cached)
        except Exception:
            pass

    from ai_layer import ai_show_impact
    result = await ai_show_impact(
        ev["title"],
        ev.get("summary", ""),
        ev["category"],
        ev.get("country_name") or ev.get("country_code", ""),
        float(ev.get("severity", 5.0))
    )

    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE events SET show_impact_cache=? WHERE id=?",
            (json.dumps(result), event_id)
        )
        await db.commit()

    return result


# ── Batch sentiment for feed (lightweight) ───────────
@router.get("/sentiment/batch")
async def batch_sentiment(hours: int = 24, limit: int = 50):
    """Return pre-computed sentiment for recent events."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, sentiment_score, sentiment_tone, sentiment_intensity, "
            "sentiment_info_type FROM events "
            "WHERE datetime(timestamp) > datetime('now',?) AND sentiment_tone != '' "
            "ORDER BY timestamp DESC LIMIT ?",
            (f"-{hours} hours", limit)
        ) as c:
            rows = await c.fetchall()
    return [dict(r) for r in rows]


# ════════════════════════════════════════════════════════
# ADVANCED MAP INTELLIGENCE ENDPOINTS
# ════════════════════════════════════════════════════════

@router.post("/ner/{event_id}")
async def extract_entities(event_id: str):
    """Extract named entities (NER) for an event and cache result."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
            row = await c.fetchone()
    if not row:
        raise HTTPException(404, "Event not found")
    ev = dict(row)

    # Return cached
    cached = ev.get("ner_entities", "[]")
    if cached and cached != "[]":
        try:
            return {"entities": json.loads(cached), "cached": True}
        except Exception:
            pass

    from ai_layer import ai_ner
    entities = await ai_ner(ev["title"], ev.get("summary",""), ev["category"])

    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("UPDATE events SET ner_entities=? WHERE id=?",
                         (json.dumps(entities), event_id))
        await db.commit()

    return {"entities": entities, "cached": False}


@router.get("/relationships/{event_id}")
async def get_event_relationships(event_id: str, hours: int = Query(72), limit: int = Query(8)):
    """
    Get related events for a given event.
    Uses topic vector similarity + AI relationship classification.
    """
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
            row = await c.fetchone()
        if not row:
            raise HTTPException(404, "Event not found")
        ev = dict(row)

        # Check cached relationships
        cached_ids = ev.get("related_event_ids", "[]")
        if cached_ids and cached_ids != "[]":
            try:
                rel_ids = json.loads(cached_ids)
                if rel_ids:
                    rel_types = json.loads(ev.get("relationship_types","[]") or "[]")
                    return {"relationships": rel_types, "cached": True}
            except Exception:
                pass

        # Fetch candidate events (same time window)
        async with db.execute(
            "SELECT id, title, summary, category, severity, timestamp, "
            "country_code, topic_vector FROM events "
            "WHERE id!=? AND datetime(timestamp) > datetime('now',?) "
            "ORDER BY severity DESC LIMIT 50",
            (event_id, f"-{hours} hours")
        ) as c:
            candidates = [dict(r) for r in await c.fetchall()]

    from ai_layer import ai_event_relationships
    relationships = await ai_event_relationships(ev, candidates, top_k=limit)

    # Cache results
    rel_ids = [r["target_id"] for r in relationships]
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE events SET related_event_ids=?, relationship_types=? WHERE id=?",
            (json.dumps(rel_ids), json.dumps(relationships), event_id)
        )
        await db.commit()

    return {"relationships": relationships, "cached": False}


@router.get("/graph/nodes")
async def get_graph_nodes(hours: int = Query(48), min_severity: float = Query(5.0), limit: int = Query(60)):
    """
    Return events as graph nodes with their relationship edges.
    Used by the Knowledge Graph visualization on the map.
    """
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, title, category, severity, impact, country_code, country_name, "
            "timestamp, latitude, longitude, sentiment_score, sentiment_tone, "
            "related_event_ids, relationship_types, topic_vector, source_count "
            "FROM events WHERE datetime(timestamp) > datetime('now',?) "
            "AND severity >= ? ORDER BY severity DESC LIMIT ?",
            (f"-{hours} hours", min_severity, limit)
        ) as c:
            nodes = [dict(r) for r in await c.fetchall()]

    # Parse JSON fields
    for n in nodes:
        for f in ("related_event_ids", "relationship_types", "topic_vector"):
            try:
                n[f] = json.loads(n.get(f) or "[]")
            except Exception:
                n[f] = []

    # Build edge list from relationship_types
    edges = []
    seen_edges = set()
    for node in nodes:
        for rel in (node.get("relationship_types") or []):
            tid = rel.get("target_id")
            if not tid:
                continue
            edge_key = tuple(sorted([node["id"], tid]))
            if edge_key in seen_edges:
                continue
            seen_edges.add(edge_key)
            edges.append({
                "source": node["id"],
                "target": tid,
                "type":   rel.get("rel_type","correlated"),
                "weight": rel.get("weight", 0.5),
            })

    return {"nodes": nodes, "edges": edges, "node_count": len(nodes), "edge_count": len(edges)}


@router.post("/enrich/{event_id}")
async def enrich_event(event_id: str):
    """
    Full enrichment pipeline for a single event:
    topic_vector → NER → sentiment → relationships (async, best-effort)
    """
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
            row = await c.fetchone()
    if not row:
        raise HTTPException(404, "Event not found")
    ev = dict(row)

    from ai_layer import ai_ner, ai_sentiment, compute_topic_vector
    results: dict = {}

    # 1. Topic vector (synchronous, no AI needed)
    if not ev.get("topic_vector"):
        tvec = compute_topic_vector(ev["title"] + " " + (ev.get("summary","") or ""))
        results["topic_vector"] = json.dumps(tvec)

    # 2. Sentiment
    if not ev.get("sentiment_tone"):
        sent = await ai_sentiment(ev["title"], ev.get("summary",""), ev["category"],
                                  ev.get("source",""))
        results.update({
            "sentiment_score":      sent.get("score", 0.0),
            "sentiment_tone":       sent.get("tone",""),
            "sentiment_intensity":  sent.get("intensity",""),
            "sentiment_info_type":  sent.get("info_type",""),
            "sentiment_entities":   json.dumps(sent.get("entity_sentiments",[])),
            "sent_uncertainty":     sent.get("uncertainty", 0.0),
            "sent_market_stress":   sent.get("market_stress", 0.0),
            "sent_narrative_momentum": sent.get("narrative_momentum", 0.0),
            "sent_credibility":     sent.get("credibility", 0.72),
        })

    # 3. NER
    if not ev.get("ner_entities") or ev.get("ner_entities") == "[]":
        entities = await ai_ner(ev["title"], ev.get("summary",""), ev["category"])
        results["ner_entities"] = json.dumps(entities)

    if results:
        sets = ", ".join(f"{k}=?" for k in results)
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(f"UPDATE events SET {sets} WHERE id=?",
                             list(results.values()) + [event_id])
            await db.commit()

    return {"enriched": list(results.keys()), "event_id": event_id}


@router.get("/sentiment/multidim/{event_id}")
async def get_multidim_sentiment(event_id: str):
    """Return the full multi-dimensional sentiment object for an event."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT sentiment_score, sentiment_tone, sentiment_intensity, "
            "sentiment_info_type, sentiment_entities, "
            "sent_uncertainty, sent_market_stress, sent_narrative_momentum, sent_credibility "
            "FROM events WHERE id=?", (event_id,)
        ) as c:
            row = await c.fetchone()
    if not row:
        raise HTTPException(404, "Event not found")
    r = dict(row)
    try:
        r["sentiment_entities"] = json.loads(r.get("sentiment_entities") or "[]")
    except Exception:
        r["sentiment_entities"] = []
    return r
