import { describe, expect, it } from 'vitest';
import { ENEMIES, HUNGER, ITEM_FX, PROJECTILES, TRAP } from '../src/config';
import { createBossTestWorld } from '../src/dev/bossTest';
import { PRACTICE_TRIALS } from '../src/gen/practiceTrials';
import { generateLevel } from '../src/gen/validate';
import { createPublicPlaytestWorld } from '../src/playtest/scenario';
import { updateHunger } from '../src/sim/hunger';
import { shatterPotion, updateAreas } from '../src/sim/items';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { updateProjectiles } from '../src/sim/projectileSys';
import { updateTraps } from '../src/sim/propSys';
import { createFloorWorld, newRun, parseRun, serializeRun } from '../src/sim/run';
import type { Projectile } from '../src/sim/types';
import { World } from '../src/sim/world';
import { makeWorld, OPEN_ROOM, run, testLevel } from './helpers';

function expectAlive(world: World): void {
  expect(world.player.hp).toBe(1);
  expect(world.player.dead).toBe(false);
  expect(world.outcome).toBe('none');
  expect(world.deathCause).toBeNull();
  expect(world.events.some(event => event.type === 'death')).toBe(false);
}

describe('PublicCalibration authoritative lethal protection', () => {
  it('applies ordinary nonlethal damage and clamps a lethal hit before death', () => {
    const world = createPublicPlaytestWorld('calibration');
    const hp = world.player.hp;
    world.damagePlayer(3, 'guard', 4, 5);
    expect(world.player.hp).toBe(hp - 3);
    expect(world.events).toEqual([{ type: 'playerHurt', amount: 3,
      attemptedAmount: 3, actualAmount: 3, source: 'guard', x: 4, z: 5 }]);
    world.drainEvents();

    world.damagePlayer(99, 'guard', 4, 5);
    expectAlive(world);
    expect(world.stats.damageTaken.guard).toBe(hp - 1);
    expect(world.events).toEqual([{ type: 'playerHurt', amount: hp - 4,
      attemptedAmount: 99, actualAmount: hp - 4, source: 'guard', x: 4, z: 5 }]);
  });

  it('keeps every repeated hit at 1 HP observable with honest zero HP loss', () => {
    const world = createPublicPlaytestWorld('calibration');
    world.player.hp = 1;
    for (const source of ['guard', 'bolt', 'trap', 'fire', 'hunger']) {
      world.damagePlayer(3, source, 2, 6);
      expectAlive(world);
    }
    expect(world.events).toHaveLength(5);
    expect(world.events.every(event => event.type === 'playerHurt' &&
      event.attemptedAmount === 3 && event.actualAmount === 0 && event.amount === 0)).toBe(true);
    expect(Object.values(world.stats.damageTaken)).toEqual([0, 0, 0, 0, 0]);
    expect(world.stats.healingRestored).toBe(0);
    expect(world.stats.healingUsed).toBe(0);
  });

  it('retains armor reduction and minimum attempted damage before the floor', () => {
    const world = createPublicPlaytestWorld('calibration');
    world.player.armor = { id: 'mail', level: 1 };
    world.player.hp = 6;
    world.damagePlayer(6, 'armored hit', 0, 0);
    expect(world.player.hp).toBe(3);
    expect(world.events.at(-1)).toMatchObject({ amount: 3, attemptedAmount: 3, actualAmount: 3 });
    world.damagePlayer(1, 'small hit', 0, 0);
    expect(world.player.hp).toBe(2);
    world.damagePlayer(1, 'small hit', 0, 0);
    world.damagePlayer(1, 'small hit', 0, 0);
    expectAlive(world);
    expect(world.events.at(-1)).toMatchObject({ amount: 0, attemptedAmount: 1, actualAmount: 0 });
    expect(world.stats.damageTaken).toEqual({ 'armored hit': 3, 'small hit': 2 });
  });

  it('keeps real guard attacks and world time running after reaching 1 HP', () => {
    // The scope is the production scenario discriminator; an isolated combat
    // fixture makes this regression independent of calibration layout changes.
    const level = testLevel(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 12.5, yaw: Math.PI }]);
    level.publicPlaytest = 'calibration';
    const world = new World(level);
    world.player.hp = 2;
    run(world, 60 * 30, { wait: true });
    expectAlive(world);
    const hits = world.events.filter(event => event.type === 'playerHurt');
    expect(hits.length).toBeGreaterThan(3);
    expect(hits[0]).toMatchObject({ amount: 1, actualAmount: 1, attemptedAmount: ENEMIES.guard.damage });
    expect(hits.slice(1).every(event => event.amount === 0 && event.actualAmount === 0)).toBe(true);
    expect(world.stats.damageTaken['盾衛的劍']).toBe(1);
    expect(world.time).toBeCloseTo(30, 5);
  });

  it('covers hostile bolt, trap, fire and starvation callers at the same boundary', () => {
    const world = makeWorld();
    world.level.publicPlaytest = 'calibration';
    world.player.hp = 1;
    const { x, z } = world.player;
    const pos = { x, y: 1.2, z: z - 2 };
    const vel = { x: 0, y: 0, z: 18 };
    const bolt: Projectile = { id: world.nextId++, kind: 'bolt', owner: 999,
      pos, vel, radius: PROJECTILES.bolt.radius, gravity: 0, age: 0, alive: true,
      hitSet: new Set(), next: { ...pos }, avgVel: { ...vel }, deflected: false, tip: null, payload: 'smoke' };
    world.projectiles.push(bolt);
    updateProjectiles(world, .2);
    expect(bolt.alive).toBe(false);

    world.traps.push({ id: 1, i: Math.floor(x), j: Math.floor(z), state: 'spikes', t: 0, hitSet: new Set() });
    updateTraps(world, .01);
    shatterPotion(world, 'fire', x, .1, z);
    updateAreas(world, ITEM_FX.area.fire.tick, () => {});
    // Public worlds pause automatic hunger; an explicit system call verifies
    // that this damage route cannot bypass the authoritative protection either.
    world.player.hunger = HUNGER.starvingAt;
    updateHunger(world, HUNGER.damageEvery);

    expectAlive(world);
    expect(world.events.filter(event => event.type === 'playerHurt')).toEqual([
      expect.objectContaining({ source: '弩手的弩矢', attemptedAmount: PROJECTILES.bolt.damage, actualAmount: 0 }),
      expect.objectContaining({ source: '尖刺踏板', attemptedAmount: TRAP.damage, actualAmount: 0 }),
      expect.objectContaining({ source: '火焰', attemptedAmount: ITEM_FX.area.fire.damage, actualAmount: 0 }),
      expect.objectContaining({ source: '飢餓', attemptedAmount: 1, actualAmount: 0 }),
    ]);
  });
});

