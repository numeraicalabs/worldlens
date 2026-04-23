/**
 * WorldLens — Agent Dashboard v3 (21_agents_dash.js)
 * Block A: enriched prompts, delta, alerts, threshold, profile persistence
 * Block B: inline ask, signal sparkline, Bot vs Bot debate
 * Block C: streak, streak freeze, daily digest, predict & verify
 */
(function() {
'use strict';

var AGENTS   = {};
var _cfgOpen = null;
var _SIGNAL_MAP = {
  bullish:  { label: 'Bullish',  cls: 'ag-signal-bullish'  },
  bearish:  { label: 'Caution',  cls: 'ag-signal-bearish'  },
  critical: { label: 'Alert',    cls: 'ag-signal-critical' },
  neutral:  { label: 'Monitor',  cls: 'ag-signal-neutral'  },
};

// ── Boot ────────────────────────────────────────────────────────────────────
window.initAgentDash = function() {
  if (!G.token) return;
  rq('/api/agents/config').then(function(data) {
    if (!data || data.detail) return;
    AGENTS = data;
    renderAgentCards();
    loadAllBriefs();
    loadStreak();
    injectDebateSection();
  });
};

// ── Load briefs ─────────────────────────────────────────────────────────────
function loadAllBriefs() {
  // Step 1: Show instant event-based fallback for each card
  Object.keys(AGENTS).forEach(function(bid) {
    _showEventFallback(bid);
  });

  // Step 2: Fetch AI briefs (now parallel on server — ~4x faster)
  rq('/api/agents/all-briefs').then(function(data) {
    if (!data || data.detail) return;
    Object.keys(data).forEach(function(bid) {
      if (AGENTS[bid]) { AGENTS[bid].brief = data[bid]; refreshCardBrief(bid, data[bid]); }
    });
  }).catch(function() {
    // Fallback already shown — nothing more to do
  });
}

/** Show event data immediately without waiting for AI */
function _showEventFallback(bid) {
  var body = document.getElementById('ag-body-' + bid);
  if (!body) return;
  // Already has real content — don't overwrite
  if (body.querySelector('.ag-headline')) return;

  var agent = AGENTS[bid];
  if (!agent) return;

  // Get events for this bot from G.events
  var evs = (window.G && G.events) ? G.events.slice()
    .filter(function(e) {
      // rough category match by bot type
      var cat = (e.category || '').toLowerCase();
      if (bid === 'finance')     return cat.includes('econ') || cat.includes('financ') || cat.includes('market');
      if (bid === 'geopolitics') return cat.includes('geo') || cat.includes('conflict') || cat.includes('polit');
      if (bid === 'science')     return cat.includes('sci') || cat.includes('health') || cat.includes('disaster');
      if (bid === 'technology')  return cat.includes('tech') || cat.includes('cyber') || cat.includes('ai');
      return true;
    })
    .sort(function(a,b){ return (b.severity||0)-(a.severity||0); })
    .slice(0, 5) : [];

  if (!evs.length && window.G && G.events) {
    evs = G.events.slice(0, 3);
  }

  if (!evs.length) {
    body.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div><span>Fetching AI analysis…</span></div>';
    return;
  }

  var topEv = evs[0];
  var highSev = evs.filter(function(e){ return (e.severity||0) >= 7; }).length;

  body.innerHTML = [
    '<div class="ag-headline">' + (topEv.title || '').slice(0, 80) + '</div>',
    '<div class="ag-brief" style="font-style:italic;color:var(--t3);font-size:10px">AI analysis loading…</div>',
    evs.slice(0, 3).length ? '<div class="ag-ev-chips">' + evs.slice(0, 3).map(function(ev) {
      var sev = ev.severity || 5;
      var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#10B981';
      return '<div class="ag-ev-chip" style="--ev-col:' + col + '">'
        + '<span class="ag-ev-sev" style="color:' + col + ';background:' + col + '1a">' + sev.toFixed(0) + '</span>'
        + '<span class="ag-ev-title">' + ev.title.slice(0, 48) + '</span></div>';
    }).join('') + '</div>' : '',
    '<div class="ag-meta"><span class="ag-ev-count">' + evs.length + ' eventi monitorati</span></div>',
  ].join('');
}

window.loadOneBrief = function loadOneBrief(bid) {
  setCardLoading(bid);
  rq('/api/agents/brief/' + bid).then(function(d) {
    if (d && !d.detail) {
      if (AGENTS[bid]) AGENTS[bid].brief = d;
      refreshCardBrief(bid, d);
      if (d.streak) renderStreakBadge(d.streak);
    }
  });
};

// ── Card build ───────────────────────────────────────────────────────────────
function renderAgentCards() {
  var grid = document.getElementById('agents-grid');
  if (!grid) return;
  grid.innerHTML = '';
  ['finance','geopolitics','science','technology'].forEach(function(bid, i) {
    var ag = AGENTS[bid]; if (!ag) return;
    grid.appendChild(buildCard(ag, i));
  });
}

function buildCard(agent, idx) {
  var bid = agent.id;
  var cfg = agent.config || agent.defaults || {};
  var en  = cfg.enabled !== false;
  var div = document.createElement('div');
  div.className = 'ag-card' + (en ? '' : ' ag-disabled');
  div.id = 'agent-card-' + bid;
  div.style.setProperty('--ag-color',  agent.color);
  div.style.setProperty('--ag-accent', agent.accent);
  div.style.setProperty('--ag-border', agent.border);
  div.style.animationDelay = (idx * 0.08) + 's';
  var thr = (cfg.severity_threshold || 6.5).toFixed(1);
  div.innerHTML = [
    '<div class="ag-header">',
    ' <div class="ag-icon-wrap"><span class="ag-icon">' + agent.icon + '</span></div>',
    ' <div class="ag-title-col">',
    '  <div class="ag-name">' + agent.name + '</div>',
    '  <div class="ag-focus" id="ag-focus-lbl-' + bid + '">' + (cfg.focus||'—') + '</div>',
    ' </div>',
    ' <div class="ag-header-right">',
    '  <div class="ag-signal ag-signal-neutral" id="ag-signal-' + bid + '">—</div>',
    '  <button class="ag-settings-btn" onclick="agentOpenConfig(\'' + bid + '\')" title="Configure">⚙</button>',
    ' </div>',
    '</div>',
    '<div class="ag-meta-row" id="ag-meta-' + bid + '">',
    ' <span class="ag-thresh-lbl">Alert ≥<span id="ag-thresh-val-' + bid + '">' + thr + '</span></span>',
    ' <div class="ag-sparkline-wrap" id="ag-spark-' + bid + '"></div>',
    ' <div class="ag-conf-wrap"><div class="ag-conf-bar" id="ag-conf-' + bid + '" style="width:0%"></div></div>',
    ' <span class="ag-conf-num" id="ag-conf-num-' + bid + '">—</span>',
    '</div>',
    '<div class="ag-alerts-strip" id="ag-alerts-' + bid + '" style="display:none"></div>',
    '<div class="ag-delta-banner" id="ag-delta-' + bid + '" style="display:none"></div>',
    '<div class="ag-body" id="ag-body-' + bid + '">',
    ' <div class="ag-loading"><div class="ag-spinner"></div><span>Loading…</span></div>',
    '</div>',
    '<div class="ag-inline-ask" id="ag-ask-' + bid + '" style="display:none">',
    ' <div class="ag-ask-row">',
    '  <input class="ag-ask-input" id="ag-ask-inp-' + bid + '" type="text" placeholder="Ask ' + agent.name + '…" autocomplete="off">',
    '  <button class="ag-ask-send" onclick="agentSendInline(\'' + bid + '\')">→</button>',
    ' </div>',
    ' <div class="ag-ask-ans" id="ag-ask-ans-' + bid + '" style="display:none"></div>',
    '</div>',
    '<div class="ag-footer">',
    ' <button class="ag-action-btn ag-btn-primary" onclick="agentToggleAsk(\'' + bid + '\')">💬 Ask</button>',
    ' <button class="ag-action-btn ag-btn-secondary" onclick="loadOneBrief(\'' + bid + '\')">↻</button>',
    ' <button class="ag-action-btn ag-btn-secondary" onclick="agentOpenConfig(\'' + bid + '\')">⚙</button>',
    '</div>',
    buildConfigPanel(agent, cfg),
  ].join('');
  loadSparkline(bid);
  return div;
}

function setCardLoading(bid) {
  var body = document.getElementById('ag-body-' + bid);
  if (body) body.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div><span>Analysing…</span></div>';
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function loadSparkline(bid) {
  rq('/api/agents/history/' + bid).then(function(d) {
    if (!d || !d.history || !d.history.length) return;
    renderSparkline(bid, d.history);
  });
}

function renderSparkline(bid, history) {
  var wrap = document.getElementById('ag-spark-' + bid);
  if (!wrap) return;
  var W = 52, H = 14;
  var sigScore = { bullish: 4, neutral: 2, bearish: 1, critical: 0 };
  var sigColor = { bullish: '#10B981', neutral: '#94A3B8', bearish: '#F59E0B', critical: '#EF4444' };
  var pts = history.map(function(h) { return sigScore[h.signal] !== undefined ? sigScore[h.signal] : 2; });
  if (pts.length < 2) { wrap.innerHTML = ''; return; }
  var min = 0, max = 4, step = W / (pts.length - 1);
  var coords = pts.map(function(v, i) {
    return [(i * step).toFixed(1), (H - (v / max * H)).toFixed(1)];
  });
  var polyline = coords.map(function(c) { return c[0] + ',' + c[1]; }).join(' ');
  var lastSig  = history[history.length - 1].signal;
  var col      = sigColor[lastSig] || '#94A3B8';
  wrap.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'
    + '<polyline points="' + polyline + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<circle cx="' + coords[coords.length-1][0] + '" cy="' + coords[coords.length-1][1] + '" r="2.5" fill="' + col + '"/>'
    + '</svg>';
}

// ── Refresh brief ─────────────────────────────────────────────────────────────
function refreshCardBrief(bid, brief) {
  var body    = document.getElementById('ag-body-'    + bid);
  var sigEl   = document.getElementById('ag-signal-'  + bid);
  var confEl  = document.getElementById('ag-conf-'    + bid);
  var confNum = document.getElementById('ag-conf-num-'+ bid);
  var deltaEl = document.getElementById('ag-delta-'   + bid);
  var alertEl = document.getElementById('ag-alerts-'  + bid);
  if (!body) return;

  var sig = _SIGNAL_MAP[brief.signal] || _SIGNAL_MAP.neutral;
  if (sigEl) { sigEl.textContent = sig.label; sigEl.className = 'ag-signal ' + sig.cls; }

  var conf = parseInt(brief.confidence || 0, 10);
  if (confEl)  confEl.style.width  = conf + '%';
  if (confNum) confNum.textContent = conf + '%';

  var alerts = brief.threshold_alerts || [];
  if (alertEl) {
    if (alerts.length) {
      alertEl.style.display = 'block';
      alertEl.innerHTML = alerts.map(function(a) {
        var col = a.severity >= 8 ? '#EF4444' : '#F59E0B';
        return '<div class="ag-alert-item" style="--al-col:' + col + '">'
          + '<span class="ag-alert-sev" style="color:' + col + '">' + a.severity.toFixed(1) + '</span>'
          + '<span class="ag-alert-title">' + a.title.slice(0,55) + '</span></div>';
      }).join('');
    } else {
      alertEl.style.display = 'none';
    }
  }

  var delta = brief.delta;
  if (deltaEl) {
    if (delta && delta.summary) {
      var chg = delta.signal_changed;
      deltaEl.style.display = 'flex';
      deltaEl.innerHTML = '<span class="ag-delta-icon" style="color:' + (chg ? 'var(--am)' : 'var(--t3)') + '">'
        + (chg ? '⚡' : '↔') + '</span>'
        + '<span class="ag-delta-txt">' + delta.summary + '</span>';
    } else { deltaEl.style.display = 'none'; }
  }

  var kpHtml = brief.key_points && brief.key_points.length
    ? '<ul class="ag-key-points">' + brief.key_points.slice(0,3).map(function(p){ return '<li>' + p + '</li>'; }).join('') + '</ul>' : '';

  var actHtml = brief.actions && brief.actions.length
    ? '<div class="ag-actions-list">' + brief.actions.slice(0,2).map(function(a){ return '<div class="ag-action-item">→ ' + a + '</div>'; }).join('') + '</div>' : '';

  var evHtml = '';
  if (brief.top_events && brief.top_events.length) {
    evHtml = '<div class="ag-ev-chips">'
      + brief.top_events.slice(0,3).map(function(ev) {
          var sev = ev.severity || 5;
          var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#10B981';
          return '<div class="ag-ev-chip" style="--ev-col:' + col + '">'
            + '<span class="ag-ev-sev" style="color:' + col + ';background:' + col + '1a">' + sev.toFixed(0) + '</span>'
            + '<span class="ag-ev-title">' + ev.title.slice(0,50) + '</span></div>';
        }).join('') + '</div>';
  }

  body.innerHTML = [
    '<div class="ag-headline">' + (brief.headline || '') + '</div>',
    '<div class="ag-brief">'   + (brief.brief    || 'No data available.') + '</div>',
    kpHtml, actHtml, evHtml,
    '<div class="ag-meta"><span class="ag-ev-count">' + (brief.event_count||0) + ' events monitored</span></div>',
  ].join('');

  loadSparkline(bid);
}

// ── Block B: Inline Ask ──────────────────────────────────────────────────────
window.agentToggleAsk = function(bid) {
  var box = document.getElementById('ag-ask-' + bid);
  if (!box) return;
  var opening = box.style.display === 'none';
  box.style.display = opening ? 'block' : 'none';
  if (opening) {
    var inp = document.getElementById('ag-ask-inp-' + bid);
    if (inp) setTimeout(function(){ inp.focus(); }, 80);
  }
};

window.agentSendInline = function(bid) {
  var inp = document.getElementById('ag-ask-inp-' + bid);
  var ans = document.getElementById('ag-ask-ans-' + bid);
  if (!inp || !ans) return;
  var q = inp.value.trim();
  if (!q) return;

  ans.style.display = 'block';
  ans.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div><span>Thinking…</span></div>';

  rq('/api/agents/ask/' + bid, { method: 'POST', body: { question: q } }).then(function(d) {
    if (d && d.answer) {
      ans.innerHTML = '<div class="ag-ask-response">' + d.answer + '</div>';
    } else {
      ans.innerHTML = '<div class="ag-ask-response" style="color:var(--re)">No response.</div>';
    }
  });

  inp.value = '';
};

// Handle Enter key in ask input
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var t = e.target;
  if (!t || !t.classList.contains('ag-ask-input')) return;
  var bid = t.id.replace('ag-ask-inp-', '');
  agentSendInline(bid);
});

// ── Block B: Bot vs Bot debate ───────────────────────────────────────────────
function injectDebateSection() {
  var header = document.querySelector('.agents-section-header');
  if (!header) return;
  if (document.getElementById('ag-debate-btn')) return;
  var btn = document.createElement('button');
  btn.id = 'ag-debate-btn';
  btn.className = 'agents-refresh-btn ag-debate-btn';
  btn.innerHTML = '⚔ Bot vs Bot';
  btn.onclick = loadDebate;
  header.appendChild(btn);

  // Insert debate panel after agents-grid
  var grid = document.getElementById('agents-grid');
  if (!grid) return;
  var panel = document.createElement('div');
  panel.id = 'ag-debate-panel';
  panel.style.display = 'none';
  grid.parentNode.insertBefore(panel, grid.nextSibling);
}

function loadDebate() {
  var panel = document.getElementById('ag-debate-panel');
  var btn   = document.getElementById('ag-debate-btn');
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    if (btn) btn.classList.remove('on');
    return;
  }

  panel.style.display = 'block';
  if (btn) btn.classList.add('on');
  panel.innerHTML = '<div class="ag-debate-loading"><div class="ag-spinner"></div><span>Bots are debating…</span></div>';

  rq('/api/agents/debate').then(function(d) {
    if (!d || !d.takes || !d.takes.length) {
      panel.innerHTML = '<div class="ag-debate-empty">No event data for debate. Check back later.</div>';
      return;
    }
    var evHtml = d.event
      ? '<div class="ag-debate-event"><span class="ag-debate-topic-label">TODAY\'S TOPIC</span>'
        + '<div class="ag-debate-event-title">' + d.event.title + '</div>'
        + '<span class="ag-debate-sev" style="color:' + (d.event.severity >= 7 ? '#EF4444' : '#F59E0B') + '">'
        + d.event.severity.toFixed(1) + '/10</span></div>'
      : '';

    var takesHtml = d.takes.map(function(t) {
      return '<div class="ag-debate-take" style="--ag-color:' + t.color + '">'
        + '<div class="ag-debate-bot"><span>' + t.icon + '</span><span>' + t.name + '</span></div>'
        + '<div class="ag-debate-text">' + t.take + '</div>'
        + '</div>';
    }).join('');

    panel.innerHTML = '<div class="ag-debate-wrap">' + evHtml + '<div class="ag-debate-takes">' + takesHtml + '</div></div>';
  });
}

