/**
 * The published rehearsal seed pair. Frozen, and on the deny-list for live rounds.
 *
 * `docs/DESIGN.md` §5.2.3: everyone's first rehearsal is the same three branches,
 * so the teaching beats land where the specification says they land. The pair is
 * the **first hit** of the deterministic scan in `tools/rehearsal-seed.ts` — run
 * `npm run rehearsal:seed` and it reproduces this file — so the choice is
 * something anyone can re-derive rather than something we assert.
 *
 * The server seed is a repeating two-byte pattern for exactly one reason: a live
 * seed drawn from a CSPRNG can never be confused with it, which is what makes the
 * deny-list in `rounds.ts` a real control rather than a comment.
 *
 * Beats on the default path (`WIDE` in all three arenas): **5, 3, 0** — the squad
 * clears, then loses two, then the branch takes the rest. Banking after arena 2
 * lands at `0.812x` the stake: below it, not merely below the claim the round
 * opened at. Neither ending is a win, which is the point.
 */
export const REHEARSAL_SEED_PAIR = Object.freeze({
  roundId: 'branchfall-rehearsal-v1',
  clientEntropy: 'b3a8a58cbcea8affd4f1de3beb542bd0e0a5ba84d4bcc6c3ebf47653c6bda2bc',
  serverSeed: '0232023202320232023202320232023202320232023202320232023202320232',
  candidateIndex: 562,
  beats: Object.freeze([5, 3, 0]),
});
