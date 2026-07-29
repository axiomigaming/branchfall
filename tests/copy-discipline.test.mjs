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

const designDocRaw = read('docs/DESIGN.md');

/**
 * Every in-client string that exists today is a quoted `*"..."*` line inside
 * DESIGN.md — §3, §4, the S-screens and the §5.2.6 copy sheet. Scanning only
 * README.md left the one file where player copy actually lives outside the ban.
 * Generated figure slots are stripped so the extracted string is what a player
 * would see, not the markdown that produces it.
 */
export function extractInClientCopy(text) {
  const stripped = text.replace(/<!--[\s\S]*?-->/g, '');
  return [...stripped.matchAll(/\*"([^"]*)"\*/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());
}

const IN_CLIENT_COPY = extractInClientCopy(designDocRaw);

/** Player-facing *documents*: whole files a player may read end to end. */
const PLAYER_DOCS = { 'README.md': read('README.md') };

/**
 * Surfaces a player may read. The ban applies here. This is the documents plus
 * the in-client strings, which are not a document and must not be held to
 * document-level rules (a button label carries no certification boundary).
 */
const PLAYER_FACING = {
  ...PLAYER_DOCS,
  'docs/DESIGN.md in-client copy': IN_CLIENT_COPY.join('\n'),
};

/**
 * Engineering documents, exempt BY NAME so the exemption is visible in the test
 * rather than implied by the absence of a check.
 */
const ENGINEERING_EXEMPT = ['docs/MATH.md', 'docs/ENGINE.md'];

const designDoc = designDocRaw;

/**
 * Prose assertions must survive re-flowing a paragraph. Match on the words, with
 * any whitespace between them, so an editor moving a line break does not fail a
 * build for a reason that has nothing to do with what the sentence says.
 */
const flowed = (phrase) =>
  new RegExp(phrase.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));


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

/**
 * Scan one surface for one banned word.
 *
 * `units` matters: for a document the unit is the whole file, but for in-client
 * copy the unit is each individual string. Joining the strings and scanning the
 * blob let an adjacent line's "no skill" whitelist a different string's "skill",
 * because the exception is decided from a context window.
 */
function offences(units, { pattern, allow }) {
  const found = [];
  for (const unit of units) {
    for (const match of unit.matchAll(pattern)) {
      const context = unit.slice(Math.max(0, match.index - 30), match.index + match[0].length + 10);
      if (allow && allow.test(context)) continue;
      found.push(context.replace(/\n/g, ' '));
    }
  }
  return found;
}

/** name -> the units the ban is applied to, independently. */
const BAN_SURFACES = {
  'README.md': [PLAYER_DOCS['README.md']],
  'docs/DESIGN.md in-client copy': IN_CLIENT_COPY,
};

