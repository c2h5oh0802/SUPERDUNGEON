import type { LevelData } from '../gen/generator';
import { createTrialLevel } from '../gen/practiceTrials';
import { Grid, T } from '../sim/grid';
import { World } from '../sim/world';

export const PUBLIC_BUILD_ID = 'PublicConnectedV3' as const;
export type PlaytestStage = 'calibration' | 'core';

/** Disposable authored fixtures. No RunState, campaign save, carry, or trial kit. */
export function createPublicPlaytestWorld(stage: PlaytestStage): World {
  const level = stage === 'calibration' ? createConnectedPlaytestLevel() : createTrialLevel('shield-crossfire');
  level.publicPlaytest = stage;
  const world = new World(level, { cls: 'warrior' });
  // Disposable, disclosed starting wound. No combat damage or healing rule changes.
  if (stage === 'calibration') world.player.hp = Math.ceil(world.player.maxHp / 2);
  world.drainEvents();
  return world;
}

export function createCalibrationLevel(): LevelData {
  const grid = new Grid(14, 15);
  grid.tiles.fill(T.Wall);
  for (let z = 1; z < 14; z++) for (let x = 1; x < 13; x++) grid.set(x, z, T.Floor);
  return {
    seed: 'REMOTE-VALIDATION-V1-CALIBRATION', floor: 1, goal: 'heart',
    templateId: 'practice', templateName: '操作校準', mirrored: false, attempt: 0,
    grid, spawn: { x: 7, z: 9.5, yaw: 0 },
    rooms: [{ key: 'C', role: 'practice', tier: 0, optional: false,
      layoutId: 'public-calibration', name: '操作校準', x0: 1, z0: 1, w: 12, h: 13 }],
    enemies: [{ kind: 'guard', x: 7, z: 6.5, y: 0, yaw: Math.PI,
      state: 'idle', patrol: [], perched: false, roomKey: 'C' }],
    pickups: [], chests: [], heart: null, stairs: null, resupply: null, traps: [],
    torches: [3.5, 7.5, 11.5].flatMap(z => [
      { x: 1.05, y: 2.5, z, nx: 1, nz: 0 },
      { x: 12.95, y: 2.5, z, nx: -1, nz: 0 },
    ]),
    practice: true, publicPlaytest: 'calibration',
  };
}

/** Keep the authored Core geometry intact and join its sheltered entrance to
 * the guard room. The shared wall is solid except for this ordinary door. */
export function createConnectedPlaytestLevel(): LevelData {
  const core = createTrialLevel('shield-crossfire');
  const calibration = createCalibrationLevel();
  const dz = 23;
  const grid = new Grid(core.grid.w, calibration.grid.h + dz);
  grid.tiles.fill(T.Wall);
  for (let z = 0; z < core.grid.h; z++) for (let x = 0; x < core.grid.w; x++)
    grid.set(x, z, core.grid.get(x, z));
  for (let z = 1; z < calibration.grid.h - 1; z++) for (let x = 1; x < calibration.grid.w - 1; x++)
    grid.set(x, z + dz, calibration.grid.get(x, z));
  for (const pillar of core.grid.pillars) grid.addPillar({ ...pillar });
  for (const x of [6, 7]) grid.set(x, 22, T.Floor);
  grid.addDoor({ id: 0, cells: [[6, 23], [7, 23]], axis: 'x', progress: 0,
    target: 0, barred: false, barSide: 1, arch: false, cx: 7, cz: 23.5 });
  return {
    ...core, seed: 'PUBLIC-CONNECTED-V3', templateName: '相連的試玩地城', grid,
    spawn: { ...calibration.spawn, z: calibration.spawn.z + dz },
    rooms: [...calibration.rooms.map(r => ({ ...r, z0: r.z0 + dz })), ...core.rooms],
    enemies: [...calibration.enemies.map(e => ({ ...e, z: e.z + dz })), ...core.enemies],
    torches: [...calibration.torches.map(t => ({ ...t, z: t.z + dz })), ...core.torches,
      { x: 5.05, y: 2.5, z: 24.1, nx: 0, nz: 1 },
      { x: 8.95, y: 2.5, z: 24.1, nx: 0, nz: 1 }],
    publicPlaytest: 'calibration',
    publicPlaytestConnection: { doorId: 0, coreEntryZ: 23, coreRoomKey: 'T' },
  };
}
