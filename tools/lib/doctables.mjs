/**
 * Markdown table slots in the published docs.
 *
 * A slot is an HTML comment marker on its own line, optionally followed by the
 * table body (consecutive lines starting with `|`):
 *
 *     <!-- table:contracts -->
 *     | Contract | ... |
 *     | --- | ... |
 *     | WIDE | ... |
 *
 * `tools/sync-docs.mjs` fills the slots from the enumerator.
 * `tests/paytable.test.mjs` asserts the doc still matches the enumeration, so
 * a paytable change that is not re-published fails CI.
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
