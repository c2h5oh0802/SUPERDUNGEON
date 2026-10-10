import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, PROJECTILES, QUICK } from '../src/config';
import { Rng } from '../src/core/rng';
import { createTrialLevel, trialInfo } from '../src/gen/practiceTrials';
import { validateLevel } from '../src/gen/validate';
import { becomeAlert } from '../src/sim/enemySys';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { gainXp } from '../src/sim/progress';
import { fightCleared, ReplayPlayer, ReplayRecorder } from '../src/sim/replay';
import { emptyInput, type FrameInput } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { run } from './helpers';

const DT = 1 / 60;
const v3 = () => createTrialWorld('crossfire-quick', 'huntress');
const v2 = () => createTrialWorld('crossfire-waves', 'huntress');

/** The western crossbowman alone and hunting, no more waves, the player in its view about 8 m away. */
function alone(w: World): World {
  const archer = w.enemies[0]!;
  for (const e of w.enemies) if (e !== archer) { e.alive = false; e.hp = 0; }
  w.wavesSpawned = w.level.waves?.length ?? 0;
  w.player.x = 12.5; w.player.z = 7.5;
  becomeAlert(w, archer);
  return w;
}

/**
 * One crossbowman alone, the player standing in its view about 8 m away. Returns
 * the real seconds from the moment its aim locks to the bolt landing, with the
 * player either standing still (slow world) or holding wait (normal speed).
 */
function lockToHit(make: () => World, hold: 'still' | 'wait'): number {
  const w = alone(make());
  const archer = w.enemies[0]!;
  w.drainEvents();
  let locked = -1;
  for (let f = 0; f < 6000; f++) {
    w.frame(DT, { ...emptyInput(w.player.yaw, 0), wait: hold === 'wait' });
    if (locked < 0 && archer.phase === 'aim' && archer.locked) locked = f;
    if (w.drainEvents().some((e) => e.type === 'playerHurt' && e.source === '弩手的弩矢')) return locked < 0 ? -1 : (f - locked) * DT;
  }
  return -1;
}

