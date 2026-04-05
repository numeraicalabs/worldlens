/**
 * @file 15_knowledge_explorer.js
 * @module WorldLens / Knowledge Explorer
 *
 * Transforms the Graph view into a semantic knowledge discovery tool.
 *
 * Architecture
 * ────────────
 *  User types "semiconductors"
 *       ↓
 *  kexSearch()
 *       ↓  queries G.events (live) + static knowledge base + external links
 *  KexGraphBuilder  →  builds node/edge data (no canvas, pure SVG+D3-like)
 *       ↓
 *  KexRenderer  →  SVG force-directed graph (self-contained, no Three.js)
 *       ↓
 *  Radial layout  (default, clean)  OR  Force layout  (organic)
 *       ↓
 *  Click node  →  KexDetailPanel  →  external links, related concepts
 *
 * Node types
 * ──────────
 *  event      Blue    live news event from G.events
 *  concept    Green   stable concept / topic
 *  entity     Amber   country, company, person (from dependency engine)
 *  source     Purple  external URL (Wikipedia, Investopedia, Reuters…)
 *
 * No external deps — pure vanilla JS + inline SVG.
 */

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
var KEX = {
  query:      '',
  nodes:      [],    // [{id, label, type, weight, url, description, meta}]
  edges:      [],    // [{src, tgt, label, weight}]
  selected:   null,  // selected node id
  layout:     'radial',
  svg:        null,
  svgG:       null,   // transform group inside SVG
  zoom:       1,
  panX:       0,
  panY:       0,
  isDragging: false,
  dragNode:   null,
  breadcrumb: [],   // history of explored terms
  _history:   [],   // for back navigation
  W: 0, H: 0,
};

// ── Node colours ──────────────────────────────────────
var KEX_COLORS = {
  event:     '#3B82F6',
  concept:   '#10B981',
  entity:    '#F59E0B',
  source:    '#8B5CF6',
  query:     '#EF4444',   // central seed node
};

// ── External source templates ─────────────────────────
var KEX_SOURCES = {
  // key → {label, urlFn, icon}
  wikipedia:     { label:'Wikipedia',     icon:'📖', urlFn: function(q){ return 'https://en.wikipedia.org/wiki/'+encodeURIComponent(q.replace(/\s+/g,'_')); } },
  investopedia:  { label:'Investopedia',  icon:'💰', urlFn: function(q){ return 'https://www.investopedia.com/search?q='+encodeURIComponent(q); } },
  reuters:       { label:'Reuters',       icon:'📰', urlFn: function(q){ return 'https://www.reuters.com/search/news?blob='+encodeURIComponent(q); } },
  ft:            { label:'Financial Times', icon:'🗞', urlFn: function(q){ return 'https://search.ft.com/search?queryText='+encodeURIComponent(q); } },
  scholar:       { label:'Google Scholar', icon:'🎓', urlFn: function(q){ return 'https://scholar.google.com/scholar?q='+encodeURIComponent(q); } },
  cfr:           { label:'CFR',            icon:'🌐', urlFn: function(q){ return 'https://www.cfr.org/search-results?search_api_fulltext='+encodeURIComponent(q); } },
  bis:           { label:'BIS',            icon:'🏦', urlFn: function(q){ return 'https://www.bis.org/search/?q='+encodeURIComponent(q); } },
};

// ── Static concept taxonomy ───────────────────────────
// topic → {related_concepts[], entity_hints[], source_types[]}
var KEX_TAXONOMY = {
  'semiconductors': {
    related:  ['Supply Chain','Export Controls','Chip Manufacturing','TSMC','Lithography',
                'Moore\'s Law','EDA Tools','Fabless Design','Foundry','Advanced Packaging'],
    entities: ['country:US','country:CN','country:TW','country:KR','company:NVDA',
                'company:INTC','company:ASML','company:TSM','sector:Semiconductors'],
    sources:  ['wikipedia','investopedia','reuters','scholar'],
  },
  'trade war': {
    related:  ['Tariffs','WTO','Sanctions','Import Duties','Retaliatory Tariffs',
                'Supply Chain Diversification','De-risking','Protectionism'],
    entities: ['country:US','country:CN','country:EU','sector:Semiconductors'],
    sources:  ['wikipedia','reuters','ft','cfr'],
  },
  'federal reserve': {
    related:  ['Interest Rates','Monetary Policy','Inflation','FOMC','Quantitative Easing',
                'Yield Curve','Dollar Strength','Recession Risk'],
    entities: ['asset:USD','asset:SP500','asset:VIX','person:Jerome_Powell'],
    sources:  ['wikipedia','investopedia','ft','bis'],
  },
  'energy crisis': {
    related:  ['Natural Gas Prices','Oil Supply','OPEC','LNG','Energy Transition',
                'Renewable Energy','Energy Security','Sanctions'],
    entities: ['country:RU','country:SA','country:EU','commodity:Natural_Gas',
                'commodity:Crude_Oil','sector:Energy'],
    sources:  ['wikipedia','reuters','ft','cfr'],
  },
  'ai regulation': {
    related:  ['AI Safety','EU AI Act','Algorithmic Bias','Data Privacy','Foundation Models',
                'AI Governance','Digital Sovereignty','Tech Policy'],
    entities: ['country:EU','country:US','company:NVDA','company:GOOGL',
                'sector:Artificial_Intelligence'],
    sources:  ['wikipedia','reuters','scholar','cfr'],
  },
  'ukraine conflict': {
    related:  ['NATO','Sanctions','Grain Exports','Energy Embargo','War Economy',
                'Weapons Supply','Ceasefire Talks','Reconstruction'],
    entities: ['country:UA','country:RU','country:US','country:EU',
                'person:Vladimir_Putin','person:Zelensky'],
    sources:  ['wikipedia','reuters','ft','cfr'],
  },
  'inflation': {
    related:  ['CPI','Core Inflation','Supply Shock','Wage Growth','Price Controls',
                'Stagflation','Monetary Tightening','Commodity Prices'],
    entities: ['asset:USD','asset:Gold','commodity:Crude_Oil'],
    sources:  ['wikipedia','investopedia','ft','bis'],
  },
  'bitcoin': {
    related:  ['Cryptocurrency','Blockchain','DeFi','Stablecoin','Mining','ETF Approval',
                'Regulatory Framework','Digital Assets'],
    entities: ['commodity:Bitcoin','commodity:Ethereum','asset:USD'],
    sources:  ['wikipedia','investopedia','reuters'],
  },
};

