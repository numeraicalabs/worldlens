"""World Lens — Main FastAPI application"""
from __future__ import annotations
import json
import logging
import asyncio
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from database import init_db
from auth import hash_password
from db import get_db
import scheduler
from routers.auth import router as auth_router
from routers.events import router as events_router
from routers.user_finance import finance_router, user_router
from routers.portfolio import router as portfolio_router
from routers.engage import router as engage_router
from routers.intelligence import router as intelligence_router, macro_router
from routers.markets import router as markets_router
from routers.admin import router as admin_router
from routers.insiders import router as insiders_router
from routers.dependency import router as dependency_router
from routers.track import router as track_router
from routers.ml import router as ml_router
from routers.globe import router as globe_router
from routers.agents import router as agents_router
from routers.finance_hub import router as finance_hub_router   # ← moved up
from routers.brain import router as brain_router
from routers.brain_agent import router as brain_agent_router
from routers.knowledge_graph import router as kg_router
from routers.jarvis import router as jarvis_router
from datetime import datetime
from config import settings

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"


async def _seed_admin():
    """Create default admin account if no admin exists."""
    try:
        async with get_db() as db:
            async with db.execute("SELECT id FROM users WHERE is_admin=1 LIMIT 1") as cur:
                if await cur.fetchone():
                    return
            await db.execute(
                "INSERT INTO users "
                "(email, username, password_hash, avatar_color, is_admin, role) "
                "VALUES (?,?,?,?,1,'admin') ON CONFLICT DO NOTHING",
                (settings.admin_email, "Admin",
                 hash_password(settings.admin_password), "#EF4444")
            )
            await db.commit()
            logger.info("Default admin created: %s", settings.admin_email)
    except Exception as e:
        logger.warning("_seed_admin: %s", e)


async def _load_ai_settings():
    """Load AI provider settings persisted in DB."""
    try:
        async with get_db() as db:
            async with db.execute(
                "SELECT key, value FROM app_settings "
                "WHERE key IN ('global_ai_provider','gemini_api_key','anthropic_api_key')"
            ) as cur:
                rows = await cur.fetchall()
        for row in rows:
            key, value = row[0], row[1]
            if value:
                if key == "global_ai_provider":
                    settings.global_ai_provider = value
                elif key == "gemini_api_key":
                    settings.gemini_api_key = value
                elif key == "anthropic_api_key":
                    settings.anthropic_api_key = value
        logger.info(
            "AI settings loaded: provider=%s gemini=%s claude=%s",
            settings.global_ai_provider,
            "ok" if settings.gemini_api_key else "not set",
            "ok" if settings.anthropic_api_key else "not set",
        )
    except Exception as e:
        logger.warning("_load_ai_settings: %s", e)


class WSManager:
    def __init__(self):
        self.connections = []

    async def connect(self, ws: WebSocket):
        try:
            await ws.accept()
            self.connections.append(ws)
        except Exception as e:
            logger.debug("WS connect error: %s", e)

    def disconnect(self, ws: WebSocket):
        if ws in self.connections:
            self.connections.remove(ws)

    async def broadcast(self, data: dict):
        dead = []
        msg = json.dumps(data, default=str)
        for ws in self.connections:
            try:
                await ws.send_text(msg)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    async def send(self, ws: WebSocket, data: dict):
        try:
            await ws.send_text(json.dumps(data, default=str))
        except Exception:
            pass


ws_manager = WSManager()


