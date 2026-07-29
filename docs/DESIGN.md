# BRANCHFALL — product design specification

**Status:** free-play prototype. No real money. Engineering and design standard is real-money grade.

> Five small figures with lanterns for hearts cross five collapsing branches above
> a fog you cannot see the bottom of. You choose the route. They do the running.
> Every route pays back the same 95.5% — what you are actually choosing is the
> shape of the risk, and which of your runners you are willing to gamble.

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

**The run.** Climb the tree. Five branches — Lowbranch, The Grain, Windrow, The
Char, Crown. At the top is the Crown Lamp. Along the way there are Lamp Houses:
brass shelters where a Kindling's light can be banked and kept.

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
   `stake x 95.5%`. This is the only moment the house margin is charged.
   A commitment hash for the whole round is published *now*, before any choice.
3. **Arena brief.** The player sees the branch ahead and four route cards, each
   showing its exact numbers for the current squad size. **No timer.**
4. **Commit the route.** Optionally attach a side bet. Optionally choose which
   Kindlings to shelter.
5. **The run.** A 9–14 second deterministic replay of the committed transcript.
   Client physics is presentation; the transcript already decided who falls.
6. **Resolve.** Survivors are counted. The claim is multiplied by
   `(survivors / runners) x route multiplier`. If nobody clears, the round ends.
7. **Bank or continue.** Available after every resolved arena. **No timer.**
8. **Settle.** Banking, or finishing arena 5, credits the claim. A wipe credits
   nothing beyond anything already sheltered.
9. **Verify.** The seed is revealed. The player can re-derive the whole round,
   including the routes they did not take.

A full five-arena run is 90–120 seconds. A cautious two-arena run is ~35 seconds.

### 2.1 Round persistence — no latency-sensitive money decisions

There is no countdown on any money decision, anywhere, ever. A round is server-
side state; closing the app mid-round is safe and resuming restores the exact
frame. If a round is abandoned for longer than the operator's expiry window
(default 24 h), it auto-resolves as **BANK** — the player's own money, returned —
never as a forced run. Network latency, frame rate and input timing cannot change
a payout, because the outcome was fixed before the player chose.

---

## 3. Player decisions — and exactly what each one changes

Zero fake agency. Every control below moves the distribution in a way the player
can see, and none of them moves the expected value. The number in the last column
is proved exactly in `MATH.md` §8 and asserted in CI.

| # | Decision | When | What it actually changes | Effect on RTP |
| --- | --- | --- | --- | --- |
| 1 | **Stake** | Before buy | Scales everything linearly | none |
| 2 | **Route contract** (Wide / Split / Narrow / Shelter) | Before each arena, no timer | The entire survivor distribution: wipe probability, expected survivors, multiplier, skew | **none** |
| 3 | **Shelter size `k`** | With a Shelter contract | Banks `k/n` of the claim irreversibly; truncates both tails | **none** |
| 4 | **Which Kindlings to shelter** | With a Shelter contract | *Who* comes home. Also changes next arena's lane sizes, hence the shape | **none** |
| 5 | **Bank or continue** | After each resolved arena, no timer | Truncates the distribution at the current claim | **none** |
| 6 | **Side bet + stake** | With each route commitment | Adds a bet with its own shape and its own identical margin | **none** |
| 7 | **Names, lantern glass, cloth, charms** | Any time | Nothing mechanical. Attachment only | **none** |

**Stated plainly, in-product:** *"Every route returns 95.5%. You are choosing the
shape of the risk, not the odds."* This line is permanently visible on the route
screen. It is not a disclaimer buried in a legal sheet; it is the product's
actual thesis.

### 3.1 The routes, and why the choice is real

