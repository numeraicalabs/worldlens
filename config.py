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
    db_path: str = str(BASE_DIR / "worldlens.db")

    # ── AI keys ───────────────────────────────────────────────────────
    # Google Gemini — FREE tier. Insert your key here or via Admin panel.
    gemini_api_key: str = ""        # e.g. "AIzaSy..."

    # Claude/Anthropic — disabled by default. Leave empty unless needed.
    anthropic_api_key: str = ""     # e.g. "sk-ant-..."

    # ── Active provider (overridable at runtime via Admin → Settings) ──
    # "gemini" | "claude" | "none"
    global_ai_provider: str = "gemini"

    # ── App ───────────────────────────────────────────────────────────
    admin_email: str    = "admin@worldlens.io"
    admin_password: str = "admin123"          # Change in production!
    update_interval_seconds: int  = 90
    finance_interval_seconds: int = 300
    max_events: int = 500

    # ── FinBERT / ML models ───────────────────────────────────────────
    # When True: loads ProsusAI/finbert + spaCy on startup.
    # Models are downloaded on first use (~500MB). Set False to disable.
    enable_finbert: bool = True
    enable_spacy:   bool = True

    # ── GDELT ─────────────────────────────────────────────────────────
    # Enable GDELT event ingestion alongside RSS feeds.
    enable_gdelt: bool = True
    gdelt_timespan: str = "6h"   # GDELT query window per scheduler cycle

    # ── Knowledge Graph ───────────────────────────────────────────────
    # NetworkX-based geopolitical impact propagation.
    enable_knowledge_graph: bool = True

    class Config:
        env_file = ".env"
        extra    = "ignore"


settings = Settings()
