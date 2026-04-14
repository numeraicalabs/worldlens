"""
tradgentic/strategies.py
Abstract base + concrete trading strategy implementations.
Each strategy exposes a single method: generate_signal(prices, params) -> Signal
"""
from __future__ import annotations
import math
from abc import ABC, abstractmethod
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass, field


@dataclass
class Signal:
    action:     str    # "BUY" | "SELL" | "HOLD"
    strength:   float  # 0.0–1.0
    reason:     str    # human-readable
    price:      float
    stop_loss:  Optional[float] = None
    take_profit: Optional[float] = None


# ── Base class ───────────────────────────────────────────────────────────────

class BaseTradingBot(ABC):
    STRATEGY_ID:   str = "base"
    STRATEGY_NAME: str = "Base Strategy"
    DESCRIPTION:   str = ""
    PARAMS_SCHEMA: Dict = {}  # {param_name: {type, default, min, max, label}}

    @abstractmethod
    def generate_signal(self, prices: List[float], params: Dict) -> Signal:
        """Core signal logic. prices = list of close prices, newest last."""

    def default_params(self) -> Dict:
        return {k: v["default"] for k, v in self.PARAMS_SCHEMA.items()}

    def meta(self) -> Dict:
        return {
            "id":          self.STRATEGY_ID,
            "name":        self.STRATEGY_NAME,
            "description": self.DESCRIPTION,
            "params":      self.PARAMS_SCHEMA,
        }


# ── Utility helpers ──────────────────────────────────────────────────────────

def _sma(prices: List[float], n: int) -> Optional[float]:
    if len(prices) < n:
        return None
    return sum(prices[-n:]) / n


def _ema(prices: List[float], n: int) -> Optional[float]:
    if len(prices) < n:
        return None
    k = 2 / (n + 1)
    ema = prices[-n]
    for p in prices[-n + 1:]:
        ema = p * k + ema * (1 - k)
    return ema


def _rsi(prices: List[float], n: int = 14) -> Optional[float]:
    if len(prices) < n + 1:
        return None
    deltas = [prices[i] - prices[i-1] for i in range(1, len(prices))]
    gains  = [max(d, 0) for d in deltas[-n:]]
    losses = [abs(min(d, 0)) for d in deltas[-n:]]
    avg_gain = sum(gains) / n
    avg_loss = sum(losses) / n
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return round(100 - 100 / (1 + rs), 2)


def _bollinger(prices: List[float], n: int = 20, k: float = 2.0) -> Optional[Tuple]:
    if len(prices) < n:
        return None
    window = prices[-n:]
    mid    = sum(window) / n
    std    = math.sqrt(sum((p - mid) ** 2 for p in window) / n)
    return mid - k * std, mid, mid + k * std


def _macd(prices: List[float]) -> Optional[Tuple[float, float, float]]:
    """Returns (macd, signal, histogram)"""
    e12 = _ema(prices, 12)
    e26 = _ema(prices, 26)
    if e12 is None or e26 is None:
        return None
    macd_val = e12 - e26
    # signal line = 9-period EMA of MACD (simplified: use last 9 daily MACD values)
    macd_hist = [(_ema(prices[:i], 12) or 0) - (_ema(prices[:i], 26) or 0)
                 for i in range(max(26, len(prices)-9), len(prices))]
    if not macd_hist:
        return macd_val, macd_val, 0.0
    signal = sum(macd_hist) / len(macd_hist)
    return macd_val, signal, round(macd_val - signal, 4)


# ── Strategy 1: Moving Average Crossover ────────────────────────────────────

