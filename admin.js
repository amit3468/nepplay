// ==========================================================
// NEPPLAY — admin.js (v5.1 - FULL)
// v5.1 changes:
//  + Restored all missing core functions (Users, Dashboard, Payouts, etc.)
//  + Fixed "renderDashboardRecent is not defined" error
//  + Added Quick Payout tool
//  + Added FFWS Predictions Viewer
//  + Fixed cut-off submitMatchResults() function
// ==========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, updateDoc, deleteDoc, getDoc,
  addDoc, query, where, serverTimestamp, onSnapshot, orderBy, limit,
  arrayUnion, Timestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  initActivity, logActivity, loadActivityFeed, loadActivityPage
} from "./activity.js";

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
const auth = getAuth(app);

initActivity(db, auth);

window.loadActivityFeed = loadActivityFeed;
window.loadActivityPage = loadActivityPage;

console.log("🔥 Admin v5.1 — awaiting auth");

// ============================================================
// GLOBAL HELPERS & TOASTS
// ============================================================
window.showToast = function(msg, isError = false) {
  let toast = document.getElementById('adminToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'adminToast';
    toast.style.cssText = 'position:fixed; bottom:20px; left:50%; transform:translateX(-50%); padding:12px 24px; border-radius:8px; font-weight:700; z-index:99999; transition:opacity 0.3s; box-shadow:0 10px 30px rgba(0,0,0,0.5);';
    document.body.appendChild(toast);
  }
  toast.style.background = isError ? '#dc2626' : '#22c55e';
  toast.style.color = '#fff';
  toast.textContent = msg;
  toast.style.opacity = '1';
  setTimeout(() => { toast.style.opacity = '0'; }, 3000);
};

function downloadCSV(filename, rows) {
  const csvContent = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

window.openShot = function(src) {
  const modal = document.getElementById('shotModal');
  const img = document.getElementById('shotFull');
  if (modal && img) {
    img.src = src;
    modal.style.display = 'flex';
  }
};
window.openShotById = function(id) {
  if (screenshotCache[id]) window.openShot(screenshotCache[id]);
};

// ============================================================
// ADMIN EMAIL
// ============================================================
const ADMIN_EMAIL = 'amitacharya018@gmail.com';

// ============================================================
// AUTH GATE
// ============================================================
let currentAdminEmail = '';
let bootstrapped = false;

function showGatePanel(panelId) {
  document.getElementById('auth-gate').style.display = 'flex';
  document.getElementById('admin-panel').style.display = 'none';
  document.getElementById('adminLoginForm').style.display = 'none';
  document.getElementById('adminLoadingMsg').style.display = 'none';
  document.getElementById('adminDeniedMsg').style.display = 'none';
  const el = document.getElementById(panelId);
  if (el) el.style.display = 'block';
}

async function verifyAdminAndBoot(user) {
  try {
    const userDoc = await getDoc(doc(db, 'users', user.uid));
    if (!userDoc.exists()) return false;
    const data = userDoc.data();
    if (data.role !== 'admin') return false;
    currentAdminEmail = user.email || data.email || '—';
    return true;
  } catch (err) {
    console.error('Admin verify failed:', err);
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  console.log('👤 Auth state:', user ? user.email : 'signed out');
  if (!user) { showGatePanel('adminLoginForm'); return; }
  showGatePanel('adminLoadingMsg');
  const ok = await verifyAdminAndBoot(user);
  if (!ok) { showGatePanel('adminDeniedMsg'); return; }
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  document.getElementById('adminEmailDisplay').textContent = 'Admin';
  console.log('✅ Admin access granted:', currentAdminEmail);
  logActivity({
    action: 'admin_login', category: 'system',
    summary: `Admin logged in (${currentAdminEmail})`,
    metadata: { email: currentAdminEmail }
  });
  if (!bootstrapped) {
    bootstrapped = true;
    await bootstrapAdminPanel();
  }
});

window.handleAdminLogin = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('adminLoginBtn');
  const msg = document.getElementById('adminLoginMsg');
  const password = document.getElementById('adminPassword').value;
  if (!password) { msg.style.display='block'; msg.style.color='#f87171'; msg.textContent='❌ Password required'; return; }
  btn.disabled = true;
  btn.textContent = 'Logging in...';
  msg.style.display = 'none';
  try {
    await signInWithEmailAndPassword(auth, ADMIN_EMAIL, password);
  } catch (err) {
    let m = 'Login failed';
    if (['auth/invalid-credential','auth/wrong-password','auth/user-not-found'].includes(err.code)) m = 'Invalid password';
    else if (err.code === 'auth/too-many-requests') m = 'Too many attempts. Try later.';
    msg.style.display = 'block';
    msg.style.color = '#f87171';
    msg.textContent = '❌ ' + m;
    btn.disabled = false;
    btn.textContent = 'Login';
  }
};

window.adminSignOut = async function() { await signOut(auth); };
window.adminLogout = async function() {
  if (!confirm('Logout?')) return;
  try { await signOut(auth); window.location.reload(); }
  catch (err) { window.location.reload(); }
};

// ============================================================
// STATE
// ============================================================
let allPayments = [];
let allRegs = [];
let allUsers = [];
let allTournaments = [];
let allPayouts = [];
let allResults = [];
let allReferralBonuses = [];
let allSentNotifications = [];
let currentStatusFilter = 'pending';
let currentMethodFilter = 'all';
let currentSearchTerm = '';
let currentRefFilter = 'all';
let currentRefSearch = '';
let roomTournaments = [];
let selectedResultTournament = null;
let selectedPaymentIds = new Set();

const screenshotCache = {};

