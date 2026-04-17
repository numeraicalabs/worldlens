/**
 * 00_puter_ai.js — Puter.js AI Layer
 * ─────────────────────────────────────────────────────────────
 * Intercepts ALL AI calls in WorldLens and routes them through
 * puter.ai.chat() — completely free, no API key required.
 *
 * Architecture:
 *   Frontend triggers AI → this module calls puter.ai.chat()
 *   Backend returns structured data; AI text generated here.
 *
 * Intercepts:
 *   1. rq('/api/events/ai/ask')           → panelAI, aiSend, portfolio
 *   2. rq('/api/intelligence/answer')      → AI Analyst chat
 *   3. rq('/api/intelligence/macro-brief') → Macro briefing
 *   4. rq('/api/intelligence/watchlist-digest') → Watchlist digest
 *   5. rq('/api/agents/ask/{id}')          → Agent Q&A
 *   6. rq('/api/agents/brief/{id}')        → Agent daily brief (augment)
 *   7. Early Warning AI assessment         → loadEarlyWarning augment
 *   8. Supply Chain AI summary             → loadSupplyChain augment
 *   9. Event panel AI analysis             → panelAI
 */

(function () {
'use strict';

/* ── Wait for puter.js to load ─────────────────────────────────
   puter.js is loaded from CDN before this script.
   We expose a unified wrapper that degrades gracefully.        */

var PA = window.PA = {};   // Public API for other modules

PA.ready = false;
PA.queue = [];

/* Check puter availability */
function _puterAvailable() {
  return typeof window.puter !== 'undefined'
      && typeof window.puter.ai !== 'undefined'
      && typeof window.puter.ai.chat === 'function';
}

/* ── Core call wrapper ─────────────────────────────────────────
   Returns Promise<string>. Never throws — returns fallback.   */
PA.call = async function(prompt, opts) {
  opts = opts || {};
  if (!_puterAvailable()) {
    return opts.fallback || 'AI non disponibile. Ricarica la pagina.';
  }
  try {
    var result = await window.puter.ai.chat(prompt, { model: opts.model || 'gpt-4o-mini' });
    // puter.ai.chat returns either a string or an object with .message.content
    if (typeof result === 'string') return result.trim();
    if (result && result.message && result.message.content) return result.message.content.trim();
    if (result && result.text) return result.text.trim();
    return String(result || '').trim() || (opts.fallback || '');
  } catch (e) {
    console.warn('[PA] puter.ai.chat error:', e && e.message || e);
    return opts.fallback || 'Risposta AI non disponibile.';
  }
};

/* ── Intercept rq() for AI endpoints ──────────────────────────
   We patch rq() to intercept specific AI API paths and call
   puter instead. Non-AI paths pass through unchanged.         */

var _originalRq = null;

var AI_INTERCEPTS = {

  /* ── 1. Generic AI ask (events panel, portfolio, etc.) */
  '/api/events/ai/ask': async function(payload) {
    var q   = payload.question || payload.prompt || '';
    var ctx = payload.context  || '';
    var prompt = ctx
      ? 'Context:\n' + ctx + '\n\nQuestion: ' + q
      : q;
    var answer = await PA.call(prompt, {
      fallback: 'Analisi non disponibile — riprova tra un momento.'
    });
    return { answer: answer };
  },

  /* ── 2. AI Analyst chat */
  '/api/intelligence/answer': async function(payload) {
    var q   = payload.question || '';
    var ctx = payload.context  || '';
    var prompt = 'Sei un analista di intelligence geopolitica senior per WorldLens.\n'
      + (ctx ? 'Contesto: ' + ctx + '\n' : '')
      + 'Domanda: ' + q + '\n\n'
      + 'Rispondi in modo diretto e specifico, massimo 3 paragrafi. '
      + 'Cita dati concreti dove possibile. Lingua: usa la stessa lingua della domanda.';
    var answer = await PA.call(prompt, {
      fallback: 'Risposta non disponibile. Riprova.'
    });
    return { answer: answer, response: answer };
  },

  /* ── 3. Macro brief */
  '/api/intelligence/macro-brief': async function(_payload, cachedData) {
    /* cachedData = backend response with indicators[] and events[] */
    var inds = (cachedData && cachedData.indicators) || [];
    var evs  = (cachedData && cachedData.recent_events) || [];
    var indTxt = inds.slice(0,8).map(function(i){
      return i.name + ': ' + i.value + ' ' + (i.unit||'');
    }).join(', ');
    var evTxt = evs.slice(0,6).map(function(e){
      return e.title + ' [' + e.category + ']';
    }).join('; ');
    var prompt = 'Sei un economista macro senior. Scrivi un briefing di 3 paragrafi '
      + 'sullo stato attuale dei mercati globali basandoti su questi dati.\n\n'
      + (indTxt ? 'Indicatori macro: ' + indTxt + '\n' : '')
      + (evTxt  ? 'Ultimi eventi: '    + evTxt  + '\n' : '')
      + '\nBriefing (italiano, diretto, con implicazioni per investitori):';
    var brief = await PA.call(prompt, { fallback: 'Briefing macro non disponibile.' });
    if (cachedData) { cachedData.brief = brief; cachedData.content = brief; }
    return Object.assign({}, cachedData || {}, { brief: brief, content: brief });
  },

  /* ── 4. Watchlist digest */
  '/api/intelligence/watchlist-digest': async function(_payload, cachedData) {
    var items = (cachedData && cachedData.items) || [];
    var evs   = (cachedData && cachedData.events) || [];
    if (!items.length && !evs.length) {
      return cachedData || { digest: 'Aggiungi asset alla watchlist per ricevere il digest.' };
    }
    var assetTxt = items.slice(0,6).map(function(i){ return i.symbol || i.name; }).join(', ');
    var evTxt    = evs.slice(0,5).map(function(e){ return e.title; }).join('; ');
    var prompt = 'Sei un analista di portfolio. Scrivi un digest giornaliero conciso (2 paragrafi) '
      + 'per questi asset e i relativi eventi di mercato.\n'
      + (assetTxt ? 'Asset in watchlist: ' + assetTxt + '\n' : '')
      + (evTxt    ? 'Eventi rilevanti: '   + evTxt    + '\n' : '')
      + '\nDigest (italiano, orientato a decision making):';
    var digest = await PA.call(prompt, { fallback: 'Digest non disponibile.' });
    return Object.assign({}, cachedData || {}, { digest: digest, content: digest });
  },
};

/* Agent-specific intercepts (dynamic path) */
PA.interceptAgentAsk = async function(bid, payload, cachedData) {
  var AGENT_PERSONAS = {
    finance:     'Sei un analista finanziario quantitativo specializzato in macro e mercati globali.',
    geopolitics: 'Sei un analista geopolitico con expertise in sicurezza internazionale e relazioni di potere.',
    science:     'Sei un analista di rischio tecnologico e scientifico con focus su AI, biotech e clima.',
    technology:  'Sei un analista di trasformazione digitale e rischi da disruption tecnologica.',
  };
  var persona = AGENT_PERSONAS[bid] || 'Sei un analista di intelligence globale.';
  var q   = (payload && payload.question) || '';
  var ctx = (cachedData && cachedData.context) || '';
  var prompt = persona + '\n'
    + (ctx ? 'Contesto recente: ' + ctx + '\n' : '')
    + 'Domanda: ' + q + '\n\n'
    + 'Rispondi in modo preciso, citando dati concreti. Massimo 200 parole. '
    + 'Lingua: usa la stessa lingua della domanda.';
  var answer = await PA.call(prompt, { fallback: 'Risposta agente non disponibile.' });
  return { answer: answer };
};

PA.enrichAgentBrief = async function(bid, briefData) {
  if (!briefData || briefData.ai_summary) return briefData;  // already has AI
  var AGENT_FOCUS = {
    finance:     'sviluppi finanziari, movimenti di mercato, rischi macro',
    geopolitics: 'tensioni geopolitiche, conflitti, stabilità regionale',
    science:     'breakthrough scientifici, rischi tecnologici, scoperte',
    technology:  'innovazioni tech, disruption digitale, AI e cybersecurity',
  };
  var focus = AGENT_FOCUS[bid] || 'intelligence globale';
  var evs = (briefData.recent_events || briefData.events || []).slice(0,5);
  if (!evs.length) return briefData;
  var evTxt = evs.map(function(e){ return '- ' + e.title; }).join('\n');
  var prompt = 'Sei un analista specializzato in ' + focus + '.\n'
    + 'Ultimi eventi rilevanti:\n' + evTxt + '\n\n'
    + 'Scrivi un briefing di 2 paragrafi per oggi, identificando il trend principale '
    + 'e il rischio/opportunità più importante. Max 150 parole. Lingua italiana.';
  var summary = await PA.call(prompt, { fallback: '' });
  if (summary) briefData.ai_summary = summary;
  return briefData;
};

PA.enrichEarlyWarning = async function(ewData) {
  if (!ewData) return ewData;
  if (ewData.ai_assessment && ewData.ai_assessment.length > 80) return ewData; // backend did it
  var score  = ewData.global_ew_score || 5;
  var risks  = (ewData.top_risks || []).slice(0,4).map(function(r){
    return r.label + ' (' + r.score + '/10)';
  }).join(', ');
  var prompt = 'Sei un analista di rischio geopolitico senior.\n'
    + 'EW Score globale: ' + score + '/10\n'
    + (risks ? 'Pattern di crisi rilevati: ' + risks + '\n' : '')
    + 'Macro stress: ' + (ewData.macro_stress||5) + '/10, '
    + 'Market stress: ' + (ewData.market_stress||5) + '/10, '
    + 'Event velocity: ' + (ewData.event_velocity||1) + 'x\n\n'
    + 'Scrivi una valutazione strutturata in 4 parti:\n'
    + '1. LIVELLO DI MINACCIA ATTUALE — una frase sul perché il score è ' + score + '/10\n'
    + '2. RISCHIO DI ESCALATION PRIMARIO — lo scenario più probabile da monitorare nei prossimi 7-14 giorni\n'
    + '3. EFFETTI SECONDARI — un\'interconnessione che il mercato potrebbe sottovalutare\n'
    + '4. SEGNALI DA MONITORARE — due indicatori specifici e osservabili\n\n'
    + 'Scrivi in italiano, prosa continua senza headers. Max 200 parole.';
  var assessment = await PA.call(prompt, { fallback: '' });
  if (assessment) ewData.ai_assessment = assessment;
  return ewData;
};

PA.enrichSupplyChain = async function(scData) {
  if (!scData) return scData;
  if (scData.ai_summary && scData.ai_summary.length > 60) return scData;
  var disruptions = (scData.disruptions || []).slice(0,4).map(function(d){
    return d.node_name + ': ' + d.type.replace('_',' ') + ' (rischio ' + d.risk_score + '/10)';
  }).join('; ');
  var stress = scData.global_sc_stress || 5;
  var prompt = 'Sei un analista di supply chain globale.\n'
    + 'Stress globale supply chain: ' + stress + '/10\n'
    + (disruptions ? 'Disruzioni attive: ' + disruptions + '\n' : '')
    + '\nScrivi un briefing di 2 paragrafi: impatto attuale sulle catene di fornitura '
    + 'globali e raccomandazione operativa per risk manager. Max 120 parole. Italiano.';
  var summary = await PA.call(prompt, { fallback: '' });
  if (summary) scData.ai_summary = summary;
  return scData;
};

/* ── rq() patch ─────────────────────────────────────────────── */
function _patchRq() {
  if (typeof window.rq !== 'function') {
    setTimeout(_patchRq, 150);
    return;
  }
  _originalRq = window.rq;

  window.rq = async function(url, opts) {
    opts = opts || {};

    /* ── Static intercepts */
    if (AI_INTERCEPTS[url] && opts.method === 'POST') {
      var payload = opts.body || {};

      /* For macro-brief and digest, still call backend for structured data,
         then augment with puter AI text */
      if (url === '/api/intelligence/macro-brief' || url === '/api/intelligence/watchlist-digest') {
        try {
          var backendData = await _originalRq(url, opts);
          return await AI_INTERCEPTS[url](payload, backendData || {});
        } catch(e) {
          return await AI_INTERCEPTS[url](payload, {});
        }
      }

      /* For pure AI-text endpoints, skip backend entirely */
      return await AI_INTERCEPTS[url](payload);
    }

    /* ── Dynamic intercepts: /api/agents/ask/{id} */
    var agentAskMatch = url.match(/^\/api\/agents\/ask\/(\w+)$/);
    if (agentAskMatch && opts.method === 'POST') {
      return await PA.interceptAgentAsk(agentAskMatch[1], opts.body || {}, null);
    }

    /* ── Pass through to original rq for everything else */
    return _originalRq(url, opts);
  };

  PA.ready = true;
  console.log('[PA] puter.ai interceptor active —', _puterAvailable() ? 'puter.js ready' : 'puter.js not loaded yet (will retry)');
}

/* ── Patch loadEarlyWarning to enrich with puter AI ─────────── */
function _patchEarlyWarning() {
  var _check = setInterval(function() {
    if (typeof window.loadEarlyWarning !== 'function') return;
    clearInterval(_check);
    var _orig = window.loadEarlyWarning;
    window.loadEarlyWarning = function(force) {
      // Call original (which calls backend for structured data)
      // Then augment the AI assessment via puter
      var origPromise = _orig(force);

      // After a short delay (let backend call finish), enrich AI text
      setTimeout(function() {
        var assessEl = document.getElementById('ew-assess');
        var scoreEl  = document.getElementById('ew-score');
        if (!assessEl || !scoreEl) return;
        var currentText = assessEl.textContent || '';
        // Only call puter if assessment is short/generic
        if (currentText.length > 100 && !currentText.includes('Configure')) return;

        var score = parseFloat(scoreEl.textContent) || 5;
        var gaugeVals = {};
        ['macro','market','sent','vel'].forEach(function(k) {
          var el = document.getElementById('ewg-' + k);
          gaugeVals[k] = el ? parseFloat(el.textContent) || 0 : 0;
        });

        var mockEw = {
          global_ew_score: score,
          macro_stress:    gaugeVals.macro,
          market_stress:   gaugeVals.market,
          event_velocity:  gaugeVals.vel || 1,
          ai_assessment:   '',
          top_risks:       [],
        };
        // Collect pattern cards if available
        var patternCards = document.querySelectorAll('.pattern-card .pattern-label');
        var patternScores = document.querySelectorAll('.pattern-card .pattern-score');
        patternCards.forEach(function(el, i) {
          var sc = patternScores[i] ? parseFloat(patternScores[i].textContent) || 0 : 0;
          mockEw.top_risks.push({ label: el.textContent, score: sc });
        });

        assessEl.innerHTML = '<span class="aiload"><span class="ald"></span><span class="ald"></span><span class="ald"></span> AI analysis...</span>';
        PA.enrichEarlyWarning(mockEw).then(function(enriched) {
          if (enriched && enriched.ai_assessment) {
            var sentences = enriched.ai_assessment.split(/(?<=[.!?])\s+/);
            assessEl.innerHTML = sentences.map(function(s, i) {
              return '<p style="margin:0 0 6px;' + (i===0?'font-weight:600;color:var(--t1)':'color:var(--t2)') + '">' + s + '</p>';
            }).join('');
          } else {
            assessEl.textContent = 'Analisi AI non disponibile.';
          }
        });
      }, 1200);

      return origPromise;
    };
  }, 300);
}

/* ── Patch loadSupplyChain to enrich with puter AI ──────────── */
function _patchSupplyChain() {
  var _check = setInterval(function() {
    if (typeof window.loadSupplyChain !== 'function') return;
    clearInterval(_check);
    var _orig = window.loadSupplyChain;
    window.loadSupplyChain = async function() {
      await _orig();
      // Enrich AI brief
      var briefEl = document.getElementById('sc-brief');
      if (!briefEl || (briefEl.textContent && briefEl.textContent.length > 80)) return;
      var stressEl = document.getElementById('sc-stress');
      var stress   = stressEl ? parseFloat(stressEl.textContent) || 5 : 5;
      var disrupts = [];
      document.querySelectorAll('.sc-disruption').forEach(function(el) {
        var nameEl = el.querySelector('.sc-disruption-name');
        if (nameEl) disrupts.push({ node_name: nameEl.textContent, type: 'DISRUPTION', risk_score: stress });
      });
      briefEl.innerHTML = '<span class="aiload"><span class="ald"></span><span class="ald"></span><span class="ald"></span></span>';
      var mockSc = { global_sc_stress: stress, disruptions: disrupts, ai_summary: '' };
      PA.enrichSupplyChain(mockSc).then(function(enriched) {
        briefEl.textContent = (enriched && enriched.ai_summary) || 'Analisi supply chain non disponibile.';
      });
    };
  }, 300);
}

/* ── Patch loadOneBrief (agents) to enrich with puter ──────── */
function _patchAgentBrief() {
  var _check = setInterval(function() {
    if (typeof window.loadOneBrief !== 'function') return;
    clearInterval(_check);
    var _orig = window.loadOneBrief;
    window.loadOneBrief = function(bid) {
      // Call original (gets structured data), then enrich brief text
      _orig(bid);
      setTimeout(function() {
        // Find brief text element in agent card
        var briefEl = document.querySelector('#agent-card-' + bid + ' .ag-brief-text, #agent-card-' + bid + ' [class*="brief"]');
        if (!briefEl) return;
        var currentText = (briefEl.textContent || '').trim();
        if (currentText.length > 100 && !currentText.includes('Configure') && !currentText.includes('not available')) return;

        // Build context from visible events
        var eventEls = document.querySelectorAll('#agent-card-' + bid + ' .ag-ev-title, #agent-card-' + bid + ' .ag-event');
        var events = [];
        eventEls.forEach(function(el) { events.push({ title: el.textContent.trim() }); });
        if (!events.length) return;

        briefEl.innerHTML = '<span class="aiload"><span class="ald"></span><span class="ald"></span><span class="ald"></span></span>';
        var mockBrief = { recent_events: events, events: events };
        PA.enrichAgentBrief(bid, mockBrief).then(function(enriched) {
          briefEl.textContent = (enriched && enriched.ai_summary) || 'Brief non disponibile.';
        });
      }, 800);
    };
  }, 400);
}

/* ── Boot sequence ─────────────────────────────────────────── */
_patchRq();
_patchEarlyWarning();
_patchSupplyChain();
_patchAgentBrief();

/* Expose PA globally for manual calls */
window.PA = PA;

})();
