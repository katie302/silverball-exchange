import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const env = import.meta.env;
const cfg = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
};

// With no Firebase keys the app runs in single-device "local mode" (localStorage).
export const isLocal = !cfg.apiKey || !cfg.projectId;

let app = null;
export const db = isLocal ? null : getFirestore((app = initializeApp(cfg)));
export const auth = isLocal ? null : getAuth(app);
