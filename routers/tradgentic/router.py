"""
tradgentic/router.py
FastAPI router — all /api/tradgentic/* endpoints.
"""
from __future__ import annotations
import logging, time
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


# ════════════════════════════════════════════════════════════
# AGGREGATION ENGINE
# ════════════════════════════════════════════════════════════

from routers.tradgentic.aggregator import aggregate_signals, signal_stream_item

@router.get("/aggregate")
async def get_aggregated_signals(user=Depends(require_user)):
    """
    Run all active bots' strategies → aggregate signals with performance weighting.
    Returns meta-signals per symbol + contributor breakdown.
    """
    try:
        bots = await list_bots(user["id"])
        active_bots = [b for b in bots if b.get("active", 1)]
        if not active_bots:
            return {"signals": {}, "message": "No active bots"}

        signals_per_bot: dict = {}
        stats_per_bot:   dict = {}

        for bot in active_bots:
            strategy = get_strategy(bot["strategy"])
            if not strategy:
                continue
            assets  = bot.get("assets", [])
            params  = bot.get("params", {})
            bot_signals: dict = {}

            for sym in assets:
                hist = await fetch_history(sym, "6mo")
                if not hist:
                    continue
                prices = [h["close"] for h in hist]
                sig    = strategy.generate_signal(prices, params)
                bot_signals[sym] = {
                    "action":   sig.action,
                    "strength": sig.strength,
                    "reason":   sig.reason,
                    "price":    sig.price,
                }

            if bot_signals:
                signals_per_bot[bot["id"]] = bot_signals
                # Load stats
                all_assets = bot.get("assets", [])
                curr_prices = {}
                if all_assets:
                    qdata = await fetch_multi(all_assets)
                    curr_prices = {s: d["price"] for s, d in qdata.items()}
                stats = await get_portfolio_stats(bot["id"], curr_prices)
                stats_per_bot[bot["id"]] = {
                    "win_rate":     stats.get("win_rate", 50),
                    "total_trades": stats.get("total_trades", 0),
                    "total_return": stats.get("total_return", 0),
                }

        agg = aggregate_signals(signals_per_bot, stats_per_bot)

        # Enrich with live prices
        all_syms = list(agg.keys())
        prices   = {}
        if all_syms:
            pdata  = await fetch_multi(all_syms)
            prices = {s: d["price"] for s, d in pdata.items()}

        return {
            "signals": {
                sym: {
                    "action":       a.action,
                    "confidence":   a.confidence,
                    "vote_buy":     a.vote_buy,
                    "vote_sell":    a.vote_sell,
                    "contributors": a.contributors,
                    "reasons":      a.reasons,
                    "price":        prices.get(sym, 0),
                    "stream_item":  signal_stream_item(sym, a, prices.get(sym, 0)),
                }
                for sym, a in agg.items()
            },
            "bot_count": len(active_bots),
            "symbol_count": len(agg),
        }
    except Exception as e:
        logger.error("aggregate error: %s", e)
        return {"error": str(e), "signals": {}}


# ════════════════════════════════════════════════════════════
# POLYMARKET
# ════════════════════════════════════════════════════════════

from routers.tradgentic.polymarket import fetch_trending, poly_to_feature

@router.get("/polymarket/trending")
async def get_poly_trending(limit: int = Query(12, le=30)):
    """Trending Polymarket prediction markets."""
    try:
        markets = await fetch_trending(limit)
        features = poly_to_feature(markets)
        return {"markets": markets, "features": features, "count": len(markets)}
    except Exception as e:
        logger.error("polymarket error: %s", e)
        return {"markets": [], "features": {}, "error": str(e)}


@router.get("/polymarket/features")
async def get_poly_features():
    """Scalar feature vector from Polymarket for ML model input."""
    try:
        markets  = await fetch_trending(20)
        features = poly_to_feature(markets)
        return features
    except Exception as e:
        return {"error": str(e)}


# ════════════════════════════════════════════════════════════
# LIVE PNL — broadcasted via main WebSocket
# ════════════════════════════════════════════════════════════

@router.get("/pnl/snapshot")
async def get_pnl_snapshot(user=Depends(require_user)):
    """
    One-shot PnL snapshot for all user bots.
    Call this on initial load; live updates come via WebSocket type=tg_pnl.
    """
    try:
        bots = await list_bots(user["id"])
        result = []
        for b in bots:
            assets = b.get("assets", [])
            prices = {}
            if assets:
                qd = await fetch_multi(assets)
                prices = {s: d["price"] for s, d in qd.items()}
            stats = await get_portfolio_stats(b["id"], prices)
            result.append({
                "bot_id":       b["id"],
                "name":         b["name"],
                "strategy":     b["strategy"],
                "active":       b.get("active", 1),
                "equity":       stats.get("equity", 0),
                "cash":         stats.get("cash", 0),
                "pos_value":    stats.get("pos_value", 0),
                "total_return": stats.get("total_return", 0),
                "realized_pnl": stats.get("realized_pnl", 0),
                "total_trades": stats.get("total_trades", 0),
                "win_rate":     stats.get("win_rate", 0),
                "positions":    stats.get("positions", []),
            })
        return {"bots": result, "count": len(result)}
    except Exception as e:
        logger.error("pnl_snapshot error: %s", e)
        return {"bots": [], "error": str(e)}


