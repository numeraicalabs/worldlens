/**
 * 26_features.js — Feature Engineering Lab UI
 * Composite signal dashboard, indicator charts, regime display, cross-asset panel.
 */
(function() {
'use strict';

var FE = {
  symbol:   'SPY',
  period:   '3mo',
  result:   null,
  multi:    null,
  running:  false,
  chartMode: 'composite',  // 'composite'|'rsi'|'stoch'|'adx'|'obv'|'vol'
};

var REGIME_META = {
  trend_up:   { icon:'📈', color:'#10b981', label:'Trending Up',   desc:'Momentum strategies favoured' },
  trend_down: { icon:'📉', color:'#ef4444', label:'Trending Down', desc:'Short or hedge positions' },
  range:      { icon:'↔',  color:'#f59e0b', label:'Range-Bound',  desc:'Mean-reversion strategies' },
  volatile:   { icon:'⚡', color:'#f97316', label:'High Volatility', desc:'Reduce position size' },
  unknown:    { icon:'❓', color:'#94a3b8', label:'Unknown',        desc:'Insufficient data' },
};

var ACTION_META = {
  BUY:  { color:'#10b981', bg:'rgba(16,185,129,.12)',  icon:'▲' },
  SELL: { color:'#ef4444', bg:'rgba(239,68,68,.12)',   icon:'▼' },
  HOLD: { color:'#f59e0b', bg:'rgba(245,158,11,.12)',  icon:'●' },
};

/* ── Boot ── */
window.initFeatureLab = function() {
  var root = document.getElementById('fe-lab-root');
  if (!root) return;
  _renderFeatureLab(root);
};

function _renderFeatureLab(root) {
  root.innerHTML = [
    '<div class="fel-header">',
    '  <div>',
    '    <div class="fel-title">🔬 Feature Engineering Lab</div>',
    '    <div class="fel-sub">Quantitative signals · Regime detection · Cross-asset intelligence · Sentiment overlay</div>',
    '  </div>',
    '  <div class="fel-badges">',
    '    <div class="fel-badge" style="background:rgba(139,92,246,.1);color:#a78bfa;border-color:rgba(139,92,246,.2)">🧠 Multi-Factor</div>',
    '    <div class="fel-badge" style="background:rgba(16,185,129,.1);color:#10b981;border-color:rgba(16,185,129,.2)">📡 Live</div>',
    '  </div>',
    '</div>',

    /* ── Controls ── */
    '<div class="fel-controls">',
    '  <div class="fel-ctrl-row">',
    '    <div class="fel-ctrl-group">',
    '      <label class="fel-label">Asset</label>',
    '      <input id="fe-symbol" class="fel-input" value="SPY" placeholder="SPY, BTC-USD…">',
    '    </div>',
    '    <div class="fel-ctrl-group">',
    '      <label class="fel-label">Period</label>',
    '      <div class="fel-period-row">',
    '        <button class="fel-period-btn on" onclick="feSetPeriod(\'3mo\',this)">3M</button>',
    '        <button class="fel-period-btn"    onclick="feSetPeriod(\'6mo\',this)">6M</button>',
    '        <button class="fel-period-btn"    onclick="feSetPeriod(\'1y\', this)">1Y</button>',
    '        <button class="fel-period-btn"    onclick="feSetPeriod(\'2y\', this)">2Y</button>',
    '      </div>',
    '    </div>',
    '    <button class="fel-run-btn" id="fe-run-btn" onclick="feAnalyse()">▶ Analyse</button>',
    '  </div>',

    /* Quick symbols */
    '  <div class="fel-quick-row">',
    '    <span class="fel-quick-label">Quick:</span>',
    ['SPY','BTC-USD','NVDA','AAPL','GC=F','QQQ','ETH-USD','TSLA'].map(function(s) {
      return '<button class="fel-quick-btn" onclick="feQuick(\'' + s + '\')">' + s + '</button>';
    }).join(''),
    '  </div>',
    '</div>',

    /* ── Multi-asset scanner ── */
    '<div class="fel-section">',
    '  <div class="fel-section-header">',
    '    <div class="fel-section-title">📊 Multi-Asset Signal Scanner</div>',
    '    <button class="fel-refresh-btn" onclick="feMultiScan()">↻ Scan All</button>',
    '  </div>',
    '  <div class="fel-scanner-grid" id="fe-scanner-grid">',
    '    <div class="fel-scanner-empty">Click "Scan All" to analyse multiple assets simultaneously</div>',
    '  </div>',
    '</div>',

    /* ── Main results ── */
    '<div id="fe-results" style="display:none">',

    /* Composite score hero */
    '  <div class="fel-composite-hero" id="fe-composite-hero"></div>',

    /* Regime card */
    '  <div class="fel-regime-card" id="fe-regime-card"></div>',

    /* Component breakdown */
    '  <div class="fel-section">',
    '    <div class="fel-section-title">⚙️ Signal Components</div>',
    '    <div class="fel-components-grid" id="fe-components-grid"></div>',
    '  </div>',

    /* Cross-asset panel */
    '  <div class="fel-section">',
    '    <div class="fel-section-header">',
    '      <div class="fel-section-title">🌍 Cross-Asset Context</div>',
    '      <button class="fel-refresh-btn" onclick="feLoadCrossAsset()">↻ Refresh</button>',
    '    </div>',
    '    <div id="fe-cross-asset-body"></div>',
    '  </div>',

    /* Indicator chart */
    '  <div class="fel-section">',
    '    <div class="fel-section-header">',
    '      <div class="fel-section-title">📈 Indicator Charts</div>',
    '      <div class="fel-chart-tabs" id="fe-chart-tabs">',
    '        <button class="fel-chart-tab on" onclick="feChartTab(\'rsi\',this)">RSI</button>',
    '        <button class="fel-chart-tab"    onclick="feChartTab(\'stoch\',this)">Stoch</button>',
    '        <button class="fel-chart-tab"    onclick="feChartTab(\'adx\',this)">ADX</button>',
    '        <button class="fel-chart-tab"    onclick="feChartTab(\'obv\',this)">OBV</button>',
    '        <button class="fel-chart-tab"    onclick="feChartTab(\'vol\',this)">Vol</button>',
    '      </div>',
    '    </div>',
    '    <canvas id="fe-indicator-chart" style="width:100%;height:200px"></canvas>',
    '  </div>',

    /* Feature table */
    '  <div class="fel-section">',
    '    <div class="fel-section-title">🔢 Raw Feature Values</div>',
    '    <div id="fe-feature-table"></div>',
    '  </div>',

    '</div>', /* /fe-results */

    /* Loading overlay */
    '<div class="fel-loading" id="fe-loading" style="display:none">',
    '  <div class="btl-spinner"></div>',
    '  <div style="font-family:var(--fh);font-size:14px;font-weight:700;color:var(--t1)">Computing features…</div>',
    '  <div style="font-size:11px;color:var(--t3)">Fetching data · Running 8 indicator families · Cross-asset overlay</div>',
    '</div>',
  ].join('');

  // Load cross-asset on init
  feLoadCrossAsset();
}

/* ── Public API ── */
window.feSetPeriod = function(p, btn) {
  FE.period = p;
  document.querySelectorAll('.fel-period-btn').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
};

window.feQuick = function(sym) {
  FE.symbol = sym;
  var inp = document.getElementById('fe-symbol');
  if (inp) inp.value = sym;
  feAnalyse();
};

window.feAnalyse = function() {
  if (FE.running) return;
  var inp = document.getElementById('fe-symbol');
  FE.symbol = ((inp && inp.value) || 'SPY').trim().toUpperCase();
  FE.running = true;

  var lo = document.getElementById('fe-loading');
  if (lo) lo.style.display = 'flex';
  var btn = document.getElementById('fe-run-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Analysing…'; }

  rq('/api/tradgentic/features/analyse', {
    method: 'POST',
    body: { symbol: FE.symbol, period: FE.period }
  }).then(function(r) {
    FE.running = false;
    if (lo) lo.style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = '▶ Analyse'; }
    if (!r || r.error) { _feError(r && r.error); return; }
    FE.result = r;
    _renderResults(r);
    // Also load raw indicators for charts
    _loadIndicatorChart(FE.symbol, FE.period);
  }).catch(function() {
    FE.running = false;
    if (lo) lo.style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = '▶ Analyse'; }
  });
};

