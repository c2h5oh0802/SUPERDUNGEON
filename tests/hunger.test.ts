import { describe, expect, it } from 'vitest';
import { ACTIONS, HUNGER, ITEM_FX, PLAYER, PROJECTILES, STEALTH, TIME } from '../src/config';
import { generateLevel } from '../src/gen/validate';
import { yawFromDir } from '../src/core/math';
import { World } from '../src/sim/world';
import { hungerState, updateHunger } from '../src/sim/hunger';
import { addItem, itemColor, itemDesc, itemName, isKnown, queueUse, stunPlayer } from '../src/sim/items';
import { updatePickups } from '../src/sim/propSys';
import { updateProjectiles } from '../src/sim/projectileSys';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput, type Projectile } from '../src/sim/types';
import { finishAction, makeWorld, run } from './helpers';

const dt = 1 / 60;

describe('Hunger uses only actual world time', () => {
  it('idle thinking, movement, wait and actions use the unchanged world clock', () => {
    const idle = makeWorld(); run(idle, 600);
    expect(idle.player.hunger).toBeCloseTo(10 * TIME.idleRate, 8);
    const moving = makeWorld(); run(moving, 60, { moveZ: 1 });
    expect(moving.player.hunger).toBeCloseTo(moving.time, 10);
    expect(moving.player.hunger).toBeGreaterThan(idle.player.hunger * .9);
    const wait = makeWorld(); run(wait, 600, { wait: true });
    expect(wait.player.hunger).toBeCloseTo(10, 8);
    const action = makeWorld(); action.frame(dt, { ...emptyInput(), fire: true }); finishAction(action);
    expect(action.player.hunger).toBeCloseTo(action.lastAction!.spent, 8);
    const thrown = makeWorld(); thrown.frame(dt, { ...emptyInput(), bottle: true }); finishAction(thrown);
    expect(thrown.player.hunger).toBeCloseTo(ACTIONS.bottle.windup + ACTIONS.bottle.recovery, 8);
    const door = makeWorld(['########', '#..D...#', '#..@...#', '#......#', '########']);
    door.frame(dt, { ...emptyInput(), interact: true }); finishAction(door);
    expect(door.lastAction?.kind).toBe('door');
    expect(door.player.hunger).toBeCloseTo(door.time, 10);
    expect(door.player.hunger).toBeGreaterThanOrEqual(ACTIONS.door.recovery);
  });

  it('same actual distance costs more world time under Shift, with no extra Hunger multiplier', () => {
    const walk = (sneak: boolean) => {
      const w = makeWorld(); const origin = w.player.z; const distance = 9;
      for (let k = 0; k < 2000; k++) {
        const remaining = distance - (origin - w.player.z);
        if (remaining < 1e-9) break;
        w.frame(Math.min(dt, remaining / (PLAYER.moveSpeed * (sneak ? w.sneakSpeedMul() : 1))), { ...emptyInput(), moveZ: 1, sneak });
      }
      expect(origin - w.player.z).toBeCloseTo(distance, 8);
      expect(w.player.hunger).toBeCloseTo(w.time, 10);
      return w;
    };
    const normal = walk(false), quiet = walk(true);
    expect(quiet.time / normal.time).toBeCloseTo(STEALTH.sneakTimeMul, 8);
    expect(quiet.player.hunger / normal.player.hunger).toBeCloseTo(quiet.time / normal.time, 10);
    expect(normal.events.some((e) => e.type === 'noise' && e.source === 'step')).toBe(true);
    expect(quiet.events.some((e) => e.type === 'noise' && e.source === 'step')).toBe(false);
  });

  it.each(['talent', 'upgrade'] as const)('%s choice freezes hunger and its damage remainder', (screen) => {
    const w = makeWorld(); w.player.hunger = HUNGER.starvingAt; w.player.starvationT = 4;
    w.pendingChoice = screen === 'talent' ? { kind: 'talent', options: ['combo'] } : { kind: 'upgrade', options: ['weapon'] };
    run(w, 600, { wait: true });
    expect(w.time).toBe(0); expect(w.player.hunger).toBe(HUNGER.starvingAt); expect(w.player.starvationT).toBe(4);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('a choice raised mid-frame consumes only executed substeps, not the planned remainder', () => {
    const w = makeWorld(); addItem(w, 'scroll:upgrade'); queueUse(w, 0, 'use');
    w.frame(.1, emptyInput());
    w.player.action!.t = ACTIONS.read.recovery - TIME.maxSubstep;
    const before = w.time, h = w.player.hunger;
    w.frame(.1, { ...emptyInput(), wait: true });
    expect(w.pendingChoice).not.toBeNull();
    expect(w.time - before).toBeCloseTo(TIME.maxSubstep, 8);
    expect(w.player.hunger - h).toBeCloseTo(w.time - before, 10);
  });

  it('background/lag frames remain clamped; invalid deltas add nothing', () => {
    const w = makeWorld();
    w.player.hunger = HUNGER.starvingAt; w.player.starvationT = 1;
    for (const delta of [NaN, Infinity, -1, 0]) w.frame(delta, { ...emptyInput(), wait: true });
    expect(w.player.starvationT).toBe(1);
    w.frame(3600, { ...emptyInput(), wait: true });
    expect(w.time).toBeCloseTo(TIME.maxRealDt, 10);
    expect(w.player.starvationT).toBeCloseTo(1 + TIME.maxRealDt, 10);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });
});

describe('Hunger thresholds and deterministic damage', () => {
  it('normal/hungry are derived warnings only, with one event at each crossing', () => {
    const w = makeWorld(); w.player.hunger = HUNGER.hungryAt - .01;
    updateHunger(w, .02); expect(hungerState(w.player.hunger)).toBe('hungry');
    expect(w.player.hp).toBe(PLAYER.maxHp);
    updateHunger(w, 1); updateHunger(w, 1);
    expect(w.events.filter((e) => e.type === 'hungerState')).toHaveLength(1);
    w.player.hunger = HUNGER.starvingAt - .01;
    updateHunger(w, .02); expect(hungerState(w.player.hunger)).toBe('starving');
    expect(w.player.starvationT).toBeCloseTo(.01, 8);
    expect(w.events.filter((e) => e.type === 'hungerState')).toHaveLength(2);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('Hungry does not change movement, attacks, footsteps or perception inputs', () => {
    const a = makeWorld(), b = makeWorld(); b.player.hunger = HUNGER.hungryAt;
    run(a, 60, { moveZ: 1, fire: true }); run(b, 60, { moveZ: 1, fire: true });
    expect([b.player.x, b.player.z, b.player.hp, b.player.invisT, b.time]).toEqual([a.player.x, a.player.z, a.player.hp, a.player.invisT, a.time]);
    expect(b.events).toEqual(a.events);
  });

  it('Hungry leaves actual enemy detection and attack simulation identical', () => {
    const enemies = [{ kind: 'guard' as const, x: 9.5, z: 7.5, yaw: Math.PI, state: 'idle' as const }];
    const a = makeWorld(undefined, enemies), b = makeWorld(undefined, enemies);
    b.player.hunger = HUNGER.hungryAt;
    run(a, 120); run(b, 120);
    expect(b.enemies).toEqual(a.enemies);
    expect(b.projectiles).toEqual(a.projectiles);
    expect(b.events).toEqual(a.events);
    expect(b.player.hp).toBe(a.player.hp);
  });

  it('1 HP per world interval, invariant to frame size and real-time thinking rate', () => {
    const modes = [{ frames: 1200, delta: 1 / 60, wait: true }, { frames: 400, delta: .05, wait: true }, { frames: 12000, delta: 1 / 60, wait: false }];
    const results = modes.map(({ frames, delta, wait }) => {
      const w = makeWorld(); w.player.armor.id = 'mail'; w.player.hunger = HUNGER.starvingAt;
      run(w, frames, { wait }, delta);
      expect(w.player.hp).toBe(PLAYER.maxHp - 1);
      expect(w.stats.damageTaken['飢餓']).toBe(1);
      expect(w.player.starvationT).toBeCloseTo(20 - HUNGER.damageEvery, 7);
      return w.player.hp;
    });
    expect(new Set(results).size).toBe(1);
  });

  it('starvation uses the normal death path and does not continue after death', () => {
    const w = makeWorld(); w.player.hunger = HUNGER.starvingAt; w.player.hp = 1;
    w.advance(HUNGER.damageEvery + 10);
    expect(w.player.dead).toBe(true); expect(w.outcome).toBe('dead'); expect(w.deathCause).toBe('飢餓');
    expect(w.stats.damageTaken['飢餓']).toBe(1);
    const h = w.player.hunger, t = w.time; run(w, 120, { wait: true });
    expect([w.player.hunger, w.time]).toEqual([h, t]);
  });
});

describe('One ration in the existing bag and action system', () => {
  it('pickup and stacking work, full bag keeps food on ground, existing food stack accepts food', () => {
    const w = makeWorld();
    for (let k = 0; k < ITEM_FX.slots; k++) addItem(w, 'weapon:axe');
    const pickup = w.addPickup('item', 1, w.player.x, .15, w.player.z, null, 'food:ration');
    updatePickups(w); expect(pickup.taken).toBe(false);
    w.player.items.pop(); updatePickups(w); expect(pickup.taken).toBe(true);
    expect(w.player.items).toContainEqual({ id: 'food:ration', count: 1, level: 0 });
    expect(addItem(w, 'food:ration')).toBe(true);
    const stack = w.player.items.find((it) => it.id === 'food:ration')!;
    expect(stack.count).toBe(2); expect(w.player.items).toHaveLength(ITEM_FX.slots);
    stack.count = HUNGER.foodStackMax;
    expect(addItem(w, 'food:ration')).toBe(false); expect(stack.count).toBe(HUNGER.foodStackMax);
    expect(isKnown(w, 'food:ration')).toBe(true); expect(itemName(w, 'food:ration')).toBe('乾糧');
    expect(itemDesc(w, 'food:ration')).toContain(String(HUNGER.foodRestore)); expect(itemColor('TEST', 'food:ration')).toBeGreaterThan(0);
  });

  it('eating consumes one item at start, pays action world time, restores only on completion', () => {
    const w = makeWorld(); w.player.hunger = HUNGER.hungryAt + 10;
    addItem(w, 'food:ration'); addItem(w, 'food:ration');
    queueUse(w, 0, 'use'); expect(w.time).toBe(0); expect(w.player.items[0]!.count).toBe(2);
    w.frame(dt, emptyInput()); expect(w.player.action?.kind).toBe('eat');
    expect(w.player.items[0]!.count).toBe(1); expect(w.player.hunger).toBeGreaterThan(HUNGER.hungryAt + 10);
    finishAction(w);
    expect(w.lastAction?.spent).toBeCloseTo(ACTIONS.eat.recovery, 8);
    expect(w.player.hunger).toBeCloseTo(HUNGER.hungryAt + 10 + w.time - HUNGER.foodRestore, 8);
    expect(w.stats.itemsUsed).toBe(1); expect(w.events.filter((e) => e.type === 'eat')).toHaveLength(1);
    expect(hungerState(w.player.hunger)).toBe('normal');
  });

  it('eating is not a free combat heal and clears starvation remainder only at completion', () => {
    const w = makeWorld(); w.player.hunger = HUNGER.starvingAt; w.player.starvationT = HUNGER.damageEvery - .1;
    addItem(w, 'food:ration'); queueUse(w, 0, 'use'); w.frame(dt, emptyInput());
    expect(w.player.starvationT).toBeGreaterThan(HUNGER.damageEvery - .1);
    finishAction(w);
    expect(w.player.hp).toBe(PLAYER.maxHp - 1);
    expect(w.player.hunger).toBeCloseTo(HUNGER.starvingAt - HUNGER.foodRestore, 8);
    expect(w.player.starvationT).toBe(0);
  });

  it.each(['stun', 'death'] as const)('an interrupted meal (%s) has no delayed restore or second consumption', (interrupt) => {
    const w = makeWorld(); w.player.hunger = HUNGER.hungryAt;
    addItem(w, 'food:ration'); addItem(w, 'food:ration'); queueUse(w, 0, 'use');
    w.frame(dt, emptyInput());
    if (interrupt === 'stun') { stunPlayer(w, .5); finishAction(w); run(w, 60); }
    else { w.damagePlayer(100, '測試', w.player.x, w.player.z); run(w, 120); }
    expect(w.player.items[0]!.count).toBe(1);
    expect(w.player.hunger).toBeGreaterThanOrEqual(HUNGER.hungryAt);
    expect(w.stats.itemsUsed).toBe(0);
    expect(w.events.some((e) => e.type === 'eat')).toBe(false);
  });

  it('full/empty/throw edges preserve food and cannot create a free action', () => {
    const w = makeWorld(); addItem(w, 'food:ration'); queueUse(w, 0, 'use'); w.frame(dt, emptyInput());
    expect(w.player.action).toBeNull(); expect(w.player.items[0]!.count).toBe(1);
    expect(w.events.some((e) => e.text?.includes('乾糧已保留'))).toBe(true);
    queueUse(w, 0, 'throw'); expect(w.player.pendingUse).toBeNull();
    queueUse(w, 99, 'use'); expect(w.player.pendingUse).toBeNull();
    w.player.hunger = 2; queueUse(w, 0, 'use'); w.player.items = []; w.frame(dt, emptyInput());
    expect(w.player.action).toBeNull(); expect(w.stats.itemsUsed).toBe(0);
    addItem(w, 'food:ration'); queueUse(w, 0, 'use'); w.frame(dt, emptyInput()); finishAction(w);
    expect(w.player.hunger).toBe(0); expect(w.player.items).toHaveLength(0);
  });
});

describe('Food distribution, carry and backwards-compatible v2 saves', () => {
  it('guarantees configured non-entrance exploration food, independent of RNG/class', () => {
    for (let seed = 0; seed < 20; seed++) for (let floor = 1; floor <= 4; floor++) {
      const l = generateLevel(`HUNGER${seed}`, { floor });
      const food = l.pickups.filter((p) => p.item === 'food:ration');
      expect(food).toHaveLength(HUNGER.foodPerFloor[floor - 1]!);
      expect(food.every((p) => Math.hypot(p.x - l.spawn.x, p.z - l.spawn.z) > 3)).toBe(true);
    }
  });

  it('practice entrance and resupply provide the same ration so Hunger cannot become unserviceable', () => {
    const w = new World(generateLevel('HUNGER-PRACTICE', { practice: true }));
    updatePickups(w);
    expect(w.player.items.find((it) => it.id === 'food:ration')?.count).toBe(HUNGER.practiceRations);
    w.player.items = []; w.player.hunger = HUNGER.hungryAt;
    const supply = w.interactables.find((it) => it.kind === 'resupply')!;
    w.player.x = supply.x + 1.3; w.player.z = supply.z;
    const yaw = yawFromDir(supply.x - w.player.x, supply.z - w.player.z);
    w.frame(dt, { ...emptyInput(yaw), interact: true }); finishAction(w);
    expect(w.lastAction?.kind).toBe('use');
    expect(w.player.items.find((it) => it.id === 'food:ration')?.count).toBe(HUNGER.practiceRations);
    // Resupply provides food, rather than silently giving a free Hunger reset.
    expect(w.player.hunger).toBeGreaterThan(HUNGER.hungryAt);
    queueUse(w, 0, 'use'); w.frame(dt, emptyInput()); finishAction(w);
    expect(w.player.hunger).toBeLessThan(HUNGER.hungryAt);
  });

  it('full current saves preserve Hunger, starvation fraction and ration stacks across floors', () => {
    const run = newRun('HUNGER-SAVE', 'warrior'), w = createFloorWorld(run);
    w.player.hunger = HUNGER.starvingAt; w.player.starvationT = HUNGER.damageEvery - 2;
    addItem(w, 'food:ration'); addItem(w, 'food:ration');
    const next = nextFloor(run, w), parsed = parseRun(serializeRun(next))!;
    expect(parsed).toEqual(next);
    const resumed = createFloorWorld(parsed);
    expect(resumed.player.hunger).toBe(HUNGER.starvingAt);
    expect(resumed.player.starvationT).toBe(HUNGER.damageEvery - 2);
    expect(resumed.player.items).toContainEqual({ id: 'food:ration', count: 2, level: 0 });
    resumed.enemies.splice(0); resumed.traps.splice(0); resumed.advance(2);
    expect(resumed.stats.damageTaken['飢餓']).toBe(1);
  });

  it('old v2 optional fields missing defaults to normal and no food, without rejecting the save', () => {
    const run = newRun('OLD-SAVE', 'warrior'), w = createFloorWorld(run);
    const old = JSON.parse(serializeRun(nextFloor(run, w)));
    delete old.carry.hunger; delete old.carry.starvationT;
    const parsed = parseRun(JSON.stringify(old)); expect(parsed).not.toBeNull();
    const resumed = createFloorWorld(parsed!);
    expect(resumed.player.hunger).toBe(0); expect(resumed.player.starvationT).toBe(0);
    expect(resumed.player.items.some((it) => it.id === 'food:ration')).toBe(false);
    const food = resumed.pickups.find((p) => p.item === 'food:ration')!;
    resumed.player.x = food.x; resumed.player.z = food.z;
    updatePickups(resumed); expect(resumed.player.items).toContainEqual({ id: 'food:ration', count: 1, level: 0 });
  });

  it('invalid new optional state is rejected rather than producing NaN or free starvation resets', () => {
    const run = newRun('BAD-HUNGER', 'warrior'), w = createFloorWorld(run);
    const saved = JSON.parse(serializeRun(nextFloor(run, w)));
    for (const patch of [{ hunger: -1 }, { hunger: HUNGER.starvingAt + 1 }, { hunger: 'NaN' }, { starvationT: -1 }, { starvationT: HUNGER.damageEvery }, { starvationT: 1 }]) {
      const bad = structuredClone(saved); Object.assign(bad.carry, patch); expect(parseRun(JSON.stringify(bad))).toBeNull();
    }
  });
});

describe('Shift remains standing height, with identical hostile bolt contacts', () => {
  it.each([.2, 1.6, PLAYER.height - .01, PLAYER.height + .2])('standing/sneaking matches at y=%s', (y) => {
    const hit = (sneak: boolean) => {
      const w = makeWorld(); w.frame(dt, { ...emptyInput(), sneak });
      const pos = { x: w.player.x, y, z: w.player.z - 2 }, vel = { x: 0, y: 0, z: 18 };
      const bolt: Projectile = { id: w.nextId++, kind: 'bolt', owner: 999, pos, vel, radius: PROJECTILES.bolt.radius, gravity: 0, age: 0, alive: true, hitSet: new Set(), next: { ...pos }, avgVel: { ...vel }, deflected: false, tip: null, payload: 'smoke' };
      w.projectiles.push(bolt); updateProjectiles(w, .2);
      return w.player.hp;
    };
    expect(PLAYER.height).toBe(1.8); expect(PLAYER.eyeHeight).toBe(1.6);
    expect(hit(true)).toBe(hit(false));
    expect(hit(true)).toBe(y <= PLAYER.height ? PLAYER.maxHp - PROJECTILES.bolt.damage : PLAYER.maxHp);
  });
});
