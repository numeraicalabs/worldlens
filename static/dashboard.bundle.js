/** WorldLens v21 — DASHBOARD BUNDLE */
/* Files: 04_events.js 21_agents_dash.js 23_dash_globe.js 31_dash_v2.js 32_dash_ew.js 34_swipe_dash.js */


/* ═══════════ 04_events.js ═══════════ */
/**
 * @file 04_events.js
 * @module WorldLens/Event Panel & Dashboard
 *
 * @description
 * Event detail panel, AI analysis buttons, sentiment display,
 * market impact modal, view switching (sv), category filters,
 * dashboard widgets, intelligence ticker, feed, personalisation.
 *
 * @dependencies 01_globals.js, 02_core.js, 03_map.js
 * @exports openEP, closeEP, sv, runSentiment, showImpact, renderSentimentPanel, renderImpactModal, scoreEvent, panelAI
 */


function panelAI(prompt) {
  var ev = G.panelEv; if (!ev) return;
  track('event_ai_analysis', 'map', (ev.id||'') + '|' + (prompt||'default'));
  var ans = el('panelans');
  ans.classList.add('on');
  ans.innerHTML = '<span class="aiload"><span class="ald"></span><span class="ald"></span><span class="ald"></span> Analyzing...</span>';
  var ctx = 'Event: '+ev.title+'\nRegion: '+(ev.country_name||ev.country_code)+'\nCategory: '+ev.category+'\nImpact: '+ev.impact+'\nSeverity: '+ev.severity+'\nSummary: '+(ev.summary||'N/A');
  rq('/api/events/ai/ask',{method:'POST',body:{question:prompt,context:ctx}}).then(function(r) {
    ans.textContent = (r&&r.answer) ? r.answer
    : (r&&r.error) ? r.error
    : 'No response — check Gemini key is saved in Admin → Settings.';
  });
  rq('/api/portfolio/track',{method:'POST',body:{action:'ai_query'}});
}
// ── Sentiment analysis (event panel) ─────────────────────
var G_SENT = {};
function runSentiment() {
  var ev = G.panelEv; if (!ev) return;
  if (G_SENT[ev.id]) { renderSentimentPanel(G_SENT[ev.id]); return; }
  if (ev.sentiment_tone) {
    var cached = { score: ev.sentiment_score, tone: ev.sentiment_tone,
      intensity: ev.sentiment_intensity, info_type: ev.sentiment_info_type,
      entity_sentiments: [] };
    try { cached.entity_sentiments = JSON.parse(ev.sentiment_entities||'[]'); } catch(e){}
    G_SENT[ev.id] = cached; renderSentimentPanel(cached); return;
  }
  var sec = el('ep-sentiment');
  if (sec) sec.style.display = 'block';
  var badge = el('ep-sent-badge');
  if (badge) { badge.textContent = 'Analyzing…'; badge.className = 'sent-badge sent-neu'; }
  rq('/api/events/sentiment/'+ev.id, {method:'POST'}).then(function(r) {
    if (!r || r.detail) { if (badge) badge.textContent = 'Failed'; return; }
    G_SENT[ev.id] = r; ev.sentiment_tone = r.tone; ev.sentiment_score = r.score;
    renderSentimentPanel(r);
  });
}

// ── Show market impact ────────────────────────────────────
var G_IMPACT = {};
function showImpact() {
  var ev = G.panelEv; if (!ev) return;
  showImpactForId(ev.id);
}
function showImpactForId(eventId) {
  var ev = G.events.find(function(e){return e.id===eventId;}); if (!ev) return;
  if (G_IMPACT[eventId]) { renderImpactModal(G_IMPACT[eventId], ev); return; }
  var modal = el('impact-modal');
  if (modal) { modal.classList.add('on'); }
  var body = el('imp-body');
  if (body) body.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3)">Generating impact analysis…</div>';
  var titleEl = el('imp-title'); if (titleEl && ev) titleEl.textContent = ev.title || '';
  rq('/api/events/impact/'+eventId, {method:'POST'}).then(function(r) {
    if (!r || r.error) {
      if (body) body.innerHTML = '<div style="padding:20px;color:var(--t3)">Analysing… if this persists check Gemini key in Admin → Settings.</div>';
      return;
    }
    G_IMPACT[eventId] = r; renderImpactModal(r, ev);
  });
}
function renderImpactModal(r, ev) {
  var body = el('imp-body'); if (!body) return;
  var mag = r.overall_magnitude || 5;
  var magCol = mag >= 7 ? 'var(--re)' : mag >= 4 ? 'var(--am)' : 'var(--gr)';
  var html = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">'
    + '<div style="font-size:28px;font-weight:800;color:'+magCol+'">'+mag.toFixed(1)+'<span style="font-size:12px;color:var(--t3)">/10</span></div>'
    + '<div><div style="font-weight:700;font-size:13px">'+( r.magnitude_label||'')+'</div>'
    + '<div style="font-size:10px;color:var(--t3)">Overall impact magnitude</div></div></div>';
  if (r.key_insight) html += '<div style="font-size:11px;color:var(--t2);margin-bottom:10px;line-height:1.6">'+r.key_insight+'</div>';
  var renderItems = function(items, label) {
    if (!items || !items.length) return '';
    var s = '<div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px">'+label+'</div>';
    s += items.slice(0,4).map(function(it) {
      var col = it.direction==='positive'?'var(--gr)':it.direction==='negative'?'var(--re)':'var(--t2)';
      var arr = it.direction==='positive'?'▲':it.direction==='negative'?'▼':'●';
      return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
        +'<span style="color:'+col+';font-size:14px">'+arr+'</span>'
        +'<div style="flex:1"><div style="font-size:11px;font-weight:600">'+it.instrument+'</div>'
        +(it.reasoning?'<div style="font-size:9px;color:var(--t3)">'+it.reasoning+'</div>':'')+'</div>'
        +'<div style="text-align:right"><div style="font-size:10px;color:'+col+'">'+it.estimate+'</div>'
        +'<div style="font-size:8px;color:var(--t3)">'+it.timeframe+'</div></div></div>';
    }).join('');
    return s;
  };
  html += renderItems(r.short_term, 'Short-Term Impact (1–7 days)');
  html += '<div style="height:8px"></div>';
  html += renderItems(r.long_term,  'Long-Term Impact (1–3 months)');
  if (r.historical_precedent) {
    html += '<div style="margin-top:10px;padding:8px 10px;background:rgba(59,130,246,.08);border-radius:8px;font-size:10px;color:var(--t2)">📚 '+r.historical_precedent+'</div>';
  }
  body.innerHTML = html;
}
function closeImpact() {
  var modal = el('impact-modal'); if (modal) modal.classList.remove('on');
}

function scoreEvent() {
  var ev = G.panelEv; if (!ev) return;
  track('event_scored', 'map', ev.id||'');
  var ans = el('panelans');
  ans.classList.add('on');
  ans.innerHTML = '<span class="aiload"><span class="ald"></span><span class="ald"></span><span class="ald"></span> Scoring...</span>';
  rq('/api/events/ai/score/'+ev.id,{method:'POST'}).then(function(r) {
    if (r&&r.impact_score) {
      ev.ai_impact_score = r.impact_score;
      ev.ai_market_note = r.market_effects||'';
      ans.textContent = r.summary+(r.investor_action?'\n\nAction: '+r.investor_action:'');
      xpPop(10, 'Event scored!');
      rq('/api/portfolio/track',{method:'POST',body:{action:'event_score'}});
    } else {
      ans.textContent = 'No response — verify Gemini key is saved in Admin → Settings.';
    }
  });
}
function watchEv() {
  var ev = G.panelEv; if (!ev) return;
  track('watchlist_add_from_event', 'map', ev.id||'');
  if (ev.country_code&&ev.country_code!=='XX') {
    rq('/api/user/watchlist',{method:'POST',body:{type:'country',value:ev.country_code,label:ev.country_name||ev.country_code}}).then(function(){ loadUD().then(renderProfile); });
    toast('Added '+(ev.country_name||ev.country_code)+' to watchlist','s');
  }
}

// ── VIEW SWITCHING ────────────────────────────────────
function sv(name, btn) {
  document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('on'); });
  document.querySelectorAll('.ni[data-v]').forEach(function(b){ b.classList.remove('on'); });
  var el2 = document.getElementById('view-'+name);
  if (el2) { el2.classList.add('on'); console.log('[sv] added .on to view-'+name+' | el found:',!!el2,'| classList:',el2.className); }
  else { console.warn('[sv] ELEMENT NOT FOUND: view-'+name); }
  if (btn) btn.classList.add('on');
  G.currentView = name;
  /* Always close event panel + backdrop when switching views */
  if (typeof closeEP === 'function') closeEP();
  track('section_opened', name, name);
  if (name==='map') {
    requestAnimationFrame(function() {
      requestAnimationFrame(function() {
        if (!G.mapReady) initMap();
        else { G.map.invalidateSize(); updateMarkers(); }
      });
    });
  }
  if (name==='profile') renderProfile();
  if (name==='alerts') renderAlerts();
  if (name==='gamification') { loadGamification(); loadMissions(); loadPredictions(); }
  if (name==='macro') { renderMacro(); loadRegionRisks(); }
  if (name==='portfolio') loadPortfolios();
  if (name==='feed') track('feed_opened', 'feed', '');
  if (name==='graph') track('graph_opened', 'graph', '');
  if (name==='markets') {
    // Redirect to Finance Hub → Mercati tab
    var portBtn = document.querySelector('[data-v=portfolio]');
    var mktBtn  = document.querySelector('[data-tab=mercati]');
    var portEl  = document.getElementById('view-portfolio');
    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('on'); });
    document.querySelectorAll('.ni[data-v]').forEach(function(b){ b.classList.remove('on'); });
    if (portEl) portEl.classList.add('on');
    if (portBtn) portBtn.classList.add('on');
    G.currentView = 'portfolio';
    fhTab('mercati', mktBtn);
    track('markets_opened', 'markets', '');
    return;
  }
  if (name==='insiders') {
    // Redirect to Finance Hub → Intelligenza tab
    var portBtn2 = document.querySelector('[data-v=portfolio]');
    var intBtn   = document.querySelector('[data-tab=intelligenza]');
    var portEl2  = document.getElementById('view-portfolio');
    document.querySelectorAll('.view').forEach(function(v){ v.classList.remove('on'); });
    document.querySelectorAll('.ni[data-v]').forEach(function(b){ b.classList.remove('on'); });
    if (portEl2) portEl2.classList.add('on');
    if (portBtn2) portBtn2.classList.add('on');
    G.currentView = 'portfolio';
    fhTab('intelligenza', intBtn);
    track('insiders_opened', 'insiders', '');
    return;
  }
  if (name==='ai') track('ai_opened', 'ai', '');
  if (name==='tradgentic') {
    if (typeof initTradgentic === 'function') initTradgentic();
  }
  if (name==='admin') {
    if (typeof enterAdmin === 'function') enterAdmin();
  }
  if (name==='earlywarning') {
    var attempt = 0;
    var tryLoad = function() {
      if (typeof loadEarlyWarning === 'function') {
        try { loadEarlyWarning(); }
        catch (e) { if(e && e.name !== 'AbortError') console.warn('[EW] loadEarlyWarning:', e && e.message || e); }
      } else if (attempt++ < 10) {
        setTimeout(tryLoad, 200);
      } else {
        console.warn('[EW] loadEarlyWarning function never appeared');
      }
    };
    tryLoad();
  }
  if (name==='ai') {
    // Load AI analyst fresh data when navigating to AI page
    if (typeof loadMacroBrief === 'function') loadMacroBrief();
  }
}

// ── CAT FILTERS INIT ──────────────────────────────────
function initCats() {
  var mc = el('mcats'), fc = el('feedcats');
  Object.keys(CATS).forEach(function(cat) {
    var m = CATS[cat];
    if (mc) {
      var p = document.createElement('div');
      p.className='cpill on'; p.dataset.c=cat; p.title=cat;
      p.style.color=m.c; p.style.borderColor=m.c+'55';
      p.innerHTML = m.i;
      p.onclick = function(){ p.classList.toggle('on'); updateMarkers(); };
      mc.appendChild(p);
    }
    if (fc) {
      var fc2 = document.createElement('div');
      fc2.className='fc'; fc2.dataset.cat=cat; fc2.innerHTML=m.i+' '+cat;
      fc2.onclick = function(){ sf('cat',G.filt.cat===cat?null:cat,fc2); };
      fc.appendChild(fc2);
    }
  });
}

// ── DASHBOARD ─────────────────────────────────────────
function updateRiskUI() {
  var r = G.stats.global_risk_index||0;
  var rc = r>60?'#EF4444':r>35?'#F59E0B':'#60A5FA';
  var mRisk = el('m-risk'); if (mRisk) { mRisk.textContent = r.toFixed(0); mRisk.style.color = rc; }
  var mRiskb = el('m-riskb'); if (mRiskb) { mRiskb.style.width = Math.min(100,r)+'%'; mRiskb.style.background = rc; }
  var mRiskl = el('m-riskl'); if (mRiskl) { mRiskl.textContent = r>60?'CRITICAL':r>35?'ELEVATED':'STABLE'; mRiskl.style.color = rc; }
  // Update mobile crisis badge with high-severity event count
  if (typeof updateMobileBadges === 'function' && G.events) {
    var highSev = G.events.filter(function(e){ return (e.severity||0) >= 6; }).length;
    updateMobileBadges({ crisisCount: highSev });
  }
  // Update mobile greeting card
  _updateMobileGreeting(r);
}

function _updateMobileGreeting(riskScore) {
  var nameEl   = document.getElementById('mobile-greeting-name');
  var statusEl = document.getElementById('mobile-greeting-status');
  var timeEl   = document.getElementById('mobile-greeting-time');
  if (!nameEl) return;

  // Day + time
  var days = ['DOMENICA','LUNEDÌ','MARTEDÌ','MERCOLEDÌ','GIOVEDÌ','VENERDÌ','SABATO'];
  var now  = new Date();
  var hour = now.getHours();
  var greeting = hour < 12 ? 'Buongiorno' : hour < 18 ? 'Buon pomeriggio' : 'Buonasera';
  if (timeEl) timeEl.textContent = days[now.getDay()] + ' ' + now.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'});

  // Name from profile
  var name = (G.userProfile && (G.userProfile.display_name || G.userProfile.email || '').split('@')[0]) || '';
  nameEl.textContent = name ? greeting + ', ' + name : greeting;

  // Status line from risk level
  var r = parseFloat(riskScore) || (G.stats && G.stats.global_risk_index) || 0;
  var statusText, statusColor;
  if (r > 65) {
    statusText = 'Rischio CRITICO — ' + (G.events ? G.events.length : 0) + ' eventi monitorati';
    statusColor = '#ff5722';
  } else if (r > 35) {
    statusText = 'Rischio ELEVATO — attenzione richiesta';
    statusColor = '#ffc107';
  } else {
    statusText = 'Situazione stabile — ' + (G.events ? G.events.length : 0) + ' eventi in corso';
    statusColor = '#66bb6a';
  }
  if (statusEl) {
    statusEl.textContent = statusText;
    statusEl.style.color = statusColor;
  }
}
function renderDash() {
  var st   = G.stats || {};
  var risk = st.global_risk_index || 0;
  var rc   = risk>60?'var(--re)':risk>35?'var(--am)':'var(--gr)';

  // Trigger intel cards load when dashboard renders with events
  if(typeof loadIntelCards === 'function' && !_intelCache){
    setTimeout(loadIntelCards, 800);
  }

  // Greeting time-of-day
  var hr = new Date().getHours();
  var greet = hr<12?'Good morning':hr<17?'Good afternoon':'Good evening';
  setEl('db-time-label', greet);
  var upd = el('d-last-update');
  if (upd) upd.textContent = 'Updated ' + new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

  // KPI: Global Risk Index
  var riskEl = el('d-risk');
  if (riskEl) { riskEl.textContent = risk.toFixed(0); riskEl.style.color = rc; }
  var riskBar = el('d-risk-b');
  if (riskBar) { riskBar.style.width = Math.min(100,risk)+'%'; riskBar.style.background = rc; }
  setEl('d-risk-l', risk>60?'Critical — High Alert':risk>35?'Elevated — Monitor':'Stable');

  // KPI: Events
  setEl('d-ev', st.last_24h||'—');
  var hiEl = el('d-hi');
  if (hiEl) { hiEl.textContent = (st.high_impact_24h||0)+' critical'; hiEl.style.color='var(--re)'; }

  updateRiskUI();

  // Personalized event list
  var p   = G.userProfile||{};
  // Use personalized events if user has set preferences or has activity data
  var _hasPrefs = p.onboarding_done && ((p.interests||[]).length+(p.regions||[]).length > 0);
  var _hasAffinity = G_affinity && Object.keys(G_affinity).length > 0;
  var baseEvs = (_hasPrefs || _hasAffinity) ? getPersonalizedEvents() : G.events;

  // Apply adaptive severity threshold
  var _minSev = p.severity_threshold ||
    ({ beginner:5.5, intermediate:4.5, advanced:3.0 }[p.experience_level||'intermediate'] || 4.5);
  var evs = baseEvs.filter(function(e){ return (e.severity||0) >= _minSev; });

  // If filter is too aggressive, fall back to top events
  if (evs.length < 5) evs = G.events.slice();
  evs = evs.slice().sort(function(a,b){ return b.severity-a.severity; });

  // Events list — redesigned rows with severity badge
  var evListEl = el('d-evlist');
  if (evListEl) {
    evListEl.innerHTML = evs.slice(0,9).map(function(ev) {
      var m    = CATS[ev.category]||CATS.GEOPOLITICS;
      var sev  = ev.severity||5;
      var sevC = sev>=7?'#EF4444':sev>=5?'#F59E0B':'#10B981';
      var sevBg= sev>=7?'rgba(239,68,68,.12)':sev>=5?'rgba(245,158,11,.12)':'rgba(16,185,129,.12)';
      var cname= ev.country_name||ev.country_code||'Global';
      return '<div class="db-ev-row" data-eid="'+ev.id+'">'
        +'<div class="db-ev-sev-badge" style="background:'+sevBg+';color:'+sevC+'">'+sev.toFixed(0)+'</div>'
        +'<div class="db-ev-body">'
        +'<div class="db-ev-title">'+ev.title+'</div>'
        +'<div class="db-ev-meta">'
        +'<span class="db-ev-cat" style="background:'+m.c+'22;color:'+m.c+'">'+m.i+' '+ev.category.slice(0,6)+'</span>'
        +'<span>'+cname+'</span>'
        +'<span>'+tAgo(new Date(ev.timestamp))+'</span>'
        +'</div></div></div>';
    }).join('');
    evListEl.querySelectorAll('[data-eid]').forEach(function(row) {
      row.onclick = function() {
        var eid = this.dataset.eid;
        sv('map', document.querySelector('[data-v=map]'));
        setTimeout(function(){ openEP(eid); }, 600);
      };
    });
  }

  // Crisis Spotlight, Ticker, Threat Matrix, Risk Timeline
  renderCrisisSpotlight(evs);
  renderTicker(evs);
  renderThreatMatrix(evs);
  renderRiskTimeline(evs);

  // Hotspots
  var hotEl = el('d-hot');
  if (hotEl) {
    hotEl.innerHTML = (st.hotspots||[]).slice(0,8).map(function(h) {
      var sev = h.avg_severity||5;
      var col = sev>=7?'var(--re)':sev>=5?'var(--am)':'var(--gr)';
      var mapBtn = "sv('map',document.querySelector('[data-v=map]'))";
      return '<div class="db-hot-chip" onclick="'+mapBtn+'">'
        +'<div class="db-hot-name">'+h.name+'</div>'
        +'<div class="db-hot-meta" style="color:'+col+'">'+h.count+' events · avg '+sev.toFixed(1)+'</div>'
        +'<div class="db-hot-bar" style="background:'+col+';width:'+Math.min(100,(sev/10)*100)+'%"></div>'
        +'</div>';
    }).join('');

  }
  // Category bars
  var bycat  = st.by_category||{};
  var total  = Object.values(bycat).reduce(function(a,b){return a+b;},0)||1;
  var sorted = Object.entries(bycat).sort(function(a,b){return b[1]-a[1];}).slice(0,7);
  var catEl  = el('d-catbars');
  if (catEl) {
    catEl.innerHTML = sorted.map(function(kv) {
      var m   = CATS[kv[0]]||CATS.GEOPOLITICS;
      var pct = (kv[1]/total*100).toFixed(0);
      return '<div class="cat-bar-row">'
        +'<div class="cat-bar-lbl" style="color:'+m.c+'">'+m.i+' '+kv[0].slice(0,8)+'</div>'
        +'<div class="cat-bar-bg"><div class="cat-bar-fg" style="width:'+pct+'%;background:'+m.c+'"></div></div>'
        +'<div class="cat-bar-n">'+kv[1]+'</div></div>';
    }).join('');
  }

  updateDashFin();
}


// ── INTELLIGENCE TICKER ────────────────────────────────
function renderTicker(evs) {
  var track = el('ticker-track');
  if (!track || !evs.length) return;
  var items = evs.slice(0,12);
  // Duplicate for seamless loop
  var html = '';
  for (var pass = 0; pass < 2; pass++) {
    items.forEach(function(ev) {
      var m = CATS[ev.category]||CATS.GEOPOLITICS;
      var eid = ev.id;
      html += '<div class="ticker-item" data-eid="'+eid+'">' 
        +'<span class="ticker-item-cat" style="background:'+m.c+'22;color:'+m.c+'">'+ev.category.slice(0,4)+'</span>'
        +'<span>'+ev.title.slice(0,55)+(ev.title.length>55?'...':'')+'</span>'
        +'<span class="ticker-item-sev" style="color:'+m.c+'">'+ev.severity.toFixed(1)+'</span>'
        +'</div>'
        +'<span class="ticker-separator">&bull;</span>';
    });
  }
  track.innerHTML = html;
  // Add delegated click to ticker items
  track.querySelectorAll('[data-eid]').forEach(function(item) {
    item.onclick = function() {
      var eid = this.dataset.eid;
      sv('map', document.querySelector('[data-v=map]'));
      setTimeout(function(){ openEP(eid); }, 400);
    };
  });
  // Adjust animation speed based on content width
  var speed = Math.max(40, items.length * 6);
  track.style.animationDuration = speed + 's';
}

// ── CRISIS SPOTLIGHT ──────────────────────────────────
function renderCrisisSpotlight(evs) {
  var spotlight = el('crisis-spotlight');
  if (!spotlight || !evs.length) return;
  // Find the single highest-severity event
  var ev = evs.slice().sort(function(a,b){return b.severity-a.severity;})[0];
  if (!ev || ev.severity < 5) { spotlight.style.display = 'none'; return; }
  spotlight.style.display = 'block';
  var m = CATS[ev.category]||CATS.GEOPOLITICS;
  setEl('cs-title', ev.title);
  setEl('cs-summary', ev.ai_summary||ev.summary||'');
  var sev = ev.severity;
  setEl('cs-sev', sev.toFixed(1));
  el('cs-sev-bar').style.width = (sev*10)+'%';
  // Meta
  el('cs-meta').innerHTML =
    '<div class="cs-meta-item">'+m.i+' '+ev.category+'</div>'
    +'<div class="cs-meta-item">📍 '+(ev.country_name||ev.country_code)+'</div>'
    +'<div class="cs-meta-item">🕐 '+tAgo(new Date(ev.timestamp))+'</div>'
    +'<span class="tag tag'+ev.impact[0]+'">'+ev.impact+'</span>';
  // Markets
  var mkts = [];
  try { mkts = typeof ev.related_markets==='string'?JSON.parse(ev.related_markets||'[]'):(ev.related_markets||[]); } catch(e){}
  el('cs-markets').innerHTML = mkts.slice(0,4).map(function(t){ return '<span class="cs-market-tag">'+t+'</span>'; }).join('');
  // Other critical events
  var others = evs.filter(function(e){return e.id!==ev.id&&e.impact==='High';}).slice(0,3);
  el('cs-others').innerHTML = others.map(function(o){
    var om = CATS[o.category]||CATS.GEOPOLITICS;
    var oid = o.id;
    return '<div style="font-size:10px;color:var(--t2);padding:4px 0;border-bottom:1px solid rgba(255,255,255,.05);cursor:pointer" data-eid="'+oid+'">' 
      +om.i+' '+o.title.slice(0,42)+'...</div>';
  }).join('');
  // Wire up cs-others click delegation
  el('cs-others').querySelectorAll('[data-eid]').forEach(function(div) {
    div.onclick = function() {
      var eid = this.dataset.eid;
      sv('map', document.querySelector('[data-v=map]'));
      setTimeout(function(){ openEP(eid); }, 400);
    };
  });
  el('cs-link').href = ev.url||'#';
  // Store ref for AI button
  G.csEvent = ev;
  // Show cached AI note if exists
  var csNote = el('cs-ai-note');
  if (ev.ai_market_note) { csNote.textContent = ev.ai_market_note; csNote.style.display='block'; }
  else csNote.style.display='none';
}

function csFlyTo() {
  var ev = G.csEvent; if(!ev) return;
  sv('map', document.querySelector('[data-v=map]'));
  setTimeout(function(){ openEP(ev.id); }, 500);
}

function csGetAI() {
  var ev = G.csEvent; if(!ev) return;
  var btn = document.querySelector('[onclick="csGetAI()"]');
  if(btn) btn.textContent = 'Loading...';
  var ctx = 'Event: '+ev.title+' | Category: '+ev.category+' | Region: '+(ev.country_name||ev.country_code)+' | Severity: '+ev.severity;
  rq('/api/events/ai/ask',{method:'POST',body:{question:'What are the key market impacts and investor risks from this event? Be direct and specific.',context:ctx}}).then(function(r) {
    var csNote = el('cs-ai-note');
    if(r&&r.answer) { csNote.textContent = r.answer; csNote.style.display='block'; }
    if(btn) btn.textContent = 'AI Analysis';
  });
}

// ── THREAT MATRIX ─────────────────────────────────────
function renderThreatMatrix(evs) {
  var matrix = el('d-threats');
  if (!matrix) return;
  // Group by category, pick worst severity per category
  var catWorst = {};
  evs.forEach(function(ev) {
    if (!catWorst[ev.category] || ev.severity > catWorst[ev.category].severity) {
      catWorst[ev.category] = ev;
    }
  });
  // Sort by severity, take top 6
  var cats = Object.values(catWorst).sort(function(a,b){return b.severity-a.severity;}).slice(0,6);
  matrix.innerHTML = cats.map(function(ev) {
    var m = CATS[ev.category]||CATS.GEOPOLITICS;
    var sev = ev.severity;
    var levelTxt = sev>=8?'CRITICAL':sev>=6?'HIGH':sev>=4?'ELEVATED':'LOW';
    var col = sev>=8?'var(--re)':sev>=6?'var(--or)':sev>=4?'var(--am)':'var(--gr)';
    var eid = ev.id;
    return '<div class="threat-item" data-eid="'+eid+'" style="border-color:'+m.c+'18">'
      +'<div class="threat-icon">'+m.i+'</div>'
      +'<div style="flex:1;min-width:0">'
      +'<div class="threat-name" style="color:'+m.c+'">'+ev.category+'</div>'
      +'<div class="threat-level" style="color:'+col+'">'+levelTxt+' &bull; '+sev.toFixed(1)+'</div>'
      +'<div class="threat-bar" style="background:'+col+';width:'+Math.min(100,sev*10)+'%"></div>'
      +'</div></div>';
  }).join('');
  matrix.querySelectorAll('[data-eid]').forEach(function(item) {
    item.onclick = function() {
      var eid = this.dataset.eid;
      sv('map', document.querySelector('[data-v=map]'));
      setTimeout(function(){ openEP(eid); }, 400);
    };
  });
  if (!cats.length) matrix.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:10px 0">No threat data available</div>';
}

// ── RISK TIMELINE ─────────────────────────────────────
function renderRiskTimeline(evs) {
  var timeline = el('d-timeline');
  if (!timeline) return;
  // Sort by timestamp, most recent first, high severity events only
  var recent = evs.filter(function(e){ return e.impact==='High'||e.severity>=6; })
    .slice().sort(function(a,b){ return new Date(b.timestamp)-new Date(a.timestamp); }).slice(0,8);
  if (!recent.length) recent = evs.slice().sort(function(a,b){ return new Date(b.timestamp)-new Date(a.timestamp); }).slice(0,8);
  timeline.innerHTML = recent.map(function(ev) {
    var m = CATS[ev.category]||CATS.GEOPOLITICS;
    var ts = new Date(ev.timestamp);
    var timeStr = ts.getHours().toString().padStart(2,'0')+':'+ts.getMinutes().toString().padStart(2,'0');
    var eid = ev.id;
    return '<div class="tl-item" data-eid="'+eid+'">' 
      +'<div class="tl-time">'+timeStr+'</div>'
      +'<div class="tl-dot" style="background:'+m.c+'"></div>'
      +'<div class="tl-content">'
      +'<div class="tl-title">'+ev.title.slice(0,52)+(ev.title.length>52?'...':'')+'</div>'
      +'<div class="tl-meta">'+m.i+' '+(ev.country_name||ev.country_code)+'</div>'
      +'</div></div>';
  }).join('');
  timeline.querySelectorAll('[data-eid]').forEach(function(item) {
    item.onclick = function() {
      var eid = this.dataset.eid;
      sv('map', document.querySelector('[data-v=map]'));
      setTimeout(function(){ openEP(eid); }, 400);
    };
  });
  if (!recent.length) timeline.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:10px 0">No recent events</div>';
}

function updateDashFin() {
  if (!G.finance || !G.finance.length) return;
  function asset(sym){ return G.finance.find(function(a){return a.symbol===sym;}); }

  // ── S&P 500 ──
  var sp = asset('^GSPC');
  if (sp && sp.price != null) {
    var spUp = (sp.change_pct||0)>=0;
    setEl('d-sp', sp.price.toLocaleString('en',{maximumFractionDigits:0}));
    var spC = el('d-sp-c');
    if (spC) { spC.textContent=(spUp?'+':'')+sp.change_pct.toFixed(2)+'%'; spC.style.color=spUp?'var(--gr)':'var(--re)'; }
    var spKpi=document.getElementById('dbk-sp');
    if (spKpi) spKpi.style.borderColor=spUp?'rgba(16,185,129,.25)':'rgba(239,68,68,.25)';
  }

  // ── Bitcoin ──
  var btc = asset('BTC-USD');
  if (btc && btc.price != null) {
    var btcUp=(btc.change_pct||0)>=0;
    setEl('d-btc','$'+Math.round(btc.price).toLocaleString('en'));
    var btcC=el('d-btc-c');
    if (btcC){btcC.textContent=(btcUp?'+':'')+btc.change_pct.toFixed(2)+'%';btcC.style.color=btcUp?'var(--gr)':'var(--re)';}
  }

  // ── VIX ──
  var vix = asset('^VIX');
  if (vix && vix.price != null) {
    setEl('d-vix',vix.price.toFixed(1));
    var vp=vix.price, vixL=el('d-vix-l');
    if (vixL){vixL.textContent=vp>30?'Extreme fear':vp>20?'Fear':'Calm';vixL.style.color=vp>30?'var(--re)':vp>20?'var(--am)':'var(--gr)';}
    var vKpi=document.getElementById('dbk-vix');
    if (vKpi) vKpi.style.borderColor=vp>30?'rgba(239,68,68,.35)':vp>20?'rgba(245,158,11,.25)':'rgba(16,185,129,.2)';
  }

  // ── Gold ──
  var gold = asset('GC=F');
  if (gold && gold.price != null) {
    var gUp=(gold.change_pct||0)>=0;
    setEl('d-gold','$'+gold.price.toLocaleString('en',{maximumFractionDigits:0}));
    var gC=el('d-gold-c');
    if (gC){gC.textContent=(gUp?'+':'')+gold.change_pct.toFixed(2)+'%';gC.style.color=gUp?'var(--gr)':'var(--re)';}
  }

  // ── Market snapshot rows with mini-sparkline ──
  var pMkts = getPersonalizedMarkets();
  var mktEl = el('d-mktlist');
  if (mktEl) {
    var rows = pMkts.slice(0,7).map(function(a) {
      if (a.price == null) return '';
      var up  = (a.change_pct||0)>=0;
      var col = up?'var(--gr)':'var(--re)';
      var chg = (up?'+':'')+a.change_pct.toFixed(2)+'%';
      var bgC = up?'rgba(16,185,129,.1)':'rgba(239,68,68,.1)';
      // Inline SVG sparkline
      var spark = '';
      if (a.history && a.history.length>=2) {
        var h  = a.history.slice(-10);
        var mn = Math.min.apply(null,h), mx = Math.max.apply(null,h), rng = mx-mn||1;
        var pts= h.map(function(v,i){
          return (i/(h.length-1)*38).toFixed(1)+','+(((1-(v-mn)/rng)*16)+1).toFixed(1);
        }).join(' ');
        var sc = up?'#10B981':'#EF4444';
        spark = '<svg class="db-mkt-spark" viewBox="0 0 40 18">'
              + '<polyline points="'+pts+'" fill="none" stroke="'+sc+'" stroke-width="1.5"/>'
              + '</svg>';
      }
      var sym = a.symbol.replace('^','').replace('-USD','').slice(0,6);
      // Build row without embedding single-quotes in onclick attribute
      var row = document.createElement('div');
      row.className = 'db-mkt-row';
      row.innerHTML = '<span class="db-mkt-sym">'+sym+'</span>'
        + '<span class="db-mkt-name">'+a.name+'</span>'
        + spark
        + '<span class="db-mkt-price">'+fmtP(a.symbol,a.price)+'</span>'
        + '<span class="db-mkt-chg" style="color:'+col+';background:'+bgC+'">'+chg+'</span>';
      row.onclick = (function(sym2, name2){
        return function(){ selectMktAsset(sym2,name2); sv('markets',document.querySelector('[data-v=markets]')); };
      })(a.symbol, a.name);
      return row.outerHTML;
    });
    mktEl.innerHTML = rows.join('');
    // Re-attach event listeners (outerHTML loses them)
    mktEl.querySelectorAll('.db-mkt-row').forEach(function(row, i) {
      var a2 = pMkts[i];
      if (a2) row.onclick = function(){ selectMktAsset(a2.symbol,a2.name); sv('markets',document.querySelector('[data-v=markets]')); };
    });
  }
}


