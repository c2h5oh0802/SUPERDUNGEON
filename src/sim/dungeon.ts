import { NOISE, PLAYER, PROJECTILES, SEARCH, TERRAIN } from '../config';
import { angleDiff, yawFromDir } from '../core/math';
import { Rng } from '../core/rng';
import { T, TER } from './grid';
import { Nav } from './nav';
import { investigate } from './enemySys';
import { spawnArea, teleport } from './items';
import { gainXp, killXp } from './progress';
import type { Enemy, Trap } from './types';
import type { World } from './world';

// 地城系統（生成版本 2）：地形（長草、淺水、深坑）、秘密門與隱藏陷阱的搜索與察覺、各種陷阱的效果。
// 全部以世界時間推進；思考（慢動作）幾乎不花時間，搜索與等待要付時間。

const cellKey = (w: World, i: number, j: number) => j * w.grid.w + i;

// ---------- 長草：踩倒、延燒 ----------

/** 非潛行走過長草會踩倒（不再擋視線）；潛行步小心穿過不會。 */
export function trample(w: World, x: number, z: number): void {
  const i = Math.floor(x);
  const j = Math.floor(z);
  if (w.grid.terrainAt(i, j) !== TER.Reeds) return;
  w.grid.setTerrain(i, j, TER.Flat);
  w.emit({ type: 'terrain', x: i + 0.5, z: j + 0.5, kind: 'flat' });
}

function burnable(w: World, i: number, j: number): boolean {
  const t = w.grid.terrainAt(i, j);
  return (t === TER.Reeds || t === TER.Flat) && !w.burning.has(cellKey(w, i, j));
}

function ignite(w: World, i: number, j: number): void {
  if (!burnable(w, i, j)) return;
  w.burning.set(cellKey(w, i, j), 0);
  w.areas.push({ id: w.nextId++, kind: 'fire', x: i + 0.5, z: j + 0.5, radius: 0.75, age: 0, life: TERRAIN.burnLife, tickT: 0, hitPlayer: false });
  w.emit({ type: 'terrain', x: i + 0.5, z: j + 0.5, kind: 'burning' });
}

/** 火焰區域點燃範圍內的草；燃燒中的草延燒到相鄰的草，燒完變成灰燼。 */
function updateBurning(w: World, dt: number): void {
  for (const a of w.areas) {
    if (a.kind !== 'fire' || a.radius < 1) continue;
    const r = Math.ceil(a.radius);
    for (let j = Math.floor(a.z) - r; j <= Math.floor(a.z) + r; j++)
      for (let i = Math.floor(a.x) - r; i <= Math.floor(a.x) + r; i++)
        if (Math.hypot(i + 0.5 - a.x, j + 0.5 - a.z) <= a.radius && burnable(w, i, j)) ignite(w, i, j);
  }
  for (const [k, t] of [...w.burning]) {
    const nt = t + dt;
    const i = k % w.grid.w;
    const j = Math.floor(k / w.grid.w);
    if (t < TERRAIN.burnSpread && nt >= TERRAIN.burnSpread) for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) ignite(w, i + di, j + dj);
    if (nt >= TERRAIN.burnLife) {
      w.burning.delete(k);
      w.grid.setTerrain(i, j, TER.Ash);
      w.emit({ type: 'terrain', x: i + 0.5, z: j + 0.5, kind: 'ash' });
    } else w.burning.set(k, nt);
  }
}

// ---------- 深坑 ----------

const overChasm = (w: World, x: number, z: number) => w.grid.get(Math.floor(x), Math.floor(z)) === T.Chasm;

