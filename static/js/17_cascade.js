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

(function() {
  var _prev = ngSwitchMode;
  ngSwitchMode = function(mode, btn) {
    // Run the base handler (handles graph/explorer/timeline)
    _prev(mode, btn);

    var casCanvas  = document.getElementById('cas-canvas-wrap');
    var casSidebar = document.getElementById('ng-mode-cascade');

    if (mode === 'cascade') {
      // Base handler already hid everything else; show cascade pieces
      if (casSidebar) casSidebar.style.display = 'flex';
      if (casCanvas)  casCanvas.style.display  = 'flex';
      _casInitSVG();
      _casShowEmpty();
    } else {
      // Hide cascade pieces when switching away
      if (casSidebar) casSidebar.style.display = 'none';
      if (casCanvas)  casCanvas.style.display  = 'none';
    }
  };
})();

// ══════════════════════════════════════════════════════
// 3.  CASCADE SIMULATION  (calls /api/dependency/*)
// ══════════════════════════════════════════════════════

function casRun() {
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
