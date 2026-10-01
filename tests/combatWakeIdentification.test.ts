import { T } from '../src/sim/grid';
import { observesPoint } from '../src/sim/observation';
import { updateProjectiles } from '../src/sim/projectileSys';
import { emptyInput } from '../src/sim/types';
import { describe, expect, it } from 'vitest';
import { ENEMIES, NOISE } from '../src/config';
import { becomeAlert, createEnemy, updateEnemies } from '../src/sim/enemySys';
import { addItem, drinkPotion, isKnown, itemName, queueUse, readScroll, shatterPotion } from '../src/sim/items';
import { finishAction, makeWorld, OPEN_ROOM } from './helpers';

function roomWorld() {
  const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 16.5, z: 3.5, state: 'sleep' }]);
  w.level.rooms = [{ key: 'A', role: 'combat', tier: 1, optional: false, layoutId: 'test', name: 'test', x0: 1, z0: 1, w: 18, h: 18 }];
  w.player.invisT = 100;
  return w;
}

describe('audible combat wakes the room, not omniscient aggro', () => {
  it('same-room distant sleeper investigates the impact location without learning the player', () => {
    const w = roomWorld(), e = w.enemies[0]!;
    w.emitNoise(3.5, 1, 3.5, NOISE.combatHit, 'combat');
    expect(e.state).toBe('investigate');
    expect(e.target).toEqual({ x: 3.5, z: 3.5 });
    expect(e.lastKnown).toBeNull();
  });
  it('quiet footsteps do not inherit room-wide combat propagation', () => {
    const w = roomWorld(); w.emitNoise(3.5, .1, 3.5, 4, 'step');
    expect(w.enemies[0]!.state).toBe('sleep');
  });
  it('Sleep itself stays quiet, later real fighting wakes its sleepers', () => {
    const w = roomWorld(), e = w.enemies[0]!;
    w.player.x = 14; w.player.z = 3.5;
    becomeAlert(w, e); readScroll(w, 'sleep');
    expect(e.state).toBe('sleep');
    w.emitNoise(3.5, 1, 3.5, NOISE.combatHit, 'combat');
    expect(e.state).toBe('investigate');
  });
});

describe('identification needs revealing evidence', () => {
  it.each(['invisibility', 'haste', 'healing'] as const)('%s harmless shatter does not reveal identity', (id) => {
    const w = makeWorld(); w.player.known = []; const before = itemName(w, `potion:${id}`);
    shatterPotion(w, id, 9.5, .2, 9.5);
    expect(isKnown(w, `potion:${id}`)).toBe(false);
    expect(itemName(w, `potion:${id}`)).toBe(before);
    expect(w.events.some((e) => e.type === 'identify')).toBe(false);
    expect(w.areas).toHaveLength(0);
  });
  it.each(['fire', 'frost', 'gas'] as const)('%s visible effect identifies, behind the player does not', (id) => {
    const seen = makeWorld(); shatterPotion(seen, id, 9.5, .2, 9.5);
    expect(isKnown(seen, `potion:${id}`)).toBe(true);
    const behind = makeWorld(); shatterPotion(behind, id, 9.5, .2, 18.5);
    expect(isKnown(behind, `potion:${id}`)).toBe(false);
    expect(behind.areas).toHaveLength(1);
  });
});

