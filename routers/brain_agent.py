"""
WorldLens Brain Agent v1
------------------------
Conversational AI agent backed by per-user brain (FTS5 RAG).
• 6 response templates (market_brief, risk_summary, geo_digest, compare, deep_dive, action_plan)
• Multi-turn session memory
• Explicit (👍/👎) + implicit (dwell time, re-read) feedback
• Adaptive weight updates: positive feedback raises entry weights, negative lowers them
• Auto-purge: entries with weight < 0.1 are archived after repeated negative signals
"""
from __future__ import annotations
import json
import logging
import re
import time
import uuid
from datetime import datetime, date
from typing import Optional, List, Dict, Tuple

import aiosqlite
from fastapi import APIRouter, Depends, Body, HTTPException
from auth import require_user
from config import settings
from ai_layer import _call_claude, _get_user_ai_keys, ai_available_async
from routers.brain import brain_ingest, brain_search, brain_context_for_prompt, ensure_brain_tables

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/brain-agent", tags=["brain-agent"])

# ── DB schema ─────────────────────────────────────────────────────────────────

AGENT_SCHEMA = """
CREATE TABLE IF NOT EXISTS brain_agent_sessions (
    id          TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL,
    title       TEXT DEFAULT 'New conversation',
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now')),
    message_count INTEGER DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS brain_agent_messages (
    id          TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    user_id     INTEGER NOT NULL,
    role        TEXT NOT NULL DEFAULT 'user',
    content     TEXT NOT NULL,
    template    TEXT DEFAULT NULL,
    sources_json TEXT DEFAULT '[]',
    rating      INTEGER DEFAULT NULL,
    dwell_ms    INTEGER DEFAULT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES brain_agent_sessions(id)
);

CREATE TABLE IF NOT EXISTS brain_agent_template_stats (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    template    TEXT NOT NULL,
    uses        INTEGER DEFAULT 0,
    positive    INTEGER DEFAULT 0,
    negative    INTEGER DEFAULT 0,
    UNIQUE(user_id, template),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_agent_sess_user ON brain_agent_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_msg_sess  ON brain_agent_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_msg_user  ON brain_agent_messages(user_id);
"""


async def ensure_agent_tables(db: aiosqlite.Connection):
    for stmt in AGENT_SCHEMA.split(";"):
        s = stmt.strip()
        if s:
            try:
                await db.execute(s)
            except Exception as e:
                logger.debug("agent schema: %s — %s", s[:60], e)
    await db.commit()


# ── Intent classifier ─────────────────────────────────────────────────────────

INTENT_RULES: Dict[str, List[str]] = {
    "market_brief": [
        "mercato", "prezzo", "ticker", "borsa", "azioni", "etf", "indice",
        "s&p", "nasdaq", "dow", "bitcoin", "crypto", "oil", "gold", "forex",
        "rendimento", "yield", "spread", "btp", "bond", "obbligazione",
        "market", "price", "stock", "equity", "commodity",
    ],
    "risk_summary": [
        "rischio", "crisi", "warning", "pericolo", "allerta", "alert",
        "instabilità", "volatilità", "drawdown", "worst case", "scenario",
        "esposizione", "hedging", "protezione", "risk", "danger", "threat",
        "early warning", "ew score", "stress",
    ],
    "geo_digest": [
        "geopolitica", "conflitto", "guerra", "paese", "regione", "sanzione",
        "diplomatico", "elezione", "governo", "nato", "ue", "usa", "cina",
        "russia", "medio oriente", "africa", "asia", "europa", "geopolitical",
        "war", "conflict", "election", "policy", "sanction",
    ],
    "compare": [
        "confronta", "differenza", "vs", "versus", "meglio", "peggio",
        "paragona", "quale preferisci", "quale scegliere", "compare",
        "comparison", "difference", "which is better", "pros cons",
    ],
    "deep_dive": [
        "spiega", "cos'è", "come funziona", "approfondisci", "dimmi di più",
        "analisi dettagliata", "capire", "spiegami", "explain", "what is",
        "how does", "deep dive", "understand", "breakdown",
    ],
    "action_plan": [
        "cosa fare", "strategia", "consigli", "piano", "azioni", "prossimi passi",
        "raccomandazioni", "dovresti", "dovrei", "suggerisci", "action",
        "strategy", "recommend", "next steps", "what should", "todo",
    ],
}


