/**
 * Generated slots in the published docs.
 *
 * Two kinds of slot exist, and between them every load-bearing number in this
 * repository's documentation is machine-generated and CI-bound.
 *
 * TABLE SLOT — an HTML comment marker on its own line, followed by the table
 * body (consecutive lines starting with `|`):
 *
 *     <!-- table:contracts -->
 *     | Contract | ... |
 *     | --- | ... |
 *     | WIDE | ... |
 *
 * FIGURE SLOT — an inline span anywhere in any document:
 *
 *     splitting a five-runner squad wipes <!-- fig:splitWipe5 -->1.30%<!-- /fig -->
 *
 * `tools/sync-docs.mjs` fills both kinds from the enumerator.
 * `tests/paytable.test.mjs` asserts the documents still match the enumeration,
 * so a tuning change that is not re-published fails CI — and, equally, a prose
 * edit that invents a number fails CI. The v1 draft bound only MATH.md's tables,
 * which let DESIGN.md drift into claims the model does not support.
 */

/** @param {string} name */
function markerFor(name) {
  return `<!-- table:${name} -->`;
}

/**
 * @param {string} markdown
 * @param {string} name
 * @returns {{marker:string, start:number, end:number, body:string}|null}
 */
export function locateTable(markdown, name) {
  const lines = markdown.split('\n');
  const marker = markerFor(name);
  const start = lines.findIndex((line) => line.trim() === marker);
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith('|')) end += 1;
  return { marker, start, end, body: lines.slice(start + 1, end).join('\n') };
}

/**
 * @param {string} markdown
 * @param {string} name
 * @returns {string|null} the table body, or null when the slot is absent
 */
export function extractTable(markdown, name) {
  const found = locateTable(markdown, name);
  return found ? found.body : null;
}

/**
 * @param {string} markdown
 * @param {string} name
 * @param {string} table
 * @returns {string}
 */
export function spliceTable(markdown, name, table) {
  const found = locateTable(markdown, name);
  if (!found) throw new Error(`No table slot named "${name}" in the document`);
  const lines = markdown.split('\n');
  lines.splice(found.start, found.end - found.start, found.marker, ...table.split('\n'));
  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * inline figures
 * ------------------------------------------------------------------ */

const FIGURE_PATTERN = /<!-- fig:([A-Za-z0-9_]+) -->([\s\S]*?)<!-- \/fig -->/g;

/**
 * Every figure occurrence in a document, in source order.
 * @param {string} markdown
 * @returns {{name:string, value:string, index:number, length:number}[]}
 */
export function listFigures(markdown) {
  const out = [];
  for (const match of markdown.matchAll(FIGURE_PATTERN)) {
    out.push({ name: match[1], value: match[2], index: match.index, length: match[0].length });
  }
  return out;
}

/**
 * Rewrite every figure occurrence from the supplied map.
 * @param {string} markdown
 * @param {Record<string, string>} figures
 * @returns {{text: string, unknown: string[], stale: string[]}}
 */
export function spliceFigures(markdown, figures) {
  const unknown = [];
  const stale = [];
  const text = markdown.replace(FIGURE_PATTERN, (whole, name, current) => {
    if (!Object.prototype.hasOwnProperty.call(figures, name)) {
      unknown.push(name);
      return whole;
    }
    const next = figures[name];
    if (current !== next) stale.push(name);
    return `<!-- fig:${name} -->${next}<!-- /fig -->`;
  });
  return { text, unknown, stale };
}
