// ==========================================================
// NEPPLAY — admin.js (v5.2 - ABSOLUTE FULL)
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

console.log("🔥 Admin v5.2 — awaiting auth");

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
  
  // 👇 ADD THESE TWO LINES 👇
  window.loadMatchResultsDropdown();
  const matchSelect = document.getElementById('matchTournamentSelect'); // 👈 Ensure ID matches your HTML
  if (matchSelect) matchSelect.addEventListener('change', window.handleResultTournamentSelect);
  // 👆 END ADDITION 👆

  console.log("✅ Admin panel booted for:", currentAdminEmail);
}

// ============================================================
// LIVE STATS
// ============================================================
function loadLiveStats() {
  const t = todayKey();
  const el = id => document.getElementById(id);
  if (el('lsUsers')) el('lsUsers').innerText = allUsers.length;
  const newToday = allUsers.filter(u => dayKey(u.createdAt) === t).length;
  if (el('lsNewToday')) el('lsNewToday').innerText = newToday;
  if (el('lsRegs')) el('lsRegs').innerText = allRegs.length;
  const pending = allPayments.filter(p => p.status === 'pending').length;
  if (el('lsPending')) el('lsPending').innerText = pending;
  const confirmedToday = allRegs.filter(r => r.status === 'confirmed' && dayKey(r.registeredAt) === t).length;
  if (el('lsConfirmedToday')) el('lsConfirmedToday').innerText = confirmedToday;
  const liveStreamers = allRegs.filter(r => r.streamUrl && r.status === 'confirmed').length;
  if (el('lsLiveStreamers')) el('lsLiveStreamers').innerText = liveStreamers;
  const todayCollected = allPayments
    .filter(p => p.status === 'approved' && dayKey(p.reviewedAt || p.submittedAt) === t)
    .reduce((s,p) => s + (Number(p.amount)||0), 0);
  if (el('lsCollectedToday')) el('lsCollectedToday').innerText = fmtRs(todayCollected);
  const todayPayouts = allPayouts
    .filter(x => dayKey(x.paidAt || x.createdAt) === t)
    .reduce((s,p) => s + (Number(p.amount)||0), 0);
  if (el('lsPaidToday')) el('lsPaidToday').innerText = fmtRs(todayPayouts);
  const net = todayCollected - todayPayouts;
  if (el('lsNetToday')) {
    el('lsNetToday').innerText = fmtRs(net);
    el('lsNetToday').style.color = net >= 0 ? '#4ade80' : '#f87171';
  }

  (async () => {
    try {
      const statsSnap = await getDoc(doc(db, "site_stats", "main"));
      if (!statsSnap.exists()) return;
      const s = statsSnap.data();
      const totalVisits   = Number(s.totalVisits || 0);
      const todayVisits   = Number(s.todayVisits || 0);
      const totalViews    = Number(s.totalPageViews || 0);
      const viewsPerVisit = totalVisits > 0 ? (totalViews / totalVisits).toFixed(1) : '0';

      if (el('lsTotalVisits'))   el('lsTotalVisits').innerText   = totalVisits;
      if (el('lsTodayVisits'))   el('lsTodayVisits').innerText   = todayVisits;
      if (el('lsTotalViews'))    el('lsTotalViews').innerText    = totalViews;
      if (el('lsViewsPerVisit')) el('lsViewsPerVisit').innerText = viewsPerVisit;
    } catch (e) {}
  })();
}
setInterval(() => {
  if (document.getElementById('admin-panel')?.style.display === 'block') loadLiveStats();
}, 30000);

