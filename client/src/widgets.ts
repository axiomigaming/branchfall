/**
 * The two objects the product is actually made of: the claim meter and the route
 * card. Everything else on the screen is a container for one of them.
 */
import { credits } from './api.js';
import { COPY, RTP_LINE } from './copy.js';
import { el, type Child } from './dom.js';
import type { Figures, SquadMember } from './types.js';

/**
 * The claim meter (`DESIGN.md` §5.2.2).
 *
 * *"The strongest thing we can do for comprehension is refuse to build a
 * tutorial-only explanation."* One pip per share, each labelled with its own
 * value, present in the rehearsal and in real rounds, never dismissed. On a Split
 * the pips group into two clusters matching the lane sizes, so lane membership is
 * legible in the money object and not only in the scene.
 */
export function claimMeter(options: {
  readonly claim: string;
  readonly caption: string;
  readonly squad: readonly SquadMember[];
  readonly laneSizes?: readonly number[] | null;
  readonly bankedNote?: string | null;
  readonly perRunner?: string | null;
}): HTMLElement {
  const running = options.squad.filter((member) => member.status === 'running');
  const pips: Child[] = [];
  const push = (member: SquadMember) =>
    pips.push(
      el(
        'div',
        { class: `pip ${member.status}` },
        el('span', { class: 'dot' }),
        el('span', { class: 'value', text: credits(member.valueMicro, 3) }),
        el('span', { class: 'who runner-name', text: member.name }),
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

  return el(
    'div',
    { class: 'claim-meter' },
    el('div', { class: 'claim-figure money', text: options.claim }),
    el('div', { class: 'claim-caption', text: options.caption }),
    el('div', { class: 'pips' }, pips),
    options.perRunner
      ? el('div', { class: 'tiny', text: `${options.perRunner} each` })
      : null,
    options.bankedNote
      ? el('div', { class: 'banked-row money', text: options.bankedNote })
      : null,
  );
}

/**
 * The exact distribution bars, with the break-even tick.
 *
 * Bars are scaled against the geometry's own largest probability so the shape is
 * readable at any squad size. The tick is the build requirement in §3.2: a player
 * should be able to see which side of the line the mass sits on before reading a
 * digit.
 */
export function distributionBars(figures: Figures): HTMLElement {
  const values = figures.outcomes.map((row) => Number(row.probability.decimal));
  const peak = Math.max(...values, 0.0001);
  return el(
    'div',
    {},
    el(
      'div',
      { class: 'bars' },
      figures.outcomes.map((row, index) => {
        const height = Math.max(2, Math.round(((values[index] ?? 0) / peak) * 46));
        return el(
          'div',
          {
            class: `bar ${row.direction}${row.survivors === figures.breakEven ? ' breakeven' : ''}`,
            title: `${row.survivors} back — ${row.probability.exact}`,
          },
          el('span', { class: 'fill', style: `height:${height}px` }),
          el('span', { class: 'axis', text: String(row.survivors) }),
        );
      }),
    ),
    el(
      'div',
      { class: 'bars-caption' },
      el('span', { text: `survivors, ${figures.running} running` }),
      el('span', { text: 'claim grows from ▲' }),
    ),
  );
}

/**
 * A route card (`DESIGN.md` §3.2) — the most important UI object in the game.
 *
 * Every field on the face, in the same weight, at every squad size: the
 * multiplier, the break-even, the chance the claim grows, the chance nobody
 * makes it, the chance everybody does, expected survivors, and the footer that
 * says every route returns the same. The two fields the v2 card did not carry —
 * where the claim turns, and how often it falls *without ending the round* — are
 * on the face and never behind `full odds`.
 */
export function routeCard(options: {
  readonly title: string;
  readonly route: string;
  readonly fiction: string;
  readonly figures: Figures;
  readonly selected: boolean;
  readonly rtp: string;
  readonly onSelect: () => void;
  readonly onOdds: () => void;
  readonly onCompare: () => void;
  readonly extra?: Child;
  readonly headNote?: string | null;
}): HTMLElement {
  const figures = options.figures;
  return el(
    'section',
    { class: `card${options.selected ? ' selected' : ''}`, onClick: options.onSelect },
    el(
      'div',
      { class: 'card-head' },
      el(
        'div',
        {},
        el('div', { class: 'route-name', text: options.route }),
        el('div', { class: 'fiction', text: options.fiction }),
      ),
      el(
        'div',
        { style: 'text-align:right' },
        el('div', { class: 'multiplier', text: figures.display.multiplier }),
        el('div', { class: 'tiny', text: 'per runner who clears' }),
      ),
    ),
    options.headNote ? el('div', { class: 'tiny', text: options.headNote }) : null,
    distributionBars(figures),
    el(
      'div',
      {},
      field(`${COPY.breakEven}`, `${figures.breakEven} of ${figures.running} get back`, true),
      field('Chance of that', figures.display.growsPct),
      Number(figures.holds.decimal) > 0 ? field('Chance it holds', figures.display.holdsPct) : null,
      field('Claim falls, run continues', figures.display.fallsNonZeroPct),
      field('Nobody makes it', figures.display.wipePct),
      field(`All ${figures.running} make it`, figures.display.allClearPct),
      field('Expected survivors', figures.display.expectedSurvivors),
    ),
    options.extra ?? null,
    el(
      'div',
      { class: 'card-footer' },
      el('span', { text: RTP_LINE(options.rtp) }),
      el(
        'span',
        { class: 'row' },
        el('button', {
          class: 'link',
          text: 'compare',
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            options.onCompare();
          },
        }),
        el('button', {
          class: 'link',
          text: 'full odds ▸',
          onClick: (event: MouseEvent) => {
            event.stopPropagation();
            options.onOdds();
          },
        }),
      ),
    ),
  );
}

export function field(label: string, value: string, emphasis = false): HTMLElement {
  return el(
    'div',
    { class: `field${emphasis ? ' emphasis' : ''}` },
    el('span', { class: 'label', text: label }),
    el('span', { class: 'value', text: value }),
  );
}

/** The exact per-outcome table — the same rows as `MATH.md` §5.2, as fractions. */
export function oddsTable(figures: Figures): HTMLElement {
  return el(
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
  );
}
