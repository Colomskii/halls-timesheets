import React, { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { addDoc, collection, deleteDoc, doc, getDoc, onSnapshot, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { auth, db, isConfigured } from './firebase';
import { Plus, Printer, Download, FileText, LogOut, Users, ClipboardList, ArrowLeft, Save, Send, Check, RotateCcw, Trash2, Settings, ChevronDown, ChevronUp, Copy, Eye, EyeOff, CalendarDays, Clock3 } from 'lucide-react';
import StaffRegister from './StaffRegister';
import AccountSettings from './AccountSettings';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

const emptyRow = () => ({ id:crypto.randomUUID(), date:'', onCall:'', location:'', start:'', finish:'', breaks:'', commute:'', swipe:'', working:'', shiftsClaim:'', duty:'', rest:'', risk:'', fatigue:'' });
const safeRows = rows => (rows?.length ? rows : Array.from({length:9},emptyRow));
const blankSheet = profile => ({employeeId:auth.currentUser.uid,employeeName:profile.displayName,employmentStatus:profile.employmentStatus||'',period:new Date().toISOString().slice(0,7),weekNo:'',status:'draft',rows:Array.from({length:9},emptyRow),declarationAccepted:false,declarationName:'',declarationDate:'',managerName:'',managerDate:'',managerSignature:'',reviewNote:'',officeNote:''});
const columns = [
  ['date','SHIFT DATE'],['onCall','ON CALL (YES / NO)'],['location','LOCATION'],['start','START TIME'],['finish','FINISH TIME'],['breaks','BREAKS TAKEN (YES/NO)'],['commute','TOTAL COMMUTE TIME'],['swipe','SWIPE IN / OUT'],
  ['working','TOTAL WORKING HOURS'],['shiftsClaim','TOTAL SHIFTS CLAIM'],['duty','DUTY LENGTH'],['rest','REST LENGTH'],['risk','RISK SCORE'],['fatigue','FATIGUE SCORE']
];
const officeKeys = ['working','shiftsClaim','duty','rest','risk','fatigue'];
const isEditable = sheet => sheet && ['draft','returned'].includes(sheet.status);
const displayPeriod = p => p ? new Date(`${p}-01T12:00:00`).toLocaleDateString('en-GB',{month:'long',year:'numeric'}) : 'Untitled';
function sanitize(sheet){ const fields=['employeeId','employeeName','employmentStatus','period','weekNo','status','rows','declarationAccepted','declarationName','declarationDate','managerName','managerDate','managerSignature','reviewNote','officeNote']; return Object.fromEntries(fields.filter(k=>sheet[k]!==undefined).map(k=>[k,sheet[k]])); }
// Clock fields accept four-digit 24-hour times (0930 -> 09:30) and HH:MM.
// Partial/invalid entries remain visible rather than being silently corrected.
function normaliseClock(raw) {
  const value = String(raw ?? '').trim();
  if (!/^(?:\d{4}|\d{1,2}:\d{2})$/.test(value)) return null;
  const digits = value.replace(':', '').padStart(4, '0');
  const hours = Number(digits.slice(0, 2));
  const minutes = Number(digits.slice(2));
  if (hours > 23 || minutes > 59) return null;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}
function clockWhileTyping(raw) {
  const clean = String(raw ?? '').replace(/[^0-9:]/g, '').slice(0, 5);
  return normaliseClock(clean) || clean;
}
function ClockEntry({ id, value, onChange, disabled, label, className = '', rowIndex }) {
  const formatted = normaliseClock(value);
  return <span className={`clockEntry ${className} ${value && !formatted ? 'clockInvalid' : ''}`}>
    <input
      id={id}
      aria-label={label}
      data-timesheet-row={rowIndex}
      data-timesheet-field={label === 'Start time' ? 'start' : 'finish'}
      className="clockDigits"
      type="text" inputMode="numeric" autoComplete="off"
      placeholder="HHMM" maxLength={5}
      disabled={disabled} value={value || ''}
      onChange={e => onChange(clockWhileTyping(e.target.value))}
      onBlur={e => { const valid = normaliseClock(e.currentTarget.value); if (valid) onChange(valid); }}
    />
    <span className="clockNativeWrap" title={`Choose ${label.toLowerCase()}`}>
      <Clock3 size={18} aria-hidden="true" />
      <input type="time" aria-label={`Choose ${label.toLowerCase()}`}
        step="60" disabled={disabled} value={formatted || ''}
        onChange={e => onChange(e.target.value)} />
    </span>
  </span>;
}

// Synchronise what the browser currently shows with the rows we will save.
// Particularly important for segmented native date inputs on Safari.
function currentFormRows(rows) {
  return rows.map((row, index) => {
    const values = { ...row };
    for (const field of ['date', 'location', 'start', 'finish']) {
      // On small screens, the visible mobile editor is the source of truth.
      // The desktop grid remains mounted (but hidden) to preserve print layout.
      const selector = `[data-timesheet-row="${index}"][data-timesheet-field="${field}"]`;
      const mobileInput = window.matchMedia('(max-width: 900px)').matches
        ? document.querySelector(`.mobileShiftEditor ${selector}`)
        : null;
      const input = mobileInput || document.querySelector(`.screenPaper ${selector}`);
      if (input) values[field] = input.value;
      if (field === 'start' || field === 'finish') {
        values[field] = normaliseClock(values[field]) || values[field];
      }
    }
    return values;
  });
}

function validateShiftRows(rows) {
  const required = [
    ['date', 'shift date'],
    ['location', 'location'],
    ['start', 'start time'],
    ['finish', 'finish time'],
  ];
  const present = (row, field) => String(row[field] ?? '').trim().length > 0;
  rows.forEach((row, index) => {
    if (!['date', 'location', 'start', 'finish'].some(field => present(row, field))) return;
    for (const key of ['start', 'finish']) {
      if (present(row, key) && !normaliseClock(row[key])) {
        throw new Error(`Row ${index + 1}: ${key === 'start' ? 'start' : 'finish'} time must be a valid 24-hour time (e.g. 0930 or 09:30).`);
      }
    }
  });
  if (rows.some(row => required.every(([field]) => present(row, field)))) return;

  const candidates = rows.map((row, index) => ({
    row,
    index,
    filledCount: required.filter(([field]) => present(row, field)).length,
  }));
  const closest = candidates.sort((a, b) => b.filledCount - a.filledCount)[0];
  if (!closest || closest.filledCount === 0) {
    throw new Error('Please enter at least one shift with a date, location and start/finish time.');
  }
  const missing = required.filter(([field]) => !present(closest.row, field)).map(([, label]) => label);
  const dateHint = missing.includes('shift date')
    ? ' If the date looks filled in, choose it again from the date picker and click outside the field.'
    : '';
  throw new Error(`Row ${closest.index + 1}: missing ${missing.join(', ')}.${dateHint}`);
}

// Open an isolated print view instead of printing the entire app shell.
// This also prevents Netlify-injected page furniture from being included in printouts.
// Self-contained A4 form stylesheet: unlike a copied Vite stylesheet, this
// does not rely on deployed CSS asset filenames or conflicting app print rules.
const ISOLATED_PRINT_CSS = `
  * { box-sizing: border-box; }
  html, body { padding:0; margin:0; font-family: Arial, Helvetica, sans-serif; background:#edf1f3; color:#111820; }
  .printToolbar { position:sticky; top:0; z-index:5; background:#192630; color:white; padding:12px 20px; display:flex; align-items:center; justify-content:space-between; gap:14px; font:600 14px Arial,sans-serif; }
  .printToolbar button { padding:9px 14px; margin-left:8px; color:#192630; border:0; background:white; border-radius:5px; font-weight:700; cursor:pointer; }
  .printOnly { display:block; }
  .paper.printPage { width:min(1100px,calc(100% - 36px)); padding:14px; margin:18px auto; background:white; color:#101820; border:1px solid #cbd4d9; box-shadow:0 3px 12px #0001; font:10px Arial,sans-serif; }
  .sheetHeader { position:relative; height:43px; display:flex; justify-content:center; align-items:flex-start; padding-top:2px; }
  .sheetHeader h2 { font-size:14px; line-height:1.25; text-align:center; margin:0 0 6px; padding:0 17%; white-space:normal; }
  .paperMeta { position:absolute; left:0; top:0; display:flex; flex-direction:column; gap:3px; font-size:8px; line-height:1.1; }
  .sheetInstructions { margin:0 0 12px; display:flex; flex-direction:column; gap:3px; font-size:9px; color:#283f50; font-weight:650; }
  .sheetInstructions b { color:#9d3034; }
  .sheetTop { display:flex; align-items:stretch; min-height:34px; border:1px solid #101820; background:#18252e; color:#fff; }
  .weekBlock { width:5.3%; min-width:0; background:#e8edcb; color:#1e2c35; padding:4px; font-size:9px; display:flex; flex-direction:column; }
  .paperTopEntries { display:grid; grid-template-columns:1.5fr 1.15fr 1.1fr; flex:1; min-width:0; }
  .paperTopEntries label { min-width:0; border-right:1px solid #52616a; padding:5px; display:flex; flex-direction:column; gap:2px; font-size:9px; }
  .paperTopEntries strong { display:block; font-size:10px; overflow-wrap:anywhere; }
  .officeLabel { width:25.7%; display:flex; align-items:center; justify-content:center; background:#8aa953; color:#132012; font-size:16px; font-weight:bold; letter-spacing:.05em; }
  .timesheetTable { width:100%; table-layout:fixed; border-collapse:collapse; font-size:9px; }
  .timesheetTable th { height:42px; border:1px solid #6a7378; background:#1c2831; color:#fff; text-align:center; line-height:1.2; overflow-wrap:anywhere; font-size:8px; padding:3px; }
  .timesheetTable th.riskHead { background:#f7e45a; color:#1b1c1d; }
  .timesheetTable th.fatigueHead { background:#c54d52; color:white; }
  .timesheetTable td { height:32px; border:1px solid #848d92; padding:3px; overflow-wrap:anywhere; font-size:9px; vertical-align:middle; }
  .timesheetTable td.yellowCell { background:#ffe39b; }
  .sheetFooter { margin-top:7px; border:1px solid #26323a; border-top:7px solid #1c2730; display:flex; font-size:9px; min-height:114px; break-inside:avoid; page-break-inside:avoid; }
  .requirements { flex:1; min-width:0; padding:5px 5px 0; }
  .requirements>div { margin-bottom:2px; }
  .requirements strong { display:block; margin-top:3px; }
  .signature { display:flex; justify-content:space-between; gap:5px; background:#efd0c5; margin:4px -5px 0; padding:4px; }
  .signature>div:first-child { flex:1; }
  .noticeOrange { background:#e9b64e; width:37%; padding:3px; font-weight:bold; font-size:8px; }
  .dateSign { background:#efd0c5; margin:0 -5px!important; padding:4px; }
  .managerBox { width:30%; border-left:1px solid #25313a; padding:7px; display:flex; flex-direction:column; justify-content:space-between; }
  .continuation { text-align:right; padding-top:8px; font-size:10px; }
  @page { size:A4 landscape; margin:6mm; }
  @media print {
    html, body { margin:0 !important; padding:0 !important; width:100% !important; min-height:0 !important; background:white !important; }
    .printToolbar { display:none !important; }
    .paper.printPage { width:100% !important; max-width:none !important; height:auto !important; min-height:0 !important; padding:2mm !important; margin:0 !important; border:0 !important; box-shadow:none !important; overflow:visible !important; break-inside:avoid !important; page-break-inside:avoid !important; break-after:page; page-break-after:always; }
    .paper.printPage:last-child { break-after:auto; page-break-after:auto; }
    * { print-color-adjust:exact; -webkit-print-color-adjust:exact; }
  }
`;
function openTimesheetPrintView() {
  const source = document.querySelector('.printOnly');
  if (!source) { window.print(); return; }
  // This is a synchronous user-initiated popup, accepted by Safari.
  const preview = window.open('', '_blank', 'width=1180,height=850');
  if (!preview) { window.print(); return; }
  try {
    const doc = preview.document;
    doc.open();
    doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Hall's Timesheets · A4 landscape</title><style>${ISOLATED_PRINT_CSS}</style></head><body><div class="printToolbar"><span>Hall's Timesheets · A4 landscape print preview</span><div><button id="doPrint" type="button">Print</button><button id="closePrint" type="button">Close</button></div></div><main id="printMount"></main></body></html>`);
    doc.close();
    doc.getElementById('printMount').appendChild(source.cloneNode(true));
    doc.getElementById('doPrint').addEventListener('click', () => preview.print());
    doc.getElementById('closePrint').addEventListener('click', () => preview.close());
    // Match the working macOS Safari print sequence from the Longcroft rota:
    // allow the standalone document's @page landscape rule to settle before
    // focusing the popup and invoking the native print dialogue.
    // Unlike the previous double-requestAnimationFrame call, this waits 500 ms.
    preview.setTimeout(() => {
      if (preview.closed) return;
      preview.focus();
      preview.print();
    }, 500);
  } catch (error) {
    console.error('Print preview failed:', error);
    preview.close();
    window.print();
  }
}

// Download the already-rendered printable pages as a genuine A4-landscape PDF.
// Each printPage maps to exactly one PDF page (nine shift entries per page).
// The PDF is generated entirely in the user's browser; no data is uploaded.
async function downloadTimesheetPdf(sheet) {
  // Commit the native Safari date input when the button is clicked.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const printablePages = Array.from(document.querySelectorAll('.printOnly .printPage'));
  if (!printablePages.length) throw new Error('The printable timesheet is not available. Open it and try again.');

  // The PDF libraries are included in the main application build rather than
  // fetched as separate lazy-loaded JavaScript chunks. This avoids a stale
  // browser session requesting an old chunk after a Netlify deployment, which
  // can return index.html and fail with an invalid JavaScript MIME type.

  const exportRoot = document.createElement('div');
  exportRoot.className = 'pdfExportSandbox';
  exportRoot.setAttribute('aria-hidden', 'true');
  printablePages.forEach(page => exportRoot.appendChild(page.cloneNode(true)));
  document.body.appendChild(exportRoot);

  try {
    if (document.fonts?.ready) await document.fonts.ready;

    const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const pageWidth = 297;
    const pageHeight = 210;
    const margin = 6;
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;
    const exportPages = Array.from(exportRoot.querySelectorAll('.printPage'));

    for (let index = 0; index < exportPages.length; index += 1) {
      const page = exportPages[index];
      if (!page.getBoundingClientRect().width) {
        throw new Error('Could not measure the timesheet page for PDF export.');
      }
      const canvas = await html2canvas(page, {
        backgroundColor: '#ffffff',
        scale: 2.5,
        useCORS: false,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: Math.max(window.innerWidth, 1140),
        // Stage the original behind the app, but bring it forward inside the
        // isolated canvas clone so it always renders even when occluded.
        onclone: clonedDocument => {
          const clonedRoot = clonedDocument.querySelector('.pdfExportSandbox');
          if (clonedRoot) {
            clonedRoot.style.zIndex = '999999';
            clonedRoot.style.position = 'absolute';
            clonedRoot.style.left = '0';
            clonedRoot.style.top = '0';
          }
        },
      });
      if (!canvas.width || !canvas.height) {
        throw new Error(`Unable to render PDF page ${index + 1}.`);
      }
      if (index > 0) pdf.addPage('a4', 'landscape');

      // Fit each complete, printable timesheet page inside an A4 landscape page.
      // This avoids accidental extra pages and retains the form's relative layout.
      const scale = Math.min(contentWidth / canvas.width, contentHeight / canvas.height);
      const width = canvas.width * scale;
      const height = canvas.height * scale;
      pdf.addImage(
        canvas.toDataURL('image/jpeg', 0.94), 'JPEG',
        (pageWidth - width) / 2, margin, width, height,
        undefined, 'FAST'
      );
    }

    const safeName = String(sheet?.employeeName || 'Employee')
      .trim().replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '_') || 'Employee';
    const safePeriod = /^\d{4}-\d{2}$/.test(sheet?.period || '') ? sheet.period : 'Timesheet';
    pdf.save(`Halls_Timesheet_${safeName}_${safePeriod}.pdf`);
  } finally {
    exportRoot.remove();
  }
}

// Matches the latest Longcroft inactivity policy:
// Production: sign out after five minutes idle; warn for the final 15 seconds.
// Vite development: one-minute idle timeout with the same 15-second warning.
// A warning must be acknowledged explicitly; mouse/touch/keyboard activity
// alone cannot dismiss it. Background tabs are checked when reopened.
const SESSION_IDLE_LIMIT_MS = import.meta.env.DEV ? 60_000 : 5 * 60_000;
const SESSION_WARNING_MS = 15_000;

function SessionInactivityGuard() {
  const [warningOpen, setWarningOpen] = useState(false);
  const [countdown, setCountdown] = useState(SESSION_WARNING_MS / 1000);
  const [logoutError, setLogoutError] = useState('');
  const continueSessionRef = useRef(null);
  const logoutNowRef = useRef(null);

  useEffect(() => {
    let lastActivityAt = Date.now();
    let warningActive = false;
    let loggingOut = false;
    let logoutFailed = false;
    let mounted = true;

    const logout = async () => {
      if (loggingOut || !mounted) return;
      loggingOut = true;
      try {
        await signOut(auth);
      } catch (error) {
        // Keep the warning open if Firebase cannot complete sign-out.
        console.error('Session sign-out failed:', error);
        loggingOut = false;
        logoutFailed = true;
        setLogoutError('Could not sign out. Select Logout Now to try again.');
        setWarningOpen(true);
        warningActive = true;
      }
    };

    const checkElapsedTime = () => {
      if (!mounted || loggingOut || logoutFailed) return;
      const elapsed = Date.now() - lastActivityAt;
      if (elapsed >= SESSION_IDLE_LIMIT_MS) {
        void logout();
        return;
      }
      if (elapsed >= SESSION_IDLE_LIMIT_MS - SESSION_WARNING_MS) {
        warningActive = true;
        setWarningOpen(true);
        setCountdown(Math.max(1, Math.ceil((SESSION_IDLE_LIMIT_MS - elapsed) / 1000)));
      }
    };

    const recordActivity = () => {
      if (!mounted || loggingOut || logoutFailed || document.hidden) return;
      // If a tab was suspended, a mouse movement must not extend an
      // already-expired session before the focus handler can check it.
      if (Date.now() - lastActivityAt >= SESSION_IDLE_LIMIT_MS) {
        void logout();
        return;
      }
      if (warningActive) return;
      // An event arriving just before the next interval tick cannot skip the warning.
      if (Date.now() - lastActivityAt >= SESSION_IDLE_LIMIT_MS - SESSION_WARNING_MS) {
        checkElapsedTime();
        return;
      }
      lastActivityAt = Date.now();
    };

    const resumeCheck = () => checkElapsedTime();
    const visibilityCheck = () => {
      if (!document.hidden) checkElapsedTime();
    };

    continueSessionRef.current = () => {
      if (logoutFailed || loggingOut || Date.now() - lastActivityAt >= SESSION_IDLE_LIMIT_MS) {
        checkElapsedTime();
        return;
      }
      lastActivityAt = Date.now();
      warningActive = false;
      setLogoutError('');
      setWarningOpen(false);
      setCountdown(SESSION_WARNING_MS / 1000);
    };
    logoutNowRef.current = () => { logoutFailed = false; void logout(); };

    // Same user-activity events as lcrota (no special treatment by role).
    const activityEvents = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'];
    activityEvents.forEach(event => window.addEventListener(event, recordActivity, { passive: true }));
    document.addEventListener('visibilitychange', visibilityCheck);
    window.addEventListener('focus', resumeCheck);

    // Derive the countdown from wall-clock time instead of counting interval
    // ticks; Safari throttles timers when a tab is in the background.
    const ticker = window.setInterval(checkElapsedTime, 250);
    return () => {
      mounted = false;
      window.clearInterval(ticker);
      activityEvents.forEach(event => window.removeEventListener(event, recordActivity));
      document.removeEventListener('visibilitychange', visibilityCheck);
      window.removeEventListener('focus', resumeCheck);
      continueSessionRef.current = null;
      logoutNowRef.current = null;
    };
  }, []);

  if (!warningOpen) return null;
  const minutes = SESSION_IDLE_LIMIT_MS / 60_000;
  return <div className="sessionExpiryBackdrop">
    <section className="sessionExpiryDialog" role="alertdialog" aria-modal="true"
      aria-labelledby="session-expiry-title" aria-describedby="session-expiry-description"
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const buttons = [...event.currentTarget.querySelectorAll('button:not(:disabled)')];
        if (!buttons.length) return;
        if (event.shiftKey && document.activeElement === buttons[0]) {
          event.preventDefault();
          buttons[buttons.length - 1].focus();
        } else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
          event.preventDefault();
          buttons[0].focus();
        }
      }}>
      <div className="sessionExpiryHeading">
        <span className="sessionExpiryIcon" aria-hidden="true"><Clock3 size={23} /></span>
        <div>
          <h2 id="session-expiry-title">Session Expiring</h2>
          <p>Your timesheet session is about to end.</p>
        </div>
      </div>
      <p className="sessionExpiryDescription" id="session-expiry-description">
        You have been inactive for nearly {minutes} {minutes === 1 ? 'minute' : 'minutes'}.
        For security, you will be signed out in:
      </p>
      <div className="sessionExpiryCountdown" role="timer" aria-live="off">
        <strong>{countdown}</strong><span>seconds</span>
      </div>
      <p className="sessionExpiryHint">Unsaved timesheet changes will be lost if the session expires.</p>
      {logoutError && <p className="sessionExpiryError" role="alert">{logoutError}</p>}
      <div className="sessionExpiryActions">
        <button type="button" className="btn sessionExpiryContinue" autoFocus
          onClick={() => continueSessionRef.current?.()}>Continue Session</button>
        <button type="button" className="secondary sessionExpiryLogout"
          onClick={() => logoutNowRef.current?.()}><LogOut size={16} /> Logout Now</button>
      </div>
    </section>
  </div>;
}

function LogButton({children,...props}){return <button className="btn" {...props}>{children}</button>}
function App(){
 const [session,setSession]=useState(undefined),[profile,setProfile]=useState(null),[authError,setAuthError]=useState(''),[loginName,setLoginName]=useState(''),[password,setPassword]=useState('');
 const [view,setView]=useState('history'),[sheets,setSheets]=useState([]),[staff,setStaff]=useState([]),[selected,setSelected]=useState(null),[editor,setEditor]=useState(null),[busy,setBusy]=useState(false),[pdfBusy,setPdfBusy]=useState(false),[error,setError]=useState(''),[filterEmployee,setFilterEmployee]=useState('all'),[filterScope,setFilterScope]=useState('all');
 useEffect(()=>{if(!auth)return;return onAuthStateChanged(auth,async user=>{setSession(user);setProfile(null);if(user){try{const snap=await getDoc(doc(db,'users',user.uid));setProfile(snap.exists()?snap.data():{missing:true});}catch(e){setProfile({missing:true});setAuthError(e.message)}}});},[]);
 // Never query all timesheets from an administrator login: that would expose other people's drafts.
 // Merge (1) this user's own sheets with (2) non-draft records shared for review.
 // Matching Firestore Security Rules must also enforce these restrictions server-side.
 useEffect(() => {
   if (!session || !profile || profile.missing || profile.active !== true) { setSheets([]); return; }
   const ownQuery = query(collection(db, 'timesheets'), where('employeeId', '==', session.uid));
   const snapshots = { own: [], review: [] };
   const publish = () => {
     const merged = new Map();
     [...snapshots.review, ...snapshots.own].forEach(sheet => merged.set(sheet.id, sheet));
     setSheets([...merged.values()].sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0)));
   };
   const unsubs = [onSnapshot(ownQuery, s => {
     snapshots.own = s.docs.map(d => ({id:d.id,...d.data()})); publish();
   }, e => setError(e.message))];
   if (profile.role === 'admin') {
     const reviewQuery = query(collection(db,'timesheets'), where('status','in',['submitted','returned','approved']));
     unsubs.push(onSnapshot(reviewQuery, s => {
       snapshots.review = s.docs.map(d => ({id:d.id,...d.data()})); publish();
     }, e => setError(`Review queue: ${e.message}`)));
   }
   return () => unsubs.forEach(unsub => unsub());
 }, [session,profile]);
 useEffect(()=>{if(!session||profile?.role!=='admin')return;return onSnapshot(collection(db,'staffDirectory'),s=>setStaff(s.docs.map(d=>({uid:d.id,...d.data()})).sort((a,b)=>a.displayName.localeCompare(b.displayName))),e=>setError(e.message));},[session,profile]);
 async function login(e){e.preventDefault();setAuthError('');try{const email=loginName.includes('@')?loginName.trim():`${loginName.trim().toLowerCase()}@halls-timesheets.local`;await signInWithEmailAndPassword(auth,email,password);}catch(e){setAuthError('Login failed. Check your username and password.')}}
 function openEditor(sheet){setSelected(sheet?.id||null);setEditor(sheet?{...sheet,rows:safeRows(sheet.rows).map(r=>({...r,id:r.id||crypto.randomUUID()}))}:blankSheet(profile));setView('editor');setError('')}
 async function audit(action,id,details={}){try{await addDoc(collection(db,'auditLogs'),{action,timesheetId:id,actorUid:session.uid,timestamp:serverTimestamp(),...details});}catch(e){console.warn('Audit logging failed:',e.message)}}
 async function saveSheet(submit=false){
   if (!editor || !session || !isEditable(editor) || editor.employeeId!==session.uid) return;
   setBusy(true); setError('');
   try {
     if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
     await new Promise(resolve=>requestAnimationFrame(resolve));
     const data=sanitize({...editor,rows:currentFormRows(editor.rows),status:submit?'submitted':'draft'});
     if(submit){
       validateShiftRows(data.rows);
       if(!data.declarationAccepted||!data.declarationName)throw new Error('Please complete the declaration before submitting.');
       data.submittedAt=serverTimestamp();
     }
     // Saving an existing returned record as a draft also retains its previous return note.
     if(selected){
       const updates={...data,updatedAt:serverTimestamp()};
       delete updates.employeeId; delete updates.employeeName;
       await updateDoc(doc(db,'timesheets',selected),updates);
       await audit(submit?'submit':'save',selected);
     }else{
       // Create directly in its final status: avoid exposing a transient draft.
       const ref=await addDoc(collection(db,'timesheets'),{...data,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
       await audit(submit?'submit':'create',ref.id);
     }
     setEditor(null); setView('history');
   }catch(e){setError(e.message);if(window.matchMedia('(max-width:900px)').matches)requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'smooth'}));}
   finally{setBusy(false)}
 }
 async function review(status){
   if (!editor || profile?.role!=='admin' || editor.employeeId===session.uid || editor.status!=='submitted') return;
   setBusy(true);setError('');
   try{
     if(status==='returned'&&!editor.reviewNote?.trim())throw new Error('Enter a reason for returning this timesheet.');
     await updateDoc(doc(db,'timesheets',selected),{
       status, reviewNote:editor.reviewNote||'',managerName:editor.managerName||'',
       managerDate:editor.managerDate||'',managerSignature:editor.managerSignature||'',
       officeNote:editor.officeNote||'',rows:editor.rows,
       reviewedBy:session.uid,reviewedAt:serverTimestamp(),updatedAt:serverTimestamp()
     });
     await audit(status,selected);setView('history');setEditor(null);
   }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function deleteTimesheet(sheet) {
   // The database rules must separately enforce administrator-only deletion.
   if (profile?.role !== 'admin' || !sheet?.id || busy) return;
   const employee = sheet.employeeName || 'this employee';
   const period = displayPeriod(sheet.period);
   const confirmed = window.confirm(
     `Permanently delete ${employee}'s timesheet for ${period}?\n\n` +
     'This will remove the timesheet and its review notes for all users. This cannot be undone.'
   );
   if (!confirmed) return;
   setBusy(true);
   setError('');
   try {
     await deleteDoc(doc(db, 'timesheets', sheet.id));
     await audit('delete', sheet.id, {
       employeeId: sheet.employeeId || '',
       employeeName: employee,
       period: sheet.period || '',
       previousStatus: sheet.status || ''
     });
     if (selected === sheet.id) {
       setSelected(null);
       setEditor(null);
       setView('history');
     }
   } catch (e) {
     console.error('Failed to delete timesheet:', e);
     setError(e.code === 'permission-denied'
       ? 'Firestore denied deletion. Check that the timesheets security rules allow administrators to delete records.'
       : `Timesheet could not be deleted: ${e.message}`);
   } finally {
     setBusy(false);
   }
 }

 const isAdmin=profile?.role==='admin';
 const canEditOwn=editor && editor.employeeId===session?.uid && isEditable(editor);
 const canReview=Boolean(isAdmin && selected && editor && editor.employeeId!==session?.uid && editor.status==='submitted');
 const visibleSheets=sheets.filter(s=>
   (filterEmployee==='all'||s.employeeId===filterEmployee) &&
   (!isAdmin||filterScope==='all'||(filterScope==='mine'?s.employeeId===session?.uid:s.employeeId!==session?.uid&&s.status==='submitted'))
 );
 if(!isConfigured)return <main className="setup"><h1>Hall's Timesheets</h1><p>Firebase configuration is missing. Copy <code>.env.example</code> to <code>.env</code>, enter your Firebase web-app configuration and restart Vite.</p></main>;
 if(session===undefined)return <main className="setup">Checking session…</main>;
 if(!session)return <main className="loginWrap"><form className="loginCard" onSubmit={login}><div className="brandIcon"><ClipboardList/></div><h1>Hall's Timesheets</h1><p>Fatigue Risk Management · HB.FRM.82</p><label>Username or email<input value={loginName} onChange={e=>setLoginName(e.target.value)} autoComplete="username" required placeholder="Username"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="current-password" required placeholder="Password"/></label>{authError&&<p className="error">{authError}</p>}<button className="primary">Sign in</button></form></main>;
 if(!profile)return <main className="setup">Loading employee account…</main>;
 if(profile.missing||!profile.active)return <main className="setup"><h2>Account not activated</h2><p>Your login exists, but no active employee profile has been linked to it. Contact an administrator to activate your employee account.</p><button onClick={()=>signOut(auth)}>Sign out</button></main>;
 return <div className="shell"><aside className="sidebar"><div className="sideBrand"><ClipboardList size={24}/><div><strong>HALL'S</strong><small>TIMESHEETS</small></div></div><nav><button className={view==='history'?'active':''} onClick={()=>{setView('history');setError('')}}><FileText size={17}/> {isAdmin?'Timesheets':'My timesheets'}</button><button className={view==='editor'?'active':''} onClick={()=>openEditor(null)}><Plus size={17}/> New timesheet</button>{isAdmin&&<button className={view==='staff'?'active':''} onClick={()=>setView('staff')}><Users size={17}/> Employee register</button>}<button className={view==='account'?'active':''} onClick={()=>setView('account')}><Settings size={17}/> Account settings</button></nav><div className="sideFoot"><span>{profile.displayName}<small>{isAdmin?'Administrator':'Employee'}</small></span><button onClick={()=>signOut(auth)} title="Sign out"><LogOut size={18}/></button></div></aside><div className="mainArea"><header className="topbar"><strong>Fatigue Risk Management</strong><span>HB.FRM.82 · Rev 10</span></header><main className="content">{error&&<div className="alert error">{error}<button onClick={()=>setError('')}>×</button></div>}
 {view==='history'&&<><div className="pageHead"><div><h1>{isAdmin?'Timesheets':'My timesheets'}</h1><p>{isAdmin?'Review colleagues’ submissions and manage your own private drafts.':'Access saved, submitted and historical records.'}</p></div><LogButton onClick={()=>openEditor(null)}><Plus size={16}/> New timesheet</LogButton></div>{isAdmin&&<div className="timesheetScope" role="group" aria-label="Timesheet list view">
    <button className={filterScope==='all'?'active':''} type="button" onClick={()=>setFilterScope('all')}>All visible</button>
    <button className={filterScope==='mine'?'active':''} type="button" onClick={()=>{setFilterScope('mine');setFilterEmployee('all')}}>My timesheets</button>
    <button className={filterScope==='review'?'active':''} type="button" onClick={()=>{setFilterScope('review');setFilterEmployee('all')}}>Awaiting review</button>
  </div>}{isAdmin&&<div className="filterLine"><label>Employee <select value={filterEmployee} onChange={e=>setFilterEmployee(e.target.value)}><option value="all">All employees</option>{staff.map(s=><option key={s.uid} value={s.uid}>{s.displayName}</option>)}</select></label></div>}<div className="historyList">{visibleSheets.length===0?<div className="empty">No timesheets found. Select <b>New timesheet</b> to get started.</div>:visibleSheets.map(s=><div className="historyItem" key={s.id}><div className="docSymbol"><FileText size={22}/></div><div className="historyTitle"><strong>{displayPeriod(s.period)}</strong><small>{s.employeeName} · {s.rows?.filter(r=>r.date).length||0} shift entries · {Math.max(1,Math.ceil((s.rows?.filter(r=>r.date).length||0)/9))} printable page(s)</small>{s.reviewNote?.trim() && ['returned','draft'].includes(s.status) && <div className="returnNoteInList"><RotateCcw size={14} aria-hidden="true"/><span><strong>{s.status==='returned'?'Reason for return':'Previous return note'}:</strong> {s.reviewNote}</span></div>}</div><span className={'status '+s.status}>{s.status}</span><div className="historyActions"><button type="button" className="secondary" onClick={()=>openEditor(s)}>View</button>{isAdmin&&<button type="button" className="dangerAction" disabled={busy} title={`Delete ${s.employeeName}'s timesheet for ${displayPeriod(s.period)}`} aria-label={`Delete ${s.employeeName}'s timesheet for ${displayPeriod(s.period)}`} onClick={()=>deleteTimesheet(s)}><Trash2 size={15}/> Delete</button>}</div></div>)}</div></>}
 {view==='staff'&&isAdmin&&<StaffRegister staff={staff} currentUserUid={session.uid}/>}
 {view==='account'&&<AccountSettings profile={profile}/>}
 {view==='editor'&&editor&&<><div className="pageHead editorToolbar"><div><button className="back" onClick={()=>{setView('history');setEditor(null)}}><ArrowLeft size={16}/> Back to timesheets</button><h1>{selected?'Timesheet':'New timesheet'}</h1><p>{editor.employeeName} · {displayPeriod(editor.period)}</p></div><div className="toolbarActions"><span className={'status '+editor.status}>{editor.status}</span><button type="button" className="secondary" onClick={openTimesheetPrintView}><Printer size={16}/> Print</button><button type="button" className="secondary" disabled={pdfBusy} onClick={async()=>{setError('');setPdfBusy(true);try{await downloadTimesheetPdf(editor);}catch(e){console.error('PDF export failed:',e);setError(e?.message||'Could not save the timesheet as a PDF.');}finally{setPdfBusy(false);}}}><Download size={16}/> {pdfBusy?'Creating PDF…':'Save PDF'}</button>{canEditOwn&&<><button className="secondary desktopEntrySave" onClick={()=>saveSheet(false)} disabled={busy}><Save size={16}/> Save draft</button><button className="btn desktopEntrySubmit" disabled={busy} onClick={()=>saveSheet(true)}><Send size={16}/> Submit</button></>}{isAdmin&&selected&&<button type="button" className="dangerAction" disabled={busy} onClick={()=>deleteTimesheet(editor)}><Trash2 size={16}/> Delete timesheet</button>}</div></div>{editor.employeeId===session.uid&&editor.reviewNote?.trim()&&['returned','draft'].includes(editor.status)&&<section className="returnNotePanel" role="note" aria-label="Reason the timesheet was returned"><div className="returnNoteHeading"><RotateCcw size={18} aria-hidden="true"/><strong>{editor.status==='returned'?'Timesheet returned for correction':'Previous return note'}</strong></div><p>{editor.reviewNote}</p><small>{editor.status==='returned'?'Please review the feedback, correct the timesheet and submit it again.':'This note is retained from the previous return so you can refer to it while editing.'}</small></section>}<Timesheet key={selected||'new'} sheet={editor} setSheet={setEditor} editable={Boolean(canEditOwn)} admin={canReview} />{canEditOwn&&<div className="mobileBottomActions"><button type="button" className="secondary" disabled={busy} onClick={()=>saveSheet(false)}><Save size={17}/> Save draft</button><button type="button" className="btn" disabled={busy} onClick={()=>saveSheet(true)}><Send size={17}/> Submit timesheet</button></div>}{canReview&&<div className="reviewPanel"><h2>Manager review</h2><label>Review note<textarea value={editor.reviewNote||''} onChange={e=>setEditor({...editor,reviewNote:e.target.value})} placeholder="Required if returning for correction"/></label><div className="reviewActions"><button disabled={busy} onClick={()=>review('returned')} className="secondary"><RotateCcw size={16}/> Return for correction</button><button disabled={busy} onClick={()=>review('approved')} className="btn"><Check size={16}/> Approve timesheet</button><button disabled={busy} onClick={()=>review('submitted')} className="secondary">Save office fields</button></div></div>}</>}
 </main></div><SessionInactivityGuard key={session.uid} /></div>;
}
// The mobile editor intentionally shares the exact same row schema as the
// traditional HB.FRM.82 table. Printed/PDF pages are still rendered from that
// original form; no mobile-specific fields are persisted to Firestore.
const mobileShiftFields = [
  {key:'date',label:'Shift date',type:'date',required:true},
  {key:'onCall',label:'On call',type:'select'},
  {key:'location',label:'Location',type:'text',placeholder:'Site or location',required:true},
  {key:'start',label:'Start time',type:'text',placeholder:'HH:MM',required:true},
  {key:'finish',label:'Finish time',type:'text',placeholder:'HH:MM',required:true},
  {key:'breaks',label:'Breaks taken',type:'select'},
  {key:'commute',label:'Total commute time',type:'text',placeholder:'Enter time'},
  {key:'swipe',label:'Swipe in / out',type:'text',placeholder:'Enter details'},
];
const mobileOfficeFields = [
  {key:'working',label:'Total working hours'},
  {key:'shiftsClaim',label:'Total shifts claim'},
  {key:'duty',label:'Duty length'},
  {key:'rest',label:'Rest length'},
  {key:'risk',label:'Risk score'},
  {key:'fatigue',label:'Fatigue score'},
];
const rowHasData = row => Object.entries(row).some(([key,value]) => key!=='id' && String(value ?? '').trim() !== '');
const rowRequiredComplete = row => ['date','location','start','finish'].every(key=>String(row[key]??'').trim());
function formatShiftDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value||'')) return '';
  const [year,month,day] = value.split('-').map(Number);
  const date = new Date(year,month-1,day,12);
  return date.toLocaleDateString('en-GB',{day:'numeric',month:'short'});
}
// A stable visual shell for mobile native pickers. The real input stays
// interactive (and accessible) above the text, but its intrinsic Safari sizing
// cannot stretch the card or overlap neighbouring fields.
function formatMobilePickerValue(type, value) {
  if (type === 'month' && /^\d{4}-\d{2}$/.test(value || '')) {
    const [year, month] = value.split('-').map(Number);
    return new Date(year, month - 1, 1, 12).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  }
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(value || '')) {
    const [year, month, day] = value.split('-').map(Number);
    return new Date(year, month - 1, day, 12).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return type === 'date' ? 'Select shift date' : 'Select month';
}
function MobileNativePicker({ type, value, disabled, ...inputProps }) {
  return <span className={`mobilePicker mobilePicker-${type} ${!value ? 'isEmpty' : ''} ${disabled ? 'isDisabled' : ''}`}>
    <span className="mobilePickerText" aria-hidden="true">{formatMobilePickerValue(type, value)}</span>
    <CalendarDays className="mobilePickerIcon" size={18} aria-hidden="true" />
    <input {...inputProps} type={type} value={value || ''} disabled={disabled} />
  </span>;
}