class MACrossoverBot(BaseTradingBot):
    STRATEGY_ID   = "ma_crossover"
    STRATEGY_NAME = "MA Crossover"
    DESCRIPTION   = "Golden/Death cross using fast and slow moving averages. Buys when fast MA crosses above slow MA."
    PARAMS_SCHEMA = {
        "fast_ma":  {"type": "int",   "default": 10,  "min": 3,  "max": 50,  "label": "Fast MA period"},
        "slow_ma":  {"type": "int",   "default": 30,  "min": 10, "max": 200, "label": "Slow MA period"},
        "ma_type":  {"type": "select","default": "EMA","options": ["SMA","EMA"],"label": "MA Type"},
        "stop_pct": {"type": "float", "default": 2.0, "min": 0.5,"max": 10.0,"label": "Stop Loss %"},
    }

    def generate_signal(self, prices: List[float], params: Dict) -> Signal:
        fast_n  = int(params.get("fast_ma", 10))
        slow_n  = int(params.get("slow_ma", 30))
        ma_type = params.get("ma_type", "EMA")
        fn      = _ema if ma_type == "EMA" else _sma

        fast_now  = fn(prices, fast_n)
        slow_now  = fn(prices, slow_n)
        fast_prev = fn(prices[:-1], fast_n)
        slow_prev = fn(prices[:-1], slow_n)
        price     = prices[-1]

        if None in (fast_now, slow_now, fast_prev, slow_prev):
            return Signal("HOLD", 0.0, "Insufficient data", price)

        stop_pct = float(params.get("stop_pct", 2.0))

        # Golden cross: fast crosses above slow
        if fast_prev <= slow_prev and fast_now > slow_now:
            return Signal("BUY", 0.8,
                f"{ma_type}({fast_n}) crossed above {ma_type}({slow_n})", price,
                stop_loss=round(price * (1 - stop_pct/100), 4),
                take_profit=round(price * (1 + stop_pct * 2 / 100), 4))

        # Death cross: fast crosses below slow
        if fast_prev >= slow_prev and fast_now < slow_now:
            return Signal("SELL", 0.8,
                f"{ma_type}({fast_n}) crossed below {ma_type}({slow_n})", price)

        gap  = abs(fast_now - slow_now) / slow_now
        hold_reason = f"{ma_type}({fast_n})={fast_now:.2f} vs {ma_type}({slow_n})={slow_now:.2f}"
        return Signal("HOLD", gap * 5, hold_reason, price)


# ── Strategy 2: RSI Mean Reversion ──────────────────────────────────────────

class RSIMeanReversionBot(BaseTradingBot):
    STRATEGY_ID   = "rsi_reversion"
    STRATEGY_NAME = "RSI Reversion"
    DESCRIPTION   = "Buys oversold conditions (RSI < 30) and sells overbought (RSI > 70). Classic mean-reversion."
    PARAMS_SCHEMA = {
        "rsi_period":    {"type": "int",   "default": 14, "min": 7,  "max": 30,   "label": "RSI Period"},
        "oversold":      {"type": "int",   "default": 30, "min": 10, "max": 45,   "label": "Oversold threshold"},
        "overbought":    {"type": "int",   "default": 70, "min": 55, "max": 90,   "label": "Overbought threshold"},
        "stop_pct":      {"type": "float", "default": 3.0,"min": 0.5,"max": 10.0, "label": "Stop Loss %"},
    }

    def generate_signal(self, prices: List[float], params: Dict) -> Signal:
        n          = int(params.get("rsi_period", 14))
        oversold   = int(params.get("oversold", 30))
        overbought = int(params.get("overbought", 70))
        stop_pct   = float(params.get("stop_pct", 3.0))
        price      = prices[-1]

        rsi = _rsi(prices, n)
        if rsi is None:
            return Signal("HOLD", 0.0, "Insufficient data", price)

        if rsi <= oversold:
            strength = (oversold - rsi) / oversold
            return Signal("BUY", min(strength, 1.0),
                f"RSI({n})={rsi:.1f} — oversold below {oversold}", price,
                stop_loss=round(price*(1-stop_pct/100), 4),
                take_profit=round(price*(1+stop_pct*1.5/100), 4))

        if rsi >= overbought:
            strength = (rsi - overbought) / (100 - overbought)
            return Signal("SELL", min(strength, 1.0),
                f"RSI({n})={rsi:.1f} — overbought above {overbought}", price)

        return Signal("HOLD", 0.1, f"RSI({n})={rsi:.1f} — neutral zone", price)


