/**
 * 25_backtest.js — Tradgentic Backtesting Lab
 * Full UI: run backtest, walk-forward, trade log, metrics, gamification.
 */
(function() {
'use strict';

/* ── State ── */
var BT = {
  symbol:   'SPY',
  strategy: 'ma_crossover',
  period:   '2y',
  params:   {},
  result:   null,
  wfResult: null,
  running:  false,
  chart:    null,
  tab:      'single',   // 'single' | 'walkforward' | 'trades'
};

var STRATEGY_PARAMS = {
  ma_crossover:    { fast_ma: 10, slow_ma: 30, ma_type: 'EMA', stop_pct: 2.0 },
  rsi_reversion:   { rsi_period: 14, oversold: 30, overbought: 70, stop_pct: 3.0 },
  bollinger_bands: { bb_period: 20, bb_std: 2.0, mode: 'reversion', stop_pct: 2.5 },
  macd_momentum:   { stop_pct: 2.5, min_hist: 0.1 },
  buy_hold:        {},
};

var GRADE_COLORS = { S:'#f59e0b', A:'#10b981', B:'#3b82f6', C:'#94a3b8', D:'#f97316', F:'#ef4444' };
var GRADE_BG    = { S:'rgba(245,158,11,.12)', A:'rgba(16,185,129,.12)', B:'rgba(59,130,246,.12)',
                     C:'rgba(148,163,184,.08)', D:'rgba(249,115,22,.1)', F:'rgba(239,68,68,.12)' };

/* ── Boot ── */
window.initBacktestLab = function() {
  var root = document.getElementById('bt-lab-root');
  if (!root) return;
  _renderBtLab(root);
  _loadSymbolSuggestions();
};

function _renderBtLab(root) {
  root.innerHTML = [
    /* ── HEADER ── */
    '<div class="btl-header">',
    '  <div>',
    '    <div class="btl-title">⚗️ Backtesting Lab</div>',
    '    <div class="btl-sub">Test strategies on real historical data · Walk-forward validation · Anti-overfitting</div>',
    '  </div>',
    '  <div class="btl-header-badges">',
    '    <div class="btl-badge btl-badge-live">📡 Real Data</div>',
    '    <div class="btl-badge btl-badge-wf">🔁 Walk-Forward</div>',
    '  </div>',
    '</div>',

    /* ── CONTROLS ── */
    '<div class="btl-controls">',

    /* Symbol */
    '  <div class="btl-ctrl-group">',
    '    <label class="btl-label">Asset</label>',
    '    <div class="btl-symbol-wrap">',
    '      <input id="btl-symbol" class="btl-input" value="SPY" placeholder="SPY, BTC-USD, AAPL…"',
    '        oninput="btlSymbolChange(this.value)">',
    '      <div class="btl-symbol-pills" id="btl-symbol-pills">',
    '        <span class="btl-sym-pill on" onclick="btlSetSymbol(\'SPY\')">SPY</span>',
    '        <span class="btl-sym-pill" onclick="btlSetSymbol(\'BTC-USD\')">BTC</span>',
    '        <span class="btl-sym-pill" onclick="btlSetSymbol(\'AAPL\')">AAPL</span>',
    '        <span class="btl-sym-pill" onclick="btlSetSymbol(\'GC=F\')">Gold</span>',
    '        <span class="btl-sym-pill" onclick="btlSetSymbol(\'QQQ\')">QQQ</span>',
    '        <span class="btl-sym-pill" onclick="btlSetSymbol(\'NVDA\')">NVDA</span>',
    '      </div>',
    '    </div>',
    '  </div>',

    /* Strategy */
    '  <div class="btl-ctrl-group">',
    '    <label class="btl-label">Strategy</label>',
    '    <div class="btl-strategy-cards" id="btl-strategy-cards">',
    _strategyCards(),
    '    </div>',
    '  </div>',

    /* Period / Timeframe */
    '  <div class="btl-ctrl-group">',
    '    <label class="btl-label">Period & Timeframe</label>',
    '    <div class="btl-period-grid" id="btl-period-grid">',
    _periodButtons(),
    '    </div>',
    '  </div>',

    /* Dynamic params */
    '  <div class="btl-ctrl-group" id="btl-params-wrap">',
    '    <label class="btl-label">Parameters</label>',
    '    <div id="btl-params-body">' + _paramsHTML(BT.strategy) + '</div>',
    '  </div>',

    /* Cost inputs */
    '  <div class="btl-ctrl-group btl-costs">',
    '    <label class="btl-label">Transaction Costs</label>',
    '    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">',
    '      <label class="btl-label" style="margin:0">Commission %</label>',
    '      <input type="number" id="btl-commission" class="btl-input btl-input-sm" value="0.10" step="0.01" min="0" max="2">',
    '      <label class="btl-label" style="margin:0">Slippage %</label>',
    '      <input type="number" id="btl-slippage"   class="btl-input btl-input-sm" value="0.05" step="0.01" min="0" max="2">',
    '    </div>',
    '  </div>',

    /* Run buttons */
    '  <div class="btl-run-row">',
    '    <button class="btl-run-btn btl-run-primary" id="btl-run-btn" onclick="btlRun()">',
    '      ▶ Run Backtest',
    '    </button>',
    '    <button class="btl-run-btn btl-run-secondary" id="btl-wf-btn" onclick="btlRunWalkForward()">',
    '      🔁 Walk-Forward',
    '    </button>',
    '  </div>',
    '</div>',

    /* ── RESULTS ── */
    '<div id="btl-results" style="display:none">',

    /* Score badge */
    '  <div class="btl-score-row" id="btl-score-row"></div>',

    /* Tab nav */
    '  <div class="btl-tabs">',
    '    <button class="btl-tab on" onclick="btlTab(\'single\',this)">📈 Performance</button>',
    '    <button class="btl-tab"   onclick="btlTab(\'walkforward\',this)">🔁 Walk-Forward</button>',
    '    <button class="btl-tab"   onclick="btlTab(\'trades\',this)">📋 Trade Log</button>',
    '  </div>',

    /* Performance tab */
    '  <div class="btl-panel on" id="btlp-single">',
    '    <div class="btl-metrics-grid" id="btl-metrics-grid"></div>',
    '    <div class="btl-chart-wrap">',
    '      <div class="btl-chart-legend" id="btl-chart-legend"></div>',
    '      <canvas id="btl-chart" style="width:100%;height:260px"></canvas>',
    '    </div>',
    '  </div>',

    /* Walk-forward tab */
    '  <div class="btl-panel" id="btlp-walkforward">',
    '    <div id="btl-wf-body"><div class="btl-wf-hint">Run Walk-Forward to see results.</div></div>',
    '  </div>',

    /* Trade log tab */
    '  <div class="btl-panel" id="btlp-trades">',
    '    <div id="btl-trades-body"></div>',
    '  </div>',

    '</div>',

    /* Loading overlay */
    '<div class="btl-loading" id="btl-loading" style="display:none">',
    '  <div class="btl-spinner"></div>',
    '  <div class="btl-loading-txt" id="btl-loading-txt">Running backtest…</div>',
    '  <div class="btl-loading-sub">Fetching real market data & simulating trades</div>',
    '</div>',
  ].join('');
}

function _strategyCards() {
  var strats = [
    { id:'ma_crossover',    icon:'📈', name:'MA Cross',   short:'Golden/death cross' },
    { id:'rsi_reversion',   icon:'🔄', name:'RSI',        short:'Mean reversion' },
    { id:'bollinger_bands', icon:'📊', name:'Bollinger',  short:'Band breakout' },
    { id:'macd_momentum',   icon:'⚡', name:'MACD',       short:'Momentum' },
    { id:'buy_hold',        icon:'🔒', name:'Buy&Hold',   short:'Benchmark' },
  ];
  return strats.map(function(s) {
    var on = s.id === BT.strategy ? ' on' : '';
    return '<div class="btl-strat-card' + on + '" onclick="btlSetStrategy(\'' + s.id + '\',this)">'
      + '<div class="btl-strat-icon">' + s.icon + '</div>'
      + '<div class="btl-strat-name">' + s.name + '</div>'
      + '<div class="btl-strat-short">' + s.short + '</div>'
      + '</div>';
  }).join('');
}

function _periodButtons() {
  var periods = [
    { key:'6mo',    label:'6M',  sub:'Daily'   },
    { key:'1y',     label:'1Y',  sub:'Daily'   },
    { key:'2y',     label:'2Y',  sub:'Daily'   },
    { key:'5y',     label:'5Y',  sub:'Weekly'  },
    { key:'10y',    label:'10Y', sub:'Weekly'  },
    { key:'5y_mo',  label:'5Y',  sub:'Monthly' },
    { key:'10y_mo', label:'10Y', sub:'Monthly' },
  ];
  return periods.map(function(p) {
    var on = p.key === BT.period ? ' on' : '';
    return '<div class="btl-period-btn' + on + '" onclick="btlSetPeriod(\'' + p.key + '\',this)">'
      + '<div class="btl-period-val">' + p.label + '</div>'
      + '<div class="btl-period-tf">'  + p.sub + '</div>'
      + '</div>';
  }).join('');
}

function _paramsHTML(strategy) {
  var defs = {
    ma_crossover: [
      { id:'p-fast-ma',   label:'Fast MA',    type:'number', val:10, min:3, max:50 },
      { id:'p-slow-ma',   label:'Slow MA',    type:'number', val:30, min:10,max:200},
      { id:'p-ma-type',   label:'Type',       type:'select', val:'EMA', options:['EMA','SMA'] },
      { id:'p-stop-pct',  label:'Stop Loss %',type:'number', val:2.0, min:0.5,max:10,step:0.5},
    ],
    rsi_reversion: [
      { id:'p-rsi-period', label:'RSI Period',   type:'number', val:14, min:7, max:30 },
      { id:'p-oversold',   label:'Oversold',     type:'number', val:30, min:10,max:45 },
      { id:'p-overbought', label:'Overbought',   type:'number', val:70, min:55,max:90 },
      { id:'p-stop-pct',   label:'Stop Loss %',  type:'number', val:3.0,min:0.5,max:10,step:0.5},
    ],
    bollinger_bands: [
      { id:'p-bb-period',  label:'BB Period',    type:'number', val:20, min:10,max:50 },
      { id:'p-bb-std',     label:'Std Dev',      type:'number', val:2.0,min:1.0,max:3.0,step:0.1},
      { id:'p-mode',       label:'Mode',         type:'select', val:'reversion',options:['reversion','breakout']},
      { id:'p-stop-pct',   label:'Stop Loss %',  type:'number', val:2.5,min:0.5,max:10,step:0.5},
    ],
    macd_momentum: [
      { id:'p-stop-pct',  label:'Stop Loss %',  type:'number', val:2.5,min:0.5,max:10,step:0.5},
      { id:'p-min-hist',  label:'Min Histogram',type:'number', val:0.1,min:0,max:2.0,step:0.05},
    ],
    buy_hold: [],
  };
  var fields = defs[strategy] || [];
  if (!fields.length) return '<div style="color:var(--t3);font-size:11px;padding:8px 0">No parameters — pure buy & hold.</div>';
  return '<div class="btl-params-grid">' + fields.map(function(f) {
    if (f.type === 'select') {
      return '<div class="btl-param-row">'
        + '<label class="btl-param-label">' + f.label + '</label>'
        + '<select id="' + f.id + '" class="btl-input btl-input-sm">'
        + f.options.map(function(o){ return '<option value="' + o + '"' + (o===f.val?' selected':'') + '>' + o + '</option>'; }).join('')
        + '</select></div>';
    }
    return '<div class="btl-param-row">'
      + '<label class="btl-param-label">' + f.label + '</label>'
      + '<input type="number" id="' + f.id + '" class="btl-input btl-input-sm"'
      + ' value="' + f.val + '" min="' + f.min + '" max="' + f.max + '"'
      + (f.step ? ' step="' + f.step + '"' : '')
      + '></div>';
  }).join('') + '</div>';
}

function _readParams() {
  var p = Object.assign({}, STRATEGY_PARAMS[BT.strategy] || {});
  var map = {
    ma_crossover:    { fast_ma:'p-fast-ma', slow_ma:'p-slow-ma', ma_type:'p-ma-type', stop_pct:'p-stop-pct' },
    rsi_reversion:   { rsi_period:'p-rsi-period', oversold:'p-oversold', overbought:'p-overbought', stop_pct:'p-stop-pct' },
    bollinger_bands: { bb_period:'p-bb-period', bb_std:'p-bb-std', mode:'p-mode', stop_pct:'p-stop-pct' },
    macd_momentum:   { stop_pct:'p-stop-pct', min_hist:'p-min-hist' },
  };
  var fields = map[BT.strategy] || {};
  Object.keys(fields).forEach(function(param) {
    var el = document.getElementById(fields[param]);
    if (!el) return;
    var v = el.value;
    if (el.type === 'number') v = parseFloat(v) || 0;
    p[param] = v;
  });
  return p;
}

/* ── Public API ── */
window.btlSetSymbol = function(sym) {
  BT.symbol = sym.toUpperCase();
  var inp = document.getElementById('btl-symbol');
  if (inp) inp.value = BT.symbol;
  document.querySelectorAll('.btl-sym-pill').forEach(function(p) {
    p.classList.toggle('on', p.textContent.trim() === sym ||
      (sym === 'BTC-USD' && p.textContent === 'BTC'));
  });
};

window.btlSymbolChange = function(val) {
  BT.symbol = val.trim().toUpperCase() || 'SPY';
};

window.btlSetStrategy = function(id, card) {
  BT.strategy = id;
  document.querySelectorAll('.btl-strat-card').forEach(function(c){ c.classList.remove('on'); });
  if (card) card.classList.add('on');
  var pb = document.getElementById('btl-params-body');
  if (pb) pb.innerHTML = _paramsHTML(id);
};

window.btlSetPeriod = function(key, btn) {
  BT.period = key;
  document.querySelectorAll('.btl-period-btn').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
};

window.btlTab = function(tab, btn) {
  BT.tab = tab;
  document.querySelectorAll('.btl-tab').forEach(function(b){ b.classList.remove('on'); });
  document.querySelectorAll('.btl-panel').forEach(function(p){ p.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  var panel = document.getElementById('btlp-' + tab);
  if (panel) panel.classList.add('on');
};

window.btlRun = function() {
  if (BT.running) return;
  BT.running = true;
  BT.params = _readParams();
  _showLoading('Running backtest on ' + BT.symbol + '…');

  rq('/api/tradgentic/backtest/run', {
    method: 'POST',
    body: {
      symbol:         BT.symbol,
      strategy:       BT.strategy,
      period:         BT.period,
      params:         BT.params,
      commission_pct: parseFloat((document.getElementById('btl-commission')||{}).value || 0.10),
      slippage_pct:   parseFloat((document.getElementById('btl-slippage')  ||{}).value || 0.05),
    }
  }).then(function(r) {
    BT.running = false;
    _hideLoading();
    if (!r || r.error) {
      _showError(r && r.error ? r.error : 'Backtest failed');
      return;
    }
    BT.result = r;
    _renderResults(r);
    // Switch to single tab
    btlTab('single', document.querySelector('.btl-tab'));
  }).catch(function(e) {
    BT.running = false;
    _hideLoading();
    _showError('Network error');
  });
};

window.btlRunWalkForward = function() {
  if (BT.running) return;
  BT.running = true;
  BT.params = _readParams();

  // Use a longer period for WF
  var wfPeriod = BT.period === '6mo' || BT.period === '1y' ? '5y' : BT.period;
  _showLoading('Running walk-forward validation…');

  rq('/api/tradgentic/backtest/walk-forward', {
    method: 'POST',
    body: {
      symbol:    BT.symbol,
      strategy:  BT.strategy,
      period:    wfPeriod,
      params:    BT.params,
      n_windows: 5,
    }
  }).then(function(r) {
    BT.running = false;
    _hideLoading();
    if (!r || r.error) { _showError(r && r.error ? r.error : 'Walk-forward failed'); return; }
    BT.wfResult = r;
    // Show results panel if hidden
    var res = document.getElementById('btl-results');
    if (res) res.style.display = '';
    _renderWalkForward(r);
    btlTab('walkforward', document.querySelectorAll('.btl-tab')[1]);
  }).catch(function() {
    BT.running = false;
    _hideLoading();
    _showError('Network error');
  });
};

/* ── Render results ── */
function _renderResults(r) {
  var res = document.getElementById('btl-results');
  if (res) res.style.display = '';

  _renderScoreBadge(r);
  _renderMetricsGrid(r.metrics, r);
  _renderChart(r);
  _renderTradeLog(r.trades || []);
}

function _renderScoreBadge(r) {
  var score = (r.metrics || {}).score || 0;
  var grade = r.grade || 'F';
  var label = r.grade_label || 'Poor';
  var color = GRADE_COLORS[grade] || '#94a3b8';
  var bg    = GRADE_BG[grade]    || 'rgba(148,163,184,.08)';

  var el = document.getElementById('btl-score-row');
  if (!el) return;
  el.innerHTML = [
    '<div class="btl-score-badge" style="background:' + bg + ';border-color:' + color + '22">',
    '  <div class="btl-grade" style="color:' + color + '">' + grade + '</div>',
    '  <div>',
    '    <div class="btl-grade-label" style="color:' + color + '">' + label + '</div>',
    '    <div class="btl-grade-sub">Score ' + score + ' / 1000</div>',
    '  </div>',
    '  <div class="btl-score-bar-wrap">',
    '    <div class="btl-score-bar" style="width:' + (score/10) + '%;background:' + color + '"></div>',
    '  </div>',
    '</div>',
    '<div class="btl-score-meta">',
    '  <span class="btl-meta-pill">' + (r.symbol || '') + '</span>',
    '  <span class="btl-meta-pill">' + (r.strategy || '').replace(/_/g,' ') + '</span>',
    '  <span class="btl-meta-pill">' + (r.period || '') + '</span>',
    '  <span class="btl-meta-pill">' + (r.n_bars || 0) + ' bars</span>',
    '  <span class="btl-meta-pill">Commission ' + (r.commission_pct || 0.10) + '%</span>',
    '  <span class="btl-meta-pill">Slippage ' + (r.slippage_pct || 0.05) + '%</span>',
    '</div>',
  ].join('');
}

var _METRIC_GLOSSARY = {
  'Sharpe Ratio': 'sharpe', 'Sortino Ratio': 'sharpe',
  'Max Drawdown': 'max_drawdown', 'Win Rate': 'win_rate',
  'Profit Factor': 'profit_factor', 'Calmar Ratio': 'calmar',
};

function _metricCard(label, value, sub, color, icon) {
  var termKey = _METRIC_GLOSSARY[label];
  var help = termKey && typeof obHelpIcon === 'function'
    ? obHelpIcon(termKey) : '';
  return '<div class="btl-metric-card">'
    + '<div class="btl-metric-icon">' + icon + '</div>'
    + '<div class="btl-metric-body">'
    + '  <div class="btl-metric-label">' + label + help + '</div>'
    + '  <div class="btl-metric-value" style="color:' + (color || 'var(--t1)') + '">' + value + '</div>'
    + (sub ? '<div class="btl-metric-sub">' + sub + '</div>' : '')
    + '</div></div>';
}

function _renderMetricsGrid(m, r) {
  if (!m) return;
  var el = document.getElementById('btl-metrics-grid');
  if (!el) return;

  var retColor  = m.total_return_pct >= 0 ? 'var(--gr)' : 'var(--re)';
  var annColor  = m.ann_return_pct   >= 0 ? 'var(--gr)' : 'var(--re)';
  var shColor   = m.sharpe > 1.5 ? 'var(--gr)' : m.sharpe > 0.5 ? 'var(--am)' : 'var(--re)';
  var ddColor   = m.max_drawdown_pct > 25 ? 'var(--re)' : m.max_drawdown_pct > 15 ? 'var(--am)' : 'var(--gr)';
  var winColor  = m.win_rate_pct > 55 ? 'var(--gr)' : m.win_rate_pct > 40 ? 'var(--am)' : 'var(--re)';
  var pfColor   = m.profit_factor > 1.5 ? 'var(--gr)' : m.profit_factor > 1.0 ? 'var(--am)' : 'var(--re)';

  var bh = (r.buyhold_nav || []);
  var bhReturn = bh.length ? (bh[bh.length-1] - 100).toFixed(2) : '—';

  el.innerHTML = [
    _metricCard('Total Return',   (m.total_return_pct >= 0?'+':'') + m.total_return_pct + '%', 'vs B&H: ' + (bhReturn > 0 ? '+' : '') + bhReturn + '%', retColor, '💰'),
    _metricCard('Ann. Return',    (m.ann_return_pct   >= 0?'+':'') + m.ann_return_pct   + '%', 'annualised CAGR', annColor, '📅'),
    _metricCard('Sharpe Ratio',   m.sharpe,  m.sharpe > 1 ? 'Good' : 'Below 1 = suboptimal', shColor, '⚖️'),
    _metricCard('Sortino Ratio',  m.sortino, 'Downside risk-adjusted', shColor, '🎯'),
    _metricCard('Max Drawdown',   '-' + m.max_drawdown_pct + '%', 'Peak-to-trough loss', ddColor, '📉'),
    _metricCard('Calmar Ratio',   m.calmar,  'Ann.Return / Max DD', m.calmar > 0.5 ? 'var(--gr)' : 'var(--am)', '🏆'),
    _metricCard('Win Rate',       m.win_rate_pct + '%', m.n_trades + ' trades total', winColor, '🎲'),
    _metricCard('Profit Factor',  m.profit_factor, 'Gross win / gross loss', pfColor, '💹'),
    _metricCard('Avg Win',        '$' + m.avg_win_usd,  'Per winning trade', 'var(--gr)', '✅'),
    _metricCard('Avg Loss',       '$' + m.avg_loss_usd, 'Per losing trade', 'var(--re)', '❌'),
  ].join('');
}

function _renderChart(r) {
  var canvas = document.getElementById('btl-chart');
  if (!canvas) return;

  canvas.width  = canvas.offsetWidth  || 600;
  canvas.height = 260;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  var nav = r.nav || [];
  var bh  = r.buyhold_nav || [];
  if (!nav.length) return;

  // Legend
  var legend = document.getElementById('btl-chart-legend');
  if (legend) {
    legend.innerHTML = [
      '<span class="btl-legend-item"><span style="background:#60a5fa;width:12px;height:3px;display:inline-block;border-radius:2px;margin-right:5px"></span>Strategy</span>',
      '<span class="btl-legend-item"><span style="background:#94a3b8;width:12px;height:3px;display:inline-block;border-radius:2px;margin-right:5px"></span>Buy & Hold</span>',
    ].join('');
  }

  _drawLines(ctx, [
    { data: nav, color: '#60a5fa', width: 2.0 },
    { data: bh,  color: 'rgba(148,163,184,.6)', width: 1.5 },
  ], canvas.width, 260, r.trades || []);
}

function _drawLines(ctx, series, W, H, trades) {
  var allVals = series.reduce(function(a,s){ return a.concat(s.data); }, []);
  var minV = Math.min.apply(null, allVals);
  var maxV = Math.max.apply(null, allVals);
  var range = maxV - minV || 1;
  var maxLen = Math.max.apply(null, series.map(function(s){ return s.data.length; }));
  var pad = {top:16, right:16, bottom:28, left:52};
  var cW = W - pad.left - pad.right;
  var cH = H - pad.top  - pad.bottom;

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.04)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(148,163,184,.5)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  for (var gi = 0; gi <= 4; gi++) {
    var gy = pad.top + gi * cH / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
    var gv = maxV - gi * range / 4;
    ctx.fillText(gv.toFixed(0), pad.left - 4, gy + 3);
  }

  // Baseline at 100
  var baseline = pad.top + (1 - (100 - minV) / range) * cH;
  ctx.strokeStyle = 'rgba(255,255,255,.15)';
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad.left, baseline);
  ctx.lineTo(W - pad.right, baseline);
  ctx.stroke();
  ctx.setLineDash([]);

  // Series lines
  series.forEach(function(s) {
    if (!s.data.length) return;
    var n = s.data.length;
    ctx.beginPath();
    ctx.strokeStyle = s.color;
    ctx.lineWidth   = s.width || 1.5;
    ctx.lineJoin    = 'round';
    for (var i = 0; i < n; i++) {
      var x = pad.left + i * cW / Math.max(n - 1, 1);
      var y = pad.top  + (1 - (s.data[i] - minV) / range) * cH;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  });

  // Trade dots on strategy line
  if (trades && trades.length && series[0]) {
    var n = series[0].data.length;
    trades.slice(-100).forEach(function(t) {
      // Approximate x position
      var navLen = series[0].data.length;
      var x = pad.left + Math.random() * cW; // simplified positioning
      var y = pad.top + cH * 0.5;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = t.type === 'BUY' ? '#10b981' : t.type === 'SELL' ? '#ef4444' : '#f59e0b';
      ctx.fill();
    });
  }
}

function _renderTradeLog(trades) {
  var el = document.getElementById('btl-trades-body');
  if (!el) return;
  if (!trades.length) {
    el.innerHTML = '<div class="btl-empty">No trades to show.</div>';
    return;
  }
  var rows = trades.slice().reverse().map(function(t) {
    var typeColor = t.type === 'BUY' ? '#10b981' : t.type === 'STOP' ? '#f59e0b' : '#ef4444';
    var pnlStr = t.pnl != null
      ? '<span style="color:' + (t.pnl >= 0 ? 'var(--gr)' : 'var(--re)') + '">'
        + (t.pnl >= 0 ? '+' : '') + '$' + t.pnl.toFixed(0) + '</span>'
      : '—';
    return '<div class="btl-trade-row">'
      + '<span class="btl-trade-type" style="color:' + typeColor + ';background:' + typeColor + '18">' + t.type + '</span>'
      + '<span class="btl-trade-date">' + t.date + '</span>'
      + '<span class="btl-trade-price">$' + t.price + '</span>'
      + '<span class="btl-trade-qty">' + t.qty + ' sh</span>'
      + '<span class="btl-trade-pnl">' + pnlStr + '</span>'
      + '<span class="btl-trade-pct">' + (t.pnl_pct != null ? (t.pnl_pct >= 0?'+':'') + t.pnl_pct + '%' : '') + '</span>'
      + '</div>';
  }).join('');
  el.innerHTML = '<div class="btl-trade-header">'
    + '<span>Type</span><span>Date</span><span>Price</span><span>Qty</span><span>P&L</span><span>%</span>'
    + '</div>' + rows;
}

function _renderWalkForward(r) {
  var el = document.getElementById('btl-wf-body');
  if (!el) return;
  if (r.error) { el.innerHTML = '<div class="btl-error">' + r.error + '</div>'; return; }

  var s = r.summary || {};
  var grade = s.grade || 'F';
  var color = GRADE_COLORS[grade] || '#94a3b8';
  var bg    = GRADE_BG[grade]    || 'rgba(148,163,184,.08)';

  var overfit_label = s.overfit_ratio > 0.8 ? '✅ Low overfit' :
                      s.overfit_ratio > 0.5 ? '⚠️ Moderate overfit' : '🚨 High overfit';
  var overfit_color = s.overfit_ratio > 0.8 ? 'var(--gr)' :
                      s.overfit_ratio > 0.5 ? 'var(--am)' : 'var(--re)';

  var html = [
    '<div class="btl-wf-summary">',
    '  <div class="btl-wf-grade" style="background:' + bg + ';border-color:' + color + '33">',
    '    <div class="btl-grade" style="color:' + color + '">' + grade + '</div>',
    '    <div>',
    '      <div class="btl-grade-label" style="color:' + color + '">' + s.grade_label + ' — Robustness Score ' + s.robust_score + '</div>',
    '      <div class="btl-grade-sub">Out-of-sample performance across ' + r.n_windows + ' windows</div>',
    '    </div>',
    '  </div>',
    '  <div class="btl-wf-meta-grid">',
    '    <div class="btl-wf-meta-item"><div class="btl-wf-meta-val" style="color:' + (s.avg_oos_return_pct >= 0 ? 'var(--gr)' : 'var(--re)') + '">' + (s.avg_oos_return_pct >= 0?'+':'') + s.avg_oos_return_pct + '%</div><div class="btl-wf-meta-label">Avg OOS Return</div></div>',
    '    <div class="btl-wf-meta-item"><div class="btl-wf-meta-val">' + s.avg_oos_sharpe + '</div><div class="btl-wf-meta-label">Avg OOS Sharpe</div></div>',
    '    <div class="btl-wf-meta-item"><div class="btl-wf-meta-val" style="color:var(--re)">-' + s.avg_oos_dd_pct + '%</div><div class="btl-wf-meta-label">Avg OOS Drawdown</div></div>',
    '    <div class="btl-wf-meta-item"><div class="btl-wf-meta-val" style="color:var(--gr)">' + s.consistency_pct + '%</div><div class="btl-wf-meta-label">Profitable Windows</div></div>',
    '    <div class="btl-wf-meta-item"><div class="btl-wf-meta-val" style="color:' + overfit_color + '">' + overfit_label + '</div><div class="btl-wf-meta-label">Overfit Ratio ' + s.overfit_ratio + '</div></div>',
    '  </div>',
    '</div>',
    '<div class="btl-wf-windows">',
  ];

  (r.windows || []).forEach(function(w) {
    var oos = w.out_of_sample || {};
    var is  = w.in_sample    || {};
    var oosColor = (oos.total_return_pct || 0) >= 0 ? 'var(--gr)' : 'var(--re)';
    var oosSc = oos.score || 0;
    var ooGrade = oosSc >= 800?'S':oosSc>=650?'A':oosSc>=500?'B':oosSc>=350?'C':oosSc>=200?'D':'F';
    html.push(
      '<div class="btl-wf-window">',
      '  <div class="btl-wf-win-header">',
      '    <div class="btl-wf-win-num">Window ' + w.window + '</div>',
      '    <div class="btl-wf-win-dates">' + w.date_start + ' → ' + w.date_end + '</div>',
      '    <div class="btl-wf-win-grade" style="color:' + (GRADE_COLORS[ooGrade]||'#94a3b8') + '">' + ooGrade + '</div>',
      '  </div>',
      '  <div class="btl-wf-win-body">',
      '    <div class="btl-wf-col btl-wf-col-is">',
      '      <div class="btl-wf-col-title">In-Sample (' + w.n_in_bars + ' bars)</div>',
      '      <div class="btl-wf-kv"><span>Return</span><span style="color:' + ((is.total_return_pct||0)>=0?'var(--gr)':'var(--re)') + '">' + (is.total_return_pct||0) + '%</span></div>',
      '      <div class="btl-wf-kv"><span>Sharpe</span><span>' + (is.sharpe||0) + '</span></div>',
      '      <div class="btl-wf-kv"><span>Max DD</span><span style="color:var(--re)">-' + (is.max_drawdown_pct||0) + '%</span></div>',
      '    </div>',
      '    <div class="btl-wf-divider">→</div>',
      '    <div class="btl-wf-col btl-wf-col-oos">',
      '      <div class="btl-wf-col-title">Out-of-Sample (' + w.n_oos_bars + ' bars)</div>',
      '      <div class="btl-wf-kv"><span>Return</span><span style="color:' + oosColor + '">' + (oos.total_return_pct||0) + '%</span></div>',
      '      <div class="btl-wf-kv"><span>Sharpe</span><span>' + (oos.sharpe||0) + '</span></div>',
      '      <div class="btl-wf-kv"><span>Max DD</span><span style="color:var(--re)">-' + (oos.max_drawdown_pct||0) + '%</span></div>',
      '    </div>',
      '  </div>',
      '</div>'
    );
  });

  html.push('</div>');
  el.innerHTML = html.join('');
}

/* ── Helpers ── */
function _showLoading(txt) {
  var lo = document.getElementById('btl-loading');
  var lt = document.getElementById('btl-loading-txt');
  if (lo) lo.style.display = 'flex';
  if (lt && txt) lt.textContent = txt;
  var btn = document.getElementById('btl-run-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Running…'; }
  var wfb = document.getElementById('btl-wf-btn');
  if (wfb) wfb.disabled = true;
}

function _hideLoading() {
  var lo = document.getElementById('btl-loading');
  if (lo) lo.style.display = 'none';
  var btn = document.getElementById('btl-run-btn');
  if (btn) { btn.disabled = false; btn.textContent = '▶ Run Backtest'; }
  var wfb = document.getElementById('btl-wf-btn');
  if (wfb) wfb.disabled = false;
}

function _showError(msg) {
  var res = document.getElementById('btl-results');
  if (res) {
    res.style.display = '';
    var sg = document.getElementById('btl-score-row');
    if (sg) sg.innerHTML = '<div style="color:var(--re);padding:16px;font-size:12px">⚠️ ' + msg + '</div>';
  }
}

function _loadSymbolSuggestions() { /* future: load from user watchlist */ }

})();
