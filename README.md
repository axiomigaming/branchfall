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
specification: the product design, the exact probability model, the engine
lifecycle it consumes, a runnable enumerator that proves the paytable, and tests
that fail if the published numbers and the mathematics ever disagree.

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
| `src/staged-survival.ts` | The engine lifecycle contract, compilable |
| `src/branchfall.adapter.ts` | The BRANCHFALL adapter declaration, compilable |
| `tests/` | Exact-arithmetic tests, paytable-matches-docs, frozen wire fixtures, hostile input, seed-grinding mitigation |

---

## Status

| | |
| --- | --- |
| Stage | Specification complete; engine lifecycle module not yet implemented |
| Real money | **No.** Free-play prototype throughout |
| Certification | **None claimed.** Not a fairness certificate, RNG certificate, mathematical certification, or regulatory approval |
| Engine | Targets `@axiom-games/reveal-engine` `reveal-engine/api-v1`; requires a new `staged-survival` lifecycle module (see `docs/ENGINE.md`) |
| Next | Implement `src/protocol/staged-survival/` in the engine against the frozen fixture in `tests/fixtures/` |

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
