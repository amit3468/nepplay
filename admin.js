// ==========================================================
// NEPPLAY — admin.js (v4.3)
// + Activity feed (#6)
// ==========================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, doc, updateDoc, deleteDoc, getDoc,
  addDoc, query, where, serverTimestamp, onSnapshot
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

// Initialize activity module with the same Firebase instances
initActivity(db, auth);

// Expose activity loaders to the HTML sidebar loader map
window.loadActivityFeed = loadActivityFeed;
window.loadActivityPage = loadActivityPage;

console.log("🔥 Admin v4.3 — awaiting auth");

// ============================================================
// ADMIN EMAIL (for password-only login)
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
    if (!userDoc.exists()) {
      console.warn('⛔ No users doc — access denied');
      return false;
    }
    const data = userDoc.data();
    if (data.role !== 'admin') {
      console.warn('⛔ role is not admin — access denied');
      return false;
    }
    currentAdminEmail = user.email || data.email || '—';
    return true;
  } catch (err) {
    console.error('Admin verify failed:', err);
    return false;
  }
}

onAuthStateChanged(auth, async (user) => {
  console.log('👤 Auth state:', user ? user.email : 'signed out');
  if (!user) {
    showGatePanel('adminLoginForm');
    return;
  }
  showGatePanel('adminLoadingMsg');
  const ok = await verifyAdminAndBoot(user);
  if (!ok) {
    showGatePanel('adminDeniedMsg');
    return;
  }
  document.getElementById('auth-gate').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  document.getElementById('adminEmailDisplay').textContent = 'Admin';
  console.log('✅ Admin access granted:', currentAdminEmail);
  logActivity({
    action: 'admin_login',
    category: 'system',
    summary: `Admin logged in (${currentAdminEmail})`,
    metadata: { email: currentAdminEmail }
  });
  if (!bootstrapped) {
    bootstrapped = true;
    await bootstrapAdminPanel();
  }
});

