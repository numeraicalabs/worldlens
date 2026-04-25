/** WorldLens v21 — FINANCE BUNDLE */
/* Files: 13_portfolio.js 05_markets.js 24_tradgentic.js 25_backtest.js 26_features.js 28_ml_bots.js 11_insiders.js 06_supply_admin.js 29_sprint_c.js */


/* ═══════════ 13_portfolio.js ═══════════ */
/**
 * @file 13_portfolio.js
 * @module WorldLens / Risk-Based Portfolio Builder
 *
 * 5 risk levels → auto-generated asset allocation → live quant metrics
 * Enhances the existing Portfolio tab in the Markets section.
 *
 * Features:
 *  - 5-level risk dial → auto-populates allocation (bonds → equity → alts)
 *  - Auto mode: pre-set diversified basket per risk level
 *  - Custom mode: manual ticker search + weight sliders
 *  - Donut chart (allocation), NAV chart (normalised backtest)
 *  - KPI row: Expected Return, Volatility, Sharpe, Max Drawdown, Beta
 *  - Stress test: -20% equity, oil shock, rate spike scenarios
 *  - AI narrative: 3-sentence plain-English portfolio summary
 *  - CSV export
 */

// ── Risk level definitions ──────────────────────────────────────────
var PORT_RISK_LEVELS = {
  1: {
    label: '🛡 Conservative',
    desc:  'Capital preservation. Bonds & cash dominant. Low volatility.',
    color: '#10B981',
    alloc: [
      { symbol:'TLT',    name:'20yr Treasury ETF',  weight:30, cat:'bond'      },
      { symbol:'SHY',    name:'1-3yr Treasury ETF', weight:20, cat:'bond'      },
      { symbol:'LQD',    name:'Corp Bond ETF',      weight:15, cat:'bond'      },
      { symbol:'GLD',    name:'Gold ETF',            weight:15, cat:'commodity' },
      { symbol:'^GSPC',  name:'S&P 500',             weight:10, cat:'index'     },
      { symbol:'VNQ',    name:'REIT ETF',            weight:10, cat:'etf'       },
    ],
  },
  2: {
    label: '🌿 Cautious',
    desc:  'Mostly fixed income with moderate equity. Steady growth.',
    color: '#60A5FA',
    alloc: [
      { symbol:'TLT',    name:'20yr Treasury ETF',  weight:25, cat:'bond'      },
      { symbol:'LQD',    name:'Corp Bond ETF',       weight:15, cat:'bond'      },
      { symbol:'^GSPC',  name:'S&P 500',             weight:25, cat:'index'     },
      { symbol:'^FTSE',  name:'FTSE 100',            weight:10, cat:'index'     },
      { symbol:'GLD',    name:'Gold',                weight:10, cat:'commodity' },
      { symbol:'VNQ',    name:'REIT ETF',            weight:10, cat:'etf'       },
      { symbol:'EURUSD=X',name:'EUR/USD',            weight:5,  cat:'forex'     },
    ],
  },
  3: {
    label: '⚖ Balanced',
    desc:  'Classic 60/40 evolved. Global diversification across asset classes.',
    color: '#F59E0B',
    alloc: [
      { symbol:'^GSPC',  name:'S&P 500',             weight:25, cat:'index'     },
      { symbol:'^IXIC',  name:'Nasdaq',               weight:10, cat:'index'     },
      { symbol:'EEM',    name:'Emerging Markets ETF', weight:10, cat:'etf'       },
      { symbol:'TLT',    name:'20yr Treasury ETF',    weight:15, cat:'bond'      },
      { symbol:'GLD',    name:'Gold',                 weight:10, cat:'commodity' },
      { symbol:'CL=F',   name:'Crude Oil',            weight:5,  cat:'commodity' },
      { symbol:'MSFT',   name:'Microsoft',            weight:10, cat:'stock'     },
      { symbol:'BTC-USD',name:'Bitcoin',              weight:5,  cat:'crypto'    },
      { symbol:'VNQ',    name:'REIT ETF',             weight:10, cat:'etf'       },
    ],
  },
  4: {
    label: '📈 Growth',
    desc:  'Equity-heavy with tech tilt. Higher volatility, higher returns.',
    color: '#F97316',
    alloc: [
      { symbol:'^GSPC',  name:'S&P 500',             weight:25, cat:'index'     },
      { symbol:'XLK',    name:'Technology ETF',       weight:20, cat:'etf'       },
      { symbol:'NVDA',   name:'NVIDIA',               weight:10, cat:'stock'     },
      { symbol:'MSFT',   name:'Microsoft',            weight:10, cat:'stock'     },
      { symbol:'EEM',    name:'Emerging Markets',     weight:10, cat:'etf'       },
      { symbol:'GLD',    name:'Gold',                 weight:8,  cat:'commodity' },
      { symbol:'BTC-USD',name:'Bitcoin',              weight:10, cat:'crypto'    },
      { symbol:'TLT',    name:'Treasuries',           weight:7,  cat:'bond'      },
    ],
  },
  5: {
    label: '🚀 Aggressive',
    desc:  'Max return profile. High equity + crypto + commodities. Volatile.',
    color: '#EF4444',
    alloc: [
      { symbol:'XLK',    name:'Technology ETF',       weight:20, cat:'etf'       },
      { symbol:'NVDA',   name:'NVIDIA',               weight:15, cat:'stock'     },
      { symbol:'BTC-USD',name:'Bitcoin',              weight:15, cat:'crypto'    },
      { symbol:'ETH-USD',name:'Ethereum',             weight:10, cat:'crypto'    },
      { symbol:'^IXIC',  name:'Nasdaq',               weight:15, cat:'index'     },
      { symbol:'ARKK',   name:'ARK Innovation ETF',   weight:10, cat:'etf'       },
      { symbol:'CL=F',   name:'Crude Oil',            weight:8,  cat:'commodity' },
      { symbol:'SOL-USD',name:'Solana',               weight:7,  cat:'crypto'    },
    ],
  },
};

var CAT_COLORS_PORT = {
  bond:      '#A78BFA', stock:    '#F97316', index:   '#3B82F6',
  etf:       '#10B981', commodity:'#F59E0B', crypto:  '#EC4899',
  forex:     '#06B6D4',
};

// ── State ───────────────────────────────────────────────────────────
var PORT = {
  riskLevel: 3,
  mode:      'auto',    // 'auto' | 'custom'
  allocation: [],       // [{symbol, name, weight, cat}]
  results:    null,
};

// ── Risk level change ────────────────────────────────────────────────
function portRiskChange(level, btn) {
  PORT.riskLevel = parseInt(level);

  // Update button styles
  document.querySelectorAll('.port-rlvl-btn').forEach(function(b) {
    var lvl = parseInt(b.dataset.level);
    b.classList.toggle('active', lvl === PORT.riskLevel);
    b.style.background = lvl <= PORT.riskLevel
      ? (PORT_RISK_LEVELS[PORT.riskLevel].color + '33')
      : '';
    b.style.borderColor = lvl <= PORT.riskLevel
      ? PORT_RISK_LEVELS[PORT.riskLevel].color
      : '';
    b.style.color = lvl === PORT.riskLevel
      ? PORT_RISK_LEVELS[PORT.riskLevel].color
      : '';
  });

  // Update description
  var descEl = document.getElementById('port-risk-desc');
  var info    = PORT_RISK_LEVELS[PORT.riskLevel];
  if (descEl) {
    descEl.innerHTML = '<b style="color:' + info.color + '">' + info.label + '</b>'
      + ' — ' + info.desc;
  }

  // Render allocation cards
  _portRenderAllocCards();
}

function _portRenderAllocCards() {
  var grid  = document.getElementById('port-alloc-grid');
  if (!grid) return;
  var info  = PORT_RISK_LEVELS[PORT.riskLevel];
  PORT.allocation = info.alloc.slice();

  html = PORT.allocation.map(function(a) {
    var col  = CAT_COLORS_PORT[a.cat] || '#94A3B8';
    var live = MKT.allAssets && MKT.allAssets.find(function(x){ return x.symbol===a.symbol; });
    var priceHtml = '';
    if (live && live.price != null) {
      var up = (live.change_pct||0) >= 0;
      priceHtml = '<div class="port-alloc-price">'
        + '<span style="font-weight:700">' + fmtP(a.symbol, live.price) + '</span>'
        + '<span style="color:' + (up?'var(--gr)':'var(--re)') + ';font-size:9px;margin-left:4px">'
        + (up?'+':'') + (live.change_pct||0).toFixed(2) + '%</span></div>';
    }
    return '<div class="port-alloc-card">'
      + '<div class="port-alloc-top">'
      + '<span class="port-alloc-sym" style="color:' + col + '">' + a.symbol + '</span>'
      + '<span class="port-alloc-cat" style="background:' + col + '22;color:' + col + '">' + a.cat + '</span>'
      + '</div>'
      + '<div class="port-alloc-name">' + a.name + '</div>'
      + priceHtml
      + '<div class="port-alloc-weight-row">'
      + '<div class="port-alloc-bar-bg"><div class="port-alloc-bar-fill" style="width:' + a.weight + '%;background:' + col + '"></div></div>'
      + '<span class="port-alloc-pct">' + a.weight + '%</span>'
      + '</div>'
      + '</div>';
  }).join('');
  grid.innerHTML = html;
}

function portSetMode(mode, btn) {
  PORT.mode = mode;
  document.querySelectorAll('.port-mode-btn').forEach(function(b){
    b.classList.toggle('on', b === btn);
  });
  var autoSec   = document.getElementById('port-auto-section');
  var customSec = document.getElementById('port-custom-section');
  if (autoSec)   autoSec.style.display   = mode==='auto'   ? 'block' : 'none';
  if (customSec) customSec.style.display = mode==='custom' ? 'block' : 'none';
}

// ── Build portfolio (compute) ────────────────────────────────────────
async function portBuild() {
  var btn = document.querySelector('[onclick="portBuild()"]');
  if (btn) { btn.textContent = '⏳ Computing…'; btn.disabled = true; }

  // Determine holdings from mode
  var holdings;
  if (PORT.mode === 'auto') {
    holdings = PORT.allocation.map(function(a) {
      return { symbol: a.symbol, weight: a.weight / 100 };
    });
  } else {
    if (!MKT.portfolio.length) {
      toast('Add at least 2 assets to compute', 'e');
      if (btn) { btn.textContent = '▶ Build Portfolio'; btn.disabled = false; }
      return;
    }
    var total = MKT.portfolio.reduce(function(s,h){ return s+h.weight; }, 0) || 100;
    holdings  = MKT.portfolio.map(function(h){
      return { symbol:h.symbol, weight:h.weight/total };
    });
  }

  try {
    var r = await rq('/api/markets/quant/portfolio', {
      method: 'POST',
      body:   { holdings:holdings, period:'2y', risk_free_rate:0.05 },
    });

    if (btn) { btn.textContent = '▶ Build Portfolio'; btn.disabled = false; }

    if (!r || r.error) {
      toast('Portfolio compute failed: ' + (r && r.error || 'unknown error'), 'e');
      return;
    }

    PORT.results = r;
    _portRenderResults(r, holdings);
  } catch(e) {
    if (btn) { btn.textContent = '▶ Build Portfolio'; btn.disabled = false; }
    toast('Error: ' + e.message, 'e');
  }
}

// Back-compat: old runPortfolio calls portBuild
function runPortfolio() { portBuild(); }

function _portRenderResults(r, holdings) {
  var resEl = document.getElementById('port-results');
  if (!resEl) return;
  resEl.style.display = 'block';

  var info  = PORT_RISK_LEVELS[PORT.riskLevel];
  var riskColor = info.color;

  // ── KPI row ───────────────────────────────────────────────────────
  var kpis  = document.getElementById('port-result-kpis');
  var metrics = r.metrics || r;

  function kpi(label, value, color, sub) {
    return '<div class="port-kpi-card">'
      + '<div class="port-kpi-label">' + label + '</div>'
      + '<div class="port-kpi-value" style="color:' + (color||'var(--t1)') + '">' + value + '</div>'
      + (sub ? '<div class="port-kpi-sub">' + sub + '</div>' : '')
      + '</div>';
  }

  var ann_ret = metrics.annual_return != null ? metrics.annual_return : (metrics.annualized_return != null ? metrics.annualized_return : null);
  var ann_vol = metrics.annual_volatility != null ? metrics.annual_volatility : (metrics.annualized_volatility != null ? metrics.annualized_volatility : null);
  var sharpe  = metrics.sharpe_ratio  != null ? metrics.sharpe_ratio  : null;
  var mdd     = metrics.max_drawdown  != null ? metrics.max_drawdown  : null;
  var beta    = metrics.beta          != null ? metrics.beta          : null;
  var sortino = metrics.sortino       != null ? metrics.sortino       : null;
  var calmar  = metrics.calmar        != null ? metrics.calmar        : null;

  var retCol = ann_ret != null ? (ann_ret >= 0 ? 'var(--gr)' : 'var(--re)') : 'var(--t1)';
  var mddCol = mdd != null     ? (mdd < -0.2  ? 'var(--re)'  : mdd < -0.1 ? 'var(--am)' : 'var(--gr)') : 'var(--t1)';
  var shrpCol = sharpe != null ? (sharpe > 1  ? 'var(--gr)'  : sharpe > 0 ? 'var(--am)' : 'var(--re)') : 'var(--t1)';

  if (kpis) kpis.innerHTML =
    kpi('Ann. Return',    ann_ret  != null ? (ann_ret >=0?'+':'') +ann_ret.toFixed(1)+'%'  : '—', retCol)
  + kpi('Volatility',     ann_vol  != null ? ann_vol.toFixed(1)+'%'                         : '—', 'var(--am)', 'annual')
  + kpi('Sharpe Ratio',   sharpe   != null ? sharpe.toFixed(2)                              : '—', shrpCol, '>1 = good')
  + kpi('Max Drawdown',   mdd      != null ? mdd.toFixed(1)+'%'                             : '—', mddCol)
  + (beta    != null ? kpi('Beta vs SPX', beta.toFixed(2),    beta>1.2?'var(--re)':beta<0.8?'var(--gr)':'var(--am)') : '')
  + (sortino != null ? kpi('Sortino',  sortino.toFixed(2),  sortino>1.5?'var(--gr)':'var(--am)', 'downside') : '')
  + (calmar  != null ? kpi('Calmar',   calmar.toFixed(2),   calmar>1?'var(--gr)':'var(--am)', 'ret/MDD') : '');

  // ── Risk level badge ──────────────────────────────────────────────
  var riskLabelHtml = '<div class="port-risk-result-badge" style="border-color:'+riskColor+';color:'+riskColor+'">'
    + info.label + ' · Risk Level ' + PORT.riskLevel + '/5'
    + '</div>';
  if (kpis) kpis.insertAdjacentHTML('afterbegin', riskLabelHtml);

  // ── Donut chart ───────────────────────────────────────────────────
  _portDrawDonut(holdings);

  // ── NAV chart ─────────────────────────────────────────────────────
  var nav = r.portfolio_nav || r.nav || [];
  if (nav.length >= 2) {
    var navCanvas = document.getElementById('qchart-port');
    if (navCanvas) {
      navCanvas.width  = navCanvas.offsetWidth || 400;
      navCanvas.height = 130;
      drawQuantChart(navCanvas.getContext('2d'), nav, {
        W: navCanvas.width, H: 130,
        lineColor: riskColor,
        fillTop:   riskColor + '33',
        fillBot:   riskColor + '00',
        showGrid: true, showLabels: true,
      });
    }
  }

  // Scroll to results
  resEl.scrollIntoView({ behavior:'smooth', block:'nearest' });
}

// ── Donut chart ──────────────────────────────────────────────────────
function _portDrawDonut(holdings) {
  var canvas = document.getElementById('port-donut-canvas');
  var legend = document.getElementById('port-donut-legend');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var cx = 75, cy = 75, R = 60, r = 38;
  ctx.clearRect(0, 0, 150, 150);

  var total  = holdings.reduce(function(s,h){ return s+h.weight; }, 0) || 1;
  var angle  = -Math.PI / 2;
  var colors = [];
  var legendHtml = '';

  holdings.forEach(function(h, i) {
    // Determine color from allAssets category or risk level alloc
    var cat   = null;
    var alloc = PORT.allocation.find(function(a){ return a.symbol===h.symbol; });
    if (alloc) cat = alloc.cat;
    var col   = (cat && CAT_COLORS_PORT[cat]) || Object.values(CAT_COLORS_PORT)[i % Object.keys(CAT_COLORS_PORT).length];
    colors.push(col);

    var slice = (h.weight / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = 'rgba(6,11,24,.8)';
    ctx.lineWidth   = 1.5;
    ctx.stroke();
    angle += slice;

    var pct = (h.weight / total * 100).toFixed(0);
    legendHtml += '<div class="port-leg-row">'
      + '<span class="port-leg-dot" style="background:' + col + '"></span>'
      + '<span class="port-leg-sym">' + h.symbol + '</span>'
      + '<span class="port-leg-pct">' + pct + '%</span>'
      + '</div>';
  });

  // Centre hole
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI*2);
  ctx.fillStyle = 'var(--bg1, #0B1120)';
  ctx.fill();

  // Centre label
  ctx.fillStyle = '#E2E8F0';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('Risk ' + PORT.riskLevel + '/5', cx, cy);

  if (legend) legend.innerHTML = legendHtml;
}

// ── Stress test ───────────────────────────────────────────────────────
async function portRunStressTest() {
  if (!PORT.results) { toast('Build portfolio first', 'e'); return; }
  var wrapEl = document.getElementById('port-stress-wrap');
  if (!wrapEl) return;
  wrapEl.style.display = 'block';
  wrapEl.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:12px 0">Running stress scenarios…</div>';

  // Use the current results to estimate stress impact
  var vol   = PORT.results.metrics ? PORT.results.metrics.annual_volatility : 15;
  var beta  = (PORT.results.metrics && PORT.results.metrics.beta) || 1;

  var scenarios = [
    { name:'Equity crash −20%',  shock: -20 * beta,       icon:'📉', desc:'S&P drops 20%' },
    { name:'Rate spike +200bps', shock: -8  * beta * 0.5, icon:'📈', desc:'10Y yield surges 2%' },
    { name:'Oil shock +50%',     shock: _oilShockImpact(),  icon:'⛽', desc:'Oil spikes 50%' },
    { name:'VIX spike to 40',    shock: -(vol/15) * 8,    icon:'😱', desc:'Fear index doubles' },
    { name:'USD surge +10%',     shock: _usdShockImpact(),  icon:'💵', desc:'Dollar strengthens 10%' },
  ];

  var html = '<div class="port-stress-title">Stress Scenarios</div>'
    + '<div class="port-stress-grid">';
  scenarios.forEach(function(s) {
    var shock = parseFloat(s.shock.toFixed(1));
    var col   = shock < -15 ? 'var(--re)' : shock < -5 ? 'var(--am)' : 'var(--gr)';
    html += '<div class="port-stress-card">'
      + '<div class="port-stress-icon">' + s.icon + '</div>'
      + '<div class="port-stress-name">' + s.name + '</div>'
      + '<div class="port-stress-val" style="color:' + col + '">'
      + (shock >= 0 ? '+' : '') + shock.toFixed(1) + '%</div>'
      + '<div class="port-stress-desc">' + s.desc + '</div>'
      + '</div>';
  });
  wrapEl.innerHTML = html + '</div>';
}

function _oilShockImpact() {
  // Check if portfolio has energy exposure
  var alloc = PORT.mode === 'auto' ? PORT.allocation : MKT.portfolio.map(function(h){ return { symbol:h.symbol, weight:h.weight, cat:null }; });
  var energyWeight = alloc.filter(function(a){ return a.symbol==='CL=F'||a.symbol==='XLE'||a.cat==='commodity'; })
                          .reduce(function(s,a){ return s+a.weight; }, 0);
  var totalW = alloc.reduce(function(s,a){ return s+a.weight; }, 0) || 100;
  return (energyWeight / totalW) * 30 - (1 - energyWeight/totalW) * 5;
}

function _usdShockImpact() {
  var alloc  = PORT.mode === 'auto' ? PORT.allocation : MKT.portfolio;
  var intlW  = alloc.filter(function(a){ return ['EEM','^HSI','^N225','^DAX','EURUSD=X'].includes(a.symbol); })
                    .reduce(function(s,a){ return s+a.weight; }, 0);
  var totalW = alloc.reduce(function(s,a){ return s+a.weight; }, 0) || 100;
  return -(intlW / totalW) * 8;
}

// ── AI narrative ──────────────────────────────────────────────────────
async function portGetAINarrative() {
  if (!PORT.results) { toast('Build portfolio first', 'e'); return; }
  var el_ = document.getElementById('port-ai-narrative');
  if (!el_) return;
  el_.style.display = 'block';
  el_.innerHTML = '<span class="aiload"><span class="ald"></span><span class="ald"></span><span class="ald"></span> Generating analysis…</span>';

  var m       = PORT.results.metrics || {};
  var info    = PORT_RISK_LEVELS[PORT.riskLevel];
  var symbols = (PORT.mode==='auto' ? PORT.allocation : MKT.portfolio)
                .map(function(a){ return a.symbol; }).slice(0,8).join(', ');

  var prompt = 'You are a financial analyst. In 3 concise sentences, assess this investment portfolio:\n'
    + 'Risk Level: ' + PORT.riskLevel + '/5 (' + info.label + ')\n'
    + 'Holdings: ' + symbols + '\n'
    + 'Metrics: Expected Return ' + (m.annual_return||m.annualized_return||'?') + '%, '
    + 'Volatility ' + (m.annual_volatility||m.annualized_volatility||'?') + '%, '
    + 'Sharpe ' + (m.sharpe_ratio||'?') + ', Max Drawdown ' + (m.max_drawdown||'?') + '%\n'
    + 'Comment on: suitability for the risk level, diversification quality, and one actionable improvement.';

  var r = await rq('/api/events/ai/ask', { method:'POST', body:{ prompt:prompt, context:'' } });
  el_.innerHTML = (r && r.answer)
    ? '<div class="port-ai-icon">🤖</div><div>' + r.answer + '</div>'
    : '<div style="color:var(--t3);font-size:11px">AI analysis requires a configured AI provider (Admin → Settings).</div>';
}

