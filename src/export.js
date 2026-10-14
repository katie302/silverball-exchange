import { leaderboard } from './engine/index.js';

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportCsv(s) {
  const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['Rank', 'Player', 'Cash', 'Net worth', 'Out'].join(',')];
  for (const r of leaderboard(s)) rows.push([r.rank, q(r.name), r.cash, r.worth, r.eliminated ? 'yes' : ''].join(','));
  download('silverball-standings.csv', rows.join('\n'), 'text/csv');
}

export function exportJson(s) {
  const clean = structuredClone(s);
  for (const p of Object.values(clean.players)) delete p.pinHash;
  download('silverball-history.json', JSON.stringify(clean, null, 2), 'application/json');
}
