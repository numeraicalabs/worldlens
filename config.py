"""World Lens — Configuration

AI Provider Architecture
─────────────────────────────────────────────────────────────────────
Primary provider: Google Gemini (free tier)
  → Get a free key at https://aistudio.google.com/app/apikey
  → Set gemini_api_key here OR save it via Admin → Settings

Claude/Anthropic: kept in the codebase for future use, disabled by default.
  → Set global_ai_provider = "claude" in Admin → Settings to enable it.

global_ai_provider controls which provider ALL users get:
  "gemini"  — Google Gemini 1.5 Flash (recommended)
  "claude"  — Anthropic Claude Haiku  (requires paid key)
  "none"    — AI features disabled
─────────────────────────────────────────────────────────────────────
"""
from pydantic_settings import BaseSettings
from pathlib import Path

BASE_DIR = Path(__file__).parent


class Settings(BaseSettings):
    app_name: str    = "World Lens"
    app_version: str = "1.0.0"
    secret_key: str  = "worldlens-secret-change-in-production-32chars"
    algorithm: str   = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7   # 7 days

    # ── Database ──────────────────────────────────────────────────────
    # Default: file next to main.py (dev).
    # Production: set DB_PATH=/data/worldlens.db  (Render Disk mount)
    db_path: str = str(BASE_DIR / "worldlens.db")

    # ── AI keys ───────────────────────────────────────────────────────
    gemini_api_key: str    = ""
    anthropic_api_key: str = ""
    global_ai_provider: str = "gemini"

    # ── App ───────────────────────────────────────────────────────────
    admin_email: str    = "admin@worldlens.io"
    admin_password: str = "admin123"
    update_interval_seconds: int  = 90
    finance_interval_seconds: int = 300
    max_events: int = 2000
    max_events_per_category: int = 300
    financial_priority: bool = True

    # ── Access control ────────────────────────────────────────────────
    # True  → anyone can register (open beta)
    # False → new accounts require a valid invite code
    registration_open: bool = True

    # ── CORS ──────────────────────────────────────────────────────────
    # In production set to your Render URL, e.g.:
    #   ALLOWED_ORIGINS=https://worldlens.onrender.com
    # Multiple origins comma-separated:
    #   ALLOWED_ORIGINS=https://worldlens.onrender.com,https://worldlens.io
    # Leave "*" only for local development.
    allowed_origins: str = "*"

    # ── FinBERT / ML models ───────────────────────────────────────────
    enable_finbert: bool = False
    enable_spacy:   bool = False

    # ── GDELT ─────────────────────────────────────────────────────────
    enable_gdelt: bool = True
    gdelt_timespan: str = "6h"

    # ── Knowledge Graph ───────────────────────────────────────────────
    enable_knowledge_graph: bool = True

    # ── Sprint 4 ML features ──────────────────────────────────────────
    # TF-IDF user profiles + alert classifier (requires scikit-learn)
    # Runs on Render free tier — no GPU needed.
    enable_ml_features:     bool = True
    # Semantic similarity via sentence-transformers (61MB model, optional)
    enable_semantic_search: bool = False

    # ── Free data API keys ────────────────────────────────────────────
    # FRED (Federal Reserve): free key at https://fred.stlouisfed.org
    # Leave empty to use the no-auth public CSV endpoint (slower)
    fred_api_key: str = ""

    # Alpha Vantage: free key at https://alphavantage.co
    # 500 requests/day free — used for earnings calendar
    alpha_vantage_key: str = ""

    # Resend: free email at https://resend.com (3000 emails/month free)
    # Used for: welcome emails, alert notifications
    resend_api_key: str = ""
    resend_from:    str = "alerts@worldlens.io"   # must be a verified domain in Resend

    # How often to refresh macro indicators (default 6h = 21600s)
    macro_interval_seconds: int = 21600

    class Config:
        env_file = ".env"
        extra    = "ignore"


settings = Settings()
