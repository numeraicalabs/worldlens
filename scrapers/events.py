"""World Lens — Multi-source event scraper v2
Pipeline:
  1. Ingest: RSS (BBC, Reuters, AJZ, AP, UN), USGS earthquakes, NASA EONET
  2. Parse & clean: title, summary, url, timestamp
  3. Classify: keyword-rule NLP → category + severity
  4. Geolocate: country extraction → lat/lon
  5. Deduplicate: MD5 content hash + title similarity merge
  6. Enrich: topic_vector, source_credibility baseline
  7. Persist: INSERT OR IGNORE → only new events saved
"""
from __future__ import annotations
import httpx
import hashlib
import re
import math
import logging
import random
from datetime import datetime
from typing import Optional, List, Dict, Tuple
from email.utils import parsedate_to_datetime
from geocoder import find_country, get_coords, get_name

logger = logging.getLogger(__name__)

# ── Sources ───────────────────────────────────────────
RSS_SOURCES = [
("Reuters World","http://feeds.reuters.com/Reuters/worldNews"),
("Reuters Europe","http://feeds.reuters.com/Reuters/europeNews"),
("BBC World","http://feeds.bbci.co.uk/news/world/rss.xml"),
("BBC Europe","http://feeds.bbci.co.uk/news/world/europe/rss.xml"),
("BBC Asia","http://feeds.bbci.co.uk/news/world/asia/rss.xml"),
("CNN World","http://rss.cnn.com/rss/edition_world.rss"),
("CNN US","http://rss.cnn.com/rss/cnn_topstories.rss"),
("Al Jazeera","http://www.aljazeera.com/xml/rss/all.xml"),
("France 24","https://www.france24.com/en/rss"),
("DW News","http://rss.dw.com/rdf/rss-en-world"),
("Euronews","https://www.euronews.com/rss?level=theme&name=news"),
("The Guardian World","https://www.theguardian.com/world/rss"),
("NYTimes World","http://feeds.nytimes.com/nyt/rss/World"),
("Washington Post World","http://feeds.washingtonpost.com/rss/world"),
("Associated Press","https://apnews.com/apf-topnews?utm_source=rss"),
("NPR World","https://feeds.npr.org/1004/rss.xml"),
("CBS News","https://www.cbsnews.com/latest/rss/main"),
("ABC News International","https://abcnews.go.com/abcnews/internationalheadlines"),
("Sky News","https://feeds.skynews.com/feeds/rss/world.xml"),
("Time Magazine","https://time.com/feed/"),
("Bloomberg","https://www.bloomberg.com/feed/podcast/etf-report.xml"),
("CNBC","https://www.cnbc.com/id/100003114/device/rss/rss.html"),
("Yahoo News","https://news.yahoo.com/rss/"),
("MarketWatch","http://feeds.marketwatch.com/marketwatch/topstories/"),
("Financial Times","http://www.ft.com/rss/world"),
("The Economist","https://www.economist.com/the-world-this-week/rss.xml"),

# EUROPA (locale)
("Le Monde International","https://www.lemonde.fr/en/international/rss_full.xml"),
("El País","https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada"),
("Corriere della Sera","https://xml2.corriereobjects.it/rss/homepage.xml"),
("La Repubblica","https://www.repubblica.it/rss/homepage/rss2.0.xml"),
("Der Spiegel","https://www.spiegel.de/international/index.rss"),
("The Local Europe","https://www.thelocal.com/rss"),
("EUobserver","https://euobserver.com/rss"),
("Euractiv","https://www.euractiv.com/feed/"),
("Politico Europe","https://www.politico.eu/feed/"),

# AMERICA LATINA
("Folha de S.Paulo","https://feeds.folha.uol.com.br/emcimadahora/rss091.xml"),
("Clarín","https://www.clarin.com/rss/lo-ultimo/"),
("La Nación Argentina","https://www.lanacion.com.ar/arc/outboundfeeds/rss/"),
("Animal Politico","https://www.animalpolitico.com/feed/"),

# MEDIO ORIENTE
("Arab News","https://www.arabnews.com/rss.xml"),
("Haaretz","https://www.haaretz.com/cmlink/1.628752"),
("Jerusalem Post","https://www.jpost.com/rss/rssfeedsheadlines.aspx"),

# AFRICA
("AllAfrica","https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf"),
("News24 South Africa","https://feeds.news24.com/articles/news24/TopStories/rss"),
("Premium Times Nigeria","https://www.premiumtimesng.com/feed"),

# ASIA
("South China Morning Post","https://www.scmp.com/rss/91/feed"),
("Nikkei Asia","https://asia.nikkei.com/rss/feed/nar"),
("The Japan Times","https://www.japantimes.co.jp/feed/"),
("Yonhap News Korea","https://en.yna.co.kr/RSS/news.xml"),
("The Hindu India","https://www.thehindu.com/news/international/feeder/default.rss"),
("Times of India","https://timesofindia.indiatimes.com/rssfeeds/-2128936835.cms"),
("VNExpress Vietnam","https://vnexpress.net/rss/news.rss"),

# OCEANIA
("ABC Australia","https://www.abc.net.au/news/feed/51120/rss.xml"),
("Sydney Morning Herald","https://www.smh.com.au/rss/feed.xml"),

# CANADA (locale)
("CBC News","https://www.cbc.ca/cmlink/rss-topstories"),
("Global News","https://globalnews.ca/feed/"),
("CTV News","https://www.ctvnews.ca/rss/ctvnews-ca-top-stories-public-rss-1.822009"),

# EXTRA / AGGREGATORI
("Google News World","https://news.google.com/rss?hl=en-US&gl=US&ceid=US:en"),
("World News International","https://www.worldnewsintl.org/feed")
]

