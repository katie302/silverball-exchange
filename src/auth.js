import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { auth, isLocal } from './firebase.js';

// undefined = still loading, null = signed out, {email} = signed in.
export function useAuthUser() {
  const [user, setUser] = useState(isLocal ? { email: 'local' } : undefined);
  useEffect(() => {
    if (isLocal) return undefined;
    return onAuthStateChanged(auth, (u) => setUser(u ? { email: u.email } : null));
  }, []);
  return user;
}

export const signIn = () => signInWithPopup(auth, new GoogleAuthProvider());
export const signOutUser = () => (isLocal ? Promise.resolve() : signOut(auth));
