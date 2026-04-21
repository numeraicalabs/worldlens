"""World Lens — AI Intelligence Layer v3
Architecture: Google Gemini (free tier) as primary provider.
Claude (Anthropic) kept in codebase, disabled by default.
Admin controls the active provider via Admin → Settings.

Modules:
  _call_claude()        — unified dispatch (Gemini | Claude | none)
  ai_score_event()      — event impact scoring
  ai_sentiment()        — multi-dimensional sentiment (polarity, uncertainty,
                          market_stress, narrative_momentum, credibility)
  ai_ner()              — entity extraction (NER)
  ai_show_impact()      — quantitative market impact model
  ai_regional_risk()    — geopolitical risk assessment
  ai_answer()           — free-form Q&A
  ai_macro_briefing()   — macro economic briefing
  ai_watchlist_digest() — personalised digest
  ai_event_relationships() — causal/correlated link detection
  compute_topic_vector()   — lightweight topic fingerprint (no external deps)
"""
from __future__ import annotations
import httpx
import json
import math
import logging
import re
from typing import Dict, List, Optional, Tuple
from config import settings
import aiosqlite as _aiosqlite

logger = logging.getLogger(__name__)

_NO_AI_MSG = "Configure a free Google Gemini key in Admin → Settings to enable AI analysis. Get one at https://aistudio.google.com/app/apikey"

# ── Settings self-heal: reload from DB when in-memory key is missing ──

async def _ensure_ai_settings() -> None:
    """Reload AI provider + keys from DB if not already in memory.
    Fixes: key saved by admin is in SQLite but lost from pydantic singleton
    after restart on read-only filesystems (Render, Railway).
    DB is hit at most once per worker — once a key is loaded it stays.
    """
    if (settings.gemini_api_key or "").strip() or (settings.anthropic_api_key or "").strip():
        return
    try:
        async with _aiosqlite.connect(settings.db_path) as _db:
            async with _db.execute(
                "SELECT key, value FROM app_settings "
                "WHERE key IN ('global_ai_provider','gemini_api_key','anthropic_api_key')"
            ) as _cur:
                for _key, _val in await _cur.fetchall():
                    if _val:
                        if _key == "global_ai_provider":
                            settings.global_ai_provider = _val
                        elif _key == "gemini_api_key":
                            settings.gemini_api_key = _val
                        elif _key == "anthropic_api_key":
                            settings.anthropic_api_key = _val
        if settings.gemini_api_key or settings.anthropic_api_key:
            logger.info("AI settings reloaded from DB: provider=%s", settings.global_ai_provider)
    except Exception as _e:
        logger.debug("_ensure_ai_settings DB read failed: %s", _e)


# ── Provider resolution ───────────────────────────────

def _resolve_provider() -> Tuple[str, str]:
    """Return (provider_name, api_key) based on global admin setting."""
    provider = settings.global_ai_provider  # "gemini" | "claude" | "none"
    gkey = (settings.gemini_api_key or "").strip()
    ckey = (settings.anthropic_api_key or "").strip()
    if provider == "gemini" and gkey:
        return "gemini", gkey
    if provider == "claude" and ckey:
        return "claude", ckey
    # Fallback: use whichever key is available
    if gkey:
        return "gemini", gkey
    if ckey:
        return "claude", ckey
    return "none", ""

def _ai_available() -> bool:
    """Sync check — only valid after _ensure_ai_settings() has been awaited."""
    provider, key = _resolve_provider()
    return provider != "none" and bool(key)


async def ai_available_async() -> bool:
    """Async check — reloads key from DB if missing, then checks."""
    await _ensure_ai_settings()
    return _ai_available()

# ── Central dispatch ──────────────────────────────────

async def _call_claude(prompt: str, system: str = "", max_tokens: int = 400,
                       user_api_key: str = "", user_provider: str = "") -> Optional[str]:
    """Unified AI call. Routes to Gemini by default; Claude if admin sets provider."""
    await _ensure_ai_settings()  # self-heal: reload key from DB if empty
    provider, api_key = _resolve_provider()
    if user_provider and user_api_key and user_provider == settings.global_ai_provider:
        provider, api_key = user_provider, user_api_key
    if provider == "none" or not api_key:
        return None
    if provider == "gemini":
        return await _call_gemini(prompt, system, max_tokens, api_key)
    if provider == "claude":
        return await _call_anthropic(prompt, system, max_tokens, api_key)
    return None

