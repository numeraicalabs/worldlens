"""World Lens — Multi-source event scraper v3

Pipeline:
  1. Ingest  — 25 RSS feeds + USGS earthquakes + NASA EONET
  2. Parse   — robust XML/Atom parser with CDATA, encoding normalisation
  3. Classify — scored multi-label classifier (not first-match); picks best score
  4. Geolocate — two-pass: keyword map (300+ entries) + country-name regex scan
  5. Dedup  — MD5 exact + Jaccard title similarity (threshold 0.55, same-country guard)
  6. Enrich — topic_vector, source_credibility, severity noise
  7. Return  — clean list for scheduler to persist
"""
from __future__ import annotations

import hashlib
import html
import logging
import math
import random
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Dict, List, Optional, Tuple

import httpx

from geocoder import COUNTRIES, COUNTRY_NAMES, find_country, get_coords, get_name

logger = logging.getLogger(__name__)

# ══════════════════════════════════════════════════════════
# 1. RSS SOURCE LIST  (25 feeds)
# ══════════════════════════════════════════════════════════

RSS_SOURCES: List[Tuple[str, str, float]] = [
    # (name, url, credibility 0-1)
    # ── Global news ──────────────────────────────────────────────
    ("BBC World",        "https://feeds.bbci.co.uk/news/world/rss.xml",                0.93),
    ("BBC Business",     "https://feeds.bbci.co.uk/news/business/rss.xml",             0.93),
    ("Reuters World",    "https://feeds.reuters.com/Reuters/worldNews",                 0.95),
    ("Reuters Business", "https://feeds.reuters.com/reuters/businessNews",             0.95),
    ("AP News",          "https://rsshub.app/apnews/topics/world-news",                0.93),
    ("Al Jazeera",       "https://www.aljazeera.com/xml/rss/all.xml",                  0.87),
    ("UN News",          "https://news.un.org/feed/subscribe/en/news/all/rss.xml",     0.92),
    ("France24",         "https://www.france24.com/en/rss",                             0.88),
    ("DW World",         "https://rss.dw.com/xml/rss-en-world",                        0.88),
    ("Euronews",         "https://www.euronews.com/rss?level=theme&name=news",          0.85),
    ("The Guardian",     "https://www.theguardian.com/world/rss",                       0.88),
    ("Guardian Business","https://www.theguardian.com/business/rss",                   0.88),
    ("NPR World",        "https://feeds.npr.org/1004/rss.xml",                         0.89),
    ("VOA News",         "https://www.voanews.com/api/zmgqpemkqv",                     0.82),
    ("NHK World",        "https://www3.nhk.or.jp/nhkworld/en/news/feeds/",             0.87),
    ("Times of India",   "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", 0.80),
    ("South China MP",   "https://www.scmp.com/rss/4/feed",                             0.82),
    ("Aljazeera Econ",   "https://www.aljazeera.com/xml/rss/economy.xml",              0.87),
    ("USAID",            "https://www.usaid.gov/rss/news",                              0.85),
    ("ReliefWeb",        "https://reliefweb.int/updates/rss.xml",                       0.90),
    ("Climate Home",     "https://www.climatechangenews.com/feed/",                     0.82),
    ("TechCrunch",       "https://techcrunch.com/feed/",                                0.82),
    # ── Financial & Macro (high priority) ───────────────────────
    ("FT Headlines",     "https://www.ft.com/?format=rss",                              0.92),
    ("Bloomberg Mkts",   "https://feeds.bloomberg.com/markets/news.rss",                0.92),
    ("Bloomberg Econ",   "https://feeds.bloomberg.com/economics/news.rss",              0.92),
    ("CNBC World",       "https://www.cnbc.com/id/100727362/device/rss/rss.html",      0.87),
    ("CNBC Finance",     "https://www.cnbc.com/id/10000664/device/rss/rss.html",       0.87),
    ("MarketWatch",      "https://feeds.content.dowjones.io/public/rss/mw_topstories", 0.88),
    ("Investing.com",    "https://www.investing.com/rss/news.rss",                      0.82),
    ("Seeking Alpha",    "https://seekingalpha.com/market_currents.xml",                0.78),
    ("Yahoo Finance",    "https://finance.yahoo.com/news/rssindex",                     0.82),
    # ── Central banks & official institutions ───────────────────
    ("ECB Press",        "https://www.ecb.europa.eu/rss/press.html",                    0.99),
    ("IMF News",         "https://www.imf.org/en/News/rss?language=eng",                0.99),
    ("World Bank",       "https://www.worldbank.org/en/news/rss",                       0.97),
    ("BIS",              "https://www.bis.org/doclist/all_speeches.rss",                0.97),
    ("OECD",             "https://www.oecd.org/newsroom/news.rss",                      0.96),
    # ── Commodity & energy ──────────────────────────────────────
    ("OilPrice",         "https://oilprice.com/rss/main",                               0.80),
    ("Platts Energy",    "https://www.spglobal.com/commodityinsights/en/rss-feed/oil",  0.88),
]

