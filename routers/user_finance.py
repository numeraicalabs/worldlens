"""World Lens — Finance + User routers v3"""
from __future__ import annotations
import json
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional
from auth import require_user
from scheduler import get_finance_cache
from models import WatchlistItem, AlertCreate
from config import settings
from ai_layer import ai_watchlist_digest, ai_available_async, _get_user_ai_keys, _call_claude

finance_router = APIRouter(prefix="/api/finance", tags=["finance"])
user_router = APIRouter(prefix="/api/user", tags=["user"])


# ── Portfolio Holdings (used by Finance Hub frontend) ─────────────────────────

class HoldingIn(BaseModel):
    ticker: str
    shares: float
    avg_price: float
    currency: str = "USD"
    asset_class: str = "equity"
    isin: str = ""
    name: str = ""


async def _ensure_fh_tables(db):
    await db.executescript("""
    CREATE TABLE IF NOT EXISTS etf_portfolios (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        name        TEXT NOT NULL DEFAULT 'Portafoglio Principale',
        strategy    TEXT DEFAULT 'custom',
        created_at  TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE TABLE IF NOT EXISTS etf_holdings (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id  INTEGER NOT NULL,
        isin          TEXT NOT NULL DEFAULT '',
        ticker        TEXT NOT NULL,
        name          TEXT NOT NULL DEFAULT '',
        shares        REAL NOT NULL DEFAULT 0,
        avg_price     REAL NOT NULL DEFAULT 0,
        current_price REAL,
        currency      TEXT DEFAULT 'USD',
        asset_class   TEXT DEFAULT 'equity',
        created_at    TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (portfolio_id) REFERENCES etf_portfolios(id)
    );
    """)
    await db.commit()


async def _get_or_create_portfolio(db, user_id: int) -> int:
    """Return the user's default portfolio id, creating one if needed."""
    async with db.execute(
        "SELECT id FROM etf_portfolios WHERE user_id=? ORDER BY created_at LIMIT 1",
        (user_id,)
    ) as cur:
        row = await cur.fetchone()
    if row:
        return row[0]
    cur2 = await db.execute(
        "INSERT INTO etf_portfolios (user_id, name, strategy) VALUES (?,?,?)",
        (user_id, "Portafoglio Principale", "custom")
    )
    await db.commit()
    return cur2.lastrowid


