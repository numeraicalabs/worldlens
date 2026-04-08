/**
 * 23_dash_globe.js — Dashboard Globe Card
 *
 * Embeds a mini 3D rotating globe directly in the dashboard header row.
 * Uses Three.js (already loaded via landing page script tag).
 * Pulls region summaries from /api/globe/regions (existing endpoint).
 *
 * Features:
 *   - Rotating globe with atmosphere shader + heatmap markers
 *   - Click region dots → show AI summary for that region
 *   - Auto-cycles through regions every 8s
 *   - Syncs with /api/globe/regions data (live, cached 3min)
 */
(function() {
'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
var DG = {
  scene: null, camera: null, renderer: null,
  globe: null, markerGroup: null, beaconGroup: null,
  regions: [],       // loaded from API
  activeIdx: 0,      // which region is shown in summary
  rotating: true,
  raf: null,
  initialized: false,
  cycleTimer: null,
};

var R   = 1.0;
var ATM = 1.055;

// ── Init ─────────────────────────────────────────────────────────────────────

function initDashGlobe() {
  // Only init when view-dash is visible and Three.js is loaded
  if (DG.initialized) return;
  if (typeof THREE === 'undefined') return;

  var canvas = document.getElementById('db-globe-canvas');
  var wrap   = document.getElementById('db-globe-canvas-wrap');
  if (!canvas || !wrap) return;
  // Guard: abort after 10 retries (card may be hidden by media query)
  DG._retries = (DG._retries || 0) + 1;
  if (DG._retries > 10) return;
  if (wrap.offsetWidth === 0) { setTimeout(initDashGlobe, 300); return; }
  DG._retries = 0;  // reset once we get a real size

  DG.initialized = true;
  var W = wrap.offsetWidth, H = wrap.offsetHeight || 150;

  // Renderer
  DG.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  DG.renderer.setSize(W, H);
  DG.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Scene + camera
  DG.scene  = new THREE.Scene();
  DG.camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 100);
  DG.camera.position.z = 2.8;

  // Lighting
  DG.scene.add(new THREE.AmbientLight(0x334466, 1.2));
  var sun = new THREE.DirectionalLight(0xffeedd, 1.4);
  sun.position.set(3, 2, 2);
  DG.scene.add(sun);

  // Stars
  var sg  = new THREE.BufferGeometry();
  var sp  = new Float32Array(2000 * 3);
  for (var i = 0; i < sp.length; i++) sp[i] = (Math.random() - 0.5) * 60;
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  DG.scene.add(new THREE.Points(sg, new THREE.PointsMaterial({
    color: 0xffffff, size: 0.04, transparent: true, opacity: 0.5
  })));

  // Globe sphere
  var geo = new THREE.SphereGeometry(R, 48, 48);
  var mat = new THREE.MeshPhongMaterial({
    color: 0x0a1628, emissive: 0x010408, shininess: 25, specular: 0x1a3a6a
  });
  // Try loading earth texture from CDN — fail silently if CORS blocks it
  var _texUrls = [
    'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/textures/planets/earth_atmos_2048.jpg',
    'https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg',
  ];
  (function _tryTex(urls) {
    if (!urls.length) return;  // give up, use base color
    var img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = function() {
      var tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      mat.map = tex;
      mat.needsUpdate = true;
    };
    img.onerror = function() { _tryTex(urls.slice(1)); };
    img.src = urls[0];
  })(_texUrls);
  DG.globe = new THREE.Mesh(geo, mat);
  DG.globe.rotation.z = 0.41;
  DG.scene.add(DG.globe);

  // Wireframe grid overlay
  var gmat = new THREE.MeshBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.05, wireframe: true });
  var gmesh = new THREE.Mesh(new THREE.SphereGeometry(R + 0.001, 24, 12), gmat);
  gmesh.rotation.z = 0.41;
  DG.scene.add(gmesh);

  // Atmosphere glow
  var am = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader:   'varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 vN;void main(){float i=pow(.7-dot(vN,vec3(0,0,1)),2.2);gl_FragColor=vec4(.22,.48,.95,i*.55);}',
    blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true
  });
  DG.scene.add(new THREE.Mesh(new THREE.SphereGeometry(ATM, 48, 48), am));

  // Marker + beacon groups
  DG.markerGroup = new THREE.Group(); DG.markerGroup.rotation.z = 0.41;
  DG.beaconGroup = new THREE.Group(); DG.beaconGroup.rotation.z = 0.41;
  DG.scene.add(DG.markerGroup);
  DG.scene.add(DG.beaconGroup);

  // Resize handler
  var ro = new ResizeObserver(function() {
    var nW = wrap.offsetWidth, nH = wrap.offsetHeight || 150;
    if (nW < 10) return;
    DG.renderer.setSize(nW, nH);
    DG.camera.aspect = nW / nH;
    DG.camera.updateProjectionMatrix();
  });
  ro.observe(wrap);

  // Mouse drag rotation
  _setupDragRotation(canvas);

  // Start animation
  _animate();

  // Load data
  _loadRegions();
  setInterval(_loadRegions, 60000);
}

