import * as THREE from 'three';

/** A falling sheet of water: scrolling streaks, bright where it catches the sun, fraying at the edges. */
export function makeWaterfallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      uniform float uTime;
      void main() {
        vUv = uv;
        vec3 p = position;
        // The sheet bows out as it falls.
        float t = 1.0 - uv.y;
        p.z += t * t * 1.6 + sin(uTime * 3.0 + uv.x * 9.0) * 0.05 * t;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      varying vec2 vUv;
      uniform float uTime;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float y = vUv.y * 6.0 + uTime * 2.6;
        float streak = n(vec2(vUv.x * 26.0, y)) * 0.6 + n(vec2(vUv.x * 60.0, y * 2.3 + 3.0)) * 0.4;
        float edge = smoothstep(0.0, 0.18, vUv.x) * smoothstep(1.0, 0.82, vUv.x);
        float foamBottom = smoothstep(0.25, 0.0, vUv.y);
        float a = edge * (0.35 + 0.55 * streak) + foamBottom * 0.4;
        vec3 col = mix(vec3(0.62, 0.78, 0.76), vec3(1.0, 0.97, 0.9), streak * 0.7 + foamBottom);
        gl_FragColor = vec4(col * 1.25, clamp(a, 0.0, 0.92));
        #include <fog_fragment>
      }`,
  });
}
