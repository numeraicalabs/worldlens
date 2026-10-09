"""World Lens — Monitoring router

Endpoints
─────────────────────────────────────────────────────────────────────
POST /api/monitoring/client-error        Public. Browser JS errors (beacon).
GET  /api/monitoring/client-errors       Admin JWT. Grouped error list (JSON).
GET  /api/monitoring/report?secret=...   ADMIN_BOOTSTRAP_SECRET. Same list, open
                                         directly in a browser (phone-friendly).
GET  /api/monitoring/ai[?test=1]         Public, no secrets. AI provider status,
                                         model in use, last error, live test.

Client errors are:
  • logged as  CLIENT_ERROR …  → visible immediately in Render logs
  • grouped by fingerprint (message+source+line) in table client_errors,
    so a crash hitting 500 users is 1 row with count=500, not 500 rows.
"""
from __future__ import annotations

import hashlib
import logging
import time
from collections import defaultdict, deque
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response

from auth import get_current_user
from config import settings
from db import get_db

logger = logging.getLogger("client_errors")
router = APIRouter(prefix="/api/monitoring", tags=["monitoring"])

# ── Limits ────────────────────────────────────────────────────────────
_MAX_FIELD = 2000              # chars per text field
_RATE_PER_MIN = 30             # reports per IP per minute
_LOG_DEDUP_SEC = 600           # same fingerprint logged at most every 10 min
_IGNORED = (
    "ResizeObserver loop",     # benign browser noise
    "Script error.",           # cross-origin, no info
    "chrome-extension://", "moz-extension://", "safari-extension://",
    "Non-Error promise rejection captured",
)

_ip_hits: dict = defaultdict(deque)
_last_logged: dict = {}
_table_ready = False


def _clip(v, n: int = _MAX_FIELD) -> str:
    return ("" if v is None else str(v))[:n]


def _rate_ok(ip: str) -> bool:
    now = time.time()
    q = _ip_hits[ip]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= _RATE_PER_MIN:
        return False
    q.append(now)
    if len(_ip_hits) > 5000:            # bound memory
        _ip_hits.clear()
    return True


