import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, PROJECTILES, QUICK } from '../src/config';
import { Rng } from '../src/core/rng';
import { createTrialLevel, trialInfo } from '../src/gen/practiceTrials';
import { validateLevel } from '../src/gen/validate';
import { yawFromDir } from '../src/core/math';
import { returnBolt } from '../src/sim/classSys';
import { becomeAlert, damageEnemy } from '../src/sim/enemySys';
import { fireProjectile } from '../src/sim/playerSys';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { gainXp } from '../src/sim/progress';
import { fightCleared, ReplayPlayer, ReplayRecorder } from '../src/sim/replay';
import { emptyInput, type FrameInput } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { run } from './helpers';

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

describe('prototype: crossfire v4 (too fast to read at normal speed; crossbowmen fall only to their own fire)', () => {
  it('same arena and first wave as v2, two waves, quick threats, hits hurt 2.5x, no instruction to stop', () => {
    const l = createTrialLevel('crossfire-quick');
    expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
    expect(l.enemies.map((e) => [e.kind, e.hp])).toEqual(createTrialLevel('crossfire-waves').enemies.map((e) => [e.kind, e.hp]));
    for (const e of l.enemies) expect(l.grid.lineOfSight({ x: e.x, y: e.y + 1.6, z: e.z }, { ...l.spawn, y: PLAYER.eyeHeight })).toBe(false);
    expect(l.waves).toHaveLength(1);
    expect(l.waves![0]!.time).toBe(12);
    expect(l.rules).toEqual({ smartFire: true, syncVolley: true, quickThreats: true, noLevelUp: true, redirect: true });
    // Mixed volley: the western crossbowmen lead, the eastern one aims where the player stands.
    expect(l.enemies.filter((e) => e.kind === 'archer').map((e) => [e.x, !!e.leads])).toEqual([[4.5, true], [20.5, false]]);
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

/** One crossbowman (0 west, leads; 1 east, direct) alone and hunting, no more waves. */
function only(w: World, which: 0 | 1): World['enemies'][number] {
  const a = w.enemies[which]!;
  for (const e of w.enemies) if (e !== a) { e.alive = false; e.hp = 0; }
  w.wavesSpawned = w.level.waves?.length ?? 0;
  becomeAlert(w, a);
  return a;
}

/**
 * The player runs north and south on open ground in view (turning only at the ends),
 * stands still, or runs and stops for 0.6 s whenever the crossbowman locks.
 * Returns bolts hit / fired over 40 world seconds and the aim's distance from the player at each lock.
 */
function lane(which: 0 | 1, mode: 'run' | 'stand' | 'stopOnLock') {
  const w = v4();
  const a = only(w, which);
  w.player.x = 12.5; w.player.z = 4; w.player.hp = 1e6;
  let fired = 0, hits = 0, dir = 1, lockAt = -1;
  const gaps: number[] = [];
  for (let f = 0; f < 60 * 200 && w.time < 40; f++) {
    if (w.player.z > 8.5) dir = -1; else if (w.player.z < 3.8) dir = 1;
    const stop = mode === 'stand' || (mode === 'stopOnLock' && lockAt >= 0 && w.time - lockAt < 0.6);
    w.frame(DT, { ...emptyInput(Math.PI, 0), moveZ: stop ? 0 : dir, wait: stop });
    if (a.locked && a.phase === 'aim' && lockAt < 0) { lockAt = w.time; gaps.push(Math.hypot(a.aimPoint!.x - w.player.x, a.aimPoint!.z - w.player.z)); }
    if (a.phase !== 'aim') lockAt = -1;
    for (const e of w.drainEvents()) { if (e.type === 'enemyFire') fired++; if (e.type === 'playerHurt') hits++; }
  }
  return { fired, hits, gaps };
}

/** Aim the player at a point (eye height) and loose an arrow or stone. */
function shootAt(w: World, x: number, y: number, z: number, kind: 'bow' | 'stone' = 'bow'): void {
  const p = w.player;
  p.yaw = yawFromDir(x - p.x, z - p.z);
  p.pitch = Math.atan2(y - 1.5, Math.hypot(x - p.x, z - p.z));
  fireProjectile(w, kind);
}

describe('crossfire v4: mixed volley (leading and direct crossbowmen)', () => {
  it('a leading crossbowman locks about 2 m ahead of a running player, a direct one on it; standing still both aim at it', () => {
    const lead = lane(0, 'run'), direct = lane(1, 'run');
    expect(lead.gaps.length).toBeGreaterThan(2);
    for (const g of lead.gaps) expect(g).toBeGreaterThan(1.2);
    for (const g of direct.gaps) expect(g).toBeLessThan(0.3);
    for (const g of lane(0, 'stand').gaps) expect(g).toBeLessThan(0.05);
  });

  it('the two need opposite answers: running beats the direct one, stopping at the lock beats the leading one, standing still beats neither', () => {
    const leadStand = lane(0, 'stand'), directStand = lane(1, 'stand');
    expect(leadStand.hits).toBe(leadStand.fired);
    expect(directStand.hits).toBe(directStand.fired);
    const directRun = lane(1, 'run'), leadRun = lane(0, 'run'), leadStop = lane(0, 'stopOnLock');
    expect(directRun.hits / directRun.fired).toBeLessThan(0.3);
    expect(leadRun.hits / leadRun.fired).toBeGreaterThanOrEqual(0.5);
    expect(leadStop.fired).toBeGreaterThan(2);
    expect(leadStop.hits).toBe(0);
  });
});

describe('crossfire v4: crossbowmen fall only to fire turned back on them', () => {
  it('arrows bounce off crossbow armour (clink, arrow on the floor); a blade does nothing', () => {
    const w = v4();
    const a = only(w, 1);
    w.player.x = 12.5; w.player.z = 7.5;
    w.drainEvents();
    shootAt(w, a.x, a.y + 1.2, a.z);
    run(w, 30, { wait: true });
    expect(a.alive).toBe(true);
    expect(a.hp).toBe(2);
    expect(w.drainEvents().some((e) => e.type === 'helmet' && e.kind === 'archer')).toBe(true);
    damageEnemy(w, a, 4, { source: 'melee', sneak: false, head: false, x: a.x, y: 1, z: a.z });
    expect(a.hp).toBe(2);
    // Without the rule the same arrow drops a crossbowman.
    const c = v2();
    const b = only(c, 1);
    c.player.x = 12.5; c.player.z = 7.5;
    shootAt(c, b.x, b.y + 1.2, b.z);
    run(c, 30, { wait: true });
    expect(b.alive).toBe(false);
  });

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
