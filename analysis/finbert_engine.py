"""
WorldLens — FinBERT Sentiment Engine
=====================================
Primary:  ProsusAI/finbert  (HuggingFace transformers)
Fallback: rule-based lexicon when model unavailable
Secondary: BERT-based deduplication via sentence embeddings

Usage:
    from analysis.finbert_engine import finbert_sentiment, bert_similarity
    result = await finbert_sentiment(title, text)
    sim    = bert_similarity(text_a, text_b)   # sync, for dedup

Design decisions:
  - Model loaded once at module level (lazy, thread-safe via _MODEL_LOCK)
  - asyncio.run_in_executor for CPU-bound inference (never blocks event loop)
  - Graceful degradation: if torch/transformers absent → rule-based fallback
  - BERT embeddings pooled with mean-pooling (not just [CLS]) for better sentence similarity
"""
from __future__ import annotations

import asyncio
import logging
import math
import re
import threading
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── lazy model state ──────────────────────────────────────
_MODEL_LOCK = threading.Lock()
_finbert_pipeline = None   # transformers pipeline object
_embed_model      = None   # sentence-transformers model
_embed_tokenizer  = None
_FINBERT_LOADED   = False
_EMBED_LOADED     = False

# ── FinBERT label → polarity ──────────────────────────────
_LABEL_SCORE = {"positive": 1.0, "negative": -1.0, "neutral": 0.0}

# ── rule-based fallback lexicons (mirrors ai_layer._NEG/_POS) ────────
_FIN_POS = [
    "profit", "growth", "gain", "surge", "rally", "beat", "record", "upgrade",
    "bull", "expansion", "recovery", "outperform", "strong", "positive",
    "agreement", "deal", "partnership", "approved", "ceasefire", "peace",
]
_FIN_NEG = [
    "loss", "decline", "crash", "recession", "default", "miss", "downgrade",
    "bear", "contraction", "crisis", "sanction", "war", "attack", "collapse",
    "cut", "fall", "drop", "debt", "bankruptcy", "inflation", "tariff", "ban",
]
_FINANCE_TERMS = {
    "equities": "equity",  "bonds": "bond", "treasuries": "bond",
    "fx": "forex",         "commodities": "commodity",
    "crypto": "crypto",    "etf": "fund", "yield": "bond",
}

# ── Sector classification rules ───────────────────────────
SECTOR_RULES: List[Tuple[str, List[str]]] = [
    ("Energy",         ["oil","gas","opec","pipeline","energy","lng","refinery","petroleum","brent","wti"]),
    ("Technology",     ["ai","semiconductor","chip","tech","software","cybersecurity","cloud","5g","quantum","nvidia","apple","microsoft","google"]),
    ("Financials",     ["bank","fed","rate","bond","credit","liquidity","ecb","imf","inflation","yield","currency","forex","crypto","bitcoin"]),
    ("Defence",        ["military","weapon","nato","defense","arms","missile","airstrike","war","troops","sanctions"]),
    ("Healthcare",     ["pharma","vaccine","fda","clinical","drug","outbreak","pandemic","who","biotech"]),
    ("Materials",      ["gold","copper","steel","mining","commodity","iron","lithium","aluminium"]),
    ("Agriculture",    ["wheat","corn","soybean","food","crop","drought","harvest","grain"]),
    ("Geopolitics",    ["election","coup","sanction","diplomacy","president","summit","treaty","geopolit"]),
    ("Infrastructure", ["earthquake","flood","hurricane","disaster","infrastructure","rebuild","construction"]),
    ("Macro",          ["gdp","cpi","pmi","unemployment","trade deficit","fiscal","central bank","monetary"]),
]


def _load_finbert() -> bool:
    """Attempt to load ProsusAI/finbert once. Thread-safe."""
    global _finbert_pipeline, _FINBERT_LOADED
    with _MODEL_LOCK:
        if _FINBERT_LOADED:
            return _finbert_pipeline is not None
        try:
            from transformers import pipeline  # type: ignore
            _finbert_pipeline = pipeline(
                "text-classification",
                model="ProsusAI/finbert",
                tokenizer="ProsusAI/finbert",
                device=-1,      # CPU always (no GPU required)
                top_k=None,     # return all 3 labels
            )
            _FINBERT_LOADED = True
            logger.info("FinBERT loaded successfully (ProsusAI/finbert)")
            return True
        except Exception as e:
            _FINBERT_LOADED = True   # mark as attempted so we don't retry
            logger.info("FinBERT not available (%s) — using rule-based fallback", type(e).__name__)
            return False


