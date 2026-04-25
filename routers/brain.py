"""
WorldLens Brain — Per-user RAG system with SQLite FTS5
-------------------------------------------------------
• Every user interaction feeds the brain automatically
• Agent bots search the brain before calling Gemini
• Admin panel shows brain stats per user
• Brain grows the more the app is used
"""
from __future__ import annotations
import json
import logging
import hashlib
import re
from datetime import datetime, date
from typing import Optional, List, Dict, Any

import aiosqlite
from fastapi import APIRouter, Depends, Body, HTTPException
from auth import require_user, require_admin
from config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/brain", tags=["brain"])

# ── Schema ──────────────────────────────────────────────────────────────────

BRAIN_SCHEMA = """
CREATE TABLE IF NOT EXISTS brain_entries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    content     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual',   -- event|watchlist|market|ew|alert|question|analysis|interaction
    topic       TEXT DEFAULT '',                   -- finance|geopolitics|macro|security|tech|...
    weight      REAL DEFAULT 1.0,                  -- higher = more important
    context     TEXT DEFAULT '{}',                 -- JSON metadata
    timestamp   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(
    content,
    topic,
    source,
    content=brain_entries,
    content_rowid=id,
    tokenize='porter unicode61'
);

CREATE TRIGGER IF NOT EXISTS brain_entries_ai
    AFTER INSERT ON brain_entries BEGIN
    INSERT INTO brain_fts(rowid, content, topic, source)
    VALUES (new.id, new.content, new.topic, new.source);
END;

CREATE TRIGGER IF NOT EXISTS brain_entries_ad
    AFTER DELETE ON brain_entries BEGIN
    INSERT INTO brain_fts(brain_fts, rowid, content, topic, source)
    VALUES ('delete', old.id, old.content, old.topic, old.source);
END;

CREATE TABLE IF NOT EXISTS brain_sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    session_date TEXT DEFAULT (date('now')),
    interactions INTEGER DEFAULT 0,
    entries_added INTEGER DEFAULT 0,
    topics_touched TEXT DEFAULT '[]',
    UNIQUE(user_id, session_date),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_brain_user ON brain_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_brain_source ON brain_entries(source);
CREATE INDEX IF NOT EXISTS idx_brain_topic ON brain_entries(topic);
CREATE INDEX IF NOT EXISTS idx_brain_ts ON brain_entries(timestamp DESC);
"""

# ── DB helpers ───────────────────────────────────────────────────────────────

async def ensure_brain_tables(db: aiosqlite.Connection):
    for stmt in BRAIN_SCHEMA.split(";"):
        s = stmt.strip()
        if s:
            try:
                await db.execute(s)
            except Exception as e:
                logger.debug("brain schema stmt: %s — %s", s[:60], e)
    await db.commit()


async def _classify_topic(text: str) -> str:
    text = text.lower()
    if any(w in text for w in ["fed", "ecb", "rate", "gdp", "inflation", "macro", "yield", "bond", "treasury"]):
        return "macro"
    if any(w in text for w in ["stock", "market", "equity", "etf", "index", "s&p", "nasdaq", "dow", "earnings"]):
        return "finance"
    if any(w in text for w in ["war", "conflict", "military", "attack", "missile", "troops", "nato", "sanction"]):
        return "security"
    if any(w in text for w in ["ai", "chip", "tech", "silicon", "nvidia", "microsoft", "google", "apple", "semiconductor"]):
        return "tech"
    if any(w in text for w in ["oil", "gas", "energy", "opec", "brent", "crude", "lng", "pipeline"]):
        return "energy"
    if any(w in text for w in ["election", "president", "government", "vote", "policy", "congress", "parliament"]):
        return "politics"
    if any(w in text for w in ["trade", "tariff", "export", "import", "supply chain", "wto"]):
        return "trade"
    if any(w in text for w in ["climate", "carbon", "emission", "green", "renewable", "drought", "flood"]):
        return "climate"
    return "geopolitics"


def _dedup_hash(user_id: int, content: str) -> str:
    return hashlib.md5(f"{user_id}:{content[:200]}".encode()).hexdigest()


# ── Core brain API ───────────────────────────────────────────────────────────

