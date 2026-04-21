"""World Lens — Crisis Early Warning + Supply Chain Intelligence"""
from __future__ import annotations
import json
import math
import logging
import aiosqlite
from datetime import datetime, timedelta, date
from typing import List, Dict, Optional
from fastapi import APIRouter, Depends, Body, Query
from auth import require_user
from config import settings
from ai_layer import _call_claude, _parse_json, _ai_available, ai_available_async

router = APIRouter(prefix="/api/intelligence", tags=["intelligence"])
logger = logging.getLogger(__name__)

# ── DB setup ─────────────────────────────────────────
async def _ensure_tables(db):
    await db.executescript("""
    CREATE TABLE IF NOT EXISTS crisis_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        signal_type TEXT NOT NULL,
        region TEXT NOT NULL,
        country_code TEXT DEFAULT 'XX',
        severity REAL DEFAULT 5.0,
        description TEXT NOT NULL,
        indicators TEXT DEFAULT '{}',
        confidence REAL DEFAULT 0.5,
        status TEXT DEFAULT 'active',
        ai_assessment TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS supply_chain_risks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        risk_type TEXT NOT NULL,
        location TEXT NOT NULL,
        country_code TEXT DEFAULT 'XX',
        latitude REAL DEFAULT 0.0,
        longitude REAL DEFAULT 0.0,
        severity REAL DEFAULT 5.0,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        affected_sectors TEXT DEFAULT '[]',
        affected_routes TEXT DEFAULT '[]',
        estimated_duration TEXT DEFAULT 'Unknown',
        status TEXT DEFAULT 'active',
        source TEXT DEFAULT 'AI Analysis',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ew_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        snapshot_date TEXT NOT NULL UNIQUE,
        global_ew_score REAL DEFAULT 5.0,
        sentiment_trend REAL DEFAULT 0.0,
        macro_stress REAL DEFAULT 5.0,
        market_stress REAL DEFAULT 5.0,
        event_velocity REAL DEFAULT 0.0,
        ai_assessment TEXT DEFAULT '',
        top_risks TEXT DEFAULT '[]',
        created_at TEXT DEFAULT (datetime('now'))
    );
    """)
    await db.commit()


# ── Signal classification ─────────────────────────────
CRISIS_PATTERNS = {
    "CONFLICT_ESCALATION": {
        "keywords": ["military","offensive","troops","airstrike","escalation","invasion",
                     "mobilization","strike","attack","missile","drone strike","war","combat",
                     "ceasefire","casualties","frontline","shelling"],
        "weight": 0.9, "icon": "⚔️", "color": "#EF4444"
    },
    "ECONOMIC_STRESS": {
        "keywords": ["recession","default","collapse","crash","crisis","inflation","stagflation",
                     "debt","banking","rate hike","yield","currency","devaluation","tariff",
                     "trade war","gdp","contraction","unemployment","bailout"],
        "weight": 0.8, "icon": "📉", "color": "#F97316"
    },
    "POLITICAL_INSTABILITY": {
        "keywords": ["coup","protest","riot","election","unrest","overthrow","sanctions",
                     "impeach","resign","parliament","opposition","authoritarian","crackdown",
                     "censorship","martial law","state of emergency"],
        "weight": 0.7, "icon": "🏛️", "color": "#8B5CF6"
    },
    "SUPPLY_DISRUPTION": {
        "keywords": ["port","shipping","blockade","shortage","supply chain","logistics","cargo",
                     "container","chokepoint","suez","hormuz","red sea","houthi","disruption",
                     "semiconductor","chip","rare earth","critical mineral"],
        "weight": 0.75, "icon": "🚢", "color": "#F59E0B"
    },
    "ENERGY_CRISIS": {
        "keywords": ["oil","gas","energy","pipeline","opec","refinery","embargo","blackout",
                     "lng","nuclear","power grid","electricity","fuel","petrochemical",
                     "energy security","natural gas","crude"],
        "weight": 0.8, "icon": "⚡", "color": "#EAB308"
    },
    "HUMANITARIAN": {
        "keywords": ["famine","refugee","displacement","humanitarian","civilian","aid",
                     "starvation","cholera","epidemic","flood","earthquake","wildfire",
                     "climate","drought","displaced","food insecurity"],
        "weight": 0.6, "icon": "🚨", "color": "#EC4899"
    },
    "NUCLEAR_CHEMICAL": {
        "keywords": ["nuclear","chemical weapon","biological","radiological","wmd",
                     "radiation","fallout","detonation","reactor","enrichment","nonproliferation"],
        "weight": 1.0, "icon": "☢️", "color": "#DC2626"
    },
    "CYBER_INFORMATION": {
        "keywords": ["cyberattack","cyber","hack","ransomware","disinformation","propaganda",
                     "interference","infrastructure attack","grid attack","data breach"],
        "weight": 0.65, "icon": "💻", "color": "#7C3AED"
    },
}

