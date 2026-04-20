"""
WorldLens Globe API — /api/globe
Provides real-time regional summaries, event heatmap data, and AI-generated
1-2 line summaries per macro-region for the landing page 3D globe widget.
"""
from __future__ import annotations
import json, logging, time
from typing import List, Dict, Optional
from fastapi import APIRouter
import aiosqlite

try:
    from config import settings
except ImportError:
    class _S:
        db_path = "worldlens.db"
    settings = _S()

try:
    from ai_layer import _call_claude, _parse_json, _ai_available
except ImportError:
    async def _call_claude(p, **kw): return None
    def _parse_json(t): return None
    def _ai_available(): return False

import asyncio

logger = logging.getLogger(__name__)

async def _call_ai_with_retry(prompt: str, max_tokens: int = 180, retries: int = 2):
    """Call AI with retry — Gemini free tier can timeout occasionally."""
    for attempt in range(retries + 1):
        try:
            result = await _call_claude(prompt, max_tokens=max_tokens)
            if result:
                return result
        except Exception as e:
            logger.debug("AI attempt %d failed: %s", attempt + 1, e)
        if attempt < retries:
            await asyncio.sleep(1.2 * (attempt + 1))
    return None

router = APIRouter(prefix="/api/globe", tags=["globe"])

# ── Region definitions: each maps to a set of country codes ──────────────
REGIONS: Dict[str, Dict] = {
    "North America": {
        "codes": ["US","CA","MX","GT","BZ","HN","SV","NI","CR","PA"],
        "center": [39, -98], "color": "#3B82F6", "emoji": "🌎"
    },
    "South America": {
        "codes": ["BR","AR","CL","CO","PE","VE","EC","BO","PY","UY","GY","SR"],
        "center": [-15, -60], "color": "#10B981", "emoji": "🌎"
    },
    "Europe": {
        "codes": ["GB","DE","FR","IT","ES","PL","UA","RU","NL","BE","SE","NO",
                  "CH","AT","CZ","HU","RO","GR","PT","FI","DK","TR"],
        "center": [54, 15], "color": "#6366F1", "emoji": "🌍"
    },
    "Middle East": {
        "codes": ["SA","IR","IQ","IL","PS","SY","LB","JO","AE","KW","QA","YE","OM","BH"],
        "center": [27, 43], "color": "#EF4444", "emoji": "🌍"
    },
    "Africa": {
        "codes": ["NG","ZA","EG","ET","KE","TZ","GH","CI","SN","SD","LY","MA","TN","AO","DZ"],
        "center": [5, 22], "color": "#F59E0B", "emoji": "🌍"
    },
    "South Asia": {
        "codes": ["IN","PK","BD","LK","NP","AF","MM"],
        "center": [23, 78], "color": "#EC4899", "emoji": "🌏"
    },
    "East Asia": {
        "codes": ["CN","JP","KR","KP","TW","HK","MN"],
        "center": [35, 115], "color": "#8B5CF6", "emoji": "🌏"
    },
    "Southeast Asia": {
        "codes": ["TH","VN","ID","PH","MY","SG","MM","KH","LA"],
        "center": [5, 110], "color": "#06B6D4", "emoji": "🌏"
    },
    "Central Asia": {
        "codes": ["KZ","UZ","TM","KG","TJ","AZ","GE","AM"],
        "center": [42, 63], "color": "#F97316", "emoji": "🌏"
    },
}

_summary_cache: Dict[str, Dict] = {}
_cache_ttl = 180  # 3 minutes


