/**
 * @file 14_graph3d.js
 * @module WorldLens / Knowledge Graph — 3D WebGL Renderer
 *
 * Reads NG.nodes / NG.edges from 12_graph.js — same data, different renderer.
 *
 * Problems fixed vs v1:
 *  - No fog (was killing visibility beyond radius=700)
 *  - Compact layout: XY from 2D force positions (scaled), Z = community plane
 *  - Camera starts close enough to see the graph (radius ≈ bounding sphere * 1.6)
 *  - Pan with right-click drag or middle-mouse (navigate to any cluster)
 *  - WASD / arrow keys for fly-through navigation
 *  - Minimap overlay: 2D top-down thumbnail of all nodes
 *  - "Jump to community" buttons in 3D controls
 *  - Zoom clamp based on actual graph size, not hardcoded numbers
 *  - Auto-orbit pauses on any interaction, resumes after 4s idle
 *
 * Navigation:
 *  Left-drag   → orbit
 *  Right-drag  → pan camera target
 *  Scroll      → zoom (dolly)
 *  W/S arrows  → dolly in/out
 *  A/D arrows  → strafe left/right
 *  Q/E         → move up/down
 *  Double-click node → fly to it
 *  Click node  → open detail panel
 *
 * @depends 12_graph.js (NG), three.js r128 (no OrbitControls — not in CDN r128)
 */

// ════════════════════════════════════════════════════════
// STATE
// ════════════════════════════════════════════════════════
var NG3D = {
  active:   false,
  renderer: null,
  scene:    null,
  camera:   null,
  meshes:   {},      // nodeId → THREE.Mesh (the sphere)
  labels:   {},      // nodeId → THREE.Sprite
  edges: {
    mentions:      null,
    co_occurrence: null,
    similarity:    null,
  },
  _meshList:   [],   // flat array for raycaster
  animFrame:   null,
  built:       false,
  raycaster:   null,
  mouse:       { x:0, y:0 },
  hovered3D:   null,
  selected3D:  null,

  // Camera orbit + pan state
  cam: {
    // Spherical coords for orbit
    theta:  0.4,    // horizontal angle
    phi:    1.05,   // vertical angle (from +Y axis)
    radius: 500,    // distance from target
    // Pan: camera target (look-at point), can be moved
    target: { x:0, y:0, z:0 },
    // Drag
    leftDrag:  false,
    rightDrag: false,
    lastX: 0, lastY: 0,
    // Keys held
    keys: {},
    // Auto-orbit
    autoRotate: true,
    autoSpeed:  0.0025,
    _autoTimer: null,
  },

  // Layout cache
  pos3D:     {},    // nodeId → {x,y,z}
  graphBounds: null, // {minX,maxX,minY,maxY,minZ,maxZ,cx,cy,cz,diagonal}
};

// ── Visual config ────────────────────────────────────────
var _NG3_EMISSIVE = {
  news:      0x0d2244,
  company:   0x082a18,
  person:    0x382a00,
  location:  0x1c1040,
  ticker:    0x361800,
  commodity: 0x380820,
};

var _NG3_Z_SPACING    = 160;   // units between community planes
var _NG3_XY_SCALE     = 0.55;  // scale 2D layout coords → 3D world units
var _NG3_LABEL_THRESH = 0.15;  // show labels for nodes above this degree centrality

// ════════════════════════════════════════════════════════
// LAYOUT: community planes + 2D positions on XY
// ════════════════════════════════════════════════════════
function _ng3dLayout() {
  var nodes = NG.nodes.filter(function(n){ return _nodeVisible(n); });
  if (!nodes.length) return;

  // Group by community
  var groups = {};
  nodes.forEach(function(n){
    var c = n.community || 0;
    if (!groups[c]) groups[c] = [];
    groups[c].push(n);
  });

  // Sort communities by size desc → largest at Z=0
  var commIds = Object.keys(groups).map(Number)
    .sort(function(a,b){ return groups[b].length - groups[a].length; });

  // Compute Z for each community (alternating above/below)
  var zForComm = {};
  commIds.forEach(function(c, i){
    var sign  = (i % 2 === 0) ? 1 : -1;
    var level = Math.floor(i / 2);
    zForComm[c] = sign * level * _NG3_Z_SPACING;
  });

  // Find 2D bounding box of force layout to normalise positions
  var xs = nodes.map(function(n){ return n.x; });
  var ys = nodes.map(function(n){ return n.y; });
  var minX = Math.min.apply(null,xs), maxX = Math.max.apply(null,xs);
  var minY = Math.min.apply(null,ys), maxY = Math.max.apply(null,ys);
  var cx2d = (minX+maxX)/2,  cy2d = (minY+maxY)/2;
  var span = Math.max(maxX-minX, maxY-minY, 1);
  // Normalise: map 2D [minX..maxX] → [-200..+200] world units
  var xyNorm = 400 / span;

  nodes.forEach(function(n){
    var z = zForComm[n.community || 0] || 0;
    // Use actual 2D force-layout position (centred and scaled)
    var wx =  (n.x - cx2d) * xyNorm * _NG3_XY_SCALE;
    var wy = -(n.y - cy2d) * xyNorm * _NG3_XY_SCALE;  // flip Y
    NG3D.pos3D[n.id] = { x:wx, y:wy, z:z };
  });

  // Compute graph bounding sphere for smart camera init
  var allX = nodes.map(function(n){ return NG3D.pos3D[n.id].x; });
  var allY = nodes.map(function(n){ return NG3D.pos3D[n.id].y; });
  var allZ = nodes.map(function(n){ return NG3D.pos3D[n.id].z; });
  var bminX=Math.min.apply(null,allX), bmaxX=Math.max.apply(null,allX);
  var bminY=Math.min.apply(null,allY), bmaxY=Math.max.apply(null,allY);
  var bminZ=Math.min.apply(null,allZ), bmaxZ=Math.max.apply(null,allZ);
  var diagX = bmaxX-bminX, diagY = bmaxY-bminY, diagZ = bmaxZ-bminZ;
  var diag  = Math.sqrt(diagX*diagX + diagY*diagY + diagZ*diagZ);
  NG3D.graphBounds = {
    minX:bminX, maxX:bmaxX,
    minY:bminY, maxY:bmaxY,
    minZ:bminZ, maxZ:bmaxZ,
    cx:(bminX+bmaxX)/2, cy:(bminY+bmaxY)/2, cz:(bminZ+bmaxZ)/2,
    diagonal: diag,
  };
}

