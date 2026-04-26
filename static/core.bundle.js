/**
 * WorldLens v21 — CORE BUNDLE
 * Includes: globals, core utils, theme, navigation, mobile UX, onboarding, alerts/profile stubs
 * Auto-generated from: 01_globals.js 02_core.js 30_theme.js 20_nav_ux.js 33_mobile_ux.js 27_onboarding.js 10_stubs.js
 */


/* ═══════════ 01_globals.js ═══════════ */
/**
 * @file 01_globals.js
 * @module WorldLens/Global State & Constants
 *
 * @description
 * Centralised application state objects (G, KG, HEV, MKT),
 * category configs (CATS, LEVELS), relationship colour maps (REL_COLORS).
 * Must load first — all other modules depend on these globals.
 *
 * @dependencies none
 * @exports G, KG, HEV, MKT, CATS, LEVELS, REL_COLORS, REL_LABELS
 */


// ════════════════════════════════════════════════════════
// WORLD LENS — MAIN JAVASCRIPT
// Single clean script block, no chained wrappers
// ════════════════════════════════════════════════════════

var G = {
  user:null, token:null, userProfile:null,
  events:[], finance:[], watchlist:[], alerts:[], stats:{}, macro:[],
  map:null, markers:{}, hmLayers:[], hmOn:false, mapReady:false,
  filt:{cat:null, impact:'', search:'', hours:24},
  mkt:'all', macroTab:'all',
  panelEv:null, ws:null,
  portState:{risk:'Moderate', horizon:'Medium-term (3-5 years)', focuses:[]},
  isNewUser:false,
  currentView:'dash'
};

var CATS = {
  CONFLICT:    {c:'#EF4444',i:'⚔',  bg:'rgba(239,68,68,.15)'},
  SECURITY:    {c:'#DC2626',i:'🔒',  bg:'rgba(220,38,38,.15)'},
  EARTHQUAKE:  {c:'#EAB308',i:'⚡',  bg:'rgba(234,179,8,.15)'},
  DISASTER:    {c:'#F97316',i:'🌪',  bg:'rgba(249,115,22,.15)'},
  ECONOMICS:   {c:'#10B981',i:'📊',  bg:'rgba(16,185,129,.15)'},
  FINANCE:     {c:'#06B6D4',i:'💹',  bg:'rgba(6,182,212,.15)'},
  TECHNOLOGY:  {c:'#8B5CF6',i:'💻',  bg:'rgba(139,92,246,.15)'},
  ENERGY:      {c:'#F59E0B',i:'⚡',  bg:'rgba(245,158,11,.15)'},
  HUMANITARIAN:{c:'#F97316',i:'🚨',  bg:'rgba(249,115,22,.15)'},
  POLITICS:    {c:'#6366F1',i:'🏛',  bg:'rgba(99,102,241,.15)'},
  GEOPOLITICS: {c:'#3B82F6',i:'🌐',  bg:'rgba(59,130,246,.15)'},
  HEALTH:      {c:'#EC4899',i:'🏥',  bg:'rgba(236,72,153,.15)'}
};

var LEVELS = [
  {level:1, name:'Observer',       min_xp:0,    color:'#94A3B8'},
  {level:2, name:'Analyst',        min_xp:100,  color:'#60A5FA'},
  {level:3, name:'Strategist',     min_xp:300,  color:'#34D399'},
  {level:4, name:'Senior Analyst', min_xp:600,  color:'#FBBF24'},
  {level:5, name:'Fund Manager',   min_xp:1000, color:'#F97316'},
  {level:6, name:'Director',       min_xp:1600, color:'#A78BFA'},
  {level:7, name:'CIO',            min_xp:2500, color:'#EC4899'},
  {level:8, name:'Oracle',         min_xp:4000, color:'#F87171'}
];

// ── HTTP helper ───────────────────────────────────────

// ── Activity tracker ─────────────────────────────────
// Call track(action, detail) from any user interaction.
// Fire-and-forget — never blocks the UI.
function track(action, section, detail) {
  if (!G.token) return;
  var payload = {
    action:  action  || '',
    section: section || G.currentView || '',
    detail:  detail  ? (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''
  };
  // Non-blocking: don't await, ignore errors
  var headers = {'Content-Type':'application/json','Authorization':'Bearer '+G.token};
  fetch('/api/track', {method:'POST', headers:headers, body:JSON.stringify(payload)})
    .catch(function(){});
}


/* ═══════════ 02_core.js ═══════════ */
/**
 * @file 02_core.js
 * @module WorldLens/Core Utilities & Boot
 *
 * @description
 * HTTP helper rq(), DOM utilities el()/setEl(), toast/format helpers.
 * DOMContentLoaded boot sequence, auth forms, enterApp() init,
 * data polling, WebSocket connection.
 *
 * @dependencies 01_globals.js
 * @exports rq, el, setEl, toast, tAgo, fmtP, rmLoader, showAuth, closeAuth, enterApp, loadData
 */


function rq(url, opts) {
  opts = opts || {};
  var headers = {'Content-Type': 'application/json'};
  if (G.token) headers['Authorization'] = 'Bearer ' + G.token;
  return new Promise(function(resolve) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var tid = setTimeout(function() {
      if (ctrl) ctrl.abort();
      resolve({ _timeout: true, detail: 'Request timeout' });
    }, 25000);  // 25s — covers Render cold start (~15-20s)
    fetch(url, {
      method:  opts.method || 'GET',
      headers: headers,
      body:    opts.body ? JSON.stringify(opts.body) : undefined,
      signal:  ctrl ? ctrl.signal : undefined
    }).then(function(r) {
      clearTimeout(tid);
      if (r.status === 401) {
        G.token = null;
        localStorage.removeItem('wl_tok');
        resolve({ _status: 401, detail: 'Unauthorized' });
        return;
      }
      var status = r.status;
      return r.json().then(function(data) {
        if (!data || typeof data !== 'object') data = {};
        data._status = status;
        return data;
      }).catch(function() {
        return { _status: status, _parseError: true, detail: 'Invalid response (HTTP ' + status + ')' };
      });
    }).then(function(data) {
      resolve(data || {});
    }).catch(function(e) {
      clearTimeout(tid);
      console.error('[rq] network error:', url, e);
      resolve({ _network: true, detail: 'Network error: ' + (e && e.message || 'unknown') });
    });
  });
}

// ── UTILS ─────────────────────────────────────────────
function el(id)        { return document.getElementById(id); }
function setEl(id, v)  { var e = document.getElementById(id); if (e) e.textContent = v; }
function tAgo(d) {
  var s = (Date.now() - d.getTime()) / 1000;
  if (s < 60)    return Math.floor(s)            + 's ago';
  if (s < 3600)  return Math.floor(s / 60)       + 'm ago';
  if (s < 86400) return Math.floor(s / 3600)     + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function fmtP(sym, p) {
  if (!p && p !== 0) return '—';
  if (['BTC-USD','ETH-USD'].indexOf(sym) > -1) return '$' + Math.round(p).toLocaleString('en');
  if (p > 10000) return p.toLocaleString('en', {maximumFractionDigits: 0});
  if (p > 100)   return p.toLocaleString('en', {maximumFractionDigits: 1});
  return p.toLocaleString('en', {maximumFractionDigits: 4});
}
function sentBarColor(s) {
  if (s >  0.5) return '#10B981';
  if (s >  0.1) return '#34D399';
  if (s < -0.5) return '#EF4444';
  if (s < -0.1) return '#F87171';
  return '#94A3B8';
}
function toast(msg, type, dur) {
  var t = document.getElementById('toasts');
  if (!t) return;
  var d = document.createElement('div');
  d.className = 'toast' + (type ? ' toast-' + type : '');
  d.textContent = msg;
  t.appendChild(d);
  setTimeout(function() { d.classList.add('out'); setTimeout(function() { if (d.parentNode) d.remove(); }, 400); }, dur || 3000);
}

// ── BOOT ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', function() {
  animCanvas();
  var safetyTimer = setTimeout(function() {
    rmLoader();
    console.warn('WorldLens: safety loader timeout');
  }, 6000);

  var tok = localStorage.getItem('wl_tok');
  if (tok) {
    G.token = tok;
    rq('/api/auth/me').then(function(u) {
      clearTimeout(safetyTimer);
      if (u && u.id) {
        G.user = u;
        enterApp();
      } else {
        G.token = null;
        localStorage.removeItem('wl_tok');
        rmLoader();
      }
    }).catch(function() {
      clearTimeout(safetyTimer);
      G.token = null;
      localStorage.removeItem('wl_tok');
      rmLoader();
    });
  } else {
    clearTimeout(safetyTimer);
    setTimeout(rmLoader, 400);
  }
});

function rmLoader() {
  var l = document.getElementById('loader');
  if (l) { l.classList.add('out'); setTimeout(function(){ if(l.parentNode) l.remove(); }, 500); }
}

// ── CANVAS ANIMATION ─────────────────────────────────
function animCanvas() {
  var c = document.getElementById('lcanvas');
  if (!c) return;
  var x = c.getContext('2d');
  var D = [];
  function rsz() { c.width = window.innerWidth; c.height = window.innerHeight; }
  rsz();
  window.addEventListener('resize', rsz);
  for (var i = 0; i < 50; i++) {
    D.push({x:Math.random()*window.innerWidth, y:Math.random()*window.innerHeight,
            vx:(Math.random()-.5)*.3, vy:(Math.random()-.5)*.3,
            r:Math.random()*2+.8, p:Math.random()*Math.PI*2});
  }
  (function draw() {
    x.clearRect(0,0,c.width,c.height);
    D.forEach(function(d) {
      d.x+=d.vx; d.y+=d.vy; d.p+=.018;
      if(d.x<0||d.x>c.width) d.vx*=-1;
      if(d.y<0||d.y>c.height) d.vy*=-1;
      x.beginPath(); x.arc(d.x,d.y,d.r,0,Math.PI*2);
      x.fillStyle = 'rgba(59,130,246,'+(0.28+Math.sin(d.p)*.18)+')';
      x.fill();
    });
    D.forEach(function(a,i) {
      D.slice(i+1).forEach(function(b) {
        var d = Math.hypot(a.x-b.x, a.y-b.y);
        if (d < 115) {
          x.beginPath(); x.moveTo(a.x,a.y); x.lineTo(b.x,b.y);
          x.strokeStyle = 'rgba(59,130,246,'+(0.1*(1-d/115))+')';
          x.lineWidth=.5; x.stroke();
        }
      });
    });
    requestAnimationFrame(draw);
  })();
}

// ── AUTH ──────────────────────────────────────────────
function showAuth(t) { document.getElementById('aov').classList.add('on'); atab(t); }
function closeAuth() { document.getElementById('aov').classList.remove('on'); }
function atab(t) {
  el('lif').style.display = t==='login'?'block':'none';
  el('rgf').style.display = t==='register'?'block':'none';
  el('tli').classList.toggle('on', t==='login');
  el('trg').classList.toggle('on', t==='register');
  if (t === 'register' && typeof checkRegMode === 'function') checkRegMode();
}
function doLogin() {
  var e = el('le').value, p = el('lp').value;
  el('ler').textContent = '';
  if (!e||!p) { el('ler').textContent = 'Fill all fields'; return; }

  var btn = document.querySelector('#lif button[type=submit], #lif .btn');
  if (btn) { btn._origText = btn.textContent; btn.textContent = '…'; btn.disabled = true; }

  rq('/api/auth/login',{method:'POST',body:{email:e,password:p}}).then(function(r) {
    if (btn) { btn.textContent = btn._origText || 'Sign in'; btn.disabled = false; }

    // Detect timeout / network failure (rq returns {} on those)
    if (!r || (Object.keys(r).length === 0)) {
      el('ler').textContent = 'Network error or timeout — check connection';
      return;
    }
    if (r.detail) { el('ler').textContent = r.detail; return; }
    if (!r.access_token) {
      el('ler').textContent = r.error || r.message || 'Login failed — invalid response';
      console.error('Login: missing access_token in response', r);
      return;
    }

    G.token = r.access_token; G.user = r.user;
    localStorage.setItem('wl_tok', r.access_token);
    track('login', 'auth', r.user && r.user.email || '');
    closeAuth(); enterApp();
  });
}
function doReg() {
  var n    = (el('rn') && el('rn').value || '').trim();
  var e    = (el('re') && el('re').value || '').trim();
  var p    = (el('rp') && el('rp').value || '').trim();
  var code = (el('ric') && el('ric').value || '').trim();
  el('rer').textContent = '';
  if (!n||!e||!p) { el('rer').textContent = 'Please fill all fields'; return; }
  if (p.length < 8) { el('rer').textContent = 'Password must be at least 8 characters'; return; }

  var btn = document.querySelector('#rgf button[type=submit], #rgf .btn');
  if (btn) { btn._origText = btn.textContent; btn.textContent = '…'; btn.disabled = true; }

  var body = { username: n, email: e, password: p };
  if (code) body.invite_code = code;
  rq('/api/auth/register', { method:'POST', body: body }).then(function(r) {
    if (btn) { btn.textContent = btn._origText || 'Sign up'; btn.disabled = false; }

    if (!r || Object.keys(r).length === 0) {
      el('rer').textContent = 'Network error or timeout';
      return;
    }
    if (r.detail) {
      el('rer').textContent = r.detail;
      return;
    }
    if (!r.access_token) {
      el('rer').textContent = r.error || r.message || 'Registration failed';
      console.error('Register: missing access_token', r);
      return;
    }
    G.token = r.access_token;
    G.user  = r.user;
    G.isNewUser = true;
    localStorage.setItem('wl_tok', r.access_token);
    track('register', 'auth', r.user && r.user.email || '');
    closeAuth();
    enterApp();
  });
}

// Check whether invite code field should be shown
function checkRegMode() {
  rq('/api/auth/registration-status').then(function(r) {
    var invField = document.getElementById('invite-field');
    if (!invField) return;
    invField.style.display = (r && r.registration_open === false) ? 'block' : 'none';
  }).catch(function() {});
}
function logout() {
  G.token=null; G.user=null; localStorage.removeItem('wl_tok');
  if(G.ws) G.ws.close();
  el('shell').classList.remove('on');
  el('landing').classList.remove('hidden');
  toast('Signed out','i');
}

// ── ENTER APP ─────────────────────────────────────────
function enterApp() {
  rmLoader();
  el('landing').classList.add('hidden');
  el('shell').classList.add('on');
  var u = G.user;
  var ini = u.username.slice(0,2).toUpperCase();
  ['uav','pav'].forEach(function(id) {
    var e2 = document.getElementById(id);
    if (e2) { e2.textContent = ini; e2.style.background = u.avatar_color||'#3B82F6'; }
  });
  var h = new Date().getHours();
  var greetWord = h<12?'Good morning':h<18?'Good afternoon':'Good evening';
  setEl('un', u.username);
  setEl('pname', u.username);
  setEl('pemail', u.email);
  setEl('psince', 'Member since '+(u.created_at?u.created_at.slice(0,10):'—'));
  setEl('dgreet', greetWord+', '+u.username.split(' ')[0]);

  // Inject admin button immediately (G.user already has is_admin from login/me)
  adminBtnInject();

  // Load data then render
  Promise.all([loadEvs(), loadFin(), loadUD(), loadMacro()]).then(function() {
    initCats();
    connectWS();
    renderDash();
    renderFeed();
    if (typeof initAgentDash  === 'function') initAgentDash();
    if (typeof initDashGlobe  === 'function') setTimeout(initDashGlobe, 400);
    if (typeof loadSavedIds    === 'function') loadSavedIds();
    if (typeof refreshAffinity === 'function') refreshAffinity();
    if (typeof loadBrainStats  === 'function') setTimeout(loadBrainStats, 2000);
    renderMkts();
    renderMacro();
    renderAlerts();
    renderProfile();
    loadMacroBrief();
    requestAnimationFrame(function() { requestAnimationFrame(initMap); });
    // Post-login: personalization, onboarding, engagement
    rq('/api/user/profile').then(function(prof) {
      if (prof && !prof.detail) {
        G.userProfile = prof;
        ['interests','regions','market_prefs'].forEach(function(f) {
          if (typeof prof[f] === 'string') {
            try { G.userProfile[f] = JSON.parse(prof[f]); } catch(e) { G.userProfile[f] = []; }
          }
        });
      }
      applyPersonalization();
      renderDash();
      if (G.userProfile && G.userProfile.tutorial_done) {
        var hb = document.getElementById('help-btn');
        if (hb) hb.style.display = 'flex';
      }
      // Check localStorage first — guards against server lag / failed API on prev session
      var _localDone = false;
      try { _localDone = localStorage.getItem('wl_onboarding_done') === '1'; } catch(e) {}
      var _serverDone = G.userProfile && !!G.userProfile.onboarding_done;

      if (!_localDone && !_serverDone && (G.isNewUser || G.userProfile)) {
        setTimeout(startOnboarding, 700);
      } else if (_localDone && G.userProfile && !G.userProfile.onboarding_done) {
        // Sync localStorage state to server silently (handles previous failures)
        rq('/api/user/profile', { method: 'PUT', body: { onboarding_done: 1 } })
          .catch(function() {});
      }
      G.isNewUser = false;
      // Load engagement
      loadDailyInsight();
      loadLayout();
    });
  });
}

