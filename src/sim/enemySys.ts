import { ENEMIES, NOISE, PERCEPTION, PLAYER, PROJECTILES, RUN, RUNES, SHIELD, STEALTH, TALENT_FX, TIPS } from '../config';
import { hasTalent } from './progress';
import { angleDiff, clamp, forwardFromYaw, lerp, turnToward, wrapAngle, yawFromDir, type V2 } from '../core/math';
import type { EnemySpawn } from '../gen/generator';
import { recoilPlayer, shieldBlocks } from './classSys';
import { setDoor } from './propSys';
import type { World } from './world';
import type { Enemy, Projectile } from './types';

export function createEnemy(w: World, s: EnemySpawn): Enemy {
  const spec = ENEMIES[s.kind];
  // 越深越硬；老兵再 ×1.5
  const hp = Math.round(spec.hp * (1 + RUN.hpPerFloor * (w.level.floor - 1)) * (s.veteran ? RUN.veteranHpMul : 1));
  return {
    id: w.nextId++,
    kind: s.kind,
    x: s.x,
    z: s.z,
    y: s.y,
    yaw: s.yaw,
    radius: spec.radius,
    height: spec.height,
    hp,
    maxHp: hp,
    alive: true,
    deathT: 0,
    state: s.state,
    awareness: 0,
    suspicious: false,
    awakened: false,
    perched: s.perched,
    post: { x: s.x, z: s.z, yaw: s.yaw },
    patrol: s.patrol.map((p) => ({ ...p })),
    patrolIdx: 0,
    patrolWait: 0,
    target: null,
    lastKnown: null,
    loseT: 0,
    searchT: 0,
    sleepProxT: 0,
    percT: (w.nextId % 7) * 0.007,
    seesPlayer: false,
    phase: 'none',
    phaseT: 0,
    lockedYaw: s.yaw,
    locked: false,
    hitDone: false,
    chargeDist: 0,
    aimPoint: null,
    path: null,
    pathT: 0,
    pathGoal: null,
    doorWaitT: 0,
    doorWaitId: -1,
    lodged: 0,
    hurtT: 0,
    roomKey: s.roomKey,
    moving: false,
    walkPhase: 0,
    stuckT: 0,
    lastX: s.x,
    lastZ: s.z,
    staggerDur: 0,
    push: null,
    paralyzeT: 0,
    slowT: 0,
    shieldUp: false,
    veteran: !!s.veteran,
    corpseFound: false,
  };
}

/** 打斷敵人目前的出手（盾推、踉蹌）。 */
export function interruptEnemy(e: Enemy): void {
  e.locked = false;
  e.aimPoint = null;
  e.hitDone = true;
  e.moving = false;
  e.phaseT = 0;
}

/** 失衡或踉蹌：一段時間不能行動（盾衛的盾牌放下）。 */
export function staggerEnemy(e: Enemy, dur: number): void {
  interruptEnemy(e);
  e.push = null;
  e.phase = 'stagger';
  e.staggerDur = dur;
}

/** 盾衛：看到玩家拿著遠程武器、在範圍內時，舉盾前進（正面的頭也擋）。舉劍與收招時放下。 */
function guardWantsShield(w: World, e: Enemy): boolean {
  if (e.kind !== 'guard' || e.state !== 'alert' || e.phase !== 'none' || !e.seesPlayer) return false;
  const p = w.player;
  if (p.dead || (p.tool !== 'bow' && p.tool !== 'tipped' && p.tool !== 'stone')) return false;
  return Math.hypot(p.x - e.x, p.z - e.z) <= ENEMIES.guard.raiseRange;
}

/** 突進者的角盔：察覺玩家後低頭（接近、蓄勢、衝鋒），正面的頭被擋；暈眩、收招、失衡時露出。 */
export function chargerHelmet(e: Enemy): boolean {
  if (e.kind !== 'charger' || !ENEMIES.charger.helmet) return false;
  return e.state === 'alert' && (e.phase === 'none' || e.phase === 'windup' || e.phase === 'charge');
}

