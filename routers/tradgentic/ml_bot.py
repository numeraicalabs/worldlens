"""
tradgentic/ml_bot.py
─────────────────────────────────────────────────────────────────
Sprint B: ML Bot Strategies

B1 — GradientBoostingClassifier (sklearn, no GPU, ~8MB RAM)
     Trains on historical OHLCV + feature engineering
     Predicts: price_up > 0.5% in next N bars

B3 — Ensemble Bot (XGB rule + MACD + RSI majority vote)
     Most robust in production — 3-way vote with confidence

B4 — Sentiment-Driven Bot (WorldLens events as signal)
     Uses tg_signal_log + events DB features

All models:
  - Train async (FastAPI BackgroundTasks)
  - Stored as base64-pickled sklearn model in tg_bots.params (model_b64)
  - Inference: <5ms on CPU
  - Fallback to rule-based when model unavailable
  - Every signal written to tg_signal_log for future retraining
"""
from __future__ import annotations
import json, math, logging, base64, pickle, time
from typing import List, Dict, Optional, Tuple, Any
from datetime import datetime

logger = logging.getLogger(__name__)

# ── Lazy sklearn import ──────────────────────────────────────
_sklearn_ok = False
try:
    from sklearn.ensemble import GradientBoostingClassifier, VotingClassifier
    from sklearn.preprocessing import StandardScaler
    from sklearn.pipeline import Pipeline
    from sklearn.model_selection import cross_val_score
    import numpy as np
    _sklearn_ok = True
except ImportError:
    logger.warning("scikit-learn unavailable — ML bots will use rule fallback")
    np = None


# ─────────────────────────────────────────────────────────────
# FEATURE MATRIX BUILDER
# ─────────────────────────────────────────────────────────────

