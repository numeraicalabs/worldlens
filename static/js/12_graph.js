/**
 * @file 12_graph.js
 * @module WorldLens / Knowledge Graph
 *
 * Standalone graph analytics page.
 * Auto-builds from live G.events — no per-event clicking needed.
 *
 * Pipeline (pure JS, no server round-trip needed beyond initial events):
 *   1. EntityExtractor  — gazetteer NER (tickers, orgs, locations, commodities, people)
 *   2. GraphBuilder     — nodes: news + entities  |  edges: mentions, co-occurrence
 *   3. SimilarityEngine — TF-IDF cosine → similarity edges
 *   4. Enricher         — degree centrality, Louvain-style community detection
 *   5. ForceLayout      — Fruchterman-Reingold with zoom/pan
 *   6. Renderer         — Canvas 2D, community ring colors, size = centrality
 *   7. Interaction      — hover tooltip, click → detail panel, drag nodes
 */

// ════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════
var NG = {
  nodes:     [],      // [{id, label, type, x, y, vx, vy, size, color, community, degree, ...}]
  edges:     [],      // [{src, tgt, type, weight}]
  nodeMap:   {},      // id → node
  community_colors: [],

  // Canvas
  canvas:    null,
  ctx:       null,
  W: 0, H: 0,

  // Viewport transform
  tx: 0, ty: 0, scale: 1,

  // Drag
  dragging:  null,
  dragOff:   {x:0, y:0},
  panning:   false,
  panStart:  {x:0, y:0},

  // Hover
  hovered:   null,

  // Simulation
  sim: { running: false, alpha: 1, decay: 0.92, minAlpha: 0.005 },
  animFrame: null,
  forceK:    1.0,

  // Filters (toggled from sidebar)
  showNews:       true,
  showEntities:   true,
  showSimilarity: true,
  showCooc:       true,
  catFilter:      'ALL',

  built: false,
  // Enhancement state (initialised here, not at append time)
  minDegree:      0,
  entityFilter:  'ALL',
  showMentions:   true,
  pinnedNodes:    null,    // Set, created in ngBuild
  highlighted:    null,
  _activeCommunity: null,
};

// Community palette — 16 distinct colors
var NG_COMM_PALETTE = [
  '#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6',
  '#EC4899','#06B6D4','#84CC16','#F97316','#6366F1',
  '#14B8A6','#F43F5E','#A855F7','#22C55E','#FB923C','#38BDF8',
];

var NG_NODE_COLORS = {
  news:      '#3B82F6',
  company:   '#10B981',
  person:    '#F59E0B',
  location:  '#8B5CF6',
  ticker:    '#F97316',
  commodity: '#EC4899',
};

var NG_EDGE_COLORS = {
  mentions:      'rgba(148,163,184,0.25)',
  co_occurrence: 'rgba(96,165,250,0.35)',
  similarity:    'rgba(245,158,11,0.3)',
};

// ════════════════════════════════════════════════════════
// 1. ENTITY EXTRACTOR  (JS gazetteer — mirrors Python backend)
// ════════════════════════════════════════════════════════
var _TICKER_SET = new Set([
  'AAPL','MSFT','NVDA','GOOGL','GOOG','AMZN','META','TSLA','JPM','GS',
  'BAC','MS','C','WFC','V','MA','XOM','CVX','COP','INTC','AMD','QCOM',
  'AVGO','MU','LMT','RTX','BA','NOC','GD','UNH','JNJ','PFE','MRNA',
  'ABBV','WMT','TGT','COST','NFLX','DIS','ASML','TSM','BABA','BIDU',
  'BTC','ETH','SOL','BNB','XRP','NIO','RIVN','F','GM',
]);

var _COMMODITY_LIST = [
  ['natural gas','commodity'],['iron ore','commodity'],
  ['gold','commodity'],['silver','commodity'],['copper','commodity'],
  ['oil','commodity'],['crude','commodity'],['brent','commodity'],
  ['wheat','commodity'],['corn','commodity'],['soybeans','commodity'],
  ['bitcoin','commodity'],['ethereum','commodity'],['lithium','commodity'],
  ['coal','commodity'],['lng','commodity'],['cotton','commodity'],
  ['coffee','commodity'],['sugar','commodity'],['cocoa','commodity'],
];

var _ORG_LIST = [
  ['federal reserve','company'],['fed ','company'],
  ['european central bank','company'],['ecb ','company'],
  ['bank of england','company'],['bank of japan','company'],
  ['imf','company'],['world bank','company'],
  ['opec','company'],['nato','company'],
  ['united nations','company'],['european union','company'],
  ['g7','company'],['g20','company'],['who','company'],
  ['sec ','company'],['treasury','company'],
];

// Country → location mapping (simplified)
var _COUNTRY_CODE_MAP = {
  'US':'United States','CN':'China','RU':'Russia','DE':'Germany',
  'JP':'Japan','UK':'United Kingdom','FR':'France','IN':'India',
  'BR':'Brazil','SA':'Saudi Arabia','IR':'Iran','UA':'Ukraine',
  'IL':'Israel','TR':'Turkey','KR':'South Korea','AU':'Australia',
};

function _extractEntities(title, summary, countryCode) {
  var text    = ((title || '') + ' ' + (summary || '')).toLowerCase();
  var raw     = (title || '') + ' ' + (summary || '');
  var entities = [];
  var seen     = new Set();

  function add(id, label, type, salience) {
    if (seen.has(id) || !label || label.length < 2) return;
    seen.add(id);
    entities.push({ id:id, label:label, type:type, salience:Math.min(1, salience) });
  }

  // 1. TICKERS: $SYMBOL or bare SYMBOL with word boundaries
  var tickerRe = /\$([A-Z]{2,6})\b/g, m;
  while ((m = tickerRe.exec(raw)) !== null) {
    if (_TICKER_SET.has(m[1])) add('ti:'+m[1], m[1], 'ticker', 0.9);
  }
  var bareRe = /(?:^|[\s,.(])([A-Z]{2,6})(?:[\s,.)!]|$)/g;
  while ((m = bareRe.exec(raw)) !== null) {
    var sym = m[1];
    if (_TICKER_SET.has(sym) && !seen.has('ti:'+sym)) add('ti:'+sym, sym, 'ticker', 0.7);
  }

  // 2. COMMODITIES — longest match first to avoid partial overlaps
  _COMMODITY_LIST.slice().sort(function(a,b){return b[0].length-a[0].length;}).forEach(function(pair) {
    if (text.indexOf(pair[0]) !== -1) {
      var cnt = text.split(pair[0]).length - 1;
      add('cm:'+pair[0].replace(/\s/g,'_'),
          pair[0].replace(/\b\w/g, function(c){return c.toUpperCase();}),
          'commodity', 0.4 + cnt * 0.1);
    }
  });

  // 3. ORGANIZATIONS — gazetteer, longest match first
  _ORG_LIST.slice().sort(function(a,b){return b[0].length-a[0].length;}).forEach(function(pair) {
    if (text.indexOf(pair[0]) !== -1) {
      var cnt = text.split(pair[0]).length - 1;
      var lbl = pair[0].trim().replace(/\b\w/g, function(c){return c.toUpperCase();});
      add('co:'+pair[0].trim().replace(/\s/g,'_'), lbl, 'company', 0.5 + cnt*0.15);
    }
  });

  // 4. LOCATIONS — from event metadata + country name scan
  if (countryCode && countryCode !== 'XX') {
    var cname = _COUNTRY_CODE_MAP[countryCode] || countryCode;
    add('lo:'+countryCode, cname, 'location', 0.7);
  }
  var sortedCountries = Object.keys(_COUNTRY_NAME_MAP).sort(function(a,b){return b.length-a.length;});
  sortedCountries.forEach(function(name) {
    if (text.indexOf(name) !== -1) {
      var code  = _COUNTRY_NAME_MAP[name];
      var label = _COUNTRY_CODE_MAP[code] || (name.replace(/\b\w/g, function(c){return c.toUpperCase();}));
      if (!seen.has('lo:'+code)) add('lo:'+code, label, 'location', 0.5);
    }
  });

  // 5. PERSONS — only via title prefix OR known surname
  // Pattern A: "President/CEO/Dr/Mr ... Name"
  var TITLE_RE = /\b(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?|Prof\.?|President|Prime Minister|Chancellor|Minister|Secretary|Chairman|CEO|CFO|Governor|Director)\s+([A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15}){0,2})\b/g;
  while ((m = TITLE_RE.exec(raw)) !== null) {
    var pwords = m[1].split(' ');
    var ok = pwords.every(function(w){return !_PERSON_STOP.has(w);}) && pwords.length <= 3;
    if (ok) add('pe:'+m[1].toLowerCase().replace(/\s/g,'_'), m[1], 'person', 0.85);
  }
  // Pattern B: Known surname list
  var KNOWN_RE = new RegExp('\\b([A-Z][a-z]{2,15})\\s+((?:Biden|Trump|Putin|Xi|Zelensky|Macron|Scholz|Sunak|Starmer|Lagarde|Powell|Yellen|Draghi|Erdogan|Netanyahu|Khamenei|Kishida|Modi|Lula|Musk|Bezos|Zuckerberg|Cook|Pichai|Nadella|Dimon|Buffett|Dalio|Ackman|Soros|Icahn|Gates|Thiel|Blinken|Austin|Pelosi|Schumer|McConnell|Merkel|Blair|Obama|Clinton|Bush|Milei|Bukele|Maduro|Bolsonaro|Guterres|Stoltenberg))\\b', 'g');
  while ((m = KNOWN_RE.exec(raw)) !== null) {
    var fn = m[1], ln = m[2];
    if (!_PERSON_STOP.has(fn) && !_PERSON_STOP.has(ln))
      add('pe:'+fn.toLowerCase()+'_'+ln.toLowerCase(), fn+' '+ln, 'person', 0.8);
  }
  // Pattern C: bare known surname alone (important leaders cited by surname only)
  var BARE_KNOWN = new RegExp('\\b((?:Biden|Trump|Putin|Xi|Zelensky|Macron|Scholz|Sunak|Starmer|Lagarde|Powell|Yellen|Draghi|Erdogan|Netanyahu|Khamenei|Kishida|Modi|Lula|Musk|Bezos|Zuckerberg|Cook|Pichai|Nadella|Dimon|Buffett|Dalio|Ackman|Soros|Icahn|Gates|Thiel|Blinken|Austin|Pelosi|Schumer|McConnell|Merkel|Blair|Obama|Clinton|Bush|Milei|Bukele|Maduro|Bolsonaro|Guterres|Stoltenberg))\\b', 'g');
  while ((m = BARE_KNOWN.exec(raw)) !== null) {
    var surname = m[1];
    var pid = 'pe:'+surname.toLowerCase();
    if (!seen.has(pid))
      add(pid, surname, 'person', 0.65);
  }

  return entities;
}