/** 被盾推：滑行；撞牆失衡、撞到同伴兩個都踉蹌。 */
function updatePush(w: World, e: Enemy, dt: number): void {
  const pu = e.push!;
  const step = Math.min(pu.left, SHIELD.pushSpeed * dt);
  const nx = e.x + pu.dx * step;
  const nz = e.z + pu.dz * step;
  if (w.grid.circleBlocked(nx, nz, e.radius)) {
    staggerEnemy(e, SHIELD.wallStagger + (hasTalent(w.player, 'heavyShield') ? TALENT_FX.heavyShieldStagger : 0));
    w.stats.wallSlams++;
    w.emit({ type: 'bump', id: e.id, kind: 'wall', x: e.x + pu.dx * e.radius, y: 1.0, z: e.z + pu.dz * e.radius });
    w.emitNoise(e.x, 1, e.z, NOISE.combatHit, 'impact');
    return;
  }
  for (const o of w.enemies) {
    if (o === e || !o.alive || o.perched) continue;
    if (Math.hypot(o.x - nx, o.z - nz) < o.radius + e.radius) {
      staggerEnemy(e, SHIELD.bumpStumble);
      staggerEnemy(o, SHIELD.bumpStumble);
      if (o.state !== 'alert') becomeAlert(w, o);
      w.emit({ type: 'bump', id: e.id, kind: 'ally', x: (e.x + o.x) / 2, y: 1.0, z: (e.z + o.z) / 2 });
      w.emitNoise(e.x, 1, e.z, NOISE.combatHit, 'impact');
      return;
    }
  }
  e.x = nx;
  e.z = nz;
  e.moving = false;
  pu.left -= step;
  if (pu.left <= 1e-6) {
    e.push = null;
    e.phase = 'none';
    e.phaseT = 0;
  }
}

export function enemyForward(e: Enemy): V2 {
  return forwardFromYaw(e.yaw);
}

export interface DamageInfo {
  source: string;
  sneak: boolean;
  head: boolean;
  x: number;
  y: number;
  z: number;
}

const PLAYER_WEAPONS = new Set(['melee', 'arrow', 'stone', 'deflect']);

export function damageEnemy(w: World, e: Enemy, dmg: number, info: DamageInfo): void {
  if (!e.alive) return;
  e.hp -= dmg;
  e.hurtT = 0.3;
  w.emit({ type: 'hitEnemy', id: e.id, amount: dmg, head: info.head, sneak: info.sneak, source: info.source, x: info.x, y: info.y, z: info.z, kind: e.kind });
  if (e.hp <= 0) {
    e.hp = 0;
    e.alive = false;
    e.deathT = 0;
    e.phase = 'none';
    e.moving = false;
    w.stats.kills++;
    if (info.sneak) w.stats.sneakKills++;
    if (e.lodged > 0) w.addPickup('arrows', e.lodged, e.x, 0.05, e.z, null);
    e.lodged = 0;
    w.emit({ type: 'enemyDeath', id: e.id, x: e.x, y: e.y, z: e.z, kind: e.kind });
    w.onKill(e);
    return;
  }
  if (PLAYER_WEAPONS.has(info.source)) becomeAlert(w, e);
  else if (e.state !== 'alert') {
    e.state = 'search';
    e.target = { x: e.x, z: e.z };
    e.searchT = 0;
  }
  if (e.kind === 'archer' && e.phase === 'aim') staggerEnemy(e, ENEMIES.archer.stagger);
}

export function becomeAlert(w: World, e: Enemy): void {
  const was = e.state;
  e.state = 'alert';
  e.awareness = 1;
  e.lastKnown = { x: w.player.x, z: w.player.z };
  e.loseT = 0;
  e.path = null;
  if (was !== 'alert') {
    w.emit({ type: 'alert', id: e.id, x: e.x, y: e.y, z: e.z });
    // 呼喊：驚動附近尚未察覺的同伴
    w.emitNoise(e.x, e.y + 1.6, e.z, NOISE.shout, 'shout');
  }
}

/** 噪音：未察覺的敵人前往查看；睡眠中的敵人只對較近的噪音醒來。 */
export function onNoise(w: World, x: number, y: number, z: number, radius: number): void {
  for (const e of w.enemies) {
    if (!e.alive || e.state === 'alert') continue;
    const d = Math.hypot(e.x - x, e.z - z);
    if (d > radius) continue;
    let r = radius;
    const eye = { x: e.x, y: e.y + PERCEPTION.eyeHeight, z: e.z };
    if (!w.grid.lineOfSight({ x, y: Math.max(0.5, y), z }, eye)) r *= NOISE.occludedFactor;
    if (e.state === 'sleep') r *= NOISE.sleepFactor;
    if (d > r) continue;
    if (e.state === 'sleep') w.emit({ type: 'wakeUp', id: e.id, x: e.x, y: e.y, z: e.z });
    e.state = 'search';
    e.target = { x, z };
    e.searchT = 0;
    e.path = null;
    e.awareness = Math.max(e.awareness, 0.3);
    w.emit({ type: 'suspicious', id: e.id, x: e.x, y: e.y, z: e.z });
  }
}

