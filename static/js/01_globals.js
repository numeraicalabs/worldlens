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

