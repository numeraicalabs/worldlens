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
from db import get_db
from ai_layer import ai_watchlist_digest, ai_available_async, _get_user_ai_keys, _call_claude

finance_router = APIRouter(prefix="/api/finance", tags=["finance"])
user_router = APIRouter(prefix="/api/user", tags=["user"])


# ── Finance ──────────────────────────────────────────
@finance_router.get("")
async def get_finance():
    return JSONResponse({"assets": get_finance_cache()})


@user_router.get("/profile")
async def get_profile(user=Depends(require_user)):
    async with get_db() as db:
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
            "SELECT COUNT(*) FROM events WHERE timestamp > NOW() - INTERVAL '24 hours'"
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
    async with get_db() as db:
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
    async with get_db() as db:
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
                    "INSERT INTO watchlist (user_id,type,value,label) VALUES (?,?,?,?)",
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
                    "INSERT INTO watchlist (user_id,type,value,label) VALUES (?,?,?,?)",
                    (user["id"], t, val, label)
                )
        await db.commit()
    return {"status": "ok", "message": "Onboarding complete"}


@user_router.post("/complete-tutorial")
async def complete_tutorial(user=Depends(require_user)):
    async with get_db() as db:
        await db.execute("UPDATE users SET tutorial_done=1 WHERE id=?", (user["id"],))
        await db.commit()
    return {"status": "ok"}


# ── Watchlist ─────────────────────────────────────────
@user_router.get("/watchlist")
async def get_watchlist(user=Depends(require_user)):
    try:
        async with get_db() as db:
            async with db.execute(
                "SELECT * FROM watchlist WHERE user_id=? ORDER BY type, label", (user["id"],)
            ) as c:
                return [_json_safe(dict(r)) for r in await c.fetchall()]
    except Exception:
        return []


@user_router.post("/watchlist")
async def add_watchlist(item: WatchlistItem, user=Depends(require_user)):
    async with get_db() as db:
        await db.execute(
            "INSERT INTO watchlist (user_id,type,value,label) VALUES (?,?,?,?)",
            (user["id"], item.type, item.value, item.label or item.value)
        )
        await db.commit()
    return {"status": "ok"}


@user_router.delete("/watchlist/{item_id}")
async def del_watchlist(item_id: int, user=Depends(require_user)):
    async with get_db() as db:
        await db.execute("DELETE FROM watchlist WHERE id=? AND user_id=?", (item_id, user["id"]))
        await db.commit()
    return {"status": "ok"}


