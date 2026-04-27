"""
WorldLens Knowledge Graph Router
----------------------------------
• Shared graph (Supabase PG) + per-user overlay (SQLite)
• Extraction pipeline: ChatGPT JSON / TXT / PDF → Gemini NER → dedup → graph
• Regex fallback when AI unavailable
• CRUD for nodes/edges + user bookmarks
• Graph search with FTS (Postgres) or FTS5 (SQLite)
"""
from __future__ import annotations
import io
import json
import logging
import re
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple

import aiosqlite
from fastapi import APIRouter, Depends, UploadFile, File, Form, Body, HTTPException, BackgroundTasks
from auth import require_user, require_admin
from config import settings
from supabase_client import get_pool, is_postgres, ensure_kg_schema

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/kg", tags=["knowledge-graph"])

# ── Node/Edge types ────────────────────────────────────────────────────────────

NODE_TYPES = {
    "concept":   "Abstract idea or theme",
    "entity":    "Country, company, institution, person",
    "etf":       "Exchange Traded Fund",
    "indicator": "Economic/financial indicator",
    "event":     "Historical or current event",
    "policy":    "Monetary/fiscal/regulatory policy",
    "person":    "Individual (executive, policymaker, etc.)",
    "commodity": "Raw material or commodity",
}

RELATION_TYPES = {
    "influences":      "A has a causal effect on B",
    "correlates_with": "A and B move together statistically",
    "causes":          "A directly causes B",
    "part_of":         "A is a component of B",
    "happened_before": "A preceded B temporally",
    "contradicts":     "A and B are in opposition",
    "tracks":          "ETF/index A tracks underlying B",
    "issued_by":       "Asset A issued by entity B",
    "invests_in":      "A allocates capital to B",
    "regulated_by":    "A is governed by B",
    "related":         "General relationship",
}

# ── Regex-based NER fallback ───────────────────────────────────────────────────

# Entity patterns
_COUNTRY_PATTERNS = re.compile(
    r'\b(USA|United States|US|EU|Europe|China|Russia|Japan|Germany|France|'
    r'Italy|UK|United Kingdom|India|Brazil|Turkey|Iran|Saudi Arabia|Israel|'
    r'Ukraine|Taiwan|South Korea|Canada|Australia|Switzerland|Mexico|Indonesia)\b',
    re.IGNORECASE
)
_ETF_PATTERNS = re.compile(
    r'\b([A-Z]{2,5})\b(?=\s*ETF|\s*fund|\s*index)', re.IGNORECASE
)
_TICKER_PATTERNS = re.compile(r'\b([A-Z]{1,5})\b(?=\s*[\(\-\$])|\$([A-Z]{1,5})\b')
_RATE_PATTERNS = re.compile(
    r'\b(interest rate|fed funds rate|federal funds|repo rate|discount rate|'
    r'base rate|prime rate|overnight rate|10-year yield|2-year yield|'
    r'yield curve|spread|basis points?|bps)\b',
    re.IGNORECASE
)
_INDICATOR_PATTERNS = re.compile(
    r'\b(GDP|CPI|PCE|PPI|NFP|unemployment|inflation|deflation|'
    r'ISM|PMI|retail sales|housing starts|consumer confidence|'
    r'trade balance|current account|fiscal deficit|debt-to-GDP)\b',
    re.IGNORECASE
)
_INSTITUTION_PATTERNS = re.compile(
    r'\b(Federal Reserve|Fed|ECB|Bank of England|BoE|Bank of Japan|BoJ|'
    r'IMF|World Bank|BIS|OECD|OPEC|NATO|WTO|G7|G20|SEC|CFTC|'
    r'Goldman Sachs|JPMorgan|BlackRock|Vanguard|Fidelity|PIMCO)\b',
    re.IGNORECASE
)

# Relation patterns (simple sentence-level heuristics)
_CAUSAL_PATTERNS = re.compile(
    r'(lead[s]? to|caus[e]?[s]?|result[s]? in|trigger[s]?|drive[s]?|push[e]?[s]?)',
    re.IGNORECASE
)
_CORRELATION_PATTERNS = re.compile(
    r'(correlat[e]?[s]?|move[s]? (with|together)|track[s]?|follow[s]?)',
    re.IGNORECASE
)
_CONTRARY_PATTERNS = re.compile(
    r'(despite|however|but|although|contrary to|offset[s]?|hedge[s]?)',
    re.IGNORECASE
)


def regex_extract(text: str) -> Dict[str, List]:
    """Fast regex-based entity extraction. Returns {nodes, edges}."""
    nodes = {}  # label → type

    def add_node(label: str, ntype: str):
        label = label.strip()
        if len(label) < 2 or len(label) > 80:
            return
        key = label.upper()
        if key not in nodes:
            nodes[key] = {"label": label, "type": ntype, "mentions": 1}
        else:
            nodes[key]["mentions"] += 1

    for m in _COUNTRY_PATTERNS.finditer(text):
        add_node(m.group(0), "entity")
    for m in _INSTITUTION_PATTERNS.finditer(text):
        add_node(m.group(0), "entity")
    for m in _ETF_PATTERNS.finditer(text):
        add_node(m.group(1).upper(), "etf")
    for m in _TICKER_PATTERNS.finditer(text):
        t = (m.group(1) or m.group(2) or "").upper()
        if t and len(t) >= 2:
            add_node(t, "entity")
    for m in _RATE_PATTERNS.finditer(text):
        add_node(m.group(0), "indicator")
    for m in _INDICATOR_PATTERNS.finditer(text):
        add_node(m.group(0), "indicator")

    # Simple co-occurrence edges (entities in same sentence)
    edges = []
    sentences = re.split(r'[.!?]+', text)
    node_labels = list(nodes.keys())

    for sent in sentences:
        sent_upper = sent.upper()
        present = [k for k in node_labels if k in sent_upper]
        if len(present) < 2:
            continue

        # Determine relation type
        relation = "related"
        if _CAUSAL_PATTERNS.search(sent):
            relation = "causes"
        elif _CORRELATION_PATTERNS.search(sent):
            relation = "correlates_with"
        elif _CONTRARY_PATTERNS.search(sent):
            relation = "contradicts"

        # Create edges for first 2 co-occurring entities to avoid explosion
        for i in range(min(len(present) - 1, 2)):
            edges.append({
                "src": nodes[present[i]]["label"],
                "tgt": nodes[present[i + 1]]["label"],
                "relation": relation,
                "evidence": sent.strip()[:200],
            })

    node_list = [{"label": v["label"], "type": v["type"],
                  "confidence": min(1.0, 0.4 + v["mentions"] * 0.15)}
                 for v in nodes.values()]
    return {"nodes": node_list, "edges": edges}


