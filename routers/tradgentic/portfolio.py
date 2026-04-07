"""
tradgentic/portfolio.py
Paper trading portfolio engine — simulates orders, tracks PnL, stores trades.
Zero real money. Uses DB for persistence.
"""
from __future__ import annotations
import json, time, uuid, logging
from typing import List, Dict, Optional
from datetime import datetime

import aiosqlite

logger = logging.getLogger(__name__)

try:
    from config import settings
except ImportError:
    class _S: db_path = "worldlens.db"
    settings = _S()

INITIAL_CAPITAL = 100_000.0  # virtual USD per bot


# ── DB helpers ───────────────────────────────────────────────────────────────

async def ensure_tables():
    async with aiosqlite.connect(settings.db_path) as db:
        await db.executescript("""
        CREATE TABLE IF NOT EXISTS tg_bots (
            id          TEXT PRIMARY KEY,
            user_id     INTEGER NOT NULL,
            name        TEXT NOT NULL,
            strategy    TEXT NOT NULL,
            assets      TEXT DEFAULT '[]',
            timeframe   TEXT DEFAULT '1d',
            params      TEXT DEFAULT '{}',
            capital     REAL DEFAULT 100000.0,
            cash        REAL DEFAULT 100000.0,
            active      INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now')),
            updated_at  TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS tg_positions (
            id          TEXT PRIMARY KEY,
            bot_id      TEXT NOT NULL,
            symbol      TEXT NOT NULL,
            qty         REAL NOT NULL,
            avg_price   REAL NOT NULL,
            opened_at   TEXT DEFAULT (datetime('now')),
            UNIQUE(bot_id, symbol)
        );
        CREATE TABLE IF NOT EXISTS tg_trades (
            id          TEXT PRIMARY KEY,
            bot_id      TEXT NOT NULL,
            symbol      TEXT NOT NULL,
            side        TEXT NOT NULL,
            qty         REAL NOT NULL,
            price       REAL NOT NULL,
            pnl         REAL DEFAULT 0.0,
            signal_reason TEXT DEFAULT '',
            executed_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tg_bots_user   ON tg_bots(user_id);
        CREATE INDEX IF NOT EXISTS idx_tg_trades_bot  ON tg_trades(bot_id, executed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_tg_pos_bot     ON tg_positions(bot_id);
        """)
        await db.commit()


# ── Bot CRUD ─────────────────────────────────────────────────────────────────

async def create_bot(user_id: int, config: Dict) -> Dict:
    await ensure_tables()
    bot_id = str(uuid.uuid4())[:8].upper()
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT INTO tg_bots (id,user_id,name,strategy,assets,timeframe,params) "
            "VALUES (?,?,?,?,?,?,?)",
            (bot_id, user_id,
             config.get("name", "Bot " + bot_id),
             config.get("strategy", "ma_crossover"),
             json.dumps(config.get("assets", [])),
             config.get("timeframe", "1d"),
             json.dumps(config.get("params", {})))
        )
        await db.commit()
    return await get_bot(bot_id)


async def get_bot(bot_id: str) -> Optional[Dict]:
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM tg_bots WHERE id=?", (bot_id,)) as c:
            row = await c.fetchone()
    if not row:
        return None
    b = dict(row)
    b["assets"] = json.loads(b.get("assets") or "[]")
    b["params"] = json.loads(b.get("params") or "{}")
    return b


async def list_bots(user_id: int) -> List[Dict]:
    await ensure_tables()
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM tg_bots WHERE user_id=? ORDER BY created_at DESC",
            (user_id,)
        ) as c:
            rows = await c.fetchall()
    result = []
    for r in rows:
        b = dict(r)
        b["assets"] = json.loads(b.get("assets") or "[]")
        b["params"] = json.loads(b.get("params") or "{}")
        result.append(b)
    return result


async def update_bot(bot_id: str, updates: Dict) -> Optional[Dict]:
    allowed = {"name", "active", "params", "assets", "timeframe"}
    sets, vals = [], []
    for k, v in updates.items():
        if k not in allowed: continue
        sets.append(f"{k}=?")
        vals.append(json.dumps(v) if isinstance(v, (dict, list)) else v)
    if not sets:
        return await get_bot(bot_id)
    vals.append(datetime.utcnow().isoformat())
    vals.append(bot_id)
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            f"UPDATE tg_bots SET {','.join(sets)}, updated_at=? WHERE id=?", vals
        )
        await db.commit()
    return await get_bot(bot_id)


async def delete_bot(bot_id: str):
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("DELETE FROM tg_bots WHERE id=?", (bot_id,))
        await db.execute("DELETE FROM tg_positions WHERE bot_id=?", (bot_id,))
        await db.commit()


# ── Paper trade execution ────────────────────────────────────────────────────

