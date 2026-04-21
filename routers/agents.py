"""
WorldLens Agent Bots API — /api/agents  v2
Block A: enriched prompts, delta brief, threshold alerts, full profile persistence
"""
from __future__ import annotations
import json, time, logging
from typing import Optional, Dict, List
from fastapi import APIRouter, Depends, Body
import aiosqlite

logger = logging.getLogger(__name__)

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
    from ai_layer import _call_claude, _parse_json, _ai_available, ai_available_async
except ImportError:
    async def _call_claude(p, **kw): return None
    def _parse_json(t): return None
    def _ai_available(): return False
    async def ai_available_async(): return False

try:
    from scheduler import get_finance_cache
except ImportError:
    def get_finance_cache(): return []

router = APIRouter(prefix="/api/agents", tags=["agents"])

# ── Bot definitions ──────────────────────────────────────────────────────────
DEFAULT_BOTS: Dict[str, Dict] = {
    "finance": {
        "id": "finance", "name": "FinanceBot", "icon": "📊",
        "color": "#10B981", "accent": "rgba(16,185,129,.12)", "border": "rgba(16,185,129,.25)",
        "description": "Monitors global markets, macro indicators, and financial risk signals.",
        "persona": (
            "You are a senior quantitative analyst at a top-tier hedge fund. "
            "You have deep expertise in global macro, equities, FX, commodities, and derivatives. "
            "Your briefs are precise, data-driven, and actionable."
        ),
        "focus_options": ["Global Macro","Equities","Fixed Income","Commodities","FX","Crypto","Private Equity"],
        "tone_options":  ["Professional","Concise","Detailed","Bullet Points"],
        "alert_options": ["All Events","High Impact Only","Critical Only"],
        "defaults": {
            "focus": "Global Macro", "tone": "Professional",
            "alerts": "High Impact Only", "enabled": True,
            "severity_threshold": 6.5, "watch_regions": [], "custom_notes": ""
        }
    },
    "geopolitics": {
        "id": "geopolitics", "name": "GeoBot", "icon": "🌐",
        "color": "#3B82F6", "accent": "rgba(59,130,246,.12)", "border": "rgba(59,130,246,.25)",
        "description": "Tracks geopolitical risk, conflicts, diplomacy, and regional stability.",
        "persona": (
            "You are a seasoned geopolitical analyst who has advised governments and "
            "institutional investors on global risk for 20 years. "
            "You connect dots between seemingly unrelated events and identify cascading risks."
        ),
        "focus_options": ["Global Risk","Conflicts","Diplomacy","Sanctions","Elections","Energy Security","Trade Wars"],
        "tone_options":  ["Professional","Concise","Detailed","Bullet Points"],
        "alert_options": ["All Events","High Impact Only","Critical Only"],
        "defaults": {
            "focus": "Global Risk", "tone": "Concise",
            "alerts": "High Impact Only", "enabled": True,
            "severity_threshold": 7.0, "watch_regions": [], "custom_notes": ""
        }
    },
    "science": {
        "id": "science", "name": "SciBot", "icon": "🔬",
        "color": "#8B5CF6", "accent": "rgba(139,92,246,.12)", "border": "rgba(139,92,246,.25)",
        "description": "Monitors scientific breakthroughs, research trends, and their market implications.",
        "persona": (
            "You are a science analyst bridging cutting-edge research and market implications. "
            "You track biotech, climate, health, and technology breakthroughs. "
            "You explain complex science in terms of investment and policy impact."
        ),
        "focus_options": ["Biotech","Climate Science","Physics","Space","Neuroscience","Energy Research","Pandemic Watch"],
        "tone_options":  ["Professional","Concise","Detailed","Bullet Points"],
        "alert_options": ["All Events","High Impact Only","Critical Only"],
        "defaults": {
            "focus": "Biotech", "tone": "Detailed",
            "alerts": "All Events", "enabled": True,
            "severity_threshold": 6.0, "watch_regions": [], "custom_notes": ""
        }
    },
    "technology": {
        "id": "technology", "name": "TechBot", "icon": "💻",
        "color": "#F59E0B", "accent": "rgba(245,158,11,.12)", "border": "rgba(245,158,11,.25)",
        "description": "Tracks AI, semiconductors, cybersecurity, and tech industry developments.",
        "persona": (
            "You are a technology analyst with deep insight into AI, semiconductors, cybersecurity, "
            "and emerging tech. You track regulatory shifts, M&A signals, and technical breakthroughs "
            "that move markets. You are opinionated and specific."
        ),
        "focus_options": ["Artificial Intelligence","Semiconductors","Cybersecurity","Cloud Computing","Robotics","Quantum Computing","Regulation"],
        "tone_options":  ["Professional","Concise","Detailed","Bullet Points"],
        "alert_options": ["All Events","High Impact Only","Critical Only"],
        "defaults": {
            "focus": "Artificial Intelligence", "tone": "Bullet Points",
            "alerts": "All Events", "enabled": True,
            "severity_threshold": 6.5, "watch_regions": [], "custom_notes": ""
        }
    }
}

BOT_CATEGORIES: Dict[str, List[str]] = {
    "finance":     ["ECONOMICS", "FINANCE"],
    "geopolitics": ["GEOPOLITICS", "CONFLICT", "SECURITY", "POLITICS"],
    "science":     ["HEALTH", "TECHNOLOGY", "DISASTER", "EARTHQUAKE"],
    "technology":  ["TECHNOLOGY", "SECURITY"],
}