function fmtDate(ts) {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}
function timeAgo(ts) {
  if (!ts?.toDate) return '—';
  const diff = Date.now() - ts.toDate().getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return 'Just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return mins + 'm ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + 'h ago';
  const days = Math.floor(hrs / 24);
  if (days < 7) return days + 'd ago';
  if (days < 30) return Math.floor(days / 7) + 'w ago';
  return Math.floor(days / 30) + 'mo ago';
}
function isNewUser(ts) {
  if (!ts?.toDate) return false;
  return (Date.now() - ts.toDate().getTime()) < 24 * 60 * 60 * 1000;
}
function fmtShort(ts) {
  if (!ts?.toDate) return '—';
  return ts.toDate().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
function dayKey(ts) { if (!ts?.toDate) return null; return ts.toDate().toISOString().slice(0,10); }
function todayKey() { return new Date().toISOString().slice(0,10); }
function initials(n) { return (n || 'U')[0].toUpperCase(); }
function fmtRs(n) { return 'Rs. ' + (Number(n) || 0).toLocaleString(); }
function escapeDetail(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function modeBadgeHtml(playingAs) {
  const m = String(playingAs || '').toLowerCase();
  if (m === 'solo') return '<span class="mode-badge mode-badge-1v1">👤 Solo</span>';
  if (m === '1v1') return '<span class="mode-badge mode-badge-1v1">👤 1 vs 1</span>';
  if (m === 'duo') return '<span class="mode-badge mode-badge-2v2">👥 Duo</span>';
  if (m === '2v2') return '<span class="mode-badge mode-badge-2v2">👥 2 vs 2</span>';
  if (m === 'squad') return '<span class="mode-badge mode-badge-squad">🏆 Squad</span>';
  return '';
}

function screenshotSrc(d) {
  if (!d) return null;
  if (d.screenshotBase64) return 'data:image/jpeg;base64,' + d.screenshotBase64;
  if (d.screenshotUrl) return d.screenshotUrl;
  if (d.paymentScreenshotUrl) return d.paymentScreenshotUrl;
  return null;
}
function registerScreenshot(d) {
  const src = screenshotSrc(d);
  if (!src) return null;
  screenshotCache[d.id] = src;
  return d.id;
}

// ============================================================
// Find UID by username
// ============================================================
async function findUidByUsername(username) {
  if (!username) return null;
  const uname = String(username).trim();
  if (!uname) return null;

  let snap = await getDocs(query(collection(db, 'users'), where('username', '==', uname), limit(1)));
  if (!snap.empty) return { uid: snap.docs[0].id, data: snap.docs[0].data() };

  snap = await getDocs(query(collection(db, 'users'), where('fullName', '==', uname), limit(1)));
  if (!snap.empty) return { uid: snap.docs[0].id, data: snap.docs[0].data() };

  const lower = uname.toLowerCase();
  const found = allUsers.find(u =>
    (u.username || '').toLowerCase() === lower ||
    (u.fullName || '').toLowerCase() === lower
  );
  if (found) return { uid: found.id, data: found };

  return null;
}

// ============================================================
// BOOTSTRAP
// ============================================================
async function bootstrapAdminPanel() {
  try {
    await window.loadPayments();
    await window.loadRegistrations();
    await window.loadUsers();
    await window.loadTournamentsAdmin();
    
    const snap = await getDocs(collection(db, 'tournament_payouts'));
    allPayouts = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (e) { console.warn('payouts load failed:', e); }
  
  await loadReferralBonuses();
  renderDashboardRecent();
  loadActivityFeed();
  loadLiveStats();
  attachRealtimeListeners();
  console.log("✅ Admin panel booted for:", currentAdminEmail);
}

// ============================================================
// DASHBOARD RECENTS
// ============================================================
window.renderDashboardRecent = function() {
  // Recent Users
  const ru = document.getElementById('dashRecentUsers');
  if (ru) {
    if (!allUsers.length) { ru.innerHTML = '<div class="empty-state">No users yet</div>'; }
    else {
      const sortedUsers = [...allUsers].sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)).slice(0, 5);
      ru.innerHTML = sortedUsers.map(u => `
        <div class="reg-card clickable-row" onclick="openUserDetail('${u.id}')" style="padding:12px; margin-bottom:8px;">
          <div class="reg-icon" style="width:32px;height:32px;font-size:12px;">${initials(u.username)}</div>
          <div class="reg-main">
            <div class="reg-line-1"><b>${escapeDetail(u.username || 'User')}</b> ${isNewUser(u.createdAt) ? '<span class="tourney-count" style="background:#22c55e;color:#fff;border:none;">NEW</span>' : ''}</div>
            <div class="reg-line-2" style="font-size:11px;">${escapeDetail(u.email || '—')}</div>
          </div>
          <div class="reg-right"><small>${timeAgo(u.createdAt)}</small></div>
        </div>
      `).join('');
    }
  }

  // Recent Regs
  const rr = document.getElementById('dashRecentRegs');
  if (rr) {
    if (!allRegs.length) { rr.innerHTML = '<div class="empty-state">No registrations yet</div>'; }
    else {
      const sortedRegs = [...allRegs].sort((a, b) => (b.registeredAt?.toMillis?.() || 0) - (a.registeredAt?.toMillis?.() || 0)).slice(0, 5);
      rr.innerHTML = sortedRegs.map(r => `
        <div class="reg-card ${r.entryType === 'paid' ? 'paid-reg' : 'free-reg'} clickable-row" onclick="openRegDetail('${r.id}')" style="padding:12px; margin-bottom:8px;">
          <div class="reg-icon" style="width:32px;height:32px;font-size:12px;">${r.entryType === 'paid' ? '💵' : '🏆'}</div>
          <div class="reg-main">
            <div class="reg-line-1"><b>${escapeDetail(r.username || 'User')}</b> — ${escapeDetail(r.tournamentTitle || 'Tournament')}</div>
            <div class="reg-line-2" style="font-size:11px;">${r.entryType === 'paid' ? 'Rs. '+r.amount : 'Free'} · ${(r.status||'').toUpperCase()}</div>
          </div>
          <div class="reg-right"><small>${timeAgo(r.registeredAt)}</small></div>
        </div>
      `).join('');
    }
  }
};

// ============================================================
// USERS MANAGEMENT
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
    loadLiveStats();
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};
window.filterUsers = function() { renderUsers(); };

function renderUsers() {
  const list = document.getElementById('userList');
  if (!list) return;
  const q = (document.getElementById('userSearch')?.value || '').toLowerCase();
  const filtered = allUsers.filter(u => !q || `${u.username||''} ${u.email||''} ${u.phone||''}`.toLowerCase().includes(q));
  
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">👥</span>No users found.</div>';
    return;
  }
  list.innerHTML = filtered.map(u => `
    <div class="reg-card clickable-row" onclick="openUserDetail('${u.id}')" style="padding:16px; margin-bottom:10px;">
      <div class="reg-icon" style="width:40px;height:40px;font-size:16px;">${initials(u.username)}</div>
      <div class="reg-main">
        <div class="reg-line-1">
          <b>${escapeDetail(u.username || 'User')}</b>
          ${u.role === 'admin' ? '<span class="type-chip" style="background:#6366f1;color:#fff;">ADMIN</span>' : ''}
          ${isNewUser(u.createdAt) ? '<span class="tourney-count" style="background:#22c55e;color:#fff;border:none;">NEW</span>' : ''}
        </div>
        <div class="reg-line-2">${escapeDetail(u.email || '—')} · ${escapeDetail(u.phone || '—')}</div>
      </div>
      <div class="reg-right">
        <small>Joined ${fmtShort(u.createdAt)}</small>
      </div>
    </div>
  `).join('');
}

