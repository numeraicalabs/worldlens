"""
WorldLens — Opportunity Engine
================================
Three interconnected systems in one module:

1. Opportunity Score Engine
   Scores every high-severity event (≥6) with:
   - Opportunity score 0-100
   - Actionable trade ideas (ticker, direction, entry range, timeframe)
   - Confidence score
   - Key catalysts and risks

2. Event-to-Trade Pipeline
   Converts new events into Trade Idea Cards automatically.
   Runs via scheduler every 10 min and on-demand via API.
   Each card links: event → asset impact → specific ticker → entry logic.

3. Smart Anomaly Alerts
   Scans finance_cache every 5 min for:
   - Volume anomalies (>2.5x 20-day average)
   - Price breakouts (new 52w high/low)
   - Momentum divergence (price ↑ but sentiment ↓ or vice versa)
   - Post-event drift (price moves matching predicted direction)
   Stores fired alerts in DB; pushes via WebSocket.
"""
from __future__ import annotations

import asyncio
import json
import logging
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

import aiosqlite
from fastapi import APIRouter, Depends, Query, Body

from auth import require_user
from config import settings
from ai_layer import _call_claude, _parse_json, _ai_available, _FACTOR_MAP

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/opportunity", tags=["opportunity"])


# ─────────────────────────────────────────────────────────────────────────────
# DB SETUP
# ─────────────────────────────────────────────────────────────────────────────

_DB_INIT = """
CREATE TABLE IF NOT EXISTS trade_ideas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id    TEXT NOT NULL,
    event_title TEXT NOT NULL,
    event_category TEXT NOT NULL,
    event_severity REAL NOT NULL,
    ticker      TEXT NOT NULL,
    asset_name  TEXT NOT NULL,
    direction   TEXT NOT NULL,       -- LONG / SHORT
    entry_low   REAL,
    entry_high  REAL,
    target_pct  REAL,                -- expected % move
    stop_pct    REAL,                -- stop-loss %
    timeframe   TEXT NOT NULL,       -- e.g. "3-10 days"
    confidence  REAL NOT NULL,       -- 0.0-1.0
    opp_score   INTEGER NOT NULL,    -- 0-100
    rationale   TEXT NOT NULL,
    risks       TEXT DEFAULT '[]',   -- JSON array
    catalysts   TEXT DEFAULT '[]',   -- JSON array
    status      TEXT DEFAULT 'active',  -- active|expired|hit_target|hit_stop
    created_at  TEXT DEFAULT (datetime('now')),
    expires_at  TEXT,
    -- Performance tracking (Fase 4)
    price_at_generation REAL,           -- market price when idea was created
    price_current       REAL,           -- last checked price
    pnl_pct             REAL,           -- current P&L %
    max_favorable_pct   REAL,           -- best P&L seen
    tracked_at          TEXT,           -- last price check
    outcome_note        TEXT DEFAULT '' -- e.g. 'Hit target +4.2% in 3 days'
);

CREATE TABLE IF NOT EXISTS anomaly_alerts (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker       TEXT NOT NULL,
    asset_name   TEXT NOT NULL,
    alert_type   TEXT NOT NULL,      -- volume_spike|price_breakout|momentum_divergence|post_event_drift
    severity     TEXT NOT NULL,      -- low|medium|high
    title        TEXT NOT NULL,
    detail       TEXT NOT NULL,
    current_val  REAL,
    reference_val REAL,
    change_pct   REAL,
    related_event_id TEXT DEFAULT '',
    acknowledged INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS opp_scores (
    event_id    TEXT PRIMARY KEY,
    score       INTEGER NOT NULL,
    scored_at   TEXT DEFAULT (datetime('now')),
    ideas_count INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_ti_event   ON trade_ideas(event_id);
CREATE INDEX IF NOT EXISTS idx_ti_status  ON trade_ideas(status);
CREATE INDEX IF NOT EXISTS idx_ti_created ON trade_ideas(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_aa_type    ON anomaly_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_aa_created ON anomaly_alerts(created_at DESC);
"""


async def _ensure_tables(db):
    await db.executescript(_DB_INIT)
    await db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# TICKER MAP: category + keyword → concrete tradable ticker
# ─────────────────────────────────────────────────────────────────────────────

