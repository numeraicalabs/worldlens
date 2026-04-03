/**
 * @file 07_map_advanced.js
 * @module WorldLens/Advanced Map Overlays
 *
 * @description
 * Map mode controller (events/heatmap/graph/timeline/stress),
 * enhanced heatmap renderer, timeline strip, market stress meter,
 * NER entity chips, related events panel. Hooks sv() and openEP().
 *
 * @dependencies 01_globals.js, 02_core.js, 03_map.js
 * @exports setMapMode, toggleHeatmap, renderTimeline, toggleStressMeter, loadNER, renderNER, loadRelatedEvents, renderRelated, renderSentimentPanel
 */


// ADMIN DASHBOARD ENGINE
// ════════════════════════════════════════════════════════

var ADM = { currentPanel: 'overview' };

// ── Entry / Exit ──────────────────────────────────────
function openAdmin() {
  if (!G.user || !G.user.is_admin) {
    toast('Admin access required', 'e');
    return;
  }
  document.getElementById('admin-shell').classList.add('on');
  loadAdmOverview();
}
function exitAdmin() {
  document.getElementById('admin-shell').classList.remove('on');
}

// Keyboard shortcut: Ctrl+Shift+A
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.shiftKey && e.key === 'A') {
    if (G.user && G.user.is_admin) openAdmin();
  }
});

// ── Navigation ────────────────────────────────────────
function admNav(panel, btn) {
  ADM.currentPanel = panel;
  document.querySelectorAll('.adm-nav-btn').forEach(function(b) { b.classList.remove('active'); });
  document.querySelectorAll('.adm-panel').forEach(function(p) {
    p.style.display = 'none';
    p.classList.remove('active');
  });
  if (btn) btn.classList.add('active');
  var panelEl = document.getElementById('adm-' + panel);
  if (panelEl) { panelEl.style.display = 'block'; panelEl.classList.add('active'); }
  var loaders = {
    overview:   loadAdmOverview,
    users:      function() { loadAdmUsers(); },
    invites:    loadAdmInvites,
    behaviour:  loadAdmBehaviour,
    activity:   loadAdmActivity,
    events:     loadAdmEvents,
    ai:         loadAdmAI,
    settings:   loadAdmSettings,
  };
  if (loaders[panel]) loaders[panel]();
}

// ── Invites panel ──────────────────────────────────────────────
function loadAdmInvites() {
  var panel = document.getElementById('adm-invites');
  if (!panel) return;
  panel.innerHTML = '<div style="font-family:var(--fh);font-size:18px;font-weight:700;margin-bottom:16px">Invite Codes</div>'
    + '<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">'
    + '<input id="inv-label" class="fi" placeholder="Label (e.g. Beta tester)" style="flex:1;min-width:140px;font-size:11px;padding:7px 10px">'
    + '<input id="inv-email" class="fi" placeholder="Email hint (optional)" style="flex:1;min-width:140px;font-size:11px;padding:7px 10px">'
    + '<input id="inv-maxuses" class="fi" type="number" min="1" max="100" value="1" style="width:70px;font-size:11px;padding:7px 10px">'
    + '<button class="btn btn-p btn-sm" onclick="admCreateInvite()">+ Generate</button>'
    + '</div>'
    + '<div id="inv-list"><div style="color:var(--t3);font-size:11px">Loading...</div></div>'
    + '<div style="margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)">'
    + '<div style="font-size:11px;font-weight:600;color:var(--t2);margin-bottom:8px">Registration Mode</div>'
    + '<div style="display:flex;gap:8px">'
    + '<button class="btn btn-g btn-sm" onclick="admToggleReg(true)">Open Registration</button>'
    + '<button class="btn btn-o btn-sm" onclick="admToggleReg(false)">Invite Only</button>'
    + '</div>'
    + '<div id="inv-reg-status" style="font-size:10px;color:var(--t3);margin-top:6px"></div>'
    + '</div>';
  admLoadInviteList();
  // Check current status
  rq('/api/auth/registration-status').then(function(r) {
    var el2 = document.getElementById('inv-reg-status');
    if (el2 && r) el2.textContent = 'Current mode: ' + (r.registration_open ? 'Open (anyone can register)' : 'Invite-only');
  });
}

function admLoadInviteList() {
  rq('/api/auth/invites').then(function(r) {
    var el2 = document.getElementById('inv-list');
    if (!el2 || !r || !r.invites) return;
    if (!r.invites.length) {
      el2.innerHTML = '<div style="color:var(--t3);font-size:11px;padding:12px 0">No invite codes yet. Generate one above.</div>';
      return;
    }
    var html = '<table style="width:100%;border-collapse:collapse;font-size:11px">'
      + '<tr style="color:var(--t3);font-size:9px;text-transform:uppercase;border-bottom:1px solid var(--bd)">'
      + '<th style="text-align:left;padding:4px 6px">Code</th>'
      + '<th style="text-align:left;padding:4px 6px">Label</th>'
      + '<th style="padding:4px 6px">Uses</th>'
      + '<th style="text-align:left;padding:4px 6px">Used by</th>'
      + '<th style="padding:4px 6px">Created</th>'
      + '<th></th>'
      + '</tr>';
    r.invites.forEach(function(inv) {
      var used = inv.use_count >= inv.max_uses;
      var col  = used ? 'var(--t4)' : 'var(--b4)';
      html += '<tr style="border-bottom:1px solid var(--bd)">'
        + '<td style="padding:7px 6px"><span style="font-family:monospace;font-size:12px;color:' + col + '">' + inv.code + '</span>'
        + ' <button data-copy="' + inv.code + '" style="background:none;border:none;cursor:pointer;font-size:10px;color:var(--t3)">Copy</button>'
        + '</td>'
        + '<td style="padding:7px 6px;color:var(--t2)">' + (inv.label || '—') + '</td>'
        + '<td style="padding:7px 6px;text-align:center;color:' + (used ? 'var(--gr)' : 'var(--t2)') + '">' + inv.use_count + '/' + inv.max_uses + '</td>'
        + '<td style="padding:7px 6px;color:var(--t3);font-size:10px">' + (inv.used_by_email || '—') + '</td>'
        + '<td style="padding:7px 6px;color:var(--t3);font-size:10px">' + (inv.created_at || '').slice(0,10) + '</td>'
        + '<td style="padding:7px 6px"><button data-del="' + inv.id + '" style="background:none;border:none;cursor:pointer;font-size:13px;color:var(--t4)">x</button></td>'
        + '</tr>';
    });
    html += '</table>';
    el2.innerHTML = html;
    // Event delegation
    el2.addEventListener('click', function(e) {
      var cp = e.target.closest('[data-copy]');
      var dl = e.target.closest('[data-del]');
      if (cp) {
        var code = cp.dataset.copy;
        if (navigator.clipboard) { navigator.clipboard.writeText(code).then(function(){ toast('Copied: ' + code, 's'); }); }
        else toast(code, 'i');
      }
      if (dl) admDeleteInvite(parseInt(dl.dataset.del));
    });
  });
}
function admCreateInvite() {
  var label    = (document.getElementById('inv-label')    || {}).value || '';
  var email    = (document.getElementById('inv-email')    || {}).value || '';
  var maxUses  = parseInt((document.getElementById('inv-maxuses') || {}).value || '1');
  rq('/api/auth/invites', { method:'POST', body:{ label:label, email_hint:email, max_uses:maxUses } }).then(function(r) {
    if (r && r.code) {
      toast('Code: ' + r.code, 's');
      admLoadInviteList();
      var l=document.getElementById('inv-label'); if(l) l.value='';
      var e=document.getElementById('inv-email'); if(e) e.value='';
    }
  });
}

