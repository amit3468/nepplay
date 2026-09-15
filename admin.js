// ==========================================================
// NEPPLAY — admin.js (v3.6)
// All admin panel logic
// ==========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, updateDoc, deleteDoc,
  addDoc, query, where, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyDydTDF5_DOC3BDH6YAbkcNu_NT0qmRcTc",
    authDomain: "nepplaygaming.firebaseapp.com",
    projectId: "nepplaygaming",
    storageBucket: "nepplaygaming.firebasestorage.app",
    messagingSenderId: "893565645520",
    appId: "1:893565645520:web:09d4cb4069dae55d6ee4d5"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

console.log("🔥 Admin ready v3.6");

// ============================================================
// STATE
// ============================================================
let allPayments = [];
let allRegs = [];
let allUsers = [];
let allTournaments = [];
let allPayouts = [];
let allResults = [];
let currentStatusFilter = 'pending';
let currentMethodFilter = 'all';
let currentSearchTerm = '';
let roomTournaments = [];
let selectedResultTournament = null;

// ============================================================
// HELPERS
// ============================================================
function fmtDate(ts) {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function fmtShort(ts) {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function dayKey(ts) {
  if (!ts?.toDate) return null;
  return ts.toDate().toISOString().slice(0,10);
}
function todayKey() { return new Date().toISOString().slice(0,10); }
function initials(n) { return (n || 'U')[0].toUpperCase(); }
function fmtRs(n) { return 'Rs. ' + (Number(n) || 0).toLocaleString(); }

// ============================================================
// NOTIFICATIONS
// ============================================================
let notifications = [];

function addNotif(type, title, message) {
  notifications.unshift({
    id: Date.now() + Math.random(),
    type, title, message,
    time: new Date(),
    read: false
  });
  if (notifications.length > 50) notifications = notifications.slice(0, 50);
  renderNotifBell();
  renderNotifPanel();
}

function renderNotifBell() {
  const unread = notifications.filter(n => !n.read).length;
  const c = document.getElementById('notifCount');
  if (!c) return;
  if (unread > 0) { c.innerText = unread > 9 ? '9+' : unread; c.style.display = 'block'; }
  else c.style.display = 'none';
}

function renderNotifPanel() {
  const list = document.getElementById('notifList');
  if (!list) return;
  if (!notifications.length) {
    list.innerHTML = '<div style="padding:20px; text-align:center; color:#6b7280; font-size:13px;">No new notifications</div>';
    return;
  }
  const icons = { user:'👤', registration:'📋', payment:'💰', review:'✅', result:'🏆' };
  const colors = { user:'#3b82f6', registration:'#a855f7', payment:'#f59e0b', review:'#22c55e', result:'#eab308' };
  list.innerHTML = notifications.map(n => `
    <div class="notif-item" style="${n.read ? 'opacity:.5' : ''}">
      <div class="notif-icon" style="background:${colors[n.type] || '#6366f1'};">${icons[n.type] || '🔔'}</div>
      <div class="notif-body">
        <div class="notif-title">${n.title}</div>
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${n.time.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}</div>
      </div>
    </div>
  `).join('');
}

window.toggleNotifPanel = function(e) {
  if (e) e.stopPropagation();
  const p = document.getElementById('notifPanel');
  if (!p) return;
  p.classList.toggle('open');
  p.style.display = p.classList.contains('open') ? 'block' : 'none';
  if (p.classList.contains('open')) {
    setTimeout(() => {
      notifications.forEach(n => n.read = true);
      renderNotifBell();
    }, 1500);
  }
};

window.clearAllNotifs = function() {
  notifications.forEach(n => n.read = true);
  renderNotifBell();
  renderNotifPanel();
};

document.addEventListener('click', function(e) {
  const p = document.getElementById('notifPanel');
  const b = document.querySelector('.notif-bell-btn');
  if (p && b && !p.contains(e.target) && !b.contains(e.target)) {
    p.style.display = 'none';
    p.classList.remove('open');
  }
});

function attachRealtimeListeners() {
  let i1 = true;
  onSnapshot(collection(db, 'users'), snap => {
    if (i1) { i1 = false; return; }
    snap.docChanges().forEach(c => {
      if (c.type === 'added') {
        const u = c.doc.data();
        addNotif('user', '👤 New user registered', `${u.username || 'User'} (${u.email || ''})`);
      }
    });
  });
  let i2 = true;
  onSnapshot(collection(db, 'tournament_registrations'), snap => {
    if (i2) { i2 = false; return; }
    snap.docChanges().forEach(c => {
      if (c.type === 'added') {
        const r = c.doc.data();
        addNotif('registration', `${r.entryType === 'paid' ? '💵' : '🆓'} New registration`, `${r.username || 'User'} joined ${r.tournamentTitle || 'a tournament'}`);
      }
    });
  });
  let i3 = true;
  onSnapshot(collection(db, 'tournament_payments'), snap => {
    if (i3) { i3 = false; return; }
    snap.docChanges().forEach(c => {
      if (c.type === 'added') {
        const p = c.doc.data();
        addNotif('payment', '💰 Payment submitted', `${p.username} — Rs. ${p.amount} via ${p.method}`);
      }
    });
  });
}

// ============================================================
// CREATE TOURNAMENT
// ============================================================
window.toggleCreateEntryFee = function() {
  const t = document.getElementById('ctEntryType').value;
  document.getElementById('ctFeeWrap').style.display = t === 'paid' ? 'block' : 'none';
  updateCreatePreview();
};

window.updateCreatePreview = function() {
  const title = document.getElementById('ctTitle').value || 'Tournament Title';
  const game = document.getElementById('ctGame').value || 'Game';
  const mode = document.getElementById('ctMode').value || 'Solo';
  const type = document.getElementById('ctEntryType').value;
  const fee = document.getElementById('ctEntryFee').value || 0;
  const pool = document.getElementById('ctPrizePool').value || 0;
  const kills = document.getElementById('ctTopKills').value || 0;
  const date = document.getElementById('ctDate').value || '—';
  const time = document.getElementById('ctTime').value || '—';
  const max = document.getElementById('ctMax').value || 0;

  document.getElementById('ctPreview').innerHTML = `
    <b style="color:#fff;">${title}</b>
    · ${game} · ${mode}
    ${type === 'paid' ? `· 💰 Rs. ${fee}` : '· 🆓 Free'}
    ${pool ? `· 🏆 Rs. ${pool}` : ''}
    ${kills && type === 'paid' ? `· 🎯 Rs. ${kills}` : ''}
    · 📅 ${date} ${time}
    · 👥 max ${max}
  `;
};

window.addEventListener('DOMContentLoaded', function() {
  ['ctTitle','ctGame','ctMode','ctEntryFee','ctPrizePool','ctTopKills','ctDate','ctTime','ctMax'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateCreatePreview);
  });
});

window.resetCreateForm = function() {
  document.getElementById('createTournamentForm').reset();
  document.getElementById('ctEntryType').value = 'free';
  document.getElementById('ctFeeWrap').style.display = 'none';
  document.getElementById('ctTime').value = '18:00';
  document.getElementById('ctMax').value = '100';
  document.getElementById('ctPrizePool').value = '1500';
  document.getElementById('ctTopKills').value = '500';
  updateCreatePreview();
  document.getElementById('ctStatus').style.display = 'none';
};