SUPPLY_CHAIN_NODES = [
    {"id":"suez",    "name":"Suez Canal",         "lat":30.42, "lon":32.34, "type":"CHOKEPOINT",   "icon":"🚢", "risk_base":4.0},
    {"id":"hormuz",  "name":"Strait of Hormuz",   "lat":26.58, "lon":56.43, "type":"CHOKEPOINT",   "icon":"🛢️", "risk_base":6.5},
    {"id":"malacca", "name":"Strait of Malacca",  "lat":2.50,  "lon":101.3, "type":"CHOKEPOINT",   "icon":"🚢", "risk_base":4.5},
    {"id":"bosphorus","name":"Bosphorus Strait",  "lat":41.08, "lon":29.05, "type":"CHOKEPOINT",   "icon":"🚢", "risk_base":3.5},
    {"id":"panama",  "name":"Panama Canal",       "lat":9.08,  "lon":-79.68,"type":"CHOKEPOINT",   "icon":"🚢", "risk_base":4.0},
    {"id":"shanghai","name":"Port of Shanghai",   "lat":31.38, "lon":121.48,"type":"MAJOR_PORT",   "icon":"🏭", "risk_base":3.0},
    {"id":"rotterdam","name":"Port of Rotterdam", "lat":51.89, "lon":4.48,  "type":"MAJOR_PORT",   "icon":"🏭", "risk_base":2.5},
    {"id":"singapore","name":"Port of Singapore", "lat":1.26,  "lon":103.82,"type":"MAJOR_PORT",   "icon":"🏭", "risk_base":2.5},
    {"id":"losangeles","name":"Port of LA/LB",   "lat":33.72, "lon":-118.26,"type":"MAJOR_PORT",  "icon":"🏭", "risk_base":2.0},
    {"id":"dubai",   "name":"Jebel Ali Port",    "lat":24.97, "lon":55.07, "type":"MAJOR_PORT",   "icon":"🏭", "risk_base":3.0},
    {"id":"taiwan_strait","name":"Taiwan Strait","lat":24.5,  "lon":119.5, "type":"CHOKEPOINT",   "icon":"⚠️", "risk_base":7.5},
    {"id":"ukraine_grain","name":"Black Sea / Grain Corridor","lat":46.5,"lon":31.2,"type":"TRADE_ROUTE","icon":"🌾","risk_base":8.0},
    {"id":"redsea",  "name":"Red Sea Corridor",  "lat":19.5,  "lon":39.5,  "type":"TRADE_ROUTE",   "icon":"🚢", "risk_base":8.5},
    {"id":"arctic",  "name":"Arctic Route",      "lat":75.0,  "lon":30.0,  "type":"EMERGING_ROUTE","icon":"❄️", "risk_base":3.0},
    {"id":"tsmc",    "name":"Taiwan Semiconductors","lat":24.78,"lon":120.99,"type":"CRITICAL_NODE","icon":"💻","risk_base":7.0},
    {"id":"spodumene","name":"Lithium Belt (Australia)","lat":-29.5,"lon":119.5,"type":"CRITICAL_NODE","icon":"🔋","risk_base":3.5},
    {"id":"congo_cobalt","name":"DRC Cobalt Mines","lat":-4.5,"lon":26.5,"type":"CRITICAL_NODE","icon":"⛏️","risk_base":6.5},
    {"id":"gulf_oil","name":"Persian Gulf Oil Fields","lat":26.0,"lon":51.5,"type":"CRITICAL_NODE","icon":"🛢️","risk_base":6.0},
]

def _detect_sc_relevance(text: str) -> List[str]:
    """Return list of supply chain node IDs relevant to text."""
    tl = text.lower()
    hits = []
    kw_map = {
        "suez":        ["suez","red sea","houthi","yemen","bab el"],
        "hormuz":      ["hormuz","gulf","iran","persian"],
        "malacca":     ["malacca","singapore","indonesia","malaysia"],
        "bosphorus":   ["bosphorus","black sea","turkey","ukraine","russia"],
        "panama":      ["panama","canal","central america"],
        "taiwan_strait":["taiwan","strait","pla","china military"],
        "ukraine_grain":["ukraine","grain","wheat","black sea","odessa"],
        "redsea":      ["red sea","houthi","shipping attack","yemen"],
        "tsmc":        ["tsmc","taiwan","semiconductor","chip","taiwan strait"],
        "congo_cobalt":["congo","cobalt","drc","mining","critical mineral"],
        "gulf_oil":    ["opec","gulf","saudi","uae","oil field","iraq"],
        "shanghai":    ["shanghai","china port","lockdown","covid china"],
        "rotterdam":   ["rotterdam","europe port","north sea"],
    }
    for node_id, keywords in kw_map.items():
        if any(kw in tl for kw in keywords):
            hits.append(node_id)
    return hits


