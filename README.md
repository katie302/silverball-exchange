# The Silverball Exchange

Pinball tournament stock market. Players trade stock in each player's performance in a specific match; highest net worth after the last round wins.

## Run it

    npm install
    npm run dev        # http://localhost:5173  (organizer: /#/organizer)
    npm test           # game engine tests
    npm run build

With no Firebase keys in `.env` the app runs in single-device **local mode** (data in localStorage) so you can try it.

## Shared game (Firebase)

1. Copy `.env.example` to `.env` and fill in your Firebase web app values (same in Vercel > Settings > Environment Variables).
2. Firebase console > Authentication > enable **Google** sign-in; add your Vercel domain under Authorized domains.
3. Firestore: create the database, publish `firestore.rules`.
4. Push to GitHub; Vercel redeploys.

The whole game is one Firestore document, `silverball/v2`. Every action runs through the engine (`src/engine/reducer.js`) inside a transaction.

## Known limits

- Firestore rules are open and the engine is client-run, so a determined person with dev tools could cheat. PINs only stop casual mix-ups. Fine for a friendly tournament.
- The organizer is whoever signs in with Google first and clicks "I'm the organizer".
- Old data in `silverball/*` from earlier versions is not used.

## Organizer flow

Roster + Machines > Round (Start) > self-buy window > Open market > Lock round > Results (approve reports) > Continue > market event (Re-roll / Apply / Skip) > Start next round. Mistakes: Uh oh tab.

## What's new in this version
- Two game styles, chosen at setup (locked once round 1 starts): **stocks** and **horse betting**.
- Stocks: finished stocks auto-cash at payout, no cap on shares (price keeps rising), a market-open timer plus an "I'm done buying" button.
- Horse: Win / Place / Show pools per group, no self-bet or cash reserve required, final-round house bonus.
- Add or remove players any time before Lock (removed = "withdrawn", shown last), restart a round until Lock.
- Live "who owns / who bet what" on every stock, kept after lock and payout.
- Odds from one blended rating (IFPA rating + saved history + this tournament). Players can switch between sportsbook odds (+300, the default), "3-to-1" and "25%".
- Saved players (profiles) that can be made inactive without losing their stats.

## Post-tournament update
- **Shares wording** everywhere (not "%"): "N shares sold", "next share $X", "you own N shares". A "popular" chip shows at 100+ shares sold.
- **New defaults** (new tournaments only): share prices 25:20, 50:25, 75:30, 100:40; payouts are top-heavy: 4 players +80 / +25 / -15 / -45, 3 players +80 / +10 / -45, 2 players +80 / -45; final round x1.5. Own-stock cap is 40 shares (lifted in the final round). Min self-buy 10 shares, cash reserve and elimination line are the cost of those 10 shares ($200).
- **Existing saved tournaments keep their old settings** (no self-buy cap, old payouts and prices) until you change them in Settings or reset. Prices to type: `25:20, 50:25, 75:30, 100:40`.
- **Buy into others before "done"**: each player must hold 5+ shares in 2 other players' stocks (auto-waived to what they can afford; organizer can Excuse a player; organizer can add +1 minute to the market). Off in the final round.
- **Market tab**: group cards per machine (your match first), big red "I'M DONE BUYING" button with countdown, profit-first buy sheet with a slider and "See the math", top pick per game, "You made/lost $X" on resolved rows.
- **Pending results**: players see suggested/pending results, projected payouts, projected net worth and standings arrows ("up 2 places").
- **Portfolio** grouped by round with the payout math; **Board** has a net-worth chart (tap names to add up to 6) with a dotted projection.
- **Event reveal** shown to everyone after the organizer applies or skips it.
- **First-round walkthrough** and a FINAL ROUND popup/banner (once per phone).
- **End screen**: winner, your finish ("#8 of 8 players"), most profitable stock, best stocks overall, awards, standings. The chart and awards need per-round history, so they only fill in for tournaments started on this version.
- Matches tab removed; the IFPA number box lives in Portfolio until round 1 is paid.

## Practice mode
On the organizer screen, tap **Practice mode** (or open `/#/practice`). It runs a sandbox tournament with eight made-up players (PIN 1234) stored separately in the browser (`silverball-practice`), so it never touches the real Firestore game. Buttons: new practice (stocks or horse), View as any player, other players buy/bet, lock + random results.

## Optional: IFPA rating lookup
`api/ratings.js` is a Vercel function. Add an environment variable `MATCHPLAY_TOKEN` in Vercel and redeploy to enable
"Look up IFPA ratings" on the Roster tab. Without it, type ratings in by hand.

## Tests
`node --test tests/engine.test.mjs`