// ── Stop set: words that look like person names but are NOT ──────────
var _PERSON_STOP = new Set([
  'North','South','East','West','New','Old','Great','Greater','Little',
  'Central','Northern','Southern','Eastern','Western','Pacific','Atlantic',
  'Middle','Far','Near','Upper','Lower','Inner','Outer',
  'United','States','Kingdom','Republic','Democratic','People',
  'Saudi','Arabia','Hong','Kong','Korea','Black','Wall','Main',
  'Foreign','Funds','Fund','Investment','Management','Capital','Markets',
  'Federal','Reserve','Bank','Banks','Financial','Monetary','Fiscal',
  'Global','International','Regional','National','Bilateral','Multilateral',
  'Budget','Deficit','Surplus','Growth','Rate','Rates','Index',
  'Prime','President','Minister','Secretary','Chairman','Director',
  'General','Commander','Deputy','Senior','Junior','Chief',
  'Record','Report','Update','Alert','Breaking','Watch','Analysis',
  'Quarterly','Annual','Monthly','Weekly','Daily',
  'Missile','Nuclear','Military','Forces','Troops','Army','Navy',
  'Markets','Stocks','Bonds','Currency','Commodities','Trade',
  'Amid','After','Before','During','Following','Ahead','Despite',
  'Raises','Cuts','Hikes','Drops','Falls','Rises','Surges','Plunges',
  'Report','Says','Shows','Data','Source','Official','Analyst',
]);

// Country name → ISO-2 code (covers text mentions like "russian", "tokyo", etc.)
var _COUNTRY_NAME_MAP = {
  'united states':'US','america':'US','u.s.':'US','american':'US',
  'china':'CN','chinese':'CN','beijing':'CN','shanghai':'CN',
  'russia':'RU','russian':'RU','moscow':'RU','kremlin':'RU',
  'germany':'DE','german':'DE','berlin':'DE',
  'japan':'JP','japanese':'JP','tokyo':'JP',
  'united kingdom':'GB','britain':'GB','british':'GB','london':'GB','uk':'GB',
  'france':'FR','french':'FR','paris':'FR',
  'india':'IN','indian':'IN','delhi':'IN','mumbai':'IN','new delhi':'IN',
  'brazil':'BR','brazilian':'BR','brasilia':'BR',
  'saudi arabia':'SA','saudi':'SA','riyadh':'SA',
  'iran':'IR','iranian':'IR','tehran':'IR',
  'ukraine':'UA','ukrainian':'UA','kyiv':'UA','kiev':'UA',
  'israel':'IL','israeli':'IL','tel aviv':'IL','jerusalem':'IL',
  'turkey':'TR','turkish':'TR','ankara':'TR','istanbul':'TR',
  'south korea':'KR','korean':'KR','seoul':'KR',
  'australia':'AU','australian':'AU','sydney':'AU','canberra':'AU',
  'canada':'CA','canadian':'CA','ottawa':'CA','toronto':'CA',
  'mexico':'MX','mexican':'MX',
  'indonesia':'ID','jakarta':'ID','indonesian':'ID',
  'argentina':'AR','argentinian':'AR','buenos aires':'AR',
  'egypt':'EG','egyptian':'EG','cairo':'EG',
  'nigeria':'NG','nigerian':'NG','abuja':'NG','lagos':'NG',
  'pakistan':'PK','pakistani':'PK','islamabad':'PK',
  'venezuela':'VE','venezuelan':'VE','caracas':'VE',
  'north korea':'KP','pyongyang':'KP',
  'taiwan':'TW','taiwanese':'TW','taipei':'TW',
  'hong kong':'HK',
  'eurozone':'EU','europe':'EU','european':'EU','brussels':'EU',
  'afghanistan':'AF','afghan':'AF','kabul':'AF',
  'myanmar':'MM','burma':'MM','yangon':'MM',
  'syria':'SY','syrian':'SY','damascus':'SY',
  'iraq':'IQ','iraqi':'IQ','baghdad':'IQ',
  'yemen':'YE','yemeni':'YE','sanaa':'YE',
  'ethiopia':'ET','ethiopian':'ET','addis ababa':'ET',
  'poland':'PL','polish':'PL','warsaw':'PL',
  'netherlands':'NL','dutch':'NL','amsterdam':'NL',
  'spain':'ES','spanish':'ES','madrid':'ES',
  'italy':'IT','italian':'IT','rome':'IT',
  'switzerland':'CH','swiss':'CH','zurich':'CH','geneva':'CH',
  'sweden':'SE','swedish':'SE','stockholm':'SE',
  'norway':'NO','norwegian':'NO','oslo':'NO',
  'south africa':'ZA','south african':'ZA','johannesburg':'ZA',
  'colombia':'CO','colombian':'CO','bogota':'CO',
  'chile':'CL','chilean':'CL','santiago':'CL',
  'peru':'PE','peruvian':'PE','lima':'PE',
  'kenya':'KE','kenyan':'KE','nairobi':'KE',
  'thailand':'TH','thai':'TH','bangkok':'TH',
  'vietnam':'VN','vietnamese':'VN','hanoi':'VN',
  'philippines':'PH','philippine':'PH','manila':'PH',
  'malaysia':'MY','malaysian':'MY','kuala lumpur':'MY',
  'greece':'GR','greek':'GR','athens':'GR',
  'hungary':'HU','hungarian':'HU','budapest':'HU',
  'romania':'RO','romanian':'RO','bucharest':'RO',
  'czech republic':'CZ','czech':'CZ','prague':'CZ',
  'poland':'PL','warsaw':'PL',
  'israel':'IL','jerusalem':'IL',
  'algeria':'DZ','algerian':'DZ','algiers':'DZ',
  'morocco':'MA','moroccan':'MA','rabat':'MA',
  'qatar':'QA','qatari':'QA','doha':'QA',
  'uae':'AE','emirati':'AE','dubai':'AE','abu dhabi':'AE',
  'kuwait':'KW','kuwaiti':'KW',
  'jordan':'JO','jordanian':'JO','amman':'JO',
  'libya':'LY','libyan':'LY','tripoli':'LY',
  'ethiopia':'ET','addis ababa':'ET',
  'sudan':'SD','sudanese':'SD','khartoum':'SD',
  'haiti':'HT','haitian':'HT',
  'cuba':'CU','cuban':'CU','havana':'CU',
  'new zealand':'NZ','auckland':'NZ','wellington':'NZ',
  'singapore':'SG','singaporean':'SG',
  'kazakhstan':'KZ','kazakh':'KZ','astana':'KZ',
  'uzbekistan':'UZ','uzbek':'UZ','tashkent':'UZ',
  'belarus':'BY','belarusian':'BY','minsk':'BY',
  'serbia':'RS','serbian':'RS','belgrade':'RS',
  'croatia':'HR','croatian':'HR','zagreb':'HR',
  'kenya':'KE','nairobi':'KE',
  'tanzania':'TZ','tanzanian':'TZ','dar es salaam':'TZ',
  'ghana':'GH','ghanaian':'GH','accra':'GH',
  'angola':'AO','angolan':'AO','luanda':'AO',
  'mozambique':'MZ','mozambican':'MZ','maputo':'MZ',
  'bangladesh':'BD','bangladeshi':'BD','dhaka':'BD',
  'myanmar':'MM','yangon':'MM',
  'cambodia':'KH','cambodian':'KH','phnom penh':'KH',
  'laos':'LA','lao':'LA','vientiane':'LA',
  'sri lanka':'LK','colombo':'LK',
  'nepal':'NP','nepalese':'NP','kathmandu':'NP',
  'bolivia':'BO','bolivian':'BO','la paz':'BO',
  'paraguay':'PY','paraguayan':'PY','asuncion':'PY',
  'uruguay':'UY','uruguayan':'UY','montevideo':'UY',
  'ecuador':'EC','ecuadorian':'EC','quito':'EC',
};

