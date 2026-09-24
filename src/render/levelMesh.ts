import * as THREE from 'three';
import { RENDER, WORLD } from '../config';
import { hash2 } from '../core/rng';
import type { LevelData } from '../gen/generator';
import { T } from '../sim/grid';
import { bakeLighting, Occluder, type BakeLight } from './bake';
import { GeoBuilder, jitterColor, type Vec } from './geo';

const H = WORLD.wallHeight;

const C = {
  grout: 0x221d29,
  floor: 0x766a5e,
  threshold: 0x8a7a68,
  wall: 0x877662,
  plinth: 0x5f554c,
  cornice: 0x9c8b75,
  plaster: 0x4b4350,
  ceiling: 0x2a2531,
  pillar: 0x8b7d6b,
  pillarBase: 0x645a50,
  lowWall: 0x7e6f5f,
  lowCap: 0x9a8974,
  platformTop: 0x70665b,
  beam: 0x4d3727,
  lintel: 0x978671,
  keystone: 0xab9a83,
  iron: 0x34323c,
  wood: 0x6a4a32,
  step: 0x80735f,
};

export interface FlameSpot {
  seed: number;
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
}

export interface LevelVisual {
  group: THREE.Group;
  flames: FlameSpot[];
  flameMaterial: THREE.ShaderMaterial;
  lights: BakeLight[];
  bakeMs: number;
  vertexCount: number;
  dispose(): void;
}

/** 牆面對某一側的鄰格時，鄰格已經被實心佔據到多高（該高度以下不必建面）。 */
function neighborFloorHeight(t: number): number {
  if (t === T.Low) return WORLD.lowWallHeight;
  if (t === T.Platform) return WORLD.platformHeight;
  return 0;
}

const SIDES: Array<{ di: number; dj: number; O: (i: number, j: number) => Vec; U: Vec; N: Vec }> = [
  { di: 0, dj: -1, O: (i, j) => [i, 0, j], U: [1, 0, 0], N: [0, 0, -1] },
  { di: 0, dj: 1, O: (i, j) => [i, 0, j + 1], U: [1, 0, 0], N: [0, 0, 1] },
  { di: -1, dj: 0, O: (i, j) => [i, 0, j], U: [0, 0, 1], N: [-1, 0, 0] },
  { di: 1, dj: 0, O: (i, j) => [i + 1, 0, j], U: [0, 0, 1], N: [1, 0, 0] },
];

