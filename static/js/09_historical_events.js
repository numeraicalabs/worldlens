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

