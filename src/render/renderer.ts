import * as THREE from 'three';
import { PLAYER, RENDER } from '../config';
import { clamp, lerp } from '../core/math';
import type { GameEvent } from '../sim/types';
import type { World } from '../sim/world';
import { Occluder } from './bake';
import { EnemyVisual } from './characters';
import { FxVisual } from './fx';
import { buildLevelVisual, type LevelVisual } from './levelMesh';
import { LightSampler } from './lightSampler';
import { createEnvMaterial, createSharedUniforms, type SharedUniforms } from './materials';
import { PropsVisual } from './props';
import { Viewmodel } from './viewmodel';

interface RunVisual {
  world: World;
  level: LevelVisual;
  props: PropsVisual;
  fx: FxVisual;
  enemies: EnemyVisual[];
  sampler: LightSampler;
}

export interface RenderOptions {
  reducedMotion: boolean;
  fov: number;
  pixelRatio: number;
}

/** 單一 WebGLRenderer，跨局重用；每局的場景物件在 clearWorld() 時完整釋放。 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly shared: SharedUniforms = createSharedUniforms();
  private envMaterial: THREE.ShaderMaterial;
  private viewmodel: Viewmodel;
  private run: RunVisual | null = null;
  private slow = 0;
  private hurtKick = 0;
  private deathT = 0;
  private realTime = 0;
  private lightT = 0;
  private visT = 0;
  lastBakeMs = 0;
  lastVertexCount = 0;
  opts: RenderOptions = { reducedMotion: false, fov: RENDER.fov, pixelRatio: RENDER.maxPixelRatio };

  constructor(canvas: HTMLCanvasElement) {
    const low = new URLSearchParams(location.search).get('gfx') === 'low';
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !low, powerPreference: 'high-performance' });
    if (low) this.opts.pixelRatio = 0.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.opts.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.autoClear = false;
    this.camera = new THREE.PerspectiveCamera(RENDER.fov, 1, 0.05, 90);
    this.camera.rotation.order = 'YXZ';
    this.scene.background = new THREE.Color(RENDER.fogColor);
    this.scene.fog = new THREE.FogExp2(RENDER.fogColor, RENDER.fogDensity);
    this.scene.add(this.camera);
    this.envMaterial = createEnvMaterial(this.shared);
    this.viewmodel = new Viewmodel(this.shared);
  }

  setOptions(o: Partial<RenderOptions>): void {
    const low = new URLSearchParams(location.search).get('gfx') === 'low';
    this.opts = { ...this.opts, ...o };
    if (low) this.opts.pixelRatio = 0.5;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.opts.pixelRatio));
    this.camera.fov = this.opts.fov;
    this.camera.updateProjectionMatrix();
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setWorld(world: World): void {
    this.clearWorld();
    const level = buildLevelVisual(world.level, this.envMaterial);
    this.lastBakeMs = level.bakeMs;
    this.lastVertexCount = level.vertexCount;
    const occ = new Occluder(world.grid);
    const sampler = new LightSampler(level.lights, occ);
    const props = new PropsVisual(world, this.shared, sampler);
    const fx = new FxVisual(world);
    const enemies = world.enemies.map((e) => {
      const v = new EnemyVisual(e, this.shared);
      sampler.apply(v.rig, e.x, 1.2, e.z);
      return v;
    });
    this.scene.add(level.group, props.group, fx.group);
    for (const v of enemies) this.scene.add(v.root);
    this.run = { world, level, props, fx, enemies, sampler };
    this.deathT = 0;
    this.hurtKick = 0;
    this.slow = 0;
    const h = world.level.heart;
    (this.shared.uAccentPos.value as THREE.Vector3).set(h ? h.x : 0, h ? 1.7 : -100, h ? h.z : 0);
  }

  clearWorld(): void {
    const r = this.run;
    if (!r) return;
    this.scene.remove(r.level.group, r.props.group, r.fx.group);
    r.level.dispose();
    r.props.dispose();
    r.fx.dispose();
    for (const v of r.enemies) {
      this.scene.remove(v.root);
      v.dispose();
    }
    this.run = null;
  }

  onEvents(events: GameEvent[]): void {
    const r = this.run;
    if (!r) return;
    r.fx.onEvents(events);
    for (const e of events) {
      if (e.type === 'playerHurt' && !this.opts.reducedMotion) this.hurtKick = 1;
      if (e.type === 'heart') (this.shared.uAccentPos.value as THREE.Vector3).set(0, -100, 0);
    }
  }

  /** 每幀渲染。realDt 用於鏡頭、火光等真實時間效果。 */
  render(realDt: number, paused: boolean): void {
    const r = this.run;
    this.realTime += realDt;
    this.shared.uTime.value = this.realTime;
    this.renderer.clear();
    if (!r) return;
    const w = r.world;
    const p = w.player;
    // 世界流速 → 環境降彩度（平滑）
    const rate = w.lastRealDt > 0 ? w.lastWorldDt / w.lastRealDt : paused ? 0 : 1;
    const targetSlow = paused ? this.slow : clamp((1 - rate) / 0.9, 0, 1);
    this.slow = lerp(this.slow, targetSlow, 1 - Math.exp(-realDt * 10));
    this.shared.uSlow.value = this.slow;

    // 鏡頭
    const cam = this.camera;
    let eye: number = PLAYER.eyeHeight;
    let roll = 0;
    if (p.dead) {
      this.deathT += realDt;
      const k = clamp(this.deathT / 1.1, 0, 1);
      eye = lerp(PLAYER.eyeHeight, 0.35, k * k);
      roll = 0.9 * k;
    }
    this.hurtKick = Math.max(0, this.hurtKick - realDt * 5);
    cam.position.set(p.x, eye, p.z);
    cam.rotation.set(p.pitch + this.hurtKick * 0.04, p.yaw, roll);
    (this.shared.uLanternPos.value as THREE.Vector3).set(p.x, eye + 0.3, p.z);

    // 物件
    const wdt = w.lastWorldDt;
    r.props.update(this.realTime);
    r.fx.update(this.realTime);
    this.lightT -= realDt;
    const relight = this.lightT <= 0;
    if (relight) this.lightT = 0.25;
    // 只畫看得到的敵人（牆與關閉的門後方的不畫）
    this.visT -= realDt;
    const recheck = this.visT <= 0;
    if (recheck) this.visT = 0.1;
    for (const v of r.enemies) {
      if (recheck) v.root.visible = this.enemyVisible(w, v.enemy.x, v.enemy.z, cam.position.x, cam.position.z);
      if (!v.root.visible) continue;
      v.update(v.enemy, wdt);
      if (relight && (v.enemy.moving || v.enemy.phase === 'charge')) r.sampler.apply(v.rig, v.enemy.x, 1.2, v.enemy.z);
    }
    const fm = r.level.flameMaterial;
    fm.uniforms.uTime!.value = this.realTime;
    fm.uniforms.uScale!.value = (this.renderer.domElement.height / 2) / Math.tan((cam.fov * Math.PI) / 360);
    if (relight) r.sampler.apply(this.viewmodel.rig, p.x, 1.4, p.z);
    this.renderer.render(this.scene, cam);
    this.lastCalls = this.renderer.info.render.calls;
    // 第一人稱：清除深度後疊在最上層（不穿牆）
    if (!p.dead) {
      this.renderer.clearDepth();
      const speed = w.lastRealDt > 0 ? p.lastMoveDist / w.lastRealDt : 0;
      this.viewmodel.update(p, realDt, speed, cam.aspect);
      this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);
    }
  }

  /** 2D 視線（牆、關閉的門）：相機到敵人中心或兩側任一條通即可見。 */
  private enemyVisible(w: World, ex: number, ez: number, cx: number, cz: number): boolean {
    const dx = ex - cx;
    const dz = ez - cz;
    const d = Math.hypot(dx, dz);
    if (d < 3) return true;
    if (d > 45) return false;
    const px = (-dz / d) * 0.45;
    const pz = (dx / d) * 0.45;
    return this.ray2D(w, cx, cz, ex, ez) || this.ray2D(w, cx, cz, ex + px, ez + pz) || this.ray2D(w, cx, cz, ex - px, ez - pz);
  }

  private ray2D(w: World, ax: number, az: number, bx: number, bz: number): boolean {
    const g = w.grid;
    const dx = bx - ax;
    const dz = bz - az;
    let i = Math.floor(ax);
    let j = Math.floor(az);
    const ie = Math.floor(bx);
    const je = Math.floor(bz);
    const si = dx > 0 ? 1 : -1;
    const sj = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
    const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
    let tmx = dx > 0 ? (i + 1 - ax) * tdx : dx < 0 ? (ax - i) * tdx : Infinity;
    let tmz = dz > 0 ? (j + 1 - az) * tdz : dz < 0 ? (az - j) * tdz : Infinity;
    for (let k = 0; k < 200; k++) {
      if (i === ie && j === je) return true;
      if (tmx < tmz) {
        i += si;
        tmx += tdx;
      } else {
        j += sj;
        tmz += tdz;
      }
      if (i === ie && j === je) return true;
      if (g.sightBlocked2D(i, j)) return false;
    }
    return true;
  }

  debugHide(what: 'enemies' | 'level' | 'props' | 'none'): void {
    const r = this.run;
    if (!r) return;
    for (const v of r.enemies) v.root.visible = what !== 'enemies';
    r.level.group.visible = what !== 'level';
    r.props.group.visible = what !== 'props';
  }

  /** 本幀（含第一人稱）的繪製呼叫數。 */
  lastCalls = 0;

  heartScreenAnchor(): THREE.Vector3 | null {
    return this.run?.props.heartPosition() ?? null;
  }

  /** 世界座標投影到螢幕（0..1）；在鏡頭後方回傳 null。 */
  project(x: number, y: number, z: number): { x: number; y: number } | null {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    if (v.z > 1 || v.z < -1) return null;
    return { x: (v.x + 1) / 2, y: (1 - v.y) / 2 };
  }

  info(): { geometries: number; textures: number; programs: number; calls: number; triangles: number } {
    const i = this.renderer.info;
    return {
      geometries: i.memory.geometries,
      textures: i.memory.textures,
      programs: i.programs?.length ?? 0,
      calls: i.render.calls,
      triangles: i.render.triangles,
    };
  }
}
