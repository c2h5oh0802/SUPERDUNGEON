import { PLAYER } from '../config';
import { dirFromYawPitch, type V3 } from '../core/math';
import type { World } from './world';

/** Evidence must be in the player's current camera view and not behind geometry
 * or smoke. Presentation supplies viewport FOV/aspect; no renderer is required
 * for deterministic simulation tests. Camera shake is deliberately cosmetic. */
export function observesPoint(w: World, at: V3): boolean {
  const p = w.player;
  if (p.dead) return false;
  const eye = { x: p.x, y: PLAYER.eyeHeight, z: p.z };
  const dx = at.x - eye.x, dy = at.y - eye.y, dz = at.z - eye.z;
  const f = dirFromYawPitch(p.yaw, p.pitch);
  const depth = dx * f.x + dy * f.y + dz * f.z;
  if (depth <= .01 || depth > 90) return false;
  const right = dx * Math.cos(p.yaw) - dz * Math.sin(p.yaw);
  const up = dx * Math.sin(p.yaw) * Math.sin(p.pitch) + dy * Math.cos(p.pitch) + dz * Math.cos(p.yaw) * Math.sin(p.pitch);
  const halfHeight = depth * Math.tan(w.viewFov * Math.PI / 360);
  if (Math.abs(up) > halfHeight || Math.abs(right) > halfHeight * w.viewAspect) return false;
  // Stop just short of the impact surface so a visible wall/floor does not
  // occlude its own splash. Intervening geometry still blocks the segment.
  const length = Math.hypot(dx, dy, dz);
  const t = Math.max(0, 1 - .02 / length);
  return w.canSee(eye, { x: eye.x + dx * t, y: eye.y + dy * t, z: eye.z + dz * t });
}
