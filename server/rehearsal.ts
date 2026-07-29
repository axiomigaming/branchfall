/**
 * The rehearsal: three branches, no stake, the real model.
 *
 * **This module has no money in it, and that is enforced by its imports.** It
 * reaches the definition, the derivation and the resolver, and it cannot reach
 * the book, the wallet or a receipt — `ENGINE.md` §10.2 makes that a hard build
 * rule and `tests/rehearsal-quarantine.test.mjs` asserts the module graph rather
 * than trusting this paragraph. There is no `rehearsal: true` flag threaded
 * through the money path, because a boolean on the money path is one mis-branch
 * away from handing a live round's tape to a client.
 *
 * It is the one place a client legitimately holds a table. The difference is not
 * the table — it is that there is no stake, no side bet, no wallet handle and no
 * ledger entry anywhere in here, so foreknowledge is worth exactly nothing.
 *
 * Every figure it returns is a **multiple of a notional stake**. Nothing here is
 * ever rendered as a balance, a total or a result (`DESIGN.md` §5.2.7).
 */
import { add, floor, multiply, rational, type Rational } from '@axiom-games/reveal-engine/core';
import {
  deriveSteps,
  deriveTruth,
  roundRefId,
  type SurvivalChoice,
  type SurvivalStep,
} from '@axiom-games/reveal-engine/modules/staged-survival';
import {
  ARENA_NAMES,
  ARENA_SUBTITLES,
  BRANCHFALL,
  DEFAULT_RUNNER_NAMES,
  ENTRY_RETURN,
  SQUAD_SIZE,
} from './definition.js';
import { RouteError, engineContractFor, validateRoute, type RouteId } from './geometry.js';
import { ghostLines, type GhostRow } from './ghost.js';
import { decimals, fraction, view } from './money.js';
import { figuresFor } from './paytable.js';
import { REHEARSAL_SEED_PAIR } from './rehearsal-seed.js';

/** Three branches, not five (`DESIGN.md` §5.2.3). */
export const REHEARSAL_ARENAS = 3;

/**
 * Progressive disclosure, exactly as `DESIGN.md` §5.2.5 tables it.
 *
 * Additive only, and the odds of a route are never gated even when the card is
 * not offered: *"Not offering a card and hiding its numbers are different acts
 * and we only do the first."*
 */
export const REHEARSAL_DISCLOSURE: readonly (readonly RouteId[])[] = Object.freeze([
  Object.freeze(['WIDE', 'NARROW'] as RouteId[]),
  Object.freeze(['WIDE', 'SPLIT', 'NARROW'] as RouteId[]),
  Object.freeze(['WIDE', 'SPLIT', 'NARROW', 'SHELTER'] as RouteId[]),
]);

export interface RehearsalChoiceInput {
  readonly route?: unknown;
  readonly laneSplit?: unknown;
  readonly shelter?: unknown;
}

export function rehearsalRef(): string {
  return roundRefId({
    roundId: REHEARSAL_SEED_PAIR.roundId,
    clientEntropy: REHEARSAL_SEED_PAIR.clientEntropy,
  });
}

export function rehearsalTruth() {
  return deriveTruth(REHEARSAL_SEED_PAIR.serverSeed, BRANCHFALL, rehearsalRef());
}

export interface RehearsalArena {
  readonly index: number;
  readonly name: string;
  readonly subtitle: string;
  readonly route: RouteId;
  readonly laneSplit: number | null;
  readonly shelter: readonly { readonly slot: number; readonly name: string }[];
  readonly lanes: readonly {
    readonly entities: readonly { readonly slot: number; readonly name: string }[];
    readonly collapsed: boolean;
  }[];
  readonly survivors: readonly { readonly slot: number; readonly name: string }[];
  readonly fallen: readonly { readonly slot: number; readonly name: string }[];
  readonly running: number;
  readonly claimBefore: string;
  readonly claimAfter: string;
  readonly bankedHere: string;
  readonly arithmetic: string;
}

export interface RehearsalResult {
  readonly seedPair: typeof REHEARSAL_SEED_PAIR;
  readonly tapeDigest: string;
  readonly arenas: readonly RehearsalArena[];
  readonly claim: string;
  readonly banked: string;
  readonly total: string;
  readonly running: readonly { readonly slot: number; readonly name: string }[];
  readonly over: boolean;
  readonly wiped: boolean;
  readonly ghost: readonly GhostRow[];
  /** Always. There is no payout of any kind in a rehearsal. */
  readonly payout: null;
}

const name = (slot: number) => DEFAULT_RUNNER_NAMES[slot] ?? `Runner ${slot}`;
const named = (slots: readonly number[]) => slots.map((slot) => ({ slot, name: name(slot) }));

/**
 * Replays a rehearsal from its logged choices.
 *
 * Stateless: the client holds the decision list and this recomputes the whole run
 * from the published pair every time, which is what makes the rehearsal the same
 * object as the game rather than a tutorial state machine that can drift out of
 * sync with it.
 */