SOURCE_CREDIBILITY: Dict[str, float] = {
    name: cred for name, _, cred in RSS_SOURCES
}
SOURCE_CREDIBILITY.update({"USGS": 0.99, "NASA EONET": 0.99})

# ══════════════════════════════════════════════════════════
# 2. MULTI-LABEL CLASSIFIER
#    Each rule: (keywords, category, base_score, weight)
#    Weight used to break ties.  ALL matching rules are scored;
#    the highest weighted score wins.
# ══════════════════════════════════════════════════════════

CLASSIFY_RULES: List[Tuple[List[str], str, float, float]] = [
    # High-specificity rules first (higher weight = stronger signal)
    (["earthquake","seismic","tremor","magnitude","richter","aftershock"],
     "EARTHQUAKE", 8.0, 10),
    (["hurricane","typhoon","cyclone","tsunami","volcano","wildfire","flood","drought","landslide"],
     "DISASTER", 7.0, 9),
    (["pandemic","epidemic","outbreak","virus","covid","mpox","cholera","ebola","vaccine","who","pathogen"],
     "HEALTH", 6.5, 8),
    (["terrorism","terrorist","suicide bomb","car bomb","jihadist","al-qaeda","isis","isil","daesh","extremist attack"],
     "SECURITY", 8.5, 9),
    (["humanitarian","refugees","famine","displaced","internally displaced","aid workers","unicef","unhcr","food insecurity","starvation"],
     "HUMANITARIAN", 7.5, 8),
    (["nuclear","missile test","nato","alliance","treaty","diplomacy","summit","sanctions regime","geopolit"],
     "GEOPOLITICS", 7.0, 7),
    # CONFLICT only on explicit combat language — NOT generic "attack"
    (["airstrike","airstrikes","shelling","frontline","offensive operations","troops advance",
      "ground assault","military offensive","ceasefire","warzone","combat operation",
      "rocket attack","missile strike","drone attack","naval blockade","troops killed",
      "military operation","armed attack","mortar","artillery fire"],
     "CONFLICT", 8.0, 9),
    (["recession","gdp","inflation rate","interest rate","imf","world bank","fiscal","monetary policy",
      "trade deficit","tariff","trade war","economic growth","unemployment rate","cpi","pmi","gdp growth",
      "rate hike","rate cut","quantitative easing","ecb","federal reserve","central bank decision",
      "current account","balance of payments","debt ceiling","sovereign debt","yield curve",
      "stagflation","deflation","purchasing managers",
      "consumer prices","producer prices","core inflation","headline inflation",
      "jobs report","nonfarm payrolls","jobless claims","retail sales","industrial output",
      "manufacturing index","services index","business confidence","consumer confidence",
      "trade balance","exports","imports","sanctions","supply chain","cost of living",
      "housing market","real estate prices","mortgage rates","economic outlook","gdp forecast",
      "imf forecast","oecd forecast","growth forecast","austerity","stimulus package",
      "fiscal deficit","budget deficit","national debt","debt-to-gdp"],
     "ECONOMICS", 7.0, 9),
    (["stock market","nasdaq","dow jones","s&p 500","earnings","ipo","central bank","fed rate",
      "bond yield","cryptocurrency","bitcoin","hedge fund","private equity","market rally",
      "market crash","equity markets","credit markets","spread","volatility","vix","options",
      "futures","commodities","forex","currency","exchange rate","capital markets",
      "investment bank","asset management","etf","fund flows",
      "rate decision","rate hike","rate cut","basis points","bps",
      "ecb decision","fed decision","fomc","rba","boe","boj","pboc",
      "treasury","gilt","bund","yield","coupon","credit rating","moody","fitch","s&p rating",
      "ipo pricing","stock surge","stock plunge","market open","wall street",
      "earnings beat","earnings miss","revenue","profit warning","dividend"],
     "FINANCE", 6.5, 9),
    (["election","coup","parliament","referendum","prime minister sworn","president elect",
      "political crisis","government collapse","political deadlock","legislative vote",
      "ballot","polling station","political party","cabinet reshuffle"],
     "POLITICS", 5.0, 6),
    (["oil price","natural gas","opec","pipeline","lng","energy crisis","power outage",
      "renewable energy","solar","wind farm","carbon emissions","climate",
      "brent crude","wti","energy prices","gas prices","oil market","oil supply",
      "energy transition","power grid","electricity prices"],
     "ENERGY", 6.5, 8),
    (["artificial intelligence","machine learning","cybersecurity","data breach","hack",
      "semiconductor","chip shortage","spacex","nasa launch","quantum","5g","tech giant"],
     "TECHNOLOGY", 4.5, 6),
]

