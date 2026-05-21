"""
WorldLens Finance Hub
======================
Unified router for portfolio tracking, P&L calculation,
multi-currency support, and geopolitical risk scoring.

Endpoints:
  GET  /api/finance/portfolios              → list all user portfolios with P&L
  POST /api/finance/portfolios              → create portfolio
  PUT  /api/finance/portfolios/{id}         → update portfolio
  DELETE /api/finance/portfolios/{id}       → delete portfolio
  GET  /api/finance/portfolios/{id}         → single portfolio detail + full P&L
  POST /api/finance/portfolios/{id}/holdings → add holding
  PUT  /api/finance/holdings/{hid}          → update holding
  DELETE /api/finance/holdings/{hid}        → delete holding
  GET  /api/finance/portfolios/{id}/history → daily P&L history
  POST /api/finance/portfolios/{id}/snapshot → force daily snapshot
  GET  /api/finance/fx                      → FX rates
  GET  /api/finance/quote/{ticker}          → live quote with metadata
  GET  /api/finance/search/{query}          → search tickers
  GET  /api/finance/portfolios/{id}/geo-risk → geopolitical risk score
"""
from __future__ import annotations
import asyncio
import json
import logging
import math
from datetime import date, datetime, timedelta
from typing import Dict, List, Optional, Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field

from auth import require_user
from config import settings
from db import get_db

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/finance", tags=["finance"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class PortfolioCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    strategy: str = "custom"
    base_currency: str = "EUR"
    benchmark_ticker: str = "VWCE"
    description: str = ""
    color: str = "#7C3AED"
    icon: str = "💼"

class HoldingCreate(BaseModel):
    ticker: str = Field(..., min_length=1, max_length=20)
    name: str = ""
    shares: float = Field(..., gt=0)
    avg_price: float = Field(..., gt=0)
    currency: str = "USD"   # native currency of the asset
    asset_class: str = "equity"  # equity | etf | bond | commodity | crypto
    purchase_date: Optional[str] = None

class HoldingUpdate(BaseModel):
    shares: Optional[float] = None
    avg_price: Optional[float] = None
    name: Optional[str] = None

class PortfolioUpdate(BaseModel):
    name: Optional[str] = None
    strategy: Optional[str] = None
    base_currency: Optional[str] = None
    benchmark_ticker: Optional[str] = None
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None


# ── DB helpers ────────────────────────────────────────────────────────────────

def _json_safe(obj):
    """Convert datetime objects to ISO strings."""
    import datetime as _dt
    if isinstance(obj, dict): return {k: _json_safe(v) for k, v in obj.items()}
    if isinstance(obj, list): return [_json_safe(i) for i in obj]
    if isinstance(obj, (_dt.datetime, _dt.date)): return obj.isoformat()
    return obj


async def _db(sql: str, params=(), fetchall=False, fetchone=False, lastrowid=False):
    """Universal DB helper — routes to Supabase via get_db()."""
    try:
        async with get_db() as db:
            if fetchall:
                async with db.execute(sql, tuple(params)) as c:
                    return [_json_safe(dict(r)) for r in await c.fetchall()]
            if fetchone:
                async with db.execute(sql, tuple(params)) as c:
                    r = await c.fetchone()
                    return _json_safe(dict(r)) if r else None
            if lastrowid:
                # Use RETURNING id for PostgreSQL compatibility
                ret_sql = sql
                if 'RETURNING' not in sql.upper():
                    ret_sql = sql + ' RETURNING id'
                async with db.execute(ret_sql, tuple(params)) as c:
                    row = await c.fetchone()
                    lid = row[0] if row else None
                await db.commit()
                return lid
            await db.execute(sql, tuple(params))
            await db.commit()
    except Exception as e:
        logger.debug("_db error: %s | sql: %s", e, sql[:80])
        if fetchall: return []
        if fetchone: return None
        if lastrowid: return None
        return None


# ── FX rates ─────────────────────────────────────────────────────────────────

