"""World Lens — Engagement: AI Insights, Daily Missions, Predictions, Weekly Report, Risk Radar"""
from __future__ import annotations
import json
import hashlib
import aiosqlite
from datetime import datetime, timedelta, date
from typing import Optional, List, Dict
from fastapi import APIRouter, Depends, Body, HTTPException
from auth import require_user
from config import settings
from ai_layer import _call_claude, _parse_json, ai_available_async

router = APIRouter(prefix="/api/engage", tags=["engage"])

# ── DB helpers ────────────────────────────────────────
async def _ensure_tables(db):
    await db.executescript("""
    CREATE TABLE IF NOT EXISTS daily_insights (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        insight TEXT NOT NULL,
        relevance_score REAL DEFAULT 5.0,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, date),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS daily_missions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        mission_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        xp_reward INTEGER DEFAULT 10,
        completed INTEGER DEFAULT 0,
        completed_at TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, date, mission_id)
    );
    CREATE TABLE IF NOT EXISTS predictions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        question TEXT NOT NULL,
        event_id TEXT,
        event_title TEXT,
        direction TEXT NOT NULL,
        asset TEXT DEFAULT 'Oil',
        created_at TEXT DEFAULT (datetime('now')),
        resolves_at TEXT NOT NULL,
        outcome TEXT,
        user_correct INTEGER,
        xp_awarded INTEGER DEFAULT 0,
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS weekly_reports (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        week_start TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(user_id, week_start),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS layout_prefs (
        user_id INTEGER PRIMARY KEY,
        layout_type TEXT DEFAULT 'default',
        updated_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    """)
    await db.commit()


MISSION_POOL = [
    {"id": "explore_3",     "title": "Explorer",       "description": "Open 3 events on the map",            "xp": 15, "type": "map_view",    "target": 3},
    {"id": "ai_query_2",    "title": "AI Analyst",     "description": "Ask the AI Copilot 2 questions",      "xp": 20, "type": "ai_query",   "target": 2},
    {"id": "score_event",   "title": "Risk Scorer",    "description": "Score 1 event with AI",               "xp": 25, "type": "event_score","target": 1},
    {"id": "macro_visit",   "title": "Macro Reader",   "description": "Visit the Macro Dashboard",           "xp": 10, "type": "macro_visit","target": 1},
    {"id": "add_watchlist", "title": "Curator",        "description": "Add 1 item to your Watchlist",        "xp": 15, "type": "watchlist",  "target": 1},
    {"id": "portfolio_gen", "title": "Fund Builder",   "description": "Generate an AI Portfolio",            "xp": 30, "type": "portfolio",  "target": 1},
    {"id": "predict",       "title": "Forecaster",     "description": "Make a market prediction",            "xp": 20, "type": "prediction", "target": 1},
    {"id": "feed_filter",   "title": "Filter Pro",     "description": "Filter the feed by impact level",     "xp": 10, "type": "feed_filter","target": 1},
    {"id": "heatmap_view",  "title": "Risk Analyst",   "description": "Enable the Risk Heatmap on the map",  "xp": 15, "type": "heatmap",   "target": 1},
]

BADGE_EXTRA = [
    {"id": "geopolitical_analyst",  "name": "Geopolitical Analyst",  "icon": "🌐", "desc": "Explored 20+ geopolitical events", "category": "geo"},
    {"id": "macro_watcher",         "name": "Macro Watcher",         "icon": "📊", "desc": "Visited macro 10+ times",           "category": "macro"},
    {"id": "energy_expert",         "name": "Energy Expert",         "icon": "⚡", "desc": "Followed 5 energy events",           "category": "energy"},
    {"id": "market_strategist",     "name": "Market Strategist",     "icon": "📈", "desc": "Generated 3 portfolios",            "category": "finance"},
    {"id": "predictor_3",           "name": "Fortune Teller",        "icon": "🔮", "desc": "Made 3 correct predictions",        "category": "prediction"},
    {"id": "week_streak",           "name": "Dedicated",             "icon": "🗓️", "desc": "Completed missions 5 days in a row","category": "streak"},
    {"id": "global_traveler",       "name": "Global Traveler",       "icon": "✈️", "desc": "Explored 30 countries on the map",  "category": "explore"},
    {"id": "insight_collector",     "name": "Insight Collector",     "icon": "💡", "desc": "Read 7 daily insights",             "category": "engage"},
]