RELATED_MARKETS: Dict[str, List[str]] = {
    "CONFLICT":     ["Oil", "Gold", "Defense ETF", "VIX"],
    "ECONOMICS":    ["S&P 500", "EUR/USD", "Bonds", "USD Index", "Gold"],
    "FINANCE":      ["S&P 500", "Nasdaq", "Bitcoin", "VIX", "Credit Spreads"],
    "ENERGY":       ["Oil", "Natural Gas", "Clean Energy ETF", "XLE"],
    "GEOPOLITICS":  ["Gold", "Oil", "USD Index", "VIX"],
    "DISASTER":     ["Reinsurance", "Commodities", "Agriculture ETF"],
    "HEALTH":       ["Healthcare ETF", "Pharma", "Biotech ETF"],
    "TECHNOLOGY":   ["Nasdaq", "Tech ETF", "Semiconductors", "Bitcoin"],
    "POLITICS":     ["Local Currency", "Government Bonds", "CDS"],
    "EARTHQUAKE":   ["Reinsurance", "Construction ETF", "JPY"],
    "SECURITY":     ["Defense ETF", "Gold", "Oil"],
    "HUMANITARIAN": ["Food Commodities", "Agriculture ETF"],
}


def classify(text: str) -> Tuple[str, float, List[str]]:
    """
    Multi-label scorer: evaluate ALL rules, pick the one with the
    highest (hit_count * weight * base_score) composite.
    Falls back to GEOPOLITICS only if nothing matches.
    """
    tl = text.lower()
    best_cat   = "GEOPOLITICS"
    best_score = round(random.uniform(3.5, 5.5), 1)
    best_comp  = 0.0

    for keywords, cat, base_score, weight in CLASSIFY_RULES:
        hits = sum(1 for kw in keywords if kw in tl)
        if hits == 0:
            continue
        composite = hits * weight * base_score
        if composite > best_comp:
            best_comp  = composite
            best_cat   = cat
            # Scale severity: more hits → slightly higher score, capped at 10
            raw_score  = base_score + math.log1p(hits) * 0.4 + random.uniform(-0.4, 0.4)
            best_score = round(min(10.0, max(1.0, raw_score)), 1)

    return best_cat, best_score, RELATED_MARKETS.get(best_cat, [])


def score_to_impact(score: float) -> str:
    if score >= 7.0: return "High"
    if score >= 4.0: return "Medium"
    return "Low"


# ══════════════════════════════════════════════════════════
# 3. ENHANCED GEOCODER  (extended keyword map)
# ══════════════════════════════════════════════════════════

