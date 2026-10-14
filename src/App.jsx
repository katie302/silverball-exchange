import React, { useEffect, useState } from 'react';
import { GameProvider, useGame } from './game.jsx';
import PlayerApp from './player.jsx';
import OrganizerApp from './organizer.jsx';
import { isLocal } from './firebase.js';

function Router() {
  const [hash, setHash] = useState(window.location.hash);
  const { error } = useGame();
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return (
    <>
      {isLocal && (
        <div className="bg-amber px-3 py-1 text-center font-mono text-[11px] font-semibold text-ink">
          Local mode: data stays on this device. Add Firebase keys to .env for a shared game.
        </div>
      )}
      {error && <div className="bg-pink px-3 py-2 text-center text-sm font-bold text-ink">Connection problem: {error}</div>}
      {hash.startsWith('#/organizer') ? <OrganizerApp /> : <PlayerApp />}
    </>
  );
}

export default function App() {
  return (
    <GameProvider>
      <Router />
    </GameProvider>
  );
}