def _compute_ew_score_rule_based(events: List[Dict], indicators: List[Dict]) -> Dict:
    """
    Compute Early Warning score without AI.
    Multi-factor scoring across velocity, severity, sentiment, macro, crisis patterns.
    """
    if not events:
        return {
            "global_ew_score": 3.0, "sentiment_trend": 0.0,
            "macro_stress": 4.0, "market_stress": 4.0, "event_velocity": 0.0,
        }

    now = datetime.utcnow()

    def _age_hours(ev):
        try:
            return (now - datetime.fromisoformat(ev["timestamp"].replace("Z",""))).total_seconds() / 3600
        except Exception:
            return 999

    recent = [e for e in events if _age_hours(e) < 24]
    prior  = [e for e in events if 24 <= _age_hours(e) < 48]

    # ── Event velocity (ratio recent/prior, normalised)
    vel_raw  = (len(recent) / 24) / max(len(prior) / 24, 0.1) if prior else 1.0
    velocity = round(min(3.0, vel_raw), 3)

    # ── Severity metrics
    sevs     = [float(e.get("severity", 5)) for e in recent[:40]]
    avg_sev  = sum(sevs) / max(len(sevs), 1)
    max_sev  = max(sevs) if sevs else 5.0
    high_cnt = sum(1 for e in recent if str(e.get("impact","")).lower() == "high")
    high_ratio = high_cnt / max(len(recent), 1)

    # ── Crisis category weighting
    CAT_WEIGHTS = {
        "CONFLICT": 1.0, "MILITARY": 1.0, "SECURITY": 0.9,
        "DISASTER": 0.8, "HUMANITARIAN": 0.7,
        "ECONOMICS": 0.8, "ENERGY": 0.75,
        "TECHNOLOGY": 0.5, "POLITICS": 0.65,
    }
    weighted_sev = 0.0
    weight_sum   = 0.0
    for e in recent[:40]:
        w = CAT_WEIGHTS.get(e.get("category","").upper(), 0.5)
        weighted_sev += float(e.get("severity", 5)) * w
        weight_sum   += w
    cat_score = (weighted_sev / max(weight_sum, 1))

    # ── Macro stress from indicators
    macro_stress = 5.0
    for ind in indicators:
        name = ind.get("name","").upper()
        val  = float(ind.get("value") or 0)
        if "VIX" in name:
            macro_stress = max(macro_stress, min(10, val / 3.5))
        elif "YIELD" in name and "10" in name:
            # Inverted yield → stress signal
            if val > 5.0:
                macro_stress = max(macro_stress, min(10, val))
        elif "PMI" in name:
            if val < 48:
                macro_stress = max(macro_stress, min(10, (50 - val) * 1.5 + 4))
        elif "UNEMPLOY" in name:
            if val > 6.0:
                macro_stress = max(macro_stress, min(10, val * 0.9))

    # ── Sentiment trend (negative category ratio, weighted by recency)
    neg_cats   = {"CONFLICT","SECURITY","DISASTER","HUMANITARIAN","MILITARY"}
    neg_recent = sum(1 for e in recent if e.get("category","").upper() in neg_cats)
    neg_prior  = sum(1 for e in prior  if e.get("category","").upper() in neg_cats)
    neg_ratio_r = neg_recent / max(len(recent), 1)
    neg_ratio_p = neg_prior  / max(len(prior),  1)
    sentiment_trend = round(-(neg_ratio_r - neg_ratio_p * 0.5) - neg_ratio_r * 0.3, 3)

    # ── Market stress
    market_stress = round(min(10, 2.5
        + cat_score  * 0.45
        + high_ratio * 2.5
        + (velocity - 1.0) * 1.2
    ), 1)

    # ── Global EW score (weighted composite)
    ew_score = round(min(10, max(1,
        cat_score  * 0.30
        + macro_stress  * 0.25
        + market_stress * 0.25
        + min(10, avg_sev + (velocity - 1.0) * 1.5) * 0.20
    )), 1)

    return {
        "global_ew_score": ew_score,
        "sentiment_trend": round(sentiment_trend, 3),
        "macro_stress":    round(macro_stress, 1),
        "market_stress":   market_stress,
        "event_velocity":  velocity,
    }


