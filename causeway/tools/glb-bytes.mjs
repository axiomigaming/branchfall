// Byte breakdown of .glb files: images vs geometry/animation, raw and gzip'd.
// Usage: node tools/glb-bytes.mjs public/assets/*.glb
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const kb = (n) => `${(n / 1024).toFixed(0)} KB`.padStart(9);
console.log('file'.padEnd(34), 'total'.padStart(9), 'images'.padStart(9), 'geo+anim'.padStart(9), 'json'.padStart(9), 'gzip'.padStart(9));
for (const f of process.argv.slice(2)) {
  const buf = readFileSync(f);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
  const imgViews = new Set((json.images ?? []).map((i) => i.bufferView));
  let img = 0;
  for (const [i, bv] of (json.bufferViews ?? []).entries()) if (imgViews.has(i)) img += bv.byteLength;
  const jsonLen = buf.readUInt32LE(12);
  console.log(f.padEnd(34), kb(buf.length), kb(img), kb(buf.length - img - jsonLen), kb(buf.readUInt32LE(12)), kb(gzipSync(buf, { level: 6 }).length));
}