# ── Strategy 3: Bollinger Band Breakout ──────────────────────────────────────

class BollingerBandBot(BaseTradingBot):
    STRATEGY_ID   = "bollinger_bands"
    STRATEGY_NAME = "Bollinger Bands"
    DESCRIPTION   = "Trades Bollinger Band breakouts and mean-reversion. Flexible for both trending and ranging markets."
    PARAMS_SCHEMA = {
        "bb_period": {"type": "int",   "default": 20,  "min": 10, "max": 50,   "label": "BB Period"},
        "bb_std":    {"type": "float", "default": 2.0, "min": 1.0,"max": 3.0,  "label": "Std Dev multiplier"},
        "mode":      {"type": "select","default": "reversion","options": ["reversion","breakout"],"label": "Mode"},
        "stop_pct":  {"type": "float", "default": 2.5, "min": 0.5,"max": 10.0, "label": "Stop Loss %"},
    }

    def generate_signal(self, prices: List[float], params: Dict) -> Signal:
        n        = int(params.get("bb_period", 20))
        k        = float(params.get("bb_std", 2.0))
        mode     = params.get("mode", "reversion")
        stop_pct = float(params.get("stop_pct", 2.5))
        price    = prices[-1]

        bb = _bollinger(prices, n, k)
        if bb is None:
            return Signal("HOLD", 0.0, "Insufficient data", price)
        lower, mid, upper = bb
        bw = (upper - lower) / mid  # bandwidth

        if mode == "reversion":
            if price <= lower:
                return Signal("BUY", min((lower - price) / lower * 20, 1.0),
                    f"Price {price:.2f} at lower band {lower:.2f}", price,
                    stop_loss=round(price*(1-stop_pct/100), 4),
                    take_profit=round(mid, 4))
            if price >= upper:
                return Signal("SELL", min((price - upper) / upper * 20, 1.0),
                    f"Price {price:.2f} at upper band {upper:.2f}", price)
        else:  # breakout
            if price > upper:
                return Signal("BUY", 0.7, f"Breakout above upper BB {upper:.2f}", price,
                    stop_loss=round(mid, 4), take_profit=round(price*1.04, 4))
            if price < lower:
                return Signal("SELL", 0.7, f"Breakdown below lower BB {lower:.2f}", price)

        pct = (price - lower) / (upper - lower) * 100
        return Signal("HOLD", 0.1, f"BB position: {pct:.0f}% (BW={bw:.3f})", price)


# ── Strategy 4: MACD Momentum ────────────────────────────────────────────────

class MACDMomentumBot(BaseTradingBot):
    STRATEGY_ID   = "macd_momentum"
    STRATEGY_NAME = "MACD Momentum"
    DESCRIPTION   = "Uses MACD line crossing the signal line for trend momentum entries and exits."
    PARAMS_SCHEMA = {
        "stop_pct":    {"type": "float", "default": 2.5, "min": 0.5,"max": 10.0, "label": "Stop Loss %"},
        "min_hist":    {"type": "float", "default": 0.1, "min": 0.0,"max": 2.0,  "label": "Min histogram threshold"},
    }

    def generate_signal(self, prices: List[float], params: Dict) -> Signal:
        stop_pct = float(params.get("stop_pct", 2.5))
        min_hist = float(params.get("min_hist", 0.1))
        price    = prices[-1]

        m = _macd(prices)
        if m is None:
            return Signal("HOLD", 0.0, "Insufficient data (need 26+ bars)", price)
        macd_val, signal, hist = m
        m_prev = _macd(prices[:-1])

        if m_prev is None:
            return Signal("HOLD", 0.0, "Building momentum...", price)
        _, _, hist_prev = m_prev

        # MACD histogram flips positive (buy)
        if hist_prev <= 0 and hist > min_hist:
            return Signal("BUY", min(abs(hist) * 10, 1.0),
                f"MACD={macd_val:.3f} crossed above signal={signal:.3f}", price,
                stop_loss=round(price*(1-stop_pct/100), 4),
                take_profit=round(price*(1+stop_pct*2/100), 4))

        # MACD histogram flips negative (sell)
        if hist_prev >= 0 and hist < -min_hist:
            return Signal("SELL", min(abs(hist) * 10, 1.0),
                f"MACD={macd_val:.3f} crossed below signal={signal:.3f}", price)

        direction = "bullish" if hist > 0 else "bearish"
        return Signal("HOLD", 0.1, f"MACD histogram {hist:.3f} — {direction}", price)


