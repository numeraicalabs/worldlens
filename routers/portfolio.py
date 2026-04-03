"""World Lens — AI Portfolio Generator + Gamification"""
from __future__ import annotations
import json
import aiosqlite
import random
from datetime import datetime
from fastapi import APIRouter, Depends, Body, HTTPException
from auth import require_user
from config import settings
from ai_layer import _call_claude

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

BADGES = [
    {"id": "first_login",     "name": "First Steps",      "icon": "🚀", "desc": "Logged in for the first time"},
    {"id": "watchlist_5",     "name": "Analyst",          "icon": "⭐", "desc": "Added 5 items to watchlist"},
    {"id": "watchlist_10",    "name": "Senior Analyst",   "icon": "🔥", "desc": "Added 10+ watchlist items"},
    {"id": "alerts_3",        "name": "Alert Master",     "icon": "🔔", "desc": "Created 3+ alerts"},
    {"id": "ai_query_10",     "name": "AI Whisperer",     "icon": "🤖", "desc": "Asked AI 10+ questions"},
    {"id": "portfolio_first", "name": "Portfolio Pro",    "icon": "💼", "desc": "Generated first portfolio"},
    {"id": "portfolio_5",     "name": "Fund Manager",     "icon": "💰", "desc": "Generated 5+ portfolios"},
    {"id": "map_explorer",    "name": "Map Explorer",     "icon": "🌍", "desc": "Explored 10+ events on the map"},
    {"id": "streak_3",        "name": "Streak: 3 Days",   "icon": "📅", "desc": "Logged in 3 days in a row"},
    {"id": "streak_7",        "name": "Streak: 7 Days",   "icon": "🏆", "desc": "Logged in 7 days in a row"},
    {"id": "macro_reader",    "name": "Macro Reader",     "icon": "📊", "desc": "Visited macro dashboard 5+ times"},
    {"id": "risk_scorer",     "name": "Risk Scorer",      "icon": "⚡", "desc": "Scored 5+ events with AI"},
]

LEVELS = [
    {"level": 1, "name": "Observer",       "min_xp": 0,    "color": "#94A3B8"},
    {"level": 2, "name": "Analyst",        "min_xp": 100,  "color": "#60A5FA"},
    {"level": 3, "name": "Strategist",     "min_xp": 300,  "color": "#34D399"},
    {"level": 4, "name": "Senior Analyst", "min_xp": 600,  "color": "#FBBF24"},
    {"level": 5, "name": "Fund Manager",   "min_xp": 1000, "color": "#F97316"},
    {"level": 6, "name": "Director",       "min_xp": 1600, "color": "#A78BFA"},
    {"level": 7, "name": "CIO",            "min_xp": 2500, "color": "#EC4899"},
    {"level": 8, "name": "Oracle",         "min_xp": 4000, "color": "#F87171"},
]


async def _ensure_gamification_tables(db):
    await db.executescript("""
    CREATE TABLE IF NOT EXISTS user_xp (
        user_id INTEGER PRIMARY KEY,
        xp INTEGER DEFAULT 0,
        portfolios_generated INTEGER DEFAULT 0,
        ai_queries INTEGER DEFAULT 0,
        events_viewed INTEGER DEFAULT 0,
        macro_visits INTEGER DEFAULT 0,
        events_scored INTEGER DEFAULT 0,
        login_streak INTEGER DEFAULT 0,
        last_activity TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS user_badges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        badge_id TEXT NOT NULL,
        earned_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id),
        UNIQUE(user_id, badge_id)
    );
    CREATE TABLE IF NOT EXISTS portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        risk_profile TEXT NOT NULL,
        horizon TEXT NOT NULL,
        amount REAL NOT NULL,
        focus TEXT DEFAULT '',
        result TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    """)
    await db.commit()


async def _get_or_create_xp(db, user_id: int) -> dict:
    async with db.execute("SELECT * FROM user_xp WHERE user_id=?", (user_id,)) as c:
        row = await c.fetchone()
    if not row:
        await db.execute("INSERT OR IGNORE INTO user_xp (user_id) VALUES (?)", (user_id,))
        await db.commit()
        async with db.execute("SELECT * FROM user_xp WHERE user_id=?", (user_id,)) as c:
            row = await c.fetchone()
    return dict(row)


