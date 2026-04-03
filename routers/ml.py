"""
WorldLens — ML Router (Sprint 4)
==================================
Exposes ML model endpoints to the frontend and internal consumers.

Endpoints:
  GET  /api/ml/status                      — which ML features are active
  GET  /api/ml/similar/{event_id}          — semantic/TF-IDF similar events
  GET  /api/ml/score-feed                  — TF-IDF personalised event scores
  POST /api/ml/rebuild-profile             — (re)build TF-IDF for current user
  GET  /api/ml/alert-filter/{alert_id}     — would this alert fire for this user?
  POST /api/ml/train-alert-filter          — (re)train alert classifier
"""
from __future__ import annotations

import json
import logging
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from auth      import get_current_user, require_user
from config    import settings
from analysis.ml_engine import (
    build_user_tfidf_vector, score_event_against_profile,
    train_alert_filter, predict_alert_relevance,
    find_similar_events, tfidf_to_json, tfidf_from_json,
    model_to_b64, model_from_b64, ml_status,
    extract_alert_features,
)

router  = APIRouter(prefix="/api/ml", tags=["ml"])
logger  = logging.getLogger(__name__)
DB      = settings.db_path


# ── 0.  Status ────────────────────────────────────────────────────────────────

@router.get("/status")
async def get_ml_status():
    """Returns which ML components are available on this deployment."""
    status = ml_status()
    status["enable_ml_features"] = settings.enable_ml_features
    return status


# ── 1.  Similar events ────────────────────────────────────────────────────────

@router.get("/similar/{event_id}")
async def get_similar_events(
    event_id: str,
    limit:    int   = Query(5, ge=1, le=20),
    hours:    int   = Query(168, ge=1, le=720),   # last 7 days
    user=Depends(get_current_user),
):
    """
    Find events semantically similar to event_id.
    Uses sentence-transformers if available, falls back to TF-IDF cosine.
    """
    if not settings.enable_ml_features:
        raise HTTPException(503, "ML features are disabled on this deployment")

    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row

        # Get seed event
        async with db.execute(
            "SELECT id, title, summary, category FROM events WHERE id=?",
            (event_id,)
        ) as cur:
            seed_row = await cur.fetchone()
        if not seed_row:
            raise HTTPException(404, "Event not found")
        seed  = dict(seed_row)
        seed_text = (seed["title"] or "") + " " + (seed["summary"] or "")

        # Get candidate events (same time window, exclude seed)
        async with db.execute("""
            SELECT id, title, summary, category, country_name,
                   severity, timestamp, url, sentiment_tone
            FROM   events
            WHERE  id != ?
              AND  datetime(timestamp) > datetime('now', ?)
            ORDER  BY severity DESC
            LIMIT  300
        """, (event_id, f"-{hours} hours")) as cur:
            candidates = [dict(r) for r in await cur.fetchall()]

    similar = find_similar_events(seed_text, candidates, top_n=limit, threshold=0.35)

    return JSONResponse({
        "seed_id":    event_id,
        "seed_title": seed["title"],
        "similar":    similar,
        "method":     "semantic" if ml_status()["embedder_loaded"] else "tfidf",
    })


# ── 2.  TF-IDF profile rebuild ────────────────────────────────────────────────

