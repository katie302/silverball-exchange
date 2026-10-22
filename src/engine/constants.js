// Default tournament settings. Every value here can be changed by the
// organizer in the Round tab before (or during) the tournament.
export const DEFAULT_SETTINGS = {
  startingCash: 2000,
  rounds: 6,
  minSelfBuyPct: 10,
  maxPctPerStock: null, // null = no cap per buyer per stock
  maxSelfBuyPct: 40, // most shares of your own stock you can hold (null = no cap). Lifted in the final round.
  minOtherStocks: 2, // stocks style: buy into this many OTHER players before you can say you're done (0 = off, not in the final round)
  minOtherShares: 5, // shares needed in another player's stock for it to count
  tiers: [
    { upTo: 25, price: 20 },
    { upTo: 50, price: 25 },
    { upTo: 75, price: 30 },
    { upTo: 100, price: 40 },
  ],
  // Payout by finishing place, in percent of what was paid.
  payout4: [80, 25, -15, -45],
  payout3: [80, 10, -45],
  payout2: [80, -45],
  finalRoundMult: 1.5,
  selfBuySeconds: 300,
  openSeconds: 300, // how long the market stays open after the self-buy window (0 = no timer)
  // Game style: 'stocks' (buy % of a player's stock) or 'horse' (pooled bets).
  style: 'stocks',
  minBet: 10, // horse style: smallest bet in dollars
  houseBonusFinalPct: 50, // horse style: house adds this % to every pool in the final round
  showOdds: true, // show rating-based odds to everyone
  useIfpa: true, // let IFPA / Matchplay ratings seed the starting rating
  // Market event sizes, in percentage points.
  eventSizes: { machine: 10, upset: 15, winnerTakesAll: 10, market: 5, hotHand: 8 },
};

export const PHASE_LABELS = {
  self: 'Self-buy window',
  open: 'Market open',
  locked: 'Match in progress',
  event: 'Market event',
  paid: 'Paid out',
};
