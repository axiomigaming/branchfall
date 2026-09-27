import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { QualityProfile } from '../config/quality';

/**
 * Zoom blur from the vanishing point, the signature of the references: the
 * periphery streaks, the centre of the path and the runner stay sharp. A touch
 * of chromatic fringing rides along at the edges.
 */
class SpeedBlurEffect extends Effect {
  constructor(samples: number) {
    super(
      'SpeedBlur',
      /* glsl */ `
      uniform float strength;
      uniform vec2 center;
      uniform vec2 protectPos;
      uniform vec2 protectSize;
      uniform float aspectRatio;
      uniform float fringe;
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec2 d = uv - center;
        float r = length(vec2(d.x * aspectRatio, d.y));
        float mask = smoothstep(0.24, 0.85, r);
        vec2 q = (uv - protectPos) / protectSize;
        mask *= smoothstep(0.75, 1.35, length(q));
        float amt = strength * mask;
        if (amt < 0.002) { outputColor = inputColor; return; }
        vec3 acc = vec3(0.0);
        float w = 0.0;
        float jitter = ign(gl_FragCoord.xy);
        for (int i = 0; i < ${samples}; i++) {
          float t = (float(i) + jitter) / float(${samples});
          float k = 1.0 - t * 0.55;
          vec2 o = uv - d * t * amt;
          vec3 c;
          c.r = texture2D(inputBuffer, o - d * fringe * amt).r;
          c.g = texture2D(inputBuffer, o).g;
          c.b = texture2D(inputBuffer, o + d * fringe * amt).b;
          acc += c * k;
          w += k;
        }
        outputColor = vec4(acc / w, inputColor.a);
      }`,
      {
        attributes: EffectAttribute.CONVOLUTION,
        uniforms: new Map<string, THREE.Uniform>([
          ['strength', new THREE.Uniform(0)],
          ['center', new THREE.Uniform(new THREE.Vector2(0.5, 0.58))],
          ['protectPos', new THREE.Uniform(new THREE.Vector2(0.5, 0.3))],
          ['protectSize', new THREE.Uniform(new THREE.Vector2(0.14, 0.3))],
          ['aspectRatio', new THREE.Uniform(1.6)],
          ['fringe', new THREE.Uniform(0.08)],
        ]),
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
        c = (c - 0.5) * (contrast + danger * 0.12 + cold * 0.1) + 0.5;
        c *= tint;
        // Danger: embers in the highlights, a clamp in the shadows.
        c = mix(c, c * vec3(1.12, 0.92, 0.8), danger * 0.55);
        // Fall: blue-grey and heavy.
        c = mix(c, c * vec3(0.78, 0.86, 1.0) * 0.8, cold);
        // Escape: honey light.
        c = mix(c, c * vec3(1.12, 1.02, 0.82) + vec3(0.05, 0.035, 0.0), gold);
        c += vec3(1.0, 0.92, 0.78) * flash;
        c = mix(c, vec3(0.03, 0.025, 0.02), fade);
        outputColor = vec4(max(c, 0.0), inputColor.a);
      }`,
      {
        uniforms: new Map<string, THREE.Uniform>([
          ['saturation', new THREE.Uniform(1.1)],
          ['contrast', new THREE.Uniform(1.06)],
          ['tint', new THREE.Uniform(new THREE.Vector3(1.03, 1.0, 0.95))],
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
  danger: number;
  cold: number;
  gold: number;
  flash: number;
  fade: number;
  bloomBoost: number;
}

export class Post {
  readonly composer: EffectComposer;
  private blur: SpeedBlurEffect | null = null;
  private grade = new GradeEffect();
  private bloom: BloomEffect | null = null;
  private vignette = new VignetteEffect({ offset: 0.28, darkness: 0.55 });
  private renderPass: RenderPass;

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
    this.blur = q.speedBlur ? new SpeedBlurEffect(q.bloom ? 12 : 7) : null;
    if (this.blur) this.composer.addPass(new EffectPass(this.camera, this.blur));
    this.bloom = q.bloom ? new BloomEffect({ mipmapBlur: true, luminanceThreshold: 0.82, luminanceSmoothing: 0.25, intensity: 0.85, radius: 0.72 }) : null;
    const tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    grain.blendMode.opacity.value = 0.035;
    const effects: Effect[] = [];
    if (this.bloom) effects.push(this.bloom);
    effects.push(tone, this.grade, this.vignette, grain);
    this.composer.addPass(new EffectPass(this.camera, ...effects));
    if (q.smaa) this.composer.addPass(new EffectPass(this.camera, new SMAAEffect()));
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    if (this.blur) this.blur.uniforms.get('aspectRatio')!.value = w / h;
  }

  apply(p: PostParams): void {
    if (this.blur) {
      const u = this.blur.uniforms;
      u.get('strength')!.value = p.speed * 0.105;
      u.get('protectPos')!.value.copy(p.runnerScreen);
      u.get('fringe')!.value = 0.05 + p.speed * 0.08;
    }
    const g = this.grade.uniforms;
    g.get('danger')!.value = p.danger;
    g.get('cold')!.value = p.cold;
    g.get('gold')!.value = p.gold;
    g.get('flash')!.value = p.flash;
    g.get('fade')!.value = p.fade;
    if (this.bloom) this.bloom.intensity = 0.85 + p.bloomBoost;
    this.vignette.darkness = 0.5 + p.speed * 0.2 + p.cold * 0.25;
  }

  render(dt: number): void {
    this.composer.render(dt);
  }
}