# ══════════════════════════════════════════════════════════════════════════════
# BACKTESTING ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

from routers.tradgentic.backtest import (
    fetch_ohlcv, run_single_backtest, run_walk_forward,
    buy_hold_nav, grade_from_score, PERIOD_INTERVAL, TIMEFRAME_LABELS
)

_BT_CACHE: dict = {}
_BT_CACHE_TTL = 300  # 5 min

def _bt_cache_key(payload: dict) -> str:
    import json
    return json.dumps({k: payload.get(k) for k in
                       sorted(["symbol","strategy","period","params"])}, sort_keys=True)


@router.post("/backtest/run")
async def backtest_run(payload: dict = Body(...)):
    """
    Full single-pass backtest.
    Body: { symbol, strategy, period, params, commission_pct, slippage_pct }
    """
    try:
        symbol         = (payload.get("symbol") or "SPY").upper()
        strategy       = payload.get("strategy", "ma_crossover")
        period         = payload.get("period", "2y")
        params         = payload.get("params") or {}
        commission_pct = float(payload.get("commission_pct", 0.10))
        slippage_pct   = float(payload.get("slippage_pct",   0.05))

        cache_key = _bt_cache_key({
            "symbol": symbol, "strategy": strategy,
            "period": period, "params": params
        })
        cached = _BT_CACHE.get(cache_key)
        if cached and (time.time() - cached["ts"]) < _BT_CACHE_TTL:
            return cached["data"]

        bars = await fetch_ohlcv(symbol, period)
        if not bars:
            return {"error": "No data for symbol"}

        result = run_single_backtest(bars, strategy, params, commission_pct, slippage_pct)
        if "error" in result:
            return result

        bh  = buy_hold_nav(bars)
        m   = result["metrics"]
        grade, grade_label = grade_from_score(m.get("score", 0))

        data = {
            "symbol":       symbol,
            "strategy":     strategy,
            "period":       period,
            "n_bars":       result["n_bars"],
            "bars":         [{"date": b["date"], "close": b["close"]} for b in bars],
            "nav":          result["nav"],
            "buyhold_nav":  bh,
            "trades":       result["trades"][-50:],   # last 50 trades
            "n_trades":     len(result["trades"]),
            "metrics":      m,
            "grade":        grade,
            "grade_label":  grade_label,
            "commission_pct": commission_pct,
            "slippage_pct":   slippage_pct,
        }
        _BT_CACHE[cache_key] = {"ts": time.time(), "data": data}
        return data

    except Exception as e:
        logger.error("backtest_run error: %s", e)
        return {"error": str(e)}


@router.post("/backtest/walk-forward")
async def backtest_walk_forward(payload: dict = Body(...)):
    """
    Walk-forward validation — anti-overfitting.
    Body: { symbol, strategy, period, params, n_windows }
    """
    try:
        symbol     = (payload.get("symbol") or "SPY").upper()
        strategy   = payload.get("strategy", "ma_crossover")
        period     = payload.get("period", "5y")
        params     = payload.get("params") or {}
        n_windows  = int(payload.get("n_windows", 5))
        commission = float(payload.get("commission_pct", 0.10))
        slippage   = float(payload.get("slippage_pct",   0.05))

        bars = await fetch_ohlcv(symbol, period)
        if not bars:
            return {"error": "No data"}

        result = run_walk_forward(bars, strategy, params, n_windows, 0.70, commission, slippage)
        return {**result, "symbol": symbol, "strategy": strategy, "period": period}

    except Exception as e:
        logger.error("walk_forward error: %s", e)
        return {"error": str(e)}


@router.get("/backtest/periods")
async def backtest_periods():
    """Available period/timeframe combinations."""
    return {
        "periods": [
            {"key": "6mo",    "label": "6 Months",  "tf": "Daily",   "bars": 126},
            {"key": "1y",     "label": "1 Year",    "tf": "Daily",   "bars": 252},
            {"key": "2y",     "label": "2 Years",   "tf": "Daily",   "bars": 504},
            {"key": "5y",     "label": "5 Years",   "tf": "Weekly",  "bars": 260},
            {"key": "10y",    "label": "10 Years",  "tf": "Weekly",  "bars": 520},
            {"key": "2y_wk",  "label": "2Y Weekly", "tf": "Weekly",  "bars": 104},
            {"key": "5y_mo",  "label": "5Y Monthly","tf": "Monthly", "bars": 60},
            {"key": "10y_mo", "label": "10Y Monthly","tf": "Monthly","bars": 120},
        ],
        "strategies": [
            {"id": "ma_crossover",    "name": "MA Crossover",    "icon": "📈"},
            {"id": "rsi_reversion",   "name": "RSI Reversion",   "icon": "🔄"},
            {"id": "bollinger_bands", "name": "Bollinger Bands", "icon": "📊"},
            {"id": "macd_momentum",   "name": "MACD Momentum",   "icon": "⚡"},
            {"id": "buy_hold",        "name": "Buy & Hold",      "icon": "🔒"},
        ],
    }


