"""
WorldLens Universal DB Layer
==============================
Transparent dual-backend: Supabase PostgreSQL (preferred) or SQLite fallback.
Drop-in replacement for all direct aiosqlite.connect() calls.

Usage:
    from db import db_execute, db_fetchall, db_fetchone, db_fetchval, db_run

All methods auto-route to PG if pool available, else SQLite.
SQL is written in PostgreSQL syntax; SQLite-specific differences are
handled transparently (? → $N placeholders, AUTOINCREMENT → SERIAL, etc.).
"""
from __future__ import annotations
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import aiosqlite
from config import settings

logger = logging.getLogger(__name__)


def _pg_to_sqlite(sql: str) -> str:
    """Convert PostgreSQL-style SQL to SQLite-compatible SQL."""
    # $1, $2 → ?
    sql = re.sub(r'\$\d+', '?', sql)
    # ON CONFLICT ... DO UPDATE SET ... (PG UPSERT → SQLite INSERT OR REPLACE)
    sql = re.sub(r'ON CONFLICT\s*\([^)]+\)\s*DO UPDATE SET[^;]+', '', sql, flags=re.IGNORECASE)
    # ILIKE → LIKE
    sql = sql.replace(' ILIKE ', ' LIKE ')
    # NOW() → datetime('now')
    sql = re.sub(r'\bNOW\(\)', "datetime('now')", sql, flags=re.IGNORECASE)
    # TIMESTAMPTZ → TEXT
    sql = re.sub(r'\bTIMESTAMPTZ\b', 'TEXT', sql, flags=re.IGNORECASE)
    # BIGSERIAL → INTEGER
    sql = re.sub(r'\bBIGSERIAL\b', 'INTEGER', sql, flags=re.IGNORECASE)
    # SERIAL → INTEGER
    sql = re.sub(r'\bSERIAL\b', 'INTEGER', sql, flags=re.IGNORECASE)
    # BOOLEAN → INTEGER
    sql = re.sub(r'\bBOOLEAN\b', 'INTEGER', sql, flags=re.IGNORECASE)
    # TRUE/FALSE → 1/0
    sql = re.sub(r'\bTRUE\b', '1', sql, flags=re.IGNORECASE)
    sql = re.sub(r'\bFALSE\b', '0', sql, flags=re.IGNORECASE)
    return sql


def _sqlite_to_pg(sql: str) -> str:
    """Convert SQLite-style SQL to PostgreSQL-compatible SQL."""

    # datetime('now', 'literal interval') -> (NOW() - INTERVAL 'X unit')
    def _interval_replace(m):
        val = m.group(1).strip().strip("'").lstrip('-').strip()
        return f"(NOW() - INTERVAL '{val}')"
    sql = re.sub(
        r"datetime\s*\(\s*'now'\s*,\s*'(-[\w\s]+)'\s*\)",
        _interval_replace, sql, flags=re.IGNORECASE
    )

    # datetime('now') -> NOW()
    sql = re.sub(r"datetime\('now'\)", 'NOW()', sql, flags=re.IGNORECASE)

    # datetime(column) -> column  (SQLite cast, not needed in PG)
    sql = re.sub(r'datetime\((\w+)\)', r'\1', sql, flags=re.IGNORECASE)

    # ? placeholders -> $1, $2, ...
    counter = [0]
    def replace_q(m):
        counter[0] += 1
        return f'${counter[0]}'
    sql = re.sub(r'\?', replace_q, sql)

    # INTEGER PRIMARY KEY AUTOINCREMENT -> SERIAL PRIMARY KEY
    sql = re.sub(r'\bINTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b',
                 'SERIAL PRIMARY KEY', sql, flags=re.IGNORECASE)
    return sql


async def _get_pg_pool():
    """Get Postgres pool or None."""
    try:
        from supabase_client import get_pool
        return await get_pool()
    except Exception:
        return None


# ── Core execution functions ───────────────────────────────────────────────────

