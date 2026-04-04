/* ═══════════════════════════════════════════════════════════════════
   WORLDLENS — Continent Live News Streams  (19_continent_streams.js)
   ─────────────────────────────────────────────────────────────────
   4 live-feed panels on the Dashboard: Americas · Europe ·
   Asia-Pacific · Middle East & Africa.

   Features:
   ▸ Events filtered by country code → continent mapping
   ▸ Sorted by timestamp DESC — most recent at top
   ▸ "NEW" badge on events < 30 min old, auto-fades after 4s
   ▸ Slide-in animation on each row
   ▸ Bottom tape ticker scrolling latest headline
   ▸ Auto-refresh every 60s; on first load after renderDash()
   ▸ Click → flies to map + opens event panel
   ▸ Severity-coded colour dots + badges
   ═══════════════════════════════════════════════════════════════════ */

/* ── Continent country-code maps ────────────────────────────────── */
var CONT_CODES = {
  americas: [
    'US','CA','MX','BR','AR','CO','CL','PE','VE','EC','BO','PY','UY',
    'CR','PA','GT','HN','SV','NI','CU','DO','JM','HT','TT','BB','BS',
    'BZ','GY','SR','GF','PR','TC','VG','KY'
  ],
  europe: [
    'GB','DE','FR','IT','ES','PL','UA','RU','NL','BE','SE','NO','FI',
    'DK','AT','CH','CZ','SK','HU','RO','BG','GR','PT','HR','RS','SI',
    'BA','AL','MK','ME','XK','MD','BY','LT','LV','EE','IE','IS','LU',
    'MT','CY','TR','GE','AM','AZ'
  ],
  asiapac: [
    'CN','JP','IN','KR','AU','ID','TH','VN','MY','PH','SG','PK','BD',
    'LK','NP','MM','KH','LA','BN','MN','TW','HK','MO','NZ','FJ','PG',
    'TL','KZ','UZ','TM','KG','TJ','AF'
  ],
  mea: [
    'SA','IR','IL','EG','AE','IQ','SY','JO','LB','KW','QA','BH','OM',
    'YE','LY','TN','DZ','MA','SD','SS','ET','ER','SO','DJ','KE','TZ',
    'UG','RW','BI','CD','CG','GA','CM','NG','GH','CI','SN','ML','BF',
    'NE','MR','MZ','ZM','ZW','ZA','NA','BW','LS','SZ','MG','MW','AO'
  ]
};

/* Which continents exist for lookup */
var _contOf = {};
Object.keys(CONT_CODES).forEach(function(c) {
  CONT_CODES[c].forEach(function(cc) { _contOf[cc] = c; });
});

/* ── Visual config per continent ─────────────────────────────────── */
var CONT_CFG = {
  americas: { color:'#10B981', feedId:'cont-feed-americas', countId:'cont-am-count' },
  europe:   { color:'#3B82F6', feedId:'cont-feed-europe',   countId:'cont-eu-count' },
  asiapac:  { color:'#F59E0B', feedId:'cont-feed-asiapac',  countId:'cont-ap-count' },
  mea:      { color:'#EF4444', feedId:'cont-feed-mea',      countId:'cont-mea-count' },
};

/* ── State ─────────────────────────────────────────────────────── */
var _contTimer   = null;
var _contSeenIds = {};   // track IDs we've already rendered per continent

/* ── Helpers ─────────────────────────────────────────────────────── */
function _contSevColor(s) {
  return s >= 7 ? '#EF4444' : s >= 5 ? '#F59E0B' : '#10B981';
}
function _contSevBg(s) {
  return s >= 7 ? 'rgba(239,68,68,.14)' : s >= 5 ? 'rgba(245,158,11,.12)' : 'rgba(16,185,129,.1)';
}
function _contIsNew(ts) {
  return ts && (Date.now() - new Date(ts).getTime()) < 30 * 60 * 1000;
}

/* ── Main render ─────────────────────────────────────────────────── */
function renderContinentStreams() {
  var events = G.events || [];
  if (!events.length) return;

  /* Split by continent */
  var byContinent = { americas:[], europe:[], asiapac:[], mea:[] };
  events.forEach(function(ev) {
    var cc   = (ev.country_code || '').toUpperCase();
    var cont = _contOf[cc];
    if (cont && byContinent[cont]) byContinent[cont].push(ev);
  });

  /* Total badge */
  var total = Object.values(byContinent).reduce(function(s,a){ return s+a.length; }, 0);
  var tot   = document.getElementById('cont-total-count');
  if (tot) tot.textContent = total + ' geotagged events';

  /* Render each continent */
  Object.keys(byContinent).forEach(function(cont) {
    _renderContinentFeed(cont, byContinent[cont]);
  });
}