def classify_intent(query: str) -> str:
    q = query.lower()
    scores: Dict[str, int] = {k: 0 for k in INTENT_RULES}
    for intent, keywords in INTENT_RULES.items():
        for kw in keywords:
            if kw in q:
                scores[intent] += 1
    best = max(scores, key=lambda k: scores[k])
    return best if scores[best] > 0 else "deep_dive"


# ── Response templates ─────────────────────────────────────────────────────────

TEMPLATES: Dict[str, Dict] = {
    "market_brief": {
        "label": "📊 Market Brief",
        "icon": "📊",
        "description": "Analisi di mercato con dati e narrative",
        "system": (
            "Sei un analista finanziario senior di WorldLens. "
            "Rispondi con analisi di mercato strutturata. "
            "Usa SEMPRE questo formato esatto:\n\n"
            "**MARKET BRIEF — [ASSET/TEMA]**\n\n"
            "**Situazione attuale**\n[2-3 frasi sul contesto]\n\n"
            "**Dati chiave**\n"
            "| Metrica | Valore | Trend |\n"
            "|---------|--------|-------|\n"
            "[righe tabella]\n\n"
            "**Analisi AI**\n[3-4 frasi di analisi basata sui dati]\n\n"
            "**⚠ Risk factors**\n"
            "• [fattore 1]\n• [fattore 2]\n• [fattore 3]\n\n"
            "**Outlook 30 giorni:** [breve proiezione]\n\n"
            "*Fonte: WorldLens Brain — [N] entries analizzate*"
        ),
        "max_tokens": 600,
    },
    "risk_summary": {
        "label": "🚨 Risk Summary",
        "icon": "🚨",
        "description": "Score di rischio + azioni difensive",
        "system": (
            "Sei un risk manager di WorldLens. "
            "Usa SEMPRE questo formato:\n\n"
            "**RISK ASSESSMENT — [TEMA]**\n\n"
            "**Risk Score: [X]/10** [🟢 LOW / 🟡 MODERATE / 🟠 HIGH / 🔴 CRITICAL]\n\n"
            "**Segnali di allerta**\n"
            "• 🔴 [segnale critico]\n• 🟠 [segnale alto]\n• 🟡 [segnale moderato]\n\n"
            "**Esposizioni principali**\n[lista asset/settori/regioni a rischio]\n\n"
            "**Azioni difensive consigliate**\n"
            "1. [azione immediata]\n2. [azione a breve]\n3. [azione preventiva]\n\n"
            "**Scenario base / Scenario stress**\n"
            "Base: [descrizione]\nStress: [descrizione]\n\n"
            "*Risk intelligence basata su [N] segnali nel cervello*"
        ),
        "max_tokens": 550,
    },
    "geo_digest": {
        "label": "🌍 Geo Digest",
        "icon": "🌍",
        "description": "Sintesi geopolitica con timeline",
        "system": (
            "Sei un analista geopolitico di WorldLens. "
            "Usa SEMPRE questo formato:\n\n"
            "**GEO DIGEST — [REGIONE/TEMA]**\n\n"
            "**Situazione attuale** *(aggiornata al [data])*\n"
            "[2-3 frasi di contesto]\n\n"
            "**Timeline eventi chiave**\n"
            "• [data più recente] — [evento]\n• [...] — [...]\n• [...] — [...]\n\n"
            "**Attori principali**\n"
            "| Attore | Posizione | Interesse |\n"
            "|--------|-----------|----------|\n"
            "[righe]\n\n"
            "**Impatto sui mercati**\n[settori/asset class toccati]\n\n"
            "**Scenari a 90 giorni**\n"
            "🟢 Positivo: [scenario]\n🔴 Negativo: [scenario]\n\n"
            "*Geo intelligence da [N] fonti nel cervello*"
        ),
        "max_tokens": 600,
    },
    "compare": {
        "label": "⚖ Confronto",
        "icon": "⚖",
        "description": "Tabella comparativa strutturata",
        "system": (
            "Sei un analista comparativo di WorldLens. "
            "Usa SEMPRE questo formato:\n\n"
            "**CONFRONTO: [A] vs [B]**\n\n"
            "**Tabella comparativa**\n"
            "| Criterio | [A] | [B] | Vantaggio |\n"
            "|----------|-----|-----|-----------|\n"
            "[righe con ✓/✗/~ per ogni criterio]\n\n"
            "**Punti di forza**\n"
            "[A]: • [punto 1] • [punto 2]\n"
            "[B]: • [punto 1] • [punto 2]\n\n"
            "**Punti deboli**\n"
            "[A]: • [limite 1]\n[B]: • [limite 1]\n\n"
            "**Verdetto WorldLens**\n"
            "[Raccomandazione chiara con condizioni]\n\n"
            "**Quando scegliere [A] vs [B]:**\n"
            "• [A] se: [condizione]\n• [B] se: [condizione]\n\n"
            "*Analisi basata su [N] data points nel cervello*"
        ),
        "max_tokens": 600,
    },
    "deep_dive": {
        "label": "🔬 Deep Dive",
        "icon": "🔬",
        "description": "Analisi approfondita strutturata",
        "system": (
            "Sei un analista senior di WorldLens con accesso al brain database dell'utente. "
            "Usa SEMPRE questo formato:\n\n"
            "**DEEP DIVE: [TEMA]**\n\n"
            "**Executive Summary**\n[2-3 frasi che catturano il punto principale]\n\n"
            "**Background**\n[Contesto storico e strutturale, 3-4 frasi]\n\n"
            "**Analisi approfondita**\n[Sezione principale, 4-6 frasi con dati e reasoning]\n\n"
            "**Connessioni nel tuo Brain**\n"
            "• [come questo tema si collega ad altri nel tuo brain]\n"
            "• [pattern identificati nelle tue ricerche precedenti]\n\n"
            "**Implicazioni pratiche**\n"
            "1. [implicazione 1]\n2. [implicazione 2]\n3. [implicazione 3]\n\n"
            "**Domande aperte**\n"
            "• [aspetto ancora incerto]\n• [variabile da monitorare]\n\n"
            "*Deep dive alimentato da [N] entries del tuo cervello AI*"
        ),
        "max_tokens": 700,
    },
    "action_plan": {
        "label": "🎯 Action Plan",
        "icon": "🎯",
        "description": "Piano d'azione con priorità",
        "system": (
            "Sei un advisor strategico di WorldLens. "
            "Usa SEMPRE questo formato:\n\n"
            "**ACTION PLAN: [OBIETTIVO]**\n\n"
            "**Situazione di partenza**\n[Stato attuale basato sul contesto]\n\n"
            "**Azioni immediate (0-7 giorni)**\n"
            "🔴 1. [azione urgente]\n🔴 2. [azione urgente]\n\n"
            "**Azioni a breve (1-4 settimane)**\n"
            "🟡 3. [azione importante]\n🟡 4. [azione importante]\n\n"
            "**Azioni strategiche (1-3 mesi)**\n"
            "🟢 5. [azione strategica]\n🟢 6. [azione strategica]\n\n"
            "**KPI da monitorare**\n"
            "• [metrica 1]: target [valore]\n"
            "• [metrica 2]: target [valore]\n\n"
            "**⚠ Rischi del piano**\n[1-2 rischi principali da tenere a mente]\n\n"
            "*Piano generato con [N] insights dal tuo cervello AI*"
        ),
        "max_tokens": 600,
    },
}


