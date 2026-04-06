/**
 * WorldLens — Agent Dashboard (21_agents_dash.js)
 * 4 agentic AI bots: Finance, Geopolitics, Science, Technology
 * Each bot is configurable per user and saved to profile.
 */
(function() {
'use strict';

/* ── State ── */
var AGENTS = {};          // { bot_id: {def + config + brief} }
var _configOpen = null;   // bot_id of open config panel

/* ── Boot: called by renderDash or enterApp ── */
window.initAgentDash = function() {
  loadAgentConfigs();
};

/* ── Load configs + briefs ── */
function loadAgentConfigs() {
  if (!G.token) return;
  rq('/api/agents/config').then(function(data) {
    if (!data || data.detail) return;
    AGENTS = data;
    renderAgentCards();
    loadAllBriefs();
  });
}

function loadAllBriefs() {
  rq('/api/agents/all-briefs').then(function(data) {
    if (!data || data.detail) return;
    Object.keys(data).forEach(function(bid) {
      if (AGENTS[bid]) {
        AGENTS[bid].brief = data[bid];
        refreshCardBrief(bid, data[bid]);
      }
    });
  });
}

function loadOneBrief(bid) {
  var card = document.getElementById('agent-card-' + bid);
  if (card) {
    var body = card.querySelector('.ag-body');
    if (body) body.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div><span>Analysing…</span></div>';
  }
  rq('/api/agents/brief/' + bid).then(function(data) {
    if (data && !data.detail) {
      if (AGENTS[bid]) AGENTS[bid].brief = data;
      refreshCardBrief(bid, data);
    }
  });
}

/* ── Render all 4 cards into #agents-grid ── */
function renderAgentCards() {
  var grid = document.getElementById('agents-grid');
  if (!grid) return;
  grid.innerHTML = '';
  var order = ['finance','geopolitics','science','technology'];
  order.forEach(function(bid, i) {
    var agent = AGENTS[bid];
    if (!agent) return;
    var card = buildCard(agent, i);
    grid.appendChild(card);
  });
}

function buildCard(agent, idx) {
  var bid = agent.id;
  var cfg = agent.config || agent.defaults || {};
  var enabled = cfg.enabled !== false;

  var el = document.createElement('div');
  el.className = 'ag-card' + (enabled ? '' : ' ag-disabled');
  el.id = 'agent-card-' + bid;
  el.style.setProperty('--ag-color',    agent.color);
  el.style.setProperty('--ag-accent',   agent.accent);
  el.style.setProperty('--ag-border',   agent.border);
  el.style.animationDelay = (idx * 0.08) + 's';

  el.innerHTML = [
    '<div class="ag-header">',
    '  <div class="ag-icon-wrap"><span class="ag-icon">' + agent.icon + '</span></div>',
    '  <div class="ag-title-col">',
    '    <div class="ag-name">' + agent.name + '</div>',
    '    <div class="ag-focus">' + (cfg.focus || '—') + '</div>',
    '  </div>',
    '  <div class="ag-header-right">',
    '    <div class="ag-signal ag-signal-neutral" id="ag-signal-' + bid + '">—</div>',
    '    <button class="ag-settings-btn" onclick="agentOpenConfig(\'' + bid + '\')" title="Configure">⚙</button>',
    '  </div>',
    '</div>',
    '<div class="ag-body" id="ag-body-' + bid + '">',
    '  <div class="ag-loading"><div class="ag-spinner"></div><span>Loading…</span></div>',
    '</div>',
    '<div class="ag-footer">',
    '  <button class="ag-action-btn ag-btn-primary" onclick="agentAsk(\'' + bid + '\')">',
    '    <span>💬</span> Ask ' + agent.name,
    '  </button>',
    '  <button class="ag-action-btn ag-btn-secondary" onclick="loadOneBrief(\'' + bid + '\')">',
    '    <span>↻</span> Refresh',
    '  </button>',
    '</div>',
    buildConfigPanel(agent, cfg),
  ].join('\n');

  return el;
}

function buildConfigPanel(agent, cfg) {
  var bid = agent.id;
  var focusOpts = (agent.focus_options || []).map(function(f) {
    return '<option value="' + f + '"' + (cfg.focus === f ? ' selected' : '') + '>' + f + '</option>';
  }).join('');
  var toneOpts = (agent.tone_options || []).map(function(t) {
    return '<option value="' + t + '"' + (cfg.tone === t ? ' selected' : '') + '>' + t + '</option>';
  }).join('');
  var alertOpts = (agent.alert_options || []).map(function(a) {
    return '<option value="' + a + '"' + (cfg.alerts === a ? ' selected' : '') + '>' + a + '</option>';
  }).join('');

  return [
    '<div class="ag-config-panel" id="ag-cfg-' + bid + '" style="display:none">',
    '  <div class="ag-cfg-title">Configure ' + agent.name + '</div>',
    '  <div class="ag-cfg-row">',
    '    <label class="ag-cfg-label">Focus Area</label>',
    '    <select class="ag-cfg-select" id="ag-focus-' + bid + '" onchange="agentConfigChanged(\'' + bid + '\')">' + focusOpts + '</select>',
    '  </div>',
    '  <div class="ag-cfg-row">',
    '    <label class="ag-cfg-label">Response Tone</label>',
    '    <select class="ag-cfg-select" id="ag-tone-' + bid + '" onchange="agentConfigChanged(\'' + bid + '\')">' + toneOpts + '</select>',
    '  </div>',
    '  <div class="ag-cfg-row">',
    '    <label class="ag-cfg-label">Alert Level</label>',
    '    <select class="ag-cfg-select" id="ag-alerts-' + bid + '" onchange="agentConfigChanged(\'' + bid + '\')">' + alertOpts + '</select>',
    '  </div>',
    '  <div class="ag-cfg-row" style="justify-content:space-between;align-items:center">',
    '    <label class="ag-cfg-label">Active</label>',
    '    <label class="ag-toggle">',
    '      <input type="checkbox" id="ag-enabled-' + bid + '"' + (cfg.enabled !== false ? ' checked' : '') + ' onchange="agentConfigChanged(\'' + bid + '\')">',
    '      <span class="ag-toggle-track"></span>',
    '    </label>',
    '  </div>',
    '  <div class="ag-cfg-actions">',
    '    <button class="ag-action-btn ag-btn-primary" onclick="agentSaveConfig(\'' + bid + '\')">Save & Apply</button>',
    '    <button class="ag-action-btn ag-btn-ghost" onclick="agentCloseConfig(\'' + bid + '\')">Cancel</button>',
    '  </div>',
    '</div>',
  ].join('\n');
}

/* ── Refresh brief content in a card ── */
function refreshCardBrief(bid, brief) {
  var body = document.getElementById('ag-body-' + bid);
  var sigEl = document.getElementById('ag-signal-' + bid);
  if (!body) return;

  // Signal chip
  var signalMap = {
    bullish:  { label: brief.signal_label || 'Bullish',  cls: 'ag-signal-bullish'  },
    bearish:  { label: brief.signal_label || 'Bearish',  cls: 'ag-signal-bearish'  },
    critical: { label: brief.signal_label || 'Critical', cls: 'ag-signal-critical' },
    neutral:  { label: brief.signal_label || 'Monitor',  cls: 'ag-signal-neutral'  },
  };
  var sig = signalMap[brief.signal] || signalMap.neutral;
  if (sigEl) {
    sigEl.textContent = sig.label;
    sigEl.className = 'ag-signal ' + sig.cls;
  }

  // Events count badge
  var evCount = brief.event_count || 0;

  // Key points
  var kpHtml = '';
  if (brief.key_points && brief.key_points.length) {
    kpHtml = '<ul class="ag-key-points">' +
      brief.key_points.slice(0,3).map(function(p) {
        return '<li>' + p + '</li>';
      }).join('') + '</ul>';
  }

  // Top events chips
  var evHtml = '';
  if (brief.top_events && brief.top_events.length) {
    evHtml = '<div class="ag-ev-chips">' +
      brief.top_events.slice(0,3).map(function(ev) {
        var sev = ev.severity || 5;
        var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#10B981';
        return '<div class="ag-ev-chip" style="--ev-col:'+col+'">'+
          '<span class="ag-ev-sev" style="color:'+col+';background:'+col+'1a">'+sev.toFixed(0)+'</span>'+
          '<span class="ag-ev-title">'+ev.title.slice(0,50)+'</span>'+
          '</div>';
      }).join('') + '</div>';
  }

  body.innerHTML = [
    '<div class="ag-headline">' + (brief.headline || '') + '</div>',
    '<div class="ag-brief">' + (brief.brief || 'No data available.') + '</div>',
    kpHtml,
    evHtml,
    '<div class="ag-meta">',
    '  <span class="ag-ev-count">' + evCount + ' events monitored</span>',
    '</div>',
  ].join('');
}

/* ── Config panel toggle ── */
window.agentOpenConfig = function(bid) {
  if (_configOpen && _configOpen !== bid) agentCloseConfig(_configOpen);
  var panel = document.getElementById('ag-cfg-' + bid);
  var card  = document.getElementById('agent-card-' + bid);
  if (!panel) return;
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  if (card) card.classList.toggle('ag-config-active', panel.style.display !== 'none');
  _configOpen = panel.style.display !== 'none' ? bid : null;
};

window.agentCloseConfig = function(bid) {
  var panel = document.getElementById('ag-cfg-' + bid);
  var card  = document.getElementById('agent-card-' + bid);
  if (panel) panel.style.display = 'none';
  if (card)  card.classList.remove('ag-config-active');
  if (_configOpen === bid) _configOpen = null;
};

window.agentConfigChanged = function(bid) { /* live preview future */ };

window.agentSaveConfig = function(bid) {
  var focus   = document.getElementById('ag-focus-'   + bid);
  var tone    = document.getElementById('ag-tone-'    + bid);
  var alerts  = document.getElementById('ag-alerts-'  + bid);
  var enabled = document.getElementById('ag-enabled-' + bid);
  if (!focus) return;

  var cfg = {
    focus:   focus.value,
    tone:    tone ? tone.value : 'Professional',
    alerts:  alerts ? alerts.value : 'High Impact Only',
    enabled: enabled ? enabled.checked : true,
  };

  // Save to server
  rq('/api/agents/config/' + bid, { method: 'POST', body: cfg }).then(function() {
    if (AGENTS[bid]) AGENTS[bid].config = cfg;
    // Update focus label
    var focusLabel = document.querySelector('#agent-card-' + bid + ' .ag-focus');
    if (focusLabel) focusLabel.textContent = cfg.focus;
    // Toggle disabled state
    var card = document.getElementById('agent-card-' + bid);
    if (card) card.classList.toggle('ag-disabled', !cfg.enabled);
    agentCloseConfig(bid);
    // Refresh brief
    if (cfg.enabled) loadOneBrief(bid);
    toast('Agent config saved', 's', 2000);
  });
};

/* ── Ask bot ── */
window.agentAsk = function(bid) {
  var agent = AGENTS[bid];
  if (!agent) return;
  sv('ai', document.querySelector('[data-v=ai]'));
  setTimeout(function() {
    var cfg = agent.config || agent.defaults || {};
    var prompt = 'I\'m using the ' + agent.name + ' monitoring ' + cfg.focus + '. ' +
                 'Give me a fresh analysis and any actionable insights.';
    if (typeof aiSend === 'function') aiSend(prompt);
  }, 300);
};

/* ── Expose refresh for external use ── */
window.refreshAgentBriefs = loadAllBriefs;
window.loadOneBrief = loadOneBrief;

})();
