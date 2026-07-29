/**
 * The product route menu, and its translation into engine contracts.
 *
 * `docs/DESIGN.md` §3.1 offers four cards — WIDE, SPLIT, NARROW, SHELTER. Three
 * of them are engine contracts; SHELTER is a composition (`MATH.md` §4.1: bank
 * `j` of `n`, run the remaining `n - j` on the WIDE profile) and is presented as
 * a card because that is how it reads to a player.
 *
 * Availability here is the **product's** rule, and it is narrower than the
 * module's. The module filters its menu by `minEntities` alone, which is a floor;
 * the model also has a ceiling on a lead lane (`k >= ceil(n/2)`, the
 * canonicalisation that makes `[3,2]` and `[2,3]` one geometry). A `SPLIT_2`
 * offered to five runners would cut `[2,2,1]` — three lanes, a geometry that
 * appears in no table in `docs/MATH.md`. So the menu is computed here and every
 * command is validated against it before anything reaches the book.
 */
import type { StageContract } from '@axiom-games/reveal-engine/modules/staged-survival';
import { BRANCHFALL, SQUAD_SIZE } from './definition.js';

export type RouteId = 'WIDE' | 'SPLIT' | 'NARROW' | 'SHELTER';

export const ROUTE_ORDER: readonly RouteId[] = Object.freeze([
  'WIDE',
  'SPLIT',
  'NARROW',
  'SHELTER',
]);

/** `docs/DESIGN.md` §3.1's fiction names, in card order. */
export const ROUTE_TITLES: Readonly<Record<RouteId, string>> = Object.freeze({
  WIDE: 'The Broad Bough',
  SPLIT: 'The Fork',
  NARROW: 'The Reach',
  SHELTER: 'The Lamp House',
});

/**
 * Legal lead-lane sizes for a field of `n`: `ceil(n/2) .. n-1`.
 *
 * At `n = 2` and `n = 3` the list has one element, which is why `DESIGN.md` §3.3
 * forbids rendering the fork control at those sizes: a disabled slider implies a
 * choice that does not exist.
 */
export function laneBalances(n: number): readonly number[] {
  const balances: number[] = [];
  for (let k = Math.ceil(n / 2); k <= n - 1; k += 1) balances.push(k);
  return Object.freeze(balances);
}

export function laneSizesFor(n: number, laneSplit: number | null): readonly number[] {
  return laneSplit === null ? [n] : [laneSplit, n - laneSplit];
}

