/**
 * The two objects the product is actually made of: the claim meter and the route
 * card. Everything else on the screen is a container for one of them.
 *
 * Both are built to a hard constraint that is not decoration: on the baseline
 * device (390 x 844) the whole decision has to sit in one unscrolled viewport —
 * four options with their prices, the position value, and the primary action —
 * because `DESIGN.md` §3.2's Two-Card Moment is an argument about *comparison at
 * a glance*, and a card you have to scroll to read is not one. So every field the
 * specification puts on the card face is on the card face, and the card is sized
 * to fit rather than sized to whatever the fields happened to need.
 */
import { credits } from './api.js';
import { COPY, MONEY, RTP_LINE, UNIT } from './copy.js';
import { el, type Child } from './dom.js';
import { CLAIM_ROLL, countUp } from './motion.js';
import type { Figures, SquadMember } from './types.js';

/**
 * The hero figure on a terminal screen (`DESIGN.md` §S5, §9).
 *
 * §9 says the rescue *"is deliberately given the same production value as the
 * biggest win"*, and the round-2 review measured the opposite: the banked figure
 * was 15 px — the same size as the status-bar balance — while the wipe headline
 * was 28 px, so the loss shouted and the win whispered. §6.5 writes 28 pt as a
 * *floor* for the claim, not a ceiling, and this is the one figure in the game
 * that is the whole point of the screen it is on.
 *
 * It is brass, because banked money is the brass family (§6.1); it counts up on
 * a tabular roll and never spins (§6.4); and it carries its label above it so the
 * number is never a number on its own. Nothing scales, shakes or overshoots — the
 * production value is size, colour, light and sound, which is exactly what §6.4
 * permits and all it permits.
 */
export function heroFigure(options: {
  readonly label: string;
  readonly value: string;
  /** Where the count starts. Absent, the figure is simply printed. */
  readonly from?: string | null;
  readonly note?: Child;
  readonly ms?: number;
  /**
   * Warm or cold.
   *
   * The two endings are the same size and they are not the same temperature.
   * `brass` is money that came home; `cold` is the wipe's own statement of what
   * happened, held at the same weight so the loss is not the loudest thing in the
   * game (round-2 finding) and given none of the light, because §S6 is quiet and
   * §10.2 forbids dressing a loss as an event.
   */
  readonly tone?: 'brass' | 'cold';
  /**
   * How big the return was (`payoff.ts`), which is how big the figure is set.
   *
   * The round-2 build drew one figure at one size for every bank in the game, so
   * a 0.81x recovery and a 3.06x looked identical down to the pixel. §6.5 writes
   * 28 pt as a floor and §6.4 permits size, colour and light — so the tier moves
   * the size and the glow and nothing else. There is no tier on the cold ending:
   * a loss has one volume on purpose (§10.2).
   */
  readonly tier?: 'quiet' | 'big' | 'huge';
  /**
   * Whether this figure is a win, and may therefore be built as one.
   *
   * The payout plate — a lit gold surface with the figure in ink on its face — is
   * celebratory whatever number is printed on it, so it is gated on the one
   * question that decides whether celebrating is honest: did more come back than
   * went in (`payoff.ts`'s `celebrates`). Absent or false, the figure is stated
   * plainly on the frame and none of the plate, the rim, the bloom or the ink
   * inversion is drawn. §10.5, and the blocker on dressing a partial return as a
   * win.
   */
  readonly won?: boolean;
}): HTMLElement {
  const tier = options.tone === 'cold' ? 'quiet' : (options.tier ?? 'quiet');
  const won = options.tone !== 'cold' && options.won === true;
  const figure = el('div', {
    class: `hero-figure${options.tone === 'cold' ? ' cold' : ' money'}${tier === 'quiet' ? '' : ` ${tier}`}`,
    text: options.from ?? options.value,
  });
  if (options.from !== undefined && options.from !== null && options.from !== options.value)
    roll(figure, options.from, options.value, options.ms ?? 900);
  return el(
    'div',
    { class: `hero${options.tone === 'cold' ? ' cold' : ''}${won ? ' won' : ''}` },
    el('div', { class: 'hero-label', text: options.label }),
    /*
     * The unit is a sibling of the numeral, not part of it.
     *
     * Criterion 17 requires the currency attached to the payout figure, and every
     * reference writes it — `TOTAL WIN 1.03 FUN`. It cannot be inside the numeral
     * because `roll()` counts by writing `textContent`, which would eat it on the
     * first frame and print it back on the last; and it should not be, because it
     * is a *label* and the reference sets it smaller than the amount it belongs
     * to. So the row is the figure and its unit, baseline-aligned.
     */
    el('div', { class: 'hero-row' }, figure, el('span', { class: 'hero-unit', text: UNIT })),
    options.note ?? null,
  );
}

