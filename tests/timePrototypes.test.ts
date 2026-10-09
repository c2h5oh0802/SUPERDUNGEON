import { describe, expect, it } from 'vitest';
import { PLAYER, TIME } from '../src/config';
import { Rng } from '../src/core/rng';
import { createTrialLevel, trialInfo } from '../src/gen/practiceTrials';
import { validateLevel } from '../src/gen/validate';
import { queueUse } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { fightCleared, ReplayPlayer, ReplayRecorder } from '../src/sim/replay';
import { emptyInput, type FrameInput, type MachineSpawn } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { timeUseSummary } from '../src/ui/timeUse';
import { makeWorld, run } from './helpers';

const DT = 1 / 60;
const corridor = () => createTrialWorld('clockwork-corridor', 'huntress');
const machineWorld = (machines: MachineSpawn[]) => {
  const w = makeWorld();
  (w as unknown as { machines: unknown }).machines = machines.map((m, id) => ({ ...m, id, phase: 'idle', cycle: -1, charge: 0, hitPlayer: false, hitIds: [] }));
  return w;
};
const dart = (over: Partial<MachineSpawn> = {}): MachineSpawn => ({ kind: 'dart', x: 1.02, z: 4.5, dx: 1, dz: 0, start: 0.5, period: 1, warn: 0.4, burn: 0, radius: 0, damage: 2, speed: 7, ...over });
const vent = (over: Partial<MachineSpawn> = {}): MachineSpawn => ({ kind: 'vent', x: 4.5, z: 4.5, dx: 0, dz: 0, start: 0.5, period: 2, warn: 0.5, burn: 0.8, radius: 0.55, damage: 2, speed: 0, ...over });

/** Steer at full walking speed towards a point; true once there. */
function walkTo(w: World, x: number, z: number, maxFrames = 900): boolean {
  for (let f = 0; f < maxFrames; f++) {
    const dx = x - w.player.x, dz = z - w.player.z;
    if (Math.hypot(dx, dz) < 0.12) return true;
    w.frame(DT, { ...emptyInput(Math.atan2(-dx, -dz), 0), moveZ: 1 });
    if (w.player.dead) return false;
  }
  return false;
}
/** Let world time pass at full speed while standing still (the wait key). */
function waitFor(w: World, worldSeconds: number): void {
  const end = w.time + worldSeconds;
  while (w.time < end - 1e-9 && !w.player.dead) w.frame(DT, { ...emptyInput(w.player.yaw, 0), wait: true });
}