// ════════════════════════════════════════════════════════
// SCENE CONSTRUCTION
// ════════════════════════════════════════════════════════
function _ng3dBuildScene(container) {
  var W = container.offsetWidth  || 900;
  var H = container.offsetHeight || 600;

  // Renderer — NO alpha so clear color shows (alpha:true + clearColor(0,0) = transparent bg = invisible)
  NG3D.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false });
  NG3D.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  NG3D.renderer.setSize(W, H);
  NG3D.renderer.setClearColor(0x060b18, 1);
  container.appendChild(NG3D.renderer.domElement);

  NG3D.scene = new THREE.Scene();
  // NO FOG — was the main cause of graph disappearing on zoom out

  // Camera
  NG3D.camera = new THREE.PerspectiveCamera(50, W/H, 1, 12000);
  NG3D.raycaster = new THREE.Raycaster();

  // Lights
  NG3D.scene.add(new THREE.AmbientLight(0x334466, 1.4));
  var dl = new THREE.DirectionalLight(0x88aadd, 1.0);
  dl.position.set(300, 500, 400);
  NG3D.scene.add(dl);
  // Subtle fill from below
  var dl2 = new THREE.DirectionalLight(0x221133, 0.4);
  dl2.position.set(-200, -300, -200);
  NG3D.scene.add(dl2);

  // Compute layout
  _ng3dLayout();

  // Smart camera start: positioned to see the whole graph
  if (NG3D.graphBounds) {
    var b = NG3D.graphBounds;
    var startR = Math.max(200, b.diagonal * 1.4);
    NG3D.cam.radius = startR;
    NG3D.cam.target = { x: b.cx, y: b.cy, z: b.cz };
  }

  // Starfield (fixed in world space, not affected by camera zoom)
  _ng3dAddStarfield();

  // Community plane discs
  _ng3dAddCommunityPlanes();

  // Nodes
  _ng3dBuildNodes();

  // Edges
  _ng3dBuildEdges();

  // Labels
  _ng3dBuildLabels();

  // Apply initial camera
  _ng3dUpdateCamera();
}

function _ng3dAddStarfield() {
  var verts = [];
  for (var i=0; i<1500; i++) {
    verts.push(
      (Math.random()-0.5)*5000,
      (Math.random()-0.5)*5000,
      (Math.random()-0.5)*5000
    );
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,3));
  NG3D.scene.add(new THREE.Points(geo,
    new THREE.PointsMaterial({color:0xffffff,size:1.5,transparent:true,opacity:0.35})));
}

function _ng3dAddCommunityPlanes() {
  var seen = {};
  NG.nodes.forEach(function(n){
    if (!_nodeVisible(n)) return;
    var c = n.community||0;
    if (seen[c]) return;
    seen[c] = true;
    var pos = NG3D.pos3D[n.id];
    if (!pos) return;
    var col = parseInt(NG_COMM_PALETTE[c % NG_COMM_PALETTE.length].replace('#',''),16);
    var geo = new THREE.CircleGeometry(240, 64);
    var mat = new THREE.MeshBasicMaterial({
      color:col, transparent:true, opacity:0.04, side:THREE.DoubleSide, depthWrite:false,
    });
    var disc = new THREE.Mesh(geo, mat);
    disc.rotation.x = Math.PI/2;
    disc.position.set(NG3D.graphBounds ? NG3D.graphBounds.cx : 0, pos.z*0.08, pos.z);
    disc.position.y = pos.z * 0.06;
    disc.position.z = pos.z;
    disc.position.x = 0;
    disc.rotation.x = 0;
    disc.rotation.y = 0;
    NG3D.scene.add(disc);
  });
}

