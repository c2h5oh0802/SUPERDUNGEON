import { ENEMIES, PLAYER } from '../config';
import type { V3 } from '../core/math';
import type { World } from './world';

/** 投射物出手與瞄準使用的眼睛高度。 */
export const AIM_EYE_Y = PLAYER.eyeHeight - 0.05;

/** 從眼睛沿視線找瞄準點（地形），讓出手點偏移後仍命中準星。 */
export function aimPoint(w: World, eye: V3, dir: V3): V3 {
  const far = { x: eye.x + dir.x * 60, y: eye.y + dir.y * 60, z: eye.z + dir.z * 60 };
  const hit = w.grid.segmentHit(eye, far);
  const d = hit ? Math.max(2.5, hit.t * 60) : 60;
  return { x: eye.x + dir.x * d, y: eye.y + dir.y * d, z: eye.z + dir.z * d };
}

/**
 * 準星實際對到的點：視線上第一個敵人（取視線最接近其身體軸心處），否則是地形。
 * 用在出手點離眼睛很遠的情況（例如戰士擊開的弩矢），避免視差讓它打不到準星上的敵人。
 */
export function crosshairPoint(w: World, eye: V3, dir: V3): V3 {
  const far = aimPoint(w, eye, dir);
  let best = Math.hypot(far.x - eye.x, far.y - eye.y, far.z - eye.z);
  const a = dir.x * dir.x + dir.z * dir.z;
  if (a > 1e-9) {
    for (const e of w.enemies) {
      if (!e.alive) continue;
      const ox = eye.x - e.x;
      const oz = eye.z - e.z;
      const b = 2 * (ox * dir.x + oz * dir.z);
      const c = ox * ox + oz * oz - e.radius * e.radius;
      if (b * b - 4 * a * c < 0) continue;
      const t = -b / (2 * a);
      if (t <= 0.3 || t >= best) continue;
      const y = eye.y + dir.y * t;
      const spec = ENEMIES[e.kind];
      if (y < e.y || y > e.y + spec.headY + spec.headR) continue;
      best = t;
    }
  }
  return { x: eye.x + dir.x * best, y: eye.y + dir.y * best, z: eye.z + dir.z * best };
}