// ── Export CSV ────────────────────────────────────────────────────────
function portExportCSV() {
  var holdings = PORT.mode==='auto' ? PORT.allocation : MKT.portfolio;
  if (!holdings.length) { toast('Build portfolio first','e'); return; }
  var m = PORT.results && PORT.results.metrics ? PORT.results.metrics : {};
  var csv = 'Symbol,Name,Weight(%),Category\n';
  holdings.forEach(function(h) {
    csv += [h.symbol, (h.name||h.symbol), h.weight, (h.cat||'')].join(',') + '\n';
  });
  csv += '\nMetric,Value\n';
  if (m.annual_return   != null) csv += 'Annual Return (%),' + m.annual_return.toFixed(2) + '\n';
  if (m.annual_volatility!= null)csv += 'Volatility (%),'   + m.annual_volatility.toFixed(2) + '\n';
  if (m.sharpe_ratio    != null) csv += 'Sharpe Ratio,'      + m.sharpe_ratio.toFixed(3) + '\n';
  if (m.max_drawdown    != null) csv += 'Max Drawdown (%),'  + m.max_drawdown.toFixed(2) + '\n';
  csv += 'Risk Level,' + PORT.riskLevel + '/5\n';
  csv += 'Mode,' + PORT.mode + '\n';

  var blob = new Blob([csv], {type:'text/csv'});
  var a    = document.createElement('a');
  a.href   = URL.createObjectURL(blob);
  a.download = 'worldlens_portfolio_risk' + PORT.riskLevel + '_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

// Back-compat functions
function exportPortfolio(fmt) { if (fmt==='csv') portExportCSV(); }
function portCustomizeAllocation() { portSetMode('custom', document.getElementById('port-mode-custom')); }
function portApplyAllocation() { portBuild(); }

// ── Init: called when portfolio tab opens ────────────────────────────
function initPortfolioTab() {
  portRiskChange(PORT.riskLevel, null);
  // Pre-populate portfolio selector if not done
  var sel = document.getElementById('port-add-sym');
  if (sel && sel.options.length <= 1 && MKT.allAssets.length) {
    MKT.allAssets.forEach(function(a) {
      var o = document.createElement('option');
      o.value = a.symbol;
      o.textContent = a.symbol + ' — ' + a.name;
      sel.appendChild(o);
    });
  }
}

// Hook into setQuantTab
var _sqtOrig13 = (typeof setQuantTab === 'function') ? setQuantTab : null;
if (typeof setQuantTab === 'function') {
  var __sqt13base = setQuantTab;
  setQuantTab = function(tab, btn) {
    __sqt13base(tab, btn);
    if (tab === 'portfolio') {
      setTimeout(initPortfolioTab, 80);
    }
  };
}

/* ═══════════ 05_markets.js ═══════════ */
/**
 * @file 05_markets.js
 * @module WorldLens/Quantitative Markets Lab
 *
 * @description
 * Full markets engine: asset sidebar, ticker loading, 7-tab quant lab.
 * Pure Canvas 2D charts (price, drawdown, vol, forecast, backtest).
 * Monte Carlo GBM, PCA (power method), factor regression, portfolio analytics.
 * All math is pure JS — no NumPy/pandas.
 *
 * @dependencies 01_globals.js, 02_core.js
 * @exports selectMktAsset, setMktTF, setQuantTab, renderChartTab, runForecast, runBacktest, loadFactorAnalysis, runPortfolio, runPCA, drawQuantChart, drawForecastChart
 */


// ════════════════════════════════════════════════════════
// ADVANCED MARKETS ENGINE
// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
// QUANTITATIVE LAB — JavaScript Engine
// Pure math: no AI predictions. GBM, PCA, Regression, Backtest.
// ════════════════════════════════════════════════════════

var MKT = {
  mode:        'beginner',
  tab:         'chart',
  symbol:      null,
  name:        null,
  allAssets:   [],
  ticker:      null,
  chartData:   [],
  chartTF:     '1M',
  chartCtx:    null,
  corrsLoaded: false,
  // Quant state
  qmetrics:    null,
  forecast:    null,
  fcHorizon:   21,
  btPeriod:    '2y',
  portfolio:   [],   // [{symbol,name,weight}]
};

var MKT_CAT_COLORS = {
  index:    '#60A5FA',
  etf:      '#34D399',
  bond:     '#A78BFA',
  commodity:'#F59E0B',
  forex:    '#06B6D4',
  crypto:   '#EC4899',
  stock:    '#F97316',
};
var MKT_CAT_LABELS = {
  index:'Indices', etf:'ETFs', bond:'Bonds/Rates',
  commodity:'Commodities', forex:'Forex', crypto:'Crypto', stock:'Stocks',
};
// Interactive chart state
var CHART_STATE = {
  hoverIdx:   -1,
  prices:     [],
  dates:      [],
  events:     [],
  canvas:     null,
  overlayCtx: null,
  animFrame:  null,
};

// ── Sidebar & Asset selection ─────────────────────────

async function initMarkets() {
  if (MKT.allAssets.length) {
    renderMktSidebar();
    _startPriceRefresh();
    return;
  }
  var r = await rq('/api/markets/universe');
  if (r && r.assets) {
    MKT.allAssets = r.assets;
  } else if (G.finance && G.finance.length) {
    MKT.allAssets = G.finance.map(function(a) {
      return { symbol:a.symbol, name:a.name, price:a.price,
               change_pct:a.change_pct, change_abs:a.change_abs, category:a.category || 'stock' };
    });
  }
  // Merge any live prices from G.finance into allAssets
  _mergeLivePrices();
  renderMktSidebar();
  loadMktTrending();
  _startPriceRefresh();
  // Populate portfolio asset selector
  var sel = document.getElementById('port-add-sym');
  if (sel) {
    sel.innerHTML = '<option value="">Add asset…</option>';
    MKT.allAssets.forEach(function(a) {
      var o = document.createElement('option');
      o.value = a.symbol; o.textContent = a.symbol + ' — ' + a.name;
      sel.appendChild(o);
    });
  }
}

function _mergeLivePrices() {
  if (!G.finance || !G.finance.length) return;
  var liveMap = {};
  G.finance.forEach(function(a){ liveMap[a.symbol] = a; });
  MKT.allAssets.forEach(function(a) {
    var live = liveMap[a.symbol];
    if (live) {
      if (live.price      != null) a.price      = live.price;
      if (live.change_pct != null) a.change_pct = live.change_pct;
      if (live.change_abs != null) a.change_abs = live.change_abs;
    }
  });
}

var _priceRefreshTimer = null;
function _startPriceRefresh() {
  if (_priceRefreshTimer) return;
  // Refresh sidebar prices every 60 seconds
  _priceRefreshTimer = setInterval(async function() {
    var r = await rq('/api/markets/universe');
    if (r && r.assets) {
      // Merge prices into existing allAssets (preserving other fields)
      var map = {};
      r.assets.forEach(function(a){ map[a.symbol] = a; });
      MKT.allAssets.forEach(function(a) {
        var fresh = map[a.symbol];
        if (fresh) {
          if (fresh.price      != null) a.price      = fresh.price;
          if (fresh.change_pct != null) a.change_pct = fresh.change_pct;
          if (fresh.change_abs != null) a.change_abs = fresh.change_abs;
        }
      });
      _renderSidebarPricesOnly();
      // Also refresh current ticker header if we have one open
      if (MKT.symbol) _refreshCurrentTickerHeader();
    }
  }, 60000);
}

function _renderSidebarPricesOnly() {
  // Update just the price/change cells without rebuilding the DOM
  document.querySelectorAll('.mkt-asset-row').forEach(function(row) {
    var sym  = row.dataset.sym;
    if (!sym) return;
    var asset = MKT.allAssets.find(function(a){ return a.symbol===sym; });
    if (!asset) return;
    var priceEl = row.querySelector('.mkt-asset-price');
    var chgEl   = row.querySelector('.mkt-asset-chg');
    if (priceEl && asset.price != null) priceEl.textContent = fmtP(sym, asset.price);
    if (chgEl   && asset.change_pct != null) {
      var up = asset.change_pct >= 0;
      chgEl.textContent = (up?'+':'') + asset.change_pct.toFixed(2) + '%';
      chgEl.style.color = up ? 'var(--gr)' : 'var(--re)';
    }
  });
}

async function _refreshCurrentTickerHeader() {
  if (!MKT.symbol || !MKT.ticker) return;
  // Quick re-fetch just the latest price
  var r = await rq('/api/markets/ticker/' + encodeURIComponent(MKT.symbol) + '?period=5d');
  if (!r || r.price == null) return;
  setEl('mkt-t-price', fmtP(MKT.symbol, r.price));
  var up = r.change_pct >= 0;
  var chgEl = el('mkt-t-chg');
  if (chgEl) {
    chgEl.textContent = (up?'+':'') + (r.change_pct||0).toFixed(2) + '%';
    chgEl.style.color = up ? 'var(--gr)' : 'var(--re)';
  }
  // Update stored ticker
  if (r.price) MKT.ticker.price = r.price;
  if (r.change_pct != null) MKT.ticker.change_pct = r.change_pct;
}

function renderMktSidebar() {
  var wlSyms = (G.watchlist || []).filter(function(w){return w.type==='asset';}).map(function(w){return w.value;});
  var wlAssets = MKT.allAssets.filter(function(a){ return wlSyms.indexOf(a.symbol) > -1; });
  var wlEl = el('mkt-wl-list');
  if (wlEl) wlEl.innerHTML = wlAssets.map(mktAssetRowHtml).join('') ||
    '<div style="font-size:11px;color:var(--t4);padding:6px 8px">No watchlist assets</div>';

  // Group all assets by category
  var groups = {};
  MKT.allAssets.forEach(function(a) {
    var cat = a.category || 'stock';
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(a);
  });

  // Render grouped list with collapsible sections
  var CAT_ORDER = ['index','etf','bond','commodity','forex','crypto','stock'];
  var html = '';
  CAT_ORDER.forEach(function(cat) {
    var assets = groups[cat];
    if (!assets || !assets.length) return;
    var col   = MKT_CAT_COLORS[cat] || '#94A3B8';
    var label = MKT_CAT_LABELS[cat] || cat;
    html += '<div class="mkt-cat-group">';
    html += '<div class="mkt-cat-header" onclick="toggleMktCatGroup(this)" data-cat="' + cat + '">'
      + '<span class="mkt-cat-dot" style="background:' + col + '"></span>'
      + '<span>' + label + '</span>'
      + '<span class="mkt-cat-count">' + assets.length + '</span>'
      + '<span class="mkt-cat-chevron">▾</span>'
      + '</div>';
    html += '<div class="mkt-cat-list" id="mkt-cat-' + cat + '">'
      + assets.map(mktAssetRowHtml).join('')
      + '</div>';
    html += '</div>';
  });

  var allEl = el('mkt-all-list');
  if (allEl) allEl.innerHTML = html;
  var countEl = el('mkt-asset-count');
  if (countEl) countEl.textContent = MKT.allAssets.length + ' instruments';

  document.querySelectorAll('.mkt-asset-row').forEach(function(row) {
    row.onclick = function() { selectMktAsset(this.dataset.sym, this.dataset.name); };
  });
}

function toggleMktCatGroup(header) {
  var cat  = header.dataset.cat;
  var list = document.getElementById('mkt-cat-' + cat);
  if (!list) return;
  var isOpen = list.style.display !== 'none';
  list.style.display = isOpen ? 'none' : 'block';
  var chev = header.querySelector('.mkt-cat-chevron');
  if (chev) chev.textContent = isOpen ? '▸' : '▾';
}

function mktAssetRowHtml(a) {
  var up     = (a.change_pct||0) >= 0;
  var col    = up ? 'var(--gr)' : 'var(--re)';
  var chg    = (a.change_pct != null) ? (up?'+':'')+a.change_pct.toFixed(2)+'%' : '';
  var price  = (a.price      != null) ? fmtP(a.symbol, a.price)                 : '';
  var catCol = MKT_CAT_COLORS[a.category] || '#94A3B8';
  var isActive = MKT.symbol === a.symbol;
  return '<div class="mkt-asset-row'+(isActive?' active':'')
    + '" data-sym="'+a.symbol+'" data-name="'+a.name
    + '" style="border-left:2px solid '+(isActive?catCol:'transparent')+'">'
    + '<span class="mkt-asset-sym" style="color:'+catCol+'">'+a.symbol+'</span>'
    + '<span class="mkt-asset-name">'+a.name+'</span>'
    + '<div style="text-align:right;line-height:1.3;min-width:56px">'
    + '<div class="mkt-asset-price" style="font-size:10px;font-weight:700;color:var(--t1)">' + price + '</div>'
    + '<div class="mkt-asset-chg" style="font-size:9px;color:'+col+'">' + chg + '</div>'
    + '</div>'
    + '</div>';
}

function filterMktAssets(q) {
  if (!q) { renderMktSidebar(); return; }
  var ql = q.toLowerCase().trim();

  // Detect ISIN (12 chars, starts with 2 letters)
  var isIsin = /^[A-Z]{2}[A-Z0-9]{10}$/i.test(ql);
  if (isIsin) {
    // Search via API for ISIN
    rq('/api/markets/search?isin=' + encodeURIComponent(q.toUpperCase())).then(function(r) {
      var results = r && r.results ? r.results : [];
      _renderSearchResults(results, 'ISIN: ' + q.toUpperCase());
    });
    return;
  }

  // Local fast search first
  var filtered = MKT.allAssets.filter(function(a) {
    return (a.symbol + ' ' + a.name + ' ' + (a.category||'')).toLowerCase().includes(ql);
  });

  if (filtered.length) {
    _renderSearchResults(filtered, null);
  } else {
    // Fallback to API search (for symbols not yet in allAssets)
    rq('/api/markets/search?q=' + encodeURIComponent(q)).then(function(r) {
      var results = r && r.results ? r.results : [];
      _renderSearchResults(results, null);
    });
  }
}

function _renderSearchResults(assets, label) {
  var allEl = el('mkt-all-list');
  if (!allEl) return;
  if (!assets.length) {
    allEl.innerHTML = '<div style="padding:12px 8px;font-size:11px;color:var(--t3)">'
      + 'No results. Try a ticker symbol, company name, or ISIN.</div>';
    return;
  }
  var header = label ? '<div class="mkt-section-lbl" style="color:var(--b4)">' + label + '</div>' : '';
  allEl.innerHTML = header + assets.map(mktAssetRowHtml).join('');
  document.querySelectorAll('#mkt-all-list .mkt-asset-row').forEach(function(row) {
    row.onclick = function() { selectMktAsset(this.dataset.sym, this.dataset.name); };
  });
}

async function loadMktTrending() {
  var r = await rq('/api/markets/trending');
  if (!r || !r.assets) return;
  el('mkt-trending').innerHTML = r.assets.slice(0, 5).map(mktAssetRowHtml).join('');
  document.querySelectorAll('#mkt-trending .mkt-asset-row').forEach(function(row) {
    row.onclick = function() { selectMktAsset(this.dataset.sym, this.dataset.name); };
  });
}

function setMktMode(mode, btn) {
  MKT.mode = mode;
  document.querySelectorAll('.mkt-mode-btn').forEach(function(b){b.classList.remove('active');});
  if (btn) btn.classList.add('active');
}

// ── Asset selection: load ticker + kick off quant pipeline ──

async function selectMktAsset(symbol, name) {
  track('asset_viewed', 'markets', (arguments[0]&&arguments[0].symbol)||String(arguments[0]||''));
  _evMarkersCache = {};   // clear marker cache for new symbol
  MKT.symbol = symbol;
  MKT.name   = name || symbol;
  MKT.qmetrics  = null;
  MKT.forecast  = null;
  MKT.corrsLoaded = false;

  el('mkt-empty').style.display = 'none';
  // Load asset drivers ("Why it moved")
  var _asset = G.finance && G.finance.find(function(a){ return a.symbol===symbol||a.name===symbol; });
  if (_asset) loadAssetDrivers(symbol, _asset.change_pct || 0);
  el('mkt-ticker-content').style.display = 'flex';

  // Highlight sidebar
  document.querySelectorAll('.mkt-asset-row').forEach(function(r){r.classList.remove('active');});
  var activeRow = document.querySelector('[data-sym="'+symbol+'"]');
  if (activeRow) activeRow.classList.add('active');

  // Reset tabs
  setQuantTab('chart', document.querySelector('.qlab-tab[data-tab="chart"]'));

  // Show loading header
  setEl('mkt-t-name', name || symbol);
  setEl('mkt-t-sym', symbol);
  setEl('mkt-t-price', '…');
  setEl('mkt-t-chg', '');
  if (el('qchart-sym')) el('qchart-sym').textContent = symbol;
  if (el('fc-asset-name')) el('fc-asset-name').textContent = name || symbol;

  // Fetch ticker history
  var period = MKT.chartTF === '1M' ? '3mo' : MKT.chartTF === '3M' ? '6mo' : '2y';
  var tdata = await rq('/api/markets/ticker/' + encodeURIComponent(symbol) + '?period=' + period);
  MKT.ticker    = tdata;
  MKT.chartData  = (tdata && (tdata.prices_full || tdata.prices)) || [];
  MKT.chartDates = (tdata && (tdata.price_dates_full || tdata.price_dates)) || [];

  if (tdata && tdata.price != null) {
    setEl('mkt-t-price', fmtP(symbol, tdata.price));
    var up = tdata.change_pct >= 0;
    var chgEl = el('mkt-t-chg');
    if (chgEl) {
      chgEl.textContent = (up?'+':'')+tdata.change_pct.toFixed(2)+'%';
      chgEl.style.color = up ? 'var(--gr)' : 'var(--re)';
    }
    if (tdata.region) setEl('mkt-t-region', tdata.region);
    // change_abs
    var absEl = el('mkt-t-abs');
    if (absEl && tdata.change_abs != null) {
      absEl.textContent = (tdata.change_abs >= 0 ? '+' : '') + tdata.change_abs.toFixed(2);
      absEl.style.color  = tdata.change_abs >= 0 ? 'var(--gr)' : 'var(--re)';
    }
    // Perf pills
    var perf = tdata.perf || {};
    var pillsData = [
      ['1D', perf.d1], ['1W', perf.w1], ['1M', perf.m1]
    ];
    // Add 52w hi/lo if available
    var high52 = tdata.high_52w, low52 = tdata.low_52w;
    var pillHtml = pillsData.map(function(p) {
      if (p[1] == null) return '';
      var up2 = p[1] >= 0;
      return '<span class="mkt-perf-pill" style="color:'+(up2?'var(--gr)':'var(--re)')+'">'+p[0]+' '+(up2?'+':'')+p[1].toFixed(2)+'%</span>';
    }).join('');
    if (high52 != null && low52 != null) {
      pillHtml += '<span class="mkt-perf-pill" style="color:var(--t3);font-size:9px">52w '
        + fmtP(symbol,low52) + '–' + fmtP(symbol,high52) + '</span>';
    }
    var pillEl = el('mkt-t-pills');
    if (pillEl) pillEl.innerHTML = pillHtml;
  }

  // Render chart tab
  renderChartTab(tdata);

  // Load technicals for chart tab
  if (tdata && tdata.rsi !== undefined) renderMktTechnicals(tdata);

  // Load related events
  loadMktEvents();

  // Track
  rq('/api/portfolio/track', {method:'POST', body:{action:'market_view'}});
  // Price alert check
  setTimeout(function(){ if (typeof _checkPriceAlerts==='function') _checkPriceAlerts(); }, 500);
}

// ── Tab controller ────────────────────────────────────

function setQuantTab(tab, btn) {
  MKT.tab = tab;
  document.querySelectorAll('.qlab-tab').forEach(function(b){b.classList.remove('on');});
  document.querySelectorAll('.qlab-panel').forEach(function(p){p.classList.remove('on');});
  if (btn) btn.classList.add('on');
  var panel = el('qtab-' + tab);
  if (panel) panel.classList.add('on');

  // Lazy-load tab content
  if (!MKT.symbol) return;
  if (tab === 'metrics'  && !MKT.qmetrics)   loadQuantMetrics();
  if (tab === 'forecast' && !MKT.forecast)    runForecast();
  if (tab === 'factor')                        loadFactorAnalysis();
  if (tab === 'backtest')                      runBacktest();
}

// ── CHART TAB ────────────────────────────────────────

async function renderChartTab(tdata) {
  var prices = getChartPrices(MKT.chartData, MKT.chartTF);
  var dates  = getMktDates(MKT.chartData, MKT.chartTF);  // aligned date array
  if (prices.length < 2) return;

  // Store in CHART_STATE for interactivity
  CHART_STATE.prices = prices;
  CHART_STATE.dates  = dates;
  CHART_STATE.hoverIdx = -1;

  var canvas = el('mkt-price-chart');
  if (!canvas) return;
  var W = canvas.offsetWidth || canvas.parentElement.offsetWidth || 700;
  canvas.width = W; canvas.height = 220;
  CHART_STATE.canvas = canvas;
  var ctx = canvas.getContext('2d');
  CHART_STATE.ctx = ctx;

  // Fetch asset-specific event markers (async, non-blocking)
  var evMarkers = _buildChartEventMarkers(prices, dates); // from cache (may be empty initially)
  _fetchEventMarkersForChart(MKT.symbol, dates, prices).then(function(freshMarkers) {
    evMarkers = freshMarkers;
    redraw();
    _renderEventsTimeline(freshMarkers, dates, prices);
  });

  function redraw() {
    drawQuantChart(ctx, prices, {
      W: W, H: 220,
      lineColor: '#60A5FA',
      fillTop:   'rgba(59,130,246,.15)',
      fillBot:   'rgba(59,130,246,0)',
      showGrid: true, showLabels: true,
      dates: dates,
      events: evMarkers,
      interactive: true,
    });
  }
  redraw();

  // ── Mouse interactivity ──────────────────────────────────
  canvas.onmousemove = function(e) {
    var rect = canvas.getBoundingClientRect();
    var mx   = e.clientX - rect.left;
    // Map pixel x → data index
    var pad_left = 52, pad_right = 8;
    var cW = W - pad_left - pad_right;
    var raw = (mx - pad_left) / cW * (prices.length - 1);
    var idx = Math.max(0, Math.min(prices.length - 1, Math.round(raw)));
    if (idx !== CHART_STATE.hoverIdx) {
      CHART_STATE.hoverIdx = idx;
      _updateChartTooltipBar(idx, prices, dates);
      redraw();
    }
    canvas.style.cursor = 'crosshair';
  };
  canvas.onmouseleave = function() {
    CHART_STATE.hoverIdx = -1;
    _clearChartTooltipBar();
    redraw();
    canvas.style.cursor = 'default';
  };
  canvas.onclick = function(e) {
    // Click: open nearest event if there's one close
    var rect = canvas.getBoundingClientRect();
    var mx   = e.clientX - rect.left;
    var pad_left = 52, pad_right = 8, cW = W - pad_left - pad_right;
    var raw  = (mx - pad_left) / cW * (prices.length - 1);
    var idx  = Math.max(0, Math.min(prices.length - 1, Math.round(raw)));
    var near = evMarkers.filter(function(m){ return Math.abs(m.x_idx - idx) <= 2; })[0];
    if (near && near.ev) openEP(near.ev.id);
  };

  // ── Drawdown (interactive, synced with main chart) ─────────────
  var ddCanvas = el('qchart-dd');
  if (ddCanvas && prices.length > 2) {
    ddCanvas.width = ddCanvas.offsetWidth || W;
    ddCanvas.height = 80;
    var dd    = computeDrawdownSeries(prices);
    var ddCtx = ddCanvas.getContext('2d');
    function _ddRedraw() {
      drawQuantChart(ddCtx, dd, {
        W: ddCanvas.width, H: 80,
        lineColor: '#EF4444', fillTop: 'rgba(239,68,68,.15)', fillBot: 'rgba(239,68,68,0)',
        minVal: Math.min.apply(null,dd)*1.05, maxVal: 0,
        dates: dates, showLabels: true, interactive: true,
      });
    }
    _ddRedraw();
    ddCanvas.onmousemove = function(e) {
      var rect = ddCanvas.getBoundingClientRect();
      var idx  = Math.max(0, Math.min(dd.length-1,
        Math.round((e.clientX - rect.left - 52) / (ddCanvas.width - 60) * (dd.length - 1))));
      CHART_STATE.hoverIdx = idx;
      _ddRedraw();
      // Sync main chart crosshair
      if (CHART_STATE.ctx && CHART_STATE.prices.length) {
        drawQuantChart(CHART_STATE.ctx, CHART_STATE.prices, {
          W: CHART_STATE.canvas.width, H: 220,
          lineColor: '#60A5FA', fillTop:'rgba(59,130,246,.15)', fillBot:'rgba(59,130,246,0)',
          showGrid:true, showLabels:true, dates:dates, interactive:true,
          events: _buildChartEventMarkers(CHART_STATE.prices, dates),
        });
      }
      _updateChartTooltipBar(idx, CHART_STATE.prices, dates);
    };
    ddCanvas.onmouseleave = function() {
      CHART_STATE.hoverIdx = -1;
      _ddRedraw();
      _clearChartTooltipBar();
    };
  }

    // ── Rolling vol ───────────────────────────────────────────
  var volCanvas = el('qchart-vol');
  if (volCanvas && prices.length > 22) {
    volCanvas.width = volCanvas.offsetWidth || W/2;
    volCanvas.height = 80;
    var rets = computeSimpleReturns(prices);
    var vols = computeRollingVol(rets, 20);
    var volDates = dates.slice(dates.length - vols.length);
    drawQuantChart(volCanvas.getContext('2d'), vols, {
      W: volCanvas.width, H: 80,
      lineColor: '#F59E0B', fillTop: 'rgba(245,158,11,.12)', fillBot: 'rgba(245,158,11,0)',
      dates: volDates, showLabels: true,
    });
  }

  // ── Returns histogram ─────────────────────────────────────
  var distCanvas = el('qchart-dist');
  if (distCanvas && prices.length > 5) {
    distCanvas.width = distCanvas.offsetWidth || W/2;
    distCanvas.height = 80;
    var rets2 = computeSimpleReturns(prices).map(function(r){return r*100;});
    drawHistogram(distCanvas.getContext('2d'), rets2, distCanvas.width, 80);
  }

  // AI summary (beginner mode)
  if (MKT.mode === 'beginner' && MKT.ticker) {
    rq('/api/markets/guided-analysis/' + encodeURIComponent(MKT.symbol), {method:'POST'}).then(function(r) {
      if (r && r.step1) setEl('mkt-step1-ai-txt', r.step1.summary || '');
    });
  }

  // ── Volume bar chart ─────────────────────────────────────
  var volBars = (tdata && (tdata.volumes || []));
  var volPrices = getChartPrices(volBars, MKT.chartTF);
  if (volPrices.length >= 2) {
    var volCanvas = document.getElementById('mkt-volume-chart');
    if (volCanvas) {
      volCanvas.width  = volCanvas.offsetWidth || W;
      volCanvas.height = 40;
      var vCtx = volCanvas.getContext('2d');
      _drawVolumeChart(vCtx, volPrices, prices, volCanvas.width, 40, dates);
    }
  }

  // ── Events timeline strip (under chart) ──────────────
  _renderEventsTimeline(evMarkers, dates, prices);

  // ResizeObserver: redraw chart on container resize
  if (window.ResizeObserver && canvas) {
    if (CHART_STATE._resizeObs) CHART_STATE._resizeObs.disconnect();
    CHART_STATE._resizeObs = new ResizeObserver(function() {
      var newW = canvas.offsetWidth;
      if (newW && newW !== canvas.width) {
        canvas.width = newW;
        renderChartTab(MKT.ticker);
      }
    });
    CHART_STATE._resizeObs.observe(canvas.parentElement);
  }
}

// Get date array aligned to chart prices — uses real API dates when available
function getMktDates(chartData, tf) {
  if (!chartData || !chartData.length) return [];
  var n   = chartData.length;
  var now = new Date();

  // Primary: use actual API-returned dates (most accurate)
  var allDates = MKT.chartDates || [];
  if (allDates.length >= n) {
    // Trim same way as getChartPrices
    var sliceN = tf === '1M' ? 22 : tf === '3M' ? 66 : tf === '1Y' ? 252 : n;
    return allDates.slice(-Math.min(sliceN, allDates.length));
  }

  // Fallback: generate approximate trading-day dates backward from today
  var sliceN = tf === '1M' ? 22 : tf === '3M' ? 66 : tf === '1Y' ? 252 : n;
  var count  = Math.min(sliceN, n);
  var dates  = [];
  var d      = new Date(now);
  for (var i = 0; i < count; i++) {
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    dates.unshift(d.toISOString().split('T')[0]);
    d = new Date(d);
    d.setDate(d.getDate() - 1);
  }
  return dates;
}

// Event markers cache per symbol
var _evMarkersCache = {};

// Build event markers from the historical-events API (asset-specific, with market reaction)
// Falls back to G.events driver-keyword matching if API unavailable
async function _fetchEventMarkersForChart(symbol, dates, prices) {
  if (!symbol || !dates.length) return [];
  var cacheKey = symbol + '_' + MKT.chartTF;
  if (_evMarkersCache[cacheKey]) return _evMarkersCache[cacheKey];

  var markers = [];

  // Primary: dedicated historical-events API — event relevance scored per asset type
  try {
    var period = MKT.chartTF === 'ALL' ? '5y' : MKT.chartTF === '1Y' ? '2y' : '1y';
    var r = await rq('/api/markets/historical-events/' + encodeURIComponent(symbol) + '?period=' + period + '&min_severity=4.5&max_events=30');
    if (r && r.events && r.events.length) {
      r.events.forEach(function(ev) {
        var evDate = ev.date || '';
        if (!evDate) return;
        // Map to chart date index
        var bestIdx = -1, bestDiff = Infinity;
        dates.forEach(function(d, i) {
          var diff = Math.abs(new Date(d) - new Date(evDate));
          if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
        });
        if (bestIdx < 0 || bestDiff > 7 * 86400000) return;
        var rxn    = ev.market_reaction || {};
        var d1     = rxn.d1_return;
        var color  = ev.color || '#F59E0B';
        markers.push({
          x_idx:     bestIdx,
          color:     color,
          icon:      ev.icon || '📌',
          label:     (ev.title||'Event').slice(0, 40),
          category:  ev.category,
          d1_return: d1,
          d5_return: rxn.d5_return,
          ev:        ev,
          // Taller marker for bigger market moves
          prominent: Math.abs(d1||0) > 1.5 || ev.severity >= 7,
        });
      });
      _evMarkersCache[cacheKey] = markers;
      return markers;
    }
  } catch(e) {}

  // Fallback: driver keyword matching from G.events
  var asset   = MKT.allAssets && MKT.allAssets.find(function(a){return a.symbol===symbol;});
  var drivers = asset ? (asset.drivers || []) : [];
  if (drivers.length) {
    (G.events || []).filter(function(ev) {
      var t = (ev.title+' '+(ev.summary||'')).toLowerCase();
      return drivers.some(function(d){return t.includes(d.toLowerCase());});
    }).slice(0, 20).forEach(function(ev) {
      var evDate = ev.timestamp ? ev.timestamp.split('T')[0] : '';
      if (!evDate) return;
      var bestIdx = -1, bestDiff = Infinity;
      dates.forEach(function(d, i) {
        var diff = Math.abs(new Date(d) - new Date(evDate));
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      });
      if (bestIdx < 0 || bestDiff > 7 * 86400000) return;
      var m = (typeof CATS !== 'undefined' && CATS[ev.category]) ? CATS[ev.category] : null;
      markers.push({
        x_idx: bestIdx, color: m ? m.c : '#F59E0B',
        label: ev.title.slice(0,40), ev:ev, prominent:false,
      });
    });
  }
  _evMarkersCache[cacheKey] = markers;
  return markers;
}

// Sync version for initial draw (uses cached or empty)
function _buildChartEventMarkers(prices, dates) {
  var cacheKey = (MKT.symbol||'?') + '_' + MKT.chartTF;
  return _evMarkersCache[cacheKey] || [];
}

// Update the hover info bar below the chart
function _updateChartTooltipBar(idx, prices, dates) {
  var bar = document.getElementById('chart-hover-bar');
  if (!bar) return;
  var price  = prices[idx];
  var date   = dates[idx] || '';
  var prev   = idx > 0 ? prices[idx-1] : price;
  var chg    = prev ? (price - prev) / prev * 100 : 0;
  var col    = chg >= 0 ? 'var(--gr)' : 'var(--re)';
  var dateStr = date;
  try {
    var dt = new Date(date);
    if (!isNaN(dt.getTime())) dateStr = dt.toLocaleDateString('en', {weekday:'short',month:'short',day:'numeric',year:'numeric'});
  } catch(e){}
  bar.style.display = 'flex';
  bar.innerHTML =
    '<span style="color:var(--t3);font-size:9px">' + dateStr + '</span>' +
    '<span style="font-size:12px;font-weight:700;font-family:var(--fh)">' + fmtP(MKT.symbol, price) + '</span>' +
    '<span style="color:'+col+';font-size:10px;font-weight:600">' + (chg>=0?'+':'') + chg.toFixed(2)+'%</span>';
}
function _clearChartTooltipBar() {
  var bar = document.getElementById('chart-hover-bar');
  if (bar) bar.style.display = 'none';
}


function getChartPrices(data, tf) {
  if (!data || !data.length) return [];
  var n = tf === '1M' ? 22 : tf === '3M' ? 66 : data.length;
  return data.slice(-n);
}

function setMktTF(tf, btn) {
  MKT.chartTF = tf;
  document.querySelectorAll('.mkt-tf-btn').forEach(function(b){b.classList.remove('on');});
  if (btn) btn.classList.add('on');
  if (!MKT.symbol) return;
  // Re-fetch wider period for 1Y / ALL to get full date history
  if (tf === '1Y' || tf === 'ALL') {
    var period = tf === '1Y' ? '2y' : '5y';
    rq('/api/markets/ticker/' + encodeURIComponent(MKT.symbol) + '?period=' + period).then(function(tdata) {
      if (tdata) {
        MKT.ticker     = tdata;
        MKT.chartData  = (tdata.prices_full || tdata.prices) || [];
        MKT.chartDates = (tdata.price_dates_full || tdata.price_dates) || [];
      }
      renderChartTab(MKT.ticker);
    });
  } else {
    renderChartTab(MKT.ticker);
  }
}

// ── Pure-JS chart renderer ────────────────────────────

function drawQuantChart(ctx, data, opts) {
  var W = opts.W || 600, H = opts.H || 200;
  var lineColor  = opts.lineColor  || '#60A5FA';
  var fillTop    = opts.fillTop    || 'rgba(59,130,246,.15)';
  var fillBot    = opts.fillBot    || 'rgba(59,130,246,0)';
  var showGrid   = opts.showGrid   !== false;
  var showLabels = opts.showLabels !== false;
  var dates      = opts.dates      || [];   // array of date strings aligned to data
  var events     = opts.events     || [];   // array of {x_idx, color, label}
  var interactive= opts.interactive === true;

  ctx.clearRect(0, 0, W, H);
  if (!data || data.length < 2) {
    ctx.fillStyle = 'rgba(148,163,184,.3)';
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('No data', W/2, H/2); return;
  }

  // Dynamic bottom padding based on whether we show dates
  var showDateAxis = showLabels && dates.length > 1;
  var pad = {
    top:    10,
    right:  8,
    bottom: showLabels ? (showDateAxis ? 36 : 22) : 4,
    left:   showLabels ? 52 : 4,
  };
  var cW = W - pad.left - pad.right;
  var cH = H - pad.top  - pad.bottom;

  var minVal = opts.minVal !== undefined ? opts.minVal : Math.min.apply(null, data);
  var maxVal = opts.maxVal !== undefined ? opts.maxVal : Math.max.apply(null, data);
  var range  = maxVal - minVal || 1;

  function xOf(i) { return pad.left + (i / (data.length - 1)) * cW; }
  function yOf(v) { return pad.top  + (1 - (v - minVal) / range) * cH; }

  // ── Grid ─────────────────────────────────────────────────
  if (showGrid) {
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    for (var gi = 0; gi <= 4; gi++) {
      var gy = pad.top + gi * cH / 4;
      ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
    }
    if (minVal < 0 && maxVal > 0) {
      var zy = yOf(0);
      ctx.strokeStyle = 'rgba(255,255,255,.12)';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(pad.left, zy); ctx.lineTo(W - pad.right, zy); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // ── Gradient fill ─────────────────────────────────────────
  var grad = ctx.createLinearGradient(0, pad.top, 0, H);
  grad.addColorStop(0, fillTop);
  grad.addColorStop(1, fillBot);
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(data[0]));
  for (var i = 1; i < data.length; i++) ctx.lineTo(xOf(i), yOf(data[i]));
  ctx.lineTo(xOf(data.length - 1), H - pad.bottom);
  ctx.lineTo(xOf(0), H - pad.bottom);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // ── Price line ────────────────────────────────────────────
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(data[0]));
  for (var i = 1; i < data.length; i++) ctx.lineTo(xOf(i), yOf(data[i]));
  ctx.strokeStyle = lineColor;
  ctx.lineWidth = 1.8;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // ── Y-axis labels ─────────────────────────────────────────
  if (showLabels) {
    ctx.fillStyle = 'rgba(148,163,184,.65)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    [0, 0.25, 0.5, 0.75, 1].forEach(function(t) {
      var v = minVal + t * range;
      var label = Math.abs(v) > 10000 ? (v/1000).toFixed(0)+'k'
                : Math.abs(v) > 1000  ? (v/1000).toFixed(1)+'k'
                : v.toFixed(v < 10 && v > -10 ? 2 : 1);
      ctx.fillText(label, pad.left - 4, pad.top + (1-t)*cH + 3);
    });
  }

  // ── X-axis date labels ────────────────────────────────────
  if (showDateAxis && dates.length > 1) {
    ctx.fillStyle = 'rgba(148,163,184,.6)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'center';
    var n = data.length;
    // Pick 5–7 evenly spaced tick positions
    var ticks = [];
    var numTicks = Math.min(7, Math.max(4, Math.floor(cW / 80)));
    for (var t = 0; t < numTicks; t++) {
      ticks.push(Math.round(t * (n - 1) / (numTicks - 1)));
    }
    ticks.forEach(function(idx) {
      var d = dates[idx] || '';
      // Format: show MM/DD or MMM YY depending on range
      var label = d;
      try {
        var dt = new Date(d);
        if (!isNaN(dt.getTime())) {
          if (n > 200) {
            // Long range: show Month + Year
            label = dt.toLocaleDateString('en', {month:'short', year:'2-digit'});
          } else {
            // Short range: show Month + Day
            label = dt.toLocaleDateString('en', {month:'short', day:'numeric'});
          }
        }
      } catch(e){}
      var x = xOf(idx);
      // Tick mark
      ctx.strokeStyle = 'rgba(255,255,255,.1)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, pad.top + cH);
      ctx.lineTo(x, pad.top + cH + 4);
      ctx.stroke();
      // Label
      ctx.fillStyle = 'rgba(148,163,184,.65)';
      ctx.fillText(label, x, H - 4);
    });
  }

  // ── Event markers on chart ────────────────────────────────
  if (events && events.length) {
    events.forEach(function(ev) {
      if (ev.x_idx < 0 || ev.x_idx >= data.length) return;
      var ex  = xOf(ev.x_idx);
      var ey  = yOf(data[ev.x_idx]);
      var col = ev.color || '#F59E0B';
      // Vertical dashed stem
      ctx.strokeStyle = col + '66';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex, pad.top + cH);
      ctx.stroke();
      ctx.setLineDash([]);
      // Diamond marker on price line
      ctx.fillStyle = col;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ex,      ey - 7);
      ctx.lineTo(ex + 5,  ey);
      ctx.lineTo(ex,      ey + 7);
      ctx.lineTo(ex - 5,  ey);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    });
  }

  // ── Interactive crosshair (drawn last so it's on top) ─────
  if (interactive && CHART_STATE.hoverIdx >= 0 && CHART_STATE.hoverIdx < data.length) {
    var hx  = xOf(CHART_STATE.hoverIdx);
    var hv  = data[CHART_STATE.hoverIdx];
    var hy  = yOf(hv);
    var col = lineColor;

    // Vertical hairline
    ctx.strokeStyle = 'rgba(255,255,255,.2)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top + cH); ctx.stroke();
    ctx.setLineDash([]);

    // Horizontal hairline
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.beginPath(); ctx.moveTo(pad.left, hy); ctx.lineTo(pad.left + cW, hy); ctx.stroke();

    // Dot on line
    ctx.beginPath();
    ctx.arc(hx, hy, 4, 0, Math.PI*2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Tooltip box (positioned to avoid edges)
    var label  = dates[CHART_STATE.hoverIdx] || '';
    try {
      var dt2 = new Date(label);
      if (!isNaN(dt2.getTime())) label = dt2.toLocaleDateString('en', {month:'short',day:'numeric',year:'numeric'});
    } catch(e){}
    var valStr = Math.abs(hv) > 10000 ? (hv/1000).toFixed(1)+'k' : hv.toFixed(2);
    var line1  = valStr;
    var line2  = label;
    var boxW   = 90, boxH = 34;
    var bx     = hx + 8;
    var by     = Math.max(pad.top, hy - boxH/2);
    if (bx + boxW > W - pad.right) bx = hx - boxW - 8;
    if (by + boxH > pad.top + cH)  by = pad.top + cH - boxH;

    ctx.fillStyle = 'rgba(6,11,24,.92)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    _roundRect(ctx, bx, by, boxW, boxH, 4);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = col;
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(line1, bx + 7, by + 13);
    ctx.fillStyle = 'rgba(148,163,184,.8)';
    ctx.font = '9px monospace';
    ctx.fillText(line2, bx + 7, by + 26);
  }
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}


function drawHistogram(ctx, data, W, H) {
  ctx.clearRect(0, 0, W, H);
  if (!data.length) return;
  var bins = 24;
  var min = Math.min.apply(null, data), max = Math.max.apply(null, data);
  var bw = (max - min) / bins || 0.1;
  var counts = new Array(bins).fill(0);
  data.forEach(function(v) {
    var idx = Math.min(bins-1, Math.floor((v - min) / bw));
    counts[idx]++;
  });
  var maxC = Math.max.apply(null, counts) || 1;
  var barW = W / bins;
  var zeroX = (-min / ((max - min) || 1)) * W;

  counts.forEach(function(c, i) {
    var bh = (c / maxC) * (H - 4);
    var bx = i * barW;
    var col = (i * barW) < zeroX ? 'rgba(239,68,68,.7)' : 'rgba(16,185,129,.7)';
    ctx.fillStyle = col;
    ctx.fillRect(bx + 1, H - bh, barW - 2, bh);
  });

  // Zero line
  if (min < 0 && max > 0) {
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(zeroX, 0);
    ctx.lineTo(zeroX, H);
    ctx.stroke();
  }
}

