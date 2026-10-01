// Radiance .hdr (RGBE) read / 2x box downsample / RLE write, for the environment map.
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

/** Decode to linear float RGBA. */
export function readHdr(buf) {
  const loader = new HDRLoader().setDataType(THREE.FloatType);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { width, height, data } = loader.parse(ab);
  return { width, height, data };
}

/** Halve both dimensions with a 2x2 box filter (RGBA float in, RGBA float out). */
export function halve({ width, height, data }) {
  const w = width >> 1;
  const h = height >> 1;
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 4; c++) {
        const at = (yy, xx) => data[(yy * width + xx) * 4 + c];
        out[(y * w + x) * 4 + c] = (at(2 * y, 2 * x) + at(2 * y, 2 * x + 1) + at(2 * y + 1, 2 * x) + at(2 * y + 1, 2 * x + 1)) / 4;
      }
  return { width: w, height: h, data: out };
}

function rgbe(r, g, b, out, o) {
  const m = Math.max(r, g, b);
  if (m < 1e-32) {
    out[o] = out[o + 1] = out[o + 2] = out[o + 3] = 0;
    return;
  }
  const e = Math.ceil(Math.log2(m));
  // Guard against rounding up to 256 in the mantissa.
  let f = 256 / 2 ** e;
  let ee = e;
  if (m * f >= 256) {
    f /= 2;
    ee++;
  }
  out[o] = Math.min(255, Math.floor(r * f));
  out[o + 1] = Math.min(255, Math.floor(g * f));
  out[o + 2] = Math.min(255, Math.floor(b * f));
  out[o + 3] = ee + 128;
}

/** Encode as new-style run-length RGBE (what three's HDRLoader expects). */
export function writeHdr({ width, height, data }) {
  const header = Buffer.from(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${height} +X ${width}\n`, 'ascii');
  const chunks = [header];
  const line = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      rgbe(data[i], data[i + 1], data[i + 2], line, x * 4);
    }
    const out = [2, 2, (width >> 8) & 0xff, width & 0xff];
    for (let c = 0; c < 4; c++) {
      const ch = new Uint8Array(width);
      for (let x = 0; x < width; x++) ch[x] = line[x * 4 + c];
      let x = 0;
      while (x < width) {
        // A run of ≥3 identical bytes is worth encoding as a run.
        let run = 1;
        while (x + run < width && run < 127 && ch[x + run] === ch[x]) run++;
        if (run >= 3) {
          out.push(128 + run, ch[x]);
          x += run;
          continue;
        }
        // Literal span until the next run of 3 (max 128).
        const start = x;
        while (x < width && x - start < 128) {
          if (x + 2 < width && ch[x] === ch[x + 1] && ch[x] === ch[x + 2]) break;
          x++;
        }
        out.push(x - start);
        for (let k = start; k < x; k++) out.push(ch[k]);
      }
    }
    chunks.push(Buffer.from(out));
  }
  return Buffer.concat(chunks);
}
