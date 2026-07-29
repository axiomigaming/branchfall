/**
 * `npm run dev` — the whole thing, locally.
 *
 * Bundles the client, starts the server, prints what it is and what it is not.
 * There is no build step to remember and no second process to start.
 */
import { resolve } from 'node:path';
import { bundleClient } from '../build/bundle-client.mjs';
import { credits } from './money.js';
import { MAX_STAKE_MICRO, MIN_GAME_CYCLE_MS, MIN_STAKE_MICRO } from './definition.js';
import { createApp } from './http.js';

const port = Number.parseInt(process.env.PORT ?? '4173', 10);
const devClock = process.argv.includes('--dev-clock');
const watch = !process.argv.includes('--no-watch');

await bundleClient({ watch });

const app = createApp({
  devClock,
  staticRoot: resolve(process.cwd(), 'client/dist'),
  openingBalanceMicro: 500_000_000n,
});

app.server.listen(port, () => {
  const lines = [
    '',
    '  BRANCHFALL — graybox',
    `  http://localhost:${port}`,
    '',
    `  free play only, opening balance ${credits(500_000_000n, 2)} credits`,
    `  stakes ${credits(MIN_STAKE_MICRO, 2)} – ${credits(MAX_STAKE_MICRO, 2)}, minimum game cycle ${MIN_GAME_CYCLE_MS} ms`,
    '  no real money, no certification, no claim that this is a certified game',
    '',
  ];
  if (devClock)
    lines.push(
      '  !! --dev-clock is ON: POST /api/dev/advance-clock can move the server clock.',
      '     This exists so tests can prove the speed-of-play floor. Never ship it.',
      '',
    );
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'));
});