_FX_CACHE: Dict[str, float] = {
    "EUR/USD": 1.085, "USD/EUR": 0.921,
    "GBP/USD": 1.268, "USD/GBP": 0.789,
    "JPY/USD": 0.0066, "USD/JPY": 151.2,
    "CHF/USD": 1.115, "USD/CHF": 0.897,
    "AUD/USD": 0.655, "CAD/USD": 0.730,
}
_FX_UPDATED = datetime.min


async def get_fx_rates() -> Dict[str, float]:
    """Get FX rates from cache/DB, refresh if stale."""
    global _FX_CACHE, _FX_UPDATED

    if (datetime.now() - _FX_UPDATED).seconds < 3600:
        return _FX_CACHE

    # Try finance_cache (yfinance populates EURUSD=X etc)
    try:
        rows = await _db(
            "SELECT symbol, price FROM finance_cache WHERE symbol LIKE '%USD%' OR symbol='EURUSD=X'",
            fetchall=True
        )
        if rows:
            for r in rows:
                sym = (r.get("symbol") or "")
                price = float(r.get("price") or 0)
                if not price:
                    continue
                if sym == "EURUSD=X":
                    _FX_CACHE["EUR/USD"] = price
                    _FX_CACHE["USD/EUR"] = 1 / price
                elif "USD" in sym:
                    pair = sym.replace("=X","").replace("USD","")
                    _FX_CACHE[f"{pair}/USD"] = price
                    if price > 0:
                        _FX_CACHE[f"USD/{pair}"] = 1 / price
            _FX_UPDATED = datetime.now()
    except Exception as e:
        logger.debug("get_fx_rates: %s", e)

    return _FX_CACHE


async def convert_to_eur(amount: float, from_currency: str) -> float:
    """Convert amount from any currency to EUR."""
    if from_currency == "EUR":
        return amount
    fx = await get_fx_rates()
    if from_currency == "USD":
        eur_per_usd = fx.get("USD/EUR", 1 / fx.get("EUR/USD", 1.085))
        return amount * eur_per_usd
    if from_currency == "GBP":
        gbp_usd = fx.get("GBP/USD", 1.268)
        eur_per_usd = fx.get("USD/EUR", 0.921)
        return amount * gbp_usd * eur_per_usd
    # Default: assume 1:1 as fallback
    return amount


# ── Price fetching ────────────────────────────────────────────────────────────

async def get_price(ticker: str) -> Optional[Dict]:
    """
    Get current price from finance_cache.
    Returns {price, change_pct, currency, name} or None.
    """
    row = await _db(
        "SELECT symbol, name, price, change_pct, change_abs, category, history FROM finance_cache WHERE symbol=?",
        (ticker.upper(),), fetchone=True
    )
    if row and row.get("price"):
        return {
            "ticker": ticker.upper(),
            "name": row.get("name", ticker),
            "price": float(row["price"]),
            "change_pct": float(row.get("change_pct") or 0),
            "change_abs": float(row.get("change_abs") or 0),
            "currency": "USD",  # yfinance returns in USD by default
            "category": row.get("category", "equity"),
            "history": json.loads(row.get("history") or "[]"),
        }

    # Try yfinance directly as fallback
    try:
        import yfinance as yf
        t = yf.Ticker(ticker)
        info = t.fast_info
        price = getattr(info, "last_price", None) or getattr(info, "previous_close", None)
        if price:
            return {"ticker": ticker.upper(), "name": ticker, "price": float(price),
                    "change_pct": 0, "change_abs": 0, "currency": "USD", "category": "equity", "history": []}
    except Exception:
        pass
    return None


# ── P&L calculation engine ────────────────────────────────────────────────────

