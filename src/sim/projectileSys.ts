import { CLASSES, ENEMIES, PLAYER, PROJECTILES, SMOKE } from '../config';
import { movingSpheresTOI, type V3 } from '../core/math';
import { damageEnemy, enemyForward } from './enemySys';
import type { World } from './world';
import type { Enemy, Projectile } from './types';

interface Hit {
  t: number;
  type: 'wall' | 'bottle' | 'bolt' | 'enemy' | 'player';
  wallKind?: string;
  /** 被空中擊中的飛行物（瓶子或被截擊的弩矢）。 */
  bottle?: Projectile;
  bottleTau?: number;
  enemy?: Enemy;
  head?: boolean;
}

const lerp3 = (a: V3, b: V3, t: number): V3 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

function enemyHeadY(e: Enemy): number {
  return e.y + ENEMIES[e.kind].headY;
}

/** 以 ≤ 8 cm 取樣檢查投射物與角色（頭部球、身體圓柱）。 */
function charHit(w: World, p: Projectile, a: V3, b: V3): Hit | null {
  const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
  const N = Math.max(1, Math.ceil(L / 0.08));
  for (let k = 0; k <= N; k++) {
    const t = k / N;
    const q = lerp3(a, b, t);
    if (p.owner === 'player') {
      for (const e of w.enemies) {
        if (!e.alive || p.hitSet.has(e.id)) continue;
        const spec = ENEMIES[e.kind];
        const hy = enemyHeadY(e);
        const hdx = q.x - e.x;
        const hdy = q.y - hy;
        const hdz = q.z - e.z;
        const hr = spec.headR + p.radius;
        if (hdx * hdx + hdy * hdy + hdz * hdz <= hr * hr) return { t, type: 'enemy', enemy: e, head: true };
        const hd = Math.hypot(hdx, hdz);
        if (hd <= e.radius + p.radius && q.y >= e.y + 0.05 && q.y <= hy - spec.headR * 0.6)
          return { t, type: 'enemy', enemy: e, head: false };
      }
    } else if (p.kind === 'bolt') {
      const pl = w.player;
      if (pl.dead) return null;
      const d = Math.hypot(q.x - pl.x, q.z - pl.z);
      if (d <= PLAYER.radius + p.radius && q.y >= 0 && q.y <= PLAYER.height + 0.1) return { t, type: 'player' };
    }
  }
  return null;
}

function findHit(w: World, p: Projectile, a: V3, b: V3, dt: number, tStart: number): Hit | null {
  let best: Hit | null = null;
  const wall = w.grid.segmentHit(a, b, false, p.radius);
  if (wall) best = { t: wall.t, type: 'wall', wallKind: wall.kind };
  if (p.owner === 'player' && p.kind !== 'bottle') {
    // 同時空交會：瓶子（或獵手截擊的弩矢）與箭／石在同一子步內都在移動
    const remain = dt * (1 - tStart);
    for (const bt of w.projectiles) {
      if (bt === p || !bt.alive || p.hitSet.has(bt.id)) continue;
      const designated = p.interceptId === bt.id;
      let r: number;
      if (bt.kind === 'bottle') r = designated ? Math.max(CLASSES.huntress.interceptRadius, p.radius + bt.radius) : p.radius + bt.radius;
      else if (bt.kind === 'bolt' && designated && bt.owner !== 'player') r = CLASSES.huntress.interceptRadius;
      else continue;
      const bPos = lerp3(bt.pos, bt.next, tStart);
      const tau = movingSpheresTOI(a, p.avgVel, bPos, bt.avgVel, r, remain);
      if (tau < 0) continue;
      const t = remain > 0 ? tau / remain : 0;
      if (!best || t < best.t) best = { t, type: bt.kind === 'bottle' ? 'bottle' : 'bolt', bottle: bt, bottleTau: dt * tStart + tau };
    }
  }
  const ch = charHit(w, p, a, b);
  if (ch && (!best || ch.t < best.t)) best = ch;
  return best;
}

export function breakBottle(w: World, b: Projectile, pos: V3, air: boolean): void {
  if (!b.alive) return;
  b.alive = false;
  const y = Math.max(0.25, pos.y);
  w.smokes.push({ id: w.nextId++, x: pos.x, y, z: pos.z, age: 0, radius: 0, air });
  if (air) w.stats.airbursts++;
  w.emit({ type: 'bottleBreak', x: pos.x, y, z: pos.z, air });
  w.emit({ type: 'smoke', x: pos.x, y, z: pos.z, air });
  w.emitNoise(pos.x, y, pos.z, SMOKE.noise, 'bottle');
}

