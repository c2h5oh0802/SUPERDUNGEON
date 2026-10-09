import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, VOLLEY } from '../src/config';
import { createTrialLevel } from '../src/gen/practiceTrials';
import { validateLevel } from '../src/gen/validate';
import { becomeAlert } from '../src/sim/enemySys';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { fightCleared, ReplayRecorder } from '../src/sim/replay';
import { run } from './helpers';

const v2 = () => createTrialWorld('crossfire-waves', 'huntress');

describe('prototype: crossfire v2 (waves, fragile enemies, volleys)', () => {
  it('validates; the first wave is five fragile enemies none of which sees the spawn', () => {
    const l = createTrialLevel('crossfire-waves');
    expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
    expect(l.enemies.map((e) => [e.kind, e.hp])).toEqual([['archer', 2], ['archer', 2], ['rat', 2], ['rat', 2], ['rat', 2]]);
    for (const e of l.enemies) expect(l.grid.lineOfSight({ x: e.x, y: e.y + 1.6, z: e.z }, { ...l.spawn, y: PLAYER.eyeHeight })).toBe(false);
    expect(l.waves).toHaveLength(2);
    expect(l.rules).toEqual({ smartFire: true, syncVolley: true });
    expect(l.damageMul).toBe(1.5);
    const w = v2();
    expect(w.enemies.map((e) => e.hp)).toEqual([2, 2, 2, 2, 2]);
    expect(w.enemies[2]!.hp).toBeLessThan(ENEMIES.rat.hp);
  });

  it('the next wave comes in hunting once at most one enemy is left', () => {
    const w = v2();
    for (const e of w.enemies.slice(1)) e.alive = false;
    w.drainEvents();
    run(w, 2, { wait: true });
    expect(w.wavesSpawned).toBe(1);
    const fresh = w.enemies.slice(5);
    expect(fresh.map((e) => e.kind).sort()).toEqual(['bomber', 'charger', 'rat', 'rat']);
    expect(fresh.every((e) => e.state === 'alert' && e.hp <= 3)).toBe(true);
    expect(w.drainEvents().some((e) => e.type === 'wave' && e.text === '第二波：西門、北門、東門')).toBe(true);
  });

  it('or 20 world seconds after the last wave, however many are left', () => {
    const w = v2();
    w.player.x = 6.5; w.player.z = 19.5; // safe in the start corridor
    for (let f = 0; f < 3000 && w.time < 19.5; f++) run(w, 1, { wait: true });
    expect(w.wavesSpawned).toBe(0);
    for (let f = 0; f < 120 && w.time < 20.5; f++) run(w, 1, { wait: true });
    expect(w.wavesSpawned).toBe(1);
  });

  it('the fight is not cleared until every wave has come and fallen', () => {
    const w = v2();
    const rec = new ReplayRecorder();
    for (const e of w.enemies) e.alive = false;
    expect(w.wavesLeft).toBe(2);
    expect(fightCleared(w, rec)).toBe(false);
    run(w, 1, { wait: true });
    for (const e of w.enemies) e.alive = false;
    run(w, 1, { wait: true });
    for (const e of w.enemies) e.alive = false;
    expect(w.wavesLeft).toBe(0);
    expect(fightCleared(w, rec)).toBe(true);
  });

  it('crossbowmen hold a ready shot for a partner, then both loose together', () => {
    const w = v2();
    for (const e of w.enemies) if (e.kind === 'rat') { e.alive = false; e.hp = 0; }
    // In view of both flanks (the pillars cover the middle of the arena).
    w.player.x = 12.5; w.player.z = 7.5;
    const archers = w.enemies.filter((e) => e.kind === 'archer');
    for (const a of archers) becomeAlert(w, a);
    let first = -1;
    for (let f = 0; f < 600 && first < 0; f++) {
      run(w, 1, { wait: true });
      if (archers.some((a) => a.phase === 'aim')) first = w.time;
    }
    expect(first).toBeGreaterThanOrEqual(VOLLEY.maxWait - 0.05);
    expect(archers.every((a) => a.phase === 'aim')).toBe(true);
    expect(Math.abs(archers[0]!.phaseT - archers[1]!.phaseT)).toBeLessThan(0.02);
  });

  it('without the rule a crossbowman shoots as soon as it can', () => {
    const w = createTrialWorld('crossfire-arena', 'huntress');
    for (const e of w.enemies) if (e.kind !== 'archer') { e.alive = false; e.hp = 0; }
    w.player.x = 11.5; w.player.z = 10.5;
    const archers = w.enemies.filter((e) => e.kind === 'archer');
    for (const a of archers) becomeAlert(w, a);
    let first = -1;
    for (let f = 0; f < 600 && first < 0; f++) {
      run(w, 1, { wait: true });
      if (archers.some((a) => a.phase === 'aim')) first = w.time;
    }
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(VOLLEY.maxWait - 0.3);
  });
});
