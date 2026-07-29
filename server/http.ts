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
const MAX_RUNNER_NAME_CHARACTERS = 16;
const MAX_RUNNER_NAME_BYTES = 64;

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
  /**
   * The responsible-play controls (`DESIGN.md` §10.2 and §S9), which that
   * section opens by calling *"build requirements, not aspirations"*.
   *
   * They live on the server rather than in the client for the same reason the
   * speed-of-play floor does: a control a modified client can skip is not a
   * control. The reality check is measured against the session clock the server
   * keeps, so `POST /api/dev/advance-clock` moves it and a test can prove it
   * fires — and a real deployment would move all four of these to the operator's
   * account, which is where a session limit that survives closing the app has to
   * live. This is a free-play prototype with one in-memory session; the shape is
   * right and the persistence is not there, and the settings screen says so.
   */
  realityCheckIntervalMs: number;
  realityCheckAcknowledgedAtMs: number;
  /** Minutes of play after which staking stops for this session. */
  sessionLimitMinutes: number | null;
  /** Net loss, in micro-credits, after which staking stops for this session. */
  sessionLossLimitMicro: bigint | null;
  /** The hand-off: once true, nothing in this session may be staked again. */
  selfExcluded: boolean;
  audioEnabled: boolean;
  /** §6.8's quality ladder. In the graybox it only moves the placeholder scene. */
  qualityTier: 'auto' | 'high' | 'medium' | 'low';
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

function objectBody(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw))
    throw new RoundError('INVALID_ARGUMENT', 'Request body must be a JSON object', 400, '$');
  return raw as Record<string, unknown>;
}

/**
 * Cosmetic names are still untrusted input.
 *
 * They do not enter the game fingerprint or any arithmetic, but duplicates make
 * the fork's permutation ambiguous and coercing objects to strings makes five
 * distinct JSON values look identical. The character limit matches the shipped
 * input while the byte limit bounds multi-byte text without pretending that
 * JavaScript code units are storage bytes.
 */
