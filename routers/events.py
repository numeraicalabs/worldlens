"""World Lens — Events + AI + Macro router"""
from __future__ import annotations
import json
import aiosqlite
from fastapi import APIRouter, Query, Body, HTTPException, Depends
from auth import get_current_user
from fastapi.responses import JSONResponse
from ai_layer import ai_score_event, ai_regional_risk, ai_answer, ai_macro_briefing
from config import settings

router = APIRouter(prefix="/api/events", tags=["events"])


def _parse_ev(r: dict) -> dict:
    ev = dict(r)
    for field in ("related_markets", "ai_tags", "keywords", "source_list", "ner_entities"):
        try:
            ev[field] = json.loads(ev.get(field) or "[]")
        except Exception:
            ev[field] = []
    # Ensure new fields have defaults
    ev.setdefault("sentiment_score",  0.0)
    ev.setdefault("sentiment_tone",   "neutral")
    ev.setdefault("timeline_band",    "geopolitical")
    ev.setdefault("heat_index",       ev.get("severity", 5.0))
    ev.setdefault("market_impact",    0.0)
    ev.setdefault("narrative_id",     "")
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
    try:
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
    except Exception as e:
        logger.warning("get_events DB error: %s", e)
        return JSONResponse({"events": [], "count": 0, "error": "db_unavailable"})


@router.get("/stats/summary")
async def stats_summary():
    try:
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
    except Exception as e:
        logger.warning("stats_summary DB error: %s", e)
        return {
            "total_events": 0, "last_24h": 0, "high_impact_24h": 0,
            "by_category": {}, "hotspots": [],
            "avg_severity": 5.0, "global_risk_index": 0,
            "error": "db_unavailable",
        }


@router.get("/heatmap")
async def get_heatmap():
    """Country-level risk data for heatmap overlay."""
    try:
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
    except Exception as e:
        logger.warning("get_heatmap DB error: %s", e)
        return []


@router.get("/region/{country_code}/risk")
async def get_region_risk(country_code: str):
    cc = country_code.upper()
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM region_risk WHERE country_code=? AND datetime(updated_at) > datetime('now','-1 hour')",
                (cc,)
            ) as c:
                cached = await c.fetchone()
            if cached:
                return dict(cached)
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
        try:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute(
                    "INSERT OR REPLACE INTO region_risk (country_code,country_name,risk_score,trend,assessment,event_count) "
                    "VALUES (?,?,?,?,?,?)",
                    (result["country_code"], result["country_name"], result["risk_score"],
                     result["trend"], result["assessment"], result["event_count"])
                )
                await db.commit()
        except Exception:
            pass  # cache write failure is non-fatal
        return result
    except Exception as e:
        logger.warning("get_region_risk DB error %s: %s", cc, e)
        return {"country_code": cc, "country_name": cc, "risk_score": 5.0,
                "trend": "Unknown", "assessment": "", "drivers": "[]", "event_count": 0}


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
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
                row = await c.fetchone()
        if not row:
            raise HTTPException(404, "Event not found")
        ev = dict(row)
        score = await ai_score_event(ev["title"], ev.get("summary", ""), ev["category"])
        try:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute(
                    "UPDATE events SET ai_summary=?, ai_impact_score=?, ai_market_note=?, ai_tags=? WHERE id=?",
                    (score.get("summary", ""), score.get("impact_score", 5.0),
                     score.get("market_effects", ""), json.dumps(score.get("key_tags", [])), event_id)
                )
                await db.commit()
        except Exception:
            pass
        return score
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("score_event error %s: %s", event_id, e)
        return {"summary": "", "impact_score": 5.0, "market_effects": "", "key_tags": []}


@router.get("/macro/indicators")
async def get_macro():
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT name, value, previous, unit, category, country, updated_at "
                "FROM macro_indicators ORDER BY category, name"
            ) as c:
                rows = await c.fetchall()
        indicators = [dict(r) for r in rows]
        return {"indicators": indicators, "count": len(indicators)}
    except Exception as e:
        logger.warning("get_macro DB error: %s", e)
        return {"indicators": [], "count": 0, "error": "db_unavailable"}


@router.get("/macro/briefing")
async def get_macro_briefing():
    try:
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
    except Exception as e:
        logger.warning("get_macro_briefing DB error: %s", e)
        return {"briefing": "Macro briefing unavailable — database initialising."}


