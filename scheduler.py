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
                    topic_vector, source_count, source_list, sent_credibility)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
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

            # Trim to max_events most recent
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