# Aliases + demonyms + city→country mappings
_GEO_ALIASES: Dict[str, str] = {
    # Aliases / common misspellings
    "america": "US", "u.s.": "US", "u.s.a.": "US", "the us ": "US",
    "britain": "GB", "u.k.": "GB", "england": "GB", "scotland": "GB", "wales": "GB",
    "north korea": "KP", "south korea": "KR", "dprk": "KP",
    "czech republic": "CZ", "czechia": "CZ",
    "taiwan strait": "TW", "taiwanese": "TW",
    "dr congo": "CD", "drc": "CD", "democratic republic of congo": "CD",
    "west bank": "PS", "gaza": "PS", "palestinian": "PS",
    "houthi": "YE", "houthis": "YE",
    "russian": "RU", "kremlin": "RU", "moscow": "RU",
    "ukrainian": "UA", "kyiv": "UA", "kiev": "UA",
    "chinese": "CN", "beijing": "CN", "shanghai": "CN",
    "iranian": "IR", "tehran": "IR",
    "israeli": "IL", "tel aviv": "IL", "jerusalem": "IL",
    "turkish": "TR", "ankara": "TR", "istanbul": "TR",
    "saudi": "SA", "riyadh": "SA",
    "emirati": "AE", "dubai": "AE", "abu dhabi": "AE",
    "qatari": "QA", "doha": "QA",
    "afghan": "AF", "kabul": "AF",
    "pakistani": "PK", "islamabad": "PK", "karachi": "PK",
    "indian": "IN", "delhi": "IN", "mumbai": "IN", "new delhi": "IN",
    "bangladeshi": "BD", "dhaka": "BD",
    "myanmar": "MM", "burmese": "MM", "rangoon": "MM", "yangon": "MM",
    "thai": "TH", "bangkok": "TH",
    "vietnamese": "VN", "hanoi": "VN", "ho chi minh": "VN",
    "philippine": "PH", "manila": "PH",
    "indonesian": "ID", "jakarta": "ID",
    "malaysian": "MY", "kuala lumpur": "MY",
    "nigerian": "NG", "abuja": "NG", "lagos": "NG",
    "kenyan": "KE", "nairobi": "KE",
    "ethiopian": "ET", "addis ababa": "ET",
    "somali": "SO", "mogadishu": "SO",
    "sudanese": "SD", "khartoum": "SD",
    "south sudanese": "SS", "juba": "SS",
    "libyan": "LY", "tripoli": "LY",
    "syrian": "SY", "damascus": "SY",
    "iraqi": "IQ", "baghdad": "IQ",
    "lebanese": "LB", "beirut": "LB",
    "yemeni": "YE", "sanaa": "YE", "aden": "YE",
    "egyptian": "EG", "cairo": "EG",
    "moroccan": "MA", "rabat": "MA", "casablanca": "MA",
    "algerian": "DZ", "algiers": "DZ",
    "tunisian": "TN", "tunis": "TN",
    "haitian": "HT", "port-au-prince": "HT",
    "venezuelan": "VE", "caracas": "VE",
    "colombian": "CO", "bogota": "CO",
    "mexican": "MX", "mexico city": "MX",
    "brazilian": "BR", "brasilia": "BR", "sao paulo": "BR",
    "argentine": "AR", "buenos aires": "AR",
    "chilean": "CL", "santiago": "CL",
    "peruvian": "PE", "lima": "PE",
    "french": "FR", "paris": "FR",
    "german": "DE", "berlin": "DE",
    "italian": "IT", "rome": "IT",
    "spanish": "ES", "madrid": "ES",
    "polish": "PL", "warsaw": "PL",
    "dutch": "NL", "amsterdam": "NL",
    "belgian": "BE", "brussels": "BE",
    "greek": "GR", "athens": "GR",
    "swedish": "SE", "stockholm": "SE",
    "japanese": "JP", "tokyo": "JP", "osaka": "JP",
    "korean": "KR", "seoul": "KR",
    "australian": "AU", "sydney": "AU", "canberra": "AU",
    "canadian": "CA", "ottawa": "CA", "toronto": "CA",
    "south african": "ZA", "cape town": "ZA", "johannesburg": "ZA",
    "zimbabwean": "ZW", "harare": "ZW",
    "zambian": "ZM", "lusaka": "ZM",
    "malian": "ML", "bamako": "ML",
    "burkina": "BF", "ouagadougou": "BF",
    "nigerien": "NE", "niamey": "NE",
    "cameroonian": "CM", "yaounde": "CM",
    "congolese": "CD", "kinshasa": "CD",
    "rwandan": "RW", "kigali": "RW",
    "ugandan": "UG", "kampala": "UG",
    "tanzanian": "TZ", "dar es salaam": "TZ",
    "mozambican": "MZ", "maputo": "MZ",
    "angolan": "AO", "luanda": "AO",
    "senegalese": "SN", "dakar": "SN",
    "ghanaian": "GH", "accra": "GH",
    "ivorian": "CI", "abidjan": "CI", "ivory coast": "CI",
    "kazakh": "KZ", "nur-sultan": "KZ", "astana": "KZ",
    "uzbek": "UZ", "tashkent": "UZ",
    "azeri": "AZ", "baku": "AZ",
    "armenian": "AM", "yerevan": "AM",
    "georgian": "GE", "tbilisi": "GE",
    "serbian": "RS", "belgrade": "RS",
    "bosnian": "BA", "sarajevo": "BA",
    "hungarian": "HU", "budapest": "HU",
    "romanian": "RO", "bucharest": "RO",
    "bulgarian": "BG", "sofia": "BG",
    "moldovan": "MD", "chisinau": "MD",
    "belarusian": "BY", "minsk": "BY",
    "latvian": "LV", "riga": "LV",
    "lithuanian": "LT", "vilnius": "LT",
    "estonian": "EE", "tallinn": "EE",
    "finnish": "FI", "helsinki": "FI",
    "norwegian": "NO", "oslo": "NO",
    "danish": "DK", "copenhagen": "DK",
    "swiss": "CH", "bern": "CH", "geneva": "CH", "zurich": "CH",
    "austrian": "AT", "vienna": "AT",
    "portuguese": "PT", "lisbon": "PT",
    "irish": "IE", "dublin": "IE",
    "sri lankan": "LK", "colombo": "LK",
    "nepalese": "NP", "kathmandu": "NP",
    "jordanian": "JO", "amman": "JO",
    "kuwaiti": "KW", "kuwait city": "KW",
    "bahraini": "BH", "manama": "BH",
    "omani": "OM", "muscat": "OM",
    "new zealand": "NZ", "wellington": "NZ", "auckland": "NZ",
    "singaporean": "SG", "singapore": "SG",
    "taiwan": "TW", "taipei": "TW",
    "hong kong": "HK",
    "cambodian": "KH", "phnom penh": "KH",
    "laotian": "LA", "lao": "LA", "vientiane": "LA",
    "mongolian": "MN", "ulaanbaatar": "MN",
    # Regions / zones that map to dominant country
    "red sea": "YE", "strait of hormuz": "IR", "taiwan strait": "TW",
    "donbas": "UA", "crimea": "UA", "zaporizhzhia": "UA",
    "sahel": "ML",  "west africa": "NG", "horn of africa": "ET",
}


