import * as THREE from 'three';

/**
 * Foliage shading (world art, round 5), patched over the loader's leaf material (alpha test + wind):
 *  - the clumps' authored normals point out of each clump, so a card seen from behind must keep its
 *    normal (three flips it for double-sided materials, which turns half of every bush black);
 *  - sunlight through the leaves: looking toward the sun, leaves glow yellow-green;
 *  - large-scale colour drift across the jungle (fresher, yellower, bluer patches), so repeated
 *    clumps never read as copies;
 *  - a little darkening low in each plant (the inside of a mass is in its own shade).
 */
export const foliageUniforms = {
  uLeafTrans: { value: 1 },
  /** 1: cards seen edge-on dissolve (0 for QA). */
  uLeafEdge: { value: 1 },
};
if (import.meta.env.DEV) (globalThis as Record<string, unknown>).__foliage = foliageUniforms;

export function upgradeLeafMaterial(m: THREE.Material): void {
  const sm = m as THREE.MeshStandardMaterial;
  if (!sm.isMeshStandardMaterial || sm.userData.leaf5) return;
  sm.userData.leaf5 = true;
  // Blender 4.2 exports alpha-clipped materials as alphaMode BLEND, so the loader hands the leaves
  // over with depth writes off: anything drawn after a bush (a cliff behind it, a wall) painted
  // straight over it, and whole jungle masses vanished. They are alpha-tested and opaque.
  sm.transparent = false;
  sm.depthWrite = true;
  // The constant glow the loader gave the leaves is now directional (below).
  sm.emissive.setHex(0x0c1404);
  // The atlas clusters carry their own light and shade (rendered lit in Blender): lit again here
  // they would bleach on the sun side, so the albedo comes down a little and leans green.
  sm.color.setRGB(0.84, 0.9, 0.76);
  sm.roughness = 0.9;
  sm.envMapIntensity = 0.5;
  const prev = sm.onBeforeCompile;
  sm.userData.prevCompile = prev;
  sm.onBeforeCompile = (shader, renderer) => {
    prev?.call(sm, shader, renderer);
    shader.uniforms.uLeafTrans = foliageUniforms.uLeafTrans;
    shader.uniforms.uLeafEdge = foliageUniforms.uLeafEdge;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLeafW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLeafW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec3 vLeafW;
        uniform float uLeafTrans;
        uniform float uLeafEdge;
        float leafH(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float leafN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(leafH(i), leafH(i + vec2(1, 0)), f.x), mix(leafH(i + vec2(0, 1)), leafH(i + vec2(1, 1)), f.x), f.y); }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          float lv = leafN(vLeafW.xz * 0.11) * 0.65 + leafN(vLeafW.xz * 0.37 + 7.0) * 0.35;
          diffuseColor.rgb *= mix(vec3(0.7, 0.8, 0.72), vec3(0.95, 0.9, 0.66), lv);
          // A leaf facing the sun takes the full low sun: pale texels (fern tips, young fronds) would
          // burn out to white. A gamma on the albedo keeps the lights green and deepens the greens.
          // The atlas is painted bright (it reads under Blender's soft sky); under a sun of 13 a fern
          // facing it went to white. Bring it into the stone's albedo range.
          diffuseColor.rgb = pow(diffuseColor.rgb, vec3(1.15)) * 0.8;
        }`,
      )
      .replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>
        // Past the alpha test a leaf is opaque: the frame's alpha channel marks water for the
        // reflection pass, and a leaf left at its texel alpha (≤ 0.6 in the mips of a cluster)
        // was taken for water and painted over with the sky.
        diffuseColor.a = 1.0;
        {
          // Cards seen edge-on smear their texture into streaks: dissolve them as they turn away.
          vec3 ng = normalize(cross(dFdx(vLeafW), dFdy(vLeafW)));
          float face = abs(dot(ng, normalize(cameraPosition - vLeafW)));
          if (uLeafEdge > 0.5 && leafH(gl_FragCoord.xy * 0.37 + vLeafW.xz) > smoothstep(0.06, 0.3, face)) discard;
        }`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        #ifdef DOUBLE_SIDED
          normal *= faceDirection;
        #endif
        {
          // A clump normal may face away from the eye (the far side of a card): keep its light, but
          // tip it toward the viewer so the sheen stays a leaf's, not a mirror's at grazing angles.
          vec3 eyeV = normalize(vViewPosition);
          float nv = dot(normal, eyeV);
          if (nv < 0.15) normal = normalize(normal + eyeV * (0.15 - nv));
          #ifdef USE_FOG
          // The side of a mass turned from the sun is in its own shade (the fill light behind the lens
          // would otherwise flatten every backlit bush to a pale card); its rim glows instead (below).
          float toSun = dot(normal, normalize((viewMatrix * vec4(fogSunDir, 0.0)).xyz));
          diffuseColor.rgb *= mix(0.55, 1.0, smoothstep(-0.6, 0.5, toSun));
          #endif
        }`,
      )
      .replace(
        '#include <lights_physical_fragment>',
        `#include <lights_physical_fragment>
        // Leaves are matte: horizontal fronds seen from a low camera sit at grazing angles, where
        // Fresnel took the low sun to a white sheen that hid the leaf.
        material.specularColor *= 0.12;
        material.specularF90 *= 0.12;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        #ifdef USE_FOG
        {
          vec3 toFrag = normalize(vLeafW - cameraPosition);
          float into = max(dot(toFrag, fogSunDir), 0.0);
          float trans = pow(into, 6.0) * 0.45;
          totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.95, 0.55) * trans * uLeafTrans;
        }
        #endif`,
      );
  };
  const prevKey = sm.customProgramCacheKey?.bind(sm);
  sm.customProgramCacheKey = () => `${prevKey?.() ?? ''}|leaf5`;
  sm.needsUpdate = true;
}
