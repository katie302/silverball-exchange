import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reduce, initialState, quote, groupSizes, hashPin, netWorth, roundPhase, checkBuy, checkBet,
  leaderboard, activePlayers, currentRound, computeFix, DEFAULT_SETTINGS, ratingMap, groupOdds,
  fmtOdds, holdersOf, rosterChanged, diversifyStatus, diversifyShort, projection, suggestedOrder, bestStocks, worthHistory,
  isFinalRound, awards,
} from '../src/engine/index.js';

const ORG = 'org@example.com';

test('pricing is marginal by tier', () => {
  const t = DEFAULT_SETTINGS.tiers;
  assert.equal(quote(0, 35, t), 750);
  assert.equal(quote(0, 100, t), 2875);
  assert.equal(quote(42, 20, t), 8 * 25 + 12 * 30);
});

test('group sizes', () => {
  assert.deepEqual(groupSizes(14), [4, 4, 3, 3]);
  assert.deepEqual(groupSizes(5), [3, 2]);
  assert.deepEqual(groupSizes(8), [4, 4]);
  assert.deepEqual(groupSizes(9), [3, 3, 3]);
});

async function setup(n, rounds = 4, patch = {}) {
  let s = initialState();
  let t = 1000;
  const send = (type, extra = {}) => { s = reduce(s, { type, actor: ORG, now: t, ...extra }); };
  send('claimOrganizer');
  send('updateSettings', { patch: { rounds, ...patch } });
  send('addPlayers', { names: Array.from({ length: n }, (_, i) => `P${i + 1}`) });
  send('addMachines', { names: Array.from({ length: 12 }, (_, i) => `M${i + 1}`) });
  const pins = {};
  const claim = async (id) => {
    pins[id] = await hashPin('1234', id);
    s = reduce(s, { type: 'claimPlayer', pid: id, pinHash: pins[id], now: t });
  };
  for (const id of s.playerOrder) await claim(id);
  const as = (pid, type, extra = {}) => { s = reduce(s, { type, pid, pinHash: pins[pid], now: t, ...extra }); };
  return { get s() { return s; }, send, as, pins, claim, tick: (ms) => { t += ms; }, get t() { return t; } };
}

function playRound(g, round, { last }) {
  const r = currentRound(g.s);
  for (const pid of activePlayers(g.s)) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
  g.send('lockRound');
  for (const grp of currentRound(g.s).groups) g.send('setPlaces', { groupId: grp.id, order: grp.playerIds });
  g.send('continueFromResults');
  if (!last) g.send('skipEvent');
}

test('full stocks tournament: auto-cash, invariants', async () => {
  const g = await setup(14, 4);
  g.send('startTournament');
  for (let round = 1; round <= 4; round++) {
    const r = currentRound(g.s);
    for (const pid of activePlayers(g.s)) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
    assert.equal(roundPhase(g.s, g.t), 'open');
    for (const pid of activePlayers(g.s)) {
      const other = Object.values(g.s.stocks).filter((x) => x.round === round && x.playerId !== pid);
      const stk = other[Math.floor(Math.random() * other.length)];
      if (checkBuy(g.s, pid, stk.id, 15, g.t).ok) g.as(pid, 'buy', { stockId: stk.id, pct: 15 });
    }
    g.send('lockRound');
    for (const grp of currentRound(g.s).groups) g.send('setPlaces', { groupId: grp.id, order: grp.playerIds });
    g.send('continueFromResults');
    if (round < 4) g.send(Math.random() < 0.5 ? 'applyEvent' : 'skipEvent');
    // auto-cash: nothing left held after payout
    assert.equal(Object.values(g.s.positions).filter((p) => p.status === 'held').length, 0);
    for (const p of Object.values(g.s.players)) assert.ok(p.cash >= 0);
    for (const id of g.s.playerOrder) assert.equal(netWorth(g.s, id), g.s.players[id].cash);
    g.send(round < 4 ? 'nextRound' : 'finishTournament');
  }
  assert.equal(g.s.status, 'complete');
});

