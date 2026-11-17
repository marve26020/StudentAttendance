/* ==========================================================================
   js/migrate.js — Convert OLD "month" records into NEW "title" records
   --------------------------------------------------------------------------
   Used by migrate.html (OWNER ONLY, one time).

   OLD layout                       NEW layout
   ----------------------------     --------------------------------
   months/2026-11                   records/converted_2026-11
     • label: "November 2026"         • title: "November 2026"
     • dayCount                       • dayCount
     └ days/2026-11-13                └ days/2026-11-13
         • students: [ … ]                • students: [ … ]

   For every old month we:
     1. read its recorded dates,
     2. create a new record whose TITLE is the month's name,
     3. copy every recorded date into the new record,
     4. and only then delete the old month and its dates.

   SAFE TO RUN MORE THAN ONCE
     • The new record uses a fixed id ("converted_<oldId>"), so running again
       overwrites the same record instead of creating a duplicate.
     • Once an old month has been converted it is deleted, so the next run
       simply finds nothing left to do.
   ========================================================================== */

import {
  db,
  collection,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
} from "./firebase-config.js";
import { qs, setLoading, showToast, MONTH_NAMES } from "./ui.js";

let logEl = null;

/* Print one line in the on-page log. */
function log(message) {
  if (logEl) logEl.textContent += `${message}\n`;
  console.log("[convert]", message);
}

export function initMigratePage(admin) {
  logEl = qs("#migrate-log");
  const button = qs("#migrate-start");
  if (logEl) logEl.textContent = "";

  button.addEventListener("click", async () => {
    if (logEl) logEl.textContent = "";
    setLoading(button, true);
    log(`Starting conversion for ${admin.email} (uid: ${admin.uid})…`);

    try {
      await convertMonthsToRecords(admin.uid);
      log("Conversion finished.");
      showToast("Conversion finished.", "success");
    } catch (error) {
      console.error(error);
      log(`ERROR: ${error.message}`);
      showToast("Conversion stopped — see the log.", "error");
    } finally {
      setLoading(button, false);
    }
  });
}

/* Work out a friendly title for an old month, e.g. "November 2026". */
function monthTitle(data, oldId) {
  if (data.label) return data.label;
  const ym = data.sortKey || oldId; // like "2026-11"
  const year = Number(data.year) || Number(String(ym).slice(0, 4));
  const month = Number(data.month) || Number(String(ym).slice(5, 7));
  const name = MONTH_NAMES[month - 1] || ym;
  return year ? `${name} ${year}` : name;
}

/* --------------------------------------------------------------------------
   The conversion itself
   -------------------------------------------------------------------------- */
async function convertMonthsToRecords(defaultOwnerId) {
  log("--- Old monthly records → titled records ---");

  const snapshot = await getDocs(collection(db, "months"));
  if (snapshot.empty) {
    log("No old monthly records found — nothing to convert.");
    return;
  }

  let converted = 0;
  let skipped = 0;

  for (const monthSnap of snapshot.docs) {
    const oldId = monthSnap.id;
    const data = monthSnap.data();

    // Old months belong to whoever owned them. If an old month has no owner
    // (pre-private workspaces), give it to the owner running this tool.
    const ownerId = data.ownerId || defaultOwnerId;
    const title = monthTitle(data, oldId);

    // Read the recorded dates BEFORE writing anything.
    const daysSnap = await getDocs(collection(db, "months", oldId, "days"));
    const days = daysSnap.docs.map((d) => ({ id: d.id, data: d.data() }));

    // An empty month has no dates to keep — just remove it.
    if (!days.length) {
      try {
        await deleteDoc(doc(db, "months", oldId));
        skipped += 1;
        log(`  “${title}” had no recorded dates — removed the empty month.`);
      } catch (error) {
        log(`  Could not remove the empty month “${title}”: ${error.message}`);
      }
      continue;
    }

    const newId = `converted_${oldId}`; // fixed id → no duplicates on a re-run

    try {
      // a) Create the new record with the month's name as its title.
      await setDoc(doc(db, "records", newId), {
        ownerId,
        title,
        dayCount: days.length,
        createdAt: data.createdAt || serverTimestamp(),
      });

      // b) Copy every recorded date (keeping the same date id).
      for (const day of days) {
        await setDoc(doc(db, "records", newId, "days", day.id), {
          ownerId,
          date: day.data.date || day.id,
          students: day.data.students || [],
          count: (day.data.students || []).length,
          updatedAt: day.data.updatedAt || serverTimestamp(),
        });
      }

      // c) Delete the old dates, then the old month.
      for (const day of days) {
        await deleteDoc(doc(db, "months", oldId, "days", day.id));
      }
      await deleteDoc(doc(db, "months", oldId));

      converted += 1;
      log(
        `  “${title}” → record (${days.length} recorded date${days.length === 1 ? "" : "s"}).`,
      );
    } catch (error) {
      log(`  Could not convert “${title}”: ${error.message}`);
    }
  }

  log(`Converted: ${converted}. Skipped (empty): ${skipped}.`);
}
