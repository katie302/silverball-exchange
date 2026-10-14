// The whole game as one pure function: reduce(state, action) -> new state.
// Invalid actions throw Error(message). Actions carry `now` (ms) so the engine
// never reads the clock itself.
import { DEFAULT_SETTINGS } from './constants.js';
import { makeGroups, shuffle, pairKey, minSelfCost, factorFor, payoutFor } from './util.js';
import { drawEvent, eventDelta, describeEvent } from './events.js';
import {
  activePlayers,
  currentRound,
  isFinalRound,
  netWorth,
  roundPhase,
  checkBuy,
  checkSell,
  computeFix,
  heldPositions,
} from './selectors.js';

export function initialState() {
  return {
    v: 2,
    status: 'setup',
    organizerEmail: null,
    settings: structuredClone(DEFAULT_SETTINGS),
    players: {},
    playerOrder: [],
    machines: {},
    machineOrder: [],
    round: 0,
    rounds: [],
    stocks: {},
    positions: {},
    pairCounts: {},
    pairLast: {},
    log: [],
    nextId: 1,
  };
}

const nid = (s, prefix) => `${prefix}${s.nextId++}`;
const log = (s, now, msg) => {
  s.log.push({ t: now || 0, msg });
  if (s.log.length > 400) s.log.splice(0, s.log.length - 400);
};

function requireOrg(s, a) {
  if (!s.organizerEmail || !a.actor || String(a.actor).toLowerCase() !== s.organizerEmail.toLowerCase())
    throw new Error('Organizer only');
}
function requirePlayer(s, a) {
  const p = s.players[a.pid];
  if (!p || !p.claimed || !a.pinHash || p.pinHash !== a.pinHash) throw new Error('Please sign in again');
  return p;
}
function requireActive(s) {
  if (s.status !== 'active') throw new Error('The tournament is not running');
}
function requirePhase(s, now, ...phases) {
  const ph = roundPhase(s, now);
  if (!phases.includes(ph)) throw new Error('Not available in this phase');
  return ph;
}

function startRound(s, now) {
  const n = s.round + 1;
  const active = activePlayers(s);
  if (active.length < 2) throw new Error('Need at least 2 players left');
  const groupsIds = makeGroups(active, s.pairCounts, s.pairLast);
  const prev = s.rounds[n - 2];
  const lastUsed = new Set(prev ? prev.groups.map((g) => g.machineId) : []);
  const avail = s.machineOrder.filter((id) => !s.machines[id].pulled);
  const order = [
    ...shuffle(avail.filter((id) => !lastUsed.has(id))),
    ...shuffle(avail.filter((id) => lastUsed.has(id))),
  ];
  if (order.length < groupsIds.length)
    throw new Error(`Need ${groupsIds.length} machines for ${active.length} players, only ${order.length} available`);
  const round = {
    n,
    phase: 'self',
    selfEndsAt: s.settings.selfBuySeconds > 0 ? now + s.settings.selfBuySeconds * 1000 : now,
    groups: [],
    stockByPlayer: {},
    event: null,
  };
  groupsIds.forEach((ids, i) => {
    const g = { id: `r${n}g${i + 1}`, machineId: order[i], playerIds: ids, places: null, reports: [], paid: false };
    round.groups.push(g);
    for (const pid of ids) {
      const stock = {
        id: `r${n}-${pid}`,
        round: n,
        groupId: g.id,
        playerId: pid,
        machineId: g.machineId,
        soldPct: 0,
        status: 'open',
        place: null,
        eventDelta: 0,
        mult: 1,
        mod: 0,
      };
      s.stocks[stock.id] = stock;
      round.stockByPlayer[pid] = stock.id;
    }
    for (let a = 0; a < ids.length; a++)
      for (let b = a + 1; b < ids.length; b++) {
        const k = pairKey(ids[a], ids[b]);
        s.pairCounts[k] = (s.pairCounts[k] || 0) + 1;
        s.pairLast[k] = n;
      }
  });
  s.rounds.push(round);
  s.round = n;
  log(s, now, `Round ${n} started: ${round.groups.length} groups`);
}