// ── DATA ──────────────────────────────────────────────
function loadEvs() {
  return rq('/api/events?limit=800&hours=120').then(function(r) {
    if (r && r.events) G.events = r.events;
  });
}
function loadFin() {
  return rq('/api/finance').then(function(r) {
    if (r && r.assets) G.finance = r.assets;
  });
}
function loadUD() {
  return Promise.all([
    rq('/api/user/watchlist'),
    rq('/api/user/alerts'),
    rq('/api/events/stats/summary')
  ]).then(function(rs) {
    if (rs[0]&&!rs[0].detail) G.watchlist = rs[0];
    if (rs[1]&&!rs[1].detail) G.alerts = rs[1];
    if (rs[2]&&!rs[2].detail) G.stats = rs[2];
    var alct = G.alerts.filter(function(a){return a.active;}).length;
    var badge = el('al-badge');
    if (badge) { badge.style.display = alct>0?'inline':'none'; badge.textContent = alct; }
  });
}
function loadMacro() {
  return rq('/api/events/macro/indicators').then(function(r) {
    if (r && Array.isArray(r)) G.macro = r;
  });
}
function loadRegionRisks() {
  el('region-risk-table').innerHTML = '<div style="color:var(--t3);font-size:11px;padding:10px 0">Loading...</div>';
  rq('/api/events/heatmap').then(function(r) {
    if (!r||!r.length) { el('region-risk-table').innerHTML='<div style="color:var(--t3);font-size:11px">No data</div>'; return; }
    el('region-risk-table').innerHTML = r.slice(0,15).map(function(d) {
      var sev = d.avg_severity||5;
      var pct = Math.min(100, sev*10);
      var col = sev>=7?'var(--re)':sev>=4?'var(--am)':'var(--gr)';
      return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--bd)">'
        +'<div style="font-size:11px;flex:1;font-weight:500">'+(d.country_name||d.country_code)+'</div>'
        +'<div style="flex:2;height:4px;background:var(--bg3);border-radius:2px;overflow:hidden"><div style="height:100%;width:'+pct+'%;background:'+col+';border-radius:2px;transition:width .8s"></div></div>'
        +'<div style="font-size:11px;font-weight:600;color:'+col+';min-width:28px;text-align:right">'+sev.toFixed(1)+'</div>'
        +'</div>';
    }).join('');
  });
}

// ── WEBSOCKET ─────────────────────────────────────────
function connectWS() {
  var proto = location.protocol==='https:'?'wss:':'ws:';
  G.ws = new WebSocket(proto+'//'+location.host+'/ws');
  G.ws.onopen = function() { el('wsd').classList.add('on'); setEl('wst','Live'); };
  G.ws.onclose = function() { el('wsd').classList.remove('on'); setEl('wst','Reconnecting'); setTimeout(connectWS,5000); };
  G.ws.onmessage = function(e) {
    try {
      var m = JSON.parse(e.data);
      if (m.type==='events_updated') { loadEvs().then(function(){ renderFeed(); renderDash(); if(G.mapReady) updateMarkers(); }); }
      if (m.type==='finance_updated') { G.finance=m.data; renderMkts(); updateDashFin(); }
      if (m.type==='tg_pnl' && typeof tgOnWsPnl === 'function') { tgOnWsPnl(m.data); }
    } catch(ex) {}
  };
  setInterval(function(){ if(G.ws&&G.ws.readyState===1) G.ws.send('ping'); }, 25000);
}

// ── MAP ───────────────────────────────────────────────

/* ═══════════ 30_theme.js ═══════════ */
/**
 * 30_theme.js — Dark/Light theme toggle for WorldLens v20
 *
 * - Reads saved preference from localStorage
 * - Defaults to 'dark'
 * - Injects a toggle button into the nav bar
 * - Applies data-theme attribute on <html>
 * - Emits 'wl:themechange' event for listeners
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'wl-theme';
  var DEFAULT_THEME = 'dark';

  function getTheme() {
    try {
      var t = localStorage.getItem(STORAGE_KEY);
      return (t === 'light' || t === 'dark') ? t : DEFAULT_THEME;
    } catch (e) {
      return DEFAULT_THEME;
    }
  }

  function setTheme(theme) {
    if (theme !== 'light' && theme !== 'dark') theme = DEFAULT_THEME;
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch (e) { /* ignore */ }
    updateToggleUI(theme);
    try {
      window.dispatchEvent(new CustomEvent('wl:themechange', { detail: { theme: theme } }));
    } catch (e) { /* old browsers */ }
  }

  function updateToggleUI(theme) {
    document.querySelectorAll('.fire-theme-toggle-opt').forEach(function (el) {
      el.classList.toggle('active', el.dataset.theme === theme);
    });
  }

  function buildToggle() {
    // Prevent duplicate injection
    if (document.getElementById('fire-theme-toggle')) return;

    var wrap = document.createElement('div');
    wrap.id = 'fire-theme-toggle';
    wrap.className = 'fire-theme-toggle';
    wrap.innerHTML =
      '<button class="fire-theme-toggle-opt dark" data-theme="dark" title="Dark theme">' +
        '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<path d="M13 9.2A5 5 0 0 1 6.8 3a5 5 0 1 0 6.2 6.2Z"/>' +
        '</svg>' +
        'DARK' +
      '</button>' +
      '<button class="fire-theme-toggle-opt light" data-theme="light" title="Light theme">' +
        '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">' +
          '<circle cx="8" cy="8" r="3"/>' +
          '<path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/>' +
        '</svg>' +
        'LIGHT' +
      '</button>';

    wrap.addEventListener('click', function (e) {
      var btn = e.target.closest('.fire-theme-toggle-opt');
      if (btn && btn.dataset.theme) setTheme(btn.dataset.theme);
    });

    // Insert before the Sign Out button in the nav
    var nav = document.querySelector('nav#nav');
    if (!nav) return;
    var signOut = nav.querySelector('button[onclick*="logout"]');
    if (signOut && signOut.parentNode) {
      signOut.parentNode.insertBefore(wrap, signOut);
    } else {
      // Fallback: append to nav
      nav.appendChild(wrap);
    }
  }

  // Apply theme immediately (before DOMContentLoaded to avoid FOUC)
  setTheme(getTheme());

  function init() {
    buildToggle();
    updateToggleUI(getTheme());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.wlTheme = { get: getTheme, set: setTheme };
})();

/* ═══════════ 20_nav_ux.js ═══════════ */
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
  tradgentic:     'intelligence',
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
  tradgentic:      { label: 'Tradgentic Lab',       icon: '🤖', group: 'Intelligence' },
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

/* ═══════════ 33_mobile_ux.js ═══════════ */
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

/* ═══════════ 27_onboarding.js ═══════════ */
/**
 * 27_onboarding.js — Sprint A: Guided onboarding for non-experts
 *
 * A1 — Profile quiz (2 questions → recommended bot)
 * A2 — Bot Template Library (gallery with pre-computed backtest)
 * A3 — Tooltip glossary (plain-language metric explanations)
 * A4 — Live commentary on bot cards
 */
(function () {
'use strict';

/* ══════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════ */
var OB = {
  templates:    [],
  glossary:     {},
  quiz:         { goal: null, risk: null },
  recommended:  null,
  tooltipEl:    null,
};

var RISK_PARAMS = {
  conservative: { stop_pct_override: 1.5, max_assets: 2, label: 'Conservative',  color: '#10b981' },
  moderate:     { stop_pct_override: 3.0, max_assets: 4, label: 'Moderate',       color: '#3b82f6' },
  aggressive:   { stop_pct_override: 5.0, max_assets: 8, label: 'Aggressive',     color: '#f59e0b' },
};

var GRADE_META = {
  'S': { color: '#f59e0b', bg: 'rgba(245,158,11,.12)', label: 'Elite' },
  'A': { color: '#10b981', bg: 'rgba(16,185,129,.12)', label: 'Strong' },
  'B': { color: '#3b82f6', bg: 'rgba(59,130,246,.12)', label: 'Good' },
  'C': { color: '#94a3b8', bg: 'rgba(148,163,184,.08)', label: 'Average' },
  'D': { color: '#f97316', bg: 'rgba(249,115,22,.1)',  label: 'Weak' },
  'F': { color: '#ef4444', bg: 'rgba(239,68,68,.12)', label: 'Poor' },
};

/* ══════════════════════════════════════════════════════════════
   A1 — PROFILE QUIZ
   ══════════════════════════════════════════════════════════════ */

/** Called from tgOpenWizard override — shows quiz before step 1 */
window.tgOpenWizardGuided = function () {
  OB.quiz = { goal: null, risk: null };
  var overlay = document.getElementById('tg-wizard');
  if (overlay) overlay.style.display = 'flex';
  _showQuiz();
};

function _showQuiz() {
  var title   = document.getElementById('tg-wiz-title');
  var content = document.getElementById('tg-wiz-content');
  var steps   = document.getElementById('tg-steps');
  var nav     = document.querySelector('.tg-wizard-nav');
  if (!content) return;

  if (title)  title.textContent = '👋 Let\'s find your ideal bot';
  if (steps)  steps.style.display = 'none';
  if (nav)    nav.style.display   = 'none';

  content.innerHTML = [
    '<div class="quiz-wrap">',
    '  <div class="quiz-intro">Answer 2 quick questions and we\'ll configure the perfect bot for you.</div>',

    /* Q1 — Goal */
    '  <div class="quiz-question">',
    '    <div class="quiz-q-label">1. What\'s your main goal?</div>',
    '    <div class="quiz-options" id="quiz-goals">',
    _quizOption('goal', 'protect',   '🛡️', 'Protect my savings',    'Avoid big losses above all'),
    _quizOption('goal', 'grow_tech', '🚀', 'Grow with tech stocks', 'Higher returns, OK with ups and downs'),
    _quizOption('goal', 'diversify', '🌍', 'Diversify globally',    'Spread across stocks, gold, bonds, crypto'),
    _quizOption('goal', 'learn',     '📚', 'Learn how it works',    'Understand trading through practice'),
    '    </div>',
    '  </div>',

    /* Q2 — Risk */
    '  <div class="quiz-question" id="quiz-q2" style="opacity:.35;pointer-events:none">',
    '    <div class="quiz-q-label">2. How much risk can you handle?</div>',
    '    <div class="quiz-options" id="quiz-risks">',
    _quizOption('risk', 'conservative', '🐢', 'Conservative', 'Small swings. Max -10% before I panic.'),
    _quizOption('risk', 'moderate',     '⚖️', 'Moderate',     'Normal swings. I\'d hold through -20%.'),
    _quizOption('risk', 'aggressive',   '🦁', 'Aggressive',   'Big swings OK. I\'m in it long-term.'),
    '    </div>',
    '  </div>',

    /* CTA */
    '  <div id="quiz-cta" style="display:none;margin-top:20px;text-align:center">',
    '    <button class="quiz-cta-btn" onclick="obRunQuiz()">See My Recommended Bot →</button>',
    '    <div style="margin-top:10px">',
    '      <button class="quiz-skip-btn" onclick="obSkipQuiz()">Skip — I\'ll configure manually</button>',
    '    </div>',
    '  </div>',

    '  <div style="text-align:center;margin-top:8px">',
    '    <button class="quiz-skip-btn" onclick="obSkipQuiz()" id="quiz-skip-top">Skip quiz →</button>',
    '  </div>',
    '</div>',
  ].join('');
}

function _quizOption(group, value, icon, label, sub) {
  return '<div class="quiz-option" id="qo-' + value + '" onclick="obSelectQuiz(\'' + group + '\',\'' + value + '\')">'
    + '<div class="quiz-opt-icon">' + icon + '</div>'
    + '<div><div class="quiz-opt-label">' + label + '</div>'
    + '<div class="quiz-opt-sub">' + sub + '</div></div>'
    + '</div>';
}

window.obSelectQuiz = function (group, value) {
  document.querySelectorAll('#quiz-' + group + 's .quiz-option').forEach(function (el) {
    el.classList.remove('selected');
  });
  var el = document.getElementById('qo-' + value);
  if (el) el.classList.add('selected');
  OB.quiz[group] = value;

  if (group === 'goal') {
    var q2 = document.getElementById('quiz-q2');
    if (q2) { q2.style.opacity = '1'; q2.style.pointerEvents = 'auto'; }
  }
  if (OB.quiz.goal && OB.quiz.risk) {
    var cta = document.getElementById('quiz-cta');
    if (cta) cta.style.display = 'block';
  }
};

window.obRunQuiz = function () {
  if (!OB.quiz.goal || !OB.quiz.risk) return;
  var content = document.getElementById('tg-wiz-content');
  if (content) content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3)"><div class="btl-spinner" style="margin:0 auto 12px"></div>Finding your bot…</div>';

  rq('/api/tradgentic/profile-quiz', {
    method: 'POST',
    body: { goal: OB.quiz.goal, risk: OB.quiz.risk },
  }).then(function (r) {
    if (!r || r.error) { obSkipQuiz(); return; }
    OB.recommended  = r.recommended_template;
    OB.templates    = r.all_templates || [];
    _showRecommendation(r.template, r.recommended_template);
  }).catch(function () { obSkipQuiz(); });
};

function _showRecommendation(template, templateId) {
  var title   = document.getElementById('tg-wiz-title');
  var content = document.getElementById('tg-wiz-content');
  var nav     = document.querySelector('.tg-wizard-nav');
  if (title)  title.textContent = '✅ Your recommended bot';
  if (nav)    nav.style.display = 'none';

  if (!template) { obSkipQuiz(); return; }
  var bt  = template.backtest || {};
  var gm  = GRADE_META[bt.grade] || GRADE_META['C'];
  var rp  = RISK_PARAMS[OB.quiz.risk] || RISK_PARAMS.moderate;

  content.innerHTML = [
    '<div class="ob-rec-wrap">',

    /* Hero card */
    '<div class="ob-rec-hero" style="border-color:' + template.color + '33;background:' + template.color + '08">',
    '  <div class="ob-rec-icon" style="background:' + template.color + '15;color:' + template.color + '">' + template.icon + '</div>',
    '  <div class="ob-rec-body">',
    '    <div class="ob-rec-name">' + template.name + '</div>',
    '    <div class="ob-rec-tagline">' + template.tagline + '</div>',
    '    <div class="ob-rec-for">"' + template.for_who + '"</div>',
    '  </div>',
    '  <div class="ob-rec-grade" style="background:' + gm.bg + ';color:' + gm.color + '">',
    '    <div class="ob-grade-letter">' + bt.grade + '</div>',
    '    <div class="ob-grade-label">' + gm.label + '</div>',
    '  </div>',
    '</div>',

    /* Backtest preview */
    '<div class="ob-rec-metrics">',
    _obMetric('Ann. Return',  (bt.ann_return_pct >= 0 ? '+' : '') + bt.ann_return_pct + '%', bt.ann_return_pct >= 0 ? '#10b981' : '#ef4444'),
    _obMetric('Sharpe',       bt.sharpe, bt.sharpe > 1 ? '#10b981' : '#f59e0b'),
    _obMetric('Max Drawdown', '-' + bt.max_drawdown_pct + '%', '#f97316'),
    _obMetric('Win Rate',     bt.win_rate_pct + '%',  bt.win_rate_pct > 55 ? '#10b981' : '#f59e0b'),
    '</div>',

    /* What it does */
    '<div class="ob-rec-does">',
    '  <div class="ob-rec-does-title">How this bot works:</div>',
    (template.what_it_does || []).map(function (item) {
      return '<div class="ob-rec-does-item">✓ ' + item + '</div>';
    }).join(''),
    '</div>',

    /* Good/bad */
    '<div class="ob-rec-conditions">',
    '  <div class="ob-cond good"><span class="ob-cond-icon">✅</span><div><b>Works well when:</b> ' + template.good_when + '</div></div>',
    '  <div class="ob-cond bad"><span class="ob-cond-icon">⚠️</span><div><b>Struggles when:</b> ' + template.bad_when + '</div></div>',
    '</div>',

    /* Risk profile applied */
    '<div class="ob-risk-note" style="border-color:' + rp.color + '30">',
    '  <span style="color:' + rp.color + ';font-weight:700">' + rp.label + ' profile applied</span>',
    '  — stop loss adjusted to ' + rp.stop_pct_override + '%, max ' + rp.max_assets + ' assets',
    '</div>',

    /* CTAs */
    '<div class="ob-rec-actions">',
    '  <button class="ob-deploy-btn" onclick="obDeployTemplate(\'' + templateId + '\')"',
    '    style="background:' + template.color + ';color:#fff">',
    '    🚀 Deploy this bot',
    '  </button>',
    '  <button class="ob-see-all-btn" onclick="obShowAllTemplates()">',
    '    Browse all templates',
    '  </button>',
    '</div>',
    '</div>',
  ].join('');
}

function _obMetric(label, value, color) {
  return '<div class="ob-metric"><div class="ob-metric-val" style="color:' + color + '">' + value + '</div>'
    + '<div class="ob-metric-label">' + label + '</div></div>';
}

window.obSkipQuiz = function () {
  var steps = document.getElementById('tg-steps');
  var nav   = document.querySelector('.tg-wizard-nav');
  if (steps) steps.style.display = '';
  if (nav)   nav.style.display   = '';
  // Reset to standard wizard step 1
  if (typeof _wizRender === 'function') {
    if (typeof TG !== 'undefined') TG.wiz = { step: 1, strategy: null, assets: [], params: {}, name: '' };
    _wizRender();
  }
};

/* ══════════════════════════════════════════════════════════════
   A2 — TEMPLATE LIBRARY
   ══════════════════════════════════════════════════════════════ */

window.obShowAllTemplates = function () {
  var title   = document.getElementById('tg-wiz-title');
  var content = document.getElementById('tg-wiz-content');
  var nav     = document.querySelector('.tg-wizard-nav');
  if (title) title.textContent = '📚 Bot Template Library';
  if (nav)   nav.style.display = 'none';

  var _render = function (templates) {
    content.innerHTML = [
      '<div class="ob-lib-intro">Pre-built bots with real 2-year backtests. One click to deploy.</div>',
      '<div class="ob-template-grid">',
      templates.map(function (t) {
        var bt = t.backtest || {};
        var gm = GRADE_META[bt.grade] || GRADE_META['C'];
        var rc = { low: '#10b981', medium: '#3b82f6', high: '#f59e0b' }[t.risk_level] || '#94a3b8';
        return '<div class="ob-tpl-card" onclick="obShowTemplateDetail(\'' + t.id + '\')"'
          + ' style="--tpl-color:' + t.color + '">'
          + '<div class="ob-tpl-header">'
          + '  <div class="ob-tpl-icon">' + t.icon + '</div>'
          + '  <div class="ob-tpl-grade" style="background:' + gm.bg + ';color:' + gm.color + '">' + bt.grade + '</div>'
          + '</div>'
          + '<div class="ob-tpl-name">' + t.name + '</div>'
          + '<div class="ob-tpl-tagline">' + t.tagline + '</div>'
          + '<div class="ob-tpl-metrics">'
          + '  <span style="color:' + (bt.ann_return_pct >= 0 ? '#10b981' : '#ef4444') + '">'
          + (bt.ann_return_pct >= 0 ? '+' : '') + bt.ann_return_pct + '% /yr</span>'
          + '  <span style="color:var(--t3)">DD -' + bt.max_drawdown_pct + '%</span>'
          + '</div>'
          + '<div class="ob-tpl-risk" style="color:' + rc + ';background:' + rc + '12">'
          + t.risk_label + '</div>'
          + '</div>';
      }).join(''),
      '</div>',
      '<div style="text-align:center;margin-top:16px">',
      '  <button class="quiz-skip-btn" onclick="obSkipQuiz()">Configure manually instead</button>',
      '</div>',
    ].join('');
  };

  if (OB.templates.length) {
    _render(OB.templates);
  } else {
    content.innerHTML = '<div style="text-align:center;padding:32px;color:var(--t3)"><div class="btl-spinner" style="margin:0 auto 12px"></div></div>';
    rq('/api/tradgentic/templates').then(function (r) {
      OB.templates = (r && r.templates) || [];
      _render(OB.templates);
    });
  }
};

window.obShowTemplateDetail = function (templateId) {
  var template = OB.templates.find(function (t) { return t.id === templateId; })
               || null;
  if (template) {
    _showRecommendation(template, templateId);
  } else {
    rq('/api/tradgentic/templates/' + templateId).then(function (r) {
      if (r && !r.error) { OB.templates.push(r); _showRecommendation(r, templateId); }
    });
  }
};

window.obDeployTemplate = function (templateId) {
  var btn = document.querySelector('.ob-deploy-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Deploying…'; }

  rq('/api/tradgentic/templates/' + templateId + '/deploy', {
    method: 'POST', body: {},
  }).then(function (r) {
    if (r && r.bot) {
      if (typeof tgCloseWizard === 'function') tgCloseWizard();
      if (typeof toast === 'function') toast('🚀 Bot deployed from template!', 's', 3000);
      if (typeof tgLoadBots === 'function') tgLoadBots();
      _awardAchievement('first_bot');
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Deploy this bot'; }
      if (typeof toast === 'function') toast((r && r.error) || 'Deploy failed', 'e', 2500);
    }
  });
};

/* ══════════════════════════════════════════════════════════════
   A3 — TOOLTIP GLOSSARY
   ══════════════════════════════════════════════════════════════ */

/** Inject a help icon next to a metric. Usage: obHelpIcon('sharpe') */
window.obHelpIcon = function (term) {
  return '<span class="ob-help-icon" onclick="obShowGlossary(\'' + term + '\')" title="What is this?">?</span>';
};

window.obShowGlossary = function (term) {
  var _render = function (entry) {
    if (!entry) return;
    _removeTooltip();
    var el = document.createElement('div');
    el.className = 'ob-tooltip';
    el.id        = 'ob-tooltip';
    el.innerHTML = [
      '<div class="ob-tt-header">',
      '  <div class="ob-tt-term">' + entry.term + '</div>',
      '  <button class="ob-tt-close" onclick="obCloseTooltip()">✕</button>',
      '</div>',
      '<div class="ob-tt-plain">' + entry.plain + '</div>',
      entry.scale && entry.scale.length ? [
        '<div class="ob-tt-scale">',
        entry.scale.map(function (s) {
          return '<div class="ob-tt-row">'
            + '<span class="ob-tt-range" style="color:' + s.color + '">' + s.range + '</span>'
            + '<span class="ob-tt-label">' + s.label + '</span>'
            + '</div>';
        }).join(''),
        '</div>',
      ].join('') : '',
      '</div>',
    ].join('');
    document.body.appendChild(el);
    OB.tooltipEl = el;
    // Position in viewport centre on mobile
    setTimeout(function () { el.classList.add('ob-tooltip-visible'); }, 10);
  };

  var cached = OB.glossary[term];
  if (cached) { _render(cached); return; }

  rq('/api/tradgentic/glossary/' + term).then(function (r) {
    if (r && !r.error) {
      OB.glossary[term] = r;
      _render(r);
    }
  });
};

window.obCloseTooltip = function () { _removeTooltip(); };

function _removeTooltip() {
  var el = document.getElementById('ob-tooltip');
  if (el) el.remove();
  OB.tooltipEl = null;
}

document.addEventListener('click', function (e) {
  if (OB.tooltipEl && !OB.tooltipEl.contains(e.target) && !e.target.classList.contains('ob-help-icon')) {
    _removeTooltip();
  }
});

/* ══════════════════════════════════════════════════════════════
   A4 — LIVE COMMENTARY on bot cards
   ══════════════════════════════════════════════════════════════ */

/**
 * Generates plain-language commentary for a bot card.
 * Called from _renderBotsGrid after cards are rendered.
 */
window.obInjectCommentary = function (botId, signals, stats) {
  var card = document.getElementById('tg-card-comment-' + botId);
  if (!card) return;

  var txt = _generateCommentary(signals, stats);
  card.innerHTML = '<div class="ob-commentary"><span class="ob-bot-think">🤖</span>' + txt + '</div>';
};

function _generateCommentary(signals, stats) {
  if (!signals || !Object.keys(signals).length) {
    return 'Waiting for market data to generate signals…';
  }
  var entries = Object.entries(signals);
  var buys    = entries.filter(function (e) { return e[1].action === 'BUY'; });
  var sells   = entries.filter(function (e) { return e[1].action === 'SELL'; });
  var holds   = entries.filter(function (e) { return e[1].action === 'HOLD'; });

  var parts = [];

  if (buys.length) {
    var sym  = buys[0][0];
    var sig  = buys[0][1];
    var conf = Math.round((sig.strength || 0.5) * 100);
    var txt  = sig.reason || 'signal detected';
    parts.push('<b style="color:#10b981">▲ BUY signal on ' + sym + '</b> (' + conf + '% confidence) — ' + txt);
    if (sig.stop_loss)    parts.push('Stop loss set at $' + sig.stop_loss);
    if (sig.take_profit)  parts.push('Target: $' + sig.take_profit);
  }
  if (sells.length) {
    var sym2 = sells[0][0];
    var sig2 = sells[0][1];
    var txt2 = sig2.reason || 'exit signal';
    parts.push('<b style="color:#ef4444">▼ SELL signal on ' + sym2 + '</b> — ' + txt2);
  }
  if (holds.length && !buys.length && !sells.length) {
    parts.push('All positions in HOLD — no extreme signals detected. Bot is waiting for better entry.');
  }
  if (stats) {
    var eq  = stats.equity || 0;
    var ret = stats.total_return || 0;
    var col = ret >= 0 ? '#10b981' : '#ef4444';
    parts.push('Portfolio: $' + Math.round(eq).toLocaleString() + ' (<span style="color:' + col + '">' + (ret >= 0 ? '+' : '') + ret.toFixed(1) + '%</span>)');
  }
  return parts.join(' &middot; ') || 'Monitoring markets — no signals yet.';
}

/* Patch _renderBotsGrid to inject commentary placeholder */
var _origRenderBotsGrid = window._renderBotsGridOrig = null;
(function () {
  var checkInterval = setInterval(function () {
    if (typeof window.tgLoadBots === 'function' && typeof window._renderBotsGrid === 'undefined') {
      clearInterval(checkInterval);
      // Add commentary div after each bot card renders via monkey-patch on tgOpenDetail
    }
  }, 500);
})();

/* ══════════════════════════════════════════════════════════════
   GAMIFICATION — achievements
   ══════════════════════════════════════════════════════════════ */

var _awardedThisSession = {};

function _awardAchievement(key) {
  if (_awardedThisSession[key]) return;
  _awardedThisSession[key] = true;

  var ACHIEVEMENTS = {
    first_bot: { title: '🤖 First Bot', desc: 'Deployed your first trading bot', xp: 150 },
    first_backtest: { title: '⚗️ Backtester', desc: 'Ran your first backtest', xp: 100 },
    first_feature: { title: '🔬 Feature Analyst', desc: 'Used the Feature Engineering Lab', xp: 120 },
    quiz_complete: { title: '🎯 Guided Start', desc: 'Completed the profile quiz', xp: 50 },
  };

  var ach = ACHIEVEMENTS[key];
  if (!ach) return;

  // Show toast
  if (typeof toast === 'function') {
    toast('🏆 Achievement: ' + ach.title + ' (+' + ach.xp + ' XP)', 's', 4000);
  }
  // Track via engage API
  rq('/api/track', { method: 'POST', body: { action: 'tg_achievement', detail: key } })
    .catch(function () {});
}

// Expose for other modules
window.obAwardAchievement = _awardAchievement;

/* ══════════════════════════════════════════════════════════════
   INIT — patch tgOpenWizard to show quiz first
   ══════════════════════════════════════════════════════════════ */

(function patchWizard() {
  var _check = setInterval(function () {
    if (typeof window.tgOpenWizard === 'function') {
      clearInterval(_check);
      var _orig = window.tgOpenWizard;
      window.tgOpenWizard = function () {
        // Show template library if user has no bots yet, quiz otherwise
        var bots = (typeof TG !== 'undefined' && TG.bots) ? TG.bots : [];
        if (bots.length === 0) {
          // First time: show quiz
          tgOpenWizardGuided();
          _awardAchievement('quiz_complete');
        } else {
          // Has bots: show template library or standard wizard
          var overlay = document.getElementById('tg-wizard');
          if (overlay) overlay.style.display = 'flex';
          obShowAllTemplates();
        }
      };
    }
  }, 200);
})();

/* Patch btlRun to award backtest achievement */
(function patchBacktest() {
  var _check = setInterval(function () {
    if (typeof window.btlRun === 'function') {
      clearInterval(_check);
      var _orig = window.btlRun;
      window.btlRun = function () {
        _orig();
        _awardAchievement('first_backtest');
      };
    }
  }, 500);
})();

/* Patch feAnalyse to award feature achievement */
(function patchFeature() {
  var _check = setInterval(function () {
    if (typeof window.feAnalyse === 'function') {
      clearInterval(_check);
      var _orig = window.feAnalyse;
      window.feAnalyse = function () {
        _orig();
        _awardAchievement('first_feature');
      };
    }
  }, 500);
})();

})();