// ============================================================
// DASHBOARD RECENTS
// ============================================================
window.renderDashboardRecent = function() {
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
// NOTIFICATIONS (admin bell) & REALTIME
// ============================================================
let notifications = [];

function addNotif(type, title, message) {
  notifications.unshift({ id: Date.now() + Math.random(), type, title, message, time: new Date(), read: false });
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
  const icons = { user:'👤', registration:'📋', payment:'💰', review:'✅', result:'🏆', referral:'🤝' };
  const colors = { user:'#3b82f6', registration:'#a855f7', payment:'#f59e0b', review:'#22c55e', result:'#eab308', referral:'#ec4899' };
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
    setTimeout(() => { notifications.forEach(n => n.read = true); renderNotifBell(); }, 1500);
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
        const modeLabel = (r.playingAs || r.mode || '').toLowerCase() === 'solo' ? '1v1'
                       : (r.playingAs || r.mode || '').toLowerCase() === 'duo' ? '2v2'
                       : '';
        addNotif('registration', `${r.entryType === 'paid' ? '💵' : '🆓'} New registration${modeLabel ? ' · ' + modeLabel : ''}`, `${r.username || 'User'} joined ${r.tournamentTitle || 'a tournament'}`);
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
// REFERRAL BONUSES
// ============================================================
const REFERRAL_BONUS_AMOUNT = 20;

async function handleReferralBonus(paymentId) {
  try {
    const paySnap = await getDoc(doc(db, 'tournament_payments', paymentId));
    if (!paySnap.exists()) return;
    const payment = paySnap.data();
    const payerUid = payment.userId;
    if (!payerUid) return;

    const dupSnap = await getDocs(query(
      collection(db, 'referral_bonuses'),
      where('referredPaymentId', '==', paymentId)
    ));
    if (!dupSnap.empty) return;

    const payerDoc = await getDoc(doc(db, 'users', payerUid));
    if (!payerDoc.exists()) return;
    const payer = payerDoc.data();
    const referrerUid = payer.referredBy;
    if (!referrerUid) return;

    const refDoc = await getDoc(doc(db, 'users', referrerUid));
    const referrer = refDoc.exists() ? refDoc.data() : {};

    await addDoc(collection(db, 'referral_bonuses'), {
      referrerUid, referrerName: referrer.username || referrer.fullName || 'Unknown',
      referrerEmail: referrer.email || '',
      referredUid: payerUid, referredName: payer.username || payer.fullName || 'Unknown',
      referredEmail: payer.email || '',
      referredIgn: payment.ign || '', referredPhone: payment.phone || '',
      referredPaymentId: paymentId,
      tournamentId: payment.tournamentId || '', tournamentTitle: payment.tournamentTitle || '',
      paymentMethod: payment.method || '', txnId: payment.txnId || '',
      amount: REFERRAL_BONUS_AMOUNT,
      status: 'pending',
      createdAt: serverTimestamp(),
      paidAt: null, adminNote: ''
    });

    logActivity({
      action: 'referral_credited', category: 'referrals',
      targetId: payerUid, targetType: 'user',
      summary: `Referral credited — ${referrer.username || 'referrer'} earned Rs. ${REFERRAL_BONUS_AMOUNT} from ${payer.username || 'referred user'}`,
      metadata: { referrer: referrer.username || '', referred: payer.username || '', amount: REFERRAL_BONUS_AMOUNT },
      actorType: 'system'
    });

    const currentCount = Number(referrer.referralCount || 0);
    const currentEarnings = Number(referrer.referralEarnings || 0);
    await updateDoc(doc(db, 'users', referrerUid), {
      referralCount: currentCount + 1,
      referralEarnings: currentEarnings + REFERRAL_BONUS_AMOUNT
    });

    addNotif('referral', '🤝 Referral bonus earned',
      `${referrer.username || 'A member'} earned Rs. ${REFERRAL_BONUS_AMOUNT} from ${payer.username || 'a referred friend'}`);
  } catch (err) { console.error('handleReferralBonus error:', err); }
}

async function loadReferralBonuses() {
  try {
    const snap = await getDocs(collection(db, 'referral_bonuses'));
    allReferralBonuses = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    allReferralBonuses.sort((a, b) =>
      (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0)
    );
    const badge = document.getElementById('referralsBadge');
    if (badge) {
      const pending = allReferralBonuses.filter(b => b.status === 'pending').length;
      badge.innerText = pending;
      badge.style.display = pending > 0 ? 'inline-block' : 'none';
    }
    renderReferralBonuses();
  } catch (err) { console.warn('loadReferralBonuses error:', err); }
}
window.loadReferralBonuses = loadReferralBonuses;

window.filterRefStatus = function(status, btn) {
  currentRefFilter = status;
  document.querySelectorAll('#section-referrals .pay-status-tabs button').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderReferralBonuses();
};

window.filterRefSearch = function() {
  currentRefSearch = (document.getElementById('refSearch')?.value || '').toLowerCase().trim();
  renderReferralBonuses();
};

function renderReferralBonuses() {
  const totalCount = allReferralBonuses.length;
  const pending = allReferralBonuses.filter(b => b.status === 'pending');
  const paid = allReferralBonuses.filter(b => b.status === 'paid');
  const pendingAmt = pending.reduce((s, b) => s + Number(b.amount || 0), 0);
  const paidAmt = paid.reduce((s, b) => s + Number(b.amount || 0), 0);

  const byReferrer = {};
  allReferralBonuses.forEach(b => {
    const key = b.referrerUid;
    if (!key) return;
    if (!byReferrer[key]) byReferrer[key] = { name: b.referrerName || 'Unknown', count: 0, total: 0 };
    byReferrer[key].count++;
    byReferrer[key].total += Number(b.amount || 0);
  });
  const topList = Object.values(byReferrer).sort((a, b) => b.total - a.total);
  const top = topList[0] || null;

  const el = id => document.getElementById(id);
  if (el('refTotalCount')) el('refTotalCount').innerText = totalCount;
  if (el('refPendingAmt')) el('refPendingAmt').innerText = fmtRs(pendingAmt);
  if (el('refPaidAmt')) el('refPaidAmt').innerText = fmtRs(paidAmt);
  if (el('refTopReferrer')) {
    el('refTopReferrer').innerText = top ? top.name : '—';
    const sub = el('refTopReferrerSub');
    if (sub) sub.innerText = top ? `${top.count} referral${top.count !== 1 ? 's' : ''} · ${fmtRs(top.total)}` : 'No referrers yet';
  }
  if (el('refCntPending')) el('refCntPending').innerText = pending.length;
  if (el('refCntPaid')) el('refCntPaid').innerText = paid.length;
  if (el('refCntAll')) el('refCntAll').innerText = totalCount;

  const list = document.getElementById('referralList');
  if (!list) return;

  let filtered = allReferralBonuses.filter(b => {
    if (currentRefFilter !== 'all' && b.status !== currentRefFilter) return false;
    if (currentRefSearch) {
      const hay = `${b.referrerName||''} ${b.referredName||''} ${b.referredEmail||''} ${b.referredIgn||''} ${b.tournamentTitle||''} ${b.txnId||''}`.toLowerCase();
      if (!hay.includes(currentRefSearch)) return false;
    }
    return true;
  });

  if (!allReferralBonuses.length) {
    list.innerHTML = `<div class="empty-state"><span class="icon">🤝</span>No referral bonuses yet.</div>`;
    return;
  }
  if (!filtered.length) {
    list.innerHTML = `<div class="empty-state"><span class="icon">🔍</span>No referral bonuses match your filter.</div>`;
    return;
  }

  list.innerHTML = filtered.map(b => {
    const isPaid = b.status === 'paid';
    const payment = allPayments.find(p => p.id === b.referredPaymentId);
    const shotId = payment ? registerScreenshot(payment) : null;
    const shotHtml = shotId
      ? `<img src="${screenshotCache[shotId]}" class="ref-thumb" onclick="event.stopPropagation(); openShotById('${shotId}')" alt="Payment">`
      : '';
    const safeReferrer = (b.referrerName || '').replace(/'/g, '');

    return `
      <div class="reg-card ref-card ${isPaid ? 'referral-paid' : 'referral-pending'}">
        <div class="reg-icon">🤝</div>
        <div class="reg-main">
          <div class="reg-line-1">
            <b class="clickable-name" onclick="openUserDetail('${b.referrerUid || ''}')" title="View referrer">
              ${escapeDetail(b.referrerName || 'Unknown')}
            </b>
            <span class="reg-sep">→</span>
            <b class="clickable-name" onclick="openUserDetail('${b.referredUid || ''}')" title="View referred user">
              ${escapeDetail(b.referredName || 'Unknown')}
            </b>
          </div>
          <div class="reg-line-2">
            🏆 ${escapeDetail(b.tournamentTitle || 'Paid tournament')}
            · 💰 <b style="color:#fbbf24;">${fmtRs(b.amount || REFERRAL_BONUS_AMOUNT)}</b>
          </div>
          <div class="reg-line-2" style="font-size:11px;color:#6b7280;">
            🕐 ${fmtShort(b.createdAt)}
          </div>
        </div>
        ${shotHtml ? `<div class="ref-shot-wrap">${shotHtml}</div>` : ''}
        <div class="reg-right">
          <span class="status-pill ${isPaid ? 'approved' : 'pending'}" style="font-size:10px;padding:3px 8px;">${isPaid ? 'PAID' : 'PENDING'}</span>
          ${!isPaid ? `<button class="btn-approve small" style="margin-top:6px;" onclick="markReferralPaid('${b.id}','${safeReferrer}')">✔ Mark Paid</button>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

window.markReferralPaid = async function(bonusId, referrerName) {
  if (!confirm(`Mark this referral bonus as paid to ${referrerName}?`)) return;
  try {
    await updateDoc(doc(db, 'referral_bonuses', bonusId), {
      status: 'paid',
      paidAt: serverTimestamp(),
      adminNote: 'Manually marked paid by admin'
    });
    window.showToast('✅ Referral bonus marked as paid');
    await loadReferralBonuses();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};

window.exportReferralsCSV = function() {
  if (!allReferralBonuses.length) { window.showToast('❌ No referral bonuses to export', true); return; }
  const rows = [['Referrer','Referrer Email','Referred','Referred Email','Referred IGN','Referred Phone','Tournament','Payment Method','Txn ID','Amount','Status','Created','Paid At','Note']];
  allReferralBonuses.forEach(b => {
    rows.push([
      b.referrerName || '', b.referrerEmail || '',
      b.referredName || '', b.referredEmail || '', b.referredIgn || '', b.referredPhone || '',
      b.tournamentTitle || '', b.paymentMethod || '', b.txnId || '',
      b.amount || 0, b.status || '',
      b.createdAt?.toDate ? b.createdAt.toDate().toISOString() : '',
      b.paidAt?.toDate ? b.paidAt.toDate().toISOString() : '',
      b.adminNote || ''
    ]);
  });
  downloadCSV(`nepplay-referrals-${todayKey()}.csv`, rows);
};

// ============================================================
// NOTIFICATIONS PAGE
// ============================================================
const NOTIF_TYPE_META = {
  info:    { icon: 'ℹ️', color: '#60a5fa' },
  success: { icon: '✅', color: '#4ade80' },
  warning: { icon: '⚠️', color: '#facc15' },
  error:   { icon: '❌', color: '#f87171' },
  trophy:  { icon: '🏆', color: '#fbbf24' },
  money:   { icon: '💰', color: '#4ade80' }
};

function renderNotificationTargetOptions() {
  const sel = document.getElementById('notifTarget');
  if (!sel) return;
  const currentVal = sel.value;
  const users = [...allUsers].filter(u => u.id).sort((a, b) =>
    String(a.username || a.email || '').localeCompare(String(b.username || b.email || ''))
  );
  let html = '<option value="">— Pick a recipient —</option>';
  html += '<option value="ALL" style="font-weight:700;">📢 All users (broadcast)</option>';
  if (users.length) {
    html += '<optgroup label="Individual users">';
    users.forEach(u => {
      const label = `${u.username || 'Unknown'}${u.email ? ' — ' + u.email : ''}`;
      html += `<option value="${escapeDetail(u.id)}">${escapeDetail(label)}</option>`;
    });
    html += '</optgroup>';
  }
  sel.innerHTML = html;
  if (currentVal) sel.value = currentVal;
}

async function loadSentNotifications() {
  const list = document.getElementById('sentNotifList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  try {
    const snap = await getDocs(query(collection(db, 'notifications'), orderBy('createdAt', 'desc'), limit(30)));
    allSentNotifications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!allSentNotifications.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">📭</span>No notifications sent yet.</div>';
      return;
    }
    list.innerHTML = allSentNotifications.map(n => {
      const meta = NOTIF_TYPE_META[n.type] || NOTIF_TYPE_META.info;
      const isBroadcast = n.targetUid === 'ALL';
      const targetLabel = isBroadcast ? '📢 All users (broadcast)' : `🎯 ${escapeDetail(n.targetName || n.targetUid || 'Unknown')}`;
      const readCount = Array.isArray(n.readBy) ? n.readBy.length : 0;
      const sentAt = fmtShort(n.createdAt);
      const truncMsg = (n.message || '').length > 140 ? n.message.slice(0, 140) + '…' : (n.message || '');
      return `
        <div class="sent-notif-item">
          <div class="sent-notif-dot" style="background:${meta.color}20; border-color:${meta.color}; color:${meta.color};">${meta.icon}</div>
          <div class="sent-notif-body">
            <div class="sent-notif-target">${targetLabel}</div>
            <div class="sent-notif-title">${escapeDetail(n.title || '(no title)')}</div>
            <div class="sent-notif-msg">${escapeDetail(truncMsg)}</div>
            <div class="sent-notif-meta">🕐 ${sentAt} · 👤 ${escapeDetail(n.createdBy || '—')}${!isBroadcast ? ' · ✅ read by ' + readCount : ''}</div>
          </div>
          <div><button class="btn-delete small" onclick="deleteNotification('${n.id}')" title="Delete">🗑️</button></div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('loadSentNotifications error:', err);
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + escapeDetail(err.message) + '</div>';
  }
}

async function loadNotificationsPage() {
  renderNotificationTargetOptions();
  await loadSentNotifications();
}
window.loadNotificationsPage = loadNotificationsPage;

window.sendNotification = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('notifSendBtn');
  const targetUidRaw = document.getElementById('notifTarget').value;
  const type = document.getElementById('notifType').value || 'info';
  const title = document.getElementById('notifTitle').value.trim();
  const message = document.getElementById('notifMessage').value.trim();
  if (!targetUidRaw) { window.showToast('❌ Pick a recipient', true); return; }
  if (!title) { window.showToast('❌ Title required', true); return; }
  if (!message) { window.showToast('❌ Message required', true); return; }
  btn.disabled = true;
  const origText = btn.textContent;
  btn.textContent = '⏳ Sending...';
  try {
    const isBroadcast = targetUidRaw === 'ALL';
    let targetName = 'All users';
    if (!isBroadcast) {
      const u = allUsers.find(x => x.id === targetUidRaw);
      targetName = u ? (u.username || u.email || targetUidRaw) : targetUidRaw;
    }
    await addDoc(collection(db, 'notifications'), {
      targetUid: isBroadcast ? 'ALL' : targetUidRaw, targetName,
      type, title, message,
      createdBy: currentAdminEmail || 'admin',
      createdAt: serverTimestamp(),
      readBy: []
    });
    window.showToast('✅ Notification sent');
    document.getElementById('notifTitle').value = '';
    document.getElementById('notifMessage').value = '';
    document.getElementById('notifType').value = 'info';
    document.getElementById('notifTarget').value = '';
    await loadSentNotifications();
  } catch (err) {
    console.error('sendNotification error:', err);
    window.showToast('❌ ' + err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = origText;
  }
};

window.deleteNotification = async function(id) {
  if (!confirm('Delete this notification?')) return;
  try {
    await deleteDoc(doc(db, 'notifications', id));
    window.showToast('🗑️ Notification deleted');
    await loadSentNotifications();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
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
    loadLiveStats();
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
    const shotUrl = isPaid ? (r.paymentScreenshotUrl || null) : null;
    const modeBadge = modeBadgeHtml(r.playingAs);
    return `
      <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'} clickable-row" onclick="openRegDetail('${r.id}')">
        <div class="reg-icon">${isPaid ? '💵' : '🏆'}</div>
        <div class="reg-main">
          <div class="reg-line-1">
            <b>${r.username || 'Unknown'}</b>
            <span class="reg-sep">—</span>
            <span class="reg-tournament">${r.tournamentTitle || 'Tournament'}</span>
            ${modeBadge}
            ${r.teammates && r.teammates.length ? `<span class="tourney-count" style="margin-left:6px;">👥 ${r.teammates.length} players</span>` : ''}
          </div>
          <div class="reg-line-2">
            ${r.ign ? 'IGN: <b>' + r.ign + '</b> · ' : ''}
            ${r.phone ? '📱 ' + r.phone + ' · ' : ''}
            ${isPaid ? 'Txn: <code>' + (r.transactionId || r.txnId || '—') + '</code> · ' : ''}
            ${isPaid ? 'Rs. ' + (r.amount||0) : 'Free Entry'}
          </div>
          ${isPaid && shotUrl ? `
            <div class="reg-payment-preview">
              <img src="${shotUrl}" class="thumb" onclick="event.stopPropagation(); openShot('${shotUrl}')" alt="Payment Screenshot" title="Click to view full">
              <span class="method-tag">${(r.paymentMethod || 'PAID').toUpperCase()}</span>
              <span class="status-tag ${r.status}">${(r.status||'').toUpperCase()}</span>
            </div>
          ` : ''}
          <div class="reg-actions" onclick="event.stopPropagation();">
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
    await updateDoc(doc(db, 'tournament_registrations', id), { ign: newIgn.trim(), phone: newPhone.trim() });
    window.showToast('✅ Updated');
    window.loadRegistrations();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
};
window.deleteRegistration = async function(id, name) {
  if (!confirm('Delete registration for ' + name + '?')) return;
  try {
    await deleteDoc(doc(db, 'tournament_registrations', id));
    window.showToast('🗑️ Deleted');
    window.loadRegistrations();
  } catch (err) { window.showToast('❌ ' + err.message, true); }
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
// DAILY COLLECTIONS & EARNINGS & PROFIT SHARE
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
        <div class="reg-card" style="padding:16px; margin-bottom:10px; display:flex; justify-content:space-between; align-items:flex-start; gap:16px; width:100%; box-sizing:border-box;">
          
          <div style="flex:1; min-width:0; text-align:left;">
            <div style="font-weight:800; color:#fff; font-size:16px; margin-bottom:6px;">${escapeDetail(a.title)}</div>
            <div style="color:#cbd5e1; font-size:14px; line-height:1.5; white-space:pre-wrap; word-break:break-word;">${escapeDetail(a.message)}</div>
            <div style="font-size:11px; color:#6b7280; margin-top:8px;">🕐 ${fmtShort(a.createdAt)}</div>
          </div>
          
          <div style="flex-shrink:0;">
            <button class="btn-delete small" onclick="deleteAnnouncement('${d.id}')">🗑️</button>
          </div>
          
        </div>
      `;
    }).join('');
  } catch(e) { console.error(e); }
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
// ============================================================
// MATCH RESULTS & PAYOUTS
// ============================================================

window.loadMatchResultsSection = function() {
  const select = document.getElementById('resultTournamentSelect');
  if (!select) return;

  // Show upcoming or live tournaments
  const available = allTournaments.filter(t => {
    const st = String(t.status || '').toLowerCase();
    return st === 'upcoming' || st === 'live';
  });

  select.innerHTML = '<option value="">— Choose a tournament —</option>' +
    available.map(t => `<option value="${t.id}">${escapeDetail(t.title)} (${t.date})</option>`).join('');
};

window.loadTournamentForResult = function() {
  const select = document.getElementById('resultTournamentSelect');
  const tId = select.value;
  const formDiv = document.getElementById('resultForm');

  if (!tId) {
    formDiv.style.display = 'none';
    return;
  }

  const t = allTournaments.find(x => x.id === tId);
  if (!t) return;

  formDiv.style.display = 'block';

  // 1. Update Tournament Summary
  const regs = allRegs.filter(r => r.tournamentId === tId && r.status === 'confirmed');
  document.getElementById('resultTournamentSummary').innerHTML = `
    <div style="font-weight:800; color:#fff; font-size:16px;">${escapeDetail(t.title)}</div>
    <div style="color:#9ca3af; font-size:13px; margin-top:4px;">
      ${escapeDetail(t.game)} · ${escapeDetail(t.mode)} · Entry: Rs ${t.entryFee || 0} · Confirmed Players: ${regs.length}
    </div>
  `;

  // 2. Auto-fill the prize inputs based on the tournament data
  const pool = Number(t.prizePool || 0);
  const topKill = Number(t.topKillsPrize || t.topKills || 0);

  document.getElementById('winner1Prize').value = pool;
  document.getElementById('winner2Prize').value = 0;
  document.getElementById('winner3Prize').value = 0;
  document.getElementById('topKillerPrize').value = topKill;
  document.getElementById('resultPool').innerText = 'Rs ' + pool;

  // 3. Attach live calculation listeners
  ['winner1Prize', 'winner2Prize', 'winner3Prize', 'topKillerPrize'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.oninput = window.calculateResultSummary;
  });

  window.calculateResultSummary();
};

window.calculateResultSummary = function() {
  const p1 = Number(document.getElementById('winner1Prize').value) || 0;
  const p2 = Number(document.getElementById('winner2Prize').value) || 0;
  const p3 = Number(document.getElementById('winner3Prize').value) || 0;
  const pTK = Number(document.getElementById('topKillerPrize').value) || 0;
  
  const total = p1 + p2 + p3 + pTK;
  document.getElementById('resultTotalPayout').innerText = 'Rs ' + total;
  
  const tId = document.getElementById('resultTournamentSelect').value;
  const regs = allRegs.filter(r => r.tournamentId === tId && r.status === 'confirmed');
  const collection = regs.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  
  document.getElementById('resultCollection').innerText = 'Rs ' + collection;
  document.getElementById('resultNetProfit').innerText = 'Rs ' + (collection - total);
};

window.submitMatchResults = async function() {
  const select = document.getElementById('resultTournamentSelect');
  const tId = select.value;
  if (!tId) return alert('Please select a tournament first.');

  if (!confirm('Submit results and process payouts? This will credit the players\' wallets instantly.')) return;

  const t = allTournaments.find(x => x.id === tId);
  const submitBtn = document.getElementById('submitResultsBtn');
  submitBtn.disabled = true;
  submitBtn.innerText = '⏳ Processing Payouts...';

  try {
    // 1. Get all inputs
    const w1Name = document.getElementById('winner1Name').value.trim();
    const w1Kills = Number(document.getElementById('winner1Kills').value) || 0;
    const w1Method = document.getElementById('winner1Method').value;
    const w1Prize = Number(document.getElementById('winner1Prize').value) || 0;

    const w2Name = document.getElementById('winner2Name').value.trim();
    const w2Kills = Number(document.getElementById('winner2Kills').value) || 0;
    const w2Method = document.getElementById('winner2Method').value;
    const w2Prize = Number(document.getElementById('winner2Prize').value) || 0;

    const w3Name = document.getElementById('winner3Name').value.trim();
    const w3Kills = Number(document.getElementById('winner3Kills').value) || 0;
    const w3Method = document.getElementById('winner3Method').value;
    const w3Prize = Number(document.getElementById('winner3Prize').value) || 0;

    const tkName = document.getElementById('topKillerName').value.trim() || w1Name; // Default to 1st place
    const tkKills = Number(document.getElementById('topKillerKills').value) || 0;
    const tkMethod = document.getElementById('topKillerMethod').value;
    const tkPrize = Number(document.getElementById('topKillerPrize').value) || 0;

    const highlightUrl = document.getElementById('resultHighlightUrl').value.trim();

    let totalPayout = 0;
    const payoutsToProcess = [];

    // 2. Map usernames to UIDs and prepare payouts
    if (w1Name && w1Prize > 0) {
      const user = await findUidByUsername(w1Name);
      if (user) payoutsToProcess.push({ uid: user.uid, name: w1Name, prize: w1Prize, method: w1Method, rank: '1st' });
      else alert(`User "${w1Name}" not found! Skipping 1st place payout.`);
    }
    if (w2Name && w2Prize > 0) {
      const user = await findUidByUsername(w2Name);
      if (user) payoutsToProcess.push({ uid: user.uid, name: w2Name, prize: w2Prize, method: w2Method, rank: '2nd' });
      else alert(`User "${w2Name}" not found! Skipping 2nd place payout.`);
    }
    if (w3Name && w3Prize > 0) {
      const user = await findUidByUsername(w3Name);
      if (user) payoutsToProcess.push({ uid: user.uid, name: w3Name, prize: w3Prize, method: w3Method, rank: '3rd' });
      else alert(`User "${w3Name}" not found! Skipping 3rd place payout.`);
    }
    
    // Handle Top Killer (Check if they already won 1st/2nd/3rd to combine prizes)
    if (tkName && tkPrize > 0) {
      const existing = payoutsToProcess.find(p => p.name.toLowerCase() === tkName.toLowerCase());
      if (existing) {
        existing.prize += tkPrize;
        existing.rank += ' + Top Killer';
      } else {
        const user = await findUidByUsername(tkName);
        if (user) payoutsToProcess.push({ uid: user.uid, name: tkName, prize: tkPrize, method: tkMethod, rank: 'Top Killer' });
        else alert(`User "${tkName}" (Top Killer) not found! Skipping payout.`);
      }
    }

    // 3. Execute Wallet Updates & Database Writes
    for (const p of payoutsToProcess) {
      totalPayout += p.prize;
      
      // Credit Wallet
      await updateDoc(doc(db, 'users', p.uid), { walletBalance: increment(p.prize) });

      // Add to Ledger
      await addDoc(collection(db, 'wallet_ledger'), {
        userId: p.uid, username: p.name, type: 'match_winning',
        amount: p.prize, reason: `Won ${p.rank} in ${t.title}`,
        createdAt: serverTimestamp()
      });

      // Add to Admin Payouts List
      await addDoc(collection(db, 'tournament_payouts'), {
        winnerUid: p.uid, winnerName: p.name, amount: p.prize, prize: p.prize,
        tournamentId: t.id, tournamentTitle: t.title, rank: p.rank,
        method: p.method, status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    }

    // 4. Save Match Result for the public Winners page
    await addDoc(collection(db, 'match_results'), {
      tournamentId: t.id,
      tournamentTitle: t.title,
      winner1: w1Name ? { name: w1Name, kills: w1Kills, prize: w1Prize } : null,
      winner2: w2Name ? { name: w2Name, kills: w2Kills, prize: w2Prize } : null,
      winner3: w3Name ? { name: w3Name, kills: w3Kills, prize: w3Prize } : null,
      topKiller: tkName ? { name: tkName, kills: tkKills, prize: tkPrize } : null,
      highlightUrl: highlightUrl,
      completedAt: serverTimestamp()
    });

    // 5. Mark Tournament as Completed
    await updateDoc(doc(db, 'tournaments', t.id), { status: 'completed' });

    alert(`✅ Success! Results saved and Rs ${totalPayout} distributed to wallets.`);
    
    // Refresh UI
    window.resetResultsForm();
    await window.loadTournamentsAdmin(); 
    window.loadMatchResultsSection(); 

  } catch (e) {
    console.error(e);
    alert('❌ Error saving results: ' + e.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerText = '🏆 Submit Results & Create Payouts';
  }
};

window.resetResultsForm = function() {
  document.getElementById('resultTournamentSelect').value = '';
  document.getElementById('resultForm').style.display = 'none';
  const inputs = ['winner1Name','winner1Kills','winner2Name','winner2Kills','winner3Name','winner3Kills','topKillerName','topKillerKills','resultHighlightUrl'];
  inputs.forEach(id => { 
    const el = document.getElementById(id); 
    if (el) el.value = ''; 
  });
};
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
window.deleteAnnouncement = async function(id) {
  if (!confirm('Are you sure you want to delete this announcement?')) return;
  try {
    await deleteDoc(doc(db, 'announcements', id));
    window.showToast('🗑️ Announcement deleted');
    window.loadAnnouncements(); // Refresh the list
  } catch (err) {
    window.showToast('❌ ' + err.message, true);
  }
};
