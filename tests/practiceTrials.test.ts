import { describe, expect, it } from 'vitest';
import { CLASSES, CLASS_KNOWLEDGE, ENEMIES, PLAYER, RUN } from '../src/config';
import { forwardFromYaw, yawFromDir } from '../src/core/math';
import { archerLineClear } from '../src/sim/enemySys';
import { levelSignature } from '../src/gen/generator';
import { createTrialLevel, PRACTICE_TRIALS, trialForSeed } from '../src/gen/practiceTrials';
import { generateLevel, validateLevel } from '../src/gen/validate';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { createFloorWorld, newRun, parseRun, serializeRun } from '../src/sim/run';
import { isKnown, itemName, queueUse } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { emptyInput } from '../src/sim/types';
import { finishAction, run } from './helpers';

// The Warden uses the actual campaign arena and starting kit, tested separately.
for (const trial of PRACTICE_TRIALS.filter(t => t.id !== 'heart-warden')) describe(trial.id, () => {
  it('validates, has safe spawn and connected flanking space, uses base enemies', () => {
    const l = createTrialLevel(trial.id), w = createTrialWorld(trial.id, 'huntress');
    expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
    expect(l.practice).toBe(true); expect(l.practiceTrial).toBe(trial.id);
    expect(l.encounter).toBeUndefined(); expect(l.resupply).toBeNull(); expect(l.traps).toHaveLength(0);
    const nav = new Nav(l.grid, PLAYER.radius), seen = nav.flood(l.spawn.x, l.spawn.z, false);
    for (const e of w.enemies) {
      expect(e.hp).toBe(ENEMIES[e.kind].hp); expect(e.veteran).toBe(false); expect(e.boss).toBe(false);
      expect(l.grid.lineOfSight({ x: e.x, y: e.y + 1.6, z: e.z }, { ...l.spawn, y: PLAYER.eyeHeight })).toBe(false);
      if (!e.perched) expect(seen[nav.nearestPassable(e.x, e.z)]).toBe(1);
    }
    for (const p of [{ x: 5.5, z: 4.5 }, { x: 13.5, z: 15.5 }]) {
      expect(l.grid.circleBlocked(p.x, p.z, PLAYER.radius)).toBe(false);
      expect(nav.findPath(l.spawn.x, l.spawn.z, p.x, p.z)).not.toBeNull();
    }
    run(w, 120, { wait: true });
    expect(w.player.hp).toBe(PLAYER.maxHp); expect(w.stats.damageTaken).toEqual({});
  });
  it.each(['huntress', 'warrior'] as const)('fresh %s retry restores state without changing layout', cls => {
    const a = createTrialWorld(trial.id, cls), signature = levelSignature(a.level);
    a.player.hp = 1; a.player.arrows = 0; a.player.items.length = 0;
    a.player.known.push('potion:haste'); a.enemies[0]!.alive = false;
    a.time = 80; a.player.hunger = 80;
    const b = createTrialWorld(trial.id, cls);
    expect(levelSignature(b.level)).toBe(signature); expect(b.player.hp).toBe(PLAYER.maxHp);
    expect(b.player.arrows).toBe(CLASSES[cls].start.arrows);
    expect(b.player.hunger).toBe(0); expect(b.time).toBe(0);
    expect(b.enemies.every(e => e.alive && e.lastKnown === null && e.target === null)).toBe(true);
    expect(b.player.items.map(i => [i.id, i.count])).toEqual([['potion:frost', 1], ['potion:gas', 1]]);
    expect(isKnown(b, 'potion:haste')).toBe(false);
  });
  it('known trial tools can convert once with ordinary paid action, no free refresh', () => {
    const w = createTrialWorld(trial.id, 'huntress');
    expect(w.player.talents).toEqual(['mark', 'apothecary']);
    expect(w.player.tipped).toEqual({ paralysis: 1, chill: 1 });
    const index = w.player.items.findIndex(i => i.id === 'potion:gas');
    queueUse(w, index, 'convert');
    expect(w.player.pendingUse?.mode).toBe('convert');
    w.frame(1 / 60, emptyInput(w.player.yaw)); finishAction(w);
    expect(w.player.tipped.paralysis).toBe(3);
    expect(w.player.items.some(i => i.id === 'potion:gas')).toBe(false);
    expect(w.time).toBeCloseTo(.6, 1);
    run(w, 60, { wait: true });
    expect(w.player.tipped.paralysis).toBe(3);
  });
});