async def brain_ingest(
    user_id: int,
    content: str,
    source: str = "interaction",
    weight: float = 1.0,
    context: dict = None,
    db: Optional[aiosqlite.Connection] = None,
) -> bool:
    """Add a piece of knowledge to the user's brain. Deduplicates automatically."""
    if not content or len(content.strip()) < 15:
        return False

    content = content.strip()[:1000]  # cap length
    topic = await _classify_topic(content)
    ctx_json = json.dumps(context or {})

    close_after = db is None
    if db is None:
        db = await aiosqlite.connect(settings.db_path)
        await ensure_brain_tables(db)

    try:
        # Dedup: skip if same content ingested in last 24h
        dup_check = hashlib.md5(f"{user_id}:{content[:120]}".encode()).hexdigest()
        async with db.execute(
            "SELECT id FROM brain_entries WHERE user_id=? AND "
            "substr(content,1,120)=? AND "
            "datetime(timestamp) > datetime('now','-24 hours')",
            (user_id, content[:120])
        ) as cur:
            if await cur.fetchone():
                return False  # already ingested recently

        await db.execute(
            "INSERT INTO brain_entries (user_id, content, source, topic, weight, context) "
            "VALUES (?,?,?,?,?,?)",
            (user_id, content, source, topic, weight, ctx_json)
        )

        # Update session stats
        today = date.today().isoformat()
        await db.execute(
            "INSERT INTO brain_sessions (user_id, session_date, entries_added) "
            "VALUES (?,?,1) ON CONFLICT(user_id,session_date) DO UPDATE SET "
            "entries_added=entries_added+1, interactions=interactions+1",
            (user_id, today)
        )
        await db.commit()
        return True
    except Exception as e:
        logger.warning("brain_ingest error user=%s: %s", user_id, e)
        return False
    finally:
        if close_after:
            await db.close()


async def brain_search(
    user_id: int,
    query: str,
    top_k: int = 5,
    source_filter: Optional[str] = None,
    topic_filter: Optional[str] = None,
) -> List[Dict]:
    """Full-text search in user's brain. Returns ranked results."""
    if not query or len(query.strip()) < 3:
        return []

    # Clean query for FTS5
    clean_query = re.sub(r'[^\w\s]', ' ', query).strip()
    clean_query = " OR ".join(clean_query.split()[:8])  # FTS5 OR logic

    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            await ensure_brain_tables(db)

            if source_filter:
                sql = """
                    SELECT b.id, b.content, b.source, b.topic, b.weight, b.timestamp,
                           bm25(brain_fts) as score
                    FROM brain_fts
                    JOIN brain_entries b ON brain_fts.rowid = b.id
                    WHERE brain_fts MATCH ? AND b.user_id=? AND b.source=?
                    ORDER BY b.weight * (-score) DESC
                    LIMIT ?
                """
                params = (clean_query, user_id, source_filter, top_k)
            elif topic_filter:
                sql = """
                    SELECT b.id, b.content, b.source, b.topic, b.weight, b.timestamp,
                           bm25(brain_fts) as score
                    FROM brain_fts
                    JOIN brain_entries b ON brain_fts.rowid = b.id
                    WHERE brain_fts MATCH ? AND b.user_id=? AND b.topic=?
                    ORDER BY b.weight * (-score) DESC
                    LIMIT ?
                """
                params = (clean_query, user_id, topic_filter, top_k)
            else:
                sql = """
                    SELECT b.id, b.content, b.source, b.topic, b.weight, b.timestamp,
                           bm25(brain_fts) as score
                    FROM brain_fts
                    JOIN brain_entries b ON brain_fts.rowid = b.id
                    WHERE brain_fts MATCH ? AND b.user_id=?
                    ORDER BY b.weight * (-score) DESC
                    LIMIT ?
                """
                params = (clean_query, user_id, top_k)

            async with db.execute(sql, params) as cur:
                rows = await cur.fetchall()

            return [dict(r) for r in rows]
    except Exception as e:
        logger.warning("brain_search error user=%s query=%s: %s", user_id, query[:40], e)
        return []


async def brain_context_for_prompt(
    user_id: int,
    query: str,
    top_k: int = 5,
) -> str:
    """Build a context string from brain search results for prompt injection."""
    results = await brain_search(user_id, query, top_k=top_k)
    if not results:
        return ""

    lines = ["[USER BRAIN CONTEXT — learned from previous interactions]"]
    for r in results:
        ts = r.get("timestamp", "")[:10]
        src = r.get("source", "?")
        topic = r.get("topic", "")
        lines.append(f"• [{ts}][{src}/{topic}] {r['content'][:200]}")
    lines.append("[END BRAIN CONTEXT]")
    return "\n".join(lines)