// ── Block C: Streak ──────────────────────────────────────────────────────────
function loadStreak() {
  rq('/api/agents/streak').then(function(d) {
    if (d && typeof d.current_streak !== 'undefined') renderStreakBadge(d);
  });
}

function renderStreakBadge(d) {
  var sec = document.querySelector('.agents-section-header');
  if (!sec) return;
  var badge = document.getElementById('ag-streak-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'ag-streak-badge';
    badge.className = 'ag-streak-badge';
    sec.appendChild(badge);
  }
  var streak = d.current_streak || 0;
  var level  = d.level || 'new';
  var flame  = streak >= 7 ? '🔥' : streak >= 3 ? '⚡' : '📅';
  var lvlColor = { platinum: '#E2E8F0', gold: '#F59E0B', silver: '#94A3B8', bronze: '#CD7F32', new: '#4B5563' };
  badge.style.color = lvlColor[level] || '#4B5563';
  badge.innerHTML = '<span class="ag-streak-icon">' + flame + '</span>'
    + '<span class="ag-streak-num">' + streak + '</span>'
    + '<span class="ag-streak-label">day streak</span>';
  badge.title = 'Longest: ' + (d.longest_streak||0) + ' days | Total reads: ' + (d.total_reads||0);
  badge.onclick = function() { showStreakModal(d); };
}