window.feMultiScan = function() {
  var grid = document.getElementById('fe-scanner-grid');
  if (grid) grid.innerHTML = '<div class="fel-scanner-empty" style="color:var(--b4)">⏳ Scanning 8 assets…</div>';

  rq('/api/tradgentic/features/multi', {
    method: 'POST',
    body: { symbols: ['SPY','BTC-USD','NVDA','AAPL','GC=F','QQQ','ETH-USD','GC=F'], period: '3mo' }
  }).then(function(r) {
    if (!r || r.error || !r.results) {
      if (grid) grid.innerHTML = '<div class="fel-scanner-empty">Scan failed</div>';
      return;
    }
    FE.multi = r;
    _renderScannerGrid(r.results);
  });
};

window.feChartTab = function(mode, btn) {
  FE.chartMode = mode;
  document.querySelectorAll('.fel-chart-tab').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  if (FE._indicators) _drawIndicatorChart(FE._indicators, mode);
};

window.feLoadCrossAsset = function() {
  rq('/api/tradgentic/features/cross-asset').then(function(r) {
    if (!r || r.error) return;
    _renderCrossAsset(r.features || {});
  });
};

/* ── Render ── */
function _renderResults(r) {
  var res = document.getElementById('fe-results');
  if (res) res.style.display = '';

  _renderCompositeHero(r);
  _renderRegimeCard(r);
  _renderComponents(r.components || []);
  _renderFeatureTable(r.features || {});
  if (r.features) _renderCrossAsset(r.features);
}

