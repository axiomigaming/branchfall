import * as THREE from 'three';
import { WATER_Y } from './water';

/**
 * Aerial perspective for every fogged material: exponential height fog (thick over the
 * water, thinning with altitude, integrated along the view ray so towers rise out of it)
 * and in-scattering toward the sun, so the haze glows gold looking into the light and
 * stays cooler looking away. A second, thin layer hugs the water: mist lying on it that
 * thickens with distance and wreathes the feet of the walls. It replaces three's fog
 * chunks, so it must be installed before any program compiles.
 *
 * The sun direction and the mist are live uniforms shared by every program (plain objects,
 * which three's uniform cloning passes by reference), so the light can turn with the route.
 */
export interface AtmosphereOptions {
  /** Warm haze away from the sun. */
  color: THREE.ColorRepresentation;
  /** Haze looking into the sun. */
  sunColor: THREE.ColorRepresentation;
  density: number;
  /** Per-metre falloff of density with height above the water. */
  falloff: number;
  /** Mist on the water: density at the surface (per metre) and its scale height (metres). */
  mistDensity: number;
  mistHeight: number;
}

export const ATMOSPHERE: AtmosphereOptions = {
  // Cool blue-green haze away from the sun (aerial perspective: depth layers fade toward the sky),
  // warm gold looking into the light.
  color: 0x8db2b9,
  sunColor: 0xf6d6a0,
  density: 0.0022,
  falloff: 0.05,
  mistDensity: 0.012,
  mistHeight: 1.1,
};

/** Shared by reference into every fogged program. Update the fields, never replace the objects. */
export const atmosphereUniforms = {
  fogSunDir: { value: { x: 0.3, y: 0.35, z: -0.88 } },
  /** x: time (s), y: mist density scale (0 = off), z, w: unused. */
  fogMist: { value: { x: 0, y: 1, z: 0, w: 0 } },
};

let installed = false;

/** Give a ShaderMaterial made before installation (or by hand) the shared atmosphere uniforms. */
export function patchFogUniforms(m: THREE.Material): void {
  const sm = m as THREE.ShaderMaterial;
  if (!sm.isShaderMaterial || !sm.fog || !sm.uniforms) return;
  sm.uniforms.fogSunDir ??= { value: atmosphereUniforms.fogSunDir.value };
  sm.uniforms.fogMist ??= { value: atmosphereUniforms.fogMist.value };
}

export function setAtmosphereSun(dir: THREE.Vector3): void {
  const v = atmosphereUniforms.fogSunDir.value;
  v.x = dir.x;
  v.y = dir.y;
  v.z = dir.z;
}

export function setAtmosphereMist(time: number, amount: number): void {
  const v = atmosphereUniforms.fogMist.value;
  v.x = time;
  v.y = amount;
}