# ── Session helpers ────────────────────────────────────────────────────────────

async def get_or_create_session(db: aiosqlite.Connection, user_id: int, session_id: Optional[str]) -> str:
    if session_id:
        async with db.execute(
            "SELECT id FROM brain_agent_sessions WHERE id=? AND user_id=?",
            (session_id, user_id)
        ) as cur:
            row = await cur.fetchone()
        if row:
            return session_id

    new_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO brain_agent_sessions (id, user_id, title) VALUES (?,?,?)",
        (new_id, user_id, "New conversation")
    )
    return new_id


async def get_session_history(db: aiosqlite.Connection, session_id: str, limit: int = 10) -> List[Dict]:
    async with db.execute(
        "SELECT role, content, template, created_at FROM brain_agent_messages "
        "WHERE session_id=? ORDER BY created_at DESC LIMIT ?",
        (session_id, limit)
    ) as cur:
        rows = await cur.fetchall()
    return list(reversed([{"role": r[0], "content": r[1], "template": r[2], "ts": r[3]} for r in rows]))


async def save_message(
    db: aiosqlite.Connection,
    session_id: str,
    user_id: int,
    role: str,
    content: str,
    template: Optional[str] = None,
    sources: Optional[List] = None,
) -> str:
    msg_id = str(uuid.uuid4())
    await db.execute(
        "INSERT INTO brain_agent_messages (id, session_id, user_id, role, content, template, sources_json) "
        "VALUES (?,?,?,?,?,?,?)",
        (msg_id, session_id, user_id, role, content, template, json.dumps(sources or []))
    )
    await db.execute(
        "UPDATE brain_agent_sessions SET message_count=message_count+1, updated_at=datetime('now'), "
        "title=CASE WHEN message_count=0 THEN ? ELSE title END WHERE id=?",
        (content[:60], session_id)
    )
    return msg_id


