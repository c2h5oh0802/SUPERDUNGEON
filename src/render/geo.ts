import * as THREE from 'three';

// 非索引、平面法線的幾何累積器（烘焙光照需要每個頂點的位置、法線、固有色、AO）。

export type Vec = [number, number, number];

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const tmpC = new THREE.Vector3();

export class GeoBuilder {
  pos: number[] = [];
  nrm: number[] = [];
  alb: number[] = [];
  ao: number[] = [];
  aoFn: ((x: number, y: number, z: number, nx: number, ny: number, nz: number) => number) | null = null;

  get vertexCount(): number {
    return this.pos.length / 3;
  }

  private vert(p: Vec, n: Vec, c: THREE.Color): void {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.alb.push(c.r, c.g, c.b);
    this.ao.push(this.aoFn ? this.aoFn(p[0], p[1], p[2], n[0], n[1], n[2]) : 1);
  }

  /** 三角形：依 hint 法線自動校正繞序。 */
  tri(a: Vec, b: Vec, c: Vec, color: THREE.Color, hint?: Vec): void {
    tmpA.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    tmpB.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    tmpC.crossVectors(tmpA, tmpB);
    const len = tmpC.length();
    if (len < 1e-10) return;
    tmpC.multiplyScalar(1 / len);
    if (hint && tmpC.x * hint[0] + tmpC.y * hint[1] + tmpC.z * hint[2] < 0) {
      const t = b;
      b = c;
      c = t;
      tmpC.multiplyScalar(-1);
    }
    const n: Vec = [tmpC.x, tmpC.y, tmpC.z];
    this.vert(a, n, color);
    this.vert(b, n, color);
    this.vert(c, n, color);
  }

  quad(a: Vec, b: Vec, c: Vec, d: Vec, color: THREE.Color, hint: Vec): void {
    this.tri(a, b, c, color, hint);
    this.tri(a, c, d, color, hint);
  }

  /** 軸對齊方塊（只建出 faces 指定的面；預設六面）。 */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, color: THREE.Color, skipBottom = true): void {
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], color, [0, 1, 0]);
    if (!skipBottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], color, [0, -1, 0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], color, [0, 0, -1]);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], color, [0, 0, 1]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], color, [-1, 0, 0]);
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], color, [1, 0, 0]);
  }

  /**
   * 牆面上的倒角石塊。O：面左下角、U：沿牆方向、N：面外法線。
   * 石塊在 (u0..u1, v0..v1)，突出 depth，倒角 bevel。
   */
  wallBlock(O: Vec, U: Vec, N: Vec, u0: number, u1: number, v0: number, v1: number, depth: number, bevel: number, color: THREE.Color): void {
    const P = (u: number, v: number, d: number): Vec => [O[0] + U[0] * u + N[0] * d, O[1] + v, O[2] + U[2] * u + N[2] * d];
    const b = Math.min(bevel, (u1 - u0) * 0.3, (v1 - v0) * 0.3);
    const back = Math.max(0, depth - b);
    const f0 = P(u0 + b, v0 + b, depth);
    const f1 = P(u1 - b, v0 + b, depth);
    const f2 = P(u1 - b, v1 - b, depth);
    const f3 = P(u0 + b, v1 - b, depth);
    const b0 = P(u0, v0, back);
    const b1 = P(u1, v0, back);
    const b2 = P(u1, v1, back);
    const b3 = P(u0, v1, back);
    this.quad(f0, f1, f2, f3, color, N);
    // 倒角：上、下、左、右
    this.quad(b3, b2, f2, f3, color, [N[0] * 0.7, 0.7, N[2] * 0.7]);
    this.quad(b0, b1, f1, f0, color, [N[0] * 0.7, -0.7, N[2] * 0.7]);
    this.quad(b0, b3, f3, f0, color, [N[0] * 0.7 - U[0] * 0.7, 0, N[2] * 0.7 - U[2] * 0.7]);
    this.quad(b1, b2, f2, f1, color, [N[0] * 0.7 + U[0] * 0.7, 0, N[2] * 0.7 + U[2] * 0.7]);
  }

  /** 牆面平板（無倒角）。 */
  wallFlat(O: Vec, U: Vec, N: Vec, u0: number, u1: number, v0: number, v1: number, depth: number, color: THREE.Color): void {
    const P = (u: number, v: number): Vec => [O[0] + U[0] * u + N[0] * depth, O[1] + v, O[2] + U[2] * u + N[2] * depth];
    this.quad(P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1), color, N);
  }

  /** 地面上的倒角石板（頂面在 y）。 */
  flag(x0: number, z0: number, x1: number, z1: number, y: number, bevel: number, drop: number, color: THREE.Color): void {
    const b = bevel;
    const t0: Vec = [x0 + b, y, z0 + b];
    const t1: Vec = [x1 - b, y, z0 + b];
    const t2: Vec = [x1 - b, y, z1 - b];
    const t3: Vec = [x0 + b, y, z1 - b];
    const e0: Vec = [x0, y - drop, z0];
    const e1: Vec = [x1, y - drop, z0];
    const e2: Vec = [x1, y - drop, z1];
    const e3: Vec = [x0, y - drop, z1];
    this.quad(t0, t1, t2, t3, color, [0, 1, 0]);
    this.quad(e0, e1, t1, t0, color, [0, 0.7, -0.7]);
    this.quad(e3, e2, t2, t3, color, [0, 0.7, 0.7]);
    this.quad(e0, e3, t3, t0, color, [-0.7, 0.7, 0]);
    this.quad(e1, e2, t2, t1, color, [0.7, 0.7, 0]);
  }

  /** 多邊形柱段（平面著色），y0..y1，半徑 r0→r1。 */
  prism(cx: number, cz: number, y0: number, y1: number, r0: number, r1: number, sides: number, color: THREE.Color, rot = 0, cap = true): void {
    for (let s = 0; s < sides; s++) {
      const a0 = rot + (s / sides) * Math.PI * 2;
      const a1 = rot + ((s + 1) / sides) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const p0: Vec = [cx + Math.cos(a0) * r0, y0, cz + Math.sin(a0) * r0];
      const p1: Vec = [cx + Math.cos(a1) * r0, y0, cz + Math.sin(a1) * r0];
      const p2: Vec = [cx + Math.cos(a1) * r1, y1, cz + Math.sin(a1) * r1];
      const p3: Vec = [cx + Math.cos(a0) * r1, y1, cz + Math.sin(a0) * r1];
      this.quad(p0, p1, p2, p3, color, [Math.cos(am), (r0 - r1) / Math.max(0.01, y1 - y0), Math.sin(am)]);
      if (cap) this.tri([cx, y1, cz], p3, p2, color, [0, 1, 0]);
    }
  }

  toGeometry(light: Float32Array): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aAlbedo', new THREE.Float32BufferAttribute(this.alb, 3));
    g.setAttribute('aLight', new THREE.BufferAttribute(light, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** 以 sRGB 色碼加上穩定抖動，回傳線性色。 */
export function jitterColor(hex: number, h: number, amount = 0.08): THREE.Color {
  const c = new THREE.Color(hex);
  const k = 1 + (h - 0.5) * 2 * amount;
  c.r *= k * (1 + (h - 0.5) * 0.04);
  c.g *= k;
  c.b *= k * (1 - (h - 0.5) * 0.05);
  return c;
}
