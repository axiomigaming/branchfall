/**
 * Every number on a route card, derived from the engine.
 *
 * `docs/DESIGN.md` §11.3: *"the route cards and the fork control read their
 * numbers from the same tables `tools/enumerate.mjs` publishes. If the enumerator
 * and the card disagree, the build fails."* This module is the first half of
 * that. It computes each card's figures from
 * `survivorDistribution()` — the engine's own exact convolution of the lane law —
 * and `tests/paytable-agrees-with-enumeration.test.mjs` is the second half: it
 * asserts these figures equal `tools/enumerate.mjs --json` fraction for fraction,
 * so two independent implementations of the same model agree before a card can
 * show a digit.
 *
 * Nothing is cached against a mutable key and nothing is rounded on the way in.
 */
import {
  add,
  compare,
  divide,
  multiply,
  rational,
  type Rational,
} from '@axiom-games/reveal-engine/core';
import {
  marginalSurvival,
  survivorDistribution,
} from '@axiom-games/reveal-engine/modules/staged-survival';
import { BRANCHFALL, ENTRY_RETURN, SQUAD_SIZE } from './definition.js';
import { engineContractFor, laneBalances, laneSizesFor, type RouteId } from './geometry.js';
import { fraction, percent, rounded, view, viewRounded, type WireRationalView } from './money.js';

const ZERO = rational(0n);
const ONE = rational(1n);

export type SideBetId = 'CLEAN_SWEEP' | 'SOLE_SURVIVOR' | 'LAST_LIGHT';

export const SIDE_BETS: readonly {
  readonly id: SideBetId;
  readonly label: string;
  readonly claim: string;
}[] = Object.freeze([
  { id: 'CLEAN_SWEEP', label: 'Clean Sweep', claim: 'Everybody makes it.' },
  { id: 'SOLE_SURVIVOR', label: 'Sole Survivor', claim: 'One light comes out.' },
  { id: 'LAST_LIGHT', label: 'Last Light', claim: 'Nobody makes it.' },
]);

/** `docs/MATH.md` §5.5: offered only when at least two runners are running. */
export const SIDE_BET_MIN_RUNNERS = 2;

/** The exact survivor law of a running field under a committed geometry. */
export function distributionFor(
  route: Exclude<RouteId, 'SHELTER'> | 'SHELTER',
  running: number,
  laneSplit: number | null,
): readonly Rational[] {
  return survivorDistribution(BRANCHFALL, engineContractFor(route, laneSplit), running);
}

/** `P(event)` under the committed geometry, read straight out of its own law. */
export function sideBetProbability(
  distribution: readonly Rational[],
  bet: SideBetId,
): Rational {
  const running = distribution.length - 1;
  switch (bet) {
    case 'CLEAN_SWEEP':
      return distribution[running] as Rational;
    case 'SOLE_SURVIVOR':
      return distribution[1] as Rational;
    case 'LAST_LIGHT':
      return distribution[0] as Rational;
  }
}

/** `multiplier = r / P(event | committed geometry)`. The only pricing rule there is. */
export function sideBetMultiplier(probability: Rational): Rational {
  if (compare(probability, ZERO) === 0)
    throw new Error('A side bet with probability zero has no price');
  return divide(ENTRY_RETURN, probability);
}

export interface OutcomeRow {
  readonly survivors: number;
  readonly probability: WireRationalView;
  readonly claimFactor: WireRationalView;
  readonly direction: 'grows' | 'holds' | 'falls' | 'wipe';
}

export interface SideBetOffer {
  readonly id: SideBetId;
  readonly label: string;
  readonly claim: string;
  readonly probability: WireRationalView;
  readonly probabilityPct: string;
  readonly multiplier: WireRationalView;
}

export interface GeometryFigures {
  readonly route: RouteId;
  readonly contractId: string;
  readonly running: number;
  readonly laneSplit: number | null;
  readonly lanes: readonly number[];
  readonly multiplier: WireRationalView;
  readonly outcomes: readonly OutcomeRow[];
  readonly wipe: WireRationalView;
  readonly allClear: WireRationalView;
  readonly sole: WireRationalView;
  readonly expectedSurvivors: WireRationalView;
  readonly breakEven: number;
  readonly claimFactorAtBreakEven: WireRationalView;
  readonly grows: WireRationalView;
  readonly holds: WireRationalView;
  readonly fallsNonZero: WireRationalView;
  readonly sideBets: readonly SideBetOffer[];
  /** Rendered percentages, so a card never formats a number itself. */
  readonly display: {
    readonly multiplier: string;
    readonly wipePct: string;
    readonly allClearPct: string;
    readonly solePct: string;
    readonly growsPct: string;
    readonly holdsPct: string;
    readonly fallsNonZeroPct: string;
    readonly expectedSurvivors: string;
  };
}