INSIGHT_SYSTEM = (
    "You are a concise intelligence analyst. Write a single personalized insight for a user "
    "based on their recent activity. Use second person ('you'/'your'). 2-3 sentences max. "
    "Be specific about regions, events, or market trends. Sound smart but accessible."
)


# ── AI Daily Insight ──────────────────────────────────
@router.get("/insight/today")
async def get_daily_insight(user=Depends(require_user)):
    today = date.today().isoformat()
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        # Return cached insight if exists
        async with db.execute(
            "SELECT * FROM daily_insights WHERE user_id=? AND date=?", (user["id"], today)
        ) as c:
            cached = await c.fetchone()
        if cached:
            return dict(cached)

        # Fetch user context
        async with db.execute(
            "SELECT interests, regions, market_prefs FROM users WHERE id=?", (user["id"],)
        ) as c:
            row = await c.fetchone()
        u = dict(row) if row else {}
        interests = []
        regions = []
        try: interests = json.loads(u.get("interests") or "[]")
        except Exception: pass
        try: regions = json.loads(u.get("regions") or "[]")
        except Exception: pass

        # Recent high events
        async with db.execute(
            "SELECT title, category, country_name, severity FROM events "
            "WHERE datetime(timestamp) > datetime('now','-48 hours') "
            "ORDER BY severity DESC LIMIT 10"
        ) as c:
            events = [dict(r) for r in await c.fetchall()]

        # Recent watchlist
        async with db.execute(
            "SELECT label, type FROM watchlist WHERE user_id=? LIMIT 8", (user["id"],)
        ) as c:
            wl = [dict(r) for r in await c.fetchall()]

    # Build prompt
    ev_text = "\n".join([
        "- " + e["title"] + " [" + e["category"] + ", " + (e["country_name"] or "Global") + ", severity " + str(round(e["severity"],1)) + "]"
        for e in events[:6]
    ]) or "No major events in the last 48h"

    wl_text = ", ".join([w["label"] for w in wl]) if wl else "nothing yet"
    region_text = ", ".join(regions) if regions else "all regions"
    interest_text = ", ".join(interests) if interests else "general topics"

    prompt = (
        "User profile:\n"
        "- Follows: " + region_text + "\n"
        "- Interests: " + interest_text + "\n"
        "- Watching: " + wl_text + "\n\n"
        "Recent global events (last 48h):\n" + ev_text + "\n\n"
        "Write a personalized 'Insight for You Today' — 2-3 sentences connecting "
        "what the user follows to what's happening globally. Be specific and actionable."
    )

    text = await _call_claude(prompt, system=INSIGHT_SYSTEM, max_tokens=200)
    if not text:
        # Smart fallback based on data
        if events:
            top = events[0]
            text = (
                "Today's top event is a " + top["category"].lower() + " development in " +
                (top["country_name"] or "a key region") + " (severity " + str(round(top["severity"],1)) + "/10). " +
                "This is relevant to " + (region_text if regions else "global markets") + ". " +
                "Check the feed for analysis."
            )
        else:
            text = "Global markets are relatively stable today. A good moment to review your watchlist and explore emerging stories before they become headlines."

    # Cache it
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO daily_insights (user_id, date, insight) VALUES (?,?,?)",
            (user["id"], today, text)
        )
        await db.commit()

    return {"user_id": user["id"], "date": today, "insight": text}


# ── Daily Missions ────────────────────────────────────
@router.get("/missions/today")
async def get_today_missions(user=Depends(require_user)):
    today = date.today().isoformat()
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT * FROM daily_missions WHERE user_id=? AND date=?", (user["id"], today)
        ) as c:
            rows = await c.fetchall()

        if not rows:
            # Assign 3 random missions for today using deterministic seed
            seed_str = str(user["id"]) + today
            seed = int(hashlib.md5(seed_str.encode()).hexdigest(), 16) % (2**32)
            import random
            rng = random.Random(seed)
            chosen = rng.sample(MISSION_POOL, min(3, len(MISSION_POOL)))
            for m in chosen:
                await db.execute(
                    "INSERT OR IGNORE INTO daily_missions (user_id,date,mission_id,title,description,xp_reward) VALUES (?,?,?,?,?,?)",
                    (user["id"], today, m["id"], m["title"], m["description"], m["xp"])
                )
            await db.commit()
            async with db.execute(
                "SELECT * FROM daily_missions WHERE user_id=? AND date=?", (user["id"], today)
            ) as c:
                rows = await c.fetchall()

    missions = [dict(r) for r in rows]
    completed = sum(1 for m in missions if m["completed"])
    return {"missions": missions, "completed": completed, "total": len(missions), "date": today}


