// Hero framing check: builds N setup worlds (and optionally runs a few seconds into each) on a phone
// and a desktop viewport and asserts the runner is whole inside the band the interface leaves free
// and that no solid geometry stands between the lens and him (Game.debugFraming raycasts the scene).
//
//   URL=http://localhost:5180 node tools/framing-check.mjs [--n 20] [--q medium] [--run 0]
//
// Exits 1 if any frame fails. Headless Chromium (SwiftShader); time is stepped (Game.debugStep), so the
// result does not depend on the frame rate.
import { chromium } from 'playwright-core';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const URL = process.env.URL ?? 'http://localhost:5180';
const n = +arg('n', 20);
const q = arg('q', 'medium');
const run = +arg('run', 0);
const VIEWS = [
  { name: 'phone', w: 390, h: 844, mobile: true },
  { name: 'desktop', w: 1280, h: 720, mobile: false },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let failed = 0;
for (const v of VIEWS) {
  const page = await browser.newPage({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: 1, isMobile: v.mobile, hasTouch: v.mobile });
  await page.goto(`${URL}/?qa&q=${q}&seed=framing`, { waitUntil: 'load' });
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 900000, polling: 500 });
  await page.evaluate(async () => {
    const g = window.__game;
    g.paused = true;
    window.__ctl.enter();
    await new Promise((r) => setTimeout(r, 1500));
    g.debugStep(1);
  });
  for (let w = 1; w <= n; w++) {
    const r = await page.evaluate(
      ({ w, run }) => {
        const g = window.__game;
        const now = Date.now,
          rnd = Math.random;
        Date.now = () => w * 7919;
        Math.random = () => ((w * 0.618) % 1) * 0.98;
        // From the title (anywhere in its fly-over) to the setup, as the player sees it: one second
        // after entering, and settled. Then a fresh world after a round (newWorld('setup')).
        g.newWorld('title');
        Date.now = now;
        Math.random = rnd;
        g.debugStep(2 + ((w * 5.3) % 40));
        g.toSetup();
        g.debugStep(1);
        const out = { 'setup+1s': g.debugFraming() };
        g.debugStep(2);
        out.setup = g.debugFraming();
        Date.now = () => w * 7919 + 1;
        Math.random = () => ((w * 0.377) % 1) * 0.98;
        g.newWorld('setup');
        Date.now = now;
        Math.random = rnd;
        g.debugStep(1);
        out.again = g.debugFraming();
        if (run > 0) {
          const start = g.virtualNow + 1100;
          g.elapsed = () => g.virtualNow - start;
          g.lead();
          g.debugStep(1.1 + run);
          out.run = g.debugFraming();
          g.elapsed = () => null;
        }
        return out;
      },
      { w, run },
    );
    for (const [stage, f] of Object.entries(r)) {
      const [lo, hi] = f.band;
      const xs = f.ndc.map((p) => p[0]);
      const ys = f.ndc.map((p) => p[1]);
      const problems = [];
      if (Math.min(...xs) < -0.92 || Math.max(...xs) > 0.92) problems.push('off the side');
      if (Math.min(...ys) < lo - 0.01) problems.push(`boots below the dock (${Math.min(...ys).toFixed(2)} < ${lo})`);
      if (Math.max(...ys) > hi + 0.01) problems.push(`head above the band (${Math.max(...ys).toFixed(2)} > ${hi})`);
      if (f.solid > 1) problems.push(`occluded (${f.solid}/5 sight lines: ${f.hits.join(', ')})`);
      const ok = problems.length === 0;
      if (!ok) failed++;
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${v.name} world ${String(w).padStart(2)} ${stage.padEnd(8)} feet ${f.ndc[0].join(',')} head ${f.ndc[4].join(',')} band ${lo}..${hi} solid ${f.solid} leaf ${f.leaf}${ok ? '' : '  ← ' + problems.join('; ')}`);
    }
  }
  await page.close();
}
await browser.close();
console.log(failed ? `${failed} frame(s) failed` : 'all frames ok');
process.exit(failed ? 1 : 0);
