import * as THREE from 'three';

export const WATER_Y = -2.2;

/**
 * Open water: a large plane that follows the camera. Waves are analytic (no
 * texture), reflections come from the far-world panorama, and a hot glint
 * tracks the sun. Shallow, milky turquoise near the eye; deep green-blue far.
 */
export class Water {
  readonly mesh: THREE.Mesh;
  readonly uniforms: Record<string, THREE.IUniform>;

  constructor(backdrop: THREE.Texture, sunDir: THREE.Vector3) {
    this.uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uSky: { value: null },
        uSunDir: { value: sunDir.clone() },
        uSunColor: { value: new THREE.Color(1.0, 0.82, 0.6) },
        uShallow: { value: new THREE.Color('#2fa593') },
        uDeep: { value: new THREE.Color('#06403f') },
        uSkyYaw: { value: 0 },
        uMark: { value: 1 },
        uDetail: { value: 2 },
        uCamPos: { value: new THREE.Vector3() },
      },
    ]);
    this.uniforms.uSky!.value = backdrop;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      fog: true,
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform sampler2D uSky;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform int uDetail;
        uniform vec3 uCamPos;
        uniform float uSkyYaw;
        uniform float uMark;
        varying vec3 vWorld;

        vec2 waveGrad(vec2 p, float t) {
          vec2 g = vec2(0.0);
          // Directional wave trains; derivative of sum of sines.
          const int N = 6;
          vec2 dirs[6] = vec2[6](vec2(0.8, 0.6), vec2(-0.6, 0.8), vec2(0.3, -0.95), vec2(-0.9, -0.2), vec2(0.5, 0.86), vec2(-0.2, 0.98));
          float amp = 0.055, freq = 0.55, speed = 1.1;
          for (int i = 0; i < N; i++) {
            if (i >= 2 + uDetail * 2) break;
            float ph = dot(dirs[i], p) * freq + t * speed * (1.0 + float(i) * 0.13);
            g += dirs[i] * cos(ph) * amp * freq;
            amp *= 0.62; freq *= 1.85; speed *= 1.25;
          }
          return g;
        }

        vec3 skySample(vec3 d) {
          d = normalize(d);
          // The panorama turns with the light (see Game: the sky follows the route's heading).
          float cy = cos(uSkyYaw), sy = sin(uSkyYaw);
          d = vec3(cy * d.x - sy * d.z, d.y, sy * d.x + cy * d.z);
          vec2 uv = vec2(atan(d.z, d.x) / 6.2831853 + 0.5, asin(clamp(d.y, -1.0, 1.0)) / 3.1415926 + 0.5);
          return texture2D(uSky, uv).rgb;
        }

        void main() {
          vec3 V = normalize(cameraPosition - vWorld);
          float dist = length(cameraPosition - vWorld);
          vec2 g = waveGrad(vWorld.xz, uTime);
          // Flatten waves with distance to avoid shimmer.
          g *= 1.0 / (1.0 + dist * 0.02);
          vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
          float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
          vec3 R = reflect(-V, N);
          R.y = abs(R.y);
          vec3 refl = skySample(R);
          // (The sRGB texture is decoded to linear by the sampler.)
          float depthLook = smoothstep(0.0, 1.0, dot(V, vec3(0.0, 1.0, 0.0)));
          // Looking down into it the water is clear turquoise; toward the horizon it reads deep.
          vec3 body = mix(uDeep, uShallow, depthLook * 0.8 + 0.04);
          // Deep teal-green in the middle distance, a clearer jade close under the eye.
          body = mix(body, uShallow * 1.15, smoothstep(14.0, 3.0, dist) * 0.35);
          body *= mix(0.7, 1.0, smoothstep(90.0, 8.0, dist));
          // Light scattered inside wave crests.
          float crest = clamp(g.x * 3.0 + g.y * 2.0, 0.0, 1.0);
          body += uShallow * crest * 0.25;
          // Caustic-looking light playing in the shallows under the eye: a warped interference
          // pattern, strongest looking down and close, gone by the middle distance.
          if (uDetail > 0) {
            vec2 q = vWorld.xz * 0.55;
            for (int k = 0; k < 2; k++) q += vec2(sin(q.y * 1.3 + uTime * 0.7), cos(q.x * 1.1 - uTime * 0.6)) * 0.45;
            float ca = pow(abs(sin(q.x * 2.2) * sin(q.y * 2.0)), 3.0);
            body += vec3(0.55, 0.85, 0.7) * ca * 0.22 * depthLook * smoothstep(45.0, 6.0, dist);
          }
          // Glossy: the sky and the far world mirror strongly toward grazing angles.
          // The panorama near the sun is several times brighter than paper white: mirrored at a
          // grazing angle it turned whole sheets of water pure white (a hole in the world). Roll the
          // reflection off softly above ~1 so it stays bright sky, never clipped.
          float rl = max(max(refl.r, refl.g), refl.b);
          refl *= rl > 0.9 ? (0.9 + 0.6 * (1.0 - exp(-(rl - 0.9) / 0.6))) / rl : 1.0;
          vec3 col = mix(body, refl * vec3(0.9, 0.97, 0.95), clamp(fres * 1.05, 0.0, 0.95));
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 420.0) * 22.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.35;
          // The glint itself stays hot (it blooms), but only the narrow core: the broad lobe is capped.
          col += uSunColor * min(spec, 6.0);
          // Alpha marks water for the screen-space reflections (the canvas itself is opaque).
          gl_FragColor = vec4(col, uMark);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    const geo = new THREE.PlaneGeometry(1600, 1600, 1, 1).rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = WATER_Y;
    this.mesh.name = 'water';
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = false;
  }

  update(t: number, cam: THREE.Camera): void {
    this.uniforms.uTime!.value = t;
    this.mesh.position.x = Math.round(cam.position.x / 50) * 50;
    this.mesh.position.z = Math.round(cam.position.z / 50) * 50;
  }

  setDetail(d: number): void {
    this.uniforms.uDetail!.value = d;
  }

  /** Mark water pixels in alpha for the screen-space reflection pass (only where it runs). */
  setReflections(on: boolean): void {
    this.uniforms.uMark!.value = on ? 0.3 : 1;
  }

  /** Where the sun is, and how far the panorama has been turned to keep it there. */
  setSun(dir: THREE.Vector3, skyYaw: number): void {
    (this.uniforms.uSunDir!.value as THREE.Vector3).copy(dir);
    this.uniforms.uSkyYaw!.value = skyYaw;
  }
}

