import { combatRoomCells } from './combatSound';
import { ENEMIES, NOISE, PERCEPTION, PLAYER, PROJECTILES, RUN, SHIELD, STEALTH, TALENT_FX, TIPS } from '../config';
import { segmentEnemy } from './characterHit';
import { hasTalent } from './progress';
import { angleDiff, clamp, forwardFromYaw, lerp, turnToward, wrapAngle, yawFromDir, type V2, type V3 } from '../core/math';
import type { EnemySpawn } from '../gen/generator';
import { recoilPlayer, shieldBlocks } from './classSys';
import { setDoor } from './propSys';
import type { World } from './world';
import type { Enemy, Projectile } from './types';

// Distance accumulation belongs to the actual movement path, not a second perception loop.
const footstepDistance = new WeakMap<Enemy, number>();

function enemyFootsteps(w: World, e: Enemy, moved: number): void {
  if (moved <= 0 || !e.alive || e.state === 'sleep' || e.perched) return;
  const distance = (footstepDistance.get(e) ?? 0) + moved;
  footstepDistance.set(e, distance % STEALTH.footstepEvery);
  if (distance < STEALTH.footstepEvery) return;
  // Presentation sound event only: this must not wake the mover or chain-alert nearby AI.
  w.emit({ type: 'enemyStep', id: e.id, x: e.x, y: e.y + 0.1, z: e.z });
}

export function createEnemy(w: World, s: EnemySpawn): Enemy {
  const spec = ENEMIES[s.kind];
  const patrol = s.perched || s.boss ? [] : [...w.roamPoints, ...s.patrol].map((p) => ({ ...p }));
  // 越深越硬；老兵再 ×1.5
  const hp = s.kind === 'warden' ? ENEMIES.warden.hp : Math.round(spec.hp * (1 + RUN.hpPerFloor * (w.level.floor - 1)) * (s.veteran ? RUN.veteranHpMul : 1));
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
    state: s.state === 'idle' && patrol.length > 0 ? 'patrol' : s.state,
    awareness: 0,
    suspicious: false,
    awakened: false,
    perched: s.perched,
    post: { x: s.x, z: s.z, yaw: s.yaw },
    patrol,
    patrolIdx: w.nextId % Math.max(1, patrol.length),
    patrolWait: 0,
    target: null,
    lastKnown: null,
    loseT: 0,
    searchT: 0,
    searchIdx: -1,
    searchGoal: null,
    roamT: 0,
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
    archerMove: null,
    archerMovePause: 0,
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
    pendingSleep: false,
    boss: !!s.boss,
    warden: s.kind === 'warden' ? { attack: null, phaseTwo: false, rangedCount: 0,
      braced: false, followup: false, cleavesLeft: 0, sequenceResolved: false } : null,
  };
}

/** 打斷敵人目前的出手（盾推、踉蹌）。 */
export function interruptEnemy(e: Enemy): void {
  stopArcherMove(e);
  if (e.warden) {
    e.warden.attack = null; e.warden.followup = false;
    e.warden.cleavesLeft = 0; e.warden.sequenceResolved = false;
  }
  e.locked = false;
  e.aimPoint = null;
  e.hitDone = true;
  e.moving = false;
  e.phaseT = 0;
}