// Generic fallback concepts for any query not in taxonomy
var KEX_GENERIC_SOURCES = ['wikipedia','reuters','scholar'];

// ══════════════════════════════════════════════════════
// MODE SWITCHER
// ══════════════════════════════════════════════════════

function ngSwitchMode(mode, btn) {
  // ── Tab highlight ──────────────────────────────────────
  document.querySelectorAll('.ng-tab').forEach(function(b) {
    b.classList.toggle('on', b === btn);
  });

  // ── Element refs ───────────────────────────────────────
  var modePanels = {
    graph:    document.getElementById('ng-mode-graph'),
    explorer: document.getElementById('ng-mode-explorer'),
    timeline: document.getElementById('ng-mode-timeline'),
    cascade:  document.getElementById('ng-mode-cascade'),
  };

  // Canvas-wrap is the SHARED positioning parent — always stays display:flex.
  // Only its CHILDREN (ng-canvas, kex/tl/cas wraps) are swapped.
  var ngCanvasWrap = document.getElementById('ng-canvas-wrap');
  var ngCanvas     = document.getElementById('ng-canvas');     // the <canvas> element
  var ngEmpty      = document.getElementById('ng-empty');
  var ngLoading    = document.getElementById('ng-loading');
  var kexCanvas    = document.getElementById('kex-canvas-wrap');
  var tlCanvas     = document.getElementById('tl-canvas-wrap');
  var casCanvas    = document.getElementById('cas-canvas-wrap');
  var modeToggle   = document.getElementById('ng-mode-toggle');
  var zoomCtrls    = document.getElementById('ng-zoom-ctrls');
  var infoBar      = document.getElementById('ng-info-bar');

  // ── Keep canvas-wrap always visible (positioning parent) ─
  if (ngCanvasWrap) ngCanvasWrap.style.display = 'flex';

  // ── Hide ALL sidebar panels ────────────────────────────
  Object.values(modePanels).forEach(function(p) {
    if (p) p.style.display = 'none';
  });

  // ── Hide ALL overlay canvases (absolute children) ──────
  // Do NOT hide ngCanvasWrap itself — only its children
  if (ngCanvas)   ngCanvas.style.display   = 'none';
  if (ngEmpty)    ngEmpty.style.display    = 'none';
  if (kexCanvas)  kexCanvas.style.display  = 'none';
  if (tlCanvas)   tlCanvas.style.display   = 'none';
  if (casCanvas)  casCanvas.style.display  = 'none';
  if (modeToggle) modeToggle.style.display = 'none';
  if (zoomCtrls)  zoomCtrls.style.display  = 'none';
  if (infoBar)    infoBar.style.display    = 'none';

  // ── Stop animation ─────────────────────────────────────
  if (NG.animFrame) { cancelAnimationFrame(NG.animFrame); NG.animFrame = null; }

  // ── Activate requested mode ────────────────────────────
  if (mode === 'graph') {
    if (modePanels.graph) modePanels.graph.style.display = 'flex';
    // Show the 2D canvas (or empty state)
    if (NG.built) {
      if (ngCanvas)  ngCanvas.style.display  = 'block';
      if (modeToggle) modeToggle.style.display = 'flex';
      if (zoomCtrls)  zoomCtrls.style.display  = 'flex';
      if (infoBar)    infoBar.style.display     = 'flex';
      if (!NG.animFrame) ngAnimate();
    } else {
      if (ngEmpty) ngEmpty.style.display = 'flex';
    }

  } else if (mode === 'explorer') {
    if (modePanels.explorer) modePanels.explorer.style.display = 'flex';
    if (kexCanvas)  kexCanvas.style.display  = 'flex';
    // Measure after display:flex is applied
    requestAnimationFrame(function() {
      _kexInitSVG();
      if (!KEX.query) _kexShowEmpty();
    });

  } else if (mode === 'timeline') {
    if (modePanels.timeline) modePanels.timeline.style.display = 'flex';
    if (tlCanvas)  tlCanvas.style.display  = 'flex';
    requestAnimationFrame(function() {
      _tlInitSVG();
      if (!TL.built) tlBuild();
      else if (TL.nodes && TL.nodes.length) _tlRender();
    });

  } else if (mode === 'cascade') {
    if (modePanels.cascade) modePanels.cascade.style.display = 'flex';
    if (casCanvas) casCanvas.style.display = 'flex';
    requestAnimationFrame(function() {
      _casInitSVG();
      if (!CAS.nodes.length) _casShowEmpty();
    });
  }

  // ── Mobile cascade sidebar visibility ──────────────────
  // Adds .cascade-active on sidebar so the CSS media query shows it on mobile
  var sidebar = document.querySelector('.ng-sidebar');
  if (sidebar) sidebar.classList.toggle('cascade-active', mode === 'cascade');
}

// ══════════════════════════════════════════════════════
// SEARCH ENTRY POINTS
// ══════════════════════════════════════════════════════

function kexSearch() {
  var q = (document.getElementById('kex-search-inp')||{}).value||'';
  track('explorer_search', 'graph', q.slice(0,80));
  var inp = document.getElementById('kex-search-inp');
  if (!inp || !inp.value.trim()) return;
  kexSearchTerm(inp.value.trim());
}