# ── Template stats ─────────────────────────────────────────────────────────────

async def record_template_use(db: aiosqlite.Connection, user_id: int, template: str):
    await db.execute(
        "INSERT INTO brain_agent_template_stats (user_id, template, uses) VALUES (?,?,1) "
        "ON CONFLICT(user_id,template) DO UPDATE SET uses=uses+1",
        (user_id, template)
    )


# ── Weight feedback loop ───────────────────────────────────────────────────────

async def apply_feedback_weights(db: aiosqlite.Connection, user_id: int, source_ids: List[int], delta: float):
    """Adjust brain entry weights based on feedback. Auto-purge entries < 0.1."""
    if not source_ids:
        return
    for entry_id in source_ids:
        await db.execute(
            "UPDATE brain_entries SET weight = MAX(0.05, MIN(5.0, weight + ?)) "
            "WHERE id=? AND user_id=?",
            (delta, entry_id, user_id)
        )
    # Auto-purge very low weight entries
    if delta < 0:
        await db.execute(
            "DELETE FROM brain_entries WHERE user_id=? AND weight < 0.1",
            (user_id,)
        )
        # Rebuild FTS index after deletion
        try:
            await db.execute("INSERT INTO brain_fts(brain_fts) VALUES('rebuild')")
        except Exception:
            pass


# ── Build prompt ───────────────────────────────────────────────────────────────

def build_prompt(
    query: str,
    template: str,
    brain_ctx: str,
    history: List[Dict],
) -> Tuple[str, str]:
    """Returns (system_prompt, user_prompt)."""
    tmpl = TEMPLATES.get(template, TEMPLATES["deep_dive"])
    n_sources = brain_ctx.count("•") if brain_ctx else 0

    # System: fill in source count
    system = tmpl["system"].replace("[N]", str(n_sources))

    # Build conversation context from history (last 6 messages)
    conv_ctx = ""
    if history:
        recent = history[-6:]
        conv_ctx = "\n\n[CONVERSATION HISTORY]\n"
        for msg in recent:
            role_label = "User" if msg["role"] == "user" else "Agent"
            conv_ctx += f"{role_label}: {msg['content'][:300]}\n"
        conv_ctx += "[END HISTORY]\n"

    # User prompt
    user_prompt = ""
    if brain_ctx:
        user_prompt += brain_ctx + "\n\n"
    if conv_ctx:
        user_prompt += conv_ctx + "\n"
    user_prompt += f"User request: {query}\n\nRespond in the same language as the user request."

    return system, user_prompt


# ── Main ask endpoint ──────────────────────────────────────────────────────────