async def _call_gemini(prompt: str, system: str, max_tokens: int, api_key: str) -> Optional[str]:
    """Call Gemini 1.5 Flash via Google AI free-tier API."""
    try:
        full = (system + "\n\n" + prompt).strip() if system else prompt
        async with httpx.AsyncClient(timeout=25) as client:
            resp = await client.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key={api_key}",
                headers={"content-type": "application/json"},
                json={"contents": [{"parts": [{"text": full}]}],
                      "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.35}}
            )
            resp.raise_for_status()
            return resp.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception as e:
        logger.debug("Gemini error: %s", e)
        return None

async def _call_anthropic(prompt: str, system: str, max_tokens: int, api_key: str) -> Optional[str]:
    """Call Claude Haiku via Anthropic API. Only active when admin enables it."""
    try:
        body: dict = {"model": "claude-haiku-4-5", "max_tokens": max_tokens,
                      "messages": [{"role": "user", "content": prompt}]}
        if system:
            body["system"] = system
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={"x-api-key": api_key, "anthropic-version": "2023-06-01",
                         "content-type": "application/json"},
                json=body
            )
            resp.raise_for_status()
            return resp.json()["content"][0]["text"].strip()
    except Exception as e:
        logger.debug("Claude error: %s", e)
        return None

def _parse_json(text: str) -> Optional[Dict]:
    """Safely parse JSON from AI response, stripping markdown fences."""
    if not text:
        return None
    try:
        t = text.strip()
        if t.startswith("```"):
            t = t.split("```")[1]
            if t.startswith("json"):
                t = t[4:]
        return json.loads(t.strip())
    except Exception:
        return None

# ════════════════════════════════════════════════════════
# 1. MULTI-DIMENSIONAL SENTIMENT MODEL
# ════════════════════════════════════════════════════════

# Source credibility registry — tunable
SOURCE_CREDIBILITY: Dict[str, float] = {
    "Reuters":     0.95, "BBC World": 0.93, "AP News": 0.93,
    "Al Jazeera":  0.87, "UN News":   0.92, "USGS":    0.99,
    "NASA EONET":  0.99, "Bloomberg": 0.91, "FT":      0.90,
}
DEFAULT_CREDIBILITY = 0.72

# Lexicons for rule-based fallback
_NEG = ["war","attack","kill","crash","crisis","collapse","sanction","explosion",
        "disaster","earthquake","flood","protest","riot","conflict","recession",
        "ban","default","death","casualties","arrested","coup","strike","shutdown",
        "surge","threat","invasion","escalation","panic","emergency","warning"]
_POS = ["ceasefire","peace","deal","agreement","growth","recovery","summit","aid",
        "invest","profit","gain","approval","launch","partnership","breakthrough",
        "relief","stabilize","deescalate","resolve","accord","treaty","boost"]
_UNCERT = ["uncertain","unclear","unknown","risk","possible","may","might","could",
           "reportedly","allegedly","unconfirmed","speculate","warn","fear"]
_STRESS = ["crash","default","recession","bank","liquidity","credit","spread",
           "margin","sell-off","volatility","vix","yield","contagion","systemic"]

def _rule_sentiment(text: str, source: str, category: str) -> Dict:
    """Fast rule-based sentiment scoring — used when AI is unavailable."""
    tl = text.lower()
    neg = sum(1 for w in _NEG if w in tl)
    pos = sum(1 for w in _POS if w in tl)
    unc = sum(1 for w in _UNCERT if w in tl)
    mst = sum(1 for w in _STRESS if w in tl)
    total = max(pos + neg, 1)
    polarity = round(max(-1.0, min(1.0, (pos - neg) / total * 0.8)), 3)
    uncertainty = round(min(1.0, unc / 8), 3)
    market_stress = round(min(1.0, mst / 5), 3)
    intensity = "High" if abs(polarity) > 0.5 else "Medium" if abs(polarity) > 0.2 else "Low"
    tone = "Negative" if polarity < -0.15 else "Positive" if polarity > 0.15 else "Neutral"
    info_map = {
        "CONFLICT": "Geopolitical Event", "SECURITY": "Security Incident",
        "EARTHQUAKE": "Natural Disaster", "DISASTER": "Natural Disaster",
        "ECONOMICS": "Economic Development", "FINANCE": "Financial News",
        "TECHNOLOGY": "Technology Update", "ENERGY": "Energy Market",
        "HUMANITARIAN": "Humanitarian Crisis", "POLITICS": "Political Development",
        "GEOPOLITICS": "Geopolitical Event", "HEALTH": "Health/Medical",
    }
    return {
        "score": polarity, "tone": tone, "intensity": intensity,
        "info_type": info_map.get(category, "News Event"),
        "uncertainty": uncertainty,
        "market_stress": market_stress,
        "narrative_momentum": 0.0,  # needs time-series; rule-based cannot compute
        "credibility": SOURCE_CREDIBILITY.get(source, DEFAULT_CREDIBILITY),
        "entity_sentiments": [], "confidence": 0.55, "fallback": True,
    }