window.deleteUser = async function(id, name) {
  if (!confirm(`Delete user "${name}"? This cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, 'users', id));
    window.showToast('🗑️ User deleted');
    closeDetailModal();
    await window.loadUsers();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};

window.exportUsersCSV = function() {
  if (!allUsers.length) { window.showToast('❌ No users to export', true); return; }
  const rows = [['Username','Email','Phone','Role','Joined Date']];
  allUsers.forEach(u => {
    rows.push([
      u.username || '', u.email || '', u.phone || '', u.role || 'member',
      u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : ''
    ]);
  });
  downloadCSV(`nepplay-users-${todayKey()}.csv`, rows);
};

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
    allTournaments.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
    
    if (!allTournaments.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">🏆</span>No tournaments found.</div>';
      return;
    }
    
    list.innerHTML = allTournaments.map(t => {
      const isPaid = (t.entryType || t.entry_type || 'free').toLowerCase() === 'paid';
      const isCompleted = (t.status || '').toLowerCase() === 'completed';
      const regCount = allRegs.filter(r => r.tournamentId === t.id).length;
      
      return `
        <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'}" style="padding:16px; margin-bottom:10px;">
          <div class="reg-icon">${isCompleted ? '✅' : (isPaid ? '💵' : '🏆')}</div>
          <div class="reg-main">
            <div class="reg-line-1">
              <b>${escapeDetail(t.title || 'Untitled')}</b>
              <span class="reg-sep">—</span>
              <span class="reg-tournament">${escapeDetail(t.game || '')} · ${escapeDetail(t.mode || '')}</span>
            </div>
            <div class="reg-line-2">
              📅 ${t.date || '—'} · 🕐 ${t.time || '—'} · ${isPaid ? 'Rs. '+t.entryFee : 'FREE'}
              ${t.prizePool ? ' · 🏆 Rs. '+t.prizePool : ''}
            </div>
          </div>
          <div class="reg-right">
            <span class="tourney-count">👥 ${regCount} players</span>
            <span class="type-chip ${isCompleted ? 'free' : (isPaid ? 'paid' : 'free')}">${isCompleted ? 'Completed' : (isPaid ? 'Paid' : 'Free')}</span>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
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
    allPayouts.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    
    let total = 0, pending = 0, winners = 0;
    allPayouts.forEach(p => {
      total += Number(p.amount || 0);
      if (p.status === 'paid') winners++;
      else pending += Number(p.amount || 0);
    });
    
    if (document.getElementById('payoutTotal')) document.getElementById('payoutTotal').innerText = fmtRs(total);
    if (document.getElementById('payoutWinners')) document.getElementById('payoutWinners').innerText = winners;
    if (document.getElementById('payoutPending')) document.getElementById('payoutPending').innerText = fmtRs(pending);
    
    if (!allPayouts.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">🏆</span>No payouts yet.</div>';
      return;
    }
    
    list.innerHTML = allPayouts.map(w => {
      const isPaid = w.status === 'paid';
      return `
        <div class="reg-card clickable-row" onclick="openPayoutDetail('${w.id}')" style="padding:16px; margin-bottom:10px;">
          <div class="reg-icon" style="background:${isPaid ? '#22c55e' : '#f59e0b'}; color:#fff;">🏆</div>
          <div class="reg-main">
            <div class="reg-line-1">
              <b>${escapeDetail(w.winnerName || '—')}</b>
              <span class="reg-sep">—</span>
              <span class="reg-tournament">${escapeDetail(w.tournamentTitle || 'Tournament')}</span>
            </div>
            <div class="reg-line-2">
              Rank: <b>${escapeDetail(w.rank || '—')}</b> · Kills: ${w.kills || 0} · Amount: <b style="color:#fbbf24;">${fmtRs(w.amount)}</b>
            </div>
          </div>
          <div class="reg-right">
            <span class="status-pill ${isPaid ? 'approved' : 'pending'}">${isPaid ? 'PAID' : 'PENDING'}</span>
            <small>${fmtShort(w.createdAt)}</small>
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

window.addPayout = async function() {
  const name = prompt('Winner Username:');
  if (!name) return;
  const amount = Number(prompt('Amount (Rs.):', '0'));
  if (!amount) return;
  const title = prompt('Tournament Title:');
  if (!title) return;
  
  try {
    await addDoc(collection(db, 'tournament_payouts'), {
      winnerName: name.trim(),
      amount: amount,
      prize: amount,
      tournamentTitle: title.trim(),
      tournamentId: 'manual',
      rank: prompt('Rank:', '1') || '1',
      status: 'paid',
      paidAt: serverTimestamp(),
      createdAt: serverTimestamp()
    });
    window.showToast('✅ Manual payout recorded');
    await window.loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};

// ============================================================
// DAILY COLLECTIONS & EARNINGS
// ============================================================
window.loadDailyCollections = async function() {
  const list = document.getElementById('dailyList');
  const byMethod = document.getElementById('dailyByMethod');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  
  try {
    const range = document.getElementById('dailyRangeFilter')?.value || 'all';
    const now = Date.now();
    
    let filteredPays = allPayments.filter(p => p.status === 'approved');
    let filteredPayouts = allPayouts;
    
    if (range === 'today') {
      const t = todayKey();
      filteredPays = filteredPays.filter(p => dayKey(p.reviewedAt || p.submittedAt) === t);
      filteredPayouts = filteredPayouts.filter(x => dayKey(x.paidAt || x.createdAt) === t);
    } else if (range !== 'all') {
      const days = Number(range);
      const cutoff = now - (days * 24 * 60 * 60 * 1000);
      filteredPays = filteredPays.filter(p => (p.reviewedAt?.toMillis?.() || 0) >= cutoff);
      filteredPayouts = filteredPayouts.filter(x => (x.paidAt?.toMillis?.() || x.createdAt?.toMillis?.() || 0) >= cutoff);
    }
    
    let totalCollected = 0, totalPayouts = 0;
    const dailyData = {};
    const methodData = {};
    
    filteredPays.forEach(p => {
      totalCollected += Number(p.amount || 0);
      const dk = dayKey(p.reviewedAt || p.submittedAt);
      if (dk) dailyData[dk] = (dailyData[dk] || 0) + Number(p.amount || 0);
      const m = p.method || 'other';
      methodData[m] = (methodData[m] || 0) + Number(p.amount || 0);
    });
    
    filteredPayouts.forEach(p => {
      totalPayouts += Number(p.amount || 0);
      const dk = dayKey(p.paidAt || p.createdAt);
      if (dk) dailyData[dk] = (dailyData[dk] || 0) - Number(p.amount || 0);
    });
    
    if (document.getElementById('dailyTotalCollected')) document.getElementById('dailyTotalCollected').innerText = fmtRs(totalCollected);
    if (document.getElementById('dailyTotalPayouts')) document.getElementById('dailyTotalPayouts').innerText = fmtRs(totalPayouts);
    if (document.getElementById('dailyTotalNet')) document.getElementById('dailyTotalNet').innerText = fmtRs(totalCollected - totalPayouts);
    if (document.getElementById('dailyActiveDays')) document.getElementById('dailyActiveDays').innerText = Object.keys(dailyData).length;
    
    const sortedDays = Object.keys(dailyData).sort((a,b) => b.localeCompare(a));
    if (!sortedDays.length) {
      list.innerHTML = '<div class="empty-state">No activity for this period.</div>';
    } else {
      list.innerHTML = sortedDays.map(d => `
        <div class="reg-card" style="padding:12px; margin-bottom:8px;">
          <div class="reg-icon">📅</div>
          <div class="reg-main"><div class="reg-line-1"><b>${d}</b></div></div>
          <div class="reg-right"><b style="color:${dailyData[d] >= 0 ? '#4ade80' : '#f87171'};">${fmtRs(dailyData[d])}</b></div>
        </div>
      `).join('');
    }
    
    if (byMethod) {
      const chips = { esewa:'💚 eSewa', khalti:'💜 Khalti', imepay:'🟠 IME Pay', bank:'🏦 Bank' };
      byMethod.innerHTML = Object.keys(methodData).map(m => `
        <div class="reg-card" style="padding:12px; margin-bottom:8px;">
          <div class="reg-icon">💳</div>
          <div class="reg-main"><div class="reg-line-1"><b>${chips[m] || m}</b></div></div>
          <div class="reg-right"><b style="color:#fbbf24;">${fmtRs(methodData[m])}</b></div>
        </div>
      `).join('');
    }
  } catch (err) {
    if (list) list.innerHTML = '<div class="empty-state">Error loading stats.</div>';
  }
};

window.loadEarnings = async function() {
  try {
    const approved = allPayments.filter(p => p.status === 'approved');
    const total = approved.reduce((s,p) => s + (Number(p.amount)||0), 0);
    const pending = allPayments.filter(p => p.status === 'pending').reduce((s,p) => s + (Number(p.amount)||0), 0);
    
    if (document.getElementById('earnTotal')) document.getElementById('earnTotal').innerText = fmtRs(total);
    if (document.getElementById('earnApproved')) document.getElementById('earnApproved').innerText = approved.length;
    if (document.getElementById('earnPending')) document.getElementById('earnPending').innerText = fmtRs(pending);
    if (document.getElementById('earnAvg')) document.getElementById('earnAvg').innerText = fmtRs(approved.length ? total / approved.length : 0);
    
    const methodData = {};
    approved.forEach(p => {
      const m = p.method || 'other';
      methodData[m] = (methodData[m] || 0) + Number(p.amount || 0);
    });
    
    const el = document.getElementById('earningsBreakdown');
    if (el) {
      const chips = { esewa:'💚 eSewa', khalti:'💜 Khalti', imepay:'🟠 IME Pay', bank:'🏦 Bank' };
      el.innerHTML = Object.keys(methodData).map(m => `
        <div class="reg-card" style="padding:12px; margin-bottom:8px;">
          <div class="reg-icon">💳</div>
          <div class="reg-main"><div class="reg-line-1"><b>${chips[m] || m}</b></div></div>
          <div class="reg-right"><b style="color:#fbbf24;">${fmtRs(methodData[m])}</b></div>
        </div>
      `).join('');
    }
  } catch (e) {}
};

// ============================================================
// PROFIT SHARE & ROOM DETAILS & ANNOUNCEMENTS & SUPPORT
// ============================================================
window.loadProfitShare = function() {
  const r = document.getElementById('shareResult');
  if (r) r.innerHTML = '';
};
window.calculateShares = function() {
  const a1 = document.getElementById('admin1Name').value || 'Admin 1';
  const s1 = Number(document.getElementById('admin1Share').value) || 0;
  const a2 = document.getElementById('admin2Name').value || 'Admin 2';
  const s2 = Number(document.getElementById('admin2Share').value) || 0;
  
  const totalNet = allPayments.filter(p => p.status === 'approved').reduce((s,p) => s + Number(p.amount||0), 0) 
                 - allPayouts.reduce((s,p) => s + Number(p.amount||0), 0);
                 
  const r = document.getElementById('shareResult');
  if (r) {
    r.innerHTML = `
      <div class="result-total-card" style="margin-top:20px;">
        <div><span>Total Net Profit</span><b>${fmtRs(totalNet)}</b></div>
        <div><span>${escapeDetail(a1)} (${s1}%)</span><b style="color:#4ade80;">${fmtRs(totalNet * (s1/100))}</b></div>
        <div><span>${escapeDetail(a2)} (${s2}%)</span><b style="color:#60a5fa;">${fmtRs(totalNet * (s2/100))}</b></div>
      </div>
    `;
  }
};

window.loadRoomDetailsForm = async function() {
  const select = document.getElementById('roomTournamentSelect');
  if (!select) return;
  select.innerHTML = '<option value="">— Select tournament —</option>' + 
    allTournaments.map(t => `<option value="${t.id}">${t.title}</option>`).join('');
};
window.saveRoomDetails = function() { window.showToast('✅ Room details saved (Simulation)'); };

window.loadAnnouncements = async function() {
  const list = document.getElementById('announcementList');
  if (!list) return;
  try {
    const snap = await getDocs(query(collection(db, 'announcements'), orderBy('createdAt', 'desc'), limit(10)));
    if (snap.empty) { list.innerHTML = '<div class="empty-state">No announcements yet</div>'; return; }
    list.innerHTML = snap.docs.map(d => {
      const a = d.data();
      return `
        <div class="reg-card" style="padding:16px; margin-bottom:10px;">
          <div class="reg-main">
            <div class="reg-line-1"><b>${escapeDetail(a.title)}</b></div>
            <div class="reg-line-2">${escapeDetail(a.message)}</div>
            <div class="reg-line-2" style="font-size:11px;color:#6b7280;">🕐 ${fmtShort(a.createdAt)}</div>
          </div>
          <div class="reg-right"><button class="btn-delete small" onclick="deleteDoc(doc(db,'announcements','${d.id}')).then(()=>loadAnnouncements())">🗑️</button></div>
        </div>
      `;
    }).join('');
  } catch(e) {}
};
window.postAnnouncement = async function(e) {
  e.preventDefault();
  const title = document.getElementById('annTitle').value;
  const message = document.getElementById('annMsg').value;
  if (!title || !message) return;
  await addDoc(collection(db, 'announcements'), { title, message, createdAt: serverTimestamp(), createdBy: currentAdminEmail });
  document.getElementById('annTitle').value = '';
  document.getElementById('annMsg').value = '';
  window.showToast('📢 Announcement posted');
  loadAnnouncements();
};

window.loadSupport = function() {
  const list = document.getElementById('supportList');
  if (list) list.innerHTML = '<div class="empty-state"><span class="icon">🎧</span>No support tickets yet</div>';
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
    loadLiveStats();
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
    const safeName = (p.username||'').replace(/'/g,'');
    const isPending = p.status === 'pending';
    const isApproved = p.status === 'approved';
    const isRejected = p.status === 'rejected';
    const shotId = registerScreenshot(p);
    const shotImgHtml = shotId
      ? `<img src="${screenshotCache[shotId]}" class="pay-shot" onclick="openShotById('${shotId}')" alt="Payment screenshot">`
      : '<div class="pay-shot-empty">No image</div>';
    const isSelected = selectedPaymentIds.has(p.id);
    const checkboxHtml = isPending
      ? `<div class="pay-checkbox-wrap"><input type="checkbox" class="pay-checkbox" ${isSelected ? 'checked' : ''} onclick="event.stopPropagation(); togglePayCheck('${p.id}', this.checked)"></div>`
      : '';
    return `
      <div class="pay-item" data-status="${p.status}" data-method="${p.method||''}">
        ${checkboxHtml}
        <div class="pay-item-left">${shotImgHtml}</div>
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
          ${isPending ? `
            <button class="btn-approve" onclick="openReview('${p.id}','${safeName}','approve','payment')">✔ Approve</button>
            <button class="btn-reject"  onclick="openReview('${p.id}','${safeName}','reject','payment')">✘ Reject</button>
          ` : ''}
          ${isApproved ? `<button class="btn-reject small" onclick="openReview('${p.id}','${safeName}','reset','payment')">↺ Reset</button>` : ''}
          ${isRejected ? `
            <button class="btn-approve small" onclick="openReview('${p.id}','${safeName}','approve','payment')">✔ Re-approve</button>
            <button class="btn-reject small" onclick="openReview('${p.id}','${safeName}','reset','payment')">↺ Reset</button>
          ` : ''}
          ${shotId ? `<button class="link-view" onclick="openShotById('${shotId}')">🔍 Full Screenshot</button>` : ''}
          ${p.adminNote ? '<small style="color:#9ca3af;margin-top:6px;">📝 ' + p.adminNote + '</small>' : ''}
        </div>
      </div>
    `;
  }).join('');
  updateBulkBar();
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

window.togglePayCheck = function(id, checked) {
  if (checked) selectedPaymentIds.add(id);
  else selectedPaymentIds.delete(id);
  updateBulkBar();
};
window.toggleSelectAllPayments = function(checked) {
  let filtered = allPayments.filter(p => {
    if (currentStatusFilter !== 'all' && p.status !== currentStatusFilter) return false;
    if (currentMethodFilter !== 'all' && p.method !== currentMethodFilter) return false;
    if (currentSearchTerm) {
      const q = currentSearchTerm.toLowerCase();
      if (!`${p.username||''} ${p.email||''} ${p.txnId||''} ${p.tournamentTitle||''} ${p.ign||''}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }).filter(p => p.status === 'pending');
  if (checked) filtered.forEach(p => selectedPaymentIds.add(p.id));
  else filtered.forEach(p => selectedPaymentIds.delete(p.id));
  renderPayments();
};
function updateBulkBar() {
  const bar = document.getElementById('bulkApproveBar');
  const cnt = document.getElementById('bulkCount');
  if (!bar) return;
  if (selectedPaymentIds.size > 0) {
    bar.classList.add('show');
    if (cnt) cnt.innerText = `${selectedPaymentIds.size} payment${selectedPaymentIds.size !== 1 ? 's' : ''} selected`;
  } else {
    bar.classList.remove('show');
  }
}
window.clearBulkSelection = function() {
  selectedPaymentIds.clear();
  const selAll = document.getElementById('paySelectAll');
  if (selAll) selAll.checked = false;
  renderPayments();
};
window.bulkApproveSelected = async function() {
  if (selectedPaymentIds.size === 0) return;
  const ids = Array.from(selectedPaymentIds);
  if (!confirm(`Approve ${ids.length} payment${ids.length !== 1 ? 's' : ''}?`)) return;
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      await updateDoc(doc(db, 'tournament_payments', id), {
        status: 'approved', adminNote: 'Bulk approved', reviewedAt: serverTimestamp()
      });
      const regSnap = await getDocs(query(collection(db, 'tournament_registrations'), where('paymentId', '==', id)));
      for (const d of regSnap.docs) {
        await updateDoc(doc(db, 'tournament_registrations', d.id), { status: 'confirmed' });
      }
      await handleReferralBonus(id);
      ok++;
    } catch (e) { fail++; }
  }
  selectedPaymentIds.clear();
  const selAll = document.getElementById('paySelectAll');
  if (selAll) selAll.checked = false;
  window.showToast(`✅ Approved ${ok}${fail ? ` · ❌ ${fail} failed` : ''}`);
  await window.loadPayments();
  await window.loadRegistrations();
  await loadReferralBonuses();
};

