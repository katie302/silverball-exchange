// Read-only helpers shared by the UI and the reducer (so the screen and the
// server-side check never disagree).
import { quote, minSelfCost, factorFor } from './util.js';
import { groupPayouts } from './horse.js';

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
  return r.selfEndsAt + (secs + (r.extraSeconds || 0)) * 1000;
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
  if (!Number.isInteger(pct) || pct < 1) return no('Pick at least 1 share');
  const held = heldPct(s, pid, stockId);
  if (own && !isFinalRound(s) && st.maxSelfBuyPct != null && held + pct > st.maxSelfBuyPct)
    return no(`You can own at most ${st.maxSelfBuyPct} shares of your own stock`);
  if (!own && st.maxPctPerStock != null && held + pct > st.maxPctPerStock)
    return no(`Limit is ${st.maxPctPerStock} shares per stock`);
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

// ---------- buy into other players (stocks style) ----------
// A player must hold at least `minOtherShares` of `minOtherStocks` OTHER players' stocks in
// the current round before they can press "I'm done buying". The rule shrinks to what a
// player can afford (while keeping the cash reserve), and the organizer can excuse anyone.
// It never applies in the final round.
export function diversifyStatus(s, pid) {
  const st = s.settings;
  const r = currentRound(s);
  const none = { need: 0, have: 0, met: true, excused: false, waived: false };
  if (!r || st.style === 'horse' || !st.minOtherStocks || isFinalRound(s)) return none;
  if (r.stockByPlayer[pid] == null) return none;
  const others = Object.entries(r.stockByPlayer)
    .filter(([id]) => id !== pid && s.players[id] && !s.players[id].withdrawn && !s.players[id].eliminated)
    .map(([, sid]) => s.stocks[sid])
    .filter((x) => x && x.status === 'open');
  let have = 0;
  const open = [];
  for (const stock of others) {
    const h = heldPct(s, pid, stock.id);
    if (h >= st.minOtherShares) have++;
    else open.push(quote(stock.soldPct, st.minOtherShares - h, st.tiers));
  }
  // How many more could this player pay for and still keep the reserve?
  open.sort((a, b) => a - b);
  let spare = s.players[pid].cash - minSelfCost(st);
  let canAdd = 0;
  for (const c of open) {
    if (c > spare) break;
    spare -= c;
    canAdd++;
  }
  const need = Math.min(st.minOtherStocks, have + canAdd);
  const excused = !!(r.excused && r.excused[pid]);
  return {
    need,
    have,
    met: excused || have >= need,
    excused,
    waived: need < st.minOtherStocks,
  };
}

// Active players who still owe purchases (for the organizer's list).
export function diversifyShort(s) {
  const r = currentRound(s);
  if (!r) return [];
  return Object.keys(r.stockByPlayer).filter((id) => {
    const p = s.players[id];
    if (!p || p.withdrawn || p.eliminated) return false;
    const d = diversifyStatus(s, id);
    return !d.met;
  });
}

// ---------- results that are not final yet ----------
// For a group: the official result (places), else the suggested one from player reports.
// If reports disagree, the latest one is shown and flagged as conflicting.
export function suggestedOrder(s, g) {
  if (g.places) return { order: g.places, status: 'official', conflict: false };
  const reps = g.reports || [];
  if (!reps.length) return { order: null, status: 'none', conflict: false };
  const latest = reps.reduce((a, b) => (b.at >= a.at ? b : a));
  const key = (o) => o.join('|');
  const conflict = reps.some((x) => key(x.order) !== key(latest.order));
  return { order: latest.order, status: 'suggested', conflict };
}

// Projects what each stock, position and player would be worth if the suggested/official
// results hold. Only meaningful while matches are being played (before payout).
export function projection(s, now) {
  const r = currentRound(s);
  if (!r || s.status !== 'active') return null;
  const ph = roundPhase(s, now);
  if (ph !== 'locked' && ph !== 'event') return null;
  const horse = s.settings.style === 'horse';
  const mult = isFinalRound(s) ? s.settings.finalRoundMult : 1;
  const out = { groups: {}, stocks: {}, positions: {}, players: {}, exact: isFinalRound(s) || horse, anyPending: false, anyConflict: false };
  for (const id of s.playerOrder) out.players[id] = { worth: netWorth(s, id), delta: 0 };
  for (const g of r.groups) {
    const sug = suggestedOrder(s, g);
    out.groups[g.id] = sug;
    if (!sug.order) continue;
    if (sug.status === 'suggested') out.anyPending = true;
    if (sug.conflict) out.anyConflict = true;
    const size = g.playerIds.length;
    if (horse) {
      const bonus = isFinalRound(s) ? s.settings.houseBonusFinalPct : 0;
      const pay = groupPayouts(s, g, sug.order, bonus);
      for (const pid of g.playerIds) {
        const stock = s.stocks[r.stockByPlayer[pid]];
        out.stocks[stock.id] = { place: sug.order.indexOf(pid) + 1, status: sug.status, conflict: sug.conflict };
      }
      for (const b of Object.values(s.bets || {})) {
        if (b.groupId !== g.id || b.status !== 'open') continue;
        const v = pay[b.id] ?? 0;
        out.positions[b.id] = v;
        out.players[b.bettorId].delta += v - b.amount;
      }
    } else {
      for (const pid of g.playerIds) {
        const stock = s.stocks[r.stockByPlayer[pid]];
        const place = sug.order.indexOf(pid) + 1;
        const f = factorFor(s.settings, size, place, mult, 0);
        out.stocks[stock.id] = { place, factor: f, change: Math.round((f - 1) * 100), status: sug.status, conflict: sug.conflict };
        for (const pos of Object.values(s.positions)) {
          if (pos.stockId !== stock.id || pos.status !== 'held') continue;
          const v = Math.round(pos.cost * f);
          out.positions[pos.id] = v;
          out.players[pos.holderId].delta += v - pos.value;
        }
      }
    }
  }
  for (const id of Object.keys(out.players)) out.players[id].worth += out.players[id].delta;
  return out;
}

