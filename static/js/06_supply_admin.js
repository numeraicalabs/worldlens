/**
 * @file 06_supply_admin.js
 * @module WorldLens/Supply Chain & Admin Dashboard
 *
 * @description
 * Supply chain intelligence module and full admin dashboard:
 * user management, event monitoring, AI provider settings, system info.
 *
 * @dependencies 01_globals.js, 02_core.js
 * @exports loadSupplyChain, enterAdmin, exitAdmin, adminNav, loadAdminOverview, loadAdminUsers, loadAdminEvents, loadAdminAI, loadAdminSettings
 */


// SUPPLY CHAIN INTELLIGENCE
// ════════════════════════════════════════════════════════

var G_SC = { loaded: false, map: null, markers: [], ready: false };
var G_EW = { loaded: false };

async function loadSupplyChain() {
  var r = await rq('/api/intelligence/supply-chain');
  if (!r || r.global_sc_stress === undefined) return;
  G_SC.data = r;

  var stress = r.global_sc_stress || 0;
  var stressCol = stress >= 7 ? '#EF4444' : stress >= 5 ? '#F97316' : stress >= 3.5 ? '#F59E0B' : '#10B981';

  // Hero
  var hero = el('sc-hero');
  if (hero) hero.style.opacity = '1';
  el('sc-stress').textContent = stress.toFixed(1);
  el('sc-stress').style.color = stressCol;
  setEl('sc-brief', r.ai_summary || '');
  setEl('sc-critical', r.critical_nodes || 0);
  setEl('sc-high', r.high_risk_nodes || 0);

  // Disruptions
  var disrupts = r.disruptions || [];
  var dcountEl = el('sc-disrupt-count');
  if (dcountEl) dcountEl.textContent = disrupts.length + ' active';
  var dEl = el('sc-disruptions');
  if (dEl) {
    dEl.innerHTML = disrupts.slice(0, 8).map(function(d) {
      var c = d.risk_color || '#F59E0B';
      return '<div class="sc-disruption">'
        + '<div class="sc-disruption-icon">' + d.icon + '</div>'
        + '<div>'
        + '<div class="sc-disruption-name">' + d.node_name + '</div>'
        + '<div class="sc-disruption-trigger">' + (d.trigger || '') + '</div>'
        + '<div style="font-size:9px;color:' + c + ';margin-top:3px">' + (d.type || '').replace('_', ' ') + ' &bull; ' + d.event_count + ' events</div>'
        + '</div>'
        + '<div class="sc-risk-badge" style="color:' + c + '">'
        + d.risk_score + '<br><span style="font-size:8px;opacity:.7">' + d.risk_level + '</span></div>'
        + '</div>';
    }).join('') || '<div style="color:var(--t3);font-size:11px;padding:8px 0">No significant disruptions detected</div>';
  }

  // Load sectors
  loadSCSectors();
  // Render map
  initSCMap(r.nodes || []);
}

async function loadSCSectors() {
  var r = await rq('/api/intelligence/supply-chain/sectors');
  if (!r || !r.sectors) return;
  var sEl = el('sc-sectors');
  if (!sEl) return;
  sEl.innerHTML = r.sectors.map(function(s) {
    var c = s.color || '#F59E0B';
    return '<div class="sc-sector">'
      + '<div class="sc-sector-name">' + s.sector + '</div>'
      + '<div class="sc-sector-exp" style="color:' + c + '">' + s.exposure + ' Risk — ' + s.risk_score + '/10</div>'
      + '<div class="sc-sector-bar"><div class="sc-sector-fill" style="width:' + (s.risk_score * 10) + '%;background:' + c + '"></div></div>'
      + '</div>';
  }).join('');
}

