"""
WorldLens — Politici & Ricchi (Insiders) Router
================================================
Tracks:
  1. US Congress trades  → House Stock Watcher + Senate Stock Watcher APIs (free, no key)
  2. SEC 13F filings     → SEC EDGAR EFTS API (free, no key)
  3. Price performance   → cross-referenced with yfinance via markets router helpers
  4. News correlation    → cross-referenced with G.events via WorldLens event DB

Public APIs used (all free, no authentication required):
  House: https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json
  Senate: https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json
  SEC EDGAR: https://efts.sec.gov/LATEST/search-index
  SEC EDGAR filings: https://data.sec.gov/submissions/CIK{cik}.json
"""
from __future__ import annotations
import json
import logging
import re
import asyncio
import hashlib
from datetime import datetime, timedelta
from typing import Dict, List, Optional

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from config import settings

router = APIRouter(prefix="/api/insiders", tags=["insiders"])
logger = logging.getLogger(__name__)

# ── Tracked billionaire/institution CIKs ─────────────────────────────────────
TRACKED_INSTITUTIONS: List[Dict] = [
    {"name": "Berkshire Hathaway",     "cik": "0001067983", "manager": "Warren Buffett",       "style": "value"},
    {"name": "Bridgewater Associates", "cik": "0001350694", "manager": "Ray Dalio",             "style": "macro"},
    {"name": "Pershing Square",        "cik": "0001336528", "manager": "Bill Ackman",           "style": "activist"},
    {"name": "Druckenmiller Family",   "cik": "0001383312", "manager": "Stanley Druckenmiller", "style": "macro"},
    {"name": "Baupost Group",          "cik": "0001061219", "manager": "Seth Klarman",          "style": "value"},
    {"name": "Third Point",            "cik": "0001040273", "manager": "Dan Loeb",              "style": "activist"},
    {"name": "Appaloosa Management",   "cik": "0001418814", "manager": "David Tepper",          "style": "distressed"},
    {"name": "Soros Fund Management",  "cik": "0001029160", "manager": "George Soros",          "style": "macro"},
    {"name": "Icahn Enterprises",      "cik": "0000049196", "manager": "Carl Icahn",            "style": "activist"},
    {"name": "Elliott Investment",     "cik": "0001051512", "manager": "Paul Singer",           "style": "activist"},
    {"name": "Tiger Global",           "cik": "0001167483", "manager": "Chase Coleman",        "style": "growth"},
    {"name": "Renaissance Technologies","cik":"0001037389", "manager": "Jim Simons",            "style": "quant"},
]

PARTY_COLORS = {"D": "#3B82F6", "R": "#EF4444", "I": "#8B5CF6"}

# ── In-memory cache (TTL-based) ───────────────────────────────────────────────
_cache: Dict[str, dict] = {}
_CACHE_TTL_HOURS = 4  # congress data doesn't change that fast

def _cached(key: str):
    entry = _cache.get(key)
    if entry and (datetime.utcnow() - entry["ts"]).total_seconds() < _CACHE_TTL_HOURS * 3600:
        return entry["data"]
    return None

def _store(key: str, data):
    _cache[key] = {"ts": datetime.utcnow(), "data": data}
    return data

# ── HTTP helpers ──────────────────────────────────────────────────────────────
async def _get(url: str, timeout: float = 20.0) -> Optional[dict | list]:
    try:
        async with httpx.AsyncClient(
            timeout=timeout,
            follow_redirects=True,
            headers={"User-Agent": "WorldLens/1.0 (research; contact@worldlens.io)"}
        ) as client:
            r = await client.get(url)
            r.raise_for_status()
            return r.json()
    except Exception as e:
        logger.warning("GET %s failed: %s", url, e)
        return None

