"""
WorldLens Brain Auto-Entries Engine
=====================================
Writes brain_entries automatically from:
 1. GDELT events (every 15min) — no AI needed
 2. Macro indicator changes (on significant delta)
 3. Jarvis KG traversal summaries (after each analysis)
 4. Daily AI digest (if Gemini key present)

Restores the "brain intelligence" feed with real content.
"""
from __future__ import annotations
import asyncio
import json
import logging
import re
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple

import aiosqlite
from config import settings

logger = logging.getLogger(__name__)


# ── User ID for system-generated entries ──────────────────────────────────────
_SYSTEM_USER_ID = 1   # Admin user receives all auto-entries


async def _ensure_brain_tables_exist(db: aiosqlite.Connection):
    """Ensure brain tables exist using the canonical schema from brain.py."""
    try:
        from routers.brain import BRAIN_SCHEMA
        await db.executescript(BRAIN_SCHEMA)
    except Exception:
        pass
    # brain_digests is additional
    await db.execute("""
        CREATE TABLE IF NOT EXISTS brain_digests (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL DEFAULT 1,
            date        TEXT NOT NULL,
            content     TEXT NOT NULL,
            ai_enhanced INTEGER NOT NULL DEFAULT 0,
            read        INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE(user_id, date)
        )
    """)
    await db.commit()


async def _write_entry(
    title: str,
    content: str,
    source_type: str = "auto",
    tags: List[str] = None,
    weight: float = 1.0,
    confidence: float = 0.85,
    user_id: int = _SYSTEM_USER_ID,
    ai_enhanced: bool = False,
) -> Optional[int]:
    """Write a single brain entry. Returns entry id or None."""
    tags_json = json.dumps(tags or [])
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            from routers.brain import BRAIN_SCHEMA
            await db.executescript(BRAIN_SCHEMA)
            # Avoid duplicate: same content snippet in last 24h
            snippet = title[:80]
            async with db.execute(
                "SELECT id FROM brain_entries WHERE user_id=? "
                "AND content LIKE ? "
                "AND datetime(timestamp) > datetime('now','-24 hours') LIMIT 1",
                (user_id, f"%{snippet}%")
            ) as c:
                if await c.fetchone():
                    return None
            # Build content with title + body
            full_content = f"**{title}**\n\n{content}"[:3000]
            # topic from tags
            topic = tags[0] if tags else source_type
            # context JSON
            import json as _json
            ctx = _json.dumps({"tags": tags, "ai_enhanced": ai_enhanced, "confidence": confidence})
            async with db.execute(
                "INSERT INTO brain_entries (user_id, content, source, topic, weight, context) "
                "VALUES (?,?,?,?,?,?)",
                (user_id, full_content, source_type, topic, weight, ctx)
            ) as c:
                entry_id = c.lastrowid
            await db.commit()
            # Trigger FTS rebuild
            try:
                await db.execute("INSERT INTO brain_fts(brain_fts) VALUES('rebuild')")
                await db.commit()
            except Exception:
                pass
            return entry_id
    except Exception as e:
        logger.debug("_write_entry: %s", e)
        return None


# ── L1: Events → brain_entries ────────────────────────────────────────────────

