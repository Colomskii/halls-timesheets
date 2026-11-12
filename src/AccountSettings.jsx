import React, { useState } from 'react';
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { auth } from './firebase';
import { KeyRound, ShieldCheck } from 'lucide-react';

export default function AccountSettings({profile}) {
  const [oldPassword,setOldPassword]=useState('');
  const [newPassword,setNewPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [done,setDone]=useState(false);
  async function submit(e) {
    e.preventDefault();setError('');setDone(false);
    if(newPassword.length<12) {setError('Choose a password of at least 12 characters.');return;}
    if(newPassword!==confirmPassword) {setError('The new passwords do not match.');return;}
    setBusy(true);
    try {
      const user=auth.currentUser;
      await reauthenticateWithCredential(user,EmailAuthProvider.credential(user.email,oldPassword));
      await updatePassword(user,newPassword);
      setOldPassword('');setNewPassword('');setConfirmPassword('');setDone(true);
    }catch(e) {setError(e.code==='auth/invalid-credential'?'Your current password is incorrect.':'Could not change the password. Please try again.');}
    finally {setBusy(false);}
  }
  return <section className="accountSettings"><div className="pageHead"><div><h1>Account settings</h1><p>Manage your login securely.</p></div></div><div className="accountCard"><div className="accountHeader"><ShieldCheck size={22}/><div><b>{profile.displayName}</b><small>Username: {profile.username||'not set'}</small></div></div><h2><KeyRound size={19}/> Change password</h2><p>Choose a new password that you haven't used elsewhere.</p>{error&&<div className="alert error">{error}</div>}{done&&<div className="notice">Your password was updated successfully.</div>}<form onSubmit={submit}><label>Current password<input required type="password" autoComplete="current-password" value={oldPassword} onChange={e=>setOldPassword(e.target.value)}/></label><label>New password<input required type="password" minLength={12} autoComplete="new-password" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/></label><label>Confirm new password<input required type="password" minLength={12} autoComplete="new-password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)}/></label><button type="submit" className="btn" disabled={busy}>{busy?'Updating…':'Update password'}</button></form></div></section>;
}
