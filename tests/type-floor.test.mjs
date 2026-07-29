/**
 * `DESIGN.md` §6.5 writes its sizes as limits, so this test treats them as limits.
 *
 *   > Minimum sizes: 15 pt body, 13 pt secondary, 28 pt for the claim figure.
 *   > Numbers never below 15 pt.
 *
 * The round-1 review found 45 leaf elements at 10 px, including per-runner claim
 * numerals; the round-2 review found stake presets and loss-limit presets at
 * 13 px, which put "25.00" on a money control under the numeral floor. Both were
 * a stylesheet rule reaching for a size instead of a floor, so the guard is at
 * the source: every size in the stylesheet is one of the four `--floor-*`
 * tokens or a raw value at or above the body floor, every declared exception is
 * named here with its reason, and no inline style in the client sets a size
 * below the secondary floor.
 *
 * What this cannot check is a rule that uses a *legal* token for the wrong kind
 * of text — 13 px is right for secondary prose and wrong for a money figure. The
 * convention that covers that is the `money` class, which carries the numeral
 * floor with it; the DOM-level assertion lives in the client smoke check.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(resolve(root, 'client/public/styles.css'), 'utf8');

const BODY_FLOOR = 15;
const SECONDARY_FLOOR = 13;
const CLAIM_FLOOR = 28;

/** The tokens §6.5 becomes, and the value each one must hold. */
const TOKEN_FLOORS = {
  '--floor-body': BODY_FLOOR,
  '--floor-secondary': SECONDARY_FLOOR,
  '--floor-numeral': BODY_FLOOR,
  '--claim-figure': CLAIM_FLOOR,
};

/**
 * The one size in the stylesheet that is below the body floor on purpose.
 *
 * `.bar .axis::before` is the break-even tick — a `▲` glyph, painted only on the
 * break-even bar and reserved transparently on every other, so the bars all get
 * the same fill height. It carries no text and no figure: it is a chart mark, and
 * a chart mark at type size would be a chart mark the size of a word.
 */
const ALLOWED_BELOW_FLOOR = [{ value: 8, selector: '.bar .axis::before', reason: 'break-even tick glyph' }];

describe('§6.5 type floors', () => {
  it('declares each floor token at the size the document writes', () => {
    for (const [token, expected] of Object.entries(TOKEN_FLOORS)) {
      const match = new RegExp(`${token}:\\s*(\\d+(?:\\.\\d+)?)px`, 'u').exec(css);
      expect(match, `${token} is declared`).not.toBeNull();
      expect(Number(match[1]), `${token}`).toBe(expected);
    }
  });

  it('sets no size in the stylesheet below the body floor, except the declared chart mark', () => {
    const offenders = [];
    const seenExceptions = [];
    const declaration = /font-size:\s*([^;}]+)[;}]/gu;
    let match = declaration.exec(css);
    while (match !== null) {
      const value = match[1].trim();
      const line = css.slice(0, match.index).split('\n').length;
      if (!value.startsWith('var(--')) {
        const px = /^(\d+(?:\.\d+)?)px$/u.exec(value);
        if (px === null) offenders.push(`line ${line}: font-size: ${value} is neither a floor token nor a px value`);
        else if (Number(px[1]) < BODY_FLOOR) {
          const allowed = ALLOWED_BELOW_FLOOR.find((entry) => entry.value === Number(px[1]));
          if (allowed === undefined) offenders.push(`line ${line}: font-size: ${value} is below the ${BODY_FLOOR}px body floor`);
          else seenExceptions.push(allowed.selector);
        }
      } else if (!(value.slice('var('.length, -1) in TOKEN_FLOORS))
        offenders.push(`line ${line}: font-size: ${value} is not one of the §6.5 floor tokens`);
      match = declaration.exec(css);
    }

    expect(offenders).toEqual([]);
    // Every declared exception is still in the file: a stale allowance is a hole.
    expect(new Set(seenExceptions)).toEqual(new Set(ALLOWED_BELOW_FLOOR.map((entry) => entry.selector)));
  });

  it('sets no inline size in the client below the secondary floor', () => {
    const offenders = [];
    for (const file of ['main.ts', 'widgets.ts', 'dom.ts', 'derive.ts']) {
      const source = readFileSync(resolve(root, 'client/src', file), 'utf8');
      const inline = /font-size:\s*(\d+(?:\.\d+)?)px/gu;
      let match = inline.exec(source);
      while (match !== null) {
        if (Number(match[1]) < SECONDARY_FLOOR)
          offenders.push(`${file}: inline font-size ${match[1]}px is below the ${SECONDARY_FLOOR}px secondary floor`);
        match = inline.exec(source);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives every money figure the numeral floor through one class', () => {
    // `.money` is the convention: mono, tabular, and the numeral floor. A money
    // figure that opts out of it opts out of the floor, so the rule that defines
    // it must carry the numeral token and nothing weaker.
    const money = /\.money\s*\{([^}]*)\}/u.exec(css);
    expect(money, '.money is declared').not.toBeNull();
    expect(money[1]).toContain('font-size: var(--floor-numeral)');
  });
});
