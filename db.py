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
    # ? placeholders → $1, $2, ...
    counter = [0]
    def replace_q(m):
        counter[0] += 1
        return f'${counter[0]}'
    sql = re.sub(r'\?', replace_q, sql)
    # datetime('now') → NOW()
    sql = re.sub(r"datetime\('now'\)", 'NOW()', sql, flags=re.IGNORECASE)
    # INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
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

# ─────────────────────────────────────────────────────────────────────────────
# UNIFIED DB CONNECTION — routes to PG (Supabase) or SQLite transparently
# Usage in routers:
#   from db import get_db
#   async with get_db() as db:
#       rows = await db.fetchall("SELECT * FROM users WHERE id=?", (uid,))
# ─────────────────────────────────────────────────────────────────────────────

class _PGCursor:
    """Wraps asyncpg cursor to look like aiosqlite cursor."""
    def __init__(self, rows, lastrowid=None):
        self._rows = rows
        self.lastrowid = lastrowid or 0
        self.rowcount = len(rows) if rows else 0

    async def fetchall(self):
        return self._rows or []

    async def fetchone(self):
        return self._rows[0] if self._rows else None

    async def fetchval(self):
        if self._rows and self._rows[0]:
            vals = list(dict(self._rows[0]).values())
            return vals[0] if vals else None
        return None

    def __aiter__(self):
        self._idx = 0
        return self

    async def __anext__(self):
        if self._idx >= len(self._rows or []):
            raise StopAsyncIteration
        row = self._rows[self._idx]
        self._idx += 1
        return row


class _PGDb:
    """Wraps asyncpg connection to be aiosqlite-compatible."""
    def __init__(self, conn):
        self._conn = conn
        self.row_factory = None  # ignored, PG always returns dicts

    def _adapt(self, sql: str) -> str:
        return _sqlite_to_pg(sql)

    async def execute(self, sql: str, params: tuple = ()):
        pg_sql = self._adapt(sql)
        verb = pg_sql.strip()[:6].upper()
        try:
            if verb in ("INSERT", "UPDATE", "DELETE"):
                # Try RETURNING id for INSERT
                if verb == "INSERT" and "RETURNING" not in pg_sql.upper():
                    pg_sql_ret = pg_sql.rstrip(";") + " RETURNING id"
                    try:
                        row = await self._conn.fetchrow(pg_sql_ret, *params)
                        lastrowid = row["id"] if row and "id" in row else 0
                        return _PGCursor([], lastrowid)
                    except Exception:
                        pass
                await self._conn.execute(pg_sql, *params)
                return _PGCursor([])
            else:
                rows = await self._conn.fetch(pg_sql, *params)
                dicts = [dict(r) for r in rows]
                return _PGCursor(dicts)
        except Exception as e:
            logger.debug("_PGDb.execute [%s...]: %s", pg_sql[:60], e)
            return _PGCursor([])

    async def executemany(self, sql: str, params_list):
        pg_sql = self._adapt(sql)
        for params in params_list:
            try:
                await self._conn.execute(pg_sql, *params)
            except Exception as e:
                logger.debug("_PGDb.executemany: %s", e)

    async def executescript(self, script: str):
        stmts = [s.strip() for s in script.split(";") if s.strip()]
        for stmt in stmts:
            try:
                await self._conn.execute(self._adapt(stmt))
            except Exception as e:
                msg = str(e).lower()
                if "already exists" not in msg and "duplicate" not in msg:
                    logger.debug("executescript stmt: %s", e)

    async def commit(self):
        pass  # asyncpg auto-commits in non-transaction mode

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    def __aiter__(self):
        raise NotImplementedError


class _SQLiteCompat:
    """Thin wrapper around aiosqlite that exposes the same interface."""
    def __init__(self, path: str):
        self._path = path
        self._db = None

    async def __aenter__(self):
        import aiosqlite as _aiosqlite
        self._db = await _aiosqlite.connect(self._path)
        self._db.row_factory = _aiosqlite.Row
        return _DBCompat(self._db)

    async def __aexit__(self, *args):
        if self._db:
            await self._db.close()


