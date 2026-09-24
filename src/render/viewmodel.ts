import * as THREE from 'three';
import { clamp, lerp, smoothstep } from '../core/math';
import type { Player } from '../sim/types';
import { createCharMaterial, createLightRig, createOutlineMaterial, paint, type LightRig, type SharedUniforms } from './materials';

// 第一人稱手部與工具：動作由行動的世界時間驅動（準備 → 作用 → 恢復），與判定同步。

interface Pose3 {
  p: [number, number, number];
  r: [number, number, number];
}

const lp = (a: Pose3, b: Pose3, t: number): Pose3 => ({
  p: [lerp(a.p[0], b.p[0], t), lerp(a.p[1], b.p[1], t), lerp(a.p[2], b.p[2], t)],
  r: [lerp(a.r[0], b.r[0], t), lerp(a.r[1], b.r[1], t), lerp(a.r[2], b.r[2], t)],
});

const SWORD_IDLE: Pose3 = { p: [0.3, -0.34, -0.5], r: [-0.55, 0.2, -0.25] };
const SWORD_UP: Pose3 = { p: [0.42, -0.14, -0.4], r: [0.1, -0.35, -1.25] };
const SWORD_END: Pose3 = { p: [-0.36, -0.3, -0.52], r: [-0.45, 0.45, 1.45] };
const XBOW_IDLE: Pose3 = { p: [0.24, -0.3, -0.58], r: [0.02, 0.04, 0] };
const XBOW_AIM: Pose3 = { p: [0.12, -0.22, -0.52], r: [0, 0, 0] };
const XBOW_RELOAD: Pose3 = { p: [0.22, -0.42, -0.5], r: [-0.55, 0.15, 0.25] };
const STONE_IDLE: Pose3 = { p: [0.36, -0.36, -0.5], r: [0.2, 0, 0] };
const STONE_BACK: Pose3 = { p: [0.46, -0.16, -0.22], r: [-0.6, 0, 0] };
const STONE_THROW: Pose3 = { p: [0.2, -0.18, -0.78], r: [0.6, 0, 0] };
const LEFT_HIDDEN: Pose3 = { p: [-0.45, -0.75, -0.4], r: [0, 0, 0] };
const LEFT_BACK: Pose3 = { p: [-0.42, -0.12, -0.28], r: [-0.5, 0, 0.2] };
const LEFT_THROW: Pose3 = { p: [-0.2, -0.08, -0.85], r: [0.5, 0, 0] };
const LEFT_DRINK: Pose3 = { p: [-0.06, -0.2, -0.32], r: [0.9, 0, 0.6] };
const USE_PUSH: Pose3 = { p: [0.18, -0.26, -0.78], r: [0, 0, 0] };

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly rig: LightRig = createLightRig();
  private right = new THREE.Group();
  private left = new THREE.Group();
  private sword = new THREE.Group();
  private crossbow = new THREE.Group();
  private stone = new THREE.Group();
  private flask = new THREE.Group();
  private flaskBody!: THREE.ShaderMaterial;
  private xbowBolt!: THREE.Mesh;
  private xbowString!: THREE.Mesh;
  private heartGem: THREE.Mesh;
  private mats: THREE.Material[] = [];
  private geos: THREE.BufferGeometry[] = [];
  private outline: THREE.ShaderMaterial;
  private recoil = 0;
  private bob = 0;

  constructor(private shared: SharedUniforms) {
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.02, 10);
    this.outline = createOutlineMaterial(shared, 0.35);
    this.mats.push(this.outline);
    this.scene.add(this.camera);
    this.camera.add(this.right, this.left);
    this.right.scale.setScalar(0.62);
    this.left.scale.setScalar(0.62);
    const gauntlet = this.m(0x55505a);
    const leather = this.m(0x6a4d38);
    const steel = this.m(0xc3cad4, 0xfff0d0);
    const wood = this.m(0x6b4a30);
    const gold = this.m(0xd4a64a);
    // 右手
    this.part(new THREE.BoxGeometry(0.11, 0.1, 0.16), gauntlet, this.right, 0, 0, 0.02);
    this.part(new THREE.CylinderGeometry(0.055, 0.065, 0.32, 7).rotateX(Math.PI / 2), leather, this.right, 0.01, -0.02, 0.2);
    this.part(new THREE.BoxGeometry(0.12, 0.05, 0.12), gauntlet, this.right, 0.01, 0.04, 0.12);
    // 劍
    this.part(new THREE.BoxGeometry(0.035, 0.16, 0.035), wood, this.sword, 0, 0.02, 0);
    this.part(new THREE.BoxGeometry(0.24, 0.035, 0.05), gold, this.sword, 0, 0.11, 0);
    this.part(new THREE.BoxGeometry(0.05, 0.72, 0.012), steel, this.sword, 0, 0.49, 0);
    this.part(new THREE.ConeGeometry(0.025, 0.1, 4).rotateY(Math.PI / 4), steel, this.sword, 0, 0.9, 0);
    this.part(new THREE.SphereGeometry(0.03, 6, 5), gold, this.sword, 0, -0.07, 0);
    this.sword.rotation.set(-0.4, 0, 0);
    this.right.add(this.sword);
    // 弩
    this.part(new THREE.BoxGeometry(0.06, 0.07, 0.62), wood, this.crossbow, 0, 0, -0.18);
    this.part(new THREE.BoxGeometry(0.62, 0.035, 0.05), wood, this.crossbow, 0, 0.03, -0.45);
    this.part(new THREE.BoxGeometry(0.06, 0.04, 0.06), gauntlet, this.crossbow, 0.31, 0.03, -0.43);
    this.part(new THREE.BoxGeometry(0.06, 0.04, 0.06), gauntlet, this.crossbow, -0.31, 0.03, -0.43);
    this.xbowString = this.part(new THREE.BoxGeometry(0.6, 0.006, 0.006), this.m(0xe8e0c8), this.crossbow, 0, 0.05, -0.2, false);
    this.xbowBolt = this.part(new THREE.BoxGeometry(0.018, 0.018, 0.42), gold, this.crossbow, 0, 0.065, -0.4, false);
    this.crossbow.position.set(0, 0.02, -0.02);
    this.right.add(this.crossbow);
    // 石頭
    this.part(new THREE.IcosahedronGeometry(0.055, 0), this.m(0x9d958a), this.stone, 0, 0.05, -0.05);
    this.right.add(this.stone);
    // 左手與瓶子
    this.part(new THREE.BoxGeometry(0.11, 0.1, 0.16), gauntlet, this.left, 0, 0, 0.02);
    this.part(new THREE.CylinderGeometry(0.055, 0.065, 0.32, 7).rotateX(Math.PI / 2), leather, this.left, -0.01, -0.02, 0.2);
    this.flaskBody = this.m(0xbfaef0, 0xc8b8ff);
    this.part(new THREE.SphereGeometry(0.075, 10, 8), this.flaskBody, this.flask, 0, 0.08, -0.04);
    this.part(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 8), this.flaskBody, this.flask, 0, 0.18, -0.04);
    this.part(new THREE.CylinderGeometry(0.028, 0.028, 0.03, 8), wood, this.flask, 0, 0.23, -0.04);
    this.left.add(this.flask);
    // 攜帶沉眠之心時，畫面左下角的冷光寶石
    const gemMat = new THREE.MeshBasicMaterial({ color: 0x8ccaff });
    this.mats.push(gemMat);
    const gemG = new THREE.OctahedronGeometry(0.045, 0).scale(1, 1.35, 1);
    this.geos.push(gemG);
    this.heartGem = new THREE.Mesh(gemG, gemMat);
    this.heartGem.position.set(-0.36, -0.3, -0.55);
    this.heartGem.visible = false;
    this.camera.add(this.heartGem);
  }

  private m(color: number, glow?: number): THREE.ShaderMaterial {
    const mat = createCharMaterial(this.shared, this.rig, color, { glow, desat: 0 });
    // 第一人稱不受霧影響
    mat.uniforms.uFogDensity = { value: 0 };
    this.mats.push(mat);
    return mat;
  }

  private part(g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number, outline = true): THREE.Mesh {
    paint(g, 0xffffff, 1);
    this.geos.push(g);
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    if (outline) mesh.add(new THREE.Mesh(g, this.outline));
    return mesh;
  }

  private setPose(o: THREE.Object3D, p: Pose3): void {
    o.position.set(p.p[0], p.p[1], p.p[2]);
    o.rotation.set(p.r[0], p.r[1], p.r[2]);
  }

  update(p: Player, realDt: number, moveSpeed: number, aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    const a = p.action;
    const tool = p.tool;
    this.sword.visible = tool === 'sword';
    this.crossbow.visible = tool === 'crossbow';
    this.stone.visible = tool === 'stone';
    this.bob += realDt * moveSpeed * 2.2;
    const bobAmt = clamp(moveSpeed / 4.5, 0, 1);
    const bx = Math.sin(this.bob) * 0.012 * bobAmt;
    const by = Math.abs(Math.cos(this.bob)) * 0.014 * bobAmt;
    this.recoil = Math.max(0, this.recoil - realDt * 3);

    let rp: Pose3 = tool === 'sword' ? SWORD_IDLE : tool === 'crossbow' ? XBOW_IDLE : STONE_IDLE;
    let lpose: Pose3 = LEFT_HIDDEN;
    this.flask.visible = false;
    this.xbowBolt.visible = p.arrows > 0;
    this.xbowString.position.z = -0.2;
    if (a) {
      const t = a.t;
      const w = a.windup;
      const act = a.active;
      const rec = a.recovery;
      switch (a.kind) {
        case 'sword':
          if (t < w) rp = lp(SWORD_IDLE, SWORD_UP, smoothstep(0, w, t));
          else if (t < w + act) rp = lp(SWORD_UP, SWORD_END, clamp((t - w) / act, 0, 1));
          else rp = lp(SWORD_END, SWORD_IDLE, smoothstep(0, rec, t - w - act));
          break;
        case 'crossbow':
          if (t < w) rp = lp(XBOW_IDLE, XBOW_AIM, smoothstep(0, w, t));
          else {
            const k = (t - w) / rec;
            if (k < 0.12) {
              rp = XBOW_AIM;
              this.recoil = Math.max(this.recoil, 0.25 * (1 - k / 0.12));
            } else rp = lp(XBOW_AIM, XBOW_RELOAD, Math.sin(clamp((k - 0.12) / 0.88, 0, 1) * Math.PI));
            this.xbowBolt.visible = k > 0.8 && p.arrows > 0;
            this.xbowString.position.z = k < 0.8 ? -0.3 + 0.1 * smoothstep(0.2, 0.8, k) : -0.2;
          }
          break;
        case 'stone':
          if (t < w) rp = lp(STONE_IDLE, STONE_BACK, smoothstep(0, w, t));
          else {
            const k = (t - w) / rec;
            rp = k < 0.3 ? lp(STONE_BACK, STONE_THROW, k / 0.3) : lp(STONE_THROW, STONE_IDLE, smoothstep(0.3, 1, k));
            this.stone.visible = k > 0.7;
          }
          break;
        case 'bottle':
          this.flask.visible = t < w;
          if (t < w) lpose = lp(LEFT_HIDDEN, LEFT_BACK, smoothstep(0, w, t));
          else {
            const k = (t - w) / rec;
            lpose = k < 0.35 ? lp(LEFT_BACK, LEFT_THROW, k / 0.35) : lp(LEFT_THROW, LEFT_HIDDEN, smoothstep(0.35, 1, k));
          }
          this.flaskBody.uniforms.uColor!.value.setHex(0xbfaef0);
          break;
        case 'potion': {
          const k = t / (w + act + rec);
          this.flask.visible = k < 0.92;
          this.flaskBody.uniforms.uColor!.value.setHex(0x37c9a7);
          lpose = k < 0.3 ? lp(LEFT_HIDDEN, LEFT_DRINK, smoothstep(0, 0.3, k)) : k < 0.8 ? LEFT_DRINK : lp(LEFT_DRINK, LEFT_HIDDEN, smoothstep(0.8, 1, k));
          break;
        }
        case 'door':
        case 'use': {
          const k = t / (w + act + rec);
          rp = lp(rp, USE_PUSH, Math.sin(clamp(k, 0, 1) * Math.PI));
          break;
        }
      }
    }
    this.setPose(this.right, rp);
    this.right.position.x += bx;
    this.right.position.y += by;
    this.right.position.z += this.recoil * 0.3;
    this.right.rotation.x += this.recoil;
    this.setPose(this.left, lpose);
    this.left.position.x += bx;
    this.left.position.y += by;
    this.heartGem.visible = p.hasHeart;
    this.heartGem.rotation.y += realDt * 1.5;
  }

  dispose(): void {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
  }
}
