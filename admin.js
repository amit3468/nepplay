// ==========================================================
// NEPPLAY — admin.js (v4.9)
// v4.9 changes:
//  + Registration cards now show a mode badge (1v1 / 2v2 / squad)
// v4.8 changes:
//  + Announcements: Delete button on each announcement card
// v4.7 changes:
//  + Bracket: manual pairing UI (dropdowns + match list + shuffle remaining)
// v4.6 changes:
//  + Bracket system for 1v1 tournaments (auto-pair, publish, notify)
//  + "🎯 Manage Bracket" button on 1v1 tournament cards
// v4.5 changes:
//  + Payout docs now store userId + userEmail (from username lookup)
//  + Payout rows are clickable → detail modal
//  + openPayoutDetail() / savePayoutEdit() / deletePayout()
//  + addPayout() now stores userId too
//  + Backfill helper: backfillPayoutUserIds()
// ==========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, updateDoc, deleteDoc, getDoc,
  addDoc, query, where, serverTimestamp, onSnapshot, orderBy, limit,
  arrayUnion
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

console.log("🔥 Admin v4.9 — awaiting auth");

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

// ⭐ NEW: mode badge helper
function modeBadgeHtml(playingAs) {
  const m = String(playingAs || '').toLowerCase();
  if (m === 'solo') {
    return '<span class="mode-badge mode-badge-1v1">👤 Solo</span>';
  }
  if (m === '1v1') {
    return '<span class="mode-badge mode-badge-1v1">👤 1 vs 1</span>';
  }
  if (m === 'duo') {
    return '<span class="mode-badge mode-badge-2v2">👥 Duo</span>';
  }
  if (m === '2v2') {
    return '<span class="mode-badge mode-badge-2v2">👥 2 vs 2</span>';
  }
  if (m === 'squad') {
    return '<span class="mode-badge mode-badge-squad">🏆 Squad</span>';
  }
  return '';
}

function screenshotSrc(d) {
  if (!d) return null;
  if (d.screenshotBase64) return 'data:image/jpeg;base64,' + d.screenshotBase64;
  if (d.screenshotUrl) return d.screenshotUrl;
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
// NOTIFICATIONS (admin bell)
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
// BOOTSTRAP
// ============================================================
async function bootstrapAdminPanel() {
  await window.loadPayments();
  await window.loadRegistrations();
  await window.loadUsers();
  try {
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
  } catch (err) { window.showToast('❌ ' + err.message); }
};

window.exportReferralsCSV = function() {
  if (!allReferralBonuses.length) { window.showToast('❌ No referral bonuses to export'); return; }
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
// NOTIFICATIONS (#7)
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
  if (!targetUidRaw) { window.showToast('❌ Pick a recipient'); return; }
  if (!title) { window.showToast('❌ Title required'); return; }
  if (!message) { window.showToast('❌ Message required'); return; }
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
    window.showToast('❌ ' + err.message);
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
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// LIVE STATS
// ============================================================
function loadLiveStats() {
  const t = todayKey();
  const el = id => document.getElementById(id);
  if (el('lsUsers')) el('lsUsers').innerText = allUsers.length;
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

  // ⭐ Visitor stats (site_stats/main)
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
    } catch (e) {
      console.warn("[visitor stats] failed:", e && e.message);
    }
  })();
}
setInterval(() => {
  if (document.getElementById('admin-panel')?.style.display === 'block') loadLiveStats();
}, 30000);

// ============================================================
// DETAIL MODAL — Users
// ============================================================
window.closeDetailModal = function() { document.getElementById('detailModal').classList.remove('open'); };

