/**
 * 33_mobile_ux.js — Mobile UX layer
 *
 * 1. Dashboard feed cards — syncs mob-* elements from the live data already
 *    rendered into the desktop d-* elements (no extra API calls).
 * 2. Map bottom sheet — 3-level drag (peek/half/full) with pointer events.
 * 3. Map chip filters — tap to filter visible markers by category.
 * 4. Empty state shimmer — replaces "—" with informative placeholders.
 *
 * Runs only on mobile (≤ 768px). Zero side-effects on desktop.
 */
(function () {
'use strict';

/* ── Utility ─────────────────────────────────────────────────────── */
function _isMob() { return window.innerWidth <= 768; }
function _isPhone() { return window.innerWidth <= 480; }
function _el(id) { return document.getElementById(id); }
function _esc(s) {
  return String(s||'')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;');
}
function _ewColor(score) {
  if (score >= 7.5) return '#ff5722';
  if (score >= 6.0) return '#ffc107';
  if (score >= 4.0) return '#ffca28';
  return '#66bb6a';
}

/* ══════════════════════════════════════════════════════════════════
   1. DASHBOARD MOBILE FEED CARDS
   ══════════════════════════════════════════════════════════════════ */

/** Show mobile-only cards by copying values from desktop elements. */
function _showMobileCards() {
  if (!_isPhone()) return;

  var riskCard = _el('mob-risk-card');
  var kpiCard  = _el('mob-kpi-card');
  var ewCard   = _el('mob-ew-card');
  if (riskCard) riskCard.style.display = 'flex';
  if (kpiCard)  kpiCard.style.display  = 'block';
  if (ewCard)   ewCard.style.display   = 'block';
}

/** Sync risk number + brief from desktop elements */
function _syncRiskCard() {
  var srcNum   = _el('d-risk');
  var srcLabel = _el('d-risk-l');
  var srcBrief = _el('d-brief-txt');

  var dstNum   = _el('mob-risk-num');
  var dstLabel = _el('mob-risk-lbl');
  var dstBrief = _el('mob-risk-brief');

  if (srcNum && dstNum) {
    var numText = (srcNum.textContent||'').replace('/100','').trim();
    dstNum.textContent = numText || '—';
    var num = parseFloat(numText) || 0;
    var col = num > 60 ? '#ff5722' : num > 35 ? '#ffc107' : '#66bb6a';
    dstNum.style.color   = col;
    if (dstLabel) {
      dstLabel.textContent = (srcLabel && srcLabel.textContent) || '—';
      dstLabel.style.color = col;
    }
  }

  if (srcBrief && dstBrief) {
    var briefText = srcBrief.textContent || srcBrief.innerText || '';
    // Take first sentence for the compact card
    var firstSentence = briefText.split(/[.!?]/)[0];
    if (firstSentence && firstSentence.length > 10) {
      dstBrief.textContent = firstSentence.trim() + '.';
    } else if (briefText.length > 10) {
      dstBrief.textContent = briefText.slice(0, 120) + (briefText.length > 120 ? '…' : '');
    }
  }
}

/** Sync KPI values from desktop to mobile row */
function _syncKPIRow() {
  var pairs = [
    ['d-sp',   'd-sp-c',   'mob-sp',   'mob-sp-c'],
    ['d-btc',  'd-btc-c',  'mob-btc',  'mob-btc-c'],
    ['d-vix',  'd-vix-l',  'mob-vix',  'mob-vix-c'],
    ['d-gold', 'd-gold-c', 'mob-gold', 'mob-gold-c'],
    ['d-dxy',  'd-dxy-c',  'mob-dxy',  'mob-dxy-c'],
    ['d-ev',   'd-hi',     'mob-ev',   'mob-ev-hi'],
  ];
  pairs.forEach(function(p) {
    var srcVal = _el(p[0]), srcChg = _el(p[1]);
    var dstVal = _el(p[2]), dstChg = _el(p[3]);
    if (srcVal && dstVal) dstVal.textContent = srcVal.textContent || '—';
    if (srcChg && dstChg) {
      dstChg.textContent = srcChg.textContent || '';
      var t = dstChg.textContent;
      dstChg.className = 'mob-kpi-item-chg ' +
        (t.startsWith('+') || t.startsWith('↑') ? 'mob-kpi-up' :
         t.startsWith('-') || t.startsWith('↓') ? 'mob-kpi-down' : 'mob-kpi-flat');
    }
  });
}

/** Sync EW data from the live strip (ew-score etc.) */
function _syncEWCard() {
  var srcScore  = _el('dash-ew-score');
  var srcLabel  = _el('dash-ew-label');
  var srcAssess = _el('dash-ew-assess');
  var srcEvCnt  = _el('dash-ew-evcount');

  var dstScore  = _el('mob-ew-score');
  var dstLabel  = _el('mob-ew-label');
  var dstAssess = _el('mob-ew-assess');
  var dstEvCnt  = _el('mob-ew-evcount');

  if (srcScore && dstScore) {
    var sc = parseFloat(srcScore.textContent) || 0;
    dstScore.textContent = sc > 0 ? sc.toFixed(1) : '—';
    var col = _ewColor(sc);
    dstScore.style.color = col;
    if (dstLabel) { dstLabel.textContent = srcLabel ? srcLabel.textContent : '—'; dstLabel.style.color = col; }
  }
  if (srcAssess && dstAssess) {
    var text = srcAssess.textContent || srcAssess.innerText || '';
    var first2 = text.split(/[.!?]/).slice(0,2).join('. ').trim();
    dstAssess.textContent = first2.length > 15 ? first2 + '.' : text.slice(0, 140) + (text.length > 140 ? '…' : '');
  }
  if (srcEvCnt && dstEvCnt) dstEvCnt.textContent = srcEvCnt.textContent || '—';

  // Gauges
  var gaugeMap = [
    ['dash-ewgb-macro',  'mob-ewgb-macro'],
    ['dash-ewgb-market', 'mob-ewgb-market'],
    ['dash-ewgb-sent',   'mob-ewgb-sent'],
    ['dash-ewgb-vel',    'mob-ewgb-vel'],
  ];
  gaugeMap.forEach(function(pair) {
    var src = _el(pair[0]), dst = _el(pair[1]);
    if (src && dst) {
      dst.style.width      = src.style.width || '0%';
      dst.style.background = src.style.background || '#ffc107';
    }
  });
}

/** Main sync — called after data loads */
function syncMobileFeed() {
  if (!_isPhone()) return;
  _showMobileCards();
  _syncRiskCard();
  _syncKPIRow();
  _syncEWCard();
  _injectEmptyStates();
}
window.syncMobileFeed = syncMobileFeed;

/** Replace bare "—" with informative empty states */
function _injectEmptyStates() {
  var empties = document.querySelectorAll('#view-dash .fire-kpi-val');
  empties.forEach(function(el) {
    if (el.textContent.trim() === '—') {
      el.innerHTML = '<span style="font-size:12px;color:var(--fire-text-dim);font-family:var(--fire-sans)">In arrivo…</span>';
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
   2. MAP BOTTOM SHEET — 3-level drag
   ══════════════════════════════════════════════════════════════════ */

var _sheet = null;
var _sheetState = 'half'; // peek | half | full
var _dragStartY = 0;
var _dragStartTranslate = 0;
var _isDragging = false;

var SHEET_HEIGHTS = {
  peek: 0.12,   // 12% of viewport
  half: 0.50,   // 50%
  full: 0.90,   // 90%
};

function _sheetPx(state) {
  return Math.round(window.innerHeight * SHEET_HEIGHTS[state]);
}

function _setSheetHeight(px, animate) {
  if (!_sheet) return;
  var maxH = window.innerHeight * 0.92;
  px = Math.max(_sheetPx('peek'), Math.min(px, maxH));
  _sheet.style.transition = animate ? 'height 0.35s cubic-bezier(0.16,1,0.3,1)' : 'none';
  _sheet.style.height = px + 'px';

  // Adjust map padding so markers aren't hidden behind sheet
  var mapEl = document.getElementById('map');
  if (mapEl) {
    mapEl.style.transition = animate ? 'padding-bottom 0.35s ease' : 'none';
    mapEl.style.paddingBottom = px + 'px';
    if (window.G && G.map) G.map.invalidateSize();
  }
}

function _snapSheet(targetState) {
  _sheetState = targetState;
  _setSheetHeight(_sheetPx(targetState), true);

  // Show/hide scroll on body
  var body = document.getElementById('mob-map-sheet-body');
  if (body) body.style.overflowY = targetState === 'full' ? 'auto' : 'hidden';
}

function _onSheetPointerDown(e) {
  if (!_isMob()) return;
  _isDragging  = true;
  _dragStartY  = e.touches ? e.touches[0].clientY : e.clientY;
  _dragStartTranslate = parseFloat(_sheet.style.height) || _sheetPx(_sheetState);
  _sheet.style.transition = 'none';
  e.currentTarget.setPointerCapture && e.currentTarget.setPointerCapture(e.pointerId);
}

function _onSheetPointerMove(e) {
  if (!_isDragging) return;
  var y     = e.touches ? e.touches[0].clientY : e.clientY;
  var delta = _dragStartY - y; // positive = dragging up
  var newH  = _dragStartTranslate + delta;
  _setSheetHeight(newH, false);
}

function _onSheetPointerUp(e) {
  if (!_isDragging) return;
  _isDragging = false;
  var currentH = parseFloat(_sheet.style.height) || _sheetPx(_sheetState);
  var vh = window.innerHeight;

  // Snap to nearest state based on current position + velocity hint
  if      (currentH < vh * 0.25) _snapSheet('peek');
  else if (currentH < vh * 0.70) _snapSheet('half');
  else                             _snapSheet('full');
}

/** Populate sheet with current events */
function _populateSheet(events) {
  var body = _el('mob-map-sheet-body');
  var cnt  = _el('mob-map-sheet-count');
  if (!body) return;

  var evs = events || (window.G && G.events) || [];
  // Apply chip filter
  var activeCat = window._mobMapActiveCat || 'all';
  if (activeCat !== 'all') {
    evs = evs.filter(function(e){ return e.category === activeCat; });
  }
  // Sort by severity desc, take top 30
  evs = evs.slice().sort(function(a,b){ return (b.severity||0) - (a.severity||0); }).slice(0, 30);

  if (cnt) cnt.textContent = '(' + evs.length + ')';

  if (!evs.length) {
    body.innerHTML = '<div style="padding:32px 16px;text-align:center;color:rgba(255,255,255,0.3);font-size:13px">Nessun evento in questa categoria</div>';
    return;
  }

  body.innerHTML = evs.map(function(ev) {
    var sev = parseFloat(ev.severity || 5);
    var col = sev >= 7.5 ? '#ff5722' : sev >= 5.5 ? '#ffc107' : '#66bb6a';
    var country = ev.country_name || ev.country_code || 'Global';
    var cat = (ev.category || '').replace(/_/g,' ');
    var ts = ev.timestamp ? ev.timestamp.slice(0,10) : '';
    return [
      '<div class="mob-sheet-event" onclick="_mobSheetOpenEvent(\'' + _esc(ev.id||'') + '\')">',
      '  <div class="mob-sheet-sev" style="color:' + col + '">' + sev.toFixed(0) + '</div>',
      '  <div class="mob-sheet-info">',
      '    <div class="mob-sheet-title">' + _esc(ev.title || '') + '</div>',
      '    <div class="mob-sheet-meta">' + _esc(country) + (cat ? ' · ' + _esc(cat) : '') + (ts ? ' · ' + ts : '') + '</div>',
      '  </div>',
      '</div>',
    ].join('');
  }).join('');
}

window._mobSheetOpenEvent = function(evId) {
  // Delegate to existing desktop panel opener
  if (!evId) return;
  var ev = window.G && G.events && G.events.find(function(e){ return e.id === evId; });
  if (ev && typeof openEP === 'function') openEP(ev);
  _snapSheet('peek'); // collapse sheet to show map
};

function mobInitSheet() {
  if (!_isMob()) return;
  _sheet = _el('mob-map-sheet');
  if (!_sheet) return;

  // Initial height
  _snapSheet('half');

  // Drag bindings on handle
  var handle = _el('mob-map-sheet-handle');
  var header = _el('mob-map-sheet-header');
  [handle, header].forEach(function(el) {
    if (!el) return;
    el.addEventListener('touchstart',  _onSheetPointerDown, { passive: true });
    el.addEventListener('touchmove',   _onSheetPointerMove, { passive: true });
    el.addEventListener('touchend',    _onSheetPointerUp,   { passive: true });
    el.addEventListener('pointerdown', _onSheetPointerDown);
    el.addEventListener('pointermove', _onSheetPointerMove);
    el.addEventListener('pointerup',   _onSheetPointerUp);
  });

  // Populate with current events
  _populateSheet();
}
window.mobInitSheet = mobInitSheet;

/** Re-populate sheet after map marker update */
window.mobRefreshSheet = function() {
  if (_isMob()) _populateSheet();
};

/* ══════════════════════════════════════════════════════════════════
   3. MAP CHIP FILTERS
   ══════════════════════════════════════════════════════════════════ */

window._mobMapActiveCat = 'all';

window.mobMapChip = function(btn, cat) {
  // Update active chip style
  document.querySelectorAll('.mob-chip').forEach(function(c) {
    c.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  window._mobMapActiveCat = cat;

  // Apply filter to desktop category pills (reuse existing map filter system)
  if (cat === 'all') {
    // Enable all
    document.querySelectorAll('#mcats .cpill').forEach(function(p) {
      p.classList.add('on');
    });
  } else {
    // Enable only selected category
    document.querySelectorAll('#mcats .cpill').forEach(function(p) {
      var matches = (p.dataset.c || '').toLowerCase() === cat.toLowerCase();
      p.classList.toggle('on', matches);
    });
  }

  // Update markers via existing function
  if (typeof updateMarkers === 'function') updateMarkers();

  // Refresh sheet list
  _populateSheet();
};

/* ══════════════════════════════════════════════════════════════════
   4. ONBOARDING — mobile dot navigation enhancements
   ══════════════════════════════════════════════════════════════════ */

/** Update progress dots with amber active color */
function _patchObDots() {
  var orig = window._obRender;
  if (typeof orig !== 'function') return;
  var _origRender = orig;
  window._obRender = function() {
    _origRender.apply(this, arguments);
    // Re-style dots with amber
    var dots = _el('ob-dots');
    if (!dots || !window.OB) return;
    var total = (window.OB_STEPS || []).length;
    dots.innerHTML = Array.from({length: total}, function(_, i) {
      var active = i === OB.step;
      return '<span style="width:' + (active ? '20px' : '8px') + ';height:8px;border-radius:4px;' +
        'background:' + (active ? '#ffc107' : 'rgba(255,255,255,0.15)') + ';' +
        'transition:all 0.2s;display:inline-block"></span>';
    }).join('');
  };
}

/* ══════════════════════════════════════════════════════════════════
   5. BOOT — hook into existing app events
   ══════════════════════════════════════════════════════════════════ */

function _boot() {
  if (!_isMob()) return;

  // ── Dashboard feed: sync after renderDash populates desktop elements
  // Poll for data after page loads
  var _syncAttempts = 0;
  function _trySyncFeed() {
    var riskEl = _el('d-risk');
    var hasData = riskEl && riskEl.textContent.trim() !== '—' && riskEl.textContent.trim() !== '';
    if (hasData) {
      syncMobileFeed();
    } else if (_syncAttempts < 20) {
      _syncAttempts++;
      setTimeout(_trySyncFeed, 800);
    }
  }
  setTimeout(_trySyncFeed, 1200);

  // ── Re-sync whenever risk data changes (MutationObserver on d-risk)
  var riskEl = _el('d-risk');
  if (riskEl) {
    new MutationObserver(function() {
      setTimeout(syncMobileFeed, 300);
    }).observe(riskEl, { characterData: true, childList: true, subtree: true });
  }

  // ── EW data sync: re-sync when ew-score changes
  var ewEl = _el('dash-ew-score');
  if (ewEl) {
    new MutationObserver(function() {
      setTimeout(_syncEWCard, 200);
    }).observe(ewEl, { characterData: true, childList: true, subtree: true });
  }

  // ── Map bottom sheet: init when map view opens
  var mapView = _el('view-map');
  if (mapView) {
    new MutationObserver(function() {
      if (mapView.classList.contains('on') && _isMob()) {
        setTimeout(mobInitSheet, 400);
      }
    }).observe(mapView, { attributes: true, attributeFilter: ['class'] });
    // If map is already active
    if (mapView.classList.contains('on')) setTimeout(mobInitSheet, 400);
  }

  // ── Re-populate sheet after markers update
  // Patch updateMarkers to also refresh the sheet
  var _origUpdateMarkers = window.updateMarkers;
  if (typeof _origUpdateMarkers === 'function') {
    window.updateMarkers = function() {
      _origUpdateMarkers.apply(this, arguments);
      if (_isMob() && _el('mob-map-sheet')) {
        setTimeout(_populateSheet, 100);
      }
    };
  }

  // ── Onboarding dot enhancement
  setTimeout(_patchObDots, 500);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', _boot);
} else {
  _boot();
}

})();
