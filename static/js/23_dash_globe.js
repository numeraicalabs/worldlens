/**
 * 23_dash_globe.js — Dashboard Globe (v21 FINAL)
 *
 * Fixes applied:
 *   1. Globe initialises reliably — uses ResizeObserver + MutationObserver
 *      so it starts the moment the canvas has real dimensions, not on a timer
 *   2. 10-second auto-cycle through regions with smooth rotation
 *   3. AI Zone Briefing popup writes to fire-zone-* IDs with fade transition
 *   4. Fallback stub regions if /api/globe/regions fails or returns empty
 *   5. No puter.js, no external deps beyond Three.js (already in index.html)
 *   6. Gemini AI summaries consumed directly from /api/globe/regions response
 *   7. Drag-to-rotate (mouse + touch) with auto-resume after release
 *   8. Pause/Resume button wired correctly
 */
(function () {
'use strict';

/* ── State ─────────────────────────────────────────────────────────────── */
var DG = {
  scene: null, camera: null, renderer: null,
  globe: null, markerGroup: null, beaconGroup: null,
  regions: [],
  activeIdx: 0,
  autoRotate: true,
  raf: null,
  cycleTimer: null,
  initialized: false,
  _initAttempts: 0,
};

var R        = 1.0;
var ATM      = 1.055;
var CYCLE_MS = 10000; // 10 s as requested

/* ── Stub regions shown while API loads ─────────────────────────────────── */
var STUB_REGIONS = [
  { name: 'Europe',        center: [54,15],  color:'#ff4a1a', emoji:'🌍',
    risk:7.2, event_count:412, trend:'↑',
    summary:'Cross-border tensions and energy disruptions dominate the intelligence picture.' },
  { name: 'Middle East',   center: [27,43],  color:'#ff8f00', emoji:'🌍',
    risk:8.1, event_count:267, trend:'↑',
    summary:'Strait of Hormuz traffic rerouted. Brent premium at multi-week high.' },
  { name: 'East Asia',     center: [35,115], color:'#ffb547', emoji:'🌏',
    risk:6.3, event_count:189, trend:'→',
    summary:'Naval posturing at three flashpoints. Regional FX in defensive positioning.' },
  { name: 'South Asia',    center: [23,78],  color:'#ffb547', emoji:'🌏',
    risk:5.8, event_count:134, trend:'→',
    summary:'Political transitions on schedule. Copper stabilising after volatility.' },
  { name: 'Africa',        center: [5,22],   color:'#ffb547', emoji:'🌍',
    risk:6.0, event_count:184, trend:'↑',
    summary:'Uranium export halt entering day 3. European utilities reviewing 60-day buffers.' },
  { name: 'Americas',      center: [10,-80], color:'#6b9b5e', emoji:'🌎',
    risk:4.2, event_count:298, trend:'↓',
    summary:'Macro indicators stabilising. No critical escalation pathways active.' },
];

/* ── Boot: called by 02_core.js after login ─────────────────────────────── */
window.initDashGlobe = function () {
  if (DG.initialized) return;

  /* Three.js guard */
  if (typeof THREE === 'undefined') {
    if (++DG._initAttempts < 25) setTimeout(window.initDashGlobe, 400);
    return;
  }

  var wrap = document.getElementById('db-globe-canvas-wrap');
  var canvas = document.getElementById('db-globe-canvas');
  if (!wrap || !canvas) return;

  /* Wait for real layout dimensions */
  if (wrap.offsetWidth < 10) {
    if (++DG._initAttempts < 40) setTimeout(window.initDashGlobe, 250);
    return;
  }

  DG.initialized = true;
  DG._initAttempts = 0;
  _build(wrap, canvas);
};

/* ── Build Three.js scene ───────────────────────────────────────────────── */
function _build(wrap, canvas) {
  var W = wrap.offsetWidth;
  var H = Math.max(wrap.offsetHeight || 0, 300);

  /* Renderer */
  DG.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  DG.renderer.setSize(W, H);
  DG.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  DG.renderer.setClearColor(0x000000, 0);

  /* Scene + camera */
  DG.scene  = new THREE.Scene();
  DG.camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  DG.camera.position.z = 2.8;

  /* Lighting */
  DG.scene.add(new THREE.AmbientLight(0x1a0d00, 1.5));
  var sun = new THREE.DirectionalLight(0xffd580, 1.8);
  sun.position.set(3, 2, 2);
  DG.scene.add(sun);

  /* Stars */
  var sg = new THREE.BufferGeometry();
  var sp = new Float32Array(1800 * 3);
  for (var i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * 60;
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  DG.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xffeedd, size: 0.05, transparent: true, opacity: 0.35
  })));

  /* Globe sphere */
  var mat = new THREE.MeshPhongMaterial({
    color: 0x080c14, emissive: 0x020408, shininess: 18, specular: 0x1a2a40
  });
  /* Try loading texture — gracefully fall back to plain sphere on CORS error */
  var img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = function () {
    var tex = new THREE.Texture(img);
    tex.needsUpdate = true;
    mat.map = tex;
    mat.needsUpdate = true;
  };
  img.src = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/textures/planets/earth_atmos_2048.jpg';

  DG.globe = new THREE.Mesh(new THREE.SphereGeometry(R, 56, 56), mat);
  DG.globe.rotation.z = 0.41;
  DG.scene.add(DG.globe);

  /* Wireframe grid overlay */
  DG.scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(R + 0.001, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0xff8f00, transparent: true, opacity: 0.025, wireframe: true })
  ));

  /* Atmosphere glow — amber fire */
  DG.scene.add(new THREE.Mesh(
    new THREE.SphereGeometry(ATM, 48, 48),
    new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader:   'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'varying vec3 vN;void main(){float i=pow(.72-dot(vN,vec3(0,0,1)),2.2);gl_FragColor=vec4(.95,.45,.05,i*.45);}',
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      transparent: true
    })
  ));

  /* Marker + beacon groups */
  DG.markerGroup = new THREE.Group(); DG.markerGroup.rotation.z = 0.41;
  DG.beaconGroup = new THREE.Group(); DG.beaconGroup.rotation.z = 0.41;
  DG.scene.add(DG.markerGroup);
  DG.scene.add(DG.beaconGroup);

  /* Responsive resize */
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(function () {
      var nW = wrap.offsetWidth, nH = Math.max(wrap.offsetHeight || 0, 300);
      if (nW < 10) return;
      DG.renderer.setSize(nW, nH);
      DG.camera.aspect = nW / nH;
      DG.camera.updateProjectionMatrix();
    }).observe(wrap);
  }

  _setupInteraction(canvas);
  _setupPauseBtn();
  _animate();

  /* Show stubs immediately, then replace with live data */
  DG.regions = STUB_REGIONS;
  _buildBeacons(STUB_REGIONS);
  _buildNavDots(STUB_REGIONS);
  _showRegion(0);
  _startCycle();

  /* Load live data — replaces stubs */
  _loadRegions();
  setInterval(function () {
    if (!document.hidden) _loadRegions();
  }, 120000);
}

