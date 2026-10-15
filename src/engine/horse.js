// Horse-betting style: pooled bets, odds come from where the money is.
// Win = finishes 1st. Place = top 2. Show = top 3 (4-player groups only).
import { currentRound, isFinalRound, roundPhase } from './selectors.js';
import { minSelfCost } from './util.js';

export const kindsForSize = (size) => (size >= 4 ? ['win', 'place', 'show'] : size === 3 ? ['win', 'place'] : ['win']);
export const KIND_LABEL = { win: 'Win', place: 'Place', show: 'Show' };
const COUNT = { win: 1, place: 2, show: 3 };
export const countingFinishers = (kind, places) => places.slice(0, COUNT[kind]);

export const betsList = (s) => Object.values(s.bets || {});

export function ownBetTotal(s, pid, stockId) {
  return betsList(s)
    .filter((b) => b.bettorId === pid && b.stockId === stockId)
    .reduce((a, b) => a + b.amount, 0);
}

export function poolOf(s, groupId, kind) {
  return betsList(s)
    .filter((b) => b.groupId === groupId && b.kind === kind)
    .reduce((a, b) => a + b.amount, 0);
}

export const backedOn = (s, stockId, kind) =>
  betsList(s)
    .filter((b) => b.stockId === stockId && b.kind === kind)
    .reduce((a, b) => a + b.amount, 0);

// Live estimate for a bet of this kind on this runner: returns {mult, odds} or null.
// For place/show the pool is shared between the finishers that count, so this is an estimate.
export function liveOdds(s, groupId, kind, stockId) {
  const pool = poolOf(s, groupId, kind);
  const backed = backedOn(s, stockId, kind);
  if (!pool || !backed) return null;
  const mult = pool / COUNT[kind] / backed;
  return { mult, odds: Math.max(0, mult - 1) };
}

export function checkBet(s, pid, stockId, kind, amount, now) {
  const no = (error) => ({ ok: false, error });
  const st = s.settings;
  const p = s.players[pid];
  if (!p) return no('Unknown player');
  if (p.withdrawn) return no('You have been removed from the tournament');
  if (p.eliminated) return no("You're out of the tournament");
  if (s.status !== 'active') return no('The tournament is not running');
  if (st.style !== 'horse') return no('This tournament uses stocks, not bets');
  const stock = s.stocks[stockId];
  if (!stock || stock.round !== s.round) return no('That runner is not in this round');
  const ph = roundPhase(s, now);
  const own = stock.playerId === pid;
  if (ph !== 'self' && ph !== 'open') return no('Betting is closed');
  const r = currentRound(s);
  const group = r.groups.find((g) => g.id === stock.groupId);
  if (!kindsForSize(group.playerIds.length).includes(kind)) return no(`${KIND_LABEL[kind] || kind} bets are not offered in this group`);
  if (!Number.isInteger(amount) || amount < st.minBet) return no(`Minimum bet is $${st.minBet}`);
  if (amount > p.cash) return no('Not enough cash');
  return { ok: true, amount };
}

export function maxBet(s, pid, stockId, kind, now) {
  const p = s.players[pid];
  let lo = 0;
  for (let a = s.settings.minBet; a <= p.cash; a += 10) {
    if (checkBet(s, pid, stockId, kind, a, now).ok) lo = a;
    else if (lo > 0) break;
  }
  return lo;
}

// betId -> payout for one group, given a finishing order.
export function groupPayouts(s, g, places, bonusPct) {
  const out = {};
  const size = g.playerIds.length;
  for (const kind of kindsForSize(size)) {
    const bets = betsList(s).filter((b) => b.groupId === g.id && b.kind === kind);
    if (!bets.length) continue;
    const pool = bets.reduce((a, b) => a + b.amount, 0);
    const counting = countingFinishers(kind, places);
    const backedBy = {};
    for (const b of bets) {
      const owner = s.stocks[b.stockId].playerId;
      backedBy[owner] = (backedBy[owner] || 0) + b.amount;
    }
    const live = counting.filter((pid) => backedBy[pid] > 0);
    if (!live.length) {
      for (const b of bets) out[b.id] = b.amount; // nobody backed a finisher: refund
      continue;
    }
    const share = (pool * (1 + (bonusPct || 0) / 100)) / live.length;
    for (const b of bets) {
      const owner = s.stocks[b.stockId].playerId;
      out[b.id] = live.includes(owner) ? Math.round((share * b.amount) / backedBy[owner]) : 0;
    }
  }
  return out;
}

export function payoutHorse(s) {
  const r = currentRound(s);
  for (const g of r.groups) if (!g.places) throw new Error('Every group needs a result first');
  const bonus = isFinalRound(s) ? s.settings.houseBonusFinalPct : 0;
  r.bonusPct = bonus;
  for (const g of r.groups) {
    const pay = groupPayouts(s, g, g.places, bonus);
    for (const b of betsList(s)) {
      if (b.groupId !== g.id) continue;
      b.payout = pay[b.id] ?? 0;
      b.status = 'paid';
      s.players[b.bettorId].cash += b.payout;
    }
    for (const pid of g.playerIds) {
      const stock = s.stocks[r.stockByPlayer[pid]];
      stock.status = 'resolved';
      stock.place = g.places.indexOf(pid) + 1;
    }
    g.paid = true;
  }
  r.phase = 'paid';
}

// Rough payout if this bet hits, at the odds it would leave behind (ignores any final-round bonus).
export function estimateReturn(s, groupId, kind, stockId, amount) {
  const pool = poolOf(s, groupId, kind) + amount;
  const backed = backedOn(s, stockId, kind) + amount;
  return Math.round((amount * (pool / COUNT[kind])) / backed);
}
