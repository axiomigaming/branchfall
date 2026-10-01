import * as THREE from 'three';
import { WATER_Y } from './water';

/**
 * Stone by the water (world art, round 5). Two cheap terms patched into the kit's stone, rock and
 * wood materials:
 *  - caustics: sunlight thrown back off the rippling water dances in bright, wandering lines over
 *    the stone in a band just above the surface, strongest on faces turned to the water;
 *  - wet stone: a darker, glossier band at the waterline, and around the foot of each waterfall
 *    (the nearest few, fed from the track every frame) everything within the spray is wet and shines.
 * Both are functions of world position only: no extra passes, no textures.
 */
export const MAX_FEET = 6;

export const causticUniforms = {
  uCausticTime: { value: 0 },
  uCausticStrength: { value: 1 },
  /** xyz: foot of a waterfall (world), w: reach of its spray (m). w = 0: unused. */
  uFeet: { value: Array.from({ length: MAX_FEET }, () => new THREE.Vector4(0, -1e4, 0, 0)) },
};

const VERT_PARS = /* glsl */ `
varying vec3 vWetPos;
varying vec3 vWetN;`;

const VERT = /* glsl */ `
{
  vec4 wetP = vec4(transformed, 1.0);
  vec3 wetN = objectNormal;
  #ifdef USE_INSTANCING
    wetP = instanceMatrix * wetP;
    wetN = mat3(instanceMatrix) * wetN;
  #endif
  vWetPos = (modelMatrix * wetP).xyz;
  vWetN = normalize(mat3(modelMatrix) * wetN);
}`;

const FRAG_PARS = /* glsl */ `
varying vec3 vWetPos;
varying vec3 vWetN;
uniform float uCausticTime;
uniform float uCausticStrength;
uniform vec4 uFeet[${MAX_FEET}];
// Iterated turbulence (after joltz0r's water shader): bright filaments that wander and merge.
float causticAt(vec2 w, float t) {
  vec2 p = mod(w, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  for (int n = 0; n < 3; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / 0.005), p.y / (cos(i.y + tt) / 0.005)));
  }
  c /= 3.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}
float wetAt(vec3 p) {
  float h = p.y - (${WATER_Y.toFixed(3)});
  float wet = smoothstep(0.5, 0.04, h) * step(-1.5, h);
  for (int k = 0; k < ${MAX_FEET}; k++) {
    vec4 f = uFeet[k];
    if (f.w <= 0.0) continue;
    float d = distance(p.xz, f.xz);
    wet = max(wet, smoothstep(f.w, f.w * 0.35, d) * smoothstep(6.0, 0.5, p.y - f.y));
  }
  return wet;
}`;

const FRAG_WET = /* glsl */ `
#ifdef WET_MOSS
{
  // Pale, grey texels on faces turned to the sky (dust, bleached lichen in the bake) read as snow
  // under the low sun: on rock and cliff they become moss.
  float ml = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  float msat = max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b) - min(min(diffuseColor.r, diffuseColor.g), diffuseColor.b);
  float msr = msat / max(max(max(diffuseColor.r, diffuseColor.g), diffuseColor.b), 1e-3);
  float mk = smoothstep(0.55, 0.85, vWetN.y) * smoothstep(0.18, 0.32, ml) * (1.0 - smoothstep(0.3, 0.5, msr));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.09, 0.14, 0.035) * (0.8 + ml), mk);
}
#endif
float wetK = wetAt(vWetPos);
diffuseColor.rgb *= mix(1.0, 0.66, wetK);
// Wet faces shine; flat ones less (a mirror-flat wet slab would just show the sky's blue).
roughnessFactor = mix(roughnessFactor, mix(0.22, 0.45, abs(vWetN.y)), wetK);`;

const FRAG_CAUSTIC = /* glsl */ `
{
  float ch = vWetPos.y - (${WATER_Y.toFixed(3)});
  float band = smoothstep(2.8, 0.25, ch) * smoothstep(-0.25, 0.08, ch);
  float facing = 0.3 + 0.7 * (1.0 - abs(vWetN.y));
  float k = band * facing * uCausticStrength;
  if (k > 0.01) {
    vec2 cw = vWetPos.xz * 0.55 + vec2(vWetPos.y * 0.45, -vWetPos.y * 0.3);
    float cs = causticAt(cw, uCausticTime * 0.55) + 0.6 * causticAt(cw * 1.7 + 2.1, uCausticTime * 0.7);
    totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.93, 0.78) * min(cs, 2.5) * k * 1.6;
  }
}`;

/** Patch a standard material (once). Chains any existing onBeforeCompile. */
export function patchWetStone(m: THREE.Material, caustics = true, moss = false): void {
  const sm = m as THREE.MeshStandardMaterial;
  if (!sm.isMeshStandardMaterial || sm.userData.wetStone) return;
  sm.userData.wetStone = true;
  const prev = sm.onBeforeCompile;
  const prevKey = sm.customProgramCacheKey?.bind(sm);
  sm.onBeforeCompile = (shader, renderer) => {
    prev?.call(sm, shader, renderer);
    Object.assign(shader.uniforms, causticUniforms);
    if (moss) shader.fragmentShader = '#define WET_MOSS\n' + shader.fragmentShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${FRAG_WET}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${caustics ? FRAG_CAUSTIC : ''}`);
  };
  sm.customProgramCacheKey = () => `${prevKey?.() ?? ''}|wet${caustics ? 'c' : ''}${moss ? 'm' : ''}`;
  sm.needsUpdate = true;
}

if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__caustics = causticUniforms;

const foot = new THREE.Vector4();
/** Feed the nearest falls' feet (in order of preference) and the clock. */
export function updateCaustics(time: number, feet: Iterable<THREE.Vector4>): void {
  causticUniforms.uCausticTime.value = time;
  const arr = causticUniforms.uFeet.value;
  let k = 0;
  for (const f of feet) {
    if (k >= MAX_FEET) break;
    arr[k++]!.copy(f);
  }
  for (; k < MAX_FEET; k++) arr[k]!.copy(foot.set(0, -1e4, 0, 0));
}