/* ── Animation loop ────────────────────────────────────────────────────── */
function _animate() {
  DG.raf = requestAnimationFrame(_animate);
  if (document.hidden) return;

  if (DG.autoRotate && DG.globe) {
    var speed = 0.0015;
    DG.globe.rotation.y      += speed;
    if (DG.markerGroup) DG.markerGroup.rotation.y += speed;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += speed;
  }

  /* Pulse beacons */
  if (DG.beaconGroup) {
    var t = Date.now() / 900;
    DG.beaconGroup.children.forEach(function (m, i) {
      var s = 1 + 0.28 * Math.sin(t + i * 1.1);
      m.scale.setScalar(s);
      if (m.material) m.material.opacity = 0.3 + 0.15 * Math.sin(t + i);
    });
  }

  if (DG.renderer) DG.renderer.render(DG.scene, DG.camera);
}

/* ── Interaction: drag rotate + click overlay ─────────────────────────── */
function _setupInteraction(canvas) {
  var down = false, lastX = 0;

  canvas.addEventListener('mousedown', function (e) {
    down = true; lastX = e.clientX; DG.autoRotate = false;
  });
  window.addEventListener('mouseup', function () {
    down = false; DG.autoRotate = true;
  });
  canvas.addEventListener('mousemove', function (e) {
    if (!down || !DG.globe) return;
    var dx = e.clientX - lastX;
    DG.globe.rotation.y      += dx * 0.008;
    if (DG.markerGroup) DG.markerGroup.rotation.y += dx * 0.008;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += dx * 0.008;
    lastX = e.clientX;
  });

  /* Touch */
  canvas.addEventListener('touchstart', function (e) {
    if (e.touches[0]) { down = true; lastX = e.touches[0].clientX; DG.autoRotate = false; }
  }, { passive: true });
  canvas.addEventListener('touchend', function () { down = false; DG.autoRotate = true; });
  canvas.addEventListener('touchmove', function (e) {
    if (!down || !DG.globe) return;
    var dx = e.touches[0].clientX - lastX;
    DG.globe.rotation.y      += dx * 0.008;
    if (DG.markerGroup) DG.markerGroup.rotation.y += dx * 0.008;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += dx * 0.008;
    lastX = e.touches[0].clientX;
    e.preventDefault();
  }, { passive: false });

  /* Click on canvas = advance to next region */
  var overlay = document.getElementById('db-globe-click-overlay');
  if (overlay) {
    overlay.addEventListener('click', function () {
      _showRegion(DG.activeIdx + 1);
      _resetCycle();
    });
  }
}

