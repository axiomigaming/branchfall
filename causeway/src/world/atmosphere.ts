import * as THREE from 'three';
import { WATER_Y } from './water';

/**
 * Aerial perspective for every fogged material: exponential height fog (thick over the
 * water, thinning with altitude, integrated along the view ray so towers rise out of it)
 * and in-scattering toward the sun, so the haze glows gold looking into the light and
 * stays cooler looking away. It replaces three's fog chunks, so it must be installed
 * before any program compiles.
 */
export interface AtmosphereOptions {
  /** Warm haze away from the sun. */
  color: THREE.ColorRepresentation;
  /** Haze looking into the sun. */
  sunColor: THREE.ColorRepresentation;
  density: number;
  /** Per-metre falloff of density with height above the water. */
  falloff: number;
}

export const ATMOSPHERE: AtmosphereOptions = {
  // Cool blue-green haze away from the sun (aerial perspective: depth layers fade toward the sky),
  // warm gold looking into the light.
  color: 0x8fb0bb,
  sunColor: 0xf3d09a,
  density: 0.0038,
  falloff: 0.05,
};

let installed = false;

function glslVec3(v: THREE.Vector3 | THREE.Color): string {
  const [a, b, c] = v instanceof THREE.Color ? [v.r, v.g, v.b] : [v.x, v.y, v.z];
  return `vec3(${a.toFixed(5)}, ${b.toFixed(5)}, ${c.toFixed(5)})`;
}

export function installAtmosphere(scene: THREE.Scene, sunDir: THREE.Vector3, o: AtmosphereOptions = ATMOSPHERE): void {
  scene.fog = new THREE.FogExp2(o.color, o.density);
  if (installed) return;
  installed = true;
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
  varying float vFogDepth;
  varying vec3 vFogView;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = /* glsl */ `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    // View-space offset back to world space (the view matrix is a rotation + translation).
    vec3 fogW = (vec4(vFogView, 0.0) * viewMatrix).xyz;
    float fogDist = length(fogW);
    vec3 fogDir = fogW / max(fogDist, 1e-4);
    float fogB = ${o.falloff.toFixed(4)};
    float fogH0 = max(cameraPosition.y - (${WATER_Y.toFixed(2)}), 0.0);
    float fogDy = fogW.y;
    float fogLine = abs(fogB * fogDy) > 1e-3 ? (1.0 - exp(-fogB * fogDy)) / (fogB * fogDy) : 1.0;
    float fogOpt = fogDensity * fogDist * exp(-fogB * fogH0) * fogLine;
    float fogFactor = 1.0 - exp(-fogOpt);
    float fogSun = max(dot(fogDir, ${glslVec3(sunDir.clone().normalize())}), 0.0);
    vec3 fogCol = mix(fogColor, ${glslVec3(sun)}, pow(fogSun, 6.0) * 0.75);
    // Far away the haze thickens to the sky's own horizon colour.
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, clamp(fogFactor, 0.0, 0.94));
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
  #endif
#endif`;
}