// Net worth after each finished round, for the Board chart. rounds[i].worths is filled at payout.
export function worthHistory(s) {
  const out = {};
  for (const id of s.playerOrder) {
    out[id] = [];
  }
  for (const r of s.rounds) {
    for (const id of s.playerOrder) out[id].push(r.worths && r.worths[id] != null ? r.worths[id] : null);
  }
  return out;
}

// The stock that made its backers the most money (total dollars gained), for the end screen.
export function bestStocks(s) {
  const horse = s.settings.style === 'horse';
  const rows = [];
  for (const stock of Object.values(s.stocks)) {
    if (stock.status !== 'resolved') continue;
    let cost = 0;
    let value = 0;
    const backers = new Set();
    if (horse) {
      for (const b of Object.values(s.bets || {})) {
        if (b.stockId !== stock.id || b.status !== 'paid') continue;
        cost += b.amount;
        value += b.payout;
        backers.add(b.bettorId);
      }
    } else {
      for (const p of Object.values(s.positions)) {
        if (p.stockId !== stock.id || !p.soldAfter) continue;
        cost += p.cost;
        value += p.soldValue;
        backers.add(p.holderId);
      }
    }
    if (!cost) continue;
    rows.push({
      stockId: stock.id, ownerId: stock.playerId, round: stock.round, place: stock.place,
      cost, value, gain: value - cost, pct: Math.round(((value - cost) / cost) * 100), backers: backers.size,
    });
  }
  rows.sort((a, b) => b.gain - a.gain || b.pct - a.pct);
  return rows;
}

// Fun end-of-tournament awards. Each has a title, who won it and a one-line detail.
export function awards(s) {
  const horse = s.settings.style === 'horse';
  const name = (id) => s.players[id]?.name || '?';
  const out = [];
  const money$ = (n) => `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
  const top = (map, positive = true) => {
    let best = null;
    for (const [id, v] of Object.entries(map)) if (positive ? v > 0 : v < 0) if (!best || (positive ? v > best.v : v < best.v)) best = { id, v };
    return best;
  };

  // most game wins
  const wins = {};
  for (const r of s.rounds) for (const g of r.groups) if (g.paid && g.places) wins[g.places[0]] = (wins[g.places[0]] || 0) + 1;
  const maxW = Math.max(0, ...Object.values(wins));
  if (maxW >= 1) {
    const ids = Object.keys(wins).filter((id) => wins[id] === maxW);
    if (ids.length <= 3) out.push({ key: 'wins', title: 'Most game wins', who: ids.map(name).join(', '), detail: `${maxW} game${maxW === 1 ? '' : 's'} won` });
  }

  // profit on other players vs on yourself
  const others = {};
  const own = {};
  const add = (map, id, v) => { map[id] = (map[id] || 0) + v; };
  if (horse) {
    for (const b of Object.values(s.bets || {})) {
      if (b.status !== 'paid') continue;
      add(s.stocks[b.stockId].playerId === b.bettorId ? own : others, b.bettorId, b.payout - b.amount);
    }
  } else {
    for (const p of Object.values(s.positions)) {
      if (!p.soldAfter) continue;
      add(s.stocks[p.stockId].playerId === p.holderId ? own : others, p.holderId, p.soldValue - p.cost);
    }
  }
  const inv = top(others);
  if (inv) out.push({ key: 'investor', title: horse ? 'Best bettor' : 'Best investor', who: name(inv.id), detail: `${money$(inv.v)} made on ${horse ? 'other players' : "other players' stocks"}` });
  const self = top(own);
  if (self) out.push({ key: 'self', title: 'Most self-belief', who: name(self.id), detail: `${money$(self.v)} made ${horse ? 'betting on themselves' : 'on their own stock'}` });

  // biggest single-round swings
  const swings = [];
  for (const r of s.rounds) {
    if (!r.worths) continue;
    const prev = s.rounds[r.n - 2];
    for (const id of s.playerOrder) {
      const now = r.worths[id];
      const before = r.n === 1 ? s.settings.startingCash : prev && prev.worths ? prev.worths[id] : null;
      if (now == null || before == null) continue;
      swings.push({ id, round: r.n, d: now - before });
    }
  }
  if (swings.length) {
    const up = swings.reduce((a, b) => (b.d > a.d ? b : a));
    const down = swings.reduce((a, b) => (b.d < a.d ? b : a));
    if (up.d > 0) out.push({ key: 'up', title: 'Biggest single round', who: name(up.id), detail: `+${money$(up.d)} in round ${up.round}` });
    if (down.d < 0) out.push({ key: 'down', title: 'Roughest round', who: name(down.id), detail: `${money$(down.d)} in round ${down.round}` });
  }

  // most backed
  let pop = null;
  for (const stock of Object.values(s.stocks)) {
    if (stock.status !== 'resolved') continue;
    const v = horse
      ? Object.values(s.bets || {}).filter((b) => b.stockId === stock.id).reduce((a, b) => a + b.amount, 0)
      : stock.soldPct;
    if (!pop || v > pop.v) pop = { stock, v };
  }
  if (pop && pop.v > 0)
    out.push({
      key: 'popular', title: horse ? 'Most backed runner' : 'Most popular stock', who: name(pop.stock.playerId),
      detail: `${horse ? money$(pop.v) + ' bet' : pop.v + ' shares sold'} in round ${pop.stock.round}`,
    });
  return out;
}
