# Hall's Timesheets · v0.2 — Employee account management

React + Vite + Firestore + Firebase Authentication + Netlify Functions. The digital timesheet is based on HB.FRM.82 Rev 10 (Fatigue Risk Management).

## What's new in v0.2

The **Employee register** now provides a single, understandable workflow for administrators:

- Click **Add employee**, enter full name, username, employment status and role.
- A strong temporary password is pre-generated (or may be changed). Click **Create employee account**.
- Firebase Authentication assigns the UID automatically; the trusted backend creates both `users/{uid}` and `staffDirectory/{uid}`.
- The username and temporary password are shown **once**, for private sharing with the employee. No copy of the password is stored in Firestore.
- Admins can **edit** name/username/status/role, **deactivate** an account or **reset** its password.
- Employees and admins have an **Account settings** screen to change their own passwords.
- Accounts created by this app use `<username>@halls-timesheets.local` internally. Employees type **just the username** to sign in; they are not asked to provide an email address. This synthetic address cannot receive password-reset emails, so the admin reset workflow is important.

## REQUIRED one-time deployment setup (GitHub ↔ Netlify already connected)

### 1. Firebase rules

Open **Firebase Console → Firestore Database → Rules** and replace the existing rules with **the complete `firestore.rules`** included in this release. Publish the rules. The update makes employee profile writes **server-only**, leaving staff read access and the timesheet permissions in place.

**Important:** Do not replace rules for another unrelated app sharing the same database. This project assumes its own Firestore database.

### 2. Netlify server-side Firebase credential

Creating Authentication accounts for other people requires a trusted backend. The new Netlify Function (`netlify/functions/staff.mjs`) uses the Firebase Admin SDK. It must be configured with a **server-only** service account key.

1. In Firebase Console, open **Project settings → Service accounts → Firebase Admin SDK → Generate new private key**. Download the JSON file to a secure location. Treat this like a master password for the Firebase project.
2. In a terminal **on your own computer**, create a single-line JSON representation, for example: `node -e "const fs=require('fs');process.stdout.write(JSON.stringify(JSON.parse(fs.readFileSync('serviceAccountKey.json','utf8'))))"` (replace the file path). Do **not** share or commit this key.
3. Open **Netlify → Site/Project configuration → Environment variables**.
4. Add the variable `FIREBASE_SERVICE_ACCOUNT_JSON`. Paste the **entire single-line JSON object** as its value. Set the scope to **Functions** (or **All** if the UI does not allow functions-only). Allow **Production**; also allow **Local development (`dev`)** if you intend to test with Netlify Dev.
5. Ensure the existing public variables (`VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_PROJECT_ID`, etc.) remain configured for the **Builds** environment. Your current `.env` should continue to use only these `VITE_*` public config fields.
6. Trigger a new Netlify deploy. Netlify detects `netlify/functions/staff.mjs` automatically from `netlify.toml` and installs `firebase-admin` from `package.json`.
7. Delete the downloaded key from unencrypted locations if no longer needed, and keep any retained copy somewhere secure. **Never put the key in GitHub, `.env.example`, a React component, or a `VITE_*` variable.**

The service account allows privileged Firebase operations. Rotate/revoke the key immediately if accidentally exposed.

### 3. First administrator

Continue using the existing admin account that was created during the original setup. Only the **initial bootstrap admin** needs a manually-created `users/{adminUID}` Firestore document (with role `admin` and active `true`). All new employees are created entirely in the UI.

If the original administrator was manually created with a genuine email address, they can continue signing in with that email address. Their email is not silently replaced when editing their record.

### 4. Deploy the updated files

Extract this version into your existing Git repository (replacing matching files). Keep your current `.env` file and **do not delete your Firebase data**. From the repo directory:

```bash
npm install
npm run build
git add -A
git commit -m "Employee register - automatic account creation"
git push
```

Netlify deploys the updated `main` branch automatically.

### 5. Testing account creation

Open the deployed Netlify site and sign in as an administrator. Select **Employee register → Add employee**; enter a test name, username and role **Employee**. Create the account, copy the credentials, sign out and log back in as the new user. Check that the employee can see **My timesheets** but cannot view the admin employee register.

Verify that the new record appears in **Firebase → Authentication → Users** and both Firestore collections `users` and `staffDirectory`. Those documents should share the automatically-generated UID; you should never need to handle it manually.

## Local development

For timesheet editor UI alone, `npm run dev` still works. **Employee creation/reset requires a Netlify Function** and therefore will not work in a plain Vite server.

To test the entire application locally with Netlify Functions:

```bash
npm install
npx netlify-cli login
npx netlify-cli link
npx netlify-cli dev
```

Netlify Dev uses the linked site's environment variables if their deploy context includes `dev` or `all`. Use `npx netlify-cli dev --context production` only if you intentionally need production variables locally and understand you will be writing to the **real production Firebase database**.

Your existing local `.env` is gitignored. Do not put the service-account JSON in any frontend file. For initial verification, testing the live Netlify URL is simpler than setting up local backend credentials.

## Security notes

- The Netlify Function checks the Firebase ID token and also reads the `users/{callerUid}` document to confirm the caller is an **active admin**. No UID from the browser is trusted as proof of permission.
- Only the server can create/update `users` and `staffDirectory` documents; staff are limited to their own profile and timesheets, and admins can read staff records.
- A user cannot deactivate or demote their own admin account via the management function; the last remaining active admin is protected.
- Passwords are passed only for the HTTPS request to Firebase Admin SDK, not stored in Firestore. Temporary credentials must be passed to employees privately.
- Disabling an employee disables their Firebase Authentication account, not just their visible profile.
- Separate `staffAuditLogs` records are written by the backend for account creation, updates and password resets.
- For employees using synthetic `.local` emails, **email-based password recovery is not available**. Contact the administrator for a new temporary password.
- Continue to test the original form's print formatting and signature process before using it for formal compliance documentation.

## Other functionality unchanged

Employees can create editable drafts, add rows, submit declarations, access their prior timesheets and print. Admins can review all timesheets, return them or approve them; continuation pages print at approximately nine completed entries per page. Risk/fatigue scores remain manual office-use fields.

## Project layout

- `src/App.jsx` — Timesheet screens and employee navigation.
- `src/StaffRegister.jsx` — User-friendly employee manager (no UID field).
- `src/AccountSettings.jsx` — Personal password change.
- `src/styles.css` — Application/print styling.
- `netlify/functions/staff.mjs` — **Privileged** create/update/reset function (server-only).
- `netlify.toml` — Build, functions and SPA routing configuration.
- `firestore.rules` — Firestore client access restrictions.
- `.env.example` — Public Firebase web configuration only.

### References

- Firebase Admin SDK account management: https://firebase.google.com/docs/auth/admin/manage-users
- Firebase Admin SDK setup and service-account key precautions: https://firebase.google.com/docs/admin/setup
- Netlify Functions configuration: https://docs.netlify.com/build/functions/configuration/
- Netlify Dev local functions: https://docs.netlify.com/api-and-cli-guides/cli-guides/local-development/
