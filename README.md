# Hall's Timesheets — initial React / Firebase implementation

An online implementation of the user-provided **HB.FRM.82 Rev 10 — Fatigue Risk Management** timesheet. Features: employee sign-in, employee-only history, draft/submission workflow, expandable rows, A4 landscape continuation printing, administrator review, employee register, and restrictive Firestore rules.

## 1. Prepare Firebase

1. In your newly created Firebase project, add a **Web app** (Project settings → Your apps) and copy the Firebase config.
2. Authentication → Sign-in method → enable **Email/Password**.
3. Firestore Database → create a database (production mode preferred).
4. Firestore Database → **Rules** → paste **the entire `firestore.rules`** file → Publish. This ruleset replaces the rules for the selected database; use a dedicated Firebase project/database.
5. Authentication → Users → **Add user** for your initial administrator, for example `admin@halls-timesheets.local`. Use a strong password. Copy the generated **UID** (do not copy the email into the UID field).
6. Firestore Database → Start collection `users` → Document ID **exactly the administrator UID**. Add fields: `displayName` (string) `Administrator`, `role` (string) `admin`, `active` (boolean) `true`, `username` (string) `admin`. **Only manually create this initial administrator profile in the Firebase Console.** Creating admin roles must remain restricted after bootstrap.
7. Optionally create `staffDirectory/{admin UID}` with the same displayName, role, active, username fields so this account appears in the employee register.

### How employee accounts are created in v0.1

In Authentication → Users, create an account with email `<username>@halls-timesheets.local` (e.g. `mark@halls-timesheets.local`) and a temporary password. Copy its UID. Sign into the web app as admin → Employee register → Add employee → paste the UID, display name, username and role `staff`, then save. The username login translates to `<username>@halls-timesheets.local`. You may also use actual email addresses and log in with the full address. **The register does not create Firebase Auth users, send passwords or reset passwords in v0.1.** Secure in-app account provisioning requires a trusted backend (e.g. a callable Cloud Function using the Admin SDK). Never embed Admin SDK service-account credentials in the browser.

## 2. Run locally

```bash
npm install
cp .env.example .env
# Fill .env with values from Firebase Project settings > Your apps > SDK setup/config
npm run dev
```

Open the local Vite URL. Build with `npm run build` and deploy the `dist` directory to Netlify. For Netlify/GitHub deploys, add the same `VITE_FIREBASE_*` environment variables under **Site configuration → Environment variables**; build command `npm run build`, publish directory `dist`. Register the Netlify website domain under Firebase Authentication → Settings → Authorized domains. No secret server key belongs in the Vite environment file. Firebase web app config is public; security is provided by Authentication and Firestore rules.

## 3. Operating rules

- Employees may create drafts, save and submit their own timesheets, and view/print previously saved submissions. Approved/submitted sheets are read-only for employees; returned sheets can be corrected.
- Administrators may view all sheets, set office-use fields, return for correction, or approve; the employee UID remains immutable.
- Dynamic row entry prints 9 **populated** rows per landscape A4 page. Each page repeats headers; the final page includes the original safety notes, declaration and manager approval section.
- The HSE fatigue/risk scores are **manual office-use fields**. The app does **not** implement the HSE FRI calculator or independently certify safe shift patterns.
- Declaration typed name/date are an acknowledgement record, **not a verified electronic signature**. The source document includes a 48-hour Working Time Regulations opt-out. Confirm any organisational legal and signature requirements before using this system as a replacement for signed paper forms.
- Audit logs are best-effort client writes and **are not tamper-proof or guaranteed**. For robust audit integrity, move logging and review actions to a trusted server-side Cloud Function.
- The HTML timesheet is styled to closely follow the source layout; verify printing on your target browser/printer before operational use.

## 4. Future production improvements

- Secure cloud-function staff provisioning and password reset, without exposing Admin SDK credentials.
- Audit history maintained server-side; email alerts for submissions; server-side computed fatigue score via validated HSE FRI model; stronger field validation and week-period constraints.
- Signature process compliant with your organisation's requirements; pagination QA using real data; Firebase Emulator Suite tests for access rules.

## File layout

- `src/App.jsx`: screens, form, pagination, history and review.
- `src/styles.css`: interactive UI and printable page styling.
- `src/firebase.js`: Firebase initialization.
- `firestore.rules`: database access policy.
- `.env.example`: required Firebase web configuration variables.