async def ai_sentiment(title: str, summary: str, category: str,
                       source: str = "") -> Dict:
    """
    Multi-dimensional sentiment scoring.
    Pipeline: FinBERT (if available) → Gemini/Claude → rule-based fallback.
      score              float  -1..+1   overall polarity
      tone               str    Negative|Neutral|Positive
      intensity          str    Low|Medium|High|Extreme
      uncertainty        float  0..1     epistemic uncertainty in language
      market_stress      float  0..1     financial stress signal
      narrative_momentum float  -1..1    is this story gaining/losing traction
      credibility        float  0..1     source reliability
      entity_sentiments  list   per-entity polarity
    """
    text = (title + " " + (summary or ""))[:700]
    credibility = SOURCE_CREDIBILITY.get(source, DEFAULT_CREDIBILITY)

    # ── Try FinBERT first ─────────────────────────────────────────────
    try:
        from config import settings as _s
        if getattr(_s, "enable_finbert", False):
            from analysis.finbert_engine import finbert_sentiment
            result = await finbert_sentiment(title, summary, category, source)
            if result and not result.get("fallback"):
                logger.debug("Sentiment via FinBERT for '%s'", title[:40])
                return result
    except Exception as _fb_e:
        logger.debug("FinBERT sentiment fallthrough: %s", _fb_e)

    if not _ai_available():
        return _rule_sentiment(text, source, category)

    prompt = (
        "Perform multi-dimensional sentiment analysis. Respond ONLY with valid JSON.\n\n"
        "Title: " + title + "\n"
        "Text: " + (summary or "")[:450] + "\n"
        "Category: " + category + "\n"
        "Source: " + (source or "unknown") + "\n\n"
        "Return exactly:\n"
        '{\n'
        '  "score": 0.0,\n'                          # -1.0 to +1.0 polarity
        '  "tone": "Negative|Neutral|Positive",\n'
        '  "intensity": "Low|Medium|High|Extreme",\n'
        '  "uncertainty": 0.0,\n'                    # 0-1: epistemic uncertainty
        '  "market_stress": 0.0,\n'                  # 0-1: financial stress signals
        '  "narrative_momentum": 0.0,\n'             # -1..1: story gaining(+)/fading(-)
        '  "info_type": "Geopolitical Event|Economic Development|Natural Disaster|'
        'Security Incident|Financial News|Technology Update|Energy Market|'
        'Political Development|Humanitarian Crisis|Health/Medical|Other",\n'
        '  "entity_sentiments": [\n'
        '    {"entity":"name","type":"Country|Company|Commodity|Currency|Index|Person",'
        '"sentiment":"Negative|Neutral|Positive","score":0.0,"reason":"brief"}\n'
        '  ],\n'
        '  "key_narrative": "one sentence on the dominant frame of this news",\n'
        '  "confidence": 0.85\n'
        '}\n'
        "score: -1.0=extremely negative, +1.0=extremely positive\n"
        "uncertainty: 1.0=full of hedges/unknowns, 0.0=clear factual statement\n"
        "market_stress: 1.0=panic/crisis language, 0.0=calm\n"
        "narrative_momentum: +1.0=rapidly growing story, -1.0=fading/resolved\n"
        "List up to 4 entities."
    )
    text_resp = await _call_claude(prompt, max_tokens=600)
    result = _parse_json(text_resp)
    if result and "score" in result:
        result["credibility"] = credibility
        result["fallback"] = False
        return result
    return _rule_sentiment(text, source, category)

# ════════════════════════════════════════════════════════
# 2. ENTITY EXTRACTION (NER)
# ════════════════════════════════════════════════════════

# Rule-based NER fallback (country/org patterns)
_COUNTRY_NAMES = {
    "US":"United States","USA":"United States","UK":"United Kingdom",
    "EU":"European Union","UN":"United Nations","NATO":"NATO",
    "Russia":"Russia","China":"China","Iran":"Iran","Israel":"Israel",
    "Ukraine":"Ukraine","Turkey":"Turkey","Saudi Arabia":"Saudi Arabia",
    "India":"India","Brazil":"Brazil","Germany":"Germany","France":"France",
}