describe('banned vocabulary on player-facing surfaces', () => {
  for (const [name, units] of Object.entries(BAN_SURFACES)) {
    for (const banned of BANNED) {
      it(`${name} does not say "${banned.word}"`, () => {
        expect(offences(units, banned), `${name}: banned word "${banned.word}"`).toEqual([]);
      });
    }
  }

  it('decides each exception inside its own string, not from a neighbour', () => {
    const skill = BANNED.find((b) => b.word === 'skill');
    // Joined, the allowed "no skill" would whitelist the adjacent violation.
    expect(offences([['This game has no skill.', 'Reward your skill.'].join('\n')], skill)).toEqual([]);
    // Per string, it does not. This is the bug the joined form had.
    expect(offences(['This game has no skill.', 'Reward your skill.'], skill)).toHaveLength(1);
  });

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

  it('actually reaches the in-client strings, and says so in the spec', () => {
    // A floor, so that deleting the quoting convention fails the build rather
    // than silently disabling the guard.
    expect(IN_CLIENT_COPY.length).toBeGreaterThanOrEqual(20);
    expect(IN_CLIENT_COPY).toContain('Cosmetics never change the odds.');
    expect(IN_CLIENT_COPY.some((s) => s.startsWith('Both of these return 95.5%'))).toBe(true);
    expect(designDoc).toContain('In-client copy lives in this document, so the guard reads this document');
  });

  it('closes the typography and entity bypasses around the extractor', () => {
    // The extractor is anchored on ASCII `*"..."*`. Anything that renders as
    // player copy without matching it would be invisible to the ban, so the
    // convention itself is enforced: no curly quotes, no character entities.
    expect(designDoc, 'curly quotes would hide a string from the copy guard').not.toMatch(/[\u201C\u201D]/);
    expect(designDoc, 'character entities would hide a banned word from the guard').not.toMatch(/&#?[a-zA-Z0-9]+;/);
    // Known and accepted limit, recorded rather than implied: copy that will
    // live in client source, store listings and marketing is out of this
    // repository's reach. DESIGN.md §10.3 binds those surfaces by rule; only
    // this repository's copy is bound by test.
    expect(designDoc).toContain('In-client copy, store listings,');
  });

  it('would catch a banned word introduced into an in-client string', () => {
    const planted = extractInClientCopy('Somewhere in S2: *"Master the fork."* and prose about edges.');
    expect(planted).toEqual(['Master the fork.']);
    const hits = planted.join('\n').match(/\bmaster(y|ed|ing|s)?\b/gi);
    expect(hits, 'the extractor must surface the string the ban would reject').toHaveLength(1);
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
      ...PLAYER_DOCS,
    })) {
      expect(text.toLowerCase(), name).toMatch(/certificat/);
    }
    expect(PLAYER_DOCS['README.md']).toContain('**None claimed.**');
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

/**
 * §6.9 rule 2 required ragdoll to blend in only off-frustum, and §9's signature
 * shot stays with the falling lantern all the way down. So the one shot that
 * matters never exercised the ragdoll line, and the clip library — combinatorial
 * across arena, lane geometry, slot, cause and margin — had no published bound.
 */
describe('the presentation contract resolves against the signature shot', () => {
  const section = designDoc.slice(designDoc.indexOf('### 6.9'), designDoc.indexOf('## 7. Sound direction'));

  it('states that every visible fall is authored and ragdoll is a continuation', () => {
    expect(section).toMatch(flowed('Every fall the camera can see is an authored clip'));
    expect(section).toMatch(flowed('Ragdoll is not a fall system'));
    expect(section).toMatch(flowed('after the figure has left the camera frustum'));
    // The tier table must not read as if ragdoll produced visible falls.
    expect(designDoc).toMatch(flowed('an off-frustum *continuation*, never a visible fall'));
  });

  it('resolves the Last Lamp contradiction explicitly rather than exempting it', () => {
    expect(section).toMatch(flowed('The Last Lamp does not use ragdoll, and that is the rule working'));
    expect(section).toMatch(/hero fall clip per arena/);
    expect(section).toMatch(flowed('the resolution is not an exemption'));
  });

  it('derives the near-miss margin from the committed table instead of inventing it', () => {
    // Rule 4 is only dischargeable if the data carries a margin. It does: the
    // VALUE of a clearing slip draw. NARROW has one clearing value, so it has
    // one band, and authoring three would be manufacturing a margin.
    expect(section).toMatch(flowed('The margin is already in the committed table'));
    expect(section).toMatch(/\| NARROW \| 1 \(`0`\) \| \*\*1\*\* \|/);
    expect(section).toMatch(flowed('falls have no margin resolution at all'));
  });

  it('bounds the clip library with a published count and a rule that keeps it linear', () => {
    expect(section).toMatch(flowed('Clips are per runner, never per outcome'));
    expect(section).toMatch(flowed('Slot position is therefore a **transform**, not a clip axis'));
    expect(section).toMatch(/\| \*\*Total authored clips\*\* \| \| \*\*48\*\* \|/);
    expect(section).toMatch(flowed('A build that needs a 49th clip'));
  });
});

/**
 * Everything in this specification is itemised except the one budget that
 * decides whether a small team ships it. §11 had three bullets and no number.
 */
describe('art production is sized, not assumed', () => {
  const section = designDoc.slice(designDoc.indexOf('### 11.1 Asset inventory'), designDoc.indexOf('## 12.'));

  /**
   * Parse a markdown table of `| label | number |` rows, tolerating bold markers,
   * thousands separators and trailing prose in the number cell. Rows the parser
   * cannot read are the ones that could carry an unbudgeted cost past the sum, so
   * each caller asserts a row count as well as a total.
   */
  const numbered = (table) =>
    [...table.matchAll(/^\| *(?:\*\*)?([^|]+?)(?:\*\*)? *\| *(?:\*\*)?([\d,]+)/gm)].map((m) => ({
      label: m[1].trim().toLowerCase(),
      value: Number(m[2].replace(/,/g, '')),
    }));

  it('publishes an asset inventory, a clip count and a per-asset geometry budget', () => {
    expect(section).toContain('Fossil module kit');
    expect(section).toContain('Fork assembly');
    expect(section).toContain('Dressing props');
    expect(section).toContain('48 authored clips');
  });

  it('keeps the on-screen triangle budget under the T1 ceiling it cites', () => {
    const table = section.slice(section.indexOf('In frame, T1'), section.indexOf('**Textures**'));
    const parsed = numbered(table);
    const total = parsed.filter((r) => r.label === 'total');
    const items = parsed.filter((r) => r.label !== 'total');
    expect(total).toHaveLength(1);
    expect(items.length).toBeGreaterThanOrEqual(5);
    expect(items.reduce((a, r) => a + r.value, 0)).toBe(total[0].value);
    expect(total[0].value).toBeLessThan(120000);
  });

  it('itemises the 16 MB round trip the runtime section only ever declared', () => {
    const table = section.slice(section.indexOf('| Item | KB |'), section.indexOf('**Animation.**'));
    const parsed = numbered(table);
    const total = parsed.filter((r) => r.label === 'total round trip');
    const reserve = parsed.filter((r) => r.label.startsWith('reserve'));
    const items = parsed.filter((r) => !/total round trip|^reserve/.test(r.label));
    expect(total).toHaveLength(1);
    expect(reserve).toHaveLength(1);
    expect(items.length).toBeGreaterThanOrEqual(7);
    expect(items.reduce((a, r) => a + r.value, 0)).toBe(total[0].value);
    expect(total[0].value + reserve[0].value).toBe(16000);
    expect(reserve[0].value / 16000).toBeGreaterThanOrEqual(0.05);
  });

  it('books art hours bottom-up, with contingency, and the arithmetic holds', () => {
    // Four columns here: work package, unit, units, hours. Hours is the last
    // cell of every row, and a row the parser cannot read is a row that could
    // carry unbudgeted work past the sum, so every row must parse.
    const table = section.slice(section.indexOf('| Work package |'), section.indexOf('**Headcount'));
    const parsed = table
      .split('\n')
      .filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l) && !/^\| *Work package/.test(l))
      .map((line) => {
        const cells = line.split('|').slice(1, -1).map((c) => c.replace(/\*/g, '').trim());
        return { label: cells[0].toLowerCase(), hours: Number(cells[cells.length - 1].replace(/,/g, '')) };
      });
    expect(parsed.every((r) => Number.isFinite(r.hours)), 'an hours row the parser cannot read').toBe(true);
    const pick = (re) => parsed.filter((r) => re.test(r.label));
    const subtotal = pick(/^subtotal$/);
    const contingency = pick(/^revision and contingency/);
    const total = pick(/^total art hours$/);
    const items = parsed.filter((r) => !/^subtotal$|^revision and contingency|^total art hours$/.test(r.label));
    expect(subtotal).toHaveLength(1);
    expect(contingency).toHaveLength(1);
    expect(total).toHaveLength(1);
    expect(items.length).toBeGreaterThanOrEqual(20);
    expect(items.reduce((a, r) => a + r.hours, 0)).toBe(subtotal[0].hours);
    expect(contingency[0].hours).toBe(Math.round(subtotal[0].hours * 0.2));
    expect(subtotal[0].hours + contingency[0].hours).toBe(total[0].hours);
    // 30 productive hours per person-week, stated rather than assumed at 40.
    expect(section).toMatch(flowed('30 productive hours per person-week'));
  });

  it('gives a headcount, a calendar and a gate rather than a total', () => {
    expect(section).toMatch(/3\.5 art FTE/);
    expect(section).toMatch(/\*\*25 weeks\*\*/);
    expect(section).toMatch(flowed('The vertical slice is a gate, not a milestone'));
    expect(section).toMatch(flowed('roughly five person-weeks, per arena'));
  });

  it('states which cuts are art decisions and which are model decisions', () => {
    expect(section).toMatch(flowed('not an art lever'));
    expect(section).toContain('`arenas` is a fingerprinted model constant');
    expect(section).toMatch(flowed('What these hours do not include'));
  });
});