/* ═══════════ 10_stubs.js ═══════════ */
/**
 * @file 10_stubs.js  — WorldLens UI Handlers
 */

// ── Alert management ──────────────────────────────────────────

function renderAlerts() {
  var list = document.getElementById('allist');
  var profList = document.getElementById('profalerts');
  rq('/api/user/alerts').then(function(r) {
    if (!r || !r.alerts) return;
    G.alerts = r.alerts;
    var badge = document.getElementById('al-badge');
    if (badge) badge.textContent = r.alerts.filter(function(a){ return a.active; }).length || '';
    var html = r.alerts.length ? r.alerts.map(function(a) {
      var col = a.active ? 'var(--gr)' : 'var(--t4)';
      return '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg2);border-radius:8px;border:1px solid var(--bd)">'
        + '<div style="flex:1"><div style="font-size:11px;font-weight:600;color:var(--t1)">' + (a.title||'Alert') + '</div>'
        + '<div style="font-size:9px;color:var(--t3)">' + (a.condition||'') + '</div></div>'
        + '<div style="width:8px;height:8px;border-radius:50%;background:'+col+'"></div>'
        + '<button onclick="deleteAlert('+a.id+')" style="background:none;border:none;cursor:pointer;font-size:14px;color:var(--t4);padding:0 2px" title="Delete">x</button>'
        + '</div>';
    }).join('') : '<div style="font-size:11px;color:var(--t3);text-align:center;padding:16px">No alerts yet</div>';
    if (list)     list.innerHTML     = html;
    if (profList) profList.innerHTML = html;
    var psAl = document.getElementById('ps-al');
    if (psAl) psAl.textContent = r.alerts.length;
  });
}

function addAlert() {
  var name = (document.getElementById('aln') || {}).value || '';
  var cond = (document.getElementById('alc') || {}).value || '';
  if (!name || !cond) { toast('Fill alert name and condition', 'e'); return; }
  track('alert_created', 'alerts', name.slice(0,60));
  rq('/api/user/alerts', { method:'POST', body:{ title:name, condition:cond, type:'event' } }).then(function(r) {
    if (r && !r.detail) {
      var aln = document.getElementById('aln'); if (aln) aln.value = '';
      var alc = document.getElementById('alc'); if (alc) alc.value = '';
      renderAlerts();
      toast('Alert created', 's');
    } else {
      toast(r && r.detail ? r.detail : 'Failed', 'e');
    }
  });
}

function quickAlert() {
  var name = (document.getElementById('q-aln') || {}).value || '';
  if (!name) { toast('Enter alert name', 'e'); return; }
  track('alert_created', 'alerts', 'quick:' + name.slice(0,40));
  rq('/api/user/alerts', { method:'POST', body:{ title:name, condition:name, type:'event' } }).then(function(r) {
    if (r && !r.detail) {
      var inp = document.getElementById('q-aln'); if (inp) inp.value = '';
      renderAlerts();
      toast('Alert created', 's');
    }
  });
}

function deleteAlert(id) {
  track('alert_deleted', 'alerts', String(id));
  rq('/api/user/alerts/' + id, { method:'DELETE' }).then(function() { renderAlerts(); });
}

// ── Watchlist UI ───────────────────────────────────────────────

function addWL() {
  track('watchlist_add', 'watchlist', '');
  var val  = (document.getElementById('wlval')  || {}).value || '';
  var type = (document.getElementById('wltype') || {}).value || 'keyword';
  if (!val) { toast('Enter a value to watch', 'e'); return; }
  rq('/api/user/watchlist', { method:'POST', body:{ type:type, value:val, label:val } }).then(function(r) {
    if (r && !r.detail) {
      var inp = document.getElementById('wlval'); if (inp) inp.value = '';
      rq('/api/user/watchlist').then(function(wr) {
        if (wr && wr.items) G.watchlist = wr.items;
        renderProfile();
      });
      toast('Added to watchlist', 's');
    }
  });
}

function removeWL(id) {
  track('watchlist_remove', 'watchlist', String(id));
  rq('/api/user/watchlist/' + id, { method:'DELETE' }).then(function() {
    rq('/api/user/watchlist').then(function(r) {
      if (r && r.items) G.watchlist = r.items;
      renderProfile();
    });
  });
}

// ── Profile UI ────────────────────────────────────────────────

function renderProfile() {
  var p = G.userProfile || {};
  var u = G.user || {};
  var s = function(id, v) { var e = document.getElementById(id); if (e) e.textContent = v || ''; };
  s('pname',  u.username || '');
  s('pemail', u.email    || '');
  var pav = document.getElementById('pav');
  if (pav) { pav.textContent = (u.username||'U').slice(0,2).toUpperCase(); pav.style.background = u.avatar_color || '#3B82F6'; }
  var psWl = document.getElementById('ps-wl'); if (psWl) psWl.textContent = G.watchlist.length;
  var psAl = document.getElementById('ps-al'); if (psAl) psAl.textContent = G.alerts.length;
  var since = document.getElementById('psince'); if (since) since.textContent = 'Member since ' + ((u.created_at||'').slice(0,10)||'—');
  var wlEl = document.getElementById('profwl');
  if (wlEl) {
    var filter = (document.getElementById('wl-filter') || {}).value || 'all';
    var items  = G.watchlist.filter(function(i) { return filter === 'all' || i.type === filter; });
    wlEl.innerHTML = items.length ? items.map(function(i) {
      return '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--bd)">'
        + '<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--bg3);color:var(--t3)">' + (i.type||'') + '</span>'
        + '<span style="flex:1;font-size:11px;color:var(--t1)">' + (i.label||i.value||'') + '</span>'
        + '<button onclick="removeWL('+i.id+')" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--t4)">x</button>'
        + '</div>';
    }).join('') : '<div style="font-size:11px;color:var(--t3);padding:8px 0">Nothing in watchlist</div>';
  }
  renderAlerts();
  // Load affinity profile (Sprint 2)
  if (typeof renderAffinityProfile === 'function') renderAffinityProfile();
}

function toggleEdit() {
  var card = document.getElementById('profile-edit-card');
  if (!card) { toast('Edit profile coming soon', 'i'); return; }
  card.style.display = card.style.display === 'none' ? 'block' : 'none';
}

function saveProfile() {
  var u   = document.getElementById('edit-username');
  var bio = document.getElementById('edit-bio');
  var body = {};
  if (u   && u.value)   body.username = u.value.trim();
  if (bio && bio.value) body.bio      = bio.value.trim();
  if (!Object.keys(body).length) return;
  rq('/api/user/profile', { method:'PUT', body:body }).then(function(r) {
    if (r && !r.detail) {
      if (body.username) G.user.username = body.username;
      renderProfile();
      toggleEdit();
      toast('Profile saved', 's');
    }
  });
}