_TICKER_MAP: Dict[str, Dict] = {
    # Equities
    "S&P 500":          {"ticker": "SPY",  "name": "SPDR S&P 500 ETF"},
    "Nasdaq":           {"ticker": "QQQ",  "name": "Invesco QQQ Trust"},
    "Tech ETF":         {"ticker": "XLK",  "name": "Technology Select Sector SPDR"},
    "Banking ETF":      {"ticker": "XLF",  "name": "Financial Select Sector SPDR"},
    "Energy ETF":       {"ticker": "XLE",  "name": "Energy Select Sector SPDR"},
    "Defense ETF":      {"ticker": "ITA",  "name": "iShares U.S. Aerospace & Defense ETF"},
    "Healthcare ETF":   {"ticker": "XLV",  "name": "Health Care Select Sector SPDR"},
    "Pharma ETF":       {"ticker": "XBI",  "name": "SPDR S&P Biotech ETF"},
    "Semiconductor ETF":{"ticker": "SOXX", "name": "iShares Semiconductor ETF"},
    "EM Equity ETF":    {"ticker": "EEM",  "name": "iShares MSCI Emerging Markets ETF"},
    "Construction ETF": {"ticker": "ITB",  "name": "iShares U.S. Home Construction ETF"},
    "Insurance ETF":    {"ticker": "KIE",  "name": "SPDR S&P Insurance ETF"},
    "Airlines":         {"ticker": "JETS", "name": "U.S. Global Jets ETF"},
    "Tourism ETF":      {"ticker": "AWAY", "name": "ETFMG Travel Tech ETF"},
    "Reinsurance":      {"ticker": "RINF", "name": "ProShares Inflation Expectations ETF"},
    # Commodities
    "Oil (WTI)":        {"ticker": "CL=F", "name": "WTI Crude Oil Futures"},
    "Gold":             {"ticker": "GLD",  "name": "SPDR Gold Shares"},
    "Nat Gas":          {"ticker": "NG=F", "name": "Natural Gas Futures"},
    "Food Commodities": {"ticker": "DBA",  "name": "Invesco DB Agriculture Fund"},
    # Volatility / Bonds
    "VIX":              {"ticker": "VXX",  "name": "iPath Series B VIX Short-Term Futures ETN"},
    "10Y Treasury":     {"ticker": "TLT",  "name": "iShares 20+ Year Treasury Bond ETF"},
    "Gov Bonds":        {"ticker": "IEF",  "name": "iShares 7-10 Year Treasury Bond ETF"},
    # FX
    "USD Index":        {"ticker": "DX=F", "name": "US Dollar Index Futures"},
    "EUR/USD":          {"ticker": "EURUSD=X","name": "EUR/USD"},
    "Local Currency":   {"ticker": "CEW",  "name": "WisdomTree Emerging Currency Strategy Fund"},
}


def _resolve_ticker(instrument: str) -> Optional[Dict]:
    """Map instrument name to a tradable ticker."""
    # Direct match
    if instrument in _TICKER_MAP:
        return _TICKER_MAP[instrument]
    # Partial match
    for key, val in _TICKER_MAP.items():
        if key.lower() in instrument.lower() or instrument.lower() in key.lower():
            return val
    return None


# ─────────────────────────────────────────────────────────────────────────────
# 1. OPPORTUNITY SCORE ENGINE
# ─────────────────────────────────────────────────────────────────────────────

def _compute_opp_score(event: Dict, finance_cache: List[Dict]) -> int:
    """
    Rule-based opportunity score 0-100.
    Fast, no AI call — used to pre-filter before AI enrichment.
    """
    severity   = float(event.get("ai_impact_score") or event.get("severity", 5))
    category   = event.get("category", "GEOPOLITICS")
    impact     = event.get("impact", "Medium")
    title      = (event.get("title", "") + " " + event.get("summary", "")).lower()

    score = 0

    # Severity weight (max 40 points)
    score += min(40, int(severity * 4))

    # Category tradability weight (max 20 points)
    category_weights = {
        "ENERGY": 20, "FINANCE": 20, "ECONOMICS": 18, "CONFLICT": 16,
        "GEOPOLITICS": 15, "TECHNOLOGY": 14, "POLITICS": 12,
        "HEALTH": 10, "DISASTER": 8, "SECURITY": 8,
        "EARTHQUAKE": 6, "HUMANITARIAN": 4,
    }
    score += category_weights.get(category, 8)

    # High-value keywords (max 15 points)
    kw_score = 0
    high_value_kws = [
        ("federal reserve", 5), ("fed rate", 5), ("rate cut", 5), ("rate hike", 5),
        ("opec", 5), ("oil supply", 5), ("war", 4), ("sanction", 4),
        ("default", 5), ("collapse", 5), ("ban", 3), ("tariff", 4),
        ("inflation", 4), ("gdp", 3), ("earnings", 3), ("merger", 3),
        ("acquisition", 3), ("ipo", 3), ("bankruptcy", 5),
    ]
    for kw, pts in high_value_kws:
        if kw in title:
            kw_score += pts
    score += min(15, kw_score)

    # Market state alignment (max 10 points)
    vix_val = next((a["price"] for a in finance_cache if "vix" in a.get("name","").lower() or a.get("symbol") == "^VIX"), None)
    if vix_val and vix_val > 20:
        score += min(10, int((vix_val - 20) / 2))

    # Impact label (max 15 points)
    score += {"Critical": 15, "High": 12, "Medium": 7, "Low": 3}.get(impact, 5)

    return min(100, score)


