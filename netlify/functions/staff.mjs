/**
 * Privileged employee-account management for Hall's Timesheets.
 * The service account credential MUST exist only in Netlify environment variables.
 * Never import this file into browser code, and never expose credentials as VITE_*.
 */
import { getApps, initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const LOGIN_DOMAIN = 'halls-timesheets.local';
const response = (statusCode, body) => ({
  statusCode,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  body: JSON.stringify(body),
});

function initFirebase() {
  if (!getApps().length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (!raw) throw new Error('SERVER_NOT_CONFIGURED');
    const key = JSON.parse(raw);
    if (!key.project_id || !key.client_email || !key.private_key) throw new Error('SERVER_NOT_CONFIGURED');
    initializeApp({ credential: cert({
      projectId: key.project_id,
      clientEmail: key.client_email,
      privateKey: key.private_key.replace(/\\n/g, '\n'),
    }) });
  }
  return { accounts: getAuth(), store: getFirestore() };
}

function employeeFields(input) {
  const displayName = String(input.displayName ?? '').trim().replace(/\s+/g, ' ');
  const username = String(input.username ?? '').trim().toLowerCase();
  const employmentStatus = String(input.employmentStatus ?? '').trim();
  const role = input.role;
  const active = input.active;
  if (displayName.length < 2 || displayName.length > 100) throw new Error('Enter a name between 2 and 100 characters.');
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) throw new Error('Username must be 3–30 characters (letters, numbers, dots, hyphens or underscores).');
  if (employmentStatus.length > 100) throw new Error('Employment status must be 100 characters or fewer.');
  if (!['staff','admin'].includes(role)) throw new Error('Select a valid account role.');
  if (typeof active !== 'boolean') throw new Error('Select an account status.');
  return {displayName, username, employmentStatus, role, active};
}
function requirePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 12 || pw.length > 128) {
    throw new Error('Temporary password must contain between 12 and 128 characters.');
  }
}
function logChange(store, actorUid, action, employeeUid, details = {}) {
  return store.collection('staffAuditLogs').add({
    actorUid, action, employeeUid, details, timestamp: FieldValue.serverTimestamp(),
  });
}
function friendlyError(error) {
  if (error?.code === 'auth/email-already-exists') return 'This username is already in use. Choose another username.';
  if (error?.code === 'auth/user-not-found') return 'The employee authentication account could not be found.';
  if (error?.code === 'auth/invalid-password') return 'The temporary password is not valid.';
  return null;
}

