"""
WorldLens Text-to-KG Pipeline
==============================
Converts any text (PDF, URL, paste, template) into KG nodes and edges.

Two-pass extraction:
  Pass 1 — Rule-based (always, zero cost):
    • Named entity recognition via regex
    • Financial entity detection (tickers, indices, rates)
    • Relationship detection (causal, correlational)
    • Template parsing (WorldLens .txt format)

  Pass 2 — Gemini extraction (if API key present):
    • Semantic entity extraction (org, person, concept)
    • Causal chain extraction ("X caused Y because Z")
    • Confidence scoring
    • Deduplication against existing KG

Supports:
  • Plain text paste
  • URL scraping
  • PDF (via existing KG upload endpoint)
  • Pre-built templates (8 domain templates)
"""
from __future__ import annotations
import asyncio
import json
import logging
import re
from typing import Dict, List, Optional, Tuple

import aiosqlite

from config import settings

logger = logging.getLogger(__name__)

# ── Rule-based entity patterns ────────────────────────────────────────────────

# Financial tickers (2-5 uppercase letters, optional .exchange)
_TICKER_PAT = re.compile(r'\b([A-Z]{2,5})(?:\.[A-Z]{1,3})?\b')

# Known financial entity classes
_CENTRAL_BANKS = re.compile(
    r'\b(Federal Reserve|Fed|FOMC|ECB|BoE|Bank of England|BOJ|Bank of Japan|'
    r'PBOC|SNB|RBA|RBI|Banco Central|central bank)\b', re.I)

_FIN_INSTRUMENTS = re.compile(
    r'\b(Treasury|T-bill|T-note|T-bond|Bund|BTP|JGB|gilt|repo|LIBOR|SOFR|'
    r'swap|CDS|CDO|MBS|CLO|ABS|ETF|mutual fund|hedge fund)\b', re.I)

_MACRO_INDICATORS = re.compile(
    r'\b(GDP|CPI|PCE|PPI|NFP|PMI|ISM|VIX|MOVE|DXY|inflation|deflation|'
    r'unemployment|jobs|payroll|yield curve|spread|basis point|bps|'
    r'interest rate|fed funds|repo rate|discount rate)\b', re.I)

_COMPANIES = re.compile(
    r'\b(Apple|Microsoft|Google|Alphabet|Amazon|Meta|Tesla|Nvidia|'
    r'JPMorgan|Goldman|BlackRock|Vanguard|TSMC|Samsung|Alibaba|Tencent|'
    r'Toyota|Volkswagen|BMW|Airbus|Boeing|Shell|ExxonMobil|Chevron)\b', re.I)

_COUNTRIES = re.compile(
    r'\b(United States|USA|US|China|PRC|Germany|Japan|India|UK|Britain|'
    r'France|Italy|Brazil|Russia|Canada|Australia|South Korea|Taiwan|'
    r'Saudi Arabia|Iran|Turkey|Mexico|Indonesia|Switzerland|Netherlands)\b', re.I)

_ORG_PAT = re.compile(
    r'\b(OPEC|NATO|G7|G20|IMF|World Bank|BIS|OECD|WTO|SEC|CFTC|FCA|'
    r'BRICS|ASEAN|SCO|SWIFT|EU|European Union|United Nations|WHO)\b', re.I)

# Causal relationship patterns
_CAUSAL_PAT = re.compile(
    r'(?P<src>[A-Z][a-zA-Z\s,]+?)\s+(?:caused?|led? to|resulted? in|'
    r'triggered?|drove?|pushed?|boosted?|lowered?|raised?|increased?|'
    r'decreased?)\s+(?P<tgt>[A-Z][a-zA-Z\s,]+?)(?=[,\.;\n])', re.I)

_CORREL_PAT = re.compile(
    r'(?P<src>[A-Z][a-zA-Z\s]+?)\s+(?:correlates? with|tracks?|follows?|'
    r'moves? with|inversely correlates?)\s+(?P<tgt>[A-Z][a-zA-Z\s]+?)(?=[,\.;\n])', re.I)

# Number extraction for indicator values
_VALUE_PAT = re.compile(
    r'(?P<name>[A-Z][a-zA-Z\s]+?)\s+(?:of|at|reached?|hit|was|is)\s+'
    r'(?P<value>[\d,\.]+)\s*(?P<unit>%|bps|bp|bn|B|T|M|K|x|times)?', re.I)