/**
 * One card's complete figures.
 *
 * `breakEven` is `ceil(n p)` — `MATH.md` §5.2.1's *"single number that makes the
 * money rule legible"* — computed as the smallest survivor count whose claim
 * factor is at least one rather than by a ceiling on a float. `DESIGN.md` §3.2
 * makes it a card field, in the same weight as the rest, at every squad size.
 */
export function figuresFor(
  route: RouteId,
  running: number,
  laneSplit: number | null,
): GeometryFigures {
  const contract = engineContractFor(route, laneSplit);
  const distribution = survivorDistribution(BRANCHFALL, contract, running);
  const multiplier = rational(contract.multiplier.numerator, contract.multiplier.denominator);

  const outcomes: OutcomeRow[] = [];
  let grows = ZERO;
  let holds = ZERO;
  let fallsNonZero = ZERO;
  let expected = ZERO;
  let breakEven = running;
  let breakEvenFactor = multiply(rational(BigInt(running), BigInt(running)), multiplier);
  let breakEvenFound = false;

  for (let m = 0; m <= running; m += 1) {
    const probability = distribution[m] as Rational;
    const factor = multiply(rational(BigInt(m), BigInt(running)), multiplier);
    expected = add(expected, multiply(rational(BigInt(m)), probability));
    const relation = compare(factor, ONE);
    let direction: OutcomeRow['direction'];
    if (m === 0) {
      direction = 'wipe';
    } else if (relation > 0) {
      direction = 'grows';
      grows = add(grows, probability);
    } else if (relation === 0) {
      direction = 'holds';
      holds = add(holds, probability);
    } else {
      direction = 'falls';
      fallsNonZero = add(fallsNonZero, probability);
    }
    if (!breakEvenFound && relation >= 0) {
      breakEven = m;
      breakEvenFactor = factor;
      breakEvenFound = true;
    }
    outcomes.push({
      survivors: m,
      probability: viewRounded(probability, 12),
      claimFactor: viewRounded(factor, 8),
      direction,
    });
  }

  const wipe = distribution[0] as Rational;
  const allClear = distribution[running] as Rational;
  const sole = running >= 1 ? (distribution[1] as Rational) : ZERO;

  const sideBets: SideBetOffer[] =
    running >= SIDE_BET_MIN_RUNNERS
      ? SIDE_BETS.map((bet) => {
          const probability = sideBetProbability(distribution, bet.id);
          return {
            id: bet.id,
            label: bet.label,
            claim: bet.claim,
            probability: viewRounded(probability, 12),
            probabilityPct: percent(probability, 4),
            multiplier: viewRounded(sideBetMultiplier(probability), 8),
          };
        })
      : [];

  return {
    route,
    contractId: contract.id,
    running,
    laneSplit,
    lanes: laneSizesFor(running, laneSplit),
    multiplier: viewRounded(multiplier, 8),
    outcomes: Object.freeze(outcomes),
    wipe: viewRounded(wipe, 12),
    allClear: viewRounded(allClear, 12),
    sole: viewRounded(sole, 12),
    expectedSurvivors: viewRounded(expected, 6),
    breakEven,
    claimFactorAtBreakEven: viewRounded(breakEvenFactor, 8),
    grows: viewRounded(grows, 12),
    holds: viewRounded(holds, 12),
    fallsNonZero: viewRounded(fallsNonZero, 12),
    sideBets: Object.freeze(sideBets),
    display: {
      multiplier: `${rounded(multiplier, 3)}x`,
      wipePct: percent(wipe),
      allClearPct: percent(allClear),
      solePct: percent(sole),
      growsPct: percent(grows),
      holdsPct: percent(holds),
      fallsNonZeroPct: percent(fallsNonZero),
      expectedSurvivors: rounded(expected, 2),
    },
  };
}

/** The marginal `p` of a contract, for the copy that states it. */
export function marginalFor(route: RouteId, laneSplit: number | null): string {
  return fraction(marginalSurvival(engineContractFor(route, laneSplit)));
}

/**
 * Every geometry the game can offer, keyed `ROUTE:running[:balance]`.
 *
 * Built once at boot and frozen. It is what the client is served, so a card can
 * never compute a probability of its own.
 */
export function fullPaytable(): Record<string, GeometryFigures> {
  const table: Record<string, GeometryFigures> = {};
  for (let n = 1; n <= SQUAD_SIZE; n += 1) {
    table[`WIDE:${n}`] = figuresFor('WIDE', n, null);
    table[`NARROW:${n}`] = figuresFor('NARROW', n, null);
    for (const k of laneBalances(n)) table[`SPLIT:${n}:${k}`] = figuresFor('SPLIT', n, k);
  }
  return table;
}

export function geometryKey(route: RouteId, running: number, laneSplit: number | null): string {
  const card = route === 'SHELTER' ? 'WIDE' : route;
  return laneSplit === null ? `${card}:${running}` : `${card}:${running}:${laneSplit}`;
}
