import { describe, expect, it } from 'vitest';
import { ACTIONS, ENEMIES, HEALING_POTION, PLAYER, TIME } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { CalibrationObserver, type CalibrationMilestone } from '../src/playtest/calibration';
import { createPublicPlaytestWorld } from '../src/playtest/scenario';
import { emptyInput, type FrameInput, type GameEvent } from '../src/sim/types';

/** These reachability drivers read the ordinary simulation to select native
 * inputs. They never assign positions, HP, attack phases, kills, inventory,
 * observer state, or synthetic events. This is deterministic coverage, not a
 * claim of human usability or an imposed route through the calibration. */
function driver(fps: number) {
  const world = createPublicPlaytestWorld('calibration');
  const observer = new CalibrationObserver();
  const evidence: CalibrationMilestone[] = [];
  const events: GameEvent[] = [];
  const frame = (partial: Partial<FrameInput> = {}) => {
    const input = { ...emptyInput(world.player.yaw, world.player.pitch), ...partial };
    const before = observer.beforeFrame(world);
    world.frame(1 / fps, input);
    const nativeEvents = world.drainEvents();
    events.push(...nativeEvents);
    const update = observer.observeFrame(world, input, before, nativeEvents);
    evidence.push(...update.milestones);
    return update;
  };
  const until = (done: () => boolean, input: () => Partial<FrameInput>, seconds = 20) => {
    for (let f = 0; f < fps * seconds && !done(); f++) frame(input());
    expect(done(), JSON.stringify({ state: observer.state, evidence,
      hp: world.player.hp, guard: world.enemies[0], events: events.slice(-12) })).toBe(true);
  };
  return { fps, world, observer, evidence, events, frame, until };
}
type Driver = ReturnType<typeof driver>;

function observeSlow(d: Driver): void {
  d.until(() => d.observer.state.slowObserved, () => ({}), 4);
  expect(d.evidence.filter(event => event.type === 'stop_slow_seen')).toHaveLength(1);
}

function holdAttackUntilGuardDefeated(d: Driver): void {
  let pressed = false;
  d.until(() => d.observer.state.guardDefeated, () => {
    const p = d.world.player, guard = d.world.enemies[0]!;
    const input = { moveZ: Math.hypot(guard.x - p.x, guard.z - p.z) > 1.7 ? 1 : 0,
      fire: true, firePressed: !pressed, wait: true };
    pressed = true;
    return input;
  });
  expect(d.world.enemies[0]!.alive).toBe(false);
  expect(d.events.filter(event => event.type === 'hitEnemy').every(event => event.source === 'melee')).toBe(true);
  expect(d.evidence.filter(event => event.type === 'guard_defeated')).toHaveLength(1);
  expect(d.world.player.dead).toBe(false);
  expect(d.world.outcome).toBe('none');
}