/**
 * The claim meter (`DESIGN.md` §5.2.2).
 *
 * *"The strongest thing we can do for comprehension is refuse to build a
 * tutorial-only explanation."* One pip per share, each labelled with its own
 * value, present in the rehearsal and in real rounds, never dismissed. On a Split
 * the pips group into two clusters matching the lane sizes, so lane membership is
 * legible in the money object and not only in the 3D scene.
 *
 * The pip carries the value and not the name: the value is the thing §5.2.2 asks
 * for, and it is money, so it is held to the 15 pt numeral floor in §6.5. The
 * names are on the figures in the scene above and on every picker that assigns
 * them, which is where a player is choosing between them.
 */
export function claimMeter(options: {
  readonly claim: string;
  readonly caption: string;
  readonly squad: readonly SquadMember[];
  readonly laneSizes?: readonly number[] | null;
  readonly bankedNote?: string | null;
  readonly perRunner?: string | null;
  /**
   * Where the claim figure starts, when it is about to move.
   *
   * §S4: *"the claim number rolls (tabular, ~600 ms, no spinning)"*. The screen
   * that knows the claim has just changed passes the old value here; the meter
   * prints that and counts to `claim`. Absent, the figure is simply printed —
   * which is every other screen, because a claim that has not moved must not
   * animate as though it had.
   */
  readonly rollFrom?: string | null;
  /**
   * What is riding on this round, with its unit (`RUBRIC` criterion 3).
   *
   * The blind ranking could not answer *"what is at stake"* from the decision
   * screen's pixels: the bet amount appeared nowhere on it, only a session net in
   * the status bar. Every reference carries the stake beside the position on the
   * one screen where the player is about to commit it, so it is here — next to
   * the claim it bought, in the same object, where the comparison between the two
   * is the point.
   */
  readonly stake?: string | null;
  /**
   * Whether the meter draws its per-runner pips.
   *
   * §5.2.2's teaching object is the claim *and* its shares. On the decision
   * screen the shares are now printed on the figures themselves — a brass chip
   * under each Kindling carrying that runner's value — so a pip row underneath
   * would print the same five numbers a second time, which is the duplication the
   * round-1 subtraction test names as noise. Everywhere the world is not carrying
   * them, the pips are.
   */
  readonly pips?: boolean;
}): HTMLElement {
  const running = options.squad.filter((member) => member.status === 'running');
  const pips: Child[] = [];
  const push = (member: SquadMember) =>
    pips.push(
      el(
        'div',
        {
          class: `pip ${member.status}`,
          /*
           * Which Kindling this pip is, as a colour.
           *
           * The stage paints the same five identity colours on the figures'
           * straps (`stage.ts`'s `STRAPS`). Carrying them onto the pip is what
           * makes the money object and the world one thing: the player can see
           * which light in the meter is the figure they are watching, without a
           * name on either. The flame inside the pip is untouched — §6.2's
           * emissive budget spends its warm on the lantern and only there — so
           * the identity lives on the rim, which is brass, which is an object.
           */
          'data-kin': String(member.slot % 5),
          title: `${member.name} — ${MONEY(credits(member.valueMicro, 2))}`,
        },
        el('span', { class: 'dot' }),
        el('span', { class: 'value', text: credits(member.valueMicro, 2) }),
      ),
    );

  if (options.laneSizes && options.laneSizes.length > 1) {
    let cursor = 0;
    options.laneSizes.forEach((size, index) => {
      if (index > 0) pips.push(el('div', { class: 'lane-gap' }));
      for (const member of running.slice(cursor, cursor + size)) push(member);
      cursor += size;
    });
    for (const member of options.squad.filter((candidate) => candidate.status !== 'running'))
      push(member);
  } else {
    for (const member of options.squad) push(member);
  }

  const rollFrom = options.rollFrom ?? null;
  const figure = el('div', {
    class: `claim-figure money${rollFrom !== null && rollFrom !== options.claim ? ' rolling' : ''}`,
    text: rollFrom ?? options.claim,
  });
  if (rollFrom !== null && rollFrom !== options.claim) roll(figure, rollFrom, options.claim);

  return el(
    'div',
    { class: `claim-meter${options.pips === false ? ' bare' : ''}` },
    el(
      'div',
      { class: 'claim-line' },
      figure,
      el(
        'div',
        { class: 'claim-side' },
        el('div', { class: 'claim-caption', text: options.caption }),
        options.stake ? el('div', { class: 'stake-note money', text: `stake ${MONEY(options.stake)}` }) : null,
      ),
    ),
    options.pips === false ? null : el('div', { class: 'pips' }, pips),
    options.bankedNote
      ? el('div', { class: 'banked-row money', text: options.bankedNote })
      : null,
  );
}

