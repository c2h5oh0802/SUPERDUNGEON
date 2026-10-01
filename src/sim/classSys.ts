import { ACTIONS, CLASSES, ENEMIES, ITEM_FX, NOISE, PLAYER, PROJECTILES, SHIELD, SHOVE, TALENT_FX, TIME, TIPS, UPGRADE, WEAPONS } from '../config';
import { meleeCandidates } from './meleeTargets';
import { hasTalent } from './progress';
import { angleDiff, dirFromYawPitch, forwardFromYaw, yawFromDir, type V3 } from '../core/math';
import { AIM_EYE_Y, aimPoint, crosshairPoint } from './aim';
import { becomeAlert } from './enemySys';
import type { World } from './world';
import type { Enemy, Projectile } from './types';

// 職業規則：
// - 戰士：敵人攻擊「鎖定」後揮劍＝反擊斬（出手更快、打斷攻擊）；揮劍作用期間可把弩矢擊開；臂盾盾推。
// - 獵手：藥劑箭改變敵人的時間軸（見 projectileSys、enemySys）；獵人之眼只提供資訊，不修改彈道。

export interface CounterThreat {
  kind: 'guard' | 'charger' | 'archer' | 'warden' | 'bolt';
  id: number;
}

/** 目前近戰武器的半弧角（反擊、擊開用）。 */
const meleeHalfArc = (w: World) => ((WEAPONS[w.player.weapon.id].arcDeg / 2) * Math.PI) / 180;
const meleeReach = (w: World) => WEAPONS[w.player.weapon.id].reach;

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
    case 'warden':
      return (e.phase === 'windup' && e.locked && (e.warden?.attack === 'cleave' || e.warden?.attack === 'rush')) ||
        (e.phase === 'aim' && e.locked && e.warden?.attack === 'lance') ||
        (e.phase === 'charge' && e.warden?.attack === 'rush');
  }
}

function inFront(w: World, x: number, z: number, slack = 0): boolean {
  const p = w.player;
  const dx = x - p.x;
  const dz = z - p.z;
  if (Math.hypot(dx, dz) < 0.3) return true;
  return Math.abs(angleDiff(yawFromDir(dx, dz), p.yaw)) <= meleeHalfArc(w) + slack;
}

