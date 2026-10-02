import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  FXAAEffect,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { QualityProfile } from '../config/quality';

/** Interleaved gradient noise, shared by every stochastic pass (jitter that TAA-less frames forgive). */
const IGN = /* glsl */ `float ignL(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }`;

/** Soft ellipse around the runner: 0 on the figure, 1 well clear of it. */
const PROTECT = /* glsl */ `
  uniform vec2 protectPos;
  uniform vec2 protectSize;
  float protectMask(vec2 p) {
    vec2 q = (p - protectPos) / protectSize;
    return smoothstep(0.75, 1.7, length(q));
  }`;

/**
 * Motion blur. Medium and up: true camera motion blur — each pixel's world position is rebuilt
 * from depth and reprojected with last frame's camera, so the walls rushing past the lens smear
 * hard, the vanishing point stays crisp, and turns, bob and shake streak the way a real shutter
 * would. The shutter opens with speed. The runner rides with the camera, so an ellipse on the
 * figure keeps it sharp and taps that land on it are rejected (no ghosting into the background).
 * A zoom term from the vanishing point adds the stylised rush on top. Low: the zoom term alone,
 * no depth.
 */
class MotionBlurEffect extends Effect {
  constructor(samples: number, camera: boolean) {
    super(
      'MotionBlur',
      /* glsl */ `
      ${IGN}
      ${PROTECT}
      uniform float radial;
      uniform vec2 center;
      uniform float aspectRatio;
      uniform float fringe;
      uniform float shutterScale;
      uniform float maxLen;
      uniform mat4 invViewProj;
      uniform mat4 prevViewProj;
      void mainImage(const in vec4 inputColor, const in vec2 uv, ${camera ? 'const in float depth, ' : ''}out vec4 outputColor) {
        vec2 d = uv - center;
        float r = length(vec2(d.x * aspectRatio, d.y));
        vec2 v = d * radial * smoothstep(0.18, 0.8, r);
        ${
          camera
            ? `vec4 wp = invViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        wp /= wp.w;
        vec4 pc = prevViewProj * wp;
        if (pc.w > 0.01) v += (uv - (pc.xy / pc.w * 0.5 + 0.5)) * shutterScale;`
            : ''
        }
        float m = protectMask(uv);
        v *= m;
        vec2 va = vec2(v.x * aspectRatio, v.y);
        float len = length(va);
        if (len > maxLen) v *= maxLen / len;
        if (len * resolution.y < 1.5) { outputColor = inputColor; return; }
        vec3 acc = vec3(0.0);
        float w = 0.0;
        float w0 = 0.0;
        // Half-amplitude dither: a full 0..1 jitter over only 6–16 taps printed a halftone lattice.
        float jitter = 0.5 + (ignL(gl_FragCoord.xy) - 0.5) * 0.5;
        for (int i = 0; i < ${samples}; i++) {
          float t = (float(i) + jitter) / float(${samples}) - 0.5;
          vec2 o = uv - v * t;
          // Never drag the runner's pixels across the background. A soft weight, not a step: a
          // hard cut printed the edge of the rejected taps as a hard-edged patch beside him.
          float k0 = 1.0 - abs(t);
          float k = smoothstep(0.35, 0.75, protectMask(o)) * k0;
          vec3 c;
          c.r = texture2D(inputBuffer, o - v * fringe).r;
          c.g = texture2D(inputBuffer, o).g;
          c.b = texture2D(inputBuffer, o + v * fringe).b;
          acc += c * k;
          w += k;
          w0 += k0;
        }
        // Where most taps were rejected, fall back to the sharp pixel smoothly.
        outputColor = vec4(mix(inputColor.rgb, acc / max(w, 1e-4), clamp(2.0 * w / w0, 0.0, 1.0)), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION | (camera ? EffectAttribute.DEPTH : 0),
        uniforms: new Map<string, THREE.Uniform>([
          ['radial', new THREE.Uniform(0)],
          ['center', new THREE.Uniform(new THREE.Vector2(0.5, 0.58))],
          ['protectPos', new THREE.Uniform(new THREE.Vector2(0.5, 0.3))],
          ['protectSize', new THREE.Uniform(new THREE.Vector2(0.14, 0.3))],
          ['aspectRatio', new THREE.Uniform(1.6)],
          ['fringe', new THREE.Uniform(0.08)],
          ['shutterScale', new THREE.Uniform(0)],
          ['maxLen', new THREE.Uniform(0.12)],
          ['invViewProj', new THREE.Uniform(new THREE.Matrix4())],
          ['prevViewProj', new THREE.Uniform(new THREE.Matrix4())],
        ]),
      },
    );
  }
}

/**
 * Sun shafts: march from each pixel toward the sun on screen, collecting only what is sky
 * (the depth buffer is clear there) and bright. Arches, pillars and leaf cards cut the light
 * into beams; the result is added before tone mapping so bloom and AgX treat it as light.
 * A second, softer term scatters the same light into the haze so the beams read as volume.
 */
class SunShaftsEffect extends Effect {
  constructor(samples: number) {
    super(
      'SunShafts',
      /* glsl */ `
      uniform vec2 sunPos;
      uniform float strength;
      uniform float aspectRatio;
      uniform vec3 tint;
      float ign2(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        if (strength < 0.001) { outputColor = inputColor; return; }
        vec2 delta = sunPos - uv;
        // A small dither, centred on the half step: a full 0..1 jitter breaks the march's banding
        // but prints the noise's lattice over the whole sky as a halftone. ±0.2 of a step keeps the
        // bands broken up where they would show (the hard edges of occluders) and the sky clean.
        float jitter = 0.5 + (ign2(gl_FragCoord.xy) - 0.5) * 0.4;
        vec3 acc = vec3(0.0);
        float open = 0.0;
        for (int i = 0; i < ${samples}; i++) {
          float t = (float(i) + jitter) / float(${samples});
          vec2 p = uv + delta * t * 0.96;
          if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) continue;
          float sky = step(0.99995, readDepth(p));
          vec3 c = texture2D(inputBuffer, p).rgb;
          float l = max(max(c.r, c.g), c.b);
          acc += sky * min(c, vec3(8.0)) * smoothstep(0.35, 1.6, l) * (0.35 + 0.65 * t);
          open += sky;
        }
        acc /= float(${samples});
        open /= float(${samples});
        float r = length(vec2((uv.x - sunPos.x) * aspectRatio, uv.y - sunPos.y));
        float fall = exp(-r * 1.45);
        // In-scatter: warm haze in the light's path, gated by how much sky the pixel can see.
        vec3 veil = tint * open * exp(-r * 3.0) * 0.04;
        outputColor = vec4(inputColor.rgb + (acc * tint * fall + veil) * strength, inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
        uniforms: new Map<string, THREE.Uniform>([
          ['sunPos', new THREE.Uniform(new THREE.Vector2(0.5, 0.6))],
          ['strength', new THREE.Uniform(0)],
          ['aspectRatio', new THREE.Uniform(1.6)],
          ['tint', new THREE.Uniform(new THREE.Vector3(1.0, 0.8, 0.55))],
        ]),
      },
    );
  }
}