async def ws_broadcast_callback(data: dict):
    await ws_manager.broadcast(data)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── 1. Postgres schema ────────────────────────────────────────────────────
    try:
        from db import ensure_full_schema
        await ensure_full_schema()
        logger.info("Full Postgres schema ensured")
    except Exception as e:
        logger.warning("ensure_full_schema: %s", e)

    # ── 2. SQLite init + seed ─────────────────────────────────────────────────
    await init_db()
    await _seed_admin()
    await _load_ai_settings()

    # ── 3. Column migrations (fixes "column X does not exist") ───────────────
    try:
        from pg_compat import ensure_session_date
        await ensure_session_date()
        logger.info("Column migrations applied")
    except Exception as e:
        logger.warning("pg_compat migrations: %s", e)

    # ── 4. Supabase + Knowledge Graph ─────────────────────────────────────────
    try:
        from supabase_client import get_pool, ensure_kg_schema
        await get_pool()
        await ensure_kg_schema()
        logger.info("Knowledge Graph schema ready")
    except Exception as e:
        logger.warning("KG schema init skipped: %s", e)

    # ── 5. Background startup tasks ───────────────────────────────────────────
    async def _startup_brain_seed():
        await asyncio.sleep(6)
        SEED_VERSION = "v2.0"
        try:
            from supabase_client import get_pool
            pool = await get_pool()
            already_done = False
            if pool:
                try:
                    async with pool.acquire() as conn:
                        row = await conn.fetchrow(
                            "SELECT value FROM kg_meta WHERE key='seed_version'"
                        )
                        if row and row["value"] == SEED_VERSION:
                            n = await conn.fetchval("SELECT COUNT(*) FROM kg_nodes")
                            already_done = (n or 0) > 200
                except Exception as e:
                    logger.debug("Seed check: %s", e)
            else:
                # Fallback: check via get_db()
                try:
                    async with get_db() as db:
                        async with db.execute(
                            "SELECT value FROM kg_meta WHERE key='seed_version'"
                        ) as c:
                            row = await c.fetchone()
                        if row and row[0] == SEED_VERSION:
                            async with db.execute(
                                "SELECT COUNT(*) FROM kg_nodes"
                            ) as c:
                                r2 = await c.fetchone()
                                already_done = (r2[0] if r2 else 0) > 200
                except Exception as e:
                    logger.debug("Seed check fallback: %s", e)

            if already_done:
                logger.info("KG seed already at %s — skip", SEED_VERSION)
                return

            from kg_mega_seed_v2 import run_mega_seed_v2
            logger.info("Startup KG mega-seed v2…")
            n, e = await run_mega_seed_v2()
            logger.info("Startup KG mega-seed v2: +%d nodes +%d edges", n, e)

            try:
                if pool:
                    async with pool.acquire() as conn:
                        await conn.execute(
                            "INSERT INTO kg_meta(key,value) VALUES('seed_version',$1) "
                            "ON CONFLICT(key) DO UPDATE SET value=$1",
                            SEED_VERSION,
                        )
                else:
                    async with get_db() as db:
                        await db.execute(
                            "INSERT INTO kg_meta(key,value) VALUES(?,?) "
                            "ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",
                            ("seed_version", SEED_VERSION),
                        )
                        await db.commit()
            except Exception as e:
                logger.debug("kg_meta write: %s", e)
        except Exception as e:
            logger.warning("Startup seed: %s", e)
            try:
                from brain_autopop import auto_populate_from_macro
                await auto_populate_from_macro([])
            except Exception:
                pass

    async def _startup_brain_entries():
        await asyncio.sleep(12)
        try:
            from brain_entries_engine import run_brain_enrichment_cycle, generate_daily_digest
            logger.info("Startup: brain entries enrichment…")
            await run_brain_enrichment_cycle()
            await generate_daily_digest()
        except Exception as e:
            logger.warning("Startup brain entries: %s", e)

    async def _startup_global_cache():
        await asyncio.sleep(8)
        try:
            from global_cache import get_global_cache
            logger.info("Startup: generating global dashboard cache…")
            await get_global_cache()
        except Exception as e:
            logger.warning("Startup global cache: %s", e)

    asyncio.create_task(_startup_brain_seed())
    asyncio.create_task(_startup_brain_entries())
    asyncio.create_task(_startup_global_cache())

    # ── 6. Optional modules ───────────────────────────────────────────────────
    try:
        from routers.tradgentic.portfolio import ensure_tables as tg_init
        await tg_init()
        from routers.tradgentic.signal_history import ensure_signal_log
        await ensure_signal_log()
        from routers.tradgentic.leaderboard import ensure_leaderboard_tables
        await ensure_leaderboard_tables()
        logger.info("Tradgentic tables ready")
    except Exception as e:
        logger.warning("Tradgentic init skipped: %s", e)

    if settings.enable_finbert:
        try:
            from analysis.finbert_engine import init_models as init_finbert
            init_finbert()
            logger.info("FinBERT pre-load initiated")
        except Exception as e:
            logger.info("FinBERT pre-load skipped: %s", e)

    if settings.enable_spacy:
        try:
            from analysis.ner_engine import init_ner_models
            init_ner_models()
            logger.info("spaCy NER pre-load initiated")
        except Exception as e:
            logger.info("spaCy pre-load skipped: %s", e)

    scheduler.register_ws_callback(ws_broadcast_callback)
    scheduler.start()
    logger.info("World Lens started ✓")
    yield
    scheduler.stop()