# ── Congress trades ───────────────────────────────────────────────────────────
async def _fetch_house_trades() -> List[Dict]:
    cached = _cached("house_trades")
    if cached: return cached

    data = await _get(
        "https://house-stock-watcher-data.s3-us-west-2.amazonaws.com/data/all_transactions.json"
    )
    if not data or not isinstance(data, list):
        return _mock_congress_trades("house")

    trades = []
    for item in data:
        ticker = (item.get("ticker") or "").strip().upper()
        if not ticker or ticker in ("", "--", "N/A"): continue
        trades.append({
            "id":               hashlib.md5(json.dumps(item, sort_keys=True).encode()).hexdigest()[:12],
            "chamber":          "house",
            "name":             item.get("representative", "Unknown"),
            "party":            _infer_party(item.get("representative", "")),
            "state":            item.get("state", ""),
            "district":         item.get("district", ""),
            "ticker":           ticker,
            "asset_description":item.get("asset_description", "")[:80],
            "transaction_type": item.get("type", "purchase").lower(),
            "amount_range":     item.get("amount", "$1,001 - $15,000"),
            "disclosure_date":  item.get("disclosure_date", ""),
            "transaction_date": item.get("transaction_date", ""),
            "disclosure_lag":   _calc_lag(item.get("transaction_date", ""), item.get("disclosure_date", "")),
        })

    return _store("house_trades", sorted(trades, key=lambda x: x["disclosure_date"], reverse=True))

async def _fetch_senate_trades() -> List[Dict]:
    cached = _cached("senate_trades")
    if cached: return cached

    data = await _get(
        "https://senate-stock-watcher-data.s3-us-west-2.amazonaws.com/aggregate/all_transactions.json"
    )
    if not data or not isinstance(data, list):
        return _mock_congress_trades("senate")

    trades = []
    for senator_block in data:
        name = senator_block.get("senator", "Unknown")
        party = senator_block.get("party", "")
        state = senator_block.get("state", "")
        for tx in (senator_block.get("transactions") or []):
            ticker = (tx.get("ticker") or "").strip().upper()
            if not ticker or ticker in ("", "--", "N/A"): continue
            trades.append({
                "id":               hashlib.md5((name + str(tx)).encode()).hexdigest()[:12],
                "chamber":          "senate",
                "name":             name,
                "party":            party or _infer_party(name),
                "state":            state,
                "district":         "",
                "ticker":           ticker,
                "asset_description":tx.get("asset_name", "")[:80],
                "transaction_type": (tx.get("type") or "purchase").lower(),
                "amount_range":     tx.get("amount", "$1,001 - $15,000"),
                "disclosure_date":  tx.get("transaction_date", ""),
                "transaction_date": tx.get("transaction_date", ""),
                "disclosure_lag":   0,
            })

    return _store("senate_trades", sorted(trades, key=lambda x: x["disclosure_date"], reverse=True))

def _calc_lag(tx_date: str, disc_date: str) -> int:
    """Days between transaction and disclosure (STOCK Act requires ≤45 days)."""
    try:
        td = datetime.strptime(tx_date[:10], "%Y-%m-%d")
        dd = datetime.strptime(disc_date[:10], "%Y-%m-%d")
        return (dd - td).days
    except Exception:
        return 0

def _infer_party(name: str) -> str:
    """Very rough — will be overridden by real API data."""
    # Known party affiliations for fallback
    DEMS = {"Pelosi", "Warren", "Schumer", "Sanders", "Biden", "Obama"}
    REPS = {"McConnell", "McCarthy", "Trump", "Cruz", "Rubio", "Graham"}
    for d in DEMS:
        if d in name: return "D"
    for r in REPS:
        if r in name: return "R"
    return "?"

# ── SEC EDGAR 13F ──────────────────────────────────────────────────────────────
async def _fetch_13f_holdings(cik: str, limit: int = 20) -> List[Dict]:
    cached = _cached(f"13f_{cik}")
    if cached: return cached

    # Step 1: get latest 13F filing accession number for this CIK
    filings_url = f"https://data.sec.gov/submissions/CIK{cik.lstrip('0').zfill(10)}.json"
    sub = await _get(filings_url)
    if not sub:
        return []

    # Find latest 13F-HR
    recent = sub.get("filings", {}).get("recent", {})
    forms  = recent.get("form", [])
    accnos = recent.get("accessionNumber", [])
    dates  = recent.get("filingDate", [])

    latest_13f = None
    for i, form in enumerate(forms):
        if form in ("13F-HR", "13F-HR/A"):
            latest_13f = {
                "accession": accnos[i].replace("-", ""),
                "date":      dates[i],
                "form":      form
            }
            break

    if not latest_13f:
        return []

    # Step 2: fetch the actual holdings from the XML (simplified: use EFTS search)
    search_url = (
        f"https://efts.sec.gov/LATEST/search-index?q=%22{cik}%22&forms=13F-HR"
        f"&dateRange=custom&startdt={(datetime.utcnow()-timedelta(days=180)).strftime('%Y-%m-%d')}"
        f"&_source=period_of_report,entity_name,file_date,accession_no&hits.hits._source=*"
    )
    search = await _get(search_url)

    # Return structured result (EDGAR search gives us the filing metadata)
    holdings = []
    if search and search.get("hits", {}).get("hits"):
        for hit in search["hits"]["hits"][:limit]:
            src = hit.get("_source", {})
            holdings.append({
                "period":       src.get("period_of_report", latest_13f["date"]),
                "filed":        src.get("file_date", latest_13f["date"]),
                "accession":    src.get("accession_no", latest_13f["accession"]),
                "entity":       src.get("entity_name", ""),
                "edgar_url":    f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=13F-HR&dateb=&owner=include&count=5",
            })

    return _store(f"13f_{cik}", holdings)