class _DBCompat:
    """Unified cursor/execute interface backed by aiosqlite."""
    def __init__(self, db):
        self._db = db
        self.row_factory = None

    async def execute(self, sql: str, params: tuple = ()):
        async with self._db.execute(sql, params) as cur:
            import aiosqlite as _aiosqlite
            self._db.row_factory = _aiosqlite.Row
            rows = [dict(r) for r in await cur.fetchall()]
            return _PGCursor(rows, cur.lastrowid)

    async def executemany(self, sql: str, params_list):
        await self._db.executemany(sql, params_list)

    async def executescript(self, script: str):
        await self._db.executescript(script)

    async def commit(self):
        await self._db.commit()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class _get_db_ctx:
    """
    Async context manager returned by get_db().
    Routes to Supabase PG when available, falls back to SQLite.
    """
    def __init__(self):
        self._pg_ctx = None
        self._sq_ctx = None
        self._db = None

    async def __aenter__(self):
        pool = await _get_pg_pool()
        if pool:
            conn = await pool.acquire()
            self._pg_ctx = conn
            self._pool = pool
            return _PGDb(conn)
        else:
            import aiosqlite as _aiosqlite
            from config import settings as _settings
            self._sq_ctx = await _aiosqlite.connect(_settings.db_path)
            self._sq_ctx.row_factory = _aiosqlite.Row
            return _DBCompat(self._sq_ctx)

    async def __aexit__(self, *args):
        if self._pg_ctx:
            try:
                await self._pool.release(self._pg_ctx)
            except Exception:
                pass
        if self._sq_ctx:
            try:
                await self._sq_ctx.close()
            except Exception:
                pass


def get_db() -> _get_db_ctx:
    """
    Usage:
        async with get_db() as db:
            result = await db.execute("SELECT * FROM users WHERE id=?", (uid,))
            rows = await result.fetchall()
    """
    return _get_db_ctx()


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

CREATE TABLE IF NOT EXISTS etf_portfolios_meta (
    portfolio_id        INTEGER PRIMARY KEY REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    base_currency       TEXT NOT NULL DEFAULT 'EUR',
    benchmark_ticker    TEXT DEFAULT 'VWCE',
    description         TEXT DEFAULT '',
    color               TEXT DEFAULT '#7C3AED',
    icon                TEXT DEFAULT '💼',
    is_public           BOOLEAN DEFAULT FALSE,
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id              SERIAL PRIMARY KEY,
    portfolio_id    INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    snap_date       TEXT NOT NULL,
    total_value     REAL NOT NULL DEFAULT 0,
    total_cost      REAL NOT NULL DEFAULT 0,
    total_return_pct REAL DEFAULT 0,
    today_return_pct REAL DEFAULT 0,
    num_holdings    INTEGER DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(portfolio_id, snap_date)
);

CREATE TABLE IF NOT EXISTS holding_prices (
    id          SERIAL PRIMARY KEY,
    holding_id  INTEGER NOT NULL REFERENCES etf_holdings(id) ON DELETE CASCADE,
    price_date  TEXT NOT NULL,
    price_usd   REAL NOT NULL DEFAULT 0,
    price_eur   REAL NOT NULL DEFAULT 0,
    value_eur   REAL NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(holding_id, price_date)
);