function finishWithNativeHealing(d: Driver): void {
  expect(d.observer.state.guardDefeated).toBe(true);
  expect(d.observer.state.slowObserved).toBe(true);
  expect(d.observer.state.complete).toBe(false);
  expect(d.world.stats.healingUsed).toBe(0);
  expect(d.world.pickups.filter(pickup => pickup.item === 'potion:healing')).toHaveLength(1);

  // Waiting through recovery and remaining still cannot collect the supply.
  // Walk using ordinary input before the native pickup/action can complete it.
  const pickup = d.world.pickups.find(pickup => pickup.item === 'potion:healing')!;
  d.until(() => d.world.player.action === null, () => ({ wait: true }), 3);
  for (let f = 0; f < d.fps; f++) d.frame();
  expect(pickup.taken).toBe(false);
  expect(d.world.player.items).toEqual([]);
  expect(d.world.stats.healingFound).toBe(0);
  expect(Math.hypot(pickup.x - d.world.player.x, pickup.z - d.world.player.z)).toBeGreaterThan(PLAYER.pickupRadius);
  d.until(() => d.world.player.items.some(item => item.id === 'potion:healing'), () => ({
    yaw: yawFromDir(pickup.x - d.world.player.x, pickup.z - d.world.player.z), moveZ: 1,
  }), 3);
  expect(d.events.some(event => event.type === 'pickup')).toBe(true);
  expect(d.world.stats.healingFound).toBe(1);
  expect(d.world.pickups.find(pickup => pickup.item === 'potion:healing')?.taken).toBe(true);
  expect(d.observer.state.complete).toBe(false);
  const hpBefore = d.world.player.hp;
  const timeBefore = d.world.time;
  d.frame({ potion: true });
  expect(d.world.player.action?.kind).toBe('potion');
  expect(d.world.player.action?.item).toBe('potion:healing');
  expect(d.world.player.hp).toBe(hpBefore);
  expect(d.world.stats.healingUsed).toBe(0);
  expect(d.observer.state.complete).toBe(false);
  expect(d.evidence.some(event => event.type === 'calibration_complete')).toBe(false);
  d.until(() => d.observer.state.complete, () => ({}), 3);

  const potionDuration = ACTIONS.potion.windup + ACTIONS.potion.active + ACTIONS.potion.recovery;
  expect(d.world.time - timeBefore).toBeGreaterThanOrEqual(potionDuration - 1e-8);
  expect(d.world.time - timeBefore).toBeLessThan(potionDuration + 1 / d.fps + 1e-8);
  expect(d.world.player.hp).toBe(Math.min(d.world.player.maxHp,
    hpBefore + Math.ceil(d.world.player.maxHp * HEALING_POTION.fraction)));
  expect(d.world.stats.healingUsed).toBe(1);
  expect(d.world.stats.healingRestored).toBeGreaterThan(0);
  expect(d.observer.state.healingUsed).toBe(true);
  expect(d.observer.state.healingSkipped).toBe(false);
  expect(d.observer.state.phase).toBe('optional');
  expect(d.evidence.filter(event => event.type === 'healing_used')).toHaveLength(1);
  expect(d.evidence.filter(event => event.type === 'calibration_complete')).toHaveLength(1);
  expect(d.evidence.findIndex(event => event.type === 'healing_used'))
    .toBeLessThan(d.evidence.findIndex(event => event.type === 'calibration_complete'));
  expect(d.world.player.known).not.toContain('potion:haste');
  expect(d.world.player.items).toContainEqual({ id: 'potion:haste', count: 1, level: 0 });
  expect(d.world.outcome).toBe('none');
}

