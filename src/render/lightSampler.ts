import * as THREE from 'three';
import type { BakeLight, Occluder } from './bake';
import type { LightRig } from './materials';

/** 以烘焙光源為動態物件取樣主光方向與顏色，讓角色與場景光一致。 */
export class LightSampler {
  constructor(
    private lights: BakeLight[],
    private occ: Occluder,
  ) {}

  apply(rig: LightRig, x: number, y: number, z: number): void {
    let r = 0;
    let g = 0;
    let b = 0;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (const l of this.lights) {
      const lx = l.x - x;
      const ly = l.y - y;
      const lz = l.z - z;
      const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (d >= l.range) continue;
      const f = 1 - d / l.range;
      const att = (f * f) / (1 + d * d * 0.06);
      if (att < 0.01) continue;
      const vis = this.occ.blocked(x, y, z, l.x, l.y, l.z) ? 0.12 : 1;
      const w = att * vis;
      r += l.r * w;
      g += l.g * w;
      b += l.b * w;
      const lum = (l.r + l.g + l.b) * w;
      dx += (lx / d) * lum;
      dy += (ly / d) * lum;
      dz += (lz / d) * lum;
    }
    const len = Math.hypot(dx, dy, dz);
    const dir = rig.uKeyDir.value as THREE.Vector3;
    if (len > 1e-4) dir.set(dx / len, dy / len + 0.25, dz / len).normalize();
    else dir.set(0.2, 1, 0.3).normalize();
    (rig.uKeyColor.value as THREE.Color).setRGB(Math.min(2, r * 0.75), Math.min(2, g * 0.75), Math.min(2, b * 0.75));
    (rig.uAmbient.value as THREE.Color).setRGB(0.11 + r * 0.12, 0.11 + g * 0.12, 0.2 + b * 0.12);
  }
}
