import React, { useEffect, useMemo, useState } from 'react';
import { useGame, useNow } from './game.jsx';
import { Btn, Card, Chip, Input, Label, OrderPicker, Sheet, cx, fmtClock, orderComplete } from './ui.jsx';
import {
  activePlayers, checkBuy, checkSell, currentRound, describeEvent, groupOf, hashPin, heldPct,
  heldPositions, isFinalRound, leaderboard, maxBuyable, minSelfCost, money, netWorth, ordinal, payoutFor,
  priceAtPoint, roundPhase, PHASE_LABELS,
} from './engine/index.js';

const SESSION_KEY = 'silverball-session';
const loadSession = () => {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || null;
  } catch {
    return null;
  }
};

// ---------- sign in / claim ----------
function Claim({ onDone }) {
  const { state, dispatch, setToast } = useGame();
  const alertToast = (msg) => setToast({ msg, id: Date.now() });
  const [pid, setPid] = useState(null);
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const p = pid && state.players[pid];

  if (!state.playerOrder.length)
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
          {state.playerOrder.map((id) => (
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
    if (!/^\d{4,8}$/.test(pin)) return alertToast('PIN must be 4-8 digits');
    const h = await hashPin(pin, pid);
    if (isNew) {
      if (pin !== pin2) return alertToast('PINs do not match');
      const ok = await dispatch({ type: 'claimPlayer', pid, pinHash: h });
      if (!ok) return;
    } else if (h !== p.pinHash) return alertToast('Wrong PIN');
    localStorage.setItem(SESSION_KEY, JSON.stringify({ pid, pinHash: h }));
    onDone({ pid, pinHash: h });
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
          <Input type="password" inputMode="numeric" placeholder="Repeat PIN" value={pin2} onChange={(e) => setPin2(e.target.value)} />
        )}
        <Btn onClick={go} className="w-full">{isNew ? 'Claim my name' : 'Log in'}</Btn>
      </div>
    </Shell>
  );
}

const Shell = ({ children }) => <div className="mx-auto min-h-screen max-w-md px-4 py-8">{children}</div>;

