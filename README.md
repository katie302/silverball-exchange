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
- Odds from one blended rating (IFPA rating + saved history + this tournament). Players can switch between "3-to-1" and "25%".
- Saved players (profiles) that can be made inactive without losing their stats.

## Optional: IFPA rating lookup
`api/ratings.js` is a Vercel function. Add an environment variable `MATCHPLAY_TOKEN` in Vercel and redeploy to enable
"Look up IFPA ratings" on the Roster tab. Without it, type ratings in by hand.

## Tests
`node --test tests/engine.test.mjs`