function admDeleteInvite(id) {
  if (!confirm('Delete this invite code?')) return;
  rq('/api/auth/invites/' + id, { method:'DELETE' }).then(function() { admLoadInviteList(); });
}

function admToggleReg(open) {
  rq('/api/auth/registration-toggle', { method:'POST', body:{ open:open } }).then(function(r) {
    var el2 = document.getElementById('inv-reg-status');
    if (el2 && r) el2.textContent = 'Current mode: ' + (r.registration_open ? 'Open' : 'Invite-only');
    toast(open ? 'Registration opened' : 'Invite-only mode enabled', 's');
  });
}

// ── Behaviour panel ────────────────────────────────────────────
function loadAdmBehaviour() {
  rq('/api/admin/behaviour/summary?days=30').then(function(r) {
    if (!r) return;

    // KPIs
    var s = function(id,v){ var e=document.getElementById(id); if(e) e.textContent=v; };
    s('beh-total-actions', (r.total_actions||0).toLocaleString());
    s('beh-active-users',  r.active_users || 0);
    s('beh-ai-feedback',   (r.ai_feedback && r.ai_feedback.total) || 0);
    s('beh-satisfaction',  (r.ai_feedback && r.ai_feedback.satisfaction) ? r.ai_feedback.satisfaction + '%' : '—');

    // Top actions bar chart
    var actEl = document.getElementById('beh-top-actions');
    if (actEl && r.top_actions && r.top_actions.length) {
      var maxCnt = r.top_actions[0].cnt;
      actEl.innerHTML = r.top_actions.map(function(a) {
        var pct = Math.round(a.cnt / maxCnt * 100);
        return '<div style="margin-bottom:7px">'
          + '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'
          + '<span style="color:var(--t2)">' + a.action + '</span>'
          + '<span style="color:var(--t3)">' + a.cnt.toLocaleString() + '</span>'
          + '</div>'
          + '<div style="height:5px;background:var(--bg3);border-radius:3px">'
          + '<div style="height:5px;width:' + pct + '%;background:var(--b5);border-radius:3px"></div></div>'
          + '</div>';
      }).join('');
    }

    // Category affinity
    var catEl = document.getElementById('beh-cat-affinity');
    if (catEl && r.cat_affinity && r.cat_affinity.length) {
      var maxCat = r.cat_affinity[0].cnt;
      var CATS_LOCAL = { ECONOMICS:'#10B981',FINANCE:'#06B6D4',CONFLICT:'#EF4444',
        GEOPOLITICS:'#3B82F6',POLITICS:'#6366F1',ENERGY:'#F59E0B',
        TECHNOLOGY:'#8B5CF6',DISASTER:'#F97316',HUMANITARIAN:'#EC4899' };
      catEl.innerHTML = r.cat_affinity.map(function(c) {
        var pct = Math.round(c.cnt / maxCat * 100);
        var col = CATS_LOCAL[c.category] || '#64748B';
        return '<div style="margin-bottom:7px">'
          + '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'
          + '<span style="color:' + col + ';font-weight:600">' + c.category + '</span>'
          + '<span style="color:var(--t3)">' + c.cnt.toLocaleString() + '</span>'
          + '</div>'
          + '<div style="height:5px;background:var(--bg3);border-radius:3px">'
          + '<div style="height:5px;width:' + pct + '%;background:' + col + ';border-radius:3px;opacity:.7"></div></div>'
          + '</div>';
      }).join('');
    }

    // Section popularity
    var secEl = document.getElementById('beh-sections');
    if (secEl && r.sections && r.sections.length) {
      var maxSec = r.sections[0].cnt;
      secEl.innerHTML = r.sections.map(function(s2) {
        var pct = Math.round(s2.cnt / maxSec * 100);
        return '<div style="margin-bottom:7px">'
          + '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'
          + '<span style="color:var(--t2)">' + (s2.section || 'unknown') + '</span>'
          + '<span style="color:var(--t3)">' + s2.cnt.toLocaleString() + '</span>'
          + '</div>'
          + '<div style="height:5px;background:var(--bg3);border-radius:3px">'
          + '<div style="height:5px;width:' + pct + '%;background:var(--am);border-radius:3px;opacity:.7"></div></div>'
          + '</div>';
      }).join('');
    }

    // AI feedback detail
    var fbEl = document.getElementById('beh-ai-detail');
    if (fbEl && r.ai_feedback) {
      var fb = r.ai_feedback;
      fbEl.innerHTML = '<div style="display:flex;gap:16px;margin-bottom:12px">'
        + '<div style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--gr)">'
        + (fb.positive||0) + '</div><div style="font-size:9px;color:var(--t3)">Helpful</div></div>'
        + '<div style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--re)">'
        + (fb.negative||0) + '</div><div style="font-size:9px;color:var(--t3)">Not helpful</div></div>'
        + '<div style="text-align:center"><div style="font-size:20px;font-weight:800;color:var(--am)">'
        + (fb.satisfaction||0) + '%</div><div style="font-size:9px;color:var(--t3)">Satisfaction</div></div>'
        + '</div>'
        + (fb.samples && fb.samples.length
          ? '<div style="font-size:9px;color:var(--t3);margin-bottom:6px">Recent feedback:</div>'
          + fb.samples.slice(0,5).map(function(s2) {
              return '<div style="padding:5px 8px;background:var(--bg3);border-radius:6px;margin-bottom:4px;font-size:10px">'
                + '<span style="color:' + (s2.rating===1?'var(--gr)':'var(--re)') + ';margin-right:6px">'
                + (s2.rating===1?'+1':'-1') + '</span>'
                + (s2.question||'').slice(0,60)
                + '</div>';
            }).join('') : '');
    }
  });
}