function runnerNames(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length !== SQUAD_SIZE)
    throw new RoundError(
      'INVALID_ARGUMENT',
      `Runner names must be a list of exactly ${SQUAD_SIZE} names`,
      400,
      '$.runnerNames',
    );
  const names = raw.map((value, index) => {
    const path = `$.runnerNames[${index}]`;
    if (typeof value !== 'string')
      throw new RoundError('INVALID_ARGUMENT', 'A runner name is printable text', 400, path);
    const name = value.trim();
    if (
      name.length === 0 ||
      Array.from(name).length > MAX_RUNNER_NAME_CHARACTERS ||
      Buffer.byteLength(name, 'utf8') > MAX_RUNNER_NAME_BYTES ||
      /[\x00-\x1f\x7f]/u.test(name)
    )
      throw new RoundError(
        'INVALID_ARGUMENT',
        `A runner name is 1 to ${MAX_RUNNER_NAME_CHARACTERS} printable characters`,
        400,
        path,
      );
    return name;
  });
  if (new Set(names).size !== names.length)
    throw new RoundError(
      'INVALID_ARGUMENT',
      'Runner names must be distinct after trimming',
      400,
      '$.runnerNames',
    );
  return names;
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
    // §10.2: "a reality check fires at the operator's interval, default 30 min".
    realityCheckIntervalMs: 30 * 60 * 1000,
    realityCheckAcknowledgedAtMs: 0,
    sessionLimitMinutes: null,
    sessionLossLimitMicro: null,
    selfExcluded: false,
    audioEnabled: false,
    qualityTier: 'auto',
  };

  /**
   * Why staking is closed, or `null` if it is open.
   *
   * One function, consulted by the buy path and published to the client, so the
   * screen that explains the block and the code that enforces it can never
   * disagree about which limit was reached.
   */
  const stakingBlock = (): { code: string; message: string } | null => {
    if (session.selfExcluded)
      return {
        code: 'SELF_EXCLUDED',
        message: 'You closed this session yourself. Staking stays off until the server restarts.',
      };
    const minutes = session.sessionLimitMinutes;
    if (minutes !== null && clock.now() - session.startedAtMs >= minutes * 60_000)
      return {
        code: 'SESSION_LIMIT_REACHED',
        message: `You set a ${minutes}-minute limit on this session and it has passed.`,
      };
    const loss = session.sessionLossLimitMicro;
    if (loss !== null && wallet.netMicro <= -loss)
      return {
        code: 'LOSS_LIMIT_REACHED',
        message: `You set a loss limit of ${credits(loss, 2)} for this session and it has been reached.`,
      };
    return null;
  };
  const staticRoot = options.staticRoot ?? resolve(process.cwd(), 'client/dist');
  const config = configPayload();

  const sessionPayload = () => {
    const open = store.openRound;
    return {
      session: {
        ...session,
        sessionLossLimitMicro:
          session.sessionLossLimitMicro === null ? null : session.sessionLossLimitMicro.toString(),
        elapsedMs: clock.now() - session.startedAtMs,
        /**
         * The reality check is due when this much of the session has passed
         * since it was last acknowledged. The client draws the pause; the number
         * that decides it is this one, on the server clock.
         */
        realityCheckDueMs: Math.max(
          0,
          session.realityCheckAcknowledgedAtMs +
            session.realityCheckIntervalMs -
            (clock.now() - session.startedAtMs),
        ),
        stakingBlock: stakingBlock(),
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
          const body = objectBody(await readBody(request));
          if (method === 'POST' && action === '/open') {
            // The limits are enforced where the money is, not where the button
            // is: a client that skipped the screen still cannot stake.
            const blocked = stakingBlock();
            if (blocked)
              return json(response, 403, { ...blocked, ...sessionPayload() });
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
          const body = objectBody(await readBody(request));
          return json(response, 200, verifyBundle(body.bundle ?? body));
        }

        if (method === 'POST' && path === '/api/rehearsal/replay') {
          const body = objectBody(await readBody(request));
          const choices = Array.isArray(body.choices) ? body.choices : [];
          session.rehearsalSeen = true;
          return json(response, 200, { result: replay(choices as never[]), ...sessionPayload() });
        }

        if (method === 'POST' && path === '/api/session') {
          const body = objectBody(await readBody(request));
          // Validate the whole rename before applying any setting in the same
          // request. A rejected cosmetic field must not partially mutate the
          // session any more than a rejected money command may partially debit.
          const names = body.runnerNames === undefined ? null : runnerNames(body.runnerNames);
          if (typeof body.showEverything === 'boolean') session.showEverything = body.showEverything;
          if (typeof body.sideBetsOptedIn === 'boolean') session.sideBetsOptedIn = body.sideBetsOptedIn;
          if (typeof body.ghostLineEnabled === 'boolean') session.ghostLineEnabled = body.ghostLineEnabled;
          if (typeof body.reducedMotion === 'boolean') session.reducedMotion = body.reducedMotion;
          if (typeof body.audioEnabled === 'boolean') session.audioEnabled = body.audioEnabled;
          if (body.qualityTier !== undefined) {
            if (
              body.qualityTier !== 'auto' &&
              body.qualityTier !== 'high' &&
              body.qualityTier !== 'medium' &&
              body.qualityTier !== 'low'
            )
              return json(response, 400, {
                code: 'INVALID_SETTING',
                message: 'Quality tier must be auto, high, medium or low',
                path: '$.qualityTier',
              });
            session.qualityTier = body.qualityTier;
          }
          if (body.realityCheckMinutes !== undefined) {
            const minutes = body.realityCheckMinutes;
            if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 240)
              return json(response, 400, {
                code: 'INVALID_SETTING',
                message: 'A reality-check interval is a whole number of minutes between 1 and 240',
                path: '$.realityCheckMinutes',
              });
            session.realityCheckIntervalMs = minutes * 60_000;
          }
          if (body.acknowledgeRealityCheck === true)
            session.realityCheckAcknowledgedAtMs = clock.now() - session.startedAtMs;
          if (body.sessionLimitMinutes !== undefined) {
            const minutes = body.sessionLimitMinutes;
            if (
              minutes !== null &&
              (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440)
            )
              return json(response, 400, {
                code: 'INVALID_SETTING',
                message: 'A session limit is null or a whole number of minutes between 1 and 1440',
                path: '$.sessionLimitMinutes',
              });
            session.sessionLimitMinutes = minutes;
          }
          if (body.sessionLossLimitMicro !== undefined) {
            const raw = body.sessionLossLimitMicro;
            if (raw === null) session.sessionLossLimitMicro = null;
            else if (typeof raw !== 'string' || !/^[0-9]{1,15}$/u.test(raw) || BigInt(raw) <= 0n)
              return json(response, 400, {
                code: 'INVALID_SETTING',
                message: 'A loss limit is null or a positive integer of micro-credits',
                path: '$.sessionLossLimitMicro',
              });
            else session.sessionLossLimitMicro = BigInt(raw);
          }
          // The hand-off is one-way on purpose. A control that can be switched
          // off in the same breath is not a self-exclusion, and the screen says
          // in plain words what this prototype's version of it does.
          if (body.selfExclude === true) session.selfExcluded = true;
          if (names) {
            session.runnerNames = names;
            const open = store.openRound;
            if (open)
              open.runners.forEach((runner, index) => {
                runner.name = session.runnerNames[index] as string;
              });
          }
          return json(response, 200, sessionPayload());
        }

        if (method === 'POST' && path === '/api/dev/advance-clock') {
          const body = objectBody(await readBody(request));
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
