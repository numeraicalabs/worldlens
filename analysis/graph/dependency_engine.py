"""
WorldLens — Global Dependency Engine
======================================
Builds and maintains a directed weighted dependency network from live events,
market data, and extracted entities.

Architecture
------------
                ┌─────────────────────────────────┐
                │        EventStream / DB          │
                └──────────────┬──────────────────┘
                               │  list[EventDict]
                               ▼
                ┌─────────────────────────────────┐
                │      EntityNormalizer            │
                │  (rule-based + LLM fallback)     │
                │  → canonical node ids            │
                └──────────────┬──────────────────┘
                               │
                               ▼
                ┌─────────────────────────────────┐
                │      DependencyGraphBuilder      │
                │  nx.DiGraph  (design: Neo4j)     │
                │                                  │
                │  Nodes: country, company,        │
                │         person, sector,          │
                │         commodity, asset         │
                │                                  │
                │  Edges: geopolitical, supply_    │
                │  chain, ownership, macro,        │
                │  market_correlation, political   │
                └──────────────┬──────────────────┘
                               │
                       ┌───────┴────────┐
                       ▼                ▼
            ┌──────────────┐  ┌──────────────────┐
            │ RiskPropag.  │  │  DependencyAPI   │
            │ (shock wave) │  │  get_path()      │
            └──────────────┘  │  critical_nodes()│
                              └──────────────────┘

Node Schema
-----------
{
  "id":         str,          # canonical unique id  e.g. "country:US"
  "label":      str,          # display name
  "node_type":  str,          # country|company|person|sector|commodity|asset
  "meta":       dict,         # type-specific metadata
  "risk_score": float,        # 0-10 composite risk
  "centrality": float,        # computed betweenness
  "updated_at": datetime,
}

Edge Schema
-----------
{
  "edge_type":  str,          # geopolitical|supply_chain|ownership|macro|
                              #   market_correlation|political_control
  "weight":     float,        # 0-1  f(severity, sentiment, frequency, mkt_reaction)
  "direction":  str,          # "→"  (all edges directed)
  "source_ids": list[str],    # event_ids that generated this edge
  "timestamp":  datetime,
  "source":     str,          # "event"|"market"|"static_kb"
  "confidence": float,        # 0-1
}

Design note: node IDs are Neo4j-compatible ("label:canonical_name").
Switch to a live Neo4j driver by replacing _build_nx() with a Bolt session.
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, Generator, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# ── Optional heavy deps ──────────────────────────────────────────────────────
try:
    import networkx as nx
    _NX = True
except ImportError:
    _NX = False
    logger.warning("networkx not installed — DependencyEngine degraded to in-memory dict")

try:
    from analysis.ai_layer_bridge import llm_extract_entities  # optional
    _LLM_NER = True
except Exception:
    _LLM_NER = False

# ════════════════════════════════════════════════════════════════════════════
# 1. CONSTANTS & GAZETTEERS
# ════════════════════════════════════════════════════════════════════════════

NODE_TYPES = frozenset(
    {"country", "company", "person", "sector", "commodity", "asset"}
)

EDGE_TYPES = frozenset({
    "geopolitical",       # country ↔ country  (sanctions, war, diplomacy)
    "supply_chain",       # sector/company → commodity/country
    "ownership",          # company → company  (subsidiary, stake)
    "macro",              # country → asset/sector (monetary policy, tariffs)
    "market_correlation", # asset ↔ asset  (price co-movement)
    "political_control",  # person → country/company
    "trade_dependency",   # country → country  (exports/imports)
    "regulatory",         # country → company/sector
    "mentions",           # news event → any node  (weak informational edge)
})

# ── Sector taxonomy ──────────────────────────────────────────────────────────
SECTOR_MAP: Dict[str, str] = {
    # Technology
    "semiconductor": "Semiconductors", "chip": "Semiconductors",
    "semiconductor industry": "Semiconductors",
    "software": "Software & IT", "cloud": "Software & IT",
    "cybersecurity": "Cybersecurity", "ai": "Artificial Intelligence",
    "artificial intelligence": "Artificial Intelligence",
    # Energy
    "oil": "Energy", "gas": "Energy", "lng": "Energy", "nuclear": "Energy",
    "renewable": "Renewable Energy", "solar": "Renewable Energy",
    "wind energy": "Renewable Energy",
    # Finance
    "banking": "Banking", "bank": "Banking", "fintech": "FinTech",
    "insurance": "Insurance", "hedge fund": "Asset Management",
    # Defense
    "defense": "Defense & Aerospace", "aerospace": "Defense & Aerospace",
    "weapons": "Defense & Aerospace", "military": "Defense & Aerospace",
    # Commodities
    "agriculture": "Agriculture", "food": "Agriculture",
    "pharmaceutical": "Pharmaceuticals", "drug": "Pharmaceuticals",
    "mining": "Mining", "steel": "Metals & Mining",
    # Transport
    "shipping": "Shipping & Logistics", "logistics": "Shipping & Logistics",
    "aviation": "Aviation",
    # Telecom
    "telecom": "Telecommunications", "5g": "Telecommunications",
}

# ── Company → sector mapping ─────────────────────────────────────────────────
COMPANY_SECTOR: Dict[str, str] = {
    "NVDA": "Semiconductors",  "INTC": "Semiconductors",
    "AMD":  "Semiconductors",  "TSM":  "Semiconductors",
    "ASML": "Semiconductors",  "QCOM": "Semiconductors",
    "AAPL": "Software & IT",   "MSFT": "Software & IT",
    "GOOGL":"Software & IT",   "META": "Software & IT",
    "AMZN": "Software & IT",   "TSLA": "Automotive",
    "JPM":  "Banking",         "GS":   "Banking",
    "BAC":  "Banking",         "XOM":  "Energy",
    "CVX":  "Energy",          "BP":   "Energy",
    "LMT":  "Defense & Aerospace", "RTX": "Defense & Aerospace",
    "BA":   "Defense & Aerospace",
}

# ── Static strategic dependencies (seed knowledge base) ─────────────────────
# These edges exist regardless of news volume.  Source = "static_kb".
STATIC_DEPENDENCIES: List[Tuple[str, str, str, float, str]] = [
    # (source_id, target_id, edge_type, weight, description)
    # Semiconductor supply chain
    ("country:US",    "sector:Semiconductors",    "regulatory",    0.9, "US export controls on chips"),
    ("country:TW",    "sector:Semiconductors",    "supply_chain",  0.95,"TSMC dominates global fab"),
    ("country:CN",    "sector:Semiconductors",    "supply_chain",  0.7, "China major chip consumer"),
    ("country:KR",    "sector:Semiconductors",    "supply_chain",  0.8, "Samsung/SK Hynix memory"),
    ("sector:Semiconductors", "company:NVDA",     "supply_chain",  0.85,"GPU/AI chip dependency"),
    ("sector:Semiconductors", "company:INTC",     "supply_chain",  0.8, "x86 CPU supply"),
    ("sector:Semiconductors", "company:ASML",     "ownership",     0.9, "EUV lithography monopoly"),
    # Energy geopolitics
    ("country:RU",    "sector:Energy",            "supply_chain",  0.8, "Russia gas/oil supplier"),
    ("country:SA",    "sector:Energy",            "supply_chain",  0.85,"Saudi Arabia OPEC leader"),
    ("country:US",    "sector:Energy",            "supply_chain",  0.75,"US largest oil producer"),
    ("sector:Energy", "commodity:Crude Oil",      "supply_chain",  0.95,"Energy sector → crude"),
    ("sector:Energy", "commodity:Natural Gas",    "supply_chain",  0.9, "Energy sector → gas"),
    # US-China geopolitical tension
    ("country:US",    "country:CN",               "geopolitical",  0.85,"US-China strategic rivalry"),
    ("country:CN",    "country:TW",               "geopolitical",  0.9, "Taiwan Strait tension"),
    ("country:US",    "country:TW",               "geopolitical",  0.7, "US Taiwan defence pact"),
    # EU energy dependency
    ("country:EU",    "country:RU",               "trade_dependency",0.6,"EU post-Russia gas pivot"),
    # Dollar dominance
    ("country:US",    "asset:USD",                "macro",         0.95,"USD reserve currency"),
    ("asset:USD",     "commodity:Crude Oil",      "market_correlation",0.8,"Petrodollar correlation"),
    # Gold / macro
    ("asset:Gold",    "asset:USD",                "market_correlation",-0.7,"Gold/USD inverse"),
    ("country:US",    "asset:Gold",               "macro",         0.6, "Fed policy → gold"),
    # VIX / S&P
    ("asset:VIX",     "asset:SP500",              "market_correlation",-0.85,"VIX/SPX inverse"),
]

# ── Person → role mapping (seed) ─────────────────────────────────────────────
PERSON_ROLES: Dict[str, Tuple[str, str]] = {
    # (person_canonical, (country_or_company, role))
    "Xi Jinping":    ("country:CN", "head_of_state"),
    "Joe Biden":     ("country:US", "head_of_state"),
    "Donald Trump":  ("country:US", "head_of_state"),
    "Vladimir Putin":("country:RU", "head_of_state"),
    "Narendra Modi": ("country:IN", "head_of_state"),
    "Jerome Powell": ("asset:USD",  "central_banker"),
    "Christine Lagarde": ("country:EU", "central_banker"),
    "Elon Musk":     ("company:TSLA", "ceo"),
    "Jensen Huang":  ("company:NVDA", "ceo"),
    "Tim Cook":      ("company:AAPL", "ceo"),
    "Jamie Dimon":   ("company:JPM",  "ceo"),
}

# ── Country name → ISO-2 ─────────────────────────────────────────────────────
COUNTRY_CODES: Dict[str, str] = {
    "united states": "US", "america": "US", "u.s.": "US",
    "china": "CN", "chinese": "CN",
    "russia": "RU", "russian": "RU",
    "europe": "EU", "european union": "EU", "eurozone": "EU",
    "germany": "DE", "france": "FR", "united kingdom": "GB",
    "uk": "GB", "britain": "GB",
    "japan": "JP", "india": "IN", "brazil": "BR",
    "south korea": "KR", "taiwan": "TW", "israel": "IL",
    "iran": "IR", "saudi arabia": "SA", "turkey": "TR",
    "ukraine": "UA", "australia": "AU", "canada": "CA",
    "north korea": "KP",
}

# ════════════════════════════════════════════════════════════════════════════
# 2. ENTITY NORMALIZER
# ════════════════════════════════════════════════════════════════════════════

class EntityNormalizer:
    """
    Converts raw NER output and event metadata into canonical node IDs.

    Node ID format: "<type>:<canonical_name>"
      country:US, company:NVDA, person:Xi_Jinping,
      sector:Semiconductors, commodity:Crude_Oil, asset:USD
    """

    # Compiled patterns for fast extraction
    _TICKER_RE = re.compile(r'\b\$?([A-Z]{2,5})\b')
    _COUNTRY_CODES_SET = set(COUNTRY_CODES.values())

    def __init__(self) -> None:
        # Runtime canonicalization cache
        self._cache: Dict[str, str] = {}

    # ── Public ───────────────────────────────────────────────────────────────

    def normalize_event(self, event: Dict) -> List[Dict]:
        """
        Extract and normalize all entities from an event dict.
        Returns list of {node_id, label, node_type, confidence, salience}.
        """
        text     = f"{event.get('title','')} {event.get('summary','')}"
        category = event.get("category", "")
        country  = event.get("country_code", "")
        severity = float(event.get("severity", 5))

        nodes: Dict[str, Dict] = {}

        # 1. Country from metadata
        if country and country != "XX":
            nid = f"country:{country}"
            nodes[nid] = {
                "node_id": nid, "label": country, "node_type": "country",
                "confidence": 1.0, "salience": min(1.0, severity / 10)
            }

        # 2. Countries from text
        for nodes_found in self._scan_countries(text):
            nid = nodes_found["node_id"]
            if nid not in nodes:
                nodes[nid] = nodes_found

        # 3. Tickers
        for nd in self._scan_tickers(text, severity):
            nid = nd["node_id"]
            if nid not in nodes:
                nodes[nid] = nd
            # Add sector if known
            sym = nid.split(":", 1)[1]
            if sym in COMPANY_SECTOR:
                sec_nid = f"sector:{COMPANY_SECTOR[sym].replace(' ', '_')}"
                if sec_nid not in nodes:
                    nodes[sec_nid] = {
                        "node_id": sec_nid,
                        "label": COMPANY_SECTOR[sym],
                        "node_type": "sector",
                        "confidence": 0.95, "salience": 0.7
                    }

        # 4. Sectors from text
        for nd in self._scan_sectors(text):
            nid = nd["node_id"]
            if nid not in nodes:
                nodes[nid] = nd

        # 5. Commodities from text
        for nd in self._scan_commodities(text):
            nid = nd["node_id"]
            if nid not in nodes:
                nodes[nid] = nd

        # 6. People / persons (simple title-prefix heuristic)
        for nd in self._scan_persons(text):
            nid = nd["node_id"]
            if nid not in nodes:
                nodes[nid] = nd

        return list(nodes.values())

    def canonical_id(self, raw: str, node_type: str) -> str:
        """Convert raw entity string to canonical node ID."""
        key = f"{node_type}:{raw}"
        if key in self._cache:
            return self._cache[key]

        result = self._canonicalize(raw, node_type)
        self._cache[key] = result
        return result

    # ── Private ──────────────────────────────────────────────────────────────

    def _canonicalize(self, raw: str, node_type: str) -> str:
        norm = raw.strip()
        if node_type == "country":
            code = COUNTRY_CODES.get(norm.lower())
            if code:
                return f"country:{code}"
            if norm.upper() in self._COUNTRY_CODES_SET:
                return f"country:{norm.upper()}"
            return f"country:{norm.replace(' ', '_')}"
        if node_type == "company":
            # Try ticker lookup
            upper = norm.upper()
            from analysis.ner_engine import TICKER_MAP
            if upper in TICKER_MAP:
                return f"company:{upper}"
            return f"company:{norm.replace(' ', '_')}"
        if node_type == "person":
            return f"person:{norm.replace(' ', '_')}"
        if node_type == "sector":
            # Map to canonical sector name
            lower = norm.lower()
            for kw, canonical in SECTOR_MAP.items():
                if kw in lower:
                    return f"sector:{canonical.replace(' ', '_')}"
            return f"sector:{norm.replace(' ', '_')}"
        if node_type == "commodity":
            from analysis.ner_engine import COMMODITY_MAP
            can = COMMODITY_MAP.get(norm.lower(), norm)
            return f"commodity:{can.replace(' ', '_')}"
        if node_type == "asset":
            return f"asset:{norm.upper()}"
        return f"{node_type}:{norm.replace(' ', '_')}"

    def _scan_countries(self, text: str) -> List[Dict]:
        tl = text.lower()
        found = []
        # Longest-match
        for name in sorted(COUNTRY_CODES, key=len, reverse=True):
            if name in tl:
                code = COUNTRY_CODES[name]
                found.append({
                    "node_id": f"country:{code}",
                    "label": code, "node_type": "country",
                    "confidence": 0.85, "salience": 0.6
                })
        return found

    def _scan_tickers(self, text: str, severity: float = 5.0) -> List[Dict]:
        from analysis.ner_engine import TICKER_MAP
        found = []
        for m in self._TICKER_RE.finditer(text):
            sym = m.group(1)
            if sym in TICKER_MAP:
                found.append({
                    "node_id": f"company:{sym}",
                    "label": f"{sym} ({TICKER_MAP[sym]})",
                    "node_type": "company",
                    "confidence": 0.95,
                    "salience": min(1.0, severity / 8),
                })
        return found

    def _scan_sectors(self, text: str) -> List[Dict]:
        tl = text.lower()
        found = []
        seen: Set[str] = set()
        for kw in sorted(SECTOR_MAP, key=len, reverse=True):
            if kw in tl:
                canonical = SECTOR_MAP[kw]
                if canonical not in seen:
                    found.append({
                        "node_id": f"sector:{canonical.replace(' ', '_')}",
                        "label": canonical, "node_type": "sector",
                        "confidence": 0.80, "salience": 0.65
                    })
                    seen.add(canonical)
        return found

    def _scan_commodities(self, text: str) -> List[Dict]:
        from analysis.ner_engine import COMMODITY_MAP
        tl = text.lower()
        found = []
        seen: Set[str] = set()
        for kw in sorted(COMMODITY_MAP, key=len, reverse=True):
            if kw in tl:
                canonical = COMMODITY_MAP[kw]
                if canonical not in seen:
                    found.append({
                        "node_id": f"commodity:{canonical.replace(' ', '_')}",
                        "label": canonical, "node_type": "commodity",
                        "confidence": 0.88, "salience": 0.60
                    })
                    seen.add(canonical)
        return found

    def _scan_persons(self, text: str) -> List[Dict]:
        """Extract persons using known-name lookup first, then title-prefix."""
        found = []
        seen: Set[str] = set()
        for name, (_, role) in PERSON_ROLES.items():
            if name.lower() in text.lower() and name not in seen:
                found.append({
                    "node_id": f"person:{name.replace(' ', '_')}",
                    "label": name, "node_type": "person",
                    "confidence": 0.90, "salience": 0.75,
                    "role": role,
                })
                seen.add(name)
        # Title-prefix pattern: President/CEO/Minister + TitleCase Name
        _TITLE_RE = re.compile(
            r'\b(?:President|Prime Minister|Secretary|Minister|'
            r'CEO|CFO|Chairman|Governor|Director)\s+([A-Z][a-z]+ [A-Z][a-z]+)\b'
        )
        for m in _TITLE_RE.finditer(text):
            name = m.group(1)
            if name not in seen:
                found.append({
                    "node_id": f"person:{name.replace(' ', '_')}",
                    "label": name, "node_type": "person",
                    "confidence": 0.78, "salience": 0.65,
                })
                seen.add(name)
        return found


# ════════════════════════════════════════════════════════════════════════════
# 3. WEIGHT FUNCTION
# ════════════════════════════════════════════════════════════════════════════

def compute_edge_weight(
    severity: float,
    sentiment: float,        # –1 … +1
    frequency: int,          # co-occurrence count across events
    market_reaction: float,  # |price change| 0-1, 0 if unknown
    confidence: float = 0.8,
    decay_days: float = 0.0, # days since event (for temporal decay)
) -> float:
    """
    weight = f(severity, |sentiment|, frequency, market_reaction)

    Components:
      severity_norm  = severity / 10            (0-1)
      sentiment_norm = |sentiment|              (0-1, direction not weight)
      freq_norm      = log1p(freq) / log1p(10)  (0-1, saturates at ~10 events)
      market_norm    = market_reaction           (0-1)
      temporal_decay = exp(-λ·days), λ=0.05    (recent events more relevant)

    Final: weighted mean × confidence
    """
    sev_norm  = min(1.0, max(0.0, severity / 10.0))
    sent_norm = min(1.0, abs(sentiment))
    freq_norm = math.log1p(max(0, frequency)) / math.log1p(10)
    mkt_norm  = min(1.0, max(0.0, market_reaction))
    decay     = math.exp(-0.05 * max(0.0, decay_days))

    raw = (
        0.35 * sev_norm   +
        0.20 * sent_norm  +
        0.25 * freq_norm  +
        0.20 * mkt_norm
    ) * decay * confidence

    return round(min(1.0, max(0.0, raw)), 4)


# ════════════════════════════════════════════════════════════════════════════
# 4. DEPENDENCY GRAPH BUILDER
# ════════════════════════════════════════════════════════════════════════════

@dataclass
class GraphStats:
    n_nodes:      int = 0
    n_edges:      int = 0
    n_events_processed: int = 0
    last_update:  Optional[str] = None
    node_type_counts: Dict[str, int] = field(default_factory=dict)
    edge_type_counts: Dict[str, int] = field(default_factory=dict)


class DependencyGraphBuilder:
    """
    Builds and incrementally updates a directed weighted dependency graph.

    Usage
    -----
    builder = DependencyGraphBuilder()
    builder.seed_static_knowledge()
    builder.ingest_events(events)           # incremental
    G = builder.G                           # nx.DiGraph
    """

    def __init__(self) -> None:
        if not _NX:
            raise RuntimeError("networkx required: pip install networkx")
        # DiGraph (not Multi) — if two nodes have multiple relationship types
        # we store the strongest edge; the 'edge_sources' list tracks all.
        self.G: nx.DiGraph = nx.DiGraph()
        self._normalizer   = EntityNormalizer()
        self._stats        = GraphStats()

        # Co-occurrence tracker: (nid_a, nid_b) → count
        self._cooc: Dict[Tuple[str, str], int] = defaultdict(int)
        # Event-id deduplication
        self._seen_events: Set[str] = set()

    # ── Lifecycle ────────────────────────────────────────────────────────────

    def seed_static_knowledge(self) -> None:
        """Populate graph with static strategic dependencies."""
        now_str = datetime.now(timezone.utc).isoformat()
        for src, tgt, etype, weight, desc in STATIC_DEPENDENCIES:
            self._ensure_node_from_id(src)
            self._ensure_node_from_id(tgt)
            self._upsert_edge(
                src, tgt,
                edge_type  = etype,
                weight     = weight,
                source     = "static_kb",
                timestamp  = now_str,
                confidence = 1.0,
                description= desc,
            )
        # Person → entity edges
        for name, (target_id, role) in PERSON_ROLES.items():
            pid = f"person:{name.replace(' ', '_')}"
            self._ensure_node(pid, "person", name, {"role": role})
            self._ensure_node_from_id(target_id)
            self._upsert_edge(
                pid, target_id,
                edge_type  = "political_control",
                weight     = 0.85,
                source     = "static_kb",
                timestamp  = now_str,
                confidence = 0.9,
                description= f"{name} {role}",
            )
        logger.info(
            "Static KB seeded: %d nodes, %d edges",
            self.G.number_of_nodes(), self.G.number_of_edges()
        )

    def ingest_events(
        self,
        events: List[Dict],
        llm_fallback: bool = False,
    ) -> GraphStats:
        """
        Process a batch of event dicts and update the graph incrementally.
        Safe to call multiple times (deduplicates by event id).
        """
        new_count = 0
        for ev in events:
            eid = str(ev.get("id", ""))
            if eid and eid in self._seen_events:
                continue
            if eid:
                self._seen_events.add(eid)
            self._process_event(ev)
            new_count += 1

        # Recompute centrality after batch
        self._recompute_centrality()
        self._stats = self._build_stats()
        logger.info(
            "ingest_events: processed %d new events, graph=%d nodes / %d edges",
            new_count, self.G.number_of_nodes(), self.G.number_of_edges()
        )
        return self._stats

    # ── Event processing ─────────────────────────────────────────────────────

    def _process_event(self, event: Dict) -> None:
        """Extract entities, create/update nodes and edges from one event."""
        ev_id      = str(event.get("id", hashlib.md5(
                         event.get("title", "").encode()).hexdigest()[:8]))
        severity   = float(event.get("severity", 5.0))
        sentiment  = float(event.get("sentiment_score", 0.0))
        category   = event.get("category", "")
        timestamp  = event.get("timestamp") or datetime.now(timezone.utc).isoformat()
        mkt_impact = float(event.get("market_impact", 0.0))

        # Extract + normalize nodes
        entities = self._normalizer.normalize_event(event)
        if not entities:
            return

        node_ids = []
        for ent in entities:
            nid = ent["node_id"]
            self._ensure_node(
                nid,
                ent["node_type"],
                ent["label"],
                {"confidence": ent["confidence"]},
            )
            # Update risk score on the node
            existing = self.G.nodes[nid]
            prev_risk = existing.get("risk_score", 0.0)
            new_risk  = max(prev_risk, severity * ent["salience"])
            self.G.nodes[nid]["risk_score"]  = round(min(10.0, new_risk), 2)
            self.G.nodes[nid]["updated_at"]  = timestamp
            node_ids.append(nid)

        # Build edges: event → node (mentions, weak)
        # and node → node (semantic co-occurrence, structural)
        weight_base = compute_edge_weight(
            severity, sentiment, 1, mkt_impact, confidence=0.75
        )

        # Structural edge inference from category + entities
        country_nodes = [n for n in node_ids if n.startswith("country:")]
        company_nodes = [n for n in node_ids if n.startswith("company:")]
        sector_nodes  = [n for n in node_ids if n.startswith("sector:")]
        commod_nodes  = [n for n in node_ids if n.startswith("commodity:")]
        person_nodes  = [n for n in node_ids if n.startswith("person:")]
        asset_nodes   = [n for n in node_ids if n.startswith("asset:")]

        # Co-occurrence counter (all entity pairs in this event)
        for i, a in enumerate(node_ids):
            for b in node_ids[i+1:]:
                self._cooc[(a, b)] += 1
                self._cooc[(b, a)] += 1

        # ── Structural edge rules by category ───────────────────────────────

        if category in ("GEOPOLITICS", "CONFLICT", "POLITICS"):
            # country → country (geopolitical)
            for i, ca in enumerate(country_nodes):
                for cb in country_nodes[i+1:]:
                    self._upsert_edge(
                        ca, cb, "geopolitical",
                        weight=weight_base * 0.9,
                        source="event", source_ids=[ev_id],
                        timestamp=timestamp, confidence=0.82,
                    )
            # person → country (political control)
            for pe in person_nodes:
                for co in country_nodes:
                    pname = pe.split(":", 1)[1].replace("_", " ")
                    if pname in PERSON_ROLES:
                        target_id, _ = PERSON_ROLES[pname]
                        if target_id == co:
                            self._upsert_edge(
                                pe, co, "political_control",
                                weight=min(1.0, weight_base + 0.2),
                                source="event", source_ids=[ev_id],
                                timestamp=timestamp, confidence=0.88,
                            )

        if category in ("ECONOMICS", "FINANCE", "MACRO"):
            # country → asset (macro)
            for co in country_nodes:
                for ast in asset_nodes:
                    self._upsert_edge(
                        co, ast, "macro",
                        weight=weight_base,
                        source="event", source_ids=[ev_id],
                        timestamp=timestamp, confidence=0.75,
                    )
            # country → sector (regulatory / macro)
            for co in country_nodes:
                for sec in sector_nodes:
                    self._upsert_edge(
                        co, sec, "regulatory",
                        weight=weight_base * 0.85,
                        source="event", source_ids=[ev_id],
                        timestamp=timestamp, confidence=0.75,
                    )

        if category in ("ENERGY", "TRADE"):
            # country → commodity (supply chain)
            for co in country_nodes:
                for cm in commod_nodes:
                    self._upsert_edge(
                        co, cm, "supply_chain",
                        weight=weight_base * 0.9,
                        source="event", source_ids=[ev_id],
                        timestamp=timestamp, confidence=0.80,
                    )
            # sector → commodity
            for sec in sector_nodes:
                for cm in commod_nodes:
                    self._upsert_edge(
                        sec, cm, "supply_chain",
                        weight=weight_base * 0.85,
                        source="event", source_ids=[ev_id],
                        timestamp=timestamp, confidence=0.78,
                    )

        if category == "TECHNOLOGY":
            # sector → company (supply chain)
            for sec in sector_nodes:
                for co in company_nodes:
                    sym = co.split(":", 1)[1]
                    if COMPANY_SECTOR.get(sym) and \
                       f"sector:{COMPANY_SECTOR[sym].replace(' ','_')}" == sec:
                        self._upsert_edge(
                            sec, co, "supply_chain",
                            weight=weight_base * 0.88,
                            source="event", source_ids=[ev_id],
                            timestamp=timestamp, confidence=0.85,
                        )

        # Fallback: co-occurrence edges for any strong events (sev >= 7)
        if severity >= 7.0:
            for i, a in enumerate(node_ids):
                for b in node_ids[i+1:]:
                    cnt = self._cooc.get((a, b), 1)
                    w   = compute_edge_weight(severity, sentiment, cnt, mkt_impact)
                    if w >= 0.3:
                        etype = self._infer_edge_type(a, b, category)
                        self._upsert_edge(
                            a, b, etype,
                            weight=w, source="event",
                            source_ids=[ev_id], timestamp=timestamp,
                            confidence=0.65,
                        )

    # ── Node/edge helpers ────────────────────────────────────────────────────

    def _ensure_node(
        self, nid: str, node_type: str,
        label: str, meta: Optional[Dict] = None
    ) -> None:
        if nid not in self.G:
            self.G.add_node(
                nid,
                label      = label,
                node_type  = node_type,
                risk_score = 0.0,
                centrality = 0.0,
                meta       = meta or {},
                updated_at = datetime.now(timezone.utc).isoformat(),
            )

    def _ensure_node_from_id(self, nid: str) -> None:
        """Create node from canonical id if not present."""
        if nid in self.G:
            return
        parts = nid.split(":", 1)
        ntype = parts[0] if len(parts) == 2 else "unknown"
        label = parts[1].replace("_", " ") if len(parts) == 2 else nid
        self._ensure_node(nid, ntype, label)

    def _upsert_edge(
        self,
        src: str, tgt: str,
        edge_type: str,
        weight: float,
        source: str,
        timestamp: Optional[str] = None,
        confidence: float = 0.8,
        description: str = "",
        source_ids: Optional[List[str]] = None,
    ) -> None:
        """Insert or update edge — keeps max weight, merges source_ids."""
        if src == tgt:
            return
        ts = timestamp or datetime.now(timezone.utc).isoformat()
        if self.G.has_edge(src, tgt):
            edata = self.G[src][tgt]
            # If same type: update weight to max, merge sources
            if edata.get("edge_type") == edge_type:
                edata["weight"]     = max(edata["weight"], weight)
                edata["confidence"] = max(edata.get("confidence", 0), confidence)
                if source_ids:
                    existing = edata.get("source_ids", [])
                    edata["source_ids"] = list(set(existing + source_ids))[:20]
                edata["timestamp"] = ts
                return
            # Different type: only replace if stronger
            if weight <= edata.get("weight", 0):
                return
        self.G.add_edge(
            src, tgt,
            edge_type   = edge_type,
            weight      = weight,
            source      = source,
            timestamp   = ts,
            confidence  = confidence,
            description = description,
            source_ids  = source_ids or [],
        )

    @staticmethod
    def _infer_edge_type(src: str, tgt: str, category: str) -> str:
        """Infer most likely edge type from node types + event category."""
        src_type = src.split(":", 1)[0]
        tgt_type = tgt.split(":", 1)[0]
        if src_type == "country" and tgt_type == "country":
            return "geopolitical"
        if src_type == "country" and tgt_type in ("sector", "commodity"):
            return "supply_chain" if category in ("ENERGY","TRADE") else "regulatory"
        if src_type in ("sector","company") and tgt_type == "commodity":
            return "supply_chain"
        if src_type == "country" and tgt_type == "asset":
            return "macro"
        if src_type == "company" and tgt_type == "company":
            return "ownership"
        if src_type == "person":
            return "political_control"
        if src_type == "asset" and tgt_type == "asset":
            return "market_correlation"
        return "mentions"

    # ── Centrality ───────────────────────────────────────────────────────────

    def _recompute_centrality(self) -> None:
        """Recompute betweenness + PageRank on current graph (async-safe)."""
        if self.G.number_of_nodes() < 3:
            return
        try:
            bc = nx.betweenness_centrality(self.G, weight="weight", normalized=True)
            pr = nx.pagerank(self.G, weight="weight", alpha=0.85, max_iter=100)
            for nid in self.G.nodes:
                self.G.nodes[nid]["centrality"]  = round(bc.get(nid, 0.0), 5)
                self.G.nodes[nid]["pagerank"]     = round(pr.get(nid, 0.0), 5)
        except Exception as exc:
            logger.debug("Centrality computation error: %s", exc)

    # ── Stats ─────────────────────────────────────────────────────────────────

    def _build_stats(self) -> GraphStats:
        from collections import Counter
        nt = Counter(d.get("node_type","?") for _, d in self.G.nodes(data=True))
        et = Counter(d.get("edge_type","?") for _, _, d in self.G.edges(data=True))
        return GraphStats(
            n_nodes             = self.G.number_of_nodes(),
            n_edges             = self.G.number_of_edges(),
            n_events_processed  = len(self._seen_events),
            last_update         = datetime.now(timezone.utc).isoformat(),
            node_type_counts    = dict(nt),
            edge_type_counts    = dict(et),
        )

    @property
    def stats(self) -> GraphStats:
        return self._stats


# ════════════════════════════════════════════════════════════════════════════
# 5. QUERY ENGINE
# ════════════════════════════════════════════════════════════════════════════

class DependencyQueryEngine:
    """
    High-level query interface over a DependencyGraphBuilder instance.

    Core methods:
      get_dependency_path(source, target) → path + metadata
      propagate_risk(node, shock)         → affected nodes ranked by impact
      get_most_critical_nodes(k)          → top-k by composite criticality
    """

    def __init__(self, builder: DependencyGraphBuilder) -> None:
        self._b = builder

    @property
    def G(self) -> "nx.DiGraph":
        return self._b.G

    # ── 5.1  Dependency path ─────────────────────────────────────────────────

    def get_dependency_path(
        self,
        source: str,
        target: str,
        max_paths: int = 3,
        normalize_ids: bool = True,
    ) -> Dict:
        """
        Find dependency path(s) from source → target.

        Parameters
        ----------
        source, target : str
            Either canonical node IDs ("country:US") or raw strings
            that will be fuzzy-matched to known nodes.
        max_paths : int
            Number of simple paths to return (shortest first).
        normalize_ids : bool
            If True, attempt to resolve plain names to node IDs.

        Returns
        -------
        {
          "found": bool,
          "source": str,
          "target": str,
          "paths": [
            {
              "nodes": [...],
              "edges": [...],
              "total_weight": float,
              "length": int,
            }
          ],
          "explanation": str,
        }
        """
        src_id = self._resolve_node(source) if normalize_ids else source
        tgt_id = self._resolve_node(target) if normalize_ids else target

        if src_id is None or tgt_id is None:
            return {
                "found": False,
                "source": source, "target": target,
                "paths": [],
                "explanation": (
                    f"Node not found: "
                    f"{'source' if src_id is None else 'target'} "
                    f"'{source if src_id is None else target}'"
                ),
            }

        if src_id not in self.G or tgt_id not in self.G:
            return {
                "found": False,
                "source": src_id, "target": tgt_id,
                "paths": [],
                "explanation": "One or both nodes not in graph.",
            }

        try:
            raw_paths = list(nx.all_simple_paths(
                self.G, src_id, tgt_id,
                cutoff=6  # max hops
            ))
        except nx.NetworkXNoPath:
            raw_paths = []
        except Exception:
            raw_paths = []

        # Sort by total path weight (descending) then length
        def _path_weight(path: List[str]) -> float:
            total = 0.0
            for i in range(len(path) - 1):
                edata = self.G.get_edge_data(path[i], path[i+1]) or {}
                total += edata.get("weight", 0.0)
            return total

        raw_paths.sort(key=lambda p: (-_path_weight(p), len(p)))
        raw_paths = raw_paths[:max_paths]

        if not raw_paths:
            # Try undirected fallback
            Gu = self.G.to_undirected()
            try:
                sp = nx.shortest_path(Gu, src_id, tgt_id)
                raw_paths = [sp]
            except Exception:
                pass

        if not raw_paths:
            return {
                "found": False,
                "source": src_id, "target": tgt_id,
                "paths": [],
                "explanation": f"No dependency path found between {src_id} and {tgt_id}.",
            }

        paths_out = []
        for path in raw_paths:
            edges_out = []
            for i in range(len(path) - 1):
                edata = self.G.get_edge_data(path[i], path[i+1]) or {}
                edges_out.append({
                    "from":      path[i],
                    "to":        path[i+1],
                    "edge_type": edata.get("edge_type", "unknown"),
                    "weight":    round(edata.get("weight", 0.0), 4),
                    "source":    edata.get("source", ""),
                    "description": edata.get("description", ""),
                })
            paths_out.append({
                "nodes":        [self._node_summary(n) for n in path],
                "edges":        edges_out,
                "total_weight": round(_path_weight(path), 4),
                "length":       len(path) - 1,
            })

        # Human-readable explanation
        best   = paths_out[0]
        arrow  = " → ".join(n["label"] for n in best["nodes"])
        etypes = " → ".join(e["edge_type"] for e in best["edges"])
        expl   = f"Dependency path: {arrow}\nEdge types: {etypes}"

        return {
            "found":       True,
            "source":      src_id,
            "target":      tgt_id,
            "paths":       paths_out,
            "explanation": expl,
        }

    # ── 5.2  Risk propagation ────────────────────────────────────────────────

    def propagate_risk(
        self,
        node: str,
        shock: float = 8.0,
        max_hops: int = 4,
        damping: float = 0.65,
        normalize_id: bool = True,
    ) -> Dict:
        """
        Simulate a risk shock propagating through the dependency network.

        Uses a modified BFS where impact decays by edge weight × damping
        per hop.  Stops when impact < 0.1 or max_hops reached.

        Parameters
        ----------
        node : str
            Source of shock (canonical id or raw name).
        shock : float
            Initial shock severity [0–10].
        max_hops : int
            Maximum propagation depth.
        damping : float
            Decay factor per hop (0–1). Lower = faster decay.

        Returns
        -------
        {
          "source_node": str,
          "shock": float,
          "affected": [
            {"node_id", "label", "node_type", "impact", "hops",
             "path", "edge_types"}
          ],
          "total_affected": int,
          "critical_path": [...],
        }
        """
        src_id = self._resolve_node(node) if normalize_id else node
        if src_id is None or src_id not in self.G:
            return {
                "source_node": node, "shock": shock,
                "affected": [], "total_affected": 0,
                "error": f"Node '{node}' not found."
            }

        # BFS with impact tracking
        # queue: (current_node, impact_remaining, hop_count, path, edge_types)
        from collections import deque
        queue   = deque([(src_id, shock, 0, [src_id], [])])
        visited: Dict[str, float] = {src_id: shock}  # nid → max_impact_seen
        affected: List[Dict] = []

        while queue:
            cur, impact, hops, path, etypes = queue.popleft()
            if hops >= max_hops:
                continue

            for neighbor in self.G.successors(cur):
                edata      = self.G[cur][neighbor]
                edge_w     = edata.get("weight", 0.5)
                edge_type  = edata.get("edge_type", "")
                propagated = impact * edge_w * damping

                if propagated < 0.1:
                    continue
                if neighbor in visited and visited[neighbor] >= propagated:
                    continue

                visited[neighbor] = propagated
                ndata = self.G.nodes[neighbor]
                new_path   = path + [neighbor]
                new_etypes = etypes + [edge_type]

                affected.append({
                    "node_id":   neighbor,
                    "label":     ndata.get("label", neighbor),
                    "node_type": ndata.get("node_type", "?"),
                    "impact":    round(propagated, 3),
                    "hops":      hops + 1,
                    "path":      new_path,
                    "edge_types": new_etypes,
                })
                queue.append((neighbor, propagated, hops + 1, new_path, new_etypes))

        affected.sort(key=lambda x: -x["impact"])

        # Critical path = highest-impact chain
        critical = affected[0]["path"] if affected else [src_id]

        return {
            "source_node":   src_id,
            "source_label":  self.G.nodes.get(src_id, {}).get("label", src_id),
            "shock":         shock,
            "affected":      affected[:50],   # cap output
            "total_affected":len(affected),
            "critical_path": critical,
            "critical_path_labels": [
                self.G.nodes.get(n, {}).get("label", n) for n in critical
            ],
        }

    # ── 5.3  Critical nodes ──────────────────────────────────────────────────

    def get_most_critical_nodes(
        self,
        k: int = 20,
        node_types: Optional[List[str]] = None,
    ) -> List[Dict]:
        """
        Return top-k nodes by composite criticality score.

        Criticality = 0.4 × betweenness + 0.3 × pagerank_norm
                    + 0.2 × risk_score_norm + 0.1 × in_degree_norm

        Parameters
        ----------
        k : int
            Number of nodes to return.
        node_types : list[str], optional
            Filter to specific node types (e.g. ["country", "company"]).

        Returns
        -------
        List of node dicts with criticality score.
        """
        nodes_data = list(self.G.nodes(data=True))
        if node_types:
            nodes_data = [
                (nid, d) for nid, d in nodes_data
                if d.get("node_type") in node_types
            ]
        if not nodes_data:
            return []

        # Normalisation helpers
        max_pr   = max((d.get("pagerank",  0) for _, d in nodes_data), default=1) or 1
        max_risk = max((d.get("risk_score",0) for _, d in nodes_data), default=1) or 1
        max_in   = max((self.G.in_degree(n) for n, _ in nodes_data), default=1)   or 1
        max_bc   = max((d.get("centrality",0) for _, d in nodes_data), default=1) or 1

        scored = []
        for nid, d in nodes_data:
            bc    = d.get("centrality",  0.0) / max_bc
            pr    = d.get("pagerank",    0.0) / max_pr
            risk  = d.get("risk_score",  0.0) / max_risk
            indeg = self.G.in_degree(nid)    / max_in

            criticality = (
                0.40 * bc   +
                0.30 * pr   +
                0.20 * risk +
                0.10 * indeg
            )
            scored.append({
                "node_id":     nid,
                "label":       d.get("label", nid),
                "node_type":   d.get("node_type", "?"),
                "criticality": round(criticality, 5),
                "betweenness": round(d.get("centrality",  0.0), 5),
                "pagerank":    round(d.get("pagerank",    0.0), 5),
                "risk_score":  round(d.get("risk_score",  0.0), 2),
                "in_degree":   self.G.in_degree(nid),
                "out_degree":  self.G.out_degree(nid),
                "updated_at":  d.get("updated_at", ""),
            })

        scored.sort(key=lambda x: -x["criticality"])
        return scored[:k]

    # ── 5.4  Neighbourhood ───────────────────────────────────────────────────

    def get_neighbours(
        self,
        node_id: str,
        direction: str = "both",  # "in" | "out" | "both"
        max_n: int = 30,
    ) -> Dict:
        """Return immediate neighbours of a node with edge metadata."""
        nid = self._resolve_node(node_id)
        if nid is None or nid not in self.G:
            return {"node_id": node_id, "neighbours": [], "error": "Node not found"}

        neighbours = []
        if direction in ("out", "both"):
            for tgt in self.G.successors(nid):
                edata = self.G[nid][tgt]
                neighbours.append({
                    "node_id":    tgt,
                    "label":      self.G.nodes[tgt].get("label", tgt),
                    "node_type":  self.G.nodes[tgt].get("node_type", "?"),
                    "edge_type":  edata.get("edge_type", ""),
                    "weight":     round(edata.get("weight", 0), 4),
                    "direction":  "out",
                })
        if direction in ("in", "both"):
            for src in self.G.predecessors(nid):
                edata = self.G[src][nid]
                neighbours.append({
                    "node_id":   src,
                    "label":     self.G.nodes[src].get("label", src),
                    "node_type": self.G.nodes[src].get("node_type", "?"),
                    "edge_type": edata.get("edge_type", ""),
                    "weight":    round(edata.get("weight", 0), 4),
                    "direction": "in",
                })

        neighbours.sort(key=lambda x: -x["weight"])
        return {
            "node_id":    nid,
            "label":      self.G.nodes[nid].get("label", nid),
            "node_type":  self.G.nodes[nid].get("node_type", "?"),
            "risk_score": self.G.nodes[nid].get("risk_score", 0.0),
            "neighbours": neighbours[:max_n],
        }

    # ── 5.5  Export ──────────────────────────────────────────────────────────

    def to_json(self, min_weight: float = 0.1) -> Dict:
        """Export graph as JSON (node-link format) for REST API / frontend."""
        nodes_out = []
        for nid, d in self.G.nodes(data=True):
            nodes_out.append({
                "id":          nid,
                "label":       d.get("label", nid),
                "node_type":   d.get("node_type", "?"),
                "risk_score":  round(d.get("risk_score",  0.0), 2),
                "criticality": round(d.get("centrality",  0.0), 5),
                "pagerank":    round(d.get("pagerank",     0.0), 5),
                "in_degree":   self.G.in_degree(nid),
                "updated_at":  d.get("updated_at", ""),
            })

        edges_out = []
        for src, tgt, d in self.G.edges(data=True):
            if d.get("weight", 0) < min_weight:
                continue
            edges_out.append({
                "source":      src,
                "target":      tgt,
                "edge_type":   d.get("edge_type", ""),
                "weight":      round(d.get("weight", 0), 4),
                "source_data": d.get("source", ""),
                "timestamp":   d.get("timestamp", ""),
                "confidence":  round(d.get("confidence", 0.8), 3),
                "description": d.get("description", ""),
            })

        return {
            "nodes":   nodes_out,
            "edges":   edges_out,
            "stats":   {
                "n_nodes": len(nodes_out),
                "n_edges": len(edges_out),
                "generated_at": datetime.now(timezone.utc).isoformat(),
            },
        }

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _resolve_node(self, raw: str) -> Optional[str]:
        """
        Resolve raw string to a canonical node ID.
        Tries:
          1. Direct match
          2. Prefix search ("US" → "country:US")
          3. Fuzzy label search
        """
        # 1. Direct
        if raw in self.G:
            return raw

        # 2. Prefix  "US" → "country:US"
        for ntype in NODE_TYPES:
            candidate = f"{ntype}:{raw}"
            if candidate in self.G:
                return candidate
            # Try uppercase (tickers)
            candidate_upper = f"{ntype}:{raw.upper()}"
            if candidate_upper in self.G:
                return candidate_upper

        # 3. Label match (case-insensitive)
        raw_lower = raw.lower()
        for nid, d in self.G.nodes(data=True):
            label = d.get("label", "").lower()
            if label == raw_lower or label.startswith(raw_lower):
                return nid

        # 4. Country code lookup
        code = COUNTRY_CODES.get(raw.lower())
        if code:
            candidate = f"country:{code}"
            if candidate in self.G:
                return candidate

        return None

    def _node_summary(self, nid: str) -> Dict:
        d = self.G.nodes.get(nid, {})
        return {
            "id":        nid,
            "label":     d.get("label", nid),
            "node_type": d.get("node_type", "?"),
            "risk_score":round(d.get("risk_score", 0.0), 2),
        }


# ════════════════════════════════════════════════════════════════════════════
# 6. SINGLETON INSTANCE (process-level cache)
# ════════════════════════════════════════════════════════════════════════════

_GLOBAL_ENGINE: Optional[DependencyQueryEngine] = None
_ENGINE_LOCK = asyncio.Lock() if _NX else None


async def get_engine(events: Optional[List[Dict]] = None) -> DependencyQueryEngine:
    """
    Return (or build) the global DependencyQueryEngine singleton.

    On first call: seeds static KB + ingests events.
    On subsequent calls: incrementally updates with new events.
    Thread-safe via asyncio.Lock.
    """
    global _GLOBAL_ENGINE

    if _GLOBAL_ENGINE is None:
        async with _ENGINE_LOCK:
            if _GLOBAL_ENGINE is None:  # double-checked
                builder = DependencyGraphBuilder()
                builder.seed_static_knowledge()
                if events:
                    loop = asyncio.get_event_loop()
                    await loop.run_in_executor(
                        None, builder.ingest_events, events
                    )
                _GLOBAL_ENGINE = DependencyQueryEngine(builder)
                logger.info(
                    "DependencyEngine initialised: %d nodes, %d edges",
                    _GLOBAL_ENGINE.G.number_of_nodes(),
                    _GLOBAL_ENGINE.G.number_of_edges(),
                )
    elif events:
        # Incremental update
        async with _ENGINE_LOCK:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, _GLOBAL_ENGINE._b.ingest_events, events
            )

    return _GLOBAL_ENGINE


def reset_engine() -> None:
    """Force full rebuild on next get_engine() call (e.g., after schema migration)."""
    global _GLOBAL_ENGINE
    _GLOBAL_ENGINE = None
    logger.info("DependencyEngine reset.")
