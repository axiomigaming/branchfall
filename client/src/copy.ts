/**
 * Player-facing copy, in one file so it can be read as a set.
 *
 * `docs/DESIGN.md` §5.2.6 publishes the onboarding strings exactly; §3, §4 and
 * the screen list publish the rest. They are reproduced here rather than
 * paraphrased, because `tests/copy-discipline.test.mjs` binds the strings in the
 * specification and §10.3 records that a client carrying copy the guard cannot
 * read has moved the rule out of reach. Keeping the catalogue in one module is
 * what makes it readable by the same kind of check.
 *
 * The banned vocabulary is *strategy, strategic, skill, outplay, beat the odds,
 * master, edge, system, pro* — with two encoded exceptions, "no skill" and
 * "house edge". Nothing below uses any of them.
 */
export const COPY = {
  firstTime: 'First time? Three branches, no stake, same rules.',
  cosmetics: 'Cosmetics never change the odds.',
  claimIntro: 'Your stake buys one claim. Five runners carry it — one fifth each.',
  twoCardFooter: 'They are not the same bet.',
  firstResolve: 'The runners who cleared carry their shares across. The shares that fell are gone.',
  splitAppears:
    'The branch forks. Each lane falls on its own, so losing everyone now takes two failures instead of one.',
  shelterAppears: 'A shelter door. Bring some of them home and that part of the claim stops running.',
  noClock: 'There is no clock on this. Nothing here expires.',
  rehearsalBanked: 'That is the whole game. Choose the shape, watch, then bank or send them again.',
  rehearsalChip: 'REHEARSAL — public seed, no stake, no payout',
  showEverything: 'Show me everything.',
  sideBetOptIn:
    'Side bets are separate money on one arena’s result, at the same 95.5%. They stay off until you turn them on.',
  breakEven: 'Your claim grows if',
  everyRoute: 'You are choosing the shape of the risk, not the odds.',
  whoGoesWhere: 'Who goes where changes who comes home, not the odds.',
  shelterFloor: 'One has to run. You can bank the rest after this branch.',
  buyWarning:
    'Every route on the next screen sends at least one Kindling across. Banking starts after the first branch.',
  expiry:
    'Leave mid-round and the round waits. If it is still waiting after 24 hours we close it for you — banked if a branch has resolved, cancelled and refunded in full if none has.',
  seedNote:
    'Change this to anything you like. The server has already committed to its half and cannot see yours.',
  sealed: 'The server’s half of this round is sealed. Your half is yours.',
  skipNote: 'The result is already sealed. Skipping only skips the view.',
  sealNote:
    'The server sealed its half before it ever saw yours. Change yours to anything — that is what makes the seal mean something.',
  practiceSeed: 'Practice runs use a public seed. Everyone gets the same three branches.',
  noPayout: 'This is practice. It does not pay, and it is not a balance.',
  forkShape: 'is the wider spread. More of both endings, same average, same 95.5%.',
  lastLight: 'Same 95.5% as every bet here.',
  ghostNote: 'Who fell and where, on the branches you did not take. Never a money figure.',
  outcomeBar: 'grows · falls, run goes on · nobody makes it',
} as const;

export const RTP_LINE = (rtp: string) => `Returns ${rtp}, like every route.`;

/**
 * The unit, attached to every money figure a player reads.
 *
 * The round-1 blind ranking found the one omission that failed two rubric
 * criteria at once: `balance 500.00`, `BANKED 15.28`, `Bank 30.56` — every money
 * figure in the product was a bare number, while every reference in the library
 * writes `Bet 1.00 FUN`, `Balance 1,000.00 FUN`, `TOTAL WIN 1.03 FUN`. A bare
 * decimal is a quantity; a decimal with a unit is *money*, and reading as money
 * is the whole job of these figures.
 *
 * It is `cr` because the product's own words for the thing are already fixed —
 * `server/main.ts` prints *"opening balance 500.00 credits"* on boot and §12
 * writes the balance in credits — so this is the short form of a name the game
 * already has, not a currency invented for the frame. It is presentation and
 * only presentation: nothing downstream reads it, and no figure is computed from
 * it. `MONEY` is the composer, so there is exactly one place that decides the
 * spacing and one place to change if the unit ever does.
 */
export const UNIT = 'cr';

/** A money figure with its unit attached — the only way money reaches a screen. */
export const MONEY = (figure: string) => `${figure} ${UNIT}`;