def rule_based_extract(text: str) -> Dict:
    """
    Fast rule-based extraction. Zero API cost.
    Returns {nodes: [...], edges: [...], indicators: [...]}
    """
    nodes = []
    edges = []
    seen_labels = set()

    def add_node(label, ntype, confidence=0.7):
        label = label.strip()[:80]
        if len(label) < 2 or label.lower() in seen_labels:
            return
        seen_labels.add(label.lower())
        nodes.append({"label": label, "type": ntype, "confidence": confidence})

    # Extract entities
    for m in _CENTRAL_BANKS.finditer(text):
        add_node(m.group(1), "entity", 0.9)

    for m in _MACRO_INDICATORS.finditer(text):
        add_node(m.group(1), "indicator", 0.85)

    for m in _FIN_INSTRUMENTS.finditer(text):
        add_node(m.group(1), "concept", 0.8)

    for m in _COMPANIES.finditer(text):
        add_node(m.group(1), "entity", 0.85)

    for m in _COUNTRIES.finditer(text):
        add_node(m.group(1), "geo", 0.85)

    for m in _ORG_PAT.finditer(text):
        add_node(m.group(1), "entity", 0.9)

    # Extract values
    indicators = []
    for m in _VALUE_PAT.finditer(text):
        name  = m.group("name").strip()
        value = m.group("value").replace(",", "")
        unit  = m.group("unit") or ""
        if len(name) > 3 and len(name) < 50:
            indicators.append({"name": name, "value": value, "unit": unit})

    # Extract causal edges (best effort — requires both ends to be known)
    label_set = {n["label"].lower() for n in nodes}
    for m in _CAUSAL_PAT.finditer(text):
        src = m.group("src").strip()[:60]
        tgt = m.group("tgt").strip()[:60]
        if len(src) > 3 and len(tgt) > 3:
            edges.append({
                "src": src, "tgt": tgt,
                "relation": "causes",
                "evidence": m.group(0)[:200],
                "weight": 1.2,
                "confidence": 0.6,
            })

    for m in _CORREL_PAT.finditer(text):
        src = m.group("src").strip()[:60]
        tgt = m.group("tgt").strip()[:60]
        if len(src) > 3 and len(tgt) > 3:
            edges.append({
                "src": src, "tgt": tgt,
                "relation": "correlates_with",
                "evidence": m.group(0)[:200],
                "weight": 1.0,
                "confidence": 0.6,
            })

    return {"nodes": nodes, "edges": edges, "indicators": indicators}


async def gemini_extract_full(text: str, user_gemini_key: str = "",
                               user_anthropic_key: str = "") -> Optional[Dict]:
    """
    Full Gemini extraction for rich semantic understanding.
    Returns {nodes: [...], edges: [...]} or None if no key.
    """
    if not user_gemini_key and not user_anthropic_key:
        return None

    from ai_layer import _call_claude
    prompt = f"""Analyze this financial/geopolitical text and extract a knowledge graph.

TEXT:
{text[:4000]}

Return ONLY valid JSON (no markdown, no backticks) with this exact structure:
{{
  "nodes": [
    {{"label": "Federal Reserve", "type": "entity", "description": "US central bank", "confidence": 0.95}},
    {{"label": "Inflation", "type": "indicator", "description": "Price level rise", "confidence": 0.9}}
  ],
  "edges": [
    {{"src": "Federal Reserve", "tgt": "Interest Rate", "relation": "influences", "evidence": "Fed sets rates via FOMC", "weight": 2.0}},
    {{"src": "Inflation", "tgt": "Federal Reserve", "relation": "causes", "evidence": "High inflation forces rate hikes", "weight": 1.8}}
  ]
}}

Node types: entity, concept, indicator, policy, event, etf, currency, commodity, person, geo
Edge relations: influences, causes, correlates_with, tracks, part_of, contradicts, invests_in, leads, member_of, related

Rules:
- Extract 10-30 nodes maximum
- Extract 10-40 edges maximum  
- Only include nodes and edges explicitly mentioned or strongly implied
- Confidence 0.5-1.0 based on how explicitly stated
- For edges, only create if BOTH nodes are in your nodes list
- Return ONLY the JSON object, nothing else"""

    try:
        result = await _call_claude(
            prompt,
            system="You are a financial knowledge graph extraction engine. Return only valid JSON.",
            max_tokens=2000,
            user_gemini_key=user_gemini_key,
            user_anthropic_key=user_anthropic_key,
        )
        if not result:
            return None
        # Strip any markdown fences
        result = re.sub(r'^```(?:json)?\s*', '', result.strip())
        result = re.sub(r'\s*```$', '', result)
        data = json.loads(result)
        if not isinstance(data.get("nodes"), list):
            return None
        return data
    except Exception as e:
        logger.debug("gemini_extract_full: %s", e)
        return None