// ── Animation loop ─────────────────────────────────────────────────────────────

function _animate() {
  DG.raf = requestAnimationFrame(_animate);
  if (DG.rotating && DG.globe) {
    DG.globe.rotation.y += 0.0018;
    if (DG.markerGroup) DG.markerGroup.rotation.y += 0.0018;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += 0.0018;
  }
  // Pulse beacons
  if (DG.beaconGroup) {
    var t = Date.now() / 900;
    DG.beaconGroup.children.forEach(function(mesh, i) {
      var s = 1 + 0.3 * Math.sin(t + i * 1.1);
      mesh.scale.setScalar(s);
      if (mesh.material) mesh.material.opacity = 0.25 + 0.15 * Math.sin(t + i);
    });
  }
  if (DG.renderer && DG.scene && DG.camera)
    DG.renderer.render(DG.scene, DG.camera);
}

// ── Drag rotation ──────────────────────────────────────────────────────────────

function _setupDragRotation(canvas) {
  var down = false, lastX = 0;
  canvas.addEventListener('mousedown', function(e) { down = true; lastX = e.clientX; DG.rotating = false; });
  window.addEventListener('mouseup',   function()  { down = false; DG.rotating = true; });
  canvas.addEventListener('mousemove', function(e) {
    if (!down || !DG.globe) return;
    var dx = e.clientX - lastX;
    DG.globe.rotation.y += dx * 0.008;
    if (DG.markerGroup) DG.markerGroup.rotation.y += dx * 0.008;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += dx * 0.008;
    lastX = e.clientX;
  });
  // Touch
  canvas.addEventListener('touchstart', function(e) { if(e.touches[0]){down=true;lastX=e.touches[0].clientX;DG.rotating=false;} });
  canvas.addEventListener('touchend',   function()  { down=false;DG.rotating=true; });
  canvas.addEventListener('touchmove',  function(e) {
    if (!down || !DG.globe) return;
    var dx = e.touches[0].clientX - lastX;
    DG.globe.rotation.y += dx * 0.008;
    if (DG.markerGroup) DG.markerGroup.rotation.y += dx * 0.008;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y += dx * 0.008;
    lastX = e.touches[0].clientX;
    e.preventDefault();
  }, { passive: false });
}

// ── Data loading ───────────────────────────────────────────────────────────────

function _loadRegions() {
  if (!G.token) return;
  rq('/api/globe/regions').then(function(data) {
    if (!Array.isArray(data) || !data.length) return;
    DG.regions = data;
    _buildBeacons(data);
    _buildRegionDots(data);
    // Start on highest-risk region
    var topIdx = 0, topRisk = -1;
    data.forEach(function(r, i) {
      if ((r.risk || 0) > topRisk) { topRisk = r.risk; topIdx = i; }
    });
    DG.activeIdx = topIdx;
    _showRegion(topIdx);
    _startCycle();
  });

  // Also load heatmap markers
  rq('/api/globe/heatmap-points').then(function(pts) {
    if (Array.isArray(pts)) _buildMarkers(pts);
  });
}