function admExportTraining() {
  rq('/api/admin/export-training-data?min_rating=1&limit=2000').then(function(r) {
    if (!r || !r.examples || !r.examples.length) {
      toast('No training data yet', 'e'); return;
    }
    var jsonl = r.examples.map(function(e) { return JSON.stringify(e); }).join('\n');
    var blob  = new Blob([jsonl], { type: 'application/jsonlines' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'worldlens-training-' + new Date().toISOString().slice(0,10) + '.jsonl';
    a.click();
    toast('Exported ' + r.examples.length + ' training examples', 's');
    track('training_data_exported', 'admin', String(r.examples.length));
  });
}

// ── OVERVIEW ─────────────────────────────────────────
async function loadAdmOverview() {
  var r = await rq('/api/admin/overview');
  if (!r || !r.users) return;

  var u = r.users, ev = r.events;
  var kpis = [
    {label:'Total Users',   val:u.total,         sub:'+'+u.new_this_week+' this week', col:'var(--b4)'},
    {label:'Active Users',  val:u.active,        sub:u.dau+' today',                   col:'var(--gr)'},
    {label:'Events 24h',    val:ev.last_24h,      sub:ev.high_impact+' high impact',    col:'var(--am)'},
    {label:'Total Events',  val:ev.total.toLocaleString(), sub:'in database',           col:'var(--pu)'},
  ];
  el('adm-kpis').innerHTML = kpis.map(function(k) {
    return '<div class="adm-kpi"><div class="adm-kpi-lbl">'+k.label+'</div>'
      +'<div class="adm-kpi-val" style="color:'+k.col+'">'+k.val+'</div>'
      +'<div class="adm-kpi-sub">'+k.sub+'</div></div>';
  }).join('');

  // Top regions
  el('adm-top-regions').innerHTML = (r.top_regions||[]).map(function(rr) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
      +'<span style="font-size:12px;flex:1">'+( rr.country_name||rr.label||'Unknown')+'</span>'
      +'<span style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--b4)">'+rr.n+'</span>'
      +'</div>';
  }).join('') || '<div style="color:var(--t3);font-size:11px">No data</div>';

  // Top assets
  el('adm-top-assets').innerHTML = (r.top_assets||[]).map(function(a) {
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
      +'<span style="font-size:11px;color:var(--b4);font-family:var(--fh);font-weight:700;width:60px">'+a.value+'</span>'
      +'<span style="font-size:11px;flex:1;color:var(--t2)">'+( a.label||a.value)+'</span>'
      +'<span style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--am)">'+a.n+'</span>'
      +'</div>';
  }).join('') || '<div style="color:var(--t3);font-size:11px">No data</div>';

  // Section usage chart
  var canvas = document.getElementById('adm-section-chart');
  if (canvas && r.section_usage && r.section_usage.length) {
    var ctx = canvas.getContext('2d');
    var W = canvas.parentElement.offsetWidth - 28;
    canvas.width = W; canvas.height = 100;
    var data = r.section_usage.slice(0,6);
    var maxN = Math.max.apply(null, data.map(function(d){return d.n;})) || 1;
    var bw = W / data.length - 6;
    ctx.clearRect(0,0,W,100);
    data.forEach(function(d,i) {
      var bh = Math.max(4, (d.n/maxN)*72);
      var x = i*(bw+6)+3, y = 80-bh;
      var grad = ctx.createLinearGradient(0,y,0,80);
      grad.addColorStop(0,'#EF4444'); grad.addColorStop(1,'#7F1D1D');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x,y,bw,bh,3) : ctx.rect(x,y,bw,bh);
      ctx.fill();
      ctx.fillStyle='#4B5E7A'; ctx.font='9px sans-serif'; ctx.textAlign='center';
      ctx.fillText((d.section||'?').slice(0,6),x+bw/2,95);
      ctx.fillStyle='#F0F6FF'; ctx.font='bold 10px sans-serif';
      ctx.fillText(d.n,x+bw/2,y-3);
    });
  }

  // AI providers
  el('adm-ai-providers').innerHTML = (r.ai_providers||[]).map(function(p) {
    var col = p.ai_provider === 'gemini' ? 'var(--b4)' : 'var(--pu)';
    return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0">'
      +'<span style="font-size:12px;flex:1;font-weight:600;color:'+col+'">'+( p.ai_provider||'default')+'</span>'
      +'<span style="font-family:var(--fh);font-size:13px;font-weight:700">'+p.n+'</span>'
      +'</div>';
  }).join('') || '<div style="color:var(--t3);font-size:11px">No provider data</div>';
}

// ── USERS ─────────────────────────────────────────────
async function loadAdmUsers(search, role, active) {
  var s   = document.getElementById('adm-user-search')  ? document.getElementById('adm-user-search').value  : (search||'');
  var r   = document.getElementById('adm-user-role')    ? document.getElementById('adm-user-role').value    : (role||'');
  var act = document.getElementById('adm-user-active')  ? document.getElementById('adm-user-active').value  : '';
  var qs = '?search='+encodeURIComponent(s)+'&role='+r+(act!==''?'&active='+act:'');
  var data = await rq('/api/admin/users'+qs);
  if (!data || !data.users) return;
  var countEl = document.getElementById('adm-user-count');
  if (countEl) countEl.textContent = data.total + ' users';

  el('adm-user-tbody').innerHTML = data.users.map(function(u) {
    var statusBadge = u.is_active
      ? '<span class="adm-status adm-active">Active</span>'
      : '<span class="adm-status adm-inactive">Inactive</span>';
    var roleBadge = u.is_admin
      ? '<span class="adm-status adm-admin">Admin</span>'
      : '<span style="color:var(--t3);font-size:10px">User</span>';
    var joined = (u.created_at||'').slice(0,10);
    return '<tr>'
      +'<td><div style="display:flex;align-items:center;gap:7px"><div style="width:28px;height:28px;border-radius:50%;background:'+(u.avatar_color||'#3B82F6')+';display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#fff">'+(u.username||'U').slice(0,2).toUpperCase()+'</div>'
      +'<div><div style="font-size:12px;font-weight:600">'+u.username+'</div></div></div></td>'
      +'<td style="color:var(--t2);font-size:11px">'+u.email+'</td>'
      +'<td>'+roleBadge+'</td>'
      +'<td>'+statusBadge+'</td>'
      +'<td style="text-align:center">'+u.watchlist_count+'</td>'
      +'<td style="text-align:center;color:'+(u.activity_7d>5?'var(--gr)':u.activity_7d>0?'var(--am)':'var(--t4)')+'">'+u.activity_7d+'</td>'
      +'<td style="color:var(--t3);font-size:10px">'+joined+'</td>'
      +'<td><div class="adm-actions">'
      +(u.is_active
        ? '<button class="adm-btn adm-btn-warning" onclick="admDeactivateUser('+u.id+')">Deactivate</button>'
        : '<button class="adm-btn adm-btn-ok"      onclick="admActivateUser('+u.id+')">Activate</button>')
      +'<button class="adm-btn adm-btn-danger" onclick="admDeleteUser('+u.id+',\''+u.username+'\')">Delete</button>'
      +'</div></td></tr>';
  }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--t3);padding:20px">No users found</td></tr>';
}

function admSearchUsers() { clearTimeout(ADM._searchTimer); ADM._searchTimer = setTimeout(loadAdmUsers, 300); }

async function admDeactivateUser(id) {
  if (!confirm('Deactivate this user?')) return;
  await rq('/api/admin/users/'+id+'/deactivate', {method:'POST'});
  toast('User deactivated','i'); loadAdmUsers();
}
async function admActivateUser(id) {
  await rq('/api/admin/users/'+id+'/activate', {method:'POST'});
  toast('User activated','s'); loadAdmUsers();
}
async function admDeleteUser(id, name) {
  if (!confirm('Permanently delete user "'+name+'"? This cannot be undone.')) return;
  await rq('/api/admin/users/'+id, {method:'DELETE'});
  toast('User deleted','i'); loadAdmUsers();
}

