/* ==========================================================================
   js/records.js — Dashboard page (dashboard.html)
   --------------------------------------------------------------------------
   • Stored Records : a live list of every record (title) YOU have created.
   • Add Record     : type a title to create a new record.

   A "record" is just a container with a title you choose — "GST",
   "Library Duty", whatever you like. Inside it you save dates, and under each
   date the students who attended.

   Every record is private to the admin who created it. We store the creator's
   user id in an `ownerId` field and only load records where
   ownerId == your own id.
   ========================================================================== */

import { guardPage } from './auth.js';
import {
  db,
  collection,
  onSnapshot,
  query,
  where,
  addDoc,
  serverTimestamp,
} from './firebase-config.js';
import { qs, showToast, setLoading, escapeHtml, ICONS, logoImg } from './ui.js';

/* Start the page only once we know the visitor is an admin. */
guardPage({ active: 'home', onReady: startDashboard });

let records = []; // the signed-in admin's records: [{ id, title, dayCount }]

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

  loadRecords(admin);
  setupAddRecordForm(admin);
}

/* --------------------------------------------------------------------------
   Stored Records — live list of YOUR records
   -------------------------------------------------------------------------- */
function loadRecords(admin) {
  const listEl = qs('#records-list');
  const loadingEl = qs('#records-loading');

  // Only this admin's records. (Sorting is done here in the browser so no
  // extra database index has to be set up.)
  const recordsQuery = query(
    collection(db, 'records'),
    where('ownerId', '==', admin.uid)
  );

  onSnapshot(
    recordsQuery,
    (snapshot) => {
      if (loadingEl) loadingEl.hidden = true;

      records = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) =>
          String(a.title || '').localeCompare(String(b.title || ''), undefined, {
            sensitivity: 'base',
          })
        );

      if (!records.length) {
        listEl.innerHTML = `
          <div class="empty">
            ${ICONS.inbox}
            <h3>No records yet</h3>
            <p>Use “Add Record” to create your first title.</p>
          </div>`;
        return;
      }

      const tiles = records
        .map((data) => {
          const count = Number(data.dayCount) || 0;
          return `
          <a class="record-tile" href="record.html?id=${encodeURIComponent(data.id)}">
            <span class="record-tile__name">${escapeHtml(data.title || 'Untitled record')}</span>
            <span class="record-tile__meta">
              ${count} recorded date${count === 1 ? '' : 's'}
            </span>
          </a>`;
        })
        .join('');

      listEl.innerHTML = `<div class="record-grid">${tiles}</div>`;
    },
    (error) => {
      console.error(error);
      if (loadingEl) loadingEl.hidden = true;
      listEl.innerHTML = `<div class="alert alert--error">Could not load your saved records. ${escapeHtml(error.message)}</div>`;
    }
  );
}

/* --------------------------------------------------------------------------
   Add Record — create a record (container) with a free-text title
   -------------------------------------------------------------------------- */
function setupAddRecordForm(admin) {
  const form = qs('#add-record-form');
  const titleInput = qs('#record-title');
  const submitButton = qs('#add-record-submit');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    const title = titleInput.value.trim();
    if (!title) {
      showToast('Please type a title for the record.', 'error');
      titleInput.focus();
      return;
    }

    // Don't create two records with the same title for the same admin.
    const clash = records.some(
      (r) => String(r.title || '').toLowerCase() === title.toLowerCase()
    );
    if (clash) {
      showToast(`You already have a record called “${title}”.`, 'warning');
      return;
    }

    setLoading(submitButton, true);
    try {
      // A new document with a random id — the title can be anything.
      await addDoc(collection(db, 'records'), {
        ownerId: admin.uid, // who this record belongs to
        title,
        dayCount: 0, // how many dates have been recorded so far
        createdAt: serverTimestamp(),
      });

      titleInput.value = '';
      showToast(`“${title}” created.`, 'success');
    } catch (error) {
      console.error(error);
      showToast(`Could not create the record: ${error.message}`, 'error');
    } finally {
      setLoading(submitButton, false);
    }
  });
}
