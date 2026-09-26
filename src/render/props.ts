import * as THREE from 'three';
import { categoryOf, itemColor } from '../sim/items';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { WORLD } from '../config';
import { smoothstep } from '../core/math';
import type { Pickup, Trap } from '../sim/types';
import type { World } from '../sim/world';
import type { DoorState } from '../sim/grid';
import { sharedFlameTexture } from './levelMesh';
import { LightSampler } from './lightSampler';
import { createCharMaterial, createLightRig, createOutlineMaterial, paint, type LightRig, type SharedUniforms } from './materials';

// 可互動物件與場景道具：門板、寶箱、刻印祭壇、沉眠之心、補給台、尖刺踏板、掉落物。
// 每個物件的零件合併成單一網格（頂點色），減少繪製呼叫。

interface Piece {
  geo: THREE.BufferGeometry;
  color: number;
  glow?: number;
}

function merge(pieces: Piece[]): THREE.BufferGeometry {
  const gs = pieces.map((p) => {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    if (g !== p.geo) p.geo.dispose();
    g.deleteAttribute('uv');
    g = paint(g, p.color, p.glow ?? 0);
    return g;
  });
  const m = mergeGeometries(gs)!;
  gs.forEach((g) => g.dispose());
  m.computeVertexNormals();
  m.computeBoundingSphere();
  return m;
}

function outlineOf(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const c = new THREE.BufferGeometry();
  c.setAttribute('position', g.attributes.position!.clone());
  const sm = mergeVertices(c, 1e-3);
  sm.computeVertexNormals();
  c.dispose();
  return sm;
}

const T = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry => {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
};

interface DoorVis {
  door: DoorState;
  group: THREE.Group;
  bar: THREE.Object3D | null;
}

interface TrapVis {
  trap: Trap;
  spikes: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
}

export class PropsVisual {
  readonly group = new THREE.Group();
  private doors: DoorVis[] = [];
  private traps: TrapVis[] = [];
  private chests: Array<{ id: number; lid: THREE.Group }> = [];
  private altars: Array<{ id: number; rune: THREE.Mesh; runeMat: THREE.MeshBasicMaterial }> = [];
  private heart: { group: THREE.Group; gem: THREE.Mesh; glow: THREE.Sprite } | null = null;
  private pickups = new Map<number, { obj: THREE.Object3D; mat: THREE.ShaderMaterial }>();
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private outline: THREE.ShaderMaterial;
  private runeTex: THREE.CanvasTexture;
  private pickupGeo = new Map<string, { body: THREE.BufferGeometry; outline: THREE.BufferGeometry }>();

  constructor(
    private world: World,
    private shared: SharedUniforms,
    private sampler: LightSampler,
  ) {
    this.outline = createOutlineMaterial(shared, 0.9);
    this.mats.push(this.outline);
    this.runeTex = makeRuneTexture();
    for (const d of world.grid.doors) if (!d.arch) this.doors.push(this.buildDoor(d));
    for (const t of world.traps) this.traps.push(this.buildTrap(t));
    for (const it of world.interactables) {
      if (it.kind === 'chest') this.buildChest(it.id, it.x, it.z, it.yaw);
      else if (it.kind === 'altar') this.buildAltar(it.id, it.x, it.z, it.yaw);
      else if (it.kind === 'heart' && world.level.goal === 'descend') this.buildDescent(it.x, it.z);
      else if (it.kind === 'heart') this.buildHeart(it.x, it.z);
      else if (it.kind === 'resupply') this.buildResupply(it.x, it.z);
    }
  }

  private rigAt(x: number, y: number, z: number): LightRig {
    const r = createLightRig();
    this.sampler.apply(r, x, y, z);
    return r;
  }

  private mat(rig: LightRig, glow = 0xff6a1a, desat = 0.4): THREE.ShaderMaterial {
    const m = createCharMaterial(this.shared, rig, 0xffffff, { glow, desat });
    this.mats.push(m);
    return m;
  }

