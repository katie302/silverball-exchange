import { factorFor } from './util.js';
import { groupPayouts, betsList } from './horse.js';

// What a result correction would change. `places` is an array of player ids, 1st first.
// Returns a list of {positionId, holderId, stockId, owner, status, oldValue, newValue, delta}.
export function computeFix(s, roundN, groupId, places) {
  const r = s.rounds[roundN - 1];
  const g = r.groups.find((x) => x.id === groupId);
  const size = g.playerIds.length;
  const changes = [];
  if (s.settings.style === 'horse') {
    const pay = groupPayouts(s, g, places, r.bonusPct || 0);
    for (const b of betsList(s)) {
      if (b.groupId !== groupId) continue;
      const nv = pay[b.id] ?? 0;
      if (nv === b.payout) continue;
      changes.push({
        positionId: b.id, holderId: b.bettorId, stockId: b.stockId,
        owner: s.stocks[b.stockId].playerId, status: 'sold', oldValue: b.payout, newValue: nv, delta: nv - b.payout,
      });
    }
    return changes;
  }
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
        positionId: pos.id, holderId: pos.holderId, stockId: stock.id, owner: stock.playerId,
        status: pos.status, oldValue, newValue, delta: newValue - oldValue,
      });
    }
  }
  return changes;
}
