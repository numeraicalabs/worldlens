-- ============================================================
-- WorldLens — Supabase Migration v2 (ordine corretto)
-- Esegui nel SQL Editor: Dashboard → SQL Editor → New query
-- ============================================================

-- ── 1. TABELLE BASE ──────────────────────────────────────────

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

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY,
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    title TEXT NOT NULL,
    summary TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'GEOPOLITICS',
    source TEXT NOT NULL DEFAULT 'gdelt',
    latitude REAL NOT NULL DEFAULT 0,
    longitude REAL NOT NULL DEFAULT 0,
    country_code TEXT DEFAULT '',
    country_name TEXT DEFAULT '',
    severity REAL DEFAULT 5.0,
    impact TEXT DEFAULT 'Medium',
    url TEXT DEFAULT '',
    source_count INTEGER DEFAULT 1,
    heat_index REAL DEFAULT 0,
    related_markets TEXT DEFAULT '',
    ai_summary TEXT DEFAULT '',
    ai_impact_score REAL,
    ai_market_note TEXT DEFAULT '',
    ai_tags TEXT DEFAULT '',
    source_list TEXT DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS region_risk (
    country_code TEXT PRIMARY KEY,
    country_name TEXT DEFAULT '',
    risk_score REAL DEFAULT 5.0,
    trend TEXT DEFAULT 'Stable',
    assessment TEXT DEFAULT '',
    event_count INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS macro_indicators (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    value REAL,
    previous REAL,
    unit TEXT DEFAULT '',
    category TEXT DEFAULT 'economy',
    country TEXT DEFAULT 'Global',
    source TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(name, country)
);

CREATE TABLE IF NOT EXISTS finance_cache (
    symbol TEXT PRIMARY KEY,
    name TEXT DEFAULT '',
    price REAL,
    change_pct REAL DEFAULT 0,
    change_abs REAL DEFAULT 0,
    history TEXT DEFAULT '[]',
    category TEXT DEFAULT 'index',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fx_rates (
    pair TEXT PRIMARY KEY,
    rate REAL NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS global_cache (
    id SERIAL PRIMARY KEY,
    cache_date TEXT NOT NULL UNIQUE,
    global_brief TEXT NOT NULL DEFAULT '',
    macro_narrative TEXT NOT NULL DEFAULT '[]',
    ew_assessment TEXT NOT NULL DEFAULT '',
    top_events TEXT NOT NULL DEFAULT '[]',
    kg_connections TEXT NOT NULL DEFAULT '[]',
    market_snapshot TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    ai_enhanced BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS narrative_clusters (
    cluster_id INTEGER PRIMARY KEY,
    label TEXT NOT NULL,
    centroid TEXT DEFAULT '[]',
    event_count INTEGER DEFAULT 0,
    avg_severity REAL DEFAULT 5.0,
    top_category TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kg_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kg_nodes (
    id BIGSERIAL PRIMARY KEY,
    label TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'concept',
    aliases TEXT[] DEFAULT '{}',
    description TEXT DEFAULT '',
    confidence REAL DEFAULT 1.0,
    source_count INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT kg_nodes_label_type_unique UNIQUE (label, type)
);

CREATE TABLE IF NOT EXISTS trade_ideas (
    id SERIAL PRIMARY KEY,
    event_id TEXT NOT NULL DEFAULT '',
    event_title TEXT NOT NULL DEFAULT '',
    event_category TEXT NOT NULL DEFAULT '',
    event_severity REAL NOT NULL DEFAULT 5,
    ticker TEXT NOT NULL,
    asset_name TEXT NOT NULL DEFAULT '',
    direction TEXT NOT NULL DEFAULT 'LONG',
    entry_low REAL,
    entry_high REAL,
    target_pct REAL,
    stop_pct REAL,
    timeframe TEXT NOT NULL DEFAULT '5-15 days',
    confidence REAL NOT NULL DEFAULT 0.5,
    opp_score INTEGER NOT NULL DEFAULT 0,
    rationale TEXT NOT NULL DEFAULT '',
    risks TEXT DEFAULT '[]',
    catalysts TEXT DEFAULT '[]',
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    price_at_generation REAL,
    price_current REAL,
    pnl_pct REAL,
    max_favorable_pct REAL,
    tracked_at TIMESTAMPTZ,
    outcome_note TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id SERIAL PRIMARY KEY,
    ticker TEXT NOT NULL,
    asset_name TEXT NOT NULL DEFAULT '',
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'medium',
    title TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    current_val REAL,
    reference_val REAL,
    change_pct REAL,
    related_event_id TEXT DEFAULT '',
    acknowledged BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS opp_scores (
    event_id TEXT PRIMARY KEY,
    score INTEGER NOT NULL DEFAULT 0,
    scored_at TIMESTAMPTZ DEFAULT NOW(),
    ideas_count INTEGER DEFAULT 0
);

-- ── 2. TABELLE CHE DIPENDONO DA users ──────────────────────

CREATE TABLE IF NOT EXISTS watchlist (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    label TEXT,
    notes TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, type, value)
);

CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    condition TEXT NOT NULL,
    type TEXT DEFAULT 'event',
    category TEXT DEFAULT '',
    country TEXT DEFAULT '',
    severity_threshold REAL DEFAULT 7.0,
    active INTEGER DEFAULT 1,
    triggered_count INTEGER DEFAULT 0,
    last_triggered TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    label TEXT DEFAULT '',
    email_hint TEXT DEFAULT '',
    created_by INTEGER REFERENCES users(id),
    used_by INTEGER REFERENCES users(id),
    used_at TIMESTAMPTZ,
    max_uses INTEGER DEFAULT 1,
    use_count INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_entries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    topic TEXT DEFAULT '',
    weight REAL DEFAULT 1.0,
    context TEXT DEFAULT '{}',
    timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_digests (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL DEFAULT 1,
    date TEXT NOT NULL,
    content TEXT NOT NULL,
    ai_enhanced INTEGER NOT NULL DEFAULT 0,
    read INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS brain_summaries (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    entry_count INTEGER DEFAULT 0,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, topic)
);

CREATE TABLE IF NOT EXISTS daily_insights (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    insight TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS saved_events (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    event_id TEXT NOT NULL,
    note TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, event_id)
);

CREATE TABLE IF NOT EXISTS ai_feedback (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    context TEXT DEFAULT '',
    rating INTEGER NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    section TEXT DEFAULT '',
    detail TEXT DEFAULT '',
    ip TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_configs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL,
    config_json TEXT DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, bot_id)
);

CREATE TABLE IF NOT EXISTS agent_brief_history (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL,
    brief_json TEXT NOT NULL,
    signal TEXT DEFAULT 'neutral',
    event_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_streaks (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_activity_date TEXT DEFAULT '',
    total_reads INTEGER DEFAULT 0,
    streak_frozen INTEGER DEFAULT 0,
    freeze_used_date TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_predictions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL,
    week_key TEXT NOT NULL,
    prediction_json TEXT NOT NULL,
    prediction_ts TIMESTAMPTZ DEFAULT NOW(),
    verify_json TEXT DEFAULT NULL,
    verify_ts TIMESTAMPTZ DEFAULT NULL,
    accuracy_score REAL DEFAULT NULL,
    UNIQUE(user_id, bot_id, week_key)
);

CREATE TABLE IF NOT EXISTS agent_digest_log (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL,
    digest_date TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, bot_id, digest_date)
);

CREATE TABLE IF NOT EXISTS brain_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, session_id)
);

CREATE TABLE IF NOT EXISTS brain_agent_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT DEFAULT 'New Session',
    message_count INTEGER DEFAULT 0,
    last_template TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_agent_template_stats (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template TEXT NOT NULL,
    uses INTEGER DEFAULT 1,
    last_used TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, template)
);

CREATE TABLE IF NOT EXISTS user_models (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_type TEXT NOT NULL,
    model_data TEXT DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, model_type)
);

