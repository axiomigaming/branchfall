/**
 * The HTTP surface.
 *
 * Node's own `http`, one router, no framework. Every route is a thin adapter over
 * `RoundStore`: parse, dispatch, serialise, map a typed failure onto a status
 * code. Nothing decides anything here.
 *
 * Failure codes are the engine's and the store's, and they are stable and
 * machine-branchable (`ENGINE.md` §5): an integration branches on `code`, never
 * on message text.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer, type Server } from 'node:http';
import { checkModuleConformance } from '@axiom-games/reveal-engine/conformance';
import { stagedSurvival } from '@axiom-games/reveal-engine/modules/staged-survival';
import { Clock } from './clock.js';
import {
  ARENAS,
  ARENA_NAMES,
  ARENA_SUBTITLES,
  BRANCHFALL,
  DEFAULT_RUNNER_NAMES,
  FINGERPRINT,
  MAX_STAKE_MICRO,
  MAX_WIN_MULTIPLE,
  MIN_GAME_CYCLE_MS,
  MIN_STAKE_MICRO,
  SPEED,
  SQUAD_SIZE,
  assertGeometryMatchesSpecification,
} from './definition.js';
import { ROUTE_TITLES } from './geometry.js';
import { credits, decimals, fraction, percent } from './money.js';
import { fullPaytable, SIDE_BETS } from './paytable.js';
import { REHEARSAL_SEED_PAIR } from './rehearsal-seed.js';
import { REHEARSAL_ARENAS, REHEARSAL_DISCLOSURE, replay } from './rehearsal.js';
import { RouteError } from './geometry.js';
import { MIN_SIDE_BET_MICRO } from './sidebets.js';
import { RoundError, RoundStore, bundleFor, frameOf, ghostFor } from './rounds.js';
import { verifyBundle } from './verify.js';
import { Wallet } from './wallet.js';
import { ENTRY_RETURN } from './definition.js';

const MAX_BODY_BYTES = 256 * 1024;

export interface Session {
  /** `DESIGN.md` §5.2.5 rule 3: the counter is rounds seen. Never spend, never losses. */
  roundsSeen: number;
  showEverything: boolean;
  sideBetsOptedIn: boolean;
  ghostLineEnabled: boolean;
  rehearsalSeen: boolean;
  reducedMotion: boolean;
  readonly startedAtMs: number;
  runnerNames: string[];
}

export interface AppOptions {
  readonly openingBalanceMicro?: bigint;
  readonly devClock?: boolean;
  readonly staticRoot?: string;
  /** Test-only. See `RoundStore.seedSource`; unreachable from the network. */
  readonly seedSource?: () => string;
  /** Test-only. See `RoundStore.roundIdSource`. */
  readonly roundIdSource?: (counter: number) => string;
  /** The operator's expiry window. Default 24 h (`DESIGN.md` §2.1). */
  readonly expiryWindowMs?: number;
}

