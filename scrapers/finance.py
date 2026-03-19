"""World Lens — Financial data via yfinance"""
from __future__ import annotations
import asyncio
import logging
import random
from datetime import datetime
from typing import Optional, List, Dict

logger = logging.getLogger(__name__)

ASSETS = [
    ("^GSPC",    "S&P 500",     "index"),
    ("^IXIC",    "Nasdaq",      "index"),
    ("^DJI",     "Dow Jones",   "index"),
    ("^FTSE",    "FTSE 100",    "index"),
    ("^DAX",     "DAX",         "index"),
    ("^N225",    "Nikkei 225",  "index"),
    ("^VIX",     "VIX",         "index"),
    ("GC=F",     "Gold",        "commodity"),
    ("CL=F",     "Crude Oil",   "commodity"),
    ("NG=F",     "Natural Gas", "commodity"),
    ("EURUSD=X", "EUR/USD",     "forex"),
    ("GBPUSD=X", "GBP/USD",     "forex"),
    ("JPY=X",    "USD/JPY",     "forex"),
    ("BTC-USD",  "Bitcoin",     "crypto"),
    ("ETH-USD",  "Ethereum",    "crypto"),
    ("BNB-USD",  "BNB",         "crypto"),
]

_cache: Dict = {}
_last_fetch: Optional[datetime] = None


async def fetch_finance() -> List[Dict]:
    global _cache, _last_fetch
    try:
        import yfinance as yf

        def _sync():
            results = []
            for sym, name, cat in ASSETS:
                try:
                    t = yf.Ticker(sym)
                    h = t.history(period="10d", interval="1d")
                    if h.empty:
                        continue
                    cur = float(h["Close"].iloc[-1])
                    prev = float(h["Close"].iloc[-2]) if len(h) > 1 else cur
                    chg = cur - prev
                    pct = (chg / prev * 100) if prev else 0
                    hist = [float(x) for x in h["Close"].tolist()[-10:]]
                    results.append({
                        "symbol": sym, "name": name, "category": cat,
                        "price": round(cur, 4),
                        "change_pct": round(pct, 2),
                        "change_abs": round(chg, 4),
                        "history": hist,
                    })
                except Exception as e:
                    logger.debug("Finance %s: %s", sym, e)
            return results

        loop = asyncio.get_event_loop()
        data = await loop.run_in_executor(None, _sync)
        if data:
            _cache = {d["symbol"]: d for d in data}
            _last_fetch = datetime.utcnow()
            logger.info("Finance: fetched %d assets", len(data))
            return data
    except ImportError:
        logger.warning("yfinance not installed — using mock data")

    return _get_mock()


def get_cached() -> List[Dict]:
    if _cache:
        return list(_cache.values())
    return _get_mock()


def _get_mock() -> List[Dict]:
    base = {
        "^GSPC": 5200, "^IXIC": 16400, "^DJI": 39100, "^FTSE": 7800,
        "^DAX": 18200, "^N225": 38500, "^VIX": 18.5, "GC=F": 2350,
        "CL=F": 78.5, "NG=F": 2.1, "EURUSD=X": 1.085, "GBPUSD=X": 1.265,
        "JPY=X": 151.5, "BTC-USD": 67000, "ETH-USD": 3500, "BNB-USD": 580,
    }
    result = []
    for sym, name, cat in ASSETS:
        p = base.get(sym, 100)
        pct = round(random.uniform(-2.5, 2.5), 2)
        chg = round(p * pct / 100, 2)
        hist = [p * (1 + random.uniform(-0.02, 0.02)) for _ in range(10)]
        result.append({
            "symbol": sym, "name": name, "category": cat,
            "price": round(p, 4),
            "change_pct": pct,
            "change_abs": chg,
            "history": hist,
        })
    return result
