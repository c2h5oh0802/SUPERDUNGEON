import { ACTIONS, CLASSES, NOISE, PLAYER, PROJECTILES, RUNES, SWORD } from '../config';
import { angleDiff, dirFromYawPitch, forwardFromYaw, yawFromDir, type V3 } from '../core/math';
import { AIM_EYE_Y, aimPoint } from './aim';
import { applyCounter, counterThreat, deflectBolts, interceptVelocity, quickshotTarget } from './classSys';
import { damageEnemy } from './enemySys';
import { setDoor } from './propSys';
import type { World } from './world';
import type { ActionKind, FrameInput, InteractTarget, Interactable, Projectile, Tool } from './types';

const TOOL_ACTION: Record<Tool, ActionKind> = { sword: 'sword', crossbow: 'crossbow', stone: 'stone' };

export function actionTotal(kind: ActionKind, swift: boolean): number {
  const d = ACTIONS[kind];
  const mul = kind === 'sword' && swift ? RUNES.swiftBlade.timeMul : 1;
  return (d.windup + d.active + d.recovery) * mul;
}

type Timing = { windup: number; active: number; recovery: number };

function startAction(w: World, kind: ActionKind, targetId = -1, timing: Timing = ACTIONS[kind]): void {
  const p = w.player;
  const d = timing;
  const mul = kind === 'sword' && w.hasRune('swiftBlade') ? RUNES.swiftBlade.timeMul : 1;
  p.action = {
    kind,
    windup: d.windup * mul,
    active: d.active * mul,
    recovery: d.recovery * mul,
    t: 0,
    fired: false,
    lockedYaw: p.yaw,
    hitSet: new Set(),
    targetId,
    counter: false,
    countered: false,
    quick: false,
  };
}

/** 依輸入開始新行動（一次只能一個；切換工具不取消行動）。 */
export function startActions(w: World, input: FrameInput): void {
  const p = w.player;
  if (p.dead) return;
  if (input.selectTool && input.selectTool !== p.desiredTool) {
    p.desiredTool = input.selectTool;
    if (!p.action) p.tool = input.selectTool;
    w.emit({ type: 'toolSwitch', kind: input.selectTool });
  }
  if (p.action) return;
  if (input.potion) {
    if (p.potions > 0 && p.hp < p.maxHp) {
      p.potions--;
      w.stats.potionsUsed++;
      startAction(w, 'potion');
      w.emit({ type: 'drink' });
    } else if (p.potions <= 0) w.emit({ type: 'fullInventory', text: '沒有藥水' });
    else w.emit({ type: 'fullInventory', text: '生命已滿' });
    return;
  }
  if (input.bottle) {
    if (p.bottles > 0) startAction(w, 'bottle');
    else w.emit({ type: 'fullInventory', text: '沒有煙霧瓶' });
    return;
  }
  if (input.interact) {
    const t = findInteractTarget(w);
    if (t) interact(w, t);
    return;
  }
  if (input.fire) {
    if (p.tool === 'crossbow' && p.arrows <= 0) {
      if (input.firePressed) w.emit({ type: 'dryFire', text: '沒有弩箭' });
      return;
    }
    // 戰士：威脅已鎖定、就在眼前 → 反擊斬
    if (p.tool === 'sword' && counterThreat(w)) {
      startAction(w, 'sword', -1, CLASSES.warrior.counterSwing);
      p.action!.counter = true;
      return;
    }
    // 獵手：準星對準空中的飛行物 → 疾射
    if (p.tool === 'crossbow') {
      const target = quickshotTarget(w);
      if (target) {
        startAction(w, 'crossbow', target.id, CLASSES.huntress.quickshot);
        p.action!.quick = true;
        return;
      }
    }
    startAction(w, TOOL_ACTION[p.tool]);
  }
}

