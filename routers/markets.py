"""World Lens — Advanced Markets Analysis Router"""
from __future__ import annotations
import json
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from fastapi import APIRouter, Query, Body
from fastapi.responses import JSONResponse
from config import settings
from ai_layer import _call_claude, _parse_json, _ai_available

router = APIRouter(prefix="/api/markets", tags=["markets"])
logger = logging.getLogger(__name__)

# ── Extended asset universe ───────────────────────────
EXTENDED_ASSETS = {
    # Indices
    "^GSPC":  ("S&P 500",     "index",     "US",  ["rates","inflation","earnings","geopolitics"]),
    "^IXIC":  ("Nasdaq",      "index",     "US",  ["tech","rates","ai","earnings"]),
    "^DJI":   ("Dow Jones",   "index",     "US",  ["earnings","rates","macro"]),
    "^FTSE":  ("FTSE 100",    "index",     "UK",  ["UK economy","Brexit","rates"]),
    "^DAX":   ("DAX",         "index",     "DE",  ["Europe","energy","rates"]),
    "^N225":  ("Nikkei 225",  "index",     "JP",  ["BoJ","JPY","exports"]),
    "^VIX":   ("VIX",         "index",     "US",  ["fear","volatility","risk"]),
    "^HSI":   ("Hang Seng",   "index",     "HK",  ["China","geopolitics","property"]),
    # Commodities
    "GC=F":   ("Gold",        "commodity", "Global", ["inflation","USD","rates","geopolitics"]),
    "CL=F":   ("Crude Oil",   "commodity", "Global", ["OPEC","supply","geopolitics","USD"]),
    "NG=F":   ("Natural Gas", "commodity", "Global", ["winter","supply","Europe","LNG"]),
    "SI=F":   ("Silver",      "commodity", "Global", ["industrial","inflation","USD"]),
    "HG=F":   ("Copper",      "commodity", "Global", ["China","industry","EV","growth"]),
    "ZW=F":   ("Wheat",       "commodity", "Global", ["Ukraine","weather","food"]),
    # Forex
    "EURUSD=X":("EUR/USD",    "forex",     "EU",  ["ECB","Fed","Germany","energy"]),
    "GBPUSD=X":("GBP/USD",    "forex",     "UK",  ["BoE","UK economy","Brexit"]),
    "JPY=X":   ("USD/JPY",    "forex",     "JP",  ["BoJ","carry","rates","risk"]),
    "AUDUSD=X":("AUD/USD",    "forex",     "AU",  ["China","commodities","RBA"]),
    "DX=F":    ("USD Index",  "forex",     "US",  ["Fed","rates","safe-haven"]),
    # Crypto
    "BTC-USD": ("Bitcoin",    "crypto",    "Global", ["adoption","regulation","ETF","halving"]),
    "ETH-USD": ("Ethereum",   "crypto",    "Global", ["DeFi","staking","upgrade"]),
    "SOL-USD": ("Solana",     "crypto",    "Global", ["DeFi","NFT","ecosystem"]),
    # Stocks
    "AAPL":    ("Apple",      "stock",     "US",  ["iPhone","supply chain","China","AI"]),
    "MSFT":    ("Microsoft",  "stock",     "US",  ["cloud","AI","earnings"]),
    "NVDA":    ("NVIDIA",     "stock",     "US",  ["AI","chips","semiconductors"]),
    "TSLA":    ("Tesla",      "stock",     "US",  ["EV","China","rates","Musk"]),
    "XOM":     ("ExxonMobil", "stock",     "US",  ["oil","energy","dividends"]),
    "JPM":     ("JPMorgan",   "stock",     "US",  ["banking","rates","credit"]),
}

# ── Correlation pairs for each asset category ─────────
CORRELATIONS = {
    "index":     ["GC=F","CL=F","^VIX","DX=F","JPY=X"],
    "commodity": ["^GSPC","DX=F","EURUSD=X","^VIX","CL=F"],
    "forex":     ["GC=F","^VIX","CL=F","^GSPC"],
    "crypto":    ["^GSPC","^VIX","DX=F","GC=F"],
    "stock":     ["^GSPC","^IXIC","^VIX","GC=F"],
}

# ── Technical helpers ─────────────────────────────────
def _ema(prices: List[float], period: int) -> List[float]:
    if len(prices) < period:
        return [prices[-1]] * len(prices)
    k = 2 / (period + 1)
    ema = [sum(prices[:period]) / period]
    for p in prices[period:]:
        ema.append(p * k + ema[-1] * (1 - k))
    # Pad front
    pad = [ema[0]] * (period - 1)
    return pad + ema