@router.post("/missions/complete/{mission_id}")
async def complete_mission(mission_id: str, user=Depends(require_user)):
    today = date.today().isoformat()
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT * FROM daily_missions WHERE user_id=? AND date=? AND mission_id=?",
            (user["id"], today, mission_id)
        ) as c:
            mission = await c.fetchone()
        if not mission:
            raise HTTPException(404, "Mission not found")
        m = dict(mission)
        if m["completed"]:
            return {"status": "already_done", "xp": 0}
        await db.execute(
            "UPDATE daily_missions SET completed=1, completed_at=datetime('now') WHERE id=?",
            (m["id"],)
        )
        # Award XP
        xp = m["xp_reward"]
        try:
            await db.execute("UPDATE user_xp SET xp=xp+? WHERE user_id=?", (xp, user["id"]))
        except Exception:
            pass
        await db.commit()
        # Check if all missions done today
        async with db.execute(
            "SELECT COUNT(*) FROM daily_missions WHERE user_id=? AND date=? AND completed=0",
            (user["id"], today)
        ) as c:
            remaining = (await c.fetchone())[0]
    bonus = 0
    if remaining == 0:
        bonus = 50  # Bonus for completing all missions
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute("UPDATE user_xp SET xp=xp+50 WHERE user_id=?", (user["id"],))
            await db.commit()
    return {"status": "completed", "xp": xp, "all_done_bonus": bonus, "remaining": remaining}


# ── Predictions ───────────────────────────────────────
@router.get("/predictions")
async def get_predictions(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT * FROM predictions WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
            (user["id"],)
        ) as c:
            rows = await c.fetchall()
        # Stats
        async with db.execute(
            "SELECT COUNT(*), SUM(user_correct) FROM predictions WHERE user_id=? AND outcome IS NOT NULL",
            (user["id"],)
        ) as c:
            r = await c.fetchone()
            total_resolved = r[0] or 0
            correct = int(r[1] or 0)
    accuracy = round(correct / total_resolved * 100) if total_resolved > 0 else 0
    return {
        "predictions": [dict(r) for r in rows],
        "stats": {"total": total_resolved, "correct": correct, "accuracy": accuracy}
    }


@router.post("/predictions")
async def create_prediction(payload: dict = Body(...), user=Depends(require_user)):
    event_id = payload.get("event_id", "")
    event_title = payload.get("event_title", "Unknown event")
    direction = payload.get("direction", "up")  # "up" | "down" | "stable"
    asset = payload.get("asset", "Oil")
    question = "Will " + asset + " go " + direction + " due to: " + event_title[:80] + "?"
    resolves_at = (datetime.utcnow() + timedelta(hours=24)).isoformat()

    async with aiosqlite.connect(settings.db_path) as db:
        await _ensure_tables(db)
        await db.execute(
            "INSERT INTO predictions (user_id,question,event_id,event_title,direction,asset,resolves_at) VALUES (?,?,?,?,?,?,?)",
            (user["id"], question, event_id, event_title, direction, asset, resolves_at)
        )
        await db.commit()
    # Track for missions
    return {"status": "ok", "question": question, "resolves_at": resolves_at}