# ── HTTP endpoints ────────────────────────────────────────────────────────────

class FeedRequest:
    pass


@router.post("/feed")
async def feed_brain(payload: dict = Body(...), user=Depends(require_user)):
    """Ingest knowledge into the user's brain from the frontend."""
    content = (payload.get("content") or "").strip()
    source  = payload.get("source", "interaction")
    weight  = float(payload.get("weight", 1.0))
    context = payload.get("context", {})

    if not content:
        raise HTTPException(400, "content required")

    ok = await brain_ingest(user["id"], content, source=source, weight=weight, context=context)
    return {"ok": ok, "source": source}


@router.post("/feed/batch")
async def feed_brain_batch(payload: dict = Body(...), user=Depends(require_user)):
    """Ingest multiple entries at once."""
    entries = payload.get("entries", [])
    added = 0
    async with aiosqlite.connect(settings.db_path) as db:
        await ensure_brain_tables(db)
        for e in entries[:50]:  # cap at 50 per batch
            content = (e.get("content") or "").strip()
            if content:
                ok = await brain_ingest(
                    user["id"], content,
                    source=e.get("source", "batch"),
                    weight=float(e.get("weight", 1.0)),
                    context=e.get("context", {}),
                    db=db
                )
                if ok:
                    added += 1
    return {"added": added, "total": len(entries)}


@router.get("/search")
async def search_brain(q: str, top_k: int = 5, user=Depends(require_user)):
    """Search the user's brain."""
    results = await brain_search(user["id"], q, top_k=min(top_k, 20))
    return {"results": results, "count": len(results)}


@router.get("/stats")
async def brain_stats(user=Depends(require_user)):
    """Per-user brain statistics."""
    uid = user["id"]
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            await ensure_brain_tables(db)

            # Total entries
            async with db.execute(
                "SELECT COUNT(*) as n FROM brain_entries WHERE user_id=?", (uid,)
            ) as c:
                total = (await c.fetchone())["n"]

            # By source
            async with db.execute(
                "SELECT source, COUNT(*) as n FROM brain_entries WHERE user_id=? "
                "GROUP BY source ORDER BY n DESC", (uid,)
            ) as c:
                by_source = [dict(r) for r in await c.fetchall()]

            # By topic
            async with db.execute(
                "SELECT topic, COUNT(*) as n FROM brain_entries WHERE user_id=? "
                "GROUP BY topic ORDER BY n DESC LIMIT 8", (uid,)
            ) as c:
                by_topic = [dict(r) for r in await c.fetchall()]

            # Growth last 14 days
            async with db.execute(
                "SELECT date(timestamp) as day, COUNT(*) as n FROM brain_entries "
                "WHERE user_id=? AND datetime(timestamp) > datetime('now','-14 days') "
                "GROUP BY day ORDER BY day ASC", (uid,)
            ) as c:
                growth = [dict(r) for r in await c.fetchall()]

            # Recent entries preview
            async with db.execute(
                "SELECT content, source, topic, timestamp FROM brain_entries "
                "WHERE user_id=? ORDER BY timestamp DESC LIMIT 5", (uid,)
            ) as c:
                recent = [dict(r) for r in await c.fetchall()]

            # Session today
            async with db.execute(
                "SELECT * FROM brain_sessions WHERE user_id=? AND session_date=?",
                (uid, date.today().isoformat())
            ) as c:
                today_session = await c.fetchone()
                today_session = dict(today_session) if today_session else {}

        return {
            "total_entries": total,
            "by_source": by_source,
            "by_topic": by_topic,
            "growth": growth,
            "recent": recent,
            "today": today_session,
            "brain_level": _brain_level(total),
        }
    except Exception as e:
        logger.warning("brain_stats error: %s", e)
        return {"total_entries": 0, "by_source": [], "by_topic": [], "growth": [], "recent": [], "today": {}, "brain_level": "seed"}


def _brain_level(total: int) -> str:
    if total < 20:   return "seed"
    if total < 100:  return "growing"
    if total < 500:  return "active"
    if total < 2000: return "advanced"
    return "expert"


