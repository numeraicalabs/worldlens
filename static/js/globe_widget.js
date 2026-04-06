/**
 * WorldLens — 3D Live Globe Widget
 * Three.js rotating globe with real-time event markers + AI regional summaries
 * Designed for 16:9 YouTube streaming (OBS-ready) + web embedding
 */

(function() {
'use strict';

/* ══ CONFIG ═══════════════════════════════════════════════════════════════ */
var CFG = {
  ROTATE_SPEED:   0.0008,   // radians/frame — smooth 24/7 rotation
  TILT:           0.41,     // Earth's axial tilt (radians)
  MARKER_PULSE_MS: 2800,
  SUMMARY_REFRESH: 60000,   // 1 min
  HEATMAP_REFRESH: 30000,   // 30 sec
  STATS_REFRESH:   15000,   // 15 sec
  MAX_MARKERS:     200,
  GLOBE_RADIUS:    1.0,
  ATM_RADIUS:      1.035,
  GLOW_RADIUS:     1.08,
};

/* ══ STATE ════════════════════════════════════════════════════════════════ */
var S = {
  scene: null, camera: null, renderer: null, globe: null, atm: null,
  markerGroup: null, glowGroup: null, regionGroup: null,
  animFrame: null, rotating: true,
  heatPoints: [], regionData: [], stats: {},
  domReady: false,
};

/* ══ MATH HELPERS ══════════════════════════════════════════════════════════ */
function latLonToVec3(lat, lon, r) {
  var phi   = (90 - lat)  * Math.PI / 180;
  var theta = (lon + 180) * Math.PI / 180;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta)
  );
}

function hexToRGB(hex) {
  var n = parseInt(hex.replace('#',''), 16);
  return { r: (n>>16&255)/255, g: (n>>8&255)/255, b: (n&255)/255 };
}

/* ══ THREE.JS INIT ═════════════════════════════════════════════════════════ */
function initThree(canvas) {
  var W = canvas.parentElement.clientWidth  || 800;
  var H = canvas.parentElement.clientHeight || 450;

  /* Renderer */
  S.renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  S.renderer.setSize(W, H);
  S.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  S.renderer.shadowMap.enabled = false;

  /* Scene */
  S.scene = new THREE.Scene();

  /* Camera */
  S.camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 100);
  S.camera.position.set(0, 0, 2.8);

  /* Resize */
  window.addEventListener('resize', function() {
    var w = canvas.parentElement.clientWidth;
    var h = canvas.parentElement.clientHeight;
    S.camera.aspect = w / h;
    S.camera.updateProjectionMatrix();
    S.renderer.setSize(w, h);
  });

  /* Stars background */
  _buildStars();

  /* Globe */
  _buildGlobe();

  /* Atmosphere glow */
  _buildAtmosphere();

  /* Groups */
  S.markerGroup  = new THREE.Group();
  S.glowGroup    = new THREE.Group();
  S.regionGroup  = new THREE.Group();
  S.scene.add(S.markerGroup, S.glowGroup, S.regionGroup);

  /* Lighting */
  var ambient = new THREE.AmbientLight(0x223355, 0.6);
  var sun     = new THREE.DirectionalLight(0x6699ff, 1.2);
  sun.position.set(5, 3, 5);
  S.scene.add(ambient, sun);

  /* Apply axial tilt to globe group */
  S.globe.rotation.z = CFG.TILT;
  if (S.atm) S.atm.rotation.z = CFG.TILT;
  S.markerGroup.rotation.z  = CFG.TILT;
  S.glowGroup.rotation.z    = CFG.TILT;
  S.regionGroup.rotation.z  = CFG.TILT;

  _animate();
}