def _rule_ner(text: str, category: str) -> List[Dict]:
    """Fast rule-based entity extraction."""
    entities = []
    seen = set()
    # Countries
    for abbr, full in _COUNTRY_NAMES.items():
        if abbr in text and full not in seen:
            entities.append({"text": full, "type": "Country", "salience": 0.7})
            seen.add(full)
    # Sector keywords → sectors as entities
    sector_map = {
        "oil":"Oil & Gas","gas":"Oil & Gas","bank":"Banking","tech":"Technology",
        "defense":"Defense","gold":"Gold","bitcoin":"Crypto","wheat":"Agriculture",
    }
    tl = text.lower()
    for kw, sector in sector_map.items():
        if kw in tl and sector not in seen:
            entities.append({"text": sector, "type": "Sector", "salience": 0.5})
            seen.add(sector)
    return entities[:6]

async def ai_ner(title: str, summary: str, category: str) -> List[Dict]:
    """
    Extract named entities with type and salience score.
    Returns: [{text, type, salience, sentiment_hint}]
    Types: Country | Company | Person | Commodity | Currency | Index | Organization | Sector
    """
    # ── Try spaCy NER first ──────────────────────────────────────────
    try:
        from config import settings as _s
        if getattr(_s, "enable_spacy", False):
            from analysis.ner_engine import extract_entities
            ner_result = await extract_entities(title, summary, category)
            if ner_result:
                # Convert to ai_layer schema (add sentiment_hint if missing)
                for e in ner_result:
                    e.setdefault("sentiment_hint", "Neutral")
                logger.debug("NER via spaCy for '%s'", title[:40])
                return ner_result
    except Exception as _ner_e:
        logger.debug("spaCy NER fallthrough: %s", _ner_e)

    if not _ai_available():
        return _rule_ner(title + " " + (summary or ""), category)

    prompt = (
        "Extract named entities from this news. Respond ONLY with valid JSON array.\n\n"
        "Title: " + title + "\n"
        "Text: " + (summary or "")[:350] + "\n\n"
        "Return array (max 6 entities):\n"
        '[{"text":"entity name","type":"Country|Company|Person|Commodity|Currency|Index|Organization|Sector",'
        '"salience":0.9,"sentiment_hint":"Negative|Neutral|Positive"}]\n'
        "salience 0-1: how central this entity is to the story.\n"
        "Include only entities explicitly mentioned."
    )
    text_resp = await _call_claude(prompt, max_tokens=400)
    # parse array
    if text_resp:
        try:
            t = text_resp.strip()
            if t.startswith("```"):
                t = t.split("```")[1]
                if t.startswith("json"): t = t[4:]
            result = json.loads(t.strip())
            if isinstance(result, list):
                return result[:6]
        except Exception:
            pass
    return _rule_ner(title + " " + (summary or ""), category)

# ════════════════════════════════════════════════════════
# 3. TOPIC VECTOR (lightweight fingerprint)
# ════════════════════════════════════════════════════════

# 8-dimensional topic space — each dimension = one meta-topic
_TOPIC_DIMS = [
    ["war","conflict","military","attack","troops","battle","airstrike"],      # 0: Conflict
    ["sanction","trade","tariff","gdp","recession","inflation","fed","rate"],   # 1: Economics
    ["election","coup","president","parliament","vote","government","protest"], # 2: Politics
    ["oil","gas","energy","opec","pipeline","nuclear","power"],                 # 3: Energy
    ["earthquake","flood","hurricane","disaster","climate","wildfire","storm"], # 4: Disaster
    ["pandemic","virus","vaccine","who","outbreak","disease","health"],         # 5: Health
    ["tech","ai","cyber","hack","data","semiconductor","space","satellite"],    # 6: Technology
    ["bank","market","stocks","crypto","bond","rate","currency","liquidity"],   # 7: Finance
]

def compute_topic_vector(text: str) -> List[float]:
    """
    Compute a normalized 8-dimensional topic fingerprint.
    Each dimension scores 0-1 based on keyword density.
    No external ML dependencies — purely lexical.
    """
    tl = text.lower()
    words = re.findall(r'\b\w+\b', tl)
    n = max(len(words), 1)
    vec = []
    for dim_kws in _TOPIC_DIMS:
        hits = sum(1 for w in words if w in dim_kws)
        vec.append(round(min(1.0, hits / max(n * 0.05, 1)), 3))
    # L2-normalize
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 4) for v in vec]

def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Cosine similarity between two topic vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(y * y for y in b)) or 1e-9
    return dot / (na * nb)