// ── Quant math (client-side) ──────────────────────────

function computeSimpleReturns(prices) {
  var r = [];
  for (var i = 1; i < prices.length; i++) r.push(prices[i]/prices[i-1] - 1);
  return r;
}
function computeDrawdownSeries(prices) {
  var peak = prices[0], dd = [];
  for (var i = 0; i < prices.length; i++) {
    if (prices[i] > peak) peak = prices[i];
    dd.push(-(peak - prices[i]) / peak * 100);
  }
  return dd;
}
function computeRollingVol(rets, w) {
  var result = new Array(rets.length).fill(0);
  for (var i = w; i < rets.length; i++) {
    var slice = rets.slice(i-w, i);
    var mean = slice.reduce(function(a,b){return a+b;},0)/w;
    var vari = slice.reduce(function(a,v){return a+(v-mean)*(v-mean);},0)/(w-1);
    result[i] = Math.sqrt(vari) * Math.sqrt(252) * 100;
  }
  return result;
}

// ── METRICS TAB ──────────────────────────────────────

async function loadQuantMetrics() {
  var lb = el('qmetrics-loading'), body = el('qmetrics-body');
  if (!lb || !body) return;
  lb.style.display = 'block'; body.style.display = 'none';

  var r = await rq('/api/markets/quant/metrics/' + encodeURIComponent(MKT.symbol) + '?period=1y');
  MKT.qmetrics = r;
  if (!r || r.error) { lb.textContent = r && r.error ? r.error : 'Failed to load metrics'; return; }

  lb.style.display = 'none'; body.style.display = 'block';

  // KPI grid
  var kpis = [
    { label:'Ann. Return', val: (r.ann_return_pct >= 0 ? '+' : '') + r.ann_return_pct + '%', color: r.ann_return_pct >= 0 ? 'var(--gr)' : 'var(--re)', sub:'annualised' },
    { label:'Volatility',  val: r.ann_vol_pct + '%',           color: 'var(--am)',  sub:'annualised' },
    { label:'Sharpe',      val: r.sharpe,                       color: r.sharpe > 1 ? 'var(--gr)' : r.sharpe < 0 ? 'var(--re)' : 'var(--am)', sub:'risk-adj return' },
    { label:'Max Drawdown',val: '-' + r.max_drawdown_pct + '%', color: 'var(--re)',  sub:'peak-to-trough' },
    { label:'Sortino',     val: r.sortino > 900 ? '∞' : r.sortino, color: 'var(--b4)', sub:'downside adj.' },
    { label:'Beta (vs SPX)',val: r.beta,                        color: 'var(--t1)',  sub:'market sensitivity' },
    { label:'Alpha',       val: (r.alpha_pct >= 0 ? '+' : '') + r.alpha_pct + '%', color: r.alpha_pct >= 0 ? 'var(--gr)' : 'var(--re)', sub:'excess return' },
    { label:'VaR 95%',     val: r.var_95_pct + '%',            color: 'var(--re)',  sub:'daily worst-case' },
  ];
  el('qmetrics-kpis').innerHTML = kpis.map(function(k) {
    return '<div class="qlab-kpi"><div class="qlab-kpi-label">' + k.label + '</div>'
      + '<div class="qlab-kpi-val" style="color:' + k.color + '">' + k.val + '</div>'
      + '<div class="qlab-kpi-sub">' + k.sub + '</div></div>';
  }).join('');

  var distStats = [
    { label:'Skewness', val: r.skewness, color: r.skewness < -0.5 ? 'var(--re)' : 'var(--t1)', sub:'return asymmetry' },
    { label:'Kurtosis', val: r.kurtosis, color: r.kurtosis > 1 ? 'var(--am)' : 'var(--t1)',   sub:'tail fatness' },
    { label:'Calmar',   val: r.calmar > 900 ? '∞' : r.calmar,   color: 'var(--b4)', sub:'return/drawdown' },
    { label:'Days',     val: r.n_days,                            color: 'var(--t2)', sub:'in sample' },
  ];
  el('qmetrics-dist-stats').innerHTML = distStats.map(function(k) {
    return '<div class="qlab-kpi"><div class="qlab-kpi-label">' + k.label + '</div>'
      + '<div class="qlab-kpi-val" style="color:' + k.color + ';font-size:16px">' + k.val + '</div>'
      + '<div class="qlab-kpi-sub">' + k.sub + '</div></div>';
  }).join('');
}

async function loadMktEvents() {
  var evEl = el('mkt-events-list');
  if (!evEl || !MKT.symbol) return;
  evEl.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:8px 0">Loading related events…</div>';

  // Use the dedicated endpoint (asset-specific, with market reaction)
  var r = await rq('/api/markets/historical-events/' + encodeURIComponent(MKT.symbol)
                   + '?period=1y&min_severity=4.5&max_events=10');

  if (r && r.events && r.events.length) {
    evEl.innerHTML = r.events.map(function(ev) {
      var col = ev.color || '#94A3B8';
      // Flat fields from API: ret_1d, ret_5d (also available inside ev.reaction)
      var d1  = ev.ret_1d  != null ? ev.ret_1d  : (ev.reaction ? ev.reaction.ret_1d  : null);
      var d5  = ev.ret_5d  != null ? ev.ret_5d  : (ev.reaction ? ev.reaction.ret_5d  : null);
      var rxnHtml = '';
      if (d1 != null || d5 != null) {
        var c1 = (d1||0) >= 0 ? 'var(--gr)' : 'var(--re)';
        var c5 = (d5||0) >= 0 ? 'var(--gr)' : 'var(--re)';
        rxnHtml = '<div style="display:flex;gap:8px;margin-top:4px">'
          + (d1 != null ? '<span style="font-size:9px;color:var(--t3)">1D <b style="color:'+c1+'">' + (d1>=0?'+':'') + d1.toFixed(1)+'%</b></span>' : '')
          + (d5 != null ? '<span style="font-size:9px;color:var(--t3)">5D <b style="color:'+c5+'">' + (d5>=0?'+':'') + d5.toFixed(1)+'%</b></span>' : '')
          + '</div>';
      }
      var evId = ev.id || '';
      return '<div class="mkt-ev-row" onclick="' + (evId ? 'openEP(\''+evId+'\')"' : '"') + '>'
        + '<div style="display:flex;align-items:flex-start;gap:7px">'
        + '<span style="font-size:14px;flex-shrink:0;margin-top:1px">' + (ev.icon||'📌') + '</span>'
        + '<div style="flex:1;min-width:0">'
        + '<div style="font-weight:600;color:var(--t1);font-size:11px;line-height:1.3">' + (ev.title||'') + '</div>'
        + '<div style="font-size:9px;color:var(--t3);margin-top:2px">'
        + '<span style="color:'+col+'">' + (ev.cat_label||ev.category||'') + '</span>'
        + (ev.country ? ' · '+ev.country : '')
        + ' · ' + (ev.date||'').slice(0,10)
        + (ev.relevance ? ' · rel ' + (ev.relevance*100).toFixed(0)+'%' : '')
        + '</div>'
        + rxnHtml
        + '</div></div></div>';
    }).join('');
    return;
  }

  // Fallback: driver-based matching from G.events
  var asset   = MKT.allAssets && MKT.allAssets.find(function(a){return a.symbol===MKT.symbol;});
  var drivers = asset ? (asset.drivers || []) : [];
  var matched = (G.events || []).filter(function(e) {
    if (!drivers.length) return false;
    var t = (e.title + ' ' + (e.summary||'')).toLowerCase();
    return drivers.some(function(d){return t.includes(d.toLowerCase());});
  }).slice(0, 6);
  evEl.innerHTML = matched.length ? matched.map(function(e) {
    var m = (typeof CATS !== 'undefined' && CATS[e.category]) ? CATS[e.category] : null;
    return '<div class="mkt-ev-row" onclick="openEP(\''+e.id+'\')">'
      + '<div style="font-weight:600;color:var(--t1);font-size:11px">' + (m?m.i+' ':'') + e.title + '</div>'
      + '<div style="font-size:9px;color:var(--t3);margin-top:2px">' + (e.country_name||'') + ' · ' + tAgo(new Date(e.timestamp)) + '</div>'
      + '</div>';
  }).join('') : '<div style="font-size:11px;color:var(--t3);padding:8px 0">No directly related events found.</div>';
}


async function runForecast() {
  if (!MKT.symbol) return;
  var loadingEl = el('fc-loading');
  if (loadingEl) loadingEl.style.display = 'flex';

  var volMult = parseFloat((el('fc-vol-slider')||{}).value || 1.0);
  var muAdj   = parseFloat((el('fc-mu-slider')||{}).value || 0) / 100;

  var r = await rq('/api/markets/quant/forecast', {
    method: 'POST',
    body: {
      symbol:         MKT.symbol,
      horizon_days:   MKT.fcHorizon,
      vol_multiplier: volMult,
      mu_adjustment:  muAdj,
      n_paths:        1000,
      history_period: '2y',
    }
  });

  if (loadingEl) loadingEl.style.display = 'none';
  MKT.forecast = r;

  if (!r || r.error) {
    el('fc-scenarios').innerHTML = '<div style="color:var(--re);font-size:11px">'+( r && r.error ? r.error : 'Failed to run simulation')+'</div>';
    return;
  }

  // Draw forecast chart
  var canvas = el('qchart-forecast');
  if (!canvas) return;
  var W = canvas.offsetWidth || 600;
  canvas.width = W; canvas.height = 260;
  var ctx = canvas.getContext('2d');
  drawForecastChart(ctx, r, W, 260);

  // Scenario cards
  var sc = r.scenarios || {};
  var horizon_label = MKT.fcHorizon <= 21 ? '1 month' : MKT.fcHorizon <= 63 ? '3 months' : MKT.fcHorizon <= 126 ? '6 months' : '1 year';
  el('fc-scenarios').innerHTML = [
    { key:'bullish', label:'Bullish', cls:'bull', icon:'▲', color:'#10B981' },
    { key:'base',    label:'Base Case', cls:'base', icon:'●', color:'#60A5FA' },
    { key:'bearish', label:'Bearish',  cls:'bear', icon:'▼', color:'#EF4444' },
  ].map(function(s) {
    var d = sc[s.key] || {};
    var ret = d.return_pct || 0;
    return '<div class="fc-scenario ' + s.cls + '">'
      + '<div class="fc-scenario-label" style="color:' + s.color + '">' + s.icon + ' ' + s.label + '</div>'
      + '<div class="fc-scenario-price" style="color:' + s.color + '">' + fmtP(MKT.symbol, d.price || 0) + '</div>'
      + '<div class="fc-scenario-ret" style="color:' + s.color + '">' + (ret >= 0 ? '+' : '') + ret.toFixed(1) + '%</div>'
      + '<div style="font-size:9px;color:var(--t3);margin-top:4px">in ' + horizon_label + '</div>'
      + '</div>';
  }).join('');

  // Assumptions
  var ass = r.assumptions || {};
  var assEl = el('fc-assumptions');
  if (assEl) assEl.innerHTML = '📐 <strong>Model:</strong> ' + ass.model
    + ' &nbsp;|&nbsp; <strong>History:</strong> ' + ass.n_history_days + ' trading days'
    + ' &nbsp;|&nbsp; <strong>Hist. ann. return:</strong> ' + ass.hist_ann_return_pct + '%'
    + ' &nbsp;|&nbsp; <strong>Hist. volatility:</strong> ' + ass.hist_ann_vol_pct + '%'
    + ' &nbsp;|&nbsp; <strong>Vol multiplier:</strong> ' + ass.applied_vol_mult + '×'
    + ' &nbsp;|&nbsp; <strong>Paths:</strong> ' + ass.n_paths.toLocaleString();
}

function drawForecastChart(ctx, data, W, H) {
  var pct = data.percentiles || {};
  var last = data.last_price || 0;
  var horizon = (pct[50] || []).length;

  ctx.clearRect(0, 0, W, H);
  if (!horizon) return;

  var pad = { top: 20, right: 80, bottom: 30, left: 60 };
  var cW = W - pad.left - pad.right;
  var cH = H - pad.top  - pad.bottom;

  // All values for scale
  var allVals = (pct[5]||[]).concat(pct[95]||[]).concat([last]);
  var minV = Math.min.apply(null, allVals) * 0.98;
  var maxV = Math.max.apply(null, allVals) * 1.02;
  var range = maxV - minV || 1;

  function xOf(i) { return pad.left + (i / (horizon - 1)) * cW; }
  function yOf(v) { return pad.top  + (1 - (v - minV) / range) * cH; }

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  for (var gi = 0; gi <= 5; gi++) {
    var gy = pad.top + gi * cH / 5;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
    var gv = maxV - gi * range / 5;
    ctx.fillStyle = 'rgba(148,163,184,.6)';
    ctx.font = '9px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(gv > 1000 ? (gv/1000).toFixed(1)+'k' : gv.toFixed(2), pad.left - 4, gy + 3);
  }

  // Current price vertical line (x=0)
  ctx.strokeStyle = 'rgba(255,255,255,.25)';
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(pad.left, pad.top); ctx.lineTo(pad.left, H - pad.bottom); ctx.stroke();
  ctx.setLineDash([]);

  // Shaded confidence band (5th – 95th pct)
  if (pct[5] && pct[95]) {
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(pct[5][0]));
    for (var i = 1; i < horizon; i++) ctx.lineTo(xOf(i), yOf(pct[5][i]));
    for (var i = horizon-1; i >= 0; i--) ctx.lineTo(xOf(i), yOf(pct[95][i]));
    ctx.closePath();
    ctx.fillStyle = 'rgba(59,130,246,.08)';
    ctx.fill();
  }

  // Inner band (25th – 75th pct)
  if (pct[25] && pct[75]) {
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(pct[25][0]));
    for (var i = 1; i < horizon; i++) ctx.lineTo(xOf(i), yOf(pct[25][i]));
    for (var i = horizon-1; i >= 0; i--) ctx.lineTo(xOf(i), yOf(pct[75][i]));
    ctx.closePath();
    ctx.fillStyle = 'rgba(59,130,246,.15)';
    ctx.fill();
  }

  // Scenario lines
  var lines = [
    { pct: 75, color: '#10B981', width: 1.8, dash: [], label: 'Bullish' },
    { pct: 50, color: '#60A5FA', width: 2.5, dash: [], label: 'Base'    },
    { pct: 25, color: '#EF4444', width: 1.8, dash: [], label: 'Bearish' },
    { pct:  5, color: '#EF444455', width: 1, dash:[4,4], label: ''      },
    { pct: 95, color: '#10B98155', width: 1, dash:[4,4], label: ''      },
  ];

  lines.forEach(function(ln) {
    if (!pct[ln.pct]) return;
    ctx.beginPath();
    ctx.moveTo(xOf(0), yOf(pct[ln.pct][0]));
    for (var i = 1; i < horizon; i++) ctx.lineTo(xOf(i), yOf(pct[ln.pct][i]));
    ctx.strokeStyle = ln.color;
    ctx.lineWidth = ln.width;
    ctx.setLineDash(ln.dash);
    ctx.stroke();
    ctx.setLineDash([]);

    // End labels
    if (ln.label) {
      var endY = yOf(pct[ln.pct][horizon - 1]);
      ctx.fillStyle = ln.color;
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(ln.label, W - pad.right + 4, endY + 3);
      var endPrice = pct[ln.pct][horizon-1];
      ctx.font = '9px monospace';
      ctx.fillStyle = 'rgba(148,163,184,.8)';
      ctx.fillText(endPrice > 1000 ? (endPrice/1000).toFixed(1)+'k' : endPrice.toFixed(2), W - pad.right + 4, endY + 13);
    }
  });

  // Current price dot
  ctx.beginPath();
  ctx.arc(pad.left, yOf(last), 5, 0, Math.PI*2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,.8)';
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  ctx.fillText('Now: ' + fmtP(MKT.symbol, last), pad.left - 10, yOf(last) + 4);

  // X-axis labels
  ctx.fillStyle = 'rgba(148,163,184,.6)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'center';
  [0.25, 0.5, 0.75, 1].forEach(function(t) {
    var dayIdx = Math.floor(t * (horizon-1));
    var dayLabel = Math.round(t * data.horizon_days) + 'd';
    ctx.fillText(dayLabel, xOf(dayIdx), H - pad.bottom + 14);
  });
}

// ── BACKTEST TAB ─────────────────────────────────────

function setFcHorizon(days, btn) {
  MKT.fcHorizon = parseInt(days);
  document.querySelectorAll('.qlab-ctrl-btn[data-h]').forEach(function(b){b.classList.remove('on');});
  if (btn) btn.classList.add('on');
}

function setBtPeriod(p, btn) {
  MKT.btPeriod = p;
  document.querySelectorAll('.qlab-ctrl-btn[data-p]').forEach(function(b){b.classList.remove('on');});
  if (btn) btn.classList.add('on');
}

async function runBacktest() {
  if (!MKT.symbol) return;
  var strategy = (el('bt-strategy')||{}).value || 'buy_hold';
  var fastMA   = parseInt((el('bt-fast')||{}).value || 20);
  var slowMA   = parseInt((el('bt-slow')||{}).value || 50);

  var maParams = el('bt-ma-params');
  if (maParams) maParams.style.display = strategy === 'ma_crossover' ? 'flex' : 'none';

  var btCanvas = el('qchart-bt');
  if (btCanvas) { btCanvas.getContext('2d').clearRect(0,0,btCanvas.width,btCanvas.height); }

  var r = await rq('/api/markets/quant/backtest', {
    method: 'POST',
    body: { symbol: MKT.symbol, strategy: strategy, period: MKT.btPeriod, fast_ma: fastMA, slow_ma: slowMA }
  });

  if (!r || r.error) {
    var metrEl = el('bt-metrics');
    if (metrEl) metrEl.innerHTML = '<div style="color:var(--re);font-size:11px">'+(r&&r.error?r.error:'Failed')+'</div>';
    return;
  }

  // Draw NAV chart (3 lines)
  if (btCanvas) {
    btCanvas.width  = btCanvas.offsetWidth || 600;
    btCanvas.height = 220;
    var bCtx = btCanvas.getContext('2d');
    drawMultiLineChart(bCtx, [
      { data: r.strategy_nav,  color: '#60A5FA', label: strategy.replace('_',' '), width: 2 },
      { data: r.buyhold_nav,   color: 'rgba(148,163,184,.6)', label: 'Buy & Hold', width: 1.5 },
      { data: r.benchmark_nav, color: 'rgba(245,158,11,.5)', label: 'S&P 500 Bench', width: 1.2 },
    ], btCanvas.width, 220);
  }

  // Metrics table
  var m = r.metrics || {};
  var st = m.strategy || {}, bh = m.buyhold || {};
  var metrEl = el('bt-metrics');
  if (metrEl) {
    metrEl.innerHTML = '<div class="bt-compare">'
      + btCol('📈 ' + strategy.replace(/_/g,' '), st, '#60A5FA')
      + btCol('🔒 Buy & Hold', bh, 'rgba(148,163,184,.8)')
      + '</div>'
      + (r.signals && r.signals.length ? '<div style="font-size:10px;color:var(--t3);margin-top:8px">'+r.signals.length+' trade signals generated over '+r.n_days+' trading days.</div>' : '');
  }
}

function btCol(title, m, color) {
  var rows = [
    ['Total Return', (m.total_return_pct >= 0?'+':'')+m.total_return_pct+'%', m.total_return_pct >= 0 ? 'var(--gr)' : 'var(--re)'],
    ['Ann. Return',  (m.ann_return_pct  >= 0?'+':'')+m.ann_return_pct+'%',  m.ann_return_pct  >= 0 ? 'var(--gr)' : 'var(--re)'],
    ['Sharpe',       m.sharpe,                                               m.sharpe > 1 ? 'var(--gr)' : 'var(--am)'],
    ['Max Drawdown', '-'+m.max_drawdown_pct+'%',                             'var(--re)'],
  ];
  if (m.n_trades != null) rows.push(['Trades', m.n_trades, 'var(--b4)']);
  return '<div class="bt-col">'
    + '<div class="bt-col-title" style="color:'+color+'">'+title+'</div>'
    + rows.map(function(r) {
        return '<div class="bt-metric-row"><span class="bt-metric-label">'+r[0]+'</span>'
          +'<span class="bt-metric-val" style="color:'+r[2]+'">'+r[1]+'</span></div>';
      }).join('')
    + '</div>';
}

function drawMultiLineChart(ctx, series, W, H) {
  ctx.clearRect(0, 0, W, H);
  var validSeries = series.filter(function(s){return s.data && s.data.length > 1;});
  if (!validSeries.length) return;

  var allData = validSeries.reduce(function(acc, s){ return acc.concat(s.data); }, []);
  var minV = Math.min.apply(null, allData);
  var maxV = Math.max.apply(null, allData);
  var range = maxV - minV || 1;
  var maxLen = Math.max.apply(null, validSeries.map(function(s){return s.data.length;}));

  var pad = { top:10, right:10, bottom:22, left:46 };
  var cW = W - pad.left - pad.right;
  var cH = H - pad.top  - pad.bottom;

  // Grid & labels
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  ctx.fillStyle = 'rgba(148,163,184,.6)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  for (var gi = 0; gi <= 4; gi++) {
    var gy = pad.top + gi * cH / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
    var gv = maxV - gi * range / 4;
    ctx.fillText(gv.toFixed(0), pad.left - 4, gy + 3);
  }

  validSeries.forEach(function(s) {
    var n = s.data.length;
    ctx.beginPath();
    ctx.moveTo(pad.left + 0 * cW / (maxLen-1), pad.top + (1-(s.data[0]-minV)/range)*cH);
    for (var i = 1; i < n; i++) {
      var x = pad.left + (i/(maxLen-1)) * cW;
      var y = pad.top  + (1 - (s.data[i]-minV)/range) * cH;
      ctx.lineTo(x, y);
    }
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width || 1.5;
    ctx.stroke();

    // Legend dot at end
    var endX = pad.left + ((n-1)/(maxLen-1)) * cW;
    var endY = pad.top  + (1 - (s.data[n-1]-minV)/range) * cH;
    ctx.beginPath(); ctx.arc(endX, endY, 3, 0, Math.PI*2);
    ctx.fillStyle = s.color; ctx.fill();
  });

  // Legend
  ctx.textAlign = 'left';
  validSeries.forEach(function(s, idx) {
    var lx = pad.left + idx * (cW/validSeries.length);
    ctx.fillStyle = s.color;
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText('— ' + s.label, lx, H - pad.bottom + 14);
  });
}

// ── FACTOR TAB ────────────────────────────────────────

async function loadFactorAnalysis() {
  var lb = el('factor-loading'), body = el('factor-body');
  if (!lb || !body) return;
  lb.style.display = 'block'; body.style.display = 'none';

  var r = await rq('/api/markets/quant/regression', {
    method:'POST',
    body:{ symbol: MKT.symbol, period:'1y', factors:['^GSPC','^VIX','GC=F','CL=F','DX=F'] }
  });
  if (!r || r.error) { lb.textContent = r&&r.error?r.error:'Failed'; return; }

  lb.style.display = 'none'; body.style.display = 'block';

  // Factor bars (R²)
  var barsEl = el('factor-bars');
  if (barsEl) {
    barsEl.innerHTML = r.regressions.map(function(reg) {
      var r2pct = Math.round(reg.r2 * 100);
      var col = r2pct > 40 ? '#EF4444' : r2pct > 20 ? '#F59E0B' : '#60A5FA';
      var betaSign = reg.beta >= 0 ? '+' : '';
      return '<div class="factor-bar-row">'
        + '<div class="factor-bar-label">' + reg.name + '</div>'
        + '<div class="factor-bar-track"><div class="factor-bar-fill" style="width:'+r2pct+'%;background:'+col+'"></div></div>'
        + '<div class="factor-bar-r2" style="color:'+col+'">R²&nbsp;'+r2pct+'%</div>'
        + '<div class="factor-bar-beta">β&nbsp;'+betaSign+reg.beta+'</div>'
        + '</div>';
    }).join('');
  }

  // Scatter plots for top 2
  var scatterWrap = el('factor-scatter-wrap');
  if (scatterWrap) {
    scatterWrap.innerHTML = '';
    r.regressions.slice(0,2).forEach(function(reg) {
      var wrap = document.createElement('div');
      wrap.className = 'qlab-chart-wrap';
      wrap.innerHTML = '<div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px">vs ' + reg.name + ' (R²=' + Math.round(reg.r2*100) + '%)</div>'
        + '<canvas id="scatter-'+reg.factor+'" style="width:100%;height:140px"></canvas>';
      scatterWrap.appendChild(wrap);

      requestAnimationFrame(function() {
        var sc = el('scatter-' + reg.factor);
        if (!sc) return;
        sc.width = sc.offsetWidth || 240; sc.height = 140;
        drawScatter(sc.getContext('2d'), reg.x_series, reg.y_series, reg.alpha, reg.beta, sc.width, 140, reg.name);
      });
    });
  }
}

function drawScatter(ctx, xData, yData, alpha, beta, W, H, xLabel) {
  ctx.clearRect(0, 0, W, H);
  if (!xData || !xData.length) return;
  var n = Math.min(xData.length, yData.length, 100);
  var xs = xData.slice(0,n), ys = yData.slice(0,n);
  var xMin = Math.min.apply(null,xs), xMax = Math.max.apply(null,xs);
  var yMin = Math.min.apply(null,ys), yMax = Math.max.apply(null,ys);
  var xR = xMax-xMin||1, yR = yMax-yMin||1;
  var pad = 20;
  var cW = W-2*pad, cH = H-2*pad;
  function px(v){return pad + (v-xMin)/xR*cW;}
  function py(v){return H-pad - (v-yMin)/yR*cH;}

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  [0.25,0.5,0.75].forEach(function(t){
    ctx.beginPath(); ctx.moveTo(pad+t*cW,pad); ctx.lineTo(pad+t*cW,H-pad); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(pad,H-pad-t*cH); ctx.lineTo(W-pad,H-pad-t*cH); ctx.stroke();
  });

  // Zero lines
  if (xMin<0&&xMax>0) { ctx.strokeStyle='rgba(255,255,255,.15)'; ctx.beginPath(); ctx.moveTo(px(0),pad); ctx.lineTo(px(0),H-pad); ctx.stroke(); }
  if (yMin<0&&yMax>0) { ctx.strokeStyle='rgba(255,255,255,.15)'; ctx.beginPath(); ctx.moveTo(pad,py(0)); ctx.lineTo(W-pad,py(0)); ctx.stroke(); }

  // Points
  xs.forEach(function(x,i) {
    var col = ys[i]>=0 ? 'rgba(16,185,129,.5)' : 'rgba(239,68,68,.5)';
    ctx.beginPath(); ctx.arc(px(x),py(ys[i]),2.5,0,Math.PI*2);
    ctx.fillStyle = col; ctx.fill();
  });

  // Regression line
  ctx.strokeStyle = '#60A5FA'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px(xMin), py(alpha + beta*xMin));
  ctx.lineTo(px(xMax), py(alpha + beta*xMax));
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = 'rgba(148,163,184,.6)'; ctx.font = '9px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(xLabel + ' ret %', W/2, H-2);
  ctx.save(); ctx.translate(8, H/2); ctx.rotate(-Math.PI/2);
  ctx.fillText(MKT.name + ' ret %', 0, 0); ctx.restore();
}

// ── PORTFOLIO TAB ────────────────────────────────────

function portAddAsset() {
  var sel = el('port-add-sym');
  if (!sel || !sel.value) return;
  var sym  = sel.value;
  var name = sel.options[sel.selectedIndex].text.split(' — ')[1] || sym;
  if (MKT.portfolio.find(function(h){return h.symbol===sym;})) { toast('Already in portfolio','e'); return; }
  MKT.portfolio.push({symbol:sym, name:name, weight:20});
  renderPortHoldings();
  sel.value = '';
}

function portRemoveAsset(sym) {
  MKT.portfolio = MKT.portfolio.filter(function(h){return h.symbol!==sym;});
  renderPortHoldings();
}

function renderPortHoldings() {
  var el_ = el('port-holdings');
  if (!el_) return;
  if (!MKT.portfolio.length) {
    el_.innerHTML = '<div style="color:var(--t3);font-size:11px">No assets yet. Add from the dropdown above.</div>';
    return;
  }
  el_.innerHTML = MKT.portfolio.map(function(h,i) {
    return '<div class="port-holding-row">'
      + '<div><div class="port-holding-sym">'+h.symbol+'</div><div class="port-holding-name">'+h.name+'</div></div>'
      + '<input class="port-weight-inp" type="number" value="'+h.weight+'" min="1" max="100" onchange="MKT.portfolio['+i+'].weight=parseFloat(this.value)||1">'
      + '<span style="font-size:9px;color:var(--t3)">%</span>'
      + '<button class="port-remove" onclick="portRemoveAsset(\'' + h.symbol + '\')">✕</button>'
      + '</div>';
  }).join('');
}

// runPortfolio → see 13_portfolio.js
async function runPCA() {
  var lb = el('pca-loading'), body = el('pca-body');
  if (lb) lb.style.display = 'block';
  if (body) body.style.display = 'none';
  if (lb) lb.textContent = 'Running PCA…';

  var period = (el('pca-period')||{}).value || '1y';
  var topSyms = ['^GSPC','^VIX','GC=F','CL=F','BTC-USD','EURUSD=X','GC=F','^N225','AAPL','MSFT'];
  if (MKT.symbol && topSyms.indexOf(MKT.symbol) === -1) topSyms.unshift(MKT.symbol);

  var r = await rq('/api/markets/quant/pca', {method:'POST', body:{symbols:topSyms.slice(0,10), period:period, n_components:3}});
  if (!r || r.error) { if(lb) lb.textContent = r&&r.error?r.error:'PCA failed'; return; }

  if (lb) lb.style.display = 'none';
  if (body) body.style.display = 'block';

  // Scree plot
  var screeCanvas = el('qchart-scree');
  if (screeCanvas && r.explained_variance_ratio) {
    screeCanvas.width = screeCanvas.offsetWidth || 600; screeCanvas.height = 100;
    drawScree(screeCanvas.getContext('2d'), r.explained_variance_ratio, screeCanvas.width, 100);
  }

  // 2D scatter (PC1 vs PC2)
  var pcaCanvas = el('qchart-pca2d');
  if (pcaCanvas && r.projections && r.projections.length) {
    pcaCanvas.width = pcaCanvas.offsetWidth || 600; pcaCanvas.height = 220;
    drawPCA2D(pcaCanvas.getContext('2d'), r.projections, r.asset_names || r.symbols, pcaCanvas.width, 220, r.explained_variance_ratio);
  }

  // Loadings
  var loadEl = el('pca-loadings');
  if (loadEl && r.components && r.components[0]) {
    var pc1 = r.components[0];
    var syms = r.symbols || [];
    var sorted = syms.map(function(s,i){return{sym:s,name:(r.asset_names||[])[i]||s,load:pc1[i]||0};})
                     .sort(function(a,b){return Math.abs(b.load)-Math.abs(a.load);});
    var maxLoad = Math.max.apply(null, sorted.map(function(s){return Math.abs(s.load);})) || 1;
    loadEl.innerHTML = sorted.map(function(s) {
      var pct = Math.round(Math.abs(s.load)/maxLoad*100);
      var col = s.load >= 0 ? 'var(--b4)' : 'var(--am)';
      var barLeft = s.load >= 0 ? '50%' : (50-pct/2)+'%';
      return '<div class="pca-loading-row"><div class="pca-loading-asset">'+s.name+'</div>'
        +'<div class="pca-loading-bar-wrap">'
        +'<div class="pca-loading-bar" style="background:'+col+';width:'+pct/2+'%;'+(s.load>=0?'left:50%':'right:50%')+'"></div>'
        +'</div>'
        +'<div class="pca-loading-val" style="color:'+col+'">'+(s.load>=0?'+':'')+s.load.toFixed(3)+'</div>'
        +'</div>';
    }).join('');
  }
}