// ── Macro view ─────────────────────────────────────────────────

function setMacroTab(tab, btn) {
  G.macroTab = tab;
  document.querySelectorAll('.macro-tab').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  renderMacro();
}

function renderMacro() {
  var grid = document.getElementById('macro-grid');
  if (!grid) return;
  grid.innerHTML = '<div style="color:var(--t3);font-size:12px;text-align:center;padding:32px;grid-column:1/-1">Loading...</div>';
  rq('/api/macro/indicators').then(function(data) {
    if (!data || !data.indicators || !data.indicators.length) {
      grid.innerHTML = '<div style="color:var(--t3);font-size:11px;text-align:center;padding:24px;grid-column:1/-1">No macro data</div>';
      return;
    }
    var tab = G.macroTab || 'all';
    var inds = tab === 'all' ? data.indicators : data.indicators.filter(function(i){ return i.category === tab; });
    grid.innerHTML = inds.map(function(ind) {
      var delta = ind.value - ind.previous;
      var dir   = delta > 0 ? '+' : '';
      var col   = delta > 0 ? 'var(--gr)' : delta < 0 ? 'var(--re)' : 'var(--t3)';
      return '<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:14px 16px">'
        + '<div style="font-size:9px;color:var(--t3);margin-bottom:4px">' + (ind.country||'Global') + ' · ' + (ind.category||'') + '</div>'
        + '<div style="font-size:11px;color:var(--t2);margin-bottom:8px">' + ind.name + '</div>'
        + '<div style="display:flex;align-items:baseline;gap:6px">'
        + '<span style="font-size:22px;font-weight:800;color:var(--t1)">' + (ind.value||0).toFixed(2) + '</span>'
        + '<span style="font-size:10px;color:var(--t3)">' + (ind.unit||'') + '</span>'
        + '</div>'
        + '<div style="font-size:10px;color:' + col + ';margin-top:4px">' + dir + delta.toFixed(2) + ' vs prev</div>'
        + '</div>';
    }).join('');
  });
}

function getMacroBrief() {
  // Fire dashboard element
  var fireTxt = document.getElementById('d-brief-txt');
  var timeEl  = document.getElementById('db-brief-time');
  // Legacy element
  var box = document.getElementById('macro-brief');
  var legacyTxt = document.getElementById('macro-brief-txt');

  var loadingHTML = '<span style="opacity:.5">Generating intelligence briefing…</span>';

  if (fireTxt) fireTxt.innerHTML = loadingHTML;
  if (legacyTxt) { legacyTxt.innerHTML = loadingHTML; if (box) box.style.display = 'block'; }

  rq('/api/intelligence/macro-brief').then(function(r) {
    var text = (r && (r.brief || r.content)) || '';
    if (!text || text.length < 10) {
      text = 'Global intelligence monitoring active. Configure an AI provider in Admin → Settings for full analysis.';
    }

    // Populate fire dashboard quote
    if (fireTxt) {
      if (typeof renderExtendedBrief === 'function') {
        renderExtendedBrief(text);
      } else {
        fireTxt.textContent = text;
      }
    }
    if (timeEl) timeEl.textContent = new Date().toTimeString().slice(0, 5) + ' UTC';

    // Populate legacy element
    if (legacyTxt) legacyTxt.textContent = text;
  });
  track('macro_brief_requested', 'macro', '');
}

function loadMacroBrief() { getMacroBrief(); }

// ── Onboarding ─────────────────────────────────────────────────

var OB = { step:0, data:{} };
var OB_STEPS = [
  {
    title: 'Benvenuto in WorldLens',
    sub: 'Intelligence geopolitica in tempo reale',
    body: [
      '<div style="text-align:center;padding:8px 0 4px">',
      '<div style="font-size:48px;margin-bottom:12px">🌍</div>',
      '<p style="color:var(--t2);font-size:15px;line-height:1.7;text-align:left">',
      'WorldLens monitora <strong style="color:var(--t1)">migliaia di fonti globali</strong> e ti mostra ',
      'eventi geopolitici live, mercati finanziari e analisi AI in un\'unica dashboard.',
      '</p>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:16px">',
      '<div style="padding:12px;background:rgba(255,193,7,0.06);border-radius:10px;border:1px solid rgba(255,193,7,0.15)">',
      '<div style="font-size:20px;margin-bottom:4px">⚡</div>',
      '<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:2px">Crisi live</div>',
      '<div style="font-size:11px;color:var(--t3)">Aggiornato ogni 90 secondi</div>',
      '</div>',
      '<div style="padding:12px;background:rgba(255,193,7,0.06);border-radius:10px;border:1px solid rgba(255,193,7,0.15)">',
      '<div style="font-size:20px;margin-bottom:4px">🤖</div>',
      '<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:2px">AI Analyst</div>',
      '<div style="font-size:11px;color:var(--t3)">Chiedile qualsiasi cosa</div>',
      '</div>',
      '<div style="padding:12px;background:rgba(255,193,7,0.06);border-radius:10px;border:1px solid rgba(255,193,7,0.15)">',
      '<div style="font-size:20px;margin-bottom:4px">📡</div>',
      '<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:2px">Early Warning</div>',
      '<div style="font-size:11px;color:var(--t3)">Segnali prima che diventino news</div>',
      '</div>',
      '<div style="padding:12px;background:rgba(255,193,7,0.06);border-radius:10px;border:1px solid rgba(255,193,7,0.15)">',
      '<div style="font-size:20px;margin-bottom:4px">📈</div>',
      '<div style="font-size:12px;font-weight:600;color:var(--t1);margin-bottom:2px">Mercati</div>',
      '<div style="font-size:11px;color:var(--t3)">100+ asset monitorati</div>',
      '</div>',
      '</div></div>',
    ].join('')
  },
  {
    title: 'Le tue aree di interesse',
    sub: 'Personalizza la tua dashboard',
    body: '<p style="font-size:14px;color:var(--t3);margin-bottom:12px">Seleziona i temi che vuoi monitorare — puoi cambiare in qualsiasi momento.</p><div id="ob-interests"></div>'
  },
  {
    title: 'Le tue regioni',
    sub: 'Dove guardi nel mondo?',
    body: '<p style="font-size:14px;color:var(--t3);margin-bottom:12px">Scegli le aree geografiche da tenere sotto controllo.</p><div id="ob-regions"></div>'
  },
  {
    title: 'Come navigare',
    sub: 'Quattro tap, tutta l\'intelligence',
    body: [
      '<div style="display:flex;flex-direction:column;gap:10px;margin-top:4px">',
      '<div style="display:flex;align-items:center;gap:14px;padding:12px;background:rgba(255,255,255,0.04);border-radius:10px">',
      '<span style="font-size:22px;width:32px;text-align:center">🏠</span>',
      '<div><div style="font-size:14px;font-weight:600;color:var(--t1)">Home</div><div style="font-size:12px;color:var(--t3)">Dashboard con rischio globale, mercati e crisi attive</div></div>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:14px;padding:12px;background:rgba(255,255,255,0.04);border-radius:10px">',
      '<span style="font-size:22px;width:32px;text-align:center">🗺️</span>',
      '<div><div style="font-size:14px;font-weight:600;color:var(--t1)">Mappa</div><div style="font-size:12px;color:var(--t3)">Tutti gli eventi geopolitici in tempo reale sulla mappa globale</div></div>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:14px;padding:12px;background:rgba(255,255,255,0.04);border-radius:10px">',
      '<span style="font-size:22px;width:32px;text-align:center">⚡</span>',
      '<div><div style="font-size:14px;font-weight:600;color:var(--t1)">Crisi</div><div style="font-size:12px;color:var(--t3)">Feed eventi ordinati per rilevanza e severità</div></div>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:14px;padding:12px;background:rgba(255,255,255,0.04);border-radius:10px">',
      '<span style="font-size:22px;width:32px;text-align:center">🤖</span>',
      '<div><div style="font-size:14px;font-weight:600;color:var(--t1)">AI</div><div style="font-size:12px;color:var(--t3)">Chiedi all\'AI Analyst qualsiasi cosa sugli eventi correnti</div></div>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:14px;padding:12px;background:rgba(255,193,7,0.08);border-radius:10px;border:1px solid rgba(255,193,7,0.2)">',
      '<span style="font-size:22px;width:32px;text-align:center">☰</span>',
      '<div><div style="font-size:14px;font-weight:600;color:var(--t1)">Menù</div><div style="font-size:12px;color:var(--t3)">Early Warning, Mercati, Agenti AI e altro ancora</div></div>',
      '</div>',
      '</div>',
    ].join('')
  },
  {
    title: 'Attiva l\'AI',
    sub: 'Un solo passaggio per sbloccare tutto',
    body: [
      '<div style="text-align:center;padding:8px 0">',
      '<div style="font-size:40px;margin-bottom:12px">🔑</div>',
      '<p style="font-size:15px;color:var(--t2);line-height:1.65;text-align:left">',
      'Per sbloccare le analisi AI (briefing, Early Warning, valutazione crisi) serve una chiave API Gemini — completamente <strong style="color:var(--t1)">gratuita</strong>.',
      '</p>',
      '<div style="margin:16px 0;padding:14px;background:rgba(255,193,7,0.08);border-radius:12px;border:1px solid rgba(255,193,7,0.2)">',
      '<div style="font-family:monospace;font-size:11px;color:rgba(255,193,7,0.8);margin-bottom:6px;letter-spacing:0.1em">COME OTTENERLA (2 minuti)</div>',
      '<ol style="font-size:13px;color:var(--t2);line-height:1.8;padding-left:18px;margin:0">',
      '<li>Vai su <strong style="color:var(--t1)">aistudio.google.com/app/apikey</strong></li>',
      '<li>Clicca "Create API key"</li>',
      '<li>Copia la chiave</li>',
      '<li>Incollala in <strong style="color:var(--t1)">Menù → Admin → Settings → AI Provider</strong></li>',
      '</ol>',
      '</div>',
      '<p style="font-size:13px;color:var(--t3);line-height:1.5;text-align:left">',
      'Puoi farlo dopo. La dashboard funziona anche senza AI, ma le analisi saranno limitate.',
      '</p>',
      '</div>',
    ].join('')
  },
  {
    title: 'Tutto pronto!',
    sub: 'La tua intelligence platform è attiva',
    body: [
      '<div style="text-align:center;padding:8px 0">',
      '<div style="font-size:48px;margin-bottom:16px">🚀</div>',
      '<p style="font-size:15px;color:var(--t2);line-height:1.65;text-align:left">',
      'Il tuo profilo è configurato. Mentre esplori, il sistema raccoglie dati in tempo reale da migliaia di fonti globali.',
      '</p>',
      '<div style="margin-top:16px;padding:14px;background:rgba(102,187,106,0.08);border-radius:12px;border:1px solid rgba(102,187,106,0.2)">',
      '<div style="font-size:13px;color:rgba(102,187,106,0.9);font-weight:600;margin-bottom:8px">💡 Da dove iniziare</div>',
      '<ul style="font-size:13px;color:var(--t2);line-height:1.8;padding-left:18px;margin:0">',
      '<li>Apri la <strong>Mappa</strong> per vedere gli eventi correnti</li>',
      '<li>Controlla l\'<strong>Early Warning</strong> per i segnali di crisi</li>',
      '<li>Chiedi all\'<strong>AI Analyst</strong> un briefing sul rischio oggi</li>',
      '</ul>',
      '</div>',
      '</div>',
    ].join('')
  },
];

function startOnboarding() {
  var ov = document.getElementById('ob-overlay');
  if (!ov) return;
  // Guard: if already marked done in this session, never show again
  try { if (localStorage.getItem('wl_onboarding_done') === '1') return; } catch(e) {}
  if (window.G && G.userProfile && G.userProfile.onboarding_done) return;
  OB.step = 0; OB.data = {};
  ov.style.display = '';        // clear any inline style
  ov.classList.remove('ob-hidden');
  ov.classList.add('ob-visible');
  _obRender();
}
function _obRender() {
  var step = OB_STEPS[OB.step] || OB_STEPS[0];
  var s    = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
  s('ob-step-lbl', 'Step ' + (OB.step+1) + ' of ' + OB_STEPS.length);
  s('ob-title', step.title);
  s('ob-sub',   step.sub);
  var body = document.getElementById('ob-body'); if (body) body.innerHTML = step.body;
  var dots = document.getElementById('ob-dots');
  if (dots) dots.innerHTML = OB_STEPS.map(function(_,i){
    return '<span style="width:7px;height:7px;border-radius:50%;background:' + (i===OB.step?'var(--b5)':'var(--bg3)') + ';display:inline-block"></span>';
  }).join('');
  var back = document.getElementById('ob-back'); if (back) { back.style.display = OB.step>0?'inline-flex':'none'; back.style.visibility = 'visible'; }
  var next = document.getElementById('ob-next'); if (next) next.textContent = OB.step===OB_STEPS.length-1?'Inizia! →':'Avanti →';
  if (OB.step===1) _obInterestPicker();
  if (OB.step===2) _obRegionPicker();
  if (OB.step===3) _obRiskPicker();
}
function _obInterestPicker() {
  var el2 = document.getElementById('ob-interests'); if (!el2) return;
  var opts = ['Economics','Finance','Geopolitics','Conflict','Energy','Technology','Humanitarian','Politics'];
  el2.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:8px">'
    + opts.map(function(v){
        var sel = (OB.data.interests||[]).indexOf(v)>-1;
        return '<span onclick="obToggleInterest(\''+v+'\',this)" style="padding:5px 12px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid '+(sel?'var(--b5)':'var(--bd)')+';background:'+(sel?'rgba(59,130,246,.15)':'var(--bg2)')+';color:'+(sel?'var(--b4)':'var(--t2)')+'">'+v+'</span>';
      }).join('') + '</div>';
}
function obToggleInterest(v,el2) {
  if (!OB.data.interests) OB.data.interests=[];
  var i=OB.data.interests.indexOf(v);
  if (i>-1) { OB.data.interests.splice(i,1); el2.style.borderColor='var(--bd)'; el2.style.background='var(--bg2)'; el2.style.color='var(--t2)'; }
  else { OB.data.interests.push(v); el2.style.borderColor='var(--b5)'; el2.style.background='rgba(59,130,246,.15)'; el2.style.color='var(--b4)'; }
}
function _obRegionPicker() {
  var el2 = document.getElementById('ob-regions'); if (!el2) return;
  var opts = ['Europe','USA','Middle East','Asia','Africa','Latin America','Global'];
  el2.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:8px">'
    + opts.map(function(v){
        var sel=(OB.data.regions||[]).indexOf(v)>-1;
        return '<span onclick="obToggleRegion(\''+v+'\',this)" style="padding:5px 12px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid '+(sel?'var(--b5)':'var(--bd)')+';background:'+(sel?'rgba(59,130,246,.15)':'var(--bg2)')+';color:'+(sel?'var(--b4)':'var(--t2)')+'">'+v+'</span>';
      }).join('') + '</div>';
}
function obToggleRegion(v,el2) {
  if (!OB.data.regions) OB.data.regions=[];
  var i=OB.data.regions.indexOf(v);
  if (i>-1) { OB.data.regions.splice(i,1); el2.style.borderColor='var(--bd)'; el2.style.background='var(--bg2)'; el2.style.color='var(--t2)'; }
  else { OB.data.regions.push(v); el2.style.borderColor='var(--b5)'; el2.style.background='rgba(59,130,246,.15)'; el2.style.color='var(--b4)'; }
}
function _obRiskPicker() {
  var el2 = document.getElementById('ob-risk'); if (!el2) return;
  var opts = ['Conservative','Moderate','Aggressive','Speculative'];
  el2.innerHTML = '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:8px">'
    + opts.map(function(v){
        var sel=OB.data.risk===v;
        return '<span onclick="obSetRisk(\''+v+'\',this)" style="padding:5px 14px;border-radius:20px;font-size:11px;cursor:pointer;border:1px solid '+(sel?'var(--b5)':'var(--bd)')+';background:'+(sel?'rgba(59,130,246,.15)':'var(--bg2)')+';color:'+(sel?'var(--b4)':'var(--t2)')+'">'+v+'</span>';
      }).join('') + '</div>';
}
function obSetRisk(v,el2) {
  OB.data.risk=v;
  document.querySelectorAll('#ob-risk span').forEach(function(s){
    var a=s.textContent===v;
    s.style.borderColor=a?'var(--b5)':'var(--bd)'; s.style.background=a?'rgba(59,130,246,.15)':'var(--bg2)'; s.style.color=a?'var(--b4)':'var(--t2)';
  });
}
function obNext() { if (OB.step < OB_STEPS.length-1) { OB.step++; _obRender(); } else { _obFinish(); } }
function obBack() { if (OB.step>0) { OB.step--; _obRender(); } }
function skipOnboarding() {
  // Save to localStorage immediately so reload doesn't re-trigger popup
  try { localStorage.setItem('wl_onboarding_done', '1'); } catch(e) {}
  if (window.G) {
    if (!G.userProfile) G.userProfile = {};
    G.userProfile.onboarding_done = 1;
  }
  var ov = document.getElementById('ob-overlay');
  if (ov) {
    ov.classList.remove('ob-visible');
    ov.classList.add('ob-hidden');
    ov.style.display = 'none';   // belt-and-suspenders
  }
  rq('/api/user/profile', { method: 'PUT', body: { onboarding_done: 1 } })
    .catch(function() {});
}
function _obFinish() {
  // 1. Save to localStorage FIRST — survives page reload regardless of server
  try { localStorage.setItem('wl_onboarding_done', '1'); } catch(e) {}

  // 2. Mark in memory immediately
  if (window.G) {
    if (!G.userProfile) G.userProfile = {};
    G.userProfile.onboarding_done = 1;
    G.userProfile.interests = OB.data.interests || [];
    G.userProfile.regions   = OB.data.regions   || [];
  }

  // 3. Close overlay permanently
  var ov = document.getElementById('ob-overlay');
  if (ov) {
    ov.classList.remove('ob-visible');
    ov.classList.add('ob-hidden');
    ov.style.display = 'none';   // belt-and-suspenders
    ov.style.opacity = '';
  }

  // 4. Persist to server in background
  var payload = {
    interests:        OB.data.interests || [],
    regions:          OB.data.regions   || [],
    market_prefs:     OB.data.interests || [],
    experience_level: (OB.data.risk === 'Speculative' || OB.data.risk === 'Aggressive') ? 'advanced' : 'beginner',
  };
  rq('/api/user/complete-onboarding', { method: 'POST', body: payload })
    .catch(function() {
      rq('/api/user/profile', { method: 'PUT', body: { onboarding_done: 1 } })
        .catch(function() {});
    });
}