@router.get("/{event_id}")
async def get_event(event_id: str):
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
                row = await c.fetchone()
        if not row:
            raise HTTPException(404, "Not found")
        return _parse_ev(row)
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("get_event DB error %s: %s", event_id, e)
        raise HTTPException(503, "Database unavailable")


# ── Sentiment Analysis endpoint ──────────────────────
@router.post("/sentiment/{event_id}")
async def analyze_sentiment(event_id: str):
    """Run sentiment analysis on an event and cache result."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
                row = await c.fetchone()
        if not row:
            raise HTTPException(404, "Event not found")
        ev = dict(row)

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
        result = await ai_sentiment(ev["title"], ev.get("summary", ""), ev["category"])

        try:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute(
                    "UPDATE events SET sentiment_score=?, sentiment_tone=?, "
                    "sentiment_intensity=?, sentiment_info_type=?, sentiment_entities=? WHERE id=?",
                    (result.get("score", 0.0), result.get("tone", "Neutral"),
                     result.get("intensity", "Low"), result.get("info_type", "News Event"),
                     json.dumps(result.get("entity_sentiments", [])), event_id)
                )
                await db.commit()
        except Exception:
            pass
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("analyze_sentiment error %s: %s", event_id, e)
        return {"score": 0.0, "tone": "Neutral", "intensity": "Low", "cached": False}


# ── Show Impact endpoint ──────────────────────────────
@router.post("/impact/{event_id}")
async def show_impact(event_id: str):
    """Generate market impact analysis for an event."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
                row = await c.fetchone()
        if not row:
            raise HTTPException(404, "Event not found")
        ev = dict(row)

        cached = ev.get("show_impact_cache", "")
        if cached:
            try:
                return json.loads(cached)
            except Exception:
                pass

        from ai_layer import ai_show_impact
        result = await ai_show_impact(
            ev["title"], ev.get("summary", ""), ev["category"],
            ev.get("country_name") or ev.get("country_code", ""),
            float(ev.get("severity", 5.0))
        )

        try:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute(
                    "UPDATE events SET show_impact_cache=? WHERE id=?",
                    (json.dumps(result), event_id)
                )
                await db.commit()
        except Exception:
            pass
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("show_impact error %s: %s", event_id, e)
        return {"markets": [], "summary": "Impact analysis unavailable."}


# ── Batch sentiment for feed (lightweight) ───────────
@router.get("/sentiment/batch")
async def batch_sentiment(hours: int = 24, limit: int = 50):
    """Return pre-computed sentiment for recent events."""
    try:
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
    except Exception as e:
        logger.warning("batch_sentiment DB error: %s", e)
        return []


# ════════════════════════════════════════════════════════
# ADVANCED MAP INTELLIGENCE ENDPOINTS
# ════════════════════════════════════════════════════════

