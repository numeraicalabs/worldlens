"""
tradgentic/router.py
FastAPI router — all /api/tradgentic/* endpoints.
"""
from __future__ import annotations
import logging
from typing import Optional
from fastapi import APIRouter, Depends, Body, Query

logger = logging.getLogger(__name__)

try:
    from routers.auth import require_user
except Exception:
    async def require_user(): return {"id": 1, "username": "demo"}

from routers.tradgentic.strategies import list_strategies, get_strategy
from routers.tradgentic.market_data import fetch_quote, fetch_multi, fetch_history
from routers.tradgentic.portfolio  import (
    create_bot, get_bot, list_bots, update_bot, delete_bot,
    execute_trade, get_portfolio_stats, ensure_tables
)

router = APIRouter(prefix="/api/tradgentic", tags=["tradgentic"])


# ── Strategies ────────────────────────────────────────────────────────────────

@router.get("/strategies")
async def get_strategies():
    """List all available trading strategies."""
    return list_strategies()


# ── Market Data ───────────────────────────────────────────────────────────────

@router.get("/quote/{symbol}")
async def get_quote(symbol: str):
    """Live quote for a single symbol."""
    try:
        return await fetch_quote(symbol.upper())
    except Exception as e:
        return {"error": str(e), "symbol": symbol}


@router.post("/quotes")
async def get_quotes(payload: dict = Body(...)):
    """Batch quotes: { symbols: ["AAPL","SPY",...] }"""
    symbols = payload.get("symbols", [])[:20]
    try:
        return await fetch_multi(symbols)
    except Exception as e:
        return {"error": str(e)}


@router.get("/history/{symbol}")
async def get_history(symbol: str, period: str = Query("3mo")):
    """OHLCV history for charting."""
    try:
        return await fetch_history(symbol.upper(), period)
    except Exception as e:
        return {"error": str(e)}


# ── Bots CRUD ────────────────────────────────────────────────────────────────

@router.get("/bots")
async def list_user_bots(user=Depends(require_user)):
    try:
        bots = await list_bots(user["id"])
        # Enrich with portfolio stats
        result = []
        for b in bots:
            assets = b.get("assets", [])
            if assets:
                prices = await fetch_multi(assets)
                curr   = {s: d["price"] for s, d in prices.items()}
            else:
                curr = {}
            stats = await get_portfolio_stats(b["id"], curr)
            result.append({**b, "stats": stats})
        return result
    except Exception as e:
        logger.error("list_bots error: %s", e)
        return []


@router.post("/bots")
async def create_new_bot(payload: dict = Body(...), user=Depends(require_user)):
    """Create a new paper trading bot."""
    try:
        await ensure_tables()
        bot = await create_bot(user["id"], payload)
        return {"status": "created", "bot": bot}
    except Exception as e:
        logger.error("create_bot error: %s", e)
        return {"error": str(e)}


@router.get("/bots/{bot_id}")
async def get_bot_detail(bot_id: str, user=Depends(require_user)):
    try:
        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}
        assets = bot.get("assets", [])
        prices = {}
        if assets:
            data   = await fetch_multi(assets)
            prices = {s: d["price"] for s, d in data.items()}
        stats = await get_portfolio_stats(bot_id, prices)
        return {**bot, "stats": stats, "quotes": prices}
    except Exception as e:
        logger.error("get_bot_detail: %s", e)
        return {"error": str(e)}


@router.patch("/bots/{bot_id}")
async def patch_bot(bot_id: str, payload: dict = Body(...), user=Depends(require_user)):
    bot = await get_bot(bot_id)
    if not bot or bot["user_id"] != user["id"]:
        return {"error": "not_found"}
    updated = await update_bot(bot_id, payload)
    return {"status": "updated", "bot": updated}


@router.delete("/bots/{bot_id}")
async def remove_bot(bot_id: str, user=Depends(require_user)):
    bot = await get_bot(bot_id)
    if not bot or bot["user_id"] != user["id"]:
        return {"error": "not_found"}
    await delete_bot(bot_id)
    return {"status": "deleted"}


