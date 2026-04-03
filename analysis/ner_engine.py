"""
WorldLens — NER Engine
======================
Extracts named entities with type, salience, confidence, and relevance scores.
Identifies financial tickers ($AAPL, $TSLA) and commodities directly.

Primary:   spaCy (en_core_web_sm) + custom financial entity extensions
Secondary: Hugging Face dslim/bert-base-NER (fallback if spaCy absent)
Tertiary:  Pure rule-based regex + gazetteer (always available)

Entity types output:
  Person, Organization, Country, City, GPE (geo-political entity),
  Company, Ticker, Commodity, Currency, Index, Sector, Event
"""
from __future__ import annotations

import asyncio
import logging
import re
import threading
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

_NLP_LOCK     = threading.Lock()
_spacy_nlp    = None
_hf_ner_pipe  = None
_SPACY_LOADED = False
_HF_LOADED    = False

# ── Ticker gazetteer ──────────────────────────────────────
TICKER_MAP: Dict[str, str] = {
    # Mag-7
    "AAPL": "Apple", "MSFT": "Microsoft", "NVDA": "NVIDIA",
    "GOOGL": "Alphabet", "GOOG": "Alphabet", "AMZN": "Amazon",
    "META": "Meta", "TSLA": "Tesla",
    # Indices
    "SPX": "S&P 500", "SPY": "S&P 500 ETF", "QQQ": "Nasdaq ETF",
    "DJI": "Dow Jones", "VIX": "Volatility Index",
    # Banks / Finance
    "JPM": "JPMorgan", "GS": "Goldman Sachs", "BAC": "Bank of America",
    "MS": "Morgan Stanley", "C": "Citigroup", "WFC": "Wells Fargo",
    # Energy
    "XOM": "ExxonMobil", "CVX": "Chevron", "COP": "ConocoPhillips",
    # Other majors
    "BRK": "Berkshire Hathaway", "UNH": "UnitedHealth",
    "V": "Visa", "MA": "Mastercard", "WMT": "Walmart",
}

COMMODITY_MAP: Dict[str, str] = {
    # Explicit commodity names
    "gold": "Gold", "silver": "Silver", "copper": "Copper",
    "oil": "Crude Oil", "crude": "Crude Oil", "wti": "WTI Crude",
    "brent": "Brent Crude", "natural gas": "Natural Gas", "lng": "LNG",
    "wheat": "Wheat", "corn": "Corn", "soybean": "Soybeans",
    "cotton": "Cotton", "coffee": "Coffee", "sugar": "Sugar",
    "bitcoin": "Bitcoin", "btc": "Bitcoin", "ethereum": "Ethereum",
    "eth": "Ethereum", "solana": "Solana",
    "platinum": "Platinum", "palladium": "Palladium",
    "iron ore": "Iron Ore", "lithium": "Lithium", "cobalt": "Cobalt",
    "uranium": "Uranium", "nickel": "Nickel", "zinc": "Zinc",
}

CURRENCY_MAP: Dict[str, str] = {
    "usd": "USD", "eur": "EUR", "gbp": "GBP", "jpy": "JPY",
    "cny": "CNY", "yuan": "CNY", "renminbi": "CNY",
    "ruble": "RUB", "rupee": "INR", "real": "BRL",
    "franc": "CHF", "won": "KRW", "peso": "MXN",
    "dollar": "USD", "euro": "EUR", "pound": "GBP",
}

# Named organizations / institutions
ORG_NAMES: Dict[str, str] = {
    "fed": "Federal Reserve", "federal reserve": "Federal Reserve",
    "ecb": "European Central Bank", "boe": "Bank of England",
    "boj": "Bank of Japan", "pboc": "People's Bank of China",
    "imf": "IMF", "world bank": "World Bank",
    "opec": "OPEC", "nato": "NATO", "un": "United Nations",
    "eu": "European Union", "g7": "G7", "g20": "G20",
    "wto": "WTO", "who": "WHO", "sec": "SEC", "cftc": "CFTC",
}

# ── salience computation ──────────────────────────────────

def _salience_score(entity_text: str, full_text: str) -> float:
    """
    Compute salience 0–1:
      - Frequency in text
      - Position (title mentions worth more)
      - Capitalisation (proper noun signal)
    """
    tl   = full_text.lower()
    et   = entity_text.lower()
    freq = tl.count(et)
    if freq == 0:
        return 0.1
    # Title bonus: if entity appears in first 100 chars
    title_bonus = 0.2 if et in tl[:100] else 0.0
    # Normalise frequency
    freq_score  = min(1.0, freq / 5) * 0.6
    return round(min(1.0, freq_score + title_bonus + 0.2), 3)