export function awakenDungeon(w: World): void {
  w.awakened = true;
  w.emit({ type: 'wake' });
  const h = w.level.heart;
  for (const e of w.enemies) {
    if (!e.alive) continue;
    e.awakened = true;
    if (e.state === 'sleep') {
      e.state = 'idle';
      w.emit({ type: 'wakeUp', id: e.id, x: e.x, y: e.y, z: e.z });
    }
    if (h && e.state !== 'alert' && !e.perched) {
      const len = w.enav.pathLength(e.x, e.z, h.x, h.z);
      if (len <= PERCEPTION.awakenedCallDist) {
        e.state = 'search';
        e.target = { x: h.x, z: h.z };
        e.searchT = 0;
        e.path = null;
      }
    }
  }
}

// ---------- 感知 ----------

/** 視野角度：搜索中的敵人會左右張望（180°），戒備中 150°。 */
function fovDeg(e: Enemy): number {
  let f: number = PERCEPTION.fovDeg;
  if (e.awakened) f = Math.max(f, PERCEPTION.awakenedFovDeg);
  if (e.state === 'search') f = Math.max(f, STEALTH.searchFovDeg);
  return f;
}

/** 看到同伴的屍體：前往查看、大喊，整層進入戒備。 */
function findCorpses(w: World, e: Enemy): void {
  const eye = { x: e.x, y: e.y + PERCEPTION.eyeHeight, z: e.z };
  const half = (fovDeg(e) * Math.PI) / 360;
  for (const c of w.enemies) {
    if (c.alive || c.corpseFound || c === e) continue;
    const dx = c.x - e.x;
    const dz = c.z - e.z;
    const d = Math.hypot(dx, dz);
    if (d > STEALTH.corpseSightRange) continue;
    if (Math.abs(angleDiff(yawFromDir(dx, dz), e.yaw)) > half && d > 1.2) continue;
    if (!w.canSee(eye, { x: c.x, y: c.y + 0.3, z: c.z })) continue;
    c.corpseFound = true;
    if (e.state === 'sleep') continue;
    e.state = 'search';
    e.target = { x: c.x, z: c.z };
    e.searchT = 0;
    e.path = null;
    e.awareness = Math.max(e.awareness, 0.5);
    w.emit({ type: 'corpseFound', id: e.id, x: e.x, y: e.y, z: e.z });
    w.emitNoise(e.x, e.y + 1.6, e.z, NOISE.shout, 'shout');
    raiseAlarm(w);
    return;
  }
}

/** 整層戒備：所有敵人視野變廣、發現更快、搜索更久（不會叫醒睡著的）。 */
export function raiseAlarm(w: World): void {
  if (w.alarm) return;
  w.alarm = true;
  for (const o of w.enemies) if (o.alive) o.awakened = true;
  w.emit({ type: 'alarm' });
}

function perceive(w: World, e: Enemy, interval: number): void {
  const p = w.player;
  e.seesPlayer = false;
  if (p.dead) return;
  const dx = p.x - e.x;
  const dz = p.z - e.z;
  const d = Math.hypot(dx, dz);
  if (e.state === 'sleep') {
    if (d < PERCEPTION.sleepWakeDist) {
      e.sleepProxT += interval;
      if (e.sleepProxT >= PERCEPTION.sleepWakeTime) {
        e.state = 'search';
        e.target = { x: p.x, z: p.z };
        e.searchT = 0;
        e.awareness = 0.6;
        w.emit({ type: 'wakeUp', id: e.id, x: e.x, y: e.y, z: e.z });
      }
    } else e.sleepProxT = Math.max(0, e.sleepProxT - interval);
    return;
  }
  if (e.state !== 'alert') findCorpses(w, e);
  let range: number = e.state === 'alert' ? PERCEPTION.alertRange : PERCEPTION.range;
  if (e.suspicious) range *= PERCEPTION.suspiciousRangeMul;
  if (e.awakened) range *= PERCEPTION.awakenedRangeMul;
  if (d > range) return;
  if (e.state !== 'alert') {
    const fov = (fovDeg(e) * Math.PI) / 180;
    const ang = Math.abs(angleDiff(yawFromDir(dx, dz), e.yaw));
    if (ang > fov / 2 && d > 1.2) return;
  }
  // 隱形：看不到（聲音照樣聽得到）
  if (p.invisT > 0) return;
  const eye = { x: e.x, y: e.y + PERCEPTION.eyeHeight, z: e.z };
  const chest = { x: p.x, y: 1.25, z: p.z };
  const head = { x: p.x, y: PLAYER.eyeHeight, z: p.z };
  if (!w.canSee(eye, chest) && !w.canSee(eye, head)) return;
  e.seesPlayer = true;
}