function contract(id: string): StageContract {
  const found = BRANCHFALL.contracts.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown engine contract ${id}`);
  return found;
}

/**
 * The engine contract a committed route runs under.
 *
 * SHELTER runs the remainder on WIDE, so it maps to the same contract WIDE does —
 * with a smaller field, because the sheltered runners have already been banked
 * out of it by the time the stage is chosen.
 */
export function engineContractFor(route: RouteId, laneSplit: number | null): StageContract {
  switch (route) {
    case 'WIDE':
    case 'SHELTER':
      return contract('WIDE');
    case 'NARROW':
      return contract('NARROW');
    case 'SPLIT': {
      if (laneSplit === null) throw new Error('SPLIT requires a lane balance');
      return contract(`SPLIT_${laneSplit}`);
    }
  }
}

export interface MenuEntry {
  readonly route: RouteId;
  /** Balances offered on this card. `[null]` when the geometry is fixed. */
  readonly laneSplits: readonly (number | null)[];
  /** Shelter sizes `1..n-1`. Empty for every other card. */
  readonly shelterSizes: readonly number[];
}

/**
 * The cards on offer to a field of `n`, in the order `DESIGN.md` §S2 fixes.
 *
 * Card order never changes and is never personalised, so this function does not
 * take a player, a history or a balance.
 */
export function menuFor(n: number): readonly MenuEntry[] {
  const entries: MenuEntry[] = [
    { route: 'WIDE', laneSplits: [null], shelterSizes: [] },
  ];
  if (n >= 2)
    entries.push({
      route: 'SPLIT',
      laneSplits: laneBalances(n),
      shelterSizes: [],
    });
  entries.push({ route: 'NARROW', laneSplits: [null], shelterSizes: [] });
  if (n >= 2) {
    const sizes: number[] = [];
    for (let j = 1; j <= n - 1; j += 1) sizes.push(j);
    entries.push({ route: 'SHELTER', laneSplits: [null], shelterSizes: sizes });
  }
  return Object.freeze(entries);
}

/** The geometry a card commits to, once the shelter has taken its runners out. */
export function runningFieldSize(route: RouteId, n: number, shelterCount: number): number {
  return route === 'SHELTER' ? n - shelterCount : n;
}

export interface ValidatedRoute {
  readonly route: RouteId;
  readonly laneSplit: number | null;
  readonly shelter: readonly number[];
  readonly running: number;
  readonly contract: StageContract;
}

export class RouteError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly path?: string,
  ) {
    super(message);
    this.name = 'RouteError';
  }
}

/**
 * Validates one route command against the product menu and the live field.
 *
 * Hostile input is refused here, before a debit, a bank or a decision reaches the
 * book: an unknown card, a lane balance the model does not have at this size, a
 * shelter that is not a distinct subset of the runners actually running, and —
 * the rule `DESIGN.md` §S2 calls the single easiest one to get wrong — a shelter
 * that withdraws the whole squad. `SHELTER(n)` does not exist (`MATH.md` §5.3);
 * every action in the game runs at least one runner.
 */
export function validateRoute(
  live: readonly number[],
  input: { route: unknown; laneSplit?: unknown; shelter?: unknown },
): ValidatedRoute {
  const n = live.length;
  const route = input.route;
  if (typeof route !== 'string' || !ROUTE_ORDER.includes(route as RouteId))
    throw new RouteError('ILLEGAL_ACTION', 'Unknown route', '$.route');
  const entry = menuFor(n).find((candidate) => candidate.route === route);
  if (!entry)
    throw new RouteError('ILLEGAL_ACTION', 'That route is not offered at this squad size', '$.route');

  let shelter: number[] = [];
  if (route === 'SHELTER') {
    const raw = input.shelter;
    if (!Array.isArray(raw))
      throw new RouteError('ILLEGAL_ACTION', 'A shelter names the runners it brings home', '$.shelter');
    const seen = new Set<number>();
    for (const slot of raw) {
      if (!Number.isSafeInteger(slot) || !live.includes(slot as number) || seen.has(slot as number))
        throw new RouteError('ILLEGAL_ACTION', 'A shelter takes distinct running runners', '$.shelter');
      seen.add(slot as number);
    }
    shelter = [...seen].sort((left, right) => left - right);
    if (shelter.length < 1 || shelter.length > n - 1)
      throw new RouteError(
        'ILLEGAL_ACTION',
        'One has to run. You can bank the rest after this branch.',
        '$.shelter',
      );
  } else {
    const raw = input.shelter;
    // JSON has one natural spelling for “no shelter”: `null`. Treat it like an
    // omitted field, just as the sibling lane-balance guard does below. Anything
    // else still has to be the one harmless explicit representation, an empty
    // list; reading `.length` before proving the value is an array turned a
    // malformed player command into an operator 500.
    if (raw !== null && raw !== undefined && (!Array.isArray(raw) || raw.length !== 0))
      throw new RouteError('ILLEGAL_ACTION', 'Only a shelter withdraws runners', '$.shelter');
  }

  const running = runningFieldSize(route as RouteId, n, shelter.length);

  let laneSplit: number | null = null;
  if (route === 'SPLIT') {
    const balances = laneBalances(running);
    const raw = input.laneSplit;
    if (raw === null || raw === undefined) {
      if (balances.length !== 1)
        throw new RouteError('INVALID_LANE_SPLIT', 'The fork needs a balance', '$.laneSplit');
      laneSplit = balances[0] as number;
    } else {
      if (!Number.isSafeInteger(raw) || !balances.includes(raw as number))
        throw new RouteError(
          'INVALID_LANE_SPLIT',
          `Lane balance must be one of ${balances.join(', ')} at ${running} runners`,
          '$.laneSplit',
        );
      laneSplit = raw as number;
    }
  } else if (input.laneSplit !== undefined && input.laneSplit !== null) {
    throw new RouteError('INVALID_LANE_SPLIT', 'Only the fork has a lane balance', '$.laneSplit');
  }

  if (running < 1 || running > SQUAD_SIZE)
    throw new RouteError('ILLEGAL_ACTION', 'No runner is left to run this branch', '$.route');

  return Object.freeze({
    route: route as RouteId,
    laneSplit,
    shelter: Object.freeze(shelter),
    running,
    contract: engineContractFor(route as RouteId, laneSplit),
  });
}