BOT_FINANCE_SYMBOLS: Dict[str, List[str]] = {
    "finance":     ["^GSPC", "^VIX", "GC=F", "CL=F", "BTC-USD"],
    "geopolitics": ["^VIX", "GC=F", "CL=F"],
    "science":     ["^GSPC"],
    "technology":  ["^IXIC", "^GSPC"],
}

_brief_cache: Dict[str, Dict] = {}
_CACHE_TTL = 120


# ── DB helpers ───────────────────────────────────────────────────────────────

async def _load_user_config(user_id: int, bot_id: str) -> Dict:
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT config_json FROM agent_configs WHERE user_id=? AND bot_id=?",
                (user_id, bot_id)
            ) as cur:
                row = await cur.fetchone()
        if row:
            merged = dict(DEFAULT_BOTS[bot_id]["defaults"])
            merged.update(json.loads(row["config_json"]))
            return merged
    except Exception as e:
        logger.warning("_load_user_config %s %s: %s", user_id, bot_id, e)
    return dict(DEFAULT_BOTS[bot_id]["defaults"])


async def _save_brief_history(user_id: int, bot_id: str, brief: Dict, event_count: int):
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                "INSERT INTO agent_brief_history (user_id, bot_id, brief_json, signal, event_count) "
                "VALUES (?, ?, ?, ?, ?)",
                (user_id, bot_id, json.dumps(brief), brief.get("signal", "neutral"), event_count)
            )
            await db.execute(
                "DELETE FROM agent_brief_history WHERE id NOT IN ("
                "SELECT id FROM agent_brief_history WHERE user_id=? AND bot_id=? "
                "ORDER BY created_at DESC LIMIT 10)",
                (user_id, bot_id)
            )
            await db.commit()
    except Exception as e:
        logger.warning("_save_brief_history: %s", e)


async def _load_previous_brief(user_id: int, bot_id: str) -> Optional[Dict]:
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT brief_json, signal, event_count, created_at "
                "FROM agent_brief_history WHERE user_id=? AND bot_id=? "
                "ORDER BY created_at DESC LIMIT 2",
                (user_id, bot_id)
            ) as cur:
                rows = await cur.fetchall()
        if len(rows) >= 2:
            prev = json.loads(rows[1]["brief_json"])
            prev["_prev_signal"]      = rows[1]["signal"]
            prev["_prev_event_count"] = rows[1]["event_count"]
            prev["_prev_ts"]          = rows[1]["created_at"]
            return prev
    except Exception as e:
        logger.warning("_load_previous_brief: %s", e)
    return None


async def _load_user_watchlist(user_id: int) -> List[Dict]:
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT type, value, label FROM watchlist WHERE user_id=? LIMIT 20",
                (user_id,)
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception:
        return []


# ── Event fetching ───────────────────────────────────────────────────────────

async def _get_bot_events(bot_id: str, config: Dict, limit: int = 15) -> List[Dict]:
    cats = BOT_CATEGORIES.get(bot_id, ["GEOPOLITICS"])
    impact_filter = config.get("alerts", "High Impact Only")

    impact_sql = ""
    if impact_filter == "High Impact Only":
        impact_sql = " AND impact IN ('High','Medium')"
    elif impact_filter == "Critical Only":
        impact_sql = " AND impact='High' AND severity >= 7"

    regions = config.get("watch_regions") or []
    region_sql, region_params = "", []
    if regions:
        ph = ",".join("?" * len(regions))
        region_sql = f" AND country_code IN ({ph})"
        region_params = list(regions)

    placeholders = ",".join("?" * len(cats))
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                f"SELECT id, title, summary, category, country_name, country_code, "
                f"severity, impact, timestamp, source, sentiment_tone "
                f"FROM events "
                f"WHERE category IN ({placeholders}){impact_sql}{region_sql} "
                f"AND datetime(timestamp) > datetime('now','-72 hours') "
                f"ORDER BY severity DESC, timestamp DESC LIMIT ?",
                cats + region_params + [limit]
            ) as cur:
                rows = await cur.fetchall()
        return [dict(r) for r in rows]
    except Exception as e:
        logger.warning("_get_bot_events %s: %s", bot_id, e)
        return []


def _check_threshold_alerts(bot_id: str, events: List[Dict], config: Dict) -> List[Dict]:
    threshold = float(config.get("severity_threshold",
                      DEFAULT_BOTS[bot_id]["defaults"]["severity_threshold"]))
    out = []
    for ev in events:
        if float(ev.get("severity", 0)) >= threshold:
            out.append({
                "title":    ev["title"],
                "severity": float(ev.get("severity", 0)),
                "country":  ev.get("country_name", ""),
                "category": ev.get("category", ""),
                "impact":   ev.get("impact", ""),
            })
    return out[:5]


# ── Brief generation ─────────────────────────────────────────────────────────

def _finance_context(bot_id: str) -> str:
    try:
        assets   = get_finance_cache()
        symbols  = BOT_FINANCE_SYMBOLS.get(bot_id, [])
        lines    = []
        for a in assets:
            if a.get("symbol") in symbols and a.get("price") is not None:
                chg  = a.get("change_pct", 0) or 0
                arr  = "▲" if chg >= 0 else "▼"
                lines.append(f"  {a.get('name', a['symbol'])}: {a['price']:,.2f} ({arr}{abs(chg):.2f}%)")
        return ("Live market snapshot:\n" + "\n".join(lines)) if lines else ""
    except Exception:
        return ""


def _delta_context(previous: Optional[Dict]) -> str:
    if not previous:
        return ""
    return (
        f"PREVIOUS BRIEF (for delta comparison):\n"
        f"  Signal: {previous.get('_prev_signal', previous.get('signal','neutral'))}\n"
        f"  Event count: {previous.get('_prev_event_count', 0)}\n"
        f"  Headline was: {previous.get('headline','')}\n"
        f"  Recorded at: {previous.get('_prev_ts','')}\n"
        f"→ In your new brief, state concisely what has CHANGED since then."
    )