export function buildLevelVisual(level: LevelData, envMaterial: THREE.Material): LevelVisual {
  const g = level.grid;
  const CH = 9;
  const chunks = new Map<string, GeoBuilder>();
  let gb = new GeoBuilder();
  let aoFn: GeoBuilder['aoFn'] = null;
  const use = (x: number, z: number) => {
    const key = `${Math.floor(x / CH)},${Math.floor(z / CH)}`;
    let b = chunks.get(key);
    if (!b) {
      b = new GeoBuilder();
      b.aoFn = aoFn;
      chunks.set(key, b);
    }
    gb = b;
  };
  const occ = new Occluder(g);
  const seed = level.seed.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const h = (i: number, j: number, k = 0) => hash2(i + k * 131, j - k * 71, seed);

  // 頂點 AO：在法線前方的平面上取樣，看有多少被實心佔據
  aoFn = (x, y, z, nx, ny, nz) => {
    const ox = x + nx * 0.3;
    const oy = y + ny * 0.3;
    const oz = z + nz * 0.3;
    let occN = 0;
    const R = 0.5;
    const samples: Array<[number, number, number]> = [
      [R, 0, 0],
      [-R, 0, 0],
      [0, 0, R],
      [0, 0, -R],
      [0, -R, 0],
      [0, R, 0],
    ];
    for (const [sx, sy, sz] of samples) {
      const px = ox + sx;
      const py = oy + sy;
      const pz = oz + sz;
      if (py < 0 || py > H) {
        occN += 0.5;
        continue;
      }
      const t = g.get(Math.floor(px), Math.floor(pz));
      const top = t === T.Floor || t === T.Door ? 0 : t === T.Low ? WORLD.lowWallHeight : t === T.Platform ? WORLD.platformHeight : H + 1;
      if (py < top) occN++;
    }
    return 1 - 0.45 * (occN / samples.length) - 0.18 * Math.exp(-Math.max(0, y) * 2.5) * (ny > 0.5 ? 0 : 1);
  };

  const col = (hex: number, i: number, j: number, k = 0, amt = 0.08) => jitterColor(hex, h(i, j, k), amt);

  // ---------- 牆面 ----------
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const t = g.get(i, j);
      if (t !== T.Wall && t !== T.Stairs) continue;
      use(i + 0.5, j + 0.5);
      for (let s = 0; s < 4; s++) {
        const side = SIDES[s]!;
        const nt = g.get(i + side.di, j + side.dj);
        if (nt === T.Wall || nt === T.Void || nt === T.Stairs) continue;
        if (t === T.Stairs && level.stairs) {
          // 階梯正面不建牆
          const r = level.stairs.rise;
          if (side.di === -r.x && side.dj === -r.z) continue;
        }
        const floorH = neighborFloorHeight(nt);
        const O = side.O(i, j);
        const U = side.U;
        const N = side.N;
        const k = s * 7;
        gb.wallFlat(O, U, N, 0, 1, floorH, 3.42, 0, col(C.grout, i, j, k, 0.02));
        if (floorH < 0.42) gb.wallBlock(O, U, N, 0, 1, 0, 0.42, 0.1, 0.04, col(C.plinth, i, j, k + 1));
        for (let c = 0; c < 4; c++) {
          const v0 = 0.42 + c * 0.75;
          const v1 = v0 + 0.75;
          if (v1 <= floorH) continue;
          const d = 0.045 + (h(i, j, k + c + 2) - 0.5) * 0.03;
          if ((c + ((i + j) & 1)) % 2 === 0) gb.wallBlock(O, U, N, 0, 1, Math.max(v0, floorH), v1, d, 0.04, col(C.wall, i, j, k + c + 3, 0.1));
          else {
            const split = 0.5 + (h(i, j, k + c + 9) - 0.5) * 0.3;
            gb.wallBlock(O, U, N, 0, split, Math.max(v0, floorH), v1, d, 0.04, col(C.wall, i, j, k + c + 13, 0.1));
            gb.wallBlock(O, U, N, split, 1, Math.max(v0, floorH), v1, d * 0.9, 0.04, col(C.wall, i, j, k + c + 17, 0.1));
          }
        }
        gb.wallBlock(O, U, N, 0, 1, 3.42, 3.68, 0.13, 0.05, col(C.cornice, i, j, k + 20, 0.05));
        gb.wallFlat(O, U, N, 0, 1, 3.68, H, 0.02, col(C.plaster, i, j, k + 21, 0.06));
      }
    }
  }

  // ---------- 門框、門楣 ----------
  for (const d of g.doors) {
    const [c0, c1] = d.cells as [[number, number], [number, number]];
    const i0 = Math.min(c0[0], c1[0]);
    const j0 = Math.min(c0[1], c1[1]);
    use(d.cx, d.cz);
    // 門洞頂（門楣底面）
    for (const [i, j] of d.cells) {
      gb.quad([i, WORLD.doorHeight, j], [i + 1, WORLD.doorHeight, j], [i + 1, WORLD.doorHeight, j + 1], [i, WORLD.doorHeight, j + 1], col(C.lintel, i, j, 40), [0, -1, 0]);
      gb.quad([i, 0.01, j], [i + 1, 0.01, j], [i + 1, 0.01, j + 1], [i, 0.01, j + 1], col(C.threshold, i, j, 41, 0.04), [0, 1, 0]);
    }
    const faces: Array<{ O: Vec; U: Vec; N: Vec }> =
      d.axis === 'x'
        ? [
            { O: [i0, 0, j0], U: [1, 0, 0], N: [0, 0, -1] },
            { O: [i0, 0, j0 + 1], U: [1, 0, 0], N: [0, 0, 1] },
          ]
        : [
            { O: [i0, 0, j0], U: [0, 0, 1], N: [-1, 0, 0] },
            { O: [i0 + 1, 0, j0], U: [0, 0, 1], N: [1, 0, 0] },
          ];
    for (const f of faces) {
      gb.wallFlat(f.O, f.U, f.N, 0, 2, WORLD.doorHeight, H, 0.0, col(C.plaster, i0, j0, 42));
      gb.wallBlock(f.O, f.U, f.N, -0.35, 2.35, WORLD.doorHeight, WORLD.doorHeight + 0.5, 0.14, 0.05, col(C.lintel, i0, j0, 43, 0.04));
      gb.wallBlock(f.O, f.U, f.N, 0.78, 1.22, WORLD.doorHeight - 0.05, WORLD.doorHeight + 0.72, 0.19, 0.05, col(C.keystone, i0, j0, 44, 0.04));
      for (let s = 0; s < 3; s++) {
        const v0 = s * 1.0;
        gb.wallBlock(f.O, f.U, f.N, -0.35, 0.02, v0, v0 + 1.0, 0.13, 0.05, col(C.lintel, i0, j0, 45 + s, 0.06));
        gb.wallBlock(f.O, f.U, f.N, 1.98, 2.35, v0, v0 + 1.0, 0.13, 0.05, col(C.lintel, i0, j0, 49 + s, 0.06));
      }
    }
  }

  // ---------- 地板與天花板 ----------
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const t = g.get(i, j);
      use(i + 0.5, j + 0.5);
      if (t === T.Floor) {
        gb.quad([i, -0.035, j], [i + 1, -0.035, j], [i + 1, -0.035, j + 1], [i, -0.035, j + 1], col(C.grout, i, j, 60, 0.02), [0, 1, 0]);
        const pattern = h(i, j, 61);
        const y = (h(i, j, 62) - 0.5) * 0.016;
        if (pattern < 0.45) gb.flag(i, j, i + 1, j + 1, y, 0.035, 0.035, col(C.floor, i, j, 63, 0.12));
        else if (pattern < 0.72) {
          gb.flag(i, j, i + 0.5, j + 1, y, 0.03, 0.035, col(C.floor, i, j, 64, 0.12));
          gb.flag(i + 0.5, j, i + 1, j + 1, -y, 0.03, 0.035, col(C.floor, i, j, 65, 0.12));
        } else {
          gb.flag(i, j, i + 1, j + 0.5, y, 0.03, 0.035, col(C.floor, i, j, 66, 0.12));
          gb.flag(i, j + 0.5, i + 1, j + 1, -y, 0.03, 0.035, col(C.floor, i, j, 67, 0.12));
        }
      }
      if (t === T.Floor || t === T.Low || t === T.Platform) {
        gb.quad([i, H, j], [i + 1, H, j], [i + 1, H, j + 1], [i, H, j + 1], col(C.ceiling, i, j, 68, 0.05), [0, -1, 0]);
      }
      if (t === T.Low || t === T.Platform) {
        const top = t === T.Low ? WORLD.lowWallHeight : WORLD.platformHeight;
        // 側面（朝向較低的鄰格）
        for (let s = 0; s < 4; s++) {
          const side = SIDES[s]!;
          const nt = g.get(i + side.di, j + side.dj);
          const nh = nt === T.Floor || nt === T.Door ? 0 : nt === T.Low ? WORLD.lowWallHeight : nt === T.Platform ? WORLD.platformHeight : H;
          if (nh >= top) continue;
          const O: Vec = s === 0 ? [i, 0, j] : s === 1 ? [i, 0, j + 1] : s === 2 ? [i, 0, j] : [i + 1, 0, j];
          const U = side.U;
          const N = side.N;
          gb.wallFlat(O, U, N, 0, 1, nh, top, 0, col(C.grout, i, j, 70 + s, 0.02));
          const courses = t === T.Low ? 2 : 3;
          const ch = (top - 0.08) / courses;
          for (let c = 0; c < courses; c++) {
            const v0 = c * ch;
            if (v0 + ch <= nh) continue;
            if ((c + i + j) % 2 === 0) gb.wallBlock(O, U, N, 0, 1, Math.max(v0, nh), v0 + ch, 0.04, 0.035, col(C.lowWall, i, j, 74 + s * 3 + c));
            else {
              gb.wallBlock(O, U, N, 0, 0.5, Math.max(v0, nh), v0 + ch, 0.04, 0.035, col(C.lowWall, i, j, 90 + s * 3 + c));
              gb.wallBlock(O, U, N, 0.5, 1, Math.max(v0, nh), v0 + ch, 0.04, 0.035, col(C.lowWall, i, j, 110 + s * 3 + c));
            }
          }
        }
        if (t === T.Low) gb.flag(i - 0.02, j - 0.02, i + 1.02, j + 1.02, top + 0.06, 0.05, 0.12, col(C.lowCap, i, j, 130, 0.06));
        else gb.flag(i, j, i + 1, j + 1, top, 0.04, 0.05, col(C.platformTop, i, j, 131, 0.1));
      }
    }
  }

  // ---------- 階梯與光井 ----------
  const lights: BakeLight[] = [];
  if (level.stairs) {
    const s = level.stairs;
    use(s.front.x, s.front.z);
    const alongX = s.rise.x !== 0;
    const depthCells = alongX ? s.i1 - s.i0 + 1 : s.j1 - s.j0 + 1;
    const steps = depthCells * 3;
    const stepD = depthCells / steps;
    const rise = 3.6 / steps;
    for (let k = 0; k < steps; k++) {
      const y1 = (k + 1) * rise;
      const y0 = k * rise;
      const c = col(C.step, k, 3, 140, 0.06);
      if (alongX) {
        const x0 = s.rise.x < 0 ? s.i1 + 1 - k * stepD : s.i0 + k * stepD;
        const x1 = s.rise.x < 0 ? x0 - stepD : x0 + stepD;
        const z0 = s.j0;
        const z1 = s.j1 + 1;
        const xa = Math.min(x0, x1);
        const xb = Math.max(x0, x1);
        gb.quad([xa, y1, z0], [xb, y1, z0], [xb, y1, z1], [xa, y1, z1], c, [0, 1, 0]);
        gb.quad([x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1], c, [-s.rise.x, 0, 0]);
      } else {
        const z0 = s.rise.z < 0 ? s.j1 + 1 - k * stepD : s.j0 + k * stepD;
        const z1 = s.rise.z < 0 ? z0 - stepD : z0 + stepD;
        const za = Math.min(z0, z1);
        const zb = Math.max(z0, z1);
        gb.quad([s.i0, y1, za], [s.i1 + 1, y1, za], [s.i1 + 1, y1, zb], [s.i0, y1, zb], c, [0, 1, 0]);
        gb.quad([s.i0, y0, z0], [s.i1 + 1, y0, z0], [s.i1 + 1, y1, z0], [s.i0, y1, z0], c, [0, 0, -s.rise.z]);
      }
    }
    const cx = (s.i0 + s.i1 + 1) / 2;
    const cz = (s.j0 + s.j1 + 1) / 2;
    lights.push({ x: cx, y: 4.3, z: cz, r: 0.55, g: 0.75, b: 1.25, range: 9 });
    lights.push({ x: s.front.x, y: 3.6, z: s.front.z, r: 0.25, g: 0.35, b: 0.6, range: 7 });
  }

  // ---------- 石柱 ----------
  for (const p of g.pillars) {
    if (p.kind !== 'pillar') continue;
    use(p.x, p.z);
    const i = Math.floor(p.x);
    const j = Math.floor(p.z);
    gb.prism(p.x, p.z, 0, 0.32, 0.52, 0.5, 8, col(C.pillarBase, i, j, 150), Math.PI / 8);
    gb.prism(p.x, p.z, 0.32, 0.42, 0.44, 0.36, 12, col(C.pillarBase, i, j, 151), 0, false);
    gb.prism(p.x, p.z, 0.42, 3.8, 0.34, 0.32, 12, col(C.pillar, i, j, 152, 0.06), 0, false);
    gb.prism(p.x, p.z, 3.8, 3.92, 0.35, 0.38, 12, col(C.cornice, i, j, 153), 0, false);
    gb.prism(p.x, p.z, 3.92, 4.18, 0.38, 0.52, 8, col(C.cornice, i, j, 154), Math.PI / 8);
    gb.box(p.x - 0.52, 4.18, p.z - 0.52, p.x + 0.52, H, p.z + 0.52, col(C.lintel, i, j, 155));
  }

  // ---------- 天花板木梁 ----------
  for (const r of level.rooms) {
    for (let bx = r.x0 + 3; bx < r.x0 + r.w - 2; bx += 4) {
      use(bx + 0.5, r.z0 + r.h / 2);
      gb.box(bx + 0.32, H - 0.42, r.z0 + 1, bx + 0.68, H, r.z0 + r.h - 1, col(C.beam, bx, r.z0, 160, 0.05), false);
    }
  }

  // ---------- 火把 ----------
  const flames: LevelVisual['flames'] = [];
  for (const t of level.torches) {
    use(t.x, t.z);
    const bx = t.x - t.nx * 0.1;
    const bz = t.z - t.nz * 0.1;
    gb.box(bx - 0.06, t.y - 0.45, bz - 0.06, bx + 0.06, t.y - 0.3, bz + 0.06, col(C.iron, 0, 0, 170), false);
    gb.prism(t.x, t.z, t.y - 0.35, t.y - 0.02, 0.04, 0.075, 6, col(C.wood, 0, 0, 171));
    gb.prism(t.x, t.z, t.y - 0.08, t.y, 0.09, 0.1, 6, col(C.iron, 0, 0, 172));
    lights.push({ x: t.x + t.nx * 0.25, y: t.y + 0.25, z: t.z + t.nz * 0.25, r: 2.1, g: 1.05, b: 0.42, range: 10.5 });
    flames.push({ seed: hash2(Math.floor(t.x * 10), Math.floor(t.z * 10), 3) * 100, x: t.x, y: t.y, z: t.z, nx: t.nx, nz: t.nz });
  }
  // 心核的冷光
  if (level.heart) lights.push({ x: level.heart.x, y: 1.8, z: level.heart.z, r: 0.35, g: 0.7, b: 1.6, range: 8 });

  // ---------- 烘焙（每個區塊一個網格，可做視錐剔除） ----------
  const t0 = performance.now();
  const group = new THREE.Group();
  let vertexCount = 0;
  for (const b of chunks.values()) {
    if (b.vertexCount === 0) continue;
    const pos = new Float32Array(b.pos);
    const nrm = new Float32Array(b.nrm);
    const ao = new Float32Array(b.ao);
    const baked = bakeLighting(pos, nrm, ao, lights, occ, { sky: [0.1, 0.1, 0.21], ground: [0.045, 0.036, 0.06] }, g.w, g.h);
    const geo = b.toGeometry(baked);
    const mesh = new THREE.Mesh(geo, envMaterial);
    mesh.matrixAutoUpdate = false;
    group.add(mesh);
    vertexCount += b.vertexCount;
  }
  const bakeMs = performance.now() - t0;
  const flamePoints = buildFlamePoints(flames);
  group.add(flamePoints.points);
  // 光井：出口上方的冷白色天光
  if (level.stairs) {
    const s = level.stairs;
    const shaft = new THREE.Mesh(
      new THREE.PlaneGeometry(s.i1 - s.i0 + 1, s.j1 - s.j0 + 1),
      new THREE.MeshBasicMaterial({ color: 0xcfe4ff, fog: false }),
    );
    shaft.rotation.x = Math.PI / 2;
    shaft.position.set((s.i0 + s.i1 + 1) / 2, H - 0.01, (s.j0 + s.j1 + 1) / 2);
    group.add(shaft);
    const beam = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedFlameTexture(), color: 0x9cc4ff, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.35 }));
    beam.scale.set(3.2, 5.5, 1);
    beam.position.set((s.i0 + s.i1 + 1) / 2, 2.6, (s.j0 + s.j1 + 1) / 2);
    group.add(beam);
  }
  return {
    group,
    flames,
    flameMaterial: flamePoints.material,
    lights,
    bakeMs,
    vertexCount,
    dispose() {
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = (m as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (mat && mat !== envMaterial) {
          if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
          else mat.dispose();
        }
      });
    },
  };
}

