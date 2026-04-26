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
import aiosqlite
import scheduler
from routers.auth import router as auth_router
from routers.events import router as events_router
from routers.user_finance import finance_router, user_router
from routers.portfolio import router as portfolio_router
from routers.engage import router as engage_router
from routers.intelligence import router as intelligence_router
from routers.markets import router as markets_router
from routers.admin import router as admin_router
from routers.insiders import router as insiders_router
from routers.dependency import router as dependency_router
from routers.track import router as track_router
from routers.ml    import router as ml_router
from routers.globe import router as globe_router
from routers.agents import router as agents_router
from routers.tradgentic.router import router as tradgentic_router
from routers.etf_tracker import router as etf_tracker_router
from datetime import datetime
from config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger(__name__)
STATIC = Path(__file__).parent / "static"


async def _seed_admin():
    """Create default admin account if no admin exists."""
    async with aiosqlite.connect(settings.db_path) as db:
        async with db.execute("SELECT id FROM users WHERE is_admin=1 LIMIT 1") as cur:
            if await cur.fetchone():
                return
        await db.execute(
            "INSERT OR IGNORE INTO users "
            "(email, username, password_hash, avatar_color, is_admin, role) "
            "VALUES (?,?,?,?,1,'admin')",
            (settings.admin_email, "Admin",
             hash_password(settings.admin_password), "#EF4444")
        )
        await db.commit()
        logger.info("Default admin created: %s", settings.admin_email)


class WSManager:
    def __init__(self):
        self.connections = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

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



async def _load_ai_settings():
    """Load AI provider settings persisted in DB (overrides config.py defaults)."""
    try:
        async with aiosqlite.connect(settings.db_path) as db:
            async with db.execute("SELECT key, value FROM app_settings WHERE key IN ('global_ai_provider','gemini_api_key','anthropic_api_key')") as cur:
                rows = await cur.fetchall()
        for key, value in rows:
            if value:
                if key == "global_ai_provider":
                    settings.global_ai_provider = value
                elif key == "gemini_api_key":
                    settings.gemini_api_key = value
                elif key == "anthropic_api_key":
                    settings.anthropic_api_key = value
        logger.info("AI settings loaded from DB: provider=%s, gemini=%s, claude=%s",
                    settings.global_ai_provider,
                    "configured" if settings.gemini_api_key    else "not set",
                    "configured" if settings.anthropic_api_key else "not set (disabled)")
    except Exception as e:
        logger.warning("Could not load AI settings from DB: %s", e)

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _seed_admin()
    await _load_ai_settings()
    # Init tradgentic tables
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
    # ── Start ML model pre-loading in background threads ──────────────
    # Models are optional — app starts instantly even if ML unavailable.
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
    logger.info("World Lens started")
    yield
    scheduler.stop()


app = FastAPI(title="World Lens API", version="1.0.0", lifespan=lifespan, docs_url="/api/docs")

# Parse ALLOWED_ORIGINS env var (comma-separated list or "*")
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

app.include_router(auth_router)
app.include_router(events_router)
app.include_router(finance_router)
app.include_router(user_router)
app.include_router(portfolio_router)
app.include_router(engage_router)
app.include_router(intelligence_router)
app.include_router(markets_router)
app.include_router(admin_router)
app.include_router(insiders_router)
app.include_router(dependency_router)
app.include_router(track_router)
app.include_router(ml_router)
app.include_router(globe_router)
app.include_router(agents_router)
app.include_router(tradgentic_router)
app.include_router(etf_tracker_router)

from routers.brain import router as brain_router
app.include_router(brain_router)

from routers.brain_agent import router as brain_agent_router
app.include_router(brain_agent_router)

from routers.knowledge_graph import router as kg_router
app.include_router(kg_router)
app.mount("/static", StaticFiles(directory=str(STATIC)), name="static")


@app.get("/api/health")
async def health():
    return {"status": "ok", "time": datetime.utcnow().isoformat()}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        from routers.events import stats_summary
        try:
            stats = await stats_summary()
            await ws_manager.send(ws, {"type": "welcome", "stats": stats})
        except Exception:
            pass
        while True:
            try:
                msg = await asyncio.wait_for(ws.receive_text(), timeout=30)
                if msg == "ping":
                    await ws_manager.send(ws, {"type": "pong", "time": datetime.utcnow().isoformat()})
            except asyncio.TimeoutError:
                await ws_manager.send(ws, {"type": "heartbeat", "time": datetime.utcnow().isoformat()})
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
