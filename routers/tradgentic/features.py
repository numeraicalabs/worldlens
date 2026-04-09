"""
tradgentic/features.py — Feature Engineering & Quantitative Signal Engine

Feature categories:
  1. TECHNICAL  — extended indicators (ATR, OBV, Stochastic, Williams %R, Ichimoku)
  2. REGIME     — market state detection (trend/range/volatile) via HMM-lite
  3. VOLATILITY — realised vol, vol-of-vol, vol regime
  4. MOMENTUM   — multi-timeframe momentum, rate-of-change, ADX
  5. CROSS-ASSET — VIX term structure, DXY, yield spread (free via yfinance)
  6. SENTIMENT  — WorldLens events sentiment, heat index
  7. POLYMARKET — prediction-market probabilities as exogenous features
  8. COMPOSITE  — weighted ensemble signal from all feature groups
"""
from __future__ import annotations
import math, time, logging, asyncio
from typing import List, Dict, Optional, Tuple, Any
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)


# ══════════════════════════════════════════════════════════════════════════════
# DATA STRUCTURES
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class FeatureSet:
    symbol:     str
    timestamp:  str
    price:      float
    features:   Dict[str, float]    = field(default_factory=dict)
    signals:    Dict[str, Any]      = field(default_factory=dict)
    regime:     str                  = "unknown"   # trend_up|trend_down|range|volatile
    composite:  float                = 0.0         # -1 (strong sell) to +1 (strong buy)
    confidence: float                = 0.0
    components: List[Dict]           = field(default_factory=list)


# ══════════════════════════════════════════════════════════════════════════════
# 1. EXTENDED TECHNICAL INDICATORS
# ══════════════════════════════════════════════════════════════════════════════

def atr_series(highs: List[float], lows: List[float],
               closes: List[float], n: int = 14) -> List[Optional[float]]:
    """Average True Range — volatility-adaptive indicator."""
    n_bars = len(closes)
    trs = [None]
    for i in range(1, n_bars):
        hl  = highs[i]  - lows[i]
        hcp = abs(highs[i]  - closes[i-1])
        lcp = abs(lows[i]   - closes[i-1])
        trs.append(max(hl, hcp, lcp))

    out = [None] * n_bars
    if len(trs) < n:
        return out
    # Wilder smoothing
    atr = sum(t for t in trs[1:n+1] if t is not None) / n
    out[n] = atr
    for i in range(n+1, n_bars):
        if trs[i] is not None:
            atr = (atr * (n-1) + trs[i]) / n
            out[i] = round(atr, 6)
    return out


def obv_series(closes: List[float], volumes: List[int]) -> List[float]:
    """On-Balance Volume — momentum/volume confirmation."""
    obv = [0.0]
    for i in range(1, len(closes)):
        v = volumes[i] if i < len(volumes) else 0
        if closes[i] > closes[i-1]:
            obv.append(obv[-1] + v)
        elif closes[i] < closes[i-1]:
            obv.append(obv[-1] - v)
        else:
            obv.append(obv[-1])
    return obv


def stochastic_series(highs: List[float], lows: List[float],
                       closes: List[float], k: int = 14, d: int = 3
                       ) -> Tuple[List[Optional[float]], List[Optional[float]]]:
    """Stochastic Oscillator %K and %D."""
    n = len(closes)
    pct_k = [None] * n
    for i in range(k-1, n):
        lo = min(lows[i-k+1:i+1])
        hi = max(highs[i-k+1:i+1])
        span = hi - lo
        pct_k[i] = round(((closes[i] - lo) / span * 100) if span > 0 else 50.0, 2)

    # %D = d-period SMA of %K
    pct_d = [None] * n
    for i in range(k+d-2, n):
        vals = [pct_k[j] for j in range(i-d+1, i+1) if pct_k[j] is not None]
        if len(vals) == d:
            pct_d[i] = round(sum(vals) / d, 2)
    return pct_k, pct_d


