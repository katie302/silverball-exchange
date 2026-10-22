import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useGame, useNow } from './game.jsx';
import { Btn, Card, Chip, Input, Label, OrderPicker, Sheet, cx, fmtClock, orderComplete } from './ui.jsx';
import {
  KIND_LABEL, PHASE_LABELS, activePlayers, bettorsOn, checkBet, checkBuy, checkSell, confidence,
  currentRound, describeEvent, estimateReturn, fmtMoneyline, fmtOdds, fmtPct, groupOdds, groupOf, hashPin, heldPct,
  heldPositions, holdersOf, isFinalRound, kindsForSize, leaderboard, liveOdds, maxBet, maxBuyable,
  doneCount, marketClosed, minSelfCost, money, netWorth, openEndsAt, ordinal, payoutFor, poolOf, priceAtPoint, ratingMap, roundPhase,
  diversifyStatus, projection, worthHistory, bestStocks, countingFinishers, awards,
} from './engine/index.js';

const SESSION_KEY = 'silverball-session';
const loadSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
};
const saveSession = (v) => {
  try {
    if (v) localStorage.setItem(SESSION_KEY, JSON.stringify(v));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
};
export { saveSession };

const Shell = ({ children }) => <div className="mx-auto min-h-screen max-w-md px-4 py-8">{children}</div>;

// ---------- sign in / claim ----------
function Claim({ onDone }) {
  const { state, dispatch, setToast } = useGame();
  const toast = (msg) => setToast({ msg, id: Date.now() });
  const [pid, setPid] = useState(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [ifpa, setIfpa] = useState('');
  const p = pid && state.players[pid];
  const names = state.playerOrder.filter((id) => !state.players[id].withdrawn);

  if (!names.length)
    return (
      <Shell>
        <Card>The organizer hasn't added any players yet. Check back in a minute.</Card>
      </Shell>
    );

  if (!p)
    return (
      <Shell>
        <h1 className="font-display text-2xl font-extrabold">Who are you?</h1>
        <p className="mb-4 text-sm text-muted">Tap your name. Greyed names are taken; tap one to log back in with your PIN.</p>
        <div className="grid grid-cols-2 gap-2">
          {names.map((id) => (
            <button
              key={id}
              onClick={() => setPid(id)}
              className={cx(
                'rounded-xl border px-3 py-3 text-left text-sm font-bold',
                state.players[id].claimed ? 'border-line text-dim' : 'border-pink text-ivory'
              )}
            >
              {state.players[id].name}
              {state.players[id].claimed && <div className="font-mono text-[10px] font-normal">log in</div>}
            </button>
          ))}
        </div>
      </Shell>
    );

  const isNew = !p.claimed;
  const go = async () => {
    if (!/^\d{4,8}$/.test(pin)) return toast('PIN must be 4-8 digits');
    const h = await hashPin(pin, pid);
    if (isNew) {
      if (pin !== pin2) return toast('PINs do not match');
      const ok = await dispatch({ type: 'claimPlayer', pid, pinHash: h, ifpaId: ifpa });
      if (!ok) return;
    } else if (h !== p.pinHash) return toast('Wrong PIN');
    const sess = { pid, pinHash: h };
    saveSession(sess);
    onDone(sess);
  };

  return (
    <Shell>
      <button className="mb-3 text-sm text-dim" onClick={() => setPid(null)}>← Back</button>
      <h1 className="font-display text-2xl font-extrabold">{isNew ? `Hi ${p.name}` : `Welcome back, ${p.name}`}</h1>
      <p className="mb-4 text-sm text-muted">
        {isNew ? 'Pick a PIN (4-8 digits). You will need it if you switch phones.' : 'Enter your PIN.'}
      </p>
      <div className="space-y-2">
        <Input type="password" inputMode="numeric" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
        {isNew && (
          <>
            <Input type="password" inputMode="numeric" placeholder="Repeat PIN" value={pin2} onChange={(e) => setPin2(e.target.value)} />
            <Input inputMode="numeric" placeholder="IFPA # (optional, helps set odds)" value={ifpa} onChange={(e) => setIfpa(e.target.value)} />
          </>
        )}
        <Btn onClick={go} className="w-full">{isNew ? 'Claim my name' : 'Log in'}</Btn>
      </div>
    </Shell>
  );
}

// ---------- odds display mode (per device): "odds" = 3-to-1, "pct" = 25% ----------
let oddsMode = 'ml';
try { const v = localStorage.getItem('sbx-odds-mode'); oddsMode = v === 'pct' ? 'pct' : v === 'odds' ? 'odds' : 'ml'; } catch { /* no storage */ }
const oddsSubs = new Set();
const subOdds = (f) => { oddsSubs.add(f); return () => oddsSubs.delete(f); };
function useOddsFmt() {
  const mode = useSyncExternalStore(subOdds, () => oddsMode);
  return mode === 'pct' ? fmtPct : mode === 'odds' ? fmtOdds : fmtMoneyline;
}
function OddsToggle() {
  const mode = useSyncExternalStore(subOdds, () => oddsMode);
  const set = (m) => {
    oddsMode = m;
    try { localStorage.setItem('sbx-odds-mode', m); } catch { /* ignore */ }
    oddsSubs.forEach((f) => f());
  };
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line font-mono text-[11px]" role="group" aria-label="Show chances as">
      {[['ml', '+300'], ['odds', '3-to-1'], ['pct', '25%']].map(([m, label]) => (
        <button key={m} onClick={() => set(m)} className={cx('px-2 py-1', mode === m ? 'bg-pink text-ink' : 'text-muted')}>{label}</button>
      ))}
    </div>
  );
}

function MyIfpa({ me }) {
  const { state, dispatch } = useGame();
  const cur = state.players[me.pid].ifpaId || '';
  const [v, setV] = useState(cur);
  return (
    <Card>
      <Label>Your IFPA # (optional)</Label>
      <div className="flex gap-2">
        <Input inputMode="numeric" placeholder="e.g. 12345" value={v} onChange={(e) => setV(e.target.value)} />
        <Btn small kind="ghost" disabled={v.replace(/\D/g, '') === cur} onClick={() => dispatch({ type: 'setIfpa', pid: me.pid, pinHash: me.pinHash, ifpaId: v })}>Save</Btn>
      </div>
      <p className="mt-1 text-xs text-dim">Helps set your odds. Leave blank to skip.</p>
    </Card>
  );
}

// ---------- shared bits ----------
function OddsLine({ odds, horse }) {
  const fmt = useOddsFmt();
  if (!odds) return null;
  return (
    <span className="font-mono text-[11px] text-dim">
      {horse ? `line ${fmt(odds.win)}` : `${fmt === fmtPct ? 'chance to win' : 'win odds'} ${fmt(odds.win)}`} · {confidence(odds.games)}
    </span>
  );
}

// Favourite in a group by win odds; null when odds are off or it's a toss-up.
function topPickOf(state, group, map) {
  if (!state.settings.showOdds) return null;
  const odds = groupOdds(state, group, map);
  const ranked = group.playerIds.map((id) => ({ id, p: odds[id].win })).sort((a, b) => b.p - a.p);
  if (ranked.length < 2 || ranked[0].p - ranked[1].p < 0.02) return null;
  return ranked[0];
}

// Compact "who's in" line shown right on the market row.
function Backers({ stock, horse }) {
  const { state } = useGame();
  const items = horse
    ? bettorsOn(state, stock.id).map((b) => `${state.players[b.bettorId].name} ${money(b.amount)} ${KIND_LABEL[b.kind].toLowerCase()}`)
    : holdersOf(state, stock.id).map((h) => `${state.players[h.pid].name} ${h.pct === 1 ? '1 share' : h.pct + ' shares'}`);
  return (
    <div className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-muted">
      {items.length
        ? items.slice(0, 3).join(' · ') + (items.length > 3 ? ` · +${items.length - 3} more` : '')
        : horse ? 'No bets yet' : 'No owners yet'}
    </div>
  );
}

function Holders({ stock, horse }) {
  const { state } = useGame();
  if (horse) {
    const bets = bettorsOn(state, stock.id);
    if (!bets.length) return <div className="text-sm text-dim">No bets yet.</div>;
    return (
      <div className="space-y-1">
        {bets.map((b) => (
          <div key={b.id} className="flex justify-between text-sm">
            <span>{state.players[b.bettorId].name} <span className="text-dim">· {KIND_LABEL[b.kind]}</span></span>
            <span className="font-mono">{money(b.amount)}{b.status === 'paid' && ` → ${money(b.payout)}`}</span>
          </div>
        ))}
      </div>
    );
  }
  const hs = holdersOf(state, stock.id);
  if (!hs.length) return <div className="text-sm text-dim">Nobody owns any yet.</div>;
  return (
    <div className="space-y-1">
      {hs.map((h) => (
        <div key={h.pid} className="flex justify-between text-sm">
          <span>{state.players[h.pid].name}</span>
          <span className="font-mono">{h.pct === 1 ? '1 share' : h.pct + ' shares'} · {money(h.cost)}{stock.status === 'resolved' && ` → ${money(h.value)}`}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- small helpers ----------
const sh = (n) => `${n} share${n === 1 ? '' : 's'}`;
const signed = (n) => (n >= 0 ? '+' : '') + money(n);
const absPct = (n) => `${Math.abs(n)}%`;
const COLORS = ['#F25C9F', '#4FD8BE', '#FF9F5A', '#7AA2FF', '#E8D44D', '#B28DFF'];

function Arrow({ n }) {
  const pl = (k) => (k === 1 ? 'place' : 'places');
  if (n > 0) return <span className="font-mono text-[11px] font-bold text-mint">▲{n} {pl(n)}</span>;
  if (n < 0) return <span className="font-mono text-[11px] font-bold text-loss">▼{-n} {pl(-n)}</span>;
  return <span className="font-mono text-xs text-dim">–</span>;
}

// "Pending / Result in / Conflicting" tag for a group's result.
function ResultTag({ info }) {
  if (!info || info.status === 'none') return <Chip tone="amber">match in progress</Chip>;
  if (info.status === 'official') return <Chip tone="mint">result in</Chip>;
  return info.conflict ? <Chip tone="pink">conflicting reports</Chip> : <Chip tone="amber">pending result</Chip>;
}

function mathStocks(stock, pos) {
  const ev = stock.eventDelta || 0;
  const base = `${stock.mod < 0 ? '−' : ''}${absPct(stock.mod)}`;
  const inner = ev ? `${base} ${ev > 0 ? '+' : '−'} ${absPct(ev)} event` : base;
  const mult = stock.mult && stock.mult !== 1 ? ` × ${stock.mult}` : '';
  return `${money(pos.cost)} × (1 + (${inner})${mult}) = ${money(pos.soldValue)}`;
}

function mathBet(state, b) {
  const r = state.rounds[b.round - 1];
  const g = r && r.groups.find((x) => x.id === b.groupId);
  if (!g || !g.places) return '';
  const same = Object.values(state.bets || {}).filter((x) => x.groupId === b.groupId && x.kind === b.kind);
  const pool = same.reduce((a, x) => a + x.amount, 0);
  const counting = countingFinishers(b.kind, g.places);
  const backedBy = {};
  for (const x of same) {
    const o = state.stocks[x.stockId].playerId;
    backedBy[o] = (backedBy[o] || 0) + x.amount;
  }
  const live = counting.filter((pid) => backedBy[pid] > 0);
  const owner = state.stocks[b.stockId].playerId;
  if (!live.length) return `Nobody backed a finisher, so ${KIND_LABEL[b.kind].toLowerCase()} bets were refunded.`;
  if (!live.includes(owner)) return `Your pick did not finish in the top ${counting.length}, so this bet paid $0.`;
  const bonus = r.bonusPct || 0;
  const share = (pool * (1 + bonus / 100)) / live.length;
  return `Pool ${money(pool)}${bonus ? ` + ${bonus}% house bonus` : ''} ÷ ${live.length} winner${live.length === 1 ? '' : 's'} = ${money(share)}. Your ${money(b.amount)} was ${Math.round((b.amount / backedBy[owner]) * 100)}% of the money on this runner → ${money(b.payout)}.`;
}

// ---------- stock sheet (stocks style) ----------
function StockSheet({ stock, me, onClose }) {
  const { state, dispatch } = useGame();
  const now = useNow();
  const owner = state.players[stock.playerId];
  const own = stock.playerId === me.pid;
  const group = groupOf(state, stock.playerId);
  const held = heldPct(state, me.pid, stock.id);
  const [pct, setPct] = useState(own ? Math.max(1, state.settings.minSelfBuyPct - held) : 5);
  const max = maxBuyable(state, me.pid, stock.id, now);
  const chk = checkBuy(state, me.pid, stock.id, pct, now);
  const phase = roundPhase(state, now);
  const trading = stock.status === 'open' && (phase === 'open' || (phase === 'self' && own)) && !marketClosed(state, now) && !state.rounds[state.round - 1]?.done?.[me.pid];
  const size = group.playerIds.length;
  const final = isFinalRound(state);
  const mult = final ? state.settings.finalRoundMult : 1;
  const cash = state.players[me.pid].cash;
  const odds = state.settings.showOdds ? groupOdds(state, group)[stock.playerId] : null;
  const dv = diversifyStatus(state, me.pid);
  const sliderMax = Math.max(2, max);
  const ticks = state.settings.tiers
    .map((t, i) => ({ k: t.upTo - stock.soldPct, next: state.settings.tiers[i + 1] }))
    .filter((t) => t.next && t.k >= 1 && t.k < sliderMax);
  const per = payoutFor(state.settings, size);

  return (
    <Sheet title={`${own ? 'Your' : owner.name + "'s"} stock`} onClose={onClose}>
      <div className="mb-1 text-sm text-muted">
        {state.machines[stock.machineId]?.name} · {sh(stock.soldPct)} sold · next share {money(priceAtPoint(stock.soldPct, state.settings.tiers))}
        {held > 0 && ` · you own ${sh(held)}`}
      </div>
      <div className="mb-3"><OddsLine odds={odds} /></div>
      {trading ? (
        <>
          {!own && !final && dv.need > 0 && (
            <div className="mb-3 rounded-xl border border-line bg-ink p-2 text-xs text-muted">
              Rule: buy at least {sh(state.settings.minOtherShares)} in {dv.need} other players ({Math.min(dv.have, dv.need)} so far). Your own stock doesn't count.
            </div>
          )}
          {own && final && <div className="mb-3 rounded-xl border border-pink p-2 text-xs text-pink">Final round: no limit on your own stock.</div>}
          <div className="mb-1 flex items-end justify-between">
            <span className="font-mono text-[11px] uppercase text-dim">How many shares</span>
            <span className="font-display text-3xl font-extrabold">{pct}</span>
          </div>
          <div className="relative mb-6">
            <input
              type="range"
              min={1}
              max={sliderMax}
              step={1}
              value={Math.min(Math.max(pct, 1), sliderMax)}
              disabled={max < 1}
              onChange={(e) => setPct(parseInt(e.target.value, 10))}
              className="h-8 w-full accent-pink"
              aria-label="Shares to buy"
            />
            {ticks.map((t) => (
              <span
                key={t.k}
                className="pointer-events-none absolute top-7 -translate-x-1/2 font-mono text-[10px] text-dim"
                style={{ left: `${((t.k - 1) / (sliderMax - 1)) * 100}%` }}
              >
                ↑{money(t.next.price)}
              </span>
            ))}
          </div>
          <div className="mb-4 flex items-center gap-2">
            <Btn kind="ghost" onClick={() => setPct(Math.max(1, pct - 1))}>−</Btn>
            <Input
              inputMode="numeric"
              value={pct}
              onChange={(e) => setPct(Math.max(0, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0))}
              className="text-center text-lg font-bold"
            />
            <Btn kind="ghost" onClick={() => setPct(pct + 1)}>+</Btn>
            <Btn kind="ghost" onClick={() => setPct(Math.max(1, max))}>Max {max}</Btn>
          </div>
          {chk.ok && (
            <>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted">You put in</span>
                <b className="font-mono">{money(chk.cost)}</b>
              </div>
              <div className="mb-3 flex justify-between text-sm">
                <span className="text-muted">Cash left</span>
                <b className="font-mono">{money(cash - chk.cost)}</b>
              </div>
              <Label>Your profit if {owner.name} finishes… {mult !== 1 && `(final round ×${mult})`}</Label>
              <div className="mb-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${per.length}, minmax(0, 1fr))` }}>
                {per.map((m, i) => {
                  const v = Math.round(chk.cost * (1 + (m / 100) * mult));
                  const profit = v - chk.cost;
                  return (
                    <div key={i} className="rounded-xl border border-line bg-ink p-2 text-center">
                      <div className="font-mono text-[10px] text-dim">{ordinal(i + 1)}</div>
                      <div className={cx('font-mono text-base font-bold', profit >= 0 ? 'text-mint' : 'text-loss')}>{signed(profit)}</div>
                      <div className="font-mono text-[10px] text-dim">get back {money(v)}</div>
                    </div>
                  );
                })}
              </div>
              <p className="mb-1 text-[11px] text-dim">
                Profit is what you gain or lose. "Get back" is your money plus the profit.
                {!final && ' A market event can move this a few percent.'}
              </p>
              <details className="mb-4 text-[11px] text-muted">
                <summary className="cursor-pointer text-dim">See the math</summary>
                <div className="mt-1 space-y-0.5 font-mono">
                  {per.map((m, i) => (
                    <div key={i}>
                      {ordinal(i + 1)}: {money(chk.cost)} × (1 {m < 0 ? '−' : '+'} {absPct(m)}{mult !== 1 ? ` × ${mult}` : ''}) = {money(Math.round(chk.cost * (1 + (m / 100) * mult)))}
                    </div>
                  ))}
                </div>
              </details>
            </>
          )}
          {!chk.ok && <div className="mb-3 text-sm text-loss">{chk.error}</div>}
          <Btn
            kind="mint"
            className="w-full"
            disabled={!chk.ok}
            onClick={async () => {
              if (await dispatch({ type: 'buy', pid: me.pid, pinHash: me.pinHash, stockId: stock.id, pct })) onClose();
            }}
          >
            Buy {sh(pct)} {chk.ok ? `for ${money(chk.cost)}` : ''}
          </Btn>
        </>
      ) : (
        <div className="mb-3 rounded-xl border border-line bg-ink p-3 text-sm text-muted">
          {stock.status === 'resolved' ? `Finished ${ordinal(stock.place)}.` : 'Trading is closed on this stock.'}
        </div>
      )}
      <div className="mt-4">
        <Label>Who owns it</Label>
        <Holders stock={stock} />
      </div>
    </Sheet>
  );
}

// ---------- bet sheet (horse style) ----------
function BetSheet({ stock, me, onClose }) {
  const fmt = useOddsFmt();
  const { state, dispatch } = useGame();
  const now = useNow();
  const owner = state.players[stock.playerId];
  const own = stock.playerId === me.pid;
  const group = groupOf(state, stock.playerId);
  const kinds = kindsForSize(group.playerIds.length);
  const [kind, setKind] = useState('win');
  const [amount, setAmount] = useState(Math.max(state.settings.minBet, 50));
  const phase = roundPhase(state, now);
  const open = stock.status === 'open' && phase === 'open';
  const chk = checkBet(state, me.pid, stock.id, kind, amount, now);
  const odds = state.settings.showOdds ? groupOdds(state, group)[stock.playerId] : null;
  const live = liveOdds(state, group.id, kind, stock.id);
  const max = maxBet(state, me.pid, stock.id, kind, now);
  const pFor = { win: odds?.win, place: odds?.top2, show: odds?.top3 }[kind];
  const ret = chk.ok ? estimateReturn(state, group.id, kind, stock.id, amount) : 0;

  return (
    <Sheet title={`${own ? 'Bet on yourself' : 'Bet on ' + owner.name}`} onClose={onClose}>
      <div className="mb-3 text-sm text-muted">
        {state.machines[stock.machineId]?.name}
        {odds && <> · <OddsLine odds={odds} horse /></>}
      </div>
      {open ? (
        <>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {kinds.map((k) => (
              <button
                key={k}
                onClick={() => setKind(k)}
                className={cx('rounded-xl border px-2 py-2 text-sm font-bold', kind === k ? 'border-pink text-pink' : 'border-line text-muted')}
              >
                {KIND_LABEL[k]}
                <div className="font-mono text-[10px] font-normal">{k === 'win' ? '1st' : k === 'place' ? 'top 2' : 'top 3'}</div>
              </button>
            ))}
          </div>
          <div className="mb-3 text-sm">
            <span className="text-muted">Pool {money(poolOf(state, group.id, kind))}</span>
            {live && <span className="text-dim"> · live {fmt(1 / (1 + live.odds))}</span>}
            {pFor != null && <span className="text-dim"> · line {fmt(pFor)}</span>}
          </div>
          <div className="mb-1 flex items-end justify-between">
            <span className="font-mono text-[11px] uppercase text-dim">Your bet</span>
            <span className="font-display text-3xl font-extrabold">{money(amount)}</span>
          </div>
          <input
            type="range"
            min={state.settings.minBet}
            max={Math.max(state.settings.minBet + 10, max)}
            step={10}
            value={Math.min(Math.max(amount, state.settings.minBet), Math.max(state.settings.minBet + 10, max))}
            disabled={max < state.settings.minBet}
            onChange={(e) => setAmount(parseInt(e.target.value, 10))}
            className="mb-2 h-8 w-full accent-pink"
            aria-label="Bet amount"
          />
          <div className="mb-4 flex items-center gap-2">
            <Btn kind="ghost" onClick={() => setAmount(Math.max(0, amount - 10))}>−</Btn>
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
              className="text-center text-lg font-bold"
            />
            <Btn kind="ghost" onClick={() => setAmount(amount + 10)}>+</Btn>
            <Btn kind="ghost" onClick={() => setAmount(Math.max(state.settings.minBet, max))}>Max</Btn>
          </div>
          {chk.ok ? (
            <>
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-muted">If it hits, about</span>
                <b className="font-mono text-mint">{signed(ret - amount)} profit</b>
              </div>
              <div className="mb-3 flex justify-between text-xs text-dim">
                <span>You'd get back about {money(ret)}</span>
                <span>If it misses: {money(-amount)}</span>
              </div>
              <p className="mb-3 text-[11px] text-dim">
                Pool ÷ money on this runner × your bet. The pool grows as others bet, so this moves.
                {isFinalRound(state) && ` Final round: the house adds ${state.settings.houseBonusFinalPct}% to every pool.`}
              </p>
            </>
          ) : (
            <div className="mb-3 text-sm text-loss">{chk.error}</div>
          )}
          <Btn
            kind="mint"
            className="w-full"
            disabled={!chk.ok}
            onClick={async () => {
              if (await dispatch({ type: 'bet', pid: me.pid, pinHash: me.pinHash, stockId: stock.id, kind, amount })) onClose();
            }}
          >
            Bet {money(amount)} to {kind}
          </Btn>
          <p className="mt-2 text-center text-[11px] text-dim">Bets are final. Odds move as money comes in.</p>
        </>
      ) : (
        <div className="mb-3 rounded-xl border border-line bg-ink p-3 text-sm text-muted">
          {stock.status === 'resolved' ? `Finished ${ordinal(stock.place)}.` : 'Betting is closed on this runner.'}
        </div>
      )}
      <div className="mt-4">
        <Label>Who bet on {own ? 'you' : owner.name}</Label>
        <Holders stock={stock} horse />
      </div>
    </Sheet>
  );
}

// ---------- report sheet ----------
function ReportSheet({ group, me, onClose }) {
  const { state, dispatch } = useGame();
  const names = Object.fromEntries(group.playerIds.map((id) => [id, state.players[id].name]));
  const mine = group.reports.find((r) => r.by === me.pid);
  const [order, setOrder] = useState(mine ? mine.order : []);
  return (
    <Sheet title="Report the result" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Rank everyone in your group. The organizer approves the final result.</p>
      <OrderPicker ids={group.playerIds} names={names} value={order} onChange={setOrder} />
      <Btn
        className="mt-4 w-full"
        disabled={!orderComplete(group.playerIds, order)}
        onClick={async () => {
          if (await dispatch({ type: 'submitReport', pid: me.pid, pinHash: me.pinHash, groupId: group.id, order })) onClose();
        }}
      >
        Send to organizer
      </Btn>
    </Sheet>
  );
}

// ---------- market ----------
function StockRow({ stock, me, map, onTap, pr }) {
  const fmt = useOddsFmt();
  const { state } = useGame();
  const horse = state.settings.style === 'horse';
  const owner = state.players[stock.playerId];
  const own = stock.playerId === me.pid;
  const group = groupOf(state, stock.playerId);
  const resolved = stock.status === 'resolved';
  const odds = state.settings.showOdds ? groupOdds(state, group, map)[stock.playerId] : null;
  const live = horse ? liveOdds(state, group.id, 'win', stock.id) : null;
  const pool = horse ? poolOf(state, group.id, 'win') : 0;
  const price = priceAtPoint(stock.soldPct, state.settings.tiers);
  const mine = horse
    ? Object.values(state.bets || {}).filter((b) => b.bettorId === me.pid && b.stockId === stock.id).reduce((a, b) => a + b.amount, 0)
    : heldPct(state, me.pid, stock.id);
  const topPick = topPickOf(state, group, map)?.id;
  const proj = pr && !resolved ? pr.stocks[stock.id] : null;
  let result = null;
  if (resolved) {
    if (horse) {
      const bs = Object.values(state.bets || {}).filter((b) => b.bettorId === me.pid && b.stockId === stock.id && b.status === 'paid');
      if (bs.length) result = bs.reduce((x, b) => x + b.payout - b.amount, 0);
    } else {
      const ps = Object.values(state.positions).filter((q) => q.holderId === me.pid && q.stockId === stock.id && q.soldAfter);
      if (ps.length) result = ps.reduce((x, q) => x + q.soldValue - q.cost, 0);
    }
  }
  let expected = null;
  if (proj && mine > 0) {
    let now$ = 0;
    let back = 0;
    if (horse) {
      for (const b of Object.values(state.bets || {})) if (b.bettorId === me.pid && b.stockId === stock.id && b.status === 'open') { now$ += b.amount; back += pr.positions[b.id] ?? 0; }
    } else {
      for (const p of heldPositions(state, me.pid)) if (p.stockId === stock.id) { now$ += p.cost; back += pr.positions[p.id] ?? p.value; }
    }
    expected = { back, gain: back - now$ };
  }
  return (
    <button onClick={onTap} className="w-full rounded-xl border border-line bg-ink p-3 text-left">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 font-bold">
          {owner.name} {own && <Chip tone="pink">you</Chip>}{' '}
          {topPick === stock.playerId && !resolved && <Chip tone="mint">★ top pick</Chip>}{' '}
          {!horse && !resolved && stock.soldPct >= 100 && <Chip tone="amber">popular</Chip>}
        </div>
        <div className="shrink-0 text-right font-mono text-sm">
          {resolved ? (
            <Chip tone={stock.place === 1 ? 'mint' : 'dim'}>{ordinal(stock.place)}</Chip>
          ) : horse ? (
            live ? `${fmt(1 / (1 + live.odds))}` : '—'
          ) : (
            <>
              {money(price)}
              <div className="text-[10px] text-dim">next share</div>
            </>
          )}
        </div>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-dim">
        <span>{horse ? `win pool ${money(pool)}` : `${sh(stock.soldPct)} sold`}</span>
        <span>{mine > 0 ? (horse ? `you bet ${money(mine)}` : `you own ${sh(mine)}`) : ''}</span>
      </div>
      {result != null && (
        <div className={cx('mt-2 text-sm font-bold', result >= 0 ? 'text-mint' : 'text-loss')}>
          You {result >= 0 ? 'made' : 'lost'} {money(Math.abs(result))} on this {horse ? 'runner' : 'stock'}
        </div>
      )}
      {proj && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className={cx('rounded-md px-2 py-0.5 font-mono text-xs font-bold', horse ? 'bg-line text-ivory' : proj.change >= 0 ? 'bg-mint/15 text-mint' : 'bg-loss/15 text-loss')}>
            {proj.conflict ? '? ' : ''}{ordinal(proj.place)}
            {!horse && <> {proj.change >= 0 ? '▲ +' : '▼ −'}{Math.abs(proj.change)}%</>}
          </span>
          {expected && (
            <span className="font-mono text-xs">
              <b>{money(expected.back)}</b>{' '}
              <span className={expected.gain >= 0 ? 'text-mint' : 'text-loss'}>({signed(expected.gain)})</span>
            </span>
          )}
        </div>
      )}
      {odds && (
        <div className="mt-1"><OddsLine odds={odds} horse={horse} /></div>
      )}
      <Backers stock={stock} horse={horse} />
    </button>
  );
}

function roundResultFor(state, me) {
  const r = currentRound(state);
  if (!r) return 0;
  if (state.settings.style === 'horse') {
    return Object.values(state.bets || {})
      .filter((b) => b.bettorId === me.pid && b.round === r.n && b.status === 'paid')
      .reduce((a, b) => a + b.payout - b.amount, 0);
  }
  return Object.values(state.positions)
    .filter((p) => p.holderId === me.pid && state.stocks[p.stockId].round === r.n && p.soldAfter)
    .reduce((a, p) => a + p.soldValue - p.cost, 0);
}

// What the market event did, shown to everyone after the organizer presses Apply.
function EventReveal({ state, r }) {
  if (state.settings.style === 'horse' || !r.event) return null;
  if (r.event.status === 'skipped') return <p className="mt-1 text-sm text-muted">No market event this round.</p>;
  const ev = describeEvent(state, r.event);
  const stocks = Object.values(r.stockByPlayer).map((id) => state.stocks[id]);
  const hit = stocks.filter((x) => (x.eventDelta || 0) !== 0);
  const sg = (n) => `${n > 0 ? '+' : '−'}${Math.abs(n)}%`;
  let line;
  if (!hit.length) line = 'No stock was affected.';
  else if (hit.length === stocks.length && hit.every((x) => x.eventDelta === hit[0].eventDelta)) line = null;
  else line = hit.map((x) => `${state.players[x.playerId].name} ${sg(x.eventDelta)}`).join(' · ') + '.';
  return (
    <div className="mt-2 rounded-xl border border-amber p-3">
      <div className="font-mono text-[11px] uppercase text-amber">Market event</div>
      <div className="font-display text-lg font-extrabold">{ev.name}</div>
      <p className="text-sm text-muted">{ev.blurb}</p>
      {line && <p className="mt-1 text-sm">{line}</p>}
    </div>
  );
}

function Finale({ me }) {
  const { state } = useGame();
  const lb = leaderboard(state);
  const ranked = lb.filter((x) => !x.withdrawn);
  const row = lb.find((x) => x.id === me.pid);
  const best = bestStocks(state);
  const top = best[0];
  const owners = {};
  for (const x of best) {
    const o = (owners[x.ownerId] = owners[x.ownerId] || { id: x.ownerId, gain: 0, cost: 0, rounds: 0 });
    o.gain += x.gain;
    o.cost += x.cost;
    o.rounds += 1;
  }
  const extra = awards(state);
  const topOwners = Object.values(owners).sort((a, b) => b.gain - a.gain);
  const byPct = best.filter((x) => x.cost >= 100).sort((a, b) => b.pct - a.pct)[0];
  const horse = state.settings.style === 'horse';
  return (
    <div className="space-y-4">
      <Card className="border-pink py-8 text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-dim">Winner</div>
        <div className="font-display text-5xl font-extrabold text-pink">{ranked[0]?.name}</div>
        <div className="mt-1 font-mono text-2xl font-bold">{money(ranked[0]?.worth || 0)}</div>
      </Card>
      <Card className="text-center">
        <div className="font-mono text-xs uppercase tracking-widest text-dim">You finished</div>
        <div className="font-display text-5xl font-extrabold">{row.rank ? `#${row.rank}` : '–'}</div>
        <div className="font-mono text-lg">of {ranked.length} players</div>
        <div className="font-mono text-sm text-dim">{money(row.worth)}</div>
      </Card>
      {top && (
        <Card className="border-mint">
          <div className="font-mono text-xs uppercase tracking-widest text-dim">Most profitable {horse ? 'runner' : 'stock'}</div>
          <div className="font-display text-3xl font-extrabold text-mint">{state.players[top.ownerId].name}</div>
          <div className="text-sm text-muted">Round {top.round} · finished {ordinal(top.place)}</div>
          <div className="mt-2 font-mono text-2xl font-bold text-mint">{signed(top.gain)}</div>
          <div className="text-sm text-muted">
            made by {top.backers} backer{top.backers === 1 ? '' : 's'} ({top.pct >= 0 ? '+' : ''}{top.pct}% on {money(top.cost)} put in)
          </div>
          {best.length > 1 && (
            <div className="mt-3 space-y-1 border-t border-line pt-2 text-sm">
              {best.slice(1, 3).map((x) => (
                <div key={x.stockId} className="flex justify-between text-muted">
                  <span>{state.players[x.ownerId].name} · R{x.round}</span>
                  <span className="font-mono">{signed(x.gain)}</span>
                </div>
              ))}
              {byPct && byPct.stockId !== top.stockId && (
                <div className="flex justify-between text-dim">
                  <span>Best return: {state.players[byPct.ownerId].name} · R{byPct.round}</span>
                  <span className="font-mono">+{byPct.pct}%</span>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
      {topOwners.length > 0 && (
        <Card className="border-amber">
          <div className="font-mono text-xs uppercase tracking-widest text-dim">Best {horse ? 'runner' : 'stocks'} overall</div>
          <div className="text-xs text-dim">Total made by everyone who backed them, across all rounds</div>
          <div className="mt-1 font-display text-3xl font-extrabold text-amber">{state.players[topOwners[0].id].name}</div>
          <div className="font-mono text-2xl font-bold text-amber">{signed(topOwners[0].gain)}</div>
          <div className="text-sm text-muted">
            across {topOwners[0].rounds} round{topOwners[0].rounds === 1 ? '' : 's'} ({topOwners[0].cost ? `${topOwners[0].gain >= 0 ? '+' : ''}${Math.round((topOwners[0].gain / topOwners[0].cost) * 100)}%` : '0%'} on {money(topOwners[0].cost)} put in)
          </div>
          {topOwners.length > 1 && (
            <div className="mt-3 space-y-1 border-t border-line pt-2 text-sm">
              {topOwners.slice(1, 4).map((x, i) => (
                <div key={x.id} className="flex justify-between text-muted">
                  <span>{i + 2}. {state.players[x.id].name}</span>
                  <span className="font-mono">{signed(x.gain)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
      {extra.length > 0 && (
        <Card>
          <Label>Awards</Label>
          <div className="divide-y divide-line">
            {extra.map((a) => (
              <div key={a.key} className="py-2">
                <div className="font-mono text-[11px] uppercase tracking-wider text-dim">{a.title}</div>
                <div className="font-display text-xl font-extrabold">{a.who}</div>
                <div className="text-sm text-muted">{a.detail}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card>
        <Label>Final standings</Label>
        <div className="space-y-1">
          {ranked.map((x) => (
            <div key={x.id} className={cx('flex justify-between text-sm', x.id === me.pid && 'font-bold text-pink')}>
              <span>{x.rank}. {x.name}</span>
              <span className="font-mono">{money(x.worth)}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function HowToPlay({ state, onClose }) {
  const st = state.settings;
  const horse = st.style === 'horse';
  const [i, setI] = useState(0);
  const mini = 'rounded-xl border border-line bg-ink p-3';
  const pct = (v) => `${v >= 0 ? '+' : '−'}${Math.abs(v)}%`;

  const stockSteps = [
    {
      title: 'Buy your own stock first',
      body: (
        <>
          Open the Market tab and <b>tap a player's name</b> to buy shares in them. Start with <b>your own</b>: at least {st.minSelfBuyPct} shares.
          {st.maxSelfBuyPct != null && <> You can own at most <b>{st.maxSelfBuyPct} shares</b> of your own stock <b>per round</b>. In the final round, that limit is lifted.</>}
        </>
      ),
      visual: (
        <div className={`${mini} flex items-center justify-between ring-2 ring-pink`}>
          <div className="font-bold">Katie <Chip tone="pink">you</Chip></div>
          <div className="text-right font-mono text-sm">{money(st.tiers[0].price)}<div className="text-[10px] text-dim">next share</div></div>
        </div>
      ),
    },
    {
      title: 'Prices go up as shares sell',
      body: <>Early shares are cheaper, so buying first pays off. Each share costs more once enough have been sold.</>,
      visual: (
        <div className="flex gap-1">
          {st.tiers.map((x, k) => (
            <div key={k} className={`${mini} flex-1 text-center`}>
              <div className="font-mono text-[10px] text-dim">up to {x.upTo}</div>
              <div className="font-mono text-base font-bold">{money(x.price)}</div>
            </div>
          ))}
        </div>
      ),
    },
    ...(st.minOtherStocks > 0
      ? [
          {
            title: `Buy into ${st.minOtherStocks} other players`,
            body: <>Next, buy at least <b>{st.minOtherShares} shares</b> in <b>{st.minOtherStocks} other players</b>. Your own stock doesn't count. The app keeps count and tells you how many you have left.</>,
            visual: (
              <div className={`${mini} border-amber`}>
                <div className="flex items-center justify-between">
                  <b>Buy into {st.minOtherStocks} other players</b>
                  <Chip tone="amber">1 of {st.minOtherStocks}</Chip>
                </div>
              </div>
            ),
          },
        ]
      : []),
    {
      title: "Press the big red button",
      body: <>When you're finished buying, press <b>I'M DONE BUYING</b>. The market also closes on a timer, so don't wait too long.</>,
      visual: <div className="rounded-2xl bg-[#dc2626] py-3 text-center font-display text-lg font-extrabold text-white">I'M DONE BUYING</div>,
    },
    {
      title: 'Your stock moves with the match',
      body: <>After the match, each stock moves based on how that player finished. Your shares sell automatically and the money goes to your cash.</>,
      visual: (
        <div className="grid grid-cols-4 gap-1">
          {st.payout4.map((v, k) => (
            <div key={k} className={`${mini} text-center`}>
              <div className="font-mono text-[10px] text-dim">{ordinal(k + 1)}</div>
              <div className={`font-mono text-sm font-bold ${v >= 0 ? 'text-mint' : 'text-loss'}`}>{pct(v)}</div>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: 'Use the odds',
      body: <>Odds show next to each name, and the <b>★ top pick</b> is the favorite in each game. The Portfolio tab shows what you own, and the Board shows the standings.</>,
      visual: <div className="flex flex-wrap gap-2"><Chip tone="mint">★ top pick: Priscilla (+120)</Chip><Chip>win odds +300</Chip></div>,
    },
  ];

  const horseSteps = [
    {
      title: 'Pick a runner and a bet',
      body: <>Each player is a runner. On the Market tab, <b>tap a player's name</b> to bet on them: <b>Win</b> (1st), <b>Place</b> (top 2) or <b>Show</b> (top 3).</>,
      visual: (
        <div className="grid grid-cols-3 gap-2">
          {[['Win', '1st'], ['Place', 'top 2'], ['Show', 'top 3']].map(([a, b2]) => (
            <div key={a} className={`${mini} text-center`}><div className="text-sm font-bold">{a}</div><div className="font-mono text-[10px] text-dim">{b2}</div></div>
          ))}
        </div>
      ),
    },
    {
      title: 'Bets share a pool',
      body: <>All bets go into a pool. The more people back a player, the lower the payout if they win. <b>Bets are final</b>, and the odds move as money comes in.</>,
      visual: <div className={`${mini} flex items-center justify-between`}><span className="text-muted">Pool</span><b className="font-mono">$450</b></div>,
    },
    {
      title: 'Use the odds',
      body: <>Odds show next to each name, and the <b>★ top pick</b> is the favorite in each game.</>,
      visual: <div className="flex flex-wrap gap-2"><Chip tone="mint">★ top pick: Priscilla (+120)</Chip></div>,
    },
    {
      title: 'Winnings arrive automatically',
      body: <>When the matches finish, winnings go into your cash. The last round adds a <b>{st.houseBonusFinalPct}% house bonus</b> to every pool. Most money at the end wins.</>,
      visual: <div className={`${mini} text-center font-mono text-mint`}>+$188</div>,
    },
  ];

  const steps = horse ? horseSteps : stockSteps;
  const last = i === steps.length - 1;
  const step = steps[i];
  return (
    <Sheet title="How this works" onClose={onClose}>
      <div className="mb-3 flex items-center justify-between">
        <span className="font-mono text-[11px] uppercase text-dim">Step {i + 1} of {steps.length}</span>
        <div className="flex gap-1">
          {steps.map((_, k) => (
            <span key={k} className={`h-1.5 w-5 rounded-full ${k <= i ? 'bg-pink' : 'bg-line'}`} />
          ))}
        </div>
      </div>
      <h3 className="mb-2 font-display text-2xl font-extrabold">{step.title}</h3>
      <p className="mb-4 text-sm leading-relaxed text-muted">{step.body}</p>
      <div className="mb-5">{step.visual}</div>
      <div className="flex gap-2">
        {i > 0 && <Btn kind="ghost" className="flex-1" onClick={() => setI(i - 1)}>Back</Btn>}
        <Btn className="flex-1" onClick={() => (last ? onClose() : setI(i + 1))}>{last ? 'Got it' : 'Next'}</Btn>
      </div>
      <p className="mt-2 text-center text-[11px] text-dim">You can reopen this anytime with the ? button.</p>
    </Sheet>
  );
}

function FinalBanner({ state }) {
  const horse = state.settings.style === 'horse';
  return (
    <div className="rounded-2xl border-2 border-pink bg-pink/10 p-3 text-center">
      <div className="font-display text-2xl font-extrabold tracking-wide text-pink">FINAL ROUND</div>
      <p className="text-sm">
        {horse
          ? `The house adds ${state.settings.houseBonusFinalPct}% to every pool.`
          : `Gains and losses ×${state.settings.finalRoundMult}. No limit on your own stock. You don't have to buy into anyone else.`}
      </p>
    </div>
  );
}

function Market({ me }) {
  const { state, dispatch } = useGame();
  const now = useNow();
  const [sheet, setSheet] = useState(null);
  const [reporting, setReporting] = useState(false);
  const [openG, setOpenG] = useState({});
  const [banner, setBanner] = useState(null);
  const [finalPop, setFinalPop] = useState(false);
  const [intro, setIntro] = useState(false);
  const prevHave = useRef(null);
  const oddsFmt = useOddsFmt();
  const horse = state.settings.style === 'horse';
  const r = currentRound(state);
  const phase = roundPhase(state, now);
  const mine = r ? groupOf(state, me.pid) : null;
  const player = state.players[me.pid];
  const dv = diversifyStatus(state, me.pid);
  const final = !!r && isFinalRound(state) && state.status === 'active';

  // "You've bought into 1 other player. Buy into 1 more." after each qualifying buy.
  useEffect(() => {
    if (prevHave.current != null && dv.have > prevHave.current && dv.need > 0 && (phase === 'open' || phase === 'self')) {
      const left = dv.need - dv.have;
      setBanner({
        id: Date.now(),
        ok: left <= 0,
        msg: left <= 0
          ? `You've bought into ${dv.have} other player${dv.have === 1 ? '' : 's'}. You can finish buying.`
          : `You've bought into ${dv.have} other player${dv.have === 1 ? '' : 's'}. Buy into ${left} more.`,
      });
    }
    prevHave.current = dv.have;
  }, [dv.have, dv.need, phase]);
  useEffect(() => {
    if (!banner) return undefined;
    const t = setTimeout(() => setBanner(null), 6000);
    return () => clearTimeout(t);
  }, [banner]);

  // Final-round popup, once per phone per tournament.
  const finalKey = r ? `sbx-final-${r.startedAt || r.n}` : null;
  const introKey = state.rounds[0] ? `sbx-intro-${state.rounds[0].startedAt || 1}` : null;
  useEffect(() => {
    if (!r || r.n !== 1 || !introKey || (phase !== 'self' && phase !== 'open')) return;
    let seen = false;
    try { seen = localStorage.getItem(introKey) === '1'; } catch { /* no storage */ }
    if (!seen) setIntro(true);
  }, [r?.n, introKey, phase]);
  const closeIntro = () => {
    setIntro(false);
    try { if (introKey) localStorage.setItem(introKey, '1'); } catch { /* ignore */ }
  };
  useEffect(() => {
    if (!final || !finalKey || r.n === 1 || (phase !== 'self' && phase !== 'open')) return;
    let seen = false;
    try { seen = localStorage.getItem(finalKey) === '1'; } catch { /* no storage */ }
    if (!seen) setFinalPop(true);
  }, [final, finalKey, phase]);
  const closeFinal = () => {
    setFinalPop(false);
    try { if (finalKey) localStorage.setItem(finalKey, '1'); } catch { /* ignore */ }
  };

  if (state.status === 'setup')
    return (
      <Card>
        <b>You're in, {player.name}.</b>
        <p className="text-sm text-muted">
          Waiting for the organizer to start round 1. {state.playerOrder.filter((i) => state.players[i].claimed).length}/
          {state.playerOrder.length} have claimed their names.
        </p>
      </Card>
    );
  if (state.status === 'complete') return <Finale me={me} />;
  if (player.eliminated)
    return (
      <Card>
        <b>You're out of the tournament.</b>
        <p className="text-sm text-muted">Your net worth dropped below the minimum {state.settings.style === 'horse' ? `bet (${money(state.settings.minBet)})` : `buy-in (${money(minSelfCost(state.settings))})`}. You can still follow the Board.</p>
      </Card>
    );

  const map = ratingMap(state);
  const pr = projection(state, now);
  const groups = mine ? [mine, ...r.groups.filter((g) => g.id !== mine.id)] : r.groups;
  const gain = roundResultFor(state, me);
  const closed = marketClosed(state, now);
  const dc = doneCount(state);
  const iAmDone = !!r.done?.[me.pid];
  const end = openEndsAt(state);
  const isOpenG = (g) => (g.id === mine?.id ? openG[g.id] !== false : !!openG[g.id]);

  return (
    <div className="space-y-3">
      {banner && (
        <div
          key={banner.id}
          onClick={() => setBanner(null)}
          className={cx('fixed left-1/2 top-14 z-50 w-[92vw] max-w-sm -translate-x-1/2 rounded-2xl px-4 py-3 text-center text-sm font-bold shadow-xl', banner.ok ? 'bg-mint text-ink' : 'bg-amber text-ink')}
        >
          {banner.msg}
        </div>
      )}
      {intro && <HowToPlay state={state} onClose={closeIntro} />}
      {finalPop && (
        <Sheet title="FINAL ROUND" onClose={closeFinal}>
          <p className="mb-3 text-lg font-bold">This is the last round.</p>
          <ul className="mb-4 space-y-2 text-sm">
            {horse ? (
              <li>• The house adds {state.settings.houseBonusFinalPct}% to every pool.</li>
            ) : (
              <>
                <li>• Gains and losses are ×{state.settings.finalRoundMult}.</li>
                <li>• No limit on how much of your own stock you can buy.</li>
                <li>• You don't have to buy into anyone else.</li>
                <li>• No cash reserve. Whoever has the most money at the end wins.</li>
              </>
            )}
          </ul>
          <Btn className="w-full" onClick={closeFinal}>Let's go</Btn>
        </Sheet>
      )}

      {final && phase !== 'paid' && <FinalBanner state={state} />}

      {phase === 'open' && mine && !horse && (
        closed ? (
          <Card className="border-amber">
            <b>Market closed</b>
            <p className="text-sm text-muted">No more buying. The organizer will lock the round when the matches start.</p>
          </Card>
        ) : (
          <div>
            <button
              disabled={!iAmDone && !dv.met}
              onClick={() => dispatch({ type: 'doneBuying', pid: me.pid, pinHash: me.pinHash, undo: iAmDone })}
              className={cx(
                'w-full rounded-2xl py-5 text-center font-display text-2xl font-extrabold tracking-wide text-white shadow-lg active:scale-[.99]',
                iAmDone ? 'bg-[#7f1d1d] ring-2 ring-white/40' : 'bg-[#dc2626] disabled:opacity-50'
              )}
            >
              {iAmDone ? "YOU'RE DONE · TAP TO UNDO" : "I'M DONE BUYING"}
              <div className="mt-1 font-mono text-xs font-normal opacity-90">
                {dc.done} of {dc.total} done{end != null ? ` · closes in ${fmtClock(end - now)}` : ''}
              </div>
            </button>
            {!iAmDone && !dv.met && (
              <div className="mt-2 text-center text-sm font-bold text-amber">
                Buy into {dv.need - dv.have} more other player{dv.need - dv.have === 1 ? '' : 's'} first
              </div>
            )}
            {dv.excused && <div className="mt-2 text-center text-xs text-muted">The organizer excused you from buying into others.</div>}
          </div>
        )
      )}

      {phase === 'open' && mine && !horse && !final && state.settings.minOtherStocks > 0 && !closed && !iAmDone && (
        dv.need > 0 ? (
          <Card className={dv.met ? 'border-mint' : 'border-amber'}>
            <div className="flex items-center justify-between">
              <b>Buy into {dv.need} other player{dv.need === 1 ? '' : 's'}</b>
              <Chip tone={dv.met ? 'mint' : 'amber'}>{Math.min(dv.have, dv.need)} of {dv.need}</Chip>
            </div>
            <p className="mt-1 text-xs text-muted">
              At least {sh(state.settings.minOtherShares)} each. Your own stock doesn't count.
              {dv.waived && " Lowered because your cash can't cover more."}
            </p>
          </Card>
        ) : dv.waived ? (
          <Card className="text-xs text-muted">You don't have enough cash to buy into other players, so you're excused from that rule.</Card>
        ) : null
      )}

      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase text-dim">
            Round {r.n} of {state.settings.rounds}
            {final && (horse ? ` · final +${state.settings.houseBonusFinalPct}% pools` : ` · final ×${state.settings.finalRoundMult}`)}
          </div>
          <div className="font-display text-xl font-extrabold">{PHASE_LABELS[phase]}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {phase === 'self' && r.selfEndsAt && <Chip tone="amber">{fmtClock(r.selfEndsAt - now)}</Chip>}
          <div className="flex items-center gap-2">
            {state.settings.showOdds && <OddsToggle />}
            <button onClick={() => setIntro(true)} aria-label="How to play" className="h-7 w-7 rounded-full border border-line font-mono text-xs text-muted">?</button>
          </div>
        </div>
      </div>

      {r.restarts > 0 && (phase === 'self' || phase === 'open') && (
        <Card className="border-amber text-sm">
          The organizer restarted this round. Earlier {horse ? 'bets' : 'buy-ins'} were refunded, so {horse ? 'bet' : 'buy'} in again.
        </Card>
      )}
      {!mine && (phase === 'self' || phase === 'open') && (
        <Card className="text-sm text-muted">You're not in this round's draw yet. The organizer will restart the round to include you.</Card>
      )}
      {phase === 'self' && mine && (
        <Card className="text-sm text-muted">
          {horse
            ? `Bet at least ${money(minSelfCost(state.settings))} on yourself. Everyone else's runners open when the timer ends or everyone has bet in.`
            : `Buy at least ${sh(state.settings.minSelfBuyPct)} of your own stock. Everyone else's stocks open when the timer ends or everyone has bought in.`}
        </Card>
      )}
      {phase === 'locked' && mine && (
        <Card className="flex items-center justify-between gap-3 !p-3">
          <div className="min-w-0">
            <b>Match in progress</b>
            <p className="text-xs text-muted">
              {mine.places ? 'Result is in. Waiting for payout.' : 'Frozen. Anyone in your group can report the result.'}
            </p>
          </div>
          {!mine.places && (
            <Btn small onClick={() => setReporting(true)}>{mine.reports.some((x) => x.by === me.pid) ? 'Change report' : 'Report'}</Btn>
          )}
        </Card>
      )}
      {pr && (
        <p className="text-[11px] text-dim">
          {pr.anyPending ? 'Suggested results, not final. ' : ''}
          {pr.anyConflict ? 'Conflicting reports: latest shown. ' : ''}
          {pr.exact ? 'Exact once approved.' : 'Before the market event.'}
        </p>
      )}
      {phase === 'event' && (
        <Card>
          <b>Results are in</b>
          <p className="text-sm text-muted">The organizer is checking the market before payout.</p>
        </Card>
      )}
      {phase === 'paid' && (
        <Card>
          <b>Round {r.n} paid out</b>
          <p className="mt-1 text-sm text-muted">
            Winnings were added to your cash automatically.
            {gain !== 0 && <> This round: <b className={gain > 0 ? 'text-mint' : 'text-loss'}>{signed(gain)}</b>.</>}
          </p>
          <EventReveal state={state} r={r} />
        </Card>
      )}

      {groups.map((g) => {
        const info = pr ? pr.groups[g.id] : null;
        const isMine = g.id === mine?.id;
        const open = isOpenG(g);
        const pick = topPickOf(state, g, map);
        const stocks = g.playerIds.map((id) => state.stocks[r.stockByPlayer[id]]);
        return (
          <div key={g.id} className={cx('rounded-2xl border bg-surface p-3', isMine ? 'border-pink' : 'border-line')}>
            <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpenG({ ...openG, [g.id]: !open })}>
              <div className="min-w-0">
                <div className="font-display text-xl font-extrabold">{state.machines[g.machineId]?.name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  {isMine && <Chip tone="pink">your match</Chip>}
                  {pr && <ResultTag info={info} />}
                  {!pr && phase !== 'paid' && pick && <Chip tone="mint">★ top pick: {state.players[pick.id].name} ({oddsFmt(pick.p)})</Chip>}
                  {phase === 'paid' && <Chip tone="mint">paid</Chip>}
                </div>
                {!open && <div className="mt-1 truncate text-xs text-dim">{g.playerIds.map((id) => state.players[id].name).join(' · ')}</div>}
              </div>
              <span className="font-mono text-dim">{open ? '▾' : '▸'}</span>
            </button>
            {open && (
              <div className="mt-3 space-y-2">
                {info && info.order && info.status !== 'official' && (
                  <div className="text-xs text-muted">
                    Suggested order: {info.order.map((id, i) => `${i + 1}. ${state.players[id].name}`).join('  ')}
                  </div>
                )}
                {stocks.map((s) => (
                  <StockRow key={s.id} stock={s} me={me} map={map} pr={pr} onTap={() => setSheet(s)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {sheet && (horse ? <BetSheet stock={sheet} me={me} onClose={() => setSheet(null)} /> : <StockSheet stock={sheet} me={me} onClose={() => setSheet(null)} />)}
      {reporting && <ReportSheet group={mine} me={me} onClose={() => setReporting(false)} />}
    </div>
  );
}

// ---------- portfolio ----------
function RoundSection({ n, title, summary, open, onToggle, note, children }) {
  return (
    <div>
      <button onClick={onToggle} className="mb-2 flex w-full items-center justify-between border-b border-line pb-1 text-left">
        <span className="font-display text-base font-extrabold">{title}</span>
        <span className="flex items-center gap-2 font-mono text-xs">
          {summary}
          <span className="text-dim">{open ? '▾' : '▸'}</span>
        </span>
      </button>
      {open && <div className="space-y-2">{note}{children}</div>}
    </div>
  );
}

function Portfolio({ me }) {
  const { state, dispatch } = useGame();
  const now = useNow();
  const horse = state.settings.style === 'horse';
  const p = state.players[me.pid];
  const pr = projection(state, now);
  const showIfpa = state.status === 'setup' || (state.round <= 1 && roundPhase(state, now) !== 'paid');
  const [openR, setOpenR] = useState({});
  const isOpen = (n) => (openR[n] !== undefined ? openR[n] : n === state.round);
  const toggle = (n) => setOpenR({ ...openR, [n]: !isOpen(n) });

  const top = (
    <div className="grid grid-cols-2 gap-2">
      <Card><Label>Cash</Label><div className="font-mono text-xl font-bold">{money(p.cash)}</div></Card>
      <Card>
        <Label>Net worth</Label>
        <div className="font-mono text-xl font-bold text-mint">{money(netWorth(state, me.pid))}</div>
        {pr && pr.players[me.pid].delta !== 0 && (
          <div className={cx('font-mono text-[11px]', pr.players[me.pid].delta > 0 ? 'text-mint' : 'text-loss')}>
            about {money(pr.players[me.pid].worth)} if results hold
          </div>
        )}
      </Card>
    </div>
  );

  if (horse) {
    const mineBets = Object.values(state.bets || {}).filter((b) => b.bettorId === me.pid);
    const rounds = [...new Set(mineBets.map((b) => b.round))].sort((a, b) => b - a);
    return (
      <div className="space-y-4">
        {top}
        {!mineBets.length && <Card className="text-sm text-muted">No bets yet. Place one on the Market tab.</Card>}
        {rounds.map((n) => {
          const list = mineBets.filter((b) => b.round === n);
          const paid = list.every((b) => b.status === 'paid');
          const net = list.reduce((a, b) => a + (b.status === 'paid' ? b.payout - b.amount : 0), 0);
          return (
            <RoundSection
              key={n}
              n={n}
              title={`Round ${n}`}
              open={isOpen(n)}
              onToggle={() => toggle(n)}
              summary={paid ? <span className={net >= 0 ? 'text-mint' : 'text-loss'}>{signed(net)}</span> : <span className="text-dim">in play</span>}
            >
              {list.map((b) => {
                const stock = state.stocks[b.stockId];
                const net1 = b.payout - b.amount;
                const exp = pr && b.status === 'open' ? pr.positions[b.id] : null;
                return (
                  <Card key={b.id}>
                    <div className="flex items-center justify-between">
                      <div>
                        <b>{KIND_LABEL[b.kind]}: {state.players[stock.playerId].name}</b>
                        <div className="font-mono text-xs text-muted">bet {money(b.amount)}</div>
                      </div>
                      {b.status === 'paid' ? (
                        <Chip tone={net1 >= 0 ? 'mint' : 'loss'}>{signed(net1)}</Chip>
                      ) : exp != null ? (
                        <Chip tone={exp - b.amount >= 0 ? 'mint' : 'loss'}>about {signed(exp - b.amount)}</Chip>
                      ) : (
                        <Chip>{stock.status === 'locked' ? 'locked' : 'open'}</Chip>
                      )}
                    </div>
                    {b.status === 'paid' && <p className="mt-2 text-[11px] leading-snug text-dim">{mathBet(state, b)}</p>}
                  </Card>
                );
              })}
            </RoundSection>
          );
        })}
        {showIfpa && <MyIfpa me={me} />}
      </div>
    );
  }

  const mineP = Object.values(state.positions).filter((x) => x.holderId === me.pid);
  const rounds = [...new Set(mineP.map((x) => state.stocks[x.stockId].round))].sort((a, b) => b - a);
  return (
    <div className="space-y-4">
      {top}
      {!mineP.length && <Card className="text-sm text-muted">Nothing yet. Buy some stock on the Market tab.</Card>}
      {rounds.map((n) => {
        const list = mineP.filter((x) => state.stocks[x.stockId].round === n);
        const heldL = list.filter((x) => x.status === 'held');
        const doneL = list.filter((x) => x.status === 'sold');
        const net = doneL.filter((x) => x.soldAfter).reduce((a, x) => a + x.soldValue - x.cost, 0);
        return (
          <RoundSection
            key={n}
            n={n}
            title={`Round ${n}`}
            open={isOpen(n)}
            onToggle={() => toggle(n)}
            note={pr && n === state.round ? <p className="text-[11px] text-dim">{pr.anyPending ? 'Pending results, not final. ' : 'Results are in. '}{pr.exact ? '' : 'Before the market event.'}</p> : null}
            summary={heldL.length ? <span className="text-dim">in play</span> : <span className={net >= 0 ? 'text-mint' : 'text-loss'}>{signed(net)}</span>}
          >
            {heldL.map((pos) => {
              const stock = state.stocks[pos.stockId];
              const chk = checkSell(state, me.pid, pos.id, now);
              const exp = pr ? pr.positions[pos.id] : null;
              return (
                <Card key={pos.id}>
                  <div className="flex items-center justify-between">
                    <div>
                      <b>Stocks in {state.players[stock.playerId].name}</b>
                      <div className="font-mono text-xs text-muted">{sh(pos.pct)} · paid {money(pos.cost)}</div>
                    </div>
                    {exp != null ? (
                      <div className="text-right">
                        <div className={cx('font-mono text-sm font-bold', exp - pos.cost >= 0 ? 'text-mint' : 'text-loss')}>about {signed(exp - pos.cost)}</div>
                        <div className="font-mono text-[10px] text-dim">get back about {money(exp)}</div>
                      </div>
                    ) : (
                      <Chip>{stock.status === 'locked' ? '🔒 frozen' : 'open'}</Chip>
                    )}
                  </div>
                  {chk.ok ? (
                    <div className="mt-2 flex justify-end">
                      <Btn small kind="ghost" onClick={() => dispatch({ type: 'sell', pid: me.pid, pinHash: me.pinHash, positionId: pos.id })}>
                        Sell at cost
                      </Btn>
                    </div>
                  ) : (
                    !chk.error.startsWith('Frozen') && <p className="mt-2 text-xs text-dim">{chk.error}</p>
                  )}
                </Card>
              );
            })}
            {doneL.map((pos) => {
              const stock = state.stocks[pos.stockId];
              const net1 = pos.soldValue - pos.cost;
              return (
                <div key={pos.id} className="rounded-xl border border-line bg-surface px-3 py-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted">
                      Stocks in {state.players[stock.playerId].name} · {sh(pos.pct)}
                      {stock.status === 'resolved' && ` · ${ordinal(stock.place)}`}
                    </span>
                    <span className={cx('font-mono font-bold', pos.soldAfter ? (net1 >= 0 ? 'text-mint' : 'text-loss') : 'text-dim')}>
                      {pos.soldAfter ? signed(net1) : 'sold early'}
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[10px] leading-snug text-dim">
                    {pos.soldAfter ? mathStocks(stock, pos) : `Sold at cost: ${money(pos.cost)} back.`}
                  </p>
                </div>
              );
            })}
          </RoundSection>
        );
      })}
      {showIfpa && <MyIfpa me={me} />}
    </div>
  );
}

// ---------- board ----------
const SEL_KEY = 'sbx-chart-sel';
const shortMoney = (n) => (Math.abs(n) >= 4000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(n / 10) * 10}`);

function NetWorthChart({ series, labels, startCash, dashedLast }) {
  const W = 320;
  const H = 190;
  const L = 46;
  const R = 12;
  const T = 10;
  const B = 24;
  const n = labels.length;
  const vals = series.flatMap((s) => s.values).filter((v) => v != null);
  if (!vals.length || n < 2) return <div className="py-8 text-center text-sm text-dim">Chart starts after Round 1.</div>;
  let lo = Math.min(...vals, startCash);
  let hi = Math.max(...vals, startCash);
  if (hi - lo < 100) { hi += 50; lo -= 50; }
  const pad = (hi - lo) * 0.08;
  lo -= pad; hi += pad;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const path = (vs, from = 0, to = vs.length - 1) => {
    let d = '';
    let pen = false;
    for (let i = from; i <= to; i++) {
      if (vs[i] == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(vs[i]).toFixed(1)}`;
      pen = true;
    }
    return d;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Net worth by round">
      {[hi - pad, (hi + lo) / 2, lo + pad].map((v, i) => (
        <g key={i}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#352C52" strokeWidth="1" />
          <text x={L - 4} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#8A7DB8" fontFamily="IBM Plex Mono, monospace">{shortMoney(v)}</text>
        </g>
      ))}
      {dashedLast && <rect x={x(n - 2)} y={T} width={x(n - 1) - x(n - 2)} height={H - T - B} fill="#8A7DB8" opacity="0.14" />}
      <line x1={L} x2={W - R} y1={y(startCash)} y2={y(startCash)} stroke="#8A7DB8" strokeWidth="1" strokeDasharray="2 3" />
      {labels.map((lb, i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="#8A7DB8" fontFamily="IBM Plex Mono, monospace">{lb}</text>
      ))}
      {series.map((s) => {
        const lastSolid = dashedLast ? n - 2 : n - 1;
        const li = s.values.length - 1;
        return (
          <g key={s.id}>
            <path d={path(s.values, 0, lastSolid)} fill="none" stroke={s.color} strokeWidth={s.me ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
            {dashedLast && s.values[n - 2] != null && s.values[n - 1] != null && (
              <path d={`M${x(n - 2).toFixed(1)},${y(s.values[n - 2]).toFixed(1)}L${x(n - 1).toFixed(1)},${y(s.values[n - 1]).toFixed(1)}`} fill="none" stroke={s.color} strokeWidth={s.me ? 3 : 2} strokeDasharray="4 4" strokeLinecap="round" />
            )}
            {s.values[li] != null && <circle cx={x(li)} cy={y(s.values[li])} r={s.me ? 4 : 3} fill={s.color} />}
          </g>
        );
      })}
    </svg>
  );
}

function Board({ me }) {
  const { state } = useGame();
  const now = useNow();
  const lb = leaderboard(state);
  const pr = projection(state, now);
  const [view, setView] = useState('projected');
  const [sel, setSel] = useState(() => {
    try {
      const v = JSON.parse(localStorage.getItem(SEL_KEY));
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  });
  const save = (v) => {
    setSel(v);
    try { localStorage.setItem(SEL_KEY, JSON.stringify(v)); } catch { /* ignore */ }
  };
  const chosen = [me.pid, ...sel.filter((id) => id !== me.pid && state.players[id])];
  const toggle = (id) => {
    if (id === me.pid) return;
    if (chosen.includes(id)) return save(sel.filter((x) => x !== id));
    const next = [...sel.filter((x) => x !== me.pid), id];
    while (next.length > COLORS.length - 1) next.shift();
    save(next);
  };
  const colorOf = (id) => (id === me.pid ? COLORS[0] : COLORS[1 + (chosen.indexOf(id) - 1)] || COLORS[1]);

  const showProj = !!pr && view === 'projected';
  // projected ranking
  const live = lb.filter((x) => !x.withdrawn);
  const projWorth = (id, fallback) => (pr ? pr.players[id].worth : fallback);
  const projRank = {};
  // Tied players share the middle of their places, so a 8-way tie at the start does not show everyone as "dropping".
  const midRank = (list, worthOf) => {
    const out = {};
    for (const x of list) {
      const w = worthOf(x);
      const above = list.filter((y) => worthOf(y) > w).length;
      const same = list.filter((y) => worthOf(y) === w).length;
      out[x.id] = above + (same + 1) / 2;
    }
    return out;
  };
  let projMid = {};
  let curMid = {};
  if (pr) {
    const sorted = live.slice().sort((a, b) => projWorth(b.id, b.worth) - projWorth(a.id, a.worth) || a.name.localeCompare(b.name));
    let rank = 0;
    let lastW = null;
    sorted.forEach((x, i) => {
      const w = projWorth(x.id, x.worth);
      if (w !== lastW) rank = i + 1;
      projRank[x.id] = rank;
      lastW = w;
    });
    projMid = midRank(live, (x) => projWorth(x.id, x.worth));
    curMid = midRank(live, (x) => x.worth);
  }
  const rows = showProj
    ? lb.slice().sort((a, b) => (a.withdrawn - b.withdrawn) || (projRank[a.id] ?? 999) - (projRank[b.id] ?? 999) || a.name.localeCompare(b.name))
    : lb;

  // chart data
  const paid = state.rounds.filter((r) => r.worths);
  const hist = worthHistory(state);
  const labels = ['Start', ...paid.map((r) => `R${r.n}`)];
  const withProj = !!pr;
  if (withProj) labels.push('→');
  const series = chosen.map((id) => {
    const values = [state.settings.startingCash, ...hist[id].slice(0, paid.length)];
    if (withProj) values.push(pr.players[id].worth);
    return { id, color: colorOf(id), me: id === me.pid, values };
  });
  const top3 = () => save(live.filter((x) => x.rank && x.rank <= 3 && x.id !== me.pid).map((x) => x.id).slice(0, 3));

  return (
    <div className="space-y-3">
      <Card>
        <div className="mb-1 flex items-center justify-between">
          <Label>Net worth by round</Label>
          <div className="flex gap-1">
            <button className="rounded-lg border border-line px-2 py-1 font-mono text-[11px] text-muted" onClick={top3}>Top 3</button>
            <button className="rounded-lg border border-line px-2 py-1 font-mono text-[11px] text-muted" onClick={() => save([])}>Just me</button>
          </div>
        </div>
        <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1">
          {chosen.map((id) => (
            <span key={id} className="flex items-center gap-1 font-mono text-[11px] text-muted">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorOf(id) }} />
              {id === me.pid ? 'You' : state.players[id].name}
            </span>
          ))}
        </div>
        <NetWorthChart series={series} labels={labels} startCash={state.settings.startingCash} dashedLast={withProj} />
        <p className="mt-1 text-[11px] text-dim">Tap a name below to add or remove their line.{withProj && ' Dotted = if suggested results hold.'}</p>
      </Card>

      {pr && (
        <div className="flex items-center justify-between">
          <div className="inline-flex overflow-hidden rounded-lg border border-line font-mono text-[11px]">
            {[['projected', 'If results hold'], ['current', 'Current']].map(([k, label]) => (
              <button key={k} onClick={() => setView(k)} className={cx('px-3 py-1.5', view === k ? 'bg-pink text-ink' : 'text-muted')}>{label}</button>
            ))}
          </div>
          {showProj && <span className="text-[11px] text-dim">{pr.anyPending ? 'not final yet' : 'results in'}</span>}
        </div>
      )}
      {showProj && <p className="text-[11px] text-dim">▲▼ = places gained or lost if results hold.{!pr.exact && ' Before the market event, which can move things a few percent.'}</p>}

      <div className="space-y-2">
        {rows.map((r) => {
          const isSel = chosen.includes(r.id);
          const pj = pr ? pr.players[r.id] : null;
          const arrow = showProj && !r.withdrawn ? Math.round((curMid[r.id] ?? 0) - (projMid[r.id] ?? 0)) : 0;
          const shownRank = showProj && !r.withdrawn ? projRank[r.id] : r.rank;
          return (
            <button
              key={r.id}
              onClick={() => toggle(r.id)}
              className={cx('flex w-full items-center justify-between rounded-xl border bg-surface px-4 py-3 text-left', r.id === me.pid ? 'border-pink bg-pink/10' : 'border-line', r.withdrawn && 'opacity-60')}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 font-mono text-dim">{r.withdrawn ? '–' : shownRank}</span>
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full border"
                  style={{ background: isSel ? colorOf(r.id) : 'transparent', borderColor: isSel ? colorOf(r.id) : '#352C52' }}
                />
                <b className={r.eliminated ? 'text-dim line-through' : ''}>{r.name}</b>
                {showProj && !r.withdrawn && <Arrow n={arrow} />}
                {r.withdrawn && <Chip>withdrawn</Chip>}
              </div>
              <div className="text-right">
                <div className="font-mono font-bold">{money(showProj && pj ? pj.worth : r.worth)}</div>
                {showProj && pj && pj.delta !== 0 && (
                  <div className={cx('font-mono text-[11px]', pj.delta > 0 ? 'text-mint' : 'text-loss')}>{signed(pj.delta)}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>
      <p className="pb-2 text-center font-mono text-[11px] text-dim">Showing all {lb.length} players</p>
    </div>
  );
}

// ---------- app shell ----------
export default function PlayerApp({ forcedSession, onLogout }) {
  const { state, ready } = useGame();
  const [me, setMe] = useState(forcedSession || loadSession);
  const [tab, setTab] = useState('market');

  useEffect(() => {
    if (forcedSession) setMe(forcedSession);
  }, [forcedSession]);

  useEffect(() => {
    if (me && ready && !state.players[me.pid] && !forcedSession) {
      saveSession(null);
      setMe(null);
    }
  }, [me, ready, state.players, forcedSession]);

  if (!ready) return <Shell>Loading…</Shell>;
  if (!me || !state.players[me.pid]) return <Claim onDone={setMe} />;

  const logout = () => {
    saveSession(null);
    setMe(null);
    onLogout?.();
  };

  if (state.players[me.pid].withdrawn)
    return (
      <Shell>
        <Card>
          <b>You've been removed from this tournament.</b>
          <p className="text-sm text-muted">If that's a mistake, ask the organizer to add you back.</p>
          <Btn kind="ghost" className="mt-3" onClick={logout}>Log out</Btn>
        </Card>
      </Shell>
    );

  const tabs = [['market', 'Market'], ['portfolio', 'Portfolio'], ['board', 'Board']];
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pt-5" style={{ paddingBottom: 'calc(7rem + env(safe-area-inset-bottom, 0px))' }}>
      <div className="mb-4 flex items-center justify-between">
        <div className="font-display text-lg font-extrabold">Silverball <span className="text-pink">Exchange</span></div>
        <button className="text-xs text-dim" onClick={logout}>{state.players[me.pid].name} · log out</button>
      </div>
      {tab === 'market' && <Market me={me} />}
      {tab === 'portfolio' && <Portfolio me={me} />}
      {tab === 'board' && <Board me={me} />}
      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-line bg-ink" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="mx-auto flex max-w-md">
          {tabs.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)} className={cx('flex-1 py-4 font-display text-sm font-extrabold', tab === k ? 'text-pink' : 'text-dim')}>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}