window.openUserDetail = function(uid) {
  if (!uid) return;
  const u = allUsers.find(x => x.id === uid);
  if (!u) { window.showToast('❌ User not found'); return; }
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
      ${u.role === 'admin' ? '' : `<button class="dm-btn-danger" onclick="deleteUser('${u.id}','${(u.username||'').replace(/'/g,"\\'")}',true)">🗑️ Delete User</button>`}
    </div>
  `;
  document.getElementById('detailModal').classList.add('open');
};

// ============================================================
// DETAIL MODAL — Payouts
// ============================================================
window.openPayoutDetail = async function(payoutId) {
  const w = allPayouts.find(x => x.id === payoutId);
  if (!w) { window.showToast('❌ Payout not found'); return; }

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
  } catch (err) { window.showToast('❌ ' + err.message); }
};

window.markPayoutPending = async function(payoutId) {
  if (!confirm('Mark this payout as PENDING again?')) return;
  try {
    await updateDoc(doc(db, 'tournament_payouts', payoutId), { status: 'pending', paidAt: null });
    window.showToast('↺ Marked pending');
    closeDetailModal();
    await loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message); }
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
  } catch (err) { window.showToast('❌ ' + err.message); }
};

window.deletePayout = async function(payoutId, winnerName) {
  if (!confirm(`Delete payout for "${winnerName}"?`)) return;
  try {
    await deleteDoc(doc(db, 'tournament_payouts', payoutId));
    window.showToast('🗑️ Payout deleted');
    closeDetailModal();
    await loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message); }
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
            ${isPaid ? `
        <div class="dm-row"><span class="dm-k">🔖 Transaction ID</span><span class="dm-v" style="color:${r.transactionId ? '#fbbf24' : '#f87171'};font-weight:800;">${escapeDetail(r.transactionId) || '⚠️ NOT PROVIDED'}</span></div>
        ${r.paymentMethod ? `<div class="dm-row"><span class="dm-k">💳 Payment Method</span><span class="dm-v">${escapeDetail(r.paymentMethod)}</span></div>` : ''}
        ${r.payerName ? `<div class="dm-row"><span class="dm-k">👤 Payer Name</span><span class="dm-v">${escapeDetail(r.payerName)}</span></div>` : ''}
        ${r.payerPhone ? `<div class="dm-row"><span class="dm-k">📱 Payer Phone</span><span class="dm-v">${escapeDetail(r.payerPhone)}</span></div>` : ''}
      ` : ''}
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
    <b style="color:#fff;">${title}</b> · ${game} · ${mode}
    ${type === 'paid' ? `· 💰 Rs. ${fee}` : '· 🆓 Free'}
    ${pool ? `· 🏆 Rs. ${pool}` : ''}
    ${kills && type === 'paid' ? `· 🎯 Rs. ${kills}` : ''}
    · 📅 ${date} ${time} · 👥 max ${max}
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
      prizePool, topKillsPrize: entryType === 'paid' ? topKillsPrize : 0,
      date, time, max, filled: 0, description: desc,
      status: 'upcoming', createdAt: serverTimestamp()
    });
    window.showToast('✅ Tournament created');
    resetCreateForm();
    await loadRecentCreated();
  } catch (err) {
    console.error('Create tournament error:', err);
    window.showToast('❌ ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerText = '🚀 Create Tournament';
  }
};

// ============================================================
// RECENT TOURNAMENTS
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
      const tTitle = String(t.title || '').toLowerCase();
      const is1v1 = String(t.mode || '').toLowerCase() === '1v1'
                    || tTitle.includes('1v1')
                    || tTitle.includes('1 vs 1')
                    || tTitle.includes('1vs1');
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
              ${is1v1 ? `<button class="btn-edit small" style="background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#1a0b3d;font-weight:900;" onclick="openBracketManager('${t.id}')">🎯 Manage Bracket</button>` : ''}
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
      title: newTitle.trim(), prizePool: Number(newPrizePool) || 0,
      topKillsPrize: Number(newTopKills) || 0,
      date: newDate.trim(), time: newTime.trim(),
      max: Number(newMax) || 100,
      updatedAt: serverTimestamp()
    });
    window.showToast('✅ Tournament updated');
    await loadRecentCreated();
    if (typeof window.loadTournamentsAdmin === 'function') await window.loadTournamentsAdmin();
  } catch (err) { window.showToast('❌ ' + err.message); }
};
window.deleteTournament = async function(id, title) {
  if (!confirm(`Delete tournament "${title}"?`)) return;
  try {
    await deleteDoc(doc(db, 'tournaments', id));
    window.showToast('🗑️ Tournament deleted');
    await loadRecentCreated();
    if (typeof window.loadTournamentsAdmin === 'function') await window.loadTournamentsAdmin();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// ⭐ BRACKET MANAGER v4.7 — Manual pairing UI
// ============================================================
let bkTournament = null;
let bkRegistrations = [];
let bkMatches = [];
let bkExistingMatchIds = [];
let bkPublished = false;
let bkRoomId = '';
let bkRoomPassword = '';

function bkEsc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

function bkToast(msg) {
  const t = document.getElementById('bkToast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(window.__bkToastTimer);
  window.__bkToastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

window.bkClose = function () {
  const ov = document.getElementById('bkOverlay');
  if (ov) ov.classList.remove('open');
};

window.openBracketManager = async function (tournamentId) {
  const overlay = document.getElementById('bkOverlay');
  const bodyEl  = document.getElementById('bkBody');
  const footEl  = document.getElementById('bkFoot');
  const titleEl = document.getElementById('bkTitle');
  const subEl   = document.getElementById('bkSubtitle');
  if (!overlay || !bodyEl || !footEl) {
    window.showToast('❌ Bracket modal not found in DOM');
    return;
  }

  overlay.classList.add('open');
  bodyEl.innerHTML = '<div class="bk-empty">Loading…</div>';
  footEl.innerHTML = '';

  bkMatches = [];
  bkExistingMatchIds = [];
  bkPublished = false;
  bkRoomId = '';
  bkRoomPassword = '';

  try {
    const tDoc = await getDoc(doc(db, 'tournaments', tournamentId));
    if (!tDoc.exists()) {
      bodyEl.innerHTML = '<div class="bk-empty">Tournament not found.</div>';
      return;
    }
    bkTournament = { id: tDoc.id, ...tDoc.data() };
    titleEl.textContent = '🎯 ' + (bkTournament.title || 'Tournament');
    subEl.textContent = (bkTournament.game || '') + ' · ' + (bkTournament.date || '') + ' · ' + (bkTournament.time || '');

    let regs = [];
    const regSnap = await getDocs(query(
      collection(db, 'tournament_registrations'),
      where('tournamentId', '==', tournamentId)
    ));
    regs = regSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (regs.length === 0 && bkTournament.seedKey) {
      const regSnap2 = await getDocs(query(
        collection(db, 'tournament_registrations'),
        where('tournamentId', '==', bkTournament.seedKey)
      ));
      regs = regSnap2.docs.map(d => ({ id: d.id, ...d.data() }));
    }

    bkRegistrations = regs.sort((a, b) =>
      String(a.username || a.ign || '').localeCompare(String(b.username || b.ign || ''))
    );

    const mSnap = await getDocs(query(
      collection(db, 'matches'),
      where('tournamentId', '==', tournamentId)
    ));
    const existingMatches = mSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    existingMatches.forEach(m => {
      const p1Reg = findRegByPlayer(m.player1);
      const p2Reg = findRegByPlayer(m.player2);
      if (p1Reg) {
        bkMatches.push({
          id: 'local_' + Math.random().toString(36).slice(2, 10),
          p1RegId: p1Reg.id,
          p2RegId: p2Reg ? p2Reg.id : null,
          bye: !!m.bye
        });
        bkExistingMatchIds.push(m.id);
      }
    });

    if (existingMatches.length) {
      bkRoomId = existingMatches[0].roomId || '';
      bkRoomPassword = existingMatches[0].roomPassword || '';
      bkPublished = existingMatches.some(m => m.publishedAt);
    }

    renderBracketUI();
  } catch (e) {
    console.error('openBracketManager error:', e);
    bodyEl.innerHTML = '<div class="bk-empty">Error: ' + bkEsc(e.message) + '</div>';
  }
};

function findRegByPlayer(p) {
  if (!p) return null;
  if (p.uid) {
    const byUid = bkRegistrations.find(r => r.userId === p.uid && (r.ign || r.username) === (p.ign || p.username));
    if (byUid) return byUid;
  }
  return bkRegistrations.find(r => (r.username === p.username) || (r.ign === p.ign)) || null;
}

function renderBracketUI() {
  const bodyEl = document.getElementById('bkBody');
  const footEl = document.getElementById('bkFoot');
  if (!bodyEl || !footEl) return;

  const regCount = bkRegistrations.length;
  const matchCount = bkMatches.length;
  const assignedIds = new Set();
  bkMatches.forEach(m => {
    assignedIds.add(m.p1RegId);
    if (m.p2RegId) assignedIds.add(m.p2RegId);
  });
  const assignedCount = assignedIds.size;
  const unassignedCount = regCount - assignedCount;

  let html = `
    <div class="bk-stat-row">
      <span>Registered: <b>${regCount}</b></span>
      <span>Assigned: <b>${assignedCount}</b></span>
      <span>Unassigned: <b>${unassignedCount}</b></span>
      <span>Matches: <b>${matchCount}</b></span>
      <span>Status: <b>${bkPublished ? '✅ Published' : '⏳ Not published'}</b></span>
    </div>
  `;

  if (regCount === 0) {
    html += '<div class="bk-empty">No players registered yet. Wait for registrations first.</div>';
    bodyEl.innerHTML = html;
    footEl.innerHTML = '';
    return;
  }

  html += `<div class="bk-section-title">📋 Registered Players (${regCount})</div><div class="bk-players">`;
  bkRegistrations.forEach(r => {
    const isAssigned = assignedIds.has(r.id);
    const ign = r.ign || r.username || '—';
    const uname = r.username || '—';
    const phone = r.phone || r.payerPhone || '—';
    html += `
      <div class="bk-player-row ${isAssigned ? 'assigned' : ''}">
        <span class="bk-player-dot">${isAssigned ? '●' : '○'}</span>
        <span class="bk-player-name">${bkEsc(uname)}</span>
        <span class="bk-player-ign">${bkEsc(ign)}</span>
        <span class="bk-player-phone">${bkEsc(phone)}</span>
      </div>
    `;
  });
  html += '</div>';

  html += `<div class="bk-section-title" style="margin-top:20px;">🎯 Current Matches (${matchCount})</div>`;
  if (bkMatches.length === 0) {
    html += '<div class="bk-empty" style="padding:16px;">No matches created yet. Use the section below to add matches.</div>';
  } else {
    html += '<div class="bk-pairs">';
    bkMatches.forEach((m, i) => {
      const p1 = bkRegistrations.find(r => r.id === m.p1RegId);
      const p2 = m.p2RegId ? bkRegistrations.find(r => r.id === m.p2RegId) : null;
      if (m.bye || !p2) {
        html += `
          <div class="bk-pair bye">
            <span class="bk-pair-num">Match ${i+1}</span>
            <div class="bk-player">${bkEsc(p1?.username || '—')}<small>🎉 Bye — auto-advance</small></div>
            ${!bkPublished ? `<button class="bk-btn danger" onclick="bkRemoveMatch(${i})" style="padding:6px 12px;font-size:12px;">✕ Remove</button>` : ''}
          </div>
        `;
      } else {
        html += `
          <div class="bk-pair">
            <span class="bk-pair-num">Match ${i+1}</span>
            <div class="bk-player">${bkEsc(p1?.username || '—')}<small>${bkEsc(p1?.ign || '')} · ${bkEsc(p1?.phone || '')}</small></div>
            <span class="bk-vs">VS</span>
            <div class="bk-player">${bkEsc(p2?.username || '—')}<small>${bkEsc(p2?.ign || '')} · ${bkEsc(p2?.phone || '')}</small></div>
            ${!bkPublished ? `<button class="bk-btn danger" onclick="bkRemoveMatch(${i})" style="padding:6px 12px;font-size:12px;">✕ Remove</button>` : ''}
          </div>
        `;
      }
    });
    html += '</div>';
  }

  if (!bkPublished && unassignedCount >= 2) {
    const unassigned = bkRegistrations.filter(r => !assignedIds.has(r.id));
    const opts = unassigned.map(r =>
      `<option value="${bkEsc(r.id)}">${bkEsc(r.username || '—')} · ${bkEsc(r.ign || '')} · ${bkEsc(r.phone || '')}</option>`
    ).join('');
    html += `
      <div class="bk-section-title" style="margin-top:20px;">➕ Create Match</div>
      <div class="bk-newmatch">
        <div class="bk-newmatch-row">
          <label>Player 1</label>
          <select id="bkP1Select" onchange="bkOnP1Change()">
            <option value="">— Select player —</option>
            ${opts}
          </select>
        </div>
        <div class="bk-newmatch-row">
          <label>Player 2</label>
          <select id="bkP2Select">
            <option value="">— Select player —</option>
            ${opts}
          </select>
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;">
          <button class="bk-btn green" onclick="bkAddMatch()" style="flex:1;">➕ Add Match</button>
          <button class="bk-btn ghost" onclick="bkShuffleRemaining()" style="flex:1;">🎲 Shuffle Remaining</button>
        </div>
      </div>
    `;
  } else if (!bkPublished && unassignedCount === 1) {
    html += `
      <div class="bk-section-title" style="margin-top:20px;">➕ Remaining Player</div>
      <div class="bk-newmatch" style="text-align:center;">
        <p style="color:#a5b4fc;margin:0 0 12px;">1 player remains unassigned. They'll get a bye.</p>
        <button class="bk-btn ghost" onclick="bkAssignBye()">Mark as Bye</button>
      </div>
    `;
  }

  if (!bkPublished) {
    html += `
      <div class="bk-room-row" style="margin-top:20px;">
        <div>
          <label>Room ID (applied to all matches on publish)</label>
          <input id="bkRoomId" value="${bkEsc(bkRoomId)}" placeholder="e.g. 8842910">
        </div>
        <div>
          <label>Room Password</label>
          <input id="bkRoomPass" value="${bkEsc(bkRoomPassword)}" placeholder="e.g. nepplay">
        </div>
      </div>
    `;
  } else {
    html += `
      <div class="bk-room-row" style="margin-top:20px;">
        <div>
          <label>Room ID (published)</label>
          <input value="${bkEsc(bkRoomId)}" readonly>
        </div>
        <div>
          <label>Room Password (published)</label>
          <input value="${bkEsc(bkRoomPassword)}" readonly>
        </div>
      </div>
    `;
  }

  bodyEl.innerHTML = html;

  let footHtml = '';
  if (!bkPublished) {
    if (bkMatches.length > 0) {
      footHtml += `<button class="bk-btn danger" onclick="bkClearAll()">🗑 Clear all</button>`;
      footHtml += `<button class="bk-btn gold" onclick="bkPublish()">🚀 Publish matches</button>`;
    }
  } else {
    footHtml += `<button class="bk-btn green" disabled>✅ Published</button>`;
  }
  footEl.innerHTML = footHtml;
}

window.bkOnP1Change = function () {
  const p1 = document.getElementById('bkP1Select')?.value;
  const p2sel = document.getElementById('bkP2Select');
  if (!p2sel) return;
  const assignedIds = new Set();
  bkMatches.forEach(m => {
    assignedIds.add(m.p1RegId);
    if (m.p2RegId) assignedIds.add(m.p2RegId);
  });
  const unassigned = bkRegistrations.filter(r => !assignedIds.has(r.id));
  const curP2 = p2sel.value;
  p2sel.innerHTML = '<option value="">— Select player —</option>' +
    unassigned.filter(r => r.id !== p1).map(r =>
      `<option value="${bkEsc(r.id)}"${r.id === curP2 ? ' selected' : ''}>${bkEsc(r.username || '—')} · ${bkEsc(r.ign || '')} · ${bkEsc(r.phone || '')}</option>`
    ).join('');
};

window.bkAddMatch = function () {
  const p1 = document.getElementById('bkP1Select')?.value;
  const p2 = document.getElementById('bkP2Select')?.value;
  if (!p1 || !p2) { bkToast('⚠️ Pick both players'); return; }
  if (p1 === p2) { bkToast('⚠️ Same player picked twice'); return; }
  bkMatches.push({
    id: 'local_' + Math.random().toString(36).slice(2, 10),
    p1RegId: p1,
    p2RegId: p2,
    bye: false
  });
  renderBracketUI();
  bkToast('✅ Match added');
};

window.bkRemoveMatch = function (idx) {
  bkMatches.splice(idx, 1);
  renderBracketUI();
};

window.bkClearAll = function () {
  if (!confirm('Clear all matches? You can re-add them before publishing.')) return;
  bkMatches = [];
  renderBracketUI();
};

window.bkAssignBye = function () {
  const assignedIds = new Set();
  bkMatches.forEach(m => {
    assignedIds.add(m.p1RegId);
    if (m.p2RegId) assignedIds.add(m.p2RegId);
  });
  const remaining = bkRegistrations.filter(r => !assignedIds.has(r.id));
  if (remaining.length !== 1) { bkToast('⚠️ More than 1 unassigned'); return; }
  bkMatches.push({ id: 'local_' + Math.random().toString(36).slice(2, 10), p1RegId: remaining[0].id, p2RegId: null, bye: true });
  renderBracketUI();
  bkToast('✅ Bye assigned');
};

window.bkShuffleRemaining = function () {
  const assignedIds = new Set();
  bkMatches.forEach(m => {
    assignedIds.add(m.p1RegId);
    if (m.p2RegId) assignedIds.add(m.p2RegId);
  });
  const remaining = bkRegistrations.filter(r => !assignedIds.has(r.id));
  if (remaining.length < 2) { bkToast('⚠️ Need at least 2 unassigned'); return; }
  if (!confirm(`Shuffle ${remaining.length} unassigned players into random matches?`)) return;

  const pool = [...remaining].sort(() => Math.random() - 0.5);
  while (pool.length >= 2) {
    const p1 = pool.shift();
    const p2 = pool.shift();
    bkMatches.push({ id: 'local_' + Math.random().toString(36).slice(2, 10), p1RegId: p1.id, p2RegId: p2.id, bye: false });
  }
  if (pool.length === 1) {
    bkMatches.push({ id: 'local_' + Math.random().toString(36).slice(2, 10), p1RegId: pool[0].id, p2RegId: null, bye: true });
  }
  renderBracketUI();
  bkToast('🎲 Shuffled ' + remaining.length + ' players');
};

window.bkPublish = async function () {
  if (bkMatches.length === 0) { bkToast('⚠️ Add at least one match first'); return; }
  const roomId   = document.getElementById('bkRoomId')?.value.trim()   || '';
  const roomPass = document.getElementById('bkRoomPass')?.value.trim() || '';
  if (!roomId) { bkToast('⚠️ Enter Room ID before publishing'); return; }

  const assignedIds = new Set();
  bkMatches.forEach(m => {
    assignedIds.add(m.p1RegId);
    if (m.p2RegId) assignedIds.add(m.p2RegId);
  });
  const unassigned = bkRegistrations.filter(r => !assignedIds.has(r.id));
  if (unassigned.length > 0) {
    if (!confirm(`${unassigned.length} player(s) unassigned. They'll be skipped. Continue?`)) return;
  }
  if (!confirm('Publish matches to all players? They will see their opponent + room details immediately.')) return;

  try {
    for (const mid of bkExistingMatchIds) {
      await deleteDoc(doc(db, 'matches', mid));
    }

    let notified = 0;
    let created = 0;

    for (const m of bkMatches) {
      const p1 = bkRegistrations.find(r => r.id === m.p1RegId);
      const p2 = m.p2RegId ? bkRegistrations.find(r => r.id === m.p2RegId) : null;
      if (!p1) continue;
      if (!p2 && !m.bye) continue;

      const docRef = await addDoc(collection(db, 'matches'), {
        tournamentId:    bkTournament.id,
        tournamentTitle: bkTournament.title || '',
        game:            bkTournament.game || '',
        player1: {
          uid:      p1.userId || '',
          username: p1.username || '',
          ign:      p1.ign || p1.username || '',
          phone:    p1.phone || p1.payerPhone || ''
        },
        player2: p2 ? {
          uid:      p2.userId || '',
          username: p2.username || '',
          ign:      p2.ign || p2.username || '',
          phone:    p2.phone || p2.payerPhone || ''
        } : null,
        bye:         !!m.bye,
        roomId,
        roomPassword: roomPass,
        matchDate:   bkTournament.date || '',
        matchTime:   bkTournament.time || '',
        round:       1,
        status:      'pending',
        winner:      null,
        createdAt:   serverTimestamp(),
        publishedAt: serverTimestamp()
      });
      created++;

      const players = [p1, p2].filter(Boolean);
      for (const p of players) {
        if (!p.userId) continue;
        const opp = (p.id === p1.id) ? (p2?.ign || p2?.username || 'Opponent') : (p1?.ign || p1?.username || 'Opponent');
        await addDoc(collection(db, 'notifications'), {
          targetUid: p.userId,
          targetName: p.username || p.ign || '',
          type:      'trophy',
          title:     '🎯 Your 1v1 match is ready!',
          message:   `You vs ${opp} · Room ${roomId}${roomPass ? ' · Pass ' + roomPass : ''} · ${bkTournament.time || ''}`,
          createdBy: currentAdminEmail || 'admin',
          createdAt: serverTimestamp(),
          readBy:    []
        });
        notified++;
      }
    }

    logActivity({
      action: 'bracket_published', category: 'tournaments',
      targetId: bkTournament.id, targetType: 'tournament',
      summary: `Published ${created} matches for "${bkTournament.title || 'tournament'}" (Room ${roomId}) · ${notified} notifications`,
      metadata: { matches: created, notified, roomId }
    });

    bkToast(`🚀 Published ${created} matches · ${notified} notifications`);
    bkPublished = true;
    bkRoomId = roomId;
    bkRoomPassword = roomPass;
    await window.openBracketManager(bkTournament.id);
  } catch (e) {
    console.error('bkPublish error:', e);
    bkToast('❌ ' + e.message);
  }
};

