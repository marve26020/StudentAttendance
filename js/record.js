/* ==========================================================================
   js/record.js — Single record page (record.html?id=<recordDocId>)
   --------------------------------------------------------------------------
   A "record" is a container with a title you chose (e.g. "GST"). Inside it:

     • Recorded Dates      : every date already saved, expandable, editable
                             and deletable.
     • Create Daily Record : pick ANY date (no month limit), tick the students
                             who came, and save.
     • Rename / Delete     : change the title, or delete the whole record.
     • Print Record        : download this one record as a PDF.

   The id in the address bar is the record's DOCUMENT id. Every date we save is
   stamped with the same ownerId as the record, so a record (and everything
   under it) belongs to one admin.

   READ-ONLY VIEW
   If the record's ownerId is NOT your own id, you are looking at another
   admin's record (only the owner can do this, from the All Admins page) and
   the page switches to read-only: no create / edit / delete, but printing
   still works.
   ========================================================================== */

import { guardPage } from "./auth.js";
import {
  db,
  collection,
  onSnapshot,
  query,
  where,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  increment,
} from "./firebase-config.js";
import {
  qs,
  showToast,
  setLoading,
  escapeHtml,
  confirmModal,
  promptModal,
  ICONS,
  formatDayLong,
  todayISO,
} from "./ui.js";
import { generateRecordPdf } from "./pdf.js";

/* --------------------------------------------------------------------------
   Page state
   -------------------------------------------------------------------------- */
let admin = null; // the signed-in admin
let recordDocId = ""; // the record's document id
let recordOwnerId = ""; // the admin this record belongs to
let recordTitle = ""; // the title shown on the page
let readOnly = false; // true when viewing another admin's record

let students = []; // master list: [{ id, name }]
let extraStudents = []; // students that only exist inside an old date
let days = []; // recorded dates: [{ id, date, students, count }]

let editingDate = null; // 'YYYY-MM-DD' while editing an existing date
let checkedIds = new Set(); // ids currently ticked in the checklist
let checklistFilter = "";

guardPage({ active: "home", onReady: startRecordPage });

async function startRecordPage(signedInAdmin) {
  admin = signedInAdmin;

  // --- Read ?id=... from the address bar --------------------------------
  const params = new URLSearchParams(window.location.search);
  recordDocId = params.get("id") || "";

  if (!recordDocId) {
    showToast("That record link is not valid.", "error");
    window.location.replace("dashboard.html");
    return;
  }

  // Confirm the record document exists, and read who it belongs to.
  const recordSnap = await getDoc(doc(db, "records", recordDocId));
  if (!recordSnap.exists()) {
    showToast("That record has not been created yet.", "error");
    window.location.replace("dashboard.html");
    return;
  }
  const recordData = recordSnap.data();
  recordOwnerId = recordData.ownerId || "";
  recordTitle = recordData.title || "Untitled record";

  // Read-only when this record is not ours (owner viewing another admin).
  readOnly = recordOwnerId !== admin.uid;

  // --- Page heading -----------------------------------------------------
  applyTitle();
  qs("#back-link").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "dashboard.html";
  });

  if (readOnly) {
    // Show a clear note and hide the "create record" card entirely.
    const banner = qs("#readonly-banner");
    if (banner) {
      banner.textContent = `You are viewing another admin\u2019s “${recordTitle}” record. This view is read-only — you can browse and print, but not change anything.`;
      banner.hidden = false;
    }
    const createCard = qs("#create-record-card");
    if (createCard) createCard.hidden = true;
    // No Rename / Delete when read-only.
    const renameBtn = qs("#rename-record");
    const deleteBtn = qs("#delete-record");
    if (renameBtn) renameBtn.hidden = true;
    if (deleteBtn) deleteBtn.hidden = true;
  } else {
    setupDateInput();
    setupChecklistToolbar();
    setupCreateForm();
    setupRenameAndDelete();
  }

  setupPrintButton();
  loadStudents();
  loadDays();
}

/** Put the record's title in the heading and the browser tab. */
function applyTitle() {
  qs("#record-title").textContent = recordTitle;
  document.title = `${recordTitle} — Work Aid Attendance`;
}

/* --------------------------------------------------------------------------
   Students master list (for the tick-list)
   --------------------------------------------------------------------------
   We load the students belonging to the RECORD's owner — which is you, unless
   the owner is viewing someone else's record.
   -------------------------------------------------------------------------- */
function loadStudents() {
  onSnapshot(
    query(collection(db, "students"), where("ownerId", "==", recordOwnerId)),
    (snapshot) => {
      students = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", undefined, {
            sensitivity: "base",
          }),
        );
      if (!readOnly) renderChecklist();
    },
    (error) => {
      console.error(error);
      showToast(`Could not load students: ${error.message}`, "error");
    },
  );
}

