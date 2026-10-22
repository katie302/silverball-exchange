import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createStore } from './store.js';

const Ctx = createContext(null);

export function GameProvider({ children, practice = false }) {
  const ref = useRef(null);
  if (!ref.current) ref.current = createStore({ practice });
  const [snap, setSnap] = useState(ref.current.get());
  const [toast, setToast] = useState(null);
  useEffect(() => ref.current.subscribe(setSnap), []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(null), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  // Returns true on success; on failure shows the engine's message.
  const dispatch = useCallback(async (action) => {
    try {
      await ref.current.dispatch({ ...action, now: Date.now() });
      return true;
    } catch (e) {
      setToast({ msg: e.message || String(e), id: Date.now() });
      return false;
    }
  }, []);

  const value = { state: snap.state, ready: snap.ready, error: snap.error, dispatch, setToast, profiles: ref.current.profiles, practice };
  return (
    <Ctx.Provider value={value}>
      {children}
      {toast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] rounded-xl bg-pink px-4 py-2 text-sm font-bold text-ink shadow-lg">
          {toast.msg}
        </div>
      )}
    </Ctx.Provider>
  );
}

export const useGame = () => useContext(Ctx);

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
