/**
 * @file 10_stubs.js
 * @module WorldLens/Stubs & Secondary Features
 *
 * @description
 * Implementations for all onclick handlers called from HTML that were
 * previously missing. Grouped by feature area:
 *
 *  1. Onboarding flow        (obBack, obNext, skipOnboarding)
 *  2. Tutorial system        (startTutorial, tutBack, tutNext, skipTutorial)
 *  3. User profile           (saveProfile, toggleEdit, setLayout)
 *  4. Investment preferences (selectRisk, selHorizon, togFocus)
 *  5. Watchlist              (addWL)
 *  6. Alerts                 (addAlert, quickAlert)
 *  7. Map overlays           (toggleSentimentOverlay, applyTimelineFilter)
 *  8. AI chat                (aiSend)
 *  9. Macro view             (setMacroTab, getMacroBrief, loadDigest)
 * 10. Early Warning          (loadEarlyWarning, loadEWSignals)
 * 11. Predictions            (loadPredictions, makePrediction)
 * 12. Portfolio              (generatePortfolio, loadPortfolios)
 * 13. Risk Radar             (openRiskRadar, shareRadar)
 * 14. Missions / Reports     (loadMissions, loadWeeklyReport)
 * 15. Event panel            (runSentimentFull, toggleEdit)
 *
 * @dependencies 01_globals.js, 02_core.js
 */

// ── 1. ONBOARDING FLOW ────────────────────────────────────────

var OB = { step: 1, maxStep: 5 };

function obNext() {
  var overlay = el('ob-overlay');
  if (!overlay) return;
  OB.step = Math.min(OB.step + 1, OB.maxStep);
  _obRender();
}

function obBack() {
  OB.step = Math.max(OB.step - 1, 1);
  _obRender();
}

function skipOnboarding() {
  var overlay = el('ob-overlay');
  if (overlay) overlay.style.display = 'none';
  // Save preference to avoid showing again
  try { localStorage.setItem('wl_ob_done', '1'); } catch(e) {}
  toast('Welcome to WorldLens!', 's');
}

function _obRender() {
  var backBtn = el('ob-back');
  var nextBtn = el('ob-next');
  var progEl  = el('ob-progress');
  if (backBtn) backBtn.style.display = OB.step > 1 ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.textContent   = OB.step >= OB.maxStep ? 'Get Started' : 'Next';
  if (progEl)  progEl.textContent    = OB.step + ' / ' + OB.maxStep;
  // Step panels: show/hide .ob-step elements by data-step
  document.querySelectorAll('[data-step]').forEach(function(el) {
    el.style.display = (parseInt(el.dataset.step) === OB.step) ? 'block' : 'none';
  });
  if (OB.step >= OB.maxStep && nextBtn) {
    nextBtn.onclick = skipOnboarding;
  }
}

// ── 2. TUTORIAL SYSTEM ────────────────────────────────────────

var TUT = {
  active: false,
  step:   0,
  steps: [
    { target: '#view-map',    title: 'Global Events Map',    text: 'Real-time events plotted on the map. Zoom in to see individual news, clusters on zoom-out.' },
    { target: '#mleft',       title: 'Risk Panel',           text: 'Filter events by category, track live stats and zoom density.' },
    { target: '#map-toolbar', title: 'Map Modes',            text: 'Switch between Events, Heatmap, Knowledge Graph and Timeline views.' },
    { target: '#nav-markets', title: 'Quantitative Lab',     text: 'Full quant analytics: Monte Carlo forecasts, backtesting, factor regression, PCA.' },
    { target: '#nav-feed',    title: 'News Feed',            text: 'Curated intelligence feed sorted by relevance and severity.' },
  ],
};

function startTutorial() {
  TUT.active = true;
  TUT.step   = 0;
  var overlay = el('tut-overlay');
  if (overlay) overlay.style.display = 'block';
  _tutRender();
}

function tutNext() {
  TUT.step++;
  if (TUT.step >= TUT.steps.length) { skipTutorial(); return; }
  _tutRender();
}

function tutBack() {
  TUT.step = Math.max(0, TUT.step - 1);
  _tutRender();
}

function skipTutorial() {
  TUT.active = false;
  var overlay = el('tut-overlay');
  if (overlay) overlay.style.display = 'none';
  var spotlight = el('tut-spotlight');
  if (spotlight) spotlight.style.display = 'none';
  var popup = el('tut-popup');
  if (popup) popup.style.display = 'none';
  try { localStorage.setItem('wl_tut_done', '1'); } catch(e) {}
}

function _tutRender() {
  var step     = TUT.steps[TUT.step];
  var progEl   = el('tut-prog');
  var titleEl  = el('tut-title');
  var textEl   = el('tut-text');
  var popup    = el('tut-popup');
  var spotlight= el('tut-spotlight');
  var backBtn  = el('tut-back');
  var nextBtn  = el('tut-next');
  if (progEl)  progEl.textContent  = (TUT.step + 1) + '/' + TUT.steps.length;
  if (titleEl) titleEl.textContent = step.title;
  if (textEl)  textEl.textContent  = step.text;
  if (nextBtn) nextBtn.textContent = TUT.step >= TUT.steps.length - 1 ? 'Finish' : 'Next →';
  if (backBtn) backBtn.style.display = TUT.step > 0 ? '' : 'none';
  // Highlight target element
  var target = document.querySelector(step.target);
  if (target && spotlight && popup) {
    var rect = target.getBoundingClientRect();
    spotlight.style.cssText = 'display:block;position:fixed;top:' + (rect.top - 8) + 'px;left:'
      + (rect.left - 8) + 'px;width:' + (rect.width + 16) + 'px;height:' + (rect.height + 16) + 'px;';
    popup.style.cssText = 'display:block;position:fixed;top:' + Math.min(rect.bottom + 16, window.innerHeight - 160)
      + 'px;left:' + Math.max(16, Math.min(rect.left, window.innerWidth - 320)) + 'px;';
  }
}

// ── 3. USER PROFILE ───────────────────────────────────────────

var _profileEditMode = false;

function toggleEdit() {
  _profileEditMode = !_profileEditMode;
  var nameEl  = el('pname');
  var emailEl = el('pemail');
  if (!nameEl) return;
  if (_profileEditMode) {
    var nameInput  = '<input id="pname-inp" value="' + (nameEl.textContent || '') + '" style="background:var(--bg3);border:1px solid var(--bdb);border-radius:var(--r8);padding:3px 8px;color:var(--t1);font-size:inherit;width:100%">';
    var emailInput = emailEl ? '<input id="pemail-inp" value="' + (emailEl.textContent || '') + '" style="background:var(--bg3);border:1px solid var(--bdb);border-radius:var(--r8);padding:3px 8px;color:var(--t1);font-size:10px;width:100%">' : '';
    nameEl.innerHTML = nameInput;
    if (emailEl) emailEl.innerHTML = emailInput;
  } else {
    saveProfile();
  }
}

