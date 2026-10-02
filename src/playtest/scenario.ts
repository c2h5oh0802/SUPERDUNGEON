import type { LevelData } from '../gen/generator';
import { createTrialLevel } from '../gen/practiceTrials';
import { Grid, T } from '../sim/grid';
import { World } from '../sim/world';

export const PUBLIC_BUILD_ID = 'PublicCalibrationOpenV2' as const;
export type PlaytestStage = 'calibration' | 'core';

/** Disposable authored fixtures. No RunState, campaign save, carry, or trial kit. */
export function createPublicPlaytestWorld(stage: PlaytestStage): World {
  const level = stage === 'calibration' ? createCalibrationLevel() : createTrialLevel('shield-crossfire');
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
