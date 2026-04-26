"""World Lens — Configuration

Priority order (highest → lowest):
  1. Environment variables set on Render / Railway / system
  2. .env file (local dev only — ignored if env vars already set)
  3. Default values in this file

AI Provider Architecture
─────────────────────────────────────────────────────────────────────
Primary provider: Google Gemini (free tier)
  → Get a free key at https://aistudio.google.com/app/apikey
  → Set GEMINI_API_KEY on Render, OR save via Admin → Settings

Render env var names (exact, case-sensitive on Linux):
  GEMINI_API_KEY          → gemini_api_key
  ANTHROPIC_API_KEY       → anthropic_api_key
  GLOBAL_AI_PROVIDER      → global_ai_provider  (gemini|claude|none)
  SECRET_KEY              → secret_key
  DB_PATH                 → db_path
  ADMIN_EMAIL             → admin_email
  ADMIN_PASSWORD          → admin_password
  ALLOWED_ORIGINS         → allowed_origins
  REGISTRATION_OPEN       → registration_open   (true/false)
─────────────────────────────────────────────────────────────────────
"""
from __future__ import annotations
import os
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
    # Render Disk: set DB_PATH=/data/worldlens.db in environment vars
    db_path: str = str(BASE_DIR / "worldlens.db")

    # ── Supabase PostgreSQL (shared knowledge graph) ────────────────────────
    # Set SUPABASE_URL in Render env vars:
    # postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
    supabase_url: str = ""

    # ── AI keys ───────────────────────────────────────────────────────
    # Set GEMINI_API_KEY on Render dashboard (Environment → Add env var)
    # Field names are lowercase; Pydantic maps UPPER_CASE env vars automatically
    gemini_api_key: str     = ""
    anthropic_api_key: str  = ""
    global_ai_provider: str = "gemini"   # gemini | claude | none

    # ── App ───────────────────────────────────────────────────────────
    admin_email: str    = "admin@worldlens.io"
    admin_password: str = "admin123"
    update_interval_seconds: int  = 90
    finance_interval_seconds: int = 300
    max_events: int = 2000
    max_events_per_category: int = 300
    financial_priority: bool = True

    # ── Access control ────────────────────────────────────────────────
    registration_open: bool = True

    # ── CORS ──────────────────────────────────────────────────────────
    # Production: set ALLOWED_ORIGINS=https://worldlens.onrender.com
    allowed_origins: str = "*"

    # ── ML models (optional) ─────────────────────────────────────────
    enable_finbert: bool = False
    enable_spacy:   bool = False

    # ── GDELT ─────────────────────────────────────────────────────────
    enable_gdelt: bool = True
    gdelt_timespan: str = "6h"

    # ── Knowledge Graph ───────────────────────────────────────────────
    enable_knowledge_graph: bool = True

    # ── Sprint 4 ML features ──────────────────────────────────────────
    enable_ml_features:     bool = True
    enable_semantic_search: bool = False

    # ── Free data API keys ────────────────────────────────────────────
    fred_api_key:       str = ""
    alpha_vantage_key:  str = ""
    resend_api_key:     str = ""
    resend_from:        str = "alerts@worldlens.io"
    macro_interval_seconds: int = 21600

    model_config = {
        # Read .env file for local dev; env vars always win over .env
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        # CRITICAL: allow UPPER_CASE env vars (e.g. GEMINI_API_KEY)
        # to map to lower_case field names (e.g. gemini_api_key)
        "case_sensitive": False,
        # Ignore extra env vars that don't match any field
        "extra": "ignore",
        # env vars take priority over .env file values
        "env_nested_delimiter": "__",
    }


settings = Settings()

# ── Post-load: log what was picked up (keys redacted) ────────────────────────
import logging as _logging
_log = _logging.getLogger(__name__)

def _preview(key: str) -> str:
    if not key or not key.strip():
        return "(not set)"
    k = key.strip()
    return f"***{k[-4:]}" if len(k) >= 4 else "***"

_log.info(
    "Config loaded — provider=%s  gemini=%s  claude=%s  db=%s",
    settings.global_ai_provider,
    _preview(settings.gemini_api_key),
    _preview(settings.anthropic_api_key),
    settings.db_path,
)
