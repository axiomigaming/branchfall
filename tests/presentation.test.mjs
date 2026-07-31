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
import { bloom, celebrates, countMs, payoff } from '../client/src/payoff.ts';
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
    /*
     * The ceiling came down in round 4, and the reason is the region counter.
     *
     * A tabular roll changes four or five digits and `diff.mjs` sees each digit
     * as its own island, so a count still running at the third 550 ms sample of
     * the beat reads as nine independently moving regions against the rubric's
     * never-exceed of about eight — on a frame whose total change is 0.1%. The
     * count is one object; the fix is to have it finished, and the frame at rest,
     * inside the celebration's own hold rather than after it.
     */
    expect(countMs(payoff('1000').heat)).toBeLessThanOrEqual(1600);
    expect(countMs(payoff('0').heat)).toBeGreaterThanOrEqual(800);
    /*
     * §6.4 permits size, colour, light and sound and forbids everything kinetic.
     *
     * Round 4 moved the escalation off the numeral and onto the plate behind it,
     * so the rules this reads changed — but the thing being guarded did not, and
     * it is worth stating precisely. **The difference between a quiet bank, a big
     * one and a rare one is size and light and nothing else.** A `transform`, a
     * `translate` or an `animation` appearing in a *tier* rule would be the
     * escalation becoming kinetic, which is the coin fountain arriving under
     * another name. Each rule is extracted on its own rather than by slicing
     * between two landmarks, because the round-3 form of this test read whatever
     * happened to sit between them and would have passed on rules it never saw.
     */
    const css = read('client/public/styles.css');
    const ruleFor = (selector) => {
      const start = css.indexOf(`${selector} {`);
      expect(start, `${selector} is missing`).toBeGreaterThan(-1);
      return css.slice(start, css.indexOf('}', start));
    };
    const tiers = [
      ruleFor('.hero-figure.big'),
      ruleFor('.hero-figure.huge'),
      ruleFor('.hero.won:has(.hero-figure.big)'),
      ruleFor('.hero.won:has(.hero-figure.huge)'),
      ruleFor('.screen.settled.paid.tier-big::before'),
      ruleFor('.screen.settled.paid.tier-huge::before'),
    ];
    // Size and light are how a tier differs, and both are present.
    expect(tiers[0]).toContain('font-size');
    expect(tiers[1]).toContain('font-size');
    expect(tiers[2]).toContain('box-shadow');
    expect(tiers[3]).toContain('box-shadow');
    for (const rule of tiers)
      for (const banned of ['transform', 'animation', 'scale(', 'translate'])
        expect(rule, `a tier rule reaches for ${banned}`).not.toContain(banned);
  });

  /*
   * The one motion the payoff is allowed, and its bounds.
   *
   * The rubric's celebration anatomy is unanimous that a payoff *builds an
   * object* — every reference win frame grows a new lit surface at the centre —
   * and an object that appears between two frames reads as a rendering fault
   * rather than as an arrival. So the plate has an entrance. §6.4's actual
   * prohibitions all survive it: it never passes its end state, so nothing
   * bounces and nothing overshoots; it is one element, so nothing is thrown
   * across the frame; and it is over inside the 300-500 ms the reference set
   * spends on the same beat.
   */
  it('lets the plate arrive, and never lets it overshoot', () => {
    const css = read('client/public/styles.css');
    const frames = css.slice(css.indexOf('@keyframes plate-in'), css.indexOf('@keyframes wash-in'));
    // It grows *to* its size and stops there: no scale above 1 anywhere in it.
    const scales = [...frames.matchAll(/scale\(([\d.]+)\)/g)].map((match) => Number(match[1]));
    expect(scales.length).toBeGreaterThan(0);
    for (const value of scales) expect(value).toBeLessThanOrEqual(1);
    expect(scales).toContain(1);
    // And it is driven by the shared curve, which has no negative control point.
    expect(css.slice(css.indexOf('.hero.won {'), css.indexOf('@keyframes plate-in'))).toMatch(
      /animation: plate-in 380ms var\(--curve\) both;/,
    );
    const curve = css.slice(css.indexOf('--curve:'), css.indexOf(';', css.indexOf('--curve:')));
    for (const value of [...curve.matchAll(/-?[\d.]+/g)].map((match) => Number(match[0])))
      expect(value).toBeGreaterThanOrEqual(0);
  });

  it('is read from the settlement the server published, and computes no money', () => {
    const source = read('client/src/payoff.ts');
    expect(source).not.toMatch(/BigInt|Micro/);
    expect(read('client/src/main.ts')).toContain('payoff(state.frame?.settlement?.returnMultiple');
  });
});