for (const fps of [30, 60, 120]) describe(`open calibration native-input guidance at ${fps} fps`, () => {
  it.each(['before', 'after'] as const)('accepts held melee with factual slow time %s the kill and no camera movement', order => {
    const d = driver(fps);
    if (order === 'before') {
      observeSlow(d);
      expect(d.observer.state.moved).toBe(false);
      expect(d.observer.state.looked).toBe(false);
    }
    holdAttackUntilGuardDefeated(d);
    expect(d.observer.state.looked).toBe(false);
    expect(d.world.player.yaw).toBe(0);
    expect(d.world.player.pitch).toBe(0);
    expect(d.observer.state.complete).toBe(false);
    if (order === 'after') {
      expect(d.observer.state.slowObserved).toBe(false);
      expect(d.observer.state.phase).toBe('slow');
      expect(d.observer.state.cue).toContain('盾衛已倒下');
      expect(d.world.pickups).toEqual([]);
      observeSlow(d);
    }
    const killIndex = d.evidence.findIndex(event => event.type === 'guard_defeated');
    const slowIndex = d.evidence.findIndex(event => event.type === 'stop_slow_seen');
    expect(order === 'before' ? slowIndex < killIndex : killIndex < slowIndex).toBe(true);
    expect(d.observer.state.cue).not.toMatch(/重來|重試|重新|失敗|再獨立|完整閃避/);
    finishWithNativeHealing(d);
  });

  it('accepts ordinary melee kills with no Counter or dodge requirement', () => {
    const d = driver(fps);
    d.until(() => d.observer.state.guardDefeated, () => {
      const p = d.world.player, guard = d.world.enemies[0]!;
      const strike = p.action === null && guard.phase === 'recovery';
      return { wait: true, moveZ: Math.hypot(guard.x - p.x, guard.z - p.z) > 2 ? 1 : 0,
        fire: strike, firePressed: strike };
    });
    expect(d.world.stats.counters).toBe(0);
    expect(d.events.filter(event => event.type === 'hitEnemy')).toHaveLength(2);
    expect(d.events.filter(event => event.type === 'hitEnemy').every(event => event.source === 'melee')).toBe(true);
    expect(d.world.stats.damageTaken['盾衛的劍']).toBeGreaterThan(0);
    expect(d.observer.state.looked).toBe(false);
    expect(d.observer.state.slowObserved).toBe(false);
    observeSlow(d);
    finishWithNativeHealing(d);
  });

  it('accepts an actual Warrior Counter followed by native melee, without restarting', () => {
    const d = driver(fps);
    d.until(() => d.world.stats.counters > 0, () => {
      const p = d.world.player, guard = d.world.enemies[0]!;
      const counterNow = p.action === null && d.world.cue.counter?.kind === 'guard';
      return { wait: true, moveZ: Math.hypot(guard.x - p.x, guard.z - p.z) > 2 ? 1 : 0,
        fire: counterNow, firePressed: counterNow };
    });
    expect(d.events.some(event => event.type === 'counter')).toBe(true);
    expect(d.evidence.filter(event => event.type === 'counter_observed')).toHaveLength(1);
    expect(d.world.enemies[0]!.alive).toBe(true);
    expect(d.world.enemies[0]!.hp).toBeLessThan(ENEMIES.guard.hp);
    holdAttackUntilGuardDefeated(d);
    observeSlow(d);
    expect(d.observer.state.looked).toBe(false);
    expect(d.observer.state.cue).not.toMatch(/重來|重試|重新|失敗/);
    finishWithNativeHealing(d);
  });

  it('accepts a real Shove, then native melee and healing without a prescribed dodge', () => {
    const d = driver(fps);
    d.until(() => d.world.stats.pushes > 0, () => ({ wait: true,
      moveZ: d.world.cue.push < 0 ? 1 : 0, shield: d.world.cue.push >= 0 }));
    expect(d.events.some(event => event.type === 'push' && event.id === d.world.enemies[0]!.id)).toBe(true);
    expect(d.world.enemies[0]!.alive).toBe(true);
    expect(d.world.enemies[0]!.hp).toBe(ENEMIES.guard.hp);
    holdAttackUntilGuardDefeated(d);
    observeSlow(d);
    expect(d.observer.state.looked).toBe(false);
    finishWithNativeHealing(d);
  });

  it('credits factual slow time while looking away outside melee range', () => {
    const d = driver(fps);
    d.until(() => Math.hypot(d.world.enemies[0]!.x - d.world.player.x,
      d.world.enemies[0]!.z - d.world.player.z) >= 4, () => ({ moveZ: -1 }));
    expect(d.observer.state.slowObserved).toBe(false);
    d.frame({ yaw: Math.PI });
    observeSlow(d);
    expect(d.world.player.yaw).toBe(Math.PI);
    expect(d.world.enemies[0]!.alive).toBe(true);
    expect(d.observer.state.guardDefeated).toBe(false);
    expect(d.observer.state.phase).toBe('combat');
    expect(d.world.lastWorldDt / d.world.lastRealDt).toBeCloseTo(TIME.idleRate, 10);
    expect(d.observer.state.complete).toBe(false);
  });

  it('credits factual slow time during a live active attack even when facing away', () => {
    const d = driver(fps);
    d.until(() => d.world.enemies[0]!.phase === 'active', () => ({ wait: true }));
    expect(d.observer.state.slowObserved).toBe(false);
    const phaseAtStop = d.world.enemies[0]!.phase;
    d.frame({ yaw: Math.PI });
    observeSlow(d);
    expect(phaseAtStop).toBe('active');
    expect(d.world.enemies[0]!.phase).toBe('active');
    expect(d.observer.state.slowObserved).toBe(true);
    expect(d.observer.state.guardDefeated).toBe(false);
    expect(d.world.lastWorldDt / d.world.lastRealDt).toBeCloseTo(TIME.idleRate, 10);
    expect(d.observer.state.complete).toBe(false);
  });
});