function showStreakModal(d) {
  var existing = document.getElementById('ag-streak-modal');
  if (existing) { existing.remove(); return; }

  var streak   = d.current_streak || 0;
  var longest  = d.longest_streak || 0;
  var reads    = d.total_reads    || 0;
  var level    = d.level          || 'new';
  var next     = d.next_level     || {};
  var frozen   = d.streak_frozen  === 1;

  var modal = document.createElement('div');
  modal.id  = 'ag-streak-modal';
  modal.className = 'ag-streak-modal';
  modal.innerHTML = [
    '<div class="ag-streak-modal-inner">',
    ' <button class="ag-streak-modal-close" onclick="document.getElementById(\'ag-streak-modal\').remove()">×</button>',
    ' <div class="ag-streak-modal-title">🔥 Reading Streak</div>',
    ' <div class="ag-streak-big">' + streak + '</div>',
    ' <div class="ag-streak-days-label">consecutive days</div>',
    ' <div class="ag-streak-stats">',
    '  <div class="ag-streak-stat"><span>' + longest + '</span><label>Best streak</label></div>',
    '  <div class="ag-streak-stat"><span>' + reads + '</span><label>Total reads</label></div>',
    '  <div class="ag-streak-stat"><span>' + level.charAt(0).toUpperCase() + level.slice(1) + '</span><label>Level</label></div>',
    ' </div>',
    next.name ? '<div class="ag-streak-next">Next: <b>' + next.name + '</b> in ' + (next.days - streak) + ' days → ' + next.perk + '</div>' : '',
    !frozen ? '<button class="ag-btn-freeze" onclick="agentUseFreeze()">🧊 Use Streak Freeze</button>'
             : '<div class="ag-freeze-used">Streak freeze active ✓</div>',
    '</div>',
  ].join('');
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
}

