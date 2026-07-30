/**
 * The presentation rules round 3 had to fix, bound so they cannot come back.
 *
 * None of these touch money: every one of them is about what the screen *does*
 * with a figure the server already decided. They exist because each was found by
 * a review rather than by the suite — the round-2 pass shipped five presentation
 * changes and no test at all — and because each is the kind of fault that is
 * invisible in a diff and obvious in a frame dump.
 *
 * What is checked here:
 *
 * 1. The celebration has more than one volume, and the scale is monotone.
 * 2. §9's Last Lamp beat fires on the fork's thin limb, which is the variant
 *    §9 says only exists because of the fork.
 * 3. The session net is floored away from zero on a loss, everywhere.
 * 4. The regulatory citation does not say its own acronym twice.
 * 5. The display face is drawn by this repository rather than borrowed from
 *    whatever the platform happens to ship.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { bloom, countMs, payoff } from '../client/src/payoff.ts';
import { creditsSigned } from '../client/src/api.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

describe('the payoff has a scale (DESIGN §6.4)', () => {
  it('separates a recovery, a good bank and a rare one', () => {
    expect(payoff('0.8120').tier).toBe('quiet');
    expect(payoff('1.9999').tier).toBe('quiet');
    expect(payoff('2.0000').tier).toBe('big');
    expect(payoff('3.0560').tier).toBe('big');
    expect(payoff('4.9999').tier).toBe('big');
    expect(payoff('5.0000').tier).toBe('huge');
    expect(payoff('73.3400').tier).toBe('huge');
  });

  it('is monotone in the multiple, and bounded at both ends', () => {
    const ladder = ['0.0000', '0.2500', '0.8120', '1.1369', '2.2920', '3.0560', '9.9999', '73.34'];
    const heats = ladder.map((value) => payoff(value).heat);
    for (let index = 1; index < heats.length; index += 1)
      expect(heats[index], `${ladder[index]} is not warmer than ${ladder[index - 1]}`).toBeGreaterThanOrEqual(heats[index - 1]);
    expect(heats[0]).toBe(0);
    expect(heats[heats.length - 1]).toBeCloseTo(1, 10);
  });

  it('drives the two beats the round-2 build played identically', () => {
    // The finding, in its own numbers: 4.06 banked on a 5.00 stake against 15.28
    // on the same stake played byte-identical beats.
    const small = payoff('0.8120');
    const large = payoff('3.0560');
    expect(countMs(large.heat)).toBeGreaterThan(countMs(small.heat) + 250);
    expect(bloom(large.heat).amount).toBeGreaterThan(bloom(small.heat).amount);
    // A bigger bank keeps the frame warm for longer, so it decays more slowly.
    expect(bloom(large.heat).decay).toBeLessThan(bloom(small.heat).decay);
  });

  it('never runs away with itself: the count is bounded and nothing is kinetic', () => {
    expect(countMs(payoff('1000').heat)).toBeLessThanOrEqual(2100);
    expect(countMs(payoff('0').heat)).toBeGreaterThanOrEqual(900);
    /*
     * §6.4 permits size, colour, light and sound and forbids everything kinetic,
     * so the two rare tiers may only reach for the first four. A `transform`, an
     * `animation` or a `scale` in either rule would be the coin fountain arriving
     * by another name.
     */
    const css = read('client/public/styles.css');
    const tiers = css.slice(css.indexOf('.hero-figure.big'), css.indexOf('/* §6.4\'s own sentence'));
    expect(tiers).toContain('font-size');
    expect(tiers).toContain('text-shadow');
    for (const banned of ['transform', 'animation', 'scale(', 'translate']) expect(tiers).not.toContain(banned);
  });

  it('is read from the settlement the server published, and computes no money', () => {
    const source = read('client/src/payoff.ts');
    expect(source).not.toMatch(/BigInt|Micro/);
    expect(read('client/src/main.ts')).toContain('payoff(state.frame?.settlement?.returnMultiple');
  });
});

describe('§9 the Last Lamp, including the fork variant', () => {
  const source = read('client/src/main.ts');

  it('fires when a lane has exactly one runner in it, not only when the round does', () => {
    // The round-2 build tested `frame.live.length === 1`, which is false on every
    // 4 + 1 — the squad is five — so §9's fork variant never ran.
    expect(source).toContain('function lastLampOf(frame: Frame, laneSizes: number[] | null): boolean');
    expect(source).toMatch(/laneSizes !== null && laneSizes\.some\(\(size\) => size === 1\)/);
    expect(source).not.toMatch(/const lastLamp = frame\.live\.length === 1;/);
  });

  it('is decided in one place, and both the picture and the mix read that place', () => {
    const calls = source.match(/lastLampOf\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('puts the camera on whoever is alone, at any squad size', () => {
    const stage = read('client/src/stage.ts');
    expect(stage).toContain('private soloBody()');
    expect(stage).toMatch(/for \(const \[, lane\] of counts\) if \(lane\.length === 1\) return lane\[0\]/);
  });
});

describe('the session net', () => {
  it('floors a loss away from zero rather than toward it', () => {
    // The measured case: netMicro -79257237 was published as "79.25".
    expect(creditsSigned(-79_257_237n)).toBe('-79.26');
    expect(creditsSigned(-10_045_000n)).toBe('-10.05');
  });

  it('is rendered from the amount on every screen that shows it', () => {
    const source = read('client/src/main.ts');
    expect(source).toContain('function netFigure(wallet: WalletView): string');
    // `netDisplay` is the server's truncated magnitude; no screen may print it.
    expect(source).not.toContain('wallet.netDisplay');
  });
});

describe('player-facing regulatory copy', () => {
  it('does not say the standard twice when it joins the edition to it', () => {
    const source = read('client/src/main.ts');
    expect(source).toContain('function citation(standard: string, edition: string): string');
    expect(source).not.toMatch(/\$\{String\(speed\.standard\)\} \$\{String\(speed\.standardEdition\)\}/);
  });
});

describe('the display face (DESIGN §6.5)', () => {
  const css = read('client/public/display.css');

  it('is drawn by this repository and served with the page', () => {
    expect(css).toMatch(/@font-face/);
    expect(css.match(/@font-face/g)).toHaveLength(2);
    expect(css).toContain('font-family: "Branchfall Display"');
    expect(read('client/public/index.html')).toContain('href="/display.css"');
    expect(read('client/public/styles.css')).toContain('--display: "Branchfall Display"');
  });

  it('downloads nothing: every source is an inline data URI', () => {
    const sources = css.match(/src: url\(([^)]*)\)/g) ?? [];
    expect(sources).toHaveLength(2);
    for (const source of sources) expect(source).toMatch(/^src: url\(data:font\/ttf;base64,/);
    expect(css).not.toMatch(/https?:/);
  });

  it('ships two real cuts rather than one and a synthetic bold', () => {
    expect(css).toContain('font-weight: 400');
    expect(css).toContain('font-weight: 700');
  });
});

describe('the shell', () => {
  it('no longer calls the premium build a graybox in the browser tab', () => {
    expect(read('client/public/index.html')).toContain('<title>BRANCHFALL</title>');
  });
});