function payoutRound(s, now, event) {
  const r = currentRound(s);
  const mult = isFinalRound(s) ? s.settings.finalRoundMult : 1;
  for (const g of r.groups) {
    if (!g.places) throw new Error('Every group needs a result first');
  }
  for (const g of r.groups) {
    const size = g.playerIds.length;
    for (const pid of g.playerIds) {
      const stock = s.stocks[r.stockByPlayer[pid]];
      const place = g.places.indexOf(pid) + 1;
      const delta = eventDelta(event, stock, place, size);
      stock.status = 'resolved';
      stock.place = place;
      stock.mod = payoutFor(s.settings, size)[place - 1] ?? 0;
      stock.eventDelta = delta;
      stock.mult = mult;
      const f = factorFor(s.settings, size, place, mult, delta);
      for (const pos of Object.values(s.positions)) {
        if (pos.stockId === stock.id && pos.status === 'held') pos.value = Math.round(pos.cost * f);
      }
    }
    g.paid = true;
  }
  r.event = event ? { ...event, status: event.status === 'skipped' ? 'skipped' : 'applied' } : r.event;
  r.phase = 'paid';
  if (!isFinalRound(s)) {
    const floor = minSelfCost(s.settings);
    for (const pid of activePlayers(s)) {
      if (netWorth(s, pid) < floor) {
        s.players[pid].eliminated = true;
        log(s, now, `${s.players[pid].name} is out (net worth below $${floor})`);
      }
    }
  }
  log(s, now, `Round ${r.n} paid out`);
}