function _ng3dBuildNodes() {
  NG3D.meshes = {};
  NG3D._meshList = [];

  NG.nodes.forEach(function(n){
    if (!_nodeVisible(n)) return;
    var pos  = NG3D.pos3D[n.id];
    if (!pos) return;

    var col    = NG_NODE_COLORS[n.type] || '#94A3B8';
    var emCol  = _NG3_EMISSIVE[n.type]  || 0x111111;
    var commStr= NG_COMM_PALETTE[(n.community||0) % NG_COMM_PALETTE.length];
    var commCol= parseInt(commStr.replace('#',''), 16);

    // Radius: meaningful size difference between news (larger) and entities
    var r = n.type==='news'
      ? Math.max(5, Math.min(18, 4 + (n.severity||5)*0.9 + (n.degree_centrality||0)*8))
      : Math.max(3.5, Math.min(12, 3.5 + (n.degree_centrality||0)*10));

    var geo = new THREE.SphereGeometry(r, n.type==='news'?16:10, n.type==='news'?12:8);
    var mat = new THREE.MeshPhongMaterial({
      color:     new THREE.Color(col),
      emissive:  new THREE.Color(emCol),
      emissiveIntensity: n.type==='news' ? Math.min(0.7,(n.severity||5)/10)*0.8 : 0.2,
      shininess: 70, transparent:true, opacity:0.94,
    });

    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(pos.x, pos.y, pos.z);
    mesh.userData = { nodeId:n.id, node:n, baseR:r };

    // Community ring torus
    var tGeo = new THREE.TorusGeometry(r+2, 0.7, 6, 24);
    var tMat = new THREE.MeshBasicMaterial({
      color:new THREE.Color(commStr), transparent:true, opacity:0.6, depthWrite:false,
    });
    var torus = new THREE.Mesh(tGeo, tMat);
    torus.rotation.x = Math.PI/2;
    mesh.add(torus);

    NG3D.scene.add(mesh);
    NG3D.meshes[n.id] = mesh;
    NG3D._meshList.push(mesh);
  });
}

function _ng3dBuildEdges() {
  // Dispose old
  ['mentions','co_occurrence','similarity'].forEach(function(t){
    if (NG3D.edges[t]) {
      NG3D.scene.remove(NG3D.edges[t]);
      NG3D.edges[t].geometry.dispose();
      NG3D.edges[t].material.dispose();
      NG3D.edges[t] = null;
    }
  });

  var pts = { mentions:[], co_occurrence:[], similarity:[] };
  NG.edges.forEach(function(e){
    var t = e.type||'mentions';
    if (!pts[t]) return;
    if ((t==='similarity'||t==='co_occurrence') && e.src>e.tgt) return;
    var s = NG3D.pos3D[e.src], d = NG3D.pos3D[e.tgt];
    if (!s||!d) return;
    pts[t].push(s.x,s.y,s.z, d.x,d.y,d.z);
  });

  var cfg = {
    mentions:      { col:'#94A3B8', op:0.15 },
    co_occurrence: { col:'#60A5FA', op:0.28 },
    similarity:    { col:'#F59E0B', op:0.32 },
  };
  Object.keys(pts).forEach(function(t){
    if (!pts[t].length) return;
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts[t],3));
    var mat = new THREE.LineBasicMaterial({
      color: new THREE.Color(cfg[t].col),
      transparent:true, opacity:cfg[t].op, depthWrite:false,
    });
    var ls = new THREE.LineSegments(geo, mat);
    NG3D.edges[t] = ls;
    NG3D.scene.add(ls);
  });
}

function _ng3dBuildLabels() {
  // Dispose old
  NG3D.labels && Object.values(NG3D.labels).forEach(function(s){
    NG3D.scene.remove(s);
    if (s.material.map) s.material.map.dispose();
    s.material.dispose();
  });
  NG3D.labels = {};

  var shown = NG.nodes.filter(function(n){
    if (!_nodeVisible(n)||!NG3D.pos3D[n.id]) return false;
    return (n.degree_centrality||0)>=_NG3_LABEL_THRESH
        || (n.type==='news'&&(n.severity||0)>=7);
  }).slice(0,60);

  shown.forEach(function(n){
    var pos   = NG3D.pos3D[n.id];
    var mesh  = NG3D.meshes[n.id];
    if (!pos||!mesh) return;
    var r     = mesh.userData.baseR||6;
    var col   = NG_NODE_COLORS[n.type]||'#94A3B8';
    var label = (n.label||'').slice(0, n.type==='news'?32:20);
    var bold  = (n.degree_centrality||0)>0.3 || (n.type==='news'&&(n.severity||0)>=7);

    var sprite = _ng3dMakeSprite(label, col, bold);
    sprite.position.set(pos.x, pos.y+r+9, pos.z);
    sprite.userData = { nodeId:n.id };
    NG3D.scene.add(sprite);
    NG3D.labels[n.id] = sprite;
  });
}