window.agentUseFreeze = function() {
  rq('/api/agents/streak/freeze', { method: 'POST' }).then(function(d) {
    if (d && d.status === 'freeze_applied') {
      toast('Streak freeze applied! Miss tomorrow without breaking your streak.', 's', 3000);
      document.getElementById('ag-streak-modal') && document.getElementById('ag-streak-modal').remove();
      loadStreak();
    } else {
      toast(d && d.error ? d.error : 'Freeze unavailable', 'e', 2500);
    }
  });
};

// ── Block C: Daily Digest ────────────────────────────────────────────────────
window.loadAllDigests = function() {
  rq('/api/agents/digest/all/today').then(function(d) {
    if (!d || !d.results) return;
    Object.keys(d.results).forEach(function(bid) {
      renderDigestInCard(bid, d.results[bid]);
    });
    if (d.streak) renderStreakBadge(d.streak);
  });
};

function renderDigestInCard(bid, data) {
  var body = document.getElementById('ag-body-' + bid);
  if (!body || !data.digest) return;
  var dg = data.digest;
  var top3Html = (dg.top3 || []).map(function(e) {
    var sev = e.severity || 5;
    var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#10B981';
    return '<div class="ag-ev-chip" style="--ev-col:' + col + '">'
      + '<span class="ag-ev-sev" style="color:' + col + ';background:' + col + '1a">' + sev.toFixed(0) + '</span>'
      + '<span class="ag-ev-title">' + (e.title || '').slice(0,50) + '</span></div>';
  }).join('');
  body.innerHTML = '<div class="ag-digest-badge">☀ Morning Digest</div>'
    + '<div class="ag-brief">' + (dg.summary || '') + '</div>'
    + (top3Html ? '<div class="ag-ev-chips">' + top3Html + '</div>' : '');
}

