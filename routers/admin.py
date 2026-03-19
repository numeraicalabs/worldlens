"""World Lens — Admin Dashboard Router"""
from __future__ import annotations
import json
import logging
import aiosqlite
from datetime import datetime, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, Body, HTTPException, Query
from auth import require_admin
from config import settings

router = APIRouter(prefix="/api/admin", tags=["admin"])
logger = logging.getLogger(__name__)

DB = settings.db_path


# ── helpers ──────────────────────────────────────────

async def _log_activity(db, user_id: int, action: str, section: str = "", detail: str = ""):
    try:
        await db.execute(
            "INSERT INTO activity_log (user_id, action, section, detail) VALUES (?,?,?,?)",
            (user_id, action, section, detail)
        )
    except Exception:
        pass


# ── 1. System Overview ────────────────────────────────

@router.get("/overview")
async def overview(admin=Depends(require_admin)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row

        # User counts
        async with db.execute("SELECT COUNT(*) FROM users") as c:
            total_users = (await c.fetchone())[0]
        async with db.execute("SELECT COUNT(*) FROM users WHERE is_active=1") as c:
            active_users = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM users WHERE datetime(last_login)>datetime('now','-24 hours')"
        ) as c:
            dau = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM users WHERE datetime(created_at)>datetime('now','-7 days')"
        ) as c:
            new_this_week = (await c.fetchone())[0]

        # Event counts
        async with db.execute("SELECT COUNT(*) FROM events") as c:
            total_events = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM events WHERE datetime(timestamp)>datetime('now','-24 hours')"
        ) as c:
            events_24h = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM events WHERE impact='High' AND datetime(timestamp)>datetime('now','-24 hours')"
        ) as c:
            high_events = (await c.fetchone())[0]

        # Top regions
        async with db.execute(
            "SELECT country_name, COUNT(*) as n FROM watchlist WHERE type='country' "
            "GROUP BY value ORDER BY n DESC LIMIT 5"
        ) as c:
            top_regions = [dict(r) for r in await c.fetchall()]

        # Top assets
        async with db.execute(
            "SELECT value, label, COUNT(*) as n FROM watchlist WHERE type='asset' "
            "GROUP BY value ORDER BY n DESC LIMIT 5"
        ) as c:
            top_assets = [dict(r) for r in await c.fetchall()]

        # Activity last 7 days (registrations per day)
        async with db.execute(
            "SELECT date(created_at) as day, COUNT(*) as n FROM users "
            "WHERE datetime(created_at)>datetime('now','-7 days') "
            "GROUP BY day ORDER BY day"
        ) as c:
            reg_trend = [dict(r) for r in await c.fetchall()]

        # Most active sections
        async with db.execute(
            "SELECT section, COUNT(*) as n FROM activity_log "
            "WHERE datetime(created_at)>datetime('now','-24 hours') "
            "GROUP BY section ORDER BY n DESC LIMIT 6"
        ) as c:
            section_usage = [dict(r) for r in await c.fetchall()]

        # AI provider breakdown
        async with db.execute(
            "SELECT ai_provider, COUNT(*) as n FROM users GROUP BY ai_provider"
        ) as c:
            ai_providers = [dict(r) for r in await c.fetchall()]

    return {
        "users": {
            "total": total_users, "active": active_users,
            "dau": dau, "new_this_week": new_this_week,
        },
        "events": {
            "total": total_events, "last_24h": events_24h, "high_impact": high_events,
        },
        "top_regions": top_regions,
        "top_assets": top_assets,
        "registration_trend": reg_trend,
        "section_usage": section_usage,
        "ai_providers": ai_providers,
        "system": {
            "anthropic_configured": bool(settings.anthropic_api_key),
            "gemini_configured": bool(settings.gemini_api_key),
            "db_path": settings.db_path,
        },
    }


# ── 2. User Management ────────────────────────────────

