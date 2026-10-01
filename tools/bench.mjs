// Reproducible load + frame + memory benchmark in headless Chromium (SwiftShader: absolute ms are slow,
// relative numbers between builds are what count).
//
//   URL=http://localhost:5195 node tools/bench.mjs [--q low] [--w 390] [--h 844] [--rounds 10] [--frames 12] [--assets mobile] [--net 4g|slow4g]
//
// Reports: bytes downloaded (encoded, by type) and time to ready; loading-bar samples (monotonic?);
// ms/frame (CPU submit and GPU-synced) with draw calls / triangles; simulation-only ms/frame and JS
// bytes allocated per simulated frame (sampling heap profiler, including collected objects); JS heap and
// renderer.info.memory after each of N deterministic rounds (lead → run → crash/cash-out → reset).
import { chromium } from 'playwright-core';

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const URL = process.env.URL ?? 'http://localhost:5195';
const q = arg('q', 'low');
const w = +arg('w', 390);
const h = +arg('h', 844);
const rounds = +arg('rounds', 10);
const frames = +arg('frames', 12);
const assets = arg('assets', '');
// Network emulation: '4g' ≈ 9 Mbps / 85 ms RTT, 'slow4g' ≈ Lighthouse mobile (1.6 Mbps / 150 ms).
const NETS = { '4g': { latency: 85, down: 9e6 }, slow4g: { latency: 150, down: 1.6e6 } };
const net = NETS[arg('net', '')];
const mobile = w < 700;

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--js-flags=--expose-gc', '--enable-precise-memory-info', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: mobile ? 3 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion: 'no-preference' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const cdp = await ctx.newCDPSession(page);
await cdp.send('Network.enable');
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
if (net) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: net.latency, downloadThroughput: net.down / 8, uploadThroughput: 750000 / 8 });
const reqs = new Map();
cdp.on('Network.requestWillBeSent', (e) => reqs.set(e.requestId, { url: e.request.url, bytes: 0 }));
cdp.on('Network.responseReceived', (e) => reqs.has(e.requestId) && (reqs.get(e.requestId).type = e.type));
cdp.on('Network.loadingFinished', (e) => reqs.has(e.requestId) && (reqs.get(e.requestId).bytes = e.encodedDataLength));
await page.addInitScript(() => {
  const t0 = performance.now();
  window.__prog = [];
  const poll = setInterval(() => {
    const el = document.querySelector('[role=progressbar]');
    if (el) window.__prog.push([Math.round(performance.now() - t0), +el.getAttribute('aria-valuenow')]);
    if (document.body?.dataset.ready) {
      window.__readyAt = performance.now() - t0;
      clearInterval(poll);
    }
  }, 50);
});

const t0 = Date.now();
await page.goto(`${URL}/?qa&q=${q}&seed=bench${assets ? `&assets=${assets}` : ''}`);
let firstPaint = null;
await page.waitForFunction(() => document.querySelector('#wordmark'), null, { timeout: 120000, polling: 50 }).then(() => (firstPaint = Date.now() - t0));
await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 600000, polling: 200 });
const loadMs = Date.now() - t0;
const prog = await page.evaluate(() => window.__prog);
let back = 0;
let maxJump = 0;
for (let i = 1; i < prog.length; i++) {
  if (prog[i][1] < prog[i - 1][1]) back++;
  maxJump = Math.max(maxJump, prog[i][1] - prog[i - 1][1]);
}
const byType = {};
let total = 0;
for (const r of reqs.values()) {
  const ext = (r.url.split('?')[0].match(/\.(\w+)$/)?.[1] ?? r.type ?? 'other').toLowerCase();
  byType[ext] = (byType[ext] ?? 0) + r.bytes;
  total += r.bytes;
}
const big = [...reqs.values()].filter((r) => r.bytes > 100000).map((r) => `${r.url.split('/').pop()} ${(r.bytes / 1024).toFixed(0)} KB`);

