import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ENEMIES } from '../config';
import { clamp, lerp, smoothstep } from '../core/math';
import type { Enemy } from '../sim/types';
import { createCharMaterial, createLightRig, createOutlineMaterial, paint, type LightRig, type SharedUniforms } from './materials';

// 三種敵人的程序角色：不同輪廓、武器與姿勢；動畫直接由模擬狀態（世界時間）計算，
// 讓畫面與命中判定使用同一個時序。
// 為了效能，每個關節上的零件合併成一個網格（頂點色＋發光遮罩），同種敵人共用合併後的幾何。

type JointName = 'hips' | 'torso' | 'head' | 'armL' | 'elbowL' | 'armR' | 'elbowR' | 'legL' | 'kneeL' | 'legR' | 'kneeR';
type GroupKey = JointName | 'crossbow' | 'cloak' | 'shield';

interface Pose {
  hipsY: number;
  j: Record<JointName, [number, number, number]>;
}

const zeroPose = (hipsY: number): Pose => ({
  hipsY,
  j: {
    hips: [0, 0, 0],
    torso: [0, 0, 0],
    head: [0, 0, 0],
    armL: [0, 0, 0],
    elbowL: [0, 0, 0],
    armR: [0, 0, 0],
    elbowR: [0, 0, 0],
    legL: [0, 0, 0],
    kneeL: [0, 0, 0],
    legR: [0, 0, 0],
    kneeR: [0, 0, 0],
  },
});

function blendPose(out: Pose, a: Pose, b: Pose, t: number): Pose {
  out.hipsY = lerp(a.hipsY, b.hipsY, t);
  for (const k of Object.keys(out.j) as JointName[]) {
    const o = out.j[k];
    const pa = a.j[k];
    const pb = b.j[k];
    o[0] = lerp(pa[0], pb[0], t);
    o[1] = lerp(pa[1], pb[1], t);
    o[2] = lerp(pa[2], pb[2], t);
  }
  return out;
}

const copyPose = (out: Pose, a: Pose): Pose => blendPose(out, a, a, 0);

// ---------- 基本幾何（共用） ----------

