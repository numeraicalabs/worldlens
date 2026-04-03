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