def build_feature_matrix(bars: List[Dict]) -> Tuple[List[List[float]], List[int], List[str]]:
    """
    Convert OHLCV bars into (X, y, feature_names) for sklearn.

    X: feature matrix — one row per bar (from bar 60 onward)
    y: binary label — 1 if close[t+5] / close[t] > 1.005 else 0
       (price up > 0.5% in next 5 bars)
    feature_names: column names for interpretability
    """
    if not _sklearn_ok or len(bars) < 80:
        return [], [], []

    from routers.tradgentic.features import (
        _rsi_series_local, atr_series, obv_series,
        stochastic_series, adx_series, realised_vol,
    )
    from routers.tradgentic.backtest import (
        _sma_series, _ema_series, _macd_series,
    )

    closes  = [b["close"]  for b in bars]
    highs   = [b["high"]   for b in bars]
    lows    = [b["low"]    for b in bars]
    volumes = [b.get("volume", 0) for b in bars]
    n       = len(closes)

    # Pre-compute all indicator series
    rsi14   = _rsi_series_local(closes, 14)
    rsi7    = _rsi_series_local(closes, 7)
    ema9    = _ema_series(closes, 9)
    ema21   = _ema_series(closes, 21)
    ema50   = _ema_series(closes, 50)
    sma20   = _sma_series(closes, 20)
    atr14   = atr_series(highs, lows, closes, 14)
    stk_k, stk_d = stochastic_series(highs, lows, closes, 14, 3)
    adx_s, di_p, di_m = adx_series(highs, lows, closes, 14)
    macd_line, sig_line, hist_s = _macd_series(closes)
    returns = [(closes[i]/closes[i-1]-1) for i in range(1, n)] + [0.0]
    rvol    = realised_vol(returns[:-1], 20)
    obv_s   = obv_series(closes, volumes)

    # Bollinger %B
    bb_pct_s = [None] * n
    for i in range(20, n):
        w   = closes[i-20:i]
        mid = sum(w)/20
        std = math.sqrt(sum((p-mid)**2 for p in w)/20)
        if std > 0:
            bb_pct_s[i] = (closes[i] - (mid - 2*std)) / (4*std)

    feature_names = [
        "rsi14", "rsi7",
        "ema_diff_9_21",    # EMA9 vs EMA21 spread (% of price)
        "ema_diff_21_50",   # EMA21 vs EMA50 spread
        "price_vs_sma20",   # price above/below SMA20
        "atr_pct",          # ATR as % of price
        "stoch_k", "stoch_d",
        "adx", "di_diff",   # DI+ - DI-
        "macd_hist",        # MACD histogram
        "macd_hist_change", # change in histogram
        "rvol",             # realised volatility
        "bb_pct",           # Bollinger %B (0=lower band, 1=upper band)
        "obv_trend",        # OBV 10-bar rate of change
        "mom5", "mom10", "mom20",
        "vol_ratio",        # volume vs 20-bar avg
    ]

    X, y = [], []
    FUTURE_BARS = 5
    THRESHOLD   = 0.005  # 0.5% up

    for i in range(60, n - FUTURE_BARS):
        c = closes[i]
        if c <= 0:
            continue

        def _safe(s, default=0.0):
            v = s[i] if i < len(s) else None
            return float(v) if v is not None else default

        def _safe_prev(s, default=0.0):
            v = s[i-1] if i-1 >= 0 and i-1 < len(s) else None
            return float(v) if v is not None else default

        # Momentum N-bars ago
        mom5  = (c/closes[i-5]  - 1)*100 if i>=5  else 0.0
        mom10 = (c/closes[i-10] - 1)*100 if i>=10 else 0.0
        mom20 = (c/closes[i-20] - 1)*100 if i>=20 else 0.0

        # Volume ratio
        avg_vol = sum(volumes[max(0,i-20):i]) / 20 if volumes else 1
        vol_r   = volumes[i] / (avg_vol + 1e-9) if volumes else 1.0

        row = [
            _safe(rsi14, 50.0),
            _safe(rsi7,  50.0),
            (((_safe(ema9) - _safe(ema21)) / c * 100) if _safe(ema9) and _safe(ema21) else 0.0),
            (((_safe(ema21) - _safe(ema50)) / c * 100) if _safe(ema21) and _safe(ema50) else 0.0),
            ((_safe(sma20) and (c - _safe(sma20)) / _safe(sma20) * 100) or 0.0),
            ((_safe(atr14) / c * 100) if _safe(atr14) else 1.0),
            _safe(stk_k, 50.0),
            _safe(stk_d, 50.0),
            _safe(adx_s, 20.0),
            (_safe(di_p) - _safe(di_m)),
            _safe(hist_s, 0.0),
            (_safe(hist_s) - _safe_prev(hist_s)),
            _safe(rvol, 15.0),
            _safe(bb_pct_s, 0.5),
            ((obv_s[i] - obv_s[max(0,i-10)]) / (abs(obv_s[max(0,i-10)]) + 1e-9)) if obv_s else 0.0,
            mom5, mom10, mom20,
            min(vol_r, 5.0),
        ]

        # Sanity check — no NaN/Inf
        if any(not math.isfinite(v) for v in row):
            row = [0.0 if not math.isfinite(v) else v for v in row]

        X.append(row)

        # Label: price up > 0.5% in next 5 bars?
        future_return = closes[i + FUTURE_BARS] / c - 1
        y.append(1 if future_return > THRESHOLD else 0)

    return X, y, feature_names


# ─────────────────────────────────────────────────────────────
# B1 — GRADIENT BOOSTING BOT
# ─────────────────────────────────────────────────────────────