function applyPersonalization() {
  var p = G.userProfile||{};
  var banner = el('pers-banner'), stdHdr = el('dash-std-hdr');
  if (p.onboarding_done && banner && stdHdr) {
    banner.style.display = 'flex';
    stdHdr.style.display = 'none';
    var av = el('pb-av');
    if (av) { av.textContent = (G.user.username||'U').slice(0,2).toUpperCase(); av.style.background = G.user.avatar_color||'#3B82F6'; }
    var h = new Date().getHours();
    var greetWord = h<12?'Good morning':h<18?'Good afternoon':'Good evening';
    setEl('pb-greet', greetWord+', '+(G.user.username||'').split(' ')[0]+'!');
    // Also update new dashboard greeting
    setEl('db-time-label', greetWord+', '+(G.user.username||'').split(' ')[0]+'!');
    var tags = [];
    (p.interests||[]).slice(0,3).forEach(function(id) {
      var names = {geopolitics:'Geopolitics',finance:'Finance',macro:'Macro',technology:'Tech',energy:'Energy',security:'Security',humanitarian:'Humanitarian',trade:'Trade'};
      if (names[id]) tags.push(names[id]);
    });
    (p.regions||[]).slice(0,2).forEach(function(r){ tags.push(r); });
    var pbPrefs=el('pb-prefs'); if(pbPrefs) pbPrefs.innerHTML = tags.map(function(t){ return '<span style="background:rgba(59,130,246,.1);border:1px solid var(--bdb);border-radius:100px;padding:2px 9px;font-size:10px;color:var(--b4)">'+t+'</span>'; }).join('');
  }
  var hb = document.getElementById('help-btn');
  if (hb && p.tutorial_done) hb.style.display = 'flex';

  // Set adaptive severity threshold
  var thresholds = { beginner: 5.5, intermediate: 4.5, advanced: 3.0 };
  var minSev = p.severity_threshold || thresholds[p.experience_level || 'intermediate'] || 4.5;
  G.filt = G.filt || {};
  G.filt.minSev = minSev;

  // Show affinity chips from real activity data (or onboarding fallback)

  // Show severity indicator
  var sevEl = document.getElementById('db-sev-indicator');
  if (sevEl) {
    sevEl.textContent = 'Showing events ≥ ' + minSev.toFixed(1) + ' severity'
      + (p.experience_level ? ' · ' + p.experience_level : '');
  }

  // Update brief label to "Your Daily Briefing" if personalised
  if (p.onboarding_done) {
    var lbl = document.getElementById('d-brief-label');
    if (lbl) lbl.textContent = 'Your Daily Briefing';
    var badge = document.getElementById('d-brief-badge');
    if (badge) badge.textContent = 'AI';
  }

  // Fetch real affinity data
  refreshAffinity();
  // Update dashboard personalisation badge
  setTimeout(_updatePersBadge, 500);
  // Pre-load personalised events
  setTimeout(loadPersonalisedFeed, 1000);
}

function _renderAffinityChips(p) {
  var chipsEl = document.getElementById('db-affinity-chips');
  if (!chipsEl) return;

  var chips = [];

  // From real affinity (if available)
  if (G_affinity && Object.keys(G_affinity).length) {
    var sorted = Object.entries(G_affinity)
      .sort(function(a,b){ return b[1]-a[1]; })
      .slice(0, 4);
    sorted.forEach(function(entry) {
      var cat = entry[0], score = entry[1];
      if (score > 0.05) chips.push({ label: cat, score: score, source: 'activity' });
    });
  }

  // Fallback to onboarding interests
  if (!chips.length) {
    (p.interests || []).slice(0, 3).forEach(function(i) {
      chips.push({ label: i, score: null, source: 'profile' });
    });
    (p.regions || []).slice(0, 2).forEach(function(r) {
      chips.push({ label: r, score: null, source: 'profile' });
    });
  }

  if (!chips.length) { chipsEl.innerHTML = ''; return; }

  chipsEl.innerHTML = chips.map(function(c) {
    var pct = c.score ? Math.round(c.score * 100) + '%' : '';
    var title = c.source === 'activity'
      ? 'Based on your reading habits (' + pct + ' of events)'
      : 'From your profile';
    return '<span title="' + title + '" style="'
      + 'background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.2);'
      + 'border-radius:100px;padding:2px 9px;font-size:9px;color:var(--b4);'
      + 'cursor:default;white-space:nowrap">'
      + c.label.charAt(0).toUpperCase() + c.label.slice(1).toLowerCase()
      + (pct ? ' <span style="opacity:.6">' + pct + '</span>' : '')
      + '</span>';
  }).join('');
}
// Cache for affinity data fetched from backend
var G_affinity = null;
var G_affinityFetchedAt = 0;

function getPersonalizedEvents() {
  var p = G.userProfile || {};

  // Use cached affinity if fresh (< 5 min old)
  var affinity = G_affinity;
  var now      = Date.now();

  // Apply affinity-based scoring if we have it
  var events = G.events.slice();

  // Severity threshold from user profile (set by experience level or manually)
  var thresholds = { beginner: 5.5, intermediate: 4.5, advanced: 3.0 };
  var minSev = p.severity_threshold ||
               thresholds[p.experience_level || 'intermediate'] || 4.5;

  events = events.filter(function(e) { return (e.severity || 0) >= minSev; });

  if (affinity && Object.keys(affinity).length) {
    // Score each event against real affinity
    events = events.map(function(e) {
      var catScore  = affinity[e.category] || 0.05;
      var composite = (e.severity / 10) * 0.5 + catScore * 0.5;
      return { ev: e, score: composite };
    });
    events.sort(function(a, b) { return b.score - a.score; });
    events = events.map(function(x) { return x.ev; });
  } else {
    // Fallback: onboarding-based filter (existing logic)
    var regions   = p.regions   || [];
    var interests = p.interests || [];
    var regionCodes = {
      'Europe':       ['DE','FR','GB','IT','ES','PL','UA','RU','SE','NO','NL','CH'],
      'USA':          ['US','CA'],
      'Middle East':  ['SA','IR','IL','IQ','SY','AE','JO','LB'],
      'Asia':         ['CN','JP','IN','KR','ID','TH','VN','MY','AU'],
      'Africa':       ['NG','ZA','EG','KE','ET','MA'],
      'Latin America':['BR','MX','AR','CO','CL'],
    };
    var activeCodes = {};
    regions.forEach(function(r) {
      (regionCodes[r] || []).forEach(function(c) { activeCodes[c] = true; });
    });
    var catMap = {
      Economics: ['ECONOMICS','FINANCE','TRADE'], Finance: ['FINANCE','ECONOMICS'],
      Geopolitics: ['GEOPOLITICS','POLITICS'],   Conflict: ['CONFLICT','SECURITY'],
      Energy: ['ENERGY'],  Technology: ['TECHNOLOGY'],
      Humanitarian: ['HUMANITARIAN','HEALTH'],
    };
    var activeCats = {};
    interests.forEach(function(id) {
      (catMap[id] || []).forEach(function(c) { activeCats[c] = true; });
    });
    var hasFilter = regions.length || interests.length;
    if (hasFilter) {
      events = events.filter(function(e) {
        return activeCodes[e.country_code] || activeCats[e.category];
      });
    }
  }

  return events;
}

// Fetch real affinity from backend (called once after login, refreshed hourly)
function refreshAffinity() {
  rq('/api/user/affinity').then(function(r) {
    if (r && r.affinity) {
      G_affinity = r.affinity;
      G_affinityFetchedAt = Date.now();


      // If enough real data, re-render dashboard with scored events
      if (r.total_interactions >= 10) {
        renderDash();
      }
    }
  }).catch(function(){});
}
function getPersonalizedMarkets() {
  var p = G.userProfile||{};
  var prefs = p.market_prefs||[];
  if (!prefs.length) return G.finance.slice(0,8);
  var catMap = {Stocks:'index',Forex:'forex',Commodities:'commodity',Crypto:'crypto',Bonds:'bond'};
  var cats = {};
  prefs.forEach(function(m){ if(catMap[m]) cats[catMap[m]]=true; });
  var filtered = G.finance.filter(function(a){ return cats[a.category]; });
  return filtered.length ? filtered.slice(0,8) : G.finance.slice(0,8);
}

// ── FEED ──────────────────────────────────────────────
function sf(key, val, chip) {
  G.filt[key] = val;
  if (chip&&key==='impact') { document.querySelectorAll('[onclick*="sf(\'impact\'"]').forEach(function(c){c.classList.remove('on');}); chip.classList.add('on'); }
  if (chip&&key==='hours')  { document.querySelectorAll('[onclick*="sf(\'hours\'"]').forEach(function(c){c.classList.remove('on');}); chip.classList.add('on'); }
  if (chip&&key==='cat')    { document.querySelectorAll('#feedcats .fc').forEach(function(c){c.classList.remove('on');}); if(val) chip.classList.add('on'); }
  renderFeed();
}
function renderFeed() {
  var cut = new Date(Date.now()-G.filt.hours*3600000);
  var q = (G.filt.search||'').toLowerCase();
  var evs = G.events.filter(function(e) {
    if (new Date(e.timestamp)<cut) return false;
    if (G.filt.cat&&e.category!==G.filt.cat) return false;
    if (G.filt.impact&&e.impact!==G.filt.impact) return false;
    if (q&&!e.title.toLowerCase().includes(q)&&!(e.summary||'').toLowerCase().includes(q)) return false;
    return true;
  }).sort(function(a,b){return b.severity-a.severity;});
  setEl('finfo', evs.length+' events');
  var html = evs.slice(0,100).map(function(ev) {
    var m = CATS[ev.category]||CATS.GEOPOLITICS;
    var s = Math.round(ev.severity); var dots='';
    for (var i=0;i<10;i++) { var col=i<s?(s>=7?'var(--re)':s>=4?'var(--am)':'var(--gr)'):'var(--bg3)'; dots+='<div class="sd" style="background:'+col+'"></div>'; }
    // Sentiment badge
    var sentHtml = sentBadgeHtml(ev);
    // Info type pill
    var infoType = ev.sentiment_info_type ? '<span class="sent-info-type" style="margin-left:4px">'+ev.sentiment_info_type+'</span>' : '';
    var eid = ev.id;
    return '<div class="evcard" data-eid="'+eid+'">'
      +'<div class="evh"><div class="evi" style="background:'+m.bg+'">'+m.i+'</div>'
      +'<div style="flex:1"><div class="evt">'+ev.title+'</div>'
      +'<div class="evm"><span>'+ev.source+'</span><span style="color:var(--b4)">'+(ev.country_name||ev.country_code)+'</span><span>'+tAgo(new Date(ev.timestamp))+'</span>'+infoType+'</div></div>'
      +'<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">'
      +'<span class="tag tag'+ev.impact[0]+'">'+ev.impact+'</span>'
      +sentHtml
      +'</div></div>'
      +(ev.ai_summary||ev.summary?'<div class="evs">'+(ev.ai_summary||ev.summary)+'</div>':'')
      +(ev.ai_market_note?'<div style="font-size:10px;color:var(--am);margin-bottom:5px">'+ev.ai_market_note+'</div>':'')
      +'<div class="evf">'
      +'<div class="sdots">'+dots+'</div>'
      +'<span style="font-size:10px;color:var(--t3)">Severity '+ev.severity.toFixed(1)+'</span>'
      +'<button class="impact-btn" data-impact-id="'+eid+'" style="padding:3px 9px;font-size:10px" onclick="event.stopPropagation();showImpactForId(\''+eid+'\')" >Show Impact</button>'
      +'</div>'
      +'</div>';
  }).join('');
  var _fmain = el('fmain');
  if (!_fmain) return;
  _fmain.innerHTML = html||'<div style="color:var(--t3);text-align:center;margin-top:36px">No events match filters</div>';
  // Delegated click for cards (not buttons)
  _fmain.querySelectorAll('.evcard[data-eid]').forEach(function(card) {
    card.addEventListener('click', function(e) {
      if (e.target.closest('.impact-btn')) return;
      goEv(this.dataset.eid);
    });
  });
}
function goEv(id) { sv('map',document.querySelector('[data-v=map]')); setTimeout(function(){openEP(id);},500); }


// ════════════════════════════════════════════════════
// READING LIST  (saved events + notes)
// ════════════════════════════════════════════════════

var _savedIds = {};   // local cache: event_id → true/false

function switchFeedTab(tab, btn) {
  document.querySelectorAll('#feed-tab-live,#feed-tab-saved,#feed-tab-pers').forEach(function(b){
    b.classList.remove('on');
  });
  if (btn) btn.classList.add('on');

  var liveEl    = document.getElementById('fmain');
  var savedEl   = document.getElementById('fsaved');
  var persEl    = document.getElementById('fpers');
  var filtersEl = document.getElementById('feed-live-filters');

  // Hide all first
  if (liveEl)    liveEl.style.display    = 'none';
  if (savedEl)   savedEl.style.display   = 'none';
  if (persEl)    persEl.style.display    = 'none';
  if (filtersEl) filtersEl.style.display = 'none';

  if (tab === 'saved') {
    if (savedEl) savedEl.style.display = 'block';
    loadSavedFeed();
    track('saved_feed_opened', 'feed', '');

  } else if (tab === 'pers') {
    if (persEl) persEl.style.display = 'block';
    loadPersonalizedFeed();
    track('personalized_feed_opened', 'feed', '');

  } else {
    // live
    if (liveEl)    liveEl.style.display    = 'block';
    if (filtersEl) filtersEl.style.display = 'block';
  }
}

function loadPersonalizedFeed() {
  var el2 = document.getElementById('fpers');
  if (!el2) return;
  el2.innerHTML = '<div style="color:var(--t3);text-align:center;padding:32px;font-size:11px">'
    + '<div class="ng-spinner" style="margin:0 auto 10px"></div>Loading your personalised feed…</div>';

  rq('/api/events/personalized?limit=50&hours=72').then(function(r) {
    if (!r || !r.events || !r.events.length) {
      el2.innerHTML = '<div style="color:var(--t3);text-align:center;padding:32px;font-size:11px">'
        + '<div style="font-size:28px;margin-bottom:8px">✦</div>'
        + '<div style="margin-bottom:6px">No personalised events yet</div>'
        + '<div style="font-size:10px;color:var(--t4)">Open a few events in the Live feed to build your profile</div>'
        + '</div>';
      return;
    }

    // Show affinity stats if available
    var statsHtml = '';
    if (r.affinity && Object.keys(r.affinity).length) {
      var topCats = Object.entries(r.affinity)
        .sort(function(a,b){return b[1]-a[1];}).slice(0,3)
        .map(function(e){ return e[0]; }).join(' · ');
      statsHtml = '<div style="font-size:9px;color:var(--t3);padding:8px 0 10px">'
        + '✦ Scored for you · ' + r.events.length + ' events · Top interests: ' + topCats
        + (r.total_interactions ? ' · ' + r.total_interactions + ' interactions analysed' : '')
        + '</div>';
    }

    var html2 = statsHtml + r.events.map(function(ev) {
      var m = CATS[ev.category] || CATS.GEOPOLITICS;
      var sev = ev.severity || 5;
      var sevCol = sev >= 7 ? 'var(--re)' : sev >= 5 ? 'var(--am)' : 'var(--gr)';
      var sentHtml = typeof sentBadgeHtml === 'function' ? sentBadgeHtml(ev) : '';
      var rel = ev._relevance ? Math.round(ev._relevance * 100) : null;
      return '<div class="evcard" data-eid="' + ev.id + '" style="position:relative">'
        + '<div class="evh">'
        + '<div class="evi" style="background:' + m.bg + '">' + m.i + '</div>'
        + '<div style="flex:1">'
        + '<div class="evt">' + (ev.title || '') + '</div>'
        + '<div class="evm">'
        + '<span>' + (ev.source || '') + '</span>'
        + '<span style="color:var(--b4)">' + (ev.country_name || ev.country_code || '') + '</span>'
        + '<span>' + tAgo(new Date(ev.timestamp || '')) + '</span>'
        + (rel ? '<span style="color:var(--b5);font-weight:700">' + rel + '% match</span>' : '')
        + '</div></div>'
        + '<div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">'
        + '<span class="tag tag' + (ev.impact||'M')[0] + '">' + (ev.impact || 'Med') + '</span>'
        + sentHtml
        + '</div></div>'
        + (ev.ai_summary || ev.summary
          ? '<div class="evs">' + (ev.ai_summary || ev.summary) + '</div>' : '')
        + '<div class="evf">'
        + '<span style="font-size:10px;color:var(--t3)">Severity ' + sev.toFixed(1) + '</span>'
        + (ev.url ? '<a href="' + ev.url + '" target="_blank" class="impact-btn" '
          + 'style="padding:3px 9px;font-size:10px" onclick="event.stopPropagation()">↗ Read</a>' : '')
        + '</div></div>';
    }).join('');

    el2.innerHTML = html2;

    // Wire clicks
    el2.querySelectorAll('.evcard[data-eid]').forEach(function(card) {
      card.addEventListener('click', function(e) {
        if (e.target.closest('.impact-btn')) return;
        openEP(this.dataset.eid);
      });
    });
  });
}

function loadSavedFeed() {
  var el2 = document.getElementById('fsaved');
  if (!el2) return;
  el2.innerHTML = '<div style="color:var(--t3);text-align:center;padding:32px;font-size:11px">Loading saved events…</div>';
  rq('/api/saved').then(function(r) {
    if (!r || !r.saved) { el2.innerHTML = '<div style="color:var(--t3);text-align:center;padding:32px;font-size:11px">No saved events yet.<br>Click 🔖 on any event to save it.</div>'; return; }
    if (!r.saved.length) { el2.innerHTML = '<div style="color:var(--t3);text-align:center;padding:32px;font-size:11px">No saved events yet.<br>Click 🔖 on any event to save it.</div>'; return; }

    var html = r.saved.map(function(s) {
      var cat = s.category || 'GEOPOLITICS';
      var m2  = CATS[cat] || CATS.GEOPOLITICS;
      var sev = (s.severity || 5).toFixed(1);
      var sevCol = s.severity >= 7 ? 'var(--re)' : s.severity >= 5 ? 'var(--am)' : 'var(--gr)';
      return '<div class="evcard" style="position:relative" onclick="openEP(\'' + s.event_id + '\')">'
        + '<div class="evh">'
        + '<div class="evi" style="background:' + m2.bg + '">' + m2.i + '</div>'
        + '<div style="flex:1">'
        + '<div class="evt">' + (s.title || 'Untitled') + '</div>'
        + '<div class="evm"><span>' + (s.country_name||'') + '</span><span>' + tAgo(new Date(s.timestamp||s.created_at)) + '</span></div>'
        + '</div>'
        + '<span style="font-size:11px;font-weight:700;color:' + sevCol + '">' + sev + '</span>'
        + '</div>'
        + (s.note ? '<div style="font-size:10px;color:var(--t3);margin:4px 0 2px;padding:6px 8px;background:var(--bg3);border-radius:6px;line-height:1.5">📝 ' + s.note + '</div>' : '')
        + '<div class="evf" style="justify-content:flex-end">'
        + '<button class="impact-btn" style="padding:3px 9px;font-size:10px;color:var(--re)" onclick="event.stopPropagation();unsaveEvent(\'' + s.event_id + '\',this)">🗑 Remove</button>'
        + (s.url ? '<a href="' + s.url + '" target="_blank" class="impact-btn" style="padding:3px 9px;font-size:10px" onclick="event.stopPropagation()">↗ Read</a>' : '')
        + '</div>'
        + '</div>';
    }).join('');
    el2.innerHTML = '<div style="font-size:10px;color:var(--t3);margin-bottom:10px">' + r.saved.length + ' saved event' + (r.saved.length!==1?'s':'') + '</div>' + html;

    // Cache saved IDs
    r.saved.forEach(function(s) { _savedIds[s.event_id] = true; });
  });
}

function toggleSaveEvent() {
  var ev = G.panelEv; if (!ev) return;
  var btn = document.getElementById('ep-save-btn');
  if (_savedIds[ev.id]) {
    // Already saved → unsave
    rq('/api/saved/' + ev.id, { method: 'DELETE' }).then(function() {
      _savedIds[ev.id] = false;
      if (btn) { btn.textContent = '🔖 Save'; btn.style.color = ''; }
      track('event_unsaved', 'map', ev.id);
    });
  } else {
    rq('/api/saved', { method: 'POST', body: { event_id: ev.id, note: '' } }).then(function() {
      _savedIds[ev.id] = true;
      if (btn) { btn.textContent = '✅ Saved'; btn.style.color = 'var(--gr)'; }
      track('event_saved', 'map', ev.id + '|' + (ev.category||''));
    });
  }
}

function unsaveEvent(eventId, btnEl) {
  rq('/api/saved/' + eventId, { method: 'DELETE' }).then(function() {
    _savedIds[eventId] = false;
    track('event_unsaved', 'feed', eventId);
    // Reload saved list
    loadSavedFeed();
  });
}

// Update save button state when event panel opens
(function() {
  var _origOpenEP = openEP;
  openEP = function(id) {
    _origOpenEP(id);
    // Update save button state
    var btn = document.getElementById('ep-save-btn');
    if (btn) {
      if (_savedIds[id]) {
        btn.textContent = '✅ Saved'; btn.style.color = 'var(--gr)';
      } else {
        btn.textContent = '🔖 Save'; btn.style.color = '';
      }
    }
    // Dwell time tracking: start timer when panel opens
    if (G._dwellTimer) clearTimeout(G._dwellTimer);
    G._dwellStart = Date.now();
    G._dwellEv    = id;
    G._dwellTimer = setTimeout(function() {
      if (G._dwellEv === id) {
        track('event_dwell_30s', G.currentView || 'map', id + '|' + ((G.panelEv||{}).category||''));
      }
    }, 30000);
  };
})();

// ════════════════════════════════════════════════════
// SAVE BUTTON IN FEED CARDS
// ════════════════════════════════════════════════════

// Patch renderFeed to inject save icon into each card
(function() {
  var _origRenderFeed = renderFeed;
  renderFeed = function() {
    _origRenderFeed();
    // After render, add save buttons
    var fmain = document.getElementById('fmain');
    if (!fmain) return;
    fmain.querySelectorAll('.evcard[data-eid]').forEach(function(card) {
      if (card.querySelector('.save-icon')) return;  // already added
      var eid   = card.dataset.eid;
      var icon  = document.createElement('button');
      icon.className   = 'save-icon impact-btn';
      icon.dataset.eid = eid;
      icon.title       = 'Save to reading list';
      icon.textContent = _savedIds[eid] ? '✅' : '🔖';
      icon.style.cssText = 'padding:2px 6px;font-size:11px;background:none;border:none;cursor:pointer;opacity:0.7';
      icon.addEventListener('click', function(e) {
        e.stopPropagation();
        var saved = _savedIds[eid];
        var method = saved ? 'DELETE' : 'POST';
        var url    = saved ? '/api/saved/' + eid : '/api/saved';
        var body   = saved ? undefined : { event_id: eid, note: '' };
        rq(url, { method: method, body: body }).then(function() {
          _savedIds[eid] = !saved;
          icon.textContent = _savedIds[eid] ? '✅' : '🔖';
          track(_savedIds[eid] ? 'event_saved' : 'event_unsaved', 'feed', eid);
        });
      });
      // Append to the footer row of the card
      var footer = card.querySelector('.evf');
      if (footer) footer.insertBefore(icon, footer.firstChild);
    });
  };
})();

// ════════════════════════════════════════════════════
// LOAD SAVED IDs ON LOGIN (to hydrate button states)
// ════════════════════════════════════════════════════

function loadSavedIds() {
  rq('/api/saved').then(function(r) {
    if (r && r.saved) {
      r.saved.forEach(function(s) { _savedIds[s.event_id] = true; });
    }
  });
}

// ════════════════════════════════════════════════════
// SPRINT 2 — PERSONALISATION ENGINE
// ════════════════════════════════════════════════════

// ── Affinity bars in Profile ─────────────────────────
function renderAffinityProfile() {
  var barsEl   = document.getElementById('prof-affinity-bars');
  var emptyEl  = document.getElementById('prof-affinity-empty');
  var sinceEl  = document.getElementById('prof-affinity-since');
  var sevEl    = document.getElementById('prof-minsev');
  if (!barsEl) return;

  rq('/api/user/affinity?days=30').then(function(r) {
    if (!r || !r.affinity || !Object.keys(r.affinity).length) {
      if (barsEl)  barsEl.style.display  = 'none';
      if (emptyEl) emptyEl.style.display = 'block';
      return;
    }
    if (emptyEl)  emptyEl.style.display  = 'none';
    if (sinceEl)  sinceEl.textContent    = r.total_interactions + ' interactions, last 30 days';

    // Cache affinity for use elsewhere
    G_affinity = r.affinity;

    // Compute adaptive threshold based on experience
    var p      = G.userProfile || {};
    var thresholds = { beginner: 5.5, intermediate: 4.5, advanced: 3.0 };
    var minSev = p.severity_threshold ||
                 thresholds[p.experience_level || 'intermediate'] || 4.5;
    if (sevEl) sevEl.textContent = '≥ ' + minSev.toFixed(1) + '/10';

    // Sort categories by weight
    var entries = Object.entries(r.affinity)
      .sort(function(a, b) { return b[1] - a[1]; });

    var CAT_META = {
      ECONOMICS:    { icon: '📊', col: '#10B981' },
      FINANCE:      { icon: '💹', col: '#06B6D4' },
      CONFLICT:     { icon: '⚔',  col: '#EF4444' },
      GEOPOLITICS:  { icon: '🌐', col: '#3B82F6' },
      ENERGY:       { icon: '⚡', col: '#F59E0B' },
      TECHNOLOGY:   { icon: '💻', col: '#8B5CF6' },
      POLITICS:     { icon: '🏛', col: '#6366F1' },
      DISASTER:     { icon: '🌪', col: '#F97316' },
      HEALTH:       { icon: '🏥', col: '#EC4899' },
      HUMANITARIAN: { icon: '🚨', col: '#F97316' },
      SECURITY:     { icon: '🔒', col: '#DC2626' },
      TRADE:        { icon: '🚢', col: '#14B8A6' },
    };

    barsEl.innerHTML = '';
    entries.slice(0, 8).forEach(function(entry) {
      var cat  = entry[0];
      var pct  = Math.round(entry[1] * 100);
      var meta = CAT_META[cat] || { icon: '●', col: 'var(--b5)' };

      var row  = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px';

      var icon = document.createElement('span');
      icon.style.cssText = 'font-size:11px;width:18px;text-align:center;flex-shrink:0';
      icon.textContent   = meta.icon;

      var lbl = document.createElement('div');
      lbl.style.cssText = 'font-size:10px;color:var(--t2);width:96px;flex-shrink:0';
      lbl.textContent   = cat.charAt(0) + cat.slice(1).toLowerCase();

      var track = document.createElement('div');
      track.style.cssText = 'flex:1;height:6px;background:var(--bg3);border-radius:4px;overflow:hidden';
      var fill = document.createElement('div');
      fill.style.cssText  = 'height:100%;border-radius:4px;transition:width .4s ease;background:' + meta.col;
      fill.style.width    = '0%';
      track.appendChild(fill);

      var pctLbl = document.createElement('span');
      pctLbl.style.cssText = 'font-size:9px;color:var(--t3);min-width:28px;text-align:right';
      pctLbl.textContent   = pct + '%';

      row.appendChild(icon);
      row.appendChild(lbl);
      row.appendChild(track);
      row.appendChild(pctLbl);
      barsEl.appendChild(row);

      // Animate bar after paint
      requestAnimationFrame(function() {
        requestAnimationFrame(function() { fill.style.width = pct + '%'; });
      });
    });
  });
}

// ── Dashboard: show "For You" badge when affinity is active ──
function _updatePersBadge() {
  var badge = document.getElementById('d-pers-badge');
  var label = document.getElementById('d-evlist-label');
  if (!badge) return;
  var hasAffinity = G_affinity && Object.keys(G_affinity).length > 0;
  var hasPrefs    = G.userProfile && (
    (G.userProfile.interests || []).length + (G.userProfile.regions || []).length > 0
  );
  if (hasAffinity || hasPrefs) {
    badge.style.display = 'inline-flex';
    if (label) label.textContent = 'Events For You';
  } else {
    badge.style.display = 'none';
    if (label) label.textContent = 'High-Impact Events';
  }
}

// ── Feed: load personalised events from backend ──────
function loadPersonalisedFeed() {
  var p      = G.userProfile || {};
  var minSev = p.severity_threshold ||
    ({ beginner: 5.5, intermediate: 4.5, advanced: 3.0 }[p.experience_level||'intermediate'] || 4.5);
  var hasPrefs = (p.interests||[]).length + (p.regions||[]).length > 0;

  // If we have enough signal, call the personalised endpoint
  var totalActions = (G_affinity && Object.keys(G_affinity).length > 0) ? 10 : 0;

  if (totalActions >= 5 || hasPrefs) {
    rq('/api/events/personalized?hours=48&limit=50&min_score=0.1').then(function(r) {
      if (r && r.events && r.events.length) {
        // Merge with G.events: personalised events get a _pers flag
        r.events.forEach(function(ev) { ev._pers = true; });
        // Replace G.events content with merged de-duplicated list
        var persIds = {};
        r.events.forEach(function(ev) { persIds[ev.id] = true; });
        var others = G.events.filter(function(e) { return !persIds[e.id]; });
        G._persEvents = r.events;   // keep separate for feed tab
      }
    });
  }
}

function exportFeedCSV(hours, category, minSev) {
  // Use backend export endpoint for proper CSV with all fields
  var params = [];
  params.push('hours=' + (hours || G.filt.hours || 72));
  if (category || G.filt.cat) params.push('category=' + encodeURIComponent(category || G.filt.cat));
  if (minSev) params.push('min_severity=' + minSev);
  var url = '/api/events/export/csv?' + params.join('&');

  // Create a temporary link with auth header — use fetch + blob
  if (!G.token) { toast('Sign in to export', 'e'); return; }

  toast('Preparing export…', 'i');
  fetch(url, { headers: { 'Authorization': 'Bearer ' + G.token } })
    .then(function(r) {
      if (!r.ok) { toast('Export failed', 'e'); return null; }
      return r.blob();
    })
    .then(function(blob) {
      if (!blob) return;
      var a   = document.createElement('a');
      a.href  = URL.createObjectURL(blob);
      a.download = 'worldlens-' + new Date().toISOString().slice(0,10) + '.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      track('export_csv', 'feed', params.join('&'));
      toast('CSV downloaded', 's');
    })
    .catch(function() { toast('Export failed', 'e'); });
}
// ════════════════════════════════════════════════════
// SPRINT 4 — ML FEATURES
// ════════════════════════════════════════════════════

// ── 4.1  TF-IDF: rebuild profile trigger ────────────────────────────────────
// Called automatically after 10+ events opened (in refreshAffinity callback)
function rebuildTfIdfProfile() {
  if (!G.token) return;
  rq('/api/ml/rebuild-profile', { method: 'POST' }).then(function(r) {
    if (r && r.status === 'rebuilt') {
      // Silently success — profile updated in background
      G._tfidfReady = true;
    }
  }).catch(function(){});
}

