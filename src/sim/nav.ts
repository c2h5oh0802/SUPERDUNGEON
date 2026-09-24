import type { V2 } from '../core/math';
import { Grid } from './grid';

// 0.5 m 導航格。每個格心需與靜態幾何保持 ≥ radius 的間隙（依角色半徑擴張）。
// 門視為可通行（敵人會開門），但拉上門閂的單向門不可通行。

const SQRT2 = Math.SQRT2;

class MinHeap {
  private items: number[] = [];
  private prio: number[] = [];
  get size(): number {
    return this.items.length;
  }
  push(item: number, p: number): void {
    this.items.push(item);
    this.prio.push(p);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent]! <= this.prio[i]!) break;
      this.swap(i, parent);
      i = parent;
    }
  }
  pop(): number {
    const top = this.items[0]!;
    const lastI = this.items.pop()!;
    const lastP = this.prio.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastI;
      this.prio[0] = lastP;
      let i = 0;
      const n = this.items.length;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < n && this.prio[l]! < this.prio[m]!) m = l;
        if (r < n && this.prio[r]! < this.prio[m]!) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    const ti = this.items[a]!;
    this.items[a] = this.items[b]!;
    this.items[b] = ti;
    const tp = this.prio[a]!;
    this.prio[a] = this.prio[b]!;
    this.prio[b] = tp;
  }
}

export class Nav {
  readonly res = 0.5;
  readonly w: number;
  readonly h: number;
  readonly radius: number;
  readonly open: Uint8Array;
  readonly doorOf: Int16Array;
  private readonly grid: Grid;
  private gScore: Float32Array;
  private came: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private stampId = 1;