def train_gb_model(bars: List[Dict]) -> Optional[Dict]:
    """
    Train GradientBoostingClassifier on OHLCV bars.
    Returns model dict with: model_b64, metrics, feature_importances.
    Returns None if sklearn unavailable or insufficient data.
    """
    if not _sklearn_ok:
        return None

    X, y, feat_names = build_feature_matrix(bars)
    if len(X) < 80:
        logger.debug("train_gb: only %d training rows — need 80+", len(X))
        return None

    X_arr = np.array(X, dtype=np.float32)
    y_arr = np.array(y, dtype=np.int32)

    # Split: last 20% as validation
    split   = int(len(X_arr) * 0.80)
    X_tr, X_val = X_arr[:split], X_arr[split:]
    y_tr, y_val = y_arr[:split], y_arr[split:]

    clf = Pipeline([
        ("scaler", StandardScaler()),
        ("gb", GradientBoostingClassifier(
            n_estimators   = 80,
            max_depth      = 4,
            learning_rate  = 0.08,
            subsample      = 0.8,
            min_samples_leaf = 10,
            random_state   = 42,
        ))
    ])

    try:
        clf.fit(X_tr, y_tr)
    except Exception as e:
        logger.warning("train_gb fit error: %s", e)
        return None

    val_acc = float(clf.score(X_val, y_val))
    # Baseline: always predict majority class
    baseline = max(y_val.mean(), 1 - y_val.mean())
    edge     = round(val_acc - baseline, 4)

    # Feature importances from GB step
    feat_imp = {}
    try:
        gb_step = clf.named_steps["gb"]
        for name, imp in zip(feat_names, gb_step.feature_importances_):
            feat_imp[name] = round(float(imp), 4)
    except Exception:
        pass

    model_b64 = base64.b64encode(pickle.dumps(clf)).decode("utf-8")

    return {
        "model_b64":    model_b64,
        "algorithm":    "GradientBoosting",
        "val_accuracy": round(val_acc, 4),
        "baseline":     round(baseline, 4),
        "edge":         edge,
        "n_train":      len(X_tr),
        "n_val":        len(X_val),
        "feature_importances": dict(sorted(feat_imp.items(), key=lambda x: -x[1])[:10]),
        "trained_at":   datetime.utcnow().isoformat(),
    }


def gb_signal(model_b64: str, bars: List[Dict]) -> Optional[Dict]:
    """
    Run inference on the last bar using a trained GradientBoosting model.
    Returns signal dict or None.
    """
    if not _sklearn_ok or not model_b64 or len(bars) < 65:
        return None
    try:
        clf = pickle.loads(base64.b64decode(model_b64))
        X, _, _ = build_feature_matrix(bars)
        if not X:
            return None
        last_row = np.array([X[-1]], dtype=np.float32)
        prob_up  = float(clf.predict_proba(last_row)[0][1])
        price    = bars[-1]["close"]

        if prob_up >= 0.62:
            action = "BUY"
            strength = min(1.0, (prob_up - 0.50) * 5)
        elif prob_up <= 0.38:
            action = "SELL"
            strength = min(1.0, (0.50 - prob_up) * 5)
        else:
            action = "HOLD"
            strength = 0.3

        return {
            "action":   action,
            "strength": round(strength, 3),
            "prob_up":  round(prob_up, 3),
            "price":    price,
            "reason":   f"ML(GB): P(up)={prob_up:.1%} — {'bullish edge' if action=='BUY' else 'bearish edge' if action=='SELL' else 'no clear edge'}",
            "source":   "ml_xgb",
        }
    except Exception as e:
        logger.debug("gb_signal inference error: %s", e)
        return None


# ─────────────────────────────────────────────────────────────
# B3 — ENSEMBLE BOT (ML + MACD + RSI majority vote)
# ─────────────────────────────────────────────────────────────