function updateAwareness(w: World, e: Enemy, interval: number): void {
  const p = w.player;
  if (e.state === 'sleep') return;
  if (e.seesPlayer) {
    if (e.state === 'alert') {
      e.lastKnown = { x: p.x, z: p.z };
      e.loseT = 0;
      return;
    }
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    let fill = lerp(PERCEPTION.fillNear, PERCEPTION.fillFar, clamp((d - PERCEPTION.nearDist) / (PERCEPTION.range - PERCEPTION.nearDist), 0, 1));
    if (w.hasRune('shadow')) fill *= RUNES.shadow.detectMul;
    if (e.awakened) fill *= PERCEPTION.awakenedFillMul;
    if (e.veteran) fill *= RUN.veteranFillMul;
    if (e.state === 'search') fill *= STEALTH.searchFillMul;
    e.awareness += interval / fill;
    if (e.awareness >= 1) becomeAlert(w, e);
  } else if (e.state !== 'alert') {
    e.awareness = Math.max(0, e.awareness - PERCEPTION.decay * interval);
  }
}

// ---------- 移動 ----------

function blockingDoor(w: World, x: number, z: number, r: number): number {
  for (let j = Math.floor(z - r); j <= Math.floor(z + r); j++) {
    for (let i = Math.floor(x - r); i <= Math.floor(x + r); i++) {
      const d = w.grid.doorAt(i, j);
      if (!d || d.progress >= 0.999) continue;
      const cx = Math.max(i, Math.min(x, i + 1));
      const cz = Math.max(j, Math.min(z, j + 1));
      if (Math.hypot(x - cx, z - cz) < r) return d.id;
    }
  }
  return -1;
}

function separate(w: World, e: Enemy, x: number, z: number): { x: number; z: number } {
  for (const o of w.enemies) {
    if (o === e || !o.alive || o.perched) continue;
    const dx = x - o.x;
    const dz = z - o.z;
    const d = Math.hypot(dx, dz);
    const min = e.radius + o.radius;
    if (d < min) {
      if (d < 1e-5) {
        x += 0.01 * ((e.id % 2) * 2 - 1);
        continue;
      }
      x = o.x + (dx / d) * min;
      z = o.z + (dz / d) * min;
    }
  }
  const p = w.player;
  if (!p.dead) {
    const dx = x - p.x;
    const dz = z - p.z;
    const d = Math.hypot(dx, dz);
    const min = e.radius + PLAYER.radius;
    if (d < min && d > 1e-5) {
      x = p.x + (dx / d) * min;
      z = p.z + (dz / d) * min;
    }
  }
  return { x, z };
}

