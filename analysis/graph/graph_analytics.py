"""
WorldLens — News Graph Analytics
=================================
Builds a heterogeneous knowledge graph from scraped news events.

Pipeline
--------
  scraper output (list of event dicts)
        │
        ▼
  1. EntityExtractor      → spaCy / rule-based NER
        │
        ▼
  2. GraphBuilder         → NetworkX MultiDiGraph
        │   nodes: news, company, person, location, ticker, commodity
        │   edges: mentions, co_occurrence, similarity
        │   attrs: weight, timestamp, sentiment
        ▼
  3. SimilarityEngine     → TF-IDF cosine similarity  (+ optional SBERT)
        │
        ▼
  4. GraphEnricher        → degree/betweenness centrality, Louvain communities
        │
        ▼
  5. GraphSerializer      → JSON export (node-link format) for Dash / REST

Node types
----------
  news      – id=event_id, title, category, severity, timestamp, source
  company   – id="co:<name>", name, canonical
  person    – id="pe:<name>", name, canonical
  location  – id="lo:<name>", name, country_code
  ticker    – id="ti:<symbol>", symbol, company_name
  commodity – id="cm:<name>", name

Edge types
----------
  mentions      news → entity     weight = salience (0–1)
  co_occurrence entity ↔ entity   weight = normalised co-mention count
  similarity    news  ↔ news      weight = cosine TF-IDF score (threshold 0.25)
"""
from __future__ import annotations

import hashlib
import logging
import math
import re
import time
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# ── Optional heavy deps (graceful degradation) ──────────────────────────────
try:
    import networkx as nx  # type: ignore
    _NX = True
except ImportError:
    _NX = False
    logger.warning("networkx not installed — install with: pip install networkx")

try:
    import spacy  # type: ignore
    _SPACY = True
except ImportError:
    _SPACY = False

try:
    from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore
    from sklearn.metrics.pairwise import cosine_similarity        # type: ignore
    import numpy as np                                            # type: ignore
    _SKLEARN = True
except ImportError:
    _SKLEARN = False
    logger.warning("scikit-learn not installed — TF-IDF similarity disabled")

try:
    from community import best_partition  # python-louvain  # type: ignore
    _LOUVAIN = True
except ImportError:
    _LOUVAIN = False


# ══════════════════════════════════════════════════════════════════════════════
# 1. ENTITY EXTRACTOR
# ══════════════════════════════════════════════════════════════════════════════

# Reuse existing gazetteers from ner_engine (lightweight, no spaCy required)
TICKER_GAZETTEER: Set[str] = {
    "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "TSLA",
    "JPM", "GS", "BAC", "MS", "C", "WFC", "BRK", "V", "MA",
    "XOM", "CVX", "COP", "BP", "SHEL", "TTE",
    "SPY", "QQQ", "IWM", "GLD", "TLT",
    "BTC", "ETH", "SOL", "BNB", "XRP",
    "ASML", "TSM", "BABA", "JD", "BIDU", "PDD",
    "INTC", "AMD", "QCOM", "AVGO", "MU",
    "LMT", "RTX", "BA", "NOC", "GD",
    "UNH", "JNJ", "PFE", "MRNA", "ABBV",
    "NFLX", "DIS", "WMT", "TGT", "COST",
}

COMMODITY_GAZETTEER: Set[str] = {
    "gold", "silver", "copper", "platinum", "palladium", "nickel", "zinc",
    "oil", "crude", "brent", "wti", "natural gas", "lng", "coal",
    "wheat", "corn", "soybeans", "cotton", "coffee", "sugar", "cocoa",
    "bitcoin", "ethereum", "solana", "crypto",
    "iron ore", "lithium", "cobalt", "uranium",
}

ORG_GAZETTEER: Dict[str, str] = {
    "fed": "Federal Reserve", "federal reserve": "Federal Reserve",
    "ecb": "European Central Bank", "boe": "Bank of England",
    "boj": "Bank of Japan", "pboc": "People's Bank of China",
    "imf": "IMF", "world bank": "World Bank",
    "opec": "OPEC", "nato": "NATO", "un": "United Nations",
    "eu": "European Union", "g7": "G7", "g20": "G20",
    "wto": "WTO", "who": "WHO", "sec": "SEC",
}