// ── ACTIVITY ─────────────────────────────────────────
async function loadAdmActivity() {
  var hours = document.getElementById('adm-act-hours') ? document.getElementById('adm-act-hours').value : 24;
  var r = await rq('/api/admin/activity?hours='+hours+'&limit=80');
  var t2 = await rq('/api/admin/activity/trending');

  if (r) {
    el('adm-act-tbody').innerHTML = (r.logs||[]).map(function(log) {
      return '<tr><td style="font-size:11px;color:var(--b4)">'+(log.username||'System')+'</td>'
        +'<td style="font-size:10px">'+log.action+'</td>'
        +'<td style="font-size:10px;color:var(--t3)">'+log.section+'</td>'
        +'<td style="font-size:10px;color:var(--t2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+log.detail+'</td>'
        +'<td style="font-size:9px;color:var(--t3)">'+tAgo(new Date(log.created_at))+'</td></tr>';
    }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--t3);padding:18px">No activity yet</td></tr>';

    el('adm-by-action').innerHTML = (r.by_action||[]).map(function(a) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'
        +'<span style="font-size:11px;flex:1">'+a.action+'</span>'
        +'<span style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--am)">'+a.n+'</span>'
        +'</div>';
    }).join('');
  }
  if (t2) {
    el('adm-top-interests').innerHTML = (t2.top_interests||[]).map(function(i) {
      return '<div style="display:flex;align-items:center;gap:8px;padding:4px 0">'
        +'<span style="font-size:11px;flex:1;text-transform:capitalize">'+i.interest+'</span>'
        +'<span style="font-family:var(--fh);font-size:13px;font-weight:700;color:var(--b4)">'+i.n+'</span>'
        +'</div>';
    }).join('');
  }
}

// ── EVENTS ────────────────────────────────────────────
async function loadAdmEvents() {
  var s   = document.getElementById('adm-ev-search')  ? document.getElementById('adm-ev-search').value  : '';
  var cat = document.getElementById('adm-ev-cat')     ? document.getElementById('adm-ev-cat').value     : '';
  var imp = document.getElementById('adm-ev-impact')  ? document.getElementById('adm-ev-impact').value  : '';
  var qs  = '?search='+encodeURIComponent(s)+'&category='+cat+'&impact='+imp;
  var r = await rq('/api/admin/events'+qs);
  if (!r || !r.events) return;

  el('adm-ev-tbody').innerHTML = r.events.map(function(ev) {
    var impCls = ev.impact==='High'?'var(--re)':ev.impact==='Medium'?'var(--am)':'var(--gr)';
    var flagIcon = ev.admin_flagged ? '🚩 ' : '';
    return '<tr style="cursor:pointer" onclick="openAdmEventModal(\''+ev.id+'\')">'
      +'<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">'+flagIcon+ev.title+'</td>'
      +'<td><span style="font-size:9px;color:var(--b4);background:rgba(59,130,246,.1);padding:2px 6px;border-radius:100px">'+ev.category+'</span></td>'
      +'<td style="font-size:11px;color:var(--t2)">'+( ev.country_name||ev.country_code||'—')+'</td>'
      +'<td><span style="color:'+impCls+';font-size:10px;font-weight:700">'+ev.impact+'</span></td>'
      +'<td style="font-family:var(--fh);font-size:12px;font-weight:700">'+parseFloat(ev.severity||5).toFixed(1)+'</td>'
      +'<td style="font-size:11px">'+( ev.ai_impact_score?parseFloat(ev.ai_impact_score).toFixed(1):'—')+'</td>'
      +'<td style="text-align:center">'+(ev.admin_flagged?'<span style="color:var(--re)">🚩</span>':'')+'</td>'
      +'<td style="font-size:10px;color:var(--t3)">'+tAgo(new Date(ev.timestamp))+'</td>'
      +'<td onclick="event.stopPropagation()">'
      +'<div class="adm-actions">'
      +'<button class="adm-btn adm-btn-blue" onclick="openAdmEventModal(\''+ev.id+'\')">Edit</button>'
      +'<button class="adm-btn adm-btn-danger" onclick="admQuickDelete(\''+ev.id+'\')">Del</button>'
      +'</div></td></tr>';
  }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--t3);padding:20px">No events</td></tr>';
}

async function loadAdmDuplicates() {
  var r = await rq('/api/admin/events/duplicates?hours=48');
  var warn = document.getElementById('adm-dup-warning');
  if (r && r.duplicate_groups && r.duplicate_groups.length) {
    warn.style.display = 'block';
    warn.innerHTML = '⚠️ Found <strong>'+r.duplicate_groups.length+' duplicate groups</strong> in the last 48h: '
      + r.duplicate_groups.slice(0,3).map(function(g){return g.category+' in '+(g.country_name||g.country_code)+' ('+g.count+'x)';}).join(', ');
  } else {
    warn.style.display = 'block';
    warn.innerHTML = '✓ No significant duplicates detected in the last 48h.';
    warn.style.color = 'var(--gr)';
    warn.style.borderColor = 'rgba(16,185,129,.3)';
    warn.style.background  = 'rgba(16,185,129,.07)';
  }
}

// Event modal
function openAdmEventModal(id) {
  ADM.editEventId = id;
  var modal = document.getElementById('adm-event-modal');
  modal.classList.add('on');
  // Find event in DOM data
  rq('/api/admin/events?search='+id+'&limit=1').then(function(r) {
    if (!r || !r.events || !r.events.length) return;
    var ev = r.events[0];
    document.getElementById('adm-edit-id').value = ev.id;
    document.getElementById('adm-edit-title').value = ev.title || '';
    document.getElementById('adm-edit-ai-summary').value = ev.ai_summary || '';
    document.getElementById('adm-edit-market-note').value = ev.ai_market_note || '';
    document.getElementById('adm-edit-tone').value = ev.sentiment_tone || 'Neutral';
    document.getElementById('adm-edit-admin-note').value = ev.admin_note || '';
  });
}
function closeAdmEventModal() { document.getElementById('adm-event-modal').classList.remove('on'); }
async function admSaveEvent() {
  var id = document.getElementById('adm-edit-id').value;
  await rq('/api/admin/events/'+id, {method:'PUT', body:{
    title:         document.getElementById('adm-edit-title').value,
    ai_summary:    document.getElementById('adm-edit-ai-summary').value,
    ai_market_note:document.getElementById('adm-edit-market-note').value,
    admin_note:    document.getElementById('adm-edit-admin-note').value,
  }});
  await rq('/api/admin/ai/outputs/'+id, {method:'PUT', body:{
    sentiment_tone: document.getElementById('adm-edit-tone').value,
  }});
  closeAdmEventModal(); toast('Event updated','s'); loadAdmEvents();
}
async function admDeleteEvent() {
  var id = document.getElementById('adm-edit-id').value;
  if (!confirm('Delete this event?')) return;
  await rq('/api/admin/events/'+id, {method:'DELETE'});
  closeAdmEventModal(); toast('Event deleted','i'); loadAdmEvents();
}
async function admFlagEvent() {
  var id = document.getElementById('adm-edit-id').value;
  var note = document.getElementById('adm-edit-admin-note').value;
  await rq('/api/admin/events/'+id+'/flag', {method:'POST', body:{note:note}});
  toast('Event flagged','i'); closeAdmEventModal(); loadAdmEvents();
}
async function admQuickDelete(id) {
  if (!confirm('Delete this event?')) return;
  await rq('/api/admin/events/'+id, {method:'DELETE'});
  toast('Deleted','i'); loadAdmEvents();
}