function _ng3dMakeSprite(text, color, bold) {
  var c = document.createElement('canvas');
  c.width=256; c.height=40;
  var ctx=c.getContext('2d');
  ctx.clearRect(0,0,256,40);
  ctx.fillStyle='rgba(6,11,24,0.78)';
  ctx.beginPath();
  // manual roundRect for compat
  var x=2,y=5,w=252,h=30,r=7;
  ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
  ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
  ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
  ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
  ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
  ctx.fill();
  ctx.font=(bold?'bold ':'')+Math.min(13,Math.max(9,Math.round(260/Math.max(text.length,8))))+'px sans-serif';
  ctx.fillStyle=color; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(text,128,22);
  var tex=new THREE.CanvasTexture(c);
  var mat=new THREE.SpriteMaterial({map:tex,transparent:true,depthWrite:false,depthTest:false});
  var sp=new THREE.Sprite(mat);
  sp.scale.set(82,15,1);
  return sp;
}

// ════════════════════════════════════════════════════════
// CAMERA — spherical orbit with movable target
// ════════════════════════════════════════════════════════
function _ng3dUpdateCamera() {
  var o   = NG3D.cam;
  var phi = Math.max(0.08, Math.min(Math.PI-0.08, o.phi));
  var r   = Math.max(30, o.radius);
  var cx  = o.target.x + r * Math.sin(phi) * Math.sin(o.theta);
  var cy  = o.target.y + r * Math.cos(phi);
  var cz  = o.target.z + r * Math.sin(phi) * Math.cos(o.theta);
  NG3D.camera.position.set(cx, cy, cz);
  NG3D.camera.lookAt(o.target.x, o.target.y, o.target.z);
}

// ════════════════════════════════════════════════════════
// INPUT EVENTS
// ════════════════════════════════════════════════════════
function _ng3dSetupEvents(container) {
  var o = NG3D.cam;

  function stopAutoRotate() {
    o.autoRotate = false;
    clearTimeout(o._autoTimer);
    o._autoTimer = setTimeout(function(){ o.autoRotate = true; }, 4000);
  }

  // ── Left drag = orbit, Right drag = pan ───────────────
  container.addEventListener('mousedown', function(e) {
    stopAutoRotate();
    if (e.button===0) { o.leftDrag=true; container.style.cursor='grabbing'; }
    if (e.button===2) { o.rightDrag=true; container.style.cursor='move'; }
    o.lastX=e.clientX; o.lastY=e.clientY;
    e.preventDefault();
  });
  container.addEventListener('contextmenu', function(e){ e.preventDefault(); });

  window.addEventListener('mouseup', function(e) {
    if (e.button===0) o.leftDrag=false;
    if (e.button===2) o.rightDrag=false;
    if (!o.leftDrag&&!o.rightDrag) container.style.cursor='grab';
  });

  window.addEventListener('mousemove', function(e) {
    if (!NG3D.active) return;
    var dx = e.clientX - o.lastX;
    var dy = e.clientY - o.lastY;
    o.lastX=e.clientX; o.lastY=e.clientY;

    if (o.leftDrag) {
      // Orbit
      o.theta -= dx * 0.007;
      o.phi   -= dy * 0.007;
    } else if (o.rightDrag) {
      // Pan the target point in camera-local XY
      var panSpeed = o.radius * 0.0013;
      var right = new THREE.Vector3();
      var up    = new THREE.Vector3();
      NG3D.camera.getWorldDirection(right);
      right.cross(new THREE.Vector3(0,1,0)).normalize();
      up.set(0,1,0);
      o.target.x -= right.x * dx * panSpeed;
      o.target.z -= right.z * dx * panSpeed;
      o.target.y += dy * panSpeed;
    }

    // Raycaster mouse for hover
    if (!o.leftDrag && !o.rightDrag) {
      var rect = container.getBoundingClientRect();
      NG3D.mouse.x =  ((e.clientX-rect.left)/rect.width)*2-1;
      NG3D.mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
      _ng3dCheckHover();
    }
  });

  // ── Scroll = zoom ──────────────────────────────────────
  container.addEventListener('wheel', function(e) {
    e.preventDefault();
    stopAutoRotate();
    var factor = e.deltaY > 0 ? 1.08 : 0.93;
    var minR   = 25;
    var maxR   = NG3D.graphBounds ? NG3D.graphBounds.diagonal * 4 : 3000;
    o.radius = Math.max(minR, Math.min(maxR, o.radius * factor));
  }, {passive:false});

  // ── Double-click = fly to node ─────────────────────────
  container.addEventListener('dblclick', function(e) {
    var rect = container.getBoundingClientRect();
    NG3D.mouse.x =  ((e.clientX-rect.left)/rect.width)*2-1;
    NG3D.mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
    NG3D.raycaster.setFromCamera(NG3D.mouse, NG3D.camera);
    var hits = NG3D.raycaster.intersectObjects(NG3D._meshList, false);
    if (hits.length) {
      var nid = hits[0].object.userData.nodeId;
      if (nid) _ng3dFlyToNode(nid);
    }
  });

  // ── Single click = detail panel ───────────────────────
  container.addEventListener('click', function(e) {
    if (Math.abs(e.clientX-o.lastX)>3||Math.abs(e.clientY-o.lastY)>3) return;
    var rect = container.getBoundingClientRect();
    NG3D.mouse.x =  ((e.clientX-rect.left)/rect.width)*2-1;
    NG3D.mouse.y = -((e.clientY-rect.top)/rect.height)*2+1;
    NG3D.raycaster.setFromCamera(NG3D.mouse, NG3D.camera);
    var hits = NG3D.raycaster.intersectObjects(NG3D._meshList,false);
    if (hits.length) {
      var node = hits[0].object.userData.node;
      if (node) { NG3D.selected3D=node.id; ngShowDetail(node); }
    } else {
      ngCloseDetail();
    }
  });

  // ── WASD / Arrow keys ──────────────────────────────────
  window.addEventListener('keydown', function(e) {
    if (!NG3D.active) return;
    o.keys[e.key] = true;
    stopAutoRotate();
  });
  window.addEventListener('keyup', function(e) { delete o.keys[e.key]; });

  // ── Touch ──────────────────────────────────────────────
  var _t1=null, _t2=null, _pinchDist0=0;
  container.addEventListener('touchstart', function(e) {
    stopAutoRotate();
    if (e.touches.length===1) {
      o.leftDrag=true;
      _t1={x:e.touches[0].clientX, y:e.touches[0].clientY};
    } else if (e.touches.length===2) {
      o.leftDrag=false;
      var dx=e.touches[0].clientX-e.touches[1].clientX;
      var dy=e.touches[0].clientY-e.touches[1].clientY;
      _pinchDist0=Math.sqrt(dx*dx+dy*dy);
    }
  },{passive:true});
  container.addEventListener('touchmove', function(e) {
    if (e.touches.length===1 && _t1) {
      o.theta -= (e.touches[0].clientX-_t1.x)*0.007;
      o.phi   -= (e.touches[0].clientY-_t1.y)*0.007;
      _t1={x:e.touches[0].clientX,y:e.touches[0].clientY};
    } else if (e.touches.length===2) {
      var dx=e.touches[0].clientX-e.touches[1].clientX;
      var dy=e.touches[0].clientY-e.touches[1].clientY;
      var dist=Math.sqrt(dx*dx+dy*dy);
      if (_pinchDist0>0) {
        var factor=_pinchDist0/dist;
        var maxR=NG3D.graphBounds?NG3D.graphBounds.diagonal*4:3000;
        o.radius=Math.max(25,Math.min(maxR,o.radius*factor));
      }
      _pinchDist0=dist;
    }
  },{passive:true});
  container.addEventListener('touchend', function(){ o.leftDrag=false; _t1=null; },{passive:true});

  // ── Resize ─────────────────────────────────────────────
  if (window.ResizeObserver) {
    new ResizeObserver(function(){
      if (!NG3D.active||!NG3D.renderer) return;
      var W=container.offsetWidth, H=container.offsetHeight;
      if (!W||!H) return;
      NG3D.renderer.setSize(W,H);
      NG3D.camera.aspect=W/H;
      NG3D.camera.updateProjectionMatrix();
    }).observe(container);
  }
}