def williams_r(highs: List[float], lows: List[float],
               closes: List[float], n: int = 14) -> List[Optional[float]]:
    """Williams %R — overbought/oversold with faster response than RSI."""
    out = [None] * len(closes)
    for i in range(n-1, len(closes)):
        hi  = max(highs[i-n+1:i+1])
        lo  = min(lows[i-n+1:i+1])
        span = hi - lo
        out[i] = round(-100 * (hi - closes[i]) / span if span > 0 else -50.0, 2)
    return out


def adx_series(highs: List[float], lows: List[float],
               closes: List[float], n: int = 14
               ) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
    """ADX + DI+/DI- — trend strength (>25 = trending)."""
    nb  = len(closes)
    atr = atr_series(highs, lows, closes, n)
    dm_plus  = [0.0] * nb
    dm_minus = [0.0] * nb
    for i in range(1, nb):
        up   = highs[i]  - highs[i-1]
        down = lows[i-1] - lows[i]
        dm_plus[i]  = max(up,   0) if up   > down else 0
        dm_minus[i] = max(down, 0) if down > up   else 0

    def _smooth(series, n):
        out = [None] * nb
        s   = sum(series[1:n+1])
        out[n] = s
        for i in range(n+1, nb):
            s = s - s/n + series[i]
            out[i] = s
        return out

    sdm_p = _smooth(dm_plus, n)
    sdm_m = _smooth(dm_minus, n)
    di_p  = [None] * nb
    di_m  = [None] * nb
    dx    = [None] * nb
    for i in range(n, nb):
        if atr[i] and sdm_p[i] is not None:
            di_p[i] = round(100 * sdm_p[i] / atr[i], 2)
            di_m[i] = round(100 * sdm_m[i] / atr[i], 2)
            s = di_p[i] + di_m[i]
            dx[i]   = round(100 * abs(di_p[i] - di_m[i]) / s, 2) if s else 0

    # ADX = n-period SMA of DX
    adx = [None] * nb
    for i in range(2*n, nb):
        vals = [dx[j] for j in range(i-n+1, i+1) if dx[j] is not None]
        if vals:
            adx[i] = round(sum(vals) / len(vals), 2)
    return adx, di_p, di_m


def ichimoku_cloud(highs: List[float], lows: List[float], closes: List[float]
                   ) -> Dict[str, List[Optional[float]]]:
    """Ichimoku Cloud — multi-component trend/support/resistance system."""
    n = len(closes)
    tenkan   = [None] * n  # 9-period
    kijun    = [None] * n  # 26-period
    span_a   = [None] * n
    span_b   = [None] * n
    chikou   = [None] * n

    def _midpoint(h, l, p, i):
        if i < p: return None
        return round((max(h[i-p+1:i+1]) + min(l[i-p+1:i+1])) / 2, 4)

    for i in range(n):
        tenkan[i] = _midpoint(highs, lows, 9,  i)
        kijun[i]  = _midpoint(highs, lows, 26, i)
        if tenkan[i] and kijun[i]:
            span_a[i] = round((tenkan[i] + kijun[i]) / 2, 4)
        if i >= 52:
            span_b[i] = _midpoint(highs, lows, 52, i)
        if i + 26 < n:
            chikou[i + 26] = closes[i]

    return {
        "tenkan":  tenkan,
        "kijun":   kijun,
        "span_a":  span_a,
        "span_b":  span_b,
        "chikou":  chikou,
    }


def vwap_series(closes: List[float], highs: List[float],
                lows: List[float], volumes: List[int]) -> List[float]:
    """Session VWAP — institutional reference price."""
    vwap = []
    cum_tp_vol = 0.0
    cum_vol    = 0.0
    for i in range(len(closes)):
        tp  = (highs[i] + lows[i] + closes[i]) / 3
        v   = volumes[i] if i < len(volumes) else 1
        cum_tp_vol += tp * v
        cum_vol    += v
        vwap.append(round(cum_tp_vol / cum_vol if cum_vol else closes[i], 4))
    return vwap