export function replay(input: readonly RehearsalChoiceInput[]): RehearsalResult {
  if (!Array.isArray(input) || input.length > REHEARSAL_ARENAS)
    throw new RouteError('ILLEGAL_ACTION', 'A rehearsal is three branches', '$.choices');

  const truth = rehearsalTruth();
  const choices: SurvivalChoice[] = [];
  const meta: { route: RouteId; laneSplit: number | null; shelter: readonly number[] }[] = [];
  let live: number[] = Array.from({ length: SQUAD_SIZE }, (_value, slot) => slot);

  for (const [index, choice] of input.entries()) {
    if (live.length === 0)
      throw new RouteError('ILLEGAL_ACTION', 'Nobody is left to run', `$.choices[${index}]`);
    const offered = REHEARSAL_DISCLOSURE[index] ?? REHEARSAL_DISCLOSURE[REHEARSAL_DISCLOSURE.length - 1];
    const action = validateRoute(live, choice);
    if (!offered?.includes(action.route))
      throw new RouteError(
        'ILLEGAL_ACTION',
        'That card is not on offer in this branch of the rehearsal',
        `$.choices[${index}].route`,
      );
    choices.push({ contractId: action.contract.id, banked: [...action.shelter] });
    meta.push({ route: action.route, laneSplit: action.laneSplit, shelter: action.shelter });
    const steps = deriveSteps(BRANCHFALL, truth, choices);
    const step = steps[index] as SurvivalStep;
    live = [...step.survivors];
  }

  const steps = deriveSteps(BRANCHFALL, truth, choices);
  let claim: Rational = ENTRY_RETURN;
  let banked: Rational = rational(0n);
  let running: number[] = Array.from({ length: SQUAD_SIZE }, (_value, slot) => slot);
  const arenas: RehearsalArena[] = [];

  steps.forEach((step, index) => {
    const info = meta[index] as { route: RouteId; laneSplit: number | null; shelter: readonly number[] };
    const before = claim;
    let bankedHere: Rational = rational(0n);
    if (info.shelter.length > 0) {
      bankedHere = multiply(claim, rational(BigInt(info.shelter.length), BigInt(running.length)));
      banked = add(banked, bankedHere);
      claim = multiply(claim, rational(BigInt(running.length - info.shelter.length), BigInt(running.length)));
    }
    const runningNow = running.filter((slot) => !info.shelter.includes(slot));
    const contract = engineContractFor(info.route, info.laneSplit);
    const multiplier = rational(contract.multiplier.numerator, contract.multiplier.denominator);
    const factor = multiply(
      rational(BigInt(step.survivors.length), BigInt(runningNow.length)),
      multiplier,
    );
    const after = multiply(claim, factor);
    arenas.push({
      index: index + 1,
      name: ARENA_NAMES[index] ?? '',
      subtitle: ARENA_SUBTITLES[index] ?? '',
      route: info.route,
      laneSplit: info.laneSplit,
      shelter: named([...info.shelter]),
      lanes: step.lanes.map((lane) => ({
        entities: named([...lane.entities]),
        collapsed: lane.collapsed,
      })),
      survivors: named([...step.survivors]),
      fallen: named([...step.failed]),
      running: runningNow.length,
      claimBefore: decimals(before, 3),
      claimAfter: decimals(after, 3),
      bankedHere: decimals(bankedHere, 3),
      arithmetic: `${decimals(claim, 3)} x (${step.survivors.length}/${runningNow.length}) x ${decimals(multiplier, 3)} = ${decimals(after, 3)}`,
    });
    claim = after;
    running = [...step.survivors];
  });

  const wiped = steps.length > 0 && running.length === 0;
  const over = wiped || steps.length >= REHEARSAL_ARENAS;

  return {
    seedPair: REHEARSAL_SEED_PAIR,
    tapeDigest: truth.digest,
    arenas: Object.freeze(arenas),
    claim: decimals(claim, 3),
    banked: decimals(banked, 3),
    total: decimals(add(banked, claim), 3),
    running: named(running),
    over,
    wiped,
    ghost: over ? ghostLines(truth, choices, name) : [],
    payout: null,
  };
}

/** The cards on offer for a rehearsal branch, with their full odds. */
export function rehearsalMenu(index: number, running: number) {
  const offered = REHEARSAL_DISCLOSURE[index] ?? REHEARSAL_DISCLOSURE[REHEARSAL_DISCLOSURE.length - 1];
  return (offered ?? []).map((route) => ({
    route,
    figures:
      route === 'SHELTER'
        ? figuresFor('WIDE', Math.max(1, running - 1), null)
        : figuresFor(route, running, route === 'SPLIT' ? Math.ceil(running / 2) : null),
  }));
}

export const REHEARSAL_CLAIM_OPEN = {
  exact: fraction(ENTRY_RETURN),
  display: decimals(ENTRY_RETURN, 3),
  perRunner: decimals(rational(ENTRY_RETURN.numerator, ENTRY_RETURN.denominator * BigInt(SQUAD_SIZE)), 3),
  view: view(ENTRY_RETURN, 6),
  floorGuard: floor(rational(0n)).toString(),
};