export interface App {
  readonly server: Server;
  readonly store: RoundStore;
  readonly wallet: Wallet;
  readonly clock: Clock;
  readonly session: Session;
}

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RoundError('INVALID_ARGUMENT', 'Request body too large', 413);
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new RoundError('INVALID_ARGUMENT', 'Body is not JSON', 400);
  }
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function serveStatic(root: string, urlPath: string, response: ServerResponse): boolean {
  const relative = normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/u, '');
  const file = resolve(join(root, relative));
  if (!file.startsWith(resolve(root)) || !existsSync(file) || !statSync(file).isFile()) return false;
  response.writeHead(200, {
    'content-type': MIME[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(response);
  return true;
}

/**
 * Everything the client needs to render a correct screen, computed once.
 *
 * The paytable is in here because `DESIGN.md` §11.3 forbids the alternative: a
 * card that computes a probability of its own is a card that can disagree with
 * the model. The client is a renderer.
 */
function configPayload() {
  return {
    game: {
      id: BRANCHFALL.id,
      version: BRANCHFALL.version,
      fingerprint: FINGERPRINT,
      moduleId: stagedSurvival.id,
      moduleVersion: stagedSurvival.version,
      engineApi: BRANCHFALL.apiVersion,
      squadSize: SQUAD_SIZE,
      arenas: ARENAS,
      arenaNames: ARENA_NAMES,
      arenaSubtitles: ARENA_SUBTITLES,
      defaultRunnerNames: DEFAULT_RUNNER_NAMES,
      routeTitles: ROUTE_TITLES,
    },
    money: {
      rtpExact: fraction(ENTRY_RETURN),
      rtpPct: percent(ENTRY_RETURN, 1),
      rtpPct4: percent(ENTRY_RETURN, 4),
      houseEdgePct: '4.5%',
      minStakeMicro: MIN_STAKE_MICRO.toString(),
      maxStakeMicro: MAX_STAKE_MICRO.toString(),
      minStakeCredits: credits(MIN_STAKE_MICRO, 2),
      maxStakeCredits: credits(MAX_STAKE_MICRO, 2),
      microPerCredit: '1000000',
      maxWinMultiple: MAX_WIN_MULTIPLE.toString(),
      sideBetMinMicro: MIN_SIDE_BET_MICRO.toString(),
      sideBetRatio: '1/2',
      claimOpensAt: decimals(ENTRY_RETURN, 3),
    },
    speed: { ...SPEED, minGameCycleMs: MIN_GAME_CYCLE_MS },
    sideBets: SIDE_BETS,
    rehearsal: {
      arenas: REHEARSAL_ARENAS,
      disclosure: REHEARSAL_DISCLOSURE,
      seedPair: REHEARSAL_SEED_PAIR,
    },
    paytable: fullPaytable(),
  };
}

export function createApp(options: AppOptions = {}): App {
  assertGeometryMatchesSpecification();
  const clock = new Clock(options.devClock === true);
  const wallet = new Wallet(options.openingBalanceMicro ?? 500_000_000n, () => clock.now());
  const store = new RoundStore(wallet, clock, options.expiryWindowMs ?? 24 * 60 * 60 * 1000);
  if (options.seedSource) store.seedSource = options.seedSource;
  if (options.roundIdSource) store.roundIdSource = options.roundIdSource;
  const session: Session = {
    roundsSeen: 0,
    showEverything: false,
    sideBetsOptedIn: false,
    ghostLineEnabled: false,
    rehearsalSeen: false,
    reducedMotion: false,
    startedAtMs: clock.now(),
    runnerNames: [...DEFAULT_RUNNER_NAMES],
  };
  const staticRoot = options.staticRoot ?? resolve(process.cwd(), 'client/dist');
  const config = configPayload();

  const sessionPayload = () => {
    const open = store.openRound;
    return {
      session: {
        ...session,
        elapsedMs: clock.now() - session.startedAtMs,
        /**
         * `DESIGN.md` §5.2.5: disclosure is keyed to rounds seen and to nothing
         * else. A gate keyed to spend is a monetisation device pretending to be
         * a tutorial.
         */
        stage: session.showEverything ? 'full' : session.roundsSeen >= 3 ? 'full' : 'early',
      },
      wallet: {
        balanceMicro: wallet.balanceMicro.toString(),
        balanceDisplay: credits(wallet.balanceMicro, 2),
        stakedMicro: wallet.stakedMicro.toString(),
        creditedMicro: wallet.creditedMicro.toString(),
        netMicro: wallet.netMicro.toString(),
        netDisplay: credits(wallet.netMicro < 0n ? -wallet.netMicro : wallet.netMicro, 2),
        netSign: wallet.netMicro < 0n ? '-' : '+',
        entries: wallet.entries.slice(-24).map((entry) => ({
          ...entry,
          amountMicro: entry.amountMicro.toString(),
          balanceAfterMicro: entry.balanceAfterMicro.toString(),
        })),
      },
      openRoundId: open?.roundId ?? null,
      serverNowMs: clock.now(),
    };
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const path = url.pathname;
      const method = request.method ?? 'GET';
      try {
        if (method === 'GET' && !path.startsWith('/api/')) {
          if (serveStatic(staticRoot, path, response)) return;
          if (serveStatic(staticRoot, '/index.html', response)) return;
          json(response, 404, { code: 'NOT_FOUND', message: 'No such file' });
          return;
        }

        // ------------------------------------------------------------ reads
        if (method === 'GET' && path === '/api/config') return json(response, 200, config);
        if (method === 'GET' && path === '/api/session') return json(response, 200, sessionPayload());
        if (method === 'GET' && path === '/api/paytable')
          return json(response, 200, { paytable: config.paytable });
        if (method === 'GET' && path === '/api/conformance') {
          const report = checkModuleConformance(stagedSurvival, BRANCHFALL);
          return json(response, report.ok ? 200 : 500, report);
        }
        if (method === 'GET' && path === '/api/rehearsal')
          return json(response, 200, {
            seedPair: REHEARSAL_SEED_PAIR,
            arenas: REHEARSAL_ARENAS,
            disclosure: REHEARSAL_DISCLOSURE,
            result: replay([]),
          });

        const roundMatch = /^\/api\/rounds\/([^/]+)(\/[a-z-]+)?$/u.exec(path);
        if (roundMatch) {
          const roundId = decodeURIComponent(roundMatch[1] as string);
          const action = roundMatch[2] ?? '';
          if (method === 'GET' && action === '') {
            const round = store.get(roundId);
            return json(response, 200, { frame: frameOf(round, store), ...sessionPayload() });
          }
          if (method === 'GET' && action === '/verify') {
            const round = store.get(roundId);
            const bundle = bundleFor(round);
            return json(response, 200, {
              bundle,
              report: verifyBundle(bundle),
              ghost: session.ghostLineEnabled ? ghostFor(round) : [],
              ghostAvailable: true,
            });
          }
          const body = (await readBody(request)) as Record<string, unknown>;
          if (method === 'POST' && action === '/open') {
            const round = await store.open(roundId, body);
            return json(response, 200, { frame: frameOf(round, store), ...sessionPayload() });
          }
          if (method === 'POST' && action === '/commit') {
            const result = await store.commit(roundId, body);
            const round = store.get(roundId);
            return json(response, 200, { ...(result as object), frame: frameOf(round, store), ...sessionPayload() });
          }
          if (method === 'POST' && action === '/resolve') {
            const result = await store.resolve(roundId, body);
            const round = store.get(roundId);
            return json(response, 200, { ...(result as object), frame: frameOf(round, store), ...sessionPayload() });
          }
          if (method === 'POST' && action === '/bank') {
            const result = await store.bank(roundId, body);
            const round = store.get(roundId);
            session.roundsSeen += 1;
            return json(response, 200, { ...(result as object), frame: frameOf(round, store), ...sessionPayload() });
          }
          if (method === 'POST' && action === '/finish') {
            const result = await store.finish(roundId, body);
            const round = store.get(roundId);
            session.roundsSeen += 1;
            return json(response, 200, { ...(result as object), frame: frameOf(round, store), ...sessionPayload() });
          }
          if (method === 'POST' && action === '/expire') {
            // Operator path. It refuses a round that is not past its window —
            // a player-reachable cancel would be a zero-risk exit from arena 1,
            // and the model has no such action (`MATH.md` §5.3). `--dev-clock`
            // forces it, which is why that flag prints a banner.
            const result = await store.expire(roundId, { force: options.devClock === true });
            const round = store.get(roundId);
            return json(response, 200, { ...(result as object), frame: frameOf(round, store), ...sessionPayload() });
          }
        }

        if (method === 'POST' && path === '/api/rounds') {
          const precommit = store.precommit();
          return json(response, 200, { ...precommit, ...sessionPayload() });
        }

        if (method === 'POST' && path === '/api/verify') {
          const body = (await readBody(request)) as { bundle?: unknown };
          return json(response, 200, verifyBundle(body.bundle ?? body));
        }

        if (method === 'POST' && path === '/api/rehearsal/replay') {
          const body = (await readBody(request)) as { choices?: unknown };
          const choices = Array.isArray(body.choices) ? body.choices : [];
          session.rehearsalSeen = true;
          return json(response, 200, { result: replay(choices as never[]), ...sessionPayload() });
        }

        if (method === 'POST' && path === '/api/session') {
          const body = (await readBody(request)) as Record<string, unknown>;
          if (typeof body.showEverything === 'boolean') session.showEverything = body.showEverything;
          if (typeof body.sideBetsOptedIn === 'boolean') session.sideBetsOptedIn = body.sideBetsOptedIn;
          if (typeof body.ghostLineEnabled === 'boolean') session.ghostLineEnabled = body.ghostLineEnabled;
          if (typeof body.reducedMotion === 'boolean') session.reducedMotion = body.reducedMotion;
          if (Array.isArray(body.runnerNames) && body.runnerNames.length === SQUAD_SIZE) {
            session.runnerNames = body.runnerNames.map((name, index) => {
              const text = String(name).trim().slice(0, 16);
              return text.length > 0 ? text : (DEFAULT_RUNNER_NAMES[index] as string);
            });
            const open = store.openRound;
            if (open)
              open.runners.forEach((runner, index) => {
                runner.name = session.runnerNames[index] as string;
              });
          }
          return json(response, 200, sessionPayload());
        }

        if (method === 'POST' && path === '/api/dev/advance-clock') {
          const body = (await readBody(request)) as { ms?: unknown };
          const ms = typeof body.ms === 'number' ? body.ms : MIN_GAME_CYCLE_MS;
          try {
            return json(response, 200, { nowMs: clock.advance(ms) });
          } catch (error) {
            return json(response, 403, {
              code: 'CLOCK_LOCKED',
              message: error instanceof Error ? error.message : 'The clock is not advanceable',
            });
          }
        }

        json(response, 404, { code: 'NOT_FOUND', message: `No route for ${method} ${path}` });
      } catch (error) {
        if (error instanceof RoundError)
          return json(response, error.status, {
            code: error.code,
            message: error.message,
            path: error.path,
            ...(error.detail ?? {}),
          });
        if (error instanceof RouteError)
          return json(response, 400, { code: error.code, message: error.message, path: error.path });
        const engineCode = (error as { code?: unknown }).code;
        if (typeof engineCode === 'string')
          return json(response, 400, {
            code: engineCode,
            message: (error as Error).message,
            path: (error as { path?: string }).path,
          });
        // eslint-disable-next-line no-console
        console.error(error);
        json(response, 500, { code: 'INTERNAL', message: 'The server broke, not the round' });
      }
    })();
  });

  /**
   * The expiry sweep.
   *
   * `ENGINE.md` §6.1: a round abandoned past the operator's window is closed by
   * the server, through `expire()` and nothing else. Without something calling
   * it, that path is a function nobody runs and a promise nobody keeps. The
   * timer is unref'd so it never holds a test process open.
   */
  const sweep = setInterval(() => {
    void store.sweepExpired().catch(() => undefined);
  }, 60_000);
  sweep.unref?.();

  // The runner names the player chose apply to the next round they open.
  const originalPrecommit = store.precommit.bind(store);
  store.precommit = () => {
    const result = originalPrecommit();
    const round = store.get(result.roundId);
    round.runners.forEach((runner, index) => {
      runner.name = session.runnerNames[index] as string;
    });
    return result;
  };

  return { server, store, wallet, clock, session };
}
