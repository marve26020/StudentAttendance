/* ==========================================================================
   js/auth.js — Authentication + access control
   --------------------------------------------------------------------------
   Responsibilities:
     • Sign in with email + password.
     • Confirm the signed-in user really is a registered admin.
     • Guard every protected page (redirect non-admins to the login page).
     • Guard owner-only pages (Add Admin / All Admins).
     • Log out.

   "Registered admin" = a document exists at Firestore path admins/{uid}.
   That document also carries the admin's ROLE:
     • role "owner"  → you. Sees every admin's data; the only one who can
                        add, disable or remove admins.
     • role "admin"  → a regular admin (e.g. a course rep). Sees only the
                        students/months/days that they themselves created.
   ========================================================================== */

import {
  auth,
  db,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  createUserWithEmailAndPassword,
  createSecondaryAuth,
  deleteApp,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "./firebase-config.js";
import {
  qs,
  showToast,
  setLoading,
  mountNav,
  applyBranding,
  ICONS,
} from "./ui.js";

/* The two roles an admin record can have. */
export const ROLES = { OWNER: "owner", ADMIN: "admin" };

/* The admin currently signed in (filled in by guardPage). */
let currentAdmin = null;
export const getCurrentAdmin = () => currentAdmin;

/* Is the signed-in user the owner? */
export const isOwner = () =>
  Boolean(currentAdmin) && currentAdmin.role === ROLES.OWNER;

/* Map Firebase error codes to friendly, human messages. */
export function friendlyAuthError(error) {
  const code = error && error.code ? error.code : "";
  switch (code) {
    case "auth/invalid-email":
      return "That email address doesn’t look right.";
    case "auth/missing-password":
      return "Please enter your password.";
    case "auth/user-not-found":
      return "No account found with that email.";
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Incorrect email or password.";
    case "auth/email-already-in-use":
      return "That email is already registered.";
    case "auth/weak-password":
      return "Please choose a password with at least 6 characters.";
    case "auth/too-many-requests":
      return "Too many attempts. Please wait a moment and try again.";
    case "auth/network-request-failed":
      return "Network error. Please check your internet connection.";
    case "auth/invalid-api-key":
    case "auth/api-key-not-valid":
    case "auth/configuration-not-found":
      return "Firebase is not configured correctly. Check your project settings and that Email/Password sign-in is enabled.";
    default:
      return (
        (error && error.message) || "Something went wrong. Please try again."
      );
  }
}

/* --------------------------------------------------------------------------
   Log out
   -------------------------------------------------------------------------- */
export async function logout() {
  try {
    await signOut(auth);
  } catch (error) {
    console.error(error);
  }
  window.location.replace("index.html");
}

/* --------------------------------------------------------------------------
   Page guard — call this at the top of every protected page.
   --------------------------------------------------------------------------
   guardPage({ active: 'students', onReady: (admin) => { ...your page code... } })

   Options:
     • active        — which nav link to highlight.
     • requireOwner  — set true for owner-only pages (Add Admin / All Admins).
     • onReady(admin)— runs once we know the visitor is allowed.

   What happens:
     • Not signed in                → go to the login page.
     • Signed in but not an admin   → sign out, then login page with a message.
     • Admin, but disabled          → sign out, login page says access disabled.
     • Owner-only page, not owner   → back to the dashboard with a message.
     • Signed in and allowed        → build the nav and run onReady(admin).
   -------------------------------------------------------------------------- */
export function guardPage({ active = "", requireOwner = false, onReady } = {}) {
  let handled = false;

  onAuthStateChanged(auth, async (user) => {
    // Redirect straight away if nobody is signed in.
    if (!user) {
      if (!handled) {
        handled = true;
        window.location.replace("index.html");
      }
      return;
    }
    if (handled) return;

    try {
      const snap = await getDoc(doc(db, "admins", user.uid));
      if (!snap.exists()) {
        // Signed in, but this account is not a registered admin.
        await signOut(auth);
        window.location.replace("index.html?reason=not-admin");
        return;
      }

      const data = snap.data();

      // The owner may switch an admin off without deleting them.
      if (data.disabled === true) {
        await signOut(auth);
        window.location.replace("index.html?reason=disabled");
        return;
      }

      handled = true;
      // role defaults to "admin" for any older record that has no role field.
      currentAdmin = {
        uid: user.uid,
        email: user.email,
        role: data.role || ROLES.ADMIN,
        ...data,
      };

      // Owner-only pages: bounce a regular admin back to the dashboard.
      if (requireOwner && currentAdmin.role !== ROLES.OWNER) {
        window.location.replace("dashboard.html?denied=1");
        return;
      }

      mountNav({ active, onLogout: logout, admin: currentAdmin });
      if (typeof onReady === "function") onReady(currentAdmin);
    } catch (error) {
      console.error(error);
      showToast(friendlyAuthError(error), "error");
    }
  });
}

/* --------------------------------------------------------------------------
   Login page (index.html)
   -------------------------------------------------------------------------- */
export function initLoginPage() {
  applyBranding(document);
  const form = qs("#login-form");
  const nameInput = qs("#login-name");
  const emailInput = qs("#login-email");
  const passwordInput = qs("#login-password");
  const submitButton = qs("#login-submit");
  const alertBox = qs("#login-alert");

  /** Show the page-level alert box. type: 'error' | 'info' | 'success' */
  const showAlert = (message, type = "error") => {
    if (!alertBox) return;
    alertBox.className = `alert alert--${type}`;
    alertBox.textContent = message;
    alertBox.hidden = false;
  };
  const hideAlert = () => {
    if (alertBox) alertBox.hidden = true;
  };

  // If a non-admin (or a disabled admin) was bounced here, explain why.
  const reason = new URLSearchParams(window.location.search).get("reason");
  if (reason === "not-admin") {
    showAlert("This account is not a registered admin.", "error");
  } else if (reason === "disabled") {
    showAlert("Your admin access has been disabled by the owner.", "error");
  }

  // Show / hide the password so you can check what you typed.
  const toggle = qs("#toggle-password");
  if (toggle && passwordInput) {
    toggle.innerHTML = ICONS.eye;
    toggle.addEventListener("click", () => {
      const nowVisible = passwordInput.type === "password";
      passwordInput.type = nowVisible ? "text" : "password";
      toggle.setAttribute("aria-pressed", String(nowVisible));
      toggle.setAttribute(
        "aria-label",
        nowVisible ? "Hide password" : "Show password",
      );
      toggle.innerHTML = nowVisible ? ICONS.eyeOff : ICONS.eye;
      passwordInput.focus();
    });
  }

  // Already signed in as an admin? Go straight to the dashboard.
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    const snap = await getDoc(doc(db, "admins", user.uid));
    if (snap.exists() && snap.data().disabled !== true) {
      window.location.replace("dashboard.html");
    } else {
      await signOut(auth);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    hideAlert();

    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;

    // --- Friendly validation of empty fields ---------------------------
    if (!name || !email || !password) {
      nameInput.classList.toggle("is-invalid", !name);
      emailInput.classList.toggle("is-invalid", !email);
      passwordInput.classList.toggle("is-invalid", !password);
      showAlert("Please fill in your name, email and password.", "error");
      return;
    }
    nameInput.classList.remove("is-invalid");
    emailInput.classList.remove("is-invalid");
    passwordInput.classList.remove("is-invalid");

    setLoading(submitButton, true);
    try {
      // 1. Sign in with Firebase Authentication.
      const credential = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );

      // 2. Check this account is a registered (and not disabled) admin.
      const snap = await getDoc(doc(db, "admins", credential.user.uid));
      if (!snap.exists()) {
        await signOut(auth);
        showAlert("This account is not a registered admin.", "error");
        return;
      }
      if (snap.data().disabled === true) {
        await signOut(auth);
        showAlert("Your admin access has been disabled by the owner.", "error");
        return;
      }

      // Remember the name they typed, so the dashboard can greet them with it.
      // (Keyed by their user id, so two admins on one browser don't clash.)
      try {
        localStorage.setItem(`swa_name_${credential.user.uid}`, name);
      } catch (_) {
        /* private browsing — the greeting just falls back to the saved name */
      }

      showAlert("Signed in. Taking you to your dashboard…", "success");
      window.location.replace("dashboard.html");
    } catch (error) {
      console.error(error);
      showAlert(friendlyAuthError(error), "error");
    } finally {
      setLoading(submitButton, false);
    }
  });
}