function _buildStars() {
  var geo = new THREE.BufferGeometry();
  var N   = 4000;
  var pos = new Float32Array(N * 3);
  for (var i = 0; i < N; i++) {
    var theta = Math.random() * Math.PI * 2;
    var phi   = Math.acos(2 * Math.random() - 1);
    var r     = 40 + Math.random() * 20;
    pos[i*3]   = r * Math.sin(phi) * Math.cos(theta);
    pos[i*3+1] = r * Math.sin(phi) * Math.sin(theta);
    pos[i*3+2] = r * Math.cos(phi);
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  var mat  = new THREE.PointsMaterial({ color: 0xffffff, size: 0.035, transparent: true, opacity: 0.6 });
  S.scene.add(new THREE.Points(geo, mat));
}

function _buildGlobe() {
  var geo = new THREE.SphereGeometry(CFG.GLOBE_RADIUS, 64, 64);

  /* Dark ocean base */
  var mat = new THREE.MeshPhongMaterial({
    color:     0x0a1628,
    emissive:  0x020812,
    shininess: 25,
    specular:  0x1a3a6a,
  });

  /* Try to load texture if available */
  var loader = new THREE.TextureLoader();
  loader.load(
    'https://raw.githubusercontent.com/mrdoob/three.js/master/examples/textures/planets/earth_atmos_2048.jpg',
    function(tex) {
      tex.colorSpace = THREE.SRGBColorSpace || 0; /* compat */
      mat.map        = tex;
      mat.emissive   = new THREE.Color(0x010408);
      mat.emissiveIntensity = 0.15;
      mat.needsUpdate = true;
    },
    undefined,
    function() { /* texture failed — dark procedural sphere looks fine */ }
  );

  S.globe = new THREE.Mesh(geo, mat);
  S.scene.add(S.globe);

  /* Grid lines overlay */
  var gridMat = new THREE.MeshBasicMaterial({
    color:       0x1e3a5f,
    transparent: true,
    opacity:     0.08,
    wireframe:   true,
  });
  var gridMesh = new THREE.Mesh(new THREE.SphereGeometry(CFG.GLOBE_RADIUS + 0.001, 36, 18), gridMat);
  S.scene.add(gridMesh);
}

function _buildAtmosphere() {
  var geo = new THREE.SphereGeometry(CFG.ATM_RADIUS, 64, 64);
  var mat = new THREE.ShaderMaterial({
    vertexShader: [
      'varying vec3 vNormal;',
      'void main(){',
      '  vNormal = normalize(normalMatrix * normal);',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);',
      '}'
    ].join('\n'),
    fragmentShader: [
      'varying vec3 vNormal;',
      'void main(){',
      '  float intensity = pow(0.65 - dot(vNormal, vec3(0,0,1.0)), 3.0);',
      '  gl_FragColor = vec4(0.15, 0.45, 1.0, 1.0) * intensity;',
      '}'
    ].join('\n'),
    blending:     THREE.AdditiveBlending,
    side:         THREE.BackSide,
    transparent:  true,
  });
  S.atm = new THREE.Mesh(geo, mat);
  S.scene.add(S.atm);
}

/* ══ MARKERS ═══════════════════════════════════════════════════════════════ */
function buildMarkers(points) {
  /* Clear old */
  while (S.markerGroup.children.length) S.markerGroup.remove(S.markerGroup.children[0]);
  while (S.glowGroup.children.length)   S.glowGroup.remove(S.glowGroup.children[0]);

  var catColors = {
    CONFLICT: '#ef4444', SECURITY: '#dc2626', EARTHQUAKE: '#eab308',
    DISASTER: '#f97316', ECONOMICS: '#10b981', FINANCE: '#06b6d4',
    TECHNOLOGY: '#8b5cf6', ENERGY: '#f59e0b', HUMANITARIAN: '#fb923c',
    POLITICS: '#6366f1', GEOPOLITICS: '#3b82f6', HEALTH: '#ec4899',
  };

  points.slice(0, CFG.MAX_MARKERS).forEach(function(pt) {
    var lat = parseFloat(pt.latitude);
    var lon = parseFloat(pt.longitude);
    if (isNaN(lat) || isNaN(lon)) return;

    var sev   = parseFloat(pt.severity) || 5;
    var col   = catColors[pt.category] || '#60a5fa';
    var rgb   = hexToRGB(col);
    var r     = 0.003 + sev * 0.0025;
    var pos   = latLonToVec3(lat, lon, CFG.GLOBE_RADIUS + 0.002);

    /* Core dot */
    var geo = new THREE.SphereGeometry(r, 8, 8);
    var mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb.r, rgb.g, rgb.b) });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    S.markerGroup.add(mesh);

    /* Glow halo (only for high severity) */
    if (sev >= 6) {
      var haloGeo = new THREE.SphereGeometry(r * 3.5, 8, 8);
      var haloMat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(rgb.r, rgb.g, rgb.b),
        transparent: true, opacity: 0.12,
      });
      var halo = new THREE.Mesh(haloGeo, haloMat);
      halo.position.copy(pos);
      halo.userData.pulseBase = Math.random() * Math.PI * 2;
      S.glowGroup.add(halo);
    }
  });
}