function Timesheet({sheet,setSheet,editable,admin}){
  const rows=safeRows(sheet.rows);
  const update=(key,value)=>setSheet(s=>({...s,[key]:value}));
  const updateRow=(i,key,value)=>setSheet(s=>({...s,rows:s.rows.map((r,j)=>i===j?{...r,[key]:value}:r)}));
  const printable=rows.filter(rowHasData);
  const pages=Array.from({length:Math.max(1,Math.ceil(printable.length/9))},(_,i)=>printable.slice(i*9,i*9+9));
  const [expandedShiftId,setExpandedShiftId]=useState(()=>rows[0]?.id||null);
  const [revealedEmptyIds,setRevealedEmptyIds]=useState([]);
  const [showOriginal,setShowOriginal]=useState(false);
  const [viewRequirements,setViewRequirements]=useState(false);
  const defaultBlankId=editable?rows.find(row=>!rowHasData(row))?.id:null;
  const visibleMobileRows=rows.map((row,index)=>({row,index})).filter(({row})=>
    rowHasData(row)||row.id===defaultBlankId||revealedEmptyIds.includes(row.id)
  );

  function addMobileShift(){
    const next=rows.find(row=>!rowHasData(row)&&row.id!==defaultBlankId&&!revealedEmptyIds.includes(row.id));
    if(next){setRevealedEmptyIds(ids=>[...ids,next.id]);setExpandedShiftId(next.id);return;}
    const added=emptyRow();
    setSheet(current=>({...current,rows:[...current.rows,added]}));
    setRevealedEmptyIds(ids=>[...ids,added.id]);
    setExpandedShiftId(added.id);
  }
  function duplicateMobileShift(index){
    const original=rows[index];
    const copy={...emptyRow()};
    for(const {key} of mobileShiftFields)copy[key]=original[key]||'';
    setSheet(current=>{
      const next=[...current.rows];next.splice(index+1,0,copy);
      return {...current,rows:next};
    });
    setExpandedShiftId(copy.id);
  }
  function removeMobileShift(index){
    const target=rows[index];
    if(rowHasData(target)&&!window.confirm(`Remove shift ${index+1} from this timesheet? This change will take effect when you save.`))return;
    const nextRows=rows.filter((_,i)=>i!==index);
    if(!nextRows.length)nextRows.push(emptyRow());
    setSheet(current=>({...current,rows:nextRows}));
    setRevealedEmptyIds(ids=>ids.filter(id=>id!==target.id));
    if(expandedShiftId===target.id)setExpandedShiftId(nextRows[0]?.id||null);
  }
  function mobileField({key,label,type,placeholder,required},row,index){
    const id=`mobile-shift-${row.id}-${key}`;
    const disabled=!editable;
    const common={id,value:row[key]||'',disabled,'data-timesheet-row':index,'data-timesheet-field':key,
      onChange:e=>updateRow(index,key,e.target.value),
      onBlur:key==='date'?e=>updateRow(index,key,e.currentTarget.value):undefined};
    return <label key={key} className={`mobileField mobileField-${key}`} htmlFor={id}>
      <span>{label}{required&&<span aria-hidden="true" className="requiredStar"> *</span>}</span>
      {type==='select'?<select {...common}><option value="">Select</option><option value="Yes">Yes</option><option value="No">No</option></select>
        :type==='date'?<MobileNativePicker {...common} type="date" aria-label={label} />
        :['start','finish'].includes(key)?<ClockEntry id={id} label={label} rowIndex={index} value={row[key]||''} disabled={disabled} onChange={value=>updateRow(index,key,value)} />
        :<input {...common} type={type} placeholder={placeholder||''} autoComplete="off"/>}
    </label>;
  }
  const dateType='date';const selectKeys=['onCall','breaks'];
  function gridTable(displayRows,print=false){return <table className="timesheetTable"><colgroup>{[8,6,14,7,7,6,7,6,6,6,7,7,6,7].map((w,i)=><col key={i} style={{width:`${w}%`}}/>)}</colgroup><thead><tr>{columns.map(([key,label])=><th key={key} className={key==='risk'?'riskHead':key==='fatigue'?'fatigueHead':''}>{label}</th>)}</tr></thead><tbody>{displayRows.map((r,i)=><tr key={r.id||i}>{columns.map(([key])=><td key={key} className={key==='working'||key==='shiftsClaim'?'yellowCell':''}>{print?<span>{r[key]||'\u00a0'}</span>:selectKeys.includes(key)?<select aria-label={key} value={r[key]||''} disabled={!editable} onChange={e=>updateRow(i,key,e.target.value)}><option value=""></option><option>Yes</option><option>No</option></select>:['start','finish'].includes(key)?<ClockEntry label={key==='start'?'Start time':'Finish time'} className="clockDesktop" rowIndex={i} value={r[key]||''} disabled={!editable} onChange={value=>updateRow(i,key,value)} />:<input aria-label={key} data-timesheet-row={i} data-timesheet-field={key} disabled={!editable&&!(admin&&officeKeys.includes(key))} className="tableInput" type={key==='date'?dateType:'text'} value={r[key]||''} onChange={e=>updateRow(i,key,e.target.value)} onBlur={key==='date'?e=>updateRow(i,key,e.currentTarget.value):undefined}/>}</td>)}</tr>)}</tbody></table>}
  function front(pageNo,print=false){return <><div className="sheetHeader"><div className="paperMeta"><strong>Document: HB.FRM.82</strong><span>Date Issue: 11/2022</span><span>Rev: 10</span></div><h2>TIMESHEET - (FATIGUE - RISK MANAGEMENT NR/L2/OHS/003)</h2></div><div className="sheetInstructions"><b>The working hours is calculated using HSE-Fatigue-and-Risk-Index-FRI-Calculator (Weekly Cycle)</b><span>Fatigue Index: Should be no more than 35 for day shifts; should be no more than 45 for night shifts.</span><span>Risk Index: Scores should not be above 1.6.</span></div><div className="sheetTop"><div className="weekBlock"><label>Week No:</label>{print?<span>{sheet.weekNo||'\u00a0'}</span>:<input value={sheet.weekNo||''} disabled={!editable} onChange={e=>update('weekNo',e.target.value)}/>}</div><div className="paperTopEntries"><label>Employees Name: <strong>{sheet.employeeName}</strong></label><label>Employment Status: {print?<strong>{sheet.employmentStatus}</strong>:<input value={sheet.employmentStatus||''} disabled={!editable} onChange={e=>update('employmentStatus',e.target.value)}/>}</label><label>MONTH {print?<strong>{displayPeriod(sheet.period)}</strong>:<input type="month" value={sheet.period||''} disabled={!editable} onChange={e=>update('period',e.target.value)}/>}</label></div><div className="officeLabel">OFFICE USE</div></div>{print?gridTable([...pages[pageNo],...Array.from({length:Math.max(0,9-pages[pageNo].length)},emptyRow)],true):gridTable(rows)}</>}
  const legal=<div className="sheetFooter"><div className="requirements"><div>1. No-one shall work more than 13 consecutive turns of duty in any 14-day period.</div><div>2. No more than 72 hours to be worked per calendar week (00:00hrs Sunday to 23:59 hrs Saturday).</div><div>3. No more than 12 hours to be worked per turn of duty/shift.</div><div>4. A minimum rest period of 12 hours between shifts including any travelling time.</div><div>5. Ensure to access the Sentinel App through using Swipe In/Out on every shift with the COSS / person in charge (maintaining safe access to the NWR Infrastructure).</div><strong>DECLARATION</strong><div>I hereby waive the restrictions on the 48 hour average weekly working time set out in Working Time Regulations 1998 (normal average of over 17 weeks).</div><div className="signature"><div>Signature: <b>{sheet.declarationName||''}</b></div><div className="noticeOrange">Note: Not driving; sharing transportation</div></div><div className="dateSign">Date Sign: {sheet.declarationDate||''}</div></div><div className="managerBox"><strong>MANAGER'S APPROVAL:</strong><div>Name: {sheet.managerName||''}</div><div>Signature: {sheet.managerSignature||''}</div><div>Date Signed: {sheet.managerDate||''}</div></div></div>;
  return <>
    {/* Desktop: the original form stays fully editable and unchanged. */}
    <div className="paper screenPaper">{front(0)}<div className="rowControls">{editable&&<><button type="button" onClick={()=>setSheet(s=>({...s,rows:[...s.rows,emptyRow()]}))}><Plus size={16}/> Add new row</button><button type="button" className="secondary" disabled={rows.length<=1} onClick={()=>setSheet(s=>({...s,rows:s.rows.slice(0,-1)}))}><Trash2 size={15}/> Remove last row</button></>}<span>{rows.length} rows · {pages.length} printable page(s)</span></div><div className="legalScreen">{legal}</div></div>

    {/* Mobile: cards are a more accessible entry format for those same rows. */}
    <div className="mobileShiftEditor">
      <div className="mobileEntryIntro"><div><span className="mobileEyebrow">HB.FRM.82 · Mobile entry</span><h2>Shift entries</h2><p>Enter each shift below. The original form is preserved for printing and PDF.</p></div><span className="mobileCount">{printable.length} entered</span></div>
      <div className="mobileSheetDetails">
        <div className="mobileIdentity"><span>Employee</span><strong>{sheet.employeeName||'Employee'}</strong></div>
        <div className="mobileMetaGrid">
          <label>Month<MobileNativePicker type="month" aria-label="Month" disabled={!editable} value={sheet.period||''} onChange={e=>update('period',e.target.value)}/></label>
          <label>Week number<input type="text" inputMode="numeric" disabled={!editable} value={sheet.weekNo||''} onChange={e=>update('weekNo',e.target.value)} placeholder="Week no."/></label>
          <label className="mobileMetaFull">Employment status<input type="text" disabled={!editable} value={sheet.employmentStatus||''} onChange={e=>update('employmentStatus',e.target.value)} placeholder="Employment status"/></label>
        </div>
      </div>
      <div className="mobileShiftList">
        {visibleMobileRows.length===0&&<div className="mobileEmpty">This timesheet has no shift entries.</div>}
        {visibleMobileRows.map(({row,index})=>{
          const expanded=expandedShiftId===row.id;
          const filled=rowHasData(row);
          const complete=rowRequiredComplete(row);
          const hasOfficeData=mobileOfficeFields.some(field=>String(row[field.key]||'').trim());
          const summary=[formatShiftDate(row.date),row.location,[row.start,row.finish].filter(Boolean).join('–')].filter(Boolean).join(' · ');
          return <section key={row.id} className={`mobileShiftCard ${expanded?'isExpanded':''}`}>
            <button type="button" className="mobileShiftToggle" aria-expanded={expanded} aria-controls={`mobile-shift-body-${row.id}`} onClick={()=>setExpandedShiftId(expanded?null:row.id)}>
              <span className="mobileShiftNumber">{index+1}</span><span className="mobileShiftSummary"><strong>Shift {index+1}</strong><small>{summary||'New shift — no details entered'}</small></span><span className={`mobileShiftState ${!filled?'isBlank':complete?'isComplete':'isIncomplete'}`}>{!filled?'New':complete?'Ready':'Incomplete'}</span>{expanded?<ChevronUp size={18}/>:<ChevronDown size={18}/>}</button>
            {expanded&&<div id={`mobile-shift-body-${row.id}`} className="mobileShiftBody">
              <div className="mobileShiftFields">{mobileShiftFields.map(field=>mobileField(field,row,index))}</div>
              {(admin||hasOfficeData)&&<details className="mobileOfficeDetails"><summary><span className="mobileOfficeBadge">OFFICE USE</span><span className="mobileOfficeSummary">{hasOfficeData?'Calculations recorded':'Hours, duty and risk scores'}</span><ChevronDown className="mobileOfficeChevron" size={17} aria-hidden="true" /></summary><div className="mobileOfficeGrid">{mobileOfficeFields.map(({key,label})=><label key={key} className={`mobileOfficeField mobileOffice-${key}`}><span>{label}</span><input value={row[key]||''} disabled={!admin} onChange={e=>updateRow(index,key,e.target.value)} inputMode="decimal"/></label>)}</div></details>}
              {editable&&<div className="mobileRowActions"><button type="button" className="secondary" onClick={()=>duplicateMobileShift(index)}><Copy size={16}/> Duplicate shift</button><button type="button" className="mobileRemove" onClick={()=>removeMobileShift(index)}><Trash2 size={16}/> Remove</button></div>}
            </div>}
          </section>;
        })}
      </div>
      {editable&&<button type="button" className="mobileAddShift" onClick={addMobileShift}><Plus size={18}/> Add another shift</button>}
      <p className="mobileRowHint">{printable.length} entered shift row(s) · {pages.length} printable A4 landscape page(s). You can repeat a shift using Duplicate shift.</p>
      <button type="button" className="mobileOriginalToggle" aria-expanded={showOriginal} onClick={()=>setShowOriginal(value=>!value)}>{showOriginal?<EyeOff size={17}/>:<Eye size={17}/>} {showOriginal?'Hide original form':'View original form'} {showOriginal?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</button>
    </div>

    {showOriginal&&<div className="mobileOriginalPreview"><p>Original form preview · read-only. Swipe horizontally to inspect the full document.</p><div className="mobilePreviewViewport">{pages.map((_,index)=><div className="paper mobilePreviewPage" key={index}>{front(index,true)}{index===pages.length-1?legal:<div className="continuation">Continuation sheet {index+1} of {pages.length} · {sheet.employeeName}</div>}</div>)}</div></div>}

    <div className="mobileRequirements"><button type="button" onClick={()=>setViewRequirements(value=>!value)} aria-expanded={viewRequirements}><ClipboardList size={17}/> Form requirements and declaration {viewRequirements?<ChevronUp size={17}/>:<ChevronDown size={17}/>}</button>{viewRequirements&&<div className="mobileRequirementsBody"><ol><li>No-one shall work more than 13 consecutive turns of duty in any 14-day period.</li><li>No more than 72 hours to be worked per calendar week (00:00hrs Sunday to 23:59 hrs Saturday).</li><li>No more than 12 hours to be worked per turn of duty/shift.</li><li>A minimum rest period of 12 hours between shifts including any travelling time.</li><li>Ensure to access the Sentinel App through using Swipe In/Out on every shift with the COSS / person in charge (maintaining safe access to the NWR Infrastructure).</li></ol><strong>Declaration on the original form</strong><p>I hereby waive the restrictions on the 48 hour average weekly working time set out in Working Time Regulations 1998 (normal average of over 17 weeks).</p><p className="mobileTransportNote">Note: Not driving; sharing transportation</p></div>}</div>
    <div className="declarationBox"><h3>Employee declaration</h3><p>The original form includes a declaration waiving the 48-hour average weekly working-time restriction. Signing in alone does not constitute acceptance.</p><label className="checkline"><input type="checkbox" disabled={!editable} checked={Boolean(sheet.declarationAccepted)} onChange={e=>update('declarationAccepted',e.target.checked)}/> I have read and agree to the declaration printed above.</label><div className="inlineFields"><label>Type full name<input disabled={!editable} value={sheet.declarationName||''} onChange={e=>update('declarationName',e.target.value)}/></label><label>Date<input type="date" disabled={!editable} value={sheet.declarationDate||''} onChange={e=>update('declarationDate',e.target.value)}/></label></div><small>This typed acknowledgement is recorded with the submission; confirm organisational requirements for valid signatures and opt-outs.</small></div>
    {admin&&<div className="officeInputs"><h3>Office use and manager approval</h3><div className="inlineFields"><label>Manager name<input value={sheet.managerName||''} onChange={e=>update('managerName',e.target.value)}/></label><label>Manager signature / reference<input value={sheet.managerSignature||''} onChange={e=>update('managerSignature',e.target.value)}/></label><label>Date approved<input type="date" value={sheet.managerDate||''} onChange={e=>update('managerDate',e.target.value)}/></label></div><label>Office note<textarea value={sheet.officeNote||''} onChange={e=>update('officeNote',e.target.value)}/></label></div>}
    {/* This original A4 renderer stays independent from mobile cards and powers
        both Print and Save PDF without any schema or presentation changes. */}
    <div className="printOnly">{pages.map((p,i)=><div className="paper printPage" key={i}>{front(i,true)}{i===pages.length-1?legal:<div className="continuation">Continuation sheet {i+1} of {pages.length} · {sheet.employeeName}</div>}</div>)}</div>
  </>;
}

export default App;
