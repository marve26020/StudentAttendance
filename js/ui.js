/* ==========================================================================
   js/ui.js — Shared user-interface helpers
   --------------------------------------------------------------------------
   Small, reusable pieces used by every page:
     • query helpers          • toast messages
     • button loading state   • confirm / prompt dialogs
     • date + month formatting
     • the top navigation bar (with mobile hamburger)
     • a set of inline SVG icons
   ========================================================================== */

import { APP_CONFIG } from "./config.js";

/* --------------------------------------------------------------------------
   Tiny DOM helpers
   -------------------------------------------------------------------------- */
export const qs = (selector, root = document) => root.querySelector(selector);
export const qsa = (selector, root = document) =>
  Array.from(root.querySelectorAll(selector));

/** Escape text before putting it into HTML (prevents broken markup / XSS). */
export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/* --------------------------------------------------------------------------
   Month / date helpers
   -------------------------------------------------------------------------- */
export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const pad2 = (n) => String(n).padStart(2, "0");
export const monthName = (month) => MONTH_NAMES[month - 1] || "";

/** 'YYYY-MM-DD' → '21 November 2026' */
export function formatDayLong(isoDate) {
  const [y, m, d] = String(isoDate).split("-").map(Number);
  return `${d} ${monthName(m)} ${y}`;
}

/** 'YYYY-MM-DD' → '21/11/26' (day/month/two-digit year), for the PDF column headings. */
export function formatShortDate(isoDate) {
  const [y, m, d] = String(isoDate).split("-");
  return `${d}/${m}/${String(y).slice(-2)}`;
}

/** Today as 'YYYY-MM-DD' (local time, not UTC). */
export function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
}

/** Format a Firestore Timestamp (or anything Date-like) as '12 Nov 2026'. */
export function formatAddedDate(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") return "";
  const d = timestamp.toDate();
  return `${d.getDate()} ${monthName(d.getMonth() + 1).slice(0, 3)} ${d.getFullYear()}`;
}

/* --------------------------------------------------------------------------
   Toast messages (top-right notifications)
   type: 'success' | 'error' | 'info' | 'warning'
   -------------------------------------------------------------------------- */
export function showToast(message, type = "info", timeout = 4200) {
  let stack = document.getElementById("toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.id = "toast-stack";
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  el.setAttribute("role", type === "error" ? "alert" : "status");
  el.innerHTML = `<span class="toast__dot"></span><span>${escapeHtml(message)}</span>`;
  stack.appendChild(el);
  setTimeout(() => {
    el.classList.add("is-leaving");
    setTimeout(() => el.remove(), 200);
  }, timeout);
}

/* --------------------------------------------------------------------------
   Button loading state
   -------------------------------------------------------------------------- */
export function setLoading(button, isLoading) {
  if (!button) return;
  button.classList.toggle("is-loading", isLoading);
  button.disabled = isLoading;
}

/* --------------------------------------------------------------------------
   Confirm dialog → resolves true / false
   -------------------------------------------------------------------------- */
export function confirmModal({
  title = "Are you sure?",
  message = "",
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" data-act="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="btn ${danger ? "btn--danger" : "btn--primary"}" data-act="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const finish = (value) => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(false);
    };

    backdrop
      .querySelector('[data-act="cancel"]')
      .addEventListener("click", () => finish(false));
    backdrop
      .querySelector('[data-act="ok"]')
      .addEventListener("click", () => finish(true));
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(false);
    });
    document.addEventListener("keydown", onKey);
    backdrop.querySelector('[data-act="ok"]').focus();
  });
}

/* --------------------------------------------------------------------------
   Prompt dialog (single text input) → resolves the string, or null if cancelled
   Used for renaming a student.
   -------------------------------------------------------------------------- */
export function promptModal({
  title = "Edit",
  label = "Value",
  value = "",
  confirmLabel = "Save",
} = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <div class="field" style="margin-top:16px">
          <label for="prompt-input">${escapeHtml(label)}</label>
          <input id="prompt-input" class="input" type="text" />
        </div>
        <div class="modal__actions">
          <button type="button" class="btn btn--ghost" data-act="cancel">Cancel</button>
          <button type="button" class="btn btn--primary" data-act="ok">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(backdrop);

    const input = backdrop.querySelector("#prompt-input");
    input.value = value;

    const finish = (val) => {
      document.removeEventListener("keydown", onKey);
      backdrop.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") finish(null);
    };
    const submit = () => {
      const v = input.value.trim();
      if (!v) {
        input.focus();
        return;
      }
      finish(v);
    };

    backdrop
      .querySelector('[data-act="cancel"]')
      .addEventListener("click", () => finish(null));
    backdrop.querySelector('[data-act="ok"]').addEventListener("click", submit);
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) finish(null);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
    document.addEventListener("keydown", onKey);
    input.focus();
    input.select();
  });
}