// ── 4.2  Similar events (semantic / TF-IDF) ──────────────────────────────────
function loadSimilarEvents() {
  var ev = G.panelEv; if (!ev) return;
  var container = document.getElementById('ep-similar');
  var list      = document.getElementById('ep-similar-list');
  if (!container || !list) return;

  container.style.display = 'block';
  list.innerHTML = '<div style="font-size:10px;color:var(--t3)">Finding similar events…</div>';
  track('similar_events_requested', G.currentView || 'map', ev.id);

  rq('/api/ml/similar/' + encodeURIComponent(ev.id) + '?limit=5&hours=168')
    .then(function(r) {
      if (!r || (!r.similar && !r.detail)) {
        list.innerHTML = '<div style="font-size:10px;color:var(--t3)">ML features not available on this deployment.</div>';
        return;
      }
      if (r.detail) {
        // Fallback: show related events by category
        _showRelatedByCategory(ev, list);
        return;
      }
      if (!r.similar || !r.similar.length) {
        list.innerHTML = '<div style="font-size:10px;color:var(--t3)">No similar events found in the last 7 days.</div>';
        return;
      }

      var method = r.method === 'semantic' ? '🧠 Semantic' : '📝 Keyword';
      list.innerHTML = '<div style="font-size:8px;color:var(--t4);margin-bottom:6px">' + method + ' similarity</div>'
        + r.similar.map(function(item) {
          var sim = Math.round((item.similarity || 0) * 100);
          var ev2 = item.event || {};
          var col = ev2.severity >= 7 ? 'var(--re)' : ev2.severity >= 5 ? 'var(--am)' : 'var(--gr)';
          return '<div style="padding:7px 9px;background:var(--bg3);border-radius:7px;margin-bottom:5px;cursor:pointer" '
            + 'onclick="openEP(\'' + ev2.id + '\')">'
            + '<div style="display:flex;align-items:center;gap:6px;margin-bottom:3px">'
            + '<span style="font-size:9px;padding:1px 5px;border-radius:4px;background:var(--bg2);color:var(--t3)">' + (ev2.category || '') + '</span>'
            + '<span style="margin-left:auto;font-size:9px;font-family:var(--fm);color:var(--t3)">' + sim + '% match</span>'
            + '</div>'
            + '<div style="font-size:10px;color:var(--t1);line-height:1.4">' + (ev2.title || '').slice(0, 80) + '</div>'
            + '<div style="font-size:8px;color:var(--t4);margin-top:2px">' + (ev2.country_name || '') + ' · ' + tAgo(new Date(ev2.timestamp || '')) + '</div>'
            + '</div>';
        }).join('');
    })
    .catch(function() { _showRelatedByCategory(ev, list); });
}

// Fallback: show related events by category from local G.events
function _showRelatedByCategory(ev, list) {
  var related = G.events.filter(function(e) {
    return e.id !== ev.id && e.category === ev.category;
  }).slice(0, 5);

  if (!related.length) {
    list.innerHTML = '<div style="font-size:10px;color:var(--t3)">No related events found.</div>';
    return;
  }
  list.innerHTML = '<div style="font-size:8px;color:var(--t4);margin-bottom:6px">📂 Same category</div>'
    + related.map(function(e) {
      var col = e.severity >= 7 ? 'var(--re)' : e.severity >= 5 ? 'var(--am)' : 'var(--gr)';
      return '<div style="padding:7px 9px;background:var(--bg3);border-radius:7px;margin-bottom:5px;cursor:pointer" onclick="openEP(\'' + e.id + '\')">'
        + '<div style="font-size:10px;color:var(--t1);line-height:1.4">' + (e.title || '').slice(0, 80) + '</div>'
        + '<div style="font-size:8px;color:var(--t4);margin-top:2px">' + (e.country_name || '') + ' · <span style="color:' + col + '">' + (e.severity || 0).toFixed(1) + '</span></div>'
        + '</div>';
    }).join('');
}

// Hide similar panel when opening a new event
(function() {
  var _prevOpenEP = openEP;
  openEP = function(id) {
    _prevOpenEP(id);
    var sim = document.getElementById('ep-similar');
    if (sim) sim.style.display = 'none';
  };
})();

// ── 4.3  TF-IDF profile rebuild trigger (on sufficient data) ─────────────────
(function() {
  var _prevRefresh = refreshAffinity;
  refreshAffinity = function() {
    _prevRefresh();
    // After affinity is fetched, check if we have enough data to rebuild TF-IDF
    rq('/api/user/affinity?days=90').then(function(r) {
      if (r && r.total_interactions >= 10 && !G._tfidfReady) {
        rebuildTfIdfProfile();
      }
    }).catch(function(){});
  };
})();

// ════════════════════════════════════════════════════
// WORLDLENS MOBILE ENGINE
// Holographic UI interactions for touch devices
// ════════════════════════════════════════════════════

var _isMobile = function() { return window.innerWidth <= 768; };

// ── Mobile nav ───────────────────────────────────────────────────────
function mobileNav(view, btn) {
  // Sync the desktop sv() call
  var desktopBtn = document.querySelector('.ni[data-v="' + view + '"]');
  sv(view, desktopBtn);

  // Update mobile nav active state
  document.querySelectorAll('.wl-mnav-btn[data-mv]').forEach(function(b) {
    b.classList.remove('active');
  });
  if (btn) {
    btn.classList.add('active');
  } else {
    var mb = document.querySelector('.wl-mnav-btn[data-mv="' + view + '"]');
    if (mb) mb.classList.add('active');
  }

  // Close more drawer if open
  closeMoreDrawer();

  // Scroll to top of new view on mobile
  var viewEl = document.getElementById('view-' + view);
  if (viewEl) viewEl.scrollTop = 0;
}

/* ── Live badge updater — called from renderDash ── */
function updateMobileBadges(opts) {
  opts = opts || {};
  // Crisis badge: show count of high-severity events
  var crisisBadge = document.getElementById('wl-crisis-badge');
  if (crisisBadge) {
    var count = opts.crisisCount || 0;
    crisisBadge.style.display = count > 0 ? 'block' : 'none';
    crisisBadge.textContent = count > 99 ? '99+' : String(count);
  }
  // AI badge: show when a new briefing is available
  var aiBadge = document.getElementById('wl-ai-badge');
  if (aiBadge && opts.newBriefing) {
    aiBadge.style.display = 'block';
  }
}
window.updateMobileBadges = updateMobileBadges;

// Sync desktop nav → mobile nav active state
(function() {
  var _origSv = window.sv;
  window.sv = function(name, btn) {
    _origSv(name, btn);
    if (_isMobile()) {
      document.querySelectorAll('.wl-mnav-btn[data-mv]').forEach(function(b) {
        b.classList.toggle('active', b.dataset.mv === name);
      });
    }
  };
})();

// ── More drawer ──────────────────────────────────────────────────────
function toggleMoreDrawer() {
  var drawer  = document.getElementById('wl-more-drawer');
  var overlay = document.getElementById('wl-more-overlay');
  if (!drawer) return;
  var isOpen = drawer.classList.contains('open');
  drawer.classList.toggle('open', !isOpen);
  overlay.classList.toggle('open', !isOpen);
}
function closeMoreDrawer() {
  var drawer  = document.getElementById('wl-more-drawer');
  var overlay = document.getElementById('wl-more-overlay');
  if (drawer)  drawer.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}

// ── Holographic XP popup ─────────────────────────────────────────────
var _xpTimer;
function showHoloXP(amount, reason) {
  if (!_isMobile()) {
    // Desktop: use existing xpPop
    if (typeof xpPop === 'function') xpPop(amount, reason);
    return;
  }
  var popup = document.getElementById('wl-holo-xp');
  if (!popup) return;

  document.getElementById('wl-xp-amount').textContent = '+' + amount;
  document.getElementById('wl-xp-reason').textContent  = reason || 'Action completed';

  // Sparkle particles
  _spawnSparkles('wl-xp-sparkle');

  clearTimeout(_xpTimer);
  popup.classList.remove('hide');
  popup.classList.add('show');

  _xpTimer = setTimeout(function() {
    popup.classList.add('hide');
    setTimeout(function() { popup.classList.remove('show', 'hide'); }, 350);
  }, 2600);
}

function _spawnSparkles(containerId) {
  var el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  for (var i = 0; i < 12; i++) {
    var dot = document.createElement('div');
    var x   = Math.random() * 100;
    var y   = Math.random() * 100;
    var dur = .4 + Math.random() * .6;
    var del = Math.random() * .4;
    dot.style.cssText = [
      'position:absolute',
      'left:' + x + '%', 'top:' + y + '%',
      'width:' + (2 + Math.random() * 3) + 'px',
      'height:' + (2 + Math.random() * 3) + 'px',
      'border-radius:50%',
      'background:rgba(0,229,255,' + (.4 + Math.random() * .5) + ')',
      'box-shadow:0 0 4px rgba(0,229,255,.6)',
      'animation:sparkleOut ' + dur + 's ' + del + 's ease-out forwards',
    ].join(';');
    el.appendChild(dot);
  }
}

// Add sparkle animation to neo CSS (injected once)
(function() {
  if (document.getElementById('sparkle-style')) return;
  var s = document.createElement('style');
  s.id  = 'sparkle-style';
  s.textContent = '@keyframes sparkleOut{0%{transform:scale(0) translate(0,0);opacity:1}100%{transform:scale(1.5) translate(var(--dx,20px),var(--dy,-30px));opacity:0}}';
  document.head.appendChild(s);
})();

// Override xpPop globally to use holographic version on mobile
(function() {
  var _origXpPop = window.xpPop;
  window.xpPop = function(amount, msg) {
    showHoloXP(amount, msg);
    if (!_isMobile() && typeof _origXpPop === 'function') _origXpPop(amount, msg);
  };
})();

// ── Holographic event popup ──────────────────────────────────────────
var _holoEvId = null;

var _holoOpenedAt = 0;

function showHoloEvent(evId) {
  if (!_isMobile()) return false;   // desktop handles normally

  var ev = (G.events || []).find(function(e) { return e.id === evId; });
  if (!ev) return false;

  _holoEvId = evId;
  _holoOpenedAt = Date.now(); /* timestamp for close guard */

  // Category
  var m   = (window.CATS && CATS[ev.category]) || { i:'●', c:'var(--cy)', bg:'rgba(0,229,255,.12)' };
  var catEl = document.getElementById('wl-holo-ev-cat');
  if (catEl) {
    catEl.textContent = m.i + ' ' + ev.category;
    catEl.style.color = m.c;
  }

  // Impact badge (High / Medium / Low)
  var impactBadge = document.getElementById('wl-holo-ev-impact-badge');
  if (impactBadge && ev.impact) {
    var imp = ev.impact;
    var impCol = imp === 'High' ? '#EF4444' : imp === 'Medium' ? '#F59E0B' : '#10B981';
    var impBg  = imp === 'High' ? 'rgba(239,68,68,.15)' : imp === 'Medium' ? 'rgba(245,158,11,.12)' : 'rgba(16,185,129,.10)';
    impactBadge.textContent = imp.toUpperCase();
    impactBadge.style.color = impCol;
    impactBadge.style.background = impBg;
    impactBadge.style.border = '1px solid ' + impCol + '44';
  }

  // Source link
  var srcLink = document.getElementById('wl-holo-source-link');
  if (srcLink) srcLink.href = ev.url || '#';

  // Title
  var titEl = document.getElementById('wl-holo-ev-title');
  if (titEl) titEl.textContent = ev.title || '';

  // Meta
  var metaEl = document.getElementById('wl-holo-ev-meta');
  if (metaEl) metaEl.textContent = [
    ev.country_name, ev.source, typeof tAgo === 'function' ? tAgo(new Date(ev.timestamp)) : ''
  ].filter(Boolean).join(' · ');

  // Summary
  var sumEl = document.getElementById('wl-holo-ev-summary');
  if (sumEl) sumEl.textContent = ev.ai_summary || ev.summary || '';

  // Severity ring
  var sev = parseFloat(ev.severity) || 5;
  var sevColor = sev >= 7 ? 'var(--re)' : sev >= 5 ? 'var(--am)' : 'var(--gr)';
  var sevValEl = document.getElementById('wl-holo-sev-val');
  var ringFill = document.getElementById('wl-holo-ring-fill');
  if (sevValEl) { sevValEl.textContent = sev.toFixed(1); sevValEl.style.color = sevColor; }
  if (ringFill) {
    ringFill.style.stroke = sevColor;
    // Circumference = 2π × 26 ≈ 163.4
    var offset = 163.4 * (1 - sev / 10);
    ringFill.style.setProperty('--ring-offset', offset.toFixed(1));
    ringFill.style.strokeDashoffset = offset.toFixed(1);
  }

  // Save button state
  var saveIcon  = document.getElementById('wl-holo-save-icon');
  var saveLabel = document.getElementById('wl-holo-save-label');
  var isSaved   = window._savedIds && _savedIds[evId];
  if (saveIcon)  saveIcon.textContent  = isSaved ? '✅' : '🔖';
  if (saveLabel) saveLabel.textContent = isSaved ? 'Saved' : 'Save';

  // Reset AI strip
  var aiStrip = document.getElementById('wl-holo-ai-strip');
  if (aiStrip) aiStrip.style.display = 'none';

  // Open popup
  var overlay = document.getElementById('wl-holo-event-overlay');
  if (overlay) overlay.classList.add('open');

  // Track
  if (typeof track === 'function') track('event_opened', 'mobile_holo', evId);

  // Load AI brief async (non-blocking)
  _loadHoloEventAI(ev);

  return true;  // intercept handled
}

function _loadHoloEventAI(ev) {
  var aiStrip = document.getElementById('wl-holo-ai-strip');
  var aiText  = document.getElementById('wl-holo-ai-text');
  if (!aiStrip || !aiText) return;

  // If ai_summary already exists show it immediately
  if (ev.ai_summary || ev.ai_market_note) {
    aiText.textContent  = ev.ai_summary || ev.ai_market_note || '';
    aiStrip.style.display = 'block';
    return;
  }

  // Otherwise fetch a quick 1-sentence brief
  if (!window.G || !G.token) return;
  if (typeof rq !== 'function') return;

  rq('/api/events/ai/ask', {
    method: 'POST',
    body: { event_id: ev.id, question: 'One sentence: market impact of this event?' }
  }).then(function(r) {
    if (r && (r.answer || r.response)) {
      aiText.textContent  = r.answer || r.response;
      aiStrip.style.display = 'block';
    }
  }).catch(function(){});
}

function closeHoloEvent(e) {
  /* Guard: ignore close attempts within 400ms of opening (prevents propagated touch events) */
  if (Date.now() - _holoOpenedAt < 400) return;
  if (e && e.target !== document.getElementById('wl-holo-event-overlay')) return;
  var overlay = document.getElementById('wl-holo-event-overlay');
  if (overlay) overlay.classList.remove('open');
  _holoEvId = null;
}

function holoEvAction(action) {
  var evId = _holoEvId;
  var ev   = evId && (G.events || []).find(function(e){ return e.id === evId; });

  // Close popup
  var overlay = document.getElementById('wl-holo-event-overlay');
  if (overlay) overlay.classList.remove('open');

  switch (action) {
    case 'map':
      mobileNav('map', null);
      if (ev && G.map) {
        setTimeout(function() {
          if (ev.latitude && ev.longitude)
            G.map.setView([ev.latitude, ev.longitude], 6, {animate:true});
          if (typeof openEP === 'function') openEP(evId);
        }, 350);
      }
      break;
    case 'save':
      if (evId) {
        var isSaved = window._savedIds && _savedIds[evId];
        var url = isSaved ? '/api/saved/' + evId : '/api/saved';
        rq(url, { method: isSaved ? 'DELETE' : 'POST', body: isSaved ? undefined : { event_id: evId } }).then(function() {
          if (window._savedIds) _savedIds[evId] = !isSaved;
          showHoloXP(10, isSaved ? 'Event unsaved' : 'Saved to reading list');
        });
      }
      break;
    case 'ai':
      mobileNav('ai', null);
      setTimeout(function() {
        if (ev && typeof aiSend === 'function')
          aiSend('Summarize this event and market impact: ' + (ev.title || ''));
      }, 300);
      break;
    case 'similar':
      mobileNav('map', null);
      setTimeout(function() {
        if (typeof openEP === 'function') openEP(evId);
        setTimeout(function() {
          var analysisTab = document.querySelector('.ep-tab[data-tab="analysis"]');
          if (analysisTab) analysisTab.click();
          if (typeof loadSimilarEvents === 'function') loadSimilarEvents();
        }, 400);
      }, 300);
      break;
    case 'alert':
      var evTitle = ev ? ev.title.slice(0,30) : '';
      mobileNav('alerts', null);
      setTimeout(function() {
        var alnInput = document.getElementById('aln');
        if (alnInput) alnInput.value = evTitle;
      }, 300);
      break;
    case 'markets':
      mobileNav('markets', null);
      break;
    case 'full':
      mobileNav('map', null);
      setTimeout(function() {
        if (typeof openEP === 'function') openEP(evId);
      }, 300);
      break;
  }
}

// ── Intercept event card taps on mobile to show holo popup ───────────
(function() {
  // Patch goEv to intercept on mobile
  var _origGoEv = window.goEv;
  window.goEv = function(id) {
    if (_isMobile() && showHoloEvent(id)) return;
    if (typeof _origGoEv === 'function') _origGoEv(id);
    else { sv('map', document.querySelector('[data-v=map]')); setTimeout(function(){ openEP(id); }, 500); }
  };

  // Also patch evcard click delegates
  document.addEventListener('click', function(e) {
    if (!_isMobile()) return;
    var card = e.target.closest('.evcard[data-eid]');
    if (!card) return;
    var impactBtn = e.target.closest('.impact-btn, .save-icon, a');
    if (impactBtn) return;
    e.preventDefault();
    e.stopPropagation();
    showHoloEvent(card.dataset.eid);
  }, true);
})();

// ── Touch swipe to dismiss more drawer ──────────────────────────────
(function() {
  var startY = 0;
  document.addEventListener('touchstart', function(e) {
    startY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    var dy = e.changedTouches[0].clientY - startY;
    if (dy > 60) {
      var drawer = document.getElementById('wl-more-drawer');
      if (drawer && drawer.classList.contains('open')) closeMoreDrawer();
    }
  }, { passive: true });
})();

// ── Track XP actions on mobile ───────────────────────────────────────
// Give XP for key actions when on mobile
var _mobileXpEvents = {
  'event_opened':     { xp: 5,  msg: 'Event Read' },
  'ai_question':      { xp: 10, msg: 'AI Asked' },
  'event_saved':      { xp: 10, msg: 'Event Saved' },
  'graph_built':      { xp: 15, msg: 'Graph Built' },
  'cascade_run':      { xp: 20, msg: 'Cascade Simulated' },
  'export_csv':       { xp: 25, msg: 'Data Exported' },
  'prediction_made':  { xp: 15, msg: 'Prediction Made' },
};

(function() {
  var _origTrack = window.track;
  window.track = function(action, section, detail) {
    if (typeof _origTrack === 'function') _origTrack(action, section, detail);
    if (_isMobile() && _mobileXpEvents[action]) {
      var ev = _mobileXpEvents[action];
      setTimeout(function() { showHoloXP(ev.xp, ev.msg); }, 300);
    }
  };
})();

/* ── Save user's personal AI key from profile page ────────────────────── */
window.saveUserAIKey = async function() {
  var inp    = document.getElementById('prof-ai-key');
  var status = document.getElementById('prof-ai-key-status');
  if (!inp || !inp.value.trim()) { if(status){status.style.display='block';status.textContent='Inserisci la chiave prima di salvare';} return; }
  var key = inp.value.trim();

  var show = function(msg, color) {
    if (!status) return;
    status.style.display = 'block';
    status.style.padding = '8px 12px';
    status.style.borderRadius = '8px';
    status.style.background = color + '18';
    status.style.color = color;
    status.style.border = '1px solid ' + color + '44';
    status.innerHTML = msg;
  };
  show('Salvataggio…', '#F59E0B');

  try {
    // Step 1: Save
    var r = await rq('/api/user/ai-key', { method:'POST', body:{ provider:'gemini', api_key:key } });
    if (!r || r.status !== 'ok') {
      show('✗ Errore salvataggio: ' + ((r&&r.message)||'sconosciuto'), '#EF4444');
      return;
    }

    show('✓ Salvata — verifica in corso…', '#F59E0B');
    inp.value = '';

    // Small delay to avoid triggering rate limit with back-to-back requests
    await new Promise(function(resolve) { setTimeout(resolve, 1500); });

    // Step 2: Test with diagnostics
    var testR = await rq('/api/user/ai-key/test', { method:'POST' });
    if (testR && testR.status === 'ok') {
      show('✅ ' + (testR.message || 'Chiave verificata!') + (testR.model ? ' <span style="opacity:.6;font-size:10px">(' + testR.model + ')</span>' : ''), '#10B981');
      // Reload brain + briefing
      setTimeout(function() {
        if (typeof loadBrainStats === 'function') loadBrainStats();
        if (typeof loadMacroBrief === 'function') loadMacroBrief();
        if (typeof loadDailyInsight === 'function') loadDailyInsight();
      }, 800);
    } else {
      var errMsg = (testR && testR.message) || 'Test fallito';
      var fixMsg = (testR && testR.fix) ? '<br><span style="font-size:10px;opacity:.8">' + testR.fix + '</span>' : '';
      show('⚠ Chiave salvata ma test fallito:<br>' + errMsg + fixMsg, '#EF4444');
    }
  } catch(e) {
    show('✗ Errore di rete: ' + (e&&e.message||'unknown'), '#EF4444');
  }
};


/* ═══════════ 21_agents_dash.js ═══════════ */
/**
 * WorldLens — Agent Dashboard v3 (21_agents_dash.js)
 * Block A: enriched prompts, delta, alerts, threshold, profile persistence
 * Block B: inline ask, signal sparkline, Bot vs Bot debate
 * Block C: streak, streak freeze, daily digest, predict & verify
 */
(function() {
'use strict';

var AGENTS   = {};
var _cfgOpen = null;
var _SIGNAL_MAP = {
  bullish:  { label: 'Bullish',  cls: 'ag-signal-bullish'  },
  bearish:  { label: 'Caution',  cls: 'ag-signal-bearish'  },
  critical: { label: 'Alert',    cls: 'ag-signal-critical' },
  neutral:  { label: 'Monitor',  cls: 'ag-signal-neutral'  },
};

// ── Boot ────────────────────────────────────────────────────────────────────
window.initAgentDash = function() {
  if (!G.token) return;

  // Retry until agents-grid is in DOM (can be called before fire dashboard renders)
  var attempts = 0;
  function tryInit() {
    var grid = document.getElementById('agents-grid');
    if (!grid && attempts++ < 15) { setTimeout(tryInit, 300); return; }

    rq('/api/agents/config').then(function(data) {
      if (!data || data.detail) {
        if (grid) grid.innerHTML = '<div style="padding:24px;text-align:center;color:var(--fire-text-dim);font-size:12px">Agent configuration unavailable.</div>';
        return;
      }
      AGENTS = data;
      renderAgentCards();
      loadAllBriefs();
      loadStreak();
      injectDebateSection();
    }).catch(function(e) {
      console.warn('[agents] initAgentDash error:', e);
    });
  }
  tryInit();
};

// ── Load briefs ─────────────────────────────────────────────────────────────
function loadAllBriefs() {
  // Step 1: Show instant event-based fallback for each card
  Object.keys(AGENTS).forEach(function(bid) {
    _showEventFallback(bid);
  });

  // Step 2: Fetch AI briefs (now parallel on server — ~4x faster)
  rq('/api/agents/all-briefs').then(function(data) {
    if (!data || data.detail) return;
    Object.keys(data).forEach(function(bid) {
      if (AGENTS[bid]) { AGENTS[bid].brief = data[bid]; refreshCardBrief(bid, data[bid]); }
    });
  }).catch(function() {
    // Fallback already shown — nothing more to do
  });
}

/** Show event data immediately without waiting for AI */
function _showEventFallback(bid) {
  var body = document.getElementById('ag-body-' + bid);
  if (!body) return;
  // Already has real content — don't overwrite
  if (body.querySelector('.ag-headline')) return;

  var agent = AGENTS[bid];
  if (!agent) return;

  // Get events for this bot from G.events
  var evs = (window.G && G.events) ? G.events.slice()
    .filter(function(e) {
      // rough category match by bot type
      var cat = (e.category || '').toLowerCase();
      if (bid === 'finance')     return cat.includes('econ') || cat.includes('financ') || cat.includes('market');
      if (bid === 'geopolitics') return cat.includes('geo') || cat.includes('conflict') || cat.includes('polit');
      if (bid === 'science')     return cat.includes('sci') || cat.includes('health') || cat.includes('disaster');
      if (bid === 'technology')  return cat.includes('tech') || cat.includes('cyber') || cat.includes('ai');
      return true;
    })
    .sort(function(a,b){ return (b.severity||0)-(a.severity||0); })
    .slice(0, 5) : [];

  if (!evs.length && window.G && G.events) {
    evs = G.events.slice(0, 3);
  }

  if (!evs.length) {
    body.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div><span>Fetching AI analysis…</span></div>';
    return;
  }

  var topEv = evs[0];
  var highSev = evs.filter(function(e){ return (e.severity||0) >= 7; }).length;

  body.innerHTML = [
    '<div class="ag-headline">' + (topEv.title || '').slice(0, 80) + '</div>',
    '<div class="ag-brief" style="font-style:italic;color:var(--t3);font-size:10px">AI analysis loading…</div>',
    evs.slice(0, 3).length ? '<div class="ag-ev-chips">' + evs.slice(0, 3).map(function(ev) {
      var sev = ev.severity || 5;
      var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#10B981';
      return '<div class="ag-ev-chip" style="--ev-col:' + col + '">'
        + '<span class="ag-ev-sev" style="color:' + col + ';background:' + col + '1a">' + sev.toFixed(0) + '</span>'
        + '<span class="ag-ev-title">' + ev.title.slice(0, 48) + '</span></div>';
    }).join('') + '</div>' : '',
    '<div class="ag-meta"><span class="ag-ev-count">' + evs.length + ' eventi monitorati</span></div>',
  ].join('');
}

window.loadOneBrief = function loadOneBrief(bid) {
  setCardLoading(bid);
  rq('/api/agents/brief/' + bid).then(function(d) {
    if (d && !d.detail) {
      if (AGENTS[bid]) AGENTS[bid].brief = d;
      refreshCardBrief(bid, d);
      if (d.streak) renderStreakBadge(d.streak);
    }
  });
};

// ── Card build ───────────────────────────────────────────────────────────────
function renderAgentCards() {
  var grid = document.getElementById('agents-grid');
  if (!grid) return;
  grid.innerHTML = '';
  ['finance','geopolitics','science','technology'].forEach(function(bid, i) {
    var ag = AGENTS[bid]; if (!ag) return;
    grid.appendChild(buildCard(ag, i));
  });
}

function buildCard(agent, idx) {
  var bid = agent.id;
  var cfg = agent.config || agent.defaults || {};
  var en  = cfg.enabled !== false;
  var div = document.createElement('div');
  div.className = 'ag-card' + (en ? '' : ' ag-disabled');
  div.id = 'agent-card-' + bid;
  div.style.setProperty('--ag-color',  agent.color);
  div.style.setProperty('--ag-accent', agent.accent);
  div.style.setProperty('--ag-border', agent.border);
  div.style.animationDelay = (idx * 0.08) + 's';
  var thr = (cfg.severity_threshold || 6.5).toFixed(1);
  div.innerHTML = [
    '<div class="ag-header">',
    ' <div class="ag-icon-wrap"><span class="ag-icon">' + agent.icon + '</span></div>',
    ' <div class="ag-title-col">',
    '  <div class="ag-name">' + agent.name + '</div>',
    '  <div class="ag-focus" id="ag-focus-lbl-' + bid + '">' + (cfg.focus||'—') + '</div>',
    ' </div>',
    ' <div class="ag-header-right">',
    '  <div class="ag-signal ag-signal-neutral" id="ag-signal-' + bid + '">—</div>',
    '  <button class="ag-settings-btn" onclick="agentOpenConfig(\'' + bid + '\')" title="Configure">⚙</button>',
    ' </div>',
    '</div>',
    '<div class="ag-meta-row" id="ag-meta-' + bid + '">',
    ' <span class="ag-thresh-lbl">Alert ≥<span id="ag-thresh-val-' + bid + '">' + thr + '</span></span>',
    ' <div class="ag-sparkline-wrap" id="ag-spark-' + bid + '"></div>',
    ' <div class="ag-conf-wrap"><div class="ag-conf-bar" id="ag-conf-' + bid + '" style="width:0%"></div></div>',
    ' <span class="ag-conf-num" id="ag-conf-num-' + bid + '">—</span>',
    '</div>',
    '<div class="ag-alerts-strip" id="ag-alerts-' + bid + '" style="display:none"></div>',
    '<div class="ag-delta-banner" id="ag-delta-' + bid + '" style="display:none"></div>',
    '<div class="ag-body" id="ag-body-' + bid + '">',
    ' <div class="ag-loading"><div class="ag-spinner"></div><span>Loading…</span></div>',
    '</div>',
    '<div class="ag-inline-ask" id="ag-ask-' + bid + '" style="display:none">',
    ' <div class="ag-ask-row">',
    '  <input class="ag-ask-input" id="ag-ask-inp-' + bid + '" type="text" placeholder="Ask ' + agent.name + '…" autocomplete="off">',
    '  <button class="ag-ask-send" onclick="agentSendInline(\'' + bid + '\')">→</button>',
    ' </div>',
    ' <div class="ag-ask-ans" id="ag-ask-ans-' + bid + '" style="display:none"></div>',
    '</div>',
    '<div class="ag-footer">',
    ' <button class="ag-action-btn ag-btn-primary" onclick="agentToggleAsk(\'' + bid + '\')">💬 Ask</button>',
    ' <button class="ag-action-btn ag-btn-secondary" onclick="loadOneBrief(\'' + bid + '\')">↻</button>',
    ' <button class="ag-action-btn ag-btn-secondary" onclick="agentOpenConfig(\'' + bid + '\')">⚙</button>',
    '</div>',
    buildConfigPanel(agent, cfg),
  ].join('');
  loadSparkline(bid);
  return div;
}

function setCardLoading(bid) {
  var body = document.getElementById('ag-body-' + bid);
  if (body) body.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div><span>Analysing…</span></div>';
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function loadSparkline(bid) {
  rq('/api/agents/history/' + bid).then(function(d) {
    if (!d || !d.history || !d.history.length) return;
    renderSparkline(bid, d.history);
  });
}

function renderSparkline(bid, history) {
  var wrap = document.getElementById('ag-spark-' + bid);
  if (!wrap) return;
  var W = 52, H = 14;
  var sigScore = { bullish: 4, neutral: 2, bearish: 1, critical: 0 };
  var sigColor = { bullish: '#10B981', neutral: '#94A3B8', bearish: '#F59E0B', critical: '#EF4444' };
  var pts = history.map(function(h) { return sigScore[h.signal] !== undefined ? sigScore[h.signal] : 2; });
  if (pts.length < 2) { wrap.innerHTML = ''; return; }
  var min = 0, max = 4, step = W / (pts.length - 1);
  var coords = pts.map(function(v, i) {
    return [(i * step).toFixed(1), (H - (v / max * H)).toFixed(1)];
  });
  var polyline = coords.map(function(c) { return c[0] + ',' + c[1]; }).join(' ');
  var lastSig  = history[history.length - 1].signal;
  var col      = sigColor[lastSig] || '#94A3B8';
  wrap.innerHTML = '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '">'
    + '<polyline points="' + polyline + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round"/>'
    + '<circle cx="' + coords[coords.length-1][0] + '" cy="' + coords[coords.length-1][1] + '" r="2.5" fill="' + col + '"/>'
    + '</svg>';
}

// ── Refresh brief ─────────────────────────────────────────────────────────────
function refreshCardBrief(bid, brief) {
  var body    = document.getElementById('ag-body-'    + bid);
  var sigEl   = document.getElementById('ag-signal-'  + bid);
  var confEl  = document.getElementById('ag-conf-'    + bid);
  var confNum = document.getElementById('ag-conf-num-'+ bid);
  var deltaEl = document.getElementById('ag-delta-'   + bid);
  var alertEl = document.getElementById('ag-alerts-'  + bid);
  if (!body) return;

  var sig = _SIGNAL_MAP[brief.signal] || _SIGNAL_MAP.neutral;
  if (sigEl) { sigEl.textContent = sig.label; sigEl.className = 'ag-signal ' + sig.cls; }

  var conf = parseInt(brief.confidence || 0, 10);
  if (confEl)  confEl.style.width  = conf + '%';
  if (confNum) confNum.textContent = conf + '%';

  var alerts = brief.threshold_alerts || [];
  if (alertEl) {
    if (alerts.length) {
      alertEl.style.display = 'block';
      alertEl.innerHTML = alerts.map(function(a) {
        var col = a.severity >= 8 ? '#EF4444' : '#F59E0B';
        return '<div class="ag-alert-item" style="--al-col:' + col + '">'
          + '<span class="ag-alert-sev" style="color:' + col + '">' + a.severity.toFixed(1) + '</span>'
          + '<span class="ag-alert-title">' + a.title.slice(0,55) + '</span></div>';
      }).join('');
    } else {
      alertEl.style.display = 'none';
    }
  }

  var delta = brief.delta;
  if (deltaEl) {
    if (delta && delta.summary) {
      var chg = delta.signal_changed;
      deltaEl.style.display = 'flex';
      deltaEl.innerHTML = '<span class="ag-delta-icon" style="color:' + (chg ? 'var(--am)' : 'var(--t3)') + '">'
        + (chg ? '⚡' : '↔') + '</span>'
        + '<span class="ag-delta-txt">' + delta.summary + '</span>';
    } else { deltaEl.style.display = 'none'; }
  }

  var kpHtml = brief.key_points && brief.key_points.length
    ? '<ul class="ag-key-points">' + brief.key_points.slice(0,3).map(function(p){ return '<li>' + p + '</li>'; }).join('') + '</ul>' : '';

  var actHtml = brief.actions && brief.actions.length
    ? '<div class="ag-actions-list">' + brief.actions.slice(0,2).map(function(a){ return '<div class="ag-action-item">→ ' + a + '</div>'; }).join('') + '</div>' : '';

  var evHtml = '';
  if (brief.top_events && brief.top_events.length) {
    evHtml = '<div class="ag-ev-chips">'
      + brief.top_events.slice(0,3).map(function(ev) {
          var sev = ev.severity || 5;
          var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#10B981';
          return '<div class="ag-ev-chip" style="--ev-col:' + col + '">'
            + '<span class="ag-ev-sev" style="color:' + col + ';background:' + col + '1a">' + sev.toFixed(0) + '</span>'
            + '<span class="ag-ev-title">' + ev.title.slice(0,50) + '</span></div>';
        }).join('') + '</div>';
  }

  body.innerHTML = [
    '<div class="ag-headline">' + (brief.headline || '') + '</div>',
    '<div class="ag-brief">'   + (brief.brief    || 'No data available.') + '</div>',
    kpHtml, actHtml, evHtml,
    '<div class="ag-meta"><span class="ag-ev-count">' + (brief.event_count||0) + ' events monitored</span></div>',
  ].join('');

  loadSparkline(bid);
}

// ── Block B: Inline Ask ──────────────────────────────────────────────────────
window.agentToggleAsk = function(bid) {
  var box = document.getElementById('ag-ask-' + bid);
  if (!box) return;
  var opening = box.style.display === 'none';
  box.style.display = opening ? 'block' : 'none';
  if (opening) {
    var inp = document.getElementById('ag-ask-inp-' + bid);
    if (inp) setTimeout(function(){ inp.focus(); }, 80);
  }
};

window.agentSendInline = function(bid) {
  var inp = document.getElementById('ag-ask-inp-' + bid);
  var ans = document.getElementById('ag-ask-ans-' + bid);
  if (!inp || !ans) return;
  var q = inp.value.trim();
  if (!q) return;

  ans.style.display = 'block';
  ans.innerHTML = '<div class="ag-loading"><div class="ag-spinner"></div><span>Thinking…</span></div>';

  rq('/api/agents/ask/' + bid, { method: 'POST', body: { question: q } }).then(function(d) {
    if (d && d.answer) {
      ans.innerHTML = '<div class="ag-ask-response">' + d.answer + '</div>';
    } else {
      ans.innerHTML = '<div class="ag-ask-response" style="color:var(--re)">No response.</div>';
    }
  });

  inp.value = '';
};

// Handle Enter key in ask input
document.addEventListener('keydown', function(e) {
  if (e.key !== 'Enter') return;
  var t = e.target;
  if (!t || !t.classList.contains('ag-ask-input')) return;
  var bid = t.id.replace('ag-ask-inp-', '');
  agentSendInline(bid);
});

// ── Block B: Bot vs Bot debate ───────────────────────────────────────────────
function injectDebateSection() {
  var header = document.querySelector('.agents-section-header');
  if (!header) return;
  if (document.getElementById('ag-debate-btn')) return;
  var btn = document.createElement('button');
  btn.id = 'ag-debate-btn';
  btn.className = 'agents-refresh-btn ag-debate-btn';
  btn.innerHTML = '⚔ Bot vs Bot';
  btn.onclick = loadDebate;
  header.appendChild(btn);

  // Insert debate panel after agents-grid
  var grid = document.getElementById('agents-grid');
  if (!grid) return;
  var panel = document.createElement('div');
  panel.id = 'ag-debate-panel';
  panel.style.display = 'none';
  grid.parentNode.insertBefore(panel, grid.nextSibling);
}

function loadDebate() {
  var panel = document.getElementById('ag-debate-panel');
  var btn   = document.getElementById('ag-debate-btn');
  if (!panel) return;

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    if (btn) btn.classList.remove('on');
    return;
  }

  panel.style.display = 'block';
  if (btn) btn.classList.add('on');
  panel.innerHTML = '<div class="ag-debate-loading"><div class="ag-spinner"></div><span>Bots are debating…</span></div>';

  rq('/api/agents/debate').then(function(d) {
    if (!d || !d.takes || !d.takes.length) {
      panel.innerHTML = '<div class="ag-debate-empty">No event data for debate. Check back later.</div>';
      return;
    }
    var evHtml = d.event
      ? '<div class="ag-debate-event"><span class="ag-debate-topic-label">TODAY\'S TOPIC</span>'
        + '<div class="ag-debate-event-title">' + d.event.title + '</div>'
        + '<span class="ag-debate-sev" style="color:' + (d.event.severity >= 7 ? '#EF4444' : '#F59E0B') + '">'
        + d.event.severity.toFixed(1) + '/10</span></div>'
      : '';

    var takesHtml = d.takes.map(function(t) {
      return '<div class="ag-debate-take" style="--ag-color:' + t.color + '">'
        + '<div class="ag-debate-bot"><span>' + t.icon + '</span><span>' + t.name + '</span></div>'
        + '<div class="ag-debate-text">' + t.take + '</div>'
        + '</div>';
    }).join('');

    panel.innerHTML = '<div class="ag-debate-wrap">' + evHtml + '<div class="ag-debate-takes">' + takesHtml + '</div></div>';
  });
}

// ── Block C: Streak ──────────────────────────────────────────────────────────
function loadStreak() {
  rq('/api/agents/streak').then(function(d) {
    if (d && typeof d.current_streak !== 'undefined') renderStreakBadge(d);
  });
}

function renderStreakBadge(d) {
  var sec = document.querySelector('.agents-section-header');
  if (!sec) return;
  var badge = document.getElementById('ag-streak-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'ag-streak-badge';
    badge.className = 'ag-streak-badge';
    sec.appendChild(badge);
  }
  var streak = d.current_streak || 0;
  var level  = d.level || 'new';
  var flame  = streak >= 7 ? '🔥' : streak >= 3 ? '⚡' : '📅';
  var lvlColor = { platinum: '#E2E8F0', gold: '#F59E0B', silver: '#94A3B8', bronze: '#CD7F32', new: '#4B5563' };
  badge.style.color = lvlColor[level] || '#4B5563';
  badge.innerHTML = '<span class="ag-streak-icon">' + flame + '</span>'
    + '<span class="ag-streak-num">' + streak + '</span>'
    + '<span class="ag-streak-label">day streak</span>';
  badge.title = 'Longest: ' + (d.longest_streak||0) + ' days | Total reads: ' + (d.total_reads||0);
  badge.onclick = function() { showStreakModal(d); };
}

function showStreakModal(d) {
  var existing = document.getElementById('ag-streak-modal');
  if (existing) { existing.remove(); return; }

  var streak   = d.current_streak || 0;
  var longest  = d.longest_streak || 0;
  var reads    = d.total_reads    || 0;
  var level    = d.level          || 'new';
  var next     = d.next_level     || {};
  var frozen   = d.streak_frozen  === 1;

  var modal = document.createElement('div');
  modal.id  = 'ag-streak-modal';
  modal.className = 'ag-streak-modal';
  modal.innerHTML = [
    '<div class="ag-streak-modal-inner">',
    ' <button class="ag-streak-modal-close" onclick="document.getElementById(\'ag-streak-modal\').remove()">×</button>',
    ' <div class="ag-streak-modal-title">🔥 Reading Streak</div>',
    ' <div class="ag-streak-big">' + streak + '</div>',
    ' <div class="ag-streak-days-label">consecutive days</div>',
    ' <div class="ag-streak-stats">',
    '  <div class="ag-streak-stat"><span>' + longest + '</span><label>Best streak</label></div>',
    '  <div class="ag-streak-stat"><span>' + reads + '</span><label>Total reads</label></div>',
    '  <div class="ag-streak-stat"><span>' + level.charAt(0).toUpperCase() + level.slice(1) + '</span><label>Level</label></div>',
    ' </div>',
    next.name ? '<div class="ag-streak-next">Next: <b>' + next.name + '</b> in ' + (next.days - streak) + ' days → ' + next.perk + '</div>' : '',
    !frozen ? '<button class="ag-btn-freeze" onclick="agentUseFreeze()">🧊 Use Streak Freeze</button>'
             : '<div class="ag-freeze-used">Streak freeze active ✓</div>',
    '</div>',
  ].join('');
  document.body.appendChild(modal);
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });
}