export function reduce(prev, a) {
  const s = structuredClone(prev);
  const now = a.now || 0;
  const st = s.settings;
  switch (a.type) {
    case 'claimOrganizer': {
      if (!a.actor) throw new Error('Sign in first');
      if (s.organizerEmail && s.organizerEmail.toLowerCase() !== String(a.actor).toLowerCase())
        throw new Error(`This tournament belongs to ${s.organizerEmail}`);
      s.organizerEmail = a.actor;
      break;
    }
    case 'addPlayers': {
      requireOrg(s, a);
      const have = new Set(s.playerOrder.map((id) => s.players[id].name.toLowerCase()));
      for (const raw of a.names || []) {
        const name = String(raw).trim();
        if (!name || have.has(name.toLowerCase())) continue;
        have.add(name.toLowerCase());
        const id = nid(s, 'p');
        s.players[id] = { id, name, pinHash: null, claimed: false, cash: st.startingCash, eliminated: false };
        s.playerOrder.push(id);
      }
      break;
    }
    case 'renamePlayer': {
      requireOrg(s, a);
      const p = s.players[a.pid];
      if (!p) throw new Error('Unknown player');
      const name = String(a.name || '').trim();
      if (!name) throw new Error('Name is empty');
      p.name = name;
      break;
    }
    case 'unclaimPlayer': {
      requireOrg(s, a);
      const p = s.players[a.pid];
      if (!p) throw new Error('Unknown player');
      p.claimed = false;
      p.pinHash = null;
      log(s, now, `${p.name} unclaimed`);
      break;
    }
    case 'removePlayer': {
      requireOrg(s, a);
      if (s.status !== 'setup') throw new Error('Players can only be removed before the start');
      delete s.players[a.pid];
      s.playerOrder = s.playerOrder.filter((id) => id !== a.pid);
      break;
    }
    case 'claimPlayer': {
      const p = s.players[a.pid];
      if (!p) throw new Error('Unknown player');
      if (p.claimed) throw new Error('Already claimed. Log in with your PIN.');
      if (!a.pinHash) throw new Error('Pick a PIN');
      p.claimed = true;
      p.pinHash = a.pinHash;
      break;
    }
    case 'updateSettings': {
      requireOrg(s, a);
      const next = { ...st, ...a.patch };
      const num = (v) => typeof v === 'number' && isFinite(v);
      if (!num(next.startingCash) || next.startingCash < 0) throw new Error('Starting cash is invalid');
      if (!Number.isInteger(next.rounds) || next.rounds < 1) throw new Error('Rounds must be 1 or more');
      if (!Number.isInteger(next.minSelfBuyPct) || next.minSelfBuyPct < 1 || next.minSelfBuyPct > 100)
        throw new Error('Min self-buy must be 1-100%');
      for (const k of ['maxPctPerStock', 'maxSelfBuyPct'])
        if (next[k] != null && (!Number.isInteger(next[k]) || next[k] < 1)) throw new Error('Limits must be whole numbers');
      let last = 0;
      for (const t of next.tiers) {
        if (!(t.upTo > last) || !(t.price > 0)) throw new Error('Price tiers are invalid');
        last = t.upTo;
      }
      if (last !== 100) throw new Error('The last price tier must end at 100%');
      for (const k of ['payout4', 'payout3', 'payout2']) if (!next[k].every(num)) throw new Error('Payouts are invalid');
      if (!num(next.finalRoundMult) || next.finalRoundMult <= 0) throw new Error('Final multiplier is invalid');
      s.settings = next;
      if (s.status === 'setup') for (const p of Object.values(s.players)) p.cash = next.startingCash;
      break;
    }
    case 'addMachines': {
      requireOrg(s, a);
      const have = new Set(s.machineOrder.map((id) => s.machines[id].name.toLowerCase()));
      for (const raw of a.names || []) {
        const name = String(raw).trim();
        if (!name || have.has(name.toLowerCase())) continue;
        have.add(name.toLowerCase());
        const id = nid(s, 'm');
        s.machines[id] = { id, name, pulled: false };
        s.machineOrder.push(id);
      }
      break;
    }
    case 'pullMachine':
    case 'restoreMachine': {
      requireOrg(s, a);
      if (!s.machines[a.machineId]) throw new Error('Unknown machine');
      s.machines[a.machineId].pulled = a.type === 'pullMachine';
      break;
    }
    case 'removeMachine': {
      requireOrg(s, a);
      delete s.machines[a.machineId];
      s.machineOrder = s.machineOrder.filter((id) => id !== a.machineId);
      break;
    }
    case 'startTournament': {
      requireOrg(s, a);
      if (s.status !== 'setup') throw new Error('Already started');
      if (s.playerOrder.length < 2) throw new Error('Add at least 2 players');
      const unclaimed = s.playerOrder.filter((id) => !s.players[id].claimed);
      if (unclaimed.length && !a.override) throw new Error(`${unclaimed.length} players have not claimed their name yet`);
      for (const p of Object.values(s.players)) p.cash = st.startingCash;
      s.status = 'active';
      startRound(s, now);
      break;
    }
    case 'openTrading': {
      requireOrg(s, a);
      requireActive(s);
      const r = currentRound(s);
      if (r.phase !== 'self') throw new Error('Already open');
      r.phase = 'open';
      break;
    }
    case 'lockRound': {
      requireOrg(s, a);
      requireActive(s);
      requirePhase(s, now, 'self', 'open');
      const r = currentRound(s);
      r.phase = 'locked';
      for (const id of Object.values(r.stockByPlayer)) s.stocks[id].status = 'locked';
      log(s, now, `Round ${r.n} locked`);
      break;
    }
    case 'swapMachine': {
      requireOrg(s, a);
      requireActive(s);
      requirePhase(s, now, 'self', 'open', 'locked');
      const r = currentRound(s);
      const g = r.groups.find((x) => x.id === a.groupId);
      if (!g) throw new Error('Unknown group');
      if (!s.machines[a.machineId] || s.machines[a.machineId].pulled) throw new Error('Machine not available');
      if (r.groups.some((x) => x.id !== g.id && x.machineId === a.machineId)) throw new Error('Another group is on that machine');
      g.machineId = a.machineId;
      for (const pid of g.playerIds) s.stocks[r.stockByPlayer[pid]].machineId = a.machineId;
      log(s, now, `Group ${g.id} moved to ${s.machines[a.machineId].name}`);
      break;
    }
    case 'submitReport': {
      requirePlayer(s, a);
      requireActive(s);
      requirePhase(s, now, 'locked');
      const r = currentRound(s);
      const g = r.groups.find((x) => x.id === a.groupId);
      if (!g || !g.playerIds.includes(a.pid)) throw new Error('You are not in that group');
      const ord = a.order || [];
      if (ord.length !== g.playerIds.length || !g.playerIds.every((id) => ord.includes(id)))
        throw new Error('Rank every player in the group');
      g.reports = g.reports.filter((x) => x.by !== a.pid);
      g.reports.push({ id: nid(s, 'rep'), by: a.pid, order: ord, at: now });
      break;
    }
    case 'approveReport': {
      requireOrg(s, a);
      requireActive(s);
      requirePhase(s, now, 'locked');
      const g = currentRound(s).groups.find((x) => x.id === a.groupId);
      const rep = g && g.reports.find((x) => x.id === a.reportId);
      if (!rep) throw new Error('Report not found');
      g.places = rep.order.slice();
      break;
    }
    case 'setPlaces': {
      requireOrg(s, a);
      requireActive(s);
      requirePhase(s, now, 'locked');
      const g = currentRound(s).groups.find((x) => x.id === a.groupId);
      const ord = a.order || [];
      if (!g || ord.length !== g.playerIds.length || !g.playerIds.every((id) => ord.includes(id)))
        throw new Error('Rank every player in the group');
      g.places = ord.slice();
      break;
    }
    case 'clearPlaces': {
      requireOrg(s, a);
      requirePhase(s, now, 'locked');
      const g = currentRound(s).groups.find((x) => x.id === a.groupId);
      if (g) g.places = null;
      break;
    }
    case 'sendBack': {
      requireOrg(s, a);
      const g = currentRound(s).groups.find((x) => x.id === a.groupId);
      if (!g) throw new Error('Unknown group');
      g.reports = a.reportId ? g.reports.filter((x) => x.id !== a.reportId) : [];
      break;
    }
    case 'continueFromResults': {
      requireOrg(s, a);
      requireActive(s);
      requirePhase(s, now, 'locked');
      const r = currentRound(s);
      if (!r.groups.every((g) => g.places)) throw new Error('Every group needs a result first');
      if (isFinalRound(s)) payoutRound(s, now, null);
      else {
        r.event = drawEvent(s);
        r.phase = 'event';
      }
      break;
    }
    case 'rerollEvent': {
      requireOrg(s, a);
      requirePhase(s, now, 'event');
      const r = currentRound(s);
      r.event = drawEvent(s, Math.random, r.event && r.event.kind);
      break;
    }
    case 'applyEvent': {
      requireOrg(s, a);
      requirePhase(s, now, 'event');
      const r = currentRound(s);
      log(s, now, `Event: ${describeEvent(s, r.event).name}`);
      payoutRound(s, now, r.event);
      break;
    }
    case 'skipEvent': {
      requireOrg(s, a);
      requirePhase(s, now, 'event');
      const r = currentRound(s);
      r.event = { ...r.event, status: 'skipped' };
      payoutRound(s, now, r.event);
      break;
    }
    case 'nextRound': {
      requireOrg(s, a);
      requireActive(s);
      requirePhase(s, now, 'paid');
      if (s.round >= st.rounds) throw new Error('That was the last round. Finish the tournament.');
      if (activePlayers(s).length < 2) throw new Error('Fewer than 2 players left. Finish the tournament.');
      startRound(s, now);
      break;
    }
    case 'finishTournament': {
      requireOrg(s, a);
      requireActive(s);
      requirePhase(s, now, 'paid');
      if (s.round < st.rounds && activePlayers(s).length >= 2) throw new Error('There are rounds left');
      s.status = 'complete';
      log(s, now, 'Tournament finished');
      break;
    }
    case 'fixPlaces': {
      requireOrg(s, a);
      const r = s.rounds[a.round - 1];
      const g = r && r.groups.find((x) => x.id === a.groupId);
      if (!g || !g.paid) throw new Error('That match has not been paid out');
      const ord = a.order || [];
      if (ord.length !== g.playerIds.length || !g.playerIds.every((id) => ord.includes(id)))
        throw new Error('Rank every player in the group');
      const changes = computeFix(s, a.round, g.id, ord);
      const size = g.playerIds.length;
      for (const pid of g.playerIds) {
        const stock = s.stocks[r.stockByPlayer[pid]];
        stock.place = ord.indexOf(pid) + 1;
        stock.mod = payoutFor(st, size)[stock.place - 1] ?? 0;
      }
      for (const c of changes) {
        const pos = s.positions[c.positionId];
        if (pos.status === 'held') pos.value = c.newValue;
        else if (a.policy === 'adjust') {
          s.players[pos.holderId].cash += c.delta;
          pos.soldValue = c.newValue;
        }
      }
      g.places = ord.slice();
      log(s, now, `Result corrected for round ${a.round} ${g.id} (${a.policy === 'adjust' ? 'adjusted sold cash' : 'left sold cash'})`);
      break;
    }
    case 'adjustCash': {
      requireOrg(s, a);
      const p = s.players[a.pid];
      if (!p || typeof a.amount !== 'number' || !isFinite(a.amount)) throw new Error('Invalid adjustment');
      p.cash += a.amount;
      log(s, now, `Cash ${a.amount >= 0 ? '+' : ''}${a.amount} for ${p.name}${a.note ? ': ' + a.note : ''}`);
      break;
    }
    case 'resetTournament': {
      requireOrg(s, a);
      if (a.confirm !== 'RESET') throw new Error('Type RESET to confirm');
      s.status = 'setup';
      s.round = 0;
      s.rounds = [];
      s.stocks = {};
      s.positions = {};
      s.pairCounts = {};
      s.pairLast = {};
      s.log = [];
      for (const p of Object.values(s.players)) {
        p.cash = st.startingCash;
        p.eliminated = false;
      }
      break;
    }
    case 'buy': {
      requirePlayer(s, a);
      const chk = checkBuy(s, a.pid, a.stockId, a.pct, now);
      if (!chk.ok) throw new Error(chk.error);
      const stock = s.stocks[a.stockId];
      s.players[a.pid].cash -= chk.cost;
      stock.soldPct += a.pct;
      let pos = Object.values(s.positions).find(
        (p) => p.holderId === a.pid && p.stockId === a.stockId && p.status === 'held'
      );
      if (pos) {
        pos.pct += a.pct;
        pos.cost += chk.cost;
        pos.value += chk.cost;
      } else {
        const id = nid(s, 'pos');
        s.positions[id] = {
          id,
          stockId: a.stockId,
          holderId: a.pid,
          pct: a.pct,
          cost: chk.cost,
          value: chk.cost,
          status: 'held',
          soldValue: 0,
          soldAfter: false,
        };
      }
      break;
    }
    case 'sell': {
      requirePlayer(s, a);
      const chk = checkSell(s, a.pid, a.positionId, now);
      if (!chk.ok) throw new Error(chk.error);
      const pos = s.positions[a.positionId];
      const stock = s.stocks[pos.stockId];
      s.players[a.pid].cash += chk.value;
      pos.status = 'sold';
      pos.soldValue = chk.value;
      pos.soldAfter = stock.status === 'resolved';
      break;
    }
    case 'sellAllResolved': {
      requirePlayer(s, a);
      if (s.players[a.pid].eliminated) throw new Error("You're out of the tournament");
      for (const pos of heldPositions(s, a.pid)) {
        const stock = s.stocks[pos.stockId];
        if (stock.status !== 'resolved') continue;
        s.players[a.pid].cash += pos.value;
        pos.status = 'sold';
        pos.soldValue = pos.value;
        pos.soldAfter = true;
      }
      break;
    }
    default:
      throw new Error(`Unknown action ${a.type}`);
  }
  return s;
}