async def _enrich_with_ai(event: Dict, base_ideas: List[Dict]) -> List[Dict]:
    """Call AI to refine trade ideas. Returns enriched ideas list."""
    if not _ai_available():
        return base_ideas

    # Build compact prompt
    ideas_summary = "\n".join([
        f"- {i['ticker']} ({i['direction']}): {i['rationale'][:80]}"
        for i in base_ideas[:4]
    ])

    prompt = f"""You are a quantitative investment strategist. A new global event has been detected.

EVENT:
Title: {event.get('title','')}
Category: {event.get('category','')}
Severity: {event.get('ai_impact_score', event.get('severity',5))}/10
Summary: {(event.get('ai_summary') or event.get('summary',''))[:300]}

PRELIMINARY TRADE IDEAS (rule-based):
{ideas_summary}

Refine and return EXACTLY the top 3 trade ideas as JSON array:
[
  {{
    "ticker": "SPY",
    "asset_name": "SPDR S&P 500 ETF",
    "direction": "SHORT",
    "entry_low": 520.0,
    "entry_high": 525.0,
    "target_pct": -4.5,
    "stop_pct": 2.0,
    "timeframe": "5-15 days",
    "confidence": 0.72,
    "rationale": "One concise sentence explaining why this trade makes sense now.",
    "risks": ["Risk 1", "Risk 2"],
    "catalysts": ["Catalyst 1", "Catalyst 2"]
  }}
]

Rules:
- direction is LONG or SHORT only
- target_pct is negative for SHORT (expected % drop), positive for LONG (expected % rise)
- stop_pct is always positive (distance from entry where you cut losses)
- confidence between 0.4 and 0.95
- rationale max 120 characters
- Return ONLY the JSON array, no markdown, no preamble."""

    text = await _call_claude(prompt, max_tokens=800)
    if not text:
        return base_ideas

    parsed = _parse_json(text)
    if not parsed or not isinstance(parsed, list):
        return base_ideas

    # Merge AI refinements with base
    enriched = []
    for item in parsed[:3]:
        if not item.get("ticker") or not item.get("direction"):
            continue
        item["direction"] = item["direction"].upper()
        if item["direction"] not in ("LONG", "SHORT"):
            item["direction"] = "LONG"
        enriched.append(item)

    return enriched if enriched else base_ideas


def _build_base_ideas(event: Dict) -> List[Dict]:
    """Build rule-based trade ideas from _FACTOR_MAP. Fast, no AI."""
    category = event.get("category", "GEOPOLITICS")
    severity = float(event.get("ai_impact_score") or event.get("severity", 5))
    factors  = _FACTOR_MAP.get(category, _FACTOR_MAP.get("GEOPOLITICS", []))

    ideas = []
    for asset_name, atype, direction_sign, base_mag in factors[:5]:
        ticker_info = _resolve_ticker(asset_name)
        if not ticker_info:
            continue

        direction  = "LONG" if direction_sign > 0 else "SHORT"
        target_pct = round(base_mag * severity * 1.5 * direction_sign, 1)
        stop_pct   = round(abs(target_pct) * 0.4, 1)  # stop at 40% of target
        confidence = round(min(0.85, 0.45 + base_mag * severity * 0.06), 2)
        timeframe  = "1-7 days" if severity >= 7 else "5-20 days"

        ideas.append({
            "ticker":      ticker_info["ticker"],
            "asset_name":  ticker_info["name"],
            "direction":   direction,
            "entry_low":   None,
            "entry_high":  None,
            "target_pct":  target_pct,
            "stop_pct":    stop_pct,
            "timeframe":   timeframe,
            "confidence":  confidence,
            "rationale":   f"{category.title()} event (sev {severity:.0f}/10) → {direction.lower()} {asset_name}",
            "risks":       ["Event may de-escalate quickly", "Market may have already priced this in"],
            "catalysts":   ["Continued escalation", "Policy response by authorities"],
        })

    return ideas