function _renderCompositeHero(r) {
  var el    = document.getElementById('fe-composite-hero');
  if (!el) return;
  var c     = r.composite || 0;
  var act   = r.action || 'HOLD';
  var am    = ACTION_META[act] || ACTION_META.HOLD;
  var pct   = ((c + 1) / 2 * 100).toFixed(0);  // -1→+1 mapped to 0→100%
  var conf  = Math.round((r.confidence || 0) * 100);
  var bars  = Math.round(Math.abs(c) * 20);

  el.innerHTML = [
    '<div class="fel-hero-left">',
    '  <div class="fel-action-badge" style="background:' + am.bg + ';color:' + am.color + ';border-color:' + am.color + '33">',
    '    ' + am.icon + ' ' + act,
    '  </div>',
    '  <div class="fel-composite-val" style="color:' + am.color + '">' + (c >= 0?'+':'') + c + '</div>',
    '  <div class="fel-composite-sub">Composite Score · ' + conf + '% confidence</div>',
    '  <div class="fel-sym-price">' + r.symbol + ' · $' + (r.price || '—') + '</div>',
    '</div>',
    '<div class="fel-hero-right">',
    '  <div class="fel-composite-bar-wrap">',
    '    <div class="fel-composite-bar-track">',
    '      <div class="fel-composite-bar-fill" style="width:' + pct + '%;background:' + am.color + '"></div>',
    '      <div class="fel-composite-bar-center"></div>',
    '    </div>',
    '    <div class="fel-composite-bar-labels"><span>SELL</span><span>HOLD</span><span>BUY</span></div>',
    '  </div>',
    '  <div class="fel-strength-dots">',
    Array(20).fill(0).map(function(_,i) {
      var filled = i < bars;
      var col    = c >= 0 ? '#10b981' : '#ef4444';
      return '<div class="fel-dot" style="background:' + (filled ? col : 'rgba(255,255,255,.08)') + '"></div>';
    }).join(''),
    '  </div>',
    '</div>',
  ].join('');
}

