import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { createTrialLevel } from '../src/gen/practiceTrials';
import { CalibrationObserver } from '../src/playtest/calibration';
import { createPublicPlaytestWorld } from '../src/playtest/scenario';
import { raiseAlarm } from '../src/sim/enemySys';
import { T } from '../src/sim/grid';
import { isKnown, queueUse } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { findInteractTarget } from '../src/sim/playerSys';
import { setDoor } from '../src/sim/propSys';
import { emptyInput, type FrameInput, type GameEvent } from '../src/sim/types';

const DT = 1 / 60;
/** Native inputs drive all travel, combat, pickup, drinking and door animation.
 * Explicit damage below only isolates the authoritative lethal boundary. */
function driver() {
  const world = createPublicPlaytestWorld('calibration');
  const observer = new CalibrationObserver();
  const events: GameEvent[] = [];
  const frame = (partial: Partial<FrameInput> = {}) => {
    const input = { ...emptyInput(world.player.yaw, world.player.pitch), ...partial };
    const before = observer.beforeFrame(world);
    world.frame(DT, input);
    const emitted = world.drainEvents();
    events.push(...emitted);
    observer.observeFrame(world, input, before, emitted);
  };
  const walk = (x: number, z: number) => {
    for (let f = 0; f < 900 && Math.hypot(world.player.x - x, world.player.z - z) > .12; f++)
      frame({ yaw: yawFromDir(x - world.player.x, z - world.player.z), moveZ: 1 });
    expect(Math.hypot(world.player.x - x, world.player.z - z)).toBeLessThan(.13);
  };
  return { world, observer, frame, walk, events };
}
type Driver = ReturnType<typeof driver>;

function finishCalibration(d: Driver, drink = true) {
  const w = d.world, guard = w.enemies[0]!;
  for (let f = 0; f < 3000 && guard.alive; f++) {
    const p = w.player;
    d.frame({ yaw: yawFromDir(guard.x - p.x, guard.z - p.z),
      moveZ: Math.hypot(guard.x - p.x, guard.z - p.z) > 1.7 ? 1 : 0,
      fire: true, firePressed: f === 0 });
  }
  expect(guard.alive).toBe(false);
  for (let f = 0; f < 180 && !w.pickups.some(p => p.item === 'potion:healing'); f++) d.frame();
  const bottle = w.pickups.find(p => p.item === 'potion:healing')!;
  expect(bottle).toBeDefined();
  for (let f = 0; f < 300 && !bottle.taken; f++)
    d.frame({ yaw: yawFromDir(bottle.x - w.player.x, bottle.z - w.player.z), moveZ: 1 });
  expect(bottle.taken).toBe(true);
  if (drink) d.frame({ potion: true });
  else { queueUse(w, 0, 'throw'); d.frame(); }
  for (let f = 0; f < 180 && !d.observer.state.complete; f++) d.frame();
  expect(d.observer.state.complete).toBe(true);
  expect(w.publicPlaytestDoorReady).toBe(true);
  expect(w.publicPlaytestPhase).toBe('calibration');
}
function approachDoor(d: Driver) {
  const c = d.world.level.publicPlaytestConnection!;
  const door = d.world.grid.doors[c.doorId]!;
  d.walk(door.cx, door.cz + 1.3);
  d.frame({ yaw: 0 });
  return door;
}
function crossDoor(d: Driver) {
  for (let f = 0; f < 600 && d.world.publicPlaytestPhase !== 'core'; f++) d.frame({ yaw: 0, moveZ: 1 });
  expect(d.world.publicPlaytestPhase).toBe('core');
  expect(d.world.player.z).toBeLessThanOrEqual(d.world.level.publicPlaytestConnection!.coreEntryZ);
}

function coreEnemies(d: Driver) {
  return d.world.enemies.filter(enemy => enemy.roomKey === 'T');
}

