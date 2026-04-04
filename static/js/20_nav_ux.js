/* ═══════════════════════════════════════════════════════════════
   WORLDLENS NAV UX - FIXED & OPTIMIZED
   ───────────────────────────────────────────────────────────── */

var NAV_GROUP_MAP = {
  dash: 'intelligence', map: 'intelligence', feed: 'intelligence',
  earlywarning: 'intelligence', supplychain: 'intelligence',
  graph: 'analysis', macro: 'analysis', ai: 'analysis',
  markets: 'markets', insiders: 'markets', portfolio: 'markets',
};

var _openGroup = null;

/* ── Logic corretta per Open/Close ──────────────────────────── */
function toggleNavGroup(groupId) {
  if (_openGroup === groupId) {
    closeAllDropdowns();
  } else {
    // Chiudi gli altri ma mantieni il backdrop per il nuovo
    closeAllDropdowns(true);
    _openGroup = groupId;
    
    var group = document.getElementById('ng-' + groupId);
    var dd = document.getElementById('nd-' + groupId);
    
    if (group) group.classList.add('open');
    if (dd) dd.classList.add('open');
    _ensureBackdrop();
  }
}

function closeAllDropdowns(keepBackdrop) {
  _openGroup = null;
  document.querySelectorAll('.nav-group.open, .nav-dropdown.open').forEach(function(el) {
    el.classList.remove('open');
  });
  if (!keepBackdrop) _removeBackdrop();
}

function _ensureBackdrop() {
  if (document.getElementById('nav-backdrop')) return;
  var bd = document.createElement('div');
  bd.id = 'nav-backdrop';
  // Stile inline di emergenza se il CSS manca
  bd.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:90;background:transparent;";
  bd.addEventListener('click', function() { closeAllDropdowns(); });
  document.body.appendChild(bd);
}

function _removeBackdrop() {
  var bd = document.getElementById('nav-backdrop');
  if (bd && bd.parentNode) bd.parentNode.removeChild(bd);
}

/* ── Gestore Unificato window.sv ────────────────────────────── */
// Evitiamo doppie dichiarazioni che causano conflitti
(function() {
  var _origSv = window.sv;
  window.sv = function(name, btn) {
    // 1. Esegui funzione originale
    if (typeof _origSv === 'function') _origSv(name, btn);
    
    // 2. Chiudi menu dopo la selezione
    closeAllDropdowns();
    
    // 3. Aggiorna UI
    _updateNavActiveState(name);
    
    // 4. Fix specifico per i grafici (ex secondo blocco)
    if (name === 'graph') {
      requestAnimationFrame(function() {
        var cw = document.getElementById('ng-canvas-wrap');
        if (cw) {
          cw.style.display = 'none';
          void cw.offsetHeight; 
          cw.style.display = '';
        }
        if (typeof _casInitSVG === 'function') _casInitSVG();
      });
    }
  };
})();

/* ── Aggiornamento Stato Nav ────────────────────────────────── */
function _updateNavActiveState(viewName) {
  // Reset classi attive
  document.querySelectorAll('.ni, .nd-item, .wl-mnav-btn').forEach(function(el) {
    el.classList.remove('on', 'active');
  });
  document.querySelectorAll('.nav-group-btn').forEach(function(b) {
    b.classList.remove('active-group');
  });

  // Attiva elementi correnti
  document.querySelectorAll('.ni[data-v="' + viewName + '"]').forEach(function(b) { b.classList.add('on'); });
  document.querySelectorAll('.nd-item[data-v="' + viewName + '"]').forEach(function(b) { b.classList.add('active'); });
  
  var group = NAV_GROUP_MAP[viewName];
  if (group) {
    var btn = document.querySelector('#ng-' + group + ' .nav-group-btn');
    if (btn) btn.classList.add('active-group');
  }
}

/* ── Event Listeners ────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  // Fix click sui bottoni gruppo
  document.querySelectorAll('.nav-group-btn').forEach(function(btn) {
    btn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      var group = btn.closest('.nav-group');
      if (group) {
        var gid = group.id.replace('ng-', '');
        toggleNavGroup(gid);
      }
    });
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeAllDropdowns();
  });

  // Init iniziale
  _updateNavActiveState('dash');
});

// XP Pill logic rimane invariata ma pulita
setInterval(function() {
  var pill = document.getElementById('nav-xp-pill');
  var val = document.getElementById('nav-xp-val');
  var xpEl = document.getElementById('gam-xp');
  if (pill && val && xpEl && xpEl.textContent !== '0') {
    val.textContent = xpEl.textContent + ' XP';
    pill.style.display = 'flex';
  }
}, 5000);
