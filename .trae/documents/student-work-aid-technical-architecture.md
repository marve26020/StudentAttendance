# Student Work Aid Attendance — Technical Architecture

## 1. Architecture Design

```mermaid
flowchart LR
  subgraph Client["Static frontend (HTML / CSS / vanilla JS)"]
    A["Login page"]
    B["Dashboard"]
    C["Students page"]
    D["Record page"]
    E["Owner tools: Add Admin, All Admins, Convert"]
    F["Shared JS: auth, firebase-config, ui"]
  end
  subgraph BaaS["Firebase (external service)"]
    G["Firebase Authentication (Email/Password)"]
    H["Cloud Firestore (admins, students, records, days)"]
    I["Firebase Hosting (optional deploy)"]
  end
  F --> G
  F --> H
  A --> F
  B --> F
  C --> F
  D --> F
  E --> F
  I -. serves .-> Client
```

All pages are static files. The Firebase **web SDK (v13.2.0, ES module)** is loaded from the
`gstatic` CDN via `<script type="module">`. No build step, no bundler, no framework.

## 2. Technology Description

* **Frontend**: plain HTML5 + CSS3 (custom properties) + vanilla JavaScript (ES modules). **No React, no build tools** — per the user's explicit request.

* **Initialization Tool**: none (hand-written static files).

* **Backend**: Firebase Authentication (Email/Password) + Cloud Firestore.

* **Database**: Cloud Firestore (NoSQL documents/collections).

* **PDF generation**: `jsPDF` + `jspdf-autotable` from CDN (chosen over a print stylesheet because the
  requirement is a *downloadable* PDF — see rationale in §7).

* **Fonts**: Google Fonts — **Fraunces** (display) + **Manrope** (body).

* **Icons**: inline SVG.

* **Hosting**: Firebase Hosting (or Netlify) — both free.

### File Structure

```
studentWorkAid/
├─ index.html            # Login page (first page visitors see)
├─ dashboard.html        # Home / admin dashboard (Stored Records + Add Record)
├─ students.html         # Master student list
├─ record.html           # Single record page (one title: recorded dates + create + print)
├─ add-admin.html        # Add / disable / remove admins (owner-only)
├─ all-admins.html       # Browse every admin's data (owner-only)
├─ migrate.html          # One-time converter: old months → titled records (owner-only)
├─ about.html            # About page
├─ images/
│  └─ logo.png           # Placeholder school logo (replace with your own)
├─ css/
│  └─ style.css          # All styles; colour tokens as CSS variables at the top
└─ js/
   ├─ firebase-config.js # Firebase init + exported auth/db handles
   ├─ auth.js            # Sign in/out, admin + role check, page guard
   ├─ ui.js              # Shared UI helpers: nav, toasts, loading, date formatting
   ├─ students.js        # Students page logic
   ├─ records.js         # Dashboard: list records + create record (by title)
   ├─ record.js          # Record page: recorded dates, create/edit/delete day
   ├─ admins.js          # Owner tooling: add/disable/remove admins + browse all
   ├─ migrate.js         # One-time conversion of old months → titled records
   └─ pdf.js             # Per-record attendance PDF (jsPDF + autoTable)
```

## 3. Route Definitions

Multi-page app (real files, not a SPA router):

| Route                   | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `/index.html`           | Login page (public). Redirects to `dashboard.html` if already an admin. |
| `/dashboard.html`       | Home; Stored Records list + Add Record. Admin-only.                     |
| `/students.html`        | Master student list (add/edit/delete/search). Admin-only.               |
| `/record.html?id=<docId>`| One record (a title): recorded dates, create daily record, rename/delete, print PDF. Admin-only. Read-only when the owner views another admin's record. |
| `/add-admin.html`       | Add / disable / remove admins. **Owner-only.**                          |
| `/all-admins.html`      | Browse every admin's students + records (read-only). **Owner-only.**    |
| `/migrate.html`         | Convert old monthly records to titled records (one time). **Owner-only.** |
| `/about.html`           | About the program. Admin-only.                                          |
| `/logout` (action)      | Sign out via Firebase Auth, then return to `index.html`.                |

## 4. API Definitions

No custom backend API. The app talks to Firebase directly through the SDK:

| Operation               | Firebase call                                                                     |
| ----------------------- | --------------------------------------------------------------------------------- |
| Sign in                 | `signInWithEmailAndPassword(auth, email, password)`                               |
| Sign out                | `signOut(auth)`                                                                   |
| Create admin user       | `createUserWithEmailAndPassword(auth, email, password)` then write `admins/{uid}` |
| Check admin / role      | `getDoc(doc(db, 'admins', uid))` → `role`, `disabled`                             |
| List my students        | `onSnapshot(query(collection(db, 'students'), where('ownerId', '==', uid)))`      |
| Add/edit/delete student | `addDoc` / `updateDoc` / `deleteDoc` on `students` (with `ownerId`)               |
| List my records         | `onSnapshot(query(collection(db, 'records'), where('ownerId', '==', uid)))`        |
| Create record           | `addDoc(collection(db, 'records'), { ownerId: uid, title, dayCount: 0, ... })`     |
| Rename record           | `updateDoc(doc(db, 'records', id), { title })`                                     |
| Delete record           | delete each `days` doc, then `deleteDoc(doc(db, 'records', id))`                   |
| List dates in a record  | `onSnapshot(query(collection(db, 'records', id, 'days'), where('ownerId', '==', recordOwnerId)))` |
| Save day                | `setDoc(doc(db, 'records', id, 'days', 'YYYY-MM-DD'), { ownerId, date, students, count, ... })` |
| Delete day              | `deleteDoc(doc(db, 'records', id, 'days', 'YYYY-MM-DD'))`                          |
| Owner: view one admin   | `where('ownerId', '==', targetUid)` on `students` / `records` (owner only)         |
| Owner: disable admin    | `updateDoc(doc(db, 'admins', uid), { disabled: true })`                           |
| Owner: remove admin     | `deleteDoc(doc(db, 'admins', uid))`                                               |

## 5. Server Architecture Diagram

Not applicable — serverless BaaS. Flow is: Browser (SDK) → Firebase Auth / Firestore → security rules.

## 6. Data Model

### 6.1 Data Model Definition

```mermaid
erDiagram
  ADMINS ||--o{ STUDENTS : "owns"
  ADMINS ||--o{ RECORDS : "owns"
  RECORDS ||--o{ DAYS : "contains"

  ADMINS {
    string uid PK "= Firebase Auth uid"
    string name
    string email
    string role "'owner' or 'admin'"
    boolean disabled "true = access switched off"
    timestamp createdAt
  }
  STUDENTS {
    string id PK
    string name
    string ownerId FK "= admin uid who created it"
    timestamp createdAt
  }
  RECORDS {
    string id PK "auto id (the container)"
    string ownerId FK "= admin uid"
    string title "free text, e.g. GST"
    number dayCount
    timestamp createdAt
  }
  DAYS {
    string id PK "YYYY-MM-DD (doc under records/{id}/days)"
    string ownerId FK "= record's ownerId"
    string date "YYYY-MM-DD (any date)"
    array students "snapshot: [{ id, name }]"
    number count "= students.length"
    timestamp updatedAt
  }
```

**Why the** **`students`** **snapshot inside a day:** attendance records store a copy of each student's
`{ id, name }` at the time of recording. So if a student is later removed from the master list,
past records still display and print their name correctly.

**Why a record document (not the title) is the container:** the title is free text the admin
chooses, so it is NOT unique or URL-safe. Each record therefore gets its own auto-generated
document id, and the title is stored as a plain field. Inside the record, each recorded date is a
document in a `days` sub-collection whose id is the date itself (`YYYY-MM-DD`), which makes
"one record per date" automatic and lets any date be used (no month limit).

### 6.2 Data Definition

Firestore is schemaless; the following documents the intended shape plus the security rules.

**Collections**

* `admins/{uid}` → `{ name: string, email: string, role: 'owner' | 'admin', disabled: boolean, createdAt: Timestamp }`

* `students/{autoId}` → `{ name: string, ownerId: string, createdAt: Timestamp }`

* `records/{autoId}` → `{ ownerId: string, title: string, dayCount: number, createdAt: Timestamp }`

* `records/{autoId}/days/{YYYY-MM-DD}` → `{ ownerId: string, date: string, students: [{id, name}], count: number, updatedAt: Timestamp }`

**Firestore Security Rules** (paste into Firebase Console → Firestore → Rules)

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ---- Helpers ---------------------------------------------------------
    function signedIn() { return request.auth != null; }

    // Read the caller's own admin record (one document read).
    function adminData() {
      return get(/databases/$(database)/documents/admins/$(request.auth.uid)).data;
    }

    // A signed-in user whose admin record exists and is not disabled.
    function isAdmin() {
      return signedIn()
        && exists(/databases/$(database)/documents/admins/$(request.auth.uid))
        && adminData().disabled != true;
    }

    // The owner is an admin whose role field is "owner".
    function isOwner() {
      return isAdmin() && adminData().role == 'owner';
    }

    // ---- Admins ----------------------------------------------------------
    match /admins/{uid} {
      // Owner reads everyone. Anyone signed in may read their OWN record
      // (that is how the app checks "are you an admin?").
      allow read: if isOwner() || (signedIn() && request.auth.uid == uid);
      // ONLY the owner creates, disables or removes admins.
      allow create, update, delete: if isOwner();
    }

    // ---- Students --------------------------------------------------------
    match /students/{studentId} {
      allow read:   if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);
      allow create: if isAdmin() && request.resource.data.ownerId == request.auth.uid;
      allow update, delete: if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);
    }

    // ---- Records (+ their recorded dates) --------------------------------
    match /records/{recordId} {
      allow read:   if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);
      allow create: if isAdmin() && request.resource.data.ownerId == request.auth.uid;
      allow update, delete: if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);

      match /days/{dayId} {
        allow read:   if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);
        allow create: if isAdmin() && request.resource.data.ownerId == request.auth.uid;
        allow update, delete: if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);
      }
    }

    // ---- Legacy months (kept only so the one-time converter can read/delete
    //      the old data). Not used by the app any more. ----------------------
    match /months/{monthId} {
      allow read:   if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);
      allow create: if isAdmin() && request.resource.data.ownerId == request.auth.uid;
      allow update, delete: if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);

      match /days/{dayId} {
        allow read:   if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);
        allow create: if isAdmin() && request.resource.data.ownerId == request.auth.uid;
        allow update, delete: if isOwner() || (isAdmin() && resource.data.ownerId == request.auth.uid);
      }
    }

    // Deny everything else.
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

