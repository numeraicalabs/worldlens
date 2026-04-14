"""
tradgentic/leaderboard.py  —  Sprint C3 + C4
Gamification achievements + anonymous leaderboard.

Achievements are stored in tg_achievements (bot-level).
Leaderboard aggregates performance across all bots anonymously.
"""
from __future__ import annotations
import uuid, logging
from datetime import datetime
from typing import List, Dict, Optional

import aiosqlite

logger = logging.getLogger(__name__)

try:
    from config import settings
except ImportError:
    class _S: db_path = "worldlens.db"
    settings = _S()


# ─────────────────────────────────────────────────────────────────────────────
# SCHEMA
# ─────────────────────────────────────────────────────────────────────────────

_SCHEMA = """
CREATE TABLE IF NOT EXISTS tg_achievements (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    bot_id      TEXT,
    key         TEXT NOT NULL,
    title       TEXT NOT NULL,
    description TEXT DEFAULT '',
    xp          INTEGER DEFAULT 0,
    earned_at   TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, key)
);
CREATE INDEX IF NOT EXISTS idx_tg_ach_user ON tg_achievements(user_id, earned_at DESC);

CREATE TABLE IF NOT EXISTS tg_leaderboard_cache (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    handle      TEXT NOT NULL,
    period      TEXT NOT NULL,
    total_return_pct REAL DEFAULT 0.0,
    sharpe      REAL DEFAULT 0.0,
    win_rate    REAL DEFAULT 0.0,
    n_trades    INTEGER DEFAULT 0,
    best_strategy TEXT DEFAULT '',
    updated_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, period)
);
CREATE INDEX IF NOT EXISTS idx_tg_lb_period ON tg_leaderboard_cache(period, total_return_pct DESC);
"""

# ─────────────────────────────────────────────────────────────────────────────
# ACHIEVEMENT DEFINITIONS
# ─────────────────────────────────────────────────────────────────────────────

ACHIEVEMENT_DEFS: Dict[str, Dict] = {
    # Onboarding
    "first_bot":       {"title": "🤖 First Bot",        "desc": "Deployed your first trading bot",           "xp": 150},
    "quiz_complete":   {"title": "🎯 Guided Start",      "desc": "Completed the profile quiz",                "xp": 50},
    # Trading activity
    "first_trade":     {"title": "💹 First Trade",       "desc": "Executed your first paper trade",           "xp": 100},
    "ten_trades":      {"title": "🔁 Active Trader",     "desc": "Executed 10 paper trades",                  "xp": 200},
    "fifty_trades":    {"title": "⚡ Momentum Trader",   "desc": "Executed 50 paper trades",                  "xp": 400},
    # Performance
    "green_week":      {"title": "📈 Green Week",        "desc": "Positive return over a full week",          "xp": 200},
    "green_month":     {"title": "🏆 Green Month",       "desc": "Positive return for a full month",          "xp": 500},
    "three_green":     {"title": "💎 Elite Trader",      "desc": "3 consecutive months in profit",            "xp": 1000},
    # Analysis
    "first_backtest":  {"title": "⚗️ Backtester",        "desc": "Ran your first backtest",                   "xp": 100},
    "grade_a":         {"title": "🎓 Grade A Strategy",  "desc": "Backtest scored grade A or above",          "xp": 300},
    "walk_forward":    {"title": "🔁 Walk-Forward Ace",  "desc": "Ran walk-forward validation",               "xp": 300},
    "first_feature":   {"title": "🔬 Feature Analyst",   "desc": "Used the Feature Engineering Lab",          "xp": 120},
    "multi_scan":      {"title": "📡 Market Scanner",    "desc": "Scanned 5+ assets with Feature Lab",        "xp": 150},
    # ML
    "ml_trained":      {"title": "🧠 ML Pioneer",        "desc": "Trained your first ML model",               "xp": 400},
    "ml_win":          {"title": "🤖 ML Win",            "desc": "ML bot generated a profitable trade",       "xp": 250},
    # Misc
    "sharpe_1":        {"title": "⚖️ Risk Manager",      "desc": "Achieved Sharpe ratio > 1.0",               "xp": 300},
    "win_rate_60":     {"title": "🎯 Sharp Shooter",     "desc": "Win rate > 60% over 10+ trades",            "xp": 350},
    "profit_factor_2": {"title": "💰 Profit Machine",    "desc": "Profit factor > 2.0 over 10+ trades",      "xp": 400},
}


async def ensure_leaderboard_tables():
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            for stmt in _SCHEMA.strip().split(';'):
                if stmt.strip():
                    await db.execute(stmt)
            await db.commit()
    except Exception as e:
        logger.warning("ensure_leaderboard_tables: %s", e)


# ─────────────────────────────────────────────────────────────────────────────
# ACHIEVEMENTS
# ─────────────────────────────────────────────────────────────────────────────