@router.post("/ask")
async def ask_agent(payload: dict = Body(...), user=Depends(require_user)):
    query        = (payload.get("query") or "").strip()
    session_id   = payload.get("session_id")
    template_hint = payload.get("template_hint")  # user forced a template
    dwell_ms     = payload.get("dwell_ms")         # implicit: time on last response

    if not query:
        raise HTTPException(400, "query required")

    user_id = user["id"]
    ug, ua  = await _get_user_ai_keys(user_id)

    # Classify intent
    template = template_hint or classify_intent(query)
    if template not in TEMPLATES:
        template = "deep_dive"

    # Search brain
    brain_results = await brain_search(user_id, query, top_k=8)
    source_ids    = [r["id"] for r in brain_results]
    brain_ctx     = await brain_context_for_prompt(user_id, query, top_k=8)

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_agent_tables(db)
        await ensure_brain_tables(db)

        # Get/create session
        session_id = await get_or_create_session(db, user_id, session_id)

        # Get conversation history
        history = await get_session_history(db, session_id, limit=10)

        # Build prompt
        system_prompt, user_prompt = build_prompt(query, template, brain_ctx, history)

        # Save user message
        await save_message(db, session_id, user_id, "user", query)

        # Update dwell time on previous assistant message if provided
        if dwell_ms and isinstance(dwell_ms, (int, float)) and dwell_ms > 0:
            await db.execute(
                "UPDATE brain_agent_messages SET dwell_ms=? "
                "WHERE session_id=? AND role='assistant' AND dwell_ms IS NULL "
                "ORDER BY created_at DESC LIMIT 1",
                (int(dwell_ms), session_id)
            )

        # Record template usage
        await record_template_use(db, user_id, template)
        await db.commit()

    # Call AI
    has_ai = ug or ua or await ai_available_async()
    response_text = None

    if has_ai:
        try:
            response_text = await _call_claude(
                user_prompt,
                system=system_prompt,
                max_tokens=TEMPLATES[template]["max_tokens"],
                user_gemini_key=ug,
                user_anthropic_key=ua,
            )
        except Exception as e:
            logger.warning("brain-agent AI call failed: %s", e)

    # Fallback: data-driven response from brain only
    if not response_text:
        if brain_results:
            lines = [f"**{template.upper().replace('_',' ')} — {query[:60]}**\n"]
            lines.append("*Risposta generata dal Brain (AI non disponibile)*\n")
            for r in brain_results[:5]:
                lines.append(f"• [{r.get('source','?')}] {r['content'][:200]}")
            lines.append(f"\n*{len(brain_results)} entries trovate nel cervello*")
            response_text = "\n".join(lines)
        else:
            tmpl_info = TEMPLATES[template]
            response_text = (
                f"**{tmpl_info['icon']} {template.upper().replace('_',' ')}**\n\n"
                f"Non ho trovato informazioni rilevanti nel tuo cervello per: *{query}*\n\n"
                f"Suggerimento: aggiungi conoscenza nel **Brain Editor** o naviga altre view "
                f"per arricchire il tuo cervello AI automaticamente."
            )

    # Save response to DB
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_agent_tables(db)
        msg_id = await save_message(
            db, session_id, user_id, "assistant",
            response_text, template=template, sources=source_ids
        )

        # Feed the exchange back into the brain
        await db.commit()

    # Async feed to brain (fire-and-forget style)
    try:
        await brain_ingest(
            user_id,
            f"Q: {query[:300]} A: {response_text[:400]}",
            source="question",
            weight=1.6,
            context={"template": template, "session": session_id}
        )
    except Exception:
        pass

    return {
        "response":    response_text,
        "template":    template,
        "template_label": TEMPLATES[template]["label"],
        "session_id":  session_id,
        "message_id":  msg_id,
        "sources":     source_ids,
        "brain_hits":  len(brain_results),
        "has_ai":      bool(has_ai),
    }


# ── Feedback endpoint ─────────────────────────────────────────────────────────

@router.post("/feedback")
async def submit_feedback(payload: dict = Body(...), user=Depends(require_user)):
    """
    Explicit feedback: rating +1 (positive) or -1 (negative).
    Updates brain entry weights and template stats.
    """
    message_id = payload.get("message_id")
    rating     = payload.get("rating")  # 1 = positive, -1 = negative
    dwell_ms   = payload.get("dwell_ms")

    if not message_id or rating not in (1, -1):
        raise HTTPException(400, "message_id and rating (1 or -1) required")

    user_id = user["id"]

    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_agent_tables(db)

        # Get message
        async with db.execute(
            "SELECT * FROM brain_agent_messages WHERE id=? AND user_id=?",
            (message_id, user_id)
        ) as cur:
            msg = await cur.fetchone()

        if not msg:
            raise HTTPException(404, "Message not found")

        msg = dict(msg)
        source_ids = json.loads(msg.get("sources_json") or "[]")
        template   = msg.get("template", "deep_dive")

        # Update message rating
        await db.execute(
            "UPDATE brain_agent_messages SET rating=?, dwell_ms=COALESCE(?,dwell_ms) WHERE id=?",
            (rating, dwell_ms, message_id)
        )

        # Adjust brain weights
        delta = 0.3 if rating == 1 else -0.2
        await apply_feedback_weights(db, user_id, source_ids, delta)

        # Update template stats
        if rating == 1:
            await db.execute(
                "INSERT INTO brain_agent_template_stats (user_id, template, positive) VALUES (?,?,1) "
                "ON CONFLICT(user_id,template) DO UPDATE SET positive=positive+1",
                (user_id, template)
            )
        else:
            await db.execute(
                "INSERT INTO brain_agent_template_stats (user_id, template, negative) VALUES (?,?,1) "
                "ON CONFLICT(user_id,template) DO UPDATE SET negative=negative+1",
                (user_id, template)
            )

        await db.commit()

    return {"ok": True, "entries_adjusted": len(source_ids)}