function drawScree(ctx, varRatios, W, H) {
  ctx.clearRect(0,0,W,H);
  var n = varRatios.length;
  var barW = (W - 20) / n;
  var maxV = Math.max.apply(null, varRatios) || 1;
  var cumulative = 0;

  varRatios.forEach(function(v,i) {
    cumulative += v;
    var bh = (v / maxV) * (H - 24);
    var bx = 10 + i * barW;
    ctx.fillStyle = 'rgba(96,165,250,.7)';
    ctx.fillRect(bx + 3, H - 20 - bh, barW - 6, bh);
    ctx.fillStyle = 'rgba(148,163,184,.8)';
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('PC'+(i+1), bx + barW/2, H - 5);
    ctx.fillStyle = '#60A5FA';
    ctx.fillText(Math.round(v*100)+'%', bx + barW/2, H - 22 - bh);
  });
}

function drawPCA2D(ctx, projections, names, W, H, explained) {
  ctx.clearRect(0,0,W,H);
  if (!projections.length || projections[0].length < 2) return;
  var xs = projections.map(function(p){return p[0];});
  var ys = projections.map(function(p){return p[1];});
  var xMin = Math.min.apply(null,xs), xMax = Math.max.apply(null,xs);
  var yMin = Math.min.apply(null,ys), yMax = Math.max.apply(null,ys);
  var xR = xMax-xMin||1, yR = yMax-yMin||1;
  var pad = 30;
  var cW = W-2*pad, cH = H-2*pad-20;

  function px(v){return pad+(v-xMin)/xR*cW;}
  function py(v){return H-pad-20-(v-yMin)/yR*cH;}

  // Axis labels
  var ev = explained || [];
  ctx.fillStyle = 'rgba(148,163,184,.7)'; ctx.font = '9px sans-serif'; ctx.textAlign='center';
  ctx.fillText('PC1 ('+(Math.round((ev[0]||0)*100))+'% var)', W/2, H-2);
  ctx.save(); ctx.translate(10,H/2-10); ctx.rotate(-Math.PI/2);
  ctx.fillText('PC2 ('+(Math.round((ev[1]||0)*100))+'% var)',0,0); ctx.restore();

  // Grid
  ctx.strokeStyle='rgba(255,255,255,.06)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(px(0),pad); ctx.lineTo(px(0),H-pad-20); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad,py(0)); ctx.lineTo(W-pad,py(0)); ctx.stroke();

  var colors = ['#EF4444','#60A5FA','#10B981','#F59E0B','#A78BFA','#EC4899','#06B6D4','#F97316','#34D399','#FBBF24'];
  projections.slice(0,names.length).forEach(function(p,i) {
    if (p.length < 2) return;
    var x = px(p[0]), y = py(p[1]);
    var col = colors[i % colors.length];
    // Circle
    ctx.beginPath(); ctx.arc(x,y,6,0,Math.PI*2);
    ctx.fillStyle = col+'cc'; ctx.fill();
    ctx.strokeStyle = col; ctx.lineWidth=1.5; ctx.stroke();
    // Label
    ctx.fillStyle='rgba(240,246,255,.85)';
    ctx.font='bold 9px sans-serif'; ctx.textAlign='center';
    ctx.fillText((names[i]||'').slice(0,8), x, y-10);
  });
}

// ── Misc ─────────────────────────────────────────────

function renderMktTechnicals(t) {
  var techEl = el('mkt-tech-grid');
  if (!techEl || !t) return;
  var rsi = t.rsi ? t.rsi.toFixed(0) : '—';
  var rsiCol = t.rsi > 70 ? 'var(--re)' : t.rsi < 30 ? 'var(--gr)' : 'var(--am)';
  var items = [
    {label:'RSI 14', val:rsi, color:rsiCol},
    {label:'Trend',  val:t.trend||'—',  color:'var(--t1)'},
    {label:'Signal', val:t.signal||'—', color:t.signal==='BUY'?'var(--gr)':t.signal==='SELL'?'var(--re)':'var(--am)'},
    {label:'Volatility', val:t.volatility ? t.volatility.toFixed(1)+'%' : '—', color:'var(--am)'},
  ];
  techEl.innerHTML = items.map(function(it) {
    return '<div class="tech-item"><div class="tech-lbl">'+it.label+'</div><div class="tech-val" style="color:'+it.color+'">'+it.val+'</div></div>';
  }).join('');
}

function mktToggleWatch() {
  if (!MKT.symbol) return;
  var inWL = (G.watchlist||[]).some(function(w){return w.type==='asset'&&w.value===MKT.symbol;});
  if (inWL) {
    rq('/api/user/watchlist/'+MKT.symbol, {method:'DELETE'}).then(function(){ loadUD().then(renderProfile); toast('Removed from watchlist','i'); });
  } else {
    rq('/api/user/watchlist', {method:'POST', body:{type:'asset',value:MKT.symbol,label:MKT.name}}).then(function(){ loadUD().then(renderProfile); toast('Added to watchlist','s'); });
  }
  var btn = el('mkt-wl-btn');
  if (btn) btn.style.opacity = inWL ? '.5' : '1';
}

// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// MARKETS — Feature extensions
// Candlestick chart, compare overlay, price alerts,
// live sidebar prices, correlation matrix, portfolio export
// ════════════════════════════════════════════════════════════

// ── Chart type (line / candle) ────────────────────────────

var CHART_TYPE = 'line';  // 'line' | 'candle'

function setChartType(type, btn) {
  CHART_TYPE = type;
  document.querySelectorAll('[id^="chart-type-"]').forEach(function(b) {
    b.classList.toggle('on', b.id === 'chart-type-' + type);
  });
  renderChartTab(MKT.ticker);
}