# ── CRISIS EARLY WARNING ──────────────────────────────

@router.get("/early-warning")
async def get_early_warning():
    """
    Crisis Early Warning dashboard — aggregates sentiment, macro,
    market stress and event velocity into a unified threat score.
    """
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)

        # Check snapshot cache (valid for 30 min)
        today = date.today().isoformat()
        async with db.execute(
            "SELECT * FROM ew_snapshots WHERE snapshot_date=? AND "
            "datetime(created_at) > datetime('now','-30 minutes')", (today,)
        ) as c:
            snap = await c.fetchone()
        if snap:
            s = dict(snap)
            s["top_risks"] = json.loads(s.get("top_risks") or "[]")
            # Invalidate cache if assessment is suspiciously short (truncated)
            assess = s.get("ai_assessment", "")
            if assess and len(assess) < 120 and not assess.rstrip().endswith((".", "!", "?")):
                pass  # fall through to regenerate
            else:
                s["cached"] = True
                return s

        # Load data
        async with db.execute(
            "SELECT * FROM events WHERE datetime(timestamp) > datetime('now','-72 hours') "
            "ORDER BY severity DESC LIMIT 100"
        ) as c:
            events = [dict(r) for r in await c.fetchall()]
        async with db.execute("SELECT * FROM macro_indicators") as c:
            indicators = [dict(r) for r in await c.fetchall()]

    # Compute rule-based baseline
    scores = _compute_ew_score_rule_based(events, indicators)

    # Detect crisis signals from events
    signal_counts: Dict[str, float] = {}
    signal_regions: Dict[str, List[str]] = {}
    for ev in events[:50]:
        text = (ev.get("title","") + " " + (ev.get("summary") or "")).lower()
        for sig_type, cfg in CRISIS_PATTERNS.items():
            hits = sum(1 for kw in cfg["keywords"] if kw in text)
            if hits >= 1:
                signal_counts[sig_type] = signal_counts.get(sig_type, 0) + hits * cfg["weight"]
                cc = ev.get("country_code", "XX")
                if cc != "XX":
                    signal_regions.setdefault(sig_type, [])
                    if cc not in signal_regions[sig_type]:
                        signal_regions[sig_type].append(cc)

    # Build top_risks list
    top_risks = []
    for sig_type, count in sorted(signal_counts.items(), key=lambda x: -x[1])[:6]:
        cfg = CRISIS_PATTERNS[sig_type]
        risk_level = min(10, count * 0.4)
        top_risks.append({
            "type": sig_type,
            "label": sig_type.replace("_", " ").title(),
            "icon": cfg["icon"],
            "color": cfg["color"],
            "score": round(risk_level, 1),
            "regions": signal_regions.get(sig_type, [])[:4],
        })

    # AI assessment — deep structured reasoning
    ai_assessment = ""
    if await ai_available_async() and events:
        ev_summary = "\n".join([
            f"[{e.get('category','?')}][sev={e.get('severity',5):.0f}][{e.get('country_name','Global')}] "
            f"{e.get('title','')} — {(e.get('ai_summary') or e.get('summary',''))[:120]}"
            for e in events[:20]
        ])
        ind_summary = "\n".join([
            f"{i.get('name','')}: {i.get('value','')} {i.get('unit','')} (trend: {i.get('trend','stable')})"
            for i in indicators[:10]
        ])
        # Build detected patterns summary
        pattern_txt = ", ".join([
            f"{p['label']} ({p['score']}/10)" for p in top_risks[:4]
        ]) if top_risks else "None detected"

        system = (
            "You are a senior geopolitical risk analyst at a top-tier intelligence firm. "
            "You think in structured analytical frameworks: PMESII (Political, Military, Economic, "
            "Social, Infrastructure, Information), Red Cell analysis, and escalation ladders. "
            "Your assessments are read by risk managers, hedge funds, and policy-makers. "
            "Be precise, calibrated, and cite specific signals from the data. "
            "Never speculate without grounding in the provided events. "
            "Write in clear, direct prose — no bullet points, no hedging filler."
        )
        # Keep prompt short to stay well under token limits
        top_events_txt = "\n".join([
            f"- [{e.get('category','?')}] {e.get('title','')} ({e.get('country_name','Global')}, sev={e.get('severity',5):.0f})"
            for e in events[:12]
        ])
        prompt = (
            f"Global EW Score: {scores['global_ew_score']}/10 | "
            f"Macro Stress: {scores['macro_stress']}/10 | "
            f"Market Stress: {scores['market_stress']}/10 | "
            f"Event Velocity: {scores['event_velocity']:.2f}x\n"
            f"Crisis patterns: {pattern_txt}\n\n"
            f"Top events (last 72h):\n{top_events_txt}\n\n"
            f"Write a 3-paragraph intelligence assessment (150-180 words total):\n"
            f"Para 1: Current threat level and why the EW score is {scores['global_ew_score']}/10.\n"
            f"Para 2: The primary escalation risk to watch in the next 7 days and its trigger conditions.\n"
            f"Para 3: One second-order effect risk managers may be underpricing, and two observable "
            f"signals that would confirm or deny escalation.\n"
            f"No headers, no bullets, direct prose only."
        )
        ai_assessment = await _call_claude(prompt, system=system, max_tokens=700) or ""

    result = {
        **scores,
        "top_risks": top_risks,
        "ai_assessment": ai_assessment or (
            "EW Score " + str(scores["global_ew_score"]) + "/10. "
            + str(len(events)) + " events analyzed in 48h window. "
            + ("Event velocity " + ("accelerating" if scores["event_velocity"] > 1.2 else "stable") + ". ")
            + "Configure an AI provider in Admin → Settings to enable AI crisis assessment."
        ),
        "event_count_48h": len(events),
        "cached": False,
    }

    # Cache snapshot
    async with aiosqlite.connect(settings.db_path) as db:
        await _ensure_tables(db)
        await db.execute(
            "INSERT OR REPLACE INTO ew_snapshots "
            "(snapshot_date,global_ew_score,sentiment_trend,macro_stress,"
            "market_stress,event_velocity,ai_assessment,top_risks) VALUES (?,?,?,?,?,?,?,?)",
            (today, result["global_ew_score"], result["sentiment_trend"],
             result["macro_stress"], result["market_stress"],
             result["event_velocity"], result["ai_assessment"],
             json.dumps(top_risks))
        )
        await db.commit()

    return result