describe('the shared clip is treated as the advertising surface it is', () => {
  it('names its regulatory status instead of only banning hype captions', () => {
    const section = designDoc.slice(
      designDoc.indexOf('### 10.7 The clip export'),
      designDoc.indexOf('### 10.8 Accessibility'),
    );
    expect(section).toMatch(flowed('That artefact is advertising material'));
    expect(section).toContain('CAP Code');
    expect(section).toContain('ASA');
    expect(section).toMatch(flowed('strong appeal to under-18s'));
    expect(section).toMatch(flowed('the feature ships **off** in that market'));
    expect(section).toMatch(flowed('Both endings export'));
    expect(section).toMatch(flowed('No incentive, ever'));
    // And the money rule the clip cannot carry.
    expect(section).toMatch(flowed('never carries a stake, a claim, a multiplier'));
  });
});

/**
 * The v1 per-frame budget summed to 16.0 ms of a 16.6 ms frame — 3.6% headroom —
 * and this file enforced that tightness with `total <= 16.7`, which made the
 * spec's own harness a guaranteed failure on the device it named. The budget is
 * now a shape with rules, and these are the rules.
 */
describe('the runtime budget is internally consistent and reserves real headroom', () => {
  // NOTE ON WHAT THIS CAN AND CANNOT DO. Nothing here proves the budget is
  // achievable — no test in a specification repository can, and pretending
  // otherwise is how a green build becomes a false claim. DESIGN.md §11 assigns
  // achievability to a performance harness on real hardware. What these tests
  // enforce is that the published budget is arithmetically honest, that it obeys
  // its own stated rules, and that the v1 failure (96.4% of the frame spent,
  // enforced as a ceiling) cannot silently return.
  const section = designDoc.slice(designDoc.indexOf('### 6.8'), designDoc.indexOf('### 6.9'));

  /** Parse one budget table: its frame period, its pass rows, its declared total and headroom. */
  function parseBudget(label) {
    const start = section.indexOf(label);
    expect(start, `no budget table labelled ${label}`).toBeGreaterThan(-1);
    const table = section.slice(start, section.indexOf('\n\n', section.indexOf('Reserved headroom', start)));
    const period = Number(/frame period ([0-9.]+) ms/.exec(table)[1]);
    // Every body row must parse. A row the parser cannot read is a row that
    // could carry an unbudgeted cost past the sum, so it fails rather than
    // being skipped.
    const bodyRows = table
      .split('\n')
      .filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l) && !/^\| *Pass *\|/.test(l));
    const rows = [...table.matchAll(/^\| *(.+?) *\| *(?:\*\*)?([0-9.]+) ms(?:\*\*)?(.*)$/gm)].map((m) => ({
      label: m[1].replace(/\*/g, '').toLowerCase(),
      ms: Number(m[2]),
      rest: m[3],
    }));
    expect(rows.length, `${label}: ${bodyRows.length - rows.length} row(s) the budget parser cannot read`).toBe(
      bodyRows.length,
    );
    const passes = rows.filter((r) => !/total|headroom/.test(r.label));
    const totals = rows.filter((r) => /total/.test(r.label));
    const headrooms = rows.filter((r) => /headroom/.test(r.label));
    // Exactly one of each, so a second "total" row cannot shadow the real one.
    expect(totals, `${label}: expected exactly one total row`).toHaveLength(1);
    expect(headrooms, `${label}: expected exactly one headroom row`).toHaveLength(1);
    expect(new Set(passes.map((r) => r.label)).size, `${label}: duplicate pass labels`).toBe(passes.length);
    return { period, passes, total: totals[0], headroom: headrooms[0] };
  }

  for (const label of ['**T1 at 60 fps', '**T1 at 30 fps']) {
    describe(label.replace(/\*/g, ''), () => {
      const { period, passes, total, headroom } = parseBudget(label);

      it('itemises at least seven passes and declares a total that matches them', () => {
        expect(passes.length).toBeGreaterThanOrEqual(7);
        const sum = passes.reduce((a, r) => a + r.ms, 0);
        expect(total, 'no declared total row').toBeDefined();
        expect(Math.abs(sum - total.ms), `rows sum to ${sum.toFixed(2)}, table claims ${total.ms}`).toBeLessThan(0.05);
      });

      it('reserves at least 25% of the frame as headroom it may not spend', () => {
        expect(headroom, 'no declared headroom row').toBeDefined();
        expect(Math.abs(total.ms + headroom.ms - period)).toBeLessThan(0.05);
        expect(headroom.ms / period).toBeGreaterThanOrEqual(0.25);
        expect(headroom.rest).toMatch(/may not spend it/);
        // The stated headroom percentage must be the real one too. Checking only
        // the total's percentage let two wrong headroom figures through.
        const claimed = Number(/([0-9.]+)%/.exec(headroom.rest)[1]);
        expect(
          Math.abs(claimed - (100 * headroom.ms) / period),
          `headroom claims ${claimed}%, arithmetic gives ${((100 * headroom.ms) / period).toFixed(2)}%`,
        ).toBeLessThan(0.1);
      });

      it('keeps the named passes under the 75% rule', () => {
        expect(total.ms / period).toBeLessThanOrEqual(0.75);
        // And the declared percentage in the prose is the real one.
        const claimed = Number(/([0-9.]+)% of the frame/.exec(total.rest)[1]);
        expect(Math.abs(claimed - (100 * total.ms) / period)).toBeLessThan(0.2);
      });
    });
  }

  it('states the 75% rule and the soak methodology rather than implying them', () => {
    expect(section).toMatch(flowed('may not exceed 75% of the frame period'));
    expect(section).toMatch(flowed('95th percentile frame time'));
    expect(section).toContain('10-minute soak');
    expect(section).toContain('co-resident iframe');
    // And §11's acceptance criteria say the same thing, so the harness that
    // enforces the budget is specified against the same methodology.
    expect(designDoc).toMatch(flowed('95th-percentile frame after a 10-minute soak'));
    expect(designDoc).toContain('headroom never spent');
  });

  it('does not repeat the v1 budget that left 0.6 ms of a 16.6 ms frame', () => {
    const rows = [...section.matchAll(/^\| *(?:\*\*)?Reserved headroom/gm)];
    expect(rows.length).toBe(2);
    expect(section).not.toMatch(/\| \*\*Headroom\*\* \| \*\*0\.6 ms\*\* \|/);
  });

  it('separates device class from quality tier, and gives each class its own frame target', () => {
    // The A54 and the iPhone SE 2020 must not share a frame target.
    const a54 = /\| \*\*C1 Median\*\* \|[^|]*Galaxy A54[^|]*\|[^|]*\|[^|]*30 fps[^|]*\|/.exec(section);
    const se = /\| \*\*C2 Fast\*\* \|[^|]*iPhone SE 2020[^|]*\|[^|]*\|[^|]*60 fps[^|]*\|/.exec(section);
    expect(a54, 'the Galaxy A54 row must declare a 30 fps target').not.toBeNull();
    expect(se, 'the iPhone SE 2020 row must declare a 60 fps target').not.toBeNull();
    expect(section).toMatch(flowed('Device class is not the same thing as quality tier'));
    expect(section).toMatch(flowed('The mid-range phone gets the look'));
  });

  it('resolves the "custom renderer" ambiguity and books the library it chose', () => {
    // The ambiguous v1 phrase may survive only as a quotation of what changed,
    // never as a live decision.
    for (const m of section.matchAll(/three\.js-class custom WebGL2 renderer/g)) {
      expect(section.slice(Math.max(0, m.index - 40), m.index)).toMatch(/v1 draft said/);
    }
    expect(section).toMatch(/\| Runtime \| \*\*three\.js, with our own render pipeline on top\*\*/);
    expect(section).toContain('three.js, with our own render pipeline on top');
    expect(section).toMatch(flowed('~295 KB gzipped of engine'));
    expect(section).toMatch(flowed('addons rather than core'));
    expect(section).toMatch(flowed('cannot be lazy because nothing renders before the first texture'));
    // And it is booked in the first-load table, split into core, addons and the
    // Basis transcoder rather than as one number that quietly omits two of them.
    expect(section).toMatch(/\| three\.js core, tree-shaken[^|]*\| 150 KB \|/);
  });

  it('itemises the first-load budget and keeps a real reserve under 5 MB', () => {
    const table = section.slice(section.indexOf('#### First load'), section.indexOf('**The texture line, worked'));
    const bodyRows = table
      .split('\n')
      .filter((l) => l.startsWith('|') && !/^\|\s*-+/.test(l) && !/^\| *Item *\|/.test(l));
    const rows = [...table.matchAll(/^\| *(.+?) *\| *(?:\*\*)?([\d,]+) KB(?:\*\*)?/gm)].map((m) => ({
      label: m[1].replace(/\*/g, '').toLowerCase(),
      kb: Number(m[2].replace(/,/g, '')),
    }));
    expect(rows.length, `${bodyRows.length - rows.length} first-load row(s) the parser cannot read`).toBe(
      bodyRows.length,
    );
    const items = rows.filter((r) => !/total|reserve/.test(r.label));
    const totals = rows.filter((r) => /total/.test(r.label));
    const reserves = rows.filter((r) => /reserve/.test(r.label));
    expect(totals).toHaveLength(1);
    expect(reserves).toHaveLength(1);
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.reduce((a, r) => a + r.kb, 0)).toBe(totals[0].kb);
    expect(totals[0].kb + reserves[0].kb).toBe(5000);
    expect(reserves[0].kb / 5000).toBeGreaterThanOrEqual(0.2);
  });

  it('does not conflate ASTC with ETC2, which halves the fallback path on paper', () => {
    // 2 bpp against 4 bpp. The first version of this table wrote them as one
    // number and understated the ETC2 path by a factor of two before mipmaps.
    expect(section).not.toMatch(/ASTC 8x8 \/ ETC2 \| 1,320 KB/);
    expect(section).toMatch(flowed('ASTC 8x8 is 2 bits per texel; ETC2 RGB is 4'));
    expect(section).toMatch(flowed('every texture figure includes the mip chain'));
    expect(section).toMatch(/\| \*\*1,748 KB\*\* \|/);
    expect(section).toMatch(/\| \*\*1,398 KB\*\* \|/);
    // And the budgeted line must be the worse of the two, not the nicer one.
    expect(section).toMatch(/Arena 1 \*\*boot\*\* textures[^|]*\| 1,750 KB \|/);
  });

  it('books the engine as core plus addons plus transcoder, not as one hopeful number', () => {
    for (const row of [/three\.js core, tree-shaken/, /three\.js addons/, /KTX2 \/ Basis transcoder/]) {
      expect(section, `missing engine line ${row}`).toMatch(row);
    }
    expect(section).toMatch(flowed('targets against a named artifact, not measurements'));
    expect(section).toMatch(flowed('dist/stats.json'));
  });

  it('bounds the C1 claim with the numbers that actually decide it', () => {
    const table = section.slice(section.indexOf('And the size of that claim'), section.indexOf('**We are not claiming'));
    for (const quantity of ['Render target', 'Fog march', 'Draw calls', 'Average overdraw', 'Texture bandwidth']) {
      expect(table, `the C1 budget does not bound ${quantity}`).toContain(quantity);
    }
    expect(table).toMatch(/756 x 1638/);
    expect(section).toMatch(flowed('We are not claiming this has been measured'));
  });

  it('keeps the 12 fps step honest at 30 Hz instead of assuming 60', () => {
    expect(section).toMatch(flowed('quantised in **time**, not in frames'));
    expect(section).toContain('2–3–2–3 frame pattern');
    expect(designDoc).toContain('on a 2–3–2–3 pattern at 30 Hz');
  });

  it('still admits these are budgets and not measurements', () => {
    expect(section).toMatch(flowed('These are budgets, not measurements'));
    expect(designDoc).toContain('95th-percentile frame');
  });
});