def _load_embedder() -> bool:
    """Attempt to load a lightweight BERT embedder for deduplication."""
    global _embed_model, _embed_tokenizer, _EMBED_LOADED
    with _MODEL_LOCK:
        if _EMBED_LOADED:
            return _embed_model is not None
        try:
            from transformers import AutoTokenizer, AutoModel  # type: ignore
            _embed_tokenizer = AutoTokenizer.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
            _embed_model     = AutoModel.from_pretrained("sentence-transformers/all-MiniLM-L6-v2")
            _EMBED_LOADED = True
            logger.info("Sentence embedder loaded (all-MiniLM-L6-v2)")
            return True
        except Exception as e:
            _EMBED_LOADED = True
            logger.info("Sentence embedder not available (%s) — cosine on TF-IDF fallback", type(e).__name__)
            return False


# ── Inference functions (CPU-bound, run in executor) ──────

def _finbert_infer(text: str) -> Dict:
    """Synchronous FinBERT inference. Call via run_in_executor."""
    if _finbert_pipeline is None:
        return _rule_finbert(text)
    try:
        # Truncate to 512 tokens (FinBERT limit)
        truncated = text[:512]
        outputs = _finbert_pipeline(truncated)
        # outputs = [[{'label': 'positive', 'score': 0.9}, ...]]
        if isinstance(outputs, list) and len(outputs) > 0:
            labels = outputs[0] if isinstance(outputs[0], list) else outputs
            label_map = {item["label"].lower(): item["score"] for item in labels}
            pos = label_map.get("positive", 0.0)
            neg = label_map.get("negative", 0.0)
            neu = label_map.get("neutral",  0.0)
            # Polarity: weighted score in [-1, +1]
            polarity  = round(pos - neg, 4)
            # Dominant label
            dominant  = max(label_map, key=label_map.get)
            confidence = label_map[dominant]
            # Market stress: how much negative probability
            market_stress = round(neg * 0.8 + (1 - neu) * 0.2, 3)
            return {
                "score":         polarity,
                "tone":          dominant.capitalize(),
                "positive_prob": round(pos, 4),
                "negative_prob": round(neg, 4),
                "neutral_prob":  round(neu, 4),
                "confidence":    round(confidence, 4),
                "market_stress": round(market_stress, 3),
                "model":         "finbert",
            }
    except Exception as e:
        logger.debug("FinBERT inference error: %s", e)
    return _rule_finbert(text)


def _rule_finbert(text: str) -> Dict:
    """Rule-based fallback matching FinBERT output schema."""
    tl = text.lower()
    pos_hits = sum(1 for w in _FIN_POS if w in tl)
    neg_hits = sum(1 for w in _FIN_NEG if w in tl)
    total    = max(pos_hits + neg_hits, 1)
    polarity = round(max(-1.0, min(1.0, (pos_hits - neg_hits) / total * 0.8)), 4)
    if polarity > 0.15:
        tone, pos_p, neg_p, neu_p = "Positive", 0.6 + polarity * 0.3, 0.1, 0.3 - polarity * 0.2
    elif polarity < -0.15:
        tone, pos_p, neg_p, neu_p = "Negative", 0.1, 0.6 + abs(polarity) * 0.3, 0.3 - abs(polarity) * 0.2
    else:
        tone, pos_p, neg_p, neu_p = "Neutral", 0.2, 0.2, 0.6
    return {
        "score":         polarity,
        "tone":          tone,
        "positive_prob": round(pos_p, 4),
        "negative_prob": round(neg_p, 4),
        "neutral_prob":  round(max(0, neu_p), 4),
        "confidence":    0.55,
        "market_stress": round(max(0, neg_p * 0.7), 3),
        "model":         "rule-based",
    }


def _embed_text(text: str) -> List[float]:
    """Synchronous BERT mean-pool embedding. Call via run_in_executor."""
    if _embed_model is None or _embed_tokenizer is None:
        return _tfidf_embed(text)
    try:
        import torch  # type: ignore
        inputs  = _embed_tokenizer(text[:256], return_tensors="pt",
                                   truncation=True, padding=True, max_length=128)
        with torch.no_grad():
            outputs = _embed_model(**inputs)
        # Mean-pool last hidden state
        hidden     = outputs.last_hidden_state            # (1, seq_len, 384)
        attention  = inputs["attention_mask"]             # (1, seq_len)
        mask_exp   = attention.unsqueeze(-1).float()
        pooled     = (hidden * mask_exp).sum(dim=1) / mask_exp.sum(dim=1)
        vec        = pooled[0].numpy().tolist()
        # L2-normalise
        norm = math.sqrt(sum(v * v for v in vec)) or 1e-9
        return [round(v / norm, 6) for v in vec]
    except Exception as e:
        logger.debug("Embedding error: %s", e)
        return _tfidf_embed(text)


def _tfidf_embed(text: str) -> List[float]:
    """
    Fast TF-IDF style 64-dim bag-of-words embedding (no deps).
    Used when transformers not available.
    """
    import hashlib
    words = re.findall(r"\b\w{3,}\b", text.lower())
    if not words:
        return [0.0] * 64
    vec = [0.0] * 64
    for w in words:
        idx = int(hashlib.md5(w.encode()).hexdigest(), 16) % 64
        vec[idx] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1e-9
    return [round(v / norm, 6) for v in vec]