async def process_event_to_ideas(event: Dict, force: bool = False) -> Optional[Dict]:
    """
    Main pipeline: event → opportunity score → trade ideas → persist.
    Returns None if event doesn't meet threshold (score < 45).
    """
    event_id = event.get("id", "")
    if not event_id:
        return None

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)

        # Skip already processed unless forced
        if not force:
            async with db.execute(
                "SELECT id FROM trade_ideas WHERE event_id=? LIMIT 1", (event_id,)
            ) as cur:
                if await cur.fetchone():
                    return None

    # Get finance cache for context
    from scheduler import get_finance_cache
    fin_cache = get_finance_cache() or []

    # Score the event
    opp_score = _compute_opp_score(event, fin_cache)

    if opp_score < 45:
        return None  # Not tradable enough

    # Build base ideas (fast, rule-based)
    base_ideas = _build_base_ideas(event)
    if not base_ideas:
        return None

    # Enrich with AI if score is high enough to warrant the call
    if opp_score >= 60:
        ideas = await _enrich_with_ai(event, base_ideas)
    else:
        ideas = base_ideas[:3]

    # Attach current prices from finance cache
    price_map = {a["symbol"].upper(): a.get("price") for a in fin_cache}
    for idea in ideas:
        tk = idea["ticker"].upper()
        cur_price = price_map.get(tk)
        if cur_price:
            if not idea.get("entry_low"):
                idea["entry_low"]  = round(cur_price * 0.995, 2)
                idea["entry_high"] = round(cur_price * 1.005, 2)
            idea["_gen_price"] = cur_price  # stored for performance tracking

    # Persist to DB
    expires_at = (datetime.utcnow() + timedelta(days=10)).isoformat()

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)

        # Save opportunity score
        await db.execute(
            "INSERT OR REPLACE INTO opp_scores (event_id, score, ideas_count) VALUES (?,?,?)",
            (event_id, opp_score, len(ideas))
        )

        # Save trade ideas
        for idea in ideas:
            await db.execute(
                """INSERT OR IGNORE INTO trade_ideas
                   (event_id, event_title, event_category, event_severity,
                    ticker, asset_name, direction, entry_low, entry_high,
                    target_pct, stop_pct, timeframe, confidence, opp_score,
                    rationale, risks, catalysts, expires_at, price_at_generation)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    event_id,
                    event.get("title", "")[:200],
                    event.get("category", ""),
                    float(event.get("ai_impact_score") or event.get("severity", 5)),
                    idea["ticker"],
                    idea["asset_name"],
                    idea["direction"],
                    idea.get("entry_low"),
                    idea.get("entry_high"),
                    idea.get("target_pct"),
                    idea.get("stop_pct"),
                    idea.get("timeframe", "5-15 days"),
                    idea.get("confidence", 0.55),
                    opp_score,
                    idea.get("rationale", "")[:500],
                    json.dumps(idea.get("risks", [])),
                    json.dumps(idea.get("catalysts", [])),
                    expires_at,
                    idea.get("_gen_price"),  # price_at_generation
                )
            )

        await db.commit()

    logger.info(
        "Trade ideas created: event=%s score=%d ideas=%d",
        event_id[:16], opp_score, len(ideas)
    )

    return {
        "event_id":  event_id,
        "opp_score": opp_score,
        "ideas":     ideas,
    }


# ─────────────────────────────────────────────────────────────────────────────
# 2. EVENT-TO-TRADE PIPELINE (batch runner for scheduler)
# ─────────────────────────────────────────────────────────────────────────────

async def run_opportunity_pipeline(lookback_hours: int = 4) -> int:
    """
    Called by scheduler every 10 minutes.
    Scans recent high-severity events → generates trade ideas.
    Returns count of new ideas created.
    """
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT id, title, category, severity, ai_impact_score,
                          ai_summary, summary, impact, country_name, country_code
                   FROM events
                   WHERE (ai_impact_score >= 6 OR severity >= 6)
                     AND datetime(created_at) > datetime('now', ?)
                   ORDER BY COALESCE(ai_impact_score, severity) DESC
                   LIMIT 30""",
                (f"-{lookback_hours} hours",)
            ) as cur:
                events = [dict(r) for r in await cur.fetchall()]

        if not events:
            return 0

        count = 0
        for event in events:
            try:
                result = await process_event_to_ideas(event)
                if result:
                    count += result["ideas"].__len__()
                await asyncio.sleep(0.5)  # small delay between AI calls
            except Exception as e:
                logger.debug("opportunity pipeline event %s: %s", event.get("id"), e)

        if count:
            logger.info("Opportunity pipeline: %d new trade ideas from %d events", count, len(events))
        return count

    except Exception as e:
        logger.error("run_opportunity_pipeline: %s", e)
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# 3. SMART ANOMALY ALERT ENGINE
# ─────────────────────────────────────────────────────────────────────────────

# In-memory price history for anomaly detection (last 20 readings per ticker)
_price_history: Dict[str, List[float]]  = {}
_volume_history: Dict[str, List[float]] = {}
_MAX_HIST = 20