// ============================================================
// OPEN REVIEW MODAL
// ============================================================
window.openReview = function(id, name, action, type) {
  document.getElementById('reviewId').value = id;
  document.getElementById('reviewAction').value = action;
  document.getElementById('reviewType').value = type;
  document.getElementById('reviewTitle').innerText = action === 'approve' ? 'Approve' : action === 'reject' ? 'Reject' : 'Reset';
  document.getElementById('reviewDesc').innerText = `Are you sure you want to ${action} ${name}'s ${type}?`;
  document.getElementById('reviewModal').style.display = 'flex';
  document.getElementById('reviewModal').classList.add('open');
};
window.closeReview = function() {
  document.getElementById('reviewModal').style.display = 'none';
  document.getElementById('reviewModal').classList.remove('open');
};
window.confirmReview = async function(e) {
  e.preventDefault();
  const id = document.getElementById('reviewId').value;
  const action = document.getElementById('reviewAction').value;
  const type = document.getElementById('reviewType').value;
  const note = document.getElementById('reviewNote').value;
  
  closeReview();
  try {
    if (type === 'payment') {
      const statusMap = { approve: 'approved', reject: 'rejected', reset: 'pending' };
      await updateDoc(doc(db, 'tournament_payments', id), {
        status: statusMap[action],
        adminNote: note,
        reviewedAt: serverTimestamp()
      });
      
      const regSnap = await getDocs(query(collection(db, 'tournament_registrations'), where('paymentId', '==', id)));
      for (const d of regSnap.docs) {
        await updateDoc(doc(db, 'tournament_registrations', d.id), {
          status: action === 'approve' ? 'confirmed' : (action === 'reject' ? 'rejected' : 'pending')
        });
      }
      
      if (action === 'approve') await handleReferralBonus(id);
      
      window.showToast(`✅ Payment ${action}d`);
      await window.loadPayments();
      await window.loadRegistrations();
    } else {
      const statusMap = { approve: 'confirmed', reject: 'rejected', reset: 'pending' };
      await updateDoc(doc(db, 'tournament_registrations', id), {
        status: statusMap[action]
      });
      window.showToast(`✅ Registration ${action}d`);
      await window.loadRegistrations();
    }
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};

// ============================================================
// DETAIL MODAL — Users
// ============================================================
window.closeDetailModal = function() { document.getElementById('detailModal').classList.remove('open'); };

window.openUserDetail = function(uid) {
  if (!uid) return;
  const u = allUsers.find(x => x.id === uid);
  if (!u) { window.showToast('❌ User not found', true); return; }
  const myRegs = allRegs.filter(r => r.userId === uid);
  const myPays = allPayments.filter(p => p.userId === uid);
  const myPayouts = allPayouts.filter(p =>
    (p.userId && p.userId === uid) ||
    (p.winnerName && u.username && p.winnerName.toLowerCase() === u.username.toLowerCase())
  );
  const myReferrals = allReferralBonuses.filter(b => b.referrerUid === uid);

  const totalSpent = myPays.filter(p => p.status === 'approved').reduce((s,p) => s + (Number(p.amount)||0), 0);
  const totalWon = myPayouts.filter(p => p.status === 'paid').reduce((s,p) => s + (Number(p.amount)||0), 0);
  const totalReferralEarnings = myReferrals.reduce((s,b) => s + Number(b.amount || 0), 0);

  const regsHtml = myRegs.length
    ? myRegs.map(r => `
      <div class="dm-row">
        <span class="dm-k">${escapeDetail(r.tournamentTitle || 'Tournament')}</span>
        <span class="dm-v">${r.entryType === 'paid' ? 'Rs. ' + (r.amount||0) : 'FREE'} · ${(r.status||'').toUpperCase()} ${modeBadgeHtml(r.playingAs)}</span>
      </div>`).join('')
    : '<div class="dm-row"><span class="dm-k">No registrations yet</span><span class="dm-v">—</span></div>';

  document.getElementById('detailModalContent').innerHTML = `
    <h2>👤 ${escapeDetail(u.username || 'User')}${u.role === 'admin' ? ' <span style="background:#6366f1;color:#fff;padding:2px 10px;border-radius:8px;font-size:11px;">ADMIN</span>' : ''}</h2>
    <p class="dm-sub">Member profile & activity</p>
    <div class="dm-rows">
      <div class="dm-row"><span class="dm-k">📧 Email</span><span class="dm-v">${escapeDetail(u.email || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">📱 Phone</span><span class="dm-v">${escapeDetail(u.phone || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">🔑 User ID</span><span class="dm-v"><code>${escapeDetail(u.id)}</code></span></div>
      <div class="dm-row"><span class="dm-k">📅 Joined</span><span class="dm-v">${fmtDate(u.createdAt)}</span></div>
      <div class="dm-row"><span class="dm-k">🎭 Role</span><span class="dm-v">${u.role || 'member'}</span></div>
    </div>
    <div class="dm-section">
      <h3>📊 Activity Summary</h3>
      <div class="dm-rows">
        <div class="dm-row"><span class="dm-k">Registrations</span><span class="dm-v">${myRegs.length}</span></div>
        <div class="dm-row"><span class="dm-k">Payments submitted</span><span class="dm-v">${myPays.length}</span></div>
        <div class="dm-row"><span class="dm-k">💰 Total spent</span><span class="dm-v" style="color:#fbbf24;">${fmtRs(totalSpent)}</span></div>
        <div class="dm-row"><span class="dm-k">🏆 Total won</span><span class="dm-v" style="color:#4ade80;">${fmtRs(totalWon)}</span></div>
        <div class="dm-row"><span class="dm-k">🤝 Referral earnings</span><span class="dm-v" style="color:#c084fc;">${fmtRs(totalReferralEarnings)} (${myReferrals.length})</span></div>
      </div>
    </div>
    <div class="dm-section">
      <h3>📋 Registrations</h3>
      <div class="dm-rows">${regsHtml}</div>
    </div>
    <div class="dm-actions">
      <button class="dm-btn-ghost" onclick="closeDetailModal()">Close</button>
      <button class="dm-btn-primary" onclick="closeDetailModal(); showSection('notifications', document.querySelector('[data-section=notifications]')); setTimeout(()=>{ document.getElementById('notifTarget').value='${u.id}'; }, 200);">🔔 Send Notification</button>
      ${u.role === 'admin' ? '' : `<button class="dm-btn-danger" onclick="deleteUser('${u.id}','${(u.username||'').replace(/'/g,"\\'")}')">🗑️ Delete User</button>`}
    </div>
  `;
  document.getElementById('detailModal').classList.add('open');
};

// ============================================================
// DETAIL MODAL — Payouts
// ============================================================
window.openPayoutDetail = async function(payoutId) {
  const w = allPayouts.find(x => x.id === payoutId);
  if (!w) { window.showToast('❌ Payout not found', true); return; }

  let linkedUser = null;
  if (w.userId) linkedUser = allUsers.find(u => u.id === w.userId);
  if (!linkedUser && w.winnerName) {
    const lower = w.winnerName.toLowerCase();
    linkedUser = allUsers.find(u =>
      (u.username || '').toLowerCase() === lower ||
      (u.fullName || '').toLowerCase() === lower
    );
  }

  const isPaid = w.status === 'paid';
  const amount = Number(w.amount || w.prize || 0);

  document.getElementById('detailModalContent').innerHTML = `
    <h2>🏆 Payout Details</h2>
    <p class="dm-sub">${escapeDetail(w.tournamentTitle || 'Tournament')}</p>
    <div class="dm-rows">
      <div class="dm-row"><span class="dm-k">👤 Winner</span><span class="dm-v">${escapeDetail(w.winnerName || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">🥇 Rank</span><span class="dm-v">${escapeDetail(w.rank || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">🎯 Kills</span><span class="dm-v">${w.kills != null ? w.kills : '—'}</span></div>
      <div class="dm-row"><span class="dm-k">💰 Amount</span><span class="dm-v" style="color:#fbbf24;font-size:18px;">${fmtRs(amount)}</span></div>
      <div class="dm-row"><span class="dm-k">📋 Status</span><span class="dm-v" style="color:${isPaid ? '#4ade80' : '#fbbf24'};font-weight:800;">${isPaid ? '✅ PAID' : '⏳ PENDING'}</span></div>
      <div class="dm-row"><span class="dm-k">🕐 Created</span><span class="dm-v">${fmtDate(w.createdAt)}</span></div>
    </div>
    <div class="dm-section">
      <h3>👥 Linked Member Account</h3>
      ${linkedUser ? `
        <div class="dm-rows">
          <div class="dm-row"><span class="dm-k">Username</span><span class="dm-v"><a href="javascript:void(0)" onclick="closeDetailModal(); openUserDetail('${linkedUser.id}')" style="color:#a5b4fc;font-weight:700;">${escapeDetail(linkedUser.username || linkedUser.fullName || '—')} →</a></span></div>
          <div class="dm-row"><span class="dm-k">Email</span><span class="dm-v">${escapeDetail(linkedUser.email || '—')}</span></div>
        </div>
      ` : `<div class="dm-rows"><div class="dm-row"><span class="dm-k">Status</span><span class="dm-v" style="color:#f87171;">⚠️ No matching member found</span></div></div>`}
    </div>
    <div class="dm-section">
      <h3>⚙️ Quick Actions</h3>
      <div class="dm-actions" style="margin-top:0;">
        ${!isPaid ? `<button class="dm-btn-green" onclick="markPayoutPaid('${w.id}')">✅ Mark as Paid</button>` : `<button class="dm-btn-ghost" onclick="markPayoutPending('${w.id}')">↺ Mark as Pending</button>`}
        <button class="dm-btn-ghost" onclick="closeDetailModal()">Close</button>
      </div>
    </div>
    <div class="dm-actions">
      <button class="dm-btn-primary" onclick="editPayoutField('${w.id}')">✏️ Edit Amount / Rank</button>
      <button class="dm-btn-danger" onclick="deletePayout('${w.id}','${(w.winnerName||'').replace(/'/g,"\\'")}')">🗑️ Delete Payout</button>
    </div>
  `;
  document.getElementById('detailModal').classList.add('open');
};

window.markPayoutPaid = async function(payoutId) {
  if (!confirm('Mark this payout as PAID?')) return;
  try {
    await updateDoc(doc(db, 'tournament_payouts', payoutId), { status: 'paid', paidAt: serverTimestamp() });
    window.showToast('✅ Marked paid');
    closeDetailModal();
    await loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};

window.markPayoutPending = async function(payoutId) {
  if (!confirm('Mark this payout as PENDING again?')) return;
  try {
    await updateDoc(doc(db, 'tournament_payouts', payoutId), { status: 'pending', paidAt: null });
    window.showToast('↺ Marked pending');
    closeDetailModal();
    await loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};

window.editPayoutField = async function(payoutId) {
  const w = allPayouts.find(x => x.id === payoutId);
  if (!w) return;
  const newAmt = prompt('Amount (Rs.):', w.amount || w.prize || 0);
  if (newAmt === null) return;
  const newRank = prompt('Rank:', w.rank || '1');
  if (newRank === null) return;
  const newNote = prompt('Note:', w.note || '');
  if (newNote === null) return;
  try {
    await updateDoc(doc(db, 'tournament_payouts', payoutId), {
      amount: Number(newAmt) || 0,
      prize: Number(newAmt) || 0,
      rank: newRank,
      note: newNote
    });
    window.showToast('✅ Payout updated');
    closeDetailModal();
    await loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};

window.deletePayout = async function(payoutId, winnerName) {
  if (!confirm(`Delete payout for "${winnerName}"?`)) return;
  try {
    await deleteDoc(doc(db, 'tournament_payouts', payoutId));
    window.showToast('🗑️ Payout deleted');
    closeDetailModal();
    await loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};

// ============================================================
// DETAIL MODAL — Registrations
// ============================================================
window.openRegDetail = function(regId) {
  const r = allRegs.find(x => x.id === regId);
  if (!r) return;
  const isPaid = r.entryType === 'paid';
  const payment = isPaid ? allPayments.find(p => p.id === r.paymentId) : null;
  const shotSrc = payment ? (payment.screenshotBase64 ? 'data:image/jpeg;base64,' + payment.screenshotBase64 : payment.screenshotUrl || null) : null;

  document.getElementById('detailModalContent').innerHTML = `
    <h2>📋 ${escapeDetail(r.tournamentTitle || 'Registration')} ${modeBadgeHtml(r.playingAs)}</h2>
    <p class="dm-sub">Registered by ${escapeDetail(r.username || 'Unknown')} · ${fmtDate(r.registeredAt)}</p>
    <div class="dm-rows">
      <div class="dm-row"><span class="dm-k">👤 Username</span><span class="dm-v">${escapeDetail(r.username || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">📧 Email</span><span class="dm-v">${escapeDetail(r.email || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">🎮 IGN</span><span class="dm-v">${escapeDetail(r.ign || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">📱 Phone</span><span class="dm-v">${escapeDetail(r.phone || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">🎯 Mode</span><span class="dm-v">${modeBadgeHtml(r.playingAs) || '—'}</span></div>
      <div class="dm-row"><span class="dm-k">💰 Type</span><span class="dm-v">${isPaid ? 'PAID' : 'FREE'}</span></div>
      ${isPaid ? `<div class="dm-row"><span class="dm-k">💵 Amount</span><span class="dm-v" style="color:#fbbf24;">Rs. ${r.amount || 0}</span></div>` : ''}
      <div class="dm-row"><span class="dm-k">📋 Status</span><span class="dm-v" style="color:${r.status === 'confirmed' || r.status === 'approved' ? '#4ade80' : (r.status === 'pending' ? '#fbbf24' : '#f87171')};">${(r.status || '').toUpperCase()}</span></div>
    </div>
    ${isPaid && payment ? `
      <div class="dm-section">
        <h3>💳 Payment Details</h3>
        <div class="dm-rows">
          <div class="dm-row"><span class="dm-k">Payment status</span><span class="dm-v">${(payment.status || '').toUpperCase()}</span></div>
          <div class="dm-row"><span class="dm-k">Submitted</span><span class="dm-v">${fmtDate(payment.submittedAt)}</span></div>
        </div>
        ${shotSrc ? `<img class="dm-shot" src="${shotSrc}" onclick="openShot('${shotSrc}')">` : ''}
      </div>
    ` : ''}
    <div class="dm-actions">
      ${r.status === 'pending' ? `<button class="dm-btn-green" onclick="closeDetailModal(); openReview('${r.id}','${(r.username||'').replace(/'/g,"\\'")}','approve','registration');">✔ Approve</button>` : ''}
      ${r.status === 'pending' ? `<button class="dm-btn-primary" onclick="closeDetailModal(); openReview('${r.id}','${(r.username||'').replace(/'/g,"\\'")}','reject','registration');">✘ Reject</button>` : ''}
      <button class="dm-btn-ghost" onclick="closeDetailModal()">Close</button>
    </div>
  `;
  document.getElementById('detailModal').classList.add('open');
};

// ============================================================
// QUICK PAYOUT TOOL 
// ============================================================
let selectedPlayer = null;
let payoutInitialized = false;

window.initQuickPayout = function() {
  if (payoutInitialized) return; 
  payoutInitialized = true;

  const searchInput = document.getElementById('payoutSearchInput');
  const searchBtn   = document.getElementById('payoutSearchBtn');
  const resultBox   = document.getElementById('payoutResult');
  const nameEl      = document.getElementById('payoutName');
  const emailEl     = document.getElementById('payoutEmail');
  const balanceEl   = document.getElementById('payoutBalance');
  const amountInput = document.getElementById('payoutAmount');
  const creditBtn   = document.getElementById('payoutCreditBtn');
  const msgEl       = document.getElementById('payoutMsg');

  const USERNAME_FIELD = 'username'; 
  const EMAIL_FIELD    = 'email';
  const BALANCE_FIELD  = 'walletBalance';

  async function findPlayer(term) {
    const usersRef = collection(db, 'users');
    let snap = await getDocs(query(usersRef, where(EMAIL_FIELD, '==', term)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    
    snap = await getDocs(query(usersRef, where(USERNAME_FIELD, '==', term)));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    
    snap = await getDocs(query(usersRef, where('usernameLower', '==', term.toLowerCase())));
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
    
    return null;
  }

  async function handleSearch() {
    const term = searchInput.value.trim();
    if (!term) return;
    msgEl.textContent = '';
    resultBox.style.display = 'none';
    selectedPlayer = null;

    searchBtn.disabled = true;
    searchBtn.textContent = 'Searching...';
    try {
      const player = await findPlayer(term);
      if (!player) {
        alert('No player found. Check username or email.');
        return;
      }
      selectedPlayer = player;
      nameEl.textContent    = player[USERNAME_FIELD] || '(no username)';
      emailEl.textContent   = player[EMAIL_FIELD]    || '(no email)';
      balanceEl.textContent = Number(player[BALANCE_FIELD] ?? 0).toLocaleString('en-IN');
      amountInput.value     = '';
      resultBox.style.display = 'block';
    } catch (err) {
      console.error(err);
      alert('Search failed: ' + err.message);
    } finally {
      searchBtn.disabled = false;
      searchBtn.textContent = 'Search';
    }
  }

  async function handleCredit() {
    if (!selectedPlayer) return;
    const amount = Number(amountInput.value);
    if (!Number.isFinite(amount) || amount <= 0 || !Number.isInteger(amount)) {
      alert('Enter a valid whole number greater than 0.'); return;
    }
    
    const ok = confirm(`Credit Rs ${amount.toLocaleString('en-IN')} to ${nameEl.textContent}?\n\nCurrent: Rs ${balanceEl.textContent}`);
    if (!ok) return;

    creditBtn.disabled = true;
    creditBtn.textContent = 'Crediting...';
    msgEl.textContent = '';

    try {
      const userRef = doc(db, 'users', selectedPlayer.id);
      await updateDoc(userRef, { [BALANCE_FIELD]: increment(amount) });

      try {
        await addDoc(collection(db, 'wallet_ledger'), {
          userId: selectedPlayer.id, username: nameEl.textContent, email: emailEl.textContent,
          type: 'admin_credit', amount: amount, reason: 'Manual credit via admin panel',
          createdAt: serverTimestamp(), createdBy: currentAdminEmail || 'admin'
        });
      } catch (e) { console.warn('Ledger write failed:', e); }

      const freshSnap = await getDoc(userRef);
      const newBal = Number(freshSnap.data()?.[BALANCE_FIELD] ?? 0);

      balanceEl.textContent = newBal.toLocaleString('en-IN');
      msgEl.style.color = '#22c55e';
      msgEl.textContent = `✅ Credited Rs ${amount.toLocaleString('en-IN')}. New: Rs ${newBal.toLocaleString('en-IN')}`;
      amountInput.value = '';
    } catch (err) {
      console.error(err);
      msgEl.style.color = '#ef4444';
      msgEl.textContent = '❌ Failed: ' + err.message;
    } finally {
      creditBtn.disabled = false;
      creditBtn.textContent = 'Credit';
    }
  }

  searchBtn.addEventListener('click', handleSearch);
  creditBtn.addEventListener('click', handleCredit);
  searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') searchBtn.click(); });
  amountInput.addEventListener('keydown', e => { if (e.key === 'Enter') creditBtn.click(); });
};


// ============================================================
// FFWS PREDICTIONS VIEWER 
// ============================================================
let allPredictionsData = [];
let predsInitialized = false;

window.fetchPredictions = async function() {
  const loadPredsBtn = document.getElementById('loadPredsBtn');
  const predictionsList = document.getElementById('predictionsList');
  
  if (!loadPredsBtn || !predictionsList) return;

  if (!predsInitialized) {
    const predSearchInput = document.getElementById('predSearchInput');
    
    loadPredsBtn.addEventListener('click', window.fetchPredictions);
    
    predSearchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      if (!term) return renderPredictions(allPredictionsData);
      
      const filtered = allPredictionsData.filter(p => 
        (p.username && p.username.toLowerCase().includes(term)) || 
        (p.email && p.email.toLowerCase().includes(term)) ||
        (p.userId && p.userId.toLowerCase().includes(term))
      );
      renderPredictions(filtered);
    });
    predsInitialized = true;
  }

  loadPredsBtn.textContent = '⏳ Loading...';
  loadPredsBtn.disabled = true;
  predictionsList.innerHTML = '<div style="text-align:center; padding:20px; color:#9ca3af;">Loading predictions from Firebase...</div>';
  allPredictionsData = [];

  try {
    const predsSnap = await getDocs(collection(db, 'ffws_predictions'));
    if (predsSnap.empty) {
      predictionsList.innerHTML = '<p style="text-align:center; color:#9ca3af; padding:20px;">No predictions submitted yet.</p>';
      return;
    }

    const promises = predsSnap.docs.map(async (predDoc) => {
      const pred = predDoc.data();
      let username = 'Unknown User';
      let email = 'No Email';

      try {
        const userSnap = await getDoc(doc(db, 'users', pred.userId));
        if (userSnap.exists()) {
          const uData = userSnap.data();
          username = uData.username || uData.name || 'Unnamed';
          email = uData.email || 'No Email';
        }
      } catch (e) {
        console.warn("Could not fetch user for prediction", pred.userId);
      }

      let timeStr = 'Unknown Time';
      if (pred.submittedAt) {
        timeStr = pred.submittedAt.toDate().toLocaleString('en-GB', { 
          day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' 
        });
      }

      return { id: predDoc.id, username, email, timeStr, ...pred };
    });

    allPredictionsData = await Promise.all(promises);
    allPredictionsData.sort((a, b) => (b.submittedAt?.toMillis() || 0) - (a.submittedAt?.toMillis() || 0));
    renderPredictions(allPredictionsData);

  } catch (err) {
    console.error('Error loading predictions:', err);
    predictionsList.innerHTML = `<p style="color:#ef4444; text-align:center; padding:20px;">❌ Error: ${err.message}</p>`;
  } finally {
    loadPredsBtn.textContent = '🔄 Refresh Predictions';
    loadPredsBtn.disabled = false;
  }
};

function renderPredictions(dataToRender) {
  const predictionsList = document.getElementById('predictionsList');
  if (!predictionsList) return;
  
  predictionsList.innerHTML = '';
  
  if (dataToRender.length === 0) {
    predictionsList.innerHTML = '<p style="text-align:center; color:#9ca3af; padding:20px;">No results found.</p>';
    return;
  }

  dataToRender.forEach(pred => {
    const card = document.createElement('div');
    card.style.cssText = 'background: #0f1124; border: 1px solid #2a2d4a; border-radius: 10px; padding: 16px; font-size: 13px; margin-bottom: 12px;';
    
    const makeDayBox = (dayLabel, dayData) => `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.05); padding: 12px; border-radius: 8px;">
        <h4 style="color: #fbbf24; margin: 0 0 10px 0; font-size: 12px; border-bottom: 1px dashed #444; padding-bottom: 6px; text-transform: uppercase;">📅 ${dayLabel}</h4>
        <div style="display:flex; flex-direction:column; gap:6px; color:#ddd;">
          <div><span style="color:#9ca3af;">Top 2:</span> <b>${dayData?.topTeams || '-'}</b></div>
          <div><span style="color:#9ca3af;">Winner:</span> <b style="color:#4ade80;">${dayData?.winner || '-'}</b></div>
          <div><span style="color:#9ca3af;">Kills:</span> ${dayData?.kills || '-'} | <span style="color:#9ca3af;">Place:</span> ${dayData?.placement || '-'}</div>
          <div><span style="color:#9ca3af;">Booyah:</span> ${dayData?.booyah || '-'}</div>
        </div>
      </div>
    `;

    card.innerHTML = `
      <div style="border-bottom: 1px solid #2a2d4a; padding-bottom: 12px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-start; flex-wrap:wrap; gap:10px;">
        <div>
          <div style="font-weight: 800; color: #a5b4fc; font-size: 15px;">👤 ${pred.username}</div>
          <div style="color: #9ca3af; font-size: 12px; margin-top:2px;">${pred.email}</div>
        </div>
        <div style="color: #6b7280; font-size: 11px; background:rgba(255,255,255,.05); padding:4px 8px; border-radius:6px;">
          🕐 ${pred.timeStr}
        </div>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
        ${makeDayBox('Day 1', pred.day1)}
        ${makeDayBox('Day 2', pred.day2)}
        ${makeDayBox('Day 3', pred.day3)}
      </div>
    `;
    predictionsList.appendChild(card);
  });
}
