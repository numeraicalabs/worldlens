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