async def run_anomaly_scan() -> int:
    """
    Scans finance_cache for anomalies. Called by scheduler every 5 min.
    Returns count of new alerts fired.
    """
    try:
        from scheduler import get_finance_cache
        assets = get_finance_cache()
        if not assets:
            return 0

        new_alerts: List[Dict] = []

        for asset in assets:
            sym        = asset.get("symbol", "")
            name       = asset.get("name", sym)
            price      = asset.get("price") or asset.get("last_price")
            change_pct = asset.get("change_pct", 0.0)
            volume     = asset.get("volume") or asset.get("vol")

            if not sym or price is None:
                continue

            # ── Update history ──────────────────────────────────────────────
            if sym not in _price_history:
                _price_history[sym]  = []
                _volume_history[sym] = []

            _price_history[sym].append(float(price))
            if volume:
                _volume_history[sym].append(float(volume))

            # Keep rolling window
            if len(_price_history[sym])  > _MAX_HIST: _price_history[sym].pop(0)
            if len(_volume_history[sym]) > _MAX_HIST: _volume_history[sym].pop(0)

            hist_p = _price_history[sym]
            hist_v = _volume_history[sym]

            # Need at least 5 readings for meaningful stats
            if len(hist_p) < 5:
                continue

            # ── Check 1: Momentum breakout (price move > 3% in one tick) ───
            if abs(change_pct) >= 3.0:
                direction = "↑" if change_pct > 0 else "↓"
                severity  = "high" if abs(change_pct) >= 5 else "medium"
                new_alerts.append({
                    "ticker":     sym,
                    "asset_name": name,
                    "alert_type": "price_breakout",
                    "severity":   severity,
                    "title":      f"{name}: {direction}{abs(change_pct):.1f}% breakout",
                    "detail":     f"Price moved {change_pct:+.2f}% — significant intraday momentum. Monitor for continuation or reversal.",
                    "current_val":    price,
                    "reference_val":  hist_p[-2] if len(hist_p) >= 2 else price,
                    "change_pct":     change_pct,
                })

            # ── Check 2: Volume spike (>2.5x 10-period average) ─────────────
            if len(hist_v) >= 5 and volume:
                avg_vol = sum(hist_v[:-1]) / len(hist_v[:-1])
                vol_ratio = float(volume) / avg_vol if avg_vol > 0 else 1.0
                if vol_ratio >= 2.5:
                    severity = "high" if vol_ratio >= 4.0 else "medium"
                    new_alerts.append({
                        "ticker":     sym,
                        "asset_name": name,
                        "alert_type": "volume_spike",
                        "severity":   severity,
                        "title":      f"{name}: volume spike {vol_ratio:.1f}x average",
                        "detail":     f"Current volume is {vol_ratio:.1f}x the recent average. High activity often precedes major price moves.",
                        "current_val":   float(volume),
                        "reference_val": avg_vol,
                        "change_pct":    (vol_ratio - 1) * 100,
                    })

            # ── Check 3: Momentum divergence (reversal signal) ───────────────
            if len(hist_p) >= 10:
                recent_avg  = sum(hist_p[-5:])  / 5
                prev_avg    = sum(hist_p[-10:-5]) / 5
                price_trend = (recent_avg - prev_avg) / prev_avg * 100 if prev_avg else 0
                # Strong price uptrend but current candle shows sharp reversal
                if price_trend > 3 and change_pct <= -2.5:
                    new_alerts.append({
                        "ticker":     sym,
                        "asset_name": name,
                        "alert_type": "momentum_divergence",
                        "severity":   "medium",
                        "title":      f"{name}: bearish divergence after uptrend",
                        "detail":     f"Price was trending +{price_trend:.1f}% but now showing {change_pct:.1f}% reversal — potential trend change.",
                        "current_val":   price,
                        "reference_val": prev_avg,
                        "change_pct":    change_pct,
                    })
                elif price_trend < -3 and change_pct >= 2.5:
                    new_alerts.append({
                        "ticker":     sym,
                        "asset_name": name,
                        "alert_type": "momentum_divergence",
                        "severity":   "medium",
                        "title":      f"{name}: bullish divergence after downtrend",
                        "detail":     f"Price was trending {price_trend:.1f}% but now showing +{change_pct:.1f}% — potential bounce.",
                        "current_val":   price,
                        "reference_val": prev_avg,
                        "change_pct":    change_pct,
                    })

        if not new_alerts:
            return 0

        # ── Dedup and persist ─────────────────────────────────────────────────
        saved = 0
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            await _ensure_tables(db)

            for alert in new_alerts:
                # Don't re-fire same type for same ticker within 30 min
                async with db.execute(
                    """SELECT id FROM anomaly_alerts
                       WHERE ticker=? AND alert_type=?
                         AND datetime(created_at) > datetime('now','-30 minutes')
                       LIMIT 1""",
                    (alert["ticker"], alert["alert_type"])
                ) as cur:
                    if await cur.fetchone():
                        continue

                # Cross-reference with recent trade ideas (post_event_drift)
                related_event = ""
                async with db.execute(
                    """SELECT event_id FROM trade_ideas
                       WHERE ticker=? AND status='active'
                         AND datetime(created_at) > datetime('now','-7 days')
                       LIMIT 1""",
                    (alert["ticker"],)
                ) as cur2:
                    row = await cur2.fetchone()
                    if row:
                        related_event = row["event_id"]
                        # Upgrade to post_event_drift type
                        alert["alert_type"] = "post_event_drift"
                        alert["title"]      = "🎯 " + alert["title"] + " [Trade idea active]"

                await db.execute(
                    """INSERT INTO anomaly_alerts
                       (ticker, asset_name, alert_type, severity, title, detail,
                        current_val, reference_val, change_pct, related_event_id)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        alert["ticker"], alert["asset_name"],
                        alert["alert_type"], alert["severity"],
                        alert["title"], alert["detail"],
                        alert.get("current_val"), alert.get("reference_val"),
                        alert.get("change_pct"), related_event,
                    )
                )
                saved += 1

            if saved:
                await db.commit()

        # Push via WebSocket
        if saved:
            try:
                from scheduler import _ws_callbacks
                for cb in _ws_callbacks:
                    try:
                        await cb({
                            "type":   "anomaly_alerts",
                            "count":  saved,
                            "alerts": new_alerts[:5],
                        })
                    except Exception:
                        pass
            except Exception:
                pass

        if saved:
            logger.info("Anomaly scan: %d new alerts fired", saved)
        return saved

    except Exception as e:
        logger.error("run_anomaly_scan: %s", e)
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# API ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/ideas")
async def get_trade_ideas(
    limit: int = Query(20, le=50),
    direction: Optional[str] = Query(None),
    min_score: int = Query(45, ge=0, le=100),
    status: str = Query("active"),
    user=Depends(require_user),
):
    """Return latest trade ideas, optionally filtered."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)

        filters = ["status=?", "opp_score>=?"]
        params: List = [status, min_score]

        if direction and direction.upper() in ("LONG", "SHORT"):
            filters.append("direction=?")
            params.append(direction.upper())

        where = " AND ".join(filters)
        params.append(limit)

        async with db.execute(
            f"""SELECT ti.*, e.country_name, e.timestamp as event_ts
               FROM trade_ideas ti
               LEFT JOIN events e ON e.id = ti.event_id
               WHERE {where}
               ORDER BY ti.created_at DESC
               LIMIT ?""",
            params
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]

    # Parse JSON fields
    for r in rows:
        for field in ("risks", "catalysts"):
            try:
                r[field] = json.loads(r[field]) if isinstance(r[field], str) else r[field]
            except Exception:
                r[field] = []

    return {"ideas": rows, "total": len(rows)}


@router.get("/ideas/top")
async def get_top_ideas(user=Depends(require_user)):
    """Top 5 high-confidence ideas for dashboard widget."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        async with db.execute(
            """SELECT ticker, asset_name, direction, target_pct, confidence,
                      opp_score, rationale, timeframe, event_category
               FROM trade_ideas
               WHERE status='active' AND opp_score >= 55
               ORDER BY confidence DESC, opp_score DESC
               LIMIT 5"""
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]
    return {"ideas": rows}


@router.get("/score/{event_id}")
async def get_event_score(event_id: str, user=Depends(require_user)):
    """Get opportunity score and ideas for a specific event."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)

        async with db.execute(
            "SELECT * FROM opp_scores WHERE event_id=?", (event_id,)
        ) as cur:
            score_row = await cur.fetchone()

        async with db.execute(
            "SELECT * FROM trade_ideas WHERE event_id=? AND status='active'",
            (event_id,)
        ) as cur:
            ideas = [dict(r) for r in await cur.fetchall()]

    for idea in ideas:
        for field in ("risks", "catalysts"):
            try:
                idea[field] = json.loads(idea[field]) if isinstance(idea[field], str) else idea[field]
            except Exception:
                idea[field] = []

    return {
        "event_id":  event_id,
        "opp_score": dict(score_row)["score"] if score_row else None,
        "ideas":     ideas,
    }


@router.post("/score/{event_id}/generate")
async def generate_ideas_for_event(event_id: str, user=Depends(require_user)):
    """Manually trigger idea generation for a specific event."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM events WHERE id=?", (event_id,)) as cur:
            ev = await cur.fetchone()

    if not ev:
        from fastapi import HTTPException
        raise HTTPException(404, "Event not found")

    result = await process_event_to_ideas(dict(ev), force=True)
    if not result:
        return {"message": "Event score too low for trade ideas", "opp_score": 0}
    return result


@router.get("/anomalies")
async def get_anomaly_alerts(
    limit: int = Query(30, le=100),
    alert_type: Optional[str] = Query(None),
    unread_only: bool = Query(False),
    user=Depends(require_user),
):
    """Return recent anomaly alerts."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)

        conditions = []
        params = []

        if alert_type:
            conditions.append("alert_type=?")
            params.append(alert_type)
        if unread_only:
            conditions.append("acknowledged=0")

        where = ("WHERE " + " AND ".join(conditions)) if conditions else ""
        params.append(limit)

        async with db.execute(
            f"SELECT * FROM anomaly_alerts {where} ORDER BY created_at DESC LIMIT ?",
            params
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]

    return {"alerts": rows, "total": len(rows)}


@router.post("/anomalies/{alert_id}/ack")
async def acknowledge_alert(alert_id: int, user=Depends(require_user)):
    """Mark anomaly alert as acknowledged."""
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE anomaly_alerts SET acknowledged=1 WHERE id=?", (alert_id,)
        )
        await db.commit()
    return {"success": True}