# ── Gemini extraction ──────────────────────────────────────────────────────────

EXTRACTION_SYSTEM = """You are a financial knowledge graph extractor.
Extract entities and relationships from the text.
Return ONLY valid JSON, no markdown, no explanation.
Focus on: companies, ETFs, countries, economic indicators, policies, events, people.
Use only these node types: concept, entity, etf, indicator, event, policy, person, commodity
Use only these relation types: influences, correlates_with, causes, part_of, happened_before, contradicts, tracks, issued_by, invests_in, regulated_by, related
"""

EXTRACTION_PROMPT_TMPL = """Extract a knowledge graph from this financial text.

TEXT:
{text}

Return JSON in this EXACT format (no other text):
{{
  "nodes": [
    {{"label": "Federal Reserve", "type": "entity", "description": "US central bank", "confidence": 0.95}},
    {{"label": "Interest Rate", "type": "indicator", "description": "Cost of borrowing", "confidence": 0.9}}
  ],
  "edges": [
    {{"src": "Federal Reserve", "tgt": "Interest Rate", "relation": "influences", "evidence": "The Fed controls interest rates"}}
  ]
}}

Rules:
- Max 30 nodes, max 40 edges per chunk
- Labels must be concise (2-6 words max)
- Only include entities that are clearly financial/economic/geopolitical
- Confidence: 0.5-1.0 based on how clearly the entity appears
- Evidence: quote 1 sentence showing the relationship"""


async def gemini_extract(text: str, user_gemini_key: str = "", user_anthropic_key: str = "") -> Optional[Dict]:
    """Call Gemini to extract structured KG from text. Returns {nodes, edges} or None."""
    try:
        from ai_layer import _call_claude, _get_user_ai_keys
        prompt = EXTRACTION_PROMPT_TMPL.format(text=text[:4000])
        raw = await _call_claude(
            prompt,
            system=EXTRACTION_SYSTEM,
            max_tokens=1500,
            user_gemini_key=user_gemini_key,
            user_anthropic_key=user_anthropic_key,
        )
        if not raw:
            return None
        # Clean and parse
        clean = re.sub(r'```json|```', '', raw).strip()
        # Find JSON object
        m = re.search(r'\{.*\}', clean, re.DOTALL)
        if not m:
            return None
        data = json.loads(m.group(0))
        nodes = data.get("nodes", [])
        edges = data.get("edges", [])
        if not isinstance(nodes, list):
            return None
        return {"nodes": nodes, "edges": edges}
    except Exception as e:
        logger.warning("gemini_extract error: %s", e)
        return None


async def extract_knowledge(text: str, user_id: int) -> Dict:
    """Extract KG using Gemini primary + regex fallback."""
    from ai_layer import _get_user_ai_keys
    ug, ua = await _get_user_ai_keys(user_id)

    result = None
    method = "regex"

    if ug or ua:
        result = await gemini_extract(text, ug, ua)
        if result and result.get("nodes"):
            method = "gemini"

    if not result or not result.get("nodes"):
        result = regex_extract(text)
        method = "regex"

    logger.info("extract_knowledge: %s nodes, %s edges via %s",
                len(result.get("nodes", [])), len(result.get("edges", [])), method)
    return result


# ── Text parsing per source type ───────────────────────────────────────────────

def parse_chatgpt_json(content: bytes) -> List[str]:
    """Extract text chunks from ChatGPT conversations.json export."""
    chunks = []
    try:
        data = json.loads(content)
        # Support both array and {"conversations": [...]} format
        convs = data if isinstance(data, list) else data.get("conversations", [])
        for conv in convs[:200]:  # cap at 200 conversations
            title = conv.get("title", "")
            mapping = conv.get("mapping", {})
            messages = []
            for node in mapping.values():
                msg = node.get("message")
                if not msg:
                    continue
                role = msg.get("author", {}).get("role", "")
                parts = msg.get("content", {}).get("parts", [])
                text = " ".join(str(p) for p in parts if isinstance(p, str))
                if role == "assistant" and len(text) > 50:
                    messages.append(text[:2000])
            if messages:
                chunks.append(f"[{title}]\n" + "\n".join(messages[:10]))
    except Exception as e:
        logger.warning("parse_chatgpt_json: %s", e)
    return chunks


def parse_txt(content: bytes) -> List[str]:
    """Split plain text into ~800-char chunks."""
    text = content.decode("utf-8", errors="ignore")
    # Split by double newline or paragraph
    paras = re.split(r'\n{2,}', text)
    chunks = []
    current = ""
    for p in paras:
        if len(current) + len(p) > 1200:
            if current.strip():
                chunks.append(current.strip())
            current = p
        else:
            current += "\n\n" + p
    if current.strip():
        chunks.append(current.strip())
    return chunks[:100]  # cap


