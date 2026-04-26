"""
WorldLens Brain Enhancement — 4 Layers
----------------------------------------
Layer 1 (existing): FTS5 RAG search
Layer 2 (new): Topic summary cache — pre-generated summaries per topic cluster
Layer 3 (new): KG explanation engine — NL explanations for edges
Layer 4 (new): Proactive digest — topic digests, connection alerts, drift detection

All layers feed into Brain Agent context and Dashboard card.
"""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple

import aiosqlite
from config import settings

logger = logging.getLogger(__name__)

# ── Schema ────────────────────────────────────────────────────────────────────

ENHANCE_SCHEMA = """
-- Layer 2: topic summary cache
CREATE TABLE IF NOT EXISTS brain_summaries (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    topic       TEXT NOT NULL,
    summary     TEXT NOT NULL,
    entry_count INTEGER DEFAULT 0,
    generated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, topic),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Layer 3: KG edge explanations
CREATE TABLE IF NOT EXISTS kg_edge_explanations (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    edge_sig    TEXT NOT NULL UNIQUE,  -- "src_label|relation|tgt_label"
    explanation TEXT NOT NULL,
    generated_at TEXT DEFAULT (datetime('now'))
);

-- Layer 4: proactive digest items
CREATE TABLE IF NOT EXISTS brain_digest_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    digest_type TEXT NOT NULL,   -- topic_digest | connection_alert | drift_alert
    title       TEXT NOT NULL,
    body        TEXT NOT NULL,
    topic       TEXT DEFAULT '',
    severity    REAL DEFAULT 1.0,
    read        INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_bsum_user  ON brain_summaries(user_id);
CREATE INDEX IF NOT EXISTS idx_bdig_user  ON brain_digest_items(user_id, read);
CREATE INDEX IF NOT EXISTS idx_bdig_type  ON brain_digest_items(digest_type);
"""


async def ensure_enhance_tables(db: aiosqlite.Connection):
    for stmt in ENHANCE_SCHEMA.split(";"):
        s = stmt.strip()
        if s:
            try:
                await db.execute(s)
            except Exception as e:
                logger.debug("enhance schema: %s — %s", s[:60], e)
    await db.commit()


# ── Layer 2: Topic Summary Cache ──────────────────────────────────────────────

TOPIC_SYSTEM = """You are a financial intelligence analyst.
Write a concise summary of what the user knows about this topic based on their brain entries.
Format: 3-5 sentences, factual, present tense. Focus on the most important patterns and relationships.
End with one "Key signal:" sentence."""


async def generate_topic_summary(
    user_id: int,
    topic: str,
    entries: List[Dict],
    ug: str = "",
    ua: str = "",
) -> Optional[str]:
    """Generate a summary for a topic cluster from brain entries."""
    if not entries:
        return None

    from ai_layer import _call_claude
    content = "\n".join([
        f"- [{e.get('source','?')}] {e.get('content','')[:200]}"
        for e in entries[:15]
    ])
    prompt = f"Topic: {topic}\n\nBrain entries:\n{content}\n\nWrite the topic summary."
    try:
        return await _call_claude(
            prompt, system=TOPIC_SYSTEM, max_tokens=250,
            user_gemini_key=ug, user_anthropic_key=ua,
        )
    except Exception as e:
        logger.warning("generate_topic_summary %s: %s", topic, e)
        return None


