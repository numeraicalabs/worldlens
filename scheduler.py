"""World Lens — Background data scheduler"""
from __future__ import annotations
import json
import logging
import aiosqlite
from datetime import datetime
from typing import Optional
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from scrapers.events import fetch_all_events
from scrapers.finance import fetch_finance, get_cached
from config import settings

logger = logging.getLogger(__name__)
_scheduler: Optional[AsyncIOScheduler] = None
_ws_callbacks = []
_finance_cache = []


def register_ws_callback(cb):
    _ws_callbacks.append(cb)


def get_finance_cache():
    return _finance_cache or get_cached()


async def _poll_events():
    logger.info("Polling events...")
    try:
        events = await fetch_all_events()
        new_count = 0
        async with aiosqlite.connect(settings.db_path) as db:
            for ev in events:
                try:
                    await db.execute("""
                        INSERT OR IGNORE INTO events
                        (id, timestamp, title, summary, category, source,
                         latitude, longitude, country_code, country_name,
                         severity, impact, url, ai_impact_score, related_markets,
                         topic_vector, source_count, source_list)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                    """, (
                        ev["id"], ev["timestamp"], ev["title"], ev.get("summary", ""),
                        ev["category"], ev["source"], ev["latitude"], ev["longitude"],
                        ev.get("country_code", "XX"), ev.get("country_name", ""),
                        ev.get("severity", 5.0), ev.get("impact", "Medium"),
                        ev.get("url", ""), ev.get("ai_impact_score", 5.0),
                        json.dumps(ev.get("related_markets", [])),
                        json.dumps(ev.get("topic_vector", [])),
                        ev.get("source_count", 1),
                        json.dumps(ev.get("source_list", [ev.get("source","")]))
                    ))
                    if db.total_changes > new_count:
                        new_count += 1
                except Exception as e:
                    logger.debug("Event insert: %s", e)
            await db.commit()
            await db.execute(
                "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY timestamp DESC LIMIT ?)",
                (settings.max_events,)
            )
            await db.commit()
        if new_count > 0:
            logger.info("Added %d new events", new_count)
            for cb in _ws_callbacks:
                try:
                    await cb({"type": "events_updated", "count": new_count})
                except Exception:
                    pass
    except Exception as e:
        logger.error("Event poll error: %s", e)


async def _poll_finance():
    global _finance_cache
    logger.info("Polling finance...")
    try:
        data = await fetch_finance()
        _finance_cache = data
        async with aiosqlite.connect(settings.db_path) as db:
            for asset in data:
                await db.execute("""
                    INSERT OR REPLACE INTO finance_cache
                    (symbol, name, price, change_pct, change_abs, history, updated_at)
                    VALUES (?,?,?,?,?,?,datetime('now'))
                """, (
                    asset["symbol"], asset["name"], asset["price"],
                    asset["change_pct"], asset["change_abs"],
                    json.dumps(asset.get("history", []))
                ))
            await db.commit()
        for cb in _ws_callbacks:
            try:
                await cb({"type": "finance_updated", "data": data})
            except Exception:
                pass
    except Exception as e:
        logger.error("Finance poll error: %s", e)


def start():
    global _scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_poll_events, "interval", seconds=settings.update_interval_seconds,
                       id="events", next_run_time=datetime.now())
    _scheduler.add_job(_poll_finance, "interval", seconds=settings.finance_interval_seconds,
                       id="finance", next_run_time=datetime.now())
    _scheduler.start()
    logger.info("Scheduler started")


def stop():
    global _scheduler
    if _scheduler:
        _scheduler.shutdown()