describe('prototype: crossfire v3 (too fast to read at normal speed)', () => {
  it('same arena and first wave as v2, two waves, quick threats, hits hurt 2.5x, no instruction to stop', () => {
    const l = createTrialLevel('crossfire-quick');
    expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
    expect(l.enemies.map((e) => [e.kind, e.hp])).toEqual(createTrialLevel('crossfire-waves').enemies.map((e) => [e.kind, e.hp]));
    for (const e of l.enemies) expect(l.grid.lineOfSight({ x: e.x, y: e.y + 1.6, z: e.z }, { ...l.spawn, y: PLAYER.eyeHeight })).toBe(false);
    expect(l.waves).toHaveLength(1);
    expect(l.waves![0]!.time).toBe(12);
    expect(l.rules).toEqual({ smartFire: true, syncVolley: true, quickThreats: true, noLevelUp: true });
    expect(l.damageMul).toBe(2.5);
    expect(trialInfo('crossfire-quick').replay).toBe(true);
    // The situation, not the hint, should make the player stop.
    expect(trialInfo('crossfire-quick').hint).not.toContain('停下來');
  });

  it('two bolts drop the player; a charge or a rat bite hurts 10 and 3', () => {
    const w = v3();
    expect(w.armorReduce()).toBe(0);
    w.damagePlayer(PROJECTILES.bolt.damage, 'test', 0, 0);
    expect(w.player.hp).toBe(PLAYER.maxHp - 5);
    w.damagePlayer(PROJECTILES.bolt.damage, 'test', 0, 0);
    expect(w.player.hp).toBeLessThanOrEqual(0);
    const c = v3();
    c.damagePlayer(ENEMIES.charger.damage, 'test', 0, 0);
    expect(c.player.hp).toBe(PLAYER.maxHp - 10);
    const r = v3();
    r.damagePlayer(ENEMIES.rat.damage, 'test', 0, 0);
    expect(r.player.hp).toBe(PLAYER.maxHp - 3);
  });

  it('no level-ups: max HP stays, so two bolts still drop the player in the second wave', () => {
    const w = v3();
    w.drainEvents();
    gainXp(w, 10_000);
    expect([w.player.level, w.player.xp, w.player.maxHp, w.player.hp]).toEqual([1, 0, PLAYER.maxHp, PLAYER.maxHp]);
    expect(w.drainEvents().some((e) => e.type === 'levelUp')).toBe(false);
    const v = v2();
    gainXp(v, 10_000);
    expect(v.player.level).toBeGreaterThan(1);
  });

  it('a locked bolt lands in under half a second at normal speed, over four when the player stands still', () => {
    const quickWait = lockToHit(v3, 'wait');
    const quickStill = lockToHit(v3, 'still');
    const v2Wait = lockToHit(v2, 'wait');
    expect(quickWait).toBeGreaterThan(0);
    expect(quickWait).toBeLessThan(0.5);
    expect(quickStill).toBeGreaterThan(3.5);
    // Without the rule the same shot leaves about 0.7 s.
    expect(v2Wait).toBeGreaterThan(0.6);
  });

  it('bolts fly at the quick speed only under the rule', () => {
    const speedOf = (w: World) => {
      alone(w);
      for (let f = 0; f < 600; f++) {
        run(w, 1, { wait: true });
        const b = w.projectiles.find((q) => q.alive && q.kind === 'bolt');
        if (b) return Math.hypot(b.vel.x, b.vel.y, b.vel.z);
      }
      return -1;
    };
    expect(speedOf(v3())).toBeCloseTo(QUICK.boltSpeed, 5);
    expect(speedOf(v2())).toBeCloseTo(PROJECTILES.bolt.speed, 5);
  });

  it('the charger charges at the quick speed', () => {
    const w = v3();
    for (const e of w.enemies) { e.alive = false; e.hp = 0; }
    run(w, 1, { wait: true });
    expect(w.wavesSpawned).toBe(1);
    const charger = w.enemies.find((e) => e.alive && e.kind === 'charger')!;
    for (const e of w.enemies) if (e !== charger) { e.alive = false; e.hp = 0; }
    w.player.x = 8; w.player.z = charger.z;
    let speed = -1;
    for (let f = 0; f < 600 && speed < 0; f++) {
      const before = charger.phase === 'charge' ? { x: charger.x, z: charger.z } : null;
      const dt = w.frame(DT, { ...emptyInput(w.player.yaw, 0), wait: true });
      if (before && charger.phase === 'charge') speed = Math.hypot(charger.x - before.x, charger.z - before.z) / dt;
    }
    expect(speed).toBeCloseTo(QUICK.chargeSpeed, 3);
  });

  it('the second wave comes once at most one enemy is left, or 12 world seconds in; then the fight can clear', () => {
    const w = v3();
    const rec = new ReplayRecorder();
    for (const e of w.enemies.slice(1)) e.alive = false;
    w.drainEvents();
    run(w, 1, { wait: true });
    expect(w.wavesSpawned).toBe(1);
    expect(w.enemies.slice(5).map((e) => e.kind).sort()).toEqual(['archer', 'bomber', 'charger', 'rat', 'rat']);
    expect(w.drainEvents().some((e) => e.type === 'wave' && e.text === '第二波：四面八方')).toBe(true);
    expect(fightCleared(w, rec)).toBe(false);
    for (const e of w.enemies) e.alive = false;
    expect(w.wavesLeft).toBe(0);
    expect(fightCleared(w, rec)).toBe(true);

    const t = v3();
    t.player.x = 6.5; t.player.z = 19.5; // safe in the start corridor
    for (let f = 0; f < 3000 && t.time < 11.5; f++) run(t, 1, { wait: true });
    expect(t.wavesSpawned).toBe(0);
    for (let f = 0; f < 120 && t.time < 12.5; f++) run(t, 1, { wait: true });
    expect(t.wavesSpawned).toBe(1);
  });

  it('a fight through the second wave replays in full from the record to the same end', () => {
    const make = () => { const x = v3(); x.player.yaw = x.level.spawn.yaw; return x; };
    const w = make();
    const rec = new ReplayRecorder();
    const rng = new Rng('quick-fight');
    let yaw = w.level.spawn.yaw;
    // Hold wait in the start corridor until the second wave comes in hunting, then strafe and shoot.
    for (let f = 0; f < 6000 && w.outcome === 'none' && w.time < 24; f++) {
      const dt = [1 / 60, 1 / 30, 1 / 144][f % 3]!;
      if (f % 20 === 0) yaw += (rng.next() - 0.5) * 0.6;
      const fight = w.wavesSpawned > 0;
      const input: FrameInput = { ...emptyInput(yaw, 0), wait: !fight, moveX: fight ? (f % 90 < 45 ? 0.5 : -0.5) : 0, fire: fight && f % 40 < 20, firePressed: fight && f % 40 === 0 };
      w.frame(dt, input);
      rec.frame(w, dt, input);
      w.drainEvents();
    }
    expect(w.wavesSpawned).toBe(1);
    const r = new ReplayPlayer(make, rec, 0, rec.endTime);
    while (!r.prepare(1000));
    for (let n = 0; n < 200000 && !r.done; n++) { r.advance(DT); r.world.drainEvents(); }
    expect(r.diverged).toBe(false);
    expect(r.world.time).toBe(w.time);
    expect([r.world.player.x, r.world.player.z, r.world.player.hp]).toEqual([w.player.x, w.player.z, w.player.hp]);
    expect(r.world.enemies.map((e) => [e.kind, e.alive, e.hp, e.x, e.z])).toEqual(w.enemies.map((e) => [e.kind, e.alive, e.hp, e.x, e.z]));
  });
});