@router.post("/ner/{event_id}")
async def extract_entities(event_id: str):
    """Extract named entities (NER) for an event and cache result."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
                row = await c.fetchone()
        if not row:
            raise HTTPException(404, "Event not found")
        ev = dict(row)

        cached = ev.get("ner_entities", "[]")
        if cached and cached != "[]":
            try:
                return {"entities": json.loads(cached), "cached": True}
            except Exception:
                pass

        from ai_layer import ai_ner
        entities = await ai_ner(ev["title"], ev.get("summary",""), ev["category"])

        try:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute("UPDATE events SET ner_entities=? WHERE id=?",
                                 (json.dumps(entities), event_id))
                await db.commit()
        except Exception:
            pass
        return {"entities": entities, "cached": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("extract_entities error %s: %s", event_id, e)
        return {"entities": [], "cached": False}


@router.get("/relationships/{event_id}")
async def get_event_relationships(event_id: str, hours: int = Query(72), limit: int = Query(8)):
    """
    Get related events for a given event.
    Uses topic vector similarity + AI relationship classification.
    """
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
                row = await c.fetchone()
            if not row:
                raise HTTPException(404, "Event not found")
            ev = dict(row)

            cached_ids = ev.get("related_event_ids", "[]")
            if cached_ids and cached_ids != "[]":
                try:
                    rel_ids = json.loads(cached_ids)
                    if rel_ids:
                        rel_types = json.loads(ev.get("relationship_types","[]") or "[]")
                        return {"relationships": rel_types, "cached": True}
                except Exception:
                    pass

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

        try:
            rel_ids = [r["target_id"] for r in relationships]
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute(
                    "UPDATE events SET related_event_ids=?, relationship_types=? WHERE id=?",
                    (json.dumps(rel_ids), json.dumps(relationships), event_id)
                )
                await db.commit()
        except Exception:
            pass
        return {"relationships": relationships, "cached": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("get_event_relationships error %s: %s", event_id, e)
        return {"relationships": [], "cached": False}


@router.get("/graph/nodes")
async def get_graph_nodes(hours: int = Query(48), min_severity: float = Query(5.0), limit: int = Query(60)):
    """
    Return events as graph nodes with their relationship edges.
    Used by the Knowledge Graph visualization on the map.
    """
    try:
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
    except Exception as e:
        logger.warning("get_graph_nodes DB error: %s", e)
        return {"nodes": [], "edges": [], "node_count": 0, "edge_count": 0}


@router.post("/enrich/{event_id}")
async def enrich_event(event_id: str):
    """
    Full enrichment pipeline for a single event:
    topic_vector → NER → sentiment → relationships (async, best-effort)
    """
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
                row = await c.fetchone()
        if not row:
            raise HTTPException(404, "Event not found")
        ev = dict(row)

        from ai_layer import ai_ner, ai_sentiment, compute_topic_vector
        results: dict = {}

        if not ev.get("topic_vector"):
            tvec = compute_topic_vector(ev["title"] + " " + (ev.get("summary","") or ""))
            results["topic_vector"] = json.dumps(tvec)

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

        if not ev.get("ner_entities") or ev.get("ner_entities") == "[]":
            entities = await ai_ner(ev["title"], ev.get("summary",""), ev["category"])
            results["ner_entities"] = json.dumps(entities)

        if results:
            sets = ", ".join(f"{k}=?" for k in results)
            try:
                async with aiosqlite.connect(settings.db_path) as db:
                    await db.execute(f"UPDATE events SET {sets} WHERE id=?",
                                     list(results.values()) + [event_id])
                    await db.commit()
            except Exception:
                pass

        return {"enriched": list(results.keys()), "event_id": event_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("enrich_event error %s: %s", event_id, e)
        return {"enriched": [], "event_id": event_id}


@router.get("/sentiment/multidim/{event_id}")
async def get_multidim_sentiment(event_id: str):
    """Return the full multi-dimensional sentiment object for an event."""
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("get_multidim_sentiment error %s: %s", event_id, e)
        raise HTTPException(503, "Database unavailable")


# ── Personalised feed ───────────────────────────────────────────────────────
# Scores events against the user's real affinity (from activity_log).
# Falls back to onboarding interests if no activity data yet.

@router.get("/personalized")
async def get_personalized_events(
    hours:       int   = Query(72,  ge=1,   le=720),
    limit:       int   = Query(40,  le=200),
    min_score:   float = Query(0.0, ge=0.0, le=1.0),
    user=Depends(get_current_user),
):
    """
    Returns events scored by relevance to THIS user, using:
      1. Real category affinity from activity_log (last 30 days)
      2. Onboarding interests/regions as fallback weights
      3. Severity × recency × relevance composite score
    """
    try:
        if not user:
            try:
                async with aiosqlite.connect(settings.db_path) as db:
                    db.row_factory = aiosqlite.Row
                    async with db.execute(
                        "SELECT * FROM events WHERE datetime(timestamp) > datetime('now',?) "
                        "ORDER BY severity DESC LIMIT ?",
                        (f"-{hours} hours", limit)
                    ) as cur:
                        rows = [_parse_ev(dict(r)) for r in await cur.fetchall()]
                return JSONResponse({"events": rows, "personalized": False})
            except Exception:
                return JSONResponse({"events": [], "personalized": False})

        uid = user["id"]

        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row

            async with db.execute("""
                SELECT e.category, COUNT(*) as cnt
                FROM   activity_log al
                JOIN   events e ON e.id = al.detail
                WHERE  al.user_id=?
                  AND  al.action IN ('event_opened','event_saved','event_dwell_30s')
                  AND  al.created_at > datetime('now','-30 days')
                GROUP  BY e.category
                ORDER  BY cnt DESC
            """, (uid,)) as cur:
                affinity_rows = await cur.fetchall()

            async with db.execute(
                "SELECT interests, regions FROM users WHERE id=?", (uid,)
            ) as cur:
                profile_row = await cur.fetchone()

            async with db.execute(
                "SELECT * FROM events "
                "WHERE datetime(timestamp) > datetime('now',?) "
                "ORDER BY (severity * COALESCE(heat_index,severity)) DESC "
                "LIMIT 300",
                (f"-{hours} hours",)
            ) as cur:
                all_events = [_parse_ev(dict(r)) for r in await cur.fetchall()]

        import math, json as _json
        affinity: dict = {}
        total_actions  = sum(r[1] for r in affinity_rows)

        if total_actions >= 5:
            for row in affinity_rows:
                affinity[row[0]] = row[1] / total_actions
        else:
            profile   = dict(profile_row) if profile_row else {}
            interests = []
            try:    interests = _json.loads(profile.get("interests") or "[]")
            except: pass
            SEVERITY_BY_LEVEL = {"beginner": 5.5, "intermediate": 4.5, "advanced": 3.0}
            exp_level  = profile.get("experience_level", "intermediate") or "intermediate"
            sev_filter = SEVERITY_BY_LEVEL.get(exp_level, 4.5)
            CAT_MAP = {
                "Economics": ["ECONOMICS", "FINANCE", "TRADE"],
                "Finance":   ["FINANCE", "ECONOMICS"],
                "Geopolitics": ["GEOPOLITICS", "POLITICS"],
                "Conflict":  ["CONFLICT", "SECURITY"],
                "Energy":    ["ENERGY"],
                "Technology":["TECHNOLOGY"],
                "Humanitarian":["HUMANITARIAN","HEALTH"],
                "Disaster":  ["DISASTER","EARTHQUAKE"],
            }
            for interest in interests:
                for cat in CAT_MAP.get(interest, []):
                    affinity[cat] = affinity.get(cat, 0) + 0.25

        profile   = dict(profile_row) if profile_row else {}
        regions   = []
        try:    regions = _json.loads(profile.get("regions") or "[]")
        except: pass
        REGION_CODES = {
            "Europe":       {"DE","FR","GB","IT","ES","PL","UA","RU","SE","NO","NL","CH"},
            "USA":          {"US","CA"},
            "Middle East":  {"SA","IR","IL","IQ","SY","AE","JO","LB","YE","QA"},
            "Asia":         {"CN","JP","IN","KR","ID","TH","VN","MY","AU","SG","TW"},
            "Africa":       {"NG","ZA","EG","KE","ET","MA","DZ","TN"},
            "Latin America":{"BR","MX","AR","CO","CL","PE","VE"},
            "Global":       set(),
        }
        active_codes: set = set()
        for r in regions:
            active_codes |= REGION_CODES.get(r, set())
        has_region_filter = bool(active_codes)

        scored = []
        for ev in all_events:
            cat       = ev.get("category", "")
            cc        = ev.get("country_code", "")
            sev       = float(ev.get("severity", 5.0))
            heat      = float(ev.get("heat_index", sev))
            src_boost = math.log1p(int(ev.get("source_count", 1))) * 0.1

            cat_score    = affinity.get(cat, 0.05)
            region_bonus = 0.3 if (has_region_filter and cc in active_codes) else 0.0
            global_bonus = 0.1 if not has_region_filter else 0.0

            relevance = min(1.0, cat_score + region_bonus + global_bonus + src_boost)
            composite = round((sev / 10.0) * 0.5 + (heat / 10.0) * 0.2 + relevance * 0.3, 4)
            ev["_relevance"] = round(relevance, 4)
            ev["_score"]     = composite
            if composite >= min_score:
                scored.append(ev)

        scored.sort(key=lambda e: -e["_score"])
        return JSONResponse({
            "events":      scored[:limit],
            "personalized": True,
            "affinity":    affinity,
            "total_actions": total_actions,
        })
    except Exception as e:
        logger.warning("get_personalized_events error: %s", e)
        return JSONResponse({"events": [], "personalized": False})


# ── Asset drivers — "Why is this moving?" ──────────────────────────────────

@router.get("/drivers/{symbol}")
async def get_asset_drivers(
    symbol:      str,
    hours:       int   = Query(48, ge=1, le=168),
    min_change:  float = Query(0.0, ge=0.0),
):
    """
    Find events that may explain recent price movement for an asset.
    Uses related_markets field on events (populated by scraper).
    Returns top 5 relevant events ordered by severity × recency.
    """
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            symbol_clean = symbol.upper().strip()
            async with db.execute("""
                SELECT id, title, category, country_name, severity,
                       timestamp, url, sentiment_tone, source_count,
                       related_markets, heat_index
                FROM   events
                WHERE  datetime(timestamp) > datetime('now', ?)
                  AND  (
                        related_markets LIKE ?
                     OR related_markets LIKE ?
                     OR related_markets LIKE ?
                  )
                ORDER  BY (severity * COALESCE(heat_index, severity) / 10.0) DESC
                LIMIT  8
            """, (
                f"-{hours} hours",
                f"%{symbol_clean}%",
                f"%{symbol_clean[:3]}%",
                f"%{_market_alias(symbol_clean)}%",
            )) as cur:
                rows = [_parse_ev(dict(r)) for r in await cur.fetchall()]

        seen = set()
        drivers = []
        for ev in rows:
            key = ev["title"][:40].lower()
            if key not in seen:
                seen.add(key)
                drivers.append(ev)

        return JSONResponse({"drivers": drivers[:5], "symbol": symbol_clean, "hours": hours})
    except Exception as e:
        logger.warning("get_asset_drivers error %s: %s", symbol, e)
        return JSONResponse({"drivers": [], "symbol": symbol, "hours": hours})


def _market_alias(symbol: str) -> str:
    """Map ticker symbols to market keywords used in related_markets."""
    aliases = {
        "GC": "Gold",   "GLD": "Gold",   "XAUUSD": "Gold",
        "CL": "Oil",    "USO": "Oil",    "WTI": "Oil",    "XOM": "Oil",
        "NG": "Natural Gas",
        "BTC": "Bitcoin","ETH": "Ethereum",
        "SPY": "S&P 500","SPX": "S&P 500",
        "QQQ": "Nasdaq", "NDX": "Nasdaq",
        "VIX": "VIX",
        "DX": "USD Index","UUP": "USD Index","DXY": "USD Index",
        "NVDA": "Semiconductors", "AMD": "Semiconductors", "INTC": "Semiconductors",
        "TLT": "Bonds",  "IEF": "Bonds",  "ZB": "Bonds",
    }
    return aliases.get(symbol, symbol)


# ── CSV Export ───────────────────────────────────────────────────────────────
from fastapi.responses import StreamingResponse
import csv, io

@router.get("/export/csv")
async def export_events_csv(
    hours:       int   = Query(72,  ge=1,   le=720),
    category:    str   = Query(None),
    min_severity:float = Query(4.5, ge=0.0, le=10.0),
    limit:       int   = Query(500, le=2000),
    user=Depends(get_current_user),
):
    """Export filtered events as CSV. Authenticated users only."""
    if not user:
        raise HTTPException(401, "Authentication required for export")
    try:
        where  = ["datetime(timestamp) > datetime('now',?)"]
        params = [f"-{hours} hours"]
        if category:
            where.append("category = ?"); params.append(category.upper())
        where.append("severity >= ?"); params.append(min_severity)
        params.append(limit)

        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                f"SELECT id,timestamp,title,summary,category,source,country_name,"
                f"severity,impact,sentiment_tone,url,related_markets,source_count "
                f"FROM events WHERE {' AND '.join(where)} "
                f"ORDER BY severity DESC, timestamp DESC LIMIT ?",
                params
            ) as cur:
                rows = await cur.fetchall()

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "id","timestamp","title","summary","category","source","country",
            "severity","impact","sentiment","url","markets","source_count"
        ])
        for r in rows:
            ev = dict(r)
            markets = ev.get("related_markets","")
            try:
                import json as _j
                markets = ", ".join(_j.loads(markets))
            except Exception:
                pass
            writer.writerow([
                ev.get("id",""), ev.get("timestamp",""), ev.get("title",""),
                (ev.get("summary","") or "").replace("\n"," ")[:200],
                ev.get("category",""), ev.get("source",""), ev.get("country_name",""),
                ev.get("severity",""), ev.get("impact",""), ev.get("sentiment_tone",""),
                ev.get("url",""), markets, ev.get("source_count",1),
            ])

        output.seek(0)
        filename = f"worldlens-events-{__import__('datetime').date.today().isoformat()}.csv"
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.warning("export_events_csv error: %s", e)
        raise HTTPException(503, "Export unavailable — database initialising.")