# ══════════════════════════════════════════════════════════════════════════════
# FEATURE ENGINEERING ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

from routers.tradgentic.features import (
    compute_feature_set, fetch_cross_asset,
    action_from_composite, FEATURE_WEIGHTS,
    atr_series, obv_series, stochastic_series, adx_series,
    ichimoku_cloud, realised_vol, mtf_momentum,
)

_FEAT_CACHE: dict = {}
_FEAT_TTL = 120  # 2 minutes


@router.post("/features/analyse")
async def analyse_features(payload: dict = Body(...)):
    """
    Full feature engineering analysis for one symbol.
    Body: { symbol, period? }
    Returns: FeatureSet with composite signal, regime, all indicators.
    """
    try:
        symbol = (payload.get("symbol") or "SPY").upper()
        period = payload.get("period", "6mo")

        cache_key = f"feat:{symbol}:{period}"
        cached = _FEAT_CACHE.get(cache_key)
        if cached and (time.time() - cached["ts"]) < _FEAT_TTL:
            return cached["data"]

        # Fetch OHLCV
        from routers.tradgentic.backtest import fetch_ohlcv
        bars = await fetch_ohlcv(symbol, period)
        if not bars:
            return {"error": "No data for " + symbol}

        # Fetch cross-asset and polymarket in parallel
        cross, poly_data = await asyncio.gather(
            fetch_cross_asset(),
            fetch_trending(12),
            return_exceptions=True,
        )
        if isinstance(cross, Exception):    cross    = {}
        if isinstance(poly_data, Exception): poly_data = []

        from routers.tradgentic.polymarket import poly_to_feature
        poly_feats = poly_to_feature(poly_data) if poly_data else {}

        fs = await compute_feature_set(symbol, bars, poly_feats, cross)

        data = {
            "symbol":     fs.symbol,
            "timestamp":  fs.timestamp,
            "price":      fs.price,
            "composite":  fs.composite,
            "confidence": fs.confidence,
            "action":     action_from_composite(fs.composite),
            "regime":     fs.regime,
            "features":   fs.features,
            "components": fs.components,
            "n_bars":     len(bars),
            "weights":    FEATURE_WEIGHTS,
        }
        _FEAT_CACHE[cache_key] = {"ts": time.time(), "data": data}
        return data

    except Exception as e:
        logger.error("analyse_features error: %s", e)
        import traceback; logger.debug(traceback.format_exc())
        return {"error": str(e)}


