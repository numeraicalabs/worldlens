/** WorldLens v21 — MAP BUNDLE */
/* Files: 03_map.js 07_map_advanced.js 17_cascade.js 19_continent_streams.js 08_knowledge_graph.js 15_knowledge_explorer.js 12_graph.js 14_graph3d.js 16_timeline_graph.js 18_network_hub.js 22_graph_engine.js 09_historical_events.js */


/* ═══════════ 03_map.js ═══════════ */
/**
 * @file 03_map.js
 * @module WorldLens/Map Engine
 *
 * @description
 * Leaflet map + progressive event disclosure.
 * User controls focus mode (Balanced / Financial & Macro / Geopolitical / All).
 * Financial & macro news have guaranteed slots at every zoom level.
 *
 * @dependencies 01_globals.js, 02_core.js
 */

// ── User focus preference ────────────────────────────────────
// Persisted to localStorage so it survives page reload
var MAP_FOCUS = (function() {
  try { return JSON.parse(localStorage.getItem('wl_map_focus') || '{}'); } catch(e) { return {}; }
})();
MAP_FOCUS.mode = MAP_FOCUS.mode || 'balanced';

// Per-category severity bonus when a mode is active
// Negative = lower floor (more news shown), zero = no change
var FOCUS_BOOST = {
  balanced:    {},
  financial:   { ECONOMICS:-3.0, FINANCE:-3.0, ENERGY:-1.5, TECHNOLOGY:-1.0 },
  geopolitical:{ CONFLICT:-3.0, GEOPOLITICS:-2.5, SECURITY:-2.0, POLITICS:-2.0 },
  all:         { ECONOMICS:-4.0, FINANCE:-4.0, CONFLICT:-3.0, GEOPOLITICS:-2.5,
                 ENERGY:-2.0, TECHNOLOGY:-1.5, POLITICS:-2.0, SECURITY:-2.0 },
};

// Base severity floor & display limit by zoom band
// fmt: { max_zoom, floor, limit, label, segs }
var ZOOM_BANDS = [
  { max:3,  floor:5.5, limit:50,  label:'Global Overview',   segs:1 },
  { max:5,  floor:4.0, limit:120, label:'Continental View',  segs:2 },
  { max:6,  floor:3.0, limit:200, label:'Regional View',     segs:3 },
  { max:8,  floor:2.0, limit:400, label:'Country View',      segs:4 },
  { max:99, floor:0.0, limit:800, label:'Local View',        segs:5 },
];

// Categories that always get guaranteed visibility slots
var PRIORITY_CATS = ['ECONOMICS', 'FINANCE', 'CONFLICT', 'GEOPOLITICS'];

function _band(zoom) {
  return ZOOM_BANDS.find(function(b){ return zoom < b.max; }) || ZOOM_BANDS[ZOOM_BANDS.length-1];
}

// ── Map init ─────────────────────────────────────────────────
function initMap() {
  if (G.mapReady) return;
  var mapEl = document.getElementById('map');
  if (!mapEl || mapEl.offsetWidth === 0) { setTimeout(initMap, 120); return; }

  G.map = L.map('map', {
    center: [25,15], zoom: 3,
    zoomControl: false,
    minZoom: 2, maxZoom: 14,
    tap: false,           /* disable Leaflet tap shim — use native touch events */
    tapTolerance: 15,     /* wider tolerance for fat fingers */
    touchZoom: true,
    bounceAtZoomLimits: false
  });

  // Dark tile providers — native dark maps, no CSS filter needed
  // CartoDB Dark Matter: purpose-built dark map, sharp and fast
  var providers = [
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png',
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  ];
  var tileLoaded = false;
  function tryProvider(i) {
    if (i >= providers.length) return;
    var layer = L.tileLayer(providers[i], {subdomains:'abcd',maxZoom:19,attribution:'© CartoDB © OSM',crossOrigin:true,detectRetina:true});
    layer.on('tileload', function() { tileLoaded = true; });
    layer.on('tileerror', function() {
      if (!tileLoaded) { try{G.map.removeLayer(layer);}catch(e){} setTimeout(function(){tryProvider(i+1);},200); }
    });
    layer.addTo(G.map);
    setTimeout(function(){ if(!tileLoaded){try{G.map.removeLayer(layer);}catch(e){}tryProvider(i+1);} }, 6000);
  }
  tryProvider(0);

  G.mapReady = true;
  G._lastZoom = 3;
  G._clusterMarkers = [];

  G.map.on('zoomend', function() {
    var z = G.map.getZoom();
    if (z !== G._lastZoom) {
      G._lastZoom = z;
      flashZoomOverlay();
      updateMarkers();
      updateZoomHUD(z);
    }
  });

  G.map.on('zoomstart', function() {
    var hud = document.getElementById('map-zoom-hud');
    if (hud) hud.style.display = 'flex';
  });

  _buildFocusPanel();

  setTimeout(function(){ G.map.invalidateSize(); }, 300);
  updateMarkers();
  updateZoomHUD(3);
}

// ── Focus panel (injected into #mleft) ──────────────────────
function _buildFocusPanel() {
  if (document.getElementById('map-focus-panel')) return;
  var mleft = document.getElementById('mleft');
  if (!mleft) return;

  // Inject CSS once
  if (!document.getElementById('_fp_css')) {
    var s   = document.createElement('style');
    s.id    = '_fp_css';
    s.textContent =
      '.fp-btn{display:block;width:100%;text-align:left;padding:6px 9px;margin-bottom:3px;' +
      'border-radius:var(--r8);font-size:10px;font-weight:600;cursor:pointer;transition:all .15s;' +
      'background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:var(--t2);}' +
      '.fp-btn:hover{background:rgba(255,255,255,.08);border-color:rgba(255,255,255,.2);color:var(--t1);}' +
      '.fp-btn.on{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.38);color:var(--b4);}' +
      '.fp-badge{float:right;font-size:9px;font-weight:400;opacity:.6;}';
    document.head.appendChild(s);
  }

  var MODES = [
    { id:'balanced',     label:'⚖ Balanced',           badge:'' },
    { id:'financial',    label:'📊 Financial & Macro',  badge:'+Econ/Fin' },
    { id:'geopolitical', label:'🌐 Geopolitical',        badge:'+Geo/Pol' },
    { id:'all',          label:'🔍 Max Coverage',        badge:'All boosted' },
  ];

  var btns = MODES.map(function(m) {
    return '<button class="fp-btn' + (MAP_FOCUS.mode === m.id ? ' on' : '') + '" ' +
      'data-mode="' + m.id + '" onclick="setFocusMode(\'' + m.id + '\',this)">' +
      m.label + (m.badge ? '<span class="fp-badge">' + m.badge + '</span>' : '') +
      '</button>';
  }).join('');

  var panel = document.createElement('div');
  panel.id        = 'map-focus-panel';
  panel.className = 'mpc';
  panel.innerHTML =
    '<div class="mptit">News Focus</div>' + btns +
    '<div id="fp-stat" style="font-size:9px;color:var(--t3);margin-top:6px;line-height:1.5"></div>';

  mleft.insertBefore(panel, mleft.firstChild);
  _updateFocusStat();
}

function setFocusMode(mode, btn) {
  MAP_FOCUS.mode = mode;
  try { localStorage.setItem('wl_map_focus', JSON.stringify(MAP_FOCUS)); } catch(e){}

  document.querySelectorAll('.fp-btn').forEach(function(b){
    b.classList.toggle('on', b.dataset.mode === mode);
  });
  _updateFocusStat();
  updateMarkers();
  toast('Focus: ' + mode.charAt(0).toUpperCase() + mode.slice(1), 's');
}

function _updateFocusStat() {
  var stat  = document.getElementById('fp-stat');
  if (!stat) return;
  var boost = FOCUS_BOOST[MAP_FOCUS.mode] || {};
  var cats  = Object.keys(boost).filter(function(k){ return boost[k] < 0; });
  if (cats.length) {
    stat.innerHTML = '↑ Priority: <b style="color:var(--b4)">' + cats.join(', ') + '</b>';
  } else {
    stat.textContent = 'All categories equally weighted';
  }
}

// ── Zoom HUD ─────────────────────────────────────────────────
function updateZoomHUD(z) {
  var b = _band(z);
  setEl('zoom-mode-lbl', b.label);
  setEl('zoom-hud-text', b.label);
  document.querySelectorAll('.density-seg').forEach(function(s,i){ s.classList.toggle('on', i < b.segs); });
  document.querySelectorAll('.zoom-hud-dot').forEach(function(d,i){ d.classList.toggle('on', i < b.segs); });
}

function flashZoomOverlay() {
  var ov = document.getElementById('map-zoom-overlay');
  if (!ov) return;
  ov.classList.add('flash');
  setTimeout(function(){ ov.classList.remove('flash'); }, 300);
}

// ── Progressive event filtering ──────────────────────────────
function getEventsForZoom(allEvs, zoom) {
  var deduped    = deduplicateEvents(allEvs);
  G._dedupCount  = allEvs.length - deduped.length;

  var b          = _band(zoom);
  var boost      = FOCUS_BOOST[MAP_FOCUS.mode] || {};
  var now        = Date.now();

  // Get current viewport bounds for high-zoom spatial filtering
  var bounds     = (zoom >= 7 && G.map) ? G.map.getBounds() : null;
  var latPad     = bounds ? (bounds.getNorth() - bounds.getSouth()) * 0.25 : 0;
  var lonPad     = bounds ? (bounds.getEast()  - bounds.getWest())  * 0.25 : 0;

  // ── Score each event ────────────────────────────────────────
  var scored = [];
  deduped.forEach(function(ev) {
    var floor      = Math.max(0, b.floor + (boost[ev.category] || 0));
    if (ev.severity < floor) return;

    // Spatial filter at high zoom
    if (bounds && ev.latitude && ev.longitude) {
      if (ev.latitude  < bounds.getSouth() - latPad || ev.latitude  > bounds.getNorth() + latPad ||
          ev.longitude < bounds.getWest()  - lonPad || ev.longitude > bounds.getEast()  + lonPad) return;
    }

    // Priority score
    var catBoost   = -(boost[ev.category] || 0);             // positive = high priority
    var ageHours   = (now - new Date(ev.timestamp).getTime()) / 3600000;
    var recency    = Math.max(0, 1 - ageHours / 96);         // decay over 96h
    var multiSrc   = Math.log1p(ev.source_count || 1) * 0.3; // multi-source bump
    var score      = ev.severity + catBoost * 0.6 + recency * 0.8 + multiSrc;

    scored.push({ ev:ev, score:score });
  });

  scored.sort(function(a,b){ return b.score - a.score; });

  // ── Guaranteed slots for priority categories ─────────────────
  // Each PRIORITY_CAT gets floor(limit × 0.15) guaranteed slots,
  // but only if it has boosted visibility in current focus mode.
  var limit         = b.limit;
  var result        = [];
  var seen          = {};
  var boostedCats   = Object.keys(boost).filter(function(k){ return boost[k] < 0; });

  // Guaranteed slots: 15% of limit per boosted cat, max 4 cats → 60%
  var guaranteedPer = Math.floor(limit * 0.15);
  boostedCats.forEach(function(cat) {
    var n = 0;
    scored.forEach(function(s) {
      if (n >= guaranteedPer || seen[s.ev.id]) return;
      if (s.ev.category === cat) { seen[s.ev.id] = true; result.push(s.ev); n++; }
    });
  });

  // Fill remaining slots with best overall score
  scored.forEach(function(s) {
    if (result.length >= limit || seen[s.ev.id]) return;
    seen[s.ev.id] = true;
    result.push(s.ev);
  });

  return result;
}

// ── Client deduplication ─────────────────────────────────────
function deduplicateEvents(evs) {
  var groups   = [];
  var assigned = {};
  var sorted   = evs.slice().sort(function(a,b){ return b.severity - a.severity; });

  sorted.forEach(function(ev) {
    if (assigned[ev.id]) return;
    var group   = [ev];
    assigned[ev.id] = true;
    var evTime  = new Date(ev.timestamp).getTime();

    sorted.forEach(function(other) {
      if (assigned[other.id] || other.category !== ev.category) return;
      if (other.country_code !== ev.country_code || other.country_code === 'XX') return;
      if (Math.abs(evTime - new Date(other.timestamp).getTime()) > 43200000) return;
      group.push(other);
      assigned[other.id] = true;
    });

    if (group.length > 1) {
      var leader      = group[0];
      var metaEv      = Object.assign({}, leader);
      metaEv._group   = group;
      metaEv._groupCount = group.length;
      metaEv._sources = [];
      group.forEach(function(e) {
        if (e.source && metaEv._sources.indexOf(e.source) === -1) metaEv._sources.push(e.source);
      });
      metaEv.severity = Math.min(10, leader.severity + Math.log(group.length) * 0.5);
      groups.push(metaEv);
    } else {
      groups.push(ev);
    }
  });

  return groups;
}

// ── Clustering engine ────────────────────────────────────────
function clusterEvents(evs, zoom) {
  if (zoom >= 6) {
    return evs.map(function(ev) {
      return { type:'single', ev:ev, lat:ev.latitude, lon:ev.longitude };
    });
  }

  var r = zoom <= 3 ? 12 : zoom <= 4 ? 8 : zoom <= 5 ? 5 : 3;
  var items = evs.map(function(ev) {
    return { type:'single', ev:ev, lat:ev.latitude, lon:ev.longitude, done:false };
  });
  var result = [];

  items.forEach(function(item) {
    if (item.done) return;
    var nearby = items.filter(function(o) {
      if (o.done || o === item) return false;
      var dl = o.lat - item.lat, dn = o.lon - item.lon;
      return Math.sqrt(dl*dl + dn*dn) < r;
    });

    if (nearby.length >= 2) {
      item.done = true;
      nearby.forEach(function(n){ n.done = true; });
      var all   = [item].concat(nearby);
      var cLat  = all.reduce(function(s,x){ return s+x.lat; }, 0) / all.length;
      var cLon  = all.reduce(function(s,x){ return s+x.lon; }, 0) / all.length;
      var topEv = all.slice().sort(function(a,b){ return b.ev.severity-a.ev.severity; })[0].ev;
      var cc    = {};
      all.forEach(function(x){ cc[x.ev.category]=(cc[x.ev.category]||0)+1; });
      var dom   = Object.keys(cc).reduce(function(a,b){ return cc[a]>cc[b]?a:b; });
      result.push({ type:'cluster', count:all.length, lat:cLat, lon:cLon,
                    topEv:topEv, category:dom, evs:all.map(function(x){ return x.ev; }) });
    } else {
      item.done = true;
      result.push({ type:'single', ev:item.ev, lat:item.lat, lon:item.lon });
    }
  });

  return result;
}

// ── Main render ──────────────────────────────────────────────
function updateMarkers() {
  if (!G.mapReady || !G.map) return;

  Object.values(G.markers).forEach(function(m){ try{m.remove();}catch(e){} });
  G.markers = {};
  if (G._clusterMarkers) G._clusterMarkers.forEach(function(m){ try{m.remove();}catch(e){} });
  G._clusterMarkers = [];

  var zoom    = G.map.getZoom();
  var catEvs  = getMapEvs();
  var visible = getEventsForZoom(catEvs, zoom);
  var items   = clusterEvents(visible, zoom);

  var nc = 0, ns = 0;
  items.forEach(function(item) {
    if (item.type === 'cluster') { addClusterMarker(item); nc++; }
    else                         { addMarker(item.ev);     ns++; }
  });

  // Update stats
  setEl('m-evn',     ns + ' events');
  setEl('m-clusters',nc + ' clusters');
  setEl('m-hin',     catEvs.filter(function(e){return e.impact==='High';}).length);
  setEl('m-dedup',   (G._dedupCount||0) + ' merged');
  setEl('m-upd',     new Date().toLocaleTimeString());
  setEl('zoom-hud-count', (nc + ns) + ' items');

  // Focus panel stat
  var stat  = document.getElementById('fp-stat');
  var boost = FOCUS_BOOST[MAP_FOCUS.mode] || {};
  var bCats = Object.keys(boost).filter(function(k){ return boost[k] < 0; });
  if (stat && bCats.length) {
    var n = visible.filter(function(e){ return bCats.indexOf(e.category) > -1; }).length;
    stat.innerHTML = '↑ Priority: <b style="color:var(--b4)">' + bCats.join(', ') +
      '</b><br><span style="color:var(--t3)">' + n + ' of ' + visible.length + ' shown</span>';
  } else if (stat) {
    stat.textContent = 'All categories equally weighted';
  }

  updateRiskUI();
}

// ── Cluster marker ───────────────────────────────────────────
function addClusterMarker(item) {
  var m        = CATS[item.category] || CATS.GEOPOLITICS;
  var topSev   = item.topEv.severity;
  var sz       = Math.max(32, Math.min(72, 24 + item.count * 3 + topSev * 1.5));
  var col      = topSev >= 7 ? '#EF4444' : topSev >= 5 ? '#F59E0B' : '#10B981';
  var label    = item.count > 99 ? '99+' : String(item.count);
  var fs       = item.count > 9 ? '11' : '13';

  var html = '<div class="map-cluster" style="width:'+sz+'px;height:'+sz+'px;'
    + 'background:radial-gradient(circle at 35% 35%,'+m.c+'44,'+m.c+'22);'
    + 'border:2px solid '+col+';box-shadow:0 0 '+(sz/2)+'px '+col+'44;">'
    + '<div class="map-cluster-ring" style="border-color:'+col+'"></div>'
    + '<div style="display:flex;flex-direction:column;align-items:center;gap:1px;z-index:1">'
    + '<span class="map-cluster-count" style="font-size:'+fs+'px">'+label+'</span>'
    + '<span style="font-size:9px;opacity:.8">'+m.i+'</span>'
    + '</div></div>';

  var r    = sz / 2;
  var icon = L.divIcon({html:html, className:'', iconSize:[sz,sz], iconAnchor:[r,r]});
  var mk   = L.marker([item.lat, item.lon], {icon:icon, zIndexOffset:-100});

  var topEvs = item.evs.slice().sort(function(a,b){return b.severity-a.severity;}).slice(0,4);
  var rows   = topEvs.map(function(ev) {
    var em = CATS[ev.category]||CATS.GEOPOLITICS;
    return '<div style="display:flex;align-items:center;gap:6px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.05)">'
      + '<span>'+em.i+'</span>'
      + '<span style="font-size:10px;flex:1;color:#F0F6FF">'+ev.title.slice(0,48)+'</span>'
      + '<span style="font-size:9px;color:'+col+'">'+ev.severity.toFixed(1)+'</span>'
      + '</div>';
  }).join('');

  if (!L.Browser.mobile && !L.Browser.touch) {
    mk.bindTooltip(
      '<div style="min-width:210px">'
      + '<div style="font-size:9px;color:'+col+';font-weight:700;text-transform:uppercase;margin-bottom:6px">'
      + item.count + ' events &bull; '+item.category+'</div>'
      + rows
      + '<div style="font-size:9px;color:#4B5E7A;margin-top:5px">Tap to zoom in</div>'
      + '</div>',
      {permanent:false, direction:'top', opacity:1}
    );
  }

  mk.on('click', function() {
    var z = G.map.getZoom();
    G.map.flyTo([item.lat, item.lon], z >= 5 ? Math.min(z+3,10) : Math.min(z+2,7), {duration:.6});
  });

  mk.addTo(G.map);
  G._clusterMarkers.push(mk);
}

// ── Single event marker ──────────────────────────────────────
function addMarker(ev) {
  if (!ev.latitude || !ev.longitude) return;
  var m       = CATS[ev.category] || CATS.GEOPOLITICS;
  var zoom    = G.map ? G.map.getZoom() : 3;
  var baseR   = zoom >= 8 ? 14 : zoom >= 5 ? 12 : 10;
  var r       = Math.max(baseR, Math.min(40, baseR + ev.severity * 2.2));
  var isGroup = ev._groupCount && ev._groupCount > 1;

  // Boosted = small blue indicator dot
  var boost     = FOCUS_BOOST[MAP_FOCUS.mode] || {};
  var isBoosted = (boost[ev.category] || 0) < 0;
  var boostDot  = isBoosted
    ? '<div style="position:absolute;top:-3px;left:-3px;width:7px;height:7px;border-radius:50%;'
      + 'background:#3B82F6;border:1.5px solid #fff;z-index:3"></div>' : '';

  var ring = (ev.impact === 'High' || ev.severity >= 7.5)
    ? '<div style="position:absolute;inset:-6px;border-radius:50%;border:2px solid '+m.c
      + ';animation:pr 2s ease-out infinite;pointer-events:none"></div>' : '';

  var badge = isGroup
    ? '<div style="position:absolute;top:-3px;right:-3px;background:'+m.c
      + ';color:#fff;font-size:7px;font-weight:800;width:14px;height:14px;border-radius:50%;'
      + 'display:flex;align-items:center;justify-content:center;border:1px solid rgba(0,0,0,.4);z-index:2">'
      + ev._groupCount + '</div>' : '';

  var html = '<div style="width:'+(r*2)+'px;height:'+(r*2)+'px;border-radius:50%;background:'+m.c+'22;'
    + 'border:2px solid '+m.c+';box-shadow:0 0 '+r+'px '+m.c+'44;display:flex;align-items:center;'
    + 'justify-content:center;font-size:'+Math.max(10,Math.round(r/1.4))+'px;position:relative;cursor:pointer">'
    + ring + badge + boostDot + m.i + '</div>';

  var icon = L.divIcon({html:html, className:'', iconSize:[r*2,r*2], iconAnchor:[r,r]});
  var mk   = L.marker([ev.latitude, ev.longitude], {icon:icon});

  /* Desktop-only tooltip — on mobile touch it causes the dashed-line bug */
  if (!L.Browser.mobile && !L.Browser.touch) {
    var desc    = (ev.ai_summary || ev.summary || ev.title).slice(0, 130);
    var srcInfo = isGroup ? ' &bull; '+ev._groupCount+' sources' : '';
    var focusTip= isBoosted ? ' <span style="color:var(--b4);font-size:8px">★ focused</span>' : '';
    mk.bindTooltip(
      '<div style="min-width:190px;max-width:260px">'
      + '<div style="font-size:9px;color:'+m.c+';font-weight:700;text-transform:uppercase;margin-bottom:4px">'
      + ev.category + srcInfo + focusTip + '</div>'
      + '<div style="font-size:12px;font-weight:600;line-height:1.35;margin-bottom:4px;color:#F0F6FF">'+ev.title+'</div>'
      + '<div style="font-size:10px;color:#94A3B8;margin-bottom:5px">'+desc+(desc.length>=130?'…':'')+'</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between;font-size:10px">'
      + '<span style="color:#94A3B8">'+(ev.country_name||ev.country_code||'Global')+'</span>'
      + '<span class="tag tag'+ev.impact[0]+'">'+ev.impact+'</span>'
      + '</div></div>',
      {permanent:false, sticky:false, offset:[0,-(r+4)], direction:'top', opacity:1}
    );
  }

  var eid = ev.id;

  if (L.Browser.touch || L.Browser.mobile) {
    /* On mobile: use Leaflet click (which fires on touchend via tap:false native events)
       plus a direct touchend fallback on the DOM element after it's added to the map */
    mk.on('click', function(e) {
      L.DomEvent.stopPropagation(e);
      openEP(eid);
    });
    mk.on('add', function() {
      var domEl = mk.getElement();
      if (!domEl) return;
      var _moved = false;
      domEl.addEventListener('touchstart', function() { _moved = false; }, {passive:true});
      domEl.addEventListener('touchmove',  function() { _moved = true;  }, {passive:true});
      domEl.addEventListener('touchend', function(e) {
        if (_moved) return;
        e.preventDefault();
        e.stopPropagation();
        openEP(eid);
      }, {passive:false});
    });
  } else {
    mk.on('click', function() { openEP(eid); });
  }

  mk.addTo(G.map);
  G.markers[ev.id] = mk;
}

// ── Helpers ──────────────────────────────────────────────────
function getMapEvs() {
  var active = [];
  document.querySelectorAll('#mcats .cpill.on').forEach(function(p){ active.push(p.dataset.c); });
  if (!active.length) return G.events;
  return G.events.filter(function(e){ return active.indexOf(e.category) > -1; });
}

function openEP(id) {
  /* Guard: find event */
  var ev = G.events.find(function(e){ return e.id === id; });
  if (!ev) { console.warn('openEP: event not found', id); return; }

  /* Guard: find panel */
  var panel = document.getElementById('evpanel');
  if (!panel) { console.error('openEP: #evpanel not found'); return; }

  G.panelEv = ev;
  track('event_opened', G.currentView || 'map', ev.id + '|' + (ev.category||'') + '|' + (ev.country_code||''));

  /* Fill content with null-safe helpers */
  var m = CATS[ev.category] || CATS.GEOPOLITICS;

  var epcat = document.getElementById('epcat');
  if (epcat) { epcat.innerHTML = m.i + ' ' + (ev.category || ''); epcat.style.cssText = 'background:' + m.bg + ';color:' + m.c + ';'; }

  var eptit = document.getElementById('eptit');
  if (eptit) eptit.textContent = ev.title || '';

  /* Dedup */
  var dedupEl = document.getElementById('ep-dedup');
  var sourcesEl = document.getElementById('ep-sources');
  var listEl = document.getElementById('ep-source-list');
  if (ev._groupCount && ev._groupCount > 1) {
    if (dedupEl)  { dedupEl.style.display = 'inline-flex'; var dt = document.getElementById('ep-dedup-txt'); if (dt) dt.textContent = ev._groupCount + ' sources merged'; }
    if (sourcesEl) sourcesEl.style.display = 'block';
    if (listEl) listEl.innerHTML = (ev._sources || [ev.source]).map(function(s){ return '<span class="source-pill">' + s + '</span>'; }).join('');
  } else {
    if (dedupEl)   dedupEl.style.display = 'none';
    if (sourcesEl) sourcesEl.style.display = 'none';
  }

  var epsum  = document.getElementById('epsum');  if (epsum)  epsum.textContent  = ev.ai_summary || ev.summary || 'No summary available.';
  var epsrc  = document.getElementById('epsrc');  if (epsrc)  epsrc.textContent  = ev.source || '';
  var epimp  = document.getElementById('epimp');  if (epimp)  epimp.innerHTML    = '<span class="tag tag' + (ev.impact||'M')[0] + '">' + (ev.impact||'Medium') + '</span>';
  var epreg  = document.getElementById('epreg');  if (epreg)  epreg.textContent  = ev.country_name || ev.country_code || 'Global';
  var eptime = document.getElementById('eptime'); if (eptime) eptime.textContent = tAgo(new Date(ev.timestamp));
  var eplink = document.getElementById('eplink'); if (eplink) eplink.href        = ev.url || '#';

  var mkts = [];
  try { mkts = typeof ev.related_markets === 'string' ? JSON.parse(ev.related_markets || '[]') : (ev.related_markets || []); } catch(e) {}
  var epmkts = document.getElementById('epmkts');
  if (epmkts) epmkts.innerHTML = mkts.map(function(t){ return '<span class="mktg">' + t + '</span>'; }).join('');

  var mn = document.getElementById('ai-market-note');
  if (mn) { if (ev.ai_market_note) { mn.style.display = 'block'; mn.textContent = ev.ai_market_note; } else mn.style.display = 'none'; }

  var ans = document.getElementById('panelans');
  if (ans) { ans.textContent = ''; ans.classList.remove('on'); }

  /* Reset to overview tab */
  if (typeof switchEPTab === 'function') {
    var ov = document.querySelector('.ep-tab[data-tab="overview"]');
    switchEPTab('overview', ov);
  }

  /* Mobile vs desktop behaviour */
  var isMobile = window.innerWidth <= 768;

  /* Show panel — force animation restart */
  panel.classList.remove('on');
  void panel.offsetWidth;
  panel.classList.add('on');

  if (isMobile) {
    /* Lock body scroll so only the panel scrolls */
    document.body.style.overflow = 'hidden';
    /* Push a history entry so the browser Back button closes the panel */
    if (window.history && window.history.pushState) {
      window.history.pushState({ epOpen: true }, '');
    }
  } else {
    /* Desktop: fly to marker */
    if (G.map && ev.latitude && ev.longitude)
      G.map.flyTo([ev.latitude, ev.longitude], Math.max(G.map.getZoom(), 5), { duration: 1.1 });
  }

  rq('/api/portfolio/track', { method: 'POST', body: { action: 'map_view' } });
}

function closeEP() {
  var panel = document.getElementById('evpanel');
  if (panel) panel.classList.remove('on');
  var bd = document.getElementById('evpanel-backdrop');
  if (bd) bd.classList.remove('on');
  /* Restore body scroll (locked on mobile open) */
  document.body.style.overflow = '';
}

/* Handle browser back button closing the panel on mobile */
window.addEventListener('popstate', function(e) {
  var panel = document.getElementById('evpanel');
  if (panel && panel.classList.contains('on')) {
    closeEP();
  }
});

function qf(cat) {
  document.querySelectorAll('#mcats .cpill').forEach(function(p){
    p.classList.toggle('on', cat===null || p.dataset.c===cat);
  });
  updateMarkers();
}

/* ═══════════ 07_map_advanced.js ═══════════ */
/**
 * @file 07_map_advanced.js
 * @module WorldLens/Advanced Map Overlays
 *
 * @description
 * Map mode controller (events/heatmap/graph/timeline/stress),
 * enhanced heatmap renderer, timeline strip, market stress meter,
 * NER entity chips, related events panel. Hooks sv() and openEP().
 *
 * @dependencies 01_globals.js, 02_core.js, 03_map.js
 * @exports setMapMode, toggleHeatmap, renderTimeline, toggleStressMeter, loadNER, renderNER, loadRelatedEvents, renderRelated, renderSentimentPanel
 */


// ADMIN DASHBOARD ENGINE
// ════════════════════════════════════════════════════════

var ADM = { currentPanel: 'overview' };

// ── Entry / Exit ──────────────────────────────────────
function openAdmin() {
  if (!G.user || !G.user.is_admin) {
    toast('Admin access required', 'e');
    return;
  }
  document.getElementById('admin-shell').classList.add('on');
  loadAdmOverview();
}
function exitAdmin() {
  document.getElementById('admin-shell').classList.remove('on');
}

// Keyboard shortcut: Ctrl+Shift+A
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.shiftKey && e.key === 'A') {
    if (G.user && G.user.is_admin) openAdmin();
  }
});

