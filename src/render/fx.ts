import * as THREE from 'three';
import { ENEMIES, SMOKE } from '../config';
import { clamp, forwardFromYaw, smoothstep } from '../core/math';
import type { GameEvent, Projectile } from '../sim/types';
import type { World } from '../sim/world';
import { makeSmokeTexture } from './materials';

// 動態特效：以世界時間推進（慢動作下特效也跟著變慢），數量有上限並重用物件。

const MAX_SPARKS = 320;
const TRAIL_POINTS = 10;
const MAX_TRAILS = 48;

interface ProjVis {
  obj: THREE.Object3D;
  trail: THREE.Vector3[];
  color: THREE.Color;
}

interface Spark {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  r: number;
  g: number;
  b: number;
}

interface SmokeVis {
  group: THREE.Group;
  mat: THREE.SpriteMaterial;
  offsets: THREE.Vector3[];
  sprites: THREE.Sprite[];
}

export class FxVisual {
  readonly group = new THREE.Group();
  private projs = new Map<number, ProjVis>();
  private sparks: Spark[] = [];
  private sparkGeo = new THREE.BufferGeometry();
  private sparkPos = new Float32Array(MAX_SPARKS * 3);
  private sparkCol = new Float32Array(MAX_SPARKS * 3);
  private sparkPoints: THREE.Points;
  private trailGeo = new THREE.BufferGeometry();
  private trailPos = new Float32Array(MAX_TRAILS * (TRAIL_POINTS - 1) * 2 * 3);
  private trailCol = new Float32Array(MAX_TRAILS * (TRAIL_POINTS - 1) * 2 * 3);
  private trailLines: THREE.LineSegments;
  private smokes = new Map<number, SmokeVis>();
  private smokeTex = makeSmokeTexture();
  private aimLines = new Map<number, THREE.Mesh>();
  private streaks = new Map<number, THREE.Mesh>();
  private swordArc: THREE.Mesh;
  private swordArcMat: THREE.MeshBasicMaterial;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private arrowGeo: THREE.BufferGeometry;
  private boltGeo: THREE.BufferGeometry;
  private stoneGeo: THREE.BufferGeometry;
  private bottleGeo: THREE.BufferGeometry;
  private matArrow = new THREE.MeshBasicMaterial({ color: 0xd9c08a });
  private matBolt = new THREE.MeshBasicMaterial({ color: 0xff5a24 });
  private matStone = new THREE.MeshBasicMaterial({ color: 0xb8b0a4 });
  private matBottle = new THREE.MeshBasicMaterial({ color: 0xc6b6ff });
  private aimMat = new THREE.MeshBasicMaterial({ color: 0xff4a20, transparent: true, opacity: 0.6, depthWrite: false });
  private streakMat = new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide });
  private lastWorldTime = 0;

  constructor(private world: World) {
    this.sparkGeo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    this.sparkGeo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparkGeo.setDrawRange(0, 0);
    const sm = new THREE.PointsMaterial({ size: 0.07, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    this.mats.push(sm);
    this.sparkPoints = new THREE.Points(this.sparkGeo, sm);
    this.sparkPoints.frustumCulled = false;
    this.group.add(this.sparkPoints);
    this.trailGeo.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trailGeo.setAttribute('color', new THREE.BufferAttribute(this.trailCol, 3));
    this.trailGeo.setDrawRange(0, 0);
    const tm = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.mats.push(tm);
    this.trailLines = new THREE.LineSegments(this.trailGeo, tm);
    this.trailLines.frustumCulled = false;
    this.group.add(this.trailLines);

    this.arrowGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.72, 5).rotateX(Math.PI / 2);
    this.boltGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.55, 5).rotateX(Math.PI / 2);
    this.stoneGeo = new THREE.IcosahedronGeometry(0.07, 0);
    this.bottleGeo = new THREE.SphereGeometry(0.15, 10, 8);
    this.geos.push(this.arrowGeo, this.boltGeo, this.stoneGeo, this.bottleGeo);
    this.mats.push(this.matArrow, this.matBolt, this.matStone, this.matBottle, this.aimMat, this.streakMat);

    // 劍的揮擊弧：鎖定方向上的一道扇形尾跡（僅視覺，不是碰撞體）
    const arcG = new THREE.RingGeometry(0.9, 2.0, 24, 1, -Math.PI * 0.28, Math.PI * 0.56);
    arcG.rotateX(-Math.PI / 2);
    this.geos.push(arcG);
    this.swordArcMat = new THREE.MeshBasicMaterial({ color: 0xfff0d0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.mats.push(this.swordArcMat);
    this.swordArc = new THREE.Mesh(arcG, this.swordArcMat);
    this.swordArc.visible = false;
    this.group.add(this.swordArc);
    this.lastWorldTime = world.time;
  }

  onEvents(events: GameEvent[]): void {
    for (const e of events) {
      const x = e.x ?? 0;
      const y = e.y ?? 1;
      const z = e.z ?? 0;
      switch (e.type) {
        case 'hitEnemy':
          this.burst(x, y, z, e.head ? 22 : 14, e.sneak ? [1, 0.85, 0.5] : [1, 0.95, 0.85], 3.5, 0.35);
          break;
        case 'shield':
          this.burst(x, y, z, 16, [0.8, 0.9, 1], 4, 0.3);
          break;
        case 'hitWall':
          this.burst(x, y, z, e.kind === 'sword' ? 10 : 7, [1, 0.7, 0.4], 2.5, 0.3);
          break;
        case 'bottleBreak':
          this.burst(x, y, z, 26, [0.85, 0.78, 1], 3.5, 0.5);
          break;
        case 'stun':
          this.burst(x, y, z, 24, [1, 0.8, 0.5], 4.5, 0.5);
          break;
        case 'trapSpike':
          this.burst(x, 0.3, z, 12, [1, 0.6, 0.3], 2.5, 0.3);
          break;
        case 'enemyDeath':
          this.burst(x, (e.y ?? 0) + 1, z, 18, [0.9, 0.85, 1], 2, 0.6);
          break;
        default:
      }
    }
  }

  private burst(x: number, y: number, z: number, n: number, c: [number, number, number], speed: number, life: number): void {
    for (let k = 0; k < n; k++) {
      if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = speed * (0.4 + Math.random() * 0.6);
      const r = Math.sqrt(1 - u * u);
      this.sparks.push({
        x,
        y,
        z,
        vx: Math.cos(a) * r * s,
        vy: Math.abs(u) * s * 0.8 + 0.5,
        vz: Math.sin(a) * r * s,
        life: life * (0.6 + Math.random() * 0.4),
        max: life,
        r: c[0],
        g: c[1],
        b: c[2],
      });
    }
  }

  private projMesh(p: Projectile): ProjVis {
    const obj = new THREE.Group();
    let color = new THREE.Color(0xf2c14e);
    switch (p.kind) {
      case 'arrow': {
        obj.add(new THREE.Mesh(this.arrowGeo, this.matArrow));
        color = new THREE.Color(0xf2c14e);
        break;
      }
      case 'bolt': {
        obj.add(new THREE.Mesh(this.boltGeo, this.matBolt));
        color = new THREE.Color(0xff4a1a);
        break;
      }
      case 'stone':
        obj.add(new THREE.Mesh(this.stoneGeo, this.matStone));
        color = new THREE.Color(0xa09888);
        break;
      case 'bottle':
        obj.add(new THREE.Mesh(this.bottleGeo, this.matBottle));
        color = new THREE.Color(0xb8a8ff);
        break;
    }
    this.group.add(obj);
    return { obj, trail: [], color };
  }

  update(realTime: number): void {
    const w = this.world;
    const wdt = Math.max(0, w.time - this.lastWorldTime);
    this.lastWorldTime = w.time;
    // 投射物與尾跡（尾跡長度以世界時間計，慢動作時不會拖出假殘影）
    const alive = new Set<number>();
    let seg = 0;
    const tp = this.trailPos;
    const tc = this.trailCol;
    for (const p of w.projectiles) {
      alive.add(p.id);
      let v = this.projs.get(p.id);
      if (!v) {
        v = this.projMesh(p);
        this.projs.set(p.id, v);
      }
      v.obj.position.set(p.pos.x, p.pos.y, p.pos.z);
      const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      if (sp > 0.01) v.obj.lookAt(p.pos.x + p.vel.x, p.pos.y + p.vel.y, p.pos.z + p.vel.z);
      if (p.kind === 'bottle') v.obj.rotation.z = p.age * 9;
      // 尾跡：保存最近 0.06 秒世界時間內的位置
      const last = v.trail[0];
      if (!last || last.distanceTo(v.obj.position) > 0.02) v.trail.unshift(v.obj.position.clone());
      const maxLen = sp * 0.06;
      let acc = 0;
      for (let k = 1; k < v.trail.length; k++) {
        acc += v.trail[k]!.distanceTo(v.trail[k - 1]!);
        if (acc > maxLen || k >= TRAIL_POINTS) {
          v.trail.length = k;
          break;
        }
      }
      for (let k = 1; k < v.trail.length && seg < MAX_TRAILS * (TRAIL_POINTS - 1); k++) {
        const a = v.trail[k - 1]!;
        const b = v.trail[k]!;
        const fa = 1 - (k - 1) / TRAIL_POINTS;
        const fb = 1 - k / TRAIL_POINTS;
        const o = seg * 6;
        tp[o] = a.x;
        tp[o + 1] = a.y;
        tp[o + 2] = a.z;
        tp[o + 3] = b.x;
        tp[o + 4] = b.y;
        tp[o + 5] = b.z;
        tc[o] = v.color.r * fa;
        tc[o + 1] = v.color.g * fa;
        tc[o + 2] = v.color.b * fa;
        tc[o + 3] = v.color.r * fb;
        tc[o + 4] = v.color.g * fb;
        tc[o + 5] = v.color.b * fb;
        seg++;
      }
    }
    for (const [id, v] of this.projs) {
      if (!alive.has(id)) {
        v.obj.removeFromParent();
        this.projs.delete(id);
      }
    }
    this.trailGeo.setDrawRange(0, seg * 2);
    (this.trailGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.trailGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    // 火花（世界時間）
    for (let k = this.sparks.length - 1; k >= 0; k--) {
      const s = this.sparks[k]!;
      s.life -= wdt;
      if (s.life <= 0) {
        this.sparks.splice(k, 1);
        continue;
      }
      s.vy -= 9 * wdt;
      s.x += s.vx * wdt;
      s.y += s.vy * wdt;
      s.z += s.vz * wdt;
      if (s.y < 0.02) {
        s.y = 0.02;
        s.vy *= -0.3;
        s.vx *= 0.6;
        s.vz *= 0.6;
      }
    }
    for (let k = 0; k < this.sparks.length; k++) {
      const s = this.sparks[k]!;
      const f = clamp(s.life / s.max, 0, 1);
      this.sparkPos[k * 3] = s.x;
      this.sparkPos[k * 3 + 1] = s.y;
      this.sparkPos[k * 3 + 2] = s.z;
      this.sparkCol[k * 3] = s.r * f;
      this.sparkCol[k * 3 + 1] = s.g * f;
      this.sparkCol[k * 3 + 2] = s.b * f;
    }
    this.sparkGeo.setDrawRange(0, this.sparks.length);
    (this.sparkGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.sparkGeo.attributes.color as THREE.BufferAttribute).needsUpdate = true;

    this.updateSmokes();
    this.updateTelegraphs(realTime);
    this.updateSwordArc();
  }

  private updateSmokes(): void {
    const w = this.world;
    const alive = new Set<number>();
    for (const s of w.smokes) {
      alive.add(s.id);
      let v = this.smokes.get(s.id);
      if (!v) {
        const mat = new THREE.SpriteMaterial({ map: this.smokeTex, color: 0xd8d0ee, transparent: true, depthWrite: false, opacity: 0.85 });
        const group = new THREE.Group();
        const offsets: THREE.Vector3[] = [];
        const sprites: THREE.Sprite[] = [];
        // 固定分布：球內 18 團，視覺範圍與判定球一致
        for (let k = 0; k < 18; k++) {
          const a = k * 2.399;
          const u = ((k * 0.618) % 1) * 2 - 1;
          const r = 0.25 + 0.4 * (((k * 0.37) % 1) * 0.5 + 0.5);
          const q = Math.sqrt(1 - u * u);
          offsets.push(new THREE.Vector3(Math.cos(a) * q * r, u * r * 0.8, Math.sin(a) * q * r));
          const sp = new THREE.Sprite(mat);
          group.add(sp);
          sprites.push(sp);
        }
        group.position.set(s.x, s.y, s.z);
        this.group.add(group);
        v = { group, mat, offsets, sprites };
        this.smokes.set(s.id, v);
      }
      const R = s.radius;
      const fadeIn = smoothstep(0, 0.25, s.age);
      const fadeOut = 1 - smoothstep(SMOKE.life - SMOKE.fadeTime, SMOKE.life, s.age);
      v.mat.opacity = 0.82 * fadeIn * fadeOut;
      v.mat.rotation = s.age * 0.15;
      for (let k = 0; k < v.sprites.length; k++) {
        const o = v.offsets[k]!;
        const drift = s.age * 0.05;
        v.sprites[k]!.position.set(o.x * R + Math.sin(drift + k) * 0.1, o.y * R + drift * 0.3, o.z * R + Math.cos(drift + k) * 0.1);
        const sc = R * (1.05 + ((k * 0.29) % 0.35));
        v.sprites[k]!.scale.set(sc, sc, 1);
      }
    }
    for (const [id, v] of this.smokes) {
      if (!alive.has(id)) {
        v.group.removeFromParent();
        v.mat.dispose();
        this.smokes.delete(id);
      }
    }
  }

  private updateTelegraphs(realTime: number): void {
    const w = this.world;
    const seenAim = new Set<number>();
    const seenStreak = new Set<number>();
    for (const e of w.enemies) {
      if (!e.alive) continue;
      if (e.kind === 'archer' && e.phase === 'aim' && e.aimPoint) {
        seenAim.add(e.id);
        let m = this.aimLines.get(e.id);
        if (!m) {
          const g = new THREE.CylinderGeometry(0.012, 0.012, 1, 4).rotateX(Math.PI / 2).translate(0, 0, -0.5);
          this.geos.push(g);
          m = new THREE.Mesh(g, this.aimMat.clone());
          this.mats.push(m.material as THREE.Material);
          this.group.add(m);
          this.aimLines.set(e.id, m);
        }
        const f = forwardFromYaw(e.yaw);
        const ox = e.x + f.x * 0.55;
        const oy = e.y + 1.45;
        const oz = e.z + f.z * 0.55;
        const tx = e.aimPoint.x;
        const ty = e.aimPoint.y;
        const tz = e.aimPoint.z;
        const len = Math.hypot(tx - ox, ty - oy, tz - oz);
        m.position.set(ox, oy, oz);
        m.lookAt(tx, ty, tz);
        m.rotateY(Math.PI);
        m.scale.set(e.locked ? 1.8 : 1, e.locked ? 1.8 : 1, len);
        const k = clamp(e.phaseT / ENEMIES.archer.aim, 0, 1);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = e.locked ? 0.55 + 0.4 * Math.abs(Math.sin(realTime * 30)) : 0.12 + 0.35 * k;
        mat.color.setRGB(1, e.locked ? 0.15 : 0.45 - 0.25 * k, 0.1);
        m.visible = true;
      }
      if (e.kind === 'charger' && ((e.phase === 'windup' && e.locked) || e.phase === 'charge')) {
        seenStreak.add(e.id);
        let m = this.streaks.get(e.id);
        if (!m) {
          const g = new THREE.PlaneGeometry(0.9, 1).rotateX(-Math.PI / 2).translate(0, 0.03, -0.5);
          this.geos.push(g);
          m = new THREE.Mesh(g, this.streakMat);
          this.group.add(m);
          this.streaks.set(e.id, m);
        }
        const remain = ENEMIES.charger.chargeDist - (e.phase === 'charge' ? e.chargeDist : 0);
        m.position.set(e.x, 0, e.z);
        m.rotation.y = e.lockedYaw;
        m.scale.set(1, 1, Math.max(0.1, remain));
        m.visible = true;
      }
    }
    for (const [id, m] of this.aimLines) if (!seenAim.has(id)) m.visible = false;
    for (const [id, m] of this.streaks) if (!seenStreak.has(id)) m.visible = false;
  }

  private updateSwordArc(): void {
    const a = this.world.player.action;
    if (a && a.kind === 'sword' && a.t >= a.windup) {
      const k = (a.t - a.windup) / Math.max(1e-3, a.active);
      const fade = a.t < a.windup + a.active ? 1 : 1 - smoothstep(0, 0.12, a.t - a.windup - a.active);
      this.swordArcMat.opacity = 0.32 * fade;
      this.swordArc.visible = fade > 0.01;
      const p = this.world.player;
      this.swordArc.position.set(p.x, 1.15 - Math.min(1, k) * 0.15, p.z);
      this.swordArc.rotation.set(0, a.lockedYaw + Math.PI / 2, 0);
    } else this.swordArc.visible = false;
  }

  dispose(): void {
    for (const v of this.smokes.values()) v.mat.dispose();
    this.smokes.clear();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.sparkGeo.dispose();
    this.trailGeo.dispose();
    this.smokeTex.dispose();
    this.group.clear();
  }
}