@router.get("/early-warning/timeline")
async def get_ew_timeline():
    """Historical EW scores over last 7 days."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT snapshot_date, global_ew_score, sentiment_trend, "
            "macro_stress, market_stress, event_velocity "
            "FROM ew_snapshots ORDER BY snapshot_date DESC LIMIT 14"
        ) as c:
            rows = [dict(r) for r in await c.fetchall()]
    return rows


@router.get("/early-warning/signals")
async def get_active_signals():
    """Return currently active crisis signals."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        # Auto-generate signals from recent events
        async with db.execute(
            "SELECT * FROM events WHERE datetime(timestamp) > datetime('now','-72 hours') "
            "ORDER BY severity DESC LIMIT 80"
        ) as c:
            events = [dict(r) for r in await c.fetchall()]

    # Build signals: max 2 per type, deduplicate by event ID, sort by severity
    signals = []
    seen_ids: set = set()
    type_counts: dict = {}

    for ev in events:
        if ev.get("id") in seen_ids:
            continue
        text = (ev.get("title","") + " " + (ev.get("summary") or "")).lower()
        for sig_type, cfg in CRISIS_PATTERNS.items():
            hits = sum(1 for kw in cfg["keywords"] if kw in text)
            if hits < 1:
                continue
            # Max 3 signals per type to avoid repetition
            if type_counts.get(sig_type, 0) >= 3:
                continue
            seen_ids.add(ev.get("id",""))
            type_counts[sig_type] = type_counts.get(sig_type, 0) + 1
            sev = float(ev.get("severity", 5.0))
            conf = min(1.0, round(hits * cfg["weight"] / 5, 2))
            # value: severity score (shown as the main metric)
            # delta: confidence level as percentage
            # meta: region + event title snippet
            summary_text = (ev.get("ai_summary") or ev.get("summary") or ev.get("title",""))[:180]
            signals.append({
                "id":           ev.get("id",""),
                "type":         sig_type,
                "level":        "critical" if sev >= 7.5 else "major" if sev >= 5.5 else "watch",
                "label":        sig_type.replace("_"," ").title(),
                "icon":         cfg["icon"],
                "color":        cfg["color"],
                "region":       ev.get("country_name") or ev.get("country_code","Global"),
                "country_code": ev.get("country_code","XX"),
                "severity":     sev,
                "value":        str(round(sev, 1)),        # shown in value slot
                "delta":        f"{round(conf*100)}% conf",# shown in delta slot
                "meta":         (ev.get("country_name") or "Global") + " · " + ev.get("title","")[:60],
                "description":  summary_text,
                "title":        ev.get("title",""),
                "summary":      summary_text,
                "timestamp":    ev.get("timestamp",""),
                "confidence":   conf,
            })
            break  # one signal type per event

        if len(signals) >= 24:
            break

    # Sort: critical first, then by severity
    signals.sort(key=lambda s: (-{"critical":3,"major":2,"watch":1}.get(s["level"],0), -s["severity"]))
    return {"signals": signals[:20], "count": len(signals)}