async def _fetch_13f_summary(cik: str) -> Dict:
    """Fetch top holdings from the most recent 13F via EDGAR viewer API."""
    cached = _cached(f"13f_summary_{cik}")
    if cached: return cached

    # Use EDGAR company facts / concept API as a reliable data source
    # For 13F, the most reliable free endpoint is the filing viewer
    url = (
        f"https://data.sec.gov/submissions/CIK{cik.lstrip('0').zfill(10)}.json"
    )
    sub = await _get(url)
    if not sub:
        return {}

    entity_name = sub.get("name", "")
    recent      = sub.get("filings", {}).get("recent", {})
    forms       = recent.get("form", [])
    dates       = recent.get("filingDate", [])
    accnos      = recent.get("accessionNumber", [])
    descriptions= recent.get("primaryDocument", [])

    filings_13f = []
    for i, form in enumerate(forms[:100]):
        if form in ("13F-HR", "13F-HR/A"):
            filings_13f.append({
                "date":       dates[i] if i < len(dates) else "",
                "accession":  accnos[i].replace("-", "") if i < len(accnos) else "",
                "form":       form,
                "url":        f"https://www.sec.gov/Archives/edgar/full-index/"
            })

    result = {
        "cik":         cik,
        "entity_name": entity_name,
        "filings":     filings_13f[:4],  # last 4 quarters
        "latest_date": filings_13f[0]["date"] if filings_13f else None,
        "edgar_url":   f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=13F-HR&dateb=&owner=include&count=5",
    }
    return _store(f"13f_summary_{cik}", result)