@router.get("/dashboard")
async def get_opportunity_dashboard(user=Depends(require_user)):
    """
    Aggregated dashboard: top ideas + anomaly summary + pipeline stats.
    Single endpoint for the frontend widget.
    """
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)

        # Top ideas
        async with db.execute(
            """SELECT ticker, asset_name, direction, target_pct, stop_pct,
                      confidence, opp_score, rationale, timeframe,
                      event_category, event_severity, created_at
               FROM trade_ideas
               WHERE status='active'
               ORDER BY confidence DESC, opp_score DESC
               LIMIT 6"""
        ) as cur:
            top_ideas = [dict(r) for r in await cur.fetchall()]

        # Anomaly summary
        async with db.execute(
            """SELECT alert_type, severity, COUNT(*) as cnt
               FROM anomaly_alerts
               WHERE datetime(created_at) > datetime('now','-24 hours')
               GROUP BY alert_type, severity"""
        ) as cur:
            anomaly_summary = [dict(r) for r in await cur.fetchall()]

        # Stats
        async with db.execute(
            """SELECT COUNT(*) as total,
                      SUM(CASE WHEN direction='LONG' THEN 1 ELSE 0 END)  as longs,
                      SUM(CASE WHEN direction='SHORT' THEN 1 ELSE 0 END) as shorts,
                      AVG(opp_score) as avg_score
               FROM trade_ideas
               WHERE status='active'"""
        ) as cur:
            stats_row = await cur.fetchone()
            stats = dict(stats_row) if stats_row else {}

        # Unread anomaly count
        async with db.execute(
            "SELECT COUNT(*) as cnt FROM anomaly_alerts WHERE acknowledged=0"
        ) as cur:
            unread_row = await cur.fetchone()
            unread_anomalies = dict(unread_row)["cnt"] if unread_row else 0

    return {
        "top_ideas":         top_ideas,
        "anomaly_summary":   anomaly_summary,
        "unread_anomalies":  unread_anomalies,
        "stats":             stats,
        "generated_at":      datetime.utcnow().isoformat(),
    }


@router.post("/ideas/{idea_id}/status")
async def update_idea_status(
    idea_id: int,
    payload: dict = Body(...),
    user=Depends(require_user),
):
    """Update idea status (active → expired / hit_target / hit_stop)."""
    new_status = payload.get("status", "expired")
    if new_status not in ("active", "expired", "hit_target", "hit_stop"):
        from fastapi import HTTPException
        raise HTTPException(400, "Invalid status")
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE trade_ideas SET status=? WHERE id=?", (new_status, idea_id)
        )
        await db.commit()
    return {"success": True}


# ─────────────────────────────────────────────────────────────────────────────
# FASE 4 — PERFORMANCE TRACKER
# ─────────────────────────────────────────────────────────────────────────────