/** 玩家以真實時間移動；回傳碰撞後的實際水平路程。 */
export function movePlayer(w: World, input: FrameInput, realDt: number): number {
  const p = w.player;
  if (p.dead || realDt <= 0) return 0;
  const fwd = forwardFromYaw(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  let ix = input.moveX;
  let iz = input.moveZ;
  const len = Math.hypot(ix, iz);
  if (len > 1) {
    ix /= len;
    iz /= len;
  }
  const tx = (rx * ix + fwd.x * iz) * PLAYER.moveSpeed;
  const tz = (rz * ix + fwd.z * iz) * PLAYER.moveSpeed;
  const maxDv = PLAYER.accel * realDt;
  let dvx = tx - p.vx;
  let dvz = tz - p.vz;
  const dv = Math.hypot(dvx, dvz);
  if (dv > maxDv) {
    dvx *= maxDv / dv;
    dvz *= maxDv / dv;
  }
  p.vx += dvx;
  p.vz += dvz;
  // 速度上限（斜向不加速）
  const sp = Math.hypot(p.vx, p.vz);
  if (sp > PLAYER.moveSpeed) {
    p.vx *= PLAYER.moveSpeed / sp;
    p.vz *= PLAYER.moveSpeed / sp;
  }
  if (sp < 1e-4 && len === 0) {
    p.vx = 0;
    p.vz = 0;
    return 0;
  }
  const dx = p.vx * realDt;
  const dz = p.vz * realDt;
  const n = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.08));
  let dist = 0;
  for (let s = 0; s < n; s++) {
    const ox = p.x;
    const oz = p.z;
    let r = w.grid.resolveCircle(p.x + dx / n, p.z + dz / n, PLAYER.radius);
    r = pushOutOfEnemies(w, r.x, r.z);
    r = w.grid.resolveCircle(r.x, r.z, PLAYER.radius);
    p.x = r.x;
    p.z = r.z;
    dist += Math.hypot(p.x - ox, p.z - oz);
  }
  // 撞牆時速度跟著實際位移，避免累積
  if (realDt > 0) {
    const ax = dist / realDt;
    const want = Math.hypot(p.vx, p.vz);
    if (ax < want * 0.5) {
      p.vx *= 0.5;
      p.vz *= 0.5;
    }
  }
  return dist;
}

function pushOutOfEnemies(w: World, x: number, z: number): { x: number; z: number } {
  for (const e of w.enemies) {
    if (!e.alive) continue;
    const dx = x - e.x;
    const dz = z - e.z;
    const d = Math.hypot(dx, dz);
    const min = PLAYER.radius + e.radius;
    if (d < min && d > 1e-6) {
      x = e.x + (dx / d) * min;
      z = e.z + (dz / d) * min;
    }
  }
  return { x, z };
}

export function updatePlayerAction(w: World, dt: number): void {
  const p = w.player;
  const a = p.action;
  if (!a) return;
  const prevT = a.t;
  a.t += dt;
  const total = a.windup + a.active + a.recovery;
  // 以同一個容許誤差判定「行動結束」與「結束時的效果」，避免浮點誤差讓效果被跳過
  const done = a.t >= total - 1e-9;
  switch (a.kind) {
    case 'sword':
      if (prevT < a.windup && a.t >= a.windup) {
        a.lockedYaw = p.yaw;
        w.emit({ type: 'swing' });
        swordWallCheck(w);
      }
      if (a.t >= a.windup && prevT < a.windup + a.active) {
        swordHits(w);
        if (deflectBolts(w) > 0) a.countered = true;
        // 反擊或擊開成功：這一劍不用收招
        if (a.countered) a.recovery = 0;
      }
      break;
    case 'crossbow':
    case 'stone':
    case 'bottle':
      if (!a.fired && a.t >= a.windup) {
        a.fired = true;
        fireProjectile(w, a.kind);
      }
      break;
    case 'potion':
      if (!a.fired && done) {
        a.fired = true;
        p.hp = Math.min(p.maxHp, p.hp + PLAYER.potionHeal);
      }
      break;
    case 'use':
      if (!a.fired && done) {
        a.fired = true;
        const it = w.interactables.find((i) => i.id === a.targetId);
        if (it) performUse(w, it);
      }
      break;
    case 'door':
      break;
  }
  if (done || a.t >= a.windup + a.active + a.recovery - 1e-9) {
    w.lastAction = { kind: a.kind, spent: a.t, counter: a.counter, countered: a.countered, quick: a.quick };
    p.action = null;
    if (p.desiredTool !== p.tool) p.tool = p.desiredTool;
  }
}

function swordWallCheck(w: World): void {
  const p = w.player;
  const f = forwardFromYaw(p.action!.lockedYaw);
  const a = { x: p.x, y: 1.3, z: p.z };
  const b = { x: p.x + f.x * SWORD.reach * 0.8, y: 1.3, z: p.z + f.z * SWORD.reach * 0.8 };
  const hit = w.grid.segmentHit(a, b);
  if (hit) w.emit({ type: 'hitWall', x: hit.x, y: hit.y, z: hit.z, kind: 'sword' });
}