/**
 * The claim, counting from one value to another.
 *
 * Two rules from §6.4 and §S4 are load-bearing and both are about *not* doing
 * something: it is a tabular roll and **never a slot-machine spin**, and a
 * multiplier must never reflow while counting. So the width is fixed by taking the
 * decimal places from the destination string and formatting every intermediate
 * value to the same ones — the digits change and the box does not — and the final
 * frame writes the server's own string rather than a rounding of it.
 */
function roll(node: HTMLElement, from: string, to: string, ms = CLAIM_ROLL): void {
  const places = to.includes('.') ? to.length - to.indexOf('.') - 1 : 0;
  const start = Number.parseFloat(from);
  const end = Number.parseFloat(to);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    node.textContent = to;
    return;
  }
  countUp(node, start, end, to, (value) => value.toFixed(places), ms);
  window.setTimeout(() => node.classList.remove('rolling'), ms + 300);
}

/**
 * The exact distribution bars, with the break-even tick.
 *
 * Bars are scaled against the geometry's own largest probability so the shape is
 * readable at any squad size. The tick is the build requirement in §3.2: a player
 * should be able to see which side of the line the mass sits on before reading a
 * digit.
 */
export function distributionBars(
  figures: Figures,
  height?: number,
  /**
   * A second distribution on the same axis, drawn as a stepped outline.
   *
   * §3.3's whole argument is that `4 + 1` is *visibly* taller at both ends and
   * shorter in the middle, *"rendered on a shared axis"*. The first build did
   * that as two half-width charts side by side, and the round-2 review measured
   * the result: 44 px tall, with 1.30% and 3.39% both drawn as 1 px lines and no
   * label saying which chart was which. Two cramped pictures of one comparison
   * are worse than one full-width picture of it — so the selected balance is the
   * fill and the other is an outline over the same bars, on one scale, at the
   * card's full width. Fill against outline is a *shape* difference, so colour is
   * not carrying the distinction (§10.8).
   */
  ghost?: { readonly figures: Figures; readonly label: string } | null,
): HTMLElement {
  const values = figures.outcomes.map((row) => Number(row.probability.decimal));
  const ghostValues = ghost ? ghost.figures.outcomes.map((row) => Number(row.probability.decimal)) : [];
  const peak = Math.max(...values, ...ghostValues, 0.0001);
  return el(
    'div',
    // Heights are a percentage of whatever box the chart is given, so the card
    // can spend its spare height on the graphic rather than on empty space.
    { class: `bars${ghost ? ' paired' : ''}`, style: height === undefined ? '' : `height:${height}px;flex:none` },
    figures.outcomes.map((row, index) => {
      const value = values[index] ?? 0;
      /*
       * A floor in *percent of the track*, so a 1.30% outcome is a bar and not a
       * hairline. Three percent of a 100 px track is 3 px, which is the least that
       * still reads as a place with something in it; the bars above it are exact.
       */
      const fill = value <= 0 ? 0 : Math.max(4, Math.round((value / peak) * 100));
      const shade = ghostValues[index];
      return el(
        'div',
        {
          class: `bar ${row.direction}${row.survivors === figures.breakEven ? ' breakeven' : ''}`,
          title: `${row.survivors} back — ${row.probability.exact}`,
        },
        // The fill is a percentage of its own track, and the track is what is
        // left after the axis numeral has taken its line. Resolving the height
        // against the whole bar instead let the flex box shrink the tallest
        // fills unevenly, which drew two identical probabilities at two
        // different heights — a chart that lies about the one thing it is for.
        el(
          'span',
          { class: 'track' },
          el('span', { class: 'fill', style: `height:${fill}%` }),
          shade === undefined
            ? null
            : el('span', {
                class: 'ghost',
                style: `bottom:${shade <= 0 ? 0 : Math.max(4, Math.round((shade / peak) * 100))}%`,
                title: `${ghost?.label}: ${ghost?.figures.outcomes[index]?.probability.exact ?? ''}`,
              }),
        ),
        el('span', { class: 'axis', text: String(row.survivors) }),
      );
    }),
  );
}