async def calculate_portfolio_pnl(portfolio_id: int, base_currency: str = "EUR") -> Dict:
    """
    Full P&L calculation for a portfolio.
    Returns enriched portfolio dict with all metrics.
    """
    holdings = await _db(
        "SELECT * FROM etf_holdings WHERE portfolio_id=?",
        (portfolio_id,), fetchall=True
    )

    total_value = 0.0
    total_cost  = 0.0
    enriched_holdings = []

    for h in holdings:
        ticker = h.get("ticker", "")
        shares = float(h.get("shares") or 0)
        avg_price = float(h.get("avg_price") or 0)
        native_currency = h.get("currency", "USD")

        # Get current price
        price_data = await get_price(ticker)
        current_price_usd = float(price_data["price"]) if price_data else avg_price

        # Convert to base currency (EUR)
        current_price_base = await convert_to_eur(current_price_usd, "USD")
        avg_price_base     = await convert_to_eur(avg_price, native_currency)

        current_value = shares * current_price_base
        cost_basis    = shares * avg_price_base
        gain_loss     = current_value - cost_basis
        return_pct    = (gain_loss / cost_basis * 100) if cost_basis > 0 else 0

        total_value += current_value
        total_cost  += cost_basis

        enriched_holdings.append({
            **h,
            "current_price_usd": round(current_price_usd, 4),
            "current_price_base": round(current_price_base, 4),
            "current_value": round(current_value, 2),
            "cost_basis": round(cost_basis, 2),
            "gain_loss": round(gain_loss, 2),
            "return_pct": round(return_pct, 2),
            "change_pct_today": price_data["change_pct"] if price_data else 0,
            "weight_pct": 0,  # filled below
            "history": price_data["history"] if price_data else [],
        })

    # Compute weights
    for h in enriched_holdings:
        h["weight_pct"] = round(h["current_value"] / total_value * 100, 1) if total_value > 0 else 0

    # Sort by weight desc
    enriched_holdings.sort(key=lambda x: x["weight_pct"], reverse=True)

    total_return     = total_value - total_cost
    total_return_pct = (total_return / total_cost * 100) if total_cost > 0 else 0
    today_return_pct = sum(
        h["change_pct_today"] * h["weight_pct"] / 100 for h in enriched_holdings
    )

    # Historical metrics from snapshots
    snaps = await _db(
        "SELECT * FROM portfolio_snapshots WHERE portfolio_id=? ORDER BY snap_date DESC LIMIT 252",
        (portfolio_id,), fetchall=True
    )
    metrics = _compute_historical_metrics(snaps, total_value)

    return {
        "portfolio_id": portfolio_id,
        "holdings": enriched_holdings,
        "total_value": round(total_value, 2),
        "total_cost": round(total_cost, 2),
        "total_return": round(total_return, 2),
        "total_return_pct": round(total_return_pct, 2),
        "today_return_pct": round(today_return_pct, 2),
        "currency": base_currency,
        "num_holdings": len(holdings),
        **metrics,
    }


def _compute_historical_metrics(snaps: List[Dict], current_value: float) -> Dict:
    """Compute Sharpe, volatility, max drawdown from snapshot history."""
    if len(snaps) < 5:
        return {
            "sharpe_ratio": None,
            "volatility_pct": None,
            "max_drawdown_pct": None,
            "best_day_pct": None,
            "worst_day_pct": None,
            "ytd_return_pct": None,
        }

    daily_returns = []
    peak = 0.0
    max_dd = 0.0
    values = [float(s["total_value"]) for s in reversed(snaps)]  # oldest first

    for i in range(1, len(values)):
        if values[i-1] > 0:
            r = (values[i] - values[i-1]) / values[i-1] * 100
            daily_returns.append(r)
        peak = max(peak, values[i-1])
        if peak > 0:
            dd = (peak - values[i]) / peak * 100
            max_dd = max(max_dd, dd)

    if not daily_returns:
        return {"sharpe_ratio": None, "volatility_pct": None,
                "max_drawdown_pct": None, "best_day_pct": None,
                "worst_day_pct": None, "ytd_return_pct": None}

    avg_r = sum(daily_returns) / len(daily_returns)
    std_r = math.sqrt(sum((r - avg_r)**2 for r in daily_returns) / len(daily_returns)) if len(daily_returns) > 1 else 0
    vol   = std_r * math.sqrt(252)
    sharpe = (avg_r * 252) / vol if vol > 0 else None

    # YTD: compare to first snapshot of current year
    ytd = None
    year_start = f"{date.today().year}-01-01"
    ytd_snaps = [s for s in snaps if s["snap_date"] >= year_start]
    if ytd_snaps and values:
        ytd_start_val = float(ytd_snaps[-1]["total_value"]) if ytd_snaps else values[0]
        if ytd_start_val > 0:
            ytd = (current_value - ytd_start_val) / ytd_start_val * 100

    return {
        "sharpe_ratio": round(sharpe, 2) if sharpe else None,
        "volatility_pct": round(vol, 2),
        "max_drawdown_pct": round(-max_dd, 2),
        "best_day_pct": round(max(daily_returns), 2),
        "worst_day_pct": round(min(daily_returns), 2),
        "ytd_return_pct": round(ytd, 2) if ytd else None,
    }