function kexSearchTerm(term) {
  // Update input
  var inp = document.getElementById('kex-search-inp');
  if (inp) inp.value = term;

  KEX.query = term;
  KEX.selected = null;

  // Breadcrumb history
  if (KEX.breadcrumb[KEX.breadcrumb.length - 1] !== term) {
    KEX.breadcrumb.push(term);
  }
  _kexUpdateBreadcrumb();

  // Show loading state
  _kexSetLoading(true);

  // Build graph data
  var data = _kexBuildGraph(term);
  KEX.nodes = data.nodes;
  KEX.edges = data.edges;

  // Update sidebar
  _kexRenderSidebarList(data.nodes);

  // Render graph
  _kexRender();

  _kexSetLoading(false);
  _kexHideNodeDetail();
}

// ══════════════════════════════════════════════════════
// GRAPH BUILDER
// ══════════════════════════════════════════════════════

function _kexBuildGraph(query) {
  var nodes = [];
  var edges = [];
  var nodeMap = {};
  var queryLower = query.toLowerCase();

  function addNode(n) {
    if (!nodeMap[n.id]) { nodeMap[n.id] = n; nodes.push(n); }
    return nodeMap[n.id];
  }
  function addEdge(src, tgt, label, weight) {
    if (src === tgt || !nodeMap[src] || !nodeMap[tgt]) return;
    // Dedup
    for (var i = 0; i < edges.length; i++) {
      if (edges[i].src === src && edges[i].tgt === tgt) {
        edges[i].weight = Math.max(edges[i].weight, weight);
        return;
      }
    }
    edges.push({ src:src, tgt:tgt, label:label||'', weight:weight||0.5 });
  }

  // ── 1. Central query node ────────────────────────────
  var seedId = 'query:' + query;
  addNode({
    id:    seedId,
    label: query,
    type:  'query',
    weight: 1.0,
    description: 'Search topic: ' + query,
    url:   null,
    ring:  0,
  });

  // ── 2. Look up taxonomy ──────────────────────────────
  var taxKey = null;
  for (var k in KEX_TAXONOMY) {
    if (queryLower.includes(k) || k.includes(queryLower)) {
      taxKey = k;
      break;
    }
  }
  var tax = taxKey ? KEX_TAXONOMY[taxKey] : null;

  // ── 3. Related concepts (ring 1) ─────────────────────
  var concepts = [];
  if (tax) {
    concepts = tax.related.slice(0, 8);
  } else {
    // Generic: extract related terms from live events
    concepts = _kexExtractConceptsFromEvents(query, 7);
  }
  concepts.forEach(function(c, i) {
    var cid = 'concept:' + c.replace(/\s/g, '_');
    addNode({
      id:    cid,
      label: c,
      type:  'concept',
      weight: 0.8 - i * 0.05,
      description: 'Related concept: ' + c,
      url:   null,
      ring:  1,
      searchable: c,
    });
    addEdge(seedId, cid, 'related', 0.75 - i * 0.04);
  });

  // ── 4. Live events (ring 1, interspersed) ────────────
  var matchedEvents = _kexFindMatchingEvents(query, 6);
  matchedEvents.forEach(function(ev, i) {
    var eid = 'event:' + ev.id;
    addNode({
      id:    eid,
      label: (ev.title || '').slice(0, 40),
      type:  'event',
      weight: Math.min(1.0, (ev.severity || 5) / 10),
      description: ev.title,
      url:   ev.url || ev.source_url || null,
      timestamp: ev.timestamp,
      category:  ev.category,
      severity:  ev.severity,
      country:   ev.country_name || ev.country_code,
      ring:  1,
    });
    addEdge(seedId, eid, 'mentions', 0.6 + (ev.severity || 5) / 50);
  });

  // ── 5. Entity nodes (ring 2) ─────────────────────────
  var entityIds = [];
  if (tax) {
    entityIds = tax.entities;
  } else {
    entityIds = _kexExtractEntitiesFromEvents(matchedEvents, 5);
  }
  entityIds.forEach(function(eid_raw) {
    var parts   = eid_raw.split(':');
    var etype   = parts[0];
    var ename   = (parts[1] || '').replace(/_/g, ' ');
    var nid     = 'entity:' + eid_raw.replace(/:/g, '_');
    addNode({
      id:    nid,
      label: ename,
      type:  'entity',
      weight: 0.7,
      description: etype.charAt(0).toUpperCase() + etype.slice(1) + ': ' + ename,
      url:   null,
      entityType: etype,
      entityId:   eid_raw,
      ring:  2,
      searchable: ename,
    });
    // Connect to seed and relevant events
    addEdge(seedId, nid, etype, 0.55);
    // Connect entity to events that mention it
    matchedEvents.forEach(function(ev) {
      var evText = ((ev.title || '') + ' ' + (ev.summary || '')).toLowerCase();
      if (evText.includes(ename.toLowerCase())) {
        addEdge('event:' + ev.id, nid, 'involves', 0.5);
      }
    });
  });

  // ── 6. Source nodes (ring 3) ─────────────────────────
  var srcTypes = tax ? tax.sources : KEX_GENERIC_SOURCES;
  srcTypes.forEach(function(srcKey) {
    var src = KEX_SOURCES[srcKey];
    if (!src) return;
    var snid = 'source:' + srcKey + '_' + query.replace(/\s/g, '_').slice(0, 20);
    addNode({
      id:    snid,
      label: src.icon + ' ' + src.label,
      type:  'source',
      weight: 0.65,
      description: 'Read about "' + query + '" on ' + src.label,
      url:   src.urlFn(query),
      sourceKey: srcKey,
      sourceName: src.label,
      ring:  3,
    });
    addEdge(seedId, snid, 'reference', 0.45);
  });

  // Add concept-specific sources for top concepts
  concepts.slice(0, 3).forEach(function(c) {
    var snid = 'source:wiki_' + c.replace(/\s/g, '_').slice(0, 20);
    addNode({
      id:    snid,
      label: '📖 Wikipedia',
      type:  'source',
      weight: 0.5,
      description: 'Wikipedia: ' + c,
      url:   KEX_SOURCES.wikipedia.urlFn(c),
      ring:  3,
    });
    var cid = 'concept:' + c.replace(/\s/g, '_');
    addEdge(cid, snid, 'reference', 0.4);
  });

  return { nodes: nodes, edges: edges };
}

