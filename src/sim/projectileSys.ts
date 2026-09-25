import { CLASSES, ENEMIES, PLAYER, PROJECTILES, SMOKE, TIPS } from '../config';
import { movingSpheresTOI, type V3 } from '../core/math';
import { shieldBlocks } from './classSys';
import { chargerHelmet, damageEnemy, enemyForward } from './enemySys';
import type { World } from './world';
import type { Enemy, Projectile } from './types';

interface Hit {
  t: number;
  type: 'wall' | 'bottle' | 'enemy' | 'player';
  wallKind?: string;
  /** 在空中被擊中的煙霧瓶。 */
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
    // 同時空交會：瓶子與箭／石在同一子步內都在移動
    const remain = dt * (1 - tStart);
    for (const bt of w.projectiles) {
      if (bt === p || !bt.alive || bt.kind !== 'bottle' || p.hitSet.has(bt.id)) continue;
      const bPos = lerp3(bt.pos, bt.next, tStart);
      const tau = movingSpheresTOI(a, p.avgVel, bPos, bt.avgVel, p.radius + bt.radius, remain);
      if (tau < 0) continue;
      const t = remain > 0 ? tau / remain : 0;
      if (!best || t < best.t) best = { t, type: 'bottle', bottle: bt, bottleTau: dt * tStart + tau };
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

/** 投擲石落在地上，可以撿回。 */
function dropStone(w: World, x: number, z: number): void {
  const c = w.grid.resolveCircle(x, z, 0.1);
  w.addPickup('stone', 1, c.x, 0.05, c.z, null);
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
          dropStone(w, bAt.x, bAt.z);
          break;
        }
        // 箭穿過瓶子繼續飛
        tStart = tAbs;
        a = at;
        continue;
      }
      if (hit.type === 'player') {
        p.alive = false;
        // 戰士的臂盾：作用期間擋下正面來的弩矢
        if (shieldBlocks(w, at.x - p.vel.x * 0.2, at.z - p.vel.z * 0.2)) {
          w.stats.blocks++;
          w.emit({ type: 'block', kind: 'bolt', x: at.x, y: at.y, z: at.z });
          break;
        }
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
      // 藥劑箭射空：藥劑灑掉，箭身可以撿回當一般箭
      p.tip = null;
      stickArrow(w, p, at, kind);
      w.emit({ type: 'hitWall', x: at.x, y: at.y, z: at.z, kind: 'arrow' });
      w.emitNoise(at.x, at.y, at.z, 4, 'impact');
      break;
    case 'bolt':
      w.emit({ type: 'hitWall', x: at.x, y: at.y, z: at.z, kind: 'bolt' });
      break;
    case 'stone': {
      w.emit({ type: 'hitWall', x: at.x, y: at.y, z: at.z, kind: 'stone' });
      w.emitNoise(at.x, at.y, at.z, PROJECTILES.stone.noise, 'stone');
      // 石頭彈回自己這一側落地
      const h = Math.hypot(p.vel.x, p.vel.z) || 1;
      dropStone(w, at.x - (p.vel.x / h) * 0.3, at.z - (p.vel.z / h) * 0.3);
      break;
    }
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
  // 盾衛：正面盾牌擋住射向身體的箭與石；舉盾前進時連頭也擋（失衡、被推時盾牌放下）
  // 突進者：察覺玩家後低頭，角盔擋住正面的頭
  const guardBlocks =
    e.kind === 'guard' && fromFront && e.state !== 'sleep' && e.phase !== 'stun' && e.phase !== 'stagger' && e.phase !== 'pushed' && (!head || e.shieldUp);
  const helmetBlocks = head && fromFront && chargerHelmet(e);
  if (guardBlocks || helmetBlocks) {
    p.alive = false;
    w.emit({ type: guardBlocks ? 'shield' : 'helmet', x: at.x, y: at.y, z: at.z, id: e.id });
    const dx = e.x + f.x * (e.radius + 0.4);
    const dz = e.z + f.z * (e.radius + 0.4);
    if (p.kind === 'arrow') w.addPickup('arrows', 1, dx, 0.05, dz, null);
    if (p.kind === 'stone') dropStone(w, dx, dz);
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
  // 藥劑箭：改變敵人的時間軸（藥劑碰到東西就用掉）
  if (p.tip) {
    if (e.alive) {
      if (p.tip === 'paralysis') e.paralyzeT = Math.max(e.paralyzeT, TIPS.paralysis.duration);
      else e.slowT = Math.max(e.slowT, TIPS.chill.duration);
      w.stats.tipHits++;
      w.emit({ type: 'tipHit', id: e.id, kind: p.tip, x: at.x, y: at.y, z: at.z });
    }
    p.tip = null;
  }
  if (p.kind !== 'bolt' && p.pierceLeft > 0) {
    p.pierceLeft--;
    return true;
  }
  p.alive = false;
  if (p.kind === 'arrow') {
    if (e.alive) e.lodged++;
    else w.addPickup('arrows', 1, e.x, 0.05, e.z, null);
  }
  if (p.kind === 'stone') dropStone(w, e.x - hx * (e.radius + 0.3), e.z - hz * (e.radius + 0.3));
  return false;
}
