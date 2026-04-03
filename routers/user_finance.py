"""World Lens — Finance + User routers v3"""
from __future__ import annotations
import json
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import JSONResponse
from auth import require_user
from scheduler import get_finance_cache
from models import WatchlistItem, AlertCreate
from config import settings
from ai_layer import ai_watchlist_digest

finance_router = APIRouter(prefix="/api/finance", tags=["finance"])
user_router = APIRouter(prefix="/api/user", tags=["user"])


# ── Finance ──────────────────────────────────────────
@finance_router.get("")
async def get_finance():
    return JSONResponse({"assets": get_finance_cache()})


@finance_router.get("/{symbol}")
async def get_asset(symbol: str):
    for a in get_finance_cache():
        if a["symbol"].upper() == symbol.upper():
            return a
    raise HTTPException(404, "Not found")


# ── Profile ──────────────────────────────────────────
@user_router.get("/profile")
async def get_profile(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id,email,username,avatar_color,bio,timezone,notifications_enabled,"
            "onboarding_done,tutorial_done,interests,regions,market_prefs,experience_level,"
            "severity_threshold,affinity_vector,"
            "created_at,last_login FROM users WHERE id=?", (user["id"],)
        ) as c:
            row = await c.fetchone()
        if not row:
            raise HTTPException(404, "User not found")
        u = dict(row)
        # parse JSON fields
        for f in ("interests","regions","market_prefs"):
            try: u[f] = json.loads(u[f] or "[]")
            except Exception: u[f] = []
        async with db.execute("SELECT COUNT(*) FROM watchlist WHERE user_id=?", (user["id"],)) as c:
            u["watchlist_count"] = (await c.fetchone())[0]
        async with db.execute("SELECT COUNT(*) FROM alerts WHERE user_id=? AND active=1", (user["id"],)) as c:
            u["alert_count"] = (await c.fetchone())[0]
        async with db.execute(
            "SELECT COUNT(*) FROM events WHERE datetime(timestamp) > datetime('now','-24 hours')"
        ) as c:
            u["events_today"] = (await c.fetchone())[0]
    return u


@user_router.put("/profile")
async def update_profile(payload: dict = Body(...), user=Depends(require_user)):
    allowed = {"username","bio","timezone","avatar_color","notifications_enabled",
               "onboarding_done","tutorial_done","interests","regions","market_prefs",
               "experience_level","severity_threshold"}
    updates = {}
    for k, v in payload.items():
        if k not in allowed:
            continue
        if k in ("interests","regions","market_prefs") and isinstance(v, list):
            updates[k] = json.dumps(v)
        else:
            updates[k] = v
    if not updates:
        return {"status": "no changes"}
    sets = ", ".join(k + "=?" for k in updates)
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE users SET " + sets + " WHERE id=?",
            list(updates.values()) + [user["id"]]
        )
        await db.commit()
    return {"status": "ok"}


