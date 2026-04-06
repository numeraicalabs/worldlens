"""
WorldLens Agent Bots API — /api/agents
4 agentic AI bots: Finance, Geopolitics, Science, Technology
Each bot maintains per-user config saved to profile.
"""
from __future__ import annotations
import json, time
from typing import Optional, Dict, List
from fastapi import APIRouter, Depends, Body
import aiosqlite

try:
    from config import settings
except ImportError:
    class _S: db_path = "worldlens.db"
    settings = _S()

try:
    from routers.auth import require_user
except Exception:
    async def require_user(): return {"id": 1, "username": "demo"}

try:
    from ai_layer import _call_claude, _parse_json, _ai_available
except ImportError:
    async def _call_claude(p, **kw): return None
    def _parse_json(t): return None
    def _ai_available(): return False

router = APIRouter(prefix="/api/agents", tags=["agents"])

# ── Default bot configs ─────────────────────────────────────────────────────
DEFAULT_BOTS: Dict[str, Dict] = {
    "finance": {
        "id": "finance",
        "name": "FinanceBot",
        "icon": "📊",
        "color": "#10B981",
        "accent": "rgba(16,185,129,.12)",
        "border": "rgba(16,185,129,.25)",
        "description": "Monitors global markets, macro indicators, and financial risk signals.",
        "persona": "You are a senior quantitative analyst with expertise in global macro, equities, FX, and commodities.",
        "focus_options": ["Global Macro","Equities","Fixed Income","Commodities","FX","Crypto","Private Equity"],
        "tone_options": ["Professional","Concise","Detailed","Bullet Points"],
        "alert_options": ["All Events","High Impact Only","Critical Only"],
        "defaults": {"focus": "Global Macro", "tone": "Professional", "alerts": "High Impact Only", "enabled": True}
    },
    "geopolitics": {
        "id": "geopolitics",
        "name": "GeoBot",
        "icon": "🌐",
        "color": "#3B82F6",
        "accent": "rgba(59,130,246,.12)",
        "border": "rgba(59,130,246,.25)",
        "description": "Tracks geopolitical risk, conflicts, diplomacy, and regional stability.",
        "persona": "You are a seasoned geopolitical analyst advising institutional investors and governments on global risk.",
        "focus_options": ["Global Risk","Conflicts","Diplomacy","Sanctions","Elections","Energy Security","Trade Wars"],
        "tone_options": ["Professional","Concise","Detailed","Bullet Points"],
        "alert_options": ["All Events","High Impact Only","Critical Only"],
        "defaults": {"focus": "Global Risk", "tone": "Concise", "alerts": "High Impact Only", "enabled": True}
    },
    "science": {
        "id": "science",
        "name": "SciBot",
        "icon": "🔬",
        "color": "#8B5CF6",
        "accent": "rgba(139,92,246,.12)",
        "border": "rgba(139,92,246,.25)",
        "description": "Monitors scientific breakthroughs, research trends, and their market implications.",
        "persona": "You are a science journalist and analyst tracking research breakthroughs and their economic impact.",
        "focus_options": ["Biotech","Climate Science","Physics","Space","Neuroscience","Energy Research","Pandemic Watch"],
        "tone_options": ["Professional","Concise","Detailed","Bullet Points"],
        "alert_options": ["All Events","High Impact Only","Critical Only"],
        "defaults": {"focus": "Biotech", "tone": "Detailed", "alerts": "All Events", "enabled": True}
    },
    "technology": {
        "id": "technology",
        "name": "TechBot",
        "icon": "💻",
        "color": "#F59E0B",
        "accent": "rgba(245,158,11,.12)",
        "border": "rgba(245,158,11,.25)",
        "description": "Tracks AI, semiconductors, cybersecurity, and tech industry developments.",
        "persona": "You are a technology analyst covering AI, semiconductors, cybersecurity, and emerging tech with deep market insight.",
        "focus_options": ["Artificial Intelligence","Semiconductors","Cybersecurity","Cloud Computing","Robotics","Quantum Computing","Regulation"],
        "tone_options": ["Professional","Concise","Detailed","Bullet Points"],
        "alert_options": ["All Events","High Impact Only","Critical Only"],
        "defaults": {"focus": "Artificial Intelligence", "tone": "Bullet Points", "alerts": "All Events", "enabled": True}
    }
}

# Category mapping for each bot
BOT_CATEGORIES: Dict[str, List[str]] = {
    "finance":     ["ECONOMICS", "FINANCE"],
    "geopolitics": ["GEOPOLITICS", "CONFLICT", "SECURITY", "POLITICS"],
    "science":     ["HEALTH", "TECHNOLOGY", "DISASTER", "EARTHQUAKE"],
    "technology":  ["TECHNOLOGY", "SECURITY"],
}

_brief_cache: Dict[str, Dict] = {}
_cache_ttl = 120  # 2 minutes


async def _get_bot_events(bot_id: str, config: Dict, limit: int = 10) -> List[Dict]:
    cats = BOT_CATEGORIES.get(bot_id, ["GEOPOLITICS"])
    impact_filter = config.get("alerts", "High Impact Only")
    impact_sql = ""
    if impact_filter == "High Impact Only":
        impact_sql = " AND impact IN ('High','Medium')"
    elif impact_filter == "Critical Only":
        impact_sql = " AND impact='High' AND severity >= 7"

    placeholders = ",".join("?" * len(cats))
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            f"SELECT * FROM events WHERE category IN ({placeholders}){impact_sql} "
            f"AND datetime(timestamp) > datetime('now','-24 hours') "
            f"ORDER BY severity DESC LIMIT ?",
            cats + [limit]
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