// ════════════════════════════════════════════════════════
// 2. TF-IDF SIMILARITY ENGINE  (pure JS)
// ════════════════════════════════════════════════════════
function _buildTfIdf(docs) {
  // doc = string
  var N        = docs.length;
  var tf       = [];    // tf[i] = {term: count/len}
  var df       = {};    // df[term] = doc count
  var stopSet  = new Set(['the','a','an','and','or','but','in','on','at',
    'to','for','of','is','are','was','were','be','been','have','has','had',
    'it','its','that','this','with','from','by','as','not','no','if','he',
    'she','they','we','you','i','my','our','their','his','her',
    'said','also','after','before','more','than','up','out','over','about',
    'into','than','just','will','can','would','could','should']);

  docs.forEach(function(doc, i) {
    var words = doc.toLowerCase().replace(/[^\w\s]/g,'').split(/\s+/)
                   .filter(function(w){ return w.length > 2 && !stopSet.has(w); });
    var freq  = {};
    words.forEach(function(w){ freq[w] = (freq[w]||0)+1; });
    var len   = Math.max(words.length, 1);
    var tfd   = {};
    Object.keys(freq).forEach(function(w){
      tfd[w] = freq[w] / len;
      df[w]  = (df[w]||0)+1;
    });
    tf.push(tfd);
  });

  // TF-IDF vectors
  var vecs = tf.map(function(tfd) {
    var v = {};
    Object.keys(tfd).forEach(function(w) {
      var idf = Math.log((N + 1) / ((df[w]||0) + 1)) + 1;
      v[w] = tfd[w] * idf;
    });
    return v;
  });

  // Normalise
  vecs.forEach(function(v) {
    var norm = Math.sqrt(Object.values(v).reduce(function(s,x){return s+x*x;},0)) || 1;
    Object.keys(v).forEach(function(w){ v[w] /= norm; });
  });

  return vecs;
}

function _cosineSim(a, b) {
  var dot = 0;
  Object.keys(a).forEach(function(w){ if (b[w]) dot += a[w]*b[w]; });
  return dot; // already normalised
}

// ════════════════════════════════════════════════════════
// 3. GRAPH BUILDER
// ════════════════════════════════════════════════════════
function ngBuildGraph(events, opts) {
  var maxNews      = opts.maxNodes || 80;
  var simThreshold = opts.simThreshold || 0.25;

  var nodes   = [];
  var edges   = [];
  var nodeMap = {};
  var coocCount = {};   // "id1__id2" → count

  function addNode(n) {
    if (!nodeMap[n.id]) { nodeMap[n.id] = n; nodes.push(n); }
    return nodeMap[n.id];
  }

  function addEdge(src, tgt, type, weight) {
    if (src === tgt) return;
    if (!nodeMap[src] || !nodeMap[tgt]) return;
    edges.push({ src:src, tgt:tgt, type:type, weight:Math.min(1, weight) });
  }

  // ── News nodes ────────────────────────────────────────
  var cat = document.getElementById('ng-cat-filter');
  var catFilter = cat ? cat.value : 'ALL';
  var minSev  = parseFloat((document.getElementById('ng-severity')||{value:'4.5'}).value) || 4.5;

  var evList = events.slice().filter(function(ev) {
    if (ev.severity < minSev) return false;
    if (catFilter !== 'ALL' && ev.category !== catFilter) return false;
    return true;
  }).sort(function(a,b){ return b.severity - a.severity; }).slice(0, maxNews);

  evList.forEach(function(ev) {
    addNode({
      id:          ev.id,
      label:       (ev.title||'').slice(0,50),
      type:        'news',
      category:    ev.category || '',
      severity:    ev.severity || 5,
      timestamp:   ev.timestamp || '',
      source:      ev.source || '',
      country:     ev.country_name || ev.country_code || '',
      summary:     (ev.summary||'').slice(0,150),
      url:         ev.url || '',
      // Layout placeholders
      x:0, y:0, vx:0, vy:0, size:0,
      color: NG_NODE_COLORS['news'],
      degree: 0, community: 0, pagerank: 0,
    });
  });

  // ── Entity nodes + mentions edges ─────────────────────
  evList.forEach(function(ev) {
    var ents = _extractEntities(ev.title, ev.summary, ev.country_code);
    var entIds = [];

    ents.forEach(function(ent) {
      var existing = nodeMap[ent.id];
      if (existing) {
        existing.mention_count = (existing.mention_count||0)+1;
      } else {
        addNode({
          id:            ent.id,
          label:         ent.label,
          type:          ent.type,
          canonical:     ent.label.toLowerCase(),
          mention_count: 1,
          x:0, y:0, vx:0, vy:0, size:0,
          color: NG_NODE_COLORS[ent.type] || '#94A3B8',
          degree:0, community:0, pagerank:0,
        });
      }
      addEdge(ev.id, ent.id, 'mentions', ent.salience);
      entIds.push(ent.id);
    });

    // Co-occurrence
    for (var i=0; i<entIds.length; i++) {
      for (var j=i+1; j<entIds.length; j++) {
        var key = [entIds[i],entIds[j]].sort().join('__');
        coocCount[key] = (coocCount[key]||0)+1;
      }
    }
  });

  // Add co-occurrence edges (normalised weight)
  Object.keys(coocCount).forEach(function(key) {
    var parts  = key.split('__');
    var cnt    = coocCount[key];
    var weight = Math.min(1, cnt / 5);
    addEdge(parts[0], parts[1], 'co_occurrence', weight);
    addEdge(parts[1], parts[0], 'co_occurrence', weight);
  });

  // ── TF-IDF similarity edges ──────────────────────────
  var newsNodes  = nodes.filter(function(n){ return n.type==='news'; });
  var docs       = newsNodes.map(function(n){ return (n.label||'')+' '+(n.summary||''); });
  if (docs.length >= 2) {
    var vecs = _buildTfIdf(docs);
    for (var i=0; i<newsNodes.length; i++) {
      for (var j=i+1; j<newsNodes.length; j++) {
        var sim = _cosineSim(vecs[i], vecs[j]);
        if (sim >= simThreshold) {
          addEdge(newsNodes[i].id, newsNodes[j].id, 'similarity', sim);
          addEdge(newsNodes[j].id, newsNodes[i].id, 'similarity', sim);
        }
      }
    }
  }

  return { nodes:nodes, edges:edges, nodeMap:nodeMap };
}