function barsBlock(figures: Figures, caption: string, ghost?: { figures: Figures; label: string } | null): HTMLElement {
  return el(
    'div',
    { class: 'bars-block' },
    distributionBars(figures, undefined, ghost),
    el('div', { class: 'bars-caption', text: caption }),
  );
}

export function field(label: string, value: string, emphasis = false): HTMLElement {
  return el(
    'div',
    { class: `field${emphasis ? ' emphasis' : ''}` },
    el('span', { class: 'label', text: label }),
    el('span', { class: 'value money', text: value }),
  );
}

/** The six §3.2 fields, on the face, in the same weight, at every squad size. */
function fieldStack(figures: Figures): HTMLElement {
  return el(
    'div',
    { class: 'fields' },
    field('Your claim grows if', `${figures.breakEven} of ${figures.running} get back`, true),
    field('Chance of that', figures.display.growsPct),
    Number(figures.holds.decimal) > 0 ? field('Chance it holds', figures.display.holdsPct) : null,
    field('Claim falls, run goes on', figures.display.fallsNonZeroPct),
    field('Nobody makes it', figures.display.wipePct),
    field(`All ${figures.running} make it`, figures.display.allClearPct),
    field('Expected survivors', figures.display.expectedSurvivors),
  );
}

/**
 * `full odds ▸` — the depth, one tap from the face (`DESIGN.md` §3.2, §5.2.5).
 *
 * Everything the round-1 card printed at rest now lives here: the exact survivor
 * distribution with its break-even tick, the six §3.2 fields, the fork's paired
 * chart on one axis, and the per-outcome fractions. Nothing was removed from the
 * product — a player who wants the paytable still gets the paytable — and the
 * §5.2.5 ladder is what says this is the right rung for it: the resting surface
 * carries the decision, the disclosure carries the derivation.
 */
export function oddsDetail(
  figures: Figures,
  fork?: { readonly balances: readonly number[]; readonly running: number; readonly figuresOf: (balance: number) => Figures; readonly selected: number | null } | null,
): HTMLElement {
  const paired =
    fork && fork.balances.length > 1
      ? (() => {
          const selected = fork.selected ?? (fork.balances[0] as number);
          const other = fork.balances.find((balance) => balance !== selected) ?? selected;
          return {
            figures: fork.figuresOf(other),
            label: `${other} + ${fork.running - other}`,
            selected: fork.figuresOf(selected),
          };
        })()
      : null;
  return el(
    'div',
    { class: 'odds-detail' },
    barsBlock(
      paired ? paired.selected : figures,
      paired
        ? `survivors · ▲ grows from here · outline is ${paired.label}`
        : `survivors, ${figures.running} running · ▲ the claim grows from here`,
      paired ? { figures: paired.figures, label: paired.label } : null,
    ),
    fieldStack(paired ? paired.selected : figures),
    oddsTable(paired ? paired.selected : figures),
  );
}

