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
    var tid = setTimeout(function() { if (ctrl) ctrl.abort(); resolve({}); }, 12000);
    fetch(url, {
      method:  opts.method || 'GET',
      headers: headers,
      body:    opts.body ? JSON.stringify(opts.body) : undefined,
      signal:  ctrl ? ctrl.signal : undefined
    }).then(function(r) {
      clearTimeout(tid);
      if (r.status === 401) { G.token = null; localStorage.removeItem('wl_tok'); resolve({detail: 'Unauthorized'}); return; }
      return r.json();
    }).then(function(data) { resolve(data || {}); })
      .catch(function(e)  { clearTimeout(tid); resolve({}); });
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
  rq('/api/auth/login',{method:'POST',body:{email:e,password:p}}).then(function(r) {
    if (!r || r.detail) { el('ler').textContent = r&&r.detail?r.detail:'Login failed'; return; }
    G.token = r.access_token; G.user = r.user;
    localStorage.setItem('wl_tok', r.access_token);
    track('login', 'auth', r.user.email || '');
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
  var body = { username: n, email: e, password: p };
  if (code) body.invite_code = code;
  rq('/api/auth/register', { method:'POST', body: body }).then(function(r) {
    if (!r || r.detail) {
      el('rer').textContent = r && r.detail ? r.detail : 'Registration failed';
      return;
    }
    G.token = r.access_token;
    G.user  = r.user;
    G.isNewUser = true;
    localStorage.setItem('wl_tok', r.access_token);
    track('register', 'auth', r.user.email || '');
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
    if (typeof loadSavedIds    === 'function') loadSavedIds();
    if (typeof refreshAffinity === 'function') refreshAffinity();
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
      if (G.isNewUser || (G.userProfile && !G.userProfile.onboarding_done)) {
        setTimeout(startOnboarding, 700);
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
    } catch(ex) {}
  };
  setInterval(function(){ if(G.ws&&G.ws.readyState===1) G.ws.send('ping'); }, 25000);
}

// ── MAP ───────────────────────────────────────────────