/**
 * Exposure plus the lens looking into the sun: a veiling glare, a starburst and a chain of
 * ghosts mirrored through the frame centre. All analytic (no image taps), occlusion-tested
 * against the depth buffer around the sun, so a wall or a canopy swallows the flare. Runs
 * before bloom and tone mapping, so the hot core blooms and the ghosts roll off like light.
 */
class LensEffect extends Effect {
  constructor(occlusion: boolean) {
    super(
      'Lens',
      /* glsl */ `
      uniform vec2 sunPos;
      uniform float sunOn;
      uniform float aspectRatio;
      uniform float exposure;
      uniform float flare;
      uniform vec3 sunTint;
      float sunVis() {
        ${
          occlusion
            ? `float v = 2.0 * step(0.99995, readDepth(clamp(sunPos, 0.0, 1.0)));
        for (int i = 0; i < 8; i++) {
          float a = float(i) * 0.7853982;
          vec2 p = clamp(sunPos + vec2(cos(a) / aspectRatio, sin(a)) * 0.014, 0.0, 1.0);
          v += step(0.99995, readDepth(p));
        }
        return v / 10.0;`
            : 'return 1.0;'
        }
      }
      float hexDist(vec2 p) {
        p = abs(p);
        return max(p.x * 0.8660254 + p.y * 0.5, p.y);
      }
      void mainImage(const in vec4 inputColor, const in vec2 uv, ${occlusion ? 'const in float depth, ' : ''}out vec4 outputColor) {
        vec3 c = inputColor.rgb * exposure;
        float on = sunOn * flare;
        if (on > 0.002) {
          float vis = sunVis() * on;
          if (vis > 0.002) {
            vec2 d = uv - sunPos;
            d.x *= aspectRatio;
            float r = length(d);
            vec3 add = sunTint * (exp(-r * 3.5) * 0.03 + exp(-r * 10.0) * 0.26 + exp(-r * 34.0) * 2.0);
            float ang = atan(d.y, d.x);
            float rays = pow(abs(cos(ang * 3.0 + 0.4)), 90.0) + 0.6 * pow(abs(cos(ang * 5.0 + 1.3)), 160.0);
            add += sunTint * rays * exp(-r * 7.0) * 0.7;
            // Anamorphic streak.
            add += vec3(1.0, 0.82, 0.62) * exp(-abs(d.y) * 140.0) * exp(-abs(d.x) * 2.2) * 0.5;
            // Ghosts on the line through the centre.
            vec2 axis = vec2(0.5) - sunPos;
            const int G = 5;
            float gk[5] = float[5](0.55, 1.15, 1.45, 1.9, 2.4);
            float gs[5] = float[5](0.035, 0.075, 0.03, 0.12, 0.05);
            vec3 gc[5] = vec3[5](vec3(1.0, 0.7, 0.35), vec3(0.45, 0.75, 1.0), vec3(1.0, 0.55, 0.8), vec3(0.5, 1.0, 0.7), vec3(1.0, 0.85, 0.5));
            for (int i = 0; i < G; i++) {
              vec2 gp = sunPos + axis * gk[i];
              vec2 gd = uv - gp;
              gd.x *= aspectRatio;
              float h = hexDist(gd) / gs[i];
              float disc = smoothstep(1.0, 0.86, h) * (0.45 + 0.55 * smoothstep(0.3, 0.98, h));
              add += gc[i] * disc * 0.035;
            }
            // A halo ring at a fixed radius around the frame centre on the sun's side.
            vec2 hc = uv - (sunPos + axis * 1.0);
            hc.x *= aspectRatio;
            float ring = exp(-pow((length(hc) - 0.42) * 22.0, 2.0));
            add += vec3(0.9, 0.8, 1.0) * ring * 0.03;
            c += add * vis;
          }
        }
        outputColor = vec4(c, inputColor.a);
      }`,
      {
        attributes: occlusion ? EffectAttribute.DEPTH : EffectAttribute.NONE,
        uniforms: new Map<string, THREE.Uniform>([
          ['sunPos', new THREE.Uniform(new THREE.Vector2(0.5, 0.8))],
          ['sunOn', new THREE.Uniform(0)],
          ['aspectRatio', new THREE.Uniform(1.6)],
          ['exposure', new THREE.Uniform(1)],
          ['flare', new THREE.Uniform(1)],
          ['sunTint', new THREE.Uniform(new THREE.Vector3(1.0, 0.86, 0.64))],
        ]),
      },
    );
  }
}