def realised_vol(returns: List[float], window: int = 20) -> List[Optional[float]]:
    """Annualised realised volatility (rolling window)."""
    n   = len(returns)
    out = [None] * n
    for i in range(window-1, n):
        w   = returns[i-window+1:i+1]
        mu  = sum(w) / window
        var = sum((r - mu)**2 for r in w) / (window - 1)
        out[i] = round(math.sqrt(var * 252) * 100, 3)   # annualised %
    return out


# ══════════════════════════════════════════════════════════════════════════════
# 2. REGIME DETECTION (HMM-lite)
# ══════════════════════════════════════════════════════════════════════════════

def detect_regime(closes: List[float], rvol: List[Optional[float]]) -> str:
    """
    Lightweight regime classifier — no external ML library required.
    Uses price trend + volatility level.
    Returns: 'trend_up' | 'trend_down' | 'range' | 'volatile'
    """
    if len(closes) < 50:
        return "unknown"

    # Short/long SMA for trend
    short_ma = sum(closes[-20:]) / 20
    long_ma  = sum(closes[-50:]) / 50
    trend_strength = (short_ma - long_ma) / long_ma * 100   # %

    # Recent vol
    recent_vol = next((v for v in reversed(rvol) if v is not None), None)
    if recent_vol is None:
        recent_vol = 20.0

    # Historical vol (for comparison)
    valid_vols = [v for v in rvol if v is not None]
    hist_vol = sum(valid_vols) / len(valid_vols) if valid_vols else 20.0

    vol_ratio = recent_vol / (hist_vol + 1e-9)

    if vol_ratio > 1.5:
        return "volatile"
    if trend_strength > 1.5:
        return "trend_up"
    if trend_strength < -1.5:
        return "trend_down"
    return "range"


def regime_score(regime: str) -> float:
    """Map regime to baseline score bias."""
    return {"trend_up": 0.3, "trend_down": -0.3, "range": 0.0, "volatile": -0.1,
            "unknown": 0.0}.get(regime, 0.0)


# ══════════════════════════════════════════════════════════════════════════════
# 3. CROSS-ASSET FEATURE BUILDER
# ══════════════════════════════════════════════════════════════════════════════

async def fetch_cross_asset() -> Dict[str, float]:
    """
    Fetch cross-asset features: VIX, DXY, ^TNX (10Y yield).
    All free via yfinance. Falls back to neutral values.
    """
    symbols = {
        "^VIX":  "vix",
        "DX-Y.NYB": "dxy",
        "^TNX":  "yield_10y",
        "GC=F":  "gold",
    }
    features = {}
    try:
        import yfinance as yf
        tickers = yf.Tickers(" ".join(symbols.keys()))
        for sym, key in symbols.items():
            try:
                info  = tickers.tickers[sym].fast_info
                price = float(getattr(info, "last_price", None) or 0)
                prev  = float(getattr(info, "previous_close", None) or price)
                chg   = (price / prev - 1) * 100 if prev else 0
                features[key]         = round(price, 3)
                features[key + "_chg"] = round(chg, 3)
            except Exception:
                pass
    except Exception as e:
        logger.debug("cross_asset fetch error: %s", e)

    # Derived features
    vix = features.get("vix", 18.0)
    features.setdefault("vix", vix)
    features["vix_regime"] = 1.0 if vix > 30 else (0.5 if vix > 20 else 0.0)
    features["fear_greed"] = max(0.0, min(1.0, 1.0 - (vix - 10) / 40))

    dxy_chg = features.get("dxy_chg", 0.0)
    features["dollar_strong"] = 1.0 if dxy_chg > 0.3 else (0.0 if dxy_chg < -0.3 else 0.5)

    return features


