// Print per-mesh vertex/triangle counts and embedded image sizes for a .glb.
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString());
let total = 0;
const rows = [];
for (const m of gltf.meshes ?? []) {
  let v = 0, t = 0;
  for (const p of m.primitives) {
    v += gltf.accessors[p.attributes.POSITION].count;
    t += p.indices !== undefined ? gltf.accessors[p.indices].count / 3 : 0;
  }
  total += t;
  rows.push([m.name, v, t]);
}
rows.sort((a, b) => b[2] - a[2]);
for (const [n, v, t] of rows) console.log(n.padEnd(20), String(v).padStart(8), String(t).padStart(8));
console.log('total tris', total);
for (const im of gltf.images ?? []) console.log('image', im.name, im.mimeType, gltf.bufferViews[im.bufferView].byteLength >> 10, 'KB');
console.log('animations', (gltf.animations ?? []).map((a) => a.name).join(', '));