// ════════════════════════════════════════════════════════
// 4. ENRICHER — degree centrality + community detection
// ════════════════════════════════════════════════════════
function ngEnrich(nodes, edges, nodeMap) {
  // Degree centrality
  var degree = {};
  edges.forEach(function(e) {
    degree[e.src] = (degree[e.src]||0)+1;
    degree[e.tgt] = (degree[e.tgt]||0)+1;
  });
  var maxDeg = Math.max.apply(null, Object.values(degree).concat([1]));
  nodes.forEach(function(n) {
    n.degree          = degree[n.id] || 0;
    n.degree_centrality = n.degree / Math.max(maxDeg, 1);
  });

  // Node size from centrality + type
  nodes.forEach(function(n) {
    var base = n.type === 'news' ? 10 + (n.severity||5)*1.2 : 8;
    n.size   = Math.max(6, Math.min(30, base + n.degree_centrality * 18));
  });

  // Louvain-style community detection (label propagation in JS)
  // Simple but effective: iterate propagation until stable
  var comm = {};
  nodes.forEach(function(n,i){ comm[n.id] = i; });

  // Build adjacency (undirected)
  var adj = {};
  edges.forEach(function(e) {
    if (!adj[e.src]) adj[e.src] = [];
    if (!adj[e.tgt]) adj[e.tgt] = [];
    if (adj[e.src].indexOf(e.tgt) === -1) adj[e.src].push(e.tgt);
    if (adj[e.tgt].indexOf(e.src) === -1) adj[e.tgt].push(e.src);
  });

  // Label propagation: deterministic order (degree-desc) for reproducibility
  var orderedIds = nodes.map(function(n){ return n.id; })
                        .sort(function(a,b){ return (degree[b]||0)-(degree[a]||0); });
  for (var iter=0; iter<20; iter++) {
    var changed = false;
    orderedIds.forEach(function(nid) {
      var neighbors = adj[nid] || [];
      if (!neighbors.length) return;
      var votes = {};
      neighbors.forEach(function(nb){ var c=comm[nb]; votes[c]=(votes[c]||0)+1; });
      var best=comm[nid], bestV=0;
      // Tie-break: lower community ID wins (stability)
      Object.keys(votes).forEach(function(c) {
        var ci=parseInt(c);
        if (votes[c]>bestV||(votes[c]===bestV&&ci<best)){ bestV=votes[c]; best=ci; }
      });
      if (best!==comm[nid]){ comm[nid]=best; changed=true; }
    });
    if (!changed) break;
  }

  // Renumber communities 0..N
  var commIds = [];
  Object.values(comm).forEach(function(c){ if (commIds.indexOf(c)===-1) commIds.push(c); });
  var remap = {};
  commIds.forEach(function(c,i){ remap[c]=i; });

  nodes.forEach(function(n) {
    n.community = remap[comm[n.id]] || 0;
  });

  var nComm = commIds.length;
  return nComm;
}

// ════════════════════════════════════════════════════════
// 5. FORCE LAYOUT  (Fruchterman-Reingold)
// ════════════════════════════════════════════════════════
function ngInitLayout(nodes, W, H) {
  var n = nodes.length;
  nodes.forEach(function(node, i) {
    var angle  = (i/n)*Math.PI*4 + (Math.random()-.5);
    var r      = 60 + (i/n) * Math.min(W,H)*0.32;
    node.x     = W/2 + r*Math.cos(angle) + (Math.random()-.5)*30;
    node.y     = H/2 + r*Math.sin(angle) + (Math.random()-.5)*30;
    node.vx    = 0;
    node.vy    = 0;
  });
}

function ngTick(nodes, edges, W, H, alpha, forceK) {
  var k   = Math.sqrt(W*H / Math.max(nodes.length,1)) * 0.6 * forceK;
  var k2  = k*k;

  // Reset forces
  nodes.forEach(function(n){ n.fx=0; n.fy=0; });

  // Repulsion (O(n²), capped at 300 nodes)
  for (var i=0; i<nodes.length; i++) {
    var ni = nodes[i];
    for (var j=i+1; j<nodes.length; j++) {
      var nj  = nodes[j];
      var dx  = ni.x-nj.x, dy = ni.y-nj.y;
      var d2  = dx*dx+dy*dy;
      if (d2 < 0.01) { dx=Math.random()-.5; dy=Math.random()-.5; d2=0.25; }
      var rep = k2 / Math.sqrt(d2);
      var ux  = dx/Math.sqrt(d2)*rep;
      var uy  = dy/Math.sqrt(d2)*rep;
      ni.fx += ux; ni.fy += uy;
      nj.fx -= ux; nj.fy -= uy;
    }
  }

  // Attraction along edges
  edges.forEach(function(e) {
    var s = NG.nodeMap[e.src], t = NG.nodeMap[e.tgt];
    if (!s||!t) return;
    var dx  = t.x-s.x, dy = t.y-s.y;
    var d   = Math.sqrt(dx*dx+dy*dy) || 0.01;
    var att = (d*d/k) * (e.weight||0.5) * 0.5;
    var ux  = dx/d*att, uy = dy/d*att;
    s.fx += ux; s.fy += uy;
    t.fx -= ux; t.fy -= uy;
  });

  // Centre gravity (weak)
  nodes.forEach(function(n) {
    n.fx += (W/2 - n.x)*0.008;
    n.fy += (H/2 - n.y)*0.008;
  });

  // Apply with damping + bounds
  var maxDisp = k * alpha * 2;
  nodes.forEach(function(n) {
    if (n === NG.dragging) return;
    n.vx  = (n.vx + n.fx) * 0.8;
    n.vy  = (n.vy + n.fy) * 0.8;
    var disp = Math.sqrt(n.vx*n.vx+n.vy*n.vy);
    if (disp > maxDisp) { n.vx=n.vx/disp*maxDisp; n.vy=n.vy/disp*maxDisp; }
    n.x   = Math.max(20, Math.min(W-20, n.x + n.vx));
    n.y   = Math.max(20, Math.min(H-20, n.y + n.vy));
  });
}

// ════════════════════════════════════════════════════════
// 6. RENDERER
// ════════════════════════════════════════════════════════
function ngDraw() {
  var canvas = NG.canvas;
  if (!canvas) return;
  var ctx    = NG.ctx;
  var W      = NG.W, H = NG.H;

  ctx.clearRect(0,0,W,H);
  ctx.save();
  ctx.translate(NG.tx, NG.ty);
  ctx.scale(NG.scale, NG.scale);

  var showSim  = NG.showSimilarity !== false;
  var showCooc = NG.showCooc       !== false;
  var showNews = NG.showNews       !== false;
  var showEnt  = NG.showEntities   !== false;

  // ── Edges ──────────────────────────────────────────────
  var showMentions_ = NG.showMentions !== false;
  ctx.lineWidth = 1;
  NG.edges.forEach(function(e) {
    if (e.type === 'mentions'     && !showMentions_) return;
    if (e.type === 'similarity'   && !showSim)       return;
    if (e.type === 'co_occurrence'&& !showCooc)      return;
    var s = NG.nodeMap[e.src], t = NG.nodeMap[e.tgt];
    if (!s||!t) return;
    if (!_nodeVisible(s)||!_nodeVisible(t)) return;
    // Draw only one direction for symmetric edges
    if ((e.type === 'similarity' || e.type === 'co_occurrence') && e.src > e.tgt) return;

    var col = NG_EDGE_COLORS[e.type] || 'rgba(148,163,184,0.2)';
    ctx.strokeStyle = col;
    ctx.lineWidth   = e.type==='mentions' ? 0.8 : 1.2;
    if (e.type === 'co_occurrence') { ctx.setLineDash([4,3]); }
    else if (e.type === 'similarity') { ctx.setLineDash([2,2]); }
    else { ctx.setLineDash([]); }

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(t.x, t.y);
    ctx.stroke();
    ctx.setLineDash([]);
  });

  // ── Nodes ──────────────────────────────────────────────
  NG.nodes.forEach(function(n) {
    if (!_nodeVisible(n)) return;
    var r       = n.size || 10;
    var commCol = NG_COMM_PALETTE[n.community % NG_COMM_PALETTE.length] || '#94A3B8';
    var baseCol = n.color || NG_NODE_COLORS[n.type] || '#60A5FA';
    var isHov   = NG.hovered && NG.hovered.id === n.id;

    // Glow on hover
    if (isHov) {
      ctx.shadowColor = baseCol;
      ctx.shadowBlur  = 16;
    }

    // Community ring (outer)
    ctx.beginPath();
    ctx.arc(n.x, n.y, r + 3.5, 0, Math.PI*2);
    ctx.fillStyle = commCol + '55';
    ctx.fill();

    // Node fill
    ctx.beginPath();
    ctx.arc(n.x, n.y, r, 0, Math.PI*2);
    ctx.fillStyle = baseCol + (isHov ? 'EE' : '99');
    ctx.fill();
    ctx.strokeStyle = baseCol;
    ctx.lineWidth   = isHov ? 2.5 : 1.5;
    ctx.stroke();

    ctx.shadowBlur  = 0;

    // Icon or initial
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (n.type === 'news') {
      ctx.font = r > 12 ? '10px sans-serif' : '8px sans-serif';
      var cat = (n.category||'').slice(0,3);
      ctx.fillText(cat, n.x, n.y);
    } else if (n.type === 'ticker') {
      ctx.font = 'bold ' + (r > 12 ? '9px' : '7px') + ' monospace';
      ctx.fillText((n.label||'').slice(0,4), n.x, n.y);
    } else {
      ctx.font = (r > 12 ? '11px' : '9px') + ' sans-serif';
      ctx.fillText((n.label||' ').charAt(0).toUpperCase(), n.x, n.y);
    }

    // Label (visible at higher zoom or for important nodes)
    var effR  = r * NG.scale;
    var degC  = n.degree_centrality || 0;
    var isPin = NG.pinnedNodes && NG.pinnedNodes.has(n.id);
    if (effR > 10 || degC > 0.3 || isHov) {
      ctx.fillStyle    = '#E2E8F0';
      ctx.font         = degC > 0.4 ? 'bold 9px sans-serif' : '8px sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      var lbl = n.type==='news' ? (n.label||'').slice(0,28) : (n.label||'').slice(0,16);
      ctx.fillText(lbl, n.x, n.y + r + 3);
    }
    // Pin indicator
    if (isPin) {
      ctx.fillStyle  = '#F59E0B';
      ctx.font       = '10px sans-serif';
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('📌', n.x + r + 2, n.y - r - 2);
    }
    // Search highlight ring
    if (NG.highlighted === n.id) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, r + 7, 0, Math.PI*2);
      ctx.strokeStyle = '#FBBF24';
      ctx.lineWidth   = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  });

  ctx.restore();

  // ── Tooltip for hovered node ────────────────────────────
  if (NG.hovered) {
    _drawTooltip(NG.hovered);
  }
}

