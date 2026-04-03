"""
WorldLens — Lightweight ML Engine (Sprint 4)
=============================================
All models run on Render free tier (512MB RAM, no GPU required).

Components:
  4.1  TF-IDF user profiling
       - Builds a per-user text vector from event titles they've read
       - Scores incoming events by relevance to that user's profile
       - Updates nightly (or on-demand for active users)
       - Memory: ~2MB per user, stored as JSON in user_models

  4.2  Alert false-positive filter
       - Decision tree that learns: which alert conditions this user
         actually opens vs ignores
       - Trains once >= 20 alert interaction samples are available
       - Inference: <1ms, zero memory overhead
       - Stored as base64-pickled sklearn model in user_models

  4.3  Semantic similarity (optional, requires sentence-transformers)
       - paraphrase-MiniLM-L3-v2 = 61MB download on first use
       - Finds events similar to a seed event by meaning, not keyword
       - Enabled only if ENABLE_SEMANTIC_SEARCH=true in config

Dependencies:
  scikit-learn   — TF-IDF + Decision Tree (always available, ~50MB)
  numpy          — array ops (always available)
  sentence-transformers — semantic embeddings (optional, 61MB model)
"""
from __future__ import annotations

import base64
import json
import logging
import math
import pickle
from typing import Dict, List, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

# ── Lazy imports for optional heavy deps ─────────────────────────────────────
_sklearn_ok = False
_st_ok      = False

try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise         import cosine_similarity
    from sklearn.tree                     import DecisionTreeClassifier
    from sklearn.preprocessing            import LabelEncoder
    _sklearn_ok = True
    logger.info("scikit-learn: available ✓")
except ImportError:
    logger.warning("scikit-learn not installed — ML features disabled. "
                   "Add scikit-learn to requirements.txt to enable.")

_embedder = None

def _load_embedder():
    """Lazy-load sentence-transformers model (61MB, downloads once)."""
    global _embedder, _st_ok
    if _embedder is not None:
        return _embedder
    try:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer("paraphrase-MiniLM-L3-v2")
        _st_ok = True
        logger.info("sentence-transformers: paraphrase-MiniLM-L3-v2 loaded ✓")
        return _embedder
    except Exception as e:
        logger.debug("sentence-transformers unavailable: %s", e)
        return None


# ── 4.1  TF-IDF User Profile ──────────────────────────────────────────────────

def build_user_tfidf_vector(texts: List[str]) -> Optional[Dict]:
    """
    Build a TF-IDF profile vector from a list of event titles/summaries.
    Returns a JSON-serialisable dict with the top-N feature weights.
    Returns None if sklearn unavailable or too few texts.
    """
    if not _sklearn_ok:
        return None
    if len(texts) < 5:
        return None

    try:
        vec  = TfidfVectorizer(
            max_features  = 200,
            stop_words    = "english",
            ngram_range   = (1, 2),
            min_df        = 1,
            sublinear_tf  = True,
        )
        matrix = vec.fit_transform(texts)
        # Mean vector across all documents = user interest centroid
        centroid = np.asarray(matrix.mean(axis=0)).flatten()
        feat     = vec.get_feature_names_out()

        # Keep only top-60 features (for storage efficiency)
        top_idx  = centroid.argsort()[::-1][:60]
        profile  = {feat[i]: round(float(centroid[i]), 6)
                    for i in top_idx if centroid[i] > 0}
        return profile
    except Exception as e:
        logger.debug("TF-IDF build error: %s", e)
        return None


def score_event_against_profile(profile: Dict[str, float], event_text: str) -> float:
    """
    Score a single event title+summary against a stored TF-IDF profile.
    Returns a float 0-1 (higher = more relevant to this user).
    """
    if not profile or not event_text:
        return 0.0
    try:
        words    = event_text.lower().split()
        score    = 0.0
        count    = 0
        for word in words:
            if word in profile:
                score += profile[word]
                count += 1
            # bigrams
            pass
        # Normalise by text length to avoid bias toward long texts
        norm = math.log1p(len(words)) if len(words) > 0 else 1.0
        return min(1.0, round(score / norm, 6))
    except Exception:
        return 0.0


# ── 4.2  Alert False-Positive Filter ─────────────────────────────────────────

def extract_alert_features(event: Dict) -> List[float]:
    """
    Extract numeric features from an event for the alert classifier.
    Returns a fixed-length feature vector.
    """
    cat_map = {
        "ECONOMICS": 0, "FINANCE": 1, "CONFLICT": 2, "GEOPOLITICS": 3,
        "ENERGY": 4, "TECHNOLOGY": 5, "POLITICS": 6, "DISASTER": 7,
        "HEALTH": 8, "HUMANITARIAN": 9, "SECURITY": 10, "TRADE": 11,
    }
    cat_idx = cat_map.get((event.get("category") or "").upper(), 12)
    return [
        float(event.get("severity",      5.0)),
        float(event.get("heat_index",    5.0)),
        float(event.get("source_count",  1)),
        float(event.get("sentiment_score", 0.0)),
        float(event.get("ai_impact_score", 5.0)),
        float(cat_idx),
        1.0 if event.get("sentiment_tone") == "negative" else 0.0,
        1.0 if event.get("sentiment_tone") == "positive" else 0.0,
    ]


