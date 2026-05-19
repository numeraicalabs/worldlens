"""
WorldLens — PostgreSQL compatibility & resilience utilities
===========================================================
Centralizza: WebSocket handler, RSS scraping, rate limiting,
yfinance helpers, session_date migration fallback.
"""
from __future__ import annotations
import asyncio
import logging
import re
import time
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


# ── 1. SESSION DATE MIGRATION FALLBACK ────────────────────────────────────────

async def ensure_column(table: str, column: str, col_type: str = "TEXT DEFAULT ''") -> None:
    """Add column if it doesn't exist — safe to call repeatedly."""
    from db import get_db
    try:
        async with get_db() as db:
            await db.execute(
                f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {col_type}"
            )
            await db.commit()
        logger.info("ensure_column: %s.%s OK", table, column)
    except Exception as e:
        # PG raises IF NOT EXISTS as no-op; log only unexpected errors
        if "already exists" not in str(e).lower():
            logger.warning("ensure_column %s.%s: %s", table, column, e)


async def ensure_session_date() -> None:
    """Fix 'column session_date does not exist' errors."""
    await ensure_column("brain_agent_sessions", "session_date", "TEXT DEFAULT ''")
    await ensure_column("brain_agent_sessions", "message_count", "INTEGER DEFAULT 0")
    await ensure_column("brain_agent_sessions", "last_active", "TIMESTAMPTZ DEFAULT NOW()")


# ── 2. WEBSOCKET HANDLER ──────────────────────────────────────────────────────

async def safe_ws_accept(websocket) -> bool:
    """Accept WebSocket connection safely, return False if already connected."""
    try:
        if websocket.client_state.value == 0:  # CONNECTING
            await websocket.accept()
        return True
    except Exception as e:
        logger.warning("WS accept error: %s", e)
        return False


async def safe_ws_send(websocket, data: dict) -> bool:
    """Send JSON to WebSocket, return False on failure."""
    import json
    try:
        await websocket.send_text(json.dumps(data, default=str))
        return True
    except Exception as e:
        logger.debug("WS send error: %s", e)
        return False


# ── 3. RSS SCRAPER UTILITIES ──────────────────────────────────────────────────

RSS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept": "application/rss+xml, application/xml, text/xml, application/atom+xml, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate, br",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
}

# Correct feed URLs (replaces broken ones)
FEED_URL_FIXES = {
    # WTO — correct RSS feed
    "https://www.wto.org/error/error_404.htm": "https://www.wto.org/rss/english/news_e.rss",
    "https://www.wto.org/rss": "https://www.wto.org/rss/english/news_e.rss",
    # Reuters (requires subscription now — use alternatives)
    "https://feeds.reuters.com/reuters/worldNews": "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    # AP News changed URL structure
    "https://rsshub.app/apnews/topics/world-news": "https://feeds.apnews.com/rss/apf-topnews",
    # VOA
    "https://www.voanews.com/api/epiqq": "https://www.voanews.com/rss/world.rss",
    # OECD
    "https://www.oecd.org/newsroom/rss": "https://www.oecd.org/newsroom/rss/en/",
    # ReliefWeb — needs Accept: application/json header
    "https://reliefweb.int/headlines/rss.xml": "https://reliefweb.int/updates/rss.xml",
}


