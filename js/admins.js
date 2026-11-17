/* ==========================================================================
   js/admins.js — Owner-only admin management
   --------------------------------------------------------------------------
   Used by two pages (both OWNER ONLY — a regular admin is redirected away by
   the page guard in js/auth.js):

     • add-admin.html  → initAddAdminPage()
         Add a new admin, and Disable / Enable / Remove existing ones.

     • all-admins.html → initAllAdminsPage()
         Browse every admin and view their students + records
         (read-only).

   How a new admin is created without logging you out:
     createUserWithEmailAndPassword() signs the new user in on the app it is
     called on. We call it on a SECONDARY app instance (see
     createSecondaryAuth in js/firebase-config.js) and throw that instance
     away, so your own session is untouched.
   ========================================================================== */

import {
  db,
  collection,
  onSnapshot,
  query,
  where,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  createSecondaryAuth,
  createUserWithEmailAndPassword,
  signOut,
  deleteApp,
} from "./firebase-config.js";
import {
  qs,
  showToast,
  setLoading,
  escapeHtml,
  confirmModal,
  ICONS,
} from "./ui.js";
import { getCurrentAdmin, friendlyAuthError, ROLES } from "./auth.js";

/* A small coloured label: Owner or Admin. */
function roleBadge(role) {
  const owner = role === ROLES.OWNER;
  return `<span class="badge ${owner ? "badge--owner" : "badge--admin"}">${owner ? "Owner" : "Admin"}</span>`;
}

/* Sort admin objects by name (done in the browser — no database index needed). */
function byName(a, b) {
  return String(a.name || a.email || "").localeCompare(
    String(b.name || b.email || ""),
    undefined,
    { sensitivity: "base" },
  );
}

/* ==========================================================================
   add-admin.html
   ========================================================================== */
export function initAddAdminPage() {
  const me = getCurrentAdmin();

  /* ------------------------------ Add a new admin ---------------------- */
  const form = qs("#add-admin-form");
  const alertBox = qs("#addadmin-alert");
  const submitButton = qs("#addadmin-submit");

  const showAlert = (message, type = "success") => {
    if (!alertBox) return;
    alertBox.className = `alert alert--${type}`;
    alertBox.textContent = message;
    alertBox.hidden = false;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (alertBox) alertBox.hidden = true;

    const name = qs("#admin-name").value.trim();
    const email = qs("#admin-email").value.trim();
    const password = qs("#admin-password").value;
    const confirm = qs("#admin-password-confirm").value;

    if (!name || !email || !password) {
      showAlert("Please fill in the name, email and password.", "error");
      return;
    }
    if (password.length < 6) {
      showAlert("The password must be at least 6 characters long.", "error");
      return;
    }
    if (password !== confirm) {
      showAlert("The two passwords do not match.", "error");
      return;
    }

    setLoading(submitButton, true);
    const { secondaryApp, secondaryAuth } = createSecondaryAuth();
    try {
      const credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        email,
        password,
      );
      const newUid = credential.user.uid;

      // Register the new user as a REGULAR admin (role "admin").
      await setDoc(doc(db, "admins", newUid), {
        name,
        email,
        role: ROLES.ADMIN,
        disabled: false,
        createdAt: serverTimestamp(),
      });

      await signOut(secondaryAuth);
      await deleteApp(secondaryApp);

      form.reset();
      showAlert(`Admin “${name}” was added successfully.`, "success");
      showToast("New admin created.", "success");
    } catch (error) {
      console.error(error);
      try {
        await deleteApp(secondaryApp);
      } catch (_) {
        /* ignore */
      }
      showAlert(friendlyAuthError(error), "error");
    } finally {
      setLoading(submitButton, false);
    }
  });

  /* -------------------- Manage the existing admins --------------------- */
  const listEl = qs("#admins-list");
  const loadingEl = qs("#admins-loading");

  onSnapshot(
    query(collection(db, "admins")),
    (snapshot) => {
      if (loadingEl) loadingEl.hidden = true;
      const admins = snapshot.docs
        .map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }))
        .sort(byName);

      listEl.innerHTML = `<div class="list">${admins.map((a) => adminRow(a, me)).join("")}</div>`;

      admins.forEach((a) => {
        const toggleBtn = qs(`#toggle-${a.uid}`);
        const removeBtn = qs(`#remove-${a.uid}`);
        if (toggleBtn)
          toggleBtn.addEventListener("click", () => toggleDisabled(a));
        if (removeBtn)
          removeBtn.addEventListener("click", () => removeAdmin(a));
      });
    },
    (error) => {
      console.error(error);
      if (loadingEl) loadingEl.hidden = true;
      listEl.innerHTML = `<div class="alert alert--error">Could not load admins. ${escapeHtml(error.message)}</div>`;
    },
  );
}

/* One row per admin, with Disable/Enable and Remove actions.
   The owner cannot be disabled or removed — it would lock everybody out. */
function adminRow(a, me) {
  const isOwnerRow = a.role === ROLES.OWNER;
  const isMe = a.uid === me.uid;
  const locked = isOwnerRow || isMe; // protected rows

  const status = a.disabled
    ? '<span class="badge badge--muted">Disabled</span>'
    : '<span class="badge badge--ok">Active</span>';

  const actions = locked
    ? '<span class="helper">Protected</span>'
    : `<div class="list-row__actions">
         <button class="btn btn--ghost btn--sm" id="toggle-${a.uid}" type="button">
           ${a.disabled ? "Enable" : "Disable"}
         </button>
         <button class="btn btn--danger-ghost btn--sm" id="remove-${a.uid}" type="button">
           ${ICONS.trash} Remove
         </button>
       </div>`;

  return `
    <div class="list-row">
      <div class="list-row__main">
        <div class="list-row__title">
          ${escapeHtml(a.name || "Unnamed admin")} ${roleBadge(a.role)} ${status}
        </div>
        <div class="list-row__meta">${escapeHtml(a.email || "")}</div>
      </div>
      ${actions}
    </div>`;
}