def parse_structured_format(content: bytes) -> Optional[Dict]:
    """
    Parse WorldLens structured format directly — no AI needed.

    Format example:
        # NODO: Federal Reserve
        TIPO: entity
        DESC: US central bank
        ALIAS: Fed, FED

        # EDGE: Federal Reserve -> Interest Rate
        RELAZIONE: influences
        EVIDENZA: Fed controls rates
        PESO: 2.0

    Returns {nodes, edges} ready for ingest_extraction_result(), or None if not structured format.
    """
    text = content.decode("utf-8", errors="ignore")

    # Detect if it uses our structured format
    has_nodo = bool(re.search(r'^#\s*NODO\s*:', text, re.MULTILINE | re.IGNORECASE))
    has_node = bool(re.search(r'^#\s*NODE\s*:', text, re.MULTILINE | re.IGNORECASE))
    has_edge = bool(re.search(r'^#\s*EDGE\s*:', text, re.MULTILINE | re.IGNORECASE))

    if not (has_nodo or has_node) and not has_edge:
        return None  # not structured format, fall through to Gemini/regex

    nodes = []
    edges = []

    # Parse node blocks
    node_pattern = re.compile(
        r'#\s*NOD[OE]\s*:\s*(.+?)\n(.*?)(?=^#|\Z)',
        re.MULTILINE | re.DOTALL | re.IGNORECASE
    )
    for m in node_pattern.finditer(text):
        label = m.group(1).strip()
        body  = m.group(2)
        if not label:
            continue

        # Extract fields
        tipo  = re.search(r'TIPO\s*:\s*(.+)', body, re.IGNORECASE)
        ntype = re.search(r'TYPE\s*:\s*(.+)', body, re.IGNORECASE)
        desc  = re.search(r'DESC\s*(?:RIZIONE)?\s*:\s*(.+)', body, re.IGNORECASE)
        desc2 = re.search(r'DESCRIPTION\s*:\s*(.+)', body, re.IGNORECASE)
        conf  = re.search(r'CONF(?:IDENZA|IDENCE)?\s*:\s*([\d.]+)', body, re.IGNORECASE)
        alias = re.search(r'ALIAS\s*:\s*(.+)', body, re.IGNORECASE)

        node_type = "concept"
        if tipo:
            node_type = tipo.group(1).strip().lower()
        elif ntype:
            node_type = ntype.group(1).strip().lower()

        description = ""
        if desc:
            description = desc.group(1).strip()
        elif desc2:
            description = desc2.group(1).strip()

        confidence = float(conf.group(1)) if conf else 1.0

        aliases = []
        if alias:
            aliases = [a.strip() for a in alias.group(1).split(",") if a.strip()]

        nodes.append({
            "label":       label,
            "type":        node_type,
            "description": description[:400],
            "confidence":  min(1.0, confidence),
            "aliases":     aliases,
        })

    # Parse edge blocks (both arrow and field format)
    # Format 1: # EDGE: NodeA -> NodeB
    edge_arrow = re.compile(
        r'#\s*EDGE\s*:\s*(.+?)\s*[-=]>\s*(.+?)\n(.*?)(?=^#|\Z)',
        re.MULTILINE | re.DOTALL | re.IGNORECASE
    )
    for m in edge_arrow.finditer(text):
        src   = m.group(1).strip()
        tgt   = m.group(2).strip()
        body  = m.group(3)

        rel   = re.search(r'RELAZ(?:IONE)?\s*:\s*(.+)', body, re.IGNORECASE)
        rel2  = re.search(r'RELATION(?:SHIP)?\s*:\s*(.+)', body, re.IGNORECASE)
        evid  = re.search(r'EVID(?:ENZA|ENCE)?\s*:\s*(.+)', body, re.IGNORECASE)
        peso  = re.search(r'PESO\s*:\s*([\d.]+)', body, re.IGNORECASE)
        weight_f = re.search(r'WEIGHT\s*:\s*([\d.]+)', body, re.IGNORECASE)

        relation = "related"
        if rel:
            relation = rel.group(1).strip().lower()
        elif rel2:
            relation = rel2.group(1).strip().lower()

        evidence = ""
        if evid:
            evidence = evid.group(1).strip()

        weight = 1.0
        if peso:
            weight = min(3.0, float(peso.group(1)))
        elif weight_f:
            weight = min(3.0, float(weight_f.group(1)))

        if src and tgt:
            edges.append({
                "src":      src,
                "tgt":      tgt,
                "relation": relation,
                "evidence": evidence[:300],
                "weight":   weight,
            })

    # Format 2: # EDGE: NodeA (no arrow, fields only)
    edge_noarrow = re.compile(
        r'#\s*EDGE\s*:\s*([^-\n>]+?)\n(.*?)(?=^#|\Z)',
        re.MULTILINE | re.DOTALL | re.IGNORECASE
    )
    for m in edge_noarrow.finditer(text):
        label = m.group(1).strip()
        body  = m.group(2)

        # Skip if already parsed as arrow
        if "->" in m.group(0) or "=>" in m.group(0):
            continue

        src_m = re.search(r'FROM\s*:\s*(.+)', body, re.IGNORECASE)
        tgt_m = re.search(r'TO\s*:\s*(.+)', body, re.IGNORECASE)
        rel_m = re.search(r'RELAZ(?:IONE)?\s*:\s*(.+)', body, re.IGNORECASE)
        evid  = re.search(r'EVID(?:ENZA|ENCE)?\s*:\s*(.+)', body, re.IGNORECASE)
        peso  = re.search(r'PESO\s*:\s*([\d.]+)', body, re.IGNORECASE)

        if src_m and tgt_m:
            edges.append({
                "src":      src_m.group(1).strip(),
                "tgt":      tgt_m.group(1).strip(),
                "relation": (rel_m.group(1).strip().lower() if rel_m else "related"),
                "evidence": (evid.group(1).strip() if evid else "")[:300],
                "weight":   min(3.0, float(peso.group(1))) if peso else 1.0,
            })

    if not nodes and not edges:
        return None

    return {"nodes": nodes, "edges": edges, "_source": "structured_format"}


def parse_pdf(content: bytes) -> List[str]:
    """Extract text from PDF using pypdf."""
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        chunks = []
        for page in reader.pages[:50]:  # cap at 50 pages
            text = page.extract_text() or ""
            if len(text.strip()) > 50:
                chunks.append(text[:1500])
        return chunks
    except ImportError:
        logger.warning("pypdf not installed — PDF parsing unavailable")
        return []
    except Exception as e:
        logger.warning("parse_pdf error: %s", e)
        return []


# ── Graph DB operations (Postgres + SQLite unified) ───────────────────────────

