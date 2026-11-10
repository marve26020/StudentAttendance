/* ==========================================================================
   js/firebase-config.js — Firebase setup (SINGLE SOURCE OF TRUTH)
   --------------------------------------------------------------------------
   This file:
     1. Initialises Firebase with your project config.
     2. Exports the `auth` and `db` handles.
     3. Re-exports the Firebase functions the rest of the app needs.

   Why re-export? Everything else imports from THIS file only. That means the
   Firebase SDK version number below appears in one place, so it is easy to
   upgrade later.
   ========================================================================== */

// Firebase JavaScript SDK — modular API, loaded from the official CDN.
// (v13.2.0 is the version from your Firebase project's setup snippet.)
import {
  initializeApp,
  deleteApp,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  increment,
  getCountFromServer,
} from "https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js";

/* --------------------------------------------------------------------------
   Your web app's Firebase configuration (pasted from the Firebase console)
   -------------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "AIzaSyAjWiD9xc9rWuUbcb8Rt1C5ssMiRhXQnDU",
  authDomain: "student-attendance-f7f93.firebaseapp.com",
  projectId: "student-attendance-f7f93",
  storageBucket: "student-attendance-f7f93.firebasestorage.app",
  messagingSenderId: "732808541510",
  appId: "1:732808541510:web:a3889e1cadb2e715b3e147",
};

/* --------------------------------------------------------------------------
   Initialise Firebase and create the Auth + Firestore services
   -------------------------------------------------------------------------- */
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app); // Authentication (email + password)
export const db = getFirestore(app); // Cloud Firestore database

/* --------------------------------------------------------------------------
   A "secondary" Firebase app used ONLY when creating a new admin.
   --------------------------------------------------------------------------
   Creating a user with createUserWithEmailAndPassword() also signs that new
   user in. That would log out the admin who is doing the adding. To avoid
   that, we create the new account on a separate app instance, then throw that
   instance away. The current admin stays signed in on the main app.
   -------------------------------------------------------------------------- */
export function createSecondaryAuth() {
  const secondaryApp = initializeApp(firebaseConfig, "secondary");
  return { secondaryApp, secondaryAuth: getAuth(secondaryApp) };
}

/* --------------------------------------------------------------------------
   Re-export the Firebase functions used across the app
   -------------------------------------------------------------------------- */
export { deleteApp };
export {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
};
export {
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  deleteField,
  collection,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  increment,
  getCountFromServer,
};
