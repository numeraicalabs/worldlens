"""
WorldLens — Activity tracking + Reading list + AI feedback

Three responsibilities:
  POST /api/track              — log any user action (fire-and-forget from frontend)
  GET/POST/DELETE /api/saved   — reading list (saved events + private notes)
  POST /api/ai/feedback        — thumbs up/down on AI responses
  GET  /api/user/affinity      — category affinity vector (for personalisation)
"""
from __future__ import annotations
import json
import logging
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from auth import require_user, get_current_user
from config import settings

router = APIRouter(tags=["tracking"])
logger = logging.getLogger(__name__)
DB = settings.db_path


# ── Models ──────────────────────────────────────────────────────────

class TrackPayload(BaseModel):
    action:  str
    section: str = ""
    detail:  str = ""   # JSON string or plain string

class SavePayload(BaseModel):
    event_id: str
    note:     str = ""

class FeedbackPayload(BaseModel):
    question: str
    answer:   str
    context:  str = ""
    rating:   int   # +1 or -1


# ── 1.  Activity tracking ────────────────────────────────────────────

@router.post("/api/track")
async def track_action(
    payload: TrackPayload,
    user=Depends(get_current_user),   # optional — guests don't break the call
):
    """
    Fire-and-forget from the frontend.
    Validates just enough to not crash; never returns an error to the client.
    """
    if not user:
        return {"ok": True}

    action = (payload.action or "").strip()[:64]
    if not action:
        return {"ok": True}

    section = (payload.section or "").strip()[:32]
    detail  = (payload.detail  or "").strip()[:256]

    try:
        async with aiosqlite.connect(DB) as db:
            await db.execute(
                "INSERT INTO activity_log (user_id, action, section, detail) VALUES (?,?,?,?)",
                (user["id"], action, section, detail)
            )
            await db.commit()
    except Exception as e:
        logger.debug("track_action error: %s", e)

    return {"ok": True}


# ── 2.  Reading list (saved events + notes) ─────────────────────────

@router.get("/api/saved")
async def list_saved(user=Depends(require_user)):
    """Return all events saved by the current user, newest first."""
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
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
            rows = [dict(r) for r in await cur.fetchall()]
    return {"saved": rows}


@router.post("/api/saved")
async def save_event(payload: SavePayload, user=Depends(require_user)):
    """Save (or update note on) an event."""
    eid = payload.event_id.strip()[:64]
    if not eid:
        raise HTTPException(400, "event_id required")

    async with aiosqlite.connect(DB) as db:
        await db.execute("""
            INSERT INTO saved_events (user_id, event_id, note)
            VALUES (?,?,?)
            ON CONFLICT(user_id, event_id) DO UPDATE SET note=excluded.note
        """, (user["id"], eid, payload.note[:1000]))
        await db.commit()

        # Log the save action
        await db.execute(
            "INSERT INTO activity_log (user_id, action, section, detail) VALUES (?,?,?,?)",
            (user["id"], "event_saved", "feed", eid)
        )
        await db.commit()

    return {"saved": True, "event_id": eid}


@router.delete("/api/saved/{event_id}")
async def unsave_event(event_id: str, user=Depends(require_user)):
    """Remove event from reading list."""
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "DELETE FROM saved_events WHERE user_id=? AND event_id=?",
            (user["id"], event_id)
        )
        await db.commit()
    return {"deleted": True}


@router.patch("/api/saved/{event_id}")
async def update_note(event_id: str, payload: SavePayload, user=Depends(require_user)):
    """Update private note on a saved event."""
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE saved_events SET note=? WHERE user_id=? AND event_id=?",
            (payload.note[:1000], user["id"], event_id)
        )
        await db.commit()
    return {"updated": True}


# ── 3.  AI feedback (thumbs up/down) ────────────────────────────────

@router.post("/api/ai/feedback")
async def submit_feedback(payload: FeedbackPayload, user=Depends(require_user)):
    """
    Store a rating for an AI response.
    Builds the dataset for future fine-tuning.
    """
    if payload.rating not in (1, -1):
        raise HTTPException(400, "rating must be +1 or -1")

    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "INSERT INTO ai_feedback (user_id, question, answer, context, rating) VALUES (?,?,?,?,?)",
            (
                user["id"],
                payload.question[:2000],
                payload.answer[:4000],
                payload.context[:500],
                payload.rating,
            )
        )
        await db.commit()

        # Log for activity tracking
        await db.execute(
            "INSERT INTO activity_log (user_id, action, section, detail) VALUES (?,?,?,?)",
            (user["id"], "ai_rated", "ai", str(payload.rating))
        )
        await db.commit()

    return {"ok": True}


@router.get("/api/ai/feedback/stats")
async def feedback_stats(user=Depends(require_user)):
    """Return aggregate feedback stats for the current user."""
    async with aiosqlite.connect(DB) as db:
        async with db.execute("""
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN rating=1  THEN 1 ELSE 0 END) as positive,
                SUM(CASE WHEN rating=-1 THEN 1 ELSE 0 END) as negative
            FROM ai_feedback WHERE user_id=?
        """, (user["id"],)) as cur:
            row = await cur.fetchone()
    total, pos, neg = row if row else (0, 0, 0)
    return {"total": total, "positive": pos, "negative": neg,
            "satisfaction_rate": round(pos/max(total,1)*100, 1)}


# ── 4.  Category affinity vector ────────────────────────────────────

@router.get("/api/user/affinity")
async def get_affinity(
    days: int = Query(30, ge=1, le=90),
    user=Depends(require_user),
):
    """
    Calculate the user's real interest profile from the last `days` days.
    Returns category weights 0-1, normalised so they sum to 1.
    Used by the frontend to re-sort the dashboard feed.
    """
    async with aiosqlite.connect(DB) as db:
        # Count events opened per category
        async with db.execute("""
            SELECT e.category, COUNT(*) as cnt
            FROM   activity_log al
            JOIN   events e ON e.id = al.detail
            WHERE  al.user_id=?
              AND  al.action IN ('event_opened','event_saved')
              AND  al.created_at > datetime('now', ? )
            GROUP  BY e.category
            ORDER  BY cnt DESC
        """, (user["id"], f"-{days} days")) as cur:
            rows = await cur.fetchall()

    if not rows:
        return {"affinity": {}, "total_interactions": 0}

    total = sum(r[1] for r in rows)
    affinity = {r[0]: round(r[1] / total, 4) for r in rows}
    return {"affinity": affinity, "total_interactions": total, "days": days}


# ── 5.  Admin: export AI feedback for fine-tuning ────────────────────

@router.get("/api/admin/export-training-data")
async def export_training_data(
    min_rating: int = Query(1, ge=-1, le=1),
    limit:      int = Query(2000, le=10000),
    user=Depends(require_user),
):
    """Export AI feedback as JSONL for fine-tuning. Admin only."""
    if not user.get("is_admin"):
        raise HTTPException(403, "Admin only")

    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("""
            SELECT question, answer, context, rating
            FROM   ai_feedback
            WHERE  rating >= ?
            ORDER  BY created_at DESC
            LIMIT  ?
        """, (min_rating, limit)) as cur:
            rows = [dict(r) for r in await cur.fetchall()]

    # Format as JSONL training examples
    examples = []
    for r in rows:
        examples.append({
            "input":  f"Context: {r['context']}\nQuestion: {r['question']}",
            "output": r["answer"],
            "rating": r["rating"],
        })

    return {"count": len(examples), "examples": examples}