/** A rush that ends or hits an obstacle before sword contact cannot be Countered. */
function canCounterWardenRush(w: World, e: Enemy, along: number, perp: number, reach: number): boolean {
  const s = ENEMIES.warden;
  const timeMul = w.player.hasteT > 0 ? ITEM_FX.haste.timeMul : 1;
  const windup = CLASSES.warrior.counterSwing.windup * timeMul;
  // First entry into sword reach on the already locked straight path.
  if (perp > reach) return false;
  const enter = Math.max(0, along - Math.sqrt(reach * reach - perp * perp));
  const enemyTime = enter / s.rushSpeed;
  const slowedTime = e.slowT * TIPS.chill.timeScale;
  const reachTime = enter === 0 ? 0 : e.paralyzeT + (enemyTime <= slowedTime
    ? enemyTime / TIPS.chill.timeScale : e.slowT + enemyTime - slowedTime);
  const contactTime = Math.max(windup, reachTime);
  if (contactTime >= windup + WEAPONS[w.player.weapon.id].active * timeMul - 1e-9) return false;
  const movingTime = Math.max(0, contactTime - e.paralyzeT);
  const travel = s.rushSpeed * (movingTime - Math.min(movingTime, e.slowT) * (1 - TIPS.chill.timeScale));
  if (s.rushDist - e.chargeDist <= travel + 1e-8) return false;
  const f = forwardFromYaw(e.lockedYaw);
  // Sweep the boss's actual body, including corner/pillar clips that a sight ray misses.
  const steps = Math.max(1, Math.ceil(travel / .04));
  for (let k = 1; k <= steps; k++) {
    const x = e.x + f.x * travel * k / steps;
    const z = e.z + f.z * travel * k / steps;
    if (w.grid.circleBlocked(x, z, e.radius)) return false;
    if (Math.hypot(w.player.x - x, w.player.z - z) <= e.radius + PLAYER.radius) return false;
    if (w.enemies.some(o => o !== e && o.alive && !o.perched && Math.hypot(o.x - x, o.z - z) < o.radius + e.radius)) return false;
  }
  return true;
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
  const hittable = new Set(meleeCandidates(w, p.weapon.id, p.yaw, Math.max(meleeReach(w) + c.counterLunge, c.counterRange))
    .slice(0, WEAPONS[p.weapon.id].maxTargets).map(e => e.id));
  for (const e of w.enemies) {
    if (!attackCommitted(e)) continue;
    if (!hittable.has(e.id)) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz);
    if (!inFront(w, e.x, e.z)) continue;
    const reach = meleeReach(w) + c.counterLunge + e.radius;
    if (e.kind === 'warden' && e.phase !== 'charge') {
      // Each fixed tell must leave enough time for the counter swing to connect.
      const s = ENEMIES.warden;
      const duration = e.warden?.attack === 'lance' ? s.lanceAim : e.warden?.attack === 'rush' ? s.rushWindup : s.cleaveWindup;
      if (d <= reach && duration - e.phaseT >= cs.windup) return { kind: 'warden', id: e.id };
    } else if (e.kind === 'guard') {
      // 反擊斬的作用要在盾衛揮下之前開始
      const remain = ENEMIES.guard.windup - e.phaseT;
      if (d <= reach && remain >= cs.windup - 0.01) return { kind: 'guard', id: e.id };
    } else if (e.kind === 'archer') {
      if (d <= reach) return { kind: 'archer', id: e.id };
    } else if (e.phase === 'windup') {
      if (d <= reach) return { kind: 'charger', id: e.id };
    } else {
      // 衝鋒中：要在衝鋒線上、還沒撞到
      if (d > c.counterRange || d < c.counterMinChargeDist) continue;
      const fx = -Math.sin(e.lockedYaw);
      const fz = -Math.cos(e.lockedYaw);
      const along = -dx * fx + -dz * fz;
      const perp = Math.abs(-dx * fz + dz * fx);
      if (e.kind === 'warden' && !canCounterWardenRush(w, e, along, perp, reach)) continue;
      if (along > 0 && perp <= e.radius + PLAYER.radius + 0.25) return { kind: e.kind === 'warden' ? 'warden' : 'charger', id: e.id };
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
    if (b.lifetime !== undefined) {
      const radius = meleeReach(w) + c.deflectMargin;
      if (pass > radius) continue;
      const timeMul = p.hasteT > 0 ? ITEM_FX.haste.timeMul : 1;
      const windup = cs.windup * timeMul;
      const contact = Math.max(windup, (along - Math.sqrt(radius * radius - pass * pass)) / sp);
      if (b.lifetime - b.age <= contact + TIME.maxSubstep + 1e-8 || contact >= windup + WEAPONS[p.weapon.id].active * timeMul) continue;
    }
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
    e.staggerDur = e.kind === 'warden' ? ENEMIES.warden.stagger : e.kind === 'guard' ? ENEMIES.guard.stagger : ENEMIES.archer.stagger;
    e.aimPoint = null;
    e.hitDone = true;
    if (e.warden) e.warden.attack = null;
  }
  w.stats.counters++;
  w.emit({ type: 'counter', id: e.id, kind: e.kind, x: e.x, y: e.y + 1.2, z: e.z });
  return true;
}

/** 揮劍作用期間：把劍範圍內飛向自己的弩矢朝準星方向打回去。回傳擊開的數量。 */
export function deflectBolts(w: World): number {
  const p = w.player;
  const a = p.action;
  if (p.cls !== 'warrior' || !a || a.kind !== 'melee') return 0;
  const c = CLASSES.warrior;
  let n = 0;
  for (const b of w.projectiles) {
    if (!b.alive || b.kind !== 'bolt' || b.owner === 'player') continue;
    const dx = b.pos.x - p.x;
    const dy = b.pos.y - 1.3;
    const dz = b.pos.z - p.z;
    if (Math.hypot(dx, dy, dz) > meleeReach(w) + c.deflectMargin) continue;
    if (Math.hypot(dx, dz) > 0.3 && Math.abs(angleDiff(yawFromDir(dx, dz), a.lockedYaw)) > meleeHalfArc(w) + 0.15) continue;
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
    // The returned lance is an ordinary deflected bolt, not the boss's damage.
    delete b.damage;
    delete b.source;
    delete b.lifetime;
    b.gravity = 0;
    b.age = 0;
    b.hitSet = new Set();
    w.stats.deflects++;
    w.emit({ type: 'deflect', id: b.id, x: b.pos.x, y: b.pos.y, z: b.pos.z });
    n++;
  }
  return n;
}