// Candlestick renderer — draws OHLC bars on canvas
function drawCandlestick(ctx, ohlc, dates, opts) {
  var W = opts.W || 700, H = opts.H || 220;
  var pad = { top:10, right:8, bottom:36, left:52 };
  var cW  = W - pad.left - pad.right;
  var cH  = H - pad.top  - pad.bottom;

  ctx.clearRect(0, 0, W, H);
  if (!ohlc || ohlc.length < 2) {
    ctx.fillStyle = 'rgba(148,163,184,.3)';
    ctx.font = '11px sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('No OHLC data — showing line chart', W/2, H/2);
    return false;
  }

  var highs  = ohlc.map(function(c){ return c.h; });
  var lows   = ohlc.map(function(c){ return c.l; });
  var maxVal = Math.max.apply(null, highs);
  var minVal = Math.min.apply(null, lows);
  var range  = maxVal - minVal || 1;

  function xOf(i) { return pad.left + (i + 0.5) / ohlc.length * cW; }
  function yOf(v) { return pad.top  + (1 - (v - minVal) / range) * cH; }

  // Grid
  ctx.strokeStyle = 'rgba(255,255,255,.05)';
  ctx.lineWidth = 1;
  for (var gi = 0; gi <= 4; gi++) {
    var gy = pad.top + gi * cH / 4;
    ctx.beginPath(); ctx.moveTo(pad.left, gy); ctx.lineTo(W - pad.right, gy); ctx.stroke();
  }

  // Y labels
  ctx.fillStyle = 'rgba(148,163,184,.65)'; ctx.font = '9px monospace'; ctx.textAlign = 'right';
  [0,.25,.5,.75,1].forEach(function(t) {
    var v = minVal + t * range;
    var s = Math.abs(v)>1000 ? (v/1000).toFixed(1)+'k' : v.toFixed(2);
    ctx.fillText(s, pad.left - 4, pad.top + (1-t)*cH + 3);
  });

  // X date labels
  ctx.fillStyle = 'rgba(148,163,184,.6)'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
  var numTicks = Math.min(6, Math.floor(cW / 70));
  for (var t = 0; t < numTicks; t++) {
    var idx = Math.round(t * (ohlc.length-1) / (numTicks-1));
    var d = dates[idx] || ''; var label = d;
    try { var dt = new Date(d); label = dt.toLocaleDateString('en',{month:'short',day:'numeric'}); } catch(e){}
    ctx.fillText(label, xOf(idx), H - 4);
    ctx.strokeStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath(); ctx.moveTo(xOf(idx), pad.top + cH); ctx.lineTo(xOf(idx), pad.top + cH + 4); ctx.stroke();
  }

  // Candles
  var barW = Math.max(1, Math.floor(cW / ohlc.length * 0.7));
  ohlc.forEach(function(c, i) {
    var x  = xOf(i);
    var yo = yOf(c.o), yc = yOf(c.c), yh = yOf(c.h), yl = yOf(c.l);
    var up = c.c >= c.o;
    var col = up ? '#10B981' : '#EF4444';
    var bodyTop = Math.min(yo, yc), bodyH = Math.max(1, Math.abs(yo - yc));

    // Wick
    ctx.strokeStyle = col + 'cc';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, yh); ctx.lineTo(x, yl); ctx.stroke();

    // Body
    ctx.fillStyle = up ? 'rgba(16,185,129,.8)' : 'rgba(239,68,68,.8)';
    ctx.strokeStyle = col;
    ctx.lineWidth   = 1;
    ctx.fillRect(x - barW/2, bodyTop, barW, bodyH);
    ctx.strokeRect(x - barW/2, bodyTop, barW, bodyH);
  });

  // Hover crosshair
  if (CHART_STATE.hoverIdx >= 0 && CHART_STATE.hoverIdx < ohlc.length) {
    var hx  = xOf(CHART_STATE.hoverIdx);
    var hc  = ohlc[CHART_STATE.hoverIdx];
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    ctx.setLineDash([4,4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(hx, pad.top); ctx.lineTo(hx, pad.top+cH); ctx.stroke();
    ctx.setLineDash([]);

    // OHLC tooltip box
    var boxW = 100, boxH = 56, bx = hx+8, by = pad.top+4;
    if (bx + boxW > W - pad.right) bx = hx - boxW - 8;
    ctx.fillStyle = 'rgba(6,11,24,.94)'; ctx.strokeStyle = 'rgba(255,255,255,.15)'; ctx.lineWidth = 1;
    _roundRect(ctx, bx, by, boxW, boxH, 4); ctx.fill(); ctx.stroke();
    var lineH = 13;
    [['O', hc.o],['H', hc.h],['L', hc.l],['C', hc.c]].forEach(function(pair, j) {
      ctx.fillStyle = pair[0]==='H'?'var(--gr)' : pair[0]==='L'?'var(--re)' : 'rgba(148,163,184,.9)';
      ctx.font = '9px monospace'; ctx.textAlign = 'left';
      ctx.fillText(pair[0]+' '+pair[1].toFixed(2), bx+6, by+11+j*lineH);
    });
  }

  return true;
}

// Patch renderChartTab to support candlestick
var _origRenderChartTab = renderChartTab;
renderChartTab = function(tdata) {
  if (CHART_TYPE !== 'candle') {
    _origRenderChartTab(tdata);
    return;
  }
  // Candlestick: need OHLC data
  var canvas = document.getElementById('mkt-price-chart');
  if (!canvas) { _origRenderChartTab(tdata); return; }
  var W = canvas.offsetWidth || canvas.parentElement.offsetWidth || 700;
  canvas.width = W; canvas.height = 220;
  var ctx = canvas.getContext('2d');
  CHART_STATE.canvas = canvas;
  CHART_STATE.ctx    = ctx;

  // Try OHLC from ticker (if available)
  var ohlc  = tdata && tdata.ohlc ? tdata.ohlc : null;
  var dates = getMktDates(MKT.chartData, MKT.chartTF);

  if (!ohlc || !ohlc.length) {
    // Build pseudo-OHLC from price-only data with small randomness
    var prices = getChartPrices(MKT.chartData, MKT.chartTF);
    ohlc = prices.map(function(p, i) {
      var prev = i > 0 ? prices[i-1] : p;
      var vola = Math.abs(p - prev) * 0.5;
      return { o:prev, c:p, h:Math.max(prev,p)+vola*0.5, l:Math.min(prev,p)-vola*0.5 };
    });
  }

  CHART_STATE.prices = ohlc.map(function(c){ return c.c; });
  CHART_STATE.dates  = dates;
  CHART_STATE.hoverIdx = -1;

  var evMarkers = _buildChartEventMarkers(CHART_STATE.prices, dates);

  function redraw() { drawCandlestick(ctx, ohlc, dates, {W:W, H:220}); }
  redraw();

  canvas.onmousemove = function(e) {
    var rect = canvas.getBoundingClientRect();
    var mx   = (e.clientX - rect.left);
    var idx  = Math.max(0, Math.min(ohlc.length-1, Math.round(mx / W * ohlc.length - 0.5)));
    if (idx !== CHART_STATE.hoverIdx) {
      CHART_STATE.hoverIdx = idx;
      _updateChartTooltipBar(idx, CHART_STATE.prices, dates);
      redraw();
    }
    canvas.style.cursor = 'crosshair';
  };
  canvas.onmouseleave = function() {
    CHART_STATE.hoverIdx = -1;
    _clearChartTooltipBar();
    redraw();
  };

  // Also render secondary charts (DD, vol, dist)
  _origRenderChartTab(tdata);
};

// ── Multi-asset compare overlay ───────────────────────────

var COMPARE = { assets: [], data: {} };
var COMPARE_COLORS = ['#60A5FA','#10B981','#F59E0B','#EC4899','#A78BFA','#F97316'];

function openCompareModal() {
  var modal = document.getElementById('mkt-compare-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  // Add current asset as first
  if (MKT.symbol && !COMPARE.assets.find(function(a){return a.sym===MKT.symbol;})) {
    COMPARE.assets.push({sym:MKT.symbol, name:MKT.name, color:COMPARE_COLORS[0]});
    COMPARE.data[MKT.symbol] = getChartPrices(MKT.chartData, MKT.chartTF);
  }
  _renderCompareChips();
  _drawCompareChart();
}

function closeCompareModal() {
  var modal = document.getElementById('mkt-compare-modal');
  if (modal) modal.style.display = 'none';
}

function compareSearchInput(q) {
  var res = document.getElementById('compare-search-results');
  if (!q || !res) return;
  var hits = MKT.allAssets.filter(function(a){
    return (a.symbol+' '+a.name).toLowerCase().includes(q.toLowerCase());
  }).slice(0,6);
  res.innerHTML = hits.map(function(a) {
    var col = MKT_CAT_COLORS[a.category] || '#94A3B8';
    return '<div style="padding:5px 8px;cursor:pointer;border-radius:var(--r4);font-size:11px;display:flex;align-items:center;gap:7px;color:var(--t2)" '
      + 'onmouseenter="this.style.background=\'rgba(255,255,255,.05)\'" '
      + 'onmouseleave="this.style.background=\'none\'" '
      + 'onclick="compareAddAsset(\'' + a.symbol + '\',\'' + a.name.replace(/'/g,'') + '\')">'
      + '<span style="color:'+col+';font-weight:700;font-size:10px;width:52px">'+a.symbol+'</span>'
      + '<span>'+a.name+'</span></div>';
  }).join('');
}

function compareAddFromInput() {
  var inp = document.getElementById('compare-search');
  if (!inp || !inp.value.trim()) return;
  var sym = inp.value.trim().toUpperCase();
  var asset = MKT.allAssets.find(function(a){return a.symbol===sym;}) || {symbol:sym, name:sym};
  compareAddAsset(asset.symbol, asset.name);
  inp.value = '';
  document.getElementById('compare-search-results').innerHTML = '';
}

async function compareAddAsset(sym, name) {
  if (COMPARE.assets.length >= 6) { toast('Max 6 assets to compare', 'w'); return; }
  if (COMPARE.assets.find(function(a){return a.sym===sym;})) return;
  var color = COMPARE_COLORS[COMPARE.assets.length];
  COMPARE.assets.push({sym:sym, name:name, color:color});
  // Fetch price data
  if (!COMPARE.data[sym]) {
    var r = await rq('/api/markets/ticker/' + encodeURIComponent(sym) + '?period=3mo');
    COMPARE.data[sym] = r ? getChartPrices((r.prices_full||r.prices||[]), '1M') : [];
  }
  _renderCompareChips();
  _drawCompareChart();
}

function compareRemoveAsset(sym) {
  COMPARE.assets = COMPARE.assets.filter(function(a){return a.sym!==sym;});
  _renderCompareChips();
  _drawCompareChart();
}

function _renderCompareChips() {
  var el = document.getElementById('compare-chips');
  if (!el) return;
  el.innerHTML = COMPARE.assets.map(function(a) {
    return '<span style="display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:100px;font-size:10px;font-weight:700;border:1px solid '+a.color+'44;color:'+a.color+';background:'+a.color+'11">'
      + a.sym
      + '<span onclick="compareRemoveAsset(\''+a.sym+'\')" style="cursor:pointer;opacity:.6;margin-left:2px">✕</span>'
      + '</span>';
  }).join('');
}

function _drawCompareChart() {
  var canvas = document.getElementById('qchart-compare');
  if (!canvas) return;
  var W = canvas.offsetWidth || 600, H = 280;
  canvas.width = W; canvas.height = H;
  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  if (!COMPARE.assets.length) return;

  var pad = {top:10, right:8, bottom:24, left:52};
  var cW  = W - pad.left - pad.right;
  var cH  = H - pad.top  - pad.bottom;

  // Normalise all series to 100 at start (rebased return)
  var series = COMPARE.assets.map(function(a) {
    var raw = COMPARE.data[a.sym] || [];
    if (!raw.length) return {a:a, data:[]};
    var base = raw[0] || 1;
    return {a:a, data:raw.map(function(p){return (p/base-1)*100;})};
  }).filter(function(s){return s.data.length > 1;});

  if (!series.length) { ctx.fillStyle='rgba(148,163,184,.3)'; ctx.font='11px sans-serif'; ctx.textAlign='center'; ctx.fillText('Loading…',W/2,H/2); return; }

  var allVals = series.reduce(function(acc,s){return acc.concat(s.data);},[]);
  var minV    = Math.min.apply(null, allVals);
  var maxV    = Math.max.apply(null, allVals);
  var rng     = maxV - minV || 1;
  var maxN    = Math.max.apply(null, series.map(function(s){return s.data.length;}));

  function xOf(i,n) { return pad.left + (i/(n-1))*cW; }
  function yOf(v)   { return pad.top  + (1-(v-minV)/rng)*cH; }

  // Grid + zero line
  ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1;
  for (var gi=0;gi<=4;gi++) { var gy=pad.top+gi*cH/4; ctx.beginPath();ctx.moveTo(pad.left,gy);ctx.lineTo(W-pad.right,gy);ctx.stroke(); }
  if (minV < 0 && maxV > 0) {
    var zy = yOf(0); ctx.strokeStyle='rgba(255,255,255,.15)'; ctx.setLineDash([4,4]);
    ctx.beginPath();ctx.moveTo(pad.left,zy);ctx.lineTo(W-pad.right,zy);ctx.stroke();ctx.setLineDash([]);
  }
  // Y axis (%)
  ctx.fillStyle='rgba(148,163,184,.65)';ctx.font='9px monospace';ctx.textAlign='right';
  [0,.25,.5,.75,1].forEach(function(t){
    var v=minV+t*rng; ctx.fillText((v>=0?'+':'')+v.toFixed(1)+'%', pad.left-4, pad.top+(1-t)*cH+3);
  });

  // Series lines
  series.forEach(function(s) {
    ctx.beginPath();
    s.data.forEach(function(v,i){ i===0?ctx.moveTo(xOf(i,s.data.length),yOf(v)):ctx.lineTo(xOf(i,s.data.length),yOf(v)); });
    ctx.strokeStyle = s.a.color;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.stroke();
    // End label
    var lastV = s.data[s.data.length-1];
    ctx.fillStyle = s.a.color;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'left';
    ctx.fillText((lastV>=0?'+':'')+lastV.toFixed(1)+'%', xOf(s.data.length-1,s.data.length)+4, yOf(lastV)+3);
  });

  // Legend
  var legEl = document.getElementById('compare-legend');
  if (legEl) {
    legEl.innerHTML = series.map(function(s){
      var last = s.data[s.data.length-1];
      return '<span style="display:flex;align-items:center;gap:5px;font-size:10px">'
        + '<span style="width:12px;height:2px;background:'+s.a.color+';border-radius:1px;flex-shrink:0"></span>'
        + '<span style="color:var(--t2)">'+s.a.name+'</span>'
        + '<span style="color:'+(last>=0?'var(--gr)':'var(--re)')+';font-weight:700">'+(last>=0?'+':'')+last.toFixed(1)+'%</span>'
        + '</span>';
    }).join('');
  }
}

// ── Price alerts ──────────────────────────────────────────

var PRICE_ALERTS = (function(){
  try { return JSON.parse(localStorage.getItem('wl_price_alerts')||'[]'); } catch(e){ return []; }
})();
var ALERT_DIR = 'above';

function openPriceAlert() {
  if (!MKT.symbol) { toast('Select an asset first', 'w'); return; }
  var modal = document.getElementById('mkt-alert-modal');
  var nameEl= document.getElementById('alert-asset-name');
  var inpEl = document.getElementById('alert-price-inp');
  if (!modal) return;
  if (nameEl) nameEl.textContent = MKT.name + ' — current: ' + (MKT.ticker && MKT.ticker.price ? fmtP(MKT.symbol, MKT.ticker.price) : '—');
  if (inpEl && MKT.ticker && MKT.ticker.price) inpEl.value = '';
  modal.style.display = 'block';
}

function closePriceAlert() {
  var modal = document.getElementById('mkt-alert-modal');
  if (modal) modal.style.display = 'none';
}

function setAlertDir(dir, btn) {
  ALERT_DIR = dir;
  document.querySelectorAll('[id^="alert-dir-"]').forEach(function(b){ b.classList.remove('on'); });
  if (btn) btn.classList.add('on');
}

function savePriceAlert() {
  var price = parseFloat(document.getElementById('alert-price-inp').value);
  var note  = (document.getElementById('alert-note-inp').value||'').trim();
  if (!price || isNaN(price)) { toast('Enter a valid target price', 'w'); return; }
  var alert  = {
    id:      Date.now(),
    symbol:  MKT.symbol,
    name:    MKT.name,
    dir:     ALERT_DIR,
    price:   price,
    note:    note,
    current: MKT.ticker ? MKT.ticker.price : null,
    created: new Date().toISOString(),
    triggered: false,
  };
  PRICE_ALERTS.push(alert);
  try { localStorage.setItem('wl_price_alerts', JSON.stringify(PRICE_ALERTS)); } catch(e){}
  closePriceAlert();
  toast('🔔 Alert set: ' + MKT.symbol + ' ' + ALERT_DIR + ' ' + fmtP(MKT.symbol, price), 's');
  _checkPriceAlerts();
}

function _checkPriceAlerts() {
  if (!MKT.ticker || !MKT.ticker.price) return;
  var current = MKT.ticker.price;
  var triggered = [];
  PRICE_ALERTS.forEach(function(a) {
    if (a.triggered || a.symbol !== MKT.symbol) return;
    if ((a.dir==='above' && current >= a.price) || (a.dir==='below' && current <= a.price)) {
      a.triggered = true;
      triggered.push(a);
    }
  });
  if (triggered.length) {
    try { localStorage.setItem('wl_price_alerts', JSON.stringify(PRICE_ALERTS)); } catch(e){}
    triggered.forEach(function(a) {
      toast('🔔 ALERT: ' + a.symbol + ' is ' + a.dir + ' ' + fmtP(a.symbol, a.price) +
            (a.note ? ' — ' + a.note : ''), 's');
    });
  }
}

// Check alerts whenever a new price loads

// ── Live sidebar price refresh ────────────────────────────

function startSidebarPriceRefresh() {
  setInterval(function() {
    if (!MKT.allAssets.length) return;
    // Refresh top 10 assets prices in background
    var syms = MKT.allAssets.slice(0, 10).map(function(a){ return a.symbol; });
    rq('/api/markets/trending').then(function(r) {
      if (!r || !r.assets) return;
      r.assets.forEach(function(updated) {
        var asset = MKT.allAssets.find(function(a){ return a.symbol === updated.symbol; });
        if (asset) { asset.price = updated.price; asset.change_pct = updated.change_pct; }
        // Update DOM row if visible
        var row = document.querySelector('[data-sym="'+updated.symbol+'"] .mkt-asset-chg');
        if (row && updated.change_pct != null) {
          var up  = updated.change_pct >= 0;
          row.textContent = (up?'+':'')+updated.change_pct.toFixed(2)+'%';
          row.style.color = up ? 'var(--gr)' : 'var(--re)';
        }
      });
    });
  }, 60000); // every 60 seconds
}

// ── Correlation matrix ────────────────────────────────────

async function loadCorrelationMatrix() {
  var matEl = document.getElementById('qmetrics-corr-matrix');
  if (!matEl || !MKT.symbol) return;
  matEl.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:8px 0">Loading correlations…</div>';

  var r = await rq('/api/markets/correlations/' + encodeURIComponent(MKT.symbol));
  if (!r || !r.correlations) {
    matEl.innerHTML = '<div style="font-size:11px;color:var(--t3)">No correlation data available</div>';
    return;
  }

  var corrs = r.correlations;
  var syms  = Object.keys(corrs).slice(0, 8);

  // Build heat-map table
  var html = '<table style="width:100%;border-collapse:collapse;font-size:10px">';
  html += '<tr><th style="text-align:left;color:var(--t3);padding:3px 6px;font-weight:500">Asset</th>'
        + '<th style="color:var(--t3);padding:3px 6px;font-weight:500">Corr</th>'
        + '<th style="color:var(--t3);padding:3px 6px;font-weight:500">Direction</th>'
        + '<th style="color:var(--t3);padding:3px 6px;font-weight:500">Strength</th></tr>';

  syms.forEach(function(sym) {
    var c    = corrs[sym] || 0;
    var abs  = Math.abs(c);
    var col  = c > 0.3 ? 'var(--gr)' : c < -0.3 ? 'var(--re)' : 'var(--t3)';
    var dir  = c > 0.3 ? '↑ Positive' : c < -0.3 ? '↓ Negative' : '→ Neutral';
    var barW = Math.round(abs * 100);
    var assetName = (MKT.allAssets.find(function(a){return a.symbol===sym;})||{}).name || sym;
    html += '<tr style="border-bottom:1px solid rgba(255,255,255,.04)">'
      + '<td style="padding:5px 6px;color:var(--t2)">' + sym + '<br><span style="font-size:9px;color:var(--t3)">' + assetName.slice(0,20) + '</span></td>'
      + '<td style="padding:5px 6px;text-align:right;font-weight:700;color:'+col+';font-family:var(--fh)">' + (c>=0?'+':'') + c.toFixed(2) + '</td>'
      + '<td style="padding:5px 6px;color:'+col+';font-size:9px">' + dir + '</td>'
      + '<td style="padding:5px 6px;min-width:80px"><div style="background:var(--bg3);border-radius:2px;height:4px;overflow:hidden"><div style="width:'+barW+'%;height:100%;background:'+col+';border-radius:2px;transition:width .6s"></div></div></td>'
      + '</tr>';
  });
  html += '</table>';
  matEl.innerHTML = html;
}

// Hook into loadQuantMetrics to also load correlations
var _origLoadQuantMetrics = loadQuantMetrics;
loadQuantMetrics = async function() {
  await _origLoadQuantMetrics();
  loadCorrelationMatrix();
};

// ── Portfolio export ──────────────────────────────────────

// exportPortfolio → see 13_portfolio.js
function feedScrollCheck(el) {
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    var btn = document.getElementById('feed-load-more');
    if (btn) btn.style.display = 'block';
  }
}

async function loadMoreFeed() {
  FEED_PAGE++;
  var offset = FEED_PAGE * FEED_PAGE_SIZE;
  var limit  = FEED_PAGE_SIZE;

  var r = await rq('/api/events?limit=' + limit + '&hours=168&offset=' + offset);
  if (!r || !r.events || !r.events.length) {
    var btn = document.getElementById('feed-load-more');
    if (btn) { btn.innerHTML = '<span style="font-size:11px;color:var(--t3)">No more events</span>'; }
    return;
  }

  // Append to G.events and re-render feed section
  var existing = new Set((G.events||[]).map(function(e){return e.id;}));
  var newEvs   = r.events.filter(function(e){return !existing.has(e.id);});
  G.events     = (G.events||[]).concat(newEvs);

  // Re-render feed cards
  var fmain = document.getElementById('fmain');
  if (fmain) {
    newEvs.forEach(function(ev) {
      var m    = typeof CATS!=='undefined' && CATS[ev.category] ? CATS[ev.category] : {i:'📰',c:'#94A3B8',bg:'rgba(148,163,184,.1)'};
      var up   = ev.severity >= 7 ? 'var(--re)' : ev.severity >= 5 ? 'var(--am)' : 'var(--gr)';
      var card = document.createElement('div');
      card.className   = 'evcard';
      card.onclick     = function(){ openEP(ev.id); };
      card.innerHTML   =
        '<div class="evh"><div class="evi" style="background:'+m.bg+'">'+m.i+'</div>'
        + '<div class="evt">'+ev.title+'</div></div>'
        + '<div class="evm"><span>'+ev.category+'</span><span>'+tAgo(new Date(ev.timestamp))+'</span>'
        + '<span>'+(ev.country_name||'Global')+'</span></div>'
        + '<div class="evs">'+(ev.summary||'').slice(0,150)+'</div>'
        + '<div class="evf"><div class="sdots">'
        + '<div class="sd" style="background:'+up+'"></div>'.repeat(Math.round(ev.severity/2.5))
        + '</div><span class="tag tag'+ev.impact[0]+'">'+ev.impact+'</span></div>';
      // Insert before load-more sentinel
      var lm = document.getElementById('feed-load-more');
      fmain.insertBefore(card, lm);
    });
    toast('Loaded ' + newEvs.length + ' more events', 's');
  }
}

// ── Init hook: start refresh & check alerts on boot ──────

var _origEnterApp = typeof enterApp === 'function' ? enterApp : null;
if (typeof enterApp === 'function') {
  var _origEnterApp2 = enterApp;
  enterApp = function() {
    var result = _origEnterApp2();
    setTimeout(startSidebarPriceRefresh, 5000);
    return result;
  };
}

// ════════════════════════════════════════════════════════
// MARKETS ENHANCEMENTS — volume bars, events timeline,
//                         live refresh, ticker header
// ════════════════════════════════════════════════════════

// ── Volume bar chart ─────────────────────────────────────────────────
function _drawVolumeChart(ctx, volumes, prices, W, H, dates) {
  if (!volumes || volumes.length < 2) return;
  ctx.clearRect(0, 0, W, H);
  var n    = volumes.length;
  var maxV = Math.max.apply(null, volumes) || 1;
  var pad  = { left:52, right:8, top:2, bottom:2 };
  var cW   = W - pad.left - pad.right;
  var cH   = H - pad.top  - pad.bottom;
  var bW   = Math.max(1, cW / n - 1);

  for (var i = 0; i < n; i++) {
    var x  = pad.left + (i / n) * cW;
    var h  = (volumes[i] / maxV) * cH;
    // Color: green if price up that day, red if down
    var isUp = i > 0 ? prices[i] >= prices[i-1] : true;
    ctx.fillStyle = isUp ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)';
    ctx.fillRect(x, pad.top + cH - h, Math.max(1, bW), h);
  }
  // "Volume" label
  ctx.fillStyle = 'rgba(148,163,184,0.5)';
  ctx.font      = '8px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('VOL', 4, H/2 + 3);
}

// ── Events timeline strip below chart ────────────────────────────────
function _renderEventsTimeline(markers, dates, prices) {
  var stripEl = document.getElementById('mkt-events-strip');
  if (!stripEl || !markers || !markers.length) {
    if (stripEl) stripEl.style.display = 'none';
    return;
  }

  // Build unique events sorted by date
  var sorted = markers.slice()
    .filter(function(m){ return m.ev || m.label; })
    .sort(function(a,b){ return a.x_idx - b.x_idx; });

  if (!sorted.length) { stripEl.style.display = 'none'; return; }
  stripEl.style.display = 'block';

  var html = '<div class="mevt-strip-label">Events on chart (' + sorted.length + ')</div>'
    + '<div class="mevt-scroll">';

  sorted.forEach(function(m) {
    var ev     = m.ev || {};
    var col    = m.color || '#F59E0B';
    var date   = (m.ev && m.ev.date) || (dates && dates[m.x_idx]) || '';
    var rxn    = m.d1_return;
    var rxnHtml= '';
    if (rxn != null) {
      var rxnCol = rxn >= 0 ? 'var(--gr)' : 'var(--re)';
      rxnHtml = '<span class="mevt-rxn" style="color:'+rxnCol+'">' + (rxn>=0?'+':'') + rxn.toFixed(1)+'%</span>';
    }
    var evId = ev.id || '';
    html += '<div class="mevt-card" style="border-left-color:'+col+'" '
      + (evId ? 'onclick="openEP(\''+evId+'\')"' : '') + '>'
      + '<div class="mevt-top">'
      + '<span class="mevt-icon">' + (m.icon||'📌') + '</span>'
      + '<span class="mevt-cat" style="color:'+col+'">' + (m.category||ev.category||'') + '</span>'
      + rxnHtml
      + '</div>'
      + '<div class="mevt-title">' + (m.label||ev.title||'').slice(0,48) + '</div>'
      + '<div class="mevt-date">' + date + '</div>'
      + '</div>';
  });

  stripEl.innerHTML = html + '</div>';
}

// ── drawQuantChart enhancement: richer event markers ──────────────────
// Patch the event markers rendering to show icons + reaction labels
var _origDrawQuantChart = drawQuantChart;
drawQuantChart = function(ctx, data, opts) {
  // Call original
  _origDrawQuantChart(ctx, data, opts);

  // Extra: draw category icons above diamond markers
  var events  = opts.events || [];
  var dates   = opts.dates  || [];
  var W       = opts.W || 600, H = opts.H || 200;
  var showLabels = opts.showLabels !== false;
  if (!showLabels) return;

  var pad_left = 52, pad_right = 8, pad_top = 10, pad_bot = showLabels ? 36 : 4;
  var cW = W - pad_left - pad_right;
  var cH = H - pad_top  - pad_bot;
  var n  = data.length;

  var minVal = opts.minVal !== undefined ? opts.minVal : Math.min.apply(null, data);
  var maxVal = opts.maxVal !== undefined ? opts.maxVal : Math.max.apply(null, data);
  var range  = maxVal - minVal || 1;
  function xOf(i){ return pad_left + (i/(n-1))*cW; }
  function yOf(v){ return pad_top  + (1-(v-minVal)/range)*cH; }

  events.forEach(function(ev) {
    if (ev.x_idx < 0 || ev.x_idx >= n) return;
    var ex  = xOf(ev.x_idx);
    var ey  = yOf(data[ev.x_idx]);
    var col = ev.color || '#F59E0B';
    var rxn = ev.d1_return;

    // Category icon above the diamond
    if (ev.icon) {
      ctx.font      = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fff';
      ctx.fillText(ev.icon, ex, ey - 14);
    }

    // Market reaction label
    if (rxn != null && Math.abs(rxn) > 0.5) {
      var rxnCol = rxn >= 0 ? '#10B981' : '#EF4444';
      ctx.fillStyle  = rxnCol;
      ctx.font       = 'bold 8px monospace';
      ctx.textAlign  = 'center';
      ctx.fillText((rxn>=0?'+':'') + rxn.toFixed(1)+'%', ex, ey + 16);
    }

    // Prominent marker: thicker diamond for big moves
    if (ev.prominent) {
      ctx.shadowColor = col;
      ctx.shadowBlur  = 8;
      ctx.fillStyle   = col;
      ctx.beginPath();
      ctx.moveTo(ex, ey-9); ctx.lineTo(ex+6, ey);
      ctx.lineTo(ex, ey+9); ctx.lineTo(ex-6, ey);
      ctx.closePath();
      ctx.fill();
      ctx.shadowBlur = 0;
    }
  });
};

// ── Ticker header: add mkt-t-abs span if missing ────────────────────
// (Injected dynamically since it depends on runtime data)
(function() {
  var chgEl = document.getElementById('mkt-t-chg');
  if (chgEl && !document.getElementById('mkt-t-abs')) {
    var absSpan = document.createElement('span');
    absSpan.id = 'mkt-t-abs';
    absSpan.className = 'mkt-ticker-chg';
    absSpan.style.cssText = 'font-size:11px;margin-left:6px;opacity:.7';
    chgEl.parentNode.insertBefore(absSpan, chgEl.nextSibling);
  }
})();

// ── Event marker cache cleared in selectMktAsset directly ──────────

// ── Price format helper for forex/bond/crypto consistency ────────────
// Already exists as fmtP() in 02_core.js — just ensure it handles bonds
var _origFmtP = typeof fmtP === 'function' ? fmtP : function(s,p){ return p != null ? p.toFixed(2) : '—'; };
fmtP = function(sym, price) {
  if (price == null) return '—';
  // Forex: 4 decimal places
  if (sym && (sym.includes('USD=X') || sym.includes('EUR') || sym.includes('GBP') || sym.includes('JPY'))) {
    return price.toFixed(sym.includes('JPY') ? 2 : 4);
  }
  // Yields/rates (^TNX etc): 3 decimal places + %
  if (sym && sym.startsWith('^T') || sym === '^IRX' || sym === '^FVX') {
    return price.toFixed(3) + '%';
  }
  // Crypto: varies
  if (sym && (sym.includes('-USD') || sym === 'BTC' || sym === 'ETH')) {
    return price >= 1000 ? price.toLocaleString('en', {maximumFractionDigits:0})
         : price >= 1    ? price.toFixed(2)
         : price.toFixed(4);
  }
  // Commodities / Forex majors
  if (price < 10)  return price.toFixed(4);
  if (price < 100) return price.toFixed(2);
  return price.toLocaleString('en', {maximumFractionDigits:2});
};


// ── "Why it moved" — asset drivers ─────────────────────────────────────────

function loadAssetDrivers(symbol, changePct) {
  var el2 = document.getElementById('mkt-drivers');
  if (!el2) return;
  var change = Math.abs(changePct || 0);
  if (change < 0.5) { el2.style.display = 'none'; return; }
  el2.style.display = 'block';
  var dir = changePct >= 0 ? '+' : '';
  var col = changePct >= 0 ? 'var(--gr)' : 'var(--re)';
  el2.innerHTML = '<div style="font-size:10px;font-weight:700;color:var(--t2);margin-bottom:8px">'
    + '<span style="color:' + col + '">' + dir + changePct.toFixed(2) + '%</span>'
    + ' — Possible drivers (last 48h)</div>'
    + '<div id="mkt-drivers-list"><div style="font-size:10px;color:var(--t3)">Loading…</div></div>';

  rq('/api/events/drivers/' + encodeURIComponent(symbol) + '?hours=48').then(function(r) {
    var listEl = document.getElementById('mkt-drivers-list');
    if (!listEl) return;
    if (!r || !r.drivers || !r.drivers.length) {
      listEl.innerHTML = '<div style="font-size:10px;color:var(--t3)">No direct news drivers found for this period.</div>';
      return;
    }
    var html = '';
    r.drivers.forEach(function(ev) {
      var sentCol = ev.sentiment_tone === 'positive' ? 'var(--gr)' : ev.sentiment_tone === 'negative' ? 'var(--re)' : 'var(--t3)';
      var sevCol  = ev.severity >= 7 ? 'var(--re)' : ev.severity >= 5 ? 'var(--am)' : 'var(--gr)';
      var card = document.createElement('div');
      card.style.cssText = 'padding:7px 10px;background:var(--bg3);border-radius:8px;margin-bottom:5px;cursor:pointer';
      card.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">'
        + '<span style="font-size:9px;padding:1px 6px;border-radius:4px;background:var(--bg2);color:var(--t3)">' + ev.category + '</span>'
        + '<span style="font-size:9px;color:' + sentCol + '">' + (ev.sentiment_tone || 'neutral') + '</span>'
        + '<span style="margin-left:auto;font-size:9px;font-weight:700;color:' + sevCol + '">' + (ev.severity || 0).toFixed(1) + '</span>'
        + '</div>'
        + '<div style="font-size:10px;color:var(--t1);line-height:1.4">' + (ev.title || '').slice(0, 90) + '</div>'
        + '<div style="font-size:8px;color:var(--t4);margin-top:2px">'
        + (ev.country_name || '') + ' · ' + tAgo(new Date(ev.timestamp || ''))
        + (ev.source_count > 1 ? ' · ' + ev.source_count + ' sources' : '')
        + '</div>';
      (function(evId){ card.addEventListener('click', function(){ openEP(evId); }); })(ev.id);
      listEl.appendChild(card);
    });
  });
}


/* ═══════════ 24_tradgentic.js ═══════════ */
/**
 * 24_tradgentic.js — Virtual Trading Lab
 * Paper trading UI: wizard, bot cards, market scanner, detail panel.
 */
(function() {
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
var TG = {
  bots:        [],
  strategies:  [],
  quotes:      {},
  activeBotId: null,
  wiz: {
    step:     1,
    strategy: null,
    assets:   [],
    params:   {},
    name:     '',
  },
};

var SCANNER_SYMBOLS = ['AAPL','MSFT','NVDA','SPY','QQQ','BTC-USD','ETH-USD','GC=F','CL=F','^VIX'];

var STRATEGY_ICONS = {
  ma_crossover:    '📈',
  rsi_reversion:   '🔄',
  bollinger_bands: '📊',
  macd_momentum:   '⚡',
};

var STRATEGY_COLORS = {
  ma_crossover:    '#3B82F6',
  rsi_reversion:   '#10B981',
  bollinger_bands: '#8B5CF6',
  macd_momentum:   '#F59E0B',
};

var ASSET_CATEGORIES = {
  'Equities':    ['AAPL','MSFT','GOOGL','NVDA','TSLA','AMZN','META','AMD'],
  'ETFs':        ['SPY','QQQ','IWM','GLD','TLT','VIX'],
  'Crypto':      ['BTC-USD','ETH-USD','SOL-USD'],
  'Commodities': ['GC=F','CL=F','SI=F','NG=F'],
};

// ── Boot ──────────────────────────────────────────────────────────────────────

// ── ALL module state declared here so every function can access them ──────────
var _tgBootDone  = false;
var _tgActivated = false;
var _tgInited    = false;
var _polyLoaded  = false;
var _aggRunning  = false;
var _streamItems = [];
var _pnlCache    = {};
var _drawdownMap = {};

function _tgOnActivate() {
  if (!_polyLoaded) tgLoadPolymarket();
  setTimeout(tgLoadPnlSnapshot, 600);
  if (!_tgBootDone) {
    _tgBootDone = true;
    setTimeout(function() {
      if (TG.bots && TG.bots.length) tgRunAggregation();
    }, 1500);
  }
}

window.initTradgentic = function() {
  // If token not ready yet, retry once after short delay
  if (!G.token) {
    setTimeout(function() {
      if (typeof initTradgentic === 'function') initTradgentic();
    }, 400);
    return;
  }
  if (_tgInited) {
    tgLoadBots();
    tgLoadScanner();
    _tgOnActivate();
    return;
  }
  _tgInited = true;
  // Show scanner skeletons immediately so page feels alive
  _tgShowScannerSkeleton();
  tgLoadStrategies();
  tgLoadBots();
  tgLoadScanner();
  // Activation routine (Polymarket + PnL + aggregation)
  setTimeout(_tgOnActivate, 300);
};

function _tgShowScannerSkeleton() {
  var grid = document.getElementById('tg-scanner-grid');
  if (!grid || grid.children.length > 0) return;
  grid.innerHTML = ['AAPL','MSFT','NVDA','SPY','BTC-USD','ETH-USD','^VIX','GC=F','CL=F','QQQ'].map(function(s) {
    return '<div class="tg-quote-card" style="opacity:.35">'
      + '<div class="tg-quote-sym">' + s + '</div>'
      + '<div class="tg-quote-price" style="color:var(--t3)">—</div>'
      + '</div>';
  }).join('');
}

// ── Data loading ──────────────────────────────────────────────────────────────
function tgLoadStrategies() {
  rq('/api/tradgentic/strategies').then(function(d) {
    if (Array.isArray(d)) TG.strategies = d;
  });
}

window.tgLoadBots = function() {
  var grid  = document.getElementById('tg-bots-grid');
  var empty = document.getElementById('tg-empty');
  // Show skeleton while loading
  if (grid) grid.innerHTML = [1,2].map(function() {
    return '<div class="tg-bot-card" style="opacity:.35;pointer-events:none">'
      + '<div style="height:14px;background:rgba(255,255,255,.08);border-radius:4px;width:60%;margin-bottom:10px"></div>'
      + '<div style="height:10px;background:rgba(255,255,255,.05);border-radius:4px;width:80%;margin-bottom:6px"></div>'
      + '<div style="height:10px;background:rgba(255,255,255,.05);border-radius:4px;width:50%"></div>'
      + '</div>';
  }).join('');

  rq('/api/tradgentic/bots').then(function(d) {
    if (!Array.isArray(d)) {
      // Server error — show inline error message (no DOM moves)
      if (grid) grid.innerHTML =
        '<div style="grid-column:1/-1;display:flex;flex-direction:column;align-items:center;'
        + 'justify-content:center;padding:48px 24px;gap:10px;color:var(--t3)">'
        + '<div style="font-size:32px">⚠️</div>'
        + '<div style="font-size:13px;color:var(--t2);font-weight:600">Could not load bots</div>'
        + '<div style="font-size:11px">Check server logs · <a onclick="tgLoadBots()" '
        + 'style="color:var(--b4);cursor:pointer">Retry</a></div></div>';
      if (empty) empty.style.display = 'none';
      return;
    }
    TG.bots = d;
    _renderBotsGrid(d);
    // Update NN flow bot count
    var nn = document.getElementById('tg-nn-bot-count');
    if (nn) nn.textContent = d.filter(function(b){ return b.active !== 0; }).length + ' active';
  });
};

function tgLoadScanner() {
  var grid = document.getElementById('tg-scanner-grid');
  if (!grid) return;
  // Show skeletons
  grid.innerHTML = SCANNER_SYMBOLS.map(function(s) {
    return '<div class="tg-quote-card" style="opacity:.4"><div class="tg-quote-sym">' + s + '</div>'
      + '<div class="tg-quote-price" style="color:var(--t3)">—</div></div>';
  }).join('');
  // Fetch
  rq('/api/tradgentic/quotes', { method:'POST', body:{ symbols: SCANNER_SYMBOLS } }).then(function(d) {
    if (!d) return;
    TG.quotes = d;
    _renderScanner(d);
  });
}

// ── Render bots grid ──────────────────────────────────────────────────────────
function _renderBotsGrid(bots) {
  var grid  = document.getElementById('tg-bots-grid');
  var empty = document.getElementById('tg-empty');
  if (!grid) return;

  if (!bots.length) {
    // Use innerHTML so we don't move the DOM node (appendChild breaks layout)
    grid.innerHTML =
      '<div class="tg-empty-state" style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;gap:12px;color:var(--t3)">'
    + '<div style="font-size:40px">🧪</div>'
    + '<div style="font-family:var(--fh);font-size:16px;font-weight:700;color:var(--t2)">No bots deployed yet</div>'
    + '<div style="font-size:12px;text-align:center;max-width:280px;line-height:1.6">Create your first bot to start paper trading with real market data</div>'
    + '<button class="tg-btn tg-btn-primary" onclick="tgOpenWizard()" style="margin-top:8px">🚀 Deploy First Bot</button>'
    + '</div>';
    if (empty) empty.style.display = 'none';  // hide original so no duplicate
    return;
  }

  if (empty) empty.style.display = 'none';
  grid.innerHTML = '';
  bots.forEach(function(bot, i) {
    var card = _buildBotCard(bot, i);
    grid.appendChild(card);
  });
}

function _buildBotCard(bot, idx) {
  var stats    = bot.stats || {};
  var active   = bot.active !== 0;
  var color    = STRATEGY_COLORS[bot.strategy] || '#3B82F6';
  var icon     = STRATEGY_ICONS[bot.strategy]  || '🤖';
  var ret      = stats.total_return || 0;
  var equity   = stats.equity || stats.capital || 100000;
  var cash     = stats.cash || 0;
  var trades   = stats.total_trades || 0;
  var winRate  = stats.win_rate || 0;
  var positions= stats.positions || [];

  var div = document.createElement('div');
  div.className = 'tg-bot-card ' + (active ? 'active' : 'paused');
  div.style.setProperty('--tg-color', color);
  div.style.animationDelay = (idx * 0.07) + 's';
  div.setAttribute('data-bot-id', bot.id);

  var retClass = ret > 0 ? 'positive' : ret < 0 ? 'negative' : 'neutral';
  var retPrefix = ret >= 0 ? '+' : '';

  // Asset chips with current signal colour
  var assetHtml = (bot.assets || []).map(function(sym) {
    return '<span class="tg-asset-chip">' + sym + '</span>';
  }).join('');

  div.innerHTML = [
    '<div class="tg-card-head">',
    '  <div>',
    '    <div class="tg-card-name">' + icon + ' ' + _esc(bot.name) + '</div>',
    '    <div class="tg-card-strategy" style="color:' + color + '">' + (bot.strategy || '').replace(/_/g,' ') + '</div>',
    '  </div>',
    '  <div class="tg-card-status ' + (active ? 'active' : 'paused') + '">',
    '    <div class="tg-status-dot"></div>',
    '    ' + (active ? 'LIVE' : 'PAUSED'),
    '  </div>',
    '</div>',
    '<div class="tg-card-pnl">',
    '  <div class="tg-pnl-item"><div class="tg-pnl-label">Equity</div><div class="tg-pnl-val tg-live-equity">$' + _fmt(equity) + '</div></div>',
    '  <div class="tg-pnl-item"><div class="tg-pnl-label">Return</div><div class="tg-pnl-val ' + retClass + ' tg-live-return">' + retPrefix + ret.toFixed(2) + '%</div></div>',
    '  <div class="tg-pnl-item"><div class="tg-pnl-label">Drawdown</div><div class="tg-pnl-val tg-live-dd">0.0%</div></div>',
    '</div>',
    '<div class="tg-card-assets">' + (assetHtml || '<span style="font-size:10px;color:var(--t3)">No assets configured</span>') + '</div>',
    '<div class="tg-card-foot">',
    '  <div class="tg-card-meta">',
    '    <span>📋 ' + trades + ' trades</span>',
    '    <span>💼 ' + positions.length + ' positions</span>',
    '    <span>⏱ ' + (bot.timeframe || '1d') + '</span>',
    '  </div>',
    '  <div class="tg-card-btns">',
    '    <button class="tg-icon-btn" onclick="tgRunBot_card(\'' + bot.id + '\',event)" title="Run strategy">▶</button>',
    '    <button class="tg-icon-btn" onclick="tgToggleBot(\'' + bot.id + '\',' + (active ? 'false' : 'true') + ',event)" title="' + (active ? 'Pause' : 'Resume') + '">' + (active ? '⏸' : '▶') + '</button>',
    '    <button class="tg-icon-btn" onclick="tgDeleteBot(\'' + bot.id + '\',event)" title="Delete" style="color:var(--re)">🗑</button>',
    '  </div>',
    '</div>',
  ].join('');

  div.onclick = function() { tgOpenDetail(bot.id); };
  return div;
}

// ── Scanner render ─────────────────────────────────────────────────────────────
function _renderScanner(quotes) {
  var grid = document.getElementById('tg-scanner-grid');
  if (!grid) return;
  grid.innerHTML = '';
  SCANNER_SYMBOLS.forEach(function(sym, i) {
    var q = quotes[sym];
    if (!q) return;
    var up  = q.change_pct >= 0;
    var div = document.createElement('div');
    div.className = 'tg-quote-card';
    div.style.animationDelay = (i * 0.04) + 's';
    div.style.borderColor = up ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)';
    div.innerHTML = '<div class="tg-quote-sym">' + sym + '</div>'
      + '<div class="tg-quote-price">' + _fmtPrice(q.price) + '</div>'
      + '<div class="tg-quote-chg ' + (up ? 'up' : 'down') + '">'
      +   (up ? '▲' : '▼') + ' ' + Math.abs(q.change_pct).toFixed(2) + '%'
      + '</div>';
    div.onclick = function() { tgSelectAssetInWizard && tgSelectAssetInWizard(sym); };
    grid.appendChild(div);
  });
}

// ── Bot detail panel ──────────────────────────────────────────────────────────
window.tgOpenDetail = function(botId) {
  TG.activeBotId = botId;
  var panel = document.getElementById('tg-detail-panel');
  var body  = document.getElementById('tg-detail-body');
  var title = document.getElementById('tg-detail-title');
  if (!panel) return;

  panel.style.display = 'flex';
  if (body) body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--t3)">Loading…</div>';

  rq('/api/tradgentic/bots/' + botId).then(function(bot) {
    if (!bot || bot.error) { body.innerHTML = '<div style="color:var(--re);padding:20px">Error loading bot</div>'; return; }
    if (title) title.textContent = (STRATEGY_ICONS[bot.strategy] || '🤖') + ' ' + bot.name;
    body.innerHTML = _buildDetailHTML(bot);
  });
};

function _buildDetailHTML(bot) {
  var stats = bot.stats || {};
  var color = STRATEGY_COLORS[bot.strategy] || '#3B82F6';

  // Positions table
  var posHtml = '';
  if ((stats.positions || []).length) {
    posHtml = '<div class="tg-detail-block">'
      + '<div class="tg-detail-block-title">📊 Open Positions</div>'
      + stats.positions.map(function(p) {
          var oc = p.unrealized_pnl >= 0 ? '#10B981' : '#EF4444';
          return '<div class="tg-pos-row">'
            + '<span style="font-family:var(--fm);font-weight:700;color:var(--t1)">' + p.symbol + '</span>'
            + '<span style="font-size:10px;color:var(--t3)">' + p.qty.toFixed(4) + ' @ $' + p.avg_price + '</span>'
            + '<span style="font-family:var(--fm);font-weight:700;color:' + oc + '">'
            +   (p.unrealized_pnl >= 0 ? '+' : '') + '$' + p.unrealized_pnl.toFixed(2)
            + '</span>'
            + '</div>';
        }).join('')
      + '</div>';
  } else {
    posHtml = '<div class="tg-detail-block"><div class="tg-detail-block-title">📊 Open Positions</div>'
      + '<div style="padding:14px;font-size:11px;color:var(--t3)">No open positions</div></div>';
  }

  // Trades log
  var tradesHtml = '<div class="tg-detail-block">'
    + '<div class="tg-detail-block-title">📋 Recent Trades</div>';
  if ((stats.recent_trades || []).length) {
    tradesHtml += stats.recent_trades.slice(0,8).map(function(t) {
      var pc = parseFloat(t.pnl || 0);
      return '<div class="tg-trade-row">'
        + '<span class="tg-trade-side ' + t.side.toLowerCase() + '">' + t.side + '</span>'
        + '<span class="tg-trade-sym">' + t.symbol + '</span>'
        + '<span style="color:var(--t3);font-size:10px">$' + parseFloat(t.price).toFixed(2) + '</span>'
        + '<span class="tg-trade-pnl ' + (pc > 0 ? 'pos' : pc < 0 ? 'neg' : '') + '">'
        +   (t.side === 'SELL' ? (pc >= 0 ? '+' : '') + '$' + pc.toFixed(2) : '') + '</span>'
        + '</div>';
    }).join('');
  } else {
    tradesHtml += '<div style="padding:14px;font-size:11px;color:var(--t3)">No trades executed yet</div>';
  }
  tradesHtml += '</div>';

  // Signal panel
  var signalHtml = '<div class="tg-detail-block">'
    + '<div class="tg-detail-block-title">🧠 Live Signals</div>'
    + '<div id="tg-signals-' + bot.id + '" style="padding:14px">'
    + '<button class="tg-btn tg-btn-ghost tg-btn-sm" style="width:100%" onclick="tgFetchSignals(\'' + bot.id + '\')">Fetch Signals</button>'
    + '</div></div>';

  // Stats bar
  var ret = stats.total_return || 0;
  var retPrefix = ret >= 0 ? '+' : '';

  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'
    + _statBlock('💰 Equity',   '$' + _fmt(stats.equity || 0), ret >= 0 ? 'var(--gr)' : 'var(--re)')
    + _statBlock('📈 Return',   retPrefix + ret.toFixed(2) + '%', ret >= 0 ? 'var(--gr)' : 'var(--re)')
    + _statBlock('✅ Win Rate', (stats.win_rate || 0).toFixed(1) + '%', 'var(--b4)')
    + _statBlock('🔁 Trades',   stats.total_trades || 0, 'var(--t1)')
    + '</div>'
    + signalHtml
    + posHtml
    + tradesHtml
    + '<div style="display:flex;gap:8px;margin-top:4px">'
    + '<button class="tg-btn tg-btn-ghost tg-btn-sm" style="flex:1" onclick="tgResetBot(\'' + bot.id + '\')">↺ Reset Portfolio</button>'
    + '<button class="tg-btn tg-btn-danger tg-btn-sm" onclick="tgDeleteBot(\'' + bot.id + '\',null)">🗑 Delete</button>'
    + '</div>';
}

function _statBlock(label, val, color) {
  return '<div style="background:var(--bg2);border:1px solid var(--bd);border-radius:10px;padding:12px">'
    + '<div style="font-family:var(--fm);font-size:9px;color:var(--t3);letter-spacing:.1em;text-transform:uppercase;margin-bottom:4px">' + label + '</div>'
    + '<div style="font-family:var(--fm);font-size:16px;font-weight:800;color:' + color + '">' + val + '</div>'
    + '</div>';
}

window.tgCloseDetail = function() {
  var panel = document.getElementById('tg-detail-panel');
  if (panel) panel.style.display = 'none';
  TG.activeBotId = null;
};

// ── Signals ───────────────────────────────────────────────────────────────────
window.tgFetchSignals = function(botId) {
  var wrap = document.getElementById('tg-signals-' + botId);
  if (!wrap) return;
  wrap.innerHTML = '<div style="font-size:11px;color:var(--t3)">Fetching…</div>';
  rq('/api/tradgentic/bots/' + botId + '/signal', { method:'POST' }).then(function(d) {
    if (!d || d.error) { wrap.innerHTML = '<div style="color:var(--re);font-size:11px">' + (d && d.error || 'Error') + '</div>'; return; }
    var sigs = d.signals || {};
    if (!Object.keys(sigs).length) { wrap.innerHTML = '<div style="font-size:11px;color:var(--t3)">No signals</div>'; return; }
    wrap.innerHTML = Object.keys(sigs).map(function(sym) {
      var s = sigs[sym];
      return '<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.05)">'
        + '<span style="font-family:var(--fm);font-weight:700;color:var(--t1);min-width:72px">' + sym + '</span>'
        + '<span class="tg-signal-badge ' + s.action + '">' + s.action + '</span>'
        + '<span style="font-size:9px;color:var(--t3);flex:1">' + (s.reason || '').slice(0,50) + '</span>'
        + '<button class="tg-btn tg-btn-sm" style="'
        + (s.action === 'BUY' ? 'background:rgba(16,185,129,.15);color:var(--gr);border:1px solid rgba(16,185,129,.3)' : s.action === 'SELL' ? 'background:rgba(239,68,68,.1);color:var(--re);border:1px solid rgba(239,68,68,.2)' : 'display:none')
        + '" onclick="tgExecuteTrade(\'' + botId + '\',\'' + sym + '\',\'' + s.action + '\',' + s.price + ',\'' + (s.reason||'') + '\')">'
        + (s.action === 'BUY' ? '▲ Buy' : s.action === 'SELL' ? '▼ Sell' : '') + '</button>'
        + '</div>';
    }).join('');
  });
};

window.tgRunBot = function() {
  if (!TG.activeBotId) return;
  var btn = document.getElementById('tg-run-btn');
  if (btn) { btn.textContent = '⏳'; btn.disabled = true; }
  rq('/api/tradgentic/bots/' + TG.activeBotId + '/run', { method:'POST' }).then(function(d) {
    if (btn) { btn.textContent = '▶ Run'; btn.disabled = false; }
    if (d && !d.error) {
      toast('✅ ' + (d.count || 0) + ' trades executed', 's', 3000);
      tgOpenDetail(TG.activeBotId);
      tgLoadBots();
    } else {
      toast(d && d.error || 'Run failed', 'e', 2500);
    }
  });
};

window.tgRunBot_card = function(botId, e) {
  if (e) e.stopPropagation();
  rq('/api/tradgentic/bots/' + botId + '/run', { method:'POST' }).then(function(d) {
    if (d && !d.error) {
      toast('✅ ' + (d.count||0) + ' trades executed for bot ' + botId, 's', 2500);
      tgLoadBots();
    } else {
      toast(d && d.error || 'Error', 'e', 2500);
    }
  });
};

window.tgExecuteTrade = function(botId, sym, side, price, reason) {
  rq('/api/tradgentic/bots/' + botId + '/execute', {
    method:'POST',
    body: { symbol:sym, side:side, price:price, reason:reason }
  }).then(function(d) {
    if (d && !d.error) {
      toast(side + ' ' + sym + ' @ $' + price.toFixed(2), 's', 2500);
      tgOpenDetail(botId);
      tgLoadBots();
    } else {
      toast(d && d.error || 'Trade failed', 'e', 2500);
    }
  });
};

window.tgToggleBot = function(botId, active, e) {
  if (e) e.stopPropagation();
  rq('/api/tradgentic/bots/' + botId, { method:'PATCH', body:{ active: active ? 1 : 0 } }).then(function() {
    tgLoadBots();
  });
};

window.tgDeleteBot = function(botId, e) {
  if (e) e.stopPropagation();
  if (!confirm('Delete this bot? All trade history will be removed.')) return;
  rq('/api/tradgentic/bots/' + botId, { method:'DELETE' }).then(function() {
    if (TG.activeBotId === botId) tgCloseDetail();
    tgLoadBots();
    toast('Bot deleted', 's', 2000);
  });
};

window.tgResetBot = function(botId) {
  if (!confirm('Reset portfolio to $100,000? All trades and positions will be cleared.')) return;
  rq('/api/tradgentic/bots/' + botId + '/reset', { method:'POST' }).then(function(d) {
    if (d && !d.error) {
      toast('Portfolio reset to $100,000', 's', 2500);
      tgOpenDetail(botId);
      tgLoadBots();
    }
  });
};

// ══════════════════════════════════════════════════════════
// WIZARD
// ══════════════════════════════════════════════════════════

window.tgOpenWizard = function() {
  TG.wiz = { step:1, strategy:null, assets:[], params:{}, name:'' };
  var overlay = document.getElementById('tg-wizard');
  if (overlay) overlay.style.display = 'flex';
  _wizRender();
};

window.tgCloseWizard = function() {
  var overlay = document.getElementById('tg-wizard');
  if (overlay) overlay.style.display = 'none';
};

window.tgWizNext = function() {
  var w = TG.wiz;
  if (w.step === 1 && !w.strategy) { toast('Select a strategy first', 'e', 2000); return; }
  if (w.step === 2 && !w.assets.length) { toast('Select at least 1 asset', 'e', 2000); return; }
  if (w.step < 4) { w.step++; _wizRender(); }
  else { _wizDeploy(); }
};

window.tgWizBack = function() {
  if (TG.wiz.step > 1) { TG.wiz.step--; _wizRender(); }
};

function _wizRender() {
  var w       = TG.wiz;
  var content = document.getElementById('tg-wiz-content');
  var nextBtn = document.getElementById('tg-wiz-next');
  var backBtn = document.getElementById('tg-wiz-back');
  var title   = document.getElementById('tg-wiz-title');
  if (!content) return;

  // Steps indicator
  document.querySelectorAll('.tg-step').forEach(function(el) {
    var s = parseInt(el.dataset.step);
    el.classList.toggle('on',   s === w.step);
    el.classList.toggle('done', s < w.step);
    if (s < w.step) el.querySelector('.tg-step-num').textContent = '✓';
    else el.querySelector('.tg-step-num').textContent = s;
  });

  if (backBtn) backBtn.style.display = w.step > 1 ? 'inline-flex' : 'none';
  if (nextBtn) nextBtn.textContent = w.step === 4 ? '🚀 Deploy Bot' : 'Next →';

  var titles = ['', 'Choose Strategy', 'Select Assets', 'Configure Parameters', 'Review & Deploy'];
  if (title) title.textContent = titles[w.step] || 'Deploy New Bot';

  if      (w.step === 1) content.innerHTML = _wizStep1();
  else if (w.step === 2) { content.innerHTML = _wizStep2(); _wizStep2Events(); }
  else if (w.step === 3) content.innerHTML = _wizStep3();
  else if (w.step === 4) content.innerHTML = _wizStep4();
}

function _wizStep1() {
  var strategies = TG.strategies.length ? TG.strategies : [
    {id:'ma_crossover', name:'MA Crossover', description:'Golden/Death cross with fast & slow moving averages.'},
    {id:'rsi_reversion', name:'RSI Reversion', description:'Buys oversold, sells overbought via RSI indicator.'},
    {id:'bollinger_bands', name:'Bollinger Bands', description:'Band breakout or mean-reversion strategy.'},
    {id:'macd_momentum', name:'MACD Momentum', description:'MACD line/signal cross for trend momentum.'},
  ];
  return '<div class="tg-strategy-grid">'
    + strategies.map(function(s) {
        var sel = TG.wiz.strategy === s.id;
        var col = STRATEGY_COLORS[s.id] || '#3B82F6';
        return '<div class="tg-strategy-card ' + (sel ? 'selected' : '') + '"'
          + ' style="--tg-color:' + col + '"'
          + ' onclick="tgWizSelectStrategy(\'' + s.id + '\')">'
          + '<div class="tg-strat-icon">' + (STRATEGY_ICONS[s.id] || '🤖') + '</div>'
          + '<div class="tg-strat-name">' + s.name + '</div>'
          + '<div class="tg-strat-desc">' + s.description + '</div>'
          + '</div>';
      }).join('')
    + '</div>';
}

window.tgWizSelectStrategy = function(id) {
  TG.wiz.strategy = id;
  // Load default params
  var strat = TG.strategies.find(function(s){ return s.id === id; });
  if (strat && strat.params) {
    TG.wiz.params = {};
    Object.keys(strat.params).forEach(function(k) {
      TG.wiz.params[k] = strat.params[k].default;
    });
  }
  document.querySelectorAll('.tg-strategy-card').forEach(function(el) {
    el.classList.remove('selected');
  });
  event.currentTarget.classList.add('selected');
};

function _wizStep2() {
  var html = '<div class="tg-asset-picker">'
    + '<div class="tg-asset-categories">';
  Object.keys(ASSET_CATEGORIES).forEach(function(cat) {
    html += '<button class="tg-cat-btn on" id="tgcat-' + cat + '" onclick="tgWizFilterCat(\'' + cat + '\')">' + cat + '</button>';
  });
  html += '</div><div class="tg-assets-list" id="tg-assets-list">';
  Object.values(ASSET_CATEGORIES).forEach(function(assets) {
    assets.forEach(function(sym) {
      var sel = TG.wiz.assets.indexOf(sym) > -1;
      html += '<button class="tg-asset-toggle ' + (sel ? 'selected' : '') + '" id="tgasset-' + sym + '"'
        + ' onclick="tgWizToggleAsset(\'' + sym + '\')">' + sym + '</button>';
    });
  });
  html += '</div>';
  html += '<div style="font-size:10px;color:var(--t3)">Selected (' + TG.wiz.assets.length + '):</div>';
  html += '<div class="tg-selected-assets" id="tg-selected-assets">'
    + (TG.wiz.assets.length ? TG.wiz.assets.map(function(a){ return '<span class="tg-asset-chip">' + a + '</span>'; }).join('') : '<span style="font-size:10px;color:var(--t3)">None selected</span>')
    + '</div>';
  html += '</div>';
  return html;
}

function _wizStep2Events() {
  // Live scanner prices on asset chips
  rq('/api/tradgentic/quotes', { method:'POST', body:{ symbols: Object.values(ASSET_CATEGORIES).flat() } })
    .then(function(quotes) { TG.quotes = Object.assign(TG.quotes, quotes || {}); });
}

window.tgWizFilterCat = function(cat) {
  // Toggle category visibility
  var btn = document.getElementById('tgcat-' + cat);
  if (btn) btn.classList.toggle('on');
  // Could filter displayed assets by category — for now just visual toggle
};

window.tgWizToggleAsset = function(sym) {
  var idx = TG.wiz.assets.indexOf(sym);
  if (idx > -1) TG.wiz.assets.splice(idx, 1);
  else if (TG.wiz.assets.length < 8) TG.wiz.assets.push(sym);
  else { toast('Max 8 assets per bot', 'e', 2000); return; }

  // Update UI
  var btn = document.getElementById('tgasset-' + sym);
  if (btn) btn.classList.toggle('selected', idx === -1);
  var sel = document.getElementById('tg-selected-assets');
  if (sel) {
    sel.innerHTML = TG.wiz.assets.length
      ? TG.wiz.assets.map(function(a){ return '<span class="tg-asset-chip">' + a + '</span>'; }).join('')
      : '<span style="font-size:10px;color:var(--t3)">None selected</span>';
  }
};

function _wizStep3() {
  var strat = TG.strategies.find(function(s){ return s.id === TG.wiz.strategy; });
  if (!strat || !strat.params || !Object.keys(strat.params).length) {
    return '<div style="text-align:center;padding:32px;color:var(--t3)">This strategy has no configurable parameters.</div>';
  }
  return '<div class="tg-params-grid">'
    + Object.entries(strat.params).map(function(entry) {
        var key = entry[0], p = entry[1];
        var val = TG.wiz.params[key] !== undefined ? TG.wiz.params[key] : p.default;
        if (p.type === 'select') {
          return '<div class="tg-param-row">'
            + '<div class="tg-param-label">' + p.label + '</div>'
            + '<select class="tg-param-select" onchange="TG.wiz.params[\'' + key + '\']=this.value">'
            + p.options.map(function(o){ return '<option value="' + o + '"' + (o === val ? ' selected':'') + '>' + o + '</option>'; }).join('')
            + '</select></div>';
        }
        if (p.type === 'float' || p.type === 'int') {
          var step = p.type === 'int' ? 1 : 0.5;
          return '<div class="tg-param-row">'
            + '<div class="tg-param-label">' + p.label
            +   '<span class="tg-param-val-badge" id="tgpv-' + key + '">' + val + '</span>'
            + '</div>'
            + '<input type="range" class="tg-param-range" min="' + p.min + '" max="' + p.max + '" step="' + step + '" value="' + val + '"'
            + ' oninput="TG.wiz.params[\'' + key + '\']=parseFloat(this.value);var b=document.getElementById(\'tgpv-' + key + '\');if(b)b.textContent=this.value">'
            + '<div class="tg-param-range-labels"><span>' + p.min + '</span><span>' + p.max + '</span></div>'
            + '</div>';
        }
        return '';
      }).join('')
    + '</div>';
}

function _wizStep4() {
  var w     = TG.wiz;
  var strat = TG.strategies.find(function(s){ return s.id === w.strategy; });
  var color = STRATEGY_COLORS[w.strategy] || '#3B82F6';
  var icon  = STRATEGY_ICONS[w.strategy]  || '🤖';
  var name  = w.name || (strat ? strat.name + ' Bot' : 'My Bot');
  if (!w.name) w.name = name;

  return '<div class="tg-preview">'
    + '<div class="tg-preview-header">'
    + '  <div class="tg-preview-icon" style="background:' + color + '18;border-color:' + color + '40">' + icon + '</div>'
    + '  <div style="flex:1"><div style="font-size:11px;color:var(--t3);margin-bottom:6px">Bot Name</div>'
    + '    <input class="tg-preview-name-input" id="tg-bot-name" value="' + _esc(name) + '"'
    + '      oninput="TG.wiz.name=this.value" placeholder="Enter bot name…">'
    + '  </div>'
    + '</div>'
    + '<div class="tg-preview-row"><span class="tg-preview-key">Strategy</span><span class="tg-preview-val">' + (strat ? strat.name : w.strategy) + '</span></div>'
    + '<div class="tg-preview-row"><span class="tg-preview-key">Assets</span><span class="tg-preview-val" style="font-family:var(--fm)">' + w.assets.join(', ') + '</span></div>'
    + '<div class="tg-preview-row"><span class="tg-preview-key">Timeframe</span><span class="tg-preview-val">1d</span></div>'
    + '<div class="tg-preview-capital">'
    + '  <span class="tg-capital-label">Starting Paper Capital</span>'
    + '  <span class="tg-capital-val">$100,000</span>'
    + '</div>'
    + '<div style="font-size:10px;color:var(--t3);line-height:1.6;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.06);border-radius:8px;padding:10px">'
    + '⚠️ <b>Paper trading only</b> — no real money involved. Uses live market data for realistic simulation.'
    + '</div>'
    + '</div>';
}

function _wizDeploy() {
  var w = TG.wiz;
  if (!w.strategy || !w.assets.length) { toast('Incomplete configuration', 'e', 2000); return; }
  var name = (document.getElementById('tg-bot-name') || {}).value || w.name || 'My Bot';
  var btn  = document.getElementById('tg-wiz-next');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Deploying…'; }

  rq('/api/tradgentic/bots', {
    method:'POST',
    body: {
      name:      name,
      strategy:  w.strategy,
      assets:    w.assets,
      timeframe: '1d',
      params:    w.params,
    }
  }).then(function(d) {
    if (btn) { btn.disabled = false; btn.textContent = '🚀 Deploy Bot'; }
    if (d && d.bot) {
      tgCloseWizard();
      toast('🚀 ' + name + ' deployed!', 's', 3000);
      tgLoadBots();
    } else {
      toast(d && d.error || 'Deploy failed', 'e', 2500);
    }
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function _fmt(n) {
  return parseFloat(n).toLocaleString('en', { maximumFractionDigits: 0 });
}
function _fmtPrice(n) {
  var v = parseFloat(n);
  return v >= 10000 ? v.toLocaleString('en', {maximumFractionDigits:0})
       : v >= 100   ? v.toFixed(2)
       : v.toFixed(4);
}
function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Auto-refresh scanner ──────────────────────────────────────────────────────
setInterval(function() {
  if (G.currentView === 'tradgentic') tgLoadScanner();
}, 30000);

// ── Boot hook ─────────────────────────────────────────────────────────────────
// Watch for view-tradgentic activation
document.addEventListener('DOMContentLoaded', function() {
  var view = document.getElementById('view-tradgentic');
  if (!view) return;
  new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      if (m.attributeName === 'class' && view.classList.contains('on')) {
        if (!TG.strategies.length) initTradgentic();
        else tgLoadBots();
      }
    });
  }).observe(view, { attributes: true, attributeFilter: ['class'] });
});