async def award_achievement(
    user_id: int,
    key: str,
    bot_id: Optional[str] = None,
) -> Optional[Dict]:
    """
    Award an achievement to a user. Idempotent (UNIQUE constraint).
    Returns the achievement if newly awarded, None if already had it.
    """
    defn = ACHIEVEMENT_DEFS.get(key)
    if not defn:
        return None
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            # Try insert — will fail silently if already awarded (UNIQUE)
            try:
                await db.execute(
                    """INSERT OR IGNORE INTO tg_achievements
                       (id, user_id, bot_id, key, title, description, xp)
                       VALUES (?,?,?,?,?,?,?)""",
                    (str(uuid.uuid4())[:8], user_id, bot_id,
                     key, defn["title"], defn["desc"], defn["xp"])
                )
                await db.commit()
                # Check if it was actually inserted
                async with db.execute(
                    "SELECT id FROM tg_achievements WHERE user_id=? AND key=? AND earned_at > datetime('now','-5 seconds')",
                    (user_id, key)
                ) as c:
                    row = await c.fetchone()
                if row:
                    # Also award XP to main user_xp table if it exists
                    try:
                        await db.execute(
                            "UPDATE user_xp SET xp=xp+? WHERE user_id=?",
                            (defn["xp"], user_id)
                        )
                        await db.commit()
                    except Exception:
                        pass
                    return {**defn, "key": key, "newly_awarded": True}
            except Exception:
                pass
    except Exception as e:
        logger.debug("award_achievement %s %s: %s", user_id, key, e)
    return None


async def get_achievements(user_id: int) -> List[Dict]:
    """All achievements earned by a user."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT key, title, description, xp, earned_at, bot_id "
                "FROM tg_achievements WHERE user_id=? ORDER BY earned_at DESC",
                (user_id,)
            ) as c:
                rows = await c.fetchall()
        earned_keys = {r["key"] for r in rows}
        result = [dict(r) for r in rows]
        # Add locked achievements
        locked = [
            {**v, "key": k, "locked": True}
            for k, v in ACHIEVEMENT_DEFS.items()
            if k not in earned_keys
        ]
        return result + locked
    except Exception as e:
        logger.warning("get_achievements: %s", e)
        return []


async def check_and_award_trade_achievements(
    user_id: int,
    bot_id:  str,
    trade_count: int,
    win_rate:    float,
    pnl:         float,
    strategy_id: str,
) -> List[Dict]:
    """Check trade milestones after each trade execution. Returns newly earned."""
    earned = []
    checks = []

    if trade_count == 1:
        checks.append("first_trade")
    if trade_count >= 10:
        checks.append("ten_trades")
    if trade_count >= 50:
        checks.append("fifty_trades")
    if win_rate >= 60 and trade_count >= 10:
        checks.append("win_rate_60")
    if strategy_id.startswith("ml_") and pnl > 0:
        checks.append("ml_win")
    if strategy_id.startswith("ml_"):
        checks.append("ml_trained")

    for key in checks:
        r = await award_achievement(user_id, key, bot_id)
        if r:
            earned.append(r)
    return earned


# ─────────────────────────────────────────────────────────────────────────────
# LEADERBOARD
# ─────────────────────────────────────────────────────────────────────────────

def _anonymise(user_id: int) -> str:
    """Deterministic anonymous handle from user_id."""
    prefixes = ["Alpha", "Beta", "Gamma", "Delta", "Sigma", "Omega", "Zeta", "Theta"]
    idx  = user_id % len(prefixes)
    code = f"{(user_id * 7 + 13) % 9000 + 1000}"
    return f"{prefixes[idx]}_{code}"


async def upsert_leaderboard(
    user_id:        int,
    period:         str,
    total_return:   float,
    sharpe:         float,
    win_rate:       float,
    n_trades:       int,
    best_strategy:  str,
):
    """Update or insert user's leaderboard entry for a period."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            handle = _anonymise(user_id)
            await db.execute(
                """INSERT INTO tg_leaderboard_cache
                   (id, user_id, handle, period, total_return_pct, sharpe, win_rate, n_trades, best_strategy, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,datetime('now'))
                   ON CONFLICT(user_id, period) DO UPDATE SET
                     total_return_pct=excluded.total_return_pct,
                     sharpe=excluded.sharpe, win_rate=excluded.win_rate,
                     n_trades=excluded.n_trades, best_strategy=excluded.best_strategy,
                     updated_at=datetime('now')""",
                (str(uuid.uuid4())[:8], user_id, handle, period,
                 round(total_return, 2), round(sharpe, 3),
                 round(win_rate, 1), n_trades, best_strategy)
            )
            await db.commit()
    except Exception as e:
        logger.debug("upsert_leaderboard: %s", e)


async def get_leaderboard(period: str = "all", limit: int = 20) -> List[Dict]:
    """Fetch anonymous leaderboard for a period."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT handle, period, total_return_pct, sharpe, win_rate,
                          n_trades, best_strategy, updated_at
                   FROM tg_leaderboard_cache
                   WHERE period=? ORDER BY total_return_pct DESC LIMIT ?""",
                (period, limit)
            ) as c:
                rows = await c.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning("get_leaderboard: %s", e)
        return []