/** 敵人掉進深坑：直接倒下（給經驗、不留屍體與掉落）；帶著的鑰匙落在坑邊。 */
function enemyFalls(w: World, e: Enemy): void {
  e.alive = false;
  e.hp = 0;
  e.fell = true;
  e.deathT = 0;
  e.phase = 'none';
  e.locked = false;
  e.moving = false;
  e.push = null;
  e.corpseFound = true;
  w.stats.kills++;
  w.emit({ type: 'enemyDeath', id: e.id, x: e.x, y: e.y, z: e.z, kind: e.kind, source: 'fall' });
  w.emit({ type: 'fall', id: e.id, x: e.x, y: 0, z: e.z, kind: e.kind });
  w.emitNoise(e.x, 0.5, e.z, NOISE.shout, 'fall', e.id);
  if (e.carriesKey) {
    e.carriesKey = false;
    const spot = nearestFloor(w, e.x, e.z);
    w.addPickup('key', 1, spot.x, 0.15, spot.z, null);
  }
  if (!w.level.publicPlaytest) gainXp(w, killXp(e));
}

/** 離某點最近、可以站的地板（不在深坑裡）。 */
export function nearestFloor(w: World, x: number, z: number): { x: number; z: number } {
  let best = { x, z };
  let bestD = Infinity;
  for (let j = Math.floor(z) - 3; j <= Math.floor(z) + 3; j++)
    for (let i = Math.floor(x) - 3; i <= Math.floor(x) + 3; i++) {
      if (w.grid.get(i, j) !== T.Floor || w.grid.circleBlocked(i + 0.5, j + 0.5, 0.3)) continue;
      const d = Math.hypot(i + 0.5 - x, j + 0.5 - z);
      if (d < bestD) {
        bestD = d;
        best = { x: i + 0.5, z: j + 0.5 };
      }
    }
  return best;
}

function checkFalls(w: World): void {
  const p = w.player;
  if (!p.dead && w.outcome === 'none' && overChasm(w, p.x, p.z)) {
    w.fell = true;
    w.outcome = 'descend';
    w.emit({ type: 'fall', x: p.x, y: 0, z: p.z, kind: 'player' });
    return;
  }
  for (const e of w.enemies) if (e.alive && !e.perched && !e.boss && overChasm(w, e.x, e.z)) enemyFalls(w, e);
}

/** 從上一層的深坑掉下來：落在遠離敵人的隨機地板上，受傷但至少留 1 生命。 */
export function landFromFall(w: World): void {
  const p = w.player;
  const nav = new Nav(w.grid, PLAYER.radius);
  const seen = nav.flood(w.level.spawn.x, w.level.spawn.z, false);
  const rooms = w.level.rooms.filter((r) => !r.optional && r.role === 'combat');
  const cands: Array<{ x: number; z: number }> = [];
  for (const r of rooms) for (let j = r.z0 + 1; j < r.z0 + r.h - 1; j++) for (let i = r.x0 + 1; i < r.x0 + r.w - 1; i++) {
    const x = i + 0.5;
    const z = j + 0.5;
    const c = nav.cellOf(x, z);
    if (w.grid.get(i, j) !== T.Floor || c < 0 || !seen[c] || w.grid.circleBlocked(x, z, PLAYER.radius + 0.05)) continue;
    if (w.enemies.some((e) => e.alive && Math.hypot(e.x - x, e.z - z) < 8)) continue;
    if (w.traps.some((t) => Math.hypot(t.i + 0.5 - x, t.j + 0.5 - z) < 1.5)) continue;
    cands.push({ x, z });
  }
  const rng = new Rng(`${w.level.seed}#fall#${w.level.floor}`);
  if (cands.length) {
    const spot = cands[rng.int(0, cands.length - 1)]!;
    p.x = spot.x;
    p.z = spot.z;
  }
  p.yaw = rng.range(-Math.PI, Math.PI);
  const dmg = Math.min(TERRAIN.fallDamage, Math.max(0, p.hp - 1));
  p.hp -= dmg;
  if (dmg > 0) w.stats.damageTaken['墜落'] = (w.stats.damageTaken['墜落'] ?? 0) + dmg;
  w.emit({ type: 'landed', amount: dmg, text: '你從上一層的深坑掉了下來' });
  w.reveal();
}

