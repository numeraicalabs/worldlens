"""
tradgentic/market_data.py
Market data fetcher — uses yfinance with fallback synthetic data.
Zero-cost, no API keys required.
"""
from __future__ import annotations
import time, math, random, logging
from typing import List, Dict, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# ── In-memory price cache (TTL 60s) ─────────────────────────────────────────
_PRICE_CACHE: Dict[str, Dict] = {}
_CACHE_TTL = 60  # seconds


def _cache_get(symbol: str) -> Optional[Dict]:
    e = _PRICE_CACHE.get(symbol)
    if e and time.time() - e["ts"] < _CACHE_TTL:
        return e["data"]
    return None


def _cache_set(symbol: str, data: Dict):
    _PRICE_CACHE[symbol] = {"ts": time.time(), "data": data}


# ── yfinance fetch (optional dep) ───────────────────────────────────────────
async def fetch_quote(symbol: str) -> Dict:
    """Fetch live quote. Falls back to synthetic if yfinance unavailable."""
    cached = _cache_get(symbol)
    if cached:
        return cached

    try:
        import yfinance as yf
        tk = yf.Ticker(symbol)
        info = tk.fast_info
        price  = float(getattr(info, "last_price",  None) or 0)
        prev   = float(getattr(info, "previous_close", None) or price)
        high   = float(getattr(info, "day_high",  price * 1.01) or price)
        low    = float(getattr(info, "day_low",   price * 0.99) or price)
        volume = int(getattr(info, "three_month_average_volume", 1_000_000) or 1_000_000)
        if price <= 0:
            raise ValueError("zero price")
        chg_pct = ((price - prev) / prev * 100) if prev else 0
        result = {
            "symbol": symbol.upper(),
            "price":  round(price, 4),
            "prev":   round(prev, 4),
            "high":   round(high, 4),
            "low":    round(low, 4),
            "change_pct": round(chg_pct, 3),
            "volume": volume,
            "source": "yfinance",
            "ts": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.debug("yfinance fallback for %s: %s", symbol, e)
        result = _synthetic_quote(symbol)

    _cache_set(symbol, result)
    return result


def _synthetic_quote(symbol: str) -> Dict:
    """Deterministic synthetic price seeded on symbol + hour."""
    seed = sum(ord(c) for c in symbol) + int(time.time() / 3600)
    rng  = random.Random(seed)
    base_prices = {
        "AAPL": 175, "MSFT": 420, "GOOGL": 175, "NVDA": 850,
        "SPY": 505, "QQQ": 440, "BTC-USD": 67000, "ETH-USD": 3400,
        "GC=F": 2350, "CL=F": 82, "^VIX": 14.5, "TSLA": 175,
        "AMZN": 185, "META": 500, "NFLX": 620, "AMD": 165,
    }
    base  = base_prices.get(symbol.upper(), 100 + seed % 400)
    jitter = rng.uniform(-0.03, 0.03)
    price  = round(base * (1 + jitter), 2)
    chg    = round(rng.uniform(-2.5, 2.5), 3)
    prev   = round(price / (1 + chg / 100), 2)
    return {
        "symbol":     symbol.upper(),
        "price":      price,
        "prev":       prev,
        "high":       round(price * 1.012, 2),
        "low":        round(price * 0.988, 2),
        "change_pct": chg,
        "volume":     rng.randint(500_000, 50_000_000),
        "source":     "synthetic",
        "ts":         datetime.utcnow().isoformat(),
    }


async def fetch_history(symbol: str, period: str = "3mo") -> List[Dict]:
    """Fetch OHLCV history for chart rendering."""
    try:
        import yfinance as yf
        import pandas as pd
        df = yf.Ticker(symbol).history(period=period)
        if df.empty:
            raise ValueError("empty")
        return [
            {
                "date":   idx.strftime("%Y-%m-%d"),
                "open":   round(float(r["Open"]),  4),
                "high":   round(float(r["High"]),  4),
                "low":    round(float(r["Low"]),   4),
                "close":  round(float(r["Close"]), 4),
                "volume": int(r["Volume"]),
            }
            for idx, r in df.iterrows()
        ]
    except Exception as e:
        logger.debug("history fallback %s: %s", symbol, e)
        return _synthetic_history(symbol)


def _synthetic_history(symbol: str, days: int = 60) -> List[Dict]:
    rng   = random.Random(sum(ord(c) for c in symbol))
    price = {"AAPL": 170, "SPY": 490, "BTC-USD": 62000}.get(symbol, 100)
    out   = []
    for i in range(days, 0, -1):
        d = (datetime.utcnow() - timedelta(days=i)).strftime("%Y-%m-%d")
        chg = rng.uniform(-0.025, 0.025)
        price *= (1 + chg)
        o = round(price * rng.uniform(0.995, 1.005), 2)
        h = round(price * rng.uniform(1.002, 1.018), 2)
        l = round(price * rng.uniform(0.982, 0.998), 2)
        c = round(price, 2)
        out.append({"date": d, "open": o, "high": h, "low": l,
                    "close": c, "volume": rng.randint(100_000, 5_000_000)})
    return out


async def fetch_multi(symbols: List[str]) -> Dict[str, Dict]:
    results = {}
    for sym in symbols:
        results[sym] = await fetch_quote(sym)
    return results