async def db_execute(sql: str, params: Tuple = (), *, returning: bool = False) -> Optional[Any]:
    """
    Execute INSERT/UPDATE/DELETE.
    If returning=True, returns first column of first row (for INSERT...RETURNING id).
    """
    pool = await _get_pg_pool()
    if pool:
        pg_sql = _sqlite_to_pg(sql)
        if returning and 'RETURNING' not in pg_sql.upper():
            # Add RETURNING id if not present
            pg_sql = pg_sql.rstrip(';') + ' RETURNING id'
        try:
            async with pool.acquire() as conn:
                if returning:
                    row = await conn.fetchrow(pg_sql, *params)
                    return row[0] if row else None
                else:
                    await conn.execute(pg_sql, *params)
                    return None
        except Exception as e:
            logger.debug("db_execute PG error: %s | sql: %s", e, sql[:80])
            # Fall through to SQLite

    # SQLite fallback
    sq_sql = _pg_to_sqlite(sql)
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(sq_sql, params) as c:
                lastrow = c.lastrowid
            await db.commit()
            return lastrow if returning else None
    except Exception as e:
        logger.debug("db_execute SQLite error: %s | sql: %s", e, sql[:80])
        return None


async def db_fetchall(sql: str, params: Tuple = ()) -> List[Dict]:
    """Execute SELECT and return list of dicts."""
    pool = await _get_pg_pool()
    if pool:
        pg_sql = _sqlite_to_pg(sql)
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(pg_sql, *params)
                return [dict(r) for r in rows]
        except Exception as e:
            logger.debug("db_fetchall PG error: %s | sql: %s", e, sql[:80])

    sq_sql = _pg_to_sqlite(sql)
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(sq_sql, params) as c:
                return [dict(r) for r in await c.fetchall()]
    except Exception as e:
        logger.debug("db_fetchall SQLite error: %s | sql: %s", e, sql[:80])
        return []


async def db_fetchone(sql: str, params: Tuple = ()) -> Optional[Dict]:
    """Execute SELECT and return first row as dict."""
    pool = await _get_pg_pool()
    if pool:
        pg_sql = _sqlite_to_pg(sql)
        try:
            async with pool.acquire() as conn:
                row = await conn.fetchrow(pg_sql, *params)
                return dict(row) if row else None
        except Exception as e:
            logger.debug("db_fetchone PG error: %s | sql: %s", e, sql[:80])

    sq_sql = _pg_to_sqlite(sql)
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(sq_sql, params) as c:
                row = await c.fetchone()
                return dict(row) if row else None
    except Exception as e:
        logger.debug("db_fetchone SQLite error: %s | sql: %s", e, sql[:80])
        return None


async def db_fetchval(sql: str, params: Tuple = ()) -> Optional[Any]:
    """Execute SELECT and return first column of first row."""
    pool = await _get_pg_pool()
    if pool:
        pg_sql = _sqlite_to_pg(sql)
        try:
            async with pool.acquire() as conn:
                return await conn.fetchval(pg_sql, *params)
        except Exception as e:
            logger.debug("db_fetchval PG error: %s | sql: %s", e, sql[:80])

    sq_sql = _pg_to_sqlite(sql)
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            async with db.execute(sq_sql, params) as c:
                row = await c.fetchone()
                return row[0] if row else None
    except Exception as e:
        logger.debug("db_fetchval SQLite error: %s | sql: %s", e, sql[:80])
        return None


async def db_run(sql: str) -> None:
    """Execute raw DDL (CREATE TABLE, CREATE INDEX, etc.)."""
    pool = await _get_pg_pool()
    if pool:
        # Convert SQLite DDL to PG
        pg_sql = _sqlite_to_pg(sql)
        # Remove SQLite-specific clauses
        pg_sql = re.sub(r'\bIF NOT EXISTS\b\s*(?=\()', '', pg_sql, flags=re.IGNORECASE)
        try:
            async with pool.acquire() as conn:
                await conn.execute(pg_sql)
            return
        except Exception as e:
            logger.debug("db_run PG DDL error (non-fatal): %s", e)

    sq_sql = _pg_to_sqlite(sql)
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await db.executescript(sq_sql)
            await db.commit()
    except Exception as e:
        logger.debug("db_run SQLite DDL error: %s", e)


