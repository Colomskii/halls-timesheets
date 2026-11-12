import React, { useState } from 'react';
import { auth } from './firebase';
import { Plus, Pencil, KeyRound, X, Copy, Check, RefreshCw, Eye, EyeOff, UserRound, ShieldCheck } from 'lucide-react';

const blankEmployee = () => ({ displayName:'', username:'', employmentStatus:'', role:'staff', active:true });

function generatePassword() {
  // Secure randomness, no Math.random(), and no credentials written to Firestore.
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%&*';
  const bytes = new Uint32Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, n => chars[n % chars.length]).join('');
}

async function staffRequest(data) {
  const user = auth.currentUser;
  if (!user) throw new Error('Please sign in again.');
  const token = await user.getIdToken();
  let res;
  try {
    res = await fetch('/.netlify/functions/staff', {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${token}` },
      body: JSON.stringify(data),
    });
  } catch {
    throw new Error('Cannot reach the employee-management service. Check the connection or Netlify function deployment.');
  }
  if (!(res.headers.get('content-type') || '').includes('application/json')) {
    throw new Error('The account-management function is not available here. Use the Netlify site or run “npx netlify-cli dev” locally instead of “npm run dev”.');
  }
  const result = await res.json();
  if (!res.ok) throw new Error(result.error || 'Account management failed.');
  return result;
}

function PasswordField({value,onChange,disabled=false}) {
  const [visible,setVisible] = useState(false);
  return <div className="passwordField">
    <input type={visible?'text':'password'} value={value} onChange={e=>onChange(e.target.value)} disabled={disabled} minLength={12} maxLength={128} autoComplete="new-password" required aria-label="Temporary password" />
    <button type="button" title={visible?'Hide password':'Show password'} className="iconButton" onClick={()=>setVisible(x=>!x)}>{visible?<EyeOff size={17}/>:<Eye size={17}/>}</button>
  </div>;
}

export default function StaffRegister({staff, currentUserUid}) {
  const [editing,setEditing]=useState(null); // null = closed, 'create', or uid
  const [form,setForm]=useState(blankEmployee());
  const [tempPassword,setTempPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [error,setError]=useState('');
  const [credentials,setCredentials]=useState(null);
  const [search,setSearch]=useState('');

  const openCreate = () => {
    setForm(blankEmployee());setTempPassword(generatePassword());setEditing('create');
    setMessage('');setError('');setCredentials(null);
  };
  const openEdit = employee => {
    setForm({displayName:employee.displayName||'', username:employee.username||'',employmentStatus:employee.employmentStatus||'', role:employee.role||'staff',active:employee.active===true});
    setTempPassword('');setEditing(employee.uid);setMessage('');setError('');setCredentials(null);
  };
  const close = () => {if(!busy){setEditing(null);setCredentials(null);setTempPassword('');setError('');}};
  const setField = (name,value) => setForm(f=>({...f,[name]:value}));

  async function save(e) {
    e.preventDefault();setBusy(true);setError('');
    try {
      const isNew = editing==='create';
      const username = form.username.trim().toLowerCase();
      const result = await staffRequest({
        action:isNew?'create':'update',
        ...form,username,
        ...(!isNew?{uid:editing}:{temporaryPassword:tempPassword}),
      });
      if (isNew) {
        setCredentials({displayName:form.displayName, username, password:tempPassword});
        setTempPassword('');
        setEditing(null);
      } else {
        setMessage(result.message);
        setEditing(null);
      }
    } catch(e) {setError(e.message);} finally {setBusy(false);}
  }

  async function resetPassword(employee) {
    if (employee.uid===currentUserUid) {setError('Change your own password under Account settings.');return;}
    if (!window.confirm(`Reset the password for ${employee.displayName}? Their existing password will stop working.`)) return;
    setBusy(true);setError('');setMessage('');setCredentials(null);
    const password = generatePassword();
    try {
      const result=await staffRequest({action:'resetPassword',uid:employee.uid,temporaryPassword:password});
      setCredentials({displayName:employee.displayName,username:employee.username,password});
      setMessage(result.message);
    }catch(e){setError(e.message);}finally{setBusy(false);}
  }

  const filtered=staff.filter(s=>`${s.displayName} ${s.username} ${s.employmentStatus}`.toLowerCase().includes(search.toLowerCase()));
  return <section className="staffAdmin">
    <div className="pageHead">
      <div><h1>Employee register</h1><p>Create staff logins, manage access and reset passwords — all from this page.</p></div>
      <button type="button" className="btn" onClick={openCreate}><Plus size={17}/> Add employee</button>
    </div>
    {error&&<div className="alert error" role="alert">{error}<button onClick={()=>setError('')} aria-label="Dismiss error">×</button></div>}
    {message&&<div className="notice" role="status">{message}</div>}
    {credentials&&<div className="credentialsBox" role="status">
      <div className="credentialsHeader"><ShieldCheck size={22}/><div><strong>Account details ready</strong><small>Copy these now and share privately with {credentials.displayName}. The password won't be shown again.</small></div></div>
      <div className="credentialGrid"><div><small>Username</small><b>{credentials.username}</b></div><div><small>Temporary password</small><code>{credentials.password}</code></div></div>
      <div className="credentialActions"><button type="button" className="secondary" onClick={()=>navigator.clipboard.writeText(`Username: ${credentials.username}\nTemporary password: ${credentials.password}`)}><Copy size={15}/> Copy login details</button><button type="button" className="secondary" onClick={()=>setCredentials(null)}><Check size={15}/> Done</button></div>
    </div>}
    <div className="staffSummary"><div><b>{staff.length}</b><span>Total accounts</span></div><div><b>{staff.filter(s=>s.active).length}</b><span>Active</span></div><div><b>{staff.filter(s=>s.role==='admin'&&s.active).length}</b><span>Administrators</span></div></div>
    <div className="registerSearch"><label htmlFor="employeeSearch">Search employees</label><input id="employeeSearch" placeholder="Name, username or employment status" value={search} onChange={e=>setSearch(e.target.value)}/></div>
    <div className="staffTable responsiveStaffTable">
      <div className="staffHead"><span>Employee</span><span>Role</span><span>Status</span><span>Actions</span></div>
      {filtered.length===0?<div className="empty">{staff.length===0?'No employee accounts yet. Select Add employee to create one.':'No matching employees.'}</div>:filtered.map(s=><div className="staffRow" key={s.uid}>
        <div className="staffIdentity"><span className="avatarSmall"><UserRound size={16}/></span><div><b>{s.displayName}</b><small>@{s.username||'username not set'} · {s.employmentStatus||'Status not specified'}</small></div></div>
        <span className="roleLabel">{s.role==='admin'?'Administrator':'Employee'}</span>
        <span className={'activeLabel '+(s.active?'isActive':'isInactive')}>{s.active?'Active':'Inactive'}</span>
        <div className="staffActions"><button type="button" className="secondary" disabled={busy} onClick={()=>openEdit(s)}><Pencil size={14}/> Edit</button><button type="button" className="secondary" disabled={busy||s.uid===currentUserUid} title={s.uid===currentUserUid?'Change your own password from Account settings':'Reset password'} onClick={()=>resetPassword(s)}><KeyRound size={14}/> Reset password</button></div>
      </div>)}
    </div>
    {editing&&<div className="modal" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)close()}}>
      <form className="modalPanel employeeModal" onSubmit={save} aria-label={editing==='create'?'Add employee':'Edit employee'}>
        <div className="modalTitle"><div><h2>{editing==='create'?'Add employee':'Edit employee'}</h2><p>{editing==='create'?'Their login will be created automatically. No Firebase UID needed.':'Changes will also update the Firebase login.'}</p></div><button type="button" className="iconButton" aria-label="Close" onClick={close}><X size={20}/></button></div>
        {error&&<p className="formError" role="alert">{error}</p>}
        <div className="employeeFields">
          <label>Full name<input autoFocus required maxLength={100} placeholder="e.g. Mark Smith" value={form.displayName} onChange={e=>setField('displayName',e.target.value)}/></label>
          <label>Username<input required minLength={3} maxLength={30} pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,29}" placeholder="e.g. mark.smith" autoCapitalize="none" autoComplete="off" value={form.username} onChange={e=>setField('username',e.target.value.toLowerCase().replace(/\s/g,''))}/><small>Used to sign in; no email address required.</small></label>
          <label>Employment status<input maxLength={100} placeholder="e.g. Employed / Self-employed" value={form.employmentStatus} onChange={e=>setField('employmentStatus',e.target.value)}/></label>
          <label>Account role<select value={form.role} onChange={e=>setField('role',e.target.value)}><option value="staff">Employee</option><option value="admin">Administrator</option></select></label>
          <label className="checkline"><input type="checkbox" checked={form.active} disabled={editing===currentUserUid} onChange={e=>setField('active',e.target.checked)}/> Active account</label>
          {editing==='create'&&<div className="passwordSection"><label>Temporary password<PasswordField value={tempPassword} onChange={setTempPassword}/></label><button type="button" className="secondary" onClick={()=>setTempPassword(generatePassword())}><RefreshCw size={14}/> Generate another</button><small>Give the employee their username and password privately. They can change their password after signing in.</small></div>}
        </div>
        <div className="modalActions"><button type="button" className="secondary" onClick={close}>Cancel</button><button className="btn" type="submit" disabled={busy}>{busy?'Saving…':editing==='create'?'Create employee account':'Save changes'}</button></div>
      </form>
    </div>}
  </section>;
}