// ── Helper: extract concepts from live events ─────────
function _kexExtractConceptsFromEvents(query, max) {
  if (!G || !G.events) return [];
  var q = query.toLowerCase();
  var termFreq = {};
  var stopWords = new Set(['the','a','an','and','or','but','in','on','at','to','for',
    'of','is','are','was','were','be','been','have','has','had','it','its','this',
    'that','with','from','by','as','not','no','will','would','could','should',
    'says','said','new','amid','after','before']);

  G.events.forEach(function(ev) {
    var text = ((ev.title||'') + ' ' + (ev.summary||'')).toLowerCase();
    if (!text.includes(q)) return;
    // Extract bigrams + unigrams
    var words = text.replace(/[^\w\s]/g,' ').split(/\s+/).filter(function(w){
      return w.length > 4 && !stopWords.has(w);
    });
    words.forEach(function(w) {
      if (w !== q && !q.includes(w)) {
        termFreq[w] = (termFreq[w]||0) + 1;
      }
    });
    // Bigrams
    for (var i = 0; i < words.length - 1; i++) {
      var bi = words[i] + ' ' + words[i+1];
      if (!bi.includes(q)) termFreq[bi] = (termFreq[bi]||0) + 1;
    }
  });

  return Object.entries(termFreq)
    .sort(function(a,b){ return b[1]-a[1]; })
    .slice(0, max)
    .map(function(e){ return e[0].replace(/\b\w/g,function(c){return c.toUpperCase();}); });
}

// ── Helper: find matching events ──────────────────────
function _kexFindMatchingEvents(query, max) {
  if (!G || !G.events) return [];
  var q = query.toLowerCase();
  var matched = G.events.filter(function(ev) {
    var text = ((ev.title||'') + ' ' + (ev.summary||'')).toLowerCase();
    return text.includes(q);
  });
  matched.sort(function(a,b){ return (b.severity||0)-(a.severity||0); });
  return matched.slice(0, max);
}

// ── Helper: extract entity ids from events ────────────
function _kexExtractEntitiesFromEvents(events, max) {
  var found = {};
  events.forEach(function(ev) {
    if (ev.country_code && ev.country_code !== 'XX') {
      var key = 'country:' + ev.country_code;
      found[key] = (found[key]||0) + 1;
    }
  });
  return Object.keys(found).slice(0, max);
}

// ══════════════════════════════════════════════════════
// SVG RENDERER
// ══════════════════════════════════════════════════════

function _kexInitSVG() {
  var wrap = document.getElementById('kex-svg-wrap');
  var svg  = document.getElementById('kex-svg');
  if (!svg || !wrap) return;

  // Update dimensions (wrap must be visible/display:flex when this is called)
  var w = wrap.offsetWidth  || 700;
  var h = wrap.offsetHeight || 500;
  KEX.W   = w;
  KEX.H   = h;
  KEX.svg = svg;

  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);

  // Ensure the transform group exists
  if (!document.getElementById('kex-g')) {
    svg.innerHTML = '<g id="kex-g" transform="translate(0,0) scale(1)"></g>';
    KEX.svgG = document.getElementById('kex-g');
    // Register pan/zoom listeners ONCE
    _kexRegisterInteractions(svg);
  } else {
    KEX.svgG = document.getElementById('kex-g');
  }
}

function _kexRegisterInteractions(svg) {
  var isPanning = false;
  var panStart  = {x:0, y:0};
  var panOrig   = {x:0, y:0};

  svg.addEventListener('mousedown', function(e) {
    if (e.target === svg || e.target === KEX.svgG) {
      isPanning = true;
      panStart  = {x: e.clientX, y: e.clientY};
      panOrig   = {x: KEX.panX,  y: KEX.panY};
      svg.style.cursor = 'grabbing';
    }
  });
  window.addEventListener('mousemove', function(e) {
    if (!isPanning) return;
    KEX.panX = panOrig.x + (e.clientX - panStart.x);
    KEX.panY = panOrig.y + (e.clientY - panStart.y);
    _kexApplyTransform();
  });
  window.addEventListener('mouseup', function() {
    isPanning = false;
    if (svg) svg.style.cursor = 'grab';
  });
  svg.addEventListener('wheel', function(e) {
    e.preventDefault();
    var factor = e.deltaY > 0 ? 0.88 : 1.14;
    KEX.zoom   = Math.max(0.2, Math.min(4, KEX.zoom * factor));
    _kexApplyTransform();
  }, {passive: false});
  svg.addEventListener('touchstart', function(e) {
    if (e.touches.length === 1) {
      isPanning = true;
      panStart  = {x: e.touches[0].clientX, y: e.touches[0].clientY};
      panOrig   = {x: KEX.panX, y: KEX.panY};
    }
  }, {passive:true});
  svg.addEventListener('touchmove', function(e) {
    if (isPanning && e.touches.length === 1) {
      KEX.panX = panOrig.x + (e.touches[0].clientX - panStart.x);
      KEX.panY = panOrig.y + (e.touches[0].clientY - panStart.y);
      _kexApplyTransform();
    }
  }, {passive:true});
  svg.addEventListener('touchend', function() { isPanning = false; }, {passive:true});
}

function _kexApplyTransform() {
  if (!KEX.svgG) return;
  KEX.svgG.setAttribute('transform',
    'translate(' + KEX.panX + ',' + KEX.panY + ') scale(' + KEX.zoom + ')'
  );
}