| Route | Fiction | Geometry | What it does to the distribution |
| --- | --- | --- | --- |
| **WIDE** — *The Broad Bough* | A wide fossil bough. Crosswind, crumbling bark. | One lane, whole squad | Keeps the most runners alive (4.2 of 5 per arena) but everyone shares one shear risk: total wipe never drops below 4%. Multiplier 1.190x. |
| **SPLIT** — *The Fork* | The branch divides. The squad divides with it. | Two independent lanes | Kills more runners on average (1.25 per arena vs 0.8) yet a **total** wipe needs both limbs to fail: 1.30% at five runners, **3.07x safer than Wide**. Multiplier 1.333x. |
| **NARROW** — *The Reach* | A hairline limb across a gap. Single file, point runner first. | One lane, single file | The point runner's fall whips the line and takes everyone: 51.6% total wipe. Multiplier 4.000x. |
| **SHELTER** — *The Lamp House* | A brass shelter door mid-branch. | Withdraw `k`, remainder runs Wide | Banks `k/n` of the claim on the spot. Shelter even once and your bust probability becomes exactly **zero** — money is already home. |

The Wide/Split reversal is the strategic heart of the game and it is genuine, not
flavour text: at five runners Split is three times safer against a total wipe; at
two runners Split is *more* dangerous than Wide, because two solo lanes lose the
safety of numbers. Players discover this. The route cards show it outright.

### 3.2 The route card (the most important UI object in the game)

Each card carries, for the current squad size, computed from the same tables the
enumerator publishes:

```
┌──────────────────────────────────────┐
│ NARROW              THE REACH        │
│ 4.000x  per runner who clears        │
│                                      │
│ ▁▁▂▅▅▂  survivors, 5 runners         │  ← exact distribution bars
│ nobody makes it        51.6%         │
│ all five make it        1.6%         │
│ expected survivors       1.25        │
│                                      │
│ Returns 95.5%, like every route.     │
│ [ full odds ▸ ]                      │
└──────────────────────────────────────┘
```

`full odds ▸` opens the exact per-outcome table — the same rows as `MATH.md` §5.2,
as fractions, in the game. A player who wants the paytable gets the paytable.

---

## 4. Bet types

Full exact treatment in `MATH.md` §5. Product surface:

| Bet | Placed | Resolves | Feel |
| --- | --- | --- | --- |
| **Route Ticket** | At buy | End of round | The run itself. The main wager. |
| **Clean Sweep** | With a route commitment | That arena | "Everybody makes it." 1.29x–61.12x. |
| **Sole Survivor** | With a route commitment | That arena | "One light comes out." Up to 931.35x on a full Wide squad. |
| **Last Light** | With a route commitment | That arena | "Nobody makes it." 1.53x–73.34x. |

Side bets appear only when two or more Kindlings are running. They are collapsed
behind a single `+ side bet` control, off by default, with the stake reset to zero
every arena — a player must actively choose them every time, and never inherits
a bet they set once.

**Last Light is not insurance.** Product copy never uses the words insurance,
protection, hedge, or safety net for it. It carries the identical 4.5% margin as
everything else, and the card says so: *"Same 95.5% as every bet here."* Framing a
same-margin bet as protection is a dark pattern, and the fact that it *is*
mathematically a hedge does not license us to sell it as one.

---

## 5. Mobile-first portrait UX, screen by screen

Baseline device 390 x 844 pt. All primary actions in the bottom 280 pt thumb zone.
Everything works one-handed. Landscape is a stretch goal; portrait is the design.

**Global layout while in a round:** viewport 0–58% of height (the branch, the
Kindlings, the fog), decision surface 58–100% (cards, claim, actions). The claim
figure lives on the seam between them in tabular numerals and never moves.

---

### S0 — Squad
*Home. The five Kindlings stand on a low stone shelf in half-light.*

- Each Kindling: name, lantern glass colour, cloth, one charm. Tap to rename or
  re-dress. A small "runs come home: 41" counter per Kindling.
- A permanent line: *"Cosmetics never change the odds."*
- Bottom: `Set the stake ▸`.
- Session strip at the very top: time played, net position this session, always
  visible, never dismissible.

### S1 — Stake
- A stepper plus four presets. Stake shown in credits with tabular numerals.
- Below the stepper, computed live and honestly: *"Buying this run debits 5.00 and
  opens a claim of 4.775 — that's the 95.5% return, charged once, now. It is not
  charged again no matter how far you go."*
- `Buy the run` (primary). On tap: the commitment hash appears for ~1 s with a
  small lock mark and the text *"This round's outcomes are already fixed and
  sealed."* Then S2.

### S2 — Arena brief and route choice *(the core screen)*
- Viewport: the branch ahead in fog, arena name, arena number `2 / 5`. The squad
  is visible at the mouth of the branch, lanterns lit, breathing idle.