function _nodeVisible(n) {
  if (!NG.showNews     && n.type==='news')  return false;
  if (!NG.showEntities && n.type!=='news')  return false;
  // Min-degree filter
  if ((NG.minDegree||0) > 0 && n.degree < NG.minDegree) return false;
  // Entity type filter
  if ((NG.entityFilter||'ALL') !== 'ALL' && n.type !== 'news' && n.type !== NG.entityFilter) return false;
  // Community filter
  if (NG._activeCommunity != null && n.community !== NG._activeCommunity) return false;
  // Highlight dimming: if a node is highlighted, dim others (but still show)
  return true;
}

function _drawTooltip(n) {
  var ctx    = NG.ctx;
  var sx     = n.x * NG.scale + NG.tx;
  var sy     = n.y * NG.scale + NG.ty;
  var lines  = [];
  if (n.type==='news') {
    lines = [
      n.category + '  ·  sev ' + (n.severity||0).toFixed(1),
      (n.label||'').slice(0,48),
      n.country || '',
      'deg ' + n.degree + '  ·  comm ' + n.community,
    ];
  } else {
    lines = [
      n.type.toUpperCase(),
      n.label || '',
      'mentions: ' + (n.mention_count||1) + '  ·  comm ' + n.community,
      'centrality: ' + ((n.degree_centrality||0)*100).toFixed(0) + '%',
    ];
  }
  lines = lines.filter(Boolean);

  var pad = 10, lh = 16, bw = 220, bh = pad*2 + lh*lines.length;
  var bx  = sx + (n.size||10)*NG.scale + 6;
  var by  = sy - bh/2;
  if (bx + bw > NG.W) bx = sx - bw - 6;
  if (by < 4) by = 4;
  if (by + bh > NG.H) by = NG.H - bh - 4;

  ctx.save();
  ctx.fillStyle = 'rgba(6,11,24,0.95)';
  ctx.strokeStyle= n.color || '#60A5FA';
  ctx.lineWidth  = 1;
  _rrect(ctx, bx, by, bw, bh, 6);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#94A3B8';
  ctx.font      = '9px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(lines[0], bx+pad, by+pad);
  ctx.fillStyle = '#F0F6FF';
  ctx.font      = 'bold 10px sans-serif';
  ctx.fillText(lines[1], bx+pad, by+pad+lh);
  ctx.fillStyle = '#64748B';
  ctx.font      = '9px sans-serif';
  for (var i=2; i<lines.length; i++) {
    ctx.fillText(lines[i], bx+pad, by+pad+lh*(i));
  }
  ctx.restore();
}

function _rrect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.arcTo(x+w,y,x+w,y+r,r);
  ctx.lineTo(x+w,y+h-r);
  ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
  ctx.lineTo(x+r,y+h);
  ctx.arcTo(x,y+h,x,y+h-r,r);
  ctx.lineTo(x,y+r);
  ctx.arcTo(x,y,x+r,y,r);
  ctx.closePath();
}

// ════════════════════════════════════════════════════════
// 7. ANIMATION LOOP
// ════════════════════════════════════════════════════════
function ngAnimate() {
  if (NG.sim.running) {
    ngTick(NG.nodes, NG.edges, NG.W, NG.H, NG.sim.alpha, NG.forceK);
    NG.sim.alpha *= NG.sim.decay;
    if (NG.sim.alpha < NG.sim.minAlpha) {
      NG.sim.alpha   = NG.sim.minAlpha;
      NG.sim.running = false;
    }
  }
  ngDraw();
  NG.animFrame = requestAnimationFrame(ngAnimate);
}

// ════════════════════════════════════════════════════════
// 8. INTERACTIONS  (mouse + touch)
// ════════════════════════════════════════════════════════
function _canvasXY(e) {
  var rect = NG.canvas.getBoundingClientRect();
  var cx   = (e.clientX || (e.touches&&e.touches[0].clientX)) - rect.left;
  var cy   = (e.clientY || (e.touches&&e.touches[0].clientY)) - rect.top;
  return { cx:cx, cy:cy,
           wx:(cx - NG.tx)/NG.scale,
           wy:(cy - NG.ty)/NG.scale };
}

function _hitNode(wx, wy) {
  var best = null, bestD2 = Infinity;
  NG.nodes.forEach(function(n) {
    if (!_nodeVisible(n)) return;
    var dx = wx-n.x, dy = wy-n.y, d2 = dx*dx+dy*dy;
    var r2 = (n.size+6)*(n.size+6);
    if (d2 < r2 && d2 < bestD2) { bestD2=d2; best=n; }
  });
  return best;
}

function ngSetupInteractions(canvas) {
  // Mouse move: hover + drag + pan
  canvas.addEventListener('mousemove', function(e) {
    var p = _canvasXY(e);
    if (NG.dragging) {
      NG.dragging.x  = p.wx + NG.dragOff.x;
      NG.dragging.y  = p.wy + NG.dragOff.y;
      NG.dragging.vx = 0; NG.dragging.vy = 0;
      NG.sim.running = true; NG.sim.alpha = Math.max(NG.sim.alpha, 0.3);
      canvas.style.cursor = 'grabbing';
    } else if (NG.panning) {
      NG.tx = NG.panStart.tx + (e.clientX - NG.panStart.cx);
      NG.ty = NG.panStart.ty + (e.clientY - NG.panStart.cy);
    } else {
      var hit = _hitNode(p.wx, p.wy);
      NG.hovered = hit;
      canvas.style.cursor = hit ? 'pointer' : 'grab';
    }
  });

  canvas.addEventListener('mousedown', function(e) {
    var p   = _canvasXY(e);
    var hit = _hitNode(p.wx, p.wy);
    if (hit) {
      NG.dragging = hit;
      NG.dragOff  = { x:hit.x - p.wx, y:hit.y - p.wy };
      canvas.style.cursor = 'grabbing';
    } else {
      NG.panning  = true;
      NG.panStart = { cx:e.clientX, cy:e.clientY, tx:NG.tx, ty:NG.ty };
    }
    e.preventDefault();
  });

  canvas.addEventListener('mouseup', function(e) {
    if (NG.dragging) {
      NG.dragging = null;
    } else if (NG.panning) {
      // If barely moved → click to select
      var moved = Math.abs(e.clientX-NG.panStart.cx)+Math.abs(e.clientY-NG.panStart.cy);
      if (moved < 4) {
        var p   = _canvasXY(e);
        var hit = _hitNode(p.wx, p.wy);
        if (hit) ngShowDetail(hit);
        else ngCloseDetail();
      }
    }
    NG.panning  = false;
    NG.dragging = null;
    canvas.style.cursor = 'grab';
  });

  canvas.addEventListener('mouseleave', function() {
    NG.hovered  = null;
    NG.dragging = null;
    NG.panning  = false;
  });

  // Wheel zoom
  canvas.addEventListener('wheel', function(e) {
    e.preventDefault();
    var rect   = canvas.getBoundingClientRect();
    var mx     = e.clientX - rect.left;
    var my     = e.clientY - rect.top;
    var factor = e.deltaY < 0 ? 1.12 : 0.89;
    var newScale = Math.max(0.1, Math.min(5, NG.scale * factor));
    // Zoom towards cursor
    NG.tx = mx - (mx - NG.tx) * (newScale / NG.scale);
    NG.ty = my - (my - NG.ty) * (newScale / NG.scale);
    NG.scale = newScale;
  }, { passive:false });
}