window.agentUseFreeze = function() {
  rq('/api/agents/streak/freeze', { method: 'POST' }).then(function(d) {
    if (d && d.status === 'freeze_applied') {
      toast('Streak freeze applied! Miss tomorrow without breaking your streak.', 's', 3000);
      document.getElementById('ag-streak-modal') && document.getElementById('ag-streak-modal').remove();
      loadStreak();
    } else {
      toast(d && d.error ? d.error : 'Freeze unavailable', 'e', 2500);
    }
  });
};

// ── Block C: Daily Digest ────────────────────────────────────────────────────
window.loadAllDigests = function() {
  rq('/api/agents/digest/all/today').then(function(d) {
    if (!d || !d.results) return;
    Object.keys(d.results).forEach(function(bid) {
      renderDigestInCard(bid, d.results[bid]);
    });
    if (d.streak) renderStreakBadge(d.streak);
  });
};

function renderDigestInCard(bid, data) {
  var body = document.getElementById('ag-body-' + bid);
  if (!body || !data.digest) return;
  var dg = data.digest;
  var top3Html = (dg.top3 || []).map(function(e) {
    var sev = e.severity || 5;
    var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#10B981';
    return '<div class="ag-ev-chip" style="--ev-col:' + col + '">'
      + '<span class="ag-ev-sev" style="color:' + col + ';background:' + col + '1a">' + sev.toFixed(0) + '</span>'
      + '<span class="ag-ev-title">' + (e.title || '').slice(0,50) + '</span></div>';
  }).join('');
  body.innerHTML = '<div class="ag-digest-badge">☀ Morning Digest</div>'
    + '<div class="ag-brief">' + (dg.summary || '') + '</div>'
    + (top3Html ? '<div class="ag-ev-chips">' + top3Html + '</div>' : '');
}

// ── Block C: Predict & Verify ────────────────────────────────────────────────
window.loadAllPredictions = function() {
  rq('/api/agents/predict/all/this-week').then(function(data) {
    if (!data) return;
    Object.keys(data).forEach(function(bid) {
      renderPredictionInCard(bid, data[bid]);
    });
  });
};

function renderPredictionInCard(bid, data) {
  if (!data || !data.prediction) return;
  var pred   = data.prediction;
  var verify = data.verify;
  var card   = document.getElementById('agent-card-' + bid);
  if (!card) return;

  var existing = card.querySelector('.ag-prediction-strip');
  if (existing) existing.remove();

  var dirColor = { bullish:'#10B981', bearish:'#F59E0B', critical:'#EF4444', volatile:'#8B5CF6', neutral:'#94A3B8' };
  var col = dirColor[pred.direction] || '#94A3B8';

  var verifyHtml = '';
  if (verify) {
    var oc = verify.outcome;
    var vcol = oc === 'correct' ? '#10B981' : oc === 'partial' ? '#F59E0B' : '#EF4444';
    var vicon = oc === 'correct' ? '✓' : oc === 'partial' ? '~' : '✗';
    verifyHtml = '<div class="ag-verify-result" style="color:' + vcol + '">'
      + vicon + ' ' + (verify.explanation || oc) + '</div>';
  }

  var strip = document.createElement('div');
  strip.className = 'ag-prediction-strip';
  strip.innerHTML = '<div class="ag-pred-label">📅 This week\'s prediction</div>'
    + '<div class="ag-pred-headline" style="border-left-color:' + col + '">' + pred.headline + '</div>'
    + '<div class="ag-pred-meta">'
    +  '<span class="ag-pred-dir" style="color:' + col + '">' + (pred.direction||'') + '</span>'
    +  '<span class="ag-pred-conf">' + (pred.confidence||'?') + '% confidence</span>'
    + '</div>'
    + verifyHtml;

  var footer = card.querySelector('.ag-footer');
  if (footer) card.insertBefore(strip, footer);
  else card.appendChild(strip);
}

// ── Config panel ─────────────────────────────────────────────────────────────
function buildConfigPanel(agent, cfg) {
  var bid = agent.id;
  var thr  = (cfg.severity_threshold || 6.5).toFixed(1);
  var wl   = (cfg.watch_regions || []).join(', ');
  var cn   = cfg.custom_notes || '';
  var fo   = (agent.focus_options  || []).map(function(f){ return '<option value="' + f + '"' + (cfg.focus   === f ? ' selected':'') + '>' + f + '</option>'; }).join('');
  var to   = (agent.tone_options   || []).map(function(t){ return '<option value="' + t + '"' + (cfg.tone    === t ? ' selected':'') + '>' + t + '</option>'; }).join('');
  var ao   = (agent.alert_options  || []).map(function(a){ return '<option value="' + a + '"' + (cfg.alerts  === a ? ' selected':'') + '>' + a + '</option>'; }).join('');
  return [
    '<div class="ag-config-panel" id="ag-cfg-' + bid + '" style="display:none">',
    '<div class="ag-cfg-title">Configure ' + agent.name + '</div>',
    '<div class="ag-cfg-row"><label class="ag-cfg-label">Focus Area</label><select class="ag-cfg-select" id="ag-focus-' + bid + '">' + fo + '</select></div>',
    '<div class="ag-cfg-row"><label class="ag-cfg-label">Response Tone</label><select class="ag-cfg-select" id="ag-tone-' + bid + '">' + to + '</select></div>',
    '<div class="ag-cfg-row"><label class="ag-cfg-label">Alert Filter</label><select class="ag-cfg-select" id="ag-alerts-' + bid + '">' + ao + '</select></div>',
    '<div class="ag-cfg-row ag-cfg-col">',
    ' <div style="display:flex;justify-content:space-between"><label class="ag-cfg-label">Alert Threshold</label><span class="ag-cfg-val-badge" id="ag-thresh-badge-' + bid + '">' + thr + '</span></div>',
    ' <input type="range" class="ag-cfg-range" id="ag-thresh-' + bid + '" min="4" max="10" step="0.5" value="' + thr + '" oninput="agentThresholdChange(\'' + bid + '\',this.value)">',
    ' <div class="ag-cfg-range-labels"><span>4.0</span><span>7.0</span><span>10.0</span></div>',
    '</div>',
    '<div class="ag-cfg-row ag-cfg-col"><label class="ag-cfg-label">Watch Regions <span class="ag-cfg-hint">(ISO codes, comma-sep)</span></label><input type="text" class="ag-cfg-input" id="ag-regions-' + bid + '" placeholder="US, DE, CN …" value="' + wl + '"></div>',
    '<div class="ag-cfg-row ag-cfg-col"><label class="ag-cfg-label">Personal Context <span class="ag-cfg-hint">(injected into prompt)</span></label><textarea class="ag-cfg-textarea" id="ag-notes-' + bid + '" rows="3" placeholder="e.g. I manage a European equity portfolio…">' + cn + '</textarea></div>',
    '<div class="ag-cfg-row" style="justify-content:space-between;align-items:center"><label class="ag-cfg-label">Bot Active</label><label class="ag-toggle"><input type="checkbox" id="ag-enabled-' + bid + '"' + (cfg.enabled !== false ? ' checked':'') + '><span class="ag-toggle-track"></span></label></div>',
    '<div class="ag-cfg-actions">',
    '<button class="ag-action-btn ag-btn-primary"  onclick="agentSaveConfig(\'' + bid + '\')">💾 Save</button>',
    '<button class="ag-action-btn ag-btn-ghost"    onclick="agentResetConfig(\'' + bid + '\')">↩ Reset</button>',
    '<button class="ag-action-btn ag-btn-ghost"    onclick="agentCloseConfig(\'' + bid + '\')">Cancel</button>',
    '</div></div>',
  ].join('');
}

// ── Config handlers ───────────────────────────────────────────────────────────
window.agentOpenConfig = function(bid) {
  if (_cfgOpen && _cfgOpen !== bid) agentCloseConfig(_cfgOpen);
  var p = document.getElementById('ag-cfg-' + bid);
  var c = document.getElementById('agent-card-' + bid);
  if (!p) return;
  var open = p.style.display === 'none';
  p.style.display = open ? 'block' : 'none';
  if (c) c.classList.toggle('ag-config-active', open);
  _cfgOpen = open ? bid : null;
};

window.agentCloseConfig = function(bid) {
  var p = document.getElementById('ag-cfg-' + bid);
  var c = document.getElementById('agent-card-' + bid);
  if (p) p.style.display = 'none';
  if (c) c.classList.remove('ag-config-active');
  if (_cfgOpen === bid) _cfgOpen = null;
};

window.agentThresholdChange = function(bid, val) {
  var b = document.getElementById('ag-thresh-badge-' + bid);
  if (b) b.textContent = parseFloat(val).toFixed(1);
};

window.agentSaveConfig = function(bid) {
  var f = document.getElementById('ag-focus-'   + bid);
  var t = document.getElementById('ag-tone-'    + bid);
  var a = document.getElementById('ag-alerts-'  + bid);
  var r = document.getElementById('ag-thresh-'  + bid);
  var g = document.getElementById('ag-regions-' + bid);
  var n = document.getElementById('ag-notes-'   + bid);
  var e = document.getElementById('ag-enabled-' + bid);
  if (!f) return;

  var regions = (g ? g.value : '').split(',').map(function(x){ return x.trim().toUpperCase(); }).filter(function(x){ return x.length >= 2; });
  var cfg = {
    focus: f.value, tone: t ? t.value : 'Professional',
    alerts: a ? a.value : 'High Impact Only',
    severity_threshold: r ? parseFloat(r.value) : 6.5,
    watch_regions: regions,
    custom_notes: n ? n.value.trim() : '',
    enabled: e ? e.checked : true,
  };

  rq('/api/agents/config/' + bid, { method: 'POST', body: cfg }).then(function(res) {
    if (res && res.status === 'saved') {
      if (AGENTS[bid]) AGENTS[bid].config = res.config;
      var fl = document.getElementById('ag-focus-lbl-' + bid);
      if (fl) fl.textContent = cfg.focus;
      var tv = document.getElementById('ag-thresh-val-' + bid);
      if (tv) tv.textContent = cfg.severity_threshold.toFixed(1);
      var card = document.getElementById('agent-card-' + bid);
      if (card) card.classList.toggle('ag-disabled', !cfg.enabled);
      agentCloseConfig(bid);
      if (cfg.enabled) loadOneBrief(bid);
      toast('Config saved', 's', 2000);
    } else { toast('Save failed', 'e', 2500); }
  });
};

window.agentResetConfig = function(bid) {
  rq('/api/agents/reset/' + bid, { method: 'POST' }).then(function(res) {
    if (res && res.config) {
      if (AGENTS[bid]) AGENTS[bid].config = res.config;
      agentCloseConfig(bid);
      var grid = document.getElementById('agents-grid');
      var old  = document.getElementById('agent-card-' + bid);
      if (grid && old && AGENTS[bid]) {
        var idx = Array.from(grid.children).indexOf(old);
        grid.replaceChild(buildCard(AGENTS[bid], idx >= 0 ? idx : 0), old);
      }
      loadOneBrief(bid);
      toast('Reset to defaults', 's', 2000);
    }
  });
};

window.agentAsk = function(bid) {
  var ag = AGENTS[bid]; if (!ag) return;
  sv('ai', document.querySelector('[data-v=ai]'));
  setTimeout(function() {
    var cfg   = ag.config || ag.defaults || {};
    var brief = ag.brief  || {};
    var evs   = (brief.top_events || []).slice(0,3).map(function(e){ return e.title; }).join('; ');
    var prompt = 'I am using ' + ag.name + ' focused on ' + cfg.focus + '. '
      + 'Current signal: ' + (brief.signal||'neutral') + '. '
      + (brief.headline ? 'Latest: ' + brief.headline + '. ' : '')
      + (evs ? 'Top events: ' + evs + '. ' : '')
      + 'Give me a deeper analysis and specific actionable insights.';
    if (typeof aiSend === 'function') aiSend(prompt);
  }, 300);
};

window.refreshAgentBriefs = loadAllBriefs;

})();

/* ═══════════ 23_dash_globe.js ═══════════ */
/**
 * 23_dash_globe.js — Dashboard Globe (v21 FINAL)
 *
 * Fixes applied:
 *   1. Globe initialises reliably — uses ResizeObserver + MutationObserver
 *      so it starts the moment the canvas has real dimensions, not on a timer
 *   2. 10-second auto-cycle through regions with smooth rotation
 *   3. AI Zone Briefing popup writes to fire-zone-* IDs with fade transition
 *   4. Fallback stub regions if /api/globe/regions fails or returns empty
 *   5. No puter.js, no external deps beyond Three.js (already in index.html)
 *   6. Gemini AI summaries consumed directly from /api/globe/regions response
 *   7. Drag-to-rotate (mouse + touch) with auto-resume after release
 *   8. Pause/Resume button wired correctly
 */
(function () {
'use strict';

/* ── State ─────────────────────────────────────────────────────────────── */
var DG = {
  scene: null, camera: null, renderer: null,
  globe: null, markerGroup: null, beaconGroup: null,
  regions: [],
  activeIdx: 0,
  autoRotate: true,
  raf: null,
  cycleTimer: null,
  initialized: false,
  _initAttempts: 0,
};

var R        = 1.0;
var ATM      = 1.055;
var CYCLE_MS = 10000; // 10 s as requested

/* ── Stub regions shown while API loads ─────────────────────────────────── */
var STUB_REGIONS = [
  { name: 'Europe',        center: [54,15],  color:'#ff4a1a', emoji:'🌍',
    risk:7.2, event_count:412, trend:'↑',
    summary:'Cross-border tensions and energy disruptions dominate the intelligence picture.' },
  { name: 'Middle East',   center: [27,43],  color:'#ff8f00', emoji:'🌍',
    risk:8.1, event_count:267, trend:'↑',
    summary:'Strait of Hormuz traffic rerouted. Brent premium at multi-week high.' },
  { name: 'East Asia',     center: [35,115], color:'#ffb547', emoji:'🌏',
    risk:6.3, event_count:189, trend:'→',
    summary:'Naval posturing at three flashpoints. Regional FX in defensive positioning.' },
  { name: 'South Asia',    center: [23,78],  color:'#ffb547', emoji:'🌏',
    risk:5.8, event_count:134, trend:'→',
    summary:'Political transitions on schedule. Copper stabilising after volatility.' },
  { name: 'Africa',        center: [5,22],   color:'#ffb547', emoji:'🌍',
    risk:6.0, event_count:184, trend:'↑',
    summary:'Uranium export halt entering day 3. European utilities reviewing 60-day buffers.' },
  { name: 'Americas',      center: [10,-80], color:'#6b9b5e', emoji:'🌎',
    risk:4.2, event_count:298, trend:'↓',
    summary:'Macro indicators stabilising. No critical escalation pathways active.' },
];

/* ── Boot: called by 02_core.js after login ─────────────────────────────── */
window.initDashGlobe = function () {
  if (DG.initialized) return;

  /* Three.js guard */
  if (typeof THREE === 'undefined') {
    if (++DG._initAttempts < 25) setTimeout(window.initDashGlobe, 400);
    return;
  }

  var wrap = document.getElementById('db-globe-canvas-wrap');
  var canvas = document.getElementById('db-globe-canvas');
  if (!wrap || !canvas) return;

  /* Wait for real layout dimensions */
  if (wrap.offsetWidth < 10) {
    if (++DG._initAttempts < 40) setTimeout(window.initDashGlobe, 250);
    return;
  }

  DG.initialized = true;
  DG._initAttempts = 0;
  _build(wrap, canvas);
};

/* ── Build Three.js scene ───────────────────────────────────────────────── */
function _build(wrap, canvas) {
  var W = wrap.offsetWidth;
  var H = Math.max(wrap.offsetHeight || 0, 300);

  /* Renderer */
  DG.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  DG.renderer.setSize(W, H);
  DG.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  DG.renderer.setClearColor(0x000000, 0);

  /* Scene + camera */
  DG.scene  = new THREE.Scene();
  DG.camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  DG.camera.position.z = 2.8;

  /* Lighting */
  DG.scene.add(new THREE.AmbientLight(0x1a0d00, 1.5));
  var sun = new THREE.DirectionalLight(0xffd580, 1.8);
  sun.position.set(3, 2, 2);
  DG.scene.add(sun);

  /* Stars */
  var sg = new THREE.BufferGeometry();
  var sp = new Float32Array(1800 * 3);
  for (var i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * 60;
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  DG.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xffeedd, size: 0.05, transparent: true, opacity: 0.35
  })));

  /* Globe sphere */
  var mat = new THREE.MeshPhongMaterial({
    color: 0x080c14, emissive: 0x020408, shininess: 18, specular: 0x1a2a40
  });
  /* Try loading texture — gracefully fall back to plain sphere on CORS error */
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function () {
    var tex = new THREE.Texture(img);
    tex.needsUpdate = true;
    mat.map = tex;
    mat.needsUpdate = true;
  };
  img.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/textures/planets/earth_atmos_2048.jpg';

  DG.globe = new THREE.Mesh(new THREE.SphereGeometry(R, 56, 56), mat);
  DG.globe.rotation.z = 0.41;
  DG.scene.add(DG.globe);

  /* Wireframe grid overlay */
  DG.scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(R + 0.001, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0xff8f00, transparent: true, opacity: 0.025, wireframe: true })
  ));

  /* Atmosphere glow — amber fire */
  DG.scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(ATM, 48, 48),
    new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader:   'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec3 vN;void main(){float i=pow(.72-dot(vN,vec3(0,0,1)),2.2);gl_FragColor=vec4(.95,.45,.05,i*.45);}',
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true
    })
  ));

  /* Marker + beacon groups */
  DG.markerGroup = new THREE.Group(); DG.markerGroup.rotation.z = 0.41;
  DG.beaconGroup = new THREE.Group(); DG.beaconGroup.rotation.z = 0.41;
  DG.scene.add(DG.markerGroup);
  DG.scene.add(DG.beaconGroup);

  /* Responsive resize */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      var nW = wrap.offsetWidth, nH = Math.max(wrap.offsetHeight || 0, 300);
      if (nW < 10) return;
      DG.renderer.setSize(nW, nH);
      DG.camera.aspect = nW / nH;
      DG.camera.updateProjectionMatrix();
    }).observe(wrap);
  }

  _setupInteraction(canvas);
  _setupPauseBtn();
  _animate();

  /* Show stubs immediately, then replace with live data */
  DG.regions = STUB_REGIONS;
  _buildBeacons(STUB_REGIONS);
  _buildNavDots(STUB_REGIONS);
  _showRegion(0);
  _startCycle();

  /* Load live data — replaces stubs */
  _loadRegions();
  setInterval(function () {
    if (!document.hidden) _loadRegions();
  }, 120000);
}

/* ── Animation loop ────────────────────────────────────────────────────── */
function _animate() {
  DG.raf = requestAnimationFrame(_animate);
  if (document.hidden) return;

  if (DG.autoRotate && DG.globe) {
    var speed = 0.0015;
    DG.globe.rotation.y      += speed;
    if (DG.markerGroup) DG.markerGroup.rotation.y += speed;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += speed;
  }

  /* Pulse beacons */
  if (DG.beaconGroup) {
    var t = Date.now() / 900;
    DG.beaconGroup.children.forEach(function (m, i) {
      var s = 1 + 0.28 * Math.sin(t + i * 1.1);
      m.scale.setScalar(s);
      if (m.material) m.material.opacity = 0.3 + 0.15 * Math.sin(t + i);
    });
  }

  if (DG.renderer) DG.renderer.render(DG.scene, DG.camera);
}

/* ── Interaction: drag rotate + click overlay ─────────────────────────── */
function _setupInteraction(canvas) {
  var down = false, lastX = 0;

  canvas.addEventListener('mousedown', function (e) {
    down = true; lastX = e.clientX; DG.autoRotate = false;
  });
  window.addEventListener('mouseup', function () {
    down = false; DG.autoRotate = true;
  });
  canvas.addEventListener('mousemove', function (e) {
    if (!down || !DG.globe) return;
    var dx = e.clientX - lastX;
    DG.globe.rotation.y      += dx * 0.008;
    if (DG.markerGroup) DG.markerGroup.rotation.y += dx * 0.008;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += dx * 0.008;
    lastX = e.clientX;
  });

  /* Touch */
  canvas.addEventListener('touchstart', function (e) {
    if (e.touches[0]) { down = true; lastX = e.touches[0].clientX; DG.autoRotate = false; }
  }, { passive: true });
  canvas.addEventListener('touchend', function () { down = false; DG.autoRotate = true; });
  canvas.addEventListener('touchmove', function (e) {
    if (!down || !DG.globe) return;
    var dx = e.touches[0].clientX - lastX;
    DG.globe.rotation.y      += dx * 0.008;
    if (DG.markerGroup) DG.markerGroup.rotation.y += dx * 0.008;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += dx * 0.008;
    lastX = e.touches[0].clientX;
    e.preventDefault();
  }, { passive: false });

  /* Click on canvas = advance to next region */
  var overlay = document.getElementById('db-globe-click-overlay');
  if (overlay) {
    overlay.addEventListener('click', function () {
      _showRegion(DG.activeIdx + 1);
      _resetCycle();
    });
  }
}

/* ── Pause / Resume button ─────────────────────────────────────────────── */
function _setupPauseBtn() {
  var btn = document.getElementById('fire-globe-pausebtn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (DG.cycleTimer) {
      clearInterval(DG.cycleTimer); DG.cycleTimer = null;
      DG.autoRotate = false;
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1l6 4-6 4z"/></svg> RESUME';
    } else {
      DG.autoRotate = true;
      _startCycle();
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="2" y="1" width="2" height="8"/><rect x="6" y="1" width="2" height="8"/></svg> PAUSE';
    }
  });
}

/* ── Data fetch ────────────────────────────────────────────────────────── */
function _loadRegions() {
  fetch('/api/globe/regions')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      var regions = Array.isArray(data) ? data : (data.regions || []);
      if (!regions.length) return;
      DG.regions = regions;
      _buildBeacons(regions);
      _buildNavDots(regions);
      /* Keep current idx if still valid, else jump to highest risk */
      if (DG.activeIdx >= regions.length) {
        var topIdx = 0, topRisk = -1;
        regions.forEach(function (r, i) { if ((r.risk || 0) > topRisk) { topRisk = r.risk; topIdx = i; } });
        DG.activeIdx = topIdx;
      }
      _showRegion(DG.activeIdx);
    })
    .catch(function () { /* keep stubs */ });

  fetch('/api/globe/heatmap-points')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (pts) { if (Array.isArray(pts)) _buildMarkers(pts); })
    .catch(function () {});
}

/* ── Three.js helpers ──────────────────────────────────────────────────── */
function _latLon(lat, lon, r) {
  var phi   = (90 - lat)  * Math.PI / 180;
  var theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

function _buildBeacons(regions) {
  if (!DG.beaconGroup) return;
  while (DG.beaconGroup.children.length) DG.beaconGroup.remove(DG.beaconGroup.children[0]);
  regions.forEach(function (reg) {
    if (!reg.center) return;
    var pos = _latLon(reg.center[0], reg.center[1], R + 0.015);
    var col = parseInt((reg.color || '#ff8f00').replace('#', ''), 16);
    var m   = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 8, 8),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 })
    );
    m.position.copy(pos);
    DG.beaconGroup.add(m);
  });
}

function _buildMarkers(pts) {
  if (!DG.markerGroup) return;
  while (DG.markerGroup.children.length) DG.markerGroup.remove(DG.markerGroup.children[0]);
  pts.slice(0, 120).forEach(function (pt) {
    if (!pt.latitude || !pt.longitude) return;
    var sev = pt.severity || 5;
    var col = sev >= 7 ? 0xff4a1a : sev >= 5 ? 0xff8f00 : 0x6b9b5e;
    var m   = new THREE.Mesh(
      new THREE.SphereGeometry(0.007 + sev * 0.003, 5, 5),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 })
    );
    m.position.copy(_latLon(pt.latitude, pt.longitude, R + 0.01));
    DG.markerGroup.add(m);
  });
}

