# The Silverball Exchange

A real-time, multi-device pinball tournament stock exchange. Every player opens the
same link on their own phone; everyone sees live updates.

## What's inside

- **React + Vite** — the app itself (`src/App.jsx` has all the logic and UI)
- **Firebase Firestore** — the free, real-time shared database every device syncs to
- **Name + PIN login** — no accounts, no email. Each player claims a slot with a
  name and a short PIN, which is remembered on their device (survives refreshes)
  and lets them log back in from any device by entering the same PIN.
- **Organizer PIN** — optional, protects the Organizer console from accidental taps.
- **Reset Tournament** — wipes the shared database back to a fresh 16-player,
  $2,500 tournament, so you can redeploy nothing and just reuse this same app
  for your next event.
- **Correct a Mistake** — an organizer tool to directly edit a player's cash,
  edit or delete a specific stock holding (percentage, cost, value, status),
  and reopen an already-resolved machine to fix its placements. For when
  something gets entered wrong mid-tournament.

## One honest limitation

To keep this free and simple (no backend server, no paid Firebase plan, no
per-player accounts), the Firestore database uses **open security rules** —
anyone with your Firebase project's config values (which are visible in the
deployed site's JavaScript — normal for client-side Firebase apps) could
technically read or write the database directly. This is fine for a private
tournament you're sharing with people you trust, but:
- Don't put anything sensitive in it.
- Don't publicize the deployed URL beyond your players.
- If you ever want it locked down properly, that requires adding real
  authentication (e.g. Firebase Auth with email links) — a bigger step up,
  happy to help with that later if you want it.

## Step 1 — Create a free Firebase project

1. Go to <https://console.firebase.google.com> and sign in with any Google account.
2. Click **Add project**, give it any name (e.g. "silverball-exchange"), and
   finish the wizard (you can disable Google Analytics, you don't need it).
3. Once created, click the **web icon (`</>`)** on the project overview page to
   register a web app. Give it any nickname. You do **not** need Firebase
   Hosting.
4. Firebase will show you a `firebaseConfig` object with values like
   `apiKey`, `authDomain`, `projectId`, etc. Keep this tab open — you'll need
   these values in Step 3.

## Step 2 — Turn on Firestore

1. In the left sidebar, click **Build → Firestore Database**.
2. Click **Create database**.
3. Choose **Start in production mode** (we'll set our own rules next), pick
   any location close to you, and click **Enable**.
4. Once created, click the **Rules** tab and replace the contents with what's
   in `firestore.rules` in this project (copy-paste it in, then click
   **Publish**).

## Step 3 — Configure your local project

1. In this project folder, copy `.env.example` to a new file named `.env`:
   ```
   cp .env.example .env
   ```
2. Open `.env` and fill in the six values from your Firebase config (Step 1,
   part 4):
   ```
   VITE_FIREBASE_API_KEY=...
   VITE_FIREBASE_AUTH_DOMAIN=...
   VITE_FIREBASE_PROJECT_ID=...
   VITE_FIREBASE_STORAGE_BUCKET=...
   VITE_FIREBASE_MESSAGING_SENDER_ID=...
   VITE_FIREBASE_APP_ID=...
   ```

## Step 4 — Try it locally (optional but recommended)

You'll need [Node.js](https://nodejs.org) installed (any recent version).

```
npm install
npm run dev
```

This prints a `localhost` URL — open it in your browser. Try claiming a
player, buying stock, etc. Open the same URL in a second browser tab (or on
your phone, using your computer's local network address if `npm run dev`
shows one) to confirm changes sync live between them.

## Step 5 — Deploy to Vercel (free)

1. Push this project to a GitHub repository (create a new repo on
   [github.com](https://github.com), then follow its instructions to push
   this folder to it — or use GitHub Desktop if you prefer a GUI).
2. Go to <https://vercel.com>, sign up (free), and click **Add New → Project**.
3. Import the GitHub repository you just created. Vercel will auto-detect
   this as a **Vite** project — you don't need to change any build settings.
4. Before clicking Deploy, open **Environment Variables** and add the same six
   `VITE_FIREBASE_...` values from your `.env` file.
5. Click **Deploy**. In about a minute you'll get a live URL like
   `https://silverball-exchange-yourname.vercel.app`.
6. Share that URL with your players. Everyone opens it, claims their own
   player slot with a name and PIN, and you're live.

## Running it on tournament day

1. Open the Vercel URL yourself and go to the **Organizer** tab.
2. If you want to protect the console, set an organizer PIN right there (or
   skip it to leave it open).
3. Set player count and starting cash before Round 1.
4. Add machines each round, assign players, open/close the trading window,
   resolve results, and advance rounds as you've already been doing.
5. When it's over, hit **Complete Tournament**, export your results, and
   whenever you're ready for the next event, hit **Reset Tournament** —
   same URL, fresh start.

## Updating the app later

If you ask for more changes and get updated files, just replace the files in
this project folder and either:
- run `npm run dev` again to test locally, then
- push to GitHub (`git add -A && git commit -m "update" && git push`) —
  Vercel automatically redeploys on every push to your main branch.
