export type QualityLevel = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityProfile {
  pixelRatioCap: number;
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  speedBlur: boolean;
  smaa: boolean;
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
}

export const QUALITY: Record<QualityLevel, QualityProfile> = {
  low: { pixelRatioCap: 1, shadows: false, shadowMapSize: 1024, bloom: false, speedBlur: true, smaa: false, foliageDensity: 0.45, sceneryDensity: 0.4, viewDistance: 110, dust: 0.4, waterDetail: 0, godRays: 0, ambientLife: 0.35, ao: 0, minRenderScale: 0.7 },
  medium: { pixelRatioCap: 1.5, shadows: true, shadowMapSize: 1024, bloom: true, speedBlur: true, smaa: false, foliageDensity: 0.7, sceneryDensity: 0.7, viewDistance: 140, dust: 0.7, waterDetail: 1, godRays: 14, ambientLife: 0.6, ao: 0, minRenderScale: 0.7 },
  high: { pixelRatioCap: 2, shadows: true, shadowMapSize: 2048, bloom: true, speedBlur: true, smaa: true, foliageDensity: 1, sceneryDensity: 1, viewDistance: 165, dust: 1, waterDetail: 2, godRays: 22, ambientLife: 1, ao: 10, minRenderScale: 0.75 },
  ultra: { pixelRatioCap: 2.5, shadows: true, shadowMapSize: 4096, bloom: true, speedBlur: true, smaa: true, foliageDensity: 1, sceneryDensity: 1, viewDistance: 200, dust: 1.3, waterDetail: 2, godRays: 30, ambientLife: 1, ao: 14, minRenderScale: 0.8 },
};

/** A first guess before any frame has been timed. The frame-time governor refines it. */
export function detectQuality(): QualityLevel {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || matchMedia('(pointer: coarse)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  if (mobile) return cores >= 8 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}
