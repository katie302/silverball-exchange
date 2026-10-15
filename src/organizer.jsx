import React, { useEffect, useState } from 'react';
import { useGame, useNow } from './game.jsx';
import { useAuthUser, signIn, signOutUser } from './auth.js';
import { isLocal } from './firebase.js';
import { Btn, Card, Chip, Input, Label, OrderPicker, Select, cx, fmtClock, orderComplete } from './ui.jsx';
import { exportCsv, exportJson } from './export.js';
import {
  PHASE_LABELS, activePlayers, computeFix, currentRound, describeEvent, eventDelta,
  importTournament, isFinalRound, leaderboard, minSelfCost, money, ordinal, ratingMap, roundPhase,
  rosterChanged, saveToProfiles, doneCount, marketClosed, openEndsAt, seedFromProfiles,
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
      finalRoundMult: String(st.finalRoundMult), selfBuySeconds: String(st.selfBuySeconds), openSeconds: String(st.openSeconds ?? 0),
      style: st.style, minBet: String(st.minBet), houseBonusFinalPct: String(st.houseBonusFinalPct),
      showOdds: st.showOdds, useIfpa: st.useIfpa,
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
      finalRoundMult: parseFloat(d.finalRoundMult), selfBuySeconds: parseInt(d.selfBuySeconds, 10), openSeconds: parseInt(d.openSeconds, 10),
      style: d.style, minBet: parseInt(d.minBet, 10), houseBonusFinalPct: parseFloat(d.houseBonusFinalPct),
      showOdds: !!d.showOdds, useIfpa: !!d.useIfpa,
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
          <div>Style: {st.style === 'horse' ? 'Horse betting' : 'Stocks'} · odds {st.showOdds ? 'on' : 'off'} · IFPA ratings {st.useIfpa ? 'on' : 'off'}</div>
          <div>Start {money(st.startingCash)} · {st.rounds} rounds · {st.style === 'horse' ? `min bet ${money(st.minBet)}` : `min self-buy ${st.minSelfBuyPct}% (${money(minSelfCost(st))})`}</div>
          <div>Max per stock {st.maxPctPerStock ?? 'none'} · max self-buy {st.maxSelfBuyPct ?? 'none'} · self-buy window {st.selfBuySeconds}s · market timer {st.openSeconds ? st.openSeconds + 's' : 'none'}</div>
          <div>Tiers {st.tiers.map((t) => `≤${t.upTo}%:$${t.price}`).join(' ')}</div>
          <div>Payout 4p {st.payout4.join('/')} · 3p {st.payout3.join('/')} · 2p {st.payout2.join('/')} · final ×{st.finalRoundMult}</div>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <Label>Game style {state.status !== 'setup' && '(locked once round 1 starts)'}</Label>
            <Select value={d.style} disabled={state.status !== 'setup'} onChange={set('style')}>
              <option value="stocks">Stocks (buy % of a player's stock)</option>
              <option value="horse">Horse betting (pooled bets, odds)</option>
            </Select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.showOdds} onChange={(e) => setD({ ...d, showOdds: e.target.checked })} /> Show odds to everyone
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={d.useIfpa} onChange={(e) => setD({ ...d, useIfpa: e.target.checked })} /> Use IFPA / Matchplay ratings for odds
          </label>
          {row('Starting cash', 'startingCash')}
          {row('Rounds', 'rounds')}
          {row('Min self-buy %', 'minSelfBuyPct')}
          {row('Max % per stock (blank = none)', 'maxPctPerStock')}
          {row('Max self-buy % (blank = none)', 'maxSelfBuyPct')}
          {row('Self-buy window (seconds)', 'selfBuySeconds')}
          {row('Market-open timer after that (seconds, 0 = none)', 'openSeconds')}
          {row('Price tiers (upTo:price, …)', 'tiers', '25:10, 50:12, 75:15, 100:20')}
          {row('Payout % for 4 players (1st…4th)', 'payout4')}
          {row('Payout % for 3 players', 'payout3')}
          {row('Payout % for 2 players', 'payout2')}
          {row('Final round multiplier (stocks)', 'finalRoundMult')}
          {row('Horse: minimum bet ($)', 'minBet')}
          {row('Horse: house bonus on pools in final round (%)', 'houseBonusFinalPct')}
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

function boughtIn(state) {
  const r = currentRound(state);
  const need = state.settings.minSelfBuyPct;
  const needBet = minSelfCost(state.settings);
  return Object.keys(r.stockByPlayer).filter((pid) => {
    const sid = r.stockByPlayer[pid];
    if (state.settings.style === 'horse')
      return Object.values(state.bets || {}).filter((b) => b.bettorId === pid && b.stockId === sid).reduce((a, b) => a + b.amount, 0) >= needBet;
    return Object.values(state.positions).filter((x) => x.holderId === pid && x.stockId === sid && x.status === 'held').reduce((a, x) => a + x.pct, 0) >= need;
  }).length;
}

function RoundTab({ send }) {
  const { state } = useGame();
  const now = useNow();
  const [override, setOverride] = useState(false);
  const r = currentRound(state);
  const phase = roundPhase(state, now);
  const claimed = state.playerOrder.filter((id) => state.players[id].claimed).length;
  const avail = state.machineOrder.filter((id) => !state.machines[id].pulled).length;
  const horse = state.settings.style === 'horse';
  const stale = (phase === 'self' || phase === 'open') && rosterChanged(state);
  const restart = async () => {
    if (window.confirm('Restart this round? Everyone gets their buy-ins back, then groups and machines are redrawn.')) await send('restartRound');
  };

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
        {stale && (
          <div className="mt-3 rounded-xl border border-amber p-3 text-sm">
            The roster changed since groups were drawn. Restart the round so everyone gets a group.
            <div className="mt-2"><Btn small onClick={restart}>Restart round now</Btn></div>
          </div>
        )}
        {phase === 'self' && (
          <>
            <p className="mt-2 text-sm text-muted">{boughtIn(state)}/{Object.keys(r.stockByPlayer).length} {horse ? 'bet in' : 'bought in'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Btn kind="mint" onClick={() => send('openTrading')}>Open market now</Btn>
              <Btn kind="ghost" disabled={stale} onClick={() => send('lockRound')}>Lock round</Btn>
              <Btn kind="ghost" onClick={restart}>Restart round</Btn>
            </div>
          </>
        )}
        {phase === 'open' && !horse && (() => {
          const end = openEndsAt(state);
          const dc = doneCount(state);
          return (
            <p className="mt-2 text-sm text-muted">
              {marketClosed(state, now) ? 'Market closed (timer ended or everyone is done). ' : end != null ? `Market closes in ${fmtClock(end - now)}. ` : ''}
              {dc.done}/{dc.total} done buying.
            </p>
          );
        })()}
        {phase === 'open' && (
          <div className="mt-3 flex flex-wrap gap-2">
            <Btn disabled={stale} onClick={() => send('lockRound')}>Lock round (matches start)</Btn>
            <Btn kind="ghost" onClick={restart}>Restart round</Btn>
          </div>
        )}
        {phase === 'locked' && (
          <div className="mt-2">
            <p className="text-sm text-muted">{r.groups.filter((g) => g.places).length}/{r.groups.length} results entered. Use the Results tab.</p>
            <Btn className="mt-3" disabled={!r.groups.every((g) => g.places)} onClick={() => send('continueFromResults')}>
              {isFinalRound(state) || horse ? 'Pay out round' : 'Continue to market event'}
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
          {isFinalRound(state) || state.settings.style === 'horse' ? 'Pay out round' : 'Continue to market event'}
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
function SavedPlayers({ send }) {
  const { state, profiles, setToast } = useGame();
  const [list, setList] = useState(null);
  const [picked, setPicked] = useState({});
  const [showInactive, setShowInactive] = useState(false);
  const toast = (msg) => setToast({ msg, id: Date.now() });
  const reload = async () => { try { setList(await profiles.load()); } catch { setList({}); } };
  useEffect(() => { reload(); }, [state.playerOrder.length]);
  if (!list) return null;
  const entries = Object.entries(list).sort((a, b) => a[1].name.localeCompare(b[1].name));
  if (!entries.length) return null;
  const onRoster = (pr) => state.playerOrder.some((id) => state.players[id].name.toLowerCase() === pr.name.toLowerCase());
  const activeList = entries.filter(([, v]) => !v.inactive);
  const inactiveList = entries.filter(([, v]) => v.inactive);
  const setInactive = async (key, inactive) => {
    await profiles.update((cur) => {
      const next = structuredClone(cur);
      if (!next[key]) return next;
      if (inactive) next[key].inactive = true; else delete next[key].inactive;
      return next;
    });
    await reload();
  };
  const remove = async (key) => {
    await profiles.update((cur) => { const next = structuredClone(cur); delete next[key]; return next; });
    await reload();
  };
  const addPicked = async () => {
    const names = activeList.filter(([k]) => picked[k]).map(([, v]) => v.name);
    if (!names.length) return;
    if (await send('addPlayers', { names })) {
      setPicked({});
      toast(state.status === 'setup' ? `Added ${names.length}. Tap "Load history from past tournaments" to bring their ratings in.` : `Added ${names.length}.`);
    }
  };
  return (
    <Card>
      <Label>Saved players (ratings carry over)</Label>
      <div className="space-y-1">
        {activeList.map(([key, v]) => {
          const here = onRoster(v);
          return (
            <div key={key} className="flex items-center justify-between gap-2 text-sm">
              <label className="flex min-w-0 items-center gap-2">
                <input type="checkbox" disabled={here} checked={!!picked[key]} onChange={(e) => setPicked({ ...picked, [key]: e.target.checked })} />
                <span className="truncate">{v.name}</span>
                <span className="font-mono text-[11px] text-dim">{Math.round(v.rating)} · {v.games} games{here ? ' · on roster' : ''}</span>
              </label>
              <Btn small kind="ghost" onClick={() => setInactive(key, true)}>Make inactive</Btn>
            </div>
          );
        })}
        {!activeList.length && <div className="text-sm text-dim">No active saved players.</div>}
      </div>
      <Btn small className="mt-2" onClick={addPicked}>Add checked to this tournament</Btn>
      {inactiveList.length > 0 && (
        <div className="mt-3 border-t border-line pt-2">
          <button className="text-xs text-muted underline" onClick={() => setShowInactive(!showInactive)}>
            {showInactive ? 'Hide' : 'Show'} inactive ({inactiveList.length})
          </button>
          {showInactive && (
            <div className="mt-2 space-y-1">
              {inactiveList.map(([key, v]) => (
                <div key={key} className="flex items-center justify-between gap-2 text-sm text-muted">
                  <span className="truncate">{v.name} <span className="font-mono text-[11px] text-dim">{Math.round(v.rating)} · {v.games} games</span></span>
                  <span className="flex gap-2">
                    <Btn small kind="ghost" onClick={() => setInactive(key, false)}>Reactivate</Btn>
                    <Btn small kind="danger" onClick={() => remove(key)}>Delete</Btn>
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-xs text-dim">Inactive players keep their stats but aren't offered in the list above. If you add one by name later, their history still loads.</p>
        </div>
      )}
    </Card>
  );
}

function RosterTab({ send }) {
  const { state, profiles, setToast } = useGame();
  const [text, setText] = useState('');
  const toast = (msg) => setToast({ msg, id: Date.now() });
  const map = ratingMap(state);
  const active = state.status === 'active';

  const loadHistory = async () => {
    const pr = await profiles.load();
    const seed = seedFromProfiles(state, pr);
    const n = Object.keys(seed).length;
    if (!n) return toast('No saved history matches these players yet.');
    if (await send('seedRatings', { ratings: seed })) toast(`Loaded history for ${n} player${n === 1 ? '' : 's'}.`);
  };
  const lookup = async () => {
    const ids = state.playerOrder.map((id) => state.players[id].ifpaId).filter(Boolean);
    if (!ids.length) return toast('Nobody has entered an IFPA # yet.');
    try {
      const r = await fetch(`/api/ratings?ids=${ids.join(',')}`);
      const j = await r.json();
      if (!r.ok) return toast(j.error || 'Lookup failed. Type ratings in by hand instead.');
      const byPid = {};
      for (const id of state.playerOrder) {
        const f = state.players[id].ifpaId;
        if (f && j.ratings[f] != null) byPid[id] = j.ratings[f];
      }
      await send('setRatings', { ratings: byPid });
      toast(`Found ratings for ${Object.keys(byPid).length} of ${ids.length}.`);
    } catch {
      toast('Lookup is not available here. Type ratings in by hand instead.');
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <Label>Add players (paste a list, one per line)</Label>
        <textarea className="h-24 w-full rounded-xl border border-line bg-ink p-3 text-sm outline-none focus:border-pink" value={text} onChange={(e) => setText(e.target.value)} />
        <Btn className="mt-2" onClick={async () => { if (await send('addPlayers', { names: splitLines(text) })) setText(''); }}>Add</Btn>
        {active && <p className="mt-2 text-xs text-dim">Late joiners start with the lower of the starting cash and the average net worth. If a round is open, restart it so they get a group.</p>}
      </Card>
      <SavedPlayers send={send} />
      <Card>
        <Label>Ratings for odds</Label>
        <div className="flex flex-wrap gap-2">
          <Btn small kind="ghost" onClick={lookup}>Look up IFPA ratings</Btn>
          {state.status === 'setup' && <Btn small kind="ghost" onClick={loadHistory}>Load history from past tournaments</Btn>}
        </div>
      </Card>
      <div className="text-sm text-muted">{state.playerOrder.filter((i) => state.players[i].claimed && !state.players[i].withdrawn).length}/{state.playerOrder.filter((i) => !state.players[i].withdrawn).length} claimed</div>
      {state.playerOrder.map((id) => {
        const p = state.players[id];
        return (
          <div key={id} className={cx('rounded-xl border border-line bg-surface px-4 py-2.5', p.withdrawn && 'opacity-60')}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold">{p.name}</span>
              <span className="flex gap-1">
                {p.withdrawn && <Chip tone="amber">removed</Chip>}
                {p.eliminated && <Chip tone="pink">out</Chip>}
                <Chip tone={p.claimed ? 'mint' : 'amber'}>{p.claimed ? 'claimed' : 'open'}</Chip>
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                defaultValue={p.ifpaId || ''}
                placeholder="IFPA #"
                inputMode="numeric"
                onBlur={(e) => e.target.value !== (p.ifpaId || '') && send('setIfpa', { pid: id, ifpaId: e.target.value })}
                className="w-24 rounded-lg border border-line bg-ink px-2 py-1 text-xs outline-none focus:border-pink"
              />
              <input
                key={`${id}-${p.ifpaRating}`}
                defaultValue={p.ifpaRating ?? ''}
                placeholder="rating"
                inputMode="numeric"
                onBlur={(e) => String(p.ifpaRating ?? '') !== e.target.value && send('setIfpa', { pid: id, ifpaId: p.ifpaId, ifpaRating: e.target.value })}
                className="w-20 rounded-lg border border-line bg-ink px-2 py-1 text-xs outline-none focus:border-pink"
              />
              <span className="font-mono text-[11px] text-dim">now {Math.round(map[id].rating)} · {map[id].games} matches</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <Btn small kind="ghost" onClick={() => { const n = window.prompt('New name', p.name); if (n) send('renamePlayer', { pid: id, name: n }); }}>Rename</Btn>
              {p.claimed && <Btn small kind="ghost" onClick={() => send('unclaimPlayer', { pid: id })}>Unclaim / reset PIN</Btn>}
              {p.withdrawn ? (
                <Btn small kind="mint" onClick={() => send('restorePlayer', { pid: id })}>Add back</Btn>
              ) : (
                <Btn small kind="danger" onClick={() => { if (state.status === 'setup' || window.confirm(`Remove ${p.name}? They stay in the history as withdrawn.`)) send('removePlayer', { pid: id }); }}>Remove</Btn>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------- Wrap-up ----------
function WrapTab({ send }) {
  const { state, profiles, setToast } = useGame();
  const now = useNow();
  const [confirm, setConfirm] = useState('');
  const lb = leaderboard(state);
  const phase = roundPhase(state, now);
  const toast = (msg) => setToast({ msg, id: Date.now() });
  const saveHistory = async () => {
    await profiles.update((cur) => saveToProfiles(state, cur));
    toast('Ratings saved to history.');
  };
  const importFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const imported = JSON.parse(await f.text());
      if (!imported.players || !imported.rounds) throw new Error('not a tournament export');
      let count = 0;
      await profiles.update((cur) => {
        const r = importTournament(imported, cur);
        count = r.count;
        return r.profiles;
      });
      toast(`Imported ratings for ${count} players.`);
    } catch (err) {
      toast(`Couldn't read that file: ${err.message}`);
    }
    e.target.value = '';
  };
  return (
    <div className="space-y-3">
      <Card>
        <Label>Standings</Label>
        {lb.map((r) => (
          <div key={r.id} className={cx('flex justify-between py-1 text-sm', r.withdrawn && 'text-dim')}>
            <span>{r.withdrawn ? '–' : `${r.rank}.`} {r.name}{r.eliminated && ' (out)'}{r.withdrawn && ' (withdrawn)'}</span>
            <span className="font-mono">{money(r.worth)}</span>
          </div>
        ))}
      </Card>
      <Card>
        <div className="flex flex-wrap gap-2">
          <Btn kind="ghost" onClick={() => exportCsv(state)}>Export standings (CSV)</Btn>
          <Btn kind="ghost" onClick={() => exportJson(state)}>Export history (JSON)</Btn>
        </div>
      </Card>
      <Card>
        <Label>Ratings history (for odds in future tournaments)</Label>
        <div className="flex flex-wrap items-center gap-2">
          <Btn kind="ghost" onClick={saveHistory}>Save this tournament's ratings</Btn>
          <label className="cursor-pointer rounded-xl border border-line px-4 py-3 font-display text-sm font-extrabold">
            Import a past tournament file
            <input type="file" accept=".json,application/json" className="hidden" onChange={importFile} />
          </label>
        </div>
      </Card>
      {state.status === 'active' && phase === 'paid' && state.round >= state.settings.rounds && (
        <Btn className="w-full" onClick={() => send('finishTournament')}>Finish tournament</Btn>
      )}
      <Card className="border-pink">
        <b className="text-pink">Reset tournament</b>
        <p className="mb-2 text-sm text-muted">Wipes rounds, stocks, bets and cash. Keeps the roster, claimed names, settings and machines.</p>
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
  const [cashPid, setCashPid] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const paid = [];
  state.rounds.forEach((r) => r.groups.forEach((g) => g.paid && paid.push({ round: r.n, g })));
  const cur = paid.find((x) => `${x.round}:${x.g.id}` === sel);
  const names = cur ? Object.fromEntries(cur.g.playerIds.map((id) => [id, state.players[id].name])) : {};
  const changes = cur && orderComplete(cur.g.playerIds, order) ? computeFix(state, cur.round, cur.g.id, order) : [];
  return (
    <div className="space-y-3">
      <Card>
        <b>Fix a result</b>
        <p className="mb-2 text-sm text-muted">Reopen a paid-out match, change the places and see the impact before applying. Everyone's cash is adjusted to match. Market event bonuses stay as they were.</p>
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
                    <span>{state.players[c.holderId].name} on {state.players[c.owner].name}</span>
                    <span className={cx('font-mono', c.delta >= 0 ? 'text-mint' : 'text-pink')}>{c.delta >= 0 ? '+' : ''}{c.delta}</span>
                  </div>
                ))}
              </div>
            )}
            <Btn className="mt-3" disabled={!orderComplete(cur.g.playerIds, order)} onClick={() => send('fixPlaces', { round: cur.round, groupId: cur.g.id, order })}>
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