async def upsert_node(label: str, ntype: str, description: str = "",
                      confidence: float = 1.0, aliases: List[str] = None) -> Optional[int]:
    """Insert or update a node. Returns node id."""
    label = label.strip()[:200]
    if not label:
        return None

    pool = await get_pool()

    if pool:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO kg_nodes (label, type, description, confidence, aliases)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (label, type) DO UPDATE
                   SET source_count = kg_nodes.source_count + 1,
                       confidence   = GREATEST(kg_nodes.confidence, EXCLUDED.confidence),
                       description  = CASE WHEN kg_nodes.description='' THEN EXCLUDED.description ELSE kg_nodes.description END,
                       updated_at   = NOW()
                   RETURNING id""",
                label, ntype, description, confidence,
                aliases or []
            )
            return row["id"] if row else None
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            cur = await db.execute(
                """INSERT INTO kg_nodes (label, type, description, confidence, aliases)
                   VALUES (?,?,?,?,?)
                   ON CONFLICT(label,type) DO UPDATE
                   SET source_count = source_count + 1,
                       confidence   = MAX(confidence, excluded.confidence),
                       description  = CASE WHEN description='' THEN excluded.description ELSE description END,
                       updated_at   = datetime('now')""",
                (label, ntype, description, confidence, json.dumps(aliases or []))
            )
            if cur.lastrowid:
                await db.commit()
                return cur.lastrowid
            # Get existing id
            async with db.execute(
                "SELECT id FROM kg_nodes WHERE label=? AND type=?", (label, ntype)
            ) as c:
                row = await c.fetchone()
            await db.commit()
            return row[0] if row else None


async def upsert_edge(src_id: int, tgt_id: int, relation: str,
                      evidence: str = "", weight: float = 1.0) -> Optional[int]:
    """Insert or update an edge."""
    if src_id == tgt_id:
        return None

    pool = await get_pool()

    if pool:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO kg_edges (src_id, tgt_id, relation, evidence_text, weight)
                   VALUES ($1, $2, $3, $4, $5)
                   ON CONFLICT (src_id, tgt_id, relation) DO UPDATE
                   SET evidence_count = kg_edges.evidence_count + 1,
                       weight         = LEAST(5.0, kg_edges.weight + 0.1),
                       updated_at     = NOW()
                   RETURNING id""",
                src_id, tgt_id, relation, evidence[:500], weight
            )
            return row["id"] if row else None
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            cur = await db.execute(
                """INSERT INTO kg_edges (src_id, tgt_id, relation, evidence_text, weight)
                   VALUES (?,?,?,?,?)
                   ON CONFLICT(src_id,tgt_id,relation) DO UPDATE
                   SET evidence_count = evidence_count + 1,
                       weight         = MIN(5.0, weight + 0.1),
                       updated_at     = datetime('now')""",
                (src_id, tgt_id, relation, evidence[:500], weight)
            )
            await db.commit()
            return cur.lastrowid


# ── Ingestion pipeline ─────────────────────────────────────────────────────────

async def ingest_extraction_result(result: Dict, upload_id: int) -> Tuple[int, int]:
    """Write extracted nodes/edges to the shared graph. Returns (nodes_added, edges_added)."""
    nodes = result.get("nodes", [])
    edges = result.get("edges", [])

    node_map: Dict[str, int] = {}  # label_upper → db_id
    nodes_added = 0
    edges_added = 0

    # Upsert nodes
    for n in nodes:
        label = (n.get("label") or "").strip()
        if not label or len(label) < 2:
            continue
        ntype = n.get("type", "concept")
        if ntype not in NODE_TYPES:
            ntype = "concept"
        desc  = (n.get("description") or "")[:400]
        conf  = float(n.get("confidence", 1.0))
        nid   = await upsert_node(label, ntype, desc, conf)
        if nid:
            node_map[label.upper()] = nid
            nodes_added += 1

    # Upsert edges
    for e in edges:
        src_label = (e.get("src") or "").strip().upper()
        tgt_label = (e.get("tgt") or "").strip().upper()
        relation  = e.get("relation", "related")
        evidence  = e.get("evidence", "")[:500]

        if relation not in RELATION_TYPES:
            relation = "related"

        src_id = node_map.get(src_label)
        tgt_id = node_map.get(tgt_label)

        # Try partial match if exact not found
        if not src_id:
            for k, v in node_map.items():
                if src_label in k or k in src_label:
                    src_id = v; break
        if not tgt_id:
            for k, v in node_map.items():
                if tgt_label in k or k in tgt_label:
                    tgt_id = v; break

        if src_id and tgt_id:
            eid = await upsert_edge(src_id, tgt_id, relation, evidence)
            if eid:
                edges_added += 1

    # Update upload record (skip if upload_id is -1 = nightly system job)
    if upload_id and upload_id > 0:
        pool = await get_pool()
        if pool:
            async with pool.acquire() as conn:
                await conn.execute(
                    "UPDATE kg_uploads SET nodes_added=nodes_added+$1, edges_added=edges_added+$2 WHERE id=$3",
                    nodes_added, edges_added, upload_id
                )
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute(
                    "UPDATE kg_uploads SET nodes_added=nodes_added+?, edges_added=edges_added+? WHERE id=?",
                    (nodes_added, edges_added, upload_id)
                )
                await db.commit()

    return nodes_added, edges_added


async def process_upload_job(upload_id: int, chunks: List[str], user_id: int):
    """Background job: extract KG from all chunks and ingest."""
    total_nodes = 0
    total_edges = 0
    error = ""

    try:
        for i, chunk in enumerate(chunks):
            if len(chunk.strip()) < 30:
                continue
            logger.info("KG upload %s: chunk %d/%d", upload_id, i+1, len(chunks))
            try:
                result = await extract_knowledge(chunk, user_id)
                n, e = await ingest_extraction_result(result, upload_id)
                total_nodes += n
                total_edges += e
            except Exception as ce:
                logger.warning("chunk %d error: %s", i, ce)
                continue

        status = "done"
    except Exception as ex:
        error = str(ex)[:500]
        status = "error"

    # Mark upload complete using shared helper
    await _finish_upload_record(upload_id, status, total_nodes, total_edges, error)
    logger.info("KG upload %s done: +%d nodes +%d edges", upload_id, total_nodes, total_edges)


# ── HTTP endpoints ─────────────────────────────────────────────────────────────