// Tutorial
var TUT = { step:0 };
var TUT_STEPS = [
  { title:'Map View',       msg:'Click the globe icon to see live events on the interactive map.' },
  { title:'Event Details',  msg:'Click any event pin to see details, AI analysis, and market impact.' },
  { title:'AI Analyst',     msg:'Use the AI Analyst to ask anything about current events and markets.' },
  { title:'Knowledge Graph',msg:'The Graph tab shows how events connect. Try Build Graph.' },
  { title:'Markets',        msg:'Track 100+ assets, run backtests, and see which events move prices.' },
  { title:'Watchlist',      msg:'Add countries, companies, or keywords to your watchlist.' },
];
function startTutorial() {
  var ov=document.getElementById('tut-overlay'); if (!ov) return;
  TUT.step=0; ov.style.display='flex'; _tutRender();
}
function _tutRender() {
  var step=TUT_STEPS[TUT.step]||TUT_STEPS[0];
  var tit=document.getElementById('tut-title'); if (tit) tit.textContent=step.title;
  var msg=document.getElementById('tut-msg');   if (msg) msg.textContent=step.msg;
  var lbl=document.getElementById('tut-step');  if (lbl) lbl.textContent=(TUT.step+1)+' / '+TUT_STEPS.length;
}
function tutNext() {
  if (TUT.step<TUT_STEPS.length-1) { TUT.step++; _tutRender(); }
  else { skipTutorial(); rq('/api/user/profile',{method:'PUT',body:{tutorial_done:1}}); }
}
function tutBack() { if (TUT.step>0) { TUT.step--; _tutRender(); } }
function skipTutorial() { var ov=document.getElementById('tut-overlay'); if (ov) ov.style.display='none'; }

// ── Portfolio helpers ──────────────────────────────────────────

function selectRisk(val, btn) {
  G.portState = G.portState||{};
  G.portState.risk = val;
  document.querySelectorAll('.risk-btn,.port-risk-btn').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  var desc=document.getElementById('port-risk-desc');
  var descs={'Conservative':'Capital preservation. Low volatility.','Moderate':'Balanced growth and protection.','Aggressive':'Maximum growth. Higher risk.','Speculative':'High risk / high reward.'};
  if (desc) desc.textContent=descs[val]||'';
}
function selHorizon(val, btn) {
  G.portState=G.portState||{}; G.portState.horizon=val;
  document.querySelectorAll('.horizon-btn').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
}
function togFocus(val, btn) {
  G.portState=G.portState||{}; G.portState.focuses=G.portState.focuses||[];
  var i=G.portState.focuses.indexOf(val);
  if (i>-1) { G.portState.focuses.splice(i,1); if(btn) btn.classList.remove('on'); }
  else { G.portState.focuses.push(val); if(btn) btn.classList.add('on'); }
}
function setLayout(val, btn) {
  document.querySelectorAll('.layout-btn').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  rq('/api/engage/layout',{method:'POST',body:{layout:val}});
}
function generatePortfolio() { if (typeof portBuild==='function') portBuild(); }
function loadPortfolios()     { if (typeof initPortfolioTab==='function') initPortfolioTab(); }

// ── Gamification ───────────────────────────────────────────────

function loadGamification() {
  rq('/api/user/profile').then(function(r) {
    if (!r||r.detail) return;
    var xp=r.xp||r.experience_points||0;
    var lvl=LEVELS.filter(function(l){ return xp>=l.min_xp; }).pop()||LEVELS[0];
    var nextLvl=LEVELS.find(function(l){ return l.min_xp>xp; });
    var progress=nextLvl?Math.round((xp-lvl.min_xp)/(nextLvl.min_xp-lvl.min_xp)*100):100;
    var s=function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
    s('gam-level-name', lvl.name);
    s('gam-xp-val',     xp+' XP');
    s('gam-xp-next',    nextLvl?nextLvl.min_xp-xp+' XP to '+nextLvl.name:'Max level!');
    var bar=document.getElementById('gam-xp-bar'); if (bar) bar.style.width=progress+'%';
    var badge=document.getElementById('gam-level-badge'); if(badge){badge.textContent=lvl.name;badge.style.color=lvl.color;}
  });
}
function xpPop(amount, msg) {
  var pop=document.createElement('div');
  pop.style.cssText='position:fixed;top:70px;right:24px;z-index:9999;background:rgba(59,130,246,.9);color:#fff;border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;pointer-events:none';
  pop.textContent='+'+amount+' XP'+(msg?' · '+msg:'');
  document.body.appendChild(pop);
  setTimeout(function(){ pop.remove(); },2000);
}
function loadMissions() {
  rq('/api/engage/missions/today').then(function(r) {
    var el2=document.getElementById('gam-missions'); if(!el2||!r||!r.missions) return;
    el2.innerHTML=r.missions.map(function(m){
      return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--bd)">'
        +'<div style="width:20px;height:20px;border-radius:50%;border:2px solid '+(m.completed?'var(--gr)':'var(--bd)')+';background:'+(m.completed?'var(--gr)':'none')+';display:flex;align-items:center;justify-content:center;flex-shrink:0">'+(m.completed?'<span style="color:#fff;font-size:10px">v</span>':'')+'</div>'
        +'<div style="flex:1"><div style="font-size:11px;color:var(--t1)">'+m.title+'</div><div style="font-size:9px;color:var(--t3)">+'+(m.xp_reward||10)+' XP</div></div></div>';
    }).join('');
  });
}
function loadPredictions() {
  rq('/api/engage/predictions').then(function(r) {
    var el2=document.getElementById('gam-predictions'); if(!el2||!r||!r.predictions) return;
    if (!r.predictions.length) { el2.innerHTML='<div style="font-size:11px;color:var(--t3);text-align:center;padding:16px">No predictions yet.</div>'; return; }
    el2.innerHTML=r.predictions.slice(0,5).map(function(p){
      var col=p.outcome==='correct'?'var(--gr)':p.outcome==='incorrect'?'var(--re)':'var(--t3)';
      return '<div style="padding:7px 0;border-bottom:1px solid var(--bd)"><div style="font-size:10px;color:var(--t2)">'+(p.event_title||'').slice(0,60)+'</div><div style="font-size:9px;color:'+col+'">'+( p.direction||'')+' - '+(p.outcome||'pending')+'</div></div>';
    }).join('');
  });
}
function makePrediction(direction) {
  var ev=G.panelEv; if (!ev) { toast('Open an event first','e'); return; }
  rq('/api/engage/predictions',{method:'POST',body:{event_id:ev.id,event_title:ev.title,direction:direction}}).then(function(r){
    if (r&&!r.detail) { toast('Prediction recorded! +5 XP','s'); loadPredictions(); }
  });
  track('prediction_made','gamification',direction+'|'+ev.id);
}
function loadWeeklyReport() {
  rq('/api/engage/weekly-report').then(function(r){
    var el2=document.getElementById('gam-weekly'); if(!el2||!r) return;
    el2.innerHTML='<div style="font-size:11px;color:var(--t2);line-height:1.7">'+(r.summary||r.report||'Weekly report not available yet.')+'</div>';
  });
}

// ── AI Chat (Sprint 0 — thumbs up/down + tracking) ────────────

