/**
 * Copy discipline, enforced rather than promised.
 *
 * `docs/DESIGN.md` §10.3 bans a vocabulary on every surface a player reads, and
 * exempts the engineering documents. This file is that rule, executable. The v1
 * draft declared the ban and then tested only four phrases against the README,
 * so "the strategic heart of the game" shipped inside the document that declares
 * the ban's own scope.
 *
 * It also guards the anti-fake-agency rule, which is a copy rule with teeth: a
 * spec that says a cosmetic choice moves the odds will produce a UI that lies.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

/** Surfaces a player may read. The ban applies here. */
const PLAYER_FACING = { 'README.md': read('README.md') };

/**
 * Engineering documents, exempt BY NAME so the exemption is visible in the test
 * rather than implied by the absence of a check.
 */
const ENGINEERING_EXEMPT = ['docs/MATH.md', 'docs/ENGINE.md'];

const designDoc = read('docs/DESIGN.md');

/**
 * The banned vocabulary from DESIGN.md §10.3, with the two — and only two —
 * exceptions that section names: an explicit denial ("no skill") and the
 * technical term "house edge".
 */
const BANNED = [
  { word: 'strategy', pattern: /\bstrateg(y|ic|ies|ically)\b/gi },
  { word: 'skill', pattern: /\bskills?\b/gi, allow: /\bno skill\b/i },
  { word: 'outplay', pattern: /\boutplay(ed|s|ing)?\b/gi },
  { word: 'beat the odds', pattern: /\bbeat the odds\b/gi },
  { word: 'master', pattern: /\bmaster(y|ed|ing|s)?\b/gi },
  { word: 'edge', pattern: /\bedges?\b/gi, allow: /\bhouse edge\b/i },
  { word: 'system', pattern: /\bsystems?\b/gi },
  { word: 'pro', pattern: /\bpro\b/gi },
];

describe('banned vocabulary on player-facing surfaces', () => {
  for (const [name, text] of Object.entries(PLAYER_FACING)) {
    for (const { word, pattern, allow } of BANNED) {
      it(`${name} does not say "${word}"`, () => {
        const offending = [];
        for (const match of text.matchAll(pattern)) {
          const context = text.slice(Math.max(0, match.index - 30), match.index + match[0].length + 10);
          if (allow && allow.test(context)) continue;
          offending.push(context.replace(/\n/g, ' '));
        }
        expect(offending, `${name}: banned word "${word}"`).toEqual([]);
      });
    }
  }

  it('scopes the ban explicitly, and names the exemptions and the exceptions', () => {
    expect(designDoc).toContain('Scope: every surface a player reads');
    for (const doc of ENGINEERING_EXEMPT) expect(designDoc).toContain(doc);
    expect(designDoc).toContain('Two exceptions, and only two');
    expect(designDoc).toMatch(/\*"no skill"\*/);
    expect(designDoc).toMatch(/\*"house edge"\*/);
  });

  it('still says the thing the ban exists to make us say', () => {
    expect(PLAYER_FACING['README.md']).toMatch(/contains \*\*no skill\*\*/);
  });
});

describe('anti-fake-agency', () => {
  it('never claims a cosmetic or identity choice moves the distribution', () => {
    const claims = [
      /which .{0,40}shelter.{0,80}changes .{0,40}lane sizes/i,
      /changes next arena's lane sizes/i,
      /who .{0,20}runs where.{0,40}changes the odds/i,
    ];
    for (const [name, text] of Object.entries({ designDoc, ...PLAYER_FACING })) {
      for (const claim of claims) expect(text, `${name}`).not.toMatch(claim);
    }
  });

  it('states the honest version, in the product spec, in both halves', () => {
    expect(designDoc).toContain('Nothing distributional.');
    expect(designDoc).toContain('What it changes is *who comes home*');
    expect(designDoc).toContain('changes who comes home. It does not change');
  });

  it('does not present a decision the game does not offer', () => {
    // At two and three runners SPLIT has exactly one legal balance.
    expect(designDoc).toContain('there is only one legal balance, and the control does');
    expect(designDoc).toContain('We do not render a disabled slider');
  });

  it('marks the lane balance as a real lever with its real limits', () => {
    expect(designDoc).toMatch(/\*\*Not\*\* the multiplier, \*\*not\*\* P\(all clear\)/);
  });
});

