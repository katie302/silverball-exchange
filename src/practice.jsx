import React, { useEffect, useState } from 'react';
import { GameProvider, useGame } from './game.jsx';
import PlayerApp from './player.jsx';
import OrganizerApp from './organizer.jsx';
import {
  reduce, hashPin, activePlayers, currentRound, roundPhase, checkBuy, checkBet, kindsForSize, diversifyStatus,
} from './engine/index.js';

// Practice mode: a sandbox copy of the game with made-up players. It has its own
// storage and never reads or writes the real tournament.
const NAMES = ['Katie', 'Priscilla', 'Josh', 'Thomas', 'Alex', 'Nate', 'Ryan', 'Rob'];
const MACHINES = ['Fathom', 'Laser Cue', 'Mata Hari', 'Dolly', 'Playboy', 'Future Spa', 'JackBot', 'White Water', 'Jaws', 'Genesis', 'Wizard of Oz', 'Iron Man'];
const RATINGS = { p2: 1820, p3: 1650, p4: 1710, p6: 1400 };
const PIN = '1234';

const shuffle = (a) => a.map((v) => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);

function Bar({ view, setView }) {
  const { state, dispatch } = useGame();
  const org = (type, extra = {}) => dispatch({ type, actor: 'practice', ...extra });
  const hasGame = state.playerOrder.length > 0;
  const horse = state.settings.style === 'horse';

  async function start(style) {
    await dispatch({ type: '__wipe' });
    await org('claimOrganizer');
    await org('updateSettings', { patch: { style, rounds: 3 } });
    await org('addPlayers', { names: NAMES });
    await org('addMachines', { names: MACHINES });
    for (let i = 1; i <= NAMES.length; i++) {
      const pid = `p${i}`;
      await dispatch({ type: 'claimPlayer', pid, pinHash: await hashPin(PIN, pid), ifpaId: RATINGS[pid] ? String(1000 + i) : '' });
      if (RATINGS[pid]) await org('setIfpa', { pid, ifpaId: String(1000 + i), ifpaRating: RATINGS[pid] });
    }
    await org('startTournament');
    setView('org');
  }

  // The made-up players follow the same rules as everyone else (checked on a local copy first).
  async function othersPlay() {
    let sim = state;
    const r = currentRound(sim);
    if (!r) return;
    const phase = roundPhase(sim, Date.now());
    const viewer = view.startsWith('p') ? view : null;
    for (const pid of shuffle(activePlayers(sim))) {
      if (pid === viewer) continue;
      const pinHash = await hashPin(PIN, pid);
      const tries = [];
      const own = r.stockByPlayer[pid];
      const others = shuffle(Object.values(sim.stocks).filter((x) => x.round === r.n && x.playerId !== pid));
      if (horse) {
        if (Math.random() < 0.4) tries.push({ type: 'bet', stockId: own, kind: 'win', amount: 50 });
        for (const o of others.slice(0, 2)) {
          const g = r.groups.find((x) => x.id === o.groupId);
          const kinds = kindsForSize(g.playerIds.length);
          tries.push({ type: 'bet', stockId: o.id, kind: kinds[Math.floor(Math.random() * kinds.length)], amount: 50 + 50 * Math.floor(Math.random() * 4) });
        }
      } else {
        tries.push({ type: 'buy', stockId: own, pct: 10 });
        if (phase !== 'self') {
          for (const o of others.slice(0, 3)) tries.push({ type: 'buy', stockId: o.id, pct: 5 + 5 * Math.floor(Math.random() * 4) });
        }
      }
      for (const t of tries) {
        const act = { ...t, pid, pinHash, now: Date.now() };
        try {
          const ok = t.type === 'buy' ? checkBuy(sim, pid, t.stockId, t.pct, act.now).ok : checkBet(sim, pid, t.stockId, t.kind, t.amount, act.now).ok;
          if (!ok) continue;
          sim = reduce(sim, act);
          await dispatch(act);
        } catch { /* skip */ }
      }
      if (!horse && phase === 'open' && diversifyStatus(sim, pid).met) {
        try {
          const act = { type: 'doneBuying', pid, pinHash, now: Date.now() };
          sim = reduce(sim, act);
          await dispatch(act);
        } catch { /* already done or closed */ }
      }
    }
  }

  async function lockAndResults() {
    await org('lockRound');
    const r = currentRound(state);
    for (const g of r.groups) await org('setPlaces', { groupId: g.id, order: shuffle(g.playerIds) });
  }

  return (
    <div className="sticky top-0 z-30 border-b border-amber/40 bg-surface/95 px-4 py-2 backdrop-blur">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center gap-2 text-xs">
        <span className="font-display text-sm font-extrabold">Practice <span className="text-amber">mode</span></span>
        <span className="text-dim">Made-up players, PIN {PIN}. Nothing here touches your real game.</span>
        <div className="flex w-full flex-wrap items-center gap-2">
          <button className="rounded-lg border border-pink px-2 py-1 text-pink" onClick={() => start('stocks')}>New practice: Stocks</button>
          <button className="rounded-lg border border-mint px-2 py-1 text-mint" onClick={() => start('horse')}>New practice: Horse betting</button>
          {hasGame && (
            <>
              <select className="rounded-lg border border-line bg-ink px-2 py-1" value={view} onChange={(e) => setView(e.target.value)} aria-label="View as">
                <option value="org">View as: Organizer</option>
                {state.playerOrder.map((id) => (
                  <option key={id} value={id}>View as: {state.players[id].name}</option>
                ))}
              </select>
              {state.status === 'active' && (
                <>
                  <button className="rounded-lg border border-line px-2 py-1" onClick={othersPlay}>Other players {horse ? 'bet' : 'buy'}</button>
                  <button className="rounded-lg border border-line px-2 py-1" onClick={lockAndResults}>Lock + random results</button>
                </>
              )}
            </>
          )}
          <a href="#/organizer" className="ml-auto rounded-lg border border-line px-2 py-1 text-dim">Back to real game</a>
        </div>
      </div>
    </div>
  );
}

function Inner() {
  const { state, ready } = useGame();
  const [view, setView] = useState('org');
  const [sess, setSess] = useState(null);
  useEffect(() => {
    let live = true;
    if (view === 'org') setSess(null);
    else hashPin(PIN, view).then((h) => live && setSess({ pid: view, pinHash: h }));
    return () => { live = false; };
  }, [view]);
  if (!ready) return null;
  const empty = state.playerOrder.length === 0;
  return (
    <>
      <div className="bg-amber px-3 py-1 text-center font-mono text-[11px] font-semibold text-ink">
        PRACTICE MODE: not the real tournament
      </div>
      <Bar view={view} setView={setView} />
      {empty ? (
        <div className="mx-auto max-w-md px-4 py-10">
          <div className="font-display text-2xl font-extrabold">Practice tournament</div>
          <p className="mt-2 text-sm text-muted">
            Pick a style above to start a practice tournament with eight made-up players. Use "View as" to switch between
            the organizer and any player, "Other players buy" to make the rest of the table trade, and "Lock + random results"
            to finish a match. Your real tournament is not touched.
          </p>
        </div>
      ) : view === 'org' ? (
        <OrganizerApp />
      ) : sess ? (
        <PlayerApp key={view} forcedSession={sess} />
      ) : null}
    </>
  );
}

export default function PracticeApp() {
  return (
    <GameProvider practice>
      <Inner />
    </GameProvider>
  );
}