def find_country_enhanced(text: str) -> str:
    """
    Two-pass geo extraction:
    1. Alias/demonym map (longest match first)
    2. COUNTRY_NAMES dict from geocoder
    Returns ISO-2 code or 'XX'.
    """
    tl = " " + text.lower() + " "

    # Pass 1: sorted by length desc to prefer longer (more specific) matches
    for kw in sorted(_GEO_ALIASES, key=len, reverse=True):
        if kw in tl:
            return _GEO_ALIASES[kw]

    # Pass 2: country names from geocoder COUNTRIES dict
    for name_lower, code in sorted(COUNTRY_NAMES.items(), key=lambda x: -len(x[0])):
        if name_lower in tl:
            return code

    return "XX"


# ══════════════════════════════════════════════════════════
# 4. TOPIC VECTOR  (8-dim, must match ai_layer.py)
# ══════════════════════════════════════════════════════════

_TOPIC_DIMS: List[List[str]] = [
    ["war", "conflict", "military", "attack", "troops", "battle", "airstrike"],
    ["sanction", "trade", "tariff", "gdp", "recession", "inflation", "fed", "rate"],
    ["election", "coup", "president", "parliament", "vote", "government", "protest"],
    ["oil", "gas", "energy", "opec", "pipeline", "nuclear", "power"],
    ["earthquake", "flood", "hurricane", "disaster", "climate", "wildfire", "storm"],
    ["pandemic", "virus", "vaccine", "who", "outbreak", "disease", "health"],
    ["tech", "ai", "cyber", "hack", "data", "semiconductor", "space", "satellite"],
    ["bank", "market", "stocks", "crypto", "bond", "rate", "currency", "liquidity"],
]


def _topic_vector(text: str) -> List[float]:
    words = re.findall(r"\b\w+\b", text.lower())
    n = max(len(words), 1)
    vec = [min(1.0, sum(1 for w in words if w in dim) / max(n * 0.05, 1))
           for dim in _TOPIC_DIMS]
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [round(v / norm, 4) for v in vec]


# ══════════════════════════════════════════════════════════
# 5. RSS PARSER  (robust: handles CDATA, Atom, RSS 1/2)
# ══════════════════════════════════════════════════════════

def _clean_html(text: str) -> str:
    """Strip HTML tags and decode entities."""
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def parse_rss_xml(xml: str) -> List[Dict]:
    """Parse RSS/Atom feed XML into list of raw item dicts."""
    items: List[Dict] = []
    # Match both <item> (RSS) and <entry> (Atom)
    for m in re.finditer(r"<(?:item|entry)\b[^>]*>(.*?)</(?:item|entry)>",
                         xml, re.DOTALL | re.IGNORECASE):
        block = m.group(1)
        item: Dict = {}

        def _extract(tag: str) -> Optional[str]:
            """Extract text from tag, handling CDATA and HTML."""
            pat = re.compile(
                r"<" + tag + r"(?:\s[^>]*)?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</" + tag + r">",
                re.DOTALL | re.IGNORECASE,
            )
            match = pat.search(block)
            if match:
                return _clean_html(match.group(1))
            return None

        for field in ["title", "description", "summary", "content", "pubDate",
                      "published", "updated", "dc:date"]:
            val = _extract(field)
            if val:
                item[field] = val

        # Link extraction — handle both <link>url</link> and <link href="url"/>
        link_match = (
            re.search(r"<link[^>]+href=[\"']([^\"']+)[\"']", block)
            or re.search(r"<link[^>]*>(https?://[^<]+)</link>", block, re.IGNORECASE)
        )
        if link_match:
            item["link"] = link_match.group(1).strip()

        # Only keep items that have at least a title
        if item.get("title") and len(item["title"]) > 3:
            items.append(item)

    return items


