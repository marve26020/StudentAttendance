/* ==========================================================================
   js/month.js — Single month page (month.html?id=<monthDocId>)
   --------------------------------------------------------------------------
   • Days of Recorded Months : every day already saved, expandable, editable
                               and deletable.
   • Create Daily Record     : pick a date inside the month, tick the students
                               who came, and save.
   • Print Record            : download the whole month as a PDF.

   The id in the address bar is the month's DOCUMENT id, e.g.
   "<adminUid>_2026-11". Every day we save is stamped with the same ownerId as
   the month, so a month (and everything under it) belongs to one admin.

   READ-ONLY VIEW
   If the month's ownerId is NOT your own id, you are looking at another
   admin's month (only the owner can do this, from the All Admins page) and the
   page switches to read-only: no create / edit / delete, but printing still
   works.
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
  ICONS,
  formatMonthLabel,
  formatDayLong,
  daysInMonth,
  pad2,
  todayISO,
} from "./ui.js";
import { generateMonthlyPdf } from "./pdf.js";

/* --------------------------------------------------------------------------
   Page state
   -------------------------------------------------------------------------- */
let admin = null; // the signed-in admin
let monthDocId = ""; // the document id, e.g. "<uid>_2026-11"
let monthOwnerId = ""; // the admin this month belongs to
let ym = ""; // "YYYY-MM"
let year = 0;
let month = 0; // 1–12
let lastDay = 31;
let readOnly = false; // true when viewing another admin's month

let students = []; // master list: [{ id, name }]
let extraStudents = []; // students that only exist inside an old record
let days = []; // recorded days: [{ id, date, students, count }]

let editingDate = null; // 'YYYY-MM-DD' while editing an existing day
let checkedIds = new Set(); // ids currently ticked in the checklist
let checklistFilter = "";

guardPage({ active: "home", onReady: startMonthPage });

async function startMonthPage(signedInAdmin) {
  admin = signedInAdmin;

  // --- Read ?id=... from the address bar --------------------------------
  const params = new URLSearchParams(window.location.search);
  monthDocId = params.get("id") || "";

  if (!monthDocId) {
    showToast("That month link is not valid.", "error");
    window.location.replace("dashboard.html");
    return;
  }

  // Confirm the month document exists, and read who it belongs to.
  const monthSnap = await getDoc(doc(db, "months", monthDocId));
  if (!monthSnap.exists()) {
    showToast("That month has not been created yet.", "error");
    window.location.replace("dashboard.html");
    return;
  }
  const monthData = monthSnap.data();
  year = Number(monthData.year);
  month = Number(monthData.month);
  monthOwnerId = monthData.ownerId || "";
  ym = monthData.sortKey || `${year}-${pad2(month)}`;

  if (!year || !month || month < 1 || month > 12) {
    window.location.replace("dashboard.html");
    return;
  }
  lastDay = daysInMonth(year, month);

  // Read-only when this month is not ours (owner viewing another admin).
  readOnly = monthOwnerId !== admin.uid;

  // --- Page heading -----------------------------------------------------
  const title = formatMonthLabel(year, month);
  qs("#month-title").textContent = title;
  document.title = `${title} — Work Aid Attendance`;
  qs("#back-link").addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "dashboard.html";
  });

  if (readOnly) {
    // Show a clear note and hide the "create record" card entirely.
    const banner = qs("#readonly-banner");
    if (banner) {
      banner.textContent = `You are viewing another admin\u2019s ${title} records. This view is read-only — you can browse and print, but not change anything.`;
      banner.hidden = false;
    }
    const createCard = qs("#create-record-card");
    if (createCard) createCard.hidden = true;
  } else {
    setupDateInput();
    setupChecklistToolbar();
    setupCreateForm();
  }

  setupPrintButton();
  loadStudents();
  loadDays();
}

/* --------------------------------------------------------------------------
   Students master list (for the tick-list)
   --------------------------------------------------------------------------
   We load the students belonging to the MONTH's owner — which is you, unless
   the owner is viewing someone else's month.
   -------------------------------------------------------------------------- */
function loadStudents() {
  onSnapshot(
    query(collection(db, "students"), where("ownerId", "==", monthOwnerId)),
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
   Recorded days for this month
   -------------------------------------------------------------------------- */
function loadDays() {
  const loadingEl = qs("#days-loading");
  const listEl = qs("#days-list");

  // Only this month's days for this owner (sorting done here in the browser).
  onSnapshot(
    query(
      collection(db, "months", monthDocId, "days"),
      where("ownerId", "==", monthOwnerId),
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
      listEl.innerHTML = `<div class="alert alert--error">Could not load the recorded days. ${escapeHtml(error.message)}</div>`;
    },
  );
}

function renderDays() {
  const listEl = qs("#days-list");
  const summaryEl = qs("#days-summary");

  if (summaryEl) {
    summaryEl.textContent = days.length
      ? `${days.length} recorded day${days.length === 1 ? "" : "s"} this month`
      : "";
  }

  if (!days.length) {
    listEl.innerHTML = `
      <div class="empty">
        ${ICONS.calendar}
        <h3>No days recorded yet</h3>
        ${readOnly ? "" : `<p>Use “Create Daily Record” to add the first day.</p>`}
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
   Date input
   -------------------------------------------------------------------------- */
function setupDateInput() {
  const dateInput = qs("#record-date");
  dateInput.min = `${ym}-01`;
  dateInput.max = `${ym}-${pad2(lastDay)}`;

  // Pre-select today when it falls inside the month, else the 1st.
  const today = todayISO();
  dateInput.value = today.startsWith(ym) ? today : `${ym}-01`;
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
  if (!date.startsWith(`${ym}-`)) {
    showToast(
      `The date must fall inside ${formatMonthLabel(year, month)}.`,
      "error",
    );
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
    await setDoc(doc(db, "months", monthDocId, "days", date), {
      ownerId: monthOwnerId, // the day belongs to the month's owner
      date,
      students: selected,
      count: selected.length,
      updatedAt: serverTimestamp(),
    });

    // Only a brand-new day increases the month's recorded-day count.
    if (!existing) {
      await updateDoc(doc(db, "months", monthDocId), { dayCount: increment(1) });
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

  const today = todayISO();
  qs("#record-date").value = today.startsWith(ym) ? today : `${ym}-01`;
  renderChecklist();
}

/* --------------------------------------------------------------------------
   Load an existing day into the form (edit mode)
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
   Delete a day
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
    await deleteDoc(doc(db, "months", monthDocId, "days", day.date));
    await updateDoc(doc(db, "months", monthDocId), { dayCount: increment(-1) });

    // If we were editing that day, clear the form.
    if (editingDate === day.date) resetForm();

    showToast(`${formatDayLong(day.date)} deleted.`, "success");
  } catch (error) {
    console.error(error);
    showToast(`Could not delete the record: ${error.message}`, "error");
  }
}

/* --------------------------------------------------------------------------
   Print / download the monthly PDF
   -------------------------------------------------------------------------- */
function setupPrintButton() {
  qs("#print-record").addEventListener("click", () => {
    if (!days.length) {
      showToast("There are no recorded days to print yet.", "warning");
      return;
    }
    try {
      generateMonthlyPdf({ year, month, days, students });
      showToast("Monthly PDF downloaded.", "success");
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
