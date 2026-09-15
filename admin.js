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
  const p2 = Math.round(pool * 