# ════════════════════════════════════════════════════════
# 4. EVENT RELATIONSHIPS
# ════════════════════════════════════════════════════════

async def ai_event_relationships(
    event: Dict, candidate_events: List[Dict], top_k: int = 5
) -> List[Dict]:
    """
    Detect relationships between `event` and `candidate_events`.
    Returns list of: {target_id, rel_type, weight, confidence, reasoning}
    rel_type: 'causal' | 'correlated' | 'hierarchical' | 'temporal'

    Two-pass approach:
    1. Fast vector similarity filter (top_k candidates)
    2. AI refinement on top candidates
    """
    if not candidate_events:
        return []

    # Pass 1: topic vector similarity filter
    ev_vec_raw = event.get("topic_vector")
    if ev_vec_raw and isinstance(ev_vec_raw, str):
        try: ev_vec = json.loads(ev_vec_raw)
        except: ev_vec = compute_topic_vector(event.get("title","") + " " + (event.get("summary","") or ""))
    else:
        ev_vec = compute_topic_vector(event.get("title","") + " " + (event.get("summary","") or ""))

    scored = []
    for cand in candidate_events:
        if cand["id"] == event["id"]:
            continue
        cv_raw = cand.get("topic_vector")
        if cv_raw and isinstance(cv_raw, str):
            try: cv = json.loads(cv_raw)
            except: cv = compute_topic_vector(cand.get("title","") + " " + (cand.get("summary","") or ""))
        else:
            cv = compute_topic_vector(cand.get("title","") + " " + (cand.get("summary","") or ""))
        sim = cosine_similarity(ev_vec, cv)
        scored.append((sim, cand))

    scored.sort(key=lambda x: -x[0])
    top_candidates = [(sim, c) for sim, c in scored[:top_k] if sim > 0.25]

    if not top_candidates:
        return []

    # Pass 2: rule-based relationship detection (AI-augmented if available)
    relationships = []

    for sim, cand in top_candidates:
        # Time delta
        try:
            from datetime import datetime
            t1 = datetime.fromisoformat(event["timestamp"].replace("Z",""))
            t2 = datetime.fromisoformat(cand["timestamp"].replace("Z",""))
            hours_diff = abs((t1 - t2).total_seconds()) / 3600
        except Exception:
            hours_diff = 99

        # Rule-based type assignment
        same_country = event.get("country_code") == cand.get("country_code") and event.get("country_code") != "XX"
        same_cat = event.get("category") == cand.get("category")
        high_sev = cand.get("severity", 5) >= 6.5

        if same_country and same_cat and hours_diff < 48:
            rel_type, weight = "hierarchical", round(sim * 0.9, 3)
        elif same_country and hours_diff < 72 and high_sev:
            rel_type, weight = "causal", round(sim * 0.75, 3)
        elif sim > 0.6 and hours_diff < 120:
            rel_type, weight = "correlated", round(sim * 0.8, 3)
        elif hours_diff < 12 and same_cat:
            rel_type, weight = "temporal", round(sim * 0.65, 3)
        else:
            rel_type, weight = "correlated", round(sim * 0.5, 3)

        relationships.append({
            "target_id":  cand["id"],
            "target_title": cand.get("title","")[:60],
            "rel_type":   rel_type,
            "weight":     weight,
            "confidence": round(sim, 3),
            "hours_diff": round(hours_diff, 1),
        })

    # Optional AI refinement for top-3 highest-weight relationships
    if _ai_available() and len(relationships) >= 2:
        top3 = sorted(relationships, key=lambda x: -x["weight"])[:3]
        cand_text = "\n".join([
            f"- [{r['rel_type'].upper()}] {r['target_title']} (similarity={r['confidence']})"
            for r in top3
        ])
        prompt = (
            "Classify event relationships. Respond ONLY with JSON array.\n\n"
            "Source event: " + event.get("title","") + "\n\n"
            "Candidate relationships:\n" + cand_text + "\n\n"
            "For each, confirm or correct the relationship type and assign weight 0-1.\n"
            "Types: causal (A caused B), correlated (both caused by same factor), "
            "hierarchical (B is sub-event of A), temporal (just close in time)\n"
            '[{"target_title":"...","rel_type":"causal|correlated|hierarchical|temporal",'
            '"weight":0.8,"reasoning":"one sentence"}]'
        )
        ai_resp = await _call_claude(prompt, max_tokens=400)
        ai_rels = None
        if ai_resp:
            try:
                t = ai_resp.strip()
                if t.startswith("```"):
                    t = t.split("```")[1]
                    if t.startswith("json"): t = t[4:]
                ai_rels = json.loads(t.strip())
            except Exception:
                pass
        if ai_rels and isinstance(ai_rels, list):
            # Merge AI refinements back
            ai_map = {r.get("target_title","")[:30]: r for r in ai_rels}
            for rel in relationships:
                key = rel["target_title"][:30]
                if key in ai_map:
                    rel["rel_type"] = ai_map[key].get("rel_type", rel["rel_type"])
                    rel["weight"] = ai_map[key].get("weight", rel["weight"])
                    rel["reasoning"] = ai_map[key].get("reasoning","")

    return sorted(relationships, key=lambda x: -x["weight"])

