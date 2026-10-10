import { WORLD } from '../config';
import { Grid, T, type TileId } from '../sim/grid';
import type { MachineSpawn } from '../sim/types';
import type { EnemySpawn, LevelData } from './generator';
import { generateLevel } from './validate';

/**
 * Authored practice fixtures only. Never selected by campaign generation.
 * goal: what completes it; kit: the control-item demonstration loadout;
 * prototype: the time-play prototypes (machines, damage multiplier, replay).
 */
export const PRACTICE_TRIALS = [
  { id: 'shield-crossfire', seed: 'TRIAL-SHIELD', name: '盾衛與弩手', goal: 'clear', kit: true, prototype: false, replay: false,
    objective: '清除兩名敵人；比較側路、前排控制與後排射擊空檔。',
    hint: '中央石牆兩側都能通過。正面退射、繞到側面、先處理弩手都可嘗試；留意拉弓時暴露在哪條射線。' },
  { id: 'charger-window', seed: 'TRIAL-CHARGER', name: '撞暈後的空檔', goal: 'clear', kit: true, prototype: false, replay: false,
    objective: '清除兩名敵人；先看第二條射線，再決定是否靠近撞暈者。',
    hint: '突進者與右側弩手同場。牆角可誘發撞暈，也可遮住弩手；撞暈後拔刀、射箭或先換位置由你決定。' },
  { id: 'cluster-bypass', seed: 'TRIAL-CLUSTER', name: '窄道與繞路', goal: 'chest', kit: true, prototype: false, replay: false,
    objective: '到北端開啟空寶箱（E）；左側長路可避開敵群，不必清場。',
    hint: '正前方是短窄道，左側是遮蔽長路。比較普通箭逐個處理、冰霜／氣體或藥劑箭控制，以及完全繞行的時間與受傷。' },
  { id: 'heart-warden', seed: 'TRIAL-WARDEN', name: '守心者試煉', goal: 'heart', kit: false, prototype: false, replay: false,
    objective: '擊倒守心者，再按 E 取走沉眠之心。',
    hint: '近身看扇形橫斬、遠距看紅線槍矢；半血裂冠後留意直線衝撞。觀察鎖定方向，閃開後利用收招空檔反擊。' },
  { id: 'clockwork-corridor', seed: 'TRIAL-CLOCKWORK', name: '機關走廊', goal: 'chest', kit: false, prototype: true, replay: false,
    objective: '穿過三段機關，到盡頭打開寶箱（E）。',
    hint: '機關只隨世界時間運轉：你不動，箭和火焰幾乎停住。先停下來看清節奏（箭孔與噴火口亮起就是要發動了），再抓空檔走過去。' },
  { id: 'crossfire-arena', seed: 'TRIAL-CROSSFIRE', name: '四面來襲', goal: 'clear', kit: true, prototype: true, replay: true,
    objective: '清除五名敵人。這裡被打中比平常痛（×1.5）。',
    hint: '兩名高台弩手、投彈手、盾衛與突進者會一起出手。敵人不會傷到自己人：投彈手的火只燒你；把火瓶打回去或在空中射爆，它就燒敵人。打完會快轉重播整場戰鬥。' },
  { id: 'crossfire-waves', seed: 'TRIAL-WAVES', name: '四面來襲 v2', goal: 'clear', kit: true, prototype: true, replay: true,
    objective: '撐過三波、清除所有敵人。敵人一下就倒，你被打中 ×1.5。',
    hint: '三波敵人從北、西、東三個門進來。弩手會等隊友或近戰一起出手，從兩側交叉齊射。每個敵人一下就倒：先停下來看誰最危險，再一個個解決。投彈手的火只燒你，打回去或射爆就燒敵人。打完會快轉重播整場戰鬥。' },
  { id: 'crossfire-quick', seed: 'TRIAL-QUICK', name: '四面來襲 v3', goal: 'clear', kit: true, prototype: true, replay: true,
    objective: '撐過兩波、清除所有敵人。敵人一下就倒，你被打中 ×2.5：弩矢兩下就倒，突進者與火瓶一下。',
    hint: '兩波敵人從北、西、東三個門進來。弩矢與突進者比平常快得多，弩手會等隊友一起從兩側齊射。投彈手的火只燒你，打回去或射爆就燒敵人。打完會快轉重播整場戰鬥。' },
] as const;
export type PracticeTrialId = typeof PRACTICE_TRIALS[number]['id'];
export const trialForSeed = (seed: string) => PRACTICE_TRIALS.find(t => t.seed === seed);
export const trialInfo = (id: PracticeTrialId) => PRACTICE_TRIALS.find(t => t.id === id)!;