@router.on_event("startup")
async def _startup():
    await ensure_kg_schema()


async def _create_upload_record(user_id: int, filename: str, source_type: str, status: str) -> int:
    """Create a kg_uploads record. Returns the new id."""
    pool = await get_pool()
    if pool:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO kg_uploads (user_id, filename, source_type, status) "
                "VALUES ($1,$2,$3,$4) RETURNING id",
                user_id, filename, source_type, status
            )
            return row["id"]
    else:
        async with aiosqlite.connect(settings.db_path) as db:
            cur = await db.execute(
                "INSERT INTO kg_uploads (user_id, filename, source_type, status) VALUES (?,?,?,?)",
                (user_id, filename, source_type, status)
            )
            await db.commit()
            return cur.lastrowid


async def _finish_upload_record(upload_id: int, status: str, nodes: int, edges: int, error: str = ""):
    """Mark upload done or errored."""
    pool = await get_pool()
    now = datetime.utcnow().isoformat()
    if pool:
        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE kg_uploads SET status=$1, nodes_added=$2, edges_added=$3, "
                "error_msg=$4, completed_at=NOW() WHERE id=$5",
                status, nodes, edges, error[:500], upload_id
            )
    else:
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                "UPDATE kg_uploads SET status=?, nodes_added=?, edges_added=?, "
                "error_msg=?, completed_at=? WHERE id=?",
                (status, nodes, edges, error[:500], now, upload_id)
            )
            await db.commit()


@router.post("/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    user=Depends(require_user),
):
    """
    Upload a file to extract knowledge into the shared graph.
    Supported: ChatGPT export (conversations.json), plain text (.txt), PDF (.pdf)
    """
    fname    = file.filename or "upload"
    content  = await file.read()
    ext      = fname.rsplit(".", 1)[-1].lower() if "." in fname else "txt"
    max_mb   = 10
    if len(content) > max_mb * 1024 * 1024:
        raise HTTPException(413, f"File too large — max {max_mb}MB")

    # ── Always ensure KG schema exists before any DB operation ──────────────
    await ensure_kg_schema()

    # ── Detect source type and parse ─────────────────────────────────────────
    chunks: list = []
    source_type = ext
    structured = None

    if ext == "json" or "conversations" in fname.lower():
        chunks = parse_chatgpt_json(content)
        source_type = "chatgpt_json"
    elif ext == "pdf":
        chunks = parse_pdf(content)
        source_type = "pdf"
    else:
        # Try structured format first (# NODO / # EDGE syntax — no AI needed)
        structured = parse_structured_format(content)
        if structured and (structured.get("nodes") or structured.get("edges")):
            source_type = "structured_format"
        else:
            # Fall back to free-text chunking for AI extraction
            structured = None
            chunks = parse_txt(content)
            source_type = "txt"

    # ── Structured format: direct ingest, synchronous, no background task ────
    if structured is not None:
        # Create upload record
        upload_id = await _create_upload_record(user["id"], fname, source_type, "processing")

        try:
            n_nodes, n_edges = await ingest_extraction_result(structured, upload_id)
            await _finish_upload_record(upload_id, "done", n_nodes, n_edges)
            return {
                "upload_id":   upload_id,
                "filename":    fname,
                "source_type": source_type,
                "chunks":      1,
                "status":      "done",
                "nodes_added": n_nodes,
                "edges_added": n_edges,
                "message":     f"Structured format parsed directly: +{n_nodes} nodes, +{n_edges} edges (no AI needed)",
            }
        except Exception as e:
            await _finish_upload_record(upload_id, "error", 0, 0, str(e))
            raise HTTPException(500, f"Ingest error: {e}")

    if not chunks:
        raise HTTPException(422, "No extractable text found in file")

    # Create upload record
    pool = await get_pool()
    upload_id = None
    if pool:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO kg_uploads (user_id, filename, source_type, status) "
                "VALUES ($1,$2,$3,'processing') RETURNING id",
                user["id"], fname, source_type
            )
            upload_id = row["id"]
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            cur = await db.execute(
                "INSERT INTO kg_uploads (user_id, filename, source_type, status) "
                "VALUES (?,?,'processing',?)",
                (user["id"], fname, source_type)
            )
            await db.commit()
            upload_id = cur.lastrowid

    # Process in background
    background_tasks.add_task(process_upload_job, upload_id, chunks, user["id"])

    return {
        "upload_id":   upload_id,
        "filename":    fname,
        "source_type": source_type,
        "chunks":      len(chunks),
        "status":      "processing",
        "message":     f"Processing {len(chunks)} text chunks — check /api/kg/uploads/{upload_id} for status",
    }


@router.get("/uploads/{upload_id}")
async def get_upload_status(upload_id: int, user=Depends(require_user)):
    """Poll upload job status."""
    pool = await get_pool()
    if pool:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM kg_uploads WHERE id=$1 AND user_id=$2", upload_id, user["id"]
            )
            return dict(row) if row else HTTPException(404, "Upload not found")
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM kg_uploads WHERE id=? AND user_id=?", (upload_id, user["id"])
            ) as c:
                row = await c.fetchone()
            if not row:
                raise HTTPException(404, "Upload not found")
            return dict(row)


@router.get("/uploads")
async def list_uploads(user=Depends(require_user)):
    """List all uploads for this user."""
    pool = await get_pool()
    if pool:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT * FROM kg_uploads WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20",
                user["id"]
            )
            return [dict(r) for r in rows]
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM kg_uploads WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
                (user["id"],)
            ) as c:
                return [dict(r) for r in await c.fetchall()]


