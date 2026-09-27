/**
 * The economic definition of a CAUSEWAY round. Everything that can move money
 * lives here and nowhere else; presentation reads it, never writes it.
 *
 * All multipliers are integer hundredths ("cents of a multiplier"): 100 = 1.00x.
 * All money is integer hundredths of a credit: 1000 = 10.00 credits.
 */
export const RTP_NUM = 97n;
export const RTP_DEN = 100n;

/** 1.00x — the floor of every round. */
export const MIN_MULT = 100;
/** 10,000.00x — the end of the causeway. Reaching it cashes out every live bet. */
export const MAX_MULT = 1_000_000;

export const MIN_STAKE = 10; // 0.10 credits
export const MAX_STAKE = 100_000; // 1,000.00 credits
export const MIN_AUTO_CASHOUT = 101; // 1.01x

/** The runner sets off this long after the bet is accepted. The multiplier is 1.00x throughout. */
export const LEAD_IN_MS = 1100;

/**
 * Growth curve: m(t) = e^(GROWTH_PER_MS · t). 2x at ~11.0 s, 10x at ~36.5 s, 100x at ~73 s.
 * The curve is pure presentation of time; the crash point is fixed before the run starts.
 */
export const GROWTH_PER_MS = 0.000063;