# ══════════════════════════════════════════════════════════
# 6. EVENT BUILDERS
# ══════════════════════════════════════════════════════════

def _parse_timestamp(item: Dict) -> str:
    """Try several date fields and return ISO timestamp."""
    for field in ["pubDate", "published", "updated", "dc:date"]:
        raw = item.get(field, "")
        if not raw:
            continue
        try:
            return parsedate_to_datetime(raw).replace(tzinfo=None).isoformat()
        except Exception:
            pass
        try:
            return datetime.fromisoformat(raw.replace("Z", "")).isoformat()
        except Exception:
            pass
    return datetime.utcnow().isoformat()


def build_event(item: Dict, source: str, credibility: float = 0.80) -> Optional[Dict]:
    try:
        title = (item.get("title") or "").strip()[:200]
        if not title or len(title) < 5:
            return None

        # Best available description
        desc = (
            item.get("description")
            or item.get("summary")
            or item.get("content")
            or ""
        )[:500]

        url = (item.get("link") or "").strip()
        ts  = _parse_timestamp(item)

        full_text = f"{title} {desc}"
        category, score, markets = classify(full_text)
        cc  = find_country_enhanced(full_text)
        lat, lon = get_coords(cc)

        # Add small geographic jitter to avoid all events piling on country centroid
        if cc != "XX":
            lat += random.uniform(-1.5, 1.5)
            lon += random.uniform(-1.5, 1.5)

        score = round(max(1.0, min(10.0, score + random.uniform(-0.2, 0.2))), 1)

        # Stable event ID: source + URL (or title if no URL)
        id_seed = f"rss:{source}:{url or title}"
        event_id = hashlib.md5(id_seed.encode("utf-8", errors="replace")).hexdigest()

        return {
            "id":               event_id,
            "timestamp":        ts,
            "title":            title,
            "summary":          desc[:300],
            "category":         category,
            "source":           source,
            "latitude":         round(lat, 4),
            "longitude":        round(lon, 4),
            "country_code":     cc,
            "country_name":     get_name(cc) if cc != "XX" else "Global",
            "severity":         score,
            "impact":           score_to_impact(score),
            "url":              url,
            "ai_impact_score":  score,
            "related_markets":  markets,
            "topic_vector":     _topic_vector(full_text),
            "source_count":     1,
            "source_list":      [source],
            "sent_credibility": credibility,
        }
    except Exception as e:
        logger.debug("build_event error (%s): %s", source, e)
        return None


def build_usgs_event(f: Dict) -> Optional[Dict]:
    try:
        p      = f.get("properties", {})
        coords = f.get("geometry", {}).get("coordinates", [0, 0, 0])
        mag    = float(p.get("mag") or 0)
        if mag < 4.5:
            return None
        lon, lat = float(coords[0]), float(coords[1])
        place    = p.get("place", "Unknown")
        ts       = datetime.utcfromtimestamp((p.get("time") or 0) / 1000).isoformat()
        score    = round(min(10.0, max(4.5, mag)), 1)
        title    = f"M{mag:.1f} Earthquake — {place}"

        # Try to extract country from place name (e.g. "120 km SE of Tokyo, Japan")
        cc = find_country_enhanced(place)

        return {
            "id":               hashlib.md5(f"usgs:{f.get('id','')}".encode()).hexdigest(),
            "timestamp":        ts,
            "title":            title,
            "summary":          f"Magnitude {mag:.1f} earthquake recorded at {place}.",
            "category":         "EARTHQUAKE",
            "source":           "USGS",
            "latitude":         round(lat, 4),
            "longitude":        round(lon, 4),
            "country_code":     cc,
            "country_name":     get_name(cc) if cc != "XX" else place.split(", ")[-1],
            "severity":         score,
            "impact":           score_to_impact(score),
            "url":              p.get("url", "https://earthquake.usgs.gov"),
            "ai_impact_score":  score,
            "related_markets":  RELATED_MARKETS["EARTHQUAKE"],
            "topic_vector":     _topic_vector(title),
            "source_count":     1,
            "source_list":      ["USGS"],
            "sent_credibility": SOURCE_CREDIBILITY["USGS"],
        }
    except Exception as e:
        logger.debug("build_usgs_event: %s", e)
        return None


