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
      dstBrief.textContent = sents.slice(0, 4).join(' ').trim();
    }
  }

  // Top 3 events
  var evs = (window.G && G.events) ? G.events.slice().sort(function(a, b) {
    return (b.severity || 0) - (a.severity || 0);
  }).slice(0, 5) : [];

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

  // Market movers — top gainers/losers from G.finance
  var moversEl = _el('msc-movers');
  if (moversEl && window.G && G.finance) {
    var fin = G.finance;
    var allAssets = Object.entries(fin).map(function(kv) {
      var tick = kv[0], d = kv[1] || {};
      var chg = parseFloat(d.change_pct || d.changePct || d.change || 0);
      return { ticker: tick, price: d.price || d.last || 0, change: chg, name: d.name || tick };
    }).filter(function(a){ return a.price > 0 && !isNaN(a.change); });

    // Sort by absolute change, pick top 3 gainers and losers
    allAssets.sort(function(a,b){ return Math.abs(b.change) - Math.abs(a.change); });
    var top = allAssets.slice(0, 6);

    if (top.length) {
      moversEl.innerHTML = top.map(function(a) {
        var col = a.change >= 0 ? '#10B981' : '#EF4444';
        var arrow = a.change >= 0 ? '▲' : '▼';
        var sign = a.change >= 0 ? '+' : '';
        return [
          '<div class="msc-mover-row">',
          '  <div class="msc-mover-ticker">' + _esc(a.ticker.slice(0,10)) + '</div>',
          '  <div class="msc-mover-price">' + (a.price > 100 ? a.price.toFixed(0) : a.price.toFixed(2)) + '</div>',
          '  <div class="msc-mover-chg" style="color:' + col + '">' + arrow + ' ' + sign + a.change.toFixed(2) + '%</div>',
          '</div>',
        ].join('');
      }).join('');
    }
  }

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
  }).slice(0, 15) : [];

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
    // dash-ew-assess contains <p> tags — extract clean text from each paragraph
    var paras = srcAssess.querySelectorAll('p');
    var text;
    if (paras.length) {
      // Join first 2 paragraphs with a space, preserving word boundaries
      text = Array.from(paras).slice(0, 3).map(function(p) {
        return (p.textContent || '').trim();
      }).filter(Boolean).join(' ');
    } else {
      text = (srcAssess.textContent || srcAssess.innerText || '').replace(/\s+/g, ' ').trim();
    }
    // Show first 200 chars max, cut at sentence boundary
    if (text.length > 420) {
      var cut = text.slice(0, 420);
      var lastDot = Math.max(cut.lastIndexOf('.'), cut.lastIndexOf('!'), cut.lastIndexOf('?'));
      text = lastDot > 120 ? cut.slice(0, lastDot + 1) : cut + '…';
    }
    dstAssess.textContent = text || 'Analisi in corso…';
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

  // Signals — read from dash-ew-signals (dashboard widget, populated by 32_dash_ew.js)
  var sigContainer = _el('msc-signals');
  if (!sigContainer) return;

  // Try dash-ew-signals first (dashboard), fall back to ew-signals (EW page)
  var srcSignals = _el('dash-ew-signals') || _el('ew-signals');
  if (!srcSignals) {
    sigContainer.innerHTML = '<div style="font-size:12px;color:var(--fire-text-dim);padding:8px 0">Segnali in caricamento…</div>';
    return;
  }

  // .fire-signal structure from 32_dash_ew.js:
  //   .fire-signal-level (CRITICAL/MAJOR/WATCH text)
  //   .fire-signal-label (label like "ECONOMIC STRESS")
  //   .fire-signal-val   (severity number)
  //   .fire-signal-meta  (region · event title)
  var sigRows = srcSignals.querySelectorAll('.fire-signal');
  if (!sigRows.length) {
    // also try ew-signal class (EW page signals)
    sigRows = srcSignals.querySelectorAll('.ew-signal');
  }
  if (!sigRows.length) {
    sigContainer.innerHTML = '<div style="font-size:12px;color:var(--fire-text-dim);padding:8px 0">Nessun segnale attivo nel periodo</div>';
    return;
  }

  sigContainer.innerHTML = Array.from(sigRows).slice(0, 5).map(function(row) {
    var levelEl = row.querySelector('.fire-signal-level, .ew-signal-type');
    var labelEl = row.querySelector('.fire-signal-label');
    var valEl   = row.querySelector('.fire-signal-val');
    var metaEl  = row.querySelector('.fire-signal-meta');
    var iconEl  = row.querySelector('.fire-signal-icon');

    var levelTxt = levelEl ? (levelEl.textContent || '').replace(/[^a-zA-Z]/g,'').trim() : 'watch';
    var label = labelEl ? labelEl.textContent.trim() : (levelTxt || '—');
    var val   = valEl   ? valEl.textContent.trim() : '—';
    var meta  = metaEl  ? metaEl.textContent.trim().slice(0, 60) : '';
    var icon  = iconEl  ? iconEl.textContent.trim() : '⚠️';

    var lvl = levelTxt.toLowerCase();
    var col = lvl.includes('critical') ? '#ff5722'
            : lvl.includes('major')    ? '#ffc107'
            : '#66bb6a';

    return [
      '<div class="msc-signal-row" style="border-left-color:' + col + '">',
      icon !== '⚠️' ? '  <span class="msc-sig-icon">' + icon + '</span>' : '',
      '  <div style="flex:1;min-width:0">',
      '    <span class="msc-sig-label" style="color:' + col + '">' + _esc(label.slice(0, 40)) + '</span>',
      meta ? '    <div style="font-size:10px;color:var(--fire-text-dim);margin-top:2px">' + _esc(meta.slice(0, 90)) + '</div>' : '',
      '  </div>',
      '  <span class="msc-sig-sev" style="color:' + col + '">' + _esc(val.slice(0, 6)) + '</span>',
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

  // Build rich cards from AGENTS data (21_agents_dash.js)
  var agentData = window.AGENTS || {};
  var agentIds  = Object.keys(agentData);

  // Also extract from DOM as fallback
  var cardsHTML = Array.from(agentCards).slice(0, 4).map(function(card) {
    var bid     = card.id ? card.id.replace('agent-card-', '') : '';
    var nameEl  = card.querySelector('.ag-name');
    var headlineEl = card.querySelector('.ag-headline');
    var briefEl = card.querySelector('.ag-brief');
    var signalEl = card.querySelector('.ag-signal');
    var countEl  = card.querySelector('.ag-ev-count');

    var name     = nameEl     ? nameEl.textContent.trim()     : '—';
    var headline = headlineEl ? headlineEl.textContent.trim().slice(0, 120) : '';
    var brief    = briefEl    ? briefEl.textContent.trim().slice(0, 280)   : 'Brief in arrivo…';
    var signal   = signalEl   ? signalEl.textContent.trim()   : '';
    var count    = countEl    ? countEl.textContent.trim()    : '';

    // Get color from CSS variable
    var cssTxt = card.style.cssText || '';
    var colMatch = cssTxt.match(/--ag-color:\s*([^;]+)/);
    var col = colMatch ? colMatch[1].trim() : '#ffc107';

    // Signal pill color
    var sigCol = signal.toLowerCase().includes('bullish') ? '#10B981'
               : signal.toLowerCase().includes('critical') ? '#EF4444'
               : signal.toLowerCase().includes('bearish') ? '#F59E0B'
               : '#94A3B8';

    // Click navigates to full dashboard section scrolled to agents
    var clickAttr = bid ? 'data-bid="' + _esc(bid) + '"' : '';

    return [
      '<div class="msc-agent-card" style="border-left-color:' + _esc(col) + ';cursor:pointer" ' + clickAttr + '>',
      '  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">',
      '    <div class="msc-agent-name">' + _esc(name) + '</div>',
      signal ? '    <span style="font-family:var(--fire-mono);font-size:9px;letter-spacing:0.1em;padding:2px 8px;border-radius:20px;background:' + sigCol + '22;color:' + sigCol + '">' + _esc(signal) + '</span>' : '',
      '  </div>',
      headline ? '  <div style="font-size:13px;font-weight:500;color:var(--fire-text);margin-bottom:4px;line-height:1.35">' + _esc(headline) + '</div>' : '',
      '  <div class="msc-agent-brief">' + _esc(brief) + '</div>',
      count ? '  <div style="font-family:var(--fire-mono);font-size:9px;color:var(--fire-text-dim);margin-top:6px">' + _esc(count) + '</div>' : '',
      '</div>',
    ].join('');
  }).join('');

  container.innerHTML = cardsHTML;

  // Click: scroll desktop dashboard to agents section, or navigate to dash view
  container.querySelectorAll('[data-bid]').forEach(function(card) {
    card.addEventListener('click', function() {
      var bid = this.dataset.bid;
      // On mobile: navigate to dash view (desktop sections are hidden by CSS but exist)
      // Then scroll agents-grid into view after a brief delay
      if (typeof sv === 'function') {
        // Already on dash — scroll to agents section
        var agSection = document.getElementById('agents-grid');
        if (agSection) {
          // Exit swipe deck temporarily by scrolling the view
          var viewDash = document.getElementById('view-dash');
          if (viewDash) {
            // Show desktop sections temporarily not possible on phone —
            // instead navigate to the standalone agents view via the drawer
            if (typeof mobileNav === 'function') {
              // Close swipe deck, show full page — user can tap "More → Agents" if needed
              // Best UX: show toast hinting to use More menu
              var grid = document.getElementById('agents-grid');
              if (grid) {
                // Temporarily make section visible and scroll to it
                var section = grid.closest('.fire-section');
                if (section) {
                  section.style.display = 'block';
                  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  setTimeout(function() { section.style.display = ''; }, 3000);
                }
              }
            }
          }
        }
      }
      // Trigger brief refresh for this bot
      if (bid && typeof window.loadOneBrief === 'function') {
        window.loadOneBrief(bid);
      }
    });
  });
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

/* ── Direct EW fetch for swipe card (bypasses DOM dependency) ─────── */
function _fetchEWDirect() {
  var rqFn = window.rq || function(url) { return fetch(url, {headers: window.G && G.token ? {'Authorization':'Bearer '+G.token} : {}}).then(function(r){return r.json();}); };

  rqFn('/api/intelligence/early-warning').then(function(data) {
    if (!data) return;
    var score = parseFloat(data.global_ew_score || data.score || 5);
    var col   = _ewColor(score);

    // Populate card 3 directly
    var dstScore  = _el('msc-ew-score');
    var dstLabel  = _el('msc-ew-label');
    var dstAssess = _el('msc-ew-assess');
    if (dstScore) { dstScore.textContent = score.toFixed(1); dstScore.style.color = col; }
    if (dstLabel) { dstLabel.textContent = score >= 7.5 ? 'CRITICAL' : score >= 6 ? 'ELEVATED' : score >= 4 ? 'MODERATE' : 'STABLE'; dstLabel.style.color = col; }

    if (dstAssess) {
      var text = data.ai_assessment || data.assessment || '';
      if (!text || text.length < 20) {
        text = 'EW Score ' + score.toFixed(1) + '/10. '
          + (data.event_count_48h || 0) + ' eventi monitorati. '
          + 'Macro stress: ' + (data.macro_stress || 5).toFixed(1) + '/10.';
      }
      var sents = text.match(/[^.!?]+[.!?]+/g) || [text];
      dstAssess.textContent = sents.slice(0, 3).join(' ').trim();
    }

    // Gauges
    var gauges = { macro: data.macro_stress||0, market: data.market_stress||0,
      sent: Math.abs(data.sentiment_trend||0)*10, vel: Math.min(10,(data.event_velocity||1)*4) };
    var sentCol = (data.sentiment_trend||0) < -0.3 ? '#ff5722' : (data.sentiment_trend||0) > 0.1 ? '#66bb6a' : '#ffc107';
    ['macro','market','sent','vel'].forEach(function(k) {
      var val = gauges[k];
      var pct = Math.min(100, Math.max(0, (val/10)*100));
      var c   = k === 'sent' ? sentCol : _ewColor(val);
      var bar = _el('msc-gb-' + k), lbl = _el('msc-gv-' + k);
      if (bar) { bar.style.width = pct + '%'; bar.style.background = c; }
      if (lbl) { lbl.textContent = val.toFixed(1); lbl.style.color = c; }
    });
  }).catch(function(){});

  // Signals direct
  rqFn('/api/intelligence/early-warning/signals').then(function(data) {
    var signals = (data && data.signals) || [];
    var sigContainer = _el('msc-signals');
    if (!sigContainer || !signals.length) return;
    sigContainer.innerHTML = signals.slice(0, 5).map(function(sig) {
      var lvl = sig.level || (sig.severity >= 7.5 ? 'critical' : sig.severity >= 5.5 ? 'major' : 'watch');
      var col = lvl === 'critical' ? '#ff5722' : lvl === 'major' ? '#ffc107' : '#66bb6a';
      var label = (sig.label || sig.type || '').replace(/_/g,' ');
      var val   = sig.value || (sig.severity ? parseFloat(sig.severity).toFixed(1) : '—');
      var meta  = sig.meta || (sig.region ? sig.region + (sig.title ? ' · ' + sig.title.slice(0,50) : '') : '');
      return [
        '<div class="msc-signal-row" style="border-left-color:' + col + '">',
        '  <span class="msc-sig-icon">' + (sig.icon || '⚠️') + '</span>',
        '  <div style="flex:1;min-width:0">',
        '    <span class="msc-sig-label" style="color:' + col + '">' + _esc(label.toUpperCase().slice(0,28)) + '</span>',
        meta ? '    <div style="font-size:10px;color:var(--fire-text-dim);margin-top:2px">' + _esc(meta.slice(0, 90)) + '</div>' : '',
        '  </div>',
        '  <span class="msc-sig-sev" style="color:' + col + '">' + _esc(String(val).slice(0,6)) + '</span>',
        '</div>',
      ].join('');
    }).join('');
  }).catch(function(){});

  // ── EW News: show actual event headlines with descriptions ──
  _renderEWNews();
}

function _renderEWNews() {
  var container = _el('msc-ew-news');
  if (!container) return;

  // Get recent high-severity events from G.events
  var evs = (window.G && G.events) ? G.events.slice()
    .filter(function(e){ return (e.severity||0) >= 5.5; })
    .sort(function(a,b){ return (b.severity||0) - (a.severity||0); })
    .slice(0, 5) : [];

  if (!evs.length) {
    container.innerHTML = '<div style="font-size:12px;color:var(--fire-text-dim);padding:8px 0">Nessuna news critica recente</div>';
    return;
  }

  container.innerHTML = evs.map(function(ev) {
    var sev = parseFloat(ev.severity || 5);
    var col = sev >= 7.5 ? '#ff5722' : sev >= 5.5 ? '#ffc107' : '#66bb6a';
    var country = _esc(ev.country_name || ev.country_code || 'Global');
    var cat = _esc((ev.category || '').replace(/_/g,' '));
    var title = _esc(ev.title || '');
    var desc  = _esc((ev.ai_summary || ev.summary || ev.description || '').slice(0, 120));
    var ts = _tAgo(ev.timestamp);

    return [
      '<div class="msc-news-card">',
      '  <div class="msc-news-head">',
      '    <span class="msc-news-sev" style="color:' + col + ';background:' + col + '15">' + sev.toFixed(0) + '</span>',
      '    <span class="msc-news-meta">' + country + (cat ? ' · ' + cat : '') + ' · ' + ts + '</span>',
      '  </div>',
      '  <div class="msc-news-title">' + title + '</div>',
      desc ? '  <div class="msc-news-desc">' + desc + (desc.length >= 118 ? '…' : '') + '</div>' : '',
      '</div>',
    ].join('');
  }).join('');
}

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

  // Re-sync when dashboard EW signals update
  var ewSigs = _el('dash-ew-signals');
  if (ewSigs) {
    new MutationObserver(function() {
      setTimeout(_syncCard3, 300);
    }).observe(ewSigs, { childList: true, subtree: true });
  }

  // Also watch dash-ew-assess for text updates
  var ewAssess = _el('dash-ew-assess');
  if (ewAssess) {
    new MutationObserver(function() {
      setTimeout(_syncCard3, 200);
    }).observe(ewAssess, { childList: true, subtree: true, characterData: true });
  }

  // If EW data not yet in DOM, fetch it directly after 2s
  setTimeout(function() {
    var scoreEl = _el('dash-ew-score');
    var hasData = scoreEl && scoreEl.textContent.trim() !== '—' && scoreEl.textContent.trim() !== '';
    if (!hasData && _isPhone()) {
      _fetchEWDirect();
    }
  }, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
