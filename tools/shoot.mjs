// Headless screenshots of the running game. Usage: node tools/shoot.mjs <url> <out-prefix> [w] [h] [script]
import { chromium } from 'playwright-core';
const [url, out, w = '1440', h = '900', script = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h }, deviceScaleFactor: 1, reducedMotion: process.env.MOTION === 'full' ? 'no-preference' : 'reduce', hasTouch: +w < 700, isMobile: +w < 700 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__game || document.querySelector('[data-ready]'), null, { timeout: +(process.env.READY_MS ?? 300000) });
  if (script) {
    const steps = (await import(script)).default;
    await steps(page, out);
  } else {
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${out}.png` });
  }
} catch (e) {
  console.log('FAILED', e.message.split('\n')[0]);
  await page.screenshot({ path: `${out}-fail.png` }).catch(() => {});
}
console.log(logs.filter((l) => !l.startsWith('[log] load')).slice(-25).join('\n'));
await browser.close();
