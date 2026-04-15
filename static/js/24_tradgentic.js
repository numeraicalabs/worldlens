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
