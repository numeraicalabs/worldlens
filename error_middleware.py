"""
WorldLens — Error logging middleware
Wraps every request and logs full traceback on 500 errors.
"""
from __future__ import annotations
import logging
import traceback
import uuid
import time

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class ErrorLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        rid = str(uuid.uuid4())[:8]
        t0 = time.monotonic()
        try:
            response = await call_next(request)
            ms = (time.monotonic() - t0) * 1000
            if response.status_code >= 500:
                logger.error("[%s] %s %s -> %d (%.0fms) *** CHECK TRACEBACK ABOVE ***",
                             rid, request.method, request.url.path, response.status_code, ms)
            return response
        except Exception as exc:
            ms = (time.monotonic() - t0) * 1000
            tb = traceback.format_exc()
            logger.error("[%s] UNHANDLED %s %s (%.0fms)\n%s",
                         rid, request.method, request.url.path, ms, tb)
            return JSONResponse(
                status_code=500,
                content={"error": "internal_server_error", "request_id": rid,
                         "detail": str(exc)},
            )


def register_middleware(app: FastAPI) -> None:
    app.add_middleware(ErrorLoggingMiddleware)


# ── Diagnostic endpoint ───────────────────────────────────────────────────────
from fastapi import APIRouter
diag_router = APIRouter(prefix="/api/health", tags=["diagnostics"])

@diag_router.get("/diagnose")
async def diagnose():
    """Live diagnostics — call after deploy to check all subsystems."""
    out = {}
    # DB
    try:
        from db import get_db
        async with get_db() as db:
            async with db.execute("SELECT COUNT(*) FROM events") as cur:
                row = await cur.fetchone()
                out["events_count"] = row[0]
        out["db"] = "ok"
    except Exception as e:
        out["db"] = f"ERROR: {e}"

    # Tables
    critical_queries = {
        "ew_snapshots":       "SELECT COUNT(*) FROM ew_snapshots",
        "brain_sessions":     "SELECT COUNT(*) FROM brain_sessions",
        "daily_missions":     "SELECT COUNT(*) FROM daily_missions",
        "macro_indicators":   "SELECT COUNT(*) FROM macro_indicators",
        "agent_brief_history":"SELECT COUNT(*) FROM agent_brief_history",
        "global_cache":       "SELECT COUNT(*) FROM global_cache",
        "trade_ideas":        "SELECT COUNT(*) FROM trade_ideas",
        "anomaly_alerts":     "SELECT COUNT(*) FROM anomaly_alerts",
        "opp_scores":         "SELECT COUNT(*) FROM opp_scores",
    }
    out["tables"] = {}
    try:
        from db import get_db
        async with get_db() as db:
            for tbl, sql in critical_queries.items():
                try:
                    async with db.execute(sql) as cur:
                        row = await cur.fetchone()
                        out["tables"][tbl] = row[0]
                except Exception as e:
                    out["tables"][tbl] = f"ERROR: {e}"
    except Exception as e:
        out["tables"]["_error"] = str(e)

    # Session date column
    try:
        from db import get_db
        async with get_db() as db:
            async with db.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='brain_sessions' AND column_name='session_date'"
            ) as cur:
                row = await cur.fetchone()
                out["brain_sessions_session_date"] = "exists" if row else "MISSING"
    except Exception as e:
        out["brain_sessions_session_date"] = f"ERROR: {e}"

    return out
