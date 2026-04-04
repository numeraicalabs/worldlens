# WorldLens — Render Environment Variables
# Copy-paste these in Render → your service → Environment

## REQUIRED (app won't start without these)

SECRET_KEY=worldlens-prod-change-this-to-a-random-32char-string
ADMIN_EMAIL=admin@yourdomain.com
ADMIN_PASSWORD=YourSecurePassword123
DB_PATH=/tmp/worldlens.db

## AI (at least one key for AI features — Gemini is free)
## Get Gemini key at: https://aistudio.google.com/app/apikey

GEMINI_API_KEY=AIzaSy...your-key-here
GLOBAL_AI_PROVIDER=gemini

## OPTIONAL: Anthropic Claude (paid, better quality)
# ANTHROPIC_API_KEY=sk-ant-...your-key-here
# GLOBAL_AI_PROVIDER=claude

## FEATURE FLAGS

# GDELT: free geopolitical event feed — highly recommended
ENABLE_GDELT=true
GDELT_TIMESPAN=6h

# Knowledge Graph: no extra deps, always enable
ENABLE_KNOWLEDGE_GRAPH=true

# ML Models: require 2GB+ RAM — disable on Render free tier
ENABLE_FINBERT=false
ENABLE_SPACY=false

## DATA LIMITS

# Max events stored in DB (2000 recommended, 500 minimum)
MAX_EVENTS=2000

# Per-category event cap (prevents any single category dominating)
MAX_EVENTS_PER_CATEGORY=300

# Financial news priority boost (true = ECONOMICS/FINANCE get more DB slots)
FINANCIAL_PRIORITY=true

## POLLING INTERVALS

# How often to fetch new events (seconds) — 90s recommended
UPDATE_INTERVAL_SECONDS=90

# How often to update market prices (seconds) — 300s recommended
FINANCE_INTERVAL_SECONDS=300

## NOTES

# DB_PATH=/tmp/worldlens.db resets on every Render deploy.
# For persistent data, add a PostgreSQL plugin in Render dashboard.
#
# On Render free tier (512MB RAM):
#   - All 15 features work WITHOUT FinBERT/spaCy
#   - AI analysis uses Gemini free tier (60 req/min)
#   - GDELT provides ~50 additional events per cycle
#
# On Render Standard ($25/mo, 2GB RAM):
#   - Set ENABLE_FINBERT=true for better sentiment
#   - Set ENABLE_SPACY=true for better NER entity extraction
## FREE DATA APIS (Sprint 1)

# FRED API — Federal Reserve economic data (free key, no credit card)
# Get key at: https://fred.stlouisfed.org/docs/api/api_key.html
# Leave empty to use no-auth CSV endpoint (slightly slower)
FRED_API_KEY=your_fred_key_here

# Alpha Vantage — earnings calendar (free key, 500 req/day)
# Get key at: https://alphavantage.co
ALPHA_VANTAGE_KEY=your_av_key_here

## EMAIL NOTIFICATIONS (Sprint 3)

# Resend — transactional email (free tier: 3000 emails/month)
# Get key at: https://resend.com
# Verify a domain, then set RESEND_FROM to your email
RESEND_API_KEY=re_your_key_here
RESEND_FROM=alerts@yourdomain.com

## MACRO REFRESH INTERVAL

# How often to refresh live macro data (seconds)
# Default 21600 = every 6 hours
MACRO_INTERVAL_SECONDS=21600
## ML FEATURES (Sprint 4)

# Enable lightweight ML: TF-IDF user profiles, alert classifier
# Requires scikit-learn (in requirements.txt — always safe)
# Default: true — disable if you have memory issues on free tier
ENABLE_ML_FEATURES=true

# Enable semantic similarity search using sentence-transformers
# Downloads paraphrase-MiniLM-L3-v2 (61MB) on first use
# Default: false — enable on paid tier (512MB+ RAM)
ENABLE_SEMANTIC_SEARCH=false