# ── Geopolitical risk scoring ─────────────────────────────────────────────────

async def compute_geo_risk_score(portfolio_id: int) -> Dict:
    """
    Compute geopolitical exposure for a portfolio by traversing the KG.
    Maps each holding → KG node → connected geo nodes → active events.
    """
    holdings = await _db(
        "SELECT ticker, name, weight_pct FROM etf_holdings WHERE portfolio_id=? LIMIT 10",
        (portfolio_id,), fetchall=True
    )
    # Get weights dynamically if not stored
    pnl = await calculate_portfolio_pnl(portfolio_id)
    weight_map = {h["ticker"]: h["weight_pct"] for h in pnl["holdings"]}

    # KG node lookup for each ticker
    from supabase_client import get_pool
    pool = await get_pool()

    risks = []
    total_weighted_risk = 0.0

    for h in holdings:
        ticker = h.get("ticker", "")
        weight = weight_map.get(ticker, float(h.get("weight_pct") or 10))

        # Find KG node for this ticker
        node_risk = 5.0  # default
        top_events = []
        try:
            if pool:
                async with pool.acquire() as conn:
                    node = await conn.fetchrow(
                        "SELECT id, label FROM kg_nodes WHERE LOWER(label)=LOWER($1) "
                        "OR LOWER(label) LIKE LOWER($2) LIMIT 1",
                        ticker, f"%{ticker}%"
                    )
                    if node:
                        # Get geo connections
                        geo_nodes = await conn.fetch(
                            """SELECT n2.label, n2.type
                               FROM kg_edges e
                               JOIN kg_nodes n2 ON n2.id = e.tgt_id
                               WHERE e.src_id=$1 AND n2.type='geo'
                               LIMIT 5""",
                            node["id"]
                        )
                        geo_labels = [r["label"] for r in geo_nodes]

                        # Look for active events in those geos
                        if geo_labels:
                            for geo in geo_labels[:3]:
                                evs = await _db(
                                    "SELECT title, severity FROM events "
                                    "WHERE country_name LIKE ? "
                                    "AND timestamp > NOW() - INTERVAL '72 hours' "
                                    "ORDER BY severity DESC LIMIT 2",
                                    (f"%{geo}%",), fetchall=True
                                ) or []
                                if evs:
                                    node_risk = max(node_risk, float(evs[0].get("severity", 5)))
                                    top_events.extend(evs)
        except Exception as e:
            logger.debug("geo_risk %s: %s", ticker, e)

        weighted = node_risk * (weight / 100)
        total_weighted_risk += weighted
        risks.append({
            "ticker": ticker,
            "weight_pct": weight,
            "geo_risk": round(node_risk, 1),
            "top_events": top_events[:2],
        })

    # Normalize to 0-10
    geo_score = min(10, max(0, total_weighted_risk))

    return {
        "geo_risk_score": round(geo_score, 2),
        "level": "critical" if geo_score >= 8 else "elevated" if geo_score >= 6 else "moderate" if geo_score >= 4 else "low",
        "holdings_risk": risks,
        "interpretation": _geo_risk_text(geo_score, risks),
    }


def _geo_risk_text(score: float, risks: List[Dict]) -> str:
    high = [r for r in risks if r["geo_risk"] >= 7]
    if score >= 7:
        tickers = ", ".join(r["ticker"] for r in high[:3])
        return f"Esposizione geopolitica elevata ({score:.1f}/10). Asset più esposti: {tickers}."
    elif score >= 5:
        return f"Esposizione geopolitica moderata ({score:.1f}/10). Monitora gli sviluppi globali."
    else:
        return f"Esposizione geopolitica contenuta ({score:.1f}/10). Portfolio ben diversificato."


# ── Daily snapshot ────────────────────────────────────────────────────────────

