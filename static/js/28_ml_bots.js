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