// ── AI MONITOR ────────────────────────────────────────
async function loadAdmAI() {
  var r = await rq('/api/admin/ai/outputs?limit=60');
  if (!r) return;

  var stats = r.stats || {};
  var kpis = [
    {label:'AI Summaries',    val:stats.has_summary||0,   col:'var(--pu)'},
    {label:'Sentiment Done',  val:stats.has_sentiment||0, col:'var(--b4)'},
    {label:'Avg Score',       val:(stats.avg_impact_score||5).toFixed(1)+'/10', col:'var(--am)'},
    {label:'Coverage',        val:(stats.coverage_pct||0).toFixed(0)+'%', col:'var(--gr)'},
  ];
  el('adm-ai-kpis').innerHTML = kpis.map(function(k) {
    return '<div class="adm-kpi"><div class="adm-kpi-lbl">'+k.label+'</div>'
      +'<div class="adm-kpi-val" style="color:'+k.col+'">'+k.val+'</div></div>';
  }).join('');

  el('adm-ai-tbody').innerHTML = (r.outputs||[]).slice(0,40).map(function(ev) {
    var sentCol = ev.sentiment_tone==='Positive'?'var(--gr)':ev.sentiment_tone==='Negative'?'var(--re)':'var(--t2)';
    var sum = (ev.ai_summary||'—').slice(0,60)+'...';
    return '<tr><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px">'+ev.title+'</td>'
      +'<td><span style="font-size:9px;color:var(--b4)">'+ev.category+'</span></td>'
      +'<td style="font-size:10px;color:var(--t2);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+sum+'</td>'
      +'<td><span style="color:'+sentCol+';font-size:10px;font-weight:600">'+(ev.sentiment_tone||'—')+'</span></td>'
      +'<td style="font-family:var(--fh);font-size:12px;font-weight:700">'+(ev.ai_impact_score||'—')+'</td>'
      +'<td><button class="adm-btn adm-btn-blue" onclick="openAdmEventModal(\''+ev.id+'\')">Edit</button></td></tr>';
  }).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--t3);padding:20px">No AI outputs yet</td></tr>';
}

// ── SETTINGS ─────────────────────────────────────────
async function loadAdmSettings() {
  var r = await rq('/api/admin/settings/ai');
  if (!r || r.detail) return;

  var activeProvider = r.global_provider || 'none';

  // ── Key status labels ──
  var cs = document.getElementById('claude-key-status');
  var gs = document.getElementById('gemini-key-status');
  if (cs) cs.textContent = r.claude_configured ? '✓ Key configured: ' + r.claude_key_preview : '✗ No key set';
  if (cs) cs.style.color = r.claude_configured ? 'var(--gr)' : 'var(--t3)';
  if (gs) gs.textContent = r.gemini_configured ? '✓ Key configured: ' + r.gemini_key_preview : '✗ No key set';
  if (gs) gs.style.color = r.gemini_configured ? 'var(--gr)' : 'var(--t3)';

  // ── Provider cards: highlight the ACTIVE one ──
  var cc = document.getElementById('adm-claude-card');
  var gc = document.getElementById('adm-gemini-card');
  if (cc) cc.classList.toggle('active-provider', activeProvider === 'claude');
  if (gc) gc.classList.toggle('active-provider', activeProvider === 'gemini');

  // ── Provider selector buttons ──
  ['gemini','claude','none'].forEach(function(p) {
    var btn = document.getElementById('prov-btn-' + p);
    if (!btn) return;
    var isActive = activeProvider === p;
    btn.style.background = isActive ? 'rgba(16,185,129,.2)' : '';
    btn.style.borderColor = isActive ? 'rgba(16,185,129,.5)' : '';
    btn.style.color       = isActive ? '#34D399' : '';
    btn.style.fontWeight  = isActive ? '700' : '';
  });

  // ── Badge ──
  var badge = document.getElementById('adm-provider-badge');
  if (badge) {
    var labels = { gemini: '✨ Gemini (active)', claude: '🤖 Claude (active)', none: '🚫 AI Disabled' };
    var colors = { gemini: '#34D399', claude: '#60A5FA', none: '#F87171' };
    badge.textContent = labels[activeProvider] || activeProvider;
    badge.style.color = colors[activeProvider] || 'var(--t3)';
    badge.style.background = activeProvider === 'none' ? 'rgba(248,113,113,.15)' :
                              activeProvider === 'claude' ? 'rgba(96,165,250,.15)' : 'rgba(52,211,153,.15)';
  }

  // ── System info table ──
  var sysEl = document.getElementById('adm-sys-info-body');
  if (sysEl) {
    var rows = [
      ['Active Provider', activeProvider],
      ['Gemini Key',  r.gemini_configured ? '✓ ' + r.gemini_key_preview : '✗ Not set'],
      ['Claude Key',  r.claude_configured  ? '✓ ' + r.claude_key_preview  : '✗ Not set (disabled)'],
      ['DB Path',     r.db_path || '—'],
    ];
    sysEl.innerHTML = rows.map(function(row) {
      return '<div style="display:flex;gap:10px;padding:4px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
        + '<span style="color:var(--t3);width:130px;flex-shrink:0;font-size:11px">' + row[0] + '</span>'
        + '<span style="color:var(--t1);font-size:11px">' + row[1] + '</span></div>';
    }).join('');
  }
}

async function setGlobalProvider(provider) {
  var labels = { gemini: 'Google Gemini', claude: 'Claude (Anthropic)', none: 'Disabled' };
  var r = await rq('/api/admin/settings/ai/provider', {method:'POST', body:{provider:provider}});
  if (r && r.status === 'ok') {
    toast('AI provider set to: ' + (labels[provider] || provider), 's');
    loadAdmSettings();
  } else {
    toast('Failed to switch provider', 'e');
  }
}

async function saveAIKey(provider) {
  var inp = document.getElementById(provider + '-key-inp');
  if (!inp || !inp.value.trim()) { toast('Enter a valid API key', 'e'); return; }
  var r = await rq('/api/admin/settings/ai', {method:'POST', body:{provider:provider, api_key:inp.value.trim()}});
  if (r && r.status === 'ok') {
    toast('API key saved' + (r.persisted_to_env ? ' and written to .env' : ' (runtime only)'), 's');
    inp.value = '';
    loadAdmSettings();
  } else {
    toast(r && r.detail ? r.detail : 'Failed to save key', 'e');
  }
}

async function promoteAdmin() {
  var emailEl = document.getElementById('promote-email');
  if (!emailEl || !emailEl.value.trim()) { toast('Enter email', 'e'); return; }
  var r = await rq('/api/admin/settings/make-admin', {method:'POST', body:{email:emailEl.value.trim()}});
  if (r && r.status === 'ok') { toast('User promoted to admin', 's'); emailEl.value = ''; }
  else toast('User not found', 'e');
}

