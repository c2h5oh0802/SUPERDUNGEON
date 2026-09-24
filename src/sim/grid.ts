import { WORLD } from '../config';
import type { V3 } from '../core/math';

// 1 m 碰撞格。格子 (i, j) 覆蓋 x ∈ [i, i+1)、z ∈ [j, j+1)。

export const T = {
  Void: 0,
  Floor: 1,
  Wall: 2,
  Low: 3,
  Platform: 4,
  Door: 5,
  Stairs: 6,
} as const;
export type TileId = (typeof T)[keyof typeof T];

export interface Pillar {
  x: number;
  z: number;
  r: number;
  /** 高度：石柱到天花板；寶箱、祭壇等較矮，可越過它們看見或射擊。 */
  h: number;
  kind: 'pillar' | 'prop';
}

export interface DoorState {
  id: number;
  cells: Array<[number, number]>;
  /** 門所在牆線的方向：'x' 表示門沿 x 軸延伸（開口朝 ±z）。 */
  axis: 'x' | 'z';
  /** 0 = 關閉，1 = 完全打開。 */
  progress: number;
  /** 目標狀態。 */
  target: 0 | 1;
  /** 單向門：未拉開門閂前無法從外側打開。 */
  barred: boolean;
  /** 可以拉開門閂的一側（相對門中心的法線方向符號）。 */
  barSide: -1 | 1;
  /** 拱門：沒有門板、永遠打開。 */
  arch: boolean;
  cx: number;
  cz: number;
}

export interface SegHit {
  t: number;
  x: number;
  y: number;
  z: number;
  kind: 'wall' | 'floor' | 'ceiling' | 'pillar' | 'door' | 'low';
}

const SOLID_HEIGHT = 1e6;