def _rsi(prices: List[float], period: int = 14) -> float:
    if len(prices) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(prices)):
        d = prices[i] - prices[i-1]
        gains.append(max(d, 0))
        losses.append(max(-d, 0))
    ag = sum(gains[-period:]) / period
    al = sum(losses[-period:]) / period
    if al == 0:
        return 100.0
    rs = ag / al
    return round(100 - 100 / (1 + rs), 1)

def _support_resistance(prices: List[float]) -> Dict:
    if len(prices) < 5:
        cur = prices[-1] if prices else 0
        return {"support": cur * 0.97, "resistance": cur * 1.03}
    mn, mx = min(prices), max(prices)
    rng = mx - mn
    cur = prices[-1]
    # Pivot-based simple S/R
    support    = round(mn + rng * 0.236, 4)
    resistance = round(mn + rng * 0.764, 4)
    return {"support": support, "resistance": resistance,
            "range_low": mn, "range_high": mx,
            "pivot": round((mn + mx + cur) / 3, 4)}

def _volatility(prices: List[float]) -> float:
    if len(prices) < 2:
        return 0.0
    returns = [(prices[i] / prices[i-1] - 1) for i in range(1, len(prices))]
    mean = sum(returns) / len(returns)
    var  = sum((r - mean) ** 2 for r in returns) / len(returns)
    return round((var ** 0.5) * (252 ** 0.5) * 100, 1)  # annualised %

def _trend_signal(prices: List[float]) -> str:
    if len(prices) < 5:
        return "Neutral"
    sma5  = sum(prices[-5:]) / 5
    sma20 = sum(prices[-min(20, len(prices)):]) / min(20, len(prices))
    rsi   = _rsi(prices)
    if sma5 > sma20 * 1.005 and rsi > 55:
        return "Bullish"
    if sma5 < sma20 * 0.995 and rsi < 45:
        return "Bearish"
    return "Neutral"

def _perf(prices: List[float]) -> Dict:
    if not prices:
        return {"d1": 0, "w1": 0, "m1": 0}
    cur = prices[-1]
    return {
        "d1": round((cur / prices[-2] - 1) * 100, 2) if len(prices) >= 2 else 0,
        "w1": round((cur / prices[-min(5, len(prices))] - 1) * 100, 2) if len(prices) >= 5 else 0,
        "m1": round((cur / prices[-min(20, len(prices))] - 1) * 100, 2) if len(prices) >= 20 else 0,
    }

# ── Data fetching ─────────────────────────────────────
async def _fetch_ticker_history(symbol: str, period: str = "3mo") -> Optional[List[float]]:
    """Fetch daily close prices via yfinance."""
    try:
        import yfinance as yf

        def _sync():
            t = yf.Ticker(symbol)
            h = t.history(period=period, interval="1d")
            if h.empty:
                return None
            return [float(x) for x in h["Close"].tolist()]

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _sync)
    except Exception as e:
        logger.debug("Ticker fetch %s: %s", symbol, e)
        return None

async def _fetch_multi_history(symbols: List[str], period: str = "3mo") -> Dict[str, List[float]]:
    tasks = {sym: _fetch_ticker_history(sym, period) for sym in symbols}
    results = {}
    for sym, coro in tasks.items():
        results[sym] = await coro
    return {k: v for k, v in results.items() if v}