def ensemble_signal(
    model_b64:  Optional[str],
    bars:       List[Dict],
    params:     Dict,
) -> Dict:
    """
    3-way vote: GradientBoosting + MACD + RSI.
    Confidence determined by agreement level.
    Falls back gracefully when ML model missing.
    """
    price = bars[-1]["close"] if bars else 0.0
    votes = {}

    # ── Vote 1: ML model
    if model_b64:
        ml_sig = gb_signal(model_b64, bars)
        if ml_sig and ml_sig["action"] != "HOLD":
            votes["ml"] = (ml_sig["action"], ml_sig["strength"], ml_sig["reason"])

    # ── Vote 2: MACD
    from routers.tradgentic.backtest import _macd_series
    closes = [b["close"] for b in bars]
    macd_l, sig_l, hist_s = _macd_series(closes)
    n = len(hist_s)
    if n >= 2:
        cur_h  = hist_s[n-1]
        prev_h = hist_s[n-2]
        min_h  = float(params.get("min_hist", 0.05))
        if cur_h is not None and prev_h is not None:
            if prev_h <= 0 and cur_h > min_h:
                votes["macd"] = ("BUY",  0.7, f"MACD hist flipped positive ({cur_h:.4f})")
            elif prev_h >= 0 and cur_h < -min_h:
                votes["macd"] = ("SELL", 0.7, f"MACD hist flipped negative ({cur_h:.4f})")

    # ── Vote 3: RSI
    from routers.tradgentic.features import _rsi_series_local
    rsi_s  = _rsi_series_local(closes, 14)
    rsi    = next((v for v in reversed(rsi_s) if v is not None), None)
    ov, ob = int(params.get("oversold", 30)), int(params.get("overbought", 70))
    if rsi is not None:
        if rsi <= ov:
            votes["rsi"] = ("BUY",  min(1.0, (ov-rsi)/ov * 2), f"RSI={rsi:.1f} oversold")
        elif rsi >= ob:
            votes["rsi"] = ("SELL", min(1.0, (rsi-ob)/(100-ob) * 2), f"RSI={rsi:.1f} overbought")

    if not votes:
        return {"action": "HOLD", "strength": 0.2, "price": price,
                "reason": "No signals — all 3 components neutral",
                "source": "ml_ensemble", "vote_count": 0, "votes": {}}

    # Tally
    buy_w  = sum(v[1] for v in votes.values() if v[0] == "BUY")
    sell_w = sum(v[1] for v in votes.values() if v[0] == "SELL")
    total  = len(votes)

    if buy_w > sell_w and buy_w / total >= 0.5:
        action   = "BUY"
        strength = round(min(1.0, buy_w / total), 3)
        reasons  = [v[2] for v in votes.values() if v[0] == "BUY"]
    elif sell_w > buy_w and sell_w / total >= 0.5:
        action   = "SELL"
        strength = round(min(1.0, sell_w / total), 3)
        reasons  = [v[2] for v in votes.values() if v[0] == "SELL"]
    else:
        action   = "HOLD"
        strength = 0.2
        reasons  = ["Conflicting signals — holding"]

    # Bonus confidence when all 3 agree
    if len([v for v in votes.values() if v[0] == action]) == 3:
        strength = min(1.0, strength * 1.25)

    return {
        "action":     action,
        "strength":   strength,
        "price":      price,
        "reason":     " · ".join(reasons[:3]),
        "source":     "ml_ensemble",
        "vote_count": total,
        "votes":      {k: {"action": v[0], "strength": v[1]} for k, v in votes.items()},
    }


# ─────────────────────────────────────────────────────────────
# B4 — SENTIMENT-DRIVEN BOT
# ─────────────────────────────────────────────────────────────

async def sentiment_signal(symbol: str, bars: List[Dict], params: Dict) -> Dict:
    """
    Signal driven by WorldLens events sentiment + cross-asset context.
    Uses the live events DB and Polymarket features already in features.py.
    Falls back to RSI when sentiment data is sparse.
    """
    from routers.tradgentic.features import (
        fetch_sentiment_features, fetch_cross_asset, _rsi_series_local
    )

    price  = bars[-1]["close"] if bars else 0.0
    closes = [b["close"] for b in bars]

    # Fetch sentiment and cross-asset in parallel
    try:
        import asyncio
        sent_task = fetch_sentiment_features(symbol)
        ca_task   = fetch_cross_asset()
        sent_f, ca_f = await asyncio.gather(sent_task, ca_task, return_exceptions=True)
        if isinstance(sent_f, Exception): sent_f = {}
        if isinstance(ca_f,  Exception): ca_f  = {}
    except Exception:
        sent_f, ca_f = {}, {}

    score   = 0.0
    reasons = []

    # ── Sentiment score contribution
    news_sent = float(sent_f.get("news_sentiment", 0.0))
    heat_idx  = float(sent_f.get("heat_index", 5.0))
    crit_ev   = float(sent_f.get("critical_events", 0.0))
    sent_mom  = float(sent_f.get("sentiment_momentum", 0.0))

    if abs(news_sent) > 0.1:
        score += news_sent * 0.5
        reasons.append(f"News sentiment: {'+' if news_sent > 0 else ''}{news_sent:.2f}")

    if sent_mom > 0.1:
        score += 0.2
        reasons.append("Improving news sentiment momentum")
    elif sent_mom < -0.1:
        score -= 0.2
        reasons.append("Deteriorating news sentiment")

    if crit_ev > 0.3:
        score -= crit_ev * 0.4
        reasons.append(f"{int(crit_ev*100)}% critical events — caution")

    # ── Cross-asset contribution
    vix    = float(ca_f.get("vix", 18.0))
    dxy_ch = float(ca_f.get("dxy_chg", 0.0))

    if vix > 30:
        score -= 0.3
        reasons.append(f"VIX={vix:.0f} — high fear, risk-off")
    elif vix < 15:
        score += 0.15
        reasons.append(f"VIX={vix:.0f} — low fear")

    if "BTC" in symbol.upper() or "ETH" in symbol.upper():
        # Crypto: strong dollar = negative
        if dxy_ch > 0.5:
            score -= 0.2
            reasons.append("Strong USD headwind for crypto")

    # ── RSI fallback filter — don't fight extreme technicals
    rsi_s = _rsi_series_local(closes, 14)
    rsi   = next((v for v in reversed(rsi_s) if v is not None), None)
    ov, ob = int(params.get("oversold", 30)), int(params.get("overbought", 70))
    if rsi is not None:
        if rsi < ov and score > 0:
            score += 0.2
            reasons.append(f"RSI={rsi:.0f} confirms oversold")
        elif rsi > ob and score < 0:
            score -= 0.2
            reasons.append(f"RSI={rsi:.0f} confirms overbought")
        elif rsi < ov and score <= 0:
            score = max(0.0, score)  # don't sell into extreme oversold
        elif rsi > ob and score >= 0:
            score = min(0.0, score)  # don't buy into extreme overbought

    # Map to action
    threshold = float(params.get("threshold", 0.20))
    if score > threshold:
        action   = "BUY"
        strength = round(min(1.0, score * 2), 3)
    elif score < -threshold:
        action   = "SELL"
        strength = round(min(1.0, abs(score) * 2), 3)
    else:
        action   = "HOLD"
        strength = 0.2

    return {
        "action":   action,
        "strength": strength,
        "price":    price,
        "reason":   " · ".join(reasons[:4]) if reasons else "Neutral sentiment environment",
        "source":   "ml_sentiment",
        "raw_score": round(score, 3),
        "vix":      vix,
        "news_sentiment": news_sent,
    }