/**
 * Which rung of the payout ramp a multiple sits on, 1 (lowest) to 4 (highest).
 *
 * `RUBRIC` criterion 11 — *"the player learns the payout scale by looking, never
 * by reading"* — is the whole reason this exists: a route's price gets a hue that
 * encodes its magnitude, the way a Plinko chip or a Balloon Mania balloon does.
 *
 * Three things it deliberately is not. It is not a recommendation: the bands are
 * a *scale*, all four routes return 95.5%, and §S2's rule that no segment gains
 * weight over another still holds — a band is a legend, not a badge. It is not a
 * danger signal: §6.1's first hard rule survives intact because the ramp is
 * green -> cyan -> violet -> magenta and never passes through red. And it is not
 * a decision: this reads a figure the server already computed and picks a class
 * name from it. Nothing downstream of it can reach money.
 */
export function payoutBand(multiplier: string): 1 | 2 | 3 | 4 {
  const value = Number.parseFloat(multiplier);
  if (!Number.isFinite(value) || value < 1.25) return 1;
  if (value < 2) return 2;
  if (value < 5) return 3;
  return 4;
}

export interface RouteObject {
  readonly route: string;
  readonly multiplier: string;
  /**
   * How many of the squad come home on a typical crossing of this route.
   *
   * The route's expected survivors, as the server computes them. It is the one
   * figure that makes the four prices comparable without arithmetic: multiplied
   * by the price and divided by the squad it is the same
   * <!-- fig:rtpPct --> on every route, which is the product's whole thesis
   * (§3) expressed as a picture instead of a sentence.
   */
  readonly typical: number;
  readonly running: number;
}

/**
 * The four routes, as four objects (`DESIGN.md` §3.2).
 *
 * ## The finding this closes
 *
 * The round-3 blind ranking could pick our decision screen out of four real
 * products in a second, and named the tell as *register* rather than polish:
 * *"ours is the only frame in the whole comparison set carrying a stacked
 * two-tone probability bar, a prose odds line, a 'Returns 95.5%, like every
 * route' footnote and a 'compare | full odds ▸' link row. No commercial
 * crash/instant game puts an analytics chart on the decision surface; Plinko
 * puts the same information on nine coloured chips with the multiplier printed
 * on each. Ours reads as a fintech UI wearing good game art."*
 *
 * `RUBRIC` §2 and criterion 11 say the same thing from the other side: *"the
 * player learns the payout scale by looking, never by reading."*
 *
 * ## What is on the object
 *
 * The name, the price, and one picture: a row of lanterns showing how many of
 * the squad come home on a typical crossing. Nothing else. Four of these side by
 * side are the whole comparison, because the two things that differ between the
 * routes are exactly these two — you pay more per lantern for a crossing that
 * brings fewer of them home — and the product's thesis is that the two cancel:
 * `typical x price / squad` is the same return on all four.
 *
 * The lantern is not a bar. It is the object the game is made of, at the size it
 * fits, and a partly-lit last lantern is what `4.20 of 5` looks like — a picture
 * of a fractional expectation rather than a chart of one.
 *
 * ## What is not on it
 *
 * The break-even and the chance the claim falls without ending the run are
 * §3.2's two load-bearing fields and they are on the *selected* route's line
 * directly beneath the strip, in words, once — not four times, not as a chart,
 * and not behind a tap. Everything below them is one tap away under
 * `full odds ▸`, where §5.2.5's disclosure ladder puts depth.
 *
 * All four objects hold identical weight, area and luminance: what differs is
 * the band hue on the price, which is the price expressed as a colour and never
 * a recommendation (§S2, §10.3).
 */
export function routeStrip(
  entries: readonly RouteObject[],
  selected: string,
  onPick: (route: string) => void,
): HTMLElement {
  return el(
    'div',
    { class: 'route-strip', role: 'tablist' },
    ...entries.map((entry) =>
      el(
        'button',
        {
          class: 'route-tab',
          role: 'tab',
          'data-route': entry.route,
          'data-band': String(payoutBand(entry.multiplier)),
          'aria-selected': String(entry.route === selected),
          'aria-label': `${entry.route}, ${entry.multiplier} per runner who clears, typically ${entry.typical.toFixed(2)} of ${entry.running} come home`,
          onClick: () => onPick(entry.route),
        },
        el('span', { class: 'route-name', text: entry.route }),
        el('span', { class: 'money', text: entry.multiplier }),
        lampRow(entry.typical, entry.running),
      ),
    ),
  );
}

