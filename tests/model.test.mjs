import { describe, expect, it } from 'vitest';
import { F, Frac } from '../tools/lib/exact.mjs';
import {
  CONFIG,
  CONTRACTS,
  CONTRACT_IDS,
  ModelError,
  actionExpectedFactor,
  actionsFor,
  assertLegalAction,
  branches,
  contract,
  enumeratePolicy,
  laneDistribution,
  laneSizes,
  marginalSurvival,
  maxPayoutDP,
  POLICIES,
  probabilityOfZero,
  routeMultiplier,
  sideBetTable,
  stateValueDP,
  survivorDistribution,
} from '../tools/lib/model.mjs';

const N = CONFIG.squadSize;
const K = CONFIG.arenas;

describe('configuration', () => {
  it('declares the published constants', () => {
    expect(CONFIG.squadSize).toBe(5);
    expect(CONFIG.arenas).toBe(5);
    expect(CONFIG.rtp.toString()).toBe('191/200');
    expect(CONFIG.maxWinMultiple).toBe(1000n);
    expect(CONFIG.microCreditsPerCredit).toBe(1_000_000n);
  });

  it('keeps the target RTP inside the mandated 94%-97% band', () => {
    expect(CONFIG.rtp.gte(F(94n, 100n))).toBe(true);
    expect(CONFIG.rtp.lte(F(97n, 100n))).toBe(true);
  });

  it('freezes the declaration', () => {
    expect(Object.isFrozen(CONFIG)).toBe(true);
    expect(Object.isFrozen(CONTRACTS.WIDE)).toBe(true);
  });
});

describe('lane hazard model', () => {
  it('produces an exact probability distribution for every lane size', () => {
    for (const id of CONTRACT_IDS) {
      const spec = CONTRACTS[id];
      for (let size = 0; size <= N; size += 1) {
        const dist = laneDistribution(size, spec.collapse, spec.clear);
        expect(dist).toHaveLength(size + 1);
        const total = dist.reduce((s, p) => s.add(p), Frac.ZERO);
        expect(total.toString()).toBe('1/1');
      }
    }
  });

  it('models an empty lane as certainly producing no survivors', () => {
    const dist = laneDistribution(0, CONTRACTS.SPLIT.collapse, CONTRACTS.SPLIT.clear);
    expect(dist.map(String)).toEqual(['1/1']);
  });

  it('puts a collapse atom at zero survivors that independence alone cannot explain', () => {
    // WIDE with 5 runners: P(0) must exceed (1-q)^5 by the collapse mass.
    const dist = survivorDistribution('WIDE', 5);
    const independentOnly = Frac.ONE.sub(CONTRACTS.WIDE.clear).pow(5);
    expect(dist[0].gt(independentOnly)).toBe(true);
    expect(dist[0].toString()).toBe('4099/102400');
    expect(dist[0].gte(CONTRACTS.WIDE.collapse)).toBe(true);
  });
});

describe('route contracts', () => {
  it('publishes the declared hazard parameters', () => {
    expect([CONTRACTS.WIDE.collapse.toString(), CONTRACTS.WIDE.clear.toString()]).toEqual(['1/25', '7/8']);
    expect([CONTRACTS.SPLIT.collapse.toString(), CONTRACTS.SPLIT.clear.toString()]).toEqual(['1/10', '5/6']);
    expect([CONTRACTS.NARROW.collapse.toString(), CONTRACTS.NARROW.clear.toString()]).toEqual(['1/2', '1/2']);
  });

  it('derives marginal survival and the route multiplier as exact reciprocals', () => {
    expect(marginalSurvival('WIDE').toString()).toBe('21/25');
    expect(marginalSurvival('SPLIT').toString()).toBe('3/4');
    expect(marginalSurvival('NARROW').toString()).toBe('1/4');
    for (const id of CONTRACT_IDS) {
      expect(marginalSurvival(id).mul(routeMultiplier(id)).toString()).toBe('1/1');
    }
    expect(routeMultiplier('WIDE').toString()).toBe('25/21');
    expect(routeMultiplier('SPLIT').toString()).toBe('4/3');
    expect(routeMultiplier('NARROW').toString()).toBe('4/1');
  });

  it('assigns lanes deterministically and exhaustively', () => {
    expect(laneSizes('WIDE', 5)).toEqual([5]);
    expect(laneSizes('NARROW', 3)).toEqual([3]);
    expect(laneSizes('SPLIT', 5)).toEqual([3, 2]);
    expect(laneSizes('SPLIT', 4)).toEqual([2, 2]);
    expect(laneSizes('SPLIT', 3)).toEqual([2, 1]);
    expect(laneSizes('SPLIT', 2)).toEqual([1, 1]);
    for (const id of CONTRACT_IDS) {
      for (let n = CONTRACTS[id].minRunners; n <= N; n += 1) {
        const sizes = laneSizes(id, n);
        expect(sizes).toHaveLength(CONTRACTS[id].laneCount);
        expect(sizes.reduce((a, b) => a + b, 0)).toBe(n);
      }
    }
  });

  it('gives every runner the same marginal survival regardless of lane geometry', () => {
    for (const id of CONTRACT_IDS) {
      const p = marginalSurvival(id);
      for (let n = CONTRACTS[id].minRunners; n <= N; n += 1) {
        const expected = survivorDistribution(id, n).reduce(
          (s, prob, m) => s.add(prob.mul(F(BigInt(m)))),
          Frac.ZERO,
        );
        expect(expected.toString()).toBe(p.mul(F(BigInt(n))).toString());
      }
    }
  });
});

