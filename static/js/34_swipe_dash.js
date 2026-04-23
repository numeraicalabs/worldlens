/**
 * 34_swipe_dash.js — Mobile swipe card dashboard
 *
 * On phone (≤480px): projects existing dashboard data into 5 swipeable cards.
 * Desktop: does nothing. Zero new API calls — mirrors data already in the DOM
 * or in G.events / G.finance / G.stats.
 *
 * Cards:
 *   0 — Rischio: greeting + risk score + AI brief + top 3 events
 *   1 — Mercati: KPI 2x3 grid + category bars
 *   2 — Crisi:   full events list
 *   3 — EW:      score + gauges + top signals
 *   4 — Agenti:  4 bot summaries
 */
(function () {
'use strict';

var PHONE_MAX = 480;
function _isPhone() { return window.innerWidth <= PHONE_MAX; }

/* ─── Helpers ─────────────────────────────────────────────────────── */
function _el(id) { return document.getElementById(id); }
function _esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
function _ewColor(score) {
  var s = parseFloat(score) || 0;
  return s >= 7.5 ? '#ff5722' : s >= 6.0 ? '#ffc107' : s >= 4.0 ? '#ffca28' : '#66bb6a';
}
function _sevColor(sev) {
  return sev >= 7.5 ? '#ff5722' : sev >= 5.5 ? '#ffc107' : '#66bb6a';
}
function _tAgo(dateStr) {
  if (!dateStr) return '';
  var d = new Date(dateStr), now = new Date();
  var diff = Math.round((now - d) / 60000);
  if (diff < 60)  return diff + 'm fa';
  if (diff < 1440) return Math.round(diff / 60) + 'h fa';
  return Math.round(diff / 1440) + 'g fa';
}
function _chgClass(val) {
  var s = String(val || '');
  return s.startsWith('+') || s.startsWith('↑') ? 'color:#66bb6a'
       : s.startsWith('-') || s.startsWith('↓') ? 'color:#ff5722'
       : 'color:var(--fire-text-dim)';
}

/* ─── Current card tracking ──────────────────────────────────────── */
var _currentCard = 0;
var _totalCards  = 5;
var _track = null;

/* ─── Dots update ────────────────────────────────────────────────── */
function _updateDots(idx) {
  document.querySelectorAll('.mob-dot').forEach(function(d, i) {
    d.classList.toggle('active', i === idx);
  });
  _currentCard = idx;
}

/* ─── Snap to card (programmatic) ───────────────────────────────── */
function goToCard(idx) {
  if (!_track) return;
  idx = Math.max(0, Math.min(_totalCards - 1, idx));
  _track.scrollTo({ left: idx * window.innerWidth, behavior: 'smooth' });
  _updateDots(idx);
}
window.swipeDashGoTo = goToCard;

/* ─── Scroll → dot sync ──────────────────────────────────────────── */
function _onTrackScroll() {
  if (!_track) return;
  var idx = Math.round(_track.scrollLeft / window.innerWidth);
  if (idx !== _currentCard) _updateDots(idx);
}

/* ─── Dot clicks ─────────────────────────────────────────────────── */
function _bindDots() {
  document.querySelectorAll('.mob-dot').forEach(function(d) {
    d.addEventListener('click', function() {
      goToCard(parseInt(this.dataset.card) || 0);
    });
  });
}

/* ══════════════════════════════════════════════════════════════════
   CARD 0 — RISCHIO
   ══════════════════════════════════════════════════════════════════ */
function _syncCard0() {
  // Greeting
  var greetEl = _el('msc-greeting');
  var name = window.G && G.userProfile
    ? ((G.userProfile.display_name || G.userProfile.username || G.userProfile.email || '').split('@')[0])
    : '';
  var hr = new Date().getHours();
  var saluto = hr < 12 ? 'Buongiorno' : hr < 18 ? 'Buon pomeriggio' : 'Buonasera';
  if (greetEl) greetEl.textContent = name ? saluto + ', ' + name : saluto;

  var timeEl = _el('msc-time-label');
  var days = ['DOM','LUN','MAR','MER','GIO','VEN','SAB'];
  if (timeEl) timeEl.textContent = days[new Date().getDay()] + ' ' + new Date().toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });

  var updEl = _el('msc-last-update');
  var srcUpd = _el('d-last-update');
  if (updEl && srcUpd) updEl.textContent = srcUpd.textContent;

  // Risk score — read from desktop element already populated by renderDash
  var srcRisk = _el('d-risk');
  var srcRiskL = _el('d-risk-l');
  var dstRisk  = _el('msc-risk');
  var dstRiskL = _el('msc-risk-l');
  if (srcRisk && dstRisk) {
    var numTxt = (srcRisk.textContent || '').replace('/100', '').trim();
    dstRisk.textContent = numTxt || '—';
    var num = parseFloat(numTxt) || 0;
    var col = num > 60 ? '#ff5722' : num > 35 ? '#ffc107' : '#66bb6a';
    dstRisk.style.color = col;
    if (dstRiskL && srcRiskL) { dstRiskL.textContent = srcRiskL.textContent; dstRiskL.style.color = col; }
  }

  // AI brief — take first 2 sentences from d-brief-txt
  var srcBrief = _el('d-brief-txt');
  var dstBrief = _el('msc-brief');
  if (srcBrief && dstBrief) {
    var full = (srcBrief.textContent || srcBrief.innerText || '').trim();
    if (full && full.length > 10 && !full.includes('Caricamento')) {
      var sents = full.match(/[^.!?]+[.!?]+/g) || [full];
      dstBrief.textContent = sents.slice(0, 2).join(' ').trim();
    }
  }

  // Top 3 events
  var evs = (window.G && G.events) ? G.events.slice().sort(function(a, b) {
    return (b.severity || 0) - (a.severity || 0);
  }).slice(0, 3) : [];

  var container = _el('msc-top-events');
  if (container) {
    if (!evs.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--fire-text-dim);padding:12px 0">Dati in caricamento…</div>';
    } else {
      container.innerHTML = evs.map(function(ev) {
        var sev = parseFloat(ev.severity || 5);
        var col = _sevColor(sev);
        var country = _esc(ev.country_name || ev.country_code || 'Global');
        var cat = _esc((ev.category || '').slice(0, 8));
        return [
          '<div class="msc-top-event" data-eid="' + _esc(ev.id || '') + '">',
          '  <div class="msc-tev-sev" style="color:' + col + '">' + sev.toFixed(0) + '</div>',
          '  <div class="msc-tev-body">',
          '    <div class="msc-tev-title">' + _esc(ev.title || '') + '</div>',
          '    <div class="msc-tev-meta">' + country + (cat ? ' · ' + cat : '') + ' · ' + _tAgo(ev.timestamp) + '</div>',
          '  </div>',
          '</div>',
        ].join('');
      }).join('');

      container.querySelectorAll('[data-eid]').forEach(function(row) {
        row.addEventListener('click', function() {
          var eid = this.dataset.eid;
          if (typeof mobileNav === 'function') mobileNav('feed', null);
          setTimeout(function() { if (typeof openEP === 'function') openEP(eid); }, 400);
        });
      });
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   CARD 1 — MERCATI
   ══════════════════════════════════════════════════════════════════ */
function _syncCard1() {
  // KPI values — mirror desktop elements
  var pairs = [
    ['d-sp',   'd-sp-c',   'msc-sp',   'msc-sp-c'],
    ['d-btc',  'd-btc-c',  'msc-btc',  'msc-btc-c'],
    ['d-vix',  'd-vix-l',  'msc-vix',  'msc-vix-c'],
    ['d-gold', 'd-gold-c', 'msc-gold', 'msc-gold-c'],
    ['d-dxy',  'd-dxy-c',  'msc-dxy',  'msc-dxy-c'],
    ['d-ev',   'd-hi',     'msc-ev',   'msc-ev-hi'],
  ];
  pairs.forEach(function(p) {
    var sv = _el(p[0]), sc = _el(p[1]);
    var dv = _el(p[2]), dc = _el(p[3]);
    if (sv && dv) dv.textContent = sv.textContent || '—';
    if (sc && dc) {
      dc.textContent = sc.textContent || '';
      dc.setAttribute('style', _chgClass(dc.textContent));
    }
  });

  // Category bars — rebuild from G.stats
  var catEl = _el('msc-catbars');
  if (!catEl) return;
  var st = (window.G && G.stats) || {};
  var bycat = st.by_category || {};
  var total = Object.values(bycat).reduce(function(a, b) { return a + b; }, 0) || 1;
  var sorted = Object.entries(bycat).sort(function(a, b) { return b[1] - a[1]; }).slice(0, 6);

  if (!sorted.length) {
    catEl.innerHTML = '<div style="font-size:12px;color:var(--fire-text-dim);padding:8px 0">Dati in caricamento…</div>';
    return;
  }

  var CATS_COLORS = {
    Conflict:'#ef4444', Economics:'#f59e0b', Politics:'#8b5cf6',
    Energy:'#f97316', Technology:'#3b82f6', Disaster:'#10b981',
    Military:'#dc2626', Diplomatic:'#6366f1', Financial:'#eab308',
    GEOPOLITICS:'#64748b',
  };

  catEl.innerHTML = sorted.map(function(kv) {
    var col = CATS_COLORS[kv[0]] || '#64748b';
    var pct = Math.round(kv[1] / total * 100);
    return [
      '<div class="msc-cat-row">',
      '  <div class="msc-cat-lbl" style="color:' + col + '">' + _esc(kv[0].slice(0, 9)) + '</div>',
      '  <div class="msc-cat-bar-bg">',
      '    <div class="msc-cat-bar-fg" style="width:' + pct + '%;background:' + col + '"></div>',
      '  </div>',
      '  <div class="msc-cat-n">' + kv[1] + '</div>',
      '</div>',
    ].join('');
  }).join('');
}

/* ══════════════════════════════════════════════════════════════════
   CARD 2 — CRISI
   ══════════════════════════════════════════════════════════════════ */
function _syncCard2() {
  var evs = (window.G && G.events) ? G.events.slice().sort(function(a, b) {
    return (b.severity || 0) - (a.severity || 0);
  }).slice(0, 12) : [];

  var container = _el('msc-events');
  if (!container) return;

  if (!evs.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--fire-text-dim);padding:20px 0;text-align:center">Nessun evento disponibile</div>';
    return;
  }

  container.innerHTML = evs.map(function(ev) {
    var sev = parseFloat(ev.severity || 5);
    var col = _sevColor(sev);
    var country = _esc(ev.country_name || ev.country_code || 'Global');
    var cat = _esc((ev.category || '').slice(0, 8));
    return [
      '<div class="msc-event-row" data-eid="' + _esc(ev.id || '') + '">',
      '  <div class="msc-ev-sev" style="color:' + col + '">' + sev.toFixed(0) + '</div>',
      '  <div class="msc-ev-body">',
      '    <div class="msc-ev-title">' + _esc(ev.title || '') + '</div>',
      '    <div class="msc-ev-meta">' + country + (cat ? ' · ' + cat : '') + ' · ' + _tAgo(ev.timestamp) + '</div>',
      '  </div>',
      '</div>',
    ].join('');
  }).join('');

  container.querySelectorAll('[data-eid]').forEach(function(row) {
    row.addEventListener('click', function() {
      var eid = this.dataset.eid;
      if (typeof mobileNav === 'function') mobileNav('feed', null);
      setTimeout(function() { if (typeof openEP === 'function') openEP(eid); }, 400);
    });
  });
}

/* ══════════════════════════════════════════════════════════════════
   CARD 3 — EARLY WARNING
   ══════════════════════════════════════════════════════════════════ */
function _syncCard3() {
  // Score + label — mirror from EW strip (populated by 32_dash_ew.js)
  var srcScore = _el('dash-ew-score');
  var srcLabel = _el('dash-ew-label');
  var srcAssess = _el('dash-ew-assess');

  var dstScore = _el('msc-ew-score');
  var dstLabel = _el('msc-ew-label');
  var dstAssess = _el('msc-ew-assess');

  if (srcScore && dstScore) {
    var sc = parseFloat(srcScore.textContent) || 0;
    dstScore.textContent = sc > 0 ? sc.toFixed(1) : '—';
    var col = _ewColor(sc);
    dstScore.style.color = col;
    if (dstLabel && srcLabel) { dstLabel.textContent = srcLabel.textContent || '—'; dstLabel.style.color = col; }
  }

  if (srcAssess && dstAssess) {
    var text = (srcAssess.textContent || srcAssess.innerText || '').trim();
    var sents = text.match(/[^.!?]+[.!?]+/g) || [text];
    dstAssess.textContent = sents.slice(0, 2).join(' ').trim() || text.slice(0, 150);
  }

  // Gauges — mirror from EW hero strip
  var gaugeMap = [
    ['dash-ewgb-macro',  'msc-gb-macro',  'dash-ewg-macro',  'msc-gv-macro'],
    ['dash-ewgb-market', 'msc-gb-market', 'dash-ewg-market', 'msc-gv-market'],
    ['dash-ewgb-sent',   'msc-gb-sent',   'dash-ewg-sent',   'msc-gv-sent'],
    ['dash-ewgb-vel',    'msc-gb-vel',    'dash-ewg-vel',    'msc-gv-vel'],
  ];
  gaugeMap.forEach(function(row) {
    var sBar = _el(row[0]), dBar = _el(row[1]);
    var sVal = _el(row[2]), dVal = _el(row[3]);
    if (sBar && dBar) { dBar.style.width = sBar.style.width || '0%'; dBar.style.background = sBar.style.background || '#ffc107'; }
    if (sVal && dVal) { dVal.textContent = sVal.textContent || '—'; dVal.style.color = sVal.style.color || ''; }
  });

  // Signals — read from ew-signals (populated by loadEWSignals)
  var sigContainer = _el('msc-signals');
  if (!sigContainer) return;

  var srcSignals = _el('ew-signals');
  if (!srcSignals) return;

  // Extract rendered signal data from DOM
  var sigRows = srcSignals.querySelectorAll('.fire-signal, .ew-signal');
  if (!sigRows.length) {
    sigContainer.innerHTML = '<div style="font-size:12px;color:var(--fire-text-dim);padding:8px 0">Nessun segnale attivo</div>';
    return;
  }

  sigContainer.innerHTML = Array.from(sigRows).slice(0, 5).map(function(row) {
    var iconEl = row.querySelector('.fire-signal-icon, .ew-signal-icon');
    var labelEl = row.querySelector('.fire-signal-label, .ew-signal-type');
    var valEl = row.querySelector('.fire-signal-val, .ew-conf-bar');
    var sevEl = row.querySelector('[class*="sev"], .fire-signal-val');

    var icon  = iconEl  ? iconEl.textContent.trim()  : '⚠️';
    var label = labelEl ? labelEl.textContent.trim() : '—';
    var sev   = sevEl   ? sevEl.textContent.trim()   : '—';
    var col   = label.toLowerCase().includes('critical') ? '#ff5722'
              : label.toLowerCase().includes('major') ? '#ffc107' : '#66bb6a';

    return [
      '<div class="msc-signal-row" style="border-left-color:' + col + '">',
      '  <span class="msc-sig-icon">' + icon + '</span>',
      '  <span class="msc-sig-label">' + _esc(label.toUpperCase().slice(0, 30)) + '</span>',
      '  <span class="msc-sig-sev" style="color:' + col + '">' + _esc(sev.slice(0, 6)) + '</span>',
      '</div>',
    ].join('');
  }).join('');
}

/* ══════════════════════════════════════════════════════════════════
   CARD 4 — AGENTI AI
   ══════════════════════════════════════════════════════════════════ */
function _syncCard4() {
  var container = _el('msc-agents');
  if (!container) return;

  // Read from agents-grid (populated by 21_agents_dash.js)
  var srcGrid = _el('agents-grid');
  if (!srcGrid) return;

  var agentCards = srcGrid.querySelectorAll('.ag-card, [class*="agent-card"], [class*="ag-card"]');
  if (!agentCards.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--fire-text-dim);padding:12px 0">Bot in caricamento…</div>';
    return;
  }

  container.innerHTML = Array.from(agentCards).slice(0, 4).map(function(card) {
    var nameEl  = card.querySelector('.ag-name,  [class*="ag-name"]');
    var briefEl = card.querySelector('.ag-brief, [class*="ag-brief"], .ag-desc, [class*="ag-desc"]');
    var colorStyle = card.style.getPropertyValue('--ag-color') || card.style.borderColor || '#ffc107';

    var name  = nameEl  ? nameEl.textContent.trim()  : '—';
    var brief = briefEl ? briefEl.textContent.trim().slice(0, 120) : 'Brief in arrivo…';

    // Try to get color from CSS variable
    var col = card.style.cssText.includes('--ag-color') ?
      card.style.cssText.match(/--ag-color:\s*([^;]+)/)?.[1]?.trim() || '#ffc107' : '#ffc107';

    return [
      '<div class="msc-agent-card" style="border-left-color:' + _esc(col) + '">',
      '  <div class="msc-agent-name">' + _esc(name) + '</div>',
      '  <div class="msc-agent-brief">' + _esc(brief) + '</div>',
      '</div>',
    ].join('');
  }).join('');
}

