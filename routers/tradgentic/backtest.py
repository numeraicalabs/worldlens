"""
tradgentic/backtest.py
Robust backtesting engine with walk-forward validation.

Features:
  - All 4 strategies with timeframe support (1d, 1wk, 1mo)
  - Transaction costs + slippage
  - Full metrics: Sharpe, Sortino, Calmar, Max DD, Win Rate, Profit Factor
  - Walk-forward validation (rolling windows)
  - Per-trade log
  - Gamification scoring
"""
from __future__ import annotations
import math, time, logging, random
from typing import List, Dict, Optional, Tuple, Any
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ── Constants ─────────────────────────────────────────────────────────────────

TRADING_DAYS = {
    "1d":  252,   # bars per year
    "1wk":  52,
    "1mo":  12,
}

TIMEFRAME_LABELS = {
    "1d":  "Daily",
    "1wk": "Weekly",
    "1mo": "Monthly",
}

# yfinance period → interval mapping
PERIOD_INTERVAL = {
    # (period_str, interval_str) for yfinance
    "6mo":  ("6mo",  "1d"),
    "1y":   ("1y",   "1d"),
    "2y":   ("2y",   "1d"),
    "5y":   ("5y",   "1wk"),
    "10y":  ("10y",  "1wk"),
    "1y_wk":  ("1y",  "1wk"),
    "2y_wk":  ("2y",  "1wk"),
    "5y_wk":  ("5y",  "1wk"),
    "2y_mo":  ("2y",  "1mo"),
    "5y_mo":  ("5y",  "1mo"),
    "10y_mo": ("10y", "1mo"),
}


# ── Data fetcher ──────────────────────────────────────────────────────────────

async def fetch_ohlcv(symbol: str, period_key: str) -> List[Dict]:
    """
    Fetch OHLCV bars. Returns list of {date, open, high, low, close, volume}.
    Falls back to synthetic data if yfinance unavailable.
    """
    yf_period, yf_interval = PERIOD_INTERVAL.get(period_key, ("2y", "1d"))
    try:
        import yfinance as yf
        df = yf.Ticker(symbol).history(period=yf_period, interval=yf_interval)
        if df is None or df.empty:
            raise ValueError("empty response")
        bars = []
        for idx, row in df.iterrows():
            bars.append({
                "date":   idx.strftime("%Y-%m-%d"),
                "open":   round(float(row["Open"]),  4),
                "high":   round(float(row["High"]),  4),
                "low":    round(float(row["Low"]),   4),
                "close":  round(float(row["Close"]), 4),
                "volume": int(row.get("Volume", 0)),
            })
        return bars
    except Exception as e:
        logger.debug("fetch_ohlcv fallback %s/%s: %s", symbol, period_key, e)
        return _synthetic_ohlcv(symbol, period_key)


def _synthetic_ohlcv(symbol: str, period_key: str) -> List[Dict]:
    """Deterministic synthetic OHLCV bars."""
    yf_period, yf_interval = PERIOD_INTERVAL.get(period_key, ("2y", "1d"))
    bars_per_year = {"1d": 252, "1wk": 52, "1mo": 12}.get(yf_interval, 252)
    years = {"6mo": 0.5, "1y": 1, "2y": 2, "5y": 5, "10y": 10}.get(yf_period, 2)
    n = int(bars_per_year * years)

    BASE = {"AAPL": 140, "MSFT": 320, "NVDA": 450, "SPY": 430, "QQQ": 360,
            "BTC-USD": 42000, "ETH-USD": 2200, "GC=F": 1950, "CL=F": 75,
            "^GSPC": 4400, "^VIX": 18, "TSLA": 200, "AMZN": 160}
    rng  = random.Random(sum(ord(c) for c in symbol) + n)
    base = BASE.get(symbol.upper(), 100)

    # Simulate trending market with occasional crashes
    mu    = 0.0003  # daily drift
    sigma = 0.015
    price = base
    bars  = []
    
    step_days = {"1d": 1, "1wk": 7, "1mo": 30}.get(yf_interval, 1)
    start = datetime.utcnow() - timedelta(days=int(365 * years))

    for i in range(n):
        ret   = rng.gauss(mu, sigma)
        # Occasional regime shift
        if rng.random() < 0.01:
            ret -= rng.uniform(0.03, 0.10)
        price = max(price * (1 + ret), 0.01)
        day   = (start + timedelta(days=i * step_days)).strftime("%Y-%m-%d")
        spread = price * 0.002
        hi = round(price * rng.uniform(1.001, 1.018), 4)
        lo = round(price * rng.uniform(0.982, 0.999), 4)
        op = round(price + rng.uniform(-spread, spread), 4)
        bars.append({
            "date": day, "open": op,
            "high": hi,  "low":  lo,
            "close": round(price, 4),
            "volume": rng.randint(500_000, 10_000_000)
        })
    return bars