def _calc_level(xp: int) -> dict:
    current = LEVELS[0]
    next_lv = LEVELS[1] if len(LEVELS) > 1 else None
    for i, lv in enumerate(LEVELS):
        if xp >= lv["min_xp"]:
            current = lv
            next_lv = LEVELS[i + 1] if i + 1 < len(LEVELS) else None
    progress = 0
    if next_lv:
        span = next_lv["min_xp"] - current["min_xp"]
        earned = xp - current["min_xp"]
        progress = min(100, int(earned / span * 100)) if span > 0 else 100
    return {**current, "xp": xp, "next": next_lv, "progress": progress}


async def _award_xp(db, user_id: int, amount: int, action: str):
    await db.execute(
        "UPDATE user_xp SET xp=xp+?, last_activity=datetime('now') WHERE user_id=?",
        (amount, user_id)
    )
    await db.commit()


async def _check_badges(db, user_id: int, xp_row: dict) -> list:
    """Check and award any new badges. Returns list of newly earned badge IDs."""
    async with db.execute("SELECT badge_id FROM user_badges WHERE user_id=?", (user_id,)) as c:
        earned = {r[0] for r in await c.fetchall()}

    new_badges = []
    wl_count = 0
    al_count = 0
    async with db.execute("SELECT COUNT(*) FROM watchlist WHERE user_id=?", (user_id,)) as c:
        wl_count = (await c.fetchone())[0]
    async with db.execute("SELECT COUNT(*) FROM alerts WHERE user_id=?", (user_id,)) as c:
        al_count = (await c.fetchone())[0]

    checks = {
        "first_login":     True,
        "watchlist_5":     wl_count >= 5,
        "watchlist_10":    wl_count >= 10,
        "alerts_3":        al_count >= 3,
        "ai_query_10":     xp_row.get("ai_queries", 0) >= 10,
        "portfolio_first": xp_row.get("portfolios_generated", 0) >= 1,
        "portfolio_5":     xp_row.get("portfolios_generated", 0) >= 5,
        "map_explorer":    xp_row.get("events_viewed", 0) >= 10,
        "streak_3":        xp_row.get("login_streak", 0) >= 3,
        "streak_7":        xp_row.get("login_streak", 0) >= 7,
        "macro_reader":    xp_row.get("macro_visits", 0) >= 5,
        "risk_scorer":     xp_row.get("events_scored", 0) >= 5,
    }

    for badge_id, condition in checks.items():
        if condition and badge_id not in earned:
            await db.execute(
                "INSERT OR IGNORE INTO user_badges (user_id, badge_id) VALUES (?,?)",
                (user_id, badge_id)
            )
            new_badges.append(badge_id)

    if new_badges:
        await db.commit()
    return new_badges


# ── ENDPOINTS ────────────────────────────────────────