export function createTrialLevel(id: PracticeTrialId): LevelData {
  const info = trialInfo(id);
  if (id === 'heart-warden') {
    // Use the actual final-floor arena, including its encounter and Heart gate.
    // Practice is marked only after campaign generation and validation finish.
    return { ...generateLevel(info.seed, { floor: 5 }), practice: true, practiceTrial: id, templateName: info.name };
  }
  if (id === 'clockwork-corridor') return clockworkCorridor();
  if (id === 'crossfire-arena') return crossfireArena();
  if (id === 'crossfire-waves' || id === 'crossfire-quick') return crossfireWaves(id);
  const grid = new Grid(26, 24);
  grid.tiles.fill(T.Wall);
  const rect = (x0: number, z0: number, x1: number, z1: number, tile: TileId = T.Floor) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) grid.set(x, z, tile);
  };
  const enemies: EnemySpawn[] = [];
  const enemy = (kind: EnemySpawn['kind'], x: number, z: number, state: EnemySpawn['state'] = 'idle', perched = false) => {
    if (perched) rect(Math.floor(x), Math.floor(z), Math.floor(x), Math.floor(z), T.Platform);
    enemies.push({ kind, x, z, y: perched ? WORLD.platformHeight : 0, yaw: Math.PI,
      state, patrol: [], perched, roomKey: 'T' });
  };
  let spawn = { x: 4.5, z: 20.5, yaw: -Math.PI / 2 };
  const chests: LevelData['chests'] = [];
  if (id === 'cluster-bypass') {
    // Short, four-metre combat lane plus a longer, fully screened western loop.
    rect(11, 3, 14, 21);
    rect(3, 3, 7, 20);
    rect(3, 3, 14, 5);
    rect(3, 18, 14, 21);
    rect(11, 17, 12, 17, T.Wall);
    spawn = { x: 12.5, z: 20.5, yaw: 0 };
    enemy('guard', 11.8, 11.5, 'sleep');
    enemy('guard', 13.2, 10.5, 'sleep');
    enemy('archer', 12.5, 7.5, 'idle', true);
    chests.push({ x: 12.5, z: 3.8, yaw: Math.PI, roomKey: 'T', contents: { ammo: 0, bottles: 0, items: [] } });
    grid.addPillar({ x: 12.5, z: 3.8, r: .5, h: .9, kind: 'prop' });
  } else {
    rect(2, 2, 23, 17);
    rect(2, 18, 11, 21);
    // Dog-leg start: no opening shot at spawn, with an unobstructed way out.
    rect(2, 16, 9, 17, T.Wall);
    if (id === 'shield-crossfire') {
      rect(9, 6, 10, 11, T.Wall);
      grid.addPillar({ x: 18.5, z: 11.5, r: .65, h: WORLD.wallHeight, kind: 'pillar' });
      enemy('guard', 13.5, 11.5);
      enemy('archer', 14.5, 4.5, 'idle', true);
    } else {
      // The west side of this wall hides a melee approach from the eastern post.
      rect(16, 9, 17, 13, T.Wall);
      rect(8, 10, 9, 11, T.Wall);
      enemy('charger', 12.5, 7.5);
      enemy('archer', 20.5, 5.5, 'idle', true);
    }
  }
  const torches: LevelData['torches'] = [];
  // Place ordinary wall torches against existing walkable cells, not new art.
  for (let z = 3; z < grid.h - 2; z += 4) for (let x = 2; x < grid.w - 2; x++) {
    if (grid.get(x, z) === T.Floor && grid.get(x - 1, z) === T.Wall)
      torches.push({ x: x + .1, y: 2.5, z: z + .5, nx: 1, nz: 0 });
  }
  return {
    seed: info.seed, floor: 1, goal: 'heart', templateId: 'practice', templateName: info.name,
    mirrored: false, attempt: 0, grid, spawn,
    rooms: [{ key: 'T', role: 'practice', tier: 0, optional: id === 'cluster-bypass', layoutId: id,
      name: info.name, x0: 2, z0: 2, w: 22, h: 16 }],
    enemies, pickups: [], chests, heart: null, stairs: null, resupply: null, traps: [], torches,
    practice: true, practiceTrial: id,
  };
}

