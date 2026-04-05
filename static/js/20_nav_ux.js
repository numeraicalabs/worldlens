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
  dash:           'intelligence',
  map:            'intelligence',
  feed:           'intelligence',
  earlywarning:   'intelligence',
  supplychain:    'intelligence',
  graph:          'analysis',
  'graph-graph':    'analysis',
  'graph-explorer': 'analysis',
  'graph-timeline': 'analysis',
  'graph-cascade':  'analysis',
  macro:          'analysis',
  ai:             'analysis',
  markets:        'markets',
  insiders:       'markets',
  portfolio:      'markets',
};

/* ── Open/close logic ──────────────────────────────────────── */
var _openGroup = null;

function toggleNavGroup(groupId) {
  if (_openGroup === groupId) {
    closeAllDropdowns();
  } else {
    closeAllDropdowns();
    _openGroup = groupId;
    var group = document.getElementById('ng-' + groupId);
    var dd    = document.getElementById('nd-' + groupId);
    if (group) group.classList.add('open');
    if (dd)    dd.classList.add('open');
  }
}

function closeAllDropdowns() {
  _openGroup = null;
  document.querySelectorAll('.nav-group.open').forEach(function(g) { g.classList.remove('open'); });
  document.querySelectorAll('.nav-dropdown.open').forEach(function(d) { d.classList.remove('open'); });
}

/* Close on click outside nav — no backdrop needed */
document.addEventListener('click', function(e) {
  if (_openGroup && !e.target.closest('#nav')) {
    closeAllDropdowns();
  }
}, true);

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

/* ── Graph sub-mode helper ───────────────────────────────────── */
/*  Replaces the brittle sv()+setTimeout(200)+closeAll inline pattern in
    the nav dropdown. Uses rAF instead of an arbitrary 200ms timeout so
    the sub-tab switches as soon as the view is painted.            */
function svGraph(mode) {
  sv('graph', document.querySelector('[data-v=graph]'));
  /* rAF fires after the view is display:flex — safer than setTimeout(200) */
  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      var tabId = 'ng-tab-' + mode;
      ngSwitchMode(mode, document.getElementById(tabId));
      /* Mark the correct nd-item active */
      _updateNavActiveState('graph-' + mode);
    });
  });
}
/* FIX: merged two separate sv() wrappers into one to avoid 5-level chain */
(function() {
  var _origSv = window.sv;
  window.sv = function(name, btn) {
    if (typeof _origSv === 'function') _origSv(name, btn);
    closeAllDropdowns();
    _updateNavActiveState(name);
    /* Graph canvas resize (was a second separate wrapper) */
    if (name === 'graph') {
      requestAnimationFrame(function() {
        var cw = document.getElementById('ng-canvas-wrap');
        if (cw) {
          cw.style.display = 'none';
          void cw.offsetHeight;
          cw.style.display = '';
        }
        if (document.getElementById('ng-tab-cascade') &&
            document.getElementById('ng-tab-cascade').classList.contains('on')) {
          if (typeof _casInitSVG === 'function') _casInitSVG();
        }
      });
    }
  };
})();

function _updateNavActiveState(viewName) {
  /* Update direct ni buttons */
  document.querySelectorAll('.ni[data-v]').forEach(function(b) {
    b.classList.toggle('on', b.dataset.v === viewName);
  });
  /* Update nd-item active state — supports both plain data-v and graph-* sub-modes */
  var ndView = viewName;            /* e.g. 'macro', 'ai' */
  var ndMode = null;                /* e.g. 'cascade' for 'graph-cascade' */
  if (viewName.indexOf('graph-') === 0) {
    ndView = 'graph';
    ndMode = viewName.replace('graph-', '');   /* 'cascade' | 'explorer' | 'timeline' | 'graph' */
  }
  document.querySelectorAll('.nd-item').forEach(function(b) {
    var match = false;
    if (b.dataset.v) {
      match = b.dataset.v === ndView;
    } else if (ndMode && b.dataset.graphMode) {
      match = b.dataset.graphMode === ndMode;
    }
    b.classList.toggle('active', match);
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
    b.classList.toggle('active', b.dataset.mv === ndView);
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
/* FIX: excluded #view-dash — it has its own staggered fireIn animations
   in worldlens_fire.css; applying viewIn on top caused a double-flash. */
(function() {
  var style = document.createElement('style');
  style.textContent = [
    '.view:not(#view-dash) { animation: viewIn .22s cubic-bezier(.2,0,0,1) both; }',
    '@keyframes viewIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }',
  ].join('');
  document.head.appendChild(style);
})();

/* ── Graph canvas fix merged into the sv() wrapper above ────── */

/* ── Keyboard shortcuts ─────────────────────────────────────── */
var NAV_SHORTCUTS = {
  'd': 'dash', 'm': 'map', 'f': 'feed',
  'g': function(){ svGraph('graph'); },
  'x': function(){ svGraph('explorer'); },
  'c': function(){ svGraph('cascade'); },
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
  dash:            { label: 'Dashboard',          icon: '🏠', group: 'Intelligence' },
  map:             { label: 'Global Map',          icon: '🗺', group: 'Intelligence' },
  feed:            { label: 'Event Feed',          icon: '📋', group: 'Intelligence' },
  earlywarning:    { label: 'Early Warning',       icon: '📡', group: 'Intelligence' },
  supplychain:     { label: 'Supply Chain',        icon: '🏭', group: 'Intelligence' },
  graph:           { label: 'News Graph',          icon: '🕸', group: 'Analysis' },
  'graph-graph':   { label: 'News Graph',          icon: '🕸', group: 'Analysis' },
  'graph-explorer':{ label: 'Knowledge Explorer',  icon: '🔍', group: 'Analysis' },
  'graph-timeline':{ label: 'Timeline Graph',      icon: '📅', group: 'Analysis' },
  'graph-cascade': { label: 'Cascade Simulator',   icon: '⚡', group: 'Analysis' },
  macro:           { label: 'Macro',               icon: '📊', group: 'Analysis' },
  ai:              { label: 'AI Analyst',          icon: '🤖', group: 'Analysis' },
  markets:         { label: 'Markets',             icon: '📈', group: 'Markets' },
  insiders:        { label: 'Insider Trades',      icon: '🕵', group: 'Markets' },
  portfolio:       { label: 'Portfolio',           icon: '💼', group: 'Markets' },
  gamification:    { label: 'Achievements',        icon: '⭐', group: 'Profile' },
  alerts:          { label: 'Alerts',              icon: '🔔', group: 'Profile' },
  profile:         { label: 'Profile',             icon: '👤', group: 'Profile' },
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