// ---------- 秘密門與隱藏陷阱 ----------

function revealDoor(w: World, id: number): void {
  const d = w.grid.doors[id]!;
  if (!d.hidden) return;
  d.hidden = false;
  w.emit({ type: 'secretFound', id, x: d.cx, y: 1.5, z: d.cz, text: '你發現了一道秘密門' });
}

function revealTrap(w: World, t: Trap): void {
  if (!t.hidden) return;
  t.hidden = false;
  w.emit({ type: 'trapFound', id: t.id, x: t.i + 0.5, y: 0, z: t.j + 0.5, kind: t.kind, text: '你發現了一個陷阱' });
}

/** 揭開半徑內所有秘密門與隱藏陷阱；回傳找到的數量。 */
export function revealAround(w: World, x: number, z: number, radius: number): number {
  let found = 0;
  for (const d of w.grid.doors) if (d.hidden && Math.hypot(d.cx - x, d.cz - z) <= radius) {
    revealDoor(w, d.id);
    found++;
  }
  for (const t of w.traps) if (t.hidden && !t.spent && Math.hypot(t.i + 0.5 - x, t.j + 0.5 - z) <= radius) {
    revealTrap(w, t);
    found++;
  }
  return found;
}

/** 搜索（按住等待）與被動察覺（貼近、面對），都以世界時間累積。 */
function updateSearch(w: World, dt: number): void {
  const p = w.player;
  if (p.dead) return;
  if (w.waiting && !p.action && p.lastMoveDist <= 0) {
    w.searchT += dt;
    if (w.searchT >= SEARCH.waitTime) {
      w.searchT -= SEARCH.waitTime;
      const found = revealAround(w, p.x, p.z, SEARCH.radius);
      w.emit({ type: 'searched', amount: found, x: p.x, z: p.z, radius: SEARCH.radius });
    }
  } else w.searchT = 0;
  for (const d of w.grid.doors) {
    if (!d.hidden) continue;
    const dist = Math.hypot(d.cx - p.x, d.cz - p.z);
    if (dist > SEARCH.noticeDoorRange) continue;
    if (Math.abs(angleDiff(yawFromDir(d.cx - p.x, d.cz - p.z), p.yaw)) > 1.0) continue;
    const t = (w.notice.get(d.id) ?? 0) + dt;
    w.notice.set(d.id, t);
    if (t >= SEARCH.noticeTime) revealDoor(w, d.id);
  }
  for (const t of w.traps) {
    if (!t.hidden || t.spent) continue;
    const x = t.i + 0.5;
    const z = t.j + 0.5;
    if (Math.hypot(x - p.x, z - p.z) > SEARCH.noticeTrapRange) continue;
    if (Math.abs(angleDiff(yawFromDir(x - p.x, z - p.z), p.yaw)) > 1.2) continue;
    t.noticeT += dt;
    if (t.noticeT >= SEARCH.noticeTime) revealTrap(w, t);
  }
}

// ---------- 陷阱 ----------