/**
 * The round-2 critic's headline finding: no onboarding specification existed
 * anywhere, against a money rule with two moving variables. These assertions
 * pin the parts of §5.2 that the product cannot ship without.
 */
describe('first-run onboarding is specified, not assumed', () => {
  const section = designDoc.slice(designDoc.indexOf('### 5.2 The first run'), designDoc.indexOf('### S0 — Squad'));

  it('exists at all, and is reachable by every name a reader would search for', () => {
    expect(section.length).toBeGreaterThan(6000);
    for (const term of ['Rehearsal', 'rehearsal', 'practice', 'first-time', 'onboarding']) {
      expect(designDoc, `nothing in the spec mentions "${term}"`).toContain(term);
    }
  });

  it('names the money rule it has to teach, and teaches three facts in order', () => {
    expect(section).toMatch(flowed("claim' = claim x (survivors / runners) x route multiplier"));
    for (const fact of ['one **claim**, split into `n` equal shares', 'is multiplied by the route price', 'Routes differ in **shape**, not in return']) {
      expect(section).toContain(fact);
    }
  });

  it('puts the teaching object in the permanent HUD rather than in a tutorial', () => {
    expect(section).toMatch(flowed('the teaching object *is* the HUD'));
    expect(section).toMatch(flowed('There is no onboarding widget that gets thrown away'));
    expect(section).toContain('never "graduates"');
  });

  it('specifies a free unstaked rehearsal that runs the real model', () => {
    expect(section).toMatch(flowed('at no stake'));
    expect(section).toContain('published seed pair');
    expect(section).toMatch(flowed('no RGS round, no round id, no ledger entry, no balance movement, no practice currency'));
    expect(section).toMatch(flowed('no separate tutorial state machine'));
  });

  it('refuses to open with a win, which is the manipulation this category defaults to', () => {
    expect(section).toMatch(flowed('The rehearsal does not pay, and it is chosen to hurt'));
    expect(section).toMatch(flowed('We will not build a first experience that pays'));
    expect(section).toMatch(flowed('Both endings are taught, and neither is a win'));
  });

  it('demonstrates the thesis with a comparison instead of asserting it', () => {
    expect(section).toContain('The Two-Card Moment');
    expect(section).toContain('They are not the same bet');
    expect(section).toContain('demonstrated');
    // And the comparison survives onboarding as a permanent control.
    expect(section).toMatch(flowed('for the life of the product'));
    expect(designDoc).toContain('permanent form of the Two-Card Moment');
  });

  it('gates the decision surface progressively, with rules that stop it being manipulation', () => {
    expect(section).toMatch(flowed('Progressive disclosure of the decision surface'));
    for (const rule of [
      '**Additive only.**',
      '**One tap out.**',
      '**Never gated on money.**',
      '**Odds are never gated.**',
      '**Side bets are opt-in once, explicitly.**',
      '**No progress theatre.**',
    ]) {
      expect(section, `disclosure rule missing: ${rule}`).toContain(rule);
    }
    expect(section).toMatch(flowed('The counter is *rounds seen*'));
  });

  it('ships an implementable copy sheet rather than a paraphrase', () => {
    const sheet = section.slice(section.indexOf('#### 5.2.6'), section.indexOf('#### 5.2.7'));
    const strings = extractInClientCopy(sheet);
    expect(strings.length).toBeGreaterThanOrEqual(12);
    expect(strings).toContain('Show me everything.');
    expect(strings).toContain('REHEARSAL — public seed, no stake, no payout.');
  });

  it('forbids the first-run dark patterns by name', () => {
    for (const forbidden of [
      'Never a scripted win',
      'Never a near-miss authored for the tutorial',
      'Never a first-round bonus',
      'Never a suggestion that practice improves outcomes',
      'Never a forced tutorial',
    ]) {
      expect(section, `missing prohibition: ${forbidden}`).toContain(forbidden);
    }
  });

  it('makes comprehension a measurable release gate, not a hope', () => {
    expect(section).toMatch(flowed('How we will know it worked'));
    for (const question of ['Q1', 'Q2', 'Q3', 'Q4']) {
      expect(section, `${question} is missing from the harness`).toMatch(
        new RegExp(`\\| ${question} \\|`),
      );
    }
    expect(section).toMatch(flowed('Q2 and Q4 are both release gates'));
    expect(section).toContain('cash-out ladder');
    expect(designDoc).toContain('**Comprehension harness:**');
    expect(designDoc).toContain('Q2 and Q4 are release gates');
  });

  /**
   * The route card specified four fields and none of them was the break-even
   * survivor count — the only number that says which way the claim moves. It is
   * different on every card, and on WIDE the claim falls, non-zero, almost as
   * often as it grows.
   */
  it('puts the break-even survivor count on the card, not in a tooltip', () => {
    const card = designDoc.slice(designDoc.indexOf('### 3.2 The route card'), designDoc.indexOf('### 3.3'));
    expect(card).toContain('Your claim grows if');
    expect(card).toContain('Chance of that');
    expect(card).toMatch(flowed('Both fields are on the card face'));
    expect(card).toMatch(flowed('The distribution bars mark the break-even'));
    expect(card).toMatch(flowed('"All five make it" is never reused for it'));
    // The card's own filled example must carry the two new fields as figures.
    for (const name of ['narrowBreakEven5', 'narrowRises5', 'wideRises5', 'wideFallsNonZero5']) {
      expect(card, `the card should bind ${name}`).toContain(`fig:${name}`);
    }
    expect(IN_CLIENT_COPY).toContain('Your claim grows if [n] get back.');
  });
});