async def refresh_topic_summaries(user_id: int):
    """
    Layer 2 — Check all topics in user's brain.
    Regenerate summary if entry count grew by 10+ since last generation.
    """
    from ai_layer import _get_user_ai_keys
    ug, ua = await _get_user_ai_keys(user_id)
    if not ug and not ua:
        return  # no AI available

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_enhance_tables(db)

        # Get entry counts per topic for this user
        async with db.execute(
            "SELECT topic, COUNT(*) as cnt FROM brain_entries WHERE user_id=? GROUP BY topic",
            (user_id,)
        ) as c:
            topic_counts = {r["topic"]: r["cnt"] for r in await c.fetchall()}

        # Get existing summaries
        async with db.execute(
            "SELECT topic, entry_count FROM brain_summaries WHERE user_id=?", (user_id,)
        ) as c:
            existing = {r["topic"]: r["entry_count"] for r in await c.fetchall()}

        # Determine which topics need refresh (new or grown by 10+)
        to_refresh = []
        for topic, count in topic_counts.items():
            prev = existing.get(topic, 0)
            if count >= 5 and (count - prev) >= 10 or (prev == 0 and count >= 5):
                to_refresh.append((topic, count))

    if not to_refresh:
        return

    logger.info("Brain Layer2: refreshing %d topic summaries for user %d", len(to_refresh), user_id)

    for topic, count in to_refresh[:5]:  # cap per cycle
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            # Fetch top entries for this topic
            async with db.execute(
                "SELECT content, source, weight, timestamp FROM brain_entries "
                "WHERE user_id=? AND topic=? ORDER BY weight DESC, timestamp DESC LIMIT 20",
                (user_id, topic)
            ) as c:
                entries = [dict(r) for r in await c.fetchall()]

        summary = await generate_topic_summary(user_id, topic, entries, ug, ua)
        if not summary:
            continue

        async with aiosqlite.connect(settings.db_path) as db:
            await ensure_enhance_tables(db)
            await db.execute(
                "INSERT INTO brain_summaries (user_id, topic, summary, entry_count) "
                "VALUES (?,?,?,?) ON CONFLICT(user_id,topic) DO UPDATE SET "
                "summary=excluded.summary, entry_count=excluded.entry_count, "
                "generated_at=datetime('now')",
                (user_id, topic, summary, count)
            )
            await db.commit()
        logger.debug("Layer2: summary refreshed for user=%d topic=%s (%d entries)", user_id, topic, count)
        await asyncio.sleep(0.5)  # rate limit