@router.post("/early-warning/refresh")
async def refresh_early_warning(user=Depends(require_user)):
    """Force-invalidate the 30-min EW cache. Next GET will regenerate assessment."""
    async with aiosqlite.connect(settings.db_path) as db:
        await _ensure_tables(db)
        await db.execute("DELETE FROM ew_snapshots WHERE snapshot_date=?", (date.today().isoformat(),))
        await db.commit()
    return {"status": "ok", "message": "EW cache cleared"}

# ── SUPPLY CHAIN INTELLIGENCE ─────────────────────────

@router.get("/supply-chain")
async def get_supply_chain():
    """
    Global supply chain risk map with live risk levels per node.
    Correlates events with known chokepoints and critical nodes.
    """
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT * FROM events WHERE datetime(timestamp) > datetime('now','-72 hours') "
            "ORDER BY severity DESC LIMIT 150"
        ) as c:
            events = [dict(r) for r in await c.fetchall()]

    # Score each supply chain node based on nearby/relevant events
    node_risks = []
    disruptions = []

    for node in SUPPLY_CHAIN_NODES:
        relevant_evs = []
        for ev in events:
            # Check geo proximity (within ~1500km for routes, ~500km for ports)
            try:
                ev_lat = float(ev.get("latitude", 0))
                ev_lon = float(ev.get("longitude", 0))
                dlat = ev_lat - node["lat"]
                dlon = ev_lon - node["lon"]
                dist_approx = math.sqrt(dlat**2 + dlon**2)  # degrees
                threshold = 15 if node["type"] in ("TRADE_ROUTE", "CHOKEPOINT") else 8
                if dist_approx < threshold:
                    relevant_evs.append(ev)
            except Exception:
                pass
            # Keyword match
            if node["id"] in _detect_sc_relevance(ev.get("title","") + " " + (ev.get("summary") or "")):
                if ev not in relevant_evs:
                    relevant_evs.append(ev)

        # Compute node risk
        if relevant_evs:
            avg_sev = sum(e.get("severity", 5) for e in relevant_evs) / len(relevant_evs)
            high_count = sum(1 for e in relevant_evs if e.get("impact") == "High")
            node_risk = min(10, node["risk_base"] * 0.4 + avg_sev * 0.4 + high_count * 0.8)
        else:
            node_risk = node["risk_base"]

        risk_level = "CRITICAL" if node_risk >= 8 else "HIGH" if node_risk >= 6 else "ELEVATED" if node_risk >= 4 else "NORMAL"
        risk_color = "#EF4444" if node_risk >= 8 else "#F97316" if node_risk >= 6 else "#F59E0B" if node_risk >= 4 else "#10B981"

        node_data = {
            **node,
            "risk_score": round(node_risk, 1),
            "risk_level": risk_level,
            "risk_color": risk_color,
            "relevant_events": len(relevant_evs),
            "top_events": [{"title": e["title"], "severity": e.get("severity",5)} for e in sorted(relevant_evs, key=lambda x: -x.get("severity",5))[:3]],
        }
        node_risks.append(node_data)

        # Flag as disruption if risk is elevated
        if node_risk >= 5.5:
            top_ev = sorted(relevant_evs, key=lambda x: -x.get("severity", 5))
            disruptions.append({
                "node_id": node["id"],
                "node_name": node["name"],
                "lat": node["lat"],
                "lon": node["lon"],
                "icon": node["icon"],
                "risk_score": round(node_risk, 1),
                "risk_level": risk_level,
                "risk_color": risk_color,
                "type": node["type"],
                "trigger": top_ev[0]["title"][:80] if top_ev else "Multiple signals detected",
                "event_count": len(relevant_evs),
            })

    # Compute global supply chain stress index
    all_risks = [n["risk_score"] for n in node_risks]
    global_sc_stress = round(sum(all_risks) / max(len(all_risks), 1), 1)
    critical_nodes = sum(1 for n in node_risks if n["risk_score"] >= 7)
    high_nodes = sum(1 for n in node_risks if 5 <= n["risk_score"] < 7)

    # AI narrative
    ai_summary = ""
    if await ai_available_async() and disruptions:
        top_d = sorted(disruptions, key=lambda x: -x["risk_score"])[:4]
        d_text = "\n".join([
            "- " + d["node_name"] + " [" + d["risk_level"] + " " + str(d["risk_score"]) + "/10]: " + d["trigger"]
            for d in top_d
        ])
        prompt = (
            "You are a global supply chain risk analyst. Write a 3-sentence briefing "
            "on current supply chain disruption risks based on these nodes:\n\n"
            + d_text + "\n\n"
            "Global SC Stress Index: " + str(global_sc_stress) + "/10. "
            "Focus on: which industries are most exposed, cascading effects, and time horizon."
        )
        ai_summary = await _call_claude(prompt, max_tokens=250) or ""

    if not ai_summary:
        ai_summary = (
            "Global Supply Chain Stress Index: " + str(global_sc_stress) + "/10. "
            + str(critical_nodes) + " critical nodes and " + str(high_nodes) + " high-risk nodes detected. "
            + ("Red Sea corridor and Persian Gulf remain primary disruption hotspots. " if any(d["node_id"] in ("redsea","hormuz") for d in disruptions) else "")
            + "Configure an AI provider in Admin → Settings to enable AI supply chain analysis."
        )

    return {
        "global_sc_stress": global_sc_stress,
        "critical_nodes": critical_nodes,
        "high_risk_nodes": high_nodes,
        "total_nodes": len(node_risks),
        "nodes": node_risks,
        "disruptions": sorted(disruptions, key=lambda x: -x["risk_score"]),
        "ai_summary": ai_summary,
        "events_analyzed": len(events),
    }


