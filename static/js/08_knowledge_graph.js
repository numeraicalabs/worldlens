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