async def populate_brain_from_events(user_id: int = _SYSTEM_USER_ID) -> int:
    """
    Convert recent high-severity events into brain entries.
    No AI required — pure rule-based extraction.
    """
    written = 0
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT title, summary, ai_summary, category, country_name,
                          severity, source_url, timestamp
                   FROM events
                   WHERE datetime(timestamp) > datetime('now','-6 hours')
                   AND severity >= 6
                   ORDER BY severity DESC
                   LIMIT 50"""
            ) as c:
                events = [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.debug("populate_brain events query: %s", e)
        return 0

    for ev in events:
        title   = ev.get("title", "").strip()
        summary = (ev.get("ai_summary") or ev.get("summary") or "").strip()
        if not title or len(title) < 10:
            continue

        category  = (ev.get("category") or "").title()
        country   = ev.get("country_name", "")
        severity  = float(ev.get("severity") or 6)
        timestamp = ev.get("timestamp", "")[:10]

        # Build structured content
        content_lines = [
            f"**Categoria**: {category} | **Paese**: {country} | **Data**: {timestamp}",
            f"**Severity**: {severity:.0f}/10",
            "",
        ]
        if summary:
            content_lines.append(summary[:800])

        # Try to find KG context for this event
        try:
            kg_ctx = await _get_kg_context_for_event(ev)
            if kg_ctx:
                content_lines.extend(["", "**Contesto KG**:", kg_ctx])
        except Exception:
            pass

        content = "\n".join(content_lines)
        tags = [category.lower(), country.lower() if country else "global",
                f"severity-{int(severity)}"]
        tags = [t for t in tags if t and len(t) > 1]

        eid = await _write_entry(
            title=title,
            content=content,
            source_type="event",
            tags=tags,
            weight=min(3.0, severity / 3),
            confidence=0.9,
            user_id=user_id,
        )
        if eid:
            written += 1

    if written:
        logger.info("Brain auto-entries (events): +%d", written)
    return written


async def _get_kg_context_for_event(ev: Dict) -> str:
    """Find relevant KG nodes for an event and build context string."""
    from supabase_client import get_pool
    pool = await get_pool()

    title = ev.get("title", "")
    country = ev.get("country_name", "")

    # Extract keywords
    keywords = []
    if country and len(country) > 1:
        keywords.append(country)
    # Extract capitalized words from title (likely entity names)
    cap_words = re.findall(r'\b[A-Z][a-z]{2,}\b', title)
    keywords.extend(cap_words[:3])

    if not keywords:
        return ""

    context_parts = []
    for kw in keywords[:3]:
        try:
            if pool:
                async with pool.acquire() as conn:
                    rows = await conn.fetch(
                        "SELECT label, type, description FROM kg_nodes "
                        "WHERE label ILIKE $1 AND description != '' LIMIT 2",
                        f"%{kw}%"
                    )
                    for r in rows:
                        if r["description"]:
                            context_parts.append(f"• **{r['label']}** ({r['type']}): {r['description'][:150]}")
            else:
                async with aiosqlite.connect(settings.db_path) as db:
                    db.row_factory = aiosqlite.Row
                    async with db.execute(
                        "SELECT label, type, description FROM kg_nodes "
                        "WHERE label LIKE ? AND description != '' LIMIT 2",
                        (f"%{kw}%",)
                    ) as c:
                        for r in await c.fetchall():
                            if r["description"]:
                                context_parts.append(f"• **{r['label']}** ({r['type']}): {r['description'][:150]}")
        except Exception:
            pass

    return "\n".join(context_parts[:4])


# ── L2: Macro indicators → brain_entries ──────────────────────────────────────

async def populate_brain_from_macro(user_id: int = _SYSTEM_USER_ID) -> int:
    """Write brain entries for significant macro indicator changes."""
    written = 0
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT name, value, previous, unit, category, country, updated_at
                   FROM macro_indicators
                   WHERE ABS(COALESCE(CAST(value AS REAL),0)-COALESCE(CAST(previous AS REAL),0))
                         / (ABS(COALESCE(CAST(previous AS REAL),0.001))+0.001) > 0.01
                   ORDER BY updated_at DESC LIMIT 20"""
            ) as c:
                changed = [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.debug("populate_brain macro query: %s", e)
        return 0

    for m in changed:
        name    = m.get("name", "")
        val     = m.get("value")
        prev    = m.get("previous")
        unit    = m.get("unit", "")
        country = m.get("country", "Global")

        if not name or val is None:
            continue

        try:
            change_pct = (float(val)-float(prev))/abs(float(prev)+0.001)*100
            direction  = "↑" if change_pct > 0 else "↓"
            title = f"{name} ({country}): {val} {unit} {direction}{abs(change_pct):.1f}%"
        except Exception:
            title = f"{name} ({country}): {val} {unit}"

        content = (
            f"**Indicatore**: {name}\n"
            f"**Paese/Regione**: {country}\n"
            f"**Valore corrente**: {val} {unit}\n"
            f"**Valore precedente**: {prev} {unit}\n"
            f"**Categoria**: {m.get('category', 'macro')}\n"
            f"**Aggiornato**: {m.get('updated_at', '')[:10]}"
        )

        eid = await _write_entry(
            title=title,
            content=content,
            source_type="macro",
            tags=["macro", country.lower(), m.get("category", "economy")],
            weight=1.5,
            confidence=0.95,
            user_id=user_id,
        )
        if eid:
            written += 1

    if written:
        logger.info("Brain auto-entries (macro): +%d", written)
    return written


# ── L3: Store Jarvis/AI analysis as brain entries ──────────────────────────────

async def store_analysis_as_entry(
    query: str,
    analysis: str,
    source_type: str = "jarvis",
    user_id: int = _SYSTEM_USER_ID,
) -> Optional[int]:
    """
    Save a Jarvis node analysis or Brain Agent response as a brain entry.
    This is the self-improvement loop: every AI analysis enriches the brain.
    """
    if not analysis or len(analysis) < 50:
        return None

    # Extract key tags from the analysis text
    tags = re.findall(r'\b(ETF|Fed|ECB|inflation|GDP|VIX|DXY|gold|oil|recession|'
                      r'bitcoin|equity|bond|EM|macro|fiscal|monetary)\b',
                      analysis, re.IGNORECASE)
    tags = list(set([t.lower() for t in tags[:6]]))

    return await _write_entry(
        title=f"AI Analysis: {query[:80]}",
        content=analysis[:2000],
        source_type=source_type,
        tags=tags,
        weight=2.0,
        confidence=0.85,
        user_id=user_id,
        ai_enhanced=True,
    )


# ── Daily digest generation ────────────────────────────────────────────────────

async def generate_daily_digest(user_id: int = _SYSTEM_USER_ID) -> Optional[str]:
    """
    Generate a daily brain digest:
    - Base: rule-based summary of last 24h events + macro changes
    - Enhanced: Gemini narrative if key available
    Returns the digest text.
    """
    today = date.today().isoformat()

    # Check if digest already generated today
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await _ensure_brain_tables_exist(db)
            async with db.execute(
                "SELECT content FROM brain_digests WHERE user_id=? AND date=?",
                (user_id, today)
            ) as c:
                existing = await c.fetchone()
                if existing:
                    return existing[0]
    except Exception:
        pass

    # Gather data for digest
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """SELECT title, category, country_name, severity, timestamp
               FROM events
               WHERE datetime(timestamp) > datetime('now','-24 hours')
               AND severity >= 6
               ORDER BY severity DESC LIMIT 12"""
        ) as c:
            events = [dict(r) for r in await c.fetchall()]

        async with db.execute(
            """SELECT name, value, previous, unit, country
               FROM macro_indicators
               ORDER BY updated_at DESC LIMIT 10"""
        ) as c:
            macro = [dict(r) for r in await c.fetchall()]

    # KG top nodes
    top_nodes = await _get_top_kg_nodes(8)

    # ── Build base digest (no AI) ──
    base_lines = [
        f"# 🧠 WorldLens Brain Digest — {today}",
        "",
        "## 📊 MACRO SNAPSHOT",
    ]
    for m in macro[:6]:
        try:
            v = float(m["value"])
            p = float(m["previous"] or v)
            arrow = "↑" if v > p else "↓"
        except Exception:
            arrow = ""
        base_lines.append(
            f"• **{m['name']}** ({m.get('country','Global')}): "
            f"{m['value']} {m.get('unit','')} {arrow}"
        )

    base_lines += ["", "## ⚡ TOP EVENTI (24h)"]
    cats: Dict[str, List] = {}
    for ev in events:
        cat = (ev.get("category") or "OTHER").title()
        cats.setdefault(cat, []).append(ev)
    for cat, evs in list(cats.items())[:4]:
        base_lines.append(f"\n**{cat}**")
        for ev in evs[:3]:
            sev  = ev.get("severity", 6)
            cntry = ev.get("country_name", "")
            base_lines.append(f"  [{sev:.0f}/10] {ev['title'][:80]} — {cntry}")

    if top_nodes:
        base_lines += ["", "## 🌐 KNOWLEDGE GRAPH — TOP NODI"]
        for n in top_nodes:
            base_lines.append(f"• **{n['label']}** ({n['type']}) — {n.get('description','')[:80]}")

    base_digest = "\n".join(base_lines)

    # ── AI Enhancement ──
    ai_enhanced = False
    try:
        from ai_layer import _resolve_provider, _call_claude
        provider, ai_key = _resolve_provider()
        if ai_key:
            prompt = (
                "Sei il Chief Analyst AI di WorldLens. Basandoti sui dati seguenti, "
                "genera un digest finanziario-geopolitico professionale in italiano "
                "(400-600 parole). Struttura: Executive Summary (3 bullet), "
                "Macro Analysis, Geopolitical Risk, Market Implications, "
                "Key Items da monitorare nella prossima settimana.\n\n"
                f"DATI:\n{base_digest[:3000]}"
            )
            ug = ai_key if provider == "gemini" else ""
            ua = ai_key if provider == "claude" else ""
            ai_text = await _call_claude(
                prompt,
                system="Sei un analista finanziario senior. Rispondi in markdown. Sii diretto e concreto.",
                max_tokens=1500,
                user_gemini_key=ug,
                user_anthropic_key=ua,
            )
            if ai_text and len(ai_text) > 100:
                base_digest = ai_text
                ai_enhanced = True
    except Exception as ae:
        logger.debug("Digest AI enhancement: %s", ae)

    # Save digest
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await _ensure_brain_tables_exist(db)
            await db.execute(
                "INSERT OR REPLACE INTO brain_digests (user_id, date, content, ai_enhanced) "
                "VALUES (?,?,?,?)",
                (user_id, today, base_digest, int(ai_enhanced))
            )
            await db.commit()

        # Also write as brain entry so it shows up in the feed
        await _write_entry(
            title=f"Daily Digest — {today}",
            content=base_digest[:2000],
            source_type="digest",
            tags=["digest", today, "daily"],
            weight=2.5,
            confidence=0.9,
            user_id=user_id,
            ai_enhanced=ai_enhanced,
        )
    except Exception as e:
        logger.warning("Save digest: %s", e)

    logger.info("Brain digest generated for %s (AI=%s)", today, ai_enhanced)
    return base_digest


