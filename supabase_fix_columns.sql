-- WorldLens — Fix colonne mancanti
-- Eseguire nel SQL Editor di Supabase
-- Tutte le ALTER TABLE usano IF NOT EXISTS: sicure da eseguire più volte

-- brain_agent_sessions
ALTER TABLE brain_agent_sessions ADD COLUMN IF NOT EXISTS session_date   TEXT DEFAULT '';
ALTER TABLE brain_agent_sessions ADD COLUMN IF NOT EXISTS message_count  INTEGER DEFAULT 0;
ALTER TABLE brain_agent_sessions ADD COLUMN IF NOT EXISTS last_active    TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE brain_agent_sessions ADD COLUMN IF NOT EXISTS tokens_used    INTEGER DEFAULT 0;

-- users
ALTER TABLE users ADD COLUMN IF NOT EXISTS affinity_vector  TEXT DEFAULT '[]';
ALTER TABLE users ADD COLUMN IF NOT EXISTS risk_profile     TEXT DEFAULT 'moderate';
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_done  SMALLINT DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active      TIMESTAMPTZ DEFAULT NOW();

-- events (colonne opzionali avanzate)
ALTER TABLE events ADD COLUMN IF NOT EXISTS sentiment_score  REAL DEFAULT 0;
ALTER TABLE events ADD COLUMN IF NOT EXISTS sentiment_tone   TEXT DEFAULT 'neutral';
ALTER TABLE events ADD COLUMN IF NOT EXISTS topic_vector     TEXT DEFAULT '[]';
ALTER TABLE events ADD COLUMN IF NOT EXISTS narrative_id     TEXT DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS market_impact    REAL DEFAULT 0;

-- brain_entries
ALTER TABLE brain_entries ADD COLUMN IF NOT EXISTS source_event_id  TEXT DEFAULT '';
ALTER TABLE brain_entries ADD COLUMN IF NOT EXISTS confidence        REAL DEFAULT 0.7;
ALTER TABLE brain_entries ADD COLUMN IF NOT EXISTS last_updated      TIMESTAMPTZ DEFAULT NOW();

-- daily_insights (crea tabella se non esiste)
CREATE TABLE IF NOT EXISTS daily_insights (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER,
    date        TEXT NOT NULL,
    insight     TEXT DEFAULT '',
    insight_type    TEXT DEFAULT 'general',
    market_context  TEXT DEFAULT '',
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Indici utili per performance
CREATE INDEX IF NOT EXISTS idx_brain_sessions_user ON brain_agent_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_brain_sessions_date ON brain_agent_sessions (session_date);
CREATE INDEX IF NOT EXISTS idx_daily_insights_user ON daily_insights (user_id, date);

-- Verifica
SELECT table_name, COUNT(*) as column_count
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('events','users','brain_agent_sessions','brain_entries','daily_insights')
GROUP BY table_name
ORDER BY table_name;

-- brain_sessions: add session_date if missing (TEXT not TIMESTAMPTZ)
ALTER TABLE brain_sessions ADD COLUMN IF NOT EXISTS session_date TEXT DEFAULT '';
ALTER TABLE brain_sessions ADD COLUMN IF NOT EXISTS interactions INTEGER DEFAULT 0;
ALTER TABLE brain_sessions ADD COLUMN IF NOT EXISTS entries_added INTEGER DEFAULT 0;
ALTER TABLE brain_sessions ADD COLUMN IF NOT EXISTS topics_touched TEXT DEFAULT '[]';

-- Add unique constraint if not exists (may fail if already exists - ignore)
DO $$ BEGIN
  ALTER TABLE brain_sessions ADD CONSTRAINT brain_sessions_user_date_unique UNIQUE (user_id, session_date);
EXCEPTION WHEN duplicate_table OR duplicate_object THEN NULL;
END $$;

-- ew_snapshots: fix created_at column type
ALTER TABLE ew_snapshots ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ;

-- crisis_signals and supply_chain_risks: fix created_at  
ALTER TABLE crisis_signals    ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ;
ALTER TABLE crisis_signals    ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ;
ALTER TABLE supply_chain_risks ALTER COLUMN created_at TYPE TIMESTAMPTZ USING created_at::TIMESTAMPTZ;
ALTER TABLE supply_chain_risks ALTER COLUMN updated_at TYPE TIMESTAMPTZ USING updated_at::TIMESTAMPTZ;

-- global_cache table (create if not exists)
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
    ai_enhanced     SMALLINT NOT NULL DEFAULT 0
);

