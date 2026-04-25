"""World Lens — Database schema v3 with user preferences"""
from __future__ import annotations
import aiosqlite
import logging
from config import settings

logger = logging.getLogger(__name__)
# DB_PATH and DB are computed lazily so env vars (DB_PATH=...) are honoured
# even when the module is imported before the env is fully resolved.
# Use settings.db_path directly in new code; these aliases are kept for
# backward compatibility with existing routers.
DB_PATH = settings.db_path
DB      = settings.db_path


async def init_db():
    async with aiosqlite.connect(DB) as db:
        await db.executescript("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            username TEXT NOT NULL,
            password_hash TEXT NOT NULL,
            avatar_color TEXT DEFAULT '#3B82F6',
            bio TEXT DEFAULT '',
            timezone TEXT DEFAULT 'UTC',
            notifications_enabled INTEGER DEFAULT 1,
            -- Onboarding
            onboarding_done INTEGER DEFAULT 0,
            tutorial_done INTEGER DEFAULT 0,
            -- Preferences (JSON arrays stored as text)
            interests TEXT DEFAULT '[]',
            regions TEXT DEFAULT '[]',
            market_prefs TEXT DEFAULT '[]',
            -- Persona
            experience_level TEXT DEFAULT 'beginner',
            -- Role & access
            role TEXT DEFAULT 'user',
            is_admin INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 1,
            -- AI provider preferences (per-user API keys)
            ai_provider TEXT DEFAULT 'claude',
            user_anthropic_key TEXT DEFAULT '',
            user_gemini_key TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            last_login TEXT
        );

        CREATE TABLE IF NOT EXISTS watchlist (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL,
            value TEXT NOT NULL,
            label TEXT,
            notes TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id),
            UNIQUE(user_id, type, value)
        );

        CREATE TABLE IF NOT EXISTS alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            condition TEXT NOT NULL,
            type TEXT DEFAULT 'event',
            category TEXT DEFAULT '',
            country TEXT DEFAULT '',
            severity_threshold REAL DEFAULT 7.0,
            active INTEGER DEFAULT 1,
            triggered_count INTEGER DEFAULT 0,
            last_triggered TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS events (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            title TEXT NOT NULL,
            summary TEXT,
            category TEXT NOT NULL,
            source TEXT NOT NULL,
            latitude REAL NOT NULL,
            longitude REAL NOT NULL,
            country_code TEXT DEFAULT 'XX',
            country_name TEXT DEFAULT '',
            severity REAL DEFAULT 5.0,
            impact TEXT DEFAULT 'Medium',
            url TEXT DEFAULT '',
            ai_summary TEXT,
            ai_impact_score REAL DEFAULT 5.0,
            ai_market_note TEXT DEFAULT '',
            ai_tags TEXT DEFAULT '[]',
            related_markets TEXT DEFAULT '[]',
            sent_credibility REAL DEFAULT 0.75,
            created_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS region_risk (
            country_code TEXT PRIMARY KEY,
            country_name TEXT,
            risk_score REAL DEFAULT 5.0,
            trend TEXT DEFAULT 'Stable',
            assessment TEXT DEFAULT '',
            event_count INTEGER DEFAULT 0,
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS macro_indicators (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            value REAL,
            previous REAL,
            unit TEXT DEFAULT '',
            category TEXT DEFAULT 'economy',
            country TEXT DEFAULT 'Global',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS finance_cache (
            symbol TEXT PRIMARY KEY,
            name TEXT,
            price REAL,
            change_pct REAL,
            change_abs REAL,
            history TEXT DEFAULT '[]',
            category TEXT DEFAULT 'index',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        CREATE INDEX IF NOT EXISTS idx_ev_ts ON events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_ev_cat ON events(category);
        CREATE INDEX IF NOT EXISTS idx_ev_cc ON events(country_code);
        CREATE INDEX IF NOT EXISTS idx_ev_sev ON events(severity DESC);
        CREATE INDEX IF NOT EXISTS idx_ev_cat_sev ON events(category, severity DESC);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_macro_name ON macro_indicators(name);
        CREATE INDEX IF NOT EXISTS idx_ev_cc_ts  ON events(country_code, timestamp DESC);
        """)
        await db.commit()
        await _seed_macro(db)
    await migrate_sentiment_columns()
    await migrate_admin_columns()
    logger.info("Database v3 initialized")


async def _seed_macro(db):
    async with db.execute("SELECT COUNT(*) FROM macro_indicators") as cur:
        if (await cur.fetchone())[0] > 0:
            return
    indicators = [
        ("US GDP Growth",2.8,2.5,"% YoY","economy","US"),
        ("US Unemployment",3.9,4.1,"%","economy","US"),
        ("US CPI Inflation",3.2,3.5,"% YoY","economy","US"),
        ("Fed Funds Rate",5.25,5.50,"%","rates","US"),
        ("ECB Rate",4.50,4.75,"%","rates","EU"),
        ("UK Base Rate",5.25,5.50,"%","rates","UK"),
        ("China GDP Growth",4.9,5.0,"% YoY","economy","CN"),
        ("Euro Area CPI",2.9,3.1,"% YoY","economy","EU"),
        ("Japan CPI",2.6,2.8,"% YoY","economy","JP"),
        ("Global PMI",51.4,50.8,"index","activity","Global"),
        ("US 10Y Yield",4.28,4.15,"%","rates","US"),
        ("VIX Index",18.5,22.1,"pts","risk","Global"),
        ("WTI Oil",78.5,82.0,"$/bbl","energy","Global"),
        ("Gold Spot",2340.0,2180.0,"$/oz","commodities","Global"),
        ("USD Index",104.2,101.8,"pts","forex","Global"),
        ("Baltic Dry Index",1820,1650,"pts","trade","Global"),
    ]
    await db.executemany(
        "INSERT OR IGNORE INTO macro_indicators (name,value,previous,unit,category,country) VALUES (?,?,?,?,?,?)",
        indicators
    )
    await db.commit()


async def get_db():
    async with aiosqlite.connect(DB) as db:
        db.row_factory = aiosqlite.Row
        yield db


async def migrate_sentiment_columns():
    """Add all advanced intelligence columns to events table if not present."""
    async with aiosqlite.connect(DB) as db:
        async with db.execute("PRAGMA table_info(events)") as cur:
            cols = {row[1] for row in await cur.fetchall()}

        new_cols = {
            # Sentiment (basic)
            "sentiment_score":       "REAL DEFAULT 0.0",
            "sentiment_tone":        "TEXT DEFAULT ''",
            "sentiment_intensity":   "TEXT DEFAULT ''",
            "sentiment_info_type":   "TEXT DEFAULT ''",
            "sentiment_entities":    "TEXT DEFAULT '[]'",
            "show_impact_cache":     "TEXT DEFAULT ''",
            # Multi-dimensional sentiment (advanced)
            "sent_uncertainty":      "REAL DEFAULT 0.0",   # 0-1: how uncertain/volatile the language is
            "sent_market_stress":    "REAL DEFAULT 0.0",   # 0-1: financial stress signals
            "sent_narrative_momentum": "REAL DEFAULT 0.0", # -1..1: growing vs fading story
            "sent_credibility":      "REAL DEFAULT 0.5",   # 0-1: source credibility score
            # Entity / NER cache
            "ner_entities":          "TEXT DEFAULT '[]'",  # [{text,type,salience}]
            # Event relationships
            "related_event_ids":     "TEXT DEFAULT '[]'",  # [event_id, ...]
            "relationship_types":    "TEXT DEFAULT '[]'",  # [{id,type,weight}]
            "causal_chain":          "TEXT DEFAULT '[]'",  # upstream event ids
            # Market impact structured cache
            "market_impact_cache":   "TEXT DEFAULT ''",    # full JSON from ai_show_impact
            # Dedup / source tracking
            "source_count":          "INTEGER DEFAULT 1",
            "sent_credibility":      "REAL DEFAULT 0.75",  # source credibility
            "source_list":           "TEXT DEFAULT '[]'",
            # Narrative / topic embedding fingerprint (compressed)
            "topic_vector":          "TEXT DEFAULT ''",    # JSON array of 8 floats (topic fingerprint)
            "narrative_cluster":     "INTEGER DEFAULT -1", # cluster id (-1 = unassigned)
            # Timeline Graph fields
            "sentiment_tone":        "TEXT DEFAULT 'neutral'",
            "keywords":              "TEXT DEFAULT '[]'",
            "narrative_id":          "TEXT DEFAULT ''",
            "timeline_band":         "TEXT DEFAULT 'geopolitical'",
            "heat_index":            "REAL DEFAULT 0.0",
            "market_impact":         "REAL DEFAULT 0.0",
        }
        for col, typedef in new_cols.items():
            if col not in cols:
                await db.execute(f"ALTER TABLE events ADD COLUMN {col} {typedef}")
                logger.info("Added column: %s", col)

        # Event relationships table (knowledge graph edges)
        await db.executescript("""
        CREATE TABLE IF NOT EXISTS event_relationships (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id   TEXT NOT NULL,
            target_id   TEXT NOT NULL,
            rel_type    TEXT NOT NULL,
            weight      REAL DEFAULT 0.5,
            direction   TEXT DEFAULT 'forward',
            confidence  REAL DEFAULT 0.5,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (source_id) REFERENCES events(id),
            FOREIGN KEY (target_id) REFERENCES events(id),
            UNIQUE(source_id, target_id, rel_type)
        );
        CREATE INDEX IF NOT EXISTS idx_rel_source ON event_relationships(source_id);
        CREATE INDEX IF NOT EXISTS idx_rel_target ON event_relationships(target_id);

        CREATE TABLE IF NOT EXISTS narrative_clusters (
            cluster_id   INTEGER PRIMARY KEY,
            label        TEXT NOT NULL,
            centroid     TEXT DEFAULT '[]',
            event_count  INTEGER DEFAULT 0,
            avg_severity REAL DEFAULT 5.0,
            top_category TEXT DEFAULT '',
            top_countries TEXT DEFAULT '[]',
            created_at   TEXT DEFAULT (datetime('now')),
            updated_at   TEXT DEFAULT (datetime('now'))
        );
        """)
        await db.commit()


async def migrate_admin_columns():
    """Add admin/role/ai-provider columns to users table if not present."""
    async with aiosqlite.connect(DB) as db:
        async with db.execute("PRAGMA table_info(users)") as cur:
            cols = {row[1] for row in await cur.fetchall()}

        new_cols = {
            "role":               "TEXT DEFAULT 'user'",
            "is_admin":           "INTEGER DEFAULT 0",
            "is_active":          "INTEGER DEFAULT 1",
            "ai_provider":        "TEXT DEFAULT 'claude'",
            "user_anthropic_key": "TEXT DEFAULT ''",
            "user_gemini_key":    "TEXT DEFAULT ''",
            "severity_threshold": "REAL DEFAULT 4.5",
            "affinity_vector":    "TEXT DEFAULT '{}'",
        }
        for col, typedef in new_cols.items():
            if col not in cols:
                await db.execute(f"ALTER TABLE users ADD COLUMN {col} {typedef}")
                logger.info("Added column: %s", col)

        # Activity log table
        await db.executescript("""
        CREATE TABLE IF NOT EXISTS activity_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            section TEXT DEFAULT '',
            detail TEXT DEFAULT '',
            ip TEXT DEFAULT '',
            created_at TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_act_user ON activity_log(user_id);
        CREATE INDEX IF NOT EXISTS idx_act_ts   ON activity_log(created_at DESC);

        CREATE TABLE IF NOT EXISTS app_settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS saved_events (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            event_id   TEXT    NOT NULL,
            note       TEXT    DEFAULT '',
            created_at TEXT    DEFAULT (datetime('now')),
            UNIQUE(user_id, event_id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_events(user_id);

        CREATE TABLE IF NOT EXISTS ai_feedback (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id    INTEGER NOT NULL,
            question   TEXT    NOT NULL,
            answer     TEXT    NOT NULL,
            context    TEXT    DEFAULT '',
            rating     INTEGER NOT NULL,  -- +1 thumbs up, -1 thumbs down
            created_at TEXT    DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_aifb_user ON ai_feedback(user_id);
        CREATE INDEX IF NOT EXISTS idx_aifb_rating ON ai_feedback(rating);

        CREATE TABLE IF NOT EXISTS user_models (
            user_id    INTEGER NOT NULL,
            model_type TEXT    NOT NULL,  -- 'tfidf_vector', 'alert_filter'
            model_data TEXT    DEFAULT '',  -- JSON or base64 pickle
            updated_at TEXT    DEFAULT (datetime('now')),
            PRIMARY KEY (user_id, model_type),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );



        CREATE TABLE IF NOT EXISTS agent_configs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            bot_id TEXT NOT NULL,
            config_json TEXT DEFAULT '{}',
            updated_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, bot_id)
        );

        CREATE TABLE IF NOT EXISTS agent_brief_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            bot_id TEXT NOT NULL,
            brief_json TEXT NOT NULL,
            signal TEXT DEFAULT 'neutral',
            event_count INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_abh_user_bot
            ON agent_brief_history(user_id, bot_id, created_at DESC);

        -- Streak: one row per user, updated daily
        CREATE TABLE IF NOT EXISTS agent_streaks (
            user_id INTEGER PRIMARY KEY,
            current_streak INTEGER DEFAULT 0,
            longest_streak INTEGER DEFAULT 0,
            last_activity_date TEXT DEFAULT '',
            total_reads INTEGER DEFAULT 0,
            streak_frozen INTEGER DEFAULT 0,
            freeze_used_date TEXT DEFAULT '',
            updated_at TEXT DEFAULT (datetime('now'))
        );

        -- Bot predictions (Friday forecast + Monday verify)
        CREATE TABLE IF NOT EXISTS agent_predictions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            bot_id TEXT NOT NULL,
            week_key TEXT NOT NULL,          -- e.g. "2026-W14"
            prediction_json TEXT NOT NULL,   -- {headline, direction, confidence, key_topics}
            prediction_ts TEXT DEFAULT (datetime('now')),
            verify_json TEXT DEFAULT NULL,   -- filled on Monday
            verify_ts TEXT DEFAULT NULL,
            accuracy_score REAL DEFAULT NULL,-- 0.0-1.0
            UNIQUE(user_id, bot_id, week_key)
        );
        CREATE INDEX IF NOT EXISTS idx_ap_user ON agent_predictions(user_id, week_key);

        -- Daily digest log (prevent duplicate sends)
        CREATE TABLE IF NOT EXISTS agent_digest_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            bot_id TEXT NOT NULL,
            digest_date TEXT NOT NULL,       -- YYYY-MM-DD
            sent_at TEXT DEFAULT (datetime('now')),
            UNIQUE(user_id, bot_id, digest_date)
        );

        CREATE TABLE IF NOT EXISTS invites (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            code        TEXT UNIQUE NOT NULL,
            label       TEXT DEFAULT '',
            email_hint  TEXT DEFAULT '',
            created_by  INTEGER,
            used_by     INTEGER,
            used_at     TEXT,
            max_uses    INTEGER DEFAULT 1,
            use_count   INTEGER DEFAULT 0,
            expires_at  TEXT,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (created_by) REFERENCES users(id),
            FOREIGN KEY (used_by)    REFERENCES users(id)
        );
        CREATE INDEX IF NOT EXISTS idx_invite_code ON invites(code);

        -- ── ETF Tracker tables ──────────────────────────────────────────────
        CREATE TABLE IF NOT EXISTS etf_portfolios (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            name        TEXT NOT NULL DEFAULT 'Portafoglio Principale',
            strategy    TEXT DEFAULT 'custom',
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS etf_holdings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            portfolio_id INTEGER NOT NULL,
            isin        TEXT NOT NULL,
            ticker      TEXT NOT NULL,
            name        TEXT NOT NULL,
            shares      REAL NOT NULL DEFAULT 0,
            avg_price   REAL NOT NULL DEFAULT 0,
            current_price REAL,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (portfolio_id) REFERENCES etf_portfolios(id)
        );

        CREATE TABLE IF NOT EXISTS etf_alerts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            etf_isin    TEXT NOT NULL,
            etf_ticker  TEXT NOT NULL,
            alert_type  TEXT NOT NULL DEFAULT 'below',
            threshold   REAL NOT NULL,
            current_price REAL,
            channels    TEXT DEFAULT '["email","push"]',
            active      INTEGER DEFAULT 1,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS etf_settings (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            key         TEXT NOT NULL,
            value       TEXT,
            UNIQUE(user_id, key),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS etf_reports (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            format      TEXT NOT NULL DEFAULT 'pdf',
            type        TEXT NOT NULL DEFAULT 'portfolio_summary',
            filepath    TEXT,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE TABLE IF NOT EXISTS etf_community_posts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id     INTEGER NOT NULL,
            user_name   TEXT NOT NULL,
            avatar      TEXT NOT NULL DEFAULT 'U',
            content     TEXT NOT NULL,
            likes       INTEGER DEFAULT 0,
            comments    INTEGER DEFAULT 0,
            portfolio_snapshot TEXT,
            created_at  TEXT DEFAULT (datetime('now')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        );

        CREATE INDEX IF NOT EXISTS idx_etf_port_user  ON etf_portfolios(user_id);
        CREATE INDEX IF NOT EXISTS idx_etf_hold_port  ON etf_holdings(portfolio_id);
        CREATE INDEX IF NOT EXISTS idx_etf_alert_user ON etf_alerts(user_id);
        CREATE INDEX IF NOT EXISTS idx_etf_post_date  ON etf_community_posts(created_at DESC);
        """)
        await db.commit()
        logger.info("Admin migration + ETF Tracker tables done")
