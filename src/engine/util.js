// Pure helpers: pricing, grouping, hashing. No state in here.

export function priceAtPoint(i, tiers) {
  for (const t of tiers) if (i < t.upTo) return t.price;
  return tiers[tiers.length - 1].price;
}

// Cost of buying `pct` percentage points when `soldPct` is already sold.
// Each percentage point is priced by the tier it falls in (marginal pricing).
export function quote(soldPct, pct, tiers) {
  let c = 0;
  for (let i = soldPct; i < soldPct + pct; i++) c += priceAtPoint(i, tiers);
  return c;
}

export const minSelfCost = (settings) => quote(0, settings.minSelfBuyPct, settings.tiers);

// k = ceil(n/4) groups, as even as possible (14 -> 4,4,3,3 ; 5 -> 3,2).
export function groupSizes(n) {
  if (n <= 0) return [];
  if (n < 2) return [n];
  const k = Math.ceil(n / 4);
  const base = Math.floor(n / k);
  const r = n % k;
  const out = [];
  for (let i = 0; i < k; i++) out.push(i < r ? base + 1 : base);
  return out;
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// Random groups that avoid repeat opponents. Tries many shuffles and keeps the
// one with the lowest repeat score; recency breaks ties (least recently paired wins).
export function makeGroups(ids, pairCounts = {}, pairLast = {}, rng = Math.random, attempts = 400) {
  const sizes = groupSizes(ids.length);
  if (ids.length < 2) return [ids.slice()];
  let best = null;
  let bestScore = Infinity;
  for (let t = 0; t < attempts; t++) {
    const order = shuffle(ids, rng);
    const groups = [];
    let at = 0;
    for (const sz of sizes) {
      groups.push(order.slice(at, at + sz));
      at += sz;
    }
    let score = 0;
    for (const g of groups) {
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          const k = pairKey(g[i], g[j]);
          const c = pairCounts[k] || 0;
          score += c * c * 1000 + (pairLast[k] || 0);
        }
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = groups;
      if (score === 0) break;
    }
  }
  return best;
}

export async function hashPin(pin, pid) {
  const data = new TextEncoder().encode(`${pin}:${pid}`);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export const money = (n) => {
  const v = Math.round(n);
  return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US');
};

export const ordinal = (n) => ['', '1st', '2nd', '3rd', '4th'][n] || `${n}th`;

export function payoutFor(settings, size) {
  if (size >= 4) return settings.payout4;
  if (size === 3) return settings.payout3;
  if (size === 2) return settings.payout2;
  return [0];
}

// Multiplier applied to cost for a stock whose owner finished `place` of `size`.
export function factorFor(settings, size, place, mult, eventDelta) {
  const base = payoutFor(settings, size)[place - 1] ?? 0;
  return Math.max(0, 1 + ((base + eventDelta) / 100) * mult);
}
