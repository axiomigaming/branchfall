/**
 * Tracked source stays reviewable as text.
 *
 * A raw NUL or unit-separator byte inside a regular expression is legal to the
 * JavaScript parser but makes ordinary diff and grep tools classify the whole
 * money-path file as binary. Source may contain the ordinary whitespace controls
 * tab, LF and CR; every other C0 control and DEL must be written as an escape.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('tracked source text', () => {
  it('contains no literal control bytes outside ordinary whitespace', () => {
    const files = execFileSync(
      'git',
      ['ls-files', '-z', '--', 'server', 'tests', 'tools', 'client'],
      { cwd: root },
    )
      .toString('utf8')
      .split('\x00')
      .filter(Boolean);
    const offenders = [];

    for (const file of files) {
      const bytes = readFileSync(resolve(root, file));
      for (let offset = 0; offset < bytes.length; offset += 1) {
        const byte = bytes[offset];
        if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) || byte === 0x7f)
          offenders.push(`${file}:${offset}:0x${byte.toString(16).padStart(2, '0')}`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
