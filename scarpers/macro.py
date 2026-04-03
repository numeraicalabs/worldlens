"""
WorldLens — Live Macro Data Scraper
=====================================
Replaces seeded/hardcoded macro_indicators with live data from:

  1. FRED (Federal Reserve)  — key US series, free, no auth needed for many
  2. World Bank API           — global GDP/inflation, no auth
  3. ECB SDMX API             — EUR interest rate + EUR/USD, no auth
  4. CoinGecko                — crypto prices, 100 req/min free
  5. Alpha Vantage            — earnings calendar (optional, free key)

All sources are either no-auth or free-tier with public keys.
Falls back to existing DB values if any source is unavailable.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import httpx

logger = logging.getLogger(__name__)


# ── 1. FRED (Federal Reserve Economic Data) ──────────────────────────────────
# Free API key at https://fred.stlouisfed.org/docs/api/api_key.html
# Many series are publicly available without a key via direct URL

FRED_SERIES: List[Tuple[str, str, str, str, str]] = [
    # (series_id, display_name, unit, category, country)
    ("FEDFUNDS",           "Fed Funds Rate",       "%",       "rates",      "US"),
    ("CPIAUCSL",           "US CPI YoY",           "% YoY",   "economy",    "US"),
    ("UNRATE",             "US Unemployment",      "%",       "economy",    "US"),
    ("A191RL1Q225SBEA",    "US GDP Growth",        "% QoQ",   "economy",    "US"),
    ("T10Y2Y",             "Yield Curve 10y-2y",   "pts",     "rates",      "US"),
    ("VIXCLS",             "VIX Index",            "pts",     "risk",       "Global"),
    ("DX-Y.NYB",           "USD Index",            "pts",     "forex",      "Global"),
    ("DCOILWTICO",         "WTI Oil",              "$/bbl",   "energy",     "Global"),
    ("GOLDAMGBD228NLBM",   "Gold Spot",            "$/oz",    "commodities","Global"),
    ("BAMLH0A0HYM2",       "US HY Spread",         "bps",     "credit",     "US"),
    ("MORTGAGE30US",       "30Y Mortgage Rate",    "%",       "rates",      "US"),
    ("UMCSENT",            "US Consumer Conf.",    "index",   "sentiment",  "US"),
]


async def fetch_fred(client: httpx.AsyncClient, api_key: str = "") -> List[Dict]:
    """
    Fetch latest values from FRED.
    Works without a key for many series via direct vintage URL.
    Pass FRED_API_KEY env var for higher rate limits.
    """
    results = []
    for series_id, name, unit, category, country in FRED_SERIES:
        try:
            if api_key:
                url = (
                    f"https://api.stlouisfed.org/fred/series/observations"
                    f"?series_id={series_id}&api_key={api_key}"
                    f"&sort_order=desc&limit=2&file_type=json"
                )
            else:
                # Public vintage endpoint — works without key for most series
                url = (
                    f"https://fred.stlouisfed.org/graph/fredgraph.csv"
                    f"?id={series_id}"
                )
            resp = await client.get(url, timeout=10.0)
            resp.raise_for_status()

            current = previous = None
            if api_key:
                data = resp.json()
                obs = [o for o in data.get("observations", []) if o["value"] != "."]
                if len(obs) >= 1:
                    current  = float(obs[0]["value"])
                if len(obs) >= 2:
                    previous = float(obs[1]["value"])
            else:
                # CSV format: date,value per line
                lines = [l for l in resp.text.strip().split("\n")
                         if "," in l and not l.startswith("DATE")]
                if lines:
                    current  = float(lines[-1].split(",")[1])
                if len(lines) >= 2:
                    previous = float(lines[-2].split(",")[1])

            if current is not None:
                results.append({
                    "name":     name,
                    "value":    round(current,  4),
                    "previous": round(previous, 4) if previous is not None else current,
                    "unit":     unit,
                    "category": category,
                    "country":  country,
                })
                logger.debug("FRED %s = %s", series_id, current)

        except Exception as e:
            logger.debug("FRED %s error: %s", series_id, e)

    return results


# ── 2. World Bank API ─────────────────────────────────────────────────────────
# No authentication required. Returns latest available year (often T-1).

WORLD_BANK_INDICATORS: List[Tuple[str, str, str, str, str]] = [
    # (indicator, country_code, display_name, unit, category)
    ("NY.GDP.MKTP.KD.ZG", "CN",  "China GDP Growth",      "% YoY", "economy"),
    ("NY.GDP.MKTP.KD.ZG", "EU",  "Euro Area GDP Growth",  "% YoY", "economy"),
    ("NY.GDP.MKTP.KD.ZG", "JP",  "Japan GDP Growth",      "% YoY", "economy"),
    ("NY.GDP.MKTP.KD.ZG", "IN",  "India GDP Growth",      "% YoY", "economy"),
    ("NY.GDP.MKTP.KD.ZG", "BR",  "Brazil GDP Growth",     "% YoY", "economy"),
    ("FP.CPI.TOTL.ZG",    "CN",  "China CPI",             "% YoY", "economy"),
    ("FP.CPI.TOTL.ZG",    "JP",  "Japan CPI",             "% YoY", "economy"),
    ("SL.UEM.TOTL.ZS",    "EU",  "Euro Area Unemployment","%",      "economy"),
]

_WB_COUNTRY_NAMES = {
    "CN": "China", "EU": "Euro Area", "JP": "Japan",
    "IN": "India", "BR": "Brazil",
}


async def fetch_worldbank(client: httpx.AsyncClient) -> List[Dict]:
    results = []
    try:
        # Batch: fetch all indicators in one call
        indicators = ";".join(set(i for i, _, _, _, _ in WORLD_BANK_INDICATORS))
        countries  = ";".join(set(c for _, c, _, _, _ in WORLD_BANK_INDICATORS))
        url = (
            f"https://api.worldbank.org/v2/country/{countries}"
            f"/indicator/{indicators}?format=json&mrv=2&per_page=200"
        )
        resp = await client.get(url, timeout=15.0)
        resp.raise_for_status()
        data = resp.json()
        records = data[1] if len(data) > 1 else []

        # Index by (indicator, country)
        by_key: Dict = {}
        for rec in records:
            if rec.get("value") is None:
                continue
            key = (rec["indicator"]["id"], rec["countryiso3code"] or rec.get("country",{}).get("id",""))
            if key not in by_key:
                by_key[key] = []
            by_key[key].append(rec["value"])

        for ind_id, cc, name, unit, cat in WORLD_BANK_INDICATORS:
            vals = by_key.get((ind_id, cc), []) or by_key.get((ind_id, cc.lower()), [])
            if vals:
                results.append({
                    "name":     name,
                    "value":    round(float(vals[0]), 4),
                    "previous": round(float(vals[1]), 4) if len(vals) > 1 else round(float(vals[0]), 4),
                    "unit":     unit,
                    "category": cat,
                    "country":  _WB_COUNTRY_NAMES.get(cc, cc),
                })

    except Exception as e:
        logger.warning("World Bank fetch error: %s", e)
    return results


# ── 3. ECB SDMX API ───────────────────────────────────────────────────────────
# No authentication. Stable, official ECB Statistical Data Warehouse.

async def fetch_ecb(client: httpx.AsyncClient) -> List[Dict]:
    results = []
    try:
        # ECB main refinancing rate
        url = ("https://sdw-wsrest.ecb.europa.eu/service/data/FM/B.U2.EUR.RT0.BB.R.IN"
               "?format=jsondata&lastNObservations=2")
        resp = await client.get(url, timeout=10.0)
        resp.raise_for_status()
        d    = resp.json()
        obs  = d.get("dataSets", [{}])[0].get("series", {})
        vals = list(list(obs.values())[0]["observations"].values()) if obs else []
        if len(vals) >= 1:
            current  = float(vals[-1][0])
            previous = float(vals[-2][0]) if len(vals) >= 2 else current
            results.append({
                "name": "ECB Main Rate", "value": round(current, 4),
                "previous": round(previous, 4), "unit": "%",
                "category": "rates", "country": "EU",
            })
    except Exception as e:
        logger.debug("ECB rate error: %s", e)

    try:
        # EUR/USD exchange rate
        url = ("https://sdw-wsrest.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A"
               "?format=jsondata&lastNObservations=2")
        resp = await client.get(url, timeout=10.0)
        resp.raise_for_status()
        d   = resp.json()
        obs = d.get("dataSets", [{}])[0].get("series", {})
        vals = list(list(obs.values())[0]["observations"].values()) if obs else []
        if len(vals) >= 1:
            current  = float(vals[-1][0])
            previous = float(vals[-2][0]) if len(vals) >= 2 else current
            results.append({
                "name": "EUR/USD", "value": round(current, 5),
                "previous": round(previous, 5), "unit": "rate",
                "category": "forex", "country": "EU",
            })
    except Exception as e:
        logger.debug("ECB EUR/USD error: %s", e)

    return results


# ── 4. CoinGecko — crypto prices (free, no key) ───────────────────────────────

COINGECKO_COINS = [
    ("bitcoin",   "BTC",  "Bitcoin",   "crypto"),
    ("ethereum",  "ETH",  "Ethereum",  "crypto"),
    ("solana",    "SOL",  "Solana",    "crypto"),
    ("ripple",    "XRP",  "XRP",       "crypto"),
    ("cardano",   "ADA",  "Cardano",   "crypto"),
    ("chainlink", "LINK", "Chainlink", "crypto"),
]


async def fetch_coingecko(client: httpx.AsyncClient) -> List[Dict]:
    results = []
    try:
        ids  = ",".join(c[0] for c in COINGECKO_COINS)
        url  = (
            f"https://api.coingecko.com/api/v3/simple/price"
            f"?ids={ids}&vs_currencies=usd"
            f"&include_24hr_change=true&include_market_cap=true"
        )
        resp = await client.get(url, timeout=10.0,
                                headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()

        for cg_id, ticker, name, cat in COINGECKO_COINS:
            row = data.get(cg_id, {})
            if not row:
                continue
            price   = float(row.get("usd", 0))
            chg24h  = float(row.get("usd_24h_change", 0))
            # Approximate previous price from 24h change
            prev    = price / (1 + chg24h / 100) if chg24h != -100 else price
            results.append({
                "name":     name,
                "value":    round(price, 6),
                "previous": round(prev, 6),
                "unit":     "USD",
                "category": cat,
                "country":  "Global",
                "change_pct": round(chg24h, 4),
            })
            logger.debug("CoinGecko %s = %s", ticker, price)

    except Exception as e:
        logger.warning("CoinGecko error: %s", e)
    return results


# ── 5. Alpha Vantage — earnings calendar (optional) ───────────────────────────
# Free key at alphavantage.co — 500 req/day

async def fetch_earnings_calendar(client: httpx.AsyncClient, api_key: str) -> List[Dict]:
    """Returns upcoming earnings as macro indicators (informational)."""
    if not api_key:
        return []
    results = []
    try:
        url  = f"https://www.alphavantage.co/query?function=EARNINGS_CALENDAR&horizon=3month&apikey={api_key}"
        resp = await client.get(url, timeout=12.0)
        resp.raise_for_status()
        # Returns CSV
        lines = [l for l in resp.text.strip().split("\n") if "," in l][1:]  # skip header
        count = 0
        for line in lines[:10]:
            parts = line.split(",")
            if len(parts) >= 4:
                symbol = parts[0].strip()
                date   = parts[2].strip()
                eps    = parts[3].strip()
                try:
                    eps_val = float(eps)
                    results.append({
                        "name":     f"{symbol} Earnings ({date})",
                        "value":    eps_val,
                        "previous": eps_val,
                        "unit":     "EPS est.",
                        "category": "earnings",
                        "country":  "US",
                    })
                    count += 1
                except ValueError:
                    pass
        logger.info("Alpha Vantage: %d upcoming earnings loaded", count)
    except Exception as e:
        logger.warning("Alpha Vantage earnings error: %s", e)
    return results


# ── MAIN ENTRY POINT ──────────────────────────────────────────────────────────

async def fetch_all_macro(fred_key: str = "", av_key: str = "") -> List[Dict]:
    """
    Fetch live macro indicators from all free sources.
    Returns a list of indicator dicts ready to upsert into macro_indicators.
    """
    results = []
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=8.0, read=15.0, write=5.0, pool=5.0),
        follow_redirects=True,
        headers={"User-Agent": "WorldLens/4.0 Intelligence Platform"},
    ) as client:
        # FRED
        fred_data = await fetch_fred(client, fred_key)
        results.extend(fred_data)
        logger.info("FRED: %d indicators fetched", len(fred_data))

        # World Bank
        wb_data = await fetch_worldbank(client)
        results.extend(wb_data)
        logger.info("World Bank: %d indicators fetched", len(wb_data))

        # ECB
        ecb_data = await fetch_ecb(client)
        results.extend(ecb_data)
        logger.info("ECB: %d indicators fetched", len(ecb_data))

        # CoinGecko
        cg_data = await fetch_coingecko(client)
        results.extend(cg_data)
        logger.info("CoinGecko: %d crypto prices fetched", len(cg_data))

        # Alpha Vantage (optional)
        if av_key:
            av_data = await fetch_earnings_calendar(client, av_key)
            results.extend(av_data)

    logger.info("Total macro indicators fetched: %d", len(results))
    return results