function aiSend(prompt) {
  var inp     = el('ai-inp') || el('aiinp');
  var msgText = (prompt || (inp ? inp.value.trim() : ''));
  if (!msgText) return;
  if (inp) inp.value = '';
  var chatEl = el('ai-chat') || el('ai-messages') || el('aimsgs');
  if (chatEl) {
    chatEl.innerHTML += '<div style="text-align:right;margin:6px 0"><span style="background:var(--b6);color:#fff;border-radius:var(--r8);padding:5px 10px;font-size:11px;display:inline-block;max-width:80%">' + msgText + '</span></div>';
    chatEl.innerHTML += '<div id="ai-loading" style="margin:6px 0;font-size:11px;color:var(--t3)">Thinking...</div>';
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  var context = G.panelEv
    ? 'Current event: ' + G.panelEv.title + ' (' + G.panelEv.country_name + ', ' + G.panelEv.category + ')'
    : 'Global intelligence platform';
  track('ai_question', 'ai', msgText.slice(0,100));
  rq('/api/intelligence/answer', { method:'POST', body:{ question:msgText, context:context } })
    .then(function(r) {
      var loading = el('ai-loading'); if (loading) loading.remove();
      var answer  = (r && (r.answer || r.response)) || (r && r.answer) ? r.answer : 'No response — verify Gemini key in Admin → Settings.';
      if (chatEl) {
        var fbDiv  = document.createElement('div'); fbDiv.style.cssText='margin:6px 0';
        var bubble = document.createElement('span');
        bubble.style.cssText='background:var(--bg3);border:1px solid var(--bdb);border-radius:var(--r8);padding:5px 10px;font-size:11px;display:inline-block;max-width:90%;line-height:1.6';
        bubble.textContent = answer;
        var fbRow  = document.createElement('div'); fbRow.style.cssText='margin-top:4px;display:flex;gap:6px;align-items:center';
        fbRow.innerHTML = '<span style="font-size:9px;color:var(--t4)">Useful?</span>';
        var _q=msgText, _a=answer, _c=context;
        var btnUp=document.createElement('button');
        btnUp.textContent='+1'; btnUp.title='Helpful';
        btnUp.style.cssText='background:rgba(16,185,129,.1);border:1px solid var(--gr);border-radius:6px;padding:2px 10px;cursor:pointer;font-size:10px;color:var(--gr);font-weight:700';
        btnUp.onclick=function(){ _aiFeedback(fbRow,1,_q,_a,_c); };
        var btnDn=document.createElement('button');
        btnDn.textContent='-1'; btnDn.title='Not helpful';
        btnDn.style.cssText='background:rgba(239,68,68,.1);border:1px solid var(--re);border-radius:6px;padding:2px 10px;cursor:pointer;font-size:10px;color:var(--re);font-weight:700';
        btnDn.onclick=function(){ _aiFeedback(fbRow,-1,_q,_a,_c); };
        fbRow.appendChild(btnUp); fbRow.appendChild(btnDn);
        fbDiv.appendChild(bubble); fbDiv.appendChild(fbRow);
        chatEl.appendChild(fbDiv); chatEl.scrollTop=chatEl.scrollHeight;
      }
    });
}
function _aiFeedback(container, rating, question, answer, context) {
  if (container) container.innerHTML='<span style="font-size:9px;color:var(--t3)">'+(rating===1?'Helpful - thanks':'Not helpful - noted')+'</span>';
  rq('/api/ai/feedback',{method:'POST',body:{question:question.slice(0,2000),answer:answer.slice(0,4000),context:context.slice(0,500),rating:rating}});
  track('ai_feedback','ai',String(rating));
}

// ── Engagement ─────────────────────────────────────────────────

function loadDailyInsight() {
  rq('/api/engage/insight/today').then(function(r){
    var el2=document.getElementById('d-brief-txt')||document.getElementById('dash-brief');
    if (el2&&r&&r.insight) { el2.textContent=r.insight; var box=el2.closest('.ai-brief')||el2.parentElement; if(box) box.style.display='block'; }
  });
}
function loadDigest() {
  rq('/api/intelligence/watchlist-digest').then(function(r){
    var box=document.getElementById('digest-box'); var txt=document.getElementById('digest-txt');
    if (!box) return;
    box.style.display='block';
    if (txt) txt.textContent=(r&&(r.digest||r.content))||'Digest not available yet.';
  });
}
function loadLayout() {
  rq('/api/engage/layout').then(function(r){ if(r&&r.layout) { /* apply layout preference */ } });
}

// ── Map helpers ────────────────────────────────────────────────

function mapSearchInput(val) {
  var res=document.getElementById('map-search-results');
  if (!val||val.length<2) { if(res) res.style.display='none'; return; }
  var matches=G.events.filter(function(e){ return (e.title||'').toLowerCase().includes(val.toLowerCase())||(e.country_name||'').toLowerCase().includes(val.toLowerCase()); }).slice(0,8);
  if (!res) return;
  if (!matches.length) { res.style.display='none'; return; }
  res.style.display='block';
  res.innerHTML=matches.map(function(e){
    return '<div onclick="mapSearchSelect(\''+e.id+'\')" style="padding:7px 12px;cursor:pointer;border-bottom:1px solid var(--bd);font-size:11px"><div style="color:var(--t1)">'+e.title.slice(0,60)+'</div><div style="font-size:9px;color:var(--t3)">'+(e.country_name||'')+' - '+(e.category||'')+'</div></div>';
  }).join('');
}
function mapSearchKey(e) { if (e.key==='Enter') mapSearchInput((document.getElementById('map-search')||{}).value||''); }
function mapSearchSelect(id) {
  mapSearchClear(); openEP(id);
  var ev=G.events.find(function(e){ return e.id===id; });
  if (ev&&G.map&&ev.latitude&&ev.longitude) G.map.setView([ev.latitude,ev.longitude],5,{animate:true});
}
function mapSearchClear() {
  var inp=document.getElementById('map-search'); if(inp) inp.value='';
  var res=document.getElementById('map-search-results'); if(res) res.style.display='none';
}
function toggleMapLegend() {
  var leg=document.getElementById('map-legend'); if(leg) leg.style.display=leg.style.display==='none'?'block':'none';
}
function mapFocusCountry(code) {
  if (!G.map) return;
  var ev=G.events.find(function(e){ return e.country_code===code; });
  if (ev&&ev.latitude) G.map.setView([ev.latitude,ev.longitude],5,{animate:true});
}
function closeCountryPanel() { var cp=document.getElementById('country-panel'); if(cp) cp.style.display='none'; }
function openCountryPanelForEv(evId) {
  var ev=G.events.find(function(e){ return e.id===evId; });
  if (ev&&typeof openCountryPanel==='function') openCountryPanel(ev.country_code);
}

// ── Event panel ────────────────────────────────────────────────

function switchEPTab(tab, btn) {
  document.querySelectorAll('.ep-tab-panel').forEach(function(p){ p.classList.remove('on'); });
  document.querySelectorAll('.ep-tab').forEach(function(b){ b.classList.remove('on'); });
  var panel=document.getElementById('ept-'+tab); if(panel) panel.classList.add('on');
  if (btn) btn.classList.add('on');
}
function sentBadgeHtml(ev) {
  if (!ev||!ev.sentiment_tone) return '';
  var tone=ev.sentiment_tone.toLowerCase();
  var col=tone==='positive'?'var(--gr)':tone==='negative'?'var(--re)':'var(--t4)';
  var icon=tone==='positive'?'+':tone==='negative'?'-':'~';
  return '<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:rgba(0,0,0,.2);color:'+col+'">'+icon+' '+tone+'</span>';
}

// ── Misc ───────────────────────────────────────────────────────

function openBreakingEvent(id) {
  sv('map',document.querySelector('[data-v=map]'));
  setTimeout(function(){ if(typeof openEP==='function') openEP(id); },500);
}
function openRiskRadar() {
  rq('/api/engage/risk-radar').then(function(r){
    var modal=document.getElementById('radar-modal');
    if (!modal) { toast('Risk Radar coming soon','i'); return; }
    modal.style.display='flex';
    var txt=document.getElementById('radar-content');
    if (txt&&r) txt.innerHTML='<pre style="font-size:10px;color:var(--t2);white-space:pre-wrap">'+JSON.stringify(r,null,2)+'</pre>';
  });
  track('risk_radar_opened','dashboard','');
}
function shareRadar() {
  var url=window.location.origin+'/?radar=1';
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(function(){ toast('Link copied!','s'); });
  else toast(url,'i');
}
function runSentimentFull() {
  var ev=G.panelEv; if (!ev) return;
  rq('/api/events/sentiment/'+ev.id,{method:'POST'}).then(function(r){
    if (r&&r.sentiment_score!==undefined) { ev.sentiment_score=r.sentiment_score; ev.sentiment_tone=r.sentiment_tone; toast('Sentiment updated','s'); }
  });
  track('sentiment_analysis',G.currentView||'map',ev.id);
}
function toggleSentimentOverlay() {
  var ov=document.getElementById('ep-sentiment'); if(ov) ov.style.display=ov.style.display==='none'?'block':'none';
}
function applyTimelineFilter(val, btn) {
  document.querySelectorAll('.tl-filter-btn').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  if (typeof tlBuild==='function') { var bandEl=document.getElementById('tl-band'); if(bandEl) bandEl.value=val||'all'; tlBuild(); }
}
function renderMkts() {
  if (typeof initMarkets==='function') initMarkets();
  else if (typeof renderMktSidebar==='function') renderMktSidebar();
}

/* ── EW safe-escape (used if global _esc not available) ── */
function _ew_esc(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ═══════════════════════════════════════════════════════
   CRISIS EARLY WARNING SYSTEM — Full Implementation
   Fixes: G_EW, URL mismatch, field names, opacity, patterns, chart
   ═══════════════════════════════════════════════════════ */

var _ewData     = null;   // cached last response
var _ewChart    = null;   // Chart.js instance

/* Score → colour */
function _ewColor(score) {
  return score >= 8 ? '#ef4444'
       : score >= 6 ? '#f97316'
       : score >= 4 ? '#f59e0b'
       :              '#10b981';
}

/* Score → label */
function _ewLabel(score) {
  return score >= 8 ? 'CRITICAL' : score >= 6 ? 'HIGH RISK' : score >= 4 ? 'ELEVATED' : 'STABLE';
}

/* ── Main loader ──────────────────────────────────────── */
window.loadEarlyWarning = function(force) {
  // Show skeleton while loading
  var hero = document.getElementById('ew-hero');
  if (hero) { hero.style.opacity = '0.5'; }

  rq('/api/intelligence/early-warning').then(function(r) {
    if (!r) { _ewShowError('Could not reach Early Warning API'); return; }
    _ewData = r;

    var score = parseFloat(r.global_ew_score || r.score || 5);
    var col   = _ewColor(score);
    var label = _ewLabel(score);

    // ── Hero
    if (hero) hero.style.opacity = '1';
    _ewSet('ew-score', score.toFixed(1));
    _ewSet('ew-label', label);
    _ewSet('ew-evcount', r.event_count_48h || r.event_count || '—');
    var scoreEl = document.getElementById('ew-score');
    var labelEl = document.getElementById('ew-label');
    if (scoreEl) scoreEl.style.color = col;
    if (labelEl) labelEl.style.color = col;

    // ── AI Assessment
    _ewRenderAssessment(r.ai_assessment || r.assessment || '', score, r);

    // ── Gauges (with colour-coded fills)
    var gauges = {
      macro:  { val: r.macro_stress     || 0, col: _ewColor(r.macro_stress  || 0) },
      market: { val: r.market_stress    || 0, col: _ewColor(r.market_stress || 0) },
      sent:   { val: Math.abs(r.sentiment_trend || 0) * 10,
                col: (r.sentiment_trend||0) < -0.3 ? '#ef4444' : (r.sentiment_trend||0) > 0.1 ? '#10b981' : '#f59e0b' },
      vel:    { val: Math.min(10, (r.event_velocity || 1) * 4),
                col: (r.event_velocity||1) > 1.5 ? '#ef4444' : (r.event_velocity||1) > 1.1 ? '#f59e0b' : '#10b981' },
    };
    Object.keys(gauges).forEach(function(k) {
      var g   = gauges[k];
      var pct = Math.min(100, Math.max(0, (g.val / 10) * 100));
      var bar = document.getElementById('ewgb-'+k);
      var lbl = document.getElementById('ewg-'+k);
      if (bar) { bar.style.width = pct+'%'; bar.style.background = g.col; }
      if (lbl) { lbl.textContent = g.val.toFixed(1); lbl.style.color = g.col; }
    });

    // ── Pattern matrix
    _ewRenderPatterns(r.top_risks || []);

    // ── Signals
    if (typeof window.loadEWSignals === "function") window.loadEWSignals();

    // ── Timeline chart
    _ewLoadTimeline();

  }).catch(function(e) {
    _ewShowError('Failed: ' + (e && e.message || 'network error'));
  });

  track('early_warning_viewed', 'earlywarning', '');
};

/* ── Set text helper ─────────────────────────────────── */
function _ewSet(id, v) {
  var e = document.getElementById(id); if (e) e.textContent = v;
}

/* ── Error state ─────────────────────────────────────── */
function _ewShowError(msg) {
  var hero = document.getElementById('ew-hero');
  if (hero) { hero.style.opacity = '1'; }
  _ewSet('ew-score', '—');
  _ewSet('ew-label', 'UNAVAILABLE');
  _ewSet('ew-assess', msg);
}

/* ── AI Assessment renderer ──────────────────────────── */
function _ewRenderAssessment(text, score, r) {
  var el = document.getElementById('ew-assess');
  if (!el) return;

  if (!text || text.length < 20) {
    // Fallback: synthesise a basic assessment from the data
    var vel  = r.event_velocity || 1.0;
    var velTxt = vel > 1.5 ? 'accelerating (+' + Math.round((vel-1)*100) + '%)' : vel < 0.8 ? 'decelerating' : 'stable';
    var negTrend = (r.sentiment_trend || 0) < -0.3;
    text = 'EW Score ' + score.toFixed(1) + '/10 — '
      + (r.event_count_48h || r.event_count || 0) + ' events in the 48h window. '
      + 'Event velocity ' + velTxt + '. '
      + 'Macro stress ' + (r.macro_stress || 5).toFixed(1) + '/10. '
      + (negTrend ? 'News sentiment is deteriorating. ' : 'Sentiment stable. ')
      + 'Enable an AI provider in Admin → Settings for deep crisis assessment.';
  }

  // Render as structured paragraphs if multi-sentence
  var sentences = text.split(/(?<=[.!?])\s+/);
  if (sentences.length >= 3) {
    el.innerHTML = sentences.map(function(s, i) {
      return '<p style="margin:0 0 6px;' + (i===0 ? 'font-weight:600;color:var(--t1)' : 'color:var(--t2)') + '">' + (window._esc||_ew_esc)(s) + '</p>';
    }).join('');
  } else {
    el.innerHTML = '<p style="margin:0;color:var(--t2);line-height:1.7">' + (window._esc||_ew_esc)(text) + '</p>';
  }
}

/* ── Pattern matrix ──────────────────────────────────── */
function _ewRenderPatterns(patterns) {
  var el = document.getElementById('ew-patterns');
  if (!el) return;
  if (!patterns || !patterns.length) {
    el.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:12px 0;grid-column:1/-1">No significant crisis patterns detected in the 48h window.</div>';
    return;
  }
  el.innerHTML = patterns.map(function(p) {
    var sc  = parseFloat(p.score || 0);
    var col = _ewColor(sc);
    var pct = Math.min(100, sc * 10);
    var regHtml = (p.regions || []).length
      ? '<div style="font-size:9px;color:var(--t4);margin-top:4px">📍 ' + p.regions.slice(0,3).join(', ') + '</div>'
      : '';
    return '<div class="pattern-card" style="border-color:' + col + '22">'
      + '<div class="pattern-icon">' + (p.icon || '⚠️') + '</div>'
      + '<div class="pattern-label" style="color:' + col + '">' + (p.label || p.type || '') + '</div>'
      + '<div class="pattern-score" style="color:' + col + '">' + sc.toFixed(1) + '<span style="font-size:10px;opacity:.6">/10</span></div>'
      + '<div class="pattern-bar"><div class="pattern-fill" style="width:' + pct + '%;background:' + col + '"></div></div>'
      + regHtml
      + '</div>';
  }).join('');
}

/* ── Active signals ──────────────────────────────────── */
window.loadEWSignals = function() {
  rq('/api/intelligence/early-warning/signals').then(function(r) {   // FIXED URL
    var el2 = document.getElementById('ew-signals');
    var cnt = document.getElementById('ew-signal-count');
    if (!el2 || !r) return;
    var signals = r.signals || [];
    if (cnt) cnt.textContent = '(' + signals.length + ')';

    if (!signals.length) {
      el2.innerHTML = '<div style="font-size:11px;color:var(--t3);text-align:center;padding:24px;grid-column:1/-1">No active signals in the 48h window</div>';
      return;
    }

    el2.innerHTML = signals.map(function(sig) {
      var sev  = parseFloat(sig.severity || 5);
      var col  = _ewColor(sev);
      var conf = parseFloat(sig.confidence || 0.5);
      var confPct = Math.round(conf * 100);
      // FIXED: use sig.type not sig.signal_type; sig.summary not sig.description
      var typeLabel = sig.label || (sig.type || sig.signal_type || '').replace(/_/g,' ');
      var bodyText  = (sig.summary || sig.description || sig.title || '').slice(0, 160);
      var ts = sig.timestamp ? sig.timestamp.slice(0,10) : '';

      return '<div class="ew-signal" onclick="_ewOpenSignal(this)" data-id="' + (sig.id||'') + '">'
        + '<div class="ew-signal-icon">' + (sig.icon || '⚠️') + '</div>'
        + '<div style="flex:1;min-width:0">'
        + '  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">'
        + '    <span class="ew-signal-type" style="color:' + col + '">' + typeLabel + '</span>'
        + '    <span style="font-size:9px;color:var(--t3)">' + (sig.region || '') + '</span>'
        + '    <span style="margin-left:auto;font-family:var(--fm);font-size:13px;font-weight:800;color:' + col + '">' + sev.toFixed(1) + '</span>'
        + '  </div>'
        + '  <div class="ew-signal-title">' + (window._esc||_ew_esc)(sig.title || typeLabel) + '</div>'
        + (bodyText ? '  <div style="font-size:10px;color:var(--t3);line-height:1.5;margin-top:3px">' + (window._esc||_ew_esc)(bodyText) + '</div>' : '')
        + '  <div class="ew-confidence">'
        + '    <div class="ew-conf-bar"><div class="ew-conf-fill" style="width:' + confPct + '%;background:' + col + '"></div></div>'
        + '    <span style="font-size:9px;color:var(--t3)">' + confPct + '% confidence</span>'
        + (ts ? '    <span style="font-size:9px;color:var(--t4);margin-left:auto">' + ts + '</span>' : '')
        + '  </div>'
        + '</div>'
        + '</div>';
    }).join('');
  });
};

window._ewOpenSignal = function(el) {
  /* Future: open a detail drawer */
};

/* ── Timeline chart (vanilla canvas — no Chart.js dependency) ── */
function _ewLoadTimeline() {
  rq('/api/intelligence/early-warning/timeline').then(function(rows) {
    var canvas = document.getElementById('ew-chart');
    if (!canvas) return;

    // Render even with no history — show placeholder
    if (!rows || !rows.length) {
      canvas.height = 80;
      var ctx0 = canvas.getContext('2d');
      ctx0.fillStyle = 'rgba(148,163,184,.3)';
      ctx0.font = '11px monospace';
      ctx0.textAlign = 'center';
      ctx0.fillText('No history yet — score updates every 30 minutes', canvas.width/2, 40);
      return;
    }

    var sorted  = rows.slice().reverse();  // oldest → newest
    var scores  = sorted.map(function(r){ return parseFloat(r.global_ew_score  || 5); });
    var macros  = sorted.map(function(r){ return parseFloat(r.macro_stress     || 0); });
    var markets = sorted.map(function(r){ return parseFloat(r.market_stress    || 0); });
    var labels  = sorted.map(function(r){ return (r.snapshot_date||'').slice(5); }); // MM-DD

    canvas.width  = canvas.offsetWidth || 600;
    canvas.height = 100;
    var ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    var W   = canvas.width;
    var H   = canvas.height;
    var pad = { top: 12, right: 14, bottom: 24, left: 36 };
    var cW  = W - pad.left - pad.right;
    var cH  = H - pad.top  - pad.bottom;
    var n   = scores.length;
    if (n < 2) return;

    var minY = 0, maxY = 10, rangeY = 10;

    function xOf(i)  { return pad.left + i * cW / (n - 1); }
    function yOf(v)  { return pad.top  + (1 - (v - minY) / rangeY) * cH; }

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(148,163,184,.45)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'right';
    [0, 2.5, 5, 7.5, 10].forEach(function(v) {
      var y = yOf(v);
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
      ctx.fillText(v.toFixed(0), pad.left - 3, y + 3);
    });

    // Threshold line at 6 (HIGH RISK)
    ctx.strokeStyle = 'rgba(239,68,68,.2)';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(pad.left, yOf(6)); ctx.lineTo(W - pad.right, yOf(6)); ctx.stroke();
    ctx.setLineDash([]);

    // Draw filled area under EW Score
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(scores[0]));
    for (var i = 1; i < n; i++) {
      var xc  = (xOf(i-1) + xOf(i)) / 2;
      var yc  = (yOf(scores[i-1]) + yOf(scores[i])) / 2;
      ctx.quadraticCurveTo(xOf(i-1), yOf(scores[i-1]), xc, yc);
    }
    ctx.lineTo(xOf(n-1), yOf(scores[n-1]));
    ctx.lineTo(xOf(n-1), H - pad.bottom);
    ctx.lineTo(pad.left, H - pad.bottom);
    ctx.closePath();
    ctx.fillStyle = 'rgba(245,158,11,.07)';
    ctx.fill();

    // Draw series lines
    function drawLine(data, color, dash, width) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.lineWidth   = width || 1.5;
      ctx.lineJoin    = 'round';
      if (dash) ctx.setLineDash(dash); else ctx.setLineDash([]);
      ctx.moveTo(xOf(0), yOf(data[0]));
      for (var i = 1; i < n; i++) {
        var xc = (xOf(i-1) + xOf(i)) / 2;
        var yc = (yOf(data[i-1]) + yOf(data[i])) / 2;
        ctx.quadraticCurveTo(xOf(i-1), yOf(data[i-1]), xc, yc);
      }
      ctx.lineTo(xOf(n-1), yOf(data[n-1]));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    drawLine(macros,  'rgba(239,68,68,.5)',  [3,3], 1.2);
    drawLine(markets, 'rgba(59,130,246,.5)', [2,4], 1.2);
    drawLine(scores,  '#f59e0b', null, 2.2);

    // Coloured dots on EW Score line
    scores.forEach(function(v, i) {
      ctx.beginPath();
      ctx.arc(xOf(i), yOf(v), 3.5, 0, Math.PI*2);
      ctx.fillStyle = _ewColor(v);
      ctx.fill();
    });

    // X axis labels
    ctx.fillStyle = 'rgba(148,163,184,.45)';
    ctx.font = '8px monospace';
    ctx.textAlign = 'center';
    var step = Math.max(1, Math.floor(n / 7));
    for (var i = 0; i < n; i += step) {
      ctx.fillText(labels[i], xOf(i), H - 6);
    }

    // Legend
    var legendItems = [
      { color:'#f59e0b',              label:'EW Score' },
      { color:'rgba(239,68,68,.6)',   label:'Macro' },
      { color:'rgba(59,130,246,.6)',  label:'Market' },
    ];
    ctx.font = '8px monospace';
    ctx.textAlign = 'left';
    var lx = pad.left;
    legendItems.forEach(function(it) {
      ctx.fillStyle  = it.color;
      ctx.fillRect(lx, 2, 18, 3);
      ctx.fillStyle  = 'rgba(148,163,184,.6)';
      ctx.fillText(it.label, lx + 21, 7);
      lx += ctx.measureText(it.label).width + 34;
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   WORLDLENS BRAIN CLIENT
   Auto-feeds knowledge on every user interaction.
   More usage = smarter AI responses.
   ══════════════════════════════════════════════════════════════ */
var _brain = {
  queue: [],
  flushing: false,
  minLen: 20,
  _feedTimeout: null,
};

/* Public API — call from anywhere */
window.brainFeed = function(content, source, weight, context) {
  if (!G.token) return;
  if (!content || content.length < _brain.minLen) return;
  _brain.queue.push({ content: String(content).slice(0, 800), source: source || 'interaction', weight: weight || 1.0, context: context || {} });
  // Debounce flush — batch up interactions for 3s
  clearTimeout(_brain._feedTimeout);
  _brain._feedTimeout = setTimeout(_brainFlush, 3000);
};

function _brainFlush() {
  if (!G.token || _brain.flushing || !_brain.queue.length) return;
  _brain.flushing = true;
  var entries = _brain.queue.splice(0, 20); // max 20 per flush
  rq('/api/brain/feed/batch', { method: 'POST', body: { entries: entries } })
    .then(function(r) {
      _brain.flushing = false;
      if (_brain.queue.length) _brainFlush(); // flush remainder
    })
    .catch(function() { _brain.flushing = false; });
}

/* Auto-hook: sv() — every view navigation */
(function() {
  var _origSvForBrain = window.sv;
  if (typeof _origSvForBrain !== 'function') return;
  window.sv = function(name, btn) {
    _origSvForBrain(name, btn);
    var viewLabels = {
      dash: 'Viewed Dashboard intelligence overview',
      map: 'Explored Global Map and geopolitical events',
      feed: 'Browsed Event Feed news stream',
      earlywarning: 'Consulted Early Warning system',
      macro: 'Reviewed Macro economic indicators',
      markets: 'Analyzed financial markets data',
      portfolio: 'Reviewed investment portfolio',
      tradgentic: 'Used TradGentic algorithmic trading',
      insiders: 'Checked insider trading signals',
      ai: 'Consulted AI Analyst',
      supplychain: 'Analyzed Supply Chain risks',
      alerts: 'Managed price and event alerts',
    };
    var label = viewLabels[name];
    if (label) brainFeed(label, 'interaction', 0.3);
  };
})();

/* Auto-hook: openEP() — every event opened */
(function() {
  var _maxWait = 0;
  function tryHook() {
    if (typeof openEP !== 'function') {
      if (_maxWait++ < 20) setTimeout(tryHook, 500);
      return;
    }
    var _origOpenEPBrain = openEP;
    openEP = function(id) {
      _origOpenEPBrain(id);
      // Feed event details into brain
      var ev = G.events && G.events.find(function(e) { return e.id === id || e.id === parseInt(id); });
      if (ev) {
        var txt = (ev.title || '') + '. ' + (ev.summary || ev.ai_summary || '').slice(0, 300);
        if (txt.length > 20) {
          brainFeed(txt, 'event', 1.5, {
            category: ev.category, country: ev.country_code,
            severity: ev.severity, event_id: id
          });
        }
      }
    };
  }
  tryHook();
})();

/* Auto-hook: watchlist adds */
window._brainFeedWatchlist = function(label, type) {
  brainFeed('Added to watchlist: ' + label + ' (' + type + ')', 'watchlist', 1.2, { label: label, type: type });
};

/* Auto-hook: alert creation */
window._brainFeedAlert = function(query) {
  if (query) brainFeed('Set price/event alert: ' + query, 'alert', 1.0);
};

/* Auto-hook: market views */
window._brainFeedMarket = function(ticker, price, change) {
  if (ticker) {
    brainFeed('Monitored market: ' + ticker + (price ? ' at ' + price : '') + (change ? ', change ' + change + '%' : ''), 'market', 0.8, { ticker: ticker });
  }
};

/* Auto-hook: EW viewed */
window._brainFeedEW = function(score, label) {
  brainFeed('Early Warning: Global risk score ' + score + '/10 — ' + label, 'ew', 1.0, { score: score });
};

/* Feed question when user asks AI */
window._brainFeedQuestion = function(question, answer) {
  if (question && question.length > 15) {
    brainFeed('Q: ' + question.slice(0, 400), 'question', 1.8, {});
    if (answer && answer.length > 30) {
      brainFeed('A: ' + answer.slice(0, 500), 'analysis', 1.5, {});
    }
  }
};

/* Load brain stats on app boot — shows brain level in profile */
window.loadBrainStats = function() {
  rq('/api/brain/stats').then(function(r) {
    if (!r || r.total_entries === undefined) return;
    G.brainStats = r;
    var el = document.getElementById('brain-level-badge');
    var el2 = document.getElementById('brain-entry-count');
    var el3 = document.getElementById('brain-level-bar');
    var levels = { seed: 0, growing: 20, active: 100, advanced: 500, expert: 2000 };
    var icons  = { seed: '🌱', growing: '🌿', active: '🧠', advanced: '⚡', expert: '🔥' };
    var level  = r.brain_level || 'seed';
    var count  = r.total_entries || 0;
    if (el) el.textContent = icons[level] + ' ' + level.toUpperCase();
    if (el2) el2.textContent = count + ' entries';
    if (el3) {
      var next = { seed: 20, growing: 100, active: 500, advanced: 2000, expert: 9999 };
      var pct = Math.min(100, Math.round(count / (next[level] || 100) * 100));
      el3.style.width = pct + '%';
      el3.title = pct + '% to next level';
    }
  });
};


/* ══════════════════════════════════════════════════════════════
   BRAIN AGENT — Modal chat controller
   Multi-turn · Template buttons · Feedback loop · Session memory
   ══════════════════════════════════════════════════════════════ */
(function() {
'use strict';

/* ── State ── */
var BA = {
  sessionId:    null,
  messages:     [],
  typing:       false,
  templates:    [],
  selectedTmpl: null,
  dwellStart:   null,
  lastMsgId:    null,
  brainCount:   0,
  sessionsOpen: false,
};

/* ── Helpers ── */
function $ba(id)  { return document.getElementById(id); }
function rqBA(url, opts) {
  opts = opts || {};
  var h = {'Content-Type':'application/json'};
  if (G.token) h['Authorization'] = 'Bearer ' + G.token;
  return fetch(url, { method: opts.method||'GET', headers: h,
    body: opts.body ? JSON.stringify(opts.body) : undefined })
    .then(function(r){ return r.ok ? r.json() : r.json().then(function(e){ throw e; }); })
    .catch(function(e){ console.warn('[BA]', e.message||e.detail||e); return null; });
}

var TMPL_COLORS = {
  market_brief:  '#10B981', risk_summary: '#EF4444',
  geo_digest:    '#F97316', compare:      '#3B82F6',
  deep_dive:     '#7C3AED', action_plan:  '#F59E0B',
};

/* ── Public API ── */
window.brainAgent = {
  open:  function() { open(); },
  close: function() { close(); },
  toggle: function() {
    var ov = $ba('brain-agent-overlay');
    if (ov) ov.style.display === 'none' ? open() : close();
  },
  send: function() { send(); },
  newSession: function() { newSession(); },
  toggleSessions: function() { toggleSessions(); },
};

function open() {
  var ov = $ba('brain-agent-overlay');
  if (!ov) return;
  ov.style.display = 'flex';
  loadTemplates();
  loadBrainCount();
  if (!BA.sessionId) newSession();
  setTimeout(function() { var inp = $ba('ba-input'); if (inp) inp.focus(); }, 200);
}

function close() {
  var ov = $ba('brain-agent-overlay');
  if (ov) ov.style.display = 'none';
  // Send dwell time for last message
  sendDwell();
}

function newSession() {
  BA.sessionId = null;
  BA.messages  = [];
  BA.lastMsgId = null;
  BA.selectedTmpl = null;
  var msgs = $ba('ba-messages');
  if (msgs) msgs.innerHTML = '<div id="ba-empty" style="margin:auto;text-align:center;padding:32px 16px"><div style="font-size:36px;margin-bottom:12px">🧠</div><div style="font-size:15px;font-weight:600;color:var(--t1,#F0F2FF);margin-bottom:8px">Brain Agent</div><div style="font-size:12px;color:var(--t3,#5A6070);line-height:1.7;max-width:280px">Fai domande, richiedi analisi, confronta scenari. Il cervello usa tutto quello che hai letto e salvato.</div></div>';
  deselectTemplate();
  setStatus('pronto');
}

/* ── Templates ── */
function loadTemplates() {
  rqBA('/api/brain-agent/templates').then(function(tmpls) {
    if (!tmpls) return;
    BA.templates = tmpls;
    var el = $ba('ba-template-btns');
    if (!el) return;
    el.innerHTML = tmpls.map(function(t) {
      var col = TMPL_COLORS[t.id] || '#7C3AED';
      var wr  = t.win_rate ? t.win_rate + '% ✓' : '';
      return '<button class="ba-tmpl-btn" data-id="' + t.id + '" onclick="brainAgentSelectTmpl(\'' + t.id + '\')" style="padding:5px 10px;border-radius:20px;border:1px solid ' + col + '33;background:transparent;color:' + col + ';font-size:11px;cursor:pointer;font-family:inherit;transition:all .15s;display:flex;align-items:center;gap:4px">' +
        t.icon + ' ' + t.label.split(' ').slice(1).join(' ') +
        (wr ? '<span style="font-size:9px;opacity:.6">' + wr + '</span>' : '') +
        '</button>';
    }).join('');
  });
}

window.brainAgentSelectTmpl = function(id) {
  if (BA.selectedTmpl === id) {
    deselectTemplate(); return;
  }
  BA.selectedTmpl = id;
  document.querySelectorAll('.ba-tmpl-btn').forEach(function(b) {
    var active = b.dataset.id === id;
    var col = TMPL_COLORS[b.dataset.id] || '#7C3AED';
    b.style.background = active ? col + '22' : 'transparent';
    b.style.borderColor = active ? col : col + '33';
    b.style.fontWeight  = active ? '700' : '400';
  });
  var inp = $ba('ba-input');
  if (inp && !inp.value.trim()) {
    var tmpl = BA.templates.find(function(t){ return t.id===id; });
    if (tmpl) inp.placeholder = 'Template: ' + tmpl.label + ' — digita la tua domanda…';
  }
};

function deselectTemplate() {
  BA.selectedTmpl = null;
  document.querySelectorAll('.ba-tmpl-btn').forEach(function(b) {
    var col = TMPL_COLORS[b.dataset.id] || '#7C3AED';
    b.style.background = 'transparent';
    b.style.borderColor = col + '33';
    b.style.fontWeight  = '400';
  });
  var inp = $ba('ba-input');
  if (inp) inp.placeholder = 'Chiedi qualcosa al tuo cervello AI…';
}

/* ── Brain count ── */
function loadBrainCount() {
  if (!G.token) return;
  rqBA('/api/brain/stats').then(function(r) {
    if (!r) return;
    BA.brainCount = r.total_entries || 0;
    var el = $ba('ba-brain-count');
    if (el) el.textContent = BA.brainCount + ' entries nel cervello';
  });
}

/* ── Sessions list ── */
function toggleSessions() {
  BA.sessionsOpen = !BA.sessionsOpen;
  var panel = $ba('ba-sessions-panel');
  if (!panel) return;
  if (BA.sessionsOpen) {
    panel.style.display = 'block';
    loadSessionsList();
  } else {
    panel.style.display = 'none';
  }
}

function loadSessionsList() {
  rqBA('/api/brain-agent/sessions').then(function(sessions) {
    var el = $ba('ba-sessions-list');
    if (!el || !sessions) return;
    if (!sessions.length) {
      el.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:8px">Nessuna sessione precedente</div>';
      return;
    }
    el.innerHTML = sessions.map(function(s) {
      var active = s.id === BA.sessionId;
      return '<div onclick="brainAgentLoadSession(\'' + s.id + '\')" style="padding:8px 10px;border-radius:7px;cursor:pointer;border:1px solid ' + (active?'rgba(124,58,237,.4)':'transparent') + ';background:' + (active?'rgba(124,58,237,.1)':'transparent') + ';margin-bottom:4px">' +
        '<div style="font-size:12px;font-weight:600;color:var(--t1)">' + (s.title||'Conversazione').slice(0,50) + '</div>' +
        '<div style="font-size:10px;color:var(--t3)">' + (s.message_count||0) + ' messaggi · ' + (s.updated_at||'').slice(0,10) + '</div>' +
        '</div>';
    }).join('');
  });
}

window.brainAgentLoadSession = function(id) {
  BA.sessionId = id;
  BA.sessionsOpen = false;
  var panel = $ba('ba-sessions-panel');
  if (panel) panel.style.display = 'none';
  rqBA('/api/brain-agent/sessions/' + id + '/messages').then(function(msgs) {
    if (!msgs) return;
    var el = $ba('ba-messages');
    if (!el) return;
    el.innerHTML = '';
    BA.messages = [];
    msgs.forEach(function(m) {
      renderMessage(m.role, m.content, m.template, m.id, m.rating);
      BA.messages.push(m);
    });
    scrollToBottom();
  });
};

/* ── Send message ── */
function send() {
  var inp = $ba('ba-input');
  if (!inp) return;
  var query = inp.value.trim();
  if (!query || BA.typing) return;

  // Send dwell for previous message
  sendDwell();

  inp.value = '';
  inp.style.height = '44px';

  // Render user message immediately
  renderMessage('user', query);
  BA.messages.push({ role:'user', content: query });

  // Show typing indicator
  BA.typing = true;
  setStatus('elaboro…');
  renderTyping();

  var btn = $ba('ba-send-btn');
  if (btn) { btn.textContent = '…'; btn.disabled = true; }

  var emptyEl = $ba('ba-empty');
  if (emptyEl) emptyEl.remove();

  // Build payload
  var payload = {
    query:         query,
    session_id:    BA.sessionId,
    template_hint: BA.selectedTmpl || undefined,
  };

  rqBA('/api/brain-agent/ask', { method:'POST', body: payload })
    .then(function(r) {
      removeTyping();
      BA.typing = false;
      if (btn) { btn.textContent = '↑'; btn.disabled = false; }

      if (!r) {
        renderMessage('assistant', '⚠ Errore di rete — riprova.');
        setStatus('errore');
        return;
      }

      // Update session id
      BA.sessionId = r.session_id;
      BA.lastMsgId = r.message_id;

      // Render response
      renderMessage('assistant', r.response, r.template, r.message_id);
      BA.messages.push({ role:'assistant', content: r.response, template: r.template, id: r.message_id });

      // Start dwell tracking
      BA.dwellStart = Date.now();

      // Update brain count
      var cnt = $ba('ba-brain-count');
      if (cnt) { BA.brainCount += (r.brain_hits || 0); cnt.textContent = BA.brainCount + ' entries nel cervello'; }

      // Status
      var hits = r.brain_hits || 0;
      setStatus(hits + ' entries brain · ' + (r.template || 'auto'));

      // Deselect template after use
      deselectTemplate();
    })
    .catch(function(e) {
      removeTyping();
      BA.typing = false;
      if (btn) { btn.textContent = '↑'; btn.disabled = false; }
      renderMessage('assistant', '⚠ Errore: ' + (e.detail || e.message || 'sconosciuto'));
      setStatus('errore');
    });
}

/* ── Dwell tracking ── */
function sendDwell() {
  if (!BA.lastMsgId || !BA.dwellStart) return;
  var dwell = Date.now() - BA.dwellStart;
  BA.dwellStart = null;
  if (dwell < 1000) return;
  rqBA('/api/brain-agent/implicit-feedback', {
    method: 'POST',
    body: { message_id: BA.lastMsgId, dwell_ms: dwell }
  });
}

/* ── Render ── */
function renderMessage(role, content, template, msgId, existingRating) {
  var msgs = $ba('ba-messages');
  if (!msgs) return;

  var isUser = role === 'user';
  var col = template ? (TMPL_COLORS[template] || '#7C3AED') : '#7C3AED';
  var id = msgId ? 'ba-msg-' + msgId.replace(/-/g,'') : '';

  var html = '<div ' + (id?'id="'+id+'"':'') + ' style="display:flex;flex-direction:column;' + (isUser?'align-items:flex-end':'align-items:flex-start') + '">';

  if (!isUser && template) {
    var tmpl = BA.templates.find(function(t){ return t.id===template; });
    html += '<div style="font-size:9px;font-family:monospace;letter-spacing:.1em;color:' + col + ';margin-bottom:4px;opacity:.8">' +
            (tmpl ? tmpl.icon + ' ' + tmpl.label : template.toUpperCase()) + '</div>';
  }

  html += '<div style="max-width:90%;padding:' + (isUser?'10px 14px':'12px 16px') + ';border-radius:' + (isUser?'14px 14px 4px 14px':'4px 14px 14px 14px') + ';' +
    (isUser
      ? 'background:linear-gradient(135deg,#7C3AED,#6D28D9);color:#fff;'
      : 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:var(--t1,#F0F2FF);') +
    'font-size:13px;line-height:1.65;white-space:pre-wrap;word-break:break-word">' +
    mdToHtml(content) +
    '</div>';

  // Feedback buttons for assistant messages
  if (!isUser && msgId) {
    var rated = existingRating;
    html += '<div class="ba-feedback" data-msg="' + msgId + '" style="display:flex;gap:6px;margin-top:6px;align-items:center">' +
      '<button onclick="brainAgentFeedback(\'' + msgId + '\',1,this)" style="padding:4px 10px;border-radius:20px;border:1px solid rgba(16,185,129,' + (rated===1?'0.6':'0.2') + ');background:rgba(16,185,129,' + (rated===1?'0.15':'0') + ');color:#10B981;font-size:12px;cursor:pointer;transition:all .2s">👍</button>' +
      '<button onclick="brainAgentFeedback(\'' + msgId + '\',-1,this)" style="padding:4px 10px;border-radius:20px;border:1px solid rgba(239,68,68,' + (rated===-1?'0.6':'0.2') + ');background:rgba(239,68,68,' + (rated===-1?'0.15':'0') + ');color:#EF4444;font-size:12px;cursor:pointer;transition:all .2s">👎</button>' +
      '<span style="font-size:10px;color:var(--t3);font-family:monospace" id="ba-fb-' + msgId.replace(/-/g,'') + '"></span>' +
      '</div>';
  }

  html += '</div>';
  msgs.insertAdjacentHTML('beforeend', html);
  scrollToBottom();
}

function renderTyping() {
  var msgs = $ba('ba-messages');
  if (!msgs) return;
  msgs.insertAdjacentHTML('beforeend',
    '<div id="ba-typing" style="display:flex;align-items:flex-start">' +
    '<div style="padding:12px 16px;border-radius:4px 14px 14px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08)">' +
    '<div style="display:flex;gap:4px;align-items:center">' +
    '<div style="width:6px;height:6px;border-radius:50%;background:#7C3AED;animation:baPulse .8s ease-in-out infinite"></div>' +
    '<div style="width:6px;height:6px;border-radius:50%;background:#7C3AED;animation:baPulse .8s ease-in-out .2s infinite"></div>' +
    '<div style="width:6px;height:6px;border-radius:50%;background:#7C3AED;animation:baPulse .8s ease-in-out .4s infinite"></div>' +
    '</div></div></div>'
  );
  if (!document.getElementById('ba-pulse-style')) {
    var s = document.createElement('style');
    s.id = 'ba-pulse-style';
    s.textContent = '@keyframes baPulse{0%,100%{opacity:.3;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}';
    document.head.appendChild(s);
  }
  scrollToBottom();
}

function removeTyping() {
  var t = document.getElementById('ba-typing');
  if (t) t.remove();
}

function scrollToBottom() {
  var msgs = $ba('ba-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

function setStatus(txt) {
  var el = $ba('ba-status-txt');
  if (el) el.textContent = txt;
}

/* ── Feedback ── */
window.brainAgentFeedback = function(msgId, rating, btn) {
  rqBA('/api/brain-agent/feedback', { method:'POST', body: { message_id: msgId, rating: rating } })
    .then(function(r) {
      if (!r || !r.ok) return;
      // Visually update buttons
      var container = btn.closest('.ba-feedback');
      if (container) {
        container.querySelectorAll('button').forEach(function(b) {
          var isPos = b.textContent.includes('👍');
          var active = (isPos && rating===1) || (!isPos && rating===-1);
          var col = isPos ? '#10B981' : '#EF4444';
          b.style.background = active ? 'rgba(' + (isPos?'16,185,129':'239,68,68') + ',.18)' : 'transparent';
          b.style.borderColor = active ? col : col + '33';
        });
      }
      var fbEl = document.getElementById('ba-fb-' + msgId.replace(/-/g,''));
      if (fbEl) fbEl.textContent = rating===1 ? 'brain +0.3' : 'brain -0.2';
    });
};

/* ── Markdown → HTML ── */
function mdToHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/`([^`]+)`/g,'<code style="background:rgba(124,58,237,.2);padding:1px 5px;border-radius:3px;font-family:monospace;font-size:11px">$1</code>')
    .replace(/\|(.+)\|/g, function(m, row) {
      if (row.replace(/[-| ]/g,'').trim()==='') return '<tr style="border-bottom:1px solid rgba(255,255,255,.06)"></tr>';
      var cells = row.split('|').map(function(c){ return c.trim(); }).filter(function(c){ return c; });
      return '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">' + cells.map(function(c,i){ return i===0 ? '<td style="padding:5px 10px;color:var(--t2);font-size:12px;font-weight:600;white-space:nowrap">' + c + '</td>' : '<td style="padding:5px 10px;color:var(--t1);font-size:12px">' + c + '</td>'; }).join('') + '</tr>';
    })
    .replace(/(<tr[^>]*>.*?<\/tr>)/gms, function(m) {
      if (m.includes('<td')) return '<table style="width:100%;border-collapse:collapse;margin:8px 0;border:1px solid rgba(255,255,255,.08);border-radius:8px;overflow:hidden">' + m + '</table>';
      return m;
    })
    .replace(/^#{1,3} (.+)$/gm,'<div style="font-weight:700;font-size:14px;color:var(--t1);margin:10px 0 5px">$1</div>')
    .replace(/^• (.+)$/gm,'<div style="padding-left:14px;position:relative;margin:3px 0;color:var(--t2)"><span style="position:absolute;left:2px;color:#7C3AED">•</span>$1</div>')
    .replace(/^\d+\. (.+)$/gm,'<div style="padding-left:18px;position:relative;margin:3px 0;color:var(--t2)">$1</div>')
    .replace(/\n\n/g,'<br><br>').replace(/\n/g,'<br>');
}

/* ── Keyboard shortcut ── */
document.addEventListener('keydown', function(e) {
  if (e.key==='k' && (e.metaKey||e.ctrlKey)) {
    e.preventDefault();
    brainAgent.toggle();
  }
});

/* ── Floating trigger button (shows after login) ── */
function injectTriggerBtn() {
  if (document.getElementById('ba-float-btn')) return;
  var btn = document.createElement('button');
  btn.id = 'ba-float-btn';
  btn.title = 'Brain Agent (⌘K)';
  btn.innerHTML = '🧠';
  btn.onclick = function() { brainAgent.toggle(); };
  btn.style.cssText = 'position:fixed;bottom:80px;right:16px;width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#7C3AED,#6D28D9);border:none;color:#fff;font-size:22px;cursor:pointer;z-index:4000;box-shadow:0 4px 20px rgba(124,58,237,.5);display:flex;align-items:center;justify-content:center;transition:transform .2s';
  btn.onmouseover = function(){ this.style.transform='scale(1.1)'; };
  btn.onmouseout  = function(){ this.style.transform='scale(1)'; };
  document.body.appendChild(btn);
}

// Inject trigger after login
var _origEnterAppBA = window.enterApp;
if (typeof _origEnterAppBA === 'function') {
  window.enterApp = function() {
    _origEnterAppBA.apply(this, arguments);
    setTimeout(injectTriggerBtn, 500);
  };
} else {
  document.addEventListener('DOMContentLoaded', function() {
    setTimeout(function() {
      if (G && G.token) injectTriggerBtn();
    }, 1500);
  });
}

})(); // end IIFE

/* ══════════════════════════════════════════════════════════════
   FINANCIAL REPORT GENERATOR
   Accessible via Brain Agent template or standalone call
   ══════════════════════════════════════════════════════════════ */
window.openReportModal = function() {
  var overlay = document.createElement('div');
  overlay.id = 'report-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:6000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(6px)';
  overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

  overlay.innerHTML = '<div style="background:var(--bg1,#0A0B0E);border:1px solid rgba(255,255,255,.1);border-radius:14px;width:min(560px,95vw);max-height:90vh;overflow-y:auto;padding:24px" onclick="event.stopPropagation()">' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">' +
    '<div><div style="font-size:16px;font-weight:700;color:var(--t1,#F0F2FF)">📋 Report Finanziario</div>' +
    '<div style="font-size:11px;color:var(--t3);margin-top:2px">Knowledge Graph + Brain + dati live</div></div>' +
    '<button onclick="this.closest(\'#report-overlay\').remove()" style="background:none;border:none;color:var(--t3);font-size:18px;cursor:pointer">✕</button></div>' +

    '<div style="font-size:10px;font-family:monospace;letter-spacing:.1em;color:var(--t3);margin-bottom:8px">TIPO REPORT</div>' +
    '<div id="report-type-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px"></div>' +

    '<div id="report-params" style="margin-bottom:16px"></div>' +

    '<button onclick="generateFinancialReport()" id="report-gen-btn" style="width:100%;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#7C3AED,#6D28D9);color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit">▶ Genera Report</button>' +

    '<div id="report-output" style="display:none;margin-top:20px;padding:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:10px;font-size:12px;color:var(--t2);line-height:1.75;white-space:pre-wrap;max-height:400px;overflow-y:auto"></div>' +
    '<div id="report-actions" style="display:none;margin-top:10px;display:flex;gap:8px">' +
    '<button onclick="copyReport()" style="flex:1;padding:8px;border-radius:7px;border:1px solid rgba(255,255,255,.1);background:transparent;color:var(--t2);font-size:11px;cursor:pointer;font-family:inherit">📋 Copia</button>' +
    '<button onclick="downloadReport()" style="flex:1;padding:8px;border-radius:7px;border:1px solid rgba(255,255,255,.1);background:transparent;color:var(--t2);font-size:11px;cursor:pointer;font-family:inherit">↓ Download MD</button>' +
    '</div>' +
    '</div>';

  document.body.appendChild(overlay);

  // Load report types
  var h = {};
  if (G.token) h['Authorization'] = 'Bearer ' + G.token;
  fetch('/api/reports/types', { headers: h }).then(function(r) { return r.json(); }).then(function(types) {
    var grid = document.getElementById('report-type-grid');
    if (!grid) return;
    var colors = { portfolio_stress:'#10B981', macro_outlook:'#3B82F6', sector_digest:'#F97316', geo_risk:'#EF4444', weekly_brief:'#7C3AED' };
    grid.innerHTML = types.map(function(t) {
      var col = colors[t.id] || '#7C3AED';
      return '<button onclick="selectReportType(\'' + t.id + '\',this)" data-id="' + t.id + '" style="padding:10px;border-radius:8px;border:1px solid ' + col + '22;background:transparent;color:var(--t2);font-size:11px;cursor:pointer;text-align:left;font-family:inherit;transition:all .15s">' +
        '<div style="font-size:16px;margin-bottom:4px">' + t.icon + '</div>' +
        '<div style="font-weight:600;color:var(--t1)">' + t.label.split(' — ')[0].slice(2) + '</div>' +
        '<div style="font-size:10px;color:var(--t3);margin-top:2px;line-height:1.4">' + t.desc + '</div>' +
        '</button>';
    }).join('');
    // Select weekly_brief by default
    var defaultBtn = grid.querySelector('[data-id="weekly_brief"]');
    if (defaultBtn) selectReportType('weekly_brief', defaultBtn);
  });
};

var _selectedReportType = 'weekly_brief';
window.selectReportType = function(id, btn) {
  _selectedReportType = id;
  var colors = { portfolio_stress:'#10B981', macro_outlook:'#3B82F6', sector_digest:'#F97316', geo_risk:'#EF4444', weekly_brief:'#7C3AED' };
  var col = colors[id] || '#7C3AED';
  document.querySelectorAll('[data-id]').forEach(function(b) {
    var bc = colors[b.dataset.id] || '#7C3AED';
    b.style.background = b === btn ? bc + '15' : 'transparent';
    b.style.borderColor = b === btn ? bc + '60' : bc + '22';
    b.style.color = b === btn ? 'var(--t1)' : 'var(--t2)';
  });
  // Show params panel
  var params = document.getElementById('report-params');
  if (!params) return;
  if (id === 'portfolio_stress') {
    params.innerHTML = '<div style="font-size:10px;font-family:monospace;letter-spacing:.1em;color:var(--t3);margin-bottom:6px">PORTAFOGLIO (ticker,peso%)</div>' +
      '<textarea id="rp-holdings" placeholder="VWCE,60&#10;IBGL,25&#10;XGLD,15" style="width:100%;min-height:80px;padding:8px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:var(--t1,#F0F2FF);font-size:12px;font-family:monospace;resize:none;outline:none"></textarea>';
  } else if (id === 'geo_risk' || id === 'sector_digest') {
    var lbl = id === 'geo_risk' ? 'REGIONE (es. Middle East, Europe, Asia)' : 'SETTORE (es. Technology, Energy, Finance)';
    var ph  = id === 'geo_risk' ? 'Middle East' : 'Technology';
    params.innerHTML = '<div style="font-size:10px;font-family:monospace;letter-spacing:.1em;color:var(--t3);margin-bottom:6px">' + lbl + '</div>' +
      '<input id="rp-focus" placeholder="' + ph + '" style="width:100%;padding:8px 12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:7px;color:var(--t1,#F0F2FF);font-size:12px;outline:none">';
  } else {
    params.innerHTML = '';
  }
};

var _lastReportText = '';
window.generateFinancialReport = async function() {
  var btn = document.getElementById('report-gen-btn');
  var out = document.getElementById('report-output');
  var acts = document.getElementById('report-actions');
  if (!btn || !out) return;

  btn.textContent = '⏳ Generazione in corso…'; btn.disabled = true;

  var params = {};
  if (_selectedReportType === 'portfolio_stress') {
    var raw = (document.getElementById('rp-holdings') || {}).value || 'VWCE,60\nIBGL,25\nXGLD,15';
    params.holdings = raw.split('\n').filter(Boolean).map(function(line) {
      var p = line.split(','); return { ticker: (p[0]||'').trim().toUpperCase(), weight: parseInt(p[1]||50) };
    });
  } else if (_selectedReportType === 'geo_risk') {
    params.region = (document.getElementById('rp-focus') || {}).value || 'Global';
  } else if (_selectedReportType === 'sector_digest') {
    params.sector = (document.getElementById('rp-focus') || {}).value || 'General';
  }

  try {
    var h = { 'Content-Type': 'application/json' };
    if (G.token) h['Authorization'] = 'Bearer ' + G.token;
    var resp = await fetch('/api/reports/generate', {
      method: 'POST', headers: h,
      body: JSON.stringify({ type: _selectedReportType, params: params })
    });
    var r = await resp.json();

    if (resp.ok && r.report) {
      _lastReportText = r.report;
      out.style.display = 'block';
      acts.style.display = 'flex';
      // Render as simple markdown
      out.innerHTML = r.report
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
        .replace(/^#+\s+(.+)$/gm,'<div style="font-weight:700;font-size:14px;color:var(--t1);margin:12px 0 6px">$1</div>')
        .replace(/\|(.+)\|/g, function(m, row) {
          var cells = row.split('|').map(function(c){return c.trim();}).filter(Boolean);
          return '<tr>' + cells.map(function(c,i){return i===0?'<td style="padding:4px 8px;color:var(--t3);font-size:11px;white-space:nowrap">'+c+'</td>':'<td style="padding:4px 8px;color:var(--t1);font-size:11px">'+c+'</td>';}).join('') + '</tr>';
        })
        .replace(/(<tr>[\s\S]*?<\/tr>)/g, '<table style="width:100%;border-collapse:collapse;margin:8px 0;border:1px solid rgba(255,255,255,.08);border-radius:6px;overflow:hidden">$1</table>')
        .replace(/^• (.+)$/gm,'<div style="padding-left:12px;position:relative;margin:2px 0"><span style="position:absolute;left:0;color:#7C3AED">•</span>$1</div>')
        .replace(/\n/g,'<br>');
    } else {
      out.style.display = 'block';
      out.textContent = 'Errore: ' + ((r && r.detail) || 'Generazione fallita');
    }
  } catch(e) {
    out.style.display = 'block';
    out.textContent = 'Errore di rete: ' + e.message;
  }

  btn.textContent = '▶ Genera Report'; btn.disabled = false;
};

window.copyReport = function() {
  if (!_lastReportText) return;
  navigator.clipboard.writeText(_lastReportText).then(function() {
    if (typeof showToast === 'function') showToast('Report copiato!', 'ok');
  });
};

window.downloadReport = function() {
  if (!_lastReportText) return;
  var blob = new Blob([_lastReportText], { type: 'text/markdown' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'worldlens_report_' + new Date().toISOString().slice(0,10) + '.md';
  a.click();
};

/* ══════════════════════════════════════════════════════════════
   BRAIN DIGEST DASHBOARD CARD
   Layer 2 summaries + Layer 4 digest items
   ══════════════════════════════════════════════════════════════ */
window.loadBrainDigest = function() {
  if (!G.token) return;
  var section = document.getElementById('brain-digest-section');

  // Fetch digest items (Layer 4)
  rq('/api/brain/digest?limit=6').then(function(r) {
    if (!r || !r.items) return;
    var items = r.items;
    var unread = r.unread || 0;

    // Show section if we have content
    if (items.length > 0 && section) {
      section.style.display = '';
    }

    // Badge
    var badge = document.getElementById('brain-digest-badge');
    if (badge) {
      if (unread > 0) {
        badge.style.display = 'inline';
        badge.textContent = unread + ' nuovi';
      } else {
        badge.style.display = 'none';
      }
    }

    // Render digest items
    var el = document.getElementById('brain-digest-items');
    if (!el) return;
    if (!items.length) {
      el.innerHTML = '<div style="font-size:12px;color:var(--fire-text-dim);padding:12px 0">Nessun digest disponibile — il cervello genererà analisi automatiche man mano che apprende.</div>';
      return;
    }

    var typeColors = {
      topic_digest:     '#7C3AED',
      connection_alert: '#3B82F6',
      drift_alert:      '#F59E0B',
    };
    var typeIcons = {
      topic_digest:     '📊',
      connection_alert: '🔗',
      drift_alert:      '⚡',
    };

    el.innerHTML = items.map(function(item) {
      var col = typeColors[item.digest_type] || '#7C3AED';
      var dimmed = item.read ? 'opacity:.55;' : '';
      return '<div style="padding:14px 16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-left:3px solid ' + col + ';border-radius:10px;' + dimmed + '">' +
        '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px">' +
        '<div style="font-size:13px;font-weight:700;color:var(--t1,#F0F2FF);line-height:1.4">' + item.title + '</div>' +
        (!item.read ? '<button onclick="markDigestRead(' + item.id + ',this)" style="flex-shrink:0;padding:2px 8px;border-radius:20px;border:1px solid rgba(255,255,255,.1);background:transparent;color:var(--t3);font-size:10px;cursor:pointer;font-family:inherit">✓ letto</button>' : '') +
        '</div>' +
        '<div style="font-size:12px;color:var(--t2,#A0A8C0);margin-top:6px;line-height:1.7">' + item.body + '</div>' +
        '<div style="font-size:10px;color:var(--t3);margin-top:8px;font-family:monospace">' +
        (item.created_at || '').slice(0,16) + ' · ' + (item.topic || item.digest_type) +
        '</div></div>';
    }).join('');
  });

  // Fetch topic summaries (Layer 2)
  rq('/api/brain/summaries').then(function(summaries) {
    if (!summaries) return;
    var keys = Object.keys(summaries);
    if (!keys.length) return;

    if (section) section.style.display = '';
    var el = document.getElementById('brain-summaries-row');
    if (!el) return;

    var topicColors = {
      finance: '#10B981', macro: '#3B82F6', security: '#EF4444',
      tech: '#8B5CF6', energy: '#F59E0B', politics: '#EC4899',
      geopolitics: '#F97316', trade: '#06B6D4',
    };
    var topicIcons = {
      finance: '📈', macro: '🌐', security: '🛡', tech: '💻',
      energy: '⚡', politics: '🏛', geopolitics: '🌍', trade: '🔄',
    };

    el.innerHTML = keys.slice(0, 4).map(function(topic) {
      var s = summaries[topic];
      var col = topicColors[topic] || '#7C3AED';
      var icon = topicIcons[topic] || '🧠';
      return '<div style="padding:14px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-top:2px solid ' + col + ';border-radius:10px">' +
        '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">' +
        '<span style="font-size:16px">' + icon + '</span>' +
        '<span style="font-size:11px;font-weight:700;letter-spacing:.06em;color:' + col + ';text-transform:uppercase">' + topic + '</span>' +
        '<span style="font-size:9px;color:var(--t3);margin-left:auto;font-family:monospace">' + (s.count || 0) + ' entries</span>' +
        '</div>' +
        '<div style="font-size:12px;color:var(--t2);line-height:1.7">' + (s.summary || '') + '</div>' +
        '</div>';
    }).join('');
  });
};

window.markDigestRead = function(id, btn) {
  rq('/api/brain/digest/' + id + '/read', { method: 'POST' }).then(function() {
    var card = btn.closest('div[style*="border-left"]');
    if (card) card.style.opacity = '.55';
    btn.remove();
  });
};

// Load digest after login
(function() {
  var _orig = window.enterApp;
  if (typeof _orig === 'function') {
    window.enterApp = function() {
      _orig.apply(this, arguments);
      setTimeout(function() {
        loadBrainDigest();
        // Trigger digest generation if brain has enough entries
        if (G.brainStats && G.brainStats.total_entries >= 10) {
          rq('/api/brain/digest/trigger', { method: 'POST' });
        }
      }, 3000);
    };
  }
})();