def build_eonet_event(item: Dict) -> Optional[Dict]:
    try:
        title    = item.get("title", "Natural Event")
        cats     = item.get("categories", [{}])
        cat_name = cats[0].get("title", "Disaster") if cats else "Disaster"
        geoms    = item.get("geometry", [])
        if not geoms:
            return None
        latest = geoms[-1]
        coords = latest.get("coordinates", [0, 0])
        if isinstance(coords[0], list):
            lon, lat = float(coords[0][0]), float(coords[0][1])
        else:
            lon, lat = float(coords[0]), float(coords[1])

        date_str = latest.get("date", "")
        try:
            ts = datetime.fromisoformat(date_str.replace("Z", "")).isoformat()
        except Exception:
            ts = datetime.utcnow().isoformat()

        score_map = {"Wildfires": 7.0, "Volcanoes": 8.0, "Severe Storms": 7.0,
                     "Floods": 6.5, "Earthquakes": 7.0, "Drought": 6.0}
        score = score_map.get(cat_name, 6.0)
        srcs  = item.get("sources", [{}])
        url   = srcs[0].get("url", "") if srcs else ""
        cc    = find_country_enhanced(title)

        return {
            "id":               hashlib.md5(f"eonet:{item.get('id','')}".encode()).hexdigest(),
            "timestamp":        ts,
            "title":            title,
            "summary":          f"NASA EONET: Active {cat_name} event monitored via satellite.",
            "category":         "DISASTER",
            "source":           "NASA EONET",
            "latitude":         round(lat, 4),
            "longitude":        round(lon, 4),
            "country_code":     cc,
            "country_name":     get_name(cc) if cc != "XX" else "Global",
            "severity":         score,
            "impact":           score_to_impact(score),
            "url":              url,
            "ai_impact_score":  score,
            "related_markets":  RELATED_MARKETS["DISASTER"],
            "topic_vector":     _topic_vector(title),
            "source_count":     1,
            "source_list":      ["NASA EONET"],
            "sent_credibility": SOURCE_CREDIBILITY["NASA EONET"],
        }
    except Exception as e:
        logger.debug("build_eonet_event: %s", e)
        return None


# ══════════════════════════════════════════════════════════
# 7. DEDUPLICATION  (exact hash + fuzzy title)
# ══════════════════════════════════════════════════════════

def _title_fingerprint(title: str) -> str:
    """Canonical form for fuzzy matching."""
    t = re.sub(r"[^a-z0-9 ]", "", title.lower())
    words = sorted(w for w in t.split() if len(w) > 3)
    return " ".join(words[:10])


def _jaccard(a: str, b: str) -> float:
    wa = set(re.findall(r"\b\w{4,}\b", a.lower()))
    wb = set(re.findall(r"\b\w{4,}\b", b.lower()))
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def _dedup_events(events: List[Dict]) -> List[Dict]:
    """
    Deduplicate:
    1. Skip exact duplicate IDs
    2. Merge events with Jaccard title similarity > 0.60 AND same country OR category
       (lowered from 0.65 to catch cross-source duplicates; added country guard
        so different events in the same category don't get wrongly merged)
    """
    THRESHOLD = 0.60

    seen_ids: Dict[str, bool] = {}
    groups: List[List[Dict]] = []
    fp_index: List[str] = []  # parallel to groups

    for ev in events:
        eid = ev["id"]
        if eid in seen_ids:
            continue
        seen_ids[eid] = True

        fp  = _title_fingerprint(ev["title"])
        cc  = ev.get("country_code", "XX")
        cat = ev.get("category", "")

        merged = False
        for i, fp2 in enumerate(fp_index):
            sim = _jaccard(fp, fp2)
            if sim < THRESHOLD:
                continue
            ref = groups[i][0]
            # Same country OR same category required to merge
            same_place = (cc != "XX" and cc == ref.get("country_code"))
            same_cat   = (cat == ref.get("category"))
            if same_place or same_cat:
                groups[i].append(ev)
                merged = True
                break

        if not merged:
            fp_index.append(fp)
            groups.append([ev])

    result: List[Dict] = []
    for group in groups:
        if len(group) == 1:
            ev = dict(group[0])
            ev.setdefault("source_count", 1)
            ev.setdefault("source_list", [ev.get("source", "")])
            result.append(ev)
        else:
            # Representative = highest severity
            rep = dict(max(group, key=lambda e: e.get("severity", 5.0)))
            sources = list({e.get("source", "") for e in group if e.get("source")})
            # Multi-source confirmation bump (log-scaled, max +1.0)
            bump = round(0.4 * math.log(len(group)), 2)
            rep["severity"]    = round(min(10.0, rep.get("severity", 5.0) + bump), 1)
            rep["impact"]      = score_to_impact(rep["severity"])
            rep["source_count"] = len(group)
            rep["source_list"] = sources
            rep["source"]      = sources[0] if sources else rep.get("source", "")
            # Use highest credibility source
            rep["sent_credibility"] = max(
                e.get("sent_credibility", 0.75) for e in group
            )
            result.append(rep)

    return result


