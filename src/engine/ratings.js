// One skill rating per player, fed by three sources:
//   1. an IFPA / Matchplay rating (if the player gave an IFPA # and "use IFPA" is on)
//   2. history from past tournaments (carried over via saved profiles)
//   3. this tournament's results (Elo-style update after every paid-out match)
// Win chances for a group come from comparing the ratings in it (Plackett-Luce).

export const BASE_RATING = 1500;
export const K_FACTOR = 24;
const LN10_400 = Math.LN10 / 400;
const clamp = (v) => Math.max(1000, Math.min(2200, v));

export function startRating(s, pid) {
  const p = s.players[pid];
  const ifpa = s.settings.useIfpa && typeof p.ifpaRating === 'number' ? clamp(p.ifpaRating) : null;
  const hist = typeof p.histRating === 'number' ? p.histRating : null;
  if (hist != null && ifpa != null) {
    const w = Math.min(p.histGames || 0, 10) / 10; // more history, less weight on IFPA
    return w * hist + (1 - w) * ifpa;
  }
  return hist ?? ifpa ?? BASE_RATING;
}

// Replays every paid match, in order. `startOverride` lets callers start from other values.
export function ratingMap(s, startOverride = null) {
  const out = {};
  for (const id of s.playerOrder) {
    const o = startOverride && startOverride[id];
    out[id] = {
      rating: o ? o.rating : startRating(s, id),
      games: o ? o.games : s.players[id].histGames || 0,
      played: 0,
    };
  }
  for (const r of s.rounds) {
    for (const g of r.groups) {
      if (!g.places || !g.paid) continue;
      const ids = g.places;
      const before = Object.fromEntries(ids.map((id) => [id, out[id] ? out[id].rating : BASE_RATING]));
      ids.forEach((a, ia) => {
        if (!out[a]) return;
        let delta = 0;
        ids.forEach((b, ib) => {
          if (a === b) return;
          const actual = ia < ib ? 1 : 0;
          const exp = 1 / (1 + Math.pow(10, (before[b] - before[a]) / 400));
          delta += actual - exp;
        });
        out[a].rating += (K_FACTOR * delta) / Math.max(1, ids.length - 1);
        out[a].games += 1;
        out[a].played += 1;
      });
    }
  }
  return out;
}

export const ratingOf = (s, pid) => ratingMap(s)[pid];

// P(player finishes in each position) for a group, from ratings.
export function placeProbs(ratings) {
  const n = ratings.length;
  const w = ratings.map((r) => Math.exp(r * LN10_400));
  const pos = ratings.map(() => new Array(n).fill(0));
  const idx = ratings.map((_, i) => i);
  const walk = (remaining, order, prob) => {
    if (!remaining.length) {
      order.forEach((pl, k) => (pos[pl][k] += prob));
      return;
    }
    const tot = remaining.reduce((a, i) => a + w[i], 0);
    for (const i of remaining) {
      walk(remaining.filter((x) => x !== i), [...order, i], prob * (w[i] / tot));
    }
  };
  walk(idx, [], 1);
  return pos.map((row) => ({
    win: row[0],
    top2: row.slice(0, 2).reduce((a, b) => a + b, 0),
    top3: row.slice(0, 3).reduce((a, b) => a + b, 0),
  }));
}

// { playerId: {win, top2, top3, rating, games} } for one group.
export function groupOdds(s, group, map = ratingMap(s)) {
  const ids = group.playerIds;
  const probs = placeProbs(ids.map((id) => map[id].rating));
  const out = {};
  ids.forEach((id, i) => {
    out[id] = { ...probs[i], rating: Math.round(map[id].rating), games: map[id].games };
  });
  return out;
}

export function fmtPct(p) {
  return `${Math.round(p * 100)}%`;
}

// American moneyline from a probability: favourites -150, underdogs +300, even +100.
export function fmtMoneyline(p) {
  const q = Math.min(0.99, Math.max(0.01, p));
  let v = q >= 0.5 ? -(100 * q) / (1 - q) : (100 * (1 - q)) / q;
  const step = Math.abs(v) >= 1000 ? 50 : 5;
  v = Math.round(v / step) * step;
  if (v > -100 && v < 100) v = q >= 0.5 ? -100 : 100;
  if (v === -100) v = 100; // an exact coin flip reads +100
  return v > 0 ? `+${v}` : `${v}`;
}

// Fair odds in "N-to-1" form from a probability.
export function fmtOdds(p) {
  const q = Math.min(0.99, Math.max(0.01, p));
  const x = (1 - q) / q;
  if (x < 0.95) {
    const inv = 1 / x;
    return `1-to-${inv < 10 ? inv.toFixed(1).replace(/\.0$/, '') : Math.round(inv)}`;
  }
  if (x < 1.05) return 'even';
  return `${x < 10 ? x.toFixed(1).replace(/\.0$/, '') : Math.round(x)}-to-1`;
}

// "Based on N matches" label.
export const confidence = (games) =>
  games === 0 ? 'no match data yet' : `based on ${games} match${games === 1 ? '' : 'es'}`;

// ---- profiles: ratings that carry over between tournaments ----
export const profileKey = (p) => (p.ifpaId ? `ifpa:${p.ifpaId}` : `name:${p.name.trim().toLowerCase()}`);
const findProfile = (profiles, p) =>
  (p.ifpaId && profiles[`ifpa:${p.ifpaId}`]) || profiles[`name:${p.name.trim().toLowerCase()}`] || null;

// Ratings to load into a new tournament's players from saved profiles.
export function seedFromProfiles(s, profiles) {
  const out = {};
  for (const id of s.playerOrder) {
    const pr = findProfile(profiles || {}, s.players[id]);
    if (pr) out[id] = { rating: pr.rating, games: pr.games };
  }
  return out;
}

// Save this tournament's final ratings into the profiles (players who played at least one match).
export function saveToProfiles(s, profiles) {
  const out = structuredClone(profiles || {});
  const map = ratingMap(s);
  for (const id of s.playerOrder) {
    const p = s.players[id];
    if (!map[id].played) continue;
    const key = profileKey(p);
    out[key] = {
      name: p.name,
      ifpaId: p.ifpaId || null,
      rating: Math.round(map[id].rating * 10) / 10,
      games: map[id].games,
      ...(out[key]?.inactive ? { inactive: true } : {}),
    };
  }
  return out;
}

// Fold an exported past tournament into the profiles by replaying its matches.
export function importTournament(imported, profiles) {
  const existing = profiles || {};
  const startOverride = {};
  for (const id of imported.playerOrder) {
    const pr = findProfile(existing, imported.players[id]);
    if (pr) startOverride[id] = { rating: pr.rating, games: pr.games };
  }
  const map = ratingMap(
    { ...imported, settings: { ...imported.settings, useIfpa: false } },
    startOverride
  );
  const out = structuredClone(existing);
  let n = 0;
  for (const id of imported.playerOrder) {
    const p = imported.players[id];
    if (!map[id] || !map[id].played) continue;
    const key = profileKey(p);
    out[key] = {
      name: p.name,
      ifpaId: p.ifpaId || null,
      rating: Math.round(map[id].rating * 10) / 10,
      games: map[id].games,
      ...(out[key]?.inactive ? { inactive: true } : {}),
    };
    n++;
  }
  return { profiles: out, count: n };
}