function swordHits(w: World): void {
  const p = w.player;
  const a = p.action!;
  const half = ((SWORD.arcDeg / 2) * Math.PI) / 180;
  for (const e of w.enemies) {
    if (!e.alive || a.hitSet.has(e.id)) continue;
    const dx = e.x - p.x;
    const dz = e.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d > SWORD.reach + e.radius) continue;
    const ang = yawFromDir(dx, dz);
    if (Math.abs(angleDiff(ang, a.lockedYaw)) > half && d > e.radius + 0.25) continue;
    if (e.y > 2.0) continue;
    const from = { x: p.x, y: 1.4, z: p.z };
    const to = { x: e.x, y: e.y + 1.1, z: e.z };
    const block = w.grid.segmentHit(from, to);
    if (block && block.t < 0.95) continue;
    a.hitSet.add(e.id);
    const sneak = e.state !== 'alert';
    let dmg = SWORD.damage;
    if (sneak) dmg *= SWORD.sneakMultiplier;
    if (e.kind === 'charger' && e.phase === 'stun') dmg *= 2;
    if (sneak) w.stats.backstabs++;
    // 戰士：命中鎖定中的攻擊＝反擊（改變敵人狀態，不額外加傷害）
    if (applyCounter(w, e)) a.countered = true;
    damageEnemy(w, e, dmg, { source: 'sword', sneak, head: false, x: e.x, y: e.y + 1.1, z: e.z });
    w.emitNoise(e.x, 1, e.z, NOISE.combatHit, 'combat');
  }
}