describe('correlation is real and reverses with squad size', () => {
  const wipe = (id, n) => survivorDistribution(id, n)[0];

  it('makes SPLIT dramatically safer than WIDE for a full squad', () => {
    expect(wipe('WIDE', 5).toString()).toBe('4099/102400');
    expect(wipe('SPLIT', 5).toString()).toBe('5/384');
    // 3.07x safer, exactly.
    const ratio = wipe('WIDE', 5).div(wipe('SPLIT', 5));
    expect(ratio.gt(F(3n, 1n))).toBe(true);
    expect(ratio.lt(F(31n, 10n))).toBe(true);
  });

  it('makes SPLIT more dangerous than WIDE for a pair — the crossover', () => {
    expect(wipe('WIDE', 2).toString()).toBe('11/200');
    expect(wipe('SPLIT', 2).toString()).toBe('1/16');
    expect(wipe('SPLIT', 2).gt(wipe('WIDE', 2))).toBe(true);
    // and the crossover really is between 2 and 3 runners
    expect(wipe('SPLIT', 3).lt(wipe('WIDE', 3))).toBe(true);
  });

  it('keeps WIDE total-wipe above the shared collapse floor at every squad size', () => {
    for (let n = 1; n <= N; n += 1) expect(wipe('WIDE', n).gte(CONTRACTS.WIDE.collapse)).toBe(true);
  });
});

describe('stage neutrality — the economic core', () => {
  it('gives every legal action an expected total factor of exactly 1', () => {
    let pairs = 0;
    for (let arena = 1; arena <= K; arena += 1) {
      for (let alive = 1; alive <= N; alive += 1) {
        for (const action of actionsFor(arena, alive)) {
          expect(actionExpectedFactor(action, alive).toString()).toBe('1/1');
          pairs += 1;
        }
      }
    }
    expect(pairs).toBe(140); // 25-state superset of the 21 reachable states
  });

  it('makes every branch table a probability distribution', () => {
    for (let alive = 1; alive <= N; alive += 1) {
      for (const action of actionsFor(2, alive)) {
        const total = branches(action, alive).reduce((s, b) => s.add(b.prob), Frac.ZERO);
        expect(total.toString()).toBe('1/1');
      }
    }
  });

  it('zeroes the claim on a total wipe and banks the full claim on BANK', () => {
    const wipeBranch = branches({ type: 'ROUTE', contract: 'NARROW' }, 5)[0];
    expect(wipeBranch.survivors).toBe(0);
    expect(wipeBranch.claimFactor.toString()).toBe('0/1');
    expect(wipeBranch.bankFactor.toString()).toBe('0/1');

    const bank = branches({ type: 'BANK' }, 3)[0];
    expect(bank.bankFactor.toString()).toBe('1/1');
    expect(bank.claimFactor.toString()).toBe('0/1');
  });

  it('splits SHELTER into an immediate bank plus a WIDE continuation', () => {
    const bs = branches({ type: 'SHELTER', shelter: 2 }, 5);
    expect(bs).toHaveLength(4); // 3 runners continue => 0..3 survivors
    for (const b of bs) expect(b.bankFactor.toString()).toBe('2/5');
    const wide = survivorDistribution('WIDE', 3);
    expect(bs.map((b) => b.prob.toString())).toEqual(wide.map(String));
  });
});