# ── Classification rules ──────────────────────────────
KEYWORD_RULES = [
    (["war","attack","military","airstrike","missile","bomb","troops","offensive","battle","frontline","invasion","shelling"], "CONFLICT", 8.0),
    (["terrorism","terrorist","explosion","blast","isis","al-qaeda","jihadist","suicide bomb"], "SECURITY", 8.5),
    (["earthquake","seismic","tremor","magnitude","richter"], "EARTHQUAKE", 7.5),
    (["hurricane","typhoon","cyclone","flood","wildfire","volcano","tsunami","drought","landslide"], "DISASTER", 7.0),
    (["sanctions","tariff","trade war","gdp","recession","inflation","fed","interest rate","imf","world bank","deficit"], "ECONOMICS", 6.0),
    (["stocks","market","nasdaq","dow jones","s&p","bitcoin","crypto","ipo","earnings","central bank","bond"], "FINANCE", 5.5),
    (["election","coup","president","prime minister","parliament","vote","referendum","protest","demonstration","riot"], "POLITICS", 5.0),
    (["nuclear","missile test","weapons","nato","alliance","treaty","diplomacy","summit","geopolit"], "GEOPOLITICS", 7.0),
    (["humanitarian","refugees","famine","crisis","displaced","aid","unicef","unhcr","starvation"], "HUMANITARIAN", 7.5),
    (["ai","artificial intelligence","technology","cyber","hack","data breach","spacex","nasa","semiconductor","chip"], "TECHNOLOGY", 4.5),
    (["oil","gas","energy","opec","pipeline","renewable","climate","carbon","lng"], "ENERGY", 5.5),
    (["pandemic","virus","covid","disease","who","epidemic","outbreak","vaccine","mpox"], "HEALTH", 6.5),
]