# ── Implicit feedback (dwell time) ────────────────────────────────────────────

@router.post("/implicit-feedback")
async def implicit_feedback(payload: dict = Body(...), user=Depends(require_user)):
    """
    Implicit feedback from dwell time.
    > 10s on a response = mild positive signal (weight += 0.1)
    > 30s = strong positive (weight += 0.2)
    """
    message_id = payload.get("message_id")
    dwell_ms   = payload.get("dwell_ms", 0)

    if not message_id:
        return {"ok": False}

    user_id = user["id"]
    dwell_s = dwell_ms / 1000

    if dwell_s < 5:
        return {"ok": True, "signal": "too_short"}

    delta = 0.0
    signal = "neutral"
    if dwell_s > 30:
        delta = 0.2
        signal = "strong_positive"
    elif dwell_s > 10:
        delta = 0.1
        signal = "mild_positive"

    if delta > 0:
        async with aiosqlite.connect(settings.db_path) as db:
            db.row_factory = aiosqlite.Row
            await ensure_agent_tables(db)
            async with db.execute(
                "SELECT sources_json FROM brain_agent_messages WHERE id=? AND user_id=?",
                (message_id, user_id)
            ) as cur:
                row = await cur.fetchone()
            if row:
                source_ids = json.loads(row["sources_json"] or "[]")
                await apply_feedback_weights(db, user_id, source_ids, delta)
                await db.execute(
                    "UPDATE brain_agent_messages SET dwell_ms=? WHERE id=?",
                    (dwell_ms, message_id)
                )
                await db.commit()

    return {"ok": True, "signal": signal, "delta": delta}


# ── Session management ─────────────────────────────────────────────────────────

@router.get("/sessions")
async def list_sessions(user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_agent_tables(db)
        async with db.execute(
            "SELECT * FROM brain_agent_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 20",
            (user["id"],)
        ) as cur:
            sessions = [dict(r) for r in await cur.fetchall()]
    return sessions


@router.get("/sessions/{session_id}/messages")
async def get_session_messages(session_id: str, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_agent_tables(db)
        async with db.execute(
            "SELECT * FROM brain_agent_messages WHERE session_id=? AND user_id=? ORDER BY created_at ASC",
            (session_id, user["id"])
        ) as cur:
            msgs = [dict(r) for r in await cur.fetchall()]
    return msgs


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user=Depends(require_user)):
    async with aiosqlite.connect(settings.db_path) as db:
        await ensure_agent_tables(db)
        await db.execute(
            "DELETE FROM brain_agent_messages WHERE session_id=? AND user_id=?",
            (session_id, user["id"])
        )
        await db.execute(
            "DELETE FROM brain_agent_sessions WHERE id=? AND user_id=?",
            (session_id, user["id"])
        )
        await db.commit()
    return {"ok": True}


# ── Templates info ─────────────────────────────────────────────────────────────

@router.get("/templates")
async def get_templates(user=Depends(require_user)):
    """Returns templates with per-user stats (win rate, usage count)."""
    async with aiosqlite.connect(settings.db_path) as db:
        db.row_factory = aiosqlite.Row
        await ensure_agent_tables(db)
        async with db.execute(
            "SELECT template, uses, positive, negative FROM brain_agent_template_stats WHERE user_id=?",
            (user["id"],)
        ) as cur:
            stats = {r["template"]: dict(r) for r in await cur.fetchall()}

    result = []
    for tid, tmpl in TEMPLATES.items():
        s = stats.get(tid, {"uses": 0, "positive": 0, "negative": 0})
        wr = round(s["positive"] / max(s["uses"], 1) * 100)
        result.append({
            "id":          tid,
            "label":       tmpl["label"],
            "icon":        tmpl["icon"],
            "description": tmpl["description"],
            "uses":        s["uses"],
            "win_rate":    wr,
        })
    return result
