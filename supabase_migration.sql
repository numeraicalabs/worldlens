-- ============================================================
-- WorldLens — Supabase Migration Completa
-- Esegui questo script UNA VOLTA nel SQL Editor di Supabase
-- Dashboard → SQL Editor → New query → incolla → Run
-- ============================================================

-- ── 1. EVENTS (dati real-time: effimeri, si rigenerano) ──────────────────────
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
    image_url       TEXT DEFAULT '',
    source_count    INTEGER DEFAULT 1,
    heat_index      REAL DEFAULT 0,
    keywords        TEXT DEFAULT '',
    ner_entities    TEXT DEFAULT '{}',
    related_markets TEXT DEFAULT '',
    ai_summary      TEXT DEFAULT '',
    ai_impact_score REAL,
    ai_market_note  TEXT DEFAULT '',
    ai_tags         TEXT DEFAULT '',
    source_list     TEXT DEFAULT '[]',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_cat  ON events(category);
CREATE INDEX IF NOT EXISTS idx_events_sev  ON events(severity DESC);

-- ── 2. REGION RISK ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS region_risk (
    country_code TEXT PRIMARY KEY,
    country_name TEXT DEFAULT '',
    risk_score   REAL DEFAULT 5.0,
    trend        TEXT DEFAULT 'Stable',
    assessment   TEXT DEFAULT '',
    event_count  INTEGER DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. MACRO INDICATORS ──────────────────────────────────────────────────────
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

-- ── 4. FINANCE CACHE (prezzi real-time: si rigenera) ─────────────────────────
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

-- ── 5. FX RATES ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fx_rates (
    pair        TEXT PRIMARY KEY,
    rate        REAL NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. PORTFOLIO TABLES (DATI UTENTE CRITICI) ────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_ps_pid ON portfolio_snapshots(portfolio_id, snap_date DESC);

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
CREATE INDEX IF NOT EXISTS idx_hp_hid ON holding_prices(holding_id, price_date DESC);

-- Fix etf_holdings schema (add missing columns if not present)
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS isin TEXT DEFAULT '';
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS shares REAL DEFAULT 0;
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS avg_price REAL DEFAULT 0;
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS current_price REAL;
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS purchase_date TEXT;
-- Alias columns (some code uses quantity/avg_buy_price, other uses shares/avg_price)
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS quantity REAL DEFAULT 0;
ALTER TABLE etf_holdings ADD COLUMN IF NOT EXISTS avg_buy_price REAL DEFAULT 0;

CREATE TABLE IF NOT EXISTS etf_settings (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key         TEXT NOT NULL,
    value       TEXT,
    UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS etf_reports (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    format      TEXT NOT NULL DEFAULT 'pdf',
    type        TEXT NOT NULL DEFAULT 'portfolio_summary',
    filepath    TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW()
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

-- ── 7. OPPORTUNITY ENGINE ────────────────────────────────────────────────────
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
CREATE INDEX IF NOT EXISTS idx_ti_event   ON trade_ideas(event_id);
CREATE INDEX IF NOT EXISTS idx_ti_status  ON trade_ideas(status);
CREATE INDEX IF NOT EXISTS idx_ti_created ON trade_ideas(created_at DESC);

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
CREATE INDEX IF NOT EXISTS idx_aa_type    ON anomaly_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_aa_created ON anomaly_alerts(created_at DESC);

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

-- ── 8. BRAIN / AI ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brain_summaries (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic       TEXT NOT NULL,
    summary     TEXT NOT NULL DEFAULT '',
    entry_count INTEGER DEFAULT 0,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, topic)
);

CREATE TABLE IF NOT EXISTS brain_digest_items (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    content     TEXT NOT NULL,
    source      TEXT DEFAULT '',
    relevance   REAL DEFAULT 0.5,
    read        BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW()
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
CREATE INDEX IF NOT EXISTS idx_agent_sess_user ON brain_agent_sessions(user_id);

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
CREATE INDEX IF NOT EXISTS idx_agent_msg_sess  ON brain_agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_msg_user  ON brain_agent_messages(user_id);

CREATE TABLE IF NOT EXISTS brain_agent_template_stats (
    id          SERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template    TEXT NOT NULL,
    uses        INTEGER DEFAULT 1,
    last_used   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, template)
);

-- ── 9. INTELLIGENCE / EVENTS METADATA ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_relationships (
    id          SERIAL PRIMARY KEY,
    source_id   TEXT NOT NULL,
    target_id   TEXT NOT NULL,
    rel_type    TEXT NOT NULL DEFAULT 'related',
    weight      REAL DEFAULT 0.5,
    direction   TEXT DEFAULT 'bidirectional',
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_id, target_id, rel_type)
);

CREATE TABLE IF NOT EXISTS narrative_clusters (
    cluster_id   INTEGER PRIMARY KEY,
    label        TEXT NOT NULL,
    centroid     TEXT DEFAULT '[]',
    event_count  INTEGER DEFAULT 0,
    avg_severity REAL DEFAULT 5.0,
    top_category TEXT DEFAULT '',
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── 10. USER DATA ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_models (
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_type  TEXT NOT NULL,
    model_data  TEXT DEFAULT '',
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, model_type)
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

-- ── 11. INDEXES AGGIUNTIVI ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_watchlist_user  ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user     ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_brain_user_ts   ON brain_entries(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_eport_user      ON etf_portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_eholdings_port  ON etf_holdings(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_ti_ticker       ON trade_ideas(ticker);
