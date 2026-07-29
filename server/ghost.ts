/**
 * The Ghost Line — the road not travelled, provably fixed in advance.
 *
 * Because the tape is counterfactually complete, the branch a player did not take
 * was already decided when they chose. Replaying it is a proof artefact and not a
 * flourish: it is the same tape, read at a different address, and anyone holding
 * the revealed seed can reproduce it.
 *
 * It is computed by handing the module a **different decision log** — the same
 * prefix, one substituted choice — rather than by reaching into the tape's own
 * addressing. That is the difference between using the engine and re-implementing
 * it, and it means a change to the module's layout can never make this quietly
 * wrong.
 *
 * `docs/DESIGN.md` §10.6 bounds what it may show: who fell and where, **never** a
 * counterfactual money figure. There is no "you would have won" in this file, and
 * there is no code path that could produce one.
 */
import {
  deriveSteps,
  type SurvivalChoice,
  type SurvivalStep,
  type SurvivalTruth,
} from '@axiom-games/reveal-engine/modules/staged-survival';
import { BRANCHFALL, SQUAD_SIZE } from './definition.js';
import { laneBalances, type RouteId } from './geometry.js';

export interface GhostRow {
  readonly arena: number;
  readonly route: RouteId;
  readonly laneSplit: number | null;
  readonly contractId: string;
  readonly taken: boolean;
  readonly lanes: readonly { readonly runners: readonly string[]; readonly collapsed: boolean }[];
  readonly survivors: readonly string[];
  readonly fallen: readonly string[];
}

function liveBefore(truth: SurvivalTruth, prefix: readonly SurvivalChoice[]): readonly number[] {
  if (prefix.length === 0) return Array.from({ length: SQUAD_SIZE }, (_value, slot) => slot);
  const steps = deriveSteps(BRANCHFALL, truth, prefix);
  return steps[steps.length - 1]?.survivors ?? [];
}

function routeOf(contractId: string): { route: RouteId; laneSplit: number | null } {
  if (contractId.startsWith('SPLIT_'))
    return { route: 'SPLIT', laneSplit: Number.parseInt(contractId.slice(6), 10) };
  return { route: contractId === 'NARROW' ? 'NARROW' : 'WIDE', laneSplit: null };
}

/**
 * Every route the player could have taken at each arena they played, replayed.
 *
 * SHELTER is not enumerated as a separate row: it runs the remainder on the WIDE
 * profile, so its counterfactual is the WIDE row at the field it would have left
 * running, and inventing a fourth row would imply a fourth geometry the model
 * does not have.
 */
export function ghostLines(
  truth: SurvivalTruth,
  choices: readonly SurvivalChoice[],
  nameOf: (slot: number) => string,
): readonly GhostRow[] {
  const rows: GhostRow[] = [];
  choices.forEach((choice, index) => {
    const prefix = choices.slice(0, index);
    const running = liveBefore(truth, prefix).filter((slot) => !choice.banked.includes(slot));
    if (running.length === 0) return;
    const candidates: string[] = ['WIDE', 'NARROW'];
    for (const k of laneBalances(running.length)) candidates.push(`SPLIT_${k}`);
    for (const contractId of candidates) {
      const steps = deriveSteps(BRANCHFALL, truth, [
        ...prefix,
        { contractId, banked: [...choice.banked] },
      ]);
      const step = steps[index] as SurvivalStep;
      const { route, laneSplit } = routeOf(contractId);
      rows.push({
        arena: index + 1,
        route,
        laneSplit,
        contractId,
        taken: contractId === choice.contractId,
        lanes: step.lanes.map((lane) => ({
          runners: lane.entities.map(nameOf),
          collapsed: lane.collapsed,
        })),
        survivors: step.survivors.map(nameOf),
        fallen: step.failed.map(nameOf),
      });
    }
  });
  return Object.freeze(rows);
}