@router.get("/nodes")
async def list_nodes(
    q: str = "",
    ntype: str = "",
    limit: int = 100,
    offset: int = 0,
    user=Depends(require_user),
):
    """List/search nodes in the shared graph."""
    pool = await get_pool()

    if pool:
        async with pool.acquire() as conn:
            if q:
                rows = await conn.fetch(
                    """SELECT n.*, un.weight as user_weight, un.bookmarked as user_bookmarked
                       FROM kg_nodes n
                       LEFT JOIN kg_user_nodes un ON un.node_id=n.id AND un.user_id=$4
                       WHERE to_tsvector('english', n.label || ' ' || n.description) @@ plainto_tsquery('english', $1)
                       AND ($2='' OR n.type=$2)
                       ORDER BY n.source_count DESC, n.confidence DESC
                       LIMIT $3 OFFSET 0""",
                    q, ntype, limit, user["id"]
                )
            else:
                rows = await conn.fetch(
                    """SELECT n.*, un.weight as user_weight, un.bookmarked as user_bookmarked
                       FROM kg_nodes n
                       LEFT JOIN kg_user_nodes un ON un.node_id=n.id AND un.user_id=$3
                       WHERE ($1='' OR n.type=$1)
                       ORDER BY n.source_count DESC, n.confidence DESC
                       LIMIT $2 OFFSET 0""",
                    ntype, limit, user["id"]
                )
            return [dict(r) for r in rows]
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            if q:
                sql = "SELECT n.*, un.weight as user_weight, un.bookmarked as user_bookmarked FROM kg_nodes n LEFT JOIN kg_user_nodes un ON un.node_id=n.id AND un.user_id=? WHERE n.label LIKE ?" + (" AND n.type=?" if ntype else "") + " ORDER BY n.source_count DESC LIMIT ?"
                params = [user["id"], f"%{q}%"] + ([ntype] if ntype else []) + [limit]
            else:
                sql = "SELECT n.*, un.weight as user_weight, un.bookmarked as user_bookmarked FROM kg_nodes n LEFT JOIN kg_user_nodes un ON un.node_id=n.id AND un.user_id=?" + (" WHERE n.type=?" if ntype else "") + " ORDER BY n.source_count DESC LIMIT ?"
                params = [user["id"]] + ([ntype] if ntype else []) + [limit]
            async with db.execute(sql, params) as c:
                return [dict(r) for r in await c.fetchall()]


@router.get("/nodes/{node_id}/neighbors")
async def get_neighbors(node_id: int, depth: int = 1, user=Depends(require_user)):
    """Get a node and its neighbors up to N hops."""
    depth = min(depth, 2)  # cap at 2 for performance
    pool = await get_pool()

    if pool:
        async with pool.acquire() as conn:
            # Get the node
            node = await conn.fetchrow("SELECT * FROM kg_nodes WHERE id=$1", node_id)
            if not node:
                raise HTTPException(404, "Node not found")

            # Get direct edges
            edges = await conn.fetch(
                """SELECT e.*, n1.label as src_label, n1.type as src_type,
                          n2.label as tgt_label, n2.type as tgt_type
                   FROM kg_edges e
                   JOIN kg_nodes n1 ON e.src_id=n1.id
                   JOIN kg_nodes n2 ON e.tgt_id=n2.id
                   WHERE e.src_id=$1 OR e.tgt_id=$1
                   ORDER BY e.weight DESC LIMIT 50""",
                node_id
            )
            neighbor_ids = set()
            for e in edges:
                neighbor_ids.add(e["src_id"])
                neighbor_ids.add(e["tgt_id"])
            neighbor_ids.discard(node_id)

            neighbors = []
            if neighbor_ids:
                neighbors = await conn.fetch(
                    f"SELECT * FROM kg_nodes WHERE id = ANY($1::bigint[])",
                    list(neighbor_ids)
                )
            return {
                "node":      dict(node),
                "edges":     [dict(e) for e in edges],
                "neighbors": [dict(n) for n in neighbors],
            }
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT * FROM kg_nodes WHERE id=?", (node_id,)) as c:
                node = await c.fetchone()
            if not node:
                raise HTTPException(404, "Node not found")
            async with db.execute(
                """SELECT e.*, n1.label as src_label, n1.type as src_type,
                          n2.label as tgt_label, n2.type as tgt_type
                   FROM kg_edges e
                   JOIN kg_nodes n1 ON e.src_id=n1.id
                   JOIN kg_nodes n2 ON e.tgt_id=n2.id
                   WHERE e.src_id=? OR e.tgt_id=?
                   ORDER BY e.weight DESC LIMIT 50""",
                (node_id, node_id)
            ) as c:
                edges = [dict(r) for r in await c.fetchall()]

            neighbor_ids = set()
            for e in edges:
                neighbor_ids.add(e["src_id"])
                neighbor_ids.add(e["tgt_id"])
            neighbor_ids.discard(node_id)
            neighbors = []
            if neighbor_ids:
                ph = ",".join("?" * len(neighbor_ids))
                async with db.execute(f"SELECT * FROM kg_nodes WHERE id IN ({ph})", list(neighbor_ids)) as c:
                    neighbors = [dict(r) for r in await c.fetchall()]
            return {"node": dict(node), "edges": edges, "neighbors": neighbors}