async def _get_region_events(db, codes: List[str]) -> List[Dict]:
    placeholders = ",".join("?" * len(codes))
    async with db.execute(
        f"SELECT * FROM events WHERE country_code IN ({placeholders}) "
        f"AND datetime(timestamp) > datetime('now','-24 hours') "
        f"ORDER BY severity DESC LIMIT 20",
        codes
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def _ai_region_summary(region: str, events: List[Dict]) -> Dict:
    """Generate 1-2 line AI summary + sentiment + trend for a region."""
    cached = _summary_cache.get(region)
    if cached and (time.time() - cached["ts"]) < _cache_ttl:
        return cached["data"]

    if not events:
        result = {
            "summary": "No significant events in the last 24h.",
            "sentiment": "neutral",
            "trend": "→",
            "risk": 3.0,
            "topics": [],
        }
        _summary_cache[region] = {"ts": time.time(), "data": result}
        return result

    avg_sev = sum(e.get("severity", 5) for e in events) / len(events)
    high_count = sum(1 for e in events if e.get("impact") == "High")

    if not _ai_available():
        top = events[0]["title"][:80] if events else ""
        trend = "↑" if avg_sev > 6.5 else ("↓" if avg_sev < 4 else "→")
        result = {
            "summary": f"{top}. {len(events)} events, avg severity {avg_sev:.1f}.",
            "sentiment": "negative" if avg_sev > 6 else ("positive" if avg_sev < 4 else "neutral"),
            "trend": trend,
            "risk": round(avg_sev, 1),
            "topics": list({e.get("category", "") for e in events[:5]})[:3],
        }
        _summary_cache[region] = {"ts": time.time(), "data": result}
        return result

    titles = "\n".join(f"- {e['title']} [{e.get('category','')}] sev={e.get('severity',5):.0f}"
                       for e in events[:8])
    prompt = (
        f"Region: {region}. Last 24h events:\n{titles}\n\n"
        "Provide a concise 1-2 sentence intelligence summary for this region. "
        "Be direct, factual, market-relevant. Respond ONLY with JSON:\n"
        '{"summary":"1-2 sentences","sentiment":"positive|neutral|negative|critical",'
        '"trend":"↑|→|↓","risk":6.5,"topics":["topic1","topic2","topic3"]}'
    )
    parsed = _parse_json(await _call_ai_with_retry(prompt, max_tokens=200))
    if not parsed:
        trend = "↑" if avg_sev > 6.5 else ("↓" if avg_sev < 4 else "→")
        parsed = {
            "summary": f"{events[0]['title'][:100]}.",
            "sentiment": "negative" if avg_sev > 6 else "neutral",
            "trend": trend,
            "risk": round(avg_sev, 1),
            "topics": list({e.get("category","") for e in events[:3]}),
        }
    _summary_cache[region] = {"ts": time.time(), "data": parsed}
    return parsed


@router.get("/regions")
async def get_region_summaries():
    """All regional summaries for the landing page globe widget."""
    # Re-load AI settings from DB on every call — ensures Gemini key saved
    # by admin is picked up without requiring a server restart.
    try:
        async with aiosqlite.connect(settings.db_path) as _sdb:
            async with _sdb.execute(
                "SELECT key, value FROM app_settings WHERE key IN "
                "('global_ai_provider','gemini_api_key','anthropic_api_key')"
            ) as _cur:
                for _key, _val in await _cur.fetchall():
                    if _val:
                        if _key == "global_ai_provider":  settings.global_ai_provider = _val
                        elif _key == "gemini_api_key":    settings.gemini_api_key = _val
                        elif _key == "anthropic_api_key": settings.anthropic_api_key = _val
    except Exception:
        pass  # silently skip if DB not ready — stubs will show

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        results = []
        for name, cfg in REGIONS.items():
            events = await _get_region_events(db, cfg["codes"])
            summary = await _ai_region_summary(name, events)
            results.append({
                "name": name,
                "center": cfg["center"],
                "color": cfg["color"],
                "emoji": cfg["emoji"],
                "event_count": len(events),
                "high_impact": sum(1 for e in events if e.get("impact") == "High"),
                "top_events": [
                    {"title": e["title"], "severity": e.get("severity", 5),
                     "category": e.get("category", ""), "country": e.get("country_name", "")}
                    for e in events[:3]
                ],
                **summary,
            })
    return results


@router.get("/heatmap-points")
async def get_heatmap_points():
    """Lat/lon event points for the 3D globe glow markers."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT latitude, longitude, severity, category, impact, title "
            "FROM events WHERE latitude IS NOT NULL AND longitude IS NOT NULL "
            "AND datetime(timestamp) > datetime('now','-48 hours') "
            "ORDER BY severity DESC LIMIT 300"
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.get("/stats")
async def get_globe_stats():
    """Top-line stats for the globe header ticker."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT COUNT(*) as total, "
            "SUM(CASE WHEN impact='High' THEN 1 ELSE 0 END) as high, "
            "AVG(severity) as avg_sev "
            "FROM events WHERE datetime(timestamp) > datetime('now','-24 hours')"
        ) as cur:
            row = dict(await cur.fetchone())
        async with db.execute(
            "SELECT COUNT(DISTINCT country_code) as countries "
            "FROM events WHERE datetime(timestamp) > datetime('now','-24 hours')"
        ) as cur:
            countries = (await cur.fetchone())[0]
    return {
        "events_24h": row["total"] or 0,
        "high_impact": row["high"] or 0,
        "avg_severity": round(row["avg_sev"] or 5, 1),
        "countries_affected": countries or 0,
    }