async def db_executemany(sql: str, params_list: List[Tuple]) -> None:
    """Batch INSERT/UPDATE."""
    if not params_list:
        return
    pool = await _get_pg_pool()
    if pool:
        pg_sql = _sqlite_to_pg(sql)
        try:
            async with pool.acquire() as conn:
                await conn.executemany(pg_sql, params_list)
            return
        except Exception as e:
            logger.debug("db_executemany PG error: %s", e)

    sq_sql = _pg_to_sqlite(sql)
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await db.executemany(sq_sql, params_list)
            await db.commit()
    except Exception as e:
        logger.debug("db_executemany SQLite error: %s", e)


# ── Schema management ──────────────────────────────────────────────────────────

# Full unified schema — works on both Postgres and SQLite
FULL_SCHEMA_PG = """
CREATE TABLE IF NOT EXISTS users (
    id                  SERIAL PRIMARY KEY,
    email               TEXT UNIQUE NOT NULL,
    username            TEXT NOT NULL,
    password_hash       TEXT NOT NULL,
    avatar_color        TEXT DEFAULT '#3B82F6',
    bio                 TEXT DEFAULT '',
    timezone            TEXT DEFAULT 'UTC',
    notifications_enabled INTEGER DEFAULT 1,
    onboarding_done     INTEGER DEFAULT 0,
    tutorial_done       INTEGER DEFAULT 0,
    interests           TEXT DEFAULT '[]',
    regions             TEXT DEFAULT '[]',
    market_prefs        TEXT DEFAULT '[]',
    experience_level    TEXT DEFAULT 'beginner',
    role                TEXT DEFAULT 'user',
    is_admin            INTEGER DEFAULT 0,
    is_active           INTEGER DEFAULT 1,
    ai_provider         TEXT DEFAULT 'gemini',
    user_anthropic_key  TEXT DEFAULT '',
    user_gemini_key     TEXT DEFAULT '',
    lang                TEXT DEFAULT 'it',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    last_login          TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS watchlist (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    type        TEXT NOT NULL,
    value       TEXT NOT NULL,
    label       TEXT,
    notes       TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, type, value)
);

CREATE TABLE IF NOT EXISTS alerts (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER NOT NULL REFERENCES users(id),
    title               TEXT NOT NULL,
    condition           TEXT NOT NULL,
    type                TEXT DEFAULT 'event',
    category            TEXT DEFAULT '',
    country             TEXT DEFAULT '',
    severity_threshold  REAL DEFAULT 7.0,
    active              INTEGER DEFAULT 1,
    triggered_count     INTEGER DEFAULT 0,
    last_triggered      TIMESTAMPTZ,
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
    key         TEXT PRIMARY KEY,
    value       TEXT NOT NULL DEFAULT '',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invites (
    id          SERIAL PRIMARY KEY,
    code        TEXT UNIQUE NOT NULL,
    label       TEXT DEFAULT '',
    email_hint  TEXT DEFAULT '',
    created_by  INTEGER REFERENCES users(id),
    used_by     INTEGER REFERENCES users(id),
    used_at     TIMESTAMPTZ,
    max_uses    INTEGER DEFAULT 1,
    use_count   INTEGER DEFAULT 0,
    expires_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_entries (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    content     TEXT NOT NULL,
    source      TEXT NOT NULL DEFAULT 'manual',
    topic       TEXT DEFAULT '',
    weight      REAL DEFAULT 1.0,
    context     TEXT DEFAULT '{}',
    timestamp   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_brain_user ON brain_entries(user_id, timestamp DESC);

CREATE TABLE IF NOT EXISTS brain_digests (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL DEFAULT 1,
    date        TEXT NOT NULL,
    content     TEXT NOT NULL,
    ai_enhanced INTEGER NOT NULL DEFAULT 0,
    read        INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS daily_insights (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    date        TEXT NOT NULL,
    insight     TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS saved_events (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    event_id    TEXT NOT NULL,
    note        TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_id)
);

CREATE TABLE IF NOT EXISTS ai_feedback (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    question    TEXT NOT NULL,
    answer      TEXT NOT NULL,
    context     TEXT DEFAULT '',
    rating      INTEGER NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER REFERENCES users(id),
    action      TEXT NOT NULL,
    section     TEXT DEFAULT '',
    detail      TEXT DEFAULT '',
    ip          TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_act_user ON activity_log(user_id);

CREATE TABLE IF NOT EXISTS agent_configs (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    bot_id      TEXT NOT NULL,
    config_json TEXT DEFAULT '{}',
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, bot_id)
);

CREATE TABLE IF NOT EXISTS agent_brief_history (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    bot_id      TEXT NOT NULL,
    brief_json  TEXT NOT NULL,
    signal      TEXT DEFAULT 'neutral',
    event_count INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_abh ON agent_brief_history(user_id, bot_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_streaks (
    user_id             INTEGER PRIMARY KEY REFERENCES users(id),
    current_streak      INTEGER DEFAULT 0,
    longest_streak      INTEGER DEFAULT 0,
    last_activity_date  TEXT DEFAULT '',
    total_reads         INTEGER DEFAULT 0,
    streak_frozen       INTEGER DEFAULT 0,
    freeze_used_date    TEXT DEFAULT '',
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_predictions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    bot_id          TEXT NOT NULL,
    week_key        TEXT NOT NULL,
    prediction_json TEXT NOT NULL,
    prediction_ts   TIMESTAMPTZ DEFAULT NOW(),
    verify_json     TEXT DEFAULT NULL,
    verify_ts       TIMESTAMPTZ DEFAULT NULL,
    accuracy_score  REAL DEFAULT NULL,
    UNIQUE(user_id, bot_id, week_key)
);

CREATE TABLE IF NOT EXISTS agent_digest_log (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    bot_id      TEXT NOT NULL,
    digest_date TEXT NOT NULL,
    sent_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, bot_id, digest_date)
);

CREATE TABLE IF NOT EXISTS etf_portfolios (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    name        TEXT NOT NULL DEFAULT 'Portafoglio Principale',
    strategy    TEXT DEFAULT 'custom',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_holdings (
    id              SERIAL PRIMARY KEY,
    portfolio_id    INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    ticker          TEXT NOT NULL,
    name            TEXT DEFAULT '',
    quantity        REAL DEFAULT 0,
    avg_buy_price   REAL DEFAULT 0,
    currency        TEXT DEFAULT 'EUR',
    asset_class     TEXT DEFAULT 'equity',
    added_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_alerts (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    ticker          TEXT NOT NULL,
    condition_type  TEXT NOT NULL,
    threshold       REAL,
    active          INTEGER DEFAULT 1,
    triggered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_cache (
    id              SERIAL PRIMARY KEY,
    cache_date      TEXT NOT NULL UNIQUE,
    global_brief    TEXT NOT NULL DEFAULT '',
    macro_narrative TEXT NOT NULL DEFAULT '[]',
    ew_assessment   TEXT NOT NULL DEFAULT '',
    top_events      TEXT NOT NULL DEFAULT '[]',
    kg_connections  TEXT NOT NULL DEFAULT '[]',
    market_snapshot TEXT NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    ai_enhanced     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS brain_sessions (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id),
    session_id  TEXT NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, session_id)
);
"""


