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
        uShallow: { value: new THREE.Color('#3f8f84') },
        uDeep: { value: new THREE.Color('#12383a') },
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
          vec3 body = mix(uDeep, uShallow, depthLook * 0.8 + 0.1);
          // Light scattered inside wave crests.
          float crest = clamp(g.x * 3.0 + g.y * 2.0, 0.0, 1.0);
          body += uShallow * crest * 0.25;
          vec3 col = mix(body, refl, fres * 0.9);
          vec3 H = normalize(uSunDir + V);
          float spec = pow(max(dot(N, H), 0.0), 420.0) * 22.0 + pow(max(dot(N, H), 0.0), 60.0) * 0.35;
          col += uSunColor * spec;
          gl_FragColor = vec4(col, 1.0);
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
}
