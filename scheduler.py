"""World Lens — Background scheduler v2

Jobs:
  events  — fetch + persist every update_interval_seconds
  finance — fetch + cache every finance_interval_seconds
  enrich  — run lightweight sentiment on recent unprocessed events
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

import aiosqlite
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from config import settings
from scrapers.events import fetch_all_events
from config import settings
from scrapers.finance import fetch_finance, get_cached
from scrapers.macro   import fetch_all_macro
from notifications   import send_alert_triggered

# ── Brain auto-population (lazy import) ──────────────────────────────────────
async def _get_autopop():
    try:
        from brain_autopop import (
            auto_populate_from_events,
            auto_populate_from_macro,
            auto_populate_from_finance,
            nightly_deep_extraction,
        )
        return auto_populate_from_events, auto_populate_from_macro, auto_populate_from_finance, nightly_deep_extraction
    except Exception as e:
        logger.debug("brain_autopop import: %s", e)
        return None, None, None, None

from analysis.ml_engine import (
    build_user_tfidf_vector, tfidf_to_json, tfidf_from_json
)

logger = logging.getLogger(__name__)

_scheduler: Optional[AsyncIOScheduler] = None
_ws_callbacks = []
_finance_cache = []


def register_ws_callback(cb):
    _ws_callbacks.append(cb)


def get_finance_cache():
    return _finance_cache or get_cached()


# ── Event persistence ─────────────────────────────────────

async def _persist_events(events, db) -> int:
    """Insert new events. Returns count of newly inserted rows."""
    new_count = 0
    for ev in events:
        try:
            # Check if already exists
            async with db.execute("SELECT id FROM events WHERE id=?", (ev["id"],)) as cur:
                exists = await cur.fetchone()
            if exists:
                continue

            await db.execute(
                """INSERT INTO events
                   (id, timestamp, title, summary, category, source,
                    latitude, longitude, country_code, country_name,
                    severity, impact, url, ai_impact_score, related_markets,
                    topic_vector, source_count, source_list, sent_credibility,
                    sentiment_score, sentiment_tone, keywords, narrative_id,
                    timeline_band, heat_index, market_impact)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    ev["id"],
                    ev["timestamp"],
                    ev["title"],
                    ev.get("summary", ""),
                    ev["category"],
                    ev["source"],
                    ev.get("latitude", 0.0),
                    ev.get("longitude", 0.0),
                    ev.get("country_code", "XX"),
                    ev.get("country_name", ""),
                    ev.get("severity", 5.0),
                    ev.get("impact", "Medium"),
                    ev.get("url", ""),
                    ev.get("ai_impact_score", 5.0),
                    json.dumps(ev.get("related_markets", [])),
                    json.dumps(ev.get("topic_vector", [])),
                    ev.get("source_count", 1),
                    json.dumps(ev.get("source_list", [ev.get("source", "")])),
                    ev.get("sent_credibility", 0.75),
                    ev.get("sentiment_score", 0.0),
                    ev.get("sentiment_tone", "neutral"),
                    json.dumps(ev.get("keywords", [])),
                    ev.get("narrative_id", ""),
                    ev.get("timeline_band", "geopolitical"),
                    ev.get("heat_index", 0.0),
                    ev.get("market_impact", 0.0),
                ),
            )
            new_count += 1
        except Exception as e:
            logger.debug("Event insert error [%s]: %s", ev.get("id", "?"), e)

    return new_count


# ── Event poll job ────────────────────────────────────────