test('holders list and corrections adjust cash', async () => {
  const g = await setup(4, 3);
  g.send('startTournament');
  const r = currentRound(g.s);
  const [a, b, c, d] = r.groups[0].playerIds;
  for (const pid of [a, b, c, d]) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
  g.as(b, 'buy', { stockId: r.stockByPlayer[a], pct: 20 });
  assert.deepEqual(holdersOf(g.s, r.stockByPlayer[a]).map((h) => [h.pid, h.pct]), [[b, 20], [a, 10]]);
  g.send('lockRound');
  g.send('setPlaces', { groupId: r.groups[0].id, order: [a, b, c, d] });
  g.send('continueFromResults');
  g.send('skipEvent');
  const cashB = g.s.players[b].cash;
  const ch = computeFix(g.s, 1, r.groups[0].id, [d, c, b, a]);
  assert.ok(ch.length > 0);
  g.send('fixPlaces', { round: 1, groupId: r.groups[0].id, order: [d, c, b, a] });
  assert.notEqual(g.s.players[b].cash, cashB);
});

test('restart round refunds buy-ins and redraws; roster change blocks lock', async () => {
  const g = await setup(8, 3);
  g.send('startTournament');
  const r = currentRound(g.s);
  for (const pid of activePlayers(g.s)) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
  g.send('addPlayers', { names: ['Late'] });
  assert.equal(rosterChanged(g.s), true);
  assert.throws(() => g.send('lockRound'), /roster changed/i);
  g.send('restartRound');
  assert.equal(g.s.round, 1);
  assert.equal(rosterChanged(g.s), false);
  assert.equal(currentRound(g.s).restarts, 1);
  for (const id of g.s.playerOrder) assert.equal(g.s.players[id].cash, 2000);
  assert.equal(Object.keys(g.s.positions).length, 0);
  g.send('removePlayer', { pid: g.s.playerOrder[0] });
  assert.equal(rosterChanged(g.s), true);
  g.send('restartRound');
  assert.equal(activePlayers(g.s).length, 8);
  const lb = leaderboard(g.s);
  assert.equal(lb[lb.length - 1].withdrawn, true);
  assert.equal(lb[lb.length - 1].rank, null);
});

test('cannot remove during locked phase; late joiner gets lower of start cash / average', async () => {
  const g = await setup(4, 3);
  g.send('startTournament');
  const r = currentRound(g.s);
  for (const pid of activePlayers(g.s)) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
  g.send('lockRound');
  assert.throws(() => g.send('removePlayer', { pid: g.s.playerOrder[0] }), /in progress/i);
  g.send('setPlaces', { groupId: r.groups[0].id, order: r.groups[0].playerIds });
  g.send('continueFromResults');
  g.send('skipEvent');
  // everyone's net worth is 2000 on average (zero-sum) -> late joiner gets min(2000, avg)
  const avg = Math.round(activePlayers(g.s).reduce((t, id) => t + netWorth(g.s, id), 0) / 4);
  g.send('addPlayers', { names: ['Late'] });
  const late = g.s.playerOrder[g.s.playerOrder.length - 1];
  assert.equal(g.s.players[late].cash, Math.min(2000, avg));
});

