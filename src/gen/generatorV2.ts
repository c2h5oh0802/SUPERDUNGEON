import { DUNGEON, ENCOUNTERS, ENEMIES, GEAR, HUNGER, IDENTIFY, PLAYER, RUN, WORLD, type ItemId } from '../config';
import type { V2 } from '../core/math';
import { Rng } from '../core/rng';
import { Nav } from '../sim/nav';
import { Grid, T, TER, type DoorState } from '../sim/grid';
import {
  FIXED_CHEST_HEALING_PER_FLOOR,
  addPatrols,
  connect,
  fillWalls,
  groundCampaignArchers,
  placePickups,
  roomTorches,
  stampRoom,
  type Draft,
  type EnemySpawn,
  type FloorFeeling,
  type LevelData,
  type PedestalSpawn,
  type PickupSpawn,
  type RoomInst,
  type SpecialRoom,
  type TrapKind,
} from './generator';
import { rollEnchant, rollEquipment, rollItem } from './loot';
import { layoutById, layoutsByRoleV2, type RoomLayout } from './rooms';
import { buildTopology, type GenTemplate, type SpecialKind } from './topology';

// 生成版本 2：程序化樓層結構、地形、秘密、陷阱種類、上鎖寶庫。
// 只用於第 1–4 層探索層；舊存檔（生成版本 1）照舊走 generator.ts 的兩種模板。

const FEELINGS: FloorFeeling[] = ['dark', 'flooded', 'overgrown', 'traps', 'secrets'];
const SPECIAL_POOL: SpecialKind[] = ['embers', 'sentries', 'gauntlet', 'stash', 'guarded', 'statue'];
const SPECIAL_LAYOUTS: Record<SpecialKind, string[]> = {
  embers: ['ember-cache'],
  sentries: ['sentry-vault'],
  vault: ['locked-vault'],
  gauntlet: ['trap-ring', 'trap-hall'],
  stash: ['secret-stash'],
  guarded: ['vault', 'vault-gallery'],
  statue: ['statue-hall'],
};
const TRAP_WEIGHTS: Array<[TrapKind, number]> = [
  ['spikes', 2], ['alarm', 2], ['fire', 1], ['frost', 1], ['gas', 1], ['dart', 1], ['teleport', 1],
];

/** 每一層的樓層變化：整局一次決定，相鄰樓層不重複；與嘗試次數無關。 */
export function floorFeeling(seed: string, floor: number): FloorFeeling | null {
  const rng = new Rng(`${seed}#feelings`);
  let prev: FloorFeeling | null = null;
  let out: FloorFeeling | null = null;
  for (let f = 1; f <= floor; f++) {
    const chance = DUNGEON.feelingChance[f - 1] ?? 0;
    const roll = rng.next();
    const pick = rng.pick(FEELINGS.filter((x) => x !== prev));
    out = roll < chance ? pick : null;
    prev = out;
  }
  return out;
}

function pickSpecials(rng: Rng, floor: number, feeling: FloorFeeling | null): SpecialKind[] {
  const count = DUNGEON.specials[floor - 1] ?? 2;
  const out: SpecialKind[] = floor >= 2 ? ['vault'] : [];
  // 石像大廳從第 2 層起出現
  const pool = rng.shuffle(SPECIAL_POOL.filter((k) => floor >= 2 || k !== 'statue'));
  // 樓層變化指定的特殊房先放進來
  const want: SpecialKind | null = feeling === 'secrets' ? 'stash' : feeling === 'traps' ? 'gauntlet' : null;
  if (want) out.push(want);
  for (const k of pool) {
    if (out.length >= count) break;
    if (!out.includes(k)) out.push(k);
  }
  if (feeling === 'secrets' && out.filter((k) => k === 'stash').length < 2) out.push('stash');
  return out;
}

function weightedTrap(rng: Rng): TrapKind {
  const total = TRAP_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let roll = rng.next() * total;
  for (const [k, w] of TRAP_WEIGHTS) {
    roll -= w;
    if (roll <= 0) return k;
  }
  return 'spikes';
}