// Deterministic stepping from here on.
const info = () =>
  page.evaluate(() => {
    const g = window.__game;
    const m = g.renderer.info.memory;
    window.gc?.();
    return { heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(2), geometries: m.geometries, textures: m.textures, programs: g.renderer.info.programs?.length ?? 0 };
  });
await page.evaluate(() => {
  const g = window.__game;
  g.autoQuality = false;
  g.debugStep(0.2);
});
const setupAndRun = (i) =>
  page.evaluate(async (i) => {
    const g = window.__game;
    const p = g.toSetup();
    g.debugStep(1.2);
    await p;
    const start = g.virtualNow + 1100;
    g.elapsed = () => g.virtualNow - start;
    g.lead();
    g.debugStep(5);
    if (i % 2) g.cashout(`bench-${i}`);
    else g.crash(1.8, `bench-${i}`);
    g.debugStep(4);
    g.elapsed = () => null;
  }, i);

// Frame timing, mid-run (after one round has warmed every program).
await setupAndRun(0);
const frame = await page.evaluate(
  async ({ frames }) => {
    const g = window.__game;
    const gl = g.renderer.getContext();
    const p = g.toSetup();
    g.debugStep(1.2);
    await p;
    const start = g.virtualNow + 1100;
    g.elapsed = () => g.virtualNow - start;
    g.lead();
    g.debugStep(4);
    const cpu = [];
    const synced = [];
    const px = new Uint8Array(4);
    for (let i = 0; i < frames; i++) {
      let t = performance.now();
      g.debugStep(1 / 30);
      cpu.push(performance.now() - t);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // wait for the GPU
      synced.push(performance.now() - t);
    }
    const st = g.debugState;
    // Simulation only: the same stepping as debugStep, without the draw.
    const t = performance.now();
    for (let i = 0; i < 90; i++) {
      g.virtualNow += 1000 / 30;
      g.frame(1 / 30, false);
    }
    const sim = (performance.now() - t) / 90;
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    return { cpuMs: +med(cpu).toFixed(1), gpuSyncedMs: +med(synced).toFixed(1), simMs: +sim.toFixed(2), calls: st.calls, tris: st.tris, pixelRatio: g.renderer.getPixelRatio(), drawBuffer: `${gl.drawingBufferWidth}x${gl.drawingBufferHeight}` };
  },
  { frames },
);
// Allocation per simulated frame.
await cdp.send('HeapProfiler.enable');
await cdp.send('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
await page.evaluate(() => {
  const g = window.__game;
  for (let i = 0; i < 10; i++) g.debugStep(1, 30); // 300 steps, 10 drawn
});
const { profile } = await cdp.send('HeapProfiler.stopSampling');
let allocated = 0;
const byFn = new Map();
const walk = (n) => {
  allocated += n.selfSize;
  const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop().split('?')[0]}:${n.callFrame.lineNumber + 1}`;
  byFn.set(k, (byFn.get(k) ?? 0) + n.selfSize);
  n.children.forEach(walk);
};
walk(profile.head);
const topAlloc = [...byFn].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${(v / 300 / 1024).toFixed(1)} KB/frame`);
await page.evaluate(() => window.__game.debugStep(0.5));

// Memory over rounds.
const mem = [await info()];
for (let i = 1; i <= rounds; i++) {
  await setupAndRun(i);
  mem.push(await info());
}
const out = {
  url: `${URL} q=${q} ${w}x${h}${assets ? ` assets=${assets}` : ''}${net ? ` net=${arg('net')}` : ''}`,
  load: { firstPaintMs: firstPaint, readyMs: loadMs, totalKB: Math.round(total / 1024), byTypeKB: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v / 1024)])), big, progressSamples: prog.length, progressBackwards: back, progressMaxJump: maxJump },
  frame,
  alloc: { perSimFrameKB: +(allocated / 300 / 1024).toFixed(1), top: topAlloc },
  memory: { start: mem[0], after: mem[mem.length - 1], perRound: mem.map((m) => `${m.heapMB}MB g${m.geometries} t${m.textures} p${m.programs}`) },
  errors,
};
console.log(JSON.stringify(out, null, 2));
await browser.close();