- Decision surface: a horizontally paged stack of four route cards (§3.2), one
  per screen-width, with a page indicator. Wide first, then Split, Narrow,
  Shelter. Card order never changes and is never personalised.
- Shelter card expands to a Kindling picker: tap the ones to bring home. Live
  readout: *"Banks 1.91 now. 3 keep running."*
- `+ side bet` collapsed control below the cards.
- Footer: current claim, squad count, `Commit route` (primary, full width).
- **No countdown, no auto-select, no "recommended" badge, no highlighting of the
  higher-multiplier card.** All four cards have identical visual weight.

### S3 — The run
- Viewport expands to full bleed. Decision surface slides away; only the claim
  and squad count remain, docked bottom-left.
- 9–14 s replay. Camera travels with the squad. On Narrow it drops to a close
  handheld follow.
- A `skip` affordance appears after 1.5 s (bottom-right, low contrast). Skipping
  jumps to the resolved state; it cannot change anything, and the game says so
  the first time: *"The result is already sealed. Skipping only skips the view."*

### S4 — Resolve, then bank or continue
- The moment survivors are counted, the claim number rolls (tabular, ~600 ms,
  no spinning) and the arithmetic is shown in full for one beat:
  `4.775 x (3/5) x 1.333 = 3.820`. Never a mystery multiplier.
- Fallen Kindlings are named in a quiet list: *"Bramble did not make it."*
- Two actions, equal visual weight, side by side:
  `Bank 3.82` and `Run The Char ▸`. Neither is styled as the "right" one.
  No pulsing, no colour hierarchy, no default focus.
- **No timer.** The screen will sit here forever.

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
  sheltered, if any.
- Primary action is `Back to the squad`. A secondary `Run again` fades in only
  after **2 seconds**, and there is no stake pre-fill, no "double your stake",
  no offer, no bonus prompt, no free-spin popup on this screen or the next one.
  Promotional surfaces are suppressed for 60 s after any losing round.

### S7 — Round summary
- The five arenas as a vertical strip with what happened at each.
- Money: staked, banked, side bets, net — plain, tabular, no celebration styling.
- `How this was decided ▸`.

### S8 — Verification
- Cold blue UI (`--verify`), deliberately in a different visual family from the
  game so proof never looks like a reward.
- Shows: commitment hash (published pre-round), revealed seed, round id, adapter
  and model versions, and a `Re-derive` button that recomputes the whole hazard
  table on-device and shows every arena's draw against the outcome.
- `Copy verification bundle` exports JSON that `tools/transcript.mjs` will verify
  on any machine.
- **The Ghost Line** (§8) lives here, opt-in, off by default.

### S9 — Settings and responsible play
- Session limits, reality-check interval, self-exclusion hand-off to the
  operator, full odds tables, this document's §10 in plain language, audio and
  motion-reduction toggles.

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
authored rather than assembled.

- **Petrified wood** — everything the runners touch. Roughness 0.75–0.90,
  metalness 0, triplanar grain normal at two scales (10 cm ripple, 2 m sweep),
  hairline fracture network in the cavity map, a thin dust layer that lightens
  upward-facing surfaces toward `--fossil`. Edges get 2 mm of translucency so
  thin fins glow faintly when a lantern passes behind them.
- **Kindling construction** — woven reed (anisotropic strand normal, tangent
  along the weave), linen (GGX sheen lobe, visible weave at 0.5 mm, slight
  fibre fuzz on the silhouette), aged leather straps (roughness 0.5, subtle
  wax specular), and the lantern: thin blown glass (transmission 0.9, IOR 1.5,
  thumbprint smudge mask) in an aged brass frame (metalness 1.0, roughness 0.35,
  patina in the crevices).
- **Fog** — exponential height fog plus three scrolling volumetric layers at
  different parallax rates, with light shafts cast by lanterns. Fog density is
  the game's depth cue and its dread: at arena 5 the fog below is thicker, not
  thinner.

**Emissive budget rule:** the only emissive surfaces in the entire game are
lantern flames, the Lamp House interior, and the Crown Lamp. Nothing else emits
light — not UI in world space, not hazards, not path markers. Because light is
money, light must be scarce.