RELATED_MARKETS = {
    "CONFLICT":    ["Oil","Gold","Defense ETF"],
    "ECONOMICS":   ["S&P 500","EUR/USD","Bonds"],
    "FINANCE":     ["S&P 500","Nasdaq","Bitcoin"],
    "ENERGY":      ["Oil","Natural Gas","Clean Energy ETF"],
    "GEOPOLITICS": ["Gold","Oil","USD Index"],
    "DISASTER":    ["Reinsurance","Commodities"],
    "HEALTH":      ["Healthcare ETF","Pharma"],
    "TECHNOLOGY":  ["Nasdaq","Tech ETF","Bitcoin"],
    "POLITICS":    ["Local Currency","Government Bonds"],
    "EARTHQUAKE":  ["Reinsurance","Construction ETF"],
    "SECURITY":    ["Defense ETF","Gold"],
    "HUMANITARIAN":["Oil","Food Commodities"],
}

# ── Topic vector dims (must match ai_layer) ───────────
_TOPIC_DIMS = [
    ["war","conflict","military","attack","troops","battle","airstrike"],
    ["sanction","trade","tariff","gdp","recession","inflation","fed","rate"],
    ["election","coup","president","parliament","vote","government","protest"],
    ["oil","gas","energy","opec","pipeline","nuclear","power"],
    ["earthquake","flood","hurricane","disaster","climate","wildfire","storm"],
    ["pandemic","virus","vaccine","who","outbreak","disease","health"],
    ["tech","ai","cyber","hack","data","semiconductor","space","satellite"],
    ["bank","market","stocks","crypto","bond","rate","currency","liquidity"],
]

def _topic_vector(text: str) -> List[float]:
    tl = text.lower()
    words = re.findall(r'\b\w+\b', tl)
    n = max(len(words), 1)
    vec = [min(1.0, sum(1 for w in words if w in dim) / max(n * 0.05, 1))
           for dim in _TOPIC_DIMS]
    norm = math.sqrt(sum(v*v for v in vec)) or 1.0
    return [round(v/norm, 4) for v in vec]


def classify(text: str) -> Tuple[str, float, List[str]]:
    tl = text.lower()
    for keywords, cat, base_score in KEYWORD_RULES:
        if any(k in tl for k in keywords):
            score = base_score + random.uniform(-0.5, 0.5)
            return cat, round(min(10, max(1, score)), 1), RELATED_MARKETS.get(cat, [])
    return "GEOPOLITICS", round(random.uniform(3.5, 6.0), 1), RELATED_MARKETS["GEOPOLITICS"]


def score_to_impact(score: float) -> str:
    if score >= 7: return "High"
    if score >= 4: return "Medium"
    return "Low"


def _title_fingerprint(title: str) -> str:
    """Normalize title for dedup comparison."""
    t = title.lower()
    t = re.sub(r'[^a-z0-9 ]', '', t)
    words = [w for w in t.split() if len(w) > 3]
    words.sort()
    return " ".join(words[:8])


def _title_similarity(a: str, b: str) -> float:
    """Simple Jaccard similarity on normalized title words."""
    wa = set(re.findall(r'\b\w{4,}\b', a.lower()))
    wb = set(re.findall(r'\b\w{4,}\b', b.lower()))
    if not wa or not wb: return 0.0
    return len(wa & wb) / len(wa | wb)


def parse_rss_xml(xml: str) -> List[Dict]:
    items = []
    for m in re.finditer(r'<(?:item|entry)>(.*?)</(?:item|entry)>', xml, re.DOTALL):
        b = m.group(1)
        item: Dict = {}
        for tag in ['title','description','summary','link','pubDate','published','updated','content']:
            mt = re.search(r'<' + tag + r'[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?</' + tag + r'>', b, re.DOTALL)
            if mt:
                item[tag] = re.sub(r'<[^>]+>', '', mt.group(1)).strip()
        if 'link' not in item:
            ml = re.search(r'<link[^>]+href=["\']([^"\']+)["\']', b)
            if ml: item['link'] = ml.group(1)
        if item.get('title'):
            items.append(item)
    return items