def _watchlist_context(watchlist: List[Dict]) -> str:
    if not watchlist:
        return ""
    countries = [w["label"] for w in watchlist if w.get("type") == "country"][:5]
    markets   = [w["label"] for w in watchlist if w.get("type") == "market"][:5]
    parts = []
    if countries:
        parts.append(f"User follows: {', '.join(countries)}")
    if markets:
        parts.append(f"User tracks markets: {', '.join(markets)}")
    return "WATCHLIST (prioritise in analysis):\n" + "\n".join(parts)


async def _generate_brief(
    bot_id: str, config: Dict, events: List[Dict],
    previous: Optional[Dict] = None, watchlist: Optional[List[Dict]] = None,
) -> Dict:
    cache_key = f"{bot_id}:{config.get('focus','')}:{config.get('tone','')}:{len(events)}"
    cached = _brief_cache.get(cache_key)
    if cached and (time.time() - cached["ts"]) < _CACHE_TTL:
        return cached["data"]

    bot    = DEFAULT_BOTS[bot_id]
    tone   = config.get("tone", "Professional")
    focus  = config.get("focus", bot["defaults"]["focus"])
    custom = (config.get("custom_notes") or "").strip()
    threshold_alerts = _check_threshold_alerts(bot_id, events, config)

    # No events
    if not events:
        result = {
            "headline": f"Quiet — no {focus} events in the last 24h",
            "brief": "Monitoring window is quiet. No significant events match the current filter.",
            "signal": "neutral", "signal_label": "Quiet",
            "key_points": [], "actions": [], "delta": None,
            "threshold_alerts": [], "confidence": 10,
        }
        _brief_cache[cache_key] = {"ts": time.time(), "data": result}
        return result

    # No AI
    if not await ai_available_async():
        high_sev = [e for e in events if float(e.get("severity", 0)) >= 7]
        result = {
            "headline": events[0]["title"][:80],
            "brief": f"{len(events)} events monitored. {len(high_sev)} high-severity. Configure AI for analysis.",
            "signal": "critical" if high_sev else "neutral",
            "signal_label": "Alert" if high_sev else "Monitor",
            "key_points": [e["title"][:70] for e in events[:3]],
            "actions": ["Enable AI provider in Admin → Settings"],
            "delta": None, "threshold_alerts": threshold_alerts, "confidence": 0,
        }
        _brief_cache[cache_key] = {"ts": time.time(), "data": result}
        return result

    tone_map = {
        "Professional": "Write in polished professional analyst style with precise language.",
        "Concise":      "Be extremely concise. Max 2 sentences per section.",
        "Detailed":     "Provide detailed analysis with context, causes, and implications.",
        "Bullet Points": "Use bullet points only. Max 4 bullets. Each must be specific and actionable.",
    }

    ev_lines = []
    for e in events[:10]:
        sev  = float(e.get("severity", 5))
        sent = f" [{e.get('sentiment_tone','')}]" if e.get("sentiment_tone") else ""
        ev_lines.append(
            f"- [{sev:.1f}/10] {e['title']} "
            f"({e.get('country_name','Global')}, {e.get('category','')}){sent}"
        )

    max_sev         = max((float(e.get("severity", 0)) for e in events), default=0)
    confidence_hint = min(100, int(len(events) * 5 + max_sev * 5))

    sections = [
        f"FOCUS: {focus}",
        f"TONE: {tone_map.get(tone, '')}",
        "",
        "EVENTS (last 24h, ranked by severity):",
        "\n".join(ev_lines),
    ]
    fin = _finance_context(bot_id)
    if fin:
        sections += ["", fin]
    delta = _delta_context(previous)
    if delta:
        sections += ["", delta]
    wl = _watchlist_context(watchlist or [])
    if wl:
        sections += ["", wl]
    if custom:
        sections += ["", f"ANALYST NOTES (incorporate this):\n{custom}"]

    sections += [
        "",
        f"Data confidence: {confidence_hint}/100",
        "",
        'Respond ONLY with this JSON (no markdown):',
        '{',
        '  "headline": "one punchy headline ≤90 chars",',
        '  "brief": "2-4 sentence analysis with market/policy implications",',
        '  "signal": "bullish|bearish|neutral|critical",',
        '  "signal_label": "Opportunity|Caution|Monitor|Alert|Quiet",',
        '  "key_points": ["specific point 1","specific point 2","specific point 3"],',
        '  "actions": ["concrete action 1","concrete action 2"],',
        '  "delta_summary": "one sentence on what changed vs previous brief, or null",',
        f'  "confidence": {confidence_hint}',
        '}',
    ]

    prompt = "\n".join(sections)
    raw    = await _call_claude(prompt, system=bot["persona"], max_tokens=520)
    parsed = _parse_json(raw) if raw else None

    if not parsed:
        parsed = {
            "headline":    events[0]["title"][:80],
            "brief":       f"{len(events)} events in {focus}. Key: {events[0]['title'][:80]}.",
            "signal":      "neutral", "signal_label": "Monitor",
            "key_points":  [e["title"][:60] for e in events[:3]],
            "actions":     [], "confidence": confidence_hint,
        }

    # Attach delta metadata
    if previous:
        parsed["delta"] = {
            "prev_signal":     previous.get("_prev_signal", previous.get("signal", "neutral")),
            "signal_changed":  previous.get("_prev_signal", "neutral") != parsed.get("signal"),
            "prev_event_count": previous.get("_prev_event_count", 0),
            "summary":         parsed.pop("delta_summary", None),
        }
    else:
        parsed.pop("delta_summary", None)
        parsed["delta"] = None

    parsed["threshold_alerts"] = threshold_alerts
    parsed.setdefault("confidence", confidence_hint)

    _brief_cache[cache_key] = {"ts": time.time(), "data": parsed}
    return parsed


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/config")
async def get_all_configs(user=Depends(require_user)):
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT bot_id, config_json FROM agent_configs WHERE user_id=?",
                (user["id"],)
            ) as cur:
                rows = await cur.fetchall()
        saved = {r["bot_id"]: json.loads(r["config_json"]) for r in rows}
    except Exception as e:
        logger.warning("get_all_configs: %s", e)
        saved = {}

    result = {}
    for bid, bdef in DEFAULT_BOTS.items():
        merged = dict(bdef["defaults"])
        merged.update(saved.get(bid, {}))
        result[bid] = {**bdef, "config": merged}
    return result