function _latLonToVec(lat, lon, r) {
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
  regions.forEach(function(reg) {
    if (!reg.center) return;
    var pos = _latLonToVec(reg.center[0], reg.center[1], R + 0.015);
    var col = reg.color || '#3B82F6';
    var hex = parseInt(col.replace('#',''), 16);
    var geo = new THREE.SphereGeometry(0.03, 8, 8);
    var mat = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity: 0.5 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    DG.beaconGroup.add(mesh);
  });
}

function _buildMarkers(pts) {
  if (!DG.markerGroup) return;
  while (DG.markerGroup.children.length) DG.markerGroup.remove(DG.markerGroup.children[0]);
  pts.slice(0, 120).forEach(function(pt) {
    if (!pt.latitude || !pt.longitude) return;
    var sev = pt.severity || 5;
    var pos = _latLonToVec(pt.latitude, pt.longitude, R + 0.01);
    var sz  = 0.008 + sev * 0.003;
    var col = sev >= 7 ? 0xEF4444 : sev >= 5 ? 0xF59E0B : 0x3B82F6;
    var geo = new THREE.SphereGeometry(sz, 5, 5);
    var mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.75 });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    DG.markerGroup.add(mesh);
  });
}

// ── Region dots nav ────────────────────────────────────────────────────────────

function _buildRegionDots(regions) {
  var wrap = document.getElementById('db-globe-regions');
  if (!wrap) return;
  wrap.innerHTML = '';
  regions.forEach(function(reg, i) {
    var dot = document.createElement('div');
    dot.className = 'db-globe-region-dot' + (i === DG.activeIdx ? ' active' : '');
    dot.style.background = reg.color || '#3B82F6';
    // High-risk glow
    if (reg.risk >= 7) {
      dot.style.boxShadow = '0 0 6px 2px ' + (reg.color || '#EF4444') + '80';
    }
    dot.title = reg.name + ' — Risk ' + (reg.risk || 0).toFixed(1) +
                ' · ' + (reg.event_count || 0) + ' events';
    dot.onclick = (function(idx) {
      return function() { _showRegion(idx); _resetCycle(); };
    })(i);
    wrap.appendChild(dot);
  });
}

// ── Summary panel ──────────────────────────────────────────────────────────────

