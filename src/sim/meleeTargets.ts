import { WEAPONS, type WeaponId } from '../config';
import { angleDiff, yawFromDir } from '../core/math';
import type { World } from './world';

/** Shared body-first eligibility for the actual swing and the Counter prompt. */
export function meleeCandidates(w: World, weapon: WeaponId, yaw: number, reach: number) {
  const p = w.player;
  const half = WEAPONS[weapon].arcDeg * Math.PI / 360;
  return w.enemies.filter(e => {
    if (!e.alive || e.y > 2) return false;
    const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
    if (d > reach + e.radius) return false;
    if (Math.abs(angleDiff(yawFromDir(dx, dz), yaw)) > half && d > e.radius + .25) return false;
    const block = w.grid.segmentHit({x:p.x,y:1.4,z:p.z}, {x:e.x,y:e.y+1.1,z:e.z});
    return !block || block.t >= .95;
  }).sort((a,b) => (Math.hypot(a.x-p.x,a.z-p.z)-a.radius) - (Math.hypot(b.x-p.x,b.z-p.z)-b.radius) || a.id-b.id);
}