async def _migrate_performance_columns():
    """Add performance columns to existing trade_ideas table if missing."""
    cols = [
        ("price_at_generation", "REAL"),
        ("price_current",       "REAL"),
        ("pnl_pct",             "REAL"),
        ("max_favorable_pct",   "REAL"),
        ("tracked_at",          "TEXT"),
        ("outcome_note",        "TEXT DEFAULT ''"),
    ]
    async with aiosqlite.connect(settings.db_path) as db:
        for col, definition in cols:
            try:
                await db.execute(f"ALTER TABLE trade_ideas ADD COLUMN {col} {definition}")
                await db.commit()
            except Exception:
                pass  # column already exists


async def run_performance_tracker() -> int:
    """
    Hourly job: check current prices for all active trade ideas.
    Updates pnl_pct, max_favorable_pct, and status (hit_target / hit_stop / expired).
    Returns count of ideas updated.
    """
    try:
        await _migrate_performance_columns()

        from scheduler import get_finance_cache
        fin_cache = get_finance_cache() or []
        price_map = {a["symbol"].upper(): a.get("price") for a in fin_cache if a.get("price")}

        if not price_map:
            return 0

        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row

            # Fetch all active ideas that have a generation price
            async with db.execute(
                """SELECT id, ticker, direction, target_pct, stop_pct,
                          price_at_generation, entry_low, max_favorable_pct,
                          created_at, expires_at
                   FROM trade_ideas
                   WHERE status='active'"""
            ) as cur:
                ideas = [dict(r) for r in await cur.fetchall()]

            now = datetime.utcnow()
            updated = 0

            for idea in ideas:
                tk = idea["ticker"].upper()
                cur_price = price_map.get(tk)
                if not cur_price:
                    continue

                # Reference price: price_at_generation if available, else entry midpoint
                ref_price = idea.get("price_at_generation")
                if not ref_price:
                    lo = idea.get("entry_low")
                    hi = idea.get("entry_high")
                    if lo and hi:
                        ref_price = (lo + hi) / 2
                if not ref_price or ref_price <= 0:
                    continue

                # Calculate P&L from perspective of the trade direction
                price_move_pct = (cur_price - ref_price) / ref_price * 100
                if idea["direction"] == "SHORT":
                    pnl_pct = -price_move_pct
                else:
                    pnl_pct = price_move_pct

                # Track max favorable excursion
                prev_max = idea.get("max_favorable_pct") or 0.0
                max_fav = max(prev_max, pnl_pct)

                # Determine new status
                new_status = "active"
                outcome_note = ""
                target = idea.get("target_pct", 0) or 0
                stop   = idea.get("stop_pct", 0)   or 0

                days_old = (now - datetime.fromisoformat(
                    idea["created_at"].replace("Z", "")
                )).days if idea.get("created_at") else 0

                if target and pnl_pct >= abs(target):
                    new_status   = "hit_target"
                    days_label   = f"{days_old}d" if days_old else "intraday"
                    outcome_note = f"✅ Target raggiunto +{pnl_pct:.1f}% in {days_label}"
                elif stop and pnl_pct <= -abs(stop):
                    new_status   = "hit_stop"
                    outcome_note = f"🛑 Stop loss -{abs(pnl_pct):.1f}% dopo {days_old}d"
                elif idea.get("expires_at"):
                    try:
                        exp = datetime.fromisoformat(idea["expires_at"].replace("Z", ""))
                        if now > exp:
                            new_status   = "expired"
                            outcome_note = f"⏱ Scaduta dopo {days_old}d. P&L finale: {pnl_pct:+.1f}%"
                    except Exception:
                        pass

                # Update DB
                await db.execute(
                    """UPDATE trade_ideas SET
                           price_current=?, pnl_pct=?, max_favorable_pct=?,
                           tracked_at=?, status=?, outcome_note=?
                       WHERE id=?""",
                    (round(cur_price, 4), round(pnl_pct, 2), round(max_fav, 2),
                     now.isoformat(), new_status, outcome_note, idea["id"])
                )
                updated += 1

            if updated:
                await db.commit()

        if updated:
            logger.info("Performance tracker: %d ideas updated", updated)
        return updated

    except Exception as e:
        logger.error("run_performance_tracker: %s", e)
        return 0


