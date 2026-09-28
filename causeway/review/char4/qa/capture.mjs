// Round-4 character QA captures (deterministic stepping; SwiftShader-friendly).
//   node review/char4/qa/capture.mjs <base-url> <out-dir> <shot,shot,…>
// Shots: chase (tier 0/2/4 stills), seq0|seq2|seq4 (8 frames 1/30 s apart, back view in engine),
//        gate|chasm|rockfall (4 beats of a crash), esc:<roundId> (4 beats of an escape).
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const [base, outDir, list = 'chase'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const W = +(process.env.W ?? 1280);
const H = +(process.env.H ?? 720);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`${base}/?qa&q=${process.env.Q ?? 'high'}`, { waitUntil: 'load' });
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 900000, polling: 500 });
await page.addStyleTag({ content: '#app{display:none!important}' });
const T = { t0: 0, t2: 31500, t4: 60000 };

/** Fresh round, running for `run` seconds at a multiplier offset (ms of curve time). */
async function startRun(offMs, run) {
  await page.evaluate(
    async ([off, run]) => {
      const g = window.__game;
      const p = g.toSetup();
      g.debugStep(1.2);
      await p;
      const start = g.virtualNow + 1100;
      g.elapsed = () => g.virtualNow - start + (g.virtualNow > start ? off : 0);
      g.lead();
      g.debugStep(run);
    },
    [offMs, run],
  );
}
const step = (s) => page.evaluate((s) => window.__game.debugStep(s), s);
const shot = (name) => page.screenshot({ path: `${outDir}/${name}.png`, timeout: 600000 });

for (const s of list.split(',')) {
  const t0 = Date.now();
  if (s === 'chase') {
    for (const [tag, off] of Object.entries(T)) {
      await startRun(off, tag === 't0' ? 6 : 5);
      await shot(`chase_${tag}`);
    }
  } else if (s.startsWith('seq')) {
    const tag = `t${s.slice(3)}`;
    await startRun(T[tag], 5);
    for (let i = 0; i < 8; i++) {
      await step(1 / 30);
      await shot(`seq_${tag}_${i}`);
    }
  } else if (['gate', 'chasm', 'rockfall'].includes(s)) {
    await startRun(22000, 6);
    await page.evaluate((k) => window.__game.crash(420, 'r-x', k), s);
    let t = 0;
    for (const at of [0.25, 0.7, 1.4, 3.0]) {
      await step(at - t);
      t = at;
      await shot(`crash_${s}_${at}`);
    }
  } else if (s.startsWith('esc:')) {
    const id = s.slice(4);
    await startRun(22000, 6);
    const v = await page.evaluate((id) => {
      window.__game.cashout(id);
      return window.__game.staging?.variant;
    }, id);
    console.log('escape', id, v);
    let t = 0;
    for (const at of [0.3, 0.9, 1.8, 3.2]) {
      await step(at - t);
      t = at;
      await shot(`esc_${v}_${at}`);
    }
  }
  console.log(s, ((Date.now() - t0) / 1000).toFixed(0), 's');
}
await browser.close();