@router.get("/users")
async def list_users(
    search: str = Query(""),
    role: str = Query(""),
    active: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    admin=Depends(require_admin)
):
    where = ["1=1"]
    params: list = []
    if search:
        where.append("(email LIKE ? OR username LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    if role:
        where.append("role = ?"); params.append(role)
    if active is not None:
        where.append("is_active = ?"); params.append(active)

    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, email, username, avatar_color, role, is_admin, is_active, "
            "ai_provider, onboarding_done, experience_level, created_at, last_login "
            "FROM users WHERE " + " AND ".join(where) +
            " ORDER BY created_at DESC LIMIT ? OFFSET ?",
            params + [limit, offset]
        ) as c:
            users = [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT COUNT(*) FROM users WHERE " + " AND ".join(where), params) as c:
            total = (await c.fetchone())[0]

    # Enrich with watchlist count + alert count
    async with aiosqlite.connect(DB) as db:
        for u in users:
            async with db.execute("SELECT COUNT(*) FROM watchlist WHERE user_id=?", (u["id"],)) as c:
                u["watchlist_count"] = (await c.fetchone())[0]
            async with db.execute("SELECT COUNT(*) FROM alerts WHERE user_id=?", (u["id"],)) as c:
                u["alert_count"] = (await c.fetchone())[0]
            async with db.execute(
                "SELECT COUNT(*) FROM activity_log WHERE user_id=? AND datetime(created_at)>datetime('now','-7 days')",
                (u["id"],)
            ) as c:
                u["activity_7d"] = (await c.fetchone())[0]

    return {"users": users, "total": total, "limit": limit, "offset": offset}


@router.get("/users/{user_id}")
async def get_user_detail(user_id: int, admin=Depends(require_admin)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM users WHERE id=?", (user_id,)) as c:
            row = await c.fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        u = dict(row)
        for f in ("interests", "regions", "market_prefs"):
            try:
                u[f] = json.loads(u.get(f) or "[]")
            except Exception:
                u[f] = []
        # Remove sensitive
        u.pop("password_hash", None)
        u.pop("user_anthropic_key", None)
        u.pop("user_gemini_key", None)

        async with db.execute("SELECT * FROM watchlist WHERE user_id=? ORDER BY type, label", (user_id,)) as c:
            u["watchlist"] = [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC", (user_id,)) as c:
            u["alerts"] = [dict(r) for r in await c.fetchall()]
        async with db.execute(
            "SELECT action, section, detail, created_at FROM activity_log WHERE user_id=? "
            "ORDER BY created_at DESC LIMIT 30", (user_id,)
        ) as c:
            u["recent_activity"] = [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT * FROM user_xp WHERE user_id=?", (user_id,)) as c:
            row2 = await c.fetchone()
            u["xp"] = dict(row2) if row2 else {}

    return u


@router.put("/users/{user_id}")
async def update_user(user_id: int, payload: dict = Body(...), admin=Depends(require_admin)):
    allowed = {"role", "is_admin", "is_active", "username"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields to update")
    sets = ", ".join(f"{k}=?" for k in updates)
    async with aiosqlite.connect(DB) as db:
        await db.execute(f"UPDATE users SET {sets} WHERE id=?", list(updates.values()) + [user_id])
        await _log_activity(db, admin["id"], "admin_user_update", "admin",
                            f"Updated user {user_id}: {list(updates.keys())}")
        await db.commit()
    return {"status": "ok", "updated": list(updates.keys())}


@router.delete("/users/{user_id}")
async def delete_user(user_id: int, admin=Depends(require_admin)):
    if user_id == admin["id"]:
        raise HTTPException(400, "Cannot delete your own admin account")
    async with aiosqlite.connect(DB) as db:
        await db.execute("DELETE FROM users WHERE id=?", (user_id,))
        await db.execute("DELETE FROM watchlist WHERE user_id=?", (user_id,))
        await db.execute("DELETE FROM alerts WHERE user_id=?", (user_id,))
        await _log_activity(db, admin["id"], "admin_user_delete", "admin", f"Deleted user {user_id}")
        await db.commit()
    return {"status": "deleted"}


@router.post("/users/{user_id}/deactivate")
async def deactivate_user(user_id: int, admin=Depends(require_admin)):
    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE users SET is_active=0 WHERE id=?", (user_id,))
        await _log_activity(db, admin["id"], "admin_deactivate", "admin", f"Deactivated user {user_id}")
        await db.commit()
    return {"status": "deactivated"}


@router.post("/users/{user_id}/activate")
async def activate_user(user_id: int, admin=Depends(require_admin)):
    async with aiosqlite.connect(DB) as db:
        await db.execute("UPDATE users SET is_active=1 WHERE id=?", (user_id,))
        await db.commit()
    return {"status": "activated"}


# ── 3. Activity Monitoring ────────────────────────────

@router.get("/activity")
async def get_activity(hours: int = Query(24), limit: int = Query(100), admin=Depends(require_admin)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT a.*, u.username, u.email FROM activity_log a "
            "LEFT JOIN users u ON a.user_id=u.id "
            "WHERE datetime(a.created_at)>datetime('now',?) "
            "ORDER BY a.created_at DESC LIMIT ?",
            (f"-{hours} hours", limit)
        ) as c:
            logs = [dict(r) for r in await c.fetchall()]
        async with db.execute(
            "SELECT section, COUNT(*) as n FROM activity_log "
            "WHERE datetime(created_at)>datetime('now',?) GROUP BY section ORDER BY n DESC",
            (f"-{hours} hours",)
        ) as c:
            by_section = [dict(r) for r in await c.fetchall()]
        async with db.execute(
            "SELECT action, COUNT(*) as n FROM activity_log "
            "WHERE datetime(created_at)>datetime('now',?) GROUP BY action ORDER BY n DESC LIMIT 10",
            (f"-{hours} hours",)
        ) as c:
            by_action = [dict(r) for r in await c.fetchall()]
    return {"logs": logs, "by_section": by_section, "by_action": by_action}


@router.get("/activity/trending")
async def trending_topics(admin=Depends(require_admin)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT value, COUNT(*) as n FROM watchlist WHERE type='country' "
            "GROUP BY value ORDER BY n DESC LIMIT 10"
        ) as c:
            top_countries = [dict(r) for r in await c.fetchall()]
        async with db.execute(
            "SELECT value, label, COUNT(*) as n FROM watchlist WHERE type='asset' "
            "GROUP BY value ORDER BY n DESC LIMIT 10"
        ) as c:
            top_assets = [dict(r) for r in await c.fetchall()]
        async with db.execute(
            "SELECT interests FROM users WHERE interests != '[]' AND interests != ''"
        ) as c:
            rows = await c.fetchall()
        interest_counts: dict = {}
        for (raw,) in rows:
            try:
                for item in json.loads(raw or "[]"):
                    interest_counts[item] = interest_counts.get(item, 0) + 1
            except Exception:
                pass
        top_interests = sorted(interest_counts.items(), key=lambda x: -x[1])[:10]
    return {
        "top_countries": top_countries,
        "top_assets": top_assets,
        "top_interests": [{"interest": k, "n": v} for k, v in top_interests],
    }


# ── 4. Event Management ────────────────────────────────

@router.get("/events")
async def admin_events(
    search: str = Query(""),
    category: str = Query(""),
    impact: str = Query(""),
    flagged: Optional[int] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    admin=Depends(require_admin)
):
    where = ["1=1"]
    params: list = []
    if search:
        where.append("(title LIKE ? OR summary LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]
    if category:
        where.append("category=?"); params.append(category.upper())
    if impact:
        where.append("impact=?"); params.append(impact)
    if flagged is not None:
        where.append("admin_flagged=?"); params.append(flagged)

    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        # Ensure column exists
        async with db.execute("PRAGMA table_info(events)") as c:
            ev_cols = {r[1] for r in await c.fetchall()}
        if "admin_flagged" not in ev_cols:
            await db.execute("ALTER TABLE events ADD COLUMN admin_flagged INTEGER DEFAULT 0")
            await db.execute("ALTER TABLE events ADD COLUMN admin_note TEXT DEFAULT ''")
            await db.commit()

        async with db.execute(
            "SELECT id, timestamp, title, summary, category, source, country_name, country_code, "
            "severity, impact, ai_impact_score, ai_summary, ai_market_note, "
            "sentiment_tone, sentiment_score, admin_flagged, admin_note "
            "FROM events WHERE " + " AND ".join(where) +
            " ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            params + [limit, offset]
        ) as c:
            events = [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT COUNT(*) FROM events WHERE " + " AND ".join(where), params) as c:
            total = (await c.fetchone())[0]

    return {"events": events, "total": total, "limit": limit, "offset": offset}


@router.put("/events/{event_id}")
async def update_event(event_id: str, payload: dict = Body(...), admin=Depends(require_admin)):
    allowed = {"title", "summary", "ai_summary", "ai_market_note", "severity",
               "impact", "admin_flagged", "admin_note"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields")
    sets = ", ".join(f"{k}=?" for k in updates)
    async with aiosqlite.connect(DB) as db:
        await db.execute(f"UPDATE events SET {sets} WHERE id=?", list(updates.values()) + [event_id])
        await _log_activity(db, admin["id"], "admin_event_edit", "events",
                            f"Edited event {event_id[:16]}")
        await db.commit()
    return {"status": "ok"}


@router.delete("/events/{event_id}")
async def delete_event(event_id: str, admin=Depends(require_admin)):
    async with aiosqlite.connect(DB) as db:
        await db.execute("DELETE FROM events WHERE id=?", (event_id,))
        await _log_activity(db, admin["id"], "admin_event_delete", "events",
                            f"Deleted event {event_id[:16]}")
        await db.commit()
    return {"status": "deleted"}


@router.post("/events/{event_id}/flag")
async def flag_event(event_id: str, payload: dict = Body(...), admin=Depends(require_admin)):
    note = payload.get("note", "")
    async with aiosqlite.connect(DB) as db:
        await db.execute(
            "UPDATE events SET admin_flagged=1, admin_note=? WHERE id=?", (note, event_id)
        )
        await db.commit()
    return {"status": "flagged"}


@router.get("/events/duplicates")
async def find_duplicates(hours: int = Query(48), admin=Depends(require_admin)):
    """Find potentially duplicate events (same category + country within 6h)."""
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT category, country_code, country_name, "
            "COUNT(*) as count, GROUP_CONCAT(id, '|') as ids, "
            "GROUP_CONCAT(title, '|||') as titles "
            "FROM events WHERE datetime(timestamp)>datetime('now',?) "
            "GROUP BY category, country_code "
            "HAVING count > 1 ORDER BY count DESC LIMIT 30",
            (f"-{hours} hours",)
        ) as c:
            groups = []
            for r in await c.fetchall():
                d = dict(r)
                d["ids"] = d["ids"].split("|") if d["ids"] else []
                d["titles"] = d["titles"].split("|||") if d["titles"] else []
                groups.append(d)
    return {"duplicate_groups": groups, "total_groups": len(groups)}


# ── 5. AI Monitoring ──────────────────────────────────

@router.get("/ai/outputs")
async def ai_outputs(limit: int = Query(50), admin=Depends(require_admin)):
    """Get recent AI-generated outputs for quality monitoring."""
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, title, category, country_name, severity, impact, "
            "ai_summary, ai_market_note, ai_impact_score, "
            "sentiment_tone, sentiment_score, sentiment_info_type, "
            "timestamp, source "
            "FROM events WHERE ai_summary != '' AND ai_summary IS NOT NULL "
            "ORDER BY timestamp DESC LIMIT ?",
            (limit,)
        ) as c:
            outputs = [dict(r) for r in await c.fetchall()]

    # Stats
    total = len(outputs)
    has_summary   = sum(1 for o in outputs if o.get("ai_summary"))
    has_sentiment = sum(1 for o in outputs if o.get("sentiment_tone"))
    avg_score     = (sum(o.get("ai_impact_score", 5) or 5 for o in outputs) / max(total, 1))

    return {
        "outputs": outputs,
        "stats": {
            "total_with_ai": total,
            "has_summary": has_summary,
            "has_sentiment": has_sentiment,
            "avg_impact_score": round(avg_score, 2),
            "coverage_pct": round(has_summary / max(total, 1) * 100, 1),
        }
    }


@router.put("/ai/outputs/{event_id}")
async def override_ai_output(event_id: str, payload: dict = Body(...), admin=Depends(require_admin)):
    """Admin override of AI-generated fields."""
    allowed = {"ai_summary", "ai_market_note", "ai_impact_score",
               "sentiment_tone", "sentiment_score", "sentiment_info_type"}
    updates = {k: v for k, v in payload.items() if k in allowed}
    if not updates:
        raise HTTPException(400, "No valid fields")
    sets = ", ".join(f"{k}=?" for k in updates)
    async with aiosqlite.connect(DB) as db:
        await db.execute(f"UPDATE events SET {sets} WHERE id=?", list(updates.values()) + [event_id])
        await _log_activity(db, admin["id"], "admin_ai_override", "ai",
                            f"Overrode AI fields for {event_id[:16]}: {list(updates.keys())}")
        await db.commit()
    return {"status": "ok", "overridden": list(updates.keys())}


# ── 6. AI Provider Settings ───────────────────────────

async def _get_app_setting(db, key: str, default: str = "") -> str:
    """Read a value from app_settings table."""
    async with db.execute("SELECT value FROM app_settings WHERE key=?", (key,)) as c:
        row = await c.fetchone()
    return row[0] if row else default


async def _set_app_setting(db, key: str, value: str):
    """Upsert a value into app_settings table."""
    await db.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?,?,datetime('now')) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=datetime('now')",
        (key, value)
    )


@router.get("/settings/ai")
async def get_ai_settings(admin=Depends(require_admin)):
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        # Provider stored in DB overrides config at runtime
        db_provider   = await _get_app_setting(db, "global_ai_provider", settings.global_ai_provider)
        db_gemini_key = await _get_app_setting(db, "gemini_api_key",     settings.gemini_api_key)
        db_claude_key = await _get_app_setting(db, "anthropic_api_key",  settings.anthropic_api_key)

    # Apply runtime overrides
    if db_gemini_key:
        settings.gemini_api_key = db_gemini_key
    if db_claude_key:
        settings.anthropic_api_key = db_claude_key
    settings.global_ai_provider = db_provider

    gemini_ok = bool(settings.gemini_api_key)
    claude_ok = bool(settings.anthropic_api_key)

    return {
        "global_provider":       db_provider,
        # Gemini fields
        "gemini_configured":     gemini_ok,
        "gemini_key_preview":    ("***" + settings.gemini_api_key[-4:]) if gemini_ok else "",
        # Claude fields
        "claude_configured":     claude_ok,
        "claude_key_preview":    ("***" + settings.anthropic_api_key[-4:]) if claude_ok else "",
        # Legacy aliases (backwards compat)
        "anthropic_configured":  claude_ok,
        "anthropic_key_preview": ("***" + settings.anthropic_api_key[-4:]) if claude_ok else "",
        "default_provider":      db_provider,
        # System
        "db_path":               settings.db_path,
    }

@router.post("/settings/ai/provider")
async def set_active_provider(payload: dict = Body(...), admin=Depends(require_admin)):
    """Switch the global AI provider for all users (gemini | claude | none)."""
    provider = payload.get("provider", "").strip()
    if provider not in ("gemini", "claude", "none"):
        raise HTTPException(400, "provider must be 'gemini', 'claude', or 'none'")

    settings.global_ai_provider = provider

    async with aiosqlite.connect(DB) as db:
        await _set_app_setting(db, "global_ai_provider", provider)
        await _log_activity(db, admin["id"], "admin_provider_switch", "settings",
                            f"Switched global AI provider to {provider}")
        await db.commit()

    return {"status": "ok", "global_provider": provider}


@router.post("/settings/ai")
async def update_ai_key(payload: dict = Body(...), admin=Depends(require_admin)):
    """Save a Gemini or Claude API key. Persists to DB and .env if writable."""
    provider = payload.get("provider", "").strip()
    api_key  = payload.get("api_key", "").strip()

    if provider not in ("gemini", "claude"):
        raise HTTPException(400, "provider must be 'gemini' or 'claude'")
    if not api_key:
        raise HTTPException(400, "api_key cannot be empty")

    # Update in-memory settings
    if provider == "gemini":
        settings.gemini_api_key = api_key
        db_key = "gemini_api_key"
        env_key = "GEMINI_API_KEY"
    else:
        settings.anthropic_api_key = api_key
        db_key = "anthropic_api_key"
        env_key = "ANTHROPIC_API_KEY"

    # Persist to DB
    async with aiosqlite.connect(DB) as db:
        await _set_app_setting(db, db_key, api_key)
        await _log_activity(db, admin["id"], "admin_ai_key_update", "settings",
                            f"Updated {provider} API key")
        await db.commit()

    # Try to persist to .env as well
    persisted = False
    try:
        from pathlib import Path
        env_path = Path(settings.db_path).parent / ".env"
        lines = env_path.read_text().splitlines() if env_path.exists() else []
        found = False
        new_lines = []
        for line in lines:
            if line.startswith(env_key + "="):
                new_lines.append(f"{env_key}={api_key}")
                found = True
            else:
                new_lines.append(line)
        if not found:
            new_lines.append(f"{env_key}={api_key}")
        env_path.write_text("\n".join(new_lines) + "\n")
        persisted = True
    except Exception:
        pass

    return {"status": "ok", "provider": provider, "persisted_to_env": persisted}


@router.post("/settings/make-admin")
async def make_admin(payload: dict = Body(...), admin=Depends(require_admin)):
    """Promote a user to admin."""
    email = payload.get("email", "").lower()
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT id FROM users WHERE email=?", (email,)) as c:
            row = await c.fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        await db.execute("UPDATE users SET is_admin=1, role='admin' WHERE email=?", (email,))
        await _log_activity(db, admin["id"], "admin_promote", "settings", f"Promoted {email}")
        await db.commit()
    return {"status": "ok", "promoted": email}


# ── Activity logger helper (called from other routers) ─

async def log_user_action(user_id: int, action: str, section: str = "", detail: str = ""):
    """Can be imported by other routers to log activity."""
    try:
        async with aiosqlite.connect(DB) as db:
            await db.execute(
                "INSERT OR IGNORE INTO activity_log (user_id, action, section, detail) VALUES (?,?,?,?)",
                (user_id, action, section, detail)
            )
            await db.commit()
    except Exception:
        pass
