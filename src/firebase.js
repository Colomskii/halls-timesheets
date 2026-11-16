
import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const isConfigured = Boolean(config.apiKey && config.projectId && config.appId);

// Reuse the default Firebase app if this module is evaluated again (e.g. Vite HMR).
const app = isConfigured ? (getApps().length ? getApp() : initializeApp(config)) : null;

// iOS/iPadOS Safari and other iOS WebKit browsers can be affected by
// intermittent Firestore WebChannel requests. iPadOS can report a desktop Mac UA.
// Target desktop macOS Safari too, without changing other desktop browsers.
const shouldForceLongPolling = (() => {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent || '';
  const isIOSorIPadOS = /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const isMacSafari = /Macintosh|Mac OS X/i.test(ua) &&
    /AppleWebKit/i.test(ua) &&
    /Safari\//i.test(ua) &&
    !/Chrome|Chromium|CriOS|FxiOS|Edg|OPR|Opera|DuckDuckGo|Orion/i.test(ua);

  return isIOSorIPadOS || isMacSafari;
})();

export const auth = app ? getAuth(app) : null;

// Firestore transport must be configured before the first Firestore use.
// Keep the SDK's default behaviour (including automatic detection) elsewhere.
export const db = app
  ? (shouldForceLongPolling
      ? initializeFirestore(app, { experimentalForceLongPolling: true })
      : getFirestore(app))
  : null;