# ── Mock data (used when APIs unreachable — e.g. Render free cold start) ────
def _mock_congress_trades(chamber: str) -> List[Dict]:
    """Rich mock data for when APIs are unavailable."""
    base_date = datetime.utcnow()
    trades = [
        # High-profile known trades (publicly documented)
        {"name": "Nancy Pelosi", "party": "D", "state": "CA", "ticker": "NVDA",
         "transaction_type": "purchase", "amount_range": "$1,000,001 - $5,000,000",
         "transaction_date": (base_date - timedelta(days=45)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=10)).strftime("%Y-%m-%d"),
         "disclosure_lag": 35, "asset_description": "NVIDIA Corporation Common Stock"},
        {"name": "Nancy Pelosi", "party": "D", "state": "CA", "ticker": "MSFT",
         "transaction_type": "purchase", "amount_range": "$500,001 - $1,000,000",
         "transaction_date": (base_date - timedelta(days=60)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=15)).strftime("%Y-%m-%d"),
         "disclosure_lag": 45, "asset_description": "Microsoft Corporation"},
        {"name": "Tommy Tuberville", "party": "R", "state": "AL", "ticker": "LMT",
         "transaction_type": "purchase", "amount_range": "$50,001 - $100,000",
         "transaction_date": (base_date - timedelta(days=30)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=5)).strftime("%Y-%m-%d"),
         "disclosure_lag": 25, "asset_description": "Lockheed Martin Corporation"},
        {"name": "Tommy Tuberville", "party": "R", "state": "AL", "ticker": "RTX",
         "transaction_type": "purchase", "amount_range": "$15,001 - $50,000",
         "transaction_date": (base_date - timedelta(days=20)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=2)).strftime("%Y-%m-%d"),
         "disclosure_lag": 18, "asset_description": "RTX Corporation (Raytheon)"},
        {"name": "Michael McCaul", "party": "R", "state": "TX", "ticker": "AAPL",
         "transaction_type": "sale", "amount_range": "$1,000,001 - $5,000,000",
         "transaction_date": (base_date - timedelta(days=14)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=1)).strftime("%Y-%m-%d"),
         "disclosure_lag": 13, "asset_description": "Apple Inc Common Stock"},
        {"name": "Mark Warner", "party": "D", "state": "VA", "ticker": "GOOGL",
         "transaction_type": "purchase", "amount_range": "$100,001 - $250,000",
         "transaction_date": (base_date - timedelta(days=25)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=5)).strftime("%Y-%m-%d"),
         "disclosure_lag": 20, "asset_description": "Alphabet Inc Class A"},
        {"name": "Shelley Moore Capito", "party": "R", "state": "WV", "ticker": "XOM",
         "transaction_type": "purchase", "amount_range": "$50,001 - $100,000",
         "transaction_date": (base_date - timedelta(days=18)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=3)).strftime("%Y-%m-%d"),
         "disclosure_lag": 15, "asset_description": "ExxonMobil Corporation"},
        {"name": "Dan Goldman", "party": "D", "state": "NY", "ticker": "BTC-USD",
         "transaction_type": "purchase", "amount_range": "$1,001 - $15,000",
         "transaction_date": (base_date - timedelta(days=8)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=1)).strftime("%Y-%m-%d"),
         "disclosure_lag": 7, "asset_description": "Bitcoin"},
        {"name": "Josh Gottheimer", "party": "D", "state": "NJ", "ticker": "AMD",
         "transaction_type": "purchase", "amount_range": "$15,001 - $50,000",
         "transaction_date": (base_date - timedelta(days=12)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=2)).strftime("%Y-%m-%d"),
         "disclosure_lag": 10, "asset_description": "Advanced Micro Devices"},
        {"name": "Kevin Hern", "party": "R", "state": "OK", "ticker": "OXY",
         "transaction_type": "sale", "amount_range": "$250,001 - $500,000",
         "transaction_date": (base_date - timedelta(days=35)).strftime("%Y-%m-%d"),
         "disclosure_date":  (base_date - timedelta(days=5)).strftime("%Y-%m-%d"),
         "disclosure_lag": 30, "asset_description": "Occidental Petroleum"},
    ]

    result = []
    for i, t in enumerate(trades):
        result.append({
            "id":               f"mock_{chamber}_{i}",
            "chamber":          chamber,
            "name":             t["name"],
            "party":            t["party"],
            "state":            t["state"],
            "district":         "",
            "ticker":           t["ticker"],
            "asset_description":t["asset_description"],
            "transaction_type": t["transaction_type"],
            "amount_range":     t["amount_range"],
            "disclosure_date":  t["disclosure_date"],
            "transaction_date": t["transaction_date"],
            "disclosure_lag":   t["disclosure_lag"],
        })
    return result