# Maps spaCy labels → our entity types
_SPACY_TYPE_MAP = {
    "ORG":     "company",
    "PERSON":  "person",
    "GPE":     "location",
    "LOC":     "location",
    "NORP":    "location",
    "FAC":     "location",
    "PRODUCT": "company",
    "MONEY":   None,       # skip
    "DATE":    None,
    "TIME":    None,
    "PERCENT": None,
    "CARDINAL":None,
    "ORDINAL": None,
}

_nlp = None

def _get_nlp():
    global _nlp
    if _nlp is None and _SPACY:
        try:
            _nlp = spacy.load("en_core_web_sm")
            logger.info("spaCy en_core_web_sm loaded")
        except OSError:
            logger.warning("spaCy model not found — run: python -m spacy download en_core_web_sm")
    return _nlp


def _normalize(text: str) -> str:
    """Canonical entity form: lowercase, strip punctuation."""
    return re.sub(r"[^\w\s]", "", text.lower().strip())


def extract_entities(title: str, body: str, category: str = "") -> List[Dict]:
    """
    Returns list of entity dicts:
      {text, type, canonical, salience, confidence, node_id}

    Priority: spaCy > rule-based gazetteer
    """
    full = (title + " " + (body or "")).strip()
    entities: List[Dict] = []
    seen: Set[str] = set()

    # ── spaCy pass ───────────────────────────────────────────────────────────
    nlp = _get_nlp()
    if nlp:
        doc = nlp(full[:2000])  # cap for performance
        for ent in doc.ents:
            etype = _SPACY_TYPE_MAP.get(ent.label_)
            if etype is None:
                continue
            norm = _normalize(ent.text)
            if not norm or norm in seen or len(norm) < 2:
                continue
            seen.add(norm)
            sal = _salience(ent.text, full)
            entities.append({
                "text":       ent.text,
                "type":       etype,
                "canonical":  norm,
                "salience":   sal,
                "confidence": 0.85,
                "node_id":    f"{etype[:2]}:{norm}",
                "source":     "spacy",
            })

    # ── Ticker gazetteer pass ────────────────────────────────────────────────
    words = re.findall(r"\b[A-Z]{2,6}\b", full)
    for w in words:
        if w in TICKER_GAZETTEER:
            norm = _normalize(w)
            if norm not in seen:
                seen.add(norm)
                entities.append({
                    "text":       w,
                    "type":       "ticker",
                    "canonical":  w.upper(),
                    "salience":   _salience(w, full),
                    "confidence": 0.92,
                    "node_id":    f"ti:{w.upper()}",
                    "source":     "gazetteer",
                })
        # $TICKER pattern
        for m in re.finditer(r"\$([A-Z]{2,6})\b", full):
            sym = m.group(1)
            nrm = sym.upper()
            if nrm not in seen:
                seen.add(nrm)
                entities.append({
                    "text":       f"${sym}",
                    "type":       "ticker",
                    "canonical":  nrm,
                    "salience":   0.9,
                    "confidence": 0.95,
                    "node_id":    f"ti:{nrm}",
                    "source":     "regex",
                })

    # ── Commodity gazetteer ──────────────────────────────────────────────────
    fl = full.lower()
    for phrase, name in sorted(COMMODITY_GAZETTEER, key=len, reverse=True) if isinstance(COMMODITY_GAZETTEER, set) else []:
        if isinstance(COMMODITY_GAZETTEER, set):
            phrase = phrase
            name   = phrase.title()
        if phrase in fl:
            norm = _normalize(phrase)
            if norm not in seen:
                seen.add(norm)
                entities.append({
                    "text":       phrase.title(),
                    "type":       "commodity",
                    "canonical":  norm,
                    "salience":   _salience(phrase, fl),
                    "confidence": 0.88,
                    "node_id":    f"cm:{norm}",
                    "source":     "gazetteer",
                })

    for phrase in sorted(COMMODITY_GAZETTEER, key=len, reverse=True):
        norm = _normalize(phrase)
        if phrase in fl and norm not in seen:
            seen.add(norm)
            entities.append({
                "text":       phrase.title(),
                "type":       "commodity",
                "canonical":  norm,
                "salience":   _salience(phrase, fl),
                "confidence": 0.88,
                "node_id":    f"cm:{norm}",
                "source":     "gazetteer",
            })

    # ── Org gazetteer (fill gaps not caught by spaCy) ────────────────────────
    for key, name in ORG_GAZETTEER.items():
        norm = _normalize(name)
        if key in fl and norm not in seen:
            seen.add(norm)
            entities.append({
                "text":       name,
                "type":       "company",
                "canonical":  norm,
                "salience":   _salience(key, fl),
                "confidence": 0.80,
                "node_id":    f"co:{norm}",
                "source":     "gazetteer",
            })

    return entities