# ════════════════════════════════════════════════════════
# 5. EVENT SCORING
# ════════════════════════════════════════════════════════

async def ai_score_event(title: str, description: str, category: str) -> Dict:
    """Score an event: impact, market effects, risk level, tags, investor action."""
    prompt = (
        "Score this global event. Respond ONLY with valid JSON, no markdown.\n\n"
        "Event: " + title + "\n"
        "Details: " + (description or "")[:400] + "\n"
        "Category: " + category + "\n\n"
        "Return:\n"
        '{"summary":"2-3 sentence analysis","impact_score":7.2,'
        '"market_effects":"which assets/sectors affected and how",'
        '"risk_level":"Low|Medium|High|Critical",'
        '"key_tags":["tag1","tag2","tag3"],'
        '"investor_action":"one sentence on what to watch"}'
    )
    text = await _call_claude(prompt, max_tokens=350)
    result = _parse_json(text)
    if result:
        return result
    return _fallback_score(title, description)

def _fallback_score(title: str, desc: str) -> Dict:
    from scrapers.events import classify, score_to_impact
    cat, score, _ = classify(title + " " + (desc or ""))
    return {
        "summary": (desc or title)[:200],
        "impact_score": score,
        "market_effects": _NO_AI_MSG,
        "risk_level": score_to_impact(score),
        "key_tags": [cat.lower()],
        "investor_action": "Monitor for developments",
    }

# ════════════════════════════════════════════════════════
# 6. QUANTITATIVE MARKET IMPACT MODEL
# ════════════════════════════════════════════════════════

# Factor-based impact mapping: category → (asset, asset_type, direction, base_magnitude)
_FACTOR_MAP: Dict[str, List[Tuple[str,str,float,float]]] = {
    "CONFLICT":    [("Oil (WTI)","commodity",+1,0.35),("Gold","commodity",+1,0.40),
                    ("Defense ETF","equity",+1,0.30),("S&P 500","index",-1,0.20),("USD Index","currency",+1,0.15)],
    "ECONOMICS":   [("S&P 500","index",-1,0.25),("USD Index","currency",+1,0.20),
                    ("10Y Treasury","bond",+1,0.30),("EUR/USD","fx",-1,0.20)],
    "FINANCE":     [("S&P 500","index",-1,0.35),("Banking ETF","equity",-1,0.40),
                    ("VIX","volatility",+1,0.50),("Gold","commodity",+1,0.20)],
    "ENERGY":      [("Oil (WTI)","commodity",+1,0.35),("Nat Gas","commodity",+1,0.25),
                    ("Energy ETF","equity",+1,0.20),("Airlines","equity",-1,0.25)],
    "GEOPOLITICS": [("Gold","commodity",+1,0.35),("Oil (WTI)","commodity",+1,0.25),
                    ("USD Index","currency",+1,0.20),("VIX","volatility",+1,0.40)],
    "DISASTER":    [("Reinsurance","equity",-1,0.30),("Construction ETF","equity",+1,0.25),
                    ("Food Commodities","commodity",+1,0.20)],
    "HEALTH":      [("Pharma ETF","equity",+1,0.40),("Airlines","equity",-1,0.45),
                    ("Healthcare ETF","equity",+1,0.30),("Tourism ETF","equity",-1,0.35)],
    "TECHNOLOGY":  [("Nasdaq","index",-1,0.25),("Tech ETF","equity",-1,0.30),
                    ("Semiconductor ETF","equity",-1,0.20)],
    "POLITICS":    [("Local Currency","fx",-1,0.30),("Gov Bonds","bond",-1,0.25),
                    ("EM Equity ETF","equity",-1,0.20)],
    "EARTHQUAKE":  [("Construction ETF","equity",+1,0.30),("Insurance ETF","equity",-1,0.30),
                    ("Gold","commodity",+1,0.15)],
    "SECURITY":    [("Defense ETF","equity",+1,0.35),("Gold","commodity",+1,0.25),
                    ("Oil (WTI)","commodity",+1,0.20)],
    "HUMANITARIAN":[("Food Commodities","commodity",+1,0.25),("Oil (WTI)","commodity",+1,0.15)],
}

