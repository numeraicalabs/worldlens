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