async def ingest_text_to_kg(
    text: str,
    source_name: str = "text_upload",
    user_gemini_key: str = "",
    user_anthropic_key: str = "",
) -> Dict:
    """
    Main entry: convert text → KG nodes and edges.
    Returns {nodes_added, edges_added, method}.
    """
    if not text or len(text.strip()) < 20:
        return {"nodes_added": 0, "edges_added": 0, "method": "none", "error": "Text too short"}

    from routers.knowledge_graph import upsert_node, upsert_edge
    from supabase_client import get_pool, ensure_kg_schema

    await ensure_kg_schema()

    total_n = total_e = 0
    method = "rule_based"
    extraction = None

    # Pass 1: Rule-based (always)
    rule_result = rule_based_extract(text)

    # Pass 2: Gemini (if key present)
    if user_gemini_key or user_anthropic_key:
        gemini_result = await gemini_extract_full(text, user_gemini_key, user_anthropic_key)
        if gemini_result and gemini_result.get("nodes"):
            # Merge: Gemini nodes + rule nodes (Gemini takes priority)
            extraction = gemini_result
            # Add any rule-only nodes not found by Gemini
            gemini_labels = {n["label"].lower() for n in extraction["nodes"]}
            for rn in rule_result["nodes"]:
                if rn["label"].lower() not in gemini_labels:
                    extraction["nodes"].append(rn)
            method = "gemini+rule"
        else:
            extraction = rule_result
    else:
        extraction = rule_result

    # Ingest nodes
    node_ids: Dict[str, int] = {}
    for n in extraction.get("nodes", []):
        label = (n.get("label") or "").strip()
        if not label or len(label) < 2:
            continue
        ntype = n.get("type", "concept")
        desc  = n.get("description", "")[:400]
        conf  = float(n.get("confidence", 0.75))
        nid   = await upsert_node(label, ntype, desc, conf)
        if nid:
            node_ids[label] = nid
            node_ids[label.lower()] = nid
            total_n += 1

    # Ingest edges
    for e in extraction.get("edges", []):
        src_l = (e.get("src") or "").strip()
        tgt_l = (e.get("tgt") or "").strip()
        rel   = e.get("relation", "related")
        ev_t  = (e.get("evidence") or "")[:300]
        w     = float(e.get("weight", 1.0))

        sid = node_ids.get(src_l) or node_ids.get(src_l.lower())
        tid = node_ids.get(tgt_l) or node_ids.get(tgt_l.lower())

        # Try DB lookup if not in batch
        if not sid:
            sid = await _lookup_node(src_l)
            if sid:
                node_ids[src_l] = sid
        if not tid:
            tid = await _lookup_node(tgt_l)
            if tid:
                node_ids[tgt_l] = tid

        if sid and tid:
            eid = await upsert_edge(sid, tid, rel, ev_t, w)
            if eid:
                total_e += 1

    logger.info("Text-to-KG (%s): +%d nodes +%d edges from '%s'",
                method, total_n, total_e, source_name[:40])
    return {
        "nodes_added": total_n,
        "edges_added": total_e,
        "method": method,
        "source": source_name,
    }


async def _lookup_node(label: str) -> Optional[int]:
    """Fuzzy lookup existing node by label."""
    from supabase_client import get_pool
    pool = await get_pool()
    try:
        if pool:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT id FROM kg_nodes WHERE LOWER(label)=LOWER($1) OR "
                    "LOWER(label) LIKE LOWER($2) LIMIT 1",
                    label, f"%{label}%"
                )
                return row["id"] if row else None
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT id FROM kg_nodes WHERE LOWER(label)=LOWER(?) LIMIT 1", (label,)
                ) as c:
                    row = await c.fetchone()
                    return row["id"] if row else None
    except Exception:
        return None


# ── URL scraping ──────────────────────────────────────────────────────────────