def _cosine(a: List[float], b: List[float]) -> float:
    """Cosine similarity between two vectors."""
    n = min(len(a), len(b))
    dot = sum(a[i] * b[i] for i in range(n))
    na  = math.sqrt(sum(v * v for v in a)) or 1e-9
    nb  = math.sqrt(sum(v * v for v in b)) or 1e-9
    return round(dot / (na * nb), 4)


# ── Sector classification ─────────────────────────────────

def classify_sectors(text: str) -> List[str]:
    """
    Rule-based multi-label sector classification.
    Returns list of relevant sectors, sorted by match count.
    """
    tl  = text.lower()
    hits = []
    for sector, keywords in SECTOR_RULES:
        count = sum(1 for kw in keywords if kw in tl)
        if count > 0:
            hits.append((sector, count))
    hits.sort(key=lambda x: -x[1])
    return [s for s, _ in hits[:3]]


# ══════════════════════════════════════════════════════════
# PUBLIC ASYNC API
# ══════════════════════════════════════════════════════════

async def finbert_sentiment(title: str, body: str, category: str = "",
                             source: str = "") -> Dict:
    """
    FinBERT-powered sentiment analysis.

    Returns extended dict compatible with ai_layer.ai_sentiment() output:
      score, tone, intensity, uncertainty, market_stress, confidence,
      credibility, entity_sentiments, positive_prob, negative_prob,
      sectors, model (finbert | rule-based)
    """
    # Ensure model is loaded (first call may be slow)
    if not _FINBERT_LOADED:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _load_finbert)

    text = f"{title}. {body}"[:600]
    loop = asyncio.get_event_loop()
    raw  = await loop.run_in_executor(None, _finbert_infer, text)

    # Augment with additional dimensions
    score    = raw["score"]
    tone     = raw["tone"]
    confidence = raw["confidence"]

    # Uncertainty from hedge words
    hedge_words  = ["may", "might", "could", "reportedly", "allegedly", "unclear",
                    "uncertain", "unconfirmed", "possibly", "perhaps", "warn"]
    tl           = text.lower()
    hedge_hits   = sum(1 for w in hedge_words if w in tl)
    uncertainty  = round(min(1.0, hedge_hits / 8), 3)

    # Narrative momentum (rough proxy: presence of escalation / resolution words)
    escal_words  = ["surge", "escalate", "intensif", "spread", "worsen", "mount"]
    resol_words  = ["resolve", "ceasefire", "stabilize", "deescalate", "recover"]
    escal = sum(1 for w in escal_words if w in tl)
    resol = sum(1 for w in resol_words if w in tl)
    momentum = round(max(-1.0, min(1.0, (escal - resol) / max(escal + resol, 1))), 3)

    # Sectors
    sectors = classify_sectors(text)

    # Credibility (reuse existing registry)
    from ai_layer import SOURCE_CREDIBILITY, DEFAULT_CREDIBILITY
    credibility = SOURCE_CREDIBILITY.get(source, DEFAULT_CREDIBILITY)

    # Intensity label
    abs_score = abs(score)
    if abs_score > 0.65:  intensity = "Extreme"
    elif abs_score > 0.40: intensity = "High"
    elif abs_score > 0.20: intensity = "Medium"
    else:                  intensity = "Low"

    return {
        # core (compatible with ai_layer schema)
        "score":               score,
        "tone":                tone,
        "intensity":           intensity,
        "uncertainty":         uncertainty,
        "market_stress":       raw["market_stress"],
        "narrative_momentum":  momentum,
        "credibility":         credibility,
        "confidence":          confidence,
        "entity_sentiments":   [],
        "fallback":            (raw["model"] == "rule-based"),
        # extended FinBERT fields
        "positive_prob":       raw.get("positive_prob", 0.0),
        "negative_prob":       raw.get("negative_prob", 0.0),
        "neutral_prob":        raw.get("neutral_prob",  0.0),
        "sectors":             sectors,
        "model":               raw["model"],
    }


async def bert_embed(text: str) -> List[float]:
    """Async BERT embedding (for deduplication and similarity)."""
    if not _EMBED_LOADED:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _load_embedder)
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _embed_text, text[:512])


async def bert_similarity(text_a: str, text_b: str) -> float:
    """Semantic similarity via BERT embeddings (0–1)."""
    ea, eb = await asyncio.gather(bert_embed(text_a), bert_embed(text_b))
    return _cosine(ea, eb)


def init_models():
    """
    Eagerly load models at startup (call from main.py lifespan).
    Runs in background thread to avoid blocking startup.
    """
    import threading
    def _init():
        _load_finbert()
        _load_embedder()
    threading.Thread(target=_init, daemon=True, name="finbert-init").start()