# ── AI Guided Analysis ────────────────────────────────
async def _guided_analysis(
    symbol: str, name: str, category: str, region: str,
    prices: List[float], macro_events: List[Dict], macro_indicators: List[Dict]
) -> Dict:
    """Generate the 4-step guided analysis via Claude."""

    perf = _perf(prices)
    rsi_val = _rsi(prices)
    trend = _trend_signal(prices)
    vol = _volatility(prices)
    sr = _support_resistance(prices)
    cur = prices[-1] if prices else 0

    # Asset-specific drivers
    meta = EXTENDED_ASSETS.get(symbol, (name, category, region, []))
    drivers = meta[3] if len(meta) > 3 else []

    # Related events (by keyword matching on asset name/drivers)
    related_evs = []
    kw_set = set([name.lower()] + [d.lower() for d in drivers] + [region.lower()])
    for ev in macro_events[:40]:
        text = (ev.get("title","") + " " + (ev.get("summary") or "")).lower()
        if any(kw in text for kw in kw_set):
            related_evs.append(ev)
        if len(related_evs) >= 5:
            break

    # Relevant macro indicators
    rel_inds = []
    ind_kw = {
        "index":     ["rate","inflation","gdp","vix","pmi"],
        "commodity": ["rate","inflation","usd","oil"],
        "forex":     ["rate","inflation","gdp"],
        "crypto":    ["rate","inflation","vix"],
        "stock":     ["rate","inflation","gdp","pmi"],
    }
    kws = ind_kw.get(category, ["rate","inflation"])
    for ind in macro_indicators:
        nm = ind.get("name","").lower()
        if any(k in nm for k in kws):
            rel_inds.append(ind)
        if len(rel_inds) >= 5:
            break

    rule_based = {
        "step1": {
            "trend": trend,
            "rsi": rsi_val,
            "volatility_pct": vol,
            "perf": perf,
            "price": cur,
            "support": sr["support"],
            "resistance": sr["resistance"],
            "summary": (
                name + " is trading at " + str(round(cur,2)) + " with a " + trend.lower() + " trend. "
                + "RSI=" + str(rsi_val) + " (" + ("overbought" if rsi_val>70 else "oversold" if rsi_val<30 else "neutral") + "). "
                + "1-day: " + ("+" if perf["d1"]>=0 else "") + str(perf["d1"]) + "%, "
                + "1-week: " + ("+" if perf["w1"]>=0 else "") + str(perf["w1"]) + "%."
            )
        },
        "step2": {
            "related_events": [{"title": e["title"], "category": e["category"], "severity": e.get("severity",5)} for e in related_evs],
            "macro_drivers": [{"name": i["name"], "value": i["value"], "unit": i["unit"]} for i in rel_inds],
            "key_drivers": drivers,
            "summary": "Key drivers: " + ", ".join(drivers[:4]) + ". " + str(len(related_evs)) + " related global events detected."
        },
        "step3": {
            "bullish": {"scenario": "If macro conditions improve and risk appetite returns, " + name + " could rally.", "probability": "Medium"},
            "bearish": {"scenario": "Rising rates or geopolitical escalation could pressure " + name + " lower.", "probability": "Medium"},
            "neutral": {"scenario": "Consolidation likely until major catalyst emerges.", "probability": "High"},
            "key_catalysts": drivers[:3],
            "summary": "Configure an AI provider in Admin → Settings to enable AI scenarios."
        },
        "step4": {
            "geopolitical_risk": "Monitor " + region + " region for political/military developments.",
            "macro_risk": "Watch central bank policy and inflation data.",
            "volatility_signal": ("HIGH — caution" if vol > 30 else "MODERATE" if vol > 15 else "LOW"),
            "overall_risk": "Medium",
        },
        "fallback": True,
    }

    if not _ai_available():
        return rule_based

    # Build rich prompt for Claude
    ev_text = "\n".join([
        "- " + e.get("title","") + " [" + e.get("category","") + ", sev=" + str(e.get("severity",5)) + "]"
        for e in related_evs[:4]
    ]) or "No directly related events detected"

    ind_text = "\n".join([
        i.get("name","") + ": " + str(i.get("value","")) + " " + i.get("unit","")
        for i in rel_inds[:5]
    ]) or "Standard macro environment"

    prompt = (
        "You are a senior financial analyst. Provide a structured 4-step guided analysis "
        "for " + name + " (" + symbol + "). Respond ONLY with valid JSON, no markdown.\n\n"
        "Current data:\n"
        "- Price: " + str(round(cur,4)) + "\n"
        "- Trend: " + trend + "\n"
        "- RSI: " + str(rsi_val) + "\n"
        "- Volatility (annualised): " + str(vol) + "%\n"
        "- 1D/1W/1M perf: " + str(perf["d1"]) + "% / " + str(perf["w1"]) + "% / " + str(perf["m1"]) + "%\n"
        "- Support: " + str(sr["support"]) + " / Resistance: " + str(sr["resistance"]) + "\n\n"
        "Related global events:\n" + ev_text + "\n\n"
        "Macro indicators:\n" + ind_text + "\n\n"
        "Key drivers for " + name + ": " + ", ".join(drivers) + "\n\n"
        "Return exactly:\n"
        "{\n"
        '  "step1": {\n'
        '    "trend": "' + trend + '",\n'
        '    "rsi": ' + str(rsi_val) + ',\n'
        '    "volatility_pct": ' + str(vol) + ',\n'
        '    "perf": ' + json.dumps(perf) + ',\n'
        '    "price": ' + str(round(cur,4)) + ',\n'
        '    "support": ' + str(sr["support"]) + ',\n'
        '    "resistance": ' + str(sr["resistance"]) + ',\n'
        '    "summary": "2-3 sentences on what is happening now"\n'
        "  },\n"
        '  "step2": {\n'
        '    "related_events": ' + json.dumps([{"title":e["title"],"category":e["category"],"severity":e.get("severity",5)} for e in related_evs]) + ',\n'
        '    "macro_drivers": ' + json.dumps([{"name":i["name"],"value":i["value"],"unit":i["unit"]} for i in rel_inds]) + ',\n'
        '    "key_drivers": ' + json.dumps(drivers) + ',\n'
        '    "summary": "2-3 sentences explaining why the asset is moving"\n'
        "  },\n"
        '  "step3": {\n'
        '    "bullish": {"scenario": "specific bullish scenario with % target", "probability": "Low|Medium|High"},\n'
        '    "bearish": {"scenario": "specific bearish scenario with % target", "probability": "Low|Medium|High"},\n'
        '    "neutral": {"scenario": "specific consolidation scenario", "probability": "Low|Medium|High"},\n'
        '    "key_catalysts": ["catalyst1", "catalyst2", "catalyst3"],\n'
        '    "summary": "2-3 sentences on what could happen next"\n'
        "  },\n"
        '  "step4": {\n'
        '    "geopolitical_risk": "specific geopolitical risk for this asset",\n'
        '    "macro_risk": "specific macro risk (rates/inflation/growth)",\n'
        '    "volatility_signal": "LOW|MODERATE|HIGH — explanation",\n'
        '    "overall_risk": "Low|Medium|High|Critical",\n'
        '    "summary": "2-3 sentences on key risk factors to watch"\n'
        "  }\n"
        "}"
    )

    text = await _call_claude(prompt, max_tokens=900)
    result = _parse_json(text)
    if result and "step1" in result:
        # Ensure numeric fields are preserved
        result["step1"]["perf"]       = perf
        result["step1"]["price"]      = cur
        result["step1"]["support"]    = sr["support"]
        result["step1"]["resistance"] = sr["resistance"]
        result["step1"]["rsi"]        = rsi_val
        result["step1"]["volatility_pct"] = vol
        result["step1"]["trend"]      = trend
        result["fallback"] = False
        return result

    return rule_based