/** 在房間裡長出一片地形（只蓋在空地板上，不蓋柱子、物件與補給點）。 */
function blob(d: Draft, room: RoomInst, rng: Rng, kind: number, size: number): void {
  const inside = (i: number, j: number) => i > room.x0 && j > room.z0 && i < room.x0 + room.w - 1 && j < room.z0 + room.h - 1;
  const free = (i: number, j: number) => {
    if (!inside(i, j) || d.tiles[j * d.w + i] !== T.Floor || d.terrain[j * d.w + i] !== TER.None) return false;
    const cx = i + 0.5;
    const cz = j + 0.5;
    if (d.pillars.some((p) => Math.hypot(p.x - cx, p.z - cz) < p.r + 0.6)) return false;
    if (d.pickupSpots.some((p) => Math.hypot(p.x - cx, p.z - cz) < 0.8)) return false;
    return true;
  };
  const cells: Array<[number, number]> = [];
  for (let j = room.z0 + 1; j < room.z0 + room.h - 1; j++) for (let i = room.x0 + 1; i < room.x0 + room.w - 1; i++) if (free(i, j)) cells.push([i, j]);
  if (!cells.length) return;
  const start = rng.pick(cells);
  const frontier: Array<[number, number]> = [start];
  const done = new Set<string>();
  let placed = 0;
  while (frontier.length && placed < size) {
    const [i, j] = frontier.splice(rng.int(0, frontier.length - 1), 1)[0]!;
    const key = `${i},${j}`;
    if (done.has(key)) continue;
    done.add(key);
    if (!free(i, j)) continue;
    d.terrain[j * d.w + i] = kind;
    placed++;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (rng.chance(0.8)) frontier.push([i + di, j + dj]);
  }
}

function assignLayoutsV2(t: GenTemplate, rng: Rng): Map<string, RoomLayout> {
  const out = new Map<string, RoomLayout>();
  const pools = new Map<string, RoomLayout[]>();
  for (const r of t.rooms) {
    const special = t.specials.get(r.key);
    if (special) {
      out.set(r.key, layoutById(rng.pick(SPECIAL_LAYOUTS[special])));
      continue;
    }
    let pool = pools.get(r.role);
    if (!pool || pool.length === 0) {
      pool = rng.shuffle(layoutsByRoleV2(r.role).slice());
      pools.set(r.role, pool);
    }
    out.set(r.key, pool.pop()!);
  }
  return out;
}

/** 依樓層把版型裡的敵人換成新的種類：盾衛位 → 鼠群／號角哨兵，弩手位 → 投彈手。特殊房不換。 */
function substituteEnemies(d: Draft, t: GenTemplate, rng: Rng, fi: number): void {
  const out: EnemySpawn[] = [];
  let sentries = 0;
  const free = (x: number, z: number) => d.tiles[Math.floor(z) * d.w + Math.floor(x)] === T.Floor &&
    !d.pillars.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + ENEMIES.rat.radius + 0.05) &&
    !out.some((o) => Math.hypot(o.x - x, o.z - z) < 0.65);
  for (const e of d.enemies) {
    if (t.specials.has(e.roomKey) || e.boss) { out.push(e); continue; }
    if (e.kind === 'guard' && !e.perched) {
      const r = rng.next();
      if (r < ENCOUNTERS.rats[fi]!) {
        const offsets: Array<[number, number]> = [[0, 0], [0.8, 0.45], [-0.7, 0.6], [0.1, -0.85]];
        let n = 0;
        for (const [ox, oz] of offsets) {
          if (n >= ENCOUNTERS.ratPack) break;
          const x = e.x + ox;
          const z = e.z + oz;
          if (!free(x, z)) continue;
          out.push({ ...e, kind: 'rat', x, z, patrol: e.patrol.map((p) => ({ ...p })), veteran: false });
          n++;
        }
        continue;
      }
      if (r < ENCOUNTERS.rats[fi]! + ENCOUNTERS.sentry[fi]! && sentries < ENCOUNTERS.maxSentries) {
        sentries++;
        out.push({ ...e, kind: 'sentry' });
        continue;
      }
    } else if (e.kind === 'archer' && rng.chance(ENCOUNTERS.bomber[fi]!)) {
      out.push({ ...e, kind: 'bomber' });
      continue;
    }
    out.push(e);
  }
  d.enemies.length = 0;
  d.enemies.push(...out);
}