/* --------------------------------------------------------------------------
   Inline SVG icons (stroke uses currentColor so CSS controls the colour)
   -------------------------------------------------------------------------- */
export const ICONS = {
  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
  calendar:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
  folders:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z"/><path d="M4 10h16"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>',
  print:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 14h12v8H6z"/></svg>',
  info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13a2 2 0 0 1 1.8 1.1L23 12v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-6L3.7 6.1A2 2 0 0 1 5.5 5Z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A9.1 9.1 0 0 1 12 4c6.5 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19M6.6 6.6A18.6 18.6 0 0 0 2 12s3.5 8 10 8a9.1 9.1 0 0 0 5.4-1.6"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><path d="m2 2 20 20"/></svg>',
};

/* --------------------------------------------------------------------------
   Top navigation bar
   -------------------------------------------------------------------------- */

/** Build the logo <img> with an automatic fallback if the file is missing. */
export function logoImg(className = "") {
  return `<img class="${className}" src="${APP_CONFIG.logoPath}" alt="${escapeHtml(APP_CONFIG.schoolName)} logo"
            onerror="this.onerror=null;this.src='${APP_CONFIG.logoFallback}'">`;
}

/** The navigation links. `active` highlights the current page.
 *  `admin` is the signed-in admin object; only the OWNER sees the admin links. */
function navMarkup(active, admin = {}) {
  const link = (href, key, text, extraClass = "") =>
    `<a href="${href}" class="${active === key ? "is-active" : ""} ${extraClass}">${text}</a>`;

  // "Add Admin" and "All Admins" are owner-only. Regular admins never see them.
  const ownerLinks =
    admin.role === "owner"
      ? `${link("all-admins.html", "all-admins", "All Admins")}
         ${link("add-admin.html", "add-admin", "Add Admin")}`
      : "";

  return `
    <a class="brand" href="dashboard.html">
      ${logoImg()}
      <span class="brand__text">
        <span class="brand__school">${escapeHtml(APP_CONFIG.schoolName)}</span>
        <span class="brand__program">${escapeHtml(APP_CONFIG.programName)}</span>
      </span>
    </a>
    <button class="nav-toggle" type="button" aria-label="Toggle navigation menu" aria-expanded="false"><span></span></button>
    <nav class="nav-links" id="nav-links">
      ${link("dashboard.html", "home", "Home")}
      ${link("students.html", "students", "Students")}
      ${link("about.html", "about", "About")}
      ${ownerLinks}
      <a href="#" class="nav-logout" data-action="logout">Logout</a>
    </nav>`;
}

/**
 * Insert the navigation bar at the top of <body> and wire up the hamburger
 * menu plus the Logout link.
 * `admin` (optional) is passed through so the nav can show owner-only links.
 */
export function mountNav({ active = "", onLogout, admin = {} } = {}) {
  const header = document.createElement("header");
  header.className = "navbar";
  header.innerHTML = `<div class="navbar__inner container">${navMarkup(active, admin)}</div>`;
  document.body.insertBefore(header, document.body.firstChild);

  const toggle = header.querySelector(".nav-toggle");
  const links = header.querySelector(".nav-links");
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });

  const logout = header.querySelector('[data-action="logout"]');
  if (logout && onLogout) {
    logout.addEventListener("click", (e) => {
      e.preventDefault();
      onLogout();
    });
  }
}

/** Fill the branding text elements from config (school + program name). */
export function applyBranding(root = document) {
  const setText = (id, text) => {
    const el = root.getElementById?.(id);
    if (el) el.textContent = text;
  };
  setText("brand-school", APP_CONFIG.schoolName); // desktop brand panel
  setText("brand-school-mobile", APP_CONFIG.schoolName); // mobile logo row
  setText("brand-program", APP_CONFIG.programName);
}
