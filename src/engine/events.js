// Market events: one random event per round, after results, before payout.
import { shuffle } from './util.js';

export const EVENT_KINDS = [
  'hotMachine',
  'stickyFlippers',
  'upsetDay',
  'winnerTakesAll',
  'boom',
  'correction',
  'hotHand',
];

export function drawEvent(s, rng = Math.random, avoidKind = null) {
  const r = s.rounds[s.round - 1];
  const sz = s.settings.eventSizes;
  const machinesInPlay = r.groups.map((g) => g.machineId);
  const prev = s.rounds[s.round - 2];
  const winners = prev
    ? prev.groups.map((g) => g.places && g.places[0]).filter(Boolean)
    : [];
  const activeWinners = winners.filter((pid) => r.stockByPlayer[pid]);
  let kinds = EVENT_KINDS.filter((k) => k !== 'hotHand' || activeWinners.length > 0);
  if (avoidKind && kinds.length > 1) kinds = kinds.filter((k) => k !== avoidKind);
  const kind = shuffle(kinds, rng)[0];
  const ev = { kind, status: 'draft' };
  switch (kind) {
    case 'hotMachine':
      ev.machineId = shuffle(machinesInPlay, rng)[0];
      ev.delta = sz.machine;
      break;
    case 'stickyFlippers':
      ev.machineId = shuffle(machinesInPlay, rng)[0];
      ev.delta = -sz.machine;
      break;
    case 'upsetDay':
      ev.delta = sz.upset;
      break;
    case 'winnerTakesAll':
      ev.delta = sz.winnerTakesAll;
      break;
    case 'boom':
      ev.delta = sz.market;
      break;
    case 'correction':
      ev.delta = -sz.market;
      break;
    case 'hotHand':
      ev.winners = activeWinners;
      ev.delta = sz.hotHand;
      break;
  }
  return ev;
}

// Percentage-point change added to a stock's placement modifier.
export function eventDelta(ev, stock, place, size) {
  if (!ev || ev.status === 'skipped') return 0;
  switch (ev.kind) {
    case 'hotMachine':
    case 'stickyFlippers':
      return stock.machineId === ev.machineId ? ev.delta : 0;
    case 'upsetDay':
      return size > 1 && place === size ? ev.delta : 0;
    case 'winnerTakesAll':
      return place === 1 ? ev.delta : 0;
    case 'boom':
    case 'correction':
      return ev.delta;
    case 'hotHand':
      return ev.winners.includes(stock.playerId) ? ev.delta : 0;
    default:
      return 0;
  }
}

export function describeEvent(s, ev) {
  const sgn = (n) => (n > 0 ? `+${n}` : `${n}`);
  const mname = ev.machineId && s.machines[ev.machineId] ? s.machines[ev.machineId].name : '';
  switch (ev.kind) {
    case 'hotMachine':
      return { name: 'Hot machine', blurb: `Stocks of players on ${mname} get ${sgn(ev.delta)}%.` };
    case 'stickyFlippers':
      return { name: 'Sticky flippers', blurb: `Stocks of players on ${mname} get ${sgn(ev.delta)}%.` };
    case 'upsetDay':
      return { name: 'Upset day', blurb: `Last place in every group gets ${sgn(ev.delta)}%.` };
    case 'winnerTakesAll':
      return { name: 'Winner takes all', blurb: `First place in every group gets ${sgn(ev.delta)}%.` };
    case 'boom':
      return { name: 'Bull run', blurb: `Every stock gets ${sgn(ev.delta)}%.` };
    case 'correction':
      return { name: 'Market correction', blurb: `Every stock gets ${sgn(ev.delta)}%.` };
    case 'hotHand':
      return {
        name: 'Hot hand',
        blurb: `Last round's group winners get ${sgn(ev.delta)}% on their stock this round.`,
      };
    default:
      return { name: ev.kind, blurb: '' };
  }
}