# ─────────────────────────────────────────────────────────────
# REGISTRY — maps strategy_id to signal function
# ─────────────────────────────────────────────────────────────

ML_STRATEGY_IDS = {"ml_xgb", "ml_ensemble", "ml_sentiment"}

ML_STRATEGY_META = {
    "ml_xgb": {
        "id":          "ml_xgb",
        "name":        "🧠 ML Gradient Boost",
        "description": "Trained on 19 technical features. Predicts price up >0.5% in 5 bars. Adapts to each asset's historical patterns.",
        "needs_training": True,
        "params_schema": {
            "stop_pct": {"type":"float","default":2.5,"min":0.5,"max":10,"label":"Stop Loss %"},
        },
    },
    "ml_ensemble": {
        "id":          "ml_ensemble",
        "name":        "⚡ ML Ensemble",
        "description": "3-way vote: ML model + MACD + RSI. Requires all 3 to agree for high-confidence signals. Most robust strategy.",
        "needs_training": True,
        "params_schema": {
            "min_hist":  {"type":"float","default":0.05,"min":0.0,"max":1.0,"label":"MACD min histogram"},
            "oversold":  {"type":"int",  "default":32,  "min":20, "max":45, "label":"RSI oversold"},
            "overbought":{"type":"int",  "default":68,  "min":55, "max":80, "label":"RSI overbought"},
            "stop_pct":  {"type":"float","default":2.5, "min":0.5,"max":10, "label":"Stop Loss %"},
        },
    },
    "ml_sentiment": {
        "id":          "ml_sentiment",
        "name":        "📰 News Sentiment",
        "description": "Combines WorldLens events sentiment, VIX, and RSI filter. Unique to WorldLens — uses your live geopolitical intelligence data.",
        "needs_training": False,
        "params_schema": {
            "threshold": {"type":"float","default":0.20,"min":0.05,"max":0.60,"label":"Signal threshold"},
            "oversold":  {"type":"int",  "default":30,  "min":20, "max":45, "label":"RSI oversold filter"},
            "overbought":{"type":"int",  "default":70,  "min":55, "max":80, "label":"RSI overbought filter"},
            "stop_pct":  {"type":"float","default":3.0, "min":0.5,"max":10, "label":"Stop Loss %"},
        },
    },
}