// ------------------------------------------------------------------ foam
/**
 * Foam where stone meets water. Strips run 4 m along −Z from the origin, their inner edge
 * (uv.x = 0) against the stone at x = 0 and fading out by x = 1.3; rings have their inner
 * edge at r = 0.55 of a unit radius. One additive-free, fogged shader animates both.
 */
export function makeFoamStrip(): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(1.3, 4, 3, 8).rotateX(-Math.PI / 2).translate(0.65, 0, -2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 1.3, -pos.getZ(i) / 4);
  return g;
}

export function makeFoamRing(): THREE.BufferGeometry {
  const g = new THREE.RingGeometry(0.5, 1, 28, 2).rotateX(-Math.PI / 2);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    uv.setXY(i, (r - 0.5) / 0.5, Math.atan2(pos.getZ(i), pos.getX(i)) / (Math.PI * 2) + 0.5);
  }
  return g;
}

export const foamTime = { value: 0 };

export function makeFoamMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    name: 'foam',
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 } }]),
    vertexShader: /* glsl */ `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vW;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vW = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      #include <fog_pars_fragment>
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
      void main() {
        float e = clamp(vUv.x, 0.0, 1.0);
        vec2 p = vW.xz;
        float nz = n(p * 2.3 + vec2(uTime * 0.35, -uTime * 0.2)) * 0.6 + n(p * 6.1 - uTime * 0.5) * 0.4;
        // A lapping line that swells out from the stone and back.
        float lap = 0.18 + 0.12 * sin(uTime * 1.3 + n(p * 0.7) * 6.0);
        // Broken up by the noise so it never draws a clean outline.
        float line = smoothstep(0.16, 0.0, abs(e - lap - nz * 0.2)) * smoothstep(0.35, 0.7, nz);
        float hug = exp(-e * 5.0);
        float lace = smoothstep(0.5, 0.8, nz) * exp(-e * 2.5);
        float a = clamp(hug * (0.3 + 0.7 * nz) + line * 0.4 + lace * 0.4, 0.0, 1.0) * smoothstep(1.0, 0.7, e) * smoothstep(0.0, 0.08, e + 0.02);
        gl_FragColor = vec4(vec3(0.9, 0.95, 0.92), a * 0.85);
        #include <fog_fragment>
      }`,
  });
  m.uniforms.uTime = foamTime;
  return m;
}
