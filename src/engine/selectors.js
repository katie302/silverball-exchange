// Read-only helpers shared by the UI and the reducer (so the screen and the
// server-side check never disagree).
import { quote, minSelfCost, factorFor } from './util.js';

export const activePlayers = (s) => s.playerOrder.filter((id) => !s.players[id].eliminated);
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
  return t;
}

export function allBoughtIn(s) {
  const r = currentRound(s);
  if (!r) return false;
  const ids = Object.keys(r.stockByPlayer);
  if (!ids.length) return false;
  return ids.every((pid) => heldPct(s, pid, r.stockByPlayer[pid]) >= s.settings.minSelfBuyPct);
}

// Derived phase: the self-buy window ends on its own when the timer runs out or
// everyone has bought in. Nothing is stored for that transition.
export function roundPhase(s, now) {
  const r = currentRound(s);
  if (!r) return null;
  if (r.phase === 'self') {
    if ((r.selfEndsAt != null && now >= r.selfEndsAt) || allBoughtIn(s)) return 'open';
    return 'self';
  }
  return r.phase;
}

export function groupOf(s, pid, roundN = s.round) {
  const r = s.rounds[roundN - 1];
  if (!r) return null;
  return r.groups.find((g) => g.playerIds.includes(pid)) || null;
}

export function leaderboard(s) {
  const rows = s.playerOrder.map((id) => ({
    id,
    name: s.players[id].name,
    cash: s.players[id].cash,
    eliminated: s.players[id].eliminated,
    worth: netWorth(s, id),
  }));
  rows.sort((a, b) => b.worth - a.worth || a.name.localeCompare(b.name));
  let rank = 0;
  let last = null;
  rows.forEach((r, i) => {
    if (r.worth !== last) rank = i + 1;
    r.rank = rank;
    last = r.worth;
  });
  return rows;
}

export function checkBuy(s, pid, stockId, pct, now) {
  const no = (error) => ({ ok: false, error });
  const st = s.settings;
  const p = s.players[pid];
  if (!p) return no('Unknown player');
  if (p.eliminated) return no("You're out of the tournament");
  if (s.status !== 'active') return no('The tournament is not running');
  const stock = s.stocks[stockId];
  if (!stock || stock.round !== s.round) return no('That stock is not in this round');
  const ph = roundPhase(s, now);
  const own = stock.playerId === pid;
  if (ph === 'self' && !own) return no('Others open when the self-buy window ends');
  if (ph !== 'self' && ph !== 'open') return no('Trading is closed');
  if (stock.status !== 'open') return no('This stock is closed');
  if (!Number.isInteger(pct) || pct < 1) return no('Pick at least 1%');
  const remaining = 100 - stock.soldPct;
  if (pct > remaining) return no(`Only ${remaining}% left`);
  const owner = s.players[stock.playerId];
  if (!own) {
    const need = Math.max(0, st.minSelfBuyPct - heldPct(s, stock.playerId, stockId));
    if (pct > remaining - need) return no(`${need}% is held back for ${owner.name}`);
  }
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
  let best = 0;
  for (let n = 1; n <= 100; n++) {
    if (checkBuy(s, pid, stockId, n, now).ok) best = n;
    else if (best > 0) break;
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
  if (p.eliminated) return no("You're out of the tournament");
  const stock = s.stocks[pos.stockId];
  if (stock.status === 'locked') return no('Frozen until the result is in');
  const ph = roundPhase(s, now);
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

// What a result correction would change. `places` is an array of player ids, 1st first.
export function computeFix(s, roundN, groupId, places) {
  const r = s.rounds[roundN - 1];
  const g = r.groups.find((x) => x.id === groupId);
  const size = g.playerIds.length;
  const changes = [];
  for (const stock of Object.values(s.stocks)) {
    if (stock.round !== roundN || stock.groupId !== groupId) continue;
    const place = places.indexOf(stock.playerId) + 1;
    const f = factorFor(s.settings, size, place, stock.mult, stock.eventDelta);
    for (const pos of Object.values(s.positions)) {
      if (pos.stockId !== stock.id) continue;
      if (pos.status === 'sold' && !pos.soldAfter) continue;
      const newValue = Math.round(pos.cost * f);
      const oldValue = pos.status === 'held' ? pos.value : pos.soldValue;
      if (newValue === oldValue) continue;
      changes.push({
        positionId: pos.id,
        holderId: pos.holderId,
        stockId: stock.id,
        owner: stock.playerId,
        status: pos.status,
        oldValue,
        newValue,
        delta: newValue - oldValue,
      });
    }
  }
  return changes;
}