describe('decision space — no policy beats the target RTP', () => {
  const dp = stateValueDP();

  it('gives the best and the worst policy identical value in every state', () => {
    expect(dp.states.length).toBe(K * N);
    for (const state of dp.states) {
      expect(state.max.toString()).toBe('1/1');
      expect(state.min.toString()).toBe('1/1');
    }
  });

  it('gives every individual action the same value as every other', () => {
    for (const state of dp.states) {
      for (const { value } of state.actions) expect(value.toString()).toBe('1/1');
    }
  });

  it('returns exactly 191/200 over the complete outcome space of every named policy', () => {
    for (const [key, { fn }] of Object.entries(POLICIES)) {
      const result = enumeratePolicy(fn);
      expect(result.totalProbability.toString(), key).toBe('1/1');
      expect(result.mean.toString(), key).toBe('191/200');
    }
  });

  it('holds for adaptive policies that condition on observed history', () => {
    const contrarian = (arena, alive) => {
      if (alive === 5) return { type: 'ROUTE', contract: 'NARROW' };
      if (alive === 1) return arena > 1 ? { type: 'BANK' } : { type: 'ROUTE', contract: 'WIDE' };
      return { type: 'SHELTER', shelter: alive - 1 };
    };
    expect(enumeratePolicy(contrarian).mean.toString()).toBe('191/200');
  });

  it('holds for a randomised policy (a convex combination of deterministic ones)', () => {
    // Deterministic surrogate: a fixed pseudo-random schedule over the state index.
    const schedule = ['WIDE', 'NARROW', 'SPLIT', 'NARROW', 'WIDE'];
    const mixed = (arena, alive) => {
      const pick = schedule[(arena * 7 + alive * 3) % schedule.length];
      if (pick === 'SPLIT' && alive < 2) return { type: 'ROUTE', contract: 'WIDE' };
      return { type: 'ROUTE', contract: pick };
    };
    expect(enumeratePolicy(mixed).mean.toString()).toBe('191/200');
  });

  it('lets policies move variance enormously while the mean stays pinned', () => {
    const bolt = enumeratePolicy(POLICIES.BANK_AFTER_ONE.fn);
    const knife = enumeratePolicy(POLICIES.ALL_NARROW.fn);
    expect(bolt.mean.eq(knife.mean)).toBe(true);
    expect(knife.variance.gt(bolt.variance.mul(F(1000n)))).toBe(true);
  });

  it('offers a policy with exactly zero bust probability', () => {
    const keeper = enumeratePolicy(POLICIES.SHELTER_LADDER.fn);
    expect(probabilityOfZero(keeper.distribution).toString()).toBe('0/1');
    expect(keeper.mean.toString()).toBe('191/200');
  });
});

describe('max-win cap', () => {
  it('proves the cap is unreachable by the main game', () => {
    const best = CONFIG.rtp.mul(maxPayoutDP()[1][N]);
    expect(best.toString()).toBe('24448/25');
    expect(best.lt(F(CONFIG.maxWinMultiple))).toBe(true);
  });

  it('derives the maximum from five NARROW arenas with a perfect squad', () => {
    expect(maxPayoutDP()[1][N].toString()).toBe('1024/1');
    expect(routeMultiplier('NARROW').pow(K).toString()).toBe('1024/1');
  });

  it('keeps every side-bet multiplier under the cap', () => {
    for (const row of sideBetTable()) {
      expect(row.multiplier.lte(F(CONFIG.maxWinMultiple)), `${row.bet}/${row.contract}/${row.runners}`).toBe(true);
    }
  });
});