def _salience(term: str, full_text: str) -> float:
    """
    Salience = normalised frequency × title_boost.
    Higher if the term appears multiple times or in the title.
    """
    fl     = full_text.lower()
    term_l = term.lower()
    count  = fl.count(term_l)
    in_title = term_l in fl[:100]
    raw = count / max(len(full_text.split()), 1) * 100
    return round(min(1.0, raw + (0.3 if in_title else 0)), 3)


# ══════════════════════════════════════════════════════════════════════════════
# 2. GRAPH BUILDER
# ══════════════════════════════════════════════════════════════════════════════

class GraphBuilder:
    """
    Incrementally builds a NetworkX MultiDiGraph from news events.

    node attributes
    ---------------
      All nodes: node_type, label, added_at
      news:      title, category, severity, timestamp, source, country_code
      entities:  canonical, entity_type, mention_count, avg_salience

    edge attributes
    ---------------
      mentions:      source=news_id, target=entity_id, weight, salience, timestamp
      co_occurrence: weight (normalised count), first_seen, last_seen
      similarity:    weight (cosine), method ("tfidf"|"sbert")
    """

    def __init__(self):
        if not _NX:
            raise ImportError("networkx required: pip install networkx")
        self.G: nx.MultiDiGraph = nx.MultiDiGraph()
        self._entity_mentions: Dict[str, List[str]] = defaultdict(list)  # entity_id → [news_ids]
        self._cooc_counter: Counter = Counter()

    # ── News nodes ──────────────────────────────────────────────────────────
    def add_news(self, event: Dict) -> str:
        """Add a news event as a node. Returns the node id."""
        nid = event.get("id") or hashlib.md5(event.get("title","").encode()).hexdigest()[:12]
        if not self.G.has_node(nid):
            self.G.add_node(nid,
                node_type  = "news",
                label      = (event.get("title") or "")[:80],
                title      = event.get("title", ""),
                category   = event.get("category", ""),
                severity   = float(event.get("severity") or 5.0),
                timestamp  = event.get("timestamp", ""),
                source     = event.get("source", ""),
                country_code = event.get("country_code", "XX"),
                country_name = event.get("country_name", ""),
                summary    = (event.get("summary") or "")[:200],
                added_at   = time.time(),
            )
        return nid

    # ── Entity nodes ────────────────────────────────────────────────────────
    def add_entity(self, ent: Dict) -> str:
        """Add or update an entity node. Returns the node id."""
        eid = ent["node_id"]
        if self.G.has_node(eid):
            # Increment mention counter
            self.G.nodes[eid]["mention_count"] += 1
        else:
            self.G.add_node(eid,
                node_type     = ent["type"],
                entity_type   = ent["type"],
                label         = ent["text"],
                canonical     = ent["canonical"],
                mention_count = 1,
                avg_salience  = ent["salience"],
                added_at      = time.time(),
            )
        return eid

    # ── Edges ────────────────────────────────────────────────────────────────
    def add_mentions_edge(self, news_id: str, entity_id: str, salience: float,
                          timestamp: str) -> None:
        self.G.add_edge(news_id, entity_id,
            edge_type = "mentions",
            weight    = round(salience, 4),
            salience  = round(salience, 4),
            timestamp = timestamp,
        )
        self._entity_mentions[entity_id].append(news_id)

    def _update_cooccurrence(self, entity_ids: List[str], timestamp: str) -> None:
        """All entity pairs that appear together in the same article get a co-occurrence edge."""
        for i in range(len(entity_ids)):
            for j in range(i + 1, len(entity_ids)):
                a, b = sorted([entity_ids[i], entity_ids[j]])
                key  = (a, b)
                self._cooc_counter[key] += 1
                count = self._cooc_counter[key]
                # Update or add undirected co-occurrence edge
                edges = [d for _, _, d in self.G.edges(a, data=True)
                         if d.get("edge_type") == "co_occurrence" and
                         any(v == b for v in self.G.successors(a))]
                if count > 1 and edges:
                    edges[0]["weight"] = round(min(1.0, count / 10), 4)
                    edges[0]["count"]  = count
                else:
                    self.G.add_edge(a, b,
                        edge_type  = "co_occurrence",
                        weight     = round(min(1.0, count / 10), 4),
                        count      = count,
                        first_seen = timestamp,
                        last_seen  = timestamp,
                    )
                    self.G.add_edge(b, a,   # bidirectional
                        edge_type  = "co_occurrence",
                        weight     = round(min(1.0, count / 10), 4),
                        count      = count,
                        first_seen = timestamp,
                        last_seen  = timestamp,
                    )

    def add_similarity_edge(self, id1: str, id2: str, score: float,
                            method: str = "tfidf") -> None:
        if id1 == id2:
            return
        self.G.add_edge(id1, id2,
            edge_type = "similarity",
            weight    = round(score, 4),
            method    = method,
        )
        self.G.add_edge(id2, id1,
            edge_type = "similarity",
            weight    = round(score, 4),
            method    = method,
        )

    # ── Ingest a full event ─────────────────────────────────────────────────
    def ingest_event(self, event: Dict) -> str:
        """
        Full pipeline for one event:
          1. Add news node
          2. Extract entities
          3. Add entity nodes
          4. Add mentions edges
          5. Add co-occurrence edges among entities in this article

        Returns news node id.
        """
        nid      = self.add_news(event)
        ts       = event.get("timestamp", datetime.utcnow().isoformat())
        title    = event.get("title", "")
        summary  = event.get("summary", "")
        category = event.get("category", "")

        # Entity extraction
        entities = extract_entities(title, summary, category)

        entity_ids: List[str] = []
        for ent in entities:
            eid = self.add_entity(ent)
            self.add_mentions_edge(nid, eid, ent["salience"], ts)
            entity_ids.append(eid)

        # Co-occurrence among entities in same article
        if len(entity_ids) >= 2:
            self._update_cooccurrence(entity_ids, ts)

        return nid

    # ── Batch ingest ─────────────────────────────────────────────────────────
    def ingest_events(self, events: List[Dict]) -> "GraphBuilder":
        for ev in events:
            try:
                self.ingest_event(ev)
            except Exception as e:
                logger.debug("ingest_event error: %s", e)
        return self

    def stats(self) -> Dict:
        G = self.G
        node_types = Counter(d.get("node_type","?") for _, d in G.nodes(data=True))
        edge_types = Counter(d.get("edge_type","?") for _, _, d in G.edges(data=True))
        return {
            "nodes":      G.number_of_nodes(),
            "edges":      G.number_of_edges(),
            "node_types": dict(node_types),
            "edge_types": dict(edge_types),
        }