def _relevance_score(entity_type: str, category: str, salience: float) -> float:
    """
    Relevance 0–1: how central is this entity TYPE to the news CATEGORY.
    """
    type_cat_weights: Dict[str, Dict[str, float]] = {
        "Company":   {"FINANCE": 0.9, "ECONOMICS": 0.8, "TECHNOLOGY": 0.9, "GEOPOLITICS": 0.5},
        "Ticker":    {"FINANCE": 1.0, "ECONOMICS": 0.9, "TECHNOLOGY": 0.9},
        "Commodity": {"ENERGY": 1.0,  "ECONOMICS": 0.7, "CONFLICT": 0.6, "GEOPOLITICS": 0.6},
        "Currency":  {"FINANCE": 0.9, "ECONOMICS": 0.9, "GEOPOLITICS": 0.5},
        "Country":   {"CONFLICT": 0.9,"GEOPOLITICS": 0.9,"POLITICS": 0.8, "ECONOMICS": 0.6},
        "Person":    {"POLITICS": 0.8, "GEOPOLITICS": 0.7},
        "Index":     {"FINANCE": 0.9, "ECONOMICS": 0.8},
    }
    cat_map  = type_cat_weights.get(entity_type, {})
    type_rel = cat_map.get(category, 0.4)
    return round(min(1.0, type_rel * 0.7 + salience * 0.3), 3)


# ── spaCy loader ──────────────────────────────────────────

def _load_spacy() -> bool:
    global _spacy_nlp, _SPACY_LOADED
    with _NLP_LOCK:
        if _SPACY_LOADED:
            return _spacy_nlp is not None
        try:
            import spacy  # type: ignore
            _spacy_nlp    = spacy.load("en_core_web_sm")
            _SPACY_LOADED = True
            logger.info("spaCy en_core_web_sm loaded")
            return True
        except Exception as e:
            _SPACY_LOADED = True
            logger.info("spaCy not available (%s) — rule-based NER fallback", type(e).__name__)
            return False


def _load_hf_ner() -> bool:
    global _hf_ner_pipe, _HF_LOADED
    with _NLP_LOCK:
        if _HF_LOADED:
            return _hf_ner_pipe is not None
        try:
            from transformers import pipeline  # type: ignore
            _hf_ner_pipe = pipeline("ner", model="dslim/bert-base-NER",
                                    aggregation_strategy="simple", device=-1)
            _HF_LOADED = True
            logger.info("HF NER model loaded (dslim/bert-base-NER)")
            return True
        except Exception as e:
            _HF_LOADED = True
            logger.info("HF NER not available (%s)", type(e).__name__)
            return False


# ── Rule-based extraction ─────────────────────────────────

_TICKER_PATTERN = re.compile(r'\$([A-Z]{1,5})\b')   # $AAPL, $TSLA

def _extract_tickers(text: str) -> List[Dict]:
    """Extract $TICKER mentions with confidence 1.0."""
    found = []
    for m in _TICKER_PATTERN.finditer(text):
        sym = m.group(1)
        if sym in TICKER_MAP:
            found.append({
                "text":       "$" + sym,
                "type":       "Ticker",
                "canonical":  TICKER_MAP[sym],
                "salience":   1.0,
                "confidence": 1.0,
            })
    return found


def _extract_commodities(text: str) -> List[Dict]:
    """Extract commodity mentions (longest-match first)."""
    tl    = text.lower()
    found = []
    seen  = set()
    for kw in sorted(COMMODITY_MAP, key=len, reverse=True):
        if kw in tl and COMMODITY_MAP[kw] not in seen:
            found.append({
                "text":       COMMODITY_MAP[kw],
                "type":       "Commodity",
                "canonical":  COMMODITY_MAP[kw],
                "salience":   _salience_score(kw, tl),
                "confidence": 0.90,
            })
            seen.add(COMMODITY_MAP[kw])
    return found[:4]


def _extract_currencies(text: str) -> List[Dict]:
    tl    = text.lower()
    found = []
    seen  = set()
    for kw, sym in sorted(CURRENCY_MAP.items(), key=lambda x: -len(x[0])):
        if kw in tl and sym not in seen:
            found.append({
                "text":       sym,
                "type":       "Currency",
                "canonical":  sym,
                "salience":   _salience_score(kw, tl),
                "confidence": 0.88,
            })
            seen.add(sym)
    return found[:3]