@router.get("/graph")
async def get_full_graph(limit: int = 200, user=Depends(require_user)):
    """Get nodes + edges for visualization. Returns top N by source_count."""
    pool = await get_pool()

    if pool:
        async with pool.acquire() as conn:
            nodes = await conn.fetch(
                """SELECT n.*, COALESCE(un.weight,1) as user_weight,
                          COALESCE(un.bookmarked,false) as user_bookmarked
                   FROM kg_nodes n
                   LEFT JOIN kg_user_nodes un ON un.node_id=n.id AND un.user_id=$2
                   ORDER BY n.source_count DESC, n.confidence DESC
                   LIMIT $1""",
                limit, user["id"]
            )
            node_ids = [r["id"] for r in nodes]
            edges = []
            if node_ids:
                edges = await conn.fetch(
                    "SELECT * FROM kg_edges WHERE src_id = ANY($1::bigint[]) AND tgt_id = ANY($1::bigint[]) ORDER BY weight DESC LIMIT 500",
                    node_ids
                )
            stats = await conn.fetchrow("SELECT COUNT(*) as nodes FROM kg_nodes")
            estat = await conn.fetchrow("SELECT COUNT(*) as edges FROM kg_edges")
            return {
                "nodes": [dict(n) for n in nodes],
                "edges": [dict(e) for e in edges],
                "total_nodes": stats["nodes"],
                "total_edges": estat["edges"],
            }
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT n.*, COALESCE(un.weight,1) as user_weight,
                          COALESCE(un.bookmarked,0) as user_bookmarked
                   FROM kg_nodes n
                   LEFT JOIN kg_user_nodes un ON un.node_id=n.id AND un.user_id=?
                   ORDER BY n.source_count DESC LIMIT ?""",
                (user["id"], limit)
            ) as c:
                nodes = [dict(r) for r in await c.fetchall()]
            node_ids = [n["id"] for n in nodes]
            edges = []
            if node_ids:
                ph = ",".join("?" * len(node_ids))
                async with db.execute(
                    f"SELECT * FROM kg_edges WHERE src_id IN ({ph}) AND tgt_id IN ({ph}) ORDER BY weight DESC LIMIT 500",
                    node_ids + node_ids
                ) as c:
                    edges = [dict(r) for r in await c.fetchall()]
            async with db.execute("SELECT COUNT(*) as n FROM kg_nodes") as c:
                tn = (await c.fetchone())["n"]
            async with db.execute("SELECT COUNT(*) as n FROM kg_edges") as c:
                te = (await c.fetchone())["n"]
            return {"nodes": nodes, "edges": edges, "total_nodes": tn, "total_edges": te}


@router.post("/nodes/{node_id}/bookmark")
async def toggle_bookmark(node_id: int, user=Depends(require_user)):
    """Toggle user bookmark on a node."""
    pool = await get_pool()
    if pool:
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO kg_user_nodes (user_id, node_id, bookmarked)
                   VALUES ($1,$2,true)
                   ON CONFLICT(user_id,node_id) DO UPDATE
                   SET bookmarked = NOT kg_user_nodes.bookmarked""",
                user["id"], node_id
            )
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                """INSERT INTO kg_user_nodes (user_id, node_id, bookmarked)
                   VALUES (?,?,1)
                   ON CONFLICT(user_id,node_id) DO UPDATE
                   SET bookmarked = NOT bookmarked""",
                (user["id"], node_id)
            )
            await db.commit()
    return {"ok": True}


@router.get("/stats")
async def kg_stats(user=Depends(require_user)):
    """Graph statistics."""
    pool = await get_pool()
    if pool:
        async with pool.acquire() as conn:
            nodes   = await conn.fetchval("SELECT COUNT(*) FROM kg_nodes")
            edges   = await conn.fetchval("SELECT COUNT(*) FROM kg_edges")
            by_type = await conn.fetch("SELECT type, COUNT(*) as n FROM kg_nodes GROUP BY type ORDER BY n DESC")
            by_rel  = await conn.fetch("SELECT relation, COUNT(*) as n FROM kg_edges GROUP BY relation ORDER BY n DESC")
            top_nodes = await conn.fetch("SELECT id, label, type, source_count FROM kg_nodes ORDER BY source_count DESC LIMIT 10")
            uploads = await conn.fetchval("SELECT COUNT(*) FROM kg_uploads WHERE user_id=$1", user["id"])
        return {
            "total_nodes": nodes, "total_edges": edges,
            "by_type":  [dict(r) for r in by_type],
            "by_relation": [dict(r) for r in by_rel],
            "top_nodes": [dict(r) for r in top_nodes],
            "user_uploads": uploads,
            "backend": "postgresql",
        }
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute("SELECT COUNT(*) as n FROM kg_nodes") as c: nodes = (await c.fetchone())["n"]
            async with db.execute("SELECT COUNT(*) as n FROM kg_edges") as c: edges = (await c.fetchone())["n"]
            async with db.execute("SELECT type, COUNT(*) as n FROM kg_nodes GROUP BY type ORDER BY n DESC") as c: by_type = [dict(r) for r in await c.fetchall()]
            async with db.execute("SELECT relation, COUNT(*) as n FROM kg_edges GROUP BY relation ORDER BY n DESC") as c: by_rel = [dict(r) for r in await c.fetchall()]
            async with db.execute("SELECT id, label, type, source_count FROM kg_nodes ORDER BY source_count DESC LIMIT 10") as c: top_nodes = [dict(r) for r in await c.fetchall()]
            async with db.execute("SELECT COUNT(*) as n FROM kg_uploads WHERE user_id=?", (user["id"],)) as c: uploads = (await c.fetchone())["n"]
        return {"total_nodes": nodes, "total_edges": edges, "by_type": by_type, "by_relation": by_rel, "top_nodes": top_nodes, "user_uploads": uploads, "backend": "sqlite_fallback"}


@router.post("/ingest-text")
async def ingest_text(
    background_tasks: BackgroundTasks,
    payload: dict = Body(...),
    user=Depends(require_user),
):
    """Ingest raw text directly (no file upload)."""
    text = (payload.get("text") or "").strip()
    if len(text) < 30:
        raise HTTPException(400, "text too short (min 30 chars)")
    if len(text) > 50000:
        raise HTTPException(400, "text too long (max 50k chars)")

    chunks = parse_txt(text.encode())
    if not chunks:
        chunks = [text[:1500]]

    # Create upload record
    pool = await get_pool()
    upload_id = None
    if pool:
        async with pool.acquire() as conn:
            row = await conn.fetchrow(
                "INSERT INTO kg_uploads (user_id, filename, source_type, status) VALUES ($1,'inline_text','text','processing') RETURNING id",
                user["id"]
            )
            upload_id = row["id"]
    else:
        import aiosqlite
        async with aiosqlite.connect(settings.db_path) as db:
            cur = await db.execute(
                "INSERT INTO kg_uploads (user_id, filename, source_type, status) VALUES (?,'inline_text','text','processing')",
                (user["id"],)
            )
            await db.commit()
            upload_id = cur.lastrowid

    background_tasks.add_task(process_upload_job, upload_id, chunks, user["id"])
    return {"upload_id": upload_id, "chunks": len(chunks), "status": "processing"}


# ── Auto-pop stats endpoint ───────────────────────────────────────────────────

@router.get("/auto-pop-stats")
async def get_auto_pop_stats_endpoint(_=Depends(require_admin)):
    """Admin: auto-population pipeline statistics."""
    from brain_autopop import get_auto_pop_stats
    return await get_auto_pop_stats()


