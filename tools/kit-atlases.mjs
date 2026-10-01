// Extract the baked atlases from a kit.glb into PNGs, for build_kit.py's KIT_REUSE (re-export a kit
// without re-baking the groups whose pieces and materials did not change).
//   node tools/kit-atlases.mjs public/assets/kit.glb blender/cache/reuse
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

const [src, dir] = process.argv.slice(2);
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(src);
mkdirSync(dir, { recursive: true });
for (const t of doc.getRoot().listTextures()) {
  const name = t.getName();
  if (!/_(color|normal|orm)$/.test(name)) continue;
  await sharp(Buffer.from(t.getImage())).png().toFile(join(dir, `${name}.png`));
  console.log(name);
}