function _renderRegimeCard(r) {
  var el = document.getElementById('fe-regime-card');
  if (!el) return;
  var rm = REGIME_META[r.regime] || REGIME_META.unknown;
  el.innerHTML = [
    '<div class="fel-regime-icon" style="color:' + rm.color + '">' + rm.icon + '</div>',
    '<div>',
    '  <div class="fel-regime-label" style="color:' + rm.color + '">' + rm.label + '</div>',
    '  <div class="fel-regime-desc">' + rm.desc + '</div>',
    '</div>',
    '<div class="fel-regime-bar" style="background:' + rm.color + '18;border-color:' + rm.color + '33">',
    '  <div style="font-size:9px;font-family:var(--fm);color:' + rm.color + ';letter-spacing:.1em">REGIME DETECTED</div>',
    '</div>',
  ].join('');
}

function _renderComponents(components) {
  var el = document.getElementById('fe-components-grid');
  if (!el) return;
  el.innerHTML = components.map(function(c) {
    var s = c.score || 0;
    var col = s > 0.15 ? '#10b981' : s < -0.15 ? '#ef4444' : '#f59e0b';
    var barW = Math.round(Math.abs(s) * 100);
    var contrib = c.contribution || 0;
    var regime = c.regime ? ' <span style="font-size:9px;opacity:.7">(' + c.regime + ')</span>' : '';
    return '<div class="fel-component-card">'
      + '<div class="fel-comp-header">'
      + '  <div class="fel-comp-name">' + c.name + regime + '</div>'
      + '  <div class="fel-comp-score" style="color:' + col + '">' + (s>=0?'+':'') + s + '</div>'
      + '</div>'
      + '<div class="fel-comp-bar-wrap">'
      + '  <div class="fel-comp-bar" style="width:' + barW + '%;background:' + col + ';' + (s < 0 ? 'margin-left:auto' : '') + '"></div>'
      + '</div>'
      + '<div class="fel-comp-footer">'
      + '  <span>Weight ' + Math.round((c.weight||0)*100) + '%</span>'
      + '  <span>Contribution <b style="color:' + col + '">' + (contrib>=0?'+':'') + contrib + '</b></span>'
      + '</div>'
      + _compDetails(c)
      + '</div>';
  }).join('');
}

function _compDetails(c) {
  var d = c.details || {};
  var bits = [];
  if (c.name === 'Momentum' && d.mom_5 !== undefined) {
    bits = [
      ['5-bar', d.mom_5 + '%'], ['10-bar', d.mom_10 + '%'],
      ['20-bar', d.mom_20 + '%'], ['60-bar', d.mom_60 + '%'],
    ];
  } else if (c.name === 'Cross-Asset') {
    bits = [['VIX', c.vix], ['Fear/Greed', Math.round((c.fear_greed||0)*100) + '%']];
  } else if (c.name === 'Sentiment' && d.heat_index) {
    bits = [['Heat Index', d.heat_index], ['News Sent', d.news_sentiment]];
  }
  if (!bits.length) return '';
  return '<div class="fel-comp-details">' + bits.map(function(b) {
    return '<span class="fel-comp-detail-kv">' + b[0] + ' <b>' + b[1] + '</b></span>';
  }).join('') + '</div>';
}

function _renderScannerGrid(results) {
  var grid = document.getElementById('fe-scanner-grid');
  if (!grid) return;
  if (!results.length) {
    grid.innerHTML = '<div class="fel-scanner-empty">No results</div>';
    return;
  }
  grid.innerHTML = results.map(function(r) {
    var c   = r.composite || 0;
    var act = r.action || 'HOLD';
    var am  = ACTION_META[act] || ACTION_META.HOLD;
    var rm  = REGIME_META[r.regime] || REGIME_META.unknown;
    var conf = Math.round((r.confidence || 0) * 100);
    return '<div class="fel-scan-card" onclick="feQuick(\'' + r.symbol + '\')">'
      + '<div class="fel-scan-header">'
      + '  <div class="fel-scan-sym">' + r.symbol + '</div>'
      + '  <div class="fel-scan-action" style="color:' + am.color + ';background:' + am.bg + '">' + act + '</div>'
      + '</div>'
      + '<div class="fel-scan-score" style="color:' + am.color + '">'
      + '  ' + (c >= 0?'+':'') + c
      + '</div>'
      + '<div class="fel-scan-meta">'
      + '  <span>' + rm.icon + ' ' + (r.regime||'').replace('_',' ') + '</span>'
      + '  <span>' + conf + '% conf</span>'
      + '</div>'
      + '<div class="fel-scan-bar"><div style="width:' + Math.round(Math.abs(c)*100) + '%;height:2px;background:' + am.color + ';border-radius:1px"></div></div>'
      + '</div>';
  }).join('');
}