@router.post("/trigger-autopop")
async def trigger_manual_autopop(
    background_tasks: BackgroundTasks,
    user=Depends(require_user),
):
    """Trigger autonomous brain population (L1+L2+L3 fast pass). Available to all users."""
    async def run():
        try:
            from brain_autopop import autonomous_brain_population
            await autonomous_brain_population()
        except Exception as e:
            logger.warning("manual autopop: %s", e)

    background_tasks.add_task(run)
    return {"ok": True, "message": "Autopop triggered — nodes will appear within 30s"}


@router.post("/trigger-deep-autopop")
async def trigger_deep_autopop(
    background_tasks: BackgroundTasks,
    _=Depends(require_admin),
):
    """Admin: trigger full nightly deep extraction (Gemini + Wikipedia)."""
    async def run():
        from brain_autopop import nightly_deep_extraction
        await nightly_deep_extraction()

    background_tasks.add_task(run)
    return {"ok": True, "message": "Deep extraction triggered in background"}


# ── Template download ─────────────────────────────────────────────────────────

@router.get("/template")
async def download_template():
    """Download the WorldLens structured knowledge format template."""
    from fastapi.responses import PlainTextResponse
    template = """# WorldLens Knowledge Graph — Structured Format
# ─────────────────────────────────────────────────────────────────
# Carica questo file in Brain Editor → tab Upload per creare nodi
# ed edge direttamente senza AI (parsing immediato, zero quota).
#
# TIPI NODO: concept, entity, etf, indicator, event, policy, person, commodity
# TIPI RELAZIONE: influences, correlates_with, causes, part_of,
#   happened_before, contradicts, tracks, issued_by, invests_in,
#   regulated_by, related
# PESO: 0.1 – 3.0 (default 1.0, admin inject = 2.0)
# ─────────────────────────────────────────────────────────────────

# NODO: Federal Reserve
TIPO: entity
DESC: Banca centrale degli Stati Uniti, controlla la politica monetaria USA
ALIAS: Fed, FED, US Federal Reserve, FOMC

# NODO: Interest Rate
TIPO: indicator
DESC: Tasso di interesse sui fed funds, strumento principale della politica monetaria

# NODO: Inflation
TIPO: indicator
DESC: Tasso di variazione dei prezzi al consumo (CPI, PCE)
ALIAS: CPI, inflazione, tasso inflazione

# NODO: Bond Markets
TIPO: concept
DESC: Mercati obbligazionari globali, reagiscono ai tassi e all inflazione

# NODO: Equity Markets
TIPO: concept
DESC: Mercati azionari globali, correlano con crescita economica e sentiment

# NODO: VWCE
TIPO: etf
DESC: Vanguard FTSE All-World — ETF azionario globale, replica FTSE All-World
ALIAS: Vanguard All World

# NODO: Oil Price
TIPO: commodity
DESC: Prezzo del petrolio greggio (Brent, WTI), driver principale dell inflazione energetica
ALIAS: Brent, WTI, crude oil

# ─── EDGE (formato freccia) ───────────────────────────────────────

# EDGE: Federal Reserve -> Interest Rate
RELAZIONE: influences
EVIDENZA: La Fed alza o abbassa i tassi attraverso le decisioni del FOMC
PESO: 2.0

# EDGE: Interest Rate -> Inflation
RELAZIONE: causes
EVIDENZA: Tassi alti aumentano il costo del credito, frenano consumi e inflazione
PESO: 1.8

# EDGE: Inflation -> Bond Markets
RELAZIONE: influences
EVIDENZA: L inflazione erode il rendimento reale delle obbligazioni
PESO: 1.5

# EDGE: Federal Reserve -> Bond Markets
RELAZIONE: influences
EVIDENZA: QE e QT della Fed acquistano/vendono Treasury, muovendo i prezzi
PESO: 1.8

# EDGE: Interest Rate -> Equity Markets
RELAZIONE: influences
EVIDENZA: Tassi alti aumentano il costo del capitale e il discount rate dei DCF
PESO: 1.6

# EDGE: Oil Price -> Inflation
RELAZIONE: causes
EVIDENZA: Il prezzo dell energia è componente diretta del CPI
PESO: 1.4

# EDGE: VWCE -> Equity Markets
RELAZIONE: tracks
EVIDENZA: VWCE replica il FTSE All-World, esposizione a 3800+ titoli globali
PESO: 2.0

# ─────────────────────────────────────────────────────────────────
# PUOI AGGIUNGERE I TUOI NODI ED EDGE SOTTO QUESTO COMMENTO
# Salva come .txt e carica in Brain Editor → Upload
# ─────────────────────────────────────────────────────────────────
"""
    return PlainTextResponse(
        content=template,
        headers={"Content-Disposition": "attachment; filename=worldlens_kg_template.txt"}
    )


@router.post("/mega-seed")
async def mega_seed_endpoint(
    background_tasks: BackgroundTasks,
    user=Depends(require_user),
):
    """Trigger KG mega-seed: 500+ financial/geopolitical nodes and relationships."""
    async def run():
        from kg_mega_seed import run_mega_seed
        await run_mega_seed()

    background_tasks.add_task(run)
    return {"ok": True, "message": "Mega-seed started — 500+ nodes being added in background"}
    """Quick KG connectivity check — used by Brain Editor status bar."""
    pool = await get_pool()
    try:
        if pool:
            async with pool.acquire() as conn:
                n = await conn.fetchval("SELECT COUNT(*) FROM kg_nodes")
                e = await conn.fetchval("SELECT COUNT(*) FROM kg_edges")
            return {"ok": True, "backend": "postgresql", "nodes": n, "edges": e}
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute("SELECT COUNT(*) as n FROM kg_nodes") as c:
                    n = (await c.fetchone())["n"]
                async with db.execute("SELECT COUNT(*) as n FROM kg_edges") as c:
                    e = (await c.fetchone())["n"]
            return {"ok": True, "backend": "sqlite", "nodes": n, "edges": e}
    except Exception as ex:
        return {"ok": False, "backend": "error", "detail": str(ex), "nodes": 0, "edges": 0}