async def _poll_events():
    logger.info("Polling events…")
    try:
        events = await fetch_all_events()
        if not events:
            logger.warning("No events returned from fetch_all_events")
            return

        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row

            new_count = await _persist_events(events, db)
            await db.commit()

            # ── Category-aware trim ─────────────────────────────
            # Keep max_events_per_category per category (weighted by priority),
            # then trim overall to max_events.
            # Financial/macro categories get more slots.
            CATEGORY_SLOTS = {
                "ECONOMICS":    settings.max_events_per_category,
                "FINANCE":      settings.max_events_per_category,
                "CONFLICT":     int(settings.max_events_per_category * 0.8),
                "GEOPOLITICS":  int(settings.max_events_per_category * 0.8),
                "POLITICS":     int(settings.max_events_per_category * 0.6),
                "ENERGY":       int(settings.max_events_per_category * 0.6),
                "TECHNOLOGY":   int(settings.max_events_per_category * 0.5),
                "DISASTER":     int(settings.max_events_per_category * 0.5),
                "HEALTH":       int(settings.max_events_per_category * 0.4),
                "SECURITY":     int(settings.max_events_per_category * 0.4),
                "HUMANITARIAN": int(settings.max_events_per_category * 0.3),
                "EARTHQUAKE":   int(settings.max_events_per_category * 0.3),
            }
            default_slots = int(settings.max_events_per_category * 0.3)
            for cat, slots in CATEGORY_SLOTS.items():
                await db.execute(
                    """DELETE FROM events WHERE category = ? AND id NOT IN (
                           SELECT id FROM events WHERE category = ?
                           ORDER BY severity DESC, timestamp DESC LIMIT ?
                       )""",
                    (cat, cat, slots),
                )
            # Final overall cap by recency
            await db.execute(
                """DELETE FROM events WHERE id NOT IN (
                       SELECT id FROM events ORDER BY timestamp DESC LIMIT ?
                   )""",
                (settings.max_events,),
            )
            await db.commit()

            # Count total events in DB
            async with db.execute("SELECT COUNT(*) FROM events") as cur:
                total = (await cur.fetchone())[0]

        logger.info(
            "Events: %d new | %d total in DB | %d fetched this cycle",
            new_count, total, len(events),
        )

        if new_count > 0:
            for cb in _ws_callbacks:
                try:
                    await cb({"type": "events_updated", "count": new_count, "total": total})
                except Exception:
                    pass

        # ── Brain L1: always run (not gated on new_count) ────────────────────
        try:
            fn_events, _, _, _ = await _get_autopop()
            if fn_events and events:
                await fn_events(events[:50])
        except Exception as _bpe:
            logger.debug("brain autopop events: %s", _bpe)

        # ── Brain L4: Wikipedia enrichment (always, 5 nodes per cycle) ───────
        try:
            from brain_autopop import enrich_new_nodes_batch
            await enrich_new_nodes_batch(limit=5)
        except Exception as _wpe:
            logger.debug("wiki enrichment: %s", _wpe)

    except Exception as e:
        logger.error("Event poll error: %s", e, exc_info=True)


# ── Sentiment enrichment job ──────────────────────────────

