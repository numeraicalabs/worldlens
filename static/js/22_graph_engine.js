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
