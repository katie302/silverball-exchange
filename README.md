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
