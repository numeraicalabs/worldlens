/**
 * 31_dash_v2.js — Dashboard v2 logic for WorldLens Fire
 *
 * Wires the new Fire Dashboard sections:
 *   - Fire KPI strip with sparklines
 *   - Early Warning tabs (signals / escalation / predictions)
 *   - Crisis Spotlight expand/collapse
 *   - AI Zone Briefing popup (auto-rotates via /api/globe/regions)
 *   - Risk quote text pulled from /api/dashboard or briefing endpoint
 *
 * Defensive: silently exits if target elements don't exist.
 * Reads live data via G.fetch (defined in 01_globals.js).
 */
(function () {
  'use strict';

  // ── STATE ────────────────────────────────────────────────
  var S = {
    zoneIdx: 0,
    zonePaused: false,
    zoneCycleTimer: null,
    zones: [],
    globeTimeFrame: '24H',
    ewTab: 'signals'
  };

  // ── HELPERS ──────────────────────────────────────────────
  function $(id)    { return document.getElementById(id); }
  function $$(sel)  { return document.querySelectorAll(sel); }

  function fetchJSON(url) {
    var token = (window.G && window.G.token) ? window.G.token : '';
    return fetch(url, {
      headers: token ? { 'Authorization': 'Bearer ' + token } : {}
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function levelFromSeverity(sev) {
    if (sev >= 75) return 'critical';
    if (sev >= 55) return 'major';
    if (sev >= 35) return 'watch';
    return 'calm';
  }

  // ── SPARKLINE HELPER ─────────────────────────────────────
  function renderSparkline(el, data, colorClass) {
    if (!el || !data || !data.length) return;
    var min = Math.min.apply(null, data);
    var max = Math.max.apply(null, data);
    var range = max - min || 1;
    var pts = data.map(function (v, i) {
      var x = (i / (data.length - 1)) * 100;
      var y = 100 - ((v - min) / range) * 100;
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var stroke = colorClass === 'down' ? 'var(--fire-calm)' : 'var(--fire-ember)';
    el.innerHTML =
      '<svg viewBox="0 0 100 100" preserveAspectRatio="none" style="width:100%;height:100%;display:block">' +
        '<polyline points="' + pts + '" fill="none" stroke="' + stroke + '" stroke-width="2" vector-effect="non-scaling-stroke"/>' +
        '<polyline points="0,100 ' + pts + ' 100,100" fill="' + stroke + '" opacity="0.08"/>' +
      '</svg>';
  }

  // ── EARLY WARNING TABS ───────────────────────────────────
  function initEWTabs() {
    var tabs = $$('.fire-ew-tab');
    if (!tabs.length) return;
    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        var t = tab.dataset.tab;
        if (!t) return;
        S.ewTab = t;
        tabs.forEach(function (x) {
          x.classList.toggle('active', x.dataset.tab === t);
        });
        $$('.fire-ew-panel').forEach(function (p) {
          p.classList.toggle('active', p.dataset.panel === t);
        });
      });
    });
    // Set initial active
    tabs.forEach(function (x) { x.classList.toggle('active', x.dataset.tab === S.ewTab); });
    $$('.fire-ew-panel').forEach(function (p) {
      p.classList.toggle('active', p.dataset.panel === S.ewTab);
    });
  }

  // ── CRISIS SPOTLIGHT EXPAND ──────────────────────────────
  function initCrisisExpand() {
    $$('.fire-crisis').forEach(function (card) {
      card.addEventListener('click', function () {
        card.classList.toggle('expanded');
      });
    });
  }

  // ── GLOBE TIMEFRAME PILLS ────────────────────────────────
  function initTimepills() {
    $$('.fire-timepill').forEach(function (pill) {
      pill.addEventListener('click', function () {
        var t = pill.dataset.tf;
        if (!t) return;
        S.globeTimeFrame = t;
        $$('.fire-timepill').forEach(function (p) {
          p.classList.toggle('active', p.dataset.tf === t);
        });
        // Re-render zone popup with the new window context
        renderZonePopup();
      });
    });
    // Pause/resume button
    var pauseBtn = $('fire-globe-pausebtn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', function () {
        S.zonePaused = !S.zonePaused;
        pauseBtn.innerHTML = S.zonePaused
          ? '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1l6 4-6 4z"/></svg> RESUME'
          : '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="2" y="1" width="2" height="8"/><rect x="6" y="1" width="2" height="8"/></svg> PAUSE';
        if (!S.zonePaused) startZoneCycle();
        else stopZoneCycle();
      });
    }
  }

  // ── AI ZONE BRIEFING ROTATION ────────────────────────────
  function loadZones() {
    return fetchJSON('/api/globe/regions').then(function (data) {
      // Expect { regions: [ {name, lat, lng, risk_score, event_count, ai_summary, trend, top_topics} ] }
      var rs = (data && data.regions) || [];
      if (!rs.length) return;
      S.zones = rs.map(function (r) {
        return {
          id: (r.name || 'zone').toLowerCase().replace(/\s+/g, '-'),
          name: r.name || 'Region',
          lat: r.lat || 0,
          lng: r.lng || 0,
          severity: Math.round(r.risk_score || 0),
          events: r.event_count || 0,
          delta: r.trend_delta || r.trend || '—',
          summary: r.ai_summary || r.top_event_summary || 'No AI briefing available for this zone.',
          topics: r.top_topics || []
        };
      });
      buildZoneDots();
      renderZonePopup();
    }).catch(function () {
      // Fallback: stub zones so UI is never empty
      S.zones = [
        { id: 'eu', name: 'Europe', severity: 72, events: 412, delta: '+3.2',
          summary: 'Cross-asset decorrelation and sanctions-corridor stress dominate the past 24 hours.' },
        { id: 'asia', name: 'Asia-Pacific', severity: 68, events: 389, delta: '+1.8',
          summary: 'Defensive FX positioning and elevated shipping premiums signal continued risk-off sentiment.' },
        { id: 'me', name: 'Middle East', severity: 84, events: 267, delta: '+2.1',
          summary: 'Strait of Hormuz traffic rerouting pushes Brent premium to multi-week highs.' },
        { id: 'am', name: 'Americas', severity: 52, events: 298, delta: '-1.2',
          summary: 'Copper stabilizing post-volatility. Political transitions remaining on schedule in two economies.' },
        { id: 'af', name: 'Africa', severity: 63, events: 184, delta: '+0.5',
          summary: 'Uranium export halt entering day 3 — European utilities reviewing inventory.' }
      ];
      buildZoneDots();
      renderZonePopup();
    });
  }

  function buildZoneDots() {
    var wrap = $('fire-globe-zones');
    if (!wrap) return;
    wrap.innerHTML = '';
    S.zones.forEach(function (z, i) {
      var level = levelFromSeverity(z.severity);
      var color = level === 'critical' ? '#ff4a1a'
                : level === 'major'    ? '#ff8f00'
                : level === 'watch'    ? '#ffb547'
                : '#6b6b6b';
      var dot = document.createElement('div');
      dot.className = 'fire-globe-zone-dot';
      dot.style.color = color;
      dot.dataset.idx = i;
      if (i === S.zoneIdx) dot.classList.add('active');
      dot.addEventListener('click', function () {
        S.zoneIdx = i;
        stopZoneCycle();
        S.zonePaused = true;
        var pauseBtn = $('fire-globe-pausebtn');
        if (pauseBtn) pauseBtn.innerHTML =
          '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1l6 4-6 4z"/></svg> RESUME';
        refreshZoneDots();
        renderZonePopup();
      });
      wrap.appendChild(dot);
    });
  }

  function refreshZoneDots() {
    $$('.fire-globe-zone-dot').forEach(function (d, i) {
      d.classList.toggle('active', i === S.zoneIdx);
    });
  }

  function renderZonePopup() {
    var zone = S.zones[S.zoneIdx];
    if (!zone) return;
    var popup = $('fire-zone-popup');
    if (!popup) return;

    popup.classList.add('fire-zone-changing');

    setTimeout(function () {
      // Apply level class
      var level = levelFromSeverity(zone.severity);
      popup.className = 'fire-zone-popup zone-' + level;

      var nameEl = $('fire-zone-name');
      if (nameEl) nameEl.textContent = zone.name;

      var sevEl = $('fire-zone-severity');
      if (sevEl) {
        sevEl.textContent = zone.severity;
        sevEl.className = 'fire-zone-stat-val danger';
      }
      var evEl = $('fire-zone-events');
      if (evEl) evEl.textContent = zone.events.toLocaleString();

      var delta = typeof zone.delta === 'string' ? zone.delta : (zone.delta >= 0 ? '+' + zone.delta : '' + zone.delta);
      var trEl = $('fire-zone-trend');
      if (trEl) {
        trEl.textContent = delta;
        trEl.className = 'fire-zone-stat-val ' + (String(delta).charAt(0) === '-' ? 'positive' : 'danger');
      }

      var quoteEl = $('fire-zone-quote');
      if (quoteEl) quoteEl.textContent = '« ' + zone.summary + ' »';

      var windowEl = $('fire-zone-window');
      if (windowEl) windowEl.textContent = S.globeTimeFrame + ' WINDOW';

      var hh = new Date().toTimeString().slice(0, 5);
      var bylineEl = $('fire-zone-byline');
      if (bylineEl) bylineEl.textContent = '— AI GEOPOL AGENT · ' + hh + ' UTC';

      popup.classList.remove('fire-zone-changing');
    }, 200);
  }

  function startZoneCycle() {
    stopZoneCycle();
    if (S.zonePaused) return;
    S.zoneCycleTimer = setInterval(function () {
      if (!S.zones.length) return;
      S.zoneIdx = (S.zoneIdx + 1) % S.zones.length;
      refreshZoneDots();
      renderZonePopup();
    }, 5500);
  }

  function stopZoneCycle() {
    if (S.zoneCycleTimer) {
      clearInterval(S.zoneCycleTimer);
      S.zoneCycleTimer = null;
    }
  }

  // ── KPI SPARKLINES (populated from renderDash data) ─────
  // Provide a hook for existing 04_events.js renderDash to call
  window.fireDashRenderSparklines = function (kpiData) {
    // kpiData: { risk: [...], events: [...], sp: [...], btc: [...], vix: [...], gold: [...] }
    Object.keys(kpiData || {}).forEach(function (k) {
      var el = $('fire-spark-' + k);
      if (el) {
        var kv = $('fire-kpi-chg-' + k);
        var cls = (kv && kv.classList.contains('down')) ? 'down' : 'up';
        renderSparkline(el, kpiData[k], cls);
      }
    });
  };

  // ── INIT ─────────────────────────────────────────────────
  function init() {
    if (!$('view-dash')) return;
    initEWTabs();
    initCrisisExpand();
    initTimepills();
    loadZones().then(startZoneCycle);

    // Refresh zones every 3 minutes to match existing /api/globe/regions cache
    setInterval(function () {
      if (document.hidden) return;
      loadZones();
    }, 180000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Expose for debugging
  window.fireDash = { S: S, reload: loadZones, render: renderZonePopup };
})();