@router.post("/features/multi")
async def analyse_multi(payload: dict = Body(...)):
    """
    Feature analysis for multiple symbols simultaneously.
    Body: { symbols: [...], period? }
    """
    try:
        symbols = [s.upper() for s in (payload.get("symbols") or ["SPY","BTC-USD","GC=F"])[:8]]
        period  = payload.get("period", "3mo")

        from routers.tradgentic.backtest import fetch_ohlcv

        # Fetch cross-asset once, reuse for all symbols
        cross, poly_data = await asyncio.gather(
            fetch_cross_asset(),
            fetch_trending(12),
            return_exceptions=True,
        )
        if isinstance(cross,    Exception): cross    = {}
        if isinstance(poly_data,Exception): poly_data = []

        from routers.tradgentic.polymarket import poly_to_feature
        poly_feats = poly_to_feature(poly_data) if poly_data else {}

        results = []
        for sym in symbols:
            try:
                bars = await fetch_ohlcv(sym, period)
                if not bars:
                    continue
                fs = await compute_feature_set(sym, bars, poly_feats, cross)
                results.append({
                    "symbol":     fs.symbol,
                    "price":      fs.price,
                    "composite":  fs.composite,
                    "confidence": fs.confidence,
                    "action":     action_from_composite(fs.composite),
                    "regime":     fs.regime,
                    "components": fs.components,
                })
            except Exception as e:
                logger.debug("multi analyse %s: %s", sym, e)

        results.sort(key=lambda r: abs(r["composite"]), reverse=True)
        return {
            "results":     results,
            "cross_asset": cross,
            "timestamp":   __import__("datetime").datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error("analyse_multi: %s", e)
        return {"error": str(e)}


@router.get("/features/indicators/{symbol}")
async def get_raw_indicators(symbol: str, period: str = Query("6mo")):
    """
    Raw indicator series for charting in the frontend.
    Returns time series for: RSI, ATR, OBV, Stochastic, ADX, Ichimoku, VWAP.
    """
    try:
        from routers.tradgentic.backtest import fetch_ohlcv
        from routers.tradgentic.features import (
            _rsi_series_local, obv_series, atr_series, stochastic_series,
            adx_series, ichimoku_cloud, realised_vol,
        )

        bars = await fetch_ohlcv(symbol.upper(), period)
        if not bars:
            return {"error": "No data"}

        closes  = [b["close"]  for b in bars]
        highs   = [b["high"]   for b in bars]
        lows    = [b["low"]    for b in bars]
        volumes = [b.get("volume",0) for b in bars]
        dates   = [b["date"]   for b in bars]
        returns = [(closes[i]/closes[i-1]-1) for i in range(1,len(closes))]

        rsi_s          = _rsi_series_local(closes, 14)
        atr_s          = atr_series(highs, lows, closes, 14)
        stk_k, stk_d   = stochastic_series(highs, lows, closes)
        adx_s, di_p, di_m = adx_series(highs, lows, closes)
        obv_s          = obv_series(closes, volumes)
        rv_s           = realised_vol(returns, 20)
        ichi           = ichimoku_cloud(highs, lows, closes)

        # Thin out data for large datasets (return max 300 points)
        step = max(1, len(dates) // 300)

        def thin(series):
            return [series[i] for i in range(0, len(series), step)]

        return {
            "dates":       thin(dates),
            "closes":      thin(closes),
            "rsi":         thin(rsi_s),
            "atr":         thin(atr_s),
            "stoch_k":     thin(stk_k),
            "stoch_d":     thin(stk_d),
            "adx":         thin(adx_s),
            "di_plus":     thin(di_p),
            "di_minus":    thin(di_m),
            "obv":         thin(obv_s),
            "realised_vol": thin(rv_s),
            "ichimoku": {
                k: thin(v) for k, v in ichi.items()
            },
            "n_bars": len(dates),
            "step":   step,
        }
    except Exception as e:
        logger.error("get_raw_indicators %s: %s", symbol, e)
        return {"error": str(e)}


@router.get("/features/cross-asset")
async def get_cross_asset():
    """Current cross-asset features: VIX, DXY, yields, gold."""
    try:
        import asyncio
        features = await fetch_cross_asset()
        return {"features": features, "timestamp": __import__("datetime").datetime.utcnow().isoformat()}
    except Exception as e:
        return {"error": str(e)}


# ══════════════════════════════════════════════════════════════════════════════
# SPRINT A — ONBOARDING, TEMPLATES, GLOSSARY
# ══════════════════════════════════════════════════════════════════════════════

from routers.tradgentic.templates import (
    BOT_TEMPLATES, GLOSSARY, get_template, recommend_template
)


@router.get("/templates")
async def get_bot_templates():
    """All pre-built bot templates with baked-in backtest metrics."""
    return {"templates": BOT_TEMPLATES}


@router.get("/templates/{template_id}")
async def get_template_detail(template_id: str):
    t = get_template(template_id)
    if not t:
        raise HTTPException(404, "Template not found")
    return t


@router.post("/templates/{template_id}/deploy")
async def deploy_from_template(
    template_id: str,
    payload: dict = Body({}),
    user=Depends(require_user),
):
    """
    One-click deploy from a template.
    Optionally override name via body { "name": "..." }.
    """
    try:
        t = get_template(template_id)
        if not t:
            return {"error": "Template not found"}

        await ensure_tables()
        name = payload.get("name") or t["name"]
        bot  = await create_bot(user["id"], {
            "name":      name,
            "strategy":  t["strategy"],
            "assets":    t["assets"],
            "timeframe": t.get("timeframe", "1d"),
            "params":    t["params"],
        })
        # Award XP for first deploy
        try:
            from routers.engage import award_xp
            await award_xp(user["id"], "tg_bot_deploy", 150)
        except Exception:
            pass
        return {"status": "deployed", "bot": bot, "template": template_id}
    except Exception as e:
        logger.error("deploy_from_template %s: %s", template_id, e)
        return {"error": str(e)}


@router.post("/profile-quiz")
async def profile_quiz(payload: dict = Body(...)):
    """
    Quiz of 2 questions → recommended template.
    Body: { goal: str, risk: str }
    """
    goal = payload.get("goal", "learn")
    risk = payload.get("risk", "moderate")
    template_id = recommend_template(goal, risk)
    template    = get_template(template_id)
    return {
        "recommended_template": template_id,
        "template":             template,
        "all_templates":        BOT_TEMPLATES,
    }


@router.get("/glossary")
async def get_glossary():
    """Plain-language explanations of all trading metrics."""
    return {"glossary": GLOSSARY}


@router.get("/glossary/{term}")
async def get_term(term: str):
    entry = GLOSSARY.get(term)
    if not entry:
        raise HTTPException(404, "Term not found")
    return entry


# ══════════════════════════════════════════════════════════════════════════════
# SPRINT B — ML BOTS + SIGNAL HISTORY
# ══════════════════════════════════════════════════════════════════════════════

from fastapi import BackgroundTasks
from routers.tradgentic.ml_bot import (
    train_gb_model, gb_signal, ensemble_signal, sentiment_signal,
    ML_STRATEGY_META, ML_STRATEGY_IDS,
)
from routers.tradgentic.signal_history import (
    ensure_signal_log, log_signal, get_signal_history,
    get_signal_stats, get_training_data, resolve_outcomes,
)
from routers.tradgentic.backtest import fetch_ohlcv

# In-memory training status tracker
_TRAINING_STATUS: dict = {}


@router.on_event("startup")
async def _init_signal_log():
    await ensure_signal_log()


@router.get("/ml/strategies")
async def get_ml_strategies():
    """List available ML strategy types with metadata."""
    return {"strategies": list(ML_STRATEGY_META.values())}


@router.post("/ml/train/{bot_id}")
async def train_ml_bot(
    bot_id: str,
    background_tasks: BackgroundTasks,
    user=Depends(require_user),
):
    """
    Kick off async ML model training for a bot.
    Returns immediately with status 'training_started'.
    Poll GET /ml/train/{bot_id}/status for progress.
    """
    try:
        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}
        if bot["strategy"] not in ML_STRATEGY_IDS:
            return {"error": f"Strategy '{bot['strategy']}' is not an ML strategy"}

        _TRAINING_STATUS[bot_id] = {
            "status": "training", "started_at": datetime.utcnow().isoformat(),
            "pct": 0, "message": "Fetching historical data…"
        }

        background_tasks.add_task(_train_bg, bot_id, bot)
        return {"status": "training_started", "bot_id": bot_id, "eta_seconds": 90}
    except Exception as e:
        return {"error": str(e)}


async def _train_bg(bot_id: str, bot: dict):
    """Background training task."""
    try:
        assets  = bot.get("assets", []) or ["SPY"]
        symbol  = assets[0]
        strategy = bot.get("strategy", "ml_xgb")

        _TRAINING_STATUS[bot_id]["message"] = f"Downloading 2Y of {symbol} data…"
        _TRAINING_STATUS[bot_id]["pct"]     = 15

        bars = await fetch_ohlcv(symbol, "2y")
        if not bars or len(bars) < 100:
            _TRAINING_STATUS[bot_id] = {"status": "failed", "message": "Insufficient data"}
            return

        _TRAINING_STATUS[bot_id]["message"] = "Building feature matrix…"
        _TRAINING_STATUS[bot_id]["pct"]     = 40

        model_info = train_gb_model(bars)

        if not model_info:
            _TRAINING_STATUS[bot_id] = {
                "status": "failed",
                "message": "Not enough training rows or sklearn unavailable"
            }
            return

        _TRAINING_STATUS[bot_id]["message"] = "Saving model to database…"
        _TRAINING_STATUS[bot_id]["pct"]     = 85

        # Save model_b64 into bot params
        params = dict(bot.get("params") or {})
        params["model_b64"]      = model_info["model_b64"]
        params["model_metrics"]  = {k: v for k, v in model_info.items() if k != "model_b64"}
        params["trained_symbol"] = symbol

        await update_bot(bot_id, {"params": params})

        _TRAINING_STATUS[bot_id] = {
            "status":       "complete",
            "pct":          100,
            "message":      "Training complete",
            "val_accuracy": model_info["val_accuracy"],
            "edge":         model_info["edge"],
            "n_train":      model_info["n_train"],
            "feature_importances": model_info.get("feature_importances", {}),
            "trained_at":   model_info["trained_at"],
        }
        logger.info("ML training complete for bot %s: acc=%.3f edge=%.3f",
                    bot_id, model_info["val_accuracy"], model_info["edge"])
    except Exception as e:
        logger.error("_train_bg error: %s", e)
        _TRAINING_STATUS[bot_id] = {"status": "failed", "message": str(e)}


@router.get("/ml/train/{bot_id}/status")
async def get_training_status(bot_id: str, user=Depends(require_user)):
    """Poll training progress."""
    status = _TRAINING_STATUS.get(bot_id)
    if not status:
        bot = await get_bot(bot_id)
        if bot and bot.get("params", {}).get("model_b64"):
            m = bot["params"].get("model_metrics", {})
            return {"status": "complete", "pct": 100, **m}
        return {"status": "not_started"}
    return status


@router.post("/ml/signal/{bot_id}")
async def run_ml_signal(bot_id: str, user=Depends(require_user)):
    """
    Generate ML-based signals for a bot.
    Logs every signal to tg_signal_log for future model training.
    """
    try:
        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}

        strategy = bot.get("strategy", "ml_xgb")
        assets   = bot.get("assets", [])
        params   = bot.get("params") or {}
        model_b64 = params.get("model_b64")
        signals   = {}

        for sym in assets:
            try:
                bars = await fetch_ohlcv(sym, "6mo")
                if not bars:
                    continue

                if strategy == "ml_xgb":
                    sig = gb_signal(model_b64, bars)
                    if not sig:
                        sig = {"action":"HOLD","strength":0.2,"price":bars[-1]["close"],
                               "reason":"Model not trained yet","source":"ml_xgb"}
                elif strategy == "ml_ensemble":
                    sig = ensemble_signal(model_b64, bars, params)
                elif strategy == "ml_sentiment":
                    sig = await sentiment_signal(sym, bars, params)
                else:
                    sig = {"action":"HOLD","strength":0.2,"price":bars[-1]["close"],
                           "reason":"Unknown ML strategy","source":strategy}

                signals[sym] = sig

                # ── Persist signal to history
                await log_signal(
                    bot_id      = bot_id,
                    symbol      = sym,
                    action      = sig["action"],
                    price       = sig["price"],
                    strategy_id = strategy,
                    strength    = sig.get("strength", 0.5),
                    reason      = sig.get("reason", ""),
                    features    = {"prob_up": sig.get("prob_up"), "raw_score": sig.get("raw_score"),
                                   "vix": sig.get("vix"), "votes": sig.get("votes")},
                    params      = {k: v for k, v in params.items() if k != "model_b64"},
                )

                # Resolve past outcomes for this symbol
                await resolve_outcomes(sym, sig["price"])

            except Exception as e:
                logger.debug("ml_signal %s %s: %s", bot_id, sym, e)

        return {
            "bot_id":   bot_id,
            "strategy": strategy,
            "signals":  signals,
            "has_model": bool(model_b64),
        }
    except Exception as e:
        logger.error("run_ml_signal: %s", e)
        return {"error": str(e)}


