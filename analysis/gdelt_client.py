"""
WorldLens — GDELT 2.0 Client
==============================
Pulls real-time global events from the GDELT Project (https://www.gdeltproject.org)
using their free REST APIs. No API key required.

APIs used:
  GDELT 2.0 Event API  — https://api.gdeltproject.org/api/v2/doc/doc
  GDELT GEO 2.0        — news by geography
  GDELT TV API         — TV broadcast news (bonus)

Event code taxonomy (CAMEO codes):
  https://parusanalytics.com/eventdata/cameo.dir/CAMEO.Manual.1.1b3.pdf
  Key groups: 01=Make Statement, 02=Appeal, 04=Consult, 10=Demand,
              12=Threaten, 13=Protest, 14=Exhibit Force, 18=Assault,
              19=Fight, 20=Use Unconventional Violence

Output events are normalised to the WorldLens event schema so they
flow seamlessly into the existing dedup + sentiment pipeline.
"""
from __future__ import annotations

import asyncio
import hashlib
import html
import json
import logging
import re
from datetime import datetime, timezone, timedelta
from typing import Dict, List, Optional

import httpx

logger = logging.getLogger(__name__)

# CAMEO event code → WorldLens category mapping
CAMEO_CATEGORY: Dict[str, str] = {
    "01": "POLITICS",    # Verbal cooperation / statements
    "02": "POLITICS",    # Appeals
    "03": "POLITICS",    # Intent to cooperate
    "04": "GEOPOLITICS", # Consultations
    "05": "ECONOMICS",   # Diplomatic cooperation
    "06": "ECONOMICS",   # Material cooperation
    "07": "ECONOMICS",   # Aid
    "08": "POLITICS",    # Yield
    "09": "POLITICS",    # Investigate
    "10": "POLITICS",    # Demand
    "11": "GEOPOLITICS", # Disapprove
    "12": "CONFLICT",    # Threaten
    "13": "POLITICS",    # Protest
    "14": "CONFLICT",    # Exhibit military posture
    "15": "CONFLICT",    # Coerce
    "16": "CONFLICT",    # Blockade / Sanction → remap below
    "17": "CONFLICT",    # Impose restrictions
    "18": "CONFLICT",    # Assault
    "19": "CONFLICT",    # Fight
    "20": "SECURITY",    # Mass violence / unconventional
}
# Specific CAMEO code → severity boost
CAMEO_SEVERITY: Dict[str, float] = {
    "12": 6.5,   # Threaten
    "13": 5.5,   # Protest
    "14": 7.0,   # Military force
    "15": 7.0,   # Coerce
    "16": 7.5,   # Blockade/sanction
    "17": 6.5,   # Impose restrictions
    "18": 8.0,   # Assault
    "19": 8.5,   # Fight
    "20": 9.0,   # Mass violence
}
# Goldstein scale (in GDELT) → WorldLens severity
def _goldstein_to_severity(gs: Optional[float]) -> float:
    """Goldstein scale is -10 (most conflictual) to +10 (most cooperative)."""
    if gs is None: return 5.0
    # Invert: high conflict (negative goldstein) → high severity
    sev = 5.0 + (-gs / 2.0)
    return round(max(1.0, min(10.0, sev)), 1)


def _avg_tone_to_sentiment(avg_tone: Optional[float]) -> float:
    """GDELT AvgTone: typically -100 (most negative) to +100 (most positive)."""
    if avg_tone is None: return 0.0
    return round(max(-1.0, min(1.0, avg_tone / 20.0)), 3)


