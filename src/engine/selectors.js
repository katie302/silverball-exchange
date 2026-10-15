// Read-only helpers shared by the UI and the reducer (so the screen and the
// server-side check never disagree).
import { quote, minSelfCost, factorFor } from './util.js';

export const activePlayers = (s) =>
  s.playerOrder.filter((id) => !s.players[id].eliminated && !s.players[id].withdrawn);
export const currentRound = (s) => (s.round > 0 ? s.rounds[s.round - 1] : null);
export const isFinalRound = (s) => s.round === s.settings.rounds;

export function heldPositions(s, pid) {
  return Object.values(s.positions).filter((p) => p.holderId === pid && p.status === 'held');
}

export function heldPct(s, pid, stockId) {
  let t = 0;
  for (const p of Object.values(s.positions)) {
    if (p.holderId === pid && p.stockId === stockId && p.status === 'held') t += p.pct;
  }
  return t;
}

export function netWorth(s, pid) {
  let t = s.players[pid].cash;
  for (const p of heldPositions(s, pid)) t += p.value;
  for (const b of Object.values(s.bets || {})) if (b.bettorId === pid && b.status === 'open') t += b.amount;
  return t;
}

export function allBoughtIn(s) {
  const r = currentRound(s);
  if (!r) return false;
  const ids = Object.keys(r.stockByPlayer);
  if (!ids.length) return false;
  if (s.settings.style === 'horse') {
    const need = minSelfCost(s.settings);
    return ids.every((pid) => {
      const sid = r.stockByPlayer[pid];
      return Object.values(s.bets || {}).filter((b) => b.bettorId === pid && b.stockId === sid).reduce((a, b) => a + b.amount, 0) >= need;
    });
  }
  return ids.every((pid) => heldPct(s, pid, r.stockByPlayer[pid]) >= s.settings.minSelfBuyPct);
}

// Derived phase: the self-buy window ends on its own when the timer runs out or
// everyone has bought in. Nothing is stored for that transition.
export function roundPhase(s, now) {
  const r = currentRound(s);
  if (!r) return null;
  if (r.phase === 'self') {
    // Horse style has no self-buy window: betting opens for everyone at once.
    if (s.settings.style === 'horse') return 'open';
    if ((r.selfEndsAt != null && now >= r.selfEndsAt) || allBoughtIn(s)) return 'open';
    return 'self';
  }
  return r.phase;
}

// Stocks style: the open market closes by itself when its timer runs out or every
// active player has pressed "I'm done buying". The organizer still locks the round.
export function openEndsAt(s) {
  const r = currentRound(s);
  const secs = s.settings.openSeconds || 0;
  if (!r || s.settings.style === 'horse' || secs <= 0 || r.selfEndsAt == null) return null;
  return r.selfEndsAt + secs * 1000;
}
export function doneCount(s) {
  const r = currentRound(s);
  if (!r) return { done: 0, total: 0 };
  const ids = Object.keys(r.stockByPlayer).filter((id) => s.players[id] && !s.players[id].withdrawn && !s.players[id].eliminated);
  return { done: ids.filter((id) => r.done && r.done[id]).length, total: ids.length };
}
export function marketClosed(s, now) {
  const r = currentRound(s);
  if (!r || s.settings.style === 'horse' || roundPhase(s, now) !== 'open') return false;
  const end = openEndsAt(s);
  if (end != null && now >= end) return true;
  const { done, total } = doneCount(s);
  return total > 0 && done >= total;
}

export function groupOf(s, pid, roundN = s.round) {
  const r = s.rounds[roundN - 1];
  if (!r) return null;
  return r.groups.find((g) => g.playerIds.includes(pid)) || null;
}

// True when the people who should be playing differ from who was drawn into the
// current round (someone was added, removed or restored while it was still open).
export function rosterChanged(s) {
  const r = currentRound(s);
  if (!r || s.status !== 'active') return false;
  const ids = activePlayers(s);
  const keys = Object.keys(r.stockByPlayer);
  return ids.length !== keys.length || ids.some((id) => !r.stockByPlayer[id]);
}

export function leaderboard(s) {
  const rows = s.playerOrder.map((id) => ({
    id,
    name: s.players[id].name,
    cash: s.players[id].cash,
    eliminated: !!s.players[id].eliminated,
    withdrawn: !!s.players[id].withdrawn,
    worth: netWorth(s, id),
  }));
  const ranked = rows.filter((r) => !r.withdrawn);
  const out = rows.filter((r) => r.withdrawn);
  const by = (a, b) => b.worth - a.worth || a.name.localeCompare(b.name);
  ranked.sort(by);
  out.sort(by);
  let rank = 0;
  let last = null;
  ranked.forEach((r, i) => {
    if (r.worth !== last) rank = i + 1;
    r.rank = rank;
    last = r.worth;
  });
  out.forEach((r) => (r.rank = null));
  return [...ranked, ...out];
}