async def execute_trade(bot_id: str, symbol: str, side: str,
                         price: float, reason: str = "") -> Dict:
    """
    Execute a paper trade. BUY uses 10% of available cash per position.
    SELL closes the full position.
    """
    bot = await get_bot(bot_id)
    if not bot:
        return {"error": "bot_not_found"}

    cash = float(bot["cash"])
    result = {}

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row

        if side == "BUY":
            # Allocate 10% of original capital per position
            alloc   = float(bot["capital"]) * 0.10
            if cash < alloc * 0.5:
                return {"error": "insufficient_cash", "cash": cash}
            qty     = round(alloc / price, 6)
            cost    = qty * price

            # Upsert position
            async with db.execute(
                "SELECT * FROM tg_positions WHERE bot_id=? AND symbol=?",
                (bot_id, symbol)
            ) as c:
                pos = await c.fetchone()

            if pos:
                new_qty   = pos["qty"] + qty
                new_avg   = (pos["qty"]*pos["avg_price"] + qty*price) / new_qty
                await db.execute(
                    "UPDATE tg_positions SET qty=?, avg_price=? WHERE bot_id=? AND symbol=?",
                    (new_qty, new_avg, bot_id, symbol)
                )
            else:
                await db.execute(
                    "INSERT INTO tg_positions (id,bot_id,symbol,qty,avg_price) VALUES (?,?,?,?,?)",
                    (str(uuid.uuid4())[:8], bot_id, symbol, qty, price)
                )

            new_cash = cash - cost
            await db.execute("UPDATE tg_bots SET cash=?, updated_at=? WHERE id=?",
                             (new_cash, datetime.utcnow().isoformat(), bot_id))

            trade_id = str(uuid.uuid4())[:8].upper()
            await db.execute(
                "INSERT INTO tg_trades (id,bot_id,symbol,side,qty,price,pnl,signal_reason) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (trade_id, bot_id, symbol, "BUY", qty, price, 0.0, reason)
            )
            result = {"trade_id": trade_id, "side": "BUY", "qty": qty,
                      "price": price, "cost": cost, "cash_after": new_cash}

        elif side == "SELL":
            async with db.execute(
                "SELECT * FROM tg_positions WHERE bot_id=? AND symbol=?",
                (bot_id, symbol)
            ) as c:
                pos = await c.fetchone()

            if not pos or pos["qty"] <= 0:
                return {"error": "no_position"}

            qty  = pos["qty"]
            pnl  = round((price - pos["avg_price"]) * qty, 4)
            proceeds = qty * price

            await db.execute(
                "DELETE FROM tg_positions WHERE bot_id=? AND symbol=?",
                (bot_id, symbol)
            )
            new_cash = cash + proceeds
            await db.execute("UPDATE tg_bots SET cash=?, updated_at=? WHERE id=?",
                             (new_cash, datetime.utcnow().isoformat(), bot_id))

            trade_id = str(uuid.uuid4())[:8].upper()
            await db.execute(
                "INSERT INTO tg_trades (id,bot_id,symbol,side,qty,price,pnl,signal_reason) "
                "VALUES (?,?,?,?,?,?,?,?)",
                (trade_id, bot_id, symbol, "SELL", qty, price, pnl, reason)
            )
            result = {"trade_id": trade_id, "side": "SELL", "qty": qty,
                      "price": price, "pnl": pnl, "cash_after": new_cash}

        await db.commit()

    return result


# ── Portfolio stats ───────────────────────────────────────────────────────────

async def get_portfolio_stats(bot_id: str, current_prices: Dict[str, float]) -> Dict:
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row

        async with db.execute("SELECT * FROM tg_bots WHERE id=?", (bot_id,)) as c:
            bot = dict(await c.fetchone() or {})
        if not bot:
            return {}

        async with db.execute(
            "SELECT * FROM tg_positions WHERE bot_id=?", (bot_id,)
        ) as c:
            positions = [dict(r) for r in await c.fetchall()]

        async with db.execute(
            "SELECT SUM(pnl) as total_pnl, COUNT(*) as total_trades, "
            "SUM(CASE WHEN pnl>0 THEN 1 ELSE 0 END) as wins "
            "FROM tg_trades WHERE bot_id=?", (bot_id,)
        ) as c:
            stats_row = dict(await c.fetchone() or {})

        async with db.execute(
            "SELECT * FROM tg_trades WHERE bot_id=? ORDER BY executed_at DESC LIMIT 20",
            (bot_id,)
        ) as c:
            trades = [dict(r) for r in await c.fetchall()]

    # Calculate open positions value
    pos_value = 0.0
    pos_details = []
    for p in positions:
        curr  = current_prices.get(p["symbol"], p["avg_price"])
        val   = p["qty"] * curr
        unr   = (curr - p["avg_price"]) * p["qty"]
        unr_pct = (curr - p["avg_price"]) / p["avg_price"] * 100 if p["avg_price"] else 0
        pos_value += val
        pos_details.append({
            "symbol":    p["symbol"],
            "qty":       round(p["qty"], 6),
            "avg_price": round(p["avg_price"], 4),
            "curr_price": round(curr, 4),
            "value":     round(val, 2),
            "unrealized_pnl": round(unr, 2),
            "unrealized_pct": round(unr_pct, 2),
        })

    cash        = float(bot.get("cash", INITIAL_CAPITAL))
    capital     = float(bot.get("capital", INITIAL_CAPITAL))
    equity      = cash + pos_value
    total_pnl   = float(stats_row.get("total_pnl") or 0)
    total_return= (equity - capital) / capital * 100 if capital else 0
    total_trades= int(stats_row.get("total_trades") or 0)
    wins        = int(stats_row.get("wins") or 0)
    win_rate    = wins / total_trades * 100 if total_trades > 0 else 0

    return {
        "bot_id":        bot_id,
        "cash":          round(cash, 2),
        "pos_value":     round(pos_value, 2),
        "equity":        round(equity, 2),
        "capital":       round(capital, 2),
        "realized_pnl":  round(total_pnl, 2),
        "total_return":  round(total_return, 2),
        "total_trades":  total_trades,
        "win_rate":      round(win_rate, 1),
        "positions":     pos_details,
        "recent_trades": trades[:10],
    }