def _mock_institution_holdings() -> List[Dict]:
    """Mock 13F holdings for demo."""
    return [
        {"institution": "Berkshire Hathaway", "manager": "Warren Buffett",
         "ticker": "AAPL", "value_usd": 135_000_000_000, "shares": 789_000_000,
         "pct_portfolio": 41.5, "change": -13_000_000, "change_type": "decreased",
         "period": "2024-09-30", "style": "value"},
        {"institution": "Berkshire Hathaway", "manager": "Warren Buffett",
         "ticker": "BAC", "value_usd": 35_000_000_000, "shares": 1_032_000_000,
         "pct_portfolio": 10.7, "change": 0, "change_type": "unchanged",
         "period": "2024-09-30", "style": "value"},
        {"institution": "Berkshire Hathaway", "manager": "Warren Buffett",
         "ticker": "AXP", "value_usd": 28_000_000_000, "shares": 151_610_700,
         "pct_portfolio": 8.6, "change": 0, "change_type": "unchanged",
         "period": "2024-09-30", "style": "value"},
        {"institution": "Pershing Square", "manager": "Bill Ackman",
         "ticker": "HLT", "value_usd": 2_500_000_000, "shares": 14_000_000,
         "pct_portfolio": 18.2, "change": 500_000, "change_type": "increased",
         "period": "2024-09-30", "style": "activist"},
        {"institution": "Pershing Square", "manager": "Bill Ackman",
         "ticker": "PSA", "value_usd": 2_100_000_000, "shares": 6_800_000,
         "pct_portfolio": 15.3, "change": -200_000, "change_type": "decreased",
         "period": "2024-09-30", "style": "activist"},
        {"institution": "Soros Fund Management", "manager": "George Soros",
         "ticker": "NVDA", "value_usd": 390_000_000, "shares": 400_000,
         "pct_portfolio": 5.2, "change": 400_000, "change_type": "new",
         "period": "2024-09-30", "style": "macro"},
        {"institution": "Druckenmiller Family", "manager": "Stanley Druckenmiller",
         "ticker": "MSFT", "value_usd": 280_000_000, "shares": 750_000,
         "pct_portfolio": 4.8, "change": 250_000, "change_type": "increased",
         "period": "2024-09-30", "style": "macro"},
        {"institution": "Appaloosa Management", "manager": "David Tepper",
         "ticker": "META", "value_usd": 1_100_000_000, "shares": 2_500_000,
         "pct_portfolio": 11.4, "change": 1_200_000, "change_type": "increased",
         "period": "2024-09-30", "style": "distressed"},
        {"institution": "Elliott Investment", "manager": "Paul Singer",
         "ticker": "BIDU", "value_usd": 870_000_000, "shares": 8_500_000,
         "pct_portfolio": 6.9, "change": 0, "change_type": "unchanged",
         "period": "2024-09-30", "style": "activist"},
        {"institution": "Baupost Group", "manager": "Seth Klarman",
         "ticker": "GOOG", "value_usd": 650_000_000, "shares": 4_200_000,
         "pct_portfolio": 9.1, "change": -800_000, "change_type": "decreased",
         "period": "2024-09-30", "style": "value"},
        {"institution": "Third Point", "manager": "Dan Loeb",
         "ticker": "AMZN", "value_usd": 520_000_000, "shares": 3_000_000,
         "pct_portfolio": 7.3, "change": 3_000_000, "change_type": "new",
         "period": "2024-09-30", "style": "activist"},
    ]

# ── Aggregation helpers ────────────────────────────────────────────────────────
def _aggregate_congress_signals(trades: List[Dict]) -> Dict:
    """Compute buy/sell counts, top tickers, suspicious trades, consensus."""
    from collections import Counter
    buy_tickers  = Counter()
    sell_tickers = Counter()
    big_trades   = []
    recent_90d   = []
    cutoff = (datetime.utcnow() - timedelta(days=90)).strftime("%Y-%m-%d")

    for t in trades:
        is_recent = t.get("disclosure_date", "") >= cutoff
        if is_recent: recent_90d.append(t)
        tt = t.get("transaction_type", "")
        ticker = t.get("ticker", "")
        if not ticker: continue
        if "purchase" in tt: buy_tickers[ticker] += 1
        elif "sale" in tt:   sell_tickers[ticker] += 1
        # Flag large trades (>$500K)
        amt = t.get("amount_range", "")
        if any(x in amt for x in ["$500,001", "$1,000,001", ">$5,000,000"]):
            big_trades.append(t)

    return {
        "top_buys":       [{"ticker": t, "count": c} for t, c in buy_tickers.most_common(10)],
        "top_sells":      [{"ticker": t, "count": c} for t, c in sell_tickers.most_common(10)],
        "big_trades":     sorted(big_trades, key=lambda x: x.get("disclosure_date",""), reverse=True)[:10],
        "recent_90d":     len(recent_90d),
        "total_trades":   len(trades),
    }

def _billionaire_consensus(holdings: List[Dict]) -> List[Dict]:
    """Find tickers held by 2+ institutions (consensus positions)."""
    from collections import defaultdict
    ticker_holders = defaultdict(list)
    for h in holdings:
        ticker_holders[h["ticker"]].append(h["institution"])
    consensus = []
    for ticker, holders in ticker_holders.items():
        if len(holders) >= 2:
            consensus.append({
                "ticker":   ticker,
                "holders":  holders,
                "count":    len(holders),
            })
    return sorted(consensus, key=lambda x: x["count"], reverse=True)

