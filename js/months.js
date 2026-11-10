/* ==========================================================================
   js/months.js — Dashboard page (dashboard.html)
   --------------------------------------------------------------------------
   • Stored Records : a live list of every month YOU have created.
   • Add Monthly Record : choose a month + year to create a new month.

   Every month is private to the admin who created it. We store the creator's
   user id in an `ownerId` field and only load months where
   ownerId == your own id. The month's document id is "<yourId>_2026-11" so
   two different admins can each have a "November 2026" without clashing.
   ========================================================================== */

import { guardPage } from './auth.js';
import {
  db, collection, onSnapshot, query, where, doc, getDoc, setDoc, serverTimestamp,
} from './firebase-config.js';
import {
  qs, showToast, setLoading, escapeHtml, ICONS, logoImg,
  formatMonthLabel, MONTH_NAMES, pad2,
} from './ui.js';

/* Start the page only once we know the visitor is an admin. */
guardPage({ active: 'home', onReady: startDashboard });

function startDashboard(admin) {
  // If a regular admin was bounced off an owner-only page, explain why.
  if (new URLSearchParams(window.location.search).get('denied')) {
    showToast('That page is for the owner only.', 'warning');
  }

  // Friendly greeting. Prefer the name this admin typed on the login form
  // (remembered in the browser), then the name saved in Firestore, then email.
  const greeting = qs('#greeting');
  if (greeting) {
    let typedName = '';
    try {
      typedName = localStorage.getItem(`swa_name_${admin.uid}`) || '';
    } catch (_) {
      /* private browsing — ignore and fall back below */
    }
    greeting.textContent = typedName || admin.name || admin.email || 'Admin';
  }

  // Show the school logo inside the welcome banner.
  const bannerLogo = qs('#banner-logo');
  if (bannerLogo) bannerLogo.innerHTML = logoImg();

  loadMonths(admin);
  setupAddMonthForm(admin);
}

/* --------------------------------------------------------------------------
   Stored Records — live list of YOUR months
   -------------------------------------------------------------------------- */
function loadMonths(admin) {
  const listEl = qs('#months-list');
  const loadingEl = qs('#months-loading');

  // Only this admin's months. (Sorting is done here in the browser so no
  // extra database index has to be set up.)
  const monthsQuery = query(
    collection(db, 'months'),
    where('ownerId', '==', admin.uid)
  );

  onSnapshot(
    monthsQuery,
    (snapshot) => {
      if (loadingEl) loadingEl.hidden = true;

      if (snapshot.empty) {
        listEl.innerHTML = `
          <div class="empty">
            ${ICONS.inbox}
            <h3>No months yet</h3>
            <p>Use “Add Monthly Record” to create your first month.</p>
          </div>`;
        return;
      }

      const months = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) => String(b.sortKey || b.id).localeCompare(String(a.sortKey || a.id)));

      const tiles = months.map((data) => {
        const count = Number(data.dayCount) || 0;
        const label = data.label || formatMonthLabel(data.year, data.month);
        return `
          <a class="month-tile" href="month.html?id=${encodeURIComponent(data.id)}">
            <span class="month-tile__name">${escapeHtml(label)}</span>
            <span class="month-tile__meta">
              ${count} recorded day${count === 1 ? '' : 's'}
            </span>
          </a>`;
      }).join('');

      listEl.innerHTML = `<div class="month-grid">${tiles}</div>`;
    },
    (error) => {
      console.error(error);
      if (loadingEl) loadingEl.hidden = true;
      listEl.innerHTML = `<div class="alert alert--error">Could not load your saved months. ${escapeHtml(error.message)}</div>`;
    }
  );
}

/* --------------------------------------------------------------------------
   Add Monthly Record — create a month document
   -------------------------------------------------------------------------- */
function setupAddMonthForm(admin) {
  const form = qs('#add-month-form');
  const monthSelect = qs('#month-select');
  const yearInput = qs('#year-input');
  const submitButton = qs('#add-month-submit');

  // Build the month dropdown (January … December).
  monthSelect.innerHTML = MONTH_NAMES
    .map((name, index) => `<option value="${index + 1}">${name}</option>`)
    .join('');

  // Default to the current month and year.
  const now = new Date();
  monthSelect.value = String(now.getMonth() + 1);
  yearInput.value = String(now.getFullYear());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const month = Number(monthSelect.value);
    const year = Number(yearInput.value);
    if (!month || !year || year < 2000 || year > 2100) {
      showToast('Please choose a valid month and year.', 'error');
      return;
    }

    const ym = `${year}-${pad2(month)}`;            // e.g. "2026-11"
    const monthId = `${admin.uid}_${ym}`;           // private to this admin
    const label = formatMonthLabel(year, month);

    setLoading(submitButton, true);
    try {
      const monthRef = doc(db, 'months', monthId);
      const existing = await getDoc(monthRef);

      if (existing.exists()) {
        // Already there — don't create a duplicate.
        showToast(`${label} already exists. Open it from Stored Records.`, 'warning');
        return;
      }

      await setDoc(monthRef, {
        ownerId: admin.uid,   // who this month belongs to
        year,
        month,
        label,
        sortKey: ym,
        dayCount: 0,
        createdAt: serverTimestamp(),
      });

      showToast(`${label} created.`, 'success');
    } catch (error) {
      console.error(error);
      showToast(`Could not create the month: ${error.message}`, 'error');
    } finally {
      setLoading(submitButton, false);
    }
  });
}