@router.delete("/reset")
async def reset_brain(user=Depends(require_user)):
    """Clear the user's own brain."""
    async with aiosqlite.connect(settings.db_path) as db:
        await ensure_brain_tables(db)
        await db.execute("DELETE FROM brain_entries WHERE user_id=?", (user["id"],))
        await db.execute("DELETE FROM brain_sessions WHERE user_id=?", (user["id"],))
        # Rebuild FTS index
        await db.execute("INSERT INTO brain_fts(brain_fts) VALUES('rebuild')")
        await db.commit()
    return {"ok": True}


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/admin/stats")
async def admin_brain_stats(_=Depends(require_admin)):
    """Admin: global brain statistics across all users."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_brain_tables(db)

        async with db.execute("SELECT COUNT(*) as n FROM brain_entries") as c:
            total = (await c.fetchone())["n"]

        async with db.execute(
            "SELECT user_id, COUNT(*) as entries, MAX(timestamp) as last_active "
            "FROM brain_entries GROUP BY user_id ORDER BY entries DESC LIMIT 20"
        ) as c:
            by_user = [dict(r) for r in await c.fetchall()]

        # Enrich with usernames
        user_ids = [r["user_id"] for r in by_user]
        if user_ids:
            placeholders = ",".join("?" * len(user_ids))
            async with db.execute(
                f"SELECT id, username, email FROM users WHERE id IN ({placeholders})",
                user_ids
            ) as c:
                users = {r["id"]: dict(r) for r in await c.fetchall()}
            for r in by_user:
                u = users.get(r["user_id"], {})
                r["username"] = u.get("username", "?")
                r["email"] = u.get("email", "")

        async with db.execute(
            "SELECT source, COUNT(*) as n FROM brain_entries GROUP BY source ORDER BY n DESC"
        ) as c:
            by_source = [dict(r) for r in await c.fetchall()]

        async with db.execute(
            "SELECT topic, COUNT(*) as n FROM brain_entries GROUP BY topic ORDER BY n DESC"
        ) as c:
            by_topic = [dict(r) for r in await c.fetchall()]

        async with db.execute(
            "SELECT date(timestamp) as day, COUNT(*) as n FROM brain_entries "
            "WHERE datetime(timestamp) > datetime('now','-30 days') "
            "GROUP BY day ORDER BY day ASC"
        ) as c:
            growth = [dict(r) for r in await c.fetchall()]

    return {
        "total_entries": total,
        "by_user": by_user,
        "by_source": by_source,
        "by_topic": by_topic,
        "growth": growth,
    }


@router.post("/admin/inject")
async def admin_inject_global(_=Depends(require_admin), payload: dict = Body(...)):
    """Admin: inject a piece of knowledge into ALL users' brains (global knowledge)."""
    content = (payload.get("content") or "").strip()
    source  = payload.get("source", "admin_inject")
    weight  = float(payload.get("weight", 2.0))  # admin injections have higher weight

    if not content:
        raise HTTPException(400, "content required")

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_brain_tables(db)
        async with db.execute("SELECT id FROM users WHERE is_active=1") as c:
            user_ids = [r["id"] for r in await c.fetchall()]

    injected = 0
    for uid in user_ids:
        ok = await brain_ingest(uid, content, source=source, weight=weight)
        if ok:
            injected += 1

    return {"ok": True, "injected_to": injected, "total_users": len(user_ids)}


@router.delete("/admin/user/{user_id}")
async def admin_reset_user_brain(user_id: int, _=Depends(require_admin)):
    """Admin: reset a specific user's brain."""
    async with aiosqlite.connect(settings.db_path) as db:
        await ensure_brain_tables(db)
        await db.execute("DELETE FROM brain_entries WHERE user_id=?", (user_id,))
        await db.execute("DELETE FROM brain_sessions WHERE user_id=?", (user_id,))
        await db.execute("INSERT INTO brain_fts(brain_fts) VALUES('rebuild')")
        await db.commit()
    return {"ok": True, "user_id": user_id}


@router.get("/admin/user/{user_id}/entries")
async def admin_user_brain_entries(user_id: int, limit: int = 50, _=Depends(require_admin)):
    """Admin: read a user's brain entries."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_brain_tables(db)
        async with db.execute(
            "SELECT * FROM brain_entries WHERE user_id=? ORDER BY timestamp DESC LIMIT ?",
            (user_id, limit)
        ) as c:
            entries = [dict(r) for r in await c.fetchall()]
    return {"entries": entries, "count": len(entries)}