async def ensure_full_schema():
    """
    Create all application tables on Postgres (or SQLite fallback).
    Safe to call multiple times — all statements are IF NOT EXISTS.
    Called once at startup from main.py lifespan.
    """
    pool = await _get_pg_pool()
    if pool:
        # Execute each statement separately for Postgres
        statements = [s.strip() for s in FULL_SCHEMA_PG.split(';') if s.strip()]
        errors = []
        async with pool.acquire() as conn:
            for stmt in statements:
                if not stmt:
                    continue
                try:
                    await conn.execute(stmt)
                except Exception as e:
                    # Ignore "already exists" errors
                    msg = str(e).lower()
                    if 'already exists' not in msg and 'duplicate' not in msg:
                        errors.append(f"{stmt[:40]}... → {e}")
        if errors:
            for err in errors[:5]:
                logger.debug("Schema DDL warning: %s", err)
        logger.info("Full schema ensured on PostgreSQL (%d tables)", len(statements))
    else:
        logger.info("Supabase not available — SQLite schema managed by database.py")


# ── get_db() context manager ───────────────────────────────────────────────────
# Used by all routers and scheduler via: async with get_db() as db: ...
# Routes to Supabase PostgreSQL when available, SQLite otherwise.
# Provides a unified interface compatible with both backends.