// ── Navigation ────────────────────────────────────────
function admNav(panel, btn) {
  ADM.currentPanel = panel;
  document.querySelectorAll('.adm-nav-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.adm-panel').forEach(function(p) {
    p.style.display = 'none';
    p.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  var panelEl = document.getElementById('adm-' + panel);
  if (panelEl) { panelEl.style.display = 'block'; panelEl.classList.add('active'); }
  var loaders = {
    overview:   loadAdmOverview,
    users:      function() { loadAdmUsers(); },
    invites:    loadAdmInvites,
    behaviour:  loadAdmBehaviour,
    activity:   loadAdmActivity,
    events:     loadAdmEvents,
    ai:         loadAdmAI,
    settings:   loadAdmSettings,
  };
  if (loaders[panel]) loaders[panel]();
}

// ── Invites panel ──────────────────────────────────────────────
function loadAdmInvites() {
  var panel = document.getElementById('adm-invites');
  if (!panel) return;
  panel.innerHTML = '<div style="font-family:var(--fh);font-size:18px;font-weight:700;margin-bottom:16px">Invite Codes</div>'
    + '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">'
    + '<input id="inv-label" class="fi" placeholder="Label (e.g. Beta tester)" style="flex:1;min-width:140px;font-size:11px;padding:7px 10px">'
    + '<input id="inv-email" class="fi" placeholder="Email hint (optional)" style="flex:1;min-width:140px;font-size:11px;padding:7px 10px">'
    + '<input id="inv-maxuses" class="fi" type="number" min="1" max="100" value="1" style="width:70px;font-size:11px;padding:7px 10px">'
    + '<button class="btn btn-p btn-sm" onclick="admCreateInvite()">+ Generate</button>'
    + '</div>'
    + '<div id="inv-list"><div style="color:var(--t3);font-size:11px">Loading...</div></div>'
    + '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)">'
    + '<div style="font-size:11px;font-weight:600;color:var(--t2);margin-bottom:8px">Registration Mode</div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn btn-g btn-sm" onclick="admToggleReg(true)">Open Registration</button>'
    + '<button class="btn btn-o btn-sm" onclick="admToggleReg(false)">Invite Only</button>'
    + '</div>'
    + '<div id="inv-reg-status" style="font-size:10px;color:var(--t3);margin-top:6px"></div>'
    + '</div>';
  admLoadInviteList();
  // Check current status
  rq('/api/auth/registration-status').then(function(r) {
    var el2 = document.getElementById('inv-reg-status');
    if (el2 && r) el2.textContent = 'Current mode: ' + (r.registration_open ? 'Open (anyone can register)' : 'Invite-only');
  });
}

function admLoadInviteList() {
  rq('/api/auth/invites').then(function(r) {
    var el2 = document.getElementById('inv-list');
    if (!el2 || !r || !r.invites) return;
    if (!r.invites.length) {
      el2.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:12px 0">No invite codes yet. Generate one above.</div>';
      return;
    }
    var html = '<table style="width:100%;border-collapse:collapse;font-size:11px">'
      + '<tr style="color:var(--t3);font-size:9px;text-transform:uppercase;border-bottom:1px solid var(--bd)">'
      + '<th style="text-align:left;padding:4px 6px">Code</th>'
      + '<th style="text-align:left;padding:4px 6px">Label</th>'
      + '<th style="padding:4px 6px">Uses</th>'
      + '<th style="text-align:left;padding:4px 6px">Used by</th>'
      + '<th style="padding:4px 6px">Created</th>'
      + '<th></th>'
      + '</tr>';
    r.invites.forEach(function(inv) {
      var used = inv.use_count >= inv.max_uses;
      var col  = used ? 'var(--t4)' : 'var(--b4)';
      html += '<tr style="border-bottom:1px solid var(--bd)">'
        + '<td style="padding:7px 6px"><span style="font-family:monospace;font-size:12px;color:' + col + '">' + inv.code + '</span>'
        + ' <button data-copy="' + inv.code + '" style="background:none;border:none;cursor:pointer;font-size:10px;color:var(--t3)">Copy</button>'
        + '</td>'
        + '<td style="padding:7px 6px;color:var(--t2)">' + (inv.label || '—') + '</td>'
        + '<td style="padding:7px 6px;text-align:center;color:' + (used ? 'var(--gr)' : 'var(--t2)') + '">' + inv.use_count + '/' + inv.max_uses + '</td>'
        + '<td style="padding:7px 6px;color:var(--t3);font-size:10px">' + (inv.used_by_email || '—') + '</td>'
        + '<td style="padding:7px 6px;color:var(--t3);font-size:10px">' + (inv.created_at || '').slice(0,10) + '</td>'
        + '<td style="padding:7px 6px"><button data-del="' + inv.id + '" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--t4)">x</button></td>'
        + '</tr>';
    });
    html += '</table>';
    el2.innerHTML = html;
    // Event delegation
    el2.addEventListener('click', function(e) {
      var cp = e.target.closest('[data-copy]');
      var dl = e.target.closest('[data-del]');
      if (cp) {
        var code = cp.dataset.copy;
        if (navigator.clipboard) { navigator.clipboard.writeText(code).then(function(){ toast('Copied: ' + code, 's'); }); }
        else toast(code, 'i');
      }
      if (dl) admDeleteInvite(parseInt(dl.dataset.del));
    });
  });
}
function admCreateInvite() {
  var label    = (document.getElementById('inv-label')    || {}).value || '';
  var email    = (document.getElementById('inv-email')    || {}).value || '';
  var maxUses  = parseInt((document.getElementById('inv-maxuses') || {}).value || '1');
  rq('/api/auth/invites', { method:'POST', body:{ label:label, email_hint:email, max_uses:maxUses } }).then(function(r) {
    if (r && r.code) {
      toast('Code: ' + r.code, 's');
      admLoadInviteList();
      var l=document.getElementById('inv-label'); if(l) l.value='';
      var e=document.getElementById('inv-email'); if(e) e.value='';
    }
  });
}

function admDeleteInvite(id) {
  if (!confirm('Delete this invite code?')) return;
  rq('/api/auth/invites/' + id, { method:'DELETE' }).then(function() { admLoadInviteList(); });
}

function admToggleReg(open) {
  rq('/api/auth/registration-toggle', { method:'POST', body:{ open:open } }).then(function(r) {
    var el2 = document.getElementById('inv-reg-status');
    if (el2 && r) el2.textContent = 'Current mode: ' + (r.registration_open ? 'Open' : 'Invite-only');
    toast(open ? 'Registration opened' : 'Invite-only mode enabled', 's');
  });
}

// ── Behaviour panel ────────────────────────────────────────────
function loadAdmBehaviour() {
  rq('/api/admin/behaviour/summary?days=30').then(function(r) {
    if (!r) return;

    // KPIs
    var s = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
    s('beh-total-actions', (r.total_actions||0).toLocaleString());
    s('beh-active-users',  r.active_users || 0);
    s('beh-ai-feedback',   (r.ai_feedback && r.ai_feedback.total) || 0);
    s('beh-satisfaction',  (r.ai_feedback && r.ai_feedback.satisfaction) ? r.ai_feedback.satisfaction + '%' : '—');

    // Top actions bar chart
    var actEl = document.getElementById('beh-top-actions');
    if (actEl && r.top_actions && r.top_actions.length) {
      var maxCnt = r.top_actions[0].cnt;
      actEl.innerHTML = r.top_actions.map(function(a) {
        var pct = Math.round(a.cnt / maxCnt * 100);
        return '<div style="margin-bottom:7px">'
          + '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'
          + '<span style="color:var(--t2)">' + a.action + '</span>'
          + '<span style="color:var(--t3)">' + a.cnt.toLocaleString() + '</span>'
          + '</div>'
          + '<div style="height:5px;background:var(--bg3);border-radius:3px">'
          + '<div style="height:5px;width:' + pct + '%;background:var(--b5);border-radius:3px"></div></div>'
          + '</div>';
      }).join('');
    }

    // Category affinity
    var catEl = document.getElementById('beh-cat-affinity');
    if (catEl && r.cat_affinity && r.cat_affinity.length) {
      var maxCat = r.cat_affinity[0].cnt;
      var CATS_LOCAL = { ECONOMICS:'#10B981',FINANCE:'#06B6D4',CONFLICT:'#EF4444',
        GEOPOLITICS:'#3B82F6',POLITICS:'#6366F1',ENERGY:'#F59E0B',
        TECHNOLOGY:'#8B5CF6',DISASTER:'#F97316',HUMANITARIAN:'#EC4899' };
      catEl.innerHTML = r.cat_affinity.map(function(c) {
        var pct = Math.round(c.cnt / maxCat * 100);
        var col = CATS_LOCAL[c.category] || '#64748B';
        return '<div style="margin-bottom:7px">'
          + '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'
          + '<span style="color:' + col + ';font-weight:600">' + c.category + '</span>'
          + '<span style="color:var(--t3)">' + c.cnt.toLocaleString() + '</span>'
          + '</div>'
          + '<div style="height:5px;background:var(--bg3);border-radius:3px">'
          + '<div style="height:5px;width:' + pct + '%;background:' + col + ';border-radius:3px;opacity:.7"></div></div>'
          + '</div>';
      }).join('');
    }

    // Section popularity
    var secEl = document.getElementById('beh-sections');
    if (secEl && r.sections && r.sections.length) {
      var maxSec = r.sections[0].cnt;
      secEl.innerHTML = r.sections.map(function(s2) {
        var pct = Math.round(s2.cnt / maxSec * 100);
        return '<div style="margin-bottom:7px">'
          + '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'
          + '<span style="color:var(--t2)">' + (s2.section || 'unknown') + '</span>'
          + '<span style="color:var(--t3)">' + s2.cnt.toLocaleString() + '</span>'
          + '</div>'
          + '<div style="height:5px;background:var(--bg3);border-radius:3px">'
          + '<div style="height:5px;width:' + pct + '%;background:var(--am);border-radius:3px;opacity:.7"></div></div>'
          + '</div>';
      }).join('');
    }

    // AI feedback detail
    var fbEl = document.getElementById('beh-ai-detail');
    if (fbEl && r.ai_feedback) {
      var fb = r.ai_feedback;
      fbEl.innerHTML = '<div style="display:flex;gap:16px;margin-bottom:12px">'
        + '<div style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--gr)">'
        + (fb.positive||0) + '</div><div style="font-size:9px;color:var(--t3)">Helpful</div></div>'
        + '<div style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--re)">'
        + (fb.negative||0) + '</div><div style="font-size:9px;color:var(--t3)">Not helpful</div></div>'
        + '<div style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--am)">'
        + (fb.satisfaction||0) + '%</div><div style="font-size:9px;color:var(--t3)">Satisfaction</div></div>'
        + '</div>'
        + (fb.samples && fb.samples.length
          ? '<div style="font-size:9px;color:var(--t3);margin-bottom:6px">Recent feedback:</div>'
          + fb.samples.slice(0,5).map(function(s2) {
              return '<div style="padding:5px 8px;background:var(--bg3);border-radius:6px;margin-bottom:4px;font-size:10px">'
                + '<span style="color:' + (s2.rating===1?'var(--gr)':'var(--re)') + ';margin-right:6px">'
                + (s2.rating===1?'+1':'-1') + '</span>'
                + (s2.question||'').slice(0,60)
                + '</div>';
            }).join('') : '');
    }
  });
}

function admExportTraining() {
  rq('/api/admin/export-training-data?min_rating=1&limit=2000').then(function(r) {
    if (!r || !r.examples || !r.examples.length) {
      toast('No training data yet', 'e'); return;
    }
    var jsonl = r.examples.map(function(e) { return JSON.stringify(e); }).join('\n');
    var blob  = new Blob([jsonl], { type: 'application/jsonlines' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'worldlens-training-' + new Date().toISOString().slice(0,10) + '.jsonl';
    a.click();
    toast('Exported ' + r.examples.length + ' training examples', 's');
    track('training_data_exported', 'admin', String(r.examples.length));
  });
}

// ── OVERVIEW ─────────────────────────────────────────
async function loadAdmOverview() {
  var r = await rq('/api/admin/overview');
  if (!r || !r.users) return;

  var u = r.users, ev = r.events;
  var kpis = [
    {label:'Total Users',   val:u.total,         sub:'+'+u.new_this_week+' this week', col:'var(--b4)'},
    {label:'Active Users',  val:u.active,        sub:u.dau+' today',                   col:'var(--gr)'},
    {label:'Events 24h',    val:ev.last_24h,      sub:ev.high_impact+' high impact',    col:'var(--am)'},
    {label:'Total Events',  val:ev.total.toLocaleString(), sub:'in database',           col:'var(--pu)'},
  ];
  el('adm-kpis').innerHTML = kpis.map(function(k) {
    return '<div class="adm-kpi"><div class="adm-kpi-lbl">'+k.label+'</div>'
      +'<div class="adm-kpi-val" style="color:'+k.col+'">'+k.val+'</div>'
      +'<div class="adm-kpi-sub">'+k.sub+'</div></div>';
  }).join('');

  // Top regions
  el('adm-top-regions').innerHTML = (r.top_regions||[]).map(function(rr) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
      +'<span style="font-size:12px;flex:1">'+( rr.country_name||rr.label||'Unknown')+'</span>'
      +'<span style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--b4)">'+rr.n+'</span>'
      +'</div>';
  }).join('') || '<div style="color:var(--t3);font-size:11px">No data</div>';

  // Top assets
  el('adm-top-assets').innerHTML = (r.top_assets||[]).map(function(a) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
      +'<span style="font-size:11px;color:var(--b4);font-family:var(--fh);font-weight:700;width:60px">'+a.value+'</span>'
      +'<span style="font-size:11px;flex:1;color:var(--t2)">'+( a.label||a.value)+'</span>'
      +'<span style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--am)">'+a.n+'</span>'
      +'</div>';
  }).join('') || '<div style="color:var(--t3);font-size:11px">No data</div>';

  // Section usage chart
  var canvas = document.getElementById('adm-section-chart');
  if (canvas && r.section_usage && r.section_usage.length) {
    var ctx = canvas.getContext('2d');
    var W = canvas.parentElement.offsetWidth - 28;
    canvas.width = W; canvas.height = 100;
    var data = r.section_usage.slice(0,6);
    var maxN = Math.max.apply(null, data.map(function(d){return d.n;})) || 1;
    var bw = W / data.length - 6;
    ctx.clearRect(0,0,W,100);
    data.forEach(function(d,i) {
      var bh = Math.max(4, (d.n/maxN)*72);
      var x = i*(bw+6)+3, y = 80-bh;
      var grad = ctx.createLinearGradient(0,y,0,80);
      grad.addColorStop(0,'#EF4444'); grad.addColorStop(1,'#7F1D1D');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x,y,bw,bh,3) : ctx.rect(x,y,bw,bh);
      ctx.fill();
      ctx.fillStyle='#4B5E7A'; ctx.font='9px sans-serif'; ctx.textAlign='center';
      ctx.fillText((d.section||'?').slice(0,6),x+bw/2,95);
      ctx.fillStyle='#F0F6FF'; ctx.font='bold 10px sans-serif';
      ctx.fillText(d.n,x+bw/2,y-3);
    });
  }

  // AI providers
  el('adm-ai-providers').innerHTML = (r.ai_providers||[]).map(function(p) {
    var col = p.ai_provider === 'gemini' ? 'var(--b4)' : 'var(--pu)';
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0">'
      +'<span style="font-size:12px;flex:1;font-weight:600;color:'+col+'">'+( p.ai_provider||'default')+'</span>'
      +'<span style="font-family:var(--fh);font-size:13px;font-weight:700">'+p.n+'</span>'
      +'</div>';
  }).join('') || '<div style="color:var(--t3);font-size:11px">No provider data</div>';
}

// ── USERS ─────────────────────────────────────────────
async function loadAdmUsers(search, role, active) {
  var s   = document.getElementById('adm-user-search')  ? document.getElementById('adm-user-search').value  : (search||'');
  var r   = document.getElementById('adm-user-role')    ? document.getElementById('adm-user-role').value    : (role||'');
  var act = document.getElementById('adm-user-active')  ? document.getElementById('adm-user-active').value  : '';
  var qs = '?search='+encodeURIComponent(s)+'&role='+r+(act!==''?'&active='+act:'');
  var data = await rq('/api/admin/users'+qs);
  if (!data || !data.users) return;
  var countEl = document.getElementById('adm-user-count');
  if (countEl) countEl.textContent = data.total + ' users';

  el('adm-user-tbody').innerHTML = data.users.map(function(u) {
    var statusBadge = u.is_active
      ? '<span class="adm-status adm-active">Active</span>'
      : '<span class="adm-status adm-inactive">Inactive</span>';
    var roleBadge = u.is_admin
      ? '<span class="adm-status adm-admin">Admin</span>'
      : '<span style="color:var(--t3);font-size:10px">User</span>';
    var joined = (u.created_at||'').slice(0,10);
    return '<tr>'
      +'<td><div style="display:flex;align-items:center;gap:7px"><div style="width:28px;height:28px;border-radius:50%;background:'+(u.avatar_color||'#3B82F6')+';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff">'+(u.username||'U').slice(0,2).toUpperCase()+'</div>'
      +'<div><div style="font-size:12px;font-weight:600">'+u.username+'</div></div></div></td>'
      +'<td style="color:var(--t2);font-size:11px">'+u.email+'</td>'
      +'<td>'+roleBadge+'</td>'
      +'<td>'+statusBadge+'</td>'
      +'<td style="text-align:center">'+u.watchlist_count+'</td>'
      +'<td style="text-align:center;color:'+(u.activity_7d>5?'var(--gr)':u.activity_7d>0?'var(--am)':'var(--t4)')+'">'+u.activity_7d+'</td>'
      +'<td style="color:var(--t3);font-size:10px">'+joined+'</td>'
      +'<td><div class="adm-actions">'
      +(u.is_active
        ? '<button class="adm-btn adm-btn-warning" onclick="admDeactivateUser('+u.id+')">Deactivate</button>'
        : '<button class="adm-btn adm-btn-ok"      onclick="admActivateUser('+u.id+')">Activate</button>')
      +'<button class="adm-btn adm-btn-danger" onclick="admDeleteUser('+u.id+',\''+u.username+'\')">Delete</button>'
      +'</div></td></tr>';
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:20px">No users found</td></tr>';
}

function admSearchUsers() { clearTimeout(ADM._searchTimer); ADM._searchTimer = setTimeout(loadAdmUsers, 300); }

async function admDeactivateUser(id) {
  if (!confirm('Deactivate this user?')) return;
  await rq('/api/admin/users/'+id+'/deactivate', {method:'POST'});
  toast('User deactivated','i'); loadAdmUsers();
}
async function admActivateUser(id) {
  await rq('/api/admin/users/'+id+'/activate', {method:'POST'});
  toast('User activated','s'); loadAdmUsers();
}
async function admDeleteUser(id, name) {
  if (!confirm('Permanently delete user "'+name+'"? This cannot be undone.')) return;
  await rq('/api/admin/users/'+id, {method:'DELETE'});
  toast('User deleted','i'); loadAdmUsers();
}

// ── ACTIVITY ─────────────────────────────────────────
async function loadAdmActivity() {
  var hours = document.getElementById('adm-act-hours') ? document.getElementById('adm-act-hours').value : 24;
  var r = await rq('/api/admin/activity?hours='+hours+'&limit=80');
  var t2 = await rq('/api/admin/activity/trending');

  if (r) {
    el('adm-act-tbody').innerHTML = (r.logs||[]).map(function(log) {
      return '<tr><td style="font-size:11px;color:var(--b4)">'+(log.username||'System')+'</td>'
        +'<td style="font-size:10px">'+log.action+'</td>'
        +'<td style="font-size:10px;color:var(--t3)">'+log.section+'</td>'
        +'<td style="font-size:10px;color:var(--t2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+log.detail+'</td>'
        +'<td style="font-size:9px;color:var(--t3)">'+tAgo(new Date(log.created_at))+'</td></tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:18px">No activity yet</td></tr>';

    el('adm-by-action').innerHTML = (r.by_action||[]).map(function(a) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'
        +'<span style="font-size:11px;flex:1">'+a.action+'</span>'
        +'<span style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--am)">'+a.n+'</span>'
        +'</div>';
    }).join('');
  }
  if (t2) {
    el('adm-top-interests').innerHTML = (t2.top_interests||[]).map(function(i) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'
        +'<span style="font-size:11px;flex:1;text-transform:capitalize">'+i.interest+'</span>'
        +'<span style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--b4)">'+i.n+'</span>'
        +'</div>';
    }).join('');
  }
}

// ── EVENTS ────────────────────────────────────────────
async function loadAdmEvents() {
  var s   = document.getElementById('adm-ev-search')  ? document.getElementById('adm-ev-search').value  : '';
  var cat = document.getElementById('adm-ev-cat')     ? document.getElementById('adm-ev-cat').value     : '';
  var imp = document.getElementById('adm-ev-impact')  ? document.getElementById('adm-ev-impact').value  : '';
  var qs  = '?search='+encodeURIComponent(s)+'&category='+cat+'&impact='+imp;
  var r = await rq('/api/admin/events'+qs);
  if (!r || !r.events) return;

  el('adm-ev-tbody').innerHTML = r.events.map(function(ev) {
    var impCls = ev.impact==='High'?'var(--re)':ev.impact==='Medium'?'var(--am)':'var(--gr)';
    var flagIcon = ev.admin_flagged ? '🚩 ' : '';
    return '<tr style="cursor:pointer" onclick="openAdmEventModal(\''+ev.id+'\')">'
      +'<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">'+flagIcon+ev.title+'</td>'
      +'<td><span style="font-size:9px;color:var(--b4);background:rgba(59,130,246,.1);padding:2px 6px;border-radius:100px">'+ev.category+'</span></td>'
      +'<td style="font-size:11px;color:var(--t2)">'+( ev.country_name||ev.country_code||'—')+'</td>'
      +'<td><span style="color:'+impCls+';font-size:10px;font-weight:700">'+ev.impact+'</span></td>'
      +'<td style="font-family:var(--fh);font-size:12px;font-weight:700">'+parseFloat(ev.severity||5).toFixed(1)+'</td>'
      +'<td style="font-size:11px">'+( ev.ai_impact_score?parseFloat(ev.ai_impact_score).toFixed(1):'—')+'</td>'
      +'<td style="text-align:center">'+(ev.admin_flagged?'<span style="color:var(--re)">🚩</span>':'')+'</td>'
      +'<td style="font-size:10px;color:var(--t3)">'+tAgo(new Date(ev.timestamp))+'</td>'
      +'<td onclick="event.stopPropagation()">'
      +'<div class="adm-actions">'
      +'<button class="adm-btn adm-btn-blue" onclick="openAdmEventModal(\''+ev.id+'\')">Edit</button>'
      +'<button class="adm-btn adm-btn-danger" onclick="admQuickDelete(\''+ev.id+'\')">Del</button>'
      +'</div></td></tr>';
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--t3);padding:20px">No events</td></tr>';
}

async function loadAdmDuplicates() {
  var r = await rq('/api/admin/events/duplicates?hours=48');
  var warn = document.getElementById('adm-dup-warning');
  if (r && r.duplicate_groups && r.duplicate_groups.length) {
    warn.style.display = 'block';
    warn.innerHTML = '⚠️ Found <strong>'+r.duplicate_groups.length+' duplicate groups</strong> in the last 48h: '
      + r.duplicate_groups.slice(0,3).map(function(g){return g.category+' in '+(g.country_name||g.country_code)+' ('+g.count+'x)';}).join(', ');
  } else {
    warn.style.display = 'block';
    warn.innerHTML = '✓ No significant duplicates detected in the last 48h.';
    warn.style.color = 'var(--gr)';
    warn.style.borderColor = 'rgba(16,185,129,.3)';
    warn.style.background  = 'rgba(16,185,129,.07)';
  }
}

// Event modal
function openAdmEventModal(id) {
  ADM.editEventId = id;
  var modal = document.getElementById('adm-event-modal');
  modal.classList.add('on');
  // Find event in DOM data
  rq('/api/admin/events?search='+id+'&limit=1').then(function(r) {
    if (!r || !r.events || !r.events.length) return;
    var ev = r.events[0];
    document.getElementById('adm-edit-id').value = ev.id;
    document.getElementById('adm-edit-title').value = ev.title || '';
    document.getElementById('adm-edit-ai-summary').value = ev.ai_summary || '';
    document.getElementById('adm-edit-market-note').value = ev.ai_market_note || '';
    document.getElementById('adm-edit-tone').value = ev.sentiment_tone || 'Neutral';
    document.getElementById('adm-edit-admin-note').value = ev.admin_note || '';
  });
}
function closeAdmEventModal() { document.getElementById('adm-event-modal').classList.remove('on'); }
async function admSaveEvent() {
  var id = document.getElementById('adm-edit-id').value;
  await rq('/api/admin/events/'+id, {method:'PUT', body:{
    title:         document.getElementById('adm-edit-title').value,
    ai_summary:    document.getElementById('adm-edit-ai-summary').value,
    ai_market_note:document.getElementById('adm-edit-market-note').value,
    admin_note:    document.getElementById('adm-edit-admin-note').value,
  }});
  await rq('/api/admin/ai/outputs/'+id, {method:'PUT', body:{
    sentiment_tone: document.getElementById('adm-edit-tone').value,
  }});
  closeAdmEventModal(); toast('Event updated','s'); loadAdmEvents();
}
async function admDeleteEvent() {
  var id = document.getElementById('adm-edit-id').value;
  if (!confirm('Delete this event?')) return;
  await rq('/api/admin/events/'+id, {method:'DELETE'});
  closeAdmEventModal(); toast('Event deleted','i'); loadAdmEvents();
}
async function admFlagEvent() {
  var id = document.getElementById('adm-edit-id').value;
  var note = document.getElementById('adm-edit-admin-note').value;
  await rq('/api/admin/events/'+id+'/flag', {method:'POST', body:{note:note}});
  toast('Event flagged','i'); closeAdmEventModal(); loadAdmEvents();
}
async function admQuickDelete(id) {
  if (!confirm('Delete this event?')) return;
  await rq('/api/admin/events/'+id, {method:'DELETE'});
  toast('Deleted','i'); loadAdmEvents();
}

// ── AI MONITOR ────────────────────────────────────────
async function loadAdmAI() {
  var r = await rq('/api/admin/ai/outputs?limit=60');
  if (!r) return;

  var stats = r.stats || {};
  var kpis = [
    {label:'AI Summaries',    val:stats.has_summary||0,   col:'var(--pu)'},
    {label:'Sentiment Done',  val:stats.has_sentiment||0, col:'var(--b4)'},
    {label:'Avg Score',       val:(stats.avg_impact_score||5).toFixed(1)+'/10', col:'var(--am)'},
    {label:'Coverage',        val:(stats.coverage_pct||0).toFixed(0)+'%', col:'var(--gr)'},
  ];
  el('adm-ai-kpis').innerHTML = kpis.map(function(k) {
    return '<div class="adm-kpi"><div class="adm-kpi-lbl">'+k.label+'</div>'
      +'<div class="adm-kpi-val" style="color:'+k.col+'">'+k.val+'</div></div>';
  }).join('');

  el('adm-ai-tbody').innerHTML = (r.outputs||[]).slice(0,40).map(function(ev) {
    var sentCol = ev.sentiment_tone==='Positive'?'var(--gr)':ev.sentiment_tone==='Negative'?'var(--re)':'var(--t2)';
    var sum = (ev.ai_summary||'—').slice(0,60)+'...';
    return '<tr><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">'+ev.title+'</td>'
      +'<td><span style="font-size:9px;color:var(--b4)">'+ev.category+'</span></td>'
      +'<td style="font-size:10px;color:var(--t2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+sum+'</td>'
      +'<td><span style="color:'+sentCol+';font-size:10px;font-weight:600">'+(ev.sentiment_tone||'—')+'</span></td>'
      +'<td style="font-family:var(--fh);font-size:12px;font-weight:700">'+(ev.ai_impact_score||'—')+'</td>'
      +'<td><button class="adm-btn adm-btn-blue" onclick="openAdmEventModal(\''+ev.id+'\')">Edit</button></td></tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:20px">No AI outputs yet</td></tr>';
}

// ── SETTINGS ─────────────────────────────────────────
async function loadAdmSettings() {
  var r = await rq('/api/admin/settings/ai');
  if (!r || r.detail) return;

  var activeProvider = r.global_provider || 'none';

  // ── Key status labels ──
  var cs = document.getElementById('claude-key-status');
  var gs = document.getElementById('gemini-key-status');
  if (cs) cs.textContent = r.claude_configured ? '✓ Key configured: ' + r.claude_key_preview : '✗ No key set';
  if (cs) cs.style.color = r.claude_configured ? 'var(--gr)' : 'var(--t3)';
  if (gs) gs.textContent = r.gemini_configured ? '✓ Key configured: ' + r.gemini_key_preview : '✗ No key set';
  if (gs) gs.style.color = r.gemini_configured ? 'var(--gr)' : 'var(--t3)';

  // ── Provider cards: highlight the ACTIVE one ──
  var cc = document.getElementById('adm-claude-card');
  var gc = document.getElementById('adm-gemini-card');
  if (cc) cc.classList.toggle('active-provider', activeProvider === 'claude');
  if (gc) gc.classList.toggle('active-provider', activeProvider === 'gemini');

  // ── Provider selector buttons ──
  ['gemini','claude','none'].forEach(function(p) {
    var btn = document.getElementById('prov-btn-' + p);
    if (!btn) return;
    var isActive = activeProvider === p;
    btn.style.background = isActive ? 'rgba(16,185,129,.2)' : '';
    btn.style.borderColor = isActive ? 'rgba(16,185,129,.5)' : '';
    btn.style.color       = isActive ? '#34D399' : '';
    btn.style.fontWeight  = isActive ? '700' : '';
  });

  // ── Badge ──
  var badge = document.getElementById('adm-provider-badge');
  if (badge) {
    var labels = { gemini: '✨ Gemini (active)', claude: '🤖 Claude (active)', none: '🚫 AI Disabled' };
    var colors = { gemini: '#34D399', claude: '#60A5FA', none: '#F87171' };
    badge.textContent = labels[activeProvider] || activeProvider;
    badge.style.color = colors[activeProvider] || 'var(--t3)';
    badge.style.background = activeProvider === 'none' ? 'rgba(248,113,113,.15)' :
                              activeProvider === 'claude' ? 'rgba(96,165,250,.15)' : 'rgba(52,211,153,.15)';
  }

  // ── System info table ──
  var sysEl = document.getElementById('adm-sys-info-body');
  if (sysEl) {
    var rows = [
      ['Active Provider', activeProvider],
      ['Gemini Key',  r.gemini_configured ? '✓ ' + r.gemini_key_preview : '✗ Not set'],
      ['Claude Key',  r.claude_configured  ? '✓ ' + r.claude_key_preview  : '✗ Not set (disabled)'],
      ['DB Path',     r.db_path || '—'],
    ];
    sysEl.innerHTML = rows.map(function(row) {
      return '<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
        + '<span style="color:var(--t3);width:130px;flex-shrink:0;font-size:11px">' + row[0] + '</span>'
        + '<span style="color:var(--t1);font-size:11px">' + row[1] + '</span></div>';
    }).join('');
  }
}

async function setGlobalProvider(provider) {
  var labels = { gemini: 'Google Gemini', claude: 'Claude (Anthropic)', none: 'Disabled' };
  var r = await rq('/api/admin/settings/ai/provider', {method:'POST', body:{provider:provider}});
  if (r && r.status === 'ok') {
    toast('AI provider set to: ' + (labels[provider] || provider), 's');
    loadAdmSettings();
  } else {
    toast('Failed to switch provider', 'e');
  }
}

async function saveAIKey(provider) {
  var inp = document.getElementById(provider + '-key-inp');
  if (!inp || !inp.value.trim()) { toast('Enter a valid API key', 'e'); return; }
  var r = await rq('/api/admin/settings/ai', {method:'POST', body:{provider:provider, api_key:inp.value.trim()}})
  if (r && r.status === 'ok') {
    // Auto-test after save — show inline result, never alert()
    var testEl = document.getElementById('ai-test-result');
    if (testEl) {
      testEl.style.display = 'block';
      testEl.textContent = 'Testing connection…';
      testEl.style.background = 'rgba(255,255,255,0.06)';
      testEl.style.color = 'var(--t2)';
    }
    var testR = await rq('/api/admin/test-ai');
    if (testEl && testR) {
      var isOK = testR.status === 'OK';
      testEl.textContent = (isOK ? '✓ ' : '✗ ') + (testR.message || 'Unknown result');
      testEl.style.background = isOK
        ? 'rgba(16,185,129,0.12)'
        : 'rgba(239,68,68,0.12)';
      testEl.style.color = isOK ? 'var(--gr)' : 'var(--re)';
      testEl.style.border = '1px solid ' + (isOK ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)');
      if (testR.response) {
        testEl.textContent += ' — Response: "' + testR.response + '"';
      }
    } else if (testEl) {
      testEl.textContent = '✗ Could not reach test endpoint';
      testEl.style.background = 'rgba(239,68,68,0.12)';
      testEl.style.color = 'var(--re)';
    }
  };
  if (r && r.status === 'ok') {
    toast('API key saved' + (r.persisted_to_env ? ' and written to .env' : ' (runtime only)'), 's');
    inp.value = '';
    loadAdmSettings();
  } else {
    toast(r && r.detail ? r.detail : 'Failed to save key', 'e');
  }
}

async function promoteAdmin() {
  var emailEl = document.getElementById('promote-email');
  if (!emailEl || !emailEl.value.trim()) { toast('Enter email', 'e'); return; }
  var r = await rq('/api/admin/settings/make-admin', {method:'POST', body:{email:emailEl.value.trim()}});
  if (r && r.status === 'ok') { toast('User promoted to admin', 's'); emailEl.value = ''; }
  else toast('User not found', 'e');
}

// ── Admin button injection is handled directly in enterApp via adminBtnInject() ──

function adminBtnInject() {
  // Only inject once
  if (document.getElementById('admin-nav-btn')) return;
  if (G.user && G.user.is_admin) {
    var adminBtn = document.createElement('button');
    adminBtn.id = 'admin-nav-btn';
    adminBtn.className = 'btn btn-sm';
    adminBtn.style.cssText = 'background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.35);color:#FCA5A5;font-size:10px;padding:4px 10px;margin-left:4px';
    adminBtn.textContent = 'Admin';
    adminBtn.onclick = openAdmin;
    var navr = document.getElementById('navr');
    if (navr) navr.insertBefore(adminBtn, navr.firstChild);
  }
}



// ── HTTP ──────────────────────────────────────────────
// ── UTILS ─────────────────────────────────────────────
function fmtChg(c) {
  if(c===null||c===undefined) return '—';
  return (c>=0?'+':'')+c.toFixed(2)+'%';
}
function tFmt(ts) {
  try {
    var d=new Date(ts);
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+' '+
           d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  } catch(e){ return ts||''; }
}
// ── TOAST ─────────────────────────────────────────────
// ════════════════════════════════════════════════════════
// MAP MODE CONTROLLER
// ════════════════════════════════════════════════════════

var G_MAP_MODE = 'events'; // 'events' | 'heatmap' | 'graph' | 'timeline'

function setMapMode(mode, btn) {
  G_MAP_MODE = mode;
  document.querySelectorAll('.mtool-btn[id^="mtool-"]').forEach(function(b) {
    b.classList.toggle('on', b === btn);
  });

  var timeline = document.getElementById('map-timeline');
  var kgOverlay = document.getElementById('kg-overlay');

  // Reset overlays
  if (timeline) timeline.classList.remove('on');
  if (kgOverlay) kgOverlay.classList.remove('on');

  if (mode === 'events' || mode === 'map') {
    if (G.hmOn) { G.hmOn = false; clearHeatmap(); }
    updateMarkers();
  } else if (mode === 'heatmap') {
    updateMarkers();
    G.hmOn = true;
    drawHeatmap();
  } else if (mode === 'graph') {
    loadKnowledgeGraph();
  } else if (mode === 'timeline') {
    if (timeline) timeline.classList.add('on');
    renderTimeline();
    updateMarkers();
  }
}

// ════════════════════════════════════════════════════════
// ENHANCED HEATMAP
// ════════════════════════════════════════════════════════

function clearHeatmap() {
  if (G.hmLayers) G.hmLayers.forEach(function(l) { try{G.map.removeLayer(l);}catch(e){} });
  G.hmLayers = [];
}

function drawHeatmap() {
  clearHeatmap();
  if (!G.map) return;

  // Group events by country → aggregate risk score
  var countryScores = {};
  G.events.forEach(function(e) {
    if (!e.country_code || e.country_code === 'XX') return;
    var cc = e.country_code;
    if (!countryScores[cc]) countryScores[cc] = { total: 0, count: 0, lat: e.latitude, lon: e.longitude, name: e.country_name };
    var mst = parseFloat(e.sent_market_stress || 0);
    var sev = e.severity || 5;
    // Combined risk: weighted average of severity + market stress signal
    countryScores[cc].total += sev * 0.7 + mst * 30;
    countryScores[cc].count++;
  });

  Object.values(countryScores).forEach(function(d) {
    var avgScore = d.total / d.count;
    var r = Math.max(80, Math.min(280, avgScore * 25));
    var col = avgScore >= 7 ? '#EF4444' : avgScore >= 5 ? '#F59E0B' : avgScore >= 3 ? '#3B82F6' : '#10B981';
    var opacity = 0.08 + (avgScore / 10) * 0.22;

    var circle = L.circle([d.lat, d.lon], {
      radius: r * 1000,
      color: col, fillColor: col,
      fillOpacity: opacity, weight: 0,
    });
    circle.bindTooltip(
      '<div style="font-size:11px;font-weight:600">' + d.name + '</div>' +
      '<div style="font-size:10px;color:' + col + '">' + d.count + ' events · avg ' + (d.total/d.count).toFixed(1) + '/10</div>',
      { permanent: false, direction: 'top' }
    );
    circle.addTo(G.map);
    G.hmLayers.push(circle);
  });

  toast('Heatmap: ' + Object.keys(countryScores).length + ' countries', 'i');
}

// ════════════════════════════════════════════════════════
// TIMELINE STRIP
// ════════════════════════════════════════════════════════

function renderTimeline() {
  var track = document.getElementById('timeline-track');
  if (!track) return;

  var now = Date.now();
  var hours = 48;
  var buckets = 48; // 1 per hour
  var bucketMs = (hours / buckets) * 3600000;
  var counts = new Array(buckets).fill(0);
  var severities = new Array(buckets).fill(0);

  G.events.forEach(function(e) {
    var age = now - new Date(e.timestamp).getTime();
    if (age < 0 || age > hours * 3600000) return;
    var idx = Math.min(buckets - 1, Math.floor(age / bucketMs));
    counts[idx]++;
    severities[idx] = Math.max(severities[idx], e.severity || 5);
  });

  var maxCount = Math.max.apply(null, counts) || 1;

  track.innerHTML = counts.map(function(c, i) {
    var hPct = Math.max(4, Math.round((c / maxCount) * 38));
    var sev = severities[i];
    var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#3B82F6';
    var hoursAgo = Math.round((i + 0.5) * (hours / buckets));
    return '<div class="tl-bar" style="height:' + hPct + 'px;background:' + col + '" ' +
      'title="' + hoursAgo + 'h ago · ' + c + ' events" ' +
      'onclick="filterByTimeRange(' + i + ',' + bucketMs + ')"></div>';
  }).reverse().join('');
}

function filterByTimeRange(bucketIdx, bucketMs) {
  var now = Date.now();
  var from = now - (bucketIdx + 1) * bucketMs;
  var to   = now - bucketIdx * bucketMs;
  var hoursAgo = Math.round((bucketIdx + 0.5) * bucketMs / 3600000);
  var evCount = G.events.filter(function(e) {
    var t = new Date(e.timestamp).getTime();
    return t >= from && t <= to;
  }).length;
  toast(hoursAgo + 'h ago — ' + evCount + ' events in this window', 'i');
}

// ════════════════════════════════════════════════════════
// MARKET STRESS METER
// ════════════════════════════════════════════════════════

var G_STRESS_ON = false;
function toggleStressMeter() {
  G_STRESS_ON = !G_STRESS_ON;
  var meter = document.getElementById('stress-meter');
  var btn = document.getElementById('mtool-sent');
  if (meter) meter.classList.toggle('on', G_STRESS_ON);
  if (btn) btn.classList.toggle('on', G_STRESS_ON);
  if (G_STRESS_ON) updateStressMeter();
}

function updateStressMeter() {
  var evs = G.events.slice(0, 40);
  var totalStress = 0, totalUnc = 0, count = 0;
  evs.forEach(function(e) {
    var mst = parseFloat(e.sent_market_stress || 0);
    var unc = parseFloat(e.sent_uncertainty || 0);
    // Weight by severity
    var w = (e.severity || 5) / 10;
    totalStress += mst * w;
    totalUnc += unc * w;
    count += w;
  });
  count = count || 1;
  var avgStress = totalStress / count;
  var avgUnc = totalUnc / count;

  var stressCol = avgStress > 0.6 ? '#EF4444' : avgStress > 0.3 ? '#F59E0B' : '#10B981';
  var stressLbl = avgStress > 0.6 ? 'HIGH' : avgStress > 0.3 ? 'ELEVATED' : 'STABLE';

  var sf  = document.getElementById('stress-fill');
  var sv_ = document.getElementById('stress-val');
  var sl  = document.getElementById('stress-lbl');
  var uf  = document.getElementById('unc-fill');
  var uv  = document.getElementById('unc-val');

  if (sf) { sf.style.width = (avgStress * 100).toFixed(0) + '%'; sf.style.background = stressCol; }
  if (sv_) sv_.textContent = (avgStress * 100).toFixed(0) + '%';
  if (sl) { sl.textContent = stressLbl; sl.style.color = stressCol; }
  if (uf) { uf.style.width = (avgUnc * 100).toFixed(0) + '%'; }
  if (uv) uv.textContent = (avgUnc * 100).toFixed(0) + '%';
}

// ════════════════════════════════════════════════════════
// NER ENTITY PANEL
// ════════════════════════════════════════════════════════

var G_NER = {};

async function loadNER() {
  var ev = G.panelEv;
  if (!ev) return;

  var chipsEl = document.getElementById('ep-ner-chips');
  var nerEl = document.getElementById('ep-ner');
  if (!chipsEl || !nerEl) return;

  // Check cache
  if (G_NER[ev.id]) { renderNER(G_NER[ev.id]); return; }

  chipsEl.innerHTML = '<span style="font-size:10px;color:var(--t3)">Extracting entities...</span>';
  nerEl.style.display = 'block';

  var r = await rq('/api/events/ner/' + ev.id, { method: 'POST' });
  if (!r || !r.entities) { chipsEl.innerHTML = '<span style="color:var(--t3);font-size:10px">No entities found</span>'; return; }
  G_NER[ev.id] = r.entities;
  renderNER(r.entities);
}

function renderNER(entities) {
  var chipsEl = document.getElementById('ep-ner-chips');
  var nerEl = document.getElementById('ep-ner');
  if (!chipsEl) return;
  nerEl.style.display = 'block';

  if (!entities.length) {
    chipsEl.innerHTML = '<span style="color:var(--t3);font-size:10px">No named entities detected</span>';
    return;
  }
  chipsEl.innerHTML = entities.map(function(ent) {
    var typeClass = (ent.type || '').toLowerCase();
    var sal = ent.salience ? ' (' + Math.round(ent.salience * 100) + '%)' : '';
    var hint = ent.sentiment_hint
      ? ' style="border-color:' + (ent.sentiment_hint === 'Positive' ? 'rgba(16,185,129,.4)' : ent.sentiment_hint === 'Negative' ? 'rgba(239,68,68,.4)' : '') + '"'
      : '';
    return '<span class="ner-entity-chip ' + typeClass + '"' + hint + '>'
      + (ent.text || '') + '<span style="opacity:.5;font-size:8px;margin-left:3px">' + (ent.type || '') + sal + '</span></span>';
  }).join('');
}

// ════════════════════════════════════════════════════════
// RELATED EVENTS PANEL (Knowledge Graph edges)
// ════════════════════════════════════════════════════════

var G_RELS = {};

async function loadRelatedEvents() {
  var ev = G.panelEv;
  if (!ev) return;

  var listEl = document.getElementById('ep-related-list');
  var relEl = document.getElementById('ep-related');
  var countEl = document.getElementById('ep-rel-count');
  if (!listEl || !relEl) return;

  // Cache check
  if (G_RELS[ev.id]) { renderRelated(G_RELS[ev.id]); return; }

  listEl.innerHTML = '<div style="font-size:10px;color:var(--t3);padding:6px 0">Finding related events...</div>';
  relEl.style.display = 'block';

  var r = await rq('/api/events/relationships/' + ev.id);
  if (!r || !r.relationships) { listEl.innerHTML = '<div style="font-size:10px;color:var(--t3)">No related events found</div>'; return; }
  G_RELS[ev.id] = r.relationships;
  renderRelated(r.relationships);
}

function renderRelated(rels) {
  var listEl = document.getElementById('ep-related-list');
  var relEl = document.getElementById('ep-related');
  var countEl = document.getElementById('ep-rel-count');
  if (!listEl) return;
  relEl.style.display = 'block';
  if (countEl) countEl.textContent = rels.length + ' links';

  if (!rels.length) {
    listEl.innerHTML = '<div style="font-size:10px;color:var(--t3)">No causal or correlated events detected</div>';
    return;
  }

  listEl.innerHTML = rels.slice(0, 6).map(function(rel) {
    var typeClass = 'rel-' + (rel.rel_type || 'correlated');
    var weight = rel.weight ? Math.round(rel.weight * 100) + '%' : '';
    var reasoning = rel.reasoning ? '<div style="font-size:9px;color:var(--t3);margin-top:2px;padding-left:4px">' + rel.reasoning + '</div>' : '';
    return '<div class="rel-event-row" onclick="openEP(\'' + rel.target_id + '\')">'
      + '<span class="rel-type-badge ' + typeClass + '">' + (rel.rel_type || '').slice(0,4) + '</span>'
      + '<div style="flex:1"><div class="rel-title">' + (rel.target_title || '') + '</div>'
      + reasoning + '</div>'
      + '<span class="rel-weight">' + weight + '</span>'
      + '</div>';
  }).join('');
}

// ════════════════════════════════════════════════════════
// ENHANCED SENTIMENT PANEL (multi-dimensional)
// ════════════════════════════════════════════════════════

function renderSentimentPanel(r) {
  var sec = document.getElementById('ep-sentiment');
  sec.style.display = 'block';

  var tone = r.tone || 'Neutral';
  var score = parseFloat(r.score || 0);
  var cls = tone === 'Positive' ? 'sent-pos' : tone === 'Negative' ? 'sent-neg' : 'sent-neu';
  var arrow = tone === 'Positive' ? '▲' : tone === 'Negative' ? '▼' : '●';

  var badge = document.getElementById('ep-sent-badge');
  badge.className = 'sent-badge ' + cls;
  badge.textContent = arrow + ' ' + tone + ' (' + (score >= 0 ? '+' : '') + score.toFixed(2) + ')';

  var bar = document.getElementById('ep-sent-bar');
  var absPct = Math.abs(score) * 50;
  bar.style.background = sentBarColor(score);
  if (score >= 0) { bar.style.left = '50%'; bar.style.width = absPct + '%'; }
  else { bar.style.left = (50 - absPct) + '%'; bar.style.width = absPct + '%'; }

  document.getElementById('ep-sent-score').textContent = (score >= 0 ? '+' : '') + score.toFixed(2);
  document.getElementById('ep-info-type').textContent = r.info_type || '';

  var intEl = document.getElementById('ep-intensity');
  var intColor = r.intensity === 'Extreme' ? 'var(--re)' : r.intensity === 'High' ? 'var(--or)' : r.intensity === 'Medium' ? 'var(--am)' : 'var(--t3)';
  intEl.textContent = r.intensity ? r.intensity + ' intensity' : '';
  intEl.style.color = intColor;

  // Multi-dimensional gauges
  var multidim = document.getElementById('ep-sent-multidim');
  var hasMultidim = r.uncertainty !== undefined || r.market_stress !== undefined;
  if (multidim && hasMultidim) {
    multidim.style.display = 'block';
    function setDim(id, valId, val) {
      var fill = document.getElementById(id);
      var valEl = document.getElementById(valId);
      if (fill) fill.style.width = (Math.abs(val) * 100).toFixed(0) + '%';
      if (valEl) valEl.textContent = (val >= 0 ? '' : '-') + (Math.abs(val) * 100).toFixed(0) + '%';
    }
    setDim('sdim-unc', 'sdim-unc-v', r.uncertainty || 0);
    setDim('sdim-mst', 'sdim-mst-v', r.market_stress || 0);
    // momentum can be negative — show abs, color by sign
    var mom = r.narrative_momentum || 0;
    setDim('sdim-mom', 'sdim-mom-v', mom);
    var momFill = document.getElementById('sdim-mom');
    if (momFill) momFill.style.background = mom > 0 ? '#F59E0B' : '#94A3B8';
    setDim('sdim-crd', 'sdim-crd-v', r.credibility || 0.72);
  }

  // Entity sentiments
  var entities = r.entity_sentiments || [];
  var entEl = document.getElementById('ep-entities');
  if (entities.length && entEl) {
    entEl.innerHTML = '<div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">Entity Sentiment</div>'
      + entities.slice(0, 4).map(function(ent) {
        var ec = ent.sentiment === 'Positive' ? 'sent-pos' : ent.sentiment === 'Negative' ? 'sent-neg' : 'sent-neu';
        var escore = typeof ent.score === 'number' ? (ent.score >= 0 ? '+' : '') + ent.score.toFixed(2) : '';
        return '<div class="entity-row">'
          + '<span class="entity-name">' + (ent.entity || '') + '</span>'
          + '<span class="entity-type">' + (ent.type || '') + '</span>'
          + '<span class="sent-badge ' + ec + '" style="padding:1px 7px;font-size:9px">' + (ent.sentiment || '') + (escore ? ' ' + escore : '') + '</span>'
          + '</div>'
          + (ent.reason ? '<div class="entity-reason" style="padding-left:4px">' + ent.reason + '</div>' : '');
      }).join('');
  } else if (entEl) {
    entEl.innerHTML = '';
  }
}

// ════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH — complete rewrite
// Fixes: stable layout, edge hover tooltips, side panel,
//        relationship explanations, animated simulation
// ════════════════════════════════════════════════════════════

var KG = {
  nodes: [], edges: [], loaded: false,
  animFrame: null,
  hovered: null,        // hovered node
  hoveredEdge: null,    // hovered edge
  selected: null,       // clicked/selected node
  sim: {                // simulation state
    running: false,
    alpha: 1.0,
    alphaDecay: 0.02,
    velocityDecay: 0.4,
  },
  pan: { x: 0, y: 0 },
  zoom: 1.0,
  nodeMap: {},
  lastMouse: { x: 0, y: 0 },
};

var REL_COLORS = {
  causal:      '#EF4444',
  correlated:  '#F59E0B',
  hierarchical:'#A78BFA',
  temporal:    '#475569',
};

var REL_LABELS = {
  causal:      'Causal — one event directly triggered another',
  correlated:  'Correlated — both driven by same underlying factor',
  hierarchical:'Hierarchical — one event is part of a larger pattern',
  temporal:    'Temporal — events close in time, possible link',
};


// ── Sprint 2: Admin — behaviour analytics + export training data ──────────

function admLoadBehaviourStats() {
  // Load AI feedback stats into the admin behaviour panel
  var detailEl = document.getElementById('beh-ai-detail');
  if (!detailEl) return;

  rq('/api/ai/feedback/stats').then(function(r) {
    if (!r) return;
    detailEl.innerHTML =
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">'
      + _admStatCard('Total Ratings', r.total || 0, 'var(--b4)')
      + _admStatCard('Positive (+1)', r.positive || 0, 'var(--gr)')
      + _admStatCard('Negative (-1)', r.negative || 0, 'var(--re)')
      + _admStatCard('Satisfaction', (r.satisfaction_rate || 0).toFixed(1) + '%', 'var(--am)')
      + '</div>'
      + (r.total >= 10
          ? '<div style="font-size:11px;color:var(--gr)">✓ Enough data to export for fine-tuning</div>'
          : '<div style="font-size:11px;color:var(--t3)">Need ' + (10 - (r.total||0)) + ' more ratings before exporting</div>');
  });

  // Load top affinity categories across all users
  rq('/api/admin/activity?action=event_opened&limit=500').then(function(r) {
    var catEl = document.getElementById('beh-top-cats');
    if (!catEl || !r || !r.actions) return;
    var cats = {};
    r.actions.forEach(function(a) {
      var detail = a.detail || '';
      var cat    = detail.split('|')[1] || '';
      if (cat) cats[cat] = (cats[cat] || 0) + 1;
    });
    var sorted = Object.keys(cats).sort(function(a,b){ return cats[b]-cats[a]; }).slice(0,8);
    if (!sorted.length) return;
    var total  = sorted.reduce(function(s,c){ return s + cats[c]; }, 0);
    catEl.innerHTML = '<div style="font-size:11px;font-weight:700;margin-bottom:8px">Top Categories (all users)</div>'
      + sorted.map(function(cat) {
          var pct = Math.round(cats[cat]/total*100);
          return '<div style="margin-bottom:5px">'
            + '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'
            + '<span style="color:var(--t2)">' + cat + '</span>'
            + '<span style="color:var(--t3)">' + cats[cat] + ' opens · ' + pct + '%</span></div>'
            + '<div style="height:4px;background:var(--bg3);border-radius:2px">'
            + '<div style="width:' + pct + '%;height:100%;background:var(--b5);border-radius:2px"></div></div></div>';
        }).join('');
  });
}

function _admStatCard(label, value, color) {
  return '<div style="background:var(--bg3);border-radius:8px;padding:10px 14px;min-width:90px">'
    + '<div style="font-size:20px;font-weight:800;color:' + color + '">' + value + '</div>'
    + '<div style="font-size:9px;color:var(--t3);margin-top:2px">' + label + '</div>'
    + '</div>';
}

/* ═══════════ 17_cascade.js ═══════════ */
/**
 * @file 17_cascade.js
 * @module WorldLens / Dependency Cascade Simulator
 *
 * Vista 3 — visualises how a risk shock propagates through the
 * global dependency network built by the backend Dependency Engine.
 *
 * Also contains:
 *  - ngSwitchMode extension for 'cascade' mode
 *  - Knowledge Explorer taxonomy expansion (35 topics)
 *  - Timeline resize fix
 */

// ══════════════════════════════════════════════════════
// 1.  DEPENDENCY CASCADE STATE
// ══════════════════════════════════════════════════════

var CAS = {
  nodes:   [],    // [{id, label, type, impact, hops, x, y, r, color}]
  edges:   [],    // [{src, tgt, weight, type}]
  zoom:    1,
  panX:    0,
  panY:    0,
  W:       0,
  H:       0,
  svg:     null,
  svgG:    null,
  selected:null,
  mode:    'cascade',  // 'cascade' | 'path' | 'critical'
};

var CAS_NODE_COLORS = {
  country:   '#3B82F6',
  company:   '#10B981',
  person:    '#F59E0B',
  sector:    '#8B5CF6',
  commodity: '#F97316',
  asset:     '#06B6D4',
  unknown:   '#64748B',
};

// ══════════════════════════════════════════════════════
// 2.  ngSwitchMode EXTENSION FOR CASCADE
// ══════════════════════════════════════════════════════

// ngSwitchMode: cascade mode handled in 15_knowledge_explorer.js

// ══════════════════════════════════════════════════════
// 3.  CASCADE SIMULATION  (calls /api/dependency/*)
// ══════════════════════════════════════════════════════

function casRun() {
  var src = (document.getElementById('cas-source')||{}).value||'';
  track('cascade_run', 'graph', src);
  var source = (document.getElementById('cas-source').value || 'US').trim();
  var shock  = parseFloat(document.getElementById('cas-shock').value)  || 8;
  var hops   = parseInt(document.getElementById('cas-hops').value)     || 3;
  var damp   = parseFloat(document.getElementById('cas-damp').value)   || 0.65;

  _casSetLoading('Running cascade from ' + source + '…');

  rq('/api/dependency/propagate', {
    method: 'POST',
    body:   { node: source, shock: shock, max_hops: hops, damping: damp },
  }).then(function(data) {
    if (!data || data.error) {
      _casShowError(data && data.error ? data.error
        : 'Dependency engine unavailable. Make sure events have been scraped.');
      return;
    }
    _casBuildFromPropagation(data);
    _casRenderSidebar(data);
  }).catch(function(e) {
    _casShowError('Network error: ' + e.message);
  });
}

function casPath() {
  var src = (document.getElementById('cas-path-src').value || '').trim();
  var tgt = (document.getElementById('cas-path-tgt').value || '').trim();
  if (!src || !tgt) { toast('Enter source and target', 'e'); return; }

  _casSetLoading('Finding path: ' + src + ' → ' + tgt + '…');

  rq('/api/dependency/path?source=' + encodeURIComponent(src) +
     '&target=' + encodeURIComponent(tgt) + '&max_paths=3')
  .then(function(data) {
    if (!data) { _casShowError('No response from server'); return; }
    if (!data.found) {
      _casShowMessage('No path found between ' + src + ' and ' + tgt + '.', data.explanation || '');
      return;
    }
    _casBuildFromPath(data);
    _casRenderPathSidebar(data);
  }).catch(function(e) { _casShowError(e.message); });
}

function casCritical() {
  _casSetLoading('Loading critical nodes…');
  rq('/api/dependency/critical?k=20')
  .then(function(data) {
    if (!data || !data.nodes) { _casShowError('No data'); return; }
    _casBuildFromCritical(data.nodes);
    _casRenderCriticalSidebar(data.nodes);
  }).catch(function(e) { _casShowError(e.message); });
}

// ══════════════════════════════════════════════════════
// 4.  DATA → GRAPH LAYOUT
// ══════════════════════════════════════════════════════

function _casBuildFromPropagation(data) {
  CAS.mode  = 'cascade';
  var nodes = [];
  var edges = [];
  var nodeMap = {};
  var W = CAS.W || 800, H = CAS.H || 500;
  var cx = W / 2, cy = H / 2;

  // Source node at centre
  var srcLabel = data.source_label || data.source_node || 'Source';
  var srcId    = data.source_node  || 'source';
  nodes.push({
    id: srcId, label: srcLabel, type: 'country',
    impact: data.shock || 10, hops: 0,
    x: cx, y: cy, r: 28, color: '#EF4444',
  });
  nodeMap[srcId] = nodes[0];

  // Affected nodes — radial by hop count
  var affected = (data.affected || []).slice(0, 40);
  var byHop    = {};
  affected.forEach(function(a) {
    var h = a.hops || 1;
    if (!byHop[h]) byHop[h] = [];
    byHop[h].push(a);
  });

  var rings = [0, 120, 210, 290, 360];
  Object.keys(byHop).forEach(function(hop) {
    var h   = parseInt(hop);
    var r   = rings[Math.min(h, rings.length-1)];
    var grp = byHop[hop];
    grp.forEach(function(a, i) {
      var angle = (2 * Math.PI * i / grp.length) - Math.PI/2;
      var ntype = (a.node_type || 'unknown').toLowerCase();
      var col   = CAS_NODE_COLORS[ntype] || CAS_NODE_COLORS.unknown;
      var nrad  = Math.max(6, Math.min(20, a.impact * 2.5));
      var n = {
        id: a.node_id, label: a.label || a.node_id, type: ntype,
        impact: a.impact, hops: h,
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        r: nrad, color: col,
        path: a.path || [], edgeTypes: a.edge_types || [],
      };
      nodes.push(n);
      nodeMap[a.node_id] = n;
    });
  });

  // Edges from path data
  affected.forEach(function(a) {
    var path = a.path || [];
    if (path.length >= 2) {
      var src = nodeMap[path[path.length-2]];
      var tgt = nodeMap[a.node_id];
      if (src && tgt) {
        var etype = (a.edge_types || []).slice(-1)[0] || 'dependency';
        edges.push({ src: src, tgt: tgt, weight: a.impact / 10, type: etype });
      }
    }
  });

  CAS.nodes = nodes;
  CAS.edges = edges;

  // Update title
  var title = document.getElementById('cas-title');
  if (title) title.textContent = 'Cascade: ' + srcLabel + ' (shock=' + (data.shock||'') + ')';
  var stat = document.getElementById('cas-stat');
  if (stat) stat.textContent = (data.total_affected || affected.length) + ' nodes affected';

  _casRender();
}

function _casBuildFromPath(data) {
  CAS.mode = 'path';
  var nodes = [];
  var edges = [];
  var W = CAS.W || 800, H = CAS.H || 500;

  var bestPath = data.paths && data.paths[0];
  if (!bestPath) { _casShowEmpty(); return; }

  var pathNodes = bestPath.nodes;
  var pathEdges = bestPath.edges;
  var n         = pathNodes.length;
  var padX      = 80;
  var stepX     = (W - 2*padX) / Math.max(n-1, 1);

  pathNodes.forEach(function(pn, i) {
    var ntype = (pn.node_type || 'unknown').toLowerCase();
    nodes.push({
      id: pn.id, label: pn.label || pn.id, type: ntype,
      impact: pn.risk_score || 5,
      x: padX + i * stepX, y: H / 2,
      r: 18, color: CAS_NODE_COLORS[ntype] || CAS_NODE_COLORS.unknown,
    });
  });

  pathEdges.forEach(function(pe, i) {
    if (nodes[i] && nodes[i+1]) {
      edges.push({ src: nodes[i], tgt: nodes[i+1], weight: pe.weight || 0.5, type: pe.edge_type || '' });
    }
  });

  CAS.nodes = nodes;
  CAS.edges = edges;

  var title = document.getElementById('cas-title');
  if (title) title.textContent = data.source + ' → ' + data.target;
  var stat = document.getElementById('cas-stat');
  if (stat) stat.textContent = bestPath.length + ' hops · weight=' + bestPath.total_weight;

  _casRender();
}

function _casBuildFromCritical(nodeList) {
  CAS.mode = 'critical';
  var W = CAS.W || 800, H = CAS.H || 500;
  var cx = W / 2, cy = H / 2;
  var nodes = [];

  nodeList.slice(0, 20).forEach(function(n, i) {
    var angle = (2 * Math.PI * i / Math.min(nodeList.length, 20)) - Math.PI/2;
    var ntype = (n.node_type || 'unknown').toLowerCase();
    var r     = Math.max(8, Math.min(26, n.criticality * 200));
    nodes.push({
      id:    n.node_id, label: n.label, type: ntype,
      impact: n.criticality * 10, hops: 0,
      x: cx + 200 * Math.cos(angle),
      y: cy + 200 * Math.sin(angle),
      r: r, color: CAS_NODE_COLORS[ntype] || CAS_NODE_COLORS.unknown,
      criticality: n.criticality, inDegree: n.in_degree,
    });
  });

  CAS.nodes = nodes;
  CAS.edges = [];

  var title = document.getElementById('cas-title');
  if (title) title.textContent = 'Most Critical Nodes';
  var stat  = document.getElementById('cas-stat');
  if (stat)  stat.textContent = nodeList.length + ' nodes ranked';

  _casRender();
}

// ══════════════════════════════════════════════════════
// 5.  SVG RENDERER
// ══════════════════════════════════════════════════════

function _casRender() {
  var svg = document.getElementById('cas-svg');
  if (!svg || !CAS.nodes.length) return;

  CAS.W = document.getElementById('cas-svg-wrap').offsetWidth  || 800;
  CAS.H = document.getElementById('cas-svg-wrap').offsetHeight || 500;
  svg.setAttribute('viewBox', '0 0 ' + CAS.W + ' ' + CAS.H);
  svg.innerHTML = '';

  var g = _svgEl('g', { id:'cas-g',
    transform:'translate('+ CAS.panX +',0) scale('+ CAS.zoom +',1)' });
  svg.appendChild(g);
  CAS.svgG = g;

  // Defs
  var defs = _svgEl('defs');
  defs.innerHTML =
    '<filter id="cas-glow"><feGaussianBlur stdDeviation="4" result="b"/>'
    + '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    + '<marker id="cas-arr" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto">'
    + '<path d="M0,0 L0,6 L8,3 z" fill="#475569"/></marker>';
  g.appendChild(defs);

  // Edges
  var eg = _svgEl('g');
  CAS.edges.forEach(function(e) {
    var dx = e.tgt.x - e.src.x, dy = e.tgt.y - e.src.y;
    var len = Math.sqrt(dx*dx + dy*dy) || 1;
    // Offset endpoints by node radius
    var sx = e.src.x + dx/len * e.src.r;
    var sy = e.src.y + dy/len * e.src.r;
    var tx = e.tgt.x - dx/len * e.tgt.r;
    var ty = e.tgt.y - dy/len * e.tgt.r;
    var cx2 = (sx+tx)/2, cy2 = (sy+ty)/2 - Math.abs(dx)*0.2;
    var line = _svgEl('path', {
      d: 'M'+sx+','+sy+' Q'+cx2+','+cy2+' '+tx+','+ty,
      fill: 'none', stroke: '#475569',
      'stroke-width': Math.max(0.8, e.weight * 3),
      'stroke-opacity': '0.5',
      'marker-end': 'url(#cas-arr)',
    });
    // Edge type label
    if (e.type && e.weight > 0.4) {
      var lbl = _svgEl('text', {
        x: cx2, y: cy2 - 4,
        'text-anchor': 'middle', 'font-size': '7.5',
        fill: '#64748B', 'pointer-events': 'none',
      });
      lbl.textContent = e.type.replace(/_/g,' ');
      eg.appendChild(lbl);
    }
    eg.appendChild(line);
  });
  g.appendChild(eg);

  // Nodes
  var ng2 = _svgEl('g');
  CAS.nodes.forEach(function(n) {
    var grp = _svgEl('g', { 'class':'cas-node', 'cursor':'pointer', 'data-id': n.id });

    // Glow ring for high-impact
    if (n.impact > 5) {
      var glow = _svgEl('circle', { cx:n.x, cy:n.y, r: n.r+5,
        fill: n.color, 'fill-opacity': '0.15' });
      grp.appendChild(glow);
    }

    // Main circle
    var circle = _svgEl('circle', { cx:n.x, cy:n.y, r:n.r,
      fill: n.color, 'fill-opacity': '0.85',
      stroke: n.color, 'stroke-width': n.id === CAS.selected ? '3' : '1' });
    grp.appendChild(circle);

    // Hop badge
    if (n.hops > 0) {
      var badge = _svgEl('circle', {
        cx: n.x + n.r*0.75, cy: n.y - n.r*0.75, r:5,
        fill:'var(--bg1)', stroke: n.color, 'stroke-width':'1'
      });
      var bt = _svgEl('text', {
        x: n.x+n.r*0.75, y: n.y-n.r*0.75+1,
        'text-anchor':'middle','dominant-baseline':'middle',
        'font-size':'6','font-weight':'700', fill: n.color, 'pointer-events':'none'
      });
      bt.textContent = n.hops;
      grp.appendChild(badge); grp.appendChild(bt);
    }

    // Impact bar (below node)
    if (CAS.mode === 'cascade') {
      var barW = Math.min(50, n.r * 3);
      var barH = 3;
      var barFill = Math.min(barW, n.impact / 10 * barW);
      grp.appendChild(_svgEl('rect', {
        x: n.x - barW/2, y: n.y + n.r + 4, width: barW, height: barH,
        rx:1, fill:'var(--bg3)'
      }));
      grp.appendChild(_svgEl('rect', {
        x: n.x - barW/2, y: n.y + n.r + 4, width: barFill, height: barH,
        rx:1, fill: n.impact > 6 ? '#EF4444' : n.impact > 3 ? '#F59E0B' : '#10B981'
      }));
    }

    // Label
    var maxLabelW = 80;
    var lbl = (n.label || '').replace(/_/g,' ');
    var truncLbl = lbl.length > 16 ? lbl.slice(0,14)+'…' : lbl;
    var lblW = Math.min(maxLabelW, truncLbl.length * 5.5 + 10);
    grp.appendChild(_svgEl('rect', {
      x: n.x - lblW/2, y: n.y + n.r + 8, width: lblW, height: 12, rx:3,
      fill: 'rgba(6,11,24,.8)', 'pointer-events':'none'
    }));
    var lt = _svgEl('text', {
      x: n.x, y: n.y + n.r + 15.5,
      'text-anchor':'middle', 'dominant-baseline':'middle',
      'font-size': n.hops===0 ? '9.5' : '8', 'font-weight': n.hops===0 ? '800' : '500',
      fill: '#CBD5E1', 'pointer-events':'none'
    });
    lt.textContent = truncLbl;
    grp.appendChild(lt);

    // Events
    grp.addEventListener('mouseenter', function() {
      circle.setAttribute('filter','url(#cas-glow)');
      circle.setAttribute('r', n.r * 1.2);
    });
    grp.addEventListener('mouseleave', function() {
      if (n.id !== CAS.selected) circle.removeAttribute('filter');
      circle.setAttribute('r', n.r);
    });
    grp.addEventListener('click', function(e2) {
      e2.stopPropagation();
      CAS.selected = n.id;
      _casSelectNode(n);
    });

    ng2.appendChild(grp);
  });
  g.appendChild(ng2);

  _casSetupPanZoom(svg);
}

// ── Node detail ──────────────────────────────────────
function _casSelectNode(n) {
  var res = document.getElementById('cas-results');
  if (!res) return;

  var col   = CAS_NODE_COLORS[n.type] || '#64748B';
  var html  = '<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:12px;margin-bottom:8px">';
  html += '<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">'
        + '<span style="font-size:9px;padding:2px 8px;border-radius:100px;background:'+col+'22;color:'+col+';font-weight:700;border:1px solid '+col+'44">'
        + (n.type||'').toUpperCase() + '</span>'
        + (n.hops > 0 ? '<span style="font-size:9px;color:var(--t3)">Hop '+n.hops+'</span>' : '<span style="font-size:9px;color:var(--re)">⚡ SOURCE</span>')
        + '</div>';
  html += '<div style="font-size:13px;font-weight:800;color:var(--t1);margin-bottom:6px">'+ (n.label||'').replace(/_/g,' ') +'</div>';

  if (n.impact !== undefined) {
    var impCol = n.impact > 6 ? 'var(--re)' : n.impact > 3 ? 'var(--am)' : 'var(--gr)';
    html += '<div style="display:flex;gap:14px;margin-bottom:8px">'
          + '<div><div style="font-size:8px;color:var(--t4)">IMPACT</div>'
          + '<div style="font-size:16px;font-weight:800;color:'+impCol+'">'+(n.impact||0).toFixed(2)+'</div></div>';
    if (n.criticality !== undefined) {
      html += '<div><div style="font-size:8px;color:var(--t4)">CRITICALITY</div>'
            + '<div style="font-size:16px;font-weight:800;color:var(--b4)">'+(n.criticality||0).toFixed(3)+'</div></div>';
    }
    html += '</div>';
  }

  if (n.edgeTypes && n.edgeTypes.length) {
    html += '<div style="font-size:9px;color:var(--t3);margin-bottom:8px">Via: '
          + n.edgeTypes.join(' → ') + '</div>';
  }

  // Action buttons
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap">';
  html += '<button onclick="document.getElementById(\'cas-source\').value=\''
        + (n.label||'').replace(/'/g,'').slice(0,20)
        + '\';casRun()" class="btn btn-ai btn-xs" style="font-size:9px;padding:4px 10px">'
        + '⚡ Run from here</button>';
  html += '<button onclick="document.getElementById(\'cas-path-src\').value=\''
        + (n.label||'').replace(/'/g,'').slice(0,20)
        + '\'" class="btn btn-p btn-xs" style="font-size:9px;padding:4px 10px">'
        + '→ Set as source</button>';
  html += '</div></div>';

  res.innerHTML = html;
}

// ── Sidebar renderers ─────────────────────────────────
function _casRenderSidebar(data) {
  var res = document.getElementById('cas-results');
  if (!res) return;

  var affected = (data.affected || []).slice(0, 15);
  var critPath = (data.critical_path_labels || []).join(' → ');

  var html = '';
  if (critPath) {
    html += '<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);'
          + 'border-radius:8px;padding:10px;margin-bottom:10px;font-size:9px;color:var(--t2)">'
          + '<div style="font-weight:700;color:var(--re);margin-bottom:5px">⚡ Critical Path</div>'
          + critPath + '</div>';
  }
  html += '<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;'
        + 'letter-spacing:.1em;margin-bottom:6px">Affected Nodes (' + (data.total_affected||0) + ')</div>';
  affected.forEach(function(a) {
    var ntype = (a.node_type||'unknown').toLowerCase();
    var col   = CAS_NODE_COLORS[ntype] || '#64748B';
    var impCol= a.impact > 6 ? 'var(--re)' : a.impact > 3 ? 'var(--am)' : 'var(--gr)';
    html += '<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;'
          + 'border-radius:8px;background:var(--bg2);margin-bottom:3px;cursor:pointer" '
          + 'onclick="(function(){var n=CAS.nodes.find(function(x){return x.id===\''
          + a.node_id.replace(/'/g,'') + '\'});if(n)_casSelectNode(n);})()">'
          + '<div style="width:8px;height:8px;border-radius:50%;background:'+col+';flex-shrink:0"></div>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:10px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
          + (a.label||a.node_id) + '</div>'
          + '<div style="font-size:8px;color:var(--t3)">' + ntype + ' · hop ' + a.hops + '</div>'
          + '</div>'
          + '<div style="font-size:11px;font-weight:800;color:'+impCol+';flex-shrink:0">'
          + (a.impact||0).toFixed(2) + '</div>'
          + '</div>';
  });
  res.innerHTML = html;
}

function _casRenderPathSidebar(data) {
  var res = document.getElementById('cas-results');
  if (!res) return;
  var html = '<div style="margin-bottom:8px">';
  (data.paths || []).forEach(function(p, pi) {
    html += '<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:10px;margin-bottom:6px">'
          + '<div style="font-size:9px;font-weight:700;color:var(--b4);margin-bottom:5px">Path '+(pi+1)
          + ' · '+p.length+' hops · weight='+p.total_weight+'</div>'
          + '<div style="font-size:10px;color:var(--t1);line-height:1.7">'
          + p.nodes.map(function(n){ return n.label; }).join(' <span style="color:var(--t4)">→</span> ')
          + '</div>';
    if (p.edges.length) {
      html += '<div style="font-size:8px;color:var(--t4);margin-top:4px">'
            + p.edges.map(function(e){ return e.edge_type; }).join(' · ') + '</div>';
    }
    html += '</div>';
  });
  html += '<div style="font-size:9px;color:var(--t3);padding:6px 4px">' + (data.explanation||'') + '</div></div>';
  res.innerHTML = html;
}

function _casRenderCriticalSidebar(nodeList) {
  var res = document.getElementById('cas-results');
  if (!res) return;
  var html = '<div style="font-size:9px;font-weight:700;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">Top Critical Nodes</div>';
  nodeList.slice(0,15).forEach(function(n, i) {
    var ntype = (n.node_type||'unknown').toLowerCase();
    var col   = CAS_NODE_COLORS[ntype] || '#64748B';
    html += '<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;background:var(--bg2);margin-bottom:2px">'
          + '<div style="font-size:9px;color:var(--t4);min-width:14px;text-align:right">' + (i+1) + '</div>'
          + '<div style="width:7px;height:7px;border-radius:50%;background:'+col+';flex-shrink:0"></div>'
          + '<div style="flex:1;min-width:0"><div style="font-size:10px;color:var(--t1);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'
          + (n.label||n.node_id) + '</div>'
          + '<div style="font-size:8px;color:var(--t3)">'+ntype+'</div></div>'
          + '<div style="font-size:10px;font-weight:700;color:var(--b4);flex-shrink:0">' + (n.criticality||0).toFixed(3) + '</div>'
          + '</div>';
  });
  res.innerHTML = html;
}

// ══════════════════════════════════════════════════════
// 6.  PAN / ZOOM / INIT
// ══════════════════════════════════════════════════════

function _casSetupPanZoom(svg) {
  var isPanning = false, startX = 0, startPan = 0;
  svg.addEventListener('mousedown', function(e) {
    if (e.target === svg || e.target.id === 'cas-g' ||
        e.target.tagName === 'svg') {
      isPanning = true; startX = e.clientX; startPan = CAS.panX;
      svg.style.cursor = 'grabbing';
    }
  });
  window.addEventListener('mousemove', function(e) {
    if (!isPanning) return;
    CAS.panX = startPan + (e.clientX - startX);
    casApplyTransform();
  });
  window.addEventListener('mouseup', function() {
    isPanning = false; svg.style.cursor = 'default';
  });
  svg.addEventListener('wheel', function(e) {
    e.preventDefault();
    var f = e.deltaY > 0 ? 0.85 : 1.18;
    var prev = CAS.zoom;
    CAS.zoom = Math.max(0.2, Math.min(5, CAS.zoom * f));
    var rect = svg.getBoundingClientRect();
    CAS.panX = (e.clientX - rect.left) - ((e.clientX - rect.left) - CAS.panX) * (CAS.zoom/prev);
    casApplyTransform();
  }, {passive:false});
}

function casApplyTransform() {
  var g = document.getElementById('cas-g');
  if (g) g.setAttribute('transform',
    'translate('+CAS.panX+',0) scale('+CAS.zoom+',1)');
}

function casZoom(f) {
  CAS.zoom = Math.max(0.2, Math.min(5, CAS.zoom * f));
  casApplyTransform();
}

function casFitView() {
  CAS.zoom = 1; CAS.panX = 0; casApplyTransform();
}

function _casInitSVG() {
  var wrap = document.getElementById('cas-svg-wrap');
  if (wrap) { CAS.W = wrap.offsetWidth || 800; CAS.H = wrap.offsetHeight || 500; }
}

function _casSetLoading(msg) {
  var res = document.getElementById('cas-results');
  if (res) res.innerHTML = '<div style="text-align:center;padding:28px 12px;color:var(--t3);font-size:11px">'
    + '<div class="ng-spinner" style="margin:0 auto 10px"></div>' + (msg||'Loading…') + '</div>';
  if (CAS.svgG) CAS.svgG.innerHTML = '';
}

function _casShowEmpty() {
  var svg = document.getElementById('cas-svg');
  if (!svg) return;
  _casInitSVG();
  svg.setAttribute('viewBox','0 0 '+CAS.W+' '+CAS.H);
  svg.innerHTML = '';
  var W=CAS.W, H=CAS.H;
  var t1 = _svgEl('text',{x:W/2,y:H/2-14,'text-anchor':'middle',fill:'#4B5E7A','font-size':'13'});
  t1.textContent='🔗 Dependency Cascade Simulator';
  var t2 = _svgEl('text',{x:W/2,y:H/2+12,'text-anchor':'middle',fill:'#2A3A52','font-size':'10'});
  t2.textContent='Enter a source node and run a cascade simulation';
  svg.appendChild(t1); svg.appendChild(t2);
}

function _casShowError(msg) {
  var res = document.getElementById('cas-results');
  if (res) res.innerHTML = '<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:8px;padding:12px;font-size:10px;color:#EF4444">'
    + '⚠ ' + (msg||'Error') + '</div>';
}

function _casShowMessage(title, body) {
  var res = document.getElementById('cas-results');
  if (res) res.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:8px;padding:12px;font-size:10px">'
    + '<div style="font-weight:700;color:var(--t1);margin-bottom:4px">'+title+'</div>'
    + '<div style="color:var(--t3)">'+body+'</div></div>';
}

// ══════════════════════════════════════════════════════
// 7.  KNOWLEDGE EXPLORER TAXONOMY EXPANSION
//     Expands from 8 to 35 topics inline
// ══════════════════════════════════════════════════════

if (typeof KEX_TAXONOMY !== 'undefined') {
  // Merge additional topics into existing taxonomy
  var KEX_TAXONOMY_EXT = {
    'nato': {
      related: ['Collective Defence','Article 5','Eastern Flank','Military Spending',
                'Nuclear Sharing','Cyber Defence','Interoperability','Enlargement'],
      entities: ['country:US','country:DE','country:FR','country:GB','country:PL','country:UA'],
      sources: ['wikipedia','cfr','reuters','scholar'],
    },
    'israel gaza': {
      related: ['Ceasefire','Humanitarian Corridor','Iron Dome','Hamas','Hezbollah',
                'Two-State Solution','West Bank Settlements','Aid Blockade'],
      entities: ['country:IL','country:PS','country:US','country:EG','country:QA'],
      sources: ['wikipedia','reuters','ft','cfr'],
    },
    'china taiwan': {
      related: ['Cross-Strait Relations','TSMC','Semiconductor Supply','US Arms Sales',
                'One China Policy','Military Drills','Economic Coercion','Reunification'],
      entities: ['country:CN','country:TW','country:US','sector:Semiconductors','company:TSM'],
      sources: ['wikipedia','reuters','cfr','scholar'],
    },
    'russia sanctions': {
      related: ['SWIFT Exclusion','Oligarch Assets','Energy Embargo','Circumvention',
                'Secondary Sanctions','G7 Price Cap','Frozen Reserves','Ruble Defense'],
      entities: ['country:RU','country:US','country:EU','asset:USD','commodity:Crude_Oil'],
      sources: ['wikipedia','reuters','ft','cfr'],
    },
    'dollar dominance': {
      related: ['De-dollarisation','BRICS Currency','Petrodollar','Reserve Currency',
                'SWIFT Alternative','Yuan Internationalisation','Gold Reserves','CBDCs'],
      entities: ['asset:USD','asset:Gold','country:US','country:CN','country:SA'],
      sources: ['wikipedia','investopedia','bis','ft'],
    },
    'us election': {
      related: ['Electoral College','Swing States','Campaign Finance','Super PAC',
                'Voter Turnout','Polling','Primary Elections','Battleground States'],
      entities: ['country:US','person:Biden','person:Trump'],
      sources: ['wikipedia','reuters','cfr'],
    },
    'climate change': {
      related: ['Carbon Tax','Net Zero','Paris Agreement','Carbon Credits','Climate Finance',
                'Methane Emissions','Sea Level Rise','Green Transition','COP','Deforestation'],
      entities: ['country:US','country:CN','country:EU','sector:Energy','sector:Renewable_Energy'],
      sources: ['wikipedia','reuters','scholar','ft'],
    },
    'lithium battery': {
      related: ['EV Supply Chain','Battery Gigafactories','Cobalt Mining','Solid State Battery',
                'Recycling','Critical Minerals','Chile Lithium','China Dominance'],
      entities: ['commodity:Lithium','commodity:Cobalt','company:TSLA','country:CL','country:CN'],
      sources: ['wikipedia','reuters','ft','scholar'],
    },
    'iran nuclear': {
      related: ['JCPOA','Uranium Enrichment','Centrifuges','Sanctions Relief',
                'IAEA Inspections','Proxy Forces','Ballistic Missiles','Strait of Hormuz'],
      entities: ['country:IR','country:US','country:IL','commodity:Crude_Oil'],
      sources: ['wikipedia','reuters','cfr','scholar'],
    },
    'china economy': {
      related: ['Property Crisis','Evergrande','Youth Unemployment','Deflationary Pressure',
                'Belt and Road','Export Dependence','Stimulus','State Owned Enterprises'],
      entities: ['country:CN','asset:CNY','sector:Banking','company:Alibaba'],
      sources: ['wikipedia','reuters','ft','caixin'],
    },
    'quantum computing': {
      related: ['Qubit','Error Correction','Quantum Supremacy','Cryptography Risk',
                'Post-Quantum Encryption','IBM Quantum','Google Sycamore','NSA Standards'],
      entities: ['company:GOOGL','company:MSFT','sector:Technology','country:US','country:CN'],
      sources: ['wikipedia','reuters','scholar','ft'],
    },
    'water scarcity': {
      related: ['Aquifer Depletion','Desalination','Water Wars','Irrigation Efficiency',
                'Groundwater','River Disputes','Climate Drought','Agricultural Use'],
      entities: ['country:IN','country:CN','country:EG','country:IL'],
      sources: ['wikipedia','reuters','scholar','cfr'],
    },
    'rare earth': {
      related: ['Chinese Monopoly','Processing Facilities','Neodymium','Dysprosium',
                'Supply Chain Security','Mine Development','EV Motors','Wind Turbines'],
      entities: ['country:CN','country:US','country:AU','sector:Semiconductors'],
      sources: ['wikipedia','reuters','ft','scholar'],
    },
    'cyber warfare': {
      related: ['State-Sponsored Hacking','Critical Infrastructure','Zero-Day Exploits',
                'Ransomware','Attribution','Cyber Norms','NSA','APT Groups'],
      entities: ['country:US','country:CN','country:RU','country:IL','sector:Cybersecurity'],
      sources: ['wikipedia','reuters','cfr','scholar'],
    },
    'opec strategy': {
      related: ['Production Cuts','Market Share','Break-Even Price','Saudi Vision 2030',
                'OPEC+ Alliance','Oil Price Floor','US Shale Competition','Demand Outlook'],
      entities: ['country:SA','country:RU','country:AE','commodity:Crude_Oil','sector:Energy'],
      sources: ['wikipedia','reuters','ft','investopedia'],
    },
    'emerging markets': {
      related: ['Capital Flight','Currency Crisis','IMF Bailout','Debt Distress',
                'FDI Inflows','Commodity Exporters','Frontier Markets','Contagion Risk'],
      entities: ['country:BR','country:IN','country:ZA','country:TR','asset:USD'],
      sources: ['wikipedia','investopedia','ft','bis'],
    },
    'europe energy': {
      related: ['LNG Imports','Nord Stream','Gas Storage','Green Hydrogen','Nuclear Revival',
                'Energy Prices','Energy Security','Interconnectors'],
      entities: ['country:EU','country:DE','country:RU','commodity:Natural_Gas','sector:Energy'],
      sources: ['wikipedia','reuters','ft','cfr'],
    },
    'india rise': {
      related: ['Manufacturing Hub','PLI Scheme','Digital Public Infrastructure',
                'Geopolitical Alignment','G20 Presidency','Population Dividend','Modi'],
      entities: ['country:IN','person:Modi','sector:Technology','asset:INR'],
      sources: ['wikipedia','reuters','ft','cfr'],
    },
    'deep sea mining': {
      related: ['Polymetallic Nodules','ISA Regulations','Manganese','Cobalt Crust',
                'Environmental Impact','Technology Race','Seabed Resources'],
      entities: ['commodity:Cobalt','commodity:Copper','country:US','country:CN'],
      sources: ['wikipedia','reuters','scholar'],
    },
    'food security': {
      related: ['Grain Exports','Fertiliser Prices','Black Sea Corridor','Drought Impact',
                'Subsistence Farming','Food Price Inflation','WFP Crisis'],
      entities: ['country:UA','country:RU','country:EG','commodity:Wheat'],
      sources: ['wikipedia','reuters','ft','scholar'],
    },
    'ai chips': {
      related: ['H100 GPU','AI Training Clusters','Export Controls','TSMC Advanced Node',
                'HBM Memory','Inference Efficiency','Data Centre Demand'],
      entities: ['company:NVDA','company:AMD','company:ASML','sector:Semiconductors',
                 'country:US','country:CN'],
      sources: ['wikipedia','reuters','ft','scholar'],
    },
    'sovereign debt': {
      related: ['Debt Restructuring','Bondholder Haircut','IMF Programme','Debt Relief',
                'CDS Spreads','Default Risk','Brady Bonds','Zambia Sri Lanka'],
      entities: ['asset:USD','country:ZM','country:LK','country:AR'],
      sources: ['wikipedia','investopedia','ft','bis'],
    },
    'nuclear power': {
      related: ['Small Modular Reactors','Uranium Supply','Waste Management','Renaissance',
                'France Nuclear','Japan Restart','Safety Post-Fukushima'],
      entities: ['commodity:Uranium','country:FR','country:JP','country:US','sector:Energy'],
      sources: ['wikipedia','reuters','ft','scholar'],
    },
    'us china tech war': {
      related: ['Entity List','Export Controls','Advanced Chips','AI Regulation',
                'TikTok Ban','Huawei','5G Infrastructure','Technology Decoupling'],
      entities: ['country:US','country:CN','company:NVDA','company:Huawei',
                 'sector:Semiconductors','sector:Telecommunications'],
      sources: ['wikipedia','reuters','ft','cfr'],
    },
    'space economy': {
      related: ['Satellite Broadband','Space Tourism','Lunar Resources','Debris',
                'Starlink','SpaceX','Artemis','Militarisation of Space'],
      entities: ['company:SpaceX','company:Boeing','country:US','country:CN'],
      sources: ['wikipedia','reuters','scholar'],
    },
    'cbdc': {
      related: ['Digital Yuan','E-Euro','Fed Digital Dollar','Financial Inclusion',
                'Privacy Concerns','Programmable Money','Bank Disintermediation'],
      entities: ['country:CN','country:EU','country:US','asset:USD','asset:CNY'],
      sources: ['wikipedia','investopedia','bis','reuters'],
    },
    'africa geopolitics': {
      related: ['Wagner Group','Coup Belt','China Investment','French Exit Sahel',
                'Mineral Wealth','Debt Trap','Migration Flows','African Union'],
      entities: ['country:ML','country:BF','country:NE','country:CN','country:RU','country:FR'],
      sources: ['wikipedia','reuters','cfr','scholar'],
    },
  };
  // Merge into KEX_TAXONOMY
  Object.keys(KEX_TAXONOMY_EXT).forEach(function(k) {
    KEX_TAXONOMY[k] = KEX_TAXONOMY_EXT[k];
  });
}

// ══════════════════════════════════════════════════════
// 8.  RESIZE FIXES
// ══════════════════════════════════════════════════════

// Timeline resize: re-init and re-render when panel becomes visible
if (window.ResizeObserver) {
  var _tlWrap = document.getElementById('tl-svg-wrap');
  if (_tlWrap) {
    new ResizeObserver(function(entries) {
      for (var e of entries) {
        var w = e.contentRect.width;
        var h = e.contentRect.height;
        if (w > 0 && h > 0 && typeof TL !== 'undefined') {
          TL.W = w; TL.H = h;
          var svg = document.getElementById('tl-svg');
          if (svg) svg.setAttribute('viewBox','0 0 '+w+' '+h);
          if (TL.built && TL.events && TL.events.length) {
            clearTimeout(TL._resizeTimer);
            TL._resizeTimer = setTimeout(function() {
              _tlComputeLayout(document.getElementById('tl-group') &&
                               document.getElementById('tl-group').checked);
              _tlComputeEdges(document.getElementById('tl-group') &&
                              document.getElementById('tl-group').checked);
              _tlRender();
            }, 150);
          }
        }
      }
    }).observe(_tlWrap);
  }

  // Cascade resize
  var _casWrap = document.getElementById('cas-svg-wrap');
  if (_casWrap) {
    new ResizeObserver(function(entries) {
      for (var e of entries) {
        var w = e.contentRect.width, h = e.contentRect.height;
        if (w > 0 && h > 0 && typeof CAS !== 'undefined') {
          CAS.W = w; CAS.H = h;
          if (CAS.nodes.length) _casRender();
        }
      }
    }).observe(_casWrap);
  }
}

/* ═══════════ 19_continent_streams.js ═══════════ */
/* ═══════════════════════════════════════════════════════════════════
   WORLDLENS — Continent Live News Streams  (19_continent_streams.js)
   ─────────────────────────────────────────────────────────────────
   4 live-feed panels on the Dashboard: Americas · Europe ·
   Asia-Pacific · Middle East & Africa.

   Features:
   ▸ Events filtered by country code → continent mapping
   ▸ Sorted by timestamp DESC — most recent at top
   ▸ "NEW" badge on events < 30 min old, auto-fades after 4s
   ▸ Slide-in animation on each row
   ▸ Bottom tape ticker scrolling latest headline
   ▸ Auto-refresh every 60s; on first load after renderDash()
   ▸ Click → flies to map + opens event panel
   ▸ Severity-coded colour dots + badges
   ═══════════════════════════════════════════════════════════════════ */

/* ── Continent country-code maps ────────────────────────────────── */
var CONT_CODES = {
  americas: [
    'US','CA','MX','BR','AR','CO','CL','PE','VE','EC','BO','PY','UY',
    'CR','PA','GT','HN','SV','NI','CU','DO','JM','HT','TT','BB','BS',
    'BZ','GY','SR','GF','PR','TC','VG','KY'
  ],
  europe: [
    'GB','DE','FR','IT','ES','PL','UA','RU','NL','BE','SE','NO','FI',
    'DK','AT','CH','CZ','SK','HU','RO','BG','GR','PT','HR','RS','SI',
    'BA','AL','MK','ME','XK','MD','BY','LT','LV','EE','IE','IS','LU',
    'MT','CY','TR','GE','AM','AZ'
  ],
  asiapac: [
    'CN','JP','IN','KR','AU','ID','TH','VN','MY','PH','SG','PK','BD',
    'LK','NP','MM','KH','LA','BN','MN','TW','HK','MO','NZ','FJ','PG',
    'TL','KZ','UZ','TM','KG','TJ','AF'
  ],
  mea: [
    'SA','IR','IL','EG','AE','IQ','SY','JO','LB','KW','QA','BH','OM',
    'YE','LY','TN','DZ','MA','SD','SS','ET','ER','SO','DJ','KE','TZ',
    'UG','RW','BI','CD','CG','GA','CM','NG','GH','CI','SN','ML','BF',
    'NE','MR','MZ','ZM','ZW','ZA','NA','BW','LS','SZ','MG','MW','AO'
  ]
};

/* Which continents exist for lookup */
var _contOf = {};
Object.keys(CONT_CODES).forEach(function(c) {
  CONT_CODES[c].forEach(function(cc) { _contOf[cc] = c; });
});

/* ── Visual config per continent ─────────────────────────────────── */
var CONT_CFG = {
  americas: { color:'#10B981', feedId:'cont-feed-americas', countId:'cont-am-count' },
  europe:   { color:'#3B82F6', feedId:'cont-feed-europe',   countId:'cont-eu-count' },
  asiapac:  { color:'#F59E0B', feedId:'cont-feed-asiapac',  countId:'cont-ap-count' },
  mea:      { color:'#EF4444', feedId:'cont-feed-mea',      countId:'cont-mea-count' },
};

/* ── State ─────────────────────────────────────────────────────── */
var _contTimer   = null;
var _contSeenIds = {};   // track IDs we've already rendered per continent

/* ── Helpers ─────────────────────────────────────────────────────── */
function _contSevColor(s) {
  return s >= 7 ? '#EF4444' : s >= 5 ? '#F59E0B' : '#10B981';
}
function _contSevBg(s) {
  return s >= 7 ? 'rgba(239,68,68,.14)' : s >= 5 ? 'rgba(245,158,11,.12)' : 'rgba(16,185,129,.1)';
}
function _contIsNew(ts) {
  return ts && (Date.now() - new Date(ts).getTime()) < 30 * 60 * 1000;
}

/* ── Main render ─────────────────────────────────────────────────── */
function renderContinentStreams() {
  var events = G.events || [];
  if (!events.length) return;

  /* Split by continent */
  var byContinent = { americas:[], europe:[], asiapac:[], mea:[] };
  events.forEach(function(ev) {
    var cc   = (ev.country_code || '').toUpperCase();
    var cont = _contOf[cc];
    if (cont && byContinent[cont]) byContinent[cont].push(ev);
  });

  /* Total badge */
  var total = Object.values(byContinent).reduce(function(s,a){ return s+a.length; }, 0);
  var tot   = document.getElementById('cont-total-count');
  if (tot) tot.textContent = total + ' geotagged events';

  /* Render each continent */
  Object.keys(byContinent).forEach(function(cont) {
    _renderContinentFeed(cont, byContinent[cont]);
  });
}

function _renderContinentFeed(cont, events) {
  var cfg    = CONT_CFG[cont];
  if (!cfg) return;

  var feedEl  = document.getElementById(cfg.feedId);
  var countEl = document.getElementById(cfg.countId);
  if (!feedEl) return;

  /* Update count badge */
  if (countEl) countEl.textContent = events.length;

  /* Sort by timestamp DESC, take top 15 */
  var sorted = events.slice().sort(function(a,b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  }).slice(0, 15);

  if (!sorted.length) {
    feedEl.innerHTML = '<div class="cont-empty">No events in this region<br>last 24 hours</div>';
    _updateTape(cont, null);
    return;
  }

  /* Determine which are new since last render */
  var seen = _contSeenIds[cont] || {};
  var newSeen = {};
  sorted.forEach(function(ev) { newSeen[ev.id] = true; });

  /* Build rows */
  feedEl.innerHTML = sorted.map(function(ev, idx) {
    var m      = (window.CATS && CATS[ev.category]) || { i:'●', c:'#00E5FF' };
    var sev    = parseFloat(ev.severity) || 5;
    var isNew  = !seen[ev.id] || _contIsNew(ev.timestamp);
    var sevC   = _contSevColor(sev);
    var sevBg  = _contSevBg(sev);
    var cname  = (ev.country_name || ev.country_code || 'Global').slice(0, 16);
    var timeStr= typeof tAgo === 'function'
      ? tAgo(new Date(ev.timestamp))
      : new Date(ev.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

    return [
      '<div class="cont-ev-row"',
        ' data-eid="', ev.id, '"',
        ' style="animation-delay:', (idx * 40), 'ms"',
      '>',
        /* Severity dot */
        '<div class="cont-ev-sev"',
          ' style="background:', sevC,
          ';box-shadow:0 0 5px ', sevC, '55">',
        '</div>',

        /* Body */
        '<div class="cont-ev-body">',
          '<div class="cont-ev-title">', ev.title, '</div>',
          '<div class="cont-ev-meta">',
            '<span class="cont-ev-cat"',
              ' style="background:', m.c, '18;color:', m.c, '">',
              m.i, ' ', ev.category.slice(0,7),
            '</span>',
            '<span class="cont-ev-country">', cname, '</span>',
            '<span class="cont-ev-time">', timeStr, '</span>',
          '</div>',
        '</div>',

        /* Severity badge */
        '<div class="cont-ev-sev-badge"',
          ' style="background:', sevBg, ';color:', sevC, '">',
          sev.toFixed(1),
        '</div>',

        /* NEW tag */
        (isNew ? '<div class="cont-ev-new-tag">NEW</div>' : ''),

      '</div>'
    ].join('');
  }).join('');

  /* Wire click handlers */
  feedEl.querySelectorAll('.cont-ev-row[data-eid]').forEach(function(row) {
    row.addEventListener('click', function() {
      var eid = this.dataset.eid;
      if (window.innerWidth <= 768 && typeof showHoloEvent === 'function') {
        if (showHoloEvent(eid)) return;
      }
      if (typeof sv === 'function') sv('map', document.querySelector('[data-v=map]'));
      setTimeout(function() { if (typeof openEP === 'function') openEP(eid); }, 600);
    });
  });

  /* Update seen IDs */
  _contSeenIds[cont] = newSeen;

  /* Bottom tape */
  _updateTape(cont, sorted[0]);
}

/* ── Scrolling tape at bottom of each stream ─────────────────────── */
function _updateTape(cont, latestEv) {
  var streamEl = document.querySelector('.cont-stream[data-continent="' + cont + '"]');
  if (!streamEl) return;

  var tape = streamEl.querySelector('.cont-stream-tape');
  if (!tape) {
    tape = document.createElement('div');
    tape.className = 'cont-stream-tape';
    streamEl.appendChild(tape);
  }

  var text = latestEv
    ? '▶ ' + (latestEv.country_name || '') + ': ' + latestEv.title + ' &nbsp;&nbsp;&nbsp;'
    : '▶ No events in the last 24 hours &nbsp;&nbsp;&nbsp;';

  tape.innerHTML = '<span class="cont-stream-tape-inner">' + text + text + '</span>';
}

/* ── Auto-refresh hook ───────────────────────────────────────────── */
function startContinentStreamRefresh() {
  /* Initial render */
  if ((G.events || []).length > 0) {
    renderContinentStreams();
  }

  /* Refresh every 60s */
  clearInterval(_contTimer);
  _contTimer = setInterval(function() {
    if (G.currentView === 'dash' || !G.currentView) {
      renderContinentStreams();
    }
  }, 60000);
}

/* ── Hook into renderDash ────────────────────────────────────────── */
(function() {
  var _origRenderDash = window.renderDash;
  window.renderDash = function() {
    if (typeof _origRenderDash === 'function') _origRenderDash();
    /* Small delay so bento cells are in DOM */
    setTimeout(renderContinentStreams, 120);
  };

  /* Also hook sv() → trigger render when switching to dash */
  var _origSv = window.sv;
  window.sv = function(name, btn) {
    if (typeof _origSv === 'function') _origSv(name, btn);
    if (name === 'dash') {
      setTimeout(renderContinentStreams, 200);
    }
  };

  /* Start refresh loop once events are available */
  (function waitForEvents() {
    if ((G.events || []).length > 0) {
      startContinentStreamRefresh();
    } else {
      setTimeout(waitForEvents, 800);
    }
  })();
})();

/* ═══════════ 08_knowledge_graph.js ═══════════ */
/**
 * @file 08_knowledge_graph.js
 * @module WorldLens/Knowledge Graph Visualisation
 *
 * @description
 * Force-directed graph of event relationships.
 * Fruchterman-Reingold simulation with alpha cooling.
 * Edge hover detection along Bézier curves, side panel for node/edge details.
 * Node click opens event detail panel.
 *
 * @dependencies 01_globals.js, 02_core.js
 * @exports loadKnowledgeGraph, initGraphCanvas, drawGraph, closeKnowledgeGraph, kgTick, kgOnMouseMove, kgOnClick, kgShowNodePanel, kgShowEdgePanel
 */


// ── Load data ────────────────────────────────────────────────

async function loadKnowledgeGraph() {
  var overlay = document.getElementById('kg-overlay');
  if (!overlay) return;
  overlay.classList.add('on');

  var statsEl = document.getElementById('kg-stats');
  if (statsEl) statsEl.textContent = 'Loading events…';

  var data = await rq('/api/events/graph/nodes?hours=48&min_severity=4.5&limit=60');
  if (!data || !data.nodes || !data.nodes.length) {
    if (statsEl) statsEl.textContent = 'No events with relationships yet — try again after a few minutes';
    return;
  }

  KG.nodes = data.nodes;
  KG.edges = data.edges || [];
  KG.loaded = true;

  if (statsEl) statsEl.textContent = data.node_count + ' events · ' + data.edge_count + ' links';

  initGraphCanvas();
}

// ── Canvas setup & layout ─────────────────────────────────────

function initGraphCanvas() {
  var canvas = document.getElementById('kg-canvas');
  if (!canvas) return;

  // Size canvas AFTER overlay is visible
  var W = canvas.parentElement.offsetWidth  || window.innerWidth;
  var H = canvas.parentElement.offsetHeight || window.innerHeight;
  canvas.width  = W;
  canvas.height = H;

  var n = KG.nodes.length;
  if (!n) return;

  // Build node map
  KG.nodeMap = {};
  KG.nodes.forEach(function(node) { KG.nodeMap[node.id] = node; });

  // Initial layout: spiral (more stable than pure circle)
  KG.nodes.forEach(function(node, i) {
    var angle  = (i / n) * 2 * Math.PI * 2.5;
    var radius = 60 + (i / n) * Math.min(W, H) * 0.28;
    node._x  = W/2 + radius * Math.cos(angle) + (Math.random()-0.5)*20;
    node._y  = H/2 + radius * Math.sin(angle) + (Math.random()-0.5)*20;
    node._vx = 0;
    node._vy = 0;
  });

  // Reset simulation
  KG.sim.alpha = 1.0;
  KG.sim.running = true;

  // Mouse interactions
  canvas.onmousemove = function(e) { kgOnMouseMove(e, canvas); };
  canvas.onmouseleave = function()  { kgOnMouseLeave(); };
  canvas.onclick = function(e)      { kgOnClick(e, canvas); };

  // Start animation loop
  if (KG.animFrame) cancelAnimationFrame(KG.animFrame);
  kgAnimate(canvas);
}

// ── Simulation tick ───────────────────────────────────────────

function kgTick(W, H) {
  if (!KG.sim.running) return;

  var k    = Math.sqrt((W * H) / Math.max(KG.nodes.length, 1)) * 0.9;
  var alpha = KG.sim.alpha;

  // Reset forces
  KG.nodes.forEach(function(n) { n._fx = 0; n._fy = 0; });

  // Repulsion O(n²) — kept fast with early exit on far nodes
  for (var i = 0; i < KG.nodes.length; i++) {
    var ni = KG.nodes[i];
    for (var j = i + 1; j < KG.nodes.length; j++) {
      var nj  = KG.nodes[j];
      var dx  = ni._x - nj._x;
      var dy  = ni._y - nj._y;
      var d2  = dx*dx + dy*dy || 1;
      var d   = Math.sqrt(d2);
      if (d > k * 4) continue;  // skip distant nodes → huge speedup
      var f   = (k * k) / d * alpha;
      var fx  = (dx/d) * f;
      var fy  = (dy/d) * f;
      ni._fx += fx; ni._fy += fy;
      nj._fx -= fx; nj._fy -= fy;
    }
  }

  // Attraction along edges
  KG.edges.forEach(function(e) {
    var s = KG.nodeMap[e.source];
    var t = KG.nodeMap[e.target];
    if (!s || !t) return;
    var dx  = t._x - s._x;
    var dy  = t._y - s._y;
    var d   = Math.sqrt(dx*dx + dy*dy) || 1;
    var w   = e.weight || 0.5;
    var f   = (d / k) * w * alpha * 0.6;
    var fx  = (dx/d) * f;
    var fy  = (dy/d) * f;
    s._fx += fx; s._fy += fy;
    t._fx -= fx; t._fy -= fy;
  });

  // Gravity toward centre (prevents drift)
  var cx = W/2, cy = H/2;
  KG.nodes.forEach(function(n) {
    n._fx += (cx - n._x) * 0.008 * alpha;
    n._fy += (cy - n._y) * 0.008 * alpha;
  });

  // Integrate velocities
  var vd = KG.sim.velocityDecay;
  KG.nodes.forEach(function(n) {
    n._vx = (n._vx + n._fx) * vd;
    n._vy = (n._vy + n._fy) * vd;
    // Clamp velocity
    var speed = Math.sqrt(n._vx*n._vx + n._vy*n._vy);
    if (speed > 8) { n._vx = n._vx/speed*8; n._vy = n._vy/speed*8; }
    n._x = Math.max(36, Math.min(W-36, n._x + n._vx));
    n._y = Math.max(52, Math.min(H-36, n._y + n._vy));
  });

  // Cool down
  KG.sim.alpha = Math.max(0, KG.sim.alpha - KG.sim.alphaDecay);
  if (KG.sim.alpha <= 0) KG.sim.running = false;
}

// ── Render ────────────────────────────────────────────────────

function kgAnimate(canvas) {
  KG.animFrame = requestAnimationFrame(function() { kgAnimate(canvas); });
  var W = canvas.width, H = canvas.height;
  kgTick(W, H);
  drawGraph(canvas, KG.nodeMap);
}

function drawGraph(canvas, nodeMap) {
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // Subtle grid
  ctx.strokeStyle = 'rgba(255,255,255,.018)';
  ctx.lineWidth   = 1;
  for (var gx = 0; gx < W; gx += 80) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
  }
  for (var gy = 0; gy < H; gy += 80) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
  }

  // ── Edges ──────────────────────────────────────────────────
  KG.edges.forEach(function(e) {
    var s = nodeMap[e.source], t = nodeMap[e.target];
    if (!s || !t) return;

    var col   = REL_COLORS[e.type] || '#475569';
    var w     = e.weight || 0.5;
    var isHov = KG.hoveredEdge &&
                KG.hoveredEdge.source === e.source &&
                KG.hoveredEdge.target === e.target;

    // Control point for curve (slightly offset perpendicular)
    var cx = (s._x + t._x)/2 + (t._y - s._y) * 0.12;
    var cy = (s._y + t._y)/2 - (t._x - s._x) * 0.12;

    ctx.beginPath();
    ctx.moveTo(s._x, s._y);
    ctx.quadraticCurveTo(cx, cy, t._x, t._y);

    if (e.type === 'temporal') {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }

    if (isHov) {
      // Highlighted edge
      ctx.strokeStyle = col;
      ctx.lineWidth   = 3.5;
      ctx.shadowColor = col;
      ctx.shadowBlur  = 8;
    } else {
      ctx.strokeStyle = col + Math.round(w * 160 + 50).toString(16).padStart(2,'0');
      ctx.lineWidth   = 1 + w * 2;
      ctx.shadowBlur  = 0;
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    // Arrow at target (offset by node radius)
    var nr  = Math.max(8, Math.min(22, (t.severity || 5) * 2.2));
    var adx = t._x - cx, ady = t._y - cy;
    var alen = Math.sqrt(adx*adx + ady*ady) || 1;
    var ax  = t._x - (nr + 6) * adx/alen;
    var ay  = t._y - (nr + 6) * ady/alen;
    var angle = Math.atan2(ady, adx);
    var ar = isHov ? 9 : 7;
    ctx.beginPath();
    ctx.moveTo(ax - ar*Math.cos(angle-0.4), ay - ar*Math.sin(angle-0.4));
    ctx.lineTo(ax, ay);
    ctx.lineTo(ax - ar*Math.cos(angle+0.4), ay - ar*Math.sin(angle+0.4));
    ctx.strokeStyle = isHov ? col : col + 'aa';
    ctx.lineWidth   = isHov ? 2 : 1.5;
    ctx.stroke();

    // Edge weight label on hover
    if (isHov) {
      var lx = (s._x + t._x)/2;
      var ly = (s._y + t._y)/2;
      var pct = Math.round((e.weight || 0.5) * 100) + '%';
      ctx.fillStyle  = 'rgba(4,9,18,.85)';
      ctx.fillRect(lx - 18, ly - 9, 36, 16);
      ctx.fillStyle  = col;
      ctx.font       = 'bold 9px sans-serif';
      ctx.textAlign  = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(pct, lx, ly);
    }
  });

  // ── Nodes ───────────────────────────────────────────────────
  ctx.textBaseline = 'middle';
  KG.nodes.forEach(function(node) {
    var isHov = KG.hovered     && KG.hovered.id     === node.id;
    var isSel = KG.selected    && KG.selected.id    === node.id;
    var cat   = CATS[node.category] || CATS.GEOPOLITICS;
    var r     = Math.max(9, Math.min(24, (node.severity || 5) * 2.2));
    if (isHov || isSel) r += 4;

    // Glow for high-severity or selected
    if (node.severity >= 7 || isHov || isSel) {
      var glowR = r * (isHov || isSel ? 3 : 2.2);
      var grd   = ctx.createRadialGradient(node._x, node._y, r*0.4, node._x, node._y, glowR);
      grd.addColorStop(0, cat.c + (isHov || isSel ? '66' : '33'));
      grd.addColorStop(1, cat.c + '00');
      ctx.beginPath();
      ctx.arc(node._x, node._y, glowR, 0, Math.PI*2);
      ctx.fillStyle = grd;
      ctx.fill();
    }

    // Circle fill
    ctx.beginPath();
    ctx.arc(node._x, node._y, r, 0, Math.PI*2);
    ctx.fillStyle = cat.c + (isHov || isSel ? 'dd' : '55');
    ctx.fill();

    // Circle border
    ctx.strokeStyle = isSel ? '#FFFFFF' : cat.c;
    ctx.lineWidth   = isSel ? 2.5 : isHov ? 2 : 1.5;
    ctx.stroke();

    // Category icon
    ctx.font         = Math.round(r * 0.9) + 'px sans-serif';
    ctx.textAlign    = 'center';
    ctx.fillStyle    = isSel ? '#fff' : cat.c;
    ctx.fillText(cat.i, node._x, node._y);

    // Node title label (always show, truncated)
    var titleMax = isHov || isSel ? 28 : 18;
    var label = (node.title || '').slice(0, titleMax) + ((node.title||'').length > titleMax ? '…' : '');
    ctx.font      = (isHov || isSel ? 'bold ' : '') + '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = isHov || isSel ? '#F0F6FF' : 'rgba(148,163,184,.8)';
    ctx.fillText(label, node._x, node._y + r + 10);
  });
}

// ── Mouse interaction ─────────────────────────────────────────

function kgOnMouseMove(e, canvas) {
  var rect = canvas.getBoundingClientRect();
  var mx   = e.clientX - rect.left;
  var my   = e.clientY - rect.top;
  KG.lastMouse = { x: mx, y: my };

  var prevHov = KG.hovered;
  var prevEdge = KG.hoveredEdge;
  KG.hovered     = null;
  KG.hoveredEdge = null;

  // Test nodes first
  for (var i = 0; i < KG.nodes.length; i++) {
    var node = KG.nodes[i];
    var r    = Math.max(9, Math.min(24, (node.severity||5)*2.2)) + 6;
    var dx   = mx - node._x, dy = my - node._y;
    if (dx*dx + dy*dy < r*r) {
      KG.hovered = node;
      canvas.style.cursor = 'pointer';
      break;
    }
  }

  // Test edges only if no node hovered
  if (!KG.hovered) {
    KG.edges.forEach(function(e) {
      var s = KG.nodeMap[e.source], t = KG.nodeMap[e.target];
      if (!s || !t) return;
      // Distance from point to quadratic bezier (approx with midpoint)
      var cx  = (s._x + t._x)/2 + (t._y - s._y)*0.12;
      var cy2 = (s._y + t._y)/2 - (t._x - s._x)*0.12;
      // Sample points along the curve
      for (var u = 0; u <= 1; u += 0.1) {
        var bx = (1-u)*(1-u)*s._x + 2*(1-u)*u*cx + u*u*t._x;
        var by = (1-u)*(1-u)*s._y + 2*(1-u)*u*cy2 + u*u*t._y;
        if (Math.abs(mx-bx) < 10 && Math.abs(my-by) < 10) {
          KG.hoveredEdge = e;
          canvas.style.cursor = 'crosshair';
          return;
        }
      }
    });
  }

  if (!KG.hovered && !KG.hoveredEdge) {
    canvas.style.cursor = 'default';
  }

  // Update panels if hover changed
  if (KG.hovered !== prevHov || KG.hoveredEdge !== prevEdge) {
    kgUpdatePanel(mx, my);
  }
}

function kgOnMouseLeave() {
  KG.hovered     = null;
  KG.hoveredEdge = null;
  var tip = document.getElementById('kg-edge-tip');
  if (tip) tip.style.display = 'none';
}

function kgOnClick(e, canvas) {
  if (KG.hovered) {
    KG.selected = KG.selected && KG.selected.id === KG.hovered.id ? null : KG.hovered;
    kgShowNodePanel(KG.selected || KG.hovered);
  } else if (KG.hoveredEdge) {
    kgShowEdgePanel(KG.hoveredEdge);
  } else {
    KG.selected = null;
    kgHidePanel();
  }
}

// ── Side panel rendering ──────────────────────────────────────

function kgUpdatePanel(mx, my) {
  if (KG.hovered) {
    // Show mini edge tooltip at cursor for hovered node
    var tip = document.getElementById('kg-edge-tip');
    if (tip) tip.style.display = 'none';
  } else if (KG.hoveredEdge) {
    var e   = KG.hoveredEdge;
    var s   = KG.nodeMap[e.source];
    var t   = KG.nodeMap[e.target];
    var col = REL_COLORS[e.type] || '#475569';
    var tip = document.getElementById('kg-edge-tip');
    if (tip) {
      tip.style.display = 'block';
      tip.style.left    = (mx + 14) + 'px';
      tip.style.top     = (my - 10) + 'px';
      tip.innerHTML =
        '<div style="font-size:9px;font-weight:700;color:' + col + ';text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">' + (e.type||'') + ' link</div>' +
        '<div style="font-size:9px;color:var(--t2);margin-bottom:4px">' + (REL_LABELS[e.type] || '') + '</div>' +
        '<div style="font-size:8px;color:var(--t3)">' + (s ? s.title.slice(0,32)+'…' : '') + '</div>' +
        '<div style="font-size:9px;color:'+col+';margin:2px 0">→</div>' +
        '<div style="font-size:8px;color:var(--t3)">' + (t ? t.title.slice(0,32)+'…' : '') + '</div>' +
        '<div style="margin-top:5px;font-size:8px;color:var(--t3)">Strength: <b style="color:'+col+'">' + Math.round((e.weight||0.5)*100) + '%</b> · Click for details</div>';
    }
  } else {
    var tip = document.getElementById('kg-edge-tip');
    if (tip) tip.style.display = 'none';
  }
}

function kgShowNodePanel(node) {
  var panel = document.getElementById('kg-panel');
  var body  = document.getElementById('kg-panel-body');
  if (!panel || !body || !node) return;

  var cat    = CATS[node.category] || CATS.GEOPOLITICS;
  var sevCol = node.severity >= 7 ? 'var(--re)' : node.severity >= 5 ? 'var(--am)' : 'var(--gr)';

  // Find connected edges
  var connected = KG.edges.filter(function(e) {
    return e.source === node.id || e.target === node.id;
  });

  // Build related nodes list
  var relHtml = connected.slice(0, 5).map(function(e) {
    var otherId = e.source === node.id ? e.target : e.source;
    var other   = KG.nodeMap[otherId];
    if (!other) return '';
    var col     = REL_COLORS[e.type] || '#475569';
    var dir     = e.source === node.id ? '→' : '←';
    return '<div class="kg-rel-row" onclick="kgShowEdgePanel(KG.edges.filter(function(x){return (x.source===\''+e.source+'\'&&x.target===\''+e.target+'\')||(x.target===\''+e.source+'\'&&x.source===\''+e.target+'\')})[0])">' +
      '<div>' +
        '<span class="kg-rel-badge kg-rel-' + e.type + '">' + (e.type||'').slice(0,4) + '</span>' +
        '<span style="font-size:9px;color:var(--t3);margin-left:4px">' + dir + '</span>' +
      '</div>' +
      '<div>' +
        '<div style="font-size:10px;color:var(--t1);line-height:1.3">' + (other.title||'').slice(0,40) + '</div>' +
        '<div style="font-size:8px;color:var(--t3);margin-top:1px">' + (e.reasoning || REL_LABELS[e.type] || '') + '</div>' +
      '</div>' +
      '<div style="font-size:9px;color:'+col+';flex-shrink:0">' + Math.round((e.weight||0.5)*100) + '%</div>' +
    '</div>';
  }).join('');

  body.innerHTML =
    '<div class="kg-panel-cat" style="background:' + cat.c + '22;color:' + cat.c + '">' + cat.i + ' ' + (node.category||'') + '</div>' +
    '<div class="kg-panel-title">' + (node.title||'') + '</div>' +
    '<div class="kg-panel-meta"><span>📍</span> ' + (node.country_name||'Global') + '</div>' +
    '<div class="kg-panel-meta"><span style="color:'+sevCol+'">●</span> Severity ' + (node.severity||5).toFixed(1) + '/10 · ' + (node.impact||'') + '</div>' +
    '<div class="kg-panel-meta"><span>🕐</span> ' + (node.timestamp ? node.timestamp.slice(0,16).replace('T',' ') : '') + '</div>' +
    (node.sentiment_tone ? '<div class="kg-panel-meta"><span>💬</span> Sentiment: ' + node.sentiment_tone + '</div>' : '') +
    (connected.length ?
      '<div class="kg-panel-section">Relationships (' + connected.length + ')</div>' + relHtml
      : '<div style="font-size:10px;color:var(--t3);margin-top:10px">No relationships found yet.<br>Relationships are computed automatically over time.</div>') +
    '<button class="kg-open-btn" onclick="closeKnowledgeGraph();setTimeout(function(){openEP(\''+node.id+'\')},150)">Open Full Event Panel →</button>';

  panel.classList.add('visible');
}

function kgShowEdgePanel(e) {
  if (!e) return;
  var panel = document.getElementById('kg-panel');
  var body  = document.getElementById('kg-panel-body');
  if (!panel || !body) return;

  var s   = KG.nodeMap[e.source];
  var t   = KG.nodeMap[e.target];
  var col = REL_COLORS[e.type] || '#475569';

  body.innerHTML =
    '<div class="kg-panel-cat" style="background:' + col + '22;color:' + col + '">' + (e.type||'') + ' relationship</div>' +
    '<div style="font-size:10px;color:var(--t3);margin-bottom:8px">' + (REL_LABELS[e.type] || '') + '</div>' +
    '<div class="kg-edge-panel">' +
      '<div style="font-size:9px;color:var(--t3);margin-bottom:4px">FROM</div>' +
      '<div style="font-size:11px;font-weight:600;color:var(--t1);margin-bottom:8px">' + (s ? s.title.slice(0,60) : e.source) + '</div>' +
      '<div style="font-size:9px;color:' + col + ';font-weight:700;margin-bottom:8px">→ ' + (e.type||'').toUpperCase() + ' (' + Math.round((e.weight||0.5)*100) + '% confidence)</div>' +
      '<div style="font-size:9px;color:var(--t3);margin-bottom:4px">TO</div>' +
      '<div style="font-size:11px;font-weight:600;color:var(--t1)">' + (t ? t.title.slice(0,60) : e.target) + '</div>' +
    '</div>' +
    (e.reasoning ? '<div class="kg-panel-summary">' + e.reasoning + '</div>' : '') +
    '<div style="font-size:9px;color:var(--t3);margin-top:8px">Strength computed from topic vector similarity × temporal proximity × geographic overlap.</div>' +
    (s ? '<button class="kg-open-btn" onclick="closeKnowledgeGraph();setTimeout(function(){openEP(\''+s.id+'\')},150)">Open Source Event →</button>' : '') +
    (t ? '<button class="kg-open-btn" style="margin-top:5px" onclick="closeKnowledgeGraph();setTimeout(function(){openEP(\''+t.id+'\')},150)">Open Target Event →</button>' : '');

  panel.classList.add('visible');
}

function kgHidePanel() {
  var panel = document.getElementById('kg-panel');
  if (panel) panel.classList.remove('visible');
}

// ── Close ─────────────────────────────────────────────────────

function closeKnowledgeGraph() {
  var overlay = document.getElementById('kg-overlay');
  if (overlay) overlay.classList.remove('on');
  if (KG.animFrame) { cancelAnimationFrame(KG.animFrame); KG.animFrame = null; }
  KG.sim.running = false;
  KG.hovered = KG.hoveredEdge = KG.selected = null;
  var tip = document.getElementById('kg-edge-tip');
  if (tip) tip.style.display = 'none';
  kgHidePanel();
  // Reset toolbar
  document.querySelectorAll('.mtool-btn[id^="mtool-"]').forEach(function(b) {
    b.classList.toggle('on', b.id === 'mtool-map');
  });
  G_MAP_MODE = 'events';
}


// ════════════════════════════════════════════════════════

/* ═══════════ 15_knowledge_explorer.js ═══════════ */
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

/* ═══════════ 12_graph.js ═══════════ */
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

  var showSim      = NG.showSimilarity !== false;
  var showCooc     = NG.showCooc       !== false;
  var showNews     = NG.showNews       !== false;
  var showEnt      = NG.showEntities   !== false;
  var showCausal   = NG.showCausal     !== false;
  var showTemporal = NG.showTemporal   !== false;

  // ── Edges ──────────────────────────────────────────────
  var showMentions_ = NG.showMentions !== false;
  ctx.lineWidth = 1;
  NG.edges.forEach(function(e) {
    if (e.type === 'mentions'     && !showMentions_) return;
    if (e.type === 'similarity'   && !showSim)       return;
    if (e.type === 'co_occurrence'&& !showCooc)      return;
    if (e.type === 'causal'       && !showCausal)    return;
    if (e.type === 'temporal'     && !showTemporal)  return;
    var s = NG.nodeMap[e.src], t = NG.nodeMap[e.tgt];
    if (!s||!t) return;
    if (!_nodeVisible(s)||!_nodeVisible(t)) return;
    // Draw only one direction for symmetric edges
    if ((e.type === 'similarity' || e.type === 'co_occurrence') && e.src > e.tgt) return;

    var col = NG_EDGE_COLORS[e.type] || 'rgba(148,163,184,0.2)';
    ctx.strokeStyle = col;
    ctx.lineWidth   = e.type==='mentions' ? 0.8 : e.type==='temporal' ? 0.9 : 1.2;
    if (e.type === 'co_occurrence') { ctx.setLineDash([4,3]); }
    else if (e.type === 'similarity') { ctx.setLineDash([2,2]); }
    else if (e.type === 'temporal')   { ctx.setLineDash([3,4]); }
    else { ctx.setLineDash([]); }

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    // Causal edges get an arrow mid-point indicator
    if (e.type === 'causal') {
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Draw arrowhead at midpoint
      var mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      var ang = Math.atan2(t.y - s.y, t.x - s.x);
      var aLen = 5;
      ctx.beginPath();
      ctx.moveTo(mx + Math.cos(ang)*aLen, my + Math.sin(ang)*aLen);
      ctx.lineTo(mx + Math.cos(ang+2.4)*aLen*0.7, my + Math.sin(ang+2.4)*aLen*0.7);
      ctx.lineTo(mx + Math.cos(ang-2.4)*aLen*0.7, my + Math.sin(ang-2.4)*aLen*0.7);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    } else {
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
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

  var newsCount   = nodes.filter(function(n){return n.type==='news';}).length;
  var entCount    = nodes.length - newsCount;
  var simEdges    = edges.filter(function(e){return e.type==='similarity';}).length/2 | 0;
  var causalEdges = edges.filter(function(e){return e.type==='causal';}).length;
  var tempEdges   = edges.filter(function(e){return e.type==='temporal';}).length;

  // Info bar
  var barNodes = document.getElementById('ng-bar-nodes');
  var barEdges = document.getElementById('ng-bar-edges');
  var barComm  = document.getElementById('ng-bar-communities');
  var barTime  = document.getElementById('ng-bar-time');
  if (barNodes) barNodes.textContent = nodes.length + ' nodes';
  if (barEdges) barEdges.textContent = edges.length + ' edges';
  if (barComm)  barComm.textContent  = nComm + ' communities';
  if (barTime)  barTime.textContent  = '⚡' + causalEdges + '  ⏱' + tempEdges;

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
      + '<div class="ng-stat-row"><span>⚡ Causal edges</span><span>' + causalEdges + '</span></div>'
      + '<div class="ng-stat-row"><span>⏱ Temporal edges</span><span>' + tempEdges + '</span></div>'
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

/* ═══════════ 14_graph3d.js ═══════════ */
/**
 * @file 14_graph3d.js
 * @module WorldLens / Knowledge Graph — 3D WebGL Renderer
 *
 * Reads NG.nodes / NG.edges from 12_graph.js — same data, different renderer.
 *
 * Problems fixed vs v1:
 *  - No fog (was killing visibility beyond radius=700)
 *  - Compact layout: XY from 2D force positions (scaled), Z = community plane
 *  - Camera starts close enough to see the graph (radius ≈ bounding sphere * 1.6)
 *  - Pan with right-click drag or middle-mouse (navigate to any cluster)
 *  - WASD / arrow keys for fly-through navigation
 *  - Minimap overlay: 2D top-down thumbnail of all nodes
 *  - "Jump to community" buttons in 3D controls
 *  - Zoom clamp based on actual graph size, not hardcoded numbers
 *  - Auto-orbit pauses on any interaction, resumes after 4s idle
 *
 * Navigation:
 *  Left-drag   → orbit
 *  Right-drag  → pan camera target
 *  Scroll      → zoom (dolly)
 *  W/S arrows  → dolly in/out
 *  A/D arrows  → strafe left/right
 *  Q/E         → move up/down
 *  Double-click node → fly to it
 *  Click node  → open detail panel
 *
 * @depends 12_graph.js (NG), three.js r128 (no OrbitControls — not in CDN r128)
 */

// ════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════
var NG3D = {
  active:   false,
  renderer: null,
  scene:    null,
  camera:   null,
  meshes:   {},      // nodeId → THREE.Mesh (the sphere)
  labels:   {},      // nodeId → THREE.Sprite
  edges: {
    mentions:      null,
    co_occurrence: null,
    similarity:    null,
  },
  _meshList:   [],   // flat array for raycaster
  animFrame:   null,
  built:       false,
  raycaster:   null,
  mouse:       { x:0, y:0 },
  hovered3D:   null,
  selected3D:  null,

  // Camera orbit + pan state
  cam: {
    // Spherical coords for orbit
    theta:  0.4,    // horizontal angle
    phi:    1.05,   // vertical angle (from +Y axis)
    radius: 500,    // distance from target
    // Pan: camera target (look-at point), can be moved
    target: { x:0, y:0, z:0 },
    // Drag
    leftDrag:  false,
    rightDrag: false,
    lastX: 0, lastY: 0,
    // Keys held
    keys: {},
    // Auto-orbit
    autoRotate: true,
    autoSpeed:  0.0025,
    _autoTimer: null,
  },

  // Layout cache
  pos3D:     {},    // nodeId → {x,y,z}
  graphBounds: null, // {minX,maxX,minY,maxY,minZ,maxZ,cx,cy,cz,diagonal}
};

// ── Visual config ────────────────────────────────────────
var _NG3_EMISSIVE = {
  news:      0x0d2244,
  company:   0x082a18,
  person:    0x382a00,
  location:  0x1c1040,
  ticker:    0x361800,
  commodity: 0x380820,
};

var _NG3_Z_SPACING    = 160;   // units between community planes
var _NG3_XY_SCALE     = 0.55;  // scale 2D layout coords → 3D world units
var _NG3_LABEL_THRESH = 0.15;  // show labels for nodes above this degree centrality

// ════════════════════════════════════════════════════════
// LAYOUT: community planes + 2D positions on XY
// ════════════════════════════════════════════════════════
function _ng3dLayout() {
  var nodes = NG.nodes.filter(function(n){ return _nodeVisible(n); });
  if (!nodes.length) return;

  // Group by community
  var groups = {};
  nodes.forEach(function(n){
    var c = n.community || 0;
    if (!groups[c]) groups[c] = [];
    groups[c].push(n);
  });

  // Sort communities by size desc → largest at Z=0
  var commIds = Object.keys(groups).map(Number)
    .sort(function(a,b){ return groups[b].length - groups[a].length; });

  // Compute Z for each community (alternating above/below)
  var zForComm = {};
  commIds.forEach(function(c, i){
    var sign  = (i % 2 === 0) ? 1 : -1;
    var level = Math.floor(i / 2);
    zForComm[c] = sign * level * _NG3_Z_SPACING;
  });

  // Find 2D bounding box of force layout to normalise positions
  var xs = nodes.map(function(n){ return n.x; });
  var ys = nodes.map(function(n){ return n.y; });
  var minX = Math.min.apply(null,xs), maxX = Math.max.apply(null,xs);
  var minY = Math.min.apply(null,ys), maxY = Math.max.apply(null,ys);
  var cx2d = (minX+maxX)/2,  cy2d = (minY+maxY)/2;
  var span = Math.max(maxX-minX, maxY-minY, 1);
  // Normalise: map 2D [minX..maxX] → [-200..+200] world units
  var xyNorm = 400 / span;

  nodes.forEach(function(n){
    var z = zForComm[n.community || 0] || 0;
    // Use actual 2D force-layout position (centred and scaled)
    var wx =  (n.x - cx2d) * xyNorm * _NG3_XY_SCALE;
    var wy = -(n.y - cy2d) * xyNorm * _NG3_XY_SCALE;  // flip Y
    NG3D.pos3D[n.id] = { x:wx, y:wy, z:z };
  });

  // Compute graph bounding sphere for smart camera init
  var allX = nodes.map(function(n){ return NG3D.pos3D[n.id].x; });
  var allY = nodes.map(function(n){ return NG3D.pos3D[n.id].y; });
  var allZ = nodes.map(function(n){ return NG3D.pos3D[n.id].z; });
  var bminX=Math.min.apply(null,allX), bmaxX=Math.max.apply(null,allX);
  var bminY=Math.min.apply(null,allY), bmaxY=Math.max.apply(null,allY);
  var bminZ=Math.min.apply(null,allZ), bmaxZ=Math.max.apply(null,allZ);
  var diagX = bmaxX-bminX, diagY = bmaxY-bminY, diagZ = bmaxZ-bminZ;
  var diag  = Math.sqrt(diagX*diagX + diagY*diagY + diagZ*diagZ);
  NG3D.graphBounds = {
    minX:bminX, maxX:bmaxX,
    minY:bminY, maxY:bmaxY,
    minZ:bminZ, maxZ:bmaxZ,
    cx:(bminX+bmaxX)/2, cy:(bminY+bmaxY)/2, cz:(bminZ+bmaxZ)/2,
    diagonal: diag,
  };
}

// ════════════════════════════════════════════════════════
// SCENE CONSTRUCTION
// ════════════════════════════════════════════════════════
function _ng3dBuildScene(container) {
  var W = container.offsetWidth  || 900;
  var H = container.offsetHeight || 600;

  // Renderer — NO alpha so clear color shows (alpha:true + clearColor(0,0) = transparent bg = invisible)
  NG3D.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
  NG3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  NG3D.renderer.setSize(W, H);
  NG3D.renderer.setClearColor(0x060b18, 1);
  container.appendChild(NG3D.renderer.domElement);

  NG3D.scene = new THREE.Scene();
  // NO FOG — was the main cause of graph disappearing on zoom out

  // Camera
  NG3D.camera = new THREE.PerspectiveCamera(50, W/H, 1, 12000);
  NG3D.raycaster = new THREE.Raycaster();

  // Lights
  NG3D.scene.add(new THREE.AmbientLight(0x334466, 1.4));
  var dl = new THREE.DirectionalLight(0x88aadd, 1.0);
  dl.position.set(300, 500, 400);
  NG3D.scene.add(dl);
  // Subtle fill from below
  var dl2 = new THREE.DirectionalLight(0x221133, 0.4);
  dl2.position.set(-200, -300, -200);
  NG3D.scene.add(dl2);

  // Compute layout
  _ng3dLayout();

  // Smart camera start: positioned to see the whole graph
  if (NG3D.graphBounds) {
    var b = NG3D.graphBounds;
    var startR = Math.max(200, b.diagonal * 1.4);
    NG3D.cam.radius = startR;
    NG3D.cam.target = { x: b.cx, y: b.cy, z: b.cz };
  }

  // Starfield (fixed in world space, not affected by camera zoom)
  _ng3dAddStarfield();

  // Community plane discs
  _ng3dAddCommunityPlanes();

  // Nodes
  _ng3dBuildNodes();

  // Edges
  _ng3dBuildEdges();

  // Labels
  _ng3dBuildLabels();

  // Apply initial camera
  _ng3dUpdateCamera();
}

function _ng3dAddStarfield() {
  var verts = [];
  for (var i=0; i<1500; i++) {
    verts.push(
      (Math.random()-0.5)*5000,
      (Math.random()-0.5)*5000,
      (Math.random()-0.5)*5000
    );
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
  NG3D.scene.add(new THREE.Points(geo,
    new THREE.PointsMaterial({color:0xffffff,size:1.5,transparent:true,opacity:0.35})));
}

function _ng3dAddCommunityPlanes() {
  var seen = {};
  NG.nodes.forEach(function(n){
    if (!_nodeVisible(n)) return;
    var c = n.community||0;
    if (seen[c]) return;
    seen[c] = true;
    var pos = NG3D.pos3D[n.id];
    if (!pos) return;
    var col = parseInt(NG_COMM_PALETTE[c % NG_COMM_PALETTE.length].replace('#',''),16);
    var geo = new THREE.CircleGeometry(240, 64);
    var mat = new THREE.MeshBasicMaterial({
      color:col, transparent:true, opacity:0.04, side:THREE.DoubleSide, depthWrite:false,
    });
    var disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = Math.PI/2;
    disc.position.set(NG3D.graphBounds ? NG3D.graphBounds.cx : 0, pos.z*0.08, pos.z);
    disc.position.y = pos.z * 0.06;
    disc.position.z = pos.z;
    disc.position.x = 0;
    disc.rotation.x = 0;
    disc.rotation.y = 0;
    NG3D.scene.add(disc);
  });
}

function _ng3dBuildNodes() {
  NG3D.meshes = {};
  NG3D._meshList = [];

  NG.nodes.forEach(function(n){
    if (!_nodeVisible(n)) return;
    var pos  = NG3D.pos3D[n.id];
    if (!pos) return;

    var col    = NG_NODE_COLORS[n.type] || '#94A3B8';
    var emCol  = _NG3_EMISSIVE[n.type]  || 0x111111;
    var commStr= NG_COMM_PALETTE[(n.community||0) % NG_COMM_PALETTE.length];
    var commCol= parseInt(commStr.replace('#',''), 16);

    // Radius: meaningful size difference between news (larger) and entities
    var r = n.type==='news'
      ? Math.max(5, Math.min(18, 4 + (n.severity||5)*0.9 + (n.degree_centrality||0)*8))
      : Math.max(3.5, Math.min(12, 3.5 + (n.degree_centrality||0)*10));

    var geo = new THREE.SphereGeometry(r, n.type==='news'?16:10, n.type==='news'?12:8);
    var mat = new THREE.MeshPhongMaterial({
      color:     new THREE.Color(col),
      emissive:  new THREE.Color(emCol),
      emissiveIntensity: n.type==='news' ? Math.min(0.7,(n.severity||5)/10)*0.8 : 0.2,
      shininess: 70, transparent:true, opacity:0.94,
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.userData = { nodeId:n.id, node:n, baseR:r };

    // Community ring torus
    var tGeo = new THREE.TorusGeometry(r+2, 0.7, 6, 24);
    var tMat = new THREE.MeshBasicMaterial({
      color:new THREE.Color(commStr), transparent:true, opacity:0.6, depthWrite:false,
    });
    var torus = new THREE.Mesh(tGeo, tMat);
    torus.rotation.x = Math.PI/2;
    mesh.add(torus);

    NG3D.scene.add(mesh);
    NG3D.meshes[n.id] = mesh;
    NG3D._meshList.push(mesh);
  });
}

function _ng3dBuildEdges() {
  // Dispose old
  ['mentions','co_occurrence','similarity'].forEach(function(t){
    if (NG3D.edges[t]) {
      NG3D.scene.remove(NG3D.edges[t]);
      NG3D.edges[t].geometry.dispose();
      NG3D.edges[t].material.dispose();
      NG3D.edges[t] = null;
    }
  });

  var pts = { mentions:[], co_occurrence:[], similarity:[] };
  NG.edges.forEach(function(e){
    var t = e.type||'mentions';
    if (!pts[t]) return;
    if ((t==='similarity'||t==='co_occurrence') && e.src>e.tgt) return;
    var s = NG3D.pos3D[e.src], d = NG3D.pos3D[e.tgt];
    if (!s||!d) return;
    pts[t].push(s.x,s.y,s.z, d.x,d.y,d.z);
  });

  var cfg = {
    mentions:      { col:'#94A3B8', op:0.15 },
    co_occurrence: { col:'#60A5FA', op:0.28 },
    similarity:    { col:'#F59E0B', op:0.32 },
  };
  Object.keys(pts).forEach(function(t){
    if (!pts[t].length) return;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts[t],3));
    var mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(cfg[t].col),
      transparent:true, opacity:cfg[t].op, depthWrite:false,
    });
    var ls = new THREE.LineSegments(geo, mat);
    NG3D.edges[t] = ls;
    NG3D.scene.add(ls);
  });
}

function _ng3dBuildLabels() {
  // Dispose old
  NG3D.labels && Object.values(NG3D.labels).forEach(function(s){
    NG3D.scene.remove(s);
    if (s.material.map) s.material.map.dispose();
    s.material.dispose();
  });
  NG3D.labels = {};

  var shown = NG.nodes.filter(function(n){
    if (!_nodeVisible(n)||!NG3D.pos3D[n.id]) return false;
    return (n.degree_centrality||0)>=_NG3_LABEL_THRESH
        || (n.type==='news'&&(n.severity||0)>=7);
  }).slice(0,60);

  shown.forEach(function(n){
    var pos   = NG3D.pos3D[n.id];
    var mesh  = NG3D.meshes[n.id];
    if (!pos||!mesh) return;
    var r     = mesh.userData.baseR||6;
    var col   = NG_NODE_COLORS[n.type]||'#94A3B8';
    var label = (n.label||'').slice(0, n.type==='news'?32:20);
    var bold  = (n.degree_centrality||0)>0.3 || (n.type==='news'&&(n.severity||0)>=7);

    var sprite = _ng3dMakeSprite(label, col, bold);
    sprite.position.set(pos.x, pos.y+r+9, pos.z);
    sprite.userData = { nodeId:n.id };
    NG3D.scene.add(sprite);
    NG3D.labels[n.id] = sprite;
  });
}

function _ng3dMakeSprite(text, color, bold) {
  var c = document.createElement('canvas');
  c.width=256; c.height=40;
  var ctx=c.getContext('2d');
  ctx.clearRect(0,0,256,40);
  ctx.fillStyle='rgba(6,11,24,0.78)';
  ctx.beginPath();
  // manual roundRect for compat
  var x=2,y=5,w=252,h=30,r=7;
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
  ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
  ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
  ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
  ctx.fill();
  ctx.font=(bold?'bold ':'')+Math.min(13,Math.max(9,Math.round(260/Math.max(text.length,8))))+'px sans-serif';
  ctx.fillStyle=color; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text,128,22);
  var tex=new THREE.CanvasTexture(c);
  var mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,depthTest:false});
  var sp=new THREE.Sprite(mat);
  sp.scale.set(82,15,1);
  return sp;
}

// ════════════════════════════════════════════════════════
// CAMERA — spherical orbit with movable target
// ════════════════════════════════════════════════════════
function _ng3dUpdateCamera() {
  var o   = NG3D.cam;
  var phi = Math.max(0.08, Math.min(Math.PI-0.08, o.phi));
  var r   = Math.max(30, o.radius);
  var cx  = o.target.x + r * Math.sin(phi) * Math.sin(o.theta);
  var cy  = o.target.y + r * Math.cos(phi);
  var cz  = o.target.z + r * Math.sin(phi) * Math.cos(o.theta);
  NG3D.camera.position.set(cx, cy, cz);
  NG3D.camera.lookAt(o.target.x, o.target.y, o.target.z);
}

// ════════════════════════════════════════════════════════
// INPUT EVENTS
// ════════════════════════════════════════════════════════
function _ng3dSetupEvents(container) {
  var o = NG3D.cam;

  function stopAutoRotate() {
    o.autoRotate = false;
    clearTimeout(o._autoTimer);
    o._autoTimer = setTimeout(function(){ o.autoRotate = true; }, 4000);
  }

  // ── Left drag = orbit, Right drag = pan ───────────────
  container.addEventListener('mousedown', function(e) {
    stopAutoRotate();
    if (e.button===0) { o.leftDrag=true; container.style.cursor='grabbing'; }
    if (e.button===2) { o.rightDrag=true; container.style.cursor='move'; }
    o.lastX=e.clientX; o.lastY=e.clientY;
    e.preventDefault();
  });
  container.addEventListener('contextmenu', function(e){ e.preventDefault(); });

  window.addEventListener('mouseup', function(e) {
    if (e.button===0) o.leftDrag=false;
    if (e.button===2) o.rightDrag=false;
    if (!o.leftDrag&&!o.rightDrag) container.style.cursor='grab';
  });

  window.addEventListener('mousemove', function(e) {
    if (!NG3D.active) return;
    var dx = e.clientX - o.lastX;
    var dy = e.clientY - o.lastY;
    o.lastX=e.clientX; o.lastY=e.clientY;

    if (o.leftDrag) {
      // Orbit
      o.theta -= dx * 0.007;
      o.phi   -= dy * 0.007;
    } else if (o.rightDrag) {
      // Pan the target point in camera-local XY
      var panSpeed = o.radius * 0.0013;
      var right = new THREE.Vector3();
      var up    = new THREE.Vector3();
      NG3D.camera.getWorldDirection(right);
      right.cross(new THREE.Vector3(0,1,0)).normalize();
      up.set(0,1,0);
      o.target.x -= right.x * dx * panSpeed;
      o.target.z -= right.z * dx * panSpeed;
      o.target.y += dy * panSpeed;
    }

    // Raycaster mouse for hover
    if (!o.leftDrag && !o.rightDrag) {
      var rect = container.getBoundingClientRect();
      NG3D.mouse.x =  ((e.clientX-rect.left)/rect.width)*2-1;
      NG3D.mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
      _ng3dCheckHover();
    }
  });

  // ── Scroll = zoom ──────────────────────────────────────
  container.addEventListener('wheel', function(e) {
    e.preventDefault();
    stopAutoRotate();
    var factor = e.deltaY > 0 ? 1.08 : 0.93;
    var minR   = 25;
    var maxR   = NG3D.graphBounds ? NG3D.graphBounds.diagonal * 4 : 3000;
    o.radius = Math.max(minR, Math.min(maxR, o.radius * factor));
  }, {passive:false});

  // ── Double-click = fly to node ─────────────────────────
  container.addEventListener('dblclick', function(e) {
    var rect = container.getBoundingClientRect();
    NG3D.mouse.x =  ((e.clientX-rect.left)/rect.width)*2-1;
    NG3D.mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
    NG3D.raycaster.setFromCamera(NG3D.mouse, NG3D.camera);
    var hits = NG3D.raycaster.intersectObjects(NG3D._meshList, false);
    if (hits.length) {
      var nid = hits[0].object.userData.nodeId;
      if (nid) _ng3dFlyToNode(nid);
    }
  });

  // ── Single click = detail panel ───────────────────────
  container.addEventListener('click', function(e) {
    if (Math.abs(e.clientX-o.lastX)>3||Math.abs(e.clientY-o.lastY)>3) return;
    var rect = container.getBoundingClientRect();
    NG3D.mouse.x =  ((e.clientX-rect.left)/rect.width)*2-1;
    NG3D.mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
    NG3D.raycaster.setFromCamera(NG3D.mouse, NG3D.camera);
    var hits = NG3D.raycaster.intersectObjects(NG3D._meshList,false);
    if (hits.length) {
      var node = hits[0].object.userData.node;
      if (node) { NG3D.selected3D=node.id; ngShowDetail(node); }
    } else {
      ngCloseDetail();
    }
  });

  // ── WASD / Arrow keys ──────────────────────────────────
  window.addEventListener('keydown', function(e) {
    if (!NG3D.active) return;
    o.keys[e.key] = true;
    stopAutoRotate();
  });
  window.addEventListener('keyup', function(e) { delete o.keys[e.key]; });

  // ── Touch ──────────────────────────────────────────────
  var _t1=null, _t2=null, _pinchDist0=0;
  container.addEventListener('touchstart', function(e) {
    stopAutoRotate();
    if (e.touches.length===1) {
      o.leftDrag=true;
      _t1={x:e.touches[0].clientX, y:e.touches[0].clientY};
    } else if (e.touches.length===2) {
      o.leftDrag=false;
      var dx=e.touches[0].clientX-e.touches[1].clientX;
      var dy=e.touches[0].clientY-e.touches[1].clientY;
      _pinchDist0=Math.sqrt(dx*dx+dy*dy);
    }
  },{passive:true});
  container.addEventListener('touchmove', function(e) {
    if (e.touches.length===1 && _t1) {
      o.theta -= (e.touches[0].clientX-_t1.x)*0.007;
      o.phi   -= (e.touches[0].clientY-_t1.y)*0.007;
      _t1={x:e.touches[0].clientX,y:e.touches[0].clientY};
    } else if (e.touches.length===2) {
      var dx=e.touches[0].clientX-e.touches[1].clientX;
      var dy=e.touches[0].clientY-e.touches[1].clientY;
      var dist=Math.sqrt(dx*dx+dy*dy);
      if (_pinchDist0>0) {
        var factor=_pinchDist0/dist;
        var maxR=NG3D.graphBounds?NG3D.graphBounds.diagonal*4:3000;
        o.radius=Math.max(25,Math.min(maxR,o.radius*factor));
      }
      _pinchDist0=dist;
    }
  },{passive:true});
  container.addEventListener('touchend', function(){ o.leftDrag=false; _t1=null; },{passive:true});

  // ── Resize ─────────────────────────────────────────────
  if (window.ResizeObserver) {
    new ResizeObserver(function(){
      if (!NG3D.active||!NG3D.renderer) return;
      var W=container.offsetWidth, H=container.offsetHeight;
      if (!W||!H) return;
      NG3D.renderer.setSize(W,H);
      NG3D.camera.aspect=W/H;
      NG3D.camera.updateProjectionMatrix();
    }).observe(container);
  }
}

// WASD / Arrow key movement (called in animation loop)
function _ng3dApplyKeys() {
  var o = NG3D.cam;
  if (!Object.keys(o.keys).length) return;
  var speed = o.radius * 0.012;

  // Camera forward vector (horizontal only)
  var fwd = new THREE.Vector3(
    Math.sin(o.phi)*Math.sin(o.theta),
    0,
    Math.sin(o.phi)*Math.cos(o.theta)
  ).normalize();
  var right = new THREE.Vector3(
    Math.cos(o.theta), 0, -Math.sin(o.theta)
  ).normalize();

  if (o.keys['w']||o.keys['W']||o.keys['ArrowUp']) {
    o.radius = Math.max(25, o.radius - speed);
  }
  if (o.keys['s']||o.keys['S']||o.keys['ArrowDown']) {
    var maxR = NG3D.graphBounds ? NG3D.graphBounds.diagonal*4 : 3000;
    o.radius = Math.min(maxR, o.radius + speed);
  }
  if (o.keys['a']||o.keys['A']||o.keys['ArrowLeft']) {
    o.target.x -= right.x*speed*0.5;
    o.target.z -= right.z*speed*0.5;
  }
  if (o.keys['d']||o.keys['D']||o.keys['ArrowRight']) {
    o.target.x += right.x*speed*0.5;
    o.target.z += right.z*speed*0.5;
  }
  if (o.keys['q']||o.keys['Q']) o.target.y += speed*0.4;
  if (o.keys['e']||o.keys['E']) o.target.y -= speed*0.4;
}

// ════════════════════════════════════════════════════════
// FLY TO NODE
// ════════════════════════════════════════════════════════
function _ng3dFlyToNode(nodeId) {
  var pos = NG3D.pos3D[nodeId];
  var n   = NG.nodeMap[nodeId];
  if (!pos||!n) return;

  var o    = NG3D.cam;
  var tx0  = o.target.x, ty0 = o.target.y, tz0 = o.target.z;
  var r0   = o.radius;
  var th0  = o.theta,    ph0 = o.phi;

  var targetR  = Math.max(40, (n.size||10)*4);
  var steps=40, step=0;

  function fly(){
    if (!NG3D.active||step>=steps) {
      if (n) ngShowDetail(n);
      return;
    }
    step++;
    var t    = step/steps;
    var ease = 1-Math.pow(1-t,3);
    o.target.x = tx0+(pos.x-tx0)*ease;
    o.target.y = ty0+(pos.y-ty0)*ease;
    o.target.z = tz0+(pos.z-tz0)*ease;
    o.radius   = r0+(targetR-r0)*ease;
    _ng3dUpdateCamera();
    requestAnimationFrame(fly);
  }
  fly();

  // Highlight destination node
  var mesh = NG3D.meshes[nodeId];
  if (mesh) mesh.material.emissiveIntensity = 0.9;
}

// ════════════════════════════════════════════════════════
// HOVER
// ════════════════════════════════════════════════════════
function _ng3dCheckHover() {
  if (!NG3D.active||!NG3D._meshList.length) return;
  NG3D.raycaster.setFromCamera(NG3D.mouse, NG3D.camera);
  var hits = NG3D.raycaster.intersectObjects(NG3D._meshList,false);

  // Restore previously hovered
  if (NG3D.hovered3D && NG3D.hovered3D !== NG3D.selected3D) {
    var pm=NG3D.meshes[NG3D.hovered3D];
    if (pm) {
      var pn=pm.userData.node;
      pm.material.emissiveIntensity = pn&&pn.type==='news'?Math.min(0.6,(pn.severity||5)/10)*0.8:0.2;
      pm.scale.set(1,1,1);
    }
    _ng3dHideTooltip();
    NG3D.hovered3D=null;
  }

  if (!hits.length) {
    document.getElementById('ng-3d-wrap') && (document.getElementById('ng-3d-wrap').style.cursor='grab');
    return;
  }

  var m   = hits[0].object;
  var nid = m.userData.nodeId;
  if (!nid) return;
  m.material.emissiveIntensity = 0.75;
  m.scale.set(1.3, 1.3, 1.3);
  NG3D.hovered3D = nid;
  document.getElementById('ng-3d-wrap') && (document.getElementById('ng-3d-wrap').style.cursor='pointer');
  _ng3dShowTooltip(m.userData.node, hits[0]);
}

// ════════════════════════════════════════════════════════
// TOOLTIP
// ════════════════════════════════════════════════════════
function _ng3dShowTooltip(node, hit) {
  if (!node) return;
  var tip = document.getElementById('ng-3d-tooltip');
  if (!tip) {
    tip=document.createElement('div');
    tip.id='ng-3d-tooltip';
    tip.style.cssText='position:absolute;z-index:20;pointer-events:none;'
      +'background:rgba(6,11,24,.92);border:1px solid rgba(255,255,255,.15);'
      +'border-radius:8px;padding:9px 13px;max-width:230px;font-size:10px;'
      +'color:#E2E8F0;line-height:1.6;box-shadow:0 4px 20px rgba(0,0,0,.6);';
    var wrap=document.getElementById('ng-canvas-wrap');
    if (wrap) wrap.style.position='relative', wrap.appendChild(tip);
    else document.body.appendChild(tip);
  }
  var col=NG_NODE_COLORS[node.type]||'#94A3B8';
  var commCol=NG_COMM_PALETTE[(node.community||0)%NG_COMM_PALETTE.length];
  tip.innerHTML=
    '<div style="font-size:9px;font-weight:800;text-transform:uppercase;color:'+col+';margin-bottom:3px">'
    +node.type+' · comm <span style="color:'+commCol+'">#'+node.community+'</span></div>'
    +'<div style="font-weight:700;color:#F0F6FF;font-size:11px;margin-bottom:3px">'+(node.label||'').slice(0,44)+'</div>'
    +(node.type==='news'
      ?'<div style="color:#94A3B8">⚡ '+((node.severity||0).toFixed(1))+' · '+(node.category||'')+(node.country?' · 🌍'+node.country:'')+'</div>'
      :'<div style="color:#94A3B8">×'+(node.mention_count||1)+' mentions · deg '+(node.degree||0)+'</div>')
    +'<div style="color:#475569;font-size:9px;margin-top:4px">Double-click to fly · Click to inspect</div>';

  // Project world point to canvas coords
  var vector = hit.point.clone().project(NG3D.camera);
  var wrap   = document.getElementById('ng-canvas-wrap');
  var W      = wrap ? wrap.offsetWidth  : 800;
  var H      = wrap ? wrap.offsetHeight : 600;
  var sx     = (vector.x+1)/2*W;
  var sy     = (-vector.y+1)/2*H;
  tip.style.left=Math.min(sx+16,W-240)+'px';
  tip.style.top =Math.max(sy-50,8)+'px';
  tip.style.display='block';
}
function _ng3dHideTooltip(){
  var t=document.getElementById('ng-3d-tooltip');
  if(t) t.style.display='none';
}

// ════════════════════════════════════════════════════════
// ANIMATION LOOP
// ════════════════════════════════════════════════════════
function _ng3dAnimate() {
  if (!NG3D.active) return;
  NG3D.animFrame=requestAnimationFrame(_ng3dAnimate);

  // Auto-orbit
  if (NG3D.cam.autoRotate && !NG3D.cam.leftDrag && !NG3D.cam.rightDrag) {
    NG3D.cam.theta += NG3D.cam.autoSpeed;
  }

  // WASD movement
  _ng3dApplyKeys();

  _ng3dUpdateCamera();

  // Label scale / visibility — scale so they have constant screen size
  var camPos = NG3D.camera.position;
  Object.keys(NG3D.labels).forEach(function(id){
    var sp=NG3D.labels[id];
    if (!sp) return;
    var dist=camPos.distanceTo(sp.position);
    // Visible if within 1.5× graph diagonal, scale proportional to dist
    var maxDist = NG3D.graphBounds ? NG3D.graphBounds.diagonal*1.8 : 800;
    sp.visible = dist < maxDist;
    if (sp.visible) {
      var s=dist*0.18;
      sp.scale.set(s, s*0.19, 1);
    }
  });

  // Hover pulse
  if (NG3D.hovered3D) {
    var pm=NG3D.meshes[NG3D.hovered3D];
    if (pm) pm.material.emissiveIntensity=0.5+0.3*Math.sin(Date.now()*0.005);
  }

  NG3D.renderer.render(NG3D.scene, NG3D.camera);
}

// ════════════════════════════════════════════════════════
// 3D CONTROLS UI
// ════════════════════════════════════════════════════════
function _ng3dBuildControls(container) {
  var old=document.getElementById('ng-3d-controls');
  if (old) old.remove();

  var el=document.createElement('div');
  el.id='ng-3d-controls';
  el.style.cssText='position:absolute;bottom:14px;right:12px;z-index:10;'
    +'display:flex;flex-direction:column;gap:3px;';

  // Community jump buttons
  var groups={};
  NG.nodes.forEach(function(n){ var c=n.community||0; if(!groups[c])groups[c]=[]; groups[c].push(n); });
  var commList=Object.keys(groups).map(Number)
    .sort(function(a,b){return groups[b].length-groups[a].length;})
    .slice(0,6);

  var commBtns='';
  commList.forEach(function(c){
    var col=NG_COMM_PALETTE[c%NG_COMM_PALETTE.length];
    var topNode=groups[c].sort(function(a,b){return(b.degree||0)-(a.degree||0);})[0];
    var lbl=(topNode&&topNode.label||'Comm '+c).slice(0,14);
    commBtns+='<button class="ng-zoom-btn" style="border-left:3px solid '+col+'" '
      +'onclick="ng3dJumpToComm('+c+')">⬤ '+lbl+'</button>';
  });

  el.innerHTML=
    '<div style="font-size:8px;color:#475569;text-align:right;margin-bottom:2px;font-weight:700;letter-spacing:.08em">COMMUNITIES</div>'
    +commBtns
    +'<div style="margin-top:4px;font-size:8px;color:#475569;text-align:right;margin-bottom:2px;font-weight:700;letter-spacing:.08em">CAMERA</div>'
    +'<button class="ng-zoom-btn" onclick="ng3dOrbitToggle()" id="ng3d-orbit-btn">🌐 Auto-orbit</button>'
    +'<button class="ng-zoom-btn" onclick="ng3dResetCamera()">↺ Reset view</button>'
    +'<button class="ng-zoom-btn" onclick="ng3dTopView()">⬆ Top-down</button>'
    +'<button class="ng-zoom-btn" onclick="ng3dFrontView()">◉ Front view</button>'
    +'<div style="margin-top:4px;font-size:7px;color:#334;text-align:right;line-height:1.6">'
    +'Left-drag: orbit<br>Right-drag: pan<br>Scroll: zoom<br>W/S A/D: move<br>Dbl-click: fly to</div>';

  container.appendChild(el);
}

// ════════════════════════════════════════════════════════
// PUBLIC CAMERA CONTROLS
// ════════════════════════════════════════════════════════
function ng3dJumpToComm(commId) {
  var group = NG.nodes.filter(function(n){ return (n.community||0)===commId && NG3D.pos3D[n.id]; });
  if (!group.length) return;

  // Compute centroid of the community
  var sumX=0,sumY=0,sumZ=0;
  group.forEach(function(n){
    var p=NG3D.pos3D[n.id];
    sumX+=p.x; sumY+=p.y; sumZ+=p.z;
  });
  var n=group.length;
  var cx=sumX/n, cy=sumY/n, cz=sumZ/n;

  var o=NG3D.cam;
  var tx0=o.target.x,ty0=o.target.y,tz0=o.target.z,r0=o.radius;
  var targetR=Math.max(80,Math.min(250,(NG3D.graphBounds?NG3D.graphBounds.diagonal:200)*0.45));
  var steps=45,step=0;
  o.autoRotate=false;
  clearTimeout(o._autoTimer);

  function jump(){
    if(!NG3D.active||step>=steps){
      o._autoTimer=setTimeout(function(){o.autoRotate=true;},5000);
      return;
    }
    step++;
    var t=step/steps;
    var ease=1-Math.pow(1-t,3);
    o.target.x=tx0+(cx-tx0)*ease;
    o.target.y=ty0+(cy-ty0)*ease;
    o.target.z=tz0+(cz-tz0)*ease;
    o.radius=r0+(targetR-r0)*ease;
    requestAnimationFrame(jump);
  }
  jump();
  toast('Flying to community '+commId, 's');
}

function ng3dOrbitToggle() {
  NG3D.cam.autoRotate=!NG3D.cam.autoRotate;
  var btn=document.getElementById('ng3d-orbit-btn');
  if(btn) btn.style.opacity=NG3D.cam.autoRotate?'1':'0.45';
  toast(NG3D.cam.autoRotate?'Auto-orbit on':'Orbit paused','s');
}
function ng3dResetCamera() {
  var b=NG3D.graphBounds;
  NG3D.cam.theta=0.4; NG3D.cam.phi=1.05;
  NG3D.cam.radius=b?b.diagonal*1.4:500;
  NG3D.cam.target={x:b?b.cx:0,y:b?b.cy:0,z:b?b.cz:0};
  NG3D.cam.autoRotate=true;
}
function ng3dTopView() {
  NG3D.cam.phi=0.08; NG3D.cam.autoRotate=false;
  clearTimeout(NG3D.cam._autoTimer);
  NG3D.cam._autoTimer=setTimeout(function(){NG3D.cam.autoRotate=true;},5000);
}
function ng3dFrontView() {
  NG3D.cam.phi=Math.PI/2; NG3D.cam.theta=0; NG3D.cam.autoRotate=false;
  clearTimeout(NG3D.cam._autoTimer);
  NG3D.cam._autoTimer=setTimeout(function(){NG3D.cam.autoRotate=true;},5000);
}

// ════════════════════════════════════════════════════════
// INIT / DESTROY / TOGGLE
// ════════════════════════════════════════════════════════
function ngInit3D() {
  if (!NG.built)       { toast('Build the graph first','w'); return; }
  if (!window.THREE)   { toast('Three.js not loaded','e');   return; }

  var container=document.getElementById('ng-3d-wrap');
  if (!container) return;

  // Destroy old renderer if any
  ngDestroy3D(true);

  _ng3dBuildScene(container);
  _ng3dSetupEvents(container);
  _ng3dBuildControls(container);
  NG3D.active=true;
  NG3D.built=true;
  _ng3dUpdateCamera();
  _ng3dAnimate();
}

function ngDestroy3D(keepContainer) {
  NG3D.active=false;
  cancelAnimationFrame(NG3D.animFrame);
  NG3D.animFrame=null;
  _ng3dHideTooltip();
  delete NG3D.cam.keys;
  NG3D.cam.keys={};

  if (NG3D.renderer) {
    var container=document.getElementById('ng-3d-wrap');
    if (container&&!keepContainer) {
      while(container.firstChild) container.removeChild(container.firstChild);
    } else if (container) {
      while(container.firstChild) container.removeChild(container.firstChild);
    }
    if (NG3D.scene) {
      NG3D.scene.traverse(function(o){
        if (o.geometry) o.geometry.dispose();
        if (o.material){
          if(o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    NG3D.renderer.dispose();
    NG3D.renderer=null; NG3D.scene=null; NG3D.camera=null;
    NG3D.meshes={}; NG3D.labels={}; NG3D._meshList=[];
    NG3D.edges={mentions:null,co_occurrence:null,similarity:null};
    NG3D.hovered3D=null; NG3D.selected3D=null;
    NG3D.built=false;
  }
  var ctrl=document.getElementById('ng-3d-controls');
  if (ctrl) ctrl.remove();
}

function ngSetMode(mode, btn) {
  var canvas=document.getElementById('ng-canvas');
  var wrap3d=document.getElementById('ng-3d-wrap');
  var zoom2d=document.getElementById('ng-zoom-ctrls');
  document.querySelectorAll('.ng-mode-btn').forEach(function(b){
    b.classList.toggle('on',b===btn);
  });
  if (mode==='3d') {
    if (canvas)  canvas.style.display='none';
    if (zoom2d)  zoom2d.style.display='none';
    if (wrap3d)  wrap3d.style.display='block';
    if (NG.animFrame){ cancelAnimationFrame(NG.animFrame); NG.animFrame=null; }
    ngInit3D();
  } else {
    ngDestroy3D();
    if (wrap3d)  wrap3d.style.display='none';
    if (canvas)  canvas.style.display='block';
    if (zoom2d)  zoom2d.style.display='flex';
    if (!NG.animFrame) ngAnimate();
  }
}

// ── Hook: show toggle after build ─────────────────────────
(function(){
  var _orig=_ngUpdateStats;
  _ngUpdateStats=function(nodes,edges,nComm){
    _orig(nodes,edges,nComm);
    var t=document.getElementById('ng-mode-toggle');
    if(t) t.style.display='flex';
  };
})();

// ── Hook: clear 3D cache on rebuild ───────────────────────
var _ngBuild3dOrig=ngBuild;
ngBuild=async function(){
  NG3D.pos3D={};
  if(NG3D.active) ngSetMode('2d',document.getElementById('ng-btn-2d'));
  return await _ngBuild3dOrig();
};

/* ═══════════ 16_timeline_graph.js ═══════════ */
/**
 * @file 16_timeline_graph.js
 * @module WorldLens / Timeline Graph
 *
 * Renders live events on a temporal SVG canvas with swim-lanes,
 * narrative grouping, and interactive node inspection.
 *
 * Layout
 * ──────
 *   X axis  = time  (oldest left → newest right)
 *   Y axis  = swim-lane (one per timeline_band) + within-lane
 *             vertical jitter by severity for visual spread
 *   Node    = circle, radius ∝ severity, colour by band/severity/sentiment
 *   Edge    = curved line connecting events sharing the same narrative_id
 *             (same story reported by multiple sources)
 *   Heat bar = thin horizontal strip at the top showing event density over time
 *
 * Interactions
 * ────────────
 *   Click node      → show detail card in sidebar + highlight narrative chain
 *   Hover node      → tooltip with title, source, severity, band
 *   Drag canvas     → pan
 *   Scroll          → zoom X axis (time compression/expansion)
 *   Double-click    → open original article URL
 *   Shift+click     → compare two events side-by-side
 */

// ══════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════
var TL = {
  events:      [],   // filtered + processed events
  nodes:       [],   // layout nodes: {id, x, y, r, color, ev, lane}
  edges:       [],   // narrative edges: {src, tgt}
  colorMode:   'band',    // 'band' | 'severity' | 'sentiment'
  zoom:        1.0,
  panX:        0,
  W:           0,
  H:           0,
  svg:         null,
  svgG:        null,
  selected:    null,
  compared:    null,
  isDragging:  false,
  dragStart:   {x:0},
  panStart:    0,
  tooltip:     null,
  built:       false,
};

// ── Band metadata ─────────────────────────────────────
var TL_BANDS = {
  conflict:      { color: '#EF4444', icon: '⚔',  label: 'Conflict',     order: 0 },
  geopolitical:  { color: '#3B82F6', icon: '🌐', label: 'Geopolitical', order: 1 },
  macro:         { color: '#10B981', icon: '🏦', label: 'Macro',        order: 2 },
  markets:       { color: '#06B6D4', icon: '📈', label: 'Markets',      order: 3 },
  energy:        { color: '#F59E0B', icon: '⚡',  label: 'Energy',       order: 4 },
  disaster:      { color: '#8B5CF6', icon: '🌪',  label: 'Disaster',     order: 5 },
  tech:          { color: '#EC4899', icon: '💻', label: 'Tech',         order: 6 },
  humanitarian:  { color: '#F97316', icon: '🤝', label: 'Humanitarian', order: 7 },
};

var TL_SEV_COLORS = ['#10B981','#3B82F6','#F59E0B','#F97316','#EF4444'];
var TL_SENT_COLORS = { positive:'#10B981', neutral:'#64748B', mixed:'#F59E0B', negative:'#EF4444' };

// ══════════════════════════════════════════════════════
// MODE SWITCH HOOK  (called from ngSwitchMode)
// ══════════════════════════════════════════════════════

// Timeline mode activation handled in ngSwitchMode (15_knowledge_explorer.js)

// ══════════════════════════════════════════════════════
// BUILD  — filter events → compute layout → render
// ══════════════════════════════════════════════════════

function tlBuild() {
  track('timeline_built', 'graph', (document.getElementById('tl-band')||{}).value||'all');
  if (!G || !G.events || !G.events.length) {
    _tlShowEmpty('No events loaded yet. Wait for data to sync.');
    return;
  }

  var hours   = parseInt(document.getElementById('tl-hours').value)    || 24;
  var band    = (document.getElementById('tl-band').value    || 'all');
  var minSev  = parseFloat(document.getElementById('tl-minsev').value)  || 3;
  var groupNr = document.getElementById('tl-group').checked;

  var now     = Date.now();
  var cutoff  = now - hours * 3600000;

  // ── 1. Filter ──────────────────────────────────────────
  TL.events = G.events.filter(function(ev) {
    var ts   = new Date(ev.timestamp).getTime();
    if (isNaN(ts) || ts < cutoff)               return false;
    if ((ev.severity || 0) < minSev)            return false;
    if (band !== 'all') {
      var b = ev.timeline_band || _tlInferBand(ev);
      if (b !== band)                           return false;
    }
    return true;
  });

  TL.events.sort(function(a,b){ return new Date(a.timestamp) - new Date(b.timestamp); });

  if (!TL.events.length) {
    _tlShowEmpty('No events match the current filters. Try widening the time window or lowering the severity threshold.');
    return;
  }

  // ── 2. Layout ──────────────────────────────────────────
  _tlComputeLayout(groupNr);

  // ── 3. Narrative edges ─────────────────────────────────
  _tlComputeEdges(groupNr);

  // ── 4. Render ──────────────────────────────────────────
  _tlRender();
  TL.built = true;

  // ── 5. Update sidebar stat pill ────────────────────────
  var pill = document.getElementById('tl-stat-pill');
  if (pill) pill.textContent = TL.events.length + ' events';
}

// ══════════════════════════════════════════════════════
// LAYOUT ENGINE
// ══════════════════════════════════════════════════════

function _tlComputeLayout(groupNarrative) {
  if (!TL.W || !TL.H) _tlInitSVG();

  var evs     = TL.events;
  var W       = TL.W;
  var H       = TL.H;
  var PAD_L   = 50;  // left padding (band labels)
  var PAD_R   = 20;
  var PAD_T   = 40;  // top (heat bar)
  var PAD_B   = 30;  // bottom (time axis)

  // Time domain
  var tMin = new Date(evs[0].timestamp).getTime();
  var tMax = new Date(evs[evs.length-1].timestamp).getTime();
  if (tMin === tMax) { tMax = tMin + 3600000; }

  function tToX(ts) {
    var t = new Date(ts).getTime();
    return PAD_L + ((t - tMin) / (tMax - tMin)) * (W - PAD_L - PAD_R);
  }

  // Band lanes
  var activeBands = {};
  evs.forEach(function(ev) {
    var b = ev.timeline_band || _tlInferBand(ev);
    activeBands[b] = true;
  });
  var bandKeys = Object.keys(TL_BANDS).filter(function(k){ return activeBands[k]; });
  bandKeys.sort(function(a,b){ return TL_BANDS[a].order - TL_BANDS[b].order; });

  var laneH    = (H - PAD_T - PAD_B) / Math.max(bandKeys.length, 1);
  var laneMap  = {};
  bandKeys.forEach(function(k, i) {
    laneMap[k] = { idx: i, yCenter: PAD_T + (i + 0.5) * laneH };
  });

  // Compute nodes
  TL.nodes = [];
  TL._laneMap = laneMap;
  TL._laneH   = laneH;
  TL._tMin    = tMin;
  TL._tMax    = tMax;
  TL._padL    = PAD_L;
  TL._padT    = PAD_T;

  // Track horizontal positions to avoid overlap
  var xOccupied = {};

  evs.forEach(function(ev, idx) {
    var band  = ev.timeline_band || _tlInferBand(ev);
    var lane  = laneMap[band] || laneMap[Object.keys(laneMap)[0]];
    var sev   = ev.severity || 5;
    var r     = Math.max(4, Math.min(18, sev * 1.8));
    var xBase = tToX(ev.timestamp);

    // Vertical jitter within lane based on severity (higher sev = center)
    var yOffset = (1.0 - sev / 10) * (laneH * 0.35) * (idx % 2 === 0 ? 1 : -1);
    var y       = lane.yCenter + yOffset;
    y           = Math.max(PAD_T + r + 2, Math.min(H - PAD_B - r - 2, y));

    // Horizontal deconflict
    var lKey = band + '_' + Math.round(xBase / 10);
    if (!xOccupied[lKey]) xOccupied[lKey] = [];
    var xShift = xOccupied[lKey].length * 5;
    xOccupied[lKey].push(1);

    TL.nodes.push({
      id:    ev.id,
      x:     xBase + xShift,
      y:     y,
      r:     r,
      color: _tlNodeColor(ev),
      ev:    ev,
      band:  band,
      lane:  lane,
      narrative: groupNarrative ? (ev.narrative_id || ev.id) : ev.id,
    });
  });

  // Compute heat bar (event density per time bucket)
  var BUCKETS = 60;
  TL._heatBuckets = new Array(BUCKETS).fill(0);
  evs.forEach(function(ev) {
    var t   = new Date(ev.timestamp).getTime();
    var idx = Math.floor((t - tMin) / (tMax - tMin + 1) * BUCKETS);
    idx     = Math.max(0, Math.min(BUCKETS - 1, idx));
    TL._heatBuckets[idx] += ev.severity / 10;
  });
}

// ══════════════════════════════════════════════════════
// NARRATIVE EDGES
// ══════════════════════════════════════════════════════

function _tlComputeEdges(groupNarrative) {
  TL.edges = [];
  if (!groupNarrative) return;

  var byNarrative = {};
  TL.nodes.forEach(function(n) {
    var key = n.narrative;
    if (!byNarrative[key]) byNarrative[key] = [];
    byNarrative[key].push(n);
  });

  Object.values(byNarrative).forEach(function(group) {
    if (group.length < 2) return;
    // Connect chronologically
    group.sort(function(a,b){ return new Date(a.ev.timestamp) - new Date(b.ev.timestamp); });
    for (var i = 0; i < group.length - 1; i++) {
      TL.edges.push({ src: group[i], tgt: group[i+1] });
    }
  });
}

// ══════════════════════════════════════════════════════
// SVG RENDERER
// ══════════════════════════════════════════════════════

function _tlRender() {
  var svg = document.getElementById('tl-svg');
  if (!svg) return;

  var W = TL.W, H = TL.H;
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.innerHTML = '';

  var g = _svgEl('g', {id:'tl-g', transform: 'translate(' + TL.panX + ',0) scale(' + TL.zoom + ',1)'});
  svg.appendChild(g);
  TL.svgG = g;

  var defs = _svgEl('defs');
  defs.innerHTML =
    '<filter id="tl-glow"><feGaussianBlur stdDeviation="3" result="b"/>'
    + '<feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'
    + '<marker id="tl-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">'
    + '<path d="M0,0 L0,6 L6,3 z" fill="#475569"/></marker>';
  g.insertBefore(defs, g.firstChild);

  // ── Background grid lines (time ticks) ────────────────
  _tlRenderTimeAxis(g);

  // ── Heat bar ──────────────────────────────────────────
  _tlRenderHeatBar(g);

  // ── Band swim-lane labels & separators ─────────────────
  _tlRenderLanes(g);

  // ── Narrative edges ───────────────────────────────────
  var edgeGroup = _svgEl('g', {'class':'tl-edges'});
  TL.edges.forEach(function(e) {
    var dx = e.tgt.x - e.src.x;
    var dy = e.tgt.y - e.src.y;
    var cx = e.src.x + dx * 0.5;
    var cy = e.src.y + dy * 0.3;
    var path = _svgEl('path', {
      d: 'M' + e.src.x + ',' + e.src.y
        + ' Q' + cx + ',' + cy
        + ' ' + e.tgt.x + ',' + e.tgt.y,
      fill: 'none',
      stroke: '#475569',
      'stroke-width': '1',
      'stroke-opacity': '0.35',
      'stroke-dasharray': '3,3',
    });
    edgeGroup.appendChild(path);
  });
  g.appendChild(edgeGroup);

  // ── Event nodes ───────────────────────────────────────
  var nodeGroup = _svgEl('g', {'class':'tl-nodes'});
  TL.nodes.forEach(function(n) {
    var ng = _svgEl('g', { 'class':'tl-node', 'cursor':'pointer', 'data-id': n.id });

    // Severity ring (outer)
    var ring = _svgEl('circle', {
      cx: n.x, cy: n.y, r: n.r + 3,
      fill: 'none',
      stroke: n.color,
      'stroke-width': '1.5',
      'stroke-opacity': '0.25',
    });
    ng.appendChild(ring);

    // Main dot
    var dot = _svgEl('circle', {
      cx: n.x, cy: n.y, r: n.r,
      fill: n.color,
      'fill-opacity': '0.88',
      stroke: n.color,
      'stroke-width': '1',
    });
    ng.appendChild(dot);

    // Source count badge (multi-source events)
    var sc = n.ev.source_count || 1;
    if (sc > 1) {
      var badge = _svgEl('circle', {
        cx: n.x + n.r * 0.7, cy: n.y - n.r * 0.7, r: 5,
        fill: '#F59E0B', stroke: 'var(--bg0)', 'stroke-width': '1',
      });
      var badgeTxt = _svgEl('text', {
        x: n.x + n.r * 0.7, y: n.y - n.r * 0.7 + 1,
        'text-anchor': 'middle', 'dominant-baseline': 'middle',
        'font-size': '6', 'font-weight': '700', fill: '#1a1a2e',
        'pointer-events': 'none',
      });
      badgeTxt.textContent = sc > 9 ? '9+' : sc;
      ng.appendChild(badge);
      ng.appendChild(badgeTxt);
    }

    // Short label (only for high-severity events)
    if (n.ev.severity >= 7.5) {
      var maxW   = 80;
      var lbl    = (n.ev.title || '').slice(0, 18);
      var lblBg  = _svgEl('rect', {
        x: n.x - maxW/2, y: n.y + n.r + 3,
        width: maxW, height: 11, rx: 3,
        fill: 'rgba(6,11,24,.8)', 'pointer-events': 'none',
      });
      var lblTxt = _svgEl('text', {
        x: n.x, y: n.y + n.r + 10,
        'text-anchor': 'middle',
        'font-size': '7.5', fill: '#CBD5E1',
        'pointer-events': 'none',
      });
      lblTxt.textContent = lbl;
      ng.appendChild(lblBg);
      ng.appendChild(lblTxt);
    }

    // Events
    ng.addEventListener('mouseenter', function(e) {
      dot.setAttribute('filter', 'url(#tl-glow)');
      dot.setAttribute('r', n.r * 1.3);
      _tlShowTooltip(e, n);
    });
    ng.addEventListener('mouseleave', function() {
      if (n.id !== TL.selected) {
        dot.removeAttribute('filter');
        dot.setAttribute('r', n.r);
      }
      _tlHideTooltip();
    });
    ng.addEventListener('click', function(e) {
      e.stopPropagation();
      if (e.shiftKey) {
        _tlCompare(n);
      } else {
        _tlSelectNode(n);
      }
    });
    ng.addEventListener('dblclick', function(e) {
      e.stopPropagation();
      if (n.ev.url) window.open(n.ev.url, '_blank');
    });

    nodeGroup.appendChild(ng);
  });
  g.appendChild(nodeGroup);

  // ── Legend ─────────────────────────────────────────────
  _tlRenderLegend();

  // ── Setup pan/zoom interactions ────────────────────────
  _tlSetupInteractions(svg);

  // Fit view
  tlFitView();
}

// ── Time axis ─────────────────────────────────────────
function _tlRenderTimeAxis(g) {
  var W  = TL.W, H = TL.H;
  var tMin = TL._tMin, tMax = TL._tMax;
  var padL = TL._padL;

  var range = tMax - tMin;
  // Pick tick interval: 1h, 2h, 4h, 6h, 12h, 24h, 48h
  var intervals = [3600000, 7200000, 14400000, 21600000, 43200000, 86400000, 172800000];
  var tickInterval = intervals.find(function(iv){ return range / iv < 12; }) || intervals[intervals.length-1];

  var axisGroup = _svgEl('g', {'class':'tl-axis'});

  var t = Math.ceil(tMin / tickInterval) * tickInterval;
  while (t <= tMax) {
    var x = padL + (t - tMin) / (tMax - tMin) * (W - padL - 20);

    // Vertical grid line
    var line = _svgEl('line', {
      x1: x, y1: TL._padT, x2: x, y2: H - 30,
      stroke: '#1E293B', 'stroke-width': '1',
    });
    axisGroup.appendChild(line);

    // Tick label
    var d      = new Date(t);
    var hour   = d.getHours().toString().padStart(2,'0');
    var min    = d.getMinutes().toString().padStart(2,'0');
    var day    = d.toLocaleDateString('en', {month:'short', day:'numeric'});
    var label  = tickInterval < 86400000 ? hour+':'+min : day;
    var lbl    = _svgEl('text', {
      x: x, y: H - 16,
      'text-anchor': 'middle',
      'font-size': '8.5',
      fill: '#4B5E7A',
    });
    lbl.textContent = label;
    axisGroup.appendChild(lbl);

    t += tickInterval;
  }

  // X axis baseline
  var baseline = _svgEl('line', {
    x1: padL, y1: H - 30, x2: W - 20, y2: H - 30,
    stroke: '#1E293B', 'stroke-width': '1',
  });
  axisGroup.appendChild(baseline);
  g.appendChild(axisGroup);
}

// ── Heat bar ──────────────────────────────────────────
function _tlRenderHeatBar(g) {
  if (!TL._heatBuckets) return;
  var W      = TL.W;
  var padL   = TL._padL;
  var usableW= W - padL - 20;
  var bw     = usableW / TL._heatBuckets.length;
  var maxH   = 20;
  var maxVal = Math.max.apply(null, TL._heatBuckets) || 1;

  var heatGroup = _svgEl('g', {'class':'tl-heat'});
  TL._heatBuckets.forEach(function(val, i) {
    var barH = Math.max(1, (val / maxVal) * maxH);
    var x    = padL + i * bw;
    var intens = val / maxVal;
    var r = Math.round(239 * intens);
    var b = Math.round(68  * intens);
    var rect = _svgEl('rect', {
      x: x, y: TL._padT - barH - 4,
      width: Math.max(1, bw - 0.5), height: barH,
      fill: `rgb(${r},${Math.round(68*(1-intens))},${b})`,
      'fill-opacity': '0.7',
      rx: '1',
    });
    heatGroup.appendChild(rect);
  });
  g.appendChild(heatGroup);
}

// ── Swim-lane labels ──────────────────────────────────
function _tlRenderLanes(g) {
  var laneMap = TL._laneMap;
  var laneH   = TL._laneH;
  var laneGroup = _svgEl('g', {'class':'tl-lanes'});

  Object.keys(laneMap).forEach(function(band) {
    var lane = laneMap[band];
    var meta = TL_BANDS[band] || {color:'#64748B', icon:'●', label: band};
    var yTop = lane.yCenter - laneH / 2;

    // Lane separator
    var sep = _svgEl('line', {
      x1: 0, y1: yTop, x2: TL.W, y2: yTop,
      stroke: '#0F172A', 'stroke-width': '1',
    });
    laneGroup.appendChild(sep);

    // Band label (left margin, vertical)
    var lbl = _svgEl('text', {
      x: 4, y: lane.yCenter,
      'text-anchor': 'start',
      'dominant-baseline': 'middle',
      'font-size': '8',
      'font-weight': '700',
      fill: meta.color,
      transform: 'rotate(-90,' + 4 + ',' + lane.yCenter + ')',
    });
    lbl.textContent = meta.icon;
    laneGroup.appendChild(lbl);

    // Lane label horizontal
    var lbl2 = _svgEl('text', {
      x: 12, y: lane.yCenter,
      'dominant-baseline': 'middle',
      'font-size': '8',
      'font-weight': '600',
      fill: meta.color,
      'fill-opacity': '0.7',
    });
    lbl2.textContent = meta.label;
    laneGroup.appendChild(lbl2);
  });

  g.appendChild(laneGroup);
}

// ── Legend ────────────────────────────────────────────
function _tlRenderLegend() {
  var legend = document.getElementById('tl-legend');
  if (!legend) return;

  if (TL.colorMode === 'band') {
    var activeBands = {};
    TL.nodes.forEach(function(n){ activeBands[n.band] = true; });
    legend.innerHTML = Object.keys(activeBands).map(function(b) {
      var m = TL_BANDS[b] || {color:'#64748B', icon:'●', label:b};
      return '<div><span style="color:'+m.color+'">'+m.icon+'</span> '+m.label+'</div>';
    }).join('');
  } else if (TL.colorMode === 'severity') {
    legend.innerHTML =
      '<div><span style="color:#10B981">●</span> Low (1-3)</div>' +
      '<div><span style="color:#3B82F6">●</span> Medium (4-6)</div>' +
      '<div><span style="color:#F59E0B">●</span> High (7-8)</div>' +
      '<div><span style="color:#EF4444">●</span> Critical (9-10)</div>';
  } else {
    legend.innerHTML =
      '<div><span style="color:#10B981">●</span> Positive</div>' +
      '<div><span style="color:#64748B">●</span> Neutral</div>' +
      '<div><span style="color:#EF4444">●</span> Negative</div>';
  }
}

// ══════════════════════════════════════════════════════
// NODE INTERACTION
// ══════════════════════════════════════════════════════

function _tlSelectNode(n) {
  TL.selected = n.id;

  // Dim all, highlight selected + narrative chain
  var narrative = n.narrative;
  document.querySelectorAll('.tl-node circle:first-of-type').forEach(function(c) {
    c.style.opacity = '0.3';
  });
  document.querySelectorAll('[data-id]').forEach(function(g2) {
    var node = TL.nodes.find(function(nd){ return nd.id === g2.dataset.id; });
    if (node && (node.id === n.id || node.narrative === narrative)) {
      var c = g2.querySelector('circle');
      if (c) { c.style.opacity = '1'; c.setAttribute('filter','url(#tl-glow)'); }
    }
  });

  // Sidebar detail
  _tlShowEventDetail(n.ev, false);
}

function _tlCompare(n) {
  if (!TL.compared) {
    TL.compared = n;
    toast('Shift+click another event to compare', 'i');
    return;
  }
  _tlShowEventDetail(n.ev, TL.compared.ev);
  TL.compared = null;
}

function _tlShowEventDetail(ev, compareEv) {
  var list = document.getElementById('tl-event-list');
  if (!list) return;

  function _card(e, isCompare) {
    var band = e.timeline_band || _tlInferBand(e);
    var meta = TL_BANDS[band] || { color: '#64748B', icon: '●' };
    var sCol = e.sentiment_tone === 'positive' ? '#10B981'
             : e.sentiment_tone === 'negative' ? '#EF4444' : '#64748B';
    var sevCol = e.severity >= 7 ? 'var(--re)' : e.severity >= 5 ? 'var(--am)' : 'var(--gr)';

    var kw = (e.keywords || []).slice(0, 4).join(' · ');
    var srcs = (e.source_list || [e.source || '']).slice(0, 3).join(', ');
    var sc   = e.source_count || 1;

    return '<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;'
         + 'padding:12px;margin-bottom:8px;'
         + (isCompare ? 'border-color:rgba(139,92,246,.4);' : '') + '">'
         // Header band badge
         + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:8px">'
         + '<span style="font-size:9px;padding:2px 8px;border-radius:100px;background:'+meta.color+'22;'
         + 'color:'+meta.color+';font-weight:700;border:1px solid '+meta.color+'44">'
         + meta.icon + ' ' + band.toUpperCase() + '</span>'
         + '<span style="font-size:9px;color:var(--t3)">' + _tlTimeAgo(e.timestamp) + '</span>'
         + (sc > 1 ? '<span style="font-size:9px;color:var(--am)">✦ '+sc+' sources</span>' : '')
         + '</div>'
         // Title
         + '<div style="font-size:11px;font-weight:700;color:var(--t1);line-height:1.45;margin-bottom:6px">'
         + (e.title || '') + '</div>'
         // Metrics row
         + '<div style="display:flex;gap:10px;margin-bottom:8px">'
         + '<div style="display:flex;flex-direction:column;gap:1px">'
         + '<span style="font-size:8px;color:var(--t4)">SEVERITY</span>'
         + '<span style="font-size:13px;font-weight:800;color:'+sevCol+'">' + (e.severity||0).toFixed(1) + '</span>'
         + '</div>'
         + '<div style="width:1px;background:var(--bd)"></div>'
         + '<div style="display:flex;flex-direction:column;gap:1px">'
         + '<span style="font-size:8px;color:var(--t4)">SENTIMENT</span>'
         + '<span style="font-size:11px;font-weight:700;color:'+sCol+'">'
         + (e.sentiment_tone||'neutral').toUpperCase() + '</span>'
         + '</div>'
         + '<div style="width:1px;background:var(--bd)"></div>'
         + '<div style="display:flex;flex-direction:column;gap:1px">'
         + '<span style="font-size:8px;color:var(--t4)">IMPACT</span>'
         + '<span style="font-size:11px;font-weight:700;color:var(--t2)">' + (e.impact||'—') + '</span>'
         + '</div>'
         + '</div>'
         // Keywords
         + (kw ? '<div style="font-size:9px;color:var(--t3);margin-bottom:8px">🔑 ' + kw + '</div>' : '')
         // Markets
         + ((e.related_markets||[]).length ?
           '<div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:8px">'
           + (e.related_markets||[]).map(function(m){
               return '<span style="font-size:8px;padding:1px 6px;border-radius:4px;background:rgba(59,130,246,.1);color:var(--b4)">'+m+'</span>';
             }).join('') + '</div>' : '')
         // Source
         + '<div style="font-size:9px;color:var(--t3);margin-bottom:8px">📰 ' + srcs + '</div>'
         // Actions
         + '<div style="display:flex;gap:6px">'
         + (e.url ? '<a href="' + e.url + '" target="_blank" class="btn btn-g btn-xs" '
           + 'style="font-size:9px;padding:4px 10px">↗ Read</a>' : '')
         + '<button onclick="tlHighlightNarrative(\'' + (e.narrative_id||'') + '\')" '
           + 'class="btn btn-p btn-xs" style="font-size:9px;padding:4px 10px">📍 Narrative</button>'
         + '<button onclick="tlShowOnMap(\'' + e.id + '\')" '
           + 'class="btn btn-o btn-xs" style="font-size:9px;padding:4px 10px">🗺 Map</button>'
         + '</div>'
         + '</div>';
  }

  var html = '';
  if (compareEv) {
    html += '<div style="font-size:9px;font-weight:700;color:var(--b4);margin-bottom:8px;padding:0 2px">⚖ COMPARISON</div>';
    html += _card(ev, false);
    html += '<div style="text-align:center;font-size:9px;color:var(--t4);margin:4px 0">vs</div>';
    html += _card(compareEv, true);
  } else {
    html = _card(ev, false);
    // Find related events (same narrative)
    if (ev.narrative_id) {
      var related = TL.events.filter(function(e){
        return e.id !== ev.id && e.narrative_id === ev.narrative_id;
      }).slice(0, 3);
      if (related.length) {
        html += '<div style="font-size:9px;font-weight:700;color:var(--t3);'
              + 'text-transform:uppercase;letter-spacing:.1em;margin:10px 0 5px">'
              + '📎 Same Narrative</div>';
        related.forEach(function(r) { html += _card(r, false); });
      }
    }
  }

  list.innerHTML = html;
}

// Highlight all events sharing a narrative_id
function tlHighlightNarrative(narrativeId) {
  if (!narrativeId) return;
  document.querySelectorAll('.tl-node circle:first-of-type').forEach(function(c){
    c.style.opacity = '0.2';
    c.removeAttribute('filter');
  });
  document.querySelectorAll('[data-id]').forEach(function(g2) {
    var node = TL.nodes.find(function(n){ return n.id === g2.dataset.id; });
    if (node && node.ev.narrative_id === narrativeId) {
      var c = g2.querySelector('circle');
      if (c) { c.style.opacity = '1'; c.setAttribute('filter','url(#tl-glow)'); }
    }
  });
}

// Show event on map
function tlShowOnMap(evId) {
  sv('map', document.querySelector('[data-v=map]'));
  setTimeout(function(){ if(typeof openEP === 'function') openEP(evId); }, 600);
}

// ══════════════════════════════════════════════════════
// TOOLTIP
// ══════════════════════════════════════════════════════

function _tlShowTooltip(e, n) {
  var tip = document.getElementById('tl-tooltip');
  if (!tip) {
    tip = document.createElement('div');
    tip.id = 'tl-tooltip';
    tip.style.cssText = 'position:fixed;pointer-events:none;z-index:9999;'
      + 'background:rgba(6,11,24,.95);border:1px solid var(--bd);'
      + 'border-radius:8px;padding:8px 10px;font-size:10px;max-width:240px;'
      + 'color:var(--t1);box-shadow:0 8px 24px rgba(0,0,0,.4);'
      + 'transition:opacity .1s';
    document.body.appendChild(tip);
  }
  var meta = TL_BANDS[n.band] || {color:'#64748B', icon:'●'};
  tip.innerHTML =
    '<div style="font-weight:700;line-height:1.4;margin-bottom:4px">' + (n.ev.title||'').slice(0,80) + '</div>'
    + '<div style="color:'+meta.color+';font-size:9px;margin-bottom:3px">'
    + meta.icon + ' ' + (n.band||'') + ' · ⚡ ' + (n.ev.severity||0).toFixed(1)
    + '</div>'
    + '<div style="color:var(--t3);font-size:9px">' + (n.ev.source||'') + ' · ' + _tlTimeAgo(n.ev.timestamp) + '</div>';

  tip.style.left   = (e.clientX + 12) + 'px';
  tip.style.top    = (e.clientY - 10) + 'px';
  tip.style.opacity = '1';
  TL.tooltip = tip;
}

function _tlHideTooltip() {
  if (TL.tooltip) { TL.tooltip.style.opacity = '0'; }
}

// ══════════════════════════════════════════════════════
// COLOUR MODES
// ══════════════════════════════════════════════════════

function tlSetColorMode(mode, btn) {
  TL.colorMode = mode;
  document.querySelectorAll('.tl-color-btn').forEach(function(b){
    b.classList.toggle('on', b === btn);
  });
  // Recompute colors and redraw
  TL.nodes.forEach(function(n){ n.color = _tlNodeColor(n.ev); });
  if (TL.built) _tlRender();
}

function _tlNodeColor(ev) {
  if (TL.colorMode === 'severity') {
    var s = ev.severity || 5;
    if (s >= 9)   return TL_SEV_COLORS[4];
    if (s >= 7)   return TL_SEV_COLORS[3];
    if (s >= 5)   return TL_SEV_COLORS[2];
    if (s >= 3)   return TL_SEV_COLORS[1];
    return TL_SEV_COLORS[0];
  }
  if (TL.colorMode === 'sentiment') {
    return TL_SENT_COLORS[ev.sentiment_tone || 'neutral'] || TL_SENT_COLORS.neutral;
  }
  // band mode
  var b = ev.timeline_band || _tlInferBand(ev);
  return (TL_BANDS[b] || {color:'#64748B'}).color;
}

// ══════════════════════════════════════════════════════
// PAN / ZOOM
// ══════════════════════════════════════════════════════

function _tlSetupInteractions(svg) {
  var isPanning = false;
  var startX    = 0;
  var startPan  = 0;

  svg.addEventListener('mousedown', function(e) {
    if (e.target === svg || e.target.tagName === 'svg' ||
        e.target.id === 'tl-g') {
      isPanning = true;
      startX    = e.clientX;
      startPan  = TL.panX;
      svg.style.cursor = 'grabbing';
    }
  });
  window.addEventListener('mousemove', function(e) {
    if (!isPanning) return;
    TL.panX = startPan + (e.clientX - startX);
    _tlApplyTransform();
  });
  window.addEventListener('mouseup', function() {
    isPanning = false;
    svg.style.cursor = 'default';
  });

  svg.addEventListener('wheel', function(e) {
    e.preventDefault();
    var factor  = e.deltaY > 0 ? 0.85 : 1.18;
    var prevZ   = TL.zoom;
    TL.zoom     = Math.max(0.3, Math.min(8, TL.zoom * factor));
    // Zoom toward cursor
    var rect    = svg.getBoundingClientRect();
    var mouseX  = e.clientX - rect.left;
    TL.panX     = mouseX - (mouseX - TL.panX) * (TL.zoom / prevZ);
    _tlApplyTransform();
  }, {passive: false});
}

function _tlApplyTransform() {
  var g = document.getElementById('tl-g');
  if (g) g.setAttribute('transform', 'translate(' + TL.panX + ',0) scale(' + TL.zoom + ',1)');
}

function tlZoom(factor) {
  TL.zoom = Math.max(0.3, Math.min(8, TL.zoom * factor));
  _tlApplyTransform();
}

function tlFitView() {
  TL.zoom = 1;
  TL.panX = 0;
  _tlApplyTransform();
}

// ══════════════════════════════════════════════════════
// INIT SVG + RESIZE
// ══════════════════════════════════════════════════════

function _tlInitSVG() {
  var wrap = document.getElementById('tl-svg-wrap');
  var svg  = document.getElementById('tl-svg');
  if (!wrap || !svg) return;

  TL.W   = wrap.offsetWidth  || 900;
  TL.H   = wrap.offsetHeight || 500;
  TL.svg = svg;

  svg.setAttribute('viewBox', '0 0 ' + TL.W + ' ' + TL.H);
  svg.style.cursor = 'grab';
}

function _tlShowEmpty(msg) {
  var svg = document.getElementById('tl-svg');
  if (!svg) return;
  _tlInitSVG();
  svg.setAttribute('viewBox', '0 0 ' + TL.W + ' ' + TL.H);
  svg.innerHTML = '';
  var W = TL.W, H = TL.H;
  var txt = _svgEl('text', {
    x: W/2, y: H/2 - 16,
    'text-anchor': 'middle', fill: '#4B5E7A', 'font-size': '13',
  });
  txt.textContent = '📅 Event Timeline';
  svg.appendChild(txt);
  var sub = _svgEl('text', {
    x: W/2, y: H/2 + 12,
    'text-anchor': 'middle', fill: '#2A3A52', 'font-size': '10',
  });
  sub.textContent = msg || 'Adjust filters and click Refresh';
  svg.appendChild(sub);
}

// ══════════════════════════════════════════════════════
// UTILITY
// ══════════════════════════════════════════════════════

function _tlInferBand(ev) {
  var cat = (ev.category || '').toLowerCase();
  if (['conflict','security'].includes(cat))          return 'conflict';
  if (['geopolitics','politics','humanitarian'].includes(cat)) return 'geopolitical';
  if (['economics','trade'].includes(cat))            return 'macro';
  if (['finance'].includes(cat))                      return 'markets';
  if (['energy'].includes(cat))                       return 'energy';
  if (['disaster','earthquake','health'].includes(cat)) return 'disaster';
  if (['technology'].includes(cat))                   return 'tech';
  return 'geopolitical';
}

function _tlTimeAgo(ts) {
  if (!ts) return '';
  var diff = (Date.now() - new Date(ts).getTime()) / 1000;
  if (diff < 60)    return Math.round(diff) + 's ago';
  if (diff < 3600)  return Math.round(diff/60) + 'm ago';
  if (diff < 86400) return Math.round(diff/3600) + 'h ago';
  return Math.round(diff/86400) + 'd ago';
}

// ResizeObserver to re-render on panel resize
(function() {
  if (window.ResizeObserver) {
    var wrap = document.getElementById('tl-svg-wrap');
    if (wrap) {
      new ResizeObserver(function() {
        var w = wrap.offsetWidth, h = wrap.offsetHeight;
        if (w && h) {
          TL.W = w; TL.H = h;
          if (TL.built) _tlRender();
        }
      }).observe(wrap);
    }
  }
})();

/* ═══════════ 18_network_hub.js ═══════════ */
/* ═══════════════════════════════════════════════════════════════════
   WORLDLENS NETWORK HUB VISUALIZATION  (18_network_hub.js)
   ─────────────────────────────────────────────────────────────────
   Brings the satellite network visualizer aesthetic to the map:

   1. Hub Cards       — floating glassmorphism cards on marker click
                        showing Location, LAT/LONG, Nodes, Activity
   2. Category Labels — floating pills showing active categories
                        with event counts, click to filter
   3. Connection Arcs — curved SVG paths between related events
   4. Active View Bar — bottom status bar updating with live stats
   5. Upgraded Markers — network-node style with double pulse rings
   ═══════════════════════════════════════════════════════════════════ */

/* ── State ─────────────────────────────────────────────────────── */
var NHV = {
  activeHubCard:  null,
  activeHubEv:    null,
  arcLines:       [],
  catLabelEls:    [],
  _arcsEnabled:   true,
  _labelsEnabled: true,
};

/* ── Utility ────────────────────────────────────────────────────── */
function _sevClass(s) {
  return s >= 7 ? 'high' : s >= 5 ? 'med' : 'low';
}
function _sevColor(s) {
  return s >= 7 ? 'var(--re)' : s >= 5 ? 'var(--am)' : 'var(--gr)';
}
function _fmtCoord(v, isLat) {
  if (v == null) return '—';
  var dir = isLat ? (v >= 0 ? 'N' : 'S') : (v >= 0 ? 'E' : 'W');
  return Math.abs(v).toFixed(1) + '°' + dir;
}
function _catColor(cat) {
  return (CATS[cat] || CATS.GEOPOLITICS || {c:'#00E5FF'}).c;
}
function _catIcon(cat) {
  return (CATS[cat] || CATS.GEOPOLITICS || {i:'●'}).i;
}

/* ── 1. HUB CARD ────────────────────────────────────────────────── */
function showHubCard(ev, markerEl) {
  removeHubCard();
  if (!ev || !ev.latitude) return;

  var mapEl = document.getElementById('map');
  if (!mapEl) return;

  var card = document.createElement('div');
  card.className = 'hub-card';
  card.id = 'wl-hub-card';

  var sev    = parseFloat(ev.severity) || 5;
  var heat   = parseFloat(ev.heat_index || ev.severity) || 5;
  var srcs   = ev.source_count || ev._groupCount || 1;
  var color  = _catColor(ev.category);
  var icon   = _catIcon(ev.category);
  var sevCls = _sevClass(sev);
  var timeTxt= typeof tAgo === 'function' ? tAgo(new Date(ev.timestamp)) : '';

  card.style.setProperty('--hub-color', color);

  card.innerHTML =
    '<div class="hub-card-inner">' +
      '<div class="hub-card-header">' +
        '<span class="hub-card-label">' + icon + ' ' + ev.category + '</span>' +
        '<div class="hub-card-close" onclick="removeHubCard()" title="Close">✕</div>' +
      '</div>' +
      '<div class="hub-card-body">' +
        '<div class="hub-title">' + ev.title.slice(0, 70) + (ev.title.length > 70 ? '…' : '') + '</div>' +

        '<div class="hub-coords">' +
          '<div class="hub-coords-dot"></div>' +
          ev.country_name + ' &bull; ' +
          _fmtCoord(ev.latitude,  true) + ', ' +
          _fmtCoord(ev.longitude, false) +
        '</div>' +

        '<div class="hub-data-grid">' +
          '<div class="hub-data-item">' +
            '<div class="hub-data-label">Severity</div>' +
            '<div class="hub-data-value ' + sevCls + '">' + sev.toFixed(1) + '</div>' +
          '</div>' +
          '<div class="hub-data-item">' +
            '<div class="hub-data-label">Sources</div>' +
            '<div class="hub-data-value cyan">' + srcs + '</div>' +
          '</div>' +
          '<div class="hub-data-item">' +
            '<div class="hub-data-label">Heat Index</div>' +
            '<div class="hub-data-value ' + _sevClass(heat) + '">' + heat.toFixed(1) + '</div>' +
          '</div>' +
          '<div class="hub-data-item">' +
            '<div class="hub-data-label">Impact</div>' +
            '<div class="hub-data-value ' + (ev.impact === 'High' ? 'high' : ev.impact === 'Medium' ? 'med' : 'low') + '">' +
              (ev.impact || '—') +
            '</div>' +
          '</div>' +
        '</div>' +

        '<div class="hub-actions">' +
          '<div class="hub-action primary" onclick="_hubAction(\'open\',\'' + ev.id + '\')">↗ Open</div>' +
          '<div class="hub-action" onclick="_hubAction(\'ai\',\'' + ev.id + '\')">🤖 AI</div>' +
          '<div class="hub-action" onclick="_hubAction(\'save\',\'' + ev.id + '\')">🔖 Save</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  mapEl.appendChild(card);

  // Position: top-right of marker, bounded within map
  _positionHubCard(card, ev);

  // Show with animation
  requestAnimationFrame(function() {
    card.classList.add('visible');
  });

  // Draw connector line
  _drawConnector(ev);

  NHV.activeHubCard = card;
  NHV.activeHubEv   = ev;
}

function _positionHubCard(card, ev) {
  if (!G.map) return;
  var mapEl = document.getElementById('map');
  if (!mapEl) return;

  var pt    = G.map.latLngToContainerPoint([ev.latitude, ev.longitude]);
  var mW    = mapEl.offsetWidth;
  var mH    = mapEl.offsetHeight;
  var cW    = 240;
  var cH    = 200; // estimate

  // Default: top-right of pin
  var x = pt.x + 18;
  var y = pt.y - cH - 10;

  // Clamp to map bounds
  if (x + cW > mW - 10) x = pt.x - cW - 18;
  if (x < 10) x = 10;
  if (y < 10) y = pt.y + 18;
  if (y + cH > mH - 80) y = pt.y - cH - 10;

  card.style.left = x + 'px';
  card.style.top  = y + 'px';
}

function _drawConnector(ev) {
  var old = document.getElementById('wl-hub-connector');
  if (old) old.remove();
  if (!G.map || !ev.latitude) return;

  var mapEl = document.getElementById('map');
  var card  = document.getElementById('wl-hub-card');
  if (!mapEl || !card) return;

  var pt    = G.map.latLngToContainerPoint([ev.latitude, ev.longitude]);
  var cL    = parseInt(card.style.left, 10);
  var cT    = parseInt(card.style.top,  10);
  var cW    = card.offsetWidth  || 240;
  var cH    = card.offsetHeight || 180;

  // Connect from closest card corner to pin
  var cx = (pt.x > cL + cW / 2) ? cL + cW : cL;
  var cy = cT + cH / 2;

  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.id = 'wl-hub-connector';
  svg.className = 'hub-connector';
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:799;overflow:visible';

  var color = _catColor(ev.category);
  var line  = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  line.setAttribute('x1', cx);
  line.setAttribute('y1', cy);
  line.setAttribute('x2', pt.x);
  line.setAttribute('y2', pt.y);
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', '1');
  line.setAttribute('stroke-dasharray', '4 3');
  line.setAttribute('opacity', '0.5');

  svg.appendChild(line);
  mapEl.appendChild(svg);
}

function removeHubCard() {
  var card = document.getElementById('wl-hub-card');
  if (card) {
    card.classList.remove('visible');
    setTimeout(function() { if (card.parentNode) card.parentNode.removeChild(card); }, 220);
  }
  var conn = document.getElementById('wl-hub-connector');
  if (conn) conn.remove();
  NHV.activeHubCard = null;
  NHV.activeHubEv   = null;
}

function _hubAction(action, evId) {
  var ev = (G.events || []).find(function(e){ return e.id === evId; });
  removeHubCard();
  if (action === 'open' && typeof openEP === 'function') {
    openEP(evId);
  } else if (action === 'ai' && typeof openEP === 'function') {
    openEP(evId);
    setTimeout(function() {
      var tab = document.querySelector('.ep-tab[data-tab="analysis"]');
      if (tab) tab.click();
    }, 300);
  } else if (action === 'save') {
    if (typeof rq === 'function') {
      rq('/api/saved', { method:'POST', body:{ event_id: evId } }).then(function() {
        if (typeof toast === 'function') toast('Saved to reading list', 's');
        if (typeof showHoloXP === 'function') showHoloXP(10, 'Event Saved');
      });
    }
  }
}

/* ── 2. CATEGORY FLOATING LABELS ────────────────────────────────── */
function renderCatLabels() {
  var container = document.getElementById('wl-cat-labels');
  if (!container || !G.map) return;
  container.innerHTML = '';

  // Count active events by category
  var counts = {};
  var cats   = {};
  (G.events || []).forEach(function(ev) {
    if (!ev.latitude || !ev.longitude) return;
    counts[ev.category] = (counts[ev.category] || 0) + 1;
    cats[ev.category] = ev;
  });

  var topCats = Object.keys(counts)
    .sort(function(a,b){ return counts[b] - counts[a]; })
    .slice(0, 5);

  var mapW = container.offsetWidth  || 800;
  var mapH = container.offsetHeight || 500;

  // Place labels at map edges — loosely mirroring the reference image
  // Top-left, top-right, bottom-left, bottom-right, left-center
  var positions = [
    { left: 12, top: 64 },
    { right: 12, top: 64 },
    { left: 12,  bottom: 90 },
    { right: 12, bottom: 90 },
    { left: 12,  top: '40%' },
  ];

  topCats.forEach(function(cat, i) {
    var pos   = positions[i] || positions[0];
    var color = _catColor(cat);
    var icon  = _catIcon(cat);
    var count = counts[cat];
    var label = document.createElement('div');
    label.className  = 'wl-cat-label';
    label.style.animationDelay = (i * 80) + 'ms';

    // Position
    Object.keys(pos).forEach(function(k) { label.style[k] = typeof pos[k] === 'number' ? pos[k] + 'px' : pos[k]; });

    label.style.background   = 'rgba(2,10,20,.85)';
    label.style.borderColor  = color + '40';
    label.style.boxShadow    = '0 0 16px ' + color + '18, inset 0 1px 0 ' + color + '12';

    label.innerHTML =
      '<span class="wl-cat-label-icon">' + icon + '</span>' +
      '<span class="wl-cat-label-body">' +
        '<span class="wl-cat-label-name" style="color:' + color + '">' + cat + '</span>' +
        '<span class="wl-cat-label-count">' + count + ' events</span>' +
      '</span>';

    label.title = 'Filter by ' + cat;
    label.onclick = function() { filterCatLabel(cat, label); };
    container.appendChild(label);
    NHV.catLabelEls.push(label);
  });
}

function filterCatLabel(cat, el) {
  // Toggle category filter
  var sf = window.sf;
  if (typeof sf === 'function') {
    sf('cat', el.dataset.active === 'true' ? '' : cat, el);
    el.dataset.active = el.dataset.active === 'true' ? 'false' : 'true';
  }
}

/* ── 3. CONNECTION ARCS ─────────────────────────────────────────── */
function drawConnectionArcs(events) {
  var svg = document.getElementById('wl-arcs-svg');
  if (!svg || !G.map || !NHV._arcsEnabled) return;
  svg.innerHTML = '';

  if (!events || events.length < 2) return;

  // Draw arcs between same-country events, and high-severity clusters
  var pairs = [];
  var filtered = events.filter(function(e){ return e.latitude && e.longitude && e.severity >= 5; });
  if (filtered.length > 60) filtered = filtered.slice(0, 60); // performance cap

  filtered.forEach(function(a, i) {
    filtered.slice(i+1).forEach(function(b) {
      // Connect if same country or related_markets overlap
      var sameCat     = a.category === b.category;
      var sameCountry = a.country_code && a.country_code === b.country_code;
      if (!sameCat && !sameCountry) return;

      var dist = Math.sqrt(
        Math.pow(a.latitude  - b.latitude,  2) +
        Math.pow(a.longitude - b.longitude, 2)
      );
      if (dist > 35 || dist < 0.5) return; // skip too-far or same-spot

      if (pairs.length < 30) pairs.push([a, b]);
    });
  });

  pairs.forEach(function(pair) {
    var a = pair[0], b = pair[1];
    var ptA = G.map.latLngToContainerPoint([a.latitude, a.longitude]);
    var ptB = G.map.latLngToContainerPoint([b.latitude, b.longitude]);

    // Quadratic bezier control point (arc upward)
    var mx  = (ptA.x + ptB.x) / 2;
    var my  = (ptA.y + ptB.y) / 2 - Math.abs(ptB.x - ptA.x) * 0.3 - 20;

    var path = document.createElementNS('http://www.w3.org/2000/svg','path');
    var d    = 'M' + ptA.x + ',' + ptA.y + ' Q' + mx + ',' + my + ' ' + ptB.x + ',' + ptB.y;
    var color = _catColor(a.category);
    var sev   = Math.max(a.severity, b.severity);
    var alpha = (0.08 + (sev - 5) * 0.03).toFixed(2);

    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-opacity', alpha);
    path.setAttribute('stroke-width', sev >= 7 ? '1.5' : '1');
    path.setAttribute('stroke-dasharray', sev >= 7 ? '5 4' : '3 4');
    path.setAttribute('stroke-dashoffset', '0');
    path.setAttribute('class', 'wl-arc-path wl-arc-animated');
    path.style.animationDelay = (Math.random() * 300) + 'ms';
    svg.appendChild(path);
  });
}

/* ── 4. ACTIVE VIEW STATUS BAR ──────────────────────────────────── */
function updateActiveViewBar() {
  var bar    = document.getElementById('wl-active-view-bar');
  if (!bar) return;

  var evs    = G.events || [];
  var vis    = evs.filter(function(e){ return e.latitude && e.longitude; });
  var count  = vis.length;
  var avgSev = count > 0
    ? (vis.reduce(function(s,e){ return s + (parseFloat(e.severity)||5); }, 0) / count).toFixed(1)
    : '—';

  // Determine mode name
  var modeEl = document.querySelector('.mtool-btn.on');
  var mode   = modeEl ? modeEl.textContent.replace(/^\W+/, '').trim() : 'Global Network';

  var modeEl2 = document.getElementById('avb-mode');
  var countEl = document.getElementById('avb-count');
  var sevEl   = document.getElementById('avb-sev');

  if (modeEl2) modeEl2.textContent = mode;
  if (countEl) countEl.textContent = count;
  if (sevEl)   sevEl.textContent   = avgSev;
}

/* ── 5. MARKER PATCH — hook into addMarker click ───────────────── */
/* After map loads, patch each marker's click to show hub card */
function patchMarkersForHub() {
  if (!G.map || !G.markers) return;
  Object.keys(G.markers).forEach(function(evId) {
    var mk = G.markers[evId];
    var ev = (G.events||[]).find(function(e){ return e.id===evId; });
    if (!ev || !mk) return;
    mk.off('click'); // remove existing
    mk.on('click', function(e) {
      L.DomEvent.stopPropagation(e);
      showHubCard(ev, mk.getElement());
    });
  });
}

/* ── 6. MAIN INIT & HOOKS ───────────────────────────────────────── */
function initNetworkHub() {
  // Wait for map ready
  if (!G.mapReady || !G.map) {
    setTimeout(initNetworkHub, 300);
    return;
  }

  // Hook into updateMarkers
  var _origUM = window.updateMarkers;
  window.updateMarkers = function() {
    if (typeof _origUM === 'function') _origUM();
    setTimeout(function() {
      patchMarkersForHub();
      drawConnectionArcs(G.events || []);
      updateActiveViewBar();
      renderCatLabels();
    }, 80);
  };

  // Redraw arcs on map move/zoom
  G.map.on('moveend zoomend', function() {
    drawConnectionArcs(G.events || []);
    updateActiveViewBar();
    // Reposition hub card if open
    if (NHV.activeHubEv) {
      var card = document.getElementById('wl-hub-card');
      if (card) {
        _positionHubCard(card, NHV.activeHubEv);
        _drawConnector(NHV.activeHubEv);
      }
    }
  });

  // Close hub card on map click (not marker)
  G.map.on('click', function() {
    removeHubCard();
  });

  // Trigger first render
  if ((G.events||[]).length > 0) {
    patchMarkersForHub();
    drawConnectionArcs(G.events || []);
    updateActiveViewBar();
    renderCatLabels();
  }
}

// ── Startup ──────────────────────────────────────────────────────
(function() {
  // Hook sv() to update bar on view change
  var _origSv = window.sv;
  window.sv = function(name, btn) {
    if (typeof _origSv === 'function') _origSv(name, btn);
    if (name === 'map') setTimeout(function() { updateActiveViewBar(); renderCatLabels(); }, 200);
  };

  // Init once DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() { setTimeout(initNetworkHub, 800); });
  } else {
    setTimeout(initNetworkHub, 800);
  }

  // Also hook into the global events refresh
  var _origRefresh = window.refreshFeed;
  window.refreshFeed = function() {
    if (typeof _origRefresh === 'function') _origRefresh();
    setTimeout(function() {
      if (G.mapReady) {
        patchMarkersForHub();
        drawConnectionArcs(G.events || []);
        updateActiveViewBar();
        renderCatLabels();
      }
    }, 500);
  };
})();

/* ═══════════ 22_graph_engine.js ═══════════ */
/**
 * 22_graph_engine.js — Unified Graph Engine bridge v2
 *
 * Orchestrates News Network (12_graph.js) + Knowledge Explorer (15_knowledge_explorer.js)
 * Features:
 *   1. Unified sidebar panels per mode (network/knowledge/timeline/cascade)
 *   2. Cross-engine bridge: News node → KEX  |  KEX topic → NG
 *   3. New edge types: causal (⚡) and temporal (⏱)
 *   4. Live edge type filtering via checkboxes
 *   5. ngSwitchMode overridden to swap sidebar panels
 */
(function() {
'use strict';

var _currentEngine = 'network';
var _selectedNode  = null;

var _ALL_PANELS = ['ng-panel-network','ng-panel-knowledge','ng-panel-timeline','ng-panel-cascade'];
var _MODE_PANEL = {
  graph:    'ng-panel-network',
  explorer: 'ng-panel-knowledge',
  timeline: 'ng-panel-timeline',
  cascade:  'ng-panel-cascade',
};

// ── Show one sidebar panel, hide others ─────────────────────────────────────
function _showPanel(panelId) {
  _ALL_PANELS.forEach(function(pid) {
    var p = document.getElementById(pid);
    if (p) p.style.display = (pid === panelId) ? 'flex' : 'none';
  });
}

// ── Engine tab switcher (top-level: Network / Knowledge) ─────────────────────
window.ngSwitchEngine = function(engine, btn) {
  _currentEngine = engine;
  document.querySelectorAll('.ng-etab').forEach(function(b) {
    b.classList.toggle('on', b === btn);
  });
  if (engine === 'knowledge') {
    _showPanel('ng-panel-knowledge');
    ngSwitchMode('explorer', document.getElementById('ng-tab-explorer'));
  } else {
    _showPanel('ng-panel-network');
    ngSwitchMode('graph', document.getElementById('ng-tab-graph'));
  }
};

// ── Patch ngSwitchMode to swap sidebar + keep engine tabs in sync ─────────────
// Called after all scripts load via a short delay
function _patchSwitchMode() {
  if (!window.ngSwitchMode || window.ngSwitchMode._ge_patched) return;
  var _orig = window.ngSwitchMode;
  window.ngSwitchMode = function(mode, btn) {
    // 1. Swap sidebar panel
    var panelId = _MODE_PANEL[mode] || 'ng-panel-network';
    _showPanel(panelId);
    // 2. Sync engine tabs
    var isKnowledge = (mode === 'explorer');
    _currentEngine = isKnowledge ? 'knowledge' : 'network';
    document.querySelectorAll('.ng-etab').forEach(function(b) {
      b.classList.toggle('on',
        (isKnowledge  && b.id === 'ng-etab-knowledge') ||
        (!isKnowledge && b.id === 'ng-etab-network'));
    });
    // 3. Sync top tab bar highlights
    document.querySelectorAll('.ng-tab').forEach(function(b) {
      b.classList.toggle('on', b && b.id === 'ng-tab-' + mode);
    });
    // 4. Call original (handles canvas swap, KexSVG init, etc.)
    _orig(mode, btn);
  };
  window.ngSwitchMode._ge_patched = true;
}

// ── New edge types injected after ngBuildGraph ───────────────────────────────
function _injectNewEdgeTypes(nodes, edges) {
  if (!nodes || !edges) return;

  var newsNodes = nodes.filter(function(n){ return n.type === 'news'; });
  var causalKW  = ['sanction','retaliat','trigger','consequence','following','caused','impact','after','amid','response','due to'];
  var paired    = new Set();

  // Causal: same country + causal keyword in either title
  for (var i = 0; i < newsNodes.length; i++) {
    for (var j = i+1; j < newsNodes.length; j++) {
      var a = newsNodes[i], b = newsNodes[j];
      var k = a.id + '|' + b.id;
      if (paired.has(k)) continue;
      var cc = a.countryCode && b.countryCode && a.countryCode === b.countryCode;
      var at = (a.title || '').toLowerCase(), bt = (b.title || '').toLowerCase();
      var hasCausal = causalKW.some(function(kw){ return at.indexOf(kw) > -1 || bt.indexOf(kw) > -1; });
      if (cc && hasCausal) {
        edges.push({ src: a.id, tgt: b.id, type: 'causal', weight: 0.55 });
        paired.add(k);
      }
    }
  }

  // Temporal: same category, within 2h
  var byCat = {};
  newsNodes.forEach(function(n){
    var c = n.category || 'X';
    if (!byCat[c]) byCat[c] = [];
    byCat[c].push(n);
  });
  Object.values(byCat).forEach(function(grp){
    if (grp.length < 2) return;
    grp.sort(function(a,b){ return new Date(a.timestamp||0) - new Date(b.timestamp||0); });
    for (var i = 0; i < grp.length-1; i++) {
      var diff = Math.abs(new Date(grp[i+1].timestamp||0) - new Date(grp[i].timestamp||0)) / 3600000;
      if (diff <= 2) edges.push({ src: grp[i].id, tgt: grp[i+1].id, type: 'temporal', weight: 0.4 });
    }
  });
}

function _patchBuildGraph() {
  if (!window.ngBuildGraph || window.ngBuildGraph._ge_patched) return;
  var _orig = window.ngBuildGraph;
  window.ngBuildGraph = function(events, opts) {
    var r = _orig(events, opts);
    _injectNewEdgeTypes(r.nodes, r.edges);
    return r;
  };
  window.ngBuildGraph._ge_patched = true;
}

// ── Patch ngShowDetail: track selected node, show Explore button ─────────────
function _patchShowDetail() {
  if (!window.ngShowDetail || window.ngShowDetail._ge_patched) return;
  var _orig = window.ngShowDetail;
  window.ngShowDetail = function(n) {
    _selectedNode = n;
    _orig(n);
    var xBtn     = document.getElementById('ng-detail-explore-btn');
    var bridgeBtn= document.getElementById('ng-bridge-btn');
    var canExp   = n && n.label && n.label.trim().length > 1;
    if (xBtn)      { xBtn.style.display = canExp ? 'inline-block' : 'none'; }
    if (bridgeBtn) { bridgeBtn.disabled = !canExp; bridgeBtn.style.opacity = canExp ? '1' : '0.5'; }
  };
  window.ngShowDetail._ge_patched = true;
}

// ── Extend NG flags for new edge types ───────────────────────────────────────
function _extendNG() {
  if (typeof NG_EDGE_COLORS !== 'undefined') {
    NG_EDGE_COLORS.causal   = NG_EDGE_COLORS.causal   || 'rgba(239,68,68,0.55)';
    NG_EDGE_COLORS.temporal = NG_EDGE_COLORS.temporal || 'rgba(139,92,246,0.5)';
  }
  if (typeof NG !== 'undefined') {
    NG.showCausal   = true;
    NG.showTemporal = true;
  }
}

// ── Cross-engine: News node → KEX ────────────────────────────────────────────
window.ngExploreNode = function() {
  if (!_selectedNode || !_selectedNode.label) return;
  var label = _selectedNode.label.trim();
  ngSwitchEngine('knowledge', document.getElementById('ng-etab-knowledge'));
  setTimeout(function() {
    if (typeof kexSearchTerm === 'function') kexSearchTerm(label);
    else {
      var inp = document.getElementById('kex-search-inp');
      if (inp) { inp.value = label; kexSearch && kexSearch(); }
    }
  }, 200);
};

// ── Cross-engine: KEX → NG ────────────────────────────────────────────────────
window.kexBridgeToNetwork = function() {
  var q = (document.getElementById('kex-search-inp') || {}).value || '';
  if (!q.trim()) { toast && toast('Enter a topic first', 'e', 2000); return; }
  ngSwitchEngine('network', document.getElementById('ng-etab-network'));
  setTimeout(function() {
    var s = document.getElementById('ng-search-inp');
    if (s) s.value = q.trim();
    if (typeof ngBuild === 'function') {
      ngBuild().then(function() {
        setTimeout(function() { if (typeof ngSearchNodes === 'function') ngSearchNodes(q.trim()); }, 500);
      });
    }
  }, 200);
};

// ── KEX query label + breadcrumb sync ────────────────────────────────────────
function _patchKexSearch() {
  if (!window.kexSearchTerm || window.kexSearchTerm._ge_patched) return;
  var _orig = window.kexSearchTerm;
  window.kexSearchTerm = function(term) {
    var ql  = document.getElementById('kex-query-label');
    var qlt = document.getElementById('kex-breadcrumb-top');
    if (ql)  ql.textContent  = term;
    if (qlt) qlt.textContent = '';
    return _orig(term);
  };
  window.kexSearchTerm._ge_patched = true;
}

// ── Edge type checkbox sync → NG flags ───────────────────────────────────────
function _bindEdgeToggles() {
  var map = {
    'ng-show-mentions':  'showMentions',
    'ng-show-cooc':      'showCooc',
    'ng-show-similarity':'showSimilarity',
    'ng-show-causal':    'showCausal',
    'ng-show-temporal':  'showTemporal',
  };
  Object.keys(map).forEach(function(cbId) {
    var cb = document.getElementById(cbId);
    if (!cb) return;
    cb.addEventListener('change', function() {
      if (typeof NG !== 'undefined') NG[map[cbId]] = cb.checked;
      if (typeof ngRedraw === 'function') ngRedraw();
    });
  });
}

// ── Run all patches after all scripts are loaded ─────────────────────────────
function _boot() {
  _extendNG();
  _patchSwitchMode();
  _patchBuildGraph();
  _patchShowDetail();
  _patchKexSearch();
  _bindEdgeToggles();
  // Show the bridge section always
  var bridgeSec = document.getElementById('ng-bridge-section');
  if (bridgeSec) bridgeSec.style.display = 'block';
}

// Run on DOMContentLoaded + small delay to ensure all scripts have executed
document.addEventListener('DOMContentLoaded', function() {
  setTimeout(_boot, 600);
  // Fallback: re-run at 1.5s if scripts are slow
  setTimeout(function() {
    if (!window.ngSwitchMode || !window.ngSwitchMode._ge_patched) _boot();
  }, 1500);
});

})();

/* ═══════════ 09_historical_events.js ═══════════ */
/**
 * @file 09_historical_events.js
 * @module WorldLens/Historical Events Chart Overlay
 *
 * @description
 * Overlays real WorldLens events onto the price chart timeline.
 * Animated markers with category colours, hover tooltips showing 1d/5d
 * market reaction. Expandable event cards below chart.
 * Cluster grouping for dense periods.
 *
 * @dependencies 01_globals.js, 02_core.js, 05_markets.js
 * @exports toggleHistoricalEvents, loadHistoricalEvents, renderEventOverlay, renderEventTimeline, buildEventCard, buildClusterCard, clearEventOverlay
 */


// HOOK: keep toggleHeatmap working for backward compat
// ════════════════════════════════════════════════════════

function toggleHeatmap() {
  var btn = document.getElementById('mtool-heatmap');
  setMapMode(G_MAP_MODE === 'heatmap' ? 'events' : 'heatmap', btn);
}

// ════════════════════════════════════════════════════════
// HOOK openEP: auto-load enrichment data
// ════════════════════════════════════════════════════════

var _openEP_orig = openEP;
openEP = function(id) {
  _openEP_orig(id);

  // Reset sub-panels
  var relEl = document.getElementById('ep-related');
  var nerEl = document.getElementById('ep-ner');
  if (relEl) relEl.style.display = 'none';
  if (nerEl) nerEl.style.display = 'none';

  // Auto-render sentiment if already cached on event
  var ev = G.events.find(function(e){return e.id===id;});
  if (ev && ev.sentiment_tone) {
    setTimeout(function() {
      runSentiment();
      // Update stress meter if open
      if (G_STRESS_ON) updateStressMeter();
    }, 50);
  }
};
// ════════════════════════════════════════════════════════
// HISTORICAL EVENTS OVERLAY ENGINE
// Transforms price charts into narrative tools.
// Shows real WorldLens events overlaid on ticker price history.
// ════════════════════════════════════════════════════════

var HEV = {
  on:           false,          // overlay active?
  loading:      false,
  data:         null,           // full API response
  filtered:     [],             // events after category filter
  activeFilter: 'ALL',         // current category filter
  activeFilters: {},            // {CAT: true/false}
  chartPad:     { top:10, right:8, bottom:22, left:48 }, // mirrors drawQuantChart
  hoveredMarker: null,
  priceCanvas:  null,
  overlayCanvas: null,
};

// Category colour map (mirrors backend _CAT_STYLE)
var HEV_CATS = {
  CONFLICT:     { icon:'⚔',  color:'#EF4444', label:'Conflict'     },
  ECONOMICS:    { icon:'📊',  color:'#10B981', label:'Economics'    },
  FINANCE:      { icon:'💹',  color:'#06B6D4', label:'Finance'      },
  GEOPOLITICS:  { icon:'🌐',  color:'#3B82F6', label:'Geopolitics'  },
  POLITICS:     { icon:'🏛',  color:'#6366F1', label:'Politics'     },
  ENERGY:       { icon:'⚡',  color:'#F59E0B', label:'Energy'       },
  HEALTH:       { icon:'🏥',  color:'#EC4899', label:'Health'       },
  DISASTER:     { icon:'🌪',  color:'#F97316', label:'Disaster'     },
  EARTHQUAKE:   { icon:'⚡',  color:'#EAB308', label:'Earthquake'   },
  TECHNOLOGY:   { icon:'💻',  color:'#8B5CF6', label:'Technology'   },
  HUMANITARIAN: { icon:'🚨',  color:'#F97316', label:'Humanitarian' },
  SECURITY:     { icon:'🔒',  color:'#DC2626', label:'Security'     },
};

// ── Toggle ────────────────────────────────────────────

function toggleHistoricalEvents() {
  HEV.on = !HEV.on;
  var btn = el('hev-toggle-btn');
  var lbl = el('hev-toggle-label');
  var sec = el('hev-section');
  if (btn) btn.classList.toggle('on', HEV.on);
  if (lbl) lbl.textContent = HEV.on ? 'Hide Events' : 'Show Events';
  if (sec) sec.style.display = HEV.on ? 'block' : 'none';

  if (HEV.on) {
    if (!HEV.data || HEV._symbol !== MKT.symbol || HEV._tf !== MKT.chartTF) {
      loadHistoricalEvents();
    } else {
      renderEventOverlay();
      renderEventTimeline();
    }
  } else {
    clearEventOverlay();
  }
}

// ── Load from API ─────────────────────────────────────

async function loadHistoricalEvents() {
  if (!MKT.symbol) return;
  HEV.loading  = true;
  HEV._symbol  = MKT.symbol;
  HEV._tf      = MKT.chartTF;

  // Show loading, hide timeline
  var loadEl = el('hev-loading');
  var tl     = el('hev-timeline');
  var hint   = el('hev-scroll-hint');
  var stats  = el('hev-stats');
  if (loadEl) loadEl.style.display = 'flex';
  if (tl)     tl.innerHTML = '';
  if (hint)   hint.style.display = 'none';
  if (stats)  stats.style.display = 'none';

  var period = MKT.chartTF === '1M' ? '3mo' : MKT.chartTF === '3M' ? '6mo' : '1y';
  var minSev = 4.5;

  var r = await rq('/api/markets/historical-events/' + encodeURIComponent(MKT.symbol)
                   + '?period=' + period + '&min_severity=' + minSev + '&max_events=60');

  HEV.loading = false;
  if (loadEl) loadEl.style.display = 'none';

  if (!r || r.error || !r.events) {
    if (tl) tl.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:8px 0">'
      + (r && r.error ? r.error : 'No historical events found for this asset and timeframe.') + '</div>';
    return;
  }

  HEV.data      = r;
  HEV.filtered  = r.events;
  HEV.activeFilter = 'ALL';

  // Build category filter pills from events present
  buildCategoryFilters(r.events);

  // Stats summary
  renderHevStats(r.events);

  // Overlay on price chart
  renderEventOverlay();

  // Timeline cards
  renderEventTimeline();

  // Scroll hint
  if (hint && r.events.length > 4) hint.style.display = 'flex';
}

// ── Category filter ───────────────────────────────────

function buildCategoryFilters(events) {
  var filterBar = el('hev-filter-bar');
  if (!filterBar) return;

  // Count categories
  var catCounts = {};
  events.forEach(function(ev) {
    var c = ev.category;
    catCounts[c] = (catCounts[c] || 0) + (ev.cluster_count || 1);
  });

  // Keep only "All" pill + dynamic ones
  var allPill = filterBar.querySelector('[data-cat="ALL"]');
  filterBar.innerHTML = '';
  if (allPill) filterBar.appendChild(allPill);
  else {
    var ap = document.createElement('span');
    ap.className = 'hev-cat-pill on';
    ap.dataset.cat = 'ALL';
    ap.style.cssText = 'background:rgba(148,163,184,.15);color:var(--t2);border-color:rgba(148,163,184,.3)';
    ap.textContent = 'All';
    ap.onclick = function() { setHevFilter('ALL', this); };
    filterBar.appendChild(ap);
  }

  // Label
  var lbl = document.createElement('span');
  lbl.style.cssText = 'font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;margin-right:4px';
  lbl.textContent = 'Filter';
  filterBar.insertBefore(lbl, filterBar.firstChild);

  Object.entries(catCounts)
    .sort(function(a, b) { return b[1] - a[1]; })
    .forEach(function(entry) {
      var cat   = entry[0];
      var count = entry[1];
      var style = HEV_CATS[cat] || { icon:'📌', color:'#94A3B8', label: cat };
      var pill  = document.createElement('span');
      pill.className  = 'hev-cat-pill';
      pill.dataset.cat = cat;
      pill.style.cssText = 'background:' + style.color + '18;color:' + style.color
        + ';border-color:' + style.color + '44';
      pill.innerHTML  = style.icon + ' ' + style.label + ' <span style="opacity:.6">(' + count + ')</span>';
      pill.onclick    = function() { setHevFilter(cat, this); };
      filterBar.appendChild(pill);
    });
}

function setHevFilter(cat, btn) {
  HEV.activeFilter = cat;
  document.querySelectorAll('.hev-cat-pill').forEach(function(p) {
    p.classList.remove('on');
  });
  if (btn) btn.classList.add('on');

  if (!HEV.data) return;
  HEV.filtered = cat === 'ALL'
    ? HEV.data.events
    : HEV.data.events.filter(function(ev) { return ev.category === cat; });

  renderEventOverlay();
  renderEventTimeline();
}

// ── Stats row ─────────────────────────────────────────

function renderHevStats(events) {
  var statsEl = el('hev-stats');
  if (!statsEl) return;

  var n = events.reduce(function(acc, ev) { return acc + (ev.cluster_count || 1); }, 0);

  // Compute average 5-day return after events with reaction data
  var rets = events.filter(function(ev) { return ev.ret_5d != null; }).map(function(ev) { return ev.ret_5d; });
  var avgRet = rets.length ? rets.reduce(function(a,b){return a+b;},0)/rets.length : null;

  // Highest market stress
  var maxStress = Math.max.apply(null, events.map(function(ev){ return ev.market_stress || 0; }));

  statsEl.style.display = 'flex';
  statsEl.innerHTML = [
    { val: n, lbl: 'Events found', color: 'var(--b4)' },
    avgRet != null
      ? { val: (avgRet >= 0 ? '+' : '') + avgRet.toFixed(1) + '%', lbl: 'Avg 5d reaction', color: avgRet >= 0 ? 'var(--gr)' : 'var(--re)' }
      : null,
    maxStress > 0.3
      ? { val: Math.round(maxStress * 100) + '%', lbl: 'Peak stress', color: maxStress > 0.6 ? 'var(--re)' : 'var(--am)' }
      : null,
    { val: events.filter(function(ev) { return ev.impact === 'High'; }).length, lbl: 'High impact', color: 'var(--re)' },
  ].filter(Boolean).map(function(s) {
    return '<div class="hev-stat">'
      + '<div class="hev-stat-val" style="color:' + s.color + '">' + s.val + '</div>'
      + '<div class="hev-stat-lbl">' + s.lbl + '</div></div>';
  }).join('');
}

// ── Chart overlay (markers on price canvas) ───────────

function renderEventOverlay() {
  var priceCanvas   = el('mkt-price-chart');
  var overlayCanvas = el('hev-overlay-canvas');
  if (!priceCanvas || !overlayCanvas) return;

  // Sync overlay dimensions to price canvas
  var W = priceCanvas.width  || priceCanvas.offsetWidth  || 600;
  var H = priceCanvas.height || 220;
  overlayCanvas.width  = W;
  overlayCanvas.height = H;
  overlayCanvas.style.width  = priceCanvas.style.width  || '100%';
  overlayCanvas.style.height = priceCanvas.style.height || '220px';

  var ctx = overlayCanvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  if (!HEV.on || !HEV.data || !HEV.filtered.length) return;

  var prices = getChartPrices(MKT.chartData, MKT.chartTF);
  var n = prices.length;
  if (n < 2) return;

  var pad = { top: 10, right: 8, bottom: 22, left: 48 };
  var cW = W - pad.left - pad.right;

  // Map event_idx → x position
  // event_idx is the index in the FULL price array; we need to map to the sliced view
  var fullLen   = MKT.chartData.length;
  var sliceStart = fullLen - n;   // first index of visible window

  HEV.filtered.forEach(function(ev) {
    var evIdx = ev.event_idx;
    if (evIdx == null || evIdx < 0) return;

    // Remap to visible slice
    var visIdx = evIdx - sliceStart;
    if (visIdx < 0 || visIdx >= n) return;

    var x = pad.left + (visIdx / (n - 1)) * cW;

    // Price at event (find min/max for y)
    var minV = Math.min.apply(null, prices);
    var maxV = Math.max.apply(null, prices);
    var range = maxV - minV || 1;
    var cH   = H - pad.top - pad.bottom;

    var style = HEV_CATS[ev.category] || { icon: '📌', color: '#94A3B8' };
    var col   = ev.color || style.color;

    // Vertical stem from bottom of chart area to marker
    var stemBottom = pad.top + cH;
    var stemTop    = pad.top + 6;
    ctx.strokeStyle = col + '44';
    ctx.lineWidth   = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(x, stemTop);
    ctx.lineTo(x, stemBottom);
    ctx.stroke();
    ctx.setLineDash([]);

    // Circle marker at top
    var isHovered = HEV.hoveredMarker && HEV.hoveredMarker.id === ev.id;
    var r = isHovered ? 8 : 5;

    ctx.beginPath();
    ctx.arc(x, pad.top + 4, r, 0, Math.PI * 2);
    ctx.fillStyle = col + (isHovered ? 'ee' : '99');
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1.5;
    ctx.stroke();

    // Category icon (small)
    ctx.font         = (isHovered ? 10 : 8) + 'px sans-serif';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ev.icon || style.icon, x, pad.top + 4);

    // 5d reaction label on hover
    if (isHovered && ev.ret_5d != null) {
      var retLabel = (ev.ret_5d >= 0 ? '+' : '') + ev.ret_5d.toFixed(1) + '% (5d)';
      var retCol   = ev.ret_5d >= 0 ? '#10B981' : '#EF4444';
      ctx.font      = 'bold 9px sans-serif';
      ctx.fillStyle = retCol;
      ctx.textAlign = x > W * 0.8 ? 'right' : 'left';
      ctx.fillText(retLabel, x + (x > W * 0.8 ? -12 : 12), pad.top + 4);
    }
  });

  // Store marker positions for mouse interaction
  HEV._markerPositions = HEV.filtered.map(function(ev) {
    var evIdx  = ev.event_idx;
    if (evIdx == null) return null;
    var visIdx = evIdx - sliceStart;
    if (visIdx < 0 || visIdx >= n) return null;
    var x = pad.left + (visIdx / (n - 1)) * cW;
    return { ev: ev, x: x, y: pad.top + 4 };
  }).filter(Boolean);

  // Attach mouse events (once)
  if (!overlayCanvas._hevBound) {
    overlayCanvas._hevBound = true;
    overlayCanvas.style.pointerEvents = 'auto';
    overlayCanvas.addEventListener('mousemove', hevOnMouseMove);
    overlayCanvas.addEventListener('mouseleave', hevOnMouseLeave);
    overlayCanvas.addEventListener('click', hevOnClick);
  }
}

function hevOnMouseMove(e) {
  var rect    = e.currentTarget.getBoundingClientRect();
  var mx      = e.clientX - rect.left;
  var my      = e.clientY - rect.top;
  var markers = HEV._markerPositions || [];
  var found   = null;
  var RADIUS  = 14;

  for (var i = 0; i < markers.length; i++) {
    var m = markers[i];
    var dx = mx - m.x, dy = my - m.y;
    if (Math.sqrt(dx*dx + dy*dy) < RADIUS) { found = m; break; }
  }

  HEV.hoveredMarker = found ? found.ev : null;
  renderEventOverlay();    // redraw with hover highlight

  // Tooltip
  var tooltip = el('hev-marker-tooltip');
  if (!tooltip) return;
  if (found) {
    tooltip.style.display = 'block';
    // Position tooltip
    var W = e.currentTarget.width;
    var left = mx + 14;
    if (left + 230 > W) left = mx - 230;
    tooltip.style.left = left + 'px';
    tooltip.style.top  = Math.max(0, my - 20) + 'px';
    tooltip.innerHTML  = hevTooltipHtml(found.ev);
  } else {
    tooltip.style.display = 'none';
  }
}

function hevOnMouseLeave() {
  HEV.hoveredMarker = null;
  renderEventOverlay();
  var t = el('hev-marker-tooltip');
  if (t) t.style.display = 'none';
}

function hevOnClick(e) {
  if (HEV.hoveredMarker) {
    // Highlight the matching card in the timeline
    var cardId = 'hev-card-' + HEV.hoveredMarker.id;
    var card   = el(cardId);
    if (card) {
      card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      card.classList.add('expanded');
      setTimeout(function() { card.classList.remove('expanded'); }, 3000);
    }
  }
}

function hevTooltipHtml(ev) {
  var style = HEV_CATS[ev.category] || { icon: '📌', color: '#94A3B8', label: ev.category };
  var col   = ev.color || style.color;
  var ret1  = ev.ret_1d != null ? '<span style="color:' + (ev.ret_1d>=0?'#10B981':'#EF4444') + '">' + (ev.ret_1d>=0?'+':'') + ev.ret_1d.toFixed(2) + '%</span>' : '—';
  var ret5  = ev.ret_5d != null ? '<span style="color:' + (ev.ret_5d>=0?'#10B981':'#EF4444') + '">' + (ev.ret_5d>=0?'+':'') + ev.ret_5d.toFixed(2) + '%</span>' : '—';
  var volS  = ev.vol_spike != null && Math.abs(ev.vol_spike) > 10
    ? '<div style="margin-top:4px;font-size:9px;color:var(--am)">⚡ Vol spike ' + (ev.vol_spike>0?'+':'') + ev.vol_spike.toFixed(0) + '%</div>' : '';

  return '<div style="border-top:2px solid ' + col + ';padding-top:5px">'
    + '<div style="font-size:9px;color:' + col + ';text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px">'
    + (ev.icon||style.icon) + ' ' + (ev.cat_label||style.label) + ' · ' + ev.date + '</div>'
    + '<div style="font-size:11px;font-weight:600;color:var(--t1);line-height:1.4;margin-bottom:5px">' + ev.title + '</div>'
    + '<div style="display:flex;gap:10px;font-size:10px">'
    + '<div>1d <br>' + ret1 + '</div>'
    + '<div>5d <br>' + ret5 + '</div>'
    + (ev.severity ? '<div>Sev<br><span style="color:' + (ev.severity>=7?'#EF4444':ev.severity>=5?'#F59E0B':'#94A3B8') + '">' + ev.severity.toFixed(1) + '</span></div>' : '')
    + '</div>'
    + volS
    + '</div>';
}

// ── Timeline cards ────────────────────────────────────

function renderEventTimeline() {
  var tl = el('hev-timeline');
  if (!tl) return;
  tl.innerHTML = '';

  var events = HEV.filtered;
  if (!events || !events.length) {
    tl.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:8px 0">No events match the current filter.</div>';
    return;
  }

  events.forEach(function(ev) {
    var card = ev.cluster_count > 1
      ? buildClusterCard(ev)
      : buildEventCard(ev);
    tl.appendChild(card);
  });
}

function buildEventCard(ev) {
  var style = HEV_CATS[ev.category] || { icon: '📌', color: '#94A3B8', label: ev.category };
  var col   = ev.color || style.color;
  var ret1  = ev.ret_1d;
  var ret5  = ev.ret_5d;
  var volSp = ev.vol_spike;

  // Reaction html
  var reactionHtml = '';
  if (ret1 != null || ret5 != null) {
    reactionHtml = '<div class="hev-card-reaction">';
    if (ret1 != null) reactionHtml += '<div class="hev-react-cell"><div class="hev-react-label">1-day</div>'
      + '<div class="hev-react-val" style="color:' + (ret1>=0?'#10B981':'#EF4444') + '">'
      + (ret1>=0?'+':'') + ret1.toFixed(2) + '%</div></div>';
    if (ev.ret_2d != null) reactionHtml += '<div class="hev-react-cell"><div class="hev-react-label">2-day</div>'
      + '<div class="hev-react-val" style="color:' + (ev.ret_2d>=0?'#10B981':'#EF4444') + '">'
      + (ev.ret_2d>=0?'+':'') + ev.ret_2d.toFixed(2) + '%</div></div>';
    if (ret5 != null) reactionHtml += '<div class="hev-react-cell"><div class="hev-react-label">5-day</div>'
      + '<div class="hev-react-val" style="color:' + (ret5>=0?'#10B981':'#EF4444') + '">'
      + (ret5>=0?'+':'') + ret5.toFixed(2) + '%</div></div>';
    reactionHtml += '</div>';
  }

  var volHtml = volSp != null && Math.abs(volSp) > 15
    ? '<div class="hev-vol-badge">⚡ Vol ' + (volSp>0?'+':'') + volSp.toFixed(0) + '% post-event</div>' : '';

  var summaryText = ev.summary || ev.market_note || '';
  if (summaryText.length > 200) summaryText = summaryText.slice(0, 200) + '…';

  var div = document.createElement('div');
  div.className   = 'hev-card';
  div.id          = 'hev-card-' + ev.id;
  div.style.cssText = '--hev-color:' + col;
  div.innerHTML   =
    '<div class="hev-card-head">'
    + '<span class="hev-card-icon">' + (ev.icon || style.icon) + '</span>'
    + '<div style="flex:1;min-width:0">'
    + '<div class="hev-card-date">' + ev.date + '</div>'
    + '<div class="hev-card-cat" style="color:' + col + '">' + (ev.cat_label || style.label) + '</div>'
    + '</div>'
    + (ev.impact === 'High' ? '<span style="font-size:7px;background:rgba(239,68,68,.2);color:#FCA5A5;padding:1px 5px;border-radius:100px;flex-shrink:0">HIGH</span>' : '')
    + '</div>'
    + '<div class="hev-card-title">' + ev.title + '</div>'
    + '<div class="hev-card-body">'
    + (summaryText ? '<div class="hev-card-summary">' + summaryText + '</div>' : '')
    + reactionHtml
    + volHtml
    + (ev.country ? '<div style="font-size:9px;color:var(--t3);margin-top:5px">📍 ' + ev.country + '</div>' : '')
    + '</div>';

  // Hover: sync with chart overlay
  div.addEventListener('mouseenter', function() {
    HEV.hoveredMarker = ev;
    renderEventOverlay();
  });
  div.addEventListener('mouseleave', function() {
    HEV.hoveredMarker = null;
    renderEventOverlay();
  });

  return div;
}

function buildClusterCard(cluster) {
  var members = cluster.cluster_members || [cluster];
  var col     = cluster.color || '#94A3B8';
  var count   = cluster.cluster_count || members.length;

  // Collect unique categories
  var cats = [...new Set(members.map(function(e){ return e.category; }))];
  var dotsHtml = cats.slice(0, 4).map(function(c) {
    var s = HEV_CATS[c] || { color: '#94A3B8' };
    return '<div class="hev-cluster-dot" style="background:' + s.color + '"></div>';
  }).join('');

  var div = document.createElement('div');
  div.className   = 'hev-card hev-card-cluster';
  div.style.cssText = '--hev-color:' + col;
  div.title       = count + ' events near ' + cluster.date;

  div.innerHTML =
    '<div class="hev-cluster-count">' + count + '</div>'
    + '<div class="hev-cluster-label">events</div>'
    + '<div class="hev-cluster-dots">' + dotsHtml + '</div>';

  // Click: expand cluster into individual cards inline
  div.addEventListener('click', function() {
    var frag = document.createDocumentFragment();
    members.forEach(function(m) { frag.appendChild(buildEventCard(m)); });
    div.parentNode.insertBefore(frag, div.nextSibling);
    div.remove();
  });

  return div;
}

// ── Cleanup ───────────────────────────────────────────

function clearEventOverlay() {
  var ov = el('hev-overlay-canvas');
  if (ov) ov.getContext('2d').clearRect(0, 0, ov.width, ov.height);
  var tooltip = el('hev-marker-tooltip');
  if (tooltip) tooltip.style.display = 'none';
  HEV.hoveredMarker = null;
}

// ── Hook into setMktTF to reload events on TF change ──

var _setMktTF_orig = setMktTF;
setMktTF = function(tf, btn) {
  _setMktTF_orig(tf, btn);
  if (HEV.on) {
    // Re-fetch events for new timeframe (slight delay to let chart redraw)
    HEV.data = null;
    setTimeout(function() { loadHistoricalEvents(); }, 150);
  }
};

// ── Hook into selectMktAsset to reset overlay ─────────

var _selectMktAsset_orig = selectMktAsset;
selectMktAsset = async function(symbol, name) {
  // Reset overlay state for new asset
  HEV.on     = false;
  HEV.data   = null;
  HEV.filtered = [];
  var btn = el('hev-toggle-btn');
  var lbl = el('hev-toggle-label');
  var sec = el('hev-section');
  if (btn) btn.classList.remove('on');
  if (lbl) lbl.textContent = 'Show Events';
  if (sec) sec.style.display = 'none';
  clearEventOverlay();
  return await _selectMktAsset_orig(symbol, name);
};


/* ══════════════════════════════════════════════════════════════
   ADMIN — Brain Manager panel
   ══════════════════════════════════════════════════════════════ */

// Register brain loader in admNav
(function() {
  var _origAdmNav = typeof admNav === 'function' ? admNav : null;
  if (!_origAdmNav) return;
  window.admNav = function(panel, btn) {
    _origAdmNav(panel, btn);
    if (panel === 'brain') loadAdmBrain();
  };
})();

var _admBrainChart = null;

function loadAdmBrain() {
  var kpis   = document.getElementById('adm-brain-kpis');
  var body   = document.getElementById('adm-brain-users-body');
  if (kpis) kpis.innerHTML = '<div style="color:var(--t3);font-size:11px">Loading…</div>';

  rq('/api/brain/admin/stats').then(function(r) {
    if (!r || r.detail) {
      if (kpis) kpis.innerHTML = '<div style="color:var(--re)">Failed to load brain stats</div>';
      return;
    }

    // KPIs
    var levels = function(n) {
      if (n < 20)   return '🌱 Seed';
      if (n < 100)  return '🌿 Growing';
      if (n < 500)  return '🧠 Active';
      if (n < 2000) return '⚡ Advanced';
      return '🔥 Expert';
    };
    if (kpis) {
      kpis.innerHTML = [
        { label: 'Total Brain Entries', val: (r.total_entries || 0).toLocaleString() },
        { label: 'Users with Brain',    val: (r.by_user || []).length },
        { label: 'Most active user',    val: (r.by_user[0] && r.by_user[0].username) || '—' },
        { label: 'Brain level (global)',val: levels(r.total_entries || 0) },
      ].map(function(k) {
        return '<div class="adm-kpi"><div class="adm-kpi-val">' + k.val +
               '</div><div class="adm-kpi-lbl">' + k.label + '</div></div>';
      }).join('');
    }

    // Growth chart
    var growth = r.growth || [];
    if (growth.length && document.getElementById('adm-brain-chart')) {
      if (_admBrainChart) { _admBrainChart.destroy(); _admBrainChart = null; }
      var ctx = document.getElementById('adm-brain-chart').getContext('2d');
      _admBrainChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: growth.map(function(d) { return d.day.slice(5); }),
          datasets: [{ data: growth.map(function(d) { return d.n; }),
            backgroundColor: 'rgba(139,92,246,.35)', borderColor: '#7C3AED',
            borderWidth: 1, borderRadius: 3 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } },
          scales: { x: { grid: { display: false }, ticks: { font: { size: 9 }, color: 'var(--t3)' } },
                    y: { grid: { color: 'rgba(255,255,255,.05)' }, ticks: { font: { size: 9 }, color: 'var(--t3)' } } }
        }
      });
    }

    // Sources
    var srcEl = document.getElementById('adm-brain-sources');
    if (srcEl) {
      var srcColors = { event: '#F59E0B', analysis: '#7C3AED', ew: '#EF4444',
        interaction: '#3B82F6', market: '#10B981', watchlist: '#06B6D4',
        alert: '#EC4899', question: '#8B5CF6', admin_inject: '#F97316' };
      var total = (r.by_source || []).reduce(function(s, x) { return s + x.n; }, 0) || 1;
      srcEl.innerHTML = (r.by_source || []).slice(0, 7).map(function(s) {
        var pct = Math.round(s.n / total * 100);
        var col = srcColors[s.source] || '#8A94A6';
        return '<div style="font-size:10px"><div style="display:flex;justify-content:space-between;margin-bottom:2px">' +
          '<span style="color:var(--t2)">' + s.source + '</span>' +
          '<span style="color:var(--t3)">' + s.n + '</span></div>' +
          '<div style="height:4px;background:var(--bg3);border-radius:2px"><div style="height:100%;width:' + pct + '%;background:' + col + ';border-radius:2px"></div></div></div>';
      }).join('');
    }

    // Topics
    var topEl = document.getElementById('adm-brain-topics');
    if (topEl) {
      var topColors = { finance: '#10B981', macro: '#3B82F6', security: '#EF4444',
        tech: '#8B5CF6', energy: '#F59E0B', politics: '#EC4899', geopolitics: '#F97316', trade: '#06B6D4' };
      var totalT = (r.by_topic || []).reduce(function(s, x) { return s + x.n; }, 0) || 1;
      topEl.innerHTML = (r.by_topic || []).slice(0, 7).map(function(t) {
        var pct = Math.round(t.n / totalT * 100);
        var col = topColors[t.topic] || '#8A94A6';
        return '<div style="font-size:10px"><div style="display:flex;justify-content:space-between;margin-bottom:2px">' +
          '<span style="color:var(--t2)">' + t.topic + '</span>' +
          '<span style="color:var(--t3)">' + t.n + '</span></div>' +
          '<div style="height:4px;background:var(--bg3);border-radius:2px"><div style="height:100%;width:' + pct + '%;background:' + col + ';border-radius:2px"></div></div></div>';
      }).join('');
    }

    // Users table
    if (body) {
      body.innerHTML = (r.by_user || []).map(function(u) {
        var lvl = u.entries < 20 ? '🌱' : u.entries < 100 ? '🌿' : u.entries < 500 ? '🧠' : u.entries < 2000 ? '⚡' : '🔥';
        var last = (u.last_active || '').slice(0, 10);
        return '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">' +
          '<td style="padding:7px 8px"><div style="font-weight:600;color:var(--t1)">' + (u.username || '?') + '</div>' +
          '<div style="font-size:10px;color:var(--t3)">' + (u.email || '') + '</div></td>' +
          '<td style="padding:7px 8px;text-align:right;color:var(--t2)">' + u.entries + '</td>' +
          '<td style="padding:7px 8px;text-align:right">' + lvl + '</td>' +
          '<td style="padding:7px 8px;text-align:right;color:var(--t3);font-size:10px">' + last + '</td>' +
          '<td style="padding:7px 8px">' +
          '<button class="adm-btn" onclick="admBrainViewUser(' + u.user_id + ',\'' + (u.username || '?') + '\')" style="font-size:10px;padding:3px 8px">View</button> ' +
          '<button class="adm-btn adm-btn-danger" onclick="admBrainResetUser(' + u.user_id + ',\'' + (u.username || '?') + '\')" style="font-size:10px;padding:3px 8px">Reset</button>' +
          '</td></tr>';
      }).join('') || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--t3)">No brain data yet</td></tr>';
    }
  });
}

function admBrainInjectModal() {
  var mc = document.getElementById('modal-container');
  if (!mc) mc = document.body;
  var overlay = document.createElement('div');
  overlay.className = 'modal-ov';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width:520px">' +
    '<div class="modal-hd"><h3 style="font-size:15px;font-weight:700;color:var(--t1)">🧠 Inject Global Knowledge</h3>' +
    '<button onclick="this.closest(\'.modal-ov\').remove()" style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer">✕</button></div>' +
    '<div class="modal-bd">' +
    '<p style="font-size:12px;color:var(--t3);margin-bottom:12px">This text will be added to ALL active users\' brains with high weight (2.0). Use for global market context, crisis briefings, or institutional knowledge.</p>' +
    '<div class="form-group"><label class="form-label">Content</label>' +
    '<textarea id="brain-inject-content" class="form-input light" placeholder="e.g. Fed raised rates 25bps in March 2025, signaling end of hiking cycle. Markets expect 2 cuts in 2026." style="min-height:120px;resize:vertical"></textarea></div>' +
    '<div class="form-group"><label class="form-label">Source label</label>' +
    '<input id="brain-inject-source" class="form-input light" value="admin_inject" placeholder="admin_inject"></div>' +
    '<div style="display:flex;gap:8px;margin-top:4px">' +
    '<button class="btn btn-s btn-bl" onclick="this.closest(\'.modal-ov\').remove()">Annulla</button>' +
    '<button class="btn btn-p btn-bl" onclick="admBrainDoInject(this)">Inject a tutti gli utenti</button>' +
    '</div></div></div>';
  document.body.appendChild(overlay);
}

function admBrainDoInject(btn) {
  var content = (document.getElementById('brain-inject-content') || {}).value || '';
  var source  = (document.getElementById('brain-inject-source') || {}).value || 'admin_inject';
  if (!content.trim()) return;
  if (btn) { btn.textContent = 'Injecting…'; btn.disabled = true; }
  rq('/api/brain/admin/inject', { method: 'POST', body: { content: content.trim(), source: source } })
    .then(function(r) {
      btn.closest('.modal-ov').remove();
      if (r && r.ok) {
        toast('Knowledge injected in ' + r.injected_to + ' users', 'i');
        loadAdmBrain();
      } else {
        toast('Injection failed', 'e');
      }
    });
}

function admBrainViewUser(uid, name) {
  rq('/api/brain/admin/user/' + uid + '/entries').then(function(r) {
    var entries = (r && r.entries) || [];
    var mc = document.createElement('div');
    mc.className = 'modal-ov';
    mc.onclick = function(e) { if (e.target === mc) mc.remove(); };
    mc.innerHTML = '<div class="modal modal-lg" onclick="event.stopPropagation()" style="max-width:600px">' +
      '<div class="modal-hd"><h3 style="font-size:15px;font-weight:700;color:var(--t1)">🧠 Brain: ' + name + ' (' + entries.length + ' entries)</h3>' +
      '<button onclick="this.closest(\'.modal-ov\').remove()" style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer">✕</button></div>' +
      '<div class="modal-bd" style="max-height:70vh;overflow-y:auto">' +
      (entries.length ? entries.map(function(e) {
        return '<div style="padding:8px;background:var(--bg2);border-radius:8px;margin-bottom:6px">' +
          '<div style="display:flex;gap:6px;margin-bottom:4px">' +
          '<span style="font-size:10px;padding:1px 6px;border-radius:20px;background:rgba(59,130,246,.15);color:#60A5FA">' + e.source + '</span>' +
          '<span style="font-size:10px;padding:1px 6px;border-radius:20px;background:rgba(16,185,129,.15);color:#34D399">' + e.topic + '</span>' +
          '<span style="font-size:9px;color:var(--t3);margin-left:auto">' + (e.timestamp || '').slice(0, 16) + '</span></div>' +
          '<div style="font-size:12px;color:var(--t2);line-height:1.5">' + e.content.slice(0, 300) + '</div></div>';
      }).join('') : '<div style="text-align:center;padding:32px;color:var(--t3)">No entries yet</div>') +
      '</div></div>';
    document.body.appendChild(mc);
  });
}

function admBrainResetUser(uid, name) {
  if (!confirm('Reset brain for ' + name + '? This cannot be undone.')) return;
  rq('/api/brain/admin/user/' + uid, { method: 'DELETE' }).then(function(r) {
    if (r && r.ok) { toast('Brain reset for ' + name, 'i'); loadAdmBrain(); }
    else toast('Reset failed', 'e');
  });
}

/* Profile page — brain search modal */
window.openBrainSearch = function() {
  var mc = document.createElement('div');
  mc.className = 'modal-ov';
  mc.onclick = function(e) { if (e.target === mc) mc.remove(); };
  mc.innerHTML = '<div class="modal" onclick="event.stopPropagation()" style="max-width:500px">' +
    '<div class="modal-hd"><h3 style="font-size:15px;font-weight:700">🔍 Cerca nel tuo Cervello AI</h3>' +
    '<button onclick="this.closest(\'.modal-ov\').remove()" style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer">✕</button></div>' +
    '<div class="modal-bd">' +
    '<div style="display:flex;gap:8px;margin-bottom:14px">' +
    '<input id="brain-search-q" class="form-input light" placeholder="es. fed rate, conflict ukraine, nasdaq..." style="flex:1" onkeydown="if(event.key===\'Enter\')doBrainSearch()">' +
    '<button class="btn btn-p btn-sm" onclick="doBrainSearch()">Cerca</button></div>' +
    '<div id="brain-search-results" style="max-height:380px;overflow-y:auto"></div>' +
    '</div></div>';
  document.body.appendChild(mc);
  setTimeout(function() { var i = document.getElementById('brain-search-q'); if (i) i.focus(); }, 100);
};

window.doBrainSearch = function() {
  var q = (document.getElementById('brain-search-q') || {}).value || '';
  var out = document.getElementById('brain-search-results');
  if (!q.trim() || !out) return;
  out.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:8px">Cercando…</div>';
  rq('/api/brain/search?q=' + encodeURIComponent(q) + '&top_k=10').then(function(r) {
    var res = (r && r.results) || [];
    if (!res.length) { out.innerHTML = '<div style="color:var(--t3);padding:16px;text-align:center">Nessun risultato trovato</div>'; return; }
    out.innerHTML = res.map(function(e) {
      var srcColors = { event: '#F59E0B', analysis: '#7C3AED', ew: '#EF4444',
        interaction: '#3B82F6', market: '#10B981', question: '#8B5CF6' };
      var col = srcColors[e.source] || '#8A94A6';
      return '<div style="padding:10px;background:var(--bg2,rgba(255,255,255,.04));border-radius:8px;margin-bottom:6px;border-left:3px solid ' + col + '">' +
        '<div style="display:flex;gap:5px;margin-bottom:5px">' +
        '<span style="font-size:9px;padding:1px 6px;border-radius:20px;background:' + col + '22;color:' + col + '">' + e.source + '</span>' +
        '<span style="font-size:9px;color:var(--t3)">' + (e.timestamp || '').slice(0, 10) + '</span></div>' +
        '<div style="font-size:12px;color:var(--t1);line-height:1.5">' + e.content.slice(0, 250) + '</div></div>';
    }).join('');
  });
};

window.confirmResetBrain = function() {
  if (!confirm('Cancellare tutto il tuo cervello AI? Non può essere annullato.')) return;
  rq('/api/brain/reset', { method: 'DELETE' }).then(function(r) {
    if (r && r.ok) {
      toast('Cervello resettato', 'i');
      if (typeof loadBrainStats === 'function') loadBrainStats();
    }
  });
};

/* Update loadBrainStats to also update topic pills */
var _origLoadBrainStats = window.loadBrainStats;
window.loadBrainStats = function() {
  rq('/api/brain/stats').then(function(r) {
    if (!r || r.total_entries === undefined) return;
    G.brainStats = r;
    var el = document.getElementById('brain-level-badge');
    var el2 = document.getElementById('brain-entry-count');
    var el3 = document.getElementById('brain-level-bar');
    var el4 = document.getElementById('brain-topics');
    var levels = { seed: 0, growing: 20, active: 100, advanced: 500, expert: 2000 };
    var icons  = { seed: '🌱', growing: '🌿', active: '🧠', advanced: '⚡', expert: '🔥' };
    var colors = { finance: '#10B981', macro: '#3B82F6', security: '#EF4444', tech: '#8B5CF6',
                   energy: '#F59E0B', politics: '#EC4899', geopolitics: '#F97316', trade: '#06B6D4' };
    var level  = r.brain_level || 'seed';
    var count  = r.total_entries || 0;
    if (el) el.textContent = icons[level] + ' ' + level.toUpperCase();
    if (el2) el2.textContent = count + ' entries';
    if (el3) {
      var next = { seed: 20, growing: 100, active: 500, advanced: 2000, expert: 9999 };
      var pct = Math.min(100, Math.round(count / (next[level] || 100) * 100));
      el3.style.width = pct + '%';
    }
    if (el4 && r.by_topic && r.by_topic.length) {
      el4.innerHTML = r.by_topic.slice(0, 6).map(function(t) {
        var col = colors[t.topic] || '#8A94A6';
        return '<span style="font-size:10px;padding:2px 8px;border-radius:20px;background:' + col + '22;color:' + col + '">' + t.topic + ' ' + t.n + '</span>';
      }).join('');
    }
  });
};