async def _get_top_kg_nodes(limit: int = 8) -> List[Dict]:
    """Get top KG nodes by source_count."""
    from supabase_client import get_pool
    pool = await get_pool()
    try:
        if pool:
            async with pool.acquire() as conn:
                rows = await conn.fetch(
                    "SELECT label, type, description, source_count FROM kg_nodes "
                    "ORDER BY source_count DESC LIMIT $1", limit
                )
                return [dict(r) for r in rows]
        else:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT label, type, description, source_count FROM kg_nodes "
                    "ORDER BY source_count DESC LIMIT ?", (limit,)
                ) as c:
                    return [dict(r) for r in await c.fetchall()]
    except Exception:
        return []


# ── Main autonomous brain enrichment loop ──────────────────────────────────────

async def run_brain_enrichment_cycle(user_id: int = _SYSTEM_USER_ID) -> Dict:
    """
    Full enrichment cycle — called every 15 minutes by scheduler.
    Populates brain_entries from all sources.
    """
    results = {}

    n1 = await populate_brain_from_events(user_id)
    results["events"] = n1

    n2 = await populate_brain_from_macro(user_id)
    results["macro"] = n2

    total = n1 + n2
    if total:
        logger.info("Brain enrichment cycle: +%d entries (events=%d, macro=%d)",
                    total, n1, n2)
    return results
