# BRANCHFALL — product design specification

**Status:** free-play prototype. No real money. Engineering and design standard is real-money grade.

> Five small figures with lanterns for hearts cross five collapsing branches above
> a fog you cannot see the bottom of. You choose the route. They do the running.
> Every route pays back the same <!-- fig:rtpPct -->95.5%<!-- /fig --> — what you
> are actually choosing is the shape of the risk, and which of your runners you
> are willing to gamble.

Every number in this document that the *model* computes is a generated slot,
re-checked on every CI run: `npm run docs:check` fails if a sentence here claims
a probability, a multiplier or a limit the model does not produce. Numbers that
are design decisions rather than derivations — budgets, sizes, durations — are
written plainly and are not slots. §11 says which is which and why.

---

## 1. Premise and theme

**The Understory.** A dead world-tree, petrified into pale stone, still standing
in a sea of grey fog. Nobody knows what is under the fog and nobody who has gone
down has come back to say. Light is the only currency: the tree is dark, and the
only warm things in the world are the lanterns.

**The Kindlings.** Your squad. Five hand-made figures of woven reed, linen and
leather, each with a blown-glass lantern set into the chest where a heart would
be. They are not cute. They are earnest, slightly battered, and clearly made by
hand — someone put them together and is now sending them across a stone branch in
the dark.

**The run.** Climb the tree. Five branches — **Lowbranch, The Grain, Windrow, The
Char, Crown** (§6.7 gives each one a full brief). At the top is the Crown Lamp.
Along the way there are Lamp Houses: brass shelters where a Kindling's light can
be banked and kept.

**Originality guard.** No game-show framing, no elimination-show host, no
inflatable obstacles, no bean-shaped avatars, no primary-colour party palette, no
crowd of hundreds of identical player characters, no "jelly" physics. If a design
decision could be described as "like that battle-royale party game", it is
rejected. Our register is closer to a lantern procession in fog than to a
television obstacle course. Everything in this document — silhouette language,
palette, materials, motion, sound — is chosen partly to make that distance
obvious at a glance.

---

## 2. The loop, step by step

```
BUY  ->  [ ROUTE -> RUN -> RESOLVE -> BANK? ] x up to 5  ->  SETTLE  ->  VERIFY
```

1. **Open the squad.** Five named Kindlings. The player may rename and re-dress
   them. Cosmetics change nothing but the player's attachment.
2. **Set stake and buy the run.** The stake is debited. The round's claim opens at
   `stake x `<!-- fig:rtpPct -->95.5%<!-- /fig -->. This is the only moment the
   house margin is charged on the route ticket.
   The round's **pre-commitment hash** is published *now*, before any choice — and
   before the client seed exists (§8.1).
3. **Arena brief.** The player sees the branch ahead and four route cards, each
   showing its exact numbers for the current squad size. **No timer.**
4. **Commit the route.** On a Split with four or five runners, set the fork
   balance. Optionally attach side bets. Optionally choose which Kindlings to
   shelter.
5. **The run.** A 9–14 second deterministic replay of the committed transcript.
   Client physics is presentation; the transcript already decided who falls.
6. **Resolve.** Survivors are counted. The claim is multiplied by
   `(survivors / runners) x route multiplier`. If nobody clears, the round ends.
7. **Bank or continue.** Available after every resolved arena. **No timer** — but
   the next money control does not unlock for
   <!-- fig:minCycleSeconds -->5.0<!-- /fig --> seconds (§5.1).
8. **Settle.** Banking, or finishing arena 5, credits the claim. A wipe credits
   nothing beyond anything already sheltered and any side bet that won.
9. **Verify.** The server seed is revealed. The player can re-derive the whole
   round, including the routes they did not take.

A full five-arena run is 90–120 seconds. A cautious two-arena run is ~35 seconds.

**Buying a run commits you to arena 1.** BANK exists from arena 2 onward, and a
Shelter can withdraw at most `n-1` of `n` runners, so once the stake is debited
at least one fifth of the claim crosses the first branch — every route on the
first screen carries risk and none of them is an exit. There is no *action* in
the first decision that returns the stake untouched. We say this plainly here,
in S1's buy copy, and in the shelter picker (S2), because a spec that mentions it
only in the mathematics produces a picker that lets a player select all five and
then rejects the commit.

The one thing that returns an untouched stake is not an action and is not
reachable by playing: an unplayed round that the operator cancels at expiry
(§2.1). It is stated on the same screen rather than left as a discrepancy
between the buy copy and the terms.

### 2.1 Round persistence, and how an abandoned round ends

There is no countdown on any money decision, anywhere, ever. A round is server-
side state; closing the app mid-round is safe and resuming restores the exact
frame. Network latency, frame rate and input timing cannot change a payout,
because the outcome was fixed before the player chose.

A round still has to end. An operator cannot hold a stake against an unresolved
round indefinitely, so a round abandoned past the operator's expiry window
(default 24 h) is closed by the server. **The rule that governs how is that
expiry may never invent an action the model does not have** (`MATH.md` §5.3,
`tools/lib/model.mjs:actionsFor`):

| Where the round was abandoned | How it closes | What that is |
| --- | --- | --- |
| At any decision point from arena 2 on — a branch has already resolved | **auto-BANK**, exactly the BANK the player could have taken | a settlement. The claim is credited, the round is played, it counts |
| At the arena-1 decision point — nothing has resolved | **VOID**: the wager is cancelled and the stake refunded in full | not a settlement. Nothing is credited, and the round did not happen |

Never a forced run, in either row.

**Why the second row cannot be an auto-BANK.** BANK does not exist in state
`(1, n)`. The action set there is `{ROUTE(...), SHELTER(1..n-1)}` and every
element of it runs at least one runner (`MATH.md` §5.3). An expiry rule that
banked a round before arena 1 resolved would be crediting an action the game does
not have, would make S1's copy false, and would create a deterministic
<!-- fig:rtpPct -->95.5%<!-- /fig --> zero-variance line that appears nowhere in
the volatility profile in `MATH.md` §7 — which is exactly the fixed-cost
conversion route a bonus-abuse model looks for. The v2 draft of this document
granted precisely that, eight lines after asserting the opposite. It is the kind
of contradiction that survives review because the two sentences are never read
together, so the table above exists to make them one statement.

**A cancelled wager is a wager that did not happen.** Build requirements, each
with an acceptance check:

- a VOID credits nothing, returns the route stake exactly, and produces a
  reversal record rather than a settlement receipt;
- it contributes **no turnover**, no bonus or wagering-requirement progress, and
  no RTP figure. A round that pays back 1.00x by not being played is not a
  95.5% round and must never be counted as one;
- no side-bet stake is ever stranded by it: side bets are fields of a route
  action (`ENGINE.md` §3), so at a decision point there is no unresolved
  side-bet money to return;
- the void rate is published, per `ENGINE.md` §10.1 — an operator that cancels
  rounds it dislikes is the selective-non-reveal threat, and the countable void
  rate is the control;
- deliberate repeated abandonment is a fraud-monitoring matter for the operator,
  not a game rule. This document does not add a penalty for it, because a penalty
  on a player who closed an app is worse than the behaviour it prices.

---

## 3. Player decisions — and exactly what each one changes

Every control below is listed with what it actually moves. Rows 1–6 move the
distribution in ways the player can see and the route card states. Rows 7 and 8
move nothing distributional at all, and are listed here **because they are the
ones that look like agency and are not** — a spec that quietly omits them is how
a shelter picker ends up implying that picking a particular Kindling changes the
odds. It does not. It cannot.

The RTP column is proved exactly in `MATH.md` §8 and asserted in CI.

| # | Decision | When | What it actually changes | Effect on RTP |
| --- | --- | --- | --- | --- |
| 1 | **Stake** | Before buy | Scales everything linearly | none |
| 2 | **Route contract** (Wide / Split / Narrow / Shelter) | Before each arena, no timer | The entire survivor distribution: wipe probability, expected survivors, multiplier, skew | **none** |
| 3 | **Fork balance** (Split only, at 4 or 5 runners) | With a Split contract | Wipe probability and the middle of the distribution, in opposite directions. **Not** the multiplier, **not** P(all clear), **not** expected survivors (§3.3). A volatility **dial**, not a trade: `4+1` is an exact mean-preserving spread of `3+2` (`MATH.md` §3.3) | **none** |
| 4 | **Shelter size `k`** | With a Shelter contract | Banks `k/n` of the claim irreversibly; truncates both tails | **none** |
| 5 | **Bank or continue** | After each resolved arena, no timer | Truncates the distribution at the current claim | **none** |
| 6 | **Side bet: event and stake** | With each route commitment | Adds a separate ticket with its own shape, at the identical margin | **none** |
| 7 | **Which Kindlings to shelter; who takes the thin limb** | With Shelter / Split | **Nothing distributional.** Runners are interchangeable in the mathematics: every one carries an equal share and has identical survival odds. What it changes is *who comes home* | **none** |
| 8 | **Names, lantern glass, cloth, charms** | Any time | Nothing mechanical. Attachment only | **none** |

**Stated plainly, in-product:** *"Every route returns
<!-- fig:rtpPct -->95.5%<!-- /fig -->. You are choosing the shape of the risk, not
the odds."* This line is permanently visible on the route screen. It is not a
disclaimer buried in a legal sheet; it is the product's actual thesis.

**And the harder line, also in-product**, on the shelter picker and the fork
assignment: *"Choosing who runs where changes who comes home. It does not change
the odds."* Both halves are true, and shipping only the first half would be the
lie.

### 3.1 The routes, and why the choice is real

| Route | Fiction | Geometry | What it does to the distribution |
| --- | --- | --- | --- |
| **WIDE** — *The Broad Bough* | A wide fossil bough. Crosswind, crumbling bark. | One lane, whole squad | Keeps the most runners alive (<!-- fig:wideExpectedSurvivors5 -->4.20<!-- /fig --> of 5 per arena) and clears the whole squad most often (<!-- fig:wideAllClear5 -->49.24%<!-- /fig -->). Everyone shares one shear risk, so a total wipe never drops below <!-- fig:wideWipe5 -->4.00%<!-- /fig -->. Multiplier <!-- fig:wideMult -->1.190x<!-- /fig -->. |
| **SPLIT** — *The Fork* | The branch divides in two. The squad divides with it. | Two independent lanes; balance is the player's | Kills more runners on average (<!-- fig:splitFallen5 -->1.25<!-- /fig --> per arena vs <!-- fig:wideFallen5 -->0.80<!-- /fig -->) and clears the squad less often (<!-- fig:splitAllClear5 -->32.55%<!-- /fig -->) — but a **total** wipe needs both limbs to fail: <!-- fig:splitWipe5 -->1.30%<!-- /fig --> at five runners. Multiplier <!-- fig:splitMult -->1.333x<!-- /fig -->. |
| **NARROW** — *The Reach* | A hairline limb across a gap. Single file, point runner first. | One lane, single file | The point runner's fall whips the line and takes everyone: <!-- fig:narrowWipe5 -->51.56%<!-- /fig --> total wipe, and all five clear only <!-- fig:narrowAllClear5 -->1.56%<!-- /fig --> of the time. Multiplier <!-- fig:narrowMult -->4.000x<!-- /fig -->. |
| **SHELTER** — *The Lamp House* | A brass shelter door mid-branch. | Withdraw `k`, remainder runs Wide | Banks `k/n` of the claim on the spot. **Once that credit is made**, the round's bust probability is exactly **zero** — that money is already home. Read at the point of *choosing*, it is a promise about the moment after you commit, not before: a Shelter takes `1 <= k <= n-1`, so at least one runner always crosses the branch in front of you. |

**Wide and Split are a genuine trade, in both directions.** At five runners Split
is <!-- fig:splitSaferRatio5 -->3.07x<!-- /fig --> safer against losing everyone;
at two runners Split is *more* dangerous than Wide
(<!-- fig:splitWipe2 -->6.25%<!-- /fig --> against
<!-- fig:wideWipe2 -->5.50%<!-- /fig -->), because two solo lanes remove the
safety of numbers. And at every squad size Wide keeps more runners alive and
clears the whole squad far more often. Split buys a better worst case with a
worse typical case. Neither card is the right answer and the copy is forbidden
from implying one is: see §10.3.

**And that is not a figure of speech.** Wide against Split is the one pair in
this game whose integrated CDFs actually cross — at every squad size, on both
fork balances — so no risk-averse reading prefers one card over the other.
`MATH.md` §3.3 computes the full lattice and CI asserts it, precisely because
this document previously made the same claim about a control where it was false
(§3.3). Where a comparison in this document says *neither dominates*, there is a
generated table row behind it.

### 3.2 The route card (the most important UI object in the game)

Each card carries, for the current squad size, computed from the same tables the
enumerator publishes:

```
┌──────────────────────────────────────┐
│ ROUTE NAME          THE FICTION      │
│ [multiplier]  per runner who clears  │
│                                      │
│ ▁▁▂▅▅▂  survivors, 5 runners         │  ← exact distribution bars
│      ┊▲ claim grows from here        │  ← break-even marker on the axis
│ your claim grows if   [ m ] get back │
│ chance of that           [ % ]       │
│ nobody makes it          [ % ]       │
│ all five make it         [ % ]       │
│ expected survivors       [ n ]       │
│                                      │
│ Returns 95.5%, like every route.     │
│ [ full odds ▸ ]                      │
└──────────────────────────────────────┘
```

Filled in for NARROW at five runners, from the generated tables:

| Field | Value |
| --- | --- |
| Multiplier | <!-- fig:narrowMult -->4.000x<!-- /fig --> |
| Your claim grows if | <!-- fig:narrowBreakEven5 -->2<!-- /fig --> or more get back |
| Chance of that | <!-- fig:narrowRises5 -->40.63%<!-- /fig --> |
| Nobody makes it | <!-- fig:narrowWipe5 -->51.56%<!-- /fig --> |
| All five make it | <!-- fig:narrowAllClear5 -->1.56%<!-- /fig --> |
| Expected survivors | <!-- fig:narrowExpectedSurvivors5 -->1.25<!-- /fig --> |
| Returns | <!-- fig:rtpPct -->95.5%<!-- /fig -->, like every route |

`full odds ▸` opens the exact per-outcome table — the same rows as `MATH.md`
§5.2, as fractions, in the game. A player who wants the paytable gets the
paytable.

