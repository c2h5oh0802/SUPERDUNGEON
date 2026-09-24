import { WORLD } from '../config';
import { Grid, T } from '../sim/grid';

// 生成時把火把光烘焙進頂點：暖色光池、藍紫色陰影，加上簡單的頂點 AO。

export interface BakeLight {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  range: number;
}

/** 光線遮擋：牆、矮牆、高台、門楣、柱子（門視為打開，靜態烘焙）。 */
export class Occluder {
  constructor(private grid: Grid) {}

  private heightBlocks(i: number, j: number, y: number): boolean {
    const t = this.grid.get(i, j);
    switch (t) {
      case T.Floor:
        return false;
      case T.Door:
        return y > WORLD.doorHeight;
      case T.Low:
        return y < WORLD.lowWallHeight;
      case T.Platform:
        return y < WORLD.platformHeight;
      default:
        return true;
    }
  }

  blocked(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const dy = by - ay;
    let i = Math.floor(ax);
    let j = Math.floor(az);
    const iEnd = Math.floor(bx);
    const jEnd = Math.floor(bz);
    const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepJ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tdx = stepI !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdz = stepJ !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = stepI > 0 ? (i + 1 - ax) / dx : stepI < 0 ? (ax - i) / -dx : Infinity;
    let tmz = stepJ > 0 ? (j + 1 - az) / dz : stepJ < 0 ? (az - j) / -dz : Infinity;
    let t0 = 0;
    for (let k = 0; k < 64; k++) {
      const t1 = Math.min(tmx, tmz, 1);
      const yMid = ay + dy * ((t0 + t1) * 0.5);
      const yMin = Math.min(ay + dy * t0, ay + dy * t1);
      const yMax = Math.max(ay + dy * t0, ay + dy * t1);
      const tile = this.grid.get(i, j);
      if (tile === T.Door) {
        if (yMax > WORLD.doorHeight) return true;
      } else if (tile === T.Low || tile === T.Platform) {
        if (yMin < (tile === T.Low ? WORLD.lowWallHeight : WORLD.platformHeight) - 0.02) return true;
      } else if (this.heightBlocks(i, j, yMid)) return true;
      const list = this.grid.pillarsIn(i, j);
      if (list) {
        for (const pi of list) {
          const p = this.grid.pillars[pi]!;
          const fx = ax - p.x;
          const fz = az - p.z;
          const A = dx * dx + dz * dz;
          const B = 2 * (fx * dx + fz * dz);
          const C = fx * fx + fz * fz - p.r * p.r;
          const disc = B * B - 4 * A * C;
          if (disc < 0 || A < 1e-9) continue;
          const t = (-B - Math.sqrt(disc)) / (2 * A);
          if (t > 0.001 && t < 0.999 && ay + dy * t < p.h) return true;
        }
      }
      if (t1 >= 1 || (i === iEnd && j === jEnd)) return false;
      if (tmx < tmz) {
        i += stepI;
        t0 = tmx;
        tmx += tdx;
      } else {
        j += stepJ;
        t0 = tmz;
        tmz += tdz;
      }
    }
    return false;
  }
}

export interface AmbientSpec {
  sky: [number, number, number];
  ground: [number, number, number];
}

export function bakeLighting(
  pos: Float32Array,
  nrm: Float32Array,
  ao: Float32Array,
  lights: BakeLight[],
  occ: Occluder,
  ambient: AmbientSpec,
  mapW: number,
  mapH: number,
): Float32Array {
  const out = new Float32Array(pos.length);
  // 光源空間索引（4 m 桶）
  const B = 4;
  const bw = Math.ceil(mapW / B);
  const bh = Math.ceil(mapH / B);
  const buckets: number[][] = Array.from({ length: bw * bh }, () => []);
  lights.forEach((l, k) => {
    const r = l.range;
    for (let bj = Math.max(0, Math.floor((l.z - r) / B)); bj <= Math.min(bh - 1, Math.floor((l.z + r) / B)); bj++)
      for (let bi = Math.max(0, Math.floor((l.x - r) / B)); bi <= Math.min(bw - 1, Math.floor((l.x + r) / B)); bi++) buckets[bj * bw + bi]!.push(k);
  });
  const n = pos.length / 3;
  for (let v = 0; v < n; v++) {
    const px = pos[v * 3]!;
    const py = pos[v * 3 + 1]!;
    const pz = pos[v * 3 + 2]!;
    const nx = nrm[v * 3]!;
    const ny = nrm[v * 3 + 1]!;
    const nz = nrm[v * 3 + 2]!;
    const up = ny * 0.5 + 0.5;
    let r = ambient.ground[0] + (ambient.sky[0] - ambient.ground[0]) * up;
    let g = ambient.ground[1] + (ambient.sky[1] - ambient.ground[1]) * up;
    let b = ambient.ground[2] + (ambient.sky[2] - ambient.ground[2]) * up;
    const bi = Math.min(bw - 1, Math.max(0, Math.floor(px / B)));
    const bj = Math.min(bh - 1, Math.max(0, Math.floor(pz / B)));
    const list = buckets[bj * bw + bi]!;
    const ox = px + nx * 0.07;
    const oy = py + ny * 0.07;
    const oz = pz + nz * 0.07;
    for (const k of list) {
      const l = lights[k]!;
      const lx = l.x - px;
      const ly = l.y - py;
      const lz = l.z - pz;
      const d = Math.sqrt(lx * lx + ly * ly + lz * lz);
      if (d >= l.range) continue;
      const inv = 1 / Math.max(d, 1e-4);
      const ndl = (nx * lx + ny * ly + nz * lz) * inv;
      const wrap = Math.min(1, Math.max(0, (ndl + 0.3) / 1.3));
      if (wrap <= 0) continue;
      const f = 1 - d / l.range;
      const att = (f * f) / (1 + d * d * 0.06);
      const vis = occ.blocked(ox, oy, oz, l.x, l.y, l.z) ? 0.1 : 1;
      const s = wrap * att * vis;
      r += l.r * s;
      g += l.g * s;
      b += l.b * s;
    }
    const a = ao[v]!;
    out[v * 3] = r * a;
    out[v * 3 + 1] = g * a;
    out[v * 3 + 2] = b * a;
  }
  return out;
}