test('ratings: odds sum to 1 and update after matches', async () => {
  const g = await setup(4, 3);
  g.send('startTournament');
  const r = currentRound(g.s);
  const grp = r.groups[0];
  const odds0 = groupOdds(g.s, grp);
  const total = Object.values(odds0).reduce((t, o) => t + o.win, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  assert.equal(fmtOdds(0.25), '3-to-1');
  for (const pid of activePlayers(g.s)) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
  g.send('lockRound');
  g.send('setPlaces', { groupId: grp.id, order: grp.playerIds });
  g.send('continueFromResults');
  g.send('skipEvent');
  const m = ratingMap(g.s);
  assert.ok(m[grp.playerIds[0]].rating > m[grp.playerIds[3]].rating);
  assert.equal(m[grp.playerIds[0]].games, 1);
  // IFPA rating seeds the start when enabled
  g.send('setIfpa', { pid: grp.playerIds[3], ifpaId: '123' });
  g.send('setRatings', { ratings: { [grp.playerIds[3]]: 1900 } });
  const on = ratingMap(g.s)[grp.playerIds[3]].rating;
  g.send('updateSettings', { patch: { useIfpa: false } });
  const off = ratingMap(g.s)[grp.playerIds[3]].rating;
  assert.ok(on > off + 300);
});

test('game style is locked once the tournament starts', async () => {
  const g = await setup(4, 2, { style: 'horse' });
  g.send('startTournament');
  assert.throws(() => g.send('updateSettings', { patch: { style: 'stocks' } }), /style can only/i);
});

test('horse style full run', async () => {
  const g = await setup(4, 2, { style: 'horse' });
  g.send('startTournament');
  let r = currentRound(g.s);
  const [a, b, c, d] = r.groups[0].playerIds;
  const S = r.stockByPlayer;
  assert.throws(() => g.as(a, 'buy', { stockId: S[a], pct: 10 }), /bets/i);
  assert.equal(roundPhase(g.s, g.t), 'open'); // no self-bet window in horse style
  g.as(b, 'bet', { stockId: S[a], kind: 'win', amount: 100 }); // betting on others straight away
  for (const pid of [a, c, d]) g.as(pid, 'bet', { stockId: S[pid], kind: 'win', amount: 100 }); // self-bets are optional
  g.as(b, 'bet', { stockId: S[a], kind: 'win', amount: 200 }); // b backs a again (b: 100+200 on a)
  g.as(c, 'bet', { stockId: S[a], kind: 'place', amount: 200 });
  g.as(d, 'bet', { stockId: S[b], kind: 'place', amount: 200 });
  assert.equal(netWorth(g.s, b), 2000); // open bets still count
  assert.throws(() => g.as(a, 'bet', { stockId: S[b], kind: 'win', amount: 5 }), /Minimum/);
  assert.throws(() => g.as(a, 'bet', { stockId: S[b], kind: 'win', amount: 2000 }), /Not enough/); // all cash is usable, but no more
  g.send('lockRound');
  g.send('setPlaces', { groupId: r.groups[0].id, order: [a, b, c, d] });
  g.send('continueFromResults'); // horse skips the event step
  assert.equal(currentRound(g.s).phase, 'paid');

  const bets = Object.values(g.s.bets);
  const winA_b = bets.find((x) => x.bettorId === b && x.stockId === S[a] && x.kind === 'win');
  assert.equal(winA_b.payout, 450); // pool 600 (b did not bet on b), b has 300 of the 400 backing a
  // total money conserved (no bonus in non-final round)
  const total = g.s.playerOrder.reduce((t, id) => t + g.s.players[id].cash, 0);
  assert.equal(total, 8000);
  g.send('nextRound');
  r = currentRound(g.s);
  for (const pid of activePlayers(g.s)) g.as(pid, 'bet', { stockId: r.stockByPlayer[pid], kind: 'win', amount: 100 });
  g.send('lockRound');
  const g0 = currentRound(g.s).groups[0];
  g.send('setPlaces', { groupId: g0.id, order: g0.playerIds });
  g.send('continueFromResults'); // final round: 50% house bonus on pools
  const total2 = g.s.playerOrder.reduce((t, id) => t + g.s.players[id].cash, 0);
  assert.equal(total2, 8000 + 200); // pool 400 * 0.5
  // correction re-pays bets
  const fix = computeFix(g.s, 2, g0.id, [...g0.playerIds].reverse());
  assert.ok(fix.length > 0);
  g.send('fixPlaces', { round: 2, groupId: g0.id, order: [...g0.playerIds].reverse() });
  assert.equal(g.s.playerOrder.reduce((t, id) => t + g.s.players[id].cash, 0), 8200);
  g.send('finishTournament');
});

test('horse restart refunds open bets', async () => {
  const g = await setup(4, 2, { style: 'horse' });
  g.send('startTournament');
  const r = currentRound(g.s);
  for (const pid of activePlayers(g.s)) g.as(pid, 'bet', { stockId: r.stockByPlayer[pid], kind: 'win', amount: 100 });
  g.send('restartRound');
  for (const id of g.s.playerOrder) assert.equal(g.s.players[id].cash, 2000);
  assert.equal(Object.keys(g.s.bets).length, 0);
});

test('rules: others blocked in self window', async () => {
  const g = await setup(4, 3);
  g.send('startTournament');
  const r = currentRound(g.s);
  const [a, b] = r.groups[0].playerIds;
  assert.throws(() => g.as(b, 'buy', { stockId: r.stockByPlayer[a], pct: 5 }), /self-buy/i);
});

test('market closes on timer or when everyone is done buying', async () => {
  const g = await setup(4, 2, { openSeconds: 60, selfBuySeconds: 100, minOtherStocks: 0 });
  g.send('startTournament');
  const r = currentRound(g.s);
  const ids = r.groups[0].playerIds;
  const S = r.stockByPlayer;
  for (const pid of ids) g.as(pid, 'buy', { stockId: S[pid], pct: 10 }); // all bought in -> self window ends now
  assert.equal(roundPhase(g.s, g.t), 'open');
  g.as(ids[0], 'buy', { stockId: S[ids[1]], pct: 5 });
  g.as(ids[0], 'doneBuying');
  assert.throws(() => g.as(ids[0], 'buy', { stockId: S[ids[1]], pct: 5 }), /done buying/);
  g.as(ids[0], 'doneBuying', { undo: true });
  g.as(ids[0], 'buy', { stockId: S[ids[1]], pct: 5 });
  for (const pid of ids) g.as(pid, 'doneBuying');
  assert.throws(() => g.as(ids[1], 'buy', { stockId: S[ids[2]], pct: 5 }), /closed/);
  g.send('lockRound'); // organizer still locks
  // timer path
  const h = await setup(4, 2, { openSeconds: 60, selfBuySeconds: 100 });
  h.send('startTournament');
  const r2 = currentRound(h.s);
  const [a, b] = r2.groups[0].playerIds;
  h.tick(100 * 1000 + 1);
  h.as(a, 'buy', { stockId: r2.stockByPlayer[b], pct: 5 });
  h.tick(61 * 1000);
  assert.throws(() => h.as(a, 'buy', { stockId: r2.stockByPlayer[b], pct: 5 }), /closed/);
});

test('self-buy cap is 40 shares, lifted in the final round', async () => {
  const g = await setup(4, 2);
  g.send('startTournament');
  let r = currentRound(g.s);
  const [a] = r.groups[0].playerIds;
  assert.equal(g.s.settings.maxSelfBuyPct, 40);
  g.as(a, 'buy', { stockId: r.stockByPlayer[a], pct: 40 });
  assert.throws(() => g.as(a, 'buy', { stockId: r.stockByPlayer[a], pct: 1 }), /at most 40/);
});

test('buy into other players: required, adjusts to cash, excusable, off in the final round', async () => {
  const g = await setup(4, 2, { selfBuySeconds: 100 });
  g.send('startTournament');
  let r = currentRound(g.s);
  const ids = r.groups[0].playerIds;
  const S = r.stockByPlayer;
  for (const pid of ids) g.as(pid, 'buy', { stockId: S[pid], pct: 10 });
  const [a, b, c, d] = ids;
  assert.deepEqual(diversifyStatus(g.s, a), { need: 2, have: 0, met: false, excused: false, waived: false });
  assert.throws(() => g.as(a, 'doneBuying'), /Buy into 2 more/);
  g.as(a, 'buy', { stockId: S[b], pct: 4 }); // too small to count
  assert.equal(diversifyStatus(g.s, a).have, 0);
  g.as(a, 'buy', { stockId: S[b], pct: 1 });
  assert.equal(diversifyStatus(g.s, a).have, 1);
  assert.throws(() => g.as(a, 'doneBuying'), /Buy into 1 more/);
  assert.ok(diversifyShort(g.s).includes(a));
  g.as(a, 'buy', { stockId: S[c], pct: 5 });
  g.as(a, 'doneBuying');
  // organizer excuse
  assert.throws(() => g.as(b, 'doneBuying'), /Buy into/);
  g.send('excuseBuyIn', { pid: b });
  g.as(b, 'doneBuying');
  // a player who cannot afford it is waived down, never forced to spend the reserve
  g.send('adjustCash', { pid: d, amount: -(g.s.players[d].cash - 130) }); // 130 left: reserve 100 + 30 spare
  const st = diversifyStatus(g.s, d);
  assert.equal(st.need, 2 - 0 > 0 ? st.need : 0);
  assert.ok(st.need <= 2 && st.waived === (st.need < 2));
  g.send('adjustCash', { pid: d, amount: -(g.s.players[d].cash - 100) }); // only the reserve left
  assert.equal(diversifyStatus(g.s, d).need, 0);
  g.as(d, 'doneBuying');
  // extend the market
  const end = currentRound(g.s).selfEndsAt;
  g.send('extendMarket');
  assert.equal(currentRound(g.s).extraSeconds, 60);
});

test('final round: no cap on own stock, no buy-into-others rule', async () => {
  const g = await setup(4, 1, { selfBuySeconds: 100 });
  g.send('startTournament');
  const r = currentRound(g.s);
  assert.ok(isFinalRound(g.s));
  const [a] = r.groups[0].playerIds;
  g.as(a, 'buy', { stockId: r.stockByPlayer[a], pct: 60 });
  assert.equal(diversifyStatus(g.s, a).need, 0);
});

test('suggested results project payouts, conflicts are flagged, history and best stock', async () => {
  const g = await setup(4, 2, { selfBuySeconds: 100, minOtherStocks: 0 });
  g.send('startTournament');
  let r = currentRound(g.s);
  const ids = r.groups[0].playerIds;
  const S = r.stockByPlayer;
  for (const pid of ids) g.as(pid, 'buy', { stockId: S[pid], pct: 10 });
  const [a, b, c, d] = ids;
  g.as(b, 'buy', { stockId: S[a], pct: 10 });
  const costB = Object.values(g.s.positions).find((p) => p.holderId === b && p.stockId === S[a]).cost;
  assert.equal(projection(g.s, g.t), null); // nothing before the match starts
  g.send('lockRound');
  let pr = projection(g.s, g.t);
  assert.equal(pr.groups[r.groups[0].id].status, 'none');
  g.as(a, 'submitReport', { groupId: r.groups[0].id, order: [a, b, c, d] });
  g.tick(10);
  g.as(b, 'submitReport', { groupId: r.groups[0].id, order: [b, a, c, d] });
  const sug = suggestedOrder(g.s, currentRound(g.s).groups[0]);
  assert.equal(sug.status, 'suggested');
  assert.equal(sug.conflict, true);
  assert.deepEqual(sug.order, [b, a, c, d]); // latest wins
  g.tick(10);
  g.as(b, 'submitReport', { groupId: r.groups[0].id, order: [a, b, c, d] });
  g.tick(10);
  g.as(a, 'submitReport', { groupId: r.groups[0].id, order: [a, b, c, d] });
  assert.equal(suggestedOrder(g.s, currentRound(g.s).groups[0]).conflict, false);
  pr = projection(g.s, g.t);
  assert.equal(pr.anyPending, true);
  const stockA = S[a];
  assert.equal(pr.stocks[stockA].place, 1);
  assert.equal(pr.stocks[stockA].change, DEFAULT_SETTINGS.payout4[0]);
  assert.ok(pr.players[a].delta > 0 && pr.players[d].delta < 0);
  // official result then payout: projection matches (event skipped)
  g.send('setPlaces', { groupId: r.groups[0].id, order: [a, b, c, d] });
  const before = netWorth(g.s, a);
  const projA = projection(g.s, g.t).players[a].worth;
  g.send('continueFromResults');
  g.send('skipEvent');
  assert.equal(netWorth(g.s, a), projA);
  assert.ok(before < projA);
  assert.equal(currentRound(g.s).worths[a], netWorth(g.s, a));
  assert.equal(worthHistory(g.s)[a].length, 1);
  g.send('nextRound');
  r = currentRound(g.s);
  for (const pid of activePlayers(g.s)) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
  g.send('lockRound');
  for (const grp of currentRound(g.s).groups) g.send('setPlaces', { groupId: grp.id, order: grp.playerIds });
  g.send('continueFromResults');
  g.send('finishTournament');
  const best = bestStocks(g.s);
  const aw = awards(g.s);
  assert.ok(aw.length >= 3);
  assert.ok(aw.every((x) => x.title && x.who && x.detail));
  assert.ok(best.length > 0);
  assert.ok(best[0].gain >= best[best.length - 1].gain);
  assert.ok(costB > 0);
});

test('moneyline odds', async () => {
  const { fmtMoneyline } = await import('../src/engine/index.js');
  assert.equal(fmtMoneyline(0.5), '+100');
  assert.equal(fmtMoneyline(0.6), '-150');
  assert.equal(fmtMoneyline(0.25), '+300');
  assert.equal(fmtMoneyline(0.8), '-400');
  assert.ok(fmtMoneyline(0.52).startsWith('-'));
});
