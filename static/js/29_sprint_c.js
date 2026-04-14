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