@router.get("/stats")
async def get_gamification_stats(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_gamification_tables(db)
        xp_row = await _get_or_create_xp(db, user["id"])
        async with db.execute(
            "SELECT ub.badge_id, ub.earned_at FROM user_badges ub WHERE ub.user_id=? ORDER BY ub.earned_at DESC",
            (user["id"],)
        ) as c:
            earned_raw = await c.fetchall()
        async with db.execute("SELECT COUNT(*) FROM portfolios WHERE user_id=?", (user["id"],)) as c:
            port_count = (await c.fetchone())[0]

    earned_ids = {r[0]: r[1] for r in earned_raw}
    badges_out = []
    for b in BADGES:
        badges_out.append({**b, "earned": b["id"] in earned_ids, "earned_at": earned_ids.get(b["id"])})

    level_info = _calc_level(xp_row["xp"])
    return {
        "level": level_info,
        "xp_row": dict(xp_row),
        "badges": badges_out,
        "portfolio_count": port_count,
        "leaderboard_rank": None,
    }


@router.post("/track")
async def track_action(payload: dict = Body(...), user=Depends(require_user)):
    """Track user actions for XP. action: ai_query|map_view|macro_visit|event_score"""
    action = payload.get("action", "")
    xp_map = {"ai_query": 5, "map_view": 2, "macro_visit": 3, "event_score": 10, "portfolio": 25}
    col_map = {"ai_query": "ai_queries", "map_view": "events_viewed",
               "macro_visit": "macro_visits", "event_score": "events_scored"}
    xp_gain = xp_map.get(action, 1)

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_gamification_tables(db)
        col = col_map.get(action)
        if col:
            await db.execute(f"UPDATE user_xp SET {col}={col}+1 WHERE user_id=?", (user["id"],))
        await _award_xp(db, user["id"], xp_gain, action)
        xp_row = await _get_or_create_xp(db, user["id"])
        new_badges = await _check_badges(db, user["id"], xp_row)

    badge_details = [b for b in BADGES if b["id"] in new_badges]
    return {"xp_gained": xp_gain, "new_badges": badge_details}


@router.get("/portfolios")
async def get_portfolios(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_gamification_tables(db)
        async with db.execute(
            "SELECT * FROM portfolios WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
            (user["id"],)
        ) as c:
            rows = await c.fetchall()
    return [dict(r) for r in rows]


@router.post("/generate")
async def generate_portfolio(payload: dict = Body(...), user=Depends(require_user)):
    """Generate an AI investment portfolio."""
    risk = payload.get("risk_profile", "Moderate")     # Conservative / Moderate / Aggressive
    horizon = payload.get("horizon", "1-3 years")      # Short / Medium / Long
    amount = float(payload.get("amount", 10000))
    focus = payload.get("focus", "")                    # e.g. "tech", "emerging markets", "ESG"
    goals = payload.get("goals", "")                    # e.g. "capital preservation", "growth"

    # Build context from current global events and market data
    from scheduler import get_finance_cache
    fin = get_finance_cache()
    fin_ctx = "\n".join([
        a["name"] + ": " + ("+" if a["change_pct"] >= 0 else "") + str(a["change_pct"]) + "%"
        for a in fin[:8]
    ]) if fin else "Market data unavailable"

    prompt = f"""You are a senior portfolio manager. Generate a detailed investment portfolio.

CLIENT PROFILE:
- Risk appetite: {risk}
- Investment horizon: {horizon}
- Capital to invest: ${amount:,.0f}
- Focus areas: {focus or 'Diversified global'}
- Goals: {goals or 'Long-term growth and capital preservation'}

CURRENT MARKET CONTEXT:
{fin_ctx}

Generate a complete portfolio allocation. Respond ONLY with valid JSON:
{{
  "name": "Portfolio name reflecting strategy",
  "strategy": "2-sentence strategy description",
  "risk_score": 6.5,
  "expected_return": "8-12% annually",
  "allocations": [
    {{"asset": "US Large Cap Equities", "ticker": "SPY", "pct": 30, "rationale": "Core holding for growth", "type": "equity"}},
    {{"asset": "International Developed", "ticker": "EFA", "pct": 15, "rationale": "Geographic diversification", "type": "equity"}},
    {{"asset": "Emerging Markets", "ticker": "EEM", "pct": 10, "rationale": "Higher growth potential", "type": "equity"}},
    {{"asset": "Investment Grade Bonds", "ticker": "AGG", "pct": 20, "rationale": "Stability and income", "type": "bond"}},
    {{"asset": "Gold", "ticker": "GLD", "pct": 10, "rationale": "Inflation hedge", "type": "commodity"}},
    {{"asset": "Real Estate (REITs)", "ticker": "VNQ", "pct": 10, "rationale": "Income and diversification", "type": "real_estate"}},
    {{"asset": "Cash/Money Market", "ticker": "SHV", "pct": 5, "rationale": "Liquidity buffer", "type": "cash"}}
  ],
  "rebalancing": "Quarterly",
  "key_risks": ["Risk 1", "Risk 2", "Risk 3"],
  "geopolitical_considerations": "Brief note on how current global events affect this portfolio",
  "macro_outlook": "Brief macro view supporting this allocation"
}}

Make allocations sum to exactly 100%. Tailor specifically to the risk profile and focus areas provided."""

    result_text = await _call_claude(prompt, max_tokens=900)
    if result_text:
        from ai_layer import _parse_json
        result = _parse_json(result_text)
    else:
        result = None

    if not result:
        # Deterministic fallback based on risk profile
        result = _fallback_portfolio(risk, amount, focus)

    # Save to DB
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_gamification_tables(db)
        await db.execute(
            "INSERT INTO portfolios (user_id,name,risk_profile,horizon,amount,focus,result) VALUES (?,?,?,?,?,?,?)",
            (user["id"], result.get("name", "My Portfolio"), risk, horizon, amount, focus, json.dumps(result))
        )
        await db.execute(
            "UPDATE user_xp SET portfolios_generated=portfolios_generated+1, xp=xp+25 WHERE user_id=?",
            (user["id"],)
        )
        await db.commit()
        xp_row = await _get_or_create_xp(db, user["id"])
        new_badges = await _check_badges(db, user["id"], xp_row)

    badge_details = [b for b in BADGES if b["id"] in new_badges]
    return {"portfolio": result, "new_badges": badge_details, "xp_gained": 25}


def _fallback_portfolio(risk: str, amount: float, focus: str) -> dict:
    templates = {
        "Conservative": [
            {"asset": "Short-Term Bonds",    "ticker": "SHY",  "pct": 35, "rationale": "Capital preservation", "type": "bond"},
            {"asset": "Investment Grade Bonds","ticker": "AGG", "pct": 25, "rationale": "Steady income", "type": "bond"},
            {"asset": "Dividend Equities",   "ticker": "VYM",  "pct": 20, "rationale": "Income with lower vol", "type": "equity"},
            {"asset": "Gold",                "ticker": "GLD",  "pct": 10, "rationale": "Inflation hedge", "type": "commodity"},
            {"asset": "Cash",                "ticker": "SHV",  "pct": 10, "rationale": "Liquidity", "type": "cash"},
        ],
        "Moderate": [
            {"asset": "US Large Cap",        "ticker": "SPY",  "pct": 30, "rationale": "Core equity exposure", "type": "equity"},
            {"asset": "International",       "ticker": "EFA",  "pct": 15, "rationale": "Diversification", "type": "equity"},
            {"asset": "Bonds",               "ticker": "AGG",  "pct": 25, "rationale": "Stability", "type": "bond"},
            {"asset": "REITs",               "ticker": "VNQ",  "pct": 10, "rationale": "Real assets", "type": "real_estate"},
            {"asset": "Gold",                "ticker": "GLD",  "pct": 10, "rationale": "Hedge", "type": "commodity"},
            {"asset": "Cash",                "ticker": "SHV",  "pct": 10, "rationale": "Liquidity", "type": "cash"},
        ],
        "Aggressive": [
            {"asset": "US Growth Equities",  "ticker": "QQQ",  "pct": 35, "rationale": "High growth potential", "type": "equity"},
            {"asset": "Emerging Markets",    "ticker": "EEM",  "pct": 20, "rationale": "High growth markets", "type": "equity"},
            {"asset": "Small Cap",           "ticker": "IWM",  "pct": 15, "rationale": "Small cap premium", "type": "equity"},
            {"asset": "Crypto (Bitcoin)",    "ticker": "IBIT", "pct": 10, "rationale": "Digital assets", "type": "crypto"},
            {"asset": "International",       "ticker": "EFA",  "pct": 10, "rationale": "Global exposure", "type": "equity"},
            {"asset": "Commodities",         "ticker": "PDBC", "pct": 5,  "rationale": "Inflation protection", "type": "commodity"},
            {"asset": "Cash",                "ticker": "SHV",  "pct": 5,  "rationale": "Dry powder", "type": "cash"},
        ],
    }
    allocs = templates.get(risk, templates["Moderate"])
    return {
        "name": f"{risk} {focus or 'Global'} Portfolio",
        "strategy": f"A {risk.lower()}-risk portfolio focused on {focus or 'diversified global'} exposure with appropriate asset allocation for the stated investment horizon.",
        "risk_score": {"Conservative": 3.5, "Moderate": 6.0, "Aggressive": 8.5}.get(risk, 6.0),
        "expected_return": {"Conservative": "4-6%", "Moderate": "7-10%", "Aggressive": "10-15%"}.get(risk, "7-10%"),
        "allocations": allocs,
        "rebalancing": "Quarterly",
        "key_risks": ["Market volatility", "Inflation risk", "Geopolitical uncertainty"],
        "geopolitical_considerations": "Configure an AI provider in Admin → Settings to enable geopolitical analysis.",
        "macro_outlook": "Diversified portfolio designed for the current macro environment.",
    }