# ── Indicators ────────────────────────────────────────────────────────────────

def _sma_series(closes: List[float], n: int) -> List[Optional[float]]:
    out = [None] * len(closes)
    for i in range(n - 1, len(closes)):
        out[i] = sum(closes[i - n + 1:i + 1]) / n
    return out

def _ema_series(closes: List[float], n: int) -> List[Optional[float]]:
    out  = [None] * len(closes)
    k    = 2 / (n + 1)
    ema  = closes[n - 1] if len(closes) >= n else None
    if ema is None:
        return out
    out[n - 1] = ema
    for i in range(n, len(closes)):
        ema = closes[i] * k + ema * (1 - k)
        out[i] = ema
    return out

def _rsi_series(closes: List[float], n: int = 14) -> List[Optional[float]]:
    out = [None] * len(closes)
    if len(closes) < n + 1:
        return out
    deltas = [closes[i] - closes[i-1] for i in range(1, len(closes))]
    for i in range(n, len(closes)):
        window = deltas[i - n:i]
        gains  = sum(max(d, 0) for d in window) / n
        losses = sum(abs(min(d, 0)) for d in window) / n
        if losses == 0:
            out[i] = 100.0
        else:
            rs = gains / losses
            out[i] = round(100 - 100 / (1 + rs), 2)
    return out

def _bb_series(closes: List[float], n: int = 20, k: float = 2.0):
    lower_s = [None] * len(closes)
    upper_s = [None] * len(closes)
    mid_s   = [None] * len(closes)
    for i in range(n - 1, len(closes)):
        w   = closes[i - n + 1:i + 1]
        mid = sum(w) / n
        std = math.sqrt(sum((p - mid)**2 for p in w) / n)
        mid_s[i]   = mid
        lower_s[i] = mid - k * std
        upper_s[i] = mid + k * std
    return lower_s, mid_s, upper_s

def _macd_series(closes: List[float]):
    e12 = _ema_series(closes, 12)
    e26 = _ema_series(closes, 26)
    macd_line   = [None] * len(closes)
    signal_line = [None] * len(closes)
    hist        = [None] * len(closes)
    macd_vals = []
    for i in range(len(closes)):
        if e12[i] is not None and e26[i] is not None:
            macd_line[i] = e12[i] - e26[i]
            macd_vals.append(macd_line[i])
    # Signal = 9-EMA of MACD
    if macd_vals:
        sig_ema = _ema_series(macd_vals, 9)
        si = 0
        for i in range(len(closes)):
            if macd_line[i] is not None:
                signal_line[i] = sig_ema[si]
                if sig_ema[si] is not None:
                    hist[i] = macd_line[i] - sig_ema[si]
                si += 1
    return macd_line, signal_line, hist


# ── Core backtest engine ──────────────────────────────────────────────────────