async def fetch_rss_feed(
    url: str,
    timeout: float = 15.0,
    max_retries: int = 2,
) -> Optional[str]:
    """
    Fetch RSS feed with proper headers, retry logic, and timeout.
    Returns raw XML string or None on failure.
    """
    import httpx

    # Apply URL fixes
    url = FEED_URL_FIXES.get(url, url)

    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(
                follow_redirects=True,
                timeout=httpx.Timeout(timeout),
                headers=RSS_HEADERS,
            ) as client:
                resp = await client.get(url)

                if resp.status_code == 403:
                    logger.debug("RSS 403 %s — skipping (paywall/bot block)", url)
                    return None
                if resp.status_code == 404:
                    logger.warning("RSS 404 %s — check URL", url)
                    return None
                if resp.status_code == 406:
                    # Try with different Accept header
                    resp = await client.get(url, headers={**RSS_HEADERS, "Accept": "*/*"})
                if resp.status_code == 429:
                    wait = 2 ** attempt * 5
                    logger.warning("RSS 429 %s — waiting %ds", url, wait)
                    await asyncio.sleep(wait)
                    continue
                if resp.status_code >= 400:
                    logger.debug("RSS HTTP %d %s", resp.status_code, url)
                    return None

                return resp.text

        except httpx.ConnectError:
            logger.debug("RSS ConnectError %s", url)
            return None
        except httpx.TimeoutException:
            if attempt < max_retries:
                await asyncio.sleep(2 ** attempt)
                continue
            logger.debug("RSS timeout %s", url)
            return None
        except Exception as e:
            logger.debug("RSS error %s: %s", url, e)
            return None

    return None


async def fetch_rss_feeds_concurrent(
    urls: List[str],
    max_concurrent: int = 5,
) -> Dict[str, Optional[str]]:
    """Fetch multiple RSS feeds concurrently with semaphore throttling."""
    semaphore = asyncio.Semaphore(max_concurrent)

    async def _fetch_one(url: str):
        async with semaphore:
            return url, await fetch_rss_feed(url)

    results = await asyncio.gather(*[_fetch_one(u) for u in urls], return_exceptions=True)
    return {
        url: xml for url, xml in results
        if not isinstance((url, xml), Exception)
    }


# ── 4. RATE LIMITING & BACKOFF ────────────────────────────────────────────────

class RateLimiter:
    """Token bucket rate limiter for API calls."""

    def __init__(self, calls_per_minute: int = 10):
        self.calls_per_minute = calls_per_minute
        self._calls: List[float] = []
        self._lock = asyncio.Lock()

    async def acquire(self) -> None:
        async with self._lock:
            now = time.monotonic()
            window = 60.0
            self._calls = [t for t in self._calls if now - t < window]
            if len(self._calls) >= self.calls_per_minute:
                oldest = self._calls[0]
                wait = window - (now - oldest) + 0.1
                if wait > 0:
                    await asyncio.sleep(wait)
                self._calls = self._calls[1:]
            self._calls.append(time.monotonic())


# Shared rate limiters
gdelt_limiter = RateLimiter(calls_per_minute=6)    # 1 call per 10s
yfinance_limiter = RateLimiter(calls_per_minute=30) # 1 call per 2s


async def with_exponential_backoff(
    coro_fn,
    *args,
    max_retries: int = 3,
    base_delay: float = 2.0,
    label: str = "call",
    **kwargs,
) -> Optional[Any]:
    """Call async function with exponential backoff on exception."""
    for attempt in range(max_retries + 1):
        try:
            return await coro_fn(*args, **kwargs)
        except Exception as e:
            err_str = str(e).lower()
            is_rate_limit = "429" in err_str or "rate limit" in err_str or "too many" in err_str
            if attempt == max_retries:
                logger.warning("%s failed after %d retries: %s", label, max_retries, e)
                return None
            delay = base_delay * (2 ** attempt) + (0.1 * attempt)
            if is_rate_limit:
                delay = max(delay, 10.0)
            logger.debug("%s attempt %d failed (%s) — retry in %.1fs", label, attempt + 1, e, delay)
            await asyncio.sleep(delay)
    return None


# ── 5. YFINANCE TICKER FIXES ──────────────────────────────────────────────────