function _renderCrossAsset(f) {
  var el = document.getElementById('fe-cross-asset-body');
  if (!el) return;
  var vix   = f.vix   || 18;
  var dxy   = f.dxy   || 103;
  var gold  = f.gold  || 1950;
  var fg    = Math.round((f.fear_greed || 0.5) * 100);
  var vixR  = f.vix_regime === 1 ? 'High Fear' : f.vix_regime === 0.5 ? 'Elevated' : 'Low';
  var vixCol = f.vix_regime === 1 ? '#ef4444' : f.vix_regime === 0.5 ? '#f59e0b' : '#10b981';

  var items = [
    { label:'VIX',        val:vix, sub:vixR, col:vixCol, icon:'😨' },
    { label:'Fear/Greed', val:fg+'%', sub:fg>60?'Greed':fg<40?'Fear':'Neutral', col:fg>60?'#10b981':fg<40?'#ef4444':'#f59e0b', icon:'🎭' },
    { label:'DXY',        val:dxy, sub:(f.dollar_strong===1?'Strong $':'Weak $'), col:f.dollar_strong===1?'#3b82f6':'#f59e0b', icon:'💵' },
    { label:'Gold',       val:'$'+Math.round(gold), sub:(f.gold_chg||0).toFixed(2)+'%', col:(f.gold_chg||0)>=0?'#f59e0b':'#ef4444', icon:'🥇' },
  ];

  el.innerHTML = '<div class="fel-cross-grid">' + items.map(function(it) {
    return '<div class="fel-cross-card">'
      + '<div class="fel-cross-icon">' + it.icon + '</div>'
      + '<div>'
      + '  <div class="fel-cross-label">' + it.label + '</div>'
      + '  <div class="fel-cross-val" style="color:' + it.col + '">' + it.val + '</div>'
      + '  <div class="fel-cross-sub">' + it.sub + '</div>'
      + '</div></div>';
  }).join('') + '</div>';
}

function _renderFeatureTable(features) {
  var el = document.getElementById('fe-feature-table');
  if (!el) return;
  var rows = Object.entries(features)
    .filter(function(kv){ return typeof kv[1] === 'number'; })
    .sort(function(a,b){ return a[0].localeCompare(b[0]); });

  el.innerHTML = '<div class="fel-feat-grid">' + rows.map(function(kv) {
    var v = typeof kv[1] === 'number' ? kv[1].toFixed(3) : kv[1];
    return '<div class="fel-feat-row">'
      + '<span class="fel-feat-key">' + kv[0].replace(/_/g,' ') + '</span>'
      + '<span class="fel-feat-val">' + v + '</span>'
      + '</div>';
  }).join('') + '</div>';
}

/* ── Indicator charts ── */
var _indicatorData = null;

function _loadIndicatorChart(symbol, period) {
  rq('/api/tradgentic/features/indicators/' + symbol + '?period=' + period)
    .then(function(r) {
      if (!r || r.error) return;
      _indicatorData = r;
      FE._indicators = r;
      _drawIndicatorChart(r, FE.chartMode || 'rsi');
    });
}