/* ══ REGION ARCS ══════════════════════════════════════════════════════════ */
function buildRegionMarkers(regions) {
  while (S.regionGroup.children.length) S.regionGroup.remove(S.regionGroup.children[0]);

  regions.forEach(function(reg) {
    if (!reg.center || reg.event_count === 0) return;
    var lat = reg.center[0], lon = reg.center[1];
    var pos = latLonToVec3(lat, lon, CFG.GLOBE_RADIUS + 0.005);
    var rgb = hexToRGB(reg.color || '#3b82f6');

    /* Region beacon — size scales with event count */
    var scale = Math.min(1 + reg.event_count * 0.04, 3.5);
    var geo = new THREE.SphereGeometry(0.012 * scale, 10, 10);
    var mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(rgb.r, rgb.g, rgb.b),
      transparent: true, opacity: 0.9,
    });
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(pos);
    mesh.userData = { region: reg.name, pulse: Math.random() * Math.PI * 2, scale: scale };
    S.regionGroup.add(mesh);

    /* Outer ring */
    var ringGeo = new THREE.RingGeometry(0.016 * scale, 0.020 * scale, 20);
    var ringMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(rgb.r, rgb.g, rgb.b),
      transparent: true, opacity: 0.35, side: THREE.DoubleSide,
    });
    var ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.copy(pos);
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    S.regionGroup.add(ring);
  });
}

/* ══ ANIMATION LOOP ═══════════════════════════════════════════════════════ */
function _animate() {
  S.animFrame = requestAnimationFrame(_animate);
  var t = Date.now() / 1000;

  /* Rotate globe */
  if (S.rotating) {
    S.globe.rotation.y     += CFG.ROTATE_SPEED;
    S.markerGroup.rotation.y += CFG.ROTATE_SPEED;
    S.glowGroup.rotation.y   += CFG.ROTATE_SPEED;
    S.regionGroup.rotation.y  += CFG.ROTATE_SPEED;
  }

  /* Pulse glow halos */
  S.glowGroup.children.forEach(function(m) {
    var b = m.userData.pulseBase || 0;
    var p = 0.10 + 0.08 * Math.sin(t * 2 + b);
    m.material.opacity = p;
    var s = 1 + 0.2 * Math.sin(t * 1.5 + b);
    m.scale.setScalar(s);
  });

  /* Pulse region beacons */
  S.regionGroup.children.forEach(function(m) {
    if (!m.userData.region) return;
    var b = m.userData.pulse || 0;
    var s = m.userData.scale || 1;
    var pulse = s * (1 + 0.15 * Math.sin(t * 1.8 + b));
    m.scale.setScalar(pulse);
  });

  S.renderer.render(S.scene, S.camera);
}

/* ══ DATA FETCHING ════════════════════════════════════════════════════════ */
function fetchHeatmap() {
  fetch('/api/globe/heatmap-points')
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(pts) { buildMarkers(pts); })
    .catch(function() {});
}

function fetchRegions() {
  fetch('/api/globe/regions')
    .then(function(r) { return r.ok ? r.json() : []; })
    .then(function(data) {
      S.regionData = data;
      buildRegionMarkers(data);
      renderRegionCards(data);
  /* Update ticker with top events */
  var ticker = document.getElementById('gw-ticker-text');
  if (ticker && regions.length > 0) {
    var items = [];
    regions.forEach(function(r) {
      if (r.top_events && r.top_events.length > 0) {
        items.push(r.emoji + ' ' + r.name + ': ' + r.top_events[0].title.slice(0,60));
      }
    });
    var i = 0;
    function nextTick() {
      if (!items.length) return;
      ticker.textContent = items[i % items.length];
      i++;
      setTimeout(nextTick, 5000);
    }
    nextTick();
  }

    })
    .catch(function() {});
}