// ---------- 戰士：臂盾 ----------

const SHIELD_HALF_ARC = ((SHIELD.arcDeg / 2) * Math.PI) / 180;

/** 盾推的作用期間（擋下正面的攻擊與飛行物）。 */
export function shieldActive(w: World): boolean {
  const p = w.player;
  const a = p.action;
  if (!SHIELD.enabled || p.cls !== 'warrior' || p.dead || !a || a.kind !== 'shield') return false;
  const extra = UPGRADE.shieldActive * p.shieldLevel + (hasTalent(p, 'bulwark') ? TALENT_FX.bulwarkActive : 0);
  return a.t >= a.windup - 1e-9 && a.t <= a.windup + a.active + extra + 1e-9;
}

/** 從 (x, z) 來的攻擊現在會不會被臂盾擋下。 */
export function shieldBlocks(w: World, x: number, z: number): boolean {
  if (!shieldActive(w)) return false;
  const p = w.player;
  const dx = x - p.x;
  const dz = z - p.z;
  if (Math.hypot(dx, dz) < 0.05) return true;
  return Math.abs(angleDiff(yawFromDir(dx, dz), p.action!.lockedYaw)) <= SHIELD_HALF_ARC;
}

/** 現在盾推會推到的敵人：身前、推得到、沒有被牆隔開；衝鋒中的突進者推不動，也不能擋。 */
export function pushTarget(w: World, yaw = w.player.yaw): Enemy | null {
  const p = w.player;
  if (p.cls !== 'warrior' || p.dead) return null;
  let best: Enemy | null = null;
  let bestGap = Infinity;
  for (const e of w.enemies) {
    if (!e.alive || e.perched || e.y > 0.5 || e.push) continue;
    if ((e.kind === 'charger' || e.kind === 'warden') && e.phase === 'charge') continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const gap = Math.hypot(dx, dz) - PLAYER.radius - e.radius;
    if (gap > SHOVE.pushReach || gap >= bestGap) continue;
    if (Math.abs(angleDiff(yawFromDir(dx, dz), yaw)) > ((SHOVE.arcDeg / 2) * Math.PI) / 180) continue;
    const hit = w.grid.segmentHit({ x: p.x, y: 1.0, z: p.z }, { x: e.x, y: 1.0, z: e.z });
    if (hit && hit.t < 0.95) continue;
    best = e;
    bestGap = gap;
  }
  return best;
}

/** 推擊出手：鎖定方向，只位移身前一名敵人；撞牆或同伴才失衡。 */
export function shieldPush(w: World): void {
  const p = w.player;
  const a = p.action!;
  a.lockedYaw = p.yaw;
  const e = pushTarget(w, p.yaw);
  const f = forwardFromYaw(p.yaw);
  w.emit({ type: 'push', id: e?.id ?? -1, x: p.x + f.x * 0.8, y: 1.2, z: p.z + f.z * 0.8 });
  if (!e) return;
  w.stats.pushes++;
  const dx = e.x - p.x;
  const dz = e.z - p.z;
  const d = Math.hypot(dx, dz) || 1;
  // Displacement does not cancel or pause the enemy's current attack/reload.
  e.push = { dx: dx / d, dz: dz / d, left: SHOVE.pushDist };
  if (e.state !== 'alert') becomeAlert(w, e);
  w.emitNoise(e.x, 1, e.z, NOISE.combatHit, 'shield');
}

/** 衝鋒中的突進者撞上舉起的臂盾：戰士被推退，沒有傷害。 */
export function recoilPlayer(w: World, dirX: number, dirZ: number, dist: number): void {
  const p = w.player;
  const n = Math.max(1, Math.ceil(dist / 0.08));
  for (let k = 0; k < n; k++) {
    const r = w.grid.resolveCircle(p.x + (dirX * dist) / n, p.z + (dirZ * dist) / n, PLAYER.radius);
    p.x = r.x;
    p.z = r.z;
  }
  p.vx = 0;
  p.vz = 0;
}

// ---------- 獵手：獵人之眼 ----------

export interface HunterEye {
  /** 空中的煙霧瓶 id。 */
  id: number;
  /** 照現在的軌跡落地（或撞牆）的位置。 */
  landing: V3 | null;
  /** 現在瞄準這個方向射一般箭，就會和瓶子在同一刻交會（考慮出手前的準備時間）。 */
  aim: { yaw: number; pitch: number } | null;
  /** 交會點。 */
  meet: V3 | null;
}

