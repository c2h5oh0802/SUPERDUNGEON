import { CLASSES, ENEMIES, PLAYER, SWORD } from '../config';
import { angleDiff, dirFromYawPitch, yawFromDir, type V3 } from '../core/math';
import { AIM_EYE_Y, crosshairPoint } from './aim';
import type { World } from './world';
import type { Enemy, Projectile } from './types';

// 職業的規則特權。兩個職業使用相同的裝備與資源，差別只在這個檔案裡的規則：
// - 戰士：敵人攻擊「鎖定」後揮劍＝反擊斬（出手更快、打斷攻擊）；揮劍作用期間可把弩矢擊開。
// - 獵手：準星對準空中的飛行物時射擊＝疾射（幾乎不花世界時間），箭會修正到與目標交會。

export interface CounterThreat {
  kind: 'guard' | 'charger' | 'archer' | 'bolt';
  id: number;
}

const SWORD_HALF_ARC = ((SWORD.arcDeg / 2) * Math.PI) / 180;

/** 敵人的攻擊是否已「鎖定」：方向不能再改、正要出手。 */
export function attackCommitted(e: Enemy): boolean {
  if (!e.alive || e.state !== 'alert') return false;
  switch (e.kind) {
    case 'guard':
      return e.phase === 'windup' && e.locked;
    case 'charger':
      return (e.phase === 'windup' && e.locked) || e.phase === 'charge';
    case 'archer':
      return e.phase === 'aim' && e.locked;
  }
}

function inFront(w: World, x: number, z: number, slack = 0): boolean {
  const p = w.player;
  const dx = x - p.x;
  const dz = z - p.z;
  if (Math.hypot(dx, dz) < 0.3) return true;
  return Math.abs(angleDiff(yawFromDir(dx, dz), p.yaw)) <= SWORD_HALF_ARC + slack;
}

/**
 * 戰士現在揮劍是否來得及反擊：鎖定的近戰攻擊就在眼前，或弩矢即將從身邊飛過。
 * 介面用同一個判定顯示「反擊」提示，所以提示出現＝現在按下去有效。
 */
export function counterThreat(w: World): CounterThreat | null {
  const p = w.player;
  if (p.cls !== 'warrior' || p.dead) return null;
  const c = CLASSES.warrior;
  const cs = c.counterSwing;
  for (const e of w.enemies) {
    if (!attackCommitted(e)) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz);
    if (!inFront(w, e.x, e.z)) continue;
    if (e.kind === 'guard') {
      // 反擊斬的作用要在盾衛揮下之前開始
      const remain = ENEMIES.guard.windup - e.phaseT;
      if (d <= SWORD.reach + e.radius && remain >= cs.windup - 0.01) return { kind: 'guard', id: e.id };
    } else if (e.kind === 'archer') {
      if (d <= SWORD.reach + e.radius) return { kind: 'archer', id: e.id };
    } else if (e.phase === 'windup') {
      if (d <= SWORD.reach + e.radius + 0.1) return { kind: 'charger', id: e.id };
    } else {
      // 衝鋒中：要在衝鋒線上、還沒撞到
      if (d > c.counterRange || d < c.counterMinChargeDist) continue;
      const fx = -Math.sin(e.lockedYaw);
      const fz = -Math.cos(e.lockedYaw);
      const along = -dx * fx + -dz * fz;
      const perp = Math.abs(-dx * fz + dz * fx);
      if (along > 0 && perp <= e.radius + PLAYER.radius + 0.25) return { kind: 'charger', id: e.id };
    }
  }
  const chest = { x: p.x, y: 1.3, z: p.z };
  for (const b of w.projectiles) {
    if (!b.alive || b.kind !== 'bolt' || b.owner === 'player') continue;
    const rx = chest.x - b.pos.x;
    const ry = chest.y - b.pos.y;
    const rz = chest.z - b.pos.z;
    const d = Math.hypot(rx, ry, rz);
    if (d > c.boltReadyMax || d < c.boltReadyMin) continue;
    const sp = Math.hypot(b.vel.x, b.vel.y, b.vel.z) || 1;
    const along = (rx * b.vel.x + ry * b.vel.y + rz * b.vel.z) / sp;
    if (along <= 0) continue;
    const pass = Math.sqrt(Math.max(0, d * d - along * along));
    if (pass > c.boltPassDist) continue;
    if (!inFront(w, b.pos.x, b.pos.z, 0.15)) continue;
    return { kind: 'bolt', id: b.id };
  }
  return null;
}

/** 戰士的劍命中一個鎖定中的攻擊：打斷它。回傳是否構成反擊。 */
export function applyCounter(w: World, e: Enemy): boolean {
  if (w.player.cls !== 'warrior' || !attackCommitted(e)) return false;
  e.locked = false;
  e.phaseT = 0;
  e.moving = false;
  if (e.kind === 'charger') {
    e.phase = 'stun';
    w.emit({ type: 'stun', id: e.id, x: e.x, y: 1.0, z: e.z });
  } else {
    e.phase = 'stagger';
    e.aimPoint = null;
    e.hitDone = true;
  }
  w.stats.counters++;
  w.emit({ type: 'counter', id: e.id, kind: e.kind, x: e.x, y: e.y + 1.2, z: e.z });
  return true;
}