# Historical analog templates
_ANALOGS: Dict[str, str] = {
    "CONFLICT":    "Similar to Gulf War (1990): oil +40%, gold +10%, S&P -15% over 6 months.",
    "ECONOMICS":   "Similar to 2008 GFC onset: bonds rallied, equities -30%, USD strengthened.",
    "FINANCE":     "Similar to SVB collapse (2023): banking ETF -25%, VIX +80% in 2 weeks.",
    "ENERGY":      "Similar to OPEC cut (2022): oil +20%, energy sector outperformed by 15%.",
    "GEOPOLITICS": "Similar to Russia-Ukraine (2022): gold +10%, oil +35%, EUR/USD -8%.",
    "DISASTER":    "Similar to Japan earthquake (2011): Nikkei -15%, JPY strengthened initially.",
    "HEALTH":      "Similar to COVID (2020): airlines -60%, pharma +20%, gold +25% over 6 months.",
    "TECHNOLOGY":  "Similar to AI regulation fears (2023): Nasdaq -8%, semiconductor ETF -12%.",
    "POLITICS":    "Similar to Brexit vote (2016): GBP -10%, FTSE outperformed on export revenue.",
    "EARTHQUAKE":  "Similar to Nepal earthquake (2015): construction ETF +5%, insurance -8%.",
    "SECURITY":    "Similar to 9/11 (2001): S&P -5% in week, defense +15%, aviation -40%.",
    "HUMANITARIAN":"Limited direct market impact; food commodity prices may see +5-10% spike.",
}

def _build_factor_impacts(category: str, severity: float) -> Tuple[List[Dict], List[Dict]]:
    """Build rule-based impact lists from factor map."""
    factors = _FACTOR_MAP.get(category, _FACTOR_MAP["GEOPOLITICS"])
    magnitude_base = min(10, max(1, round(severity * 1.05)))
    short_term, long_term = [], []
    for asset, atype, direction, base_mag in factors:
        dir_str = "positive" if direction > 0 else "negative"
        mag_s = min(10, max(1, round(magnitude_base * base_mag * 10)))
        mag_l = max(1, mag_s - 2)
        pct_s = round(base_mag * severity * 1.5, 1)
        pct_l = round(base_mag * severity * 0.8, 1)
        short_term.append({
            "instrument": asset, "type": atype, "direction": dir_str,
            "magnitude": mag_s, "estimate": f"{pct_s}% move expected",
            "timeframe": "1-7 days",
        })
        long_term.append({
            "instrument": asset, "type": atype, "direction": dir_str,
            "magnitude": mag_l, "estimate": f"{pct_l}% sustained move",
            "timeframe": "1-3 months",
        })
    return short_term, long_term

async def ai_show_impact(title: str, summary: str, category: str,
                          country: str, severity: float) -> Dict:
    """
    Quantitative market impact model.
    Factor-based baseline + AI refinement + historical analog.
    """
    short_term_base, long_term_base = _build_factor_impacts(category, severity)
    magnitude = min(10, max(1, round(severity * 1.1)))
    analog = _ANALOGS.get(category, "No direct historical analog available.")

    rule_result = {
        "short_term": short_term_base[:4],
        "long_term": long_term_base[:4],
        "overall_magnitude": magnitude,
        "magnitude_label": "High" if magnitude >= 7 else "Medium" if magnitude >= 4 else "Low",
        "key_insight": _NO_AI_MSG,
        "historical_precedent": analog,
        "fallback": True,
    }

    # ── Try full impact engine (FinBERT + NER + KG) ─────────────────────
    try:
        from config import settings as _s
        if getattr(_s, "enable_finbert", False) or getattr(_s, "enable_knowledge_graph", False):
            from analysis.impact_engine import compute_full_impact
            full = await compute_full_impact(
                title, summary, category, country, severity, "", None)
            if full and full.get("short_term"):
                logger.debug("Impact via full engine (FinBERT+KG+NER)")
                return full
    except Exception as _imp_e:
        logger.debug("Full impact engine fallthrough: %s", _imp_e)

    if not _ai_available():
        return rule_result

    # Pre-format factor baseline for AI context
    factor_context = ", ".join([
        f"{x['instrument']}({x['direction'][0].upper()}{x['magnitude']})"
        for x in short_term_base[:4]
    ])

    prompt = (
        "Refine this market impact analysis. Respond ONLY with valid JSON.\n\n"
        "Event: " + title + "\n"
        "Details: " + (summary or "")[:300] + "\n"
        "Category: " + category + ", Region: " + country + ", Severity: " + str(severity) + "/10\n"
        "Factor model baseline (instrument, direction, magnitude 1-10): " + factor_context + "\n\n"
        "Return exactly:\n"
        '{\n'
        '  "short_term": [{"instrument":"","type":"","direction":"positive|negative|neutral",'
        '"magnitude":7,"estimate":"","timeframe":"1-7 days","reasoning":""}],\n'
        '  "long_term":  [{"instrument":"","type":"","direction":"positive|negative|neutral",'
        '"magnitude":5,"estimate":"","timeframe":"1-3 months","reasoning":""}],\n'
        '  "overall_magnitude": 7,\n'
        '  "magnitude_label": "Low|Medium|High|Critical",\n'
        '  "key_insight": "2-sentence takeaway for investors",\n'
        '  "historical_precedent": "most relevant analog + outcome",\n'
        '  "probability_distribution": {"bullish":30,"base":50,"bearish":20}\n'
        '}\n'
        "2-4 instruments per timeframe. Be specific with % estimates."
    )
    text_resp = await _call_claude(prompt, max_tokens=800)
    result = _parse_json(text_resp)
    if result and "short_term" in result:
        result["fallback"] = False
        return result
    return rule_result