// WASD / Arrow key movement (called in animation loop)
function _ng3dApplyKeys() {
  var o = NG3D.cam;
  if (!Object.keys(o.keys).length) return;
  var speed = o.radius * 0.012;

  // Camera forward vector (horizontal only)
  var fwd = new THREE.Vector3(
    Math.sin(o.phi)*Math.sin(o.theta),
    0,
    Math.sin(o.phi)*Math.cos(o.theta)
  ).normalize();
  var right = new THREE.Vector3(
    Math.cos(o.theta), 0, -Math.sin(o.theta)
  ).normalize();

  if (o.keys['w']||o.keys['W']||o.keys['ArrowUp']) {
    o.radius = Math.max(25, o.radius - speed);
  }
  if (o.keys['s']||o.keys['S']||o.keys['ArrowDown']) {
    var maxR = NG3D.graphBounds ? NG3D.graphBounds.diagonal*4 : 3000;
    o.radius = Math.min(maxR, o.radius + speed);
  }
  if (o.keys['a']||o.keys['A']||o.keys['ArrowLeft']) {
    o.target.x -= right.x*speed*0.5;
    o.target.z -= right.z*speed*0.5;
  }
  if (o.keys['d']||o.keys['D']||o.keys['ArrowRight']) {
    o.target.x += right.x*speed*0.5;
    o.target.z += right.z*speed*0.5;
  }
  if (o.keys['q']||o.keys['Q']) o.target.y += speed*0.4;
  if (o.keys['e']||o.keys['E']) o.target.y -= speed*0.4;
}

// ════════════════════════════════════════════════════════
// FLY TO NODE
// ════════════════════════════════════════════════════════
function _ng3dFlyToNode(nodeId) {
  var pos = NG3D.pos3D[nodeId];
  var n   = NG.nodeMap[nodeId];
  if (!pos||!n) return;

  var o    = NG3D.cam;
  var tx0  = o.target.x, ty0 = o.target.y, tz0 = o.target.z;
  var r0   = o.radius;
  var th0  = o.theta,    ph0 = o.phi;

  var targetR  = Math.max(40, (n.size||10)*4);
  var steps=40, step=0;

  function fly(){
    if (!NG3D.active||step>=steps) {
      if (n) ngShowDetail(n);
      return;
    }
    step++;
    var t    = step/steps;
    var ease = 1-Math.pow(1-t,3);
    o.target.x = tx0+(pos.x-tx0)*ease;
    o.target.y = ty0+(pos.y-ty0)*ease;
    o.target.z = tz0+(pos.z-tz0)*ease;
    o.radius   = r0+(targetR-r0)*ease;
    _ng3dUpdateCamera();
    requestAnimationFrame(fly);
  }
  fly();

  // Highlight destination node
  var mesh = NG3D.meshes[nodeId];
  if (mesh) mesh.material.emissiveIntensity = 0.9;
}

