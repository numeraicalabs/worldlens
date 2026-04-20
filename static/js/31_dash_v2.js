/**
 * 31_dash_v2.js — Dashboard v2 UI logic
 *
 * Handles:
 *   - Early Warning tabs (signals / escalation / predictions)
 *   - Crisis Spotlight expand/collapse
 *   - Timeframe pill state (visual only — globe reads it on render)
 *   - Hero date label
 *
 * NOTE: Globe zone rotation is handled entirely by 23_dash_globe.js.
 *       This file does NOT duplicate region fetching.
 */
(function () {
'use strict';

// ── EARLY WARNING TABS ───────────────────────────────────────────────────────
function initEWTabs() {
  var tabs = document.querySelectorAll('.fire-ew-tab');
  if (!tabs.length) return;
  tabs.forEach(function (tab) {
    tab.addEventListener('click', function () {
      var t = tab.dataset.tab;
      if (!t) return;
      tabs.forEach(function (x) { x.classList.toggle('active', x.dataset.tab === t); });
      document.querySelectorAll('.fire-ew-panel').forEach(function (p) {
        p.classList.toggle('active', p.dataset.panel === t);
      });
    });
  });
}

// ── CRISIS EXPAND/COLLAPSE ───────────────────────────────────────────────────
function initCrisisExpand() {
  // Delegate — handles dynamically inserted cards too
  var list = document.getElementById('d-evlist');
  if (!list) return;
  list.addEventListener('click', function (e) {
    var card = e.target.closest('.fire-crisis');
    if (card) card.classList.toggle('expanded');
  });
}

// ── TIMEFRAME PILLS ──────────────────────────────────────────────────────────
function initTimepills() {
  document.querySelectorAll('.fire-timepill').forEach(function (pill) {
    pill.addEventListener('click', function () {
      document.querySelectorAll('.fire-timepill').forEach(function (p) {
        p.classList.toggle('active', p === pill);
      });
      // Update window label in zone popup if globe already running
      var windowEl = document.getElementById('fire-zone-window');
      if (windowEl) windowEl.textContent = pill.textContent.trim() + ' WINDOW';
    });
  });
}

// ── HERO DATE LABEL ──────────────────────────────────────────────────────────
function setHeroDate() {
  var el = document.getElementById('fire-hero-date');
  if (!el) return;
  var d = new Date();
  var days = ['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'];
  var months = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  el.textContent = days[d.getDay()] + ' · ' + months[d.getMonth()] + ' ' + d.getDate() + ' · ' + d.getFullYear();
}

// ── INIT ─────────────────────────────────────────────────────────────────────
function init() {
  if (!document.getElementById('view-dash')) return;
  setHeroDate();
  initEWTabs();
  initCrisisExpand();
  initTimepills();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();