/** 沿導航路徑移動；回傳是否已抵達目標。 */
function moveTo(w: World, e: Enemy, goal: V2, speed: number, dt: number, arriveDist = 0.5, faceMove = true): boolean {
  if (e.perched) return true;
  const dGoal = Math.hypot(goal.x - e.x, goal.z - e.z);
  if (dGoal <= arriveDist) {
    e.moving = false;
    return true;
  }
  e.pathT -= dt;
  const goalMoved = !e.pathGoal || Math.hypot(e.pathGoal.x - goal.x, e.pathGoal.z - goal.z) > 1.0;
  if (!e.path || e.pathT <= 0 || goalMoved) {
    e.path = w.enav.findPath(e.x, e.z, goal.x, goal.z) ?? [];
    e.pathGoal = { ...goal };
    e.pathT = 0.5 + (e.id % 5) * 0.05;
  }
  if (!e.path.length) {
    e.moving = false;
    return false;
  }
  let wp = e.path[0]!;
  while (e.path.length > 1 && Math.hypot(wp.x - e.x, wp.z - e.z) < 0.3) {
    e.path.shift();
    wp = e.path[0]!;
  }
  const dx = wp.x - e.x;
  const dz = wp.z - e.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-4) {
    e.path.shift();
    return false;
  }
  const step = Math.min(d, speed * dt);
  const nx = e.x + (dx / d) * step;
  const nz = e.z + (dz / d) * step;
  // 門：停下、花時間開門
  const doorId = blockingDoor(w, nx, nz, e.radius);
  if (doorId >= 0) {
    const door = w.grid.doors[doorId]!;
    e.moving = false;
    if (door.barred) {
      e.path = null;
      return false;
    }
    if (door.target === 0) {
      if (e.doorWaitId !== doorId) {
        e.doorWaitId = doorId;
        e.doorWaitT = 0;
      }
      e.doorWaitT += dt;
      if (e.doorWaitT >= 0.6) setDoor(w, doorId, true, 'enemy');
    }
    e.yaw = turnToward(e.yaw, yawFromDir(dx, dz), 6 * dt);
    return false;
  }
  e.doorWaitId = -1;
  let r = w.grid.resolveCircle(nx, nz, e.radius);
  r = separate(w, e, r.x, r.z);
  r = w.grid.resolveCircle(r.x, r.z, e.radius);
  const moved = Math.hypot(r.x - e.x, r.z - e.z);
  e.x = r.x;
  e.z = r.z;
  e.moving = moved > speed * dt * 0.2;
  e.walkPhase += moved * 2.2;
  if (faceMove && moved > 1e-4) e.yaw = turnToward(e.yaw, yawFromDir(dx, dz), 7 * dt);
  // 卡住偵測
  if (moved < speed * dt * 0.15) {
    e.stuckT += dt;
    if (e.stuckT > 1.2) {
      e.stuckT = 0;
      e.path = null;
      return true; // 讓上層換目標
    }
  } else e.stuckT = 0;
  return false;
}

function facePlayer(w: World, e: Enemy, rate: number, dt: number): void {
  e.yaw = turnToward(e.yaw, yawFromDir(w.player.x - e.x, w.player.z - e.z), rate * dt);
}

// ---------- 行為 ----------