def train_alert_filter(
    samples: List[Tuple[Dict, int]]   # (event_dict, opened:0/1)
) -> Optional[bytes]:
    """
    Train a Decision Tree to filter alert false positives.
    Returns pickled model bytes (store in user_models.model_data as base64).
    Returns None if sklearn unavailable or too few samples.
    """
    if not _sklearn_ok:
        return None
    if len(samples) < 15:   # need at least 15 examples
        return None

    try:
        X = [extract_alert_features(ev) for ev, _ in samples]
        y = [int(label) for _, label in samples]

        # Only train if we have both positive and negative examples
        if len(set(y)) < 2:
            return None

        clf = DecisionTreeClassifier(
            max_depth    = 4,
            min_samples_split = 3,
            min_samples_leaf  = 2,
            class_weight = "balanced",   # handles imbalanced open/ignore ratio
        )
        clf.fit(X, y)
        return pickle.dumps(clf)
    except Exception as e:
        logger.debug("Alert filter training error: %s", e)
        return None


def predict_alert_relevance(model_bytes: bytes, event: Dict) -> float:
    """
    Predict probability that this user will find the alert relevant.
    Returns 0-1 probability. Returns 0.5 (neutral) if model unavailable.
    """
    if not model_bytes or not _sklearn_ok:
        return 0.5
    try:
        clf  = pickle.loads(model_bytes)
        feat = [extract_alert_features(event)]
        prob = clf.predict_proba(feat)
        # Return probability of class 1 (user opens alert)
        classes = list(clf.classes_)
        if 1 in classes:
            return float(prob[0][classes.index(1)])
        return 0.5
    except Exception:
        return 0.5


# ── 4.3  Semantic Similarity ──────────────────────────────────────────────────

def find_similar_events(
    seed_text:  str,
    candidates: List[Dict],
    top_n:      int = 5,
    threshold:  float = 0.45,
) -> List[Dict]:
    """
    Find events semantically similar to seed_text using sentence embeddings.
    Falls back to TF-IDF cosine similarity if sentence-transformers unavailable.
    Returns up to top_n events with similarity > threshold.
    """
    if not candidates:
        return []

    texts = [(ev.get("title") or "") + " " + (ev.get("summary") or "")
             for ev in candidates]

    # Try semantic embeddings first
    model = _load_embedder()
    if model is not None:
        try:
            seed_emb  = model.encode([seed_text], show_progress_bar=False)
            cand_embs = model.encode(texts,        show_progress_bar=False)
            scores    = cosine_similarity(seed_emb, cand_embs)[0]

            scored = [(candidates[i], float(scores[i]))
                      for i in range(len(candidates))]
            scored.sort(key=lambda x: -x[1])
            return [{"event": ev, "similarity": round(s, 4)}
                    for ev, s in scored[:top_n] if s >= threshold]
        except Exception as e:
            logger.debug("Semantic similarity error: %s", e)

    # Fallback: TF-IDF cosine similarity
    if not _sklearn_ok:
        return []
    try:
        all_texts = [seed_text] + texts
        vec       = TfidfVectorizer(max_features=100, stop_words="english")
        matrix    = vec.fit_transform(all_texts)
        seed_vec  = matrix[0]
        cand_mat  = matrix[1:]
        scores    = cosine_similarity(seed_vec, cand_mat)[0]

        scored = [(candidates[i], float(scores[i]))
                  for i in range(len(candidates))]
        scored.sort(key=lambda x: -x[1])
        return [{"event": ev, "similarity": round(s, 4)}
                for ev, s in scored[:top_n] if s >= threshold]
    except Exception as e:
        logger.debug("TF-IDF similarity fallback error: %s", e)
        return []


# ── Serialisation helpers ─────────────────────────────────────────────────────

def model_to_b64(model_bytes: bytes) -> str:
    return base64.b64encode(model_bytes).decode("utf-8")


def model_from_b64(b64: str) -> bytes:
    return base64.b64decode(b64.encode("utf-8"))


def tfidf_to_json(profile: Dict) -> str:
    return json.dumps(profile, separators=(",", ":"))


def tfidf_from_json(s: str) -> Dict:
    try:
        return json.loads(s) if s else {}
    except Exception:
        return {}


# ── Status helper ─────────────────────────────────────────────────────────────

def ml_status() -> Dict:
    return {
        "sklearn_available":       _sklearn_ok,
        "embedder_loaded":         _embedder is not None,
        "sentence_transformers_ok": _st_ok,
    }