export class Grid {
  readonly w: number;
  readonly h: number;
  readonly tiles: Uint8Array;
  readonly doorIndex: Int16Array;
  readonly pillars: Pillar[] = [];
  readonly doors: DoorState[] = [];
  private pillarCells = new Map<number, number[]>();

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    this.tiles = new Uint8Array(w * h);
    this.doorIndex = new Int16Array(w * h).fill(-1);
  }

  inBounds(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.w && j < this.h;
  }

  get(i: number, j: number): TileId {
    if (!this.inBounds(i, j)) return T.Void;
    return this.tiles[j * this.w + i] as TileId;
  }

  set(i: number, j: number, t: TileId): void {
    if (this.inBounds(i, j)) this.tiles[j * this.w + i] = t;
  }

  addPillar(p: Pillar): void {
    const idx = this.pillars.length;
    this.pillars.push(p);
    for (let j = Math.floor(p.z - p.r); j <= Math.floor(p.z + p.r); j++) {
      for (let i = Math.floor(p.x - p.r); i <= Math.floor(p.x + p.r); i++) {
        const key = j * this.w + i;
        const list = this.pillarCells.get(key);
        if (list) list.push(idx);
        else this.pillarCells.set(key, [idx]);
      }
    }
  }

  pillarsIn(i: number, j: number): number[] | undefined {
    return this.pillarCells.get(j * this.w + i);
  }

  addDoor(d: DoorState): void {
    this.doors.push(d);
    for (const [i, j] of d.cells) {
      this.set(i, j, T.Door);
      this.doorIndex[j * this.w + i] = d.id;
    }
  }

  doorAt(i: number, j: number): DoorState | undefined {
    if (!this.inBounds(i, j)) return undefined;
    const id = this.doorIndex[j * this.w + i]!;
    return id >= 0 ? this.doors[id] : undefined;
  }

  /** 角色能否站在此格（門只在完全打開時可通行）。 */
  walkBlocked(i: number, j: number): boolean {
    const t = this.get(i, j);
    if (t === T.Floor) return false;
    if (t === T.Door) {
      const d = this.doorAt(i, j)!;
      return d.progress < 0.999;
    }
    return true;
  }

  /** 靜態可通行（門視為可通行），供導航與生成驗證。 */
  staticWalkable(i: number, j: number): boolean {
    const t = this.get(i, j);
    return t === T.Floor || t === T.Door;
  }

  /** 從地面往上的實心高度。 */
  solidHeight(i: number, j: number): number {
    switch (this.get(i, j)) {
      case T.Floor:
      case T.Door:
        return 0;
      case T.Low:
        return WORLD.lowWallHeight;
      case T.Platform:
        return WORLD.platformHeight;
      default:
        return SOLID_HEIGHT;
    }
  }

  /** 門格：高於此高度的部分被門板或門楣擋住。其他格回傳 +∞。 */
  doorBottom(i: number, j: number, forSight: boolean): number {
    const d = this.doorAt(i, j);
    if (!d) return SOLID_HEIGHT;
    if (forSight && d.progress < 0.6) return -1;
    return d.progress * WORLD.doorHeight;
  }

  // ---------- 圓形角色碰撞 ----------

  /** 將圓推出實心格與柱子。回傳修正後位置。 */
  resolveCircle(x: number, z: number, r: number): { x: number; z: number } {
    for (let iter = 0; iter < 4; iter++) {
      let moved = false;
      const i0 = Math.floor(x - r);
      const i1 = Math.floor(x + r);
      const j0 = Math.floor(z - r);
      const j1 = Math.floor(z + r);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (!this.walkBlocked(i, j)) continue;
          const cx = Math.max(i, Math.min(x, i + 1));
          const cz = Math.max(j, Math.min(z, j + 1));
          let dx = x - cx;
          let dz = z - cz;
          let d = Math.sqrt(dx * dx + dz * dz);
          if (d >= r) continue;
          if (d < 1e-6) {
            // 圓心在格內：推向最近的邊
            const left = x - i;
            const right = i + 1 - x;
            const top = z - j;
            const bottom = j + 1 - z;
            const m = Math.min(left, right, top, bottom);
            if (m === left) x = i - r;
            else if (m === right) x = i + 1 + r;
            else if (m === top) z = j - r;
            else z = j + 1 + r;
            moved = true;
            continue;
          }
          dx /= d;
          dz /= d;
          const push = r - d;
          x += dx * push;
          z += dz * push;
          d = r;
          moved = true;
        }
      }
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const list = this.pillarsIn(i, j);
          if (!list) continue;
          for (const pi of list) {
            const p = this.pillars[pi]!;
            const dx = x - p.x;
            const dz = z - p.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            const min = r + p.r;
            if (d < min && d > 1e-6) {
              x = p.x + (dx / d) * min;
              z = p.z + (dz / d) * min;
              moved = true;
            }
          }
        }
      }
      if (!moved) break;
    }
    return { x, z };
  }

  /** 圓是否與實心格或柱子重疊。 */
  circleBlocked(x: number, z: number, r: number): boolean {
    const i0 = Math.floor(x - r);
    const i1 = Math.floor(x + r);
    const j0 = Math.floor(z - r);
    const j1 = Math.floor(z + r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (this.walkBlocked(i, j)) {
          const cx = Math.max(i, Math.min(x, i + 1));
          const cz = Math.max(j, Math.min(z, j + 1));
          const dx = x - cx;
          const dz = z - cz;
          if (dx * dx + dz * dz < r * r - 1e-6) return true;
        }
        const list = this.pillarsIn(i, j);
        if (list) {
          for (const pi of list) {
            const p = this.pillars[pi]!;
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz < (r + p.r) * (r + p.r) - 1e-6) return true;
          }
        }
      }
    }
    return false;
  }

  // ---------- 3D 線段檢測 ----------

  /**
   * 線段 a→b 與地形（地板、天花板、牆、矮牆、高台、門、柱子）的第一個交點。
   * forSight：視線模式（門開不到 60% 視為完全遮擋）。
   * radius：柱子的額外半徑（投射物半徑）。
   */
  segmentHit(a: V3, b: V3, forSight = false, radius = 0): SegHit | null {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    let best: SegHit | null = null;

    // 地板與天花板
    if (dy < 0 && b.y < 0) {
      const t = a.y / -dy;
      if (t >= 0 && t <= 1) best = this.mk(a, dx, dy, dz, t, 'floor');
    }
    if (dy > 0 && b.y > WORLD.wallHeight) {
      const t = (WORLD.wallHeight - a.y) / dy;
      if (t >= 0 && t <= 1 && (!best || t < best.t)) best = this.mk(a, dx, dy, dz, t, 'ceiling');
    }

    // 2D DDA
    let i = Math.floor(a.x);
    let j = Math.floor(a.z);
    const iEnd = Math.floor(b.x);
    const jEnd = Math.floor(b.z);
    const stepI = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    const stepJ = dz > 0 ? 1 : dz < 0 ? -1 : 0;
    const tDeltaX = stepI !== 0 ? Math.abs(1 / dx) : Infinity;
    const tDeltaZ = stepJ !== 0 ? Math.abs(1 / dz) : Infinity;
    let tMaxX = stepI > 0 ? (i + 1 - a.x) / dx : stepI < 0 ? (a.x - i) / -dx : Infinity;
    let tMaxZ = stepJ > 0 ? (j + 1 - a.z) / dz : stepJ < 0 ? (a.z - j) / -dz : Infinity;
    let t0 = 0;
    const visited = new Set<number>();
    for (let guard = 0; guard < 4096; guard++) {
      const t1 = Math.min(tMaxX, tMaxZ, 1);
      if (best && t0 > best.t) break;
      const cellHit = this.cellInterval(a, dx, dy, dz, i, j, t0, t1, forSight);
      if (cellHit && (!best || cellHit.t < best.t)) best = cellHit;
      // 柱子
      const list = this.pillarsIn(i, j);
      if (list) {
        for (const pi of list) {
          if (visited.has(pi)) continue;
          visited.add(pi);
          const p = this.pillars[pi]!;
          const t = segCircle2(a.x, a.z, dx, dz, p.x, p.z, p.r + radius);
          if (t >= 0 && (!best || t < best.t)) {
            const y = a.y + dy * t;
            if (y >= 0 && y <= p.h) best = this.mk(a, dx, dy, dz, t, 'pillar');
          }
        }
      }
      if (t1 >= 1 || (i === iEnd && j === jEnd)) break;
      if (tMaxX < tMaxZ) {
        i += stepI;
        t0 = tMaxX;
        tMaxX += tDeltaX;
      } else {
        j += stepJ;
        t0 = tMaxZ;
        tMaxZ += tDeltaZ;
      }
    }
    return best;
  }

  private cellInterval(
    a: V3,
    dx: number,
    dy: number,
    dz: number,
    i: number,
    j: number,
    t0: number,
    t1: number,
    forSight: boolean,
  ): SegHit | null {
    const tile = this.get(i, j);
    if (tile === T.Floor) return null;
    const y0 = a.y + dy * t0;
    const y1 = a.y + dy * t1;
    if (tile === T.Door) {
      const bottom = this.doorBottom(i, j, forSight);
      // 門板／門楣佔據 y > bottom
      if (y0 > bottom) return this.mk(a, dx, dy, dz, t0, 'door');
      if (y1 > bottom && dy !== 0) {
        const t = t0 + (bottom - y0) / dy;
        return this.mk(a, dx, dy, dz, Math.max(t0, t), 'door');
      }
      return null;
    }
    const h = this.solidHeight(i, j);
    if (y0 < h) return this.mk(a, dx, dy, dz, t0, h >= SOLID_HEIGHT ? 'wall' : 'low');
    if (y1 < h && dy !== 0) {
      const t = t0 + (h - y0) / dy;
      return this.mk(a, dx, dy, dz, Math.max(t0, t), 'low');
    }
    return null;
  }

  private mk(a: V3, dx: number, dy: number, dz: number, t: number, kind: SegHit['kind']): SegHit {
    return { t, x: a.x + dx * t, y: a.y + dy * t, z: a.z + dz * t, kind };
  }

  /** 3D 視線（不含煙霧、角色）。 */
  lineOfSight(a: V3, b: V3): boolean {
    return this.segmentHit(a, b, true) === null;
  }

  /** 以 2D 方式判斷視線可否通過（牆、關閉的門、柱子擋；矮牆與高台不擋）。供地圖探索。 */
  sightBlocked2D(i: number, j: number): boolean {
    const t = this.get(i, j);
    if (t === T.Floor || t === T.Low || t === T.Platform) return false;
    if (t === T.Door) return this.doorAt(i, j)!.progress < 0.6;
    return true;
  }
}

/** 2D 線段（起點 a、位移 d）與圓第一次接觸的參數 t（0..1），否則 -1。 */
export function segCircle2(ax: number, az: number, dx: number, dz: number, cx: number, cz: number, r: number): number {
  const fx = ax - cx;
  const fz = az - cz;
  const A = dx * dx + dz * dz;
  const C = fx * fx + fz * fz - r * r;
  if (C <= 0) return 0;
  if (A < 1e-12) return -1;
  const B = 2 * (fx * dx + fz * dz);
  const disc = B * B - 4 * A * C;
  if (disc < 0) return -1;
  const t = (-B - Math.sqrt(disc)) / (2 * A);
  return t >= 0 && t <= 1 ? t : -1;
}