@router.get("/config/{bot_id}")
async def get_bot_config(bot_id: str, user=Depends(require_user)):
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    config = await _load_user_config(user["id"], bot_id)
    return {**DEFAULT_BOTS[bot_id], "config": config}


@router.post("/config/{bot_id}")
async def save_bot_config(bot_id: str, payload: dict = Body(...), user=Depends(require_user)):
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    defaults = DEFAULT_BOTS[bot_id]["defaults"]
    clean = {
        "focus":              str(payload.get("focus",  defaults["focus"]))[:80],
        "tone":               str(payload.get("tone",   defaults["tone"]))[:30],
        "alerts":             str(payload.get("alerts", defaults["alerts"]))[:40],
        "enabled":            bool(payload.get("enabled", True)),
        "severity_threshold": max(1.0, min(10.0, float(payload.get("severity_threshold", defaults["severity_threshold"])))),
        "watch_regions":      [str(r)[:5].upper() for r in (payload.get("watch_regions") or [])[:10]],
        "custom_notes":       str(payload.get("custom_notes") or "")[:500],
    }
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                "INSERT OR REPLACE INTO agent_configs "
                "(user_id, bot_id, config_json, updated_at) VALUES (?, ?, ?, datetime('now'))",
                (user["id"], bot_id, json.dumps(clean))
            )
            await db.commit()
    except Exception as e:
        logger.error("save_bot_config: %s", e)
        return {"error": "save_failed"}
    for k in list(_brief_cache):
        if k.startswith(f"{bot_id}:"):
            del _brief_cache[k]
    return {"status": "saved", "config": clean}


@router.get("/brief/{bot_id}")
async def get_bot_brief(bot_id: str, user=Depends(require_user)):
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    config    = await _load_user_config(user["id"], bot_id)
    events    = await _get_bot_events(bot_id, config)
    previous  = await _load_previous_brief(user["id"], bot_id)
    watchlist = await _load_user_watchlist(user["id"])
    brief     = await _generate_brief(bot_id, config, events, previous, watchlist)
    await _save_brief_history(user["id"], bot_id, brief, len(events))
    return {
        "bot_id": bot_id, "config": config, "event_count": len(events),
        "top_events": [
            {"id": e.get("id",""), "title": e["title"],
             "severity": float(e.get("severity",5)), "country": e.get("country_name",""),
             "category": e.get("category",""), "impact": e.get("impact","")}
            for e in events[:5]
        ],
        **brief,
    }


@router.get("/all-briefs")
async def get_all_briefs(user=Depends(require_user)):
    watchlist = await _load_user_watchlist(user["id"])
    results   = {}
    for bot_id in DEFAULT_BOTS:
        try:
            config = await _load_user_config(user["id"], bot_id)
            if not config.get("enabled", True):
                continue
            events   = await _get_bot_events(bot_id, config)
            previous = await _load_previous_brief(user["id"], bot_id)
            brief    = await _generate_brief(bot_id, config, events, previous, watchlist)
            await _save_brief_history(user["id"], bot_id, brief, len(events))
            results[bot_id] = {
                "bot_id": bot_id, "event_count": len(events),
                "top_events": [
                    {"id": e.get("id",""), "title": e["title"],
                     "severity": float(e.get("severity",5)), "country": e.get("country_name",""),
                     "category": e.get("category",""), "impact": e.get("impact","")}
                    for e in events[:3]
                ],
                **brief,
            }
        except Exception as e:
            logger.error("all-briefs %s: %s", bot_id, e)
    return results


@router.get("/history/{bot_id}")
async def get_brief_history(bot_id: str, limit: int = 7, user=Depends(require_user)):
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT signal, event_count, created_at FROM agent_brief_history "
                "WHERE user_id=? AND bot_id=? ORDER BY created_at DESC LIMIT ?",
                (user["id"], bot_id, limit)
            ) as cur:
                rows = await cur.fetchall()
        return {"bot_id": bot_id, "history": [dict(r) for r in reversed(rows)]}
    except Exception as e:
        logger.warning("get_brief_history: %s", e)
        return {"bot_id": bot_id, "history": []}


@router.post("/reset/{bot_id}")
async def reset_bot_config(bot_id: str, user=Depends(require_user)):
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                "DELETE FROM agent_configs WHERE user_id=? AND bot_id=?",
                (user["id"], bot_id)
            )
            await db.commit()
        for k in list(_brief_cache):
            if k.startswith(f"{bot_id}:"):
                del _brief_cache[k]
        return {"status": "reset", "config": DEFAULT_BOTS[bot_id]["defaults"]}
    except Exception as e:
        return {"error": str(e)}


# ═══════════════════════════════════════════════════════════════════════
# BLOCK B — Engagement
# ═══════════════════════════════════════════════════════════════════════