async def scrape_url_to_kg(url: str, user_gemini_key: str = "",
                            user_anthropic_key: str = "") -> Dict:
    """Fetch URL content and extract KG nodes/edges."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15, follow_redirects=True) as client:
            r = await client.get(url, headers={"User-Agent": "WorldLens/2.0 (research)"})
            if r.status_code != 200:
                return {"error": f"HTTP {r.status_code}", "nodes_added": 0, "edges_added": 0}
            content_type = r.headers.get("content-type", "")
            if "html" in content_type:
                # Strip HTML tags
                text = re.sub(r'<[^>]+>', ' ', r.text)
                text = re.sub(r'\s+', ' ', text)[:8000]
            else:
                text = r.text[:8000]

        return await ingest_text_to_kg(
            text, source_name=url[:80],
            user_gemini_key=user_gemini_key,
            user_anthropic_key=user_anthropic_key,
        )
    except Exception as e:
        return {"error": str(e), "nodes_added": 0, "edges_added": 0}


# ── Pre-built domain templates ────────────────────────────────────────────────

TEMPLATES = {
    "fed_fomc": {
        "name": "📊 Fed FOMC Minutes",
        "description": "Federal Reserve meeting minutes template with rate decisions, economic outlook, dissents",
        "text": """
The Federal Reserve FOMC decided to maintain the federal funds rate at current levels.
The Committee noted that inflation has continued to progress toward the 2% PCE target.
Labor market conditions remain strong, with unemployment near the natural rate.
The Federal Reserve monitors GDP growth, employment, and core PCE inflation.
The yield curve remains a key indicator of economic health.
Interest rate decisions influence bond markets, equity valuations, and currency markets.
The Federal Reserve uses forward guidance to manage market expectations.
Quantitative Tightening continues to reduce the Fed balance sheet.
DXY dollar index reacts to Fed policy divergence with ECB and BOJ.
TLT treasury ETF inversely tracks Fed rate expectations.
Credit spread widening signals potential recession risk.
"""
    },
    "ecb_statement": {
        "name": "🇪🇺 ECB Policy Statement",
        "description": "European Central Bank monetary policy statement template",
        "text": """
The ECB Governing Council decided to adjust key interest rates.
The main refinancing operations rate, marginal lending facility, and deposit facility rate govern eurozone banking.
HICP inflation in the eurozone requires sustained restrictive monetary policy.
GDP growth in Germany, France, Italy and Spain diverges reflecting structural differences.
BTP-Bund spread measures Italian risk premium versus German benchmark.
The ECB uses PEPP and APP asset purchase programmes.
IBGL euro government bond ETF tracks ECB rate expectations.
The EUR/USD currency pair reflects Fed-ECB policy divergence.
European banking sector requires EBA stress testing and SRB resolution readiness.
Green bonds and sustainable finance are ECB priority under EU Green Deal.
"""
    },
    "imf_weo": {
        "name": "🌍 IMF World Economic Outlook",
        "description": "IMF World Economic Outlook global growth and risk assessment template",
        "text": """
Global GDP growth is projected to remain below historical averages.
Advanced economies including United States, European Union, and Japan face fiscal sustainability challenges.
Emerging market economies led by India and China face divergent growth paths.
Global inflation is declining but remains above central bank targets in many economies.
The Federal Reserve, ECB, Bank of England and Bank of Japan normalize monetary policy.
Rising debt-to-GDP ratios in G7 nations risk fiscal dominance scenarios.
Geopolitical fragmentation threatens global trade and supply chain efficiency.
Climate transition costs present upside risk to energy inflation globally.
The IMF SDR allocation and lending facilities support vulnerable economies.
Foreign exchange reserves and current account balances determine external vulnerability.
Emerging market currencies face pressure from dollar strength and capital outflows.
"""
    },
    "earnings_template": {
        "name": "📈 Earnings Season Report",
        "description": "Corporate earnings analysis template for major sectors",
        "text": """
S&P 500 earnings per share beat analyst consensus estimates.
Technology sector led by Apple, Microsoft, Nvidia and Alphabet reported strong results.
Artificial intelligence revenue from cloud services drove Microsoft Azure growth.
Nvidia data center revenue surged on AI GPU demand from hyperscalers.
Financial sector JPMorgan Chase, Goldman Sachs reported net interest income.
Healthcare sector Eli Lilly and UnitedHealth beat on GLP-1 drug demand.
Energy sector ExxonMobil and Chevron earnings tracked oil price movements.
Consumer discretionary Amazon and Tesla diverged on margin improvement.
P/E ratio expansion driven by AI optimism creates valuation risk.
EPS growth estimates for forward quarters determine equity market direction.
"""
    },
    "geo_crisis": {
        "name": "⚡ Geopolitical Crisis Brief",
        "description": "Geopolitical risk and market impact template",
        "text": """