### 6.3 Lighting

- One cool key from above and behind: a sky dome at `--fog-far`, low intensity.
  Its job is to give the world silhouettes, not to illuminate it.
- Each Kindling carries a warm point light: `--lamp`, 3.5 m radius,
  inverse-square. On mobile, only the three nearest cast shadows; the rest use
  an unshadowed light plus a baked contact-shadow decal.
- **The death of a light is a lighting event, not a particle effect.** When a
  lantern goes out its point light falls off over 220 ms with a slight blue
  shift as it dies, and the local fog loses its warm scatter. You feel the frame
  get colder.
- Losing the last lantern removes all warm light from the scene. What remains is
  the cool key on grey fog. Hold it. Do not cut away early.
- Banking is the inverse: the Lamp House interior blooms as each lantern is
  carried in, and its brass throws warm bounce back onto the branch.

### 6.4 Motion language

- **Hybrid frame rate on the characters.** Root motion and camera at full frame
  rate; secondary motion (cloth, reed sway, lantern swing) stepped to 12 fps.
  The result reads as hand-made puppetry moving through a real space, and it is
  the single strongest anti-"party game" signal in the whole presentation.
- **Falls are weighted-light.** 0.7 g for the first 400 ms so the fall registers
  and the lantern arcs legibly, then full gravity. Ragdoll never flails
  comically: joint limits are tight, and the figure keeps trying to grab.
- **Camera.** Default a 35 mm-equivalent tracking rig at chest height, slight
  handheld noise. On The Reach it drops to 24 mm, closer and shakier. On a wipe
  it stops moving entirely and lets the subject leave frame.
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

### 6.7 The presentation contract (client physics never decides money)

The renderer is a **player, not a judge**.

1. The server resolves the arena from the committed hazard table: the survivor
   set, and for each fallen runner the lane, the cause (`collapse` or `slip`) and
   a flavour draw.
2. The client receives that resolution and *stages* it. Fall animations are
   authored clips selected by the flavour draw — not free-running simulation —
   so the same transcript produces the same clip on every device. Ragdoll blends
   in only after the figure has left the camera frustum, where divergence cannot
   be observed and cannot matter.
3. If the client's physics ever disagrees with the transcript, the transcript
   wins and the client is wrong. There is no path by which a frame drop, a
   thermal throttle, or a modified client changes a credit.
4. **We never author a near-miss that is not in the data.** If a runner cleared
   by a wide margin, the clip shows a wide margin. Manufacturing "so close!"
   moments is the oldest manipulation in this industry and we do not do it.

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
- **Never:** crowd cheering, hype VO, rising-pitch riser under a decision,
  coin-cascade, "big win" fanfare over a sub-stake return.
- **Full parity with audio off.** Every state — squad size, claim, route odds,
  outcome — is readable visually. Sound is enrichment, never information the
  player can only get by listening.

---

## 8. The signature moment: **The Last Lamp**

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

**Clip export.** After any round containing a Last Lamp beat, S7 offers
`Save the clip` — a 6-second 1080x1920 H.264 export, pre-trimmed to the beat,
watermarked with the round id and a short verification code. No score overlay, no
"I WON" sticker, no auto-generated hype caption. The clip is the moment; the
verification code is the proof that it really happened that way.

---

## 9. The emotional hook

- **Named, dressed, persistent.** Five Kindlings the player names and re-dresses.
  Defaults: Wren, Bramble, Ora, Tuck, Sable. A per-Kindling counter of runs come
  home. Cosmetic only, stated plainly, every time.
- **The squad shrinks audibly and visibly.** Losses are not a number going down;
  they are a rhythm thinning and a frame getting colder.
- **Individuals are named at the moment of loss.** *"Bramble did not make it."*
  Not "1 runner eliminated".
- **Banking is a rescue, not a cash-out.** The verb in the UI is *bring home*.
  The animation is a door and a bell, not a coin counter.
- **No permadeath and nothing to buy back.** Every Kindling is on the shelf again
  at the start of the next run. Permanent loss plus a purchasable revival is a
  loss-aversion trap, and it is exactly the mechanic our theme would make most
  effective — which is precisely why we are not building it. Optionally, a
  purely cosmetic "scar" (a mended patch, a re-blown lantern) can be enabled by
  the player in settings. It is off by default and it costs nothing.

