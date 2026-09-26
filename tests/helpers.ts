import { WORLD, type PlayerClass } from '../src/config';
import type { EnemySpawn, LevelData } from '../src/gen/generator';
import { Grid, T, type DoorState } from '../src/sim/grid';
import { emptyInput, type FrameInput } from '../src/sim/types';
import { World } from '../src/sim/world';

/**
 * 以 ASCII 建立測試地圖：
 *  # 牆  . 地板  = 矮牆  o 石柱  D 門  B 單向門（閂在 +x/+z 側可拉開）  @ 出生點（面向 -z）
 */
export function testLevel(rows: string[], enemies: Array<Partial<EnemySpawn> & { kind: EnemySpawn['kind']; x: number; z: number }> = []): LevelData {
  const h = rows.length;
  const w = rows[0]!.length;
  const grid = new Grid(w, h);
  let spawn = { x: 1.5, z: 1.5, yaw: 0 };
  const doorCells: Array<[number, number, boolean]> = [];
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ch = rows[j]![i]!;
      let t: number = T.Floor;
      if (ch === '#') t = T.Wall;
      else if (ch === '=') t = T.Low;
      else if (ch === 'o') grid.addPillar({ x: i + 0.5, z: j + 0.5, r: 0.42, h: WORLD.wallHeight, kind: 'pillar' });
      else if (ch === '@') spawn = { x: i + 0.5, z: j + 0.5, yaw: 0 };
      else if (ch === 'D' || ch === 'B') doorCells.push([i, j, ch === 'B']);
      grid.set(i, j, t as 0);
    }
  }
  // 相鄰門格組成一扇門
  const used = new Set<string>();
  let id = 0;
  for (const [i, j, barred] of doorCells) {
    if (used.has(`${i},${j}`)) continue;
    const cells: Array<[number, number]> = [[i, j]];
    used.add(`${i},${j}`);
    let axis: 'x' | 'z' = 'x';
    if (doorCells.some(([a, b]) => a === i + 1 && b === j)) {
      cells.push([i + 1, j]);
      used.add(`${i + 1},${j}`);
    } else if (doorCells.some(([a, b]) => a === i && b === j + 1)) {
      cells.push([i, j + 1]);
      used.add(`${i},${j + 1}`);
      axis = 'z';
    }
    const cx = cells.reduce((s, c) => s + c[0], 0) / cells.length + 0.5;
    const cz = cells.reduce((s, c) => s + c[1], 0) / cells.length + 0.5;
    const door: DoorState = { id: id++, cells, axis, progress: 0, target: 0, barred, barSide: 1, arch: false, cx, cz };
    grid.addDoor(door);
  }
  return {
    seed: 'TEST',
    floor: 1,
    goal: 'heart',
    templateId: 'A',
    templateName: 'test',
    mirrored: false,
    attempt: 0,
    grid,
    spawn,
    rooms: [],
    enemies: enemies.map((e) => ({
      y: 0,
      yaw: 0,
      state: 'idle',
      patrol: [],
      perched: false,
      roomKey: 'T',
      ...e,
    })),
    pickups: [],
    chests: [],
    altars: [],
    heart: null,
    stairs: null,
    resupply: null,
    traps: [],
    torches: [],
    practice: true,
  };
}

export const OPEN_ROOM = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#........@.........#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
];

export function run(w: World, frames: number, input: Partial<FrameInput> = {}, dt = 1 / 60): number {
  let total = 0;
  for (let k = 0; k < frames; k++) {
    total += w.frame(dt, { ...emptyInput(w.player.yaw, w.player.pitch), ...input });
  }
  return total;
}

/** 等行動結束（以閒置幀推進）。 */
export function finishAction(w: World, dt = 1 / 60, maxFrames = 2000): number {
  let total = 0;
  for (let k = 0; k < maxFrames && w.player.action; k++) total += w.frame(dt, emptyInput(w.player.yaw, w.player.pitch));
  return total;
}

export function makeWorld(rows = OPEN_ROOM, enemies: Parameters<typeof testLevel>[1] = [], cls: PlayerClass = 'warrior'): World {
  return new World(testLevel(rows, enemies), { cls });
}
