import { WORLD } from '../config';
import { Grid, T, type TileId } from '../sim/grid';
import type { EnemySpawn, LevelData } from './generator';
import { generateLevel } from './validate';

/** Authored practice fixtures only. Never selected by campaign generation. */
export const PRACTICE_TRIALS = [
  { id: 'shield-crossfire', seed: 'TRIAL-SHIELD', name: '盾衛與弩手',
    objective: '清除兩名敵人；比較側路、前排控制與後排射擊空檔。',
    hint: '中央石牆兩側都能通過。正面退射、繞到側面、先處理弩手都可嘗試；留意拉弓時暴露在哪條射線。' },
  { id: 'charger-window', seed: 'TRIAL-CHARGER', name: '撞暈後的空檔',
    objective: '清除兩名敵人；先看第二條射線，再決定是否靠近撞暈者。',
    hint: '突進者與右側弩手同場。牆角可誘發撞暈，也可遮住弩手；撞暈後拔刀、射箭或先換位置由你決定。' },
  { id: 'cluster-bypass', seed: 'TRIAL-CLUSTER', name: '窄道與繞路',
    objective: '到北端開啟空寶箱（E）；左側長路可避開敵群，不必清場。',
    hint: '正前方是短窄道，左側是遮蔽長路。比較普通箭逐個處理、冰霜／氣體或藥劑箭控制，以及完全繞行的時間與受傷。' },
  { id: 'heart-warden', seed: 'TRIAL-WARDEN', name: '守心者試煉',
    objective: '擊倒守心者，再按 E 取走沉眠之心。',
    hint: '近身看扇形橫斬、遠距看紅線槍矢；半血裂冠後留意直線衝撞。觀察鎖定方向，閃開後利用收招空檔反擊。' },
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