// ── Admin button injection is handled directly in enterApp via adminBtnInject() ──

function adminBtnInject() {
  // Only inject once
  if (document.getElementById('admin-nav-btn')) return;
  if (G.user && G.user.is_admin) {
    var adminBtn = document.createElement('button');
    adminBtn.id = 'admin-nav-btn';
    adminBtn.className = 'btn btn-sm';
    adminBtn.style.cssText = 'background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.35);color:#FCA5A5;font-size:10px;padding:4px 10px;margin-left:4px';
    adminBtn.textContent = 'Admin';
    adminBtn.onclick = openAdmin;
    var navr = document.getElementById('navr');
    if (navr) navr.insertBefore(adminBtn, navr.firstChild);
  }
}



// ── HTTP ──────────────────────────────────────────────
// ── UTILS ─────────────────────────────────────────────
function fmtChg(c) {
  if(c===null||c===undefined) return '—';
  return (c>=0?'+':'')+c.toFixed(2)+'%';
}
function tFmt(ts) {
  try {
    var d=new Date(ts);
    return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short'})+' '+
           d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'});
  } catch(e){ return ts||''; }
}
// ── TOAST ─────────────────────────────────────────────
// ════════════════════════════════════════════════════════
// MAP MODE CONTROLLER
// ════════════════════════════════════════════════════════

var G_MAP_MODE = 'events'; // 'events' | 'heatmap' | 'graph' | 'timeline'

function setMapMode(mode, btn) {
  G_MAP_MODE = mode;
  document.querySelectorAll('.mtool-btn[id^="mtool-"]').forEach(function(b) {
    b.classList.toggle('on', b === btn);
  });

  var timeline = document.getElementById('map-timeline');
  var kgOverlay = document.getElementById('kg-overlay');

  // Reset overlays
  if (timeline) timeline.classList.remove('on');
  if (kgOverlay) kgOverlay.classList.remove('on');

  if (mode === 'events' || mode === 'map') {
    if (G.hmOn) { G.hmOn = false; clearHeatmap(); }
    updateMarkers();
  } else if (mode === 'heatmap') {
    updateMarkers();
    G.hmOn = true;
    drawHeatmap();
  } else if (mode === 'graph') {
    loadKnowledgeGraph();
  } else if (mode === 'timeline') {
    if (timeline) timeline.classList.add('on');
    renderTimeline();
    updateMarkers();
  }
}

// ════════════════════════════════════════════════════════
// ENHANCED HEATMAP
// ════════════════════════════════════════════════════════

function clearHeatmap() {
  if (G.hmLayers) G.hmLayers.forEach(function(l) { try{G.map.removeLayer(l);}catch(e){} });
  G.hmLayers = [];
}

function drawHeatmap() {
  clearHeatmap();
  if (!G.map) return;

  // Group events by country → aggregate risk score
  var countryScores = {};
  G.events.forEach(function(e) {
    if (!e.country_code || e.country_code === 'XX') return;
    var cc = e.country_code;
    if (!countryScores[cc]) countryScores[cc] = { total: 0, count: 0, lat: e.latitude, lon: e.longitude, name: e.country_name };
    var mst = parseFloat(e.sent_market_stress || 0);
    var sev = e.severity || 5;
    // Combined risk: weighted average of severity + market stress signal
    countryScores[cc].total += sev * 0.7 + mst * 30;
    countryScores[cc].count++;
  });

  Object.values(countryScores).forEach(function(d) {
    var avgScore = d.total / d.count;
    var r = Math.max(80, Math.min(280, avgScore * 25));
    var col = avgScore >= 7 ? '#EF4444' : avgScore >= 5 ? '#F59E0B' : avgScore >= 3 ? '#3B82F6' : '#10B981';
    var opacity = 0.08 + (avgScore / 10) * 0.22;

    var circle = L.circle([d.lat, d.lon], {
      radius: r * 1000,
      color: col, fillColor: col,
      fillOpacity: opacity, weight: 0,
    });
    circle.bindTooltip(
      '<div style="font-size:11px;font-weight:600">' + d.name + '</div>' +
      '<div style="font-size:10px;color:' + col + '">' + d.count + ' events · avg ' + (d.total/d.count).toFixed(1) + '/10</div>',
      { permanent: false, direction: 'top' }
    );
    circle.addTo(G.map);
    G.hmLayers.push(circle);
  });

  toast('Heatmap: ' + Object.keys(countryScores).length + ' countries', 'i');
}

// ════════════════════════════════════════════════════════
// TIMELINE STRIP
// ════════════════════════════════════════════════════════

function renderTimeline() {
  var track = document.getElementById('timeline-track');
  if (!track) return;

  var now = Date.now();
  var hours = 48;
  var buckets = 48; // 1 per hour
  var bucketMs = (hours / buckets) * 3600000;
  var counts = new Array(buckets).fill(0);
  var severities = new Array(buckets).fill(0);

  G.events.forEach(function(e) {
    var age = now - new Date(e.timestamp).getTime();
    if (age < 0 || age > hours * 3600000) return;
    var idx = Math.min(buckets - 1, Math.floor(age / bucketMs));
    counts[idx]++;
    severities[idx] = Math.max(severities[idx], e.severity || 5);
  });

  var maxCount = Math.max.apply(null, counts) || 1;

  track.innerHTML = counts.map(function(c, i) {
    var hPct = Math.max(4, Math.round((c / maxCount) * 38));
    var sev = severities[i];
    var col = sev >= 7 ? '#EF4444' : sev >= 5 ? '#F59E0B' : '#3B82F6';
    var hoursAgo = Math.round((i + 0.5) * (hours / buckets));
    return '<div class="tl-bar" style="height:' + hPct + 'px;background:' + col + '" ' +
      'title="' + hoursAgo + 'h ago · ' + c + ' events" ' +
      'onclick="filterByTimeRange(' + i + ',' + bucketMs + ')"></div>';
  }).reverse().join('');
}

function filterByTimeRange(bucketIdx, bucketMs) {
  var now = Date.now();
  var from = now - (bucketIdx + 1) * bucketMs;
  var to   = now - bucketIdx * bucketMs;
  var hoursAgo = Math.round((bucketIdx + 0.5) * bucketMs / 3600000);
  var evCount = G.events.filter(function(e) {
    var t = new Date(e.timestamp).getTime();
    return t >= from && t <= to;
  }).length;
  toast(hoursAgo + 'h ago — ' + evCount + ' events in this window', 'i');
}

// ════════════════════════════════════════════════════════
// MARKET STRESS METER
// ════════════════════════════════════════════════════════

var G_STRESS_ON = false;
function toggleStressMeter() {
  G_STRESS_ON = !G_STRESS_ON;
  var meter = document.getElementById('stress-meter');
  var btn = document.getElementById('mtool-sent');
  if (meter) meter.classList.toggle('on', G_STRESS_ON);
  if (btn) btn.classList.toggle('on', G_STRESS_ON);
  if (G_STRESS_ON) updateStressMeter();
}