function ballistic(q: { pos: V3; vel: V3; gravity: number }, t: number): { pos: V3; vel: V3 } {
  return {
    pos: { x: q.pos.x + q.vel.x * t, y: q.pos.y + q.vel.y * t - 0.5 * q.gravity * t * t, z: q.pos.z + q.vel.z * t },
    vel: { x: q.vel.x, y: q.vel.y - q.gravity * t, z: q.vel.z },
  };
}

/** 飛行物照現在的軌跡最先碰到地形的時間與位置。 */
function landingOf(w: World, q: Projectile, maxT: number): { t: number; at: V3 } | null {
  const step = 1 / 60;
  let prev = q.pos;
  for (let t = step; t <= maxT + 1e-9; t += step) {
    const next = ballistic(q, t).pos;
    const hit = w.grid.segmentHit(prev, next, false, q.radius);
    if (hit) return { t: t - step + hit.t * step, at: { x: hit.x, y: hit.y, z: hit.z } };
    prev = next;
  }
  return null;
}

/** 箭的出手點（與 fireProjectile 相同）。 */
function bowOrigin(w: World, yaw: number): V3 {
  const p = w.player;
  const f = forwardFromYaw(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  return { x: p.x + f.x * 0.45 + rx * 0.16, y: AIM_EYE_Y - 0.12, z: p.z + f.z * 0.45 + rz * 0.16 };
}

/** 下一支箭離弦前還要多少世界時間。 */
function timeToRelease(w: World): number {
  const a = w.player.action;
  const bw = ACTIONS.bow.windup;
  if (!a) return bw;
  if (a.kind === 'bow' && !a.fired) return Math.max(0, a.windup - a.t);
  return Math.max(0, a.windup + a.active + a.recovery - a.t) + bw;
}

/** 獵人之眼：拿著弓時，每個空中的煙霧瓶的落點與提前量。敵人不給提前量。 */
export function hunterEye(w: World): HunterEye[] {
  const p = w.player;
  if (p.cls !== 'huntress' || p.dead || (p.desiredTool !== 'bow' && p.desiredTool !== 'tipped')) return [];
  const out: HunterEye[] = [];
  const maxT = CLASSES.huntress.eyeMaxT;
  const eye = { x: p.x, y: AIM_EYE_Y, z: p.z };
  for (const q of w.projectiles) {
    if (!q.alive || q.kind !== 'bottle' || q.owner !== 'player') continue;
    const land = landingOf(w, q, maxT);
    const info: HunterEye = { id: q.id, landing: land ? land.at : null, aim: null, meet: null };
    const delay = timeToRelease(w);
    if (!land || land.t > delay + 0.02) {
      const s = ballistic(q, delay);
      const future = { ...q, pos: s.pos, vel: s.vel } as Projectile;
      const spec = PROJECTILES.arrow;
      let yaw = yawFromDir(s.pos.x - p.x, s.pos.z - p.z);
      let view: V3 | null = null;
      let meet: V3 | null = null;
      for (let k = 0; k < 4; k++) {
        const origin = bowOrigin(w, yaw);
        const v = interceptVelocity(origin, spec.speed, spec.gravity, future);
        if (!v) {
          view = null;
          break;
        }
        const sp = Math.hypot(v.x, v.y, v.z) || 1;
        const dir = { x: v.x / sp, y: v.y / sp, z: v.z / sp };
        // fireProjectile 從出手點射向「視線打到的地形」：找出讓這條線與所需方向一致的視線
        const far = aimPoint(w, origin, dir);
        const vx = far.x - eye.x;
        const vy = far.y - eye.y;
        const vz = far.z - eye.z;
        const vl = Math.hypot(vx, vy, vz) || 1;
        view = { x: vx / vl, y: vy / vl, z: vz / vl };
        yaw = yawFromDir(view.x, view.z);
        const tMeet = Math.hypot(future.pos.x - origin.x, future.pos.y - origin.y, future.pos.z - origin.z) / spec.speed;
        meet = ballistic(future, tMeet).pos;
      }
      if (view && (!land || land.t > delay)) {
        info.aim = { yaw, pitch: Math.asin(Math.max(-1, Math.min(1, view.y))) };
        info.meet = meet;
      }
    }
    out.push(info);
  }
  return out;
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