window.initTradgentic = initTradgentic;

// ── BLOCK B+C — Aggregation Engine · Polymarket · NN Flow · Signal Stream ────

// ── WebSocket PnL live updates ───────────────────────────────────────────────
window.tgOnWsPnl = function(data) {
  if (!Array.isArray(data)) return;
  data.forEach(function(snap) {
    _pnlCache[snap.bot_id] = snap;
    _updateCardPnl(snap);
    _trackDrawdown(snap);
  });
};

function _updateCardPnl(snap) {
  // Live-patch PnL values on the bot card without full re-render
  var card = document.querySelector('[data-bot-id="' + snap.bot_id + '"]');
  if (!card) return;

  var retEl = card.querySelector('.tg-live-return');
  var eqEl  = card.querySelector('.tg-live-equity');
  var ddEl  = card.querySelector('.tg-live-dd');

  var ret = snap.total_return || 0;
  var dd  = _drawdownMap[snap.bot_id] || 0;

  if (retEl) {
    retEl.textContent = (ret >= 0 ? '+' : '') + ret.toFixed(2) + '%';
    retEl.className   = 'tg-pnl-val tg-live-return ' + (ret >= 0 ? 'positive' : 'negative');
  }
  if (eqEl)  eqEl.textContent  = '$' + _fmt(snap.equity);
  if (ddEl)  ddEl.textContent  = dd.toFixed(1) + '%';
}

function _trackDrawdown(snap) {
  var id   = snap.bot_id;
  var eq   = snap.equity || 0;
  var peak = _drawdownMap[id + '_peak'] || eq;
  if (eq > peak) peak = eq;
  _drawdownMap[id + '_peak'] = peak;
  _drawdownMap[id] = peak > 0 ? ((peak - eq) / peak * 100) : 0;
}

// ── NN Flow updater ───────────────────────────────────────────────────────────
function _updateNNFlow(botCount, sigCount, polyLoaded) {
  var bc = document.getElementById('tg-nn-bot-count');
  var sc = document.getElementById('tg-nn-sig-count');
  if (bc) bc.textContent = botCount || '—';
  if (sc) sc.textContent = sigCount || '—';

  // Animate the active nodes
  var nodes = document.querySelectorAll('.tg-nn-node');
  nodes.forEach(function(n, i) {
    n.style.opacity = '1';
    n.style.animation = 'none';
    setTimeout(function() {
      n.style.animation = 'tgNodePing .5s ease-out';
    }, i * 120);
  });

  // Color the Poly node if loaded
  var polyNode = document.querySelector('.tg-nn-poly');
  if (polyNode) {
    polyNode.style.borderColor = polyLoaded
      ? 'rgba(245,158,11,.5)'
      : 'rgba(245,158,11,.2)';
  }
}

// ── Signal Aggregation ────────────────────────────────────────────────────────
window.tgRunAggregation = function() {
  if (_aggRunning) return;
  _aggRunning = true;

  var btn = document.querySelector('.tg-stream-run-btn');
  if (btn) { btn.classList.add('loading'); btn.textContent = '⏳ Aggregating…'; }

  var stream = document.getElementById('tg-signal-stream');
  if (stream) stream.innerHTML = '<div class="tg-stream-empty" style="color:var(--b4)">Running aggregation across all active bots…</div>';

  rq('/api/tradgentic/aggregate').then(function(d) {
    _aggRunning = false;
    if (btn) { btn.classList.remove('loading'); btn.textContent = '▶ Run Aggregation'; }

    if (!d || d.error) {
      if (stream) stream.innerHTML = '<div class="tg-stream-empty" style="color:var(--re)">'
        + (d && d.error || 'Aggregation failed — deploy at least one active bot') + '</div>';
      return;
    }

    var signals = d.signals || {};
    var syms    = Object.keys(signals);
    if (!syms.length) {
      if (stream) stream.innerHTML = '<div class="tg-stream-empty">No signals — all bots may be holding</div>';
      return;
    }

    _streamItems = syms.map(function(sym) { return signals[sym].stream_item || signals[sym]; });
    _renderSignalStream(_streamItems);
    _updateNNFlow(d.bot_count, syms.length, _polyLoaded);
    toast('⚡ ' + syms.length + ' signals aggregated from ' + d.bot_count + ' bots', 's', 3000);
  });
};

function _renderSignalStream(items) {
  var stream = document.getElementById('tg-signal-stream');
  if (!stream) return;

  if (!items.length) {
    stream.innerHTML = '<div class="tg-stream-empty">No active signals</div>';
    return;
  }

  // Render as scrolling ticker
  var ticker = document.createElement('div');
  ticker.className = 'tg-stream-ticker';

  // Sort: BUY and SELL first, HOLD last; then by confidence desc
  var sorted = items.slice().sort(function(a, b) {
    var aPriority = a.action === 'HOLD' ? 0 : 1;
    var bPriority = b.action === 'HOLD' ? 0 : 1;
    if (aPriority !== bPriority) return bPriority - aPriority;
    return (b.confidence || 0) - (a.confidence || 0);
  });

  sorted.forEach(function(item, i) {
    var el = document.createElement('div');
    el.className = 'tg-stream-item ' + item.action;
    el.style.animationDelay = (i * 0.06) + 's';

    var conf    = Math.round((item.confidence || 0) * 100);
    var buyPct  = Math.round((item.vote_buy   || 0) * 100);
    var sellPct = Math.round((item.vote_sell  || 0) * 100);
    var price   = item.price ? '$' + parseFloat(item.price).toFixed(2) : '';

    el.innerHTML = '<span class="tg-stream-sym">' + (item.icon || '') + ' ' + item.symbol + '</span>'
      + '<span class="tg-stream-action">' + item.action + '</span>'
      + '<span class="tg-stream-conf">' + conf + '%</span>'
      + '<span class="tg-stream-bars">'
      +   '<span class="tg-bar-buy"  style="width:' + buyPct + 'px" title="Buy votes"></span>'
      +   '<span class="tg-bar-sell" style="width:' + sellPct + 'px" title="Sell votes"></span>'
      + '</span>'
      + '<span class="tg-stream-price">' + price + '</span>'
      + (item.contributors ? '<span class="tg-stream-bots">' + item.contributors + ' bots</span>' : '');

    ticker.appendChild(el);
  });

  stream.innerHTML = '';
  stream.appendChild(ticker);
}

// ── Polymarket cards ──────────────────────────────────────────────────────────
window.tgLoadPolymarket = function() {
  // Write to whichever grid is currently visible
  var grid = document.getElementById('tg-poly-grid-tab') || document.getElementById('tg-poly-grid');
  if (!grid) return;
  grid.innerHTML = '<div class="tg-poly-loading">Loading prediction markets…</div>';

  rq('/api/tradgentic/polymarket/trending').then(function(d) {
    if (!d || !d.markets || !d.markets.length) {
      grid.innerHTML = '<div class="tg-poly-loading">No prediction markets available</div>';
      return;
    }
    _polyLoaded = true;
    // Render into active grid
    _renderPolyCards(d.markets, grid);
    // Also populate hidden room grid if it exists separately
    var roomGrid = document.getElementById('tg-poly-grid');
    if (roomGrid && roomGrid !== grid) {
      _renderPolyCards(d.markets, roomGrid);
    }
    _updateNNFlow(null, null, true);
  });
};

var CAT_COLORS = {
  Crypto:  '#F59E0B',
  Macro:   '#3B82F6',
  Politics:'#8B5CF6',
  Tech:    '#06B6D4',
  Energy:  '#F97316',
  Markets: '#10B981',
};

function _renderPolyCards(markets, grid) {
  grid.innerHTML = '';
  markets.slice(0, 12).forEach(function(m, i) {
    var card = _buildPolyCard(m, i);
    grid.appendChild(card);
  });
}

function _buildPolyCard(m, i) {
  var prob     = m.probability || 0;
  var pct      = Math.round(prob * 100);
  var noP      = 100 - pct;
  var trend    = m.trend || 'uncertain';
  var catColor = CAT_COLORS[m.category] || '#94A3B8';
  var isStrong = trend === 'strong_yes' || trend === 'strong_no';

  var trendIcon = {
    strong_yes:  '🟢 Strong YES',
    leaning_yes: '↗ Leaning YES',
    uncertain:   '↔ Uncertain',
    leaning_no:  '↘ Leaning NO',
    strong_no:   '🔴 Strong NO',
  }[trend] || '↔ Uncertain';

  var trendColor = trend.includes('yes') ? 'var(--gr)'
                 : trend.includes('no')  ? 'var(--re)'
                 : 'var(--am)';

  var vol = m.volume_24h >= 1e6
    ? '$' + (m.volume_24h / 1e6).toFixed(1) + 'M'
    : m.volume_24h >= 1e3
    ? '$' + (m.volume_24h / 1e3).toFixed(0) + 'K'
    : '$' + m.volume_24h;

  var div = document.createElement('div');
  div.className = 'tg-poly-card' + (isStrong ? ' trending-strong' : '');
  div.style.setProperty('--tg-poly-color', catColor);
  div.style.animationDelay = (i * 0.07) + 's';

  div.innerHTML = [
    '<div class="tg-poly-header">',
    '  <span class="tg-poly-question">' + _esc(m.question) + '</span>',
    '  <span class="tg-poly-cat" style="background:' + catColor + '18;color:' + catColor + ';border:1px solid ' + catColor + '30">' + m.category + '</span>',
    '</div>',
    '<div class="tg-poly-prob-wrap">',
    '  <div class="tg-poly-prob-row">',
    '    <span class="tg-poly-yes-label">YES</span>',
    '    <div class="tg-poly-bar-track">',
    '      <div class="tg-poly-bar-fill" style="width:' + pct + '%;background:' + (pct > 50 ? 'var(--gr)' : 'var(--re)') + '"></div>',
    '    </div>',
    '    <span class="tg-poly-no-label">NO</span>',
    '  </div>',
    '  <div class="tg-poly-prob-pct">',
    '    <span style="color:var(--gr);font-family:var(--fm);font-weight:800">' + pct + '%</span>',
    '    <span class="tg-poly-trend" style="color:' + trendColor + '">' + trendIcon + '</span>',
    '    <span style="color:var(--re);font-family:var(--fm);font-weight:800">' + noP + '%</span>',
    '  </div>',
    '</div>',
    '<div class="tg-poly-footer">',
    '  <span class="tg-poly-vol">Vol ' + vol + '</span>',
    (m.end_date ? '<span class="tg-poly-date">⏱ ' + m.end_date + '</span>' : ''),
    '</div>',
  ].join('');

  div.onclick = function() {
    if (m.slug) window.open('https://polymarket.com/event/' + m.slug, '_blank');
  };

  return div;
}

// ── PnL Snapshot + drawdown monitor ─────────────────────────────────────────
window.tgLoadPnlSnapshot = function() {
  rq('/api/tradgentic/pnl/snapshot').then(function(d) {
    if (!d || !d.bots) return;
    d.bots.forEach(function(snap) {
      _pnlCache[snap.bot_id] = snap;
      _trackDrawdown(snap);
      _updateCardPnl(snap);
    });
    _updateNNFlow(d.count, Object.keys(_pnlCache).length, _polyLoaded);
  });
};

// ── Extend _buildBotCard to add live-patch data attributes ──────────────────
// Monkey-patch: add data-bot-id and live-update classes to cards
var _origBuildBotCard = window._tgBuildBotCard_internal;

// Hook into tgLoadBots to attach live-patchable attributes
var _origLoadBots = window.tgLoadBots;
window.tgLoadBots = function() {
  if (_origLoadBots) _origLoadBots();
  // After bots load, refresh PnL
  setTimeout(tgLoadPnlSnapshot, 600);
};

// ── Auto-cycle: run aggregation every 60s when view is active ────────────────
setInterval(function() {
  if (typeof G !== 'undefined' && G.currentView === 'tradgentic') {
    if (!_aggRunning) tgRunAggregation();
  }
}, 60000);

// ── Boot: MutationObserver for class changes ─────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  var view = document.getElementById('view-tradgentic');
  if (!view) return;

  // Watch for class changes (handles sv() transitions)
  new MutationObserver(function(muts) {
    muts.forEach(function(m) {
      if (m.attributeName === 'class' && view.classList.contains('on')) {
        _tgActivated = true;
        _tgOnActivate();
      }
    });
  }).observe(view, { attributes: true, attributeFilter: ['class'] });

  // If already active at DOMContentLoaded (edge case)
  if (view.classList.contains('on')) {
    _tgActivated = true;
    _tgOnActivate();
  }
});

// ── Helper ────────────────────────────────────────────────────────────────────
function _fmt(n) {
  return parseFloat(n || 0).toLocaleString('en', { maximumFractionDigits: 0 });
}
function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ── Main tab switching ── */
window.tgMainTab = function(tab, btn) {
  document.querySelectorAll('.tg-main-tab').forEach(function(b){ b.classList.remove('on'); });
  document.querySelectorAll('.tg-main-panel').forEach(function(p){ p.classList.remove('on'); });
  if (btn) btn.classList.add('on');
  var panel = document.getElementById('tg-panel-' + tab);
  if (panel) panel.classList.add('on');

  if (tab === 'backtest') {
    if (typeof initBacktestLab === 'function') {
      if (!document.querySelector('#bt-lab-root .btl-header')) {
        initBacktestLab();
      }
    }
  }
  if (tab === 'features') {
    if (typeof initFeatureLab === 'function') {
      if (!document.querySelector('#fe-lab-root .fel-header')) {
        initFeatureLab();
      }
    }
  }
  if (tab === 'polymarket') {
    // Render directly into the tab grid
    _polyLoaded = false;
    tgLoadPolymarket();
  }
  if (tab === 'scanner') {
    var sgrid = document.getElementById('tg-scanner-grid-tab');
    var src2  = document.getElementById('tg-scanner-grid');
    if (sgrid && src2 && src2.children.length > 0) {
      sgrid.innerHTML = src2.innerHTML;
    } else if (sgrid) {
      tgLoadScanner();
    }
  }
};


})();

/* ═══════════ 25_backtest.js ═══════════ */
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
    ml_xgb:          { stop_pct:'p-stop-pct' },
    ml_ensemble:     { min_hist:'p-min-hist', oversold:'p-oversold', overbought:'p-overbought', stop_pct:'p-stop-pct' },
    ml_sentiment:    { threshold:'p-threshold', stop_pct:'p-stop-pct' },
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

/* ═══════════ 26_features.js ═══════════ */
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

/* ═══════════ 28_ml_bots.js ═══════════ */
/**
 * 28_ml_bots.js — Sprint B Frontend
 * ML bot cards, training flow, signal history, commentary.
 */