export function fireProjectile(w: World, kind: 'crossbow' | 'stone' | 'bottle'): Projectile {
  const p = w.player;
  const eye = { x: p.x, y: AIM_EYE_Y, z: p.z };
  const f = forwardFromYaw(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = -Math.sin(p.yaw);
  let origin: V3 = { x: eye.x + f.x * 0.45 + rx * 0.16, y: eye.y - 0.12, z: eye.z + f.z * 0.45 + rz * 0.16 };
  // 出手點不可在牆後：若眼睛到出手點被擋，改在遮擋物前方生成
  const block = w.grid.segmentHit(eye, origin, false, 0.05);
  if (block) origin = { x: eye.x + (origin.x - eye.x) * block.t * 0.8, y: eye.y + (origin.y - eye.y) * block.t * 0.8, z: eye.z + (origin.z - eye.z) * block.t * 0.8 };
  let vel: V3;
  let spec: { speed: number; gravity: number; radius: number };
  const pk = kind === 'crossbow' ? 'arrow' : kind;
  if (kind === 'bottle') {
    spec = PROJECTILES.bottle;
    const lift = (PROJECTILES.bottle.liftDeg * Math.PI) / 180;
    const dir = dirFromYawPitch(p.yaw, Math.min(1.35, p.pitch + lift));
    vel = { x: dir.x * spec.speed, y: dir.y * spec.speed, z: dir.z * spec.speed };
    p.bottles--;
    w.stats.bottlesThrown++;
    w.emit({ type: 'throw', kind: 'bottle' });
  } else {
    spec = kind === 'crossbow' ? PROJECTILES.arrow : PROJECTILES.stone;
    const view = dirFromYawPitch(p.yaw, p.pitch);
    const target = aimPoint(w, eye, view);
    let dx = target.x - origin.x;
    let dy = target.y - origin.y;
    let dz = target.z - origin.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;
    vel = { x: dx * spec.speed, y: dy * spec.speed, z: dz * spec.speed };
    w.stats.shots++;
    if (kind === 'crossbow') p.arrows--;
    w.emit({ type: kind === 'crossbow' ? 'fire' : 'throw', kind: pk });
  }
  // 獵手疾射：修正到與目標在同一時刻交會（目標已消失就照準星射出）
  let interceptId = -1;
  const a = p.action;
  if (kind === 'crossbow' && a?.quick) {
    w.stats.quickshots++;
    const target = w.projectiles.find((q) => q.id === a.targetId && q.alive);
    const v = target ? interceptVelocity(origin, spec.speed, spec.gravity, target) : null;
    if (v) {
      vel = v;
      interceptId = target!.id;
    }
    w.emit({ type: 'quickshot', id: interceptId, kind: target?.kind ?? '' });
  }
  const proj: Projectile = {
    id: w.nextId++,
    kind: pk,
    owner: 'player',
    pos: origin,
    vel,
    radius: spec.radius,
    gravity: spec.gravity,
    age: 0,
    alive: true,
    pierceLeft: kind === 'crossbow' && w.hasRune('pierce') ? RUNES.pierce.extra : 0,
    hitSet: new Set(),
    next: { ...origin },
    avgVel: { ...vel },
    interceptId,
    deflected: false,
  };
  w.projectiles.push(proj);
  return proj;
}

function doorSide(w: World, it: Interactable): -1 | 1 {
  const d = w.grid.doors[it.ref]!;
  const p = w.player;
  return d.axis === 'z' ? (p.x >= d.cx ? 1 : -1) : p.z >= d.cz ? 1 : -1;
}

function interact(w: World, t: InteractTarget): void {
  const it = w.interactables.find((i) => i.id === t.id);
  if (!it) return;
  if (!t.enabled) {
    if (it.kind === 'door') w.emit({ type: 'barred', text: '門從另一側閂住了' });
    if (it.kind === 'stairs') w.emit({ type: 'needHeart', text: '還沒拿到沉眠之心' });
    return;
  }
  switch (it.kind) {
    case 'door': {
      const d = w.grid.doors[it.ref]!;
      if (d.barred) {
        d.barred = false;
        w.emit({ type: 'unbar', x: d.cx, z: d.cz });
        setDoor(w, d.id, true, 'player');
        startAction(w, 'use');
        return;
      }
      if (setDoor(w, d.id, d.target === 0, 'player')) startAction(w, 'door');
      return;
    }
    default:
      startAction(w, 'use', it.id);
  }
}

function performUse(w: World, it: Interactable): void {
  const p = w.player;
  switch (it.kind) {
    case 'chest': {
      if (it.used) return;
      it.used = true;
      w.stats.chests++;
      const c = w.level.chests[it.ref]!.contents;
      giveOrDrop(w, 'arrows', c.arrows, it);
      giveOrDrop(w, 'bottle', c.bottles, it);
      giveOrDrop(w, 'potion', c.potions, it);
      w.emit({ type: 'chest', id: it.id, x: it.x, z: it.z });
      return;
    }
    case 'altar':
      if (it.used) return;
      w.pendingAltar = it.id;
      w.emit({ type: 'altarOpen', id: it.id });
      return;
    case 'heart':
      if (it.used) return;
      it.used = true;
      w.takeHeart();
      return;
    case 'stairs':
      if (!p.hasHeart) return;
      w.outcome = 'win';
      w.emit({ type: 'win' });
      return;
    case 'resupply':
      p.arrows = PLAYER.maxArrows;
      p.bottles = PLAYER.maxBottles;
      p.potions = PLAYER.maxPotions;
      p.hp = p.maxHp;
      w.emit({ type: 'resupply' });
      return;
    case 'door':
      return;
  }
}

function giveOrDrop(w: World, kind: 'arrows' | 'bottle' | 'potion', amount: number, it: Interactable): void {
  if (amount <= 0) return;
  const p = w.player;
  const key = kind === 'arrows' ? 'arrows' : kind === 'bottle' ? 'bottles' : 'potions';
  const max = kind === 'arrows' ? PLAYER.maxArrows : kind === 'bottle' ? PLAYER.maxBottles : PLAYER.maxPotions;
  const room = Math.max(0, max - p[key]);
  const take = Math.min(room, amount);
  p[key] += take;
  if (take > 0) w.emit({ type: 'pickup', kind, amount: take });
  const rest = amount - take;
  if (rest > 0) {
    // 放不下的放在寶箱前方
    const f = forwardFromYaw(it.yaw);
    w.addPickup(kind, rest, it.x + f.x * 0.9 + (kind === 'bottle' ? 0.3 : kind === 'potion' ? -0.3 : 0), 0.15, it.z + f.z * 0.9, null);
  }
}

export function findInteractTarget(w: World): InteractTarget | null {
  const p = w.player;
  if (p.dead) return null;
  let best: InteractTarget | null = null;
  let bestScore = Infinity;
  for (const it of w.interactables) {
    if (it.used && it.kind !== 'door' && it.kind !== 'resupply') continue;
    const dx = it.x - p.x;
    const dz = it.z - p.z;
    const d = Math.hypot(dx, dz);
    const range = it.kind === 'door' ? 2.3 : it.kind === 'stairs' ? 1.5 : PLAYER.interactRange;
    if (d > range) continue;
    const ang = Math.abs(angleDiff(yawFromDir(dx, dz), p.yaw));
    if (ang > 1.2 && d > 0.9) continue;
    const score = d + ang * 1.5;
    if (score >= bestScore) continue;
    let label = '';
    let enabled = true;
    switch (it.kind) {
      case 'door': {
        const door = w.grid.doors[it.ref]!;
        if (door.barred) {
          if (doorSide(w, it) === door.barSide) label = 'E 拉開門閂';
          else {
            label = '門從另一側閂住了';
            enabled = false;
          }
        } else label = door.target === 1 ? 'E 關門' : 'E 開門';
        break;
      }
      case 'chest':
        label = 'E 打開寶箱';
        break;
      case 'altar':
        label = 'E 觸碰刻印祭壇';
        break;
      case 'heart':
        label = 'E 取走沉眠之心';
        break;
      case 'stairs':
        if (p.hasHeart) label = 'E 帶著沉眠之心離開';
        else {
          label = '出口：需要沉眠之心';
          enabled = false;
        }
        break;
      case 'resupply':
        label = 'E 補充全部物資';
        break;
    }
    best = { id: it.id, kind: it.kind, label, enabled };
    bestScore = score;
  }
  return best;
}
