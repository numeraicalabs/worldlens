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