# ════════════════════════════════════════════════════════
# 7. REGIONAL RISK
# ════════════════════════════════════════════════════════

async def ai_regional_risk(country: str, recent_events: List[Dict]) -> Dict:
    if not recent_events:
        return {"risk_score": 5.0, "assessment": "Insufficient data.", "trend": "Stable", "drivers": []}
    avg = sum(e.get("severity", 5) for e in recent_events[:10]) / max(len(recent_events[:10]), 1)
    # Note: _call_claude calls _ensure_ai_settings internally,
    # so we skip the sync _ai_available() guard here.
    ev_text = "\n".join(["- " + e["title"] for e in recent_events[:8]])
    prompt = (
        "Assess geopolitical risk for " + country + " based on:\n" + ev_text + "\n\n"
        "Respond ONLY with JSON:\n"
        '{"risk_score":6.5,"assessment":"1-2 sentence assessment",'
        '"trend":"Increasing|Stable|Decreasing",'
        '"drivers":["driver1","driver2","driver3"]}'
    )
    result = _parse_json(await _call_claude(prompt, max_tokens=200))
    return result or {"risk_score": round(avg, 1), "assessment": "Data-based.", "trend": "Stable", "drivers": []}

# ════════════════════════════════════════════════════════
# 8. GENERAL Q&A, MACRO, WATCHLIST
# ════════════════════════════════════════════════════════

async def ai_answer(question: str, context: str = "") -> Optional[str]:
    system = (
        "You are a concise global intelligence analyst. Answer in 3-6 sentences. "
        "Be direct, analytical, and data-focused. Focus on geopolitical risks, "
        "market implications, and actionable insights."
    )
    full = (context + "\n\n" + question).strip() if context else question
    return await _call_claude(full, system=system, max_tokens=500)

async def ai_macro_briefing(indicators: List[Dict], events: List[Dict]) -> Optional[str]:
    ind_text = "\n".join([i["name"] + ": " + str(i["value"]) + " " + i["unit"] for i in indicators[:8]])
    ev_text  = "\n".join(["- " + e["title"] for e in events[:5]])
    prompt = (
        "Write a 4-sentence macro intelligence briefing for investors based on:\n\n"
        "Indicators:\n" + ind_text + "\n\nRecent Events:\n" + ev_text + "\n\n"
        "Cover: growth outlook, inflation/rates, key risks, one actionable insight."
    )
    return await _call_claude(prompt, max_tokens=300)

async def ai_watchlist_digest(items: List[Dict], events: List[Dict]) -> Optional[str]:
    watched  = [i.get("label") or i.get("value") for i in items[:10]]
    ev_text  = "\n".join(["- " + e["title"] + " (" + e.get("country_name","") + ")" for e in events[:10]])
    prompt = (
        "The user monitors: " + ", ".join(watched) + "\n\n"
        "Recent relevant events:\n" + ev_text + "\n\n"
        "Write a personalized 3-sentence intelligence digest highlighting "
        "what matters most to this user today."
    )
    return await _call_claude(prompt, max_tokens=250)
