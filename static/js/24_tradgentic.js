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
window.initTradgentic = function() {
  if (!G.token) return;
  tgLoadStrategies();
  tgLoadBots();
  tgLoadScanner();
};

// ── Data loading ──────────────────────────────────────────────────────────────
function tgLoadStrategies() {
  rq('/api/tradgentic/strategies').then(function(d) {
    if (Array.isArray(d)) TG.strategies = d;
  });
}

window.tgLoadBots = function() {
  rq('/api/tradgentic/bots').then(function(d) {
    if (!Array.isArray(d)) return;
    TG.bots = d;
    _renderBotsGrid(d);
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
    grid.innerHTML = '';
    if (empty) { empty.style.display = 'flex'; grid.appendChild(empty); }
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
    '  <div class="tg-pnl-item"><div class="tg-pnl-label">Equity</div><div class="tg-pnl-val">$' + _fmt(equity) + '</div></div>',
    '  <div class="tg-pnl-item"><div class="tg-pnl-label">Return</div><div class="tg-pnl-val ' + retClass + '">' + retPrefix + ret.toFixed(2) + '%</div></div>',
    '  <div class="tg-pnl-item"><div class="tg-pnl-label">Win Rate</div><div class="tg-pnl-val">' + winRate.toFixed(0) + '%</div></div>',
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

})();