(function () {
'use strict';

/* ── Patch strategy maps ── */
window.STRATEGY_ICONS  = window.STRATEGY_ICONS  || {};
window.STRATEGY_COLORS = window.STRATEGY_COLORS || {};
STRATEGY_ICONS['ml_xgb']       = '🧠';
STRATEGY_ICONS['ml_ensemble']  = '⚡';
STRATEGY_ICONS['ml_sentiment'] = '📰';
STRATEGY_COLORS['ml_xgb']      = '#a78bfa';
STRATEGY_COLORS['ml_ensemble']  = '#f59e0b';
STRATEGY_COLORS['ml_sentiment'] = '#06b6d4';

/* ── Constants ── */
var ML_STRATEGY_IDS = { ml_xgb: 1, ml_ensemble: 1, ml_sentiment: 1 };

var ML_DESCRIPTIONS = {
  ml_xgb:       { icon:'🧠', label:'ML Gradient Boost', blurb:'Trains on 19 indicators · Predicts 5-bar direction' },
  ml_ensemble:  { icon:'⚡', label:'ML Ensemble',        blurb:'3-way vote: ML + MACD + RSI · Most robust' },
  ml_sentiment: { icon:'📰', label:'News Sentiment',     blurb:'WorldLens events + VIX + RSI filter · Unique signal' },
};

/* ══════════════════════════════════════════════════════════════
   WIZARD EXTENSION — add ML strategies to Step 1
   ══════════════════════════════════════════════════════════════ */

(function patchWizStep1() {
  var _check = setInterval(function () {
    if (typeof window._wizStep1 === 'function' || typeof window.tgWizSelectStrategy === 'function') {
      clearInterval(_check);

      var _orig = window._wizStep1;
      if (_orig) {
        window._wizStep1 = function () {
          var base = _orig();
          var extra = [
            '<div class="tg-strat-divider"><span>🤖 ML-Powered Strategies</span></div>',
            Object.keys(ML_DESCRIPTIONS).map(function (sid) {
              var meta = ML_DESCRIPTIONS[sid];
              var col  = STRATEGY_COLORS[sid] || '#a78bfa';
              var sel  = (typeof TG !== 'undefined' && TG.wiz && TG.wiz.strategy === sid) ? ' selected' : '';
              return '<div class="tg-strategy-card' + sel + '" style="--tg-color:' + col + '"'
                + ' onclick="tgWizSelectStrategy(\'' + sid + '\')">'
                + '<div class="tg-strat-icon">' + meta.icon + '</div>'
                + '<div class="tg-strat-name">' + meta.label + '</div>'
                + '<div class="tg-strat-desc">' + meta.blurb + '</div>'
                + '<div class="tg-ml-badge">ML</div>'
                + '</div>';
            }).join(''),
          ].join('');
          // Wrap base in a div so we can append
          return '<div class="tg-strategy-all">' + base + extra + '</div>';
        };
      }
    }
  }, 300);
})();

/* ══════════════════════════════════════════════════════════════
   BOT CARD EXTENSION — ML badges + train button
   ══════════════════════════════════════════════════════════════ */

/**
 * Called after _renderBotsGrid. Patches ML bot cards with
 * training status and signal source badge.
 */
window.mlPatchBotCards = function (bots) {
  if (!bots) return;
  bots.forEach(function (bot) {
    if (!ML_STRATEGY_IDS[bot.strategy]) return;
    var card = document.querySelector('[data-bot-id="' + bot.id + '"]');
    if (!card) return;
    _patchCard(card, bot);
  });
};

function _patchCard(card, bot) {
  var params = bot.params || {};
  var hasModel = !!params.model_b64;
  var meta    = ML_DESCRIPTIONS[bot.strategy] || {};
  var col     = STRATEGY_COLORS[bot.strategy] || '#a78bfa';
  var needsTraining = bot.strategy !== 'ml_sentiment';

  // Insert ML panel after tg-card-assets
  var assetsEl = card.querySelector('.tg-card-assets');
  if (!assetsEl) return;

  var existing = card.querySelector('.ml-card-panel');
  if (existing) existing.remove();

  var panel = document.createElement('div');
  panel.className = 'ml-card-panel';

  if (needsTraining) {
    if (!hasModel) {
      var trainingStatus = _TRAINING_STATUS[bot.id] || null;
      if (trainingStatus === 'running') {
        panel.innerHTML = [
          '<div class="ml-training-bar">',
          '  <div class="ml-train-txt">⏳ Training model…</div>',
          '  <div class="ml-train-progress" id="ml-prog-' + bot.id + '">',
          '    <div class="ml-train-fill" style="width:0%"></div>',
          '  </div>',
          '</div>',
        ].join('');
        _pollTraining(bot.id);
      } else {
        panel.innerHTML = [
          '<div class="ml-untrained">',
          '  <div class="ml-untrained-txt">Model not trained yet</div>',
          '  <button class="ml-train-btn" onclick="mlTrainBot(\'' + bot.id + '\',event)">',
          '    🧠 Train on historical data',
          '  </button>',
          '</div>',
        ].join('');
      }
    } else {
      var m     = params.model_metrics || {};
      var acc   = m.val_accuracy ? Math.round(m.val_accuracy * 100) : null;
      var edge  = m.edge ? (m.edge >= 0 ? '+' : '') + (m.edge * 100).toFixed(1) + '%' : null;
      var date  = m.trained_at ? m.trained_at.slice(0, 10) : '';
      panel.innerHTML = [
        '<div class="ml-trained-badge">',
        '  <span class="ml-trained-icon">✓</span>',
        '  <span class="ml-trained-label" style="color:' + col + '">Model trained</span>',
        acc  ? ('<span class="ml-trained-stat">' + acc + '% acc</span>') : '',
        edge ? ('<span class="ml-trained-stat" style="color:' + (m.edge > 0 ? '#10b981' : '#ef4444') + '">' + edge + ' edge</span>') : '',
        date ? ('<span class="ml-trained-stat" style="opacity:.5">' + date + '</span>') : '',
        '</div>',
        '<button class="ml-retrain-btn" onclick="mlTrainBot(\'' + bot.id + '\',event)">↺ Retrain</button>',
      ].join('');
    }
  } else {
    // Sentiment bot — always ready
    panel.innerHTML = '<div class="ml-trained-badge">'
      + '<span class="ml-trained-icon">✓</span>'
      + '<span class="ml-trained-label" style="color:' + col + '">Live sentiment signals</span>'
      + '</div>';
  }

  assetsEl.insertAdjacentElement('afterend', panel);
}

/* ── Training flow ── */
var _TRAINING_STATUS = {};
var _TRAINING_POLLS  = {};

window.mlTrainBot = function (botId, evt) {
  if (evt) evt.stopPropagation();
  _TRAINING_STATUS[botId] = 'running';
  mlPatchBotCardsForBot(botId);

  rq('/api/tradgentic/ml/train/' + botId, { method: 'POST', body: {} })
    .then(function (r) {
      if (r && r.status === 'training_started') {
        if (typeof toast === 'function') toast('🧠 Training started — ~90 seconds', 's', 3000);
        _pollTraining(botId);
      } else {
        _TRAINING_STATUS[botId] = null;
        if (typeof toast === 'function') toast((r && r.error) || 'Training failed', 'e', 3000);
      }
    });
};

function _pollTraining(botId) {
  if (_TRAINING_POLLS[botId]) return;
  _TRAINING_POLLS[botId] = setInterval(function () {
    rq('/api/tradgentic/ml/train/' + botId + '/status').then(function (r) {
      if (!r) return;
      var bar = document.getElementById('ml-prog-' + botId);
      if (bar) {
        var fill = bar.querySelector('.ml-train-fill');
        if (fill) fill.style.width = (r.pct || 0) + '%';
        var txt = bar.parentElement && bar.parentElement.querySelector('.ml-train-txt');
        if (txt) txt.textContent = r.message || '⏳ Training…';
      }
      if (r.status === 'complete' || r.status === 'failed') {
        clearInterval(_TRAINING_POLLS[botId]);
        delete _TRAINING_POLLS[botId];
        _TRAINING_STATUS[botId] = r.status;
        if (r.status === 'complete') {
          if (typeof toast === 'function') {
            var acc = r.val_accuracy ? Math.round(r.val_accuracy * 100) : '?';
            toast('✅ Model trained! Accuracy: ' + acc + '%', 's', 4000);
          }
          if (typeof obAwardAchievement === 'function') obAwardAchievement('ml_trained');
        } else {
          if (typeof toast === 'function') toast('Training failed: ' + (r.message || ''), 'e', 3000);
        }
        // Reload bots to refresh card
        if (typeof tgLoadBots === 'function') tgLoadBots();
      }
    });
  }, 4000);
}

function mlPatchBotCardsForBot(botId) {
  rq('/api/tradgentic/bots/' + botId).then(function (bot) {
    if (bot && !bot.error) {
      var card = document.querySelector('[data-bot-id="' + botId + '"]');
      if (card) _patchCard(card, bot);
    }
  });
}

/* ── Patch tgLoadBots to call mlPatchBotCards after render ── */
(function patchLoadBots() {
  var _check = setInterval(function () {
    if (typeof window.tgLoadBots === 'function') {
      clearInterval(_check);
      var _orig = window.tgLoadBots;
      window.tgLoadBots = function () {
        return _orig.apply(this, arguments).then
          ? _orig.apply(this, arguments).then(function () {
              if (typeof TG !== 'undefined' && TG.bots) mlPatchBotCards(TG.bots);
            })
          : _orig.apply(this, arguments);
      };
    }
  }, 400);
})();

/* ── Use /signal/v2 for regular bots to log history ── */
(function patchRunSignal() {
  var _check = setInterval(function () {
    if (typeof window.tgFetchSignals === 'function') {
      clearInterval(_check);
      var _orig = window.tgFetchSignals;
      window.tgFetchSignals = function (botId) {
        var wrap = document.getElementById('tg-signals-' + botId);
        if (wrap) wrap.innerHTML = '<div style="font-size:11px;color:var(--t3);padding:8px">Generating signal…</div>';

        var bot = (typeof TG !== 'undefined' && TG.bots)
          ? TG.bots.find(function (b) { return b.id === botId; })
          : null;
        var isML = bot && ML_STRATEGY_IDS[bot.strategy];
        var url  = isML
          ? '/api/tradgentic/ml/signal/' + botId
          : '/api/tradgentic/bots/' + botId + '/signal/v2';

        rq(url, { method: 'POST' }).then(function (d) {
          if (!wrap) return;
          var sigs = (d && d.signals) || {};
          if (!Object.keys(sigs).length) {
            wrap.innerHTML = '<div style="font-size:11px;color:var(--t3)">No signals</div>';
            return;
          }
          wrap.innerHTML = Object.entries(sigs).map(function (e) {
            var sym = e[0], s = e[1];
            var col = s.action === 'BUY' ? '#10b981' : s.action === 'SELL' ? '#ef4444' : '#f59e0b';
            var src = s.source ? '<span style="font-size:8px;opacity:.5;margin-left:4px">' + s.source + '</span>' : '';
            var prob = s.prob_up != null ? ' · P(↑)=' + Math.round(s.prob_up * 100) + '%' : '';
            var votes = s.votes ? _renderVotes(s.votes) : '';
            return '<div class="tg-signal-row">'
              + '<span style="font-family:var(--fm);font-size:11px;color:var(--t2)">' + sym + '</span>'
              + '<span class="tg-signal-badge ' + s.action + '" style="background:' + col + '1a;color:' + col + '">' + s.action + src + '</span>'
              + '<span style="font-size:9px;color:var(--t3);flex:1">' + (s.reason || '') + prob + '</span>'
              + votes
              + '</div>';
          }).join('');
        });
      };
    }
  }, 400);
})();

function _renderVotes(votes) {
  if (!votes || !Object.keys(votes).length) return '';
  return '<div class="ml-votes">'
    + Object.entries(votes).map(function (e) {
        var k = e[0], v = e[1];
        var col = v.action === 'BUY' ? '#10b981' : v.action === 'SELL' ? '#ef4444' : '#94a3b8';
        return '<span style="font-size:8px;color:' + col + ';font-family:var(--fm)">'
          + k + ':' + v.action + '</span>';
      }).join(' ');
}

/* ══════════════════════════════════════════════════════════════
   SIGNAL HISTORY PANEL
   ══════════════════════════════════════════════════════════════ */

window.mlShowSignalHistory = function (botId) {
  var panel = document.getElementById('ml-sig-history-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'ml-sig-history-panel';
    panel.className = 'ml-history-panel';
    document.body.appendChild(panel);
  }
  panel.innerHTML = '<div class="ml-history-inner">'
    + '<div class="ml-history-header">'
    + '  <div class="ml-history-title">📋 Signal History</div>'
    + '  <button onclick="mlCloseHistory()" style="background:none;border:none;color:var(--t3);font-size:20px;cursor:pointer">✕</button>'
    + '</div>'
    + '<div id="ml-history-body"><div style="text-align:center;padding:32px;color:var(--t3)"><div class="btl-spinner" style="margin:0 auto 12px"></div>Loading…</div></div>'
    + '</div>';
  panel.style.display = 'flex';
  setTimeout(function () { panel.classList.add('on'); }, 10);

  rq('/api/tradgentic/signals/history?bot_id=' + botId + '&limit=100').then(function (r) {
    var body = document.getElementById('ml-history-body');
    if (!body) return;
    if (!r || r.error) { body.innerHTML = '<div style="color:var(--re);padding:16px">Failed to load</div>'; return; }
    var stats = r.stats || {};
    var rows  = r.signals || [];
    body.innerHTML = _renderHistoryBody(rows, stats);
  });
};

window.mlCloseHistory = function () {
  var panel = document.getElementById('ml-sig-history-panel');
  if (!panel) return;
  panel.classList.remove('on');
  setTimeout(function () { panel.style.display = 'none'; }, 300);
};

function _renderHistoryBody(rows, stats) {
  var statHtml = '';
  if (stats.total) {
    statHtml = '<div class="ml-hist-stats">'
      + _histStat('Total', stats.total, 'var(--t2)')
      + _histStat('Win Rate', (stats.win_rate || 0) + '%', stats.win_rate > 55 ? '#10b981' : '#f59e0b')
      + _histStat('Avg Return', (stats.avg_return >= 0 ? '+' : '') + (stats.avg_return || 0).toFixed(2) + '%',
          stats.avg_return >= 0 ? '#10b981' : '#ef4444')
      + _histStat('Acted On', stats.acted_count || 0, '#3b82f6')
      + '</div>';
  }
  if (!rows.length) {
    return statHtml + '<div style="text-align:center;padding:32px;color:var(--t3)">No signals logged yet. Run the bot to start building history.</div>';
  }
  var tableRows = rows.map(function (r) {
    var actCol  = r.action === 'BUY' ? '#10b981' : r.action === 'SELL' ? '#ef4444' : '#94a3b8';
    var outCol  = r.outcome_label === 'WIN' ? '#10b981' : r.outcome_label === 'LOSS' ? '#ef4444' : '#94a3b8';
    var outTxt  = r.outcome_label || '—';
    if (r.outcome_return_pct != null) {
      outTxt += ' (' + (r.outcome_return_pct >= 0 ? '+' : '') + r.outcome_return_pct.toFixed(1) + '%)';
    }
    var acted = r.acted ? '✓' : '';
    return '<tr>'
      + '<td style="font-family:var(--fm);font-size:9px;color:var(--t3)">' + (r.signal_ts || '').slice(0, 10) + '</td>'
      + '<td style="font-family:var(--fm);font-size:10px">' + (r.symbol || '') + '</td>'
      + '<td><span style="color:' + actCol + ';font-weight:700;font-size:10px">' + r.action + '</span></td>'
      + '<td style="font-size:9px;color:var(--t3);font-family:var(--fm)">' + (r.strategy_id || '').replace(/_/g,' ') + '</td>'
      + '<td style="font-size:9px;color:var(--t3);max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + (r.reason || '') + '</td>'
      + '<td><span style="color:' + outCol + ';font-size:10px;font-weight:700">' + outTxt + '</span></td>'
      + '<td style="font-size:10px;color:#3b82f6;text-align:center">' + acted + '</td>'
      + '</tr>';
  }).join('');
  return statHtml
    + '<div class="ml-hist-table-wrap"><table class="ml-hist-table">'
    + '<thead><tr><th>Date</th><th>Symbol</th><th>Action</th><th>Strategy</th><th>Reason</th><th>Outcome</th><th>Traded</th></tr></thead>'
    + '<tbody>' + tableRows + '</tbody>'
    + '</table></div>'
    + '<div style="font-size:9px;color:var(--t3);padding:10px;text-align:center">'
    + 'Signal history is your training data. The more signals logged, the better future ML models become.'
    + '</div>';
}

function _histStat(label, val, col) {
  return '<div class="ml-hist-stat">'
    + '<div style="font-size:18px;font-family:var(--fh);font-weight:800;color:' + col + '">' + val + '</div>'
    + '<div style="font-size:9px;color:var(--t3);font-family:var(--fm)">' + label + '</div>'
    + '</div>';
}

/* ── Patch _buildBotCard to add History + ML signal buttons ── */
(function patchBotCardBtns() {
  var _check = setInterval(function () {
    if (typeof window._buildBotCard === 'undefined' && typeof window.tgLoadBots === 'function') {
      clearInterval(_check);
      return; // _buildBotCard is local — can't patch directly
    }
    clearInterval(_check);
  }, 300);
})();

/* ── Add "History" button to detail panel for all bots ── */
(function patchOpenDetail() {
  var _check = setInterval(function () {
    if (typeof window.tgOpenDetail === 'function') {
      clearInterval(_check);
      var _orig = window.tgOpenDetail;
      window.tgOpenDetail = function (botId) {
        _orig(botId);
        // After detail panel opens, inject history button if not present
        setTimeout(function () {
          var dh = document.getElementById('tg-detail-header');
          if (!dh || dh.querySelector('.ml-history-btn')) return;
          var btn = document.createElement('button');
          btn.className = 'ml-history-btn';
          btn.textContent = '📋 Signal History';
          btn.onclick = function () { mlShowSignalHistory(botId); };
          dh.querySelector('div').appendChild(btn);
        }, 200);
      };
    }
  }, 400);
})();

})();

/* ═══════════ 11_insiders.js ═══════════ */
/**
 * @file 11_insiders.js
 * @module WorldLens/Politici & Ricchi (Insider Trades)
 *
 * @description
 * US Congress trade disclosures (House + Senate Stock Watcher APIs),
 * SEC 13F institutional holdings (billionaires), news correlation alerts,
 * leaderboard, signals aggregation.
 *
 * All APIs used are free and require no authentication:
 *  - House Stock Watcher (S3 public bucket)
 *  - Senate Stock Watcher (S3 public bucket)
 *  - SEC EDGAR EFTS API
 *  - WorldLens /api/insiders/* backend
 *
 * @dependencies 01_globals.js, 02_core.js
 */

// ── State ───────────────────────────────────────────────────────
var INS = {
  loaded:      false,
  trades:      [],
  signals:     null,
  leaderboard: [],
  holdings:    [],
  alerts:      [],
  activeSub:   'congress',
  activeSubFull: 'congress-full',
};

var PARTY_COLORS = { D:'#3B82F6', R:'#EF4444', I:'#8B5CF6', '?':'#94A3B8' };
var PARTY_LABELS = { D:'Democrat', R:'Republican', I:'Independent', '?':'Unknown' };

var AMOUNT_ORDER = {
  "$1,001 - $15,000":         1,
  "$15,001 - $50,000":        2,
  "$50,001 - $100,000":       3,
  "$100,001 - $250,000":      4,
  "$250,001 - $500,000":      5,
  "$500,001 - $1,000,000":    6,
  "$1,000,001 - $5,000,000":  7,
  ">$5,000,000":              8,
};

function _amtLabel(range) {
  if (!range) return '—';
  // Shorten for display
  return range
    .replace('$1,001 - $15,000',        '$1K–$15K')
    .replace('$15,001 - $50,000',       '$15K–$50K')
    .replace('$50,001 - $100,000',      '$50K–$100K')
    .replace('$100,001 - $250,000',     '$100K–$250K')
    .replace('$250,001 - $500,000',     '$250K–$500K')
    .replace('$500,001 - $1,000,000',   '$500K–$1M')
    .replace('$1,000,001 - $5,000,000', '$1M–$5M')
    .replace('>$5,000,000',             '>$5M');
}

function _amtColor(range) {
  var order = AMOUNT_ORDER[range] || 0;
  if (order >= 7) return '#EF4444';
  if (order >= 5) return '#F59E0B';
  if (order >= 3) return '#60A5FA';
  return '#94A3B8';
}

function _txColor(type) {
  if (!type) return '#94A3B8';
  if (type.includes('purchase')) return '#10B981';
  if (type.includes('sale'))     return '#EF4444';
  if (type.includes('exchange')) return '#F59E0B';
  return '#94A3B8';
}

function _txIcon(type) {
  if (!type) return '·';
  if (type.includes('purchase')) return '▲';
  if (type.includes('sale'))     return '▼';
  return '⇄';
}

// ── Sub-navigation ───────────────────────────────────────────────
function setInsiderSub(sub, btn) {
  INS.activeSub = sub;
  document.querySelectorAll('#ins-subnav .ins-sub-btn').forEach(function(b) {
    b.classList.toggle('on', b.dataset.sub === sub);
  });
  document.querySelectorAll('#qtab-insiders .ins-panel').forEach(function(p) {
    p.classList.toggle('on', p.id === 'ins-' + sub);
  });
  _loadInsiderSub(sub, false);
}

function setInsiderSubFull(sub, btn) {
  INS.activeSubFull = sub;
  // Update subnav buttons in full view
  document.querySelectorAll('#view-insiders .ins-sub-btn').forEach(function(b) {
    b.classList.toggle('on', b.dataset.sub === sub);
  });
  document.querySelectorAll('#view-insiders .ins-panel').forEach(function(p) {
    p.classList.toggle('on', p.id === 'ins-' + sub);
  });
  _loadInsiderSub(sub.replace('-full',''), true);
}

function _loadInsiderSub(sub, full) {
  switch(sub) {
    case 'congress':    loadInsiderTrades(full); break;
    case 'signals':     loadInsiderSignals(full); break;
    case 'leaderboard': loadInsiderLeaderboard(full); break;
    case 'billionaires':loadInsiderBillionaires(full); break;
    case 'alerts':      loadInsiderAlerts(full); break;
  }
}

// ── Init: called when Markets > Insider Trades tab is opened,
//    or when Insiders nav item is clicked ────────────────────────
function initInsiders(full) {
  if (full) {
    loadInsiderTradesFull();
  } else {
    if (!INS.loaded) loadInsiderTrades(false);
  }
}

// ── Load Congress trades ─────────────────────────────────────────
async function loadInsiderTrades(full) {
  var suffix  = full ? '-f' : '';
  var chamberEl = el('ins-filter-chamber' + suffix);
  var partyEl   = el('ins-filter-party'   + suffix);
  var daysEl    = el('ins-filter-days'    + suffix);
  var tickerEl  = el('ins-filter-ticker'  + suffix);

  var chamber = chamberEl ? chamberEl.value : 'all';
  var party   = partyEl   ? partyEl.value   : '';
  var days    = daysEl    ? daysEl.value     : '90';
  var ticker  = tickerEl  ? tickerEl.value.trim() : '';

  var loadEl  = el('ins-trades-loading');
  var tableEl = el('ins-trades-table' + (full ? '-full' : ''));
  if (loadEl) { loadEl.style.display='block'; }
  if (tableEl) tableEl.innerHTML = '';

  var qs = '?chamber=' + chamber + '&days=' + days + (party ? '&party='+party : '') + (ticker ? '&ticker='+encodeURIComponent(ticker) : '');
  var r  = await rq('/api/insiders/congress/trades' + qs);
  INS.loaded = true;

  if (loadEl) loadEl.style.display = 'none';
  if (!r) {
    if (tableEl) tableEl.innerHTML = '<div style="padding:20px;color:var(--re);font-size:12px">Failed to load data. Check network connection.</div>';
    return;
  }

  INS.trades  = r.trades || [];
  INS.signals = r.signals || {};

  // Render summary pills
  var sumEl = el('ins-summary' + (full ? '-full' : ''));
  if (sumEl && INS.signals) _renderInsiderSummary(sumEl, INS.signals, r.total);

  // Render trades table
  if (tableEl) _renderTradesTable(tableEl, INS.trades, full);
}

function loadInsiderTradesFull() { loadInsiderTrades(true); }

function _renderInsiderSummary(el_, signals, total) {
  var topBuys  = (signals.top_buys  || []).slice(0,5);
  var topSells = (signals.top_sells || []).slice(0,5);
  var bigN     = (signals.big_trades || []).length;

  el_.innerHTML =
    '<div class="ins-summary-grid">' +
    '<div class="ins-sum-card">' +
      '<div class="ins-sum-title">Total Trades</div>' +
      '<div class="ins-sum-val">' + total + '</div>' +
    '</div>' +
    '<div class="ins-sum-card">' +
      '<div class="ins-sum-title">Large (>$500K)</div>' +
      '<div class="ins-sum-val" style="color:var(--am)">' + bigN + '</div>' +
    '</div>' +
    '<div class="ins-sum-card" style="flex:2">' +
      '<div class="ins-sum-title" style="color:var(--gr)">▲ Top Buys</div>' +
      '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">' +
      topBuys.map(function(b) {
        return '<span class="ins-ticker-pill buy" onclick="setInsiderTickerFilter(\'' + b.ticker + '\')">'
          + b.ticker + ' <span style="opacity:.6">×' + b.count + '</span></span>';
      }).join('') + '</div>' +
    '</div>' +
    '<div class="ins-sum-card" style="flex:2">' +
      '<div class="ins-sum-title" style="color:var(--re)">▼ Top Sells</div>' +
      '<div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:4px">' +
      topSells.map(function(b) {
        return '<span class="ins-ticker-pill sell" onclick="setInsiderTickerFilter(\'' + b.ticker + '\')">'
          + b.ticker + ' <span style="opacity:.6">×' + b.count + '</span></span>';
      }).join('') + '</div>' +
    '</div>' +
    '</div>';
}

function setInsiderTickerFilter(ticker) {
  var el1 = el('ins-filter-ticker'), el2 = el('ins-filter-ticker-f');
  if (el1) { el1.value = ticker; loadInsiderTrades(false); }
  if (el2) { el2.value = ticker; loadInsiderTrades(true);  }
}

function _renderTradesTable(container, trades, full) {
  if (!trades.length) {
    container.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:12px">No trades found for this filter.</div>';
    return;
  }

  var html = '<div class="ins-table-wrap"><table class="ins-table">'
    + '<thead><tr>'
    + '<th>Politician</th><th>Chamber</th><th>Ticker</th>'
    + '<th>Type</th><th>Amount</th><th>Trade Date</th>'
    + '<th>Disclosed</th><th>Lag</th><th>Action</th>'
    + '</tr></thead><tbody>';

  trades.forEach(function(t) {
    var partyCol = PARTY_COLORS[t.party] || '#94A3B8';
    var txCol    = _txColor(t.transaction_type);
    var amtCol   = _amtColor(t.amount_range);
    var lag      = t.disclosure_lag || 0;
    var lagCol   = lag > 40 ? 'var(--re)' : lag > 20 ? 'var(--am)' : 'var(--gr)';
    var chamberIcon = t.chamber === 'senate' ? '🏛' : '🏠';

    html += '<tr class="ins-tr" onclick="insiderTradeClick(\'' + t.ticker + '\', this)">'
      + '<td><div style="display:flex;align-items:center;gap:6px">'
      + '<span class="ins-party-dot" style="background:' + partyCol + '" title="' + PARTY_LABELS[t.party] + '"></span>'
      + '<div><div style="font-weight:600;font-size:11px;color:var(--t1)">' + (t.name||'') + '</div>'
      + '<div style="font-size:9px;color:var(--t3)">' + (t.state||'') + ' · ' + (PARTY_LABELS[t.party]||'') + '</div></div>'
      + '</div></td>'
      + '<td style="font-size:11px">' + chamberIcon + ' ' + (t.chamber||'') + '</td>'
      + '<td><span class="ins-ticker" onclick="selectMktAsset(\'' + t.ticker + '\',\'' + t.ticker + '\');event.stopPropagation()">' + t.ticker + '</span></td>'
      + '<td><span class="ins-tx-badge" style="color:' + txCol + ';border-color:' + txCol + '20;background:' + txCol + '12">'
      + _txIcon(t.transaction_type) + ' ' + (t.transaction_type||'').replace(/(^|\s)\S/g, function(x){return x.toUpperCase();})
      + '</span></td>'
      + '<td style="font-weight:600;font-size:11px;color:' + amtCol + '">' + _amtLabel(t.amount_range) + '</td>'
      + '<td style="font-size:10px;color:var(--t2)">' + (t.transaction_date||'').slice(0,10) + '</td>'
      + '<td style="font-size:10px;color:var(--t2)">' + (t.disclosure_date||'').slice(0,10) + '</td>'
      + '<td style="font-size:10px;font-weight:600;color:' + lagCol + '">' + lag + 'd</td>'
      + '<td><button class="btn btn-g btn-xs" onclick="selectMktAsset(\'' + t.ticker + '\',\'' + t.ticker + '\');event.stopPropagation()">Chart →</button></td>'
      + '</tr>';
  });

  html += '</tbody></table></div>';
  container.innerHTML = html;
  container.style.display = 'block';
}

function insiderTradeClick(ticker, row) {
  // Highlight row
  document.querySelectorAll('.ins-tr').forEach(function(r){ r.classList.remove('selected'); });
  row.classList.add('selected');
}

// ── Signals ───────────────────────────────────────────────────────
async function loadInsiderSignals(full) {
  var targetId = full ? 'ins-signals-full-content' : 'ins-signals-content';
  var target   = el(targetId);
  if (!target) return;
  target.innerHTML = '<div style="padding:16px;color:var(--t3)">Loading signals…</div>';

  var r = await rq('/api/insiders/congress/signals');
  if (!r) { target.innerHTML = '<div style="padding:16px;color:var(--re)">Failed to load signals.</div>'; return; }

  var topBuys  = (r.top_buys  || []).slice(0, 10);
  var topSells = (r.top_sells || []).slice(0, 10);
  var bigTrades= (r.big_trades|| []).slice(0, 8);

  target.innerHTML =
    '<div class="ins-sig-grid">' +
    '<div class="ins-sig-card">' +
      '<div class="ins-sig-title" style="color:var(--gr)">▲ Most Purchased</div>' +
      '<div class="ins-bar-list">' +
      topBuys.map(function(b, i) {
        var pct = Math.round(b.count / topBuys[0].count * 100);
        return '<div class="ins-bar-row" onclick="selectMktAsset(\'' + b.ticker + '\',\'' + b.ticker + '\')">'
          + '<span class="ins-bar-ticker">' + b.ticker + '</span>'
          + '<div class="ins-bar-bg"><div class="ins-bar-fill buy" style="width:' + pct + '%"></div></div>'
          + '<span class="ins-bar-count">' + b.count + ' trades</span>'
          + '</div>';
      }).join('') +
      '</div></div>' +
    '<div class="ins-sig-card">' +
      '<div class="ins-sig-title" style="color:var(--re)">▼ Most Sold</div>' +
      '<div class="ins-bar-list">' +
      topSells.map(function(b, i) {
        var pct = Math.round(b.count / topSells[0].count * 100);
        return '<div class="ins-bar-row" onclick="selectMktAsset(\'' + b.ticker + '\',\'' + b.ticker + '\')">'
          + '<span class="ins-bar-ticker">' + b.ticker + '</span>'
          + '<div class="ins-bar-bg"><div class="ins-bar-fill sell" style="width:' + pct + '%"></div></div>'
          + '<span class="ins-bar-count">' + b.count + ' trades</span>'
          + '</div>';
      }).join('') +
      '</div></div>' +
    '</div>' +
    '<div class="ins-sig-card" style="margin-top:12px">' +
      '<div class="ins-sig-title" style="color:var(--am)">💰 Large Trades (>$500K)</div>' +
      '<div class="ins-table-wrap"><table class="ins-table" style="margin-top:6px">' +
      '<thead><tr><th>Politician</th><th>Ticker</th><th>Type</th><th>Amount</th><th>Date</th></tr></thead><tbody>' +
      bigTrades.map(function(t) {
        var txCol = _txColor(t.transaction_type);
        return '<tr class="ins-tr">'
          + '<td style="font-weight:600;font-size:11px">' + t.name + ' <span style="color:' + (PARTY_COLORS[t.party]||'#94A3B8') + ';font-size:9px">(' + t.party + ')</span></td>'
          + '<td><span class="ins-ticker" onclick="selectMktAsset(\'' + t.ticker + '\',\'' + t.ticker + '\')">' + t.ticker + '</span></td>'
          + '<td style="color:' + txCol + ';font-weight:600;font-size:11px">' + _txIcon(t.transaction_type) + ' ' + (t.transaction_type||'').toUpperCase() + '</td>'
          + '<td style="font-weight:600;color:var(--am);font-size:11px">' + _amtLabel(t.amount_range) + '</td>'
          + '<td style="font-size:10px;color:var(--t3)">' + (t.disclosure_date||'').slice(0,10) + '</td>'
          + '</tr>';
      }).join('') +
      '</tbody></table></div></div>';
}

// ── Leaderboard ───────────────────────────────────────────────────
async function loadInsiderLeaderboard(full) {
  var targetId = full ? 'ins-lb-full-content' : 'ins-lb-content';
  var target   = el(targetId);
  if (!target) return;
  target.innerHTML = '<div style="padding:16px;color:var(--t3)">Loading leaderboard…</div>';

  var r = await rq('/api/insiders/leaderboard');
  if (!r || !r.leaderboard) {
    target.innerHTML = '<div style="padding:16px;color:var(--re)">Failed to load leaderboard.</div>';
    return;
  }

  INS.leaderboard = r.leaderboard;
  var html = '<div style="font-size:10px;color:var(--t3);margin-bottom:10px">' + r.total_members + ' members tracked · Ranked by trading activity</div>'
    + '<div class="ins-table-wrap"><table class="ins-table">'
    + '<thead><tr><th>#</th><th>Member</th><th>Chamber</th><th>Trades</th><th>Buys</th><th>Sells</th><th>Tickers</th><th>Large</th><th>Latest</th></tr></thead><tbody>';

  r.leaderboard.forEach(function(m, i) {
    var partyCol = PARTY_COLORS[m.party] || '#94A3B8';
    var medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i+1);
    html += '<tr class="ins-tr">'
      + '<td style="font-weight:700;color:var(--t3)">' + medal + '</td>'
      + '<td><div style="display:flex;align-items:center;gap:6px">'
      + '<span class="ins-party-dot" style="background:' + partyCol + '"></span>'
      + '<div><div style="font-weight:600;font-size:11px;color:var(--t1)">' + m.name + '</div>'
      + '<div style="font-size:9px;color:var(--t3)">' + m.state + '</div></div></div></td>'
      + '<td style="font-size:11px;color:var(--t2)">' + (m.chamber==='senate'?'🏛':'🏠') + ' ' + m.chamber + '</td>'
      + '<td style="font-weight:700;color:var(--t1)">' + m.total_trades + '</td>'
      + '<td style="color:var(--gr);font-weight:600">' + m.buys + '</td>'
      + '<td style="color:var(--re);font-weight:600">' + m.sells + '</td>'
      + '<td style="color:var(--b4)">' + m.unique_tickers + '</td>'
      + '<td style="color:var(--am)">' + m.big_trades + '</td>'
      + '<td style="font-size:9px;color:var(--t3)">' + (m.latest_trade||'').slice(0,10) + '</td>'
      + '</tr>';
  });

  target.innerHTML = html + '</tbody></table></div>';
}

// ── Billionaires 13F ──────────────────────────────────────────────
async function loadInsiderBillionaires(full) {
  var targetId = full ? 'ins-bill-full-grid' : 'ins-bill-grid';
  var target   = el(targetId);
  if (!target) return;
  target.innerHTML = '<div style="padding:16px;color:var(--t3)">Loading 13F filings…</div>';

  var r = await rq('/api/insiders/institutions/holdings/all');
  if (!r) {
    target.innerHTML = '<div style="padding:16px;color:var(--re)">Failed to load 13F data.</div>';
    return;
  }

  INS.holdings = r.holdings || [];
  var consensus = r.consensus || [];

  // Group by institution
  var byInst = {};
  INS.holdings.forEach(function(h) {
    if (!byInst[h.institution]) byInst[h.institution] = {name: h.institution, manager: h.manager, style: h.style, holdings: []};
    byInst[h.institution].holdings.push(h);
  });

  var consensusHtml = consensus.length
    ? '<div class="ins-consensus-bar"><span class="ins-con-label">🤝 Consensus Positions</span>'
      + consensus.slice(0,8).map(function(c) {
          return '<span class="ins-con-pill" onclick="selectMktAsset(\'' + c.ticker + '\',\'' + c.ticker + '\')">'
            + c.ticker + ' <span style="opacity:.6">×' + c.count + '</span></span>';
        }).join('')
      + '</div>'
    : '';

  var html = consensusHtml
    + '<div style="font-size:10px;color:var(--t3);margin-bottom:12px">'
    + (r.period || '') + ' · ' + (r.data_source || '') + ' · ' + (r.note || '') + '</div>'
    + '<div class="ins-bill-cards">';

  Object.values(byInst).forEach(function(inst) {
    html += '<div class="ins-bill-card">'
      + '<div class="ins-bill-header">'
      + '<div><div class="ins-bill-name">' + inst.name + '</div>'
      + '<div class="ins-bill-manager">' + inst.manager + '</div></div>'
      + '<span class="ins-bill-style">' + inst.style + '</span>'
      + '</div>'
      + '<div class="ins-bill-holdings">'
      + inst.holdings.map(function(h) {
          var changeIcon = h.change_type === 'new'       ? '✦ NEW'
                         : h.change_type === 'increased' ? '▲'
                         : h.change_type === 'decreased' ? '▼'
                         : '=';
          var changeCol  = h.change_type === 'new' || h.change_type === 'increased' ? 'var(--gr)'
                         : h.change_type === 'decreased' ? 'var(--re)' : 'var(--t3)';
          return '<div class="ins-hold-row" onclick="selectMktAsset(\'' + h.ticker + '\',\'' + h.ticker + '\')">'
            + '<span class="ins-ticker">' + h.ticker + '</span>'
            + '<div style="flex:1">'
            + '<div class="ins-hold-bar-bg"><div class="ins-hold-bar-fill" style="width:' + Math.min(100, h.pct_portfolio * 2) + '%"></div></div>'
            + '</div>'
            + '<span style="font-size:10px;color:var(--t2);white-space:nowrap">' + h.pct_portfolio.toFixed(1) + '%</span>'
            + '<span style="font-size:9px;color:' + changeCol + ';font-weight:700;min-width:40px;text-align:right">' + changeIcon + '</span>'
            + '</div>';
        }).join('')
      + '</div>'
      + '<div style="padding:7px 11px;border-top:1px solid var(--bd)">'
      + '<a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=' + _getCIK(inst.name) + '&type=13F-HR&dateb=&owner=include&count=5" '
      + 'target="_blank" style="font-size:9px;color:var(--b4)">View SEC EDGAR 13F filings ↗</a>'
      + '</div>'
      + '</div>';
  });

  target.innerHTML = html + '</div>';
}

function _getCIK(instName) {
  var CIKS = {
    "Berkshire Hathaway":"0001067983","Bridgewater Associates":"0001350694",
    "Pershing Square":"0001336528","Druckenmiller Family":"0001383312",
    "Baupost Group":"0001061219","Third Point":"0001040273",
    "Appaloosa Management":"0001418814","Soros Fund Management":"0001029160",
    "Icahn Enterprises":"0000049196","Elliott Investment":"0001051512",
    "Tiger Global":"0001167483","Renaissance Technologies":"0001037389",
  };
  return CIKS[instName] || "0001067983";
}

