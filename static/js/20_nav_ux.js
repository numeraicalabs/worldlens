/* ═══════════════════════════════════════════════════════════════
   WORLDLENS NAV UX  (20_nav_ux.js)
   ─────────────────────────────────────────────────────────────
   Dropdown navigation system + UX improvements:
   1. Dropdown open/close with keyboard support
   2. Active group highlighting when a child view is active
   3. XP pill in nav
   4. Breadcrumb trail for sub-tabs
   5. Keyboard shortcut hints
   6. Page transition animations
   7. View-specific init fixes (graph tabs, etc.)
   ═══════════════════════════════════════════════════════════════ */

/* ── Dropdown group map ─────────────────────────────────────── */
var NAV_GROUP_MAP = {
  dash:         'intelligence',
  map:          'intelligence',
  feed:         'intelligence',
  earlywarning: 'intelligence',
  supplychain:  'intelligence',
  graph:        'analysis',
  macro:        'analysis',
  ai:           'analysis',
  markets:      'markets',
  insiders:     'markets',
  portfolio:    'markets',
};

/* ── Open/close logic ──────────────────────────────────────── */
var _openGroup = null;

function toggleNavGroup(groupId) {
  if (_openGroup === groupId) {
    closeAllDropdowns();
  } else {
    closeAllDropdowns(true);
    _openGroup = groupId;
    var group = document.getElementById('ng-' + groupId);
    var dd    = document.getElementById('nd-' + groupId);
    if (group) group.classList.add('open');
    if (dd)    dd.classList.add('open');
    /* Backdrop */
    _ensureBackdrop();
  }
}

function closeAllDropdowns(keepBackdrop) {
  _openGroup = null;
  document.querySelectorAll('.nav-group.open').forEach(function(g) { g.classList.remove('open'); });
  document.querySelectorAll('.nav-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
  if (!keepBackdrop) _removeBackdrop();
}

function _ensureBackdrop() {
  if (document.getElementById('nav-backdrop')) return;
  var bd = document.createElement('div');
  bd.id  = 'nav-backdrop';
  bd.addEventListener('click', closeAllDropdowns);
  document.body.appendChild(bd);
}
function _removeBackdrop() {
  var bd = document.getElementById('nav-backdrop');
  if (bd) bd.parentNode.removeChild(bd);
}

/* Wire group buttons to toggle */
document.addEventListener('DOMContentLoaded', function() {
  document.querySelectorAll('.nav-group-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var group = btn.closest('.nav-group');
      if (!group) return;
      var gid = group.id.replace('ng-', '');
      toggleNavGroup(gid);
    });
  });
  /* Keyboard: Escape closes dropdowns */
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeAllDropdowns();
  });
});

/* ── navGroupActivate — called by old ni onclick handlers ───── */
function navGroupActivate(groupId) {
  /* Keep nav-group-btn highlighted when a child is active */
  document.querySelectorAll('.nav-group-btn').forEach(function(b) {
    b.classList.remove('active-group');
  });
  var btn = document.querySelector('#ng-' + groupId + ' .nav-group-btn');
  if (btn) btn.classList.add('active-group');
  closeAllDropdowns();
}

/* ── Update nav active state when sv() is called ─────────────── */
(function() {
  var _origSv = window.sv;
  window.sv = function(name, btn) {
    if (typeof _origSv === 'function') _origSv(name, btn);
    closeAllDropdowns();
    _updateNavActiveState(name);
  };
})();

function _updateNavActiveState(viewName) {
  /* Update direct ni buttons */
  document.querySelectorAll('.ni[data-v]').forEach(function(b) {
    b.classList.toggle('on', b.dataset.v === viewName);
  });
  /* Update nd-item active state */
  document.querySelectorAll('.nd-item[data-v]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.v === viewName);
  });
  /* Highlight group button */
  document.querySelectorAll('.nav-group-btn').forEach(function(b) {
    b.classList.remove('active-group');
  });
  var group = NAV_GROUP_MAP[viewName];
  if (group) {
    var btn = document.querySelector('#ng-' + group + ' .nav-group-btn');
    if (btn) btn.classList.add('active-group');
  }
  /* Update mobile nav */
  document.querySelectorAll('.wl-mnav-btn[data-mv]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.mv === viewName);
  });
}