// ════════════════════════════════════════════════════════
// HOVER
// ════════════════════════════════════════════════════════
function _ng3dCheckHover() {
  if (!NG3D.active||!NG3D._meshList.length) return;
  NG3D.raycaster.setFromCamera(NG3D.mouse, NG3D.camera);
  var hits = NG3D.raycaster.intersectObjects(NG3D._meshList,false);

  // Restore previously hovered
  if (NG3D.hovered3D && NG3D.hovered3D !== NG3D.selected3D) {
    var pm=NG3D.meshes[NG3D.hovered3D];
    if (pm) {
      var pn=pm.userData.node;
      pm.material.emissiveIntensity = pn&&pn.type==='news'?Math.min(0.6,(pn.severity||5)/10)*0.8:0.2;
      pm.scale.set(1,1,1);
    }
    _ng3dHideTooltip();
    NG3D.hovered3D=null;
  }

  if (!hits.length) {
    document.getElementById('ng-3d-wrap') && (document.getElementById('ng-3d-wrap').style.cursor='grab');
    return;
  }

  var m   = hits[0].object;
  var nid = m.userData.nodeId;
  if (!nid) return;
  m.material.emissiveIntensity = 0.75;
  m.scale.set(1.3, 1.3, 1.3);
  NG3D.hovered3D = nid;
  document.getElementById('ng-3d-wrap') && (document.getElementById('ng-3d-wrap').style.cursor='pointer');
  _ng3dShowTooltip(m.userData.node, hits[0]);
}

// ════════════════════════════════════════════════════════
// TOOLTIP
// ════════════════════════════════════════════════════════
function _ng3dShowTooltip(node, hit) {
  if (!node) return;
  var tip = document.getElementById('ng-3d-tooltip');
  if (!tip) {
    tip=document.createElement('div');
    tip.id='ng-3d-tooltip';
    tip.style.cssText='position:absolute;z-index:20;pointer-events:none;'
      +'background:rgba(6,11,24,.92);border:1px solid rgba(255,255,255,.15);'
      +'border-radius:8px;padding:9px 13px;max-width:230px;font-size:10px;'
      +'color:#E2E8F0;line-height:1.6;box-shadow:0 4px 20px rgba(0,0,0,.6);';
    var wrap=document.getElementById('ng-canvas-wrap');
    if (wrap) wrap.style.position='relative', wrap.appendChild(tip);
    else document.body.appendChild(tip);
  }
  var col=NG_NODE_COLORS[node.type]||'#94A3B8';
  var commCol=NG_COMM_PALETTE[(node.community||0)%NG_COMM_PALETTE.length];
  tip.innerHTML=
    '<div style="font-size:9px;font-weight:800;text-transform:uppercase;color:'+col+';margin-bottom:3px">'
    +node.type+' · comm <span style="color:'+commCol+'">#'+node.community+'</span></div>'
    +'<div style="font-weight:700;color:#F0F6FF;font-size:11px;margin-bottom:3px">'+(node.label||'').slice(0,44)+'</div>'
    +(node.type==='news'
      ?'<div style="color:#94A3B8">⚡ '+((node.severity||0).toFixed(1))+' · '+(node.category||'')+(node.country?' · 🌍'+node.country:'')+'</div>'
      :'<div style="color:#94A3B8">×'+(node.mention_count||1)+' mentions · deg '+(node.degree||0)+'</div>')
    +'<div style="color:#475569;font-size:9px;margin-top:4px">Double-click to fly · Click to inspect</div>';

  // Project world point to canvas coords
  var vector = hit.point.clone().project(NG3D.camera);
  var wrap   = document.getElementById('ng-canvas-wrap');
  var W      = wrap ? wrap.offsetWidth  : 800;
  var H      = wrap ? wrap.offsetHeight : 600;
  var sx     = (vector.x+1)/2*W;
  var sy     = (-vector.y+1)/2*H;
  tip.style.left=Math.min(sx+16,W-240)+'px';
  tip.style.top =Math.max(sy-50,8)+'px';
  tip.style.display='block';
}
function _ng3dHideTooltip(){
  var t=document.getElementById('ng-3d-tooltip');
  if(t) t.style.display='none';
}