@router.post("/ask/{bot_id}")
async def ask_bot_inline(bot_id: str, payload: dict = Body(...), user=Depends(require_user)):
    """
    Inline chat with a specific bot — stays inside the card.
    payload: { question: str }
    Returns: { answer: str, bot_id: str }
    """
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    question = (payload.get("question") or "").strip()[:500]
    if not question:
        return {"error": "Empty question"}

    config    = await _load_user_config(user["id"], bot_id)
    events    = await _get_bot_events(bot_id, config, limit=8)
    watchlist = await _load_user_watchlist(user["id"])

    bot     = DEFAULT_BOTS[bot_id]
    focus   = config.get("focus", bot["defaults"]["focus"])
    custom  = (config.get("custom_notes") or "").strip()

    # Build context
    ev_lines = [
        f"- [{float(e.get('severity',5)):.1f}] {e['title']} ({e.get('country_name','')}, {e.get('category','')})"
        for e in events[:6]
    ]
    fin_ctx = _finance_context(bot_id)
    wl_ctx  = _watchlist_context(watchlist)

    prompt = (
        f"USER QUESTION: {question}\n\n"
        f"Bot focus: {focus}\n"
        f"Recent events (last 24h):\n" + "\n".join(ev_lines) + "\n"
        + (f"\n{fin_ctx}\n" if fin_ctx else "")
        + (f"\n{wl_ctx}\n" if wl_ctx else "")
        + (f"\nAnalyst context: {custom}\n" if custom else "")
        + "\nAnswer the user's question concisely and specifically. "
          "Reference real events from the list above when relevant. "
          "Max 200 words. No JSON — just clear prose."
    )

    if not await ai_available_async():
        ev_title = events[0]["title"] if events else "No recent events"
        return {
            "bot_id": bot_id,
            "answer": (
                f"AI provider not configured. Based on {len(events)} events in {focus}: "
                f"most relevant is '{ev_title}'. Enable AI in Admin → Settings for full analysis."
            )
        }

    answer = await _call_claude(prompt, system=bot["persona"], max_tokens=280)
    return {
        "bot_id":  bot_id,
        "answer":  answer or "No response generated.",
        "events_used": len(events),
    }


@router.get("/debate")
async def bot_debate(user=Depends(require_user)):
    """
    Block B — Bot vs Bot cross-analysis.
    All 4 active bots analyse the same top event from their perspective.
    Returns a list of { bot_id, name, icon, color, take } dicts.
    """
    # Pick the single highest-severity event in the last 24h
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM events WHERE datetime(timestamp) > datetime('now','-72 hours') "
                "ORDER BY severity DESC LIMIT 1"
            ) as cur:
                top_row = await cur.fetchone()
    except Exception:
        top_row = None

    if not top_row:
        return {"takes": [], "event": None}

    ev = dict(top_row)
    ev_ctx = (
        f"Event: {ev['title']}\n"
        f"Category: {ev.get('category','')}, Country: {ev.get('country_name','')}, "
        f"Severity: {float(ev.get('severity',5)):.1f}/10\n"
        f"Summary: {(ev.get('summary','') or '')[:200]}"
    )

    takes = []
    for bot_id, bot in DEFAULT_BOTS.items():
        config = await _load_user_config(user["id"], bot_id)
        if not config.get("enabled", True):
            continue
        if not await ai_available_async():
            takes.append({
                "bot_id": bot_id, "name": bot["name"],
                "icon": bot["icon"], "color": bot["color"],
                "take": f"From a {bot['defaults']['focus']} perspective: this event is significant. Enable AI for detailed analysis."
            })
            continue

        prompt = (
            f"{ev_ctx}\n\n"
            f"Your perspective: {bot['defaults']['focus']}\n"
            f"In 2-3 sentences max, what is YOUR specific take on this event from your analytical lens? "
            f"Be direct, specific, and differentiated from other analysts. No hedging."
        )
        ans = await _call_claude(prompt, system=bot["persona"], max_tokens=150)
        takes.append({
            "bot_id": bot_id, "name": bot["name"],
            "icon": bot["icon"], "color": bot["color"],
            "take": ans or f"No take available for {bot['name']}.",
        })

    return {
        "event": {
            "title":    ev["title"],
            "severity": float(ev.get("severity", 5)),
            "country":  ev.get("country_name", ""),
            "category": ev.get("category", ""),
        },
        "takes": takes,
    }


# ═══════════════════════════════════════════════════════════════════════
# BLOCK C — Retention
# ═══════════════════════════════════════════════════════════════════════

# ── Streak helpers ───────────────────────────────────────────────────

async def _update_streak(user_id: int):
    """Call whenever user reads a brief. Updates streak atomically."""
    from datetime import date, timedelta
    today = date.today().isoformat()
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM agent_streaks WHERE user_id=?", (user_id,)
            ) as cur:
                row = await cur.fetchone()

            if not row:
                await db.execute(
                    "INSERT INTO agent_streaks "
                    "(user_id, current_streak, longest_streak, last_activity_date, total_reads) "
                    "VALUES (?, 1, 1, ?, 1)",
                    (user_id, today)
                )
                await db.commit()
                return {"current_streak": 1, "longest_streak": 1, "total_reads": 1}

            r = dict(row)
            last = r.get("last_activity_date", "")
            yesterday = (date.today() - timedelta(days=1)).isoformat()

            if last == today:
                # Already counted today
                return r

            if last == yesterday or r.get("streak_frozen") == 1:
                # Consecutive day or freeze used
                new_streak = r["current_streak"] + 1
                frozen     = 0
            elif last == "":
                new_streak = 1
                frozen     = 0
            else:
                # Streak broken (unless freeze available and not yet used today)
                new_streak = 1
                frozen     = 0

            longest = max(r["longest_streak"], new_streak)
            await db.execute(
                "INSERT OR REPLACE INTO agent_streaks "
                "(user_id, current_streak, longest_streak, last_activity_date, total_reads, streak_frozen, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, datetime('now'))",
                (user_id, new_streak, longest, today, r["total_reads"] + 1, frozen)
            )
            await db.commit()
            return {"current_streak": new_streak, "longest_streak": longest,
                    "total_reads": r["total_reads"] + 1}
    except Exception as e:
        logger.warning("_update_streak %s: %s", user_id, e)
        return {}