/** Shared authoring helpers for the time-play prototypes. */
function prototypeBuilder(w: number, h: number) {
  const grid = new Grid(w, h);
  grid.tiles.fill(T.Wall);
  const rect = (x0: number, z0: number, x1: number, z1: number, tile: TileId = T.Floor) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) grid.set(x, z, tile);
  };
  const enemies: EnemySpawn[] = [];
  const enemy = (kind: EnemySpawn['kind'], x: number, z: number, perched = false) => {
    if (perched) rect(Math.floor(x), Math.floor(z), Math.floor(x), Math.floor(z), T.Platform);
    enemies.push({ kind, x, z, y: perched ? WORLD.platformHeight : 0, yaw: Math.PI, state: 'idle', patrol: [], perched, roomKey: 'T' });
  };
  const torches = (): LevelData['torches'] => {
    const out: LevelData['torches'] = [];
    for (let z = 3; z < grid.h - 2; z += 4) for (let x = 2; x < grid.w - 2; x++) {
      if (grid.get(x, z) === T.Floor && grid.get(x - 1, z) === T.Wall) out.push({ x: x + .1, y: 2.5, z: z + .5, nx: 1, nz: 0 });
    }
    return out;
  };
  return { grid, rect, enemies, enemy, torches };
}

const dart = (x: number, z: number, dx: number, start: number, period: number): MachineSpawn =>
  ({ kind: 'dart', x, z, dx, dz: 0, start, period, warn: 0.45, burn: 0, radius: 0, damage: 2, speed: 7 });
const vent = (x: number, z: number, start: number, period: number, burn: number, radius: number): MachineSpawn =>
  ({ kind: 'vent', x, z, dx: 0, dz: 0, start, period, warn: 0.6, burn, radius, damage: 2, speed: 0 });

/**
 * Three sections that only move with world time:
 * A) a northbound hall crossed by three rows of darts (alternating walls);
 * B) an eastbound two-wide hall whose fire vents erupt in a wave, slightly
 *    slower than a walk, with narrow safe pockets between columns;
 * C) a northbound hall mixing two dart rows with a vent row between them.
 */
