"""World Lens — Financial data scraper (yfinance)
Fetches OHLCV for all 114 assets in EXTENDED_ASSETS universe.
Runs every FINANCE_INTERVAL_SECONDS (default 300s = 5min).
Uses batched async execution to stay within yfinance rate limits.
"""
from __future__ import annotations
import asyncio
import logging
import random
from datetime import datetime
from typing import Optional, List, Dict

logger = logging.getLogger(__name__)

# Import the full universe from the markets router (single source of truth)
try:
    from routers.markets import EXTENDED_ASSETS
    _SYMBOLS = [(sym, data[0], data[1]) for sym, data in EXTENDED_ASSETS.items()]
except Exception:
    # Fallback minimal list
    _SYMBOLS = [
        ("^GSPC","S&P 500","index"), ("^IXIC","Nasdaq","index"),
        ("^DJI","Dow Jones","index"), ("GC=F","Gold","commodity"),
        ("CL=F","Crude Oil","commodity"), ("BTC-USD","Bitcoin","crypto"),
        ("EURUSD=X","EUR/USD","forex"),
    ]

_cache: Dict[str, Dict] = {}
_last_fetch: Optional[datetime] = None
_BATCH_SIZE = 20   # yfinance handles ~20 tickers per batch well

# Base prices for mock fallback (keeps demos looking realistic)
_MOCK_BASES: Dict[str, float] = {
    "^GSPC":5450,"^IXIC":17200,"^DJI":40200,"^RUT":2050,"^VIX":16.5,
    "^SP500TR":12000,"^FTSE":8250,"^DAX":18600,"^CAC40":8100,
    "^STOXX50E":5100,"^IBEX":11200,"^N225":39800,"^HSI":18200,
    "000001.SS":3100,"^AXJO":7900,"^NSEI":23500,"^BVSP":128000,
    "GC=F":2380,"SI=F":29.5,"CL=F":77.8,"BZ=F":80.5,"NG=F":2.1,
    "HG=F":4.35,"PA=F":990,"PL=F":980,"ZW=F":580,"ZC=F":440,
    "ZS=F":1200,"CC=F":7500,"KC=F":215,"CT=F":88,"SB=F":22,
    "EURUSD=X":1.085,"GBPUSD=X":1.268,"JPY=X":151.2,"AUDUSD=X":0.655,
    "USDCAD=X":1.372,"USDCHF=X":0.898,"NZDUSD=X":0.598,
    "USDCNH=X":7.25,"USDBRL=X":5.12,"USDINR=X":83.5,
    "USDZAR=X":18.6,"USDTRY=X":32.1,"DX=F":104.5,
    "BTC-USD":67200,"ETH-USD":3480,"SOL-USD":168,"XRP-USD":0.52,
    "BNB-USD":580,"ADA-USD":0.45,
    "AAPL":189,"MSFT":415,"NVDA":875,"GOOGL":172,"AMZN":185,
    "META":506,"TSLA":178,"BRK-B":398,"LLY":785,"V":278,
    "JPM":197,"WMT":65,"XOM":118,"MA":461,"HD":348,
    "PG":163,"UNH":495,"GS":462,"BAC":39,"AVGO":1420,
    "AMD":165,"INTC":32,"CRM":283,"BA":181,"CAT":362,
    "LMT":465,"RTX":104,"ASML.AS":840,"LVMH.PA":730,"SAP.DE":184,
    "SHEL.L":30,"NOVO-B.CO":830,"NESN.SW":96,"9988.HK":78,
    "700.HK":338,"005930.KS":72000,"7203.T":3210,
    "TCS.NS":3900,"RELIANCE.NS":2950,
    "XLF":42,"XLE":91,"XLK":210,"XLV":145,"XLI":125,
    "XLU":68,"XLB":89,"XLRE":39,"XLC":79,"IWM":205,
    "EEM":42,"EWJ":65,"GLD":218,"TLT":92,"HYG":78,
    "LQD":106,"SHY":82,"ARKK":48,"KWEB":28,"VNQ":85,
    "^TNX":4.35,"^TYX":4.55,"^IRX":5.25,"^FVX":4.25,
}


async def fetch_finance() -> List[Dict]:
    """Fetch prices for all assets. Returns list of dicts with price + change_pct."""
    global _cache, _last_fetch
    results = []

    try:
        import yfinance as yf

        # Split into batches to avoid rate limiting
        symbols = [s[0] for s in _SYMBOLS]
        sym_meta = {s[0]: (s[1], s[2]) for s in _SYMBOLS}
        batches  = [symbols[i:i+_BATCH_SIZE] for i in range(0, len(symbols), _BATCH_SIZE)]

        def _fetch_batch(batch: List[str]) -> List[Dict]:
            out = []
            try:
                # yfinance multi-download is much faster than one-by-one
                tickers = yf.download(
                    batch, period="5d", interval="1d",
                    group_by="ticker", progress=False,
                    auto_adjust=True, threads=True,
                )
                for sym in batch:
                    try:
                        if len(batch) == 1:
                            h = tickers
                        else:
                            h = tickers[sym] if sym in tickers.columns.get_level_values(0) else None
                        if h is None or h.empty:
                            continue
                        close = h["Close"].dropna()
                        if len(close) < 1:
                            continue
                        cur  = float(close.iloc[-1])
                        prev = float(close.iloc[-2]) if len(close) >= 2 else cur
                        pct  = round((cur/prev - 1)*100, 3) if prev else 0.0
                        chg  = round(cur - prev, 4)
                        hist = [round(float(x),4) for x in close.tolist()[-10:]]
                        name, cat = sym_meta.get(sym, (sym,"stock"))
                        out.append({
                            "symbol": sym, "name": name, "category": cat,
                            "price":      round(cur, 4),
                            "change_pct": pct,
                            "change_abs": chg,
                            "history":    hist,
                            "fetched_at": datetime.utcnow().isoformat(),
                        })
                    except Exception as e:
                        logger.debug("yfinance %s: %s", sym, e)
            except Exception as e:
                logger.warning("yfinance batch %s: %s", batch[:3], e)
            return out

        loop = asyncio.get_event_loop()
        for batch in batches:
            batch_results = await loop.run_in_executor(None, _fetch_batch, batch)
            results.extend(batch_results)
            # Small delay between batches to respect rate limits
            await asyncio.sleep(0.3)

        if results:
            for r in results:
                _cache[r["symbol"]] = r
            _last_fetch = datetime.utcnow()
            logger.info("Finance scraper: %d/%d assets fetched", len(results), len(symbols))
            return results

    except ImportError:
        logger.warning("yfinance not installed — using mock data. Install with: pip install yfinance")
    except Exception as e:
        logger.error("Finance scraper error: %s", e)

    # Mock fallback
    return _get_mock()


def get_cached() -> List[Dict]:
    if _cache:
        return list(_cache.values())
    return _get_mock()


def _get_mock() -> List[Dict]:
    result = []
    for sym, name, cat in _SYMBOLS:
        base = _MOCK_BASES.get(sym, 100.0)
        pct  = round(random.uniform(-2.5, 2.5), 2)
        chg  = round(base * pct / 100, 4)
        hist = [round(base * (1 + random.uniform(-0.02, 0.02)), 4) for _ in range(10)]
        result.append({
            "symbol": sym, "name": name, "category": cat,
            "price":      base,
            "change_pct": pct,
            "change_abs": chg,
            "history":    hist,
        })
    return result
