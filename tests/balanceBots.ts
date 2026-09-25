import { ENEMIES, MELEE, PLAYER, type PlayerClass } from '../src/config';
import { forwardFromYaw, yawFromDir } from '../src/core/math';
import type { EnemyKind } from '../src/gen/rooms';
import { AIM_EYE_Y } from '../src/sim/aim';
import { attackCommitted, counterThreat } from '../src/sim/classSys';
import { chargerHelmet } from '../src/sim/enemySys';
import { emptyInput, type Enemy, type FrameInput } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { OPEN_ROOM, makeWorld } from './helpers';

// 平衡模擬：兩個職業各一套「完美瞄準」的打法，打同一組遭遇。
// 瞄準永遠精準（慢動作下瞄準本身沒有難度，這正是要檢查的前提）；
// 反應可設延遲（真實秒）：行動中世界以正常速度前進，延遲就是真正的時間壓力。

export interface Encounter {
  name: string;
  enemies: Array<{ kind: EnemyKind; x: number; z: number }>;
}

/** 玩家在 (9.5, 14.5) 面向 -z；敵人約 10 m 外、已發現玩家。 */
export const ENCOUNTERS: Encounter[] = [
  { name: '單一盾衛', enemies: [{ kind: 'guard', x: 9.5, z: 4.5 }] },
  { name: '單一突進者', enemies: [{ kind: 'charger', x: 9.5, z: 4.5 }] },
  { name: '單一弩手', enemies: [{ kind: 'archer', x: 9.5, z: 4.5 }] },
  {
    name: '盾衛＋弩手',
    enemies: [
      { kind: 'guard', x: 9.5, z: 5.5 },
      { kind: 'archer', x: 6.5, z: 3.5 },
    ],
  },
  {
    name: '兩個盾衛',
    enemies: [
      { kind: 'guard', x: 8, z: 5.5 },
      { kind: 'guard', x: 11, z: 5.5 },
    ],
  },
  {
    name: '突進者＋盾衛',
    enemies: [
      { kind: 'charger', x: 9.5, z: 4.5 },
      { kind: 'guard', x: 12.5, z: 6.5 },
    ],
  },
];

export interface Result {
  cleared: boolean;
  dead: boolean;
  worldTime: number;
  damage: number;
  arrows: number;
  tipped: number;
  stones: number;
}

type Decision = Partial<FrameInput>;

function aim(w: World, x: number, y: number, z: number): Decision {
  const p = w.player;
  return { yaw: yawFromDir(x - p.x, z - p.z), pitch: Math.atan2(y - AIM_EYE_Y, Math.hypot(x - p.x, z - p.z)) };
}