// ════════════════════════════════════════════════════════
// 9. DETAIL PANEL
// ════════════════════════════════════════════════════════
function ngShowDetail(n) {
  var panel = document.getElementById('ng-detail');
  var body  = document.getElementById('ng-detail-body');
  var badge = document.getElementById('ng-detail-type-badge');
  if (!panel || !body) return;

  var col   = n.color || '#60A5FA';
  if (badge) {
    badge.textContent  = n.type.toUpperCase();
    badge.style.background = col + '22';
    badge.style.color      = col;
    badge.style.borderColor= col + '44';
  }

  var html = '';
  if (n.type === 'news') {
    var sevCol = n.severity>=7?'var(--re)':n.severity>=5?'var(--am)':'var(--gr)';
    var commCol= NG_COMM_PALETTE[n.community % NG_COMM_PALETTE.length];
    html = '<div class="ng-det-title">' + (n.label||'') + '</div>'
      + '<div class="ng-det-meta">'
      + '<span class="ng-det-pill" style="background:'+col+'22;color:'+col+'">' + (n.category||'') + '</span>'
      + '<span class="ng-det-pill" style="color:'+sevCol+'">⚡ ' + (n.severity||0).toFixed(1) + '</span>'
      + '<span class="ng-det-pill" style="background:'+commCol+'22;color:'+commCol+'">community ' + n.community + '</span>'
      + '</div>'
      + (n.country ? '<div class="ng-det-row"><span>🌍</span><span>' + n.country + '</span></div>' : '')
      + (n.source  ? '<div class="ng-det-row"><span>📡</span><span>' + n.source + '</span></div>' : '')
      + '<div class="ng-det-row"><span>📊</span><span>Degree ' + n.degree + ' · Centrality ' + ((n.degree_centrality||0)*100).toFixed(1) + '%</span></div>'
      + (n.summary ? '<div class="ng-det-summary">' + n.summary + '</div>' : '')
      + '<div class="ng-det-actions">'
      + (n.url ? '<a href="'+n.url+'" target="_blank" class="btn btn-g btn-sm">Read Source ↗</a>' : '')
      + '<button class="btn btn-o btn-sm" onclick="openEP(\''+n.id+'\')">Full Details</button>'
      + '</div>';
  } else {
    var connectedNews = NG.edges
      .filter(function(e){ return (e.tgt===n.id || e.src===n.id) && e.type==='mentions'; })
      .map(function(e){ return NG.nodeMap[e.src===n.id?e.tgt:e.src]; })
      .filter(function(x){ return x && x.type==='news'; })
      .slice(0,5);

    html = '<div class="ng-det-title">' + (n.label||'') + '</div>'
      + '<div class="ng-det-meta">'
      + '<span class="ng-det-pill" style="background:'+col+'22;color:'+col+'">' + n.type + '</span>'
      + '<span class="ng-det-pill">× ' + (n.mention_count||1) + ' mentions</span>'
      + '</div>'
      + '<div class="ng-det-row"><span>📊</span><span>Degree ' + n.degree + ' · Centrality ' + ((n.degree_centrality||0)*100).toFixed(1) + '%</span></div>'
      + '<div class="ng-det-row"><span>🏘</span><span>Community ' + n.community + '</span></div>';

    if (connectedNews.length) {
      html += '<div class="ng-det-related-title">Mentioned in:</div>';
      connectedNews.forEach(function(nn) {
        html += '<div class="ng-det-news-row" onclick="openEP(\''+nn.id+'\')">'
          + '<span style="font-size:9px;color:'+NG_NODE_COLORS['news']+'">● </span>'
          + '<span>' + (nn.label||'').slice(0,45) + '</span></div>';
      });
    }

    if (n.type === 'ticker') {
      html += '<div class="ng-det-actions">'
        + '<button class="btn btn-g btn-sm" onclick="selectMktAsset(\''+n.label+'\',\''+n.label+'\')">Open Chart →</button>'
        + '</div>';
    }
  }

  body.innerHTML  = html;
  panel.style.display = 'flex';
}

function ngCloseDetail() {
  var panel = document.getElementById('ng-detail');
  if (panel) panel.style.display = 'none';
}

// ════════════════════════════════════════════════════════
// 10. PUBLIC API  (called from HTML)
// ════════════════════════════════════════════════════════

async function ngBuild() {
  track('graph_built', 'graph', document.getElementById('ng-hours')&&document.getElementById('ng-hours').value||'24');
  var btn  = document.getElementById('ng-build-btn');
  var load = document.getElementById('ng-loading');
  var empty = document.getElementById('ng-empty');
  var canvas = document.getElementById('ng-canvas');
  var infoBar = document.getElementById('ng-info-bar');
  var zoomCtrls = document.getElementById('ng-zoom-ctrls');

  if (btn) { btn.disabled = true; btn.innerHTML = '<span id="ng-build-icon">⏳</span> Building…'; }
  if (load)  { load.style.display = 'flex'; }
  if (empty) { empty.style.display = 'none'; }
  if (canvas){ canvas.style.display = 'none'; }
  // Reset enhancement state
  NG.pinnedNodes      = new Set();
  NG.highlighted      = null;
  NG._activeCommunity = null;
  NG.minDegree        = 0;
  NG.entityFilter     = 'ALL';

  _ngLoadingMsg('Fetching events…', '');

  // Fetch events from API if G.events is empty
  var events = G.events || [];
  if (!events.length) {
    var hours  = (document.getElementById('ng-hours')||{value:'24'}).value;
    var minSev = (document.getElementById('ng-severity')||{value:'4.5'}).value;
    var r      = await rq('/api/events?limit=800&hours=' + hours + '&min_severity=' + minSev);
    if (r && r.events) events = r.events;
  }

  if (!events.length) {
    _ngLoadingMsg('No events found', 'Try increasing the time window or lowering the severity filter');
    if (btn) { btn.disabled=false; btn.innerHTML='<span>⚡</span> Build Graph'; }
    return;
  }

  _ngLoadingMsg('Extracting entities…', events.length + ' news articles');
  await _ngDelay(10);

  // Build graph
  var simThresh = parseFloat((document.getElementById('ng-sim-thresh')||{value:'0.25'}).value) || 0.25;
  var maxNodes  = parseInt((document.getElementById('ng-maxnodes')||{value:'80'}).value) || 80;

  var graph = ngBuildGraph(events, { maxNodes:maxNodes, simThreshold:simThresh });
  _ngLoadingMsg('Computing communities & centrality…', graph.nodes.length + ' nodes · ' + graph.edges.length + ' edges');
  await _ngDelay(10);

  // Enrich
  var nComm = ngEnrich(graph.nodes, graph.edges, graph.nodeMap);

  NG.nodes   = graph.nodes;
  NG.edges   = graph.edges;
  NG.nodeMap = graph.nodeMap;
  NG.built   = true;

  // Init canvas
  var wrap = document.getElementById('ng-canvas-wrap');
  canvas   = document.getElementById('ng-canvas');
  NG.canvas = canvas;
  NG.ctx    = canvas.getContext('2d');
  NG.W      = wrap.offsetWidth  || window.innerWidth - 260;
  NG.H      = wrap.offsetHeight || window.innerHeight;
  canvas.width  = NG.W;
  canvas.height = NG.H;

  // Init viewport
  NG.scale = 1; NG.tx = 0; NG.ty = 0;
  NG.hovered = null; NG.dragging = null;

  _ngLoadingMsg('Running force layout…', '');
  await _ngDelay(10);

  // Layout
  ngInitLayout(NG.nodes, NG.W, NG.H);

  // Start simulation
  NG.sim.alpha   = 1.0;
  NG.sim.running = true;
  NG.sim.decay   = 0.94;
  NG.forceK      = parseFloat((document.getElementById('ng-force')||{value:'1'}).value) || 1;

  // Setup interactions
  ngSetupInteractions(canvas);

  // Show canvas
  if (load)   { load.style.display = 'none'; }
  canvas.style.display = 'block';
  if (infoBar){ infoBar.style.display = 'flex'; }
  if (zoomCtrls){ zoomCtrls.style.display = 'flex'; }

  // Update stats
  _ngUpdateStats(graph.nodes, graph.edges, nComm);

  if (btn) { btn.disabled=false; btn.innerHTML='<span>⚡</span> Rebuild'; }

  // Start animation
  if (NG.animFrame) cancelAnimationFrame(NG.animFrame);
  ngAnimate();
}

