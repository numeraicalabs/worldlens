"""
WorldLens — Health & Diagnostics Router
Endpoints to verify Render ↔ Supabase connectivity.
GET /api/health          → public basic ping
GET /api/health/db       → DB connection + table count (admin only)
GET /api/health/full     → full diagnostics (admin only)
"""
from __future__ import annotations
import asyncio
import logging
import time
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
async def health_ping():
    """Public health check — just confirms the server is running."""
    return {"status": "ok", "service": "worldlens"}


@router.get("/db")
async def health_db():
    """
    Check database connectivity.
    Returns which backend is active (Postgres or SQLite) and basic table counts.
    No auth required — useful for Render health checks and external monitoring.
    """
    result: Dict[str, Any] = {
        "backend": "unknown",
        "connected": False,
        "tables": {},
        "latency_ms": None,
        "error": None,
    }

    # Test Supabase/Postgres first
    t0 = time.monotonic()
    try:
        from supabase_client import get_pool, is_postgres
        pool = await get_pool()
        if pool:
            async with pool.acquire() as conn:
                # Count rows in key tables
                user_count  = await conn.fetchval("SELECT COUNT(*) FROM users")
                event_count = await conn.fetchval("SELECT COUNT(*) FROM events")
                port_count  = await conn.fetchval("SELECT COUNT(*) FROM etf_portfolios")
                idea_count  = await conn.fetchval(
                    "SELECT COUNT(*) FROM trade_ideas WHERE status='active'"
                )
            result.update({
                "backend":   "supabase_postgres",
                "connected": True,
                "latency_ms": round((time.monotonic() - t0) * 1000, 1),
                "tables": {
                    "users":           user_count,
                    "events":          event_count,
                    "etf_portfolios":  port_count,
                    "trade_ideas_active": idea_count,
                },
            })
            return result
    except Exception as e:
        result["error"] = str(e)

    # Fallback: SQLite
    try:
        import aiosqlite
        from config import settings
        async with aiosqlite.connect(settings.db_path) as db:
            async with db.execute("SELECT COUNT(*) FROM users") as cur:
                user_count = (await cur.fetchone())[0]
            async with db.execute("SELECT COUNT(*) FROM events") as cur:
                event_count = (await cur.fetchone())[0]
        result.update({
            "backend":   "sqlite_local",
            "connected": True,
            "latency_ms": round((time.monotonic() - t0) * 1000, 1),
            "tables": {
                "users":  user_count,
                "events": event_count,
            },
            "warning": "Using SQLite — data will NOT persist across deploys. Set SUPABASE_URL env var.",
        })
    except Exception as e2:
        result["error"] = f"PG: {result.get('error')} | SQLite: {e2}"

    return result


@router.get("/full")
async def health_full():
    """
    Full diagnostic: DB, schema, scheduler, AI layer, finance cache.
    Use this after a deploy to confirm everything is wired correctly.
    """
    report: Dict[str, Any] = {}

    # 1. Database
    db_info = await health_db()
    report["database"] = db_info

    # 2. Schema completeness (key tables exist)
    key_tables = [
        "users", "events", "etf_portfolios", "etf_holdings",
        "etf_portfolios_meta", "trade_ideas", "brain_entries",
        "brain_agent_sessions", "watchlist", "alerts",
    ]
    schema_ok: Dict[str, bool] = {}
    if db_info.get("connected"):
        try:
            from supabase_client import get_pool
            pool = await get_pool()
            if pool:
                async with pool.acquire() as conn:
                    for tbl in key_tables:
                        try:
                            await conn.fetchval(f"SELECT 1 FROM {tbl} LIMIT 1")
                            schema_ok[tbl] = True
                        except Exception:
                            schema_ok[tbl] = False
        except Exception:
            pass
    report["schema"] = schema_ok
    report["schema_complete"] = all(schema_ok.values()) if schema_ok else False

    # 3. Finance cache freshness
    try:
        from scheduler import get_finance_cache
        fc = get_finance_cache() or []
        report["finance_cache"] = {
            "count": len(fc),
            "fresh": len(fc) > 5,
            "sample": [a.get("symbol") for a in fc[:5]],
        }
    except Exception as e:
        report["finance_cache"] = {"error": str(e)}

    # 4. AI layer
    try:
        from ai_layer import _ai_available
        report["ai_layer"] = {"available": _ai_available()}
    except Exception as e:
        report["ai_layer"] = {"error": str(e)}

    # 5. Scheduler
    try:
        from scheduler import _scheduler
        jobs = _scheduler.get_jobs() if _scheduler else []
        report["scheduler"] = {
            "running": _scheduler.running if _scheduler else False,
            "jobs": [j.id for j in jobs],
        }
    except Exception as e:
        report["scheduler"] = {"error": str(e)}

    # Overall status
    db_ok      = db_info.get("connected", False)
    pg_ok      = db_info.get("backend") == "supabase_postgres"
    schema_ok_all = report.get("schema_complete", False)

    report["overall"] = {
        "status":   "healthy" if (db_ok and pg_ok and schema_ok_all) else "degraded",
        "postgres": pg_ok,
        "sqlite_fallback": not pg_ok and db_ok,
        "schema_ready": schema_ok_all,
    }

    return report
