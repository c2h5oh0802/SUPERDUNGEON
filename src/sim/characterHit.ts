import { ENEMIES } from '../config';
import { segSphere, type V3 } from '../core/math';
import type { Enemy } from './types';

/** Exact entry into a vertical cylinder, clipped in height and along the segment. */
export function segmentCylinder(a: V3, b: V3, x: number, z: number, radius: number, low: number, high: number): number {
  const dx = b.x - a.x, dz = b.z - a.z, dy = b.y - a.y;
  const ox = a.x - x, oz = a.z - z;
  const A = dx * dx + dz * dz;
  const B = 2 * (ox * dx + oz * dz);
  const C = ox * ox + oz * oz - radius * radius;
  let enter = 0, exit = 1;
  if (A < 1e-12) {
    if (C > 0) return -1;
  } else {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return -1;
    const root = Math.sqrt(disc);
    enter = Math.max(enter, (-B - root) / (2 * A));
    exit = Math.min(exit, (-B + root) / (2 * A));
  }
  if (Math.abs(dy) < 1e-12) {
    if (a.y < low || a.y > high) return -1;
  } else {
    const t1 = (low - a.y) / dy, t2 = (high - a.y) / dy;
    enter = Math.max(enter, Math.min(t1, t2));
    exit = Math.min(exit, Math.max(t1, t2));
  }
  return enter <= exit ? enter : -1;
}

/** Same head/body geometry for projectile collision and archer's pre-lock line of fire. */
export function segmentEnemy(a: V3, b: V3, e: Enemy, radius: number): { t: number; head: boolean } | null {
  const spec = ENEMIES[e.kind];
  const hy = e.y + spec.headY;
  const head = segSphere(a, b, { x: e.x, y: hy, z: e.z }, spec.headR + radius);
  const body = segmentCylinder(a, b, e.x, e.z, e.radius + radius, e.y + 0.05, hy - spec.headR * 0.6);
  if (head >= 0 && (body < 0 || head <= body)) return { t: head, head: true };
  return body >= 0 ? { t: body, head: false } : null;
}
