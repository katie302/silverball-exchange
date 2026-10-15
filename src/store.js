import { doc, getDoc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db, isLocal } from './firebase.js';
import { initialState, reduce } from './engine/index.js';

const KEY = 'silverball-v2';
const PKEY = 'silverball-profiles-v1';

// localStorage can be missing or blocked (private windows, previews): fall back to memory.
const mem = {};
const store = {
  get(k) {
    try {
      const v = localStorage.getItem(k);
      return v ?? mem[k] ?? null;
    } catch {
      return mem[k] ?? null;
    }
  },
  set(k, v) {
    mem[k] = v;
    try {
      localStorage.setItem(k, v);
    } catch {
      /* memory only */
    }
  },
};

// One game document. Every change goes through the engine's reducer inside a
// Firestore transaction, so two phones trading at once can't corrupt each other.
export function createStore() {
  let snap = { state: initialState(), ready: false, error: null };
  const listeners = new Set();
  const set = (patch) => {
    snap = { ...snap, ...patch };
    listeners.forEach((l) => l(snap));
  };

  if (isLocal) {
    const load = () => {
      try {
        const raw = store.get(KEY);
        return raw ? JSON.parse(raw) : initialState();
      } catch {
        return initialState();
      }
    };
    snap = { state: load(), ready: true, error: null };
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) set({ state: load() });
    });
    return {
      get: () => snap,
      subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
      profiles: {
        load: async () => JSON.parse(store.get(PKEY) || '{}'),
        update: async (fn) => {
          const cur = JSON.parse(store.get(PKEY) || '{}');
          const next = fn(cur);
          store.set(PKEY, JSON.stringify(next));
          return next;
        },
      },
      dispatch: async (action) => {
        // '__wipe' only exists in single-device local mode (used by the trial page).
        const next = action.type === '__wipe' ? initialState() : reduce(load(), action);
        store.set(KEY, JSON.stringify(next));
        set({ state: next });
      },
    };
  }

  const ref = doc(db, 'silverball', 'v2');
  onSnapshot(
    ref,
    (d) => set({ state: d.exists() ? JSON.parse(d.data().state) : initialState(), ready: true, error: null }),
    (err) => set({ error: err.message, ready: true })
  );
  const pref = doc(db, 'silverball', 'profiles');
  return {
    get: () => snap,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    profiles: {
      load: async () => {
        const d = await getDoc(pref);
        return d.exists() ? JSON.parse(d.data().data) : {};
      },
      update: (fn) =>
        runTransaction(db, async (tx) => {
          const d = await tx.get(pref);
          const next = fn(d.exists() ? JSON.parse(d.data().data) : {});
          tx.set(pref, { data: JSON.stringify(next), updatedAt: Date.now() });
          return next;
        }),
    },
    dispatch: (action) =>
      runTransaction(db, async (tx) => {
        const d = await tx.get(ref);
        const cur = d.exists() ? JSON.parse(d.data().state) : initialState();
        const next = reduce(cur, action);
        tx.set(ref, { state: JSON.stringify(next), updatedAt: Date.now() });
      }),
  };
}