@router.get("/supply-chain/sectors")
async def get_sector_exposure():
    """Compute sector exposure to current supply chain risks."""
    SECTOR_NODES = {
        "Oil & Gas":         ["hormuz", "gulf_oil", "redsea"],
        "Semiconductors":    ["tsmc", "taiwan_strait", "malacca"],
        "Automotive":        ["tsmc", "spodumene", "shanghai"],
        "Agriculture":       ["ukraine_grain", "bosphorus", "suez"],
        "Shipping/Logistics":["redsea", "suez", "hormuz", "malacca", "panama", "bosphorus"],
        "Consumer Goods":    ["shanghai", "losangeles", "rotterdam", "singapore"],
        "EV / Batteries":    ["spodumene", "congo_cobalt", "tsmc"],
        "Defense":           ["taiwan_strait", "hormuz", "ukraine_grain"],
        "Chemicals":         ["hormuz", "suez", "redsea"],
        "Mining":            ["congo_cobalt", "spodumene", "redsea"],
    }

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            "SELECT * FROM events WHERE datetime(timestamp) > datetime('now','-72 hours') LIMIT 100"
        ) as c:
            events = [dict(r) for r in await c.fetchall()]

    # Quick node risk computation (simplified)
    node_risk_cache: Dict[str, float] = {}
    for node in SUPPLY_CHAIN_NODES:
        relevant = [
            ev for ev in events
            if node["id"] in _detect_sc_relevance(ev.get("title","") + " " + (ev.get("summary") or ""))
        ]
        if relevant:
            avg_sev = sum(e.get("severity", 5) for e in relevant) / len(relevant)
            node_risk_cache[node["id"]] = min(10, node["risk_base"] * 0.5 + avg_sev * 0.5)
        else:
            node_risk_cache[node["id"]] = node["risk_base"]

    sectors = []
    for sector, node_ids in SECTOR_NODES.items():
        risks = [node_risk_cache.get(nid, 3.0) for nid in node_ids]
        avg_risk = sum(risks) / len(risks) if risks else 3.0
        exposure = "Critical" if avg_risk >= 7.5 else "High" if avg_risk >= 5.5 else "Moderate" if avg_risk >= 3.5 else "Low"
        color = "#EF4444" if avg_risk >= 7.5 else "#F97316" if avg_risk >= 5.5 else "#F59E0B" if avg_risk >= 3.5 else "#10B981"
        sectors.append({
            "sector": sector,
            "risk_score": round(avg_risk, 1),
            "exposure": exposure,
            "color": color,
            "exposed_nodes": node_ids,
            "highest_risk_node": max(node_ids, key=lambda nid: node_risk_cache.get(nid, 0)),
        })

    return {"sectors": sorted(sectors, key=lambda x: -x["risk_score"])}