# ── Signal history endpoints ─────────────────────────────────

@router.get("/signals/history")
async def signal_history(
    bot_id: str = None,
    symbol: str = None,
    limit:  int = Query(100, le=500),
    user=Depends(require_user),
):
    """Signal history log — all signals ever generated, with outcomes."""
    rows = await get_signal_history(bot_id=bot_id, symbol=symbol, limit=limit)
    stats = await get_signal_stats(bot_id=bot_id)
    return {"signals": rows, "stats": stats, "count": len(rows)}


@router.get("/signals/stats")
async def signal_stats_endpoint(
    bot_id: str = None,
    user=Depends(require_user),
):
    """Aggregated signal statistics for gamification / model quality."""
    return await get_signal_stats(bot_id=bot_id)


@router.get("/signals/training-data")
async def export_training_data(
    symbol:      str = None,
    strategy_id: str = None,
    min_rows:    int = Query(50, ge=10),
    user=Depends(require_user),
):
    """
    Export resolved signal history as ML training dataset.
    X = feature snapshots, y = outcome labels.
    """
    rows = await get_training_data(symbol=symbol, strategy_id=strategy_id, min_rows=min_rows)
    return {
        "rows":       rows,
        "count":      len(rows),
        "ready":      len(rows) >= min_rows,
        "message":    f"{len(rows)} labeled examples available" if rows
                      else "Not enough resolved signals yet. Run bots for a few days first.",
    }