describe('clockwork machines run on world time only', () => {
  it('a dart slot warns, then fires a bolt along its line once per period', () => {
    const w = machineWorld([dart()]);
    const fired: number[] = [], warned: number[] = [];
    for (let f = 0; f < 200; f++) {
      run(w, 1, { wait: true });
      for (const e of w.drainEvents()) {
        if (e.type === 'machineFire') fired.push(w.time);
        if (e.type === 'machineWarn') warned.push(w.time);
      }
    }
    expect(fired.length).toBe(3);
    fired.forEach((t, k) => expect(t).toBeCloseTo(0.5 + k, 1));
    expect(warned[0]).toBeCloseTo(0.1, 1);
    const bolt = w.projectiles.find((p) => p.source === '機關箭');
    expect(bolt?.vel.x).toBeCloseTo(7);
    expect(bolt?.vel.z).toBe(0);
  });

  it('standing still, the machines barely move: one real second is one tenth of a cycle', () => {
    const w = machineWorld([dart({ start: 0.05 })]);
    let fired = 0;
    for (let f = 0; f < 120; f++) {
      run(w, 1);
      fired += w.drainEvents().filter((e) => e.type === 'machineFire').length;
    }
    expect(w.time).toBeCloseTo(2 * TIME.idleRate, 2);
    expect(fired).toBe(1);
  });

  it('a fire vent burns whoever stands on it once per eruption, and its flame alone burns nobody', () => {
    const w = machineWorld([vent()]);
    w.player.x = 4.5; w.player.z = 4.5;
    waitFor(w, 0.9);
    expect(w.player.hp).toBe(PLAYER.maxHp - 2);
    expect(w.areas.some((a) => a.kind === 'fire' && a.harmless)).toBe(true);
    waitFor(w, 1.5);
    expect(w.player.hp).toBe(PLAYER.maxHp - 2);
    waitFor(w, 1.2);
    expect(w.player.hp).toBe(PLAYER.maxHp - 4);
    expect(w.stats.damageTaken['噴火口']).toBe(4);
  });

  it('the fireproof glyph ignores vents', () => {
    const w = machineWorld([vent()]);
    w.player.x = 4.5; w.player.z = 4.5; w.player.armor.ench = 'fireproof';
    waitFor(w, 1.4);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('a dart hits the player standing in its line and nobody beside it', () => {
    const w = machineWorld([dart()]);
    w.player.x = 4.5; w.player.z = 4.5;
    waitFor(w, 1.2);
    expect(w.player.hp).toBe(PLAYER.maxHp - 2);
    const v = machineWorld([dart()]);
    v.player.x = 4.5; v.player.z = 5.2;
    waitFor(v, 1.2);
    expect(v.player.hp).toBe(PLAYER.maxHp);
  });
});

describe('prototype: clockwork corridor', () => {
  const route = [
    [4.5, 20.5], [4.5, 17.0], [4.5, 14.0], [4.5, 11.0], [4.5, 10.0], [7.0, 10.0],
    [9.5, 10.0], [11.5, 10.0], [13.5, 10.0], [15.5, 10.0], [17.6, 10.0],
    [20.5, 9.6], [20.5, 7.25], [20.5, 5.35], [20.5, 3.75],
  ] as const;
  /** Waits before each leg (world seconds), then walk the leg at full speed. */
  function travel(waits: number[], legs = waits.length): World {
    const w = corridor();
    w.player.yaw = w.level.spawn.yaw;
    walkTo(w, route[0][0], route[0][1]);
    for (let k = 0; k < legs && !w.player.dead; k++) {
      waitFor(w, waits[k] ?? 0);
      walkTo(w, route[k + 1]![0], route[k + 1]![1]);
    }
    return w;
  }

  it('validates, starts safe, uses only the class starting kit, and the chest is reachable', () => {
    const l = createTrialLevel('clockwork-corridor');
    expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
    expect(l.enemies).toHaveLength(0);
    expect(l.machines!.length).toBeGreaterThan(10);
    const nav = new Nav(l.grid, PLAYER.radius);
    expect(nav.findPath(l.spawn.x, l.spawn.z, 20.5, 3.6)).not.toBeNull();
    const w = corridor();
    expect(w.player.items).toEqual([]);
    expect(w.player.talents).toEqual([]);
    run(w, 600, { wait: true });
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('walking straight through without reading gets hurt', () => {
    const w = travel(route.slice(1).map(() => 0));
    expect(PLAYER.maxHp - w.player.hp).toBeGreaterThanOrEqual(2);
  });

  it('there is a zero-damage line for a player who waits in the safe pockets', () => {
    const waits: number[] = [];
    for (let leg = 0; leg < route.length - 1; leg++) {
      let found = -1;
      for (let wait = 0; wait <= 3.2 && found < 0; wait += 0.1) {
        const w = travel([...waits, wait], leg + 1);
        const there = Math.hypot(w.player.x - route[leg + 1]![0], w.player.z - route[leg + 1]![1]) < 0.2;
        if (there && w.player.hp === PLAYER.maxHp) found = wait;
      }
      expect(found, `leg ${leg} has a safe start time`).toBeGreaterThanOrEqual(0);
      waits.push(found);
    }
    const w = travel(waits);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    // Opening the chest completes the trial.
    w.player.yaw = Math.atan2(-(20.5 - w.player.x), -(2.8 - w.player.z));
    run(w, 1, { interact: true });
    run(w, 120, { wait: true });
    expect(w.stats.chests).toBe(1);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  }, 60000);
});

describe('prototype: crossfire arena', () => {
  it('validates; five enemies, none sees the spawn; the trial kit is given', () => {
    const l = createTrialLevel('crossfire-arena');
    expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
    expect(l.enemies.map((e) => e.kind).sort()).toEqual(['archer', 'archer', 'bomber', 'charger', 'guard']);
    for (const e of l.enemies) expect(l.grid.lineOfSight({ x: e.x, y: e.y + 1.6, z: e.z }, { ...l.spawn, y: PLAYER.eyeHeight })).toBe(false);
    const w = createTrialWorld('crossfire-arena', 'huntress');
    expect(w.player.items.map((i) => i.id)).toEqual(['potion:frost', 'potion:gas']);
    run(w, 600, { wait: true });
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('hits hurt 1.5× (rounded) here and nowhere else', () => {
    const w = createTrialWorld('crossfire-arena', 'warrior');
    w.damagePlayer(3, 'test', 0, 0);
    expect(w.player.hp).toBe(PLAYER.maxHp - 5);
    const classic = createTrialWorld('shield-crossfire', 'warrior');
    classic.damagePlayer(3, 'test', 0, 0);
    expect(classic.player.hp).toBe(PLAYER.maxHp - 3);
    expect(trialInfo('crossfire-arena').replay).toBe(true);
    expect(trialInfo('clockwork-corridor').replay).toBe(false);
  });
});

/** A rough fight: walk in, sweep the view, fire in bursts, drink a potion midway. */
function scriptedFight(cls: 'huntress' | 'warrior', rec: ReplayRecorder): World {
  const w = createTrialWorld('crossfire-arena', cls);
  w.player.yaw = w.level.spawn.yaw;
  const rng = new Rng(`fight-${cls}`);
  let yaw = w.level.spawn.yaw;
  for (let f = 0; f < 2400 && w.outcome === 'none'; f++) {
    if (f === 40) {
      const index = w.player.items.findIndex((i) => i.id === 'potion:frost');
      rec.op({ kind: 'use', index, mode: 'throw' });
      queueUse(w, index, 'throw');
    }
    const dt = [1 / 60, 1 / 30, 1 / 144][f % 3]!;
    if (f % 20 === 0) yaw += (rng.next() - 0.5) * 0.6;
    const idle = f % 240 > 180; // stop and look now and then
    const input: FrameInput = { ...emptyInput(yaw, 0), moveZ: idle ? 0 : 1, moveX: idle ? 0 : f % 90 < 45 ? 0.5 : -0.5, fire: !idle && f % 40 < 20, firePressed: !idle && f % 40 === 0 };
    w.frame(dt, input);
    rec.frame(w, dt, input);
    w.drainEvents();
  }
  return w;
}

describe('replay re-simulates the fight from the record', () => {
  it.each(['huntress', 'warrior'] as const)('%s: a fresh world fed the record ends in the same state', (cls) => {
    const rec = new ReplayRecorder();
    const w = scriptedFight(cls, rec);
    expect(rec.combatStart).not.toBeNull();
    expect(rec.frames.some((f) => f.ops.length > 0)).toBe(true);
    const make = () => { const r = createTrialWorld('crossfire-arena', cls); r.player.yaw = r.level.spawn.yaw; return r; };
    const r = new ReplayPlayer(make, rec, 0, rec.endTime);
    while (!r.prepare(1000));
    for (let n = 0; n < 200000 && !r.done; n++) { r.advance(DT); r.world.drainEvents(); }
    expect(r.diverged).toBe(false);
    expect(r.world.time).toBe(w.time);
    expect([r.world.player.x, r.world.player.z, r.world.player.hp]).toEqual([w.player.x, w.player.z, w.player.hp]);
    expect(r.world.enemies.map((e) => [e.alive, e.hp, e.x, e.z])).toEqual(w.enemies.map((e) => [e.alive, e.hp, e.x, e.z]));
  });

  it('a different starting world is caught as divergence instead of shown', () => {
    const rec = new ReplayRecorder();
    scriptedFight('huntress', rec);
    const r = new ReplayPlayer(() => createTrialWorld('crossfire-arena', 'warrior'), rec, 0, rec.endTime);
    while (!r.prepare(1000));
    for (let n = 0; n < 200000 && !r.done; n++) r.advance(DT);
    expect(r.diverged).toBe(true);
  });

  it('plays at world-time speed: stopped-to-think stretches shrink to their world time', () => {
    const rec = new ReplayRecorder();
    const w = createTrialWorld('crossfire-arena', 'huntress');
    w.player.yaw = w.level.spawn.yaw;
    const step = (input: FrameInput) => { w.frame(DT, input); rec.frame(w, DT, input); };
    for (let f = 0; f < 180; f++) step(emptyInput(w.player.yaw, 0)); // 3 real seconds standing still
    for (let f = 0; f < 60; f++) step({ ...emptyInput(w.player.yaw, 0), moveZ: 1 }); // 1 real second walking
    expect(w.time).toBeLessThan(1.4);
    const r = new ReplayPlayer(() => { const x = createTrialWorld('crossfire-arena', 'huntress'); x.player.yaw = x.level.spawn.yaw; return x; }, rec, 0, rec.endTime);
    while (!r.prepare(1000));
    let real = 0;
    while (!r.done && real < 10) { r.advance(DT); real += DT; }
    expect(real).toBeCloseTo(w.time, 1);
    expect(real).toBeLessThan(2);
  });

  it('the replay is due only once every enemy is down, the record is clean and the run goes on', () => {
    const w = createTrialWorld('crossfire-arena', 'huntress');
    const rec = new ReplayRecorder();
    expect(fightCleared(w, rec)).toBe(false);
    for (const e of w.enemies.slice(1)) e.alive = false;
    expect(fightCleared(w, rec)).toBe(false);
    w.enemies[0]!.alive = false;
    expect(fightCleared(w, rec)).toBe(true);
    expect(fightCleared(w, null)).toBe(false);
    rec.tainted = true;
    expect(fightCleared(w, rec)).toBe(false);
    rec.tainted = false;
    w.outcome = 'dead';
    expect(fightCleared(w, rec)).toBe(false);
    expect(fightCleared(corridor(), new ReplayRecorder())).toBe(false);
  });

  it('the window starts just before the fight and is capped', () => {
    const rec = new ReplayRecorder();
    scriptedFight('huntress', rec);
    const { from, to } = rec.window();
    expect(from).toBeCloseTo(Math.max(0, rec.combatStart! - 1), 6);
    expect(to).toBe(rec.endTime);
    expect(rec.window(1).from).toBeCloseTo(rec.endTime - 1, 6);
  });
});

describe('stop-to-read measurement', () => {
  it('counts slow-world real time as stopped, and the combat share only while hunted', () => {
    const w = createTrialWorld('crossfire-arena', 'huntress');
    run(w, 60);
    expect(w.timeUse.real).toBeCloseTo(1, 5);
    expect(w.timeUse.still).toBeCloseTo(1, 5);
    expect(w.timeUse.combatReal).toBe(0);
    run(w, 60, { moveZ: 1 });
    expect(w.timeUse.real).toBeCloseTo(2, 5);
    expect(w.timeUse.still).toBeLessThan(1.2);
    run(w, 60); // let the walk decelerate to a standstill
    // Hunted for a while (the AI may drop the state again a few frames later).
    w.enemies[0]!.state = 'alert';
    run(w, 30);
    expect(w.timeUse.combatReal).toBeGreaterThan(0);
    expect(w.timeUse.combatStill).toBe(w.timeUse.combatReal);
    expect(timeUseSummary(w)).toMatch(/^戰鬥中停下來看：100%（/);
    expect(timeUseSummary(corridor())).toBe('停下來看：0%（0 / 0 秒）');
  });
});