/* Switch an admin's access off / back on (keeps their record and data). */
async function toggleDisabled(a) {
  const turningOn = a.disabled === true; // currently disabled → enable
  const confirmed = await confirmModal({
    title: turningOn ? "Enable admin" : "Disable admin",
    message: turningOn
      ? `Allow ${a.name || a.email} to sign in again?`
      : `${a.name || a.email} will no longer be able to sign in or see their data. Their records are kept and stay visible to you.`,
    confirmLabel: turningOn ? "Enable" : "Disable",
    danger: !turningOn,
  });
  if (!confirmed) return;

  try {
    await updateDoc(doc(db, "admins", a.uid), { disabled: !turningOn });
    showToast(turningOn ? "Admin enabled." : "Admin disabled.", "success");
  } catch (error) {
    console.error(error);
    showToast(`Could not update the admin: ${error.message}`, "error");
  }
}

/* Delete an admin record entirely. They can no longer sign in or see data,
   but their students / records / recorded dates stay in the database for the
   owner. */
async function removeAdmin(a) {
  const confirmed = await confirmModal({
    title: "Remove admin",
    message: `Remove ${a.name || a.email} completely? They will no longer be able to sign in. Their records stay in the database and remain visible to you.`,
    confirmLabel: "Remove admin",
    danger: true,
  });
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "admins", a.uid));
    showToast("Admin removed.", "success");
  } catch (error) {
    console.error(error);
    showToast(`Could not remove the admin: ${error.message}`, "error");
  }
}

/* ==========================================================================
   all-admins.html
   ========================================================================== */
let unsubRecords = null;
let unsubStudents = null;

export function initAllAdminsPage() {
  const listEl = qs("#admins-list");
  const loadingEl = qs("#admins-loading");

  onSnapshot(
    query(collection(db, "admins")),
    (snapshot) => {
      if (loadingEl) loadingEl.hidden = true;
      const admins = snapshot.docs
        .map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }))
        .sort(byName);

      listEl.innerHTML = admins
        .map(
          (a) => `
        <button class="record-tile admin-tile" type="button" data-uid="${escapeHtml(a.uid)}" data-name="${escapeHtml(a.name || a.email || "Admin")}">
          <span class="record-tile__name">${escapeHtml(a.name || "Unnamed admin")} ${roleBadge(a.role)}</span>
          <span class="record-tile__meta">${escapeHtml(a.email || "")}</span>
        </button>`,
        )
        .join("");

      listEl.querySelectorAll(".admin-tile").forEach((tile) => {
        tile.addEventListener("click", () => {
          listEl
            .querySelectorAll(".admin-tile")
            .forEach((t) => t.classList.remove("is-active"));
          tile.classList.add("is-active");
          showAdminDetail(tile.dataset.uid, tile.dataset.name);
        });
      });
    },
    (error) => {
      console.error(error);
      if (loadingEl) loadingEl.hidden = true;
      listEl.innerHTML = `<div class="alert alert--error">Could not load admins. ${escapeHtml(error.message)}</div>`;
    },
  );
}

/* Load the selected admin's records and students (read-only). */
function showAdminDetail(uid, name) {
  if (typeof unsubRecords === "function") unsubRecords();
  if (typeof unsubStudents === "function") unsubStudents();

  const detail = qs("#admin-detail");
  const detailName = qs("#detail-name");
  const recordsEl = qs("#detail-records");
  const studentsEl = qs("#detail-students");
  detail.hidden = false;
  detailName.textContent = name;
  recordsEl.innerHTML = '<div class="skeleton"></div>';
  studentsEl.innerHTML = '<div class="skeleton"></div>';

  // Records (titles) belonging to this admin.
  unsubRecords = onSnapshot(
    query(collection(db, "records"), where("ownerId", "==", uid)),
    (snapshot) => {
      const records = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) =>
          String(a.title || "").localeCompare(
            String(b.title || ""),
            undefined,
            {
              sensitivity: "base",
            },
          ),
        );

      recordsEl.innerHTML = records.length
        ? `<div class="record-grid">${records
            .map(
              (r) => `
            <a class="record-tile" href="record.html?id=${encodeURIComponent(r.id)}">
              <span class="record-tile__name">${escapeHtml(r.title || "Untitled record")}</span>
              <span class="record-tile__meta">${Number(r.dayCount) || 0} recorded date${(Number(r.dayCount) || 0) === 1 ? "" : "s"}</span>
            </a>`,
            )
            .join("")}</div>`
        : `<div class="empty">${ICONS.inbox}<h3>No records</h3><p>This admin has not created any records yet.</p></div>`;
    },
    (error) => {
      console.error(error);
      recordsEl.innerHTML = `<div class="alert alert--error">Could not load records. ${escapeHtml(error.message)}</div>`;
    },
  );

  // Students belonging to this admin.
  unsubStudents = onSnapshot(
    query(collection(db, "students"), where("ownerId", "==", uid)),
    (snapshot) => {
      const students = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), undefined, {
            sensitivity: "base",
          }),
        );

      studentsEl.innerHTML = students.length
        ? `<div class="name-pills">${students
            .map((s) => `<span class="pill">${escapeHtml(s.name)}</span>`)
            .join("")}</div>`
        : `<div class="empty">${ICONS.users}<h3>No students</h3><p>This admin has no students in their list yet.</p></div>`;
    },
    (error) => {
      console.error(error);
      studentsEl.innerHTML = `<div class="alert alert--error">Could not load students. ${escapeHtml(error.message)}</div>`;
    },
  );
}