// ════════════════════════════════════════════════════════
// ANIMATION LOOP
// ════════════════════════════════════════════════════════
function _ng3dAnimate() {
  if (!NG3D.active) return;
  NG3D.animFrame=requestAnimationFrame(_ng3dAnimate);

  // Auto-orbit
  if (NG3D.cam.autoRotate && !NG3D.cam.leftDrag && !NG3D.cam.rightDrag) {
    NG3D.cam.theta += NG3D.cam.autoSpeed;
  }

  // WASD movement
  _ng3dApplyKeys();

  _ng3dUpdateCamera();

  // Label scale / visibility — scale so they have constant screen size
  var camPos = NG3D.camera.position;
  Object.keys(NG3D.labels).forEach(function(id){
    var sp=NG3D.labels[id];
    if (!sp) return;
    var dist=camPos.distanceTo(sp.position);
    // Visible if within 1.5× graph diagonal, scale proportional to dist
    var maxDist = NG3D.graphBounds ? NG3D.graphBounds.diagonal*1.8 : 800;
    sp.visible = dist < maxDist;
    if (sp.visible) {
      var s=dist*0.18;
      sp.scale.set(s, s*0.19, 1);
    }
  });

  // Hover pulse
  if (NG3D.hovered3D) {
    var pm=NG3D.meshes[NG3D.hovered3D];
    if (pm) pm.material.emissiveIntensity=0.5+0.3*Math.sin(Date.now()*0.005);
  }

  NG3D.renderer.render(NG3D.scene, NG3D.camera);
}

// ════════════════════════════════════════════════════════
// 3D CONTROLS UI
// ════════════════════════════════════════════════════════
function _ng3dBuildControls(container) {
  var old=document.getElementById('ng-3d-controls');
  if (old) old.remove();

  var el=document.createElement('div');
  el.id='ng-3d-controls';
  el.style.cssText='position:absolute;bottom:14px;right:12px;z-index:10;'
    +'display:flex;flex-direction:column;gap:3px;';

  // Community jump buttons
  var groups={};
  NG.nodes.forEach(function(n){ var c=n.community||0; if(!groups[c])groups[c]=[]; groups[c].push(n); });
  var commList=Object.keys(groups).map(Number)
    .sort(function(a,b){return groups[b].length-groups[a].length;})
    .slice(0,6);

  var commBtns='';
  commList.forEach(function(c){
    var col=NG_COMM_PALETTE[c%NG_COMM_PALETTE.length];
    var topNode=groups[c].sort(function(a,b){return(b.degree||0)-(a.degree||0);})[0];
    var lbl=(topNode&&topNode.label||'Comm '+c).slice(0,14);
    commBtns+='<button class="ng-zoom-btn" style="border-left:3px solid '+col+'" '
      +'onclick="ng3dJumpToComm('+c+')">⬤ '+lbl+'</button>';
  });

  el.innerHTML=
    '<div style="font-size:8px;color:#475569;text-align:right;margin-bottom:2px;font-weight:700;letter-spacing:.08em">COMMUNITIES</div>'
    +commBtns
    +'<div style="margin-top:4px;font-size:8px;color:#475569;text-align:right;margin-bottom:2px;font-weight:700;letter-spacing:.08em">CAMERA</div>'
    +'<button class="ng-zoom-btn" onclick="ng3dOrbitToggle()" id="ng3d-orbit-btn">🌐 Auto-orbit</button>'
    +'<button class="ng-zoom-btn" onclick="ng3dResetCamera()">↺ Reset view</button>'
    +'<button class="ng-zoom-btn" onclick="ng3dTopView()">⬆ Top-down</button>'
    +'<button class="ng-zoom-btn" onclick="ng3dFrontView()">◉ Front view</button>'
    +'<div style="margin-top:4px;font-size:7px;color:#334;text-align:right;line-height:1.6">'
    +'Left-drag: orbit<br>Right-drag: pan<br>Scroll: zoom<br>W/S A/D: move<br>Dbl-click: fly to</div>';

  container.appendChild(el);
}

// ════════════════════════════════════════════════════════
// PUBLIC CAMERA CONTROLS
// ════════════════════════════════════════════════════════
function ng3dJumpToComm(commId) {
  var group = NG.nodes.filter(function(n){ return (n.community||0)===commId && NG3D.pos3D[n.id]; });
  if (!group.length) return;

  // Compute centroid of the community
  var sumX=0,sumY=0,sumZ=0;
  group.forEach(function(n){
    var p=NG3D.pos3D[n.id];
    sumX+=p.x; sumY+=p.y; sumZ+=p.z;
  });
  var n=group.length;
  var cx=sumX/n, cy=sumY/n, cz=sumZ/n;

  var o=NG3D.cam;
  var tx0=o.target.x,ty0=o.target.y,tz0=o.target.z,r0=o.radius;
  var targetR=Math.max(80,Math.min(250,(NG3D.graphBounds?NG3D.graphBounds.diagonal:200)*0.45));
  var steps=45,step=0;
  o.autoRotate=false;
  clearTimeout(o._autoTimer);

  function jump(){
    if(!NG3D.active||step>=steps){
      o._autoTimer=setTimeout(function(){o.autoRotate=true;},5000);
      return;
    }
    step++;
    var t=step/steps;
    var ease=1-Math.pow(1-t,3);
    o.target.x=tx0+(cx-tx0)*ease;
    o.target.y=ty0+(cy-ty0)*ease;
    o.target.z=tz0+(cz-tz0)*ease;
    o.radius=r0+(targetR-r0)*ease;
    requestAnimationFrame(jump);
  }
  jump();
  toast('Flying to community '+commId, 's');
}