@router.post("/supply-chain/analyze-event")
async def analyze_event_sc_impact(payload: dict = Body(...)):
    """Analyze a specific event's supply chain impact."""
    event_id = payload.get("event_id", "")
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as c:
            row = await c.fetchone()
    if not row:
        return {"error": "Event not found"}

    ev = dict(row)
    text = ev.get("title","") + " " + (ev.get("summary") or "")
    affected_nodes = _detect_sc_relevance(text)

    if not affected_nodes:
        return {
            "affected_nodes": [],
            "sc_impact": "No significant supply chain impact detected for this event.",
            "sectors_at_risk": [],
        }

    node_info = [n for n in SUPPLY_CHAIN_NODES if n["id"] in affected_nodes]
    sc_impact = ""

    if await ai_available_async():
        nodes_text = ", ".join([n["name"] for n in node_info])
        prompt = (
            "Analyze supply chain impact of this event. Respond in 2-3 sentences.\n\n"
            "Event: " + ev.get("title","") + "\n"
            "Details: " + (ev.get("summary","") or "")[:300] + "\n"
            "Affected supply chain nodes: " + nodes_text + "\n\n"
            "Specify: which goods/commodities are disrupted, which industries face shortages, "
            "estimated duration, and which companies/regions are most exposed."
        )
        sc_impact = await _call_claude(prompt, max_tokens=250) or ""

    if not sc_impact:
        sc_impact = (
            "This event affects " + ", ".join([n["name"] for n in node_info]) + ". "
            "Potential disruptions to trade flows through these critical nodes. "
            "Monitor for escalation in the coming 72 hours."
        )

    # Which sectors are exposed
    SECTOR_NODES = {
        "Oil & Gas": ["hormuz","gulf_oil","redsea"],
        "Semiconductors": ["tsmc","taiwan_strait","malacca"],
        "Agriculture": ["ukraine_grain","bosphorus","suez"],
        "Shipping": ["redsea","suez","hormuz","malacca","panama"],
        "Consumer Goods": ["shanghai","losangeles","rotterdam"],
        "EV / Batteries": ["spodumene","congo_cobalt"],
    }
    sectors_at_risk = [
        sector for sector, nids in SECTOR_NODES.items()
        if any(nid in affected_nodes for nid in nids)
    ]

    return {
        "affected_nodes": [{"id": n["id"], "name": n["name"], "type": n["type"], "icon": n["icon"]} for n in node_info],
        "sc_impact": sc_impact,
        "sectors_at_risk": sectors_at_risk,
    }


# ── AI Analyst chat endpoint ──────────────────────────────────────────────────

@router.post("/answer")
async def ai_analyst_answer(payload: dict = Body(...), user=Depends(require_user)):
    """
    General-purpose AI analyst Q&A used by the AI Analyst page and chat widget.
    Calls _call_claude (Gemini by default) with self-healing settings reload.
    """
    question = (payload.get("question") or "").strip()
    context  = (payload.get("context")  or "").strip()

    if not question:
        return {"answer": None}

    # Reload Gemini key from DB if not in memory (fixes post-restart blank key)
    if not await ai_available_async():
        return {
            "answer": (
                "AI provider not configured. Save your Gemini API key in "
                "Admin → Settings → AI Provider, then retry."
            )
        }

    answer = await ai_answer(question, context)
    return {
        "answer": answer or (
            "No response received from the AI provider. "
            "Check that your Gemini API key is valid in Admin → Settings."
        )
    }


@router.get("/macro-brief")
async def macro_brief_endpoint(user=Depends(require_user)):
    """Dashboard macro briefing text for the Risk Index quote."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM events WHERE datetime(timestamp) > datetime('now','-72 hours') "
            "ORDER BY severity DESC LIMIT 5"
        ) as cur:
            events = [dict(r) for r in await cur.fetchall()]

    if not await ai_available_async() or not events:
        return {"brief": "Configure a Gemini key in Admin → Settings for live AI briefings."}

    brief = await ai_macro_briefing([], events)
    return {"brief": brief or ""}


@router.get("/watchlist-digest")
async def watchlist_digest_endpoint(user=Depends(require_user)):
    """Personalised digest for the AI Analyst page."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT label, value FROM user_watchlist WHERE user_id=? LIMIT 10",
            (user["id"],)
        ) as cur:
            items = [dict(r) for r in await cur.fetchall()]
        async with db.execute(
            "SELECT * FROM events WHERE datetime(timestamp) > datetime('now','-72 hours') "
            "ORDER BY severity DESC LIMIT 10"
        ) as cur:
            events = [dict(r) for r in await cur.fetchall()]

    if not await ai_available_async():
        return {"digest": "Configure a Gemini key in Admin → Settings to enable personalised digests."}

    digest = await ai_watchlist_digest(items, events)
    return {"digest": digest or ""}
