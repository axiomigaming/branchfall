# ADR-001 — What "numbers never below 15 pt" applies to

**Status** accepted, graybox closure round 3
**Scope** the graybox client only. `docs/DESIGN.md` is normative and unchanged.

## The rule being interpreted

`DESIGN.md` §6.5:

> Minimum sizes: 15 pt body, 13 pt secondary, 28 pt for the claim figure. Numbers
> never below 15 pt.

The first sentence establishes a 13 pt secondary tier. The last sentence, read as
covering every glyph that happens to be a digit, deletes that tier: almost every
secondary string in this product mentions a figure — *"Returns 95.5%, like every
route."*, *"Bring one home and 0.955 stops running."*, *"You staked 5.00."* are
all §5 copy for secondary captions. Two sentences of the same paragraph cannot
both hold under that reading.

## Decision

The floor applies to a **figure presented as a figure**: text whose job is to
state a quantity — money, a probability, a multiplier, a claim, a counter, a lane
balance. Those are at or above 15 px, always, and they are never what gives way
when a row is tight.

The floor does **not** apply to secondary prose, or to a chart or axis label that
mentions a quantity inside a sentence. Those stay on the 13 px secondary tier
§6.5 declares, and this is the reading behind every 13 px rule in
`client/public/styles.css`.

Two consequences worth naming, because they are why this is a file rather than a
one-line comment:

- **A figure never hides inside secondary prose to escape the floor.** If a
  number is what the player is there to read, it gets its own element and the
  numeral token. That is why `stake 5.00 / claim opens at 4.775` above
  `Buy the run` and the fork-balance column headings `3 + 2` and `4 + 1` were
  raised to 15 px in this round, alongside the arena counter `3 / 5` that the
  round-2 review found at 13 px, and why the session clock became `session` at
  13 px around a `12m` at 15 px rather than one 15 px string. Every one of them is
  a standalone readout of a quantity, which is the test — not whether the element
  is chrome, a heading or a footer. The clock is also the case where the rule and
  the layout agree: the strip's four items have 358 px to share, and at the worst
  content they will ever hold — `session 120m` beside a four-figure balance and a
  four-figure net — the split leaves 2.5 px spare, while bringing the word up to
  15 px with the figure costs 6.4 px and ends 3.9 px short. Measured in the
  browser at 390 x 844; at ordinary balances either version fits with about 30 px
  to spare, so the reason to split is §6.5, and the extreme is what would have
  punished getting it wrong.
- **Identifiers are not quantities.** A 64-character hex seed, a commitment, a
  round id, a digest and a version number are strings that happen to contain
  digits. Nobody reads a magnitude off one, and setting them at the numeral floor
  makes the verification screen wider without making any of them more legible.
  They stay on the secondary tier, in the mono family.

## What is at 13 px today with a digit in it

Every one of these is prose or a label under the reading above, measured on the
live client at 390 x 844:

| Where | Text |
| --- | --- |
| session strip | the words `session`, `balance` and `net`; the three figures beside them are 15 px |
| S1 buy notes | *"Buying this run debits 5.00 and opens a round…"*, and the expiry note |
| S1 footer | `branchfall 3.0.0 · engine staged-survival 1.0.0 · free play, no real money` — version numbers, which are identifiers |
| S2 claim meter caption | `claim · 5 still running` |
| S2 distribution caption and legend | `survivors, 5 running · ▲ the claim grows`, `All 5 make it` |
| S2 route cards | *"Returns 95.5%, like every route."*, the shelter head note |
| S5 and S6 | *"Home with 6.85 in total — that's 1.3701x the 5.00 you staked."*, *"You staked 5.00."* |
| S8 | hashes, seeds and round ids |

Nothing in the client is below 13 px except the break-even tick glyph `▲` on the
distribution chart, which carries no text and is declared as the one exception in
`tests/type-floor.test.mjs`.

## How this is enforced

- `client/public/styles.css` sets no size *below* a floor: every `font-size` is one
  of the four floor tokens or a raw px value at or above the 15 px body floor. The
  raw ones are the three heading levels (26/19/16 px), `.route-name` and `.btn` at
  16 px, `.multiplier` at 20 px and the `.stepper` glyphs at 20 px — all above the
  body floor, none of them below a figure's. The 8 px tick glyph below is the
  single declared exception.
- `.money` and `.num` share one declaration and carry the numeral floor with them,
  so every figure that uses the convention is covered by construction: `.money`
  for a sum of credits, `.num` for any other figure — today, the session clock.
- `tests/type-floor.test.mjs` asserts the token values, that no rule reaches for a
  raw size below the body floor, and that each figure-bearing element **outside**
  that convention — `.badge`, `.footer .status`, `.compare-table th` and `td`,
  `.draw-row .money` — resolves to the numeral token. That list is the part a
  stylesheet-level scan cannot infer, so it is maintained by hand, and this file
  says what belongs on it.

What is **not** enforced by a test in this repo: the live DOM. The table above was
measured by hand in a browser at 390 x 844, and the repo has no headless-browser
check to re-measure it — a rule that is legal in the stylesheet and wrong for the
string it lands on is caught by the list above, which is a list, or by review. That
is the honest limit of this enforcement, and it is how both rounds of this defect
were found.

## Alternatives considered

**Raise every element containing a digit to 15 px.** Rejected: it removes the
secondary tier for most of the copy that has one, it grows the S2 card stack past
the single unscrolled viewport the round-2 review confirmed, and it makes no
figure easier to read: every figure the player reads as a figure is already at or
above the floor, and the one the whole screen is built around — the claim — is at
28 px.

**Give the counter a per-content variant** (`.badge.count` when the string holds a
digit). Rejected: it decides a type floor at the call site, which is where the
floor was lost in the first place.