@router.get("/streak")
async def get_streak(user=Depends(require_user)):
    """Return current streak stats for the user."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM agent_streaks WHERE user_id=?", (user["id"],)
            ) as cur:
                row = await cur.fetchone()
        if row:
            r = dict(row)
            # Unlock levels based on streak
            level = (
                "platinum" if r["current_streak"] >= 30 else
                "gold"     if r["current_streak"] >= 14 else
                "silver"   if r["current_streak"] >= 7  else
                "bronze"   if r["current_streak"] >= 3  else
                "new"
            )
            r["level"]      = level
            r["next_level"] = _streak_next_level(r["current_streak"])
            return r
        return {
            "current_streak": 0, "longest_streak": 0, "total_reads": 0,
            "level": "new", "next_level": {"days": 3, "name": "bronze"},
            "streak_frozen": 0,
        }
    except Exception as e:
        logger.warning("get_streak: %s", e)
        return {"current_streak": 0}


def _streak_next_level(current: int) -> dict:
    thresholds = [
        {"days": 3,  "name": "bronze",   "perk": "Extended brief (500 tokens)"},
        {"days": 7,  "name": "silver",   "perk": "Signal sparkline + history"},
        {"days": 14, "name": "gold",     "perk": "Bot vs Bot debate unlocked"},
        {"days": 30, "name": "platinum", "perk": "Predict & Verify + weekly digest"},
    ]
    for t in thresholds:
        if current < t["days"]:
            return t
    return {"days": 30, "name": "platinum", "perk": "All features unlocked"}


@router.post("/streak/freeze")
async def use_streak_freeze(user=Depends(require_user)):
    """Use the streak freeze (once per week) to preserve streak on a missed day."""
    from datetime import date, timedelta
    today = date.today().isoformat()
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM agent_streaks WHERE user_id=?", (user["id"],)
            ) as cur:
                row = await cur.fetchone()

        if not row:
            return {"error": "No streak to freeze"}

        r = dict(row)
        last_freeze = r.get("freeze_used_date", "")
        # Allow one freeze per 7 days
        if last_freeze:
            from datetime import datetime
            days_ago = (date.today() - date.fromisoformat(last_freeze)).days
            if days_ago < 7:
                return {"error": f"Freeze available in {7 - days_ago} day(s)"}

        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                "UPDATE agent_streaks SET streak_frozen=1, freeze_used_date=? WHERE user_id=?",
                (today, user["id"])
            )
            await db.commit()
        return {"status": "freeze_applied", "streak": r["current_streak"]}
    except Exception as e:
        return {"error": str(e)}


# ── Predict & Verify ─────────────────────────────────────────────────

import re as _re
from datetime import datetime as _dt, timedelta as _td

def _week_key(dt: _dt = None) -> str:
    d = dt or _dt.utcnow()
    return d.strftime("%Y-W%W")

def _is_friday() -> bool:
    return _dt.utcnow().weekday() == 4

def _is_monday() -> bool:
    return _dt.utcnow().weekday() == 0


@router.get("/predict/{bot_id}")
async def get_prediction(bot_id: str, user=Depends(require_user)):
    """Get this week's prediction for a bot, generating if needed (runs on Friday)."""
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}

    week = _week_key()
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM agent_predictions WHERE user_id=? AND bot_id=? AND week_key=?",
                (user["id"], bot_id, week)
            ) as cur:
                row = await cur.fetchone()

        if row:
            pred = dict(row)
            pred["prediction"] = json.loads(pred["prediction_json"])
            if pred.get("verify_json"):
                pred["verify"] = json.loads(pred["verify_json"])
            return pred

        # Generate new prediction
        config = await _load_user_config(user["id"], bot_id)
        events = await _get_bot_events(bot_id, config, limit=10)
        if not events:
            return {"week_key": week, "prediction": None, "message": "No events to predict from"}

        prediction = await _generate_prediction(bot_id, config, events)
        if prediction:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute(
                    "INSERT OR REPLACE INTO agent_predictions "
                    "(user_id, bot_id, week_key, prediction_json) VALUES (?, ?, ?, ?)",
                    (user["id"], bot_id, week, json.dumps(prediction))
                )
                await db.commit()

        return {"week_key": week, "prediction": prediction, "verify": None}
    except Exception as e:
        logger.error("get_prediction %s: %s", bot_id, e)
        return {"error": str(e)}