// ── Block C: Predict & Verify ────────────────────────────────────────────────
window.loadAllPredictions = function() {
  rq('/api/agents/predict/all/this-week').then(function(data) {
    if (!data) return;
    Object.keys(data).forEach(function(bid) {
      renderPredictionInCard(bid, data[bid]);
    });
  });
};

function renderPredictionInCard(bid, data) {
  if (!data || !data.prediction) return;
  var pred   = data.prediction;
  var verify = data.verify;
  var card   = document.getElementById('agent-card-' + bid);
  if (!card) return;

  var existing = card.querySelector('.ag-prediction-strip');
  if (existing) existing.remove();

  var dirColor = { bullish:'#10B981', bearish:'#F59E0B', critical:'#EF4444', volatile:'#8B5CF6', neutral:'#94A3B8' };
  var col = dirColor[pred.direction] || '#94A3B8';

  var verifyHtml = '';
  if (verify) {
    var oc = verify.outcome;
    var vcol = oc === 'correct' ? '#10B981' : oc === 'partial' ? '#F59E0B' : '#EF4444';
    var vicon = oc === 'correct' ? '✓' : oc === 'partial' ? '~' : '✗';
    verifyHtml = '<div class="ag-verify-result" style="color:' + vcol + '">'
      + vicon + ' ' + (verify.explanation || oc) + '</div>';
  }

  var strip = document.createElement('div');
  strip.className = 'ag-prediction-strip';
  strip.innerHTML = '<div class="ag-pred-label">📅 This week\'s prediction</div>'
    + '<div class="ag-pred-headline" style="border-left-color:' + col + '">' + pred.headline + '</div>'
    + '<div class="ag-pred-meta">'
    +  '<span class="ag-pred-dir" style="color:' + col + '">' + (pred.direction||'') + '</span>'
    +  '<span class="ag-pred-conf">' + (pred.confidence||'?') + '% confidence</span>'
    + '</div>'
    + verifyHtml;

  var footer = card.querySelector('.ag-footer');
  if (footer) card.insertBefore(strip, footer);
  else card.appendChild(strip);
}