---

## 10. Responsible design

These are build requirements, not aspirations. Each one has a corresponding
acceptance check.

**No loss-chasing mechanics.**
- No double-or-nothing, no "recover your loss" offer, no re-buy-at-a-discount.
- No auto-rebet, no auto-play, no one-tap replay from the wipe screen. The wipe
  screen's primary action leads *away* from the stake field.
- `Run again` appears only after 2 s and never pre-fills the previous stake.
- All promotional surfaces — bonuses, offers, free rounds — are suppressed for
  60 s after any losing round, and never appear on S6 at all.
- Session strip (time played, net position) is always visible and never
  dismissible. A reality check fires at the operator's interval, default 30 min,
  and pauses the game.

**No misleading skill framing.**
- Product copy is forbidden from using: *strategy, skill, outplay, beat the odds,
  master, edge, system, pro.* The words in use are *choose*, *shape*, *risk*.
- The route screen permanently states that every route returns 95.5%.
- Full exact odds are reachable in two taps from any route card.
- No "recommended" route, no personalised route ordering, no highlighting of the
  bigger multiplier, no leaderboards ranked by return.
- The Kindlings' animations never suggest effort or reward for the player's
  choice — a runner who clears a Narrow lane does not look *better* at running
  than one who clears Wide.

**No latency-sensitive money decisions.**
- No countdown on any decision. Ever. Rounds persist across app termination.
- The outcome is committed before the first choice, so input timing is
  mechanically incapable of changing a payout.
- `skip` is explicitly labelled as skipping the *view*, not the result.

**Honest presentation of money.**
- Every return is stated relative to the stake. A 0.76x bank says so.
- No win presentation over a net loss. No "YOU WON 3,820" on a 5,000 stake.
- No near-miss manufacturing (§6.7 rule 4).
- Micro-credit precision means the displayed number is the number credited.

**Regret management for the Ghost Line.**
The Ghost Line — the counterfactual replay of the route the player *didn't*
take — is a genuine fairness feature: it proves the unchosen branches were fixed
in advance. It is also, obviously, a regret engine. So:
- it lives in the verification screen (S8), never in the game flow;
- it is **off by default** and opt-in per player;
- it is unavailable for 60 s after a losing round;
- it shows *who fell and where*, never a counterfactual money figure. The
  player never sees "you would have won 214.80". That single restriction keeps
  the fairness value and removes most of the regret hook.

**Accessibility.**
- Full parity with audio off (§7) and with reduced motion (stepped animation and
  handheld camera noise both disable; the transcript readout remains).
- Colour is never the sole carrier of state: alive/lost is also glyph and text.
- Minimum 15 pt text, one-handed reach for all primary actions, 44 pt targets.
- Screen-reader labels state the exact odds of the focused route card.

---

## 11. Production notes

- **Scene budget (mobile mid-tier):** ≤ 120k triangles on screen, 5 skinned
  characters at ≤ 8k triangles each, 3 shadow-casting point lights, 3 fog layers,
  one 2048 atlas for the branch set and one for the Kindlings.
- **Arena construction:** each of the five branches is one 60 m spline with
  modular fossil segments, dressed differently per arena. Lane geometry (1 lane
  vs 2 vs single-file) is authored per branch, not procedural, so the fiction of
  the fork is physically real in the level.
- **Localisation:** all money strings tabular and RTL-safe; route names are
  translated but stay ALL CAPS with equal weight.
- **Determinism harness:** a CI job replays the frozen fixture transcript through
  the presentation layer and asserts the same authored clips are selected on every
  target platform.
- **What does not ship without the math:** the route cards read their numbers
  from the same tables `tools/enumerate.mjs` publishes. If the enumerator and the
  card disagree, the build fails.

---

## 12. Related documents

- [`MATH.md`](./MATH.md) — the exact probability model, paytable and proofs.
- [`ENGINE.md`](./ENGINE.md) — the Reveal Engine `staged-survival` lifecycle
  module and the adapter surface this game consumes.
- [`../README.md`](../README.md) — what the game is, in thirty seconds.