def _extract_orgs(text: str) -> List[Dict]:
    tl    = text.lower()
    found = []
    seen  = set()
    for kw, full_name in sorted(ORG_NAMES.items(), key=lambda x: -len(x[0])):
        if kw in tl and full_name not in seen:
            found.append({
                "text":       full_name,
                "type":       "Organization",
                "canonical":  full_name,
                "salience":   _salience_score(kw, tl),
                "confidence": 0.85,
            })
            seen.add(full_name)
    return found[:4]


def _rule_ner(text: str, category: str) -> List[Dict]:
    """Pure rule-based NER (always available fallback)."""
    entities = []
    entities.extend(_extract_tickers(text))
    entities.extend(_extract_commodities(text))
    entities.extend(_extract_currencies(text))
    entities.extend(_extract_orgs(text))
    # Deduplicate
    seen = set()
    result = []
    for e in entities:
        key = e["text"].lower()
        if key not in seen:
            seen.add(key)
            e["relevance"] = _relevance_score(e["type"], category, e.get("salience", 0.5))
            result.append(e)
    return result[:8]


# ── spaCy inference ───────────────────────────────────────

def _spacy_ner(text: str, category: str) -> List[Dict]:
    """spaCy NER + custom financial entity enrichment."""
    if _spacy_nlp is None:
        return _rule_ner(text, category)
    try:
        doc     = _spacy_nlp(text[:1000])
        seen    = set()
        results = []

        # spaCy entities
        _SPACY_TYPE_MAP = {
            "PERSON": "Person", "ORG": "Organization", "GPE": "Country",
            "LOC": "Country", "NORP": "Country", "PRODUCT": "Company",
            "EVENT": "Event", "MONEY": "Currency", "PERCENT": "Metric",
        }
        for ent in doc.ents:
            mapped_type = _SPACY_TYPE_MAP.get(ent.label_, "Organization")
            if ent.text.lower() in seen or len(ent.text) < 2:
                continue
            seen.add(ent.text.lower())
            sal  = _salience_score(ent.text, text)
            rel  = _relevance_score(mapped_type, category, sal)
            results.append({
                "text":       ent.text,
                "type":       mapped_type,
                "canonical":  ent.text,
                "salience":   sal,
                "relevance":  rel,
                "confidence": 0.82,
            })

        # Overlay financial entities (higher confidence)
        for ent in _rule_ner(text, category):
            if ent["text"].lower() not in seen:
                seen.add(ent["text"].lower())
                results.append(ent)

        # Sort: relevance × salience
        results.sort(key=lambda e: -(e.get("relevance", 0) * e.get("salience", 0)))
        return results[:8]
    except Exception as e:
        logger.debug("spaCy error: %s", e)
        return _rule_ner(text, category)


# ══════════════════════════════════════════════════════════
# PUBLIC ASYNC API
# ══════════════════════════════════════════════════════════

async def extract_entities(title: str, body: str, category: str = "") -> List[Dict]:
    """
    Extract named entities with full metadata.

    Returns list of:
      {text, type, canonical, salience, relevance, confidence,
       ticker (if Ticker type), sentiment_hint}
    """
    # Ensure models loaded on first call
    if not _SPACY_LOADED:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _load_spacy)

    text  = f"{title}. {body}"[:800]
    loop  = asyncio.get_event_loop()

    if _spacy_nlp is not None:
        entities = await loop.run_in_executor(None, _spacy_ner, text, category)
    else:
        entities = await loop.run_in_executor(None, _rule_ner, text, category)

    return entities


async def extract_tickers_from_text(text: str) -> List[str]:
    """
    Quickly extract ticker symbols ($AAPL etc.) from a text string.
    Returns list of canonical ticker symbols.
    """
    loop = asyncio.get_event_loop()
    entities = await loop.run_in_executor(None, _extract_tickers, text)
    return [e["text"].replace("$","") for e in entities if e["type"] == "Ticker"]


def get_financial_entities(entities: List[Dict]) -> Dict[str, List[str]]:
    """
    Group extracted entities by financial type.
    Returns {tickers, commodities, currencies, organizations, countries}
    """
    groups: Dict[str, List[str]] = {
        "tickers": [], "commodities": [], "currencies": [],
        "organizations": [], "countries": [],
    }
    for e in entities:
        t = e.get("type", "")
        name = e.get("canonical") or e.get("text", "")
        if t == "Ticker":        groups["tickers"].append(name)
        elif t == "Commodity":   groups["commodities"].append(name)
        elif t == "Currency":    groups["currencies"].append(name)
        elif t == "Organization":groups["organizations"].append(name)
        elif t in ("Country", "GPE"): groups["countries"].append(name)
    return groups


def init_ner_models():
    """Eager background load of NER models."""
    import threading
    def _init():
        _load_spacy()
    threading.Thread(target=_init, daemon=True, name="ner-init").start()
