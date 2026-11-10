/* ==========================================================================
   js/migrate.js — One-time data migration (migrate.html)
   --------------------------------------------------------------------------
   Older records were saved BEFORE this app had private workspaces, so they
   have no owner and their month ids are plain "2026-11". This tool, run once by
   the owner, does two things:

     1. Students: adds ownerId = your user id to every student that has none.
     2. Months  : for every month with a plain id ("2026-11"), it:
          • creates a new month document with the id "<yourId>_2026-11" and
            ownerId = your user id,
          • copies every daily record into the new month (adding ownerId),
          • then deletes the old month and its old days.

   It is SAFE TO RUN MORE THAN ONCE: anything already migrated is skipped.
   Nothing is deleted until its replacement has been written.
   ========================================================================== */

import {
  db,
  collection,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from './firebase-config.js';
import { qs, setLoading, showToast } from './ui.js';

let logEl = null;

/* Print one line in the on-page log. */
function log(message) {
  if (logEl) logEl.textContent += `${message}\n`;
  console.log('[migrate]', message);
}

export function initMigratePage(admin) {
  logEl = qs('#migrate-log');
  const button = qs('#migrate-start');
  if (logEl) logEl.textContent = '';

  button.addEventListener('click', async () => {
    if (logEl) logEl.textContent = '';
    setLoading(button, true);
    log(`Starting migration for ${admin.email} (uid: ${admin.uid})…`);

    try {
      await migrateStudents(admin.uid);
      await migrateMonths(admin.uid);
      log('Migration finished. Everything now belongs to your account.');
      showToast('Migration finished.', 'success');
    } catch (error) {
      console.error(error);
      log(`ERROR: ${error.message}`);
      showToast('Migration stopped — see the log.', 'error');
    } finally {
      setLoading(button, false);
    }
  });
}

/* --------------------------------------------------------------------------
   1. Tag students that have no owner yet.
   -------------------------------------------------------------------------- */
async function migrateStudents(uid) {
  log('--- Students ---');
  const snapshot = await getDocs(collection(db, 'students'));
  let tagged = 0;
  let skipped = 0;

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    if (data.ownerId) { skipped += 1; continue; }

    try {
      await updateDoc(doc(db, 'students', docSnap.id), { ownerId: uid });
      tagged += 1;
    } catch (error) {
      log(`  Could not tag student "${data.name || docSnap.id}": ${error.message}`);
    }
  }

  log(`Students tagged: ${tagged}. Already had an owner: ${skipped}.`);
}

/* --------------------------------------------------------------------------
   2. Move months from the plain "YYYY-MM" id to "<uid>_YYYY-MM".
   -------------------------------------------------------------------------- */
async function migrateMonths(uid) {
  log('--- Months ---');
  const snapshot = await getDocs(collection(db, 'months'));
  const prefix = `${uid}_`;
  let migrated = 0;
  let skipped = 0;

  for (const monthSnap of snapshot.docs) {
    const oldId = monthSnap.id;
    const data = monthSnap.data();

    // Already in the new format? Skip it.
    if (oldId.startsWith(prefix)) { skipped += 1; continue; }

    const ym = data.sortKey || oldId;              // "2026-11"
    const newId = `${uid}_${ym}`;

    // Read the days BEFORE writing anything.
    const daysSnap = await getDocs(collection(db, 'months', oldId, 'days'));
    const days = daysSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

    try {
      // a) Create the new month document.
      await setDoc(doc(db, 'months', newId), {
        ownerId: uid,
        year: Number(data.year) || Number(ym.slice(0, 4)),
        month: Number(data.month) || Number(ym.slice(5, 7)),
        label: data.label || ym,
        sortKey: ym,
        dayCount: days.length,
        createdAt: data.createdAt || serverTimestamp(),
      });

      // b) Copy the daily records into the new month.
      for (const day of days) {
        await setDoc(doc(db, 'months', newId, 'days', day.id), {
          ...day.data,
          ownerId: uid,
        });
      }

      // c) Delete the old days, then the old month.
      for (const day of days) {
        await deleteDoc(doc(db, 'months', oldId, 'days', day.id));
      }
      await deleteDoc(doc(db, 'months', oldId));

      migrated += 1;
      log(`  Moved ${ym} → ${newId} (${days.length} day${days.length === 1 ? '' : 's'}).`);
    } catch (error) {
      log(`  Could not move ${ym}: ${error.message}`);
    }
  }

  log(`Months moved: ${migrated}. Already in the new format: ${skipped}.`);
}
