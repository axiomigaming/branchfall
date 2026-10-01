// Asset delivery pipeline: Blender exports → compressed, versioned files the game actually downloads.
//
//   npm run assets:optimize            (re-run after any re-export of kit.glb / runner.glb)
//
// Inputs (what Blender writes; never shipped — vite.config.ts strips them from dist):
//   public/assets/kit.glb, public/assets/runner.glb, backdrop.webp, env.hdr, backdrop.json
// Outputs:
//   public/assets/{kit,runner}.{high,mobile}.glb   meshopt geometry (EXT_meshopt_compression + KHR_mesh_quantization),
//                                                   WebP textures resized per set
//   public/assets/manifest.json                     per set: file, bytes, content hash (→ ?v= cache busting)
//
// Sets: "high" caps textures at 2048 px (4K atlases in the source were ~85 MB of VRAM each);
// "mobile" caps at 1024 (512 for the small wood/bark/flora atlases) for phones, the Low tier and Save-Data.
// The runner's own maps are exempt (RUNNER below): full resolution on both sets.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, meshopt, prune, resample, simplifyPrimitive, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { halve, readHdr, writeHdr } from './hdr.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'public', 'assets');

/** Max texture edge per set, by texture name. */
const SETS = {
  // Roughness (ORM) carries low-frequency detail: half the colour resolution is indistinguishable.
  high: { simplify: null, cap: (name) => (/_(orm|normal)$/.test(name) ? 1024 : 2048), quality: { color: 76, normal: 62, orm: 60 } },
  // Phones also get lighter geometry: at most 0.2 % of a piece's radius of deviation (≈1 cm on a 5 m wall).
  mobile: { simplify: { ratio: 0.5, error: 0.002 }, cap: (name) => (/^(wood|bark|flora)_/.test(name) || /_(orm|normal)$/.test(name) ? 512 : 1024), quality: { color: 72, normal: 62, orm: 60 } },
};
/**
 * The runner is the one thing always in the middle of the frame, a metre or two from the lens: its
 * atlas (one 1024² sheet for the whole body, face included) ships at full resolution on every set,
 * normal map too, at a higher quality — about 1 MB, worth it.
 */
const RUNNER = { cap: () => 2048, quality: { color: 90, normal: 88, orm: 80 } };
const SOURCES = ['kit', 'runner'];
const SHARED = ['backdrop.webp', 'env.hdr', 'backdrop.json'];

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const hash = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 10);
const kb = (n) => `${(n / 1024).toFixed(0)} KB`.padStart(9);

/**
 * ORM atlases whose material has no occlusionTexture: three reads roughness from G and metalness
 * from B (the loader forces metalness to 0, so B is multiplied away) and never samples R. Writing G
 * into all three channels makes the image grey, which WebP stores as luma only — about half the bytes.
 * If a material starts using occlusion, its atlas is left untouched.
 */
function roughnessOnly(doc) {
  const keep = new Set();
  const grey = new Set();
  for (const m of doc.getRoot().listMaterials()) {
    const orm = m.getMetallicRoughnessTexture();
    if (!orm) continue;
    if (m.getOcclusionTexture() === orm || m.getOcclusionTexture()) keep.add(orm);
    else grey.add(orm);
  }
  for (const t of keep) grey.delete(t);
  return grey;
}

async function textures(doc, set, name) {
  const cfg = name === 'runner' ? { ...SETS[set], ...RUNNER } : SETS[set];
  const grey = roughnessOnly(doc);
  for (const tex of doc.getRoot().listTextures()) {
    const name = tex.getName() || tex.getURI();
    const src = Buffer.from(tex.getImage());
    const meta = await sharp(src).metadata();
    const size = Math.min(cfg.cap(name), meta.width);
    const kind = /normal/i.test(name) ? 'normal' : grey.has(tex) ? 'orm' : 'color';
    let pipe = sharp(src);
    if (size < meta.width) pipe = pipe.resize(size, Math.round((meta.height * size) / meta.width), { kernel: 'lanczos3' });
    if (kind === 'orm') {
      const { data, info } = await pipe.removeAlpha().raw().toBuffer({ resolveWithObject: true });
      for (let i = 0; i < data.length; i += info.channels) data[i] = data[i + 2] = data[i + 1];
      pipe = sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
    }
    const out = await pipe.webp({ quality: cfg.quality[kind], alphaQuality: 90, effort: 6, smartSubsample: kind === 'color' }).toBuffer();
    if (size < meta.width || kind === 'orm' || out.byteLength < src.byteLength) tex.setImage(new Uint8Array(out)).setMimeType('image/webp');
  }
}

/**
 * Drop animation channels that hold a bone at its rest value in EVERY clip (bone scales, most bone
 * translations). A channel is only dropped when static everywhere: otherwise a crossfade into a clip
 * without the track would leave the bone wherever the previous clip put it. The runner's JSON chunk is
 * mostly these accessor/sampler definitions, and JSON is not meshopt-compressed.
 */