# ── Registry ─────────────────────────────────────────────────────────────────

STRATEGY_REGISTRY: Dict[str, BaseTradingBot] = {
    "ma_crossover":    MACrossoverBot(),
    "rsi_reversion":   RSIMeanReversionBot(),
    "bollinger_bands": BollingerBandBot(),
    "macd_momentum":   MACDMomentumBot(),
    "ml_xgb":          MLGradientBoostBot(),
    "ml_ensemble":     MLEnsembleBot(),
    "ml_sentiment":    MLSentimentBot(),
}


def get_strategy(strategy_id: str) -> Optional[BaseTradingBot]:
    return STRATEGY_REGISTRY.get(strategy_id)


def list_strategies() -> List[Dict]:
    return [s.meta() for s in STRATEGY_REGISTRY.values()]


# ── ML Strategy stubs — signals generated by ml_bot.py, not here ────────────

class MLGradientBoostBot(BaseTradingBot):
    STRATEGY_ID   = "ml_xgb"
    STRATEGY_NAME = "🧠 ML Gradient Boost"
    DESCRIPTION   = "Gradient Boosting trained on 19 technical features. Predicts price direction."
    PARAMS_SCHEMA = {
        "stop_pct": {"type":"float","default":2.5,"min":0.5,"max":10.0,"label":"Stop Loss %"},
    }
    def generate_signal(self, prices, params):
        return Signal("HOLD", 0.3, "Use /ml/signal endpoint for ML signals", prices[-1] if prices else 0)


class MLEnsembleBot(BaseTradingBot):
    STRATEGY_ID   = "ml_ensemble"
    STRATEGY_NAME = "⚡ ML Ensemble"
    DESCRIPTION   = "3-way vote: ML Gradient Boost + MACD + RSI. Most robust strategy."
    PARAMS_SCHEMA = {
        "min_hist":   {"type":"float","default":0.05,"min":0.0,"max":1.0,"label":"MACD min histogram"},
        "oversold":   {"type":"int",  "default":32,  "min":20, "max":45, "label":"RSI oversold"},
        "overbought": {"type":"int",  "default":68,  "min":55, "max":80, "label":"RSI overbought"},
        "stop_pct":   {"type":"float","default":2.5, "min":0.5,"max":10, "label":"Stop Loss %"},
    }
    def generate_signal(self, prices, params):
        return Signal("HOLD", 0.3, "Use /ml/signal endpoint for ML signals", prices[-1] if prices else 0)


class MLSentimentBot(BaseTradingBot):
    STRATEGY_ID   = "ml_sentiment"
    STRATEGY_NAME = "📰 News Sentiment"
    DESCRIPTION   = "WorldLens events sentiment + VIX + RSI filter. Unique cross-data signal."
    PARAMS_SCHEMA = {
        "threshold":  {"type":"float","default":0.20,"min":0.05,"max":0.60,"label":"Signal threshold"},
        "oversold":   {"type":"int",  "default":30,  "min":20, "max":45, "label":"RSI oversold"},
        "overbought": {"type":"int",  "default":70,  "min":55, "max":80, "label":"RSI overbought"},
        "stop_pct":   {"type":"float","default":3.0, "min":0.5,"max":10, "label":"Stop Loss %"},
    }
    def generate_signal(self, prices, params):
        return Signal("HOLD", 0.3, "Use /ml/signal endpoint for ML signals", prices[-1] if prices else 0)