async def _poll_gdelt():
    """Fetch events from GDELT and merge into DB alongside RSS events."""
    if not settings.enable_gdelt:
        return
    try:
        from analysis.gdelt_client import gdelt_fetch_all
        from scrapers.events import _dedup_events, classify, score_to_impact
        from geocoder import find_country_enhanced, get_coords, get_name
        import json

        gdelt_raw = await gdelt_fetch_all(timespan=settings.gdelt_timespan)
        if not gdelt_raw:
            return

        # Enrich GDELT events with category/geo from scraper pipeline
        enriched = []
        for ev in gdelt_raw:
            if not ev.get("category") or ev["category"] == "GEOPOLITICS":
                from scrapers.events import classify
                cat, sev, mkts = classify(ev.get("title","") + " " + ev.get("summary",""))
                ev["category"] = cat
                ev["severity"]  = max(ev.get("severity", 5.0), sev)
                ev["related_markets"] = mkts
            if ev.get("country_code","XX") == "XX":
                cc = find_country_enhanced(ev.get("title","") + " " + ev.get("summary",""))
                if cc != "XX":
                    lat, lon = get_coords(cc)
                    ev["country_code"] = cc
                    ev["country_name"] = get_name(cc)
                    ev["latitude"]     = lat
                    ev["longitude"]    = lon
            enriched.append(ev)

        # Persist (same INSERT OR IGNORE logic as RSS events)
        added = 0
        async with aiosqlite.connect(settings.db_path) as db:
            for ev in enriched:
                try:
                    async with db.execute("SELECT id FROM events WHERE id=?", (ev["id"],)) as cur:
                        if await cur.fetchone():
                            continue
                    await db.execute(
                        """INSERT INTO events
                           (id,timestamp,title,summary,category,source,
                            latitude,longitude,country_code,country_name,
                            severity,impact,url,ai_impact_score,related_markets,
                            topic_vector,source_count,source_list,sent_credibility)
                           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                        (ev["id"], ev.get("timestamp"), ev.get("title",""),
                         ev.get("summary",""), ev.get("category","GEOPOLITICS"),
                         ev.get("source","GDELT"),
                         ev.get("latitude",0.0), ev.get("longitude",0.0),
                         ev.get("country_code","XX"), ev.get("country_name",""),
                         ev.get("severity",5.0), score_to_impact(ev.get("severity",5.0)),
                         ev.get("url",""), ev.get("ai_impact_score",5.0),
                         json.dumps(ev.get("related_markets",[])),
                         json.dumps([]),   # topic_vector computed in enrich job
                         ev.get("source_count",1),
                         json.dumps([ev.get("source","GDELT")]),
                         ev.get("sent_credibility",0.70))
                    )
                    added += 1
                except Exception as e:
                    logger.debug("GDELT insert error: %s", e)
            await db.commit()
        logger.info("GDELT: %d new events added (%d fetched)", added, len(enriched))
    except Exception as e:
        logger.error("GDELT poll error: %s", e, exc_info=True)


async def _enrich_sentiment():
    """
    Process up to 10 recent events that have no sentiment score yet.
    Uses FinBERT if available, falls back to Gemini/rule-based.
    Runs every 3 minutes.
    """
    # Prefer FinBERT over Gemini for financial sentiment
    use_finbert = settings.enable_finbert
    from ai_layer import ai_sentiment, _ai_available

    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                """SELECT id, title, summary, category, source
                   FROM events
                   WHERE (sentiment_tone IS NULL OR sentiment_tone = '')
                   ORDER BY timestamp DESC
                   LIMIT 10"""
            ) as cur:
                rows = [dict(r) for r in await cur.fetchall()]

        if not rows:
            return

        logger.info("Enriching sentiment for %d events", len(rows))
        enriched = 0
        for row in rows:
            try:
                # FinBERT preferred, Gemini/rule-based fallback
                if use_finbert:
                    try:
                        from analysis.impact_engine import quick_finbert_sentiment
                        result = await quick_finbert_sentiment(
                            row["title"],
                            row.get("summary") or "",
                            row["category"],
                            row.get("source") or "",
                        )
                    except Exception:
                        result = await ai_sentiment(
                            row["title"], row.get("summary") or "",
                            row["category"], row.get("source") or "")
                else:
                    result = await ai_sentiment(
                        row["title"],
                        row.get("summary") or "",
                        row["category"],
                        row.get("source") or "",
                    )
                async with aiosqlite.connect(settings.db_path) as db:
                    await db.execute(
                        """UPDATE events SET
                               sentiment_score=?, sentiment_tone=?,
                               sentiment_intensity=?, sentiment_info_type=?,
                               sentiment_entities=?,
                               sent_uncertainty=?, sent_market_stress=?,
                               sent_narrative_momentum=?, sent_credibility=?
                           WHERE id=?""",
                        (
                            result.get("score", 0.0),
                            result.get("tone", "Neutral"),
                            result.get("intensity", "Low"),
                            result.get("info_type", "News Event"),
                            json.dumps(result.get("entity_sentiments", [])),
                            result.get("uncertainty", 0.0),
                            result.get("market_stress", 0.0),
                            result.get("narrative_momentum", 0.0),
                            result.get("credibility", 0.75),
                            row["id"],
                        ),
                    )
                    await db.commit()
                enriched += 1
            except Exception as e:
                logger.debug("Sentiment enrich error [%s]: %s", row["id"], e)

        if enriched:
            logger.info("Sentiment enriched: %d/%d events", enriched, len(rows))

    except Exception as e:
        logger.error("Sentiment enrich job error: %s", e)


# ── Finance poll job ──────────────────────────────────────

async def _poll_finance():
    global _finance_cache
    logger.info("Polling finance…")
    try:
        data = await fetch_finance()
        _finance_cache = data
        async with aiosqlite.connect(settings.db_path) as db:
            for asset in data:
                await db.execute(
                    """INSERT OR REPLACE INTO finance_cache
                       (symbol, name, price, change_pct, change_abs, history, updated_at)
                       VALUES (?,?,?,?,?,?,datetime('now'))""",
                    (
                        asset["symbol"], asset["name"],
                        asset["price"], asset["change_pct"],
                        asset["change_abs"],
                        json.dumps(asset.get("history", [])),
                    ),
                )
            await db.commit()

        for cb in _ws_callbacks:
            try:
                await cb({"type": "finance_updated", "data": data})
            except Exception:
                pass
    except Exception as e:
        logger.error("Finance poll error: %s", e)


# ── Scheduler lifecycle ───────────────────────────────────

# ── Daily brief job ───────────────────────────────────────────────────────────

async def _generate_daily_briefs():
    """
    Generate a personalised daily brief for every active user.
    Runs once per day at 07:00 UTC.
    Calls the same logic as GET /api/engage/insight/today but for all active users.
    """
    logger.info("Daily brief generation: starting")
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            # Active users who logged in within the last 7 days
            async with db.execute(
                "SELECT id FROM users WHERE is_active=1 "
                "AND last_login > datetime('now','-7 days')"
            ) as cur:
                user_ids = [r[0] for r in await cur.fetchall()]

        logger.info("Daily brief: generating for %d active users", len(user_ids))
        generated = 0
        today = datetime.now().date().isoformat()

        for uid in user_ids:
            try:
                async with aiosqlite.connect(settings.db_path) as db:
                    db.row_factory = aiosqlite.Row

                    # Skip if already generated today
                    async with db.execute(
                        "SELECT id FROM daily_insights WHERE user_id=? AND date=?",
                        (uid, today)
                    ) as cur:
                        if await cur.fetchone():
                            continue

                    # Fetch user profile
                    async with db.execute(
                        "SELECT interests, regions FROM users WHERE id=?", (uid,)
                    ) as cur:
                        row = await cur.fetchone()
                    u = dict(row) if row else {}

                    # Fetch watchlist
                    async with db.execute(
                        "SELECT label, type FROM watchlist WHERE user_id=? LIMIT 8", (uid,)
                    ) as cur:
                        wl = [dict(r) for r in await cur.fetchall()]

                    # Fetch real affinity from activity
                    async with db.execute("""
                        SELECT e.category, COUNT(*) as cnt
                        FROM   activity_log al
                        JOIN   events e ON e.id = al.detail
                        WHERE  al.user_id=?
                          AND  al.action IN ('event_opened','event_saved')
                          AND  al.created_at > datetime('now','-30 days')
                        GROUP  BY e.category
                        ORDER  BY cnt DESC LIMIT 5
                    """, (uid,)) as cur:
                        top_cats = [dict(r) for r in await cur.fetchall()]

                    # Recent high-severity events
                    async with db.execute(
                        "SELECT title, category, country_name, severity FROM events "
                        "WHERE datetime(timestamp) > datetime('now','-48 hours') "
                        "ORDER BY severity DESC LIMIT 8",
                    ) as cur:
                        events = [dict(r) for r in await cur.fetchall()]

                import json as _json
                interests = []
                regions   = []
                try:    interests = _json.loads(u.get("interests") or "[]")
                except: pass
                try:    regions   = _json.loads(u.get("regions")   or "[]")
                except: pass

                # Prefer real behaviour over onboarding
                cat_focus = [r["category"] for r in top_cats] if top_cats else interests
                wl_text   = ", ".join([w["label"] for w in wl]) if wl else "general markets"
                ev_text   = "\n".join([
                    "- " + e["title"] + " [" + e["category"] + ", sev " + str(round(e["severity"],1)) + "]"
                    for e in events[:6]
                ]) or "No major events in the last 48h"

                prompt = (
                    "User profile:\n"
                    "- Top categories: " + (", ".join(cat_focus[:4]) or "general") + "\n"
                    "- Regions: " + (", ".join(regions) or "global") + "\n"
                    "- Watching: " + wl_text + "\n\n"
                    "Recent global events (last 48h):\n" + ev_text + "\n\n"
                    "Write a personalised 'Insight for You Today' in 2-3 sentences. "
                    "Be specific, connect their interests to today's events, be actionable."
                )

                from ai_layer import _call_claude
                text = await _call_claude(prompt, max_tokens=200)

                if not text and events:
                    top = events[0]
                    text = (
                        "Top story today: " + top["title"][:80] + ". "
                        "Severity " + str(round(top["severity"],1)) + "/10. "
                        "Check the feed for full analysis and market impact."
                    )

                if text:
                    async with aiosqlite.connect(settings.db_path) as db:
                        await db.execute(
                            "INSERT OR REPLACE INTO daily_insights (user_id, date, insight) VALUES (?,?,?)",
                            (uid, today, text)
                        )
                        await db.commit()
                    generated += 1

            except Exception as e:
                logger.debug("Daily brief error for user %d: %s", uid, e)

        logger.info("Daily brief: generated %d/%d briefs", generated, len(user_ids))
    except Exception as e:
        logger.error("Daily brief job error: %s", e)


# ── Macro indicators poll job ─────────────────────────────────────────────────

async def _poll_macro():
    """
    Fetch live macro data from FRED, World Bank, ECB, CoinGecko.
    Upserts into macro_indicators table (UPSERT by name+country).
    Runs every macro_interval_seconds (default 6h).
    """
    logger.info("Polling live macro indicators…")
    try:
        indicators = await fetch_all_macro(
            fred_key = settings.fred_api_key,
            av_key   = settings.alpha_vantage_key,
        )
        if not indicators:
            logger.warning("Macro poll: no data returned")
            return

        async with aiosqlite.connect(settings.db_path) as db:
            updated = 0
            for ind in indicators:
                await db.execute("""
                    INSERT INTO macro_indicators (name, value, previous, unit, category, country, updated_at)
                    VALUES (?,?,?,?,?,?,datetime('now'))
                    ON CONFLICT(name) DO UPDATE SET
                        value      = excluded.value,
                        previous   = excluded.previous,
                        updated_at = datetime('now')
                """,
                (ind["name"], ind["value"], ind.get("previous", ind["value"]),
                 ind.get("unit",""), ind.get("category","economy"),
                 ind.get("country","Global")))
                updated += 1
            await db.commit()

        logger.info("Macro poll: upserted %d indicators", updated)

        # ── Brain auto-population: macro → KG ───────────────────────────────
        try:
            _, fn_macro, _, _ = await _get_autopop()
            if fn_macro:
                await fn_macro(indicators)
        except Exception as _bpe:
            logger.debug("brain autopop macro: %s", _bpe)

    except Exception as e:
        logger.error("Macro poll error: %s", e)


# ── Alert email checker ───────────────────────────────────────────────────────

async def _check_alert_emails():
    """
    For each new high-severity event (last 15 min), check all active user alerts.
    If an alert condition matches, send an email notification.
    Runs every 15 minutes — won't spam since events are deduplicated.
    """
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row

            # Events in the last 15 minutes (fresh events only)
            async with db.execute("""
                SELECT * FROM events
                WHERE datetime(timestamp) > datetime('now', '-15 minutes')
                  AND severity >= 6.0
                ORDER BY severity DESC LIMIT 20
            """) as cur:
                new_events = [dict(r) for r in await cur.fetchall()]

            if not new_events:
                return

            # Active alerts for all active users
            async with db.execute("""
                SELECT a.id, a.user_id, a.title, a.condition, a.category,
                       a.country, a.severity_threshold,
                       u.email, u.username, u.notifications_enabled
                FROM   alerts a
                JOIN   users u ON u.id = a.user_id
                WHERE  a.active = 1
                  AND  u.is_active = 1
                  AND  u.notifications_enabled = 1
            """) as cur:
                all_alerts = [dict(r) for r in await cur.fetchall()]

        if not all_alerts:
            return

        sent = 0
        for ev in new_events:
            ev_cat  = (ev.get("category") or "").upper()
            ev_cc   = (ev.get("country_code") or "").upper()
            ev_sev  = float(ev.get("severity") or 5.0)
            ev_text = ((ev.get("title") or "") + " " + (ev.get("summary") or "")).lower()

            for alert in all_alerts:
                # Severity threshold check
                if ev_sev < float(alert.get("severity_threshold") or 6.0):
                    continue
                # Category filter
                a_cat = (alert.get("category") or "").upper()
                if a_cat and a_cat != ev_cat:
                    continue
                # Country filter
                a_cc  = (alert.get("country") or "").upper()
                if a_cc and len(a_cc) == 2 and a_cc != ev_cc:
                    continue
                # Keyword condition match
                cond = (alert.get("condition") or "").lower().strip()
                if cond and len(cond) > 2 and cond not in ev_text:
                    continue

                # Check we haven't sent this alert for this event already
                # (simple dedup: skip if alert was triggered in last 2h)
                async with aiosqlite.connect(settings.db_path) as db:
                    async with db.execute("""
                        SELECT id FROM activity_log
                        WHERE user_id=? AND action='alert_email_sent'
                          AND detail LIKE ?
                          AND created_at > datetime('now','-2 hours')
                        LIMIT 1
                    """, (alert["user_id"], f"%{ev['id'][:16]}%")) as cur:
                        already_sent = await cur.fetchone()
                    if already_sent:
                        continue

                # Send email
                ok = await send_alert_triggered(
                    alert["email"],
                    alert["username"],
                    alert["title"],
                    dict(ev),
                )
                if ok:
                    # Log so we don't double-send
                    async with aiosqlite.connect(settings.db_path) as db:
                        await db.execute(
                            "INSERT INTO activity_log (user_id,action,section,detail) VALUES (?,?,?,?)",
                            (alert["user_id"], "alert_email_sent", "alerts",
                             f"{alert['id']}:{ev['id'][:16]}")
                        )
                        await db.commit()
                    sent += 1

        if sent:
            logger.info("Alert emails sent: %d", sent)

    except Exception as e:
        logger.error("Alert email checker error: %s", e)


# ── Nightly ML model rebuild ──────────────────────────────────────────────────

async def _rebuild_ml_models():
    """
    Nightly job: rebuild TF-IDF user profile vectors for all active users.
    Runs at 02:00 UTC so it's ready before the 07:00 daily brief.
    Skips users with fewer than 5 events opened.
    """
    if not settings.enable_ml_features:
        return

    logger.info("ML rebuild: starting nightly TF-IDF update")
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id FROM users WHERE is_active=1 "
                "AND last_login > datetime('now','-14 days')"
            ) as cur:
                user_ids = [r[0] for r in await cur.fetchall()]

        rebuilt = 0
        for uid in user_ids:
            try:
                async with aiosqlite.connect(settings.db_path) as db:
                    db.row_factory = aiosqlite.Row
                    async with db.execute("""
                        SELECT DISTINCT e.title, e.summary, e.category
                        FROM   activity_log al
                        JOIN   events e ON e.id = al.detail
                        WHERE  al.user_id = ?
                          AND  al.action IN ('event_opened','event_saved','event_dwell_30s')
                        ORDER  BY al.created_at DESC LIMIT 100
                    """, (uid,)) as cur:
                        rows = await cur.fetchall()

                texts = [
                    (r["title"] or "") + " " + (r["summary"] or "") + " " + (r["category"] or "")
                    for r in rows
                ]
                profile = build_user_tfidf_vector(texts)
                if profile is None:
                    continue

                async with aiosqlite.connect(settings.db_path) as db:
                    await db.execute("""
                        INSERT INTO user_models (user_id, model_type, model_data, updated_at)
                        VALUES (?, 'tfidf_vector', ?, datetime('now'))
                        ON CONFLICT(user_id, model_type) DO UPDATE SET
                            model_data = excluded.model_data,
                            updated_at = datetime('now')
                    """, (uid, tfidf_to_json(profile)))
                    await db.commit()
                rebuilt += 1
            except Exception as e:
                logger.debug("ML rebuild error for user %d: %s", uid, e)

        logger.info("ML rebuild: updated %d/%d user profiles", rebuilt, len(user_ids))
    except Exception as e:
        logger.error("ML rebuild job error: %s", e)


def start():
    global _scheduler
    _scheduler = AsyncIOScheduler()

    _scheduler.add_job(
        _poll_events, "interval",
        seconds=settings.update_interval_seconds,
        id="events",
        next_run_time=datetime.now(),
    )
    _scheduler.add_job(
        _poll_finance, "interval",
        seconds=settings.finance_interval_seconds,
        id="finance",
        next_run_time=datetime.now(),
    )
    _scheduler.add_job(
        _enrich_sentiment, "interval",
        seconds=180,  # every 3 minutes
        id="sentiment",
        next_run_time=datetime.now(),
    )
    _scheduler.add_job(
        _poll_gdelt, "interval",
        seconds=max(settings.update_interval_seconds, 300),  # min 5 min
        id="gdelt",
        next_run_time=datetime.now(),
    )
    _scheduler.add_job(
        _generate_daily_briefs, "cron",
        hour=7, minute=0,
        id="daily_briefs",
        misfire_grace_time=3600,
    )
    _scheduler.add_job(
        _poll_macro, "interval",
        seconds=settings.macro_interval_seconds,
        id="macro",
        next_run_time=datetime.now(),
    )
    _scheduler.add_job(
        _check_alert_emails, "interval",
        seconds=900,
        id="alert_emails",
        misfire_grace_time=300,
    )
    _scheduler.add_job(
        _rebuild_ml_models, "cron",
        hour=2, minute=0,       # 02:00 UTC — before daily brief at 07:00
        id="ml_rebuild",
        misfire_grace_time=3600,
    )
    _scheduler.add_job(
        _run_agent_digests, "cron",
        hour=7, minute=30,      # 07:30 UTC — after daily brief
        id="agent_digests",
        misfire_grace_time=3600,
    )
    _scheduler.add_job(
        _run_friday_predictions, "cron",
        day_of_week="fri", hour=18, minute=0,   # Friday 18:00 UTC
        id="friday_predictions",
        misfire_grace_time=3600,
    )
    _scheduler.add_job(
        _run_monday_verify, "cron",
        day_of_week="mon", hour=8, minute=0,    # Monday 08:00 UTC
        id="monday_verify",
        misfire_grace_time=3600,
    )

    # ── Brain autonomous population (every 15 min) ──────────────────────────
    async def _autonomous_brain_pop():
        try:
            from brain_autopop import autonomous_brain_population
            await autonomous_brain_population()
        except Exception as e:
            logger.warning("autonomous_brain_pop: %s", e)

    _scheduler.add_job(
        _autonomous_brain_pop, "interval",
        minutes=15,
        id="brain_autonomous",
        misfire_grace_time=300,
    )

    # ── Brain cross-source synthesis (every 6h) ───────────────────────────────
    async def _brain_cross_source():
        try:
            from brain_autopop import cross_source_synthesis
            await cross_source_synthesis()
        except Exception as e:
            logger.warning("brain_cross_source: %s", e)

    _scheduler.add_job(
        _brain_cross_source, "interval",
        hours=6,
        id="brain_cross_source",
        misfire_grace_time=1800,
    )

    # ── Brain nightly deep extraction (Level 3) ──────────────────────────────
    async def _nightly_brain_extraction():
        try:
            _, _, _, fn_nightly = await _get_autopop()
            if fn_nightly:
                await fn_nightly()
        except Exception as e:
            logger.warning("nightly_brain_extraction: %s", e)

    _scheduler.add_job(
        _nightly_brain_extraction, "cron",
        hour=3, minute=0,    # 03:00 UTC — low traffic, before daily briefs
        id="brain_extraction",
        misfire_grace_time=3600,
    )

    # ── Brain proactive digest — Layer 4 (07:00 UTC daily) ───────────────────
    async def _daily_brain_digest():
        try:
            from brain_enhance import run_all_enhancements_for_user
            async with aiosqlite.connect(settings.db_path) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT DISTINCT user_id FROM brain_entries "
                    "WHERE datetime(timestamp) > datetime('now','-7 days') "
                    "ORDER BY user_id"
                ) as c:
                    user_ids = [r["user_id"] for r in await c.fetchall()]
            for uid in user_ids[:50]:
                await run_all_enhancements_for_user(uid)
                await asyncio.sleep(2)
        except Exception as e:
            logger.warning("daily_brain_digest: %s", e)

    _scheduler.add_job(
        _daily_brain_digest, "cron",
        hour=7, minute=0,
        id="brain_digest",
        misfire_grace_time=3600,
    )

    _scheduler.add_job(
        _broadcast_tg_pnl, "interval",
        seconds=30,
        id="tg_pnl",
        next_run_time=__import__('datetime').datetime.now(),
    )
    _scheduler.start()
    logger.info(
        "Scheduler started — events every %ds, finance every %ds, sentiment every 180s",
        settings.update_interval_seconds,
        settings.finance_interval_seconds,
    )


def stop():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown()
        logger.info("Scheduler stopped")


# ── Agent scheduled jobs ─────────────────────────────────────────────────────

async def _run_agent_digests():
    """07:30 UTC — generate morning digest for all active users."""
    logger.info("Agent digests: starting")
    try:
        from datetime import date
        today = date.today().isoformat()
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id FROM users WHERE is_active=1 "
                "AND last_login > datetime('now','-7 days')"
            ) as cur:
                user_ids = [r[0] for r in await cur.fetchall()]

        from routers.agents import (
            DEFAULT_BOTS, _load_user_config, _get_bot_events,
            _generate_digest, _update_streak
        )

        count = 0
        for uid in user_ids:
            for bot_id in DEFAULT_BOTS:
                try:
                    # Skip if already generated today
                    async with aiosqlite.connect(settings.db_path) as db:
                        db.row_factory = aiosqlite.Row
                        async with db.execute(
                            "SELECT id FROM agent_digest_log "
                            "WHERE user_id=? AND bot_id=? AND digest_date=?",
                            (uid, bot_id, today)
                        ) as cur:
                            already = await cur.fetchone()
                    if already:
                        continue

                    config = await _load_user_config(uid, bot_id)
                    if not config.get("enabled", True):
                        continue
                    events = await _get_bot_events(bot_id, config, limit=5)
                    await _generate_digest(bot_id, config, events)

                    async with aiosqlite.connect(settings.db_path) as db:
                        await db.execute(
                            "INSERT OR IGNORE INTO agent_digest_log "
                            "(user_id, bot_id, digest_date) VALUES (?, ?, ?)",
                            (uid, bot_id, today)
                        )
                        await db.commit()
                    count += 1
                except Exception as e:
                    logger.warning("digest uid=%s bot=%s: %s", uid, bot_id, e)

        logger.info("Agent digests: generated %d", count)
    except Exception as e:
        logger.error("_run_agent_digests: %s", e)


async def _run_friday_predictions():
    """Friday 18:00 — generate weekly predictions for all active users."""
    logger.info("Friday predictions: starting")
    try:
        from routers.agents import (
            DEFAULT_BOTS, _load_user_config, _get_bot_events,
            _generate_prediction, _week_key
        )
        week = _week_key()

        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT id FROM users WHERE is_active=1 "
                "AND last_login > datetime('now','-14 days')"
            ) as cur:
                user_ids = [r[0] for r in await cur.fetchall()]

        count = 0
        for uid in user_ids:
            for bot_id in DEFAULT_BOTS:
                try:
                    # Skip if already exists
                    async with aiosqlite.connect(settings.db_path) as db:
                        async with db.execute(
                            "SELECT id FROM agent_predictions "
                            "WHERE user_id=? AND bot_id=? AND week_key=?",
                            (uid, bot_id, week)
                        ) as cur:
                            exists = await cur.fetchone()
                    if exists:
                        continue

                    config = await _load_user_config(uid, bot_id)
                    if not config.get("enabled", True):
                        continue
                    events = await _get_bot_events(bot_id, config, limit=10)
                    pred   = await _generate_prediction(bot_id, config, events)
                    if pred:
                        import json
                        async with aiosqlite.connect(settings.db_path) as db:
                            await db.execute(
                                "INSERT OR IGNORE INTO agent_predictions "
                                "(user_id, bot_id, week_key, prediction_json) "
                                "VALUES (?, ?, ?, ?)",
                                (uid, bot_id, week, json.dumps(pred))
                            )
                            await db.commit()
                        count += 1
                except Exception as e:
                    logger.warning("prediction uid=%s bot=%s: %s", uid, bot_id, e)

        logger.info("Friday predictions: generated %d", count)
    except Exception as e:
        logger.error("_run_friday_predictions: %s", e)


async def _run_monday_verify():
    """Monday 08:00 — verify last week's predictions against real events."""
    logger.info("Monday verify: starting")
    try:
        from datetime import datetime, timedelta
        import json
        from routers.agents import (
            DEFAULT_BOTS, _load_user_config, _get_bot_events,
            _verify_prediction_ai, _week_key
        )

        last_week = _week_key(datetime.utcnow() - timedelta(weeks=1))

        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT user_id, bot_id, prediction_json FROM agent_predictions "
                "WHERE week_key=? AND verify_json IS NULL",
                (last_week,)
            ) as cur:
                rows = await cur.fetchall()

        count = 0
        for row in rows:
            uid, bot_id = row["user_id"], row["bot_id"]
            try:
                config    = await _load_user_config(uid, bot_id)
                events    = await _get_bot_events(bot_id, config, limit=15)
                prediction = json.loads(row["prediction_json"])
                verify    = await _verify_prediction_ai(bot_id, prediction, events)
                async with aiosqlite.connect(settings.db_path) as db:
                    await db.execute(
                        "UPDATE agent_predictions SET verify_json=?, verify_ts=datetime('now'), "
                        "accuracy_score=? WHERE user_id=? AND bot_id=? AND week_key=?",
                        (json.dumps(verify), verify.get("score", 0.5), uid, bot_id, last_week)
                    )
                    await db.commit()
                count += 1
            except Exception as e:
                logger.warning("verify uid=%s bot=%s: %s", uid, bot_id, e)

        logger.info("Monday verify: verified %d predictions", count)
    except Exception as e:
        logger.error("_run_monday_verify: %s", e)