/** 失衡或踉蹌：一段時間不能行動（盾衛的盾牌放下）。 */
export function staggerEnemy(e: Enemy, dur: number, wallCrash = false): void {
  // Ordinary heavy hits cannot repeatedly reset the Boss's timeline. A committed
  // rush crashing into real geometry still earns its explicit, visible opening.
  if (wardenBraced(e) && !wallCrash) return;
  interruptEnemy(e);
  if (e.warden) e.warden.braced = true;
  e.push = null;
  e.shieldUp = false;
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
    // Collision consumes the physical push even when the Boss resists stagger.
    e.push = null;
    const resisted = wardenBraced(e);
    staggerEnemy(e, SHIELD.wallStagger + (SHIELD.enabled && hasTalent(w.player, 'heavyShield') ? TALENT_FX.heavyShieldStagger : 0));
    w.stats.wallSlams++;
    w.emit({ type: 'bump', id: e.id, kind: 'wall', x: e.x + pu.dx * e.radius, y: 1.0, z: e.z + pu.dz * e.radius,
      text: resisted ? '撞牆，守心者穩勢未被打斷' : undefined });
    w.emitNoise(e.x, 1, e.z, NOISE.combatHit, 'impact');
    return;
  }
  for (const o of w.enemies) {
    if (o === e || !o.alive || o.perched) continue;
    if (Math.hypot(o.x - nx, o.z - nz) < o.radius + e.radius) {
      e.push = null;
      const resisted = wardenBraced(e) || wardenBraced(o);
      staggerEnemy(e, SHIELD.bumpStumble);
      staggerEnemy(o, SHIELD.bumpStumble);
      if (o.state !== 'alert') investigate(w, o, { x: e.x, z: e.z });
      w.emit({ type: 'bump', id: e.id, kind: 'ally', x: (e.x + o.x) / 2, y: 1.0, z: (e.z + o.z) / 2,
        text: resisted ? '碰撞，守心者穩勢未被打斷' : undefined });
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
  if (e.boss) w.startEncounter();
  // A hit wakes a sleeper and cancels a not-yet-applied lull.
  e.pendingSleep = false;
  e.hp -= dmg;
  e.hurtT = 0.3;
  w.emit({ type: 'hitEnemy', id: e.id, amount: dmg, head: info.head, sneak: info.sneak, source: info.source, x: info.x, y: info.y, z: info.z, kind: e.kind });
  if (e.hp <= 0) {
    e.hp = 0;
    e.alive = false;
    stopArcherMove(e);
    e.deathT = 0;
    if (e.warden) e.warden.attack = null;
    e.aimPoint = null;
    e.locked = false;
    e.phase = 'none';
    e.moving = false;
    w.stats.kills++;
    if (info.sneak) w.stats.sneakKills++;
    if (e.lodged > 0) w.addPickup('arrows', e.lodged, e.x, 0.05, e.z, null);
    e.lodged = 0;
    w.emit({ type: 'enemyDeath', id: e.id, x: e.x, y: e.y, z: e.z, kind: e.kind });
    w.onKill(e);
    w.updateEncounter();
    return;
  }
  if (PLAYER_WEAPONS.has(info.source)) {
    // 近戰接觸可確認攻擊者；遠程受擊只有實際可見才知道玩家在哪。
    const p = w.player;
    const visible = p.invisT <= 0 && Math.hypot(p.x - e.x, p.z - e.z) <= PERCEPTION.alertRange &&
      w.canSee({ x: e.x, y: e.y + PERCEPTION.eyeHeight, z: e.z }, { x: p.x, y: 1.25, z: p.z });
    if (info.source === 'melee' || visible) becomeAlert(w, e);
    else if (e.state !== 'alert') investigate(w, e, { x: e.x, z: e.z });
  } else if (e.state !== 'alert') investigate(w, e, { x: e.x, z: e.z });
  if (e.kind === 'archer' && e.phase === 'aim') staggerEnemy(e, ENEMIES.archer.stagger);
}

export function becomeAlert(w: World, e: Enemy): void {
  const was = e.state;
  e.state = 'alert';
  e.awareness = 1;
  e.lastKnown = { x: w.player.x, z: w.player.z };
  e.loseT = 0;
  e.target = null;
  e.searchT = 0;
  e.searchIdx = -1;
  e.searchGoal = null;
  e.path = null;
  if (was !== 'alert') {
    w.emit({ type: 'alert', id: e.id, x: e.x, y: e.y, z: e.z });
    // 呼喊：驚動附近尚未察覺的同伴
    w.emitNoise(e.x, e.y + 1.6, e.z, NOISE.shout, 'shout', e.id);
  }
}

/** 可疑事件只記住事件位置，不取得玩家位置。門行動計時不隨狀態切換重設。 */
function investigate(w: World, e: Enemy, target: V2): void {
  if (e.state === 'sleep') w.emit({ type: 'wakeUp', id: e.id, x: e.x, y: e.y, z: e.z });
  e.state = 'investigate';
  e.target = { ...target };
  e.searchT = 0;
  e.searchIdx = -1;
  e.searchGoal = null;
  e.path = null;
  e.awareness = Math.max(e.awareness, 0.3);
  w.emit({ type: 'suspicious', id: e.id, x: e.x, y: e.y, z: e.z });
}

function beginSearch(e: Enemy): void {
  stopArcherMove(e);
  e.state = 'search';
  e.searchT = 0;
  e.searchIdx = -1;
  e.searchGoal = null;
  e.path = null;
  e.shieldUp = false;
}

function resumeWandering(e: Enemy): void {
  e.state = !e.perched && e.patrol.length ? 'patrol' : 'idle';
  e.suspicious = true;
  e.target = null;
  e.lastKnown = null;
  e.searchGoal = null;
  e.searchT = 0;
  e.searchIdx = -1;
  e.loseT = 0;
  e.roamT = 0;
  e.patrolWait = 0;
  e.path = null;
  e.awareness = 0;
}

/** 噪音：未察覺的敵人前往查看；同房可傳達的戰鬥聲叫醒睡眠者；一般聲音仍依距離／遮蔽衰減。 */
export function onNoise(w: World, x: number, y: number, z: number, radius: number, emitterId?: number, source = ''): void {
  const roomCells = combatRoomCells(w, x, z, radius, source);
  for (const e of w.enemies) {
    if (!e.alive || e.state === 'alert' || e.id === emitterId) continue;
    const cell = Math.floor(e.z) * w.grid.w + Math.floor(e.x);
    if (roomCells.has(cell)) { investigate(w, e, { x, z }); continue; }
    const d = Math.hypot(e.x - x, e.z - z);
    if (d > radius) continue;
    let r = radius;
    const eye = { x: e.x, y: e.y + PERCEPTION.eyeHeight, z: e.z };
    if (!w.grid.lineOfSight({ x, y: Math.max(0.5, y), z }, eye)) r *= NOISE.occludedFactor;
    if (e.state === 'sleep') r *= NOISE.sleepFactor;
    if (d > r) continue;
    investigate(w, e, { x, z });
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
        investigate(w, e, h);
      }
    }
  }
}

// ---------- 感知 ----------