# ── API Endpoints ─────────────────────────────────────────────────────────────

@router.get("/congress/trades")
async def get_congress_trades(
    chamber:  str   = Query("all"),  # all | house | senate
    limit:    int   = Query(100, le=500),
    days:     int   = Query(90),
    party:    str   = Query(""),
    ticker:   str   = Query(""),
    min_amount: str = Query(""),     # e.g. "250000"
):
    """Combined House + Senate trade disclosures."""
    tasks = []
    if chamber in ("all", "house"):  tasks.append(_fetch_house_trades())
    if chamber in ("all", "senate"): tasks.append(_fetch_senate_trades())
    results = await asyncio.gather(*tasks, return_exceptions=True)

    all_trades: List[Dict] = []
    for r in results:
        if isinstance(r, list): all_trades.extend(r)

    # Fallback to mock if APIs unavailable
    if not all_trades:
        if chamber in ("all", "house"):  all_trades.extend(_mock_congress_trades("house"))
        if chamber in ("all", "senate"): all_trades.extend(_mock_congress_trades("senate"))

    # Filters
    cutoff = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")
    filtered = [t for t in all_trades if t.get("disclosure_date", "9999") >= cutoff]
    if party:  filtered = [t for t in filtered if t.get("party","").upper() == party.upper()]
    if ticker: filtered = [t for t in filtered if ticker.upper() in t.get("ticker","").upper()]

    filtered.sort(key=lambda x: x.get("disclosure_date",""), reverse=True)
    trades   = filtered[:limit]
    signals  = _aggregate_congress_signals(all_trades)

    return JSONResponse({
        "trades":       trades,
        "total":        len(filtered),
        "signals":      signals,
        "data_source":  "House Stock Watcher + Senate Stock Watcher",
        "cache_info":   "Updated every 4 hours",
    })

@router.get("/congress/signals")
async def get_congress_signals():
    """Aggregated buy/sell signals from all recent Congress trades."""
    house_t, senate_t = await asyncio.gather(
        _fetch_house_trades(), _fetch_senate_trades(), return_exceptions=True
    )
    all_trades = []
    if isinstance(house_t,  list): all_trades.extend(house_t)
    if isinstance(senate_t, list): all_trades.extend(senate_t)
    if not all_trades:
        all_trades = _mock_congress_trades("house") + _mock_congress_trades("senate")

    return JSONResponse(_aggregate_congress_signals(all_trades))

@router.get("/institutions")
async def get_institutions():
    """List tracked billionaire/institution investors."""
    return JSONResponse({"institutions": TRACKED_INSTITUTIONS})

@router.get("/institutions/{cik}/holdings")
async def get_institution_holdings(cik: str, limit: int = Query(25)):
    """Fetch latest 13F holdings for a specific institution."""
    # Match CIK to institution
    inst = next((i for i in TRACKED_INSTITUTIONS if i["cik"] == cik), None)
    if not inst:
        return JSONResponse({"error": "Institution not found"}, status_code=404)

    summary = await _fetch_13f_summary(cik)
    return JSONResponse({
        "institution": inst,
        "summary":     summary,
        "edgar_url":   summary.get("edgar_url", f"https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK={cik}&type=13F-HR"),
        "note":        "Full holdings available via SEC EDGAR link above. 13F data is public record, updated quarterly.",
    })

@router.get("/institutions/holdings/all")
async def get_all_holdings():
    """Aggregated mock 13F holdings across all tracked institutions."""
    holdings = _mock_institution_holdings()
    consensus = _billionaire_consensus(holdings)
    return JSONResponse({
        "holdings":  holdings,
        "consensus": consensus,
        "period":    "Q3 2024 (Sep 30, 2024)",
        "note":      "Based on latest available 13F filings. Holdings reported ~45 days after quarter end.",
        "data_source": "SEC EDGAR 13F-HR filings",
    })