/** 精英持鑰者：主線上較深房間裡的盾衛或突進者。 */
function pickCarrier(d: Draft, t: GenTemplate, rng: Rng): EnemySpawn | null {
  const depth = (key: string) => t.depth.get(key) ?? 0;
  const maxDepth = Math.max(...d.rooms.map((r) => depth(r.key)));
  const cands = d.enemies.filter((e) => !e.perched && (e.kind === 'guard' || e.kind === 'charger') &&
    !t.specials.has(e.roomKey) && depth(e.roomKey) >= Math.max(1, Math.floor(maxDepth / 2)) &&
    d.rooms.find((r) => r.key === e.roomKey)?.role === 'combat');
  // 優先挑還不是老兵的敵人，讓這一層的老兵數量不因此減少
  const fresh = cands.filter((e) => !e.veteran);
  return fresh.length ? rng.pick(fresh) : cands.length ? rng.pick(cands) : null;
}

/** 單次嘗試（未驗證）：第 1–4 層。 */
export function buildLevelV2(seed: string, attempt: number, floor: number): LevelData {
  const fi = floor - 1;
  const rng = new Rng(`${seed}#F${floor}#v2#${attempt}`);
  const feeling = floorFeeling(seed, floor);
  const specials = pickSpecials(rng, floor, feeling);
  const t = buildTopology(rng, {
    cols: DUNGEON.cols,
    rows: DUNGEON.rows,
    mainRooms: DUNGEON.mainRooms[fi]!,
    minExitDepth: DUNGEON.minExitDepth[fi]!,
    loops: DUNGEON.loops[fi]! + (feeling === 'secrets' ? 1 : 0),
    shortcut: rng.chance(DUNGEON.shortcutChance[fi]!),
    specials,
  });
  const S = WORLD.slotSize;
  const w = t.cols * S + 2;
  const h = t.rows * S + 2;
  const d: Draft = {
    w,
    h,
    tiles: new Array(w * h).fill(T.Void),
    pillars: [],
    doors: [],
    rooms: [],
    enemies: [],
    pickupSpots: [],
    chests: [],
    heart: null,
    stairs: null,
    resupply: null,
    traps: [],
    torches: [],
    spawn: null,
    terrain: new Array<number>(w * h).fill(TER.None),
    pedestalSpots: [],
  };
  const layouts = assignLayoutsV2(t, rng);
  for (const r of t.rooms) stampRoom(d, t, r, layouts.get(r.key)!, DUNGEON.tierBonus[fi]!);
  for (const room of d.rooms.filter((r) => r.layoutId === 'sentry-vault')) {
    const chest = d.chests.find((c) => c.roomKey === room.key)!;
    for (const e of d.enemies.filter((e) => e.roomKey === room.key))
      e.yaw = Math.atan2(-(chest.x - e.x), -(chest.z + 1.3 - e.z));
  }
  substituteEnemies(d, t, rng, fi);
  const wake = RUN.wakeChance[fi]!;
  for (const e of d.enemies) if (e.state === 'sleep' && rng.chance(wake)) e.state = 'idle';
  addPatrols(d, rng, RUN.patrolChance[fi]!);
  const vetPool = d.enemies.filter((e) => !e.perched && (e.kind === 'guard' || e.kind === 'charger'));
  for (let k = 0; k < RUN.veterans[fi]! && vetPool.length; k++) vetPool.splice(rng.int(0, vetPool.length - 1), 1)[0]!.veteran = true;
  for (const e of t.edges) {
    const a = t.rooms.find((r) => r.key === e.a)!;
    const b = t.rooms.find((r) => r.key === e.b)!;
    connect(d, t, a, b, layouts.get(a.key)!, layouts.get(b.key)!, e.type, e.barFrom, e.doorOn);
  }

  // 地形：樓層變化給大片的水或草；平常偶爾一小片。
  const plainRooms = d.rooms.filter((r) => r.role === 'combat' && !t.specials.has(r.key));
  for (const room of plainRooms) {
    if (feeling === 'flooded' || feeling === 'overgrown') {
      if (rng.chance(DUNGEON.feelingPatchChance)) blob(d, room, rng, feeling === 'flooded' ? TER.Water : TER.Reeds, rng.int(14, 26));
    } else if (rng.chance(DUNGEON.patchChance)) blob(d, room, rng, rng.chance(0.5) ? TER.Reeds : TER.Water, rng.int(6, 12));
  }
  fillWalls(d);
  if (feeling === 'dark') d.torches.length = 0;
  else for (const room of d.rooms) roomTorches(d, room, rng);

  // 陷阱：版型裡的陷阱加上散落在走道與房間的陷阱；第 1 層只有看得見的尖刺。
  const gauntletRooms = new Set(d.rooms.filter((r) => t.specials.get(r.key) === 'gauntlet').map((r) => r.key));
  const roomOf = (i: number, j: number) => d.rooms.find((r) => i >= r.x0 && j >= r.z0 && i < r.x0 + r.w && j < r.z0 + r.h);
  for (const trap of d.traps) {
    if (floor === 1) continue;
    const inGauntlet = gauntletRooms.has(roomOf(trap.i, trap.j)?.key ?? '');
    trap.kind = inGauntlet ? weightedTrap(rng) : rng.chance(0.7) ? 'spikes' : weightedTrap(rng);
    if (rng.chance(DUNGEON.hiddenTrapChance[fi]!)) trap.hidden = true;
  }
  // 陷阱環：留一個安全的缺口
  for (const room of d.rooms.filter((r) => r.layoutId === 'trap-ring')) {
    const ring = d.traps.filter((tr) => roomOf(tr.i, tr.j)?.key === room.key);
    const gap = rng.pick(ring.filter((tr) => {
      const li = tr.i - room.x0;
      const lj = tr.j - room.z0;
      return !((li === 3 || li === 8) && (lj === 3 || lj === 8));
    }));
    d.traps.splice(d.traps.indexOf(gap), 1);
  }
  const scattered = (DUNGEON.scatteredTraps[fi] ?? 0) + (feeling === 'traps' ? 3 : 0);
  if (scattered > 0) {
    const entrance = d.rooms.find((r) => r.role === 'entrance')!;
    const doorCells = new Set(d.doors.flatMap((dd) => dd.cells.map(([i, j]) => `${i},${j}`)));
    const near = (x: number, z: number, list: Array<{ x: number; z: number }>, r: number) => list.some((p) => Math.hypot(p.x - x, p.z - z) < r);
    const cands: Array<[number, number]> = [];
    for (let j = 1; j < h - 1; j++) for (let i = 1; i < w - 1; i++) {
      if (d.tiles[j * w + i] !== T.Floor || doorCells.has(`${i},${j}`)) continue;
      if (i >= entrance.x0 - 1 && j >= entrance.z0 - 1 && i <= entrance.x0 + entrance.w && j <= entrance.z0 + entrance.h) continue;
      const room = roomOf(i, j);
      if (room && t.specials.has(room.key)) continue;
      const cx = i + 0.5;
      const cz = j + 0.5;
      if (near(cx, cz, d.pickupSpots, 1.2) || near(cx, cz, d.enemies, 1.5) || near(cx, cz, d.pillars, 1.2)) continue;
      if (d.traps.some((tr) => Math.abs(tr.i - i) + Math.abs(tr.j - j) < 3)) continue;
      // 房門口附近的房間內側（不放在 2 格寬的走道，避免整條路被堵死）
      if (!room || i < room.x0 + 2 || j < room.z0 + 2 || i > room.x0 + room.w - 3 || j > room.z0 + room.h - 3) continue;
      if (d.doors.some((dd) => Math.hypot(dd.cells[0]![0] + 0.5 - cx, dd.cells[0]![1] + 0.5 - cz) < 3.6)) cands.push([i, j]);
    }
    rng.shuffle(cands);
    let placed = 0;
    for (const [i, j] of cands) {
      if (placed >= scattered) break;
      if (d.traps.some((tr) => Math.abs(tr.i - i) + Math.abs(tr.j - j) < 3)) continue;
      d.traps.push({ i, j, kind: weightedTrap(rng), hidden: rng.chance(DUNGEON.hiddenTrapChance[fi]!) || undefined });
      placed++;
    }
  }

  // 寶箱怪：特殊房裡的一個寶箱其實是怪物（第 3 層起）。
  // 餘燼側室與守望寶庫的寶箱是解法的獎勵，不換。
  if (rng.chance(ENCOUNTERS.mimic[fi] ?? 0)) {
    const mimicRooms = new Set<SpecialKind>(['guarded', 'gauntlet', 'stash']);
    const cands = d.chests.filter((c) => mimicRooms.has(t.specials.get(c.roomKey)!));
    if (cands.length) {
      const c = rng.pick(cands);
      d.chests.splice(d.chests.indexOf(c), 1);
      const k = d.pillars.findIndex((p) => p.kind === 'prop' && p.x === c.x && p.z === c.z);
      if (k >= 0) d.pillars.splice(k, 1);
      d.enemies.push({ kind: 'mimic', x: c.x, z: c.z, y: 0, yaw: c.yaw, state: 'sleep', patrol: [], perched: false, roomKey: c.roomKey,
        loot: { ammo: 2, bottles: 0, items: [rollItem(rng, floor, 'floor', 2), rollItem(rng, floor, 'floor', 2)] } });
    }
  }
  const pickups: PickupSpawn[] = placePickups(d, rng, floor, 2);
  // 固定的治療藥水放在不必找秘密門就拿得到的寶箱（秘密藏室排最後）。
  const fixedHealing = FIXED_CHEST_HEALING_PER_FLOOR[fi] ?? 0;
  const stashKeys = new Set(d.rooms.filter((r) => t.specials.get(r.key) === 'stash').map((r) => r.key));
  const accessible = d.chests.filter((c) => !stashKeys.has(c.roomKey));
  for (const c of d.chests) if (!accessible.slice(0, fixedHealing).includes(c)) c.contents.items.shift();
  // 寶箱不夠時，剩下的固定治療藥水改放在主線房間的地上（總數與舊版相同）
  const looseHealing = Math.max(0, fixedHealing - accessible.length);
  for (const c of d.chests) c.contents.items.push(rollItem(rng, floor, 'floor', 2));

  // 寶庫三選一：一件已強化的裝備、一張強化卷軸、一瓶治療藥水（位置順序隨機）。
  const pedestals: PedestalSpawn[] = [];
  for (const room of d.rooms.filter((r) => t.specials.get(r.key) === 'vault')) {
    const spots = d.pedestalSpots.filter((p) => p.roomKey === room.key);
    // 寶庫的裝備是已知的（台座標明等級與附魔）
    const equip = rollEquipment(rng, floor);
    const ench = rng.chance(GEAR.enchantChance[fi] ?? 0) ? rollEnchant(rng, equip.id) : undefined;
    const offers: Array<{ item: ItemId; level: number; ench?: PedestalSpawn['ench'] }> = rng.shuffle([
      { item: equip.id, level: Math.max(1, equip.level) + (floor >= 4 ? 1 : 0), ...(ench ? { ench } : {}) },
      { item: 'scroll:upgrade', level: 0 },
      { item: 'potion:healing', level: 0 },
    ]);
    spots.forEach((p, k) => pedestals.push({ ...p, ...offers[k]! }));
  }
  // 石像大廳：台座上只有一件已強化的武器，拿走就會喚醒石像
  for (const room of d.rooms.filter((r) => t.specials.get(r.key) === 'statue')) {
    const spot = d.pedestalSpots.find((p) => p.roomKey === room.key);
    if (!spot) continue;
    const weapons = ['weapon:longsword', 'weapon:knife', 'weapon:axe', 'weapon:spear'] as const;
    // 一定是附魔武器
    const item = rng.pick(weapons);
    pedestals.push({ ...spot, item, level: floor >= 4 ? 2 : 1, ench: rollEnchant(rng, item) });
  }

  const grid = new Grid(w, h);
  for (let k = 0; k < d.tiles.length; k++) grid.tiles[k] = d.tiles[k]!;
  for (let k = 0; k < d.terrain.length; k++) grid.terrain[k] = d.terrain[k]!;
  for (const p of d.pillars) grid.addPillar(p);
  d.doors.forEach((dd, id) => {
    const cx = (dd.cells[0]![0] + dd.cells[1]![0]) / 2 + 0.5;
    const cz = (dd.cells[0]![1] + dd.cells[1]![1]) / 2 + 0.5;
    const door: DoorState = {
      id,
      cells: dd.cells,
      axis: dd.axis,
      progress: dd.arch ? 1 : 0,
      target: dd.arch ? 1 : 0,
      barred: dd.barred,
      barSide: dd.barSide,
      arch: dd.arch,
      cx,
      cz,
    };
    if (dd.locked) door.locked = true;
    if (dd.hidden) door.hidden = true;
    grid.addDoor(door);
  });

  if (!d.spawn) throw new Error('no spawn');
  const spawn = d.spawn;
  const nav = new Nav(grid, PLAYER.radius);
  const seen = nav.flood(spawn.x, spawn.z, false);
  const mainRooms = d.rooms.filter((r) => !r.optional && r.role === 'combat');
  const trapNear = (q: V2) => d.traps.some((tr) => Math.hypot(tr.i + .5 - q.x, tr.j + .5 - q.z) < 1.2);
  const roomSpots = (room: RoomInst, avoid?: (point: V2) => boolean): V2[] => {
    const spots: V2[] = [];
    for (let j = room.z0 + 1; j < room.z0 + room.h - 1; j++) for (let i = room.x0 + 1; i < room.x0 + room.w - 1; i++) {
      const q = { x: i + 0.5, z: j + 0.5 };
      if (grid.get(i, j) !== T.Floor) continue;
      const c = nav.nearestPassable(q.x, q.z, 0.4);
      if (c < 0 || !seen[c] || grid.circleBlocked(q.x, q.z, PLAYER.radius) || trapNear(q) ||
          pickups.some((p) => Math.hypot(p.x - q.x, p.z - q.z) < 1) || avoid?.(q)) continue;
      spots.push(q);
    }
    spots.sort((a, b) => Math.hypot(a.x - room.x0 - room.w / 2, a.z - room.z0 - room.h / 2) -
      Math.hypot(b.x - room.x0 - room.w / 2, b.z - room.z0 - room.h / 2));
    return spots;
  };
  const supplyAt = (index: number, avoid?: (point: V2) => boolean): V2 => {
    const room = mainRooms[index % mainRooms.length];
    if (!room) return { x: spawn.x, z: spawn.z };
    const spots = roomSpots(room, avoid);
    if (!spots.length) throw new Error('No reachable supply cell');
    return spots[0]!;
  };
  const rationCount = HUNGER.foodPerFloor[fi] ?? 0;
  for (let k = 0; k < rationCount; k++) {
    let q: V2 = supplyAt(k === 0 ? 0 : mainRooms.length - 1);
    if (k === 0) {
      const room = mainRooms[0]!;
      const center = nav.nearestPassable(room.x0 + room.w / 2, room.z0 + room.h / 2);
      const target = nav.center(center);
      const path = nav.findPath(spawn.x, spawn.z, target.x, target.z) ?? [];
      let from: V2 = spawn;
      const samples: V2[] = [];
      for (const to of path) {
        const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / .2));
        for (let n = 1; n <= steps; n++) samples.push({ x: from.x + (to.x - from.x) * n / steps, z: from.z + (to.z - from.z) * n / steps });
        from = to;
      }
      const approach = samples.find((p) => p.x > room.x0 + 1.1 && p.x < room.x0 + room.w - 1.1 &&
        p.z > room.z0 + 1.1 && p.z < room.z0 + room.h - 1.1 && !grid.circleBlocked(p.x, p.z, PLAYER.radius) &&
        grid.get(Math.floor(p.x), Math.floor(p.z)) === T.Floor && !trapNear(p));
      if (approach) q = approach;
    }
    pickups.push({ kind: 'item', amount: 1, item: 'food:ration', level: 0, x: q.x, z: q.z });
  }
  for (let k = 0; k < looseHealing; k++) {
    const q = supplyAt(1 + k);
    pickups.push({ kind: 'item', amount: 1, item: 'potion:healing', level: 0, x: q.x, z: q.z });
  }
  const specialRooms: SpecialRoom[] = [];
  for (const room of d.rooms.filter((r) => r.optional)) {
    const kind = t.specials.get(room.key)!;
    if (kind === 'embers' || kind === 'sentries') {
      const embers = kind === 'embers';
      const solution = embers ? 'potion:frost' : 'potion:invisibility';
      const supply = supplyAt(embers ? 0 : 1);
      pickups.push({ kind: 'item', amount: 1, item: solution, level: 0, ...supply });
      const chest = d.chests.find((c) => c.roomKey === room.key)!;
      const fire = embers ? { x: chest.x, z: chest.z + 2 } : undefined;
      specialRooms.push({ kind, roomKey: room.key, solution, supply, fire });
    } else specialRooms.push({ kind, roomKey: room.key });
  }
  // 寶庫的鑰匙：由這一層的精英敵人攜帶；找不到合適的敵人時，放在較深的主線房間。
  const carrier = pedestals.some((p) => d.rooms.find((r) => r.key === p.roomKey && t.specials.get(r.key) === 'vault'))
    ? pickCarrier(d, t, rng) : null;
  if (carrier) {
    carrier.carriesKey = true;
    carrier.veteran = true;
    carrier.elite = rng.pick(ENCOUNTERS.eliteTraits);
  }
  if (!carrier && pedestals.some((p) => d.rooms.find((r) => r.key === p.roomKey && t.specials.get(r.key) === 'vault'))) {
    const vaultKey = d.rooms.find((r) => t.specials.get(r.key) === 'vault')!.key;
    const vaultParent = t.edges.find((e) => e.b === vaultKey)!.a;
    const depthOf = (r: RoomInst) => t.depth.get(r.key) ?? 0;
    const cands = mainRooms.filter((r) => r.key !== vaultParent).sort((a, b) => depthOf(b) - depthOf(a));
    const room = cands[Math.min(cands.length - 1, rng.int(0, 1))] ?? mainRooms[mainRooms.length - 1]!;
    const spot = roomSpots(room)[0];
    if (spot) pickups.push({ kind: 'key', amount: 1, x: spot.x, z: spot.z });
  }
  groundCampaignArchers(d, grid);
  const identifyCount = IDENTIFY.guaranteedPerFloor[fi] ?? 0;
  for (let k = 0; k < identifyCount; k++) {
    const q = supplyAt(0, (p) => Math.hypot(p.x - spawn.x, p.z - spawn.z) <= PLAYER.pickupRadius ||
      d.enemies.some((e) => Math.hypot(p.x - e.x, p.z - e.z) < PLAYER.radius + ENEMIES[e.kind].radius));
    pickups.push({ kind: 'item', amount: 1, item: 'scroll:identify', level: 0, ...q, guaranteedIdentify: true });
  }
  return {
    seed,
    floor,
    goal: 'descend',
    templateId: 'gen',
    templateName: t.name,
    mirrored: false,
    attempt,
    grid,
    spawn,
    rooms: d.rooms,
    enemies: d.enemies,
    pickups,
    chests: d.chests,
    heart: d.heart,
    stairs: d.stairs,
    resupply: d.resupply,
    traps: d.traps,
    torches: d.torches,
    practice: false,
    specialRooms,
    gen: 2,
    feeling,
    pedestals,
  };
}