document.addEventListener('click', (e) => {
  const ov = document.getElementById('bkOverlay');
  if (ov && ov.classList.contains('open') && e.target === ov) bkClose();
});

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

// ============================================================
// BULK APPROVE
// ============================================================
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

// ⭐ v4.9: registration cards now show mode badge (1v1 / 2v2 / squad)
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
    const payment = isPaid ? allPayments.find(p => p.id === r.paymentId) : null;
    const shotId = payment ? registerScreenshot(payment) : null;
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
          </div>
          <div class="reg-line-2">
            ${r.ign ? 'IGN: <b>' + r.ign + '</b> · ' : ''}
            ${r.phone ? '📱 ' + r.phone + ' · ' : ''}
            ${isPaid ? 'Txn: <code>' + (r.transactionId || r.txnId || '—') + '</code> · ' : ''}

            ${isPaid ? 'Rs. ' + (r.amount||0) : 'Free Entry'}
          </div>
          ${isPaid && shotId ? `
            <div class="reg-payment-preview">
              <img src="${screenshotCache[shotId]}" class="thumb" onclick="event.stopPropagation(); openShotById('${shotId}')" alt="Screenshot">
              <span class="method-tag">${(r.method||'').toUpperCase()}</span>
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
  document.getElementById('resultTotalPayout').innerText = fmtRs(p1 + p2 + p3 + topKillerPayout);
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
  const highlightUrl = (document.getElementById('resultHighlightUrl')?.value || '').trim();
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
    window.showToast('🔍 Matching usernames...');
    const u1 = await findUidByUsername(w1Name);
    const u2 = w2Name ? await findUidByUsername(w2Name) : null;
    const u3 = w3Name ? await findUidByUsername(w3Name) : null;
    const uTK = tkName ? await findUidByUsername(tkName) : null;

    const payoutRecords = [];
    payoutRecords.push({
      winnerName: w1Name,
      userId: u1?.uid || null,
      userEmail: u1?.data?.email || null,
      tournamentId: tid, tournamentTitle: tTitle,
      amount: p1, prize: p1, rank: '1', kills: w1Kills, method: w1Method,
      note: `1st place, ${w1Kills} kills`,
      status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
    });
    if (w2Name) {
      payoutRecords.push({
        winnerName: w2Name,
        userId: u2?.uid || null,
        userEmail: u2?.data?.email || null,
        tournamentId: tid, tournamentTitle: tTitle,
        amount: p2, prize: p2, rank: '2', kills: w2Kills, method: w2Method,
        note: `2nd place, ${w2Kills} kills`,
        status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    }
    if (w3Name) {
      payoutRecords.push({
        winnerName: w3Name,
        userId: u3?.uid || null,
        userEmail: u3?.data?.email || null,
        tournamentId: tid, tournamentTitle: tTitle,
        amount: p3, prize: p3, rank: '3', kills: w3Kills, method: w3Method,
        note: `3rd place, ${w3Kills} kills`,
        status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    }
    const sameAsFirst = !tkName || (tkName.toLowerCase() === w1Name.toLowerCase());
    if (!sameAsFirst && killsPrize > 0) {
      payoutRecords.push({
        winnerName: tkName,
        userId: uTK?.uid || null,
        userEmail: uTK?.data?.email || null,
        tournamentId: tid, tournamentTitle: tTitle,
        amount: killsPrize, prize: killsPrize, rank: 'Top Killer', kills: tkKills, method: tkMethod,
        note: `Top killer, ${tkKills} kills`,
        status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    } else if (sameAsFirst && killsPrize > 0 && w1Kills > 0) {
      payoutRecords[0].amount = p1 + killsPrize;
      payoutRecords[0].prize = p1 + killsPrize;
      payoutRecords[0].note = `1st place + Top Killer, ${w1Kills} kills`;
      payoutRecords[0].rank = '1 + Top Killer';
    }
    for (const rec of payoutRecords) {
      await addDoc(collection(db, 'tournament_payouts'), rec);
    }
    await addDoc(collection(db, 'match_results'), {
      tournamentId: tid, tournamentTitle: tTitle,
      winner1: { name: w1Name, kills: w1Kills, prize: p1, method: w1Method, userId: u1?.uid || null },
      winner2: w2Name ? { name: w2Name, kills: w2Kills, prize: p2, method: w2Method, userId: u2?.uid || null } : null,
      winner3: w3Name ? { name: w3Name, kills: w3Kills, prize: p3, method: w3Method, userId: u3?.uid || null } : null,
      topKiller: sameAsFirst
        ? { name: w1Name, kills: w1Kills, prize: killsPrize, sameAsFirst: true }
        : { name: tkName, kills: tkKills, prize: killsPrize, method: tkMethod, userId: uTK?.uid || null },
      highlightUrl: highlightUrl || null,
      totalPayouts: payoutRecords.reduce((s, p) => s + p.amount, 0),
      completedAt: serverTimestamp(), createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'tournaments', tid), { status: 'completed', completedAt: serverTimestamp() });

    const unmatched = payoutRecords.filter(p => !p.userId).map(p => p.winnerName);
    if (unmatched.length) {
      window.showToast(`⚠️ Saved. Could NOT match UID for: ${unmatched.join(', ')}`);
    } else {
      window.showToast('✅ Results saved + UIDs matched!');
    }

    addNotif('result', '🏆 Match completed', `${tTitle} — ${w1Name} won 1st place`);
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
  ['winner1Name','winner1Kills','winner2Name','winner2Kills','winner3Name','winner3Kills','topKillerName','topKillerKills','resultHighlightUrl'].forEach(id => {
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
      const hasUid = !!w.userId;
      return `
        <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'} clickable-row" onclick="openPayoutDetail('${w.id}')">
          <div class="reg-icon">🏆</div>
          <div class="reg-main">
            <div class="reg-line-1">
              <b>${w.winnerName || 'Unknown'}</b>
              <span class="reg-sep">—</span>
              <span class="reg-tournament">${w.tournamentTitle || 'Tournament'}</span>
              ${hasUid ? '<span class="tourney-count" style="background:rgba(34,197,94,0.15);border-color:rgba(34,197,94,0.4);color:#4ade80;">🔗 linked</span>' : '<span class="tourney-count" style="background:rgba(234,179,8,0.15);border-color:rgba(234,179,8,0.4);color:#fbbf24;">⚠️ no UID</span>'}
            </div>
            <div class="reg-line-2">🥇 ${w.rank || '—'}${w.kills ? ' · ' + w.kills + ' kills' : ''} · ${fmtRs(w.amount || w.prize || 0)}${w.method ? ' · ' + w.method : ''}${w.note ? ' · ' + w.note : ''}</div>
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
    window.showToast('🔍 Matching user...');
    const found = await findUidByUsername(winnerName);
    await addDoc(collection(db, 'tournament_payouts'), {
      winnerName, tournamentTitle, amount, prize: amount,
      userId: found?.uid || null,
      userEmail: found?.data?.email || null,
      rank: rank || '1', method: method || 'cash', note: note || '',
      status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
    });
    window.showToast(found ? '✅ Payout recorded + UID linked' : '⚠️ Payout recorded (no UID match)');
    window.loadPayouts();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

window.backfillPayoutUserIds = async function() {
  if (!confirm('Backfill userId on all tournament_payouts missing it?')) return;
  const snap = await getDocs(collection(db, 'tournament_payouts'));
  const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const missing = all.filter(p => !p.userId);
  if (!missing.length) { window.showToast('✅ All payouts already have userId'); return; }
  let ok = 0, fail = 0;
  for (const p of missing) {
    try {
      const found = await findUidByUsername(p.winnerName);
      if (found) {
        await updateDoc(doc(db, 'tournament_payouts', p.id), {
          userId: found.uid, userEmail: found.data?.email || null
        });
        ok++;
      } else fail++;
    } catch (e) { fail++; }
  }
  window.showToast(`✅ Backfilled ${ok} · ⚠️ ${fail} unmatched`);
  await window.loadPayouts();
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
  const previousValue = select.value;
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    roomTournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    select.innerHTML = '<option value="">— Select tournament —</option>' +
      roomTournaments.map(t =>
        `<option value="${t.id}"${t.id === previousValue ? ' selected' : ''}>${t.title || 'Untitled'} (${t.game || 'Game'})</option>`
      ).join('');
  } catch (err) { console.warn('loadRoomDetailsForm fetch failed:', err); return; }
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
    loadLiveStats();
    if (document.getElementById('notifTarget')) renderNotificationTargetOptions();
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};
window.filterUsers = function() { renderUsers(); };
function renderUsers() {
  const list = document.getElementById('userList');
  if (!list) return;
  const q = (document.getElementById('userSearch').value || '').toLowerCase();
  let filtered = allUsers.filter(u => !q || `${u.username||''} ${u.email||''} ${u.phone||''}`.toLowerCase().includes(q));
  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">👥</span>No users.</div>';
    return;
  }
  list.innerHTML = filtered.map(u => `
    <div class="reg-card free-reg clickable-row" onclick="openUserDetail('${u.id}')">
      <div class="reg-icon">${initials(u.username)}</div>
      <div class="reg-main">
        <div class="reg-line-1"><b>${u.username || 'Unknown'}</b>${u.role === 'admin' ? '<span class="type-chip paid" style="margin-left:8px;">ADMIN</span>' : ''}</div>
        <div class="reg-line-2">📧 ${u.email || '—'}${u.phone ? ' · 📱 ' + u.phone : ''}</div>
      </div>
      <div class="reg-right">
        <span class="type-chip free">${u.role === 'admin' ? 'Admin' : 'Member'}</span>
        <small>${fmtDate(u.createdAt)}</small>
      </div>
    </div>
  `).join('');
}
window.deleteUser = async function(uid, username, fromModal) {
  if (fromModal) closeDetailModal();
  const confirmText = prompt(`Delete user "${username}"? Type DELETE to confirm:`);
  if (confirmText !== 'DELETE') return;
  try {
    await deleteDoc(doc(db, 'users', uid));
    window.showToast(`🗑️ Deleted user "${username}"`);
    await window.loadUsers();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// CSV EXPORTS
// ============================================================
function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(cell => {
    const s = String(cell == null ? '' : cell);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  window.showToast('✅ Downloaded ' + filename);
}
window.exportUsersCSV = function() {
  if (!allUsers.length) { window.showToast('❌ No users to export'); return; }
  const rows = [['Username','Email','Phone','Role','User ID','Joined']];
  allUsers.forEach(u => {
    rows.push([
      u.username || '', u.email || '', u.phone || '', u.role || 'member', u.id,
      u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : ''
    ]);
  });
  downloadCSV(`nepplay-users-${todayKey()}.csv`, rows);
};
window.exportRegistrationsCSV = function() {
  if (!allRegs.length) { window.showToast('❌ No registrations to export'); return; }
  const rows = [['Username','Email','IGN','Phone','Tournament','Mode','Entry Type','Amount','Txn ID','Method','Status','Registered']];
  allRegs.forEach(r => {
    rows.push([
      r.username || '', r.email || '', r.ign || '', r.phone || '', r.tournamentTitle || '',
      r.playingAs || r.mode || '',
      r.entryType || '', r.amount || 0, r.txnId || '', r.method || '', r.status || '',
      r.registeredAt?.toDate ? r.registeredAt.toDate().toISOString() : ''
    ]);
  });
  downloadCSV(`nepplay-registrations-${todayKey()}.csv`, rows);
};
window.exportPaymentsCSV = function() {
  if (!allPayments.length) { window.showToast('❌ No payments to export'); return; }
  const rows = [['Username','Email','IGN','Phone','Tournament','Amount','Txn ID','Method','Status','Admin Note','Submitted','Reviewed']];
  allPayments.forEach(p => {
    rows.push([
      p.username || '', p.email || '', p.ign || '', p.phone || '', p.tournamentTitle || '',
      p.amount || 0, p.txnId || '', p.method || '', p.status || '', p.adminNote || '',
      p.submittedAt?.toDate ? p.submittedAt.toDate().toISOString() : '',
      p.reviewedAt?.toDate ? p.reviewedAt.toDate().toISOString() : ''
    ]);
  });
  downloadCSV(`nepplay-payments-${todayKey()}.csv`, rows);
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
    const counts = {};
    allRegs.forEach(r => {
      if (!r.tournamentId) return;
      if (!counts[r.tournamentId]) counts[r.tournamentId] = { total: 0, confirmed: 0, pending: 0 };
      counts[r.tournamentId].total++;
      if (r.status === 'confirmed') counts[r.tournamentId].confirmed++;
      else if (r.status === 'pending') counts[r.tournamentId].pending++;
    });
    if (!allTournaments.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">🏆</span>No tournaments.</div>';
      return;
    }
    list.innerHTML = allTournaments.map(t => {
      const entryTypeRaw = (t.entryType || t.entry_type || 'free').toLowerCase();
      const feeValue = Number(t.entryFee || t.entry_fee || 0);
      const isPaid = entryTypeRaw === 'paid' || feeValue > 0;
      const isCompleted = (t.status || '').toLowerCase() === 'completed';
      const tTitle = String(t.title || '').toLowerCase();
      const is1v1 = String(t.mode || '').toLowerCase() === '1v1'
                    || tTitle.includes('1v1') || tTitle.includes('1 vs 1') || tTitle.includes('1vs1');
      const safeTitle = (t.title || 'Untitled').replace(/'/g, "\\'");
      const c = counts[t.id] || { total: 0, confirmed: 0, pending: 0 };
      return `
        <div class="reg-card ${isCompleted ? 'free-reg' : (isPaid ? 'paid-reg' : 'free-reg')}">
          <div class="reg-icon">${isCompleted ? '✅' : (isPaid ? '💵' : '🏆')}</div>
          <div class="reg-main">
            <div class="reg-line-1">
              <b>${t.title || 'Untitled'}</b>
              <span class="tourney-count">📋 ${c.total}</span>
            </div>
            <div class="reg-line-2">${t.game || 'Game'} · ${t.mode || 'Solo'}${t.date ? ' · 📅 ' + t.date : ''}${t.time ? ' · 🕐 ' + t.time : ''}${isPaid ? ' · 💰 Rs. ' + (t.entryFee || t.entry_fee || 0) : ' · FREE'}</div>
            <div class="reg-actions">
              ${is1v1 ? `<button class="btn-edit small" style="background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#1a0b3d;font-weight:900;" onclick="openBracketManager('${t.id}')">🎯 Manage Bracket</button>` : ''}
              ${!isCompleted ? `<button class="btn-edit small" onclick="editTournament('${t.id}')">✏️ Edit</button>` : ''}
              <button class="btn-delete small" onclick="deleteTournament('${t.id}','${safeTitle}')">🗑️ Delete</button>
            </div>
          </div>
          <div class="reg-right">
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
// ANNOUNCEMENTS
// ============================================================
window.loadAnnouncements = async function() {
  const list = document.getElementById('announcementList');
  if (!list) return;
  list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
  try {
    const snap = await getDocs(collection(db, 'announcements'));
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    items.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (!items.length) {
      list.innerHTML = '<div class="empty-state"><span class="icon">📢</span>No announcements yet</div>';
      return;
    }
    list.innerHTML = items.map(a => {
      const safeTitle = String(a.title || '').replace(/'/g, "\\'").slice(0, 60);
      return `
        <div class="reg-card free-reg">
          <div class="reg-icon">📢</div>
          <div class="reg-main">
            <div class="reg-line-1"><b>${a.title || 'Untitled'}</b></div>
            <div class="reg-line-2">${a.message || ''}</div>
            <div class="reg-actions" style="margin-top:8px;">
              <button class="btn-delete small" onclick="deleteAnnouncement('${a.id}','${safeTitle}')">🗑️ Delete</button>
            </div>
          </div>
          <div class="reg-right"><small>${fmtDate(a.createdAt)}</small></div>
        </div>
      `;
    }).join('');
  } catch (err) {
    list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + err.message + '</div>';
  }
};

window.deleteAnnouncement = async function(id, title) {
  if (!confirm(`Delete announcement "${title}"?\n\nThis action cannot be undone.`)) return;
  try {
    await deleteDoc(doc(db, 'announcements', id));
    window.showToast('🗑️ Announcement deleted');
    await window.loadAnnouncements();
  } catch (err) {
    console.error('deleteAnnouncement error:', err);
    window.showToast('❌ ' + err.message);
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
      <div class="reg-card free-reg clickable-row" onclick="openUserDetail('${u.id}')">
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
            </div>
            <div class="reg-line-2">${isPaid ? 'Rs. ' + (r.amount||0) : 'Free Entry'}</div>
          </div>
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
  const t = {
    approve: { title: '✔ Approve', btn: '✔ Confirm Approve', cls: 'btn-primary green', desc: 'Approve ' + name + '?' },
    reject:  { title: '❌ Reject',  btn: '✘ Confirm Reject',  cls: 'btn-primary red',   desc: 'Reject ' + name + '?' },
    reset:   { title: '↺ Reset',   btn: '↺ Confirm Reset',   cls: 'btn-primary',       desc: 'Reset ' + name + ' to PENDING?' }
  }[action] || { title:'Confirm', btn:'Confirm', cls:'btn-primary', desc:'Confirm?' };
  document.getElementById('reviewTitle').innerText = t.title;
  document.getElementById('reviewDesc').innerHTML = '<b>' + name + '</b> — ' + t.desc;
  const btn = document.getElementById('reviewConfirmBtn');
  btn.className = t.cls;
  btn.innerText = t.btn;
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
  let status, regStatus;
  if (action === 'approve') { status = 'approved'; regStatus = 'confirmed'; }
  else if (action === 'reject') { status = 'rejected'; regStatus = 'rejected'; }
  else if (action === 'reset') { status = 'pending'; regStatus = 'pending'; }
  else return;
  try {
    if (type === 'payment') {
      await updateDoc(doc(db, 'tournament_payments', id), {
        status, adminNote: note, reviewedAt: serverTimestamp()
      });
      const regSnap = await getDocs(query(collection(db, 'tournament_registrations'), where('paymentId', '==', id)));
      for (const d of regSnap.docs) {
        await updateDoc(doc(db, 'tournament_registrations', d.id), { status: regStatus });
      }
      if (action === 'approve') {
        await handleReferralBonus(id);
        await loadReferralBonuses();
      }
    } else {
      await updateDoc(doc(db, 'tournament_registrations', id), { status: regStatus });
    }
    closeReview();
    const actionLabel = action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Reset to pending';
    window.showToast('✅ ' + actionLabel);
    window.loadPayments();
    window.loadRegistrations();
  } catch (err) { window.showToast('❌ ' + err.message); }
};

// ============================================================
// LIGHTBOX + TOAST
// ============================================================
window.openShotById = function(id) {
  const src = screenshotCache[id];
  if (!src) { window.showToast('❌ Screenshot not available'); return; }
  document.getElementById('shotFull').src = src;
  document.getElementById('shotModal').classList.add('active');
};
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