/* ── Nav dots ──────────────────────────────────────────────────────────── */
function _buildNavDots(regions) {
  var wrap = document.getElementById('fire-globe-zones');
  if (!wrap) return;
  wrap.innerHTML = '';
  regions.forEach(function (reg, i) {
    var dot = document.createElement('div');
    dot.className = 'fire-globe-zone-dot' + (i === DG.activeIdx ? ' active' : '');
    dot.style.color = reg.color || '#ff8f00';
    dot.title = (reg.name || '') + ' · Risk ' + (reg.risk || 0).toFixed(1);
    dot.addEventListener('click', (function (idx) {
      return function () { _showRegion(idx); _resetCycle(); };
    })(i));
    wrap.appendChild(dot);
  });

  /* Legacy hidden dots for compat */
  var legacy = document.getElementById('db-globe-regions');
  if (legacy) { legacy.innerHTML = ''; }
}

function _refreshNavDots() {
  document.querySelectorAll('.fire-globe-zone-dot').forEach(function (d, i) {
    d.classList.toggle('active', i === DG.activeIdx);
  });
}

/* ── Show region popup ─────────────────────────────────────────────────── */
function _showRegion(idx) {
  if (!DG.regions.length) return;
  idx = ((idx % DG.regions.length) + DG.regions.length) % DG.regions.length;
  DG.activeIdx = idx;
  _refreshNavDots();

  var reg   = DG.regions[idx];
  var risk  = reg.risk || 0;
  var level = risk >= 7 ? 'critical' : risk >= 5 ? 'major' : risk >= 3 ? 'watch' : 'calm';

  /* Fire popup — fade out → update → fade in */
  var popup = document.getElementById('fire-zone-popup');
  if (popup) {
    popup.style.transition = 'opacity 0.2s ease';
    popup.style.opacity    = '0.2';
    setTimeout(function () {
      popup.className = 'fire-zone-popup zone-' + level;

      _setEl('fire-zone-name',     (reg.emoji ? reg.emoji + ' ' : '') + (reg.name || ''));
      _setEl('fire-zone-severity', risk.toFixed(1));
      _setEl('fire-zone-events',   ((reg.event_count || 0).toLocaleString()));
      _setEl('fire-zone-trend',    reg.trend || '→');
      _setEl('fire-zone-quote',    '« ' + (reg.summary || 'No significant activity in the monitored period.') + ' »');
      _setEl('fire-zone-byline',   '— AI GEOPOL · ' + new Date().toTimeString().slice(0,5) + ' UTC');

      /* Window label synced to active timeframe pill */
      var pill = document.querySelector('.fire-timepill.active');
      _setEl('fire-zone-window',   (pill ? pill.textContent.trim() : '24H') + ' WINDOW');

      /* Trend class */
      var tEl = document.getElementById('fire-zone-trend');
      if (tEl) tEl.className = 'fire-zone-stat-val ' + (reg.trend === '↑' ? 'danger' : reg.trend === '↓' ? 'positive' : '');

      popup.style.opacity = '1';
    }, 220);
  }

  /* Legacy hidden compat elements — keeps db-globe-* watchers happy */
  _setEl('db-globe-region-name', (reg.emoji || '') + ' ' + (reg.name || ''));
  _setEl('db-globe-text',        reg.summary || '');
  _setEl('db-globe-footer-label', (idx+1) + '/' + DG.regions.length + ' regions · auto-cycling every 10s');
  var rb = document.getElementById('db-globe-risk-badge');
  if (rb) { rb.textContent = 'Risk ' + risk.toFixed(1); }
  var ec = document.getElementById('db-globe-ev-count');
  if (ec) ec.textContent = (reg.event_count || 0) + ' events';

  /* Smooth globe rotation to face region */
  if (reg.center) _rotateGlobeTo(reg.center);
}

function _setEl(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ── Smooth rotation ───────────────────────────────────────────────────── */
function _rotateGlobeTo(center) {
  if (!DG.globe || !center) return;
  var target = -(center[1] + 180) * Math.PI / 180;
  var start  = DG.globe.rotation.y;
  var diff   = target - start;
  while (diff >  Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  var step = 0, total = 55;
  var wasAuto = DG.autoRotate;
  DG.autoRotate = false;
  var iv = setInterval(function () {
    step++;
    var t    = step / total;
    var ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    var y    = start + diff * ease;
    DG.globe.rotation.y = y;
    if (DG.markerGroup) DG.markerGroup.rotation.y = y;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y = y;
    if (step >= total) { clearInterval(iv); DG.autoRotate = wasAuto; }
  }, 16);
}

/* ── Auto-cycle ────────────────────────────────────────────────────────── */
function _startCycle() {
  if (DG.cycleTimer) return;
  DG.cycleTimer = setInterval(function () {
    if (!document.hidden) _showRegion(DG.activeIdx + 1);
  }, CYCLE_MS);
}
function _resetCycle() {
  if (DG.cycleTimer) { clearInterval(DG.cycleTimer); DG.cycleTimer = null; }
  _startCycle();
}

/* ── DOMContentLoaded wire-up ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  /* Watch view-dash class changes → re-init when user navigates to dashboard */
  var dash = document.getElementById('view-dash');
  if (!dash) return;

  new MutationObserver(function () {
    if (dash.classList.contains('on') && !DG.initialized) {
      DG._initAttempts = 0;
      setTimeout(window.initDashGlobe, 200);
    }
  }).observe(dash, { attributes: true, attributeFilter: ['class'] });

  /* Init immediately if dashboard is already the active view */
  if (dash.classList.contains('on')) {
    setTimeout(window.initDashGlobe, 600);
  }
});

})();

/* ═══════════ 31_dash_v2.js ═══════════ */
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

/* ═══════════ 32_dash_ew.js ═══════════ */
/**
 * 32_dash_ew.js — Dashboard Early Warning live integration
 *
 * Connects the Dashboard EW section (#dash-ew-section) to the real
 * /api/intelligence/early-warning and /api/intelligence/early-warning/signals
 * endpoints. Reuses the same render helpers from 10_stubs.js where possible.
 *
 * Also improves the AI Risk Brief rendering: expands the text into
 * multi-paragraph HTML for better readability.
 */
