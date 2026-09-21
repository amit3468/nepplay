// ============================================================
// NEPPLAY — activity.js
// Admin recent activity feed (#6)
// Depends on: firebase v10.12 (already loaded by admin.js)
// Usage: import { initActivity, logActivity, loadActivityFeed, loadActivityPage } from "./activity.js";
// ============================================================

import {
  collection, addDoc, query, orderBy, limit, onSnapshot,
  getDocs, startAfter, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// db + auth injected from admin.js (avoids double initializeApp)
let db, auth;
export function initActivity(firestoreDb, firebaseAuth) {
  db = firestoreDb;
  auth = firebaseAuth;
}

// ============================================================
// LOG HELPER
// ============================================================
export async function logActivity({ action, category, targetId, targetType, summary, metadata = {}, actorType }) {
  if (!db) { console.warn('logActivity: db not initialized'); return; }
  try {
    const user = auth?.currentUser;
    await addDoc(collection(db, 'activity'), {
      action,
      category,
      targetId: targetId ?? null,
      targetType: targetType ?? null,
      summary: summary || '',
      metadata: metadata || {},
      actor: user?.email || 'system',
      actorType: actorType || (user ? 'admin' : 'system'),
      timestamp: serverTimestamp()
    });
  } catch (e) {
    console.error('logActivity failed:', e);
  }
}

// ============================================================
// ACTION → ICON / COLOR / LABEL MAP
// ============================================================
const ACTION_META = {
  payment_approved:      { icon: '✅', color: '#22c55e', label: 'Payment approved' },
  payment_rejected:      { icon: '❌', color: '#ef4444', label: 'Payment rejected' },
  payment_reset:         { icon: '↺',  color: '#f59e0b', label: 'Payment reset' },
  payment_bulk_approved: { icon: '✅', color: '#22c55e', label: 'Bulk approve' },
  payment_marked_paid:   { icon: '💰', color: '#22c55e', label: 'Payout marked paid' },
  payout_recorded:       { icon: '📤', color: '#22c55e', label: 'Payout recorded' },
  user_registered:       { icon: '👤', color: '#3b82f6', label: 'User registered' },
  user_deleted:          { icon: '🗑️', color: '#ef4444', label: 'User deleted' },
  user_banned:           { icon: '🚫', color: '#ef4444', label: 'User banned' },
  user_unbanned:         { icon: '✔',  color: '#22c55e', label: 'User unbanned' },
  user_role_changed:     { icon: '🎭', color: '#8b5cf6', label: 'Role changed' },
  referral_credited:     { icon: '🤝', color: '#ec4899', label: 'Referral credited' },
  referral_marked_paid:  { icon: '✅', color: '#22c55e', label: 'Referral paid' },
  tournament_created:    { icon: '➕', color: '#f97316', label: 'Tournament created' },
  tournament_updated:    { icon: '✏️', color: '#f97316', label: 'Tournament updated' },
  tournament_deleted:    { icon: '🗑️', color: '#ef4444', label: 'Tournament deleted' },
  results_submitted:     { icon: '🏆', color: '#eab308', label: 'Results submitted' },
  banner_updated:        { icon: '📢', color: '#06b6d4', label: 'Banner updated' },
  announcement_posted:   { icon: '📢', color: '#06b6d4', label: 'Announcement posted' },
  stream_url_updated:    { icon: '🔴', color: '#ef4444', label: 'Stream URL updated' },
  notification_sent:     { icon: '🔔', color: '#6366f1', label: 'Notification sent' },
  room_details_updated:  { icon: '🔑', color: '#8b5cf6', label: 'Room details updated' },
  admin_login:           { icon: '🔐', color: '#6b7280', label: 'Admin login' }
};

function metaFor(action) {
  return ACTION_META[action] || { icon: '•', color: '#6b7280', label: action || 'Event' };
}

// ============================================================
// TIME HELPERS
// ============================================================
function relTime(ts) {
  if (!ts?.toDate) return '—';
  const d = ts.toDate();
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 10) return 'just now';
  if (sec < 60) return sec + 's ago';
  if (sec < 3600) return Math.floor(sec / 60) + 'm ago';
  if (sec < 86400) return Math.floor(sec / 3600) + 'h ago';
  if (sec < 604800) return Math.floor(sec / 86400) + 'd ago';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function fullTime(ts) {
  if (!ts?.toDate) return '';
  return ts.toDate().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function escAct(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// ============================================================
// RENDER ONE ITEM
// ============================================================
function renderItem(a) {
  const m = metaFor(a.action);
  const summary = a.summary || m.label;
  const actor = a.actorType === 'system' ? 'system' : (a.actor || '—');
  return `
    <div class="activity-item" title="${escAct(fullTime(a.timestamp))}">
      <div class="activity-dot" style="background:${m.color}20; border-color:${m.color}; color:${m.color};">
        ${m.icon}
      </div>
      <div class="activity-body">
        <div class="activity-summary">${escAct(summary)}</div>
        <div class="activity-meta">
          <span class="activity-time">🕐 ${relTime(a.timestamp)}</span>
          <span class="activity-actor">👤 ${escAct(actor)}</span>
        </div>
      </div>
    </div>
  `;
}

// ============================================================
// DASHBOARD WIDGET — last 8, live
// ============================================================
let dashUnsub = null;

export function loadActivityFeed() {
  const el = document.getElementById('dashActivityFeed');
  if (!el) return;
  if (dashUnsub) { try { dashUnsub(); } catch (e) {} dashUnsub = null; }

  const q = query(collection(db, 'activity'), orderBy('timestamp', 'desc'), limit(8));
  dashUnsub = onSnapshot(q, snap => {
    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!items.length) {
      el.innerHTML = '<div class="empty-state"><span class="icon">📜</span>No activity yet</div>';
      return;
    }
    el.innerHTML = items.map(renderItem).join('');
  }, err => {
    console.warn('activity feed error:', err);
    el.innerHTML = '<div class="empty-state"><span class="icon">⚠️</span>Could not load activity</div>';
  });
}

// ============================================================
// ACTIVITY PAGE — paginated + filterable, live top
// ============================================================
const PAGE_SIZE = 50;
const pageState = {
  items: [],
  lastDoc: null,
  hasMore: true,
  loading: false,
  filterCategory: 'all',
  filterActor: 'all',
  filterRange: 'all',
  search: '',
  unsub: null
};

function passesFilter(a) {
  if (pageState.filterCategory !== 'all' && a.category !== pageState.filterCategory) return false;
  if (pageState.filterActor !== 'all' && a.actor !== pageState.filterActor) return false;
  if (pageState.filterRange !== 'all') {
    const days = Number(pageState.filterRange);
    const ts = a.timestamp?.toMillis?.() || 0;
    if (Date.now() - ts > days * 86400000) return false;
  }
  if (pageState.search) {
    const hay = `${a.summary || ''} ${a.actor || ''} ${a.targetId || ''} ${a.action || ''}`.toLowerCase();
    if (!hay.includes(pageState.search)) return false;
  }
  return true;
}

function renderPage() {
  const list = document.getElementById('activityList');
  const moreBtn = document.getElementById('activityMoreBtn');
  const countEl = document.getElementById('activityCount');
  if (!list) return;

  const filtered = pageState.items.filter(passesFilter);
  if (countEl) countEl.innerText = `${filtered.length} shown`;

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">🔍</span>No activity matches your filter.</div>';
    if (moreBtn) moreBtn.style.display = pageState.hasMore ? 'inline-block' : 'none';
    return;
  }
  list.innerHTML = filtered.map(renderItem).join('');
  if (moreBtn) moreBtn.style.display = pageState.hasMore ? 'inline-block' : 'none';
}

async function fetchPage(isFirst) {
  if (pageState.loading) return;
  if (!isFirst && !pageState.hasMore) return;
  pageState.loading = true;
  const moreBtn = document.getElementById('activityMoreBtn');
  if (moreBtn) { moreBtn.disabled = true; moreBtn.innerText = '⏳ Loading...'; }

  try {
    let q;
    if (isFirst || !pageState.lastDoc) {
      q = query(collection(db, 'activity'), orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
    } else {
      q = query(collection(db, 'activity'), orderBy('timestamp', 'desc'),
        startAfter(pageState.lastDoc), limit(PAGE_SIZE));
    }
    const snap = await getDocs(q);
    const batch = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    pageState.items = isFirst ? batch : pageState.items.concat(batch);
    pageState.lastDoc = snap.docs[snap.docs.length - 1] || null;
    pageState.hasMore = batch.length === PAGE_SIZE;
    renderPage();
  } catch (err) {
    console.error('fetchPage error:', err);
    const list = document.getElementById('activityList');
    if (list) list.innerHTML = '<div class="empty-state"><span class="icon">❌</span>' + escAct(err.message) + '</div>';
  } finally {
    pageState.loading = false;
    if (moreBtn) { moreBtn.disabled = false; moreBtn.innerText = '⬇️ Load more'; }
  }
}

async function populateActorFilter() {
  const sel = document.getElementById('activityActorFilter');
  if (!sel) return;
  try {
    const snap = await getDocs(query(collection(db, 'activity'), orderBy('timestamp', 'desc'), limit(200)));
    const actors = new Set();
    snap.docs.forEach(d => { const a = d.data(); if (a.actor) actors.add(a.actor); });
    const list = Array.from(actors).sort();
    sel.innerHTML = '<option value="all">All actors</option>' +
      list.map(a => `<option value="${escAct(a)}">${escAct(a)}</option>`).join('');
  } catch (e) { /* silent */ }
}

export function loadActivityPage() {
  const list = document.getElementById('activityList');
  if (!list) return;

  if (!pageState.items.length) {
    list.innerHTML = '<div class="empty-state"><span class="icon">⏳</span>Loading...</div>';
    fetchPage(true).then(() => populateActorFilter());
  } else {
    renderPage();
  }

  if (pageState.unsub) { try { pageState.unsub(); } catch (e) {} pageState.unsub = null; }
  const liveQ = query(collection(db, 'activity'), orderBy('timestamp', 'desc'), limit(PAGE_SIZE));
  pageState.unsub = onSnapshot(liveQ, snap => {
    pageState.items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    pageState.lastDoc = snap.docs[snap.docs.length - 1] || null;
    pageState.hasMore = true;
    renderPage();
  }, err => console.warn('activity page live error:', err));
}

// ============================================================
// FILTER HANDLERS (called from admin.html via window.*)
// ============================================================
window.activityFilterCategory = function (v) { pageState.filterCategory = v || 'all'; renderPage(); };
window.activityFilterActor    = function (v) { pageState.filterActor = v || 'all'; renderPage(); };
window.activityFilterRange    = function (v) { pageState.filterRange = v || 'all'; renderPage(); };
window.activitySearch         = function () {
  pageState.search = (document.getElementById('activitySearch')?.value || '').toLowerCase().trim();
  renderPage();
};
window.activityLoadMore       = function () { fetchPage(false); };

// Refresh relative times on the page every 30s
setInterval(() => {
  const onPage = document.getElementById('section-activity')?.style.display === 'block';
  if (onPage) renderPage();
}, 30000);
