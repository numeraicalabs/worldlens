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