describe('lethal protection scenario isolation', () => {
  const unprotected: Array<{ name: string; create: () => World }> = [
    { name: 'campaign', create: () => createFloorWorld(newRun('PROTECTION-CAMPAIGN', 'warrior')) },
    { name: 'ordinary Practice', create: () => new World(generateLevel('PRACTICE', { practice: true })) },
    ...PRACTICE_TRIALS.map(trial => ({ name: `fixed trial ${trial.id}`, create: () => createTrialWorld(trial.id, 'warrior') })),
    { name: 'Boss test starting', create: () => createBossTestWorld('warrior', 'starting') },
    { name: 'Boss test split', create: () => createBossTestWorld('huntress', 'split') },
    { name: 'developer/simulation fixture', create: () => makeWorld() },
    { name: 'public core', create: () => createPublicPlaytestWorld('core') },
  ];

  it.each(unprotected)('preserves the normal death path in $name', ({ create }) => {
    const world = create();
    world.player.hp = 2;
    world.drainEvents();
    const attemptedAmount = Math.max(1, 99 - world.armorReduce());
    world.damagePlayer(99, 'lethal hit', 2, 3);
    expect(world.player.hp).toBe(0);
    expect(world.player.dead).toBe(true);
    expect(world.outcome).toBe('dead');
    expect(world.deathCause).toBe('lethal hit');
    expect(world.events).toEqual([
      { type: 'playerHurt', amount: attemptedAmount, attemptedAmount, actualAmount: 2, source: 'lethal hit', x: 2, z: 3 },
      { type: 'death', source: 'lethal hit' },
    ]);
    expect(world.stats.damageTaken['lethal hit']).toBe(attemptedAmount);
    world.damagePlayer(99, 'after death', 2, 3);
    expect(world.events).toHaveLength(2);
    expect(world.stats.damageTaken['after death']).toBeUndefined();
  });

  it('does not transfer protection via player carry, saves, or world replacement', () => {
    const calibration = createPublicPlaytestWorld('calibration');
    calibration.damagePlayer(99, 'calibration', 0, 0);
    expectAlive(calibration);
    const carry = calibration.carry();
    const campaignRun = newRun('PROTECTION-CARRY', 'warrior');
    campaignRun.carry = carry;
    const restored = parseRun(serializeRun(campaignRun));
    expect(restored).not.toBeNull();
    const worlds = [
      new World(testLevel(OPEN_ROOM), { carry }),
      createFloorWorld(restored!),
      createPublicPlaytestWorld('core'),
      createFloorWorld(newRun('PROTECTION-NEW', 'warrior')),
    ];
    for (const world of worlds) {
      expect(world.level.publicPlaytest).not.toBe('calibration');
      world.damagePlayer(99, 'replacement', 0, 0);
      expect(world.player.dead).toBe(true);
      expect(world.outcome).toBe('dead');
    }
    // Re-entering calibration reconstructs the scenario rather than inheriting
    // damage, death or a persistent player invincibility flag.
    const fresh = createPublicPlaytestWorld('calibration');
    expect(fresh.player.hp).toBe(Math.ceil(fresh.player.maxHp / 2));
    expect(fresh.stats.damageTaken).toEqual({});
    expect(fresh.player.dead).toBe(false);
    expect(calibration.player.hp).toBe(1);
  });
});