/* --------------------------------------------------------------------------
   Recorded dates for this record
   -------------------------------------------------------------------------- */
function loadDays() {
  const loadingEl = qs("#days-loading");
  const listEl = qs("#days-list");

  // Only this record's dates for this owner (sorting done here in the browser).
  onSnapshot(
    query(
      collection(db, "records", recordDocId, "days"),
      where("ownerId", "==", recordOwnerId),
    ),
    (snapshot) => {
      if (loadingEl) loadingEl.hidden = true;
      days = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      renderDays();
      updatePrintButton();
    },
    (error) => {
      console.error(error);
      if (loadingEl) loadingEl.hidden = true;
      listEl.innerHTML = `<div class="alert alert--error">Could not load the recorded dates. ${escapeHtml(error.message)}</div>`;
    },
  );
}

function renderDays() {
  const listEl = qs("#days-list");
  const summaryEl = qs("#days-summary");

  if (summaryEl) {
    summaryEl.textContent = days.length
      ? `${days.length} recorded date${days.length === 1 ? "" : "s"}`
      : "";
  }

  if (!days.length) {
    listEl.innerHTML = `
      <div class="empty">
        ${ICONS.calendar}
        <h3>No dates recorded yet</h3>
        ${readOnly ? "" : `<p>Use “Create Daily Record” to add the first date.</p>`}
      </div>`;
    return;
  }

  listEl.innerHTML = `<div class="list">${days.map(dayRow).join("")}</div>`;

  days.forEach((day) => {
    const row = qs(`#day-${day.id}`);
    const head = qs(`#day-${day.id} .day-row__head`);

    head.addEventListener("click", () => row.classList.toggle("is-open"));

    // In read-only mode there are no edit / delete buttons to wire up.
    const editBtn = qs(`#edit-day-${day.id}`);
    const deleteBtn = qs(`#delete-day-${day.id}`);
    if (editBtn) {
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        loadDayForEdit(day);
      });
    }
    if (deleteBtn) {
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeDay(day);
      });
    }
  });
}