// Who owns a stock (stocks style): merged per holder, including finished/cashed positions.
export function holdersOf(s, stockId) {
  const m = {};
  for (const p of Object.values(s.positions)) {
    if (p.stockId !== stockId) continue;
    if (p.status === 'sold' && !p.soldAfter) continue;
    const h = (m[p.holderId] = m[p.holderId] || { pid: p.holderId, pct: 0, cost: 0, value: 0 });
    h.pct += p.pct;
    h.cost += p.cost;
    h.value += p.status === 'sold' ? p.soldValue : p.value;
  }
  return Object.values(m).sort((a, b) => b.pct - a.pct);
}

// Who bet on a runner (horse style).
export function bettorsOn(s, stockId) {
  return Object.values(s.bets || {})
    .filter((b) => b.stockId === stockId)
    .sort((a, b) => b.amount - a.amount);
}

export function checkBuy(s, pid, stockId, pct, now) {
  const no = (error) => ({ ok: false, error });
  const st = s.settings;
  const p = s.players[pid];
  if (!p) return no('Unknown player');
  if (p.withdrawn) return no('You have been removed from the tournament');
  if (p.eliminated) return no("You're out of the tournament");
  if (s.status !== 'active') return no('The tournament is not running');
  const stock = s.stocks[stockId];
  if (!stock || stock.round !== s.round) return no('That stock is not in this round');
  const ph = roundPhase(s, now);
  const own = stock.playerId === pid;
  if (ph === 'self' && !own) return no('Others open when the self-buy window ends');
  if (ph !== 'self' && ph !== 'open') return no('Trading is closed');
  if (stock.status !== 'open') return no('This stock is closed');
  if (marketClosed(s, now)) return no('The market is closed');
  if (currentRound(s).done?.[pid]) return no("You said you're done buying");
  if (!Number.isInteger(pct) || pct < 1) return no('Pick at least 1%');
  const held = heldPct(s, pid, stockId);
  if (own && st.maxSelfBuyPct != null && held + pct > st.maxSelfBuyPct)
    return no(`Self-buy limit is ${st.maxSelfBuyPct}%`);
  if (!own && st.maxPctPerStock != null && held + pct > st.maxPctPerStock)
    return no(`Limit is ${st.maxPctPerStock}% per stock`);
  const cost = quote(stock.soldPct, pct, st.tiers);
  if (cost > p.cash) return no('Not enough cash');
  const reserve = minSelfCost(st);
  const selfWithin = own && held + pct <= st.minSelfBuyPct;
  if (!isFinalRound(s) && !selfWithin && p.cash - cost < reserve)
    return no(`Keep at least $${reserve} in cash`);
  return { ok: true, cost };
}

export function maxBuyable(s, pid, stockId, now) {
  // No share cap: the limit is cash (and the cash reserve), found by walking up.
  let best = 0;
  for (let n = 1; n <= 5000; n++) {
    if (checkBuy(s, pid, stockId, n, now).ok) best = n;
    else if (best > 0 || n > 400) break;
  }
  return best;
}

export function sellValue(s, pos) {
  const stock = s.stocks[pos.stockId];
  return stock.status === 'resolved' ? pos.value : pos.cost;
}

export function checkSell(s, pid, positionId, now) {
  const no = (error) => ({ ok: false, error });
  const p = s.players[pid];
  const pos = s.positions[positionId];
  if (!p || !pos || pos.holderId !== pid || pos.status !== 'held') return no('Position not found');
  if (p.withdrawn) return no('You have been removed from the tournament');
  if (p.eliminated) return no("You're out of the tournament");
  const stock = s.stocks[pos.stockId];
  if (stock.status === 'locked') return no('Frozen until the result is in');
  const ph = roundPhase(s, now);
  if (marketClosed(s, now)) return no('The market is closed');
  if (ph && ph !== 'paid') {
    const keeps = heldPositions(s, pid).some((q) => {
      if (q.id === pos.id) return false;
      const sq = s.stocks[q.stockId];
      return sq.round === s.round && sq.status !== 'resolved';
    });
    if (!keeps) return no("Keep at least one position in this round's market");
  }
  return { ok: true, value: sellValue(s, pos) };
}