async def get_topic_summaries(user_id: int) -> Dict[str, str]:
    """Return cached topic summaries for a user."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_enhance_tables(db)
        async with db.execute(
            "SELECT topic, summary, entry_count, generated_at FROM brain_summaries "
            "WHERE user_id=? ORDER BY entry_count DESC",
            (user_id,)
        ) as c:
            rows = await c.fetchall()
    return {r["topic"]: {"summary": r["summary"], "count": r["entry_count"], "ts": r["generated_at"]} for r in rows}


async def get_best_summary_for_query(user_id: int, query: str) -> Optional[str]:
    """Find the most relevant cached summary for a query topic."""
    summaries = await get_topic_summaries(user_id)
    if not summaries:
        return None
    query_lower = query.lower()
    # Match query words against topic names
    best_topic = None
    best_score = 0
    for topic in summaries:
        score = sum(1 for w in query_lower.split() if w in topic.lower() or topic.lower() in w)
        if score > best_score:
            best_score = score
            best_topic = topic
    if best_topic and best_score > 0:
        s = summaries[best_topic]
        return f"[BRAIN SUMMARY — {best_topic.upper()} — {s['count']} entries]\n{s['summary']}"
    return None


# ── Layer 3: KG Edge Explanation Engine ──────────────────────────────────────

EDGE_EXPLAIN_SYSTEM = """You are a financial education expert.
Explain this knowledge graph relationship in 2-3 sentences of clear, accessible language.
Include: why this relationship exists, how it works mechanically, and what it means for investors.
Be specific and factual. Do NOT use bullet points."""


async def explain_edge(
    src_label: str,
    relation: str,
    tgt_label: str,
    evidence: str = "",
    ug: str = "",
    ua: str = "",
) -> Optional[str]:
    """Generate a natural language explanation for a KG edge."""
    from ai_layer import _call_claude

    edge_sig = f"{src_label}|{relation}|{tgt_label}"

    # Check cache first
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_enhance_tables(db)
        async with db.execute(
            "SELECT explanation FROM kg_edge_explanations WHERE edge_sig=?", (edge_sig,)
        ) as c:
            row = await c.fetchone()
        if row:
            return row["explanation"]

    # Generate
    rel_human = {
        "influences":      "influences",
        "causes":          "directly causes",
        "correlates_with": "statistically correlates with",
        "part_of":         "is a component of",
        "tracks":          "tracks / replicates",
        "invests_in":      "invests in",
        "contradicts":     "moves opposite to",
        "happened_before": "historically precedes",
        "regulated_by":    "is regulated by",
        "related":         "is related to",
    }.get(relation, relation.replace("_", " "))

    prompt = (
        f"Explain this financial relationship:\n"
        f"'{src_label}' {rel_human} '{tgt_label}'\n"
        f"Evidence from sources: {evidence[:300] if evidence else 'none provided'}\n\n"
        f"Write the explanation in Italian."
    )

    try:
        explanation = await _call_claude(
            prompt, system=EDGE_EXPLAIN_SYSTEM, max_tokens=150,
            user_gemini_key=ug, user_anthropic_key=ua,
        )
        if not explanation:
            return None

        # Cache it
        async with aiosqlite.connect(settings.db_path) as db:
            await ensure_enhance_tables(db)
            await db.execute(
                "INSERT OR REPLACE INTO kg_edge_explanations (edge_sig, explanation) VALUES (?,?)",
                (edge_sig, explanation)
            )
            await db.commit()
        return explanation
    except Exception as e:
        logger.warning("explain_edge %s: %s", edge_sig, e)
        return None


async def enrich_kg_edges_batch(limit: int = 10):
    """
    Layer 3 — Find high-weight edges without explanations and generate them.
    Called from nightly cron and on-demand.
    """
    from supabase_client import get_pool
    from ai_layer import _resolve_provider

    provider, ai_key = _resolve_provider()
    if not ai_key:
        return 0

    ug = ai_key if provider == "gemini" else ""
    ua = ai_key if provider == "claude" else ""

    pool = await get_pool()
    edges_to_explain = []

    try:
        if pool:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT e.id, n1.label as src, e.relation, n2.label as tgt,
                              e.evidence_text, e.weight
                       FROM kg_edges e
                       JOIN kg_nodes n1 ON e.src_id=n1.id
                       JOIN kg_nodes n2 ON e.tgt_id=n2.id
                       WHERE e.weight >= 1.2
                       ORDER BY e.weight DESC, e.evidence_count DESC
                       LIMIT $1""",
                    limit * 3  # fetch more to filter already-explained ones
                )
                edges_to_explain = [dict(r) for r in rows]
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    """SELECT e.id, n1.label as src, e.relation, n2.label as tgt,
                              e.evidence_text, e.weight
                       FROM kg_edges e
                       JOIN kg_nodes n1 ON e.src_id=n1.id
                       JOIN kg_nodes n2 ON e.tgt_id=n2.id
                       WHERE e.weight >= 1.2
                       ORDER BY e.weight DESC
                       LIMIT ?""",
                    (limit * 3,)
                ) as c:
                    edges_to_explain = [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.warning("enrich_kg_edges_batch query: %s", e)
        return 0

    # Filter to ones not yet explained
    explained = 0
    for edge in edges_to_explain:
        sig = f"{edge['src']}|{edge['relation']}|{edge['tgt']}"
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            await ensure_enhance_tables(db)
            async with db.execute(
                "SELECT id FROM kg_edge_explanations WHERE edge_sig=?", (sig,)
            ) as c:
                if await c.fetchone():
                    continue

        result = await explain_edge(
            edge["src"], edge["relation"], edge["tgt"],
            edge.get("evidence_text", ""), ug, ua
        )
        if result:
            explained += 1
            logger.debug("Layer3: explained edge %s", sig)
        await asyncio.sleep(0.4)

        if explained >= limit:
            break

    if explained > 0:
        logger.info("Brain Layer3: explained %d KG edges", explained)
    return explained


async def get_edge_explanations_for_node(node_label: str) -> List[Dict]:
    """Get all cached explanations for edges connected to a node."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_enhance_tables(db)
        async with db.execute(
            "SELECT edge_sig, explanation FROM kg_edge_explanations "
            "WHERE edge_sig LIKE ? OR edge_sig LIKE ?",
            (f"{node_label}|%", f"%|{node_label}")
        ) as c:
            return [dict(r) for r in await c.fetchall()]


# ── Layer 4: Proactive Digest ─────────────────────────────────────────────────

DIGEST_SYSTEM = """You are a financial intelligence analyst writing a concise topic digest.
Write 2-3 sentences summarizing the key developments and their investment implications.
Be specific and actionable. Write in Italian."""

DRIFT_SYSTEM = """You are a financial market analyst detecting sentiment shifts.
Write 2 sentences explaining the sentiment change and what it means for investors.
Be specific about the cause and the affected assets. Write in Italian."""


async def generate_topic_digest(
    user_id: int,
    topic: str,
    new_entries: List[Dict],
    ug: str = "",
    ua: str = "",
) -> Optional[str]:
    """Layer 4 — Generate a topic digest when a topic has significant new activity."""
    from ai_layer import _call_claude

    content = "\n".join([
        f"- {e.get('content','')[:200]}"
        for e in new_entries[:8]
    ])
    prompt = f"Topic: {topic}\n\nRecent developments:\n{content}\n\nWrite the digest."
    try:
        return await _call_claude(
            prompt, system=DIGEST_SYSTEM, max_tokens=180,
            user_gemini_key=ug, user_anthropic_key=ua,
        )
    except Exception as e:
        logger.warning("generate_topic_digest %s: %s", topic, e)
        return None


async def detect_sentiment_drift(
    user_id: int,
    topic: str,
    recent_entries: List[Dict],
    older_entries: List[Dict],
    ug: str = "",
    ua: str = "",
) -> Optional[Tuple[str, float]]:
    """
    Layer 4 — Detect if sentiment on a topic has drifted significantly.
    Returns (explanation, drift_score) or None.
    """
    if len(recent_entries) < 3 or len(older_entries) < 3:
        return None

    from ai_layer import _call_claude

    recent_text = "\n".join([e.get("content", "")[:100] for e in recent_entries[:5]])
    older_text  = "\n".join([e.get("content", "")[:100] for e in older_entries[:5]])

    prompt = (
        f"Topic: {topic}\n\n"
        f"OLDER entries (2-7 days ago):\n{older_text}\n\n"
        f"RECENT entries (last 24h):\n{recent_text}\n\n"
        f"Has the sentiment/outlook changed significantly? "
        f"If yes, explain the shift and score it 0-1 (0=no change, 1=complete reversal). "
        f"Reply as JSON: {{\"changed\": true/false, \"score\": 0.0-1.0, \"explanation\": \"...\"}}"
    )
    try:
        raw = await _call_claude(
            prompt, system=DRIFT_SYSTEM, max_tokens=120,
            user_gemini_key=ug, user_anthropic_key=ua,
        )
        if not raw:
            return None
        import re
        m = re.search(r'\{.*\}', raw, re.DOTALL)
        if not m:
            return None
        data = json.loads(m.group(0))
        if data.get("changed") and float(data.get("score", 0)) > 0.3:
            return data.get("explanation", ""), float(data["score"])
        return None
    except Exception as e:
        logger.debug("detect_sentiment_drift: %s", e)
        return None


async def check_new_kg_connections(user_id: int) -> List[Dict]:
    """
    Layer 4 — Find new edges in KG that connect topics the user follows.
    Returns list of {src, tgt, relation, explanation} items.
    """
    from supabase_client import get_pool

    pool = await get_pool()
    new_connections = []
    cutoff = (datetime.utcnow() - timedelta(hours=24)).isoformat()

    try:
        if pool:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    """SELECT n1.label as src, e.relation, n2.label as tgt,
                              e.evidence_text, e.weight
                       FROM kg_edges e
                       JOIN kg_nodes n1 ON e.src_id=n1.id
                       JOIN kg_nodes n2 ON e.tgt_id=n2.id
                       WHERE e.created_at > $1 AND e.weight >= 1.0
                       ORDER BY e.weight DESC LIMIT 10""",
                    cutoff
                )
                new_connections = [dict(r) for r in rows]
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    """SELECT n1.label as src, e.relation, n2.label as tgt,
                              e.evidence_text, e.weight
                       FROM kg_edges e
                       JOIN kg_nodes n1 ON e.src_id=n1.id
                       JOIN kg_nodes n2 ON e.tgt_id=n2.id
                       WHERE datetime(e.created_at) > datetime(?)
                       AND e.weight >= 1.0
                       ORDER BY e.weight DESC LIMIT 10""",
                    (cutoff,)
                ) as c:
                    new_connections = [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.warning("check_new_kg_connections: %s", e)

    return new_connections


async def run_proactive_digest(user_id: int):
    """
    Layer 4 — Main digest runner. Called by scheduler periodically.
    Generates digest items for dashboard card.
    """
    from ai_layer import _get_user_ai_keys
    ug, ua = await _get_user_ai_keys(user_id)
    if not ug and not ua:
        # Use admin key as fallback
        from ai_layer import _resolve_provider
        provider, key = _resolve_provider()
        if provider == "gemini":
            ug = key
        else:
            ua = key

    if not ug and not ua:
        return  # no AI available

    today = date.today().isoformat()
    digest_items = []

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_enhance_tables(db)

        # Check if we already generated today's digest for this user
        async with db.execute(
            "SELECT COUNT(*) as n FROM brain_digest_items "
            "WHERE user_id=? AND date(created_at)=? AND digest_type='topic_digest'",
            (user_id, today)
        ) as c:
            count = (await c.fetchone())["n"]

    if count >= 3:
        return  # already generated today

    # 1. Find top active topics in last 24h
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT topic, COUNT(*) as cnt FROM brain_entries
               WHERE user_id=? AND datetime(timestamp) > datetime('now','-24 hours')
               GROUP BY topic ORDER BY cnt DESC LIMIT 3""",
            (user_id,)
        ) as c:
            active_topics = [dict(r) for r in await c.fetchall()]

    # Generate topic digests
    for topic_row in active_topics:
        topic = topic_row["topic"]
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT content, source, weight FROM brain_entries
                   WHERE user_id=? AND topic=?
                   AND datetime(timestamp) > datetime('now','-24 hours')
                   ORDER BY weight DESC LIMIT 10""",
                (user_id, topic)
            ) as c:
                new_entries = [dict(r) for r in await c.fetchall()]

        if len(new_entries) < 3:
            continue

        body = await generate_topic_digest(user_id, topic, new_entries, ug, ua)
        if body:
            digest_items.append({
                "digest_type": "topic_digest",
                "title":       f"📊 {topic.title()} — Digest Giornaliero",
                "body":        body,
                "topic":       topic,
                "severity":    1.0,
            })
        await asyncio.sleep(0.5)

    # 2. New KG connections
    new_connections = await check_new_kg_connections(user_id)
    if new_connections:
        top = new_connections[0]
        explanation = await explain_edge(
            top["src"], top["relation"], top["tgt"],
            top.get("evidence_text", ""), ug, ua
        )
        if explanation:
            digest_items.append({
                "digest_type": "connection_alert",
                "title":       f"🔗 Nuovo collegamento: {top['src']} → {top['tgt']}",
                "body":        explanation,
                "topic":       "kg",
                "severity":    1.2,
            })

    # 3. Drift detection on top topics
    for topic_row in active_topics[:2]:
        topic = topic_row["topic"]
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT content FROM brain_entries WHERE user_id=? AND topic=?
                   AND datetime(timestamp) > datetime('now','-24 hours')
                   ORDER BY timestamp DESC LIMIT 5""",
                (user_id, topic)
            ) as c:
                recent = [dict(r) for r in await c.fetchall()]

            async with db.execute(
                """SELECT content FROM brain_entries WHERE user_id=? AND topic=?
                   AND datetime(timestamp) BETWEEN datetime('now','-7 days')
                   AND datetime('now','-2 days')
                   ORDER BY timestamp DESC LIMIT 5""",
                (user_id, topic)
            ) as c:
                older = [dict(r) for r in await c.fetchall()]

        result = await detect_sentiment_drift(user_id, topic, recent, older, ug, ua)
        if result:
            explanation, score = result
            digest_items.append({
                "digest_type": "drift_alert",
                "title":       f"⚡ Cambio sentiment: {topic.title()}",
                "body":        explanation,
                "topic":       topic,
                "severity":    1.0 + score,
            })
        await asyncio.sleep(0.5)

    # Save digest items
    if digest_items:
        async with aiosqlite.connect(settings.db_path) as db:
            await ensure_enhance_tables(db)
            for item in digest_items:
                await db.execute(
                    "INSERT INTO brain_digest_items (user_id, digest_type, title, body, topic, severity) "
                    "VALUES (?,?,?,?,?,?)",
                    (user_id, item["digest_type"], item["title"],
                     item["body"], item["topic"], item["severity"])
                )
            await db.commit()
        logger.info("Brain Layer4: created %d digest items for user %d", len(digest_items), user_id)

    # Also refresh topic summaries (Layer 2)
    await refresh_topic_summaries(user_id)