@router.post("/predictions/{pred_id}/resolve")
async def resolve_prediction(pred_id: int, payload: dict = Body(...), user=Depends(require_user)):
    """Auto-resolve: compare prediction direction against actual market move."""
    actual_change = payload.get("actual_change", 0.0)  # % change of the asset
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT * FROM predictions WHERE id=? AND user_id=?", (pred_id, user["id"])
        ) as c:
            pred = await c.fetchone()
        if not pred or dict(pred)["outcome"] is not None:
            raise HTTPException(404, "Prediction not found or already resolved")
        p = dict(pred)
        direction = p["direction"]
        correct = (
            (direction == "up" and actual_change > 0.5) or
            (direction == "down" and actual_change < -0.5) or
            (direction == "stable" and abs(actual_change) <= 0.5)
        )
        xp_award = 30 if correct else 5
        await db.execute(
            "UPDATE predictions SET outcome=?, user_correct=?, xp_awarded=? WHERE id=?",
            (str(round(actual_change, 2)) + "%", int(correct), xp_award, pred_id)
        )
        await db.execute("UPDATE user_xp SET xp=xp+? WHERE user_id=?", (xp_award, user["id"]))
        await db.commit()
    return {"correct": correct, "xp": xp_award, "actual": actual_change}


# ── Weekly Report ─────────────────────────────────────
@router.get("/weekly-report")
async def get_weekly_report(user=Depends(require_user)):
    week_start = (date.today() - timedelta(days=date.today().weekday())).isoformat()
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT * FROM weekly_reports WHERE user_id=? AND week_start=?",
            (user["id"], week_start)
        ) as c:
            cached = await c.fetchone()
        if cached:
            return dict(cached)

        # Gather this week's stats
        async with db.execute(
            "SELECT xp, ai_queries, events_viewed, macro_visits, events_scored FROM user_xp WHERE user_id=?",
            (user["id"],)
        ) as c:
            xp_row = await c.fetchone()
        xp_data = dict(xp_row) if xp_row else {}

        async with db.execute(
            "SELECT COUNT(*) FROM daily_missions WHERE user_id=? AND completed=1 "
            "AND date >= ?", (user["id"], week_start)
        ) as c:
            missions_done = (await c.fetchone())[0]

        async with db.execute(
            "SELECT COUNT(*), AVG(severity) FROM events WHERE "
            "datetime(timestamp) > datetime('now','-7 days')"
        ) as c:
            r = await c.fetchone()
            global_events = r[0] or 0
            avg_sev = round(r[1] or 5, 1)

        async with db.execute(
            "SELECT category, COUNT(*) FROM events WHERE "
            "datetime(timestamp) > datetime('now','-7 days') "
            "GROUP BY category ORDER BY 2 DESC LIMIT 3"
        ) as c:
            top_cats = [row[0] for row in await c.fetchall()]

        async with db.execute(
            "SELECT label, type FROM watchlist WHERE user_id=? LIMIT 5", (user["id"],)
        ) as c:
            wl = [dict(r) for r in await c.fetchall()]

    # Build report
    stats = {
        "xp_earned": xp_data.get("xp", 0),
        "ai_queries": xp_data.get("ai_queries", 0),
        "events_explored": xp_data.get("events_viewed", 0),
        "missions_completed": missions_done,
        "global_events_this_week": global_events,
        "avg_global_severity": avg_sev,
        "top_categories": top_cats,
    }

    # AI narrative
    wl_text = ", ".join([w["label"] for w in wl]) if wl else "nothing yet"
    prompt = (
        "Write a 'Weekly Intelligence Report' for this user in 4 bullet points.\n\n"
        "User stats this week:\n"
        "- XP earned: " + str(stats["xp_earned"]) + "\n"
        "- AI questions asked: " + str(stats["ai_queries"]) + "\n"
        "- Events explored: " + str(stats["events_explored"]) + "\n"
        "- Missions completed: " + str(stats["missions_completed"]) + "\n\n"
        "Global context:\n"
        "- " + str(global_events) + " global events tracked\n"
        "- Average severity: " + str(avg_sev) + "/10\n"
        "- Top categories: " + ", ".join(top_cats) + "\n"
        "- User watches: " + wl_text + "\n\n"
        "Format: 4 short bullet points starting with an emoji. Be encouraging and specific."
    )
    narrative = await _call_claude(prompt, max_tokens=300)
    if not narrative:
        narrative = (
            "📊 You explored " + str(stats["events_explored"]) + " global events this week.\n"
            "🤖 Asked the AI " + str(stats["ai_queries"]) + " intelligence questions.\n"
            "✅ Completed " + str(stats["missions_completed"]) + " daily missions.\n"
            "🌍 Global average risk severity was " + str(avg_sev) + "/10 — stay informed."
        )

    report = {"narrative": narrative, "stats": stats}
    report_json = json.dumps(report)

    async with aiosqlite.connect(settings.db_path) as db:
        await _ensure_tables(db)
        await db.execute(
            "INSERT OR REPLACE INTO weekly_reports (user_id, week_start, report) VALUES (?,?,?)",
            (user["id"], week_start, report_json)
        )
        await db.commit()

    return {"user_id": user["id"], "week_start": week_start, "report": report_json}


