"""
tradgentic/polymarket.py
Polymarket API integration — prediction market data as exogenous features.
Endpoint: https://gamma-api.polymarket.com/markets

No API key required for public markets.
"""
from __future__ import annotations
import time, logging, random
from typing import List, Dict, Optional
import httpx

logger = logging.getLogger(__name__)

_POLY_CACHE: Optional[Dict] = None
_POLY_TS:    float = 0
_CACHE_TTL:  float = 180  # 3 minutes


POLYMARKET_ENDPOINT = "https://gamma-api.polymarket.com/markets"

# ── Financial / macro relevant categories ─────────────────────────────────────
RELEVANT_TAGS = {
    "economics", "finance", "crypto", "politics", "us-politics",
    "technology", "federal-reserve", "inflation", "recession",
    "election", "regulation", "trade", "energy",
}


async def fetch_trending(limit: int = 20) -> List[Dict]:
    """
    Fetch top trending Polymarket markets.
    Returns list of dicts with: id, question, probability, volume, category, trend.
    Falls back to curated synthetic data if API unreachable.
    """
    global _POLY_CACHE, _POLY_TS

    if _POLY_CACHE and time.time() - _POLY_TS < _CACHE_TTL:
        return _POLY_CACHE[:limit]

    try:
        params = {
            "active":    "true",
            "closed":    "false",
            "limit":     str(min(limit * 3, 100)),
            "order":     "volume24hr",
            "ascending": "false",
        }
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(POLYMARKET_ENDPOINT, params=params)
            if resp.status_code != 200:
                raise ValueError(f"HTTP {resp.status_code}")
            data = resp.json()

        markets  = data if isinstance(data, list) else data.get("markets", [])
        result   = []
        for m in markets[:limit * 2]:
            tokens = m.get("tokens") or m.get("outcomePrices") or []
            # Parse YES probability
            yes_prob = None
            if isinstance(tokens, list):
                for t in tokens:
                    if isinstance(t, dict) and t.get("outcome", "").upper() == "YES":
                        try:
                            yes_prob = float(t.get("price", 0))
                        except Exception:
                            pass
            if yes_prob is None:
                continue
            result.append({
                "id":          m.get("id", ""),
                "question":    m.get("question", m.get("title", ""))[:100],
                "probability": round(yes_prob, 3),
                "volume_24h":  round(float(m.get("volume24hr", 0) or 0), 0),
                "category":    _categorise(m.get("question", "")),
                "trend":       _trend_label(yes_prob),
                "slug":        m.get("slug", ""),
                "end_date":    m.get("endDate", "")[:10] if m.get("endDate") else "",
            })
        # Sort by vol
        result.sort(key=lambda x: x["volume_24h"], reverse=True)
        _POLY_CACHE = result[:limit]
        _POLY_TS    = time.time()
        return _POLY_CACHE

    except Exception as e:
        logger.debug("Polymarket API error: %s — using synthetic data", e)
        synthetic = _synthetic_markets(limit)
        _POLY_CACHE = synthetic
        _POLY_TS    = time.time()
        return synthetic


def _categorise(question: str) -> str:
    q = question.lower()
    if any(w in q for w in ["bitcoin","btc","ethereum","crypto","solana"]):
        return "Crypto"
    if any(w in q for w in ["fed","interest rate","inflation","gdp","recession"]):
        return "Macro"
    if any(w in q for w in ["election","president","senate","congress","vote"]):
        return "Politics"
    if any(w in q for w in ["ai","openai","nvidia","tech","regulation"]):
        return "Tech"
    if any(w in q for w in ["oil","energy","opec","gas"]):
        return "Energy"
    return "Markets"


def _trend_label(prob: float) -> str:
    if prob >= 0.75:
        return "strong_yes"
    if prob >= 0.55:
        return "leaning_yes"
    if prob <= 0.25:
        return "strong_no"
    if prob <= 0.45:
        return "leaning_no"
    return "uncertain"


def _synthetic_markets(n: int) -> List[Dict]:
    """Realistic synthetic prediction markets for demo/fallback."""
    rng = random.Random(int(time.time() / 3600))  # stable per hour
    base = [
        ("Will BTC close above $70k this month?",        rng.uniform(.40,.75), "Crypto",   "strong_yes"),
        ("Will the Fed cut rates in Q2 2026?",           rng.uniform(.35,.65), "Macro",    "uncertain"),
        ("Will inflation drop below 2.5% by June?",      rng.uniform(.30,.60), "Macro",    "leaning_no"),
        ("Will NVIDIA beat earnings estimates?",          rng.uniform(.55,.80), "Tech",     "strong_yes"),
        ("Will ETH ETF see $1B+ inflows this week?",     rng.uniform(.20,.50), "Crypto",   "leaning_no"),
        ("Will oil price exceed $90/barrel by July?",    rng.uniform(.25,.55), "Energy",   "uncertain"),
        ("Will S&P 500 reach all-time high in May?",     rng.uniform(.45,.70), "Markets",  "leaning_yes"),
        ("Will US GDP growth exceed 2.5% in Q1?",        rng.uniform(.35,.60), "Macro",    "uncertain"),
        ("Will Apple launch new AI chip this quarter?",  rng.uniform(.60,.85), "Tech",     "strong_yes"),
        ("Will gold hit $2,500/oz before Q3?",           rng.uniform(.40,.65), "Markets",  "leaning_yes"),
        ("Will VIX spike above 25 this month?",          rng.uniform(.15,.40), "Markets",  "leaning_no"),
        ("Will crypto market cap exceed $3T?",           rng.uniform(.30,.60), "Crypto",   "uncertain"),
    ]
    result = []
    for i, (q, prob, cat, trend) in enumerate(base[:n]):
        result.append({
            "id":          f"poly-{i+1:03d}",
            "question":    q,
            "probability": round(prob, 3),
            "volume_24h":  round(rng.uniform(50_000, 5_000_000), 0),
            "category":    cat,
            "trend":       _trend_label(prob),
            "slug":        "",
            "end_date":    "",
        })
    result.sort(key=lambda x: x["volume_24h"], reverse=True)
    return result


def poly_to_feature(markets: List[Dict]) -> Dict[str, float]:
    """
    Convert Polymarket data into scalar features for ML models.
    Returns: {feature_name: value}
    """
    features = {}
    cat_probs: Dict[str, List[float]] = {}

    for m in markets:
        cat = m.get("category", "Markets")
        if cat not in cat_probs:
            cat_probs[cat] = []
        cat_probs[cat].append(m["probability"])

    for cat, probs in cat_probs.items():
        features[f"poly_{cat.lower()}_avg"] = round(sum(probs) / len(probs), 3)
        features[f"poly_{cat.lower()}_max"] = round(max(probs), 3)

    # Crypto and Macro sentiment score (0=bearish, 1=bullish)
    crypto_probs = cat_probs.get("Crypto", [0.5])
    macro_probs  = cat_probs.get("Macro",  [0.5])
    features["poly_crypto_sentiment"] = round(sum(crypto_probs) / len(crypto_probs), 3)
    features["poly_macro_sentiment"]  = round(sum(macro_probs)  / len(macro_probs),  3)
    return features
