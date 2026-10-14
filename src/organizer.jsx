import React, { useEffect, useState } from 'react';
import { useGame, useNow } from './game.jsx';
import { useAuthUser, signIn, signOutUser } from './auth.js';
import { isLocal } from './firebase.js';
import { Btn, Card, Chip, Input, Label, OrderPicker, Select, cx, fmtClock, orderComplete } from './ui.jsx';
import { exportCsv, exportJson } from './export.js';
import {
  PHASE_LABELS, activePlayers, allBoughtIn, computeFix, currentRound, describeEvent, eventDelta,
  groupOf, isFinalRound, leaderboard, minSelfCost, money, ordinal, roundPhase,
} from './engine/index.js';

const splitLines = (t) => t.split(/[\n,]+/).map((x) => x.trim()).filter(Boolean);

function useOrg() {
  const { dispatch } = useGame();
  const user = useAuthUser();
  return { user, send: (type, extra = {}) => dispatch({ type, actor: user?.email, ...extra }) };
}

// ---------- Round ----------
function SettingsCard({ send }) {
  const { state } = useGame();
  const st = state.settings;
  const [d, setD] = useState(null);
  const open = d !== null;
  const start = () =>
    setD({
      startingCash: String(st.startingCash), rounds: String(st.rounds), minSelfBuyPct: String(st.minSelfBuyPct),
      maxPctPerStock: st.maxPctPerStock ?? '', maxSelfBuyPct: st.maxSelfBuyPct ?? '',
      tiers: st.tiers.map((t) => `${t.upTo}:${t.price}`).join(', '),
      payout4: st.payout4.join(', '), payout3: st.payout3.join(', '), payout2: st.payout2.join(', '),
      finalRoundMult: String(st.finalRoundMult), selfBuySeconds: String(st.selfBuySeconds),
    });
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const nums = (t) => t.split(',').map((x) => parseFloat(x.trim()));
  const save = async () => {
    const opt = (v) => (String(v).trim() === '' ? null : parseInt(v, 10));
    const patch = {
      startingCash: parseFloat(d.startingCash), rounds: parseInt(d.rounds, 10), minSelfBuyPct: parseInt(d.minSelfBuyPct, 10),
      maxPctPerStock: opt(d.maxPctPerStock), maxSelfBuyPct: opt(d.maxSelfBuyPct),
      tiers: d.tiers.split(',').map((x) => {
        const [u, p] = x.trim().split(':').map(Number);
        return { upTo: u, price: p };
      }),
      payout4: nums(d.payout4), payout3: nums(d.payout3), payout2: nums(d.payout2),
      finalRoundMult: parseFloat(d.finalRoundMult), selfBuySeconds: parseInt(d.selfBuySeconds, 10),
    };
    if (await send('updateSettings', { patch })) setD(null);
  };
  const row = (label, k, hint) => (
    <div>
      <Label>{label}</Label>
      <Input value={d[k]} onChange={set(k)} placeholder={hint} />
    </div>
  );
  return (
    <Card>
      <div className="flex items-center justify-between">
        <b>Settings</b>
        {!open && <Btn small kind="ghost" onClick={start}>Edit</Btn>}
      </div>
      {!open ? (
        <div className="mt-2 space-y-1 font-mono text-xs text-muted">
          <div>Start {money(st.startingCash)} · {st.rounds} rounds · min self-buy {st.minSelfBuyPct}% ({money(minSelfCost(st))})</div>
          <div>Max per stock {st.maxPctPerStock ?? 'none'} · max self-buy {st.maxSelfBuyPct ?? 'none'} · self-buy window {st.selfBuySeconds}s</div>
          <div>Tiers {st.tiers.map((t) => `≤${t.upTo}%:$${t.price}`).join(' ')}</div>
          <div>Payout 4p {st.payout4.join('/')} · 3p {st.payout3.join('/')} · 2p {st.payout2.join('/')} · final ×{st.finalRoundMult}</div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {row('Starting cash', 'startingCash')}
          {row('Rounds', 'rounds')}
          {row('Min self-buy %', 'minSelfBuyPct')}
          {row('Max % per stock (blank = none)', 'maxPctPerStock')}
          {row('Max self-buy % (blank = none)', 'maxSelfBuyPct')}
          {row('Self-buy window (seconds)', 'selfBuySeconds')}
          {row('Price tiers (upTo:price, …)', 'tiers', '25:10, 50:12, 75:15, 100:20')}
          {row('Payout % for 4 players (1st…4th)', 'payout4')}
          {row('Payout % for 3 players', 'payout3')}
          {row('Payout % for 2 players', 'payout2')}
          {row('Final round multiplier', 'finalRoundMult')}
          <div className="flex gap-2">
            <Btn onClick={save}>Save</Btn>
            <Btn kind="ghost" onClick={() => setD(null)}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

function EventCard({ send }) {
  const { state } = useGame();
  const r = currentRound(state);
  const ev = r.event;
  const info = describeEvent(state, ev);
  const hits = [];
  for (const g of r.groups)
    for (const pid of g.playerIds) {
      const stock = state.stocks[r.stockByPlayer[pid]];
      const d = eventDelta(ev, stock, g.places.indexOf(pid) + 1, g.playerIds.length);
      if (d) hits.push(`${state.players[pid].name} ${d > 0 ? '+' : ''}${d}`);
    }
  return (
    <Card className="border-amber">
      <Label>Market event · only you can see this</Label>
      <div className="font-display text-xl font-extrabold text-amber">{info.name}</div>
      <p className="mb-2 text-sm text-muted">{info.blurb}</p>
      <p className="mb-3 font-mono text-xs text-dim">{hits.length ? hits.join(' · ') : 'Nobody affected'}</p>
      <div className="flex flex-wrap gap-2">
        <Btn kind="mint" onClick={() => send('applyEvent')}>Apply &amp; pay out</Btn>
        <Btn kind="ghost" onClick={() => send('rerollEvent')}>Re-roll</Btn>
        <Btn kind="danger" onClick={() => send('skipEvent')}>Skip event</Btn>
      </div>
    </Card>
  );
}

function RoundTab({ send }) {
  const { state } = useGame();
  const now = useNow();
  const [override, setOverride] = useState(false);
  const r = currentRound(state);
  const phase = roundPhase(state, now);
  const claimed = state.playerOrder.filter((id) => state.players[id].claimed).length;
  const avail = state.machineOrder.filter((id) => !state.machines[id].pulled).length;

  if (state.status === 'setup') {
    const needGroups = Math.ceil(state.playerOrder.length / 4);
    return (
      <div className="space-y-3">
        <Card>
          <b>Ready to start?</b>
          <div className="mt-2 space-y-1 text-sm text-muted">
            <div>{claimed}/{state.playerOrder.length} players have claimed their names</div>
            <div>{avail} machines available (need at least {needGroups})</div>
          </div>
          {claimed < state.playerOrder.length && (
            <label className="mt-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Start anyway
            </label>
          )}
          <Btn className="mt-3 w-full" onClick={() => send('startTournament', { override })}>Start round 1</Btn>
        </Card>
        <SettingsCard send={send} />
      </div>
    );
  }
  if (state.status === 'complete') return <Card><b>Tournament finished.</b> See Wrap-up for exports.</Card>;

  return (
    <div className="space-y-3">
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <div className="font-mono text-[11px] uppercase text-dim">Round {r.n} of {state.settings.rounds}{isFinalRound(state) && ' · final'}</div>
            <div className="font-display text-xl font-extrabold">{PHASE_LABELS[phase]}</div>
          </div>
          {phase === 'self' && r.selfEndsAt && <Chip tone="amber">{fmtClock(r.selfEndsAt - now)}</Chip>}
        </div>
        {phase === 'self' && (
          <>
            <p className="mt-2 text-sm text-muted">{Object.keys(r.stockByPlayer).filter((pid) => state.stocks[r.stockByPlayer[pid]].soldPct >= state.settings.minSelfBuyPct).length}/{Object.keys(r.stockByPlayer).length} bought in{allBoughtIn(state) ? '' : ''}</p>
            <div className="mt-3 flex gap-2">
              <Btn kind="mint" onClick={() => send('openTrading')}>Open market now</Btn>
              <Btn kind="ghost" onClick={() => send('lockRound')}>Lock round</Btn>
            </div>
          </>
        )}
        {phase === 'open' && <Btn className="mt-3" onClick={() => send('lockRound')}>Lock round (matches start)</Btn>}
        {phase === 'locked' && (
          <div className="mt-2">
            <p className="text-sm text-muted">{r.groups.filter((g) => g.places).length}/{r.groups.length} results entered. Use the Results tab.</p>
            <Btn className="mt-3" disabled={!r.groups.every((g) => g.places)} onClick={() => send('continueFromResults')}>
              {isFinalRound(state) ? 'Pay out final round' : 'Continue to market event'}
            </Btn>
          </div>
        )}
        {phase === 'paid' && (
          <div className="mt-3">
            {state.round < state.settings.rounds && activePlayers(state).length >= 2 ? (
              <Btn onClick={() => send('nextRound')}>Start round {state.round + 1}</Btn>
            ) : (
              <Btn onClick={() => send('finishTournament')}>Finish tournament</Btn>
            )}
          </div>
        )}
      </Card>
      {phase === 'event' && <EventCard send={send} />}
      <Label>Groups</Label>
      {r.groups.map((g) => (
        <Card key={g.id}>
          <div className="mb-1 flex items-center justify-between">
            <b>{state.machines[g.machineId]?.name}</b>
            {['self', 'open', 'locked'].includes(phase) && (
              <Select
                className="!w-auto !py-1 text-xs"
                value=""
                onChange={(e) => e.target.value && send('swapMachine', { groupId: g.id, machineId: e.target.value })}
              >
                <option value="">Swap machine…</option>
                {state.machineOrder
                  .filter((id) => !state.machines[id].pulled && !r.groups.some((x) => x.machineId === id))
                  .map((id) => <option key={id} value={id}>{state.machines[id].name}</option>)}
              </Select>
            )}
          </div>
          <div className="text-sm text-muted">{g.playerIds.map((id) => state.players[id].name).join(', ')}</div>
        </Card>
      ))}
      <SettingsCard send={send} />
    </div>
  );
}

// ---------- Results ----------
function ResultsTab({ send }) {
  const { state } = useGame();
  const now = useNow();
  const r = currentRound(state);
  const [drafts, setDrafts] = useState({});
  if (!r) return <Card className="text-sm text-muted">No round yet.</Card>;
  const phase = roundPhase(state, now);
  const name = (id) => state.players[id].name;
  const names = (g) => Object.fromEntries(g.playerIds.map((id) => [id, name(id)]));
  return (
    <div className="space-y-3">
      {phase !== 'locked' && <Card className="text-sm text-muted">Results open once the round is locked. Corrections after payout are on the Uh oh tab.</Card>}
      {r.groups.map((g) => {
        const draft = drafts[g.id] || [];
        return (
          <Card key={g.id}>
            <div className="mb-2 flex items-center justify-between">
              <b>{state.machines[g.machineId]?.name}</b>
              {g.places ? <Chip tone="mint">result in</Chip> : <Chip tone="amber">waiting</Chip>}
            </div>
            {g.places && (
              <p className="mb-2 text-sm">{g.places.map((id, i) => `${ordinal(i + 1)} ${name(id)}`).join(' · ')}</p>
            )}
            {g.reports.map((rep) => (
              <div key={rep.id} className="mb-2 rounded-xl border border-line bg-ink p-3 text-sm">
                <div className="text-xs text-dim">Reported by {name(rep.by)}</div>
                <div>{rep.order.map((id, i) => `${ordinal(i + 1)} ${name(id)}`).join(' · ')}</div>
                {phase === 'locked' && (
                  <div className="mt-2 flex gap-2">
                    <Btn small kind="mint" onClick={() => send('approveReport', { groupId: g.id, reportId: rep.id })}>Approve</Btn>
                    <Btn small kind="ghost" onClick={() => send('sendBack', { groupId: g.id, reportId: rep.id })}>Send back</Btn>
                  </div>
                )}
              </div>
            ))}
            {phase === 'locked' && (
              <>
                <Label>Or set places yourself</Label>
                <OrderPicker ids={g.playerIds} names={names(g)} value={draft} onChange={(v) => setDrafts({ ...drafts, [g.id]: v })} />
                <div className="mt-3 flex gap-2">
                  <Btn small disabled={!orderComplete(g.playerIds, draft)} onClick={() => send('setPlaces', { groupId: g.id, order: draft })}>Save places</Btn>
                  {g.places && <Btn small kind="ghost" onClick={() => send('clearPlaces', { groupId: g.id })}>Clear</Btn>}
                </div>
              </>
            )}
          </Card>
        );
      })}
      {phase === 'locked' && (
        <Btn className="w-full" disabled={!r.groups.every((g) => g.places)} onClick={() => send('continueFromResults')}>
          {isFinalRound(state) ? 'Pay out final round' : 'Continue to market event'}
        </Btn>
      )}
    </div>
  );
}

// ---------- Machines ----------
function MachinesTab({ send }) {
  const { state } = useGame();
  const [text, setText] = useState('');
  const used = new Set(currentRound(state)?.groups.map((g) => g.machineId) || []);
  return (
    <div className="space-y-3">
      <Card>
        <Label>Add machines (one per line or comma separated)</Label>
        <textarea className="h-24 w-full rounded-xl border border-line bg-ink p-3 text-sm outline-none focus:border-pink" value={text} onChange={(e) => setText(e.target.value)} />
        <Btn className="mt-2" onClick={async () => { if (await send('addMachines', { names: splitLines(text) })) setText(''); }}>Add</Btn>
      </Card>
      <div className="text-sm text-muted">{state.machineOrder.filter((id) => !state.machines[id].pulled).length} available of {state.machineOrder.length}</div>
      {state.machineOrder.map((id) => {
        const m = state.machines[id];
        return (
          <div key={id} className="flex items-center justify-between rounded-xl border border-line bg-surface px-4 py-2.5">
            <span className={cx('text-sm font-bold', m.pulled && 'text-dim line-through')}>
              {m.name} {used.has(id) && <Chip tone="mint">in play</Chip>}
            </span>
            <div className="flex gap-2">
              <Btn small kind="ghost" onClick={() => send(m.pulled ? 'restoreMachine' : 'pullMachine', { machineId: id })}>{m.pulled ? 'Restore' : 'Pull'}</Btn>
              <Btn small kind="danger" onClick={() => send('removeMachine', { machineId: id })}>✕</Btn>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Roster ----------
function RosterTab({ send }) {
  const { state } = useGame();
  const [text, setText] = useState('');
  return (
    <div className="space-y-3">
      <Card>
        <Label>Add players (paste a list, one per line)</Label>
        <textarea className="h-24 w-full rounded-xl border border-line bg-ink p-3 text-sm outline-none focus:border-pink" value={text} onChange={(e) => setText(e.target.value)} />
        <Btn className="mt-2" onClick={async () => { if (await send('addPlayers', { names: splitLines(text) })) setText(''); }}>Add</Btn>
      </Card>
      <div className="text-sm text-muted">{state.playerOrder.filter((i) => state.players[i].claimed).length}/{state.playerOrder.length} claimed</div>
      {state.playerOrder.map((id) => {
        const p = state.players[id];
        return (
          <div key={id} className="rounded-xl border border-line bg-surface px-4 py-2.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{p.name}</span>
              <span className="flex gap-1">
                {p.eliminated && <Chip tone="pink">out</Chip>}
                <Chip tone={p.claimed ? 'mint' : 'amber'}>{p.claimed ? 'claimed' : 'open'}</Chip>
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn small kind="ghost" onClick={() => { const n = window.prompt('New name', p.name); if (n) send('renamePlayer', { pid: id, name: n }); }}>Rename</Btn>
              {p.claimed && <Btn small kind="ghost" onClick={() => send('unclaimPlayer', { pid: id })}>Unclaim / reset PIN</Btn>}
              {state.status === 'setup' && <Btn small kind="danger" onClick={() => send('removePlayer', { pid: id })}>Remove</Btn>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Wrap-up ----------
function WrapTab({ send }) {
  const { state } = useGame();
  const now = useNow();
  const [confirm, setConfirm] = useState('');
  const lb = leaderboard(state);
  const phase = roundPhase(state, now);
  return (
    <div className="space-y-3">
      <Card>
        <Label>Standings</Label>
        {lb.map((r) => (
          <div key={r.id} className="flex justify-between py-1 text-sm">
            <span>{r.rank}. {r.name}{r.eliminated && ' (out)'}</span>
            <span className="font-mono">{money(r.worth)}</span>
          </div>
        ))}
      </Card>
      <Card>
        <div className="flex gap-2">
          <Btn kind="ghost" onClick={() => exportCsv(state)}>Export standings (CSV)</Btn>
          <Btn kind="ghost" onClick={() => exportJson(state)}>Export history (JSON)</Btn>
        </div>
      </Card>
      {state.status === 'active' && phase === 'paid' && state.round >= state.settings.rounds && (
        <Btn className="w-full" onClick={() => send('finishTournament')}>Finish tournament</Btn>
      )}
      <Card className="border-pink">
        <b className="text-pink">Reset tournament</b>
        <p className="mb-2 text-sm text-muted">Wipes rounds, stocks and cash. Keeps the roster, claimed names, settings and machines.</p>
        <Input placeholder="Type RESET" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Btn kind="danger" className="mt-2" disabled={confirm !== 'RESET'} onClick={async () => { if (await send('resetTournament', { confirm })) setConfirm(''); }}>
          Reset
        </Btn>
      </Card>
    </div>
  );
}

// ---------- Uh oh ----------
function FixTab({ send }) {
  const { state } = useGame();
  const [sel, setSel] = useState('');
  const [order, setOrder] = useState([]);
  const [policy, setPolicy] = useState('leave');
  const [cashPid, setCashPid] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const paid = [];
  state.rounds.forEach((r) => r.groups.forEach((g) => g.paid && paid.push({ round: r.n, g })));
  const cur = paid.find((x) => `${x.round}:${x.g.id}` === sel);
  const names = cur ? Object.fromEntries(cur.g.playerIds.map((id) => [id, state.players[id].name])) : {};
  const changes = cur && orderComplete(cur.g.playerIds, order) ? computeFix(state, cur.round, cur.g.id, order) : [];
  const soldChanges = changes.filter((c) => c.status === 'sold');
  return (
    <div className="space-y-3">
      <Card>
        <b>Fix a result</b>
        <p className="mb-2 text-sm text-muted">Reopen a paid-out match, change the places and see the impact before applying. Market event bonuses stay as they were.</p>
        <Select value={sel} onChange={(e) => { setSel(e.target.value); const x = paid.find((y) => `${y.round}:${y.g.id}` === e.target.value); setOrder(x ? x.g.places.slice() : []); }}>
          <option value="">Choose a match…</option>
          {paid.map((x) => (
            <option key={`${x.round}:${x.g.id}`} value={`${x.round}:${x.g.id}`}>
              Round {x.round} · {state.machines[x.g.machineId]?.name || x.g.machineId}
            </option>
          ))}
        </Select>
        {cur && (
          <div className="mt-3">
            <OrderPicker ids={cur.g.playerIds} names={names} value={order} onChange={setOrder} />
            {changes.length > 0 && (
              <div className="mt-3 rounded-xl border border-line bg-ink p-3 text-xs">
                <Label>Impact</Label>
                {changes.map((c) => (
                  <div key={c.positionId} className="flex justify-between py-0.5">
                    <span>{state.players[c.holderId].name} in {state.players[c.owner].name} {c.status === 'sold' && '(already sold)'}</span>
                    <span className={cx('font-mono', c.delta >= 0 ? 'text-mint' : 'text-pink')}>{c.delta >= 0 ? '+' : ''}{c.delta}</span>
                  </div>
                ))}
              </div>
            )}
            {soldChanges.length > 0 && (
              <div className="mt-3 space-y-1 text-sm">
                <label className="flex gap-2"><input type="radio" checked={policy === 'leave'} onChange={() => setPolicy('leave')} /> Leave cash of players who already sold</label>
                <label className="flex gap-2"><input type="radio" checked={policy === 'adjust'} onChange={() => setPolicy('adjust')} /> Adjust their cash to match</label>
              </div>
            )}
            <Btn className="mt-3" disabled={!orderComplete(cur.g.playerIds, order)} onClick={() => send('fixPlaces', { round: cur.round, groupId: cur.g.id, order, policy })}>
              Apply correction
            </Btn>
          </div>
        )}
      </Card>
      <Card>
        <b>Adjust a player's cash</b>
        <div className="mt-2 space-y-2">
          <Select value={cashPid} onChange={(e) => setCashPid(e.target.value)}>
            <option value="">Player…</option>
            {state.playerOrder.map((id) => <option key={id} value={id}>{state.players[id].name} ({money(state.players[id].cash)})</option>)}
          </Select>
          <Input placeholder="Amount (negative to take away)" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          <Btn disabled={!cashPid || isNaN(parseFloat(amount))} onClick={async () => { if (await send('adjustCash', { pid: cashPid, amount: parseFloat(amount), note })) { setAmount(''); setNote(''); } }}>Adjust</Btn>
        </div>
      </Card>
      <Card>
        <Label>History</Label>
        <div className="max-h-60 space-y-1 overflow-y-auto font-mono text-[11px] text-muted">
          {state.log.slice().reverse().map((l, i) => (
            <div key={i}>{new Date(l.t).toLocaleTimeString()} {l.msg}</div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------- shell ----------
export default function OrganizerApp() {
  const { state, ready, dispatch } = useGame();
  const { user, send } = useOrg();
  const [tab, setTab] = useState('Round');

  if (!ready || user === undefined) return <div className="p-8">Loading…</div>;
  if (!user)
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="font-display text-2xl font-extrabold">Organizer</h1>
        <p className="mb-4 text-sm text-muted">Sign in with Google to run the tournament.</p>
        <Btn onClick={() => signIn().catch((e) => alert(e.message))}>Sign in with Google</Btn>
      </div>
    );
  if (!state.organizerEmail)
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <h1 className="font-display text-2xl font-extrabold">Claim this tournament</h1>
        <p className="mb-4 text-sm text-muted">Signed in as {user.email}. The first person to claim becomes the organizer.</p>
        <Btn onClick={() => send('claimOrganizer')}>I'm the organizer</Btn>
      </div>
    );
  if (state.organizerEmail.toLowerCase() !== user.email.toLowerCase())
    return (
      <div className="mx-auto max-w-md px-4 py-12">
        <p className="mb-4 text-sm text-muted">This tournament belongs to {state.organizerEmail}. You are signed in as {user.email}.</p>
        <Btn kind="ghost" onClick={signOutUser}>Sign out</Btn>
      </div>
    );

  const tabs = ['Round', 'Results', 'Machines', 'Roster', 'Wrap-up', 'Uh oh'];
  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-5">
      <div className="mb-3 flex items-center justify-between">
        <div className="font-display text-lg font-extrabold">Silverball <span className="text-pink">Organizer</span></div>
        {!isLocal && <button className="text-xs text-dim" onClick={signOutUser}>{user.email} · sign out</button>}
      </div>
      <div className="mb-4 flex gap-1 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cx('whitespace-nowrap rounded-full px-3 py-1.5 font-display text-sm font-extrabold', tab === t ? 'bg-pink text-ink' : 'text-dim')}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'Round' && <RoundTab send={send} />}
      {tab === 'Results' && <ResultsTab send={send} />}
      {tab === 'Machines' && <MachinesTab send={send} />}
      {tab === 'Roster' && <RosterTab send={send} />}
      {tab === 'Wrap-up' && <WrapTab send={send} />}
      {tab === 'Uh oh' && <FixTab send={send} />}
    </div>
  );
}
