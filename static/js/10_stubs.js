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
  var box = document.getElementById('macro-brief');
  var txt = document.getElementById('macro-brief-txt');
  if (!box || !txt) return;
  box.style.display = 'block';
  txt.innerHTML = '<span class="aiload"><span class="ald"></span><span class="ald"></span><span class="ald"></span> Generating...</span>';
  rq('/api/intelligence/macro-brief').then(function(r) {
    txt.textContent = (r && (r.brief || r.content)) || 'Macro briefing unavailable.';
  });
  track('macro_brief_requested', 'macro', '');
}

function loadMacroBrief() { getMacroBrief(); }

// ── Onboarding ─────────────────────────────────────────────────

var OB = { step:0, data:{} };
var OB_STEPS = [
  { title:'Welcome to WorldLens',  sub:'Your global intelligence platform',
    body:'<p style="color:var(--t2);font-size:12px;line-height:1.7">WorldLens gives you live geopolitical events, financial markets, AI analysis, and dependency cascades in one place.</p>' },
  { title:'Your Focus Areas',      sub:'What topics matter to you?',        body:'<div id="ob-interests"></div>' },
  { title:'Your Regions',          sub:'Which regions do you monitor?',     body:'<div id="ob-regions"></div>'  },
  { title:'Risk Appetite',         sub:'How do you invest?',                body:'<div id="ob-risk"></div>'     },
  { title:'Navigation',            sub:'Find your way around',
    body:'<p style="color:var(--t2);font-size:12px;line-height:1.7">Use the left sidebar to switch between Map, Feed, Graph, Markets, and AI Analyst.</p>' },
  { title:"You are All Set!",      sub:'Welcome aboard',
    body:'<p style="color:var(--t2);font-size:12px;line-height:1.7">Your dashboard is now personalised. Explore the live map or ask the AI Analyst anything.</p>' },
];

function startOnboarding() {
  var ov = document.getElementById('ob-overlay');
  if (!ov) return;
  OB.step = 0; OB.data = {};
  ov.style.display = 'flex';
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
  var back = document.getElementById('ob-back'); if (back) back.style.visibility = OB.step>0?'visible':'hidden';
  var next = document.getElementById('ob-next'); if (next) next.textContent = OB.step===OB_STEPS.length-1?'Start Exploring':'Next';
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
  var ov=document.getElementById('ob-overlay'); if (ov) ov.style.display='none';
  rq('/api/user/profile',{method:'PUT',body:{onboarding_done:1}});
}
function _obFinish() {
  var ov=document.getElementById('ob-overlay'); if (ov) ov.style.display='none';
  rq('/api/user/complete-onboarding',{method:'POST',body:{interests:OB.data.interests||[],regions:OB.data.regions||[],market_prefs:OB.data.interests||[],experience_level:(OB.data.risk==='Speculative'||OB.data.risk==='Aggressive')?'advanced':'beginner'}}).then(function(r){
    if (r && !r.detail && G.userProfile) { G.userProfile.onboarding_done=1; G.userProfile.interests=OB.data.interests||[]; G.userProfile.regions=OB.data.regions||[]; }
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
      var answer  = (r && (r.answer || r.response)) || 'AI analysis not available. Configure a provider in Admin -> Settings.';
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

function loadEarlyWarning() {
  rq('/api/intelligence/early-warning').then(function(r) {
    if (!r) return;
    var s = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
    var score = r.global_ew_score || r.score || 5;
    s('ew-score', score.toFixed(1));
    s('ew-label', score>=7?'HIGH RISK':score>=5?'ELEVATED':'STABLE');
    s('ew-assess', r.ai_assessment || r.assessment || '');
    s('ew-evcount', r.event_count || '');
    var scoreEl = document.getElementById('ew-score');
    if (scoreEl) scoreEl.style.color = score>=7?'var(--re)':score>=5?'var(--am)':'var(--gr)';
    // Gauges
    var gauges = { macro: r.macro_stress, market: r.market_stress, sent: r.sentiment_trend, vel: r.event_velocity };
    Object.keys(gauges).forEach(function(k) {
      var val = gauges[k] || 0;
      var pct = Math.min(100, Math.max(0, (val/10)*100));
      var bar = document.getElementById('ewgb-'+k); if (bar) bar.style.width = pct+'%';
      var lbl = document.getElementById('ewg-'+k);  if (lbl) lbl.textContent = val.toFixed(1);
    });
    loadEWSignals();
  });
  track('early_warning_viewed', 'earlywarning', '');
}

function loadEWSignals() {
  rq('/api/intelligence/signals/active').then(function(r) {
    var el2 = document.getElementById('ew-signals');
    var cnt = document.getElementById('ew-signal-count');
    if (!el2 || !r || !r.signals) return;
    var signals = r.signals || [];
    if (cnt) cnt.textContent = signals.length;
    el2.innerHTML = signals.length ? signals.map(function(sig) {
      var col = sig.severity>=7?'var(--re)':sig.severity>=5?'var(--am)':'var(--gr)';
      return '<div style="padding:10px 12px;background:var(--bg2);border:1px solid var(--bd);border-radius:8px;margin-bottom:6px">'
        + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
        + '<span style="font-size:10px;font-weight:700;color:'+col+'">'+sig.signal_type+'</span>'
        + '<span style="font-size:9px;color:var(--t3)">'+sig.region+'</span>'
        + '<span style="margin-left:auto;font-size:10px;font-weight:700;color:'+col+'">'+sig.severity.toFixed(1)+'</span>'
        + '</div>'
        + '<div style="font-size:10px;color:var(--t2);line-height:1.5">'+(sig.description||'').slice(0,120)+'</div>'
        + '</div>';
    }).join('') : '<div style="font-size:11px;color:var(--t3);text-align:center;padding:24px">No active signals</div>';
  });
}