# ══════════════════════════════════════════════════════════════════════════════
# 4. WORLDLENS SENTIMENT FEATURES
# ══════════════════════════════════════════════════════════════════════════════

async def fetch_sentiment_features(symbol: str) -> Dict[str, float]:
    """
    Pull sentiment from WorldLens events DB for the symbol's sector/market.
    Maps event sentiment to quantitative features.
    """
    features = {
        "news_sentiment":    0.0,
        "heat_index":        5.0,
        "critical_events":   0.0,
        "sentiment_momentum": 0.0,
    }
    try:
        import aiosqlite
        from config import settings

        # Map symbol to category/country filters
        category_map = {
            "BTC-USD": "TECHNOLOGY", "ETH-USD": "TECHNOLOGY",
            "GC=F": "ECONOMICS",  "CL=F": "ENERGY",
            "^VIX": "ECONOMICS",  "SPY": "ECONOMICS",
            "QQQ": "TECHNOLOGY",
        }
        cat = category_map.get(symbol.upper(), "ECONOMICS")

        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            # Last 48h events sentiment
            async with db.execute(
                "SELECT AVG(sentiment_score) as avg_sent, AVG(heat_index) as avg_heat, "
                "COUNT(*) as n, SUM(CASE WHEN impact='High' THEN 1 ELSE 0 END) as critical "
                "FROM events WHERE category=? AND "
                "datetime(timestamp) > datetime('now','-48 hours')",
                (cat,)
            ) as c:
                row = await c.fetchone()
                if row and row["n"]:
                    features["news_sentiment"]  = round(float(row["avg_sent"] or 0), 3)
                    features["heat_index"]       = round(float(row["avg_heat"] or 5), 3)
                    features["critical_events"]  = int(row["critical"] or 0) / max(int(row["n"]),1)

            # Sentiment momentum: compare last 24h vs prior 24h
            async with db.execute(
                "SELECT AVG(CASE WHEN datetime(timestamp) > datetime('now','-24 hours') "
                "       THEN sentiment_score END) as recent, "
                "AVG(CASE WHEN datetime(timestamp) BETWEEN datetime('now','-48 hours') "
                "         AND datetime('now','-24 hours') THEN sentiment_score END) as prior "
                "FROM events WHERE category=?", (cat,)
            ) as c:
                row = await c.fetchone()
                if row:
                    recent = float(row["recent"] or 0)
                    prior  = float(row["prior"]  or 0)
                    features["sentiment_momentum"] = round(recent - prior, 3)

    except Exception as e:
        logger.debug("sentiment_features error %s: %s", symbol, e)

    return features


# ══════════════════════════════════════════════════════════════════════════════
# 5. MULTI-TIMEFRAME MOMENTUM
# ══════════════════════════════════════════════════════════════════════════════

def mtf_momentum(closes: List[float]) -> Dict[str, float]:
    """
    Multi-timeframe momentum: 5, 10, 20, 60 bar rate-of-change.
    A core quant feature — captures momentum across different horizons.
    """
    n = len(closes)
    feats = {}
    for tf in [5, 10, 20, 60]:
        if n > tf:
            roc = (closes[-1] / closes[-tf-1] - 1) * 100
            feats[f"mom_{tf}"] = round(roc, 3)
        else:
            feats[f"mom_{tf}"] = 0.0

    # Momentum score: weighted combination (shorter = more recent)
    weights = {5: 0.4, 10: 0.3, 20: 0.2, 60: 0.1}
    score   = sum(feats[f"mom_{tf}"] * w for tf, w in weights.items())
    feats["momentum_score"] = round(score, 3)

    # Momentum trend alignment (all timeframes same sign = strong)
    signs = [feats[f"mom_{tf}"] for tf in [5, 10, 20]]
    feats["momentum_aligned"] = 1.0 if all(s > 0 for s in signs) \
                                else (-1.0 if all(s < 0 for s in signs) else 0.0)
    return feats