async def fetch_all_events() -> List[Dict]:
    raw_events: List[Dict] = []

    # RSS sources
    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        for source, url in RSS_SOURCES:
            try:
                resp = await client.get(url, headers={"User-Agent": "WorldLens/2.0 (research)"})
                resp.raise_for_status()
                items = parse_rss_xml(resp.text)
                for item in items[:20]:
                    ev = build_event(item, source)
                    if ev: raw_events.append(ev)
            except Exception as e:
                logger.warning("RSS %s: %s", source, e)

    # USGS Earthquakes
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson")
            r.raise_for_status()
            for f in r.json().get("features", [])[:15]:
                ev = build_usgs_event(f)
                if ev: raw_events.append(ev)
    except Exception as e:
        logger.warning("USGS: %s", e)

    # NASA EONET
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=20")
            r.raise_for_status()
            for item in r.json().get("events", []):
                ev = build_eonet_event(item)
                if ev: raw_events.append(ev)
    except Exception as e:
        logger.warning("EONET: %s", e)

    logger.info("Events: fetched %d raw", len(raw_events))

    # ── Deduplication ──────────────────────────────────
    # Strategy: group by title fingerprint similarity > 0.65
    # Keep highest-severity representative; merge source list
    deduped = _dedup_events(raw_events)
    logger.info("Events: %d after dedup (merged %d)", len(deduped), len(raw_events) - len(deduped))
    return deduped


def _dedup_events(events: List[Dict]) -> List[Dict]:
    """
    Semantic deduplication:
    1. Exact hash dedup (same id → skip)
    2. Title Jaccard similarity > 0.65 + same category → merge into representative
    """
    seen_ids: Dict[str, Dict] = {}
    fingerprint_groups: List[List[Dict]] = []
    fp_map: Dict[str, int] = {}  # fingerprint → group index

    for ev in events:
        # Exact dedup by id
        if ev["id"] in seen_ids:
            continue
        seen_ids[ev["id"]] = ev

        fp = _title_fingerprint(ev["title"])
        # Find similar group
        matched_group = None
        for fp2, gidx in fp_map.items():
            if _title_similarity(fp, fp2) > 0.65 and \
               fingerprint_groups[gidx][0].get("category") == ev.get("category"):
                matched_group = gidx
                break

        if matched_group is not None:
            fingerprint_groups[matched_group].append(ev)
        else:
            fp_map[fp] = len(fingerprint_groups)
            fingerprint_groups.append([ev])

    # Merge each group → single representative
    result = []
    for group in fingerprint_groups:
        if len(group) == 1:
            ev = dict(group[0])
            ev["source_count"] = 1
            ev["source_list"] = [ev.get("source","")]
            result.append(ev)
        else:
            # Pick highest severity as representative
            rep = dict(max(group, key=lambda e: e.get("severity", 5)))
            sources = list({e.get("source","") for e in group})
            # Bump severity slightly for multi-source confirmation
            rep["severity"] = round(min(10.0, rep.get("severity", 5) + 0.3 * math.log(len(group) + 1)), 1)
            rep["impact"] = score_to_impact(rep["severity"])
            rep["source_count"] = len(group)
            rep["source_list"] = sources
            rep["_groupCount"] = len(group)
            rep["_sources"] = sources
            result.append(rep)

    return result


def build_event(item: Dict, source: str) -> Optional[Dict]:
    try:
        title = item.get('title', '')[:200]
        desc  = (item.get('description') or item.get('summary') or '')[:400]
        url   = item.get('link', '')
        date_str = item.get('pubDate') or item.get('published') or ''
        try:
            ts = parsedate_to_datetime(date_str).replace(tzinfo=None).isoformat()
        except Exception:
            ts = datetime.utcnow().isoformat()

        full = title + " " + desc
        category, score, markets = classify(full)
        cc = find_country(full)
        lat, lon = get_coords(cc)
        lat += random.uniform(-2, 2)
        lon += random.uniform(-2, 2)
        score = round(max(1.0, min(10.0, score + random.uniform(-0.3, 0.3))), 1)
        tvec = _topic_vector(full)

        return {
            "id":             hashlib.md5(("rss:" + source + ":" + (url or title)).encode()).hexdigest(),
            "timestamp":      ts,
            "title":          title,
            "summary":        desc[:300],
            "category":       category,
            "source":         source,
            "latitude":       lat,
            "longitude":      lon,
            "country_code":   cc,
            "country_name":   get_name(cc) if cc != "XX" else "Global",
            "severity":       score,
            "impact":         score_to_impact(score),
            "url":            url,
            "ai_impact_score": score,
            "related_markets": markets,
            "topic_vector":   tvec,
            "source_count":   1,
            "source_list":    [source],
        }
    except Exception as e:
        logger.debug("Event parse error: %s", e)
        return None