function _kexRender() {
  if (!KEX.svgG) _kexInitSVG();
  if (!KEX.svgG) return;

  var nodes = KEX.nodes;
  var edges = KEX.edges;
  if (!nodes.length) { _kexShowEmpty(); return; }

  // Layout
  var positions = KEX.layout === 'radial'
    ? _kexRadialLayout(nodes)
    : _kexForceLayout(nodes, edges);

  // Reset pan/zoom to center
  KEX.zoom = 1;
  KEX.panX = 0;
  KEX.panY = 0;

  // Clear and build SVG
  var g = KEX.svgG;
  g.innerHTML = '';
  g.setAttribute('transform', 'translate(0,0) scale(1)');

  // ── Edges ─────────────────────────────────────────────
  var edgeGroup = _svgEl('g', {'class':'kex-edges'});
  edges.forEach(function(e) {
    var ps = positions[e.src];
    var pt = positions[e.tgt];
    if (!ps || !pt) return;

    var opacity = Math.max(0.15, Math.min(0.7, e.weight));
    var srcNode = KEX.nodes.filter(function(n){return n.id===e.src;})[0];
    var col     = srcNode ? (KEX_COLORS[srcNode.type] || '#475569') : '#475569';

    // Curved path (cubic bezier for radial, straight for force)
    var path;
    if (KEX.layout === 'radial') {
      var mx = (ps.x + pt.x) / 2 + (pt.y - ps.y) * 0.15;
      var my = (ps.y + pt.y) / 2 + (ps.x - pt.x) * 0.15;
      path = 'M' + ps.x + ',' + ps.y + ' Q' + mx + ',' + my + ' ' + pt.x + ',' + pt.y;
    } else {
      path = 'M' + ps.x + ',' + ps.y + ' L' + pt.x + ',' + pt.y;
    }

    var line = _svgEl('path', {
      'd': path,
      'fill': 'none',
      'stroke': col,
      'stroke-width': Math.max(0.5, e.weight * 2),
      'stroke-opacity': opacity,
      'stroke-dasharray': e.label === 'reference' ? '3,3' : '',
    });
    edgeGroup.appendChild(line);

    // Edge label for strong edges
    if (e.weight > 0.6 && e.label && e.label !== 'mentions') {
      var mx2 = (ps.x + pt.x) / 2;
      var my2 = (ps.y + pt.y) / 2;
      var lbl = _svgEl('text', {
        'x': mx2, 'y': my2,
        'text-anchor': 'middle',
        'font-size': '8',
        'fill': '#64748B',
        'pointer-events': 'none',
      });
      lbl.textContent = e.label;
      edgeGroup.appendChild(lbl);
    }
  });
  g.appendChild(edgeGroup);

  // ── Nodes ──────────────────────────────────────────────
  var nodeGroup = _svgEl('g', {'class':'kex-nodes'});
  nodes.forEach(function(n) {
    var pos = positions[n.id];
    if (!pos) return;

    var col    = KEX_COLORS[n.type] || '#94A3B8';
    var radius = _kexNodeRadius(n);
    var isQuery= n.type === 'query';
    var isSrc  = n.type === 'source';

    // Node group
    var ng2 = _svgEl('g', {
      'class':  'kex-node',
      'cursor': 'pointer',
      'data-id': n.id,
    });

    // Outer glow for query node
    if (isQuery) {
      var glow = _svgEl('circle', {
        'cx': pos.x, 'cy': pos.y, 'r': radius + 8,
        'fill': col, 'fill-opacity': '0.12',
      });
      ng2.appendChild(glow);
    }

    // Main circle
    var circle = _svgEl('circle', {
      'cx': pos.x, 'cy': pos.y, 'r': radius,
      'fill': col,
      'fill-opacity': isSrc ? '0.15' : '0.85',
      'stroke': col,
      'stroke-width': isSrc ? '1.5' : isQuery ? '3' : '1',
      'stroke-opacity': '0.9',
    });
    ng2.appendChild(circle);

    // Source icon or letter
    if (isSrc) {
      var icon = _svgEl('text', {
        'x': pos.x, 'y': pos.y + 1,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-size': radius * 0.9,
        'fill': col,
        'pointer-events': 'none',
      });
      icon.textContent = n.label.split(' ')[0]; // emoji icon
      ng2.appendChild(icon);
    } else {
      // Type letter
      var letter = _svgEl('text', {
        'x': pos.x, 'y': pos.y + 1,
        'text-anchor': 'middle',
        'dominant-baseline': 'middle',
        'font-size': Math.max(8, radius * 0.55),
        'font-weight': isQuery ? '800' : '600',
        'fill': '#fff',
        'pointer-events': 'none',
      });
      letter.textContent = isQuery ? n.label.slice(0,2).toUpperCase()
                         : n.type === 'event'   ? '⚡'
                         : n.type === 'concept' ? '💡'
                         : n.type === 'entity'  ? '🏢'
                         : '📖';
      ng2.appendChild(letter);
    }

    // Label below
    var truncLabel = n.label.length > 22 ? n.label.slice(0,20)+'…' : n.label;
    var labelY     = pos.y + radius + 12;

    // Label background pill
    var lblWidth = Math.min(140, truncLabel.length * 5.5 + 12);
    var lblBg = _svgEl('rect', {
      'x': pos.x - lblWidth/2, 'y': labelY - 9,
      'width': lblWidth, 'height': 13,
      'rx': '4',
      'fill': 'rgba(6,11,24,0.75)',
      'pointer-events': 'none',
    });
    ng2.appendChild(lblBg);

    var lbl = _svgEl('text', {
      'x': pos.x, 'y': labelY,
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
      'font-size': isQuery ? '10' : '8.5',
      'font-weight': isQuery ? '700' : '500',
      'fill': isQuery ? '#F0F6FF' : '#CBD5E1',
      'pointer-events': 'none',
    });
    lbl.textContent = truncLabel;
    ng2.appendChild(lbl);

    // Hover + click
    ng2.addEventListener('mouseenter', function() {
      circle.setAttribute('filter', 'url(#kex-glow)');
      circle.setAttribute('r', radius * 1.2);
    });
    ng2.addEventListener('mouseleave', function() {
      circle.removeAttribute('filter');
      circle.setAttribute('r', radius);
    });
    ng2.addEventListener('click', function(e) {
      e.stopPropagation();
      _kexSelectNode(n);
    });

    nodeGroup.appendChild(ng2);
  });
  g.appendChild(nodeGroup);

  // ── SVG defs (glow filter) ──────────────────────────────
  var defs = _svgEl('defs');
  defs.innerHTML = '<filter id="kex-glow" x="-50%" y="-50%" width="200%" height="200%">'
    + '<feGaussianBlur stdDeviation="3" result="blur"/>'
    + '<feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>'
    + '</filter>';
  g.insertBefore(defs, g.firstChild);

  // Update topbar
  var ql = document.getElementById('kex-query-label');
  if (ql) ql.textContent = '🔍 ' + KEX.query;

  // Auto fit
  setTimeout(kexFitView, 50);
}

