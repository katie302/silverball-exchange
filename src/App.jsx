import React, { useEffect, useState } from 'react';
import { db } from './firebase';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  writeBatch,
  runTransaction,
} from 'firebase/firestore';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLACEMENT_MODIFIERS = {
  4: { 1: 1.2, 2: 1.0, 3: 0.95, 4: 0.8 },
  3: { 1: 1.2, 2: 1.0, 3: 0.8 },
};

const MAX_PLAYERS = 50;
const MIN_ACTIVE_HOLDINGS = 2;
const MIN_BUY_PERCENT = 10;
const MAX_BUY_PERCENT = 35;
const SESSION_KEY = 'silverballSession'; // { playerId, pin } — this device only
const ORGANIZER_SESSION_KEY = 'silverballOrganizerPin'; // this device only

const uid = () =>
  (crypto && crypto.randomUUID) ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const fmt = (n) => Number(n || 0).toLocaleString('en-US');
const ordinal = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

const defaultMachine = (name, groupSize) => ({
  id: uid(),
  name,
  groupSize,
  pricePerPercent: 10,
  totalOwnedPercent: 0,
  resolved: false,
  placements: null,
  assignedPlayerIds: [],
  suggestedPlacements: {},
});

const defaultPlayer = (id, cash) => ({
  id,
  name: `Player ${id}`,
  cash,
  claimed: false,
  pin: null,
  portfolio: [],
});

// ---------------------------------------------------------------------------
// Firestore seeding — only the first client to arrive creates the defaults.
// ---------------------------------------------------------------------------