/**
 * Screen-space reflections on the water (High and up). The water writes a marker into alpha;
 * for those pixels a ray is reflected off the rippled plane and marched through the depth
 * buffer, and where it meets a cliff, wall or tree its colour is mixed in by Fresnel. Rays that
 * leave the screen keep the panorama reflection the water shader already drew.
 */
class WaterReflectEffect extends Effect {
  constructor(steps: number) {
    super(
      'WaterReflect',
      /* glsl */ `
      ${IGN}
      uniform mat4 invViewProj;
      uniform mat4 viewProj;
      uniform vec3 camPos;
      uniform float waterTime;
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        outputColor = inputColor;
        if (inputColor.a > 0.6 || depth > 0.99999) return;
        vec4 wp = invViewProj * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
        vec3 P = wp.xyz / wp.w;
        vec3 toP = P - camPos;
        float dist = length(toP);
        vec3 V = toP / dist;
        vec2 g = vec2(sin(P.x * 1.3 + waterTime * 1.4) + sin(P.z * 0.7 - waterTime * 1.1), cos(P.z * 1.6 + waterTime * 1.2) + cos(P.x * 0.9 + waterTime * 0.8));
        g *= 0.022 / (1.0 + dist * 0.03);
        vec3 N = normalize(vec3(g.x, 1.0, g.y));
        vec3 R = reflect(V, N);
        float s0 = 0.35 + dist * 0.035;
        float jitter = ignL(gl_FragCoord.xy);
        vec2 hitUV = vec2(0.0);
        float hit = 0.0;
        float fi = 0.0;
        for (int i = 0; i < ${steps}; i++) {
          fi = float(i) + jitter;
          vec3 Q = P + R * s0 * fi * (1.0 + fi * 0.18);
          vec4 cq = viewProj * vec4(Q, 1.0);
          if (cq.w <= 0.01) break;
          vec3 n = cq.xyz / cq.w;
          vec2 q = n.xy * 0.5 + 0.5;
          if (q.x < 0.0 || q.y < 0.0 || q.x > 1.0 || q.y > 1.0) break;
          float sd = readDepth(q);
          float rd = n.z * 0.5 + 0.5;
          if (sd < 0.99999 && rd > sd) {
            float gap = getViewZ(sd) - getViewZ(rd);
            if (gap < 1.2 + s0 * fi * 0.35) {
              hitUV = q;
              hit = 1.0;
            }
            break;
          }
        }
        if (hit < 0.5) return;
        vec2 e = smoothstep(vec2(0.0), vec2(0.08), hitUV) * smoothstep(vec2(1.0), vec2(0.92), hitUV);
        float fade = e.x * e.y * (1.0 - fi / float(${steps}));
        vec4 hc = texture2D(inputBuffer, hitUV);
        if (hc.a < 0.6) return; // a reflection of the water itself: keep the panorama
        float fres = 0.04 + 0.96 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
        vec3 refl = hc.rgb * vec3(0.82, 0.92, 0.9);
        outputColor = vec4(mix(inputColor.rgb, refl, clamp(fres * 1.15, 0.0, 0.92) * fade), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
        uniforms: new Map<string, THREE.Uniform>([
          ['invViewProj', new THREE.Uniform(new THREE.Matrix4())],
          ['viewProj', new THREE.Uniform(new THREE.Matrix4())],
          ['camPos', new THREE.Uniform(new THREE.Vector3())],
          ['waterTime', new THREE.Uniform(0)],
        ]),
      },
    );
  }
}

/**
 * Ambient occlusion from the depth buffer alone (no normal pass, no extra draw calls): view-space
 * positions are rebuilt from depth, the normal from the nearer neighbour on each axis, and a short
 * spiral of taps measures how much the surrounding geometry closes over each point. It darkens the
 * seams where stones meet the floor, the undersides of ledges and the feet of walls in the water.
 * Fades out with distance, and never touches the sky.
 */
class DepthAOEffect extends Effect {
  constructor(samples: number) {
    super(
      'DepthAO',
      /* glsl */ `
      uniform vec2 projInfo;
      uniform float aoRadius;
      uniform float aoStrength;
      vec3 aoPos(vec2 p) {
        float z = getViewZ(readDepth(p));
        return vec3((p * 2.0 - 1.0) * projInfo * (-z), z);
      }
      float ign3(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
        if (depth > 0.9999 || aoStrength < 0.001) { outputColor = inputColor; return; }
        vec3 P = aoPos(uv);
        float dist = -P.z;
        float fade = 1.0 - smoothstep(35.0, 80.0, dist);
        if (fade < 0.01) { outputColor = inputColor; return; }
        vec3 px = aoPos(uv + vec2(texelSize.x, 0.0)) - P;
        vec3 nx = P - aoPos(uv - vec2(texelSize.x, 0.0));
        vec3 py = aoPos(uv + vec2(0.0, texelSize.y)) - P;
        vec3 ny = P - aoPos(uv - vec2(0.0, texelSize.y));
        vec3 dx = abs(px.z) < abs(nx.z) ? px : nx;
        vec3 dy = abs(py.z) < abs(ny.z) ? py : ny;
        vec3 N = normalize(cross(dx, dy));
        if (dot(N, P) > 0.0) N = -N;
        float rPx = clamp(aoRadius / (dist * projInfo.y) * resolution.y * 0.5, 2.0, 70.0);
        float a0 = ign3(gl_FragCoord.xy) * 6.2831853;
        float occ = 0.0;
        for (int i = 0; i < ${samples}; i++) {
          float t = (float(i) + 0.5) / float(${samples});
          float a = a0 + t * 15.4; // ~2.5 turns of spiral
          vec2 o = vec2(cos(a), sin(a)) * t * rPx * texelSize;
          vec3 v = aoPos(uv + o) - P;
          float l = length(v);
          occ += max(dot(N, v / max(l, 1e-4)) - 0.12, 0.0) * (1.0 - smoothstep(aoRadius * 0.7, aoRadius * 1.8, l));
        }
        occ = clamp(occ / float(${samples}) * 1.9, 0.0, 1.0);
        outputColor = vec4(inputColor.rgb * (1.0 - occ * aoStrength * fade), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.DEPTH,
        uniforms: new Map<string, THREE.Uniform>([
          ['projInfo', new THREE.Uniform(new THREE.Vector2(1, 1))],
          ['aoRadius', new THREE.Uniform(0.9)],
          ['aoStrength', new THREE.Uniform(0.75)],
        ]),
      },
    );
  }
}

/**
 * Contrast-adaptive sharpening (after AMD FidelityFX CAS, 5-tap cross). Restores the edge contrast
 * a frame loses when it is drawn below the screen's pixel ratio and stretched by the browser; the
 * per-pixel weight backs off where the neighbourhood already spans the full range, so it does not
 * ring or amplify noise. Runs on HDR input, in a Reinhard-compressed domain. First in the final
 * pass (it is its only convolution), so it costs four extra taps and no extra pass.
 */
class SharpenEffect extends Effect {
  constructor() {
    super(
      'Sharpen',
      /* glsl */ `
      uniform float sharpness;
      vec3 casIn(vec3 c) { return c / (1.0 + c); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        if (sharpness < 0.001) { outputColor = inputColor; return; }
        vec3 e = casIn(max(inputColor.rgb, 0.0));
        vec3 b = casIn(max(texture2D(inputBuffer, uv + vec2(0.0, texelSize.y)).rgb, 0.0));
        vec3 d = casIn(max(texture2D(inputBuffer, uv - vec2(texelSize.x, 0.0)).rgb, 0.0));
        vec3 f = casIn(max(texture2D(inputBuffer, uv + vec2(texelSize.x, 0.0)).rgb, 0.0));
        vec3 h = casIn(max(texture2D(inputBuffer, uv - vec2(0.0, texelSize.y)).rgb, 0.0));
        vec3 mn = min(e, min(min(b, d), min(f, h)));
        vec3 mx = max(e, max(max(b, d), max(f, h)));
        vec3 amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, 1e-4), 0.0, 1.0));
        // Leave near-flat neighbourhoods alone: there the only contrast is dither (shaft and PCF
        // jitter, grain), and sharpening it would print the noise pattern over the sky.
        vec3 rng = mx - mn;
        float edge = smoothstep(0.015, 0.05, max(rng.r, max(rng.g, rng.b)));
        vec3 w = -amp * (0.2 * sharpness * edge);
        vec3 r = clamp((e + (b + d + f + h) * w) / (1.0 + 4.0 * w), 0.0, 0.998);
        outputColor = vec4(r / (1.0 - r), inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION,
        uniforms: new Map<string, THREE.Uniform>([['sharpness', new THREE.Uniform(0)]]),
      },
    );
  }
}

/** Mood: warmth, contrast, danger heat, the cold of a fall and the gold of an escape. */
class GradeEffect extends Effect {
  constructor() {
    super(
      'Grade',
      /* glsl */ `
      uniform float saturation;
      uniform float contrast;
      uniform vec3 tint;
      uniform float danger;
      uniform float cold;
      uniform float gold;
      uniform float flash;
      uniform float fade;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 c = inputColor.rgb;
        float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(vec3(l), c, saturation + gold * 0.15 - cold * 0.6);
        // Split tone: shade stays warm-neutral (sunlit stone bounces into it), the lights bleach
        // toward cream the way a sun-drenched frame does; only the deepest darks lean teal.
        float hl = smoothstep(0.1, 0.75, l);
        float deep = smoothstep(0.12, 0.0, l);
        c *= mix(vec3(1.03, 0.99, 0.95), vec3(1.06, 1.01, 0.9), hl);
        c = mix(c, c * vec3(0.94, 1.0, 1.03), deep * 0.35);
        float cream = smoothstep(0.62, 0.98, l);
        c = mix(c, vec3(l) * vec3(1.04, 0.99, 0.88) + (c - vec3(l)) * 0.55, cream * 0.5);
        // A soft S-curve around mid grey rather than a straight contrast stretch.
        vec3 k = clamp(c, 0.0, 1.0);
        vec3 s = k * k * (3.0 - 2.0 * k);
        c = mix(c, mix(k, s, 0.22), step(c, vec3(1.0)));
        // Contrast about mid grey with a soft toe. A straight (c - 0.5) * k + 0.5 in this linear
        // space clipped everything under ~0.04 (sRGB ~0.2) to pure black: backlit jungle and cliffs
        // against the sun became flat black holes in the sky, and deep shade lost all detail.
        // Here the offset fades in with c, so the curve is the same above ~0.3 and reaches 0 only at 0.
        float kc = contrast + danger * 0.06 + cold * 0.1;
        c = max(c, 0.0);
        c = c * kc - (kc - 1.0) * 0.5 * (c / (c + 0.15));
        c *= tint;
        // Danger: embers in the highlights, a clamp in the shadows.
        c = mix(c, c * vec3(1.1, 0.95, 0.86), danger * 0.4);
        // Fall: blue-grey and heavy.
        c = mix(c, c * vec3(0.78, 0.86, 1.0) * 0.8, cold);
        // Escape: honey light.
        c = mix(c, c * vec3(1.1, 1.0, 0.84), gold);
        c += vec3(1.0, 0.92, 0.78) * flash;
        c = mix(c, vec3(0.03, 0.025, 0.02), fade);
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }`,
      {
        uniforms: new Map<string, THREE.Uniform>([
          ['saturation', new THREE.Uniform(1.14)],
          ['contrast', new THREE.Uniform(1.13)],
          ['tint', new THREE.Uniform(new THREE.Vector3(1.025, 0.995, 0.95))],
          ['danger', new THREE.Uniform(0)],
          ['cold', new THREE.Uniform(0)],
          ['gold', new THREE.Uniform(0)],
          ['flash', new THREE.Uniform(0)],
          ['fade', new THREE.Uniform(0)],
        ]),
      },
    );
  }
}

export interface PostParams {
  speed: number; // 0..1
  runnerScreen: THREE.Vector2; // uv of runner's chest
  /** Half-size of the runner's sharp zone in uv (x, y). Optional: a default ellipse otherwise. */
  runnerSize?: THREE.Vector2;
  danger: number;
  cold: number;
  gold: number;
  flash: number;
  fade: number;
  bloomBoost: number;
  /** 1 with full motion, 0 when the player asked for reduced motion (no camera blur). */
  motion?: number;
  /** Frame time in seconds (for the shutter). */
  dt?: number;
  /** World time, for the water ripples in the reflections. */
  time?: number;
}

/** Bloom strength at rest (was 0.75: with the sky over the threshold it veiled the top of the frame). */
const BLOOM = 0.5;

/** Base exposure: the sun-drenched references sit well above a neutral grey. */
export const EXPOSURE = 1.14;

export class Post {
  readonly composer: EffectComposer;
  private blur: MotionBlurEffect | null = null;
  private blurPass: EffectPass | null = null;
  private cameraBlur = false;
  private sharpen = new SharpenEffect();
  private sharpenBase = 0;
  private shafts: SunShaftsEffect | null = null;
  private lens: LensEffect | null = null;
  private ssr: WaterReflectEffect | null = null;
  private ao: DepthAOEffect | null = null;
  private sun: THREE.Object3D | null = null;
  private sunV = new THREE.Vector3();
  private grade = new GradeEffect();
  private bloom: BloomEffect | null = null;
  private vignette = new VignetteEffect({ offset: 0.28, darkness: 0.55 });
  private renderPass: RenderPass;
  private vp = new THREE.Matrix4();
  private prevVP = new THREE.Matrix4();
  private invVP = new THREE.Matrix4();
  private hasPrev = false;
  private flareOn = true;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    q: QualityProfile,
  ) {
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
    this.renderPass = new RenderPass(scene, camera);
    this.build(q);
  }

  build(q: QualityProfile): void {
    this.composer.removeAllPasses();
    this.composer.addPass(this.renderPass);
    this.ssr = q.waterReflections > 0 ? new WaterReflectEffect(q.waterReflections) : null;
    if (this.ssr) this.composer.addPass(new EffectPass(this.camera, this.ssr));
    this.shafts = q.godRays > 0 ? new SunShaftsEffect(q.godRays) : null;
    this.ao = q.ao > 0 ? new DepthAOEffect(q.ao) : null;
    const lightFx = [this.ao, this.shafts].filter((e): e is DepthAOEffect | SunShaftsEffect => e !== null);
    if (lightFx.length) this.composer.addPass(new EffectPass(this.camera, ...lightFx));
    this.cameraBlur = q.motionBlur === 'camera';
    this.blur = q.speedBlur ? new MotionBlurEffect(q.blurSamples, this.cameraBlur) : null;
    this.blurPass = this.blur ? new EffectPass(this.camera, this.blur) : null;
    if (this.blurPass) this.composer.addPass(this.blurPass);
    this.hasPrev = false;
    this.sharpenBase = q.sharpen;
    // Bloom: a tight radius and a high knee, so the sky does not haze over every silhouette (a soft
    // halo around all edges against the sky reads as a blurred, milky frame). Only the hot sun,
    // its glints and the cash-out flare bloom.
    this.bloom = q.bloom ? new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.3, luminanceSmoothing: 0.3, intensity: BLOOM, radius: 0.45 }) : null;
    this.lens = new LensEffect(q.lensFlare);
    this.flareOn = q.lensFlare;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    // Film grain, kept below what reads as dirt on a phone (was 0.035).
    grain.blendMode.opacity.value = 0.018;
    const effects: Effect[] = [this.sharpen, this.lens];
    if (this.bloom) effects.push(this.bloom);
    effects.push(tone, this.grade, this.vignette, grain);
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    if (q.smaa) this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
    else if (q.fxaa) this.composer.addPass(new EffectPass(this.camera, new FXAAEffect()));
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    // Sharpen harder the more the browser will stretch this frame (screen px per drawn px).
    const up = (globalThis.devicePixelRatio || 1) / Math.max(0.25, this.renderer.getPixelRatio());
    this.sharpen.uniforms.get('sharpness')!.value = Math.min(1, this.sharpenBase + 0.35 * Math.min(1.5, Math.max(0, up - 1)));
    for (const e of [this.blur, this.shafts, this.lens]) if (e) e.uniforms.get('aspectRatio')!.value = w / h;
  }

  apply(p: PostParams): void {
    const cam = this.camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    if (!this.hasPrev) this.prevVP.copy(this.vp);
    this.invVP.copy(this.vp).invert();
    if (this.blur && this.blurPass) {
      const u = this.blur.uniforms;
      const motion = p.motion ?? 1;
      // Clarity: blur is a speed accent for the top of the run only. `speed` is ~0.3 at 2× and
      // ~0.57 at 7×, so the rush is exactly 0 through 1–7× (the pass is skipped outright), eases in
      // from ~8× and peaks past 30×. It never runs in the setup or cinematic shots. Portrait screens
      // put the walls right at the frame edges, so they get half of it.
      const x = Math.min(1, Math.max(0, (p.speed - 0.6) / 0.3));
      const rush = x * x * (3 - 2 * x) * motion;
      const portrait = cam.aspect < 1 ? 0.5 : 1;
      this.blurPass.enabled = rush > 0.002;
      u.get('protectPos')!.value.copy(p.runnerScreen);
      if (p.runnerSize) u.get('protectSize')!.value.copy(p.runnerSize);
      u.get('fringe')!.value = 0.02 + rush * 0.04;
      if (this.cameraBlur) {
        // Shutter in seconds: up to ~1/40 s at full tilt (was 1/60 s even standing still).
        const shutter = 0.025 * rush * portrait;
        u.get('shutterScale')!.value = shutter / Math.max(1 / 240, p.dt ?? 1 / 60);
        u.get('radial')!.value = rush * 0.035 * portrait;
        u.get('maxLen')!.value = (0.01 + 0.04 * rush) * portrait;
        u.get('invViewProj')!.value.copy(this.invVP);
        u.get('prevViewProj')!.value.copy(this.prevVP);
      } else {
        u.get('radial')!.value = rush * 0.05 * portrait;
        u.get('maxLen')!.value = 0.04 * portrait;
      }
    }
    if (this.ssr) {
      const u = this.ssr.uniforms;
      u.get('invViewProj')!.value.copy(this.invVP);
      u.get('viewProj')!.value.copy(this.vp);
      u.get('camPos')!.value.setFromMatrixPosition(cam.matrixWorld);
      u.get('waterTime')!.value = p.time ?? 0;
    }
    this.prevVP.copy(this.vp);
    this.hasPrev = true;
    const g = this.grade.uniforms;
    g.get('danger')!.value = p.danger;
    g.get('cold')!.value = p.cold;
    g.get('gold')!.value = p.gold;
    g.get('flash')!.value = p.flash;
    g.get('fade')!.value = p.fade;
    if (this.bloom) this.bloom.intensity = BLOOM + 0.5 * p.bloomBoost;
    this.vignette.darkness = 0.5 + p.speed * 0.2 + p.cold * 0.25;
    if (this.lens) this.lens.uniforms.get('exposure')!.value = EXPOSURE * (1 - 0.12 * p.cold);
  }

  /** Place the shafts and the flare on the sun disc (found by name in the scene), fading as it leaves the frame. */
  private updateSun(): void {
    this.sun ??= this.scene.getObjectByName('sunDisc') ?? null;
    if (!this.sun) {
      if (this.shafts) this.shafts.uniforms.get('strength')!.value = 0;
      if (this.lens) this.lens.uniforms.get('sunOn')!.value = 0;
      return;
    }
    const cam = this.camera as THREE.PerspectiveCamera;
    this.sunV.setFromMatrixPosition(this.sun.matrixWorld).project(cam);
    const behind = this.sunV.z > 1;
    const x = this.sunV.x * 0.5 + 0.5;
    const y = this.sunV.y * 0.5 + 0.5;
    const off = Math.max(0, Math.max(Math.abs(x - 0.5), Math.abs(y - 0.5)) - 0.5);
    if (this.shafts) {
      const u = this.shafts.uniforms;
      u.get('sunPos')!.value.set(x, y);
      u.get('strength')!.value = behind ? 0 : 1.0 * Math.max(0, 1 - off * 1.6);
    }
    if (this.lens) {
      const u = this.lens.uniforms;
      u.get('sunPos')!.value.set(x, y);
      // The flare lives only while the disc is in (or just grazing) the frame.
      const inside = Math.max(0, 1 - off * 12);
      u.get('sunOn')!.value = behind || !this.flareOn ? 0 : inside;
    }
  }

  render(dt: number): void {
    this.updateSun();
    if (this.ao) {
      const pm = (this.camera as THREE.PerspectiveCamera).projectionMatrix.elements;
      this.ao.uniforms.get('projInfo')!.value.set(1 / pm[0]!, 1 / pm[5]!);
    }
    this.composer.render(dt);
  }
}
