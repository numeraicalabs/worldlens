/**
 * 32_dash_ew.js — Dashboard Early Warning live integration
 *
 * Connects the Dashboard EW section (#dash-ew-section) to the real
 * /api/intelligence/early-warning and /api/intelligence/early-warning/signals
 * endpoints. Reuses the same render helpers from 10_stubs.js where possible.
 *
 * Also improves the AI Risk Brief rendering: expands the text into
 * multi-paragraph HTML for better readability.
 */
(function () {
'use strict';

/* ── EW color helper (mirrors 10_stubs.js) ─────────────────────────────── */
function _col(score) {
  if (score >= 7.5) return '#ff5722';
  if (score >= 6.0) return '#ffab00';
  if (score >= 4.0) return '#ffcc02';
  return '#66bb6a';
}
function _label(score) {
  if (score >= 7.5) return 'CRITICAL';
  if (score >= 6.0) return 'ELEVATED';
  if (score >= 4.0) return 'MODERATE';
  return 'STABLE';
}

/* ── Set element text ──────────────────────────────────────────────────── */
function _set(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}
function _html(id, html) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/* ── Escape HTML ───────────────────────────────────────────────────────── */
function _esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Render multi-paragraph assessment ─────────────────────────────────── */
function _renderAssessment(text, score, data) {
  var el = document.getElementById('dash-ew-assess');
  if (!el) return;

  if (!text || text.length < 20) {
    // Build a data-driven fallback if AI text is absent
    var vel = data.event_velocity || 1.0;
    var velTxt = vel > 1.5 ? 'accelerating (+' + Math.round((vel-1)*100) + '% above baseline)'
               : vel < 0.8 ? 'decelerating' : 'stable';
    var neg = (data.sentiment_trend || 0) < -0.3;
    text = 'Global EW Score: ' + score.toFixed(1) + '/10 — ' + _label(score) + ' status. '
         + (data.event_count_48h || 0) + ' events tracked in the 48h window. '
         + 'Event velocity ' + velTxt + '. '
         + 'Macro stress index: ' + (data.macro_stress || 5).toFixed(1) + '/10. '
         + (neg ? 'News sentiment is deteriorating — monitor for escalation.' 
               : 'Sentiment currently stable across tracked regions.');
  }

  // Split into sentences and render as readable paragraphs
  var sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  var chunks = [];
  var current = '';
  sentences.forEach(function(s, i) {
    current += s.trim() + ' ';
    // Break every 2–3 sentences into a paragraph
    if ((i + 1) % 2 === 0 || i === sentences.length - 1) {
      chunks.push(current.trim());
      current = '';
    }
  });

  el.innerHTML = chunks.map(function(chunk, i) {
    var style = i === 0
      ? 'margin:0 0 8px;font-family:var(--fire-sans);font-style:normal;font-weight:600;font-size:14px;color:var(--fire-text)'
      : 'margin:0 0 8px;color:var(--fire-text-mid)';
    return '<p style="' + style + '">' + _esc(chunk) + '</p>';
  }).join('');
}

/* ── Render gauge bars ─────────────────────────────────────────────────── */
function _renderGauges(data) {
  var gauges = {
    macro:  data.macro_stress     || 0,
    market: data.market_stress    || 0,
    sent:   Math.abs(data.sentiment_trend || 0) * 10,
    vel:    Math.min(10, (data.event_velocity || 1) * 4),
  };
  var sentColor = (data.sentiment_trend || 0) < -0.3 ? '#ff5722'
                : (data.sentiment_trend || 0) > 0.1 ? '#66bb6a' : '#ffab00';

  Object.keys(gauges).forEach(function(k) {
    var val = gauges[k];
    var pct = Math.min(100, Math.max(0, (val / 10) * 100));
    var col = k === 'sent' ? sentColor : _col(val);
    var bar = document.getElementById('ewgb-' + k);
    var lbl = document.getElementById('ewg-' + k);
    if (bar) { bar.style.width = pct + '%'; bar.style.background = col; }
    if (lbl) { lbl.textContent = val.toFixed(1); lbl.style.color = col; }
  });
}

/* ── Render live signals list ──────────────────────────────────────────── */
function _renderSignals(signals) {
  var el = document.getElementById('dash-ew-signals');
  var cnt = document.getElementById('dash-ew-signal-count');
  if (!el) return;

  if (cnt) cnt.textContent = signals.length ? '(' + signals.length + ')' : '';

  if (!signals.length) {
    el.innerHTML = '<div class="fire-signal-skeleton">No active signals detected in the monitoring window</div>';
    return;
  }

  el.innerHTML = signals.slice(0, 6).map(function(sig) {
    // Use correct field names from /api/intelligence/early-warning/signals
    var level    = sig.level || (sig.severity >= 7.5 ? 'critical' : sig.severity >= 5.5 ? 'major' : 'watch');
    var lvlClass = level === 'critical' ? 'critical' : level === 'major' ? 'major' : 'watch';
    var sev      = parseFloat(sig.severity || sig.value || 5);
    var col      = lvlClass === 'critical' ? 'var(--fire-ember)'
                 : lvlClass === 'major'    ? 'var(--fire-corona)'
                 : 'var(--fire-sunrise)';
    // value slot: severity score
    var val   = sig.value || sev.toFixed(1);
    // delta slot: confidence percentage
    var delta = sig.delta || (sig.confidence ? Math.round(sig.confidence * 100) + '% conf' : '');
    // meta: region + event headline snippet
    var meta  = sig.meta
              || (sig.region ? sig.region + (sig.title ? ' · ' + sig.title.slice(0, 55) : '') : '')
              || (sig.description || '').slice(0, 80);
    // body text: ai_summary or summary
    var body  = sig.description || sig.summary || '';

    return [
      '<div class="fire-signal">',
      '  <div class="fire-signal-head">',
      '    <div class="fire-signal-level ' + lvlClass + '">',
      '      <span class="fire-signal-level-dot"></span>',
      _esc(level.toUpperCase()),
      '    </div>',
      (sig.icon ? '<span style="font-size:16px;margin-left:auto">' + sig.icon + '</span>' : ''),
      '  </div>',
      '  <div class="fire-signal-label">' + _esc((sig.label || sig.type || '').replace(/_/g,' ').toUpperCase()) + '</div>',
      '  <div class="fire-signal-val-row">',
      '    <span class="fire-signal-val" style="color:' + col + '">' + _esc(String(val)) + '</span>',
      delta ? '    <span class="fire-signal-delta ' + lvlClass + '">' + _esc(delta) + '</span>' : '',
      '  </div>',
      meta ? '  <div class="fire-signal-meta">' + _esc(meta) + '</div>' : '',
      (body && body !== meta)
        ? '  <div style="font-size:11px;color:var(--fire-text-dim);margin-top:6px;line-height:1.5">'
          + _esc(body.slice(0, 140)) + '</div>'
        : '',
      '</div>',
    ].join('');
  }).join('');
}

/* ── Main loader — called once after enterApp ──────────────────────────── */
function dashEWInit() {
  var section = document.getElementById('dash-ew-section');
  if (!section) return;

  // Use global rq() from 01_globals.js (same auth headers)
  var rqFn = window.rq || function(url) { return fetch(url).then(function(r){ return r.json(); }); };

  rqFn('/api/intelligence/early-warning')
    .then(function(data) {
      if (!data) return;
      var score = parseFloat(data.global_ew_score || data.score || 5);
      var col   = _col(score);

      // Score + label
      var scoreEl = document.getElementById('dash-ew-score');
      if (scoreEl) { scoreEl.textContent = score.toFixed(1); scoreEl.style.color = col; }
      var labelEl = document.getElementById('dash-ew-label');
      if (labelEl) { labelEl.textContent = _label(score); labelEl.style.color = col; }

      // Gauges
      _renderGauges(data);

      // Assessment text
      _renderAssessment(data.ai_assessment || data.assessment || '', score, data);

      // Patterns (reuse existing _ewRenderPatterns if available)
      if (typeof window._ewRenderPatterns === 'function') {
        window._ewRenderPatterns(data.top_risks || []);
      }
    })
    .catch(function() {
      _set('dash-ew-label', 'UNAVAILABLE');
      _html('dash-ew-assess', '<p style="color:var(--fire-text-dim);font-size:13px">Could not load Early Warning data.</p>');
    });

  // Load signals separately
  rqFn('/api/intelligence/early-warning/signals')
    .then(function(data) {
      var signals = (data && data.signals) || [];
      _renderSignals(signals);
    })
    .catch(function() {
      _html('dash-ew-signals', '<div class="fire-signal-skeleton">Could not load signals</div>');
    });

  // Auto-refresh every 3 minutes
  setTimeout(function() { dashEWInit(); }, 180000);
}

/* ── Extended macro brief renderer ────────────────────────────────────── */
function renderExtendedBrief(text) {
  var el = document.getElementById('d-brief-txt');
  if (!el || !text || text.length < 20) return;

  var sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  var chunks = [];
  var current = '';
  sentences.forEach(function(s, i) {
    current += s.trim() + ' ';
    if ((i + 1) % 2 === 0 || i === sentences.length - 1) {
      chunks.push(current.trim());
      current = '';
    }
  });

  el.innerHTML = chunks.map(function(chunk, i) {
    var style = i === 0
      ? 'margin:0 0 8px;font-family:var(--fire-sans);font-style:normal;font-weight:600;font-size:14px;color:var(--fire-text)'
      : 'margin:0 0 8px;';
    return '<p style="' + style + '">' + _esc(chunk) + '</p>';
  }).join('');

  // Update timestamp
  var timeEl = document.getElementById('db-brief-time');
  if (timeEl) timeEl.textContent = new Date().toTimeString().slice(0, 5) + ' UTC';
}

/* ── Hook into the existing loadMacroBrief / renderDash flow ──────────── */
// We monkey-patch the brief text setter so our renderer runs when data arrives
var _origInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
var _origTextContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');

// Simpler approach: poll the element after renderDash runs
function _watchBrief() {
  var el = document.getElementById('d-brief-txt');
  if (!el) return;
  var lastText = '';
  setInterval(function() {
    var current = el.textContent || '';
    if (current !== lastText && current.length > 30 && !current.includes('<p')) {
      lastText = current;
      renderExtendedBrief(current);
    }
  }, 1500);
}

/* ── Boot ──────────────────────────────────────────────────────────────── */
function init() {
  var dash = document.getElementById('view-dash');
  if (!dash) return;

  function tryInit() {
    if (dash.classList.contains('on') && window.G && window.G.token) {
      dashEWInit();
      _watchBrief();
    }
  }

  // Init when dashboard becomes visible
  new MutationObserver(function() {
    if (dash.classList.contains('on')) tryInit();
  }).observe(dash, { attributes: true, attributeFilter: ['class'] });

  // Init immediately if already active
  setTimeout(tryInit, 1200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose for manual reload
window.dashEWInit = dashEWInit;
window.renderExtendedBrief = renderExtendedBrief;

// Force-refresh EW (clears 30-min server cache, then reloads)
window.refreshEW = function() {
  var rqFn = window.rq || function(url, opts) { return fetch(url, opts).then(function(r){ return r.json(); }); };
  rqFn('/api/intelligence/early-warning/refresh', { method: 'POST' }).then(function() {
    dashEWInit();
  }).catch(function() { dashEWInit(); });
};


})();