# ── Patch existing run_signal to also log to history ────────

_orig_run_signal = None  # will be patched below

@router.post("/bots/{bot_id}/signal/v2")
async def run_signal_v2(bot_id: str, user=Depends(require_user)):
    """
    run_signal with signal logging.
    Calls the original strategy, then persists every signal.
    """
    try:
        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}

        # Route ML strategies to ml endpoint
        if bot.get("strategy") in ML_STRATEGY_IDS:
            return await run_ml_signal.__wrapped__(bot_id, user) \
                if hasattr(run_ml_signal, "__wrapped__") else {"error": "use /ml/signal endpoint"}

        strategy_obj = get_strategy(bot["strategy"])
        if not strategy_obj:
            return {"error": "unknown_strategy"}

        assets  = bot.get("assets", [])
        params  = bot.get("params", {})
        signals = {}

        for sym in assets:
            try:
                hist = await fetch_history(sym, "6mo")
                if not hist:
                    continue
                prices = [h["close"] for h in hist]
                sig    = strategy_obj.generate_signal(prices, params)
                signals[sym] = {
                    "action":      sig.action,
                    "strength":    round(sig.strength, 3),
                    "reason":      sig.reason,
                    "price":       sig.price,
                    "stop_loss":   sig.stop_loss,
                    "take_profit": sig.take_profit,
                }
                # Log signal
                await log_signal(
                    bot_id      = bot_id,
                    symbol      = sym,
                    action      = sig.action,
                    price       = sig.price,
                    strategy_id = bot["strategy"],
                    strength    = sig.strength,
                    reason      = sig.reason,
                    stop_loss   = sig.stop_loss,
                    take_profit = sig.take_profit,
                    params      = params,
                )
                # Resolve past outcomes
                await resolve_outcomes(sym, sig.price)
            except Exception as e:
                logger.debug("signal_v2 %s %s: %s", bot_id, sym, e)

        return {"bot_id": bot_id, "signals": signals, "strategy": bot["strategy"]}
    except Exception as e:
        logger.error("run_signal_v2: %s", e)
        return {"error": str(e)}


# ══════════════════════════════════════════════════════════════════════════════
# SPRINT C — EXPLAINER, AUTOPSY, ACHIEVEMENTS, LEADERBOARD
# ══════════════════════════════════════════════════════════════════════════════