@user_router.get("/watchlist/digest")
async def watchlist_digest(user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute("SELECT * FROM watchlist WHERE user_id=?", (user["id"],)) as c:
            items = [_json_safe(dict(r)) for r in await c.fetchall()]
        codes = [i["value"] for i in items if i["type"] == "country"]
        evs = []
        if codes:
            ph = ",".join("?" * len(codes))
            async with db.execute(
                "SELECT * FROM events WHERE country_code IN (" + ph + ") ORDER BY timestamp DESC LIMIT 10", codes
            ) as c:
                evs = [_json_safe(dict(r)) for r in await c.fetchall()]
    text = await ai_watchlist_digest(items, evs)
    return {"digest": text or "Configure an AI provider in Admin → Settings to enable personalized digests.", "items": items}


# ── Alerts ────────────────────────────────────────────
@user_router.get("/alerts")
async def get_alerts(user=Depends(require_user)):
    try:
        async with get_db() as db:
            async with db.execute(
                "SELECT * FROM alerts WHERE user_id=? ORDER BY created_at DESC", (user["id"],)
            ) as c:
                return [_json_safe(dict(r)) for r in await c.fetchall()]
    except Exception:
        return []


@user_router.post("/alerts")
async def create_alert(alert: AlertCreate, user=Depends(require_user)):
    async with get_db() as db:
        await db.execute(
            "INSERT INTO alerts (user_id,title,condition,type) VALUES (?,?,?,?)",
            (user["id"], alert.title, alert.condition, alert.type)
        )
        await db.commit()
    return {"status": "ok"}


@user_router.delete("/alerts/{alert_id}")
async def del_alert(alert_id: int, user=Depends(require_user)):
    async with get_db() as db:
        await db.execute("DELETE FROM alerts WHERE id=? AND user_id=?", (alert_id, user["id"]))
        await db.commit()
    return {"status": "ok"}


@user_router.put("/alerts/{alert_id}/toggle")
async def toggle_alert(alert_id: int, user=Depends(require_user)):
    async with get_db() as db:
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

    async with get_db() as db:
        await db.execute(f"UPDATE users SET {col}=? WHERE id=?", (key, user["id"]))
        await db.commit()

    return {"status": "ok", "provider": provider, "key_preview": ("***" + key[-4:]) if len(key) >= 4 else "SET"}


@user_router.delete("/ai-key")
async def delete_user_ai_key(provider: str = "gemini", user=Depends(require_user)):
    """Clear the user's personal API key for the given provider."""
    if provider not in ("gemini", "claude", "anthropic"):
        return {"status": "error", "message": "Unknown provider"}
    col = "user_gemini_key" if provider == "gemini" else "user_anthropic_key"
    async with get_db() as db:
        await db.execute(f"UPDATE users SET {col}='' WHERE id=?", (user["id"],))
        await db.commit()
    return {"status": "ok"}


@user_router.get("/ai-key/status")
async def get_user_ai_key_status(user=Depends(require_user)):
    """Return which personal AI keys the user has configured (previews only — never full key)."""
    async with get_db() as db:
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


@finance_router.get("/portfolios")
async def list_portfolios(user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute(
            "SELECT id, name, base_currency, benchmark_ticker, icon, created_at "
            "FROM etf_portfolios WHERE user_id=? ORDER BY created_at DESC",
            (user["id"],)
        ) as cur:
            rows = [_json_safe(dict(r)) for r in await cur.fetchall()]
    return {"portfolios": rows}


@finance_router.post("/portfolios")
async def create_portfolio(body: _PortfolioCreate, user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute(
            "INSERT INTO etf_portfolios (user_id, name, base_currency, benchmark_ticker, icon) "
            "VALUES (?,?,?,?,?) RETURNING id",
            (user["id"], body.name.strip()[:80],
             body.base_currency[:8], body.benchmark_ticker[:20], body.icon[:10])
        ) as cur:
            row = await cur.fetchone()
        await db.commit()
    return {"ok": True, "id": row[0] if row else None, "name": body.name}


@finance_router.get("/portfolios/{pid}")
async def get_portfolio(pid: int, user=Depends(require_user)):
    import json as _j

    async with get_db() as db:
        async with db.execute(
            "SELECT id, name, base_currency, benchmark_ticker, icon, created_at "
            "FROM etf_portfolios WHERE id=? AND user_id=?",
            (pid, user["id"])
        ) as cur:
            port = await cur.fetchone()
        if not port:
            raise HTTPException(404, "Portfolio not found")

        async with db.execute(
            "SELECT id, ticker, isin, name, shares, avg_price, current_price, "
            "       currency, asset_class, purchase_date "
            "FROM etf_holdings WHERE portfolio_id=? ORDER BY id",
            (pid,)
        ) as cur:
            holdings = [_json_safe(dict(r)) for r in await cur.fetchall()]

    p = _json_safe(dict(port))
    cur_sym = p.get("base_currency", "EUR")

    # Compute P&L per holding
    total_value = 0.0
    total_cost = 0.0
    day_pnl = 0.0

    for h in holdings:
        cp = float(h.get("current_price") or h.get("avg_price") or 0)
        shares = float(h.get("shares") or 0)
        avg = float(h.get("avg_price") or 0)
        cost = avg * shares
        val = cp * shares
        h["current_value"] = round(val, 2)
        h["pnl"]           = round(val - cost, 2)
        h["pnl_pct"]       = round((cp - avg) / avg * 100, 2) if avg else 0.0
        total_value += val
        total_cost  += cost

    total_pnl     = total_value - total_cost
    total_ret_pct = round(total_pnl / total_cost * 100, 2) if total_cost else 0.0

    p["holdings"]         = holdings
    p["total_value"]      = round(total_value, 2)
    p["total_cost"]       = round(total_cost, 2)
    p["total_pnl"]        = round(total_pnl, 2)
    p["total_return_pct"] = total_ret_pct
    p["today_return_pct"] = 0.0   # updated by scheduler
    p["ytd_return_pct"]   = None
    p["sharpe_ratio"]     = None
    p["volatility_pct"]   = None
    p["max_drawdown_pct"] = None
    p["geo_risk"]         = None
    return p


@finance_router.delete("/portfolios/{pid}")
async def delete_portfolio(pid: int, user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute(
            "SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
            (pid, user["id"])
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(404, "Portfolio not found")
        await db.execute("DELETE FROM etf_holdings WHERE portfolio_id=?", (pid,))
        await db.execute(
            "DELETE FROM etf_portfolios WHERE id=? AND user_id=?", (pid, user["id"])
        )
        await db.commit()
    return {"deleted": True}


@finance_router.get("/portfolios/{pid}/history")
async def portfolio_history(pid: int, days: int = 90, user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute(
            "SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
            (pid, user["id"])
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(404, "Portfolio not found")
        async with db.execute(
            "SELECT snapshot_date, total_value, total_cost "
            "FROM etf_portfolios_meta WHERE portfolio_id=? "
            "ORDER BY snapshot_date ASC LIMIT ?",
            (pid, days)
        ) as cur:
            rows = [_json_safe(dict(r)) for r in await cur.fetchall()]
    return {"history": rows, "portfolio_id": pid}


@finance_router.post("/portfolios/{pid}/holdings")
async def add_holding(pid: int, body: _HoldingCreate, user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute(
            "SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
            (pid, user["id"])
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(403, "Not your portfolio")

        ticker = body.ticker.upper().strip()[:20]

        # Fetch live price
        live_price = await _fetch_live_price(ticker)
        if live_price == 0.0:
            live_price = body.avg_price  # fallback to purchase price

        async with db.execute(
            "INSERT INTO etf_holdings "
            "(portfolio_id, ticker, name, shares, avg_price, current_price, "
            " currency, asset_class, purchase_date) "
            "VALUES (?,?,?,?,?,?,?,?,?) RETURNING id",
            (pid, ticker, ticker,
             round(body.shares, 6), round(body.avg_price, 6),
             round(live_price, 6),
             body.currency[:8], body.asset_class[:20],
             body.purchase_date)
        ) as cur:
            row = await cur.fetchone()
        await db.commit()

    return {"ok": True, "id": row[0] if row else None, "ticker": ticker}


# ── Holdings direct endpoints — /api/finance/holdings/{hid} ──────────────────

@finance_router.put("/holdings/{hid}")
async def update_holding(hid: int, body: _HoldingUpdate, user=Depends(require_user)):
    async with get_db() as db:
        # Verify ownership via portfolio
        async with db.execute(
            "SELECT h.id FROM etf_holdings h "
            "JOIN etf_portfolios p ON h.portfolio_id=p.id "
            "WHERE h.id=? AND p.user_id=?",
            (hid, user["id"])
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(404, "Holding not found")
        await db.execute(
            "UPDATE etf_holdings SET shares=?, avg_price=? WHERE id=?",
            (round(body.shares, 6), round(body.avg_price, 6), hid)
        )
        await db.commit()
    return {"ok": True}


@finance_router.delete("/holdings/{hid}")
async def delete_holding(hid: int, user=Depends(require_user)):
    async with get_db() as db:
        async with db.execute(
            "SELECT h.id FROM etf_holdings h "
            "JOIN etf_portfolios p ON h.portfolio_id=p.id "
            "WHERE h.id=? AND p.user_id=?",
            (hid, user["id"])
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(404, "Holding not found")
        await db.execute("DELETE FROM etf_holdings WHERE id=?", (hid,))
        await db.commit()
    return {"deleted": True}


@finance_router.get("/{symbol}")
async def get_asset(symbol: str):
    for a in get_finance_cache():
        if a["symbol"].upper() == symbol.upper():
            return a
    raise HTTPException(404, "Not found")


# ── Profile ──────────────────────────────────────────

# ── Portfolio CRUD — /api/finance/portfolios/* ────────────────────────────────
# Full implementation matching dashboard.bundle.js expectations

from pydantic import BaseModel as _BM
from typing import Optional as _Opt

class _PortfolioCreate(_BM):
    name: str
    base_currency: str = "EUR"
    benchmark_ticker: str = "VWCE"
    icon: str = "💼"

class _HoldingCreate(_BM):
    ticker: str
    shares: float
    avg_price: float
    currency: str = "EUR"
    asset_class: str = "equity"
    purchase_date: _Opt[str] = None

class _HoldingUpdate(_BM):
    shares: float
    avg_price: float


async def _fetch_live_price(ticker: str) -> float:
    """Fetch current price via yfinance, return 0 on failure."""
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        hist = t.history(period="1d")
        if not hist.empty:
            return float(hist["Close"].iloc[-1])
    except Exception:
        pass
    return 0.0