async function seedIfNeeded() {
  const configRef = doc(db, 'config', 'state');
  const iAmSeeder = await runTransaction(db, async (tx) => {
    const snap = await tx.get(configRef);
    if (snap.exists()) return false;
    tx.set(configRef, {
      currentRound: 1,
      sellingEnabled: false,
      startingCash: 2500,
      completed: false,
      marketEventMessage: null,
      organizerPin: null,
    });
    return true;
  });

  if (!iAmSeeder) return;

  const batch = writeBatch(db);
  for (let i = 1; i <= 16; i++) {
    batch.set(doc(db, 'players', String(i)), defaultPlayer(i, 2500));
  }
  batch.set(doc(db, 'rounds', '1'), {
    number: 1,
    isLastRound: false,
    bids: [],
    machines: [
      defaultMachine('Godzilla', 4),
      defaultMachine('Addams Family', 4),
      defaultMachine('Pulp Fiction', 3),
      defaultMachine('Jurassic Park', 4),
    ],
  });
  await batch.commit();
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function App() {
  const [config, setConfig] = useState(null);
  const [players, setPlayers] = useState([]);
  const [rounds, setRounds] = useState({});
  const [loading, setLoading] = useState(true);

  const [activeTab, setActiveTab] = useState('leaderboard');

  // ---- My login session (this device) ----
  const [myPlayerId, setMyPlayerId] = useState(null);
  const [sessionChecked, setSessionChecked] = useState(false);

  // ---- Organizer gate (this device) ----
  const [organizerUnlocked, setOrganizerUnlocked] = useState(false);

  // ---- Staged picks for resolving a machine, before "Confirm Results" ----
  const [pendingPlacements, setPendingPlacements] = useState({});

  useEffect(() => {
    seedIfNeeded();

    const unsubConfig = onSnapshot(doc(db, 'config', 'state'), (snap) => {
      setConfig(snap.exists() ? snap.data() : null);
      setLoading(false);
    });
    const unsubPlayers = onSnapshot(collection(db, 'players'), (snap) => {
      const list = snap.docs.map((d) => d.data()).sort((a, b) => a.id - b.id);
      setPlayers(list);
    });
    const unsubRounds = onSnapshot(collection(db, 'rounds'), (snap) => {
      const map = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        map[data.number] = data;
      });
      setRounds(map);
    });

    return () => {
      unsubConfig();
      unsubPlayers();
      unsubRounds();
    };
  }, []);

  // Restore this device's player session, and keep validating it against
  // live data — if the slot got unclaimed or the tournament reset, the pin
  // will no longer match and we log this device out automatically.
  useEffect(() => {
    if (players.length === 0) return;
    let raw = null;
    try {
      raw = localStorage.getItem(SESSION_KEY);
    } catch (e) {
      /* ignore */
    }
    if (!raw) {
      setSessionChecked(true);
      return;
    }
    try {
      const session = JSON.parse(raw);
      const player = players.find((p) => p.id === session.playerId);
      if (player && player.claimed && player.pin === session.pin) {
        setMyPlayerId(player.id);
      } else {
        localStorage.removeItem(SESSION_KEY);
        setMyPlayerId(null);
      }
    } catch (e) {
      localStorage.removeItem(SESSION_KEY);
    }
    setSessionChecked(true);
  }, [players]);

  // Restore this device's organizer unlock, revalidating against the live
  // organizer PIN (if the organizer changes it, this device re-locks).
  useEffect(() => {
    if (!config) return;
    if (!config.organizerPin) {
      setOrganizerUnlocked(true); // no PIN set yet = open
      return;
    }
    try {
      const saved = localStorage.getItem(ORGANIZER_SESSION_KEY);
      setOrganizerUnlocked(saved === config.organizerPin);
    } catch (e) {
      setOrganizerUnlocked(false);
    }
  }, [config]);

  if (loading || !config || !sessionChecked) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <p className="text-slate-400">Loading The Silverball Exchange…</p>
      </div>
    );
  }

  const currentRoundData = rounds[config.currentRound] || { number: config.currentRound, isLastRound: false, bids: [], machines: [] };
  const myPlayer = players.find((p) => p.id === myPlayerId) || null;

  // -------------------------------------------------------------------------
  // Pure helpers that need current players/round data
  // -------------------------------------------------------------------------

  const calculateNetWorth = (player) => {
    const portfolioValue = player.portfolio.filter((s) => s.status === 'Active').reduce((sum, s) => sum + s.value, 0);
    return player.cash + portfolioValue;
  };

  const getMaxBuyPercent = (machine, playerId) => {
    const remaining = 100 - machine.totalOwnedPercent;
    const othersStillNeeding = machine.assignedPlayerIds.filter((pid) => {
      if (pid === playerId) return false;
      const owner = players.find((p) => p.id === pid);
      const alreadyBought = owner?.portfolio.some((s) => s.machineId === machine.id && s.status === 'Active');
      return !alreadyBought;
    }).length;
    const reserved = othersStillNeeding * MIN_BUY_PERCENT;
    return Math.max(0, Math.min(MAX_BUY_PERCENT, remaining - reserved));
  };

  const getBidReserve = (round) => (round.isLastRound ? 10 : 20);

  const assignedPlayerIdsThisRound = new Set(currentRoundData.machines.flatMap((m) => m.assignedPlayerIds));

  // -------------------------------------------------------------------------
  // Login / claim actions
  // -------------------------------------------------------------------------

  const claimPlayer = async (playerId, name, pin) => {
    if (!name.trim()) return alert('Enter your name.');
    if (!pin || pin.length < 4) return alert('Pick a PIN of at least 4 digits.');
    await updateDoc(doc(db, 'players', String(playerId)), { name: name.trim(), pin, claimed: true });
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId, pin }));
    } catch (e) {}
    setMyPlayerId(playerId);
  };

  const loginAsPlayer = (playerId, pin) => {
    const player = players.find((p) => p.id === playerId);
    if (!player || player.pin !== pin) {
      alert('Wrong PIN for that player.');
      return;
    }
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ playerId, pin }));
    } catch (e) {}
    setMyPlayerId(playerId);
  };

  const logout = () => {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    setMyPlayerId(null);
  };

  const unclaimPlayer = async (playerId) => {
    await updateDoc(doc(db, 'players', String(playerId)), { claimed: false, pin: null });
  };

  const renamePlayer = async (playerId, name) => {
    await updateDoc(doc(db, 'players', String(playerId)), { name });
  };

  // -------------------------------------------------------------------------
  // Organizer gate actions
  // -------------------------------------------------------------------------

  const setOrganizerPin = async (pin) => {
    await updateDoc(doc(db, 'config', 'state'), { organizerPin: pin || null });
    try {
      if (pin) localStorage.setItem(ORGANIZER_SESSION_KEY, pin);
      else localStorage.removeItem(ORGANIZER_SESSION_KEY);
    } catch (e) {}
    setOrganizerUnlocked(true);
  };

  const unlockOrganizer = (pin) => {
    if (pin === config.organizerPin) {
      try {
        localStorage.setItem(ORGANIZER_SESSION_KEY, pin);
      } catch (e) {}
      setOrganizerUnlocked(true);
    } else {
      alert('Wrong organizer PIN.');
    }
  };

  // -------------------------------------------------------------------------
  // Organizer: roster / cash
  // -------------------------------------------------------------------------

  const setPlayerCount = async (count) => {
    const target = Math.max(1, Math.min(MAX_PLAYERS, count));
    const batch = writeBatch(db);
    if (target > players.length) {
      for (let i = players.length + 1; i <= target; i++) {
        batch.set(doc(db, 'players', String(i)), defaultPlayer(i, config.startingCash));
      }
    } else if (target < players.length) {
      for (let i = target + 1; i <= players.length; i++) {
        batch.delete(doc(db, 'players', String(i)));
      }
    }
    await batch.commit();
  };

  const applyStartingCash = async (amount) => {
    const cash = Math.max(0, Number(amount) || 0);
    const batch = writeBatch(db);
    batch.update(doc(db, 'config', 'state'), { startingCash: cash });
    players.forEach((p) => batch.update(doc(db, 'players', String(p.id)), { cash }));
    await batch.commit();
  };

  // -------------------------------------------------------------------------
  // Organizer: machines
  // -------------------------------------------------------------------------

  const addMachineToCurrentRound = async (name, groupSize) => {
    if (!name.trim()) return;
    const machine = defaultMachine(name.trim(), Number(groupSize));
    await updateDoc(doc(db, 'rounds', String(config.currentRound)), {
      machines: [...currentRoundData.machines, machine],
    });
  };

  const deleteMachine = async (machineId) => {
    const machine = currentRoundData.machines.find((m) => m.id === machineId);
    if (!machine) return;
    const affected = players.filter((p) => p.portfolio.some((s) => s.machineId === machineId && s.status === 'Active'));
    if (
      affected.length > 0 &&
      !window.confirm(`${machine.name} has active stock owned by players. Deleting it will refund their purchase cost. Continue?`)
    ) {
      return;
    }

    const batch = writeBatch(db);
    affected.forEach((player) => {
      const owned = player.portfolio.filter((s) => s.machineId === machineId && s.status === 'Active');
      const refund = owned.reduce((sum, s) => sum + s.cost, 0);
      batch.update(doc(db, 'players', String(player.id)), {
        cash: player.cash + refund,
        portfolio: player.portfolio.filter((s) => s.machineId !== machineId),
      });
    });
    batch.update(doc(db, 'rounds', String(config.currentRound)), {
      machines: currentRoundData.machines.filter((m) => m.id !== machineId),
    });
    await batch.commit();
  };

  const assignPlayerToMachine = async (machineId, playerId) => {
    if (!playerId) return;
    const machines = currentRoundData.machines.map((m) => {
      if (m.id !== machineId) return m;
      if (m.assignedPlayerIds.length >= m.groupSize) return m;
      if (m.assignedPlayerIds.includes(Number(playerId))) return m;
      return { ...m, assignedPlayerIds: [...m.assignedPlayerIds, Number(playerId)] };
    });
    await updateDoc(doc(db, 'rounds', String(config.currentRound)), { machines });
  };

  const unassignPlayerFromMachine = async (machineId, playerId) => {
    const machines = currentRoundData.machines.map((m) =>
      m.id === machineId ? { ...m, assignedPlayerIds: m.assignedPlayerIds.filter((id) => id !== playerId) } : m
    );
    await updateDoc(doc(db, 'rounds', String(config.currentRound)), { machines });
  };

  // -------------------------------------------------------------------------
  // Buy / sell (players)
  // -------------------------------------------------------------------------

  const buyStock = async (playerId, machine, percentage) => {
    const pct = Number(percentage);
    if (!pct || pct < MIN_BUY_PERCENT || pct > MAX_BUY_PERCENT) {
      alert(`Buy-in must be between ${MIN_BUY_PERCENT}% and ${MAX_BUY_PERCENT}%!`);
      return;
    }
    try {
      await runTransaction(db, async (tx) => {
        const roundRef = doc(db, 'rounds', String(config.currentRound));
        const roundSnap = await tx.get(roundRef);
        const round = roundSnap.data();
        const liveMachine = round.machines.find((m) => m.id === machine.id);
        if (!liveMachine) throw new Error('Machine no longer exists.');
        if (liveMachine.resolved) throw new Error('This machine has already been resolved.');
        if (!liveMachine.assignedPlayerIds.includes(playerId)) {
          throw new Error("You're not assigned to this machine.");
        }

        const playerRef = doc(db, 'players', String(playerId));
        const playerSnap = await tx.get(playerRef);
        const player = playerSnap.data();
        const alreadyOwns = player.portfolio.some((s) => s.machineId === machine.id && s.status === 'Active');
        if (alreadyOwns) throw new Error('You already bought stock in this machine.');

        // Reserve 10% for every other assigned player who hasn't bought yet.
        let othersStillNeeding = 0;
        for (const pid of liveMachine.assignedPlayerIds) {
          if (pid === playerId) continue;
          const otherSnap = await tx.get(doc(db, 'players', String(pid)));
          const other = otherSnap.data();
          const otherBought = other?.portfolio.some((s) => s.machineId === machine.id && s.status === 'Active');
          if (!otherBought) othersStillNeeding += 1;
        }
        const remaining = 100 - liveMachine.totalOwnedPercent;
        const maxAllowed = Math.max(0, Math.min(MAX_BUY_PERCENT, remaining - othersStillNeeding * MIN_BUY_PERCENT));
        if (pct > maxAllowed) {
          throw new Error(
            `Only ${maxAllowed}% is available to you right now — the rest is held back for other players' minimums.`
          );
        }

        const cost = pct * liveMachine.pricePerPercent;
        if (player.cash < cost) throw new Error('Not enough Pin-Bucks!');

        const newStock = {
          id: uid(),
          round: config.currentRound,
          machineId: machine.id,
          machineName: machine.name,
          groupSize: machine.groupSize,
          percentage: pct,
          cost,
          value: cost,
          status: 'Active',
        };

        tx.update(playerRef, { cash: player.cash - cost, portfolio: [...player.portfolio, newStock] });
        tx.update(roundRef, {
          machines: round.machines.map((m) => (m.id === machine.id ? { ...m, totalOwnedPercent: m.totalOwnedPercent + pct } : m)),
        });
      });
    } catch (e) {
      alert(e.message || 'Could not complete the purchase.');
    }
  };

  const sellStock = async (playerId, stockId) => {
    try {
      await runTransaction(db, async (tx) => {
        const configRef = doc(db, 'config', 'state');
        const configSnap = await tx.get(configRef);
        const liveConfig = configSnap.data();
        if (liveConfig.completed) throw new Error('This tournament is complete — selling is locked.');
        if (!liveConfig.sellingEnabled) throw new Error('Selling is currently closed.');

        const playerRef = doc(db, 'players', String(playerId));
        const playerSnap = await tx.get(playerRef);
        const player = playerSnap.data();
        const stock = player.portfolio.find((s) => s.id === stockId);
        if (!stock || stock.status !== 'Active') throw new Error('That stock is not available to sell.');

        const activeCount = player.portfolio.filter((s) => s.status === 'Active').length;
        if (activeCount <= MIN_ACTIVE_HOLDINGS) {
          throw new Error(`You must keep stock in at least ${MIN_ACTIVE_HOLDINGS} machines.`);
        }

        tx.update(playerRef, {
          cash: player.cash + stock.value,
          portfolio: player.portfolio.map((s) => (s.id === stockId ? { ...s, status: 'Sold' } : s)),
        });
      });
    } catch (e) {
      alert(e.message || 'Could not sell that stock.');
    }
  };

  const toggleSelling = async () => {
    if (config.completed) return alert('This tournament is complete.');
    await updateDoc(doc(db, 'config', 'state'), { sellingEnabled: !config.sellingEnabled });
  };

  // -------------------------------------------------------------------------
  // Priority bidding
  // -------------------------------------------------------------------------

  const toggleLastRound = async () => {
    await updateDoc(doc(db, 'rounds', String(config.currentRound)), { isLastRound: !currentRoundData.isLastRound });
  };

  const placeBid = async (playerId, amountRaw) => {
    const amount = Math.floor(Number(amountRaw));
    if (!amount || amount < 1) return alert('Bid must be at least $1.');

    try {
      await runTransaction(db, async (tx) => {
        const roundRef = doc(db, 'rounds', String(config.currentRound));
        const roundSnap = await tx.get(roundRef);
        const round = roundSnap.data();

        const playerRef = doc(db, 'players', String(playerId));
        const playerSnap = await tx.get(playerRef);
        const player = playerSnap.data();

        const reserve = round.isLastRound ? 10 : 20;
        const existingBid = round.bids.find((b) => b.playerId === playerId);
        if (existingBid) {
          throw new Error('Your bid is already placed and locked in for this round — no changes allowed.');
        }
        const maxBid = player.cash - reserve;
        if (amount > maxBid) {
          throw new Error(`You must keep at least $${reserve} — your max bid right now is $${Math.max(maxBid, 0)}.`);
        }
        const taken = amount !== 1 && round.bids.some((b) => b.amount === amount && b.playerId !== playerId);
        if (taken) {
          throw new Error(`$${amount} is already taken this round. Try a different amount (only $1 can repeat).`);
        }

        const seq = Date.now();
        tx.update(playerRef, { cash: player.cash - amount });
        tx.update(roundRef, { bids: [...round.bids, { playerId, amount, seq }] });
      });
    } catch (e) {
      alert(e.message || 'Could not place that bid.');
    }
  };

  // Organizer-only: voids a bid and refunds it. Players can no longer
  // withdraw their own bid — once placed, it's locked in for the round.
  const withdrawBid = async (playerId) => {
    try {
      await runTransaction(db, async (tx) => {
        const roundRef = doc(db, 'rounds', String(config.currentRound));
        const roundSnap = await tx.get(roundRef);
        const round = roundSnap.data();
        const existingBid = round.bids.find((b) => b.playerId === playerId);
        if (!existingBid) return;

        const playerRef = doc(db, 'players', String(playerId));
        const playerSnap = await tx.get(playerRef);
        const player = playerSnap.data();

        tx.update(playerRef, { cash: player.cash + existingBid.amount });
        tx.update(roundRef, { bids: round.bids.filter((b) => b.playerId !== playerId) });
      });
    } catch (e) {
      alert(e.message || 'Could not withdraw the bid.');
    }
  };

  const rankedBids = [...currentRoundData.bids].sort((a, b) => b.amount - a.amount || a.seq - b.seq);

  // -------------------------------------------------------------------------
  // Player-suggested placements
  // -------------------------------------------------------------------------

  const suggestPlacement = async (machineId, playerId, placement) => {
    const machines = currentRoundData.machines.map((m) =>
      m.id === machineId
        ? { ...m, suggestedPlacements: { ...m.suggestedPlacements, [playerId]: Number(placement) } }
        : m
    );
    await updateDoc(doc(db, 'rounds', String(config.currentRound)), { machines });
  };

  // -------------------------------------------------------------------------
  // Resolve results (organizer) — staged picks before "Confirm Results"
  // -------------------------------------------------------------------------

  const setPendingPlacement = (machineId, playerId, placement) => {
    setPendingPlacements((prev) => ({
      ...prev,
      [machineId]: { ...(prev[machineId] || {}), [playerId]: Number(placement) },
    }));
  };

  const useSuggestions = (machine) => {
    setPendingPlacements((prev) => ({
      ...prev,
      [machine.id]: { ...(prev[machine.id] || {}), ...machine.suggestedPlacements },
    }));
  };

  const confirmMachineResult = async (machine) => {
    const assigned = machine.assignedPlayerIds;
    if (assigned.length !== machine.groupSize) {
      alert(`Assign all ${machine.groupSize} players to this machine before resolving it.`);
      return;
    }
    const picks = pendingPlacements[machine.id] || {};
    const chosen = assigned.map((pid) => picks[pid]);
    if (chosen.some((p) => !p)) return alert('Choose a placement for every assigned player.');
    const expected = Array.from({ length: assigned.length }, (_, i) => i + 1);
    if (JSON.stringify([...chosen].sort((a, b) => a - b)) !== JSON.stringify(expected)) {
      alert('Each placement (1st, 2nd, ...) can only be used once.');
      return;
    }

    const batch = writeBatch(db);
    assigned.forEach((pid) => {
      const placement = picks[pid];
      const modifier = PLACEMENT_MODIFIERS[machine.groupSize]?.[placement];
      const player = players.find((p) => p.id === pid);
      if (!player || modifier === undefined) return;
      const portfolio = player.portfolio.map((stock) =>
        stock.machineId === machine.id && stock.round === config.currentRound && stock.status === 'Active'
          ? { ...stock, value: Math.round(stock.value * modifier) }
          : stock
      );
      batch.update(doc(db, 'players', String(pid)), { portfolio });
    });
    batch.update(doc(db, 'rounds', String(config.currentRound)), {
      machines: currentRoundData.machines.map((m) => (m.id === machine.id ? { ...m, resolved: true, placements: picks } : m)),
    });
    await batch.commit();

    setPendingPlacements((prev) => {
      const next = { ...prev };
      delete next[machine.id];
      return next;
    });
  };

  // Reopens a resolved machine so the organizer can re-run Confirm Results
  // with corrected placements. This does NOT reverse the value change that
  // was already applied to affected stocks — fix those with the manual
  // player-correction tools below if needed.
  const unresolveMachine = async (machineId) => {
    if (
      !window.confirm(
        "Reopen this machine's result? It won't undo the value change already applied — use the player correction tool below if a stock's value needs fixing too."
      )
    )
      return;
    await updateDoc(doc(db, 'rounds', String(config.currentRound)), {
      machines: currentRoundData.machines.map((m) => (m.id === machineId ? { ...m, resolved: false, placements: null } : m)),
    });
  };

  // -------------------------------------------------------------------------
  // Manual corrections (organizer) — fix cash, edit/remove a stock holding
  // -------------------------------------------------------------------------

  const updatePlayerCash = async (playerId, cash) => {
    await updateDoc(doc(db, 'players', String(playerId)), { cash: Math.max(0, Number(cash) || 0) });
  };

  const updateStock = async (playerId, stockId, updates) => {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    const portfolio = player.portfolio.map((s) => (s.id === stockId ? { ...s, ...updates } : s));
    await updateDoc(doc(db, 'players', String(playerId)), { portfolio });
  };

  const deleteStock = async (playerId, stockId) => {
    if (!window.confirm('Remove this stock holding entirely? This does not refund or adjust cash automatically.')) return;
    const player = players.find((p) => p.id === playerId);
    if (!player) return;
    await updateDoc(doc(db, 'players', String(playerId)), {
      portfolio: player.portfolio.filter((s) => s.id !== stockId),
    });
  };

  // -------------------------------------------------------------------------
  // Manual value adjustment
  // -------------------------------------------------------------------------

  const applyPercentAdjustment = async (machineIds, pctRaw) => {
    const pct = Number(pctRaw);
    if (!pct) return alert('Enter a non-zero percentage.');
    if (machineIds.length === 0) return alert('Select at least one machine.');
    const modifier = 1 + pct / 100;
    const idSet = new Set(machineIds);
    const names = currentRoundData.machines.filter((m) => idSet.has(m.id)).map((m) => m.name).join(', ');

    const batch = writeBatch(db);
    players.forEach((player) => {
      const portfolio = player.portfolio.map((stock) =>
        idSet.has(stock.machineId) && stock.round === config.currentRound && stock.status === 'Active'
          ? { ...stock, value: Math.round(stock.value * modifier) }
          : stock
      );
      batch.update(doc(db, 'players', String(player.id)), { portfolio });
    });
    batch.update(doc(db, 'config', 'state'), { marketEventMessage: `${pct > 0 ? '+' : ''}${pct}% applied to: ${names}` });
    await batch.commit();
  };

  // -------------------------------------------------------------------------
  // Round / tournament lifecycle
  // -------------------------------------------------------------------------

  const advanceRound = async () => {
    const next = config.currentRound + 1;
    if (!rounds[next]) {
      await setDoc(doc(db, 'rounds', String(next)), { number: next, isLastRound: false, bids: [], machines: [] });
    }
    await updateDoc(doc(db, 'config', 'state'), { currentRound: next, marketEventMessage: null });
  };

  const completeTournament = async () => {
    if (
      !window.confirm(
        "Mark this tournament complete? This locks buying, selling, and round changes. Export your results first if you haven't."
      )
    )
      return;
    await updateDoc(doc(db, 'config', 'state'), { completed: true });
  };

  const reopenTournament = async () => {
    await updateDoc(doc(db, 'config', 'state'), { completed: false });
  };

  const resetTournament = async () => {
    if (
      !window.confirm(
        'This wipes every player, all cash and portfolios, and every round — starting a brand new tournament. This cannot be undone. Continue?'
      )
    )
      return;

    const [playerDocs, roundDocs] = await Promise.all([getDocs(collection(db, 'players')), getDocs(collection(db, 'rounds'))]);
    const batch = writeBatch(db);
    playerDocs.forEach((d) => batch.delete(d.ref));
    roundDocs.forEach((d) => batch.delete(d.ref));
    for (let i = 1; i <= 16; i++) {
      batch.set(doc(db, 'players', String(i)), defaultPlayer(i, 2500));
    }
    batch.set(doc(db, 'rounds', '1'), {
      number: 1,
      isLastRound: false,
      bids: [],
      machines: [
        defaultMachine('Godzilla', 4),
        defaultMachine('Addams Family', 4),
        defaultMachine('Pulp Fiction', 3),
        defaultMachine('Jurassic Park', 4),
      ],
    });
    batch.set(doc(db, 'config', 'state'), {
      currentRound: 1,
      sellingEnabled: false,
      startingCash: 2500,
      completed: false,
      marketEventMessage: null,
      organizerPin: config.organizerPin, // keep the organizer PIN across resets
    });
    await batch.commit();
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
    setMyPlayerId(null);
    setActiveTab('leaderboard');
  };

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  const downloadFile = (filename, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportLeaderboardCSV = () => {
    const rows = [['Rank', 'Player', 'Cash', 'Portfolio Value', 'Net Worth']];
    [...players]
      .sort((a, b) => calculateNetWorth(b) - calculateNetWorth(a))
      .forEach((p, i) => {
        const portfolioVal = p.portfolio.filter((s) => s.status === 'Active').reduce((sum, s) => sum + s.value, 0);
        rows.push([i + 1, p.name, p.cash, portfolioVal, calculateNetWorth(p)]);
      });
    const csv = rows.map((r) => r.map((v) => (typeof v === 'string' && v.includes(',') ? `"${v}"` : v)).join(',')).join('\n');
    downloadFile('silverball-exchange-leaderboard.csv', csv, 'text/csv');
  };

  const exportFullDataJSON = () => {
    const payload = { exportedAt: new Date().toISOString(), config, players, rounds };
    downloadFile('silverball-exchange-full-data.json', JSON.stringify(payload, null, 2), 'application/json');
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-4 md:p-8">
      <header className="flex flex-col md:flex-row justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-amber-400">🕹️ The Silverball Exchange</h1>
          <p className="text-sm text-slate-400">Pinball Tournament Live Trading Terminal & Dashboard</p>
        </div>
        <div className="flex gap-2 mt-4 md:mt-0">
          {['leaderboard', 'playerView', 'organizer'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2 rounded-lg font-bold text-sm transition ${
                activeTab === tab ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tab === 'leaderboard' ? '📊 Leaderboard' : tab === 'playerView' ? '📱 Player View' : '⚙️ Organizer'}
            </button>
          ))}
        </div>
      </header>

      {config.completed && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 mb-6 text-center">
          <span className="text-emerald-300 font-bold">🏁 Tournament Complete — final standings below</span>
        </div>
      )}

      <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <span className="text-xs uppercase tracking-wider text-amber-400 font-bold">Round Status</span>
          <p className="text-lg font-semibold">
            {currentRoundData.machines.length === 0
              ? 'No machines added for this round yet.'
              : `${currentRoundData.machines.filter((m) => !m.resolved).length} open, ${
                  currentRoundData.machines.filter((m) => m.resolved).length
                } resolved`}
          </p>
          {config.marketEventMessage && <p className="text-sm text-blue-300 mt-1">{config.marketEventMessage}</p>}
        </div>
        <span className="bg-slate-900 px-3 py-1.5 rounded-lg border border-slate-700 text-sm font-bold text-amber-300">
          Round {config.currentRound}
          {currentRoundData.isLastRound ? ' · Last Round' : ''}
        </span>
      </div>

      {activeTab === 'leaderboard' && (
        <Leaderboard players={players} calculateNetWorth={calculateNetWorth} fmt={fmt} />
      )}

      {activeTab === 'playerView' &&
        (myPlayer ? (
          <PlayerView
            player={myPlayer}
            players={players}
            config={config}
            round={currentRoundData}
            fmt={fmt}
            ordinal={ordinal}
            calculateNetWorth={calculateNetWorth}
            getMaxBuyPercent={getMaxBuyPercent}
            getBidReserve={getBidReserve}
            buyStock={buyStock}
            sellStock={sellStock}
            placeBid={placeBid}
            suggestPlacement={suggestPlacement}
            logout={logout}
          />
        ) : (
          <LoginScreen players={players} claimPlayer={claimPlayer} loginAsPlayer={loginAsPlayer} />
        ))}

      {activeTab === 'organizer' &&
        (organizerUnlocked ? (
          <OrganizerConsole
            config={config}
            players={players}
            round={currentRoundData}
            rounds={rounds}
            fmt={fmt}
            ordinal={ordinal}
            rankedBids={rankedBids}
            getBidReserve={getBidReserve}
            withdrawBid={withdrawBid}
            pendingPlacements={pendingPlacements}
            setPendingPlacement={setPendingPlacement}
            useSuggestions={useSuggestions}
            confirmMachineResult={confirmMachineResult}
            unresolveMachine={unresolveMachine}
            addMachineToCurrentRound={addMachineToCurrentRound}
            deleteMachine={deleteMachine}
            assignPlayerToMachine={assignPlayerToMachine}
            unassignPlayerFromMachine={unassignPlayerFromMachine}
            assignedPlayerIdsThisRound={assignedPlayerIdsThisRound}
            applyPercentAdjustment={applyPercentAdjustment}
            toggleSelling={toggleSelling}
            toggleLastRound={toggleLastRound}
            advanceRound={advanceRound}
            setPlayerCount={setPlayerCount}
            applyStartingCash={applyStartingCash}
            renamePlayer={renamePlayer}
            unclaimPlayer={unclaimPlayer}
            completeTournament={completeTournament}
            reopenTournament={reopenTournament}
            resetTournament={resetTournament}
            exportLeaderboardCSV={exportLeaderboardCSV}
            exportFullDataJSON={exportFullDataJSON}
            setOrganizerPin={setOrganizerPin}
            updatePlayerCash={updatePlayerCash}
            updateStock={updateStock}
            deleteStock={deleteStock}
          />
        ) : (
          <OrganizerGate hasPin={!!config.organizerPin} unlockOrganizer={unlockOrganizer} setOrganizerPin={setOrganizerPin} />
        ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

function Leaderboard({ players, calculateNetWorth, fmt }) {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
      <div className="p-4 bg-slate-800/60 border-b border-slate-700 font-bold text-lg text-amber-400">🏆 Live Net Worth Standings</div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-900/50 text-slate-400 text-xs uppercase tracking-wider border-b border-slate-700">
              <th className="p-3">Rank</th>
              <th className="p-3">Broker / Player</th>
              <th className="p-3">Cash Wallet</th>
              <th className="p-3">Portfolio Value</th>
              <th className="p-3 text-right">Total Net Worth</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700/50">
            {[...players]
              .sort((a, b) => calculateNetWorth(b) - calculateNetWorth(a))
              .map((player, index) => {
                const netWorth = calculateNetWorth(player);
                const portfolioVal = player.portfolio.filter((s) => s.status === 'Active').reduce((sum, s) => sum + s.value, 0);
                return (
                  <tr key={player.id} className="hover:bg-slate-700/40 transition">
                    <td className="p-3 font-bold text-amber-400">#{index + 1}</td>
                    <td className="p-3 font-semibold">{player.name}</td>
                    <td className="p-3 text-slate-300">${fmt(player.cash)}</td>
                    <td className="p-3 text-emerald-400">${fmt(portfolioVal)}</td>
                    <td className="p-3 text-right font-extrabold text-amber-300">${fmt(netWorth)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login / claim screen
// ---------------------------------------------------------------------------

function LoginScreen({ players, claimPlayer, loginAsPlayer }) {
  const [openId, setOpenId] = useState(null);
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');

  return (
    <div className="max-w-md mx-auto space-y-4 bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-2xl">
      <h2 className="text-lg font-bold text-amber-400">👋 Who are you?</h2>
      <p className="text-xs text-slate-400">
        Tap your name if you've already claimed a slot (you'll need your PIN), or claim an open one below.
      </p>
      <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
        {players.map((p) => (
          <div key={p.id} className="bg-slate-900 border border-slate-700 rounded-lg p-3">
            <div className="flex justify-between items-center">
              <span className="font-semibold text-sm">
                {p.claimed ? p.name : `Player ${p.id}`}
                {!p.claimed && <span className="text-xs text-slate-500 ml-2">(unclaimed)</span>}
              </span>
              <button
                onClick={() => setOpenId(openId === p.id ? null : p.id)}
                className="text-xs bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-3 py-1 rounded"
              >
                {p.claimed ? 'Log In' : 'Claim'}
              </button>
            </div>
            {openId === p.id && (
              <div className="mt-2 space-y-2">
                {!p.claimed && (
                  <input
                    type="text"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
                  />
                )}
                <input
                  type="password"
                  inputMode="numeric"
                  placeholder={p.claimed ? 'Enter your PIN' : 'Set a PIN (4+ digits)'}
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
                />
                <button
                  onClick={() => {
                    if (p.claimed) {
                      loginAsPlayer(p.id, pin);
                    } else {
                      claimPlayer(p.id, name, pin);
                    }
                    setPin('');
                    setName('');
                    setOpenId(null);
                  }}
                  className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded"
                >
                  {p.claimed ? 'Log In' : 'Claim This Account'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Organizer PIN gate
// ---------------------------------------------------------------------------

function OrganizerGate({ hasPin, unlockOrganizer, setOrganizerPin }) {
  const [pin, setPin] = useState('');

  return (
    <div className="max-w-sm mx-auto space-y-3 bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-2xl text-center">
      <h2 className="text-lg font-bold text-amber-400">⚙️ Organizer Access</h2>
      {hasPin ? (
        <>
          <p className="text-xs text-slate-400">Enter the organizer PIN to unlock this device.</p>
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-center"
          />
          <button
            onClick={() => unlockOrganizer(pin)}
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded"
          >
            Unlock
          </button>
        </>
      ) : (
        <>
          <p className="text-xs text-slate-400">No organizer PIN is set yet. Set one to protect this console, or skip.</p>
          <input
            type="password"
            inputMode="numeric"
            placeholder="Set a PIN (4+ digits)"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm text-center"
          />
          <button
            onClick={() => setOrganizerPin(pin)}
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold py-2 rounded"
          >
            Set PIN &amp; Unlock
          </button>
          <button onClick={() => setOrganizerPin(null)} className="w-full text-xs text-slate-500 underline">
            Skip for now (leave Organizer open)
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Player View
// ---------------------------------------------------------------------------

function PlayerView({
  player,
  players,
  config,
  round,
  fmt,
  ordinal,
  calculateNetWorth,
  getMaxBuyPercent,
  getBidReserve,
  buyStock,
  sellStock,
  placeBid,
  suggestPlacement,
  logout,
}) {
  const [buyAmount, setBuyAmount] = useState({});
  const [bidInput, setBidInput] = useState('');

  const myBid = round.bids.find((b) => b.playerId === player.id);
  const reserve = getBidReserve(round);
  const maxBid = player.cash - reserve;

  return (
    <div className="max-w-md mx-auto space-y-6 bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-2xl">
      <div className="flex justify-between items-center border-b border-slate-700 pb-4">
        <div>
          <span className="text-xs text-slate-400 block">Logged in as</span>
          <span className="text-lg font-bold text-amber-400">{player.name}</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-slate-400 block">Net Worth</span>
          <span className="text-xl font-black text-amber-400">${fmt(calculateNetWorth(player))}</span>
        </div>
      </div>
      <button onClick={logout} className="text-xs text-slate-500 underline">
        Not you? Log out
      </button>

      <div className="grid grid-cols-2 gap-4 bg-slate-900 p-4 rounded-xl border border-slate-700 text-center">
        <div>
          <span className="text-xs text-slate-400 block">Cash Wallet</span>
          <span className="text-lg font-bold text-emerald-400">${fmt(player.cash)}</span>
        </div>
        <div>
          <span className="text-xs text-slate-400 block">Active Holdings</span>
          <span className="text-lg font-bold text-blue-400">{player.portfolio.filter((s) => s.status === 'Active').length} Stocks</span>
        </div>
      </div>

      <div className="space-y-2 bg-slate-900 p-4 rounded-xl border border-slate-700">
        <h3 className="font-bold text-sm text-amber-400">
          🎯 Priority Bid — Round {config.currentRound}
          {round.isLastRound && <span className="text-amber-300"> (Last Round)</span>}
        </h3>
        {myBid ? (
          <p className="text-sm">
            Your bid: <span className="font-bold text-emerald-400">${fmt(myBid.amount)}</span>{' '}
            <span className="text-xs text-slate-500">— locked in, no changes.</span>
          </p>
        ) : (
          <>
            <p className="text-xs text-slate-400">
              Min $1, must keep at least ${reserve}. Your max right now: ${Math.max(maxBid, 0)}. Bids lock the
              moment you place them — no changing your mind after.
            </p>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                placeholder="Bid amount"
                value={bidInput}
                onChange={(e) => setBidInput(e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
              />
              <button
                onClick={() => {
                  placeBid(player.id, bidInput);
                  setBidInput('');
                }}
                className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded transition"
              >
                Place Bid
              </button>
            </div>
          </>
        )}
      </div>

      <div className="space-y-3 bg-slate-900 p-4 rounded-xl border border-slate-700">
        <h3 className="font-bold text-sm text-amber-400">📈 Round {config.currentRound} Machines (1% = $10)</h3>
        {round.machines.length === 0 && <p className="text-sm text-slate-500 italic">No machines open for this round yet.</p>}
        {round.machines.map((machine) => {
          const remaining = 100 - machine.totalOwnedPercent;
          const myMax = getMaxBuyPercent(machine, player.id);
          const isAssigned = machine.assignedPlayerIds.includes(player.id);
          const mySuggestion = machine.suggestedPlacements?.[player.id];
          const placementOptions = machine.groupSize === 4 ? [1, 2, 3, 4] : [1, 2, 3];
          return (
            <div key={machine.id} className="bg-slate-800 p-2.5 rounded-lg border border-slate-700 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium text-sm">
                  {machine.name} <span className="text-xs text-slate-400">({machine.groupSize}-way)</span>
                </span>
                {machine.resolved ? (
                  <span className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded font-bold">Resolved</span>
                ) : (
                  <span className="text-xs text-slate-400">{remaining}% left overall</span>
                )}
              </div>

              {machine.resolved && machine.placements && (
                <p className="text-xs text-slate-400">
                  Result:{' '}
                  {machine.assignedPlayerIds
                    .map((pid) => {
                      const p = players.find((pl) => pl.id === pid);
                      return `${p ? p.name : `Player ${pid}`} (${ordinal(machine.placements[pid])})`;
                    })
                    .join(', ')}
                </p>
              )}

              {machine.assignedPlayerIds.length > 0 && (
                <p className="text-xs text-slate-400">
                  Playing: {machine.assignedPlayerIds.map((pid) => players.find((p) => p.id === pid)?.name || `Player ${pid}`).join(', ')}
                </p>
              )}

              {!machine.resolved && isAssigned ? (
                player.portfolio.some((s) => s.machineId === machine.id && s.status === 'Active') ? (
                  <p className="text-xs text-slate-500 italic">Already bought in — one purchase per machine.</p>
                ) : (
                  <div className="flex gap-2 items-center">
                    <input
                      type="number"
                      min={MAX_BUY_PERCENT_MIN}
                      max={myMax}
                      placeholder={`10-${myMax}%`}
                      value={buyAmount[machine.id] || ''}
                      onChange={(e) => setBuyAmount((prev) => ({ ...prev, [machine.id]: e.target.value }))}
                      className="w-20 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                    />
                    <button
                      onClick={() => buyStock(player.id, machine, buyAmount[machine.id])}
                      className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded transition"
                    >
                      Buy (max {myMax}%)
                    </button>
                  </div>
                )
              ) : (
                !machine.resolved && <p className="text-xs text-slate-500 italic">You're not assigned to this machine.</p>
              )}

              {!machine.resolved && isAssigned && (
                <div className="flex justify-between items-center pt-1 border-t border-slate-700">
                  <span className="text-xs text-slate-400">
                    {mySuggestion ? `You suggested: ${ordinal(mySuggestion)}` : 'What place did you get?'}
                  </span>
                  <select
                    value={mySuggestion || ''}
                    onChange={(e) => suggestPlacement(machine.id, player.id, e.target.value)}
                    className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-xs"
                  >
                    <option value="">Suggest…</option>
                    {placementOptions.map((place) => (
                      <option key={place} value={place}>
                        {ordinal(place)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-sm text-amber-400">💼 Your Brokerage Portfolio</h3>
          <span
            className={`text-xs px-2 py-1 rounded font-bold border ${
              config.sellingEnabled ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' : 'bg-slate-800 text-slate-500 border-slate-700'
            }`}
          >
            {config.sellingEnabled ? 'Trading Open' : 'Trading Closed'}
          </span>
        </div>
        {player.portfolio.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No stocks purchased yet.</p>
        ) : (
          player.portfolio.map((stock) => {
            const activeCount = player.portfolio.filter((s) => s.status === 'Active').length;
            const canSell = config.sellingEnabled && activeCount > MIN_ACTIVE_HOLDINGS_VAL;
            return (
              <div key={stock.id} className="bg-slate-900 p-3 rounded-xl border border-slate-700 flex justify-between items-center text-sm">
                <div>
                  <p className="font-bold">
                    {stock.machineName} <span className="text-xs text-amber-400">({stock.percentage}%)</span>{' '}
                    <span className="text-xs text-slate-500">R{stock.round}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    Value: <span className="text-emerald-400 font-semibold">${fmt(stock.value)}</span> | Cost: ${fmt(stock.cost)}
                  </p>
                </div>
                {stock.status === 'Active' ? (
                  canSell ? (
                    <button
                      onClick={() => sellStock(player.id, stock.id)}
                      className="bg-red-500 hover:bg-red-400 text-white font-bold text-xs px-3 py-1 rounded transition"
                    >
                      Sell
                    </button>
                  ) : (
                    <span className="text-xs bg-slate-800 text-slate-500 px-2 py-1 rounded font-bold border border-slate-700">
                      {config.sellingEnabled ? `Min ${MIN_ACTIVE_HOLDINGS_VAL} required` : 'Trading closed'}
                    </span>
                  )
                ) : (
                  <span className="text-xs bg-slate-800 text-slate-500 px-2 py-1 rounded font-bold">Sold</span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

const MAX_BUY_PERCENT_MIN = 10;
const MIN_ACTIVE_HOLDINGS_VAL = 2;

// ---------------------------------------------------------------------------
// Organizer Console
// ---------------------------------------------------------------------------

function OrganizerConsole(props) {
  const {
    config,
    players,
    round,
    fmt,
    ordinal,
    rankedBids,
    getBidReserve,
    withdrawBid,
    pendingPlacements,
    setPendingPlacement,
    useSuggestions,
    confirmMachineResult,
    unresolveMachine,
    addMachineToCurrentRound,
    deleteMachine,
    assignPlayerToMachine,
    unassignPlayerFromMachine,
    assignedPlayerIdsThisRound,
    applyPercentAdjustment,
    toggleSelling,
    toggleLastRound,
    advanceRound,
    setPlayerCount,
    applyStartingCash,
    renamePlayer,
    unclaimPlayer,
    completeTournament,
    reopenTournament,
    resetTournament,
    exportLeaderboardCSV,
    exportFullDataJSON,
    setOrganizerPin,
    updatePlayerCash,
    updateStock,
    deleteStock,
  } = props;

  const [startingCashInput, setStartingCashInput] = useState(config.startingCash);
  const [playerCountInput, setPlayerCountInput] = useState(players.length);
  const [newMachineName, setNewMachineName] = useState('');
  const [newMachineGroupSize, setNewMachineGroupSize] = useState(4);
  const [selectedAdjustMachineIds, setSelectedAdjustMachineIds] = useState([]);
  const [adjustPercent, setAdjustPercent] = useState('');
  const [newOrgPin, setNewOrgPin] = useState('');
  const [correctPlayerId, setCorrectPlayerId] = useState('');
  const [correctCashInput, setCorrectCashInput] = useState('');
  const [stockEdits, setStockEdits] = useState({}); // stockId -> { percentage, cost, value, status }

  const toggleAdjustMachine = (id) =>
    setSelectedAdjustMachineIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  return (
    <div className="max-w-2xl mx-auto space-y-6 bg-slate-800 p-6 rounded-2xl border border-slate-700 shadow-2xl">
      <h2 className="text-xl font-bold text-amber-400 border-b border-slate-700 pb-3">⚙️ Organizer Control Panel</h2>

      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-700">
        <div className="flex-1">
          <span className="font-bold block">Starting Cash / Net Worth</span>
          <span className="text-xs text-slate-400">Resets every player's wallet — use before Round 1</span>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min="0"
            value={startingCashInput}
            onChange={(e) => setStartingCashInput(e.target.value)}
            className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
          <button onClick={() => applyStartingCash(startingCashInput)} className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded transition">
            Set
          </button>
        </div>
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <h3 className="font-bold text-sm text-amber-400">👤 Player Names</h3>
        <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
          {players.map((p) => (
            <div key={p.id} className="flex items-center gap-2">
              <span className="text-xs text-slate-500 w-6 text-right">#{p.id}</span>
              <input
                type="text"
                value={p.name}
                onChange={(e) => renamePlayer(p.id, e.target.value)}
                className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
              />
              {p.claimed ? (
                <button
                  onClick={() => unclaimPlayer(p.id)}
                  className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2 py-1 rounded font-bold whitespace-nowrap"
                  title="Click to free up this slot"
                >
                  Claimed
                </button>
              ) : (
                <span className="text-xs bg-slate-800 text-slate-500 border border-slate-700 px-2 py-1 rounded font-bold whitespace-nowrap">
                  Unclaimed
                </span>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-700">
        <div className="flex-1">
          <span className="font-bold block">Number of Players</span>
          <span className="text-xs text-slate-400">Currently {players.length} (max {MAX_PLAYERS_VAL})</span>
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            min="1"
            max={MAX_PLAYERS_VAL}
            value={playerCountInput}
            onChange={(e) => setPlayerCountInput(e.target.value)}
            className="w-20 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
          <button onClick={() => setPlayerCount(Number(playerCountInput))} className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded transition">
            Set
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-700">
        <div>
          <span className="font-bold block">Organizer PIN</span>
          <span className="text-xs text-slate-400">{config.organizerPin ? 'A PIN is set for this console.' : 'No PIN set — open to anyone with the link.'}</span>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            inputMode="numeric"
            placeholder="New PIN"
            value={newOrgPin}
            onChange={(e) => setNewOrgPin(e.target.value)}
            className="w-24 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
          <button onClick={() => setOrganizerPin(newOrgPin)} className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded transition">
            Set
          </button>
        </div>
      </div>

      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-700">
        <div>
          <span className="font-bold block">Trading Window</span>
          <span className="text-xs text-slate-400">
            {config.sellingEnabled ? 'Players can sell active stock right now.' : 'Selling is closed for all players.'} Every player keeps at least 2 machines.
          </span>
        </div>
        <button
          onClick={toggleSelling}
          className={`font-bold px-4 py-2 rounded-lg transition text-sm ${
            config.sellingEnabled ? 'bg-red-500 hover:bg-red-400 text-white' : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
          }`}
        >
          {config.sellingEnabled ? 'Close Selling' : 'Open Selling'}
        </button>
      </div>

      <div className="flex justify-between items-center bg-slate-900 p-4 rounded-xl border border-slate-700">
        <div>
          <span className="font-bold block">Advance Tournament Round</span>
          <span className="text-xs text-slate-400">Current Round: {config.currentRound}</span>
        </div>
        <button onClick={advanceRound} className="bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold px-4 py-2 rounded-lg transition text-sm">
          Advance to Round {config.currentRound + 1} ➔
        </button>
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <div className="flex justify-between items-center">
          <h3 className="font-bold text-sm text-amber-400">🎯 Priority Bidding — Round {config.currentRound}</h3>
          <button
            onClick={toggleLastRound}
            className={`text-xs font-bold px-3 py-1.5 rounded transition ${
              round.isLastRound ? 'bg-amber-500 text-slate-950' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            {round.isLastRound ? '★ Last Round' : 'Mark as Last Round'}
          </button>
        </div>
        <p className="text-xs text-slate-400">
          Min $1, everyone must keep at least ${getBidReserve(round)} left. Bids lock the moment a player places
          them — every dollar amount can only be used once, except $1 (ties broken by who bid first).
        </p>
        {rankedBids.length === 0 ? (
          <p className="text-sm text-slate-500 italic">No bids placed yet this round.</p>
        ) : (
          <div className="space-y-1.5">
            {rankedBids.map((bid, index) => {
              const p = players.find((pl) => pl.id === bid.playerId);
              const tie = bid.amount === 1 && rankedBids.filter((b) => b.amount === 1).length > 1;
              return (
                <div key={bid.playerId} className="flex justify-between items-center bg-slate-800 p-2 rounded-lg border border-slate-700 text-sm">
                  <span>
                    <span className="text-amber-400 font-bold">#{index + 1}</span> {p ? p.name : `Player ${bid.playerId}`}
                    {tie && <span className="text-xs text-slate-500"> (tied at $1 — ranked by order)</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="font-bold text-emerald-400">${fmt(bid.amount)}</span>
                    <button
                      onClick={() => withdrawBid(bid.playerId)}
                      className="text-xs text-red-400 hover:text-red-300 font-bold"
                      title="Void this bid and refund it (for correcting a mistake)"
                    >
                      Void
                    </button>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <h3 className="font-bold text-sm text-amber-400">➕ Add a Machine to Round {config.currentRound}</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Machine name"
            value={newMachineName}
            onChange={(e) => setNewMachineName(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
          <select value={newMachineGroupSize} onChange={(e) => setNewMachineGroupSize(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm">
            <option value={4}>4-player group</option>
            <option value={3}>3-player group</option>
          </select>
        </div>
        <button
          onClick={() => {
            addMachineToCurrentRound(newMachineName, newMachineGroupSize);
            setNewMachineName('');
          }}
          className="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded transition"
        >
          Add Machine
        </button>
        {round.machines.length > 0 && (
          <div className="space-y-1.5 pt-2 border-t border-slate-700">
            {round.machines.map((machine) => (
              <div key={machine.id} className="flex justify-between items-center bg-slate-800 p-2 rounded-lg border border-slate-700 text-sm">
                <span>
                  {machine.name} <span className="text-xs text-slate-400">({machine.groupSize}-way)</span>
                </span>
                <button onClick={() => deleteMachine(machine.id)} className="text-red-400 hover:text-red-300 font-bold text-xs px-2">
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <h3 className="font-bold text-sm text-amber-400">🎮 Assign Players to Round {config.currentRound} Machines</h3>
        {round.machines.length === 0 && <p className="text-sm text-slate-500 italic">No machines added yet.</p>}
        {round.machines.map((machine) => {
          const unassignedOptions = players.filter((p) => !assignedPlayerIdsThisRound.has(p.id));
          const full = machine.assignedPlayerIds.length >= machine.groupSize;
          return (
            <div key={machine.id} className="bg-slate-800 p-2.5 rounded-lg border border-slate-700 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium text-sm">
                  {machine.name}{' '}
                  <span className="text-xs text-slate-400">
                    ({machine.assignedPlayerIds.length}/{machine.groupSize} assigned)
                  </span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {machine.assignedPlayerIds.map((pid) => {
                  const p = players.find((pl) => pl.id === pid);
                  return (
                    <span key={pid} className="flex items-center gap-1 bg-blue-500/20 text-blue-300 border border-blue-500/30 text-xs px-2 py-1 rounded">
                      {p ? p.name : `Player ${pid}`}
                      <button onClick={() => unassignPlayerFromMachine(machine.id, pid)} className="text-blue-300 hover:text-white font-bold">
                        ×
                      </button>
                    </span>
                  );
                })}
              </div>
              {!full && (
                <select
                  value=""
                  onChange={(e) => assignPlayerToMachine(machine.id, e.target.value)}
                  className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm w-full"
                >
                  <option value="">+ Add player…</option>
                  {unassignedOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <h3 className="font-bold text-sm text-amber-400">📊 Apply Value Change (Round {config.currentRound})</h3>
        <p className="text-xs text-slate-400">Pick one or more machines and enter a percentage — applied once, only to this round's active stock in them.</p>
        <div className="space-y-1.5">
          {round.machines.map((machine) => (
            <label key={machine.id} className="flex items-center gap-2 bg-slate-800 p-2 rounded-lg border border-slate-700 text-sm cursor-pointer">
              <input type="checkbox" checked={selectedAdjustMachineIds.includes(machine.id)} onChange={() => toggleAdjustMachine(machine.id)} />
              {machine.name} <span className="text-xs text-slate-400">({machine.groupSize}-way)</span>
            </label>
          ))}
          {round.machines.length === 0 && <p className="text-sm text-slate-500 italic">No machines added yet.</p>}
        </div>
        <div className="flex gap-2">
          <input
            type="number"
            placeholder="% change (e.g. -20 or 10)"
            value={adjustPercent}
            onChange={(e) => setAdjustPercent(e.target.value)}
            className="flex-1 bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
          />
          <button
            onClick={() => {
              applyPercentAdjustment(selectedAdjustMachineIds, adjustPercent);
              setSelectedAdjustMachineIds([]);
              setAdjustPercent('');
            }}
            className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-4 py-1.5 rounded transition"
          >
            Apply
          </button>
        </div>
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <h3 className="font-bold text-sm text-amber-400">🎯 Resolve Round {config.currentRound} Machines</h3>
        <p className="text-xs text-slate-400">
          Pick each assigned player's own finishing place, then confirm — only that player's own stock in this machine moves: 1st +20%, 2nd 0%, 3rd −5% (4-way) or −20% (3-way), 4th −20%.
        </p>
        {round.machines.length === 0 && <p className="text-sm text-slate-500 italic">No machines added yet.</p>}
        {round.machines.map((machine) => {
          const placementOptions = machine.groupSize === 4 ? [1, 2, 3, 4] : [1, 2, 3];
          const picks = pendingPlacements[machine.id] || {};
          const fullyAssigned = machine.assignedPlayerIds.length === machine.groupSize;
          const hasSuggestions = machine.suggestedPlacements && Object.keys(machine.suggestedPlacements).length > 0;
          return (
            <div key={machine.id} className="bg-slate-800 p-2.5 rounded-lg border border-slate-700 space-y-2">
              <div className="flex justify-between items-center">
                <span className="font-medium text-sm">
                  {machine.name} <span className="text-xs text-slate-400">({machine.groupSize}-way)</span>
                </span>
                {machine.resolved && <span className="text-xs bg-slate-700 text-slate-400 px-2 py-1 rounded font-bold">Resolved</span>}
              </div>

              {machine.resolved ? (
                <>
                  <p className="text-xs text-slate-400">
                    {machine.assignedPlayerIds
                      .map((pid) => {
                        const p = players.find((pl) => pl.id === pid);
                        return `${p ? p.name : `Player ${pid}`}: ${ordinal(machine.placements[pid])}`;
                      })
                      .join(', ')}
                  </p>
                  <button
                    onClick={() => unresolveMachine(machine.id)}
                    className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded"
                  >
                    Reopen / Correct Result
                  </button>
                </>
              ) : !fullyAssigned ? (
                <p className="text-xs text-slate-500 italic">Assign all {machine.groupSize} players to this machine before resolving.</p>
              ) : (
                <>
                  {hasSuggestions && (
                    <button onClick={() => useSuggestions(machine)} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-2 py-1 rounded">
                      Use players' suggestions
                    </button>
                  )}
                  <div className="space-y-1.5">
                    {machine.assignedPlayerIds.map((pid) => {
                      const p = players.find((pl) => pl.id === pid);
                      const suggestion = machine.suggestedPlacements?.[pid];
                      return (
                        <div key={pid} className="flex justify-between items-center text-sm">
                          <span>
                            {p ? p.name : `Player ${pid}`}
                            {suggestion && <span className="text-xs text-slate-500"> (suggests: {ordinal(suggestion)})</span>}
                          </span>
                          <select
                            value={picks[pid] || ''}
                            onChange={(e) => setPendingPlacement(machine.id, pid, e.target.value)}
                            className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-sm"
                          >
                            <option value="">Place…</option>
                            {placementOptions.map((place) => (
                              <option key={place} value={place}>
                                {ordinal(place)}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={() => confirmMachineResult(machine)} className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-3 py-1.5 rounded transition">
                    Confirm Results
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <h3 className="font-bold text-sm text-amber-400">🛠️ Correct a Mistake</h3>
        <p className="text-xs text-slate-400">Fix a player's cash, or edit/remove one of their stock holdings — for when something got entered wrong.</p>
        <select
          value={correctPlayerId}
          onChange={(e) => {
            setCorrectPlayerId(e.target.value);
            setCorrectCashInput('');
            setStockEdits({});
          }}
          className="w-full bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-sm"
        >
          <option value="">Select a player…</option>
          {players.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        {correctPlayerId &&
          (() => {
            const player = players.find((p) => p.id === Number(correctPlayerId));
            if (!player) return null;
            return (
              <div className="space-y-3">
                <div className="flex gap-2 items-center">
                  <span className="text-xs text-slate-400 flex-1">Cash (currently ${fmt(player.cash)})</span>
                  <input
                    type="number"
                    placeholder={player.cash}
                    value={correctCashInput}
                    onChange={(e) => setCorrectCashInput(e.target.value)}
                    className="w-28 bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm"
                  />
                  <button
                    onClick={() => {
                      updatePlayerCash(player.id, correctCashInput || player.cash);
                      setCorrectCashInput('');
                    }}
                    className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3 py-1 rounded"
                  >
                    Save
                  </button>
                </div>

                {player.portfolio.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No stock holdings for this player.</p>
                ) : (
                  <div className="space-y-2">
                    {player.portfolio.map((stock) => {
                      const edit = stockEdits[stock.id] || {};
                      return (
                        <div key={stock.id} className="bg-slate-800 p-2.5 rounded-lg border border-slate-700 space-y-1.5">
                          <div className="flex justify-between items-center text-xs text-slate-400">
                            <span>
                              {stock.machineName} (R{stock.round})
                            </span>
                            <button onClick={() => deleteStock(player.id, stock.id)} className="text-red-400 hover:text-red-300 font-bold">
                              Delete
                            </button>
                          </div>
                          <div className="flex gap-1.5 items-center flex-wrap">
                            <label className="text-xs text-slate-500">%</label>
                            <input
                              type="number"
                              defaultValue={stock.percentage}
                              onChange={(e) =>
                                setStockEdits((prev) => ({ ...prev, [stock.id]: { ...prev[stock.id], percentage: e.target.value } }))
                              }
                              className="w-16 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs"
                            />
                            <label className="text-xs text-slate-500">Cost</label>
                            <input
                              type="number"
                              defaultValue={stock.cost}
                              onChange={(e) => setStockEdits((prev) => ({ ...prev, [stock.id]: { ...prev[stock.id], cost: e.target.value } }))}
                              className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs"
                            />
                            <label className="text-xs text-slate-500">Value</label>
                            <input
                              type="number"
                              defaultValue={stock.value}
                              onChange={(e) => setStockEdits((prev) => ({ ...prev, [stock.id]: { ...prev[stock.id], value: e.target.value } }))}
                              className="w-20 bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs"
                            />
                            <select
                              defaultValue={stock.status}
                              onChange={(e) => setStockEdits((prev) => ({ ...prev, [stock.id]: { ...prev[stock.id], status: e.target.value } }))}
                              className="bg-slate-900 border border-slate-700 rounded px-1.5 py-1 text-xs"
                            >
                              <option value="Active">Active</option>
                              <option value="Sold">Sold</option>
                            </select>
                            <button
                              onClick={() => {
                                const e = stockEdits[stock.id] || {};
                                const updates = {};
                                if (e.percentage !== undefined) updates.percentage = Number(e.percentage);
                                if (e.cost !== undefined) updates.cost = Number(e.cost);
                                if (e.value !== undefined) updates.value = Number(e.value);
                                if (e.status !== undefined) updates.status = e.status;
                                updateStock(player.id, stock.id, updates);
                                setStockEdits((prev) => {
                                  const next = { ...prev };
                                  delete next[stock.id];
                                  return next;
                                });
                              }}
                              className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs px-2.5 py-1 rounded"
                            >
                              Save
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })()}
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <h3 className="font-bold text-sm text-amber-400">📤 Export Results</h3>
        <p className="text-xs text-slate-400">A clean leaderboard for tracking, or the full raw data for tracking down a bug.</p>
        <div className="flex gap-2">
          <button onClick={exportLeaderboardCSV} className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3 py-2 rounded transition">
            Export Leaderboard (CSV)
          </button>
          <button onClick={exportFullDataJSON} className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold text-xs px-3 py-2 rounded transition">
            Export Full Data (JSON)
          </button>
        </div>
      </div>

      <div className="bg-slate-900 p-4 rounded-xl border border-slate-700 space-y-3">
        <h3 className="font-bold text-sm text-amber-400">🏁 Tournament Status</h3>
        <p className="text-xs text-slate-400">
          {config.completed ? 'Marked complete — buying, selling, and round changes are locked.' : 'Mark it complete once the tournament is over to lock in final results.'}
        </p>
        <button
          onClick={config.completed ? reopenTournament : completeTournament}
          className={`w-full font-bold py-2.5 rounded-lg transition text-sm ${
            config.completed ? 'bg-slate-700 hover:bg-slate-600 text-slate-100' : 'bg-amber-500 hover:bg-amber-400 text-slate-950'
          }`}
        >
          {config.completed ? 'Reopen Tournament' : 'Complete Tournament'}
        </button>
      </div>

      <div className="bg-red-950/40 p-4 rounded-xl border border-red-900 space-y-3">
        <h3 className="font-bold text-sm text-red-400">🔄 Reset Tournament</h3>
        <p className="text-xs text-slate-400">Wipes everyone and every round, starting a brand new tournament on this same deployed app — reuse it for the next event.</p>
        <button onClick={resetTournament} className="w-full bg-red-600 hover:bg-red-500 text-white font-bold py-2.5 rounded-lg transition text-sm">
          Reset Everything
        </button>
      </div>
    </div>
  );
}

const MAX_PLAYERS_VAL = 50;
