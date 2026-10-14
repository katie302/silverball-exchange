import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db, isLocal } from './firebase.js';
import { initialState, reduce } from './engine/index.js';

const KEY = 'silverball-v2';

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
        const raw = localStorage.getItem(KEY);
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
      dispatch: async (action) => {
        const next = reduce(load(), action);
        localStorage.setItem(KEY, JSON.stringify(next));
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
  return {
    get: () => snap,
    subscribe: (l) => (listeners.add(l), () => listeners.delete(l)),
    dispatch: (action) =>
      runTransaction(db, async (tx) => {
        const d = await tx.get(ref);
        const cur = d.exists() ? JSON.parse(d.data().state) : initialState();
        const next = reduce(cur, action);
        tx.set(ref, { state: JSON.stringify(next), updatedAt: Date.now() });
      }),
  };
}
