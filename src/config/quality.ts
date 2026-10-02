export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  speedBlur: boolean;
  smaa: boolean;
  /** One-pass FXAA where SMAA is off (Low, Medium): no stair-steps on the runner and the bricks. */
  fxaa: boolean;
  foliageDensity: number; // 0..1
  sceneryDensity: number; // 0..1 (islands, far props)
  viewDistance: number; // metres of track kept ahead
  dust: number; // particle budget multiplier
  waterDetail: 0 | 1 | 2;
  /** Sun-shaft samples per pixel; 0 turns the pass off. */
  godRays: number;
  /** Birds, butterflies, falling leaves (0..1). */
  ambientLife: number;
  /** Screen-space ambient occlusion taps per pixel (depth only, no extra draws); 0 turns it off. */
  ao: number;
  /** Floor for dynamic resolution, as a fraction of the pixel-ratio cap (perf). */
  minRenderScale: number;
  /** 'camera': depth-reprojected camera motion blur (true streaks); 'radial': zoom blur only, no depth. */
  motionBlur: 'radial' | 'camera';
  /** Taps per pixel along the blur. */
  blurSamples: number;
  /** Sun glare, starburst and ghosts, occlusion-tested against depth. */
  lensFlare: boolean;
  /** Screen-space reflection march steps on the water; 0 keeps the panorama reflection only. */
  waterReflections: number;
  /** Ground mist lying on the water, as a fog layer (0 = off, 1 = full). */
  mist: number;
  /** Sunlit dust motes around the lens (fraction of the pool). */
  motes: number;
  /** Half-size in metres of the sun's shadow box around the runner (smaller = crisper). */
  shadowExtent: number;
  /**
   * Contrast-adaptive sharpening (0..1) at native resolution. It rises on its own when the frame is
   * drawn below the screen's pixel ratio (tier cap or dynamic resolution) and upscaled.
   */
  sharpen: number;
}

// Clarity: phones are ~3× screens. Low and Medium used to draw at 1× and 1.05× (cap × render-scale
// floor) and let the browser stretch the frame 2–3×, which reads as a blurred image. The caps and
// floors below keep Low at ≥ 1.2× and Medium at ≥ 1.4×; CAS restores the rest. Speed blur
// is off on Low and zoom-only on Medium (see Post).
export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatioCap: 1.5, shadows: false, shadowMapSize: 1024, bloom: false, speedBlur: false, smaa: false, fxaa: true, foliageDensity: 0.45, sceneryDensity: 0.4, viewDistance: 110, dust: 0.4, waterDetail: 0, godRays: 0, ambientLife: 0.35, ao: 0, minRenderScale: 0.8, motionBlur: 'radial', blurSamples: 6, lensFlare: false, waterReflections: 0, mist: 0.6, motes: 0.35, shadowExtent: 22, sharpen: 0.25 },
  medium: { pixelRatioCap: 1.75, shadows: true, shadowMapSize: 2048, bloom: true, speedBlur: true, smaa: false, fxaa: true, foliageDensity: 0.7, sceneryDensity: 0.7, viewDistance: 140, dust: 0.7, waterDetail: 1, godRays: 18, ambientLife: 0.6, ao: 0, minRenderScale: 0.8, motionBlur: 'radial', blurSamples: 6, lensFlare: true, waterReflections: 0, mist: 1, motes: 0.7, shadowExtent: 22, sharpen: 0.2 },
  high: { pixelRatioCap: 2, shadows: true, shadowMapSize: 2048, bloom: true, speedBlur: true, smaa: true, fxaa: false, foliageDensity: 1, sceneryDensity: 1, viewDistance: 165, dust: 1, waterDetail: 2, godRays: 26, ambientLife: 1, ao: 10, minRenderScale: 0.8, motionBlur: 'camera', blurSamples: 12, lensFlare: true, waterReflections: 14, mist: 1, motes: 1, shadowExtent: 22, sharpen: 0.15 },
  ultra: { pixelRatioCap: 2.5, shadows: true, shadowMapSize: 4096, bloom: true, speedBlur: true, smaa: true, fxaa: false, foliageDensity: 1, sceneryDensity: 1, viewDistance: 200, dust: 1.3, waterDetail: 2, godRays: 32, ambientLife: 1, ao: 14, minRenderScale: 0.85, motionBlur: 'camera', blurSamples: 16, lensFlare: true, waterReflections: 22, mist: 1, motes: 1, shadowExtent: 26, sharpen: 0.1 },
};

/** A first guess before any frame has been timed. The frame-time governor refines it. */
export function detectQuality(): QualityLevel {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile) return cores >= 8 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}