  constructor(grid: Grid, radius: number) {
    this.grid = grid;
    this.radius = radius;
    this.w = grid.w * 2;
    this.h = grid.h * 2;
    const n = this.w * this.h;
    this.open = new Uint8Array(n);
    this.doorOf = new Int16Array(n).fill(-1);
    this.gScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const x = (i + 0.5) * this.res;
        const z = (j + 0.5) * this.res;
        const idx = j * this.w + i;
        this.open[idx] = this.staticClear(x, z, radius) ? 1 : 0;
        // 此導航格覆蓋的門（半徑範圍內）
        const r = radius;
        for (let cj = Math.floor(z - r); cj <= Math.floor(z + r) && this.doorOf[idx] === -1; cj++) {
          for (let ci = Math.floor(x - r); ci <= Math.floor(x + r); ci++) {
            const d = grid.doorAt(ci, cj);
            if (d) {
              this.doorOf[idx] = d.id;
              break;
            }
          }
        }
      }
    }
  }

  private staticClear(x: number, z: number, r: number): boolean {
    const g = this.grid;
    const i0 = Math.floor(x - r);
    const i1 = Math.floor(x + r);
    const j0 = Math.floor(z - r);
    const j1 = Math.floor(z + r);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (!g.staticWalkable(i, j)) {
          const cx = Math.max(i, Math.min(x, i + 1));
          const cz = Math.max(j, Math.min(z, j + 1));
          const dx = x - cx;
          const dz = z - cz;
          if (dx * dx + dz * dz < r * r) return false;
        }
        const list = g.pillarsIn(i, j);
        if (list) {
          for (const pi of list) {
            const p = g.pillars[pi]!;
            const dx = x - p.x;
            const dz = z - p.z;
            if (dx * dx + dz * dz < (r + p.r) * (r + p.r)) return false;
          }
        }
      }
    }
    return true;
  }

  cellOf(x: number, z: number): number {
    const i = Math.floor(x / this.res);
    const j = Math.floor(z / this.res);
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return -1;
    return j * this.w + i;
  }

  passable(idx: number, ignoreBars = false): boolean {
    if (idx < 0 || this.open[idx] === 0) return false;
    const d = this.doorOf[idx]!;
    if (d >= 0 && !ignoreBars && this.grid.doors[d]!.barred) return false;
    return true;
  }

  center(idx: number): V2 {
    return { x: ((idx % this.w) + 0.5) * this.res, z: (Math.floor(idx / this.w) + 0.5) * this.res };
  }

  /** 最近的可通行導航格（螺旋搜尋）。 */
  nearestPassable(x: number, z: number, maxRing = 6): number {
    const c = this.cellOf(x, z);
    if (this.passable(c)) return c;
    const ci = Math.floor(x / this.res);
    const cj = Math.floor(z / this.res);
    let best = -1;
    let bestD = Infinity;
    for (let ring = 1; ring <= maxRing; ring++) {
      for (let dj = -ring; dj <= ring; dj++) {
        for (let di = -ring; di <= ring; di++) {
          if (Math.abs(di) !== ring && Math.abs(dj) !== ring) continue;
          const i = ci + di;
          const j = cj + dj;
          if (i < 0 || j < 0 || i >= this.w || j >= this.h) continue;
          const idx = j * this.w + i;
          if (!this.passable(idx)) continue;
          const d = di * di + dj * dj;
          if (d < bestD) {
            bestD = d;
            best = idx;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  /** A*；回傳平滑後的路徑點（不含起點）。 */
  findPath(sx: number, sz: number, tx: number, tz: number, ignoreBars = false, maxExpand = 40000): V2[] | null {
    const start = this.nearestPassable(sx, sz);
    const goal = this.nearestPassable(tx, tz);
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: tx, z: tz }];
    const w = this.w;
    const gi = goal % w;
    const gj = Math.floor(goal / w);
    this.stampId++;
    const stamp = this.stampId;
    const heap = new MinHeap();
    this.stamp[start] = stamp;
    this.gScore[start] = 0;
    this.came[start] = -1;
    heap.push(start, 0);
    let found = false;
    let expanded = 0;
    while (heap.size > 0) {
      const cur = heap.pop();
      if (this.closed[cur] === stamp) continue; // 過期的堆積項目
      this.closed[cur] = stamp;
      if (cur === goal) {
        found = true;
        break;
      }
      if (++expanded > maxExpand) break;
      const ci = cur % w;
      const cj = Math.floor(cur / w);
      const g0 = this.gScore[cur]!;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= this.h) continue;
          const n = nj * w + ni;
          if (!this.passable(n, ignoreBars)) continue;
          if (di !== 0 && dj !== 0) {
            if (!this.passable(cj * w + ni, ignoreBars) || !this.passable(nj * w + ci, ignoreBars)) continue;
          }
          const cost = g0 + (di !== 0 && dj !== 0 ? SQRT2 : 1);
          if (this.stamp[n] === stamp && this.gScore[n]! <= cost) continue;
          this.stamp[n] = stamp;
          this.gScore[n] = cost;
          this.came[n] = cur;
          const hx = Math.abs(ni - gi);
          const hz = Math.abs(nj - gj);
          const h = Math.max(hx, hz) + (SQRT2 - 1) * Math.min(hx, hz);
          heap.push(n, cost + h);
        }
      }
    }
    if (!found) return null;
    const cells: number[] = [];
    for (let c = goal; c !== -1; c = this.came[c]!) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.center(c));
    // 終點使用實際目標（若可站立）
    const last = pts[pts.length - 1]!;
    if (this.cellOf(tx, tz) === goal) {
      last.x = tx;
      last.z = tz;
    }
    return this.smooth({ x: sx, z: sz }, pts, ignoreBars);
  }

  /** 路徑距離（導航格步數 × 解析度），不可達回傳 Infinity。 */
  pathLength(sx: number, sz: number, tx: number, tz: number): number {
    const p = this.findPath(sx, sz, tx, tz);
    if (!p) return Infinity;
    let len = 0;
    let px = sx;
    let pz = sz;
    for (const q of p) {
      len += Math.hypot(q.x - px, q.z - pz);
      px = q.x;
      pz = q.z;
    }
    return len;
  }

  lineWalkable(ax: number, az: number, bx: number, bz: number, ignoreBars = false): boolean {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(d / (this.res * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.passable(this.cellOf(ax + (bx - ax) * t, az + (bz - az) * t), ignoreBars)) return false;
    }
    return true;
  }

  private smooth(start: V2, pts: V2[], ignoreBars: boolean): V2[] {
    const out: V2[] = [];
    let anchor = start;
    let i = 0;
    while (i < pts.length) {
      let j = pts.length - 1;
      while (j > i && !this.lineWalkable(anchor.x, anchor.z, pts[j]!.x, pts[j]!.z, ignoreBars)) j--;
      out.push(pts[j]!);
      anchor = pts[j]!;
      i = j + 1;
    }
    return out;
  }

  /** 從起點可達的導航格（洪水填充）。 */
  flood(sx: number, sz: number, ignoreBars = false): Uint8Array {
    const seen = new Uint8Array(this.w * this.h);
    const start = this.nearestPassable(sx, sz);
    if (start < 0) return seen;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const c = stack.pop()!;
      const ci = c % this.w;
      const cj = Math.floor(c / this.w);
      const nb = [
        [ci + 1, cj],
        [ci - 1, cj],
        [ci, cj + 1],
        [ci, cj - 1],
      ];
      for (const [ni, nj] of nb) {
        if (ni! < 0 || nj! < 0 || ni! >= this.w || nj! >= this.h) continue;
        const n = nj! * this.w + ni!;
        if (seen[n] || !this.passable(n, ignoreBars)) continue;
        seen[n] = 1;
        stack.push(n);
      }
    }
    return seen;
  }
}