function dropStaticChannels() {
  return (doc) => {
    const anims = doc.getRoot().listAnimations();
    if (!anims.length) return;
    const rest = (node, path) => (path === 'translation' ? node.getTranslation() : path === 'rotation' ? node.getRotation() : path === 'scale' ? node.getScale() : null);
    const moving = new Set();
    for (const a of anims)
      for (const ch of a.listChannels()) {
        const node = ch.getTargetNode();
        const path = ch.getTargetPath();
        const r = node && rest(node, path);
        const key = node ? `${node.getName()}|${path}` : '';
        if (!r) {
          moving.add(key);
          continue;
        }
        const out = ch.getSampler().getOutput();
        const el = [];
        for (let i = 0; i < out.getCount(); i++) {
          out.getElement(i, el);
          if (el.some((v, k) => Math.abs(v - r[k]) > (path === 'rotation' ? 1e-5 : 1e-5 * Math.max(1, Math.abs(r[k]))))) {
            // q and −q are the same rotation.
            if (path === 'rotation' && el.every((v, k) => Math.abs(v + r[k]) <= 1e-5)) continue;
            moving.add(key);
            break;
          }
        }
      }
    let dropped = 0;
    for (const a of anims)
      for (const ch of a.listChannels()) {
        const node = ch.getTargetNode();
        if (!node || moving.has(`${node.getName()}|${ch.getTargetPath()}`)) continue;
        const sm = ch.getSampler();
        ch.dispose();
        if (!sm.listParents().some((p) => p.propertyType === 'AnimationChannel')) sm.dispose();
        dropped++;
      }
    console.log(`  dropped ${dropped} static animation channels`);
  };
}

/** Simplify solid kit pieces (never leaf cards, never skinned meshes). */
function simplifySolids(opts) {
  return (doc) => {
    if (!opts || doc.getRoot().listSkins().length) return;
    let before = 0;
    let after = 0;
    for (const mesh of doc.getRoot().listMeshes())
      for (const prim of mesh.listPrimitives()) {
        if (/leaf/i.test(prim.getMaterial()?.getName() ?? '') || !prim.getIndices()) continue;
        before += prim.getIndices().getCount() / 3;
        simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, lockBorder: false, ...opts });
        after += prim.getIndices().getCount() / 3;
      }
    console.log(`  simplified solids: ${before} → ${after} triangles`);
  };
}

async function optimize(name, set) {
  const doc = await io.read(join(DIR, `${name}.glb`));
  const skinned = doc.getRoot().listSkins().length > 0;
  await doc.transform(
    dedup(),
    prune(),
    // Kit pieces are re-normalised at load (foliage normals are rebuilt), so a slightly looser weld is fine.
    weld(),
    simplifySolids(SETS[set].simplify),
    ...(doc.getRoot().listAnimations().length ? [resample(), dropStaticChannels(), prune()] : []),
    // reorder for locality + quantize (KHR_mesh_quantization) + EXT_meshopt_compression with filters.
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );
  await textures(doc, set, name);
  const buf = Buffer.from(await io.writeBinary(doc));
  const file = `${name}.${set}.glb`;
  writeFileSync(join(DIR, file), buf);
  void skinned;
  return { file, bytes: buf.byteLength, v: hash(buf) };
}

// Outputs are rebuilt when their source or this script changes (the key hashes both).
const PIPELINE = hash(readFileSync(fileURLToPath(import.meta.url)));
const MANIFEST = join(DIR, 'manifest.json');
const prev = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
const force = process.argv.includes('--force');
const manifest = { generated: 'npm run assets:optimize (tools/optimize-assets.mjs)', pipeline: PIPELINE, sets: {}, shared: {} };
for (const f of SHARED) {
  const buf = readFileSync(join(DIR, f));
  manifest.shared[f.split('.')[0] + (f.endsWith('.json') ? 'Meta' : '')] = { file: f, bytes: buf.byteLength, v: hash(buf) };
}
// The environment only lights rough, non-metal surfaces through PMREM (reflections of the far world
// come from the backdrop), so a 512×256 map is indistinguishable from 1024×512 at a quarter of the bytes.
{
  const src = readFileSync(join(DIR, 'env.hdr'));
  const out = writeHdr(halve(readHdr(src)));
  writeFileSync(join(DIR, 'env.half.hdr'), out);
  manifest.shared.env = { file: 'env.half.hdr', bytes: out.byteLength, v: hash(out) };
  console.log('env.half.hdr'.padEnd(22), kb(src.byteLength), kb(out.byteLength));
}
console.log('asset'.padEnd(22), 'source'.padStart(9), 'output'.padStart(9));
for (const set of Object.keys(SETS)) {
  manifest.sets[set] = {};
  for (const name of SOURCES) {
    const srcPath = join(DIR, `${name}.glb`);
    if (!existsSync(srcPath)) throw new Error(`missing ${srcPath}: export it from Blender first`);
    const src = hash(Buffer.concat([readFileSync(srcPath), Buffer.from(set)]));
    const old = prev?.pipeline === PIPELINE ? prev.sets?.[set]?.[name] : null;
    const outPath = old ? join(DIR, old.file) : '';
    let r;
    if (!force && old?.src === src && existsSync(outPath) && hash(readFileSync(outPath)) === old.v) {
      r = old;
      console.log(r.file.padEnd(22), kb(statSync(srcPath).size), kb(r.bytes), ' (unchanged, skipped)');
    } else {
      r = { ...(await optimize(name, set)), src };
      console.log(r.file.padEnd(22), kb(statSync(srcPath).size), kb(r.bytes));
    }
    manifest.sets[set][name] = r;
  }
}
const shared = Object.values(manifest.shared).reduce((a, s) => a + s.bytes, 0);
for (const set of Object.keys(SETS)) {
  const total = shared + Object.values(manifest.sets[set]).reduce((a, s) => a + s.bytes, 0);
  console.log(`first load, ${set} set:`.padEnd(22), kb(total).padStart(19), `(${(total / 1048576).toFixed(2)} MB)`);
}
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