// ── Config panel ─────────────────────────────────────────────────────────────
function buildConfigPanel(agent, cfg) {
  var bid = agent.id;
  var thr  = (cfg.severity_threshold || 6.5).toFixed(1);
  var wl   = (cfg.watch_regions || []).join(', ');
  var cn   = cfg.custom_notes || '';
  var fo   = (agent.focus_options  || []).map(function(f){ return '<option value="' + f + '"' + (cfg.focus   === f ? ' selected':'') + '>' + f + '</option>'; }).join('');
  var to   = (agent.tone_options   || []).map(function(t){ return '<option value="' + t + '"' + (cfg.tone    === t ? ' selected':'') + '>' + t + '</option>'; }).join('');
  var ao   = (agent.alert_options  || []).map(function(a){ return '<option value="' + a + '"' + (cfg.alerts  === a ? ' selected':'') + '>' + a + '</option>'; }).join('');
  return [
    '<div class="ag-config-panel" id="ag-cfg-' + bid + '" style="display:none">',
    '<div class="ag-cfg-title">Configure ' + agent.name + '</div>',
    '<div class="ag-cfg-row"><label class="ag-cfg-label">Focus Area</label><select class="ag-cfg-select" id="ag-focus-' + bid + '">' + fo + '</select></div>',
    '<div class="ag-cfg-row"><label class="ag-cfg-label">Response Tone</label><select class="ag-cfg-select" id="ag-tone-' + bid + '">' + to + '</select></div>',
    '<div class="ag-cfg-row"><label class="ag-cfg-label">Alert Filter</label><select class="ag-cfg-select" id="ag-alerts-' + bid + '">' + ao + '</select></div>',
    '<div class="ag-cfg-row ag-cfg-col">',
    ' <div style="display:flex;justify-content:space-between"><label class="ag-cfg-label">Alert Threshold</label><span class="ag-cfg-val-badge" id="ag-thresh-badge-' + bid + '">' + thr + '</span></div>',
    ' <input type="range" class="ag-cfg-range" id="ag-thresh-' + bid + '" min="4" max="10" step="0.5" value="' + thr + '" oninput="agentThresholdChange(\'' + bid + '\',this.value)">',
    ' <div class="ag-cfg-range-labels"><span>4.0</span><span>7.0</span><span>10.0</span></div>',
    '</div>',
    '<div class="ag-cfg-row ag-cfg-col"><label class="ag-cfg-label">Watch Regions <span class="ag-cfg-hint">(ISO codes, comma-sep)</span></label><input type="text" class="ag-cfg-input" id="ag-regions-' + bid + '" placeholder="US, DE, CN …" value="' + wl + '"></div>',
    '<div class="ag-cfg-row ag-cfg-col"><label class="ag-cfg-label">Personal Context <span class="ag-cfg-hint">(injected into prompt)</span></label><textarea class="ag-cfg-textarea" id="ag-notes-' + bid + '" rows="3" placeholder="e.g. I manage a European equity portfolio…">' + cn + '</textarea></div>',
    '<div class="ag-cfg-row" style="justify-content:space-between;align-items:center"><label class="ag-cfg-label">Bot Active</label><label class="ag-toggle"><input type="checkbox" id="ag-enabled-' + bid + '"' + (cfg.enabled !== false ? ' checked':'') + '><span class="ag-toggle-track"></span></label></div>',
    '<div class="ag-cfg-actions">',
    '<button class="ag-action-btn ag-btn-primary"  onclick="agentSaveConfig(\'' + bid + '\')">💾 Save</button>',
    '<button class="ag-action-btn ag-btn-ghost"    onclick="agentResetConfig(\'' + bid + '\')">↩ Reset</button>',
    '<button class="ag-action-btn ag-btn-ghost"    onclick="agentCloseConfig(\'' + bid + '\')">Cancel</button>',
    '</div></div>',
  ].join('');
}