@user_router.post("/complete-onboarding")
async def complete_onboarding(payload: dict = Body(...), user=Depends(require_user)):
    """Save onboarding preferences and mark onboarding complete."""
    interests = payload.get("interests", [])
    regions = payload.get("regions", [])
    market_prefs = payload.get("market_prefs", [])
    experience = payload.get("experience_level", "beginner")
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE users SET onboarding_done=1, interests=?, regions=?, market_prefs=?, experience_level=? WHERE id=?",
            (json.dumps(interests), json.dumps(regions), json.dumps(market_prefs), experience, user["id"])
        )
        await db.commit()
        # Auto-add watchlist items for selected interests/regions
        for region in regions[:5]:
            REGION_CODES = {
                "Europe": [("country","DE","Germany"),("country","FR","France"),("country","GB","UK")],
                "USA": [("country","US","United States")],
                "Middle East": [("country","SA","Saudi Arabia"),("country","IR","Iran"),("country","IL","Israel")],
                "Asia": [("country","CN","China"),("country","JP","Japan"),("country","IN","India")],
                "Africa": [("country","NG","Nigeria"),("country","ZA","South Africa")],
                "Latin America": [("country","BR","Brazil"),("country","MX","Mexico")],
            }
            for t, val, label in REGION_CODES.get(region, []):
                await db.execute(
                    "INSERT OR IGNORE INTO watchlist (user_id,type,value,label) VALUES (?,?,?,?)",
                    (user["id"], t, val, label)
                )
        for market in market_prefs:
            MARKET_ASSETS = {
                "Stocks": [("asset","^GSPC","S&P 500"),("asset","^IXIC","Nasdaq")],
                "Forex": [("asset","EURUSD=X","EUR/USD"),("asset","JPY=X","USD/JPY")],
                "Commodities": [("asset","GC=F","Gold"),("asset","CL=F","Crude Oil")],
                "Crypto": [("asset","BTC-USD","Bitcoin"),("asset","ETH-USD","Ethereum")],
                "Bonds": [("asset","^TNX","US 10Y Yield")],
            }
            for t, val, label in MARKET_ASSETS.get(market, []):
                await db.execute(
                    "INSERT OR IGNORE INTO watchlist (user_id,type,value,label) VALUES (?,?,?,?)",
                    (user["id"], t, val, label)
                )
        await db.commit()
    return {"status": "ok", "message": "Onboarding complete"}


@user_router.post("/complete-tutorial")
async def complete_tutorial(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("UPDATE users SET tutorial_done=1 WHERE id=?", (user["id"],))
        await db.commit()
    return {"status": "ok"}


# ── Watchlist ─────────────────────────────────────────
@user_router.get("/watchlist")
async def get_watchlist(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM watchlist WHERE user_id=? ORDER BY type, label", (user["id"],)
        ) as c:
            return [dict(r) for r in await c.fetchall()]


@user_router.post("/watchlist")
async def add_watchlist(item: WatchlistItem, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT OR IGNORE INTO watchlist (user_id,type,value,label) VALUES (?,?,?,?)",
            (user["id"], item.type, item.value, item.label or item.value)
        )
        await db.commit()
    return {"status": "ok"}


@user_router.delete("/watchlist/{item_id}")
async def del_watchlist(item_id: int, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("DELETE FROM watchlist WHERE id=? AND user_id=?", (item_id, user["id"]))
        await db.commit()
    return {"status": "ok"}


@user_router.get("/watchlist/digest")
async def watchlist_digest(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT * FROM watchlist WHERE user_id=?", (user["id"],)) as c:
            items = [dict(r) for r in await c.fetchall()]
        codes = [i["value"] for i in items if i["type"] == "country"]
        evs = []
        if codes:
            ph = ",".join("?" * len(codes))
            async with db.execute(
                "SELECT * FROM events WHERE country_code IN (" + ph + ") ORDER BY timestamp DESC LIMIT 10", codes
            ) as c:
                evs = [dict(r) for r in await c.fetchall()]
    text = await ai_watchlist_digest(items, evs)
    return {"digest": text or "Configure an AI provider in Admin → Settings to enable personalized digests.", "items": items}


# ── Alerts ────────────────────────────────────────────
@user_router.get("/alerts")
async def get_alerts(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC", (user["id"],)
        ) as c:
            return [dict(r) for r in await c.fetchall()]


@user_router.post("/alerts")
async def create_alert(alert: AlertCreate, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "INSERT INTO alerts (user_id,title,condition,type) VALUES (?,?,?,?)",
            (user["id"], alert.title, alert.condition, alert.type)
        )
        await db.commit()
    return {"status": "ok"}


@user_router.delete("/alerts/{alert_id}")
async def del_alert(alert_id: int, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute("DELETE FROM alerts WHERE id=? AND user_id=?", (alert_id, user["id"]))
        await db.commit()
    return {"status": "ok"}


@user_router.put("/alerts/{alert_id}/toggle")
async def toggle_alert(alert_id: int, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(
            "UPDATE alerts SET active=CASE WHEN active=1 THEN 0 ELSE 1 END WHERE id=? AND user_id=?",
            (alert_id, user["id"])
        )
        await db.commit()
    return {"status": "ok"}
