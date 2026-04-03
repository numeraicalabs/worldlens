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