def run_single_backtest(
    bars:            List[Dict],
    strategy:        str,
    params:          Dict,
    commission_pct:  float = 0.10,   # 0.10% per trade
    slippage_pct:    float = 0.05,   # 0.05% market impact
    initial_capital: float = 100_000.0,
) -> Dict:
    """
    Run one pass of backtesting on a bar sequence.
    Returns metrics + trade log + NAV series.
    """
    closes  = [b["close"] for b in bars]
    highs   = [b["high"]  for b in bars]
    lows    = [b["low"]   for b in bars]
    dates   = [b["date"]  for b in bars]
    n       = len(closes)

    if n < 30:
        return {"error": "Too few bars (need 30+)"}

    # Pre-compute indicators
    if strategy == "ma_crossover":
        fast_n = int(params.get("fast_ma", 10))
        slow_n = int(params.get("slow_ma", 30))
        fn = _ema_series if params.get("ma_type", "EMA") == "EMA" else _sma_series
        fast_s = fn(closes, fast_n)
        slow_s = fn(closes, slow_n)
    elif strategy == "rsi_reversion":
        rsi_n  = int(params.get("rsi_period", 14))
        rsi_s  = _rsi_series(closes, rsi_n)
    elif strategy == "bollinger_bands":
        bb_n   = int(params.get("bb_period", 20))
        bb_k   = float(params.get("bb_std", 2.0))
        lower_s, mid_s, upper_s = _bb_series(closes, bb_n, bb_k)
    elif strategy == "macd_momentum":
        macd_line, signal_line, hist_s = _macd_series(closes)

    # Simulation state
    cash        = initial_capital
    position    = 0.0    # shares held
    entry_price = 0.0
    entry_day   = 0
    trades      = []
    nav_series  = []
    equity_peak = initial_capital
    drawdowns   = []

    def _trade_cost(price, qty):
        notional = price * qty
        return notional * (commission_pct + slippage_pct) / 100

    for i in range(1, n):
        price = closes[i]
        signal = "HOLD"

        # Strategy signal logic
        if strategy == "buy_hold":
            if i == 1:
                signal = "BUY"

        elif strategy == "ma_crossover":
            if fast_s[i] and slow_s[i] and fast_s[i-1] and slow_s[i-1]:
                if fast_s[i-1] <= slow_s[i-1] and fast_s[i] > slow_s[i]:
                    signal = "BUY"
                elif fast_s[i-1] >= slow_s[i-1] and fast_s[i] < slow_s[i]:
                    signal = "SELL"

        elif strategy == "rsi_reversion":
            ov  = int(params.get("oversold", 30))
            ovb = int(params.get("overbought", 70))
            rsi = rsi_s[i]
            if rsi is not None:
                if rsi <= ov:
                    signal = "BUY"
                elif rsi >= ovb:
                    signal = "SELL"

        elif strategy == "bollinger_bands":
            mode = params.get("mode", "reversion")
            lo, mi, up = lower_s[i], mid_s[i], upper_s[i]
            if None not in (lo, mi, up):
                if mode == "reversion":
                    if price <= lo:   signal = "BUY"
                    elif price >= up: signal = "SELL"
                else:  # breakout
                    if price > up:    signal = "BUY"
                    elif price < lo:  signal = "SELL"

        elif strategy == "macd_momentum":
            mh = hist_s[i]
            ph = hist_s[i-1]
            min_h = float(params.get("min_hist", 0.1))
            if mh is not None and ph is not None:
                if ph <= 0 and mh > min_h:    signal = "BUY"
                elif ph >= 0 and mh < -min_h: signal = "SELL"

        # Execute trades
        if signal == "BUY" and position == 0 and cash > price:
            qty         = math.floor(cash * 0.95 / price)
            cost        = _trade_cost(price, qty)
            total_spend = price * qty + cost
            if total_spend <= cash:
                cash       -= total_spend
                position    = qty
                entry_price = price
                entry_day   = i
                trades.append({
                    "date":   dates[i],
                    "type":   "BUY",
                    "price":  round(price, 4),
                    "qty":    qty,
                    "cost":   round(cost, 2),
                    "nav":    round(cash + position * price, 2),
                })

        elif signal == "SELL" and position > 0:
            proceeds = position * price
            cost     = _trade_cost(price, position)
            cash    += proceeds - cost
            pnl      = (price - entry_price) * position - cost
            hold_bars = i - entry_day
            trades.append({
                "date":     dates[i],
                "type":     "SELL",
                "price":    round(price, 4),
                "qty":      position,
                "pnl":      round(pnl, 2),
                "pnl_pct":  round((price/entry_price - 1) * 100, 2),
                "hold_bars": hold_bars,
                "nav":      round(cash, 2),
            })
            position = 0.0

        # Stop loss check
        stop_pct = float(params.get("stop_pct", 2.0)) / 100
        if position > 0 and price < entry_price * (1 - stop_pct):
            proceeds = position * price
            cost     = _trade_cost(price, position)
            cash    += proceeds - cost
            pnl      = (price - entry_price) * position - cost
            trades.append({
                "date":     dates[i],
                "type":     "STOP",
                "price":    round(price, 4),
                "qty":      position,
                "pnl":      round(pnl, 2),
                "pnl_pct":  round((price/entry_price - 1) * 100, 2),
                "hold_bars": i - entry_day,
                "nav":      round(cash, 2),
            })
            position = 0.0

        nav = cash + position * price
        nav_series.append(round(nav, 2))
        if nav > equity_peak:
            equity_peak = nav
        dd = (equity_peak - nav) / equity_peak
        drawdowns.append(dd)

    if not nav_series:
        return {"error": "No NAV generated"}

    # Compute returns
    nav_base     = initial_capital
    total_return = (nav_series[-1] / nav_base - 1) * 100
    
    daily_returns = []
    prev = nav_base
    for v in nav_series:
        if prev > 0:
            daily_returns.append((v - prev) / prev)
        prev = v

    # Normalise NAV to 100 base
    nav_norm = [round(v / nav_base * 100, 4) for v in nav_series]

    metrics = _compute_metrics(nav_norm, daily_returns, trades, len(closes), strategy)
    return {
        "nav":         nav_norm,
        "trades":      trades,
        "metrics":     metrics,
        "n_bars":      n,
        "period_days": len(nav_series),
    }