  private add(geo: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, outline = false): THREE.Mesh {
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, m);
    parent.add(mesh);
    if (outline) {
      const o = outlineOf(geo);
      this.geos.push(o);
      mesh.add(new THREE.Mesh(o, this.outline));
    }
    return mesh;
  }

  private buildDoor(d: DoorState): DoorVis {
    const group = new THREE.Group();
    group.position.set(d.cx, 0, d.cz);
    if (d.axis === 'z') group.rotation.y = Math.PI / 2;
    const m = this.mat(this.rigAt(d.cx, 1.5, d.cz));
    const pieces: Piece[] = [];
    for (let k = 0; k < 5; k++) pieces.push({ geo: T(new THREE.BoxGeometry(0.38, 2.98, 0.14), -0.8 + k * 0.4, 1.49, 0), color: k % 2 ? 0x6d4b31 : 0x654429 });
    for (const y of [0.55, 2.35]) pieces.push({ geo: T(new THREE.BoxGeometry(2.0, 0.14, 0.18), 0, y, 0), color: 0x3a3842 });
    pieces.push({ geo: T(new THREE.TorusGeometry(0.1, 0.022, 6, 12), 0.55, 1.3, 0.11), color: 0x3a3842 });
    pieces.push({ geo: T(new THREE.TorusGeometry(0.1, 0.022, 6, 12), 0.55, 1.3, -0.11), color: 0x3a3842 });
    this.add(merge(pieces), m, group);
    let bar: THREE.Object3D | null = null;
    if (d.barred) {
      const g = merge([{ geo: T(new THREE.BoxGeometry(2.3, 0.2, 0.14), 0, 1.35, 0.17 * (d.axis === 'x' ? d.barSide : -d.barSide)), color: 0x553925 }]);
      bar = this.add(g, m, group, true);
    }
    this.group.add(group);
    return { door: d, group, bar };
  }

  private buildTrap(t: Trap): TrapVis {
    const g = new THREE.Group();
    g.position.set(t.i + 0.5, 0, t.j + 0.5);
    const rig = this.rigAt(t.i + 0.5, 0.3, t.j + 0.5);
    const ringMat = this.mat(rig, 0xff6a1a, 0);
    const ring = new THREE.RingGeometry(0.22, 0.3, 16);
    ring.rotateX(-Math.PI / 2);
    this.add(merge([{ geo: T(new THREE.BoxGeometry(0.86, 0.05, 0.86), 0, 0.02, 0), color: 0x3d3a44 }, { geo: T(ring, 0, 0.052, 0), color: 0x8a5a3a, glow: 1 }]), ringMat, g);
    const cones: Piece[] = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) cones.push({ geo: T(new THREE.ConeGeometry(0.07, 0.55, 5), a * 0.25, 0.275, b * 0.25), color: 0xb9bec8, glow: 0.6 });
    const spikes = this.add(merge(cones), ringMat, g);
    spikes.position.y = -0.56;
    this.group.add(g);
    return { trap: t, spikes, ringMat };
  }

  private buildChest(id: number, x: number, z: number, yaw: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    const m = this.mat(this.rigAt(x, 0.8, z), 0xf2c14e, 0.2);
    this.add(merge([{ geo: T(new THREE.BoxGeometry(0.95, 0.5, 0.62), 0, 0.25, 0), color: 0x7a5233 }, { geo: T(new THREE.BoxGeometry(0.99, 0.08, 0.66), 0, 0.42, 0), color: 0x3f3c46 }]), m, g, true);
    const lid = new THREE.Group();
    lid.position.set(0, 0.5, 0.31);
    g.add(lid);
    const lidG = new THREE.CylinderGeometry(0.31, 0.31, 0.95, 8, 1, false, 0, Math.PI);
    lidG.rotateZ(Math.PI / 2);
    this.add(merge([{ geo: T(lidG, 0, 0, -0.31), color: 0x7a5233 }, { geo: T(new THREE.BoxGeometry(0.14, 0.16, 0.06), 0, 0.02, -0.63), color: 0xd9a94a, glow: 1 }]), m, lid, true);
    this.group.add(g);
    this.chests.push({ id, lid });
  }

  private buildAltar(id: number, x: number, z: number, yaw: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    const m = this.mat(this.rigAt(x, 1.0, z));
    this.add(
      merge([
        { geo: T(new THREE.BoxGeometry(0.95, 0.25, 0.75), 0, 0.125, 0), color: 0x5d544c },
        { geo: T(new THREE.CylinderGeometry(0.32, 0.4, 0.7, 8), 0, 0.6, 0), color: 0x8e8272 },
        { geo: T(new THREE.BoxGeometry(0.9, 0.14, 0.7), 0, 1.02, 0), color: 0x8e8272 },
      ]),
      m,
      g,
      true,
    );
    const runeMat = new THREE.MeshBasicMaterial({ map: this.runeTex, color: 0x6ff0d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mats.push(runeMat);
    const runeG = new THREE.PlaneGeometry(0.7, 0.7);
    runeG.rotateX(-Math.PI / 2);
    const rune = this.add(runeG, runeMat, g);
    rune.position.y = 1.35;
    this.group.add(g);
    this.altars.push({ id, rune, runeMat });
  }

  private buildHeart(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const m = this.mat(this.rigAt(x, 1, z));
    this.add(merge([{ geo: T(new THREE.CylinderGeometry(0.38, 0.55, 1.1, 8), 0, 0.55, 0), color: 0x7f7466 }, { geo: T(new THREE.CylinderGeometry(0.5, 0.42, 0.14, 8), 0, 1.17, 0), color: 0x7f7466 }]), m, g, true);
    const gemMat = new THREE.MeshBasicMaterial({ color: 0x8ccaff });
    this.mats.push(gemMat);
    const gemG = new THREE.OctahedronGeometry(0.2, 0);
    gemG.scale(1, 1.35, 1);
    const gem = this.add(gemG, gemMat, g);
    gem.position.y = 1.62;
    const gm = new THREE.SpriteMaterial({ map: sharedFlameTexture(), color: 0x5aa8ff, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 });
    this.mats.push(gm);
    const glow = new THREE.Sprite(gm);
    glow.scale.set(1.3, 1.3, 1);
    glow.position.y = 1.62;
    g.add(glow);
    this.group.add(g);
    this.heart = { group: g, gem, glow };
  }

  /** 往下一層的階梯口：石拱門＋往下指的青色光錐（互動與碰撞沿用沉眠之心的位置）。 */
  private buildDescent(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const m = this.mat(this.rigAt(x, 1, z));
    this.add(
      merge([
        { geo: T(new THREE.BoxGeometry(1.3, 0.12, 1.3), 0, 0.06, 0), color: 0x4a4540 },
        { geo: T(new THREE.BoxGeometry(0.22, 1.9, 0.3), -0.62, 0.95, 0), color: 0x7f7466 },
        { geo: T(new THREE.BoxGeometry(0.22, 1.9, 0.3), 0.62, 0.95, 0), color: 0x7f7466 },
        { geo: T(new THREE.BoxGeometry(1.5, 0.24, 0.36), 0, 1.98, 0), color: 0x7f7466 },
        { geo: T(new THREE.BoxGeometry(1.0, 0.03, 1.0), 0, 0.13, 0), color: 0x0c0a14 },
      ]),
      m,
      g,
      true,
    );
    const gemMat = new THREE.MeshBasicMaterial({ color: 0x5fe0c8 });
    this.mats.push(gemMat);
    const gemG = new THREE.ConeGeometry(0.2, 0.4, 4);
    gemG.rotateX(Math.PI);
    const gem = this.add(gemG, gemMat, g);
    gem.position.y = 1.2;
    const gm = new THREE.SpriteMaterial({ map: sharedFlameTexture(), color: 0x3fe0c0, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 });
    this.mats.push(gm);
    const glow = new THREE.Sprite(gm);
    glow.scale.set(1.4, 1.4, 1);
    glow.position.y = 0.6;
    g.add(glow);
    this.group.add(g);
    this.heart = { group: g, gem, glow };
  }

  private buildResupply(x: number, z: number): void {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const m = this.mat(this.rigAt(x, 1, z), 0x3fe0c0, 0);
    this.add(
      merge([
        { geo: T(new THREE.BoxGeometry(0.9, 0.8, 0.9), 0, 0.4, 0), color: 0x6d4b31 },
        { geo: T(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 8), -0.2, 0.93, 0), color: 0x3fd0b0, glow: 1 },
        { geo: T(new THREE.CylinderGeometry(0.1, 0.12, 0.26, 8), 0.2, 0.93, 0.1), color: 0xb9a8e8, glow: 1 },
      ]),
      m,
      g,
      true,
    );
    this.group.add(g);
  }

  private pickupGeometry(kind: string, count: number): { body: THREE.BufferGeometry; outline: THREE.BufferGeometry } {
    const key = `${kind}:${count}`;
    let g = this.pickupGeo.get(key);
    if (g) return g;
    const pieces: Piece[] = [];
    if (kind === 'arrows') {
      for (let k = 0; k < count; k++) {
        const ox = count > 1 ? (k - 1) * 0.07 : 0;
        const oz = count > 1 ? (k - 1) * 0.05 : 0;
        const ry = count > 1 ? (k - 1) * 0.25 : 0;
        const shaft = new THREE.BoxGeometry(0.025, 0.025, 0.7);
        const tip = new THREE.ConeGeometry(0.03, 0.09, 4);
        tip.rotateX(-Math.PI / 2);
        tip.translate(0, 0, -0.39);
        const fl = new THREE.BoxGeometry(0.07, 0.005, 0.12);
        fl.translate(0, 0, 0.3);
        for (const [geo, color, glow] of [
          [shaft, 0x9a7a52, 0],
          [tip, 0xd6dde6, 0.5],
          [fl, 0xf2c14e, 1],
        ] as const) {
          geo.rotateY(ry);
          geo.translate(ox, count > 1 ? 0.03 : 0, oz);
          pieces.push({ geo, color, glow });
        }
      }
    } else if (kind === 'ammo') {
      // 彈藥袋：皮袋＋束口（戰士撿到是投擲石，獵手撿到是箭）
      pieces.push({ geo: T(new THREE.SphereGeometry(0.17, 9, 7).scale(1, 0.8, 1), 0, 0.14, 0), color: 0x8a5e3a });
      pieces.push({ geo: T(new THREE.CylinderGeometry(0.06, 0.09, 0.08, 8), 0, 0.29, 0), color: 0x6b4a30 });
      pieces.push({ geo: T(new THREE.TorusGeometry(0.07, 0.015, 5, 10).rotateX(Math.PI / 2), 0, 0.27, 0), color: 0xf2c14e, glow: 1 });
    } else if (kind === 'item:scroll') {
      // 卷軸：捲起來的紙＋封蠟
      pieces.push({ geo: T(new THREE.CylinderGeometry(0.06, 0.06, 0.34, 8).rotateZ(Math.PI / 2), 0, 0.07, 0), color: 0xffffff, glow: 0.4 });
      pieces.push({ geo: T(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8).rotateZ(Math.PI / 2), 0.18, 0.07, 0), color: 0x8a4a30 });
      pieces.push({ geo: T(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 8).rotateZ(Math.PI / 2), -0.18, 0.07, 0), color: 0x8a4a30 });
    } else if (kind === 'item:weapon') {
      pieces.push({ geo: T(new THREE.BoxGeometry(0.05, 0.02, 0.7), 0, 0.05, -0.1), color: 0xffffff, glow: 0.5 });
      pieces.push({ geo: T(new THREE.BoxGeometry(0.2, 0.03, 0.04), 0, 0.05, 0.25), color: 0xd4a64a });
      pieces.push({ geo: T(new THREE.BoxGeometry(0.04, 0.04, 0.16), 0, 0.05, 0.35), color: 0x6b4a30 });
    } else if (kind === 'item:armor') {
      pieces.push({ geo: T(new THREE.BoxGeometry(0.42, 0.34, 0.12), 0, 0.1, 0).rotateX(-Math.PI / 2 + 0.2), color: 0xffffff, glow: 0.3 });
      pieces.push({ geo: T(new THREE.BoxGeometry(0.16, 0.12, 0.12), -0.24, 0.08, -0.1), color: 0xcccccc });
      pieces.push({ geo: T(new THREE.BoxGeometry(0.16, 0.12, 0.12), 0.24, 0.08, -0.1), color: 0xcccccc });
    } else if (kind === 'stone') {
      pieces.push({ geo: T(new THREE.IcosahedronGeometry(0.08, 0), 0, 0.07, 0), color: 0xa8a092, glow: 0.4 });
    } else {
      const teal = kind === 'potion';
      pieces.push({ geo: T(new THREE.SphereGeometry(0.13, 10, 8), 0, 0.13, 0), color: teal ? 0x37c9a7 : 0xb7a6ea, glow: 1 });
      pieces.push({ geo: T(new THREE.CylinderGeometry(0.045, 0.055, 0.12, 8), 0, 0.3, 0), color: teal ? 0x37c9a7 : 0xb7a6ea, glow: 1 });
      pieces.push({ geo: T(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 8), 0, 0.38, 0), color: 0x8a6a48 });
    }
    const body = merge(pieces);
    g = { body, outline: outlineOf(body) };
    this.pickupGeo.set(key, g);
    return g;
  }

  private buildPickup(p: Pickup): { obj: THREE.Object3D; mat: THREE.ShaderMaterial } {
    const rig = this.rigAt(p.x, 0.6, p.z);
    const isItem = p.kind === 'item' && !!p.item;
    const color = isItem
      ? itemColor(this.world.level.seed, p.item!)
      : p.kind === 'arrows' || p.kind === 'ammo'
        ? 0xf2c14e
        : p.kind === 'potion'
          ? 0x3fe0c0
          : p.kind === 'stone'
            ? 0xd8d0c0
            : 0xc8b8ff;
    const mat = this.mat(rig, color, 0);
    // 藥水沿用瓶子的形狀（顏色依這一局的外觀）；其他物品各有形狀
    const cat = isItem ? categoryOf(p.item!) : '';
    const geoKind = isItem ? (cat === 'potion' ? 'bottle' : `item:${cat}`) : p.kind;
    const g = this.pickupGeometry(geoKind, isItem || p.stuckDir ? 1 : Math.min(3, p.amount));
    const obj = new THREE.Mesh(g.body, mat);
    obj.add(new THREE.Mesh(g.outline, this.outline));
    if (p.stuckDir) {
      const d = p.stuckDir;
      obj.position.set(p.x - d.x * 0.1, p.y, p.z - d.z * 0.1);
      obj.lookAt(p.x - d.x * 2, p.y - d.y * 2, p.z - d.z * 2);
      obj.rotateY(Math.PI);
    } else obj.position.set(p.x, p.y, p.z);
    this.group.add(obj);
    return { obj, mat };
  }

  update(realTime: number): void {
    const w = this.world;
    for (const d of this.doors) {
      d.group.position.y = d.door.progress * (WORLD.doorHeight - 0.1);
      if (d.bar) d.bar.visible = d.door.barred;
    }
    for (const t of this.traps) {
      const tr = t.trap;
      let y = -0.56;
      let glow = 0;
      if (tr.state === 'armed') {
        glow = 0.4 + 0.6 * smoothstep(0, 0.5, tr.t) + 0.3 * Math.sin(tr.t * 40);
        y = -0.5;
      } else if (tr.state === 'spikes') {
        y = -0.56 + 0.56 * smoothstep(0, 0.05, tr.t);
        glow = 1.2;
      } else if (tr.state === 'reset') {
        y = -0.56 * smoothstep(0, 0.8, tr.t);
        glow = 0.2 * (1 - smoothstep(0, 1, tr.t));
      }
      t.spikes.position.y = y;
      t.ringMat.uniforms.uGlowAmt!.value = glow;
    }
    for (const c of this.chests) {
      const it = w.interactables.find((i) => i.id === c.id)!;
      const target = it.used ? -1.9 : 0;
      c.lid.rotation.x += (target - c.lid.rotation.x) * 0.15;
    }
    for (const a of this.altars) {
      const it = w.interactables.find((i) => i.id === a.id)!;
      a.rune.visible = !it.used;
      a.rune.rotation.y = realTime * 0.4;
      a.runeMat.opacity = 0.65 + 0.3 * Math.sin(realTime * 2.2);
    }
    if (this.heart) {
      const taken = w.heartTaken;
      this.heart.gem.visible = !taken;
      this.heart.glow.visible = !taken;
      this.heart.gem.rotation.y = realTime * 0.8;
      this.heart.gem.position.y = (w.level.goal === 'descend' ? 1.2 : 1.62) + Math.sin(realTime * 1.6) * 0.05;
    }
    // 掉落物：輕微發光脈動，表示可以拾取
    const pulse = 0.18 + 0.14 * Math.sin(realTime * 3);
    const alive = new Set<number>();
    for (const p of w.pickups) {
      if (p.taken) continue;
      alive.add(p.id);
      let v = this.pickups.get(p.id);
      if (!v) {
        v = this.buildPickup(p);
        this.pickups.set(p.id, v);
      }
      v.mat.uniforms.uGlowAmt!.value = pulse;
      if (!p.stuckDir && p.kind !== 'arrows' && p.kind !== 'stone') {
        v.obj.rotation.y = realTime * 1.2 + p.id;
        v.obj.position.y = p.y + 0.04 + Math.sin(realTime * 2 + p.id) * 0.03;
      }
    }
    for (const [id, v] of this.pickups) {
      if (!alive.has(id)) {
        v.obj.removeFromParent();
        v.mat.dispose();
        this.pickups.delete(id);
      }
    }
  }

  heartPosition(): THREE.Vector3 | null {
    if (!this.heart || this.world.heartTaken) return null;
    return this.heart.group.position.clone().setY(1.6);
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const v of this.pickups.values()) v.mat.dispose();
    for (const g of this.geos) g.dispose();
    for (const g of this.pickupGeo.values()) {
      g.body.dispose();
      g.outline.dispose();
    }
    this.runeTex.dispose();
    this.group.clear();
  }
}

function makeRuneTexture(): THREE.CanvasTexture {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(64, 64, 52, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 3;
  g.beginPath();
  g.arc(64, 64, 38, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 5;
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 - Math.PI / 2;
    g.moveTo(64, 64);
    g.lineTo(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34);
  }
  g.stroke();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.fillRect(64 + Math.cos(a) * 45 - 3, 64 + Math.sin(a) * 45 - 3, 6, 6);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
