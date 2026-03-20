"""
WorldLens — Geopolitical Knowledge Graph
=========================================
Uses NetworkX to model relationships between:
  - Countries, Actors (leaders, organisations), Resources (commodities, currencies)
  - Events act as edge weights / triggers

Graph schema:
  Nodes: {id, type, label, risk_score, region}
  Edges: {type, weight, description, direction}

Edge types:
  trades_with         — economic dependency
  allies_with         — political/military alliance
  sanctions_on        — economic coercion
  conflict_with       — military / proxy conflict
  supplies            — resource supply chain
  depends_on          — economic/energy dependency
  has_tension_with    — elevated diplomatic tension
  supports            — political support / influence

Key capability:
  Given an event mentioning node X, the graph traversal returns
  all nodes within 2 hops that will likely be affected → automatic
  cascade impact prediction.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# ── Graph availability flag ───────────────────────────────
_NETWORKX_OK = False
try:
    import networkx as nx  # type: ignore
    _NETWORKX_OK = True
except ImportError:
    logger.info("NetworkX not installed — knowledge graph disabled (pip install networkx)")


# ══════════════════════════════════════════════════════════
# STATIC KNOWLEDGE BASE
# Encoded as edge lists for easy maintenance.
# (country/actor → country/actor, edge_type, weight, market_impact)
# ══════════════════════════════════════════════════════════

NODE_REGISTRY: Dict[str, Dict] = {
    # ── Major economies ──────────────────────────────────
    "US":  {"type":"country","label":"United States","region":"Americas","risk":2.0},
    "CN":  {"type":"country","label":"China","region":"Asia","risk":4.0},
    "RU":  {"type":"country","label":"Russia","region":"Europe","risk":7.5},
    "DE":  {"type":"country","label":"Germany","region":"Europe","risk":2.5},
    "JP":  {"type":"country","label":"Japan","region":"Asia","risk":2.0},
    "UK":  {"type":"country","label":"United Kingdom","region":"Europe","risk":3.0},
    "FR":  {"type":"country","label":"France","region":"Europe","risk":3.0},
    "IN":  {"type":"country","label":"India","region":"Asia","risk":4.0},
    "BR":  {"type":"country","label":"Brazil","region":"Americas","risk":5.0},
    "SA":  {"type":"country","label":"Saudi Arabia","region":"Middle East","risk":5.0},
    "UA":  {"type":"country","label":"Ukraine","region":"Europe","risk":9.0},
    "IR":  {"type":"country","label":"Iran","region":"Middle East","risk":7.5},
    "IL":  {"type":"country","label":"Israel","region":"Middle East","risk":7.0},
    "KP":  {"type":"country","label":"North Korea","region":"Asia","risk":8.5},
    "TR":  {"type":"country","label":"Turkey","region":"Middle East","risk":5.5},
    "PK":  {"type":"country","label":"Pakistan","region":"Asia","risk":6.5},
    "MM":  {"type":"country","label":"Myanmar","region":"Asia","risk":8.0},
    "VE":  {"type":"country","label":"Venezuela","region":"Americas","risk":8.0},
    "NG":  {"type":"country","label":"Nigeria","region":"Africa","risk":6.5},
    "EG":  {"type":"country","label":"Egypt","region":"Africa","risk":5.5},
    "TW":  {"type":"country","label":"Taiwan","region":"Asia","risk":7.5},
    "AE":  {"type":"country","label":"UAE","region":"Middle East","risk":3.0},
    "QA":  {"type":"country","label":"Qatar","region":"Middle East","risk":3.5},
    # ── Key institutions ─────────────────────────────────
    "FED": {"type":"institution","label":"Federal Reserve","region":"US","risk":1.0},
    "ECB": {"type":"institution","label":"European Central Bank","region":"Europe","risk":1.0},
    "OPEC":{"type":"institution","label":"OPEC","region":"Global","risk":3.0},
    "NATO":{"type":"institution","label":"NATO","region":"Global","risk":2.0},
    "IMF": {"type":"institution","label":"IMF","region":"Global","risk":1.5},
    "UN":  {"type":"institution","label":"United Nations","region":"Global","risk":1.5},
    # ── Key commodities ──────────────────────────────────
    "OIL": {"type":"commodity","label":"Crude Oil","region":"Global","risk":4.0},
    "GAS": {"type":"commodity","label":"Natural Gas","region":"Global","risk":4.0},
    "GLD": {"type":"commodity","label":"Gold","region":"Global","risk":1.0},
    "WHL": {"type":"commodity","label":"Wheat","region":"Global","risk":5.0},
    "CPR": {"type":"commodity","label":"Copper","region":"Global","risk":3.5},
    "LIT": {"type":"commodity","label":"Lithium","region":"Global","risk":4.0},
    "SEM": {"type":"commodity","label":"Semiconductors","region":"Global","risk":5.0},
    # ── Key markets ──────────────────────────────────────
    "SPX": {"type":"index","label":"S&P 500","region":"US","risk":2.0},
    "NKY": {"type":"index","label":"Nikkei 225","region":"Asia","risk":3.0},
    "DAX": {"type":"index","label":"DAX","region":"Europe","risk":3.0},
    "VIX": {"type":"index","label":"VIX (Volatility)","region":"Global","risk":5.0},
    "BTC": {"type":"crypto","label":"Bitcoin","region":"Global","risk":6.0},
    "USD": {"type":"currency","label":"US Dollar","region":"Global","risk":1.5},
    "EUR": {"type":"currency","label":"Euro","region":"Europe","risk":2.0},
    "JPY": {"type":"currency","label":"Japanese Yen","region":"Asia","risk":2.0},
}

# Edge list: (source, target, type, weight, description, market_signals)
EDGE_LIST: List[Tuple] = [
    # ── Russia-Ukraine conflict cascade ──────────────────
    ("RU","UA","conflict_with",0.95,"Active armed conflict","OIL+,GLD+,SPX-,EUR-,WHL+"),
    ("RU","DE","supplies",0.85,"Russian gas → Germany","GAS+,EUR-,DAX-"),
    ("RU","OIL","supplies",0.90,"Russia is 2nd largest oil producer","OIL+"),
    ("RU","GAS","supplies",0.90,"Russia is 1st largest gas exporter","GAS+"),
    ("UA","WHL","supplies",0.75,"Ukraine: breadbasket of Europe","WHL+"),
    ("US","UA","supports",0.85,"Military/economic support to Ukraine","USD+,SPX-"),
    ("NATO","UA","supports",0.80,"NATO weapons/training","DAX-"),
    ("EU","RU","sanctions_on",0.90,"Comprehensive sanctions regime","EUR-,GAS+"),
    ("US","RU","sanctions_on",0.85,"SWIFT exclusion, export controls","USD+,OIL+"),
    # ── China-Taiwan-US tension ──────────────────────────
    ("CN","TW","conflict_with",0.60,"Sovereignty dispute / threat","SEM+,SPX-"),
    ("US","TW","supports",0.75,"Taiwan Relations Act","SEM-,SPX-"),
    ("CN","SEM","supplies",0.80,"China controls rare earths/assembly","SEM+"),
    ("TW","SEM","supplies",0.95,"TSMC: 90% of advanced chips","SEM+"),
    ("CN","US","has_tension_with",0.75,"Trade war / tech decoupling","SPX-,SEM+"),
    ("CN","OIL","depends_on",0.85,"China: largest oil importer","OIL+"),
    # ── Middle East energy ────────────────────────────────
    ("SA","OIL","supplies",0.95,"Saudi Arabia: swing producer","OIL+"),
    ("SA","OPEC","allies_with",0.90,"OPEC+ leadership","OIL+"),
    ("IR","OIL","supplies",0.70,"Iran sanctions limit exports","OIL+"),
    ("IR","US","has_tension_with",0.85,"Nuclear program tensions","OIL+,GLD+"),
    ("IR","IL","conflict_with",0.70,"Proxy / direct conflict","OIL+,GLD+"),
    ("IL","US","allies_with",0.90,"Strategic alliance","USD+,OIL+"),
    ("QA","GAS","supplies",0.85,"Qatar: LNG exporter","GAS+"),
    ("AE","OIL","supplies",0.75,"UAE oil producer","OIL+"),
    # ── North Korea ───────────────────────────────────────
    ("KP","US","conflict_with",0.50,"Nuclear threats","GLD+,JPY+"),
    ("KP","CN","allies_with",0.60,"Tacit support","VIX+"),
    # ── Monetary policy cascade ───────────────────────────
    ("FED","USD","controls",0.95,"Sets USD interest rates","USD+"),
    ("FED","SPX","influences",0.85,"Rate hikes → equity valuation","SPX-"),
    ("FED","GLD","influences",0.70,"Higher rates → gold headwind","GLD-"),
    ("FED","BTC","influences",0.60,"Risk-off correlates with crypto","BTC-"),
    ("ECB","EUR","controls",0.95,"Sets EUR rates","EUR+"),
    ("ECB","DAX","influences",0.80,"Rate policy → European equities","DAX-"),
    # ── Trade routes ──────────────────────────────────────
    ("CN","US","trades_with",0.90,"Largest bilateral trade","SPX±"),
    ("DE","CN","trades_with",0.70,"German industrial exports","DAX-"),
    ("IN","OIL","depends_on",0.75,"India: 3rd largest importer","OIL+"),
    ("TR","RU","trades_with",0.55,"Energy imports despite sanctions","TRY-"),
    # ── Food security ─────────────────────────────────────
    ("EG","WHL","depends_on",0.80,"Egypt: world's largest wheat importer","WHL+"),
    ("NG","OIL","supplies",0.65,"Nigeria: major Africa producer","OIL+"),
    # ── Clean energy / Battery chain ─────────────────────
    ("CN","LIT","supplies",0.80,"China processes 80% of lithium","LIT+"),
    ("CN","CPR","supplies",0.70,"China: top copper consumer","CPR+"),
    # ── Pakistan instability ──────────────────────────────
    ("PK","IN","has_tension_with",0.65,"Disputed Kashmir","GLD+"),
    ("PK","CN","allies_with",0.70,"CPEC corridor","CPR+"),
]


class GeopoliticalKnowledgeGraph:
    """
    NetworkX-based directed knowledge graph for geopolitical impact propagation.
    Falls back to a simple adjacency dict if NetworkX is unavailable.
    """

    def __init__(self):
        self._graph = None
        self._adj: Dict[str, List[Dict]] = {}  # fallback adjacency
        self._build()

    def _build(self):
        if _NETWORKX_OK:
            import networkx as nx
            self._graph = nx.DiGraph()
            # Add nodes
            for node_id, attrs in NODE_REGISTRY.items():
                self._graph.add_node(node_id, **attrs)
            # Add edges
            for src, tgt, etype, weight, desc, signals in EDGE_LIST:
                self._graph.add_edge(src, tgt,
                    type=etype, weight=weight,
                    description=desc, market_signals=signals)
            logger.info("Knowledge graph: %d nodes, %d edges",
                        self._graph.number_of_nodes(), self._graph.number_of_edges())
        else:
            # Simple adjacency dict fallback
            for src, tgt, etype, weight, desc, signals in EDGE_LIST:
                self._adj.setdefault(src, []).append({
                    "target": tgt, "type": etype, "weight": weight,
                    "description": desc, "market_signals": signals,
                })
            logger.info("Knowledge graph (fallback adj): %d nodes", len(self._adj))

    def get_cascade_impact(
        self,
        node_ids: List[str],
        max_hops: int = 2,
        min_weight: float = 0.4,
    ) -> List[Dict]:
        """
        Starting from node_ids, traverse the graph up to max_hops.
        Returns affected nodes with propagated impact strength.
        """
        if self._graph is not None:
            return self._graph_cascade(node_ids, max_hops, min_weight)
        return self._adj_cascade(node_ids, max_hops, min_weight)

    def _graph_cascade(self, seeds: List[str], max_hops: int,
                        min_weight: float) -> List[Dict]:
        """NetworkX-based BFS traversal with weight decay."""
        import networkx as nx
        visited: Dict[str, float] = {}  # node_id → cumulative weight
        queue: List[Tuple[str, float, int]] = [(s, 1.0, 0) for s in seeds
                                                if s in self._graph]
        while queue:
            nid, strength, hop = queue.pop(0)
            if hop > max_hops: continue
            if nid in visited and visited[nid] >= strength: continue
            visited[nid] = strength

            for _, nbr, data in self._graph.edges(nid, data=True):
                new_strength = strength * data.get("weight", 0.5) * (0.7 ** hop)
                if new_strength >= min_weight and nbr not in seeds:
                    queue.append((nbr, new_strength, hop + 1))

        # Format results
        results = []
        for nid, strength in sorted(visited.items(), key=lambda x: -x[1]):
            if nid in seeds: continue
            node    = NODE_REGISTRY.get(nid, {"label": nid, "type": "unknown"})
            # Find strongest incoming edge from seeds / visited
            edge_desc = ""
            signals   = ""
            for s in seeds:
                if self._graph.has_edge(s, nid):
                    ed = self._graph.edges[s, nid]
                    edge_desc = ed.get("description", "")
                    signals   = ed.get("market_signals", "")
                    break
            results.append({
                "node_id":        nid,
                "label":          node.get("label", nid),
                "type":           node.get("type", "unknown"),
                "region":         node.get("region", ""),
                "base_risk":      node.get("risk", 5.0),
                "impact_strength": round(strength, 3),
                "edge_description": edge_desc,
                "market_signals": signals,
            })
        return results

    def _adj_cascade(self, seeds: List[str], max_hops: int,
                      min_weight: float) -> List[Dict]:
        """Simple BFS without NetworkX."""
        visited: Dict[str, float] = {}
        queue   = [(s, 1.0, 0) for s in seeds]
        while queue:
            nid, strength, hop = queue.pop(0)
            if hop > max_hops: continue
            if strength < min_weight: continue
            if visited.get(nid, 0) >= strength: continue
            visited[nid] = strength
            for edge in self._adj.get(nid, []):
                nbr = edge["target"]
                if nbr in seeds: continue
                new_s = strength * edge["weight"] * (0.7 ** hop)
                queue.append((nbr, new_s, hop + 1))

        results = []
        for nid, strength in sorted(visited.items(), key=lambda x: -x[1]):
            if nid in seeds: continue
            node = NODE_REGISTRY.get(nid, {"label": nid, "type": "unknown"})
            results.append({
                "node_id": nid, "label": node.get("label", nid),
                "type": node.get("type","unknown"), "region": node.get("region",""),
                "base_risk": node.get("risk", 5.0),
                "impact_strength": round(strength, 3),
                "edge_description": "", "market_signals": "",
            })
        return results

    def identify_nodes_from_event(self, title: str, summary: str,
                                    entities: List[Dict]) -> List[str]:
        """
        Map event entities to graph node IDs.
        Checks entity text against node labels and known aliases.
        """
        _LABEL_TO_ID = {v["label"].lower(): k for k, v in NODE_REGISTRY.items()}
        _ALIAS: Dict[str, str] = {
            "russia": "RU", "russian": "RU", "kremlin": "RU",
            "china": "CN", "chinese": "CN", "beijing": "CN",
            "ukraine": "UA", "ukrainian": "UA", "kyiv": "UA",
            "united states": "US", "america": "US",
            "israel": "IL", "iran": "IR", "saudi": "SA",
            "fed": "FED", "federal reserve": "FED",
            "ecb": "ECB", "opec": "OPEC", "nato": "NATO",
            "oil": "OIL", "crude": "OIL", "petroleum": "OIL",
            "gas": "GAS", "lng": "GAS", "natural gas": "GAS",
            "gold": "GLD", "wheat": "WHL",
            "bitcoin": "BTC", "crypto": "BTC",
            "taiwan": "TW", "tsmc": "TW", "semiconductor": "SEM",
            "north korea": "KP", "pyongyang": "KP",
            "turkey": "TR", "pakistan": "PK", "india": "IN",
        }
        text = (title + " " + (summary or "")).lower()
        found: Set[str] = set()

        # From entity list
        for ent in entities:
            et = ent.get("text", "").lower()
            ec = ent.get("canonical", "").lower()
            for alias, nid in _ALIAS.items():
                if alias in et or alias in ec:
                    found.add(nid)
            if ec in _LABEL_TO_ID:
                found.add(_LABEL_TO_ID[ec])

        # From text direct scan
        for alias, nid in _ALIAS.items():
            if alias in text:
                found.add(nid)

        return list(found)

    def get_market_signal_summary(self, cascade: List[Dict]) -> Dict[str, float]:
        """
        Parse market_signals from cascade (e.g. "OIL+,GLD+,SPX-")
        into a dict {asset: direction_score}.
        +/- signals: +1 = positive price pressure, -1 = negative
        """
        signals: Dict[str, float] = {}
        for item in cascade:
            raw = item.get("market_signals", "")
            strength = item.get("impact_strength", 0.5)
            for part in raw.split(","):
                part = part.strip()
                if not part: continue
                sign = +1 if part.endswith("+") else -1 if part.endswith("-") else 0
                if sign == 0: continue
                asset = part.rstrip("+-").strip()
                signals[asset] = signals.get(asset, 0) + sign * strength
        # Normalise to [-1, +1]
        return {a: round(max(-1.0, min(1.0, v)), 3) for a, v in signals.items()}


# ── Singleton ─────────────────────────────────────────────
_kg = GeopoliticalKnowledgeGraph()

def get_cascade_impact(entity_texts: List[str], entities: List[Dict] = None,
                        title: str = "", summary: str = "") -> Dict:
    """
    Convenience function: identify graph nodes from entities/text,
    then propagate impact through the knowledge graph.
    Returns {cascade, market_signals, affected_nodes}.
    """
    if entities is None: entities = []
    node_ids = _kg.identify_nodes_from_event(title, summary, entities)
    # Also map entity_texts directly
    _ALIAS = {"russia":"RU","ukraine":"UA","china":"CN","iran":"IR",
               "israel":"IL","oil":"OIL","gold":"GLD","fed":"FED",
               "opec":"OPEC","taiwan":"TW","bitcoin":"BTC"}
    for et in entity_texts:
        for alias, nid in _ALIAS.items():
            if alias in et.lower():
                node_ids.append(nid)
    node_ids = list(set(node_ids))
    if not node_ids:
        return {"cascade":[], "market_signals":{}, "affected_nodes":[]}
    cascade        = _kg.get_cascade_impact(node_ids)
    market_signals = _kg.get_market_signal_summary(cascade)
    return {
        "seed_nodes":    node_ids,
        "cascade":       cascade[:10],
        "market_signals": market_signals,
        "affected_nodes": [c["label"] for c in cascade[:6]],
    }