@router.post("/rebuild-profile")
async def rebuild_tfidf_profile(user=Depends(require_user)):
    """
    (Re)build TF-IDF interest profile for the current user.
    Reads their last 100 opened events from activity_log.
    Stores result in user_models.
    """
    if not settings.enable_ml_features:
        raise HTTPException(503, "ML features are disabled")

    uid = user["id"]
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row

        # Gather event texts from user's history
        async with db.execute("""
            SELECT DISTINCT e.title, e.summary, e.category
            FROM   activity_log al
            JOIN   events e ON e.id = al.detail
            WHERE  al.user_id = ?
              AND  al.action IN ('event_opened', 'event_saved', 'event_dwell_30s')
            ORDER  BY al.created_at DESC
            LIMIT  100
        """, (uid,)) as cur:
            rows = await cur.fetchall()

    texts = [
        (r["title"] or "") + " " + (r["summary"] or "") + " " + (r["category"] or "")
        for r in rows
    ]
    profile = build_user_tfidf_vector(texts)

    if profile is None:
        return JSONResponse({
            "status": "insufficient_data",
            "message": f"Need at least 5 events opened (have {len(texts)})",
            "events_read": len(texts),
        })

    # Persist to user_models
    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO user_models (user_id, model_type, model_data, updated_at)
            VALUES (?, 'tfidf_vector', ?, datetime('now'))
            ON CONFLICT(user_id, model_type) DO UPDATE SET
                model_data = excluded.model_data,
                updated_at = datetime('now')
        """, (uid, tfidf_to_json(profile)))
        await db.commit()

    return JSONResponse({
        "status":      "rebuilt",
        "features":    len(profile),
        "events_used": len(texts),
        "top_terms":   list(profile.keys())[:10],
    })


# ── 3.  TF-IDF scored feed ────────────────────────────────────────────────────

@router.get("/score-feed")
async def get_tfidf_scored_feed(
    hours: int = Query(48, ge=1, le=168),
    limit: int = Query(30, ge=1, le=100),
    user=Depends(require_user),
):
    """
    Return events scored by the user's TF-IDF profile.
    Complements affinity-based scoring with keyword-level precision.
    """
    if not settings.enable_ml_features:
        raise HTTPException(503, "ML features are disabled")

    uid = user["id"]
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row

        # Load TF-IDF profile
        async with db.execute(
            "SELECT model_data FROM user_models WHERE user_id=? AND model_type='tfidf_vector'",
            (uid,)
        ) as cur:
            row = await cur.fetchone()
        profile = tfidf_from_json(row["model_data"]) if row else {}

        # Load recent events
        async with db.execute("""
            SELECT id, title, summary, category, country_name, country_code,
                   severity, timestamp, url, sentiment_tone, heat_index, source_count
            FROM   events
            WHERE  datetime(timestamp) > datetime('now', ?)
            ORDER  BY severity DESC LIMIT 200
        """, (f"-{hours} hours",)) as cur:
            events = [dict(r) for r in await cur.fetchall()]

    if not profile:
        return JSONResponse({"events": events[:limit], "personalized": False,
                             "message": "No TF-IDF profile yet — call /api/ml/rebuild-profile"})

    # Score each event
    scored = []
    for ev in events:
        text      = (ev.get("title") or "") + " " + (ev.get("summary") or "")
        tfidf_s   = score_event_against_profile(profile, text)
        severity  = float(ev.get("severity", 5.0))
        composite = round(severity/10 * 0.6 + tfidf_s * 0.4, 4)
        ev["_tfidf_score"]     = tfidf_s
        ev["_composite_score"] = composite
        scored.append(ev)

    scored.sort(key=lambda e: -e["_composite_score"])
    return JSONResponse({"events": scored[:limit], "personalized": True,
                         "profile_features": len(profile)})


# ── 4.  Alert filter training ─────────────────────────────────────────────────

@router.post("/train-alert-filter")
async def train_user_alert_filter(user=Depends(require_user)):
    """
    Train alert false-positive filter from user's alert interaction history.
    Positive examples: alerts opened within 30 min of trigger.
    Negative examples: alerts logged but not opened.
    """
    if not settings.enable_ml_features:
        raise HTTPException(503, "ML features are disabled")

    uid = user["id"]
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row

        # Get alert email logs vs actual opens
        async with db.execute("""
            SELECT e.category, e.severity, e.heat_index, e.source_count,
                   e.sentiment_score, e.ai_impact_score, e.sentiment_tone,
                   CASE WHEN op.id IS NOT NULL THEN 1 ELSE 0 END AS opened
            FROM   activity_log al
            JOIN   events e ON (al.detail LIKE '%' || e.id || '%')
            LEFT JOIN activity_log op ON (
                op.user_id = al.user_id
                AND op.action = 'event_opened'
                AND op.detail = e.id
                AND datetime(op.created_at) < datetime(al.created_at, '+30 minutes')
            )
            WHERE  al.user_id = ?
              AND  al.action  = 'alert_email_sent'
            LIMIT  200
        """, (uid,)) as cur:
            rows = await cur.fetchall()

    samples = [(dict(r), r["opened"]) for r in rows]
    if len(samples) < 15:
        return JSONResponse({
            "status": "insufficient_data",
            "message": f"Need at least 15 alert interactions (have {len(samples)})",
            "samples": len(samples),
        })

    model_bytes = train_alert_filter(samples)
    if model_bytes is None:
        return JSONResponse({"status": "training_failed",
                             "message": "Could not train classifier (sklearn unavailable or imbalanced data)"})

    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO user_models (user_id, model_type, model_data, updated_at)
            VALUES (?, 'alert_filter', ?, datetime('now'))
            ON CONFLICT(user_id, model_type) DO UPDATE SET
                model_data = excluded.model_data,
                updated_at = datetime('now')
        """, (uid, model_to_b64(model_bytes)))
        await db.commit()

    return JSONResponse({
        "status":       "trained",
        "samples_used": len(samples),
        "positive_rate": round(sum(1 for _,l in samples if l)/len(samples), 3),
    })


# ── 5.  Alert filter prediction ───────────────────────────────────────────────

@router.get("/alert-relevance/{event_id}")
async def predict_alert_relevance_for_event(
    event_id: str,
    user=Depends(require_user),
):
    """
    Predict how likely this user is to open an alert for this event.
    Used by the scheduler to skip low-probability alerts.
    """
    if not settings.enable_ml_features:
        return JSONResponse({"probability": 0.5, "model_available": False})

    uid = user["id"]
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT model_data FROM user_models WHERE user_id=? AND model_type='alert_filter'",
            (uid,)
        ) as cur:
            row = await cur.fetchone()
        async with db.execute(
            "SELECT * FROM events WHERE id=?", (event_id,)
        ) as cur:
            ev_row = await cur.fetchone()

    if not row or not ev_row:
        return JSONResponse({"probability": 0.5, "model_available": False})

    model_bytes = model_from_b64(row["model_data"])
    prob        = predict_alert_relevance(model_bytes, dict(ev_row))
    return JSONResponse({"probability": prob, "model_available": True})
