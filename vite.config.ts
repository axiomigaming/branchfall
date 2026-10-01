import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Asset delivery (see tools/optimize-assets.mjs):
 * - the raw Blender exports in public/assets are pipeline inputs, not shipped;
 * - everything the game fetches is content-addressed (hashed JS/CSS names, `?v=<hash>` on assets),
 *   so /assets/* is served as immutable. index.html stays revalidated.
 */
const SOURCES = ['kit.glb', 'runner.glb', 'env.hdr', 'manifest.json'];
function delivery(): Plugin {
  let outDir = 'dist';
  const cache = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const u = req.url ?? '';
    if (/\/assets\//.test(u) && (/[?&]v=/.test(u) || /-[\w-]{8,}\.(js|css|woff2?)$/.test(u))) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else if (u === '/' || u.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    next();
  };
  /** Optimized assets built from an older export than the one in public/assets? */
  const stale = (root: string): string[] => {
    const dir = join(root, 'public', 'assets');
    const manifestPath = join(dir, 'manifest.json');
    if (!existsSync(manifestPath)) return ['manifest.json is missing'];
    const m = JSON.parse(readFileSync(manifestPath, 'utf8')) as { sets: Record<string, Record<string, { src: string }>> };
    const out: string[] = [];
    for (const [set, files] of Object.entries(m.sets))
      for (const [name, e] of Object.entries(files)) {
        const src = join(dir, `${name}.glb`);
        if (!existsSync(src)) continue;
        const h = createHash('sha256').update(Buffer.concat([readFileSync(src), Buffer.from(set)])).digest('hex').slice(0, 10);
        if (h !== e.src) out.push(`${name}.${set}.glb is older than ${name}.glb`);
      }
    return out;
  };
  return {
    name: 'causeway-delivery',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
      const s = stale(c.root);
      if (!s.length) return;
      const msg = `[assets] ${s.join('; ')}. Run \`npm run assets:optimize\`.`;
      if (c.command === 'build') throw new Error(msg);
      c.logger.warn(msg);
    },
    closeBundle() {
      for (const f of SOURCES) rmSync(join(outDir, 'assets', f), { force: true });
    },
    configurePreviewServer(server) {
      server.middlewares.use(cache);
    },
  };
}

export default defineConfig({
  plugins: [react(), delivery()],
  base: './',
  server: { port: 5180, host: true },
  preview: { port: 5181, host: true },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three') || id.includes('node_modules/postprocessing')) return 'three';
          if (id.includes('node_modules/react')) return 'react';
          return undefined;
        },
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