function stickArrow(w: World, p: Projectile, at: V3, kind: string | undefined): void {
  const sp = Math.hypot(p.vel.x, p.vel.y, p.vel.z) || 1;
  const dir = { x: p.vel.x / sp, y: p.vel.y / sp, z: p.vel.z / sp };
  if (at.y <= 2.3 && kind !== 'ceiling' && kind !== 'door') {
    const back = 0.05;
    w.addPickup('arrows', 1, at.x - dir.x * back, Math.max(0.05, at.y - dir.y * back), at.z - dir.z * back, dir);
  } else {
    // 太高或射中門：箭掉到地上
    const h = Math.hypot(dir.x, dir.z) || 1;
    w.addPickup('arrows', 1, at.x - (dir.x / h) * 0.35, 0.05, at.z - (dir.z / h) * 0.35, null);
  }
}

export function updateProjectiles(w: World, dt: number): void {
  // 1) 規劃本子步的位移（所有投射物用同一時間區間）
  for (const p of w.projectiles) {
    if (!p.alive) continue;
    p.age += dt;
    p.next = {
      x: p.pos.x + p.vel.x * dt,
      y: p.pos.y + p.vel.y * dt - 0.5 * p.gravity * dt * dt,
      z: p.pos.z + p.vel.z * dt,
    };
    p.avgVel = { x: (p.next.x - p.pos.x) / dt, y: (p.next.y - p.pos.y) / dt, z: (p.next.z - p.pos.z) / dt };
  }
  // 2) 玩家的箭、石（含被擊開的弩矢）先結算：可在空中擊破瓶子、截擊弩矢；再結算敵人的弩矢，最後是瓶子
  const alive = w.projectiles.filter((p) => p.alive);
  const order = alive
    .filter((p) => p.kind !== 'bottle' && p.owner === 'player')
    .concat(alive.filter((p) => p.kind !== 'bottle' && p.owner !== 'player'))
    .concat(alive.filter((p) => p.kind === 'bottle'));
  for (const p of order) {
    if (!p.alive) continue;
    let tStart = 0;
    let a = p.pos;
    for (let iter = 0; iter < 5 && p.alive; iter++) {
      const hit = findHit(w, p, a, p.next, dt, tStart);
      if (!hit) break;
      const tAbs = tStart + (1 - tStart) * hit.t;
      const at = lerp3(p.pos, p.next, tAbs);
      if (hit.type === 'wall') {
        onWall(w, p, at, hit.wallKind);
        break;
      }
      if (hit.type === 'bottle') {
        const b = hit.bottle!;
        const bAt = { x: b.pos.x + b.avgVel.x * hit.bottleTau!, y: b.pos.y + b.avgVel.y * hit.bottleTau!, z: b.pos.z + b.avgVel.z * hit.bottleTau! };
        breakBottle(w, b, bAt, true);
        p.hitSet.add(b.id);
        if (p.kind === 'stone') {
          p.alive = false;
          w.emit({ type: 'hitWall', x: bAt.x, y: bAt.y, z: bAt.z, kind: 'stone' });
          break;
        }
        // 箭穿過瓶子繼續飛
        tStart = tAbs;
        a = at;
        continue;
      }
      if (hit.type === 'bolt') {
        // 獵手截擊：弩矢被擊落，箭繼續飛
        const b = hit.bottle!;
        const bAt = { x: b.pos.x + b.avgVel.x * hit.bottleTau!, y: b.pos.y + b.avgVel.y * hit.bottleTau!, z: b.pos.z + b.avgVel.z * hit.bottleTau! };
        b.alive = false;
        p.hitSet.add(b.id);
        w.stats.intercepts++;
        w.emit({ type: 'intercept', id: b.id, x: bAt.x, y: bAt.y, z: bAt.z });
        tStart = tAbs;
        a = at;
        continue;
      }
      if (hit.type === 'player') {
        p.alive = false;
        const src = typeof p.owner === 'number' ? w.enemies.find((e) => e.id === p.owner) : undefined;
        w.damagePlayer(PROJECTILES.bolt.damage, '弩手的弩矢', src ? src.x : at.x - p.vel.x, src ? src.z : at.z - p.vel.z);
        break;
      }
      if (hit.type === 'enemy') {
        const e = hit.enemy!;
        if (p.kind === 'bottle') {
          breakBottle(w, p, at, false);
          break;
        }
        const cont = onEnemy(w, p, e, at, !!hit.head);
        if (!cont) break;
        tStart = tAbs;
        a = at;
      }
    }
    if (p.alive) {
      p.pos = p.next;
      p.vel = { x: p.vel.x, y: p.vel.y - p.gravity * dt, z: p.vel.z };
      const g = w.grid;
      if (p.age > PROJECTILES.maxLife || p.pos.x < 0 || p.pos.z < 0 || p.pos.x > g.w || p.pos.z > g.h) p.alive = false;
    }
  }
  // 3) 清除
  for (let i = w.projectiles.length - 1; i >= 0; i--) if (!w.projectiles[i]!.alive) w.projectiles.splice(i, 1);
}