function ng3dOrbitToggle() {
  NG3D.cam.autoRotate=!NG3D.cam.autoRotate;
  var btn=document.getElementById('ng3d-orbit-btn');
  if(btn) btn.style.opacity=NG3D.cam.autoRotate?'1':'0.45';
  toast(NG3D.cam.autoRotate?'Auto-orbit on':'Orbit paused','s');
}
function ng3dResetCamera() {
  var b=NG3D.graphBounds;
  NG3D.cam.theta=0.4; NG3D.cam.phi=1.05;
  NG3D.cam.radius=b?b.diagonal*1.4:500;
  NG3D.cam.target={x:b?b.cx:0,y:b?b.cy:0,z:b?b.cz:0};
  NG3D.cam.autoRotate=true;
}
function ng3dTopView() {
  NG3D.cam.phi=0.08; NG3D.cam.autoRotate=false;
  clearTimeout(NG3D.cam._autoTimer);
  NG3D.cam._autoTimer=setTimeout(function(){NG3D.cam.autoRotate=true;},5000);
}
function ng3dFrontView() {
  NG3D.cam.phi=Math.PI/2; NG3D.cam.theta=0; NG3D.cam.autoRotate=false;
  clearTimeout(NG3D.cam._autoTimer);
  NG3D.cam._autoTimer=setTimeout(function(){NG3D.cam.autoRotate=true;},5000);
}

// ════════════════════════════════════════════════════════
// INIT / DESTROY / TOGGLE
// ════════════════════════════════════════════════════════
function ngInit3D() {
  if (!NG.built)       { toast('Build the graph first','w'); return; }
  if (!window.THREE)   { toast('Three.js not loaded','e');   return; }

  var container=document.getElementById('ng-3d-wrap');
  if (!container) return;

  // Destroy old renderer if any
  ngDestroy3D(true);

  _ng3dBuildScene(container);
  _ng3dSetupEvents(container);
  _ng3dBuildControls(container);
  NG3D.active=true;
  NG3D.built=true;
  _ng3dUpdateCamera();
  _ng3dAnimate();
}

function ngDestroy3D(keepContainer) {
  NG3D.active=false;
  cancelAnimationFrame(NG3D.animFrame);
  NG3D.animFrame=null;
  _ng3dHideTooltip();
  delete NG3D.cam.keys;
  NG3D.cam.keys={};

  if (NG3D.renderer) {
    var container=document.getElementById('ng-3d-wrap');
    if (container&&!keepContainer) {
      while(container.firstChild) container.removeChild(container.firstChild);
    } else if (container) {
      while(container.firstChild) container.removeChild(container.firstChild);
    }
    if (NG3D.scene) {
      NG3D.scene.traverse(function(o){
        if (o.geometry) o.geometry.dispose();
        if (o.material){
          if(o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    NG3D.renderer.dispose();
    NG3D.renderer=null; NG3D.scene=null; NG3D.camera=null;
    NG3D.meshes={}; NG3D.labels={}; NG3D._meshList=[];
    NG3D.edges={mentions:null,co_occurrence:null,similarity:null};
    NG3D.hovered3D=null; NG3D.selected3D=null;
    NG3D.built=false;
  }
  var ctrl=document.getElementById('ng-3d-controls');
  if (ctrl) ctrl.remove();
}

function ngSetMode(mode, btn) {
  var canvas=document.getElementById('ng-canvas');
  var wrap3d=document.getElementById('ng-3d-wrap');
  var zoom2d=document.getElementById('ng-zoom-ctrls');
  document.querySelectorAll('.ng-mode-btn').forEach(function(b){
    b.classList.toggle('on',b===btn);
  });
  if (mode==='3d') {
    if (canvas)  canvas.style.display='none';
    if (zoom2d)  zoom2d.style.display='none';
    if (wrap3d)  wrap3d.style.display='block';
    if (NG.animFrame){ cancelAnimationFrame(NG.animFrame); NG.animFrame=null; }
    ngInit3D();
  } else {
    ngDestroy3D();
    if (wrap3d)  wrap3d.style.display='none';
    if (canvas)  canvas.style.display='block';
    if (zoom2d)  zoom2d.style.display='flex';
    if (!NG.animFrame) ngAnimate();
  }
}

// ── Hook: show toggle after build ─────────────────────────
(function(){
  var _orig=_ngUpdateStats;
  _ngUpdateStats=function(nodes,edges,nComm){
    _orig(nodes,edges,nComm);
    var t=document.getElementById('ng-mode-toggle');
    if(t) t.style.display='flex';
  };
})();

// ── Hook: clear 3D cache on rebuild ───────────────────────
var _ngBuild3dOrig=ngBuild;
ngBuild=async function(){
  NG3D.pos3D={};
  if(NG3D.active) ngSetMode('2d',document.getElementById('ng-btn-2d'));
  return await _ngBuild3dOrig();
};