let flameTexCache: THREE.CanvasTexture | null = null;
export function sharedFlameTexture(): THREE.CanvasTexture {
  if (flameTexCache) return flameTexCache;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size * 0.58, 1, size / 2, size * 0.55, size / 2);
  grad.addColorStop(0, 'rgba(255,245,220,1)');
  grad.addColorStop(0.25, 'rgba(255,200,120,0.9)');
  grad.addColorStop(0.6, 'rgba(255,120,40,0.35)');
  grad.addColorStop(1, 'rgba(255,80,20,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  flameTexCache = new THREE.CanvasTexture(c);
  flameTexCache.colorSpace = THREE.SRGBColorSpace;
  return flameTexCache;
}

/** 所有火把火焰與光暈合成一個點雲（一次繪製），在著色器中閃爍。 */
function buildFlamePoints(flames: FlameSpot[]): { points: THREE.Points; material: THREE.ShaderMaterial } {
  const n = flames.length;
  const pos = new Float32Array(n * 2 * 3);
  const seed = new Float32Array(n * 2);
  const kind = new Float32Array(n * 2);
  flames.forEach((f, k) => {
    pos.set([f.x, f.y + 0.2, f.z], k * 6);
    pos.set([f.x + f.nx * 0.12, f.y + 0.2, f.z + f.nz * 0.12], k * 6 + 3);
    seed[k * 2] = f.seed;
    seed[k * 2 + 1] = f.seed;
    kind[k * 2] = 0;
    kind[k * 2 + 1] = 1;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  geo.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  geo.computeBoundingSphere();
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: sharedFlameTexture() },
      uTime: { value: 0 },
      uScale: { value: 400 },
      uFogColor: { value: new THREE.Color(RENDER.fogColor) },
      uFogDensity: { value: RENDER.fogDensity },
    },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      attribute float aKind;
      uniform float uTime;
      uniform float uScale;
      varying float vKind;
      varying float vFlick;
      varying float vDepth;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        float fl = 0.85 + 0.15 * sin(uTime * 11.0 + aSeed) * sin(uTime * 7.3 + aSeed * 2.0);
        vFlick = fl;
        vKind = aKind;
        vDepth = -mv.z;
        float size = aKind < 0.5 ? 0.42 : 1.6;
        gl_PointSize = min(220.0, size * fl * uScale / max(0.1, -mv.z));
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      varying float vKind;
      varying float vFlick;
      varying float vDepth;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        vec3 c = vKind < 0.5 ? vec3(1.0, 0.63, 0.31) : vec3(1.0, 0.48, 0.19) * 0.35 * vFlick;
        float fog = exp(-uFogDensity * uFogDensity * vDepth * vDepth);
        gl_FragColor = vec4(c * t.rgb * t.a * fog, 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, material);
  return { points, material };
}
