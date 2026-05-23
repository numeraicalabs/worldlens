"""
WorldLens — Macro Indicators Seed & Updater
Popola macro_indicators con dati finanziari reali (yfinance) + indicatori fissi.
Chiamato dallo scheduler ogni ora.
"""
from __future__ import annotations
import asyncio
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)


# ── Indicatori da yfinance ─────────────────────────────────────────────────────
YFINANCE_INDICATORS = [
    # (ticker, name, unit, country, category)
    ("^GSPC",  "S&P 500",          "pts",  "USA",    "equity"),
    ("^NDX",   "Nasdaq 100",        "pts",  "USA",    "equity"),
    ("^DJI",   "Dow Jones",         "pts",  "USA",    "equity"),
    ("^FTSE",  "FTSE 100",          "pts",  "UK",     "equity"),
    ("^GDAXI", "DAX",               "pts",  "DE",     "equity"),
    ("^FCHI",  "CAC 40",            "pts",  "FR",     "equity"),
    ("^N225",  "Nikkei 225",        "pts",  "JP",     "equity"),
    ("000001.SS","Shanghai Comp.",  "pts",  "CN",     "equity"),
    # Bonds / Rates
    ("^TNX",   "US 10Y Yield",      "%",    "USA",    "rates"),
    ("^TYX",   "US 30Y Yield",      "%",    "USA",    "rates"),
    ("^IRX",   "US 3M T-Bill",      "%",    "USA",    "rates"),
    # Commodities
    ("GC=F",   "Gold",              "$/oz", "Global", "commodities"),
    ("SI=F",   "Silver",            "$/oz", "Global", "commodities"),
    ("CL=F",   "WTI Crude Oil",     "$/bbl","Global", "energy"),
    ("BZ=F",   "Brent Crude",       "$/bbl","Global", "energy"),
    ("NG=F",   "Natural Gas",       "$/MMBtu","Global","energy"),
    # Forex
    ("EURUSD=X","EUR/USD",          "",     "Global", "forex"),
    ("GBPUSD=X","GBP/USD",          "",     "Global", "forex"),
    ("USDJPY=X","USD/JPY",          "",     "Global", "forex"),
    ("USDCNY=X","USD/CNY",          "",     "Global", "forex"),
    ("USDCHF=X","USD/CHF",          "",     "Global", "forex"),
    # Crypto
    ("BTC-USD", "Bitcoin",          "USD",  "Global", "crypto"),
    ("ETH-USD", "Ethereum",         "USD",  "Global", "crypto"),
    # Volatility
    ("^VIX",   "VIX Fear Index",    "pts",  "USA",    "risk"),
    ("^MOVE",  "MOVE Bond Vol.",    "pts",  "USA",    "risk"),
    # Macro ETF proxies
    ("DXY",    "US Dollar Index",   "pts",  "USA",    "forex"),
    ("TLT",    "US Long Bond ETF",  "USD",  "USA",    "rates"),
    ("HYG",    "High Yield Bonds",  "USD",  "USA",    "credit"),
    ("EMB",    "EM Bonds ETF",      "USD",  "Global", "credit"),
]

# Fallback per DXY (non su yfinance direttamente)
DXY_TICKER = "DX-Y.NYB"


async def fetch_yfinance_price(ticker: str) -> tuple[Optional[float], Optional[float]]:
    """Returns (current_price, previous_close) or (None, None)."""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        hist = t.history(period="5d", interval="1d")
        if hist.empty or len(hist) < 1:
            return None, None
        current = float(hist["Close"].iloc[-1])
        previous = float(hist["Close"].iloc[-2]) if len(hist) >= 2 else current
        return round(current, 4), round(previous, 4)
    except Exception as e:
        logger.debug("yfinance %s: %s", ticker, e)
        return None, None


async def seed_macro_indicators() -> int:
    """Fetch all indicators and upsert into macro_indicators. Returns count updated."""
    from db import get_db

    updated = 0
    tasks = []

    # Fetch all prices concurrently
    for ticker, name, unit, country, category in YFINANCE_INDICATORS:
        tasks.append((ticker, name, unit, country, category))

    results = await asyncio.gather(
        *[fetch_yfinance_price(t[0]) for t in tasks],
        return_exceptions=True
    )

    async with get_db() as db:
        for (ticker, name, unit, country, category), result in zip(tasks, results):
            if isinstance(result, Exception) or result is None:
                continue
            current, previous = result
            if current is None:
                continue

            # Calcola trend
            if previous and previous != 0:
                chg_pct = (current - previous) / previous * 100
                trend = "up" if chg_pct > 0.1 else "down" if chg_pct < -0.1 else "stable"
            else:
                trend = "stable"

            try:
                await db.execute(
                    """INSERT INTO macro_indicators
                       (name, value, previous, unit, country, category, trend, source, updated_at)
                       VALUES (?,?,?,?,?,?,?,'yfinance', NOW())
                       ON CONFLICT(name, country) DO UPDATE SET
                       value=EXCLUDED.value,
                       previous=EXCLUDED.previous,
                       trend=EXCLUDED.trend,
                       updated_at=NOW()""",
                    (name, current, previous, unit, country, category, trend)
                )
                updated += 1
            except Exception as e:
                logger.debug("macro upsert %s: %s", name, e)

        await db.commit()

    logger.info("macro_seed: updated %d indicators", updated)
    return updated