# ── Signal generation ─────────────────────────────────────────────────────────

@router.post("/bots/{bot_id}/signal")
async def run_signal(bot_id: str, user=Depends(require_user)):
    """
    Run the bot's strategy against latest market data.
    Returns signals for each asset — does NOT execute automatically.
    """
    try:
        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}

        strategy = get_strategy(bot["strategy"])
        if not strategy:
            return {"error": "unknown_strategy"}

        assets  = bot.get("assets", [])
        params  = bot.get("params", {})
        signals = {}

        for sym in assets:
            hist = await fetch_history(sym, "6mo")
            if not hist:
                continue
            prices = [h["close"] for h in hist]
            signal = strategy.generate_signal(prices, params)
            signals[sym] = {
                "action":      signal.action,
                "strength":    round(signal.strength, 3),
                "reason":      signal.reason,
                "price":       signal.price,
                "stop_loss":   signal.stop_loss,
                "take_profit": signal.take_profit,
            }

        return {"bot_id": bot_id, "signals": signals, "strategy": bot["strategy"]}
    except Exception as e:
        logger.error("run_signal: %s", e)
        return {"error": str(e)}


@router.post("/bots/{bot_id}/execute")
async def execute_bot_signal(
    bot_id: str,
    payload: dict = Body(...),
    user=Depends(require_user),
):
    """
    Manually execute a paper trade: { symbol, side, price, reason }
    """
    try:
        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}
        if not bot.get("active", True):
            return {"error": "bot_inactive"}

        symbol = payload.get("symbol", "").upper()
        side   = payload.get("side", "").upper()
        price  = float(payload.get("price", 0))
        reason = payload.get("reason", "Manual")

        if side not in ("BUY", "SELL") or price <= 0:
            return {"error": "invalid_params"}

        result = await execute_trade(bot_id, symbol, side, price, reason)
        return result
    except Exception as e:
        logger.error("execute_bot_signal: %s", e)
        return {"error": str(e)}


@router.post("/bots/{bot_id}/run")
async def run_and_execute(bot_id: str, user=Depends(require_user)):
    """
    Full cycle: generate signals → auto-execute BUY/SELL (paper trading).
    """
    try:
        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}
        if not bot.get("active", 1):
            return {"status": "skipped", "reason": "bot inactive"}

        strategy = get_strategy(bot["strategy"])
        if not strategy:
            return {"error": "unknown_strategy"}

        assets = bot.get("assets", [])
        params = bot.get("params", {})
        executed = []

        for sym in assets:
            try:
                hist   = await fetch_history(sym, "6mo")
                prices = [h["close"] for h in hist] if hist else []
                if not prices:
                    continue
                signal = strategy.generate_signal(prices, params)
                if signal.action in ("BUY", "SELL"):
                    trade = await execute_trade(
                        bot_id, sym, signal.action, signal.price, signal.reason
                    )
                    if "error" not in trade:
                        executed.append({
                            "symbol": sym, "action": signal.action,
                            "price":  signal.price, "reason": signal.reason,
                            "trade":  trade,
                        })
            except Exception as se:
                logger.warning("run_execute %s %s: %s", bot_id, sym, se)

        return {"bot_id": bot_id, "executed": executed, "count": len(executed)}
    except Exception as e:
        logger.error("run_and_execute: %s", e)
        return {"error": str(e)}


# ── Reset bot portfolio ───────────────────────────────────────────────────────

@router.post("/bots/{bot_id}/reset")
async def reset_portfolio(bot_id: str, user=Depends(require_user)):
    """Reset paper trading balance back to initial capital."""
    try:
        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}
        from routers.tradgentic.portfolio import INITIAL_CAPITAL
        import aiosqlite as aq
        async with aq.connect(settings.db_path) as db:
            await db.execute("UPDATE tg_bots SET cash=? WHERE id=?", (INITIAL_CAPITAL, bot_id))
            await db.execute("DELETE FROM tg_positions WHERE bot_id=?", (bot_id,))
            await db.commit()
        return {"status": "reset", "cash": INITIAL_CAPITAL}
    except Exception as e:
        return {"error": str(e)}
