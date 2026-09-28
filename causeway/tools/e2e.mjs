// End-to-end: plays the real app in headless Chromium and checks money and state.
//   URL=http://localhost:5180 node tools/e2e.mjs [viewport…]      (viewports: desktop, full-hd, laptop, mobile)
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';

const URL = process.env.URL ?? 'http://localhost:5180';
const OUT = process.env.OUT ?? 'e2e-out';
const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  'full-hd': { width: 1920, height: 1080 },
  laptop: { width: 1366, height: 768 },
  mobile: { width: 390, height: 844, isMobile: true, hasTouch: true },
};
const pick = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(VIEWPORTS);
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

for (const name of pick) {
  const vp = VIEWPORTS[name];
  console.log(`\n${name} ${vp.width}×${vp.height}`);
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const st = () => page.evaluate(() => { const s = window.__store.getState(); return { phase: s.phase, balance: s.balance, stake: s.stake, history: s.history.length, result: s.result && { won: s.result.won, payout: s.result.round.payout, stake: s.result.round.stake, mult: s.result.round.cashoutMult, crash: s.result.round.crash } }; });
  const waitPhase = (phases, timeout = 120000) => page.waitForFunction((p) => p.includes(window.__store.getState().phase), phases, { timeout });
  const shot = (tag) => page.screenshot({ path: `${OUT}/${name}-${tag}.png` }).catch(() => {});
  // Wide screens show a top-bar button per panel; phones reach the same panels through the menu.
  const openPanel = async (label) => {
    const direct = page.locator(`.topbar button[aria-label="${label}"]`);
    if (await direct.isVisible()) return direct.click();
    await page.click('.topbar button[aria-label="Menu"]');
    await page.click(`.menu button:has-text("${label}")`);
  };

  await page.goto(`${URL}/?q=low&seed=e2e-${name}&qa`);
  await page.waitForSelector('.title-actions .btn-gold', { timeout: 300000 });
  check('title screen offers entry', true);
  await shot('1-title');
  await page.click('.title-actions .btn-gold');
  await waitPhase(['setup']);
  await shot('2-setup');
  const lay = await page.evaluate(() => ({ dock: (innerHeight - document.querySelector('.dock').getBoundingClientRect().top) / innerHeight, over: document.documentElement.scrollWidth > innerWidth }));
  check('setup dock leaves the world visible, no horizontal overflow', lay.dock <= 0.34 && !lay.over, JSON.stringify(lay));

  // Stake input clamps to the table limits.
  await page.fill('#stake', '0.01');
  await page.press('#stake', 'Enter');
  check('stake below minimum clamps to 0.10', (await st()).stake === 10);
  await page.fill('#stake', '99999999');
  await page.press('#stake', 'Enter');
  check('stake above maximum clamps to 1,000.00', (await st()).stake === 100000);
  await page.fill('#stake', '10');
  await page.press('#stake', 'Enter');

  // Run and cash out immediately, with three rapid clicks.
  let before = await st();
  await page.click('.run-btn');
  await waitPhase(['running', 'result']);
  await page.evaluate(() => { const b = document.querySelector('.cash'); for (let i = 0; i < 3; i++) b?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); });
  await waitPhase(['result']);
  let after = await st();
  check('one settlement for three clicks', after.history === before.history + 1);
  check('balance = before − stake + payout', after.balance === before.balance - 1000 + after.result.payout, JSON.stringify(after.result));
  check('early cash-out wins, or the way fell before the click landed', after.result.won || after.result.crash <= 130, JSON.stringify(after.result));
  await shot('3-result');

  // Resize during a round, then let it fall.
  before = after;
  await page.keyboard.press('Space');
  await waitPhase(['running', 'result']);
  await page.setViewportSize({ width: Math.round(vp.width * 0.8), height: Math.round(vp.height * 0.9) });
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: vp.width, height: vp.height });
  await shot('4-running');
  // Wait for this run to settle (a new history entry); if it was an auto/early win, run again.
  let r = await st();
  let guard = 0;
  for (;;) {
    if (r.phase === 'result' && r.history > before.history) {
      if (!r.result.won) break;
      before = r;
      await page.keyboard.press('Space');
    }
    await page.waitForTimeout(1000);
    r = await st();
    if (++guard > 240) break;
  }
  check('a run left alone falls and the stake is lost', r.phase === 'result' && !r.result.won && r.balance === before.balance - 1000, JSON.stringify(r.result));
  await shot('5-fallen');
  // Cash-out after the fall does nothing.
  await page.evaluate(() => window.__ctl.cashout());
  check('cash-out after the fall changes nothing', (await st()).balance === r.balance);

  // Panels.
  await openPanel('Provably fair');
  await page.waitForSelector('.verdict', { timeout: 10000 });
  check('fairness panel verifies the last run', !(await page.$('.verdict.bad')));
  await shot('6-fair');
  await page.keyboard.press('Escape');
  await openPanel('Settings');
  await page.click('.seg button:has-text("Medium")');
  await page.keyboard.press('Escape');
  await page.keyboard.press('m');
  check('mute toggles', (await page.evaluate(() => window.__store.getState().settings.muted)) === true);
  await page.waitForTimeout(3000);
  check('quality switch to medium applied', (await page.evaluate(() => window.__game.quality)) === 'medium');
  await page.keyboard.press('Space');
  await waitPhase(['running', 'result']);
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__ctl.cashout());
  await waitPhase(['result']);
  check('a round after the quality change settles', true);
  await shot('7-after-quality');
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