/** 一次性陷阱觸發（尖刺另外走 armed → spikes → reset 的流程）。by：觸發者（玩家、敵人 id 或丟出的東西）。 */
export function triggerTrap(w: World, t: Trap, by: 'player' | 'thrown' | number): void {
  const x = t.i + 0.5;
  const z = t.j + 0.5;
  t.hidden = false;
  t.spent = true;
  w.emit({ type: 'trapTrigger', id: t.id, kind: t.kind, x, y: 0, z, source: typeof by === 'number' ? 'enemy' : by });
  switch (t.kind) {
    case 'alarm':
      // 很大的聲響：附近的敵人過來查看
      w.emitNoise(x, 1, z, 24, 'alarm');
      break;
    case 'fire':
    case 'frost':
    case 'gas':
      spawnArea(w, t.kind, x, z);
      w.emitNoise(x, 0.5, z, NOISE.trap, 'trap');
      break;
    case 'dart':
      fireDart(w, t, by);
      break;
    case 'teleport':
      w.emitNoise(x, 0.5, z, 4, 'trap');
      if (by === 'player') {
        teleport(w);
        w.emit({ type: 'buff', kind: 'teleport', text: '傳送陷阱把你送到別處' });
      } else if (typeof by === 'number') {
        const e = w.enemies.find((o) => o.id === by);
        if (e && w.roamPoints.length) {
          const q = w.roamPoints[w.rng.int(0, w.roamPoints.length - 1)]!;
          e.x = q.x;
          e.z = q.z;
          e.path = null;
          if (e.state !== 'alert') investigate(w, e, { x: q.x, z: q.z });
        }
      }
      break;
    default:
      break;
  }
}

/** 飛鏢從最近的牆射向陷阱格（胸口高度）。 */
function fireDart(w: World, t: Trap, by: 'player' | 'thrown' | number): void {
  const x = t.i + 0.5;
  const z = t.j + 0.5;
  let from: { x: number; z: number } | null = null;
  let best = Infinity;
  for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
    for (let k = 1; k <= 7; k++) {
      if (w.grid.get(t.i + di * k, t.j + dj * k) === T.Wall) {
        if (k < best) {
          best = k;
          from = { x: x + di * (k - 0.55), z: z + dj * (k - 0.55) };
        }
        break;
      }
      if (w.grid.walkBlocked(t.i + di * k, t.j + dj * k) && w.grid.get(t.i + di * k, t.j + dj * k) !== T.Chasm) break;
    }
  }
  if (!from) return;
  const target = by === 'player' ? { x: w.player.x, z: w.player.z } : typeof by === 'number'
    ? (w.enemies.find((e) => e.id === by) ?? { x, z }) : { x, z };
  const dx = target.x - from.x;
  const dz = target.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const speed = PROJECTILES.bolt.speed;
  w.projectiles.push({
    id: w.nextId++, kind: 'bolt', owner: -1, damage: 2, source: '飛鏢陷阱',
    pos: { x: from.x, y: 1.2, z: from.z }, vel: { x: (dx / len) * speed, y: 0, z: (dz / len) * speed },
    radius: PROJECTILES.bolt.radius, gravity: 0, age: 0, alive: true, hitSet: new Set(),
    next: { x: from.x, y: 1.2, z: from.z }, avgVel: { x: 0, y: 0, z: 0 }, deflected: false, tip: null, payload: 'smoke',
  });
  w.emitNoise(from.x, 1.2, from.z, 4, 'trap');
}

/** 丟出的石頭、瓶子落在陷阱上也會觸發。 */
export function triggerTrapAt(w: World, x: number, z: number): void {
  const i = Math.floor(x);
  const j = Math.floor(z);
  const t = w.traps.find((tr) => tr.i === i && tr.j === j);
  if (!t || t.spent) return;
  if (t.kind === 'spikes') {
    if (t.state !== 'idle') return;
    t.hidden = false;
    t.state = 'armed';
    t.t = 0;
    w.emit({ type: 'trapArm', id: t.id, x, y: 0, z });
    return;
  }
  triggerTrap(w, t, 'thrown');
}

// ---------- 每個世界子步 ----------

export function updateDungeon(w: World, dt: number): void {
  updateBurning(w, dt);
  updateSearch(w, dt);
  // 追擊、搜索中的敵人會踩倒草
  for (const e of w.enemies) if (e.alive && e.moving && (e.state === 'alert' || e.state === 'search')) trample(w, e.x, e.z);
  checkFalls(w);
}

export function waterAt(w: World, x: number, z: number): boolean {
  return w.grid.terrainAt(Math.floor(x), Math.floor(z)) === TER.Water;
}