describe('honest presentation rules that are copy rules', () => {
  it('refuses to frame Last Light as insurance', () => {
    expect(designDoc).toContain('Last Light is not insurance');
    // Every protection word may appear only inside an explicit denial — which is
    // exactly how the rule itself has to be written down.
    const protectionWords = /\b(insurance|safety net|hedge your|protect your stake)\b/gi;
    for (const [name, text] of Object.entries({ designDoc, ...PLAYER_FACING })) {
      for (const match of text.matchAll(protectionWords)) {
        const context = text.slice(Math.max(0, match.index - 70), match.index).replace(/\n/g, ' ');
        expect(context, `${name}: unqualified "${match[0]}"`).toMatch(/\b(not|never|no)\b/i);
      }
    }
  });

  it('never presents a sub-stake return as a win', () => {
    expect(designDoc).toContain('never** presented as a win');
    expect(designDoc).toContain('No win presentation over a net loss');
  });

  it('balances the Wide/Split framing instead of selling one card', () => {
    const readme = PLAYER_FACING['README.md'];
    // Split's headline advantage must be accompanied by its cost, and Wide's.
    expect(readme).toContain('Neither card is the right answer');
    expect(readme).toMatch(/Wide keeps\s*\n?more runners alive/);
    expect(designDoc).toContain('Neither card is the right answer and the copy is forbidden');
  });

  it('keeps the certification boundary visible in every document', () => {
    for (const [name, text] of Object.entries({
      designDoc,
      'docs/MATH.md': read('docs/MATH.md'),
      'docs/ENGINE.md': read('docs/ENGINE.md'),
      ...PLAYER_FACING,
    })) {
      expect(text.toLowerCase(), name).toMatch(/certificat/);
    }
    expect(PLAYER_FACING['README.md']).toContain('**None claimed.**');
  });
});

describe('originality guard', () => {
  it('names no third-party property anywhere in the specification', () => {
    const forbidden =
      /\b(fall guys|takeshi|wipeout|ninja warrior|squid game|beanie|jelly bean|mediatonic|stumble guys)\b/i;
    for (const path of ['README.md', 'docs/DESIGN.md', 'docs/MATH.md', 'docs/ENGINE.md']) {
      expect(read(path), path).not.toMatch(forbidden);
    }
  });

  it('states the originality guard and describes references rather than works', () => {
    expect(designDoc).toContain('Originality guard');
    expect(designDoc).toContain('described, not appropriated');
  });
});

describe('art direction is specific enough to build from', () => {
  it('gives a hex value for every palette token', () => {
    const palette = designDoc.slice(designDoc.indexOf('### 6.1 Palette'), designDoc.indexOf('### 6.2'));
    const tokens = [...palette.matchAll(/^\| `(--[a-z-]+)` \| `(#[0-9A-Fa-f]{6})` \|/gm)];
    expect(tokens.length).toBeGreaterThanOrEqual(16);
  });

  it('briefs all five arenas, not one', () => {
    for (const arena of ['LOWBRANCH', 'THE GRAIN', 'WINDROW', 'THE CHAR', 'CROWN']) {
      const index = designDoc.indexOf(`— ${arena}.`);
      expect(index, `${arena} has no brief`).toBeGreaterThan(-1);
      const brief = designDoc.slice(index, index + 1400);
      for (const heading of ['Silhouette motif', 'Fog', 'Dominant material', 'Fork', 'Escalates']) {
        expect(brief, `${arena} brief is missing "${heading}"`).toContain(heading);
      }
    }
  });

  it('names a runtime, a device floor, a frame-rate target and a download budget', () => {
    const section = designDoc.slice(designDoc.indexOf('### 6.8'), designDoc.indexOf('### 6.9'));
    expect(section).toContain('WebGL2');
    expect(section).toMatch(/iPhone SE 2020/);
    expect(section).toMatch(/Galaxy A54/);
    expect(section).toMatch(/Adreno 610/);
    expect(section).toMatch(/60 fps/);
    expect(section).toMatch(/30 fps/);
    expect(section).toMatch(/≤ 5 MB gzipped/);
  });

  it('gives a per-feature millisecond budget that sums within a 60 fps frame', () => {
    const section = designDoc.slice(designDoc.indexOf('Per-frame budget'), designDoc.indexOf('**What degrades'));
    const budgets = [...section.matchAll(/\|\s*([0-9.]+) ms\s*\|/g)].map((m) => Number(m[1]));
    expect(budgets.length).toBeGreaterThanOrEqual(7);
    const total = budgets.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(16.7);
    expect(total).toBeGreaterThan(15);
  });

  it('replaces the unshippable v1 lighting spec rather than restating it', () => {
    expect(designDoc).not.toMatch(/3 shadow-casting point lights/i);
    expect(designDoc).toMatch(/at most one shadow-casting light exists in the scene, and it is a spot/i);
    expect(designDoc).not.toMatch(/transmission 0\.9, IOR 1\.5/);
    expect(designDoc).toContain('There is no refraction pass in this game on any tier');
  });

  it('gives a fallback ladder with three named tiers', () => {
    for (const tier of ['T0 Emberlight', 'T1 Understory', 'T2 Canopy']) {
      expect(designDoc).toContain(tier);
    }
  });
});
