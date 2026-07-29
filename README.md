# BRANCHFALL

[![CI](https://github.com/metaforismo/branchfall/actions/workflows/ci.yml/badge.svg)](https://github.com/metaforismo/branchfall/actions/workflows/ci.yml)
![RTP](https://img.shields.io/badge/RTP-95.5%25%20exact-C9A227)
![Proof](https://img.shields.io/badge/paytable-exhaustively%20enumerated-informational)
![Arithmetic](https://img.shields.io/badge/arithmetic-exact%20BigInt%20rationals-informational)
![Money](https://img.shields.io/badge/real%20money-no%20%E2%80%94%20free%20play%20prototype-lightgrey)
![Certification](https://img.shields.io/badge/certification-none%20claimed-lightgrey)

**Five small figures with lanterns for hearts cross five collapsing branches
above a fog nobody has seen the bottom of.** You send them; they do the running.
Before each branch you choose a route — take the wide bough together, fork into
two paths, send everyone single-file across the dangerous shortcut, or open a
shelter door and bring some of them home right now. Every route pays back exactly
the same 95.5%. What you are actually choosing is the *shape* of the risk, and
which of your runners you are willing to gamble. When the last lantern goes out,
the screen goes cold and quiet. When you get one home, a brass door closes on a
light that is still burning.

BRANCHFALL is a provably-fair staged-survival game built on **Reveal Engine**,
the shared Axiom Games TypeScript core. This repository is the complete,
build-ready specification: the product design, the exact probability model, the
engine lifecycle it consumes, a runnable enumerator that proves the paytable, and
tests that fail if the published numbers and the mathematics ever disagree.

---

## How a round works

| | |
| --- | --- |
| **1. Buy the run** | Your stake is debited and the round opens with a claim of `stake x 95.5%`. This is the **only** time the house margin is charged. Before you make a single choice, the server publishes a hash committing to every outcome in the round. |
| **2. Choose a route** | Four contracts, no timer, all four showing their exact odds for your current squad size. |
| **3. Watch the run** | A 9–14 second replay of an outcome that was already sealed. Client physics is presentation only — it never decides money. |
| **4. Count the survivors** | Each runner carries an equal share of the claim. A runner who clears has their share multiplied by the route multiplier. A runner who falls loses their share. Lose everyone and the round is over. |
| **5. Bank or continue** | After every arena, no timer. Bank and the lanterns come home. Continue and they run again. |
| **6. Verify** | The seed is revealed. Re-derive the entire round yourself — including the routes you didn't take. |

### The four routes

| Route | Runners | Total wipe (5 alive) | Multiplier | Feel |
| --- | --- | --- | --- | --- |
| **WIDE** *The Broad Bough* | all together, one lane | 4.00% | `25/21` = 1.190x | Keeps the most runners alive. One shared shear risk that never drops below 4%. |
| **SPLIT** *The Fork* | two independent lanes | **1.30%** | `4/3` = 1.333x | Kills more runners on average, yet **3.07x safer** against losing everyone — a wipe needs *both* limbs to fail. |
| **NARROW** *The Reach* | single file | 51.56% | `4/1` = 4.000x | The point runner's fall whips the line and takes everyone. |
| **SHELTER** *The Lamp House* | withdraw some, rest run wide | 0% once you have sheltered | banks `k/n` now | Bring runners home mid-run. Shelter even once and you cannot walk away with nothing. |

The Wide/Split reversal is real, not flavour: splitting a **five**-runner squad
is three times safer against a total wipe, and splitting a **two**-runner squad is
*more* dangerous than staying together. That is what modelling correlated
survival explicitly buys you — and it is the strategic heart of the game.

---

## Fairness model

**Commit-reveal, verifiable by re-derivation, counterfactually complete.**

1. Before your first decision, the operator draws a 32-byte seed and derives the
   **complete** hazard table for the round — all five arenas, all four lane
   geometries, all 120 draws — including the routes you will not take.
2. It publishes `SHA-256(seed, hazard table)`. You see the hash before you choose.
3. You play. Your choices select which pre-committed draws are consumed. They
   cannot change a single draw.
4. At settlement the seed is revealed. Anyone can re-derive the whole table,
   recompute the commitment, and replay your action list to reproduce every
   credit to the micro-credit.

Because the unchosen branches are committed too, **no operator can adapt an
outcome to your choice** — and the "Ghost Line" replay can show you what would
have happened on the route you didn't take, provably fixed in advance.

Everything else follows the studio bar: exact BigInt rational arithmetic in every
money and probability path (no floats, anywhere), unbiased rejection sampling,
floor rounding at micro-credit precision, a chain cap at every credit event, and
fail-closed handling of hostile input.

### The paytable is proved, not asserted

`tools/enumerate.mjs` enumerates the entire outcome space in exact fractions and
checks **488 invariants** on every CI run — including the one that matters:

> **No decision policy beats the target RTP.** The house margin is charged once,
> at entry; every subsequent action is an exact martingale. Backward induction
> over the whole decision space shows the best policy and the worst policy have
> identical value — exactly `1` — in every reachable state. Route choice, shelter
> size, bank timing and side bets move variance, skew and bust probability. They
> cannot move the expectation.

Consequently BRANCHFALL contains **no skill**, and the product is forbidden from
implying otherwise. Standard deviation of return ranges from **0.26 to 14.46**
across policies at a constant 95.5% RTP; that 57x spread *is* the game.

---

## Numbers

| | |
| --- | --- |
| Target RTP | `191/200` = **95.5000%** exactly, every bet, every policy |
| House edge | 4.5%, charged once at entry, never re-charged per arena |
| Squad / arenas | 5 runners, 5 arenas |
| Max reachable payout | `24448/25` = **977.92x** (Narrow five times, all five clear: `1` in `1,073,741,824`) |
| Max-win cap | **1000x**, proved unreachable — it can never clip an advertised win |
| Bet types | Route Ticket, plus Clean Sweep / Sole Survivor / Last Light side bets, all at the same 95.5% |
| Biggest single multiplier | Sole Survivor on a full Wide squad, `97792/105` = **931.35x** |
| Money unit | micro-credits; worst-case rounding loss `0.000005` credits per round |

---

## Run it

```bash
npm install

npm run enumerate          # the proof: exact fractions, 488 invariants
npm run montecarlo         # independent simulation, sanity cross-check only
npm run transcript         # a reference round: commit, play, reveal, verify
npm test                   # everything above, as assertions
npm run docs:check         # fails if docs/MATH.md has drifted from the model
```

`npm run enumerate` prints every route contract, every `(contract, squad, survivors)`
outcome with its exact probability and multiplier, every side bet, the value of
every action in every state, the full outcome space of eight named policies, and
the max-win cap analysis — all as exact fractions.

---

## Documentation

| Document | What's in it |
| --- | --- |
| [`docs/DESIGN.md`](docs/DESIGN.md) | Full product spec: loop, every decision and what it actually changes, bet types, mobile portrait UX screen by screen, art direction (palette, materials, lighting, motion, type, references), sound direction, the signature viral moment, responsible-design requirements |
| [`docs/MATH.md`](docs/MATH.md) | The exact model: state space, correlated hazard model, complete paytable as fractions, RTP justification, volatility profile, max-win cap proof, and the proof that no policy beats the target RTP |
| [`docs/ENGINE.md`](docs/ENGINE.md) | The `staged-survival` Reveal Engine lifecycle module this game needs, its adapter surface as TypeScript, hazard derivation, commitment format, conformance checks, RGS obligations, threat model |

| Source | What it is |
| --- | --- |
| `tools/enumerate.mjs` | The proof. Exhaustive exact enumeration of the outcome space |
| `tools/transcript.mjs` | Reference commit-reveal derivation, replay and verification |
| `tools/montecarlo.mjs` | Forward simulation from first principles; cross-check only |
| `src/staged-survival.ts` | The engine lifecycle contract, compilable |
| `src/branchfall.adapter.ts` | The BRANCHFALL adapter declaration, compilable |
| `tests/` | Exact-arithmetic tests, paytable-matches-docs, frozen wire fixture, hostile input |

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