/** 視野角度：搜索中的敵人會左右張望（180°），戒備中 150°。 */
function fovDeg(e: Enemy): number {
  let f: number = PERCEPTION.fovDeg;
  if (e.awakened) f = Math.max(f, PERCEPTION.awakenedFovDeg);
  if (e.state === 'search' || e.state === 'investigate') f = Math.max(f, STEALTH.searchFovDeg);
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
    investigate(w, e, c);
    e.awareness = Math.max(e.awareness, 0.5);
    w.emit({ type: 'corpseFound', id: e.id, x: e.x, y: e.y, z: e.z });
    w.emitNoise(e.x, e.y + 1.6, e.z, NOISE.shout, 'shout', e.id);
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
    if (d < PERCEPTION.sleepWakeDist && p.invisT <= 0 &&
        w.canSee({ x: e.x, y: e.y + PERCEPTION.eyeHeight, z: e.z }, { x: p.x, y: 1.25, z: p.z })) {
      e.sleepProxT += interval;
      if (e.sleepProxT >= PERCEPTION.sleepWakeTime) {
        investigate(w, e, { x: p.x, z: p.z });
        e.awareness = 0.6;
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
    if (e.awakened) fill *= PERCEPTION.awakenedFillMul;
    if (e.veteran) fill *= RUN.veteranFillMul;
    if (e.state === 'search' || e.state === 'investigate') fill *= STEALTH.searchFillMul;
    if (e.state === 'idle' || e.state === 'patrol') e.target = { x: p.x, z: p.z };
    e.awareness += interval / fill;
    if (e.awareness >= 1) becomeAlert(w, e);
  } else if (e.state !== 'alert') {
    if ((e.state === 'idle' || e.state === 'patrol') && e.awareness > 0 && e.target) investigate(w, e, e.target);
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
function moveTo(w: World, e: Enemy, goal: V2, speed: number, dt: number, arriveDist = 0.5, faceMove = true, fixedPath = false): boolean {
  if (e.push) { e.moving = false; return false; }
  if (e.perched) return true;
  const dGoal = Math.hypot(goal.x - e.x, goal.z - e.z);
  if (dGoal <= arriveDist) {
    e.moving = false;
    return true;
  }
  e.pathT -= dt;
  const goalMoved = !e.pathGoal || Math.hypot(e.pathGoal.x - goal.x, e.pathGoal.z - goal.z) > 1.0;
  if (!fixedPath && (!e.path || e.pathT <= 0 || goalMoved)) {
    e.path = w.enav.findPath(e.x, e.z, goal.x, goal.z) ?? [];
    e.pathGoal = { ...goal };
    e.pathT = ENEMIES.repathInterval + (e.id % 5) * 0.05;
  }
  if (!e.path?.length) {
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
    if (door.barred || fixedPath) {
      e.path = null;
      return false;
    }
    if (door.target === 0) {
      if (e.doorWaitId !== doorId) {
        e.doorWaitId = doorId;
        e.doorWaitT = 0;
      }
      e.doorWaitT += dt;
      if (e.doorWaitT >= ENEMIES.doorOpenTime && setDoor(w, doorId, true, 'enemy', e.id)) e.doorWaitT = 0;
    }
    e.yaw = turnToward(e.yaw, yawFromDir(dx, dz), 6 * dt);
    return false;
  }
  e.doorWaitId = -1;
  e.doorWaitT = 0;
  let r = w.grid.resolveCircle(nx, nz, e.radius);
  r = separate(w, e, r.x, r.z);
  r = w.grid.resolveCircle(r.x, r.z, e.radius);
  const moved = Math.hypot(r.x - e.x, r.z - e.z);
  e.x = r.x;
  e.z = r.z;
  e.moving = moved > speed * dt * 0.2;
  e.walkPhase += moved * 2.2;
  enemyFootsteps(w, e, moved);
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

/** 盾衛實際踏步：鎖定後不再轉向；牆、門、角色仍擋住身體。 */
function guardStep(w: World, e: Enemy, dt: number): void {
  // 已在劍的內側就不繼續擠進身體；近距離原有反擊／盾推窗口保持穩定。
  if (e.push || e.perched || Math.hypot(w.player.x - e.x, w.player.z - e.z) <= ENEMIES.guard.attackStopDist) {
    e.moving = false;
    return;
  }
  const f = forwardFromYaw(e.locked ? e.lockedYaw : e.yaw);
  const step = ENEMIES.guard.attackStepSpeed * dt;
  const nx = e.x + f.x * step, nz = e.z + f.z * step;
  if (w.grid.circleBlocked(nx, nz, e.radius)) { e.moving = false; return; }
  const r = separate(w, e, nx, nz);
  if (w.grid.circleBlocked(r.x, r.z, e.radius)) { e.moving = false; return; }
  const moved = Math.hypot(r.x - e.x, r.z - e.z);
  e.x = r.x;
  e.z = r.z;
  e.moving = moved > 1e-4;
  e.walkPhase += moved * 2.2;
  enemyFootsteps(w, e, moved);
}

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
      if (e.phaseT < s.trackUntil) {
        if (e.seesPlayer) facePlayer(w, e, 8, dt);
      } else if (!e.locked) {
        e.locked = true;
        e.lockedYaw = e.yaw;
      }
      e.moving = false;
      if (e.phaseT >= s.windup) {
        e.phase = 'active';
        e.phaseT = 0;
        w.emit({ type: 'enemyStrike', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
        w.emitNoise(e.x, e.y + 1, e.z, NOISE.combatHit, 'combat', e.id);
      }
      return;
    case 'active': {
      e.phaseT += dt;
      // 只支付作用期剩餘時間，避免跨 phase 的最後子步多踏一段。
      guardStep(w, e, Math.min(dt, Math.max(0, s.active - (e.phaseT - dt))));
      if (!e.hitDone && !p.dead) {
        const dx = p.x - e.x;
        const dz = p.z - e.z;
        const dd = Math.hypot(dx, dz);
        const ang = Math.abs(angleDiff(yawFromDir(dx, dz), e.lockedYaw));
        if (dd <= s.reach + PLAYER.radius && (ang <= ((s.arcDeg / 2) * Math.PI) / 180 || dd < e.radius + PLAYER.radius + 0.15)) {
          const clear = w.grid.segmentHit({ x: e.x, y: 1.2, z: e.z }, { x: p.x, y: 1.2, z: p.z });
          if (!clear) {
            e.hitDone = true;
            w.emitNoise(p.x, 1, p.z, NOISE.combatHit, 'combat', e.id);
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
      e.moving = false;
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

/** Finish a leg without immediately starting another; interrupts keep this paid window. */
function stopArcherMove(e: Enemy): void {
  if (!e.archerMove) return;
  e.archerMove = null;
  e.archerMovePause = ENEMIES.archer.repositionPause;
  e.path = null;
  e.pathGoal = null;
  e.moving = false;
}

/** Tactical decisions require sight now, not a stale perception sample or a hidden position. */
function archerSeesNow(w: World, e: Enemy): boolean {
  const p = w.player;
  const eye = { x: e.x, y: e.y + PERCEPTION.eyeHeight, z: e.z };
  return e.seesPlayer && !p.dead && p.invisT <= 0 &&
    (w.canSee(eye, { x: p.x, y: 1.25, z: p.z }) ||
      w.canSee(eye, { x: p.x, y: PLAYER.eyeHeight, z: p.z }));
}

/** Sixteen deterministic local goals, never a whole-room or hidden-player search. */
function startArcherMove(w: World, e: Enemy, kind: 'angle' | 'retreat'): boolean {
  if (e.perched || e.push || e.archerMovePause > 0) return false;
  const s = ENEMIES.archer;
  const target = { x: w.player.x, y: 1.2, z: w.player.z };
  const distance = Math.hypot(e.x - target.x, e.z - target.z);
  const away = Math.atan2(e.z - target.z, e.x - target.x);
  let best: { goal: V2; path: V2[]; score: number } | null = null;
  const used = new Set<number>();
  for (let ring = 1; ring <= s.repositionRings; ring++) {
    for (let k = 0; k < s.repositionDirections; k++) {
      // Stable handedness; a blocker cannot make the archer flip its goal each frame.
      const angle = away + k * 2 * Math.PI / s.repositionDirections * (e.id % 2 ? 1 : -1);
      const radius = s.repositionRadius * ring / s.repositionRings;
      const cell = w.enav.cellOf(e.x + Math.cos(angle) * radius, e.z + Math.sin(angle) * radius);
      if (used.has(cell) || !w.enav.passable(cell)) continue;
      used.add(cell);
      const goal = w.enav.center(cell);
      const displacement = Math.hypot(goal.x - e.x, goal.z - e.z);
      if (displacement < 0.6 || displacement > s.repositionRadius || w.grid.circleBlocked(goal.x, goal.z, e.radius)) continue;
      const nextDistance = Math.hypot(goal.x - target.x, goal.z - target.z);
      if (nextDistance > s.fireRange || (kind === 'retreat' && nextDistance < distance + s.retreatGain)) continue;
      if (!w.canSee({ x: goal.x, y: e.y + PERCEPTION.eyeHeight, z: goal.z }, target)) continue;
      const clear = archerLineClearAt(w, e, goal, yawFromDir(target.x - goal.x, target.z - goal.z), target);
      if (kind === 'angle' && !clear) continue;
      const path = w.enav.findPath(e.x, e.z, goal.x, goal.z, false, s.repositionMaxExpand);
      if (!path?.length) continue;
      let length = 0, previous: V2 = e, safe = true;
      for (const point of path) {
        const leg = Math.hypot(point.x - previous.x, point.z - previous.z);
        length += leg;
        // Navigation remains authoritative. Sample the body sweep as well: a local
        // dodge never opens a door, crosses a pit/corner, or routes through an ally.
        const steps = Math.max(1, Math.ceil(leg / 0.2));
        for (let j = 1; j <= steps; j++) {
          const q = { x: lerp(previous.x, point.x, j / steps), z: lerp(previous.z, point.z, j / steps) };
          if (w.grid.circleBlocked(q.x, q.z, e.radius) ||
              Math.hypot(q.x - target.x, q.z - target.z) < (kind === 'retreat' ? distance - 0.05 : PLAYER.radius + e.radius + 0.1) ||
              w.enemies.some(o => o !== e && o.alive && !o.perched && Math.hypot(q.x - o.x, q.z - o.z) < e.radius + o.radius + 0.05)) {
            safe = false;
            break;
          }
        }
        if (!safe) break;
        previous = point;
      }
      if (!safe || length > s.repositionPathMax) continue;
      // Prefer short clear sidesteps; retreat prefers more distance but still values a shot.
      const score = kind === 'angle' ? -length : Math.min(nextDistance - distance, 2) + (clear ? 1 : 0) - length * 0.2;
      if (!best || score > best.score + 1e-6) best = { goal, path, score };
    }
  }
  if (!best) return false;
  e.archerMove = { goal: best.goal, kind, time: 0, travel: 0 };
  e.path = best.path;
  e.pathGoal = { ...best.goal };
  e.pathT = s.repositionTime;
  e.stuckT = 0;
  e.aimPoint = null;
  e.locked = false;
  return true;
}

function updateArcherMove(w: World, e: Enemy, dt: number): void {
  const move = e.archerMove!;
  const s = ENEMIES.archer;
  const budget = Math.min(dt, s.repositionTime - move.time,
    (s.repositionTravelMax - move.travel) / (s.speed * s.repositionSpeedMul));
  if (budget <= 0 || e.push) { stopArcherMove(e); return; }
  const x = e.x, z = e.z;
  const arrived = moveTo(w, e, move.goal, s.speed * s.repositionSpeedMul, budget, s.repositionArrive, false, true);
  move.time += dt;
  move.travel += Math.hypot(e.x - x, e.z - z);
  if (arrived || move.time >= s.repositionTime || move.travel >= s.repositionTravelMax || !e.path?.length) stopArcherMove(e);
  // Never begin aim on this tick, even when the leg just ended.
}

function archerAlert(w: World, e: Enemy, dt: number): void {
  const s = ENEMIES.archer;
  const p = w.player;
  const visible = archerSeesNow(w, e);
  if (!visible) e.seesPlayer = false;
  if (!e.archerMove) e.archerMovePause = Math.max(0, e.archerMovePause - dt);
  switch (e.phase) {
    case 'none':
    case 'reload': {
      if (e.phase === 'reload') {
        e.phaseT += dt;
        if (e.phaseT >= s.reload) e.phase = 'none';
      }
      if (!visible) {
        stopArcherMove(e);
        if (!e.perched && e.lastKnown) moveTo(w, e, e.lastKnown, s.speed, dt, 0.6);
        else e.moving = false;
        return;
      }
      facePlayer(w, e, 5, dt);
      if (e.archerMove) { updateArcherMove(w, e, dt); return; }
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      const clear = archerLineClear(w, e);
      if (!e.perched && e.archerMovePause <= 0 && (d < s.minDist || (!clear && d <= s.fireRange))) {
        const started = (d < s.minDist && startArcherMove(w, e, 'retreat')) ||
          (!clear && d <= s.fireRange && startArcherMove(w, e, 'angle'));
        // One cooldown covers the entire decision: failed retreat must still allow
        // a same-tick firing-angle fallback, then failed searches also back off.
        e.archerMovePause = s.repositionPause;
        if (started) { updateArcherMove(w, e, dt); return; }
      }
      if (e.phase === 'none' && d <= s.fireRange) startAim(w, e);
      else if (!e.perched && d > s.maxDist) moveTo(w, e, { x: p.x, z: p.z }, s.speed, dt, s.maxDist * 0.9, false);
      else e.moving = false;
      return;
    }
    case 'aim': {
      e.moving = false;
      // Recheck even on the tick crossing lockAt; after lock the aim point is immutable.
      if (!e.locked && (!visible || !archerLineClear(w, e) || (e.aimPoint && !archerLineClear(w, e, e.aimPoint)))) {
        e.phase = 'none';
        e.phaseT = 0;
        e.aimPoint = null;
        return;
      }
      e.phaseT += dt;
      const lockAt = s.aim - s.lockBefore;
      if (e.phaseT < lockAt) {
        facePlayer(w, e, 6, dt);
        e.aimPoint = { x: p.x, y: 1.2, z: p.z };
      } else if (!e.locked) {
        e.locked = true;
        e.lockedYaw = e.yaw;
        if (!e.aimPoint) { e.phase = 'none'; return; }
        w.emit({ type: 'enemyLock', id: e.id, kind: e.kind, x: e.x, y: e.y + 1.45, z: e.z });
      }
      if (e.phaseT >= s.aim) fireBolt(w, e);
      return;
    }
    default:
      stopArcherMove(e);
      e.phase = 'none';
  }
}

/** Current muzzle-to-player path, checked only before commitment. */
export function archerLineClear(w: World, e: Enemy, target: V3 = { x: w.player.x, y: 1.2, z: w.player.z }): boolean {
  return archerLineClearAt(w, e, e, e.yaw, target);
}

function archerLineClearAt(w: World, e: Enemy, position: V2, yaw: number, target: V3): boolean {
  const f = forwardFromYaw(yaw);
  const body = { x: position.x, y: e.y + 1.45, z: position.z };
  const from = { x: position.x + f.x * 0.5, y: body.y, z: position.z + f.z * 0.5 };
  if (w.grid.segmentHit(body, from, false, PROJECTILES.bolt.radius) ||
      w.grid.segmentHit(from, target, false, PROJECTILES.bolt.radius)) return false;
  return !w.enemies.some((o) => o !== e && o.alive && segmentEnemy(from, target, o, PROJECTILES.bolt.radius));
}

function startAim(w: World, e: Enemy): void {
  if (!archerLineClear(w, e)) { e.moving = false; return; }
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
  w.emitNoise(origin.x, origin.y, origin.z, NOISE.combatHit, 'combat', e.id);
}

/** A visible crown protects only frontal headshots; body/flank shots remain valid. */
export function wardenCrownClosed(e: Enemy): boolean {
  return e.kind === 'warden' && e.alive && e.state === 'alert' &&
    ['none', 'windup', 'aim', 'active', 'charge'].includes(e.phase);
}

export function wardenBraced(e: Enemy): boolean {
  return e.kind === 'warden' && e.alive && !!e.warden?.braced;
}

/** Shared with the pose, ground warning and Counter readiness prediction. */
export function wardenWindup(e: Enemy): number {
  const s = ENEMIES.warden;
  return e.warden?.attack === 'lance' ? s.lanceAim : e.warden?.attack === 'rush' ? s.rushWindup :
    e.warden?.followup ? s.followupWindup : s.cleaveWindup;
}

export function wardenLockBefore(e: Enemy): number {
  const s = ENEMIES.warden;
  return e.warden?.attack === 'lance' ? s.lanceLockBefore : e.warden?.attack === 'rush' ? s.rushLockBefore :
    e.warden?.followup ? s.followupLockBefore : s.cleaveLockBefore;
}

function wardenRecovery(e: Enemy, resolved = false): void {
  e.warden!.sequenceResolved = resolved;
  e.warden!.cleavesLeft = 0;
  e.phase = 'recovery'; e.phaseT = 0; e.locked = false; e.aimPoint = null; e.moving = false;
}

function wardenLanceClear(w: World, e: Enemy, target: V3): boolean {
  const s = ENEMIES.warden, f = forwardFromYaw(e.yaw);
  const body = { x: e.x, y: e.y + s.lanceHeight, z: e.z };
  const muzzle = { x: e.x + f.x * s.lanceMuzzle, y: body.y, z: e.z + f.z * s.lanceMuzzle };
  return !w.grid.segmentHit(body, muzzle, false, s.lanceRadius) &&
    !w.grid.segmentHit(muzzle, target, false, s.lanceRadius);
}

function fireWardenLance(w: World, e: Enemy): void {
  const s = ENEMIES.warden, f = forwardFromYaw(e.lockedYaw);
  const pos = { x: e.x + f.x * s.lanceMuzzle, y: e.y + s.lanceHeight, z: e.z + f.z * s.lanceMuzzle };
  const target = e.aimPoint!;
  const dx = target.x - pos.x, dy = target.y - pos.y, dz = target.z - pos.z;
  const scale = s.lanceSpeed / (Math.hypot(dx, dy, dz) || 1);
  w.projectiles.push({ id: w.nextId++, kind: 'bolt', owner: e.id, pos,
    vel: { x: dx * scale, y: dy * scale, z: dz * scale }, radius: s.lanceRadius,
    gravity: 0, age: 0, alive: true, hitSet: new Set(), next: { ...pos },
    avgVel: { x: 0, y: 0, z: 0 }, deflected: false, tip: null, payload: 'smoke',
    damage: s.damage, source: '守心者的心槍', lifetime: s.lanceRange / s.lanceSpeed });
  w.emit({ type: 'enemyFire', id: e.id, kind: e.kind, source: 'lance', x: pos.x, y: pos.y, z: pos.z });
  w.emitNoise(e.x, pos.y, e.z, NOISE.combatHit, 'combat', e.id);
  wardenRecovery(e, true);
}

/** One selected, committed attack at a time. No phase transition can cut recovery. */
function wardenAlert(w: World, e: Enemy, dt: number): void {
  const s = ENEMIES.warden, b = e.warden!, p = w.player;
  const visible = archerSeesNow(w, e);
  if (!visible) e.seesPlayer = false;
  e.moving = false;
  switch (e.phase) {
    case 'none': {
      if (!b.phaseTwo && e.hp <= e.maxHp * s.phaseThreshold) {
        b.phaseTwo = true; b.rangedCount = 0;
        w.emit({ type: 'buff', kind: 'encounter', text: '守心者裂冠：近身橫斬後還有重斬；遠距交替直線衝刺，等整套收招再反擊' });
      }
      if (!visible || p.dead) { chase(w, e, dt, s.speed, s.cleaveRange * .85); return; }
      const d = Math.hypot(p.x - e.x, p.z - e.z);
      // Selecting a move may face visible information, never a hidden player.
      facePlayer(w, e, 6, dt);
      if (d > s.lanceRange) { chase(w, e, dt, s.speed, s.cleaveRange * .85); return; }
      if (d > s.cleaveRange && d <= s.closePressureRange) {
        chase(w, e, dt, s.speed, s.cleaveRange * .85); return;
      }
      e.yaw = yawFromDir(p.x - e.x, p.z - e.z);
      const target = { x: p.x, y: 1.2, z: p.z };
      if (d <= s.cleaveRange) b.attack = 'cleave';
      else {
        if (!wardenLanceClear(w, e, target)) { chase(w, e, dt, s.speed, s.cleaveRange * .85); return; }
        b.attack = b.phaseTwo && b.rangedCount % 2 === 0 && d <= s.rushTriggerDist &&
          w.enav.lineWalkable(e.x, e.z, p.x, p.z) ? 'rush' : 'lance';
        b.rangedCount++;
      }
      e.phase = b.attack === 'lance' ? 'aim' : 'windup';
      b.followup = false; b.cleavesLeft = b.phaseTwo && b.attack === 'cleave' ? 1 : 0;
      b.sequenceResolved = false;
      e.phaseT = 0; e.locked = false; e.hitDone = false; e.chargeDist = 0;
      e.aimPoint = b.attack === 'lance' ? target : null;
      w.emit({ type: 'enemyWindup', id: e.id, kind: e.kind, source: b.attack, x: e.x, y: e.y, z: e.z });
      return;
    }
    case 'windup':
    case 'aim': {
      const duration = wardenWindup(e), lockBefore = wardenLockBefore(e);
      if (!e.locked) {
        if (!visible || (b.attack === 'lance' && !wardenLanceClear(w, e, { x: p.x, y: 1.2, z: p.z }))) {
          // Abandoning an uncommitted attack pays recovery too, not instant retargeting.
          wardenRecovery(e); return;
        }
        facePlayer(w, e, 5, dt);
        if (b.attack === 'lance') e.aimPoint = { x: p.x, y: 1.2, z: p.z };
      }
      e.phaseT += dt;
      if (!e.locked && e.phaseT >= duration - lockBefore) {
        e.locked = true; e.lockedYaw = e.yaw;
        w.emit({ type: 'enemyLock', id: e.id, kind: e.kind, source: b.attack ?? undefined, x: e.x, y: e.y + 1.5, z: e.z });
      }
      if (e.phaseT >= duration) {
        if (b.attack === 'lance') fireWardenLance(w, e);
        else {
          e.phase = b.attack === 'rush' ? 'charge' : 'active'; e.phaseT = 0;
          w.emit({ type: 'enemyStrike', id: e.id, kind: e.kind, source: b.attack ?? undefined, x: e.x, y: e.y, z: e.z });
          w.emitNoise(e.x, e.y + 1, e.z, NOISE.combatHit, 'combat', e.id);
        }
      }
      return;
    }
    case 'active': {
      e.phaseT += dt;
      const dx = p.x - e.x, dz = p.z - e.z;
      const d = Math.hypot(dx, dz);
      const angle = Math.abs(angleDiff(yawFromDir(dx, dz), e.lockedYaw));
      // Same solid wedge shown by presentation; no hidden inner-circle hit.
      if (!e.hitDone && !p.dead && d <= s.cleaveReach + PLAYER.radius &&
          angle <= s.cleaveArcDeg * Math.PI / 360 &&
          !w.grid.segmentHit({ x: e.x, y: 1.2, z: e.z }, { x: p.x, y: 1.2, z: p.z })) {
        e.hitDone = true;
        w.damagePlayer(b.followup ? s.followupDamage : s.cleaveDamage, b.followup ? '守心者的追擊重斬' : '守心者的橫斬', e.x, e.z);
      }
      if (e.phaseT >= s.cleaveActive) {
        if (b.cleavesLeft > 0) {
          b.cleavesLeft--; b.followup = true;
          e.phase = 'windup'; e.phaseT = 0; e.locked = false; e.hitDone = false;
          w.emit({ type: 'enemyWindup', id: e.id, kind: e.kind, source: 'cleave-followup', x: e.x, y: e.y, z: e.z });
        } else wardenRecovery(e, true);
      }
      return;
    }
    case 'charge': {
      e.yaw = e.lockedYaw;
      const f = forwardFromYaw(e.lockedYaw);
      const step = Math.min(s.rushSpeed * dt, s.rushDist - e.chargeDist);
      const nx = e.x + f.x * step, nz = e.z + f.z * step;
      if (w.grid.circleBlocked(nx, nz, e.radius)) {
        staggerEnemy(e, s.wallStagger, true);
        w.emit({ type: 'stun', id: e.id, x: e.x, y: 1, z: e.z });
        return;
      }
      if (!p.dead && Math.hypot(p.x - nx, p.z - nz) <= e.radius + PLAYER.radius) {
        if (!e.hitDone) { e.hitDone = true; w.damagePlayer(s.rushDamage, '守心者的衝刺', e.x, e.z); }
        wardenRecovery(e, true); return;
      }
      // Although the encounter is solo, retained world fixtures cannot be phased through.
      if (w.enemies.some(o => o !== e && o.alive && !o.perched && Math.hypot(o.x - nx, o.z - nz) < o.radius + e.radius)) {
        wardenRecovery(e, true); return;
      }
      e.x = nx; e.z = nz; e.moving = step > 0; e.walkPhase += step * 1.5;
      enemyFootsteps(w, e, step); e.chargeDist += step;
      if (e.chargeDist >= s.rushDist - 1e-8) wardenRecovery(e, true);
      return;
    }
    case 'recovery': {
      e.phaseT += dt;
      const duration = b.attack === 'lance' ? s.lanceRecovery : b.attack === 'rush' ? s.rushRecovery : s.cleaveRecovery;
      if (e.phaseT >= duration) {
        e.phase = 'none'; e.phaseT = 0; b.attack = null; b.followup = false;
        if (b.sequenceResolved) b.braced = false;
        b.sequenceResolved = false;
      }
      return;
    }
    default:
      e.phase = 'none'; e.phaseT = 0; b.attack = null;
  }
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
      if (e.phaseT < s.windup - s.lockBefore) {
        if (e.seesPlayer) facePlayer(w, e, 5, dt);
      } else if (!e.locked) {
        e.locked = true;
        e.lockedYaw = e.yaw;
      }
      if (e.phaseT >= s.windup) {
        e.phase = 'charge';
        e.phaseT = 0;
        e.chargeDist = 0;
        w.emit({ type: 'enemyStrike', id: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
        w.emitNoise(e.x, e.y + 1, e.z, NOISE.combatHit, 'combat', e.id);
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
          w.emitNoise(nx, 1, nz, NOISE.combatHit, 'impact', e.id);
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
          w.emitNoise(p.x, 1, p.z, NOISE.combatHit, 'combat', e.id);
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
      enemyFootsteps(w, e, step);
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
      e.roamT += dt;
      const arrived = moveTo(w, e, tgt, ENEMIES.patrolSpeed, dt, 0.4);
      // 不可達／擁塞的路段有限放棄；既有門閂仍由導航決定是否可通行。
      if (arrived || e.roamT >= ENEMIES.roamLegTime || (e.path && !e.path.length)) {
        e.moving = false;
        e.patrolWait += dt;
        if (e.patrolWait >= ENEMIES.roamWait) {
          e.patrolWait = 0;
          e.roamT = 0;
          e.patrolIdx = (e.patrolIdx + 1) % e.patrol.length;
          e.path = null;
        }
      }
      return;
    }
    case 'investigate': {
      e.searchT += dt;
      const tgt = e.target ?? { x: e.x, z: e.z };
      const arrived = e.perched || moveTo(w, e, tgt, ENEMIES.searchSpeed, dt, 0.8);
      if (e.perched) e.yaw = turnToward(e.yaw, yawFromDir(tgt.x - e.x, tgt.z - e.z), 3 * dt);
      if (arrived) beginSearch(e);
      else if (e.searchT >= PERCEPTION.investigateTime) resumeWandering(e);
      return;
    }
    case 'search': {
      e.searchT += dt;
      const origin = e.target ?? { x: e.x, z: e.z };
      const tgt = e.searchGoal ?? origin;
      const arrived = e.perched || moveTo(w, e, tgt, ENEMIES.searchSpeed, dt, 0.6);
      if (e.perched) e.yaw = turnToward(e.yaw, yawFromDir(origin.x - e.x, origin.z - e.z), 3 * dt);
      if (arrived) {
        e.moving = false;
        if (e.searchIdx < 0) { e.searchIdx = 0; e.searchT = 0; }
        // 搜索只取事件／最後已知位置附近的導航點，完全不讀玩家目前座標。
        const next = Math.floor(e.searchT / 2);
        if (!e.perched && next > e.searchIdx && next <= 4) {
          e.searchIdx = next;
          const angle = (next + e.id % 4) * Math.PI / 2;
          const c = w.enav.nearestPassable(origin.x + Math.cos(angle) * PERCEPTION.searchRadius,
            origin.z + Math.sin(angle) * PERCEPTION.searchRadius, 2);
          if (c >= 0) {
            const q = w.enav.center(c);
            if (Math.hypot(q.x - origin.x, q.z - origin.z) <= PERCEPTION.searchRadius + 1 &&
                w.enav.pathLength(origin.x, origin.z, q.x, q.z) <= PERCEPTION.searchRadius * 3) {
              e.searchGoal = q;
              e.path = null;
            }
          }
        }
        if (!e.perched) e.yaw = wrapAngle(e.yaw + Math.sin(e.searchT * 1.3) * 2.4 * dt);
      }
      const limit = e.searchIdx < 0 ? PERCEPTION.searchTravelTime : PERCEPTION.searchTime * (e.awakened ? 2 : 1);
      if (e.searchT >= limit) resumeWandering(e);
      return;
    }
    default:
  }
}

/** Commitment means an already locked aim/windup or an active strike/charge.
 * Recovery/reload/stun have delivered the threat and may safely enter normal sleep. */
export function sleepCommitted(e: Enemy): boolean {
  return e.phase === 'active' || e.phase === 'charge' ||
    ((e.phase === 'windup' || e.phase === 'aim') && e.locked);
}

function enterSleep(e: Enemy): void {
  interruptEnemy(e);
  e.pendingSleep = false;
  e.phase = 'none';
  e.state = 'sleep';
  e.awareness = 0;
  e.seesPlayer = false;
  e.suspicious = false;
  e.target = null;
  e.lastKnown = null;
  e.path = null;
  e.pathGoal = null;
  e.searchGoal = null;
  e.searchT = 0;
  e.loseT = 0;
  e.sleepProxT = 0;
  e.shieldUp = false;
  // Physical displacement is independent of AI sleep, just like paralysis.
}

export function lullEnemy(e: Enemy): void {
  if (!e.alive || e.boss) return;
  if (sleepCommitted(e)) e.pendingSleep = true;
  else enterSleep(e);
}

export function updateEnemies(w: World, dt: number): void {
  for (const e of w.enemies) {
    if (!e.alive) {
      e.deathT += dt;
      continue;
    }
    if (e.boss && w.encounterState === 'dormant') continue;
    if (e.pendingSleep && !sleepCommitted(e)) enterSleep(e);
    if (e.hurtT > 0) e.hurtT = Math.max(0, e.hurtT - dt);
    // 被盾推是外力：麻痺中也照樣滑出去
    if (e.push) {
      updatePush(w, e, dt);
      // Continue the current phase, even while sliding. Physical impacts may stagger.
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
      if (!e.boss && !e.seesPlayer && !attacking) {
        e.loseT += edt;
        if (e.loseT >= PERCEPTION.loseTime) {
          e.target = e.lastKnown ? { ...e.lastKnown } : { x: e.x, z: e.z };
          beginSearch(e);
          e.awareness = 0.5;
          e.phase = 'none';
          e.aimPoint = null;
          e.locked = false;
          continue;
        }
      }
      if (w.player.dead && !attacking) {
        e.moving = false;
        continue;
      }
      if (e.kind === 'guard') guardAlert(w, e, edt);
      else if (e.kind === 'archer') archerAlert(w, e, edt);
      else if (e.kind === 'warden') wardenAlert(w, e, edt);
      else chargerAlert(w, e, edt);
    } else {
      stopArcherMove(e);
      if (e.phase !== 'none' && e.phase !== 'stun') e.phase = 'none';
      if (e.phase === 'stun') {
        e.phaseT += edt;
        if (e.phaseT >= ENEMIES.charger.stun) e.phase = 'none';
        continue;
      }
      unawareBehavior(w, e, edt);
    }
    if (e.pendingSleep && !sleepCommitted(e)) enterSleep(e);
    if (e.kind === 'guard') e.shieldUp = guardWantsShield(w, e);
  }
}