function clockworkCorridor(): LevelData {
  const info = trialInfo('clockwork-corridor');
  const { grid, rect, torches } = prototypeBuilder(25, 27);
  rect(2, 21, 6, 24);   // start room
  rect(3, 9, 5, 20);    // A
  rect(6, 9, 18, 10);   // B
  rect(19, 2, 21, 10);  // C
  const machines: MachineSpawn[] = [
    dart(3.02, 18.5, 1, 0.6, 1.0), dart(5.98, 15.5, -1, 0.93, 1.0), dart(3.02, 12.5, 1, 1.26, 1.0),
  ];
  // Column k erupts 0.5 s after column k−1: a wave moving east at 4 m/s.
  [8, 10, 12, 14, 16].forEach((x, k) => {
    for (const z of [9.5, 10.5]) machines.push(vent(x + 0.5, z, 1.0 + 0.5 * k, 3.0, 0.9, 0.55));
  });
  // The last row stays clear of the spot in front of the chest.
  machines.push(dart(21.98, 8.0, -1, 0.3, 0.9), dart(19.02, 4.6, 1, 0.75, 0.9));
  for (const x of [19.5, 20.5, 21.5]) machines.push(vent(x, 6.3, 1.6, 2.4, 0.8, 0.45));
  const chest = { x: 20.5, z: 2.8 };
  grid.addPillar({ x: chest.x, z: chest.z, r: .5, h: .9, kind: 'prop' });
  return {
    seed: info.seed, floor: 1, goal: 'heart', templateId: 'practice', templateName: info.name,
    mirrored: false, attempt: 0, grid, spawn: { x: 4.5, z: 23.2, yaw: 0 },
    rooms: [{ key: 'T', role: 'practice', tier: 0, optional: false, layoutId: info.id, name: info.name, x0: 2, z0: 2, w: 21, h: 23 }],
    enemies: [], pickups: [], chests: [{ ...chest, yaw: Math.PI, roomKey: 'T', contents: { ammo: 0, bottles: 0, items: [] } }],
    heart: null, stairs: null, resupply: null, traps: [], torches: torches(), machines,
    practice: true, practiceTrial: info.id,
  };
}

/**
 * Five threats that act together: two perched crossbowmen in the far corners,
 * a bomber lobbing fire bottles over a low wall, and a shield guard plus a
 * charger closing in. A dog-leg entrance keeps the spawn out of every sight
 * line. Hits hurt 1.5× here, so reading the field matters more than trading.
 */
function crossfireArena(): LevelData {
  const info = trialInfo('crossfire-arena');
  const { grid, rect, enemies, enemy, torches } = prototypeBuilder(24, 22);
  rect(2, 2, 21, 14);   // arena
  rect(10, 15, 11, 16); // connector
  rect(2, 17, 11, 19);  // start corridor
  rect(10, 6, 13, 6, T.Wall);  // cover in front of the bomber
  rect(5, 11, 6, 11, T.Wall);
  rect(17, 11, 18, 11, T.Wall);
  grid.addPillar({ x: 7.5, z: 8.5, r: .65, h: WORLD.wallHeight, kind: 'pillar' });
  grid.addPillar({ x: 16.5, z: 8.5, r: .65, h: WORLD.wallHeight, kind: 'pillar' });
  enemy('archer', 3.5, 3.5, true);
  enemy('archer', 20.5, 3.5, true);
  enemy('bomber', 11.5, 3.5);
  enemy('guard', 8.5, 10.5);
  enemy('charger', 14.5, 10.5);
  return {
    seed: info.seed, floor: 1, goal: 'heart', templateId: 'practice', templateName: info.name,
    mirrored: false, attempt: 0, grid, spawn: { x: 3.5, z: 18.5, yaw: -Math.PI / 2 },
    rooms: [{ key: 'T', role: 'practice', tier: 0, optional: false, layoutId: info.id, name: info.name, x0: 2, z0: 2, w: 20, h: 18 }],
    enemies, pickups: [], chests: [], heart: null, stairs: null, resupply: null, traps: [], torches: torches(),
    practice: true, practiceTrial: info.id, damageMul: 1.5, rules: { smartFire: true },
  };
}

/** An authored spawn with exact hit points (prototypes only). */
const spawnAt = (kind: EnemySpawn['kind'], x: number, z: number, hp: number, perched = false): EnemySpawn =>
  ({ kind, x, z, y: perched ? WORLD.platformHeight : 0, yaw: Math.PI, state: 'idle', patrol: [], perched, roomKey: 'T', hp });

