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
  var ans = el('panelans');
  ans.classList.add('on');
  ans.innerHTML = '<span class="aiload"><span class="ald"></span><span class="ald"></span><span class="ald"></span> Analyzing...</span>';
  var ctx = 'Event: '+ev.title+'\nRegion: '+(ev.country_name||ev.country_code)+'\nCategory: '+ev.category+'\nImpact: '+ev.impact+'\nSeverity: '+ev.severity+'\nSummary: '+(ev.summary||'N/A');
  rq('/api/events/ai/ask',{method:'POST',body:{question:prompt,context:ctx}}).then(function(r) {
    ans.textContent = (r&&r.answer)?r.answer:'AI not available — configure a provider in Admin → Settings.';
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
      if (body) body.innerHTML = '<div style="padding:20px;color:var(--t3)">Impact analysis not available. Configure an AI provider in Admin → Settings.</div>';
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
      ans.textContent = 'AI not available — configure a provider in Admin → Settings.';
    }
  });
}
function watchEv() {
  var ev = G.panelEv; if (!ev) return;
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
  if (el2) el2.classList.add('on');
  if (btn) btn.classList.add('on');
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
  if (name==='macro') { renderMacro(); loadRegionRisks(); rq('/api/portfolio/track',{method:'POST',body:{action:'macro_visit'}}); }
  if (name==='portfolio') loadPortfolios();
}

// ── CAT FILTERS INIT ──────────────────────────────────
function initCats() {
  var mc = el('mcats'), fc = el('feedcats');
  Object.keys(CATS).forEach(function(cat) {
    var m = CATS[cat];
    var p = document.createElement('div');
    p.className='cpill on'; p.dataset.c=cat; p.title=cat;
    p.style.color=m.c; p.style.borderColor=m.c+'55';
    p.innerHTML = m.i;
    p.onclick = function(){ p.classList.toggle('on'); updateMarkers(); };
    mc.appendChild(p);
    var fc2 = document.createElement('div');
    fc2.className='fc'; fc2.dataset.cat=cat; fc2.innerHTML=m.i+' '+cat;
    fc2.onclick = function(){ sf('cat',G.filt.cat===cat?null:cat,fc2); };
    fc.appendChild(fc2);
  });
}

// ── DASHBOARD ─────────────────────────────────────────
function updateRiskUI() {
  var r = G.stats.global_risk_index||0;
  var rc = r>60?'#EF4444':r>35?'#F59E0B':'#60A5FA';
  setEl('m-risk', r.toFixed(0)); el('m-risk').style.color=rc;
  el('m-riskb').style.width=Math.min(100,r)+'%'; el('m-riskb').style.background=rc;
  setEl('m-riskl', r>60?'CRITICAL':r>35?'ELEVATED':'STABLE'); el('m-riskl').style.color=rc;
}
function renderDash() {
  var st   = G.stats || {};
  var risk = st.global_risk_index || 0;
  var rc   = risk>60?'var(--re)':risk>35?'var(--am)':'var(--gr)';

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
  setEl('d-risk-l', risk>60?'Critical — High Alert':risk>35?'Elevated — Monitor':'Stable');

  // KPI: Events
  setEl('d-ev', st.last_24h||'—');
  var hiEl = el('d-hi');
  if (hiEl) { hiEl.textContent = (st.high_impact_24h||0)+' critical'; hiEl.style.color='var(--re)'; }

  updateRiskUI();

  // Personalized event list
  var p   = G.userProfile||{};
  var evs = ((p.onboarding_done&&((p.interests||[]).length+(p.regions||[]).length>0))
    ? getPersonalizedEvents() : G.events)
    .slice().sort(function(a,b){ return b.severity-a.severity; });

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
}
function getPersonalizedEvents() {
  var p = G.userProfile||{};
  var regions = p.regions||[], interests = p.interests||[];
  var regionCodes = {
    'Europe':['DE','FR','GB','IT','ES','PL','UA','RU','SE','NO','NL','CH'],
    'USA':['US','CA'], 'Middle East':['SA','IR','IL','IQ','SY','AE','JO','LB'],
    'Asia':['CN','JP','IN','KR','ID','TH','VN','MY','AU'],
    'Africa':['NG','ZA','EG','KE','ET','MA'],'Latin America':['BR','MX','AR','CO','CL']
  };
  var activeCodes = {};
  regions.forEach(function(r){ (regionCodes[r]||[]).forEach(function(c){activeCodes[c]=true;}); });
  var catMap = {geopolitics:['GEOPOLITICS','POLITICS'],finance:['FINANCE','ECONOMICS'],macro:['ECONOMICS'],technology:['TECHNOLOGY'],energy:['ENERGY'],security:['SECURITY','CONFLICT'],humanitarian:['HUMANITARIAN'],trade:['ECONOMICS']};
  var activeCats = {};
  interests.forEach(function(id){(catMap[id]||[]).forEach(function(c){activeCats[c]=true;});});
  return G.events.filter(function(e){
    return activeCodes[e.country_code] || activeCats[e.category];
  });
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
  el('fmain').innerHTML = html||'<div style="color:var(--t3);text-align:center;margin-top:36px">No events match filters</div>';
  // Delegated click for cards (not buttons)
  el('fmain').querySelectorAll('.evcard[data-eid]').forEach(function(card) {
    card.addEventListener('click', function(e) {
      if (e.target.closest('.impact-btn')) return;
      goEv(this.dataset.eid);
    });
  });
}
function goEv(id) { sv('map',document.querySelector('[data-v=map]')); setTimeout(function(){openEP(id);},500); }

