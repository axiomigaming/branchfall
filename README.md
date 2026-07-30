# BRANCHFALL

[![CI](https://github.com/metaforismo/branchfall/actions/workflows/ci.yml/badge.svg)](https://github.com/metaforismo/branchfall/actions/workflows/ci.yml)
![RTP](https://img.shields.io/badge/RTP-95.5%25%20exact-C9A227)
![Proof](https://img.shields.io/badge/paytable-exhaustively%20enumerated-informational)
![Arithmetic](https://img.shields.io/badge/arithmetic-exact%20BigInt%20rationals-informational)
![Fairness](https://img.shields.io/badge/fairness-two--sided%20commit--reveal-informational)
![Money](https://img.shields.io/badge/real%20money-no%20%E2%80%94%20free%20play%20prototype-lightgrey)
![Certification](https://img.shields.io/badge/certification-none%20claimed-lightgrey)

**Five small figures with lanterns for hearts cross five collapsing branches
above a fog nobody has seen the bottom of.** You send them; they do the running.
Before each branch you choose a route — take the wide bough together, fork into
two paths and decide how many go down each, send everyone single-file across the
dangerous shortcut, or open a shelter door and bring some of them home right now.
Every route pays back exactly the same
<!-- fig:rtpPct -->95.5%<!-- /fig -->. What you are actually choosing is the
*shape* of the risk, and which of your runners you are willing to gamble. When
the last lantern goes out, the screen goes cold and quiet. When you get one home,
a brass door closes on a light that is still burning.

BRANCHFALL is a staged-survival game built on **Reveal Engine**, the shared Axiom
Games TypeScript core. This repository is the complete, build-ready
specification — the product design, the exact probability model, the engine
lifecycle it consumes, a runnable enumerator that proves the paytable, and tests
that fail if the published numbers and the mathematics ever disagree — **and a
playable graybox of the game itself**: a server that consumes the real engine and
a browser client that plays a whole round through it, at placeholder-art fidelity.

```bash
npm install && npm run dev      # http://localhost:4173
```

---

## How a round works

| | |
| --- | --- |
| **1. Buy the run** | Your stake is debited and the round opens with a claim of `stake x `<!-- fig:rtpPct -->95.5%<!-- /fig -->. This is the **only** time the house margin is charged. Before you make a single choice, the server publishes a hash committing to its half of the round — and your device generates the other half. |
| **2. Choose a route** | Four contracts, no timer, all four showing their exact odds for your current squad size. On a Fork you also choose how the squad divides. |
| **3. Watch the run** | A 9–14 second replay of an outcome that was already sealed. Client physics is presentation only — it never decides money. |
| **4. Count the survivors** | Each runner carries an equal share of the claim. A runner who clears has their share multiplied by the route multiplier. A runner who falls loses their share. Lose everyone and the round is over. |
| **5. Bank or continue** | After every arena, no timer. Bank and the lanterns come home. Continue and they run again. |
| **6. Verify** | The server seed is revealed. Re-derive the entire round yourself — including the routes you didn't take. |

**First time?** There is a rehearsal: three branches, no stake, the real model,
on a published seed everybody shares. It does not pay — the seed is chosen so
you lose runners and see what that costs — because a practice run that opens
with a win teaches a distribution that does not exist. It exists to make one
picture land: two route cards side by side, two completely different survivor
distributions, the same <!-- fig:rtpPct -->95.5%<!-- /fig --> under both.
`docs/DESIGN.md` §5.2 specifies it, down to the strings.

### The four routes

| Route | Runners | Total wipe (5 alive) | Multiplier | What it buys, and what it costs |
| --- | --- | --- | --- | --- |
| **WIDE** *The Broad Bough* | all together, one lane | <!-- fig:wideWipe5 -->4.00%<!-- /fig --> | `25/21` = <!-- fig:wideMult -->1.190x<!-- /fig --> | Keeps the most runners alive (<!-- fig:wideExpectedSurvivors5 -->4.20<!-- /fig --> of 5) and clears the whole squad most often (<!-- fig:wideAllClear5 -->49.24%<!-- /fig -->). One shared shear risk that never drops below 4%. |
| **SPLIT** *The Fork* | two independent lanes, balance is yours | **<!-- fig:splitWipe5 -->1.30%<!-- /fig -->** | `4/3` = <!-- fig:splitMult -->1.333x<!-- /fig --> | Best worst case: a wipe needs *both* limbs to fail. Worse typical case: kills more runners on average and clears the squad only <!-- fig:splitAllClear5 -->32.55%<!-- /fig --> of the time. |
| **NARROW** *The Reach* | single file | <!-- fig:narrowWipe5 -->51.56%<!-- /fig --> | `4/1` = <!-- fig:narrowMult -->4.000x<!-- /fig --> | The point runner's fall whips the line and takes everyone. |
| **SHELTER** *The Lamp House* | withdraw some, rest run wide | 0% once you have sheltered | banks `k/n` now | Bring runners home mid-run. Shelter even once and you cannot walk away with nothing. |

Wide and Split is a real trade in both directions, which is what modelling
correlated survival explicitly buys you. Splitting a **five**-runner squad is
<!-- fig:splitSaferRatio5 -->3.07x<!-- /fig --> safer against a total wipe;
splitting a **two**-runner squad is *more* dangerous than staying together
(<!-- fig:splitWipe2 -->6.25%<!-- /fig --> against
<!-- fig:wideWipe2 -->5.50%<!-- /fig -->). And at every squad size Wide keeps
more runners alive. Neither card is the right answer, and nothing in the game
suggests one is.

### And on a Fork, how the squad divides

With four or five runners the Fork asks a second question: **3 + 2, or 4 + 1?**

| | 3 + 2 | 4 + 1 |
| --- | --- | --- |
| Nobody makes it | <!-- fig:splitWipe5 -->1.30%<!-- /fig --> | <!-- fig:scoutWipe5 -->2.52%<!-- /fig --> |
| Four or five make it | <!-- fig:balancedKeep4Plus5 -->65.10%<!-- /fig --> | <!-- fig:scoutKeep4Plus5 -->69.44%<!-- /fig --> |
| All five make it | <!-- fig:splitAllClear5 -->32.55%<!-- /fig --> | <!-- fig:splitAllClear5 -->32.55%<!-- /fig --> |
| One alone comes home | <!-- fig:balancedSole5 -->3.39%<!-- /fig --> | <!-- fig:scoutSole5 -->7.90%<!-- /fig --> |

Sending one runner alone nearly doubles your chance of losing everybody *and*
improves your chance of coming out almost intact. Same multiplier, same chance of
a clean sweep, same <!-- fig:rtpPct -->95.5%<!-- /fig -->. Then you choose *which*
Kindling goes alone — which changes who comes home, and changes no odds at all.
The game says both halves of that out loud.

**And it says the third half too.** 4 + 1 is a *wider* version of 3 + 2, not a
different bet: it moves probability out of the middle into both ends and leaves
the average exactly where it was. Every cautious reading prefers 3 + 2, and the
game is not allowed to pretend otherwise — earlier drafts of the specification
called this a balanced trade, which was simply untrue. Wide against Split is the
comparison that really is a trade in both directions, and `docs/MATH.md` §3.3
publishes the exact table saying which is which, checked on every CI run.

---

## Fairness model

**Two-sided commit-reveal, verifiable by re-derivation, counterfactually
complete.**

1. Before your round exists, the operator publishes
   `SHA-256(its own seed, round id)`. It has committed, and it has not yet seen
   anything of yours.
2. Your device generates a **client seed** locally and shows it to you. You can
   change it to anything. The operator must accept it.
3. Only now is the round's hazard table derived — from **both** seeds. It is
   complete: all five arenas, every lane geometry, every runner,
   <!-- fig:hazardDraws -->120<!-- /fig --> draws, including the routes you will
   not take. Its digest is published immediately.
4. You play. Your choices select which pre-committed draws are consumed. They
   cannot change a single draw — and you cannot read them: the table itself stays
   sealed server-side, and only its digest is published. That is what keeps a
   side bet a bet rather than a receipt.
5. At settlement the server seed is revealed. Anyone can re-derive the whole
   table, recompute the commitment and the digest, and replay your action list to
   reproduce every credit to the micro-credit — including checking the operator's
   published ledger figure by figure.

Two properties, and it is worth being precise about which is which:

* Because the unchosen branches are committed too, **no operator can adapt an
  outcome to your choice** — and the "Ghost Line" replay can show you what would
  have happened on the route you didn't take, provably fixed in advance.
* Because the operator commits *before* your seed exists — and commits to the
  round id at the same moment — **no operator can shop for a favourable round**.
  That attack is the one that matters: it is silent, it is cheap, and against a
  server-only seed it still passes every verification a player can run.
  `docs/ENGINE.md` §10.1 measures it, and `tests/seed-grinding.test.mjs` fails
  the build if the mitigation ever stops working.

Neither property means the software running is the software described here. That
is what an adapter fingerprint, an independent build attestation and a laboratory
process are for, and this repository has none of them. See `docs/ENGINE.md` §10.1
for the residual risks, stated plainly rather than hidden.

Everything else follows the studio bar: exact BigInt rational arithmetic in every
money and probability path (no floats, anywhere), unbiased rejection sampling,
floor rounding at micro-credit precision, a per-ticket cap at every credit event,
and fail-closed handling of hostile input.

### The paytable is proved, not asserted

`tools/enumerate.mjs` enumerates the entire outcome space in exact fractions and
checks **<!-- fig:invariantCount -->1809<!-- /fig --> invariants** on every CI
run — including the one that matters:

> **No decision policy beats the target RTP.** The house margin is charged once
> per ticket; every subsequent action is an exact martingale. Backward induction
> over the whole decision space shows the best policy and the worst policy have
> identical value — exactly `1` — in every reachable state. And every one of
> <!-- fig:portfolioCount -->45<!-- /fig -->
> enumerated portfolios of route policy plus side bets returns
> `E[credited] / E[staked] = 191/200` exactly. Route choice, fork balance,
> shelter size, bank timing and side bets move variance, skew and bust
> probability. They cannot move the expectation.

Consequently BRANCHFALL contains **no skill**, and the product is forbidden from
implying otherwise. Standard deviation of return ranges from
<!-- fig:sdMin -->0.25<!-- /fig --> to <!-- fig:sdMax -->14.46<!-- /fig -->
across policies at a constant <!-- fig:rtpPct -->95.5%<!-- /fig --> RTP; that
<!-- fig:sdSpread -->56.6x<!-- /fig --> spread *is* the game.

---

## Numbers

| | |
| --- | --- |
| Target RTP | `191/200` = **<!-- fig:rtpPct4 -->95.5000%<!-- /fig -->** exactly, every bet, every policy, every portfolio |
| House edge | <!-- fig:houseEdgePct -->4.5%<!-- /fig -->, charged once per ticket, never re-charged per arena |
| Squad / arenas | <!-- fig:squadSize -->5<!-- /fig --> runners, <!-- fig:arenas -->5<!-- /fig --> arenas |
| Biggest route-ticket payout | `24448/25` = **<!-- fig:routeTicketMax -->977.92x<!-- /fig -->** (Narrow five times, all five clear: <!-- fig:topPrizeOdds -->1 in 1,073,741,824<!-- /fig -->) |
| Biggest single side-bet multiplier | Sole Survivor on a full Wide squad, `97792/105` = **<!-- fig:soleSurvivorMax -->931.35x<!-- /fig -->** |
| Max-win cap | **<!-- fig:capMultiple -->1000x<!-- /fig --> per ticket, against that ticket's own stake** — proved unreachable per ticket *and* over the round total, so it can never clip an advertised win |
| Bet types | Route Ticket, plus Clean Sweep / Sole Survivor / Last Light side bets, all at the same <!-- fig:rtpPct -->95.5%<!-- /fig --> |
| Stake limits | 1.00 to <!-- fig:maxStakeCredits -->1,000<!-- /fig -->.00 credits on the run; a side bet never more than **half** the route stake, per bet and per round, so at most <!-- fig:sideBetRoundShare -->33.3%<!-- /fig --> of a round's money can be on the long shots |
| Minimum game cycle | <!-- fig:minCycleMs -->5000<!-- /fig --> ms per arena (<!-- fig:rtsStandard -->UKGC RTS<!-- /fig --> <!-- fig:rtsEdition -->RTS 2021-10-31<!-- /fig -->, <!-- fig:rtsProvision -->RTS 14G<!-- /fig --> — the non-slot casino rule, not RTS 14D's 2.5 s, which is for slots), enforced server-side. The edition is pinned and declared; the lettering has **not** been checked against a certified copy |
| Money unit | micro-credits; worst-case floor-rounding loss <!-- fig:maxRoundingLoss -->0.000005<!-- /fig --> credits on the route ticket, <!-- fig:maxRoundingLossRound -->0.000020<!-- /fig --> across a round that also carries side bets |

---

## Run it

```bash
npm install

npm run enumerate          # the proof: exact fractions, every invariant
npm run montecarlo         # independent simulation, sanity cross-check only
npm run transcript         # a reference round: commit, play, reveal, verify
npm run transcript -- --chain 8   # a pre-committed server-seed chain
npm run rehearsal          # the published first-run rehearsal, and its teaching beats
npm run rehearsal:search   # re-derive the seed pair choice from scratch
npm test                   # everything above, as assertions
npm run docs:check         # fails if any document has drifted from the model
```

`npm run enumerate` prints every route contract, every route geometry including
both fork balances, every `(geometry, survivors)` outcome with its exact
probability and multiplier, every side bet, the value of every action in every
state, the full outcome space of <!-- fig:policyCount -->9<!-- /fig --> named
policies and <!-- fig:portfolioCount -->45<!-- /fig --> portfolios, and the
max-win cap analysis — all as exact fractions.

---

## Play it

```bash
npm run dev                # server + client on http://localhost:4173
npm run conformance        # the engine's own checks, against this declaration
npm run verify:bundle -- round.json   # check an exported round on any machine
npm test                   # includes a full round driven through the API
```

`npm run dev` bundles the client, watches both the TypeScript and the static
files, serves everything on one port, and opens an in-memory free-play wallet of
500.00 credits. Nothing here is real money and nothing is persisted: restart the
process and the session is gone. `npm run dev -- --dev-clock` additionally
exposes `POST /api/dev/advance-clock`, which is how the tests prove the
speed-of-play floor and the reality check fire; it is refused otherwise.

**What the graybox is.** The complete product at placeholder-art fidelity. Real
information architecture, real flows, real mathematics, real fairness: the four
route cards with their exact numbers, the fork balance and the choice of who
takes the thin limb, the shelter picker, the three side bets with their prices,
bank-or-continue, the wipe, the round summary, the verification screen, the
Ghost Line, and the unstaked three-branch rehearsal on the published seed pair.
The branch is a rectangle and a Kindling is a stroke with a lantern dot — the art
direction in `docs/DESIGN.md` §6 is a later wave, and the palette and type
direction are the only parts of it this build implements. §6.5 writes its sizes
as limits — 15 px body, 13 px secondary, 28 px for the claim, no numeral under
15 px — so they are CSS tokens and `tests/type-floor.test.mjs` fails if a rule
reaches for a size instead of a floor. The one size below the secondary floor is
the break-even tick glyph on the distribution chart, which carries no figure.
"Numeral" is the part that needs an interpretation, because most of the secondary
copy in this product mentions a number inside a sentence:
`docs/ADR-001-the-numeral-floor.md` writes down the reading — a figure presented
as a figure is at 15 px, prose that mentions one stays on the 13 px tier — lists
every element that holds a figure without the `money` class, and is honest that
the live DOM is measured by review rather than by a headless test this repo does
not have. Two rounds of review found the same counter under the floor; it is at
15 px now, with the footer's `stake 5.00` and the fork-balance headings.

Four properties of the client are worth stating because they are the ones a
graybox usually gets wrong:

- **The ending on screen is the ending that happened.** A round settles onto one
  of two terminal screens, and they say opposite things. Which one it is comes
  from the settlement the server returns — the only value that still knows whether
  anyone was running — and never from the engine's live set, which the settle
  empties on a won round and a lost one alike. `tests/settled-screen.test.mjs`
  drives both endings through the API on fixed seeds and pins the decision to the
  settlement.
- **The decision screen is one screen.** On the 390 x 844 baseline, S2 fits the
  four routes with their prices, the claim, the whole selected card, the controls
  that name a Kindling and `Commit route` in a single unscrolled viewport, and
  the page never scrolls. The card the rail is showing is the card the footer
  commits — the selection follows a settled swipe, and the rail is restored after
  every render — so the screen and the command can never disagree.
- **The proof screen recomputes the round on the device.** `client/src/derive.ts`
  is a second implementation of the engine's derivation — canonical encoding,
  HMAC sampler, tape digest, lane and entity resolution — written against the
  published algorithm and importing neither the engine nor the server. `Re-derive`
  rebuilds the definition fingerprint, the seed commitment, the whole 300-draw
  tape and every arena's draws in the browser and shows each runner's draw
  against the threshold that decided them. What the server reports about its own
  settlement is in its own section, labelled as the server's own word for it.
- **The responsible-play controls are real and server-enforced.** A reality check
  at the operator's interval (default 30 min) that pauses the game, a session
  time limit, a session loss limit, and a one-way self-exclusion hand-off. The
  buy path consults the same function the settings screen displays, so a client
  that skipped the screen still cannot stake. `tests/responsible-play.test.mjs`
  moves the dev clock and proves each of them.

**What the server is.** A Node/TypeScript service consuming
`@axiom-games/reveal-engine`'s `staged-survival` lifecycle module as a package,
from `vendor/`. It is not a reimplementation of anything: the counterfactually
complete tape, the seed pre-commitment published before the client seed exists,
correlated lane resolution, per-runner claims banked in subsets under one
ceiling, receipts, idempotency, snapshots and the transcript verifier are all the
module's. The server adds the things a generic module cannot know — the route
menu at each squad size, the side-bet prices computed from the module's own
survivor law, the stake limits, the game-cycle floor, the wallet, and how an
abandoned round closes.

| Command | What it does |
| --- | --- |
| `POST /api/rounds` | publishes the pre-commitment. No stake, no seed, nothing of yours |
| `POST /api/rounds/:id/open` | binds your client seed to the commitment you saw, debits the stake, derives the sealed tape, publishes its digest |
| `POST /api/rounds/:id/commit` | route, fork balance, lane assignment, shelter and side bets — one transaction, one receipt |
| `POST /api/rounds/:id/resolve` | replays the branch you already committed to, from the sealed tape |
| `POST /api/rounds/:id/bank` | brings the rest home, then settles and reveals |
| `POST /api/rounds/:id/expire` | the only path that closes an abandoned round: auto-bank where BANK is legal, a full-stake void where it is not |
| `GET /api/rounds/:id/verify` | the published record, plus a re-derivation of every credited figure |
| `POST /api/verify` | the same check on any bundle, from any source |
| `POST /api/session` | the cosmetic and responsible-play settings: runner names, disclosure, reality-check interval, session and loss limits, the self-exclusion hand-off |

In every live frame, monetary `exact` and display rationals are denominated in
credits; fields named `micro` or ending in `Micro` remain integer micro-credits.

**Where the graybox differs from `docs/ENGINE.md`, stated rather than smoothed
over.** That document specified a module before one existed; the module that
shipped is generic, and two things landed differently.

1. **A fork balance is a contract, not an argument.** The module fixes a
   geometry with one `laneWidth`, so each legal lead-lane size is declared as its
   own contract. The two coincide exactly on the canonical balance range, and
   `server/definition.ts` proves it at boot, size by size, against the module's
   own lane cuts.
2. **The module proves one cap basis — the round's external stake.** For the
   route ticket that *is* the route stake, so the ceiling accumulates across
   shelter withdrawals, banks and settlement exactly as specified. Side bets are
   separate tickets with their own stakes and their own accumulators, which is
   the per-ticket basis `docs/MATH.md` §9 proves.
3. **A stake divides into five equal shares, so it is a multiple of five
   micro-credits.** Every runner carries an equal share and the module holds each
   share as an integer, so a stake of `1.000001` credits is refused where
   `1.000000` and `1.000005` are taken. `docs/MATH.md` declares the interval and
   no increment, so this is a real narrowing — of five millionths of a credit,
   and the alternative is unequal shares, which is the premise the whole §8 proof
   rests on.
4. **The engine's round entropy is exactly 32 bytes of hex; a player's seed is
   anything they like.** `docs/ENGINE.md` §9 requires the operator to accept
   1–64 printable bytes, and refusing one is called an integration defect of the
   highest severity. So a seed that is not already in the module's form is hashed
   into it with SHA-256, and the verification screen shows both halves and the
   derivation, because a player who typed a seed still has to be able to see that
   theirs is the one that was used.

Neither of the first two changes a probability, a price or a payout.
`tests/graybox-model.test.mjs` checks every geometry, every outcome, every claim
factor and all <!-- fig:sideBetRows -->42<!-- /fig --> side-bet prices against
`tools/enumerate.mjs` before a card is allowed to show a digit.

**And one thing commit-reveal cannot do, said plainly.** The stake is not inside
the commitment — the module's transcript has no stake field and nothing here is
signed — so a verifier establishes that *every credit is right for the stake the
record declares*, not that the declared stake is what was debited. A player
checks that against what their own client showed them. The verification screen
says so in the same weight as the checks that do pass, because a control that
does not exist should not be implied by silence.

---

## Documentation

| Document | What's in it |
| --- | --- |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Full product spec: loop, how an abandoned round closes, every decision and what it actually changes, the route card down to its break-even field, bet types and their stake limits, mobile portrait UX screen by screen, the first-run rehearsal and progressive disclosure with two measurable comprehension gates, speed-of-play floor, art direction (palette, materials, lighting, motion, type, references, five arena briefs), runtime with device classes, per-frame and first-load budgets, the bounded authored-clip library, sound direction, the signature viral moment, responsible-design requirements including the shared clip's advertising status, and an art production budget with headcount and schedule |
| [`docs/MATH.md`](docs/MATH.md) | The exact model: state space, correlated hazard model, complete paytable as fractions, which choices are genuine trades and which are volatility dials (second-order dominance, computed), where the claim turns, RTP justification, volatility profile, per-ticket and per-round max-win cap proofs, and the proof that no policy and no portfolio beats the target RTP |
| [`docs/ENGINE.md`](docs/ENGINE.md) | The `staged-survival` Reveal Engine lifecycle module this game needs, its adapter surface as TypeScript, two-seed hazard derivation, commitment format and seed chains, conformance checks, RGS obligations, threat model |

| Source | What it is |
| --- | --- |
| `tools/enumerate.mjs` | The proof. Exhaustive exact enumeration of the outcome space |
| `tools/transcript.mjs` | Reference two-sided commit-reveal derivation, replay and verification |
| `tools/montecarlo.mjs` | Forward simulation from first principles; cross-check only |
| `tools/rehearsal.mjs` | The published first-run rehearsal: the seed pair, the search that chose it, and the teaching beats it has to land |
| `tools/sync-docs.mjs` | Publishes every generated table and figure into the docs |
| `tools/verify-bundle.ts` | Verifies an exported round anywhere, from the published record alone |
| `tools/rehearsal-seed.ts` | The published search that chose the rehearsal seed pair |
| `src/staged-survival.ts` | The engine lifecycle contract, compilable |
| `src/branchfall.adapter.ts` | The BRANCHFALL adapter declaration, compilable |
| `server/definition.ts` | The BRANCHFALL declaration on the shipped module, and the geometry proof |
| `server/rounds.ts` | The round: pre-commit, open, commit, resolve, settle, expire |
| `server/paytable.ts` | Every card number, derived from the engine's own survivor law |
| `server/sidebets.ts` | Side-bet pricing, stake limits and settlement |
| `server/rehearsal.ts` | The unstaked teaching path — no wallet, no book, no receipt |
| `server/verify.ts` | The proof *and* the ledger, re-derived |
| `client/src/` | The browser client: portrait, mobile-first, no framework |
| `tests/` | Exact-arithmetic tests, paytable-matches-docs, frozen wire fixtures, hostile input, seed-grinding mitigation, and a full round driven through the API |

---

## Status

| | |
| --- | --- |
| Stage | Specification closed; **playable graybox** on the shipped engine module — real flows, real mathematics, real fairness, placeholder art |
| Real money | **No.** Free-play prototype throughout |
| Certification | **None claimed.** Not a fairness certificate, RNG certificate, mathematical certification, or regulatory approval |
| Engine | `@axiom-games/reveal-engine` 0.4.0, `reveal-engine/api-v1`, `staged-survival` lifecycle module 1.0.0, consumed as a package from `vendor/` |
| Next | Art, motion and sound against `docs/DESIGN.md` §6–§7; the determinism, performance and comprehension harnesses in §11.3; an operator integration |

Deployment would require frozen configuration, independently reviewed seed
custody, an operator integration and wallet audit, jurisdictional analysis, a
reserve and risk model, production load evidence, and any required laboratory
process. Nothing in this repository substitutes for any of that.

---

## Original work

BRANCHFALL's theme, characters, obstacles, art direction and copy are original to
Axiom Games. It contains no third-party intellectual property, no reference to or
imitation of any existing obstacle-course or elimination-format game, and no
borrowed silhouettes, characters or obstacle designs. The design brief in
`docs/DESIGN.md` §1 states the originality guard explicitly and the visual
references in §6.6 are described photographic and craft techniques, not works.

`UNLICENSED` — proprietary, Axiom Games.