function guardAlert(w: World, e: Enemy, dt: number): void {
  const s = ENEMIES.guard;
  const p = w.player;
  const d = Math.hypot(p.x - e.x, p.z - e.z);
  switch (e.phase) {
    case 'none':
      if (e.seesPlayer && d <= s.attackRange + PLAYER.radius && !p.dead) {
        e.phase = 'windup';
        e.phaseT = 0;
        e.locked = false;
        e.hitDone = false;
        e.moving = false;
        w.emit({ type: 'enemyWindup', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
        return;
      }
      chase(w, e, dt, s.speed, s.attackRange * 0.75);
      return;
    case 'windup':
      e.phaseT += dt;
      if (e.phaseT < s.trackUntil) facePlayer(w, e, 8, dt);
      else if (!e.locked) {
        e.locked = true;
        e.lockedYaw = e.yaw;
      }
      if (e.phaseT >= s.windup) {
        e.phase = 'active';
        e.phaseT = 0;
        w.emit({ type: 'enemyStrike', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
      }
      return;
    case 'active': {
      e.phaseT += dt;
      if (!e.hitDone && !p.dead) {
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        const dd = Math.hypot(dx, dz);
        const ang = Math.abs(angleDiff(yawFromDir(dx, dz), e.lockedYaw));
        if (dd <= s.reach + PLAYER.radius && (ang <= ((s.arcDeg / 2) * Math.PI) / 180 || dd < e.radius + PLAYER.radius + 0.15)) {
          const clear = w.grid.segmentHit({ x: e.x, y: 1.2, z: e.z }, { x: p.x, y: 1.2, z: p.z });
          if (!clear) {
            e.hitDone = true;
            if (shieldBlocks(w, e.x, e.z)) {
              w.stats.blocks++;
              w.emit({ type: 'block', id: e.id, kind: 'guard', x: (e.x + p.x) / 2, y: 1.2, z: (e.z + p.z) / 2 });
            } else w.damagePlayer(s.damage, '盾衛的劍', e.x, e.z);
          }
        }
      }
      if (e.phaseT >= s.active) {
        e.phase = 'recovery';
        e.phaseT = 0;
      }
      return;
    }
    case 'recovery':
      e.phaseT += dt;
      if (e.phaseT >= s.recovery) e.phase = 'none';
      return;
    default:
      e.phaseT += dt;
      if (e.phaseT >= 0.5) e.phase = 'none';
  }
}

function chase(w: World, e: Enemy, dt: number, speed: number, stopDist: number): void {
  const p = w.player;
  if (e.seesPlayer) {
    const d = Math.hypot(p.x - e.x, p.z - e.z);
    if (d > stopDist) moveTo(w, e, { x: p.x, z: p.z }, speed, dt, stopDist, false);
    else e.moving = false;
    facePlayer(w, e, 6, dt);
  } else if (e.lastKnown) {
    const arrived = moveTo(w, e, e.lastKnown, speed, dt, 0.6);
    if (arrived) e.moving = false;
  }
}

function archerAlert(w: World, e: Enemy, dt: number): void {
  const s = ENEMIES.archer;
  const p = w.player;
  const d = Math.hypot(p.x - e.x, p.z - e.z);
  switch (e.phase) {
    case 'none':
    case 'reload':
      if (e.phase === 'reload') {
        e.phaseT += dt;
        if (e.phaseT >= s.reload) e.phase = 'none';
      }
      if (e.seesPlayer) {
        facePlayer(w, e, 5, dt);
        if (!e.perched && d < s.minDist) {
          // 保持距離：往遠離玩家的方向退
          const away = { x: e.x + ((e.x - p.x) / (d || 1)) * 4, z: e.z + ((e.z - p.z) / (d || 1)) * 4 };
          const stuck = moveTo(w, e, away, s.speed * 0.85, dt, 0.4, false);
          if (e.phase === 'none' && (stuck || d < 3.5)) startAim(w, e);
          return;
        }
        if (e.phase === 'none' && d <= s.fireRange) startAim(w, e);
        else if (!e.perched && d > s.maxDist) moveTo(w, e, { x: p.x, z: p.z }, s.speed, dt, s.maxDist * 0.9, false);
        else e.moving = false;
      } else if (!e.perched && e.lastKnown) {
        moveTo(w, e, e.lastKnown, s.speed, dt, 0.6);
      } else e.moving = false;
      return;
    case 'aim': {
      e.phaseT += dt;
      e.moving = false;
      const lockAt = s.aim - s.lockBefore;
      if (e.phaseT < lockAt) {
        if (!e.seesPlayer) {
          e.phase = 'none';
          e.aimPoint = null;
          return;
        }
        facePlayer(w, e, 6, dt);
        e.aimPoint = { x: p.x, y: 1.2, z: p.z };
      } else if (!e.locked) {
        e.locked = true;
        e.lockedYaw = e.yaw;
        e.aimPoint = e.aimPoint ?? { x: p.x, y: 1.2, z: p.z };
      }
      if (e.phaseT >= s.aim) fireBolt(w, e);
      return;
    }
    default:
      e.phase = 'none';
  }
}

function startAim(w: World, e: Enemy): void {
  e.phase = 'aim';
  e.phaseT = 0;
  e.locked = false;
  e.moving = false;
  e.aimPoint = { x: w.player.x, y: 1.2, z: w.player.z };
  w.emit({ type: 'enemyWindup', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
}

function fireBolt(w: World, e: Enemy): void {
  const s = PROJECTILES.bolt;
  const f = forwardFromYaw(e.yaw);
  const origin = { x: e.x + f.x * 0.5, y: e.y + 1.45, z: e.z + f.z * 0.5 };
  const tgt = e.aimPoint!;
  let dx = tgt.x - origin.x;
  let dy = tgt.y - origin.y;
  let dz = tgt.z - origin.z;
  const len = Math.hypot(dx, dy, dz) || 1;
  dx /= len;
  dy /= len;
  dz /= len;
  const proj: Projectile = {
    id: w.nextId++,
    kind: 'bolt',
    owner: e.id,
    pos: origin,
    vel: { x: dx * s.speed, y: dy * s.speed, z: dz * s.speed },
    radius: s.radius,
    gravity: s.gravity,
    age: 0,
    alive: true,
    pierceLeft: 0,
    hitSet: new Set(),
    next: { ...origin },
    avgVel: { x: 0, y: 0, z: 0 },
    deflected: false,
    tip: null,
    payload: 'smoke',
  };
  w.projectiles.push(proj);
  e.phase = 'reload';
  e.phaseT = 0;
  e.aimPoint = null;
  w.emit({ type: 'enemyFire', id: e.id, kind: e.kind, x: origin.x, y: origin.y, z: origin.z });
}

function chargerAlert(w: World, e: Enemy, dt: number): void {
  const s = ENEMIES.charger;
  const p = w.player;
  const d = Math.hypot(p.x - e.x, p.z - e.z);
  switch (e.phase) {
    case 'none':
      if (e.seesPlayer && !p.dead && d <= s.triggerDist && (d < 2.2 || w.enav.lineWalkable(e.x, e.z, p.x, p.z))) {
        e.phase = 'windup';
        e.phaseT = 0;
        e.locked = false;
        e.hitDone = false;
        e.moving = false;
        w.emit({ type: 'enemyWindup', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
        return;
      }
      chase(w, e, dt, s.speed, 1.2);
      return;
    case 'windup':
      e.phaseT += dt;
      if (e.phaseT < s.windup - s.lockBefore) facePlayer(w, e, 5, dt);
      else if (!e.locked) {
        e.locked = true;
        e.lockedYaw = e.yaw;
      }
      if (e.phaseT >= s.windup) {
        e.phase = 'charge';
        e.phaseT = 0;
        e.chargeDist = 0;
        w.emit({ type: 'enemyStrike', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
      }
      return;
    case 'charge': {
      e.phaseT += dt;
      e.moving = true;
      const f = forwardFromYaw(e.lockedYaw);
      e.yaw = e.lockedYaw;
      const step = s.chargeSpeed * dt;
      const nx = e.x + f.x * step;
      const nz = e.z + f.z * step;
      if (w.grid.circleBlocked(nx, nz, e.radius)) {
        e.phase = 'stun';
        e.phaseT = 0;
        e.moving = false;
        w.emit({ type: 'stun', id: e.id, x: nx + f.x * e.radius, y: 1.0, z: nz + f.z * e.radius });
        w.emitNoise(e.x, 1, e.z, NOISE.combatHit, 'impact');
        return;
      }
      for (const o of w.enemies) {
        if (o === e || !o.alive || o.perched) continue;
        if (Math.hypot(o.x - nx, o.z - nz) < o.radius + e.radius) {
          // 衝撞也會撞傷擋在路上的同伴
          w.emit({ type: 'bump', id: o.id, kind: 'charge', x: (e.x + o.x) / 2, y: 1.0, z: (e.z + o.z) / 2 });
          damageEnemy(w, o, s.allyDamage, { source: 'charge', sneak: false, head: false, x: o.x, y: 1.0, z: o.z });
          if (o.alive) staggerEnemy(o, s.allyStumble);
          e.phase = 'recovery';
          e.phaseT = 0;
          e.moving = false;
          return;
        }
      }
      if (!p.dead && Math.hypot(p.x - nx, p.z - nz) < e.radius + PLAYER.radius) {
        if (!e.hitDone) {
          e.hitDone = true;
          if (shieldBlocks(w, e.x, e.z)) {
            // 臂盾擋下衝撞：戰士被推退，突進者收招但不暈眩
            w.stats.blocks++;
            w.emit({ type: 'block', id: e.id, kind: 'charger', x: (e.x + p.x) / 2, y: 1.1, z: (e.z + p.z) / 2 });
            recoilPlayer(w, f.x, f.z, SHIELD.chargeRecoil);
          } else w.damagePlayer(s.damage, '突進者的衝撞', e.x, e.z);
        }
        e.phase = 'recovery';
        e.phaseT = 0;
        e.moving = false;
        return;
      }
      e.x = nx;
      e.z = nz;
      e.walkPhase += step * 1.5;
      e.chargeDist += step;
      if (e.chargeDist >= s.chargeDist) {
        e.phase = 'recovery';
        e.phaseT = 0;
        e.moving = false;
      }
      return;
    }
    case 'stun':
      e.phaseT += dt;
      if (e.phaseT >= s.stun) {
        e.phase = 'recovery';
        e.phaseT = 0;
      }
      return;
    case 'recovery':
      e.phaseT += dt;
      e.moving = false;
      if (e.phaseT >= s.recovery) e.phase = 'none';
      return;
    default:
      e.phase = 'none';
  }
}

function unawareBehavior(w: World, e: Enemy, dt: number): void {
  switch (e.state) {
    case 'sleep':
      e.moving = false;
      return;
    case 'idle': {
      const d = Math.hypot(e.post.x - e.x, e.post.z - e.z);
      if (d > 0.6 && !e.perched) moveTo(w, e, e.post, ENEMIES.patrolSpeed, dt, 0.4);
      else {
        e.moving = false;
        e.yaw = turnToward(e.yaw, e.post.yaw, 2 * dt);
      }
      return;
    }
    case 'patrol': {
      if (!e.patrol.length) {
        e.state = 'idle';
        return;
      }
      const tgt = e.patrol[e.patrolIdx % e.patrol.length]!;
      const arrived = moveTo(w, e, tgt, ENEMIES.patrolSpeed, dt, 0.4);
      if (arrived) {
        e.moving = false;
        e.patrolWait += dt;
        if (e.patrolWait > 1.5) {
          e.patrolWait = 0;
          e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
        }
      }
      return;
    }
    case 'search': {
      const tgt = e.target ?? { x: e.x, z: e.z };
      const arrived = e.perched || moveTo(w, e, tgt, ENEMIES.searchSpeed, dt, 0.8);
      if (e.perched) e.yaw = turnToward(e.yaw, yawFromDir(tgt.x - e.x, tgt.z - e.z), 3 * dt);
      if (arrived) {
        e.moving = false;
        e.searchT += dt;
        // 左右張望（範圍大到會轉身看背後）
        if (!e.perched) e.yaw = wrapAngle(e.yaw + Math.sin(e.searchT * 1.3) * 2.4 * dt);
        if (e.searchT >= PERCEPTION.searchTime * (e.awakened ? 2 : 1)) {
          e.state = e.patrol.length ? 'patrol' : 'idle';
          e.suspicious = true;
          e.target = null;
          e.searchT = 0;
        }
      }
      return;
    }
    default:
  }
}

export function updateEnemies(w: World, dt: number): void {
  for (const e of w.enemies) {
    if (!e.alive) {
      e.deathT += dt;
      continue;
    }
    if (e.hurtT > 0) e.hurtT = Math.max(0, e.hurtT - dt);
    // 被盾推是外力：麻痺中也照樣滑出去
    if (e.push) {
      updatePush(w, e, dt);
      continue;
    }
    // 藥劑箭：麻痺＝時間軸暫停（感知、行為、計時全部定格）；冰寒＝時間軸變慢
    if (e.paralyzeT > 0) {
      e.paralyzeT = Math.max(0, e.paralyzeT - dt);
      e.moving = false;
      continue;
    }
    let edt = dt;
    if (e.slowT > 0) {
      e.slowT = Math.max(0, e.slowT - dt);
      edt = dt * TIPS.chill.timeScale;
    }
    e.percT -= edt;
    if (e.percT <= 0) {
      e.percT += PERCEPTION.interval;
      perceive(w, e, PERCEPTION.interval);
      updateAwareness(w, e, PERCEPTION.interval);
    }
    if (e.phase === 'stagger') {
      e.phaseT += edt;
      e.moving = false;
      e.shieldUp = false;
      if (e.phaseT >= e.staggerDur) {
        e.phase = 'none';
        e.phaseT = 0;
      }
      continue;
    }
    if (e.state === 'alert') {
      const attacking = e.phase !== 'none' && e.phase !== 'reload';
      if (!e.seesPlayer && !attacking) {
        e.loseT += edt;
        if (e.loseT >= PERCEPTION.loseTime) {
          e.state = 'search';
          e.target = e.lastKnown ? { ...e.lastKnown } : { x: e.x, z: e.z };
          e.searchT = 0;
          e.awareness = 0.5;
          e.path = null;
          e.shieldUp = false;
          continue;
        }
      }
      if (w.player.dead && !attacking) {
        e.moving = false;
        continue;
      }
      if (e.kind === 'guard') guardAlert(w, e, edt);
      else if (e.kind === 'archer') archerAlert(w, e, edt);
      else chargerAlert(w, e, edt);
    } else {
      if (e.phase !== 'none' && e.phase !== 'stun') e.phase = 'none';
      if (e.phase === 'stun') {
        e.phaseT += edt;
        if (e.phaseT >= ENEMIES.charger.stun) e.phase = 'none';
        continue;
      }
      unawareBehavior(w, e, edt);
    }
    if (e.kind === 'guard') e.shieldUp = guardWantsShield(w, e);
  }
}
