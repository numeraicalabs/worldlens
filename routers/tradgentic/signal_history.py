"""
tradgentic/signal_history.py
─────────────────────────────────────────────────────────────────
Signal History Store — persistent log of every signal generated.

Every signal (whether acted upon or not) is saved to `tg_signal_log`.
This is the training dataset for future ML models:
  - Feature snapshot at signal time
  - Signal direction (BUY/SELL/HOLD)
  - Source (strategy_id or 'ml_xgb' / 'ml_ensemble')
  - Outcome (filled after N bars: actual return)

Schema is append-only. Never delete rows — only add outcome.
"""
from __future__ import annotations
import json, uuid, logging
from datetime import datetime
from typing import List, Dict, Optional, Any

import aiosqlite

logger = logging.getLogger(__name__)

try:
    from config import settings
except ImportError:
    class _S: db_path = "worldlens.db"
    settings = _S()


# ─────────────────────────────────────────────────────────────
# SCHEMA
# ─────────────────────────────────────────────────────────────

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS tg_signal_log (
    id            TEXT PRIMARY KEY,
    bot_id        TEXT NOT NULL,
    symbol        TEXT NOT NULL,
    signal_ts     TEXT NOT NULL,           -- ISO UTC when signal fired
    action        TEXT NOT NULL,           -- BUY | SELL | HOLD
    strength      REAL DEFAULT 0.5,        -- 0-1
    price         REAL NOT NULL,
    strategy_id   TEXT NOT NULL,           -- e.g. ma_crossover / ml_xgb / ml_ensemble
    features_json TEXT DEFAULT '{}',       -- snapshot of all features at signal time
    params_json   TEXT DEFAULT '{}',       -- bot params at signal time
    stop_loss     REAL,
    take_profit   REAL,
    reason        TEXT DEFAULT '',
    -- Outcome fields filled N bars later
    outcome_price REAL,
    outcome_ts    TEXT,
    outcome_return_pct REAL,
    outcome_bars  INTEGER,
    outcome_label TEXT,                    -- WIN | LOSS | NEUTRAL (filled later)
    acted         INTEGER DEFAULT 0,       -- 1 if trade was executed from this signal
    created_at    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tg_sig_bot    ON tg_signal_log(bot_id, signal_ts DESC);
CREATE INDEX IF NOT EXISTS idx_tg_sig_sym    ON tg_signal_log(symbol, signal_ts DESC);
CREATE INDEX IF NOT EXISTS idx_tg_sig_strat  ON tg_signal_log(strategy_id, signal_ts DESC);
CREATE INDEX IF NOT EXISTS idx_tg_sig_unres  ON tg_signal_log(outcome_label)
    WHERE outcome_label IS NULL AND action != 'HOLD';
"""


async def ensure_signal_log():
    """Create signal log table if it doesn't exist."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            for stmt in _CREATE_SQL.strip().split(';'):
                if stmt.strip():
                    await db.execute(stmt)
            await db.commit()
    except Exception as e:
        logger.warning("ensure_signal_log: %s", e)


# ─────────────────────────────────────────────────────────────
# WRITE
# ─────────────────────────────────────────────────────────────

async def log_signal(
    bot_id:      str,
    symbol:      str,
    action:      str,
    price:       float,
    strategy_id: str,
    strength:    float       = 0.5,
    reason:      str         = "",
    stop_loss:   Optional[float] = None,
    take_profit: Optional[float] = None,
    features:    Dict        = None,
    params:      Dict        = None,
    acted:       bool        = False,
) -> str:
    """
    Persist one signal to tg_signal_log.
    Returns the new row id.
    Called by run_signal, ml_signal, and execute_trade.
    """
    row_id = str(uuid.uuid4())
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                """INSERT INTO tg_signal_log
                   (id, bot_id, symbol, signal_ts, action, strength, price,
                    strategy_id, features_json, params_json,
                    stop_loss, take_profit, reason, acted)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    row_id, bot_id, symbol,
                    datetime.utcnow().isoformat(),
                    action, round(strength, 4), round(price, 4),
                    strategy_id,
                    json.dumps(features or {}),
                    json.dumps(params   or {}),
                    round(stop_loss,   4) if stop_loss   else None,
                    round(take_profit, 4) if take_profit else None,
                    reason[:500], int(acted),
                )
            )
            await db.commit()
    except Exception as e:
        logger.debug("log_signal error: %s", e)
    return row_id


async def mark_acted(signal_id: str):
    """Mark a signal as having triggered a real trade execution."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                "UPDATE tg_signal_log SET acted=1 WHERE id=?", (signal_id,)
            )
            await db.commit()
    except Exception as e:
        logger.debug("mark_acted: %s", e)


# ─────────────────────────────────────────────────────────────
# OUTCOME RESOLUTION
# ─────────────────────────────────────────────────────────────

