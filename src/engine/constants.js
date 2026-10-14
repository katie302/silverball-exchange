// Default tournament settings. Every value here can be changed by the
// organizer in the Round tab before (or during) the tournament.
export const DEFAULT_SETTINGS = {
  startingCash: 2000,
  rounds: 6,
  minSelfBuyPct: 10,
  maxPctPerStock: null, // null = no cap per buyer per stock
  maxSelfBuyPct: null, // null = no separate cap on buying your own stock
  tiers: [
    { upTo: 25, price: 10 },
    { upTo: 50, price: 12 },
    { upTo: 75, price: 15 },
    { upTo: 100, price: 20 },
  ],
  // Payout by finishing place, in percent of what was paid.
  payout4: [30, 10, -10, -30],
  payout3: [30, 0, -30],
  payout2: [30, -30],
  finalRoundMult: 1.5,
  selfBuySeconds: 300,
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
