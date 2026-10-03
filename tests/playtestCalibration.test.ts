import { describe, expect, it } from 'vitest';
import { CLASSES, ENEMIES, HEALING_POTION, PLAYER, WEAPONS } from '../src/config';
import { forwardFromYaw, yawFromDir } from '../src/core/math';
import { CalibrationObserver, type CalibrationMilestone } from '../src/playtest/calibration';
import { createPublicPlaytestWorld, PUBLIC_BUILD_ID } from '../src/playtest/scenario';
import { isKnown, queueUse } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { emptyInput, type FrameInput } from '../src/sim/types';

const DT = 1 / 60;
function driver() {
  const world = createPublicPlaytestWorld('calibration'), observer = new CalibrationObserver();
  const evidence: CalibrationMilestone[] = [];
  const frame = (partial: Partial<FrameInput> = {}) => {
    const input = { ...emptyInput(world.player.yaw, world.player.pitch), ...partial };
    const before = observer.beforeFrame(world);
    world.frame(DT, input);
    const update = observer.observeFrame(world, input, before, world.drainEvents());
    evidence.push(...update.milestones);
    return update;
  };
  return { world, observer, evidence, frame };
}
function killGuard(d: ReturnType<typeof driver>) {
  for (let f = 0; f < 3000 && d.world.enemies[0]!.alive; f++) {
    const p = d.world.player, e = d.world.enemies[0]!;
    d.frame({ yaw: yawFromDir(e.x - p.x, e.z - p.z), moveZ: Math.hypot(e.x - p.x, e.z - p.z) > 1.7 ? 1 : 0,
      fire: true, firePressed: f === 0 });
  }
  expect(d.world.enemies[0]!.alive).toBe(false);
}
function supplyHealing(d: ReturnType<typeof driver>, yaw = d.world.player.yaw) {
  for (let f = 0; f < 180 && !d.world.pickups.some(p => p.item === 'potion:healing'); f++) d.frame({ yaw });
  expect(d.observer.state.phase).toBe('healing');
  const pickup = d.world.pickups.find(p => p.item === 'potion:healing');
  expect(pickup).toBeDefined();
  return pickup!;
}
function walkToHealing(d: ReturnType<typeof driver>) {
  const pickup = d.world.pickups.find(p => p.item === 'potion:healing' && !p.taken)!;
  for (let f = 0; f < 180 && !pickup.taken; f++) {
    const p = d.world.player;
    d.frame({ yaw: yawFromDir(pickup.x - p.x, pickup.z - p.z), moveZ: 1 });
  }
  expect(pickup.taken).toBe(true);
  expect(d.world.player.items).toEqual([{ id: 'potion:healing', count: 1, level: 0 }]);
}
function recovery(d: ReturnType<typeof driver>) {
  killGuard(d);
  supplyHealing(d);
  walkToHealing(d);
}
function finishDrink(d: ReturnType<typeof driver>) {
  for (let f = 0; f < 180 && !d.observer.state.complete; f++) d.frame();
  expect(d.observer.state.complete).toBe(true);
}

describe('open public calibration fixtures', () => {
  it('keeps native guard/kit/knowledge and authors a disclosed initial wound', () => {
    const w = createPublicPlaytestWorld('calibration');
    expect(PUBLIC_BUILD_ID).toBe('PublicCalibrationOpenV2');
    expect(w.enemies).toHaveLength(1);
    expect(w.enemies[0]!.hp).toBe(ENEMIES.guard.hp);
    expect(w.player.weapon).toEqual({ id: CLASSES.warrior.weapon, level: 0 });
    expect(w.player.hp).toBe(Math.ceil(w.player.maxHp / 2));
    expect(w.player.items).toEqual([]);
    expect(w.pickups).toEqual([]);
    expect(isKnown(w, 'potion:healing')).toBe(true);
    expect(isKnown(w, 'scroll:identify')).toBe(false);
    expect(ENEMIES.guard.hp).toBe(2 * WEAPONS.longsword.damage);
    expect(createPublicPlaytestWorld('core').player.hp).toBe(PLAYER.maxHp);
  });
  it('reuses fresh shield-crossfire core without carry, bonus items, hunger or protection', () => {
    const a = createPublicPlaytestWorld('core'), b = createPublicPlaytestWorld('core');
    expect(a.level.practiceTrial).toBe('shield-crossfire');
    expect(a.enemies.map(e => e.kind)).toEqual(['guard', 'archer']);
    expect(a.player.items).toEqual([]);
    for (let f = 0; f < 100; f++) a.frame(DT, { ...emptyInput(), wait: true });
    expect(a.player.hunger).toBe(0);
    a.damagePlayer(999, 'guard', a.player.x + 1, a.player.z);
    expect(a.player.dead).toBe(true);
    expect(b.player.hp).toBe(b.player.maxHp);
  });
});