# ── Layout Preferences ────────────────────────────────
@router.get("/layout")
async def get_layout(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT layout_type FROM layout_prefs WHERE user_id=?", (user["id"],)
        ) as c:
            row = await c.fetchone()
    if row:
        return {"layout": dict(row)["layout_type"]}
    # Auto-detect based on user profile
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT interests, market_prefs, experience_level FROM users WHERE id=?", (user["id"],)
        ) as c:
            u = await c.fetchone()
    if u:
        ud = dict(u)
        interests = []
        market_prefs = []
        try: interests = json.loads(ud.get("interests") or "[]")
        except Exception: pass
        try: market_prefs = json.loads(ud.get("market_prefs") or "[]")
        except Exception: pass
        if "macro" in interests or "finance" in interests:
            if len(market_prefs) >= 3:
                return {"layout": "trader"}
        if "geopolitics" in interests or "security" in interests:
            return {"layout": "geo"}
        if "macro" in interests:
            return {"layout": "macro"}
    return {"layout": "default"}


@router.post("/layout")
async def set_layout(payload: dict = Body(...), user=Depends(require_user)):
    layout = payload.get("layout", "default")
    if layout not in ("default", "trader", "geo", "macro"):
        raise HTTPException(400, "Invalid layout")
    async with aiosqlite.connect(settings.db_path) as db:
        await _ensure_tables(db)
        await db.execute(
            "INSERT OR REPLACE INTO layout_prefs (user_id, layout_type) VALUES (?,?)",
            (user["id"], layout)
        )
        await db.commit()
    return {"status": "ok", "layout": layout}


# ── Risk Radar (shareable snapshot) ──────────────────
@router.get("/risk-radar")
async def get_risk_radar(user=Depends(require_user)):
    """Get data for the shareable Global Risk Radar snapshot."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT COUNT(*) FROM events WHERE datetime(timestamp) > datetime('now','-24 hours')"
        ) as c:
            events_24h = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM events WHERE impact='High' AND datetime(timestamp) > datetime('now','-24 hours')"
        ) as c:
            high_24h = (await c.fetchone())[0]
        async with db.execute(
            "SELECT AVG(severity) FROM events WHERE datetime(timestamp) > datetime('now','-24 hours')"
        ) as c:
            avg_sev = (await c.fetchone())[0] or 5.0
        async with db.execute(
            "SELECT country_name, country_code, COUNT(*) as n, AVG(severity) as s "
            "FROM events WHERE country_code!='XX' AND datetime(timestamp) > datetime('now','-24 hours') "
            "GROUP BY country_code ORDER BY s DESC LIMIT 5"
        ) as c:
            hotspots = [dict(r) for r in await c.fetchall()]
        async with db.execute(
            "SELECT category, COUNT(*) as n FROM events "
            "WHERE datetime(timestamp) > datetime('now','-24 hours') "
            "GROUP BY category ORDER BY n DESC LIMIT 5"
        ) as c:
            top_cats = [dict(r) for r in await c.fetchall()]
        async with db.execute(
            "SELECT title, category, country_name, severity FROM events "
            "WHERE impact='High' AND datetime(timestamp) > datetime('now','-24 hours') "
            "ORDER BY severity DESC LIMIT 3"
        ) as c:
            critical = [dict(r) for r in await c.fetchall()]

    risk_index = round(min(100, avg_sev * 10), 1)
    level = "CRITICAL" if risk_index > 60 else "ELEVATED" if risk_index > 35 else "STABLE"
    ts = datetime.utcnow().strftime("%d %b %Y %H:%M UTC")

    return {
        "timestamp": ts,
        "risk_index": risk_index,
        "risk_level": level,
        "events_24h": events_24h,
        "high_impact_24h": high_24h,
        "avg_severity": round(avg_sev, 1),
        "hotspots": hotspots,
        "top_categories": top_cats,
        "critical_events": critical,
    }