/**
 * `4.20 of 5`, drawn as lanterns rather than written as a figure.
 *
 * One lamp per runner. Whole lamps for the whole part of the expectation and a
 * part-filled glass for the remainder, which is the honest picture: a route that
 * brings back one and a quarter lanterns should not draw the same row as one
 * that brings back two. The fill is a *height*, because a lantern fills from the
 * bottom, and because a partial width would read as a bar chart segment.
 *
 * The row is `aria-hidden`: the tab's own label already states the figure in
 * words, and a screen reader has no use for five decorative spans.
 */
function lampRow(typical: number, running: number): HTMLElement {
  const lamps: Child[] = [];
  for (let index = 0; index < running; index += 1) {
    const fill = Math.max(0, Math.min(1, typical - index));
    lamps.push(
      el(
        'span',
        { class: `lamp${fill >= 0.999 ? ' lit' : fill > 0.02 ? ' part' : ''}` },
        fill > 0.02 && fill < 0.999
          ? el('span', { class: 'wick', style: `height:${Math.round(fill * 100)}%` })
          : null,
      ),
    );
  }
  return el('span', { class: 'lamp-row', 'aria-hidden': 'true' }, lamps);
}

/**
 * The selected route's terms, in words, once (`DESIGN.md` §3.2).
 *
 * §3.2's build requirement 1 is that the break-even and the chance the claim
 * falls *without ending the round* are on the decision surface at rest, on every
 * route and at every squad size. This is where they are: one sentence under the
 * strip, about the route the player has actually selected, naming the fiction
 * the world above is drawing and the two numbers a player cannot infer from the
 * price.
 *
 * It carries the product's thesis in the same breath, because §3 requires that
 * line permanently visible on this screen and because the two belong together:
 * the terms differ on every route, the return does not.
 */
export function routeLine(options: {
  readonly fiction: string;
  readonly figures: Figures;
  readonly rtp: string;
  readonly onOdds: () => void;
}): HTMLElement {
  const figures = options.figures;
  return el(
    'p',
    { class: 'route-line' },
    el('span', { class: 'fiction', text: options.fiction }),
    el('span', {
      text: ` — ${COPY.breakEven.toLowerCase()} `,
    }),
    el('span', { class: 'money', text: `${figures.breakEven} of ${figures.running}` }),
    el('span', { text: ' get back, and falls ' }),
    el('span', { class: 'money', text: figures.display.fallsNonZeroPct }),
    el('span', { text: ' of the time without ending the run. ' }),
    el('span', { class: 'rtp', text: RTP_LINE(options.rtp) }),
    el('button', {
      class: 'link tap',
      text: 'full odds ▸',
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        options.onOdds();
      },
    }),
  );
}

/**
 * The exact per-outcome table — the same rows as `MATH.md` §5.2, as fractions.
 *
 * Wrapped in its own scroller. A twelve-digit exact denominator does not always
 * fit four columns across a 390 pt screen at the §6.5 numeral floor, and the
 * answer to that is a table that moves sideways, not a numeral that shrinks.
 */
export function oddsTable(figures: Figures): HTMLElement {
  return el(
    'div',
    { class: 'odds-scroll' },
    el(
      'table',
      { class: 'odds-table' },
      el(
        'thead',
        {},
        el(
          'tr',
          {},
          el('th', { text: 'Back' }),
          el('th', { text: 'Probability' }),
          el('th', { text: 'Exact' }),
          el('th', { text: 'Claim x' }),
        ),
      ),
      el(
        'tbody',
        {},
        figures.outcomes.map((row) =>
          el(
            'tr',
            {},
            el('td', { text: String(row.survivors) }),
            el('td', { text: row.probability.decimal.slice(0, 10) }),
            el('td', { text: row.probability.exact }),
            el('td', { text: row.claimFactor.exact }),
          ),
        ),
      ),
    ),
  );
}