describe('audibility boundaries and real action sources', () => {
  it('room propagation uses current coordinates, not enemy spawn-room metadata', () => {
    const w = roomWorld(), e = w.enemies[0]!; e.roomKey = 'OTHER';
    w.emitNoise(3.5, 1, 3.5, NOISE.combatHit, 'combat');
    expect(e.state).toBe('investigate');
  });
  it('pillars/low furniture do not suppress same-room fighting', () => {
    const w = roomWorld();
    w.grid.addPillar({ x: 10, z: 3.5, r: .6, h: 4, kind: 'pillar' });
    w.emitNoise(3.5, 1, 3.5, NOISE.combatHit, 'combat');
    expect(w.enemies[0]!.state).toBe('investigate');
  });
  it('solid partitions and closed doors block distant room propagation; opening restores it', () => {
    const w = roomWorld();
    for (let j = 1; j < 19; j++) w.grid.set(10, j, T.Wall);
    w.grid.addDoor({ id: 0, cells: [[10, 3]], axis: 'z', progress: 0, target: 0, barred: false, barSide: 1, arch: false, cx: 10.5, cz: 3.5 });
    w.emitNoise(3.5, 1, 3.5, NOISE.combatHit, 'combat'); expect(w.enemies[0]!.state).toBe('sleep');
    w.grid.doors[0]!.progress = 1;
    w.emitNoise(3.5, 1, 3.5, NOISE.combatHit, 'combat'); expect(w.enemies[0]!.state).toBe('investigate');
  });
  it('outside the source room only original finite radius/occlusion applies', () => {
    const w = roomWorld(); w.level.rooms[0]!.w = 8;
    w.emitNoise(3.5, 1, 3.5, NOISE.combatHit, 'combat'); expect(w.enemies[0]!.state).toBe('sleep');
  });
  it('does not retarget alert actors or emit a new shout cascade', () => {
    const w = roomWorld(), e = w.enemies[0]!; e.state = 'alert'; e.phase = 'windup'; e.lastKnown = { x: 2, z: 2 };
    w.drainEvents(); w.emitNoise(3.5, 1, 3.5, NOISE.combatHit, 'combat');
    expect(e.phase).toBe('windup'); expect(e.lastKnown).toEqual({ x: 2, z: 2 });
    expect(w.events.filter((v) => v.type === 'noise')).toHaveLength(1);
  });
  it.each(['guard', 'archer', 'charger'] as const)('%s real committed attack wakes distant sleeper even if it misses', (kind) => {
    const w = roomWorld(); const sleeper = w.enemies[0]!;
    const attacker = createEnemy(w, { kind, x: 3.5, y: 0, z: 3.5, yaw: Math.PI, state: 'idle', patrol: [], perched: false, roomKey: 'A' });
    w.enemies.push(attacker); attacker.state = 'alert'; attacker.seesPlayer = true;
    attacker.phase = kind === 'archer' ? 'aim' : 'windup'; attacker.locked = true; attacker.lockedYaw = Math.PI;
    attacker.phaseT = kind === 'archer' ? ENEMIES.archer.aim - .001 : kind === 'guard' ? ENEMIES.guard.windup - .001 : ENEMIES.charger.windup - .001;
    attacker.aimPoint = { x: 3.5, y: 1.2, z: 8 };
    updateEnemies(w, .01);
    expect(sleeper.state).toBe('investigate'); expect(sleeper.lastKnown).toBeNull();
    expect(w.events.filter((v) => v.type === 'noise' && v.source === 'combat' && v.id === attacker.id)).toHaveLength(1);
  });
  it('ordinary melee actually hitting a target wakes another sleeper', () => {
    const w = roomWorld(); w.player.x = 3.5; w.player.z = 6;
    const target = createEnemy(w, { kind: 'guard', x: 3.5, y: 0, z: 4.5, yaw: 0, state: 'sleep', patrol: [], perched: false, roomKey: 'A' });
    w.enemies.push(target); w.frame(1 / 60, { ...emptyInput(), fire: true, firePressed: true }); finishAction(w);
    expect(target.hp).toBeLessThan(target.maxHp); expect(w.enemies[0]!.state).not.toBe('sleep');
  });
  it('hostile bolt impact near player is audible even after its distant launch', () => {
    const w = roomWorld(); w.player.x = 3.5; w.player.z = 8;
    const pos = { x: 3.5, y: 1.2, z: 6 };
    w.projectiles.push({ id: w.nextId++, kind: 'bolt', owner: 999, pos, vel: { x: 0, y: 0, z: 18 }, radius: .03, gravity: 0, age: 0, alive: true, hitSet: new Set(), next: { ...pos }, avgVel: { x: 0, y: 0, z: 18 }, deflected: false, tip: null, payload: 'smoke' });
    updateProjectiles(w, .2); expect(w.player.hp).toBeLessThan(w.player.maxHp); expect(w.enemies[0]!.state).toBe('investigate');
  });
});