# Correct Yahoo Finance ticker mappings
TICKER_MAP = {
    # European indices
    "^DAX": "^GDAXI",          # DAX — Yahoo uses ^GDAXI
    "DAX": "^GDAXI",
    "^CAC40": "^FCHI",         # CAC 40
    "CAC40": "^FCHI",
    "CAC 40": "^FCHI",
    "^IBEX": "^IBEX",          # IBEX 35 — already correct
    "IBEX35": "^IBEX",
    "^FTSE": "^FTSE",          # FTSE 100 — correct
    "FTSE100": "^FTSE",
    "^AEX": "^AEX",            # AEX Amsterdam
    "^MIB": "FTSEMIB.MI",      # FTSE MIB Italy
    "^SMI": "^SSMI",           # Swiss SMI
    "^ATX": "^ATX",            # Vienna ATX
    # French stocks
    "LVMH": "MC.PA",           # LVMH on Euronext Paris
    "LVMH.PA": "MC.PA",
    "AIR.PA": "AIR.PA",        # Airbus
    "SAP": "SAP.DE",           # SAP on Xetra
    # Asian indices
    "^NIKKEI": "^N225",
    "NIKKEI": "^N225",
    "^HANG_SENG": "^HSI",
    "HANGSENG": "^HSI",
    "^SSE": "000001.SS",       # Shanghai
    "^CSI300": "000300.SS",
    # Commodities (via ETF or futures)
    "GOLD": "GC=F",
    "OIL": "CL=F",
    "BRENT": "BZ=F",
    "NATGAS": "NG=F",
    "SILVER": "SI=F",
    "COPPER": "HG=F",
    # Crypto
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "BITCOIN": "BTC-USD",
}


def normalize_ticker(ticker: str) -> str:
    """Normalize ticker to Yahoo Finance format."""
    ticker = ticker.strip().upper().replace("$", "")
    return TICKER_MAP.get(ticker, ticker)


def validate_ticker(ticker: str) -> bool:
    """Basic ticker validation — returns False for obviously bad tickers."""
    ticker = normalize_ticker(ticker)
    # Must be 1-10 chars, alphanumeric + . ^ = -
    return bool(re.match(r'^[\^]?[A-Z0-9][A-Z0-9.\-=^]{0,9}$', ticker))


async def safe_yfinance_fetch(
    tickers: List[str],
    period: str = "1d",
    interval: str = "1m",
) -> Dict[str, Any]:
    """
    Fetch yfinance data with rate limiting, normalization, and error handling.
    Returns dict of {ticker: data} with failed tickers omitted.
    """
    import yfinance as yf

    normalized = {t: normalize_ticker(t) for t in tickers}
    valid = {orig: norm for orig, norm in normalized.items() if validate_ticker(norm)}

    if not valid:
        return {}

    results = {}
    # Batch in groups of 10 to avoid rate limits
    items = list(valid.items())
    for i in range(0, len(items), 10):
        batch = items[i:i + 10]
        await yfinance_limiter.acquire()

        async def _fetch_batch(batch=batch):
            symbols = [norm for _, norm in batch]
            try:
                data = yf.download(
                    symbols,
                    period=period,
                    interval=interval,
                    progress=False,
                    threads=False,
                    auto_adjust=True,
                )
                return data
            except Exception as e:
                if "rate" in str(e).lower() or "429" in str(e):
                    await asyncio.sleep(30)
                logger.warning("yfinance batch error: %s", e)
                return None

        data = await with_exponential_backoff(_fetch_batch, label="yfinance_batch")
        if data is not None:
            for orig, norm in batch:
                results[orig] = norm  # store normalized name; caller uses yf data

    return results


# ── 6. FINANCE POLL SQL FIX ───────────────────────────────────────────────────

def build_finance_upsert(ticker: str, data: dict) -> tuple:
    """
    Build a safe INSERT ... ON CONFLICT DO UPDATE for finance_cache.
    Returns (sql, params) tuple — avoids dynamic OR/AND construction.
    """
    sql = """
        INSERT INTO finance_cache (ticker, price, change_pct, volume, market_cap, 
                                    data_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
        ON CONFLICT (ticker) DO UPDATE SET
            price      = EXCLUDED.price,
            change_pct = EXCLUDED.change_pct,
            volume     = EXCLUDED.volume,
            market_cap = EXCLUDED.market_cap,
            data_json  = EXCLUDED.data_json,
            updated_at = NOW()
    """
    import json
    params = (
        ticker,
        float(data.get("price") or 0),
        float(data.get("change_pct") or 0),
        float(data.get("volume") or 0),
        float(data.get("market_cap") or 0),
        json.dumps(data),
    )
    return sql, params