export async function handler(event) {
  if (event.httpMethod !== 'POST') return response(405, {error:'Method not allowed.'});
  try {
    const { accounts, store } = initFirebase();
    const header = event.headers.authorization || event.headers.Authorization || '';
    const match = /^Bearer (\S+)$/i.exec(header);
    if (!match) return response(401, {error:'Please sign in again.'});
    const identity = await accounts.verifyIdToken(match[1], true);
    const adminDoc = await store.collection('users').doc(identity.uid).get();
    if (!adminDoc.exists || adminDoc.data().role !== 'admin' || adminDoc.data().active !== true) {
      return response(403, {error:'Only an active administrator can manage employee accounts.'});
    }

    let input;
    try { input = JSON.parse(event.body || '{}'); } catch { return response(400,{error:'Invalid request.'}); }
    if (!input || typeof input !== 'object' || Array.isArray(input)) return response(400,{error:'Invalid request.'});

    if (input.action === 'create') {
      const fields = employeeFields(input);
      requirePassword(input.temporaryPassword);
      const email = `${fields.username}@${LOGIN_DOMAIN}`;
      const existingUser = await accounts.getUserByEmail(email).catch(err => {
        if (err.code === 'auth/user-not-found') return null;
        throw err;
      });
      if (existingUser) return response(409,{error:'This username is already in use.'});

      // Create Authentication account first. If profile creation fails, remove it to avoid orphans.
      const created = await accounts.createUser({
        email, password: input.temporaryPassword,
        displayName: fields.displayName, disabled: !fields.active,
      });
      try {
        const batch = store.batch();
        batch.create(store.collection('users').doc(created.uid), {...fields, createdAt:FieldValue.serverTimestamp()});
        batch.create(store.collection('staffDirectory').doc(created.uid), {...fields, createdAt:FieldValue.serverTimestamp()});
        batch.create(store.collection('staffAuditLogs').doc(), {
          actorUid:identity.uid, action:'employee.create', employeeUid:created.uid,
          details:{username:fields.username, role:fields.role}, timestamp:FieldValue.serverTimestamp(),
        });
        await batch.commit();
      } catch (dbError) {
        try { await accounts.deleteUser(created.uid); } catch (cleanupError) {
          console.error('Orphan Auth account cleanup failed', created.uid, cleanupError);
        }
        throw dbError;
      }
      return response(201, {ok:true, message:`${fields.displayName}'s login is ready.`, username:fields.username});
    }

    if (input.action === 'update') {
      const uid = String(input.uid || '');
      if (!uid || uid.length > 128) return response(400,{error:'Invalid employee record.'});
      const fields = employeeFields(input);
      const profileRef = store.collection('users').doc(uid);
      const oldProfileSnap = await profileRef.get();
      if (!oldProfileSnap.exists) return response(404,{error:'Employee profile not found.'});
      const old = oldProfileSnap.data();
      if (uid === identity.uid && (!fields.active || fields.role !== 'admin')) {
        return response(400,{error:'You cannot deactivate or remove your own administrator access.'});
      }
      if (old.role === 'admin' && old.active === true && (fields.role !== 'admin' || !fields.active)) {
        const activeAdmins = await store.collection('users').where('role','==','admin').get();
        const remaining = activeAdmins.docs.filter(d=>d.id!==uid && d.data().active === true);
        if (!remaining.length) return response(400,{error:'At least one active administrator must remain.'});
      }
      const before = await accounts.getUser(uid);
      // Only rewrite logins created by this app. Existing administrator/legacy
      // accounts may use genuine email addresses and must not be silently migrated.
      const managedEmail = before.email?.toLowerCase().endsWith(`@${LOGIN_DOMAIN}`);
      if (uid === identity.uid && fields.username !== old.username) {
        return response(400,{error:'An administrator cannot change their own username while signed in. Ask another administrator.'});
      }
      const accountChanges = {
        displayName: fields.displayName,
        disabled: !fields.active,
      };
      if (managedEmail) accountChanges.email = `${fields.username}@${LOGIN_DOMAIN}`;
      await accounts.updateUser(uid, accountChanges);
      try {
        const batch = store.batch();
        batch.update(profileRef, {...fields,updatedAt:FieldValue.serverTimestamp()});
        batch.set(store.collection('staffDirectory').doc(uid), {...fields,updatedAt:FieldValue.serverTimestamp()}, {merge:true});
        batch.create(store.collection('staffAuditLogs').doc(), {
          actorUid:identity.uid,action:'employee.update',employeeUid:uid,
          details:{previousRole:old.role,newRole:fields.role,active:fields.active},
          timestamp:FieldValue.serverTimestamp(),
        });
        await batch.commit();
      } catch (dbError) {
        try { await accounts.updateUser(uid,{email:before.email,displayName:before.displayName,disabled:before.disabled}); }
        catch (cleanupError) { console.error('Auth rollback failed for',uid,cleanupError); }
        throw dbError;
      }
      return response(200, {ok:true,message:`${fields.displayName}'s details have been updated.`});
    }

    if (input.action === 'resetPassword') {
      const uid = String(input.uid || '');
      if (!uid || uid.length > 128) return response(400,{error:'Invalid employee record.'});
      requirePassword(input.temporaryPassword);
      const existing = await store.collection('users').doc(uid).get();
      if (!existing.exists) return response(404,{error:'Employee not found.'});
      if (uid === identity.uid) return response(400,{error:'Use your own account settings to change your password.'});
      await accounts.updateUser(uid,{password:input.temporaryPassword});
      await accounts.revokeRefreshTokens(uid);
      await logChange(store, identity.uid, 'employee.passwordReset',uid);
      return response(200,{ok:true,message:`Password reset for ${existing.data().displayName}. Share the new password privately.`});
    }

    return response(400,{error:'Unknown action.'});
  } catch(error) {
    // Avoid exposing backend credentials, stack traces or internal record data to clients.
    const known = friendlyError(error);
    if (known) return response(400,{error:known});
    if (error.message === 'SERVER_NOT_CONFIGURED') return response(503,{error:'Employee management has not been configured on Netlify yet. Ask the site administrator to add the server-side Firebase credentials.'});
    if (/^(Enter |Username |Employment |Select |Temporary |You cannot |At least |An administrator )/.test(error.message||'')) return response(400,{error:error.message});
    if (error?.code?.startsWith('auth/id-token-') || error?.code === 'auth/argument-error') return response(401,{error:'Your session has expired. Please sign out and back in.'});
    console.error('Staff function failed:', error);
    return response(500,{error:'The employee account could not be saved. Please try again or contact the site administrator.'});
  }
}