const baseCache = new Map<string, THREE.BufferGeometry>();
function base(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = baseCache.get(key);
  if (!g) {
    const b = make();
    g = b.index ? b.toNonIndexed() : b;
    if (g !== b) b.dispose();
    g.deleteAttribute('uv');
    g.computeVertexNormals();
    baseCache.set(key, g);
  }
  return g;
}
const box = (w: number, h: number, d: number) => base(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 8) => base(`c${rt},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const sph = (r: number, detail = 1) => base(`s${r},${detail}`, () => new THREE.IcosahedronGeometry(r, detail));
const cone = (r: number, h: number, seg = 6) => base(`k${r},${h},${seg}`, () => new THREE.ConeGeometry(r, h, seg));

interface PartSpec {
  geo: THREE.BufferGeometry;
  color: number;
  glow: number;
  outline: boolean;
  matrix: THREE.Matrix4;
}

/** 以種類快取合併後的關節幾何（本體＋描邊），跨局重用。 */
const mergedCache = new Map<string, { body: THREE.BufferGeometry; outline: THREE.BufferGeometry | null }>();

export function geometryCacheSize(): number {
  return mergedCache.size + baseCache.size;
}

function mergeParts(parts: PartSpec[]): { body: THREE.BufferGeometry; outline: THREE.BufferGeometry | null } {
  const bodies: THREE.BufferGeometry[] = [];
  const outlines: THREE.BufferGeometry[] = [];
  for (const p of parts) {
    const g = p.geo.clone();
    g.applyMatrix4(p.matrix);
    paint(g, p.color, p.glow);
    bodies.push(g);
    if (p.outline) {
      const o = p.geo.clone();
      o.deleteAttribute('normal');
      const sm = mergeVertices(o, 1e-3);
      sm.computeVertexNormals();
      sm.applyMatrix4(p.matrix);
      o.dispose();
      const ni = sm.index ? sm.toNonIndexed() : sm;
      if (ni !== sm) sm.dispose();
      outlines.push(ni);
    }
  }
  const body = mergeGeometries(bodies)!;
  const outline = outlines.length ? mergeGeometries(outlines)! : null;
  bodies.forEach((g) => g.dispose());
  outlines.forEach((g) => g.dispose());
  body.computeBoundingSphere();
  outline?.computeBoundingSphere();
  return { body, outline };
}

type Holder = { key: GroupKey; m: THREE.Matrix4 };
type JointFn = (n: JointName, p: THREE.Object3D, x: number, y: number, z: number) => THREE.Group;

export class EnemyVisual {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly joints = {} as Record<JointName, THREE.Group>;
  readonly rig: LightRig = createLightRig();
  readonly mat: THREE.ShaderMaterial;
  readonly outlineMat: THREE.ShaderMaterial;
  eyes!: THREE.Mesh;
  eyeMat = new THREE.MeshBasicMaterial({ color: 0xffb040, fog: true });
  crossbow: THREE.Group | null = null;
  /** 盾衛的圓盾：舉盾前進時抬到頭前。 */
  shield: THREE.Group | null = null;
  bolt: THREE.Mesh | null = null;
  cloak: THREE.Group | null = null;
  private parts = new Map<GroupKey, PartSpec[]>();
  private groups = new Map<GroupKey, THREE.Group>();
  private pose: Pose;
  private target: Pose;
  private base: Pose;
  readonly kind: Enemy['kind'];

  constructor(
    readonly enemy: Enemy,
    shared: SharedUniforms,
  ) {
    this.kind = enemy.kind;
    this.mat = createCharMaterial(shared, this.rig, 0xffffff, { glow: 0xff6a1a });
    this.outlineMat = createOutlineMaterial(shared, enemy.kind === 'charger' ? 1.3 : 1.0);
    const hipsY = enemy.kind === 'charger' ? 0.92 : enemy.kind === 'archer' ? 0.95 : 0.98;
    this.pose = zeroPose(hipsY);
    this.target = zeroPose(hipsY);
    this.base = zeroPose(hipsY);
    this.root.add(this.body);
    const J: JointFn = (name, parent, x, y, z) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      g.rotation.order = 'YXZ';
      parent.add(g);
      this.joints[name] = g;
      this.groups.set(name, g);
      return g;
    };
    const hips = J('hips', this.body, 0, hipsY, 0);
    const torso = J('torso', hips, 0, 0.08, 0);
    if (enemy.kind === 'guard') this.buildGuard(J, hips, torso);
    else if (enemy.kind === 'archer') this.buildArcher(J, hips, torso);
    else this.buildCharger(J, hips, torso);
    for (const [key, list] of this.parts) {
      const cacheKey = `${enemy.kind}:${key}`;
      let merged = mergedCache.get(cacheKey);
      if (!merged) {
        merged = mergeParts(list);
        mergedCache.set(cacheKey, merged);
      }
      const g = this.groups.get(key)!;
      g.add(new THREE.Mesh(merged.body, this.mat));
      if (merged.outline) g.add(new THREE.Mesh(merged.outline, this.outlineMat));
    }
    this.parts.clear();
    copyPose(this.pose, this.base);
  }

  private at(key: GroupKey, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): Holder {
    return { key, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)) };
  }

  private part(
    geo: THREE.BufferGeometry,
    color: number,
    h: Holder | GroupKey,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    opts: { glow?: number; outline?: boolean; scale?: [number, number, number] } = {},
  ): void {
    const holder: Holder = typeof h === 'string' ? { key: h, m: new THREE.Matrix4() } : h;
    const s = opts.scale ?? [1, 1, 1];
    const local = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s[0], s[1], s[2]));
    const m = holder.m.clone().multiply(local);
    let list = this.parts.get(holder.key);
    if (!list) {
      list = [];
      this.parts.set(holder.key, list);
    }
    list.push({ geo, color, glow: opts.glow ?? 0, outline: opts.outline ?? true, matrix: m });
  }

  private legs(J: JointFn, hips: THREE.Group, w: number, thick: number, len: number, legColor: number, bootColor: number): void {
    for (const side of [-1, 1] as const) {
      const lk: JointName = side < 0 ? 'legL' : 'legR';
      const kk: JointName = side < 0 ? 'kneeL' : 'kneeR';
      const leg = J(lk, hips, side * w, -0.02, 0);
      this.part(cyl(thick, thick * 0.85, len, 7), legColor, lk, 0, -len / 2, 0);
      J(kk, leg, 0, -len, 0);
      this.part(cyl(thick * 0.85, thick * 0.75, len, 7), legColor, kk, 0, -len / 2, 0);
      this.part(box(thick * 2.2, 0.14, thick * 3.2), bootColor, kk, 0, -len + 0.02, -thick * 0.6);
    }
  }

  private buildGuard(J: JointFn, hips: THREE.Group, torso: THREE.Group): void {
    const steel = 0x6f7885;
    const dark = 0x3c3f4a;
    const tabard = 0x5b2c37;
    const wood = 0x6b4a33;
    const blade = 0xbfc7d2;
    this.part(cyl(0.3, 0.36, 0.34, 8), dark, 'hips', 0, -0.08, 0);
    this.part(box(0.62, 0.56, 0.38), steel, 'torso', 0, 0.32, 0);
    this.part(box(0.36, 0.78, 0.05), tabard, 'torso', 0, 0.1, -0.2);
    this.part(sph(0.2, 1), steel, 'torso', -0.4, 0.55, 0, 0, 0, 0, { scale: [1.25, 0.8, 1.1] });
    this.part(sph(0.2, 1), steel, 'torso', 0.4, 0.55, 0, 0, 0, 0, { scale: [1.25, 0.8, 1.1] });
    // 圓盾在軀幹左前方（正面擋箭的判定也以軀幹朝向為準）；舉盾前進時整面抬到頭前
    const sh = new THREE.Group();
    torso.add(sh);
    this.groups.set('shield', sh);
    this.shield = sh;
    sh.position.set(-0.26, 0.22, -0.36);
    sh.rotation.set(Math.PI / 2, 0, 0.15);
    this.part(cyl(0.44, 0.44, 0.08, 12), wood, 'shield', 0, 0, 0);
    this.part(cyl(0.46, 0.46, 0.05, 12), steel, 'shield', 0, 0.01, 0, 0, 0, 0, { outline: false });
    this.part(cyl(0.12, 0.12, 0.1, 8), steel, 'shield', 0, -0.06, 0);
    const head = J('head', torso, 0, 0.66, 0);
    this.part(cyl(0.19, 0.21, 0.36, 8), steel, 'head', 0, 0.14, 0);
    this.part(box(0.05, 0.14, 0.34), tabard, 'head', 0, 0.37, 0.02);
    this.part(box(0.3, 0.06, 0.06), dark, 'head', 0, 0.1, -0.19, 0, 0, 0, { outline: false });
    this.eyes = new THREE.Mesh(box(0.2, 0.03, 0.02), this.eyeMat);
    this.eyes.position.set(0, 0.11, -0.215);
    head.add(this.eyes);
    const armR = J('armR', torso, 0.42, 0.5, 0);
    this.part(cyl(0.085, 0.075, 0.34, 7), steel, 'armR', 0, -0.17, 0);
    J('elbowR', armR, 0, -0.34, 0);
    this.part(cyl(0.08, 0.07, 0.3, 7), dark, 'elbowR', 0, -0.15, 0);
    this.part(box(0.12, 0.12, 0.12), steel, 'elbowR', 0, -0.32, 0);
    // 劍相對手腕上翹，待機時劍尖朝上前方
    const sword = this.at('elbowR', 0, -0.34, 0, 1.3, 0, 0);
    this.part(box(0.05, 0.14, 0.05), wood, sword, 0, -0.04, 0);
    this.part(box(0.3, 0.04, 0.06), dark, sword, 0, -0.12, 0);
    this.part(box(0.08, 1.0, 0.025), blade, sword, 0, -0.63, 0, 0, 0, 0, { glow: 1 });
    const armL = J('armL', torso, -0.42, 0.5, 0);
    this.part(cyl(0.085, 0.075, 0.34, 7), steel, 'armL', 0, -0.17, 0);
    J('elbowL', armL, 0, -0.34, 0);
    this.part(cyl(0.08, 0.07, 0.3, 7), dark, 'elbowL', 0, -0.15, 0);
    this.legs(J, hips, 0.15, 0.1, 0.45, 0x3c3f4a, 0x2b2a30);
    this.base.j.armR = [0.35, 0, 0.12];
    this.base.j.elbowR = [1.05, 0, 0];
    this.base.j.armL = [0.6, 0, 0.15];
    this.base.j.elbowL = [0.9, 0, 0];
  }

  private buildArcher(J: JointFn, hips: THREE.Group, torso: THREE.Group): void {
    const cloth = 0x3e4a3e;
    const leather = 0x6c5040;
    const dark = 0x2c2a2e;
    const wood = 0x5d412c;
    const metal = 0x9aa3ad;
    this.part(cyl(0.2, 0.26, 0.3, 8), leather, 'hips', 0, -0.06, 0);
    this.part(box(0.42, 0.58, 0.26), cloth, 'torso', 0, 0.3, 0);
    this.part(box(0.3, 0.1, 0.28), leather, 'torso', 0, 0.05, 0);
    const cloak = new THREE.Group();
    cloak.position.set(0, 0.55, 0.15);
    torso.add(cloak);
    this.groups.set('cloak', cloak);
    this.cloak = cloak;
    this.part(box(0.5, 1.15, 0.05), cloth, 'cloak', 0, -0.55, 0.02);
    const head = J('head', torso, 0, 0.64, 0);
    this.part(sph(0.16, 1), dark, 'head', 0, 0.1, -0.02);
    this.part(cone(0.24, 0.5, 7), cloth, 'head', 0, 0.2, 0.03);
    this.eyes = new THREE.Mesh(box(0.16, 0.025, 0.02), this.eyeMat);
    this.eyes.position.set(0, 0.1, -0.17);
    head.add(this.eyes);
    const armR = J('armR', torso, 0.27, 0.5, 0);
    this.part(cyl(0.065, 0.06, 0.32, 6), cloth, 'armR', 0, -0.16, 0);
    J('elbowR', armR, 0, -0.32, 0);
    this.part(cyl(0.06, 0.055, 0.3, 6), leather, 'elbowR', 0, -0.15, 0);
    const armL = J('armL', torso, -0.27, 0.5, 0);
    this.part(cyl(0.065, 0.06, 0.32, 6), cloth, 'armL', 0, -0.16, 0);
    J('elbowL', armL, 0, -0.32, 0);
    this.part(cyl(0.06, 0.055, 0.3, 6), leather, 'elbowL', 0, -0.15, 0);
    // 長弩：掛在軀幹上，姿勢切換時整把移動
    const cb = new THREE.Group();
    torso.add(cb);
    this.groups.set('crossbow', cb);
    this.crossbow = cb;
    this.part(box(0.08, 0.08, 0.95), wood, 'crossbow', 0, 0, -0.25);
    this.part(box(0.95, 0.06, 0.07), wood, 'crossbow', 0, 0.02, -0.66);
    this.part(box(0.08, 0.06, 0.08), metal, 'crossbow', 0.45, 0.02, -0.62, 0, 0.35, 0, { glow: 1, outline: false });
    this.part(box(0.08, 0.06, 0.08), metal, 'crossbow', -0.45, 0.02, -0.62, 0, -0.35, 0, { glow: 1, outline: false });
    this.bolt = new THREE.Mesh(paint(box(0.025, 0.025, 0.55).clone(), metal, 1), this.mat);
    this.bolt.position.set(0, 0.06, -0.52);
    cb.add(this.bolt);
    this.legs(J, hips, 0.12, 0.08, 0.46, 0x3a3830, 0x2b2622);
    this.base.j.armR = [0.6, 0, -0.15];
    this.base.j.elbowR = [0.9, 0, 0];
    this.base.j.armL = [0.8, 0, 0.1];
    this.base.j.elbowL = [0.7, 0, 0];
  }

  private buildCharger(J: JointFn, hips: THREE.Group, torso: THREE.Group): void {
    const bronze = 0x6e5a44;
    const dark = 0x33302f;
    const bone = 0xd2c4a8;
    const iron = 0x4d4a50;
    this.part(cyl(0.38, 0.44, 0.36, 8), dark, 'hips', 0, -0.06, 0);
    this.part(box(0.95, 0.72, 0.62), bronze, 'torso', 0, 0.36, 0.02);
    this.part(sph(0.3, 1), bronze, 'torso', -0.56, 0.62, 0.02, 0, 0, 0, { scale: [1.1, 0.85, 1.15] });
    this.part(sph(0.3, 1), bronze, 'torso', 0.56, 0.62, 0.02, 0, 0, 0, { scale: [1.1, 0.85, 1.15] });
    const head = J('head', torso, 0, 0.62, -0.28);
    this.part(box(0.36, 0.32, 0.38), dark, 'head', 0, 0.06, -0.04);
    this.part(cone(0.07, 0.5, 6), bone, 'head', -0.24, 0.22, -0.12, -0.7, 0, 0.55, { glow: 1 });
    this.part(cone(0.07, 0.5, 6), bone, 'head', 0.24, 0.22, -0.12, -0.7, 0, -0.55, { glow: 1 });
    this.eyes = new THREE.Mesh(box(0.22, 0.035, 0.02), this.eyeMat);
    this.eyes.position.set(0, 0.08, -0.235);
    head.add(this.eyes);
    const armR = J('armR', torso, 0.58, 0.5, 0);
    this.part(cyl(0.13, 0.11, 0.38, 7), dark, 'armR', 0, -0.19, 0);
    J('elbowR', armR, 0, -0.38, 0);
    this.part(cyl(0.12, 0.1, 0.32, 7), bronze, 'elbowR', 0, -0.16, 0);
    const armL = J('armL', torso, -0.58, 0.5, 0);
    this.part(cyl(0.13, 0.11, 0.38, 7), dark, 'armL', 0, -0.19, 0);
    J('elbowL', armL, 0, -0.38, 0);
    this.part(cyl(0.12, 0.1, 0.32, 7), bronze, 'elbowL', 0, -0.16, 0);
    // 衝撞盾：固定在軀幹前方
    const shield = this.at('torso', 0, 0.1, -0.62);
    this.part(box(1.0, 0.95, 0.14), iron, shield, 0, 0, 0, 0, 0, 0, { glow: 0.35 });
    for (const [x, y] of [
      [-0.3, 0.25],
      [0.3, 0.25],
      [0, -0.2],
    ] as const)
      this.part(cone(0.07, 0.28, 6), bone, shield, x, y, -0.2, -Math.PI / 2, 0, 0, { glow: 1, outline: false });
    this.legs(J, hips, 0.22, 0.13, 0.44, 0x33302f, 0x221f1f);
    this.base.j.torso = [-0.25, 0, 0];
    this.base.j.head = [0.1, 0, 0];
    this.base.j.armR = [0.9, 0, -0.3];
    this.base.j.elbowR = [0.8, 0, 0];
    this.base.j.armL = [0.9, 0, 0.3];
    this.base.j.elbowL = [0.8, 0, 0];
  }

  private computeTarget(e: Enemy): { snap: boolean; glow: number } {
    // 關節慣例：四肢 x 為正＝往前擺；軀幹與頭 x 為負＝往前傾。
    const t = this.target;
    copyPose(t, this.base);
    let snap = false;
    let glow = 0;
    const walk = e.moving ? 1 : 0;
    const ph = e.walkPhase;
    const s = Math.sin(ph);
    if (walk) {
      const amp = e.phase === 'charge' ? 0.95 : 0.55;
      t.j.legL[0] = s * amp;
      t.j.legR[0] = -s * amp;
      t.j.kneeL[0] = -Math.max(0, -s) * amp * 1.3;
      t.j.kneeR[0] = -Math.max(0, s) * amp * 1.3;
      t.hipsY += Math.abs(Math.cos(ph)) * 0.04;
      if (e.kind !== 'charger') {
        t.j.armL[0] += -s * 0.2;
        t.j.armR[0] += s * 0.15;
      }
    }
    if (e.state === 'sleep') {
      t.hipsY = 0.42;
      t.j.legL = [1.45, 0.15, 0];
      t.j.legR = [1.45, -0.15, 0];
      t.j.kneeL = [-1.1, 0, 0];
      t.j.kneeR = [-1.1, 0, 0];
      t.j.torso = [-0.45, 0, 0];
      t.j.head = [-0.55, 0.2, 0];
      t.j.armL = [0.3, 0, 0.1];
      t.j.armR = [0.3, 0, -0.1];
      if (this.crossbow) this.crossbow.rotation.set(-1.0, 0, 0.3);
      return { snap: false, glow: 0 };
    }
    const p = e.phaseT;
    if (e.phase === 'pushed') {
      // 被盾推：往後踉蹌
      snap = true;
      t.j.torso = [0.45, 0, 0];
      t.j.head = [0.3, 0, 0];
      t.j.armL = [0.6, 0, -0.7];
      t.j.armR = [0.6, 0, 0.7];
      t.j.legL = [-0.5, 0, 0];
      return { snap, glow: 0 };
    }
    if (this.shield) {
      // 舉盾：盾牌擋在頭前；失衡時甩開
      const up = e.shieldUp;
      this.shield.position.set(up ? -0.05 : -0.26, up ? 0.62 : 0.22, up ? -0.46 : -0.36);
      this.shield.rotation.set(Math.PI / 2 + (up ? 0.1 : 0), 0, up ? 0 : 0.15);
      if (up) {
        t.j.armL = [1.4, 0, 0.5];
        t.j.head = [0.25, 0, 0];
      }
    }
    if (e.kind === 'guard') {
      const g = ENEMIES.guard;
      if (e.phase === 'windup') {
        snap = true;
        const k = smoothstep(0, g.windup, p);
        t.j.armR = [lerp(0.35, 3.2, k), 0, lerp(0.12, 0.35, k)];
        t.j.elbowR = [lerp(1.05, 1.0, k), 0, 0];
        t.j.torso = [0, lerp(0, -0.4, k), 0];
        glow = 0.25 + 0.75 * k;
      } else if (e.phase === 'active') {
        snap = true;
        const k = clamp(p / g.active, 0, 1);
        t.j.armR = [lerp(3.2, 0.3, k), 0, lerp(0.35, -0.45, k)];
        t.j.elbowR = [lerp(1.0, -0.2, k), 0, 0];
        t.j.torso = [lerp(0, -0.25, k), lerp(-0.4, 0.45, k), 0];
        glow = 1.2;
      } else if (e.phase === 'recovery') {
        snap = true;
        const k = smoothstep(0, g.recovery, p);
        t.j.armR = [lerp(0.3, 0.35, k), 0, lerp(-0.45, 0.12, k)];
        t.j.elbowR = [lerp(-0.2, 1.05, k), 0, 0];
        t.j.torso = [lerp(-0.25, 0, k), lerp(0.45, 0, k), 0];
      } else if (e.phase === 'stagger') {
        // 被反擊：後仰、盾牌甩開（正面露出身體）
        snap = true;
        const wob = Math.sin(p * 9) * 0.12;
        t.j.torso = [0.4, 0.35 + wob, 0];
        t.j.head = [0.3, 0, 0.15];
        t.j.armL = [0.1, 0, -1.2];
        t.j.elbowL = [0.2, 0, 0];
        t.j.armR = [0.5, 0, 0.8];
      }
    } else if (e.kind === 'archer') {
      const a = ENEMIES.archer;
      const cb = this.crossbow!;
      const aiming = e.phase === 'aim';
      const k = aiming ? smoothstep(0, 0.25, p) : 0;
      cb.position.set(lerp(0.12, 0.16, k), lerp(0.05, 0.5, k), lerp(-0.05, -0.1, k));
      cb.rotation.set(lerp(-0.75, 0, k), 0, lerp(0.3, 0, k));
      t.j.armR = [lerp(0.6, 1.35, k), 0, lerp(-0.15, -0.25, k)];
      t.j.elbowR = [0.9, 0, 0];
      t.j.armL = [lerp(0.8, 1.5, k), 0, lerp(0.1, 0.35, k)];
      t.j.elbowL = [lerp(0.7, 0.3, k), 0, 0];
      t.j.head = [lerp(0, -0.12, k), lerp(0, 0.15, k), 0];
      if (aiming) {
        snap = true;
        glow = 0.3 + 0.9 * smoothstep(0, a.aim, p);
      }
      if (e.phase === 'reload') {
        snap = true;
        const r = clamp(p / a.reload, 0, 1);
        cb.rotation.set(-1.0, 0, 0.2);
        cb.position.set(0.1, -0.05, -0.1);
        t.j.armR = [0.4 + Math.sin(r * Math.PI) * 0.6, 0, -0.2];
        t.j.elbowR = [0.4 + Math.sin(r * Math.PI) * 1.0, 0, 0];
      }
      if (e.phase === 'stagger') {
        snap = true;
        t.j.torso = [0.35, 0.3, 0];
        t.j.head = [0.3, 0, 0.2];
      }
      if (this.bolt) this.bolt.visible = e.phase !== 'reload';
      if (this.cloak) this.cloak.rotation.x = walk ? 0.2 + Math.abs(s) * 0.15 : 0.08;
    } else {
      const c = ENEMIES.charger;
      if (e.phase === 'windup') {
        snap = true;
        const k = smoothstep(0, c.windup, p);
        t.hipsY -= 0.16 * k;
        t.j.torso = [lerp(-0.25, -0.75, k), 0, 0];
        t.j.head = [lerp(0.1, 0.55, k), 0, 0];
        t.j.legL = [lerp(0, 0.5, k), 0, 0];
        t.j.legR = [lerp(0, -0.55, k), 0, 0];
        t.j.kneeL = [lerp(0, -0.8, k), 0, 0];
        t.j.kneeR = [lerp(0, -0.4, k), 0, 0];
        glow = 0.25 + 0.95 * k;
      } else if (e.phase === 'charge') {
        snap = true;
        t.j.torso = [-0.8, 0, 0];
        t.j.head = [0.6, 0, 0];
        glow = 1.1;
      } else if (e.phase === 'stun') {
        snap = true;
        const wob = Math.sin(p * 11) * 0.25;
        t.j.torso = [0.35, wob, 0];
        t.j.head = [-0.3, 0, wob];
        t.j.armL = [0.2, 0, -1.0];
        t.j.armR = [0.2, 0, 1.0];
      } else if (e.phase === 'recovery') {
        snap = true;
        const k = smoothstep(0, c.recovery, p);
        t.j.torso = [lerp(-0.8, -0.25, k), 0, 0];
      } else if (e.phase === 'stagger') {
        snap = true;
        t.j.torso = [0.3, Math.sin(p * 9) * 0.15, 0];
        t.j.head = [-0.2, 0, 0];
      } else if (e.state === 'alert') {
        // 察覺玩家後低頭：角盔擋住正面的頭
        t.j.head = [0.45, 0, 0];
        t.j.torso = [-0.35, 0, 0];
      }
    }
    return { snap, glow };
  }

  update(e: Enemy, worldDt: number): void {
    this.root.position.set(e.x, e.y, e.z);
    this.root.rotation.y = e.yaw;
    const u = this.mat.uniforms;
    if (!e.alive) {
      // 死亡：向後倒下（世界時間）
      const k = smoothstep(0, 0.6, e.deathT);
      this.body.rotation.x = 1.45 * k;
      this.body.position.y = -0.05 * k;
      this.body.position.z = 0.35 * k;
      this.eyes.visible = false;
      this.rig.uDim.value = lerp(1, 0.45, smoothstep(0.6, 3, e.deathT));
      this.rig.uTintAmt.value = 0;
      u.uGlowAmt!.value = 0;
      this.rig.uFlash.value = Math.max(0, 0.6 - e.deathT * 3);
      this.applyPose(this.pose);
      return;
    }
    const { snap, glow } = this.computeTarget(e);
    if (snap) copyPose(this.pose, this.target);
    else blendPose(this.pose, this.pose, this.target, 1 - Math.exp(-worldDt * 12));
    this.applyPose(this.pose);
    // 預備動作發光（橘→紅），受擊閃白；麻痺＝紫色定格、冰寒＝冰藍
    u.uGlowAmt!.value = e.paralyzeT > 0 ? 0 : glow;
    (u.uGlow!.value as THREE.Color).setRGB(1.0, lerp(0.45, 0.12, clamp(glow - 0.2, 0, 1)), 0.05);
    // 麻痺紫、冰寒藍；老兵平常帶一點金色（頭盔）
    this.rig.uTintAmt.value = e.paralyzeT > 0 ? 0.55 : e.slowT > 0 ? 0.4 : e.veteran ? 0.22 : 0;
    this.rig.uTint.value.setHex(e.paralyzeT > 0 ? 0xb07cff : e.slowT > 0 ? 0x6cc4ff : 0xf2c14e);
    this.rig.uFlash.value = e.hurtT > 0 ? (e.hurtT / 0.3) * 0.75 : 0;
    this.rig.uDim.value = 1;
    this.eyes.visible = e.state !== 'sleep';
    const ec = e.state === 'alert' ? 0xff5a1e : e.state === 'search' ? 0xffc040 : 0xb08a50;
    this.eyeMat.color.setHex(ec);
  }

  private applyPose(p: Pose): void {
    this.joints.hips.position.y = p.hipsY;
    for (const k of Object.keys(p.j) as JointName[]) {
      const j = this.joints[k];
      if (!j) continue;
      const v = p.j[k];
      j.rotation.set(v[0], v[1], v[2]);
    }
  }

  dispose(): void {
    this.mat.dispose();
    this.outlineMat.dispose();
    this.eyeMat.dispose();
    this.bolt?.geometry.dispose();
  }
}