// ============================================================
// PASSWORD-ONLY LOGIN
// ============================================================
window.handleAdminLogin = async function(e) {
  e.preventDefault();
  const btn = document.getElementById('adminLoginBtn');
  const msg = document.getElementById('adminLoginMsg');
  const password = document.getElementById('adminPassword').value;

  if (!password) {
    msg.style.display = 'block';
    msg.style.color = '#f87171';
    msg.textContent = '❌ Password required';
    return;
  }

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

window.adminSignOut = async function() {
  await signOut(auth);
};

window.adminLogout = async function() {
  if (!confirm('Logout?')) return;
  try {
    await signOut(auth);
    window.location.reload();
  } catch (err) {
    console.error('Logout error:', err);
    window.location.reload();
  }
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
function dayKey(ts) {
  if (!ts?.toDate) return null;
  return ts.toDate().toISOString().slice(0,10);
}
function todayKey() { return new Date().toISOString().slice(0,10); }
function initials(n) { return (n || 'U')[0].toUpperCase(); }
function fmtRs(n) { return 'Rs. ' + (Number(n) || 0).toLocaleString(); }
function escapeDetail(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
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
// NOTIFICATIONS
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
// REFERRAL BONUSES — CORE LOGIC
// ============================================================
const REFERRAL_BONUS_AMOUNT = 20;

async function handleReferralBonus(paymentId) {
  try {
    const paySnap = await getDoc(doc(db, 'tournament_payments', paymentId));
    if (!paySnap.exists()) {
      console.warn('handleReferralBonus: payment not found', paymentId);
      return;
    }
    const payment = paySnap.data();
    const payerUid = payment.userId;
    if (!payerUid) return;

    const dupSnap = await getDocs(query(
      collection(db, 'referral_bonuses'),
      where('referredPaymentId', '==', paymentId)
    ));
    if (!dupSnap.empty) {
      console.log('Referral bonus already exists for payment', paymentId);
      return;
    }

    const payerDoc = await getDoc(doc(db, 'users', payerUid));
    if (!payerDoc.exists()) return;
    const payer = payerDoc.data();
    const referrerUid = payer.referredBy;
    if (!referrerUid) {
      console.log('Payer was not referred — no bonus created');
      return;
    }

    const refDoc = await getDoc(doc(db, 'users', referrerUid));
    const referrer = refDoc.exists() ? refDoc.data() : {};

    await addDoc(collection(db, 'referral_bonuses'), {
      referrerUid: referrerUid,
      referrerName: referrer.username || referrer.fullName || 'Unknown',
      referrerEmail: referrer.email || '',
      referredUid: payerUid,
      referredName: payer.username || payer.fullName || 'Unknown',
      referredEmail: payer.email || '',
      referredIgn: payment.ign || '',
      referredPhone: payment.phone || '',
      referredPaymentId: paymentId,
      tournamentId: payment.tournamentId || '',
      tournamentTitle: payment.tournamentTitle || '',
      paymentMethod: payment.method || '',
      txnId: payment.txnId || '',
      amount: REFERRAL_BONUS_AMOUNT,
      status: 'pending',
      createdAt: serverTimestamp(),
      paidAt: null,
      adminNote: ''
    });

    logActivity({
      action: 'referral_credited',
      category: 'referrals',
      targetId: payerUid,
      targetType: 'user',
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

    console.log(`✅ Referral bonus created: ${referrerUid} → ${payerUid}`);
  } catch (err) {
    console.error('handleReferralBonus error:', err);
  }
}

// ============================================================
// REFERRAL BONUSES — LOAD / RENDER
// ============================================================
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
  } catch (err) {
    console.warn('loadReferralBonuses error:', err);
  }
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
    list.innerHTML = `
      <div class="empty-state">
        <span class="icon">🤝</span>
        No referral bonuses yet. Bonuses appear here when a referred member joins a paid tournament.
      </div>
    `;
    return;
  }

  if (!filtered.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="icon">🔍</span>
        No referral bonuses match your filter.
      </div>
    `;
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

          ${b.referredEmail ? `<div class="reg-line-2">📧 ${escapeDetail(b.referredEmail)}${b.referredPhone ? ' · 📱 ' + escapeDetail(b.referredPhone) : ''}${b.referredIgn ? ' · 🎮 ' + escapeDetail(b.referredIgn) : ''}</div>` : ''}

          <div class="reg-line-2">
            🏆 ${escapeDetail(b.tournamentTitle || 'Paid tournament')}
            · 💰 <b style="color:#fbbf24;">${fmtRs(b.amount || REFERRAL_BONUS_AMOUNT)}</b>
            ${b.paymentMethod ? ' · 💳 ' + escapeDetail(b.paymentMethod).toUpperCase() : ''}
            ${b.txnId ? ' · 🔖 <code>' + escapeDetail(b.txnId) + '</code>' : ''}
          </div>

          <div class="reg-line-2" style="font-size:11px;color:#6b7280;">
            🕐 ${fmtShort(b.createdAt)}
            ${b.referrerUid ? ' · 🔗 referrer: <code>' + escapeDetail(b.referrerUid).slice(0,8) + '...</code>' : ''}
          </div>

          ${isPaid && b.paidAt ? `<div class="reg-line-2" style="color:#4ade80;">✅ Paid ${fmtShort(b.paidAt)}${b.adminNote ? ' · ' + escapeDetail(b.adminNote) : ''}</div>` : ''}
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
  if (!confirm(`Mark this referral bonus as paid to ${referrerName}?\n\nMake sure you've actually sent Rs. ${REFERRAL_BONUS_AMOUNT} via eSewa/Khalti first.`)) return;
  try {
    await updateDoc(doc(db, 'referral_bonuses', bonusId), {
      status: 'paid',
      paidAt: serverTimestamp(),
      adminNote: 'Manually marked paid by admin'
    });
    logActivity({
      action: 'referral_marked_paid',
      category: 'referrals',
      targetId: bonusId,
      targetType: 'referral_bonus',
      summary: `Referral bonus paid to ${referrerName} (Rs. ${REFERRAL_BONUS_AMOUNT})`,
      metadata: { referrerName, amount: REFERRAL_BONUS_AMOUNT }
    });
    window.showToast('✅ Referral bonus marked as paid');
    await loadReferralBonuses();
  } catch (err) {
    console.error('markReferralPaid error:', err);
    window.showToast('❌ ' + err.message);
  }
};

window.exportReferralsCSV = function() {
  if (!allReferralBonuses.length) {
    window.showToast('❌ No referral bonuses to export');
    return;
  }
  const rows = [['Referrer','Referrer Email','Referred','Referred Email','Referred IGN','Referred Phone','Tournament','Payment Method','Txn ID','Amount','Status','Created','Paid At','Note']];
  allReferralBonuses.forEach(b => {
    rows.push([
      b.referrerName || '',
      b.referrerEmail || '',
      b.referredName || '',
      b.referredEmail || '',
      b.referredIgn || '',
      b.referredPhone || '',
      b.tournamentTitle || '',
      b.paymentMethod || '',
      b.txnId || '',
      b.amount || 0,
      b.status || '',
      b.createdAt?.toDate ? b.createdAt.toDate().toISOString() : '',
      b.paidAt?.toDate ? b.paidAt.toDate().toISOString() : '',
      b.adminNote || ''
    ]);
  });
  downloadCSV(`nepplay-referrals-${todayKey()}.csv`, rows);
};

// ============================================================
// LIVE STATS BAR
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
}

setInterval(() => {
  if (document.getElementById('admin-panel')?.style.display === 'block') {
    loadLiveStats();
  }
}, 30000);

// ============================================================
// DETAIL MODAL — Users
// ============================================================
window.closeDetailModal = function() {
  document.getElementById('detailModal').classList.remove('open');
};

window.openUserDetail = function(uid) {
  if (!uid) return;
  const u = allUsers.find(x => x.id === uid);
  if (!u) {
    window.showToast('❌ User not found — may have been deleted');
    return;
  }
  const myRegs = allRegs.filter(r => r.userId === uid);
  const myPays = allPayments.filter(p => p.userId === uid);
  const myPayouts = allPayouts.filter(p =>
    (p.userId && p.userId === uid) ||
    (p.winnerName && u.username && p.winnerName.toLowerCase() === u.username.toLowerCase())
  );
  const myReferrals = allReferralBonuses.filter(b => b.referrerUid === uid);
  const referredMe = u.referredBy ? allUsers.find(x => x.id === u.referredBy) : null;

  const totalSpent = myPays.filter(p => p.status === 'approved').reduce((s,p) => s + (Number(p.amount)||0), 0);
  const totalWon = myPayouts.filter(p => p.status === 'paid').reduce((s,p) => s + (Number(p.amount)||0), 0);
  const totalReferralEarnings = myReferrals.reduce((s,b) => s + Number(b.amount || 0), 0);

  const regsHtml = myRegs.length
    ? myRegs.map(r => `
      <div class="dm-row">
        <span class="dm-k">${escapeDetail(r.tournamentTitle || 'Tournament')}</span>
        <span class="dm-v">${r.entryType === 'paid' ? 'Rs. ' + (r.amount||0) : 'FREE'} · ${(r.status||'').toUpperCase()}</span>
      </div>
    `).join('')
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
      ${referredMe ? `<div class="dm-row"><span class="dm-k">🔗 Referred by</span><span class="dm-v"><a href="javascript:void(0)" onclick="closeDetailModal(); openUserDetail('${referredMe.id}')" style="color:#a5b4fc;text-decoration:none;font-weight:700;">${escapeDetail(referredMe.username || referredMe.email || 'Unknown')} →</a></span></div>` : ''}
    </div>

    <div class="dm-section">
      <h3>📊 Activity Summary</h3>
      <div class="dm-rows">
        <div class="dm-row"><span class="dm-k">Registrations</span><span class="dm-v">${myRegs.length}</span></div>
        <div class="dm-row"><span class="dm-k">Payments submitted</span><span class="dm-v">${myPays.length}</span></div>
        <div class="dm-row"><span class="dm-k">💰 Total spent (approved)</span><span class="dm-v" style="color:#fbbf24;">${fmtRs(totalSpent)}</span></div>
        <div class="dm-row"><span class="dm-k">🏆 Total won (paid)</span><span class="dm-v" style="color:#4ade80;">${fmtRs(totalWon)}</span></div>
        <div class="dm-row"><span class="dm-k">🤝 Referral earnings</span><span class="dm-v" style="color:#c084fc;">${fmtRs(totalReferralEarnings)} (${myReferrals.length})</span></div>
      </div>
    </div>

    <div class="dm-section">
      <h3>📋 Registrations</h3>
      <div class="dm-rows">${regsHtml}</div>
    </div>

    <div class="dm-actions">
      <button class="dm-btn-ghost" onclick="closeDetailModal()">Close</button>
      ${u.role === 'admin' ? '' : `<button class="dm-btn-danger" onclick="deleteUser('${u.id}','${(u.username||'').replace(/'/g,"\\'")}',true)">🗑️ Delete User</button>`}
    </div>
  `;
  document.getElementById('detailModal').classList.add('open');
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
    <h2>📋 ${escapeDetail(r.tournamentTitle || 'Registration')}</h2>
    <p class="dm-sub">Registered by ${escapeDetail(r.username || 'Unknown')} · ${fmtDate(r.registeredAt)}</p>
    <div class="dm-rows">
      <div class="dm-row"><span class="dm-k">👤 Username</span><span class="dm-v">${escapeDetail(r.username || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">📧 Email</span><span class="dm-v">${escapeDetail(r.email || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">🎮 IGN</span><span class="dm-v">${escapeDetail(r.ign || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">📱 Phone</span><span class="dm-v">${escapeDetail(r.phone || '—')}</span></div>
      <div class="dm-row"><span class="dm-k">💰 Type</span><span class="dm-v">${isPaid ? 'PAID' : 'FREE'}</span></div>
      ${isPaid ? `<div class="dm-row"><span class="dm-k">💵 Amount</span><span class="dm-v" style="color:#fbbf24;">Rs. ${r.amount || 0}</span></div>` : ''}
      ${isPaid ? `<div class="dm-row"><span class="dm-k">🔖 Txn ID</span><span class="dm-v"><code>${escapeDetail(r.txnId || '—')}</code></span></div>` : ''}
      ${isPaid ? `<div class="dm-row"><span class="dm-k">💳 Method</span><span class="dm-v">${(r.method || '—').toUpperCase()}</span></div>` : ''}
      <div class="dm-row"><span class="dm-k">📋 Status</span><span class="dm-v" style="color:${r.status === 'confirmed' ? '#4ade80' : (r.status === 'pending' ? '#fbbf24' : '#f87171')};">${(r.status || '').toUpperCase()}</span></div>
      ${r.streamUrl ? `<div class="dm-row"><span class="dm-k">🔴 Stream URL</span><span class="dm-v"><a href="${escapeDetail(r.streamUrl)}" target="_blank" style="color:#f87171;">Watch →</a></span></div>` : ''}
    </div>

    ${isPaid && payment ? `
      <div class="dm-section">
        <h3>💳 Payment Details</h3>
        <div class="dm-rows">
          <div class="dm-row"><span class="dm-k">Payment status</span><span class="dm-v">${(payment.status || '').toUpperCase()}</span></div>
          <div class="dm-row"><span class="dm-k">Submitted</span><span class="dm-v">${fmtDate(payment.submittedAt)}</span></div>
          ${payment.reviewedAt ? `<div class="dm-row"><span class="dm-k">Reviewed</span><span class="dm-v">${fmtDate(payment.reviewedAt)}</span></div>` : ''}
          ${payment.adminNote ? `<div class="dm-row"><span class="dm-k">Admin note</span><span class="dm-v">${escapeDetail(payment.adminNote)}</span></div>` : ''}
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
    console.log("✅ Created tournament:", docRef.id);
    logActivity({
      action: 'tournament_created',
      category: 'tournaments',
      targetId: docRef.id,
      targetType: 'tournament',
      summary: `Created tournament "${title}" (${game} · ${mode})`,
      metadata: { title, game, mode, entryType }
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
      date: newDate.trim(), time: newTime.trim(),
      max: Number(newMax) || 100,
      updatedAt: serverTimestamp()
    });
    logActivity({
      action: 'tournament_updated',
      category: 'tournaments',
      targetId: id,
      targetType: 'tournament',
      summary: `Updated tournament "${newTitle.trim()}"`,
      metadata: { title: newTitle.trim() }
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
  if (!confirm(`Delete tournament "${title}"?`)) return;
  try {
    await deleteDoc(doc(db, 'tournaments', id));
    logActivity({
      action: 'tournament_deleted',
      category: 'tournaments',
      targetId: id,
      targetType: 'tournament',
      summary: `Deleted tournament "${title}"`,
      metadata: { title }
    });
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
          ${isApproved ? `<button class="btn-reject small" onclick="openReview('${p.id}','${safeName}','reset','payment')">↺ Reset to Pending</button>` : ''}
          ${isRejected ? `
            <button class="btn-approve small" onclick="openReview('${p.id}','${safeName}','approve','payment')">✔ Re-approve</button>
            <button class="btn-reject small" onclick="openReview('${p.id}','${safeName}','reset','payment')">↺ Reset to Pending</button>
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
  if (!confirm(`Approve ${ids.length} payment${ids.length !== 1 ? 's' : ''}? This will confirm the related registrations.`)) return;

  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      await updateDoc(doc(db, 'tournament_payments', id), {
        status: 'approved',
        adminNote: 'Bulk approved',
        reviewedAt: serverTimestamp()
      });
      const regSnap = await getDocs(query(
        collection(db, 'tournament_registrations'),
        where('paymentId', '==', id)
      ));
      for (const d of regSnap.docs) {
        await updateDoc(doc(db, 'tournament_registrations', d.id), { status: 'confirmed' });
      }
      await handleReferralBonus(id);
      ok++;
    } catch (e) {
      console.error('Bulk approve failed for', id, e);
      fail++;
    }
  }
  selectedPaymentIds.clear();
  const selAll = document.getElementById('paySelectAll');
  if (selAll) selAll.checked = false;
  logActivity({
    action: 'payment_bulk_approved',
    category: 'payments',
    summary: `Bulk approved ${ok} payment${ok !== 1 ? 's' : ''}${fail ? ` · ${fail} failed` : ''}`,
    metadata: { ok, fail }
  });
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
    return `
      <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'} clickable-row" onclick="openRegDetail('${r.id}')">
        <div class="reg-icon">${isPaid ? '💵' : '🏆'}</div>
        <div class="reg-main">
          <div class="reg-line-1"><b>${r.username || 'Unknown'}</b><span class="reg-sep">—</span><span class="reg-tournament">${r.tournamentTitle || 'Tournament'}</span></div>
          <div class="reg-line-2">
            ${r.ign ? 'IGN: <b>' + r.ign + '</b> · ' : ''}
            ${r.phone ? '📱 ' + r.phone + ' · ' : ''}
            ${isPaid ? 'Txn: <code>' + (r.txnId||'—') + '</code> · ' : ''}
            ${isPaid ? 'Rs. ' + (r.amount||0) : 'Free Entry'}
            ${r.streamUrl ? ' · <a href="' + r.streamUrl + '" target="_blank" style="color:#f87171; text-decoration:none;">🔴 Live</a>' : ''}
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
    const payoutRecords = [];
    payoutRecords.push({
      winnerName: w1Name, tournamentId: tid, tournamentTitle: tTitle,
      amount: p1, prize: p1, rank: '1', kills: w1Kills, method: w1Method,
      note: `1st place, ${w1Kills} kills`,
      status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
    });
    if (w2Name) {
      payoutRecords.push({
        winnerName: w2Name, tournamentId: tid, tournamentTitle: tTitle,
        amount: p2, prize: p2, rank: '2', kills: w2Kills, method: w2Method,
        note: `2nd place, ${w2Kills} kills`,
        status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    }
    if (w3Name) {
      payoutRecords.push({
        winnerName: w3Name, tournamentId: tid, tournamentTitle: tTitle,
        amount: p3, prize: p3, rank: '3', kills: w3Kills, method: w3Method,
        note: `3rd place, ${w3Kills} kills`,
        status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
      });
    }
    const sameAsFirst = !tkName || (tkName.toLowerCase() === w1Name.toLowerCase());
    if (!sameAsFirst && killsPrize > 0) {
      payoutRecords.push({
        winnerName: tkName, tournamentId: tid, tournamentTitle: tTitle,
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
      winner1: { name: w1Name, kills: w1Kills, prize: p1, method: w1Method },
      winner2: w2Name ? { name: w2Name, kills: w2Kills, prize: p2, method: w2Method } : null,
      winner3: w3Name ? { name: w3Name, kills: w3Kills, prize: p3, method: w3Method } : null,
      topKiller: sameAsFirst
        ? { name: w1Name, kills: w1Kills, prize: killsPrize, sameAsFirst: true }
        : { name: tkName, kills: tkKills, prize: killsPrize, method: tkMethod },
      highlightUrl: highlightUrl || null,
      totalPayouts: payoutRecords.reduce((s, p) => s + p.amount, 0),
      completedAt: serverTimestamp(), createdAt: serverTimestamp()
    });
    await updateDoc(doc(db, 'tournaments', tid), { status: 'completed', completedAt: serverTimestamp() });
    logActivity({
      action: 'results_submitted',
      category: 'tournaments',
      targetId: tid,
      targetType: 'tournament',
      summary: `Results saved for "${tTitle}" — 🥇 ${w1Name}, ${payoutRecords.length} payout${payoutRecords.length !== 1 ? 's' : ''}`,
      metadata: { tournament: tTitle, winner: w1Name, payouts: payoutRecords.length }
    });
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
            <div class="reg-line-1"><b>${r.tournamentTitle || 'Tournament'}</b>${r.highlightUrl ? ' <span style="color:#f87171; font-size:11px;">📺 highlight</span>' : ''}</div>
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
    await addDoc(collection(db, 'tournament_payouts'), {
      winnerName, tournamentTitle, amount, prize: amount,
      rank: rank || '1', method: method || 'cash', note: note || '',
      status: 'paid', paidAt: serverTimestamp(), createdAt: serverTimestamp()
    });
    logActivity({
      action: 'payout_recorded',
      category: 'payments',
      summary: `Manual payout Rs. ${amount} to ${winnerName} (${tournamentTitle})`,
      metadata: { winnerName, amount, tournamentTitle, method }
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
  const previousValue = select.value;
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    roomTournaments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    select.innerHTML = '<option value="">— Select tournament —</option>' +
      roomTournaments.map(t =>
        `<option value="${t.id}"${t.id === previousValue ? ' selected' : ''}>${t.title || 'Untitled'} (${t.game || 'Game'})</option>`
      ).join('');
  } catch (err) {
    console.warn('loadRoomDetailsForm fetch failed:', err);
    return;
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
    const tName = document.getElementById('roomTournamentName')?.textContent || 'tournament';
    logActivity({
      action: 'room_details_updated',
      category: 'system',
      targetId: tid,
      targetType: 'tournament',
      summary: `Room details updated for "${tName}"`,
      metadata: { tournamentId: tid, tournamentName: tName }
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
    loadLiveStats();
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
        <div class="reg-line-2">📧 ${u.email || '—'}${u.phone ? ' · 📱 ' + u.phone : ''}${u.referredBy ? ' · 🔗 referred' : ''}</div>
      </div>
      <div class="reg-right">
        <span class="type-chip free">${u.role === 'admin' ? 'Admin' : 'Member'}</span>
        <small>${fmtDate(u.createdAt)}</small>
        ${u.role === 'admin' ? '' : `<button class="btn-delete small" style="margin-top:6px;" onclick="event.stopPropagation(); deleteUser('${u.id}','${(u.username||'').replace(/'/g,"\\'")}', false)">🗑️ Delete</button>`}
      </div>
    </div>
  `).join('');
}

window.deleteUser = async function(uid, username, fromModal) {
  if (fromModal) closeDetailModal();
  const confirmText = prompt(`⚠️ Delete user "${username}"?\n\nThis deletes their Firestore user doc + all their registrations + payments. Auth account must be deleted manually in Firebase Console.\n\nType DELETE to confirm:`);
  if (confirmText !== 'DELETE') {
    if (confirmText !== null) window.showToast('❌ Cancelled — you must type DELETE exactly');
    return;
  }
  try {
    await deleteDoc(doc(db, 'users', uid));
    const regSnap = await getDocs(query(collection(db, 'tournament_registrations'), where('userId', '==', uid)));
    for (const d of regSnap.docs) {
      await deleteDoc(doc(db, 'tournament_registrations', d.id));
    }
    const paySnap = await getDocs(query(collection(db, 'tournament_payments'), where('userId', '==', uid)));
    for (const d of paySnap.docs) {
      await deleteDoc(doc(db, 'tournament_payments', d.id));
    }
    logActivity({
      action: 'user_deleted',
      category: 'users',
      targetId: uid,
      targetType: 'user',
      summary: `Deleted user "${username}" (+${regSnap.size} registrations, ${paySnap.size} payments)`,
      metadata: { username, uid, regs: regSnap.size, payments: paySnap.size }
    });
    window.showToast(`🗑️ Deleted user + ${regSnap.size} regs + ${paySnap.size} payments`);
    await window.loadUsers();
    await window.loadRegistrations();
    await window.loadPayments();
  } catch (err) {
    console.error('deleteUser error:', err);
    window.showToast('❌ ' + err.message);
  }
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
  const rows = [['Username','Email','Phone','Role','User ID','Referred By','Referral Count','Referral Earnings','Joined']];
  allUsers.forEach(u => {
    rows.push([
      u.username || '',
      u.email || '',
      u.phone || '',
      u.role || 'member',
      u.id,
      u.referredBy || '',
      u.referralCount || 0,
      u.referralEarnings || 0,
      u.createdAt?.toDate ? u.createdAt.toDate().toISOString() : ''
    ]);
  });
  downloadCSV(`nepplay-users-${todayKey()}.csv`, rows);
};

window.exportRegistrationsCSV = function() {
  if (!allRegs.length) { window.showToast('❌ No registrations to export'); return; }
  const rows = [['Username','Email','IGN','Phone','Tournament','Entry Type','Amount','Txn ID','Method','Status','Stream URL','Registered']];
  allRegs.forEach(r => {
    rows.push([
      r.username || '',
      r.email || '',
      r.ign || '',
      r.phone || '',
      r.tournamentTitle || '',
      r.entryType || '',
      r.amount || 0,
      r.txnId || '',
      r.method || '',
      r.status || '',
      r.streamUrl || '',
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
      p.username || '',
      p.email || '',
      p.ign || '',
      p.phone || '',
      p.tournamentTitle || '',
      p.amount || 0,
      p.txnId || '',
      p.method || '',
      p.status || '',
      p.adminNote || '',
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
      const hasRoom = t.roomId && t.roomPassword;
      const isCompleted = (t.status || '').toLowerCase() === 'completed';
      const safeTitle = (t.title || 'Untitled').replace(/'/g, "\\'");
      const c = counts[t.id] || { total: 0, confirmed: 0, pending: 0 };
      return `
        <div class="reg-card ${isCompleted ? 'free-reg' : (isPaid ? 'paid-reg' : 'free-reg')}">
          <div class="reg-icon">${isCompleted ? '✅' : (isPaid ? '💵' : '🏆')}</div>
          <div class="reg-main">
            <div class="reg-line-1">
              <b>${t.title || 'Untitled'}</b>
              <span class="tourney-count">📋 ${c.total} registered</span>
              ${c.confirmed ? `<span class="tourney-count" style="background:rgba(34,197,94,0.15);border-color:rgba(34,197,94,0.4);color:#4ade80;">✅ ${c.confirmed}</span>` : ''}
              ${c.pending ? `<span class="tourney-count" style="background:rgba(234,179,8,0.15);border-color:rgba(234,179,8,0.4);color:#fbbf24;">⏳ ${c.pending}</span>` : ''}
            </div>
            <div class="reg-line-2">${t.game || 'Game'} · ${t.mode || 'Solo'}${t.date ? ' · 📅 ' + t.date : ''}${t.time ? ' · 🕐 ' + t.time : ''}${isPaid ? ' · 💰 Rs. ' + (t.entryFee || t.entry_fee || 0) : ' · FREE'}${t.prizePool || t.prize_pool ? ' · 🏆 Rs. ' + (t.prizePool || t.prize_pool) : ''}</div>
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
    logActivity({
      action: 'announcement_posted',
      category: 'system',
      summary: `Announcement posted: "${title}"`,
      metadata: { title }
    });
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
        <div class="reg-main"><div class="reg-line-1"><b>${u.username || 'Unknown'}</b>${u.role === 'admin' ? '<span class="type-chip paid" style="margin-left:8px;">ADMIN</span>' : ''}</div><div class="reg-line-2">${u.email || '—'}</div></div>
        <div class="reg-right"><small>${fmtShort(u.createdAt)}</small></div>
      </div>
    `).join('');
  }
  const rr = document.getElementById('dashRecentRegs');
  if (rr && allRegs.length) {
    rr.innerHTML = allRegs.slice(0,5).map(r => {
      const isPaid = r.entryType === 'paid';
      return `
        <div class="reg-card ${isPaid ? 'paid-reg' : 'free-reg'} clickable-row" onclick="openRegDetail('${r.id}')">
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
      const regSnap = await getDocs(query(
        collection(db, 'tournament_registrations'),
        where('paymentId', '==', id)
      ));
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

    if (type === 'payment') {
      const pay = allPayments.find(x => x.id === id) || {};
      const actionMap = { approve: 'payment_approved', reject: 'payment_rejected', reset: 'payment_reset' };
      logActivity({
        action: actionMap[action] || 'payment_approved',
        category: 'payments',
        targetId: id,
        targetType: 'payment',
        summary: `${actionLabel} Rs. ${pay.amount || 0} — ${pay.username || 'user'} (${pay.tournamentTitle || 'tournament'})`,
        metadata: { amount: pay.amount || 0, user: pay.username || '', tournament: pay.tournamentTitle || '' }
      });
    } else {
      const reg = allRegs.find(x => x.id === id) || {};
      logActivity({
        action: action === 'approve' ? 'user_registered' : 'payment_reset',
        category: 'users',
        targetId: id,
        targetType: 'registration',
        summary: `${actionLabel} registration — ${reg.username || 'user'} (${reg.tournamentTitle || 'tournament'})`,
        metadata: { user: reg.username || '' }
      });
    }

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