function _renderContinentFeed(cont, events) {
  var cfg    = CONT_CFG[cont];
  if (!cfg) return;

  var feedEl  = document.getElementById(cfg.feedId);
  var countEl = document.getElementById(cfg.countId);
  if (!feedEl) return;

  /* Update count badge */
  if (countEl) countEl.textContent = events.length;

  /* Sort by timestamp DESC, take top 15 */
  var sorted = events.slice().sort(function(a,b) {
    return new Date(b.timestamp) - new Date(a.timestamp);
  }).slice(0, 15);

  if (!sorted.length) {
    feedEl.innerHTML = '<div class="cont-empty">No events in this region<br>last 24 hours</div>';
    _updateTape(cont, null);
    return;
  }

  /* Determine which are new since last render */
  var seen = _contSeenIds[cont] || {};
  var newSeen = {};
  sorted.forEach(function(ev) { newSeen[ev.id] = true; });

  /* Build rows */
  feedEl.innerHTML = sorted.map(function(ev, idx) {
    var m      = (window.CATS && CATS[ev.category]) || { i:'●', c:'#00E5FF' };
    var sev    = parseFloat(ev.severity) || 5;
    var isNew  = !seen[ev.id] || _contIsNew(ev.timestamp);
    var sevC   = _contSevColor(sev);
    var sevBg  = _contSevBg(sev);
    var cname  = (ev.country_name || ev.country_code || 'Global').slice(0, 16);
    var timeStr= typeof tAgo === 'function'
      ? tAgo(new Date(ev.timestamp))
      : new Date(ev.timestamp).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});

    return [
      '<div class="cont-ev-row"',
        ' data-eid="', ev.id, '"',
        ' style="animation-delay:', (idx * 40), 'ms"',
      '>',
        /* Severity dot */
        '<div class="cont-ev-sev"',
          ' style="background:', sevC,
          ';box-shadow:0 0 5px ', sevC, '55">',
        '</div>',

        /* Body */
        '<div class="cont-ev-body">',
          '<div class="cont-ev-title">', ev.title, '</div>',
          '<div class="cont-ev-meta">',
            '<span class="cont-ev-cat"',
              ' style="background:', m.c, '18;color:', m.c, '">',
              m.i, ' ', ev.category.slice(0,7),
            '</span>',
            '<span class="cont-ev-country">', cname, '</span>',
            '<span class="cont-ev-time">', timeStr, '</span>',
          '</div>',
        '</div>',

        /* Severity badge */
        '<div class="cont-ev-sev-badge"',
          ' style="background:', sevBg, ';color:', sevC, '">',
          sev.toFixed(1),
        '</div>',

        /* NEW tag */
        (isNew ? '<div class="cont-ev-new-tag">NEW</div>' : ''),

      '</div>'
    ].join('');
  }).join('');

  /* Wire click handlers */
  feedEl.querySelectorAll('.cont-ev-row[data-eid]').forEach(function(row) {
    row.addEventListener('click', function() {
      var eid = this.dataset.eid;
      if (window.innerWidth <= 768 && typeof showHoloEvent === 'function') {
        if (showHoloEvent(eid)) return;
      }
      if (typeof sv === 'function') sv('map', document.querySelector('[data-v=map]'));
      setTimeout(function() { if (typeof openEP === 'function') openEP(eid); }, 600);
    });
  });

  /* Update seen IDs */
  _contSeenIds[cont] = newSeen;

  /* Bottom tape */
  _updateTape(cont, sorted[0]);
}

/* ── Scrolling tape at bottom of each stream ─────────────────────── */
function _updateTape(cont, latestEv) {
  var streamEl = document.querySelector('.cont-stream[data-continent="' + cont + '"]');
  if (!streamEl) return;

  var tape = streamEl.querySelector('.cont-stream-tape');
  if (!tape) {
    tape = document.createElement('div');
    tape.className = 'cont-stream-tape';
    streamEl.appendChild(tape);
  }

  var text = latestEv
    ? '▶ ' + (latestEv.country_name || '') + ': ' + latestEv.title + ' &nbsp;&nbsp;&nbsp;'
    : '▶ No events in the last 24 hours &nbsp;&nbsp;&nbsp;';

  tape.innerHTML = '<span class="cont-stream-tape-inner">' + text + text + '</span>';
}

/* ── Auto-refresh hook ───────────────────────────────────────────── */
function startContinentStreamRefresh() {
  /* Initial render */
  if ((G.events || []).length > 0) {
    renderContinentStreams();
  }

  /* Refresh every 60s */
  clearInterval(_contTimer);
  _contTimer = setInterval(function() {
    if (G.currentView === 'dash' || !G.currentView) {
      renderContinentStreams();
    }
  }, 60000);
}

/* ── Hook into renderDash ────────────────────────────────────────── */
(function() {
  var _origRenderDash = window.renderDash;
  window.renderDash = function() {
    if (typeof _origRenderDash === 'function') _origRenderDash();
    /* Small delay so bento cells are in DOM */
    setTimeout(renderContinentStreams, 120);
  };

  /* Also hook sv() → trigger render when switching to dash */
  var _origSv = window.sv;
  window.sv = function(name, btn) {
    if (typeof _origSv === 'function') _origSv(name, btn);
    if (name === 'dash') {
      setTimeout(renderContinentStreams, 200);
    }
  };

  /* Start refresh loop once events are available */
  (function waitForEvents() {
    if ((G.events || []).length > 0) {
      startContinentStreamRefresh();
    } else {
      setTimeout(waitForEvents, 800);
    }
  })();
})();