// ── Config handlers ───────────────────────────────────────────────────────────
window.agentOpenConfig = function(bid) {
  if (_cfgOpen && _cfgOpen !== bid) agentCloseConfig(_cfgOpen);
  var p = document.getElementById('ag-cfg-' + bid);
  var c = document.getElementById('agent-card-' + bid);
  if (!p) return;
  var open = p.style.display === 'none';
  p.style.display = open ? 'block' : 'none';
  if (c) c.classList.toggle('ag-config-active', open);
  _cfgOpen = open ? bid : null;
};

window.agentCloseConfig = function(bid) {
  var p = document.getElementById('ag-cfg-' + bid);
  var c = document.getElementById('agent-card-' + bid);
  if (p) p.style.display = 'none';
  if (c) c.classList.remove('ag-config-active');
  if (_cfgOpen === bid) _cfgOpen = null;
};

window.agentThresholdChange = function(bid, val) {
  var b = document.getElementById('ag-thresh-badge-' + bid);
  if (b) b.textContent = parseFloat(val).toFixed(1);
};

window.agentSaveConfig = function(bid) {
  var f = document.getElementById('ag-focus-'   + bid);
  var t = document.getElementById('ag-tone-'    + bid);
  var a = document.getElementById('ag-alerts-'  + bid);
  var r = document.getElementById('ag-thresh-'  + bid);
  var g = document.getElementById('ag-regions-' + bid);
  var n = document.getElementById('ag-notes-'   + bid);
  var e = document.getElementById('ag-enabled-' + bid);
  if (!f) return;

  var regions = (g ? g.value : '').split(',').map(function(x){ return x.trim().toUpperCase(); }).filter(function(x){ return x.length >= 2; });
  var cfg = {
    focus: f.value, tone: t ? t.value : 'Professional',
    alerts: a ? a.value : 'High Impact Only',
    severity_threshold: r ? parseFloat(r.value) : 6.5,
    watch_regions: regions,
    custom_notes: n ? n.value.trim() : '',
    enabled: e ? e.checked : true,
  };

  rq('/api/agents/config/' + bid, { method: 'POST', body: cfg }).then(function(res) {
    if (res && res.status === 'saved') {
      if (AGENTS[bid]) AGENTS[bid].config = res.config;
      var fl = document.getElementById('ag-focus-lbl-' + bid);
      if (fl) fl.textContent = cfg.focus;
      var tv = document.getElementById('ag-thresh-val-' + bid);
      if (tv) tv.textContent = cfg.severity_threshold.toFixed(1);
      var card = document.getElementById('agent-card-' + bid);
      if (card) card.classList.toggle('ag-disabled', !cfg.enabled);
      agentCloseConfig(bid);
      if (cfg.enabled) loadOneBrief(bid);
      toast('Config saved', 's', 2000);
    } else { toast('Save failed', 'e', 2500); }
  });
};