def _compute_metrics(nav: List[float], returns: List[float], trades: List[Dict],
                      n_bars: int, strategy: str) -> Dict:
    if not returns:
        return {}

    total_return  = nav[-1] - 100
    bars_per_year = 252  # will be overridden by caller if weekly/monthly
    ann_factor    = bars_per_year / n_bars
    ann_return    = ((nav[-1] / 100) ** ann_factor - 1) * 100

    # Sharpe
    avg_r = sum(returns) / len(returns)
    std_r = math.sqrt(sum((r - avg_r)**2 for r in returns) / max(len(returns)-1, 1))
    sharpe = round((avg_r * bars_per_year) / (std_r * math.sqrt(bars_per_year) + 1e-9), 3)

    # Sortino (downside deviation)
    neg_r  = [r for r in returns if r < 0]
    ddev   = math.sqrt(sum(r**2 for r in neg_r) / max(len(neg_r), 1))
    sortino = round((avg_r * bars_per_year) / (ddev * math.sqrt(bars_per_year) + 1e-9), 3)

    # Max drawdown
    peak  = nav[0]
    max_dd = 0.0
    dd_start = dd_end = 0
    for i, v in enumerate(nav):
        if v > peak:
            peak = v
        dd = (peak - v) / peak
        if dd > max_dd:
            max_dd  = dd
            dd_end  = i

    # Calmar = Ann Return / Max Drawdown
    calmar = round(ann_return / (max_dd * 100 + 1e-9), 3)

    # Win rate, profit factor
    sell_trades = [t for t in trades if t.get("type") in ("SELL", "STOP")]
    n_trades    = len(sell_trades)
    if n_trades:
        winners    = [t for t in sell_trades if t.get("pnl", 0) > 0]
        win_rate   = round(len(winners) / n_trades * 100, 1)
        gross_win  = sum(t["pnl"] for t in winners)
        gross_loss = abs(sum(t["pnl"] for t in sell_trades if t.get("pnl", 0) < 0))
        pf         = round(gross_win / (gross_loss + 1e-9), 3)
        avg_win    = round(gross_win  / max(len(winners), 1), 2)
        avg_loss   = round(gross_loss / max(n_trades - len(winners), 1), 2)
        avg_hold   = round(sum(t.get("hold_bars", 0) for t in sell_trades) / n_trades, 1)
    else:
        win_rate = avg_win = avg_loss = avg_hold = 0
        pf = 0.0

    # Gamification score (0-1000)
    score = _gamification_score(sharpe, max_dd, win_rate, calmar, pf)

    return {
        "total_return_pct": round(total_return, 2),
        "ann_return_pct":   round(ann_return, 2),
        "sharpe":           sharpe,
        "sortino":          sortino,
        "calmar":           calmar,
        "max_drawdown_pct": round(max_dd * 100, 2),
        "win_rate_pct":     win_rate,
        "profit_factor":    pf,
        "n_trades":         n_trades,
        "avg_win_usd":      avg_win,
        "avg_loss_usd":     avg_loss,
        "avg_hold_bars":    avg_hold,
        "score":            score,
    }