async def save_daily_snapshot(portfolio_id: int) -> bool:
    """Save today's portfolio snapshot for historical tracking."""
    today = date.today().isoformat()

    pnl = await calculate_portfolio_pnl(portfolio_id)
    geo = await compute_geo_risk_score(portfolio_id)

    try:
        await _db(
            """INSERT INTO portfolio_snapshots
               (portfolio_id, snap_date, total_value, total_cost, total_return_pct,
                day_return_pct, sharpe_ratio, volatility_pct, max_drawdown_pct,
                geo_risk_score, currency)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            (portfolio_id, today,
             pnl["total_value"], pnl["total_cost"], pnl["total_return_pct"],
             pnl["today_return_pct"], pnl.get("sharpe_ratio"),
             pnl.get("volatility_pct"), pnl.get("max_drawdown_pct"),
             geo["geo_risk_score"], pnl["currency"])
        )
        return True
    except Exception as e:
        logger.warning("save_daily_snapshot portfolio %d: %s", portfolio_id, e)
        return False


# ── API endpoints ─────────────────────────────────────────────────────────────

@router.get("/portfolios")
async def list_portfolios(user=Depends(require_user)):
    """List all portfolios with summary P&L."""
    portfolios = await _db(
        """SELECT p.*, m.base_currency, m.benchmark_ticker,
                  m.description, m.color, m.icon
           FROM etf_portfolios p
           LEFT JOIN etf_portfolios_meta m ON m.portfolio_id = p.id
           WHERE p.user_id=? ORDER BY p.created_at""",
        (user["id"],), fetchall=True
    )

    result = []
    for p in portfolios:
        pid = p["id"]
        currency = p.get("base_currency") or "EUR"
        # Ensure icon/color have defaults if meta row is missing
        p_safe = dict(p)
        p_safe.setdefault("icon",  "💼")
        p_safe.setdefault("color", "#7C3AED")
        p_safe.setdefault("base_currency", "EUR")
        try:
            pnl = await calculate_portfolio_pnl(pid, currency)
            result.append({
                **p_safe,
                "total_value":      pnl["total_value"],
                "total_return_pct": pnl["total_return_pct"],
                "today_return_pct": pnl["today_return_pct"],
                "num_holdings":     pnl["num_holdings"],
                "ytd_return_pct":   pnl.get("ytd_return_pct"),
            })
        except Exception as e:
            logger.debug("list_portfolios pnl %d: %s", pid, e)
            result.append({**p_safe, "total_value": 0, "total_return_pct": 0,
                            "today_return_pct": 0, "num_holdings": 0})

    # Return both formats for compatibility
    return result  # JS handles both array and {portfolios:[...]}


@router.post("/portfolios", status_code=201)
async def create_portfolio(data: PortfolioCreate, user=Depends(require_user)):
    """Create portfolio + meta in a single transaction via direct aiosqlite."""
    try:
        async with get_db() as db:
            # Insert portfolio
            async with db.execute(
                "INSERT INTO etf_portfolios (user_id, name, strategy) VALUES (?,?,?) RETURNING id",
                (user["id"], data.name, data.strategy or "custom")
            ) as cur:
                row = await cur.fetchone()
                pid = row[0] if row else None
            if not pid:
                raise HTTPException(500, "Portfolio insert failed")
            # Insert meta
            await db.execute(
                """INSERT INTO etf_portfolios_meta
                   (portfolio_id, base_currency, benchmark_ticker, description, color, icon)
                   VALUES (?,?,?,?,?,?)
                   ON CONFLICT(portfolio_id) DO UPDATE SET
                   base_currency=EXCLUDED.base_currency,
                   benchmark_ticker=EXCLUDED.benchmark_ticker,
                   icon=EXCLUDED.icon""",
                (pid, data.base_currency or "EUR", data.benchmark_ticker or "VWCE",
                 data.description or "", data.color or "#7C3AED", data.icon or "💼")
            )
            await db.commit()
        logger.info("Portfolio created: id=%d user=%d name=%s", pid, user["id"], data.name)
        return {"id": pid, "name": data.name, "strategy": data.strategy,
                "base_currency": data.base_currency, "color": data.color, "icon": data.icon}
    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        logger.error("create_portfolio error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"Errore creazione portafoglio: {exc}")


@router.put("/portfolios/{pid}")
async def update_portfolio(pid: int, data: PortfolioUpdate, user=Depends(require_user)):
    p = await _db("SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
                  (pid, user["id"]), fetchone=True)
    if not p:
        raise HTTPException(404, "Portfolio not found")

    if data.name:
        await _db("UPDATE etf_portfolios SET name=? WHERE id=?", (data.name, pid))
    if any([data.base_currency, data.benchmark_ticker, data.description, data.color, data.icon]):
        await _db(
            """INSERT INTO etf_portfolios_meta
               (portfolio_id, base_currency, benchmark_ticker, description, color, icon)
               VALUES (?,?,?,?,?,?)
               ON CONFLICT(portfolio_id) DO UPDATE SET
               base_currency=COALESCE(excluded.base_currency, base_currency),
               benchmark_ticker=COALESCE(excluded.benchmark_ticker, benchmark_ticker),
               description=COALESCE(excluded.description, description),
               color=COALESCE(excluded.color, color),
               icon=COALESCE(excluded.icon, icon)""",
            (pid, data.base_currency or "EUR", data.benchmark_ticker or "VWCE",
             data.description or "", data.color or "#7C3AED", data.icon or "💼")
        )
    return {"ok": True}


@router.delete("/portfolios/{pid}")
async def delete_portfolio(pid: int, user=Depends(require_user)):
    p = await _db("SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
                  (pid, user["id"]), fetchone=True)
    if not p:
        raise HTTPException(404, "Portfolio not found")
    await _db("DELETE FROM etf_holdings WHERE portfolio_id=?", (pid,))
    await _db("DELETE FROM portfolio_snapshots WHERE portfolio_id=?", (pid,))
    await _db("DELETE FROM etf_portfolios_meta WHERE portfolio_id=?", (pid,))
    await _db("DELETE FROM etf_portfolios WHERE id=?", (pid,))
    return {"ok": True, "deleted": pid}


@router.get("/portfolios/{pid}")
async def get_portfolio(pid: int, user=Depends(require_user)):
    """Full portfolio detail with complete P&L breakdown."""
    p = await _db(
        """SELECT p.*, m.base_currency, m.benchmark_ticker,
                  m.description, m.color, m.icon
           FROM etf_portfolios p
           LEFT JOIN etf_portfolios_meta m ON m.portfolio_id = p.id
           WHERE p.id=? AND p.user_id=?""",
        (pid, user["id"]), fetchone=True
    )
    if not p:
        raise HTTPException(404, "Portfolio not found")

    currency = p.get("base_currency") or "EUR"
    pnl = await calculate_portfolio_pnl(pid, currency)
    geo = await compute_geo_risk_score(pid)

    return {**p, **pnl, "geo_risk": geo}


@router.post("/portfolios/{pid}/holdings", status_code=201)
async def add_holding(pid: int, data: HoldingCreate, user=Depends(require_user)):
    p = await _db("SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
                  (pid, user["id"]), fetchone=True)
    if not p:
        raise HTTPException(404, "Portfolio not found")

    # Auto-fill name from finance_cache if not provided
    name = data.name or ""
    if not name:
        fc = await _db("SELECT name FROM finance_cache WHERE symbol=?",
                       (data.ticker.upper(),), fetchone=True)
        name = (fc.get("name") if fc else None) or data.ticker.upper()

    try:
        async with get_db() as db:
            async with db.execute(
                """INSERT INTO etf_holdings
                   (portfolio_id, isin, ticker, name, shares, avg_price,
                    currency, asset_class, purchase_date)
                   VALUES (?,?,?,?,?,?,?,?,?) RETURNING id""",
                (pid, "", data.ticker.upper(), name, float(data.shares),
                 float(data.avg_price), data.currency or "USD",
                 data.asset_class or "equity",
                 data.purchase_date or None)
            ) as cur:
                row = await cur.fetchone()
                hid = row[0] if row else None
            await db.commit()

        if not hid:
            raise HTTPException(500, "Insert failed")

        return {"id": hid, "ticker": data.ticker.upper(), "shares": data.shares,
                "avg_price": data.avg_price, "name": name}

    except HTTPException:
        raise
    except Exception as exc:
        import traceback
        logger.error("add_holding error: %s\n%s", exc, traceback.format_exc())
        raise HTTPException(500, f"Errore inserimento posizione: {exc}")


@router.put("/holdings/{hid}")
async def update_holding(hid: int, data: HoldingUpdate, user=Depends(require_user)):
    # Verify ownership
    h = await _db(
        """SELECT h.id FROM etf_holdings h
           JOIN etf_portfolios p ON p.id=h.portfolio_id
           WHERE h.id=? AND p.user_id=?""",
        (hid, user["id"]), fetchone=True
    )
    if not h:
        raise HTTPException(404, "Holding not found")
    if data.shares is not None:
        await _db("UPDATE etf_holdings SET shares=? WHERE id=?", (data.shares, hid))
    if data.avg_price is not None:
        await _db("UPDATE etf_holdings SET avg_price=? WHERE id=?", (data.avg_price, hid))
    if data.name is not None:
        await _db("UPDATE etf_holdings SET name=? WHERE id=?", (data.name, hid))
    return {"ok": True}


@router.delete("/holdings/{hid}")
async def delete_holding(hid: int, user=Depends(require_user)):
    h = await _db(
        """SELECT h.id FROM etf_holdings h
           JOIN etf_portfolios p ON p.id=h.portfolio_id
           WHERE h.id=? AND p.user_id=?""",
        (hid, user["id"]), fetchone=True
    )
    if not h:
        raise HTTPException(404, "Holding not found")
    await _db("DELETE FROM holding_prices WHERE holding_id=?", (hid,))
    await _db("DELETE FROM etf_holdings WHERE id=?", (hid,))
    return {"ok": True, "deleted": hid}


@router.get("/portfolios/{pid}/history")
async def get_portfolio_history(pid: int, days: int = 90, user=Depends(require_user)):
    p = await _db("SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
                  (pid, user["id"]), fetchone=True)
    if not p:
        raise HTTPException(404, "Portfolio not found")

    snaps = await _db(
        """SELECT snap_date, total_value, total_return_pct, day_return_pct,
                  sharpe_ratio, volatility_pct, geo_risk_score
           FROM portfolio_snapshots WHERE portfolio_id=?
           AND snap_date >= (CURRENT_DATE - ($1 || ' days')::interval)::date
           ORDER BY snap_date ASC""",
        (pid, f"-{days} days"), fetchall=True
    )
    return {"history": snaps, "days": days}


@router.post("/portfolios/{pid}/snapshot")
async def force_snapshot(pid: int, user=Depends(require_user)):
    p = await _db("SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
                  (pid, user["id"]), fetchone=True)
    if not p:
        raise HTTPException(404, "Portfolio not found")
    ok = await save_daily_snapshot(pid)
    return {"ok": ok}


@router.get("/portfolios/{pid}/geo-risk")
async def get_geo_risk(pid: int, user=Depends(require_user)):
    p = await _db("SELECT id FROM etf_portfolios WHERE id=? AND user_id=?",
                  (pid, user["id"]), fetchone=True)
    if not p:
        raise HTTPException(404, "Portfolio not found")
    return await compute_geo_risk_score(pid)


@router.get("/fx")
async def get_fx(_=Depends(require_user)):
    return {"rates": await get_fx_rates()}


@router.get("/quote/{ticker}")
async def get_quote(ticker: str, _=Depends(require_user)):
    data = await get_price(ticker.upper())
    if not data:
        raise HTTPException(404, f"No price data for {ticker}")
    return data


@router.get("/search/{query}")
async def search_tickers(query: str, _=Depends(require_user)):
    """Search for tickers in finance_cache and KG."""
    q = f"%{query.upper()}%"
    rows = await _db(
        "SELECT symbol as ticker, name, price, change_pct, category FROM finance_cache "
        "WHERE symbol LIKE ? OR name LIKE ? ORDER BY symbol LIMIT 20",
        (q, f"%{query}%"), fetchall=True
    )
    return {"results": rows, "query": query}