describe('same-floor public playtest connection', () => {
  it('joins the original calibration room to untouched shield-crossfire geometry through one formal door', () => {
    const w = createPublicPlaytestWorld('calibration'), core = createTrialLevel('shield-crossfire');
    expect(w.level.publicPlaytestConnection).toEqual({ doorId: 0, coreEntryZ: 23, coreRoomKey: 'T' });
    expect(w.level.spawn).toEqual({ x: 7, z: 32.5, yaw: 0 });
    expect(w.level.enemies.filter(enemy => enemy.roomKey === 'T')).toEqual(core.enemies);
    expect(w.grid.pillars).toEqual(core.grid.pillars);
    expect(w.enemies.filter(enemy => enemy.roomKey === 'T').map(enemy => enemy.patrol))
      .toEqual(createPublicPlaytestWorld('core').enemies.map(enemy => enemy.patrol));
    for (let z = 0; z < core.grid.h; z++) for (let x = 0; x < core.grid.w; x++) {
      if ((x === 6 || x === 7) && (z === 22 || z === 23)) continue;
      expect(w.grid.get(x, z), `core cell ${x},${z}`).toBe(core.grid.get(x, z));
    }
    for (let z = 24; z <= 36; z++) for (let x = 1; x <= 12; x++) expect(w.grid.get(x, z)).toBe(T.Floor);
    expect(w.grid.doors).toHaveLength(1);
    expect(w.grid.doors[0]).toMatchObject({ cells: [[6, 23], [7, 23]], arch: false, progress: 0, target: 0 });
    expect(w.grid.circleBlocked(7, 23.5, PLAYER.radius)).toBe(true);
  });

  it('blocks early walking and both player/enemy open attempts with a factual gate hint', () => {
    const d = driver(), untouched = structuredClone(coreEnemies(d));
    // Go around the live guard rather than relying on teleportation or disabling AI.
    d.walk(10, 27);
    const door = approachDoor(d);
    expect(findInteractTarget(d.world)).toMatchObject({ enabled: false, label: expect.stringContaining('盾衛') });
    d.frame({ interact: true });
    expect(d.events.some(event => event.type === 'barred' && event.text?.includes('盾衛'))).toBe(true);
    expect(setDoor(d.world, door.id, true, 'enemy')).toBe(false);
    expect(setDoor(d.world, door.id, true, 'player')).toBe(false);
    for (let f = 0; f < 180; f++) d.frame({ yaw: 0, moveZ: 1 });
    expect(door.target).toBe(0); expect(door.progress).toBe(0);
    expect(d.world.player.z).toBeGreaterThanOrEqual(24 + PLAYER.radius - .001);
    expect(d.world.publicPlaytestPhase).toBe('calibration');
    expect(d.world.publicPlaytestCoreStart).toBeNull();
    expect(coreEnemies(d)).toEqual(untouched);
    expect(d.world.player.dead).toBe(false);
  });

  it('keeps global calibration alarms from awakening or rewriting the dormant core enemies', () => {
    const d = driver(), untouched = structuredClone(coreEnemies(d));
    raiseAlarm(d.world);
    expect(d.world.alarm).toBe(true);
    expect(coreEnemies(d)).toEqual(untouched);
    for (let f = 0; f < 60 * 10; f++) d.frame({ wait: true });
    expect(d.world.publicPlaytestPhase).toBe('calibration');
    expect(coreEnemies(d)).toEqual(untouched);
    expect(d.world.player.dead).toBe(false);
  });

  it('preserves player, HP, resources and unknown identity across a late native door crossing', () => {
    const d = driver(), w = d.world, player = w.player, untouched = structuredClone(coreEnemies(d));
    finishCalibration(d);
    const hp = player.hp, items = structuredClone(player.items), known = [...player.known];
    const door = approachDoor(d);
    expect(findInteractTarget(w)).toMatchObject({ enabled: true, label: 'E 開門' });
    d.frame({ interact: true });
    expect(player.action?.kind).toBe('door');
    expect(door.target).toBe(1);
    expect(door.progress).toBeLessThan(1);
    expect(w.grid.circleBlocked(door.cx, door.cz, PLAYER.radius)).toBe(true);
    for (let f = 0; f < 60 * 40; f++) d.frame({ wait: true });
    expect(door.progress).toBe(1);
    expect(w.publicPlaytestPhase).toBe('calibration');
    expect(w.publicPlaytestCoreStart).toBeNull();
    expect(coreEnemies(d)).toEqual(untouched);
    const entryDamage = Object.values(w.stats.damageTaken).reduce((a, b) => a + b, 0);
    const entryKills = w.stats.kills, beforeEntry = w.realTime;
    crossDoor(d);
    expect(w.player).toBe(player);
    expect(player.hp).toBe(hp); expect(player.items).toEqual(items); expect(player.known).toEqual(known);
    expect(isKnown(w, 'potion:haste')).toBe(false);
    expect(w.level.publicPlaytest).toBe('calibration');
    expect(w.publicPlaytestCoreStart).toEqual({ realTime: w.realTime, damage: entryDamage, kills: entryKills });
    expect(w.publicPlaytestCoreStart!.realTime).toBeGreaterThan(beforeEntry);
    expect(w.stats.kills).toBe(1);
    expect(w.outcome).toBe('none');
  });

  it('allows a spent healing lesson bottle to unlock the same gate without invented healing', () => {
    const d = driver(); finishCalibration(d, false);
    expect(d.observer.state.healingSkipped).toBe(true);
    expect(d.world.stats.healingUsed).toBe(0);
    const hp = d.world.player.hp;
    const door = approachDoor(d);
    d.frame({ interact: true }); crossDoor(d);
    expect(door.progress).toBe(1);
    expect(d.world.player.hp).toBe(hp);
    expect(d.world.player.items).toEqual([{ id: 'potion:haste', count: 1, level: 0 }]);
  });

  it('retains optional unknown use and never restores lethal protection by backtracking', () => {
    const d = driver(), w = d.world; finishCalibration(d);
    queueUse(w, w.player.items.findIndex(item => item.id === 'potion:haste'), 'use');
    d.frame();
    for (let f = 0; f < 180 && w.player.action; f++) d.frame();
    expect(isKnown(w, 'potion:haste')).toBe(true);
    expect(w.player.items).toEqual([]);
    const door = approachDoor(d); d.frame({ interact: true }); crossDoor(d);
    const snapshot = w.publicPlaytestCoreStart;
    d.walk(door.cx, door.cz + 1.3);
    expect(w.player.z).toBeGreaterThan(24);
    expect(w.publicPlaytestPhase).toBe('core');
    expect(w.publicPlaytestCoreStart).toBe(snapshot);
    expect(w.player.items).toEqual([]);
    expect(isKnown(w, 'potion:haste')).toBe(true);
    w.damagePlayer(999, 'core backtrack', w.player.x + 1, w.player.z);
    expect(w.player.hp).toBe(0); expect(w.player.dead).toBe(true);
    expect(w.outcome).toBe('dead'); expect(w.deathCause).toBe('core backtrack');
  });

  it('activates the native core encounter after crossing and permits an ordinary-input clear', () => {
    const d = driver(), w = d.world; finishCalibration(d);
    approachDoor(d); d.frame({ interact: true }); crossDoor(d);
    const nav = new Nav(w.grid, PLAYER.radius);
    const starts = coreEnemies(d).map(enemy => ({ x: enemy.x, z: enemy.z }));
    // State-informed deterministic reachability, not evidence of human fun.
    for (let f = 0; f < 60 * 60 && !w.player.dead && coreEnemies(d).some(enemy => enemy.alive); f++) {
      const p = w.player;
      const enemy = coreEnemies(d).filter(target => target.alive).sort((a, b) =>
        Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]!;
      const gap = Math.hypot(enemy.x - p.x, enemy.z - p.z);
      const yaw = yawFromDir(enemy.x - p.x, enemy.z - p.z), input = emptyInput(yaw);
      const waypoint = nav.findPath(p.x, p.z, enemy.x, enemy.z)?.find(point =>
        Math.hypot(point.x - p.x, point.z - p.z) > .12);
      if (waypoint && gap > 1.65) {
        const dx = waypoint.x - p.x, dz = waypoint.z - p.z, length = Math.hypot(dx, dz);
        input.moveX = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length;
        input.moveZ = (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / length;
      }
      if (!p.action && gap <= 2.3) { input.fire = true; input.firePressed = true; }
      d.frame(input);
    }
    expect(w.player.dead).toBe(false);
    expect(coreEnemies(d).every(enemy => !enemy.alive)).toBe(true);
    expect(coreEnemies(d).map(enemy => ({ x: enemy.x, z: enemy.z }))).not.toEqual(starts);
    expect(d.events.some(event => event.type === 'enemyWindup' && event.kind === 'archer')).toBe(true);
    expect(w.stats.kills).toBe(3);
    expect(w.stats.kills - w.publicPlaytestCoreStart!.kills).toBe(2);
    expect(w.player.items).toEqual([{ id: 'potion:haste', count: 1, level: 0 }]);
    expect(w.player.hunger).toBe(0);
  });

  it('keeps retry as a clean canonical standalone core fixture', () => {
    const connected = driver(); finishCalibration(connected);
    approachDoor(connected); connected.frame({ interact: true }); crossDoor(connected);
    const fresh = createPublicPlaytestWorld('core'), reference = createPublicPlaytestWorld('core');
    expect(fresh.level.publicPlaytestConnection).toBeUndefined();
    expect(fresh.publicPlaytestPhase).toBe('core');
    expect(fresh.grid.doors).toEqual([]);
    expect(fresh.player).toEqual(reference.player);
    expect(fresh.enemies).toEqual(reference.enemies);
    expect(fresh.level.spawn).toEqual(createTrialLevel('shield-crossfire').spawn);
    expect(fresh.player.hp).toBe(fresh.player.maxHp); expect(fresh.player.items).toEqual([]);
    expect(fresh.stats.kills).toBe(0); expect(fresh.stats.damageTaken).toEqual({});
    expect(fresh.realTime).toBe(0); expect(fresh.time).toBe(0);
  });
});
