import { describe, expect, it, vi } from 'vitest';
import { ALL_WEAPONS, ENEMIES, PLAYER, SHOVE, STEALTH, WEAPONS } from '../src/config';
import { updateEnemies } from '../src/sim/enemySys';
import { emptyInput } from '../src/sim/types';
import { finishAction, makeWorld } from './helpers';

// Cross-feature contracts: uploaded living AI/guard step plus Combat Economy v1.
describe('Living dungeon and combat reconciliation', () => {
  it.each(ALL_WEAPONS)('%s preserves local surprise damage and primary stagger within the target budget', weapon => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13, state: 'sleep' }], 'huntress');
    const g = w.enemies[0]!;
    g.paralyzeT = 10;
    w.player.weapon.id = weapon;
    w.frame(1 / 60, { ...emptyInput(), fire: true });
    finishAction(w);
    expect(g.maxHp - g.hp).toBe(WEAPONS[weapon].damage * (weapon === 'knife' ? 2 : 1));
    expect(g.alive).toBe(true);
    expect(g.staggerDur).toBe(STEALTH.surpriseStagger);
    expect(g.shieldUp).toBe(false);
    expect(w.stats.backstabs).toBe(1);
  });

  it('an awake enemy that sees the player is never surprised, even from behind', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13, yaw: 0, state: 'idle' }], 'huntress');
    const g = w.enemies[0]!;
    g.paralyzeT = 10; g.seesPlayer = true;
    w.player.weapon.id = 'knife';
    w.frame(1 / 60, { ...emptyInput(), fire: true }); finishAction(w);
    expect(g.maxHp - g.hp).toBe(WEAPONS.knife.damage);
    expect(w.stats.backstabs).toBe(0);
  });

  it('axe secondary surprise, if still eligible, halves both damage and reaction', () => {
    const w = makeWorld(undefined, [
      { kind: 'guard', x: 9.1, z: 13, state: 'sleep' },
      { kind: 'guard', x: 9.9, z: 13, state: 'sleep' },
      { kind: 'guard', x: 9.5, z: 12, state: 'sleep' },
    ], 'huntress');
    for (const e of w.enemies) { e.hp = e.maxHp = 100; e.paralyzeT = 10; }
    // Isolate cleave reaction composition: ordinary combat noise can otherwise
    // wake the second victim during the same swing and remove surprise eligibility.
    const noise = vi.spyOn(w, 'emitNoise').mockImplementation(() => {});
    w.player.weapon.id = 'axe';
    w.frame(1 / 60, { ...emptyInput(), fire: true }); finishAction(w);
    noise.mockRestore();
    expect(w.enemies.map(e => e.maxHp - e.hp)).toEqual([7, 3.5, 0]);
    expect(w.enemies.slice(0, 2).map(e => e.staggerDur)).toEqual([0.8, 0.4]);
  });

  it('a committed guard keeps its attack clock while shoved but cannot voluntarily step during the slide', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 8, yaw: Math.PI }]);
    const g = w.enemies[0]!;
    Object.assign(g, { state: 'alert', seesPlayer: true, phase: 'windup', phaseT: 0.5,
      locked: true, lockedYaw: Math.PI, push: { dx: 1, dz: 0, left: SHOVE.pushDist } });
    const z = g.z;
    w.advance(0.1);
    expect(g.phase).toBe('active'); expect(g.phaseT).toBeGreaterThan(0);
    expect(g.push).not.toBeNull(); expect(g.z).toBe(z);
    expect(g.lockedYaw).toBe(Math.PI);
    w.advance(0.15);
    expect(g.phase).toBe('recovery'); expect(g.push).toBeNull();
    expect(g.z - z).toBeLessThanOrEqual(ENEMIES.guard.attackStepSpeed * ENEMIES.guard.active);
    expect(w.events.filter(e => e.type === 'enemyStrike')).toHaveLength(1);
    expect(w.events.some(e => e.type === 'bump')).toBe(false);
  });

  it('unopposed shove retains its full displacement independently of enemy attack stepping', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13.1, state: 'sleep' }]);
    const g = w.enemies[0]!; g.paralyzeT = 10;
    const z = g.z; w.frame(0.06, { ...emptyInput(), shield: true }); w.advance(0.2);
    expect(z - g.z).toBeCloseTo(SHOVE.pushDist, 8);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('archer checks its preserved aim point at the lock boundary, not just the new player line', () => {
    const w = makeWorld(undefined, [{ kind: 'archer', x: 9.5, z: 3.5, yaw: Math.PI, perched: true },
      { kind: 'guard', x: 9.5, z: 9 }]);
    const [a, g] = w.enemies;
    Object.assign(a!, { state: 'alert', seesPlayer: true, phase: 'aim', percT: 1,
      phaseT: ENEMIES.archer.aim - ENEMIES.archer.lockBefore - 0.001, aimPoint: { x: 9.5, y: 1.2, z: 14.5 } });
    g!.paralyzeT = 10;
    w.player.x = 13; // new line is clear, but the stored line has a body
    updateEnemies(w, 1 / 120);
    expect(a!.phase).toBe('none'); expect(a!.locked).toBe(false);
    expect(w.events.some(e => e.type === 'enemyLock')).toBe(false);
  });
  it.each([false, true])('actual guard step into archer line respects commitment (locked=%s)', locked => {
    const w = makeWorld(undefined, [{ kind: 'archer', x: 9.5, z: 3.5, yaw: Math.PI, perched: true },
      { kind: 'guard', x: 10.1, z: 9, yaw: Math.PI / 2 }]);
    const [a, g] = w.enemies;
    Object.assign(a!, { state: 'alert', seesPlayer: true, phase: 'aim', percT: 1,
      phaseT: locked ? 0.68 : 0.55, locked, lockedYaw: Math.PI, aimPoint: { x: 9.5, y: 1.2, z: 14.5 } });
    Object.assign(g!, { state: 'alert', seesPlayer: true, phase: 'active', phaseT: 0,
      locked: true, lockedYaw: Math.PI / 2, hitDone: true });
    w.advance(0.8);
    expect(g!.x).toBeLessThan(9.7);
    expect(w.events.filter(e => e.type === 'enemyFire')).toHaveLength(locked ? 1 : 0);
    expect(g!.maxHp - g!.hp).toBe(locked ? 2 : 0);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.events.some(e => e.type === 'enemyLock')).toBe(false);
  });

  it.each([false, true])('smoke cancels only uncommitted aim (locked=%s)', locked => {
    const w = makeWorld(undefined, [{ kind: 'archer', x: 9.5, z: 3.5, yaw: Math.PI, perched: true }]);
    const a = w.enemies[0]!;
    Object.assign(a, { state: 'alert', seesPlayer: true, phase: 'aim', percT: 0,
      phaseT: locked ? 0.68 : 0.2, locked, lockedYaw: Math.PI, aimPoint: { x: 9.5, y: 1.2, z: 14.5 } });
    w.smokes.push({ id: w.nextId++, x: 9.5, y: 1, z: 9, age: 1, radius: 3, air: false });
    w.player.x = 11;
    w.advance(0.4);
    expect(a.seesPlayer).toBe(false);
    expect(w.events.filter(e => e.type === 'enemyFire')).toHaveLength(locked ? 1 : 0);
    if (locked) expect(w.projectiles[0]!.vel.x).toBeCloseTo(0, 8);
  });

});