from routers.tradgentic.autopsy import explain_signal, autopsy_trade
from routers.tradgentic.leaderboard import (
    ensure_leaderboard_tables, award_achievement,
    check_and_award_trade_achievements,
    get_achievements, get_leaderboard, upsert_leaderboard,
    ACHIEVEMENT_DEFS,
)


@router.on_event("startup")
async def _init_leaderboard():
    await ensure_leaderboard_tables()


# ── C1: Trade Explainer ──────────────────────────────────────────────────────

@router.get("/explain/signal/{signal_id}")
async def explain_signal_endpoint(signal_id: str, user=Depends(require_user)):
    """
    Explain why a specific signal in tg_signal_log fired.
    Fetches feature snapshot from DB and generates plain-language breakdown.
    """
    try:
        async with aiosqlite.connect(__import__('config').settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM tg_signal_log WHERE id=?", (signal_id,)
            ) as c:
                row = await c.fetchone()
        if not row:
            return {"error": "Signal not found"}

        features = {}
        try:
            features = __import__('json').loads(row["features_json"] or "{}")
        except Exception:
            pass
        params = {}
        try:
            params = __import__('json').loads(row["params_json"] or "{}")
        except Exception:
            pass

        expl = explain_signal(
            symbol      = row["symbol"],
            action      = row["action"],
            price       = row["price"],
            strategy_id = row["strategy_id"],
            features    = features,
            params      = params,
            stop_loss   = row["stop_loss"],
            take_profit = row["take_profit"],
            strength    = row["strength"] or 0.5,
        )
        return expl
    except Exception as e:
        logger.error("explain_signal endpoint: %s", e)
        return {"error": str(e)}


@router.post("/explain/preview")
async def explain_preview(payload: dict = Body(...), user=Depends(require_user)):
    """
    Generate a signal explanation from a direct payload (no DB needed).
    Used by the frontend to explain the latest signal inline.
    Body: { symbol, action, price, strategy_id, features, params, stop_loss, take_profit, strength }
    """
    try:
        expl = explain_signal(
            symbol      = payload.get("symbol", "?"),
            action      = payload.get("action", "HOLD"),
            price       = float(payload.get("price", 0)),
            strategy_id = payload.get("strategy_id", "unknown"),
            features    = payload.get("features") or {},
            params      = payload.get("params")   or {},
            stop_loss   = payload.get("stop_loss"),
            take_profit = payload.get("take_profit"),
            strength    = float(payload.get("strength", 0.5)),
        )
        return expl
    except Exception as e:
        return {"error": str(e)}


# ── C2: Post-Trade Autopsy ───────────────────────────────────────────────────

@router.get("/autopsy/trade/{trade_id}")
async def autopsy_trade_endpoint(trade_id: str, user=Depends(require_user)):
    """
    Post-trade autopsy for a closed trade.
    Joins tg_trades with tg_signal_log to get entry features.
    """
    try:
        import aiosqlite, json
        from config import settings as cfg

        async with aiosqlite.connect(cfg.db_path) as db:
            db.row_factory = aiosqlite.Row
            # Get trade
            async with db.execute(
                "SELECT * FROM tg_trades WHERE id=?", (trade_id,)
            ) as c:
                trade = await c.fetchone()
            if not trade:
                return {"error": "Trade not found"}
            if trade["side"] != "SELL":
                return {"error": "Autopsy only available for closed (SELL) trades"}

            # Find matching BUY signal from signal log (closest in time before trade)
            async with db.execute(
                """SELECT features_json, params_json, stop_loss, take_profit, signal_ts, strength, price as entry_price
                   FROM tg_signal_log
                   WHERE bot_id=? AND symbol=? AND action='BUY'
                   ORDER BY signal_ts DESC LIMIT 1""",
                (trade["bot_id"], trade["symbol"])
            ) as c:
                sig = await c.fetchone()

        entry_feat = {}
        if sig:
            try: entry_feat = json.loads(sig["features_json"] or "{}")
            except Exception: pass

        entry_price = float(sig["entry_price"]) if sig else float(trade["price"])
        exit_price  = float(trade["price"])
        pnl         = float(trade["pnl"])
        pnl_pct     = (exit_price / entry_price - 1) * 100 if entry_price else 0.0

        # Bot strategy
        bot = await get_bot(trade["bot_id"])
        strategy_id = bot.get("strategy", "unknown") if bot else "unknown"

        result = autopsy_trade(
            symbol         = trade["symbol"],
            side           = "BUY",
            entry_price    = entry_price,
            exit_price     = exit_price,
            pnl            = pnl,
            pnl_pct        = pnl_pct,
            entry_features = entry_feat,
            exit_features  = {},   # no separate exit snapshot; use entry features
            strategy_id    = strategy_id,
            hold_bars      = 0,
        )
        result["trade_id"] = trade_id
        return result
    except Exception as e:
        logger.error("autopsy_trade: %s", e)
        return {"error": str(e)}