function ngRedraw() {
  function chk(id, def) { var e=document.getElementById(id); return e?e.checked:def; }
  function sel(id, def) { var e=document.getElementById(id); return e?e.value:def; }
  NG.showNews       = chk('ng-show-news',       true);
  NG.showEntities   = chk('ng-show-entities',   true);
  NG.showSimilarity = chk('ng-show-similarity', true);
  NG.showCooc       = chk('ng-show-cooc',        true);
  NG.showMentions   = chk('ng-show-mentions',    true);
  NG.catFilter      = sel('ng-cat-filter',     'ALL');
  NG.entityFilter   = sel('ng-entity-filter',  'ALL');
  NG.minDegree      = parseInt(sel('ng-min-degree','0')) || 0;
  ngDraw();
}

function ngSetForce(val) {
  NG.forceK      = parseFloat(val) || 1;
  NG.sim.alpha   = Math.max(NG.sim.alpha, 0.5);
  NG.sim.running = true;
}

function ngResetLayout() {
  if (!NG.nodes.length) return;
  ngInitLayout(NG.nodes, NG.W, NG.H);
  NG.sim.alpha   = 1.0;
  NG.sim.running = true;
  NG.scale = 1; NG.tx = 0; NG.ty = 0;
}

function ngFitToView() {
  if (!NG.nodes.length) return;
  var xs = NG.nodes.map(function(n){return n.x;}), ys = NG.nodes.map(function(n){return n.y;});
  var minX=Math.min.apply(null,xs), maxX=Math.max.apply(null,xs);
  var minY=Math.min.apply(null,ys), maxY=Math.max.apply(null,ys);
  var pw = maxX-minX+80, ph = maxY-minY+80;
  var newScale = Math.min(NG.W/Math.max(pw,1), NG.H/Math.max(ph,1), 2);
  NG.scale = Math.max(0.1, newScale);
  NG.tx    = NG.W/2 - ((minX+maxX)/2)*NG.scale;
  NG.ty    = NG.H/2 - ((minY+maxY)/2)*NG.scale;
}

function ngZoomIn()  { NG.scale = Math.min(5, NG.scale*1.25); }
function ngZoomOut() { NG.scale = Math.max(0.1, NG.scale*0.8); }

function ngExportJSON() {
  var data = {
    nodes: NG.nodes.map(function(n){
      return { id:n.id, label:n.label, type:n.type, community:n.community,
               degree:n.degree, degree_centrality:n.degree_centrality,
               pagerank:n.pagerank||0, severity:n.severity, category:n.category };
    }),
    edges: NG.edges.map(function(e){
      return { source:e.src, target:e.tgt, type:e.type, weight:e.weight };
    }),
    stats: {
      n_nodes: NG.nodes.length, n_edges: NG.edges.length,
      n_communities: new Set(NG.nodes.map(function(n){return n.community;})).size,
    }
  };
  var blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download= 'worldlens_graph_' + new Date().toISOString().slice(0,10) + '.json';
  a.click();
}

// ── Helpers ─────────────────────────────────────────────
function _ngLoadingMsg(msg, sub) {
  var el1 = document.getElementById('ng-loading-msg');
  var el2 = document.getElementById('ng-loading-sub');
  if (el1) el1.textContent = msg;
  if (el2) el2.textContent = sub;
}

function _ngDelay(ms) { return new Promise(function(r){ setTimeout(r, ms); }); }

function _ngUpdateStats(nodes, edges, nComm) {
  var statsDiv = document.getElementById('ng-stats');
  var statsBody = document.getElementById('ng-stats-body');
  var infoBar   = document.getElementById('ng-info-bar');

  var newsCount = nodes.filter(function(n){return n.type==='news';}).length;
  var entCount  = nodes.length - newsCount;
  var simEdges  = edges.filter(function(e){return e.type==='similarity';}).length/2 | 0;

  // Info bar
  var barNodes = document.getElementById('ng-bar-nodes');
  var barEdges = document.getElementById('ng-bar-edges');
  var barComm  = document.getElementById('ng-bar-communities');
  var barTime  = document.getElementById('ng-bar-time');
  if (barNodes)   barNodes.textContent   = nodes.length + ' nodes';
  if (barEdges)   barEdges.textContent   = edges.length + ' edges';
  if (barComm)    barComm.textContent    = nComm + ' communities';
  if (barTime)    barTime.textContent    = 'sim ×' + simEdges;

  // Sidebar stats
  if (statsDiv) statsDiv.style.display = 'block';
  if (statsBody) {
    // Top-5 nodes by degree centrality
    var top5 = nodes.slice().sort(function(a,b){return b.degree_centrality-a.degree_centrality;}).slice(0,5);
    _ngRenderCommunityLegend(nodes, nComm);
  statsBody.innerHTML =
      '<div class="ng-stat-row"><span>News nodes</span><span>' + newsCount + '</span></div>'
      + '<div class="ng-stat-row"><span>Entity nodes</span><span>' + entCount + '</span></div>'
      + '<div class="ng-stat-row"><span>Mentions edges</span><span>' + edges.filter(function(e){return e.type==='mentions';}).length + '</span></div>'
      + '<div class="ng-stat-row"><span>Similarity edges</span><span>' + simEdges + '</span></div>'
      + '<div class="ng-stat-row"><span>Communities</span><span>' + nComm + '</span></div>'
      + '<div style="font-size:9px;color:var(--t3);margin-top:8px;margin-bottom:4px;text-transform:uppercase;letter-spacing:.08em">Top by centrality</div>'
      + top5.map(function(n,i) {
          var col = n.color || '#60A5FA';
          return '<div class="ng-stat-row" onclick="ngShowDetail(NG.nodeMap[\''+n.id+'\'])" style="cursor:pointer">'
            + '<span style="color:'+col+'">'+['🥇','🥈','🥉','④','⑤'][i]+' '+(n.label||'').slice(0,20)+'</span>'
            + '<span style="color:var(--b4)">'+((n.degree_centrality||0)*100).toFixed(0)+'%</span>'
            + '</div>';
        }).join('');
  }
}

// Hook into sv() to auto-build when opening Graph view
var _svOrig12 = (typeof sv === 'function') ? sv : null;
if (typeof sv === 'function') {
  var __sv12base = sv;
  sv = function(view, btn) {
    __sv12base(view, btn);
    if (view === 'graph' && !NG.built) {
      // Auto-build after a short delay so the view renders first
      setTimeout(ngBuild, 200);
    } else if (view === 'graph' && NG.built && NG.canvas) {
      // Re-size if panel was resized
      var wrap = document.getElementById('ng-canvas-wrap');
      if (wrap) {
        var W = wrap.offsetWidth, H = wrap.offsetHeight;
        if (W && H && (W !== NG.W || H !== NG.H)) {
          NG.W = W; NG.H = H;
          NG.canvas.width = W; NG.canvas.height = H;
        }
      }
    }
  };
}

// ════════════════════════════════════════════════════════
// ════════════════════════════════════════════════════════
// GRAPH ENHANCEMENTS — added cleanly (no patching)
// Search, pin, community legend, canonicalization, entity filter
// ════════════════════════════════════════════════════════