(function () {
'use strict';

/* ── EW color helper (mirrors 10_stubs.js) ─────────────────────────────── */
function _col(score) {
  if (score >= 7.5) return '#ff5722';
  if (score >= 6.0) return '#ffab00';
  if (score >= 4.0) return '#ffcc02';
  return '#66bb6a';
}
function _label(score) {
  if (score >= 7.5) return 'CRITICAL';
  if (score >= 6.0) return 'ELEVATED';
  if (score >= 4.0) return 'MODERATE';
  return 'STABLE';
}

/* ── Set element text ──────────────────────────────────────────────────── */
function _set(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}
function _html(id, html) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

/* ── Escape HTML ───────────────────────────────────────────────────────── */
function _esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Render multi-paragraph assessment ─────────────────────────────────── */
function _renderAssessment(text, score, data) {
  var el = document.getElementById('dash-ew-assess');
  if (!el) return;

  if (!text || text.length < 20) {
    // Build a data-driven fallback if AI text is absent
    var vel = data.event_velocity || 1.0;
    var velTxt = vel > 1.5 ? 'accelerating (+' + Math.round((vel-1)*100) + '% above baseline)'
               : vel < 0.8 ? 'decelerating' : 'stable';
    var neg = (data.sentiment_trend || 0) < -0.3;
    text = 'Global EW Score: ' + score.toFixed(1) + '/10 — ' + _label(score) + ' status. '
         + (data.event_count_48h || 0) + ' events tracked in the 48h window. '
         + 'Event velocity ' + velTxt + '. '
         + 'Macro stress index: ' + (data.macro_stress || 5).toFixed(1) + '/10. '
         + (neg ? 'News sentiment is deteriorating — monitor for escalation.' 
               : 'Sentiment currently stable across tracked regions.');
  }

  // Split into sentences and render as readable paragraphs
  var sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  var chunks = [];
  var current = '';
  sentences.forEach(function(s, i) {
    current += s.trim() + ' ';
    // Break every 2–3 sentences into a paragraph
    if ((i + 1) % 2 === 0 || i === sentences.length - 1) {
      chunks.push(current.trim());
      current = '';
    }
  });

  el.innerHTML = chunks.map(function(chunk, i) {
    var style = i === 0
      ? 'margin:0 0 8px;font-family:var(--fire-sans);font-style:normal;font-weight:600;font-size:14px;color:var(--fire-text)'
      : 'margin:0 0 8px;color:var(--fire-text-mid)';
    return '<p style="' + style + '">' + _esc(chunk) + '</p>';
  }).join('');
}

/* ── Render gauge bars ─────────────────────────────────────────────────── */
function _renderGauges(data) {
  var gauges = {
    macro:  data.macro_stress     || 0,
    market: data.market_stress    || 0,
    sent:   Math.abs(data.sentiment_trend || 0) * 10,
    vel:    Math.min(10, (data.event_velocity || 1) * 4),
  };
  var sentColor = (data.sentiment_trend || 0) < -0.3 ? '#ff5722'
                : (data.sentiment_trend || 0) > 0.1 ? '#66bb6a' : '#ffab00';

  Object.keys(gauges).forEach(function(k) {
    var val = gauges[k];
    var pct = Math.min(100, Math.max(0, (val / 10) * 100));
    var col = k === 'sent' ? sentColor : _col(val);
    // dash-ewgb-* / dash-ewg-* are in the dashboard widget
    var bar = document.getElementById('dash-ewgb-' + k);
    var lbl = document.getElementById('dash-ewg-' + k);
    if (bar) { bar.style.width = pct + '%'; bar.style.background = col; }
    if (lbl) { lbl.textContent = val.toFixed(1); lbl.style.color = col; }
  });
}

/* ── Render live signals list ──────────────────────────────────────────── */
function _renderSignals(signals) {
  var el = document.getElementById('dash-ew-signals');
  var cnt = document.getElementById('dash-ew-signal-count');
  if (!el) return;

  if (cnt) cnt.textContent = signals.length ? '(' + signals.length + ')' : '';

  if (!signals.length) {
    el.innerHTML = '<div class="fire-signal-skeleton">No active signals detected in the monitoring window</div>';
    return;
  }

  el.innerHTML = signals.slice(0, 6).map(function(sig) {
    // Use correct field names from /api/intelligence/early-warning/signals
    var level    = sig.level || (sig.severity >= 7.5 ? 'critical' : sig.severity >= 5.5 ? 'major' : 'watch');
    var lvlClass = level === 'critical' ? 'critical' : level === 'major' ? 'major' : 'watch';
    var sev      = parseFloat(sig.severity || sig.value || 5);
    var col      = lvlClass === 'critical' ? 'var(--fire-ember)'
                 : lvlClass === 'major'    ? 'var(--fire-corona)'
                 : 'var(--fire-sunrise)';
    // value slot: severity score
    var val   = sig.value || sev.toFixed(1);
    // delta slot: confidence percentage
    var delta = sig.delta || (sig.confidence ? Math.round(sig.confidence * 100) + '% conf' : '');
    // meta: region + event headline snippet
    var meta  = sig.meta
              || (sig.region ? sig.region + (sig.title ? ' · ' + sig.title.slice(0, 55) : '') : '')
              || (sig.description || '').slice(0, 80);
    // body text: ai_summary or summary
    var body  = sig.description || sig.summary || '';

    return [
      '<div class="fire-signal">',
      '  <div class="fire-signal-head">',
      '    <div class="fire-signal-level ' + lvlClass + '">',
      '      <span class="fire-signal-level-dot"></span>',
      _esc(level.toUpperCase()),
      '    </div>',
      (sig.icon ? '<span style="font-size:16px;margin-left:auto">' + sig.icon + '</span>' : ''),
      '  </div>',
      '  <div class="fire-signal-label">' + _esc((sig.label || sig.type || '').replace(/_/g,' ').toUpperCase()) + '</div>',
      '  <div class="fire-signal-val-row">',
      '    <span class="fire-signal-val" style="color:' + col + '">' + _esc(String(val)) + '</span>',
      delta ? '    <span class="fire-signal-delta ' + lvlClass + '">' + _esc(delta) + '</span>' : '',
      '  </div>',
      meta ? '  <div class="fire-signal-meta">' + _esc(meta) + '</div>' : '',
      (body && body !== meta)
        ? '  <div style="font-size:11px;color:var(--fire-text-dim);margin-top:6px;line-height:1.5">'
          + _esc(body.slice(0, 140)) + '</div>'
        : '',
      '</div>',
    ].join('');
  }).join('');
}


/* ── Render crisis patterns into dashboard widget ──────────────────── */
function _renderDashPatterns(patterns) {
  var el = document.getElementById('dash-ew-patterns');
  if (!el) return;
  if (!patterns || !patterns.length) {
    el.innerHTML = '<div style="color:var(--fire-text-dim);font-size:11px;padding:8px 0;grid-column:1/-1">No significant patterns detected.</div>';
    return;
  }
  el.innerHTML = patterns.map(function(p) {
    var sc  = parseFloat(p.score || 0);
    var col = sc >= 7.5 ? '#ff5722' : sc >= 6 ? '#ffc107' : '#ffca28';
    var pct = Math.min(100, sc * 10);
    var regHtml = (p.regions || []).length
      ? '<div style="font-size:9px;color:var(--fire-text-dim);margin-top:4px">📍 ' + _esc((p.regions || []).slice(0,3).join(', ')) + '</div>'
      : '';
    return '<div class="pattern-card" style="border-color:' + col + '22">'
      + '<div class="pattern-icon">' + (p.icon || '⚠️') + '</div>'
      + '<div class="pattern-label" style="color:' + col + '">' + _esc(p.label || p.type || '') + '</div>'
      + '<div class="pattern-score" style="color:' + col + '">' + sc.toFixed(1) + '<span style="font-size:10px;opacity:.6">/10</span></div>'
      + '<div class="pattern-bar"><div class="pattern-fill" style="width:' + pct + '%;background:' + col + '"></div></div>'
      + regHtml
      + '</div>';
  }).join('');
}

/* ── Main loader — called once after enterApp ──────────────────────────── */
function dashEWInit() {
  var section = document.getElementById('dash-ew-section');
  if (!section) return;

  // Use global rq() from 01_globals.js (same auth headers)
  var rqFn = window.rq || function(url) { return fetch(url).then(function(r){ return r.json(); }); };

  rqFn('/api/intelligence/early-warning')
    .then(function(data) {
      if (!data) return;
      var score = parseFloat(data.global_ew_score || data.score || 5);
      var col   = _col(score);

      // Score + label
      var scoreEl = document.getElementById('dash-ew-score');
      if (scoreEl) { scoreEl.textContent = score.toFixed(1); scoreEl.style.color = col; }
      var labelEl = document.getElementById('dash-ew-label');
      if (labelEl) { labelEl.textContent = _label(score); labelEl.style.color = col; }

      // Gauges
      _renderGauges(data);

      // Assessment text
      _renderAssessment(data.ai_assessment || data.assessment || '', score, data);

      // Render patterns into the DASHBOARD widget (dash-ew-patterns)
      _renderDashPatterns(data.top_risks || []);
    })
    .catch(function() {
      _set('dash-ew-label', 'UNAVAILABLE');
      _html('dash-ew-assess', '<p style="color:var(--fire-text-dim);font-size:13px">Could not load Early Warning data.</p>');
    });

  // Load signals separately
  rqFn('/api/intelligence/early-warning/signals')
    .then(function(data) {
      var signals = (data && data.signals) || [];
      _renderSignals(signals);
    })
    .catch(function() {
      _html('dash-ew-signals', '<div class="fire-signal-skeleton">Could not load signals</div>');
    });

  // Auto-refresh every 3 minutes
  setTimeout(function() { dashEWInit(); }, 180000);
}

/* ── Extended macro brief renderer ────────────────────────────────────── */
function renderExtendedBrief(text) {
  var el = document.getElementById('d-brief-txt');
  if (!el || !text || text.length < 20) return;

  // Render full markdown for structured briefing
  // Parse structured markdown from AI brief
  var html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*([^*]+)\*\*/g,'<strong style="color:var(--fire-text);font-family:var(--fire-sans);display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;margin-top:14px;margin-bottom:4px;opacity:.7">$1</strong>')
    .replace(/\*([^*]+)\*/g,'<strong style="color:var(--fire-text)">$1</strong>')
    .replace(/↑/g,'<span style="color:#10B981">↑</span>')
    .replace(/↓/g,'<span style="color:#EF4444">↓</span>');
  // Split into paragraphs
  var parts = html.split(/\n\n+/);
  html = parts.map(function(p){
    p = p.replace(/\n/g,' ').trim();
    if(!p) return '';
    // Bullet/numbered items
    if(/^[\-•\d]/.test(p)){
      return '<div style="padding:3px 0 3px 14px;position:relative"><span style="position:absolute;left:2px;color:var(--fire-ember)">•</span>'+p.replace(/^[\-•\d\.\s]+/,'')+'</div>';
    }
    return '<p style="margin:8px 0">'+p+'</p>';
  }).join('');

  el.innerHTML = '<div style="font-size:13px;line-height:1.75;color:var(--fire-text-mid)"><p style="margin:0 0 10px">' + html + '</p></div>';

  // Update timestamp
  var timeEl = document.getElementById('db-brief-time');
  if (timeEl) timeEl.textContent = new Date().toTimeString().slice(0, 5) + ' UTC';
}

/* ── Hook into the existing loadMacroBrief / renderDash flow ──────────── */
// We monkey-patch the brief text setter so our renderer runs when data arrives
var _origInnerText = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText');
var _origTextContent = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');

// Simpler approach: poll the element after renderDash runs
function _watchBrief() {
  var el = document.getElementById('d-brief-txt');
  if (!el) return;
  var lastText = '';
  setInterval(function() {
    var current = el.textContent || '';
    if (current !== lastText && current.length > 30 && !current.includes('<p')) {
      lastText = current;
      renderExtendedBrief(current);
    }
  }, 1500);
}

/* ── Boot ──────────────────────────────────────────────────────────────── */
function init() {
  var dash = document.getElementById('view-dash');
  if (!dash) return;

  function tryInit() {
    if (dash.classList.contains('on') && window.G && window.G.token) {
      dashEWInit();
      _watchBrief();
    }
  }

  // Init when dashboard becomes visible
  new MutationObserver(function() {
    if (dash.classList.contains('on')) tryInit();
  }).observe(dash, { attributes: true, attributeFilter: ['class'] });

  // Init immediately if already active
  setTimeout(tryInit, 1200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// Expose for manual reload
window.dashEWInit = dashEWInit;
window.renderExtendedBrief = renderExtendedBrief;

// Force-refresh EW (clears 30-min server cache, then reloads)
window.refreshEW = function() {
  var rqFn = window.rq || function(url, opts) { return fetch(url, opts).then(function(r){ return r.json(); }); };
  rqFn('/api/intelligence/early-warning/refresh', { method: 'POST' }).then(function() {
    dashEWInit();
  }).catch(function() { dashEWInit(); });
};


})();

/* ═══════════ 34_swipe_dash.js ═══════════ */
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

  // AI brief — show full text on mobile (scrollable), strip heavy HTML
  var srcBrief = _el('d-brief-txt');
  var dstBrief = _el('msc-brief');
  if (srcBrief && dstBrief) {
    var full = (srcBrief.innerHTML || '').replace(/<strong[^>]*>/gi,'<strong>').replace(/<\/strong>/gi,'</strong>');
    var plain = (srcBrief.textContent || srcBrief.innerText || '').trim();
    if (plain && plain.length > 10 && !plain.includes('Caricamento')) {
      dstBrief.innerHTML = '<div style="font-size:12px;line-height:1.7;color:var(--fire-text-mid);overflow-y:auto;max-height:220px">' + full + '</div>';
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

  // Card 5 (Macro): load when scrolled into view
  var _macroLoaded = false;
  _track.addEventListener('scroll', function() {
    if (_macroLoaded) return;
    var card5 = _el('msc-5');
    if (!card5) return;
    var rect = card5.getBoundingClientRect();
    var trackRect = _track.getBoundingClientRect();
    // Card 5 is visible when it enters the track viewport
    if (rect.left < trackRect.right + 50) {
      _macroLoaded = true;
      if (typeof loadMacroNarrative === 'function') {
        loadMacroNarrative();
      }
    }
  }, { passive: true });

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

  // Pre-load macro narrative after 4s (so card 5 is ready when user swipes there)
  setTimeout(function() {
    if (_isPhone() && window.G && G.token && typeof loadMacroNarrative === 'function') {
      loadMacroNarrative();
    }
  }, 4000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

})();



/* ═══════════════════════════════════════════════════════
   C — MACRO NARRATIVE: indicator cards with AI interpretation
   ═══════════════════════════════════════════════════════ */
function loadMacroNarrative(){
  var grid = document.getElementById('macro-narrative-grid');
  if(!grid||!window.G||!G.token) return;

  // Show loading
  grid.innerHTML = [0,1,2,3,4,5].map(function(){
    return '<div style="background:var(--bg1);border:1px solid var(--bd);border-radius:12px;padding:16px;min-height:100px;animation:pulse 1.4s ease-in-out infinite"><div style="height:10px;width:40%;background:var(--bd);border-radius:4px;margin-bottom:10px"></div><div style="height:24px;width:60%;background:var(--bd);border-radius:4px;margin-bottom:10px"></div><div style="height:10px;width:90%;background:var(--bd);border-radius:4px"></div></div>';
  }).join('');

  rq('/api/intelligence/macro-narrative').then(function(r){
    if(!r||!r.indicators||!r.indicators.length){
      grid.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:20px">Nessun dato macro disponibile</div>';
      return;
    }

    // Also push to Intel Hub macro card
    if(r.indicators && r.indicators.length){
      var kpisEl = document.getElementById('ic-macro-kpis');
      if(kpisEl && !kpisEl.children.length || (kpisEl && kpisEl.innerHTML.indexOf('Vedi sezione')>-1)){
        kpisEl.innerHTML = r.indicators.slice(0,4).map(function(m){
          var col = m.arrow==='↑'?'#10B981':m.arrow==='↓'?'#EF4444':'#94A3B8';
          return '<div class="ic-kpi-item"><div class="ic-kpi-name">'+m.name+'</div>'
            +'<div class="ic-kpi-val" style="color:'+col+'">'+m.value+' <span style="font-size:9px">'+( m.unit||'')+'</span></div></div>';
        }).join('');
        var interpEl = document.getElementById('ic-macro-interp');
        if(interpEl && r.indicators[0] && r.indicators[0].interpretation){
          interpEl.textContent = r.indicators[0].interpretation.slice(0,100);
        }
      }
    }
    // Also sync to mobile card 5
    var mobGrid = document.getElementById('msc-macro-narrative');
    if(mobGrid && r.indicators && r.indicators.length){
      mobGrid.innerHTML = r.indicators.slice(0,6).map(function(m){
        var arrowCol = m.arrow==='↑'?'#10B981':m.arrow==='↓'?'#EF4444':'#94A3B8';
        return '<div class="msc-macro-item">'
          +'<div class="msc-macro-name">'+_esc(m.name)+'</div>'
          +'<div class="msc-macro-val" style="color:'+arrowCol+'">'+_esc(m.value)+'<span style="font-size:10px;color:var(--t3)"> '+_esc(m.unit)+'</span></div>'
          +(m.interpretation?'<div class="msc-macro-interp">'+_esc(m.interpretation.slice(0,60))+(m.interpretation.length>60?'…':'')+'</div>':'')
          +'</div>';
      }).join('');
    }

    var COLORS = {
      '↑': '#10B981', '↓': '#EF4444', '': '#94A3B8'
    };

    grid.innerHTML = r.indicators.map(function(m){
      var arrowCol = COLORS[m.arrow||'']||'#94A3B8';
      var deltaHtml = m.delta ? '<span style="font-size:10px;color:'+arrowCol+';margin-left:4px">'+m.arrow+' '+m.delta+'</span>' : '';
      var interpHtml = m.interpretation
        ? '<div style="font-size:12px;line-height:1.65;color:var(--t2);margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)">'+_esc(m.interpretation)+'</div>'
        : '';
      return '<div style="background:var(--bg1);border:1px solid var(--bd);border-radius:12px;padding:16px;transition:border-color .2s" onmouseover="this.style.borderColor=\'var(--via)\'" onmouseout="this.style.borderColor=\'var(--bd)\'">'
        +'<div style="font-size:9px;font-family:var(--fm);letter-spacing:.1em;color:var(--t3);text-transform:uppercase;margin-bottom:6px">'+_esc(m.name)+' · '+_esc(m.country)+'</div>'
        +'<div style="display:flex;align-items:baseline;gap:4px">'
        +'<span style="font-size:28px;font-weight:800;font-family:var(--fm);color:var(--fire-text)">'+_esc(m.value)+'</span>'
        +'<span style="font-size:13px;color:var(--t3)">'+_esc(m.unit)+'</span>'
        +deltaHtml
        +'</div>'
        +interpHtml
        +'</div>';
    }).join('');
  });
}

/* Auto-load macro narrative when dashboard becomes visible */
(function(){
  var _mnLoaded = false;
  var dash = document.getElementById('view-dash');
  if(!dash) return;
  var obs = new MutationObserver(function(){
    if(dash.classList.contains('on') && !_mnLoaded && window.G && G.token){
      _mnLoaded = true;
      setTimeout(loadMacroNarrative, 800);
    }
  });
  obs.observe(dash, {attributes:true, attributeFilter:['class']});
  // Also run if already visible on load
  if(dash.classList.contains('on')){
    setTimeout(function(){if(window.G && G.token){loadMacroNarrative();}}, 2000);
  }
})();

/* ═══════════════════════════════════════════════════════
   B — Event summary expansion (accordion)
   Clicking a crisis event shows full summary inline
   ═══════════════════════════════════════════════════════ */
function expandEventSummary(el, evId){
  var detail = document.getElementById('ev-detail-'+evId);
  if(!detail) return;
  var isOpen = detail.style.display !== 'none';
  detail.style.display = isOpen ? 'none' : 'block';
  var arrow = el.querySelector('.ev-expand-arrow');
  if(arrow) arrow.textContent = isOpen ? '▸' : '▾';
}

/* Patch renderFeed to add summaries to crisis events */
var _origRenderFeed = window.renderFeed;
window.renderFeed = function(){
  if(_origRenderFeed) _origRenderFeed.apply(this, arguments);
  setTimeout(patchEventSummaries, 300);
};

function patchEventSummaries(){
  // Find all event rows in crisis section and add expandable summary
  var crisisEls = document.querySelectorAll('#dash-crisis-list .dash-crisis-item, .dash-ev-row');
  if(!crisisEls.length) return;
  crisisEls.forEach(function(row){
    if(row.dataset.summaryPatched) return;
    row.dataset.summaryPatched = '1';
    var evId = row.dataset.evId || row.dataset.id;
    var sumText = row.dataset.summary || row.dataset.aiSummary;
    if(!sumText || sumText.length < 20) return;
    // Add expandable summary
    var detail = document.createElement('div');
    detail.id = 'ev-detail-'+ evId;
    detail.style.cssText = 'display:none;font-size:11px;line-height:1.7;color:var(--t2);padding:8px 10px;background:rgba(255,255,255,.03);border-radius:0 0 8px 8px;margin-top:-4px;border:1px solid var(--bd);border-top:none';
    detail.textContent = sumText;
    row.style.cursor = 'pointer';
    row.onclick = function(){ expandEventSummary(row, evId); };
    if(!row.querySelector('.ev-expand-arrow')){
      var arrow = document.createElement('span');
      arrow.className = 'ev-expand-arrow';
      arrow.style.cssText = 'margin-left:auto;font-size:10px;color:var(--t3);flex-shrink:0';
      arrow.textContent = '▸';
      row.appendChild(arrow);
    }
    row.parentNode.insertBefore(detail, row.nextSibling);
  });
}

/* F — Jarvis connection: click event → open Jarvis with event title */
function openJarvisForEvent(title){
  if(typeof openJarvisInSidebar === 'function'){
    openJarvisInSidebar(title);
  } else if(typeof openJarvis === 'function'){
    openJarvis(title);
  }
}

/* ═══════════════════════════════════════════════════════════════
   INTELLIGENCE HUB — 6 cards from global cache
   ═══════════════════════════════════════════════════════════════ */

var _intelCache = null;
var _modalEvents = {};

function refreshIntelCards(){
  _intelCache = null;
  loadIntelCards();
}

var _intelLoadAttempts = 0;
function loadIntelCards(){
  if(!window.G||!G.token) return;
  if(_intelCache){ _renderIntelCards(_intelCache); return; }

  rq('/api/intelligence/dashboard-cache').then(function(data){
    if(!data || data.error || data._timeout || data._network){
      _intelLoadAttempts++;
      // Build from live data immediately (non-blocking)
      _buildIntelCardsFromLiveData();
      // Retry with exponential backoff (10s, 30s, 60s)
      var delay = _intelLoadAttempts === 1 ? 10000 : _intelLoadAttempts === 2 ? 30000 : 60000;
      if(_intelLoadAttempts <= 3){
        setTimeout(function(){
          if(window.G&&G.token){ _intelCache=null; loadIntelCards(); }
        }, delay);
      }
      return;
    }
    _intelLoadAttempts = 0;
    _intelCache = data;
    _renderIntelCards(data);
  });
}

function _buildIntelCardsFromLiveData(){
  /* Fallback: populate cards directly from G.events and existing DOM data */
  var events = (window.G && G.events) ? G.events.slice().sort(function(a,b){
    return (b.severity||0)-(a.severity||0);
  }) : [];

  if(!events.length){
    // G.events not ready yet — fetch directly from API
    rq('/api/events?limit=15&sort=severity').then(function(r){
      var evs = (r&&(r.events||r.items||r)) || [];
      if(Array.isArray(evs) && evs.length){
        if(!window.G) window.G = {};
        G.events = evs;
        _buildIntelCardsFromLiveData();
      } else {
        // Final fallback: show message
        var critTitle = document.getElementById('ic-critical-title');
        if(critTitle && critTitle.textContent==='Caricamento…') critTitle.textContent='Nessun evento recente';
        var geoTitle = document.getElementById('ic-geo-title');
        if(geoTitle && geoTitle.textContent==='Caricamento…') geoTitle.textContent='Feed in aggiornamento…';
      }
    });
    return;
  }

  // Build minimal cache from live data
  var bySlot = {};
  events.forEach(function(ev){
    var cat = (ev.category||'').toLowerCase();
    var sev = parseFloat(ev.severity||0);
    var slot = sev>=8?'critical':
               cat.match(/security|conflict|military|politic/)? 'crisis':
               cat.match(/economy|finance|trade/)? 'macro': 'crisis';
    if(!bySlot[slot]) bySlot[slot]=ev;
  });

  var fakeCache = {
    top_events: events.slice(0,10).map(function(ev){
      ev.rich_summary = ev.ai_summary||ev.summary||ev.title||'';
      ev.card_slot = parseFloat(ev.severity||0)>=8?'critical':'crisis';
      return ev;
    }),
    macro_narrative: [],
    kg_connections: [],
    market_snapshot: [],
    ew_assessment: ''
  };

  // Try to get EW score from DOM
  var ewEl = document.getElementById('dash-ew-score')||document.getElementById('ew-score');
  if(ewEl) {
    var scoreEl = document.getElementById('ic-ew-score');
    if(scoreEl) scoreEl.textContent = ewEl.textContent||'—';
  }

  // Try to get macro from existing DOM (macro narrative card)
  var macroGrid = document.getElementById('macro-narrative-grid');
  if(macroGrid && macroGrid.children.length > 0){
    var macroCard = document.getElementById('ic-macro');
    var macroKpis = document.getElementById('ic-macro-kpis');
    if(macroKpis) macroKpis.innerHTML = '<div style="font-size:11px;color:var(--t2);padding:4px 0">Vedi sezione Macro Narrative sopra ↑</div>';
  }

  _renderIntelCards(fakeCache);

  // Show subtle loading message on empty cards
  var ewTxt = document.getElementById('ic-ew-text');
  if(ewTxt && !ewTxt.textContent.trim()) {
    ewTxt.textContent = 'Analisi EW in caricamento. Usa il bottone ↻ per aggiornare.';
  }
}

function _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function _renderIntelCards(data){
  var events  = data.top_events      || [];
  var macro   = data.macro_narrative || [];
  var kg      = data.kg_connections  || [];
  var msnap   = data.market_snapshot || [];
  var ewText  = data.ew_assessment   || '';

  // Deduplicate events by card_slot
  var bySlot = {};
  events.forEach(function(ev){
    var slot = ev.card_slot || 'crisis';
    if(!bySlot[slot]) bySlot[slot] = ev;
  });
  var critical = bySlot.critical || events[0];
  var geo      = bySlot.crisis   || events.find(function(e){
    return (e.category||'').match(/security|conflict|military|politics/i);
  }) || events[1];
  var macroEv  = bySlot.macro    || null;

  // Card 1: Critical
  if(critical){
    _modalEvents['critical'] = critical;
    var el = document.getElementById('ic-critical-title');
    if(el) el.textContent = critical.title || '';
    var sum = document.getElementById('ic-critical-summary');
    if(sum) sum.textContent = (critical.rich_summary||critical.ai_summary||critical.summary||'').slice(0,160);
    var ctr = document.getElementById('ic-critical-country');
    if(ctr) ctr.textContent = (critical.country_name||'Global').toUpperCase()+' · SEV '+(critical.severity||'?');
    var tim = document.getElementById('ic-critical-time');
    if(tim&&critical.timestamp) tim.textContent = _tAgo(critical.timestamp);
  }

  // Card 2: Macro Flash
  var macroGrid = document.getElementById('ic-macro-kpis');
  if(macroGrid && macro.length){
    macroGrid.innerHTML = macro.slice(0,4).map(function(m){
      var col = m.arrow==='↑'?'#10B981':m.arrow==='↓'?'#EF4444':'#94A3B8';
      return '<div class="ic-kpi-item">'
        +'<div class="ic-kpi-name">'+_esc(m.name)+'</div>'
        +'<div class="ic-kpi-val" style="color:'+col+'">'+_esc(m.value)+' <span style="font-size:10px">'+_esc(m.unit||'')+'</span></div>'
        +'</div>';
    }).join('');
    var interp = document.getElementById('ic-macro-interp');
    if(interp && macro[0] && macro[0].interpretation){
      interp.textContent = macro[0].interpretation.slice(0,120);
    }
  }

  // Card 3: Geo
  if(geo){
    _modalEvents['geo'] = geo;
    var gt = document.getElementById('ic-geo-title');
    if(gt) gt.textContent = geo.title||'';
    var gs = document.getElementById('ic-geo-summary');
    if(gs) gs.textContent = (geo.rich_summary||geo.summary||'').slice(0,150);
    var gc = document.getElementById('ic-geo-country');
    if(gc) gc.textContent = (geo.country_name||'Global').toUpperCase();
  }

  // Card 4: Markets
  var mkRow = document.getElementById('ic-market-row');
  if(mkRow && msnap.length){
    mkRow.innerHTML = msnap.slice(0,4).map(function(m){
      var v = parseFloat(m.value||0);
      var p = parseFloat(m.previous||v);
      var col = v>p?'#10B981':v<p?'#EF4444':'#94A3B8';
      var arr = v>p?'↑':v<p?'↓':'→';
      return '<div class="ic-mkt-item">'
        +'<span class="ic-mkt-name">'+_esc((m.name||'').slice(0,8))+'</span>'
        +'<span class="ic-mkt-val" style="color:'+col+'">'+arr+' '+_esc(m.value||'')+'</span>'
        +'</div>';
    }).join('');
    // Show macro event in markets title
    var mktTitle = document.getElementById('ic-markets-title');
    if(mktTitle&&macroEv) mktTitle.textContent = macroEv.title ? macroEv.title.slice(0,80) : '';
  }

  // Card 5: KG Connections
  var kgCon = document.getElementById('ic-kg-connections');
  if(kgCon && kg.length){
    kgCon.innerHTML = kg.slice(0,5).map(function(c){
      return '<div class="ic-kg-row">'
        +'<span class="ic-kg-node" onclick="openJarvisForEvent(\''+_esc(c.src)+'\')">'+_esc(c.src)+'</span>'
        +'<span class="ic-kg-rel">→ '+_esc(c.relation)+' →</span>'
        +'<span class="ic-kg-node" onclick="openJarvisForEvent(\''+_esc(c.tgt)+'\')">'+_esc(c.tgt)+'</span>'
        +'</div>';
    }).join('');
  }

  // Card 6: EW — sync from live DOM or cache
  var ewScore = document.getElementById('ic-ew-score');
  var ewScoreEl = document.getElementById('dash-ew-score') || document.getElementById('ew-score');
  if(ewScore){
    var liveScore = ewScoreEl ? ewScoreEl.textContent.trim() : '';
    ewScore.textContent = liveScore || '—';
    // Color by score
    var sc = parseFloat(liveScore)||0;
    ewScore.style.color = sc>=8?'#EF4444':sc>=6?'#F59E0B':'#10B981';
  }
  var ewTxt = document.getElementById('ic-ew-text');
  if(ewTxt){
    if(ewText && ewText.length>10){
      ewTxt.textContent = ewText.slice(0, 300) + (ewText.length > 300 ? '…' : '');
    } else {
      // Try to pull from live EW assess DOM element
      var liveEw = document.getElementById('ew-assess') || document.getElementById('ew-score-desc');
      if(liveEw && liveEw.textContent.length > 20){
        ewTxt.textContent = liveEw.textContent.slice(0, 300);
      }
    }
  }
}

/* ── Event detail modal ── */
var _currentModalEvent = null;
window._currentModalEvent = null;

function openEventModal(slot){
  var ev = _modalEvents[slot];
  if(!ev) return;
  _currentModalEvent = ev;
  window._currentModalEvent = ev;

  document.getElementById('em-tag').textContent = (ev.category||'EVENT').toUpperCase()+' · WORLDLENS INTELLIGENCE';
  document.getElementById('em-title').textContent = ev.title||'';
  document.getElementById('em-country').textContent = ev.country_name||'Global';

  var sev = parseFloat(ev.severity||0);
  var sevEl = document.getElementById('em-severity');
  if(sevEl){
    sevEl.textContent = 'Severity '+sev.toFixed(0)+'/10';
    sevEl.style.background = sev>=8?'rgba(239,68,68,.2)':sev>=6?'rgba(249,115,22,.2)':'rgba(59,130,246,.15)';
    sevEl.style.color = sev>=8?'#EF4444':sev>=6?'#F97316':'#93C5FD';
  }

  var ts = ev.timestamp ? _tAgo(ev.timestamp) : '';
  document.getElementById('em-time').textContent = ts;

  var summary = ev.rich_summary||ev.ai_summary||ev.summary||ev.title||'';
  document.getElementById('em-summary').textContent = summary;

  // Source link
  var srcLink = document.getElementById('em-source-link');
  if(srcLink) srcLink.href = ev.source_url||ev.url||'#';

  // KG nodes from cache
  if(_intelCache && _intelCache.kg_connections && _intelCache.kg_connections.length){
    var related = _intelCache.kg_connections.filter(function(c){
      var title = (ev.title||'').toLowerCase();
      return title.includes((c.src||'').toLowerCase()) || title.includes((c.tgt||'').toLowerCase());
    }).slice(0,4);
    var kgSec = document.getElementById('em-kg-section');
    var kgNodes = document.getElementById('em-kg-nodes');
    if(related.length && kgSec && kgNodes){
      kgSec.style.display = 'block';
      kgNodes.innerHTML = related.map(function(c){
        return '<div style="font-size:10px;font-family:var(--fm);color:var(--t2);padding:3px 0">'
          +'<span style="color:#A78BFA;cursor:pointer" onclick="openJarvisForEvent(\''+_esc(c.src)+'\')">'+_esc(c.src)+'</span>'
          +' <span style="color:rgba(255,255,255,.2)">→ '+_esc(c.relation)+' →</span> '
          +'<span style="color:#A78BFA;cursor:pointer" onclick="openJarvisForEvent(\''+_esc(c.tgt)+'\')">'+_esc(c.tgt)+'</span>'
          +'</div>';
      }).join('');
    }
  }

  var overlay = document.getElementById('event-modal-overlay');
  if(overlay){ overlay.style.display='flex'; requestAnimationFrame(function(){ overlay.classList.add('visible'); }); }
}

function closeEventModal(){
  var overlay = document.getElementById('event-modal-overlay');
  if(overlay){ overlay.style.display='none'; overlay.classList.remove('visible'); }
}

function _tAgo(ts){
  try{
    var d = new Date(ts);
    var diff = Math.floor((Date.now()-d.getTime())/60000);
    if(diff<60) return diff+'m fa';
    if(diff<1440) return Math.floor(diff/60)+'h fa';
    return Math.floor(diff/1440)+'g fa';
  }catch(e){ return ''; }
}

/* ── Auto-load on dashboard open ── */
(function(){
  var dash = document.getElementById('view-dash');
  if(!dash) return;
  var _loaded = false;
  new MutationObserver(function(){
    if(dash.classList.contains('on') && !_loaded && window.G && G.token){
      _loaded = true;
      setTimeout(loadIntelCards, 1200);
    }
  }).observe(dash, {attributes:true, attributeFilter:['class']});
  if(dash.classList.contains('on')){
    setTimeout(function(){if(window.G&&G.token) loadIntelCards();}, 2500);
  }
})();

/* ═══════════════════════════════════════════════════════════════
   FINANCE HUB — JavaScript
   ═══════════════════════════════════════════════════════════════ */

/* ── Tab switching ── */
function fhTab(name, btn){
  document.querySelectorAll('.fh-tab').forEach(function(b){ b.classList.remove('on'); });
  if(btn) btn.classList.add('on');
  document.querySelectorAll('.fh-panel').forEach(function(p){ p.classList.remove('on'); });
  var panel = document.getElementById('fh-panel-'+name);
  if(panel) panel.classList.add('on');

  if(name==='portfolios')   loadFHPortfolios();
  if(name==='markets')      loadFHMarkets();   // legacy FH mini-markets (kept as fallback)
  if(name==='watchlist')    loadFHWatchlist();
  if(name==='lab')          fhInitLab();
  if(name==='mercati')      _fhMountView('markets',   'fh-mercati-mount',     function(){ if(typeof initMarkets==='function') initMarkets(); });
  if(name==='intelligenza') _fhMountIntelligenza();
}

/* ─── View-mount helpers ─────────────────────────────────────────────────── */

/**
 * Move an existing .view element (e.g. view-markets) into a Finance Hub panel
 * mount point so it renders inside the tab without duplicating HTML or JS.
 * The view is moved back to #content when Finance Hub is left.
 */
var _fhMountedViews = {};

function _fhMountView(viewId, mountId, onMount) {
  var viewEl  = document.getElementById('view-' + viewId);
  var mountEl = document.getElementById(mountId);
  if (!viewEl || !mountEl) return;

  // Already mounted?
  if (mountEl.contains(viewEl)) {
    // Just ensure visible and trigger onMount
    viewEl.style.display = 'flex';
    if (onMount) onMount();
    return;
  }

  // Move from #content into mount point
  var origParent = viewEl.parentNode;
  _fhMountedViews[viewId] = origParent;
  // Remove .view class constraints so it fills the mount point naturally
  viewEl.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;width:100%';
  mountEl.appendChild(viewEl);
  if (onMount) onMount();
}

function _fhUnmountViews() {
  // When navigating away from Finance Hub, restore views to #content
  Object.keys(_fhMountedViews).forEach(function(viewId) {
    var viewEl  = document.getElementById('view-' + viewId);
    var origParent = _fhMountedViews[viewId];
    if (viewEl && origParent && !origParent.contains(viewEl)) {
      var wasOn = viewEl.classList.contains('on');
      viewEl.style.cssText = '';  // restore class-driven styling
      viewEl.classList.remove('on');  // ensure clean state
      origParent.appendChild(viewEl);
      // Re-apply .on if it was active (DOM move can lose classes in some browsers)
      if (wasOn) viewEl.classList.add('on');
    }
  });
  _fhMountedViews = {};
}

var _fhIntCurrentTab = 'insiders';

function _fhMountIntelligenza() {
  var mountEl = document.getElementById('fh-intelligenza-mount');
  if (!mountEl) return;
  _fhLoadIntTab(_fhIntCurrentTab);
}

function fhIntTab(tab, btn) {
  document.querySelectorAll('.fh-int-tab').forEach(function(b){
    b.style.color = 'var(--t3)';
    b.style.borderBottomColor = 'transparent';
  });
  if (btn) {
    btn.style.color = 'var(--t1)';
    btn.style.borderBottomColor = 'var(--via)';
  }
  _fhIntCurrentTab = tab;
  _fhLoadIntTab(tab);
}

function _fhLoadIntTab(tab) {
  if (tab === 'insiders') {
    _fhMountView('insiders', 'fh-intelligenza-mount', function(){
      if (typeof initInsiders === 'function') initInsiders();
      else if (typeof loadInsiderTrades === 'function') loadInsiderTrades();
    });
  } else if (tab === 'macro') {
    _fhMountView('macro', 'fh-intelligenza-mount', function(){
      if (typeof renderMacro === 'function') renderMacro();
      if (typeof loadRegionRisks === 'function') loadRegionRisks();
    });
  } else if (tab === 'supply') {
    _fhMountView('supplychain', 'fh-intelligenza-mount', function(){
      if (typeof loadSupplyChain === 'function') loadSupplyChain();
    });
  }
}

/* Hook sv() to unmount views when leaving Finance Hub */
(function(){
  var _origSv = window.sv;
  if (_origSv && !_origSv._fhPatched) {
    window.sv = function(name, btn) {
      if (name !== 'portfolio') _fhUnmountViews();
      return _origSv.apply(this, arguments);
    };
    window.sv._fhPatched = true;
  }
})();

/* ─── State ─── */
var _fhPortfolios = [];
var _fhCurrentPortfolioId = null;
var _fhHistory = [];
var _fhMktData = [];
var _fhMktFilter = '';
var _fhCurrentHoldingForDetail = null;
var _fhPendingDeleteFn = null;

/* ═══════════════════════════════════════
   PORTFOLIOS TAB
   ═══════════════════════════════════════ */

function loadFHPortfolios(){
  if(!window.G||!G.token) return;
  rq('/api/finance/portfolios').then(function(r){
    if(!r||r._network) return;
    // API returns array directly OR {portfolios:[...]}
    _fhPortfolios = Array.isArray(r) ? r : (r.portfolios || []);
    renderFHPortfolioList();
    if(_fhPortfolios.length > 0 && !_fhCurrentPortfolioId){
      selectFHPortfolio(_fhPortfolios[0].id);
    } else if(_fhCurrentPortfolioId){
      selectFHPortfolio(_fhCurrentPortfolioId); // refresh
    }
  });
}

function renderFHPortfolioList(){
  var list = document.getElementById('fh-port-list');
  if(!list) return;
  if(!_fhPortfolios.length){
    list.innerHTML = '<div class="fh-port-card" onclick="openNewPortfolioModal()" style="border-style:dashed;opacity:.6;align-items:center;justify-content:center;display:flex;flex-direction:column;gap:6px;min-width:120px">'
      +'<div style="font-size:28px">＋</div>'
      +'<div style="font-size:10px;color:var(--t3);text-align:center">Crea il primo<br>portafoglio</div></div>';
    return;
  }
  list.innerHTML = _fhPortfolios.map(function(p){
    var retPct = p.total_return_pct || 0;
    var retCol = retPct >= 0 ? '#10B981' : '#EF4444';
    var retSign = retPct >= 0 ? '+' : '';
    var isActive = p.id === _fhCurrentPortfolioId;
    return '<div class="fh-port-card'+(isActive?' active':'')+'" onclick="selectFHPortfolio('+p.id+')">'
      +'<div class="fh-port-icon">'+(p.icon||'💼')+'</div>'
      +'<div class="fh-port-name">'+_esc(p.name||'Portafoglio')+'</div>'
      +'<div class="fh-port-val">'+(p.total_value?fmtCurrency(p.total_value,p.base_currency||'EUR'):'— €')+'</div>'
      +'<div class="fh-port-ret" style="color:'+retCol+'">'
      +(p.num_holdings ? retSign+retPct.toFixed(2)+'%' : 'Aggiungi posizioni →')+'</div>'
      +'</div>';
  }).join('')
  + '<div class="fh-port-card" onclick="openNewPortfolioModal()" style="border-style:dashed;opacity:.5;align-items:center;justify-content:center;display:flex;flex-direction:column;gap:4px;min-width:90px">'
  +'<div style="font-size:22px">＋</div><div style="font-size:9px;color:var(--t3)">Nuovo</div></div>';
}

function selectFHPortfolio(pid){
  _fhCurrentPortfolioId = pid;
  renderFHPortfolioList();
  var detail = document.getElementById('fh-port-detail');
  if(detail) detail.style.display = 'block';

  // Loading skeletons
  ['fh-total-value','fh-total-return','fh-today-return','fh-ytd-return',
   'fh-sharpe','fh-vol','fh-maxdd','fh-geo-score'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.textContent = '…';
  });

  rq('/api/finance/portfolios/'+pid).then(function(r){
    if(!r||r._network) return;
    renderFHPortfolioDetail(r);
  });

  rq('/api/finance/portfolios/'+pid+'/history?days=90').then(function(r){
    if(r && r.history){ _fhHistory = r.history; drawFHChart(r.history); }
  });

  // Load opportunity signals for portfolio tickers
  loadFHOpportunitySignals(pid);
}

function renderFHPortfolioDetail(p){
  var cur = p.base_currency || p.currency || 'EUR';
  var retPct   = p.total_return_pct || 0;
  var todayPct = p.today_return_pct || 0;
  var ytdPct   = p.ytd_return_pct;
  var retCol   = retPct   >= 0 ? '#10B981' : '#EF4444';
  var todayCol = todayPct >= 0 ? '#10B981' : '#EF4444';

  setText('fh-total-value', fmtCurrency(p.total_value||0, cur));
  setText('fh-currency', cur);

  var retEl = document.getElementById('fh-total-return');
  if(retEl){ retEl.textContent = (retPct>=0?'+':'')+retPct.toFixed(2)+'%'; retEl.style.color = retCol; }

  var todayEl = document.getElementById('fh-today-return');
  if(todayEl){ todayEl.textContent = (todayPct>=0?'+':'')+todayPct.toFixed(2)+'%'; todayEl.style.color = todayCol; }

  if(ytdPct !== null && ytdPct !== undefined){
    var ytdEl = document.getElementById('fh-ytd-return');
    if(ytdEl){ ytdEl.textContent = (ytdPct>=0?'+':'')+ytdPct.toFixed(1)+'%'; ytdEl.style.color = ytdPct>=0?'#10B981':'#EF4444'; }
  }

  setText('fh-sharpe',  p.sharpe_ratio   ? p.sharpe_ratio.toFixed(2)   : '—');
  setText('fh-vol',     p.volatility_pct  ? p.volatility_pct.toFixed(1)+'%'  : '—');
  setText('fh-maxdd',   p.max_drawdown_pct? p.max_drawdown_pct.toFixed(1)+'%': '—');

  if(p.geo_risk){
    var gs = p.geo_risk.geo_risk_score || 0;
    var gEl = document.getElementById('fh-geo-score');
    if(gEl){ gEl.textContent = gs.toFixed(1)+'/10'; }
    var alertEl = document.getElementById('fh-geo-alert');
    var gTxt    = document.getElementById('fh-geo-text');
    if(alertEl && gs >= 5){ alertEl.style.display='flex'; if(gTxt) gTxt.textContent = p.geo_risk.interpretation||''; }
    else if(alertEl){ alertEl.style.display='none'; }
  }

  renderFHHoldings(p.holdings || []);
  renderFHAllocation(p.holdings || []);
}

function renderFHAllocation(holdings){
  var sec = document.getElementById('fh-alloc-section');
  var bars = document.getElementById('fh-alloc-bars');
  if(!sec||!bars||!holdings.length){ if(sec) sec.style.display='none'; return; }

  // Group by asset_class
  var groups = {};
  var total = 0;
  holdings.forEach(function(h){
    var cls = h.asset_class || 'equity';
    var val = h.current_value || (h.shares * h.avg_price) || 0;
    groups[cls] = (groups[cls]||0) + val;
    total += val;
  });
  if(!total){ sec.style.display='none'; return; }
  sec.style.display = 'block';

  var colors = { etf:'#818CF8', equity:'#10B981', bond:'#60A5FA', commodity:'#F59E0B', crypto:'#EC4899' };
  var labels = { etf:'ETF', equity:'Azioni', bond:'Bond', commodity:'Commodity', crypto:'Crypto' };
  var sorted = Object.keys(groups).sort(function(a,b){ return groups[b]-groups[a]; });

  bars.innerHTML = sorted.map(function(cls){
    var pct = (groups[cls]/total*100).toFixed(1);
    var col = colors[cls]||'#94A3B8';
    var lbl = labels[cls]||cls;
    return '<div class="fh-alloc-row">'
      +'<div class="fh-alloc-lbl">'+lbl+'</div>'
      +'<div class="fh-alloc-bar-wrap"><div class="fh-alloc-bar-fill" style="width:'+pct+'%;background:'+col+'"></div></div>'
      +'<div class="fh-alloc-pct">'+pct+'%</div>'
      +'</div>';
  }).join('');
}

function renderFHHoldings(holdings){
  var list = document.getElementById('fh-holdings-list');
  if(!list) return;
  if(!holdings.length){
    list.innerHTML = '<div class="fh-loading" style="padding:20px;font-size:12px">Nessuna posizione. Aggiungi il primo asset con ＋ Aggiungi</div>';
    return;
  }
  list.innerHTML = holdings.map(function(h){
    var retPct   = h.return_pct || 0;
    var retCol   = retPct >= 0 ? '#10B981' : '#EF4444';
    var retSign  = retPct >= 0 ? '+' : '';
    var todayPct = h.change_pct_today || 0;
    var todayCol = todayPct >= 0 ? '#10B981' : '#EF4444';
    var curVal   = h.current_value || 0;
    var clsLabel = {etf:'ETF',equity:'Azione',bond:'Bond',commodity:'Commodity',crypto:'Crypto'}[h.asset_class]||h.asset_class||'';
    return '<div class="fh-holding-row" onclick="fhOpenHoldingDetail('+JSON.stringify(JSON.stringify(h))+')">'
      +'<div class="fh-h-top">'
      +  '<div>'
      +    '<div class="fh-h-ticker">'+_esc(h.ticker)+'</div>'
      +    '<span class="fh-h-badge">'+_esc(clsLabel)+'</span>'
      +  '</div>'
      +  '<div class="fh-h-right">'
      +    '<div class="fh-h-value" style="color:'+retCol+'">'+fmtCurrency(curVal,'EUR')+'</div>'
      +    '<div class="fh-h-return" style="color:'+retCol+'">'+retSign+retPct.toFixed(2)+'%</div>'
      +  '</div>'
      +'</div>'
      +'<div class="fh-h-meta">'
      +  '<span>'+parseFloat(h.shares||0).toFixed(3)+' quote</span>'
      +  '<span>·</span>'
      +  '<span>avg '+fmtPrice(h.avg_price||0)+'</span>'
      +  '<span>·</span>'
      +  '<span>'+parseFloat(h.weight_pct||0).toFixed(1)+'% portaf.</span>'
      +  '<span style="color:'+todayCol+'">'+(todayPct>=0?'+':'')+todayPct.toFixed(2)+'% oggi</span>'
      +'</div>'
      +'<div class="fh-h-actions">'
      +  '<button class="fh-h-btn" onclick="event.stopPropagation();fhOpenEditHolding('+h.id+','+parseFloat(h.shares||0)+','+parseFloat(h.avg_price||0)+',\''+_esc(h.ticker)+'\')" title="Modifica">✏</button>'
      +  '<button class="fh-h-btn fh-h-del" onclick="event.stopPropagation();fhConfirmDeleteHolding('+h.id+',\''+_esc(h.ticker)+'\')" title="Elimina">✕</button>'
      +'</div>'
      +'</div>';
  }).join('');
}

/* ── Opportunity signals for portfolio ── */
async function loadFHOpportunitySignals(pid){
  var secEl  = document.getElementById('fh-opp-signals');
  var listEl = document.getElementById('fh-opp-signals-list');
  if(!secEl||!listEl) return;

  var p = _fhPortfolios.find(function(x){ return x.id===pid; });
  if(!p || !p.holdings || !p.holdings.length){ secEl.style.display='none'; return; }

  var tickers = p.holdings.map(function(h){ return h.ticker.toUpperCase(); });
  var ideas = await rq('/api/opportunity/ideas?limit=30&min_score=45&status=active');
  if(!ideas||!ideas.ideas) { secEl.style.display='none'; return; }

  var matched = ideas.ideas.filter(function(idea){
    return tickers.indexOf(idea.ticker.toUpperCase()) !== -1;
  }).slice(0,3);

  if(!matched.length){ secEl.style.display='none'; return; }

  secEl.style.display = 'block';
  listEl.innerHTML = matched.map(function(idea){
    var isLong = idea.direction==='LONG';
    var col = isLong ? '#10B981' : '#EF4444';
    var pnl = idea.pnl_pct !== null && idea.pnl_pct !== undefined ? (parseFloat(idea.pnl_pct)>=0?'+':'')+parseFloat(idea.pnl_pct).toFixed(1)+'%' : '';
    return '<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
      +'<div style="font-weight:800;font-size:12px;color:'+col+';min-width:48px">'+_esc(idea.ticker)+'</div>'
      +'<div style="font-size:10px;padding:1px 7px;border-radius:100px;background:rgba(255,255,255,.06);color:'+col+'">'+(isLong?'▲ LONG':'▼ SHORT')+'</div>'
      +'<div style="font-size:11px;color:var(--t2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+_esc(idea.rationale||'')+'</div>'
      +(pnl?'<div style="font-size:11px;font-weight:700;color:'+(parseFloat(idea.pnl_pct)>=0?'#10B981':'#EF4444')+'">'+pnl+'</div>':'')
      +'</div>';
  }).join('');
}

/* ── Chart ── */
function fhChartRange(days, btn){
  document.querySelectorAll('.fh-chart-tab').forEach(function(b){ b.classList.remove('on'); });
  if(btn) btn.classList.add('on');
  if(_fhCurrentPortfolioId){
    rq('/api/finance/portfolios/'+_fhCurrentPortfolioId+'/history?days='+days).then(function(r){
      if(r&&r.history) drawFHChart(r.history);
    });
  }
}

function drawFHChart(history){
  var canvas = document.getElementById('fh-chart');
  var empty  = document.getElementById('fh-chart-empty');
  if(!canvas) return;
  if(!history||!history.length){
    canvas.style.display='none'; if(empty) empty.style.display='block'; return;
  }
  canvas.style.display='block'; if(empty) empty.style.display='none';
  var ctx = canvas.getContext('2d');
  var W = canvas.offsetWidth || 300; var H = 120;
  canvas.width = W; canvas.height = H;
  var vals = history.map(function(d){ return parseFloat(d.total_value||d.value||0); });
  var mn = Math.min.apply(null,vals), mx = Math.max.apply(null,vals);
  if(mn===mx){ mn-=1; mx+=1; }
  var pad=12;
  var toY = function(v){ return H-pad-(v-mn)/(mx-mn)*(H-pad*2); };
  var toX = function(i){ return pad+(i/(vals.length-1||1))*(W-pad*2); };
  var grad = ctx.createLinearGradient(0,0,0,H);
  var isUp = vals[vals.length-1] >= vals[0];
  var baseCol = isUp ? '#10B981' : '#EF4444';
  grad.addColorStop(0, isUp?'rgba(16,185,129,.2)':'rgba(239,68,68,.2)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.clearRect(0,0,W,H);
  ctx.beginPath(); ctx.moveTo(toX(0),toY(vals[0]));
  for(var i=1;i<vals.length;i++) ctx.lineTo(toX(i),toY(vals[i]));
  ctx.strokeStyle=baseCol; ctx.lineWidth=2; ctx.stroke();
  ctx.lineTo(toX(vals.length-1),H); ctx.lineTo(toX(0),H); ctx.closePath();
  ctx.fillStyle=grad; ctx.fill();
}

/* ═══════════════════════════════════════
   MARKETS TAB
   ═══════════════════════════════════════ */

var _fhAllMarkets = [];

var _FH_MARKETS_LIST = [
  {ticker:'SPY',  name:'SPDR S&P 500 ETF',          cat:'etf'},
  {ticker:'QQQ',  name:'Invesco QQQ Trust',           cat:'etf'},
  {ticker:'VWCE', name:'Vanguard All-World ETF',      cat:'etf'},
  {ticker:'TLT',  name:'iShares 20Y Treasury',        cat:'bond'},
  {ticker:'IEF',  name:'iShares 7-10Y Treasury',      cat:'bond'},
  {ticker:'GLD',  name:'SPDR Gold Shares',            cat:'commodity'},
  {ticker:'CL=F', name:'WTI Crude Oil',               cat:'commodity'},
  {ticker:'NG=F', name:'Natural Gas',                 cat:'commodity'},
  {ticker:'AAPL', name:'Apple Inc.',                  cat:'equity'},
  {ticker:'MSFT', name:'Microsoft Corp.',             cat:'equity'},
  {ticker:'NVDA', name:'NVIDIA Corp.',                cat:'equity'},
  {ticker:'GOOGL',name:'Alphabet Inc.',               cat:'equity'},
  {ticker:'AMZN', name:'Amazon.com Inc.',             cat:'equity'},
  {ticker:'META', name:'Meta Platforms Inc.',         cat:'equity'},
  {ticker:'TSLA', name:'Tesla Inc.',                  cat:'equity'},
  {ticker:'EURUSD=X',name:'EUR/USD',                  cat:'fx'},
  {ticker:'GBP=X',   name:'GBP/USD',                  cat:'fx'},
  {ticker:'JPY=X',   name:'USD/JPY',                   cat:'fx'},
  {ticker:'DX=F',    name:'US Dollar Index',           cat:'fx'},
  {ticker:'BTC-USD', name:'Bitcoin',                  cat:'equity'},
];

function loadFHMarkets(){
  if(!window.G||!G.token) return;
  if(_fhAllMarkets.length){ _fhRenderMarkets(); return; }

  var grid = document.getElementById('fh-markets-grid');
  if(grid) grid.innerHTML = '<div class="fh-loading">Caricamento quotazioni…</div>';

  // First try finance_cache endpoint
  rq('/api/finance/markets').then(function(r){
    if(r && Array.isArray(r) && r.length){
      _fhAllMarkets = r;
      _fhRenderMarkets();
    } else {
      // Fallback: fetch each ticker
      Promise.all(_FH_MARKETS_LIST.map(function(m){
        return rq('/api/finance/quote/'+m.ticker).then(function(q){
          if(!q||!q.price) return null;
          return Object.assign({}, m, {price:q.price, change_pct:q.change_pct||0, name:q.name||m.name});
        });
      })).then(function(results){
        _fhAllMarkets = results.filter(Boolean);
        _fhRenderMarkets();
      });
    }
  }).catch(function(){
    // Fallback
    Promise.all(_FH_MARKETS_LIST.slice(0,8).map(function(m){
      return rq('/api/finance/quote/'+m.ticker).then(function(q){
        if(!q||!q.price) return null;
        return Object.assign({}, m, {price:q.price, change_pct:q.change_pct||0});
      }).catch(function(){ return null; });
    })).then(function(r){
      _fhAllMarkets = r.filter(Boolean);
      _fhRenderMarkets();
    });
  });
}

function fhMktFilter(cat, btn){
  _fhMktFilter = cat;
  document.querySelectorAll('.fh-mkt-flt').forEach(function(b){ b.classList.remove('on'); });
  if(btn) btn.classList.add('on');
  _fhRenderMarkets();
}

function fhMktSearch(q){
  q = q.toUpperCase();
  var filtered = _fhAllMarkets.filter(function(m){
    return !q || m.ticker.indexOf(q)!==-1 || (m.name||'').toUpperCase().indexOf(q)!==-1;
  });
  _fhRenderMarketsData(filtered);
}

function _fhRenderMarkets(){
  var q = (document.getElementById('fh-mkt-search')||{}).value||'';
  var filtered = _fhAllMarkets.filter(function(m){
    var catOk = !_fhMktFilter || m.cat===_fhMktFilter || m.category===_fhMktFilter;
    var qOk   = !q || m.ticker.toUpperCase().indexOf(q.toUpperCase())!==-1 || (m.name||'').toUpperCase().indexOf(q.toUpperCase())!==-1;
    return catOk && qOk;
  });
  _fhRenderMarketsData(filtered);
}

function _fhRenderMarketsData(items){
  var grid = document.getElementById('fh-markets-grid');
  if(!grid) return;
  if(!items.length){
    grid.innerHTML = '<div class="fh-loading">Nessun risultato.</div>'; return;
  }
  grid.innerHTML = items.map(function(m){
    var chg = parseFloat(m.change_pct||m.pct_change||0);
    var col  = chg>=0?'#10B981':'#EF4444';
    var cls  = chg>=0?'fh-mkt-up':'fh-mkt-down';
    var sign = chg>=0?'+':'';
    return '<div class="fh-mkt-card '+cls+'">'
      +'<div class="fh-mkt-ticker">'+_esc(m.ticker||m.symbol)+'</div>'
      +'<div class="fh-mkt-name">'+_esc(m.name||m.ticker)+'</div>'
      +'<div class="fh-mkt-price" style="color:'+col+'">'+fmtPrice(parseFloat(m.price||0))+'</div>'
      +'<div class="fh-mkt-chg" style="color:'+col+'">'+sign+chg.toFixed(2)+'%</div>'
      +'<div class="fh-mkt-actions">'
      +  '<button class="fh-mkt-action-btn" onclick="event.stopPropagation();fhMktAddWatchlist(\''+_esc(m.ticker||m.symbol)+'\')" title="Aggiungi watchlist">★ WL</button>'
      +  '<button class="fh-mkt-action-btn" onclick="event.stopPropagation();fhMktAddPortfolio(\''+_esc(m.ticker||m.symbol)+'\','+parseFloat(m.price||0)+')" title="Aggiungi portafoglio">＋ Port.</button>'
      +'</div>'
      +'</div>';
  }).join('');
}

function fhMktAddWatchlist(ticker){
  rq('/api/watchlist',{method:'POST',body:{type:'ticker',value:ticker,label:ticker}})
    .then(function(){ toast(ticker+' aggiunto alla watchlist','ok'); });
}

function fhMktAddPortfolio(ticker, price){
  if(!_fhCurrentPortfolioId){
    toast('Seleziona prima un portafoglio nella tab Portafogli','inf');
    fhTab('portfolios', document.querySelector('[data-tab=portfolios]'));
    return;
  }
  // Pre-fill and open add holding modal
  fhTab('portfolios', document.querySelector('[data-tab=portfolios]'));
  setTimeout(function(){
    openAddHoldingModal();
    var ti = document.getElementById('fh-hm-ticker');
    var pi = document.getElementById('fh-hm-price');
    if(ti){ ti.value = ticker; }
    if(pi && price){ pi.value = price.toFixed(2); }
    fhUpdateCostEstimate();
  }, 100);
}

/* ═══════════════════════════════════════
   WATCHLIST TAB
   ═══════════════════════════════════════ */

function loadFHWatchlist(){
  if(!window.G||!G.token) return;
  rq('/api/watchlist').then(function(r){
    var items = (r&&r.items)||[];
    var el = document.getElementById('fh-watchlist-items');
    if(!el) return;
    var tickers = items.filter(function(i){ return i.type==='ticker'||i.type==='etf'||!i.type; });
    if(!tickers.length){
      el.innerHTML = '<div class="fh-loading">Aggiungi ticker dalla barra sopra per monitorarli in tempo reale.</div>';
      return;
    }
    Promise.all(tickers.map(function(i){
      return rq('/api/finance/quote/'+(i.value||i.label)).catch(function(){ return null; });
    })).then(function(quotes){
      el.innerHTML = tickers.map(function(item, idx){
        var q = quotes[idx];
        var price = q && q.price ? fmtPrice(q.price) : '—';
        var chg   = q ? parseFloat(q.change_pct||0) : 0;
        var col   = chg>=0?'#10B981':'#EF4444';
        var nm    = q && q.name ? q.name : (item.value||item.label);
        return '<div class="fh-wl-row">'
          +'<div class="fh-wl-ticker">'+_esc(item.value||item.label)+'</div>'
          +'<div class="fh-wl-name">'+_esc(nm)+'</div>'
          +'<div class="fh-wl-price" style="color:'+col+'">'+price+'</div>'
          +'<div class="fh-wl-chg" style="color:'+col+'">'+(chg>=0?'+':'')+chg.toFixed(2)+'%</div>'
          +'<div class="fh-wl-actions">'
          +  '<button class="fh-wl-btn" onclick="fhMktAddPortfolio(\''+_esc(item.value||item.label)+'\','+(q&&q.price?q.price:0)+')" title="Aggiungi al portafoglio">＋</button>'
          +  '<button class="fh-wl-btn fh-wl-del" onclick="removeFromWatchlist('+item.id+')" title="Rimuovi">✕</button>'
          +'</div>'
          +'</div>';
      }).join('');
    });
  });
}

function fhWlSuggest(q){
  var sug = document.getElementById('fh-wl-suggest');
  if(!sug) return;
  if(q.length < 1){ sug.style.display='none'; return; }
  rq('/api/finance/search/'+encodeURIComponent(q)).then(function(r){
    var results = (r&&r.results)||[];
    if(!results.length){ sug.style.display='none'; return; }
    sug.style.display='block';
    sug.innerHTML = results.slice(0,6).map(function(x){
      return '<div style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(255,255,255,.04)" '
        +'onmousedown="event.preventDefault()" '
        +'onclick="fhWlPickSuggest(\''+_esc(x.ticker)+'\')">'
        +'<strong>'+_esc(x.ticker)+'</strong>'
        +(x.name&&x.name!==x.ticker?' <span style=\"color:var(--t3);font-size:10px\">'+_esc(x.name)+'</span>':'')
        +'</div>';
    }).join('');
  }).catch(function(){ sug.style.display='none'; });
}

function fhWlPickSuggest(ticker){
  var inp = document.getElementById('fh-wl-inp');
  var sug = document.getElementById('fh-wl-suggest');
  if(inp) inp.value = ticker;
  if(sug) sug.style.display='none';
  addToWatchlist(ticker);
}

function addToWatchlist(tickerArg){
  var inp = document.getElementById('fh-wl-inp');
  var ticker = tickerArg || (inp ? inp.value.trim().toUpperCase() : '');
  if(!ticker||!window.G||!G.token) return;
  rq('/api/watchlist',{method:'POST',body:{type:'ticker',value:ticker,label:ticker}})
    .then(function(){
      if(inp) inp.value='';
      var sug = document.getElementById('fh-wl-suggest');
      if(sug) sug.style.display='none';
      loadFHWatchlist();
      toast(ticker+' aggiunto alla watchlist','ok');
    });
}

function removeFromWatchlist(id){
  if(!window.G||!G.token) return;
  rq('/api/watchlist/'+id,{method:'DELETE'}).then(loadFHWatchlist);
}

/* ═══════════════════════════════════════
   LAB AI TAB
   ═══════════════════════════════════════ */

function fhInitLab(){
  var warn = document.getElementById('fh-no-portfolio-warn');
  if(warn) warn.style.display = _fhCurrentPortfolioId ? 'none' : 'block';
}

function runLabSim(type){
  if(type==='paper'){
    sv('tradgentic', document.querySelector('[data-v=tradgentic]'));
    return;
  }
  if(type==='opportunities'){
    sv('opportunity', document.querySelector('[data-v=opportunity]'));
    return;
  }
  var resultEl = document.getElementById('fh-lab-result');
  if(!resultEl) return;

  if(!_fhCurrentPortfolioId){
    toast('Seleziona prima un portafoglio nella tab Portafogli','inf');
    fhTab('portfolios', document.querySelector('[data-tab=portfolios]'));
    return;
  }


  // Show loading immediately
  resultEl.style.display='block';
  resultEl.innerHTML = '<div style="padding:16px;background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.15);border-radius:10px;font-size:12px;color:var(--t2);line-height:1.7">⏳ Caricamento contesto portafoglio…</div>';

  // Fetch fresh portfolio detail to get real holdings with weights/P&L
  rq('/api/finance/portfolios/'+_fhCurrentPortfolioId).then(function(portDetail){
    var holdings = (portDetail && portDetail.holdings) || [];
    var portName = (portDetail && portDetail.name) || 'Portafoglio';
    var currency = (portDetail && portDetail.base_currency) || 'EUR';
    var totalVal = portDetail && portDetail.total_value ? fmtCurrency(portDetail.total_value, currency) : '—';
    var retPct   = portDetail && portDetail.total_return_pct
      ? (portDetail.total_return_pct >= 0 ? '+' : '') + parseFloat(portDetail.total_return_pct).toFixed(2) + '%' : '—';

    var holdingsSummary = holdings.length
      ? holdings.map(function(h){
          return h.ticker
            + ' (' + parseFloat(h.weight_pct||0).toFixed(0) + '%'
            + ', avg ' + parseFloat(h.avg_price||0).toFixed(2)
            + ', P&L ' + (parseFloat(h.return_pct||0)>=0?'+':'') + parseFloat(h.return_pct||0).toFixed(1) + '%)';
        }).join(', ')
      : 'Portafoglio vuoto';

    var ctx = 'Portafoglio: ' + portName + ' | Valore: ' + totalVal + ' | Rendimento totale: ' + retPct + '\n'
      + 'Posizioni: ' + holdingsSummary + '\n\n';

    var prompts = {
      backtest: ctx + 'Fai un backtest storico stimato di questo portafoglio negli ultimi 3 anni. Per ogni asset stima rendimento annualizzato, volatilità e contributo. Calcola Sharpe ratio e Max Drawdown del portafoglio complessivo. Sii specifico con numeri e percentuali.',
      stress:   ctx + 'Esegui uno stress test. Simula: (1) crisi GFC 2008 -40% equity, (2) shock COVID-19, (3) rialzo Fed +300bp. Per ogni scenario indica % perdita stimata su ciascuna posizione e totale portafoglio. Suggerisci 3 strumenti concreti di copertura (hedge) con ticker specifici.',
      optimize: ctx + 'Analizza e suggerisci un ribilanciamento per massimizzare lo Sharpe ratio. Indica % target per ogni asset, cosa ridurre/vendere, e 1-2 nuove posizioni da aggiungere con ticker e motivazione basata sul contesto macro attuale.',
    };

    resultEl.innerHTML = '<div style="padding:16px;background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.15);border-radius:10px;font-size:12px;color:var(--t2);line-height:1.7">⏳ Analisi AI in corso… (15-30 secondi)</div>';

    rq('/api/brain-agent/ask',{method:'POST',body:{query:prompts[type], session_id:'lab_fh_'+type}})
      .then(function(r){
        var ans = (r && (r.answer || r.response))
          || (r && typeof r.detail === 'string' ? r.detail : null)
          || 'Configura una chiave AI in Profilo → Impostazioni AI.';
        resultEl.innerHTML = [
          '<div style="padding:16px;background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.07);border-radius:10px;font-size:12px;color:var(--t2);line-height:1.75;white-space:pre-wrap">',
          _esc(ans),
          '</div>',
          '<div style="display:flex;gap:8px;margin-top:10px">',
          '<button class="btn btn-g btn-sm" onclick="var el=document.getElementById(&quot;fh-lab-result&quot;);if(el)el.style.display=&quot;none&quot;">&#x2715; Chiudi</button>',
          '</div>'
        ].join('');
      })
      .catch(function(e){
        resultEl.innerHTML = '<div style="padding:12px;color:#F87171;font-size:12px">Errore AI: ' + _esc(String(e)) + '</div>';
      });
  });
}

/* ═══════════════════════════════════════
   MODALS — Portfolio
   ═══════════════════════════════════════ */

function openNewPortfolioModal(){
  var m = document.getElementById('fh-new-portfolio-modal');
  if(m) m.style.display='flex';
  setTimeout(function(){ var inp=document.getElementById('fh-pm-name'); if(inp) inp.focus(); }, 100);
}
function closePortfolioModal(){
  var m = document.getElementById('fh-new-portfolio-modal');
  if(m) m.style.display='none';
}

function pickIcon(el, icon){
  document.querySelectorAll('.fh-icon-pick').forEach(function(e){ e.classList.remove('on'); });
  el.classList.add('on');
  var inp = document.getElementById('fh-pm-icon');
  if(inp) inp.value = icon;
}

async function saveNewPortfolio(){
  var name  = (document.getElementById('fh-pm-name')||{}).value||'';
  var cur   = (document.getElementById('fh-pm-currency')||{}).value||'EUR';
  var bench = (document.getElementById('fh-pm-bench')||{}).value||'VWCE';
  var icon  = (document.getElementById('fh-pm-icon')||{}).value||'💼';
  if(!name.trim()){ toast('Inserisci un nome','err'); return; }
  var r = await rq('/api/finance/portfolios',{method:'POST',body:{name:name.trim(),base_currency:cur,benchmark_ticker:bench,icon}});
  if(r&&r.id){
    closePortfolioModal();
    toast(name+' creato!','ok');
    _fhCurrentPortfolioId = r.id;
    loadFHPortfolios();
  } else {
    toast('Errore creazione portafoglio','err');
  }
}

/* ═══════════════════════════════════════
   MODALS — Holding CRUD
   ═══════════════════════════════════════ */

function openAddHoldingModal(){
  if(!_fhCurrentPortfolioId){ toast('Seleziona prima un portafoglio','inf'); return; }
  var m = document.getElementById('fh-add-holding-modal');
  if(m){ m.style.display='flex'; }
  // Reset fields
  ['fh-hm-ticker','fh-hm-shares','fh-hm-price','fh-hm-date'].forEach(function(id){
    var el=document.getElementById(id); if(el) el.value='';
  });
  var costEl = document.getElementById('fh-hm-cost');
  if(costEl) costEl.textContent = 'Costo stimato: —';
  var sug = document.getElementById('fh-ticker-suggest');
  if(sug) sug.style.display='none';
  setTimeout(function(){ var inp=document.getElementById('fh-hm-ticker'); if(inp) inp.focus(); }, 100);
}
function closeHoldingModal(){
  var m = document.getElementById('fh-add-holding-modal');
  if(m) m.style.display='none';
}

function fhUpdateCostEstimate(){
  var shares = parseFloat((document.getElementById('fh-hm-shares')||{}).value||0);
  var price  = parseFloat((document.getElementById('fh-hm-price') ||{}).value||0);
  var el = document.getElementById('fh-hm-cost');
  if(el){
    if(shares>0 && price>0){
      var cost = shares*price;
      var sym  = ((document.getElementById('fh-hm-currency')||{}).value==='EUR')?'€':'$';
      el.textContent = 'Costo stimato: '+sym+(cost>=1000?(cost/1000).toFixed(2)+'k':cost.toFixed(2));
    } else {
      el.textContent = 'Costo stimato: —';
    }
  }
}

async function saveNewHolding(){
  var ticker = ((document.getElementById('fh-hm-ticker')||{}).value||'').trim().toUpperCase();
  var shares = parseFloat((document.getElementById('fh-hm-shares')||{}).value||0);
  var price  = parseFloat((document.getElementById('fh-hm-price') ||{}).value||0);
  var cur    = (document.getElementById('fh-hm-currency')||{}).value||'USD';
  var cls    = (document.getElementById('fh-hm-class')   ||{}).value||'equity';
  var date   = (document.getElementById('fh-hm-date')    ||{}).value||'';
  if(!ticker){ toast('Inserisci il ticker','err'); return; }
  if(!shares||shares<=0){ toast('Inserisci una quantità valida','err'); return; }
  if(!price||price<=0){ toast('Inserisci il prezzo di acquisto','err'); return; }

  var r = await rq('/api/finance/portfolios/'+_fhCurrentPortfolioId+'/holdings',{
    method:'POST', body:{ticker,shares,avg_price:price,currency:cur,asset_class:cls,purchase_date:date||null}
  });
  if(r && r.id){
    closeHoldingModal();
    toast(ticker+' aggiunto!','ok');
    selectFHPortfolio(_fhCurrentPortfolioId);
  } else {
    toast((r&&r.detail)||'Errore aggiunta posizione','err');
  }
}

/* Edit holding */
function fhOpenEditHolding(hid, shares, avgPrice, ticker){
  var m = document.getElementById('fh-edit-holding-modal');
  if(!m) return;
  document.getElementById('fh-edit-hid').value = hid;
  document.getElementById('fh-edit-title').textContent = 'Modifica '+ticker;
  document.getElementById('fh-edit-shares').value = shares;
  document.getElementById('fh-edit-price').value  = avgPrice;
  m.style.display = 'flex';
}
function closeEditHoldingModal(){
  var m = document.getElementById('fh-edit-holding-modal');
  if(m) m.style.display='none';
}
async function fhSaveEditHolding(){
  var hid    = parseInt(document.getElementById('fh-edit-hid').value);
  var shares = parseFloat(document.getElementById('fh-edit-shares').value||0);
  var price  = parseFloat(document.getElementById('fh-edit-price').value||0);
  if(!shares||shares<=0){ toast('Quantità non valida','err'); return; }
  if(!price||price<=0){ toast('Prezzo non valido','err'); return; }
  var r = await rq('/api/finance/holdings/'+hid,{method:'PUT',body:{shares,avg_price:price}});
  if(r && r.ok){
    closeEditHoldingModal();
    toast('Posizione aggiornata','ok');
    selectFHPortfolio(_fhCurrentPortfolioId);
  } else {
    toast('Errore aggiornamento','err');
  }
}

/* Delete confirmation */
function fhConfirmDeleteHolding(hid, ticker){
  var msg = document.getElementById('fh-delete-msg');
  var btn = document.getElementById('fh-delete-confirm-btn');
  var modal = document.getElementById('fh-delete-confirm');
  if(!modal) return;
  if(msg) msg.textContent = 'Vuoi rimuovere '+ticker+' dal portafoglio? L\'operazione non è reversibile.';
  _fhPendingDeleteFn = async function(){
    var r = await rq('/api/finance/holdings/'+hid,{method:'DELETE'});
    fhCancelDelete();
    toast(ticker+' rimosso','ok');
    selectFHPortfolio(_fhCurrentPortfolioId);
  };
  if(btn) btn.onclick = _fhPendingDeleteFn;
  modal.style.display='flex';
}
function fhCancelDelete(){
  var modal = document.getElementById('fh-delete-confirm');
  if(modal) modal.style.display='none';
  _fhPendingDeleteFn = null;
}
function fhDeleteHoldingConfirm(){
  // Called from edit modal
  var hid = parseInt((document.getElementById('fh-edit-hid')||{}).value||0);
  if(!hid) return;
  var title = (document.getElementById('fh-edit-title')||{}).textContent||'';
  closeEditHoldingModal();
  fhConfirmDeleteHolding(hid, title.replace('Modifica ',''));
}

/* ═══════════════════════════════════════
   HOLDING DETAIL BOTTOM SHEET
   ═══════════════════════════════════════ */

function fhOpenHoldingDetail(jsonStr){
  var h;
  try { h = JSON.parse(jsonStr); } catch(e){ return; }
  _fhCurrentHoldingForDetail = h;

  var sheet = document.getElementById('fh-holding-detail');
  if(!sheet) return;

  setText('fh-detail-ticker', h.ticker||'');
  setText('fh-detail-name',   h.name||h.ticker||'');

  // P&L KPIs
  var retPct = h.return_pct||0;
  var retCol = retPct>=0?'#10B981':'#EF4444';
  var curVal = h.current_value||0;
  var pnlEl  = document.getElementById('fh-detail-pnl');
  if(pnlEl){
    pnlEl.innerHTML = [
      {v:fmtCurrency(curVal,'EUR'),        l:'Valore attuale'},
      {v:(retPct>=0?'+':'')+retPct.toFixed(2)+'%', l:'Rendimento', c:retCol},
      {v:parseFloat(h.weight_pct||0).toFixed(1)+'%', l:'Peso portaf.'},
    ].map(function(k){
      return '<div class="fh-detail-kpi">'
        +'<div class="fh-detail-kpi-v" style="color:'+(k.c||'var(--t1)')+'">'+k.v+'</div>'
        +'<div class="fh-detail-kpi-l">'+k.l+'</div>'
        +'</div>';
    }).join('');
  }

  // Opportunity signals for this ticker
  var oppEl   = document.getElementById('fh-detail-opp');
  var oppList = document.getElementById('fh-detail-opp-list');
  if(oppEl && oppList && h.ticker){
    rq('/api/opportunity/ideas?limit=5&min_score=45&status=active').then(function(r){
      var ideas = ((r&&r.ideas)||[]).filter(function(i){ return i.ticker.toUpperCase()===h.ticker.toUpperCase(); });
      if(!ideas.length){ oppEl.style.display='none'; return; }
      oppEl.style.display='block';
      oppList.innerHTML = ideas.map(function(idea){
        var col = idea.direction==='LONG'?'#10B981':'#EF4444';
        return '<div style="font-size:11px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);display:flex;gap:8px;align-items:center">'
          +'<span style="color:'+col+';font-weight:700">'+(idea.direction==='LONG'?'▲ LONG':'▼ SHORT')+'</span>'
          +'<span style="color:var(--t2);flex:1">'+_esc(idea.rationale||'')+'</span>'
          +'<span style="color:'+col+';font-size:10px">⚡'+idea.opp_score+'</span>'
          +'</div>';
      }).join('');
    });
  }

  sheet.style.display='flex';
}

function fhCloseHoldingDetail(){
  var sheet = document.getElementById('fh-holding-detail');
  if(sheet) sheet.style.display='none';
  _fhCurrentHoldingForDetail = null;
}

function fhOpenEditFromDetail(){
  var h = _fhCurrentHoldingForDetail;
  if(!h) return;
  fhCloseHoldingDetail();
  fhOpenEditHolding(h.id, h.shares, h.avg_price, h.ticker);
}

function fhDeleteHoldingFromDetail(){
  var h = _fhCurrentHoldingForDetail;
  if(!h) return;
  fhCloseHoldingDetail();
  fhConfirmDeleteHolding(h.id, h.ticker);
}

/* ═══════════════════════════════════════
   TICKER SEARCH (shared)
   ═══════════════════════════════════════ */

var _tickerSearchTimeout;
function searchTickerSuggest(q){
  clearTimeout(_tickerSearchTimeout);
  var sug = document.getElementById('fh-ticker-suggest');
  if(!sug) return;
  if(q.length < 1){ sug.style.display='none'; return; }
  _tickerSearchTimeout = setTimeout(function(){
    rq('/api/finance/search/'+encodeURIComponent(q)).then(function(r){
      var results = (r&&r.results)||[];
      if(!results.length){ sug.style.display='none'; return; }
      sug.style.display='block';
      sug.innerHTML = results.slice(0,8).map(function(x){
        return '<div style="padding:8px 12px;cursor:pointer;font-size:12px;border-bottom:1px solid rgba(255,255,255,.04);display:flex;align-items:center;gap:8px" '
          +'onmousedown="event.preventDefault()" '
          +'onclick="fhPickTicker(\''+_esc(x.ticker)+'\','+parseFloat(x.price||0)+')">'
          +'<strong style="min-width:50px">'+_esc(x.ticker)+'</strong>'
          +(x.name&&x.name!==x.ticker?'<span style="color:var(--t3);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+_esc(x.name)+'</span>':'')
          +(x.price?'<span style="margin-left:auto;font-family:var(--fm);font-size:11px">'+fmtPrice(x.price)+'</span>':'')
          +'</div>';
      }).join('');
    }).catch(function(){ sug.style.display='none'; });
  }, 300);
}

function fhPickTicker(ticker, price){
  var inp = document.getElementById('fh-hm-ticker');
  var priceInp = document.getElementById('fh-hm-price');
  var sug = document.getElementById('fh-ticker-suggest');
  if(inp) inp.value = ticker;
  if(priceInp && price > 0 && !priceInp.value) priceInp.value = price.toFixed(2);
  if(sug) sug.style.display='none';
  fhUpdateCostEstimate();
}

/* ═══════════════════════════════════════
   UTILITIES
   ═══════════════════════════════════════ */

function fmtCurrency(val, currency){
  var sym = currency==='USD'?'$':currency==='GBP'?'£':'€';
  if(val >= 1000000) return sym+(val/1000000).toFixed(2)+'M';
  if(val >= 1000)    return sym+(val/1000).toFixed(1)+'k';
  return sym+val.toFixed(2);
}
function fmtPrice(val){
  if(val >= 1000) return val.toFixed(0);
  if(val >= 10)   return val.toFixed(2);
  return val.toFixed(4);
}
function setText(id, txt){ var e=document.getElementById(id); if(e) e.textContent=txt; }

/* ═══════════════════════════════════════
   AUTO-INIT
   ═══════════════════════════════════════ */

(function(){
  var view = document.getElementById('view-portfolio');
  if(!view) return;
  new MutationObserver(function(){
    if(view.classList.contains('on') && window.G && G.token){
      loadFHPortfolios();
    }
  }).observe(view, {attributes:true, attributeFilter:['class']});
})();


/* ── Intel Cards DOM Sync/* ── Intel Cards DOM Sync — runs after each dashboard data load ── */
function syncIntelCardsFromDOM(){
  if(!document.getElementById('section-intel-cards')) return;

  // EW Score from live DOM
  var ewScoreEl = document.getElementById('dash-ew-score') || document.getElementById('ew-score');
  var icEwScore = document.getElementById('ic-ew-score');
  if(ewScoreEl && icEwScore && ewScoreEl.textContent.trim() && ewScoreEl.textContent.trim()!=='—'){
    var sc = parseFloat(ewScoreEl.textContent)||0;
    icEwScore.textContent = sc.toFixed(1)+'/10';
    icEwScore.style.color = sc>=8?'#EF4444':sc>=6?'#F59E0B':'#10B981';
  }

  // EW text from live DOM
  var ewAssess = document.getElementById('ew-assess') || document.querySelector('.ew-assess-text');
  var icEwTxt = document.getElementById('ic-ew-text');
  if(ewAssess && icEwTxt && ewAssess.textContent.length>20 && icEwTxt.textContent.includes('corso')){
    icEwTxt.textContent = ewAssess.textContent.slice(0,280)+'…';
  }

  // Crisis events from DOM
  var crisisList = document.getElementById('d-evlist');
  var icCritTitle = document.getElementById('ic-critical-title');
  if(crisisList && icCritTitle && icCritTitle.textContent==='Caricamento…'){
    var firstEv = crisisList.querySelector('.fire-ev-row, .dash-crisis-item, .ev-row');
    if(firstEv){
      var titleEl = firstEv.querySelector('.fire-ev-title, .ev-title, [class*=title]');
      if(titleEl) icCritTitle.textContent = titleEl.textContent.slice(0,90);
    }
  }
}

// Hook syncIntelCardsFromDOM to renderDash
var _origRenderDash = window.renderDash;
if(typeof renderDash === 'function' && !window._syncHooked){
  window._syncHooked = true;
  var _rdOrig = renderDash;
  window.renderDash = renderDash = function(){
    _rdOrig.apply(this, arguments);
    setTimeout(syncIntelCardsFromDOM, 1500);
    setTimeout(syncIntelCardsFromDOM, 4000);
  };
}

/* ════════════════════════════════════════════════════════════════════
   OPPORTUNITY ENGINE — Trade Ideas + Anomaly Alerts
   ════════════════════════════════════════════════════════════════════ */

var _oppDir = '';
var _oppIdeasCache = [];

/* Load dashboard on view open */
document.addEventListener('wl-view-change', function(e){
  if(e.detail && e.detail.view === 'opportunity') oppRefresh();
});
/* Hook into sv() if it doesn't dispatch events */
var _svOrig = window.sv;
window.sv = function(name, el){
  if(name === 'opportunity') oppRefresh();
  return _svOrig ? _svOrig.apply(this, arguments) : null;
};

async function oppRefresh(){
  var btn = document.getElementById('opp-refresh-btn');
  if(btn) btn.disabled = true;
  try {
    var dash = await rq('/api/opportunity/dashboard');
    if(dash){
      _oppIdeasCache = dash.top_ideas || [];
      _oppRenderStats(dash);
    }
    await oppLoadIdeas();
  } catch(e){ console.warn('opp refresh', e); }
  if(btn){ btn.disabled = false; }
}

function _oppRenderStats(dash){
  var s = dash.stats || {};
  _setTxt('opp-stat-total',   s.total  || 0);
  _setTxt('opp-stat-longs',   s.longs  || 0);
  _setTxt('opp-stat-shorts',  s.shorts || 0);
  _setTxt('opp-stat-anomalies', dash.unread_anomalies || 0);
  // Badge on nav
  var badge = document.getElementById('opp-nav-badge');
  if(badge) badge.style.display = (dash.unread_anomalies > 0) ? 'block' : 'none';
}

function _setTxt(id, val){
  var el = document.getElementById(id);
  if(el) el.textContent = val;
}

async function oppLoadIdeas(){
  var dir   = _oppDir;
  var score = document.getElementById('opp-score-filter') ? document.getElementById('opp-score-filter').value : 45;
  var url   = '/api/opportunity/ideas?limit=30&min_score='+score;
  if(dir) url += '&direction='+dir;

  var list = document.getElementById('opp-ideas-list');
  if(!list) return;
  list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--t3);font-size:12px">⏳ Caricamento…</div>';

  var data = await rq(url);
  var ideas = (data && data.ideas) ? data.ideas : [];

  if(!ideas.length){
    list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--t3);font-size:12px">Nessuna trade idea trovata.<br>Le idee vengono generate automaticamente dagli eventi ad alto impatto.</div>';
    return;
  }

  list.innerHTML = ideas.map(function(idea){ return _oppIdeaCard(idea); }).join('');
}

function _oppIdeaCard(idea){
  var isLong    = idea.direction === 'LONG';
  var dirColor  = isLong ? '#10B981' : '#EF4444';
  var dirLabel  = isLong ? '▲ LONG' : '▼ SHORT';
  var scoreColor = idea.opp_score >= 70 ? '#F59E0B' : idea.opp_score >= 55 ? '#60A5FA' : '#94A3B8';
  var confPct   = Math.round((idea.confidence || 0.5) * 100);
  var targetPct = idea.target_pct ? (idea.target_pct > 0 ? '+' : '') + idea.target_pct.toFixed(1) + '%' : '—';
  var stopPct   = idea.stop_pct ? '-' + idea.stop_pct.toFixed(1) + '%' : '—';
  var entry     = (idea.entry_low && idea.entry_high)
    ? idea.entry_low.toFixed(2) + ' – ' + idea.entry_high.toFixed(2)
    : 'Market';
  var catBadge  = idea.event_category || '';
  var risks     = [];
  var catalysts = [];
  try { risks     = typeof idea.risks     === 'string' ? JSON.parse(idea.risks)     : (idea.risks     || []); } catch(e){}
  try { catalysts = typeof idea.catalysts === 'string' ? JSON.parse(idea.catalysts) : (idea.catalysts || []); } catch(e){}

  return '<div class="card" style="border-left:3px solid '+dirColor+';padding:14px">'
    + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">'
    +   '<div style="display:flex;align-items:center;gap:8px">'
    +     '<div style="font-size:16px;font-weight:800;font-family:var(--fm);color:'+dirColor+'">'+_escHtml(idea.ticker)+'</div>'
    +     '<div style="font-size:10px;padding:2px 7px;border-radius:100px;background:rgba(255,255,255,.06);color:'+dirColor+'">'+dirLabel+'</div>'
    +     (catBadge ? '<div style="font-size:9px;padding:2px 6px;border-radius:100px;background:rgba(255,255,255,.05);color:var(--t3)">'+_escHtml(catBadge)+'</div>' : '')
    +   '</div>'
    +   '<div style="display:flex;align-items:center;gap:6px">'
    +     '<div style="font-size:11px;font-weight:700;color:'+scoreColor+'">⚡'+idea.opp_score+'</div>'
    +     '<div style="font-size:10px;color:var(--t3)">'+confPct+'% conf.</div>'
    +   '</div>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--t2);margin:8px 0 10px;line-height:1.55">'+_escHtml(idea.asset_name)+'</div>'
    + '<div style="font-size:11px;color:var(--t3);line-height:1.6;margin-bottom:10px;font-style:italic">'+_escHtml(idea.rationale||'')+'</div>'
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">'
    +   _oppKpi('Entry', entry)
    +   _oppKpi('Target', targetPct, isLong ? '#10B981' : '#EF4444')
    +   _oppKpi('Stop', stopPct, '#EF4444')
    +   _oppKpi('Timeframe', idea.timeframe || '—')
    + '</div>'
    + (catalysts.length ? '<div style="font-size:10px;color:var(--t3);margin-bottom:4px">Catalizzatori: '
        + catalysts.map(function(c){return '<span style="color:#60A5FA">'+_escHtml(c)+'</span>';}).join(' · ')
        + '</div>' : '')
    + (risks.length ? '<div style="font-size:10px;color:var(--t3)">Rischi: '
        + risks.map(function(r){return '<span style="color:#F87171">'+_escHtml(r)+'</span>';}).join(' · ')
        + '</div>' : '')
    + (idea.event_title ? '<div style="font-size:10px;color:var(--t3);margin-top:8px;padding-top:8px;border-top:1px solid var(--bd)">📰 '+_escHtml(idea.event_title.slice(0,90))+'</div>' : '')
    + '</div>';
}

function _oppKpi(label, val, color){
  return '<div style="background:var(--bg2);border-radius:var(--r8);padding:6px 8px;text-align:center">'
    + '<div style="font-size:12px;font-weight:700;font-family:var(--fm);color:'+(color||'#F1F5F9')+'">'+_escHtml(String(val))+'</div>'
    + '<div style="font-size:9px;color:var(--t3);margin-top:1px">'+_escHtml(label)+'</div>'
    + '</div>';
}

function oppSetDir(dir, btn){
  _oppDir = dir;
  document.querySelectorAll('.opp-dir-btn').forEach(function(b){b.classList.remove('on');});
  if(btn) btn.classList.add('on');
  oppLoadIdeas();
}

async function oppShowAnomalies(){
  var panel = document.getElementById('opp-anomalies-panel');
  var list  = document.getElementById('opp-anomalies-list');
  if(!panel || !list) return;
  panel.style.display = 'flex';
  list.innerHTML = '<div style="color:var(--t3);font-size:12px">Caricamento…</div>';
  var data = await rq('/api/opportunity/anomalies?limit=30&unread_only=true');
  var alerts = (data && data.alerts) ? data.alerts : [];
  if(!alerts.length){
    list.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:16px;text-align:center">Nessuna anomalia non letta.</div>';
    return;
  }
  list.innerHTML = alerts.map(function(a){
    var sevColor = a.severity==='high' ? '#EF4444' : a.severity==='medium' ? '#F59E0B' : '#94A3B8';
    var typeIcon = {volume_spike:'📊', price_breakout:'💥', momentum_divergence:'🔄', post_event_drift:'🎯'}[a.alert_type] || '⚠';
    return '<div class="card" style="border-left:3px solid '+sevColor+';padding:12px;position:relative">'
      + '<div style="display:flex;align-items:center;gap:7px;margin-bottom:5px">'
      +   '<span style="font-size:14px">'+typeIcon+'</span>'
      +   '<div style="font-size:12px;font-weight:700;color:var(--t1);flex:1">'+_escHtml(a.title)+'</div>'
      +   '<button onclick="oppAckAlert('+a.id+',this)" style="font-size:9px;padding:2px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:transparent;color:var(--t3);cursor:pointer">✓ Letto</button>'
      + '</div>'
      + '<div style="font-size:11px;color:var(--t3);line-height:1.55">'+_escHtml(a.detail)+'</div>'
      + '<div style="font-size:10px;color:var(--t3);margin-top:6px">'+a.created_at.slice(0,16).replace('T',' ')+'</div>'
      + '</div>';
  }).join('');
  // Scroll into view
  panel.scrollIntoView({behavior:'smooth', block:'nearest'});
}

async function oppAckAlert(id, btn){
  await rq('/api/opportunity/anomalies/'+id+'/ack', {method:'POST', body:{}});
  if(btn) btn.closest('.card').style.opacity = '0.4';
  // Update unread count
  var c = document.getElementById('opp-stat-anomalies');
  if(c){ var n = parseInt(c.textContent)||0; c.textContent = Math.max(0,n-1); }
}

function _escHtml(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── WebSocket hook for real-time anomaly badge ── */
var _oppWsOrig = window._handleWsMessage;
window._handleWsMessage = function(msg){
  if(_oppWsOrig) _oppWsOrig(msg);
  if(msg && msg.type === 'anomaly_alerts' && msg.count > 0){
    var badge = document.getElementById('opp-nav-badge');
    if(badge) badge.style.display = 'block';
    var c = document.getElementById('opp-stat-anomalies');
    if(c){ var n = parseInt(c.textContent)||0; c.textContent = n + msg.count; }
    toast('⚠ '+msg.count+' nuova anomalia di mercato', 'inf');
  }
};


/* ════════════════════════════════════════════════════════════════════
   OPPORTUNITY ENGINE — FASE 1 (Add to Portfolio) + FASE 4 (Track Record)
   ════════════════════════════════════════════════════════════════════ */

// ── Tab switcher ────────────────────────────────────────────────────
function oppMainTab(tab, btn){
  ['ideas','performance','anomalies'].forEach(function(t){
    var el = document.getElementById('opp-tab-'+t);
    if(el) el.style.display = t===tab ? 'flex' : 'none';
    if(el && t===tab) el.style.flexDirection = 'column';
  });
  document.querySelectorAll('.opp-main-tab').forEach(function(b){ b.classList.remove('on'); });
  if(btn) btn.classList.add('on');
  if(tab==='performance') oppLoadPerformance();
  if(tab==='anomalies')   oppShowAnomalies();
}

// ── Enhance existing _oppIdeaCard with "Aggiungi" button ────────────
var _oppIdeaCardOrig = window._oppIdeaCard || (typeof _oppIdeaCard !== 'undefined' ? _oppIdeaCard : null);

// Override _oppIdeaCard to inject the "Aggiungi al Portafoglio" button
// and the live P&L badge when pnl_pct is available
window._oppIdeaCard = function(idea){
  var isLong    = idea.direction === 'LONG';
  var dirColor  = isLong ? '#10B981' : '#EF4444';
  var dirLabel  = isLong ? '▲ LONG' : '▼ SHORT';
  var scoreColor = idea.opp_score >= 70 ? '#F59E0B' : idea.opp_score >= 55 ? '#60A5FA' : '#94A3B8';
  var confPct   = Math.round((idea.confidence || 0.5) * 100);
  var targetPct = idea.target_pct ? (idea.target_pct > 0 ? '+' : '') + parseFloat(idea.target_pct).toFixed(1) + '%' : '—';
  var stopPct   = idea.stop_pct ? '-' + parseFloat(idea.stop_pct).toFixed(1) + '%' : '—';
  var entry     = (idea.entry_low && idea.entry_high)
    ? parseFloat(idea.entry_low).toFixed(2) + ' – ' + parseFloat(idea.entry_high).toFixed(2)
    : 'Market';

  // Live P&L badge (Fase 4)
  var pnlBadge = '';
  if(idea.pnl_pct !== null && idea.pnl_pct !== undefined){
    var pnl = parseFloat(idea.pnl_pct);
    var pnlColor = pnl >= 0 ? '#10B981' : '#EF4444';
    pnlBadge = '<span style="font-size:10px;font-weight:700;color:'+pnlColor+';background:rgba('+
      (pnl>=0?'16,185,129':'239,68,68')+',.1);padding:2px 7px;border-radius:100px;margin-left:6px">'+
      (pnl>=0?'+':'')+pnl.toFixed(1)+'% P&L</span>';
  }

  var catBadge  = idea.event_category || '';
  var risks = [], catalysts = [];
  try { risks     = typeof idea.risks     === 'string' ? JSON.parse(idea.risks)     : (idea.risks     || []); } catch(e){}
  try { catalysts = typeof idea.catalysts === 'string' ? JSON.parse(idea.catalysts) : (idea.catalysts || []); } catch(e){}

  // Add to portfolio button (Fase 1)
  var ideaId = idea.id || '';
  var addBtn = ideaId
    ? '<button onclick="oppOpenAddModal('+ideaId+',\''+_escHtml(idea.ticker)+'\',\''+_escHtml(idea.asset_name)+'\','+
        (idea.entry_low||0)+','+dirColor.replace('#','')+',\''+dirLabel+'\')" '+
        'style="font-size:10px;padding:4px 10px;border-radius:8px;border:1px solid rgba(255,255,255,.15);'+
        'background:rgba(255,255,255,.05);color:var(--t2);cursor:pointer;white-space:nowrap">'+
        '+ Portafoglio</button>'
    : '';

  return '<div class="card" style="border-left:3px solid '+dirColor+';padding:14px">'
    + '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex-wrap:wrap">'
    +   '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">'
    +     '<div style="font-size:16px;font-weight:800;font-family:var(--fm);color:'+dirColor+'">'+_escHtml(idea.ticker)+'</div>'
    +     '<div style="font-size:10px;padding:2px 7px;border-radius:100px;background:rgba(255,255,255,.06);color:'+dirColor+'">'+dirLabel+'</div>'
    +     pnlBadge
    +     (catBadge ? '<div style="font-size:9px;padding:2px 6px;border-radius:100px;background:rgba(255,255,255,.05);color:var(--t3)">'+_escHtml(catBadge)+'</div>' : '')
    +   '</div>'
    +   '<div style="display:flex;align-items:center;gap:6px">'
    +     '<div style="font-size:11px;font-weight:700;color:'+scoreColor+'">⚡'+idea.opp_score+'</div>'
    +     '<div style="font-size:10px;color:var(--t3)">'+confPct+'% conf.</div>'
    +     addBtn
    +   '</div>'
    + '</div>'
    + '<div style="font-size:11px;color:var(--t2);margin:8px 0 4px;line-height:1.55">'+_escHtml(idea.asset_name)+'</div>'
    + '<div style="font-size:11px;color:var(--t3);line-height:1.6;margin-bottom:10px;font-style:italic">'+_escHtml(idea.rationale||'')+'</div>'
    + '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px">'
    +   _oppKpi('Entry', entry)
    +   _oppKpi('Target', targetPct, isLong ? '#10B981' : '#EF4444')
    +   _oppKpi('Stop', stopPct, '#EF4444')
    +   _oppKpi('Timeframe', idea.timeframe || '—')
    + '</div>'
    + (catalysts.length ? '<div style="font-size:10px;color:var(--t3);margin-bottom:4px">Catalizzatori: '
        + catalysts.map(function(c){return '<span style="color:#60A5FA">'+_escHtml(c)+'</span>';}).join(' · ')+'</div>' : '')
    + (risks.length ? '<div style="font-size:10px;color:var(--t3)">Rischi: '
        + risks.map(function(r){return '<span style="color:#F87171">'+_escHtml(r)+'</span>';}).join(' · ')+'</div>' : '')
    + (idea.outcome_note ? '<div style="font-size:10px;margin-top:8px;padding-top:8px;border-top:1px solid var(--bd);color:var(--t2)">'+_escHtml(idea.outcome_note)+'</div>' : '')
    + (idea.event_title ? '<div style="font-size:10px;color:var(--t3);margin-top:6px">📰 '+_escHtml(String(idea.event_title||'').slice(0,90))+'</div>' : '')
    + '</div>';
};

// ── FASE 1: Add to Portfolio modal ──────────────────────────────────
var _oppAddIdeaId   = null;
var _oppAddGenPrice = 0;

function oppOpenAddModal(ideaId, ticker, assetName, entryPrice, dirColorHex, dirLabel){
  _oppAddIdeaId   = ideaId;
  _oppAddGenPrice = entryPrice || 0;

  var modal = document.getElementById('opp-add-port-modal');
  var info  = document.getElementById('opp-add-port-info');
  var sel   = document.getElementById('opp-add-port-select');
  var cost  = document.getElementById('opp-add-port-cost');

  if(!modal) return;

  if(info) info.innerHTML =
    '<strong style="color:#'+dirColorHex+'">'+_escHtml(ticker)+'</strong> '+dirLabel+
    ' &mdash; '+_escHtml(assetName)+
    (entryPrice ? '<br>Prezzo entry: <strong>'+parseFloat(entryPrice).toFixed(2)+'</strong>' : '');

  // Populate portfolios
  if(sel){
    sel.innerHTML = '<option value="">Caricamento…</option>';
    rq('/api/finance/portfolios').then(function(ports){
      if(!ports || !Array.isArray(ports)){ sel.innerHTML='<option value="">Nessun portafoglio</option>'; return; }
      sel.innerHTML = ports.map(function(p){
        return '<option value="'+p.id+'">'+_escHtml(p.name||'Portafoglio')+'</option>';
      }).join('');
    });
  }

  // Recalculate cost on shares change
  var sharesEl = document.getElementById('opp-add-port-shares');
  if(sharesEl){
    sharesEl.value = 1;
    sharesEl.oninput = function(){
      if(cost && _oppAddGenPrice){
        var s = parseFloat(this.value)||0;
        cost.textContent = 'Costo stimato: ' + (s * _oppAddGenPrice).toLocaleString('it-IT',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' USD';
      }
    };
    if(cost && entryPrice) cost.textContent = 'Costo stimato: '+parseFloat(entryPrice).toFixed(2)+' USD';
  }

  modal.style.display = 'flex';
}

function oppCloseAddModal(){
  var modal = document.getElementById('opp-add-port-modal');
  if(modal) modal.style.display = 'none';
  _oppAddIdeaId = null;
}

async function oppConfirmAddToPortfolio(){
  if(!_oppAddIdeaId){ toast('Seleziona una trade idea','err'); return; }
  var portId = (document.getElementById('opp-add-port-select')||{}).value;
  var shares = parseFloat((document.getElementById('opp-add-port-shares')||{}).value)||0;
  if(!portId){ toast('Seleziona un portafoglio','err'); return; }
  if(shares <= 0){ toast('Inserisci una quantità valida','err'); return; }

  var btn = document.querySelector('#opp-add-port-modal .btn-p');
  if(btn){ btn.disabled=true; btn.textContent='Aggiunta…'; }

  var r = await rq('/api/opportunity/ideas/'+_oppAddIdeaId+'/add-to-portfolio',{
    method:'POST', body:{ portfolio_id: parseInt(portId), shares: shares }
  });

  if(btn){ btn.disabled=false; btn.textContent='✅ Aggiungi al Portafoglio'; }

  if(r && r.success){
    toast('✅ '+_escHtml(r.ticker||'')+' aggiunto al portafoglio!', 'ok');
    oppCloseAddModal();
  } else {
    toast('Errore: '+(r && r.detail ? r.detail : 'Riprova'), 'err');
  }
}

// ── FASE 4: Track Record tab ─────────────────────────────────────────
async function oppLoadPerformance(){
  var activeEl = document.getElementById('opp-perf-active');
  var closedEl = document.getElementById('opp-perf-closed');
  if(activeEl) activeEl.innerHTML = '<div style="color:var(--t3);font-size:12px">Caricamento…</div>';
  if(closedEl) closedEl.innerHTML = '';

  var data = await rq('/api/opportunity/performance');
  if(!data){ return; }

  var tr = data.track_record || {};
  var as = data.active_summary || {};

  // Fill stats strip
  var hrColor = (tr.hit_rate_pct||0) >= 50 ? '#10B981' : '#EF4444';
  var avgColor = (tr.avg_pnl_pct||0) >= 0 ? '#10B981' : '#EF4444';
  _oppSetTxt('opp-tr-hitrate', (tr.hit_rate_pct||0).toFixed(0)+'%', hrColor);
  _oppSetTxtColor('opp-tr-hitrate', hrColor);
  _oppSetTxt('opp-tr-avgpnl',  (tr.avg_pnl_pct>=0?'+':'')+((tr.avg_pnl_pct||0).toFixed(1))+'%');
  document.getElementById('opp-tr-avgpnl').style.color = avgColor;
  _oppSetTxt('opp-tr-best',  tr.best_pnl_pct  ? '+'+tr.best_pnl_pct.toFixed(1)+'%' : '—');
  _oppSetTxt('opp-tr-worst', tr.worst_pnl_pct !== undefined ? tr.worst_pnl_pct.toFixed(1)+'%' : '—');

  // Active ideas with live P&L
  var active = data.active_ideas || [];
  if(activeEl){
    if(!active.length){
      activeEl.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:10px 0">Nessuna posizione attiva.</div>';
    } else {
      activeEl.innerHTML = active.map(function(idea){ return _oppPerfRow(idea, true); }).join('');
    }
  }

  // Closed history
  var closed = data.closed_ideas || [];
  if(closedEl){
    if(!closed.length){
      closedEl.innerHTML = '<div style="color:var(--t3);font-size:12px;padding:10px 0">Nessun trade chiuso ancora. Le idee vengono monitorate ogni ora.</div>';
    } else {
      closedEl.innerHTML = closed.map(function(idea){ return _oppPerfRow(idea, false); }).join('');
    }
  }
}

function _oppSetTxt(id, val, color){
  var el = document.getElementById(id);
  if(!el) return;
  el.textContent = val;
  if(color) el.style.color = color;
}
function _oppSetTxtColor(id, color){
  var el = document.getElementById(id);
  if(el) el.style.color = color;
}

function _oppPerfRow(idea, isActive){
  var isLong   = idea.direction === 'LONG';
  var dirColor = isLong ? '#10B981' : '#EF4444';
  var pnl      = idea.pnl_pct !== null && idea.pnl_pct !== undefined ? parseFloat(idea.pnl_pct) : null;
  var pnlTxt   = pnl !== null ? ((pnl>=0?'+':'')+pnl.toFixed(2)+'%') : '—';
  var pnlColor = pnl !== null ? (pnl >= 0 ? '#10B981' : '#EF4444') : '#94A3B8';

  var statusIcons = { hit_target:'✅', hit_stop:'🛑', expired:'⏱', active:'⏳' };
  var statusIcon  = statusIcons[idea.status] || '';

  var maxFav = idea.max_favorable_pct;
  var maxFavTxt = (maxFav !== null && maxFav !== undefined)
    ? 'Max: '+(maxFav>=0?'+':'')+parseFloat(maxFav).toFixed(1)+'%'
    : '';

  return '<div class="card" style="border-left:3px solid '+dirColor+';padding:11px 14px">'
    + '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px">'
    +   '<div style="display:flex;align-items:center;gap:8px">'
    +     statusIcon+' '
    +     '<strong style="color:'+dirColor+'">'+_escHtml(idea.ticker)+'</strong>'
    +     '<span style="font-size:10px;color:var(--t3)">'+_escHtml(idea.direction)+'</span>'
    +   '</div>'
    +   '<div style="text-align:right">'
    +     '<div style="font-size:14px;font-weight:800;font-family:var(--fm);color:'+pnlColor+'">'+pnlTxt+'</div>'
    +     (maxFavTxt ? '<div style="font-size:9px;color:var(--t3)">'+maxFavTxt+'</div>' : '')
    +   '</div>'
    + '</div>'
    + (idea.outcome_note ? '<div style="font-size:11px;color:var(--t2);margin-top:6px">'+_escHtml(idea.outcome_note)+'</div>' : '')
    + '<div style="font-size:10px;color:var(--t3);margin-top:4px">'
    +   _escHtml(String(idea.rationale||'').slice(0,80))
    +   (idea.created_at ? ' · '+idea.created_at.slice(0,10) : '')
    + '</div>'
    + (isActive ? '<button onclick="oppOpenAddModal('+(idea.id||0)+',\''+_escHtml(idea.ticker)+
        '\',\''+_escHtml(idea.asset_name||'')+'\','+(idea.price_current||idea.price_at_generation||0)+
        ',\''+(isLong?'10B981':'EF4444')+'\',\''+(isLong?'▲ LONG':'▼ SHORT')+'\')" '+
        'style="margin-top:8px;font-size:10px;padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.04);color:var(--t2);cursor:pointer">+ Portafoglio</button>'
      : '')
    + '</div>';
}


/* ════════════════════════════════════════════════════════════════════
   FASE 2 + 3 — Portfolio Risk Scanner + Opportunity Score
   Loaded automatically when a portfolio is selected.
   ════════════════════════════════════════════════════════════════════ */

async function loadPortfolioAnalysis(pid) {
  var sec = document.getElementById('fh-pa-section');
  if (!sec) return;

  // Show section with loading state
  sec.style.display = 'block';
  _setPA('fh-pa-score',     '…');
  _setPA('fh-pa-conflicts', '…');
  _setPA('fh-pa-aligned',   '…');
  _setPA('fh-pa-summary',   'Analisi in corso…');
  var alertsEl  = document.getElementById('fh-pa-alerts');
  var sigsEl    = document.getElementById('fh-pa-signals');
  if (alertsEl) alertsEl.innerHTML = '';
  if (sigsEl)   sigsEl.innerHTML   = '';

  var data = await rq('/api/opportunity/portfolio-analysis/' + pid);
  if (!data || data._network) { sec.style.display = 'none'; return; }

  // ── Score strip ──────────────────────────────────────────────────
  var score      = data.portfolio_score || 0;
  var conflicts  = (data.risk_alerts || []).filter(function(a){ return a.conflict_type === 'long_vs_short_signal'; }).length;
  var aligned    = (data.holding_signals || []).filter(function(s){ return s.long_signals > 0 && !s.has_conflict; }).length;
  var scoreColor = score >= 65 ? '#10B981' : score >= 40 ? '#F59E0B' : '#94A3B8';

  var scoreCard = document.getElementById('fh-pa-score-card');
  if (scoreCard) {
    scoreCard.className = 'fh-pa-kpi' + (score >= 55 ? ' fh-pa-score-ring' : '');
  }
  var scoreEl = document.getElementById('fh-pa-score');
  if (scoreEl) { scoreEl.textContent = score; scoreEl.style.color = scoreColor; }
  _setPA('fh-pa-conflicts', conflicts);
  _setPA('fh-pa-aligned',   aligned);

  // ── Summary ──────────────────────────────────────────────────────
  var sumEl = document.getElementById('fh-pa-summary');
  if (sumEl) sumEl.textContent = data.summary || '';

  // ── Risk alerts ──────────────────────────────────────────────────
  var alerts = data.risk_alerts || [];
  if (alertsEl) {
    if (!alerts.length) {
      alertsEl.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:4px 0">✅ Nessun conflitto rilevato tra posizioni e segnali attivi.</div>';
    } else {
      alertsEl.innerHTML = alerts.slice(0, 5).map(function(a) {
        var lvlCls = a.risk_level === 'high' ? 'risk-high' : 'risk-medium';
        var icon   = a.risk_level === 'high' ? '🔴' : '⚠';
        return '<div class="fh-pa-alert ' + lvlCls + '">'
          + '<div class="fh-pa-alert-icon">' + icon + '</div>'
          + '<div class="fh-pa-alert-body">'
          +   '<div class="fh-pa-alert-title">' + _escHtml(a.title) + '</div>'
          +   '<div class="fh-pa-alert-detail">' + _escHtml(a.detail) + '</div>'
          +   (a.timeframe ? '<div style="font-size:9px;color:var(--t3);margin-top:3px">Timeframe: ' + _escHtml(a.timeframe) + '</div>' : '')
          + '</div>'
          + '</div>';
      }).join('');
    }
  }

  // ── Per-holding signals ───────────────────────────────────────────
  var sigs = data.holding_signals || [];
  if (sigsEl) {
    if (!sigs.length) {
      sigsEl.innerHTML = '<div style="font-size:11px;color:var(--t3)">Nessun segnale disponibile.</div>';
    } else {
      sigsEl.innerHTML = sigs.map(function(s) {
        var barCol  = s.has_conflict ? '#EF4444' : s.long_signals > 0 ? '#10B981' : '#475569';
        var barPct  = Math.min(100, s.opp_score || 0);
        var rowCls  = s.has_conflict ? 'has-conflict' : s.long_signals > 0 ? 'has-long' : '';
        var dirHtml = '';
        var pnlHtml = '';

        if (s.has_conflict) {
          dirHtml = '<span class="fh-pa-sig-dir" style="background:rgba(239,68,68,.12);color:#F87171">▼ SHORT ⚠</span>';
        } else if (s.long_signals > 0) {
          dirHtml = '<span class="fh-pa-sig-dir" style="background:rgba(16,185,129,.1);color:#10B981">▲ LONG ✓</span>';
        } else {
          dirHtml = '<span class="fh-pa-sig-dir" style="background:rgba(255,255,255,.05);color:var(--t3)">— neutro</span>';
        }

        if (s.pnl_pct !== null && s.pnl_pct !== undefined) {
          var pnl    = parseFloat(s.pnl_pct);
          var pnlCol = pnl >= 0 ? '#10B981' : '#EF4444';
          pnlHtml    = '<div class="fh-pa-sig-pnl" style="color:' + pnlCol + '">'
            + (pnl >= 0 ? '+' : '') + pnl.toFixed(1) + '%</div>';
        }

        return '<div class="fh-pa-signal-row ' + rowCls + '">'
          + '<div class="fh-pa-sig-ticker">' + _escHtml(s.ticker) + '</div>'
          + '<div class="fh-pa-sig-bar-wrap"><div class="fh-pa-sig-bar" style="width:' + barPct + '%;background:' + barCol + '"></div></div>'
          + '<div class="fh-pa-sig-score" style="color:' + barCol + '">' + (s.opp_score || '—') + '</div>'
          + dirHtml
          + pnlHtml
          + '</div>';
      }).join('');
    }
  }
}

function _setPA(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val;
}

/* Hook into selectFHPortfolio to auto-load analysis */
(function() {
  var _origSelect = window.selectFHPortfolio;
  window.selectFHPortfolio = function(pid) {
    if (_origSelect) _origSelect(pid);
    // Load analysis with slight delay so portfolio detail renders first
    setTimeout(function() {
      if (pid) loadPortfolioAnalysis(pid);
    }, 800);
  };
})();


/* ════════════════════════════════════════════════════════════════════
   ADMIN PANEL — enterAdmin / exitAdmin / admNav / adminBtnInject
   ════════════════════════════════════════════════════════════════════ */

function adminBtnInject() {
  // Show admin entry button in profile if user is admin
  if (!window.G || !G.user || !G.user.is_admin) return;

  // Add button to profile header if not already there
  var existing = document.getElementById('admin-entry-btn');
  if (existing) return;

  var btn = document.createElement('button');
  btn.id = 'admin-entry-btn';
  btn.className = 'btn btn-ai btn-sm';
  btn.textContent = '🛡 Admin Panel';
  btn.style.cssText = 'margin-top:4px;font-size:11px;padding:5px 12px';
  btn.onclick = function() { enterAdmin(); };

  // Try to insert near profile edit button
  var target = document.querySelector('.prof-hdr [onclick*="toggleEdit"]')
    || document.querySelector('.prof-hdr')
    || document.querySelector('#view-profile > div');
  if (target) {
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin-top:6px';
    wrap.appendChild(btn);
    target.parentNode && target.parentNode.insertBefore(wrap, target.nextSibling);
  }

  // Also add to mobile more-drawer if present
  var drawer = document.querySelector('#wl-more-drawer .more-drawer-grid');
  if (drawer && !document.getElementById('admin-drawer-item')) {
    var item = document.createElement('div');
    item.id = 'admin-drawer-item';
    item.className = 'more-drawer-item';
    item.innerHTML = '<span style="font-size:20px">🛡</span><span>Admin</span>';
    item.onclick = function() { closeMoreDrawer(); enterAdmin(); };
    drawer.appendChild(item);
  }
}

function enterAdmin() {
  var shell = document.getElementById('admin-shell');
  if (!shell) return;
  shell.classList.add('on');
  admNav('overview', document.querySelector('.adm-nav-btn'));
}

function exitAdmin() {
  var shell = document.getElementById('admin-shell');
  if (shell) shell.classList.remove('on');
}

function admNav(section, btn) {
  // Update active button
  document.querySelectorAll('.adm-nav-btn').forEach(function(b) {
    b.classList.remove('active');
  });
  if (btn) btn.classList.add('active');

  // Show/hide panels
  document.querySelectorAll('.adm-panel').forEach(function(p) {
    p.classList.remove('active');
  });
  var panel = document.getElementById('adm-' + section);
  if (panel) panel.classList.add('active');

  // Load section data
  if (section === 'overview')  loadAdminOverview();
  if (section === 'users')     loadAdminUsers();
  if (section === 'events')    loadAdminEvents();
  if (section === 'invites')   loadAdminInvites();
  if (section === 'activity')  loadAdminActivity();
  if (section === 'ai')        loadAdminAI();
  if (section === 'settings')  loadAdminSettings();
  if (section === 'brain')     loadAdminBrain();
}

function loadAdminOverview() {
  rq('/api/admin/overview').then(function(r) {
    if (!r || r._status >= 400) return;
    var el = function(id) { return document.getElementById(id); };
    if (el('adm-users-count'))  el('adm-users-count').textContent  = r.total_users  || 0;
    if (el('adm-events-count')) el('adm-events-count').textContent = r.total_events || 0;
    if (el('adm-online-count')) el('adm-online-count').textContent = r.online_users || 0;
    if (el('adm-version'))      el('adm-version').textContent      = r.version      || '—';
  });
}

function loadAdminUsers() {
  rq('/api/admin/users').then(function(r) {
    var list = document.getElementById('adm-users-list');
    if (!list || !r || r._status >= 400 || !r.users) return;
    list.innerHTML = r.users.map(function(u) {
      var dt = u.created_at ? String(u.created_at).slice(0,10) : '—';
      return '<tr>'
        + '<td style="padding:6px 8px">' + _esc(u.username) + '</td>'
        + '<td style="padding:6px 8px;color:var(--t3)">' + _esc(u.email) + '</td>'
        + '<td style="padding:6px 8px">' + dt + '</td>'
        + '<td style="padding:6px 8px">' + (u.is_admin ? '👑' : '') + '</td>'
        + '<td style="padding:6px 8px">'
        +   '<button class="btn btn-g btn-sm" onclick="admToggleAdmin(' + u.id + ',' + (u.is_admin?'true':'false') + ')" style="font-size:9px;padding:2px 6px">'
        +   (u.is_admin ? 'Revoke Admin' : 'Make Admin') + '</button>'
        + '</td>'
        + '</tr>';
    }).join('');
  });
}

function admToggleAdmin(uid, isAdmin) {
  if (!confirm((isAdmin ? 'Revoca' : 'Promuovi') + ' admin per utente #' + uid + '?')) return;
  rq('/api/admin/users/' + uid + '/toggle-admin', {method:'POST'})
    .then(function() { loadAdminUsers(); });
}

function loadAdminEvents() {
  rq('/api/admin/events-stats').then(function(r) {
    if (!r || r._status >= 400) return;
    var el = function(id) { return document.getElementById(id); };
    if (el('adm-ev-total'))    el('adm-ev-total').textContent    = r.total    || 0;
    if (el('adm-ev-today'))    el('adm-ev-today').textContent    = r.today    || 0;
    if (el('adm-ev-category')) el('adm-ev-category').innerHTML   =
      Object.entries(r.by_category || {})
        .sort(function(a,b){return b[1]-a[1];})
        .slice(0,8)
        .map(function(e){ return '<div style="display:flex;justify-content:space-between;padding:3px 0;font-size:11px"><span>'+_esc(e[0])+'</span><span style="color:var(--via)">'+e[1]+'</span></div>'; })
        .join('');
  });
}

function loadAdminInvites() {
  rq('/api/auth/invites').then(function(r) {
    var list = document.getElementById('adm-invites-list');
    if (!list || !r || !r.invites) return;
    list.innerHTML = r.invites.length === 0
      ? '<div style="color:var(--t3);font-size:12px;padding:10px 0">Nessun invite.</div>'
      : r.invites.map(function(inv) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
            + '<code style="font-size:11px;color:var(--via)">' + _esc(inv.code) + '</code>'
            + '<span style="font-size:10px;color:var(--t3);flex:1">' + (inv.label||'') + '</span>'
            + '<span style="font-size:10px;color:var(--t3)">' + inv.use_count + '/' + inv.max_uses + '</span>'
            + '<button class="btn btn-g btn-sm" onclick="admDeleteInvite(' + inv.id + ')" style="font-size:9px;padding:1px 6px">✕</button>'
            + '</div>';
        }).join('');
  });
}

function admCreateInvite() {
  var label = (document.getElementById('adm-invite-label')||{}).value || '';
  var maxUses = parseInt((document.getElementById('adm-invite-max')||{}).value || '1');
  rq('/api/auth/invites', {method:'POST', body:{label, max_uses: maxUses}})
    .then(function(r) {
      if (r && r.code) { toast('Invite creato: ' + r.code, 'ok'); loadAdminInvites(); }
    });
}

function admDeleteInvite(id) {
  rq('/api/auth/invites/' + id, {method:'DELETE'}).then(loadAdminInvites);
}

function loadAdminActivity() {
  rq('/api/admin/activity?limit=50').then(function(r) {
    var list = document.getElementById('adm-activity-list');
    if (!list || !r || !r.activity) return;
    list.innerHTML = r.activity.map(function(a) {
      var dt = a.created_at ? String(a.created_at).slice(0,16).replace('T',' ') : '—';
      return '<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04);font-size:11px">'
        + '<span style="color:var(--t3)">' + dt + '</span> '
        + '<span style="color:var(--via)">' + _esc(a.action||'') + '</span> '
        + '<span style="color:var(--t2)">' + _esc(a.detail||'') + '</span>'
        + '</div>';
    }).join('');
  });
}

function loadAdminAI() {
  rq('/api/admin/ai-status').then(function(r) {
    if (!r || r._status >= 400) return;
    var el = function(id){ return document.getElementById(id); };
    if (el('adm-ai-provider'))  el('adm-ai-provider').textContent  = r.provider  || '—';
    if (el('adm-ai-available')) el('adm-ai-available').textContent = r.available ? '✅ Online' : '❌ Offline';
    if (el('adm-ai-calls'))     el('adm-ai-calls').textContent     = r.calls_today || 0;
  });
}

function loadAdminSettings() {}  // Rendered statically in HTML

function loadAdminBrain() {
  rq('/api/brain/stats').then(function(r) {
    if (!r) return;
    var el = function(id){ return document.getElementById(id); };
    if (el('adm-brain-nodes'))   el('adm-brain-nodes').textContent   = r.total_nodes   || 0;
    if (el('adm-brain-entries')) el('adm-brain-entries').textContent = r.total_entries || 0;
  });
}

function promoteAdmin() {
  var emailEl = document.getElementById('adm-promote-email');
  if (!emailEl) return;
  var email = emailEl.value.trim();
  if (!email) { toast('Inserisci email', 'err'); return; }
  rq('/api/admin/promote', {method:'POST', body:{email}})
    .then(function(r) {
      if (r && r.ok) { toast(email + ' promosso admin ✓', 'ok'); emailEl.value=''; }
      else { toast((r&&r.detail)||'Errore', 'err'); }
    });
}
