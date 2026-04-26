"""
WorldLens — Supabase connection manager
----------------------------------------
Primary:  Supabase PostgreSQL  (SUPABASE_URL env var set)
Fallback: SQLite local          (SUPABASE_URL not set)

This allows local dev and Render deploy without Supabase to work fine.
When SUPABASE_URL is configured, the shared knowledge graph uses Postgres.
All per-user data (brain_entries, sessions, etc.) stays in SQLite.
"""
from __future__ import annotations
import logging
import os
from typing import Optional, Any

logger = logging.getLogger(__name__)

# ── Connection pool (lazy init) ────────────────────────────────────────────────
_pool = None
_using_postgres = False


async def get_pool():
    """Return asyncpg pool. None if Supabase not configured."""
    global _pool, _using_postgres
    if _pool is not None:
        return _pool

    from config import settings
    url = (settings.supabase_url or "").strip()
    if not url:
        return None

    try:
        import asyncpg
        _pool = await asyncpg.create_pool(
            url,
            min_size=1,
            max_size=5,
            command_timeout=30,
            statement_cache_size=0,   # required for pgBouncer/Supabase
        )
        _using_postgres = True
        logger.info("Supabase PostgreSQL connected ✓")
        return _pool
    except Exception as e:
        logger.warning("Supabase connection failed (%s) — falling back to SQLite", e)
        _pool = None
        return None


async def close_pool():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


def is_postgres() -> bool:
    return _using_postgres and _pool is not None


# ── Schema creation ────────────────────────────────────────────────────────────

POSTGRES_SCHEMA = """
-- Shared knowledge graph nodes
CREATE TABLE IF NOT EXISTS kg_nodes (
    id          BIGSERIAL PRIMARY KEY,
    label       TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'concept',
    aliases     TEXT[] DEFAULT '{}',
    description TEXT DEFAULT '',
    confidence  REAL DEFAULT 1.0,
    source_count INTEGER DEFAULT 1,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT kg_nodes_label_type_unique UNIQUE (label, type)
);

-- Shared knowledge graph edges
CREATE TABLE IF NOT EXISTS kg_edges (
    id              BIGSERIAL PRIMARY KEY,
    src_id          BIGINT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    tgt_id          BIGINT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    relation        TEXT NOT NULL DEFAULT 'related',
    weight          REAL DEFAULT 1.0,
    evidence_count  INTEGER DEFAULT 1,
    evidence_text   TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT kg_edges_unique UNIQUE (src_id, tgt_id, relation)
);

-- User overlay: personal weights and notes on shared nodes
CREATE TABLE IF NOT EXISTS kg_user_nodes (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    node_id     BIGINT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    weight      REAL DEFAULT 1.0,
    notes       TEXT DEFAULT '',
    bookmarked  BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, node_id)
);

-- Upload jobs tracking
CREATE TABLE IF NOT EXISTS kg_uploads (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    filename    TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'text',
    status      TEXT NOT NULL DEFAULT 'pending',
    nodes_added INTEGER DEFAULT 0,
    edges_added INTEGER DEFAULT 0,
    error_msg   TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- Full text search index on nodes
CREATE INDEX IF NOT EXISTS idx_kg_nodes_label ON kg_nodes USING gin(to_tsvector('english', label || ' ' || COALESCE(description, '')));
CREATE INDEX IF NOT EXISTS idx_kg_nodes_type  ON kg_nodes(type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_src   ON kg_edges(src_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_tgt   ON kg_edges(tgt_id);
CREATE INDEX IF NOT EXISTS idx_kg_user_uid    ON kg_user_nodes(user_id);
"""

# SQLite fallback schema (same structure, adapted syntax)
SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS kg_nodes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    label       TEXT NOT NULL,
    type        TEXT NOT NULL DEFAULT 'concept',
    aliases     TEXT DEFAULT '[]',
    description TEXT DEFAULT '',
    confidence  REAL DEFAULT 1.0,
    source_count INTEGER DEFAULT 1,
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(label, type)
);

CREATE TABLE IF NOT EXISTS kg_edges (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    src_id          INTEGER NOT NULL,
    tgt_id          INTEGER NOT NULL,
    relation        TEXT NOT NULL DEFAULT 'related',
    weight          REAL DEFAULT 1.0,
    evidence_count  INTEGER DEFAULT 1,
    evidence_text   TEXT DEFAULT '',
    created_at      TEXT DEFAULT (datetime('now')),
    updated_at      TEXT DEFAULT (datetime('now')),
    UNIQUE(src_id, tgt_id, relation),
    FOREIGN KEY (src_id) REFERENCES kg_nodes(id),
    FOREIGN KEY (tgt_id) REFERENCES kg_nodes(id)
);

CREATE TABLE IF NOT EXISTS kg_user_nodes (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    node_id     INTEGER NOT NULL,
    weight      REAL DEFAULT 1.0,
    notes       TEXT DEFAULT '',
    bookmarked  INTEGER DEFAULT 0,
    created_at  TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, node_id)
);

CREATE TABLE IF NOT EXISTS kg_uploads (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    filename    TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'text',
    status      TEXT NOT NULL DEFAULT 'pending',
    nodes_added INTEGER DEFAULT 0,
    edges_added INTEGER DEFAULT 0,
    error_msg   TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now')),
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_kg_nodes_type  ON kg_nodes(type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_src   ON kg_edges(src_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_tgt   ON kg_edges(tgt_id);
CREATE INDEX IF NOT EXISTS idx_kg_user_uid    ON kg_user_nodes(user_id);
"""


async def ensure_kg_schema():
    """Create knowledge graph tables in Postgres (or SQLite fallback)."""
    pool = await get_pool()

    if pool:
        # PostgreSQL
        async with pool.acquire() as conn:
            for stmt in [s.strip() for s in POSTGRES_SCHEMA.split(";") if s.strip()]:
                try:
                    await conn.execute(stmt)
                except Exception as e:
                    logger.debug("PG schema stmt: %s", e)
        logger.info("KG schema ready (PostgreSQL)")
    else:
        # SQLite fallback
        import aiosqlite
        from config import settings
        async with aiosqlite.connect(settings.db_path) as db:
            for stmt in [s.strip() for s in SQLITE_SCHEMA.split(";") if s.strip()]:
                try:
                    await db.execute(stmt)
                except Exception as e:
                    logger.debug("SQLite KG schema: %s", e)
            await db.commit()
        logger.info("KG schema ready (SQLite fallback)")