// ── Correlation Alerts ────────────────────────────────────────────
async function loadInsiderAlerts(full) {
  var targetId = full ? 'ins-alerts-full-content' : 'ins-alerts-content';
  var target   = el(targetId);
  if (!target) return;
  target.innerHTML = '<div style="padding:16px;color:var(--t3)">Scanning for correlations…</div>';

  var r = await rq('/api/insiders/alerts?days=14');
  if (!r) {
    target.innerHTML = '<div style="padding:16px;color:var(--re)">Failed to load alerts.</div>';
    return;
  }

  INS.alerts = r.alerts || [];

  if (!INS.alerts.length) {
    target.innerHTML = '<div style="padding:24px;text-align:center;color:var(--t3);font-size:12px">'
      + '🔍 No correlations found in the last 14 days.<br>'
      + '<span style="font-size:10px">Alerts appear when Congress members trade tickers that appear in WorldLens news events.</span>'
      + '</div>';
    return;
  }

  var html = '<div style="font-size:11px;color:var(--t3);margin-bottom:10px">'
    + INS.alerts.length + ' correlations found · Congress trades matched to WorldLens events</div>';

  INS.alerts.forEach(function(a) {
    var sev    = a.severity === 'high' ? 'var(--re)' : 'var(--am)';
    var trade  = a.trade || {};
    var event_ = a.event || {};
    var txCol  = _txColor(trade.transaction_type);

    html += '<div class="ins-alert-card">'
      + '<div class="ins-alert-header">'
      + '<span class="ins-alert-badge" style="background:' + sev + '22;border-color:' + sev + '44;color:' + sev + '">'
      + (a.severity === 'high' ? '🔴 HIGH' : '🟡 MEDIUM') + '</span>'
      + '<span style="font-size:9px;color:var(--t3)">' + (a.disclosure_date||'').slice(0,10) + '</span>'
      + '</div>'
      + '<div class="ins-alert-body">'
      + '<div class="ins-alert-trade">'
      + '<span style="font-weight:600;font-size:12px;color:var(--t1)">' + (trade.name||'') + '</span>'
      + ' <span style="font-size:10px;color:var(--t3)">(' + (trade.party||'') + ' · ' + (trade.state||'') + ')</span>'
      + '<span class="ins-tx-badge" style="color:' + txCol + ';border-color:' + txCol + '20;background:' + txCol + '12;margin-left:8px">'
      + _txIcon(trade.transaction_type) + ' ' + (trade.transaction_type||'').toUpperCase() + '</span>'
      + '<span class="ins-ticker" onclick="selectMktAsset(\'' + (trade.ticker||'') + '\',\'' + (trade.ticker||'') + '\')" style="margin-left:6px">' + (trade.ticker||'') + '</span>'
      + '<span style="font-size:10px;color:var(--am);margin-left:6px">' + _amtLabel(trade.amount_range) + '</span>'
      + '</div>'
      + '<div class="ins-alert-event" onclick="openEP(\'' + (event_.id||'') + '\')">'
      + '<span style="font-size:9px;color:var(--t3)">→ Related event: </span>'
      + '<span style="font-size:11px;color:var(--b4);cursor:pointer">' + (event_.title||'') + '</span>'
      + '<span class="tag tagH" style="margin-left:6px;font-size:8px">' + (event_.category||'') + '</span>'
      + '</div>'
      + (a.lag_days > 0 ? '<div style="font-size:9px;color:var(--t3);margin-top:4px">Disclosure lag: ' + a.lag_days + ' days (trade → public disclosure)</div>' : '')
      + '</div>'
      + '</div>';
  });

  target.innerHTML = html;
}

// ── Hook into sv() to init when insiders view is opened ──────────
var _origSv = typeof sv === 'function' ? sv : null;
if (typeof sv === 'function') {
  var _svOrig = sv;
  sv = function(view, btn) {
    _svOrig(view, btn);
    if (view === 'insiders') {
      setTimeout(function() { initInsiders(true); }, 100);
    }
  };
}

// ── Hook into setQuantTab for insiders tab in markets ────────────
var _origSetQuantTab = typeof setQuantTab === 'function' ? setQuantTab : null;
if (typeof setQuantTab === 'function') {
  var _sqtOrig = setQuantTab;
  setQuantTab = function(tab, btn) {
    _sqtOrig(tab, btn);
    if (tab === 'insiders') {
      setTimeout(function() { initInsiders(false); }, 100);
    }
  };
}

/* ═══════════ 06_supply_admin.js ═══════════ */
/**
 * @file 06_supply_admin.js
 * @module WorldLens/Supply Chain & Admin Dashboard
 *
 * @description
 * Supply chain intelligence module and full admin dashboard:
 * user management, event monitoring, AI provider settings, system info.
 *
 * @dependencies 01_globals.js, 02_core.js
 * @exports loadSupplyChain, enterAdmin, exitAdmin, adminNav, loadAdminOverview, loadAdminUsers, loadAdminEvents, loadAdminAI, loadAdminSettings
 */


// SUPPLY CHAIN INTELLIGENCE
// ════════════════════════════════════════════════════════

var G_SC = { loaded: false, map: null, markers: [], ready: false };
var G_EW = { loaded: false };

async function loadSupplyChain() {
  var r = await rq('/api/intelligence/supply-chain');
  if (!r || r.global_sc_stress === undefined) return;
  G_SC.data = r;

  var stress = r.global_sc_stress || 0;
  var stressCol = stress >= 7 ? '#EF4444' : stress >= 5 ? '#F97316' : stress >= 3.5 ? '#F59E0B' : '#10B981';

  // Hero
  var hero = el('sc-hero');
  if (hero) hero.style.opacity = '1';
  el('sc-stress').textContent = stress.toFixed(1);
  el('sc-stress').style.color = stressCol;
  setEl('sc-brief', r.ai_summary || '');
  setEl('sc-critical', r.critical_nodes || 0);
  setEl('sc-high', r.high_risk_nodes || 0);

  // Disruptions
  var disrupts = r.disruptions || [];
  var dcountEl = el('sc-disrupt-count');
  if (dcountEl) dcountEl.textContent = disrupts.length + ' active';
  var dEl = el('sc-disruptions');
  if (dEl) {
    dEl.innerHTML = disrupts.slice(0, 8).map(function(d) {
      var c = d.risk_color || '#F59E0B';
      return '<div class="sc-disruption">'
        + '<div class="sc-disruption-icon">' + d.icon + '</div>'
        + '<div>'
        + '<div class="sc-disruption-name">' + d.node_name + '</div>'
        + '<div class="sc-disruption-trigger">' + (d.trigger || '') + '</div>'
        + '<div style="font-size:9px;color:' + c + ';margin-top:3px">' + (d.type || '').replace('_', ' ') + ' &bull; ' + d.event_count + ' events</div>'
        + '</div>'
        + '<div class="sc-risk-badge" style="color:' + c + '">'
        + d.risk_score + '<br><span style="font-size:8px;opacity:.7">' + d.risk_level + '</span></div>'
        + '</div>';
    }).join('') || '<div style="color:var(--t3);font-size:11px;padding:8px 0">No significant disruptions detected</div>';
  }

  // Load sectors
  loadSCSectors();
  // Render map
  initSCMap(r.nodes || []);
}

async function loadSCSectors() {
  var r = await rq('/api/intelligence/supply-chain/sectors');
  if (!r || !r.sectors) return;
  var sEl = el('sc-sectors');
  if (!sEl) return;
  sEl.innerHTML = r.sectors.map(function(s) {
    var c = s.color || '#F59E0B';
    return '<div class="sc-sector">'
      + '<div class="sc-sector-name">' + s.sector + '</div>'
      + '<div class="sc-sector-exp" style="color:' + c + '">' + s.exposure + ' Risk — ' + s.risk_score + '/10</div>'
      + '<div class="sc-sector-bar"><div class="sc-sector-fill" style="width:' + (s.risk_score * 10) + '%;background:' + c + '"></div></div>'
      + '</div>';
  }).join('');
}

function initSCMap(nodes) {
  if (!nodes.length) return;
  // Wait for map element to be in a visible view
  var mapEl = document.getElementById('sc-map');
  if (!mapEl) return;
  if (G_SC.map) {
    updateSCMarkers(nodes);
    G_SC.map.invalidateSize();
    return;
  }

  var scMapStyle = document.createElement('style');
  scMapStyle.textContent = '#sc-map .leaflet-tile-pane{filter:invert(1) hue-rotate(200deg) brightness(0.65) saturate(0.5)}';
  document.head.appendChild(scMapStyle);

  G_SC.map = L.map('sc-map', {
    center: [20, 20], zoom: 2, zoomControl: true, minZoom: 2
  });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    subdomains: 'abc', maxZoom: 18, attribution: 'OSM', crossOrigin: false
  }).addTo(G_SC.map);
  G_SC.ready = true;
  updateSCMarkers(nodes);
  setTimeout(function() { G_SC.map.invalidateSize(); }, 200);
}

function updateSCMarkers(nodes) {
  if (!G_SC.map) return;
  G_SC.markers.forEach(function(m) { m.remove(); });
  G_SC.markers = [];

  var typeColors = {
    CHOKEPOINT:    '#EF4444',
    MAJOR_PORT:    '#F59E0B',
    CRITICAL_NODE: '#8B5CF6',
    TRADE_ROUTE:   '#06B6D4',
    EMERGING_ROUTE:'#10B981'
  };

  nodes.forEach(function(node) {
    if (!node.lat || !node.lon) return;
    var riskCol = node.risk_color || '#F59E0B';
    var typeCol = typeColors[node.type] || '#94A3B8';
    var r = Math.max(12, Math.min(32, 8 + node.risk_score * 2.2));
    var pulse = node.risk_score >= 7
      ? '<div style="position:absolute;inset:-5px;border-radius:50%;border:2px solid ' + riskCol + ';animation:pr 2s ease-out infinite;pointer-events:none"></div>'
      : '';
    var html = '<div style="width:' + (r*2) + 'px;height:' + (r*2) + 'px;border-radius:50%;'
      + 'background:' + riskCol + '22;border:2px solid ' + riskCol
      + ';box-shadow:0 0 ' + r + 'px ' + riskCol + '66;'
      + 'display:flex;align-items:center;justify-content:center;font-size:' + Math.max(10, Math.round(r/1.3)) + 'px;'
      + 'position:relative;cursor:pointer">'
      + pulse + node.icon + '</div>';
    var icon = L.divIcon({ html: html, className: '', iconSize: [r*2,r*2], iconAnchor: [r,r] });
    var mk = L.marker([node.lat, node.lon], { icon: icon });

    var topEvHtml = (node.top_events || []).slice(0,2).map(function(e) {
      return '<div style="font-size:10px;color:#94A3B8;margin-top:3px;padding-top:3px;border-top:1px solid rgba(255,255,255,.06)">'
        + e.title.slice(0,55) + '</div>';
    }).join('');

    mk.bindTooltip(
      '<div style="min-width:190px">'
      + '<div style="font-size:9px;color:' + typeCol + ';font-weight:700;text-transform:uppercase;margin-bottom:4px">' + (node.type||'').replace('_',' ') + '</div>'
      + '<div style="font-size:13px;font-weight:700;margin-bottom:4px;color:#F0F6FF">' + node.name + '</div>'
      + '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'
      + '<span style="color:' + riskCol + ';font-weight:700;font-family:monospace">' + node.risk_score + '/10</span>'
      + '<span style="color:' + riskCol + ';font-size:10px">' + (node.risk_level||'') + '</span>'
      + '</div>'
      + (node.relevant_events ? '<div style="font-size:10px;color:#4B5E7A">' + node.relevant_events + ' related events</div>' : '')
      + topEvHtml
      + '</div>',
      { permanent: false, direction: 'top', opacity: 1 }
    );

    mk.addTo(G_SC.map);
    G_SC.markers.push(mk);
  });
}

// ── Hook sv() to load views on first visit ────────────
var _sv_intel = sv;
sv = function(name, btn) {
  _sv_intel(name, btn);
  if (name === 'earlywarning' && !G_EW.loaded) {
    G_EW.loaded = true;
    setTimeout(loadEarlyWarning, 100);
  }
  if (name === 'markets') { initMarkets(); }
  if (name === 'supplychain' && !G_SC.loaded) {
    G_SC.loaded = true;
    setTimeout(loadSupplyChain, 150);
  }
};



// ════════════════════════════════════════════════════════

/* ═══════════ 29_sprint_c.js ═══════════ */
/**
 * 29_sprint_c.js — Sprint C: Explainer, Autopsy, Achievements, Leaderboard
 *
 * All Sprint C frontend in one file. Patches existing UI non-destructively.
 */
(function () {
'use strict';

/* ══════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════ */
var SC = {
  achievements: [],
  leaderboard:  [],
  explainerEl:  null,
};

/* ══════════════════════════════════════════════════════════════
   C1 — SIGNAL EXPLAINER
   Injects an "Explain ?" button next to each signal row.
   ══════════════════════════════════════════════════════════════ */

/**
 * Called from signal row after signal is fetched.
 * Adds "Explain" link below the signal reason text.
 */
window.scExplainSignal = function (payload) {
  rq('/api/tradgentic/explain/preview', { method: 'POST', body: payload })
    .then(function (r) {
      if (!r || r.error) return;
      _showExplainerOverlay(r);
    });
};

function _showExplainerOverlay(expl) {
  _removeExplainerOverlay();
  var el  = document.createElement('div');
  el.id   = 'sc-explainer-overlay';
  el.className = 'sc-overlay';

  var confColor = expl.confidence >= 65 ? '#10b981' : expl.confidence >= 45 ? '#f59e0b' : '#ef4444';
  var actColor  = expl.action === 'BUY' ? '#10b981' : expl.action === 'SELL' ? '#ef4444' : '#f59e0b';

  var reasonsHtml = (expl.reasons || []).map(function (r) {
    var bar = Math.round(Math.min(r.contrib || 0, 40) / 40 * 100);
    return '<div class="sc-reason">'
      + '<div class="sc-reason-header">'
      + '  <span class="sc-reason-icon">' + (r.icon || '•') + '</span>'
      + '  <span class="sc-reason-txt">' + r.text + '</span>'
      + '</div>'
      + (r.contrib ? '<div class="sc-reason-bar"><div style="width:' + bar + '%;background:' + (r.positive ? '#10b981' : '#ef4444') + '"></div></div>' : '')
      + '</div>';
  }).join('');

  var warningsHtml = (expl.warnings || []).map(function (w) {
    return '<div class="sc-warning">' + w.icon + ' ' + w.text + '</div>';
  }).join('');

  var riskHtml = '';
  var ri = expl.risk_info || {};
  if (ri.stop_loss || ri.take_profit) {
    riskHtml = '<div class="sc-risk-row">'
      + (ri.stop_loss    ? '<span class="sc-risk-pill red">SL $' + ri.stop_loss + ' (-' + ri.risk_pct + '%)</span>'   : '')
      + (ri.take_profit  ? '<span class="sc-risk-pill green">TP $' + ri.take_profit + ' (+' + ri.reward_pct + '%)</span>' : '')
      + (ri.risk_reward  ? '<span class="sc-risk-pill grey">R/R ' + ri.risk_reward + '</span>' : '')
      + '</div>';
  }

  el.innerHTML = '<div class="sc-overlay-inner">'
    + '<div class="sc-overlay-header">'
    + '  <div>'
    + '    <div class="sc-overlay-title">🔍 Signal Explained</div>'
    + '    <div class="sc-overlay-sub">' + expl.symbol + ' · ' + expl.strategy_id.replace(/_/g,' ') + '</div>'
    + '  </div>'
    + '  <button onclick="scCloseExplainer()" class="sc-close-btn">✕</button>'
    + '</div>'
    + '<div class="sc-summary-row">'
    + '  <div class="sc-action-badge" style="color:' + actColor + ';background:' + actColor + '15;border-color:' + actColor + '30">'
    + '    ' + expl.action + ' · $' + expl.price
    + '  </div>'
    + '  <div class="sc-conf-ring" style="border-color:' + confColor + '">'
    + '    <div class="sc-conf-val" style="color:' + confColor + '">' + expl.confidence + '</div>'
    + '    <div class="sc-conf-label">' + expl.conf_label + '</div>'
    + '  </div>'
    + '</div>'
    + '<div class="sc-summary-text">' + expl.summary + '</div>'
    + (reasonsHtml ? '<div class="sc-section-title">Why this signal fired:</div>' + reasonsHtml : '')
    + (warningsHtml ? '<div class="sc-section-title">⚠️ Risk factors:</div>' + warningsHtml : '')
    + riskHtml
    + '</div>';

  document.body.appendChild(el);
  SC.explainerEl = el;
  setTimeout(function () { el.classList.add('on'); }, 10);
}

window.scCloseExplainer = function () { _removeExplainerOverlay(); };
function _removeExplainerOverlay() {
  var el = document.getElementById('sc-explainer-overlay');
  if (!el) return;
  el.classList.remove('on');
  setTimeout(function () { el.remove(); }, 250);
  SC.explainerEl = null;
}

/* ── Patch tgFetchSignals to add Explain button ── */
(function patchFetchSignals() {
  var _check = setInterval(function () {
    if (typeof window.tgFetchSignals === 'function') {
      clearInterval(_check);
      var _orig = window.tgFetchSignals;
      window.tgFetchSignals = function (botId) {
        _orig(botId);
        // After signals render, add explain buttons
        setTimeout(function () {
          var wrap = document.getElementById('tg-signals-' + botId);
          if (!wrap) return;
          wrap.querySelectorAll('.tg-signal-row,[style*="display:flex"][style*="padding:7px"]').forEach(function (row) {
            if (row.querySelector('.sc-explain-btn')) return;
            var btn = document.createElement('button');
            btn.className = 'sc-explain-btn';
            btn.textContent = '?';
            btn.title = 'Explain this signal';
            btn.onclick = function (e) {
              e.stopPropagation();
              // Build payload from row context
              var sym   = (row.querySelector('[style*="font-family:var(--fm)"]') || {}).textContent || '';
              var badge = row.querySelector('.tg-signal-badge');
              var act   = badge ? badge.textContent.trim().split(/\s/)[0] : 'HOLD';
              var priceEl = row.querySelector('[style*="$"]');
              var pr    = priceEl ? parseFloat(priceEl.textContent.replace('$','')) : 0;
              var botData = typeof TG !== 'undefined' && TG.bots
                ? TG.bots.find(function (b) { return b.id === botId; }) : null;
              scExplainSignal({
                symbol:      sym.trim(),
                action:      act,
                price:       pr,
                strategy_id: (botData && botData.strategy) || 'unknown',
                features:    {},
                strength:    0.5,
              });
            };
            row.appendChild(btn);
          });
        }, 600);
      };
    }
  }, 400);
})();

/* ══════════════════════════════════════════════════════════════
   C2 — POST-TRADE AUTOPSY
   Shows in the recent trades list of the detail panel.
   ══════════════════════════════════════════════════════════════ */

window.scShowAutopsy = function (tradeId) {
  var overlay = document.createElement('div');
  overlay.id  = 'sc-autopsy-overlay';
  overlay.className = 'sc-overlay';
  overlay.innerHTML = '<div class="sc-overlay-inner">'
    + '<div class="sc-overlay-header"><div class="sc-overlay-title">🔬 Trade Autopsy</div>'
    + '<button onclick="scCloseAutopsy()" class="sc-close-btn">✕</button></div>'
    + '<div id="sc-autopsy-body"><div style="text-align:center;padding:32px;color:var(--t3)"><div class="btl-spinner" style="margin:0 auto 12px"></div>Analysing trade…</div></div>'
    + '</div>';
  document.body.appendChild(overlay);
  setTimeout(function () { overlay.classList.add('on'); }, 10);

  rq('/api/tradgentic/autopsy/trade/' + tradeId).then(function (r) {
    var body = document.getElementById('sc-autopsy-body');
    if (!body) return;
    if (!r || r.error) { body.innerHTML = '<div style="color:var(--re);padding:16px">' + (r && r.error || 'Failed') + '</div>'; return; }
    var outcomeColor = r.outcome === 'WIN' ? '#10b981' : r.outcome === 'LOSS' ? '#ef4444' : '#94a3b8';
    var pnlStr = (r.pnl >= 0 ? '+' : '') + '$' + Math.abs(r.pnl).toFixed(0)
               + ' (' + (r.pnl_pct >= 0 ? '+' : '') + r.pnl_pct.toFixed(1) + '%)';

    body.innerHTML = [
      '<div class="sc-autopsy-outcome" style="border-color:' + outcomeColor + '33;background:' + outcomeColor + '0c">',
      '  <div class="sc-aut-badge" style="color:' + outcomeColor + '">' + r.outcome + '</div>',
      '  <div>',
      '    <div class="sc-aut-sym">' + r.symbol + '</div>',
      '    <div class="sc-aut-pnl" style="color:' + outcomeColor + '">' + pnlStr + '</div>',
      '    <div class="sc-aut-setup">' + (r.setup_quality || '') + '</div>',
      '  </div>',
      '</div>',
      r.worked.length ? '<div class="sc-section-title">✅ What worked:</div>'
        + r.worked.map(function (t) { return '<div class="sc-autopsy-item worked">' + t + '</div>'; }).join('') : '',
      r.failed.length ? '<div class="sc-section-title">❌ What went wrong:</div>'
        + r.failed.map(function (t) { return '<div class="sc-autopsy-item failed">' + t + '</div>'; }).join('') : '',
      r.lessons.length ? '<div class="sc-section-title">💡 Key lesson:</div>'
        + '<div class="sc-lesson">' + r.lessons[0] + '</div>' : '',
      '<div class="sc-autopsy-summary">' + r.summary + '</div>',
    ].join('');
  });
};

window.scCloseAutopsy = function () {
  var el = document.getElementById('sc-autopsy-overlay');
  if (!el) return;
  el.classList.remove('on');
  setTimeout(function () { el.remove(); }, 250);
};

/* ── Patch _buildDetailHTML to add autopsy buttons ── */
(function patchDetailHTML() {
  var _check = setInterval(function () {
    if (typeof window.tgOpenDetail === 'function') {
      clearInterval(_check);
      var _orig = window.tgOpenDetail;
      window.tgOpenDetail = function (botId) {
        _orig(botId);
        setTimeout(function () {
          document.querySelectorAll('.tg-trade-row').forEach(function (row) {
            if (row.querySelector('.sc-autopsy-btn')) return;
            var pnlEl = row.querySelector('.tg-trade-pnl.neg, .tg-trade-pnl.pos');
            if (!pnlEl) return;
            var btn = document.createElement('button');
            btn.className = 'sc-autopsy-btn';
            btn.textContent = '🔬';
            btn.title = 'Post-trade autopsy';
            // tradeId stored as data-trade-id on row (we'll also patch _buildDetailHTML)
            btn.onclick = function (e) {
              e.stopPropagation();
              var tid = row.dataset.tradeId;
              if (tid) scShowAutopsy(tid);
            };
            row.appendChild(btn);
          });
          // Also add bot-level autopsy summary
          var body = document.getElementById('tg-detail-body');
          if (body && !body.querySelector('.sc-bot-autopsy-btn')) {
            var sumBtn = document.createElement('button');
            sumBtn.className = 'sc-bot-autopsy-btn';
            sumBtn.textContent = '🔬 Pattern Analysis';
            sumBtn.onclick = function () { scShowBotAutopsy(botId); };
            var lastBlock = body.querySelector('[style*="display:flex"][style*="gap:8px"][style*="margin-top"]');
            if (lastBlock) lastBlock.insertBefore(sumBtn, lastBlock.firstChild);
          }
        }, 300);
      };
    }
  }, 400);
})();

window.scShowBotAutopsy = function (botId) {
  rq('/api/tradgentic/autopsy/bot/' + botId).then(function (r) {
    if (!r || r.error || !r.patterns) return;
    var overlay = document.createElement('div');
    overlay.id  = 'sc-autopsy-overlay';
    overlay.className = 'sc-overlay';
    overlay.innerHTML = '<div class="sc-overlay-inner">'
      + '<div class="sc-overlay-header"><div class="sc-overlay-title">📊 Pattern Analysis</div>'
      + '<button onclick="scCloseAutopsy()" class="sc-close-btn">✕</button></div>'
      + '<div class="sc-bot-stats">'
      + '  <div class="sc-bs-item"><div class="sc-bs-val">' + r.n_trades + '</div><div class="sc-bs-label">Trades</div></div>'
      + '  <div class="sc-bs-item"><div class="sc-bs-val" style="color:' + (r.win_rate >= 50 ? '#10b981' : '#ef4444') + '">' + r.win_rate + '%</div><div class="sc-bs-label">Win Rate</div></div>'
      + '  <div class="sc-bs-item"><div class="sc-bs-val" style="color:#10b981">+$' + Math.abs(r.avg_win).toFixed(0) + '</div><div class="sc-bs-label">Avg Win</div></div>'
      + '  <div class="sc-bs-item"><div class="sc-bs-val" style="color:#ef4444">-$' + Math.abs(r.avg_loss).toFixed(0) + '</div><div class="sc-bs-label">Avg Loss</div></div>'
      + '</div>'
      + (r.patterns || []).map(function (p) {
          var col = p.type === 'positive' ? '#10b981' : '#f59e0b';
          return '<div class="sc-autopsy-item" style="border-left-color:' + col + '">' + p.text + '</div>';
        }).join('')
      + '</div>';
    document.body.appendChild(overlay);
    setTimeout(function () { overlay.classList.add('on'); }, 10);
  });
};

/* ══════════════════════════════════════════════════════════════
   C3 — ACHIEVEMENTS PANEL
   ══════════════════════════════════════════════════════════════ */

window.scShowAchievements = function () {
  var overlay = document.createElement('div');
  overlay.id  = 'sc-ach-overlay';
  overlay.className = 'sc-overlay';
  overlay.innerHTML = '<div class="sc-overlay-inner sc-overlay-wide">'
    + '<div class="sc-overlay-header">'
    + '  <div><div class="sc-overlay-title">🏆 Achievements</div><div id="sc-ach-xp-sub" class="sc-overlay-sub"></div></div>'
    + '  <button onclick="document.getElementById(\'sc-ach-overlay\').remove()" class="sc-close-btn">✕</button>'
    + '</div>'
    + '<div id="sc-ach-body"><div style="text-align:center;padding:32px;color:var(--t3)"><div class="btl-spinner" style="margin:0 auto 12px"></div></div></div>'
    + '</div>';
  document.body.appendChild(overlay);
  setTimeout(function () { overlay.classList.add('on'); }, 10);

  rq('/api/tradgentic/achievements').then(function (r) {
    if (!r) return;
    var body = document.getElementById('sc-ach-body');
    var sub  = document.getElementById('sc-ach-xp-sub');
    if (!body) return;
    if (sub) sub.textContent = r.earned_count + ' earned · ' + (r.total_xp || 0) + ' XP from trading';

    var earned = (r.achievements || []).filter(function (a) { return !a.locked; });
    var locked = (r.achievements || []).filter(function (a) { return  a.locked; });

    body.innerHTML = '<div class="sc-ach-grid">'
      + earned.map(function (a) { return _achCard(a, false); }).join('')
      + locked.map(function (a) { return _achCard(a, true);  }).join('')
      + '</div>';
  });
};

function _achCard(a, locked) {
  var emoji = a.title.match(/^[\S]+/)[0];
  var name  = a.title.replace(/^[\S]+\s*/, '');
  return '<div class="sc-ach-card' + (locked ? ' sc-ach-locked' : '') + '">'
    + '<div class="sc-ach-icon">' + emoji + '</div>'
    + '<div class="sc-ach-name">' + name + '</div>'
    + '<div class="sc-ach-desc">' + (a.description || a.desc || '') + '</div>'
    + '<div class="sc-ach-xp" style="color:' + (locked ? 'var(--t4)' : '#f59e0b') + '">'
    + (locked ? '🔒 ' : '✓ ') + a.xp + ' XP'
    + '</div>'
    + (!locked && a.earned_at ? '<div class="sc-ach-date">' + (a.earned_at||'').slice(0,10) + '</div>' : '')
    + '</div>';
}

/* ── Award achievement from frontend events ── */
window.scAward = function (key, botId) {
  rq('/api/tradgentic/achievements/award', {
    method: 'POST',
    body: { key: key, bot_id: botId || null }
  }).then(function (r) {
    if (r && r.awarded && r.achievement) {
      var a = r.achievement;
      if (typeof toast === 'function') {
        toast('🏆 ' + a.title + ' — ' + a.desc + ' (+' + a.xp + ' XP)', 's', 5000);
      }
    }
  });
};

/* ══════════════════════════════════════════════════════════════
   C4 — LEADERBOARD PANEL
   ══════════════════════════════════════════════════════════════ */

window.scShowLeaderboard = function () {
  var overlay = document.createElement('div');
  overlay.id  = 'sc-lb-overlay';
  overlay.className = 'sc-overlay';
  overlay.innerHTML = '<div class="sc-overlay-inner sc-overlay-wide">'
    + '<div class="sc-overlay-header">'
    + '  <div><div class="sc-overlay-title">🏆 Leaderboard</div><div class="sc-overlay-sub">Anonymous paper-trading rankings</div></div>'
    + '  <button onclick="document.getElementById(\'sc-lb-overlay\').remove()" class="sc-close-btn">✕</button>'
    + '</div>'
    + '<div id="sc-lb-body"><div style="text-align:center;padding:32px;color:var(--t3)"><div class="btl-spinner" style="margin:0 auto 12px"></div></div></div>'
    + '</div>';
  document.body.appendChild(overlay);
  setTimeout(function () { overlay.classList.add('on'); }, 10);

  Promise.all([
    rq('/api/tradgentic/leaderboard?period=all'),
    rq('/api/tradgentic/leaderboard/submit', { method: 'POST', body: {} }),
  ]).then(function (results) {
    var r    = results[0];
    var body = document.getElementById('sc-lb-body');
    if (!body || !r) return;
    var entries = r.entries || [];
    if (!entries.length) {
      body.innerHTML = '<div style="text-align:center;padding:32px;color:var(--t3)">No entries yet. Run your bots to appear here!</div>';
      return;
    }
    body.innerHTML = '<table class="sc-lb-table">'
      + '<thead><tr><th>#</th><th>Trader</th><th>Return</th><th>Sharpe</th><th>Win Rate</th><th>Trades</th><th>Strategy</th></tr></thead>'
      + '<tbody>'
      + entries.map(function (e, i) {
          var retCol = e.total_return_pct >= 0 ? '#10b981' : '#ef4444';
          var medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (i + 1) + '.';
          return '<tr>'
            + '<td style="font-size:14px">' + medal + '</td>'
            + '<td style="font-family:var(--fm);font-weight:700">' + e.handle + '</td>'
            + '<td style="color:' + retCol + ';font-weight:700">' + (e.total_return_pct >= 0 ? '+' : '') + e.total_return_pct + '%</td>'
            + '<td>' + e.sharpe + '</td>'
            + '<td>' + e.win_rate + '%</td>'
            + '<td>' + e.n_trades + '</td>'
            + '<td style="font-size:10px;color:var(--t3)">' + (e.best_strategy||'').replace(/_/g,' ') + '</td>'
            + '</tr>';
        }).join('')
      + '</tbody></table>'
      + '<div style="font-size:9px;color:var(--t4);padding:10px;text-align:center">Handles are anonymised. Your identity is never disclosed.</div>';
  });
};

/* ══════════════════════════════════════════════════════════════
   INJECT BUTTONS INTO TRADGENTIC ROOM TOPBAR
   ══════════════════════════════════════════════════════════════ */

(function injectRoomButtons() {
  var _check = setInterval(function () {
    var topbar = document.querySelector('#tg-panel-room .tg-topbar-actions');
    if (!topbar) return;
    clearInterval(_check);
    if (topbar.querySelector('.sc-room-btn')) return;

    var html = [
      '<button class="sc-room-btn" onclick="scShowAchievements()" title="Achievements">🏆</button>',
      '<button class="sc-room-btn" onclick="scShowLeaderboard()"  title="Leaderboard">📊</button>',
    ].join('');

    var frag = document.createElement('div');
    frag.style.display = 'flex';
    frag.style.gap     = '4px';
    frag.innerHTML     = html;
    topbar.insertBefore(frag, topbar.firstChild);
  }, 500);
})();

/* ── Award achievements from existing bot/backtest events ── */
(function hookAchievements() {
  /* Hook tgRunBot success */
  var _chk1 = setInterval(function () {
    if (typeof window.tgRunBot === 'function') {
      clearInterval(_chk1);
      var _orig = window.tgRunBot;
      window.tgRunBot = function () {
        _orig.apply(this, arguments);
        setTimeout(function () { scAward('first_trade'); }, 2000);
      };
    }
  }, 400);
  /* Hook btlRun success */
  var _chk2 = setInterval(function () {
    if (typeof window.btlRun === 'function') {
      clearInterval(_chk2);
      var _orig = window.btlRun;
      window.btlRun = function () {
        _orig.apply(this, arguments);
        scAward('first_backtest');
      };
    }
  }, 400);
})();

})();