@router.get("/predict/all/this-week")
async def get_all_predictions(user=Depends(require_user)):
    """Get all 4 bots' predictions for this week, generating missing ones."""
    week   = _week_key()
    result = {}
    for bot_id in DEFAULT_BOTS:
        config = await _load_user_config(user["id"], bot_id)
        if not config.get("enabled", True):
            continue
        try:
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT * FROM agent_predictions WHERE user_id=? AND bot_id=? AND week_key=?",
                    (user["id"], bot_id, week)
                ) as cur:
                    row = await cur.fetchone()

            if row:
                p = dict(row)
                p["prediction"] = json.loads(p["prediction_json"])
                if p.get("verify_json"):
                    p["verify"] = json.loads(p["verify_json"])
                result[bot_id] = p
            else:
                # Generate on demand
                events = await _get_bot_events(bot_id, config, limit=10)
                pred   = await _generate_prediction(bot_id, config, events)
                if pred:
                    async with aiosqlite.connect(settings.db_path) as db:
                        await db.execute(
                            "INSERT OR REPLACE INTO agent_predictions "
                            "(user_id, bot_id, week_key, prediction_json) VALUES (?, ?, ?, ?)",
                            (user["id"], bot_id, week, json.dumps(pred))
                        )
                        await db.commit()
                    result[bot_id] = {"week_key": week, "prediction": pred, "verify": None}
        except Exception as e:
            logger.error("all predictions %s: %s", bot_id, e)
    return result


async def _generate_prediction(bot_id: str, config: Dict, events: List[Dict]) -> Optional[Dict]:
    """Generate a specific, verifiable weekly prediction."""
    if not await ai_available_async() or not events:
        # Fallback: rule-based
        top = events[0] if events else {}
        return {
            "headline": f"Continued volatility in {config.get('focus','this area')} this week",
            "direction": "bearish" if top.get("severity", 0) >= 7 else "neutral",
            "confidence": 45,
            "key_topics": [e["title"][:50] for e in events[:3]],
            "rationale": f"Based on {len(events)} events. Enable AI for deeper forecasting.",
        }

    bot = DEFAULT_BOTS[bot_id]
    focus = config.get("focus", bot["defaults"]["focus"])
    ev_lines = "\n".join(
        f"- [{float(e.get('severity',5)):.1f}] {e['title']} ({e.get('category','')})"
        for e in events[:8]
    )
    fin_ctx = _finance_context(bot_id)

    prompt = (
        f"Focus: {focus}\n"
        f"Current events this week:\n{ev_lines}\n"
        + (f"\n{fin_ctx}\n" if fin_ctx else "") +
        "\nMake ONE specific, falsifiable prediction for NEXT WEEK in your domain. "
        "It must be concrete enough to verify as correct/incorrect in 7 days. "
        "Respond ONLY with this JSON:\n"
        '{"headline":"specific prediction in one sentence",'
        '"direction":"bullish|bearish|neutral|volatile",'
        '"confidence":75,'
        '"key_topics":["topic1","topic2"],'
        '"rationale":"2-sentence reasoning"}'
    )
    raw    = await _call_claude(prompt, system=bot["persona"], max_tokens=200)
    parsed = _parse_json(raw) if raw else None
    if not parsed:
        return {
            "headline": f"{focus} conditions remain uncertain next week",
            "direction": "neutral", "confidence": 40,
            "key_topics": [e["title"][:50] for e in events[:2]],
            "rationale": "Insufficient data for high-confidence forecast.",
        }
    return parsed


@router.post("/verify/{bot_id}/{week_key}")
async def verify_prediction(bot_id: str, week_key: str, user=Depends(require_user)):
    """
    Monday job: auto-verify last week's prediction against actual events.
    Can also be called manually.
    """
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM agent_predictions WHERE user_id=? AND bot_id=? AND week_key=?",
                (user["id"], bot_id, week_key)
            ) as cur:
                row = await cur.fetchone()

        if not row:
            return {"error": "Prediction not found"}
        pred_data = dict(row)
        if pred_data.get("verify_json"):
            return {"status": "already_verified", "verify": json.loads(pred_data["verify_json"])}

        prediction = json.loads(pred_data["prediction_json"])

        # Fetch events from the predicted week
        config   = await _load_user_config(user["id"], bot_id)
        events   = await _get_bot_events(bot_id, config, limit=15)

        verify = await _verify_prediction_ai(bot_id, prediction, events)

        async with aiosqlite.connect(settings.db_path) as db:
            await db.execute(
                "UPDATE agent_predictions SET verify_json=?, verify_ts=datetime('now'), "
                "accuracy_score=? WHERE user_id=? AND bot_id=? AND week_key=?",
                (json.dumps(verify), verify.get("score", 0.5),
                 user["id"], bot_id, week_key)
            )
            await db.commit()
        return {"status": "verified", "verify": verify}
    except Exception as e:
        logger.error("verify_prediction: %s", e)
        return {"error": str(e)}


async def _verify_prediction_ai(bot_id: str, prediction: Dict, events: List[Dict]) -> Dict:
    if not await ai_available_async():
        return {
            "outcome": "unverifiable",
            "score": 0.5,
            "explanation": "Enable AI provider to auto-verify predictions.",
            "matched_events": [],
        }
    bot = DEFAULT_BOTS[bot_id]
    ev_lines = "\n".join(
        f"- [{float(e.get('severity',5)):.1f}] {e['title']}"
        for e in events[:10]
    )
    prompt = (
        f"PREDICTION MADE LAST WEEK:\n"
        f"Headline: {prediction.get('headline','')}\n"
        f"Direction: {prediction.get('direction','')}\n"
        f"Confidence: {prediction.get('confidence',50)}%\n\n"
        f"WHAT ACTUALLY HAPPENED THIS WEEK:\n{ev_lines}\n\n"
        "Evaluate: was the prediction correct, partially correct, or incorrect?\n"
        "Respond ONLY with JSON:\n"
        '{"outcome":"correct|partial|incorrect","score":0.8,'
        '"explanation":"one sentence verdict","matched_events":["event title that matched"]}'
    )
    raw    = await _call_claude(prompt, system=bot["persona"], max_tokens=180)
    parsed = _parse_json(raw) if raw else None
    return parsed or {"outcome": "unverifiable", "score": 0.5,
                      "explanation": "Verification failed.", "matched_events": []}