// ── Node search ──────────────────────────────────────────
function ngSearchNodes(q) {
  var resEl = document.getElementById('ng-search-results');
  if (!resEl) return;
  NG.highlighted = null;
  if (!q || q.length < 2) { resEl.style.display='none'; resEl.innerHTML=''; return; }
  var ql = q.toLowerCase();
  var matches = NG.nodes.filter(function(n) {
    return (n.label||'').toLowerCase().includes(ql) ||
           (n.type||'').toLowerCase().includes(ql) ||
           (n.category||'').toLowerCase().includes(ql);
  }).slice(0, 12);
  if (!matches.length) {
    resEl.style.display = 'block';
    resEl.innerHTML = '<div style="padding:8px;font-size:10px;color:var(--t3)">No matches</div>';
    return;
  }
  resEl.style.display = 'block';
  resEl.innerHTML = matches.map(function(n) {
    var col = NG_NODE_COLORS[n.type] || '#94A3B8';
    return '<div class="ng-search-row" onclick="ngFocusNode(\'' + n.id.replace(/'/g,"\\'") + '\')">'
      + '<span style="width:7px;height:7px;border-radius:50%;background:' + col
      + ';display:inline-block;flex-shrink:0;margin-right:5px"></span>'
      + '<span style="font-size:9px;color:' + col + ';text-transform:uppercase;margin-right:4px">' + n.type + '</span>'
      + '<span style="font-size:10px;color:var(--t1)">' + (n.label||'').slice(0,35) + '</span>'
      + '</div>';
  }).join('');
}

function ngFocusNode(nodeId) {
  var n = NG.nodeMap[nodeId];
  if (!n) return;
  NG.highlighted = nodeId;
  var resEl = document.getElementById('ng-search-results');
  if (resEl) resEl.style.display = 'none';
  var inp = document.getElementById('ng-search-inp');
  if (inp) inp.value = n.label || '';
  // Smooth pan to node
  if (NG.canvas) {
    var steps = 18, step = 0;
    var tx0 = NG.tx, ty0 = NG.ty;
    var txT = NG.W/2 - n.x*NG.scale;
    var tyT = NG.H/2 - n.y*NG.scale;
    function panStep() {
      step++;
      var t = step/steps;
      var ease = 1 - Math.pow(1-t, 3);  // ease-out cubic
      NG.tx = tx0 + (txT-tx0)*ease;
      NG.ty = ty0 + (tyT-ty0)*ease;
      if (step < steps) requestAnimationFrame(panStep);
      else ngShowDetail(n);
    }
    panStep();
  } else {
    ngShowDetail(n);
  }
}

// ── Pin / unpin ──────────────────────────────────────────
function ngTogglePin(nodeId) {
  if (!NG.pinnedNodes) NG.pinnedNodes = new Set();
  if (NG.pinnedNodes.has(nodeId)) {
    NG.pinnedNodes.delete(nodeId);
    toast('Node unpinned', 's');
  } else {
    NG.pinnedNodes.add(nodeId);
    var n = NG.nodeMap[nodeId];
    if (n) { n.vx=0; n.vy=0; }
    toast('Node pinned — it won\'t move during layout', 's');
  }
  ngDraw();
}

// Freeze pinned nodes in the simulation tick
var _ngTick_orig = ngTick;
ngTick = function(nodes, edges, W, H, alpha, forceK) {
  _ngTick_orig(nodes, edges, W, H, alpha, forceK);
  if (NG.pinnedNodes && NG.pinnedNodes.size > 0) {
    NG.pinnedNodes.forEach(function(id) {
      var n = NG.nodeMap[id];
      if (n) { n.vx=0; n.vy=0; }
    });
  }
};

// ── Min-degree slider ────────────────────────────────────
function ngSetMinDegree(val) {
  NG.minDegree = parseInt(val) || 0;
  var lbl = document.getElementById('ng-min-degree-val');
  if (lbl) lbl.textContent = NG.minDegree;
  ngDraw();
}

// ── Community filter ─────────────────────────────────────
function ngFilterByCommunity(commId) {
  if (NG._activeCommunity === commId) {
    NG._activeCommunity = null;
    toast('Community filter cleared', 's');
  } else {
    NG._activeCommunity = commId;
    toast('Showing community ' + commId + ' only', 's');
  }
  ngDraw();
}

// ── Community legend render ──────────────────────────────
function _ngRenderCommunityLegend(nodes, nComm) {
  var legendEl = document.getElementById('ng-comm-legend');
  var bodyEl   = document.getElementById('ng-comm-legend-body');
  if (!legendEl || !bodyEl) return;
  if (nComm < 2) { legendEl.style.display='none'; return; }
  legendEl.style.display = 'block';

  // Group nodes by community
  var groups = {};
  nodes.forEach(function(n) {
    var c = n.community;
    if (!groups[c]) groups[c] = {id:c, nodes:[], newsCount:0, entCount:0};
    groups[c].nodes.push(n);
    if (n.type==='news') groups[c].newsCount++;
    else groups[c].entCount++;
  });

  var sorted = Object.values(groups)
    .sort(function(a,b){ return b.nodes.length - a.nodes.length; })
    .slice(0, 10);

  bodyEl.innerHTML = sorted.map(function(g) {
    var col   = NG_COMM_PALETTE[g.id % NG_COMM_PALETTE.length];
    var isActive = NG._activeCommunity === g.id;
    var topNodes = g.nodes.sort(function(a,b){return b.degree-a.degree;}).slice(0,3);
    var preview  = topNodes.map(function(n){return (n.label||'').slice(0,12);}).join(', ');
    return '<div class="ng-comm-row" onclick="ngFilterByCommunity(' + g.id + ')"'
      + ' style="background:' + (isActive ? col+'22' : '') + ';border-color:' + (isActive ? col : 'transparent') + '">'
      + '<div class="ng-comm-dot" style="background:' + col + '"></div>'
      + '<div style="flex:1;min-width:0;overflow:hidden">'
      + '<div style="font-size:9px;font-weight:600;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + preview + '</div>'
      + '<div style="font-size:8px;color:var(--t3)">' + g.newsCount + ' news · ' + g.entCount + ' ent.</div>'
      + '</div>'
      + '<span style="font-size:10px;font-weight:700;color:' + col + ';flex-shrink:0">' + g.nodes.length + '</span>'
      + '</div>';
  }).join('');
}

// ── Canonicalization ─────────────────────────────────────
// Merge nodes with identical canonical form (runs after graph build, before enrich)
function ngCanonicalizeNodes() {
  var ALIASES = {
    'co:fed_':       'co:federal_reserve',
    'co:ecb_':       'co:european_central_bank',
    'co:eu':         'co:european_union',
    'lo:US':         'lo:US',  // already canonical
    'co:u_s_':       'co:united_states',      // org mention
    'lo:GB':         'lo:GB',
  };

  // Build a label-based merge map for entities of same type
  var labelToId = {};  // "type:canonicalLabel" → first-seen node id
  var mergeMap  = {};  // nodeId → canonical nodeId

  NG.nodes.forEach(function(n) {
    if (n.type === 'news') return;
    var canon = (n.label||'').toLowerCase()
      .replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'');
    var key = n.type + ':' + canon;
    if (!labelToId[key]) {
      labelToId[key] = n.id;
    } else if (labelToId[key] !== n.id) {
      mergeMap[n.id] = labelToId[key];  // merge this into the first seen
    }
  });

  if (!Object.keys(mergeMap).length) return;

  // Redirect all edges
  NG.edges.forEach(function(e) {
    if (mergeMap[e.src]) e.src = mergeMap[e.src];
    if (mergeMap[e.tgt]) e.tgt = mergeMap[e.tgt];
  });
  // Remove self-loops created by merging
  NG.edges = NG.edges.filter(function(e){ return e.src !== e.tgt; });

  // Remove merged-away nodes, transfer mention count
  var toRemove = new Set(Object.keys(mergeMap));
  NG.nodes.forEach(function(n) {
    if (mergeMap[n.id]) {
      var target = NG.nodeMap[mergeMap[n.id]];
      if (target) target.mention_count = (target.mention_count||1) + (n.mention_count||1);
    }
  });
  NG.nodes  = NG.nodes.filter(function(n){ return !toRemove.has(n.id); });
  NG.nodeMap = {};
  NG.nodes.forEach(function(n){ NG.nodeMap[n.id] = n; });
}

// Patch ngBuild to call canonicalize before enrich
var _ngBuild_orig = ngBuild;
ngBuild = async function() {
  // Override _ngUpdateStats temporarily so we can inject canonicalization
  var _stats_orig = _ngUpdateStats;
  _ngUpdateStats = function(nodes, edges, nComm) {
    // Run canonicalization then re-enrich
    ngCanonicalizeNodes();
    var nCommNew = ngEnrich(NG.nodes, NG.edges, NG.nodeMap);
    _stats_orig(NG.nodes, NG.edges, nCommNew);
    _ngUpdateStats = _stats_orig;  // restore
  };
  return await _ngBuild_orig();
};

// ── ngShowDetail: add pin button ─────────────────────────
var _ngShowDetail_orig = ngShowDetail;
ngShowDetail = function(n) {
  _ngShowDetail_orig(n);
  var body = document.getElementById('ng-detail-body');
  if (!body) return;
  if (!NG.pinnedNodes) NG.pinnedNodes = new Set();
  var isPinned = NG.pinnedNodes.has(n.id);
  body.insertAdjacentHTML('beforeend',
    '<button class="btn btn-g btn-xs" style="width:100%;margin-top:8px" '
    + 'onclick="ngTogglePin(\'' + n.id.replace(/'/g,"\\'") + '\')">'
    + (isPinned ? '📍 Unpin' : '📌 Pin node') + '</button>'
  );
};