def _clean(text: str) -> str:
    """Strip HTML, decode entities, normalise whitespace."""
    text = re.sub(r"<[^>]+>", " ", text or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()[:500]


class GDELTClient:
    """
    Async GDELT 2.0 API client.
    All methods return lists of normalised WorldLens event dicts.
    """

    BASE_GEO  = "https://api.gdeltproject.org/api/v2/geo/geo"
    BASE_DOC  = "https://api.gdeltproject.org/api/v2/doc/doc"
    BASE_TV   = "https://api.gdeltproject.org/api/v2/tv/tv"

    def __init__(self, timeout: float = 20.0):
        self.timeout = timeout

    # ── Internal helpers ──────────────────────────────────

    def _event_id(self, url_or_seed: str) -> str:
        return "gdelt:" + hashlib.md5(url_or_seed.encode("utf-8", errors="replace")).hexdigest()

    def _map_cameo(self, event_code: str) -> str:
        """Map CAMEO code prefix to WorldLens category."""
        prefix2 = event_code[:2] if event_code else ""
        prefix1 = event_code[:1] if event_code else ""
        return CAMEO_CATEGORY.get(prefix2) or CAMEO_CATEGORY.get(prefix1) or "GEOPOLITICS"

    def _normalise_doc_event(self, art: Dict, source_name: str = "GDELT") -> Optional[Dict]:
        """Convert a GDELT /doc article dict to WorldLens event schema."""
        try:
            url   = art.get("url", "")
            title = _clean(art.get("title") or art.get("seendate", ""))
            if not title or len(title) < 8:
                return None

            # Timestamp
            seen = art.get("seendate", "")
            try:
                ts = datetime.strptime(seen, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
            except Exception:
                ts = datetime.utcnow().isoformat()

            # Tone → sentiment proxy
            tone    = art.get("tone", "")
            avg_tone: Optional[float] = None
            if tone:
                try:   avg_tone = float(tone.split(",")[0])
                except: pass

            # Category from domain / source name (crude but fast)
            domain  = art.get("domain", "").lower()
            if any(w in domain for w in ["finance", "bloomberg", "reuters", "wsj", "ft"]):
                category = "FINANCE"
            elif any(w in domain for w in ["bbc", "aljazeera", "guardian", "ap", "cnn"]):
                category = "GEOPOLITICS"
            else:
                category = "GEOPOLITICS"

            geo_country = art.get("socialimage", "")  # GDELT doc has limited geo
            language    = art.get("language", "English")

            return {
                "id":           self._event_id(url or title),
                "timestamp":    ts,
                "title":        title[:200],
                "summary":      _clean(art.get("socialimage_description") or title)[:300],
                "category":     category,
                "source":       art.get("sourcecountry") or source_name,
                "source_url":   url,
                "latitude":     0.0,
                "longitude":    0.0,
                "country_code": "XX",
                "country_name": art.get("sourcecountry", "Global"),
                "severity":     5.0,
                "impact":       "Medium",
                "url":          url,
                "ai_impact_score": 5.0,
                "related_markets": [],
                "sent_market_stress": 0.0,
                "sentiment_score": _avg_tone_to_sentiment(avg_tone),
                "gdelt_tone":   avg_tone,
                "gdelt_domain": domain,
                "gdelt_lang":   language,
                "_gdelt":       True,
            }
        except Exception as e:
            logger.debug("GDELT doc normalise error: %s", e)
            return None

    def _normalise_geo_event(self, art: Dict) -> Optional[Dict]:
        """Convert GDELT GEO article result to WorldLens event schema."""
        try:
            url    = art.get("htmlurl") or art.get("url", "")
            title  = _clean(art.get("title", ""))
            if not title: return None

            seendate = art.get("seendate", "")
            try:
                ts = datetime.strptime(seendate, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc).isoformat()
            except Exception:
                ts = datetime.utcnow().isoformat()

            lat = float(art.get("lat", 0) or 0)
            lon = float(art.get("long", 0) or 0)

            tone     = art.get("tone", "")
            avg_tone: Optional[float] = None
            if tone:
                try: avg_tone = float(tone.split(",")[0])
                except: pass

            from geocoder import find_country, get_name
            country_name = art.get("country", "")
            country_code = find_country(country_name + " " + title) if country_name else "XX"

            return {
                "id":           self._event_id(url or title),
                "timestamp":    ts,
                "title":        title[:200],
                "summary":      _clean(art.get("snippet", title))[:300],
                "category":     "GEOPOLITICS",
                "source":       art.get("domain", "GDELT GEO"),
                "source_url":   url,
                "latitude":     lat,
                "longitude":    lon,
                "country_code": country_code,
                "country_name": country_name or get_name(country_code),
                "severity":     5.0,
                "impact":       "Medium",
                "url":          url,
                "ai_impact_score": 5.0,
                "related_markets": [],
                "sent_market_stress": 0.0,
                "sentiment_score": _avg_tone_to_sentiment(avg_tone),
                "gdelt_tone":   avg_tone,
                "_gdelt":       True,
            }
        except Exception as e:
            logger.debug("GDELT geo normalise error: %s", e)
            return None

    # ── Public fetch methods ──────────────────────────────

    async def fetch_breaking_news(
        self,
        query: str = "crisis OR war OR sanctions OR recession OR earthquake",
        max_records: int = 30,
        timespan: str = "6h",     # GDELT timespan: 15min, 1h, 6h, 1d, 7d
    ) -> List[Dict]:
        """
        Fetch breaking news articles matching a query via GDELT /doc API.
        Returns normalised WorldLens events.
        """
        params = {
            "query":      query,
            "mode":       "artlist",
            "maxrecords": max_records,
            "timespan":   timespan,
            "format":     "json",
            "sort":       "DateDesc",
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.get(self.BASE_DOC, params=params,
                                     headers={"User-Agent": "WorldLens/3.0"})
                r.raise_for_status()
                data  = r.json()
                arts  = data.get("articles", [])
                events = [self._normalise_doc_event(a) for a in arts]
                result = [e for e in events if e]
                logger.info("GDELT doc query '%s': %d articles → %d events", query, len(arts), len(result))
                return result
        except Exception as e:
            logger.warning("GDELT /doc error: %s", e)
            return []

    async def fetch_geo_events(
        self,
        country_or_query: str,
        timespan: str = "6h",
        max_records: int = 25,
    ) -> List[Dict]:
        """
        Fetch geographically tagged news via GDELT /geo API.
        `country_or_query`: country name or search query.
        """
        params = {
            "query":      country_or_query,
            "mode":       "artlist",
            "maxrecords": max_records,
            "timespan":   timespan,
            "format":     "json",
            "sort":       "DateDesc",
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                r = await client.get(self.BASE_GEO, params=params,
                                     headers={"User-Agent": "WorldLens/3.0"})
                r.raise_for_status()
                data   = r.json()
                arts   = data.get("articles", [])
                events = [self._normalise_geo_event(a) for a in arts]
                result = [e for e in events if e]
                logger.info("GDELT geo '%s': %d → %d events", country_or_query, len(arts), len(result))
                return result
        except Exception as e:
            logger.warning("GDELT /geo error: %s", e)
            return []

    async def fetch_financial_news(self, timespan: str = "6h") -> List[Dict]:
        """Pull financial/market specific news from GDELT."""
        return await self.fetch_breaking_news(
            query=(
                "Fed OR ECB OR \"interest rate\" OR inflation OR recession "
                "OR oil OR gold OR bitcoin OR \"stock market\" OR IPO "
                "OR sanctions OR tariff OR \"trade war\""
            ),
            max_records=30,
            timespan=timespan,
        )

    async def fetch_conflict_events(self, timespan: str = "6h") -> List[Dict]:
        """Pull conflict and security events from GDELT."""
        return await self.fetch_breaking_news(
            query=(
                "war OR airstrike OR shelling OR ceasefire OR troops "
                "OR military OR attack OR missile OR coup OR protest OR riot"
            ),
            max_records=25,
            timespan=timespan,
        )

    async def fetch_multi_theme(
        self,
        themes: List[str],
        timespan: str = "6h",
        max_per_theme: int = 15,
    ) -> List[Dict]:
        """Fetch multiple themes in parallel."""
        tasks = [
            self.fetch_breaking_news(theme, max_per_theme, timespan)
            for theme in themes
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        events: List[Dict] = []
        seen_ids: set = set()
        for res in results:
            if isinstance(res, list):
                for ev in res:
                    if ev["id"] not in seen_ids:
                        seen_ids.add(ev["id"])
                        events.append(ev)
        return events

    async def fetch_all(self, timespan: str = "6h") -> List[Dict]:
        """
        Master fetch: pulls financial + conflict + general breaking news in parallel.
        Deduplicates by event ID.
        Returns up to ~100 normalised events per call.
        """
        themes = [
            "crisis OR war OR sanctions OR earthquake OR disaster",
            "economy OR GDP OR inflation OR \"central bank\" OR recession",
            "elections OR coup OR protest OR \"political crisis\"",
            "oil OR energy OR OPEC OR gas OR pipeline",
        ]
        fin_task    = self.fetch_financial_news(timespan)
        conf_task   = self.fetch_conflict_events(timespan)
        theme_tasks = [self.fetch_breaking_news(t, 20, timespan) for t in themes[:2]]

        all_results = await asyncio.gather(fin_task, conf_task, *theme_tasks,
                                           return_exceptions=True)

        seen_ids: set = set()
        events: List[Dict] = []
        for res in all_results:
            if isinstance(res, list):
                for ev in res:
                    if ev["id"] not in seen_ids:
                        seen_ids.add(ev["id"])
                        events.append(ev)

        logger.info("GDELT fetch_all: %d unique events", len(events))
        return events


# ── Singleton client ──────────────────────────────────────
_gdelt = GDELTClient()

async def gdelt_fetch_all(timespan: str = "6h") -> List[Dict]:
    return await _gdelt.fetch_all(timespan)

async def gdelt_fetch_breaking(query: str, timespan: str = "6h") -> List[Dict]:
    return await _gdelt.fetch_breaking_news(query, timespan=timespan)

async def gdelt_fetch_geo(country: str, timespan: str = "6h") -> List[Dict]:
    return await _gdelt.fetch_geo_events(country, timespan=timespan)