@router.get("/accuracy/{bot_id}")
async def get_bot_accuracy(bot_id: str, user=Depends(require_user)):
    """Return historical prediction accuracy for a bot."""
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT week_key, prediction_json, verify_json, accuracy_score "
                "FROM agent_predictions "
                "WHERE user_id=? AND bot_id=? AND accuracy_score IS NOT NULL "
                "ORDER BY week_key DESC LIMIT 8",
                (user["id"], bot_id)
            ) as cur:
                rows = await cur.fetchall()

        records = []
        for r in rows:
            p = json.loads(r["prediction_json"])
            v = json.loads(r["verify_json"]) if r["verify_json"] else {}
            records.append({
                "week_key":   r["week_key"],
                "prediction": p.get("headline", ""),
                "outcome":    v.get("outcome", "pending"),
                "score":      r["accuracy_score"],
            })

        avg_score = sum(r["score"] for r in records) / len(records) if records else None
        return {"bot_id": bot_id, "records": records, "avg_accuracy": avg_score}
    except Exception as e:
        return {"bot_id": bot_id, "records": [], "avg_accuracy": None}


# ── Daily digest (scheduled + on-demand) ────────────────────────────

@router.get("/digest/{bot_id}")
async def get_daily_digest(bot_id: str, user=Depends(require_user)):
    """
    On-demand daily digest for a bot: top 3 events + one-line brief.
    Skips if already generated today.
    """
    if bot_id not in DEFAULT_BOTS:
        return {"error": "Unknown bot"}

    from datetime import date
    today = date.today().isoformat()

    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT sent_at FROM agent_digest_log WHERE user_id=? AND bot_id=? AND digest_date=?",
                (user["id"], bot_id, today)
            ) as cur:
                sent = await cur.fetchone()

        config    = await _load_user_config(user["id"], bot_id)
        events    = await _get_bot_events(bot_id, config, limit=5)
        watchlist = await _load_user_watchlist(user["id"])

        digest = await _generate_digest(bot_id, config, events)

        # Mark as sent
        if not sent:
            async with aiosqlite.connect(settings.db_path) as db:
                await db.execute(
                    "INSERT OR IGNORE INTO agent_digest_log (user_id, bot_id, digest_date) "
                    "VALUES (?, ?, ?)",
                    (user["id"], bot_id, today)
                )
                await db.commit()

        # Update streak
        streak = await _update_streak(user["id"])

        return {
            "bot_id": bot_id, "date": today,
            "digest": digest, "streak": streak,
            "fresh": not bool(sent),
        }
    except Exception as e:
        logger.error("get_daily_digest %s: %s", bot_id, e)
        return {"error": str(e)}


@router.get("/digest/all/today")
async def get_all_digests(user=Depends(require_user)):
    """Get morning digest for all 4 bots at once."""
    from datetime import date
    today   = date.today().isoformat()
    results = {}
    for bot_id in DEFAULT_BOTS:
        config = await _load_user_config(user["id"], bot_id)
        if not config.get("enabled", True):
            continue
        events = await _get_bot_events(bot_id, config, limit=5)
        digest = await _generate_digest(bot_id, config, events)
        results[bot_id] = {"date": today, "digest": digest}

    streak = await _update_streak(user["id"])
    return {"results": results, "streak": streak, "date": today}


async def _generate_digest(bot_id: str, config: Dict, events: List[Dict]) -> Dict:
    """Short 3-item digest — fast, low token count."""
    bot   = DEFAULT_BOTS[bot_id]
    focus = config.get("focus", bot["defaults"]["focus"])

    if not events:
        return {
            "summary": f"Quiet morning in {focus}. No significant events detected.",
            "top3": [], "signal": "neutral",
        }

    if not await ai_available_async():
        return {
            "summary": f"Top event: {events[0]['title'][:80]}",
            "top3": [{"title": e["title"][:70], "severity": float(e.get("severity",5)),
                      "country": e.get("country_name","")} for e in events[:3]],
            "signal": "critical" if any(float(e.get("severity",0))>=7 for e in events) else "neutral",
        }

    ev_lines = "\n".join(
        f"- [{float(e.get('severity',5)):.1f}] {e['title']} ({e.get('country_name','')})"
        for e in events[:5]
    )
    prompt = (
        f"Morning digest for {focus}. Events:\n{ev_lines}\n\n"
        "Write a 1-sentence morning briefing. Then pick the top 3 items.\n"
        "JSON only:\n"
        '{"summary":"one sentence morning brief",'
        '"top3":[{"title":"...","severity":7.0,"country":"..."}],'
        '"signal":"bullish|bearish|neutral|critical"}'
    )
    raw    = await _call_claude(prompt, system=bot["persona"], max_tokens=200)
    parsed = _parse_json(raw) if raw else None
    if not parsed:
        return {
            "summary": events[0]["title"][:80],
            "top3": [{"title": e["title"][:60], "severity": float(e.get("severity",5)),
                      "country": e.get("country_name","")} for e in events[:3]],
            "signal": "neutral",
        }
    return parsed


# ── Update brief endpoint to also update streak ─────────────────────
# Monkey-patch get_bot_brief to call _update_streak
_original_get_brief = get_bot_brief

@router.get("/brief-with-streak/{bot_id}")
async def get_brief_and_streak(bot_id: str, user=Depends(require_user)):
    """Alias of /brief/{bot_id} that also updates the streak."""
    result = await get_bot_brief(bot_id, user)
    streak = await _update_streak(user["id"])
    result["streak"] = streak
    return result