/* ══════════════════════════════════════════════════════════════════
   MAIN SYNC — runs after each renderDash / data update
   ══════════════════════════════════════════════════════════════════ */
function syncAllCards() {
  if (!_isPhone()) return;
  _syncCard0();
  _syncCard1();
  _syncCard2();
  _syncCard3();
  _syncCard4();
}
window.syncAllSwipeCards = syncAllCards;

/* ══════════════════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════════════════ */
function init() {
  if (!_isPhone()) return;

  _track = _el('mob-swipe-track');
  if (!_track) return;

  // Dot clicks
  _bindDots();

  // Scroll → dot sync
  _track.addEventListener('scroll', _onTrackScroll, { passive: true });

  // Initial sync after data loads
  function _trySyncAll() {
    var riskEl = _el('d-risk');
    var hasData = riskEl && riskEl.textContent.trim() !== '—' && riskEl.textContent.trim() !== '';
    if (hasData) {
      syncAllCards();
    } else {
      setTimeout(_trySyncAll, 600);
    }
  }
  setTimeout(_trySyncAll, 800);

  // Re-sync when desktop data changes
  var watchIds = ['d-risk', 'dash-ew-score', 'd-sp'];
  watchIds.forEach(function(id) {
    var el = _el(id);
    if (!el) return;
    new MutationObserver(function() {
      setTimeout(syncAllCards, 200);
    }).observe(el, { characterData: true, childList: true, subtree: true });
  });

  // Re-sync when agents grid updates
  var agGrid = _el('agents-grid');
  if (agGrid) {
    new MutationObserver(function() {
      setTimeout(_syncCard4, 300);
    }).observe(agGrid, { childList: true, subtree: true });
  }

  // Re-sync when EW signals update
  var ewSigs = _el('ew-signals');
  if (ewSigs) {
    new MutationObserver(function() {
      setTimeout(_syncCard3, 300);
    }).observe(ewSigs, { childList: true, subtree: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