**In simple words.**

* `isAdmin()` = "signed in AND my admin record exists AND it is not switched off." `isOwner()` =
  "I am an admin whose `role` is `owner`."
* **Students / records / recorded dates:** a regular admin may only touch a document when its
  `ownerId` equals their own uid (for reads *and* writes). The owner (`isOwner()`) is allowed
  everything.
* Every query in the app is filtered by `ownerId`, which is what Firestore needs to prove a
  list-read is safe. (This is why the recorded-date list also filters by `ownerId`.)
* The `months` block is **legacy**: the app no longer uses it, but it is left in place so the
  owner-only converter can read and delete the old data. Once you are happy everything is
  converted, you may delete that block (and the old `months` collection).
* **Only the owner** may create, update or delete documents in `admins/` — so nobody can make
  themselves an admin, and a regular admin cannot add or remove anyone.
* A signed-in person may still read their *own* `admins/{uid}` record — that is how the app decides
  to say *"This account is not a registered admin."* (a missing record) or *"Your admin access has
  been disabled by the owner."* (a record with `disabled: true`).
* The very first admin (and setting your own `role` to `owner`) is done by hand in the Firebase
  Console, which is not subject to these rules; every admin after that is created from the in-app
  **Add Admin** page by the owner.

## 7. PDF Approach & Rationale

**Chosen:** **`jsPDF`** **+** **`jspdf-autotable`** **(CDN).**

* The requirement is a *downloadable* file, not just a browser print dialog → jsPDF produces a real `.pdf`.

* `autoTable` renders a proper grid (students = rows, recorded dates = columns) with header repetition and cell
  styling, which is tedious to hand-build.

* It works offline once the CDN script is cached, needs no build step, and supports the required
  **landscape A4**, a title header block (school name / program / record title) and a footer block for
  the supervisor's name and signature line.

* When a record has more dates than fit across one page, the table splits horizontally. The options
  `horizontalPageBreak: true` and `horizontalPageBreakRepeat: 'first'` make autoTable repeat the
  first column (the student names) on every page, so each page is readable on its own.

* Date column headings use the short form **day/month/two-digit-year** (e.g. `13/11/26`), produced by
  `formatShortDate()` in `js/ui.js`.

A CSS `@media print` stylesheet is simpler but only prints via the browser and offers no control over
the downloaded file — so it is used only as a nice-to-have fallback for the record page layout.

## 8. Firebase Setup Summary

1. Create a Firebase project at `console.firebase.google.com`.
2. **Authentication → Sign-in method → Email/Password → Enable.**
3. **Firestore Database → Create database** (production mode).
4. Paste the provided `firebaseConfig` into `js/firebase-config.js`.
5. **First admin (bootstrap = you, the owner):** Authentication → Users → *Add user* (email + password);
   copy the generated **UID**; Firestore → create collection `admins` → add a document with
   **ID = that UID** and fields:

   | Field      | Type    | Value for you |
   | ---------- | ------- | ------------- |
   | `name`     | string  | Your name     |
   | `email`    | string  | Your email    |
   | `role`     | string  | `owner`       |
   | `disabled` | boolean | `false`       |

   Because `role` is `owner`, this account can see every admin's data and is the only one able to
   add/disable/remove admins. (Any admin without `role` is treated as a regular `admin`; see below.)
6. Publish the security rules from §6.2.
7. Further admins are added from the in-app **Add Admin** page (owner only). Each new admin is created
   with `role: 'admin'` and `disabled: false` automatically — you never set those by hand again.
8. **Convert old data (one time, owner only):** open `/migrate.html` while signed in as the
   owner. It turns every old **month** into a **record** whose title is the month's name (for
   example "November 2026"), copies every recorded date into it, then deletes the old copy. It is
   safe to run more than once.

**How to test the rules.** Sign in as a regular admin, open the browser console, and try to read
another admin's data — you should get `Missing or insufficient permissions`:

```js
// (paste while signed in as the *regular* admin, in any page's DevTools console)
import('/js/firebase-config.js').then(async (m) => {
  const { db, collection, getDocs } = m;
  await getDocs(collection(db, 'students')); // only YOUR students come back, never the owner's
});
```

Then confirm the *positive* cases: the owner can read `students`/`records`/`admins` freely, and only
the owner can write to `admins/`.

