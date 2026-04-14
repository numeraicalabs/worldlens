/**
 * 27_onboarding.js — Sprint A: Guided onboarding for non-experts
 *
 * A1 — Profile quiz (2 questions → recommended bot)
 * A2 — Bot Template Library (gallery with pre-computed backtest)
 * A3 — Tooltip glossary (plain-language metric explanations)
 * A4 — Live commentary on bot cards
 */
(function () {
'use strict';

/* ══════════════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════════════ */
var OB = {
  templates:    [],
  glossary:     {},
  quiz:         { goal: null, risk: null },
  recommended:  null,
  tooltipEl:    null,
};

var RISK_PARAMS = {
  conservative: { stop_pct_override: 1.5, max_assets: 2, label: 'Conservative',  color: '#10b981' },
  moderate:     { stop_pct_override: 3.0, max_assets: 4, label: 'Moderate',       color: '#3b82f6' },
  aggressive:   { stop_pct_override: 5.0, max_assets: 8, label: 'Aggressive',     color: '#f59e0b' },
};

var GRADE_META = {
  'S': { color: '#f59e0b', bg: 'rgba(245,158,11,.12)', label: 'Elite' },
  'A': { color: '#10b981', bg: 'rgba(16,185,129,.12)', label: 'Strong' },
  'B': { color: '#3b82f6', bg: 'rgba(59,130,246,.12)', label: 'Good' },
  'C': { color: '#94a3b8', bg: 'rgba(148,163,184,.08)', label: 'Average' },
  'D': { color: '#f97316', bg: 'rgba(249,115,22,.1)',  label: 'Weak' },
  'F': { color: '#ef4444', bg: 'rgba(239,68,68,.12)', label: 'Poor' },
};

/* ══════════════════════════════════════════════════════════════
   A1 — PROFILE QUIZ
   ══════════════════════════════════════════════════════════════ */

/** Called from tgOpenWizard override — shows quiz before step 1 */
window.tgOpenWizardGuided = function () {
  OB.quiz = { goal: null, risk: null };
  var overlay = document.getElementById('tg-wizard');
  if (overlay) overlay.style.display = 'flex';
  _showQuiz();
};

function _showQuiz() {
  var title   = document.getElementById('tg-wiz-title');
  var content = document.getElementById('tg-wiz-content');
  var steps   = document.getElementById('tg-steps');
  var nav     = document.querySelector('.tg-wizard-nav');
  if (!content) return;

  if (title)  title.textContent = '👋 Let\'s find your ideal bot';
  if (steps)  steps.style.display = 'none';
  if (nav)    nav.style.display   = 'none';

  content.innerHTML = [
    '<div class="quiz-wrap">',
    '  <div class="quiz-intro">Answer 2 quick questions and we\'ll configure the perfect bot for you.</div>',

    /* Q1 — Goal */
    '  <div class="quiz-question">',
    '    <div class="quiz-q-label">1. What\'s your main goal?</div>',
    '    <div class="quiz-options" id="quiz-goals">',
    _quizOption('goal', 'protect',   '🛡️', 'Protect my savings',    'Avoid big losses above all'),
    _quizOption('goal', 'grow_tech', '🚀', 'Grow with tech stocks', 'Higher returns, OK with ups and downs'),
    _quizOption('goal', 'diversify', '🌍', 'Diversify globally',    'Spread across stocks, gold, bonds, crypto'),
    _quizOption('goal', 'learn',     '📚', 'Learn how it works',    'Understand trading through practice'),
    '    </div>',
    '  </div>',

    /* Q2 — Risk */
    '  <div class="quiz-question" id="quiz-q2" style="opacity:.35;pointer-events:none">',
    '    <div class="quiz-q-label">2. How much risk can you handle?</div>',
    '    <div class="quiz-options" id="quiz-risks">',
    _quizOption('risk', 'conservative', '🐢', 'Conservative', 'Small swings. Max -10% before I panic.'),
    _quizOption('risk', 'moderate',     '⚖️', 'Moderate',     'Normal swings. I\'d hold through -20%.'),
    _quizOption('risk', 'aggressive',   '🦁', 'Aggressive',   'Big swings OK. I\'m in it long-term.'),
    '    </div>',
    '  </div>',

    /* CTA */
    '  <div id="quiz-cta" style="display:none;margin-top:20px;text-align:center">',
    '    <button class="quiz-cta-btn" onclick="obRunQuiz()">See My Recommended Bot →</button>',
    '    <div style="margin-top:10px">',
    '      <button class="quiz-skip-btn" onclick="obSkipQuiz()">Skip — I\'ll configure manually</button>',
    '    </div>',
    '  </div>',

    '  <div style="text-align:center;margin-top:8px">',
    '    <button class="quiz-skip-btn" onclick="obSkipQuiz()" id="quiz-skip-top">Skip quiz →</button>',
    '  </div>',
    '</div>',
  ].join('');
}

function _quizOption(group, value, icon, label, sub) {
  return '<div class="quiz-option" id="qo-' + value + '" onclick="obSelectQuiz(\'' + group + '\',\'' + value + '\')">'
    + '<div class="quiz-opt-icon">' + icon + '</div>'
    + '<div><div class="quiz-opt-label">' + label + '</div>'
    + '<div class="quiz-opt-sub">' + sub + '</div></div>'
    + '</div>';
}

window.obSelectQuiz = function (group, value) {
  document.querySelectorAll('#quiz-' + group + 's .quiz-option').forEach(function (el) {
    el.classList.remove('selected');
  });
  var el = document.getElementById('qo-' + value);
  if (el) el.classList.add('selected');
  OB.quiz[group] = value;

  if (group === 'goal') {
    var q2 = document.getElementById('quiz-q2');
    if (q2) { q2.style.opacity = '1'; q2.style.pointerEvents = 'auto'; }
  }
  if (OB.quiz.goal && OB.quiz.risk) {
    var cta = document.getElementById('quiz-cta');
    if (cta) cta.style.display = 'block';
  }
};

window.obRunQuiz = function () {
  if (!OB.quiz.goal || !OB.quiz.risk) return;
  var content = document.getElementById('tg-wiz-content');
  if (content) content.innerHTML = '<div style="text-align:center;padding:40px;color:var(--t3)"><div class="btl-spinner" style="margin:0 auto 12px"></div>Finding your bot…</div>';

  rq('/api/tradgentic/profile-quiz', {
    method: 'POST',
    body: { goal: OB.quiz.goal, risk: OB.quiz.risk },
  }).then(function (r) {
    if (!r || r.error) { obSkipQuiz(); return; }
    OB.recommended  = r.recommended_template;
    OB.templates    = r.all_templates || [];
    _showRecommendation(r.template, r.recommended_template);
  }).catch(function () { obSkipQuiz(); });
};

function _showRecommendation(template, templateId) {
  var title   = document.getElementById('tg-wiz-title');
  var content = document.getElementById('tg-wiz-content');
  var nav     = document.querySelector('.tg-wizard-nav');
  if (title)  title.textContent = '✅ Your recommended bot';
  if (nav)    nav.style.display = 'none';

  if (!template) { obSkipQuiz(); return; }
  var bt  = template.backtest || {};
  var gm  = GRADE_META[bt.grade] || GRADE_META['C'];
  var rp  = RISK_PARAMS[OB.quiz.risk] || RISK_PARAMS.moderate;

  content.innerHTML = [
    '<div class="ob-rec-wrap">',

    /* Hero card */
    '<div class="ob-rec-hero" style="border-color:' + template.color + '33;background:' + template.color + '08">',
    '  <div class="ob-rec-icon" style="background:' + template.color + '15;color:' + template.color + '">' + template.icon + '</div>',
    '  <div class="ob-rec-body">',
    '    <div class="ob-rec-name">' + template.name + '</div>',
    '    <div class="ob-rec-tagline">' + template.tagline + '</div>',
    '    <div class="ob-rec-for">"' + template.for_who + '"</div>',
    '  </div>',
    '  <div class="ob-rec-grade" style="background:' + gm.bg + ';color:' + gm.color + '">',
    '    <div class="ob-grade-letter">' + bt.grade + '</div>',
    '    <div class="ob-grade-label">' + gm.label + '</div>',
    '  </div>',
    '</div>',

    /* Backtest preview */
    '<div class="ob-rec-metrics">',
    _obMetric('Ann. Return',  (bt.ann_return_pct >= 0 ? '+' : '') + bt.ann_return_pct + '%', bt.ann_return_pct >= 0 ? '#10b981' : '#ef4444'),
    _obMetric('Sharpe',       bt.sharpe, bt.sharpe > 1 ? '#10b981' : '#f59e0b'),
    _obMetric('Max Drawdown', '-' + bt.max_drawdown_pct + '%', '#f97316'),
    _obMetric('Win Rate',     bt.win_rate_pct + '%',  bt.win_rate_pct > 55 ? '#10b981' : '#f59e0b'),
    '</div>',

    /* What it does */
    '<div class="ob-rec-does">',
    '  <div class="ob-rec-does-title">How this bot works:</div>',
    (template.what_it_does || []).map(function (item) {
      return '<div class="ob-rec-does-item">✓ ' + item + '</div>';
    }).join(''),
    '</div>',

    /* Good/bad */
    '<div class="ob-rec-conditions">',
    '  <div class="ob-cond good"><span class="ob-cond-icon">✅</span><div><b>Works well when:</b> ' + template.good_when + '</div></div>',
    '  <div class="ob-cond bad"><span class="ob-cond-icon">⚠️</span><div><b>Struggles when:</b> ' + template.bad_when + '</div></div>',
    '</div>',

    /* Risk profile applied */
    '<div class="ob-risk-note" style="border-color:' + rp.color + '30">',
    '  <span style="color:' + rp.color + ';font-weight:700">' + rp.label + ' profile applied</span>',
    '  — stop loss adjusted to ' + rp.stop_pct_override + '%, max ' + rp.max_assets + ' assets',
    '</div>',

    /* CTAs */
    '<div class="ob-rec-actions">',
    '  <button class="ob-deploy-btn" onclick="obDeployTemplate(\'' + templateId + '\')"',
    '    style="background:' + template.color + ';color:#fff">',
    '    🚀 Deploy this bot',
    '  </button>',
    '  <button class="ob-see-all-btn" onclick="obShowAllTemplates()">',
    '    Browse all templates',
    '  </button>',
    '</div>',
    '</div>',
  ].join('');
}

function _obMetric(label, value, color) {
  return '<div class="ob-metric"><div class="ob-metric-val" style="color:' + color + '">' + value + '</div>'
    + '<div class="ob-metric-label">' + label + '</div></div>';
}

window.obSkipQuiz = function () {
  var steps = document.getElementById('tg-steps');
  var nav   = document.querySelector('.tg-wizard-nav');
  if (steps) steps.style.display = '';
  if (nav)   nav.style.display   = '';
  // Reset to standard wizard step 1
  if (typeof _wizRender === 'function') {
    if (typeof TG !== 'undefined') TG.wiz = { step: 1, strategy: null, assets: [], params: {}, name: '' };
    _wizRender();
  }
};

/* ══════════════════════════════════════════════════════════════
   A2 — TEMPLATE LIBRARY
   ══════════════════════════════════════════════════════════════ */

window.obShowAllTemplates = function () {
  var title   = document.getElementById('tg-wiz-title');
  var content = document.getElementById('tg-wiz-content');
  var nav     = document.querySelector('.tg-wizard-nav');
  if (title) title.textContent = '📚 Bot Template Library';
  if (nav)   nav.style.display = 'none';

  var _render = function (templates) {
    content.innerHTML = [
      '<div class="ob-lib-intro">Pre-built bots with real 2-year backtests. One click to deploy.</div>',
      '<div class="ob-template-grid">',
      templates.map(function (t) {
        var bt = t.backtest || {};
        var gm = GRADE_META[bt.grade] || GRADE_META['C'];
        var rc = { low: '#10b981', medium: '#3b82f6', high: '#f59e0b' }[t.risk_level] || '#94a3b8';
        return '<div class="ob-tpl-card" onclick="obShowTemplateDetail(\'' + t.id + '\')"'
          + ' style="--tpl-color:' + t.color + '">'
          + '<div class="ob-tpl-header">'
          + '  <div class="ob-tpl-icon">' + t.icon + '</div>'
          + '  <div class="ob-tpl-grade" style="background:' + gm.bg + ';color:' + gm.color + '">' + bt.grade + '</div>'
          + '</div>'
          + '<div class="ob-tpl-name">' + t.name + '</div>'
          + '<div class="ob-tpl-tagline">' + t.tagline + '</div>'
          + '<div class="ob-tpl-metrics">'
          + '  <span style="color:' + (bt.ann_return_pct >= 0 ? '#10b981' : '#ef4444') + '">'
          + (bt.ann_return_pct >= 0 ? '+' : '') + bt.ann_return_pct + '% /yr</span>'
          + '  <span style="color:var(--t3)">DD -' + bt.max_drawdown_pct + '%</span>'
          + '</div>'
          + '<div class="ob-tpl-risk" style="color:' + rc + ';background:' + rc + '12">'
          + t.risk_label + '</div>'
          + '</div>';
      }).join(''),
      '</div>',
      '<div style="text-align:center;margin-top:16px">',
      '  <button class="quiz-skip-btn" onclick="obSkipQuiz()">Configure manually instead</button>',
      '</div>',
    ].join('');
  };

  if (OB.templates.length) {
    _render(OB.templates);
  } else {
    content.innerHTML = '<div style="text-align:center;padding:32px;color:var(--t3)"><div class="btl-spinner" style="margin:0 auto 12px"></div></div>';
    rq('/api/tradgentic/templates').then(function (r) {
      OB.templates = (r && r.templates) || [];
      _render(OB.templates);
    });
  }
};

window.obShowTemplateDetail = function (templateId) {
  var template = OB.templates.find(function (t) { return t.id === templateId; })
               || null;
  if (template) {
    _showRecommendation(template, templateId);
  } else {
    rq('/api/tradgentic/templates/' + templateId).then(function (r) {
      if (r && !r.error) { OB.templates.push(r); _showRecommendation(r, templateId); }
    });
  }
};

window.obDeployTemplate = function (templateId) {
  var btn = document.querySelector('.ob-deploy-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Deploying…'; }

  rq('/api/tradgentic/templates/' + templateId + '/deploy', {
    method: 'POST', body: {},
  }).then(function (r) {
    if (r && r.bot) {
      if (typeof tgCloseWizard === 'function') tgCloseWizard();
      if (typeof toast === 'function') toast('🚀 Bot deployed from template!', 's', 3000);
      if (typeof tgLoadBots === 'function') tgLoadBots();
      _awardAchievement('first_bot');
    } else {
      if (btn) { btn.disabled = false; btn.textContent = '🚀 Deploy this bot'; }
      if (typeof toast === 'function') toast((r && r.error) || 'Deploy failed', 'e', 2500);
    }
  });
};

/* ══════════════════════════════════════════════════════════════
   A3 — TOOLTIP GLOSSARY
   ══════════════════════════════════════════════════════════════ */

/** Inject a help icon next to a metric. Usage: obHelpIcon('sharpe') */
window.obHelpIcon = function (term) {
  return '<span class="ob-help-icon" onclick="obShowGlossary(\'' + term + '\')" title="What is this?">?</span>';
};

window.obShowGlossary = function (term) {
  var _render = function (entry) {
    if (!entry) return;
    _removeTooltip();
    var el = document.createElement('div');
    el.className = 'ob-tooltip';
    el.id        = 'ob-tooltip';
    el.innerHTML = [
      '<div class="ob-tt-header">',
      '  <div class="ob-tt-term">' + entry.term + '</div>',
      '  <button class="ob-tt-close" onclick="obCloseTooltip()">✕</button>',
      '</div>',
      '<div class="ob-tt-plain">' + entry.plain + '</div>',
      entry.scale && entry.scale.length ? [
        '<div class="ob-tt-scale">',
        entry.scale.map(function (s) {
          return '<div class="ob-tt-row">'
            + '<span class="ob-tt-range" style="color:' + s.color + '">' + s.range + '</span>'
            + '<span class="ob-tt-label">' + s.label + '</span>'
            + '</div>';
        }).join(''),
        '</div>',
      ].join('') : '',
      '</div>',
    ].join('');
    document.body.appendChild(el);
    OB.tooltipEl = el;
    // Position in viewport centre on mobile
    setTimeout(function () { el.classList.add('ob-tooltip-visible'); }, 10);
  };

  var cached = OB.glossary[term];
  if (cached) { _render(cached); return; }

  rq('/api/tradgentic/glossary/' + term).then(function (r) {
    if (r && !r.error) {
      OB.glossary[term] = r;
      _render(r);
    }
  });
};

window.obCloseTooltip = function () { _removeTooltip(); };

function _removeTooltip() {
  var el = document.getElementById('ob-tooltip');
  if (el) el.remove();
  OB.tooltipEl = null;
}

document.addEventListener('click', function (e) {
  if (OB.tooltipEl && !OB.tooltipEl.contains(e.target) && !e.target.classList.contains('ob-help-icon')) {
    _removeTooltip();
  }
});

/* ══════════════════════════════════════════════════════════════
   A4 — LIVE COMMENTARY on bot cards
   ══════════════════════════════════════════════════════════════ */

/**
 * Generates plain-language commentary for a bot card.
 * Called from _renderBotsGrid after cards are rendered.
 */
window.obInjectCommentary = function (botId, signals, stats) {
  var card = document.getElementById('tg-card-comment-' + botId);
  if (!card) return;

  var txt = _generateCommentary(signals, stats);
  card.innerHTML = '<div class="ob-commentary"><span class="ob-bot-think">🤖</span>' + txt + '</div>';
};

function _generateCommentary(signals, stats) {
  if (!signals || !Object.keys(signals).length) {
    return 'Waiting for market data to generate signals…';
  }
  var entries = Object.entries(signals);
  var buys    = entries.filter(function (e) { return e[1].action === 'BUY'; });
  var sells   = entries.filter(function (e) { return e[1].action === 'SELL'; });
  var holds   = entries.filter(function (e) { return e[1].action === 'HOLD'; });

  var parts = [];

  if (buys.length) {
    var sym  = buys[0][0];
    var sig  = buys[0][1];
    var conf = Math.round((sig.strength || 0.5) * 100);
    var txt  = sig.reason || 'signal detected';
    parts.push('<b style="color:#10b981">▲ BUY signal on ' + sym + '</b> (' + conf + '% confidence) — ' + txt);
    if (sig.stop_loss)    parts.push('Stop loss set at $' + sig.stop_loss);
    if (sig.take_profit)  parts.push('Target: $' + sig.take_profit);
  }
  if (sells.length) {
    var sym2 = sells[0][0];
    var sig2 = sells[0][1];
    var txt2 = sig2.reason || 'exit signal';
    parts.push('<b style="color:#ef4444">▼ SELL signal on ' + sym2 + '</b> — ' + txt2);
  }
  if (holds.length && !buys.length && !sells.length) {
    parts.push('All positions in HOLD — no extreme signals detected. Bot is waiting for better entry.');
  }
  if (stats) {
    var eq  = stats.equity || 0;
    var ret = stats.total_return || 0;
    var col = ret >= 0 ? '#10b981' : '#ef4444';
    parts.push('Portfolio: $' + Math.round(eq).toLocaleString() + ' (<span style="color:' + col + '">' + (ret >= 0 ? '+' : '') + ret.toFixed(1) + '%</span>)');
  }
  return parts.join(' &middot; ') || 'Monitoring markets — no signals yet.';
}

/* Patch _renderBotsGrid to inject commentary placeholder */
var _origRenderBotsGrid = window._renderBotsGridOrig = null;
(function () {
  var checkInterval = setInterval(function () {
    if (typeof window.tgLoadBots === 'function' && typeof window._renderBotsGrid === 'undefined') {
      clearInterval(checkInterval);
      // Add commentary div after each bot card renders via monkey-patch on tgOpenDetail
    }
  }, 500);
})();

/* ══════════════════════════════════════════════════════════════
   GAMIFICATION — achievements
   ══════════════════════════════════════════════════════════════ */

var _awardedThisSession = {};

function _awardAchievement(key) {
  if (_awardedThisSession[key]) return;
  _awardedThisSession[key] = true;

  var ACHIEVEMENTS = {
    first_bot: { title: '🤖 First Bot', desc: 'Deployed your first trading bot', xp: 150 },
    first_backtest: { title: '⚗️ Backtester', desc: 'Ran your first backtest', xp: 100 },
    first_feature: { title: '🔬 Feature Analyst', desc: 'Used the Feature Engineering Lab', xp: 120 },
    quiz_complete: { title: '🎯 Guided Start', desc: 'Completed the profile quiz', xp: 50 },
  };

  var ach = ACHIEVEMENTS[key];
  if (!ach) return;

  // Show toast
  if (typeof toast === 'function') {
    toast('🏆 Achievement: ' + ach.title + ' (+' + ach.xp + ' XP)', 's', 4000);
  }
  // Track via engage API
  rq('/api/track', { method: 'POST', body: { action: 'tg_achievement', detail: key } })
    .catch(function () {});
}

// Expose for other modules
window.obAwardAchievement = _awardAchievement;

/* ══════════════════════════════════════════════════════════════
   INIT — patch tgOpenWizard to show quiz first
   ══════════════════════════════════════════════════════════════ */

(function patchWizard() {
  var _check = setInterval(function () {
    if (typeof window.tgOpenWizard === 'function') {
      clearInterval(_check);
      var _orig = window.tgOpenWizard;
      window.tgOpenWizard = function () {
        // Show template library if user has no bots yet, quiz otherwise
        var bots = (typeof TG !== 'undefined' && TG.bots) ? TG.bots : [];
        if (bots.length === 0) {
          // First time: show quiz
          tgOpenWizardGuided();
          _awardAchievement('quiz_complete');
        } else {
          // Has bots: show template library or standard wizard
          var overlay = document.getElementById('tg-wizard');
          if (overlay) overlay.style.display = 'flex';
          obShowAllTemplates();
        }
      };
    }
  }, 200);
})();

/* Patch btlRun to award backtest achievement */
(function patchBacktest() {
  var _check = setInterval(function () {
    if (typeof window.btlRun === 'function') {
      clearInterval(_check);
      var _orig = window.btlRun;
      window.btlRun = function () {
        _orig();
        _awardAchievement('first_backtest');
      };
    }
  }, 500);
})();

/* Patch feAnalyse to award feature achievement */
(function patchFeature() {
  var _check = setInterval(function () {
    if (typeof window.feAnalyse === 'function') {
      clearInterval(_check);
      var _orig = window.feAnalyse;
      window.feAnalyse = function () {
        _orig();
        _awardAchievement('first_feature');
      };
    }
  }, 500);
})();

})();