function updateStressMeter() {
  var evs = G.events.slice(0, 40);
  var totalStress = 0, totalUnc = 0, count = 0;
  evs.forEach(function(e) {
    var mst = parseFloat(e.sent_market_stress || 0);
    var unc = parseFloat(e.sent_uncertainty || 0);
    // Weight by severity
    var w = (e.severity || 5) / 10;
    totalStress += mst * w;
    totalUnc += unc * w;
    count += w;
  });
  count = count || 1;
  var avgStress = totalStress / count;
  var avgUnc = totalUnc / count;

  var stressCol = avgStress > 0.6 ? '#EF4444' : avgStress > 0.3 ? '#F59E0B' : '#10B981';
  var stressLbl = avgStress > 0.6 ? 'HIGH' : avgStress > 0.3 ? 'ELEVATED' : 'STABLE';

  var sf  = document.getElementById('stress-fill');
  var sv_ = document.getElementById('stress-val');
  var sl  = document.getElementById('stress-lbl');
  var uf  = document.getElementById('unc-fill');
  var uv  = document.getElementById('unc-val');

  if (sf) { sf.style.width = (avgStress * 100).toFixed(0) + '%'; sf.style.background = stressCol; }
  if (sv_) sv_.textContent = (avgStress * 100).toFixed(0) + '%';
  if (sl) { sl.textContent = stressLbl; sl.style.color = stressCol; }
  if (uf) { uf.style.width = (avgUnc * 100).toFixed(0) + '%'; }
  if (uv) uv.textContent = (avgUnc * 100).toFixed(0) + '%';
}

// ════════════════════════════════════════════════════════
// NER ENTITY PANEL
// ════════════════════════════════════════════════════════

var G_NER = {};

async function loadNER() {
  var ev = G.panelEv;
  if (!ev) return;

  var chipsEl = document.getElementById('ep-ner-chips');
  var nerEl = document.getElementById('ep-ner');
  if (!chipsEl || !nerEl) return;

  // Check cache
  if (G_NER[ev.id]) { renderNER(G_NER[ev.id]); return; }

  chipsEl.innerHTML = '<span style="font-size:10px;color:var(--t3)">Extracting entities...</span>';
  nerEl.style.display = 'block';

  var r = await rq('/api/events/ner/' + ev.id, { method: 'POST' });
  if (!r || !r.entities) { chipsEl.innerHTML = '<span style="color:var(--t3);font-size:10px">No entities found</span>'; return; }
  G_NER[ev.id] = r.entities;
  renderNER(r.entities);
}

function renderNER(entities) {
  var chipsEl = document.getElementById('ep-ner-chips');
  var nerEl = document.getElementById('ep-ner');
  if (!chipsEl) return;
  nerEl.style.display = 'block';

  if (!entities.length) {
    chipsEl.innerHTML = '<span style="color:var(--t3);font-size:10px">No named entities detected</span>';
    return;
  }
  chipsEl.innerHTML = entities.map(function(ent) {
    var typeClass = (ent.type || '').toLowerCase();
    var sal = ent.salience ? ' (' + Math.round(ent.salience * 100) + '%)' : '';
    var hint = ent.sentiment_hint
      ? ' style="border-color:' + (ent.sentiment_hint === 'Positive' ? 'rgba(16,185,129,.4)' : ent.sentiment_hint === 'Negative' ? 'rgba(239,68,68,.4)' : '') + '"'
      : '';
    return '<span class="ner-entity-chip ' + typeClass + '"' + hint + '>'
      + (ent.text || '') + '<span style="opacity:.5;font-size:8px;margin-left:3px">' + (ent.type || '') + sal + '</span></span>';
  }).join('');
}

// ════════════════════════════════════════════════════════
// RELATED EVENTS PANEL (Knowledge Graph edges)
// ════════════════════════════════════════════════════════

var G_RELS = {};

async function loadRelatedEvents() {
  var ev = G.panelEv;
  if (!ev) return;

  var listEl = document.getElementById('ep-related-list');
  var relEl = document.getElementById('ep-related');
  var countEl = document.getElementById('ep-rel-count');
  if (!listEl || !relEl) return;

  // Cache check
  if (G_RELS[ev.id]) { renderRelated(G_RELS[ev.id]); return; }

  listEl.innerHTML = '<div style="font-size:10px;color:var(--t3);padding:6px 0">Finding related events...</div>';
  relEl.style.display = 'block';

  var r = await rq('/api/events/relationships/' + ev.id);
  if (!r || !r.relationships) { listEl.innerHTML = '<div style="font-size:10px;color:var(--t3)">No related events found</div>'; return; }
  G_RELS[ev.id] = r.relationships;
  renderRelated(r.relationships);
}

function renderRelated(rels) {
  var listEl = document.getElementById('ep-related-list');
  var relEl = document.getElementById('ep-related');
  var countEl = document.getElementById('ep-rel-count');
  if (!listEl) return;
  relEl.style.display = 'block';
  if (countEl) countEl.textContent = rels.length + ' links';

  if (!rels.length) {
    listEl.innerHTML = '<div style="font-size:10px;color:var(--t3)">No causal or correlated events detected</div>';
    return;
  }

  listEl.innerHTML = rels.slice(0, 6).map(function(rel) {
    var typeClass = 'rel-' + (rel.rel_type || 'correlated');
    var weight = rel.weight ? Math.round(rel.weight * 100) + '%' : '';
    var reasoning = rel.reasoning ? '<div style="font-size:9px;color:var(--t3);margin-top:2px;padding-left:4px">' + rel.reasoning + '</div>' : '';
    return '<div class="rel-event-row" onclick="openEP(\'' + rel.target_id + '\')">'
      + '<span class="rel-type-badge ' + typeClass + '">' + (rel.rel_type || '').slice(0,4) + '</span>'
      + '<div style="flex:1"><div class="rel-title">' + (rel.target_title || '') + '</div>'
      + reasoning + '</div>'
      + '<span class="rel-weight">' + weight + '</span>'
      + '</div>';
  }).join('');
}

// ════════════════════════════════════════════════════════
// ENHANCED SENTIMENT PANEL (multi-dimensional)
// ════════════════════════════════════════════════════════