function onWall(w: World, p: Projectile, at: V3, kind: string | undefined): void {
  p.alive = false;
  switch (p.kind) {
    case 'arrow':
      stickArrow(w, p, at, kind);
      w.emit({ type: 'hitWall', x: at.x, y: at.y, z: at.z, kind: 'arrow' });
      w.emitNoise(at.x, at.y, at.z, 4, 'impact');
      break;
    case 'bolt':
      w.emit({ type: 'hitWall', x: at.x, y: at.y, z: at.z, kind: 'bolt' });
      break;
    case 'stone':
      w.emit({ type: 'hitWall', x: at.x, y: at.y, z: at.z, kind: 'stone' });
      w.emitNoise(at.x, at.y, at.z, PROJECTILES.stone.noise, 'stone');
      break;
    case 'bottle':
      p.alive = true;
      breakBottle(w, p, at, false);
      break;
  }
}

/** 回傳 true 表示投射物穿透後繼續飛行。 */
function onEnemy(w: World, p: Projectile, e: Enemy, at: V3, head: boolean): boolean {
  const sp = Math.hypot(p.vel.x, p.vel.z) || 1;
  const hx = p.vel.x / sp;
  const hz = p.vel.z / sp;
  const f = enemyForward(e);
  const fromFront = hx * f.x + hz * f.z < -0.35;
  // 盾衛：正面盾牌擋住射向身體的箭與石（被反擊而失衡時盾牌放下）
  if (e.kind === 'guard' && !head && fromFront && e.phase !== 'stun' && e.phase !== 'stagger' && e.state !== 'sleep') {
    p.alive = false;
    w.emit({ type: 'shield', x: at.x, y: at.y, z: at.z, id: e.id });
    if (p.kind === 'arrow') w.addPickup('arrows', 1, e.x + f.x * (e.radius + 0.4), 0.05, e.z + f.z * (e.radius + 0.4), null);
    w.emitNoise(at.x, at.y, at.z, p.kind === 'stone' ? PROJECTILES.stone.noise : 6, 'shield');
    return false;
  }
  const spec =
    p.kind === 'arrow'
      ? PROJECTILES.arrow
      : p.kind === 'bolt'
        ? { head: CLASSES.warrior.deflectHead, body: CLASSES.warrior.deflectBody }
        : PROJECTILES.stone;
  let dmg: number = head ? spec.head : spec.body;
  if (e.kind === 'charger' && e.phase === 'charge' && fromFront) dmg = Math.ceil(dmg * ENEMIES.charger.frontArmorMul);
  if (e.kind === 'charger' && e.phase === 'stun') dmg *= ENEMIES.charger.stunDamageMul;
  if (!p.deflected) w.stats.shotHits++;
  p.hitSet.add(e.id);
  damageEnemy(w, e, dmg, { source: p.deflected ? 'deflect' : p.kind, sneak: false, head, x: at.x, y: at.y, z: at.z });
  w.emitNoise(at.x, at.y, at.z, p.kind === 'stone' ? PROJECTILES.stone.noise : 8, 'combat');
  if (p.kind === 'arrow' && p.pierceLeft > 0) {
    p.pierceLeft--;
    return true;
  }
  p.alive = false;
  if (p.kind === 'arrow') {
    if (e.alive) e.lodged++;
    else w.addPickup('arrows', 1, e.x, 0.05, e.z, null);
  }
  return false;
}