export function installAtmosphere(scene: THREE.Scene, sunDir: THREE.Vector3, o: AtmosphereOptions = ATMOSPHERE): void {
  scene.fog = new THREE.FogExp2(o.color, o.density);
  setAtmosphereSun(sunDir.clone().normalize());
  if (installed) return;
  installed = true;
  // Every built-in program and every ShaderMaterial merged from UniformsLib.fog from now on.
  const shared = { fogSunDir: atmosphereUniforms.fogSunDir, fogMist: atmosphereUniforms.fogMist };
  Object.assign(THREE.UniformsLib.fog, shared);
  for (const lib of Object.values(THREE.ShaderLib)) {
    if (lib.uniforms && 'fogColor' in lib.uniforms) Object.assign(lib.uniforms, { fogSunDir: { value: shared.fogSunDir.value }, fogMist: { value: shared.fogMist.value } });
  }
  installSkyGrade();
  const sun = new THREE.Color(o.sunColor);
  const C = THREE.ShaderChunk as Record<string, string>;
  C.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
  varying float vFogDepth;
  varying vec3 vFogView;
#endif`;
  C.fog_vertex = /* glsl */ `
#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  vFogView = mvPosition.xyz;
#endif`;
  C.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 fogSunDir;
  uniform vec4 fogMist;
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  float fogLayer(float b, float dy) {
    float x = b * dy;
    return abs(x) > 1e-3 ? (1.0 - exp(-x)) / x : 1.0;
  }
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    // View-space offset back to world space (the view matrix is a rotation + translation).
    vec3 fogW = (vec4(vFogView, 0.0) * viewMatrix).xyz;
    float fogDist = length(fogW);
    vec3 fogDir = fogW / max(fogDist, 1e-4);
    float fogH0 = max(cameraPosition.y - (${WATER_Y.toFixed(2)}), 0.0);
    float fogDy = fogW.y;
    // Round 8: the first stretch of air in front of the lens is clear (in-scatter close to the
    // camera only greyed the whole frame); the haze builds beyond it, so distance keeps its depth.
    float fogNearClear = smoothstep(14.0, 70.0, fogDist); // round 10: a clear near field (crash results)
    float fogOpt = fogDensity * fogDist * fogNearClear * exp(-${o.falloff.toFixed(4)} * fogH0) * fogLayer(${o.falloff.toFixed(4)}, fogDy);
    float fogFactor = 1.0 - exp(-fogOpt);
    float fogSun = max(dot(fogDir, fogSunDir), 0.0);
    // Warm only close around the sun: a broad warm in-scatter laid a milky veil over every
    // sun-facing frame (round 5).
    vec3 fogCol = mix(fogColor, ${glslVec3(sun)}, pow(fogSun, 18.0) * 0.35);
    // Far away the haze thickens to the sky's own horizon colour.
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogFactor, 0.0, 0.86));
    if (fogMist.y > 0.0) {
      // Mist lying on the water: a thin exponential layer, drifting in slow banks.
      float mb = ${(1 / o.mistHeight).toFixed(4)};
      float mh = max(cameraPosition.y - (${WATER_Y.toFixed(2)}), 0.0);
      float mOpt = ${o.mistDensity.toFixed(4)} * fogMist.y * fogDist * fogNearClear * exp(-mb * mh) * fogLayer(mb, fogDy);
      vec3 fogP = cameraPosition + fogW;
      float bank = 0.55 + 0.45 * sin(fogP.x * 0.07 + fogMist.x * 0.11) * sin(fogP.z * 0.05 - fogMist.x * 0.07 + 1.3);
      float mist = (1.0 - exp(-mOpt * bank)) * 0.5;
      vec3 mistCol = mix(vec3(0.84, 0.89, 0.87), ${glslVec3(sun)} * 1.05, pow(fogSun, 6.0) * 0.5);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, mistCol, mist);
    }
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;
}

function glslVec3(v: THREE.Vector3 | THREE.Color): string {
  const [a, b, c] = v instanceof THREE.Color ? [v.r, v.g, v.b] : [v.x, v.y, v.z];
  return `vec3(${a.toFixed(5)}, ${b.toFixed(5)}, ${c.toFixed(5)})`;
}

/**
 * Round 9: the sky as the camera sees it. A portrait (phone) frame shows a lot of sky, most of it the
 * pale band around the low sun ahead, which read flat grey-brown after the grade. Away from the sun and
 * up toward the zenith the panorama is pushed to a deeper blue-teal (at the same luminance, a touch
 * darker); close to the sun it stays warm. Patched into three's background shader (one program).
 */
function installSkyGrade(): void {
  const bc = THREE.ShaderLib.backgroundCube as { uniforms: Record<string, { value: unknown }>; fragmentShader: string };
  if (bc.uniforms.skySun) return;
  bc.uniforms.skySun = { value: atmosphereUniforms.fogSunDir.value };
  bc.fragmentShader = bc.fragmentShader
    .replace('uniform float backgroundIntensity;', 'uniform float backgroundIntensity;\nuniform vec3 skySun;')
    .replace(
      'texColor.rgb *= backgroundIntensity;',
      `texColor.rgb *= backgroundIntensity;
      {
        vec3 skyD = normalize(vWorldDirection);
        float skyEl = clamp(skyD.y, 0.0, 1.0);
        float skyToSun = max(dot(skyD, normalize(skySun)), 0.0);
        float zen = smoothstep(0.02, 0.5, skyEl) * (1.0 - pow(skyToSun, 6.0) * 0.8);
        float skyL = dot(texColor.rgb, vec3(0.2126, 0.7152, 0.0722));
        // Round 10: further toward teal-blue (portrait frames are 35–45 % sky).
        texColor.rgb = mix(texColor.rgb, skyL * vec3(0.5, 0.9, 1.5), zen * 0.85) * (1.0 - zen * 0.2);
        texColor.rgb *= mix(vec3(1.0), vec3(1.07, 1.0, 0.88), pow(skyToSun, 3.0) * (1.0 - skyEl));
      }`,
    );
}
