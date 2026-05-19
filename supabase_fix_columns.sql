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