function initSCMap(nodes) {
  if (!nodes.length) return;
  // Wait for map element to be in a visible view
  var mapEl = document.getElementById('sc-map');
  if (!mapEl) return;
  if (G_SC.map) {
    updateSCMarkers(nodes);
    G_SC.map.invalidateSize();
    return;
  }

  var scMapStyle = document.createElement('style');
  scMapStyle.textContent = '#sc-map .leaflet-tile-pane{filter:invert(1) hue-rotate(200deg) brightness(0.65) saturate(0.5)}';
  document.head.appendChild(scMapStyle);

  G_SC.map = L.map('sc-map', {
    center: [20, 20], zoom: 2, zoomControl: true, minZoom: 2
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains: 'abc', maxZoom: 18, attribution: 'OSM', crossOrigin: false
  }).addTo(G_SC.map);
  G_SC.ready = true;
  updateSCMarkers(nodes);
  setTimeout(function() { G_SC.map.invalidateSize(); }, 200);
}

function updateSCMarkers(nodes) {
  if (!G_SC.map) return;
  G_SC.markers.forEach(function(m) { m.remove(); });
  G_SC.markers = [];

  var typeColors = {
    CHOKEPOINT:    '#EF4444',
    MAJOR_PORT:    '#F59E0B',
    CRITICAL_NODE: '#8B5CF6',
    TRADE_ROUTE:   '#06B6D4',
    EMERGING_ROUTE:'#10B981'
  };

  nodes.forEach(function(node) {
    if (!node.lat || !node.lon) return;
    var riskCol = node.risk_color || '#F59E0B';
    var typeCol = typeColors[node.type] || '#94A3B8';
    var r = Math.max(12, Math.min(32, 8 + node.risk_score * 2.2));
    var pulse = node.risk_score >= 7
      ? '<div style="position:absolute;inset:-5px;border-radius:50%;border:2px solid ' + riskCol + ';animation:pr 2s ease-out infinite;pointer-events:none"></div>'
      : '';
    var html = '<div style="width:' + (r*2) + 'px;height:' + (r*2) + 'px;border-radius:50%;'
      + 'background:' + riskCol + '22;border:2px solid ' + riskCol
      + ';box-shadow:0 0 ' + r + 'px ' + riskCol + '66;'
      + 'display:flex;align-items:center;justify-content:center;font-size:' + Math.max(10, Math.round(r/1.3)) + 'px;'
      + 'position:relative;cursor:pointer">'
      + pulse + node.icon + '</div>';
    var icon = L.divIcon({ html: html, className: '', iconSize: [r*2,r*2], iconAnchor: [r,r] });
    var mk = L.marker([node.lat, node.lon], { icon: icon });

    var topEvHtml = (node.top_events || []).slice(0,2).map(function(e) {
      return '<div style="font-size:10px;color:#94A3B8;margin-top:3px;padding-top:3px;border-top:1px solid rgba(255,255,255,.06)">'
        + e.title.slice(0,55) + '</div>';
    }).join('');

    mk.bindTooltip(
      '<div style="min-width:190px">'
      + '<div style="font-size:9px;color:' + typeCol + ';font-weight:700;text-transform:uppercase;margin-bottom:4px">' + (node.type||'').replace('_',' ') + '</div>'
      + '<div style="font-size:13px;font-weight:700;margin-bottom:4px;color:#F0F6FF">' + node.name + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
      + '<span style="color:' + riskCol + ';font-weight:700;font-family:monospace">' + node.risk_score + '/10</span>'
      + '<span style="color:' + riskCol + ';font-size:10px">' + (node.risk_level||'') + '</span>'
      + '</div>'
      + (node.relevant_events ? '<div style="font-size:10px;color:#4B5E7A">' + node.relevant_events + ' related events</div>' : '')
      + topEvHtml
      + '</div>',
      { permanent: false, direction: 'top', opacity: 1 }
    );

    mk.addTo(G_SC.map);
    G_SC.markers.push(mk);
  });
}

// ── Hook sv() to load views on first visit ────────────
var _sv_intel = sv;
sv = function(name, btn) {
  _sv_intel(name, btn);
  if (name === 'earlywarning' && !G_EW.loaded) {
    G_EW.loaded = true;
    setTimeout(loadEarlyWarning, 100);
  }
  if (name === 'markets') { initMarkets(); }
  if (name === 'supplychain' && !G_SC.loaded) {
    G_SC.loaded = true;
    setTimeout(loadSupplyChain, 150);
  }
};



// ════════════════════════════════════════════════════════