# ══════════════════════════════════════════════════════════════════════════════
# 6. COMPOSITE SIGNAL BUILDER
# ══════════════════════════════════════════════════════════════════════════════

FEATURE_WEIGHTS = {
    "technical":   0.30,
    "regime":      0.15,
    "momentum":    0.20,
    "cross_asset": 0.15,
    "sentiment":   0.10,
    "polymarket":  0.10,
}


def build_technical_score(
    closes: List[float],
    highs:  List[float],
    lows:   List[float],
    vols:   List[int],
) -> Tuple[float, Dict]:
    """
    Compute a composite technical score (-1 to +1) from all indicators.
    Returns (score, feature_dict).
    """
    n      = len(closes)
    feats  = {}
    scores = []

    # ── RSI
    rsi_s = _rsi_series_local(closes, 14)
    rsi   = next((v for v in reversed(rsi_s) if v is not None), None)
    if rsi is not None:
        feats["rsi"] = rsi
        if rsi < 30:
            scores.append(("rsi_oversold", 0.8))
        elif rsi < 45:
            scores.append(("rsi_lean_buy", 0.3))
        elif rsi > 70:
            scores.append(("rsi_overbought", -0.8))
        elif rsi > 55:
            scores.append(("rsi_lean_sell", -0.3))
        else:
            scores.append(("rsi_neutral", 0.0))

    # ── EMA crossover
    ema9  = _ema_last(closes, 9)
    ema21 = _ema_last(closes, 21)
    ema50 = _ema_last(closes, 50)
    if ema9 and ema21:
        feats["ema9"]  = round(ema9,  4)
        feats["ema21"] = round(ema21, 4)
        cross_score = 0.6 if ema9 > ema21 else -0.6
        if ema50:
            feats["ema50"] = round(ema50, 4)
            # Golden cross: both short EMAs above long EMA
            if ema9 > ema21 > ema50:
                cross_score = 0.9
            elif ema9 < ema21 < ema50:
                cross_score = -0.9
        scores.append(("ema_cross", cross_score))

    # ── Bollinger
    if n >= 20:
        w   = closes[-20:]
        mid = sum(w) / 20
        std = math.sqrt(sum((p-mid)**2 for p in w) / 20)
        lo  = mid - 2*std
        hi  = mid + 2*std
        p   = closes[-1]
        feats["bb_pct"] = round((p - lo) / (hi - lo) * 100 if (hi-lo) else 50, 1)
        feats["bb_width"] = round((hi - lo) / mid * 100, 2)
        if p <= lo:
            scores.append(("bb_lower", 0.7))
        elif p >= hi:
            scores.append(("bb_upper", -0.7))
        else:
            scores.append(("bb_mid", (feats["bb_pct"] - 50) / 50 * (-0.3)))

    # ── ATR (volatility regime)
    atr_s = atr_series(highs, lows, closes, 14)
    atr   = next((v for v in reversed(atr_s) if v is not None), None)
    if atr and closes[-1]:
        feats["atr_pct"] = round(atr / closes[-1] * 100, 3)

    # ── Stochastic
    stk, std_s = stochastic_series(highs, lows, closes)
    stk_val = next((v for v in reversed(stk)   if v is not None), None)
    std_val = next((v for v in reversed(std_s) if v is not None), None)
    if stk_val is not None:
        feats["stoch_k"] = stk_val
        if stk_val < 20:
            scores.append(("stoch_os", 0.5))
        elif stk_val > 80:
            scores.append(("stoch_ob", -0.5))
        else:
            scores.append(("stoch_mid", 0.0))

    # ── ADX trend strength
    adx_s, dip, dim = adx_series(highs, lows, closes)
    adx_val = next((v for v in reversed(adx_s) if v is not None), None)
    dip_val = next((v for v in reversed(dip)   if v is not None), None)
    dim_val = next((v for v in reversed(dim)   if v is not None), None)
    if adx_val is not None:
        feats["adx"]  = adx_val
        feats["di_p"] = dip_val or 0
        feats["di_m"] = dim_val or 0
        if adx_val > 25:  # trending market
            trend_dir = 0.4 if (dip_val or 0) > (dim_val or 0) else -0.4
            scores.append(("adx_trend", trend_dir * (adx_val / 50)))

    # ── Williams %R
    wr_s  = williams_r(highs, lows, closes)
    wr    = next((v for v in reversed(wr_s) if v is not None), None)
    if wr is not None:
        feats["williams_r"] = wr
        scores.append(("williams", -wr / 100))   # -100=OB → +1; 0=OS → -1 mapped

    # ── OBV trend
    if vols:
        obv_s  = obv_series(closes, vols)
        if len(obv_s) >= 20:
            obv_trend = (obv_s[-1] - obv_s[-20]) / (abs(obv_s[-20]) + 1)
            feats["obv_trend"] = round(obv_trend, 4)
            scores.append(("obv", max(-1, min(1, obv_trend * 5))))

    # Composite: weighted average
    if not scores:
        return 0.0, feats

    total_score = sum(s[1] for s in scores) / len(scores)
    feats["_scores"] = {k: round(v,3) for k,v in scores}
    return round(max(-1.0, min(1.0, total_score)), 4), feats