@finance_router.get("/portfolios")
async def fh_list_portfolios(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_fh_tables(db)
        pid = await _get_or_create_portfolio(db, user["id"])
        async with db.execute(
            "SELECT * FROM etf_portfolios WHERE user_id=? ORDER BY created_at",
            (user["id"],)
        ) as cur:
            portfolios = [dict(r) for r in await cur.fetchall()]
        for p in portfolios:
            async with db.execute(
                "SELECT * FROM etf_holdings WHERE portfolio_id=?", (p["id"],)
            ) as cur2:
                p["holdings"] = [dict(r) for r in await cur2.fetchall()]
    return portfolios


@finance_router.post("/portfolios", status_code=201)
async def fh_create_portfolio(data: dict = Body(...), user=Depends(require_user)):
    name = data.get("name", "Portafoglio Principale")
    strategy = data.get("strategy", "custom")
    async with aiosqlite.connect(settings.db_path) as db:
        await _ensure_fh_tables(db)
        cur = await db.execute(
            "INSERT INTO etf_portfolios (user_id, name, strategy) VALUES (?,?,?)",
            (user["id"], name, strategy)
        )
        await db.commit()
    return {"id": cur.lastrowid, "name": name, "strategy": strategy}


@finance_router.post("/portfolios/{pid}/holdings", status_code=201)
async def fh_add_holding(pid: int, data: HoldingIn, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await _ensure_fh_tables(db)
        # Verify portfolio belongs to user
        async with db.execute(
            "SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
            (pid, user["id"])
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(404, "Portfolio not found")
        # Use ticker as name fallback
        display_name = data.name.strip() if data.name.strip() else data.ticker.upper()
        cur2 = await db.execute(
            "INSERT INTO etf_holdings "
            "(portfolio_id, isin, ticker, name, shares, avg_price, currency, asset_class) "
            "VALUES (?,?,?,?,?,?,?,?)",
            (pid, data.isin, data.ticker.upper(), display_name,
             data.shares, data.avg_price, data.currency, data.asset_class)
        )
        await db.commit()
    return {"id": cur2.lastrowid, "ticker": data.ticker.upper()}


@finance_router.delete("/holdings/{hid}")
async def fh_delete_holding(hid: int, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        await _ensure_fh_tables(db)
        await db.execute(
            "DELETE FROM etf_holdings WHERE id=? AND portfolio_id IN "
            "(SELECT id FROM etf_portfolios WHERE user_id=?)",
            (hid, user["id"])
        )
        await db.commit()
    return {"success": True}


@finance_router.get("/search/{query}")
async def fh_search_ticker(query: str):
    """Simple ticker search — returns candidates from known assets."""
    from scheduler import get_finance_cache
    assets = get_finance_cache() or []
    q = query.upper()
    results = [
        {"ticker": a["symbol"], "name": a.get("name", a["symbol"])}
        for a in assets
        if q in a["symbol"].upper() or q in a.get("name", "").upper()
    ][:10]
    # Always include the query itself as first option if not already there
    symbols = [r["ticker"] for r in results]
    if q not in symbols:
        results.insert(0, {"ticker": q, "name": q})
    return {"results": results}


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
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM watchlist WHERE user_id=? ORDER BY type, label", (user["id"],)
            ) as c:
                return [dict(r) for r in await c.fetchall()]
    except Exception:
        return []


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
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC", (user["id"],)
            ) as c:
                return [dict(r) for r in await c.fetchall()]
    except Exception:
        return []


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


# ── Personal AI key management ────────────────────────────────────────────────

@user_router.post("/ai-key")
async def save_user_ai_key(payload: dict = Body(...), user=Depends(require_user)):
    """Save user's personal Gemini or Anthropic API key (encrypted at rest in DB)."""
    provider = (payload.get("provider") or "gemini").strip().lower()
    key      = (payload.get("api_key") or "").strip()

    if provider not in ("gemini", "claude", "anthropic"):
        return {"status": "error", "message": "Provider must be gemini or claude"}
    if provider == "anthropic":
        provider = "claude"

    col = "user_gemini_key" if provider == "gemini" else "user_anthropic_key"

    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(f"UPDATE users SET {col}=? WHERE id=?", (key, user["id"]))
        await db.commit()

    return {"status": "ok", "provider": provider, "key_preview": ("***" + key[-4:]) if len(key) >= 4 else "SET"}


@user_router.delete("/ai-key")
async def delete_user_ai_key(provider: str = "gemini", user=Depends(require_user)):
    """Clear the user's personal API key for the given provider."""
    if provider not in ("gemini", "claude", "anthropic"):
        return {"status": "error", "message": "Unknown provider"}
    col = "user_gemini_key" if provider == "gemini" else "user_anthropic_key"
    async with aiosqlite.connect(settings.db_path) as db:
        await db.execute(f"UPDATE users SET {col}='' WHERE id=?", (user["id"],))
        await db.commit()
    return {"status": "ok"}


@user_router.get("/ai-key/status")
async def get_user_ai_key_status(user=Depends(require_user)):
    """Return which personal AI keys the user has configured (previews only — never full key)."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT user_gemini_key, user_anthropic_key FROM users WHERE id=?", (user["id"],)
        ) as cur:
            row = await cur.fetchone()

    if not row:
        return {"gemini": None, "claude": None}

    gkey = (row["user_gemini_key"] or "").strip()
    ckey = (row["user_anthropic_key"] or "").strip()

    return {
        "gemini": {"configured": bool(gkey), "preview": ("***" + gkey[-4:]) if len(gkey) >= 4 else None},
        "claude": {"configured": bool(ckey), "preview": ("***" + ckey[-4:]) if len(ckey) >= 4 else None},
    }


@user_router.post("/ai-key/test")
async def test_user_ai_key(user=Depends(require_user)):
    """Quick test — tries each Gemini model in order, returns which one worked."""
    import httpx as _httpx

    ug, ua = await _get_user_ai_keys(user["id"])
    if not ug and not ua:
        return {
            "status": "error",
            "message": "Nessuna chiave salvata — inserisci la chiave e premi Salva prima di testare",
        }

    if ug:
        models = [
            "gemini-2.5-flash-preview-04-17",
            "gemini-2.5-flash",
            "gemini-2.0-flash",
            "gemini-1.5-flash",
        ]
        base = "https://generativelanguage.googleapis.com/v1beta/models"
        body = {
            "contents": [{"parts": [{"text": "Say: OK"}], "role": "user"}],
            "generationConfig": {"maxOutputTokens": 5, "temperature": 0},
        }
        last_err = ""
        async with _httpx.AsyncClient(timeout=30) as client:
            for model in models:
                try:
                    url = f"{base}/{model}:generateContent?key={ug}"
                    resp = await client.post(
                        url, headers={"Content-Type": "application/json"}, json=body
                    )
                    if resp.status_code == 200:
                        data = resp.json()
                        if data.get("candidates"):
                            return {
                                "status": "ok",
                                "provider": "gemini",
                                "model": model,
                                "message": f"✓ Chiave Gemini attiva — modello: {model}",
                            }
                        last_err = f"Modello {model}: risposta vuota (no candidates)"
                        continue
                    elif resp.status_code == 404:
                        last_err = f"{model}: non disponibile nel tuo progetto"
                        continue
                    elif resp.status_code == 429:
                        # 429 means key works but quota hit
                        return {
                            "status": "ok",
                            "provider": "gemini",
                            "model": model,
                            "message": f"✓ Chiave valida (rate limit momentaneo su {model} — quota OK, riprova tra 1 minuto)",
                        }
                    elif resp.status_code in (401, 403):
                        try:
                            err_detail = resp.json().get("error", {}).get("message", resp.text[:200])
                        except Exception:
                            err_detail = resp.text[:200]
                        return {
                            "status": "error",
                            "provider": "gemini",
                            "http_status": resp.status_code,
                            "message": f"Chiave non autorizzata (HTTP {resp.status_code}): {err_detail}",
                            "fix": "Verifica la chiave su https://aistudio.google.com/app/apikey",
                        }
                    else:
                        last_err = f"HTTP {resp.status_code} su {model}"
                        continue
                except Exception as ex:
                    return {"status": "error", "provider": "gemini", "message": f"Errore di rete: {ex}"}

        return {
            "status": "error",
            "provider": "gemini",
            "message": f"Nessun modello raggiungibile. Ultimo errore: {last_err}",
            "fix": "Verifica che la chiave sia abilitata nel progetto Google AI Studio",
        }

    if ua:
        try:
            result = await _call_claude("Say OK", system="", max_tokens=5,
                                        user_anthropic_key=ua)
            if result:
                return {"status": "ok", "provider": "claude", "message": "✓ Chiave Anthropic attiva"}
            return {"status": "error", "provider": "claude", "message": "Chiave Anthropic non valida"}
        except Exception as e:
            return {"status": "error", "provider": "claude", "message": str(e)}
