// shoot.mjs step script: deterministic lead + run for ?t= seconds (default 6), then a screenshot.
//   node tools/shoot.mjs "http://localhost:5195/?qa&q=medium&t=6" out 960 600 ./shoot-run.mjs
export default async function (page, out) {
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 600000, polling: 200 });
  await page.evaluate(async () => {
    const g = window.__game;
    const p = g.toSetup();
    g.debugStep(1.2);
    await p;
    const start = g.virtualNow + 1100;
    g.elapsed = () => g.virtualNow - start;
    g.lead();
    g.debugStep(+(new URLSearchParams(location.search).get('t') ?? 6));
  });
  await page.screenshot({ path: `${out}.png`, timeout: 600000 });
}