/**
 * Crossfire v2: threats that arrive together. Everyone falls to one hit (shield
 * guard and charger to two arrows), the player to two or three. Three waves come
 * through the north, west and east gates, the next one as soon as at most one
 * enemy is left or 20 world seconds after the last. Crossbowmen on both flanks
 * hold their shot for a partner or a melee strike, then fire together.
 *
 * Crossfire v3 (crossfire-quick), same arena: real time too fast to react,
 * stopped time enough (quickThreats); hits hurt 2.5x; two waves, the second
 * 12 world seconds after the first at most, so a fall costs little to retry.
 */
function crossfireWaves(id: 'crossfire-waves' | 'crossfire-quick'): LevelData {
  const info = trialInfo(id);
  const quick = id === 'crossfire-quick';
  const { grid, rect, enemies, torches } = prototypeBuilder(26, 22);
  rect(3, 3, 22, 15);   // arena
  rect(12, 1, 13, 2);   // north gate
  rect(1, 8, 2, 9);     // west gate
  rect(23, 8, 24, 9);   // east gate
  rect(12, 16, 13, 17); // connector
  rect(5, 18, 13, 20);  // start corridor
  rect(12, 12, 13, 12, T.Wall);
  grid.addPillar({ x: 9.5, z: 9.5, r: .6, h: WORLD.wallHeight, kind: 'pillar' });
  grid.addPillar({ x: 15.5, z: 9.5, r: .6, h: WORLD.wallHeight, kind: 'pillar' });
  for (const [x, z] of [[4, 6], [20, 6], [8, 3]] as const) rect(x, z, x, z, T.Platform);
  enemies.push(
    spawnAt('archer', 4.5, 6.5, 2, true), spawnAt('archer', 20.5, 6.5, 2, true),
    spawnAt('rat', 11.8, 4.2, 2), spawnAt('rat', 12.6, 3.6, 2), spawnAt('rat', 13.4, 4.2, 2),
  );
  const waves: NonNullable<LevelData['waves']> = quick ? [
    { alive: 1, time: 12, label: '第二波：四面八方', spawns: [
      spawnAt('charger', 1.6, 8.9, 3), spawnAt('bomber', 12.9, 1.6, 2), spawnAt('rat', 24.0, 8.6, 2), spawnAt('rat', 24.0, 9.4, 2),
      spawnAt('archer', 8.5, 3.5, 2, true),
    ] },
  ] : [
    { alive: 1, time: 20, label: '第二波：西門、北門、東門', spawns: [
      spawnAt('charger', 1.6, 8.9, 3), spawnAt('bomber', 12.9, 1.6, 2), spawnAt('rat', 24.0, 8.6, 2), spawnAt('rat', 24.0, 9.4, 2),
    ] },
    { alive: 1, time: 20, label: '第三波：四面八方', spawns: [
      spawnAt('guard', 12.6, 1.5, 3), spawnAt('charger', 24.0, 9.0, 3), spawnAt('rat', 1.6, 8.6, 2), spawnAt('rat', 1.6, 9.4, 2),
      spawnAt('archer', 8.5, 3.5, 2, true),
    ] },
  ];
  return {
    seed: info.seed, floor: 1, goal: 'heart', templateId: 'practice', templateName: info.name,
    mirrored: false, attempt: 0, grid, spawn: { x: 6.5, z: 19.5, yaw: -Math.PI / 2 },
    rooms: [{ key: 'T', role: 'practice', tier: 0, optional: false, layoutId: info.id, name: info.name, x0: 1, z0: 1, w: 24, h: 20 }],
    enemies, pickups: [], chests: [], heart: null, stairs: null, resupply: null, traps: [], torches: torches(),
    practice: true, practiceTrial: info.id, damageMul: quick ? 2.5 : 1.5,
    rules: { smartFire: true, syncVolley: true, ...(quick ? { quickThreats: true, noLevelUp: true } : {}) }, waves,
  };
}