describe('public core ordinary-input reachability', () => {
  it('does not clear through stationary spam or a straight held-attack rush from its sheltered start', () => {
    for (const moveZ of [0, 1]) {
      const w = createPublicPlaytestWorld('core');
      for (let f = 0; f < 60 * 20 && !w.player.dead; f++)
        w.frame(DT, { ...emptyInput(w.player.yaw), moveZ, fire: true, firePressed: f === 0 });
      expect(w.enemies.some(e => e.alive)).toBe(true);
    }
  });
  it('can clear both original shield-crossfire enemies with the native warrior sword', () => {
    // State-informed deterministic bot, not evidence of human usability or fun.
    // The only mutations are World.frame with ordinary movement/look/attack input.
    const w = createPublicPlaytestWorld('core');
    const nav = new Nav(w.grid, PLAYER.radius);
    const hitSources: string[] = [];
    const defeated: string[] = [];
    const windups: string[] = [];
    for (let f = 0; f < 60 * 60 && !w.player.dead && w.enemies.some(e => e.alive); f++) {
      const p = w.player;
      const target = w.enemies.filter(e => e.alive).sort((a, b) =>
        Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]!;
      const gap = Math.hypot(target.x - p.x, target.z - p.z);
      const yaw = yawFromDir(target.x - p.x, target.z - p.z);
      const input = emptyInput(yaw);
      const path = nav.findPath(p.x, p.z, target.x, target.z);
      const waypoint = path?.find(point => Math.hypot(point.x - p.x, point.z - p.z) > .12);
      if (waypoint && gap > 1.65) {
        const dx = waypoint.x - p.x, dz = waypoint.z - p.z;
        const length = Math.hypot(dx, dz);
        input.moveX = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length;
        input.moveZ = (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / length;
      }
      if (!p.action && gap <= 2.3) { input.fire = true; input.firePressed = true; }
      w.frame(DT, input);
      for (const event of w.drainEvents()) {
        if (event.type === 'enemyWindup') windups.push(event.kind ?? 'unknown');
        if (event.type === 'hitEnemy') hitSources.push(event.source ?? 'unknown');
        if (event.type === 'enemyDeath') defeated.push(event.kind ?? 'unknown');
      }
    }
    const metrics = { realSeconds: Number(w.realTime.toFixed(3)), worldSeconds: Number(w.time.toFixed(3)),
      damage: Object.values(w.stats.damageTaken).reduce((total, amount) => total + amount, 0),
      hp: w.player.hp, kills: w.stats.kills, defeated, hitSources, windups,
      position: [Number(w.player.x.toFixed(2)), Number(w.player.z.toFixed(2))] };
    console.info('RemoteValidationV1 core state-informed bot:', JSON.stringify(metrics));
    expect(w.player.dead, JSON.stringify(metrics)).toBe(false);
    expect(w.stats.kills, JSON.stringify(metrics)).toBe(2);
    expect(defeated).toEqual(['guard', 'archer']);
    expect(hitSources).toEqual(['melee', 'melee', 'melee']);
    expect(w.player.weapon).toEqual({ id: CLASSES.warrior.weapon, level: 0 });
    expect(w.player.items).toEqual([]);
    expect(w.player.talents).toEqual([]);
    expect(w.player.xp).toBe(0);
    expect(w.player.hunger).toBe(0);
    expect(w.player.stones).toBe(CLASSES.warrior.start.stones);
  });
});

describe('factual open calibration and formal healing', () => {
  it('observes actual slow once before any movement/look, independent of guard phase', () => {
    const d = driver();
    for (let f = 0; f < 120; f++) d.frame({ yaw: Math.PI });
    expect(d.observer.state.slowObserved).toBe(true);
    expect(d.observer.state.moved).toBe(false);
    expect(d.evidence.filter(e => e.type === 'stop_slow_seen')).toHaveLength(1);
    expect(d.observer.state.complete).toBe(false);
    expect(d.world.pickups).toHaveLength(0);
  });
  it('does not credit waiting, held movement against a wall, committed actions, or paused frames as slow', () => {
    const d = driver();
    for (let f = 0; f < 120; f++) d.frame({ wait: true });
    expect(d.observer.state.slowObserved).toBe(false);
    for (let f = 0; f < 180; f++) d.frame({ moveZ: -1 });
    expect(d.observer.state.slowObserved).toBe(false);
    for (let f = 0; f < 120; f++) d.frame({ fire: true });
    expect(d.observer.state.slowObserved).toBe(false);
    const before = d.observer.beforeFrame(d.world);
    d.observer.observeFrame(d.world, emptyInput(), before, []);
    expect(d.observer.state.slowObserved).toBe(false);
  });
  it.each([
    { name: 'center', x: 7, z: 8, gx: 7, gz: 6.5, yaw: 0 },
    { name: 'north wall facing out', x: 7, z: 1.35, gx: 7, gz: 2.85, yaw: 0 },
    { name: 'south wall facing out', x: 7, z: 13.65, gx: 7, gz: 12.15, yaw: Math.PI },
    { name: 'west wall facing out', x: 1.35, z: 7, gx: 2.85, gz: 7, yaw: Math.PI / 2 },
    { name: 'east wall facing out', x: 12.65, z: 7, gx: 11.15, gz: 7, yaw: -Math.PI / 2 },
    { name: 'northwest corner facing out', x: 1.35, z: 1.35, gx: 2.45, gz: 2.45, yaw: Math.PI / 4 },
    { name: 'northeast corner facing out', x: 12.65, z: 1.35, gx: 11.55, gz: 2.45, yaw: -Math.PI / 4 },
    { name: 'southwest corner facing out', x: 1.35, z: 13.65, gx: 2.45, gz: 12.55, yaw: 3 * Math.PI / 4 },
    { name: 'southeast corner facing out', x: 12.65, z: 13.65, gx: 11.55, gz: 12.55, yaw: -3 * Math.PI / 4 },
  ])('requires walking to a visible, reachable healing pickup after a guard kill at $name', position => {
    const d = driver();
    // Only fixture placement varies; the guard is defeated with ordinary attack
    // input, and both waiting and acquisition run the real World.frame pipeline.
    Object.assign(d.world.player, { x: position.x, z: position.z });
    Object.assign(d.world.enemies[0]!, { x: position.gx, z: position.gz });
    killGuard(d);
    const pickup = supplyHealing(d, position.yaw), p = d.world.player;
    expect(p.dead).toBe(false);
    // Native enemy contact may nudge the player slightly during the fight.
    expect(Math.hypot(p.x - position.x, p.z - position.z)).toBeLessThan(.2);
    const start = { x: p.x, z: p.z };
    expect(Math.hypot(pickup.x - p.x, pickup.z - p.z)).toBeCloseTo(PLAYER.pickupRadius + 1.5);
    expect(d.world.grid.circleBlocked(pickup.x, pickup.z, PLAYER.radius)).toBe(false);
    expect(d.world.grid.lineOfSight({ x: p.x, y: PLAYER.eyeHeight, z: p.z }, pickup)).toBe(true);
    for (let step = 0; step <= 30; step++) {
      const t = step / 30;
      expect(d.world.grid.circleBlocked(p.x + (pickup.x - p.x) * t, p.z + (pickup.z - p.z) * t, PLAYER.radius)).toBe(false);
    }
    for (let f = 0; f < 180; f++) d.frame();
    expect(d.world.player.items).toEqual([]);
    expect(pickup.taken).toBe(false);
    expect(d.world.stats.healingFound).toBe(0);
    expect(d.world.stats.healingUsed).toBe(0);
    expect(d.observer.state.complete).toBe(false);
    expect(d.observer.state.cue).toContain('走過去');
    expect(d.observer.state.cue).not.toContain('腳邊');
    walkToHealing(d);
    expect(Math.hypot(p.x - start.x, p.z - start.z)).toBeGreaterThan(1.4);
    expect(d.world.stats.healingFound).toBe(1);
    expect(d.world.stats.healingUsed).toBe(0);
    expect(d.world.pickups.filter(item => item.item === 'potion:healing')).toHaveLength(1);
    expect(d.observer.state.complete).toBe(false);
    d.frame({ potion: true }); finishDrink(d);
    expect(d.world.stats.healingUsed).toBe(1);
  });
  it.each(['hotkey', 'inventory'] as const)('credits only completed formal Healing effect via %s', mode => {
    const d = driver(); recovery(d);
    const hp = d.world.player.hp;
    expect(d.world.stats.healingFound).toBe(1);
    expect(d.world.pickups.filter(p => p.item === 'potion:healing')).toHaveLength(1);
    if (mode === 'inventory') queueUse(d.world, 0, 'use');
    d.frame({ potion: mode === 'hotkey' });
    expect(d.world.player.items.some(i => i.id === 'potion:healing')).toBe(false);
    expect(d.world.player.action?.kind).toBe('potion');
    expect(d.world.player.hp).toBe(hp);
    expect(d.world.stats.healingUsed).toBe(0);
    expect(d.observer.state.complete).toBe(false);
    finishDrink(d);
    expect(d.world.player.hp).toBe(Math.min(d.world.player.maxHp, hp + Math.ceil(d.world.player.maxHp * HEALING_POTION.fraction)));
    expect(d.world.stats.healingUsed).toBe(1);
    expect(d.observer.state.healingUsed).toBe(true);
    expect(d.observer.state.healingSkipped).toBe(false);
    expect(d.evidence.filter(e => e.type === 'calibration_complete')).toHaveLength(1);
    expect(d.world.player.items).toEqual([{ id: 'potion:haste', count: 1, level: 0 }]);
    expect(isKnown(d.world, 'potion:haste')).toBe(false);
  });
  it('deterministically avoids a blocked approach even when the forward destination has line of sight', () => {
    const placements: Array<{ x: number; z: number }> = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const d = driver(); killGuard(d);
      const p = d.world.player, direction = forwardFromYaw(p.yaw);
      const forward = { x: p.x + direction.x * (PLAYER.pickupRadius + 1.5), y: .15,
        z: p.z + direction.z * (PLAYER.pickupRadius + 1.5) };
      // A low prop does not obscure the bottle, but a player cannot walk through
      // it. This fixture isolates approach clearance from endpoint/LOS checks.
      d.world.grid.addPillar({ x: p.x + direction.x * .9, z: p.z + direction.z * .9,
        r: .2, h: .1, kind: 'prop' });
      expect(d.world.grid.circleBlocked(forward.x, forward.z, PLAYER.radius)).toBe(false);
      expect(d.world.grid.lineOfSight({ x: p.x, y: PLAYER.eyeHeight, z: p.z }, forward)).toBe(true);
      const pickup = supplyHealing(d);
      expect(Math.hypot(pickup.x - forward.x, pickup.z - forward.z)).toBeGreaterThan(.5);
      placements.push({ x: pickup.x, z: pickup.z });
      walkToHealing(d);
      expect(d.world.stats.healingFound).toBe(1);
      expect(d.world.stats.healingUsed).toBe(0);
    }
    expect(placements[0]).toEqual(placements[1]);
  });
  it('preserves an intact dropped lesson item for ordinary reacquisition without duplicate supply', () => {
    const d = driver(); recovery(d);
    queueUse(d.world, 0, 'drop'); d.frame();
    for (let f = 0; f < 30; f++) d.frame();
    expect(d.observer.state.complete).toBe(false);
    expect(d.world.pickups.filter(p => p.item === 'potion:healing' && !p.taken)).toHaveLength(1);
    for (let f = 0; f < 30; f++) d.frame({ moveZ: -1 });
    for (let f = 0; f < 30; f++) d.frame({ moveZ: 1 });
    expect(d.world.player.items.some(i => i.id === 'potion:healing')).toBe(true);
    expect(d.world.stats.healingFound).toBe(1);
    d.frame({ potion: true }); finishDrink(d);
  });
  it('a thrown lesson bottle permits explicitly classified continuation without replacing or faking healing', () => {
    const d = driver(); recovery(d);
    const hp = d.world.player.hp;
    queueUse(d.world, 0, 'throw'); d.frame();
    expect(d.observer.state.complete).toBe(false);
    finishDrink(d);
    expect(d.world.player.hp).toBe(hp);
    expect(d.world.stats.healingUsed).toBe(0);
    expect(d.observer.state.healingSkipped).toBe(true);
    expect(d.evidence.some(e => e.type === 'healing_skipped_resource_lost')).toBe(true);
    expect(d.world.pickups.filter(p => p.item === 'potion:healing')).toHaveLength(1);
  });
  it('emits independent core facts without adding supplies or calibration completion', () => {
    const w = createPublicPlaytestWorld('core'), observer = new CalibrationObserver();
    const evidence: CalibrationMilestone[] = [];
    for (let f = 0; f < 30; f++) {
      const before = observer.beforeFrame(w), input = emptyInput(w.player.yaw);
      w.frame(DT, input); evidence.push(...observer.observeFrame(w, input, before, w.drainEvents()).milestones);
    }
    expect(evidence.filter(e => e.type === 'stop_slow_seen')).toHaveLength(1);
    expect(observer.state.complete).toBe(false);
    expect(w.pickups).toEqual([]);
  });
});
