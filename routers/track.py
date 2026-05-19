"""
WorldLens — Activity tracking + Reading list + AI feedback
"""
from __future__ import annotations
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from auth import require_user, get_current_user
from config import settings
from db import get_db

router = APIRouter(tags=["tracking"])
logger = logging.getLogger(__name__)


def _json_safe(obj):
    import datetime as _dt
    if isinstance(obj, dict): return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list): return [_json_safe(i) for i in obj]
    if isinstance(obj, (_dt.datetime, _dt.date)): return obj.isoformat()
    return obj


class TrackPayload(BaseModel):
    action:  str
    section: str = ""
    detail:  str = ""

class SavePayload(BaseModel):
    event_id: str
    note:     str = ""

class FeedbackPayload(BaseModel):
    question: str
    answer:   str
    context:  str = ""
    rating:   int


@router.post("/api/track")
async def track_action(payload: TrackPayload, user=Depends(get_current_user)):
    if not user:
        return {"ok": True}
    action  = (payload.action  or "").strip()[:64]
    if not action:
        return {"ok": True}
    section = (payload.section or "").strip()[:32]
    detail  = (payload.detail  or "").strip()[:256]
    try:
        async with get_db() as db:
            await db.execute(
                "INSERT INTO activity_log (user_id, action, section, detail) VALUES (?,?,?,?)",
                (user["id"], action, section, detail)
            )
            await db.commit()
    except Exception as e:
        logger.debug("track_action error: %s", e)
    return {"ok": True}


@router.get("/api/saved")
async def list_saved(user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute("""
            SELECT s.event_id, s.note, s.created_at,
                   e.title, e.category, e.severity, e.country_name,
                   e.timestamp, e.url, e.sentiment_tone
            FROM   saved_events s
            LEFT JOIN events e ON e.id = s.event_id
            WHERE  s.user_id = ?
            ORDER  BY s.created_at DESC
            LIMIT  200
        """, (user["id"],)) as cur:
            rows = [_json_safe(dict(r)) for r in await cur.fetchall()]
    return {"saved": rows}


@router.post("/api/saved")
async def save_event(payload: SavePayload, user=Depends(require_user)):
    eid = payload.event_id.strip()[:64]
    if not eid:
        raise HTTPException(400, "event_id required")
    async with get_db() as db:
        await db.execute("""
            INSERT INTO saved_events (user_id, event_id, note)
            VALUES (?,?,?)
            ON CONFLICT(user_id, event_id) DO UPDATE SET note=EXCLUDED.note
        """, (user["id"], eid, payload.note[:1000]))
        await db.execute(
            "INSERT INTO activity_log (user_id, action, section, detail) VALUES (?,?,?,?)",
            (user["id"], "event_saved", "feed", eid)
        )
        await db.commit()
    return {"saved": True, "event_id": eid}


@router.delete("/api/saved/{event_id}")
async def unsave_event(event_id: str, user=Depends(require_user)):
    async with get_db() as db:
        await db.execute(
            "DELETE FROM saved_events WHERE user_id=? AND event_id=?",
            (user["id"], event_id)
        )
        await db.commit()
    return {"deleted": True}


@router.patch("/api/saved/{event_id}")
async def update_note(event_id: str, payload: SavePayload, user=Depends(require_user)):
    async with get_db() as db:
        await db.execute(
            "UPDATE saved_events SET note=? WHERE user_id=? AND event_id=?",
            (payload.note[:1000], user["id"], event_id)
        )
        await db.commit()
    return {"updated": True}


@router.post("/api/ai/feedback")
async def submit_feedback(payload: FeedbackPayload, user=Depends(require_user)):
    if payload.rating not in (1, -1):
        raise HTTPException(400, "rating must be +1 or -1")
    async with get_db() as db:
        await db.execute(
            "INSERT INTO ai_feedback (user_id, question, answer, context, rating) VALUES (?,?,?,?,?)",
            (user["id"], payload.question[:2000], payload.answer[:4000],
             payload.context[:500], payload.rating)
        )
        await db.execute(
            "INSERT INTO activity_log (user_id, action, section, detail) VALUES (?,?,?,?)",
            (user["id"], "ai_rated", "ai", str(payload.rating))
        )
        await db.commit()
    return {"ok": True}


@router.get("/api/ai/feedback/stats")
async def feedback_stats(user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute("""
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN rating=1  THEN 1 ELSE 0 END) as positive,
                   SUM(CASE WHEN rating=-1 THEN 1 ELSE 0 END) as negative
            FROM ai_feedback WHERE user_id=?
        """, (user["id"],)) as cur:
            row = await cur.fetchone()
    total = row[0] or 0
    pos   = row[1] or 0
    neg   = row[2] or 0
    return {"total": total, "positive": pos, "negative": neg,
            "satisfaction_rate": round(pos / max(total, 1) * 100, 1)}


@router.get("/api/user/affinity")
async def get_affinity(days: int = Query(30, ge=1, le=90), user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute(
            f"SELECT e.category, COUNT(*) as cnt "
            f"FROM activity_log al "
            f"JOIN events e ON e.id = al.detail "
            f"WHERE al.user_id=? AND al.action IN ('event_opened','event_saved') "
            f"AND al.created_at > NOW() - INTERVAL '{int(days)} days' "
            f"GROUP BY e.category ORDER BY cnt DESC",
            (user["id"],)
        ) as cur:
            rows = await cur.fetchall()
    if not rows:
        return {"affinity": {}, "total_interactions": 0}
    total = sum(r[1] for r in rows)
    affinity = {r[0]: round(r[1] / total, 4) for r in rows}
    return {"affinity": affinity, "total_interactions": total, "days": days}


@router.get("/api/admin/export-training-data")
async def export_training_data(
    min_rating: int = Query(1, ge=-1, le=1),
    limit:      int = Query(2000, le=10000),
    user=Depends(require_user),
):
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    async with get_db() as db:
        async with db.execute("""
            SELECT question, answer, context, rating
            FROM   ai_feedback
            WHERE  rating >= ?
            ORDER  BY created_at DESC
            LIMIT  ?
        """, (min_rating, limit)) as cur:
            rows = [_json_safe(dict(r)) for r in await cur.fetchall()]
    examples = [{"input": f"Context: {r['context']}\nQuestion: {r['question']}",
                 "output": r["answer"], "rating": r["rating"]} for r in rows]
    return {"count": len(examples), "examples": examples}