// ---------- buy sheet ----------
function BuySheet({ stock, me, onClose }) {
  const { state, dispatch } = useGame();
  const now = useNow();
  const owner = state.players[stock.playerId];
  const own = stock.playerId === me.pid;
  const group = groupOf(state, stock.playerId);
  const held = heldPct(state, me.pid, stock.id);
  const [pct, setPct] = useState(own ? Math.max(1, state.settings.minSelfBuyPct - held) : 5);
  const max = maxBuyable(state, me.pid, stock.id, now);
  const chk = checkBuy(state, me.pid, stock.id, pct, now);
  const size = group.playerIds.length;
  const mult = isFinalRound(state) ? state.settings.finalRoundMult : 1;
  const cash = state.players[me.pid].cash;

  return (
    <Sheet title={`${own ? 'Your' : owner.name + "'s"} stock`} onClose={onClose}>
      <div className="mb-3 text-sm text-muted">
        {state.machines[stock.machineId]?.name} · {stock.soldPct}% sold · next 1% costs {money(priceAtPoint(stock.soldPct, state.settings.tiers))}
        {held > 0 && ` · you own ${held}%`}
      </div>
      <div className="mb-3 flex items-center gap-2">
        <Btn kind="ghost" onClick={() => setPct(Math.max(1, pct - 1))}>−</Btn>
        <Input
          inputMode="numeric"
          value={pct}
          onChange={(e) => setPct(Math.max(0, parseInt(e.target.value.replace(/\D/g, ''), 10) || 0))}
          className="text-center text-lg font-bold"
        />
        <Btn kind="ghost" onClick={() => setPct(Math.min(100, pct + 1))}>+</Btn>
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
      <p className="mt-2 text-center text-[11px] text-dim">Market events can shift results after the match. You see them when it pays out.</p>
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
function StockRow({ stock, me, phase, onTap }) {
  const { state } = useGame();
  const owner = state.players[stock.playerId];
  const own = stock.playerId === me.pid;
  const held = heldPct(state, me.pid, stock.id);
  const canTap = stock.status === 'open' && (phase === 'open' || (phase === 'self' && own));
  const price = priceAtPoint(stock.soldPct, state.settings.tiers);
  const resolved = stock.status === 'resolved';
  return (
    <button
      disabled={!canTap}
      onClick={onTap}
      className={cx('w-full rounded-xl border bg-ink p-3 text-left', canTap ? 'border-line' : 'border-line/60 opacity-70')}
    >
      <div className="flex items-center justify-between">
        <div className="font-bold">{owner.name} {own && <Chip tone="pink">you</Chip>}</div>
        <div className="font-mono text-sm">
          {resolved ? <Chip tone={stock.place === 1 ? 'mint' : 'dim'}>{ordinal(stock.place)}</Chip> : `${money(price)}/%`}
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full bg-pink" style={{ width: `${stock.soldPct}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-dim">
        <span>{stock.soldPct}% sold</span>
        <span>{held > 0 ? `you own ${held}%` : ''}</span>
      </div>
    </button>
  );
}

function Market({ me }) {
  const { state } = useGame();
  const now = useNow();
  const [buying, setBuying] = useState(null);
  const [reporting, setReporting] = useState(false);
  const r = currentRound(state);
  const phase = roundPhase(state, now);
  const mine = groupOf(state, me.pid);
  const player = state.players[me.pid];

  if (state.status === 'setup')
    return (
      <Card>
        <b>You're in, {player.name}.</b>
        <p className="text-sm text-muted">Waiting for the organizer to start round 1. {state.playerOrder.filter((i) => state.players[i].claimed).length}/{state.playerOrder.length} have claimed their names.</p>
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
        <p className="text-sm text-muted">Your net worth dropped below the minimum buy-in ({money(minSelfCost(state.settings))}). You can still follow the Board.</p>
      </Card>
    );

  const myGroupStocks = mine ? mine.playerIds.map((id) => state.stocks[r.stockByPlayer[id]]) : [];
  const others = r.groups.filter((g) => g.id !== mine?.id);
  const ev = r.event && r.event.status === 'applied' ? describeEvent(state, r.event) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-mono text-[11px] uppercase text-dim">Round {r.n} of {state.settings.rounds}{isFinalRound(state) && ' · final ×' + state.settings.finalRoundMult}</div>
          <div className="font-display text-xl font-extrabold">{PHASE_LABELS[phase]}</div>
        </div>
        {phase === 'self' && r.selfEndsAt && <Chip tone="amber">{fmtClock(r.selfEndsAt - now)}</Chip>}
      </div>

      {phase === 'self' && (
        <Card className="text-sm text-muted">
          Buy at least {state.settings.minSelfBuyPct}% of your own stock. Everyone else's stocks open when the timer ends or everyone has bought in.
        </Card>
      )}
      {phase === 'locked' && (
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
          {ev && (
            <p className="text-sm text-amber">
              Market event: {ev.name}. {ev.blurb}
            </p>
          )}
          <p className="mt-1 text-sm text-muted">Sell resolved stocks from your Portfolio to bank the cash. Next round starts when the organizer says.</p>
        </Card>
      )}

      {mine && (
        <div>
          <Label>Your match · {state.machines[mine.machineId]?.name}</Label>
          <div className="space-y-2">
            {myGroupStocks.map((s) => (
              <StockRow key={s.id} stock={s} me={me} phase={phase} onTap={() => setBuying(s)} />
            ))}
          </div>
        </div>
      )}
      {others.map((g) => (
        <div key={g.id}>
          <Label>{state.machines[g.machineId]?.name}</Label>
          <div className="space-y-2">
            {g.playerIds.map((id) => (
              <StockRow key={id} stock={state.stocks[r.stockByPlayer[id]]} me={me} phase={phase} onTap={() => setBuying(state.stocks[r.stockByPlayer[id]])} />
            ))}
          </div>
        </div>
      ))}
      {buying && <BuySheet stock={buying} me={me} onClose={() => setBuying(null)} />}
      {reporting && <ReportSheet group={mine} me={me} onClose={() => setReporting(false)} />}
    </div>
  );
}

// ---------- portfolio ----------
function Portfolio({ me }) {
  const { state, dispatch } = useGame();
  const now = useNow();
  const p = state.players[me.pid];
  const held = heldPositions(state, me.pid).sort((a, b) => b.stockId.localeCompare(a.stockId));
  const sold = Object.values(state.positions).filter((x) => x.holderId === me.pid && x.status === 'sold');
  const hasResolved = held.some((x) => state.stocks[x.stockId].status === 'resolved');
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <Card>
          <Label>Cash</Label>
          <div className="font-mono text-xl font-bold">{money(p.cash)}</div>
        </Card>
        <Card>
          <Label>Net worth</Label>
          <div className="font-mono text-xl font-bold text-mint">{money(netWorth(state, me.pid))}</div>
        </Card>
      </div>
      {hasResolved && (
        <Btn kind="mint" className="w-full" onClick={() => dispatch({ type: 'sellAllResolved', pid: me.pid, pinHash: me.pinHash })}>
          Sell all resolved stocks
        </Btn>
      )}
      <Label>Holdings</Label>
      {!held.length && <Card className="text-sm text-muted">Nothing yet. Buy some stock on the Market tab.</Card>}
      {held.map((pos) => {
        const stock = state.stocks[pos.stockId];
        const chk = checkSell(state, me.pid, pos.id, now);
        const gain = pos.value - pos.cost;
        return (
          <Card key={pos.id}>
            <div className="flex items-center justify-between">
              <div>
                <b>{state.players[stock.playerId].name}</b> <span className="text-xs text-dim">R{stock.round}</span>
                <div className="font-mono text-xs text-muted">{pos.pct}% · paid {money(pos.cost)}</div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold">{money(chk.ok ? chk.value : pos.value)}</div>
                {stock.status === 'resolved' ? (
                  <Chip tone={gain >= 0 ? 'mint' : 'pink'}>{ordinal(stock.place)} · {gain >= 0 ? '+' : ''}{money(gain)}</Chip>
                ) : (
                  <Chip>{stock.status === 'locked' ? 'frozen' : 'open'}</Chip>
                )}
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xs text-dim">{!chk.ok ? chk.error : ''}</span>
              <Btn small kind="ghost" disabled={!chk.ok} onClick={() => dispatch({ type: 'sell', pid: me.pid, pinHash: me.pinHash, positionId: pos.id })}>
                Sell
              </Btn>
            </div>
          </Card>
        );
      })}
      {sold.length > 0 && (
        <>
          <Label>Sold</Label>
          {sold.map((pos) => (
            <div key={pos.id} className="flex justify-between text-sm text-muted">
              <span>{state.players[state.stocks[pos.stockId].playerId].name} R{state.stocks[pos.stockId].round} · {pos.pct}%</span>
              <span className="font-mono">{money(pos.soldValue)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ---------- board ----------
// Every group's machine and players, for everyone to see.
function Matches({ me }) {
  const { state } = useGame();
  const r = currentRound(state);
  if (!r) return <Card className="text-sm text-muted">Machines are assigned when the round starts.</Card>;
  const mineId = groupOf(state, me.pid)?.id;
  return (
    <div className="space-y-3">
      <div className="font-mono text-[11px] uppercase text-dim">Round {r.n} of {state.settings.rounds}</div>
      {r.groups.map((g) => (
        <Card key={g.id} className={g.id === mineId ? 'border-pink' : ''}>
          <div className="flex items-center justify-between">
            <div className="font-display text-xl font-extrabold">{state.machines[g.machineId]?.name}</div>
            {g.id === mineId && <Chip tone="pink">your match</Chip>}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {g.playerIds.map((id) => (
              <span key={id} className={cx('rounded-full border px-3 py-1 text-sm', id === me.pid ? 'border-pink text-ivory' : 'border-line text-muted')}>
                {state.players[id].name}
              </span>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Board({ me }) {
  const { state } = useGame();
  const lb = leaderboard(state);
  return (
    <div className="space-y-2">
      {lb.map((r) => (
        <div key={r.id} className={cx('flex items-center justify-between rounded-xl border bg-surface px-4 py-3', r.id === me.pid ? 'border-pink' : 'border-line')}>
          <div className="flex items-center gap-3">
            <span className="w-6 font-mono text-dim">{r.rank}</span>
            <b className={r.eliminated ? 'text-dim line-through' : ''}>{r.name}</b>
          </div>
          <span className="font-mono font-bold">{money(r.worth)}</span>
        </div>
      ))}
    </div>
  );
}

// ---------- app shell ----------
export default function PlayerApp() {
  const { state, ready } = useGame();
  const [me, setMe] = useState(loadSession);
  const [tab, setTab] = useState('market');

  useEffect(() => {
    if (me && ready && !state.players[me.pid]) {
      localStorage.removeItem(SESSION_KEY);
      setMe(null);
    }
  }, [me, ready, state.players]);

  if (!ready) return <Shell>Loading…</Shell>;
  if (!me || !state.players[me.pid]) return <Claim onDone={setMe} />;

  const logout = () => {
    localStorage.removeItem(SESSION_KEY);
    setMe(null);
  };
  const tabs = [['market', 'Market'], ['matches', 'Matches'], ['portfolio', 'Portfolio'], ['board', 'Board']];
  return (
    <div className="mx-auto min-h-screen max-w-md px-4 pb-24 pt-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="font-display text-lg font-extrabold">Silverball <span className="text-pink">Exchange</span></div>
        <button className="text-xs text-dim" onClick={logout}>{state.players[me.pid].name} · log out</button>
      </div>
      {tab === 'market' && <Market me={me} />}
      {tab === 'portfolio' && <Portfolio me={me} />}
      {tab === 'matches' && <Matches me={me} />}
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