function dayRow(day) {
  const count = Number(day.count) || (day.students || []).length;
  const names =
    (day.students || [])
      .map((s) => `<span class="pill">${escapeHtml(s.name)}</span>`)
      .join("") || '<span class="pill pill--muted">No students recorded</span>';

  // Only show Edit / Delete when we are allowed to change the record.
  const actions = readOnly
    ? ""
    : `<div class="list-row__actions" style="margin-top:16px">
          <button class="btn btn--ghost btn--sm" id="edit-day-${day.id}" type="button">
            ${ICONS.edit} Edit
          </button>
          <button class="btn btn--danger-ghost btn--sm" id="delete-day-${day.id}" type="button">
            ${ICONS.trash} Delete
          </button>
        </div>`;

  return `
    <div class="list-row day-row" id="day-${day.id}">
      <button class="day-row__head" type="button" aria-expanded="false">
        <span class="list-row__main">
          <span class="list-row__title">${escapeHtml(formatDayLong(day.date))}</span>
          <span class="list-row__meta">${count} student${count === 1 ? "" : "s"} present</span>
        </span>
        <span class="icon-btn">${ICONS.chevron}</span>
      </button>
      <div class="day-row__body">
        <div class="name-pills">${names}</div>
        ${actions}
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Date input — any date is allowed
   -------------------------------------------------------------------------- */
function setupDateInput() {
  qs("#record-date").value = todayISO();
}

/* --------------------------------------------------------------------------
   Checklist (student tick-list)
   -------------------------------------------------------------------------- */
function allChecklistStudents() {
  // Master students first, then any "extra" students from old records that are
  // no longer in the master list (kept so old records stay editable).
  const masterIds = new Set(students.map((s) => s.id));
  const extras = extraStudents.filter((s) => !masterIds.has(s.id));
  return [...students, ...extras];
}

function renderChecklist() {
  const container = qs("#checklist");
  const items = allChecklistStudents();

  if (!items.length) {
    container.innerHTML = `
      <div class="empty">
        ${ICONS.users}
        <h3>No students in the master list</h3>
        <p>Add students on the <a href="students.html">Students</a> page first.</p>
      </div>`;
    return;
  }

  const term = checklistFilter.trim().toLowerCase();
  const visible = term
    ? items.filter((s) => (s.name || "").toLowerCase().includes(term))
    : items;
  const masterIds = new Set(students.map((s) => s.id));

  if (!visible.length) {
    container.innerHTML = `<div class="empty"><p>No students match “${escapeHtml(checklistFilter)}”.</p></div>`;
    return;
  }

  container.innerHTML = visible
    .map((student) => {
      const removedNote = masterIds.has(student.id)
        ? ""
        : " <em>(removed)</em>";
      return `
      <label class="check-item">
        <input type="checkbox" data-id="${escapeHtml(student.id)}" ${checkedIds.has(student.id) ? "checked" : ""}>
        <span>${escapeHtml(student.name)}${removedNote}</span>
      </label>`;
    })
    .join("");
}

function setupChecklistToolbar() {
  const searchInput = qs("#checklist-search");
  searchInput.addEventListener("input", () => {
    checklistFilter = searchInput.value;
    renderChecklist();
  });

  qs("#select-all").addEventListener("click", () => {
    visibleChecklistIds().forEach((id) => checkedIds.add(id));
    renderChecklist();
  });
  qs("#clear-all").addEventListener("click", () => {
    visibleChecklistIds().forEach((id) => checkedIds.delete(id));
    renderChecklist();
  });

  // Keep our Set in sync whenever a checkbox is clicked.
  qs("#checklist").addEventListener("change", (event) => {
    const input = event.target;
    if (input.matches('input[type="checkbox"]')) {
      const id = input.getAttribute("data-id");
      if (input.checked) checkedIds.add(id);
      else checkedIds.delete(id);
    }
  });
}

/** Ids of the students currently visible in the (filtered) checklist. */
function visibleChecklistIds() {
  const term = checklistFilter.trim().toLowerCase();
  return allChecklistStudents()
    .filter((s) => !term || (s.name || "").toLowerCase().includes(term))
    .map((s) => s.id);
}

/* --------------------------------------------------------------------------
   Create / edit a daily record
   -------------------------------------------------------------------------- */
function setupCreateForm() {
  const dateInput = qs("#record-date");
  const infoBox = qs("#record-info");

  // Warn the moment a date that already has a record is picked.
  dateInput.addEventListener("change", () => {
    const existing = days.find((d) => d.date === dateInput.value);
    if (existing && editingDate !== dateInput.value) {
      infoBox.className = "alert alert--warning";
      infoBox.textContent = `A record already exists for ${formatDayLong(existing.date)}. Saving will ask you to edit it.`;
      infoBox.hidden = false;
    } else {
      infoBox.hidden = true;
    }
  });

  qs("#cancel-edit").addEventListener("click", () => resetForm());
  qs("#create-record-form").addEventListener("submit", handleSaveRecord);
}

async function handleSaveRecord(event) {
  event.preventDefault();

  const date = qs("#record-date").value;
  const saveButton = qs("#save-record");

  if (!date) {
    showToast("Please choose a date.", "error");
    return;
  }

  const existing = days.find((d) => d.date === date);

  // If a record already exists and we are NOT deliberately editing it,
  // offer to edit instead of creating a duplicate.
  if (existing && editingDate !== date) {
    const editIt = await confirmModal({
      title: "Record already exists",
      message: `A record for ${formatDayLong(date)} already exists. Do you want to open it for editing?`,
      confirmLabel: "Edit it",
      cancelLabel: "Cancel",
    });
    if (editIt) loadDayForEdit(existing);
    return;
  }

  // Collect the ticked students (using their current names).
  const selected = allChecklistStudents()
    .filter((s) => checkedIds.has(s.id))
    .map((s) => ({ id: s.id, name: s.name }));

  setLoading(saveButton, true);
  try {
    await setDoc(doc(db, "records", recordDocId, "days", date), {
      ownerId: recordOwnerId, // the date belongs to the record's owner
      date,
      students: selected,
      count: selected.length,
      updatedAt: serverTimestamp(),
    });

    // Only a brand-new date increases the record's recorded-date count.
    if (!existing) {
      await updateDoc(doc(db, "records", recordDocId), { dayCount: increment(1) });
    }

    const wasEditing = Boolean(editingDate);
    resetForm();
    showToast(
      `${wasEditing ? "Updated" : "Saved"} ${formatDayLong(date)} — ${selected.length} student${selected.length === 1 ? "" : "s"}.`,
      "success",
    );
  } catch (error) {
    console.error(error);
    showToast(`Could not save the record: ${error.message}`, "error");
  } finally {
    setLoading(saveButton, false);
  }
}

/** Return the form to “create” mode. */
function resetForm() {
  editingDate = null;
  checkedIds = new Set();
  extraStudents = [];
  checklistFilter = "";

  const infoBox = qs("#record-info");
  if (infoBox) infoBox.hidden = true;
  qs("#checklist-search").value = "";
  qs("#cancel-edit").hidden = true;

  const saveLabel = qs("#save-record .btn__label");
  if (saveLabel) saveLabel.textContent = "Save record";
  const formHeading = qs("#form-heading");
  if (formHeading) formHeading.textContent = "Create Daily Record";

  qs("#record-date").value = todayISO();
  renderChecklist();
}

/* --------------------------------------------------------------------------
   Load an existing date into the form (edit mode)
   -------------------------------------------------------------------------- */
function loadDayForEdit(day) {
  editingDate = day.date;
  extraStudents = day.students || [];
  checkedIds = new Set((day.students || []).map((s) => s.id));
  checklistFilter = "";
  qs("#checklist-search").value = "";
  qs("#record-date").value = day.date;

  const formHeading = qs("#form-heading");
  if (formHeading)
    formHeading.textContent = `Edit record — ${formatDayLong(day.date)}`;
  qs("#save-record").querySelector(".btn__label").textContent = "Update record";
  qs("#cancel-edit").hidden = false;

  const infoBox = qs("#record-info");
  infoBox.className = "alert alert--info";
  infoBox.textContent = `Editing ${formatDayLong(day.date)}. Change the ticks and press “Update record”.`;
  infoBox.hidden = false;

  renderChecklist();
  qs("#create-record-card").scrollIntoView({
    behavior: "smooth",
    block: "start",
  });
}

/* --------------------------------------------------------------------------
   Delete a recorded date
   -------------------------------------------------------------------------- */
async function removeDay(day) {
  const confirmed = await confirmModal({
    title: "Delete record",
    message: `Delete the record for ${formatDayLong(day.date)}? This cannot be undone.`,
    confirmLabel: "Delete",
    danger: true,
  });
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "records", recordDocId, "days", day.date));
    await updateDoc(doc(db, "records", recordDocId), { dayCount: increment(-1) });

    // If we were editing that date, clear the form.
    if (editingDate === day.date) resetForm();

    showToast(`${formatDayLong(day.date)} deleted.`, "success");
  } catch (error) {
    console.error(error);
    showToast(`Could not delete the record: ${error.message}`, "error");
  }
}

/* --------------------------------------------------------------------------
   Rename / delete the whole record (title)
   -------------------------------------------------------------------------- */
function setupRenameAndDelete() {
  qs("#rename-record").addEventListener("click", renameRecord);
  qs("#delete-record").addEventListener("click", deleteRecord);
}

async function renameRecord() {
  const newTitle = await promptModal({
    title: "Rename record",
    label: "Title",
    value: recordTitle,
    confirmLabel: "Save",
  });
  if (!newTitle || newTitle === recordTitle) return;

  try {
    await updateDoc(doc(db, "records", recordDocId), { title: newTitle });
    recordTitle = newTitle;
    applyTitle();
    showToast(`Renamed to “${newTitle}”.`, "success");
  } catch (error) {
    console.error(error);
    showToast(`Could not rename the record: ${error.message}`, "error");
  }
}

async function deleteRecord() {
  const confirmed = await confirmModal({
    title: "Delete record",
    message: `Delete “${recordTitle}” and every date recorded under it? This cannot be undone.`,
    confirmLabel: "Delete record",
    danger: true,
  });
  if (!confirmed) return;

  try {
    // A document's sub-collection is not removed automatically, so delete the
    // recorded dates first, then the record itself.
    const daysSnap = await getDocs(
      collection(db, "records", recordDocId, "days"),
    );
    for (const daySnap of daysSnap.docs) {
      await deleteDoc(doc(db, "records", recordDocId, "days", daySnap.id));
    }
    await deleteDoc(doc(db, "records", recordDocId));

    showToast(`“${recordTitle}” deleted.`, "success");
    window.location.href = "dashboard.html";
  } catch (error) {
    console.error(error);
    showToast(`Could not delete the record: ${error.message}`, "error");
  }
}

/* --------------------------------------------------------------------------
   Print / download the record's PDF
   -------------------------------------------------------------------------- */
function setupPrintButton() {
  qs("#print-record").addEventListener("click", () => {
    if (!days.length) {
      showToast("There are no recorded dates to print yet.", "warning");
      return;
    }
    try {
      generateRecordPdf({ title: recordTitle, days, students });
      showToast("PDF downloaded.", "success");
    } catch (error) {
      console.error(error);
      showToast(`Could not create the PDF: ${error.message}`, "error");
    }
  });
}

function updatePrintButton() {
  const button = qs("#print-record");
  if (button) button.disabled = days.length === 0;
}
