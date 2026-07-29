# BRANCHFALL — exact probability model

**Status:** free-play prototype specification. Engineering standard is real-money grade; regulatory standing is none. See [Certification boundary](#12-certification-boundary).

Everything in this document is produced by `tools/enumerate.mjs` in exact BigInt
rational arithmetic and re-checked on every CI run by `tests/`. No figure here
was estimated, simulated or rounded into existence. Where a decimal appears it
sits beside the exact fraction it was rendered from.

```
npm run enumerate            # the full derivation, as exact fractions
npm run enumerate:markdown   # the tables below
npm test                     # proves this document matches the enumeration
```

---

## 1. Notation and constants

| Symbol | Meaning |
| --- | --- |
| `N = 5` | runners in a fresh squad |
| `K = 5` | arenas in a full run |
| `n` | runners alive and running an arena |
| `m` | runners who clear that arena, `0 <= m <= n` |
| `c` | lane collapse probability (shared, correlated) |
| `q` | per-runner clear probability given the lane holds |
| `p = (1 - c) q` | marginal per-runner survival |
| `mu = 1 / p` | route multiplier |
| `r = 191/200` | theoretical RTP, charged once at entry |
| `V_a` | claim carried into arena `a`, as a multiple of the stake |

Money is denominated in **micro-credits**: `1 credit = 1 000 000 uc`. Credits are
floored to whole micro-credits, so the entire round's rounding loss is bounded by
5 uc — five millionths of one credit. This is the only reason the unit is that
small, and it is why floor rounding is economically invisible here (§10).

---

## 2. State space

A round is a finite Markov decision process. The state is

```
(a, S, V, B)
```

* `a in {1..K+1}` — the arena about to be run (`K+1` is the finish line),
* `S ⊆ {0..N-1}` — the set of runners still in the run,
* `V` — the claim carried by `S`, an exact rational multiple of the stake,
* `B` — micro-credits already credited this round (for the chain cap).

Runners are exchangeable in money terms — each carries exactly `V / |S|` — so for
every probability and payout question the state collapses to `(a, n, V)` with
`n = |S|`. Runner *identity* still matters to the player (§9 of `DESIGN.md`) and
to the transcript, never to the mathematics.

Reachable `(a, n)` pairs: `(1, 5)` and `{2..5} x {1..5}` — 21 states. The
enumerator sweeps the superset `{1..5} x {1..5}` (25 states) so that no
reachability argument is load-bearing in the proof.

The claim is never floored mid-round. Only a credit event — a shelter withdrawal,
a bank, or the final settlement — converts an exact rational into an integer
number of micro-credits.

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
P(j = k) =     (1 - c) C(s,k) q^k (1 - q)^(s-k)     for k >= 1
```

A contract's distribution is the convolution of its lanes' distributions.

Marginal per-runner survival is `p = (1 - c) q` for every runner, in every lane,
under every contract geometry. **The collapse layer moves every moment of the
distribution except the first.** That single fact is the whole design: contract
choice reshapes risk without touching expectation.

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

Total-wipe probability by contract and squad size — the number a player feels:

| Runners | WIDE | SPLIT | NARROW |
| --- | --- | --- | --- |
| 2 | 0.055000 | **0.062500** | 0.625000 |
| 3 | 0.041875 | **0.031250** | 0.562500 |
| 4 | 0.040234 | **0.015625** | 0.531250 |
| 5 | 0.040029 | **0.013021** | 0.515625 |

Splitting a five-runner squad makes a total wipe **3.07x less likely** than
running wide, even though a Split lane is individually more dangerous and Split
kills more runners on average (1.25 vs 0.8 per arena). Splitting a *two*-runner
squad makes a wipe **more** likely, because two solo lanes remove the safety of
numbers. The crossover sits between `n = 2` and `n = 3`.

That reversal is not a tuning accident; it is what modelling correlation
explicitly buys. A model with independent per-runner deaths and no shared
collapse would show Split as uniformly safer and would be lying.

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

Because `E[m] = n p` (linearity of expectation — correlation is irrelevant to the
mean),

```
E[V'] = V * mu * E[m] / n = V * (1/p) * p = V
```

for **every** contract and **every** squad size. Continuation is a fair bet. The
house margin is taken exactly once, when the run is bought: `V_1 = r`.

### 4.1 Shelter

`SHELTER(k)` withdraws `k` of the `n` living runners to the shelter platform.
Their shares — `V k / n` — are credited immediately and permanently. The
remaining `n - k` runners run the arena on the WIDE profile. So

```
E[total] = V k/n  +  V (n-k)/n = V
```

Shelter is exactly a partial bank composed with a Wide run. It is presented as a
fourth contract because that is how it reads to a player, and documented as a
composition because that is what it is.

---

## 5. Bet types

BRANCHFALL has one primary wager and three optional side bets. Every one of them
returns exactly `r = 191/200`.

### 5.1 The Route Ticket (primary wager)

Buying a run debits the stake and opens a claim of `V_1 = r` times the stake. It
resolves through the sequence of arenas the player chooses, ending in a bank, a
finish-line settlement, or a total wipe. Its RTP is `r` under every policy (§8).

### 5.2 Route contracts — the per-arena paytable

Each `(contract, n, m)` triple is a distinct outcome with an exact probability
and an exact claim multiplier `(m/n) * mu`. This is the complete arena paytable.

<!-- table:outcomes -->
| Contract | Runners `n` | Survivors `m` | Exact probability | Probability | Exact claim multiplier | Claim multiplier |
| --- | --- | --- | --- | --- | --- | --- |
| WIDE | 1 | 0 | `4/25` | 0.160000000000 | `0/1` | 0.00000000 |
| WIDE | 1 | 1 | `21/25` | 0.840000000000 | `25/21` | 1.19047619 |
| WIDE | 2 | 0 | `11/200` | 0.055000000000 | `0/1` | 0.00000000 |
| WIDE | 2 | 1 | `21/100` | 0.210000000000 | `25/42` | 0.59523810 |
| WIDE | 2 | 2 | `147/200` | 0.735000000000 | `25/21` | 1.19047619 |
| WIDE | 3 | 0 | `67/1600` | 0.041875000000 | `0/1` | 0.00000000 |
| WIDE | 3 | 1 | `63/1600` | 0.039375000000 | `25/63` | 0.39682540 |
| WIDE | 3 | 2 | `441/1600` | 0.275625000000 | `50/63` | 0.79365079 |
| WIDE | 3 | 3 | `1029/1600` | 0.643125000000 | `25/21` | 1.19047619 |
| WIDE | 4 | 0 | `103/2560` | 0.040234375000 | `0/1` | 0.00000000 |
| WIDE | 4 | 1 | `21/3200` | 0.006562500000 | `25/84` | 0.29761905 |
| WIDE | 4 | 2 | `441/6400` | 0.068906250000 | `25/42` | 0.59523810 |
| WIDE | 4 | 3 | `1029/3200` | 0.321562500000 | `25/28` | 0.89285714 |
| WIDE | 4 | 4 | `7203/12800` | 0.562734375000 | `25/21` | 1.19047619 |
| WIDE | 5 | 0 | `4099/102400` | 0.040029296875 | `0/1` | 0.00000000 |
| WIDE | 5 | 1 | `21/20480` | 0.001025390625 | `5/21` | 0.23809524 |
| WIDE | 5 | 2 | `147/10240` | 0.014355468750 | `10/21` | 0.47619048 |
| WIDE | 5 | 3 | `1029/10240` | 0.100488281250 | `5/7` | 0.71428571 |
| WIDE | 5 | 4 | `7203/20480` | 0.351708984375 | `20/21` | 0.95238095 |
| WIDE | 5 | 5 | `50421/102400` | 0.492392578125 | `25/21` | 1.19047619 |
| SPLIT | 2 | 0 | `1/16` | 0.062500000000 | `0/1` | 0.00000000 |
| SPLIT | 2 | 1 | `3/8` | 0.375000000000 | `2/3` | 0.66666667 |
| SPLIT | 2 | 2 | `9/16` | 0.562500000000 | `4/3` | 1.33333333 |
| SPLIT | 3 | 0 | `1/32` | 0.031250000000 | `0/1` | 0.00000000 |
| SPLIT | 3 | 1 | `5/32` | 0.156250000000 | `4/9` | 0.44444444 |
| SPLIT | 3 | 2 | `11/32` | 0.343750000000 | `8/9` | 0.88888889 |
| SPLIT | 3 | 3 | `15/32` | 0.468750000000 | `4/3` | 1.33333333 |
| SPLIT | 4 | 0 | `1/64` | 0.015625000000 | `0/1` | 0.00000000 |
| SPLIT | 4 | 1 | `1/16` | 0.062500000000 | `1/3` | 0.33333333 |
| SPLIT | 4 | 2 | `7/32` | 0.218750000000 | `2/3` | 0.66666667 |
| SPLIT | 4 | 3 | `5/16` | 0.312500000000 | `1/1` | 1.00000000 |
| SPLIT | 4 | 4 | `25/64` | 0.390625000000 | `4/3` | 1.33333333 |
| SPLIT | 5 | 0 | `5/384` | 0.013020833333 | `0/1` | 0.00000000 |
| SPLIT | 5 | 1 | `13/384` | 0.033854166667 | `4/15` | 0.26666667 |
| SPLIT | 5 | 2 | `23/192` | 0.119791666667 | `8/15` | 0.53333333 |
| SPLIT | 5 | 3 | `35/192` | 0.182291666667 | `4/5` | 0.80000000 |
| SPLIT | 5 | 4 | `125/384` | 0.325520833333 | `16/15` | 1.06666667 |
| SPLIT | 5 | 5 | `125/384` | 0.325520833333 | `4/3` | 1.33333333 |
| NARROW | 1 | 0 | `3/4` | 0.750000000000 | `0/1` | 0.00000000 |
| NARROW | 1 | 1 | `1/4` | 0.250000000000 | `4/1` | 4.00000000 |
| NARROW | 2 | 0 | `5/8` | 0.625000000000 | `0/1` | 0.00000000 |
| NARROW | 2 | 1 | `1/4` | 0.250000000000 | `2/1` | 2.00000000 |
| NARROW | 2 | 2 | `1/8` | 0.125000000000 | `4/1` | 4.00000000 |
| NARROW | 3 | 0 | `9/16` | 0.562500000000 | `0/1` | 0.00000000 |
| NARROW | 3 | 1 | `3/16` | 0.187500000000 | `4/3` | 1.33333333 |
| NARROW | 3 | 2 | `3/16` | 0.187500000000 | `8/3` | 2.66666667 |
| NARROW | 3 | 3 | `1/16` | 0.062500000000 | `4/1` | 4.00000000 |
| NARROW | 4 | 0 | `17/32` | 0.531250000000 | `0/1` | 0.00000000 |
| NARROW | 4 | 1 | `1/8` | 0.125000000000 | `1/1` | 1.00000000 |
| NARROW | 4 | 2 | `3/16` | 0.187500000000 | `2/1` | 2.00000000 |
| NARROW | 4 | 3 | `1/8` | 0.125000000000 | `3/1` | 3.00000000 |
| NARROW | 4 | 4 | `1/32` | 0.031250000000 | `4/1` | 4.00000000 |
| NARROW | 5 | 0 | `33/64` | 0.515625000000 | `0/1` | 0.00000000 |
| NARROW | 5 | 1 | `5/64` | 0.078125000000 | `4/5` | 0.80000000 |
| NARROW | 5 | 2 | `5/32` | 0.156250000000 | `8/5` | 1.60000000 |
| NARROW | 5 | 3 | `5/32` | 0.156250000000 | `12/5` | 2.40000000 |
| NARROW | 5 | 4 | `5/64` | 0.078125000000 | `16/5` | 3.20000000 |
| NARROW | 5 | 5 | `1/64` | 0.015625000000 | `4/1` | 4.00000000 |

Shape summary. "Stage RTP" is `sum_m P(m) * (m/n) * mu`, which must be exactly
`1/1` for every row — that is the fair-continuation property, checked per row.

<!-- table:shape -->
| Contract | Runners `n` | Lane sizes | P(total wipe) | P(all clear) | E[survivors] | Stage RTP |
| --- | --- | --- | --- | --- | --- | --- |
| WIDE | 1 | 1 | `4/25` = 0.160000000000 | `21/25` = 0.840000000000 | `21/25` = 0.840000 | `1/1` |
| WIDE | 2 | 2 | `11/200` = 0.055000000000 | `147/200` = 0.735000000000 | `42/25` = 1.680000 | `1/1` |
| WIDE | 3 | 3 | `67/1600` = 0.041875000000 | `1029/1600` = 0.643125000000 | `63/25` = 2.520000 | `1/1` |
| WIDE | 4 | 4 | `103/2560` = 0.040234375000 | `7203/12800` = 0.562734375000 | `84/25` = 3.360000 | `1/1` |
| WIDE | 5 | 5 | `4099/102400` = 0.040029296875 | `50421/102400` = 0.492392578125 | `21/5` = 4.200000 | `1/1` |
| SPLIT | 2 | 1+1 | `1/16` = 0.062500000000 | `9/16` = 0.562500000000 | `3/2` = 1.500000 | `1/1` |
| SPLIT | 3 | 2+1 | `1/32` = 0.031250000000 | `15/32` = 0.468750000000 | `9/4` = 2.250000 | `1/1` |
| SPLIT | 4 | 2+2 | `1/64` = 0.015625000000 | `25/64` = 0.390625000000 | `3/1` = 3.000000 | `1/1` |
| SPLIT | 5 | 3+2 | `5/384` = 0.013020833333 | `125/384` = 0.325520833333 | `15/4` = 3.750000 | `1/1` |
| NARROW | 1 | 1 | `3/4` = 0.750000000000 | `1/4` = 0.250000000000 | `1/4` = 0.250000 | `1/1` |
| NARROW | 2 | 2 | `5/8` = 0.625000000000 | `1/8` = 0.125000000000 | `1/2` = 0.500000 | `1/1` |
| NARROW | 3 | 3 | `9/16` = 0.562500000000 | `1/16` = 0.062500000000 | `3/4` = 0.750000 | `1/1` |
| NARROW | 4 | 4 | `17/32` = 0.531250000000 | `1/32` = 0.031250000000 | `1/1` = 1.000000 | `1/1` |
| NARROW | 5 | 5 | `33/64` = 0.515625000000 | `1/64` = 0.015625000000 | `5/4` = 1.250000 | `1/1` |

### 5.3 Shelter

`SHELTER(k)` for `1 <= k <= n-1`, available whenever `n >= 2`. Banks `k/n` of the
claim, runs the remainder on the WIDE profile. Its arena distribution is the
WIDE row for `n - k` runners. Which specific runners are withdrawn is a free
player choice with zero effect on any probability (runners are exchangeable), and
a real effect on who survives the round.

### 5.4 Side bets

Optional, per-arena, staked with fresh money, resolved by the same arena outcome
as the main game. Pricing rule, without exception:

```
multiplier = r / P(event)
```

so each side bet returns exactly `r` regardless of which contract it rides on.
Offered only when at least two runners are running, so that the three events stay
distinct.

* **CLEAN SWEEP** — every running runner clears this arena (`m = n`).
* **SOLE SURVIVOR** — exactly one runner clears (`m = 1`).
* **LAST LIGHT** — nobody clears (`m = 0`).

<!-- table:sidebets -->
| Side bet | Contract | Runners | Exact probability | Probability | Exact multiplier | Multiplier | Exact RTP |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CLEAN SWEEP | WIDE | 2 | `147/200` | 0.735000000000 | `191/147` | 1.29931973 | `191/200` |
| CLEAN SWEEP | WIDE | 3 | `1029/1600` | 0.643125000000 | `1528/1029` | 1.48493683 | `191/200` |
| CLEAN SWEEP | WIDE | 4 | `7203/12800` | 0.562734375000 | `12224/7203` | 1.69707067 | `191/200` |
| CLEAN SWEEP | WIDE | 5 | `50421/102400` | 0.492392578125 | `97792/50421` | 1.93950933 | `191/200` |
| CLEAN SWEEP | SPLIT | 2 | `9/16` | 0.562500000000 | `382/225` | 1.69777778 | `191/200` |
| CLEAN SWEEP | SPLIT | 3 | `15/32` | 0.468750000000 | `764/375` | 2.03733333 | `191/200` |
| CLEAN SWEEP | SPLIT | 4 | `25/64` | 0.390625000000 | `1528/625` | 2.44480000 | `191/200` |
| CLEAN SWEEP | SPLIT | 5 | `125/384` | 0.325520833333 | `9168/3125` | 2.93376000 | `191/200` |
| CLEAN SWEEP | NARROW | 2 | `1/8` | 0.125000000000 | `191/25` | 7.64000000 | `191/200` |
| CLEAN SWEEP | NARROW | 3 | `1/16` | 0.062500000000 | `382/25` | 15.28000000 | `191/200` |
| CLEAN SWEEP | NARROW | 4 | `1/32` | 0.031250000000 | `764/25` | 30.56000000 | `191/200` |
| CLEAN SWEEP | NARROW | 5 | `1/64` | 0.015625000000 | `1528/25` | 61.12000000 | `191/200` |
| SOLE SURVIVOR | WIDE | 2 | `21/100` | 0.210000000000 | `191/42` | 4.54761905 | `191/200` |
| SOLE SURVIVOR | WIDE | 3 | `63/1600` | 0.039375000000 | `1528/63` | 24.25396825 | `191/200` |
| SOLE SURVIVOR | WIDE | 4 | `21/3200` | 0.006562500000 | `3056/21` | 145.52380952 | `191/200` |
| SOLE SURVIVOR | WIDE | 5 | `21/20480` | 0.001025390625 | `97792/105` | 931.35238095 | `191/200` |
| SOLE SURVIVOR | SPLIT | 2 | `3/8` | 0.375000000000 | `191/75` | 2.54666667 | `191/200` |
| SOLE SURVIVOR | SPLIT | 3 | `5/32` | 0.156250000000 | `764/125` | 6.11200000 | `191/200` |
| SOLE SURVIVOR | SPLIT | 4 | `1/16` | 0.062500000000 | `382/25` | 15.28000000 | `191/200` |
| SOLE SURVIVOR | SPLIT | 5 | `13/384` | 0.033854166667 | `9168/325` | 28.20923077 | `191/200` |
| SOLE SURVIVOR | NARROW | 2 | `1/4` | 0.250000000000 | `191/50` | 3.82000000 | `191/200` |
| SOLE SURVIVOR | NARROW | 3 | `3/16` | 0.187500000000 | `382/75` | 5.09333333 | `191/200` |
| SOLE SURVIVOR | NARROW | 4 | `1/8` | 0.125000000000 | `191/25` | 7.64000000 | `191/200` |
| SOLE SURVIVOR | NARROW | 5 | `5/64` | 0.078125000000 | `1528/125` | 12.22400000 | `191/200` |
| LAST LIGHT | WIDE | 2 | `11/200` | 0.055000000000 | `191/11` | 17.36363636 | `191/200` |
| LAST LIGHT | WIDE | 3 | `67/1600` | 0.041875000000 | `1528/67` | 22.80597015 | `191/200` |
| LAST LIGHT | WIDE | 4 | `103/2560` | 0.040234375000 | `12224/515` | 23.73592233 | `191/200` |
| LAST LIGHT | WIDE | 5 | `4099/102400` | 0.040029296875 | `97792/4099` | 23.85752623 | `191/200` |
| LAST LIGHT | SPLIT | 2 | `1/16` | 0.062500000000 | `382/25` | 15.28000000 | `191/200` |
| LAST LIGHT | SPLIT | 3 | `1/32` | 0.031250000000 | `764/25` | 30.56000000 | `191/200` |
| LAST LIGHT | SPLIT | 4 | `1/64` | 0.015625000000 | `1528/25` | 61.12000000 | `191/200` |
| LAST LIGHT | SPLIT | 5 | `5/384` | 0.013020833333 | `9168/125` | 73.34400000 | `191/200` |
| LAST LIGHT | NARROW | 2 | `5/8` | 0.625000000000 | `191/125` | 1.52800000 | `191/200` |
| LAST LIGHT | NARROW | 3 | `9/16` | 0.562500000000 | `382/225` | 1.69777778 | `191/200` |
| LAST LIGHT | NARROW | 4 | `17/32` | 0.531250000000 | `764/425` | 1.79764706 | `191/200` |
| LAST LIGHT | NARROW | 5 | `33/64` | 0.515625000000 | `1528/825` | 1.85212121 | `191/200` |

Side bets are strongly correlated with the main game — LAST LIGHT pays exactly
when the Route Ticket dies — but expectation is linear, so any combination of
Route Ticket and side bets returns `r` times total money staked. There is no
hedge, no arbitrage, and no combination with a different edge. **LAST LIGHT is
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
spread is enormous: standard deviation of return ranges from 0.26 to 14.46 across
policies — a 57x range at constant expectation.

Every row below is the **complete** outcome space of that policy, enumerated
exactly. "Leaves" is the number of terminal paths walked.

<!-- table:policies -->
| Policy | Leaves | Exact RTP | RTP % | Std. dev. | P(bust) | P(>= 1x) | P(>= 10x) | P(>= 100x) | Max return |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Bolt (Wide, bank after arena 1) | 6 | `191/200` | 95.5000 | 0.255234 | 0.04002930 | 0.49239258 | 0.00000000 | 0.0000000000 | `191/168` = 1.136905 |
| Ranger (Wide x5) | 252 | `191/200` | 95.5000 | 0.647270 | 0.20698397 | 0.42741307 | 0.00000000 | 0.0000000000 | `74609375/32672808` = 2.283531 |
| Forker (Split x5, Wide when alone) | 252 | `191/200` | 95.5000 | 0.837499 | 0.23838546 | 0.33002791 | 0.00000000 | 0.0000000000 | `24448/6075` = 4.024362 |
| Knife (Narrow x5) | 252 | `191/200` | 95.5000 | 14.464388 | 0.99541297 | 0.00458703 | 0.00458703 | 0.0045870254 | `24448/25` = 977.920000 |
| Keeper (Shelter half, then Wide) | 20 | `191/200` | 95.5000 | 0.304026 | 0.00000000 | 0.49744350 | 0.00000000 | 0.0000000000 | `5459539607/4084101000` = 1.336779 |
| Gambit (Split x3, then Narrow x2) | 252 | `191/200` | 95.5000 | 3.041933 | 0.89476204 | 0.10523796 | 0.02392629 | 0.0000000000 | `24448/675` = 36.219259 |
| Adaptive (Narrow while >=4 alive, Split below, bank at 1 alive) | 196 | `191/200` | 95.5000 | 2.524887 | 0.60896013 | 0.31291487 | 0.00930825 | 0.0000305856 | `24448/25` = 977.920000 |
| Greedy (Split until a runner falls, then Narrow to the end) | 252 | `191/200` | 95.5000 | 6.926628 | 0.95184542 | 0.04777445 | 0.02012730 | 0.0005952294 | `97792/375` = 260.778667 |

Reading it:

* **Volatility bands.** Low: Bolt, Keeper (sigma < 0.31). Medium: Ranger, Forker
  (sigma < 0.85). High: Gambit, Adaptive (sigma ~ 2.5–3.0). Extreme: Greedy,
  Knife (sigma > 6.9).
* **A zero-bust policy exists.** "Keeper" shelters on the very first arena, so
  money is banked before any wipe can happen: `P(bust) = 0` exactly, and the
  player always walks away with something. Its ceiling is 1.34x. The trade is
  total and legible.
* **The top prize is real but brutal.** Knife reaches 977.92x with probability
  `1/1073741824` (`(1/64)^5`), and busts 99.54% of the time. Its 0.46% of
  surviving rounds all pay at least 10x, which is why its `P(>=1x)`,
  `P(>=10x)` and `P(>=100x)` coincide.
* **Adaptivity is not an edge.** "Adaptive" and "Greedy" condition on observed
  history. Their RTP is still exactly `191/200`. All they moved was shape.

---

## 8. Strategy analysis: no policy beats the target RTP

### 8.1 Theorem (policy invariance)

*Let a round be played with exact arithmetic, no cap and no rounding. Let `X_a`
be the player's total position entering arena `a`: micro-credits already banked
plus the claim still carried. Then for every legal action `A` available in every
reachable state,*

```
E[X_{a+1} | F_a, A] = X_a
```

*so `(X_a)` is a martingale with respect to the filtration generated by arena
outcomes, under **any** adapted policy — deterministic, history-dependent or
randomised. The horizon is bounded by `K = 5`, so optional stopping gives*

```
E[X_final] = X_1 = stake * r
```

*and therefore RTP `= r` for every policy.*

**Proof of the one-step identity.** There are exactly three action shapes.

* `BANK`: `X_{a+1} = X_a` deterministically.
* `ROUTE(C)` with `n` runners: the banked component is unchanged; the claim maps
  `V -> V (m/n) mu_C`. Since each of the `n` runners has marginal survival
  `p_C`, linearity of expectation gives `E[m] = n p_C` *regardless of the
  correlation between runners*. Hence
  `E[V (m/n) mu_C] = V mu_C p_C = V` because `mu_C = 1/p_C`.
* `SHELTER(k)`: credits `V k/n` immediately and continues with `V (n-k)/n` on the
  WIDE profile with `n-k` runners. By the previous case the continuation has
  expectation `V (n-k)/n`, so the total is `V k/n + V (n-k)/n = V`.

The choice of *which* runners to shelter is irrelevant to the identity because
all runners carry equal shares and have identical marginal survival. ∎

### 8.2 Corollary (optimal play is every play)

The set of RTP-optimal policies is the set of *all* policies. There is no
sequence of contract choices, shelter splits, bank timings or side bets that
raises expected return above `191/200`, and none that lowers it either (before
rounding — §10). Consequently BRANCHFALL contains **no skill**, and the product
is forbidden from implying otherwise (`DESIGN.md` §10).

### 8.3 Exhaustive verification, not just a proof

`tools/enumerate.mjs` verifies the theorem mechanically rather than trusting it:

1. **Per-action check.** For every state `(a, n)` and every legal action it
   computes `sum_branches P * (bankFactor + claimFactor)` in exact rationals and
   asserts it equals `1/1`. There are 21 reachable states carrying 123
   state-action pairs; the enumerator sweeps the 25-state superset (140 pairs)
   so that no reachability argument is load-bearing.
2. **Backward induction over the whole policy space.** It computes, for every
   state, the value of the *best* deterministic continuation and of the *worst*:

   ```
   W_max(a, n) = max over actions of  sum_m P(m) [ bank(m) + claim(m) W_max(a+1, m) ]
   W_min(a, n) = min over actions of  sum_m P(m) [ bank(m) + claim(m) W_min(a+1, m) ]
   ```

   with `W(K+1, n) = 1`. Both come out to exactly `1/1` in every state. By the
   principle of optimality this bounds *every* policy — including randomised and
   history-dependent ones, which are convex combinations of deterministic ones —
   from above and below by the same value. Enumerating all `~10^15` deterministic
   policies individually is unnecessary and infeasible; the DP is the complete
   argument.
3. **Whole-outcome-space enumeration.** Eight named policies, including two
   adaptive ones, are walked to every leaf (up to 252 terminal paths each) and
   their exact mean asserted equal to `191/200`.

Run `npm run enumerate` and read section 4 of the output: it prints the value of
every action in every state. They are all `1/1`.

### 8.4 What a player *can* control

| Lever | Effect on RTP | Effect on the distribution |
| --- | --- | --- |
| Contract choice | none | large — variance, skew, wipe probability |
| Shelter size `k` | none | large — bounds the downside, caps the upside |
| Which runners to shelter | none | changes lane sizes next arena, hence shape |
| Bank timing | none | large — truncates the tail |
| Side bets | none | adds an independent-margin bet with its own shape |
| Runner names / cosmetics | none | none |

---

## 9. Max-win cap

**Cap: 1000x the stake, applied as a chain cap across every credit event in a
round (mirroring the engine's `payableWithinCap`).**

<!-- table:invariants -->
| Quantity | Exact value | Decimal |
| --- | --- | --- |
| Target RTP (all bets, all policies) | `191/200` | 0.955000 |
| Squad size | `5` | 5 |
| Arenas per run | `5` | 5 |
| Max reachable payout (any policy) | `24448/25` | 977.920000 |
| Max-win cap | `1000/1` | 1000.000000 |
| Cap headroom | `552/25` | 22.080000 |
| Largest side-bet multiplier | `97792/105` | 931.352381 |
| Money unit | `1/1000000` credit | 0.000001 |
| Max floor-rounding loss per round | `5/1000000` credit | 0.000005 |

### 9.1 The cap is proven unreachable

The largest claim factor available in any arena is `mu_NARROW = 4`. Shelter's
total factor is a convex combination of `1` and a WIDE continuation, hence at most
`4` times the continuation value. Backward induction on the best case gives
`M(a) = 4^(K+1-a)`, so `M(1) = 4^5 = 1024` and the maximum credited payout is

```
r * 1024 = (191/200) * 1024 = 24448/25 = 977.92x
```

reached only by NARROW five times with all five runners clearing every arena —
probability `(1/64)^5 = 1/1073741824`. The largest side-bet multiplier is
SOLE SURVIVOR on WIDE with 5 runners at `97792/105 = 931.35x`. Both are strictly
below 1000x, with 22.08x of headroom.

### 9.2 Rationale

A cap that can silently clip an advertised payout is a dark pattern: the player
sees "61.12x" on a ticket and receives less. We refuse that. The cap exists
because operators and RGS risk limits require a hard per-round liability
ceiling — but it is set **above the combinatorial maximum of the paytable**, so:

* it never reduces a quoted win;
* it does not distort RTP by even one micro-credit — RTP is exactly `191/200`,
  not "approximately 95.5% after capping";
* it still bounds liability at a known, auditable number.

`risk.capMustBeUnreachable = true` in the adapter declaration turns this into a
build-time obligation: `tools/enumerate.mjs` asserts
`max reachable payout < maxWinMultiple` and `every side-bet multiplier <= maxWinMultiple`,
and `tests/` fails CI otherwise. If a future tuning pass pushes a multiplier past
1000x, the build breaks and a human must decide — raise the cap or retune —
rather than a player quietly receiving a haircut.

---

## 10. Rounding, and the only policy-sensitive term in the game

Credits are floored to whole micro-credits (`floor` is the engine's only rounding
mode; it never rounds in the player's favour, and it never rounds against them by
more than one unit).

Each credit event loses at most `1 uc`. A round has at most `K = 5` credit events
(four shelter withdrawals plus the settlement). So

```
0 <= theoretical - credited < 5 uc = 0.000005 credits
```

On the minimum stake of 1.000000 credits that is a maximum RTP impact of
**0.0005%** — i.e. worst-case realised RTP `>= 95.4995%`. This is the *only*
respect in which a policy can differ in return, it is always downward, and it is
bounded by five millionths. A policy that never shelters loses at most `1 uc`.

Denominating in micro-credits rather than cents is a deliberate choice: with
cents, the same five events would cost up to 5 cents, which on a 1.00 credit
stake would be a 5% RTP hole. Precision is a design decision, not an
implementation detail.

---

## 11. Reproducing every number here

```
npm run enumerate            # exact derivation; asserts 488 invariants
npm run enumerate:markdown   # regenerates the tables in this file
npm run docs:sync            # writes them back into docs/MATH.md
npm run docs:check           # fails if this document has drifted
npm run montecarlo           # independent forward simulation, sanity only
npm test                     # all of the above, as assertions
```

The Monte Carlo script re-implements the hazard rules from first principles
(draw a collapse, draw a clear per runner) rather than sampling the enumerated
distributions, so agreement is evidence and not a tautology. At 200 000 rounds of
the Ranger policy it reproduces 95.5% to within one standard error. It is a
cross-check on the *model*, never a source of a published number.

---

## 12. Certification boundary

This repository contains a specification, an exact enumerator, a reference
transcript implementation and tests. It is **not** a fairness certificate, an RNG
certificate, a mathematical certification, regulatory approval, or proof of a
deployed game's RTP. A deployment requires frozen configuration, independently
reviewed seed custody, an operator wallet and integration audit, jurisdictional
analysis, a reserve and risk model, production load evidence, and any required
laboratory process. Changing any constant in §3, §6 or §9 invalidates every
figure above until the enumerator is re-run.
