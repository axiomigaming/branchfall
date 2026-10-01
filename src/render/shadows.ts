import * as THREE from 'three';

let installed = false;

/**
 * The sun's shadow map is a tight box that follows the runner. three ends a shadow abruptly where
 * that box ends, which draws a hard line across the causeway ahead (wall shadows that stop dead).
 * This fades the PCF shadow out over the outer `edge` of the box instead. Patches the shared shader
 * chunk once, before any program is compiled; a no-op if three's chunk no longer matches.
 */
export function installShadowEdgeFade(edge = 0.12): void {
  if (installed) return;
  installed = true;
  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const pcf = chunk.indexOf('float getShadow( sampler2DShadow');
  const ret = 'return mix( 1.0, shadow, shadowIntensity );';
  const at = pcf < 0 ? -1 : chunk.indexOf(ret, pcf);
  if (at < 0) return;
  const faded = `vec2 shadowEdge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );
			return mix( 1.0, shadow, shadowIntensity * smoothstep( 0.0, ${edge.toFixed(3)}, min( shadowEdge.x, shadowEdge.y ) ) );`;
  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.slice(0, at) + faded + chunk.slice(at + ret.length);
}