// ── Radial layout ─────────────────────────────────────
function _kexRadialLayout(nodes) {
  var cx = KEX.W / 2;
  var cy = KEX.H / 2;
  var positions = {};
  var byRing = {0:[], 1:[], 2:[], 3:[]};

  nodes.forEach(function(n) {
    var ring = n.ring || 0;
    if (!byRing[ring]) byRing[ring] = [];
    byRing[ring].push(n);
  });

  // Ring 0 = center
  byRing[0].forEach(function(n) {
    positions[n.id] = {x: cx, y: cy};
  });

  var radii = [0, 130, 230, 310];
  [1, 2, 3].forEach(function(ring) {
    var nodesInRing = byRing[ring] || [];
    if (!nodesInRing.length) return;
    var r     = radii[ring];
    var total = nodesInRing.length;
    // Start angle offset per ring for better visual spread
    var startAngle = ring === 3 ? Math.PI / total : -Math.PI / 2;
    nodesInRing.forEach(function(n, i) {
      var angle = startAngle + (2 * Math.PI * i) / total;
      positions[n.id] = {
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
      };
    });
  });

  return positions;
}

// ── Force layout (simple iteration) ──────────────────
function _kexForceLayout(nodes, edges) {
  var cx = KEX.W / 2;
  var cy = KEX.H / 2;
  var positions = {};
  var velocities = {};

  // Init random positions
  nodes.forEach(function(n, i) {
    var angle = (2 * Math.PI * i) / nodes.length;
    var r     = n.type === 'query' ? 0 : 80 + (n.ring||1) * 60;
    positions[n.id]  = {x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle)};
    velocities[n.id] = {x: 0, y: 0};
  });

  // 80 iterations
  for (var iter = 0; iter < 80; iter++) {
    var alpha = 1 - iter / 80;
    // Repulsion
    nodes.forEach(function(a) {
      nodes.forEach(function(b) {
        if (a.id === b.id) return;
        var pa = positions[a.id], pb = positions[b.id];
        var dx = pa.x - pb.x, dy = pa.y - pb.y;
        var dist = Math.sqrt(dx*dx + dy*dy) || 1;
        var force = 1800 / (dist * dist);
        velocities[a.id].x += dx / dist * force * alpha;
        velocities[a.id].y += dy / dist * force * alpha;
      });
    });
    // Attraction along edges
    edges.forEach(function(e) {
      var pa = positions[e.src], pb = positions[e.tgt];
      if (!pa || !pb) return;
      var dx    = pb.x - pa.x, dy = pb.y - pa.y;
      var dist  = Math.sqrt(dx*dx + dy*dy) || 1;
      var ideal = 120;
      var force = (dist - ideal) * 0.04 * e.weight;
      velocities[e.src].x += dx / dist * force * alpha;
      velocities[e.src].y += dy / dist * force * alpha;
      velocities[e.tgt].x -= dx / dist * force * alpha;
      velocities[e.tgt].y -= dy / dist * force * alpha;
    });
    // Gravity to center
    nodes.forEach(function(n) {
      if (n.type === 'query') return;
      var p = positions[n.id];
      velocities[n.id].x += (cx - p.x) * 0.01 * alpha;
      velocities[n.id].y += (cy - p.y) * 0.01 * alpha;
    });
    // Apply + damp
    nodes.forEach(function(n) {
      if (n.type === 'query') return;
      var p = positions[n.id];
      var v = velocities[n.id];
      p.x = Math.max(40, Math.min(KEX.W - 40, p.x + v.x * 0.5));
      p.y = Math.max(40, Math.min(KEX.H - 40, p.y + v.y * 0.5));
      v.x *= 0.6;
      v.y *= 0.6;
    });
  }
  return positions;
}

// ══════════════════════════════════════════════════════
// NODE INTERACTION
// ══════════════════════════════════════════════════════

function _kexSelectNode(n) {
  KEX.selected = n.id;
  _kexShowNodeDetail(n);

  // Highlight selected node in SVG
  document.querySelectorAll('.kex-node circle').forEach(function(c) {
    c.style.opacity = '0.4';
  });
  var selGroup = document.querySelector('[data-id="' + CSS.escape(n.id) + '"]');
  if (selGroup) {
    var c = selGroup.querySelector('circle');
    if (c) c.style.opacity = '1';
  }
}