def _rsi_series_local(closes: List[float], n: int) -> List[Optional[float]]:
    out = [None] * len(closes)
    if len(closes) < n + 1: return out
    deltas = [closes[i]-closes[i-1] for i in range(1, len(closes))]
    for i in range(n, len(closes)):
        gains  = sum(max(d,0) for d in deltas[i-n:i]) / n
        losses = sum(abs(min(d,0)) for d in deltas[i-n:i]) / n
        out[i] = round(100 - 100/(1 + gains/(losses+1e-9)), 2)
    return out

def _ema_last(closes: List[float], n: int) -> Optional[float]:
    if len(closes) < n: return None
    k = 2/(n+1)
    ema = closes[-n]
    for p in closes[-n+1:]:
        ema = p*k + ema*(1-k)
    return round(ema, 4)


# ══════════════════════════════════════════════════════════════════════════════
# 7. MAIN FEATURE ENGINE — build full FeatureSet for a symbol
# ══════════════════════════════════════════════════════════════════════════════

async def compute_feature_set(
    symbol:  str,
    bars:    List[Dict],
    poly_features:  Dict[str, float] = None,
    cross_features: Dict[str, float] = None,
) -> FeatureSet:
    """
    Full feature engineering pipeline for one symbol.
    Returns FeatureSet with composite score and individual components.
    """
    from datetime import datetime

    if not bars or len(bars) < 30:
        return FeatureSet(symbol=symbol, timestamp=datetime.utcnow().isoformat(),
                          price=0.0, regime="unknown", composite=0.0, confidence=0.0)

    closes  = [b["close"]  for b in bars]
    highs   = [b["high"]   for b in bars]
    lows    = [b["low"]    for b in bars]
    volumes = [b.get("volume", 0) for b in bars]
    price   = closes[-1]

    # Simple returns
    returns = [(closes[i]/closes[i-1]-1) for i in range(1, len(closes))]

    # ── 1. Technical score
    tech_score, tech_feats = build_technical_score(closes, highs, lows, volumes)

    # ── 2. Regime
    rv = realised_vol(returns, 20)
    regime = detect_regime(closes, rv)
    recent_vol = next((v for v in reversed(rv) if v is not None), 20.0)

    # ── 3. Multi-timeframe momentum
    mtf = mtf_momentum(closes)

    # ── 4. Cross-asset (use provided or fetch)
    ca_feats = cross_features or {}
    vix      = ca_feats.get("vix", 18.0)
    fear_g   = ca_feats.get("fear_greed", 0.5)
    # Cross-asset contribution to score
    ca_score = (fear_g - 0.5) * 2 * 0.6   # -0.6 → +0.6

    # ── 5. Sentiment
    sent_feats = await fetch_sentiment_features(symbol)
    sent_score = sent_feats.get("news_sentiment", 0.0) * 0.5 \
               + sent_feats.get("sentiment_momentum", 0.0) * 0.3 \
               - sent_feats.get("critical_events", 0.0) * 0.4

    # ── 6. Polymarket
    poly = poly_features or {}
    poly_score = 0.0
    if poly:
        # e.g. poly_crypto_avg high → bullish for BTC
        if "BTC" in symbol.upper() or "ETH" in symbol.upper():
            poly_score = (poly.get("poly_crypto_avg", 0.5) - 0.5) * 2
        else:
            poly_score = (poly.get("poly_macro_avg", 0.5) - 0.5) * 1.5

    # ── 7. Momentum score
    mom_score = max(-1.0, min(1.0, mtf["momentum_score"] / 10))

    # ── Composite: weighted sum
    raw_composite = (
        tech_score  * FEATURE_WEIGHTS["technical"]  +
        regime_score(regime) * FEATURE_WEIGHTS["regime"] +
        mom_score   * FEATURE_WEIGHTS["momentum"]   +
        ca_score    * FEATURE_WEIGHTS["cross_asset"] +
        sent_score  * FEATURE_WEIGHTS["sentiment"]  +
        poly_score  * FEATURE_WEIGHTS["polymarket"]
    )
    composite = round(max(-1.0, min(1.0, raw_composite)), 4)

    # Confidence: based on indicator agreement and data quality
    confidence = round(min(1.0, len(bars) / 200 * 0.4
                           + abs(tech_score) * 0.3
                           + abs(mom_score)  * 0.3), 3)

    # Components breakdown for UI
    components = [
        {"name": "Technical",    "score": tech_score,  "weight": FEATURE_WEIGHTS["technical"],
         "contribution": round(tech_score * FEATURE_WEIGHTS["technical"], 4)},
        {"name": "Regime",       "score": round(regime_score(regime), 3), "weight": FEATURE_WEIGHTS["regime"],
         "contribution": round(regime_score(regime) * FEATURE_WEIGHTS["regime"], 4),
         "regime": regime},
        {"name": "Momentum",     "score": round(mom_score, 3), "weight": FEATURE_WEIGHTS["momentum"],
         "contribution": round(mom_score * FEATURE_WEIGHTS["momentum"], 4),
         "details": mtf},
        {"name": "Cross-Asset",  "score": round(ca_score, 3),   "weight": FEATURE_WEIGHTS["cross_asset"],
         "contribution": round(ca_score * FEATURE_WEIGHTS["cross_asset"], 4),
         "vix": vix, "fear_greed": round(fear_g, 3)},
        {"name": "Sentiment",    "score": round(sent_score, 3), "weight": FEATURE_WEIGHTS["sentiment"],
         "contribution": round(sent_score * FEATURE_WEIGHTS["sentiment"], 4),
         "details": sent_feats},
        {"name": "Polymarket",   "score": round(poly_score, 3), "weight": FEATURE_WEIGHTS["polymarket"],
         "contribution": round(poly_score * FEATURE_WEIGHTS["polymarket"], 4)},
    ]

    all_features = {
        **tech_feats,
        **mtf,
        **ca_feats,
        **sent_feats,
        "realised_vol": round(recent_vol, 3),
        "regime":       regime,
    }
    # Remove internal debug key
    all_features.pop("_scores", None)

    return FeatureSet(
        symbol     = symbol,
        timestamp  = datetime.utcnow().isoformat(),
        price      = price,
        features   = all_features,
        regime     = regime,
        composite  = composite,
        confidence = confidence,
        components = components,
    )


def action_from_composite(composite: float, threshold: float = 0.15) -> str:
    if composite >  threshold: return "BUY"
    if composite < -threshold: return "SELL"
    return "HOLD"
