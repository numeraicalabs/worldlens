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
# ISIN → yfinance symbol mapping (for ISIN search)
ISIN_MAP: Dict[str, str] = {
    "US0378331005": "AAPL",  "US5949181045": "MSFT",  "US67066G1040": "NVDA",
    "US88160R1014": "TSLA",  "US4592001014": "IBM",   "US0231351067": "AMZN",
    "US02079K3059": "GOOGL", "US30303M1027": "META",  "US46625H1005": "JPM",
    "US38141G1040": "GS",    "US9311421039": "WMT",   "US4781601046": "JNJ",
    "GB0031348658": "BP.L",  "GB00B03MLX29": "SHEL.L","DE0007164600": "SAP",
    "DE0005140008": "DBK.DE","FR0000131104": "BNP.PA","FR0000120271": "TOTF.PA",
    "CH0012221716": "ABB",   "CH0012138605": "NOVN.SW",
    "US0605051046": "BA",    "US3696041033": "GE",    "US2561631068": "DE",
}

EXTENDED_ASSETS = {
    # ── US Indices ──────────────────────────────────────────────────────
    "^GSPC":  ("S&P 500",          "index",     "US",      ["rates","inflation","earnings","geopolitics"]),
    "^IXIC":  ("Nasdaq Composite", "index",     "US",      ["tech","rates","AI","earnings"]),
    "^DJI":   ("Dow Jones",        "index",     "US",      ["earnings","rates","macro"]),
    "^RUT":   ("Russell 2000",     "index",     "US",      ["small cap","rates","domestic"]),
    "^VIX":   ("VIX Fear Index",   "index",     "US",      ["fear","volatility","risk","hedging"]),
    "^SP500TR":("S&P 500 TR",      "index",     "US",      ["total return","dividends"]),
    # ── European Indices ────────────────────────────────────────────────
    "^FTSE":  ("FTSE 100",         "index",     "UK",      ["UK economy","rates","GBP","energy"]),
    "^DAX":   ("DAX 40",           "index",     "DE",      ["Europe","manufacturing","energy","ECB"]),
    "^CAC40": ("CAC 40",           "index",     "FR",      ["France","Europe","luxury","banks"]),
    "^STOXX50E":("Euro Stoxx 50",  "index",     "EU",      ["Eurozone","ECB","macro"]),
    "^IBEX":  ("IBEX 35",          "index",     "ES",      ["Spain","banks","tourism"]),
    # ── Asia-Pacific Indices ────────────────────────────────────────────
    "^N225":  ("Nikkei 225",       "index",     "JP",      ["BoJ","JPY","exports","semiconductors"]),
    "^HSI":   ("Hang Seng",        "index",     "HK",      ["China","geopolitics","tech","property"]),
    "000001.SS":("Shanghai Composite","index",  "CN",      ["China policy","PBOC","growth"]),
    "^AXJO":  ("ASX 200",          "index",     "AU",      ["mining","RBA","China","commodities"]),
    "^NSEI":  ("Nifty 50",         "index",     "IN",      ["India growth","RBI","tech","manufacturing"]),
    "^BVSP":  ("Bovespa",          "index",     "BR",      ["Brazil","commodities","Lula","rates"]),
    # ── US Sector ETFs ──────────────────────────────────────────────────
    "XLF":    ("Financials ETF",   "etf",       "US",      ["banks","rates","credit","Fed"]),
    "XLE":    ("Energy ETF",       "etf",       "US",      ["oil","gas","OPEC","energy transition"]),
    "XLK":    ("Technology ETF",   "etf",       "US",      ["tech","AI","semiconductors","earnings"]),
    "XLV":    ("Healthcare ETF",   "etf",       "US",      ["pharma","biotech","FDA","policy"]),
    "XLI":    ("Industrials ETF",  "etf",       "US",      ["manufacturing","defense","infrastructure"]),
    "XLU":    ("Utilities ETF",    "etf",       "US",      ["rates","dividends","power grid"]),
    "XLB":    ("Materials ETF",    "etf",       "US",      ["metals","chemicals","mining"]),
    "XLRE":   ("Real Estate ETF",  "etf",       "US",      ["rates","mortgage","REITs","housing"]),
    "XLC":    ("Comm Services ETF","etf",       "US",      ["media","telecom","internet"]),
    "IWM":    ("iShares Russell 2000","etf",    "US",      ["small cap","rates","domestic economy"]),
    "EEM":    ("Emerging Markets ETF","etf",    "Global",  ["China","EM","USD","commodities"]),
    "EWJ":    ("iShares Japan ETF","etf",       "JP",      ["BoJ","JPY","Japan","Nikkei"]),
    "GLD":    ("SPDR Gold ETF",    "etf",       "Global",  ["inflation","rates","USD","safe-haven"]),
    "TLT":    ("20yr Treasury ETF","etf",       "US",      ["Fed","rates","inflation","deficit"]),
    "HYG":    ("High Yield Bond ETF","etf",     "US",      ["credit","spreads","default","recession"]),
    "LQD":    ("Corp Bond ETF",    "etf",       "US",      ["IG credit","rates","earnings"]),
    "SHY":    ("1-3yr Treasury ETF","etf",      "US",      ["short rates","Fed","liquidity"]),
    "ARKK":   ("ARK Innovation ETF","etf",      "US",      ["disruptive tech","growth","AI","biotech"]),
    "KWEB":   ("KraneShares China Internet","etf","CN",    ["China tech","regulation","ADR","PBOC"]),
    "VNQ":    ("Vanguard REIT ETF","etf",       "US",      ["real estate","rates","housing","REITs"]),
    # ── Bond / Rate Instruments ─────────────────────────────────────────
    "^TNX":   ("US 10Y Treasury Yield","bond",  "US",      ["Fed","inflation","deficit","rates"]),
    "^TYX":   ("US 30Y Treasury Yield","bond",  "US",      ["long rates","fiscal","inflation"]),
    "^IRX":   ("US 3M T-Bill Yield",  "bond",   "US",      ["Fed funds","liquidity","short rates"]),
    "^FVX":   ("US 5Y Treasury Yield","bond",   "US",      ["breakeven","real rates","Fed"]),
    # ── Commodities ─────────────────────────────────────────────────────
    "GC=F":   ("Gold Futures",     "commodity", "Global",  ["inflation","USD","rates","geopolitics"]),
    "SI=F":   ("Silver Futures",   "commodity", "Global",  ["industrial","inflation","USD","solar"]),
    "CL=F":   ("Crude Oil (WTI)",  "commodity", "Global",  ["OPEC","supply","geopolitics","USD"]),
    "BZ=F":   ("Brent Crude",      "commodity", "Global",  ["OPEC","Europe","sanctions","supply"]),
    "NG=F":   ("Natural Gas",      "commodity", "Global",  ["winter","LNG","Europe","supply"]),
    "HG=F":   ("Copper Futures",   "commodity", "Global",  ["China","EV","infrastructure","growth"]),
    "PA=F":   ("Palladium",        "commodity", "Global",  ["auto","catalysts","Russia","supply"]),
    "PL=F":   ("Platinum",         "commodity", "Global",  ["hydrogen","auto","South Africa"]),
    "ZW=F":   ("Wheat Futures",    "commodity", "Global",  ["Ukraine","weather","food security","Black Sea"]),
    "ZC=F":   ("Corn Futures",     "commodity", "Global",  ["biofuel","weather","food","USD"]),
    "ZS=F":   ("Soybean Futures",  "commodity", "Global",  ["China","weather","Argentina","biofuel"]),
    "CC=F":   ("Cocoa Futures",    "commodity", "Global",  ["West Africa","weather","demand","Ghana"]),
    "KC=F":   ("Coffee Futures",   "commodity", "Global",  ["Brazil","weather","demand","supply"]),
    "CT=F":   ("Cotton Futures",   "commodity", "Global",  ["textiles","India","weather","China"]),
    "SB=F":   ("Sugar Futures",    "commodity", "Global",  ["biofuel","Brazil","weather","India"]),
    # ── Forex ────────────────────────────────────────────────────────────
    "EURUSD=X":("EUR/USD",         "forex",     "EU",      ["ECB","Fed","Germany","energy","parity"]),
    "GBPUSD=X":("GBP/USD",         "forex",     "UK",      ["BoE","UK economy","inflation","Brexit"]),
    "JPY=X":   ("USD/JPY",         "forex",     "JP",      ["BoJ","carry trade","rates","intervention"]),
    "AUDUSD=X":("AUD/USD",         "forex",     "AU",      ["China","commodities","RBA","iron ore"]),
    "USDCAD=X":("USD/CAD",         "forex",     "CA",      ["oil","BoC","trade","CAD"]),
    "USDCHF=X":("USD/CHF",         "forex",     "CH",      ["safe-haven","SNB","rates","geopolitics"]),
    "NZDUSD=X":("NZD/USD",         "forex",     "NZ",      ["RBNZ","commodities","China"]),
    "USDCNH=X":("USD/CNH",         "forex",     "CN",      ["PBOC","trade war","CNY","China policy"]),
    "USDBRL=X":("USD/BRL",         "forex",     "BR",      ["Brazil","fiscal","Lula","commodities"]),
    "USDINR=X":("USD/INR",         "forex",     "IN",      ["RBI","India growth","trade","oil"]),
    "USDZAR=X":("USD/ZAR",         "forex",     "ZA",      ["South Africa","mining","load shedding"]),
    "USDTRY=X":("USD/TRY",         "forex",     "TR",      ["Turkey","Erdogan","inflation","rates"]),
    "DX=F":    ("US Dollar Index", "forex",     "US",      ["Fed","safe-haven","trade","rates"]),
    # ── Crypto ───────────────────────────────────────────────────────────
    "BTC-USD": ("Bitcoin",         "crypto",    "Global",  ["ETF","halving","regulation","adoption"]),
    "ETH-USD": ("Ethereum",        "crypto",    "Global",  ["DeFi","staking","ETF","Layer2"]),
    "SOL-USD": ("Solana",          "crypto",    "Global",  ["DeFi","NFT","ecosystem","Firedancer"]),
    "XRP-USD": ("Ripple XRP",      "crypto",    "Global",  ["SEC","cross-border","banks","CBDC"]),
    "BNB-USD": ("BNB",             "crypto",    "Global",  ["Binance","DeFi","regulation","BSC"]),
    "ADA-USD": ("Cardano",         "crypto",    "Global",  ["smart contracts","Africa","Hoskinson"]),
    # ── US Large Cap Stocks ──────────────────────────────────────────────
    "AAPL":   ("Apple",            "stock",     "US",      ["iPhone","supply chain","China","AI","services"]),
    "MSFT":   ("Microsoft",        "stock",     "US",      ["cloud","AI","Copilot","Azure","gaming"]),
    "NVDA":   ("NVIDIA",           "stock",     "US",      ["AI GPUs","data center","semiconductors","CUDA"]),
    "GOOGL":  ("Alphabet",         "stock",     "US",      ["search","AI","cloud","advertising","antitrust"]),
    "AMZN":   ("Amazon",           "stock",     "US",      ["cloud","e-commerce","AI","logistics"]),
    "META":   ("Meta Platforms",   "stock",     "US",      ["social media","AI","VR","advertising"]),
    "TSLA":   ("Tesla",            "stock",     "US",      ["EV","China","robotics","Musk","rates"]),
    "BRK-B":  ("Berkshire Hathaway","stock",    "US",      ["Buffett","value","insurance","banks"]),
    "LLY":    ("Eli Lilly",        "stock",     "US",      ["GLP-1","obesity","diabetes","pharma"]),
    "V":      ("Visa",             "stock",     "US",      ["payments","consumer","rates","fintech"]),
    "JPM":    ("JPMorgan Chase",   "stock",     "US",      ["banking","rates","credit","M&A"]),
    "WMT":    ("Walmart",          "stock",     "US",      ["retail","consumer","inflation","emerging markets"]),
    "XOM":    ("ExxonMobil",       "stock",     "US",      ["oil","energy","dividends","capex"]),
    "MA":     ("Mastercard",       "stock",     "US",      ["payments","consumer","global","fintech"]),
    "HD":     ("Home Depot",       "stock",     "US",      ["housing","rates","consumer","construction"]),
    "PG":     ("Procter & Gamble", "stock",     "US",      ["consumer staples","inflation","emerging markets"]),
    "UNH":    ("UnitedHealth",     "stock",     "US",      ["healthcare","ACA","pharma","Medicare"]),
    "GS":     ("Goldman Sachs",    "stock",     "US",      ["investment banking","M&A","rates","trading"]),
    "BAC":    ("Bank of America",  "stock",     "US",      ["banking","rates","consumer credit","mortgages"]),
    "AVGO":   ("Broadcom",         "stock",     "US",      ["AI","semiconductors","networking","VMware"]),
    "AMD":    ("AMD",              "stock",     "US",      ["AI","semiconductors","data center","competition"]),
    "INTC":   ("Intel",            "stock",     "US",      ["semiconductors","foundry","competition","PC"]),
    "CRM":    ("Salesforce",       "stock",     "US",      ["cloud","CRM","AI","enterprise"]),
    "BA":     ("Boeing",           "stock",     "US",      ["aerospace","defense","737 MAX","supply chain"]),
    "CAT":    ("Caterpillar",      "stock",     "US",      ["infrastructure","China","commodities","capex"]),
    "LMT":    ("Lockheed Martin",  "stock",     "US",      ["defense","Ukraine","NATO","F-35"]),
    "RTX":    ("RTX (Raytheon)",   "stock",     "US",      ["defense","missiles","NATO","geopolitics"]),
    # ── European Large Cap Stocks ────────────────────────────────────────
    "ASML.AS":("ASML",             "stock",     "NL",      ["semiconductors","EUV","Taiwan","AI"]),
    "LVMH.PA":("LVMH",             "stock",     "FR",      ["luxury","China","EUR","consumer"]),
    "SAP.DE": ("SAP",              "stock",     "DE",      ["enterprise software","AI","cloud","ERP"]),
    "SHEL.L": ("Shell",            "stock",     "UK",      ["oil","LNG","energy transition","dividends"]),
    "NOVO-B.CO":("Novo Nordisk",   "stock",     "DK",      ["GLP-1","obesity","diabetes","pharma"]),
    "NESN.SW":("Nestlé",           "stock",     "CH",      ["consumer staples","EM","food","pricing"]),
    # ── Asian Stocks ─────────────────────────────────────────────────────
    "9988.HK":("Alibaba",          "stock",     "CN",      ["China tech","regulation","PBOC","e-commerce"]),
    "700.HK": ("Tencent",          "stock",     "CN",      ["China tech","gaming","WeChat","regulation"]),
    "005930.KS":("Samsung",        "stock",     "KR",      ["semiconductors","DRAM","smartphones","China"]),
    "7203.T": ("Toyota",           "stock",     "JP",      ["EV","hybrid","BoJ","JPY","supply chain"]),
    "TCS.NS": ("Tata Consultancy", "stock",     "IN",      ["IT services","India","offshoring","AI"]),
    "RELIANCE.NS":("Reliance",     "stock",     "IN",      ["India","conglomerate","telecom","refining"]),
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


async def _fetch_ticker_with_dates(symbol: str, period: str = "1y") -> Optional[Dict]:
    """Fetch daily OHLCV + dates via yfinance. Returns {prices, dates, volumes}."""
    try:
        import yfinance as yf

        def _sync():
            t = yf.Ticker(symbol)
            h = t.history(period=period, interval="1d")
            if h.empty:
                return None
            return {
                "prices":  [float(x) for x in h["Close"].tolist()],
                "dates":   [str(d.date()) for d in h.index.tolist()],
                "volumes": [int(x) for x in h["Volume"].fillna(0).tolist()],
                "highs":   [float(x) for x in h["High"].tolist()],
                "lows":    [float(x) for x in h["Low"].tolist()],
            }

        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _sync)
    except Exception as e:
        logger.debug("Ticker+dates fetch %s: %s", symbol, e)
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
    """Return extended asset universe with latest prices from cache."""
    from scheduler import get_finance_cache
    cache = {a["symbol"]: a for a in get_finance_cache()}
    assets = []
    for sym, (name, cat, region, drivers) in EXTENDED_ASSETS.items():
        cached = cache.get(sym, {})
        assets.append({
            "symbol":     sym,
            "name":       name,
            "category":   cat,
            "region":     region,
            "drivers":    drivers,
            # Live price from scheduler cache (updated every 5 min)
            "price":      cached.get("price"),
            "change_pct": cached.get("change_pct"),
            "change_abs": cached.get("change_abs"),
        })
    return {"assets": assets}


