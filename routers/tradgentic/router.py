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