**The two new fields, and why the card is wrong without them.** A crash game has
one number that only rises until it dies. A lane game has one binary state. This
card has a *fraction of a claim* multiplied by a *route price*, and the number a
player actually needs — how many runners have to come back for the claim to be
worth more than it was — appears in none of the other five fields and cannot be
inferred from them. It is different on every card (`MATH.md` §5.2.1):

| Card, five runners | Claim grows if | Chance it grows | Chance it falls but the round continues |
| --- | --- | --- | --- |
| WIDE | <!-- fig:wideBreakEven5 -->5<!-- /fig --> of 5 | <!-- fig:wideRises5 -->49.24%<!-- /fig --> | <!-- fig:wideFallsNonZero5 -->46.76%<!-- /fig --> |
| SPLIT 3+2 | <!-- fig:splitBreakEven5 -->4<!-- /fig --> of 5 | <!-- fig:balancedRises5 -->65.10%<!-- /fig --> | — |
| SPLIT 4+1 | <!-- fig:splitBreakEven5 -->4<!-- /fig --> of 5 | <!-- fig:scoutRises5 -->69.44%<!-- /fig --> | — |
| NARROW | <!-- fig:narrowBreakEven5 -->2<!-- /fig --> of 5 | <!-- fig:narrowRises5 -->40.63%<!-- /fig --> | <!-- fig:narrowFallsNonZero5 -->7.81%<!-- /fig --> |

Read the WIDE row: on the safest, most-taken card, the claim falls almost as
often as it grows — and it falls *while the run continues*, which is the outcome
the genre has trained every player to believe cannot happen. §5.2's whole
argument is that a player who does not hold the money rule "will do the only
safe-looking thing" and turn the game into a cash-out ladder. This is the exact
number that stops that, and the v2 card did not carry it.

Three build requirements follow:

1. **Both fields are on the card face**, in the same weight as the others, on
   every card, at every squad size — never behind `full odds ▸`.