-- ── 3. PORTFOLIO ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS etf_portfolios (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Portafoglio Principale',
    strategy TEXT DEFAULT 'custom',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_portfolios_meta (
    portfolio_id INTEGER PRIMARY KEY REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    base_currency TEXT NOT NULL DEFAULT 'EUR',
    benchmark_ticker TEXT DEFAULT 'VWCE',
    description TEXT DEFAULT '',
    color TEXT DEFAULT '#7C3AED',
    icon TEXT DEFAULT '💼',
    is_public BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_holdings (
    id SERIAL PRIMARY KEY,
    portfolio_id INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    isin TEXT DEFAULT '',
    ticker TEXT NOT NULL,
    name TEXT DEFAULT '',
    shares REAL DEFAULT 0,
    avg_price REAL DEFAULT 0,
    current_price REAL,
    currency TEXT DEFAULT 'USD',
    asset_class TEXT DEFAULT 'equity',
    purchase_date TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
    id SERIAL PRIMARY KEY,
    portfolio_id INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    snap_date TEXT NOT NULL,
    total_value REAL NOT NULL DEFAULT 0,
    total_cost REAL NOT NULL DEFAULT 0,
    total_return_pct REAL DEFAULT 0,
    today_return_pct REAL DEFAULT 0,
    num_holdings INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(portfolio_id, snap_date)
);

CREATE TABLE IF NOT EXISTS holding_prices (
    id SERIAL PRIMARY KEY,
    holding_id INTEGER NOT NULL REFERENCES etf_holdings(id) ON DELETE CASCADE,
    price_date TEXT NOT NULL,
    price_usd REAL NOT NULL DEFAULT 0,
    price_eur REAL NOT NULL DEFAULT 0,
    value_eur REAL NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(holding_id, price_date)
);

CREATE TABLE IF NOT EXISTS etf_alerts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticker TEXT NOT NULL,
    condition_type TEXT NOT NULL,
    threshold REAL,
    active INTEGER DEFAULT 1,
    triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_settings (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT,
    UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS etf_reports (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    format TEXT NOT NULL DEFAULT 'pdf',
    type TEXT NOT NULL DEFAULT 'portfolio_summary',
    filepath TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS etf_community_posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_name TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT 'U',
    content TEXT NOT NULL,
    likes INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. DIPENDONO DA ALTRE TABELLE ────────────────────────────

CREATE TABLE IF NOT EXISTS kg_edges (
    id BIGSERIAL PRIMARY KEY,
    src_id BIGINT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    tgt_id BIGINT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    relation TEXT NOT NULL DEFAULT 'related',
    weight REAL DEFAULT 1.0,
    evidence_count INTEGER DEFAULT 1,
    evidence_text TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT kg_edges_unique UNIQUE (src_id, tgt_id, relation)
);

CREATE TABLE IF NOT EXISTS kg_user_nodes (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    node_id BIGINT NOT NULL REFERENCES kg_nodes(id) ON DELETE CASCADE,
    weight REAL DEFAULT 1.0,
    notes TEXT DEFAULT '',
    bookmarked BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, node_id)
);

CREATE TABLE IF NOT EXISTS kg_uploads (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'text',
    status TEXT NOT NULL DEFAULT 'pending',
    nodes_added INTEGER DEFAULT 0,
    edges_added INTEGER DEFAULT 0,
    error_msg TEXT DEFAULT '',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS event_relationships (
    id SERIAL PRIMARY KEY,
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    rel_type TEXT NOT NULL DEFAULT 'related',
    weight REAL DEFAULT 0.5,
    direction TEXT DEFAULT 'bidirectional',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(source_id, target_id, rel_type)
);

CREATE TABLE IF NOT EXISTS idea_portfolio_links (
    id SERIAL PRIMARY KEY,
    idea_id INTEGER NOT NULL REFERENCES trade_ideas(id) ON DELETE CASCADE,
    portfolio_id INTEGER NOT NULL REFERENCES etf_portfolios(id) ON DELETE CASCADE,
    holding_id INTEGER,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    shares REAL NOT NULL DEFAULT 0,
    entry_price REAL NOT NULL DEFAULT 0,
    linked_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS brain_agent_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES brain_agent_sessions(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'user',
    content TEXT NOT NULL,
    template TEXT DEFAULT '',
    sources_json TEXT DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. INDEXES ─────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_users_email     ON users(email);
CREATE INDEX IF NOT EXISTS idx_watchlist_user  ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user     ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_brain_user_ts   ON brain_entries(user_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_eport_user      ON etf_portfolios(user_id);
CREATE INDEX IF NOT EXISTS idx_eholdings_port  ON etf_holdings(portfolio_id);
CREATE INDEX IF NOT EXISTS idx_ps_pid          ON portfolio_snapshots(portfolio_id, snap_date DESC);
CREATE INDEX IF NOT EXISTS idx_hp_hid          ON holding_prices(holding_id, price_date DESC);
CREATE INDEX IF NOT EXISTS idx_ti_status       ON trade_ideas(status);
CREATE INDEX IF NOT EXISTS idx_ti_created      ON trade_ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ti_ticker       ON trade_ideas(ticker);
CREATE INDEX IF NOT EXISTS idx_aa_created      ON anomaly_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_act_user        ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_abh             ON agent_brief_history(user_id, bot_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_sess_user ON brain_agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_msg_sess  ON brain_agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_events_ts       ON events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_cat      ON events(category);
CREATE INDEX IF NOT EXISTS idx_kg_nodes_type   ON kg_nodes(type);
CREATE INDEX IF NOT EXISTS idx_kg_edges_src    ON kg_edges(src_id);
CREATE INDEX IF NOT EXISTS idx_kg_edges_tgt    ON kg_edges(tgt_id);
CREATE INDEX IF NOT EXISTS idx_kg_user_uid     ON kg_user_nodes(user_id);
