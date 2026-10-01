import * as THREE from 'three';
import type { Waterfall } from './sections';

/**
 * Waterfalls. Every fall in a section is merged into one mesh (one draw call per section) of three
 * layers, told apart by the `aLayer` attribute:
 *   0  the front sheet: fast white streaks over a glassy green body, fraying at the edges, foaming at
 *      the foot, catching the sun;
 *   1  a back sheet, wider and slower, so the fall has depth (two layers of water sliding over each
 *      other, never one flat card);
 *   2  spray at the foot: crossed billows of mist boiling up and out where the water lands.
 * The sheets bow out as they fall (baked into the positions); the shader only adds the wobble.
 */
export function makeWaterfallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.3, 0.35, -0.88) } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      attribute float aLayer;
      attribute float aSeed;
      attribute vec3 aOut;
      varying vec2 vUv;
      varying float vLayer;
      varying float vSeed;
      varying vec3 vView;
      varying vec3 vWorld;
      uniform float uTime;
      void main() {
        vUv = uv;
        vLayer = aLayer;
        vSeed = aSeed;
        vec3 p = position;
        float t = 1.0 - uv.y;
        if (aLayer < 1.5) p += aOut * sin(uTime * (3.0 - aLayer) + uv.x * 9.0 + aSeed * 6.0) * 0.05 * t;
        else p += aOut * sin(uTime * 1.3 + aSeed * 5.0 + uv.x * 3.0) * 0.12 * uv.y;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        vView = mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec2 vUv;
      varying float vLayer;
      varying float vSeed;
      varying vec3 vView;
      varying vec3 vWorld;
      uniform float uTime;
      uniform vec3 uSun;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      float fbm(vec2 p) { return n(p) * 0.55 + n(p * 2.1 + 1.7) * 0.3 + n(p * 4.3 + 3.1) * 0.15; }
      void main() {
        vec3 viewDir = normalize(-vView);
        // Looking toward the sun the spray lights up (forward scattering).
        vec3 sunV = normalize((viewMatrix * vec4(uSun, 0.0)).xyz);
        float back = pow(max(dot(-viewDir, sunV), 0.0), 3.0);
        vec4 col;
        if (vLayer < 1.5) {
          float slow = vLayer > 0.5 ? 0.55 : 1.0;
          // Water accelerates as it falls: the streaks stretch toward the foot.
          float fall = 1.0 - vUv.y;
          float y = (vUv.y * 5.0 - fall * fall * 2.5) + uTime * 2.6 * slow + vSeed * 13.0;
          float x = vUv.x + vSeed;
          float streak = n(vec2(x * 30.0, y)) * 0.55 + n(vec2(x * 70.0, y * 2.4 + 3.0)) * 0.3 + n(vec2(x * 140.0, y * 4.0)) * 0.15;
          float ropes = smoothstep(0.45, 0.85, n(vec2(x * 9.0, y * 0.35)));
          float edge = smoothstep(0.0, 0.16, vUv.x) * smoothstep(1.0, 0.84, vUv.x);
          // The edges fray into separate ropes of water.
          edge *= mix(1.0, smoothstep(0.25, 0.7, n(vec2(x * 22.0, y * 0.8))), (1.0 - smoothstep(0.0, 0.3, min(vUv.x, 1.0 - vUv.x))) * 0.9);
          float foot = smoothstep(0.22, 0.0, vUv.y);
          float lip = smoothstep(0.9, 1.0, vUv.y);
          float a = edge * (0.32 + 0.5 * streak + 0.25 * ropes) + foot * 0.45;
          a *= mix(1.0, 0.55, vLayer) * (1.0 - lip * 0.5);
          vec3 body = mix(vec3(0.3, 0.5, 0.48), vec3(0.2, 0.36, 0.36), vLayer);
          vec3 white = vec3(0.96, 0.97, 0.93);
          float w = clamp(smoothstep(0.35, 0.95, streak) * 0.8 + ropes * 0.35 + foot * 0.9, 0.0, 1.0);
          vec3 c = mix(body, white, w * mix(1.0, 0.6, vLayer));
          // Sun glints running down the sheet.
          c += vec3(1.0, 0.92, 0.75) * (pow(streak, 6.0) * 1.8 + back * 0.45) * (1.0 - vLayer * 0.6);
          col = vec4(c, clamp(a, 0.0, 0.9));
        } else {
          // Spray: billows rising and spreading, densest low at the centre, gone at the rim.
          vec2 q = vec2((vUv.x - 0.5) * 2.0, vUv.y);
          float r = length(vec2(q.x * 0.9, q.y * 1.1));
          float shape = smoothstep(1.0, 0.15, r);
          float billow = fbm(vec2(q.x * 3.0 + vSeed * 7.0, q.y * 2.5 - uTime * 0.9)) ;
          float b2 = fbm(vec2(q.x * 6.0 - uTime * 0.3, q.y * 5.0 - uTime * 1.6 + vSeed * 3.0));
          float a = shape * smoothstep(0.3, 0.75, billow * 0.7 + b2 * 0.45) * 0.4;
          vec3 c = mix(vec3(0.85, 0.9, 0.9), vec3(1.0, 0.94, 0.82), back);
          c *= 0.92 + back * 0.3;
          col = vec4(c, a);
        }
        gl_FragColor = col;
        #include <fog_fragment>
      }`,
  });
}

const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpO = new THREE.Vector3();

/**
 * All of a section's falls as one geometry, in section space (water level already applied by the
 * caller through `lift`). Each fall's sheet spans x ∈ [−w/2, w/2], y ∈ [0, −h] of its matrix and
 * bows out along its local +Z by `bow` metres at the foot.
 */
export function makeFallsGeometry(falls: Waterfall[], waterLift: number, seed = 0): THREE.BufferGeometry | null {
  if (!falls.length) return null;
  const pos: number[] = [];
  const uv: number[] = [];
  const layer: number[] = [];
  const seeds: number[] = [];
  const out: number[] = [];
  const index: number[] = [];
  let k = 0;
  let lift = 0;
  const quadStrip = (fm: THREE.Matrix4, w: number, h: number, z0: number, bow: number, rows: number, L: number, sd: number) => {
    const base = pos.length / 3;
    tmpO.set(0, 0, 1).transformDirection(fm);
    for (let r = 0; r <= rows; r++) {
      const v = 1 - r / rows; // uv.y: 1 at the lip, 0 at the foot
      const t = r / rows;
      for (let c = 0; c <= 1; c++) {
        tmpV.set((c - 0.5) * w, -t * h, z0 + t * t * bow).applyMatrix4(fm);
        pos.push(tmpV.x, tmpV.y + lift, tmpV.z);
        uv.push(c, v);
        layer.push(L);
        seeds.push(sd);
        out.push(tmpO.x, tmpO.y, tmpO.z);
      }
    }
    for (let r = 0; r < rows; r++) {
      const a = base + r * 2;
      index.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  };
  for (const f of falls) {
    const sd = ((seed * 7.31 + k++ * 3.17) % 1 + 1) % 1;
    const bow = f.bow ?? 1.6;
    lift = f.path ? 0 : waterLift;
    quadStrip(f.m, f.w * 1.18, f.h, -0.25, bow * 0.85, 12, 1, sd + 0.37);
    quadStrip(f.m, f.w, f.h, 0, bow, 16, 0, sd);
    // Spray at the foot: two crossed billows standing where the water lands.
    const sw = Math.min(f.w * 2.0, 9);
    const sh = Math.min(f.h * 0.45, 3.2) + 0.6;
    tmpV.set(0, -f.h, bow).applyMatrix4(f.m);
    const foot = tmpV.clone();
    for (let j = 0; j < 2; j++) {
      const yaw = j * (Math.PI / 2) + 0.4;
      tmpM.makeRotationY(yaw).setPosition(foot.x, foot.y - 0.35, foot.z);
      const base = pos.length / 3;
      tmpO.set(Math.cos(yaw), 0, -Math.sin(yaw));
      for (let r = 0; r <= 1; r++) {
        for (let c = 0; c <= 1; c++) {
          tmpV.set((c - 0.5) * sw, r * sh, 0).applyMatrix4(tmpM);
          pos.push(tmpV.x, tmpV.y + lift, tmpV.z);
          uv.push(c, r);
          layer.push(2);
          seeds.push(sd + j * 0.5);
          out.push(0, 1, 0);
        }
      }
      index.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 1));
  g.setAttribute('aOut', new THREE.Float32BufferAttribute(out, 3));
  g.setIndex(index);
  g.computeBoundingSphere();
  return g;
}

/** World-space feet of the falls (xyz) and their reach (w), for the wet stone around them. */
export function fallFeet(falls: Waterfall[], world: THREE.Matrix4, waterLift: number, out: THREE.Vector4[]): void {
  for (const f of falls) {
    tmpV.set(0, -f.h, f.bow ?? 1.6).applyMatrix4(f.m);
    tmpV.y += f.path ? 0 : waterLift;
    tmpV.applyMatrix4(world);
    out.push(new THREE.Vector4(tmpV.x, tmpV.y, tmpV.z, Math.max(2.5, f.w * 1.2)));
  }
}