describe('side bets', () => {
  const rows = sideBetTable();

  it('prices every side bet at exactly the target RTP', () => {
    expect(rows.length).toBe(36); // 3 bets x 3 contracts x squad sizes 2..5
    for (const row of rows) {
      expect(row.rtp.toString(), `${row.bet}/${row.contract}/${row.runners}`).toBe('191/200');
      expect(row.multiplier.toString()).toBe(CONFIG.rtp.div(row.probability).toString());
    }
  });

  it('publishes the biggest multiplier in the game', () => {
    const biggest = rows.reduce((m, r) => (r.multiplier.gt(m.multiplier) ? r : m), rows[0]);
    expect(biggest.bet).toBe('SOLE SURVIVOR');
    expect(biggest.contract).toBe('WIDE');
    expect(biggest.runners).toBe(5);
    expect(biggest.multiplier.toString()).toBe('97792/105');
  });

  it('never quotes a zero or infinite multiplier', () => {
    for (const row of rows) {
      expect(row.probability.gt(Frac.ZERO)).toBe(true);
      expect(row.probability.lte(Frac.ONE)).toBe(true);
    }
  });
});

describe('hostile input', () => {
  it('rejects unknown contracts', () => {
    expect(() => contract('TUNNEL')).toThrow(ModelError);
    expect(() => contract('__proto__')).toThrow(/Unknown route contract/);
    expect(() => contract('constructor')).toThrow(/Unknown route contract/);
    expect(() => survivorDistribution('toString', 3)).toThrow(ModelError);
  });

  it('rejects out-of-range squad sizes', () => {
    expect(() => survivorDistribution('WIDE', -1)).toThrow(ModelError);
    expect(() => survivorDistribution('WIDE', 6)).toThrow(ModelError);
    expect(() => survivorDistribution('WIDE', 2.5)).toThrow(ModelError);
    expect(() => survivorDistribution('WIDE', NaN)).toThrow(ModelError);
  });

  it('refuses SPLIT below its minimum squad size', () => {
    expect(() => laneSizes('SPLIT', 1)).toThrow(/at least 2/);
    expect(actionsFor(2, 1).some((a) => a.contract === 'SPLIT')).toBe(false);
    expect(actionsFor(2, 2).some((a) => a.contract === 'SPLIT')).toBe(true);
  });

  it('refuses to bank before the first arena has been run', () => {
    expect(actionsFor(1, 5).some((a) => a.type === 'BANK')).toBe(false);
    expect(actionsFor(2, 5).some((a) => a.type === 'BANK')).toBe(true);
    expect(() => assertLegalAction({ type: 'BANK' }, 1, 5)).toThrow(/illegal/i);
  });

  it('rejects out-of-range arenas', () => {
    expect(() => actionsFor(0, 5)).toThrow(ModelError);
    expect(() => actionsFor(K + 1, 5)).toThrow(ModelError);
    expect(() => actionsFor(1.5, 5)).toThrow(ModelError);
  });

  it('rejects malformed shelter counts', () => {
    expect(() => branches({ type: 'SHELTER', shelter: 0 }, 5)).toThrow(ModelError);
    expect(() => branches({ type: 'SHELTER', shelter: 5 }, 5)).toThrow(ModelError);
    expect(() => branches({ type: 'SHELTER', shelter: -1 }, 5)).toThrow(ModelError);
    expect(() => branches({ type: 'SHELTER', shelter: 1.5 }, 5)).toThrow(ModelError);
    expect(() => assertLegalAction({ type: 'SHELTER', shelter: 9 }, 2, 3)).toThrow(/illegal/i);
  });

  it('rejects unknown or malformed action shapes', () => {
    expect(() => branches({ type: 'TELEPORT' }, 5)).toThrow(ModelError);
    expect(() => assertLegalAction(null, 2, 5)).toThrow(ModelError);
    expect(() => assertLegalAction('BANK', 2, 5)).toThrow(ModelError);
    // A BANK carrying extra fields is not the BANK we offered.
    expect(() => assertLegalAction({ type: 'BANK', contract: 'WIDE' }, 2, 5)).toThrow(/illegal/i);
  });

  it('rejects a policy that is not a function, and one that returns an illegal action', () => {
    expect(() => enumeratePolicy(null)).toThrow(ModelError);
    expect(() => enumeratePolicy(() => ({ type: 'ROUTE', contract: 'SPLIT' }))).toThrow(/illegal/i);
  });

  it('refuses to act with an empty squad', () => {
    expect(actionsFor(3, 0)).toEqual([]);
    expect(() => branches({ type: 'BANK' }, 0)).toThrow(/No runners left/);
  });
});