function fetchStats() {
  fetch('/api/globe/stats')
    .then(function(r) { return r.ok ? r.json() : {}; })
    .then(function(s) {
      S.stats = s;
      renderStats(s);
    })
    .catch(function() {});
}

/* ══ DOM RENDERING ════════════════════════════════════════════════════════ */
function renderStats(s) {
  var el = document.getElementById('globe-stats');
  if (!el) return;
  el.innerHTML =
    '<div class="gs-item"><span class="gs-val">' + (s.events_24h || '—') + '</span><span class="gs-lbl">Events 24h</span></div>' +
    '<div class="gs-item"><span class="gs-val gs-red">' + (s.high_impact || '—') + '</span><span class="gs-lbl">Critical</span></div>' +
    '<div class="gs-item"><span class="gs-val">' + (s.countries_affected || '—') + '</span><span class="gs-lbl">Countries</span></div>' +
    '<div class="gs-item"><span class="gs-val">' + (s.avg_severity ? s.avg_severity.toFixed(1) : '—') + '</span><span class="gs-lbl">Avg Severity</span></div>';
}

function renderRegionCards(regions) {
  var el = document.getElementById('globe-region-cards');
  if (!el) return;

  var sentColors = {
    critical: '#ef4444', negative: '#f97316',
    neutral: '#94a3b8', positive: '#10b981',
  };
  var trendColors = { '↑': '#ef4444', '→': '#f59e0b', '↓': '#10b981' };

  el.innerHTML = regions.map(function(r) {
    var sentCol  = sentColors[r.sentiment] || '#94a3b8';
    var trendCol = trendColors[r.trend]    || '#94a3b8';
    var riskW    = Math.min(100, (r.risk / 10) * 100).toFixed(0);
    var riskCol  = r.risk >= 7 ? '#ef4444' : r.risk >= 5 ? '#f59e0b' : '#10b981';

    return [
      '<div class="grc" style="border-left:3px solid ' + r.color + '">',
      '  <div class="grc-head">',
      '    <span class="grc-emoji">' + r.emoji + '</span>',
      '    <span class="grc-name">' + r.name + '</span>',
      '    <span class="grc-trend" style="color:' + trendCol + '">' + (r.trend || '→') + '</span>',
      '  </div>',
      '  <div class="grc-bar"><div style="width:' + riskW + '%;background:' + riskCol + ';height:100%;border-radius:2px;transition:width 1s"></div></div>',
      '  <div class="grc-summary">' + (r.summary || 'No data.') + '</div>',
      '  <div class="grc-foot">',
      '    <span class="grc-badge" style="background:' + r.color + '22;color:' + r.color + '">' + (r.event_count || 0) + ' events</span>',
      r.topics && r.topics.length ? '    <span class="grc-topics">' + r.topics.slice(0,2).join(' · ') + '</span>' : '',
      '  </div>',
      '</div>'
    ].join('\n');
  }).join('');
}

/* ══ PUBLIC API ═══════════════════════════════════════════════════════════ */
window.GlobeWidget = {
  init: function(canvasId) {
    var canvas = document.getElementById(canvasId);
    if (!canvas || typeof THREE === 'undefined') {
      console.warn('GlobeWidget: canvas or THREE.js not found');
      return;
    }
    initThree(canvas);
    fetchHeatmap();
    fetchRegions();
    fetchStats();

    setInterval(fetchHeatmap, CFG.HEATMAP_REFRESH);
    setInterval(fetchRegions, CFG.SUMMARY_REFRESH);
    setInterval(fetchStats,   CFG.STATS_REFRESH);
  },
  toggleRotation: function() { S.rotating = !S.rotating; },
  destroy: function() {
    if (S.animFrame) cancelAnimationFrame(S.animFrame);
    if (S.renderer)  S.renderer.dispose();
  }
};

})();