# ── App setup ─────────────────────────────────────────────────────────────────
app = FastAPI(
    title="World Lens API",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
)

# ── Error logging middleware (full traceback on 500) ──────────────────────────
try:
    from error_middleware import register_middleware, diag_router
    register_middleware(app)
    app.include_router(diag_router)
    logger.info("Error middleware registered")
except Exception as _em:
    logger.warning("error_middleware not found: %s", _em)

# ── CORS ──────────────────────────────────────────────────────────────────────
_origins_raw = settings.allowed_origins.strip()
_cors_origins = (
    ["*"] if _origins_raw == "*"
    else [o.strip() for o in _origins_raw.split(",") if o.strip()]
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router)
app.include_router(events_router)
app.include_router(finance_router)
app.include_router(user_router)
app.include_router(portfolio_router)
app.include_router(engage_router)
app.include_router(intelligence_router)
app.include_router(macro_router)
app.include_router(markets_router)
app.include_router(admin_router)
app.include_router(insiders_router)
app.include_router(finance_hub_router)
app.include_router(dependency_router)
app.include_router(track_router)
app.include_router(ml_router)
app.include_router(globe_router)
app.include_router(agents_router)
app.include_router(brain_router)
app.include_router(brain_agent_router)
app.include_router(kg_router)
app.include_router(jarvis_router)

# Optional routers (skip if module missing)
try:
    from routers.tradgentic.router import router as tradgentic_router
    app.include_router(tradgentic_router)
except Exception as e:
    logger.warning("tradgentic router skipped: %s", e)

try:
    from routers.etf_tracker import router as etf_tracker_router
    app.include_router(etf_tracker_router)
except Exception as e:
    logger.warning("etf_tracker router skipped: %s", e)

try:
    from routers.financial_reports import router as fin_reports_router
    app.include_router(fin_reports_router)
except Exception as e:
    logger.warning("financial_reports router skipped: %s", e)

app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


# ── Endpoints ─────────────────────────────────────────────────────────────────
@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        try:
            from routers.events import stats_summary
            stats = await stats_summary()
            await ws_manager.send(ws, {"type": "welcome", "stats": stats})
        except Exception:
            pass
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=30)
                if msg == "ping":
                    await ws_manager.send(ws, {
                        "type": "pong",
                        "time": datetime.utcnow().isoformat(),
                    })
            except asyncio.TimeoutError:
                await ws_manager.send(ws, {
                    "type": "heartbeat",
                    "time": datetime.utcnow().isoformat(),
                })
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)
    except Exception as e:
        logger.error("WS error: %s", e)
        ws_manager.disconnect(ws)


@app.get("/{full_path:path}")
async def spa_fallback(full_path: str):
    index = STATIC / "index.html"
    if index.exists():
        return FileResponse(str(index))
    return JSONResponse({"error": "Not found"}, status_code=404)
