// Vercel serverless function: looks up Matchplay ratings by IFPA number.
// Needs an environment variable MATCHPLAY_TOKEN (Matchplay > account settings > API tokens).
// The Matchplay response format isn't documented in detail, so this reads it defensively.
// If anything fails, the app lets the organizer type ratings in by hand.
export default async function handler(req, res) {
  const token = process.env.MATCHPLAY_TOKEN;
  if (!token) return res.status(501).json({ error: 'MATCHPLAY_TOKEN is not set on the server' });
  const ids = String(req.query.ids || '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => /^\d+$/.test(x))
    .slice(0, 25);
  if (!ids.length) return res.status(400).json({ error: 'No valid IFPA numbers' });
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'SilverballExchange/2.0 (tournament odds; contact: organizer)',
  };
  try {
    // Try the dedicated IFPA endpoint first, then the general ratings endpoint.
    // Matchplay asks for requests to go to api.matchplay.events (the docs still show app.).
    const q = `ifpaIds=${ids.join(',')}`;
    const urls = [
      `https://api.matchplay.events/api/ratings/ifpa?${q}`,
      `https://api.matchplay.events/api/ratings?${q}`,
      `https://api.matchplay.events/ratings/ifpa?${q}`,
      `https://api.matchplay.events/ratings?${q}`,
    ];
    let r = null;
    let lastNote = '';
    for (const u of urls) {
      r = await fetch(u, { headers });
      if (r.ok) break;
      const body = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
      lastNote = `Matchplay answered ${r.status}${body ? ': ' + body : ''}`;
    }
    if (!r || !r.ok) return res.status(502).json({ error: lastNote || 'Matchplay did not answer' });
    const json = await r.json();
    const list = Array.isArray(json) ? json : json.data || json.ratings || [];
    const ratings = {};
    for (const it of list) {
      const id = String(it.ifpaId ?? it.ifpa_id ?? it.ifpa?.id ?? it.id ?? '');
      const raw = it.rating?.rating ?? it.rating?.value ?? it.rating ?? it.ratingValue ?? it.value;
      const n = Number(raw);
      if (id && ids.includes(id) && isFinite(n)) ratings[id] = n;
    }
    res.status(200).json({ ratings, found: Object.keys(ratings).length, asked: ids.length });
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