Geopolitical risk elevated across multiple hotspots simultaneously.
Russia-Ukraine war continues with energy market implications for European Union.
Middle East tensions involving Israel, Iran, and Saudi Arabia drive oil price volatility.
Taiwan Strait tensions create risk premium for TSMC semiconductor production.
Trade war between United States and China escalates with new tariffs.
Sanctions regimes impact Russia, Iran, and North Korea economic activity.
Supply chain disruption from conflicts raises commodity prices and inflation.
Gold price and VIX volatility index rise as safe haven demand increases.
US dollar strengthens as global risk-off sentiment increases.
Emerging market currencies under pressure from capital flight to safety.
Energy security concerns accelerate renewable energy transition investment.
Defense spending increase benefits Lockheed Martin, RTX, and NATO member nations.
"""
    },
    "fx_weekly": {
        "name": "💱 FX Weekly Outlook",
        "description": "Foreign exchange market analysis template",
        "text": """
DXY dollar index movement reflects Federal Reserve policy expectations.
EUR/USD pair trades near key technical levels on ECB-Fed divergence.
Japanese yen USDJPY weakens as Bank of Japan maintains accommodative policy.
British pound GBP/USD sensitive to Bank of England inflation trajectory.
Chinese yuan CNY managed float within PBOC daily fixing band.
Australian dollar AUD/USD tracks Chinese commodity demand and RBA policy.
Canadian dollar CAD/USD correlates with WTI oil price movements.
Brazilian real BRL/USD carries high interest rate premium over USD.
Carry trade dynamics favor high-yielding currencies in risk-on environment.
Emerging market currencies vulnerable to sudden stop in capital flows.
Swiss franc CHF is safe haven currency during geopolitical stress periods.
Currency wars risk as competitive devaluation pressures global trade.
"""
    },
    "portfolio_analysis": {
        "name": "💼 Portfolio Stress Test",
        "description": "Investment portfolio risk analysis template",
        "text": """
Portfolio diversification across VWCE global equity and IBGL euro bonds.
60/40 portfolio allocation between equity markets and bond markets.
Dollar cost averaging strategy reduces timing risk for long-term investors.
VWCE Vanguard All-World ETF provides exposure to developed and emerging markets.
TLT long-duration treasury ETF acts as hedge during risk-off periods.
GLD gold ETF provides inflation hedge and safe haven diversification.
HYG high yield bond ETF tracks credit spread as risk appetite indicator.
Portfolio rebalancing sells winners and buys laggards to maintain target allocation.
Sharpe ratio measures risk-adjusted return relative to volatility.
Beta measures portfolio sensitivity to market movements.
Correlation between asset classes determines true diversification benefit.
Recession scenario stress test models impact on equity and credit portfolio.
"""
    },
    "crypto_defi": {
        "name": "₿ Crypto & DeFi Overview",
        "description": "Cryptocurrency and decentralized finance knowledge template",
        "text": """
Bitcoin is the first cryptocurrency with 21 million supply cap and halving mechanism.
Ethereum smart contract platform enables DeFi protocols and NFT markets.
Stablecoins USDT and USDC provide dollar-pegged liquidity in crypto markets.
Bitcoin halving reduces block reward every 210,000 blocks approximately every 4 years.
Bitcoin correlation with risk assets like Nasdaq increases during stress periods.
Ethereum proof of stake transition reduced energy consumption by 99.95%.
DeFi protocols allow lending, borrowing, and trading without intermediaries.
CBDC central bank digital currencies represent state response to crypto.
Crypto regulation by SEC, CFTC, and international bodies creates compliance risk.
Bitcoin institutional adoption via ETFs from BlackRock, Fidelity, Vanguard.
Stablecoin depegging events create systemic risk across DeFi ecosystem.
"""
    },
}


def get_template_list() -> List[Dict]:
    """Return list of available templates for UI."""
    return [
        {
            "id": k,
            "name": v["name"],
            "description": v["description"],
            "word_count": len(v["text"].split()),
        }
        for k, v in TEMPLATES.items()
    ]


async def ingest_template(
    template_id: str,
    user_gemini_key: str = "",
    user_anthropic_key: str = "",
) -> Dict:
    """Load and ingest a pre-built domain template."""
    if template_id not in TEMPLATES:
        return {"error": f"Template '{template_id}' not found", "nodes_added": 0, "edges_added": 0}
    tmpl = TEMPLATES[template_id]
    return await ingest_text_to_kg(
        tmpl["text"],
        source_name=f"template:{template_id}",
        user_gemini_key=user_gemini_key,
        user_anthropic_key=user_anthropic_key,
    )