function _showRegion(idx) {
  if (!DG.regions.length) return;
  idx = ((idx % DG.regions.length) + DG.regions.length) % DG.regions.length;
  DG.activeIdx = idx;
  var reg = DG.regions[idx];

  // Hide skeleton, show summary
  var skel    = document.getElementById('db-globe-skeleton');
  var summary = document.getElementById('db-globe-summary');
  if (skel)    skel.style.display    = 'none';
  if (summary) {
    summary.style.display = 'flex';
    // Re-trigger animation
    summary.classList.remove('db-globe-summary');
    void summary.offsetWidth;
    summary.classList.add('db-globe-summary');
  }

  // Update active dot
  document.querySelectorAll('.db-globe-region-dot')
    .forEach(function(d, i) { d.classList.toggle('active', i === idx); });

  // Region name in header
  var rn = document.getElementById('db-globe-region-name');
  if (rn) rn.textContent = (reg.emoji || '') + ' ' + reg.name;

  // Trend + risk
  var trendEl = document.getElementById('db-globe-trend');
  var riskEl  = document.getElementById('db-globe-risk-badge');
  var evEl    = document.getElementById('db-globe-ev-count');
  if (trendEl) trendEl.textContent = reg.trend || '→';
  if (riskEl) {
    var risk = reg.risk || 0;
    var riskColor = risk >= 7 ? '#EF4444' : risk >= 5 ? '#F59E0B' : '#10B981';
    riskEl.textContent = 'Risk ' + risk.toFixed(1);
    riskEl.style.background  = riskColor + '18';
    riskEl.style.color        = riskColor;
    riskEl.style.borderColor  = riskColor + '40';
  }
  if (evEl) evEl.textContent = (reg.event_count || 0) + ' events';

  // Top critical event (if any)
  var topEvEl = document.getElementById('db-globe-top-event');
  if (topEvEl) {
    var topEvs = (reg.top_events || []).filter(function(e){ return e.severity >= 7; });
    if (topEvs.length) {
      topEvEl.style.display = 'block';
      topEvEl.textContent   = '⚠ ' + topEvs[0].title.slice(0, 65);
    } else {
      topEvEl.style.display = 'none';
    }
  }

  // Summary text
  var textEl = document.getElementById('db-globe-text');
  if (textEl) textEl.textContent = reg.summary || 'No significant events.';

  // Topic chips
  var topicsEl = document.getElementById('db-globe-topics');
  if (topicsEl) {
    var topics = reg.topics || [];
    topicsEl.innerHTML = topics.slice(0, 3).map(function(t) {
      return '<span class="db-globe-topic-chip">' + t + '</span>';
    }).join('');
  }

  // Footer label
  var footerLbl = document.getElementById('db-globe-footer-label');
  if (footerLbl) {
    footerLbl.textContent = (idx + 1) + '/' + DG.regions.length + ' regions · auto-cycling';
  }

  // Rotate globe to face this region
  _rotateGlobeTo(reg.center);
}

function _rotateGlobeTo(center) {
  if (!DG.globe || !center) return;
  // Target longitude → globe Y rotation
  var targetY = -(center[1] + 180) * Math.PI / 180;
  // Smooth tween over 60 frames
  var startY  = DG.globe.rotation.y;
  var diff    = targetY - startY;
  // Normalize diff to [-π, π]
  while (diff > Math.PI)  diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  var frames = 0, total = 50;
  var prev = DG.rotating;
  DG.rotating = false;
  var timer = setInterval(function() {
    frames++;
    var t  = frames / total;
    var ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
    DG.globe.rotation.y = startY + diff * ease;
    if (DG.markerGroup) DG.markerGroup.rotation.y = startY + diff * ease;
    if (DG.beaconGroup) DG.beaconGroup.rotation.y = startY + diff * ease;
    if (frames >= total) {
      clearInterval(timer);
      DG.rotating = prev;
    }
  }, 16);
}

// ── Auto-cycle ─────────────────────────────────────────────────────────────────

function _startCycle() {
  if (DG.cycleTimer) return;
  DG.cycleTimer = setInterval(function() {
    _showRegion(DG.activeIdx + 1);
  }, 8000);
}

function _resetCycle() {
  if (DG.cycleTimer) { clearInterval(DG.cycleTimer); DG.cycleTimer = null; }
  _startCycle();
}

// ── Click overlay → cycle to next region ─────────────────────────────────────

document.addEventListener('DOMContentLoaded', function() {
  var overlay = document.getElementById('db-globe-click-overlay');
  if (overlay) {
    overlay.addEventListener('click', function() {
      _showRegion(DG.activeIdx + 1);
      _resetCycle();
    });
  }
});

// ── Boot: init when dash view becomes active ──────────────────────────────────

window.initDashGlobe = initDashGlobe;

document.addEventListener('DOMContentLoaded', function() {
  // Watch view-dash for .on class addition (robust across any sv() patcher)
  var dash = document.getElementById('view-dash');
  if (!dash) return;

  var observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(m) {
      if (m.attributeName === 'class' && dash.classList.contains('on')) {
        requestAnimationFrame(function() {
          requestAnimationFrame(function() { initDashGlobe(); });
        });
      }
    });
  });
  observer.observe(dash, { attributes: true, attributeFilter: ['class'] });

  // Init immediately if already active on first load
  setTimeout(function() {
    if (dash.classList.contains('on')) initDashGlobe();
  }, 600);
});

})();