async def _generate_brief(bot_id: str, config: Dict, events: List[Dict]) -> Dict:
    cache_key = f"{bot_id}:{config.get('focus','')}"
    cached = _brief_cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < _cache_ttl:
        return cached["data"]

    bot = DEFAULT_BOTS.get(bot_id, {})
    tone = config.get("tone", "Professional")
    focus = config.get("focus", bot.get("defaults", {}).get("focus", ""))

    tone_instructions = {
        "Professional": "Write in professional analyst style.",
        "Concise": "Be extremely concise — max 2 sentences per point.",
        "Detailed": "Provide detailed analysis with context and implications.",
        "Bullet Points": "Use bullet points only. Max 4 bullets.",
    }

    if not events:
        result = {
            "headline": "No significant events in the last 24h",
            "brief": f"No {focus} events detected in the monitoring window.",
            "signal": "neutral",
            "signal_label": "Quiet",
            "key_points": [],
            "actions": [],
        }
        _brief_cache[cache_key] = {"ts": time.time(), "data": result}
        return result

    if not _ai_available():
        ev = events[0]
        result = {
            "headline": ev["title"][:80],
            "brief": f"{len(events)} events detected. Top: {ev['title'][:100]}",
            "signal": "negative" if any(e.get("impact")=="High" for e in events) else "neutral",
            "signal_label": "Alert" if any(e.get("severity",0)>=7 for e in events) else "Monitor",
            "key_points": [e["title"][:60] for e in events[:3]],
            "actions": ["Configure AI provider in Admin → Settings to enable AI briefings"],
        }
        _brief_cache[cache_key] = {"ts": time.time(), "data": result}
        return result

    titles = "\n".join(f"- [{e.get('severity',5):.0f}/10] {e['title']} ({e.get('country_name','')}, {e.get('category','')})"
                       for e in events[:8])
    persona = bot.get("persona", "You are an analyst.")
    prompt = (
        f"Focus area: {focus}\n"
        f"Recent events (last 24h):\n{titles}\n\n"
        f"{tone_instructions.get(tone, '')}\n"
        f"Provide a brief intelligence report. Respond ONLY with JSON:\n"
        '{"headline":"one-line headline","brief":"2-3 sentence analysis",'
        '"signal":"bullish|bearish|neutral|critical","signal_label":"Alert|Monitor|Quiet|Opportunity",'
        '"key_points":["point1","point2","point3"],'
        '"actions":["action1","action2"]}'
    )
    parsed = _parse_json(await _call_claude(prompt, system=persona, max_tokens=350))
    if not parsed:
        parsed = {
            "headline": events[0]["title"][:80],
            "brief": f"{len(events)} events in focus area. Key: {events[0]['title'][:80]}.",
            "signal": "neutral", "signal_label": "Monitor",
            "key_points": [e["title"][:60] for e in events[:3]], "actions": [],
        }
    _brief_cache[cache_key] = {"ts": time.time(), "data": parsed}
    return parsed


@router.get("/config")
async def get_all_configs(user=Depends(require_user)):
    """Get all 4 bot configs for this user (merges defaults with saved prefs)."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT bot_id, config_json FROM agent_configs WHERE user_id=?", (user["id"],)
        ) as cur:
            rows = await cur.fetchall()

    saved = {r["bot_id"]: json.loads(r["config_json"]) for r in rows}
    result = {}
    for bid, bdef in DEFAULT_BOTS.items():
        merged = dict(bdef["defaults"])
        merged.update(saved.get(bid, {}))
        result[bid] = {**bdef, "config": merged}
    return result


@router.post("/config/{bot_id}")
async def save_bot_config(bot_id: str, payload: dict = Body(...), user=Depends(require_user)):
    """Save user config for one bot."""
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    config_json = json.dumps(payload)
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT OR REPLACE INTO agent_configs (user_id, bot_id, config_json, updated_at) "
            "VALUES (?, ?, ?, datetime('now'))",
            (user["id"], bot_id, config_json)
        )
        await db.commit()
    return {"status": "saved"}


@router.get("/brief/{bot_id}")
async def get_bot_brief(bot_id: str, user=Depends(require_user)):
    """Get latest AI brief for one bot."""
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}

    # Load user config
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT config_json FROM agent_configs WHERE user_id=? AND bot_id=?",
            (user["id"], bot_id)
        ) as cur:
            row = await cur.fetchone()

    config = json.loads(row["config_json"]) if row else DEFAULT_BOTS[bot_id]["defaults"]
    events = await _get_bot_events(bot_id, config)
    brief = await _generate_brief(bot_id, config, events)

    return {
        "bot_id": bot_id,
        "config": config,
        "event_count": len(events),
        "top_events": [{"title": e["title"], "severity": e.get("severity", 5),
                        "country": e.get("country_name", ""), "category": e.get("category", "")}
                       for e in events[:5]],
        **brief,
    }


@router.get("/all-briefs")
async def get_all_briefs(user=Depends(require_user)):
    """Get briefs for all 4 bots in one call."""
    results = {}
    for bot_id in DEFAULT_BOTS:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT config_json FROM agent_configs WHERE user_id=? AND bot_id=?",
                (user["id"], bot_id)
            ) as cur:
                row = await cur.fetchone()
        config = json.loads(row["config_json"]) if row else DEFAULT_BOTS[bot_id]["defaults"]
        if not config.get("enabled", True):
            continue
        events = await _get_bot_events(bot_id, config)
        brief = await _generate_brief(bot_id, config, events)
        results[bot_id] = {"bot_id": bot_id, "event_count": len(events),
                           "top_events": [{"title": e["title"], "severity": e.get("severity",5),
                                           "country": e.get("country_name",""), "category": e.get("category","")}
                                          for e in events[:3]], **brief}
    return results