async def resolve_outcomes(symbol: str, current_price: float,
                            current_ts: str = None):
    """
    Fill outcome fields for unresolved BUY/SELL signals older than 5 bars.
    Called periodically (e.g. each time new price data arrives).
    """
    if current_ts is None:
        current_ts = datetime.utcnow().isoformat()
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            # Find unresolved signals for this symbol older than 1 day
            async with db.execute(
                """SELECT id, action, price, signal_ts
                   FROM tg_signal_log
                   WHERE symbol=? AND outcome_label IS NULL
                     AND action != 'HOLD'
                     AND datetime(signal_ts) < datetime('now', '-1 day')
                   LIMIT 100""",
                (symbol,)
            ) as c:
                rows = await c.fetchall()

            for row in rows:
                ret_pct = (current_price / row["price"] - 1) * 100
                # Flip for SELL signals: profit when price falls
                if row["action"] == "SELL":
                    ret_pct = -ret_pct
                label = "WIN" if ret_pct > 0.5 else "LOSS" if ret_pct < -0.5 else "NEUTRAL"
                await db.execute(
                    """UPDATE tg_signal_log
                       SET outcome_price=?, outcome_ts=?,
                           outcome_return_pct=?, outcome_label=?
                       WHERE id=?""",
                    (round(current_price, 4), current_ts,
                     round(ret_pct, 3), label, row["id"])
                )
            if rows:
                await db.commit()
                logger.debug("resolve_outcomes: resolved %d signals for %s", len(rows), symbol)
    except Exception as e:
        logger.debug("resolve_outcomes error: %s", e)


# ─────────────────────────────────────────────────────────────
# READ — for ML training
# ─────────────────────────────────────────────────────────────

async def get_training_data(
    symbol:      Optional[str] = None,
    strategy_id: Optional[str] = None,
    min_rows:    int = 50,
    limit:       int = 5000,
) -> List[Dict]:
    """
    Return resolved signals as training rows.
    Each row includes: features_json (X) and outcome_label (y).
    Only returns rows with outcome filled.
    """
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            wheres = ["outcome_label IS NOT NULL", "action != 'HOLD'"]
            params: list = []
            if symbol:
                wheres.append("symbol=?"); params.append(symbol)
            if strategy_id:
                wheres.append("strategy_id=?"); params.append(strategy_id)
            params.append(limit)

            async with db.execute(
                f"""SELECT id, symbol, action, price, strategy_id,
                           features_json, params_json, outcome_return_pct,
                           outcome_label, signal_ts, acted
                    FROM tg_signal_log
                    WHERE {' AND '.join(wheres)}
                    ORDER BY signal_ts DESC LIMIT ?""",
                params
            ) as c:
                rows = await c.fetchall()

        if len(rows) < min_rows:
            return []

        result = []
        for r in rows:
            try:
                feats = json.loads(r["features_json"] or "{}")
            except Exception:
                feats = {}
            result.append({
                "id":              r["id"],
                "symbol":          r["symbol"],
                "action":          r["action"],
                "price":           r["price"],
                "strategy_id":     r["strategy_id"],
                "features":        feats,
                "outcome_return":  r["outcome_return_pct"],
                "outcome_label":   r["outcome_label"],
                "signal_ts":       r["signal_ts"],
                "acted":           bool(r["acted"]),
            })
        return result
    except Exception as e:
        logger.warning("get_training_data: %s", e)
        return []


async def get_signal_history(
    bot_id:  Optional[str] = None,
    symbol:  Optional[str] = None,
    limit:   int = 200,
) -> List[Dict]:
    """
    Return recent signal history for display in UI.
    Includes unresolved signals (outcome_label may be NULL).
    """
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            wheres = []
            params: list = []
            if bot_id:
                wheres.append("bot_id=?"); params.append(bot_id)
            if symbol:
                wheres.append("symbol=?"); params.append(symbol)
            params.append(limit)
            where_clause = ("WHERE " + " AND ".join(wheres)) if wheres else ""

            async with db.execute(
                f"""SELECT id, bot_id, symbol, signal_ts, action, strength,
                           price, strategy_id, reason, stop_loss, take_profit,
                           outcome_return_pct, outcome_label, acted
                    FROM tg_signal_log
                    {where_clause}
                    ORDER BY signal_ts DESC LIMIT ?""",
                params
            ) as c:
                rows = await c.fetchall()

        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning("get_signal_history: %s", e)
        return []


async def get_signal_stats(bot_id: Optional[str] = None) -> Dict:
    """Aggregate statistics over resolved signals."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            wheres = ["outcome_label IS NOT NULL"]
            params = []
            if bot_id:
                wheres.append("bot_id=?"); params.append(bot_id)
            w = "WHERE " + " AND ".join(wheres)

            async with db.execute(
                f"""SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN outcome_label='WIN'  THEN 1 ELSE 0 END) as wins,
                    SUM(CASE WHEN outcome_label='LOSS' THEN 1 ELSE 0 END) as losses,
                    AVG(outcome_return_pct) as avg_return,
                    MAX(outcome_return_pct) as best,
                    MIN(outcome_return_pct) as worst,
                    SUM(CASE WHEN acted=1 THEN 1 ELSE 0 END) as acted_count
                   FROM tg_signal_log {w}""",
                params
            ) as c:
                row = await c.fetchone()

        if not row or not row[0]:
            return {"total": 0}
        total = row[0] or 1
        return {
            "total":        total,
            "wins":         row[1] or 0,
            "losses":       row[2] or 0,
            "win_rate":     round((row[1] or 0) / total * 100, 1),
            "avg_return":   round(row[3] or 0, 3),
            "best":         round(row[4] or 0, 3),
            "worst":        round(row[5] or 0, 3),
            "acted_count":  row[6] or 0,
        }
    except Exception as e:
        logger.warning("get_signal_stats: %s", e)
        return {"total": 0}
