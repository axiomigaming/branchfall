# BRANCHFALL — exact probability model

**Status:** free-play prototype specification. Engineering standard is real-money grade; regulatory standing is none. See [Certification boundary](#12-certification-boundary).

Everything in this document is produced by `tools/enumerate.mjs` in exact BigInt
rational arithmetic and re-checked on every CI run by `tests/`. No figure here
was estimated, simulated or rounded into existence. Where a decimal appears it
sits beside the exact fraction it was rendered from. Every number in the prose,
not only in the tables, is a generated slot: `npm run docs:check` fails if a
sentence in this repository claims something the model does not compute.

```
npm run enumerate            # the full derivation, as exact fractions
npm run docs:sync            # regenerates every table and figure in the docs
npm test                     # proves this document matches the enumeration
```

This is an engineering document. It uses the vocabulary of decision theory —
*policy*, *strategy*, *optimal play* — because that is what the mathematics is
about. Player-facing copy may not: see `DESIGN.md` §10.3, which scopes the
banned-vocabulary rule to every surface a player reads, and the test that
enforces it.

---

## 1. Notation and constants

| Symbol | Meaning |
| --- | --- |
| `N = 5` | runners in a fresh squad |
| `K = 5` | arenas in a full run |
| `n` | runners alive and *running* an arena |
| `m` | runners who clear that arena, `0 <= m <= n` |
| `c` | lane collapse probability (shared, correlated) |
| `q` | per-runner clear probability given the lane holds |
| `p = (1 - c) q` | marginal per-runner survival |
| `mu = 1 / p` | route multiplier |
| `k` | lane balance: the size of the lead lane on a SPLIT |
| `r = 191/200` | theoretical RTP, charged once per ticket |
| `V_a` | claim carried into arena `a`, as a multiple of the route stake |

Money is denominated in **micro-credits**: `1 credit = 1 000 000 uc`. Credits are
floored to whole micro-credits, so the route ticket's rounding loss is bounded by
5 uc and a whole round's — including every side bet it can legally carry — by
<!-- fig:maxRoundingLossRoundUc -->20<!-- /fig --> uc. Twenty millionths of one
credit. This is the only reason the unit is that small, and it is why floor
rounding is economically invisible here (§10).

---

## 2. State space

A round is a finite Markov decision process. The state is

```
(a, S, V, B_route, W_side)
```

* `a in {1..K+1}` — the arena about to be run (`K+1` is the finish line),
* `S ⊆ {0..N-1}` — the set of runners still in the run,
* `V` — the claim carried by `S`, an exact rational multiple of the route stake,
* `B_route` — micro-credits already credited against the **route ticket**, for
  that ticket's own cap,
* `W_side` — side-bet money already staked this round, for the round-wide
  side-bet stake limit (§5.5).

Runners are exchangeable in money terms — each carries exactly `V / |S|` — so for
every probability and payout question the route-ticket state collapses to
`(a, n, V)` with `n = |S|`. Runner *identity* still matters to the player and to
the transcript, never to the mathematics (§5.4).

Reachable `(a, n)` pairs: `(1, 5)` and `{2..5} x {1..5}` — 21 states. The
enumerator sweeps the superset `{1..5} x {1..5}` (25 states) so that no
reachability argument is load-bearing in the proof.

The action set in a state is `BANK` (from arena 2), `ROUTE(C, k)` for every
contract `C` available at `n` and every legal lane balance `k`, and `SHELTER(j)`
for `1 <= j <= n-1`. Any route or shelter action may carry up to three side-bet
tickets, committed at the same instant (§5.5).

The claim is never floored mid-round. Only a credit event — a shelter
withdrawal, a bank, a settlement, or a side-bet resolution — converts an exact
rational into an integer number of micro-credits.

---

## 3. The hazard model: correlation is explicit

A route contract describes a **lane geometry** and a **hazard profile**. Each lane
resolves in two layers:

1. **Lane collapse.** With probability `c` the lane fails as a whole and *every*
   runner in it goes down together. This is the correlated layer, and it is the
   only source of correlation in the model.
2. **Per-runner clear.** If the lane holds, each runner in it independently
   clears with probability `q`.

Lanes are physically separate routes and resolve independently.

For a lane of size `s`, the number of survivors `j` has exact distribution

```
P(j = 0) = c + (1 - c) (1 - q)^s
P(j = t) =     (1 - c) C(s,t) q^t (1 - q)^(s-t)     for t >= 1
```

A geometry's distribution is the convolution of its lanes' distributions.

Marginal per-runner survival is `p = (1 - c) q` for every runner, in every lane,
under every contract and every lane balance. **The collapse layer moves every
moment of the distribution except the first.** That single fact is the whole
design: geometry reshapes risk without touching expectation.

<!-- table:contracts -->
| Contract | Lanes | Min runners | Lane collapse `c` | Per-runner clear `q` | Marginal survival `p` | Route multiplier `mu` | `mu` decimal |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WIDE | 1 | 1 | `1/25` | `7/8` | `21/25` | `25/21` | 1.19047619 |
| SPLIT | 2 | 2 | `1/10` | `5/6` | `3/4` | `4/3` | 1.33333333 |
| NARROW | 1 | 1 | `1/2` | `1/2` | `1/4` | `4/1` | 4.00000000 |

* **WIDE** — one broad lane, whole squad together. Rarely collapses (4%), rarely
  drops an individual (12.5%). Highest expected survivors, lowest multiplier.
  Because everyone shares one lane, its total-wipe probability has a hard floor
  of `c = 1/25` no matter how large the squad.
* **SPLIT** — two independent lanes. Each lane is more dangerous than a wide
  lane, but a total wipe now requires *both* lanes to fail.
* **NARROW** — single file down the shortcut. The point runner's fall takes the
  line with them: `c = 1/2`. Four-times multiplier, and slightly better than even
  odds that nobody comes out.

### 3.1 The correlation actually bites, and it flips

Total-wipe probability by contract and squad size — the number a player feels
(SPLIT shown on its balanced geometry):

<!-- table:wipes -->
| Runners `n` | WIDE | SPLIT (balanced) | SPLIT (lopsided) | NARROW | Safer route |
| --- | --- | --- | --- | --- | --- |
| 2 | 0.055000 | **0.062500** | — | 0.625000 | WIDE |
| 3 | 0.041875 | **0.031250** | — | 0.562500 | SPLIT |
| 4 | 0.040234 | **0.015625** | 0.026042 | 0.531250 | SPLIT |
| 5 | 0.040029 | **0.013021** | 0.025174 | 0.515625 | SPLIT |

Splitting a five-runner squad makes a total wipe
<!-- fig:splitSaferRatio5 -->3.07x<!-- /fig --> less likely than running wide,
even though a Split lane is individually more dangerous and Split kills more
runners on average (<!-- fig:splitFallen5 -->1.25<!-- /fig --> vs
<!-- fig:wideFallen5 -->0.80<!-- /fig --> per arena). Splitting a *two*-runner
squad makes a wipe **more** likely
(<!-- fig:splitWipe2 -->6.25%<!-- /fig --> against WIDE's
<!-- fig:wideWipe2 -->5.50%<!-- /fig -->), because two solo lanes remove the
safety of numbers. The crossover sits between `n = 2` and `n = 3`.

That reversal is not a tuning accident; it is what modelling correlation
explicitly buys. A model with independent per-runner deaths and no shared
collapse would show Split as uniformly safer and would be lying.

It is also not the whole story, and the product must not sell it as though it
were. WIDE keeps more runners alive
(<!-- fig:wideExpectedSurvivors5 -->4.20<!-- /fig --> against
<!-- fig:splitExpectedSurvivors5 -->3.75<!-- /fig -->) and clears the whole
squad far more often (<!-- fig:wideAllClear5 -->49.24%<!-- /fig --> against
<!-- fig:splitAllClear5 -->32.55%<!-- /fig -->). SPLIT trades a better *worst*
case for a worse *typical* case, and neither dominates the other — not loosely,
but in the exact sense §3.3 defines and proves: their integrated CDFs cross at
every squad size, so no risk-averse reading prefers one card. That is the one
comparison in this game that passes that test, and §3.3 is where the ones that
fail it are named.

### 3.2 The lane balance is a second, independent shape lever

A SPLIT with `n` runners divides into lanes of `k` and `n - k`. The balance is a
**player choice**, canonicalised so the lead lane is never the smaller half —
`[3,2]` and `[2,3]` are the same geometry, because lane order is a drawing
convention and not a distributional fact.

At `n = 2` and `n = 3` there is exactly one legal balance, so there is no choice
and the interface must not imply one. At `n = 4` and `n = 5` there are two:

| `n` | Balance | P(total wipe) | P(exactly one clears) | P(all but one or better) | P(all clear) | E[survivors] |
| --- | --- | --- | --- | --- | --- | --- |
| 5 | 3+2 | <!-- fig:splitWipe5 -->1.30%<!-- /fig --> | <!-- fig:balancedSole5 -->3.39%<!-- /fig --> | <!-- fig:balancedKeep4Plus5 -->65.10%<!-- /fig --> | <!-- fig:splitAllClear5 -->32.55%<!-- /fig --> | <!-- fig:splitExpectedSurvivors5 -->3.75<!-- /fig --> |
| 5 | 4+1 | <!-- fig:scoutWipe5 -->2.52%<!-- /fig --> | <!-- fig:scoutSole5 -->7.90%<!-- /fig --> | <!-- fig:scoutKeep4Plus5 -->69.44%<!-- /fig --> | <!-- fig:splitAllClear5 -->32.55%<!-- /fig --> | <!-- fig:splitExpectedSurvivors5 -->3.75<!-- /fig --> |
| 4 | 2+2 | <!-- fig:splitWipe4 -->1.56%<!-- /fig --> | <!-- fig:balancedSole4 -->6.25%<!-- /fig --> | <!-- fig:balancedKeep3Plus4 -->70.31%<!-- /fig --> | <!-- fig:splitAllClear4 -->39.06%<!-- /fig --> | <!-- fig:splitExpectedSurvivors4 -->3.00<!-- /fig --> |
| 4 | 3+1 | <!-- fig:scoutWipe4 -->2.60%<!-- /fig --> | <!-- fig:scoutSole4 -->9.38%<!-- /fig --> | <!-- fig:scoutKeep3Plus4 -->75.52%<!-- /fig --> | <!-- fig:splitAllClear4 -->39.06%<!-- /fig --> | <!-- fig:splitExpectedSurvivors4 -->3.00<!-- /fig --> |

Four things are true at once, and all four are proved in CI:

1. **The mean is untouched.** `E[survivors] = n p` for every balance, so
   `E[claim after] = claim before` exactly. The balance cannot move RTP.
2. **P(all clear) is untouched.** It is `(1-c)^2 q^n` — a function of the lane
   *count*, not the balance. So the headline multiplier outcome is identical and
   the choice cannot be sold as "better odds of a clean run".
3. **Everything between the tails moves, in opposite directions.** Sending one
   runner alone nearly doubles the chance of losing the whole squad
   (<!-- fig:splitWipe5 -->1.30%<!-- /fig --> →
   <!-- fig:scoutWipe5 -->2.52%<!-- /fig -->) and simultaneously raises the
   chance of coming out with four or five
   (<!-- fig:balancedKeep4Plus5 -->65.10%<!-- /fig --> →
   <!-- fig:scoutKeep4Plus5 -->69.44%<!-- /fig -->), because four runners riding
   one lane that usually holds is a more concentrated bet than three-and-two.
4. **And that makes it a dial, not a trade.** Mass leaving the middle for *both*
   tails at an unchanged mean is the definition of a mean-preserving spread, so
   `4+1` is exactly a mean-preserving spread of `3+2` and every risk-averse
   reading prefers `3+2`. §3.3 computes it, publishes the whole lattice, and
   binds it.

**What the v2 draft claimed here, and why it was wrong.** This section used to
end "Neither balance dominates the other on any reading", and `DESIGN.md` §3.3
sold the fork as "a genuine, non-dominated trade". Both were false. Point 3 above
— everything between the tails moving in opposite directions — is what a
mean-preserving spread looks like from the middle, and it is an argument *for*
domination rather than against it. It was also the only claim in this section
that was prose instead of an invariant, which is exactly how it survived three
rounds of review. It is now an invariant, and the invariant says the other
thing.

### 3.3 Which choices are trades, and which are volatility dials

Every choice in this game holds the mean fixed at `1` (§4). That is the whole
design, and it is also what makes "is this choice real?" a precise question with
a standard answer rather than a matter of taste.

**The test.** For two lotteries with the *same* mean, `A` is preferred to `B` by
every risk-averse reading — every concave utility, without naming one — exactly
when the integrated CDF of `A` is nowhere above that of `B`:

```
I_X(t) = ∫_0^t P(X <= x) dx = sum_i p_i max(0, t - x_i)

A second-order stochastically dominates B   iff   I_A(t) <= I_B(t) for all t
```

With equal means, that relation is exactly "`B` is a mean-preserving spread of
`A`" (Rothschild–Stiglitz). So there are only two possible verdicts for any pair
of cards on this game's table:

* **the integrated CDFs cross** — neither is preferred by every risk-averse
  reading, and the choice is a genuine trade;
* **one dominates** — the other is a mean-preserving spread of it, and the
  choice is a pure volatility dial.

**What is compared.** The exact claim-factor distribution of a single arena: the
atoms are `(m/n) * mu` with probability `P(m)` from the geometry's own survivor
distribution, and the enumerator asserts every one of them has mean exactly
`1/1` before comparing anything. Pairs are formed *within* a squad size, because
that is the set of cards a player is actually offered at that moment.

**Why the check is a proof and not a sample.** `I_A - I_B` is piecewise linear in
`t` with breakpoints exactly at the atoms of the two distributions, is zero below
the smallest atom, and is constant at `mean(B) - mean(A) = 0` from the largest
atom onward. A piecewise-linear function attains its extrema at its breakpoints,
so evaluating every atom decides every real `t`. All of it in exact rationals.

Of the <!-- fig:dominancePairs -->19<!-- /fig --> pairs a player can be offered
at one squad size, <!-- fig:dominanceTrades -->6<!-- /fig --> cross and
<!-- fig:dominanceDials -->13<!-- /fig --> are nested:

<!-- table:dominance -->
| Runners `n` | A | B | Second-order relation | What that makes the choice |
| --- | --- | --- | --- | --- |
| 1 | WIDE | NARROW | **WIDE** dominates | a volatility dial: the other side is a mean-preserving spread |
| 2 | WIDE | SPLIT 1+1 | **neither** — integrated CDFs cross | a genuine trade: no risk-averse reading prefers one |
| 2 | WIDE | NARROW | **WIDE** dominates | a volatility dial: the other side is a mean-preserving spread |
| 2 | SPLIT 1+1 | NARROW | **SPLIT 1+1** dominates | a volatility dial: the other side is a mean-preserving spread |
| 3 | WIDE | SPLIT 2+1 | **neither** — integrated CDFs cross | a genuine trade: no risk-averse reading prefers one |
| 3 | WIDE | NARROW | **WIDE** dominates | a volatility dial: the other side is a mean-preserving spread |
| 3 | SPLIT 2+1 | NARROW | **SPLIT 2+1** dominates | a volatility dial: the other side is a mean-preserving spread |
| 4 | WIDE | SPLIT 2+2 | **neither** — integrated CDFs cross | a genuine trade: no risk-averse reading prefers one |
| 4 | WIDE | SPLIT 3+1 | **neither** — integrated CDFs cross | a genuine trade: no risk-averse reading prefers one |
| 4 | WIDE | NARROW | **WIDE** dominates | a volatility dial: the other side is a mean-preserving spread |
| 4 | SPLIT 2+2 | SPLIT 3+1 | **SPLIT 2+2** dominates | a volatility dial: the other side is a mean-preserving spread |
| 4 | SPLIT 2+2 | NARROW | **SPLIT 2+2** dominates | a volatility dial: the other side is a mean-preserving spread |
| 4 | SPLIT 3+1 | NARROW | **SPLIT 3+1** dominates | a volatility dial: the other side is a mean-preserving spread |
| 5 | WIDE | SPLIT 3+2 | **neither** — integrated CDFs cross | a genuine trade: no risk-averse reading prefers one |
| 5 | WIDE | SPLIT 4+1 | **neither** — integrated CDFs cross | a genuine trade: no risk-averse reading prefers one |
| 5 | WIDE | NARROW | **WIDE** dominates | a volatility dial: the other side is a mean-preserving spread |
| 5 | SPLIT 3+2 | SPLIT 4+1 | **SPLIT 3+2** dominates | a volatility dial: the other side is a mean-preserving spread |
| 5 | SPLIT 3+2 | NARROW | **SPLIT 3+2** dominates | a volatility dial: the other side is a mean-preserving spread |
| 5 | SPLIT 4+1 | NARROW | **SPLIT 4+1** dominates | a volatility dial: the other side is a mean-preserving spread |

Three readings, and the third is the uncomfortable one:

1. **WIDE against SPLIT is a genuine trade at every squad size, on both
   balances.** The integrated CDFs cross every time. This is the comparison the
   product is built on, and it is the thing a difficulty selector cannot
   produce: a selector moves one dial, and one dial is always nested.
2. **The fork balance is not.** `3+2` dominates `4+1` at five runners and `2+2`
   dominates `3+1` at four. And it is not rescued by taking the lopsided fork on
   the last arena only: over a whole five-arena run the balanced policy
   second-order dominates the lopsided one as well, which the enumerator checks
   directly on the two policies' full return distributions.
3. **NARROW is dominated by everything at every squad size.** It has the same
   RTP as every other card, and it is a mean-preserving spread of both of them.

**And here is exactly what that does and does not mean**, because a dominance
result is easy to over-read in both directions.

* It is **not** a statement about return. Every row in the table has RTP
  `191/200`; §8 proves no arrangement of these cards moves it.
* It is **not** a claim that a player taking NARROW or `4+1` has made a mistake.
  Second-order dominance ranks equal-mean lotteries *by risk aversion alone*. A
  player who wants the tail is buying the tail, and the tail is a real product
  with a real price of zero. `DESIGN.md` §10.3 forbids the game from telling
  anyone their card is the wrong one, and this section does not license it.
* What it **does** forbid is selling a dial as a trade. A volatility dial is an
  honest control and this game has several. Describing one as a balanced,
  non-dominated choice is a different act, and it is the act this repository
  committed for three rounds.

---

## 4. The money rule

> Every runner carries an equal share of the squad's claim. A runner who clears
> an arena has their share multiplied by the route multiplier `mu`. A runner who
> falls loses their share.

Formally, with `n` runners carrying claim `V` into an arena that returns `m`
survivors:

```
V' = V * (m / n) * mu       where mu = 1 / p
```

Because `E[m] = n p` (linearity of expectation — correlation and lane balance are
both irrelevant to the mean),

```
E[V'] = V * mu * E[m] / n = V * (1/p) * p = V
```

for **every** contract, **every** lane balance and **every** squad size.
Continuation is a fair bet. The house margin is taken exactly once, when the run
is bought: `V_1 = r`.

### 4.1 Shelter

`SHELTER(j)` withdraws `j` of the `n` living runners to the shelter platform.
Their shares — `V j / n` — are credited immediately and permanently. The
remaining `n - j` runners run the arena on the WIDE profile. So

```
E[total] = V j/n  +  V (n-j)/n = V
```

Shelter is exactly a partial bank composed with a Wide run. It is presented as a
fourth contract because that is how it reads to a player, and documented as a
composition because that is what it is.

---

## 5. Bet types

BRANCHFALL has one primary wager and three optional side bets. Every one of them
returns exactly `r = 191/200`, and so does every portfolio of them (§8.2).

### 5.1 The Route Ticket (primary wager)

Buying a run debits the stake and opens a claim of `V_1 = r` times the stake. It
resolves through the sequence of arenas the player chooses, ending in a bank, a
finish-line settlement, or a total wipe. Its RTP is `r` under every policy (§8).

### 5.2 Route geometries — the per-arena paytable

Each `(contract, n, balance)` triple is a distinct **geometry**, and each
`(geometry, m)` pair is a distinct outcome with an exact probability and an exact
claim multiplier `(m/n) * mu`. This is the complete arena paytable.

<!-- table:geometries -->
| Contract | Runners `n` | Lane balance | Balances offered | P(total wipe) | P(all clear) | P(exactly one) | E[survivors] | Stage RTP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WIDE | 1 | 1 | 1 | `4/25` = 0.160000000000 | `21/25` = 0.840000000000 | `21/25` = 0.840000000000 | `21/25` = 0.840000 | `1/1` |
| WIDE | 2 | 2 | 1 | `11/200` = 0.055000000000 | `147/200` = 0.735000000000 | `21/100` = 0.210000000000 | `42/25` = 1.680000 | `1/1` |
| WIDE | 3 | 3 | 1 | `67/1600` = 0.041875000000 | `1029/1600` = 0.643125000000 | `63/1600` = 0.039375000000 | `63/25` = 2.520000 | `1/1` |
| WIDE | 4 | 4 | 1 | `103/2560` = 0.040234375000 | `7203/12800` = 0.562734375000 | `21/3200` = 0.006562500000 | `84/25` = 3.360000 | `1/1` |
| WIDE | 5 | 5 | 1 | `4099/102400` = 0.040029296875 | `50421/102400` = 0.492392578125 | `21/20480` = 0.001025390625 | `21/5` = 4.200000 | `1/1` |
| SPLIT | 2 | 1+1 | 1 | `1/16` = 0.062500000000 | `9/16` = 0.562500000000 | `3/8` = 0.375000000000 | `3/2` = 1.500000 | `1/1` |
| SPLIT | 3 | 2+1 | 1 | `1/32` = 0.031250000000 | `15/32` = 0.468750000000 | `5/32` = 0.156250000000 | `9/4` = 2.250000 | `1/1` |
| SPLIT | 4 | 2+2 | 2 | `1/64` = 0.015625000000 | `25/64` = 0.390625000000 | `1/16` = 0.062500000000 | `3/1` = 3.000000 | `1/1` |
| SPLIT | 4 | 3+1 | 2 | `5/192` = 0.026041666667 | `25/64` = 0.390625000000 | `3/32` = 0.093750000000 | `3/1` = 3.000000 | `1/1` |
| SPLIT | 5 | 3+2 | 2 | `5/384` = 0.013020833333 | `125/384` = 0.325520833333 | `13/384` = 0.033854166667 | `15/4` = 3.750000 | `1/1` |
| SPLIT | 5 | 4+1 | 2 | `29/1152` = 0.025173611111 | `125/384` = 0.325520833333 | `91/1152` = 0.078993055556 | `15/4` = 3.750000 | `1/1` |
| NARROW | 1 | 1 | 1 | `3/4` = 0.750000000000 | `1/4` = 0.250000000000 | `1/4` = 0.250000000000 | `1/4` = 0.250000 | `1/1` |
| NARROW | 2 | 2 | 1 | `5/8` = 0.625000000000 | `1/8` = 0.125000000000 | `1/4` = 0.250000000000 | `1/2` = 0.500000 | `1/1` |
| NARROW | 3 | 3 | 1 | `9/16` = 0.562500000000 | `1/16` = 0.062500000000 | `3/16` = 0.187500000000 | `3/4` = 0.750000 | `1/1` |
| NARROW | 4 | 4 | 1 | `17/32` = 0.531250000000 | `1/32` = 0.031250000000 | `1/8` = 0.125000000000 | `1/1` = 1.000000 | `1/1` |
| NARROW | 5 | 5 | 1 | `33/64` = 0.515625000000 | `1/64` = 0.015625000000 | `5/64` = 0.078125000000 | `5/4` = 1.250000 | `1/1` |

The full outcome space, geometry by geometry:

<!-- table:outcomes -->
| Contract | Runners `n` | Lane balance | Survivors `m` | Exact probability | Probability | Exact claim multiplier | Claim multiplier |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WIDE | 1 | 1 | 0 | `4/25` | 0.160000000000 | `0/1` | 0.00000000 |
| WIDE | 1 | 1 | 1 | `21/25` | 0.840000000000 | `25/21` | 1.19047619 |
| WIDE | 2 | 2 | 0 | `11/200` | 0.055000000000 | `0/1` | 0.00000000 |
| WIDE | 2 | 2 | 1 | `21/100` | 0.210000000000 | `25/42` | 0.59523810 |
| WIDE | 2 | 2 | 2 | `147/200` | 0.735000000000 | `25/21` | 1.19047619 |
| WIDE | 3 | 3 | 0 | `67/1600` | 0.041875000000 | `0/1` | 0.00000000 |
| WIDE | 3 | 3 | 1 | `63/1600` | 0.039375000000 | `25/63` | 0.39682540 |
| WIDE | 3 | 3 | 2 | `441/1600` | 0.275625000000 | `50/63` | 0.79365079 |
| WIDE | 3 | 3 | 3 | `1029/1600` | 0.643125000000 | `25/21` | 1.19047619 |
| WIDE | 4 | 4 | 0 | `103/2560` | 0.040234375000 | `0/1` | 0.00000000 |
| WIDE | 4 | 4 | 1 | `21/3200` | 0.006562500000 | `25/84` | 0.29761905 |
| WIDE | 4 | 4 | 2 | `441/6400` | 0.068906250000 | `25/42` | 0.59523810 |
| WIDE | 4 | 4 | 3 | `1029/3200` | 0.321562500000 | `25/28` | 0.89285714 |
| WIDE | 4 | 4 | 4 | `7203/12800` | 0.562734375000 | `25/21` | 1.19047619 |
| WIDE | 5 | 5 | 0 | `4099/102400` | 0.040029296875 | `0/1` | 0.00000000 |
| WIDE | 5 | 5 | 1 | `21/20480` | 0.001025390625 | `5/21` | 0.23809524 |
| WIDE | 5 | 5 | 2 | `147/10240` | 0.014355468750 | `10/21` | 0.47619048 |
| WIDE | 5 | 5 | 3 | `1029/10240` | 0.100488281250 | `5/7` | 0.71428571 |
| WIDE | 5 | 5 | 4 | `7203/20480` | 0.351708984375 | `20/21` | 0.95238095 |
| WIDE | 5 | 5 | 5 | `50421/102400` | 0.492392578125 | `25/21` | 1.19047619 |
| SPLIT | 2 | 1+1 | 0 | `1/16` | 0.062500000000 | `0/1` | 0.00000000 |
| SPLIT | 2 | 1+1 | 1 | `3/8` | 0.375000000000 | `2/3` | 0.66666667 |
| SPLIT | 2 | 1+1 | 2 | `9/16` | 0.562500000000 | `4/3` | 1.33333333 |
| SPLIT | 3 | 2+1 | 0 | `1/32` | 0.031250000000 | `0/1` | 0.00000000 |
| SPLIT | 3 | 2+1 | 1 | `5/32` | 0.156250000000 | `4/9` | 0.44444444 |
| SPLIT | 3 | 2+1 | 2 | `11/32` | 0.343750000000 | `8/9` | 0.88888889 |
| SPLIT | 3 | 2+1 | 3 | `15/32` | 0.468750000000 | `4/3` | 1.33333333 |
| SPLIT | 4 | 2+2 | 0 | `1/64` | 0.015625000000 | `0/1` | 0.00000000 |
| SPLIT | 4 | 2+2 | 1 | `1/16` | 0.062500000000 | `1/3` | 0.33333333 |
| SPLIT | 4 | 2+2 | 2 | `7/32` | 0.218750000000 | `2/3` | 0.66666667 |
| SPLIT | 4 | 2+2 | 3 | `5/16` | 0.312500000000 | `1/1` | 1.00000000 |
| SPLIT | 4 | 2+2 | 4 | `25/64` | 0.390625000000 | `4/3` | 1.33333333 |
| SPLIT | 4 | 3+1 | 0 | `5/192` | 0.026041666667 | `0/1` | 0.00000000 |
| SPLIT | 4 | 3+1 | 1 | `3/32` | 0.093750000000 | `1/3` | 0.33333333 |
| SPLIT | 4 | 3+1 | 2 | `1/8` | 0.125000000000 | `2/3` | 0.66666667 |
| SPLIT | 4 | 3+1 | 3 | `35/96` | 0.364583333333 | `1/1` | 1.00000000 |
| SPLIT | 4 | 3+1 | 4 | `25/64` | 0.390625000000 | `4/3` | 1.33333333 |
| SPLIT | 5 | 3+2 | 0 | `5/384` | 0.013020833333 | `0/1` | 0.00000000 |
| SPLIT | 5 | 3+2 | 1 | `13/384` | 0.033854166667 | `4/15` | 0.26666667 |
| SPLIT | 5 | 3+2 | 2 | `23/192` | 0.119791666667 | `8/15` | 0.53333333 |
| SPLIT | 5 | 3+2 | 3 | `35/192` | 0.182291666667 | `4/5` | 0.80000000 |
| SPLIT | 5 | 3+2 | 4 | `125/384` | 0.325520833333 | `16/15` | 1.06666667 |
| SPLIT | 5 | 3+2 | 5 | `125/384` | 0.325520833333 | `4/3` | 1.33333333 |
| SPLIT | 5 | 4+1 | 0 | `29/1152` | 0.025173611111 | `0/1` | 0.00000000 |
| SPLIT | 5 | 4+1 | 1 | `91/1152` | 0.078993055556 | `4/15` | 0.26666667 |
| SPLIT | 5 | 4+1 | 2 | `7/192` | 0.036458333333 | `8/15` | 0.53333333 |
| SPLIT | 5 | 4+1 | 3 | `95/576` | 0.164930555556 | `4/5` | 0.80000000 |
| SPLIT | 5 | 4+1 | 4 | `425/1152` | 0.368923611111 | `16/15` | 1.06666667 |
| SPLIT | 5 | 4+1 | 5 | `125/384` | 0.325520833333 | `4/3` | 1.33333333 |
| NARROW | 1 | 1 | 0 | `3/4` | 0.750000000000 | `0/1` | 0.00000000 |
| NARROW | 1 | 1 | 1 | `1/4` | 0.250000000000 | `4/1` | 4.00000000 |
| NARROW | 2 | 2 | 0 | `5/8` | 0.625000000000 | `0/1` | 0.00000000 |
| NARROW | 2 | 2 | 1 | `1/4` | 0.250000000000 | `2/1` | 2.00000000 |
| NARROW | 2 | 2 | 2 | `1/8` | 0.125000000000 | `4/1` | 4.00000000 |
| NARROW | 3 | 3 | 0 | `9/16` | 0.562500000000 | `0/1` | 0.00000000 |
| NARROW | 3 | 3 | 1 | `3/16` | 0.187500000000 | `4/3` | 1.33333333 |
| NARROW | 3 | 3 | 2 | `3/16` | 0.187500000000 | `8/3` | 2.66666667 |
| NARROW | 3 | 3 | 3 | `1/16` | 0.062500000000 | `4/1` | 4.00000000 |
| NARROW | 4 | 4 | 0 | `17/32` | 0.531250000000 | `0/1` | 0.00000000 |
| NARROW | 4 | 4 | 1 | `1/8` | 0.125000000000 | `1/1` | 1.00000000 |
| NARROW | 4 | 4 | 2 | `3/16` | 0.187500000000 | `2/1` | 2.00000000 |
| NARROW | 4 | 4 | 3 | `1/8` | 0.125000000000 | `3/1` | 3.00000000 |
| NARROW | 4 | 4 | 4 | `1/32` | 0.031250000000 | `4/1` | 4.00000000 |
| NARROW | 5 | 5 | 0 | `33/64` | 0.515625000000 | `0/1` | 0.00000000 |
| NARROW | 5 | 5 | 1 | `5/64` | 0.078125000000 | `4/5` | 0.80000000 |
| NARROW | 5 | 5 | 2 | `5/32` | 0.156250000000 | `8/5` | 1.60000000 |
| NARROW | 5 | 5 | 3 | `5/32` | 0.156250000000 | `12/5` | 2.40000000 |
| NARROW | 5 | 5 | 4 | `5/64` | 0.078125000000 | `16/5` | 3.20000000 |
| NARROW | 5 | 5 | 5 | `1/64` | 0.015625000000 | `4/1` | 4.00000000 |

"Stage RTP" above is `sum_m P(m) * (m/n) * mu`, which must be exactly `1/1` for
every geometry — that is the fair-continuation property, checked per row.

### 5.2.1 Where the claim turns

The claim is multiplied by `(m/n) * mu`, so it holds or grows exactly when

```
m >= n / mu = n p       break-even survivor count = ceil(n p)
```

This is the single number that makes the money rule legible, and it is the one
number the route card in `DESIGN.md` §3.2 did not carry. It is not derivable by a
player from anything else on the card, and it is different for every contract:

<!-- table:breakeven -->
| Contract | Runners `n` | Lane balance | Claim holds or grows at | Claim factor there | P(claim grows) | P(claim holds) | P(claim falls, above zero) | P(total wipe) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| WIDE | 1 | 1 | **1** of 1 | `25/21` | 84.00% | 0.00% | 0.00% | 16.00% |
| WIDE | 2 | 2 | **2** of 2 | `25/21` | 73.50% | 0.00% | 21.00% | 5.50% |
| WIDE | 3 | 3 | **3** of 3 | `25/21` | 64.31% | 0.00% | 31.50% | 4.19% |
| WIDE | 4 | 4 | **4** of 4 | `25/21` | 56.27% | 0.00% | 39.70% | 4.02% |
| WIDE | 5 | 5 | **5** of 5 | `25/21` | 49.24% | 0.00% | 46.76% | 4.00% |
| SPLIT | 2 | 1+1 | **2** of 2 | `4/3` | 56.25% | 0.00% | 37.50% | 6.25% |
| SPLIT | 3 | 2+1 | **3** of 3 | `4/3` | 46.88% | 0.00% | 50.00% | 3.13% |
| SPLIT | 4 | 2+2 | **3** of 4 | `1/1` | 39.06% | 31.25% | 28.13% | 1.56% |
| SPLIT | 4 | 3+1 | **3** of 4 | `1/1` | 39.06% | 36.46% | 21.88% | 2.60% |
| SPLIT | 5 | 3+2 | **4** of 5 | `16/15` | 65.10% | 0.00% | 33.59% | 1.30% |
| SPLIT | 5 | 4+1 | **4** of 5 | `16/15` | 69.44% | 0.00% | 28.04% | 2.52% |
| NARROW | 1 | 1 | **1** of 1 | `4/1` | 25.00% | 0.00% | 0.00% | 75.00% |
| NARROW | 2 | 2 | **1** of 2 | `2/1` | 37.50% | 0.00% | 0.00% | 62.50% |
| NARROW | 3 | 3 | **1** of 3 | `4/3` | 43.75% | 0.00% | 0.00% | 56.25% |
| NARROW | 4 | 4 | **1** of 4 | `1/1` | 34.38% | 12.50% | 0.00% | 53.13% |
| NARROW | 5 | 5 | **2** of 5 | `8/5` | 40.63% | 0.00% | 7.81% | 51.56% |

Four facts a designer has to hold, all of them checked in CI:

1. **WIDE needs the whole running group, at every squad size.** `n p = 0.84 n`,
   whose ceiling is `n` for every `n` in `1..5`. So on a full WIDE squad the
   claim grows <!-- fig:wideRises5 -->49.24%<!-- /fig --> of the time and
   **falls without the round ending**
   <!-- fig:wideFallsNonZero5 -->46.76%<!-- /fig --> of the time. Those two
   numbers are nearly equal, and only the first has ever been on the card.
2. **P(claim grows) equals P(all clear) on WIDE and nowhere else.** That
   coincidence is exactly why the card cannot reuse the "all five make it" field
   for it: on SPLIT and NARROW the same field would mean a different thing.
3. **The break-even can be hit exactly.** At `SPLIT/4` the factor at three
   survivors is `1/1`, so <!-- fig:balancedHolds4 -->31.25%<!-- /fig --> of `2+2`
   arenas return the claim unchanged. "Grows" and "does not fall" are therefore
   two different questions, and the model answers both separately.
4. **NARROW inverts the shape.** Below five runners its break-even is one
   survivor, so at `n <= 4` the claim never shrinks: it grows, it holds, or the
   round is over. At five runners the break-even moves to
   <!-- fig:narrowBreakEven5 -->2<!-- /fig --> and a
   <!-- fig:narrowFallsNonZero5 -->7.81%<!-- /fig --> sliver of shrinking-but-
   alive appears.

The genre expectation this measures against is "the number only goes up until you
die", which is true of a crash curve and of a lane ladder and is false here for
every contract in this table. A player who carries the genre expectation into
BRANCHFALL will misread the most common outcome of the most popular card, which
is why `DESIGN.md` §3.2 puts the break-even on the card face and §5.2.8 gates the
build on a player being able to state it.

### 5.3 Shelter

`SHELTER(j)` for `1 <= j <= n-1`, available whenever `n >= 2`. Banks `j/n` of the
claim, runs the remainder on the WIDE profile. Its arena distribution is the
WIDE row for `n - j` runners.

**There is no `SHELTER(n)`, and BANK is unavailable before arena 1 resolves.**
Together those two facts mean a purchased ticket always exposes at least `1/n` of
the claim to the first arena: the action set in state `(1, n)` is
`{ROUTE(...), SHELTER(1..n-1)}` and every element of it runs at least one runner.
This is a property of the model, not a UI choice, and `DESIGN.md` §2 and S2 are
required to surface it — including the rule that the shelter picker must reject
an all-`n` selection at input time rather than at commit time.

It also binds the one resolution the player does not choose. A round abandoned
past the operator's expiry window is closed by the server, and because `BANK` does
not exist in state `(1, n)` an expiry before arena 1 resolves cannot bank: it
voids the wager and returns the stake, which is a cancellation and not a payout.
`DESIGN.md` §2.1 and `ENGINE.md` §6.1 carry that rule; it is recorded here because
this paragraph is where a future editor will look for the reason.

### 5.4 What runner identity does, and does not, do

Which specific runners are withdrawn to a shelter, and which lane a given runner
is assigned to on a SPLIT, are **free player choices with zero effect on any
probability**. Runners are exchangeable: they carry equal shares and have
identical marginal survival, so no assignment of identities to positions can move
any moment of any distribution.

What identity does change is which pre-committed slip draws are consumed, and
therefore *who* comes home — which is the entire emotional content of the game
and none of its mathematics. `DESIGN.md` §3 says exactly this and is forbidden
from saying anything stronger; the test suite greps for the difference.

### 5.5 Side bets

Optional, per-arena, staked with **fresh money**, resolved by the same arena
outcome as the main game, and committed at the same instant as the route so they
cannot be placed with any information the route commitment did not already have.

**The three events**, defined on the survivor count `m` of the group that
actually runs (which is the reduced group under a SHELTER):

* **CLEAN SWEEP** — every running runner clears this arena (`m = n`).
* **SOLE SURVIVOR** — exactly one runner clears (`m = 1`).
* **LAST LIGHT** — nobody clears (`m = 0`).

**Pricing rule**, without exception:

```
multiplier = r / P(event | committed geometry)
```

`P` is read directly out of the committed geometry's own survivor distribution —
including its lane balance. A SOLE SURVIVOR on a 4+1 split is a different bet at
a different price from a SOLE SURVIVOR on a 3+2 split, because it is a different
proposition. The enumerator asserts, for every state and every legal action, that
the offered probability equals the probability computed from that action's own
branch table; a price that drifts from the arena it rides on fails CI.

Offered only when at least **2** runners are running, so the three events stay
distinct: at `n = 1`, CLEAN SWEEP and SOLE SURVIVOR are the same proposition and
the card would be a lie.

**Stake limits.** These are load-bearing in three separate directions — the cap
proof (§9), the meaning of "1000x the stake" when a round contains several
stakes, and responsible design — so they are declared, not left to the operator:

| Limit | Value | Why |
| --- | --- | --- |
| Minimum route stake | 1.000000 credit | the unit everything else is a ratio of |
| Maximum route stake | **<!-- fig:maxStakeCredits -->1,000<!-- /fig -->.00 credits** | a declared liability ceiling: <!-- fig:maxTicketLiabilityCredits -->1,000,000<!-- /fig -->.00 credits on one route ticket at the 1000x cap (below) |
| Minimum per side bet | 1.000000 credit | same floor as the route ticket |
| Maximum per side bet | **<!-- fig:sideBetStakeRatio -->0.50<!-- /fig --> x the route stake** | a side bet may never carry more than half the money of the run it rides on |
| Maximum per round, all side bets | **<!-- fig:sideBetStakeRatio -->0.50<!-- /fig --> x the route stake** | the run is always at least twice every side bet in the round put together, so at most <!-- fig:sideBetRoundShare -->33.3%<!-- /fig --> of a round's money can sit on the long shots |
| Maximum tickets per arena | 3 | one per event; the same event cannot be staked twice |
| Stake persistence | none | side-bet stakes reset to zero every arena and are never inherited |

**Why a half and not parity, which is what the v2 draft declared.** Both ratios
were `1/1`, and that delivered the cap argument (§9.3) while quietly failing the
responsible-design one it was also sold on. At parity the maximum legal
configuration in the game — a route ticket beside a maximum-stake SOLE SURVIVOR
on arena 1 — had a standard deviation of **14.895961**, above the all-NARROW
route ticket's **14.464388**. In other words the most volatile product in the
entire specification was a side bet at its ceiling: half the round's money on a
1-in-975 shot at <!-- fig:soleSurvivorMax -->931.35x<!-- /fig -->, which is
precisely the "one-in-a-thousand lottery wearing its costume" this limit exists
to prevent. A limit at parity bounds the long shot from *exceeding* the game; it
does not stop it *substituting* for the game.

At `1/2` the most volatile enumerated portfolio that adds side bets to a route
ticket has standard deviation
<!-- fig:maxSideBetPortfolioSd -->10.96<!-- /fig -->, below the
<!-- fig:sdMax -->14.46<!-- /fig --> of the route ticket alone. **The most
volatile thing the game offers is the game**, and §8.4 asserts it over all
<!-- fig:portfolioCount -->45<!-- /fig --> portfolios rather than leaving it to
this paragraph. `DESIGN.md` §10.2 carries the product-side claim, which is now
the claim the build discharges.

**Why the maximum route stake is declared at all.** It was `10^15`
micro-credits through v2 — one billion credits per ticket, a `10^18` micro-credit
liability ceiling — fingerprinted, and justified in no document, while every
other limit in the adapter got a paragraph. `MATH.md` §9.4 says the cap exists to
give operators and RGS risk limits "a hard liability ceiling"; a ceiling nobody
can state is not one. At <!-- fig:maxStakeCredits -->1,000<!-- /fig -->.00
credits the number a risk model needs is
<!-- fig:maxTicketLiabilityCredits -->1,000,000<!-- /fig -->.00 credits per route
ticket, and the round bound in §9.3 turns that into a round figure by the same
arithmetic. An operator may configure lower; configuring higher changes the
adapter fingerprint, which is the point.

<!-- table:sidebets -->
| Side bet | Contract | Runners | Lane balance | Exact probability | Probability | Exact multiplier | Multiplier | Exact RTP |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| CLEAN_SWEEP | WIDE | 2 | 2 | `147/200` | 0.735000000000 | `191/147` | 1.29931973 | `191/200` |
| CLEAN_SWEEP | WIDE | 3 | 3 | `1029/1600` | 0.643125000000 | `1528/1029` | 1.48493683 | `191/200` |
| CLEAN_SWEEP | WIDE | 4 | 4 | `7203/12800` | 0.562734375000 | `12224/7203` | 1.69707067 | `191/200` |
| CLEAN_SWEEP | WIDE | 5 | 5 | `50421/102400` | 0.492392578125 | `97792/50421` | 1.93950933 | `191/200` |
| CLEAN_SWEEP | SPLIT | 2 | 1+1 | `9/16` | 0.562500000000 | `382/225` | 1.69777778 | `191/200` |
| CLEAN_SWEEP | SPLIT | 3 | 2+1 | `15/32` | 0.468750000000 | `764/375` | 2.03733333 | `191/200` |
| CLEAN_SWEEP | SPLIT | 4 | 2+2 | `25/64` | 0.390625000000 | `1528/625` | 2.44480000 | `191/200` |
| CLEAN_SWEEP | SPLIT | 4 | 3+1 | `25/64` | 0.390625000000 | `1528/625` | 2.44480000 | `191/200` |
| CLEAN_SWEEP | SPLIT | 5 | 3+2 | `125/384` | 0.325520833333 | `9168/3125` | 2.93376000 | `191/200` |
| CLEAN_SWEEP | SPLIT | 5 | 4+1 | `125/384` | 0.325520833333 | `9168/3125` | 2.93376000 | `191/200` |
| CLEAN_SWEEP | NARROW | 2 | 2 | `1/8` | 0.125000000000 | `191/25` | 7.64000000 | `191/200` |
| CLEAN_SWEEP | NARROW | 3 | 3 | `1/16` | 0.062500000000 | `382/25` | 15.28000000 | `191/200` |
| CLEAN_SWEEP | NARROW | 4 | 4 | `1/32` | 0.031250000000 | `764/25` | 30.56000000 | `191/200` |
| CLEAN_SWEEP | NARROW | 5 | 5 | `1/64` | 0.015625000000 | `1528/25` | 61.12000000 | `191/200` |
| SOLE_SURVIVOR | WIDE | 2 | 2 | `21/100` | 0.210000000000 | `191/42` | 4.54761905 | `191/200` |
| SOLE_SURVIVOR | WIDE | 3 | 3 | `63/1600` | 0.039375000000 | `1528/63` | 24.25396825 | `191/200` |
| SOLE_SURVIVOR | WIDE | 4 | 4 | `21/3200` | 0.006562500000 | `3056/21` | 145.52380952 | `191/200` |
| SOLE_SURVIVOR | WIDE | 5 | 5 | `21/20480` | 0.001025390625 | `97792/105` | 931.35238095 | `191/200` |
| SOLE_SURVIVOR | SPLIT | 2 | 1+1 | `3/8` | 0.375000000000 | `191/75` | 2.54666667 | `191/200` |
| SOLE_SURVIVOR | SPLIT | 3 | 2+1 | `5/32` | 0.156250000000 | `764/125` | 6.11200000 | `191/200` |
| SOLE_SURVIVOR | SPLIT | 4 | 2+2 | `1/16` | 0.062500000000 | `382/25` | 15.28000000 | `191/200` |
| SOLE_SURVIVOR | SPLIT | 4 | 3+1 | `3/32` | 0.093750000000 | `764/75` | 10.18666667 | `191/200` |
| SOLE_SURVIVOR | SPLIT | 5 | 3+2 | `13/384` | 0.033854166667 | `9168/325` | 28.20923077 | `191/200` |
| SOLE_SURVIVOR | SPLIT | 5 | 4+1 | `91/1152` | 0.078993055556 | `27504/2275` | 12.08967033 | `191/200` |
| SOLE_SURVIVOR | NARROW | 2 | 2 | `1/4` | 0.250000000000 | `191/50` | 3.82000000 | `191/200` |
| SOLE_SURVIVOR | NARROW | 3 | 3 | `3/16` | 0.187500000000 | `382/75` | 5.09333333 | `191/200` |
| SOLE_SURVIVOR | NARROW | 4 | 4 | `1/8` | 0.125000000000 | `191/25` | 7.64000000 | `191/200` |
| SOLE_SURVIVOR | NARROW | 5 | 5 | `5/64` | 0.078125000000 | `1528/125` | 12.22400000 | `191/200` |
| LAST_LIGHT | WIDE | 2 | 2 | `11/200` | 0.055000000000 | `191/11` | 17.36363636 | `191/200` |
| LAST_LIGHT | WIDE | 3 | 3 | `67/1600` | 0.041875000000 | `1528/67` | 22.80597015 | `191/200` |
| LAST_LIGHT | WIDE | 4 | 4 | `103/2560` | 0.040234375000 | `12224/515` | 23.73592233 | `191/200` |
| LAST_LIGHT | WIDE | 5 | 5 | `4099/102400` | 0.040029296875 | `97792/4099` | 23.85752623 | `191/200` |
| LAST_LIGHT | SPLIT | 2 | 1+1 | `1/16` | 0.062500000000 | `382/25` | 15.28000000 | `191/200` |
| LAST_LIGHT | SPLIT | 3 | 2+1 | `1/32` | 0.031250000000 | `764/25` | 30.56000000 | `191/200` |
| LAST_LIGHT | SPLIT | 4 | 2+2 | `1/64` | 0.015625000000 | `1528/25` | 61.12000000 | `191/200` |
| LAST_LIGHT | SPLIT | 4 | 3+1 | `5/192` | 0.026041666667 | `4584/125` | 36.67200000 | `191/200` |
| LAST_LIGHT | SPLIT | 5 | 3+2 | `5/384` | 0.013020833333 | `9168/125` | 73.34400000 | `191/200` |
| LAST_LIGHT | SPLIT | 5 | 4+1 | `29/1152` | 0.025173611111 | `27504/725` | 37.93655172 | `191/200` |
| LAST_LIGHT | NARROW | 2 | 2 | `5/8` | 0.625000000000 | `191/125` | 1.52800000 | `191/200` |
| LAST_LIGHT | NARROW | 3 | 3 | `9/16` | 0.562500000000 | `382/225` | 1.69777778 | `191/200` |
| LAST_LIGHT | NARROW | 4 | 4 | `17/32` | 0.531250000000 | `764/425` | 1.79764706 | `191/200` |
| LAST_LIGHT | NARROW | 5 | 5 | `33/64` | 0.515625000000 | `1528/825` | 1.85212121 | `191/200` |

**Stake legality, and where the limits degenerate.** The declared limits are:
minimum route stake 1.00 credit (`minStake = 1_000_000` micro-credits), maximum
route stake <!-- fig:maxStakeCredits -->1,000<!-- /fig -->.00 credits, minimum per
side bet 1.00 credit, maximum per side bet half a route stake, maximum per round
across all side bets half a route stake. These are not independent at the bottom
of the range, and the halved ratio moves where they collide. **Below a
<!-- fig:minRouteStakeForASideBet -->2.00<!-- /fig --> credit route stake no side
bet is legal at all**, because half of anything smaller is under the 1.00
per-ticket minimum; at exactly
<!-- fig:minRouteStakeForASideBet -->2.00<!-- /fig --> the only legal
configuration in an entire round is a single ticket of exactly 1.00 credit; and
the "at most three tickets per arena" ceiling is unreachable below a 6.00 route
stake, where reaching it consumes the round's whole allowance in one arena. The
ceiling is a bound, not an entitlement. **No proof in this document depends on
any of it:** every quantity here is a ratio, RTP is scale-invariant, and §8.2
proves portfolio invariance for arbitrary non-negative stake vectors, legal or
not. The limits exist for §9.3's cap argument and for `DESIGN.md` §4's
responsible-design reasons, and `DESIGN.md` §4 carries the product-side rules
(hide the control when the remaining allowance is under the minimum; offer the
remaining allowance as the ceiling).

Side bets are strongly correlated with the main game — LAST LIGHT pays exactly
when the Route Ticket dies — but expectation is linear, so any combination of
Route Ticket and side bets returns `r` times total money staked (§8.2). There is
no hedge, no arbitrage, and no combination with a different edge. **LAST LIGHT is
not insurance and is never described as insurance in product copy**; it carries
the identical 4.5% margin as every other bet (see `DESIGN.md` §10).

---

## 6. Target RTP and its justification

**Target RTP: `191/200` = 95.5% exactly. House edge 4.5%.**

Why this number:

1. **Inside the mandated band.** 94%–97% was the design constraint; 95.5% sits
   mid-band, leaving headroom in both directions for operator-configurable
   variants without leaving the band.
2. **Studio consistency.** It is the same first-entry RTP the Reveal Engine's
   BLACK SIGNAL reference adapter declares (`9550/10000`). One studio, one edge,
   one number a player can learn once.
3. **Exactly representable.** `191/200` is a terminating, small-denominator
   rational. Every multiplier in this document is a ratio of modest integers, and
   `r / P` never introduces a denominator that needs approximation.
4. **Competitive.** Crash and cash-out ladder games cluster at 96%–97%; classic
   slot content sits at 94%–96%. 95.5% is honest for a title carrying a
   five-arena narrative and a provable-fairness verifier.
5. **Charged once.** Because continuation is fair (§4), a player who rides five
   arenas is *not* charged the edge five times. A naive 95.5%-per-stage design
   would deliver `0.955^5 = 79.4%` to a deep player. Ours delivers 95.5% to
   everybody, which is the whole point of the martingale construction.

---

## 7. Volatility profile

RTP is fixed. **Volatility is the thing the player actually chooses**, and the
spread is enormous: standard deviation of return ranges from
<!-- fig:sdMin -->0.25<!-- /fig --> to <!-- fig:sdMax -->14.46<!-- /fig --> across
policies — a <!-- fig:sdSpread -->56.6x<!-- /fig --> range at constant expectation.

Every row below is the **complete** outcome space of that policy, enumerated
exactly. "Leaves" is the number of terminal paths walked.

<!-- table:policies -->
| Policy | Leaves | Exact RTP | RTP % | Std. dev. | P(bust) | P(>= 1x) | P(>= 10x) | P(>= 100x) | Max return |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bolt (Wide, bank after arena 1) | 6 | `191/200` | 95.5000 | 0.255234 | 0.04002930 | 0.49239258 | 0.00000000 | 0.0000000000 | `191/168` = 1.136905 |
| Ranger (Wide x5) | 252 | `191/200` | 95.5000 | 0.647270 | 0.20698397 | 0.42741307 | 0.00000000 | 0.0000000000 | `74609375/32672808` = 2.283531 |
| Forker (Split x5 balanced, Wide when alone) | 252 | `191/200` | 95.5000 | 0.837499 | 0.23838546 | 0.33002791 | 0.00000000 | 0.0000000000 | `24448/6075` = 4.024362 |
| Scout (Split x5 lopsided, Wide when alone) | 252 | `191/200` | 95.5000 | 0.877762 | 0.26028451 | 0.32909257 | 0.00000000 | 0.0000000000 | `24448/6075` = 4.024362 |
| Knife (Narrow x5) | 252 | `191/200` | 95.5000 | 14.464388 | 0.99541297 | 0.00458703 | 0.00458703 | 0.0045870254 | `24448/25` = 977.920000 |
| Keeper (shelter half every arena, Wide when alone) | 20 | `191/200` | 95.5000 | 0.304026 | 0.00000000 | 0.49744350 | 0.00000000 | 0.0000000000 | `5459539607/4084101000` = 1.336779 |
| Gambit (Split x3, then Narrow x2) | 252 | `191/200` | 95.5000 | 3.041933 | 0.89476204 | 0.10523796 | 0.02392629 | 0.0000000000 | `24448/675` = 36.219259 |
| Adaptive (Narrow while >=4 alive, Split below, bank at 1 alive) | 196 | `191/200` | 95.5000 | 2.524887 | 0.60896013 | 0.31291487 | 0.00930825 | 0.0000305856 | `24448/25` = 977.920000 |
| Greedy (Split until a runner falls, then Narrow to the end) | 252 | `191/200` | 95.5000 | 6.926628 | 0.95184542 | 0.04777445 | 0.02012730 | 0.0005952294 | `97792/375` = 260.778667 |

Reading it:

* **Volatility bands.** Low: Bolt, Keeper. Medium: Ranger, Forker, Scout.
  High: Gambit, Adaptive. Extreme: Greedy, Knife.
* **A zero-bust policy exists.** "Keeper" shelters `floor(n/2)` runners on
  **every** arena while two or more are alive — not once and then Wide, which is
  a different policy with a different ceiling — so money is banked before any
  wipe can happen: `P(bust) = `<!-- fig:keeperBust -->0.00%<!-- /fig -->`
  exactly, and the player always walks away with something. Its ceiling is
  <!-- fig:keeperMax -->1.34x<!-- /fig -->. The trade is total and legible, and
  the name has to carry the "every arena" or the row is not reproducible from
  this document alone.
* **The lane balance is a real volatility dial.** Forker and Scout differ only in
  the SPLIT balance they choose, run the same contracts on the same arenas, and
  land at standard deviations of <!-- fig:forkerSd -->0.83<!-- /fig --> and
  <!-- fig:scoutSd -->0.87<!-- /fig --> — at identical RTP.
* **The top prize is real but brutal.** Knife reaches
  <!-- fig:routeTicketMax -->977.92x<!-- /fig --> with probability
  <!-- fig:topPrizeOdds -->1 in 1,073,741,824<!-- /fig --> (`(1/64)^5`) and busts
  <!-- fig:knifeBust -->99.54%<!-- /fig --> of the time. Its surviving rounds all
  pay at least 10x, which is why its `P(>=1x)`, `P(>=10x)` and `P(>=100x)`
  coincide.
* **Adaptivity is not an edge.** "Adaptive" and "Greedy" condition on observed
  history. Their RTP is still exactly `191/200`. All they moved was shape.

### 7.1 Portfolios: route ticket plus side bets

A side-bet plan can stake a path-dependent total — a plan that bets every arena
stakes less on a round that ends early — so the only correct definition of return
is `E[credited] / E[staked]`. The enumerator walks every leaf of every
combination and computes both expectations exactly.

**These plans are illustrative, and their stake weights carry a floor.** Side-bet
stakes below are expressed as fractions of the route stake, which is the right
unit for a scale-invariant table but is not automatically a legal ticket: the
`1/10`-weight rows need a route stake of at least 10.00 credits to clear the 1.00
per-ticket minimum, the `1/6`-weight rows need at least 6.00, and the
"maximum legal stake, arena 1 only" rows — half a route stake since §5.5 — need
at least <!-- fig:minRouteStakeForASideBet -->2.00<!-- /fig -->.
The plans were chosen to span the shape of the space — nothing, a small
recurring plan on each of the two extreme events, one maximal single ticket, and
a full three-event arena — not to enumerate a legal-stake product surface. The
invariance result does not depend on legality: §8.2 proves it for arbitrary
non-negative stake vectors.

**And one row is a claim, not an illustration.** No portfolio here that adds side
bets to a route ticket is more volatile than the most volatile route ticket
alone: the highest is
<!-- fig:maxSideBetPortfolioSd -->10.96<!-- /fig --> against
<!-- fig:sdMax -->14.46<!-- /fig -->. That is the responsible-design property the
side-bet ceiling exists for, it was false at the v2 parity limit, and §8.4
asserts it across all <!-- fig:portfolioCount -->45<!-- /fig --> portfolios.

<!-- table:portfolios -->
| Route policy | Side-bet plan | Leaves | E[staked] | E[credited] | RTP = E[cr]/E[st] | RTP % | Std. dev. | Max return |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Ranger (Wide x5) | route ticket only | 252 | `1/1` | `191/200` | `191/200` | 95.5000 | 0.647270 | `74609375/32672808` = 2.283531 |
| Ranger (Wide x5) | + Clean Sweep every arena at 1/10 the route stake | 252 | `398061086597639532239/274877906944000000000` | `76029667540149150657649/54975581388800000000000` | `191/200` | 95.5000 | 0.565711 | `106293983/49009212` = 2.168857 |
| Ranger (Wide x5) | + Last Light every arena at 1/10 the route stake | 252 | `398061086597639532239/274877906944000000000` | `76029667540149150657649/54975581388800000000000` | `191/200` | 95.5000 | 0.511207 | `97792/45089` = 2.168866 |
| Ranger (Wide x5) | + Sole Survivor at the maximum legal stake, arena 1 only | 252 | `3/2` | `573/400` | `191/200` | 95.5000 | 9.929897 | `76149353183/245046060` = 310.755264 |
| Ranger (Wide x5) | + all three side bets on arena 1 at 1/6 the route stake each | 252 | `3/2` | `573/400` | `191/200` | 95.5000 | 3.340277 | `25432857311/245046060` = 103.788069 |
| Forker (Split x5 balanced, Wide when alone) | route ticket only | 252 | `1/1` | `191/200` | `191/200` | 95.5000 | 0.837499 | `24448/6075` = 4.024362 |
| Forker (Split x5 balanced, Wide when alone) | + Clean Sweep every arena at 1/10 the route stake | 252 | `25199022443/18119393280` | `4813013286613/3623878656000` | `191/200` | 95.5000 | 0.720183 | `8339824/2278125` = 3.660828 |
| Forker (Split x5 balanced, Wide when alone) | + Last Light every arena at 1/10 the route stake | 252 | `25199022443/18119393280` | `4813013286613/3623878656000` | `191/200` | 95.5000 | 1.042547 | `9168/1375` = 6.667636 |
| Forker (Split x5 balanced, Wide when alone) | + Sole Survivor at the maximum legal stake, arena 1 only | 252 | `3/2` | `573/400` | `191/200` | 95.5000 | 1.704834 | `5542989799/568856925` = 9.744084 |
| Forker (Split x5 balanced, Wide when alone) | + all three side bets on arena 1 at 1/6 the route stake each | 252 | `3/2` | `573/400` | `191/200` | 95.5000 | 1.119443 | `3056/375` = 8.149333 |
| Knife (Narrow x5) | route ticket only | 252 | `1/1` | `191/200` | `191/200` | 95.5000 | 14.464388 | `24448/25` = 977.920000 |
| Knife (Narrow x5) | + Clean Sweep every arena at 1/10 the route stake | 252 | `48298619/41943040` | `9225036229/8388608000` | `191/200` | 95.5000 | 10.968723 | `16808/25` = 672.320000 |
| Knife (Narrow x5) | + Last Light every arena at 1/10 the route stake | 252 | `48298619/41943040` | `9225036229/8388608000` | `191/200` | 95.5000 | 10.895312 | `48896/75` = 651.946667 |
| Knife (Narrow x5) | + Sole Survivor at the maximum legal stake, arena 1 only | 252 | `3/2` | `573/400` | `191/200` | 95.5000 | 9.700552 | `48896/75` = 651.946667 |
| Knife (Narrow x5) | + all three side bets on arena 1 at 1/6 the route stake each | 252 | `3/2` | `573/400` | `191/200` | 95.5000 | 9.696105 | `148216/225` = 658.737778 |
| Keeper (shelter half every arena, Wide when alone) | route ticket only | 20 | `1/1` | `191/200` | `191/200` | 95.5000 | 0.304026 | `5459539607/4084101000` = 1.336779 |
| Keeper (shelter half every arena, Wide when alone) | + Clean Sweep every arena at 1/10 the route stake | 20 | `18629/16000` | `3558139/3200000` | `191/200` | 95.5000 | 0.313507 | `6596658107/4900921200` = 1.346004 |
| Keeper (shelter half every arena, Wide when alone) | + Last Light every arena at 1/10 the route stake | 20 | `18629/16000` | `3558139/3200000` | `191/200` | 95.5000 | 0.428369 | `89197/36850` = 2.420543 |
| Keeper (shelter half every arena, Wide when alone) | + Sole Survivor at the maximum legal stake, arena 1 only | 20 | `3/2` | `573/400` | `191/200` | 95.5000 | 1.538396 | `52953188957/6126151500` = 8.643794 |
| Keeper (shelter half every arena, Wide when alone) | + all three side bets on arena 1 at 1/6 the route stake each | 20 | `3/2` | `573/400` | `191/200` | 95.5000 | 0.630530 | `19934636957/6126151500` = 3.254023 |

Every row is exactly `191/200`. Side bets move variance and the shape of the
tail; they cannot move the edge, in either direction.

---

## 8. Policy analysis: no policy beats the target RTP

### 8.1 Theorem (route-ticket policy invariance)

*Let a round be played with exact arithmetic, no cap and no rounding, staking the
route ticket only. Let `X_a` be the player's total position entering arena `a`:
micro-credits already banked plus the claim still carried. Then for every legal
action `A` available in every reachable state,*

```
E[X_{a+1} | F_a, A] = X_a
```

*so `(X_a)` is a martingale with respect to the filtration generated by arena
outcomes, under **any** adapted policy — deterministic, history-dependent or
randomised. The horizon is bounded by `K = 5`, so optional stopping gives*

```
E[X_final] = X_1 = stake * r
```

*and therefore route-ticket RTP `= r` for every policy.*

**Proof of the one-step identity.** There are exactly three action shapes.

* `BANK`: `X_{a+1} = X_a` deterministically.
* `ROUTE(C, k)` with `n` runners: the banked component is unchanged; the claim
  maps `V -> V (m/n) mu_C`. Since each of the `n` runners has marginal survival
  `p_C`, linearity of expectation gives `E[m] = n p_C` *regardless of the
  correlation between runners and regardless of how the lanes are balanced*.
  Hence `E[V (m/n) mu_C] = V mu_C p_C = V` because `mu_C = 1/p_C`.
* `SHELTER(j)`: credits `V j/n` immediately and continues with `V (n-j)/n` on the
  WIDE profile with `n-j` runners. By the previous case the continuation has
  expectation `V (n-j)/n`, so the total is `V j/n + V (n-j)/n = V`.

The choice of *which* runners to shelter, and of which lane a runner is assigned
to, is irrelevant to the identity because all runners carry equal shares and have
identical marginal survival. ∎

### 8.2 Theorem (portfolio invariance)

*Extend the state with side-bet tickets. Let a round stake the route ticket
(stake `1`, in units of the route stake) plus any adapted collection of side-bet
tickets, where a ticket placed at arena `a` has stake `w_a >= 0` chosen from the
information available at that arena and is priced `r / P(event | committed
geometry)`. Then*

```
E[total credited] = r * E[total staked]
```

**The premise that does the work.** `Z_a` and `w_a` must be `F_a`-measurable:
whether a ticket is placed, and for how much, must be decided from information
available *before* the arena resolves. This is not a technicality to be waved
through — it is a protocol obligation, and a protocol that leaks the hazard table
to the player violates it. A player who can read the table can place CLEAN SWEEP
exactly when it wins and nothing otherwise, and realised return goes to 249%
(`ENGINE.md` §10.2). The theorem below is true; it is true *of a protocol that
keeps the table sealed*, which is why `ENGINE.md` §5 makes the seal structural
rather than a convention.

**Proof.** Total credit decomposes as route credit plus side credit.
`E[route credit] = r` by §8.1. For a ticket placed at arena `a`, let `Z_a` be the
indicator that it is placed and `w_a` its stake — both `F_a`-measurable, i.e.
fixed before the arena resolves. Its credit is
`Z_a w_a (r / P_a) 1{event}`, and conditioning on `F_a`,

```
E[Z_a w_a (r / P_a) 1{event} | F_a] = Z_a w_a (r / P_a) P_a = r Z_a w_a
```

because `P_a` is by construction the exact probability of the event under the
geometry committed in that same `F_a`. Summing over arenas and taking
expectations, `E[side credit] = r E[side stake]`. Adding the route term,
`E[total credited] = r (1 + E[side stake]) = r E[total staked]`. ∎

The step that does the work is the one the v1 draft could not take: `P_a` must be
the probability under the *committed geometry*, including its lane balance.
A side bet priced off a contract id rather than the geometry would break this
theorem, which is why the enumerator asserts the binding directly (§5.5).

### 8.3 Corollary (optimal play is every play), and exactly what it means

The set of RTP-optimal policies is the set of *all* policies, and the set of
RTP-optimal portfolios is the set of *all* portfolios. There is no sequence of
contract choices, lane balances, shelter splits, bank timings, side-bet events or
side-bet stakes that raises expected return above `191/200`, and — since no cap
can bind (§9) — none that lowers it either, except for floor rounding (§10).

Consequently BRANCHFALL contains **no skill**, and the product is forbidden from
implying otherwise (`DESIGN.md` §10.3).

**And here is the honest boundary of that statement.** "Optimal" above means
optimal for a **risk-neutral objective measured per unit of money staked**:
`E[credited] / E[staked]`. That is the correct definition of RTP, and it is the
one a regulator, an operator and a reasonable player all mean by "return to
player". It is *not* the same as either of these, and both do vary across
portfolios:

* `E[credited / staked]` — the mean of the per-round return multiple. It differs
  from RTP whenever a plan stakes a path-dependent total, because the rounds that
  stake more are not the rounds that pay more. Among the enumerated portfolios it
  ranges from about `0.825` to about `0.975`.
* The **median** return, which ranges from `0` (any all-NARROW line) to above
  `1.03` (bank after one arena with a Last Light attached).

Neither is a way to beat the house: they are different summaries of the same
95.5%, and they move because the *shape* moves — which is exactly what the game
sells and what §7 publishes. But "no policy beats the target RTP" should be read
as the precise claim it is, not as "every way of playing is identical". Every way
of playing has the same edge. They emphatically do not have the same experience.

### 8.4 Exhaustive verification, not just a proof

`tools/enumerate.mjs` verifies the theorems mechanically rather than trusting
them, checking <!-- fig:invariantCount -->1809<!-- /fig --> exact invariants:

1. **Per-action check.** For every state `(a, n)` and every legal action —
   including every lane balance — it computes
   `sum_branches P * (bankFactor + claimFactor)` in exact rationals and asserts it
   equals `1/1`. The enumerator sweeps the 25-state superset of the 21 reachable
   states so that no reachability argument is load-bearing.
2. **Backward induction over the whole policy space.** It computes, for every
   state, the value of the *best* deterministic continuation and of the *worst*:

   ```
   W_max(a, n) = max over actions of  sum_m P(m) [ bank(m) + claim(m) W_max(a+1, m) ]
   W_min(a, n) = min over actions of  sum_m P(m) [ bank(m) + claim(m) W_min(a+1, m) ]
   ```

   with `W(K+1, n) = 1`. Both come out to exactly `1/1` in every state. By the
   principle of optimality this bounds *every* policy — including randomised and
   history-dependent ones, which are convex combinations of deterministic ones —
   from above and below by the same value.
3. **Side-bet binding.** For every state and every legal action, each offered
   side bet's probability is re-derived from that action's own branch table and
   asserted equal, and `P * multiplier` is asserted equal to `r`.
4. **Whole-outcome-space enumeration.** <!-- fig:policyCount -->9<!-- /fig -->
   named policies, including two adaptive ones, are walked to every leaf; and
   every one of them crossed with every one of
   <!-- fig:sideBetPlanCount -->5<!-- /fig --> named side-bet plans —
   <!-- fig:portfolioCount -->45<!-- /fig --> portfolios — has its
   `E[credited] / E[staked]` asserted equal to `191/200`. Every portfolio that
   adds side bets is also asserted **no more volatile than the most volatile
   route ticket**, which is the responsible-design claim `DESIGN.md` §10.2 makes
   and the one the v2 parity limit falsified (§5.5).
5. **The dominance lattice.** Every one of the
   <!-- fig:dominancePairs -->19<!-- /fig --> pairs of geometries a player can be
   offered at a single squad size has its exact second-order relation computed
   from integrated CDFs and asserted against the relation §3.3 publishes, in both
   directions; and the composed statement — balanced fork policy dominates
   lopsided fork policy over a whole run — is asserted on the two policies' full
   return distributions. This is the check that did not exist when §3.2 claimed
   the fork was non-dominated.

Run `npm run enumerate` and read sections 2.1, 5 and 7 of the output.

### 8.5 What a player *can* control

| Lever | Effect on RTP | Effect on the distribution |
| --- | --- | --- |
| Contract choice | none | large — variance, skew, wipe probability. WIDE against SPLIT is the game's one genuinely non-dominated pair; NARROW is a mean-preserving spread of both (§3.3) |
| SPLIT lane balance | none | real, and **nested**: the lopsided fork is a mean-preserving spread of the balanced one, per arena and over a whole run (§3.3). Wipe probability and the middle of the distribution move in opposite directions; P(all clear) and E[survivors] do not move at all |
| Shelter size `j` | none | large — bounds the downside, caps the upside |
| Bank timing | none | large — truncates the tail |
| Side-bet event and stake | none | adds an independently-shaped ticket at the same margin |
| Which runners to shelter, and who goes in which lane | none | none, mathematically. Only *who* comes home (§5.4) |
| Runner names / cosmetics | none | none |

---

## 9. Max-win cap

### 9.1 The basis, stated exactly

**Cap: 1000x, applied per ticket, against that ticket's own stake.**

The route ticket is capped at 1000x the route stake, accumulated across its own
credit events (shelter withdrawals, bank, settlement). Each side-bet ticket is
capped at 1000x that side bet's stake. There is no shared pot, and there is no
per-round cap measured against a single stake.

That basis is the correction the v1 draft needed and §9.5 records why.

<!-- table:invariants -->
| Quantity | Exact value | Decimal |
| --- | --- | --- |
| Target RTP (every ticket, every policy, every portfolio) | `191/200` | 0.955000 |
| Squad size | `5` | 5 |
| Arenas per run | `5` | 5 |
| Route-ticket ceiling (any policy, any path) | `24448/25` | 977.920000 |
| Largest side-bet multiplier | `97792/105` | 931.352381 |
| Per-ticket ceiling (the binding one) | `24448/25` | 977.920000 |
| Max-win cap (per ticket, against that ticket's own stake) | `1000/1` | 1000.000000 |
| Cap headroom | `552/25` | 22.080000 |
| Max round total, per unit of total round stake (bound) | `24448/25` | 977.920000 |
| Max round total, per unit of total round stake (reachable) | `24448/25` | 977.920000 |
| Max round total, per unit of route stake (reachable) | `25212/25` | 1008.480000 |
| Max round total, per unit of route stake (both limits maxed) | `757888/525` | 1443.596190 |
| Side-bet stake limit, per bet | `1/2` | 0.50 x route stake |
| Side-bet stake limit, per round | `1/2` | 0.50 x route stake |
| Minimum route stake | `1000000` uc | 1.00 credits |
| Maximum route stake (declared ceiling) | `1000000000` uc | 1,000.00 credits |
| Liability ceiling, one route ticket at the maximum stake | `1000000000000` uc | 1,000,000.00 credits |
| Minimum game cycle | `5000` ms | 5.0 s per arena |
| Money unit | `1/1000000` credit | 0.000001 |
| Max floor-rounding loss, route ticket | `5/1000000` credit | 0.000005 |
| Max floor-rounding loss, whole round incl. side bets | `20/1000000` credit | 0.000020 |

### 9.2 No ticket can reach the cap

**Route ticket.** The largest claim factor available in any arena is
`mu_NARROW = 4`. Shelter's total factor is a convex combination of `1` and a WIDE
continuation, hence at most `4` times the continuation value. Backward induction
on the best case gives `M(a) = 4^(K+1-a)`, so `M(1) = 4^5 = 1024` and the maximum
credited payout is

```
r * 1024 = (191/200) * 1024 = 24448/25 = 977.92x
```

reached only by NARROW five times with all five runners clearing every arena —
probability `(1/64)^5`, i.e. <!-- fig:topPrizeOdds -->1 in 1,073,741,824<!-- /fig -->.
The enumerator computes this by exhaustive backward induction over every action
in every state rather than trusting the closed form.

**Side bets.** The largest multiplier anywhere in the
<!-- fig:sideBetRows -->42<!-- /fig -->-row side-bet paytable is SOLE SURVIVOR on
a full WIDE squad at `97792/105` =
<!-- fig:soleSurvivorMax -->931.35x<!-- /fig -->.

So the binding per-ticket ceiling is
<!-- fig:maxTicketMultiple -->977.92x<!-- /fig -->, with
<!-- fig:capHeadroom -->22.08x<!-- /fig --> of headroom below the cap.

### 9.3 No round can reach the cap either

The per-ticket bound is not automatically a per-round bound, so the round total
is bounded separately.

A round credits `sum_i M_i * s_i` over its tickets, where `M_i` is that ticket's
realised multiple and `s_i` its stake. Therefore

```
total credited / total staked = sum_i M_i s_i / sum_i s_i
```

is a **weighted mean** of the realised ticket multiples, and is bounded above by
the largest ticket ceiling — <!-- fig:maxTicketMultiple -->977.92x<!-- /fig --> —
whatever the stake allocation. The enumerator evaluates both endpoints of the
published stake interval exactly rather than resting on the argument:

| Allocation | Upper bound on round total, per unit of total round stake |
| --- | --- |
| Route ticket only | <!-- fig:maxRoundRatio -->977.92x<!-- /fig --> |
| Route ticket plus the maximum legal side-bet stake | <!-- fig:ratioMaxSideBets -->962.40x<!-- /fig --> |

and in absolute terms, with both stake limits maxed out, a round's total credit is
bounded by <!-- fig:worstCaseRoundTotal -->1443.60x<!-- /fig --> of the route
stake — against the 1.5 route stakes actually wagered to get there, which is the
<!-- fig:ratioMaxSideBets -->962.40x<!-- /fig --> above. Every one of these
is strictly below 1000x.

Those are bounds, and a bound is what the cap obligation needs. They are also
loose, because the route ceiling needs NARROW five times with all five clearing
while the largest side-bet multiplier needs a WIDE arena with exactly one
survivor, and the two cannot occur in the same round.

So the enumerator does not stop at the bound. It walks
**<!-- fig:capSearchPaths -->256,442<!-- /fig --> terminal paths** — every action
sequence with non-zero probability, every lane balance, every shelter split — and
on each one solves the stake allocation exactly (the objective is linear in the
stakes over a scaled simplex, so the optimum puts the whole side allowance on the
single best-paying winning side bet available on that path; the resulting ratio
is linear-fractional in the allowance and therefore extremal at an endpoint). The
result is the round that actually pays the most:

| | Reachable maximum |
| --- | --- |
| Route ticket | <!-- fig:routeTicketMax -->977.92x<!-- /fig --> of the route stake, via NARROW five times with all five clearing |
| Round total, per unit of route stake | <!-- fig:reachableRoundTotal -->1008.48x<!-- /fig --> — the same line, plus a Clean Sweep at the maximum stake winning on every arena |
| Round total, per unit of **total round stake** | <!-- fig:reachableRoundRatio -->977.92x<!-- /fig --> |

The exhaustive walk reproduces the backward induction's route-ticket ceiling
exactly, which is a genuine cross-check: two different algorithms over the same
state space agreeing on `24448/25`.

And note the middle row. A round *can* credit more than 1000x of the **route**
stake — <!-- fig:reachableRoundTotal -->1008.48x<!-- /fig --> — which is precisely
why the basis has to be stated and stated
correctly. It is not over the cap, because it staked 1.5x the route stake to get
there and no individual ticket came near its own ceiling.

Note where the side-bet stake limits earn their keep: without the "a side bet may
never carry more than half the money of the run it rides on" rule, a large enough SOLE
SURVIVOR stake would make the round total unbounded as a multiple of the *route*
stake, and any per-round claim expressed against the route stake would be
meaningless. The limit is what makes the sentence well defined.

### 9.4 Rationale

A cap that can silently clip an advertised payout is a dark pattern: the player
sees "61.12x" on a ticket and receives less. We refuse that. The cap exists
because operators and RGS risk limits require a hard liability ceiling — but it
is set **above the combinatorial maximum of the paytable on its own basis**, so:

* it never reduces a quoted win;
* it does not distort RTP by even one micro-credit — RTP is exactly `191/200`,
  not "approximately 95.5% after capping";
* it still bounds liability at a known, auditable number, per ticket and per
  round.

`risk.capMustBeUnreachable = true` in the adapter declaration turns this into a
build-time obligation: `tools/enumerate.mjs` asserts the route-ticket ceiling,
every side-bet multiplier, and both endpoints of the round-total interval are
strictly below `maxWinMultiple`, and `tests/` fails CI otherwise. If a future
tuning pass pushes any of them past 1000x, the build breaks and a human must
decide — raise the cap or retune — rather than a player quietly receiving a
haircut.

### 9.5 What changed from the v1 draft, and why

The v1 draft declared the cap as "a chain cap across every credit event in a
round" against a single stake, and then proved only that the route ticket
(977.92x) and each side-bet multiplier (≤ 931.35x) were individually below 1000x.
Those are different statements, and the gap between them was reachable. With one
accumulator against the route stake, take NARROW five times with all five runners
clearing, and stake a CLEAN SWEEP at the route stake on each arena — that side
bet wins on exactly that line, at <!-- fig:cleanSweepMax -->61.12x<!-- /fig -->
per arena:

```
977.92  (route ticket)  +  5 x 61.12  (five winning Clean Sweeps)  =  1283.52x
```

of the route stake, against a 1000x ceiling. The cap would have bound and clipped
an advertised win — the exact thing §9.4 refuses — and it did not need the
extreme line to do it: any deep route line paired with a few winning side bets
walks into the same ceiling.

Worse, with no declared relationship between the side-bet stake and the route
stake, a single SOLE SURVIVOR at a 2x side stake was
<!-- fig:v1BreachSoleSurvivor -->1862.70x<!-- /fig --> of the route stake and over
the cap on its own, with no route line required at all.

Two changes fix it, and both are now enforced by the enumerator rather than
asserted in prose: the cap basis is per ticket (§9.1), and side-bet stakes are
bounded against the route stake (§5.5). The claim in the README is now the claim
the build actually discharges.

### 9.6 What changed from the v2 draft, and why

The v2 draft set both side-bet ratios at `1/1` and declared `maxStake` at `10^15`
micro-credits. Neither figure was wrong for the cap proof; both were wrong for
what they were also sold as.

* **The side-bet ratio at parity made the long shot the game.** §5.5 records the
  arithmetic: the maximum legal configuration was the most volatile product in
  the document, above every route ticket, which contradicts `DESIGN.md` §10.2's
  loss-chasing requirement. The ratio is now `1/2` and the property is asserted
  over every enumerated portfolio.
* **A one-billion-credit ticket ceiling is not a liability ceiling.** §9.4 says
  the cap exists to give a hard liability number; `10^18` micro-credits is not a
  number a risk model recognises, and it appeared in no document. It is now
  <!-- fig:maxStakeCredits -->1,000<!-- /fig -->.00 credits, published in the
  invariants table with the liability figure it implies.

Both are fingerprinted fields, so both changes are a new `adapterVersion`
(`3.0.0`) rather than a silent retune. Every figure in §9.3 moved with them and
was regenerated, not edited.

---

## 10. Rounding, and the only policy-sensitive term in the game

Credits are floored to whole micro-credits (`floor` is the engine's only rounding
mode; it never rounds in the player's favour, and it never rounds against them by
more than one unit).

Each credit event loses at most `1 uc`. Count them per ticket, because that is
how the loss is bounded:

| Ticket | Credit events | Floor loss |
| --- | --- | --- |
| Route ticket | at most `K = 5` — four shelter withdrawals plus the settlement | `< 5 uc` |
| Each side-bet ticket | exactly 1 | `< 1 uc` |
| A whole round, worst case | `5 + 3 x K = 20` | `< `<!-- fig:maxRoundingLossRound -->0.000020<!-- /fig --> credits |

So for the route ticket alone

```
0 <= theoretical - credited < 5 uc = 0.000005 credits
```

which on the minimum stake of 1.000000 credits is a maximum RTP impact of
**0.0005%** — worst-case realised route-ticket RTP
`>= `<!-- fig:roundingRtpFloorPct -->95.4995%<!-- /fig -->.

**A round that also carries side bets loses more in absolute terms, and no more
in relative terms.** Three side bets on each of five arenas add up to fifteen
further credit events, so the round's total floor loss is bounded by
<!-- fig:maxRoundingLossRoundUc -->20<!-- /fig --> uc rather than 5. But each of
those tickets stakes at least 1.000000 credits of its own, so the loss as a
fraction of *total money staked* is still bounded by `1 uc` per credit event per
minimum stake — the same 0.0005% per ticket. The README states both numbers; the
v1 draft published only the route-ticket figure as though it were the round
figure, which was false for any round containing a side bet.

Floor rounding is the **only** respect in which a policy can differ in realised
return: it is always downward, and it is bounded per ticket as above.
The cap cannot contribute, because no ticket and no round can reach it (§9). A
policy that never shelters loses at most `1 uc` on the route ticket.

Denominating in micro-credits rather than cents is a deliberate choice: with
cents, the same five events would cost up to 5 cents, which on a 1.00 credit
stake would be a 5% RTP hole. Precision is a design decision, not an
implementation detail.

---

## 11. Reproducing every number here

```
npm run enumerate            # exact derivation; asserts every invariant
npm run enumerate:markdown   # regenerates the tables in this file
npm run enumerate:figures    # prints every generated figure
npm run docs:sync            # writes tables and figures back into the docs
npm run docs:check           # fails if any document has drifted
npm run montecarlo           # independent forward simulation, sanity only
npm test                     # all of the above, as assertions
```

The Monte Carlo script re-implements the hazard rules from first principles
(draw a collapse, draw a clear per runner) rather than sampling the enumerated
distributions, so agreement is evidence and not a tautology. It cross-checks the
lopsided SPLIT geometries as well as the balanced ones. It is a cross-check on
the *model*, never a source of a published number.

---

## 12. Certification boundary

This repository contains a specification, an exact enumerator, a reference
transcript implementation and tests. It is **not** a fairness certificate, an RNG
certificate, a mathematical certification, regulatory approval, or proof of a
deployed game's RTP. A deployment requires frozen configuration, independently
reviewed seed custody, an operator wallet and integration audit, jurisdictional
analysis, a reserve and risk model, production load evidence, and any required
laboratory process. Changing any constant in §3, §5.5, §6 or §9 invalidates every
figure above until the enumerator is re-run.