function saveProfile() {
  var nameInp  = el('pname-inp');
  var emailInp = el('pemail-inp');
  var nameEl   = el('pname');
  var emailEl  = el('pemail');
  var newName  = nameInp  ? nameInp.value.trim()  : (nameEl  ? nameEl.textContent  : '');
  var newEmail = emailInp ? emailInp.value.trim()  : (emailEl ? emailEl.textContent : '');
  if (nameEl)  nameEl.textContent  = newName  || 'User';
  if (emailEl) emailEl.textContent = newEmail || '';
  _profileEditMode = false;
  // Persist via API
  rq('/api/user/profile', { method: 'POST', body: { display_name: newName, email: newEmail } })
    .then(function(r) { if (r && !r.error) toast('Profile saved', 's'); });
}

function setLayout(layout, btn) {
  // Toggle active state on layout buttons
  document.querySelectorAll('.layout-btn').forEach(function(b) { b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  // Store preference
  G.layout = layout;
  try { localStorage.setItem('wl_layout', layout); } catch(e) {}
  toast('Layout: ' + layout, 's');
}

// ── 4. INVESTMENT PREFERENCES ────────────────────────────────

function selectRisk(level) {
  G.portState = G.portState || {};
  G.portState.risk = level;
  // Highlight the selected button
  ['Conservative','Moderate','Aggressive'].forEach(function(r) {
    var btn = el('risk-' + r);
    if (btn) btn.className = btn.className.replace(/btn-[opg]\b/, r === level ? 'btn-p' : 'btn-g');
  });
  toast('Risk profile: ' + level, 's');
}

function selHorizon(horizon, btn) {
  G.portState = G.portState || {};
  G.portState.horizon = horizon;
  document.querySelectorAll('[id^="hor-"]').forEach(function(b) {
    b.classList.remove('on');
    b.className = b.className.replace('btn-o', 'btn-g');
  });
  if (btn) { btn.className = btn.className.replace('btn-g', 'btn-o'); btn.classList.add('on'); }
  toast('Horizon: ' + horizon, 's');
}

function togFocus(el_) {
  if (!el_) return;
  el_.classList.toggle('on');
  var focus = el_.dataset.focus;
  G.portState = G.portState || {};
  G.portState.focuses = G.portState.focuses || [];
  var idx = G.portState.focuses.indexOf(focus);
  if (idx > -1) G.portState.focuses.splice(idx, 1);
  else          G.portState.focuses.push(focus);
}

// ── 5. WATCHLIST ──────────────────────────────────────────────

function addWL() {
  var inp = el('wl-inp');
  if (!inp) return;
  var val = inp.value.trim();
  if (!val) { toast('Enter a country, region or topic', 'w'); return; }
  rq('/api/user/watchlist', { method: 'POST', body: { value: val, label: val, type: 'text' } })
    .then(function(r) {
      if (r && !r.error) {
        inp.value = '';
        toast(val + ' added to watchlist', 's');
        if (typeof loadData === 'function') loadData();
      } else {
        toast(r && r.error ? r.error : 'Failed to add', 'e');
      }
    });
}

// ── 6. ALERTS ─────────────────────────────────────────────────

function addAlert() {
  var kw  = el('alert-kw');
  var thr = el('alert-thr');
  if (!kw) return;
  var keyword   = kw.value.trim();
  var threshold = thr ? parseFloat(thr.value) || 7.0 : 7.0;
  if (!keyword) { toast('Enter a keyword for the alert', 'w'); return; }
  rq('/api/user/alerts', { method: 'POST', body: { keyword: keyword, threshold: threshold } })
    .then(function(r) {
      if (r && !r.error) {
        kw.value  = '';
        if (thr) thr.value = '7';
        toast('Alert created: "' + keyword + '"', 's');
      } else {
        toast('Failed to create alert', 'e');
      }
    });
}

function quickAlert() {
  var ev = G.panelEv;
  if (!ev) { toast('Open an event first', 'w'); return; }
  rq('/api/user/alerts', {
    method: 'POST',
    body: { keyword: ev.country_name || ev.category, threshold: ev.severity - 1 }
  }).then(function(r) {
    toast(r && !r.error ? 'Alert set for ' + (ev.country_name || ev.category) : 'Failed', r && !r.error ? 's' : 'e');
  });
}

// ── 7. MAP OVERLAYS ───────────────────────────────────────────

var _sentOverlayOn = false;

function toggleSentimentOverlay() {
  _sentOverlayOn = !_sentOverlayOn;
  var btn = el('mtool-sent');
  if (btn) btn.classList.toggle('on', _sentOverlayOn);

  if (_sentOverlayOn) {
    // Tint markers by sentiment color
    if (G.events && G.events.length) {
      var posCount = G.events.filter(function(e) { return (e.sentiment_score || 0) > 0.2; }).length;
      var negCount = G.events.filter(function(e) { return (e.sentiment_score || 0) < -0.2; }).length;
      toast('Sentiment: ' + posCount + ' positive · ' + negCount + ' negative', 's');
    }
    updateMarkers();
  } else {
    updateMarkers();
  }
}

function applyTimelineFilter() {
  var fromEl = el('tl-from');
  var toEl   = el('tl-to');
  var from   = fromEl ? fromEl.value : '';
  var to     = toEl   ? toEl.value   : '';
  if (from || to) {
    G.filt = G.filt || {};
    G.filt.dateFrom = from;
    G.filt.dateTo   = to;
    updateMarkers();
    toast('Timeline filter applied', 's');
  }
}

// ── 8. AI CHAT ────────────────────────────────────────────────

function aiSend(prompt) {
  var inp     = el('ai-inp');
  var msgText = (prompt || (inp ? inp.value.trim() : ''));
  if (!msgText) return;
  if (inp) inp.value = '';
  var chatEl = el('ai-chat') || el('ai-messages');
  if (chatEl) {
    chatEl.innerHTML += '<div style="text-align:right;margin:6px 0"><span style="background:var(--b6);color:#fff;border-radius:var(--r8);padding:5px 10px;font-size:11px;display:inline-block;max-width:80%">' + msgText + '</span></div>';
    chatEl.innerHTML += '<div id="ai-loading" style="margin:6px 0;font-size:11px;color:var(--t3)">Thinking…</div>';
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  var context = G.panelEv
    ? 'Current event: ' + G.panelEv.title + ' (' + G.panelEv.country_name + ', ' + G.panelEv.category + ')'
    : 'Global intelligence platform';
  rq('/api/intelligence/answer', { method: 'POST', body: { question: msgText, context: context } })
    .then(function(r) {
      var loading = el('ai-loading');
      if (loading) loading.remove();
      var answer = (r && (r.answer || r.response)) || 'AI analysis not available. Configure a provider in Admin → Settings.';
      if (chatEl) {
        chatEl.innerHTML += '<div style="margin:6px 0"><span style="background:var(--bg3);border:1px solid var(--bdb);border-radius:var(--r8);padding:5px 10px;font-size:11px;display:inline-block;max-width:90%;line-height:1.6">' + answer + '</span></div>';
        chatEl.scrollTop = chatEl.scrollHeight;
      }
    });
}

// ── 9. MACRO VIEW ─────────────────────────────────────────────

function setMacroTab(tab, btn) {
  G.macroTab = tab;
  document.querySelectorAll('.macro-tab').forEach(function(b) { b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  // Filter macro events list if present
  var list = el('macro-events') || el('macro-list');
  if (!list) return;
  var items = list.querySelectorAll('[data-cat]');
  items.forEach(function(item) {
    item.style.display = (tab === 'all' || item.dataset.cat === tab) ? '' : 'none';
  });
}

function getMacroBrief() {
  var btn = el('macro-ai-btn') || document.querySelector('[onclick="getMacroBrief()"]');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  rq('/api/intelligence/macro-brief', { method: 'POST' })
    .then(function(r) {
      if (btn) { btn.textContent = 'AI Briefing'; btn.disabled = false; }
      var brief = r && (r.briefing || r.text);
      if (brief) {
        var box = el('macro-brief') || el('macro-ai-box');
        if (box) {
          box.style.display = 'block';
          var txt = box.querySelector('.step-ai-text') || box;
          txt.textContent = brief;
        } else {
          toast('Macro brief ready', 's');
        }
      }
    });
}

function loadDigest() {
  var btn = document.querySelector('[onclick="loadDigest()"]');
  if (btn) { btn.textContent = 'Loading…'; btn.disabled = true; }
  rq('/api/intelligence/watchlist-digest', { method: 'POST' })
    .then(function(r) {
      if (btn) { btn.textContent = 'My Digest'; btn.disabled = false; }
      var digest = r && (r.digest || r.text);
      var box = el('digest-box') || el('digest-text');
      if (digest && box) {
        box.style.display = 'block';
        box.textContent   = digest;
      } else if (digest) {
        toast('Digest: ' + digest.slice(0, 80) + '…', 's');
      }
    });
}

// ── 10. EARLY WARNING ─────────────────────────────────────────

function loadEarlyWarning(force) {
  var container = el('ew-container') || el('view-earlywarning');
  var loadingEl = el('ew-loading');
  if (loadingEl) loadingEl.style.display = 'block';

  rq('/api/events?sort=severity&limit=20&min_severity=7')
    .then(function(r) {
      if (loadingEl) loadingEl.style.display = 'none';
      var events = (r && (r.events || r)) || [];
      var listEl = el('ew-signals') || el('ew-list');
      if (!listEl) return;
      if (!events.length) {
        listEl.innerHTML = '<div style="color:var(--t3);padding:12px;font-size:11px">No critical events detected.</div>';
        return;
      }
      listEl.innerHTML = events.slice(0, 10).map(function(ev) {
        var cat  = CATS[ev.category] || CATS.GEOPOLITICS;
        var col  = ev.severity >= 8 ? 'var(--re)' : ev.severity >= 6 ? 'var(--am)' : 'var(--b4)';
        return '<div style="display:flex;align-items:flex-start;gap:8px;padding:8px;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer" onclick="openEP(\'' + ev.id + '\')">'
          + '<span style="font-size:16px;flex-shrink:0">' + cat.i + '</span>'
          + '<div style="flex:1;min-width:0">'
          + '<div style="font-size:11px;font-weight:600;color:var(--t1)">' + ev.title + '</div>'
          + '<div style="font-size:9px;color:var(--t3);margin-top:2px">' + (ev.country_name || '') + ' · ' + ev.category + '</div>'
          + '</div>'
          + '<span style="font-size:12px;font-weight:700;color:' + col + ';flex-shrink:0">' + (ev.severity || 0).toFixed(1) + '</span>'
          + '</div>';
      }).join('');
    });
}

function loadEWSignals() {
  loadEarlyWarning(true);
}

// ── 11. PREDICTIONS ───────────────────────────────────────────

function loadPredictions() {
  rq('/api/engage/predictions')
    .then(function(r) {
      var list = el('pred-list');
      if (!list || !r) return;
      var preds = r.predictions || r || [];
      if (!preds.length) {
        list.innerHTML = '<div style="color:var(--t3);font-size:11px">No predictions yet. Be the first!</div>';
        return;
      }
      list.innerHTML = preds.slice(0, 5).map(function(p) {
        var col = p.direction === 'up' ? 'var(--gr)' : p.direction === 'down' ? 'var(--re)' : 'var(--am)';
        return '<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:10px">'
          + '<span style="color:var(--t2)">' + p.label + '</span>'
          + '<span style="color:' + col + ';font-weight:600">' + (p.direction || p.outcome || '') + '</span>'
          + '</div>';
      }).join('');
    });
}

function makePrediction(direction) {
  var ev = G.panelEv;
  if (!ev) { toast('Open an event to make a prediction', 'w'); return; }
  rq('/api/engage/predictions', {
    method: 'POST',
    body: { event_id: ev.id, label: ev.title.slice(0, 60), direction: direction }
  }).then(function(r) {
    toast(r && !r.error ? 'Prediction recorded: ' + direction : 'Failed to record', r && !r.error ? 's' : 'e');
    loadPredictions();
  });
}

// ── 12. PORTFOLIO ─────────────────────────────────────────────

function generatePortfolio() {
  var riskEl = document.querySelector('[id^="risk-"].btn-p,[id^="risk-"].btn-o');
  var risk   = G.portState && G.portState.risk   ? G.portState.risk   : 'Moderate';
  var horizon= G.portState && G.portState.horizon ? G.portState.horizon : 'Medium-term (3-5 years)';
  var focuses= G.portState && G.portState.focuses ? G.portState.focuses : [];
  var btn    = document.querySelector('[onclick="generatePortfolio()"]');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  rq('/api/portfolio/generate', {
    method: 'POST',
    body: { risk_level: risk, horizon: horizon, focuses: focuses, events: G.events.slice(0, 10) }
  }).then(function(r) {
    if (btn) { btn.textContent = 'Generate AI Portfolio'; btn.disabled = false; }
    if (r && (r.portfolio || r.recommendation)) {
      var resultEl = el('portfolio-result') || el('port-result');
      if (resultEl) {
        resultEl.style.display = 'block';
        var p = r.portfolio || r.recommendation;
        resultEl.innerHTML = typeof p === 'string'
          ? '<div style="font-size:11px;line-height:1.6;color:var(--t2)">' + p + '</div>'
          : '<pre style="font-size:10px;color:var(--t2)">' + JSON.stringify(p, null, 2) + '</pre>';
      } else {
        sv('markets');
      }
    }
  });
}

function loadPortfolios() {
  rq('/api/portfolio/history')
    .then(function(r) {
      var list = el('port-history-list') || el('portfolio-list');
      if (!list || !r) return;
      var items = r.portfolios || r || [];
      if (!items.length) {
        list.innerHTML = '<div style="color:var(--t3);font-size:11px">No portfolio history.</div>';
        return;
      }
      list.innerHTML = items.slice(0, 5).map(function(p) {
        return '<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:10px;color:var(--t2)">'
          + (p.name || p.title || 'Portfolio') + ' · ' + (p.date || p.created_at || '') + '</div>';
      }).join('');
    });
}

// ── 13. RISK RADAR ────────────────────────────────────────────

function openRiskRadar() {
  var overlay = el('radar-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    return;
  }
  // Fallback: navigate to intelligence view
  sv('intelligence');
  toast('Risk Radar — Intelligence view', 's');
}

function shareRadar() {
  var text = 'WorldLens Risk Radar — ' + new Date().toLocaleDateString()
    + '\nTop threats: ' + G.events.slice(0, 3).map(function(e) { return e.title; }).join(' | ');
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(function() {
      toast('Radar summary copied to clipboard', 's');
    });
  } else {
    toast('Share: ' + text.slice(0, 60) + '…', 's');
  }
}

// ── 14. MISSIONS & REPORTS ────────────────────────────────────

function loadMissions() {
  rq('/api/engage/missions')
    .then(function(r) {
      var list = el('missions-list') || el('missions-container');
      if (!list || !r) return;
      var missions = r.missions || r || [];
      var progEl   = el('missions-prog');
      var done     = missions.filter(function(m) { return m.completed; }).length;
      if (progEl) progEl.textContent = done + '/' + missions.length;
      list.innerHTML = missions.map(function(m) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
          + '<span style="font-size:14px">' + (m.completed ? '✅' : '⭕') + '</span>'
          + '<div style="flex:1"><div style="font-size:11px;color:' + (m.completed?'var(--t3)':'var(--t1)') + '">' + m.title + '</div>'
          + '<div style="font-size:9px;color:var(--t3)">' + (m.xp || 0) + ' XP</div></div></div>';
      }).join('');
    });
}

function loadWeeklyReport() {
  var btn = document.querySelector('[onclick="loadWeeklyReport()"]');
  if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
  rq('/api/intelligence/weekly-report', { method: 'POST' })
    .then(function(r) {
      if (btn) { btn.textContent = 'Generate This Week\'s Report'; btn.disabled = false; }
      var report = r && (r.report || r.text);
      if (report) {
        var box = el('weekly-report-box');
        if (box) {
          box.style.display = 'block';
          box.querySelector('.step-ai-text') ? box.querySelector('.step-ai-text').textContent = report
            : box.textContent = report;
        } else {
          toast('Weekly report ready', 's');
        }
      }
    });
}

// ── 15. FULL SENTIMENT & MISC ─────────────────────────────────

function runSentimentFull() {
  // Full sentiment run on all recent events (batch)
  var btn = document.querySelector('[onclick="runSentimentFull()"]');
  if (btn) { btn.textContent = 'Analyzing…'; btn.disabled = true; }
  rq('/api/events/sentiment/batch?hours=24&limit=30')
    .then(function(r) {
      if (btn) { btn.textContent = 'Analyze Sentiment (All)'; btn.disabled = false; }
      if (r && r.results) {
        toast('Sentiment analysis complete: ' + r.results.length + ' events', 's');
        // Merge results back into G.events
        r.results.forEach(function(res) {
          var ev = G.events.find(function(e) { return e.id === res.id; });
          if (ev) {
            ev.sentiment_score = res.sentiment_score;
            ev.sentiment_tone  = res.sentiment_tone;
          }
        });
        updateMarkers();
      }
    });
}

// ═══════════════════════════════════════════════════════════
// MAP INNOVATIONS — search, breaking news, country panel,
//                   event panel tabs, legend, keyboard nav
// ═══════════════════════════════════════════════════════════

// ── Breaking news ────────────────────────────────────────────

var _breakingEv = null;

function checkBreakingNews() {
  if (!G.events || !G.events.length) return;
  var top = G.events
    .filter(function(e){ return e.severity >= 8.5; })
    .sort(function(a,b){ return new Date(b.timestamp)-new Date(a.timestamp); })[0];
  if (!top) return;
  // Only show if newer than 3h and different from last shown
  var age = (Date.now() - new Date(top.timestamp).getTime()) / 3600000;
  if (age > 3) return;
  if (_breakingEv && _breakingEv.id === top.id) return;
  _breakingEv = top;
  var banner = document.getElementById('map-breaking');
  var text   = document.getElementById('map-breaking-text');
  if (banner && text) {
    text.textContent = top.title;
    banner.style.display = 'flex';
    setTimeout(function(){ if(banner) banner.style.display='none'; }, 12000);
  }
}

function openBreakingEvent() {
  if (_breakingEv) {
    var banner = document.getElementById('map-breaking');
    if (banner) banner.style.display = 'none';
    openEP(_breakingEv.id);
  }
}

// ── Map search ────────────────────────────────────────────────

var _searchTimer = null;
var _searchIdx   = -1;

function mapSearchInput(val) {
  var clear = document.getElementById('map-search-clear');
  if (clear) clear.style.display = val ? 'block' : 'none';
  clearTimeout(_searchTimer);
  if (!val.trim()) { _closeSearch(); return; }
  _searchTimer = setTimeout(function(){ _runSearch(val.trim()); }, 180);
}

function mapSearchKey(e) {
  var results = document.getElementById('map-search-results');
  var items   = results ? results.querySelectorAll('.msr-item') : [];
  if (e.key === 'Escape') { mapSearchClear(); return; }
  if (e.key === 'ArrowDown') {
    _searchIdx = Math.min(_searchIdx + 1, items.length - 1);
    _highlightSearchItem(items);
  } else if (e.key === 'ArrowUp') {
    _searchIdx = Math.max(_searchIdx - 1, -1);
    _highlightSearchItem(items);
  } else if (e.key === 'Enter' && _searchIdx >= 0 && items[_searchIdx]) {
    items[_searchIdx].click();
  }
}

function _highlightSearchItem(items) {
  items.forEach(function(it, i){ it.classList.toggle('highlighted', i === _searchIdx); });
}

function mapSearchClear() {
  var inp = document.getElementById('map-search-inp');
  var clr = document.getElementById('map-search-clear');
  if (inp) inp.value = '';
  if (clr) clr.style.display = 'none';
  _closeSearch();
}

function _closeSearch() {
  var r = document.getElementById('map-search-results');
  if (r) { r.innerHTML = ''; r.classList.remove('open'); }
  _searchIdx = -1;
}

function _runSearch(query) {
  var q       = query.toLowerCase();
  var results = document.getElementById('map-search-results');
  if (!results) return;

  // Search events
  var evMatches = (G.events || []).filter(function(e) {
    return e.title.toLowerCase().includes(q) ||
           (e.country_name||'').toLowerCase().includes(q) ||
           e.category.toLowerCase().includes(q) ||
           (e.summary||'').toLowerCase().includes(q);
  }).slice(0, 8);

  // Search countries (from events)
  var countryMap = {};
  (G.events || []).forEach(function(e) {
    if (!e.country_name || e.country_code === 'XX') return;
    if (!e.country_name.toLowerCase().includes(q) &&
        !e.country_code.toLowerCase().includes(q)) return;
    if (!countryMap[e.country_code]) {
      countryMap[e.country_code] = { name:e.country_name, code:e.country_code,
                                     lat:e.latitude, lon:e.longitude, count:0 };
    }
    countryMap[e.country_code].count++;
  });
  var cMatches = Object.values(countryMap).sort(function(a,b){ return b.count-a.count; }).slice(0,4);

  var html = '';

  // Countries section
  if (cMatches.length) {
    html += '<div class="msr-section">Countries</div>';
    html += cMatches.map(function(c) {
      return '<div class="msr-item" onclick="mapFocusCountry(\'' + c.code + '\')">'
        + '<div class="msr-icon" style="background:rgba(59,130,246,.1)">🌍</div>'
        + '<div><div class="msr-title">' + c.name + '</div>'
        + '<div class="msr-sub">' + c.count + ' active events · ' + c.code + '</div></div>'
        + '</div>';
    }).join('');
  }

  // Events section
  if (evMatches.length) {
    html += '<div class="msr-section">Events</div>';
    html += evMatches.map(function(e) {
      var m   = CATS[e.category] || CATS.GEOPOLITICS;
      var col = e.severity >= 7 ? '#EF4444' : e.severity >= 5 ? '#F59E0B' : '#10B981';
      return '<div class="msr-item" onclick="mapSearchSelect(\'' + e.id + '\')">'
        + '<div class="msr-icon" style="background:' + m.c + '22">' + m.i + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '<div class="msr-title">' + e.title.slice(0,55) + (e.title.length>55?'…':'') + '</div>'
        + '<div class="msr-sub">' + (e.country_name||'Global') + ' · ' + e.category + '</div>'
        + '</div>'
        + '<div class="msr-sev" style="color:' + col + '">' + e.severity.toFixed(1) + '</div>'
        + '</div>';
    }).join('');
  }

  if (!html) {
    html = '<div class="msr-empty">No results for "' + query + '"</div>';
  }

  results.innerHTML = html;
  results.classList.add('open');
  _searchIdx = -1;
}

function mapSearchSelect(id) {
  mapSearchClear();
  openEP(id);
  // Fly to marker
  var ev = G.events.find(function(e){ return e.id === id; });
  if (ev && G.map && ev.latitude && ev.longitude) {
    G.map.flyTo([ev.latitude, ev.longitude], Math.max(G.map.getZoom(), 6), {duration:1});
  }
}

// Close search on outside click
document.addEventListener('click', function(e) {
  var bar = document.getElementById('map-search-bar');
  if (bar && !bar.contains(e.target)) _closeSearch();
});

// ── Map legend ────────────────────────────────────────────────

var _legendOpen = false;

function toggleMapLegend() {
  var popup = document.getElementById('map-legend-popup');
  if (!popup) return;
  _legendOpen = !_legendOpen;
  if (_legendOpen) {
    popup.innerHTML = _buildLegendHTML();
    popup.style.display = 'block';
  } else {
    popup.style.display = 'none';
  }
  var btn = document.getElementById('mtool-legend');
  if (btn) btn.classList.toggle('on', _legendOpen);
}

function _buildLegendHTML() {
  var catRows = Object.entries(CATS).map(function(pair) {
    var k = pair[0], v = pair[1];
    return '<div class="legend-item">'
      + '<span class="legend-emoji">' + v.i + '</span>'
      + '<span class="legend-label" style="color:' + v.c + '">' + k + '</span>'
      + '</div>';
  }).join('');

  return '<div class="legend-title">Category Icons</div>'
    + '<div class="legend-grid">' + catRows + '</div>'
    + '<div class="legend-divider"></div>'
    + '<div class="legend-title">Severity</div>'
    + '<div class="legend-sev-row"><div class="legend-sev-dot" style="background:#EF4444"></div><span style="font-size:10px;color:var(--t2)">High (7.0+) — pulsing ring</span></div>'
    + '<div class="legend-sev-row"><div class="legend-sev-dot" style="background:#F59E0B"></div><span style="font-size:10px;color:var(--t2)">Medium (4.0–7.0)</span></div>'
    + '<div class="legend-sev-row"><div class="legend-sev-dot" style="background:#10B981"></div><span style="font-size:10px;color:var(--t2)">Low (&lt;4.0)</span></div>'
    + '<div class="legend-divider"></div>'
    + '<div class="legend-title">Map Modes</div>'
    + '<div style="font-size:10px;color:var(--t2);line-height:1.7">'
    + '🗺 <b>Map</b> — live event markers<br>'
    + '🌡 <b>Heat</b> — density heatmap<br>'
    + '🕸 <b>Graph</b> — event relationships<br>'
    + '⏱ <b>Timeline</b> — 48h event strip'
    + '</div>'
    + '<div class="legend-divider"></div>'
    + '<div style="font-size:9px;color:var(--t3);line-height:1.5">'
    + '🔵 dot on marker = focus-boosted · badge number = grouped sources'
    + '</div>'
    + '<button class="legend-close" onclick="toggleMapLegend()">Close Legend</button>';
}

// ── Country panel ─────────────────────────────────────────────

var currentCountry = null;

function mapFocusCountry(code) {
  if (!code || code === 'XX') return;
  currentCountry = code;
  mapSearchClear();

  // Fly to country
  var evs  = (G.events || []).filter(function(e){ return e.country_code === code; });
  if (evs.length && G.map) {
    var lat = evs.reduce(function(s,e){ return s+e.latitude; }, 0) / evs.length;
    var lon = evs.reduce(function(s,e){ return s+e.longitude; }, 0) / evs.length;
    G.map.flyTo([lat, lon], 5, {duration:1.2});
  }

  openCountryPanel(code);
}

function openCountryPanel(code) {
  var panel = document.getElementById('country-panel');
  if (!panel) return;
  panel.classList.add('on');

  // Close event panel if open
  closeEP();

  // Header
  var evs     = (G.events || []).filter(function(e){ return e.country_code === code; });
  var name    = evs.length ? evs[0].country_name : code;
  document.getElementById('cp-name').textContent = name;
  document.getElementById('cp-code').textContent = code + ' · ' + evs.length + ' active events';

  // Try to show flag emoji
  var flag = '';
  if (code.length === 2) {
    var codePoints = code.toUpperCase().split('').map(function(c){
      return 127397 + c.charCodeAt(0);
    });
    try { flag = String.fromCodePoint.apply(String, codePoints); } catch(e){}
  }
  document.getElementById('cp-flag').textContent = flag;

  // Risk score from events
  var avgSev = evs.length
    ? evs.reduce(function(s,e){ return s+e.severity; }, 0) / evs.length
    : 0;
  var maxSev = evs.length ? Math.max.apply(null, evs.map(function(e){return e.severity;})) : 0;
  var riskScore = Math.round((avgSev * 0.4 + maxSev * 0.6));
  var riskEl = document.getElementById('cp-risk-score');
  var riskBar = document.getElementById('cp-risk-bar');
  var riskLbl = document.getElementById('cp-risk-label');
  var riskCol = maxSev >= 7 ? 'var(--re)' : maxSev >= 5 ? 'var(--am)' : 'var(--gr)';
  if (riskEl)  { riskEl.textContent = riskScore; riskEl.style.color = riskCol; }
  if (riskBar) { riskBar.style.width = (riskScore * 10) + '%'; riskBar.style.background = riskCol; }
  if (riskLbl) { riskLbl.textContent = maxSev >= 7 ? 'Elevated risk' : maxSev >= 5 ? 'Moderate risk' : 'Low risk'; }

  // Top events list
  var listEl = document.getElementById('cp-events-list');
  if (listEl) {
    var top = evs.slice().sort(function(a,b){ return b.severity-a.severity; }).slice(0,6);
    if (top.length) {
      listEl.innerHTML = top.map(function(e) {
        var m   = CATS[e.category] || CATS.GEOPOLITICS;
        var col = e.severity >= 7 ? 'var(--re)' : e.severity >= 5 ? 'var(--am)' : 'var(--gr)';
        return '<div class="cp-ev-row" onclick="openEP(\'' + e.id + '\')">'
          + '<span style="font-size:13px;flex-shrink:0">' + m.i + '</span>'
          + '<div style="flex:1;min-width:0">'
          + '<div class="cp-ev-title">' + e.title.slice(0,52) + (e.title.length>52?'…':'') + '</div>'
          + '<div style="font-size:9px;color:var(--t3)">' + e.category + ' · ' + tAgo(new Date(e.timestamp)) + '</div>'
          + '</div>'
          + '<div class="cp-ev-sev" style="color:' + col + '">' + e.severity.toFixed(1) + '</div>'
          + '</div>';
      }).join('');
    } else {
      listEl.innerHTML = '<div style="font-size:10px;color:var(--t3);padding:4px 0">No events in database for this country.</div>';
    }
  }

  // Load macro indicators for this country from API
  rq('/api/events/region/' + code + '/risk').then(function(r) {
    if (!r) return;
    var macroSec = document.getElementById('cp-macro-section');
    var macroList = document.getElementById('cp-macro-list');
    if (!macroSec || !macroList) return;
    var indicators = [];
    if (r.event_count !== undefined)  indicators.push({l:'Active Events', v: r.event_count});
    if (r.avg_severity !== undefined) indicators.push({l:'Avg Severity',  v: r.avg_severity.toFixed(1)});
    if (r.risk_score !== undefined)   indicators.push({l:'Risk Score',    v: r.risk_score});
    if (r.categories) {
      var cats = Object.entries(r.categories).sort(function(a,b){ return b[1]-a[1]; });
      if (cats.length) indicators.push({l:'Top Category', v: cats[0][0]});
    }
    if (indicators.length) {
      macroSec.style.display = 'block';
      macroList.innerHTML = indicators.map(function(ind) {
        return '<div class="cp-macro-row"><span class="cp-macro-lbl">' + ind.l + '</span>'
          + '<span class="cp-macro-val">' + ind.v + '</span></div>';
      }).join('');
    }
  });
}

function closeCountryPanel() {
  var panel = document.getElementById('country-panel');
  if (panel) panel.classList.remove('on');
  currentCountry = null;
}

function openCountryPanelForEv() {
  if (G.panelEv && G.panelEv.country_code && G.panelEv.country_code !== 'XX') {
    openCountryPanel(G.panelEv.country_code);
  } else {
    toast('No country data for this event', 'w');
  }
}

// ── Event panel tabs ──────────────────────────────────────────

function switchEPTab(tab, btn) {
  document.querySelectorAll('.ep-tab').forEach(function(b){
    b.classList.toggle('on', b.dataset.tab === tab);
  });
  document.querySelectorAll('.ep-tab-panel').forEach(function(p){
    p.classList.toggle('on', p.id === 'ept-' + tab);
  });
}

// Hook into openEP to populate severity bar and reset to overview tab
var _origOpenEP = typeof openEP === 'function' ? openEP : null;

// Patch openEP to add new features
(function() {
  var originalOpenEP = openEP;
  openEP = function(id) {
    originalOpenEP(id);
    var ev = G.events && G.events.find(function(e){ return e.id === id; });
    if (!ev) return;

    // Severity bar
    var bar = document.getElementById('ep-sev-bar');
    var num = document.getElementById('ep-sev-num');
    if (bar) {
      var col = ev.severity >= 7 ? '#EF4444' : ev.severity >= 5 ? '#F59E0B' : '#10B981';
      bar.style.width    = (ev.severity * 10) + '%';
      bar.style.background = col;
    }
    if (num) { num.textContent = ev.severity.toFixed(1) + '/10'; }

    // Also set epmkts if in markets tab
    var mkts = [];
    try { mkts = typeof ev.related_markets==='string'?JSON.parse(ev.related_markets||'[]'):(ev.related_markets||[]); } catch(e){}
    var mktEl = document.getElementById('epmkts');
    if (mktEl) mktEl.innerHTML = mkts.map(function(t){ return '<span class="mktg">'+t+'</span>'; }).join('');

    // Reset to overview tab
    switchEPTab('overview', null);

    // Check breaking news on panel open
    closeCountryPanel();
  };
})();

// ── Keyboard shortcuts ────────────────────────────────────────

document.addEventListener('keydown', function(e) {
  // Only when map is active view
  var mapView = document.getElementById('view-map');
  if (!mapView || !mapView.classList.contains('on')) return;

  // Don't intercept when typing in input
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch(e.key) {
    case '/':
    case 'f':
      e.preventDefault();
      var inp = document.getElementById('map-search-inp');
      if (inp) inp.focus();
      break;
    case 'Escape':
      closeEP();
      closeCountryPanel();
      mapSearchClear();
      break;
    case '1': setMapMode('map'); break;
    case '2': setMapMode('heatmap'); break;
    case '3': setMapMode('graph'); break;
    case '4': setMapMode('timeline'); break;
    case 'l': toggleMapLegend(); break;
    case '+': if(G.map) G.map.zoomIn(); break;
    case '-': if(G.map) G.map.zoomOut(); break;
    case '0': if(G.map) G.map.flyTo([25,15],3,{duration:1.5}); break;
  }
});

// ── Init hook — call after G.events loaded ────────────────────

var _origLoadData = typeof loadData === 'function' ? loadData : null;
// Check breaking news whenever events refresh
if (typeof loadData === 'function') {
  var _origLoadData2 = loadData;
  loadData = function() {
    return _origLoadData2().then ? _origLoadData2().then(function(){
      setTimeout(checkBreakingNews, 500);
    }) : (_origLoadData2(), setTimeout(checkBreakingNews, 500));
  };
}

// ════════════════════════════════════════════════════════
// MISSING FUNCTIONS — added to fix ReferenceErrors
// ════════════════════════════════════════════════════════

// ── sentBadgeHtml ──────────────────────────────────────
// Returns HTML badge for sentiment score on event cards
function sentBadgeHtml(ev) {
  if (ev.sentiment_score == null) return '';
  var s   = ev.sentiment_score;
  var col = sentBarColor(s);
  var lbl = s > 0.3 ? 'Bullish' : s < -0.3 ? 'Bearish' : 'Neutral';
  return '<span class="sent-badge" style="background:' + col + '22;color:' + col
       + ';border:1px solid ' + col + '44;font-size:8px;font-weight:700;'
       + 'padding:1px 6px;border-radius:100px;letter-spacing:.04em">' + lbl + '</span>';
}

// ── xpPop ─────────────────────────────────────────────
// Show an XP gain popup near the nav
function xpPop(amount, label) {
  var pop = document.createElement('div');
  pop.style.cssText = 'position:fixed;top:58px;right:20px;z-index:9000;'
    + 'background:linear-gradient(135deg,rgba(139,92,246,.9),rgba(59,130,246,.9));'
    + 'color:#fff;padding:7px 14px;border-radius:100px;font-size:12px;font-weight:700;'
    + 'pointer-events:none;opacity:1;transition:all .8s ease;box-shadow:0 4px 16px rgba(139,92,246,.4)';
  pop.textContent = '+' + amount + ' XP — ' + (label || 'Nice!');
  document.body.appendChild(pop);
  setTimeout(function() {
    pop.style.opacity  = '0';
    pop.style.transform = 'translateY(-20px)';
  }, 1200);
  setTimeout(function() {
    if (pop.parentNode) pop.parentNode.removeChild(pop);
  }, 2200);
}

// ── renderAlerts ──────────────────────────────────────
// Render the alerts list in #view-alerts
function renderAlerts() {
  var listEl = el('allist');
  if (!listEl) return;
  var alerts = G.userProfile && G.userProfile.alerts ? G.userProfile.alerts : [];
  if (!alerts.length) {
    listEl.innerHTML = '<div style="color:var(--t3);font-size:12px;text-align:center;padding:24px 0">'
      + '🔔 No alerts yet. Create one above.</div>';
    return;
  }
  listEl.innerHTML = alerts.map(function(a, i) {
    return '<div style="display:flex;align-items:center;gap:10px;padding:10px 12px;'
      + 'background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r8)">'
      + '<div style="flex:1">'
      + '<div style="font-size:11px;font-weight:600;color:var(--t1)">' + (a.name || 'Alert '+(i+1)) + '</div>'
      + '<div style="font-size:10px;color:var(--t3);margin-top:2px">' + (a.condition || 'Custom condition') + '</div>'
      + '</div>'
      + '<div style="width:8px;height:8px;border-radius:50%;background:' + (a.active ? 'var(--gr)' : 'var(--t4)') + ';flex-shrink:0"></div>'
      + '<button onclick="deleteAlert(' + i + ')" style="background:none;border:none;color:var(--t3);'
      + 'font-size:14px;padding:2px 6px;cursor:pointer;line-height:1">&times;</button>'
      + '</div>';
  }).join('');
}

function deleteAlert(i) {
  if (!G.userProfile || !G.userProfile.alerts) return;
  G.userProfile.alerts.splice(i, 1);
  renderAlerts();
  toast('Alert removed', 's');
}

// ── renderProfile ─────────────────────────────────────
// Render watchlist and alerts in #view-profile
function renderProfile() {
  var p  = G.userProfile || {};
  var wl = G.watchlist   || [];

  // Watchlist
  var profwl = el('profwl');
  if (profwl) {
    var filter = (el('wl-filter') || {}).value || 'all';
    var items  = filter === 'all' ? wl : wl.filter(function(w){ return w.type === filter; });
    if (!items.length) {
      profwl.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:12px 0">No watchlist items</div>';
    } else {
      profwl.innerHTML = items.map(function(w) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;'
          + 'border-bottom:1px solid var(--bd)">'
          + '<span style="font-size:10px;padding:1px 7px;border-radius:100px;background:rgba(59,130,246,.15);'
          + 'color:var(--b4)">' + (w.type || 'item') + '</span>'
          + '<span style="flex:1;font-size:11px;color:var(--t1)">' + (w.name || w.value || '') + '</span>'
          + '<button onclick="removeWL(\'' + (w.id||w.value) + '\')" style="background:none;border:none;'
          + 'color:var(--t3);font-size:13px;cursor:pointer;padding:2px 6px">&times;</button>'
          + '</div>';
      }).join('');
    }
  }

  // Profile stats
  setEl('ps-wl', wl.length);

  // Profile alerts
  var profalerts = el('profalerts');
  if (profalerts) {
    var alerts = p.alerts || [];
    profalerts.innerHTML = alerts.length
      ? alerts.map(function(a) {
          return '<div style="padding:8px 10px;background:var(--bg2);border-radius:var(--r8);'
            + 'font-size:11px;color:var(--t2)">' + (a.name || 'Alert') + '</div>';
        }).join('')
      : '<div style="color:var(--t3);font-size:11px;padding:8px 0">No alerts configured</div>';
  }

  // Avatar / name
  setEl('pname',  G.user  ? G.user.username : 'User');
  setEl('pemail', G.user  ? G.user.email    : '');
  var pav = el('pav');
  if (pav && G.user) {
    pav.textContent = (G.user.username||'U').slice(0,2).toUpperCase();
    pav.style.background = G.user.avatar_color || '#3B82F6';
  }
}

// ── loadGamification ──────────────────────────────────
// Load and render the gamification / XP view
function loadGamification() {
  rq('/api/gamification/stats').then(function(data) {
    if (!data) return _renderGamFallback();
    // XP bar
    setEl('gam-level-name', data.level_name   || 'Intelligence Analyst');
    setEl('gam-xp',         data.xp_total     || 0);
    setEl('gam-next-level', data.xp_to_next   || 100);
    var bar = el('gam-xp-bar');
    if (bar) {
      var pct = Math.min(100, Math.round(((data.xp_total||0) / Math.max(data.xp_next_threshold||100, 1)) * 100));
      bar.style.width = pct + '%';
    }
    setEl('gam-badges-count', data.badges_earned || 0);
    setEl('gam-ev-viewed',    data.events_viewed || 0);
    setEl('gam-ev-scored',    data.events_scored || 0);
    setEl('gam-ai-q',         data.ai_queries    || 0);
    setEl('gam-pf-c',         data.portfolios    || 0);
    // Badges
    var badgesEl = el('gam-badges');
    if (badgesEl && data.badges) {
      badgesEl.innerHTML = data.badges.map(function(b) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;'
          + 'background:var(--bg2);border-radius:var(--r8)">'
          + '<span style="font-size:20px">' + (b.icon || '🏅') + '</span>'
          + '<div><div style="font-size:11px;font-weight:600;color:var(--t1)">' + (b.name||'') + '</div>'
          + '<div style="font-size:9px;color:var(--t3)">' + (b.description||'') + '</div></div></div>';
      }).join('');
    }
  }).catch(function() { _renderGamFallback(); });
}

function _renderGamFallback() {
  setEl('gam-level-name', 'Intelligence Analyst');
  setEl('gam-xp',  0);
  var bar = el('gam-xp-bar');
  if (bar) bar.style.width = '0%';
  var badgesEl = el('gam-badges');
  if (badgesEl) badgesEl.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:12px 0">'
    + 'Complete actions to earn badges</div>';
}

// ── renderMacro ───────────────────────────────────────
// Render macro dashboard grid
function renderMacro() {
  var grid = el('macro-grid');
  if (!grid) return;
  // Show loading state then fetch
  grid.innerHTML = '<div style="color:var(--t3);font-size:12px;text-align:center;padding:32px;grid-column:1/-1">Loading macro indicators…</div>';
  rq('/api/macro/indicators').then(function(data) {
    if (!data || !data.indicators || !data.indicators.length) {
      grid.innerHTML = '<div style="color:var(--t3);font-size:12px;text-align:center;padding:32px;grid-column:1/-1">No macro data available. Check back soon.</div>';
      return;
    }
    _renderMacroGrid(data.indicators);
  }).catch(function() {
    // Fallback with known macro categories
    var fallback = [
      {name:'US GDP Growth',    value:'2.8%',  change:'+0.2',  trend:'up',   cat:'USA'},
      {name:'US CPI Inflation', value:'3.2%',  change:'-0.1',  trend:'down', cat:'USA'},
      {name:'Fed Funds Rate',   value:'5.25%', change:'0.00',  trend:'flat', cat:'USA'},
      {name:'EUR/USD',          value:'1.085', change:'+0.003',trend:'up',   cat:'FX'},
      {name:'10Y Treasury',     value:'4.42%', change:'+0.05', trend:'up',   cat:'Bonds'},
      {name:'Brent Crude',      value:'82.4',  change:'-1.2',  trend:'down', cat:'Commodities'},
      {name:'Gold',             value:'2340',  change:'+12',   trend:'up',   cat:'Commodities'},
      {name:'China GDP',        value:'5.2%',  change:'+0.1',  trend:'up',   cat:'Asia'},
    ];
    _renderMacroGrid(fallback);
  });
}

function _renderMacroGrid(indicators) {
  var grid = el('macro-grid');
  if (!grid) return;
  grid.innerHTML = indicators.map(function(ind) {
    var up  = (ind.trend === 'up' || parseFloat(ind.change) > 0);
    var dn  = (ind.trend === 'down' || parseFloat(ind.change) < 0);
    var col = up ? 'var(--gr)' : dn ? 'var(--re)' : 'var(--t2)';
    var arr = up ? '▲' : dn ? '▼' : '—';
    return '<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:var(--r12);'
      + 'padding:14px;display:flex;flex-direction:column;gap:4px">'
      + '<div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.1em">'
      + (ind.cat || '') + '</div>'
      + '<div style="font-size:11px;color:var(--t2);margin-bottom:2px">' + (ind.name||'') + '</div>'
      + '<div style="font-family:var(--fh);font-size:20px;font-weight:800;color:var(--t1)">'
      + (ind.value||'—') + '</div>'
      + '<div style="font-size:10px;color:' + col + '">' + arr + ' ' + (ind.change||'') + '</div>'
      + '</div>';
  }).join('');
}