window.submitCreateTournament = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('ctSubmitBtn');
  btn.disabled = true;
  btn.innerText = '⏳ Creating...';

  try {
    const title = document.getElementById('ctTitle').value.trim();
    const game = document.getElementById('ctGame').value;
    const mode = document.getElementById('ctMode').value;
    const entryType = document.getElementById('ctEntryType').value;
    const entryFee = Number(document.getElementById('ctEntryFee').value) || 0;
    const prizePool = Number(document.getElementById('ctPrizePool').value) || 0;
    const topKillsPrize = Number(document.getElementById('ctTopKills').value) || 0;
    const date = document.getElementById('ctDate').value;
    const time = document.getElementById('ctTime').value;
    const max = Number(document.getElementById('ctMax').value) || 100;
    const desc = document.getElementById('ctDesc').value.trim();

    if (!title) throw new Error('Title is required');
    if (!game) throw new Error('Select a game');
    if (!date) throw new Error('Select a date');
    if (entryType === 'paid' && entryFee <= 0) throw new Error('Paid tournaments need an entry fee');

    const docRef = await addDoc(collection(db, 'tournaments'), {
      title, game, mode, entryType,
      entryFee: entryType === 'paid' ? entryFee : 0,
      prizePool,
      topKillsPrize: entryType === 'paid' ? topKillsPrize : 0,
      date, time, max,
      filled: 0,
      description: desc,
      status: 'upcoming',
      createdAt: serverTimestamp()
    });

    console.log("✅ Created tournament:", docRef.id);

    const statusEl = document.getElementById('ctStatus');
    statusEl.style.display = 'block';
    statusEl.style.color = '#4ade80';
    statusEl.innerHTML = `✅ Tournament "${title}" created successfully!`;
    setTimeout(() => statusEl.style.display = 'none', 6000);

    window.showToast('✅ Tournament created');
    resetCreateForm();
    await loadRecentCreated();
  } catch (err) {
    console.error('Create tournament error:', err);
    const statusEl = document.getElementById('ctStatus');
    statusEl.style.display = 'block';
    statusEl.style.color = '#f87171';
    statusEl.textContent = '❌ ' + err.message;
    setTimeout(() => statusEl.style.display = 'none', 5000);
    window.showToast('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = '🚀 Create Tournament';
  }
};

