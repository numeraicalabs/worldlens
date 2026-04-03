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
      ans.textContent = 'AI not available — configure a provider in Admin → Settings.';
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
  if (el2) el2.classList.add('on');
  if (btn) btn.classList.add('on');
  G.currentView = name;
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
  if (name==='markets') track('markets_opened', 'markets', '');
  if (name==='insiders') track('insiders_opened', 'insiders', '');
  if (name==='ai') track('ai_opened', 'ai', '');
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