-- macro_indicators table (create if not exists)  
CREATE TABLE IF NOT EXISTS macro_indicators (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    value       REAL,
    previous    REAL,
    unit        TEXT DEFAULT '',
    country     TEXT DEFAULT 'Global',
    category    TEXT DEFAULT 'macro',
    trend       TEXT DEFAULT 'stable',
    source      TEXT DEFAULT 'auto',
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, country)
);
CREATE INDEX IF NOT EXISTS idx_macro_country ON macro_indicators(country);
CREATE INDEX IF NOT EXISTS idx_macro_updated ON macro_indicators(updated_at DESC);

-- activity_log: add missing columns
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS section TEXT DEFAULT '';
ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS detail  TEXT DEFAULT '';

-- saved_events table
CREATE TABLE IF NOT EXISTS saved_events (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    event_id   TEXT NOT NULL,
    note       TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_id)
);

-- ai_feedback table
CREATE TABLE IF NOT EXISTS ai_feedback (
    id         SERIAL PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    context    TEXT DEFAULT '',
    rating     INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- app_settings table
CREATE TABLE IF NOT EXISTS app_settings (
    key        TEXT PRIMARY KEY,
    value      TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Verifica finale
SELECT table_name, COUNT(*) as cols
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('global_cache','macro_indicators','activity_log',
                     'saved_events','ai_feedback','app_settings')
GROUP BY table_name ORDER BY table_name;

-- etf_portfolios: add missing columns for Finance Hub
ALTER TABLE etf_portfolios ADD COLUMN IF NOT EXISTS base_currency     TEXT DEFAULT 'EUR';
ALTER TABLE etf_portfolios ADD COLUMN IF NOT EXISTS benchmark_ticker  TEXT DEFAULT 'VWCE';
ALTER TABLE etf_portfolios ADD COLUMN IF NOT EXISTS icon              TEXT DEFAULT '💼';

-- etf_holdings: add missing columns
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS currency      TEXT DEFAULT 'EUR';
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS asset_class   TEXT DEFAULT 'equity';
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS purchase_date TEXT;

-- etf_portfolios_meta: ensure total_cost column
ALTER TABLE etf_portfolios_meta ADD COLUMN IF NOT EXISTS total_cost REAL DEFAULT 0;

-- Fix AUTOINCREMENT -> SERIAL (se le tabelle sono state create con SQLite schema)
-- (sicuro solo se le tabelle non esistono ancora in Supabase)
CREATE TABLE IF NOT EXISTS etf_portfolios (
    id               SERIAL PRIMARY KEY,
    user_id          INTEGER NOT NULL,
    name             TEXT NOT NULL DEFAULT 'Portafoglio Principale',
    strategy         TEXT DEFAULT 'custom',
    base_currency    TEXT DEFAULT 'EUR',
    benchmark_ticker TEXT DEFAULT 'VWCE',
    icon             TEXT DEFAULT '💼',
    created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_holdings (
    id             SERIAL PRIMARY KEY,
    portfolio_id   INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    isin           TEXT DEFAULT '',
    ticker         TEXT NOT NULL,
    name           TEXT NOT NULL,
    shares         REAL NOT NULL DEFAULT 0,
    avg_price      REAL NOT NULL DEFAULT 0,
    current_price  REAL,
    currency       TEXT DEFAULT 'EUR',
    asset_class    TEXT DEFAULT 'equity',
    purchase_date  TEXT,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_portfolios_meta (
    id             SERIAL PRIMARY KEY,
    portfolio_id   INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    snapshot_date  TEXT NOT NULL,
    total_value    REAL DEFAULT 0,
    total_cost     REAL DEFAULT 0,
    created_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(portfolio_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_etf_portfolios_user ON etf_portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_etf_holdings_portfolio ON etf_holdings(portfolio_id);

-- portfolio_snapshots table (used by finance_hub for historical metrics)
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id               SERIAL PRIMARY KEY,
    portfolio_id     INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    snap_date        TEXT NOT NULL,
    total_value      REAL DEFAULT 0,
    total_cost       REAL DEFAULT 0,
    total_return_pct REAL DEFAULT 0,
    day_return_pct   REAL DEFAULT 0,
    sharpe_ratio     REAL,
    volatility_pct   REAL,
    max_drawdown_pct REAL,
    geo_risk_score   REAL DEFAULT 0,
    currency         TEXT DEFAULT 'EUR',
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(portfolio_id, snap_date)
);

-- etf_portfolios_meta: aggiorna con tutte le colonne necessarie
CREATE TABLE IF NOT EXISTS etf_portfolios_meta (
    portfolio_id     INTEGER PRIMARY KEY REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    base_currency    TEXT NOT NULL DEFAULT 'EUR',
    benchmark_ticker TEXT DEFAULT 'VWCE',
    description      TEXT DEFAULT '',
    color            TEXT DEFAULT '#7C3AED',
    icon             TEXT DEFAULT '💼',
    is_public        SMALLINT DEFAULT 0,
    updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_portfolio ON portfolio_snapshots(portfolio_id, snap_date DESC);

-- Opportunity Engine tables
CREATE TABLE IF NOT EXISTS trade_ideas (
    id          SERIAL PRIMARY KEY,
    event_id    TEXT NOT NULL DEFAULT '',
    event_title TEXT DEFAULT '',
    event_category TEXT DEFAULT '',
    event_severity REAL DEFAULT 5,
    ticker      TEXT NOT NULL,
    asset_name  TEXT NOT NULL,
    direction   TEXT NOT NULL,
    entry_low   REAL, entry_high REAL,
    target_pct  REAL, stop_pct REAL,
    timeframe   TEXT NOT NULL DEFAULT '3-10 days',
    confidence  REAL NOT NULL DEFAULT 0.6,
    opp_score   INTEGER NOT NULL DEFAULT 50,
    rationale   TEXT NOT NULL DEFAULT '',
    risks       TEXT DEFAULT '[]',
    catalysts   TEXT DEFAULT '[]',
    status      TEXT DEFAULT 'active',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    expires_at  TEXT,
    price_at_generation REAL, price_current REAL,
    pnl_pct REAL, max_favorable_pct REAL,
    tracked_at TEXT, outcome_note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id           SERIAL PRIMARY KEY,
    ticker       TEXT NOT NULL,
    asset_name   TEXT NOT NULL,
    alert_type   TEXT NOT NULL,
    severity     TEXT NOT NULL,
    title        TEXT NOT NULL,
    detail       TEXT NOT NULL,
    current_val  REAL, reference_val REAL, change_pct REAL,
    related_event_id TEXT DEFAULT '',
    acknowledged SMALLINT DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opp_scores (
    event_id    TEXT PRIMARY KEY,
    score       INTEGER NOT NULL,
    scored_at   TIMESTAMPTZ DEFAULT NOW(),
    ideas_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ti_event   ON trade_ideas(event_id);
CREATE INDEX IF NOT EXISTS idx_ti_status  ON trade_ideas(status);
CREATE INDEX IF NOT EXISTS idx_ti_created ON trade_ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aa_created ON anomaly_alerts(created_at DESC);

-- Fix ai_enhanced in global_cache: ensure it's BOOLEAN (asyncpg strict typing)
ALTER TABLE global_cache ALTER COLUMN ai_enhanced TYPE BOOLEAN USING ai_enhanced::boolean;
ALTER TABLE global_cache ALTER COLUMN ai_enhanced SET DEFAULT FALSE;