/** 世界方向 (dx, dz) 轉成本地移動軸。 */
function move(yaw: number, dx: number, dz: number): Decision {
  const f = forwardFromYaw(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const l = Math.hypot(dx, dz) || 1;
  return { moveX: (dx * rx + dz * rz) / l, moveZ: (dx * f.x + dz * f.z) / l };
}

const alive = (w: World) => w.enemies.filter((e) => e.alive);

/** 沿 (dx, dz) 最多能走多遠（撞牆為止，最多 3 m）。 */
function freeRun(w: World, dx: number, dz: number): number {
  const l = Math.hypot(dx, dz) || 1;
  const p = w.player;
  let d = 0;
  for (let s = 0.25; s <= 3; s += 0.25) {
    if (w.grid.circleBlocked(p.x + (dx / l) * s, p.z + (dz / l) * s, PLAYER.radius)) break;
    d = s;
  }
  return d;
}

/** 閃避方向：優先用 (dx, dz)，走不遠就改成兩側中較空的一邊。 */
function escape(w: World, dx: number, dz: number): { dx: number; dz: number } {
  const cands = [
    { dx, dz, bias: 0.5 },
    { dx: -dz, dz: dx, bias: 0 },
    { dx: dz, dz: -dx, bias: 0 },
  ];
  let best = cands[0]!;
  let bestScore = -1;
  for (const c of cands) {
    const sc = freeRun(w, c.dx, c.dz) + c.bias;
    if (sc > bestScore) {
      best = c;
      bestScore = sc;
    }
  }
  return best;
}
const dist = (w: World, e: Enemy) => Math.hypot(e.x - w.player.x, e.z - w.player.z);

/** 這個敵人的攻擊現在會打到我嗎（需要閃）？ */
function threatDir(w: World): { dx: number; dz: number } | null {
  const p = w.player;
  for (const e of alive(w)) {
    const dx = p.x - e.x;
    const dz = p.z - e.z;
    const d = Math.hypot(dx, dz);
    if (e.paralyzeT > 0) continue;
    if (e.kind === 'guard' && (e.phase === 'windup' || e.phase === 'active')) {
      if (d < ENEMIES.guard.reach + PLAYER.radius + 0.5) return { dx, dz };
    }
    if (e.kind === 'charger' && (e.phase === 'windup' || e.phase === 'charge')) {
      const f = forwardFromYaw(e.phase === 'charge' || e.locked ? e.lockedYaw : e.yaw);
      const along = dx * f.x + dz * f.z;
      const perp = dx * f.z - dz * f.x;
      if (along > 0 && Math.abs(perp) < e.radius + PLAYER.radius + 0.6) return { dx: f.z * Math.sign(perp || 1), dz: -f.x * Math.sign(perp || 1) };
    }
    if (e.kind === 'archer' && e.phase === 'aim' && e.locked) return { dx: -dz, dz: dx };
  }
  for (const b of w.projectiles) {
    if (b.kind !== 'bolt' || b.owner === 'player') continue;
    return { dx: -b.vel.z, dz: b.vel.x };
  }
  return null;
}

function warriorBot(w: World): Decision {
  const p = w.player;
  const es = alive(w);
  const out: Decision = {};
  if (p.tool !== 'sword') out.selectSlot = 1;
  const c = counterThreat(w);
  if (!p.action && c) {
    // 反擊：弩矢就朝弩手打回去
    const archer = es.find((e) => e.kind === 'archer');
    const t = c.kind === 'bolt' ? archer : es.find((e) => e.id === c.id);
    if (t) Object.assign(out, aim(w, t.x, t.y + 1.3, t.z));
    return { ...out, fire: true, firePressed: true };
  }
  // 失衡或暈眩的敵人：補刀
  const open = es.find((e) => e.phase === 'stagger' || e.phase === 'stun');
  if (open) {
    Object.assign(out, aim(w, open.x, 1.2, open.z));
    if (dist(w, open) < MELEE.sword.reach + open.radius - 0.1) return p.action ? out : { ...out, fire: true, firePressed: true };
    return { ...out, ...move(out.yaw!, open.x - p.x, open.z - p.z) };
  }
  const near = es.slice().sort((a, b) => dist(w, a) - dist(w, b))[0];
  if (!near) return out;
  Object.assign(out, aim(w, near.x, near.y + 1.3, near.z));
  // 太早：盾衛舉劍但還沒鎖定、我在它範圍內 → 等它鎖定（反擊提示會出現）
  if (es.some((e) => attackCommitted(e) || e.phase === 'windup')) return out;
  // 弩手：逼近（弩矢來時反擊）
  if (near.kind === 'archer' || (es.every((e) => e.kind === 'archer'))) {
    const a = es.find((e) => e.kind === 'archer')!;
    return { ...out, ...move(out.yaw!, a.x - p.x, a.z - p.z) };
  }
  // 近戰敵人：等它過來
  return { ...out, wait: true };
}

function huntressBot(w: World): Decision {
  const p = w.player;
  const es = alive(w);
  const out: Decision = {};
  const dodge = threatDir(w);
  // 目標：露出弱點的敵人
  let target: { e: Enemy; y: number; tip: 'paralysis' | 'chill' | null } | null = null;
  const pick = (e: Enemy): { y: number; tip: 'paralysis' | 'chill' | null } | null => {
    if (e.kind === 'archer') return { y: e.y + 1.1, tip: null };
    if (e.kind === 'guard') {
      // 舉盾時正面頭與身體都擋：等窗口（舉劍、收招）
      if (e.shieldUp) return null;
      // 舉劍鎖定、就在身邊：麻痺它
      const tip = e.phase === 'windup' && e.locked && dist(w, e) < 3 && p.tipped.paralysis > 0 ? 'paralysis' : null;
      return { y: e.y + ENEMIES.guard.headY, tip };
    }
    if (!chargerHelmet(e) && e.phase !== 'charge') return { y: e.y + ENEMIES.charger.headY, tip: null };
    if (e.phase === 'charge') return null;
    // 蓄勢：冰寒箭讓衝鋒變慢
    const tip = e.phase === 'windup' && p.tipped.chill > 0 && e.slowT <= 0 ? 'chill' : null;
    return { y: e.y + 1.0, tip };
  };
  const ranked = es.slice().sort((a, b) => (a.kind === 'archer' ? -1 : 0) - (b.kind === 'archer' ? -1 : 0) || dist(w, a) - dist(w, b));
  for (const e of ranked) {
    const t = pick(e);
    if (t) {
      target = { e, ...t };
      break;
    }
  }
  if (target) {
    Object.assign(out, aim(w, target.e.x, target.y, target.e.z));
    const want = target.tip ? 'tipped' : 'bow';
    if (!p.action && p.tool === want && (want === 'bow' ? p.arrows > 0 : p.tipped[target.tip!] > 0)) {
      if (target.tip && p.tipKind !== target.tip) out.selectSlot = 3;
      else {
        out.fire = true;
        out.firePressed = true;
      }
    } else if (p.desiredTool !== want) out.selectSlot = want === 'bow' ? 2 : 3;
  } else if (es[0]) {
    Object.assign(out, aim(w, es[0].x, es[0].y + 1.3, es[0].z));
    if (p.desiredTool !== 'bow') out.selectSlot = 2;
  }
  const yaw = out.yaw ?? p.yaw;
  if (dodge) {
    const d = escape(w, dodge.dx, dodge.dz);
    return { ...out, ...move(yaw, d.dx, d.dz) };
  }
  // 兩個近戰敵人同時貼近：拉開距離把它們拆開（往較空的方向）；只有一個時就站著等它舉劍露出頭
  const closeAll = es.filter((e) => e.kind !== 'archer' && dist(w, e) < 4 && e.phase === 'none');
  const close = closeAll.length >= 2 ? closeAll[0] : undefined;
  if (close && !out.fire) {
    const d = escape(w, p.x - close.x, p.z - close.z);
    return { ...out, ...move(yaw, d.dx, d.dz) };
  }
  if (!out.fire && !es.some((e) => e.phase !== 'none' && e.phase !== 'reload')) out.wait = true;
  return out;
}

export function runEncounter(cls: PlayerClass, enc: Encounter, reactReal: number, trace?: (w: World) => void): Result {
  const w = makeWorld(
    OPEN_ROOM,
    enc.enemies.map((e) => ({ ...e, yaw: 0, state: 'idle' as const })),
    cls,
  );
  for (const e of w.enemies) {
    e.state = 'alert';
    e.awareness = 1;
    e.yaw = yawFromDir(w.player.x - e.x, w.player.z - e.z);
  }
  const bot = cls === 'warrior' ? warriorBot : huntressBot;
  const start = { arrows: w.player.arrows, tipped: w.player.tipped.paralysis + w.player.tipped.chill, stones: w.player.stones };
  const dt = 1 / 60;
  let held: Decision = {};
  let nextDecision = 0;
  for (let k = 0; k < 60 * 400 && w.outcome === 'none' && w.time < 40; k++) {
    let frame: Decision;
    if (w.realTime >= nextDecision) {
      held = bot(w);
      nextDecision = w.realTime + reactReal;
      frame = held;
    } else {
      // 反應延遲中：維持視角與移動；開火、換工具只在做決定的那一幀
      frame = { ...held, fire: false, firePressed: false, selectSlot: null, shield: false };
    }
    const base = emptyInput(held.yaw ?? w.player.yaw, held.pitch ?? w.player.pitch);
    w.frame(dt, { ...base, ...frame });
    if (trace) trace(w);
    w.drainEvents();
    if (!w.enemies.some((e) => e.alive)) break;
  }
  const p = w.player;
  return {
    cleared: !w.enemies.some((e) => e.alive),
    dead: p.dead,
    worldTime: w.time,
    damage: PLAYER.maxHp - p.hp,
    arrows: start.arrows - p.arrows,
    tipped: start.tipped - (p.tipped.paralysis + p.tipped.chill),
    stones: start.stones - p.stones,
  };
}