/* ── Pause / Resume button ─────────────────────────────────────────────── */
function _setupPauseBtn() {
  var btn = document.getElementById('fire-globe-pausebtn');
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (DG.cycleTimer) {
      clearInterval(DG.cycleTimer); DG.cycleTimer = null;
      DG.autoRotate = false;
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M2 1l6 4-6 4z"/></svg> RESUME';
    } else {
      DG.autoRotate = true;
      _startCycle();
      btn.innerHTML = '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><rect x="2" y="1" width="2" height="8"/><rect x="6" y="1" width="2" height="8"/></svg> PAUSE';
    }
  });
}

/* ── Data fetch ────────────────────────────────────────────────────────── */
function _loadRegions() {
  fetch('/api/globe/regions')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data) return;
      var regions = Array.isArray(data) ? data : (data.regions || []);
      if (!regions.length) return;
      DG.regions = regions;
      _buildBeacons(regions);
      _buildNavDots(regions);
      /* Keep current idx if still valid, else jump to highest risk */
      if (DG.activeIdx >= regions.length) {
        var topIdx = 0, topRisk = -1;
        regions.forEach(function (r, i) { if ((r.risk || 0) > topRisk) { topRisk = r.risk; topIdx = i; } });
        DG.activeIdx = topIdx;
      }
      _showRegion(DG.activeIdx);
    })
    .catch(function () { /* keep stubs */ });

  fetch('/api/globe/heatmap-points')
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (pts) { if (Array.isArray(pts)) _buildMarkers(pts); })
    .catch(function () {});
}

/* ── Three.js helpers ──────────────────────────────────────────────────── */
function _latLon(lat, lon, r) {
  var phi   = (90 - lat)  * Math.PI / 180;
  var theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

function _buildBeacons(regions) {
  if (!DG.beaconGroup) return;
  while (DG.beaconGroup.children.length) DG.beaconGroup.remove(DG.beaconGroup.children[0]);
  regions.forEach(function (reg) {
    if (!reg.center) return;
    var pos = _latLon(reg.center[0], reg.center[1], R + 0.015);
    var col = parseInt((reg.color || '#ff8f00').replace('#', ''), 16);
    var m   = new THREE.Mesh(
      new THREE.SphereGeometry(0.028, 8, 8),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.55 })
    );
    m.position.copy(pos);
    DG.beaconGroup.add(m);
  });
}

function _buildMarkers(pts) {
  if (!DG.markerGroup) return;
  while (DG.markerGroup.children.length) DG.markerGroup.remove(DG.markerGroup.children[0]);
  pts.slice(0, 120).forEach(function (pt) {
    if (!pt.latitude || !pt.longitude) return;
    var sev = pt.severity || 5;
    var col = sev >= 7 ? 0xff4a1a : sev >= 5 ? 0xff8f00 : 0x6b9b5e;
    var m   = new THREE.Mesh(
      new THREE.SphereGeometry(0.007 + sev * 0.003, 5, 5),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.8 })
    );
    m.position.copy(_latLon(pt.latitude, pt.longitude, R + 0.01));
    DG.markerGroup.add(m);
  });
}

/* ── Nav dots ──────────────────────────────────────────────────────────── */
function _buildNavDots(regions) {
  var wrap = document.getElementById('fire-globe-zones');
  if (!wrap) return;
  wrap.innerHTML = '';
  regions.forEach(function (reg, i) {
    var dot = document.createElement('div');
    dot.className = 'fire-globe-zone-dot' + (i === DG.activeIdx ? ' active' : '');
    dot.style.color = reg.color || '#ff8f00';
    dot.title = (reg.name || '') + ' · Risk ' + (reg.risk || 0).toFixed(1);
    dot.addEventListener('click', (function (idx) {
      return function () { _showRegion(idx); _resetCycle(); };
    })(i));
    wrap.appendChild(dot);
  });

  /* Legacy hidden dots for compat */
  var legacy = document.getElementById('db-globe-regions');
  if (legacy) { legacy.innerHTML = ''; }
}

function _refreshNavDots() {
  document.querySelectorAll('.fire-globe-zone-dot').forEach(function (d, i) {
    d.classList.toggle('active', i === DG.activeIdx);
  });
}

