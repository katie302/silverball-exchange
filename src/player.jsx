import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useGame, useNow } from './game.jsx';
import { Btn, Card, Chip, Input, Label, OrderPicker, Sheet, cx, fmtClock, orderComplete } from './ui.jsx';
import {
  KIND_LABEL, PHASE_LABELS, activePlayers, bettorsOn, checkBet, checkBuy, checkSell, confidence,
  currentRound, describeEvent, estimateReturn, fmtOdds, fmtPct, groupOdds, groupOf, hashPin, heldPct,
  heldPositions, holdersOf, isFinalRound, kindsForSize, leaderboard, liveOdds, maxBet, maxBuyable,
  doneCount, marketClosed, minSelfCost, money, netWorth, openEndsAt, ordinal, payoutFor, poolOf, priceAtPoint, ratingMap, roundPhase,
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
let oddsMode = 'odds';
try { oddsMode = localStorage.getItem('sbx-odds-mode') === 'pct' ? 'pct' : 'odds'; } catch { /* no storage */ }
const oddsSubs = new Set();
const subOdds = (f) => { oddsSubs.add(f); return () => oddsSubs.delete(f); };
function useOddsFmt() {
  const mode = useSyncExternalStore(subOdds, () => oddsMode);
  return mode === 'pct' ? fmtPct : fmtOdds;
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
      {[['odds', '3-to-1'], ['pct', '25%']].map(([m, label]) => (
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
      {horse ? `line ${fmt(odds.win)}` : `${fmt === fmtPct ? 'chance' : 'odds'} ${fmt(odds.win)}`} · {confidence(odds.games)}
    </span>
  );
}

// Compact "who's in" line shown right on the market row.
function Backers({ stock, horse }) {
  const { state } = useGame();
  const items = horse
    ? bettorsOn(state, stock.id).map((b) => `${state.players[b.bettorId].name} ${money(b.amount)} ${KIND_LABEL[b.kind].toLowerCase()}`)
    : holdersOf(state, stock.id).map((h) => `${state.players[h.pid].name} ${h.pct}%`);
  return (
    <div className="mt-2 border-t border-line pt-2 text-[11px] leading-snug text-muted">
      {items.length ? items.join(' · ') : horse ? 'No bets yet' : 'No owners yet'}
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
          <span className="font-mono">{h.pct}% · {money(h.cost)}{stock.status === 'resolved' && ` → ${money(h.value)}`}</span>
        </div>
      ))}
    </div>
  );
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
  const mult = isFinalRound(state) ? state.settings.finalRoundMult : 1;
  const cash = state.players[me.pid].cash;
  const odds = state.settings.showOdds ? groupOdds(state, group)[stock.playerId] : null;

  return (
    <Sheet title={`${own ? 'Your' : owner.name + "'s"} stock`} onClose={onClose}>
      <div className="mb-1 text-sm text-muted">
        {state.machines[stock.machineId]?.name} · {stock.soldPct}% sold · next 1% costs {money(priceAtPoint(stock.soldPct, state.settings.tiers))}
        {held > 0 && ` · you own ${held}%`}
      </div>
      <div className="mb-3"><OddsLine odds={odds} /></div>
      {trading ? (
        <>
          <div className="mb-3 flex items-center gap-2">
            <Btn kind="ghost" onClick={() => setPct(Math.max(1, pct - 1))}>−</Btn>
            <Input
              inputMode="numeric"
              value={pct}
              onChange={(e) => setPct(Math.max(0, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0))}
              className="text-center text-lg font-bold"
            />
            <Btn kind="ghost" onClick={() => setPct(pct + 1)}>+</Btn>
          </div>
          <div className="mb-4 flex gap-2">
            {[5, 10, 20].map((n) => (
              <Btn key={n} small kind="ghost" onClick={() => setPct(n)}>{n}%</Btn>
            ))}
            <Btn small kind="ghost" onClick={() => setPct(Math.max(1, max))}>Max ({max}%)</Btn>
          </div>
          {chk.ok && (
            <>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-muted">Cost</span>
                <b className="font-mono">{money(chk.cost)}</b>
              </div>
              <div className="mb-3 flex justify-between text-sm">
                <span className="text-muted">Cash left</span>
                <b className="font-mono">{money(cash - chk.cost)}</b>
              </div>
              <Label>If {owner.name} finishes… {mult !== 1 && `(final round ×${mult})`}</Label>
              <div className="mb-4 grid grid-cols-4 gap-2">
                {payoutFor(state.settings, size).map((m, i) => {
                  const v = Math.round(chk.cost * (1 + (m / 100) * mult));
                  return (
                    <div key={i} className="rounded-xl border border-line bg-ink p-2 text-center">
                      <div className="font-mono text-[10px] text-dim">{ordinal(i + 1)}</div>
                      <div className={cx('font-mono text-sm font-bold', v >= chk.cost ? 'text-mint' : 'text-pink')}>{money(v)}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          {!chk.ok && <div className="mb-3 text-sm text-pink">{chk.error}</div>}
          <Btn
            kind="mint"
            className="w-full"
            disabled={!chk.ok}
            onClick={async () => {
              if (await dispatch({ type: 'buy', pid: me.pid, pinHash: me.pinHash, stockId: stock.id, pct })) onClose();
            }}
          >
            Buy {pct}% {chk.ok ? `for ${money(chk.cost)}` : ''}
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
          <div className="mb-3 flex items-center gap-2">
            <Btn kind="ghost" onClick={() => setAmount(Math.max(0, amount - 10))}>−</Btn>
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(parseInt(e.target.value.replace(/\D/g, ''), 10) || 0)}
              className="text-center text-lg font-bold"
            />
            <Btn kind="ghost" onClick={() => setAmount(amount + 10)}>+</Btn>
          </div>
          <div className="mb-4 flex gap-2">
            {[50, 100, 200].map((n) => (
              <Btn key={n} small kind="ghost" onClick={() => setAmount(n)}>{money(n)}</Btn>
            ))}
            <Btn small kind="ghost" onClick={() => setAmount(Math.max(state.settings.minBet, max))}>Max ({money(max)})</Btn>
          </div>
          {chk.ok ? (
            <div className="mb-3 flex justify-between text-sm">
              <span className="text-muted">If it hits, about</span>
              <b className="font-mono text-mint">{money(estimateReturn(state, group.id, kind, stock.id, amount))}</b>
            </div>
          ) : (
            <div className="mb-3 text-sm text-pink">{chk.error}</div>
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
function StockRow({ stock, me, map, onTap }) {
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
  const mine = horse
    ? Object.values(state.bets || {}).filter((b) => b.bettorId === me.pid && b.stockId === stock.id).reduce((a, b) => a + b.amount, 0)
    : heldPct(state, me.pid, stock.id);
  return (
    <button onClick={onTap} className="w-full rounded-xl border border-line bg-ink p-3 text-left">
      <div className="flex items-center justify-between">
        <div className="font-bold">{owner.name} {own && <Chip tone="pink">you</Chip>}</div>
        <div className="font-mono text-sm">
          {resolved ? (
            <Chip tone={stock.place === 1 ? 'mint' : 'dim'}>{ordinal(stock.place)}</Chip>
          ) : horse ? (
            live ? `${fmt(1 / (1 + live.odds))}` : '—'
          ) : (
            `${money(priceAtPoint(stock.soldPct, state.settings.tiers))}/%`
          )}
        </div>
      </div>
      {!horse && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
          <div className="h-full bg-pink" style={{ width: `${Math.min(100, stock.soldPct)}%` }} />
        </div>
      )}
      <div className="mt-1 flex justify-between font-mono text-[11px] text-dim">
        <span>{horse ? `win pool ${money(pool)}` : `${stock.soldPct}% sold`}</span>
        <span>{mine > 0 ? (horse ? `you bet ${money(mine)}` : `you own ${mine}%`) : ''}</span>
      </div>
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

function Market({ me }) {
  const { state, dispatch } = useGame();
  const now = useNow();
  const [sheet, setSheet] = useState(null);
  const [reporting, setReporting] = useState(false);
  const horse = state.settings.style === 'horse';
  const r = currentRound(state);
  const phase = roundPhase(state, now);
  const mine = r ? groupOf(state, me.pid) : null;
  const player = state.players[me.pid];

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
  if (state.status === 'complete') {
    const lb = leaderboard(state);
    const row = lb.find((x) => x.id === me.pid);
    return (
      <Card>
        <div className="font-display text-xl font-extrabold">Tournament over</div>
        <p className="text-sm text-muted">You finished #{row.rank} with {money(row.worth)}. Winner: {lb[0].name}.</p>
      </Card>
    );
  }
  if (player.eliminated)
    return (
      <Card>
        <b>You're out of the tournament.</b>
        <p className="text-sm text-muted">Your net worth dropped below the minimum {state.settings.style === 'horse' ? `bet (${money(state.settings.minBet)})` : `buy-in (${money(minSelfCost(state.settings))})`}. You can still follow the Board.</p>
      </Card>
    );

  const map = ratingMap(state);
  const myGroupStocks = mine ? mine.playerIds.map((id) => state.stocks[r.stockByPlayer[id]]) : [];
  const others = r.groups.filter((g) => g.id !== mine?.id);
  const ev = r.event && r.event.status === 'applied' ? describeEvent(state, r.event) : null;
  const tap = (s) => setSheet(s);
  const gain = roundResultFor(state, me);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase text-dim">
            Round {r.n} of {state.settings.rounds}
            {isFinalRound(state) && (horse ? ` · final +${state.settings.houseBonusFinalPct}% pools` : ` · final ×${state.settings.finalRoundMult}`)}
          </div>
          <div className="font-display text-xl font-extrabold">{PHASE_LABELS[phase]}</div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {phase === 'self' && r.selfEndsAt && <Chip tone="amber">{fmtClock(r.selfEndsAt - now)}</Chip>}
          {state.settings.showOdds && <OddsToggle />}
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
      {phase === 'open' && mine && !horse && (() => {
        const end = openEndsAt(state);
        const closed = marketClosed(state, now);
        const dc = doneCount(state);
        const iAmDone = !!r.done?.[me.pid];
        return (
          <Card className={closed ? 'border-amber' : ''}>
            {closed ? (
              <>
                <b>Market closed</b>
                <p className="text-sm text-muted">No more buying. The organizer will lock the round when the matches start.</p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <b>{iAmDone ? "You're done buying" : 'Market open'}</b>
                  {end != null && <Chip tone="amber">{fmtClock(end - now)}</Chip>}
                </div>
                <p className="mt-1 text-sm text-muted">
                  {dc.done}/{dc.total} done buying. The market closes when the timer ends or everyone is done.
                </p>
                <Btn small kind="ghost" className="mt-2" onClick={() => dispatch({ type: 'doneBuying', pid: me.pid, pinHash: me.pinHash, undo: iAmDone })}>
                  {iAmDone ? 'Undo, I want to buy more' : "I'm done buying"}
                </Btn>
              </>
            )}
          </Card>
        );
      })()}
      {phase === 'self' && mine && (
        <Card className="text-sm text-muted">
          {horse
            ? `Bet at least ${money(minSelfCost(state.settings))} on yourself. Everyone else's runners open when the timer ends or everyone has bet in.`
            : `Buy at least ${state.settings.minSelfBuyPct}% of your own stock. Everyone else's stocks open when the timer ends or everyone has bought in.`}
        </Card>
      )}
      {phase === 'locked' && mine && (
        <Card>
          <b>Match in progress</b>
          <p className="text-sm text-muted">Trading is frozen. When your group finishes, anyone in it can report the order.</p>
          {mine.places ? (
            <p className="mt-2 text-sm text-mint">The organizer has the result. Waiting for payout.</p>
          ) : (
            <Btn className="mt-3" onClick={() => setReporting(true)}>{mine.reports.some((x) => x.by === me.pid) ? 'Change my report' : 'Report result'}</Btn>
          )}
        </Card>
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
          {ev && <p className="text-sm text-amber">Market event: {ev.name}. {ev.blurb}</p>}
          <p className="mt-1 text-sm text-muted">
            Winnings were added to your cash automatically.
            {gain !== 0 && <> This round: <b className={gain > 0 ? 'text-mint' : 'text-pink'}>{gain > 0 ? '+' : ''}{money(gain)}</b>.</>}
          </p>
        </Card>
      )}

      {mine && (
        <div>
          <Label>Your match · {state.machines[mine.machineId]?.name}</Label>
          <div className="space-y-2">
            {myGroupStocks.map((s) => (
              <StockRow key={s.id} stock={s} me={me} map={map} onTap={() => tap(s)} />
            ))}
          </div>
        </div>
      )}
      {others.map((g) => (
        <div key={g.id}>
          <Label>{state.machines[g.machineId]?.name}</Label>
          <div className="space-y-2">
            {g.playerIds.map((id) => (
              <StockRow key={id} stock={state.stocks[r.stockByPlayer[id]]} me={me} map={map} onTap={() => tap(state.stocks[r.stockByPlayer[id]])} />
            ))}
          </div>
        </div>
      ))}
      {sheet && (horse ? <BetSheet stock={sheet} me={me} onClose={() => setSheet(null)} /> : <StockSheet stock={sheet} me={me} onClose={() => setSheet(null)} />)}
      {reporting && <ReportSheet group={mine} me={me} onClose={() => setReporting(false)} />}
    </div>
  );
}

// ---------- matches ----------
function Matches({ me }) {
  const { state } = useGame();
  const fmt = useOddsFmt();
  const r = currentRound(state);
  if (!r) return <Card className="text-sm text-muted">Machines are assigned when the round starts.</Card>;
  const mineId = groupOf(state, me.pid)?.id;
  const map = ratingMap(state);
  const horse = state.settings.style === 'horse';
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="font-mono text-[11px] uppercase text-dim">Round {r.n} of {state.settings.rounds}</div>
        {state.settings.showOdds && <OddsToggle />}
      </div>
      {r.groups.map((g) => {
        const odds = state.settings.showOdds ? groupOdds(state, g, map) : null;
        return (
          <Card key={g.id} className={g.id === mineId ? 'border-pink' : ''}>
            <div className="flex items-center justify-between">
              <div className="font-display text-xl font-extrabold">{state.machines[g.machineId]?.name}</div>
              {g.id === mineId && <Chip tone="pink">your match</Chip>}
            </div>
            <div className="mt-2 space-y-1">
              {g.playerIds.map((id) => (
                <div key={id} className="flex items-center justify-between text-sm">
                  <span className={id === me.pid ? 'font-bold' : 'text-muted'}>{state.players[id].name}</span>
                  {odds && <span className="font-mono text-xs text-dim">{fmt(odds[id].win)}</span>}
                </div>
              ))}
            </div>
          </Card>
        );
      })}
      <MyIfpa me={me} />
    </div>
  );
}

// ---------- portfolio ----------
function Portfolio({ me }) {
  const { state } = useGame();
  const now = useNow();
  const horse = state.settings.style === 'horse';
  const p = state.players[me.pid];
  const { dispatch } = useGame();

  if (horse) {
    const mine = Object.values(state.bets || {}).filter((b) => b.bettorId === me.pid).sort((a, b) => b.round - a.round);
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2">
          <Card><Label>Cash</Label><div className="font-mono text-xl font-bold">{money(p.cash)}</div></Card>
          <Card><Label>Net worth</Label><div className="font-mono text-xl font-bold text-mint">{money(netWorth(state, me.pid))}</div></Card>
        </div>
        <Label>My bets</Label>
        {!mine.length && <Card className="text-sm text-muted">No bets yet. Place one on the Market tab.</Card>}
        {mine.map((b) => {
          const stock = state.stocks[b.stockId];
          const net = b.payout - b.amount;
          return (
            <Card key={b.id}>
              <div className="flex items-center justify-between">
                <div>
                  <b>{KIND_LABEL[b.kind]}: {state.players[stock.playerId].name}</b> <span className="text-xs text-dim">R{b.round}</span>
                  <div className="font-mono text-xs text-muted">bet {money(b.amount)}</div>
                </div>
                {b.status === 'paid' ? (
                  <Chip tone={net >= 0 ? 'mint' : 'pink'}>{net >= 0 ? '+' : ''}{money(net)}</Chip>
                ) : (
                  <Chip>{stock.status === 'locked' ? 'locked' : 'open'}</Chip>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    );
  }

  const held = heldPositions(state, me.pid);
  const done = Object.values(state.positions)
    .filter((x) => x.holderId === me.pid && x.status === 'sold')
    .sort((a, b) => state.stocks[b.stockId].round - state.stocks[a.stockId].round);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Card><Label>Cash</Label><div className="font-mono text-xl font-bold">{money(p.cash)}</div></Card>
        <Card><Label>Net worth</Label><div className="font-mono text-xl font-bold text-mint">{money(netWorth(state, me.pid))}</div></Card>
      </div>
      <Label>This round</Label>
      {!held.length && <Card className="text-sm text-muted">Nothing yet. Buy some stock on the Market tab.</Card>}
      {held.map((pos) => {
        const stock = state.stocks[pos.stockId];
        const chk = checkSell(state, me.pid, pos.id, now);
        return (
          <Card key={pos.id}>
            <div className="flex items-center justify-between">
              <div>
                <b>{state.players[stock.playerId].name}</b> <span className="text-xs text-dim">R{stock.round}</span>
                <div className="font-mono text-xs text-muted">{pos.pct}% · paid {money(pos.cost)}</div>
              </div>
              <Chip>{stock.status === 'locked' ? 'frozen' : 'open'}</Chip>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-dim">{!chk.ok ? chk.error : ''}</span>
              <Btn small kind="ghost" disabled={!chk.ok} onClick={() => dispatch({ type: 'sell', pid: me.pid, pinHash: me.pinHash, positionId: pos.id })}>
                Sell at cost
              </Btn>
            </div>
          </Card>
        );
      })}
      {done.length > 0 && (
        <>
          <Label>Results (cashed out automatically)</Label>
          {done.map((pos) => {
            const stock = state.stocks[pos.stockId];
            const net = pos.soldValue - pos.cost;
            return (
              <div key={pos.id} className="flex items-center justify-between text-sm">
                <span className="text-muted">
                  {state.players[stock.playerId].name} R{stock.round} · {pos.pct}%
                  {stock.status === 'resolved' && ` · ${ordinal(stock.place)}`}
                </span>
                <span className={cx('font-mono', pos.soldAfter ? (net >= 0 ? 'text-mint' : 'text-pink') : 'text-dim')}>
                  {pos.soldAfter ? `${net >= 0 ? '+' : ''}${money(net)}` : 'sold early'}
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ---------- board ----------
function Board({ me }) {
  const { state } = useGame();
  const lb = leaderboard(state);
  return (
    <div className="space-y-2">
      {lb.map((r) => (
        <div key={r.id} className={cx('flex items-center justify-between rounded-xl border bg-surface px-4 py-3', r.id === me.pid ? 'border-pink' : 'border-line', r.withdrawn && 'opacity-60')}>
          <div className="flex items-center gap-3">
            <span className="w-6 font-mono text-dim">{r.withdrawn ? '–' : r.rank}</span>
            <b className={r.eliminated ? 'text-dim line-through' : ''}>{r.name}</b>
            {r.withdrawn && <Chip>withdrawn</Chip>}
          </div>
          <span className="font-mono font-bold">{money(r.worth)}</span>
        </div>
      ))}
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

  const tabs = [['market', 'Market'], ['matches', 'Matches'], ['portfolio', 'Portfolio'], ['board', 'Board']];
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-24 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="font-display text-lg font-extrabold">Silverball <span className="text-pink">Exchange</span></div>
        <button className="text-xs text-dim" onClick={logout}>{state.players[me.pid].name} · log out</button>
      </div>
      {tab === 'market' && <Market me={me} />}
      {tab === 'matches' && <Matches me={me} />}
      {tab === 'portfolio' && <Portfolio me={me} />}
      {tab === 'board' && <Board me={me} />}
      <nav className="fixed bottom-0 left-0 right-0 border-t border-line bg-ink">
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