# ── Endpoints ─────────────────────────────────────────

@router.get("/universe")
async def get_universe():
    """Return extended asset universe with metadata."""
    assets = []
    for sym, (name, cat, region, drivers) in EXTENDED_ASSETS.items():
        assets.append({"symbol": sym, "name": name, "category": cat, "region": region, "drivers": drivers})
    return {"assets": assets}


@router.get("/ticker/{symbol}")
async def get_ticker_data(symbol: str, period: str = Query("3mo")):
    """Deep ticker data: OHLC history, technicals, performance."""
    sym = symbol.upper()

    # Try to get from yfinance
    prices = await _fetch_ticker_history(sym, period)

    # Fallback: use cached data from scheduler
    if not prices:
        from scheduler import get_finance_cache
        cached = {a["symbol"]: a for a in get_finance_cache()}
        if sym in cached:
            prices = cached[sym].get("history", [])

    if not prices or len(prices) < 2:
        # Generate plausible mock
        meta = EXTENDED_ASSETS.get(sym)
        base_prices = {
            "^GSPC":5200,"^IXIC":16400,"^DJI":39100,"GC=F":2350,
            "CL=F":78.5,"BTC-USD":67000,"EURUSD=X":1.085
        }
        base = base_prices.get(sym, 100.0)
        import random, math
        prices = []
        p = base
        for i in range(60):
            p *= (1 + random.gauss(0.0002, 0.012))
            prices.append(round(p, 4))

    cur = prices[-1]
    perf = _perf(prices)
    rsi_val = _rsi(prices)
    vol = _volatility(prices)
    trend = _trend_signal(prices)
    sr = _support_resistance(prices)

    # Moving averages
    sma20  = round(sum(prices[-min(20,len(prices)):]) / min(20,len(prices)), 4)
    sma50  = round(sum(prices[-min(50,len(prices)):]) / min(50,len(prices)), 4)
    sma200 = round(sum(prices[-min(200,len(prices)):]) / min(200,len(prices)), 4)

    meta = EXTENDED_ASSETS.get(sym, (sym, "unknown", "Global", []))

    return {
        "symbol": sym,
        "name": meta[0],
        "category": meta[1],
        "region": meta[2],
        "drivers": meta[3] if len(meta) > 3 else [],
        "price": cur,
        "prices": prices[-90:],       # up to 90 days for chart
        "prices_full": prices,
        "perf": perf,
        "technicals": {
            "rsi": rsi_val,
            "sma20": sma20,
            "sma50": sma50,
            "sma200": sma200,
            "trend": trend,
            "volatility_pct": vol,
            "support": sr["support"],
            "resistance": sr["resistance"],
            "range_low": sr["range_low"],
            "range_high": sr["range_high"],
            "pivot": sr["pivot"],
        },
    }