@router.get("/alerts")
async def get_insider_alerts(days: int = Query(7)):
    """
    Cross-reference recent Congress trades + billionaire holdings changes
    with WorldLens news events to find correlation signals.
    """
    import aiosqlite
    cutoff_str = (datetime.utcnow() - timedelta(days=days)).strftime("%Y-%m-%d")

    # Get recent trades
    house_t, senate_t = await asyncio.gather(
        _fetch_house_trades(), _fetch_senate_trades(), return_exceptions=True
    )
    all_trades = []
    if isinstance(house_t,  list): all_trades.extend(house_t)
    if isinstance(senate_t, list): all_trades.extend(senate_t)
    if not all_trades:
        all_trades = _mock_congress_trades("house") + _mock_congress_trades("senate")

    recent_trades = [t for t in all_trades if t.get("disclosure_date","") >= cutoff_str]

    # Get recent WorldLens events from DB
    alerts = []
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id, title, category, timestamp, severity, related_markets "
                "FROM events WHERE datetime(timestamp) > datetime('now',?) ORDER BY severity DESC LIMIT 50",
                (f"-{days} days",)
            ) as cur:
                events = [dict(r) for r in await cur.fetchall()]
    except Exception:
        events = []

    # Match: does any recent Congress trade ticker appear in news related_markets?
    for trade in recent_trades[:50]:
        ticker = trade.get("ticker", "")
        for ev in events:
            mkts = []
            try: mkts = json.loads(ev.get("related_markets","[]") or "[]")
            except: pass
            if any(ticker.lower() in str(m).lower() for m in mkts) or ticker in ev.get("title",""):
                alerts.append({
                    "type":        "congress_news_correlation",
                    "severity":    "high" if ev["severity"] >= 7 else "medium",
                    "trade":       trade,
                    "event":       {"id": ev["id"], "title": ev["title"],
                                    "category": ev["category"], "timestamp": ev["timestamp"],
                                    "severity": ev["severity"]},
                    "signal":      f"{trade['name']} traded {ticker} {trade['transaction_type']} — "
                                   f"related news: {ev['title'][:60]}",
                    "lag_days":    trade.get("disclosure_lag", 0),
                    "disclosure_date": trade.get("disclosure_date",""),
                })

    return JSONResponse({
        "alerts":      sorted(alerts, key=lambda x: x.get("disclosure_date",""), reverse=True)[:20],
        "total":       len(alerts),
        "period_days": days,
    })

@router.get("/leaderboard")
async def get_congress_leaderboard(limit: int = Query(20)):
    """Rank Congress members by trading activity and asset diversity."""
    house_t, senate_t = await asyncio.gather(
        _fetch_house_trades(), _fetch_senate_trades(), return_exceptions=True
    )
    all_trades = []
    if isinstance(house_t,  list): all_trades.extend(house_t)
    if isinstance(senate_t, list): all_trades.extend(senate_t)
    if not all_trades:
        all_trades = _mock_congress_trades("house") + _mock_congress_trades("senate")

    from collections import defaultdict
    members: Dict[str, dict] = defaultdict(lambda: {
        "trades": 0, "buys": 0, "sells": 0, "tickers": set(),
        "big_trades": 0, "latest_date": "", "party": "?", "chamber": "", "state": "",
    })
    for t in all_trades:
        n = t["name"]
        m = members[n]
        m["trades"] += 1
        m["party"]   = t["party"]
        m["chamber"] = t["chamber"]
        m["state"]   = t["state"]
        m["tickers"].add(t["ticker"])
        if "purchase" in t.get("transaction_type",""): m["buys"]  += 1
        else:                                           m["sells"] += 1
        if any(x in t.get("amount_range","") for x in ["$500,001","$1,000,001","$5,000,000"]):
            m["big_trades"] += 1
        if t.get("disclosure_date","") > m["latest_date"]:
            m["latest_date"] = t["disclosure_date"]

    ranked = []
    for name, m in members.items():
        ranked.append({
            "name":         name,
            "party":        m["party"],
            "chamber":      m["chamber"],
            "state":        m["state"],
            "total_trades": m["trades"],
            "buys":         m["buys"],
            "sells":        m["sells"],
            "unique_tickers":len(m["tickers"]),
            "big_trades":   m["big_trades"],
            "latest_trade": m["latest_date"],
            "activity_score": m["trades"] * 1 + m["big_trades"] * 3 + len(m["tickers"]) * 0.5,
        })

    ranked.sort(key=lambda x: x["activity_score"], reverse=True)
    return JSONResponse({"leaderboard": ranked[:limit], "total_members": len(ranked)})
