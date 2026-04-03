"""World Lens — Pydantic models / schemas"""
from __future__ import annotations
from pydantic import BaseModel
from typing import Optional, Literal, List
from datetime import datetime


# ── Auth ─────────────────────────────────────────────
class UserRegister(BaseModel):
    email: str
    username: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    avatar_color: str
    created_at: str
    is_admin: int = 0
    is_active: int = 1
    role: Optional[str] = None


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


# ── Watchlist ─────────────────────────────────────────
class WatchlistItem(BaseModel):
    type: Literal["country", "asset", "topic"]
    value: str
    label: Optional[str] = None


# ── Alerts ───────────────────────────────────────────
class AlertCreate(BaseModel):
    title: str
    condition: str
    type: str = "event"


# ── Events ───────────────────────────────────────────
CATEGORY_META = {
    "GEOPOLITICS":  {"color": "#3B82F6", "icon": "🌐"},
    "CONFLICT":     {"color": "#EF4444", "icon": "⚔️"},
    "ECONOMICS":    {"color": "#10B981", "icon": "📈"},
    "FINANCE":      {"color": "#06B6D4", "icon": "💹"},
    "TECHNOLOGY":   {"color": "#8B5CF6", "icon": "💻"},
    "ENERGY":       {"color": "#F59E0B", "icon": "⚡"},
    "HUMANITARIAN": {"color": "#F97316", "icon": "🚨"},
    "EARTHQUAKE":   {"color": "#EAB308", "icon": "🌍"},
    "DISASTER":     {"color": "#FF6B35", "icon": "🌪️"},
    "HEALTH":       {"color": "#EC4899", "icon": "🏥"},
    "POLITICS":     {"color": "#6366F1", "icon": "🏛️"},
    "SECURITY":     {"color": "#DC2626", "icon": "🔒"},
}

IMPACT_LEVELS = {
    "Low":    {"color": "#10B981", "score_range": (0, 3.9)},
    "Medium": {"color": "#F59E0B", "score_range": (4, 6.9)},
    "High":   {"color": "#EF4444", "score_range": (7, 10)},
}


class WorldEvent(BaseModel):
    id: str
    timestamp: str
    title: str
    summary: Optional[str] = ""
    category: str
    source: str
    latitude: float
    longitude: float
    country_code: str = "XX"
    country_name: str = ""
    severity: float = 5.0
    impact: str = "Medium"
    url: str = ""
    ai_summary: Optional[str] = None
    ai_impact_score: float = 5.0
    related_markets: list[str] = []


# ── Finance ──────────────────────────────────────────
class FinanceAsset(BaseModel):
    symbol: str
    name: str
    price: float
    change_pct: float
    change_abs: float
    history: list[float] = []
    category: str = "index"
