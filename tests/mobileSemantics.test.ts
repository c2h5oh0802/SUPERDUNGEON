import { describe, expect, it } from 'vitest';
import { ACTIONS, PLAYER, TIME, WEAPONS, type PlayerClass } from '../src/config';
import { emptyInput, type FrameInput } from '../src/sim/types';
import { mergeInput, TOUCH_LOOK_SCALE } from '../src/input/merge';
import type { RawFrame } from '../src/input/input';
import { finishAction, makeWorld, run } from './helpers';

const dt = 1 / 120;
const classes = ['warrior', 'huntress'] as const;

/** The mobile adapter feeds the existing FrameInput boundary. These are contracts,
 * not a new mobile-specific simulation or a changed combat/time balance. */
function rangedWorld(cls: PlayerClass) {
  const w = makeWorld(undefined, [], cls);
  w.player.tool = w.player.desiredTool = cls === 'warrior' ? 'stone' : 'bow';
  return w;
}

function traceMove(cls: PlayerClass, input: Partial<FrameInput>, frames = 90) {
  const w = makeWorld(undefined, [], cls);
  const start = { x: w.player.x, z: w.player.z };
  let distance = 0;
  let time = 0;
  for (let frame = 0; frame < frames; frame++) {
    const elapsed = w.frame(dt, { ...emptyInput(), ...input });
    distance += w.player.lastMoveDist;
    time += elapsed;
    // Idle is a floor, not an extra charge. Collisions and analog magnitude
    // determine actual distance before the shared world-time calculation.
    expect(elapsed).toBeCloseTo(Math.min(dt, Math.max(dt * TIME.idleRate, w.player.lastMoveDist / TIME.refMoveSpeed)), 10);
  }
  return { w, distance, time, displacement: Math.hypot(w.player.x - start.x, w.player.z - start.z) };
}

describe.each(classes)('mobile FrameInput preserves %s simulation semantics', (cls) => {
  it('idle and look-only frames have identical world/hunger time and no movement', () => {
    const idle = makeWorld(undefined, [], cls);
    const look = makeWorld(undefined, [], cls);
    const start = { x: look.player.x, z: look.player.z };
    for (let frame = 0; frame < 120; frame++) {
      const baseline = idle.frame(dt, emptyInput());
      const observed = look.frame(dt, emptyInput(frame * 0.025, Math.sin(frame / 10) * 0.5));
      expect(observed).toBe(baseline);
      expect(look.player.action).toBeNull();
    }
    expect(look.time).toBeCloseTo(TIME.idleRate, 10);
    expect(look.time).toBe(idle.time);
    expect(look.player.hunger).toBe(idle.player.hunger);
    expect({ x: look.player.x, z: look.player.z }).toEqual(start);
  });

  it('analog magnitude controls distance and world time without diagonal boost', () => {
    const cardinal = traceMove(cls, { moveZ: 0.5 });
    const diagonal = traceMove(cls, { moveX: 0.3, moveZ: 0.4 });
    const full = traceMove(cls, { moveZ: 1 });
    const oversized = traceMove(cls, { moveX: 1, moveZ: 1 });
    expect(cardinal.distance).toBeCloseTo(diagonal.distance, 9);
    expect(cardinal.time).toBeCloseTo(diagonal.time, 9);
    expect(full.distance).toBeCloseTo(oversized.distance, 9);
    expect(full.time).toBeCloseTo(oversized.time, 9);
    expect(full.displacement).toBeLessThanOrEqual(PLAYER.moveSpeed * 90 * dt);
    expect(cardinal.displacement).toBeLessThan(full.displacement);
    expect(cardinal.time).toBeLessThan(full.time);
  });

  it('analog movement into a wall reverts to the same idle floor', () => {
    const w = makeWorld(undefined, [], cls);
    run(w, 300, { moveZ: 0.7 }, 1 / 60);
    const before = w.player.z;
    expect(run(w, 120, { moveZ: 0.7 }, dt)).toBeCloseTo(TIME.idleRate, 6);
    expect(w.player.z).toBeCloseTo(before, 10);
  });

  it('a brief ranged press commits, then auto-fires at windup after release', () => {
    const w = rangedWorld(cls);
    const kind = cls === 'warrior' ? 'stone' : 'bow';
    const ammo = () => cls === 'warrior' ? w.player.stones : w.player.arrows;
    const beforeAmmo = ammo();
    const beforeTime = w.time;
    w.frame(dt, { ...emptyInput(), fire: true, firePressed: true });
    const action = w.player.action!;
    expect(action.kind).toBe(kind);
    expect(action.fired).toBe(false);
    expect(ammo()).toBe(beforeAmmo);
    while (action.t + dt < action.windup - 1e-9) {
      w.frame(dt, emptyInput());
      expect(action.fired).toBe(false);
      expect(ammo()).toBe(beforeAmmo);
    }
    for (let frame = 0; frame < 3 && !action.fired; frame++) w.frame(dt, emptyInput());
    expect(action.fired).toBe(true);
    expect(action.t).toBeGreaterThanOrEqual(action.windup - 1e-9);
    expect(action.t).toBeLessThanOrEqual(action.windup + dt + 1e-9);
    expect(ammo()).toBe(beforeAmmo - 1);
    finishAction(w, dt);
    expect(w.stats.shots).toBe(1);
    const timing = ACTIONS[kind];
    const total = timing.windup + timing.active + timing.recovery;
    expect(w.time - beforeTime).toBeCloseTo(total, 7);
    run(w, 120, {}, dt);
    expect(w.stats.shots).toBe(1); // Releasing prevents repeats; it does not cancel.
  });

  it('held fire repeats through the unchanged action timing', () => {
    const w = rangedWorld(cls);
    const kind = cls === 'warrior' ? 'stone' : 'bow';
    const total = ACTIONS[kind].windup + ACTIONS[kind].active + ACTIONS[kind].recovery;
    const beforeAmmo = cls === 'warrior' ? w.player.stones : w.player.arrows;
    run(w, Math.ceil((total * 2 + ACTIONS[kind].windup + dt * 2) / dt), { fire: true }, dt);
    expect(w.stats.shots).toBe(3);
    expect(cls === 'warrior' ? w.player.stones : w.player.arrows).toBe(beforeAmmo - 3);
    finishAction(w, dt);
    run(w, 60, {}, dt);
    expect(w.stats.shots).toBe(3);
  });

  it('look and fire in the firing frame use current aim, including a released committed attack', () => {
    const w = rangedWorld(cls);
    w.frame(dt, { ...emptyInput(0, 0), fire: true, firePressed: true });
    const action = w.player.action!;
    while (action.t + dt < action.windup - 1e-9) w.frame(dt, emptyInput(0, 0));
    const aim = Math.PI / 2;
    for (let frame = 0; frame < 3 && !action.fired; frame++) w.frame(dt, emptyInput(aim, 0.25));
    const projectile = w.projectiles.find(q => q.owner === 'player')!;
    expect(projectile).toBeDefined();
    expect(projectile.vel.x).toBeLessThan(-10);
    expect(Math.abs(projectile.vel.z)).toBeLessThan(Math.abs(projectile.vel.x) * 0.1);
    expect(projectile.vel.y).toBeGreaterThan(0);
    expect(w.player.yaw).toBe(aim);
    expect(w.stats.shots).toBe(1);
  });

  it('look-only does not start melee, but a short press still commits a full swing', () => {
    const w = makeWorld(undefined, [], cls);
    w.player.tool = w.player.desiredTool = 'melee';
    w.frame(dt, { ...emptyInput(0.3, 0.1), fire: true, firePressed: true });
    const action = w.player.action!;
    expect(action.kind).toBe('melee');
    finishAction(w, dt);
    const timing = WEAPONS[w.player.weapon.id];
    expect(w.time).toBeCloseTo(timing.windup + timing.active + timing.recovery, 7);
    run(w, 120, { yaw: 1, pitch: 0.4 }, dt);
    expect(w.player.action).toBeNull();
  });
});