# ─────────────────────────────────────────────────────────────────────────────
# FASE 4 — PERFORMANCE API ENDPOINTS
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/performance")
async def get_performance_summary(user=Depends(require_user)):
    """
    Track record: aggregated stats on all closed ideas.
    Shows hit rate, average P&L, best/worst trades.
    """
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_tables(db)
        await _migrate_performance_columns()

        # Closed ideas
        async with db.execute(
            """SELECT id, ticker, asset_name, direction, target_pct, stop_pct,
                      pnl_pct, max_favorable_pct, opp_score, confidence,
                      status, outcome_note, created_at, tracked_at,
                      event_category, rationale
               FROM trade_ideas
               WHERE status IN ('hit_target','hit_stop','expired')
               ORDER BY tracked_at DESC
               LIMIT 50"""
        ) as cur:
            closed = [dict(r) for r in await cur.fetchall()]

        # Active with live P&L
        async with db.execute(
            """SELECT id, ticker, asset_name, direction, target_pct, stop_pct,
                      pnl_pct, max_favorable_pct, opp_score, confidence,
                      status, outcome_note, created_at, tracked_at,
                      event_category, rationale, price_at_generation, price_current
               FROM trade_ideas
               WHERE status='active'
               ORDER BY pnl_pct DESC NULLS LAST
               LIMIT 20"""
        ) as cur:
            active = [dict(r) for r in await cur.fetchall()]

    # Compute stats
    hits   = [x for x in closed if x["status"] == "hit_target"]
    stops  = [x for x in closed if x["status"] == "hit_stop"]
    total  = len(closed)
    hit_rate = round(len(hits) / total * 100, 1) if total else 0

    pnls = [x["pnl_pct"] for x in closed if x.get("pnl_pct") is not None]
    avg_pnl   = round(sum(pnls) / len(pnls), 2) if pnls else 0
    best_pnl  = round(max(pnls), 2) if pnls else 0
    worst_pnl = round(min(pnls), 2) if pnls else 0

    # Active P&L summary
    active_pnls = [x["pnl_pct"] for x in active if x.get("pnl_pct") is not None]
    active_avg  = round(sum(active_pnls) / len(active_pnls), 2) if active_pnls else 0
    in_profit   = len([p for p in active_pnls if p > 0])

    return {
        "track_record": {
            "total_closed":   total,
            "hit_target":     len(hits),
            "hit_stop":       len(stops),
            "expired":        total - len(hits) - len(stops),
            "hit_rate_pct":   hit_rate,
            "avg_pnl_pct":    avg_pnl,
            "best_pnl_pct":   best_pnl,
            "worst_pnl_pct":  worst_pnl,
        },
        "active_summary": {
            "count":         len(active),
            "in_profit":     in_profit,
            "avg_pnl_pct":   active_avg,
        },
        "closed_ideas":  closed,
        "active_ideas":  active,
    }


@router.post("/ideas/{idea_id}/add-to-portfolio")
async def idea_add_to_portfolio(
    idea_id: int,
    payload: dict = Body(...),
    user=Depends(require_user),
):
    """
    Fase 1: one-click add a trade idea to user's portfolio.
    Receives: {portfolio_id, shares}
    Creates the holding via finance_hub logic.
    """
    portfolio_id = payload.get("portfolio_id")
    shares       = float(payload.get("shares", 1))

    if not portfolio_id or shares <= 0:
        from fastapi import HTTPException
        raise HTTPException(400, "portfolio_id e shares richiesti")

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row

        # Fetch idea
        async with db.execute(
            "SELECT * FROM trade_ideas WHERE id=?", (idea_id,)
        ) as cur:
            idea = await cur.fetchone()
        if not idea:
            from fastapi import HTTPException
            raise HTTPException(404, "Trade idea non trovata")
        idea = dict(idea)

        # Verify portfolio ownership
        async with db.execute(
            "SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
            (portfolio_id, user["id"])
        ) as cur:
            port = await cur.fetchone()
        if not port:
            from fastapi import HTTPException
            raise HTTPException(404, "Portafoglio non trovato")

    # Determine entry price: midpoint of entry range or price_at_generation
    entry_price = None
    if idea.get("entry_low") and idea.get("entry_high"):
        entry_price = round((idea["entry_low"] + idea["entry_high"]) / 2, 4)
    elif idea.get("price_at_generation"):
        entry_price = idea["price_at_generation"]
    else:
        from scheduler import get_finance_cache
        fc = get_finance_cache() or []
        pm = {a["symbol"].upper(): a.get("price") for a in fc}
        entry_price = pm.get(idea["ticker"].upper(), 0) or 0

    if not entry_price or entry_price <= 0:
        from fastapi import HTTPException
        raise HTTPException(400, "Prezzo entry non disponibile per questo ticker")

    # Add holding via finance_hub
    from routers.finance_hub import add_holding, HoldingCreate
    holding_data = HoldingCreate(
        ticker      = idea["ticker"],
        name        = idea["asset_name"],
        shares      = shares,
        avg_price   = entry_price,
        currency    = "USD",
        asset_class = "equity",
    )

    try:
        result = await add_holding(
            pid  = portfolio_id,
            data = holding_data,
            user = user,
        )
    except Exception as e:
        from fastapi import HTTPException
        raise HTTPException(500, f"Errore aggiunta holding: {e}")

    # Log the link between idea and portfolio holding
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            """CREATE TABLE IF NOT EXISTS idea_portfolio_links (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               idea_id INTEGER NOT NULL,
               portfolio_id INTEGER NOT NULL,
               holding_id INTEGER,
               user_id INTEGER NOT NULL,
               shares REAL NOT NULL,
               entry_price REAL NOT NULL,
               linked_at TEXT DEFAULT (datetime('now'))
            )"""
        )
        await db.execute(
            "INSERT INTO idea_portfolio_links (idea_id,portfolio_id,holding_id,user_id,shares,entry_price) VALUES (?,?,?,?,?,?)",
            (idea_id, portfolio_id, result.get("id"), user["id"], shares, entry_price)
        )
        await db.commit()

    return {
        "success":     True,
        "holding_id":  result.get("id"),
        "ticker":      idea["ticker"],
        "shares":      shares,
        "entry_price": entry_price,
        "portfolio_id": portfolio_id,
        "message":     f"{idea['ticker']} aggiunto al portafoglio a {entry_price:.2f}",
    }