function _drawIndicatorChart(data, mode) {
  var canvas = document.getElementById('fe-indicator-chart');
  if (!canvas || !data) return;
  canvas.width  = canvas.offsetWidth || 600;
  canvas.height = 200;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  var series = [];
  var hlines = [];

  if (mode === 'rsi') {
    series = [{ data: data.rsi,   color: '#a78bfa', label:'RSI(14)', width:1.5 }];
    hlines = [{ y:70, color:'rgba(239,68,68,.4)' }, { y:30, color:'rgba(16,185,129,.4)' }, { y:50, color:'rgba(255,255,255,.1)' }];
  } else if (mode === 'stoch') {
    series = [
      { data: data.stoch_k, color: '#60a5fa', label:'%K', width:1.5 },
      { data: data.stoch_d, color: '#f59e0b', label:'%D', width:1.2 },
    ];
    hlines = [{ y:80, color:'rgba(239,68,68,.3)' }, { y:20, color:'rgba(16,185,129,.3)' }];
  } else if (mode === 'adx') {
    series = [
      { data: data.adx,      color: '#f59e0b', label:'ADX',  width:2 },
      { data: data.di_plus,  color: '#10b981', label:'DI+',  width:1.2 },
      { data: data.di_minus, color: '#ef4444', label:'DI-',  width:1.2 },
    ];
    hlines = [{ y:25, color:'rgba(245,158,11,.3)', dashed:true }];
  } else if (mode === 'obv') {
    series = [{ data: data.obv, color: '#06b6d4', label:'OBV', width:1.5 }];
  } else if (mode === 'vol') {
    series = [{ data: data.realised_vol, color: '#f97316', label:'Realised Vol %', width:1.5 }];
  }

  _drawIndicatorCanvas(ctx, series, hlines, canvas.width, 200);
}

function _drawIndicatorCanvas(ctx, series, hlines, W, H) {
  var allVals = series.reduce(function(a,s){
    return a.concat((s.data||[]).filter(function(v){ return v !== null && v !== undefined; }));
  }, []);
  if (!allVals.length) return;

  var minV  = Math.min.apply(null, allVals);
  var maxV  = Math.max.apply(null, allVals);
  var range = maxV - minV || 1;
  var maxLen = Math.max.apply(null, series.map(function(s){ return (s.data||[]).length; }));
  var pad   = {top:12, right:12, bottom:24, left:44};
  var cW    = W - pad.left - pad.right;
  var cH    = H - pad.top  - pad.bottom;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.fillStyle   = 'rgba(148,163,184,.5)';
  ctx.font        = '9px monospace';
  ctx.textAlign   = 'right';
  ctx.lineWidth   = 1;
  for (var gi=0; gi<=4; gi++) {
    var gy = pad.top + gi * cH/4;
    ctx.beginPath(); ctx.moveTo(pad.left,gy); ctx.lineTo(W-pad.right,gy); ctx.stroke();
    ctx.fillText((maxV - gi*range/4).toFixed(1), pad.left-4, gy+3);
  }

  // Horizontal reference lines
  (hlines||[]).forEach(function(hl) {
    var y = pad.top + (1-(hl.y-minV)/range)*cH;
    if (y < pad.top || y > H-pad.bottom) return;
    ctx.strokeStyle = hl.color || 'rgba(255,255,255,.15)';
    ctx.lineWidth   = 1;
    ctx.setLineDash(hl.dashed ? [4,4] : []);
    ctx.beginPath(); ctx.moveTo(pad.left,y); ctx.lineTo(W-pad.right,y); ctx.stroke();
    ctx.setLineDash([]);
  });

  // Series
  series.forEach(function(s) {
    var d = (s.data||[]);
    if (!d.length) return;
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth   = s.width || 1.5;
    ctx.lineJoin    = 'round';
    var started = false;
    d.forEach(function(v, i) {
      if (v === null || v === undefined) return;
      var x = pad.left + i * cW / Math.max(maxLen-1,1);
      var y = pad.top  + (1-(v-minV)/range)*cH;
      if (!started) { ctx.moveTo(x,y); started=true; } else ctx.lineTo(x,y);
    });
    ctx.stroke();
  });
}

function _feError(msg) {
  var res = document.getElementById('fe-results');
  if (res) {
    res.style.display = '';
    var hero = document.getElementById('fe-composite-hero');
    if (hero) hero.innerHTML = '<div style="color:var(--re);padding:16px">⚠️ ' + (msg||'Analysis failed') + '</div>';
  }
}

})();