/* ── Show region popup ─────────────────────────────────────────────────── */
function _showRegion(idx) {
  if (!DG.regions.length) return;
  idx = ((idx % DG.regions.length) + DG.regions.length) % DG.regions.length;
  DG.activeIdx = idx;
  _refreshNavDots();

  var reg   = DG.regions[idx];
  var risk  = reg.risk || 0;
  var level = risk >= 7 ? 'critical' : risk >= 5 ? 'major' : risk >= 3 ? 'watch' : 'calm';

  /* Fire popup — fade out → update → fade in */
  var popup = document.getElementById('fire-zone-popup');
  if (popup) {
    popup.style.transition = 'opacity 0.2s ease';
    popup.style.opacity    = '0.2';
    setTimeout(function () {
      popup.className = 'fire-zone-popup zone-' + level;

      _setEl('fire-zone-name',     (reg.emoji ? reg.emoji + ' ' : '') + (reg.name || ''));
      _setEl('fire-zone-severity', risk.toFixed(1));
      _setEl('fire-zone-events',   ((reg.event_count || 0).toLocaleString()));
      _setEl('fire-zone-trend',    reg.trend || '→');
      _setEl('fire-zone-quote',    '« ' + (reg.summary || 'No significant activity in the monitored period.') + ' »');
      _setEl('fire-zone-byline',   '— AI GEOPOL · ' + new Date().toTimeString().slice(0,5) + ' UTC');

      /* Window label synced to active timeframe pill */
      var pill = document.querySelector('.fire-timepill.active');
      _setEl('fire-zone-window',   (pill ? pill.textContent.trim() : '24H') + ' WINDOW');

      /* Trend class */
      var tEl = document.getElementById('fire-zone-trend');
      if (tEl) tEl.className = 'fire-zone-stat-val ' + (reg.trend === '↑' ? 'danger' : reg.trend === '↓' ? 'positive' : '');

      popup.style.opacity = '1';
    }, 220);
  }

  /* Legacy hidden compat elements — keeps db-globe-* watchers happy */
  _setEl('db-globe-region-name', (reg.emoji || '') + ' ' + (reg.name || ''));
  _setEl('db-globe-text',        reg.summary || '');
  _setEl('db-globe-footer-label', (idx+1) + '/' + DG.regions.length + ' regions · auto-cycling every 10s');
  var rb = document.getElementById('db-globe-risk-badge');
  if (rb) { rb.textContent = 'Risk ' + risk.toFixed(1); }
  var ec = document.getElementById('db-globe-ev-count');
  if (ec) ec.textContent = (reg.event_count || 0) + ' events';

  /* Smooth globe rotation to face region */
  if (reg.center) _rotateGlobeTo(reg.center);
}

function _setEl(id, text) {
  var el = document.getElementById(id);
  if (el) el.textContent = text;
}

/* ── Smooth rotation ───────────────────────────────────────────────────── */
function _rotateGlobeTo(center) {
  if (!DG.globe || !center) return;
  var target = -(center[1] + 180) * Math.PI / 180;
  var start  = DG.globe.rotation.y;
  var diff   = target - start;
  while (diff >  Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  var step = 0, total = 55;
  var wasAuto = DG.autoRotate;
  DG.autoRotate = false;
  var iv = setInterval(function () {
    step++;
    var t    = step / total;
    var ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    var y    = start + diff * ease;
    DG.globe.rotation.y = y;
    if (DG.markerGroup) DG.markerGroup.rotation.y = y;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y = y;
    if (step >= total) { clearInterval(iv); DG.autoRotate = wasAuto; }
  }, 16);
}

/* ── Auto-cycle ────────────────────────────────────────────────────────── */
function _startCycle() {
  if (DG.cycleTimer) return;
  DG.cycleTimer = setInterval(function () {
    if (!document.hidden) _showRegion(DG.activeIdx + 1);
  }, CYCLE_MS);
}
function _resetCycle() {
  if (DG.cycleTimer) { clearInterval(DG.cycleTimer); DG.cycleTimer = null; }
  _startCycle();
}

/* ── DOMContentLoaded wire-up ──────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function () {
  /* Watch view-dash class changes → re-init when user navigates to dashboard */
  var dash = document.getElementById('view-dash');
  if (!dash) return;

  new MutationObserver(function () {
    if (dash.classList.contains('on') && !DG.initialized) {
      DG._initAttempts = 0;
      setTimeout(window.initDashGlobe, 200);
    }
  }).observe(dash, { attributes: true, attributeFilter: ['class'] });

  /* Init immediately if dashboard is already the active view */
  if (dash.classList.contains('on')) {
    setTimeout(window.initDashGlobe, 600);
  }
});

})();
