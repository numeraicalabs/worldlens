"""World Lens — Database schema v3 with user preferences"""
from __future__ import annotations
import aiosqlite
import logging
from config import settings

logger = logging.getLogger(__name__)
DB = settings.db_path


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
        """)
        await db.commit()
        logger.info("Admin migration done")