const rawIdle: RawFrame = {
  moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, keyYaw: 0, keyPitch: 0,
  fire: false, firePressed: false, selectSlot: null, shield: false, sneak: false,
  inventory: false, bottle: false, interact: false, potion: false, wait: false,
  map: false, escape: false, digit: null,
};

describe('mobile and keyboard merge stays at the existing raw-input boundary', () => {
  it('preserves neutral input and all keyboard values when touch is neutral', () => {
    expect(mergeInput(rawIdle, rawIdle)).toEqual(rawIdle);
    const keyboard = { ...rawIdle, moveX: 1, moveZ: -1, lookDX: 10, lookDY: -3,
      keyYaw: 1, keyPitch: -1, fire: true, firePressed: true, selectSlot: 2, digit: 2,
      shield: true, sneak: true, inventory: true, bottle: true, interact: true,
      potion: true, wait: true, map: true, escape: true };
    expect(mergeInput(keyboard, rawIdle)).toEqual(keyboard);
  });

  it('scales touch look once, sums mouse movement, and retains keyboard rotation', () => {
    expect(mergeInput({ ...rawIdle, lookDX: 8, lookDY: -5, keyYaw: 1, keyPitch: -1 },
      { ...rawIdle, lookDX: 12, lookDY: 3 })).toMatchObject({
      lookDX: 8 + 12 * TOUCH_LOOK_SCALE, lookDY: -5 + 3 * TOUCH_LOOK_SCALE,
      keyYaw: 1, keyPitch: -1, moveX: 0, moveZ: 0, fire: false,
    });
  });

  it('preserves held/edge actions, and touch slot takes precedence in one frame', () => {
    const merged = mergeInput({ ...rawIdle, fire: true, selectSlot: 1, digit: 1, wait: true },
      { ...rawIdle, firePressed: true, fire: true, selectSlot: 3, digit: 3,
        sneak: true, inventory: true, map: true, escape: true, shield: true, bottle: true, interact: true });
    expect(merged).toEqual({ ...rawIdle, fire: true, firePressed: true, selectSlot: 3, digit: 3,
      wait: true, sneak: true, inventory: true, map: true, escape: true, shield: true, bottle: true, interact: true });
  });

  it.each(classes)('hybrid axes clamp then %s World normalizes diagonals without extra speed/time', cls => {
    const merged = mergeInput({ ...rawIdle, moveX: 1, moveZ: 1 }, { ...rawIdle, moveX: 0.7, moveZ: 0.7 });
    expect(merged.moveX).toBe(1);
    expect(merged.moveZ).toBe(1);
    const hybrid = traceMove(cls, { moveX: merged.moveX, moveZ: merged.moveZ });
    const baseline = traceMove(cls, { moveZ: 1 });
    expect(hybrid.distance).toBeCloseTo(baseline.distance, 9);
    expect(hybrid.time).toBeCloseTo(baseline.time, 9);
    const opposed = mergeInput({ ...rawIdle, moveX: 1, moveZ: -1 }, { ...rawIdle, moveX: -1, moveZ: 1 });
    expect(opposed.moveX).toBe(0);
    expect(opposed.moveZ).toBe(0);
  });
});
