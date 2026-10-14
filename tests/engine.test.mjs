import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reduce, initialState, quote, groupSizes, hashPin, netWorth, roundPhase, checkBuy,
  leaderboard, activePlayers, currentRound, heldPositions, computeFix, DEFAULT_SETTINGS,
} from '../src/engine/index.js';

const ORG = 'org@example.com';

test('pricing is marginal by tier', () => {
  const t = DEFAULT_SETTINGS.tiers;
  assert.equal(quote(0, 35, t), 370);
  assert.equal(quote(0, 100, t), 1425);
  assert.equal(quote(42, 20, t), 8 * 12 + 12 * 15);
});

test('group sizes', () => {
  assert.deepEqual(groupSizes(14), [4, 4, 3, 3]);
  assert.deepEqual(groupSizes(5), [3, 2]);
  assert.deepEqual(groupSizes(8), [4, 4]);
  assert.deepEqual(groupSizes(9), [3, 3, 3]);
  assert.deepEqual(groupSizes(2), [2]);
});

async function setup(n, rounds = 4) {
  let s = initialState();
  let t = 1000;
  const send = (type, extra = {}) => { s = reduce(s, { type, actor: ORG, now: t, ...extra }); };
  send('claimOrganizer');
  send('updateSettings', { patch: { rounds } });
  send('addPlayers', { names: Array.from({ length: n }, (_, i) => `P${i + 1}`) });
  send('addMachines', { names: Array.from({ length: 12 }, (_, i) => `M${i + 1}`) });
  const pins = {};
  for (const id of s.playerOrder) {
    pins[id] = await hashPin('1234', id);
    s = reduce(s, { type: 'claimPlayer', pid: id, pinHash: pins[id], now: t });
  }
  const as = (pid, type, extra = {}) => { s = reduce(s, { type, pid, pinHash: pins[pid], now: t, ...extra }); };
  return { get s() { return s; }, send, as, pins, tick: (ms) => { t += ms; }, get t() { return t; } };
}

test('full tournament invariants', async () => {
  const g = await setup(14, 4);
  g.send('startTournament');
  const seen = {};
  for (let round = 1; round <= 4; round++) {
    const s0 = g.s;
    assert.equal(s0.round, round);
    const r = currentRound(s0);
    for (const grp of r.groups) {
      for (let i = 0; i < grp.playerIds.length; i++)
        for (let j = i + 1; j < grp.playerIds.length; j++) {
          const k = [grp.playerIds[i], grp.playerIds[j]].sort().join('|');
          seen[k] = (seen[k] || 0) + 1;
        }
    }
    // self buys
    for (const pid of activePlayers(s0)) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
    assert.equal(roundPhase(g.s, g.t), 'open'); // everyone bought in
    // random others
    for (const pid of activePlayers(g.s)) {
      const other = Object.values(g.s.stocks).filter((x) => x.round === round && x.playerId !== pid);
      const stk = other[Math.floor(Math.random() * other.length)];
      const c = checkBuy(g.s, pid, stk.id, 15, g.t);
      if (c.ok) g.as(pid, 'buy', { stockId: stk.id, pct: 15 });
    }
    g.send('lockRound');
    for (const grp of currentRound(g.s).groups) {
      g.as(grp.playerIds[0], 'submitReport', { groupId: grp.id, order: grp.playerIds });
      g.send('approveReport', { groupId: grp.id, reportId: g.s.rounds[round - 1].groups.find((x) => x.id === grp.id).reports[0].id });
    }
    g.send('continueFromResults');
    if (round < 4) {
      assert.equal(currentRound(g.s).phase, 'event');
      g.send('rerollEvent');
      g.send(Math.random() < 0.5 ? 'applyEvent' : 'skipEvent');
    }
    assert.equal(currentRound(g.s).phase, 'paid');
    for (const stock of Object.values(g.s.stocks)) assert.ok(stock.soldPct <= 100);
    for (const p of Object.values(g.s.players)) assert.ok(p.cash >= 0, 'cash never negative');
    if (round < 4) g.send('nextRound'); else g.send('finishTournament');
  }
  assert.equal(g.s.status, 'complete');
  const lb = leaderboard(g.s);
  assert.equal(lb[0].rank, 1);
  const repeats = Object.values(seen).filter((c) => c > 1).length;
  assert.ok(repeats < 40, `repeat pairings ${repeats}`);
});

test('fix places adjusts sold cash on request', async () => {
  const g = await setup(4, 3);
  g.send('startTournament');
  const r = currentRound(g.s);
  const [a, b, c, d] = r.groups[0].playerIds;
  for (const pid of [a, b, c, d]) g.as(pid, 'buy', { stockId: r.stockByPlayer[pid], pct: 10 });
  g.as(b, 'buy', { stockId: r.stockByPlayer[a], pct: 20 });
  g.send('lockRound');
  g.send('setPlaces', { groupId: r.groups[0].id, order: [a, b, c, d] });
  g.send('continueFromResults');
  g.send('skipEvent');
  const before = netWorth(g.s, b);
  g.as(b, 'sellAllResolved');
  const cashSold = g.s.players[b].cash;
  g.send('fixPlaces', { round: 1, groupId: r.groups[0].id, order: [d, c, b, a], policy: 'adjust' });
  assert.notEqual(g.s.players[b].cash, cashSold);
  assert.equal(heldPositions(g.s, b).length, 0);
});

test('rules: reserve, others blocked in self window, elimination floor', async () => {
  const g = await setup(4, 3);
  g.send('startTournament');
  const r = currentRound(g.s);
  const [a, b] = r.groups[0].playerIds;
  assert.throws(() => g.as(b, 'buy', { stockId: r.stockByPlayer[a], pct: 5 }), /self-buy/i);
  g.as(a, 'buy', { stockId: r.stockByPlayer[a], pct: 10 });
  assert.throws(() => g.as(a, 'buy', { stockId: r.stockByPlayer[a], pct: 100 }), /./);
});
