import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, PROJECTILES, QUICK, VOLLEY } from '../src/config';
import { Rng } from '../src/core/rng';
import { createTrialLevel, trialInfo } from '../src/gen/practiceTrials';
import { validateLevel } from '../src/gen/validate';
import { yawFromDir } from '../src/core/math';
import { returnBolt } from '../src/sim/classSys';
import { archerAimPoint, becomeAlert } from '../src/sim/enemySys';
import { fireProjectile } from '../src/sim/playerSys';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { gainXp } from '../src/sim/progress';
import { fightCleared, ReplayPlayer, ReplayRecorder } from '../src/sim/replay';
import { emptyInput, type FrameInput } from '../src/sim/types';
import { World } from '../src/sim/world';
import { run, testLevel } from './helpers';

const DT = 1 / 60;
const v4 = (cls: 'huntress' | 'warrior' = 'huntress') => createTrialWorld('crossfire-quick', cls);
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

describe('prototype: crossfire v5 (too fast to read at normal speed; every crossbowman leads)', () => {
  it('same arena and first wave as v2, two waves, quick threats, hits hurt 2.5x, no instruction to stop', () => {
    const l = createTrialLevel('crossfire-quick');
    expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
    expect(l.enemies.map((e) => [e.kind, e.hp])).toEqual(createTrialLevel('crossfire-waves').enemies.map((e) => [e.kind, e.hp]));
    for (const e of l.enemies) expect(l.grid.lineOfSight({ x: e.x, y: e.y + 1.6, z: e.z }, { ...l.spawn, y: PLAYER.eyeHeight })).toBe(false);
    expect(l.waves).toHaveLength(1);
    expect(l.waves![0]!.time).toBe(12);
    expect(l.rules).toEqual({ smartFire: true, syncVolley: true, staggerVolley: true, quickThreats: true, noLevelUp: true, redirect: true });
    // Every crossbowman leads the player's movement.
    expect(l.enemies.filter((e) => e.kind === 'archer').map((e) => [e.x, !!e.leads])).toEqual([[4.5, true], [20.5, true]]);
    expect(l.waves![0]!.spawns.filter((e) => e.kind === 'archer').map((e) => !!e.leads)).toEqual([true]);
    expect(createTrialLevel('crossfire-waves').enemies.some((e) => e.leads)).toBe(false);
    expect(l.damageMul).toBe(2.5);
    expect(trialInfo('crossfire-quick').replay).toBe(true);
    // The situation, not the hint, should make the player stop.
    expect(trialInfo('crossfire-quick').hint).not.toContain('停下來');
  });

  it('two bolts drop the player; a charge or a rat bite hurts 10 and 3', () => {
    const w = v4();
    expect(w.armorReduce()).toBe(0);
    w.damagePlayer(PROJECTILES.bolt.damage, 'test', 0, 0);
    expect(w.player.hp).toBe(PLAYER.maxHp - 5);
    w.damagePlayer(PROJECTILES.bolt.damage, 'test', 0, 0);
    expect(w.player.hp).toBeLessThanOrEqual(0);
    const c = v4();
    c.damagePlayer(ENEMIES.charger.damage, 'test', 0, 0);
    expect(c.player.hp).toBe(PLAYER.maxHp - 10);
    const r = v4();
    r.damagePlayer(ENEMIES.rat.damage, 'test', 0, 0);
    expect(r.player.hp).toBe(PLAYER.maxHp - 3);
  });

  it('no level-ups: max HP stays, so two bolts still drop the player in the second wave', () => {
    const w = v4();
    w.drainEvents();
    gainXp(w, 10_000);
    expect([w.player.level, w.player.xp, w.player.maxHp, w.player.hp]).toEqual([1, 0, PLAYER.maxHp, PLAYER.maxHp]);
    expect(w.drainEvents().some((e) => e.type === 'levelUp')).toBe(false);
    const v = v2();
    gainXp(v, 10_000);
    expect(v.player.level).toBeGreaterThan(1);
  });

  it('a locked bolt lands in under half a second at normal speed, over four when the player stands still', () => {
    const quickWait = lockToHit(v4, 'wait');
    const quickStill = lockToHit(v4, 'still');
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
    expect(speedOf(v4())).toBeCloseTo(QUICK.boltSpeed, 5);
    expect(speedOf(v2())).toBeCloseTo(PROJECTILES.bolt.speed, 5);
  });

  it('the charger charges at the quick speed', () => {
    const w = v4();
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
    const w = v4();
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

    const t = v4();
    t.player.x = 6.5; t.player.z = 19.5; // safe in the start corridor
    for (let f = 0; f < 3000 && t.time < 11.5; f++) run(t, 1, { wait: true });
    expect(t.wavesSpawned).toBe(0);
    for (let f = 0; f < 120 && t.time < 12.5; f++) run(t, 1, { wait: true });
    expect(t.wavesSpawned).toBe(1);
  });

  it('a fight through the second wave replays in full from the record to the same end', () => {
    const make = () => { const x = v4(); x.player.yaw = x.level.spawn.yaw; return x; };
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

/** One crossbowman (0 west, 1 east; both lead in v5) alone and hunting, no more waves. */
function only(w: World, which: 0 | 1): World['enemies'][number] {
  const a = w.enemies[which]!;
  for (const e of w.enemies) if (e !== a) { e.alive = false; e.hp = 0; }
  w.wavesSpawned = w.level.waves?.length ?? 0;
  becomeAlert(w, a);
  return a;
}

/** Open ground (30 x 14) with one ground crossbowman in the north, quick threats on; optionally a pillar at (13.5, 8.5). */
function openGround(leads: boolean, pillar = false): World {
  const rows: string[] = [];
  for (let z = 0; z < 14; z++) {
    let r = '';
    for (let x = 0; x < 30; x++) r += x === 0 || z === 0 || x === 29 || z === 13 ? '#' : pillar && x === 13 && z === 8 ? 'o' : x === 4 && z === 11 ? '@' : '.';
    rows.push(r);
  }
  const w = new World({ ...testLevel(rows, [{ kind: 'archer', x: 15, z: 2.5, leads }]), rules: { quickThreats: true } }, { cls: 'huntress' });
  w.player.hp = 1e6;
  becomeAlert(w, w.enemies[0]!);
  return w;
}

/**
 * The player runs east and west 8.5 m from the crossbowman (turning only at the ends, about 4.9 s a leg),
 * stands still, or runs and stops for 0.6 s whenever it locks. Bolts hit / fired over 60 world seconds.
 */
function crossing(leads: boolean, mode: 'run' | 'stand' | 'stopOnLock') {
  const w = openGround(leads);
  const a = w.enemies[0]!;
  let fired = 0, hits = 0, dir = 1, stopUntil = -1, seen = false;
  for (let f = 0; f < 60 * 300 && w.time < 60; f++) {
    if (w.player.x > 26) dir = -1; else if (w.player.x < 4) dir = 1;
    const stop = mode === 'stand' || (mode === 'stopOnLock' && w.time < stopUntil);
    w.frame(DT, { ...emptyInput(0, 0), moveX: stop ? 0 : dir, wait: stop });
    if (a.locked && a.phase === 'aim' && !seen) { seen = true; stopUntil = w.time + 0.6; }
    if (a.phase !== 'aim') seen = false;
    for (const e of w.drainEvents()) { if (e.type === 'enemyFire') fired++; if (e.type === 'playerHurt') hits++; }
  }
  return { fired, hits };
}


/** Aim the player at a point (eye height) and loose an arrow or stone. */
function shootAt(w: World, x: number, y: number, z: number, kind: 'bow' | 'stone' = 'bow'): void {
  const p = w.player;
  p.yaw = yawFromDir(x - p.x, z - p.z);
  p.pitch = Math.atan2(y - 1.5, Math.hypot(x - p.x, z - p.z));
  fireProjectile(w, kind);
}

describe('crossfire v5: every crossbowman leads, volleys lock one after another', () => {
  it('a leading crossbowman hits a steady runner; stopping at the lock beats it; standing still does not', () => {
    const running = crossing(true, 'run'), stand = crossing(true, 'stand'), stop = crossing(true, 'stopOnLock');
    const direct = crossing(false, 'run');
    expect(running.fired).toBeGreaterThan(5);
    expect(running.hits / running.fired).toBeGreaterThanOrEqual(0.7);
    expect(stand.hits).toBe(stand.fired);
    expect(stop.fired).toBeGreaterThan(5);
    expect(stop.hits).toBe(0);
    // A crossbowman that aims where the player stands misses the same runner.
    expect(direct.hits / direct.fired).toBeLessThanOrEqual(0.2);
  });

  it('when cover hides the predicted spot, it aims at the player instead of giving up', () => {
    for (const pillar of [false, true]) {
      const w = openGround(true, pillar);
      const a = w.enemies[0]!;
      w.player.x = 10.5; w.player.z = 11.5;
      w.playerWorldVel = { x: 4.5, z: 0 };
      a.yaw = yawFromDir(w.player.x - a.x, w.player.z - a.z);
      const aim = archerAimPoint(w, a);
      if (pillar) expect([aim.x, aim.z]).toEqual([10.5, 11.5]);
      else expect(aim.x).toBeGreaterThan(12);
    }
  });

  it('in a volley the second crossbowman locks a beat after the first', () => {
    const w = v4();
    const archers = w.enemies.filter((e) => e.kind === 'archer');
    for (const e of w.enemies) if (e.kind !== 'archer') { e.alive = false; e.hp = 0; }
    w.wavesSpawned = 1;
    w.player.x = 12.5; w.player.z = 7.5; w.player.hp = 1e6;
    for (const a of archers) becomeAlert(w, a);
    const lockedAt = new Map<number, number>();
    for (let f = 0; f < 3000 && lockedAt.size < 2; f++) {
      run(w, 1, { wait: true });
      for (const a of archers) if (a.locked && a.phase === 'aim' && !lockedAt.has(a.id)) lockedAt.set(a.id, w.time);
    }
    const [t1, t2] = [...lockedAt.values()].sort((x, y) => x - y);
    expect(t2! - t1!).toBeCloseTo(VOLLEY.stagger, 1);
  });

  it('no armour: an arrow drops a crossbowman', () => {
    const w = v4();
    const a = only(w, 1);
    w.player.x = 12.5; w.player.z = 7.5;
    shootAt(w, a.x, a.y + 1.2, a.z);
    run(w, 30, { wait: true });
    expect(a.alive).toBe(false);
  });
});

describe('crossfire v5: bolts turned back on their shooters', () => {
  it('the Huntress shoots an incoming bolt and it flies back at its shooter: a turned-fire kill', () => {
    const w = v4();
    const a = only(w, 1);
    w.player.x = 12.5; w.player.z = 7.5; w.player.hp = 1e6;
    w.drainEvents();
    const seen: string[] = [];
    let shot = false;
    for (let f = 0; f < 6000 && a.alive; f++) {
      w.frame(DT, emptyInput(w.player.yaw, w.player.pitch));
      const bolt = w.projectiles.find((q) => q.alive && q.kind === 'bolt' && q.owner === a.id);
      if (bolt && !shot) { shootAt(w, bolt.pos.x, bolt.pos.y, bolt.pos.z); shot = true; }
      for (const e of w.drainEvents()) seen.push(`${e.type}:${e.source ?? ''}`);
    }
    expect(shot).toBe(true);
    expect(a.alive).toBe(false);
    expect(seen).toContain('deflect:');
    expect(seen).toContain('redirectKill:deflect');
    expect(seen.some((s) => s.startsWith('playerHurt'))).toBe(false);
    // Without the rule the arrow flies past the bolt.
    const c = v2();
    const b = only(c, 1);
    c.player.x = 12.5; c.player.z = 7.5; c.player.hp = 1e6;
    let deflects = 0, cShot = false;
    for (let f = 0; f < 6000 && !cShot; f++) {
      c.frame(DT, emptyInput(c.player.yaw, c.player.pitch));
      const bolt = c.projectiles.find((q) => q.alive && q.kind === 'bolt' && q.owner === b.id);
      if (bolt) { shootAt(c, bolt.pos.x, bolt.pos.y, bolt.pos.z); cShot = true; }
    }
    run(c, 60, { wait: true });
    for (const e of c.drainEvents()) if (e.type === 'deflect') deflects++;
    expect(deflects).toBe(0);
  });

  it('a bolt the Warrior bats back drops a crossbowman as a turned-fire kill', () => {
    const w = v4('warrior');
    const a = only(w, 1);
    w.player.x = 12.5; w.player.z = 7.5; w.player.hp = 1e6;
    let bolt: World['projectiles'][number] | undefined;
    for (let f = 0; f < 6000 && !bolt; f++) {
      w.frame(DT, emptyInput(w.player.yaw, 0));
      bolt = w.projectiles.find((q) => q.alive && q.kind === 'bolt' && q.owner === a.id);
    }
    expect(bolt).toBeDefined();
    const d = { x: a.x - bolt!.pos.x, y: a.y + 1.1 - bolt!.pos.y, z: a.z - bolt!.pos.z };
    const len = Math.hypot(d.x, d.y, d.z);
    w.drainEvents();
    returnBolt(w, bolt!, { x: d.x / len, y: d.y / len, z: d.z / len });
    run(w, 60, { wait: true });
    expect(a.alive).toBe(false);
    expect(w.drainEvents().some((e) => e.type === 'redirectKill' && e.source === 'deflect')).toBe(true);
  });
});