/**
 * The blocker this suite exists to make impossible: a losing round wearing a win.
 *
 * Round 4 built the payoff as an *object* — a lit gold plate at the optical centre
 * with the figure in ink on its face, and a wash of light behind it — because a
 * payoff that only tints a numeral fails the bar. An object is celebratory
 * whatever number is on it, so the moment it existed it needed a gate: §10.5, and
 * the house rule that a partial return below stake may never be dressed as a win.
 */
describe('a sub-stake return is never dressed as a win (DESIGN §10.5)', () => {
  it('celebrates strictly above stake, and nothing else', () => {
    // The measured case that found this: 4.54 banked against a 5.00 stake.
    expect(celebrates('0.9095')).toBe(false);
    expect(celebrates('0.0000')).toBe(false);
    expect(celebrates('0.9999')).toBe(false);
    // Breaking even is not winning: the money came back and nothing was won.
    expect(celebrates('1.0000')).toBe(false);
    expect(celebrates('1.0001')).toBe(true);
    expect(celebrates('1.1369')).toBe(true);
    expect(celebrates('73.3400')).toBe(true);
    // A settlement that failed to publish a multiple is not a win either.
    expect(celebrates('')).toBe(false);
    expect(celebrates('not a number')).toBe(false);
  });

  it('is the only thing that mounts the plate, the wash and the ink inversion', () => {
    const css = read('client/public/styles.css');
    const main = read('client/src/main.ts');
    const widgets = read('client/src/widgets.ts');

    // The screen asks `celebrates` once and every part of the beat reads that.
    expect(main).toContain("const won = celebrates(settlement?.returnMultiple ?? '0');");
    expect(main).toContain("${won ? ` paid tier-${scale.tier}` : ' recovered'}");
    expect(widgets).toContain("${won ? ' won' : ''}");

    // The plate and its light are reachable only through `.won` / `.paid`.
    for (const rule of ['.hero.won {', '.hero.won .hero-figure {', '.screen.settled.paid::before {'])
      expect(css, `${rule} is not gated`).toContain(rule);
    // Nothing paints a plate on a bare `.hero`.
    expect(css).not.toMatch(/^\.hero \{[^}]*background:\s*(radial|linear)-gradient/m);
  });

  it('keeps the loss quiet: no plate, no bloom, no light, same weight', () => {
    const css = read('client/public/styles.css');
    const cold = css.slice(css.indexOf('.hero.cold {'), css.indexOf('.hero.cold .hero-label'));
    expect(cold).toContain('background: none');
    expect(cold).toContain('box-shadow: none');
    expect(cold).toContain('animation: none');
  });

  it('cannot reach the wipe screen at all', () => {
    /*
     * §S6 is the ending where nobody came back. It is a different screen from the
     * bank, it is built cold on purpose, and the light must be unreachable from
     * it — not merely unused. So the class it mounts is asserted whole: a `paid`
     * appearing anywhere in it would put a warm wash over a total loss, which is
     * the worst thing this file exists to prevent.
     */
    const main = read('client/src/main.ts');
    const start = main.indexOf('function wipeScreen()');
    expect(start).toBeGreaterThan(-1);
    const wipe = main.slice(start, main.indexOf('\nfunction ', start + 10));
    expect(wipe).toContain("class: `screen fade-in settled${held ? ' held' : ''}`");
    expect(wipe).not.toMatch(/\bpaid\b/);
    expect(wipe).not.toMatch(/celebrates\(/);
    // And the figure on it is the cold one, which carries none of the plate.
    expect(wipe).toContain("tone: 'cold'");
  });
});

/**
 * §6.1 is the contract, and the stylesheet is the build of it.
 *
 * The round-4 pass re-lit the whole game, which meant editing the palette in two
 * places that had no gate between them: the table in `DESIGN.md` and the `:root`
 * block in `styles.css`. A specification that says `#0E1114` over a build that
 * ships `#071A33` is worse than no specification, because every later argument
 * about the look gets settled against the wrong document.
 */
describe('the palette in DESIGN §6.1 is the palette the build ships', () => {
  const design = read('docs/DESIGN.md');
  const css = read('client/public/styles.css');
  const section = design.slice(design.indexOf('### 6.1 Palette'), design.indexOf('### 6.2'));
  const tokens = [...section.matchAll(/^\| `(--[a-z0-9-]+)` \| `(#[0-9A-Fa-f]{6})` \|/gm)];
  const root = css.slice(css.indexOf(':root {'), css.indexOf('\n}', css.indexOf(':root {')));

  it('declares every token it specifies, at the value it specifies', () => {
    expect(tokens.length).toBeGreaterThanOrEqual(16);
    for (const [, token, hex] of tokens)
      expect(root, `${token} does not match §6.1`).toContain(`${token}: ${hex.toLowerCase()};`);
  });

  it('keeps the cool half saturated and out of the near-black band', () => {
    /*
     * The two numbers the round-3 build failed on, as a gate rather than as a
     * paragraph. Luminance is the same sRGB formula the reference measurements
     * use; saturation is HSV. Every world and surface token has to be a colour —
     * the failure mode is a grey that measures as nothing — and the deepest value
     * in the frame has to sit clear of the near-black threshold the rubric puts a
     * 3%-of-frame ceiling on.
     */
    const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const sat = (rgb) => (Math.max(...rgb) === 0 ? 0 : (Math.max(...rgb) - Math.min(...rgb)) / Math.max(...rgb));
    const rgb = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    const by = Object.fromEntries(tokens.map(([, token, hex]) => [token, rgb(hex)]));

    // Nothing in the world palette is a grey.
    for (const token of ['--void', '--night', '--fog-mid', '--fog-far', '--bark-deep', '--bark', '--bark-lit'])
      expect(sat(by[token]), `${token} is not a colour`).toBeGreaterThanOrEqual(0.6);

    // The deepest value in the frame is a blue-black, not a black.
    expect(lum(by['--void'])).toBeGreaterThan(0.06);
    expect(lum(by['--void'])).toBeLessThan(0.16);

    // And the surfaces that have to read as *lit* actually do (L > 0.35).
    for (const token of ['--fog-far', '--bark-lit', '--lamp', '--brass'])
      expect(lum(by[token]), `${token} is not a lit value`).toBeGreaterThan(0.35);
  });
});

/**
 * Five runners a player can tell apart, in two places that must not drift.
 *
 * The world paints the identity colour on a strap; the claim meter paints it on
 * the rim of that runner's pip. Two copies of one list is two chances for the
 * meter to disagree with the figure it is about, which is worse than having no
 * identity colour at all.
 */
describe('the Kindlings are five people, not five instances', () => {
  const stage = read('client/src/stage.ts');
  const css = read('client/public/styles.css');

  it('wears one list of five colours in both the world and the meter', () => {
    const declared = [...stage.matchAll(/const STRAPS = \[([^\]]+)\]/g)];
    expect(declared).toHaveLength(1);
    const straps = [...declared[0][1].matchAll(/#[0-9a-f]{6}/g)].map((match) => match[0]);
    expect(straps).toHaveLength(5);
    for (const [index, colour] of straps.entries())
      expect(css, `--kin-${index} does not match the strap the stage paints`).toContain(
        `--kin-${index}: ${colour};`,
      );
  });

  it('keeps the identity off the flame, so the emissive budget is untouched', () => {
    // §6.2: the only emissive surfaces are the lantern flame, the Lamp House, the
    // Crown Lamp and The Char's cracks. The identity is a strap and a rim.
    expect(stage).toContain('const STRAP = STRAPS[body.slot % STRAPS.length] as string;');
    expect(stage).toMatch(/ctx\.strokeStyle = STRAP;/);
    expect(stage).not.toMatch(/mix\(STRAP/);
    const dot = css.slice(css.indexOf('.pip .dot {'), css.indexOf('.pip[data-kin="0"]'));
    // The core of the pip is the shared warm; the identity is the ring outside it.
    expect(dot).toContain('var(--lamp-core)');
    expect(dot).toContain('0 0 0 1.5px var(--kin, transparent)');
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

  /*
   * The winding fault, bound so it cannot come back.
   *
   * `bar` and `slant` are wound clockwise; `ring` follows whichever way its
   * caller wrote its angles, so `C` (58° -> 302°) came out anticlockwise while
   * `B` (90° -> -90°) came out clockwise. Non-zero winding cancels where two
   * contours of opposite hand overlap, which punched a wedge out of every letter
   * in the face built from a bar meeting a bowl — measured on the specimen as 24
   * broken glyphs, including `B`, `C`, `G`, `R`, `S`, `U`, `a`, `e`, `s`, `u` and
   * six of the ten digits.
   *
   * The generator now normalises orientation at the point of encoding. This
   * checks the normaliser is still there and still applied, and re-derives the
   * two windings it exists to reconcile so a future edit to `ring` that changed
   * its handedness would fail here rather than in a screenshot.
   */
  it('winds every contour the same way, so overlapping strokes union', () => {
    const source = read('tools/make-display-font.mjs');
    expect(source).toContain('function orient(contours)');
    expect(source).toContain('function signedArea(contour)');
    expect(source).toContain('const contours = orient(rawContours);');

    const area = (points) => {
      let total = 0;
      for (let index = 0; index < points.length; index += 1) {
        const a = points[index];
        const b = points[(index + 1) % points.length];
        total += a[0] * b[1] - b[0] * a[1];
      }
      return total / 2;
    };
    // A bar, exactly as `bar()` emits one: clockwise, i.e. negative.
    expect(area([[0, 0], [0, 300], [100, 300], [100, 0]])).toBeLessThan(0);
    // A ring's outer edge written with increasing angles: anticlockwise. These
    // two hands are what `orient` reconciles.
    const arc = [];
    for (let step = 0; step <= 8; step += 1) {
      const t = ((58 + ((302 - 58) * step) / 8) * Math.PI) / 180;
      arc.push([Math.cos(t) * 150, Math.sin(t) * 150]);
    }
    expect(area(arc)).toBeGreaterThan(0);
  });
});

describe('the shell', () => {
  it('no longer calls the premium build a graybox in the browser tab', () => {
    expect(read('client/public/index.html')).toContain('<title>BRANCHFALL</title>');
  });
});

/**
 * Round 4's decision surface: four objects, one sentence, and no chart.
 *
 * The round-3 blind ranking could pick our decision screen out of four real
 * products in a second and named the tell as register rather than polish — a
 * stacked probability bar, a prose odds line, an RTP footnote and a link row,
 * none of which appears on any commercial crash or instant game's decision
 * surface. These guard the shape of what replaced it, because the two mistakes
 * available here are both ones a later pass would make in good faith: putting
 * the analytics back, and drawing the *wrong* figure on the object.
 */
describe('the route objects (DESIGN §3.2)', () => {
  const widgets = read('client/src/widgets.ts');
  const main = read('client/src/main.ts');
  const css = read('client/public/styles.css');

  it('carries the price and a picture, and no chart, on the resting surface', () => {
    // The objects: name, price, lanterns. Nothing else on the face.
    expect(widgets).toMatch(/export function routeStrip\(/u);
    expect(widgets).toMatch(/function lampRow\(/u);
    // And the analytics are gone from the module, not merely unused by a screen.
    for (const dead of ['outcomeBar', 'outcomeCaption', 'outcomeSegments', 'routeCard']) {
      expect(widgets, `${dead} should not survive round 4`).not.toContain(`function ${dead}`);
    }
    expect(css, 'the outcome bar leaves no styles behind').not.toContain('.outcome-bar');
  });

  /**
   * The picture on the object is expected survivors and it may not be the
   * break-even.
   *
   * NARROW's break-even is 2 of 5 against WIDE's 5 of 5, so a row of lit
   * lanterns reading "how many have to come back" draws the highest-variance
   * route in the game as the easiest bet on the screen. §10.3 forbids implying
   * favourable odds; expected survivors runs the other way and is the honest
   * shape, and it is the figure that makes `typical x price / squad` the same
   * return on all four.
   */
  it('draws the typical crossing on the object, never the break-even', () => {
    expect(main).toMatch(/typical: Number\(figures\.expectedSurvivors\.decimal\)/u);
    expect(main).not.toMatch(/typical: [^\n]*breakEven/u);
  });

  /** §3.2 build requirement 1: both fields on the resting surface, in words. */
  it('states the break-even and the falls-without-ending figure at rest', () => {
    expect(widgets).toMatch(/export function routeLine\(/u);
    expect(widgets).toContain('COPY.breakEven');
    expect(widgets).toContain('figures.display.fallsNonZeroPct');
    expect(widgets).toContain('RTP_LINE(options.rtp)');
    // And the decision screen draws it, for the selected route, unconditionally.
    expect(main).toMatch(/routeStrip\(objects, state\.route, pick\)/u);
    expect(main).toMatch(/routeLine\(\{/u);
  });

  /** The tutorial teaches the object the paid round uses, not a second one. */
  it('gives the rehearsal the same strip and the same sentence', () => {
    const rehearsal = main.slice(main.indexOf('function rehearsalScreen'));
    expect(rehearsal).toMatch(/routeStrip\(rehearsalObjects/u);
    expect(rehearsal).toMatch(/routeLine\(\{/u);
  });
});

/**
 * §6.5's precision rule, which the round-3 review found broken twice on one
 * screen: a claim at three places with no unit above a button reading the same
 * quantity at two with one, and a return multiple printed raw at four.
 */
describe('one quantity has one format (DESIGN §6.5)', () => {
  const main = read('client/src/main.ts');

  it('renders every multiplier and every claim at two places', async () => {
    const { multiplier, claimFigure } = await import('../client/src/api.ts');
    expect(multiplier('1.190476')).toBe('1.19x');
    expect(multiplier('4')).toBe('4.00x');
    expect(multiplier('3.0560')).toBe('3.06x');
    expect(multiplier('0.9095')).toBe('0.91x');
    expect(claimFigure('9.550')).toBe('9.55');
    expect(claimFigure('11.460')).toBe('11.46');
    expect(claimFigure('12')).toBe('12.00');
  });

  it('never prints the server strings raw where a player reads them', () => {
    // The two sites the review named, by the shape that made them wrong.
    expect(main).not.toMatch(/\$\{settlement\?\.returnMultiple \?\? '0'\}x/u);
    expect(main).not.toMatch(/text: frame\.claim\.display/u);
    expect(main).not.toMatch(/credits\([^)]*, 3\)/u);
  });
});

/**
 * §6.1's warm economy on the one screen that must not borrow it.
 *
 * `focalmask` on the round-3 loss frame found the largest bright-and-saturated
 * region on a total wipe was the gold `Back to the squad` — the most
 * attention-grabbing object on the one screen where nothing came home, painted
 * in the money colour.
 */
describe('a wipe borrows no gold (DESIGN §6.1, §S6)', () => {
  it('gives the wipe screen a cool primary of the same weight', () => {
    const main = read('client/src/main.ts');
    const css = read('client/public/styles.css');
    const wipe = main.slice(main.indexOf('function wipeScreen'), main.indexOf('function summaryScreen'));
    expect(wipe).toMatch(/class: 'btn primary cool settle-in'/u);
    expect(css).toContain('.btn.primary.cool');
    // Same height as the warm primary: the temperature changed, not the target.
    const cool = css.slice(css.indexOf('.btn.primary.cool {'), css.indexOf('.btn.primary.cool:active'));
    expect(cool).not.toMatch(/min-height|font-size/u);
  });
});
