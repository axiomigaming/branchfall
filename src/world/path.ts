import * as THREE from 'three';

/**
 * The runner's route: a chain of straight and circular-arc segments, sampled by
 * arc length. Yaw 0 runs toward −Z; positive yaw turns left (counter-clockwise
 * seen from above). Straight segments may climb or descend (stairs).
 */
export interface Segment {
  s0: number;
  len: number;
  p0: THREE.Vector3;
  yaw0: number;
  /** Total yaw change across the segment (0 for straight). */
  turn: number;
  /** Elevation change across the segment. */
  dy: number;
}

export interface Frame {
  pos: THREE.Vector3;
  yaw: number;
}

export const forward = (yaw: number, out = new THREE.Vector3()) => out.set(-Math.sin(yaw), 0, -Math.cos(yaw));
export const left = (yaw: number, out = new THREE.Vector3()) => out.set(-Math.cos(yaw), 0, Math.sin(yaw));

export class Path {
  readonly segs: Segment[] = [];
  private end: Frame = { pos: new THREE.Vector3(), yaw: 0 };
  private endS = 0;

  reset(start: Frame): void {
    this.segs.length = 0;
    this.end = { pos: start.pos.clone(), yaw: start.yaw };
    this.endS = 0;
  }

  get length(): number {
    return this.endS;
  }

  get tail(): Frame {
    return { pos: this.end.pos.clone(), yaw: this.end.yaw };
  }

  /** Append a segment at the current end; returns its start frame. */
  push(len: number, turn = 0, dy = 0): Segment {
    const seg: Segment = { s0: this.endS, len, p0: this.end.pos.clone(), yaw0: this.end.yaw, turn, dy };
    this.segs.push(seg);
    const f = evalSeg(seg, len, { pos: new THREE.Vector3(), yaw: 0 });
    this.end = f;
    this.endS += len;
    return seg;
  }

  /** Drop segments that end before `s`, keeping lookups short on long runs. */
  trim(s: number): void {
    while (this.segs.length > 2 && this.segs[1]!.s0 + this.segs[1]!.len < s) this.segs.shift();
  }

  sample(s: number, out: Frame = { pos: new THREE.Vector3(), yaw: 0 }): Frame {
    const segs = this.segs;
    if (segs.length === 0) {
      out.pos.set(0, 0, 0);
      out.yaw = 0;
      return out;
    }
    // Segments are few (a window of the route); a linear scan from the back is fine.
    let seg = segs[0]!;
    for (let i = segs.length - 1; i >= 0; i--) {
      if (segs[i]!.s0 <= s) {
        seg = segs[i]!;
        break;
      }
    }
    return evalSeg(seg, Math.min(Math.max(s - seg.s0, 0), seg.len + 400), out);
  }
}

const _f = new THREE.Vector3();

export function evalSeg(seg: Segment, u: number, out: Frame): Frame {
  const { p0, yaw0, turn, len } = seg;
  const t = Math.min(u, len);
  const extra = u - t; // beyond the end: continue straight
  if (Math.abs(turn) < 1e-5) {
    forward(yaw0, _f);
    out.pos.copy(p0).addScaledVector(_f, u);
    out.pos.y = p0.y + seg.dy * smoothRamp(t / len);
    out.yaw = yaw0;
    return out;
  }
  const k = turn / len;
  const y1 = yaw0 + k * t;
  out.pos.set(p0.x + (Math.cos(y1) - Math.cos(yaw0)) / k, p0.y + seg.dy * (t / len), p0.z - (Math.sin(y1) - Math.sin(yaw0)) / k);
  out.yaw = y1;
  if (extra > 0) out.pos.addScaledVector(forward(y1, _f), extra);
  return out;
}

/** Stairs read better with a gentle ease at each end. */
function smoothRamp(x: number): number {
  const c = Math.min(Math.max(x, 0), 1);
  return c;
}

/** Local-to-world matrix for a frame (origin on the path, −Z forward). */
export function frameMatrix(f: Frame, out = new THREE.Matrix4()): THREE.Matrix4 {
  return out.makeRotationY(f.yaw).setPosition(f.pos);
}