CREATE TABLE IF NOT EXISTS trade_ideas (
    id                  SERIAL PRIMARY KEY,
    event_id            TEXT NOT NULL DEFAULT '',
    event_title         TEXT NOT NULL DEFAULT '',
    event_category      TEXT NOT NULL DEFAULT '',
    event_severity      REAL NOT NULL DEFAULT 5,
    ticker              TEXT NOT NULL,
    asset_name          TEXT NOT NULL DEFAULT '',
    direction           TEXT NOT NULL DEFAULT 'LONG',
    entry_low           REAL,
    entry_high          REAL,
    target_pct          REAL,
    stop_pct            REAL,
    timeframe           TEXT NOT NULL DEFAULT '5-15 days',
    confidence          REAL NOT NULL DEFAULT 0.5,
    opp_score           INTEGER NOT NULL DEFAULT 0,
    rationale           TEXT NOT NULL DEFAULT '',
    risks               TEXT DEFAULT '[]',
    catalysts           TEXT DEFAULT '[]',
    status              TEXT DEFAULT 'active',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    expires_at          TIMESTAMPTZ,
    price_at_generation REAL,
    price_current       REAL,
    pnl_pct             REAL,
    max_favorable_pct   REAL,
    tracked_at          TIMESTAMPTZ,
    outcome_note        TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id              SERIAL PRIMARY KEY,
    ticker          TEXT NOT NULL,
    asset_name      TEXT NOT NULL DEFAULT '',
    alert_type      TEXT NOT NULL,
    severity        TEXT NOT NULL DEFAULT 'medium',
    title           TEXT NOT NULL,
    detail          TEXT NOT NULL DEFAULT '',
    current_val     REAL,
    reference_val   REAL,
    change_pct      REAL,
    related_event_id TEXT DEFAULT '',
    acknowledged    BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opp_scores (
    event_id    TEXT PRIMARY KEY,
    score       INTEGER NOT NULL DEFAULT 0,
    scored_at   TIMESTAMPTZ DEFAULT NOW(),
    ideas_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS idea_portfolio_links (
    id              SERIAL PRIMARY KEY,
    idea_id         INTEGER NOT NULL REFERENCES trade_ideas(id) ON DELETE CASCADE,
    portfolio_id    INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    holding_id      INTEGER,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shares          REAL NOT NULL DEFAULT 0,
    entry_price     REAL NOT NULL DEFAULT 0,
    linked_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_summaries (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic       TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    entry_count INTEGER DEFAULT 0,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, topic)
);

CREATE TABLE IF NOT EXISTS brain_agent_sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT DEFAULT 'New Session',
    message_count INTEGER DEFAULT 0,
    last_template TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_agent_messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL REFERENCES brain_agent_sessions(id) ON DELETE CASCADE,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role        TEXT NOT NULL DEFAULT 'user',
    content     TEXT NOT NULL,
    template    TEXT DEFAULT '',
    sources_json TEXT DEFAULT '[]',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_agent_template_stats (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template    TEXT NOT NULL,
    uses        INTEGER DEFAULT 1,
    last_used   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, template)
);

CREATE TABLE IF NOT EXISTS events (
    id              TEXT PRIMARY KEY,
    timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    title           TEXT NOT NULL,
    summary         TEXT DEFAULT '',
    category        TEXT NOT NULL DEFAULT 'GEOPOLITICS',
    source          TEXT NOT NULL DEFAULT 'gdelt',
    latitude        REAL NOT NULL DEFAULT 0,
    longitude       REAL NOT NULL DEFAULT 0,
    country_code    TEXT DEFAULT '',
    country_name    TEXT DEFAULT '',
    severity        REAL DEFAULT 5.0,
    impact          TEXT DEFAULT 'Medium',
    url             TEXT DEFAULT '',
    source_count    INTEGER DEFAULT 1,
    heat_index      REAL DEFAULT 0,
    related_markets TEXT DEFAULT '',
    ai_summary      TEXT DEFAULT '',
    ai_impact_score REAL,
    ai_market_note  TEXT DEFAULT '',
    ai_tags         TEXT DEFAULT '',
    source_list     TEXT DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS finance_cache (
    symbol      TEXT PRIMARY KEY,
    name        TEXT DEFAULT '',
    price       REAL,
    change_pct  REAL DEFAULT 0,
    change_abs  REAL DEFAULT 0,
    history     TEXT DEFAULT '[]',
    category    TEXT DEFAULT 'index',
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS region_risk (
    country_code TEXT PRIMARY KEY,
    country_name TEXT DEFAULT '',
    risk_score   REAL DEFAULT 5.0,
    trend        TEXT DEFAULT 'Stable',
    assessment   TEXT DEFAULT '',
    event_count  INTEGER DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS macro_indicators (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    value       REAL,
    previous    REAL,
    unit        TEXT DEFAULT '',
    category    TEXT DEFAULT 'economy',
    country     TEXT DEFAULT 'Global',
    source      TEXT DEFAULT '',
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, country)
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
    ai_enhanced     BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS etf_community_posts (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_name   TEXT NOT NULL DEFAULT '',
    avatar      TEXT NOT NULL DEFAULT 'U',
    content     TEXT NOT NULL,
    likes       INTEGER DEFAULT 0,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_settings (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT,
    UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS user_models (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_type  TEXT NOT NULL,
    model_data  TEXT DEFAULT '',
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, model_type)
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

            # ── Column migrations (ADD IF NOT EXISTS) ─────────────────────────
            # etf_holdings: support both naming conventions
            col_migrations = [
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS isin TEXT DEFAULT ''",
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS shares REAL DEFAULT 0",
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS avg_price REAL DEFAULT 0",
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS current_price REAL",
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS purchase_date TEXT",
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS asset_class TEXT DEFAULT 'equity'",
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'EUR'",
                # Sync quantity ↔ shares and avg_buy_price ↔ avg_price via triggers or just alias
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS quantity REAL DEFAULT 0",
                "ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS avg_buy_price REAL DEFAULT 0",
                # etf_portfolios: add name column alias
                "ALTER TABLE etf_portfolios ADD COLUMN IF NOT EXISTS strategy TEXT DEFAULT 'custom'",
            ]
            for migration in col_migrations:
                try:
                    await conn.execute(migration)
                except Exception as e:
                    msg = str(e).lower()
                    if 'already exists' not in msg:
                        logger.debug("Column migration: %s → %s", migration[:50], e)

        if errors:
            for err in errors[:5]:
                logger.debug("Schema DDL warning: %s", err)
        logger.info("Full schema ensured on PostgreSQL (%d statements)", len(statements))
    else:
        logger.info("Supabase not available — SQLite schema managed by database.py")