function renderSentimentPanel(r) {
  var sec = document.getElementById('ep-sentiment');
  sec.style.display = 'block';

  var tone = r.tone || 'Neutral';
  var score = parseFloat(r.score || 0);
  var cls = tone === 'Positive' ? 'sent-pos' : tone === 'Negative' ? 'sent-neg' : 'sent-neu';
  var arrow = tone === 'Positive' ? '▲' : tone === 'Negative' ? '▼' : '●';

  var badge = document.getElementById('ep-sent-badge');
  badge.className = 'sent-badge ' + cls;
  badge.textContent = arrow + ' ' + tone + ' (' + (score >= 0 ? '+' : '') + score.toFixed(2) + ')';

  var bar = document.getElementById('ep-sent-bar');
  var absPct = Math.abs(score) * 50;
  bar.style.background = sentBarColor(score);
  if (score >= 0) { bar.style.left = '50%'; bar.style.width = absPct + '%'; }
  else { bar.style.left = (50 - absPct) + '%'; bar.style.width = absPct + '%'; }

  document.getElementById('ep-sent-score').textContent = (score >= 0 ? '+' : '') + score.toFixed(2);
  document.getElementById('ep-info-type').textContent = r.info_type || '';

  var intEl = document.getElementById('ep-intensity');
  var intColor = r.intensity === 'Extreme' ? 'var(--re)' : r.intensity === 'High' ? 'var(--or)' : r.intensity === 'Medium' ? 'var(--am)' : 'var(--t3)';
  intEl.textContent = r.intensity ? r.intensity + ' intensity' : '';
  intEl.style.color = intColor;

  // Multi-dimensional gauges
  var multidim = document.getElementById('ep-sent-multidim');
  var hasMultidim = r.uncertainty !== undefined || r.market_stress !== undefined;
  if (multidim && hasMultidim) {
    multidim.style.display = 'block';
    function setDim(id, valId, val) {
      var fill = document.getElementById(id);
      var valEl = document.getElementById(valId);
      if (fill) fill.style.width = (Math.abs(val) * 100).toFixed(0) + '%';
      if (valEl) valEl.textContent = (val >= 0 ? '' : '-') + (Math.abs(val) * 100).toFixed(0) + '%';
    }
    setDim('sdim-unc', 'sdim-unc-v', r.uncertainty || 0);
    setDim('sdim-mst', 'sdim-mst-v', r.market_stress || 0);
    // momentum can be negative — show abs, color by sign
    var mom = r.narrative_momentum || 0;
    setDim('sdim-mom', 'sdim-mom-v', mom);
    var momFill = document.getElementById('sdim-mom');
    if (momFill) momFill.style.background = mom > 0 ? '#F59E0B' : '#94A3B8';
    setDim('sdim-crd', 'sdim-crd-v', r.credibility || 0.72);
  }

  // Entity sentiments
  var entities = r.entity_sentiments || [];
  var entEl = document.getElementById('ep-entities');
  if (entities.length && entEl) {
    entEl.innerHTML = '<div style="font-size:9px;color:var(--t3);text-transform:uppercase;letter-spacing:.08em;margin-bottom:5px">Entity Sentiment</div>'
      + entities.slice(0, 4).map(function(ent) {
        var ec = ent.sentiment === 'Positive' ? 'sent-pos' : ent.sentiment === 'Negative' ? 'sent-neg' : 'sent-neu';
        var escore = typeof ent.score === 'number' ? (ent.score >= 0 ? '+' : '') + ent.score.toFixed(2) : '';
        return '<div class="entity-row">'
          + '<span class="entity-name">' + (ent.entity || '') + '</span>'
          + '<span class="entity-type">' + (ent.type || '') + '</span>'
          + '<span class="sent-badge ' + ec + '" style="padding:1px 7px;font-size:9px">' + (ent.sentiment || '') + (escore ? ' ' + escore : '') + '</span>'
          + '</div>'
          + (ent.reason ? '<div class="entity-reason" style="padding-left:4px">' + ent.reason + '</div>' : '');
      }).join('');
  } else if (entEl) {
    entEl.innerHTML = '';
  }
}

// ════════════════════════════════════════════════════════════
// KNOWLEDGE GRAPH — complete rewrite
// Fixes: stable layout, edge hover tooltips, side panel,
//        relationship explanations, animated simulation
// ════════════════════════════════════════════════════════════

var KG = {
  nodes: [], edges: [], loaded: false,
  animFrame: null,
  hovered: null,        // hovered node
  hoveredEdge: null,    // hovered edge
  selected: null,       // clicked/selected node
  sim: {                // simulation state
    running: false,
    alpha: 1.0,
    alphaDecay: 0.02,
    velocityDecay: 0.4,
  },
  pan: { x: 0, y: 0 },
  zoom: 1.0,
  nodeMap: {},
  lastMouse: { x: 0, y: 0 },
};

var REL_COLORS = {
  causal:      '#EF4444',
  correlated:  '#F59E0B',
  hierarchical:'#A78BFA',
  temporal:    '#475569',
};

var REL_LABELS = {
  causal:      'Causal — one event directly triggered another',
  correlated:  'Correlated — both driven by same underlying factor',
  hierarchical:'Hierarchical — one event is part of a larger pattern',
  temporal:    'Temporal — events close in time, possible link',
};


// ── Sprint 2: Admin — behaviour analytics + export training data ──────────

function admLoadBehaviourStats() {
  // Load AI feedback stats into the admin behaviour panel
  var detailEl = document.getElementById('beh-ai-detail');
  if (!detailEl) return;

  rq('/api/ai/feedback/stats').then(function(r) {
    if (!r) return;
    detailEl.innerHTML =
      '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:12px">'
      + _admStatCard('Total Ratings', r.total || 0, 'var(--b4)')
      + _admStatCard('Positive (+1)', r.positive || 0, 'var(--gr)')
      + _admStatCard('Negative (-1)', r.negative || 0, 'var(--re)')
      + _admStatCard('Satisfaction', (r.satisfaction_rate || 0).toFixed(1) + '%', 'var(--am)')
      + '</div>'
      + (r.total >= 10
          ? '<div style="font-size:11px;color:var(--gr)">✓ Enough data to export for fine-tuning</div>'
          : '<div style="font-size:11px;color:var(--t3)">Need ' + (10 - (r.total||0)) + ' more ratings before exporting</div>');
  });

  // Load top affinity categories across all users
  rq('/api/admin/activity?action=event_opened&limit=500').then(function(r) {
    var catEl = document.getElementById('beh-top-cats');
    if (!catEl || !r || !r.actions) return;
    var cats = {};
    r.actions.forEach(function(a) {
      var detail = a.detail || '';
      var cat    = detail.split('|')[1] || '';
      if (cat) cats[cat] = (cats[cat] || 0) + 1;
    });
    var sorted = Object.keys(cats).sort(function(a,b){ return cats[b]-cats[a]; }).slice(0,8);
    if (!sorted.length) return;
    var total  = sorted.reduce(function(s,c){ return s + cats[c]; }, 0);
    catEl.innerHTML = '<div style="font-size:11px;font-weight:700;margin-bottom:8px">Top Categories (all users)</div>'
      + sorted.map(function(cat) {
          var pct = Math.round(cats[cat]/total*100);
          return '<div style="margin-bottom:5px">'
            + '<div style="display:flex;justify-content:space-between;font-size:10px;margin-bottom:2px">'
            + '<span style="color:var(--t2)">' + cat + '</span>'
            + '<span style="color:var(--t3)">' + cats[cat] + ' opens · ' + pct + '%</span></div>'
            + '<div style="height:4px;background:var(--bg3);border-radius:2px">'
            + '<div style="width:' + pct + '%;height:100%;background:var(--b5);border-radius:2px"></div></div></div>';
        }).join('');
  });
}

function _admStatCard(label, value, color) {
  return '<div style="background:var(--bg3);border-radius:8px;padding:10px 14px;min-width:90px">'
    + '<div style="font-size:20px;font-weight:800;color:' + color + '">' + value + '</div>'
    + '<div style="font-size:9px;color:var(--t3);margin-top:2px">' + label + '</div>'
    + '</div>';
}