/** 揮劍作用期間：把劍範圍內飛向自己的弩矢朝準星方向打回去。回傳擊開的數量。 */
export function deflectBolts(w: World): number {
  const p = w.player;
  const a = p.action;
  if (p.cls !== 'warrior' || !a || a.kind !== 'sword') return 0;
  const c = CLASSES.warrior;
  let n = 0;
  for (const b of w.projectiles) {
    if (!b.alive || b.kind !== 'bolt' || b.owner === 'player') continue;
    const dx = b.pos.x - p.x;
    const dy = b.pos.y - 1.3;
    const dz = b.pos.z - p.z;
    if (Math.hypot(dx, dy, dz) > SWORD.reach + c.deflectMargin) continue;
    if (Math.hypot(dx, dz) > 0.3 && Math.abs(angleDiff(yawFromDir(dx, dz), a.lockedYaw)) > SWORD_HALF_ARC + 0.15) continue;
    // 只擊開正在飛向自己的弩矢
    if (b.vel.x * -dx + b.vel.z * -dz <= 0) continue;
    const eye = { x: p.x, y: AIM_EYE_Y, z: p.z };
    const view = dirFromYawPitch(p.yaw, p.pitch);
    const t = crosshairPoint(w, eye, view);
    let vx = t.x - b.pos.x;
    let vy = t.y - b.pos.y;
    let vz = t.z - b.pos.z;
    let len = Math.hypot(vx, vy, vz);
    if (len < 0.5 || vx * view.x + vy * view.y + vz * view.z <= 0) {
      vx = view.x;
      vy = view.y;
      vz = view.z;
      len = 1;
    }
    b.vel = { x: (vx / len) * c.deflectSpeed, y: (vy / len) * c.deflectSpeed, z: (vz / len) * c.deflectSpeed };
    b.avgVel = { ...b.vel };
    b.next = { ...b.pos };
    b.owner = 'player';
    b.deflected = true;
    b.gravity = 0;
    b.age = 0;
    b.hitSet = new Set();
    w.stats.deflects++;
    w.emit({ type: 'deflect', id: b.id, x: b.pos.x, y: b.pos.y, z: b.pos.z });
    n++;
  }
  return n;
}

/** 可以被獵手截擊的飛行物：自己丟出的煙霧瓶、敵人的弩矢。 */
export function interceptable(q: Projectile): boolean {
  if (!q.alive) return false;
  if (q.kind === 'bottle') return q.owner === 'player';
  return q.kind === 'bolt' && q.owner !== 'player';
}

/** 獵手準星附近（錐角內、射程內、沒有牆擋）的空中飛行物；不論目前拿的是什麼工具。 */
export function quickshotTarget(w: World): Projectile | null {
  const p = w.player;
  if (p.cls !== 'huntress' || p.dead) return null;
  const h = CLASSES.huntress;
  const cone = Math.cos((h.assistConeDeg * Math.PI) / 180);
  const eye = { x: p.x, y: AIM_EYE_Y, z: p.z };
  const view = dirFromYawPitch(p.yaw, p.pitch);
  let best: Projectile | null = null;
  let bestCos = cone;
  for (const q of w.projectiles) {
    if (!interceptable(q)) continue;
    const dx = q.pos.x - eye.x;
    const dy = q.pos.y - eye.y;
    const dz = q.pos.z - eye.z;
    const d = Math.hypot(dx, dy, dz);
    if (d > h.assistRange || d < 0.6) continue;
    const cos = (dx * view.x + dy * view.y + dz * view.z) / d;
    if (cos < bestCos) continue;
    if (w.grid.segmentHit(eye, q.pos) !== null) continue;
    best = q;
    bestCos = cos;
  }
  return best;
}

/**
 * 從 origin 以固定速度（含重力）射出、與目標在同一時刻相遇的速度。
 * 目標沿自己的拋物線前進；以固定點迭代求交會時間。找不到合理解時回傳 null。
 */
export function interceptVelocity(origin: V3, speed: number, gravity: number, target: Projectile): V3 | null {
  const at = (t: number): V3 => ({
    x: target.pos.x + target.vel.x * t,
    y: target.pos.y + target.vel.y * t - 0.5 * target.gravity * t * t,
    z: target.pos.z + target.vel.z * t,
  });
  let t = Math.hypot(target.pos.x - origin.x, target.pos.y - origin.y, target.pos.z - origin.z) / speed;
  for (let k = 0; k < 12; k++) {
    const q = at(t);
    const need = Math.hypot(q.x - origin.x, q.y - origin.y + 0.5 * gravity * t * t, q.z - origin.z);
    t = need / speed;
  }
  if (!Number.isFinite(t) || t <= 0 || t > 2) return null;
  const q = at(t);
  return { x: (q.x - origin.x) / t, y: (q.y - origin.y + 0.5 * gravity * t * t) / t, z: (q.z - origin.z) / t };
}