# ── Public API helpers ─────────────────────────────────────────────────────────

async def get_digest_for_user(user_id: int, limit: int = 10) -> List[Dict]:
    """Get unread digest items for user, newest first."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_enhance_tables(db)
        async with db.execute(
            "SELECT * FROM brain_digest_items WHERE user_id=? "
            "ORDER BY severity DESC, created_at DESC LIMIT ?",
            (user_id, limit)
        ) as c:
            return [dict(r) for r in await c.fetchall()]


async def mark_digest_read(user_id: int, item_id: int):
    """Mark a digest item as read."""
    async with aiosqlite.connect(settings.db_path) as db:
        await ensure_enhance_tables(db)
        await db.execute(
            "UPDATE brain_digest_items SET read=1 WHERE id=? AND user_id=?",
            (item_id, user_id)
        )
        await db.commit()


async def get_brain_context_enhanced(
    user_id: int,
    query: str,
    top_k: int = 5,
) -> str:
    """
    Enhanced brain context for AI prompts.
    Combines: Layer1 FTS search + Layer2 summary + Layer3 edge explanations.
    """
    parts = []

    # Layer 2: topic summary (instant — from cache)
    summary = await get_best_summary_for_query(user_id, query)
    if summary:
        parts.append(summary)

    # Layer 1: FTS entries
    from routers.brain import brain_context_for_prompt
    fts_ctx = await brain_context_for_prompt(user_id, query, top_k=top_k)
    if fts_ctx:
        parts.append(fts_ctx)

    # Layer 3: edge explanations for query entities
    try:
        words = [w for w in query.split() if len(w) > 4]
        for word in words[:2]:
            explanations = await get_edge_explanations_for_node(word)
            if explanations:
                exp_lines = ["[KG RELATIONSHIPS]"]
                for e in explanations[:3]:
                    sig_parts = e["edge_sig"].split("|")
                    if len(sig_parts) == 3:
                        exp_lines.append(f"• {sig_parts[0]} → {sig_parts[2]}: {e['explanation'][:150]}")
                parts.append("\n".join(exp_lines))
                break
    except Exception as ex:
        logger.debug("get_brain_context_enhanced edges: %s", ex)

    return "\n\n".join(parts) if parts else ""


async def run_all_enhancements_for_user(user_id: int):
    """Run all layers for a user — called from scheduler."""
    try:
        await run_proactive_digest(user_id)
    except Exception as e:
        logger.warning("run_all_enhancements user=%d: %s", user_id, e)