# ── Tradgentic live PnL broadcast (every 30s when users online) ──────────────
async def _broadcast_tg_pnl():
    """Push live PnL updates for all active bots via WebSocket."""
    try:
        from routers.tradgentic.portfolio import list_bots as tg_list_bots, get_portfolio_stats
        from routers.tradgentic.market_data import fetch_multi

        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT DISTINCT user_id FROM tg_bots WHERE active=1"
            ) as cur:
                user_rows = await cur.fetchall()

        for row in user_rows:
            uid   = row[0]
            bots  = await tg_list_bots(uid)
            pnls  = []
            for b in bots:
                if not b.get("active", 1):
                    continue
                assets = b.get("assets", [])
                prices = {}
                if assets:
                    qd     = await fetch_multi(assets)
                    prices = {s: d["price"] for s, d in qd.items()}
                stats = await get_portfolio_stats(b["id"], prices)
                pnls.append({
                    "bot_id":       b["id"],
                    "name":         b["name"],
                    "equity":       stats.get("equity", 0),
                    "total_return": stats.get("total_return", 0),
                    "positions":    stats.get("positions", []),
                })

            if pnls:
                for cb in _ws_callbacks:
                    try:
                        await cb({"type": "tg_pnl", "user_id": uid, "data": pnls})
                    except Exception:
                        pass

    except Exception as e:
        logger.debug("_broadcast_tg_pnl error: %s", e)