def build_usgs_event(f: Dict) -> Optional[Dict]:
    try:
        p = f.get("properties", {})
        g = f.get("geometry", {})
        coords = g.get("coordinates", [0, 0, 0])
        mag = p.get("mag", 0) or 0
        if mag < 4.5: return None
        lon, lat = float(coords[0]), float(coords[1])
        place = p.get("place", "Unknown")
        ts = datetime.utcfromtimestamp((p.get("time", 0)) / 1000).isoformat()
        score = min(10.0, max(1.0, float(mag)))
        title = f"M{mag} Earthquake — {place}"
        tvec = _topic_vector(title)
        return {
            "id":             hashlib.md5(("usgs:" + str(f.get('id',''))).encode()).hexdigest(),
            "timestamp":      ts,
            "title":          title,
            "summary":        f"Magnitude {mag} earthquake recorded at {place}.",
            "category":       "EARTHQUAKE",
            "source":         "USGS",
            "latitude":       lat,
            "longitude":      lon,
            "country_code":   "XX",
            "country_name":   place.split(", ")[-1] if "," in place else "Unknown",
            "severity":       score,
            "impact":         score_to_impact(score),
            "url":            p.get("url", "https://earthquake.usgs.gov"),
            "ai_impact_score": score,
            "related_markets": RELATED_MARKETS["EARTHQUAKE"],
            "topic_vector":   tvec,
            "source_count":   1,
            "source_list":    ["USGS"],
        }
    except Exception:
        return None


def build_eonet_event(item: Dict) -> Optional[Dict]:
    try:
        title = item.get("title", "Natural Event")
        cats  = item.get("categories", [{}])
        cat_name = cats[0].get("title", "Disaster") if cats else "Disaster"
        geoms = item.get("geometry", [])
        if not geoms: return None
        latest = geoms[-1]
        coords = latest.get("coordinates", [0, 0])
        if isinstance(coords[0], list):
            lon, lat = float(coords[0][0]), float(coords[0][1])
        else:
            lon, lat = float(coords[0]), float(coords[1])
        date_str = latest.get("date", "")
        try:
            ts = datetime.fromisoformat(date_str.replace("Z","")).isoformat()
        except Exception:
            ts = datetime.utcnow().isoformat()
        score_map = {"Wildfires":7,"Volcanoes":8,"Severe Storms":7,"Floods":6.5,"Earthquakes":7}
        score = score_map.get(cat_name, 6.0)
        srcs = item.get("sources", [{}])
        url  = srcs[0].get("url","") if srcs else ""
        tvec = _topic_vector(title)
        return {
            "id":             hashlib.md5(("eonet:" + str(item.get('id',''))).encode()).hexdigest(),
            "timestamp":      ts,
            "title":          title,
            "summary":        f"NASA EONET: Active {cat_name} event being monitored.",
            "category":       "DISASTER",
            "source":         "NASA EONET",
            "latitude":       lat,
            "longitude":      lon,
            "country_code":   "XX",
            "country_name":   "Global",
            "severity":       score,
            "impact":         score_to_impact(score),
            "url":            url,
            "ai_impact_score": score,
            "related_markets": RELATED_MARKETS["DISASTER"],
            "topic_vector":   tvec,
            "source_count":   1,
            "source_list":    ["NASA EONET"],
        }
    except Exception:
        return None