@router.get("/autopsy/bot/{bot_id}")
async def bot_autopsy_summary(bot_id: str, user=Depends(require_user)):
    """
    Aggregate autopsy across all closed trades for a bot.
    Returns patterns: what setups consistently work/fail.
    """
    try:
        import aiosqlite
        from config import settings as cfg

        bot = await get_bot(bot_id)
        if not bot or bot["user_id"] != user["id"]:
            return {"error": "not_found"}

        async with aiosqlite.connect(cfg.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT side, symbol, price, pnl, signal_reason, executed_at
                   FROM tg_trades WHERE bot_id=? AND side='SELL'
                   ORDER BY executed_at DESC LIMIT 50""",
                (bot_id,)
            ) as c:
                trades = await c.fetchall()

        if not trades:
            return {"bot_id": bot_id, "message": "No closed trades yet", "patterns": []}

        wins   = [t for t in trades if float(t["pnl"]) > 0]
        losses = [t for t in trades if float(t["pnl"]) <= 0]
        total  = len(trades)
        win_r  = len(wins) / total * 100

        avg_win  = sum(float(t["pnl"]) for t in wins)  / max(len(wins), 1)
        avg_loss = sum(float(t["pnl"]) for t in losses) / max(len(losses), 1)

        patterns = []
        if win_r > 55:
            patterns.append({"type": "positive", "text": f"Win rate {win_r:.0f}% — strategy has consistent edge"})
        elif win_r < 40:
            patterns.append({"type": "warning", "text": f"Win rate {win_r:.0f}% — strategy needs review or market regime changed"})

        if avg_win > abs(avg_loss) * 1.5:
            patterns.append({"type": "positive", "text": f"Average win (${avg_win:.0f}) is {avg_win/max(abs(avg_loss),1):.1f}x average loss — good risk/reward"})
        elif abs(avg_loss) > avg_win * 1.5:
            patterns.append({"type": "warning", "text": f"Average loss (${abs(avg_loss):.0f}) exceeds average win (${avg_win:.0f}) — review stop loss placement"})

        return {
            "bot_id":    bot_id,
            "n_trades":  total,
            "win_rate":  round(win_r, 1),
            "avg_win":   round(avg_win, 2),
            "avg_loss":  round(avg_loss, 2),
            "patterns":  patterns,
        }
    except Exception as e:
        logger.error("bot_autopsy_summary: %s", e)
        return {"error": str(e)}


# ── C3: Achievements ─────────────────────────────────────────────────────────

@router.get("/achievements")
async def list_achievements(user=Depends(require_user)):
    """User's achievements — earned and locked."""
    items = await get_achievements(user["id"])
    earned = [a for a in items if not a.get("locked")]
    total_xp = sum(a.get("xp", 0) for a in earned)
    return {"achievements": items, "earned_count": len(earned), "total_xp": total_xp}


@router.post("/achievements/award")
async def award_manual(payload: dict = Body(...), user=Depends(require_user)):
    """Award an achievement by key (called from frontend gamification events)."""
    key    = payload.get("key", "")
    bot_id = payload.get("bot_id")
    result = await award_achievement(user["id"], key, bot_id)
    return {"awarded": result is not None, "achievement": result}


# ── C4: Leaderboard ──────────────────────────────────────────────────────────

@router.get("/leaderboard")
async def leaderboard_endpoint(period: str = "all", limit: int = Query(20, le=50)):
    """Anonymous paper-trading leaderboard."""
    rows = await get_leaderboard(period, limit)
    return {"period": period, "entries": rows, "count": len(rows)}


@router.post("/leaderboard/submit")
async def submit_leaderboard(user=Depends(require_user)):
    """
    Update the leaderboard with the user's best bot performance.
    Called after each trade cycle.
    """
    try:
        bots = await list_bots(user["id"])
        if not bots:
            return {"status": "no_bots"}

        best = None
        for b in bots:
            stats = b.get("stats") or {}
            ret   = stats.get("total_return", 0.0)
            if best is None or ret > best.get("return", -999):
                best = {
                    "return":   ret,
                    "strategy": b.get("strategy", "unknown"),
                    "trades":   stats.get("total_trades", 0),
                    "win_rate": stats.get("win_rate", 0),
                }
                # Simple Sharpe approximation: return / (win_rate variance proxy)
                wr = max(stats.get("win_rate", 50) / 100, 0.01)
                best["sharpe"] = round(ret / (100 * (1 - wr) + 0.1), 3)

        if not best:
            return {"status": "no_data"}

        await upsert_leaderboard(
            user_id       = user["id"],
            period        = "all",
            total_return  = best["return"],
            sharpe        = best["sharpe"],
            win_rate      = best["win_rate"],
            n_trades      = best["trades"],
            best_strategy = best["strategy"],
        )
        return {"status": "submitted", "handle": f"Trader_{user['id']}"}
    except Exception as e:
        logger.error("submit_leaderboard: %s", e)
        return {"error": str(e)}
