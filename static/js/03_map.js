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

  G.map = L.map('map', { center:[25,15], zoom:3, zoomControl:false, minZoom:2, maxZoom:14 });

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

  mk.bindTooltip(
    '<div style="min-width:210px">'
    + '<div style="font-size:9px;color:'+col+';font-weight:700;text-transform:uppercase;margin-bottom:6px">'
    + item.count + ' events &bull; '+item.category+'</div>'
    + rows
    + '<div style="font-size:9px;color:#4B5E7A;margin-top:5px">Click to zoom in</div>'
    + '</div>',
    {permanent:false, direction:'top', opacity:1}
  );

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

  var icon = L.divIcon({html:html, className:'', iconSize:[r*2,r*2], iconAnchor:[r,r], popupAnchor:[0,-(r+4)]});
  var mk   = L.marker([ev.latitude, ev.longitude], {icon:icon});

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

  var eid = ev.id;
  mk.on('click', function(e) {
    /* Detect mobile via _isMobile() OR touch capability */
    var isMob = (typeof _isMobile === 'function' && _isMobile())
                || ('ontouchstart' in window && window.innerWidth <= 900);
    if (isMob) {
      /* Prevent Leaflet from opening its popup (it conflicts with holo sheet) */
      if (e && e.originalEvent) e.originalEvent.preventDefault();
      if (typeof showHoloEvent === 'function') showHoloEvent(eid);
      return;
    }
    openEP(eid);
  });
  mk.bindPopup(
    '<div class="pc">'
    + '<div class="pc-cat" style="color:'+m.c+'">'+m.i+' '+ev.category+(isGroup?' ('+ev._groupCount+' sources)':'')+'</div>'
    + '<div class="pc-tit">'+ev.title+'</div>'
    + '<div class="pc-meta">'+(ev.country_name||ev.country_code||'Global')+' &bull; '+tAgo(new Date(ev.timestamp))+'</div>'
    + (ev.summary?'<div class="pc-sum">'+ev.summary+'</div>':'')
    + '<button class="pc-btn" id="pcb-'+eid+'">View Details + AI</button></div>',
    {maxWidth:290, minWidth:240}
  );
  mk.on('popupopen', function() {
    /* Close popup immediately on mobile — holo sheet handles the detail view */
    var isMob = ('ontouchstart' in window && window.innerWidth <= 900);
    if (isMob) { mk.closePopup(); return; }
    var btn = document.getElementById('pcb-'+eid);
    if (btn) btn.onclick = function(){ openEP(eid); };
  });

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
  var ev = G.events.find(function(e){return e.id===id;});
  if (!ev) return;
  G.panelEv = ev;
  track('event_opened', G.currentView || 'map', ev.id + '|' + (ev.category||'') + '|' + (ev.country_code||''));
  var m = CATS[ev.category]||CATS.GEOPOLITICS;
  el('epcat').innerHTML = m.i+' '+ev.category;
  el('epcat').style.cssText = 'background:'+m.bg+';color:'+m.c+';';
  setEl('eptit', ev.title);

  var dedupEl=el('ep-dedup'), sourcesEl=el('ep-sources'), listEl=el('ep-source-list');
  if (ev._groupCount && ev._groupCount > 1) {
    if (dedupEl)  { dedupEl.style.display='inline-flex'; setEl('ep-dedup-txt', ev._groupCount+' sources merged'); }
    if (sourcesEl && listEl) {
      sourcesEl.style.display='block';
      listEl.innerHTML = (ev._sources||[ev.source]).map(function(s){
        return '<span class="source-pill">'+s+'</span>';
      }).join('');
    }
  } else {
    if (dedupEl)   dedupEl.style.display='none';
    if (sourcesEl) sourcesEl.style.display='none';
  }

  setEl('epsum', ev.ai_summary||ev.summary||'No summary available.');
  setEl('epsrc', ev.source);
  el('epimp').innerHTML = '<span class="tag tag'+ev.impact[0]+'">'+ev.impact+'</span>';
  setEl('epreg', ev.country_name||ev.country_code||'Global');
  setEl('eptime', tAgo(new Date(ev.timestamp)));

  var mkts=[];
  try { mkts=typeof ev.related_markets==='string'?JSON.parse(ev.related_markets||'[]'):(ev.related_markets||[]); } catch(e){}
  el('epmkts').innerHTML = mkts.map(function(t){ return '<span class="mktg">'+t+'</span>'; }).join('');
  el('eplink').href = ev.url||'#';

  var mn=el('ai-market-note');
  if (mn) { if(ev.ai_market_note){mn.style.display='block';mn.textContent=ev.ai_market_note;}else mn.style.display='none'; }
  var ans=el('panelans'); if(ans){ans.textContent='';ans.classList.remove('on');}
  el('evpanel').classList.add('on');
  if (G.map&&ev.latitude&&ev.longitude)
    G.map.flyTo([ev.latitude,ev.longitude],Math.max(G.map.getZoom(),5),{duration:1.1});
  rq('/api/portfolio/track',{method:'POST',body:{action:'map_view'}});
}

function closeEP() { el('evpanel').classList.remove('on'); }

function qf(cat) {
  document.querySelectorAll('#mcats .cpill').forEach(function(p){
    p.classList.toggle('on', cat===null || p.dataset.c===cat);
  });
  updateMarkers();
}
