/**
 * The client build: one esbuild call, no config file, no framework.
 *
 * `DESIGN.md` §6.8 budgets a real client at ~380 KB of our own code against a
 * 5 MB first-load ceiling. This is the graybox, so there is no renderer, no asset
 * set and no three.js — the bundle is the UI, the flows and the money formatting,
 * and it is a few tens of kilobytes. The budget table in the design document is
 * for the build that has art in it, and nothing here is evidence about it.
 */
import { context, build } from 'esbuild';
import { watch as watchTree } from 'node:fs';
import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outdir = resolve(root, 'client/dist');

const options = {
  entryPoints: [resolve(root, 'client/src/main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2022'],
  outfile: resolve(outdir, 'app.js'),
  sourcemap: 'inline',
  logLevel: 'warning',
};

async function copyStatic() {
  await mkdir(outdir, { recursive: true });
  await cp(resolve(root, 'client/public'), outdir, { recursive: true });
}

export async function bundleClient({ watch = false } = {}) {
  await copyStatic();
  if (!watch) {
    await build(options);
    return null;
  }
  const ctx = await context(options);
  await ctx.rebuild();
  await ctx.watch();
  /**
   * esbuild watches the module graph, which does not include the stylesheet or
   * the shell. Without this, editing `client/public/styles.css` under
   * `npm run dev` changes nothing until the server is restarted — which is a
   * quiet way to spend an afternoon measuring a layout that is not the one on
   * disk. Copies are cheap and debounced.
   */
  let pending = null;
  watchTree(resolve(root, 'client/public'), { recursive: true }, () => {
    clearTimeout(pending);
    pending = setTimeout(() => void copyStatic(), 60);
  });
  return ctx;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await bundleClient({ watch: process.argv.includes('--watch') });
  if (!process.argv.includes('--watch')) console.log('client bundled to client/dist/app.js');
}