/**
 * Two model facts that were correct in MATH.md and invisible in the UI spec:
 * a purchased ticket always runs at least one runner through arena 1, and the
 * side-bet limits collapse to one legal ticket at the minimum stake.
 */
describe('model constraints are surfaced where the screen is specified', () => {
  const mathDoc = read('docs/MATH.md');

  it('says a bought run cannot avoid arena 1, in the loop and at the buy screen', () => {
    expect(designDoc).toContain('**Buying a run commits you to arena 1.**');
    expect(designDoc).toMatch(flowed('none of them is an exit'));
    expect(IN_CLIENT_COPY).toContain(
      'Every route on the next screen sends at least one Kindling across. Banking starts after the first branch.',
    );
    expect(mathDoc).toContain('There is no `SHELTER(n)`, and BANK is unavailable before arena 1 resolves');
  });

  /**
   * The v2 draft asserted "none of them is an exit" and then, eight lines later,
   * granted exactly one: a 24 h expiry that "auto-resolves as BANK". That made
   * the S1 string false, put a BANK in a state the model has no BANK in, and
   * created a deterministic zero-variance line in a game whose lowest published
   * standard deviation is 0.30.
   */
  it('closes an abandoned round without inventing an action the model lacks', () => {
    const section = designDoc.slice(
      designDoc.indexOf('### 2.1 Round persistence'),
      designDoc.indexOf('## 3. Player decisions'),
    );
    expect(section).toMatch(flowed('expiry may never invent an action the model does not have'));
    expect(section).toMatch(/\*\*auto-BANK\*\*.*the BANK the player could have taken/);
    expect(section).toMatch(/\*\*VOID\*\*: the wager is cancelled and the stake refunded in full/);
    expect(section).toMatch(flowed('Never a forced run, in either row'));
    // A void is a wager that did not happen, not a 1.00x round.
    expect(section).toMatch(flowed('contributes **no turnover**'));
    expect(section).toMatch(flowed('the void rate is published'));
    // And the old rule may not survive as a live statement anywhere.
    expect(designDoc).not.toMatch(flowed('it auto-resolves as **BANK**'));
  });

  it('lets the retracted buy-screen string survive only as a record of the change', () => {
    for (const match of designDoc.matchAll(/There is no way back out of the first branch/g)) {
      const before = designDoc.slice(Math.max(0, match.index - 200), match.index).replace(/\s+/g, ' ');
      expect(before, 'the retracted S1 string is presented as live copy').toMatch(/It used to read/);
    }
  });

  it('requires the shelter picker to reject an all-squad selection at input time', () => {
    expect(designDoc).toContain('**At least one runner must keep running.**');
    expect(designDoc).toMatch(flowed('the picker must refuse it rather than accept it and fail on commit'));
    expect(IN_CLIENT_COPY).toContain('One has to run. You can bank the rest after this branch.');
    expect(mathDoc).toMatch(flowed('reject an all-`n` selection at input time rather than at commit time'));
  });

  it('qualifies the zero-bust claim as post-commit rather than at the point of choosing', () => {
    const row = designDoc.slice(designDoc.indexOf('| **SHELTER**'), designDoc.indexOf('\n', designDoc.indexOf('| **SHELTER**')));
    expect(row).toContain('Once that credit is made');
    expect(row).toContain('not before');
    expect(row).toContain('1 <= k <= n-1');
  });

  it('states where the side-bet stake limits degenerate, on both the product and math sides', () => {
    expect(designDoc).toMatch(flowed('Where these limits degenerate'));
    expect(designDoc).toMatch(flowed('exactly one ticket, at exactly 1.00, in exactly one arena'));
    // At the minimum route stake the control does not exist at all, which is a
    // product consequence of halving the allowance and is stated, not implied.
    expect(designDoc).toMatch(flowed('a minimum-stake player never sees the side-bet'));
    expect(designDoc).toMatch(flowed('ceiling, not an entitlement'));
    expect(mathDoc).toMatch(flowed('Stake legality, and where the limits degenerate'));
    expect(mathDoc).toMatch(flowed('The ceiling is a bound, not an entitlement'));
  });

  it('labels the enumerated portfolios as illustrative and gives their stake floors', () => {
    const note = mathDoc.slice(mathDoc.indexOf('These plans are illustrative'), mathDoc.indexOf('<!-- table:portfolios -->'));
    expect(note).toContain('at least 10.00 credits');
    expect(note).toContain('at least 6.00');
    expect(note).toMatch(flowed('half a route stake since'));
    expect(note).toMatch(flowed('arbitrary non-negative stake vectors'));
  });
});