2. **The distribution bars mark the break-even.** A tick on the survivor axis at
   the break-even count, with everything below it drawn in the falling family and
   everything at or above it in the growing family (§6.1's money colours). A
   player should be able to see which side of the line the mass sits on before
   reading a digit.
3. **"All five make it" is never reused for it.** On WIDE the two happen to
   coincide; on SPLIT and NARROW they do not, so a card that showed one field for
   both would mean two different things on two different cards — which is worse
   than showing neither.

`SHELTER` is the exception that proves the rule: it is the only card where part
of the claim stops moving at all, and its readout already states the banked
figure directly (S2).

### 3.3 The fork balance (a volatility dial with a name on it)

When Split is selected with four or five runners, the card grows a second
control: a divider the player drags across a row of Kindling silhouettes.

```
┌──────────────────────────────────────┐
│ SPLIT                    THE FORK    │
│ [multiplier]  per runner who clears  │
│                                      │
│   ● ● ●  │  ● ●        ← drag        │
│   broad limb  thin limb              │
│                                      │
│              3 + 2      4 + 1        │
│  nobody makes it  [ % ]     [ % ]    │
│  all five make it [ % ]     [ % ]    │
│  four or five     [ % ]     [ % ]    │
│  one alone comes  [ % ]     [ % ]    │
│                                      │
│  ▁▂▅█▅▂  │  ▂▂▃█▃▃    ← shared axis  │
│                                      │
│ Same 95.5% either way. 4 + 1 is the  │
│ wider spread: more of both endings.  │
└──────────────────────────────────────┘
```

Filled in at five runners, from the generated tables. Multiplier
<!-- fig:splitMult -->1.333x<!-- /fig --> on both:

| | 3 + 2 | 4 + 1 |
| --- | --- | --- |
| Nobody makes it | <!-- fig:splitWipe5 -->1.30%<!-- /fig --> | <!-- fig:scoutWipe5 -->2.52%<!-- /fig --> |
| All five make it | <!-- fig:splitAllClear5 -->32.55%<!-- /fig --> | <!-- fig:splitAllClear5 -->32.55%<!-- /fig --> |
| Four or five make it | <!-- fig:balancedKeep4Plus5 -->65.10%<!-- /fig --> | <!-- fig:scoutKeep4Plus5 -->69.44%<!-- /fig --> |
| One alone comes home | <!-- fig:balancedSole5 -->3.39%<!-- /fig --> | <!-- fig:scoutSole5 -->7.90%<!-- /fig --> |

Both columns are shown at once, always, with no default highlighted:

* **3 + 2** is half the chance of losing everyone.
* **4 + 1** is a better chance of coming out with four or five — because four
  runners riding one lane that usually holds is a more concentrated bet — and
  more than double the chance that exactly one lantern comes home.
* **Both are identical** on the multiplier, on the chance of a clean sweep, and
  on expected survivors. The card says so on its face.

**What this control is, stated correctly.** It is a *volatility dial*: `4 + 1`
is an exact mean-preserving spread of `3 + 2`, so it takes probability out of the
middle and puts it into both ends at an unchanged mean, and every risk-averse
reading prefers `3 + 2`. `MATH.md` §3.3 proves that, publishes the whole lattice,
and binds it in CI. Two build consequences follow, and they are requirements:

1. **The copy may not call this a balanced or non-dominated choice.** Earlier
   drafts of this document called it "a genuine, non-dominated trade". It is not
   one, the claim was false, and nothing on the card, in a tooltip, in a store
   listing or in marketing may restate it. The honest sentence is on the card
   already — *"Same 95.5% either way."* — plus the shape line below.
2. **It still may not be labelled as the wrong choice either.** A dial is an
   honest control. A player who wants a real chance of one lantern walking out
   alone is buying exactly that, at the same price as everything else. No
   warning, no colour hierarchy, no "recommended" mark, no default (§10.3).

So the card carries one added line under the two columns, in the same weight as
the rest: *"4 + 1 is the wider spread. More of both endings, same average, same
95.5%."* The distribution bars make it visible without the sentence: rendered on
a shared axis, `4 + 1` is visibly taller at both ends and shorter in the middle.
That is the whole content of the choice, and the player should be able to see it
before they read anything.

Then the second half of the control, which is the reason it is in the game at
all: **the player drags specific Kindlings across the divider.** That choice is
narratively enormous — *who do you send alone?* — and mathematically inert, and
the card states both facts in one line: *"Who goes where changes who comes home,
not the odds."* The dial is the excuse; the name on the thin limb is the point.
`WIDE` against `SPLIT` (§3.1) is where this game's genuinely non-dominated
decision lives, and the product should never be caught claiming there are two.

At two and three runners there is only one legal balance, and the control does
not appear. We do not render a disabled slider to imply a choice that is not
there.

---

## 4. Bet types

Full exact treatment in `MATH.md` §5. Product surface:

| Bet | Placed | Resolves | Feel |
| --- | --- | --- | --- |
| **Route Ticket** | At buy | End of round | The run itself. The main wager. |
| **Clean Sweep** | With a route commitment | That arena | "Everybody makes it." <!-- fig:cleanSweepMin -->1.30x<!-- /fig -->–<!-- fig:cleanSweepMax -->61.12x<!-- /fig -->. |
| **Sole Survivor** | With a route commitment | That arena | "One light comes out." Up to <!-- fig:soleSurvivorMax -->931.35x<!-- /fig --> on a full Wide squad. |
| **Last Light** | With a route commitment | That arena | "Nobody makes it." <!-- fig:lastLightMin -->1.53x<!-- /fig -->–<!-- fig:lastLightMax -->73.34x<!-- /fig -->. |

Side bets appear only when two or more Kindlings are *running* — under a Shelter,
that is the reduced group, not the squad. They are collapsed behind a single
`+ side bet` control, off by default, with the stake reset to zero every arena:
a player must actively choose them every time and never inherits a bet they set
once.

**Stake limits, and why they are product surface and not fine print.**

| Limit | Value |
| --- | --- |
| Minimum, route stake | 1.00 credit |
| Maximum, route stake | <!-- fig:maxStakeCredits -->1,000<!-- /fig -->.00 credits |
| Minimum, per side bet | 1.00 credit |
| Maximum, per side bet | **half the route stake** |
| Maximum, per round, all side bets together | **half the route stake** |
| Tickets per arena | at most one per event, three in total |

A player can never put more than half the money on a
<!-- fig:soleSurvivorMax -->931.35x<!-- /fig --> long shot that they put on the
game they came to play — so at most
<!-- fig:sideBetRoundShare -->33.3%<!-- /fig --> of a round's money can sit on the
side bets, and the run is always at least twice all of them together. This is
three things at once: it is what makes "1000x" a well-defined statement when a
round contains several stakes (`MATH.md` §9.3), it is what keeps the max-win cap
unreachable, and it is a responsible-design limit — an unbounded side-bet stake
turns a staged-survival game into a one-in-a-thousand lottery wearing its
costume.

**And the third of those was false at the v2 limit, which is why it moved.** Both
ratios used to be the full route stake. At parity the maximum legal configuration
in the game — a route ticket beside a maximum-stake Sole Survivor — was the most
volatile product in the whole specification, above the all-Narrow route ticket:
the limit stopped the long shot *exceeding* the game and did nothing to stop it
*substituting* for it, which is the behaviour §10.2 claims to prevent.
`MATH.md` §5.5 has the arithmetic and §9.6 records the change. At half a route
stake the most volatile thing the game offers is the game, and CI asserts that
over every enumerated portfolio rather than this paragraph asserting it.

The stake field shows the ceiling as a hard stop, states it in credits rather
than as a ratio (*"up to 2.50 — half your run"*), and never as a percentage of
balance.

**Where these limits degenerate, stated rather than discovered in QA.** The
minimum route stake is 1.00 credit (`MATH.md` §5.5, `src/branchfall.adapter.ts`),
and the per-round side-bet allowance is half a route stake. So the limits are
not independent at the bottom of the range, and halving the allowance moved where
they collide:

| Route stake | Legal side-bet configurations in the whole round |
| --- | --- |
| 1.00 (the minimum) | **none.** Half of 1.00 is below the 1.00 per-ticket minimum, so the control never appears |
| <!-- fig:minRouteStakeForASideBet -->2.00<!-- /fig --> | exactly one ticket, at exactly 1.00, in exactly one arena |
| 4.00 | one ticket at 1.00 or 2.00, or two tickets at 1.00 each |
| 6.00 or more | the "three tickets in one arena" ceiling becomes reachable — and reaching it spends the entire round's allowance in that arena |
| 20.00 or more | a 1/10-weight plan across all five arenas becomes legal |

"At most three tickets per arena" is therefore a **ceiling, not an entitlement**,
and below a 6.00 route stake it is unreachable by arithmetic rather than by
rule. Three build consequences, the first two already in S2: the `+ side bet`
control is **hidden**, not disabled, once the remaining allowance is under 1.00 —
a disabled control that can never re-enable is worse than no control — the stake
field offers the remaining allowance as its ceiling, not half the route stake,
whenever those differ, and **a minimum-stake player never sees the side-bet
control at all**, which is a consequence worth stating out loud rather than
discovering: the smallest run in the game is the run with no long shot attached.
None of this touches any proof: RTP is scale-invariant, so every figure in
`MATH.md` holds at every legal stake.

**Last Light is not insurance.** Product copy never uses the words insurance,
protection, hedge, or safety net for it. It carries the identical 4.5% margin as
everything else, and the card says so: *"Same 95.5% as every bet here."* Framing
a same-margin bet as protection is a dark pattern, and the fact that it *is*
mathematically a hedge does not license us to sell it as one.

---

## 5. Mobile-first portrait UX, screen by screen

Baseline device 390 x 844 pt. All primary actions in the bottom 280 pt thumb
zone. Everything works one-handed. Landscape is a stretch goal; portrait is the
design.

**Global layout while in a round:** viewport 0–58% of height (the branch, the
Kindlings, the fog), decision surface 58–100% (cards, claim, actions). The claim
figure lives on the seam between them in tabular numerals and never moves.

### 5.1 Speed of play — the minimum game cycle

From the moment a route is committed, the next money control stays locked for
**<!-- fig:minCycleMs -->5000<!-- /fig --> ms**.

**Which rule, and why this number.** The UKGC's speed-of-play requirement is
**RTS 14G — five seconds for casino games other than slots and peer-to-peer
poker**. RTS 14D's 2.5 seconds applies to *slots*, and BRANCHFALL is not
reel-based, so building to 14D would be assuming a classification in our own
favour. RTS 8 is the **autoplay prohibition**, which is a different requirement
that we satisfy separately by having no autoplay at all (§10.2); the v1 draft
cited it for the timing rule, which was simply wrong.

**Which edition, because a letter without one cannot be checked.** RTS provision
lettering has moved across revisions, so "RTS 14G" on its own is a citation that
can be neither verified nor falsified — which is the same class of error §5.1 was
written to fix, one level up. The edition this specification is written against
is therefore declared, and fingerprinted alongside `cycleUnit`:

| Declared field | Value |
| --- | --- |
| `speed.standard` | <!-- fig:rtsStandard -->UKGC RTS<!-- /fig --> |
| `speed.standardEdition` | <!-- fig:rtsEdition -->RTS 2021-10-31<!-- /fig --> |
| `speed.provision` | <!-- fig:rtsProvision -->RTS 14G<!-- /fig --> |
| `speed.provisionVerifiedAgainstCertifiedCopy` | **false** |

That last row is the honest one and it is deliberately in the declaration rather
than in a footnote. **This repository has not checked the lettering against a
certified copy of the operative edition in any jurisdiction, and does not claim
the citation is correct.** What it claims is narrower and is the thing that was
missing: the pin exists, it is visible, it is part of the game's declared
identity, and if it is wrong it is wrong in exactly one place. Verifying it
against the operative edition for a target jurisdiction is pre-submission work
this repository does not do (§12), and shipping
`provisionVerifiedAgainstCertifiedCopy: true` without having done it is the
defect — not declaring `false`.

**Which unit is the cycle, and what we are not claiming.** We declare the
**arena** as the game cycle, because the arena is where money is committed and
where a new commitment becomes available. The counter-argument is real and we
state it rather than bury it: guidance describes a cycle as ending when all money
staked or won has been lost or delivered, and a route ticket stays live across
arenas. **This is a classification question for a regulator and a test house, not
one this document can settle.** `speed.cycleUnit` is a declared, fingerprinted
field precisely so the position is explicit and can be changed to `'round'`
without touching anything else. If it must be the round, the floor applies to the
round and the game gets slower; nothing else changes.

The number is close to free either way: the arena replay is 9–14 s, so the floor
is already satisfied by watching the run. It binds only when a player skips.

The distinction that matters:

* A **countdown** takes something away when it expires. We have none, anywhere.
* A **floor** delays when something becomes available and takes nothing away.
  This is a floor. Nothing expires, nothing is lost, and waiting longer is always
  free.

It is rendered as a 2 pt hairline filling under the primary action, with no
numerals and no ticking sound, and the button is simply inert until it completes.
The engine enforces it server-side (`advance()` fails `TOO_SOON`), so a modified
client cannot beat it and a slow network cannot be punished by it.

---

### 5.2 The first run — how a player is taught the claim

**Why this section exists.** BRANCHFALL's money rule has two variables moving at
once:

```
claim' = claim x (survivors / runners) x route multiplier
```

A crash game has one number going up. A lane game has one binary state. This has
a *fraction of a claim* multiplied by a *route price*, and a player who does not
hold that idea will do the only safe-looking thing — tap the first card, bank,
repeat — at which point the game is a cash-out ladder wearing a costume and the
entire premise of §3 is wasted on them. The thesis in §3, *"you are choosing the
shape of the risk, not the odds"*, is asserted everywhere in this document and
was, in the previous draft, taught nowhere. This section is the fix, and it is
product-critical rather than nice-to-have.

#### 5.2.1 What has to be learned, in order

Three facts. Nothing else is first.

| # | The fact | Taught by | Visible forever after, in the shipped game |
| --- | --- | --- | --- |
| 1 | The round holds one **claim**, split into `n` equal shares — one per runner. | The claim meter, from the first frame | The claim meter (§5.2.2) |
| 2 | A share whose runner clears is multiplied by the route price. A share whose runner falls is gone. That is the entire money rule. | The first resolve, with the arithmetic printed | The arithmetic line on S4 |
| 3 | Every route returns <!-- fig:rtpPct -->95.5%<!-- /fig -->. Routes differ in **shape**, not in return. | The Two-Card Moment (§5.2.4) — by comparison, not by assertion | The route-card footer and the compare control on S2 |

**Fact 2 has a number, and the number is where it is taught.** "A share whose
runner clears is multiplied by the route price" is only actionable once a player
knows how many shares have to survive for the claim to be worth more than it was
— <!-- fig:wideBreakEven5 -->5<!-- /fig --> of five on WIDE,
<!-- fig:splitBreakEven5 -->4<!-- /fig --> on SPLIT,
<!-- fig:narrowBreakEven5 -->2<!-- /fig --> on NARROW at a full squad
(`MATH.md` §5.2.1). That is not a fourth thing to learn; it is fact 2 with its
number attached, and it is taught in the two places fact 2 already lives: the
card field (§3.2) and the printed arithmetic on the first resolve. §5.2.8 Q4
gates the build on it.

Fork balance, shelter sizing, side bets, the seed pair and the Ghost Line are all
**deferred**. None of them is required to play a correct round, and all of them
compete for attention with fact 3, which is the one that makes this game a
different object from a cash-out ladder.

#### 5.2.2 The claim meter — the teaching object *is* the HUD

The strongest thing we can do for comprehension is refuse to build a
tutorial-only explanation. There is no onboarding widget that gets thrown away.

```
        ┌────────────────────────────────┐
        │            4.775               │   claim, tabular, 28 pt
        │      ● ● ● ● ●                 │   five pips = five shares
        │      0.955 each                │   share value, 13 pt
        └────────────────────────────────┘
```

- Five pips sit under the claim figure, one per runner, each labelled with its
  own value. Five shares of 0.955 read as five shares long before anybody reads
  the word "fifth".
- On a resolve, the pips of fallen runners go dark **first**, held for 350 ms
  with the claim figure unchanged, and only then does the claim roll to its new
  value. Cause before effect, always in that order. A player watching this three
  times has the money rule whether or not they read anything.
- Under a Shelter, sheltered pips detach downward into the Lamp House row and
  keep their value; running pips stay above. The claim figure splits into
  `banked` and `running` on the same seam. This is the only moment in the game
  where two money figures are on screen at once, and they are visually separate
  families (§6.1) precisely so they are never confused.
- On a Split, the pips group into two clusters matching the lane sizes, and the
  clusters are drawn apart with a gap. Lane membership is legible in the money
  object, not only in the 3D scene.

The pip row is present in the rehearsal, in real rounds, at every quality tier,
and with reduced motion on (where the 350 ms hold becomes an instant state change
plus a text line). It is never dismissed and never "graduates".

#### 5.2.3 The Rehearsal — free, unstaked, and honest

`Rehearse ▸` sits above `Set the stake ▸` on S0 in a first-ever session, and
stays available from S0 and S9 forever after. It is three arenas, not five.

**What it actually is.** The same `staged-survival` lifecycle module (`ENGINE.md`
§2) executing **locally in the client** over a **published seed pair**, at no
stake. It is not a wallet transaction: no RGS round, no round id, no ledger
entry, no balance movement, no practice currency, and nothing that could later be
converted into anything. There is no separate tutorial state machine to drift out
of sync with the game — which is exactly why the rehearsal cannot mis-teach the
model.

**The seed pair is fixed, published, and in this repository.** Everyone's first
rehearsal is the same three branches, so the teaching beats land where this
document says they land. The pair is printed on the rehearsal's own verification
card, frozen in `tests/fixtures/rehearsal-v1.json`, re-derivable by
`npm run rehearsal`, and asserted on every CI run by `tests/rehearsal.test.mjs` —
the same standard the paytable is held to. In product: *"Practice runs use a
public seed. Everyone gets the same three branches."*

**The rehearsal does not pay, and it is chosen to hurt.** The published seed is
selected so that, on the default path (§5.2.5 offers WIDE first in arenas 1
and 2):

* arena 1 clears the squad — the player sees a claim grow and sees why;
* arena 2 costs two runners — the player sees the pips go dark and the claim
  fall, with the arithmetic printed;
* arena 3, if the player continues, takes the rest. The branch collapses under
  them, which is the ending we want them to have seen once before it costs
  anything.

A player who banks after arena 2 finishes **below the stake**, not merely below
the claim the round opened at. A player who continues finishes with nothing.
**Both endings are taught, and neither is a win.** We will not build a first
experience that pays. A demo that opens with a fantasy run is the oldest
manipulation in this category, and it teaches a distribution that does not exist.
Where a demo mode is required to be representative of real play, ours runs the
real model — and where it is deliberately unrepresentative, it is
unrepresentative in the direction that makes a player *more* cautious, never
less.

**A player who chooses differently gets a different rehearsal, and that is a
feature.** The published table fixes the draws for every route in all three
arenas before the first choice; the beats above describe the default path, not a
script. Taking NARROW in arena 1 produces a different, equally real rehearsal —
and the Ghost Line at the end (§8.2) then shows what the route they skipped had
been holding all along. The one thing onboarding cannot afford to teach by
accident is that the game reacts to you. It does not.

**Why the rehearsal may hold the hazard table when a real round may not.** S1
forbids the client from ever receiving a live round's table, because a client
that holds it can place a side bet on an arena that has already resolved
(`ENGINE.md` §10.2). The rehearsal holds a table by construction. That is safe
for exactly one reason — there is no stake, no side bet, no wallet and no ledger
entry anywhere in the rehearsal — so it is a hard build rule that the rehearsal
is a **separate entry point that cannot be handed a live round's seeds or a
wallet handle**, never a `rehearsal: true` boolean threaded through the money
path. A flag on the money path is precisely how this becomes a disclosure bug.

**And we say the uncomfortable part out loud.** Choosing a seed pair for the
outcome it produces is, in a money round, exactly the attack `ENGINE.md` §10.1
exists to prevent, and it is the attack this project treats as its top threat.
We do it here deliberately, on a pair that pays nothing, that is published in
advance, and that is banned by construction from real play. Stating that is
cheaper than having a reviewer discover it.

**Random practice runs.** A `New practice run` control takes a fresh client seed
and makes no promises about what happens. Same code path, same model, no beats.
It exists so that "the practice run is fixed" never has to mean "the practice run
is the only one you may have".

**It is offered, never forced.** Skippable at any point with one tap, repeatable
forever, and never gated behind an account, a deposit, a verification step or a
session length. A player who taps `Set the stake ▸` first gets the full game and
the progressive-disclosure rules in §5.2.5 still apply to their real rounds.

#### 5.2.4 The Two-Card Moment — the thesis, demonstrated

This is the one screen the product cannot ship without. It happens once, before
the first commitment of the rehearsal, and it is then permanently available as a
control on S2.

The two cards on offer in rehearsal arena 1 — WIDE and NARROW, deliberately the
two furthest apart — are pinned side by side on one axis:

```
┌──────────────────────────────────────────────┐
│  WIDE  [multiplier]  │  NARROW  [multiplier] │
│                      │                       │
│  ▁▁▁▂▅█  survivors   │  █▁▂▂▂▁  survivors    │
│  0 1 2 3 4 5         │  0 1 2 3 4 5          │
│                      │                       │
│  nobody     [ % ]    │  nobody     [ % ]     │
│  all five   [ % ]    │  all five   [ % ]     │
│                      │                       │
│        Both return [ rtp ].                  │
│      They are not the same bet.              │
└──────────────────────────────────────────────┘
```

Two histograms, one shared axis, one shared footer. The sentence
*"Both of these return <!-- fig:rtpPct -->95.5%<!-- /fig -->. They are not the
same bet."* is the entire product argument, and it is the only place in the game
where we say it with a picture instead of a claim. The numbers are the generated
ones (<!-- fig:wideWipe5 -->4.00%<!-- /fig --> / <!-- fig:narrowWipe5 -->51.56%<!-- /fig -->
nobody, <!-- fig:wideAllClear5 -->49.24%<!-- /fig --> /
<!-- fig:narrowAllClear5 -->1.56%<!-- /fig --> all five), read from the same
tables the enumerator publishes.

**It stays.** A `compare` affordance on every route card pins any two cards into
that same view, for the life of the product. If a player retains one thing from
onboarding, it should be *where to look*, not a sentence they were shown once.

#### 5.2.5 Progressive disclosure of the decision surface

S2 in full is four paged route cards, a fork-balance control with an eight-cell
comparative table, a shelter picker and three side bets. That is the right screen
for a player who holds the model and the wrong first screen for anyone.

| Stage | Routes offered | Fork balance | Shelter picker | Side bets | Ghost Line |
| --- | --- | --- | --- | --- | --- |
| Rehearsal arena 1 | WIDE, NARROW | — | — | — | — |
| Rehearsal arena 2 | + SPLIT | shown (4–5 runners) | — | — | — |
| Rehearsal arena 3 | + SHELTER | shown | shown | — | shown once, at the end |
| Real rounds 1–3 | all four | as the model allows | shown | off; one-tap opt-in | opt-in |
| Round 4 onward | all four | shown | shown | available | available |

Six rules make this disclosure rather than manipulation. They are requirements,
not guidance:

1. **Additive only.** Nothing that has appeared is ever taken away.
2. **One tap out.** `Show me everything` is present on every gated screen, is
   remembered, and is never re-asked.
3. **Never gated on money.** Not on deposit, not on stake size, not on session
   length, not on wins, and above all not on losses. The counter is *rounds
   seen*. Any gate keyed to spend is a monetisation device pretending to be a
   tutorial and is forbidden here.
4. **Odds are never gated.** The full exact odds table (§3.2) is reachable from
   the first frame of the rehearsal, including for routes not yet on offer. Not
   *offering* a card and *hiding its numbers* are different acts and we only do
   the first.
5. **Side bets are opt-in once, explicitly.** The opt-in states the pricing rule
   in words, shows one worked example, and states that side bets carry the same
   <!-- fig:rtpPct -->95.5%<!-- /fig -->. They never appear on a screen the
   player did not ask to have them on.
6. **No progress theatre.** No XP, no unlock animation, no badge, no streak, no
   "new route unlocked" celebration. A disclosure step is a quiet appearance. The
   moment we reward a player for progressing through a tutorial we have started
   training the behaviour we spend §10 trying not to train.

#### 5.2.6 The onboarding copy sheet

Exact strings, so a build has something to implement rather than a paraphrase.
All of these are subject to §10.3 and `tests/copy-discipline.test.mjs`.

| # | Where | String |
| --- | --- | --- |
| 1 | S0, first session, above the buttons | *"First time? Three branches, no stake, same rules."* |
| 2 | Rehearsal A1, over the claim meter | *"Your stake buys one claim. Five runners carry it — one fifth each."* |
| 3 | Two-Card Moment footer | *"Both of these return <!-- fig:rtpPct -->95.5%<!-- /fig -->. They are not the same bet."* |
| 4 | First resolve, beside the arithmetic | *"The runners who cleared carry their shares across. The shares that fell are gone."* |
| 5 | Rehearsal A2, when SPLIT first appears | *"The branch forks. Each lane falls on its own, so losing everyone now takes two failures instead of one."* |
| 6 | Rehearsal A3, when SHELTER first appears | *"A shelter door. Bring some of them home and that part of the claim stops running."* |
| 7 | Under the primary action, first three arenas | *"There is no clock on this. Nothing here expires."* |
| 8 | Rehearsal end, banked | *"That is the whole game. Choose the shape, watch, then bank or send them again."* |
| 9 | Rehearsal end, wiped | *"That is the other ending. It is <!-- fig:rtpPct -->95.5%<!-- /fig --> either way — the route only changes how often it looks like this."* |
| 10 | Rehearsal, permanent chip | *"REHEARSAL — public seed, no stake, no payout."* |
| 11 | Any gated screen | *"Show me everything."* |
| 12 | Side-bet opt-in, once | *"Side bets are separate money on one arena's result, at the same <!-- fig:rtpPct -->95.5%<!-- /fig -->. They stay off until you turn them on."* |
| 13 | First resolve where the claim fell and the run continued | *"One did not make it, so their share is gone. On the Broad Bough the claim only grows when all five get back."* |
| 14 | On every route card, under the bars | *"Your claim grows if [n] get back."* |

#### 5.2.7 What the first run must never do

- Never a scripted win, a weighted first round, or a seed chosen to flatter.
- Never a near-miss authored for the tutorial (§6.9 rule 4 has no exemption for
  onboarding).
- Never a first-round bonus, free run, matched stake or "welcome" offer attached
  to the rehearsal or to the screen after it.
- Never a suggestion that practice improves outcomes. The rehearsal teaches what
  the numbers mean; it cannot teach anyone to do better, because §8 of `MATH.md`
  proves there is no better. Copy that implies otherwise fails §10.3.
- Never a forced tutorial, and never a re-prompt after a decline.
- Never a rehearsal figure presented as a balance, a total, or a result.

#### 5.2.8 How we will know it worked

Comprehension is testable, so we test it rather than assume it. Eight or more
unmoderated first-time testers, after the rehearsal and before any staked round,
answer four questions with the odds table closed:

| | Question | Correct answer | Bar |
| --- | --- | --- | --- |
| Q1 | "Three of your five runners cleared, the route paid 1.190, and your claim was 4.775. Bigger or smaller now, and roughly what?" | Smaller, ≈3.41 | 6 of 8 |
| Q2 | "Which route gives you back more over time — Wide or Narrow?" | Neither. Both <!-- fig:rtpPct -->95.5%<!-- /fig --> | 7 of 8 |
| Q3 | "You banked after arena 2. Can anything that happens later take that money?" | No | 7 of 8 |
| Q4 | "You are about to send five runners down the Broad Bough. How many have to come back for your claim to be worth more than it is now?" | All five | 7 of 8 |

**Q2 and Q4 are both release gates**, and they fail in opposite directions.

* If **Q2** fails, the Two-Card Moment is wrong and no amount of copy anywhere
  else will repair it — that is the failure mode where the game degenerates into
  a cash-out ladder.
* If **Q4** fails, the player believes the number only goes up until they die,
  which is what every other game in this category has taught them. They will read
  a four-of-five WIDE arena as a win. It is not one: the claim fell. A build that
  ships that misreading has a route card that lies by omission, which is why the
  break-even is a card field (§3.2) and not a tooltip.

Q1's bar stays at 6 of 8 because it tests arithmetic under recall; Q2, Q3 and Q4
test whether the player holds the model at all.

This is an acceptance criterion for the client build (§11), not something this
repository discharges.

---

### S0 — Squad
*Home. The five Kindlings stand on a low stone shelf in half-light.*

- Each Kindling: name, lantern glass colour, cloth, one charm. Tap to rename or
  re-dress. A small "runs come home: 41" counter per Kindling.
- A permanent line: *"Cosmetics never change the odds."*
- Bottom: `Set the stake ▸`. On a first-ever session `Rehearse ▸` sits above it
  with the line *"First time? Three branches, no stake, same rules."*; after the
  first staked round the two swap order and `Rehearse ▸` becomes a quiet
  secondary that never disappears (§5.2.3).
- Session strip at the very top: time played, net position this session, always
  visible, never dismissible.

### S1 — Stake
- A stepper plus four presets. Stake shown in credits with tabular numerals.
- Below the stepper, computed live and honestly: *"Buying this run debits 5.00 and
  opens a claim of 4.775 — that's the 95.5% return, charged once, now. It is not
  charged again no matter how far you go."*
- Directly beneath it, in the same weight, never as fine print:
  *"Every route on the next screen sends at least one Kindling across. Banking
  starts after the first branch."* (§2.)
  **This string was changed and the change is the point.** It used to read
  *"There is no way back out of the first branch."* — which §2.1's expiry rule
  made false, because an unplayed round that expires is cancelled and refunded.
  A buy-screen statement about the terms of a wager may not be falsified by a
  rule twelve lines away in its own specification. The replacement says the true
  thing, which is also the thing the model actually guarantees: every *action*
  runs a runner.
- Beneath that, collapsed, one tap: *"Leave mid-round and the round waits. If it
  is still waiting after 24 hours we close it for you — banked if a branch has
  resolved, cancelled and refunded in full if none has."* (§2.1.)
- **Your seed** (collapsed, one tap): the client seed the app generated locally
  for this round, editable, with *"Change this to anything you like. The server
  has already committed to its half and cannot see yours."* (§8.1.)
- `Buy the run` (primary). On tap: the pre-commitment hash appears for ~1 s with a
  small lock mark and the text *"The server's half of this round is sealed. Your
  half is yours."* Then S2.
- The client never receives the hazard table. It receives the digest, the frame
  and the offers. That is a security requirement and not a bandwidth one: a
  client that held the table could place a side bet on an arena that had already
  resolved (`ENGINE.md` §10.2).

### S2 — Arena brief and route choice *(the core screen)*
- Viewport: the branch ahead in fog, arena name, arena number `2 / 5`. The squad
  is visible at the mouth of the branch, lanterns lit, breathing idle.
- Decision surface: a horizontally paged stack of four route cards (§3.2), one
  per screen-width, with a page indicator. Wide first, then Split, Narrow,
  Shelter. Card order never changes and is never personalised. **How many cards
  are on offer depends on the disclosure stage in §5.2.5**; the order of the ones
  that are present never does.
- A `compare` affordance on every card pins any two cards into the side-by-side
  view of §5.2.4. This is the permanent form of the Two-Card Moment.
- The claim meter (§5.2.2) sits on the viewport seam: the claim figure with one
  pip per runner beneath it, clustered by lane on a Split.
- The Split card carries the fork-balance control (§3.3) at four or five runners.
- Shelter card expands to a Kindling picker: tap the ones to bring home. Live
  readout: *"Banks 1.91 now. 3 keep running."*
  **At least one runner must keep running.** Selecting the whole squad is not a
  legal shelter and the picker must refuse it rather than accept it and fail on
  commit: the last unselected pip is inert, and tapping it says *"One has to run.
  You can bank the rest after this branch."* This mirrors the model exactly —
  `SHELTER(j)` exists only for `1 <= j <= n-1` (`MATH.md` §5.3) — and it is the
  single easiest rule for a build to get wrong.
- `+ side bet` collapsed control below the cards, subject to the opt-in in
  §5.2.5 rule 5. It is **hidden entirely**, not shown disabled, whenever the
  round's remaining side-bet allowance is below the 1.00 minimum (§4).
- Footer: current claim, squad count, `Commit route` (primary, full width).
- **No countdown, no auto-select, no "recommended" badge, no highlighting of the
  higher-multiplier card.** All four cards have identical visual weight.

### S3 — The run
- Viewport expands to full bleed. Decision surface slides away; only the claim
  and squad count remain, docked bottom-left.
- 9–14 s replay. Camera travels with the squad. On Narrow it drops to a close
  handheld follow. On Split it holds both limbs in frame until they diverge, then
  cuts to whichever limb resolves first.
- A `skip` affordance appears after 1.5 s (bottom-right, low contrast). Skipping
  jumps to the resolved state; it cannot change anything, and the game says so
  the first time: *"The result is already sealed. Skipping only skips the view."*
  Skipping does **not** shorten the game cycle (§5.1).

### S4 — Resolve, then bank or continue
- The moment survivors are counted, the claim number rolls (tabular, ~600 ms,
  no spinning) and the arithmetic is shown in full for one beat:
  `4.775 x (3/5) x 1.333 = 3.820`. Never a mystery multiplier.
- Any side bet resolves in the same beat, on its own line, with its own stake and
  its own result stated separately from the run: *"Clean Sweep 2.00 — lost."*
  Side-bet money is never blended into the claim figure.
- Fallen Kindlings are named in a quiet list: *"Bramble did not make it."*
- Two actions, equal visual weight, side by side:
  `Bank 3.82` and `Run The Char ▸`. Neither is styled as the "right" one.
  No pulsing, no colour hierarchy, no default focus.
- **No timer.** The screen will sit here forever. The
  <!-- fig:minCycleSeconds -->5.0<!-- /fig --> s hairline completes under both
  buttons together.

### S5 — Bank / Shelter
- The Lamp House door opens, the chosen lanterns go inside, the brass bell
  strikes once, and the saved lights stack into a small constellation above the
  door.
- Result stated in relation to the stake, always: *"Banked 3.82 — that's 0.76x
  your 5.00 stake."* A sub-stake return is **never** presented as a win. No
  "YOU WON" banner over a losing round. No coin-shower for a 0.4x recovery.

### S6 — Wipe
- The last lantern falls, tumbles, and goes out. Two full seconds of fog and wind
  with no UI at all.
- Then, quietly: *"No one made it back. You staked 5.00."* Plus anything already
  sheltered or won on a side bet, stated separately.
- Primary action is `Back to the squad`. A secondary `Run again` fades in only
  after **2 seconds**, and there is no stake pre-fill, no "double your stake",
  no offer, no bonus prompt, no free-spin popup on this screen or the next one.
  Promotional surfaces are suppressed for 60 s after any losing round.

### S7 — Round summary
- The five arenas as a vertical strip with what happened at each, including the
  fork balance chosen and who took the thin limb.
- Money: staked (run and side bets separately), banked, net — plain, tabular, no
  celebration styling.
- `How this was decided ▸`.

### S8 — Verification
- Cold blue UI (`--verify`), deliberately in a different visual family from the
  game so proof never looks like a reward.
- Shows: the server pre-commitment (published before your seed existed), your
  client seed, the hazard digest, the revealed server seed, the round id, adapter
  and model versions, and a `Re-derive` button that recomputes the whole hazard
  table on-device and shows every arena's draw against the outcome.
- If the operator runs a pre-committed seed chain, the chain's terminal hash and
  this round's forward link are shown, with the date the terminal was published.
- `Copy verification bundle` exports JSON that `tools/transcript.mjs` will verify
  on any machine.
- **The Ghost Line** (§8.2, limits in §10.6) lives here, opt-in, off by default.

### S9 — Settings and responsible play
- Session limits, reality-check interval, self-exclusion hand-off to the
  operator, full odds tables, this document's §10 in plain language, audio and
  motion-reduction toggles, quality tier override (§6.8).

---

## 6. Art direction

### 6.1 Palette

Ten percent of the frame is warm. Ninety percent is not. That ratio is the art
direction; everything else is detail.

| Token | Hex | Use |
| --- | --- | --- |
| `--void` | `#0E1114` | the Understory below; the deepest value in frame |
| `--night` | `#1A2026` | night air, UI background |
| `--fog-mid` | `#38434B` | mid-distance fog, shadowed stone |
| `--fog-far` | `#8A98A0` | far fog; the value everything silhouettes against |
| `--mist` | `#D6DDE0` | near mist, lantern-lit fog, lightest cool value |
| `--bark-deep` | `#2B231C` | wet fossil bark in shadow |
| `--bark` | `#4A3A2C` | fossil bark base |
| `--bark-lit` | `#7A6248` | bark catching lantern light |
| `--fossil` | `#D8CFBB` | exposed petrified grain, bone-cream |
| `--lamp-core` | `#FFE7BE` | lantern flame core, near-white |
| `--lamp` | `#FFA53D` | lantern light, the game's signature colour |
| `--ember` | `#D2621C` | lantern falloff, embers on The Char |
| `--brass` | `#C9A227` | Lamp House, Crown Lamp, banked-money accents |
| `--extinguish` | `#5A4E63` | a cold violet-grey: dead lantern glass, lost runners |
| `--verify` | `#7FD4FF` | fairness/verification UI only. Never used in-world |
| `--alert` | `#E0442F` | destructive confirmations only. **Never** used for Narrow |

Two hard rules. **Risk is never coloured as danger** — Narrow is not red, because
colouring the high-variance choice as "bad" is editorialising a decision that has
identical EV. And **`--verify` never appears in the game world**, because the
proof UI must not feel like a reward animation.

### 6.2 Materials

Only three material families exist. Discipline here is what makes it look
authored rather than assembled. Each entry gives the intent first and the
tier-by-tier implementation in §6.8 — the look is the requirement, the technique
is negotiable.

- **Petrified wood** — everything the runners touch. Roughness 0.75–0.90,
  metalness 0, triplanar grain normal at two scales (10 cm ripple, 2 m sweep),
  hairline fracture network in the cavity map, a thin dust layer that lightens
  upward-facing surfaces toward `--fossil`. Thin fins read as slightly
  translucent when a lantern passes behind them — delivered by a baked thickness
  map driving a wrapped-diffuse term with a fresnel-weighted `--lamp` tint. No
  subsurface scattering on any tier.
- **Kindling construction** — woven reed (anisotropic strand normal, tangent
  along the weave), linen (GGX sheen lobe, visible weave at 0.5 mm, slight
  fibre fuzz on the silhouette), aged leather straps (roughness 0.5, subtle
  wax specular), and the lantern: thin blown glass in an aged brass frame
  (metalness 1.0, roughness 0.35, patina in the crevices). The glass is a
  **pre-integrated** shader — thin-film specular, strong fresnel rim, a 64²
  per-arena environment probe and an emissive core — not screen-copy refraction.
  There is no refraction pass in this game on any tier; the read we want is
  "a lit object behind slightly warped glass", and a fresnel rim over a probe
  delivers it at a twentieth of the cost.
- **Fog** — the game's depth cue and its dread. At arena 5 the fog below is
  thicker, not thinner. Implementation is tiered (§6.8) from raymarched layers
  down to scrolling cards; what is fixed on every tier is the *silhouette
  behaviour*: figures must dissolve into `--fog-far` with distance, lanterns must
  scatter warmth into the near fog, and the fog must have visible internal
  parallax so the branch reads as suspended in a volume rather than pasted on a
  backdrop.

**Emissive budget rule:** the only emissive surfaces in the entire game are
lantern flames, the Lamp House interior, the Crown Lamp, and the crack network on
The Char. Nothing else emits — not UI in world space, not hazards, not path
markers. Because light is money, light must be scarce. The Char's embers are the
single declared exception and are heat, not light: they cast nothing and
illuminate nothing (§6.7).

### 6.3 Lighting

- One cool key from above and behind: a sky dome at `--fog-far`, low intensity.
  Its job is to give the world silhouettes, not to illuminate it.
- Each Kindling carries a warm point light: `--lamp`, 3.5 m radius,
  inverse-square, **unshadowed**. Contact is sold by a baked contact-shadow decal
  projected onto the branch under each figure, not by a shadow map.
- **At most one shadow-casting light exists in the scene, and it is a spot, not a
  point.** A shadow-casting point light costs up to six cube faces per frame;
  three of them was never shippable in a browser. The one spot is parented to the
  lead lantern, aimed along the direction of travel, 1024² on the top tier and
  absent below it (§6.8).
- **The death of a light is a lighting event, not a particle effect.** When a
  lantern goes out its point light falls off over 220 ms with a slight blue
  shift as it dies, and the local fog loses its warm scatter. You feel the frame
  get colder.
- Losing the last lantern removes all warm light from the scene. What remains is
  the cool key on grey fog. Hold it. Do not cut away early.
- Banking is the inverse: the Lamp House interior blooms as each lantern is
  carried in, and its brass throws warm bounce back onto the branch — a
  hand-placed bounce light, not a GI solve.

### 6.4 Motion language

- **Hybrid frame rate on the characters.** Root motion and camera at full frame
  rate; secondary motion (cloth, reed sway, lantern swing) stepped to 12 fps.
  The result reads as hand-made puppetry moving through a real space, and it is
  the single strongest anti-"party game" signal in the whole presentation. It is
  also, conveniently, a large saving: secondary rigs update on every fifth frame
  at 60 Hz, and on a 2–3–2–3 pattern at 30 Hz. The 12 Hz clock is defined in
  time, not in frames, so it is identical on every device class (§6.8).
- **Falls are weighted-light.** 0.7 g for the first 400 ms so the fall registers
  and the lantern arcs legibly, then full gravity. Ragdoll never flails
  comically: joint limits are tight, and the figure keeps trying to grab.
- **Camera.** Default a 35 mm-equivalent tracking rig at chest height, slight
  handheld noise. On The Reach it drops to 24 mm, closer and shakier. On a Split
  it pulls back to 50 mm to hold both limbs. On a wipe it stops moving entirely
  and lets the subject leave frame. The Reach's close follow means a lane
  collapse drops all five figures inside the frame at once, which is an authored
  five-body beat and not a physics one — §6.9 bounds what that costs.
- **UI motion.** Nothing bounces, nothing overshoots. 240 ms cubic-out on
  everything. Money counts up on a tabular roll — never a slot-machine spin,
  never a rising pitch sweep. Celebration is light and sound, not kinetics.
- **No confetti, ever.** No coin fountains, no screen-shake on a win, no
  fireworks. The reward for a big bank is that the tree is briefly warm.

### 6.5 Type direction

- **Display:** condensed humanist grotesque, high x-height, squared terminals,
  tight tracking. It should look stencilled onto crates, not inflated. Explicitly
  **not** rounded, chunky, or bubbly — that register belongs to the party-game
  genre we are avoiding.
- **UI/body:** neutral grotesque with a strong numeral set.
- **Money and multipliers:** tabular-lining numerals, always monospaced.
  A multiplier must never reflow while counting.
- **Runner names:** a slightly irregular grotesque italic, as if written on a
  luggage tag tied to the figure.
- **Case:** sentence case everywhere, with one exception — route names are
  ALL CAPS at `0.14em` tracking. They are the only element allowed to shout, and
  all four shout equally.
- **Minimum sizes:** 15 pt body, 13 pt secondary, 28 pt for the claim figure.
  Numbers never below 15 pt.
- **Budget:** two families, four cut files, ≤ 190 KB WOFF2 total, Latin subset at
  boot with the extended ranges lazy-loaded. Numerals are in the boot subset.

### 6.6 Three visual references (described, not appropriated)

1. **A lantern procession photographed at dusk in heavy fog, long lens.**
   Figures dissolve into grey volume; the only saturated colour anywhere in frame
   is flame; a single small light stays legible at extreme distance. *Take from
   it:* the 90/10 value structure, the fact that one warm point can carry an
   entire composition, and how fog turns distance into dread.
2. **Macro photography of petrified wood cross-sections.** Mineral greys and
   bone-creams, fine parallel grain, hairline fracture networks, occasional
   crystalline pockets. *Take from it:* every surface the runners touch. The
   world is stone that remembers being wood, and that memory is visible at
   30 cm and invisible at 30 m.
3. **Exposed-craft stop-motion armature puppetry — the behind-the-scenes version,
   with the wire showing.** Real cloth weave, imperfect symmetry, thumbprints in
   the material, a visible join at the shoulder. *Take from it:* the Kindlings'
   construction and the stepped secondary animation. The player must believe
   someone made these by hand and is now sending them somewhere dangerous.

### 6.7 The five arenas

Each is one 60 m spline with modular fossil segments. The dressing, the fork
geometry, the fog behaviour and the escalation are authored per arena — "dressed
differently" is not a brief, so here is the brief. Every fork is hand-built, and
every fork must read at a glance as **one broad limb and one thin limb**, because
the fork balance is a player decision (§3.3) and the level has to show the player
what they are choosing between.

**1 — LOWBRANCH.** *The widest bough on the tree, and the closest to the fog.*
- Silhouette motif: **horizontal**. Long, heavy, level. The only arena where the
  branch is wider than the camera frame.
- Fog: densest of the five, and its top plane sits 3 m below the deck, so it laps
  at the runners' ankles at the low points and the squad wades rather than walks.
- Dominant material: wet `--bark-deep`, standing water pooled in the grain. This
  is the **only reflective surface in the game** — lanterns double in the pools —
  and it is spent here so the following four arenas can be dry and dead.
- Fork: the bough divides around a fossilised burl the size of a house. Broad
  limb 2.4 m across, over the burl's shoulder; thin limb a 0.6 m root-buttress
  ledge running along its flank, with the burl blocking sightlines between them.
- Escalates: nothing yet. This is the baseline everything else is measured from.

**2 — THE GRAIN.** *The bark is gone. You run on the wood itself.*
- Silhouette motif: **parallel lines converging**. Petrified grain ridges run
  along the direction of travel like a giant's fingerprint, and the whole arena
  reads as perspective lines pointing at the vanishing point.
- Fog: mid-density, and for the first time it is entirely *below* — a flat white
  sea with a visible surface. The player learns what falling means.
- Dominant material: `--fossil` bone-cream on the ridge crowns, `--fog-mid` in the
  troughs, matte and dusty. Zero moisture.
- Fork: the grain itself separates. Two ridge-rafts peel apart with a widening
  crack of nothing between them, and you can see straight down through it. Broad
  limb is a three-ridge raft; thin limb is a single 0.9 m ridge with the crack on
  both sides.
- Escalates: first time the player sees *through* the branch.

**3 — WINDROW.** *The windward side. Everything here is scoured.*
- Silhouette motif: **diagonals**. The whole arena is raked 6°, so the horizon is
  never level and the camera never settles. Petrified vine-cables are the only
  vertical elements, and they hum.
- Fog: **moving**. Horizontal ribbons streaming left to right at 4 m/s. The
  player reads wind before they hear it, which is the first time fog stops being
  a backdrop and becomes weather.
- Dominant material: `--bark-lit` polished by grit to a low sheen on windward
  faces, `--bark-deep` in the lee. Directional wear on every asset — the arena
  should look like it has been sandblasted from one side for a thousand years.
- Fork: the branch passes a standing vine-cable anchor. Broad limb hugs the lee
  side, sheltered and slower; thin limb is the exposed windward ledge where the
  fog ribbons hit the runners directly and their cloth flattens against them.
- Escalates: for the first time, the environment is actively doing something.

**4 — THE CHAR.** *A lightning scar. The stone here was cooked.*
- Silhouette motif: **shattered and angular**. Every edge is a fracture plane.
  Nothing in this arena is a smooth curve.
- Fog: **thinnest of all five**. The heat burned a hole in it, so the void below
  is genuinely visible for the first time, and there is nothing in it.
- Dominant material: vitrified `--void`-black stone at roughness 0.25 — the only
  near-glossy stone in the game — crazed with a fracture network carrying
  `--ember` emissive at 0.15. Declared exception to §6.2's emissive rule: it is
  heat, it casts no shadow, and it illuminates nothing. Embers drift *upward* out
  of the cracks, which is the only upward motion in the whole game.
- Fork: the branch is broken and the limbs are the two halves of a splintered
  trunk. Broad limb is a flat fracture plane; thin limb is the spar of a single
  splinter, 0.5 m, with a 4 m drop-and-step at its midpoint that the runners have
  to jump down.
- Escalates: the player can now see exactly how far there is to fall.

**5 — CROWN.** *The top. The Lamp is visible from the first frame.*
- Silhouette motif: **a single converging line to a point of light**. Everything
  aims at the Crown Lamp, which is small, warm, far, and on screen the entire
  time.
- Fog: below and behind only. The sky opens for the first and only time — a cold
  high dome, no stars, no moon. The palette gets *lighter* at the moment it gets
  most dangerous.
- Dominant material: `--fossil` gone pale and thin. This is where the thickness
  map earns its place: the limb is thin enough that a lantern passing behind it
  glows through the stone.
- Fork: the crown antlers. Two upswept tines that both aim at the Lamp. The broad
  tine is wider but takes a long arc; the thin tine is a direct line. Neither
  reads as the safe one, deliberately — the geometry should make the player
  hesitate rather than reassure them.
- Escalates: the destination is visible, which is what makes the last fall the
  worst one in the game.

Across the five: fog density falls, altitude rises, moisture goes to zero, the
palette drifts from `--bark-deep` toward `--fossil`, silhouettes go from
horizontal to vertical, and the sub drone gains 2 dB per arena (§7). By Crown the
world is pale, dry, high, thin and quiet — the exact opposite of Lowbranch in
every dimension a player can perceive without being told.

### 6.8 Runtime, device floor, and the quality ladder

**This ships as WebGL2, in an operator lobby iframe.** That decision comes first
because it changes everything after it.

| Decision | Value | Why |
| --- | --- | --- |
| Runtime | **three.js, with our own render pipeline on top** — single ES module, no plugin | iGaming content is embedded in an operator lobby iframe with a contractual first-load budget. Unity WebGL is rejected on boot size and heap floor; a native build has no distribution path here |
| Graphics API floor | **WebGL2** (ES 3.0). No WebGPU dependency | WebGPU coverage is still not universal on the mid-range Android install base; it may be used as an *optional* fast path, never as a requirement |
| Frame-rate target | **60 fps on device classes C2–C3, 30 fps locked on C0–C1.** 30 fps is the hard floor everywhere | below 30 the stepped secondary animation stops reading as intentional and starts reading as a bug. Which class gets which target is the table below, and it is the correction that matters most in this section |
| Device floor (playable) | **Snapdragon 680 / Adreno 610** class | the bottom of what we will accept a session from at all |
| Device the look is art-directed for | **Samsung Galaxy A54 (Mali-G68 MP4)** class, at 30 fps | the realistic median of the mobile casino install base. It gets the full T1 feature set — see "the mid-range phone gets the look" below |
| First-load budget | **≤ 5 MB gzipped** to first playable frame, itemised below | operator lobby contracts; also the difference between a session and a bounce |
| Total round-trip | **≤ 16 MB** including all five arenas, streamed per arena | arenas 2–5 load during arena 1's replay |
| GPU memory | **≤ 96 MB** textures on T0, ≤ 180 MB on T1 | Adreno 610 devices with 3 GB RAM start evicting well below this |

**The runtime decision, stated without ambiguity.** The v1 draft said
"three.js-class custom WebGL2 renderer", and that phrase hid a schedule
difference of months: read one way it means writing volumetrics, upsampling,
skinning, LODs, a compressed-texture pipeline and probes from scratch; read the
other way "custom" is simply the wrong word. The decision is the second reading,
and here is the split:

| Layer | Provided by |
| --- | --- |
| Scene graph, math, transforms, culling, GPU skinning, glTF + KTX2/Basis loading, WebGL2 state management | **three.js**, tree-shaken to the parts we use |
| Render pipeline: pass order, render targets, the fog march, the upsample, tone mapping, keyed bloom, the tier ladder, the boot probe | **ours**, written against `WebGLRenderer` as custom materials and explicit targets |
| Replay driver, transcript playback, authored-clip selection, ragdoll hand-off, audio | **ours** |
| Runtime rigid-body physics | **none.** Falls are authored clips; the ragdoll is a small constrained solver of ours (~15 bodies) that runs only off-frustum (§6.9) |

That has a cost and we book it in three parts, because booking it in one is how
the cost gets understated: a tree-shaken three.js core (`WebGLRenderer`, math,
`SkinnedMesh`, our materials) is **~150 KB gzipped**; `GLTFLoader` and
`KTX2Loader` are **addons rather than core** and add ~35 KB; and KTX2 needs a
**Basis transcoder** — WASM plus glue, ~110 KB — which cannot be lazy because
nothing renders before the first texture. **~295 KB gzipped of engine**, all
three as separate line items in the first-load table below.

**What we are not building, cut from the v1 draft because they were a programme
and not a feature.** None of these changes the look brief in §6.1–6.5; they
change how much of it we write ourselves.

* **FSR-style upscale → a 5-tap sharpened Catmull-Rom upsample.** At 0.70–0.85
  render scale on a phone, the difference is not worth a bespoke upscaler.
* **SSAO on the default tier → removed.** T1 uses baked contact decals only,
  which is what §6.3's lighting model actually leans on. SSAO survives on T2,
  where there is room for it.
* **Two raymarched fog layers on the default tier → one**, 8 steps, quarter-res,
  blue-noise dithered, depth-aware bilateral upsample.
* **Per-arena reflection probes → one 64² irradiance probe per arena**, baked
  offline and shipped, not captured at runtime.

**Device class is not the same thing as quality tier.** This is the v1 defect
worth naming: it put an A13 iPhone and a Mali-G68 MP4 Android in one row and
asked both for 60 fps with volumetrics on. Those parts are not in the same
performance class in a browser, and the Android half of that row would have
failed its own acceptance harness on day one. Class sets the *frame target and
the render scale*; tier sets *which features exist*.

| Class | Reference parts | Tier | Frame target | Render scale |
| --- | --- | --- | --- | --- |
| **C0 Floor** | Snapdragon 680 / Adreno 610, 3 GB | T0 Emberlight | 30 fps locked | 0.60 |
| **C1 Median** | **Galaxy A54** (Mali-G68 MP4), Redmi Note 12 class | **T1 Understory** | **30 fps locked** | 0.70 |
| **C2 Fast** | **iPhone SE 2020** (A13) and later, Snapdragon 8-series, Pixel 7+ | T1 Understory | 60 fps, 45 floor | 0.85 |
| **C3 High** | A15 / M-series, desktop discrete | T2 Canopy | 60 fps | 1.00 |

**The mid-range phone gets the look.** That is the entire reason for splitting
class from tier. C1 runs the T1 feature set — the fog march, five per-pixel
lantern lights, stone translucency, the lantern probe — at 30 fps and 0.70
scale, instead of being demoted to T0 and losing the four things that make the
frame resemble the concept art. C1 is the class this game is art-directed for.

**And the size of that claim, stated exactly.** A frame target with no pixel
count, no draw-call ceiling and no overdraw bound is not a claim, it is a mood.
On C1 the budget is:

| Quantity | C1 budget | Why it is the one that bites |
| --- | --- | --- |
| Render target | 0.70 x 1080 x 2340 = **756 x 1638**, ~1.24 Mpx | fill rate, not triangles, is what a Mali-G68 MP4 runs out of |
| Fog march | quarter-res of that: 189 x 410, ~0.08 Mpx x 8 steps | ~0.62 M samples/frame, which is what makes one raymarched layer arguable at 30 fps and two not |
| Draw calls | **≤ 90** per frame, ≤ 20 of them skinned | the WebGL2 driver overhead on this class is a bigger risk than shader cost |
| Average overdraw | **≤ 1.8x** opaque, ≤ 2.4x including the transparent lantern and fog composite | the fog composite is a full-screen blend and it is where overdraw hides |
| Texture bandwidth | ≤ 40 MB/frame sampled | Mali tilers punish this before they punish arithmetic |

**We are not claiming this has been measured.** It has not: there is no
renderer, no asset set and no device trace behind any of it (§11). What we are
claiming is narrower and it is the thing the previous draft got wrong — that
*60 fps* for this feature set on this part was not a defensible number to write
down, and that 30 fps with these bounds is. Both remain budgets until the
performance harness exists, and the harness is what turns either into a fact.

**The stepped animation survives the split unchanged.** §6.4's secondary motion
is quantised in **time**, not in frames: a 1/12 s phase clock. At 60 Hz that
lands on every fifth frame; at 30 Hz it lands on a 2–3–2–3 frame pattern, which
is exactly what hand-drawn animation on twos and threes does. No tier and no
class changes the 12 Hz figure.

**Three tiers.** Selected by a 3-second boot probe (renderer string, max texture
units, a timed fill-rate test) which resolves a *class*, from which the tier
follows by the table above. Player-overridable in S9, and never silently changed
mid-round.

| | **T0 Emberlight** (fallback) | **T1 Understory** (default) | **T2 Canopy** (high) |
| --- | --- | --- | --- |
| Classes | C0 | C1 at 30 fps, C2 at 60 fps | C3 |
| Triangles on screen | ≤ 45 k | ≤ 120 k | ≤ 260 k |
| Kindling mesh | 3.5 k tris, 1 LOD, 22 bones | 8 k tris, 3 LODs, 34 bones | 14 k tris, 3 LODs, 42 bones |
| Texture atlases | 2 x 1024, ETC2 / ASTC 8x8 | 2 x 2048, ASTC 8x8 | 4 x 2048, ASTC 6x6 |
| Real-time shadows | none | none | 1 spot, 1024², cascade-free |
| Contact shadows | baked decals | baked decals | decals + half-res SSAO |
| Fog | exponential height fog + 3 scrolling cards + baked shaft sprites | **1 raymarched layer**, quarter-res, 8 steps, blue-noise dithered, depth-aware bilateral upsample; shafts from the nearest lantern only | 2 raymarched layers at half-res, 16 steps, shafts from up to 3 lanterns |
| Lantern lights | 2 nearest, vertex-lit | 5, per-pixel, unshadowed | 5, per-pixel, unshadowed |
| Lantern glass | fresnel rim + emissive core, no probe | + 64² baked per-arena probe | + 128² baked probe |
| Stone translucency | off | baked thickness, wrapped diffuse | baked thickness + fresnel warm tint |
| Ragdoll — an off-frustum *continuation*, never a visible fall (§6.9) | off — authored clips only | 1 concurrent, off-frustum only | 3 concurrent, off-frustum only |
| Post | tonemap only | tonemap + keyed bloom (lanterns only) + sharpened Catmull-Rom upsample | + subtle chromatic falloff at the frame border |

#### Per-frame budgets

Three rules govern these tables, and the third is the one v1 got wrong.

1. **They are sustained budgets, not cold ones.** Acceptance measures the **95th
   percentile frame time after a 10-minute soak** on a warm device, in a
   co-resident iframe, on battery — not the median of a first run on a cool
   phone. A budget that only holds cold is a budget that fails in a session.
2. **The rows are only the work our code is responsible for.** Everything the
   rows do not name — browser compositing, the operator's own lobby page in the
   same process, GC, OS scheduling, driver stalls, thermal drift — is paid out of
   headroom.
3. **The named passes may not exceed 75% of the frame period.** v1 budgeted
   16.0 ms of a 16.6 ms frame: 96.4%, 0.6 ms of slack, and a harness that would
   have failed on the reference device from the first build. Headroom is a line
   item with a floor, not the remainder after the interesting rows are filled in.

**T1 at 60 fps — device class C2 — frame period 16.67 ms.**

| Pass | Budget |
| --- | --- |
| Environment opaque | 3.0 ms |
| Skinned characters (5) | 2.6 ms |
| Fog, 1 layer at quarter-res | 1.4 ms |
| Lighting + contact decals | 1.2 ms |
| Post: tonemap, keyed bloom, upsample | 1.1 ms |
| UI | 0.9 ms |
| CPU: replay driver, animation, audio | 2.0 ms |
| **Named passes, total** | **12.2 ms** — 73.2% of the frame |
| **Reserved headroom** | **4.47 ms** — 26.8%, and a build may not spend it |

**T1 at 30 fps — device class C1, the Galaxy A54 row — frame period 33.33 ms.**

| Pass | Budget |
| --- | --- |
| Environment opaque | 5.6 ms |
| Skinned characters (5) | 4.8 ms |
| Fog, 1 layer at quarter-res | 3.0 ms |
| Lighting + contact decals | 2.4 ms |
| Post: tonemap, keyed bloom, upsample | 2.0 ms |
| UI | 1.4 ms |
| CPU: replay driver, animation, audio | 3.2 ms |
| **Named passes, total** | **22.4 ms** — 67.2% of the frame |
| **Reserved headroom** | **10.93 ms** — 32.8%, and a build may not spend it |

The rows are a serialised wall-clock envelope. CPU and GPU work overlap in
practice, so treating them as additive is conservative, which is the direction a
budget should err in.

#### First load, itemised

"≤ 5 MB gzipped" is only a budget if it has parts. To first playable frame:

| Item | gzipped |
| --- | --- |
| three.js core, tree-shaken: `WebGLRenderer`, math, `SkinnedMesh`, our material set | 150 KB |
| three.js addons: `GLTFLoader`, `KTX2Loader` — addons, not core, so booked separately | 35 KB |
| KTX2 / Basis transcoder, WASM + glue — needed *before* the first frame, so it is boot, not lazy | 110 KB |
| Our renderer, replay driver, lifecycle module, UI | 380 KB |
| Fonts: Latin subset + numerals, WOFF2 (§6.5) | 190 KB |
| Kindling mesh set, rig, authored clip library | 240 KB |
| Arena 1 geometry | 420 KB |
| Arena 1 **boot** textures — worst case, see below | 1,750 KB |
| Audio: boot bed, UI, arena 1 opening stem (Opus, mono 48 kbps / stereo 64 kbps) | 480 KB |
| Shaders, baked probe data, boot probe, manifest | 140 KB |
| **Total to first playable frame** | **3,895 KB** |
| **Reserve against the 5 MB ceiling** | **1,105 KB — 22.1%** |

**The texture line, worked, because it is the one that dominates and the one
that is easiest to get wrong.** ASTC 8x8 is 2 bits per texel; ETC2 RGB is 4 —
double. Writing "ASTC 8x8 / ETC2" as if they were one number, as the first
version of this table did, understates the fallback path by a factor of two
before mipmaps. Counted properly, with the full mip chain (+33%):

| Class | Format | Boot atlas set | Base | With the full mip chain |
| --- | --- | --- | --- | --- |
| C1–C3 | ASTC 8x8, 2 bpp | 1 x 2048 + 1 x 1024 | 1,311 KB | **1,748 KB** |
| C0 | ETC2 RGB, 4 bpp | 2 x 1024 (T0 never loads a 2048 atlas — see the tier table above) | 1,049 KB | **1,398 KB** |

So the ASTC row is the worst case and it is the one budgeted, at 1,750 KB. The
C0 path is smaller because T0's atlas ladder is smaller, not because ETC2 is
cheaper — it is not, and a build that ever shipped a 2048 ETC2 boot atlas would
blow this table by ~2.8 MB on its own.

**Units, since they are the other quiet factor.** KB in these tables is 1,000
bytes, everywhere, and every texture figure includes the mip chain (+33%). A
budget that mixes KiB with KB and omits mips understates itself by about 36% on
its largest line, which is the difference between a 5 MB ceiling and a 6 MB
one.

Compressed texture payloads do not usefully compress again, so they are counted
at their GPU size. The full-resolution atlas set and arenas 2–5 stream
afterwards — during S0, S1 and arena 1's replay, all of which take longer than
the transfer — inside the ≤ 16 MB round-trip budget.

**The engine lines are targets against a named artifact, not measurements.**
"Tree-shaken three.js" is only a number once a version and a bundle are pinned;
the build must publish `dist/stats.json` and CI must fail if any of the three
engine rows regresses past its budget. Until then, treat 295 KB of engine as the
line we are holding ourselves to and not as a fact we have established — the
addon and transcoder rows exist precisely because the first version of this
table quietly assumed loaders were part of core and that Basis was free.

**These are budgets, not measurements, and §11 says so.** There is no renderer,
no asset set and no device trace behind any figure in this section. What §11's
performance harness must enforce is the *shape* of the budget — the 75% rule, the
soak methodology, the class-to-target mapping — not merely each row, because a
build that meets every row on a cold device and drops frames after ten minutes
has met the table and failed the player.

**What degrades and what never does.** The tiers change *how* the look is
achieved. Three things are identical on every tier, because they are the product:

1. **The 90/10 value structure.** Warm light stays scarce and stays the only
   saturated colour, at every quality level.
2. **The stepped 12 fps secondary animation.** It is a character choice, not a
   performance mode, and T2 does not "upgrade" it to 60.
3. **Every number, every outcome, and every frame of the resolution.** The
   transcript decides; the renderer plays. A T0 device and a T2 device replaying
   the same transcript select the same authored fall clips and credit the same
   micro-credits (§6.9).

### 6.9 The presentation contract (client physics never decides money)

The renderer is a **player, not a judge**.

1. The server resolves the arena from the committed hazard table: the survivor
   set, and for each runner the lane, the slot, the cause (`collapse` or `slip`)
   and the **margin band** — see rule 4, where the margin comes from.
2. The client receives that resolution and *stages* it. **Every fall the camera
   can see is an authored clip.** Clips are selected by the committed data — the
   cause, the margin band and a flavour draw — not by free-running simulation, so
   the same transcript produces the same clip on every device and every tier.
   **Ragdoll is not a fall system.** It is a *continuation*: it may blend in only
   after the figure has left the camera frustum, where divergence cannot be
   observed and cannot matter, and it is disabled entirely on T0 with no visible
   difference inside the frame.
3. If the client's physics ever disagrees with the transcript, the transcript
   wins and the client is wrong. There is no path by which a frame drop, a
   thermal throttle, a quality tier, or a modified client changes a credit.
4. **We never author a near-miss that is not in the data.** If a runner cleared
   by a wide margin, the clip shows a wide margin. Manufacturing "so close!"
   moments is the oldest manipulation in this industry and we do not do it.

#### The margin is already in the committed table

Rule 4 is only dischargeable if the data has a margin in it, and it does. A slip
check is a rejection-sampled draw against a modulus (`ENGINE.md` §4): WIDE draws
`0..7` and clears on `< 7`, SPLIT draws `0..5` and clears on `< 5`, NARROW draws
`0..1` and clears on `< 1`. The **value** of a clearing draw is a committed,
revealed, re-derivable ordinal, so the margin band is a pure function of the
hazard table and needs no new data, no new draw and no client-side choice:

| Contract | Clearing draw values | Margin bands | What the player sees |
| --- | --- | --- | --- |
| WIDE | 7 (`0..6`) | 3 — `0–2` comfortable, `3–4` clean, `5–6` close | the full range |
| SPLIT | 5 (`0..4`) | 3 — `0–1`, `2–3`, `4` | the full range |
| NARROW | 1 (`0`) | **1** | every clear looks identical, because the data says nothing more |

That last row is not a gap to be filled. On The Reach the model has exactly one
way to clear, so authoring three flavours of "only just made it" would be
manufacturing a margin — rule 4 in the other direction. The single band is the
honest read, and it happens to suit the card that is about the drop rather than
the crossing.

A failing slip draw has one value in every contract (`7`, `5`, `1`), so **falls
have no margin resolution at all** and fall clips vary by cause, class and
flavour only. The `flavour` draw is a *presentation* draw under its own label,
derived from the same seed pair, re-derivable by the player at settlement and
deliberately **not** part of the hazard table — it cannot move money, and adding
it to the table would change the <!-- fig:hazardDraws -->120<!-- /fig -->-draw
figure `ENGINE.md` §4 publishes for something that decides nothing.

#### The clip library, bounded

The library is combinatorial only if a clip depends on the whole outcome. Ours
does not, and that is a hard authoring rule:

**Clips are per runner, never per outcome.** A five-body collapse on The Reach —
`c = 1/2`, so <!-- fig:narrowWipe5 -->51.56%<!-- /fig --> of NARROW arenas at five
runners, all of it inside a 24 mm handheld frame (§6.4) — is five instances of one
per-runner collapse clip, triggered with the slot's own root offset and a phase
offset from the flavour draw. Slot position is therefore a **transform**, not a
clip axis, which is what keeps the count linear. Two rules make that composition
safe: no fall clip may reference another figure's position, and falling figures
never interact — no contact, no collision, no simulation between them.

| Family | Axes | Clips |
| --- | --- | --- |
| Locomotion | 4 lane classes (broad bough, fork broad limb, fork thin limb, the reach) x 2 (travel, brace) | 8 |
| Idle | mouth of branch, shelter door, crown | 3 |
| Clear / arrival | per lane class x its own margin bands (3 + 3 + 3 + 1) | 10 |
| Fall — slip | 4 lane classes x 2 flavours | 8 |
| Fall — collapse | 4 lane classes x 2 flavours | 8 |
| **Fall — hero (The Last Lamp)** | 5 arenas x 1, camera-tracked, full descent | 5 |
| Shelter | enter the door, door closes, interior settle | 3 |
| Squad reaction | a neighbour goes; the last one alone | 2 |
| Crown arrival | 1 | 1 |
| **Total authored clips** | | **48** |

48 clips at 34 bones, retargeted across 3 LODs, plus the per-slot transforms.
§11 books the hours. A build that needs a 49th clip needs a §11 revision, which
is the point of publishing the number: a library with no count is a library that
grows until the schedule notices.

#### The Last Lamp does not use ragdoll, and that is the rule working

§9's signature shot keeps the falling lantern in frame all the way down: *"We
stay with it, not with the branch, all the way down until the glass gives out and
the light goes."* The figure never leaves the frustum, so by rule 2 the entire
descent must be authored — and it is: one **hero fall clip per arena**, 3.5–4.5 s,
camera-tracked against that arena's own silhouette and fog, the most expensive
animation asset in the game.

Earlier drafts left this as a contradiction — a ragdoll rule that fired only
off-frustum beside a signature shot that never leaves frame — and the resolution
is not an exemption for §9. It is that ragdoll was never the fall system. The
ragdoll line is simply not exercised in the one shot that matters, exactly as a
rule that says *nothing simulated is ever visible* implies. Ragdoll's whole job is
to keep a figure moving plausibly in the four seconds after the camera has stopped
caring, on one tier, one body at a time.

---

## 7. Sound direction

Sound carries state. A blindfolded player should know how many Kindlings are
alive.

- **Bed.** Wind through hollow wood (recorded through a cardboard tube for the
  hollow formant), a 38 Hz sub drone for the void below, distant stone creak. The
  sub gets 2 dB louder every arena. Nobody notices; everybody feels it.
- **The squad rhythm — the core idea.** Every Kindling contributes a reed-creak
  footfall, a cloth rustle, and a small glass *tink* from its lantern, each at a
  slightly different pitch and phase. Five runners make a busy, warm, slightly
  ragged rhythm. Three runners make a thinner one. One runner is a single
  footstep in a large empty space. **You hear your squad shrink.**
- **The fork.** On a Split the mix splits with it: the broad limb stays centred,
  the thin limb pans hard and loses its low end, as if heard across a gap. On a
  4+1 the single runner is almost mono and almost dry, and it is the most exposed
  sound in the game short of the last lantern.
- **Lane collapse.** Not an explosion. A long, dry, splintering crack with a
  1.2 s tail, then a hole in the mix.
- **A lantern going out.** A small glass *pop*, plus a 120 ms high-shelf cut
  across the entire mix — as if the world briefly lost a frequency band. It is
  uncomfortable by design and it is over fast.
- **The last lantern going out.** Every warm layer is removed at once. Wind at
  −18 dB, alone, for 1.8 seconds. No sting, no music, no UI sound. Silence is the
  loudest thing in the game and we spend it exactly once per losing round.
- **Banking.** Brass door mechanism, one struck bell with a 0.9 s decay — a bell,
  not a jackpot chime. Each previously saved lantern adds a tone; the Lamp House
  chord thickens as the run goes on. Banking four Kindlings sounds like a chord
  resolving.
- **Music.** Sparse, 68 BPM, prepared strings and plucked metal. One voice is
  added per arena survived. It never accelerates and never modulates upward.
  Tempo-driven urgency pressures decisions, and we do not pressure decisions.
- **Budget.** ≤ 1.6 MB Opus at 48 kbps mono for all bed and one-shots; the squad
  rhythm is five short samples pitch- and phase-shifted at runtime rather than
  five recorded stems.
- **Never:** crowd cheering, hype VO, rising-pitch riser under a decision,
  coin-cascade, "big win" fanfare over a sub-stake return.
- **Full parity with audio off.** Every state — squad size, claim, route odds,
  outcome — is readable visually. Sound is enrichment, never information the
  player can only get by listening.

---

## 8. Fairness, as the player experiences it

### 8.1 Two seeds, and why the player has one

Before the round exists for the player, the operator publishes a hash of its own
seed. Then the player's device generates a **client seed** locally, shows it, and
lets the player change it to anything they like. Only once both halves are fixed
is the round's hazard table derived — from both.

The reason is worth stating plainly in the product, because it is the difference
between a fairness feature and a fairness *guarantee*: if the operator alone
picked the seed, it could quietly draw many candidate seeds, keep the one that
paid the player least, and publish a commitment to that one. Every such round
would still verify perfectly. Mixing in a seed the operator cannot see when it
commits is what makes that attack impossible rather than merely detectable.

In-product copy, on S1 and S8: *"The server sealed its half before it ever saw
yours. Change yours to anything — that is what makes the seal mean something."*

### 8.2 The Ghost Line

Because the committed table covers routes the player did not take, the game can
show what would have happened on the road not travelled — provably fixed in
advance, not invented afterwards. That makes it a genuine proof artefact. It is
also, obviously, a regret engine, which is why §10.4 puts hard limits on it.

---

## 9. The signature moment: **The Last Lamp**

*The clip that gets shared.*

Setup: four Kindlings are gone. One is left. The player has a real claim on the
table and has chosen to run anyway — or has chosen to bank, which is its own
version of the moment.

**If they run.** The music drops out entirely. The camera cuts to 24 mm, close
behind the last Kindling, handheld, low. The mix is wind, one set of reed
footfalls, and one lantern *tink* per step — the loneliest sound in the game. The
branch narrows into fog ahead. There is no HUD except the claim, dimmed to 40%.

- **They make it.** The Crown Lamp or the next Lamp House door resolves out of
  the fog, and the frame goes warm for the first time in fifteen seconds. The
  claim number lands. One bell.
- **They don't.** The lantern tumbles. We stay with it, not with the branch, all
  the way down until the glass gives out and the light goes. Two seconds of
  empty fog. Then the round summary, quietly.

**If they bank the last one.** The Lamp House door opens, the single lantern goes
in, the door closes, and the light comes through the door's grille from inside —
safe, and visibly still burning. Copy: *"Wren came home."* This is the rescue
feeling the entire game is built to deliver, and it is deliberately given the same
production value as the biggest win.

**The variant that only exists because of the fork.** Send four Kindlings down
the broad limb and one down the thin one, and the thin limb is a Last Lamp beat
that can happen at *any* squad size — one named figure alone in frame while four
others run somewhere the camera is not. It happens roughly
<!-- fig:scoutSole5 -->7.90%<!-- /fig --> of the time on a full squad at 4+1
against <!-- fig:balancedSole5 -->3.39%<!-- /fig --> at 3+2. The player chose to
create that possibility, which is what makes it land.

**Clip export.** After any round containing a Last Lamp beat, S7 offers
`Save the clip` — a 6-second 1080x1920 H.264 export, pre-trimmed to the beat,
watermarked with the round id and a short verification code. No score overlay, no
"I WON" sticker, no auto-generated hype caption. The clip is the moment; the
verification code is the proof that it really happened that way.

**And the thing the export actually is, named.** A player-shared clip of a
gambling product is **marketing material**, whatever we call it in the menu. In
the UK it falls under the CAP Code and the ASA's rulings on gambling advertising
— including the rules on content likely to appeal to under-18s, on age-gating
where a platform allows it, and on not portraying gambling as a way to solve
anything — and comparable regimes apply elsewhere. §10 is otherwise exhaustive on
responsible design and said nothing about the one artefact this product asks
players to distribute, which is the gap this paragraph closes. See §10.7 for the
requirements; they are build requirements, not a caveat.

---

## 10. The emotional hook, and responsible design

### 10.1 The hook

- **Named, dressed, persistent.** Five Kindlings the player names and re-dresses.
  Defaults: Wren, Bramble, Ora, Tuck, Sable. A per-Kindling counter of runs come
  home. Cosmetic only, stated plainly, every time.
- **The squad shrinks audibly and visibly.** Losses are not a number going down;
  they are a rhythm thinning and a frame getting colder.
- **Individuals are named at the moment of loss.** *"Bramble did not make it."*
  Not "1 runner eliminated".
- **You choose who takes the thin limb.** The fork picker is the strongest
  attachment mechanic in the game precisely because it costs nothing
  mathematically and everything emotionally.
- **Banking is a rescue, not a cash-out.** The verb in the UI is *bring home*.
  The animation is a door and a bell, not a coin counter.
- **No permadeath and nothing to buy back.** Every Kindling is on the shelf again
  at the start of the next run. Permanent loss plus a purchasable revival is a
  loss-aversion trap, and it is exactly the mechanic our theme would make most
  effective — which is precisely why we are not building it. Optionally, a
  purely cosmetic "scar" (a mended patch, a re-blown lantern) can be enabled by
  the player in settings. It is off by default and it costs nothing.

### 10.2 No loss-chasing mechanics

These are build requirements, not aspirations. Each has an acceptance check.

- No double-or-nothing, no "recover your loss" offer, no re-buy-at-a-discount.
- No auto-rebet, no auto-play, no one-tap replay from the wipe screen. The wipe
  screen's primary action leads *away* from the stake field.
- `Run again` appears only after 2 s and never pre-fills the previous stake.
- All promotional surfaces — bonuses, offers, free rounds — are suppressed for
  60 s after any losing round, and never appear on S6 at all.
- Session strip (time played, net position) is always visible and never
  dismissible. A reality check fires at the operator's interval, default 30 min,
  and pauses the game.
- Side-bet stakes are capped at **half** the route stake, per bet and per round,
  and reset to zero every arena (§4), so a player cannot drift into betting the
  long shot instead of the game: the run always carries at least twice the money
  of every side bet in the round put together. **Acceptance check, and it is a
  real one:** no configuration a player can legally build is more volatile than
  the most volatile route ticket. `MATH.md` §5.5 publishes both standard
  deviations and `tools/enumerate.mjs` asserts the inequality over every
  enumerated portfolio, because at the v2 parity limit this bullet was false and
  the document's own §7.1 table said so.

### 10.3 No misleading skill framing

- **Banned vocabulary:** *strategy, strategic, skill, outplay, beat the odds,
  master, edge, system, pro.* The words in use are *choose*, *shape*, *risk*.
- **Scope: every surface a player reads.** In-client copy, store listings,
  marketing, and this repository's `README.md`. It does **not** apply to
  `docs/MATH.md` and `docs/ENGINE.md`, which are engineering documents written
  for engineers and reviewers and which need the vocabulary of decision theory to
  say true things. `tests/copy-discipline.test.mjs` greps the player-facing set
  and fails the build on a hit; the engineering documents are exempted in that
  test **by name**, so the exemption is visible rather than accidental.
- **In-client copy lives in this document, so the guard reads this document.**
  There is no client yet: every player-facing string that exists today is a
  quoted `*"…"*` line in `DESIGN.md` — §3, §4, §5's screens, and the copy sheet
  in §5.2.6. The test extracts those strings and applies the ban to them
  individually, while leaving the surrounding engineering prose exempt. Without
  that, the one place player copy actually lives would be the one place the rule
  did not reach, and a phrase like `master the fork` could ship inside an S2
  string with a green build. The extraction is anchored on the quoting
  convention, and the test asserts a floor on how many strings it found, so
  deleting the convention fails the build rather than silently disabling the
  guard. The convention itself is enforced too — no curly quotes and no
  character entities anywhere in this document — because either one would render
  as ordinary copy while being invisible to the grep.
- **And the limit of the guard, recorded rather than implied.** The test binds
  this repository. Copy that will eventually live in client source, store
  listings and marketing is bound by *rule* and not by *test*, because it does
  not exist yet. When the client does exist its string catalogue joins the
  scanned set on the same terms; a client carrying copy the guard cannot read
  has moved the rule out of reach, and that is a review finding rather than a
  technicality. The per-string form matters as much as the scope: the ban is
  decided inside each string, so an adjacent *"no skill"* can never license a
  different string's use of the word.
- **Two exceptions, and only two**, both encoded in the test rather than left to
  judgement: the phrase *"no skill"* (an explicit denial, which is the thing we
  want said) and the technical term *"house edge"*. Any other appearance of a
  banned word on a player-facing surface fails the build.
- The route screen permanently states that every route returns
  <!-- fig:rtpPct -->95.5%<!-- /fig -->.
- Full exact odds are reachable in two taps from any route card.
- No "recommended" route, no personalised route ordering, no highlighting of the
  bigger multiplier, no leaderboards ranked by return.
- Route copy is balanced by construction: no card may state an advantage without
  stating the matching disadvantage on the same face (§3.1).
- The Kindlings' animations never suggest effort or reward for the player's
  choice — a runner who clears a Narrow lane does not look *better* at running
  than one who clears Wide.

### 10.4 No latency-sensitive money decisions, and a floor on speed

- No countdown on any decision. Ever. Rounds persist across app termination.
- The outcome is committed before the first choice, so input timing is
  mechanically incapable of changing a payout.
- A minimum game cycle of <!-- fig:minCycleMs -->5000<!-- /fig --> ms per arena
  (<!-- fig:rtsStandard -->UKGC RTS<!-- /fig -->
  <!-- fig:rtsEdition -->RTS 2021-10-31<!-- /fig -->,
  <!-- fig:rtsProvision -->RTS 14G<!-- /fig -->, non-slot), enforced server-side
  (§5.1). Both the classification of the cycle unit and the provision citation
  are stated as declared positions with an edition pinned, not as settled facts,
  and neither has been verified against a certified copy.
- `skip` is explicitly labelled as skipping the *view*, not the result, and does
  not shorten the game cycle.

### 10.5 Honest presentation of money

- Every return is stated relative to the stake. A 0.76x bank says so.
- No win presentation over a net loss. No "YOU WON 3,820" on a 5,000 stake.
- Side-bet money is reported separately from the run at every step, so a winning
  side bet never disguises a losing round.
- No near-miss manufacturing (§6.9 rule 4).
- Micro-credit precision means the displayed number is the number credited.

### 10.6 Regret management for the Ghost Line

The Ghost Line — the counterfactual replay of the route the player *didn't*
take — is a genuine fairness feature: it proves the unchosen branches were fixed
in advance. So:

- it lives in the verification screen (S8), never in the game flow;
- it is **off by default** and opt-in per player;
- it is unavailable for 60 s after a losing round;
- it shows *who fell and where*, never a counterfactual money figure. The
  player never sees "you would have won 214.80". That single restriction keeps
  the fairness value and removes most of the regret hook;
- it covers unchosen **contracts** and unchosen **fork balances** alike, because
  the committed table covers both.

### 10.7 The clip export is an advertising surface

§9's `Save the clip` hands a player a produced, watermarked video of a gambling
product and invites them to post it. That artefact is advertising material the
moment it leaves the device, and by construction it is the game's **peak dramatic
moment** — the spec chose the beat for exactly that reason. Naming that is the
first requirement; the rest follow from it.

- **It is marketing, and it goes through marketing compliance.** In the UK that
  means the CAP Code and the ASA's gambling rulings apply to it; comparable
  advertising regimes apply elsewhere. The export is reviewed under the
  operator's advertising-compliance process for each jurisdiction before the
  feature is enabled there, on the same footing as a paid creative. Where player-generated gambling content cannot be made compliant in a
  market, the feature ships **off** in that market. This is a per-jurisdiction
  switch, not a global one.
- **Content rules, applied to the artefact itself.** Nothing in the export may
  have strong appeal to under-18s — which is a live question for a game whose
  characters are hand-made figures with lanterns, and the answer is not "they are
  not cartoons". The Kindlings' silhouette language, the palette and the register
  (§1, §6) are part of the compliance review, not exempt from it because they are
  art direction.
- **It carries an age mark and a safer-gambling reference, and no money.** The
  watermark is the round id, the verification code, the game name, an 18+ mark
  and the operator's safer-gambling URL. It never carries a stake, a claim, a
  multiplier, a balance or a result figure — §10.5's rule that money is always
  stated against the stake cannot survive a 6-second clip, so money is not in the
  clip at all.
- **Both endings export.** The offer appears after any round containing a Last
  Lamp beat, won or lost, and the losing export is not degraded, delayed or
  hidden. A share feature that only fires on wins is a highlight reel of a
  distribution that does not exist — the same objection §5.2.3 makes to a
  rehearsal that pays.
- **No incentive, ever.** No bonus, no free round, no cosmetic, no progress and no
  in-game acknowledgement for exporting or sharing. The moment sharing is paid
  for, the player is an affiliate and the clip is an ad they were not told they
  were making.
- **Off by default, one tap to disable permanently**, and never re-prompted.

**What this repository does not do:** the compliance review itself, the
jurisdictional analysis, or the age-appeal assessment. Those are §12 work. What is
in scope here is refusing to ship a distribution surface whose regulatory status
was never written down.

### 10.8 Accessibility

- Full parity with audio off (§7) and with reduced motion (stepped animation and
  handheld camera noise both disable; the transcript readout remains).
- Colour is never the sole carrier of state: alive/lost is also glyph and text.
- Minimum 15 pt text, one-handed reach for all primary actions, 44 pt targets.
- Screen-reader labels state the exact odds of the focused route card, and the
  fork control announces both balances' numbers rather than a position on a
  slider.
- The quality tier is player-overridable (§6.8) so a device that runs hot is a
  settings problem, never a playability one.

---

## 11. Production notes

- **Arena construction:** five 60 m splines, modular fossil segments, dressed per
  §6.7. Fork geometry is hand-authored per arena — never procedural — because the
  fork is a decision surface and has to read correctly at a glance.
- **Streaming:** arena 1 ships in the boot bundle; arenas 2–5 stream during
  arena 1's replay. A player who banks after arena 1 never downloads them.
- **Localisation:** all money strings tabular and RTL-safe; route names are
  translated but stay ALL CAPS with equal weight. The banned-vocabulary list
  (§10.3) is maintained per locale, not machine-translated.

### 11.1 Asset inventory

Everything else in this document is itemised to the byte and the millisecond, and
§6.8 splits the engine bundle into three line items specifically because "booking
it in one is how the cost gets understated". The art was the one budget with no
number in it, which for a brief that asks whether a small team can ship this is
the binding one. Here it is, on the same terms: **estimates, not measurements**,
and the estimating method is stated so the numbers can be argued with.

**Geometry.** Triangle figures are the T1 authoring target; T0 and T2 are derived
by the LOD ladder in §6.8, not authored separately.

| Asset | Unit budget | Units | Notes |
| --- | --- | --- | --- |
| Fossil module kit (shared) | 1.5–3.0 k tris | 14 modules | straight, rise, taper, narrow, fracture, junction, buttress, terminus + variants |
| Per-arena module variants | +6 reskinned modules | 5 arenas | wear direction, moisture, char and pallor passes per §6.7 |
| Fork assembly — hand-built, never procedural | ~9 k tris | 5 arenas | broad limb, thin limb, the landmark that separates them |
| Dressing props | 0.4–1.4 k tris | 12 per arena, 60 total | vine cable, burl, splinter, root ledge, grit drift, ember vent |
| Lamp House | ~7 k tris | 1 + 5 dressings | exterior, interior, door, bell, brass |
| Crown Lamp | ~5 k tris | 1 | the only object visible from the first frame of arena 5 |
| Kindling | 8 k tris, 3 LODs, 34 bones | 1 base | §6.8's row, unchanged |
| Cosmetics | 0.1–0.6 k tris | 19 | 5 lantern glasses, 6 cloths, 8 charms |

**What that puts on screen at once, against §6.8's 120 k T1 ceiling:**

| In frame, T1 | Triangles |
| --- | --- |
| 5 Kindlings at 8 k | 40,000 |
| 18 visible fossil modules, LOD-mixed, average 2.4 k | 43,200 |
| Fork assembly, arena-unique | 9,000 |
| Dressing props in view, ~14 at 900 | 12,600 |
| Lamp House or Crown Lamp, when in view | 7,000 |
| Fog cards, contact decals, world-space UI | 2,000 |
| **Total** | **113,800** of 120,000 — 5.2% spare |

**Textures**, counted the way §6.8 counts them: ASTC 8x8 at 2 bpp, KB = 1,000
bytes, every figure including the full mip chain (+33%).

| Set | Atlases | With mips |
| --- | --- | --- |
| Per arena | 1 x 2048 + 1 x 1024 | 1,748 KB |
| Five arenas | | 8,740 KB |
| Character set (Kindling, cosmetics, lantern) | 1 x 2048 | 1,398 KB |
| **Total texture payload** | | **10,138 KB** |

**And the ≤ 16 MB round trip, itemised** — §6.8 declares that ceiling and never
broke it down, which is the same defect the first-load table was written to fix:

| Item | KB |
| --- | --- |
| Engine: three.js core + addons + Basis transcoder (§6.8) | 295 |
| Our renderer, replay driver, lifecycle module, UI | 380 |
| Fonts, WOFF2, full ranges | 190 |
| Kindling mesh set, rig, 48-clip library | 240 |
| Arena geometry, 5 x 420 | 2,100 |
| Textures, full set with mips | 10,138 |
| Audio, Opus, all beds and one-shots (§7) | 1,600 |
| Shaders, baked probes, manifest | 140 |
| **Total round trip** | **15,083** |
| **Reserve against the 16 MB ceiling** | **917 — 5.7%** |

**Animation.** 48 authored clips, enumerated and bounded in §6.9. The count is a
budget line, not a description: a 49th clip is a §11 revision.

### 11.2 Art hours, headcount and schedule

Estimated bottom-up per work package, at an authoring rate a mid-weight artist
holds on a stylised, hand-made target with a fixed palette and three material
families. **Rate assumption: 30 productive hours per person-week**, not 40 —
booking 40 is how an art schedule slips by a quarter without anyone changing an
estimate.

| Work package | Unit | Units | Hours |
| --- | --- | --- | --- |
| Style frames and look-dev, 2 iterations | 40 h | 3 | 120 |
| Kindling: sculpt, retopo, UV, 3 LODs | | 1 | 90 |
| Kindling: rig, 34 bones, skinning, reed/cloth setup | | 1 | 70 |
| Kindling: 5 material families to look-dev | 16 h | 5 | 80 |
| Cosmetics: glasses, cloths, charms | 4 h | 19 | 76 |
| Fossil module kit | 8 h | 14 | 112 |
| Per-arena module variants and wear passes | 30 h | 5 | 150 |
| Fork assemblies, hand-built | 26 h | 5 | 130 |
| Dressing props | 3 h | 60 | 180 |
| Arena assembly: spline layout, camera paths, blockout to final | 24 h | 5 | 120 |
| Lighting pass and hand-placed bounce | 16 h | 5 | 80 |
| Fog authoring and per-arena behaviour | 12 h | 5 | 60 |
| Lamp House: exterior, interior, door, bell | | 1 | 60 |
| Crown Lamp | | 1 | 30 |
| Texture atlas authoring and packing | 20 h | 6 sets | 120 |
| Baked maps: thickness, cavity, contact decals, probes | 10 h | 5 | 50 |
| Animation: 43 standard clips | 5 h | 43 | 215 |
| Animation: 5 hero Last Lamp descents, camera-tracked | 18 h | 5 | 90 |
| Ragdoll joint limits and blend-out tuning | | 1 | 40 |
| UI art: route cards, claim meter, distribution bars, iconography | | 1 | 120 |
| Verification screen, cold family (§6.1) | | 1 | 30 |
| Tier and LOD passes, integration, optimisation | | | 160 |
| **Subtotal** | | | **2,183** |
| **Revision and contingency, 20%** | | | **437** |
| **Total art hours** | | | **2,620** |

**Headcount and calendar.** 2,620 hours at 30 h/person-week is **87 person-weeks
of art**, which at **3.5 art FTE** — art director / environment lead, environment
artist, character-and-technical artist, half an animator ramping to full — is
**25 weeks**.

| Phase | Weeks | What lands |
| --- | --- | --- |
| Pre-production | 1–5 | style frames, Kindling to look-dev, module kit, arena 1 blockout |
| Vertical slice | 6–10 | LOWBRANCH complete at T1, one hero descent, the first real device trace |
| Arenas 2–3 | 11–17 | THE GRAIN, WINDROW |
| Arenas 4–5 | 18–23 | THE CHAR, CROWN |
| Tier passes and polish | 24–25 | T0/T2 ladders, atlas repack, soak profiling |

**The vertical slice is a gate, not a milestone.** Every figure in §6.8 is a
budget with no renderer behind it; arenas 2–5 must not start until arena 1 has
been measured on a Galaxy A54 under the §11 performance harness. Starting five
arenas against an unmeasured budget is how a 25-week schedule becomes a 40-week
one.

**The binding number is per-arena work, not total work.** Module variants, fork,
dressing, assembly, lighting and fog come to 720 hours across the five arenas —
**144 hours, or roughly five person-weeks, per arena.** That is the figure to
argue with, and it is the figure that decides whether this ships.

**What can be cut, and what cannot.**

| Lever | Saving | What it costs |
| --- | --- | --- |
| Flavour variants 2 → 1 (§6.9) | 8 clips, ~40 h | a player sees the same fall twice in a round |
| Cosmetics 19 → 8 | ~44 h | less attachment, which is the hook in §10.1 |
| Dressing props 12 → 8 per arena | ~60 h | arenas read as a kit rather than as places |
| Hero descents 5 → 2, re-dressed | ~54 h | the signature moment repeats, and §9 is the shared clip |
| **Arena count 5 → 3** | ~460 h with contingency | **not an art lever.** `arenas` is a fingerprinted model constant: the cap becomes `4^3`, every figure in `MATH.md` §7 and §9 is re-derived, and the adapter version changes. Art may not cut it |
| **Squad size 5 → 4** | ~0 h in art | same: it is the whole paytable |

That last pair is the reason this section is in the design document rather than in
a schedule spreadsheet. Two of the most obvious ways to make an art budget fit are
changes to the mathematics, and neither is available to the people holding the
art budget.

**What these hours do not include:** engineering (client, renderer, lifecycle
module, RGS integration), audio production (§7's budget is separate and is
contract work), UI implementation as opposed to UI art, localisation, marketing
and store art, QA, and the comprehension testing in §5.2.8.
**Harnesses the client build must have.** These do not exist yet, because the
client does not exist yet; they are acceptance criteria for it, not descriptions
of this repository's CI:

- **Determinism harness:** replay the frozen fixture transcript through the
  presentation layer on every quality tier and assert the same authored clips are
  selected and the same credits are produced.
- **Performance harness:** run each reference device class and fail the build on
  any pass exceeding its §6.8 budget — measured as the **95th-percentile frame
  after a 10-minute soak**, warm, in a co-resident iframe, not as a cold median.
  It also enforces the *shape* rules independently of the rows: named passes
  ≤ 75% of the frame period, headroom never spent, and each class held to its own
  frame target (C0/C1 at 30 fps, C2/C3 at 60 fps) rather than to a single global
  number. Until this harness exists, every figure in §6.8 is a *budget* — a
  target the build is held to — and not a measurement. There is no renderer, no
  asset set and no device trace behind them.
- **Comprehension harness:** the four-question test in §5.2.8, run on eight or
  more unmoderated first-time testers per significant change to S2 or to the
  rehearsal. Q2 and Q4 are release gates: a build where fewer than 7 of 8 testers
  know that Wide and Narrow return the same amount has broken the product's
  thesis, and a build where fewer than 7 of 8 know that a WIDE arena needs the
  whole squad back before the claim grows has shipped a route card that lies by
  omission — whatever else either build has achieved.

**What does not ship without the math:** the route cards and the fork control
read their numbers from the same tables `tools/enumerate.mjs` publishes. If the
enumerator and the card disagree, the build fails.

**What `npm run docs:check` does and does not bind.** It binds every number in
this document that the *model* computes — probabilities, multipliers, wipe rates,
cap figures, the game-cycle floor — as generated slots. It does not bind the
design budgets in §6.8 (download size, triangle counts, millisecond budgets) or
the sound and layout figures, because nothing computes those: they are decisions.
Where a number here is a decision rather than a derivation, it is not in a slot,
and the absence of a slot is the signal.

---

## 12. Certification boundary

This is a product specification. It is **not** a fairness certificate, an RNG
certificate, a mathematical certification, regulatory approval, or evidence that
any deployed build behaves as described. Every responsible-design requirement in
§10 is a build requirement with an acceptance check, not a compliance
attestation; jurisdictional review, operator integration audit and any required
laboratory process are separate work this repository does not do.

---

## 13. Related documents

- [`MATH.md`](./MATH.md) — the exact probability model, paytable and proofs.
- [`ENGINE.md`](./ENGINE.md) — the Reveal Engine `staged-survival` lifecycle
  module and the adapter surface this game consumes.
- [`../README.md`](../README.md) — what the game is, in thirty seconds.