async def _ensure_table() -> None:
    """Create table once per worker. Own get_db() context — never nested
    inside another one (nested contexts deadlocked the asyncpg pool before)."""
    global _table_ready
    if _table_ready:
        return
    async with get_db() as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS client_errors (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                fingerprint  TEXT UNIQUE NOT NULL,
                kind         TEXT,
                message      TEXT,
                source       TEXT,
                line         INTEGER,
                col          INTEGER,
                stack        TEXT,
                page         TEXT,
                user_agent   TEXT,
                app_version  TEXT,
                count        INTEGER DEFAULT 1,
                first_seen   TIMESTAMP DEFAULT (datetime('now')),
                last_seen    TIMESTAMP DEFAULT (datetime('now'))
            )""")
        await db.commit()
    _table_ready = True


# ── Intake ────────────────────────────────────────────────────────────
@router.post("/client-error")
async def client_error(request: Request):
    """Receives errors from the browser (navigator.sendBeacon). Always 204 —
    a monitoring endpoint must never become a source of user-facing errors."""
    try:
        ip = (request.headers.get("x-forwarded-for") or
              (request.client.host if request.client else "?")).split(",")[0].strip()
        if not _rate_ok(ip):
            return Response(status_code=204)

        try:
            body = await request.json()
        except Exception:
            return Response(status_code=204)
        if not isinstance(body, dict):
            return Response(status_code=204)

        msg = _clip(body.get("msg"), 500)
        src = _clip(body.get("src"), 300)
        if not msg or any(x in msg or x in src for x in _IGNORED):
            return Response(status_code=204)

        kind = _clip(body.get("kind") or "error", 40)
        try:
            line = int(body.get("line") or 0)
            col = int(body.get("col") or 0)
        except (TypeError, ValueError):
            line, col = 0, 0
        stack = _clip(body.get("stack"))
        page = _clip(body.get("url"), 300)
        ua = _clip(request.headers.get("user-agent"), 300)
        ver = _clip(body.get("v"), 20)

        # strip ?v=NN so the same bug across deploys groups together
        src_norm = src.split("?")[0]
        fp = hashlib.sha1(f"{kind}|{msg}|{src_norm}|{line}".encode()).hexdigest()[:16]

        now = time.time()
        if now - _last_logged.get(fp, 0) > _LOG_DEDUP_SEC:
            _last_logged[fp] = now
            logger.error("CLIENT_ERROR [%s] %s | %s:%s:%s | v=%s | %s | ua=%s",
                         kind, msg, src_norm, line, col, ver, page, ua[:80])
            if stack:
                logger.error("CLIENT_ERROR stack [%s]: %s", fp, stack[:600])

        try:
            await _ensure_table()
            async with get_db() as db:
                await db.execute(
                    "INSERT INTO client_errors "
                    "(fingerprint, kind, message, source, line, col, stack, page, user_agent, app_version) "
                    "VALUES (?,?,?,?,?,?,?,?,?,?) "
                    "ON CONFLICT(fingerprint) DO UPDATE SET "
                    "count = client_errors.count + 1, last_seen = datetime('now'), "
                    "app_version = EXCLUDED.app_version, user_agent = EXCLUDED.user_agent",
                    (fp, kind, msg, src_norm, line, col, stack, page, ua, ver),
                )
                await db.commit()
        except Exception as e:
            logger.warning("client_error store failed: %s", e)
    except Exception as e:  # never surface to the client
        logger.warning("client_error handler: %s", e)
    return Response(status_code=204)


# ── Read ──────────────────────────────────────────────────────────────
async def _fetch_errors(limit: int) -> list:
    await _ensure_table()
    async with get_db() as db:
        async with db.execute(
            "SELECT fingerprint, kind, message, source, line, col, stack, page, "
            "user_agent, app_version, count, first_seen, last_seen "
            "FROM client_errors ORDER BY last_seen DESC LIMIT ?",
            (int(limit),),
        ) as cur:
            rows = await cur.fetchall()
    out = []
    for r in rows:
        d = dict(r)
        for k in ("first_seen", "last_seen"):
            if d.get(k) is not None and not isinstance(d[k], str):
                d[k] = d[k].isoformat()
        out.append(d)
    return out


@router.get("/client-errors")
async def list_client_errors(limit: int = Query(100, ge=1, le=500),
                             current_user=Depends(get_current_user)):
    if not current_user or not current_user.get("is_admin"):
        raise HTTPException(403, "Admin only")
    errors = await _fetch_errors(limit)
    return {"count": len(errors), "errors": errors}


@router.get("/report", response_class=HTMLResponse)
async def error_report(secret: str = Query(""), limit: int = Query(50, ge=1, le=500)):
    """Readable HTML report — open in a browser with ?secret=ADMIN_BOOTSTRAP_SECRET."""
    expected = (getattr(settings, "admin_bootstrap_secret", "") or "").strip()
    if not expected or secret != expected:
        raise HTTPException(403, "Invalid secret")
    import html
    errors = await _fetch_errors(limit)
    try:
        from ai_layer import ai_diagnostics
        ai = await ai_diagnostics(live_test=False)
    except Exception as e:
        ai = {"error": str(e)}
    rows = "".join(
        f"<tr><td><b>{e['count']}</b></td><td>{html.escape(str(e['last_seen'])[:16])}</td>"
        f"<td>{html.escape(e['kind'] or '')}</td>"
        f"<td><b>{html.escape(e['message'] or '')}</b><br><small>{html.escape(e['source'] or '')}"
        f":{e['line']}:{e['col']} · v{html.escape(e['app_version'] or '')}</small>"
        f"<details><summary>stack</summary><pre>{html.escape(e['stack'] or '—')}</pre>"
        f"<small>{html.escape(e['user_agent'] or '')}</small></details></td></tr>"
        for e in errors
    ) or "<tr><td colspan=4>Nessun errore registrato ✓</td></tr>"
    ai_ok = "✅" if ai.get("configured") else "❌"
    page = f"""<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>WorldLens · Monitoring</title>
<style>body{{font:14px -apple-system,system-ui,sans-serif;margin:16px;color:#1a1a17;background:#fafaf7}}
table{{border-collapse:collapse;width:100%}}td{{border-bottom:1px solid #e2e2da;padding:8px;vertical-align:top}}
pre{{white-space:pre-wrap;font-size:11px;background:#f0f0ea;padding:8px}}h2{{margin:20px 0 8px}}
.card{{background:#fff;border:1px solid #e2e2da;border-radius:8px;padding:12px}}</style>
<h1>WorldLens · Monitoring</h1>
<h2>AI {ai_ok}</h2><div class=card><pre>{html.escape(str(ai))}</pre></div>
<h2>Errori frontend ({len(errors)} gruppi)</h2>
<table><tr><td>#</td><td>ultimo</td><td>tipo</td><td>errore</td></tr>{rows}</table>"""
    return HTMLResponse(page)


@router.get("/ai")
async def ai_status(test: int = Query(0)):
    """AI health. ?test=1 runs a tiny live call (result cached 60s)."""
    from ai_layer import ai_diagnostics
    return await ai_diagnostics(live_test=bool(test))
