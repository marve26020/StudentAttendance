/* ==========================================================================
   js/students.js — Students page (students.html)
   --------------------------------------------------------------------------
   The master list of students. Used as the tick-list on the month page, so
   names never have to be re-typed each day.
     • Add a student (name only)
     • Rename a student
     • Remove a student
     • Search / filter
   Note: removing a student does NOT change past attendance records, because
   each daily record keeps its own copy of the names.
   ========================================================================== */

import { guardPage } from "./auth.js";
import {
  db,
  collection,
  onSnapshot,
  query,
  where,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from "./firebase-config.js";
import {
  qs,
  showToast,
  setLoading,
  escapeHtml,
  confirmModal,
  promptModal,
  formatAddedDate,
  ICONS,
} from "./ui.js";

let allStudents = []; // { id, name, createdAt }
let searchTerm = "";

guardPage({ active: "students", onReady: startStudentsPage });

function startStudentsPage(admin) {
  setupSearch();
  setupAddForm(admin);
  loadStudents(admin);
}

/* --------------------------------------------------------------------------
   Load the master list (live updates)
   --------------------------------------------------------------------------
   Only the students YOU created are loaded (ownerId == your id).
   -------------------------------------------------------------------------- */
function loadStudents(admin) {
  const listEl = qs("#students-list");
  const loadingEl = qs("#students-loading");

  onSnapshot(
    query(collection(db, "students"), where("ownerId", "==", admin.uid)),
    (snapshot) => {
      if (loadingEl) loadingEl.hidden = true;

      allStudents = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) =>
          (a.name || "").localeCompare(b.name || "", undefined, {
            sensitivity: "base",
          }),
        );

      renderStudents();
    },
    (error) => {
      console.error(error);
      if (loadingEl) loadingEl.hidden = true;
      listEl.innerHTML = `<div class="alert alert--error">Could not load students. ${escapeHtml(error.message)}</div>`;
    },
  );
}

/* --------------------------------------------------------------------------
   Render the list (applying the current search term)
   -------------------------------------------------------------------------- */
function renderStudents() {
  const listEl = qs("#students-list");
  const countEl = qs("#students-count");

  const term = searchTerm.trim().toLowerCase();
  const visible = term
    ? allStudents.filter((s) => (s.name || "").toLowerCase().includes(term))
    : allStudents;

  if (countEl) {
    countEl.textContent = term
      ? `${visible.length} of ${allStudents.length} students`
      : `${allStudents.length} student${allStudents.length === 1 ? "" : "s"} in the master list`;
  }

  if (!allStudents.length) {
    listEl.innerHTML = `
      <div class="empty">
        ${ICONS.users}
        <h3>No students yet</h3>
        <p>Add your students above — you’ll tick them off each day.</p>
      </div>`;
    return;
  }

  if (!visible.length) {
    listEl.innerHTML = `
      <div class="empty">
        ${ICONS.search}
        <h3>No matches</h3>
        <p>No student matches “${escapeHtml(searchTerm)}”.</p>
      </div>`;
    return;
  }

  listEl.innerHTML = `<div class="list">${visible.map(studentRow).join("")}</div>`;

  // Wire up the row buttons.
  visible.forEach((student) => {
    const editBtn = qs(`#edit-${student.id}`);
    const deleteBtn = qs(`#delete-${student.id}`);
    if (editBtn)
      editBtn.addEventListener("click", () => renameStudent(student));
    if (deleteBtn)
      deleteBtn.addEventListener("click", () => removeStudent(student));
  });
}

function studentRow(student) {
  const added = formatAddedDate(student.createdAt);
  return `
    <div class="list-row">
      <div class="list-row__main">
        <div class="list-row__title">${escapeHtml(student.name)}</div>
        ${added ? `<div class="list-row__meta">Added ${escapeHtml(added)}</div>` : ""}
      </div>
      <div class="list-row__actions">
        <button class="icon-btn primary" id="edit-${student.id}" type="button"
                title="Rename ${escapeHtml(student.name)}" aria-label="Rename ${escapeHtml(student.name)}">
          ${ICONS.edit}
        </button>
        <button class="icon-btn danger" id="delete-${student.id}" type="button"
                title="Remove ${escapeHtml(student.name)}" aria-label="Remove ${escapeHtml(student.name)}">
          ${ICONS.trash}
        </button>
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   Search box
   -------------------------------------------------------------------------- */
function setupSearch() {
  const input = qs("#students-search");
  input.addEventListener("input", () => {
    searchTerm = input.value;
    renderStudents();
  });
}

/* --------------------------------------------------------------------------
   Add a student
   -------------------------------------------------------------------------- */
function setupAddForm(admin) {
  const form = qs("#add-student-form");
  const input = qs("#new-student-name");
  const submitButton = qs("#add-student-submit");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = input.value.trim();

    if (!name) {
      showToast("Please type a student name.", "error");
      input.focus();
      return;
    }
    const duplicate = allStudents.some(
      (s) => (s.name || "").toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) {
      showToast(`“${name}” is already in the list.`, "warning");
      return;
    }

    setLoading(submitButton, true);
    try {
      await addDoc(collection(db, "students"), {
        name,
        ownerId: admin.uid, // this student belongs to the admin who added it
        createdAt: serverTimestamp(),
      });
      input.value = "";
      input.focus();
      showToast(`${name} added.`, "success");
    } catch (error) {
      console.error(error);
      showToast(`Could not add the student: ${error.message}`, "error");
    } finally {
      setLoading(submitButton, false);
    }
  });
}

/* --------------------------------------------------------------------------
   Rename a student
   -------------------------------------------------------------------------- */
async function renameStudent(student) {
  const newName = await promptModal({
    title: "Rename student",
    label: "Student name",
    value: student.name,
    confirmLabel: "Save name",
  });
  if (!newName || newName === student.name) return;

  const duplicate = allStudents.some(
    (s) =>
      s.id !== student.id &&
      (s.name || "").toLowerCase() === newName.toLowerCase(),
  );
  if (duplicate) {
    showToast(`“${newName}” is already in the list.`, "warning");
    return;
  }

  try {
    await updateDoc(doc(db, "students", student.id), { name: newName });
    showToast("Name updated.", "success");
  } catch (error) {
    console.error(error);
    showToast(`Could not rename: ${error.message}`, "error");
  }
}

/* --------------------------------------------------------------------------
   Remove a student
   -------------------------------------------------------------------------- */
async function removeStudent(student) {
  const confirmed = await confirmModal({
    title: "Remove student",
    message: `Remove “${student.name}” from the master list? Past attendance records will stay unchanged.`,
    confirmLabel: "Remove",
    danger: true,
  });
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "students", student.id));
    showToast(`${student.name} removed.`, "success");
  } catch (error) {
    console.error(error);
    showToast(`Could not remove the student: ${error.message}`, "error");
  }
}