// ============================================================
// RECENTLY CREATED TOURNAMENTS (with Edit + Delete)
// ============================================================
window.loadRecentCreated = async function() {
  const list = document.getElementById('recentCreatedTournaments');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">📭</span>No tournaments yet</div>';
      return;
    }
    list.innerHTML = items.slice(0, 15).map(t => {
      const isPaid = (t.entryType || t.entry_type || 'free').toLowerCase() === 'paid';
      const safeTitle = (t.title || 'Untitled').replace(/'/g, "\\'");
      const isCompleted = (t.status || '').toLowerCase() === 'completed';
      return `
        <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'}">
          <div class="reg-icon">${isCompleted ? '✅' : (isPaid ? '💵' : '🏆')}</div>
          <div class="reg-main">
            <div class="reg-line-1"><b>${t.title || 'Untitled'}</b><span class="reg-sep">—</span><span class="reg-tournament">${t.game || ''} · ${t.mode || ''}</span></div>
            <div class="reg-line-2">
              ${t.date ? '📅 ' + t.date : ''}${t.time ? ' · 🕐 ' + t.time : ''}${isPaid ? ' · 💰 Rs. ' + (t.entryFee || 0) : ' · FREE'}
              ${t.prizePool ? ' · 🏆 Rs. ' + t.prizePool : ''}
            </div>
            <div class="reg-actions">
              ${!isCompleted ? `<button class="btn-edit small" onclick="editTournament('${t.id}')">✏️ Edit</button>` : ''}
              <button class="btn-delete small" onclick="deleteTournament('${t.id}','${safeTitle}')">🗑️ Delete</button>
            </div>
          </div>
          <div class="reg-right">
            <span class="type-chip ${isCompleted ? 'free' : (isPaid ? 'paid' : 'free')}">${isCompleted ? 'Completed' : (isPaid ? 'Paid' : 'Free')}</span>
            <small>${fmtShort(t.createdAt)}</small>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

window.editTournament = async function(id) {
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    const t = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(x => x.id === id);
    if (!t) { window.showToast('❌ Tournament not found'); return; }

    // Simple prompt-based edit (for future: use a modal)
    const newTitle = prompt('Tournament Title:', t.title || '');
    if (newTitle === null) return;
    const newPrizePool = prompt('Prize Pool (Rs.):', t.prizePool || 0);
    if (newPrizePool === null) return;
    const newTopKills = prompt('Top Kills Prize (Rs.):', t.topKillsPrize || 0);
    if (newTopKills === null) return;
    const newDate = prompt('Date (YYYY-MM-DD):', t.date || '');
    if (newDate === null) return;
    const newTime = prompt('Time (HH:MM):', t.time || '');
    if (newTime === null) return;
    const newMax = prompt('Max Players:', t.max || 100);
    if (newMax === null) return;

    await updateDoc(doc(db, 'tournaments', id), {
      title: newTitle.trim(),
      prizePool: Number(newPrizePool) || 0,
      topKillsPrize: Number(newTopKills) || 0,
      date: newDate.trim(),
      time: newTime.trim(),
      max: Number(newMax) || 100,
      updatedAt: serverTimestamp()
    });

    window.showToast('✅ Tournament updated');
    await loadRecentCreated();
    if (typeof window.loadTournamentsAdmin === 'function') await window.loadTournamentsAdmin();
  } catch (err) {
    console.error('editTournament error:', err);
    window.showToast('❌ ' + err.message);
  }
};

window.deleteTournament = async function(id, title) {
  if (!confirm(`Delete tournament "${title}"?\n\nThis will permanently remove it from the member page. Registrations and payments for this tournament will remain in the database.`)) return;

  try {
    await deleteDoc(doc(db, 'tournaments', id));
    window.showToast('🗑️ Tournament deleted');
    await loadRecentCreated();
    if (typeof window.loadTournamentsAdmin === 'function') await window.loadTournamentsAdmin();
  } catch (err) {
    console.error('deleteTournament error:', err);
    window.showToast('❌ ' + err.message);
  }
};

// ============================================================
// PAYMENTS
// ============================================================
window.loadPayments = async function() {
  const list = document.getElementById('payList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  try {
    const snap = await getDocs(collection(db, 'tournament_payments'));
    allPayments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allPayments.sort((a, b) => (b.submittedAt?.toMillis?.() || 0) - (a.submittedAt?.toMillis?.() || 0));
    updateCounts();
    renderPayments();
    renderDashboardRecent();
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

function updateCounts() {
  const c = { pending:0, approved:0, rejected:0 };
  allPayments.forEach(p => { if (c[p.status] !== undefined) c[p.status]++; });
  const el = id => document.getElementById(id);
  if (el('cntPending')) el('cntPending').innerText = c.pending;
  if (el('cntApproved')) el('cntApproved').innerText = c.approved;
  if (el('cntRejected')) el('cntRejected').innerText = c.rejected;
  if (el('cntAll')) el('cntAll').innerText = allPayments.length;
  if (el('pendingPayBadge')) el('pendingPayBadge').innerText = c.pending;
  if (el('dashPending')) el('dashPending').innerText = c.pending;
  const total = allPayments.filter(p => p.status === 'approved').reduce((s,p) => s + (Number(p.amount)||0), 0);
  if (el('dashPaid')) el('dashPaid').innerText = fmtRs(total);
}

function renderPayments() {
  const list = document.getElementById('payList');
  if (!list) return;
  let filtered = allPayments.filter(p => {
    if (currentStatusFilter !== 'all' && p.status !== currentStatusFilter) return false;
    if (currentMethodFilter !== 'all' && p.method !== currentMethodFilter) return false;
    if (currentSearchTerm) {
      const q = currentSearchTerm.toLowerCase();
      if (!`${p.username||''} ${p.email||''} ${p.txnId||''} ${p.tournamentTitle||''} ${p.ign||''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">🎉</span>No ' + currentStatusFilter + ' payments.</div>';
    return;
  }
  const chipClass = { esewa:'chip-esewa', khalti:'chip-khalti', imepay:'chip-imepay', bank:'chip-bank' };
  const chipLabel = { esewa:'💚 eSewa', khalti:'💜 Khalti', imepay:'🟠 IME Pay', bank:'🏦 Bank' };
  list.innerHTML = filtered.map(p => {
    const showActions = p.status === 'pending';
    const safeName = (p.username||'').replace(/'/g,'');
    return `
      <div class="pay-item" data-status="${p.status}" data-method="${p.method||''}">
        <div class="pay-item-left">
          ${p.screenshotUrl ? '<img src="' + p.screenshotUrl + '" class="pay-shot" onclick="openShot(\'' + p.screenshotUrl + '\')">' : '<div class="pay-shot-empty">No image</div>'}
        </div>
        <div class="pay-item-mid">
          <div class="pay-user">
            <div class="avatar">${initials(p.username)}</div>
            <div><b>${p.username || 'Unknown'}</b><small>${p.email || ''}</small></div>
          </div>
          <div class="pay-details">
            <div class="detail-row"><span>🏆 Tournament</span><b>${p.tournamentTitle||'—'}</b></div>
            <div class="detail-row"><span>🎮 IGN</span><b>${p.ign||'—'}</b></div>
            <div class="detail-row"><span>📱 Phone</span><b>${p.phone||'—'}</b></div>
            <div class="detail-row"><span>💳 Method</span><span class="chip ${chipClass[p.method]||''}">${chipLabel[p.method]||p.method}</span></div>
            <div class="detail-row"><span>💰 Amount</span><b class="amount">Rs. ${p.amount||0}</b></div>
            <div class="detail-row"><span>🔖 Txn ID</span><code class="txn-id">${p.txnId||'—'}</code></div>
            <div class="detail-row"><span>🕐 Submitted</span><small>${fmtShort(p.submittedAt)}</small></div>
          </div>
        </div>
        <div class="pay-item-right">
          <span class="status-pill ${p.status}">${p.status.toUpperCase()}</span>
          ${showActions ? `
            <button class="btn-approve" onclick="openReview('${p.id}','${safeName}','approve','payment')">✔ Approve</button>
            <button class="btn-reject"  onclick="openReview('${p.id}','${safeName}','reject','payment')">✘ Reject</button>
          ` : ''}
          ${p.screenshotUrl ? '<a href="' + p.screenshotUrl + '" target="_blank" class="link-view">🔍 Full Screenshot</a>' : ''}
          ${p.adminNote ? '<small style="color:#9ca3af;margin-top:6px;">📝 ' + p.adminNote + '</small>' : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.filterPayStatus = function(status, btn) {
  currentStatusFilter = status;
  document.querySelectorAll('.pay-status-tabs button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderPayments();
};
window.filterPayMethod = function(m) { currentMethodFilter = m; renderPayments(); };
window.filterPayments = function() {
  currentSearchTerm = document.getElementById('paySearch').value;
  renderPayments();
};

// ============================================================
// REGISTRATIONS
// ============================================================
window.loadRegistrations = async function() {
  const list = document.getElementById('regList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  try {
    const snap = await getDocs(collection(db, 'tournament_registrations'));
    allRegs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allRegs.sort((a, b) => (b.registeredAt?.toMillis?.() || 0) - (a.registeredAt?.toMillis?.() || 0));
    if (document.getElementById('dashRegs')) document.getElementById('dashRegs').innerText = allRegs.length;
    if (document.getElementById('regsBadge')) document.getElementById('regsBadge').innerText = allRegs.length;
    renderRegistrations();
    renderDashboardRecent();
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

window.filterRegistrations = function() { renderRegistrations(); };

function renderRegistrations() {
  const list = document.getElementById('regList');
  if (!list) return;
  const q = (document.getElementById('regSearch').value || '').toLowerCase();
  let filtered = allRegs.filter(r => !q || `${r.username||''} ${r.tournamentTitle||''} ${r.ign||''} ${r.txnId||''} ${r.email||''}`.toLowerCase().includes(q));
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">📋</span>No registrations.</div>';
    return;
  }
  list.innerHTML = filtered.map(r => {
    const isPaid = r.entryType === 'paid';
    const safeName = (r.username||'').replace(/'/g,'');
    const isPending = r.status === 'pending';
    return `
      <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'}">
        <div class="reg-icon">${isPaid ? '💵' : '🏆'}</div>
        <div class="reg-main">
          <div class="reg-line-1"><b>${r.username || 'Unknown'}</b><span class="reg-sep">—</span><span class="reg-tournament">${r.tournamentTitle || 'Tournament'}</span></div>
          <div class="reg-line-2">
            ${r.ign ? 'IGN: <b>' + r.ign + '</b> · ' : ''}
            ${r.phone ? '📱 ' + r.phone + ' · ' : ''}
            ${isPaid ? 'Txn: <code>' + (r.txnId||'—') + '</code> · ' : ''}
            ${isPaid ? 'Rs. ' + (r.amount||0) : 'Free Entry'}
          </div>
          ${isPaid && r.screenshotUrl ? `
            <div class="reg-payment-preview">
              <img src="${r.screenshotUrl}" class="thumb" onclick="openShot('${r.screenshotUrl}')">
              <span class="method-tag">${(r.method||'').toUpperCase()}</span>
              <span class="status-tag ${r.status}">${(r.status||'').toUpperCase()}</span>
            </div>
          ` : ''}
          <div class="reg-actions">
            ${isPending ? `
              <button class="btn-approve small" onclick="openReview('${r.id}','${safeName}','approve','registration')">✔ Approve</button>
              <button class="btn-reject small"  onclick="openReview('${r.id}','${safeName}','reject','registration')">✘ Reject</button>
            ` : ''}
            <button class="btn-edit small" onclick="editRegistration('${r.id}')">✏️ Edit</button>
            <button class="btn-delete small" onclick="deleteRegistration('${r.id}','${safeName}')">🗑️ Delete</button>
          </div>
        </div>
        <div class="reg-right">
          <span class="type-chip ${isPaid ? 'paid' : 'free'}">${isPaid ? 'Paid' : 'Free'}</span>
          <span class="status-pill ${r.status}" style="font-size:10px;padding:3px 8px;">${(r.status||'').toUpperCase()}</span>
          <small>${fmtShort(r.registeredAt)}</small>
        </div>
      </div>
    `;
  }).join('');
}

window.editRegistration = async function(id) {
  const reg = allRegs.find(r => r.id === id);
  if (!reg) return;
  const newIgn = prompt('Edit IGN:', reg.ign || '');
  if (newIgn === null) return;
  const newPhone = prompt('Edit Phone:', reg.phone || '');
  if (newPhone === null) return;
  try {
    await updateDoc(doc(db, 'tournament_registrations', id), {
      ign: newIgn.trim(),
      phone: newPhone.trim()
    });
    window.showToast('✅ Updated');
    window.loadRegistrations();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

window.deleteRegistration = async function(id, name) {
  if (!confirm('Delete registration for ' + name + '?')) return;
  try {
    await deleteDoc(doc(db, 'tournament_registrations', id));
    window.showToast('🗑️ Deleted');
    window.loadRegistrations();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// MATCH RESULTS
// ============================================================
window.loadMatchResultsSection = async function() {
  await populateResultTournamentDropdown();
  await loadRecentResults();
};

async function populateResultTournamentDropdown() {
  const select = document.getElementById('resultTournamentSelect');
  if (!select) return;
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    const tournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    select.innerHTML = '<option value="">— Choose a tournament —</option>' +
      tournaments.map(t => `<option value="${t.id}">${t.title || 'Untitled'} (${t.game || 'Game'})</option>`).join('');
  } catch (err) { console.warn(err); }
}

window.loadTournamentForResult = async function() {
  const select = document.getElementById('resultTournamentSelect');
  const tid = select.value;
  const form = document.getElementById('resultForm');
  const summary = document.getElementById('resultTournamentSummary');
  if (!tid) { form.style.display = 'none'; return; }

  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    const t = snap.docs.map(d => ({ id: d.id, ...d.data() })).find(x => x.id === tid);
    if (!t) return;

    selectedResultTournament = t;
    const fee = Number(t.entryFee || t.entry_fee || 0);
    const pool = Number(t.prizePool || t.prize_pool || 0);
    const killsPrize = Number(t.topKillsPrize || t.top_kills_prize || 0);

    const regSnap = await getDocs(query(
      collection(db, 'tournament_registrations'),
      where('tournamentId', '==', tid),
      where('status', '==', 'confirmed')
    ));
    const playerCount = regSnap.size;
    const collected = fee * playerCount;
    const netProfit = collected - pool - killsPrize;

    summary.innerHTML = `
      <div class="result-summary-header">
        <h3>${t.title || 'Tournament'}</h3>
        <span>${t.game || ''} · ${t.mode || ''}</span>
      </div>
      <div class="result-summary-stats">
        <div><span>Entry Fee</span><b>${fee === 0 ? 'FREE' : fmtRs(fee)}</b></div>
        <div><span>Players</span><b>${playerCount}</b></div>
        <div><span>Collected</span><b>${fmtRs(collected)}</b></div>
        <div><span>Prize Pool</span><b>${fmtRs(pool)}</b></div>
        <div><span>Top Kill Prize</span><b>${fmtRs(killsPrize)}</b></div>
        <div><span>Net Profit</span><b style="color:${netProfit >= 0 ? '#4ade80' : '#f87171'}">${fmtRs(netProfit)}</b></div>
      </div>
    `;

    const p1 = Math.round(pool * 0.50);
    const p2 = Math.round(pool * 0.30);
    const p3 = Math.round(pool * 0.20);

    document.getElementById('winner1Prize').value = fmtRs(p1);
    document.getElementById('winner2Prize').value = fmtRs(p2);
    document.getElementById('winner3Prize').value = fmtRs(p3);
    document.getElementById('topKillerPrize').value = fmtRs(killsPrize);
    document.getElementById('resultPool').innerText = fmtRs(pool);
    document.getElementById('resultCollection').innerText = fmtRs(collected);
    document.getElementById('resultNetProfit').innerText = fmtRs(netProfit);
    document.getElementById('resultNetProfit').style.color = netProfit >= 0 ? '#4ade80' : '#f87171';

    ['winner1Kills','winner2Kills','winner3Kills','topKillerKills'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.oninput = updateResultTotal;
    });

    updateResultTotal();
    form.style.display = 'block';
  } catch (err) {
    console.error('loadTournamentForResult error:', err);
    window.showToast('❌ ' + err.message);
  }
};

window.updateResultTotal = function() {
  if (!selectedResultTournament) return;
  const pool = Number(selectedResultTournament.prizePool || selectedResultTournament.prize_pool || 0);
  const killsPrize = Number(selectedResultTournament.topKillsPrize || selectedResultTournament.top_kills_prize || 0);
  const p1 = Math.round(pool * 0.50);
  const p2 = Math.round(pool * 0.30);
  const p3 = Math.round(pool * 0.20);
  const w1Name = (document.getElementById('winner1Name').value || '').trim().toLowerCase();
  const tkName = (document.getElementById('topKillerName').value || '').trim().toLowerCase();
  const sameAsFirst = !tkName || (w1Name && tkName === w1Name);
  const topKillerPayout = sameAsFirst ? 0 : killsPrize;
  const total = p1 + p2 + p3 + topKillerPayout;
  document.getElementById('resultTotalPayout').innerText = fmtRs(total);
};

window.submitMatchResults = async function() {
  if (!selectedResultTournament) { window.showToast('❌ No tournament selected'); return; }
  const t = selectedResultTournament;
  const tid = t.id;
  const tTitle = t.title || 'Tournament';

  const w1Name = (document.getElementById('winner1Name').value || '').trim();
  const w2Name = (document.getElementById('winner2Name').value || '').trim();
  const w3Name = (document.getElementById('winner3Name').value || '').trim();
  const tkName = (document.getElementById('topKillerName').value || '').trim();

  if (!w1Name) { window.showToast('❌ 1st place username required'); return; }

  const w1Kills = Number(document.getElementById('winner1Kills').value) || 0;
  const w2Kills = Number(document.getElementById('winner2Kills').value) || 0;
  const w3Kills = Number(document.getElementById('winner3Kills').value) || 0;
  const tkKills = Number(document.getElementById('topKillerKills').value) || w1Kills;

  const w1Method = document.getElementById('winner1Method').value;
  const w2Method = document.getElementById('winner2Method').value;
  const w3Method = document.getElementById('winner3Method').value;
  const tkMethod = document.getElementById('topKillerMethod').value;

  const pool = Number(t.prizePool || t.prize_pool || 0);
  const killsPrize = Number(t.topKillsPrize || t.top_kills_prize || 0);

  const p1 = Math.round(pool * 0.50);
  const p2 = Math.round(pool * 0.30);
  const p3 = Math.round(pool * 0.20);

  const btn = document.getElementById('submitResultsBtn');
  btn.disabled = true;
  btn.innerText = '⏳ Saving...';

  try {
    const payoutRecords = [];

    payoutRecords.push({
      winnerName: w1Name, tournamentId: tid, tournamentTitle: tTitle,
      amount: p1, rank: '1', kills: w1Kills, method: w1Method,
      note: `1st place, ${w1Kills} kills`,
      status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
    });

    if (w2Name) {
      payoutRecords.push({
        winnerName: w2Name, tournamentId: tid, tournamentTitle: tTitle,
        amount: p2, rank: '2', kills: w2Kills, method: w2Method,
        note: `2nd place, ${w2Kills} kills`,
        status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    }

    if (w3Name) {
      payoutRecords.push({
        winnerName: w3Name, tournamentId: tid, tournamentTitle: tTitle,
        amount: p3, rank: '3', kills: w3Kills, method: w3Method,
        note: `3rd place, ${w3Kills} kills`,
        status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    }

    const sameAsFirst = !tkName || (tkName.toLowerCase() === w1Name.toLowerCase());
    if (!sameAsFirst && killsPrize > 0) {
      payoutRecords.push({
        winnerName: tkName, tournamentId: tid, tournamentTitle: tTitle,
        amount: killsPrize, rank: 'Top Killer', kills: tkKills, method: tkMethod,
        note: `Top killer, ${tkKills} kills`,
        status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    } else if (sameAsFirst && killsPrize > 0 && w1Kills > 0) {
      payoutRecords[0].amount = p1 + killsPrize;
      payoutRecords[0].note = `1st place + Top Killer, ${w1Kills} kills`;
      payoutRecords[0].rank = '1 + Top Killer';
    }

    for (const rec of payoutRecords) {
      await addDoc(collection(db, 'tournament_payouts'), rec);
    }

    await addDoc(collection(db, 'match_results'), {
      tournamentId: tid, tournamentTitle: tTitle,
      winner1: { name: w1Name, kills: w1Kills, prize: p1, method: w1Method },
      winner2: w2Name ? { name: w2Name, kills: w2Kills, prize: p2, method: w2Method } : null,
      winner3: w3Name ? { name: w3Name, kills: w3Kills, prize: p3, method: w3Method } : null,
      topKiller: sameAsFirst
        ? { name: w1Name, kills: w1Kills, prize: killsPrize, sameAsFirst: true }
        : { name: tkName, kills: tkKills, prize: killsPrize, method: tkMethod },
      totalPayouts: payoutRecords.reduce((s, p) => s + p.amount, 0),
      completedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });

    await updateDoc(doc(db, 'tournaments', tid), { status: 'completed', completedAt: serverTimestamp() });

    addNotif('result', '🏆 Match completed', `${tTitle} — ${w1Name} won 1st place`);

    window.showToast('✅ Results saved! ' + payoutRecords.length + ' payouts created');
    resetResultsForm();
    await loadRecentResults();
    await loadPayouts();
  } catch (err) {
    console.error('submitMatchResults error:', err);
    window.showToast('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = '🏆 Submit Results & Create Payouts';
  }
};

window.resetResultsForm = function() {
  ['winner1Name','winner1Kills','winner2Name','winner2Kills','winner3Name','winner3Kills','topKillerName','topKillerKills'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('winner1Method').value = 'esewa';
  document.getElementById('winner2Method').value = 'esewa';
  document.getElementById('winner3Method').value = 'esewa';
  document.getElementById('topKillerMethod').value = 'esewa';
  document.getElementById('resultTournamentSelect').value = '';
  document.getElementById('resultForm').style.display = 'none';
  selectedResultTournament = null;
};

async function loadRecentResults() {
  const list = document.getElementById('recentResults');
  if (!list) return;
  try {
    const snap = await getDocs(collection(db, 'match_results'));
    allResults = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allResults.sort((a, b) => (b.completedAt?.toMillis?.() || 0) - (a.completedAt?.toMillis?.() || 0));

    if (!allResults.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">📭</span>No matches completed yet</div>';
      return;
    }

    list.innerHTML = allResults.slice(0, 15).map(r => {
      const w1 = r.winner1 || {};
      const tk = r.topKiller || {};
      return `
        <div class="reg-card paid-reg">
          <div class="reg-icon">🏁</div>
          <div class="reg-main">
            <div class="reg-line-1"><b>${r.tournamentTitle || 'Tournament'}</b></div>
            <div class="reg-line-2">
              🥇 <b>${w1.name || '—'}</b> (${w1.kills || 0} kills) — Rs. ${w1.prize || 0}
              ${tk.sameAsFirst ? ' · 🎯 same as 1st' : ` · 🎯 <b>${tk.name || '—'}</b> (${tk.kills || 0})`}
            </div>
          </div>
          <div class="reg-right"><span class="type-chip paid">COMPLETED</span><small>${fmtShort(r.completedAt)}</small></div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
}

// ============================================================
// DAILY COLLECTIONS
// ============================================================
window.loadDailyCollections = function() {
  const range = document.getElementById('dailyRangeFilter')?.value || 'all';
  let payments = allPayments.filter(p => p.status === 'approved');
  if (range === 'today') payments = payments.filter(p => dayKey(p.reviewedAt || p.submittedAt) === todayKey());
  else if (range !== 'all') {
    const days = Number(range);
    const cutoff = Date.now() - days * 86400000;
    payments = payments.filter(p => (p.reviewedAt?.toMillis?.() || p.submittedAt?.toMillis?.() || 0) >= cutoff);
  }

  let payouts = allPayouts;
  if (range === 'today') payouts = payouts.filter(x => dayKey(x.paidAt || x.createdAt) === todayKey());
  else if (range !== 'all') {
    const days = Number(range);
    const cutoff = Date.now() - days * 86400000;
    payouts = payouts.filter(x => (x.paidAt?.toMillis?.() || x.createdAt?.toMillis?.() || 0) >= cutoff);
  }

  const totalCollected = payments.reduce((s,p) => s + (Number(p.amount)||0), 0);
  const totalPayouts = payouts.reduce((s,p) => s + (Number(p.amount)||0), 0);
  const netProfit = totalCollected - totalPayouts;

  const days = {};
  payments.forEach(p => {
    const k = dayKey(p.reviewedAt || p.submittedAt); if (!k) return;
    if (!days[k]) days[k] = { collected:0, payouts:0, count:0, payoutsCount:0, byMethod:{} };
    days[k].collected += Number(p.amount)||0;
    days[k].count++;
    const m = p.method || 'unknown';
    days[k].byMethod[m] = (days[k].byMethod[m] || 0) + (Number(p.amount)||0);
  });
  payouts.forEach(x => {
    const k = dayKey(x.paidAt || x.createdAt); if (!k) return;
    if (!days[k]) days[k] = { collected:0, payouts:0, count:0, payoutsCount:0, byMethod:{} };
    days[k].payouts += Number(x.amount)||0;
    days[k].payoutsCount = (days[k].payoutsCount || 0) + 1;
  });

  const sortedKeys = Object.keys(days).sort().reverse();
  const el = id => document.getElementById(id);
  if (el('dailyTotalCollected')) el('dailyTotalCollected').innerText = fmtRs(totalCollected);
  if (el('dailyTotalPayouts')) el('dailyTotalPayouts').innerText = fmtRs(totalPayouts);
  if (el('dailyTotalNet')) el('dailyTotalNet').innerText = fmtRs(netProfit);
  if (el('dailyActiveDays')) el('dailyActiveDays').innerText = sortedKeys.length;

  const list = document.getElementById('dailyList');
  if (!list) return;
  if (!sortedKeys.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">📅</span>No activity in this range.</div>';
  } else {
    list.innerHTML = sortedKeys.map(k => {
      const d = days[k];
      const net = d.collected - d.payouts;
      const methodStr = Object.entries(d.byMethod).map(([m, amt]) => {
        const emoji = { esewa:'💚', khalti:'💜', imepay:'🟠', bank:'🏦' }[m] || '💳';
        return emoji + ' ' + amt.toLocaleString();
      }).join(' · ');
      return `
        <div class="reg-card free-reg">
          <div class="reg-icon">📅</div>
          <div class="reg-main">
            <div class="reg-line-1"><b>${new Date(k).toLocaleDateString('en-GB', { weekday:'long', day:'2-digit', month:'short', year:'numeric' })}</b></div>
            <div class="reg-line-2">
              💰 Collected: <b style="color:#4ade80">${fmtRs(d.collected)}</b> (${d.count})
              · 📤 Payouts: <b style="color:#f87171">${fmtRs(d.payouts)}</b> (${d.payoutsCount || 0})
              · 📊 Net: <b style="color:${net >= 0 ? '#4ade80' : '#f87171'}">${fmtRs(net)}</b>
            </div>
            ${methodStr ? '<div class="reg-line-2" style="font-size:12px;">💳 By method: ' + methodStr + '</div>' : ''}
          </div>
          <div class="reg-right"><span class="type-chip ${net >= 0 ? 'paid' : 'free'}">${fmtRs(net)}</span></div>
        </div>
      `;
    }).join('');
  }

  const allApproved = allPayments.filter(p => p.status === 'approved');
  const methods = ['esewa','khalti','imepay','bank'];
  const labels = { esewa:'💚 eSewa', khalti:'💜 Khalti', imepay:'🟠 IME Pay', bank:'🏦 Bank' };
  const byMethodEl = document.getElementById('dailyByMethod');
  if (byMethodEl) {
    byMethodEl.innerHTML = methods.map(m => {
      const count = allApproved.filter(p => p.method === m).length;
      const sum = allApproved.filter(p => p.method === m).reduce((s,p) => s + (Number(p.amount)||0), 0);
      return `<div class="reg-card free-reg"><div class="reg-icon">💰</div><div class="reg-main"><div class="reg-line-1"><b>${labels[m]}</b></div><div class="reg-line-2">${count} approved</div></div><div class="reg-right"><span class="type-chip paid">${fmtRs(sum)}</span></div></div>`;
    }).join('');
  }
};

// ============================================================
// PRIZE CALCULATOR
// ============================================================
window.calculatePrize = function() {
  const fee = Number(document.getElementById('calcFee').value) || 0;
  const players = Number(document.getElementById('calcPlayers').value) || 0;
  const pool = Number(document.getElementById('calcPool').value) || 0;
  const killsPrize = Number(document.getElementById('calcKills').value) || 0;
  const collected = fee * players;
  const totalPrizes = pool + killsPrize;
  const netRevenue = collected - totalPrizes;
  const margin = collected > 0 ? ((netRevenue / collected) * 100).toFixed(1) : 0;
  const rtp = collected > 0 ? ((totalPrizes / collected) * 100).toFixed(1) : 0;
  const breakeven = (pool + killsPrize) > 0 && fee > 0 ? Math.ceil((pool + killsPrize) / fee) : 0;
  const first = Math.round(pool * 0.50);
  const second = Math.round(pool * 0.30);
  const third = Math.round(pool * 0.20);
  const result = document.getElementById('calcResult');
  result.style.display = 'block';
  result.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><small>COLLECTED</small><b>${fmtRs(collected)}</b><span>From ${players}</span></div>
      <div class="stat-card"><small>NET REVENUE</small><b style="color:${netRevenue >= 0 ? '#4ade80' : '#f87171'}">${fmtRs(netRevenue)}</b><span>Profit</span></div>
      <div class="stat-card"><small>MARGIN</small><b>${margin}%</b><span>Net / Collected</span></div>
      <div class="stat-card"><small>RTP</small><b>${rtp}%</b><span>Return to players</span></div>
      <div class="stat-card"><small>BREAKEVEN</small><b>${breakeven}</b><span>Players needed</span></div>
    </div>
    <h3 class="mt">🥇 Winner Breakdown</h3>
    <div class="list">
      <div class="reg-card free-reg"><div class="reg-icon">🥇</div><div class="reg-main"><div class="reg-line-1"><b>1st Place</b></div></div><div class="reg-right"><span class="type-chip paid">${fmtRs(first)}</span></div></div>
      <div class="reg-card free-reg"><div class="reg-icon">🥈</div><div class="reg-main"><div class="reg-line-1"><b>2nd Place</b></div></div><div class="reg-right"><span class="type-chip paid">${fmtRs(second)}</span></div></div>
      <div class="reg-card free-reg"><div class="reg-icon">🥉</div><div class="reg-main"><div class="reg-line-1"><b>3rd Place</b></div></div><div class="reg-right"><span class="type-chip paid">${fmtRs(third)}</span></div></div>
    </div>`;
};

// ============================================================
// EARNINGS
// ============================================================
window.loadEarnings = function() {
  const approved = allPayments.filter(p => p.status === 'approved');
  const pending = allPayments.filter(p => p.status === 'pending');
  const total = approved.reduce((s,p) => s + (Number(p.amount)||0), 0);
  const pendingAmt = pending.reduce((s,p) => s + (Number(p.amount)||0), 0);
  const avg = approved.length ? Math.round(total / approved.length) : 0;
  const el = id => document.getElementById(id);
  if (el('earnTotal')) el('earnTotal').innerText = fmtRs(total);
  if (el('earnApproved')) el('earnApproved').innerText = approved.length;
  if (el('earnPending')) el('earnPending').innerText = fmtRs(pendingAmt);
  if (el('earnAvg')) el('earnAvg').innerText = fmtRs(avg);
  const methods = ['esewa','khalti','imepay','bank'];
  const labels = { esewa:'💚 eSewa', khalti:'💜 Khalti', imepay:'🟠 IME Pay', bank:'🏦 Bank' };
  const breakdown = document.getElementById('earningsBreakdown');
  if (breakdown) {
    breakdown.innerHTML = methods.map(m => {
      const count = approved.filter(p => p.method === m).length;
      const sum = approved.filter(p => p.method === m).reduce((s,p) => s + (Number(p.amount)||0), 0);
      return `<div class="reg-card free-reg"><div class="reg-icon">💰</div><div class="reg-main"><div class="reg-line-1"><b>${labels[m]}</b></div><div class="reg-line-2">${count} approved</div></div><div class="reg-right"><span class="type-chip paid">${fmtRs(sum)}</span></div></div>`;
    }).join('');
  }
};

// ============================================================
// PAYOUTS
// ============================================================
window.loadPayouts = async function() {
  const list = document.getElementById('payoutList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  try {
    const snap = await getDocs(collection(db, 'tournament_payouts'));
    allPayouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allPayouts.sort((a, b) => (b.paidAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0) - (a.paidAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0));

    const total = allPayouts.reduce((s,p) => s + (Number(p.amount)||0), 0);
    const paid = allPayouts.filter(p => p.status === 'paid');
    const pending = allPayouts.filter(p => p.status !== 'paid');

    const el = id => document.getElementById(id);
    if (el('payoutTotal')) el('payoutTotal').innerText = fmtRs(total);
    if (el('payoutWinners')) el('payoutWinners').innerText = paid.length;
    if (el('payoutPending')) el('payoutPending').innerText = fmtRs(pending.reduce((s,p) => s + (Number(p.amount)||0), 0));

    if (!allPayouts.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">🏆</span>No payouts yet.</div>';
      return;
    }

    list.innerHTML = allPayouts.map(w => {
      const isPaid = w.status === 'paid';
      return `
        <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'}">
          <div class="reg-icon">🏆</div>
          <div class="reg-main">
            <div class="reg-line-1"><b>${w.winnerName || 'Unknown'}</b><span class="reg-sep">—</span><span class="reg-tournament">${w.tournamentTitle || 'Tournament'}</span></div>
            <div class="reg-line-2">🥇 ${w.rank || '—'}${w.kills ? ' · ' + w.kills + ' kills' : ''} · ${fmtRs(w.amount || 0)}${w.method ? ' · ' + w.method : ''}${w.note ? ' · ' + w.note : ''}</div>
          </div>
          <div class="reg-right"><span class="type-chip ${isPaid ? 'paid' : 'free'}">${isPaid ? 'PAID' : 'PENDING'}</span><small>${fmtShort(w.paidAt || w.createdAt)}</small></div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

window.addPayout = async function() {
  const winnerName = prompt('Winner name (username):');
  if (!winnerName) return;
  const tournamentTitle = prompt('Tournament title:');
  if (!tournamentTitle) return;
  const amount = Number(prompt('Amount (Rs.):', '500'));
  if (!amount || amount <= 0) return;
  const rank = prompt('Rank (#1, #2, #3, Top Killer):', '1');
  const method = prompt('Payout method (esewa/khalti/imepay/bank/cash):', 'esewa');
  const note = prompt('Note (optional):', '');
  try {
    await addDoc(collection(db, 'tournament_payouts'), {
      winnerName, tournamentTitle, amount,
      rank: rank || '1',
      method: method || 'cash',
      note: note || '',
      status: 'paid',
      paidAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    window.showToast('✅ Payout recorded');
    window.loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// PROFIT SHARING
// ============================================================
window.loadProfitShare = function() {
  const approved = allPayments.filter(p => p.status === 'approved');
  const collected = approved.reduce((s,p) => s + (Number(p.amount)||0), 0);
  const payouts = allPayouts.reduce((s,p) => s + (Number(p.amount)||0), 0);
  const net = collected - payouts;
  window.__netProfit = net;
  const result = document.getElementById('shareResult');
  if (result) {
    result.innerHTML = `<div class="stat-grid">
      <div class="stat-card"><small>TOTAL COLLECTED</small><b>${fmtRs(collected)}</b><span>Approved payments</span></div>
      <div class="stat-card"><small>TOTAL PAYOUTS</small><b>${fmtRs(payouts)}</b><span>To winners</span></div>
      <div class="stat-card"><small>NET PROFIT</small><b style="color:${net >= 0 ? '#4ade80' : '#f87171'}">${fmtRs(net)}</b><span>To share</span></div>
    </div>`;
  }
};

window.calculateShares = function() {
  const name1 = document.getElementById('admin1Name').value || 'Admin 1';
  const name2 = document.getElementById('admin2Name').value || 'Admin 2';
  const share1 = Number(document.getElementById('admin1Share').value) || 0;
  const share2 = Number(document.getElementById('admin2Share').value) || 0;
  if (share1 + share2 !== 100) {
    alert('Shares must add up to 100%. Currently: ' + (share1 + share2) + '%');
    return;
  }
  const net = window.__netProfit || 0;
  const amt1 = Math.round(net * share1 / 100);
  const amt2 = net - amt1;
  document.getElementById('shareResult').innerHTML = `
    <div class="stat-grid"><div class="stat-card"><small>NET PROFIT</small><b>${fmtRs(net)}</b><span>To split</span></div></div>
    <h3 class="mt">🤝 Share Breakdown</h3>
    <div class="list">
      <div class="reg-card paid-reg"><div class="reg-icon">👤</div><div class="reg-main"><div class="reg-line-1"><b>${name1}</b></div><div class="reg-line-2">${share1}%</div></div><div class="reg-right"><span class="type-chip paid">${fmtRs(amt1)}</span></div></div>
      <div class="reg-card paid-reg"><div class="reg-icon">👤</div><div class="reg-main"><div class="reg-line-1"><b>${name2}</b></div><div class="reg-line-2">${share2}%</div></div><div class="reg-right"><span class="type-chip paid">${fmtRs(amt2)}</span></div></div>
    </div>
  `;
};

// ============================================================
// ROOM DETAILS
// ============================================================
window.loadRoomDetailsForm = async function() {
  const select = document.getElementById('roomTournamentSelect');
  if (!roomTournaments.length) {
    try {
      const snap = await getDocs(collection(db, 'tournaments'));
      roomTournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      select.innerHTML = '<option value="">— Select tournament —</option>' +
        roomTournaments.map(t => `<option value="${t.id}">${t.title || 'Untitled'} (${t.game || 'Game'})</option>`).join('');
    } catch (err) { console.warn(err); return; }
  }

  const tid = select.value;
  const form = document.getElementById('roomDetailsForm');
  if (!tid) { form.style.display = 'none'; return; }

  const t = roomTournaments.find(x => x.id === tid);
  if (!t) return;

  form.style.display = 'block';
  document.getElementById('roomTournamentName').textContent = t.title || 'Tournament';
  document.getElementById('roomId').value = t.roomId || '';
  document.getElementById('roomPassword').value = t.roomPassword || '';
  document.getElementById('roomFormat').value = t.roomFormat || '';
  document.getElementById('roomRounds').value = t.roomRounds || '';
  document.getElementById('roomOpenTime').value = t.roomOpenTime || '';
  document.getElementById('roomRules').value = t.roomRules || '';

  if (t.roomRevealAt) {
    const d = new Date(t.roomRevealAt);
    const pad = n => String(n).padStart(2, '0');
    document.getElementById('roomRevealAt').value =
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    document.getElementById('roomRevealAt').value = '';
  }
  document.getElementById('roomSaveStatus').style.display = 'none';
};

window.saveRoomDetails = async function() {
  const tid = document.getElementById('roomTournamentSelect').value;
  if (!tid) { alert('Select a tournament first'); return; }
  const roomId = document.getElementById('roomId').value.trim();
  const roomPassword = document.getElementById('roomPassword').value.trim();
  const roomFormat = document.getElementById('roomFormat').value.trim();
  const roomRounds = document.getElementById('roomRounds').value.trim();
  const roomOpenTime = document.getElementById('roomOpenTime').value.trim();
  const roomRules = document.getElementById('roomRules').value.trim();
  const revealRaw = document.getElementById('roomRevealAt').value;
  let roomRevealAt = null;
  if (revealRaw) roomRevealAt = new Date(revealRaw).toISOString();

  try {
    await updateDoc(doc(db, 'tournaments', tid), {
      roomId, roomPassword, roomFormat, roomRounds,
      roomOpenTime, roomRules, roomRevealAt,
      roomUpdatedAt: serverTimestamp()
    });
    const status = document.getElementById('roomSaveStatus');
    status.style.display = 'block';
    status.textContent = '✅ Room details saved';
    setTimeout(() => status.style.display = 'none', 3000);
    window.showToast('✅ Room details saved');
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// USERS
// ============================================================
window.loadUsers = async function() {
  const list = document.getElementById('userList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  try {
    const snap = await getDocs(collection(db, 'users'));
    allUsers = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allUsers.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (document.getElementById('usersBadge')) document.getElementById('usersBadge').innerText = allUsers.length;
    if (document.getElementById('dashUsers')) document.getElementById('dashUsers').innerText = allUsers.length;
    renderUsers();
    renderDashboardRecent();
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

window.filterUsers = function() { renderUsers(); };

function renderUsers() {
  const list = document.getElementById('userList');
  if (!list) return;
  const q = (document.getElementById('userSearch').value || '').toLowerCase();
  let filtered = allUsers.filter(u => !q || `${u.username||''} ${u.email||''}`.toLowerCase().includes(q));
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">👥</span>No users.</div>';
    return;
  }
  list.innerHTML = filtered.map(u => `
    <div class="reg-card free-reg">
      <div class="reg-icon">${initials(u.username)}</div>
      <div class="reg-main">
        <div class="reg-line-1"><b>${u.username || 'Unknown'}</b></div>
        <div class="reg-line-2">📧 ${u.email || '—'}${u.phone ? ' · 📱 ' + u.phone : ''}</div>
      </div>
      <div class="reg-right"><span class="type-chip free">Member</span><small>${fmtDate(u.createdAt)}</small></div>
    </div>
  `).join('');
}

// ============================================================
// TOURNAMENTS ADMIN
// ============================================================
window.loadTournamentsAdmin = async function() {
  const list = document.getElementById('tournamentList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    allTournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!allTournaments.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">🏆</span>No tournaments.</div>';
      return;
    }
    list.innerHTML = allTournaments.map(t => {
      const entryTypeRaw = (t.entryType || t.entry_type || 'free').toLowerCase();
      const feeValue = Number(t.entryFee || t.entry_fee || 0);
      const isPaid = entryTypeRaw === 'paid' || feeValue > 0;
      const hasRoom = t.roomId && t.roomPassword;
      const isCompleted = (t.status || '').toLowerCase() === 'completed';
      const safeTitle = (t.title || 'Untitled').replace(/'/g, "\\'");
      return `
        <div class="reg-card ${isCompleted ? 'free-reg' : (isPaid ? 'paid-reg' : 'free-reg')}">
          <div class="reg-icon">${isCompleted ? '✅' : (isPaid ? '💵' : '🏆')}</div>
          <div class="reg-main">
            <div class="reg-line-1"><b>${t.title || 'Untitled'}</b><span class="reg-sep">—</span><span class="reg-tournament">${t.game || 'Game'} · ${t.mode || 'Solo'}</span></div>
            <div class="reg-line-2">${t.date ? '📅 ' + t.date : ''}${t.time ? ' · 🕐 ' + t.time : ''}${isPaid ? ' · 💰 Rs. ' + (t.entryFee || t.entry_fee || 0) : ' · FREE'}${t.prizePool || t.prize_pool ? ' · 🏆 Rs. ' + (t.prizePool || t.prize_pool) : ''}</div>
            <div class="reg-actions">
              ${!isCompleted ? `<button class="btn-edit small" onclick="editTournament('${t.id}')">✏️ Edit</button>` : ''}
              <button class="btn-delete small" onclick="deleteTournament('${t.id}','${safeTitle}')">🗑️ Delete</button>
            </div>
          </div>
          <div class="reg-right">
            <span class="type-chip ${isCompleted ? 'free' : (isPaid ? 'paid' : 'free')}">${isCompleted ? 'Completed' : (isPaid ? 'Paid' : 'Free')}</span>
            ${hasRoom ? '<small style="color:#4ade80;">🔑 Room set</small>' : '<small style="color:#6b7280;">No room</small>'}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

// ============================================================
// ANNOUNCEMENTS
// ============================================================
window.loadAnnouncements = async function() {
  const list = document.getElementById('announcementList');
  if (!list) return;
  try {
    const snap = await getDocs(collection(db, 'announcements'));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">📢</span>No announcements yet</div>';
      return;
    }
    list.innerHTML = items.map(a => `
      <div class="reg-card free-reg">
        <div class="reg-icon">📢</div>
        <div class="reg-main"><div class="reg-line-1"><b>${a.title || 'Untitled'}</b></div><div class="reg-line-2">${a.message || ''}</div></div>
        <div class="reg-right"><small>${fmtDate(a.createdAt)}</small></div>
      </div>
    `).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

window.postAnnouncement = async function(e) {
  e.preventDefault();
  const title = document.getElementById('annTitle').value.trim();
  const message = document.getElementById('annMsg').value.trim();
  if (!title || !message) { window.showToast('❌ Title and message required'); return; }
  try {
    await addDoc(collection(db, 'announcements'), { title, message, createdAt: serverTimestamp() });
    document.getElementById('annTitle').value = '';
    document.getElementById('annMsg').value = '';
    window.showToast('✅ Announcement posted');
    window.loadAnnouncements();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// DASHBOARD RECENT
// ============================================================
function renderDashboardRecent() {
  const t = todayKey();
  const todayPayments = allPayments.filter(p => p.status === 'approved' && dayKey(p.reviewedAt || p.submittedAt) === t);
  const todayCollected = todayPayments.reduce((s,p) => s + (Number(p.amount)||0), 0);
  const todayPayouts = allPayouts.filter(x => dayKey(x.paidAt || x.createdAt) === t).reduce((s,p) => s + (Number(p.amount)||0), 0);
  const allCollected = allPayments.filter(p => p.status === 'approved').reduce((s,p) => s + (Number(p.amount)||0), 0);
  const allPayoutsTotal = allPayouts.reduce((s,p) => s + (Number(p.amount)||0), 0);

  const el = id => document.getElementById(id);
  if (el('dashTodayCollected')) el('dashTodayCollected').innerText = fmtRs(todayCollected);
  if (el('dashTodayPayouts')) el('dashTodayPayouts').innerText = fmtRs(todayPayouts);
  if (el('dashTodayNet')) el('dashTodayNet').innerText = fmtRs(todayCollected - todayPayouts);
  if (el('dashAllNet')) el('dashAllNet').innerText = fmtRs(allCollected - allPayoutsTotal);

  const ru = document.getElementById('dashRecentUsers');
  if (ru && allUsers.length) {
    ru.innerHTML = allUsers.slice(0,5).map(u => `
      <div class="reg-card free-reg">
        <div class="reg-icon">${initials(u.username)}</div>
        <div class="reg-main"><div class="reg-line-1"><b>${u.username || 'Unknown'}</b></div><div class="reg-line-2">${u.email || '—'}</div></div>
        <div class="reg-right"><small>${fmtShort(u.createdAt)}</small></div>
      </div>
    `).join('');
  }

  const rr = document.getElementById('dashRecentRegs');
  if (rr && allRegs.length) {
    rr.innerHTML = allRegs.slice(0,5).map(r => {
      const isPaid = r.entryType === 'paid';
      return `
        <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'}">
          <div class="reg-icon">${isPaid ? '💵' : '🏆'}</div>
          <div class="reg-main"><div class="reg-line-1"><b>${r.username || 'Unknown'}</b><span class="reg-sep">—</span><span class="reg-tournament">${r.tournamentTitle || 'Tournament'}</span></div><div class="reg-line-2">${isPaid ? 'Rs. ' + (r.amount||0) : 'Free Entry'}</div></div>
          <div class="reg-right"><span class="type-chip ${isPaid ? 'paid' : 'free'}">${isPaid ? 'Paid' : 'Free'}</span><small>${fmtShort(r.registeredAt)}</small></div>
        </div>
      `;
    }).join('');
  }
}

// ============================================================
// REVIEW MODAL
// ============================================================
window.openReview = function(id, name, action, type) {
  document.getElementById('reviewId').value = id;
  document.getElementById('reviewAction').value = action;
  document.getElementById('reviewType').value = type || 'payment';
  document.getElementById('reviewTitle').innerText = action === 'approve' ? '✔ Approve' : '❌ Reject';
  document.getElementById('reviewDesc').innerHTML = (action === 'approve' ? 'Approve ' : 'Reject ') + '<b>' + name + '</b>?';
  const btn = document.getElementById('reviewConfirmBtn');
  btn.className = action === 'approve' ? 'btn-primary green' : 'btn-primary red';
  btn.innerText = action === 'approve' ? '✔ Confirm Approve' : '✘ Confirm Reject';
  document.getElementById('reviewModal').classList.add('active');
};

window.closeReview = function() {
  document.getElementById('reviewModal').classList.remove('active');
  document.getElementById('reviewNote').value = '';
};

window.confirmReview = async function(e) {
  e.preventDefault();
  const id = document.getElementById('reviewId').value;
  const action = document.getElementById('reviewAction').value;
  const type = document.getElementById('reviewType').value;
  const note = document.getElementById('reviewNote').value.trim();
  const status = action === 'approve' ? 'approved' : 'rejected';
  const regStatus = action === 'approve' ? 'confirmed' : 'rejected';

  try {
    if (type === 'payment') {
      await updateDoc(doc(db, 'tournament_payments', id), {
        status, adminNote: note, reviewedAt: serverTimestamp()
      });
      const regSnap = await getDocs(query(
        collection(db, 'tournament_registrations'),
        where('paymentId', '==', id)
      ));
      for (const d of regSnap.docs) {
        await updateDoc(doc(db, 'tournament_registrations', d.id), { status: regStatus });
      }
    } else {
      await updateDoc(doc(db, 'tournament_registrations', id), { status: regStatus });
    }
    closeReview();
    window.showToast('✅ ' + (action === 'approve' ? 'Approved' : 'Rejected'));
    window.loadPayments();
    window.loadRegistrations();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// LIGHTBOX + TOAST
// ============================================================
window.openShot = function(src) {
  document.getElementById('shotFull').src = src;
  document.getElementById('shotModal').classList.add('active');
};

window.showToast = function(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerText = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
};

// ============================================================
// INIT
// ============================================================
(async function init() {
  await window.loadPayments();
  await window.loadRegistrations();
  await window.loadUsers();
  try {
    const snap = await getDocs(collection(db, 'tournament_payouts'));
    allPayouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('payouts load failed:', e); }
  renderDashboardRecent();
  attachRealtimeListeners();
  console.log("✅ Admin loaded from admin.js v3.6");
})();