# ══════════════════════════════════════════════════════════════════════════════
# 3. SIMILARITY ENGINE  (TF-IDF cosine)
# ══════════════════════════════════════════════════════════════════════════════

class SimilarityEngine:
    """
    Computes pairwise TF-IDF cosine similarity between news nodes
    and injects similarity edges into the graph.

    Only pairs with score >= threshold are added (default 0.25)
    to keep the graph sparse and meaningful.
    """

    def __init__(self, threshold: float = 0.25, max_features: int = 5000):
        self.threshold    = threshold
        self.max_features = max_features

    def fit_and_link(self, builder: GraphBuilder) -> int:
        """
        Compute similarity for all current news nodes and add edges.
        Returns number of similarity edges added.
        """
        if not _SKLEARN:
            logger.warning("scikit-learn not available — skipping TF-IDF similarity")
            return 0

        # Collect news nodes
        news_nodes = [
            (nid, data)
            for nid, data in builder.G.nodes(data=True)
            if data.get("node_type") == "news"
        ]
        if len(news_nodes) < 2:
            return 0

        ids   = [n[0] for n in news_nodes]
        texts = [
            (n[1].get("title", "") + " " + n[1].get("summary", "")).strip()
            for n in news_nodes
        ]

        # TF-IDF vectorisation
        try:
            vec   = TfidfVectorizer(
                max_features = self.max_features,
                stop_words   = "english",
                ngram_range  = (1, 2),
                min_df       = 1,
            )
            mat   = vec.fit_transform(texts)
            sims  = cosine_similarity(mat)
        except Exception as e:
            logger.error("TF-IDF failed: %s", e)
            return 0

        added = 0
        n     = len(ids)
        for i in range(n):
            for j in range(i + 1, n):
                score = float(sims[i, j])
                if score >= self.threshold:
                    builder.add_similarity_edge(ids[i], ids[j], score, "tfidf")
                    added += 2  # bidirectional

        logger.info("SimilarityEngine: %d similarity edges added (threshold=%.2f)",
                    added // 2, self.threshold)
        return added


# ══════════════════════════════════════════════════════════════════════════════
# 4. GRAPH ENRICHER
# ══════════════════════════════════════════════════════════════════════════════

class GraphEnricher:
    """
    Adds analytics attributes to every node in-place:
      - degree_centrality      (nx.degree_centrality)
      - betweenness_centrality (nx.betweenness_centrality, sampled for large graphs)
      - pagerank               (nx.pagerank)
      - community              (Louvain or greedy modularity fallback)
      - hub_score              (HITS algorithm)
    """

    def enrich(self, builder: GraphBuilder) -> Dict:
        """
        Runs all enrichment passes on builder.G.
        Returns a summary dict with community stats.
        """
        G = builder.G
        if G.number_of_nodes() == 0:
            return {}

        t0 = time.time()

        # Work on undirected copy for centrality / community
        Gu: nx.Graph = G.to_undirected()

        # ── Degree centrality ────────────────────────────────────────────────
        deg_cen = nx.degree_centrality(Gu)
        for nid, val in deg_cen.items():
            if G.has_node(nid):
                G.nodes[nid]["degree_centrality"] = round(val, 6)

        # ── Betweenness centrality (sampled for speed on large graphs) ───────
        k = min(200, Gu.number_of_nodes())
        try:
            bet_cen = nx.betweenness_centrality(Gu, k=k, normalized=True, seed=42)
        except Exception:
            bet_cen = {}
        for nid, val in bet_cen.items():
            if G.has_node(nid):
                G.nodes[nid]["betweenness_centrality"] = round(val, 6)

        # ── PageRank ─────────────────────────────────────────────────────────
        try:
            pr = nx.pagerank(G, alpha=0.85, max_iter=100)
            for nid, val in pr.items():
                if G.has_node(nid):
                    G.nodes[nid]["pagerank"] = round(val, 6)
        except Exception:
            pass

        # ── HITS (hubs & authorities) ─────────────────────────────────────────
        try:
            hubs, auths = nx.hits(G, max_iter=100, normalized=True)
            for nid in G.nodes():
                G.nodes[nid]["hub_score"]       = round(hubs.get(nid, 0), 6)
                G.nodes[nid]["authority_score"] = round(auths.get(nid, 0), 6)
        except Exception:
            pass

        # ── Community detection ──────────────────────────────────────────────
        community_map: Dict[str, int] = {}
        n_communities = 0
        algo_used     = "none"

        if _LOUVAIN and Gu.number_of_nodes() > 1:
            try:
                partition  = best_partition(Gu)  # {node: community_id}
                community_map = partition
                n_communities = len(set(partition.values()))
                algo_used     = "louvain"
            except Exception as e:
                logger.debug("Louvain failed: %s", e)

        if not community_map and Gu.number_of_nodes() > 1:
            # Fallback: greedy modularity (included in networkx)
            try:
                comps = list(nx.algorithms.community.greedy_modularity_communities(Gu))
                for cid, comp in enumerate(comps):
                    for nid in comp:
                        community_map[nid] = cid
                n_communities = len(comps)
                algo_used     = "greedy_modularity"
            except Exception as e:
                logger.debug("greedy_modularity failed: %s", e)

        if not community_map:
            # Last resort: connected components as communities
            try:
                for cid, comp in enumerate(nx.connected_components(Gu)):
                    for nid in comp:
                        community_map[nid] = cid
                n_communities = cid + 1 if community_map else 0
                algo_used     = "connected_components"
            except Exception:
                pass

        for nid, cid in community_map.items():
            if G.has_node(nid):
                G.nodes[nid]["community"] = cid

        elapsed = round(time.time() - t0, 3)
        logger.info(
            "GraphEnricher: %d nodes, %d communities (%s), %.2fs",
            G.number_of_nodes(), n_communities, algo_used, elapsed
        )
        return {
            "n_communities":     n_communities,
            "community_algo":    algo_used,
            "elapsed_seconds":   elapsed,
        }


# ══════════════════════════════════════════════════════════════════════════════
# 5. SERIALIZER  (node-link JSON for Dash / REST API)
# ══════════════════════════════════════════════════════════════════════════════

class GraphSerializer:
    """Convert the NetworkX graph to/from JSON formats usable by Dash Cytoscape."""

    # Colour palette per node type
    NODE_COLORS = {
        "news":      "#3B82F6",   # blue
        "company":   "#10B981",   # green
        "person":    "#F59E0B",   # amber
        "location":  "#8B5CF6",   # purple
        "ticker":    "#F97316",   # orange
        "commodity": "#EC4899",   # pink
    }

    NODE_SHAPES = {
        "news":      "ellipse",
        "company":   "rectangle",
        "person":    "diamond",
        "location":  "triangle",
        "ticker":    "pentagon",
        "commodity": "star",
    }

    EDGE_COLORS = {
        "mentions":      "#94A3B8",
        "co_occurrence": "#60A5FA",
        "similarity":    "#F59E0B",
    }

    @classmethod
    def to_cytoscape(cls, G: "nx.MultiDiGraph",
                     max_nodes: int = 300,
                     min_edge_weight: float = 0.0) -> Dict:
        """
        Returns a dict with 'elements' (list of Dash Cytoscape elements)
        and 'stats' summary.

        Applies importance-based pruning if > max_nodes nodes.
        """
        nodes_data = list(G.nodes(data=True))

        # Prune if too large: keep highest-pagerank nodes
        if len(nodes_data) > max_nodes:
            nodes_data.sort(
                key=lambda x: x[1].get("pagerank", 0) + x[1].get("degree_centrality", 0),
                reverse=True
            )
            nodes_data = nodes_data[:max_nodes]
            keep_ids   = {n[0] for n in nodes_data}
        else:
            keep_ids = {n[0] for n in nodes_data}

        elements = []

        # ── Node elements ────────────────────────────────────────────────────
        for nid, data in nodes_data:
            ntype  = data.get("node_type", "news")
            color  = cls.NODE_COLORS.get(ntype, "#94A3B8")
            shape  = cls.NODE_SHAPES.get(ntype, "ellipse")
            size   = cls._node_size(data)
            comm   = data.get("community", 0)
            label  = (data.get("label") or str(nid))[:40]

            elements.append({
                "data": {
                    "id":                  str(nid),
                    "label":               label,
                    "node_type":           ntype,
                    "color":               color,
                    "size":                size,
                    "shape":               shape,
                    "community":           comm,
                    "degree_centrality":   data.get("degree_centrality", 0),
                    "betweenness":         data.get("betweenness_centrality", 0),
                    "pagerank":            data.get("pagerank", 0),
                    "hub_score":           data.get("hub_score", 0),
                    # type-specific
                    "severity":            data.get("severity"),
                    "category":            data.get("category"),
                    "timestamp":           data.get("timestamp"),
                    "mention_count":       data.get("mention_count"),
                    "entity_type":         data.get("entity_type"),
                    "canonical":           data.get("canonical"),
                    "source":              data.get("source"),
                    "title":               data.get("title"),
                    "summary":             data.get("summary"),
                },
                "classes": f"node-{ntype} community-{comm}",
            })

        # ── Edge elements ─────────────────────────────────────────────────────
        seen_edges: Set[str] = set()
        for src, tgt, edata in G.edges(data=True):
            if src not in keep_ids or tgt not in keep_ids:
                continue
            weight = edata.get("weight", 1.0)
            if weight < min_edge_weight:
                continue
            etype  = edata.get("edge_type", "mentions")
            ekey   = f"{src}__{tgt}__{etype}"
            if ekey in seen_edges:
                continue
            seen_edges.add(ekey)

            elements.append({
                "data": {
                    "source":    str(src),
                    "target":    str(tgt),
                    "edge_type": etype,
                    "weight":    weight,
                    "color":     cls.EDGE_COLORS.get(etype, "#475569"),
                    "label":     etype if weight > 0.5 else "",
                    "timestamp": edata.get("timestamp", ""),
                    "method":    edata.get("method", ""),
                },
                "classes": f"edge-{etype}",
            })

        stats = cls.summary(G)
        return {"elements": elements, "stats": stats}

    @classmethod
    def _node_size(cls, data: Dict) -> int:
        ntype = data.get("node_type", "news")
        if ntype == "news":
            sev = float(data.get("severity") or 5.0)
            return int(20 + sev * 4)
        pr  = float(data.get("pagerank") or 0)
        cnt = int(data.get("mention_count") or 1)
        return int(18 + min(pr * 2000, 20) + min(cnt * 2, 12))

    @classmethod
    def to_node_link(cls, G: "nx.MultiDiGraph") -> Dict:
        """Standard networkx node-link JSON for export / storage."""
        return nx.node_link_data(G)

    @classmethod
    def summary(cls, G: "nx.MultiDiGraph") -> Dict:
        node_types = Counter(d.get("node_type","?") for _, d in G.nodes(data=True))
        edge_types = Counter(d.get("edge_type","?") for _, _, d in G.edges(data=True))
        comms      = set(d.get("community") for _, d in G.nodes(data=True) if d.get("community") is not None)
        top_nodes  = sorted(
            [(nid, d.get("pagerank", 0), d.get("label",""))
             for nid, d in G.nodes(data=True)],
            key=lambda x: x[1], reverse=True
        )[:10]
        return {
            "n_nodes":       G.number_of_nodes(),
            "n_edges":       G.number_of_edges(),
            "n_communities": len(comms),
            "node_types":    dict(node_types),
            "edge_types":    dict(edge_types),
            "top_by_pagerank": [
                {"id": n[0], "pagerank": round(n[1], 6), "label": n[2]}
                for n in top_nodes
            ],
            "density": round(nx.density(G), 6) if G.number_of_nodes() > 1 else 0,
        }


# ══════════════════════════════════════════════════════════════════════════════
# 6. HIGH-LEVEL PIPELINE FUNCTION
# ══════════════════════════════════════════════════════════════════════════════

def build_graph_from_events(
    events: List[Dict],
    similarity_threshold: float = 0.25,
    max_nodes: int = 300,
    min_edge_weight: float = 0.05,
) -> Tuple["nx.MultiDiGraph", Dict]:
    """
    Full pipeline:
      events → GraphBuilder → SimilarityEngine → GraphEnricher → stats

    Returns (graph, cytoscape_payload)

    Example
    -------
    >>> from scrapers.events import fetch_all_events
    >>> import asyncio
    >>> events = asyncio.run(fetch_all_events())
    >>> G, payload = build_graph_from_events(events)
    >>> payload["stats"]
    """
    if not _NX:
        raise ImportError("networkx is required: pip install networkx")

    t0 = time.time()

    # Step 1+2: Build graph (entity extraction + edge construction)
    builder = GraphBuilder()
    builder.ingest_events(events)
    logger.info("GraphBuilder: %s", builder.stats())

    # Step 3: Similarity edges
    sim = SimilarityEngine(threshold=similarity_threshold)
    sim.fit_and_link(builder)

    # Step 4: Enrichment
    enricher = GraphEnricher()
    enrich_info = enricher.enrich(builder)

    # Step 5: Serialise
    payload = GraphSerializer.to_cytoscape(
        builder.G,
        max_nodes      = max_nodes,
        min_edge_weight = min_edge_weight,
    )
    payload["enrich_info"] = enrich_info
    payload["elapsed"]     = round(time.time() - t0, 2)

    logger.info(
        "build_graph_from_events: %d events → %d nodes / %d edges, %.1fs",
        len(events),
        builder.G.number_of_nodes(),
        builder.G.number_of_edges(),
        time.time() - t0,
    )
    return builder.G, payload