@router.get("/correlations/{symbol}")
async def get_correlations(symbol: str):
    """Compute price correlation vs key related assets."""
    sym = symbol.upper()
    meta = EXTENDED_ASSETS.get(sym, (sym, "unknown", "Global", []))
    cat = meta[1]
    peers = CORRELATIONS.get(cat, ["^GSPC","GC=F","^VIX"])
    peers = [p for p in peers if p != sym][:4]

    # Fetch all in parallel
    all_syms = [sym] + peers
    histories = await _fetch_multi_history(all_syms, "3mo")

    if sym not in histories:
        return {"correlations": [], "error": "No data for " + sym}

    base = histories[sym]
    correlations = []
    for peer in peers:
        if peer not in histories:
            continue
        ph = histories[peer]
        # Align lengths
        n = min(len(base), len(ph))
        if n < 10:
            continue
        b = base[-n:]
        p = ph[-n:]
        # Returns
        br = [(b[i]/b[i-1]-1) for i in range(1,n)]
        pr = [(p[i]/p[i-1]-1) for i in range(1,n)]
        # Pearson
        mb = sum(br)/len(br)
        mp = sum(pr)/len(pr)
        num = sum((br[i]-mb)*(pr[i]-mp) for i in range(len(br)))
        db  = (sum((x-mb)**2 for x in br))**0.5
        dp  = (sum((x-mp)**2 for x in pr))**0.5
        corr = round(num/(db*dp) if db*dp > 0 else 0, 2)
        pmeta = EXTENDED_ASSETS.get(peer, (peer,"unknown","Global",[]))
        correlations.append({
            "symbol": peer,
            "name": pmeta[0],
            "category": pmeta[1],
            "correlation": corr,
            "label": "Strong +" if corr>0.7 else "Moderate +" if corr>0.3 else "Strong -" if corr<-0.7 else "Moderate -" if corr<-0.3 else "Weak",
        })
    correlations.sort(key=lambda x: abs(x["correlation"]), reverse=True)
    return {"symbol": sym, "correlations": correlations}


@router.post("/guided-analysis/{symbol}")
async def guided_analysis(symbol: str):
    """Generate 4-step AI guided analysis for a ticker."""
    import aiosqlite
    sym = symbol.upper()

    prices = await _fetch_ticker_history(sym, "3mo")
    if not prices:
        from scheduler import get_finance_cache
        cached = {a["symbol"]: a for a in get_finance_cache()}
        if sym in cached:
            prices = cached[sym].get("history", [])

    if not prices:
        import random
        prices = [100 * (1 + random.gauss(0, 0.01)) for _ in range(60)]

    # Load context
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM events WHERE datetime(timestamp)>datetime('now','-72 hours') "
            "ORDER BY severity DESC LIMIT 50"
        ) as c:
            events = [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT * FROM macro_indicators") as c:
            indicators = [dict(r) for r in await c.fetchall()]

    meta = EXTENDED_ASSETS.get(sym, (sym, "unknown", "Global", []))
    result = await _guided_analysis(
        sym, meta[0], meta[1], meta[2], prices, events, indicators
    )
    return result


@router.get("/trending")
async def get_trending():
    """Return trending / most-searched assets based on recent event correlation."""
    import aiosqlite
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT title, category, country_code FROM events "
            "WHERE datetime(timestamp)>datetime('now','-24 hours') "
            "ORDER BY severity DESC LIMIT 30"
        ) as c:
            events = [dict(r) for r in await c.fetchall()]

    # Score each asset by how many recent events relate to it
    scores = {}
    for sym, (name, cat, region, drivers) in EXTENDED_ASSETS.items():
        kws = set([name.lower(), region.lower()] + [d.lower() for d in drivers])
        score = 0
        for ev in events:
            text = (ev.get("title","") + " " + ev.get("category","")).lower()
            score += sum(1 for kw in kws if kw in text)
        if score > 0:
            scores[sym] = score

    trending = sorted(scores.keys(), key=lambda s: -scores[s])[:8]
    result = []
    for sym in trending:
        meta = EXTENDED_ASSETS[sym]
        result.append({
            "symbol": sym, "name": meta[0], "category": meta[1],
            "event_score": scores[sym],
        })
    return {"trending": result}
