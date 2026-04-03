"""
WorldLens — Unified Impact Engine
===================================
Merges all intelligence layers into a single structured impact assessment:

  FinBERT sentiment  →  polarity, sector classification
  NER engine         →  entities (tickers, commodities, countries)
  GDELT context      →  global event tone, actor network
  Knowledge graph    →  cascade propagation through geo-political graph
  Factor model       →  existing _FACTOR_MAP (from ai_layer.py)

Output schema (compatible with existing Show Impact endpoint):
  short_term, long_term, overall_magnitude, key_insight,
  historical_precedent, probability_distribution,
  + extended fields:
    finbert_score, finbert_confidence, sectors,
    entities, graph_cascade, market_signals, gdelt_tone
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Lazy imports for optional deps ───────────────────────

def _finbert():
    from analysis.finbert_engine import finbert_sentiment
    return finbert_sentiment

def _ner():
    from analysis.ner_engine import extract_entities, get_financial_entities
    return extract_entities, get_financial_entities

def _kg():
    from analysis.knowledge_graph import get_cascade_impact
    return get_cascade_impact


# ── Asset direction labels ────────────────────────────────
_SIGNAL_ASSET_LABELS: Dict[str, str] = {
    "OIL": "Crude Oil",  "GLD": "Gold",     "GAS": "Natural Gas",
    "WHL": "Wheat",      "CPR": "Copper",   "LIT": "Lithium",
    "SEM": "Semiconductors", "BTC": "Bitcoin",
    "SPX": "S&P 500",    "NKY": "Nikkei",   "DAX": "DAX",
    "VIX": "VIX",        "USD": "USD Index", "EUR": "EUR/USD",
    "JPY": "USD/JPY",
}


async def compute_full_impact(
    title: str,
    summary: str,
    category: str,
    country: str,
    severity: float,
    source: str = "",
    gdelt_tone: Optional[float] = None,
) -> Dict:
    """
    Full-stack impact assessment pipeline.

    Runs FinBERT + NER + Knowledge Graph in parallel, then fuses:
      1. FinBERT polarity & confidence
      2. NER-extracted tickers / commodities / countries
      3. KG cascade from extracted entities
      4. Existing factor-model baseline from ai_layer
      5. Gemini/Claude refinement (if API key present)

    Returns dict compatible with existing Show Impact response schema.
    """
    text = f"{title}. {summary or ''}"

    # ── Run parallel analysis ──────────────────────────────
    tasks = {
        "finbert": _run_finbert(title, summary, category, source),
        "ner":     _run_ner(title, summary, category),
    }
    results = {}
    coros   = list(tasks.values())
    keys    = list(tasks.keys())
    done    = await asyncio.gather(*coros, return_exceptions=True)
    for k, r in zip(keys, done):
        results[k] = r if not isinstance(r, Exception) else None

    fb  = results.get("finbert") or {}
    ner = results.get("ner")     or []

    # ── Knowledge graph cascade ───────────────────────────
    kg_result: Dict = {}
    try:
        _get_cascade = _kg()
        entity_texts = [e.get("text","") for e in ner]
        kg_result    = _get_cascade(entity_texts, ner, title, summary)
    except Exception as e:
        logger.debug("KG cascade error: %s", e)

    # ── Factor model baseline ─────────────────────────────
    from ai_layer import _build_factor_impacts, _ANALOGS
    short_base, long_base = _build_factor_impacts(category, severity)

    # ── Enrich short/long with KG market signals ──────────
    kg_signals = kg_result.get("market_signals", {})
    if kg_signals:
        kg_shorts = _signals_to_impact_items(kg_signals, "1-7 days")
        kg_longs  = _signals_to_impact_items(kg_signals, "1-3 months")
        # Merge without duplicating existing instruments
        existing_shorts = {i["instrument"].lower() for i in short_base}
        for item in kg_shorts:
            if item["instrument"].lower() not in existing_shorts:
                short_base.append(item)
        existing_longs = {i["instrument"].lower() for i in long_base}
        for item in kg_longs:
            if item["instrument"].lower() not in existing_longs:
                long_base.append(item)

    # ── Financial entities from NER ────────────────────────
    from analysis.ner_engine import get_financial_entities
    fin_entities = get_financial_entities(ner)

    # ── Ticker-specific signals ────────────────────────────
    # If FinBERT says Negative + ticker extracted → add ticker to short_term
    finbert_tone  = fb.get("tone", "Neutral")
    finbert_score = fb.get("score", 0.0)
    for ticker in fin_entities.get("tickers", [])[:2]:
        direction = "negative" if finbert_tone == "Negative" else "positive"
        short_base.insert(0, {
            "instrument": ticker,
            "type":       "stock",
            "direction":  direction,
            "magnitude":  round(abs(finbert_score) * 10, 1),
            "estimate":   f"FinBERT: {round(abs(finbert_score)*100,1)}% expected move",
            "timeframe":  "1-7 days",
            "reasoning":  f"Direct mention in article · FinBERT {finbert_tone}",
        })

    # ── Overall magnitude ─────────────────────────────────
    # Weighted: factor_severity (0.5) + FinBERT abs polarity (0.3) + KG_cascade (0.2)
    kg_strength   = max((c.get("impact_strength",0) for c in kg_result.get("cascade",[])), default=0)
    fb_magnitude  = abs(finbert_score) * 10
    magnitude     = round(severity * 0.5 + fb_magnitude * 0.3 + kg_strength * 10 * 0.2, 1)
    magnitude     = max(1.0, min(10.0, magnitude))
    mag_label     = "Critical" if magnitude >= 8.5 else "High" if magnitude >= 6.5 else \
                    "Medium" if magnitude >= 4.0 else "Low"

    # ── Probability distribution ──────────────────────────
    if finbert_tone == "Negative":
        prob = {"bullish": max(10, 25 - int(abs(finbert_score)*20)),
                "base":    50, "bearish": min(80, 25 + int(abs(finbert_score)*30))}
    elif finbert_tone == "Positive":
        prob = {"bullish": min(80, 25 + int(abs(finbert_score)*30)),
                "base":    50, "bearish": max(10, 25 - int(abs(finbert_score)*20))}
    else:
        prob = {"bullish": 25, "base": 50, "bearish": 25}

    # ── Key insight ───────────────────────────────────────
    # Synthesise from FinBERT + KG + NER
    insight_parts = []
    if fb.get("sectors"):
        insight_parts.append(f"Sectors most exposed: {', '.join(fb['sectors'][:2])}")
    if kg_result.get("affected_nodes"):
        insight_parts.append(f"KG cascade affects: {', '.join(kg_result['affected_nodes'][:3])}")
    if fin_entities.get("commodities"):
        insight_parts.append(f"Key commodities: {', '.join(fin_entities['commodities'][:2])}")
    insight = ". ".join(insight_parts) if insight_parts else (
        f"FinBERT: {finbert_tone} ({finbert_score:+.2f}). "
        f"Severity {severity:.0f}/10. Factor model baseline applied."
    )

    # ── Try AI refinement ──────────────────────────────────
    from ai_layer import _ai_available, _call_claude, _parse_json, _ANALOGS
    if _ai_available() and insight_parts:
        kg_summary = ", ".join(kg_result.get("affected_nodes", [])[:4])
        entity_summary = ", ".join([e.get("text","") for e in ner[:4]])
        prompt = (
            "Refine this market impact. Respond ONLY with JSON.\n\n"
            f"Event: {title}\n"
            f"FinBERT: {finbert_tone} ({finbert_score:+.2f}), Confidence: {fb.get('confidence',0.5):.2f}\n"
            f"NER Entities: {entity_summary}\n"
            f"KG Cascade: {kg_summary}\n"
            f"Category: {category}, Severity: {severity}/10\n\n"
            'Return: {"key_insight":"2 sentences for investors",'
            '"historical_precedent":"most relevant analog + outcome"}'
        )
        resp = await _call_claude(prompt, max_tokens=200)
        ai_data = _parse_json(resp)
        if ai_data:
            insight = ai_data.get("key_insight", insight)
            analog  = ai_data.get("historical_precedent", _ANALOGS.get(category,""))
        else:
            analog = _ANALOGS.get(category, "No direct historical analog.")
    else:
        analog = _ANALOGS.get(category, "No direct historical analog.")

    return {
        # ── Core impact (compatible with Show Impact schema) ──
        "short_term":             short_base[:5],
        "long_term":              long_base[:5],
        "overall_magnitude":      round(magnitude, 1),
        "magnitude_label":        mag_label,
        "key_insight":            insight,
        "historical_precedent":   analog,
        "probability_distribution": prob,
        # ── Extended intelligence fields ──────────────────────
        "finbert_score":          finbert_score,
        "finbert_tone":           finbert_tone,
        "finbert_confidence":     fb.get("confidence", 0.5),
        "finbert_positive_prob":  fb.get("positive_prob", 0.0),
        "finbert_negative_prob":  fb.get("negative_prob", 0.0),
        "sectors":                fb.get("sectors", []),
        "entities":               ner[:6],
        "financial_entities":     fin_entities,
        "kg_cascade":             kg_result.get("cascade", [])[:6],
        "kg_market_signals":      kg_result.get("market_signals", {}),
        "kg_seed_nodes":          kg_result.get("seed_nodes", []),
        "gdelt_tone":             gdelt_tone,
        "fallback":               False,
    }


# ── Helpers ───────────────────────────────────────────────

async def _run_finbert(title, summary, category, source) -> Dict:
    try:
        from analysis.finbert_engine import finbert_sentiment
        return await finbert_sentiment(title, summary, category, source)
    except Exception as e:
        logger.debug("FinBERT task error: %s", e)
        return {}

async def _run_ner(title, summary, category) -> List[Dict]:
    try:
        from analysis.ner_engine import extract_entities
        return await extract_entities(title, summary, category)
    except Exception as e:
        logger.debug("NER task error: %s", e)
        return []


def _signals_to_impact_items(signals: Dict[str, float], timeframe: str) -> List[Dict]:
    """Convert KG market_signals dict to impact item list."""
    items = []
    for asset_code, direction_score in signals.items():
        if abs(direction_score) < 0.2: continue
        label = _SIGNAL_ASSET_LABELS.get(asset_code, asset_code)
        items.append({
            "instrument": label,
            "type":       "commodity" if asset_code in ("OIL","GLD","GAS","WHL","CPR","LIT") else
                          "index"     if asset_code in ("SPX","NKY","DAX","VIX") else
                          "crypto"    if asset_code == "BTC" else "currency",
            "direction":  "positive" if direction_score > 0 else "negative",
            "magnitude":  round(abs(direction_score) * 10, 1),
            "estimate":   f"{abs(direction_score*100):.0f}% pressure expected",
            "timeframe":  timeframe,
            "reasoning":  "Knowledge graph cascade propagation",
        })
    return items


async def quick_finbert_sentiment(title: str, summary: str,
                                   category: str, source: str) -> Dict:
    """
    Lightweight entry point: FinBERT only, no KG/NER.
    Drop-in replacement for ai_layer.ai_sentiment() with richer output.
    """
    return await _run_finbert(title, summary, category, source)