@router.get("/search")
async def search_assets(q: str = Query(""), isin: str = Query("")):
    """Search assets by symbol name or ISIN code."""
    results = []
    # ISIN lookup
    if isin and len(isin) == 12:
        sym = ISIN_MAP.get(isin.upper())
        if sym and sym in EXTENDED_ASSETS:
            n, cat, region, drivers = EXTENDED_ASSETS[sym]
            results.append({"symbol": sym, "name": n, "category": cat,
                            "region": region, "isin": isin.upper(), "drivers": drivers})
        return JSONResponse({"results": results, "query": isin, "type": "isin"})

    # Text search across symbol + name
    ql = q.lower()
    for sym, (name, cat, region, drivers) in EXTENDED_ASSETS.items():
        if (ql in sym.lower() or ql in name.lower() or
                any(ql in d.lower() for d in drivers)):
            results.append({"symbol": sym, "name": name, "category": cat,
                            "region": region, "drivers": drivers})
        if len(results) >= 20:
            break
    return JSONResponse({"results": results, "query": q, "type": "text"})


@router.get("/ticker/{symbol}")
async def get_ticker_data(symbol: str, period: str = Query("3mo")):
    """Deep ticker data: OHLC history, technicals, performance."""
    sym = symbol.upper()

    # Try to get from yfinance (with dates for chart alignment)
    _twd = await _fetch_ticker_with_dates(sym, period)
    prices = _twd["prices"] if _twd else None
    _price_dates = _twd["dates"] if _twd else []

    # Fallback: use cached data from scheduler
    if not prices:
        from scheduler import get_finance_cache
        cached = {a["symbol"]: a for a in get_finance_cache()}
        if sym in cached:
            prices = cached[sym].get("history", [])
            _price_dates = []

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

    prev_close = prices[-2] if len(prices) >= 2 else cur
    change_abs = round(cur - prev_close, 4)
    change_pct = round((cur / prev_close - 1) * 100, 3) if prev_close else 0.0
    high_52w   = round(max(prices[-min(252,len(prices)):]), 4) if prices else cur
    low_52w    = round(min(prices[-min(252,len(prices)):]), 4) if prices else cur
    # Volumes (if available from yfinance)
    volumes      = _twd.get("volumes", []) if _twd else []
    highs        = _twd.get("highs",   []) if _twd else []
    lows         = _twd.get("lows",    []) if _twd else []

    return {
        "symbol":     sym,
        "name":       meta[0],
        "category":   meta[1],
        "region":     meta[2],
        "drivers":    meta[3] if len(meta) > 3 else [],
        # Live price & change
        "price":      cur,
        "change_abs": change_abs,
        "change_pct": change_pct,
        "high_52w":   high_52w,
        "low_52w":    low_52w,
        # OHLCV history (aligned with dates)
        "prices":          prices[-90:],
        "prices_full":     prices,
        "price_dates":     _price_dates[-90:] if _price_dates else [],
        "price_dates_full":_price_dates,
        "volumes":         volumes[-90:]      if volumes else [],
        "volumes_full":    volumes,
        "highs":           highs[-90:]        if highs else [],
        "lows":            lows[-90:]         if lows else [],
        "perf":       perf,
        "rsi":        rsi_val,
        "technicals": {
            "rsi":            rsi_val,
            "sma20":          sma20,
            "sma50":          sma50,
            "sma200":         sma200,
            "trend":          trend,
            "volatility_pct": vol,
            "support":        sr["support"],
            "resistance":     sr["resistance"],
            "range_low":      sr["range_low"],
            "range_high":     sr["range_high"],
            "pivot":          sr["pivot"],
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
            _price_dates = []

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


# ══════════════════════════════════════════════════════════
# QUANTITATIVE FINANCE ENGINE
# All models: pure mathematics, no AI predictions
# ══════════════════════════════════════════════════════════

import math
import random
import statistics

# ── Quant helpers ─────────────────────────────────────────

def _log_returns(prices: List[float]) -> List[float]:
    if len(prices) < 2:
        return []
    return [math.log(prices[i] / prices[i-1]) for i in range(1, len(prices))]

def _simple_returns(prices: List[float]) -> List[float]:
    if len(prices) < 2:
        return []
    return [(prices[i] / prices[i-1]) - 1 for i in range(1, len(prices))]

def _max_drawdown(prices: List[float]) -> float:
    if len(prices) < 2:
        return 0.0
    peak = prices[0]
    max_dd = 0.0
    for p in prices:
        if p > peak:
            peak = p
        dd = (peak - p) / peak
        if dd > max_dd:
            max_dd = dd
    return round(max_dd * 100, 2)

def _drawdown_series(prices: List[float]) -> List[float]:
    if not prices:
        return []
    peak = prices[0]
    result = []
    for p in prices:
        if p > peak:
            peak = p
        result.append(round(-(peak - p) / peak * 100, 4))
    return result

def _rolling_volatility(returns: List[float], window: int = 20) -> List[float]:
    result = [0.0] * len(returns)
    for i in range(window, len(returns)):
        slice_ = returns[i-window:i]
        result[i] = round(statistics.stdev(slice_) * math.sqrt(252) * 100, 4)
    return result

def _sharpe(returns: List[float], rf: float = 0.05) -> float:
    if len(returns) < 2:
        return 0.0
    ann_return = sum(returns) / len(returns) * 252
    ann_vol = statistics.stdev(returns) * math.sqrt(252) if len(returns) > 1 else 0
    if ann_vol == 0:
        return 0.0
    return round((ann_return - rf) / ann_vol, 3)

def _sortino(returns: List[float], rf: float = 0.05) -> float:
    if len(returns) < 2:
        return 0.0
    ann_return = sum(returns) / len(returns) * 252
    downside = [r for r in returns if r < 0]
    if not downside:
        return 999.0
    downside_vol = statistics.stdev(downside) * math.sqrt(252)
    if downside_vol == 0:
        return 0.0
    return round((ann_return - rf) / downside_vol, 3)

def _calmar(returns: List[float], prices: List[float]) -> float:
    if not prices or not returns:
        return 0.0
    ann_return = sum(returns) / len(returns) * 252 * 100
    mdd = _max_drawdown(prices)
    if mdd == 0:
        return 999.0
    return round(ann_return / mdd, 3)

def _beta(asset_returns: List[float], bench_returns: List[float]) -> float:
    n = min(len(asset_returns), len(bench_returns))
    if n < 5:
        return 1.0
    a = asset_returns[-n:]
    b = bench_returns[-n:]
    mean_a = sum(a) / n
    mean_b = sum(b) / n
    cov = sum((a[i] - mean_a) * (b[i] - mean_b) for i in range(n)) / (n - 1)
    var_b = sum((b[i] - mean_b) ** 2 for i in range(n)) / (n - 1)
    return round(cov / var_b, 3) if var_b != 0 else 1.0

def _correlation(x: List[float], y: List[float]) -> float:
    n = min(len(x), len(y))
    if n < 5:
        return 0.0
    a, b = x[-n:], y[-n:]
    mean_a, mean_b = sum(a)/n, sum(b)/n
    num = sum((a[i]-mean_a)*(b[i]-mean_b) for i in range(n))
    den = math.sqrt(
        sum((a[i]-mean_a)**2 for i in range(n)) *
        sum((b[i]-mean_b)**2 for i in range(n))
    )
    return round(num / den, 4) if den != 0 else 0.0

def _linear_regression(x: List[float], y: List[float]) -> Dict:
    n = len(x)
    if n < 3:
        return {"alpha": 0.0, "beta": 1.0, "r2": 0.0}
    mean_x, mean_y = sum(x)/n, sum(y)/n
    ss_xy = sum((x[i]-mean_x)*(y[i]-mean_y) for i in range(n))
    ss_xx = sum((x[i]-mean_x)**2 for i in range(n))
    if ss_xx == 0:
        return {"alpha": mean_y, "beta": 0.0, "r2": 0.0}
    beta = ss_xy / ss_xx
    alpha = mean_y - beta * mean_x
    y_pred = [alpha + beta * x[i] for i in range(n)]
    ss_res = sum((y[i]-y_pred[i])**2 for i in range(n))
    ss_tot = sum((y[i]-mean_y)**2 for i in range(n))
    r2 = 1 - ss_res/ss_tot if ss_tot != 0 else 0.0
    return {"alpha": round(alpha, 6), "beta": round(beta, 4), "r2": round(r2, 4)}

# ── SMA / EMA for backtests ───────────────────────────────

def _sma(prices: List[float], period: int) -> List[Optional[float]]:
    result: List[Optional[float]] = [None] * (period - 1)
    for i in range(period - 1, len(prices)):
        result.append(round(sum(prices[i-period+1:i+1]) / period, 4))
    return result

# ── Monte Carlo path generator ────────────────────────────

def _monte_carlo(
    last_price: float,
    mu: float,        # daily expected return
    sigma: float,     # daily volatility
    days: int,
    n_paths: int = 500,
    seed: int = 42,
) -> Dict:
    """
    GBM Monte Carlo simulation.
    Returns percentile bands (5, 25, 50, 75, 95).
    """
    rng = random.Random(seed)
    dt = 1.0
    drift = (mu - 0.5 * sigma ** 2) * dt
    diffusion = sigma * math.sqrt(dt)

    paths = []
    for _ in range(n_paths):
        path = [last_price]
        for _ in range(days):
            z = rng.gauss(0, 1)
            path.append(path[-1] * math.exp(drift + diffusion * z))
        paths.append(path)

    # Build percentile series
    percentiles = {5: [], 25: [], 50: [], 75: [], 95: []}
    for t in range(days + 1):
        vals = sorted(p[t] for p in paths)
        n = len(vals)
        for pct in [5, 25, 50, 75, 95]:
            idx = int(pct / 100 * (n - 1))
            percentiles[pct].append(round(vals[idx], 4))

    return percentiles

# ── PCA (Gram-Schmidt, no numpy) ──────────────────────────

def _pca(matrix: List[List[float]], n_components: int = 2) -> Dict:
    """
    Simple iterative PCA via power method.
    matrix: (n_samples × n_assets) standardised returns.
    """
    if not matrix or not matrix[0]:
        return {"components": [], "explained_variance": []}

    n_samples = len(matrix)
    n_features = len(matrix[0])
    n_components = min(n_components, n_features, n_samples)

    # Covariance matrix (n_features × n_features)
    means = [sum(matrix[s][f] for s in range(n_samples)) / n_samples for f in range(n_features)]
    centered = [[matrix[s][f] - means[f] for f in range(n_features)] for s in range(n_samples)]

    def _cov_times_vec(v):
        # C @ v  (n_features × n_features) @ (n_features,)
        result = []
        for f1 in range(n_features):
            s = sum(
                sum(centered[s_][f1] * centered[s_][f2] for s_ in range(n_samples)) / (n_samples - 1) * v[f2]
                for f2 in range(n_features)
            )
            result.append(s)
        return result

    def _norm(v):
        return math.sqrt(sum(x*x for x in v)) or 1.0

    def _dot(a, b):
        return sum(a[i]*b[i] for i in range(len(a)))

    components = []
    total_var = 0.0
    explained = []
    deflation_vecs = []

    for _ in range(n_components):
        # Power iteration
        vec = [1.0 / math.sqrt(n_features)] * n_features
        for __ in range(50):
            new_vec = _cov_times_vec(vec)
            # Deflate
            for ev, el in zip(deflation_vecs, explained):
                proj = _dot(new_vec, ev)
                new_vec = [new_vec[i] - proj * ev[i] for i in range(n_features)]
            n_ = _norm(new_vec)
            vec = [x / n_ for x in new_vec]
        eigenvalue = _dot(_cov_times_vec(vec), vec)
        total_var += eigenvalue
        components.append([round(v, 4) for v in vec])
        deflation_vecs.append(vec)
        explained.append(eigenvalue)

    # Project data onto components (for scatter plot)
    projections = []
    for s in range(n_samples):
        coords = []
        for comp in components:
            coords.append(round(sum(centered[s][f] * comp[f] for f in range(n_features)), 4))
        projections.append(coords)

    return {
        "components": components,
        "explained_variance_ratio": [round(e / (total_var or 1), 4) for e in explained],
        "projections": projections[:100],  # limit for JSON size
    }


# ══════════════════════════════════════════════════════════
# API ENDPOINTS — Quantitative Lab
# ══════════════════════════════════════════════════════════

@router.get("/quant/metrics/{symbol}")
async def get_quant_metrics(symbol: str, period: str = Query("1y")):
    """
    Full quantitative metrics for a single asset:
    returns, volatility, drawdown, Sharpe, Sortino, Calmar, beta vs S&P 500.
    """
    prices = await _fetch_ticker_history(symbol, period)
    bench  = await _fetch_ticker_history("^GSPC", period)

    if not prices or len(prices) < 5:
        return JSONResponse({"error": "Insufficient price data"}, status_code=404)

    returns = _simple_returns(prices)
    log_ret = _log_returns(prices)
    bench_returns = _simple_returns(bench) if bench else []

    ann_return = sum(returns) / len(returns) * 252 * 100 if returns else 0
    ann_vol    = (statistics.stdev(returns) * math.sqrt(252) * 100) if len(returns) > 1 else 0
    mdd        = _max_drawdown(prices)
    sharpe     = _sharpe(returns)
    sortino    = _sortino(returns)
    calmar     = _calmar(returns, prices)
    beta       = _beta(returns, bench_returns) if bench_returns else 1.0
    alpha      = ann_return/100 - beta * (sum(bench_returns)/len(bench_returns)*252) if bench_returns else 0

    # Value at Risk (95% historical)
    sorted_ret = sorted(returns)
    var_95 = round(sorted_ret[int(len(sorted_ret) * 0.05)] * 100, 3) if sorted_ret else 0

    # Skewness & kurtosis
    n = len(returns)
    mean_r = sum(returns) / n
    std_r  = statistics.stdev(returns) if n > 1 else 1
    skew   = round(sum(((r - mean_r)/std_r)**3 for r in returns) / n, 3) if std_r else 0
    kurt   = round(sum(((r - mean_r)/std_r)**4 for r in returns) / n - 3, 3) if std_r else 0

    return {
        "symbol":       symbol,
        "period":       period,
        "n_days":       len(prices),
        "current_price": round(prices[-1], 4),
        "ann_return_pct": round(ann_return, 2),
        "ann_vol_pct":    round(ann_vol, 2),
        "max_drawdown_pct": mdd,
        "sharpe":   sharpe,
        "sortino":  sortino,
        "calmar":   calmar,
        "beta":     beta,
        "alpha_pct": round(alpha * 100, 3),
        "var_95_pct": var_95,
        "skewness": skew,
        "kurtosis": kurt,
        "drawdown_series": _drawdown_series(prices),
        "rolling_vol": _rolling_volatility(returns),
        "returns_series": [round(r * 100, 4) for r in returns],
        "prices":    [round(p, 4) for p in prices],
    }


@router.post("/quant/portfolio")
async def portfolio_metrics(payload: dict = Body(...)):
    """
    Portfolio analytics: weighted return, volatility, Sharpe, max drawdown.
    Payload: {holdings: [{symbol, weight}], period: "1y"}
    """
    holdings = payload.get("holdings", [])
    period   = payload.get("period", "1y")
    rf       = payload.get("risk_free_rate", 0.05)

    if not holdings:
        return JSONResponse({"error": "No holdings provided"}, status_code=400)

    # Fetch histories
    symbols  = [h["symbol"] for h in holdings]
    weights  = [float(h.get("weight", 1.0 / len(holdings))) for h in holdings]
    # Normalise weights
    w_sum    = sum(weights) or 1
    weights  = [w / w_sum for w in weights]

    histories = {}
    for sym in symbols:
        h = await _fetch_ticker_history(sym, period)
        if h:
            histories[sym] = h

    if not histories:
        return JSONResponse({"error": "No price data available"}, status_code=404)

    # Align lengths
    min_len = min(len(v) for v in histories.values())
    aligned = {sym: hist[-min_len:] for sym, hist in histories.items()}

    # Portfolio returns (weighted sum of daily returns)
    port_prices = []
    for t in range(min_len):
        day_val = sum(
            weights[i] * aligned[symbols[i]][t]
            for i, sym in enumerate(symbols)
            if sym in aligned
        )
        port_prices.append(day_val)

    # Normalise to base 100
    base = port_prices[0] or 1
    port_prices_norm = [p / base * 100 for p in port_prices]

    port_returns = _simple_returns(port_prices)
    ann_return   = sum(port_returns) / len(port_returns) * 252 * 100 if port_returns else 0
    ann_vol      = statistics.stdev(port_returns) * math.sqrt(252) * 100 if len(port_returns) > 1 else 0
    mdd          = _max_drawdown(port_prices)
    sharpe       = _sharpe(port_returns, rf)

    # Per-asset contribution
    contributions = []
    for i, sym in enumerate(symbols):
        if sym not in aligned:
            continue
        h = aligned[sym]
        r = _simple_returns(h)
        ann_r = sum(r) / len(r) * 252 * 100 if r else 0
        contributions.append({
            "symbol": sym,
            "name": EXTENDED_ASSETS.get(sym, (sym,))[0],
            "weight": round(weights[i] * 100, 1),
            "ann_return_pct": round(ann_r, 2),
            "volatility_pct": round(statistics.stdev(r) * math.sqrt(252) * 100, 2) if len(r) > 1 else 0,
            "contribution_pct": round(weights[i] * ann_r, 3),
        })

    return {
        "portfolio": {
            "ann_return_pct": round(ann_return, 2),
            "ann_vol_pct":    round(ann_vol, 2),
            "sharpe":         sharpe,
            "max_drawdown_pct": mdd,
            "n_assets":       len(histories),
        },
        "nav_series":   [round(p, 4) for p in port_prices_norm],
        "contributions": contributions,
        "drawdown_series": _drawdown_series(port_prices),
    }


@router.post("/quant/backtest")
async def backtest(payload: dict = Body(...)):
    """
    Strategy backtester.
    strategies: buy_hold | ma_crossover | momentum
    """
    symbol    = payload.get("symbol", "^GSPC")
    strategy  = payload.get("strategy", "buy_hold")
    period    = payload.get("period", "2y")
    fast_ma   = int(payload.get("fast_ma", 20))
    slow_ma   = int(payload.get("slow_ma", 50))
    mom_days  = int(payload.get("momentum_days", 20))

    prices = await _fetch_ticker_history(symbol, period)
    bench  = await _fetch_ticker_history("^GSPC", period)

    if not prices or len(prices) < slow_ma + 5:
        return JSONResponse({"error": "Insufficient data for backtest"}, status_code=400)

    # Buy & Hold baseline
    bh_nav = [100 * p / prices[0] for p in prices]

    # Strategy nav
    nav = [100.0]
    in_position = True if strategy == "buy_hold" else False
    signals = []
    entry_price = prices[0]

    fast_series = _sma(prices, fast_ma)
    slow_series = _sma(prices, slow_ma)

    for i in range(1, len(prices)):
        prev, cur = nav[-1], None
        p = prices[i]

        if strategy == "buy_hold":
            cur = 100 * p / prices[0]

        elif strategy == "ma_crossover":
            if fast_series[i] and slow_series[i]:
                prev_fast = fast_series[i-1]
                prev_slow = slow_series[i-1]
                # Buy signal
                if prev_fast and prev_slow and not in_position:
                    if fast_series[i] > slow_series[i] and prev_fast <= prev_slow:
                        in_position = True
                        entry_price = p
                        signals.append({"day": i, "type": "buy", "price": round(p, 4)})
                # Sell signal
                elif in_position:
                    if fast_series[i] < slow_series[i] and prev_fast >= prev_slow:
                        in_position = False
                        signals.append({"day": i, "type": "sell", "price": round(p, 4)})
            cur = prev * (p / prices[i-1]) if in_position else prev

        elif strategy == "momentum":
            if i >= mom_days:
                mom_return = prices[i] / prices[i - mom_days] - 1
                should_hold = mom_return > 0
                if should_hold and not in_position:
                    in_position = True
                    signals.append({"day": i, "type": "buy", "price": round(p, 4)})
                elif not should_hold and in_position:
                    in_position = False
                    signals.append({"day": i, "type": "sell", "price": round(p, 4)})
            cur = prev * (p / prices[i-1]) if in_position else prev

        nav.append(round(cur if cur is not None else prev, 4))

    strat_returns = _simple_returns(nav)
    bh_returns    = _simple_returns(bh_nav)

    # Benchmark comparison
    bench_nav = []
    if bench:
        bench_norm = [100 * p / bench[0] for p in bench[-len(prices):]]
        bench_nav  = [round(p, 4) for p in bench_norm]

    return {
        "strategy_nav":   nav,
        "buyhold_nav":    [round(p, 4) for p in bh_nav],
        "benchmark_nav":  bench_nav,
        "signals":        signals[:50],
        "metrics": {
            "strategy": {
                "total_return_pct": round(nav[-1] - 100, 2),
                "ann_return_pct":   round(sum(strat_returns)/len(strat_returns)*252*100, 2) if strat_returns else 0,
                "sharpe":           _sharpe(strat_returns),
                "max_drawdown_pct": _max_drawdown(nav),
                "n_trades":         len([s for s in signals if s["type"] == "buy"]),
            },
            "buyhold": {
                "total_return_pct": round(bh_nav[-1] - 100, 2),
                "ann_return_pct":   round(sum(bh_returns)/len(bh_returns)*252*100, 2) if bh_returns else 0,
                "sharpe":           _sharpe(bh_returns),
                "max_drawdown_pct": _max_drawdown(bh_nav),
            },
        },
        "n_days": len(prices),
    }


@router.post("/quant/forecast")
async def monte_carlo_forecast(payload: dict = Body(...)):
    """
    Monte Carlo forecast using Geometric Brownian Motion.
    Pure statistical simulation — no AI.
    """
    symbol   = payload.get("symbol", "^GSPC")
    horizon  = int(payload.get("horizon_days", 21))   # 1M=21, 3M=63, 1Y=252
    vol_mult = float(payload.get("vol_multiplier", 1.0))
    mu_adj   = float(payload.get("mu_adjustment", 0.0))  # manual drift adj
    n_paths  = int(payload.get("n_paths", 1000))
    period   = payload.get("history_period", "1y")

    prices = await _fetch_ticker_history(symbol, period)
    if not prices or len(prices) < 20:
        return JSONResponse({"error": "Insufficient data"}, status_code=404)

    returns   = _log_returns(prices)
    mu_hist   = sum(returns) / len(returns)      # historical daily drift
    sigma_hist = statistics.stdev(returns) if len(returns) > 1 else 0.01

    mu    = mu_hist + mu_adj / 252
    sigma = sigma_hist * vol_mult

    last_price = prices[-1]
    mc = _monte_carlo(last_price, mu, sigma, horizon, n_paths=min(n_paths, 2000))

    # Scenario labels
    bull_ret   = round((mc[95][-1] / last_price - 1) * 100, 2)
    base_ret   = round((mc[50][-1] / last_price - 1) * 100, 2)
    bear_ret   = round((mc[5][-1]  / last_price - 1) * 100, 2)

    # Historical distribution stats for assumptions tooltip
    ann_vol   = round(sigma_hist * math.sqrt(252) * 100, 2)
    ann_mu    = round(mu_hist * 252 * 100, 2)

    return {
        "symbol":      symbol,
        "last_price":  round(last_price, 4),
        "horizon_days": horizon,
        "percentiles":  mc,
        "scenarios": {
            "bullish":  {"price": round(mc[75][-1], 4), "return_pct": round((mc[75][-1]/last_price-1)*100, 2)},
            "base":     {"price": round(mc[50][-1], 4), "return_pct": base_ret},
            "bearish":  {"price": round(mc[25][-1], 4), "return_pct": round((mc[25][-1]/last_price-1)*100, 2)},
            "extreme_bull": {"price": round(mc[95][-1], 4), "return_pct": bull_ret},
            "extreme_bear": {"price": round(mc[5][-1], 4),  "return_pct": bear_ret},
        },
        "assumptions": {
            "hist_ann_return_pct": ann_mu,
            "hist_ann_vol_pct":    ann_vol,
            "applied_vol_mult":   vol_mult,
            "applied_mu_adj":     mu_adj,
            "model":              "Geometric Brownian Motion (GBM)",
            "n_paths":            n_paths,
            "n_history_days":     len(prices),
        },
    }


@router.post("/quant/pca")
async def pca_analysis(payload: dict = Body(...)):
    """
    PCA on a basket of assets. Returns components, variance explained,
    and 2D projections for scatter plot.
    """
    symbols = payload.get("symbols", list(EXTENDED_ASSETS.keys())[:10])
    period  = payload.get("period", "1y")
    n_comp  = int(payload.get("n_components", 3))

    histories = {}
    for sym in symbols[:15]:  # max 15 assets
        h = await _fetch_ticker_history(sym, period)
        if h and len(h) > 10:
            histories[sym] = h

    if len(histories) < 3:
        return JSONResponse({"error": "Need ≥ 3 assets with price data"}, status_code=400)

    # Align
    min_len = min(len(v) for v in histories.values())
    symbols_ok = list(histories.keys())

    # Build returns matrix (n_samples × n_assets)
    matrix = []
    for t in range(1, min_len):
        row = []
        for sym in symbols_ok:
            h = histories[sym]
            r = (h[-min_len + t] / h[-min_len + t - 1]) - 1
            row.append(r)
        matrix.append(row)

    # Standardise
    n_assets = len(symbols_ok)
    means  = [sum(matrix[t][f] for t in range(len(matrix))) / len(matrix) for f in range(n_assets)]
    stds   = [
        statistics.stdev([matrix[t][f] for t in range(len(matrix))]) or 1
        for f in range(n_assets)
    ]
    std_matrix = [
        [(matrix[t][f] - means[f]) / stds[f] for f in range(n_assets)]
        for t in range(len(matrix))
    ]

    result = _pca(std_matrix, n_components=min(n_comp, n_assets, len(matrix)))
    result["symbols"] = symbols_ok
    result["asset_names"] = [EXTENDED_ASSETS.get(s, (s,))[0] for s in symbols_ok]
    return result


@router.post("/quant/regression")
async def factor_regression(payload: dict = Body(...)):
    """
    Linear regression of asset returns vs factor returns.
    Factors: S&P 500, VIX, Gold, Oil, USD Index.
    """
    symbol  = payload.get("symbol", "AAPL")
    factors = payload.get("factors", ["^GSPC", "^VIX", "GC=F", "CL=F", "DX=F"])
    period  = payload.get("period", "1y")

    asset_prices = await _fetch_ticker_history(symbol, period)
    if not asset_prices or len(asset_prices) < 20:
        return JSONResponse({"error": "Insufficient asset data"}, status_code=404)

    asset_returns = _simple_returns(asset_prices)

    factor_returns: Dict[str, List[float]] = {}
    for fac in factors[:5]:
        h = await _fetch_ticker_history(fac, period)
        if h:
            r = _simple_returns(h)
            if len(r) >= len(asset_returns) - 5:
                factor_returns[fac] = r

    if not factor_returns:
        return JSONResponse({"error": "No factor data available"}, status_code=404)

    # Align lengths
    min_len = min(len(asset_returns), min(len(v) for v in factor_returns.values()))
    y = asset_returns[-min_len:]
    results = []

    for fac_sym, fac_ret in factor_returns.items():
        x = fac_ret[-min_len:]
        reg = _linear_regression(x, y)
        corr = _correlation(x, y)
        fac_name = EXTENDED_ASSETS.get(fac_sym, (fac_sym,))[0]
        results.append({
            "factor":  fac_sym,
            "name":    fac_name,
            "alpha":   reg["alpha"],
            "beta":    reg["beta"],
            "r2":      reg["r2"],
            "correlation": corr,
            "x_series": [round(v * 100, 4) for v in x[:100]],
            "y_series": [round(v * 100, 4) for v in y[:100]],
        })

    # Sort by R²
    results.sort(key=lambda r: -r["r2"])

    ann_return = sum(y) / len(y) * 252 * 100
    ann_vol    = statistics.stdev(y) * math.sqrt(252) * 100 if len(y) > 1 else 0

    return {
        "symbol":  symbol,
        "name":    EXTENDED_ASSETS.get(symbol, (symbol,))[0],
        "regressions": results,
        "asset_stats": {
            "ann_return_pct": round(ann_return, 2),
            "ann_vol_pct":    round(ann_vol, 2),
            "n_days":         min_len,
        },
    }


# ══════════════════════════════════════════════════════════
# HISTORICAL EVENTS OVERLAY ENGINE
# Maps world-lens events onto price series timeline.
# Computes observed market reaction (N-day return after event).
# ══════════════════════════════════════════════════════════

import aiosqlite
from datetime import date as _date, timedelta

# Asset → event category relevance weights
# Higher = this category is more likely to affect this asset type
_CATEGORY_WEIGHTS: Dict[str, Dict[str, float]] = {
    "index":     {"ECONOMICS":1.0,"FINANCE":1.0,"GEOPOLITICS":0.7,"CONFLICT":0.6,"POLITICS":0.5,
                  "ENERGY":0.4,"HEALTH":0.5,"DISASTER":0.3,"TECHNOLOGY":0.3},
    "commodity": {"CONFLICT":1.0,"ENERGY":1.0,"GEOPOLITICS":0.9,"ECONOMICS":0.7,"DISASTER":0.6,
                  "HUMANITARIAN":0.4,"POLITICS":0.3},
    "forex":     {"ECONOMICS":1.0,"POLITICS":0.8,"GEOPOLITICS":0.7,"FINANCE":0.6,"CONFLICT":0.5},
    "crypto":    {"FINANCE":1.0,"TECHNOLOGY":0.9,"ECONOMICS":0.7,"GEOPOLITICS":0.5,"POLITICS":0.4},
    "stock":     {"ECONOMICS":0.8,"FINANCE":0.9,"TECHNOLOGY":0.7,"GEOPOLITICS":0.5,"POLITICS":0.4,
                  "ENERGY":0.5,"CONFLICT":0.4},
}

# Category visual config
_CAT_STYLE: Dict[str, Dict] = {
    "CONFLICT":     {"icon": "⚔",  "color": "#EF4444", "label": "Conflict"},
    "ECONOMICS":    {"icon": "📊",  "color": "#10B981", "label": "Economics"},
    "FINANCE":      {"icon": "💹",  "color": "#06B6D4", "label": "Finance"},
    "GEOPOLITICS":  {"icon": "🌐",  "color": "#3B82F6", "label": "Geopolitics"},
    "POLITICS":     {"icon": "🏛",  "color": "#6366F1", "label": "Politics"},
    "ENERGY":       {"icon": "⚡",  "color": "#F59E0B", "label": "Energy"},
    "HEALTH":       {"icon": "🏥",  "color": "#EC4899", "label": "Health"},
    "DISASTER":     {"icon": "🌪",  "color": "#F97316", "label": "Disaster"},
    "EARTHQUAKE":   {"icon": "⚡",  "color": "#EAB308", "label": "Earthquake"},
    "TECHNOLOGY":   {"icon": "💻",  "color": "#8B5CF6", "label": "Technology"},
    "HUMANITARIAN": {"icon": "🚨",  "color": "#F97316", "label": "Humanitarian"},
    "SECURITY":     {"icon": "🔒",  "color": "#DC2626", "label": "Security"},
}


def _market_reaction(prices: List[float], dates: List[str], event_date: str,
                     windows: List[int] = [1, 2, 5]) -> Dict:
    """
    Compute price return in N-day windows after an event.
    Returns {1d, 2d, 5d} returns and a volatility spike metric.
    """
    if event_date not in dates:
        # Find nearest trading day on or after event_date
        for i, d in enumerate(dates):
            if d >= event_date:
                idx = i
                break
        else:
            return {}
    else:
        idx = dates.index(event_date)

    if idx >= len(prices):
        return {}

    base_price = prices[idx]
    result = {"event_idx": idx, "event_price": round(base_price, 4)}
    for w in windows:
        future_idx = min(idx + w, len(prices) - 1)
        ret = (prices[future_idx] / base_price - 1) * 100
        result[f"ret_{w}d"] = round(ret, 3)

    # Volatility in window vs prior window (vol spike signal)
    if idx >= 10 and idx + 5 < len(prices):
        prior_rets  = [abs(prices[j]/prices[j-1]-1) for j in range(max(1,idx-10), idx)]
        after_rets  = [abs(prices[j]/prices[j-1]-1) for j in range(idx+1, min(idx+6, len(prices)))]
        if prior_rets and after_rets:
            prior_vol = sum(prior_rets) / len(prior_rets)
            after_vol = sum(after_rets) / len(after_rets)
            result["vol_spike"] = round((after_vol / prior_vol - 1) * 100, 1) if prior_vol else 0

    return result


def _relevance_score(event: Dict, symbol: str, asset_type: str,
                     drivers: List[str], symbol_name: str) -> float:
    """Score 0–1: how relevant is this event to this asset?"""
    score = 0.0
    cat = event.get("category", "")
    weights = _CATEGORY_WEIGHTS.get(asset_type, {})
    score += weights.get(cat, 0.2) * 0.5  # category weight

    # Severity contribution
    sev = event.get("severity", 5.0)
    score += (sev / 10.0) * 0.2

    # Keyword match with asset drivers
    text = (event.get("title", "") + " " + (event.get("summary") or "")).lower()
    sym_lower = symbol_name.lower()
    matched_drivers = sum(1 for d in drivers if d.lower() in text)
    score += min(matched_drivers * 0.15, 0.3)

    # Direct symbol mention
    if symbol.lower() in text or sym_lower in text:
        score += 0.2

    return round(min(score, 1.0), 3)


@router.get("/historical-events/{symbol}")
async def get_historical_events(
    symbol: str,
    period: str = Query("1y"),
    min_severity: float = Query(5.0),
    max_events: int = Query(50, le=100),
):
    """
    Fetch historical events overlaid on ticker price history.
    Returns events with their position on the price timeline
    and computed market reaction metrics.
    """
    sym = symbol.upper()
    meta = EXTENDED_ASSETS.get(sym, (sym, "unknown", "Global", []))
    asset_name = meta[0]
    asset_type = meta[1]
    drivers    = meta[3] if len(meta) > 3 else []

    # Fetch price history with dates
    price_data = await _fetch_ticker_with_dates(sym, period)

    if not price_data or len(price_data.get("prices", [])) < 5:
        # Fallback: generate mock dates for demo
        from datetime import date as d_, timedelta as td_
        n = 252 if period == "1y" else 66 if period == "3mo" else 500
        base_date = d_.today() - td_(days=n)
        dates  = []
        prices = []
        p = 100.0
        import random
        for i in range(n):
            dt = base_date + td_(days=i)
            if dt.weekday() < 5:  # weekdays only
                p *= (1 + random.gauss(0.0003, 0.012))
                dates.append(str(dt))
                prices.append(round(p, 4))
        price_data = {"prices": prices, "dates": dates, "volumes": [0]*len(prices)}

    prices = price_data["prices"]
    dates  = price_data["dates"]

    if not dates:
        return {"events": [], "prices": prices, "dates": dates}

    # Date range from price data
    date_start = dates[0]
    date_end   = dates[-1]

    # Fetch relevant events from DB within date range
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT id, timestamp, title, summary, category, country_name,
                          severity, impact, ai_summary, ai_market_note,
                          sentiment_score, sentiment_tone,
                          sent_market_stress, sent_uncertainty
                   FROM events
                   WHERE severity >= ?
                     AND date(timestamp) >= ?
                     AND date(timestamp) <= ?
                   ORDER BY severity DESC
                   LIMIT 200""",
                (min_severity, date_start, date_end)
            ) as cur:
                raw_events = [dict(r) for r in await cur.fetchall()]
    except Exception as e:
        logger.warning("Historical events DB query: %s", e)
        raw_events = []

    # Score, filter, and enrich events
    enriched = []
    for ev in raw_events:
        ev_date = ev["timestamp"][:10]  # YYYY-MM-DD
        if ev_date < date_start or ev_date > date_end:
            continue

        relevance = _relevance_score(ev, sym, asset_type, drivers, asset_name)
        if relevance < 0.2:
            continue

        reaction = _market_reaction(prices, dates, ev_date)
        cat = ev.get("category", "GEOPOLITICS")
        style = _CAT_STYLE.get(cat, {"icon": "📌", "color": "#94A3B8", "label": cat})

        enriched.append({
            "id":          ev["id"],
            "date":        ev_date,
            "title":       ev["title"],
            "summary":     ev.get("ai_summary") or ev.get("summary") or "",
            "category":    cat,
            "icon":        style["icon"],
            "color":       style["color"],
            "cat_label":   style["label"],
            "country":     ev.get("country_name", ""),
            "severity":    ev.get("severity", 5.0),
            "impact":      ev.get("impact", "Medium"),
            "relevance":   relevance,
            "market_note": ev.get("ai_market_note", ""),
            "sentiment_tone":   ev.get("sentiment_tone", ""),
            "market_stress":    round(ev.get("sent_market_stress") or 0, 3),
            # Market reaction
            "reaction": reaction,
            "event_idx":  reaction.get("event_idx", -1),
            "price_at_event": reaction.get("event_price"),
            "ret_1d":  reaction.get("ret_1d"),
            "ret_2d":  reaction.get("ret_2d"),
            "ret_5d":  reaction.get("ret_5d"),
            "vol_spike": reaction.get("vol_spike"),
        })

    # Sort by relevance × severity, take top N
    enriched.sort(key=lambda e: -(e["relevance"] * e["severity"]))
    enriched = enriched[:max_events]

    # Sort chronologically for display
    enriched.sort(key=lambda e: e["date"])

    # Cluster nearby events (same date or adjacent days, same category)
    clustered = _cluster_events(enriched)

    return {
        "symbol":     sym,
        "name":       asset_name,
        "asset_type": asset_type,
        "prices":     [round(p, 4) for p in prices],
        "dates":      dates,
        "volumes":    price_data.get("volumes", []),
        "events":     clustered,
        "event_count": len(clustered),
        "date_range": {"from": date_start, "to": date_end},
    }


def _cluster_events(events: List[Dict], window_days: int = 3) -> List[Dict]:
    """
    Group events within `window_days` of each other into clusters.
    Cluster representative = highest severity event.
    Cluster members available for expansion.
    """
    from datetime import date as _dt, timedelta as _td
    if not events:
        return []

    clusters = []
    used = set()

    for i, ev in enumerate(events):
        if i in used:
            continue
        cluster = [ev]
        used.add(i)
        ev_dt = _dt.fromisoformat(ev["date"])

        for j, other in enumerate(events[i+1:], i+1):
            if j in used:
                continue
            other_dt = _dt.fromisoformat(other["date"])
            if abs((other_dt - ev_dt).days) <= window_days:
                cluster.append(other)
                used.add(j)

        # Representative = highest severity
        rep = max(cluster, key=lambda e: e["severity"])
        if len(cluster) > 1:
            rep = dict(rep)
            rep["cluster_count"]   = len(cluster)
            rep["cluster_members"] = cluster
        clusters.append(rep)

    return clusters


@router.get("/historical-events/{symbol}/portfolio")
async def get_portfolio_historical_events(
    symbol: str,
    symbols: str = Query(..., description="Comma-separated list of symbols"),
    period: str = Query("1y"),
):
    """
    Portfolio mode: merge events from multiple assets, deduplicate,
    and note which assets each event impacts.
    """
    sym_list = [s.strip().upper() for s in symbols.split(",")][:8]
    all_events: Dict[str, Dict] = {}

    for sym in sym_list:
        r = await get_historical_events(sym, period=period, min_severity=5.5, max_events=30)
        for ev in r.get("events", []):
            eid = ev["id"]
            if eid not in all_events:
                ev["affected_assets"] = [sym]
                all_events[eid] = ev
            else:
                if sym not in all_events[eid].get("affected_assets", []):
                    all_events[eid].setdefault("affected_assets", []).append(sym)

    merged = sorted(all_events.values(), key=lambda e: -(e.get("relevance",0)*e.get("severity",5)))
    merged = sorted(merged[:50], key=lambda e: e["date"])
    return {"events": merged, "symbols": sym_list}