from contextlib import asynccontextmanager

class _PgDbWrapper:
    """Wraps an asyncpg connection in autocommit-like mode.
    
    Each execute() is independent. commit() is a no-op since asyncpg
    on Supabase runs in autocommit by default when not in a transaction block.
    This avoids double-commit issues when callers call db.commit() explicitly.
    """

    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        pass  # Connection returned to pool by acquire() context manager

    def execute(self, sql: str, params=None):
        return _PgCursor(self._conn, sql, params or [])

    async def commit(self):
        pass  # No-op: asyncpg executes each statement immediately


class _PgCursor:
    """Async context manager for a single PG query."""

    def __init__(self, conn, sql, params):
        self._conn = conn
        self._sql = _sqlite_to_pg(sql)
        self._params = params
        self._rows = []

    async def __aenter__(self):
        try:
            self._rows = await self._conn.fetch(self._sql, *self._params)
        except Exception as e:
            logger.debug("_PgCursor error: %s | sql: %s", e, self._sql[:120])
            raise
        return self

    async def __aexit__(self, *a):
        pass

    async def fetchone(self):
        if not self._rows:
            return None
        return _Row(dict(self._rows[0]))

    async def fetchall(self):
        return [_Row(dict(r)) for r in self._rows]

    # Support await db.execute(...) without context manager (fire-and-forget)
    def __await__(self):
        return self._run().__await__()

    async def _run(self):
        try:
            await self._conn.execute(self._sql, *self._params)
        except Exception as e:
            logger.debug("_PgCursor._run error: %s | sql: %s", e, self._sql[:120])
            raise


class _Row(dict):
    """Dict subclass that supports both row["col"] and row[0] access."""
    def __init__(self, d):
        super().__init__(d)
        self._keys = list(d.keys())

    def __getitem__(self, key):
        if isinstance(key, int):
            return super().__getitem__(self._keys[key])
        return super().__getitem__(key)

    def values(self):
        return super().values()


class _SqliteDbWrapper:
    """Wraps aiosqlite connection with _Row support."""

    def __init__(self, conn):
        self._conn = conn

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        pass

    def execute(self, sql: str, params=None):
        return _SqliteCursor(self._conn, sql, params or [])

    async def commit(self):
        await self._conn.commit()


class _SqliteCursor:
    def __init__(self, conn, sql, params):
        self._conn = conn
        self._sql = sql
        self._params = params
        self._cur = None

    async def __aenter__(self):
        self._cur = await self._conn.execute(self._sql, self._params)
        return self

    async def __aexit__(self, *a):
        if self._cur:
            await self._cur.close()

    async def fetchone(self):
        if not self._cur:
            return None
        row = await self._cur.fetchone()
        return _Row(dict(row)) if row else None

    async def fetchall(self):
        if not self._cur:
            return []
        rows = await self._cur.fetchall()
        return [_Row(dict(r)) for r in rows]

    def __await__(self):
        return self._run().__await__()

    async def _run(self):
        await self._conn.execute(self._sql, self._params)


@asynccontextmanager
async def get_db():
    """
    Universal DB context manager.
    Uses Supabase PostgreSQL when available, SQLite otherwise.
    
    Usage:
        async with get_db() as db:
            async with db.execute("SELECT ...", (params,)) as cur:
                rows = await cur.fetchall()
            await db.commit()
    """
    pool = await _get_pg_pool()
    if pool:
        async with pool.acquire() as conn:
            wrapper = _PgDbWrapper(conn)
            async with wrapper:
                yield wrapper
    else:
        async with aiosqlite.connect(settings.db_path) as conn:
            conn.row_factory = aiosqlite.Row
            yield _SqliteDbWrapper(conn)