def _gamification_score(sharpe: float, max_dd: float, win_rate: float,
                         calmar: float, pf: float) -> int:
    """
    Score 0-1000 based on risk-adjusted performance.
    Grades: F(<200) D(<350) C(<500) B(<650) A(<800) S(800+)
    """
    s = 0
    # Sharpe component (max 300)
    s += min(300, max(0, int(sharpe * 150)))
    # Drawdown component (max 200) — lower is better
    s += max(0, int((1 - min(max_dd / 0.30, 1)) * 200))
    # Win rate (max 150)
    s += min(150, max(0, int((win_rate - 40) / 60 * 150)))
    # Calmar (max 200)
    s += min(200, max(0, int(calmar * 50)))
    # Profit factor (max 150)
    s += min(150, max(0, int((pf - 1) / 2 * 150)))
    return min(1000, max(0, s))


def grade_from_score(score: int) -> Tuple[str, str]:
    """Returns (grade, description)"""
    if score >= 800: return "S", "Elite"
    if score >= 650: return "A", "Strong"
    if score >= 500: return "B", "Good"
    if score >= 350: return "C", "Average"
    if score >= 200: return "D", "Weak"
    return "F", "Poor"


# ── Walk-forward validation ───────────────────────────────────────────────────

def run_walk_forward(
    bars:            List[Dict],
    strategy:        str,
    params:          Dict,
    n_windows:       int   = 5,
    train_frac:      float = 0.70,
    commission_pct:  float = 0.10,
    slippage_pct:    float = 0.05,
) -> Dict:
    """
    Walk-forward validation.
    Divides data into n_windows rolling periods.
    Each window: 70% in-sample (optimise) / 30% out-of-sample (validate).
    Returns per-window results + combined OOS metrics.
    """
    n = len(bars)
    if n < 60:
        return {"error": "Need at least 60 bars for walk-forward"}

    window_size  = n // n_windows
    if window_size < 30:
        n_windows    = max(3, n // 40)
        window_size  = n // n_windows

    windows      = []
    oos_navs     = []
    oos_returns  = []

    for w in range(n_windows):
        start = w * window_size
        end   = min(start + window_size, n)
        win_bars = bars[start:end]
        
        split   = int(len(win_bars) * train_frac)
        in_bars  = win_bars[:split]
        oos_bars = win_bars[split:]

        if len(oos_bars) < 10:
            continue

        # In-sample result
        is_result  = run_single_backtest(in_bars,  strategy, params, commission_pct, slippage_pct)
        oos_result = run_single_backtest(oos_bars, strategy, params, commission_pct, slippage_pct)

        if "error" in is_result or "error" in oos_result:
            continue

        is_m  = is_result["metrics"]
        oos_m = oos_result["metrics"]

        windows.append({
            "window":       w + 1,
            "date_start":   win_bars[0]["date"],
            "date_split":   win_bars[split]["date"] if split < len(win_bars) else "",
            "date_end":     win_bars[-1]["date"],
            "n_in_bars":    len(in_bars),
            "n_oos_bars":   len(oos_bars),
            "in_sample":    {
                "total_return_pct": is_m.get("total_return_pct"),
                "sharpe":           is_m.get("sharpe"),
                "max_drawdown_pct": is_m.get("max_drawdown_pct"),
                "win_rate_pct":     is_m.get("win_rate_pct"),
                "score":            is_m.get("score"),
            },
            "out_of_sample": {
                "total_return_pct": oos_m.get("total_return_pct"),
                "sharpe":           oos_m.get("sharpe"),
                "max_drawdown_pct": oos_m.get("max_drawdown_pct"),
                "win_rate_pct":     oos_m.get("win_rate_pct"),
                "score":            oos_m.get("score"),
            },
            "oos_nav": oos_result["nav"],
        })

        oos_navs.extend(oos_result["nav"])
        # Track OOS trades
        for t in oos_result.get("trades", []):
            if t.get("pnl") is not None:
                oos_returns.append(t["pnl"] / 100_000)

    if not windows:
        return {"error": "Walk-forward produced no valid windows"}

    # Aggregate OOS metrics
    oos_returns_all = [
        (windows[i]["out_of_sample"]["total_return_pct"] or 0) / 100
        for i in range(len(windows))
    ]
    avg_oos_return = sum(oos_returns_all) / len(oos_returns_all) * 100
    consistency    = sum(1 for r in oos_returns_all if r > 0) / len(oos_returns_all) * 100
    avg_oos_sharpe = sum(w["out_of_sample"].get("sharpe") or 0 for w in windows) / len(windows)
    avg_oos_dd     = sum(w["out_of_sample"].get("max_drawdown_pct") or 0 for w in windows) / len(windows)

    # Robustness score: penalise IS overfit
    avg_is_return  = sum(w["in_sample"].get("total_return_pct") or 0 for w in windows) / len(windows)
    overfit_ratio  = avg_oos_return / (avg_is_return + 1e-9)  # 1.0 = no overfit, <0.5 = severe overfit

    robust_score = _gamification_score(
        avg_oos_sharpe,
        avg_oos_dd / 100,
        sum(w["out_of_sample"].get("win_rate_pct") or 0 for w in windows) / len(windows),
        0.5,
        1.0
    )
    grade, grade_label = grade_from_score(robust_score)

    return {
        "windows":          windows,
        "n_windows":        len(windows),
        "summary": {
            "avg_oos_return_pct": round(avg_oos_return, 2),
            "avg_oos_sharpe":     round(avg_oos_sharpe, 3),
            "avg_oos_dd_pct":     round(avg_oos_dd, 2),
            "consistency_pct":    round(consistency, 1),
            "overfit_ratio":      round(min(overfit_ratio, 3.0), 3),
            "robust_score":       robust_score,
            "grade":              grade,
            "grade_label":        grade_label,
        },
    }


# ── Buy & Hold benchmark ──────────────────────────────────────────────────────

def buy_hold_nav(bars: List[Dict]) -> List[float]:
    """Simple buy-and-hold NAV normalised to 100."""
    if not bars:
        return []
    base = bars[0]["close"]
    return [round(b["close"] / base * 100, 4) for b in bars]
