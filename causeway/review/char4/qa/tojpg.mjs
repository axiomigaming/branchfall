// Convert every PNG under review/char4 to JPEG (q 82) and remove the PNG.
import sharp from 'sharp';
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
for (const f of walk(process.argv[2] ?? 'review/char4').filter((f) => f.endsWith('.png'))) {
  await sharp(f).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toFile(f.replace(/\.png$/, '.jpg'));
  unlinkSync(f);
}