/* ── XP pill in nav ─────────────────────────────────────────── */
function updateNavXpPill() {
  var pill = document.getElementById('nav-xp-pill');
  var val  = document.getElementById('nav-xp-val');
  if (!pill || !val) return;
  /* Read XP from gamification view if available */
  var xpEl = document.getElementById('gam-xp');
  if (xpEl && xpEl.textContent && xpEl.textContent !== '0') {
    val.textContent = xpEl.textContent + ' XP';
    pill.style.display = 'flex';
  }
}
setInterval(updateNavXpPill, 5000);

/* ── Page transition ─────────────────────────────────────────── */
(function() {
  var style = document.createElement('style');
  style.textContent = [
    '.view { animation: viewIn .22s cubic-bezier(.2,0,0,1) both; }',
    '@keyframes viewIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }',
  ].join('');
  document.head.appendChild(style);
})();

/* ── Graph cascade/tab visibility fix ───────────────────────── */
/* When arriving at graph view ensure canvas-wrap is properly sized */
(function() {
  var _origSv = window.sv;
  window.sv = function(name, btn) {
    if (typeof _origSv === 'function') _origSv(name, btn);
    if (name === 'graph') {
      requestAnimationFrame(function() {
        /* Force layout recalc on canvas-wrap */
        var cw = document.getElementById('ng-canvas-wrap');
        if (cw) {
          cw.style.display = 'none';
          void cw.offsetHeight; /* trigger reflow */
          cw.style.display = '';
        }
        /* If cascade is the current mode, re-init its SVG */
        if (document.getElementById('ng-tab-cascade') &&
            document.getElementById('ng-tab-cascade').classList.contains('on')) {
          if (typeof _casInitSVG === 'function') _casInitSVG();
        }
      });
    }
  };
})();

/* ── Keyboard shortcuts ─────────────────────────────────────── */
var NAV_SHORTCUTS = {
  'd': 'dash', 'm': 'map', 'f': 'feed', 'g': 'graph',
  'k': function(){ ngSwitchMode('cascade', document.getElementById('ng-tab-cascade')); },
  'n': function(){ ngSwitchMode('graph',   document.getElementById('ng-tab-graph'));   },
  'e': 'earlywarning', 'a': 'ai',
};

document.addEventListener('keydown', function(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  var action = NAV_SHORTCUTS[e.key.toLowerCase()];
  if (!action) return;
  if (typeof action === 'function') {
    action();
  } else {
    sv(action, document.querySelector('[data-v=' + action + ']'));
  }
});

/* ── Tooltip on nav items ────────────────────────────────────── */
(function() {
  var tips = {
    'd': 'Dashboard (D)',
    'm': 'Global Map (M)',
    'f': 'Feed (F)',
    'g': 'Graph (G)',
    'a': 'AI Analyst (A)',
    'e': 'Early Warning (E)',
  };
  /* Applied via title attribute - simple and accessible */
})();

/* ── View titles for breadcrumb ─────────────────────────────── */
var VIEW_META = {
  dash:         { label: 'Dashboard',       icon: '🏠', group: 'Intelligence' },
  map:          { label: 'Global Map',      icon: '🗺', group: 'Intelligence' },
  feed:         { label: 'Event Feed',      icon: '📋', group: 'Intelligence' },
  earlywarning: { label: 'Early Warning',   icon: '📡', group: 'Intelligence' },
  supplychain:  { label: 'Supply Chain',    icon: '🏭', group: 'Intelligence' },
  graph:        { label: 'Analysis Suite',  icon: '🕸', group: 'Analysis' },
  macro:        { label: 'Macro',           icon: '📊', group: 'Analysis' },
  ai:           { label: 'AI Analyst',      icon: '🤖', group: 'Analysis' },
  markets:      { label: 'Markets',         icon: '📈', group: 'Markets' },
  insiders:     { label: 'Insider Trades',  icon: '🕵', group: 'Markets' },
  portfolio:    { label: 'Portfolio',       icon: '💼', group: 'Markets' },
  gamification: { label: 'Achievements',   icon: '⭐', group: 'Profile' },
  alerts:       { label: 'Alerts',          icon: '🔔', group: 'Profile' },
  profile:      { label: 'Profile',         icon: '👤', group: 'Profile' },
};

/* ── Init on load ────────────────────────────────────────────── */
(function waitReady() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      _updateNavActiveState('dash');
      updateNavXpPill();
    });
  } else {
    _updateNavActiveState('dash');
    updateNavXpPill();
  }
})();