describe('observed effect and throw pipeline edges', () => {
  it('wall and smoke-hidden effects stay unidentified while still existing physically', () => {
    for (const smoke of [false, true]) {
      const w = makeWorld();
      if (smoke) w.smokes.push({ id: w.nextId++, x: 9.5, y: 1, z: 11, radius: 2, age: 1, air: false });
      else for (let i = 1; i < 19; i++) w.grid.set(i, 11, T.Wall);
      shatterPotion(w, 'fire', 9.5, .2, 9.5);
      expect(isKnown(w, 'potion:fire')).toBe(false); expect(w.areas).toHaveLength(1);
    }
  });
  it('already-known harmless bottles stay known; drinking still identifies unknown bottles', () => {
    const w = makeWorld(); shatterPotion(w, 'healing', 9.5, .2, 9.5); expect(isKnown(w, 'potion:healing')).toBe(true);
    for (const id of ['invisibility', 'haste', 'healing'] as const) { w.player.known = []; drinkPotion(w, id); expect(isKnown(w, `potion:${id}`)).toBe(true); }
  });
  it.each(['invisibility', 'haste', 'healing'] as const)('%s real throw consumes normally without learning/buff/healing', (id) => {
    const w = makeWorld(); w.player.known = []; w.player.hp = 2;
    addItem(w, `potion:${id}`); queueUse(w, 0, 'throw');
    for (let i = 0; i < 1800 && !w.events.some((e) => e.type === 'shatter'); i++) w.frame(1 / 60, { ...emptyInput(), wait: true });
    expect(w.player.items).toHaveLength(0); expect(w.events.some((e) => e.type === 'shatter')).toBe(true);
    expect(isKnown(w, `potion:${id}`)).toBe(false); expect(w.player.hp).toBe(2);
    expect(w.player.invisT).toBe(0); expect(w.player.hasteT).toBe(0); expect(w.areas).toHaveLength(0);
    expect(w.events.filter((e) => e.type === 'shatter').every((e) => e.kind === undefined)).toBe(true);
  });
  it('camera view uses pitch and viewport shape, not omnidirectional LOS', () => {
    const w = makeWorld(); w.viewAspect = .5;
    expect(observesPoint(w, { x: 14, y: 1.6, z: 10 })).toBe(false);
    w.viewAspect = 2; expect(observesPoint(w, { x: 14, y: 1.6, z: 10 })).toBe(true);
    w.player.pitch = 1; expect(observesPoint(w, { x: 9.5, y: .1, z: 10 })).toBe(false);
  });
});

describe('impact geometry regressions', () => {
  it.each([-1, 1])('wall bolt impact carries into its own room for direction %s', (dir) => {
    const w = roomWorld(), e = w.enemies[0]!; e.x = 9.5; e.z = 3.5;
    const pos = { x: dir > 0 ? 17 : 3, y: 1.2, z: 10.5 }, vel = { x: dir * 18, y: 0, z: 0 };
    w.projectiles.push({ id: w.nextId++, kind: 'bolt', owner: 999, pos, vel, radius: .03, gravity: 0, age: 0, alive: true, hitSet: new Set(), next: { ...pos }, avgVel: vel, deflected: false, tip: null, payload: 'smoke' });
    updateProjectiles(w, .3); expect(e.state).toBe('investigate');
  });
  it('visible high airburst shards without a visible colored ground effect cannot identify', () => {
    const w = makeWorld(); w.player.pitch = Math.atan2(2.4, 2);
    expect(observesPoint(w, { x: 9.5, y: 4, z: 12.5 })).toBe(true);
    expect(observesPoint(w, { x: 9.5, y: .4, z: 12.5 })).toBe(false);
    shatterPotion(w, 'gas', 9.5, 4, 12.5);
    expect(isKnown(w, 'potion:gas')).toBe(false); expect(w.areas).toHaveLength(1);
  });
});