function _kexShowNodeDetail(n) {
  var panel = document.getElementById('kex-node-detail');
  if (!panel) return;

  var col   = KEX_COLORS[n.type] || '#94A3B8';
  var typeLabel = {
    query:'Search Topic', event:'Live Event', concept:'Concept',
    entity:'Entity', source:'External Source'
  }[n.type] || n.type;

  var html = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">'
    + '<span style="font-size:9px;padding:2px 8px;border-radius:100px;background:'+col+'22;'
    + 'color:'+col+';font-weight:700;text-transform:uppercase;border:1px solid '+col+'44">'
    + typeLabel + '</span>';

  if (n.timestamp) {
    html += '<span style="font-size:9px;color:var(--t3)">' + _kexTimeAgo(n.timestamp) + '</span>';
  }
  html += '</div>';

  html += '<div style="font-size:12px;font-weight:700;color:var(--t1);line-height:1.4;margin-bottom:6px">'
       + (n.label||'') + '</div>';

  if (n.description) {
    html += '<div style="font-size:10px;color:var(--t2);line-height:1.6;margin-bottom:10px">'
         + n.description + '</div>';
  }

  // Event-specific fields
  if (n.type === 'event') {
    if (n.category || n.country) {
      html += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">';
      if (n.category) html += '<span style="font-size:9px;color:var(--t3)">📁 ' + n.category + '</span>';
      if (n.country)  html += '<span style="font-size:9px;color:var(--t3)">🌍 ' + n.country + '</span>';
      if (n.severity) html += '<span style="font-size:9px;color:var(--am)">⚡ Severity ' + (n.severity||0).toFixed(1) + '</span>';
      html += '</div>';
    }
    if (n.url) {
      html += '<a href="' + n.url + '" target="_blank" class="btn btn-g btn-xs" '
           + 'style="display:inline-flex;align-items:center;gap:5px;font-size:10px;padding:5px 12px;margin-bottom:8px">'
           + '↗ Read source</a>';
    }
    // Show on map button
    html += '<button onclick="kexShowOnMap(\'' + n.id + '\')" class="btn btn-o btn-xs" '
         + 'style="font-size:10px;padding:5px 12px">🗺 Show on map</button>';
  }

  // Source node — big open button
  if (n.type === 'source' && n.url) {
    html += '<a href="' + n.url + '" target="_blank" '
         + 'style="display:flex;align-items:center;justify-content:center;gap:8px;'
         + 'background:var(--b6);color:#fff;border-radius:var(--r8);padding:10px;'
         + 'font-size:11px;font-weight:700;text-decoration:none;margin-bottom:8px">'
         + '↗ Open ' + (n.sourceName||'Source') + '</a>';
  }

  // Concept / entity — search deeper + related sources
  if (n.type === 'concept' || n.type === 'entity') {
    var searchTerm = n.searchable || n.label;
    html += '<button onclick="kexSearchTerm(\'' + searchTerm.replace(/'/g,"\\'") + '\')" '
         + 'class="btn btn-p btn-xs" '
         + 'style="font-size:10px;padding:5px 12px;width:100%;margin-bottom:6px">'
         + '🔍 Explore "' + searchTerm.slice(0,20) + '"</button>';

    // Quick links
    html += '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">';
    [['wikipedia','📖'],['investopedia','💰'],['reuters','📰']].forEach(function(pair) {
      var srcKey = pair[0], icon = pair[1];
      var src = KEX_SOURCES[srcKey];
      if (src) {
        html += '<a href="' + src.urlFn(searchTerm) + '" target="_blank" '
             + 'style="font-size:9px;padding:3px 8px;background:var(--bg3);border-radius:var(--r4);'
             + 'color:var(--t2);text-decoration:none;border:1px solid var(--bd)">'
             + icon + ' ' + srcKey + '</a>';
      }
    });
    html += '</div>';
  }

  panel.innerHTML = html;
  panel.style.display = 'block';
}

function _kexHideNodeDetail() {
  var panel = document.getElementById('kex-node-detail');
  if (panel) { panel.innerHTML = ''; panel.style.display = 'none'; }
}

// Show event on map
function kexShowOnMap(nodeId) {
  var node = KEX.nodes.filter(function(n){return n.id===nodeId;})[0];
  if (!node) return;
  // Find matching event
  var evId = nodeId.replace('event:','');
  sv('map', document.querySelector('[data-v=map]'));
  setTimeout(function(){ if(typeof openEP === 'function') openEP(evId); }, 600);
}

// ══════════════════════════════════════════════════════
// SIDEBAR NODE LIST
// ══════════════════════════════════════════════════════

function _kexRenderSidebarList(nodes) {
  var container = document.getElementById('kex-sidebar-content');
  if (!container) return;

  // Group by type
  var groups = {event:[], concept:[], entity:[], source:[]};
  nodes.forEach(function(n) {
    if (n.type === 'query') return;
    if (groups[n.type]) groups[n.type].push(n);
  });

  var html = '';
  var typeLabels = {
    event:   { icon:'⚡', label:'Live Events',      color:'#3B82F6' },
    concept: { icon:'💡', label:'Related Concepts',  color:'#10B981' },
    entity:  { icon:'🏢', label:'Entities',          color:'#F59E0B' },
    source:  { icon:'📚', label:'External Sources',  color:'#8B5CF6' },
  };

  ['event','concept','entity','source'].forEach(function(type) {
    var items = groups[type];
    if (!items.length) return;
    var meta = typeLabels[type];
    html += '<div style="margin-bottom:10px">';
    html += '<div style="font-size:9px;font-weight:700;text-transform:uppercase;'
          + 'letter-spacing:.1em;color:' + meta.color + ';margin-bottom:5px;'
          + 'display:flex;align-items:center;gap:4px">'
          + meta.icon + ' ' + meta.label
          + ' <span style="color:var(--t4);font-weight:400">(' + items.length + ')</span>'
          + '</div>';

    items.forEach(function(n) {
      var isSource = type === 'source';
      html += '<div class="kex-node-row" onclick="kexFocusNodeById(\'' + n.id.replace(/'/g,"\\'") + '\')">';
      html += '<div style="display:flex;align-items:center;gap:7px">';

      // Color dot
      html += '<div style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:' + meta.color + '"></div>';

      html += '<div style="flex:1;min-width:0">';
      html += '<div style="font-size:10px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
            + (n.label||'').slice(0,36) + '</div>';
      if (n.description && n.description !== 'Related concept: ' + n.label) {
        html += '<div style="font-size:9px;color:var(--t3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
              + (n.description||'').slice(0,45) + '</div>';
      }
      html += '</div>';

      // External link button for sources and events
      if ((isSource || type === 'event') && n.url) {
        html += '<a href="' + n.url + '" target="_blank" onclick="event.stopPropagation()" '
             + 'style="font-size:10px;color:var(--b4);flex-shrink:0;padding:2px 5px">↗</a>';
      }
      html += '</div></div>';
    });
    html += '</div>';
  });

  if (!html) {
    html = '<div style="text-align:center;padding:24px;color:var(--t3);font-size:11px">'
         + 'No results found for "' + KEX.query + '"</div>';
  }

  container.innerHTML = html;
}

// Focus a node in the graph by id (from sidebar click)
function kexFocusNodeById(nodeId) {
  var n = KEX.nodes.filter(function(n){return n.id===nodeId;})[0];
  if (!n) return;
  _kexSelectNode(n);

  // Pan graph to that node's position — re-run layout to get positions
  var positions = KEX.layout === 'radial'
    ? _kexRadialLayout(KEX.nodes)
    : _kexForceLayout(KEX.nodes, KEX.edges);
  var pos = positions[nodeId];
  if (pos) {
    KEX.panX = KEX.W/2 - pos.x * KEX.zoom;
    KEX.panY = KEX.H/2 - pos.y * KEX.zoom;
    _kexApplyTransform();
  }
}

// ══════════════════════════════════════════════════════
// LAYOUT TOGGLE / ZOOM / FIT
// ══════════════════════════════════════════════════════

function kexLayout(mode) {
  KEX.layout = mode;
  document.querySelectorAll('.kex-view-btn').forEach(function(b) {
    b.classList.toggle('on', b.id === 'kex-btn-' + mode);
  });
  _kexRender();
}

function kexZoom(factor) {
  KEX.zoom = Math.max(0.2, Math.min(4, KEX.zoom * factor));
  _kexApplyTransform();
}

function kexFitView() {
  KEX.zoom = 1;
  KEX.panX = 0;
  KEX.panY = 0;
  _kexApplyTransform();
}

function kexReset() {
  KEX.query    = '';
  KEX.nodes    = [];
  KEX.edges    = [];
  KEX.selected = null;
  KEX.breadcrumb = [];
  var inp = document.getElementById('kex-search-inp');
  if (inp) inp.value = '';
  if (KEX.svgG) KEX.svgG.innerHTML = '';
  _kexHideNodeDetail();
  _kexUpdateBreadcrumb();
  _kexShowEmpty();
  var ql = document.getElementById('kex-query-label');
  if (ql) ql.textContent = '—';
}

// ══════════════════════════════════════════════════════
// BREADCRUMB
// ══════════════════════════════════════════════════════

function _kexUpdateBreadcrumb() {
  var bc = document.getElementById('kex-breadcrumb');
  if (!bc) return;
  if (!KEX.breadcrumb.length) { bc.innerHTML = ''; return; }
  var items = KEX.breadcrumb.slice(-4); // show last 4
  bc.innerHTML = items.map(function(term, i) {
    var isLast = i === items.length - 1;
    if (isLast) {
      return '<span style="color:var(--b4);font-weight:700">' + term + '</span>';
    }
    return '<span style="cursor:pointer;color:var(--t3)" onclick="kexSearchTerm(\'' + term.replace(/'/g,"\\'") + '\')">'
           + term + '</span>'
           + '<span style="color:var(--t4);margin:0 4px">›</span>';
  }).join('');
}

// ══════════════════════════════════════════════════════
// UTILITY
// ══════════════════════════════════════════════════════

function _kexNodeRadius(n) {
  if (n.type === 'query')   return 28;
  if (n.type === 'event')   return 10 + (n.severity||5) * 1.2;
  if (n.type === 'concept') return 12;
  if (n.type === 'entity')  return 11;
  if (n.type === 'source')  return 13;
  return 10;
}

function _svgEl(tag, attrs) {
  var el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (var k in attrs) el.setAttribute(k, attrs[k]);
  return el;
}

function _kexTimeAgo(ts) {
  if (!ts) return '';
  var diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 3600)  return Math.round(diff/60)  + 'm ago';
  if (diff < 86400) return Math.round(diff/3600) + 'h ago';
  return Math.round(diff/86400) + 'd ago';
}

function _kexSetLoading(on) {
  var ql = document.getElementById('kex-query-label');
  if (on && ql) ql.textContent = '⏳ Exploring "' + KEX.query + '"…';
}

function _kexShowEmpty() {
  var g = document.getElementById('kex-g');
  if (!g) return;
  g.innerHTML = '';
  var W = KEX.W || 700, H = KEX.H || 500;
  var txt = _svgEl('text', {
    'x': W/2, 'y': H/2 - 20,
    'text-anchor':'middle','fill':'#4B5E7A','font-size':'14',
  });
  txt.textContent = 'Search a topic to explore the knowledge graph';
  g.appendChild(txt);
  var txt2 = _svgEl('text', {
    'x': W/2, 'y': H/2 + 10,
    'text-anchor':'middle','fill':'#2A3A52','font-size':'11',
  });
  txt2.textContent = 'Try: "semiconductors", "Federal Reserve", "Ukraine conflict"';
  g.appendChild(txt2);
}

// ══════════════════════════════════════════════════════
// RESIZE
// ══════════════════════════════════════════════════════
(function() {
  if (window.ResizeObserver) {
    var wrap = document.getElementById('kex-svg-wrap');
    if (wrap) {
      new ResizeObserver(function() {
        var w = wrap.offsetWidth, h = wrap.offsetHeight;
        if (w && h && KEX.svg) {
          KEX.W = w; KEX.H = h;
          KEX.svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
          if (KEX.nodes.length) _kexRender();
        }
      }).observe(wrap);
    }
  }
})();