window.agentResetConfig = function(bid) {
  rq('/api/agents/reset/' + bid, { method: 'POST' }).then(function(res) {
    if (res && res.config) {
      if (AGENTS[bid]) AGENTS[bid].config = res.config;
      agentCloseConfig(bid);
      var grid = document.getElementById('agents-grid');
      var old  = document.getElementById('agent-card-' + bid);
      if (grid && old && AGENTS[bid]) {
        var idx = Array.from(grid.children).indexOf(old);
        grid.replaceChild(buildCard(AGENTS[bid], idx >= 0 ? idx : 0), old);
      }
      loadOneBrief(bid);
      toast('Reset to defaults', 's', 2000);
    }
  });
};

window.agentAsk = function(bid) {
  var ag = AGENTS[bid]; if (!ag) return;
  sv('ai', document.querySelector('[data-v=ai]'));
  setTimeout(function() {
    var cfg   = ag.config || ag.defaults || {};
    var brief = ag.brief  || {};
    var evs   = (brief.top_events || []).slice(0,3).map(function(e){ return e.title; }).join('; ');
    var prompt = 'I am using ' + ag.name + ' focused on ' + cfg.focus + '. '
      + 'Current signal: ' + (brief.signal||'neutral') + '. '
      + (brief.headline ? 'Latest: ' + brief.headline + '. ' : '')
      + (evs ? 'Top events: ' + evs + '. ' : '')
      + 'Give me a deeper analysis and specific actionable insights.';
    if (typeof aiSend === 'function') aiSend(prompt);
  }, 300);
};

window.refreshAgentBriefs = loadAllBriefs;

})();