describe('trial boundaries and optional route', () => {
  it('only explicit practice entry resolves reserved seeds', () => {
    for (const trial of PRACTICE_TRIALS) {
      expect(trialForSeed(trial.seed)?.id).toBe(trial.id);
      expect(generateLevel(trial.seed).practiceTrial).toBeUndefined();
      expect(generateLevel(trial.seed).practice).toBe(false);
    }
    expect(trialForSeed('PRACTICE')).toBeUndefined();
    expect(generateLevel('PRACTICE', { practice: true }).practiceTrial).toBeUndefined();
  });
  it('trial kit/knowledge does not leak into fresh or serialized campaign state', () => {
    const runState = newRun('ISOLATION', 'huntress'), save = serializeRun(runState);
    const before = Array.from({ length: RUN.floors }, (_, i) => levelSignature(generateLevel('ISOLATION', { floor: i + 1 })));
    for (const trial of PRACTICE_TRIALS) createTrialWorld(trial.id, 'huntress');
    expect(serializeRun(runState)).toBe(save);
    const campaign = createFloorWorld(parseRun(save)!);
    expect(campaign.player.known).toEqual(CLASS_KNOWLEDGE.huntress);
    expect(campaign.player.talents).toEqual([]); expect(campaign.player.items).toEqual([]);
    expect(campaign.player.tipped).toEqual({ paralysis: 2, chill: 2 });
    expect(itemName(campaign, 'potion:gas')).not.toContain('麻痺');
    expect(itemName(campaign, 'potion:frost')).not.toContain('冰霜');
    expect(Array.from({ length: RUN.floors }, (_, i) => levelSignature(generateLevel('ISOLATION', { floor: i + 1 })))).toEqual(before);
  });
  it('western bypass reaches the chest with no fighting, control item or forced damage', () => {
    const w = createTrialWorld('cluster-bypass', 'huntress');
    // Real movement inputs, no teleport/invisibility/enemy or health modification.
    const waypoints = [{ x: 5.5, z: 20.5 }, { x: 5.5, z: 4.5 }, { x: 11.2, z: 4.5 }];
    for (const p of waypoints) {
      let n = 0;
      while (Math.hypot(p.x - w.player.x, p.z - w.player.z) > .14 && n++ < 2000) {
        const yaw = Math.atan2(-(p.x - w.player.x), -(p.z - w.player.z));
        w.frame(1 / 60, { ...emptyInput(yaw), moveZ: 1, sneak: true });
      }
      expect(n).toBeLessThan(2000);
    }
    const chest = w.level.chests[0]!;
    w.frame(1 / 60, { ...emptyInput(Math.atan2(-(chest.x - w.player.x), -(chest.z - w.player.z))), interact: true });
    finishAction(w);
    expect(w.stats.chests).toBe(1); expect(w.stats.kills).toBe(0);
    expect(w.enemies.every(e => e.alive)).toBe(true);
    expect(w.stats.shots).toBe(0); expect(w.stats.itemsUsed).toBe(0);
    expect(w.stats.damageTaken).toEqual({}); expect(w.player.hp).toBe(PLAYER.maxHp);
  });
});


describe('charger punish positioning', () => {
  it.each([
    { goal: { x: 13, z: 8 }, sign: 1, charge: 3, exposed: false },
    { goal: { x: 21.5, z: 12 }, sign: -1, charge: 4, exposed: true },
  ])('live dodge route has archer exposure $exposed at melee punish', ({ goal, sign, charge, exposed }) => {
    const w = createTrialWorld('charger-window', 'huntress');
    const points = [{ x: 10.8, z: 20.5 }, { x: 10.8, z: 14.8 }, goal];
    let stage = 0, count = 0, dodgeUntil = -1, last = '', found = false;
    for (let frame = 0; frame < 60 * 20 && !w.player.dead; frame++) {
      const p = w.player, e = w.enemies[0]!, a = w.enemies[1]!;
      if (e.phase === 'charge' && last !== 'charge') { count++; dodgeUntil = w.time + 1.05; }
      if (e.phase === 'stun' && last !== 'stun' && count === charge) {
        expect(Math.hypot(p.x - e.x, p.z - e.z)).toBeLessThan(1.8);
        expect(archerLineClear(w, a)).toBe(exposed);
        if (exposed) expect(a.state).toBe('alert');
        // Same ordinary knife action remains useful on either side, but exposure differs.
        const hp = e.hp;
        w.frame(1 / 60, { ...emptyInput(yawFromDir(e.x - p.x, e.z - p.z)), fire: true, firePressed: true });
        finishAction(w);
        expect(w.events.some(event => event.type === 'hitEnemy' && event.source === 'melee' && event.amount === 6)).toBe(true);
        expect(hp - e.hp).toBeGreaterThanOrEqual(6); // an exposed bolt may also hit the charger
        found = true; break;
      }
      last = e.phase;
      const input = emptyInput(p.yaw);
      if (w.time < dodgeUntil) {
        const f = forwardFromYaw(e.lockedYaw);
        input.yaw = yawFromDir(-f.z * sign, f.x * sign); input.moveZ = 1;
      } else if (stage < points.length) {
        const q = points[stage]!;
        if (Math.hypot(q.x - p.x, q.z - p.z) < .17) stage++;
        else { input.yaw = yawFromDir(q.x - p.x, q.z - p.z); input.moveZ = 1; }
      } else input.wait = true;
      w.frame(1 / 60, input); w.drainEvents();
    }
    expect(found).toBe(true);
  });
});