# ══════════════════════════════════════════════════════════
# 8. MAIN FETCH ENTRY POINT
# ══════════════════════════════════════════════════════════

async def fetch_all_events() -> List[Dict]:
    """Fetch, parse, classify, geolocate, and deduplicate all events."""
    raw: List[Dict] = []
    feed_stats: Dict[str, str] = {}

    # ── RSS feeds ─────────────────────────────────────────
    async with httpx.AsyncClient(
        timeout=httpx.Timeout(connect=8.0, read=15.0, write=5.0, pool=5.0),
        follow_redirects=True,
        headers={"User-Agent": "WorldLens/3.0 Intelligence Platform (research@worldlens.io)"},
    ) as client:
        for source, url, credibility in RSS_SOURCES:
            try:
                resp = await client.get(url)
                resp.raise_for_status()
                # Decode with fallback
                try:
                    text = resp.text
                except Exception:
                    text = resp.content.decode("latin-1", errors="replace")

                items = parse_rss_xml(text)
                before = len(raw)
                # Financial/institutional feeds: up to 40 items; others 20
                FINANCIAL_SOURCES = {
                    "Bloomberg Mkts", "Bloomberg Econ", "FT Headlines",
                    "CNBC Finance", "CNBC World", "MarketWatch", "Investing.com",
                    "Yahoo Finance", "Seeking Alpha", "ECB Press", "IMF News",
                    "World Bank", "BIS", "OECD", "Reuters Business",
                    "Guardian Business", "Aljazeera Econ", "OilPrice", "Platts Energy",
                }
                item_limit = 40 if source in FINANCIAL_SOURCES else 20
                for item in items[:item_limit]:
                    ev = build_event(item, source, credibility)
                    if ev:
                        raw.append(ev)
                added = len(raw) - before
                feed_stats[source] = f"+{added}/{len(items)}"
            except httpx.TimeoutException:
                feed_stats[source] = "timeout"
                logger.warning("RSS timeout: %s", source)
            except httpx.HTTPStatusError as e:
                feed_stats[source] = f"HTTP {e.response.status_code}"
                logger.warning("RSS HTTP error %s: %s", source, e.response.status_code)
            except Exception as e:
                feed_stats[source] = f"error: {type(e).__name__}"
                logger.warning("RSS parse error %s: %s", source, e)

    logger.info("RSS feeds: %s", feed_stats)

    # ── USGS Earthquakes ──────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson"
            )
            r.raise_for_status()
            feats = r.json().get("features", [])
            usgs_added = 0
            for f in feats[:20]:
                ev = build_usgs_event(f)
                if ev:
                    raw.append(ev)
                    usgs_added += 1
            logger.info("USGS: %d earthquakes added", usgs_added)
    except Exception as e:
        logger.warning("USGS fetch error: %s", e)

    # ── NASA EONET ────────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.get(
                "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=25"
            )
            r.raise_for_status()
            eonet_added = 0
            for item in r.json().get("events", []):
                ev = build_eonet_event(item)
                if ev:
                    raw.append(ev)
                    eonet_added += 1
            logger.info("EONET: %d events added", eonet_added)
    except Exception as e:
        logger.warning("EONET fetch error: %s", e)

    logger.info("Total raw events before dedup: %d", len(raw))

    # ── Deduplicate ───────────────────────────────────────
    deduped = _dedup_events(raw)
    logger.info("After dedup: %d events (removed %d duplicates)",
                len(deduped), len(raw) - len(deduped))

    # Log category distribution for monitoring
    cat_dist: Dict[str, int] = {}
    for ev in deduped:
        cat_dist[ev.get("category", "?")] = cat_dist.get(ev.get("category", "?"), 0) + 1
    logger.info("Category distribution: %s", cat_dist)

    # Log geo distribution
    geo_xx = sum(1 for ev in deduped if ev.get("country_code") == "XX")
    logger.info("Geo: %d/%d events geolocated (%.0f%%)",
                len(deduped) - geo_xx, len(deduped),
                100 * (len(deduped) - geo_xx) / max(len(deduped), 1))

    return deduped
