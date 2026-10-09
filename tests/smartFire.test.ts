import { describe, expect, it } from 'vitest';
import { FIREBOMB, ITEM_FX, PLAYER } from '../src/config';
import { bomberTarget } from '../src/sim/enemySys';
import { spawnArea } from '../src/sim/items';
import { breakBottle } from '../src/sim/projectileSys';
import type { Projectile } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { makeWorld, run } from './helpers';

// Prototype rules (level.rules.smartFire), used only by the crossfire practice room.
const smart = (w: World) => { w.level.rules = { smartFire: true }; return w; };
const bottle = (w: World, owner: Projectile['owner']): Projectile => ({
  id: w.nextId++, kind: 'bottle', owner, pos: { x: 0, y: 0.2, z: 0 }, vel: { x: 0, y: 0, z: 0 }, radius: 0.16, gravity: 6,
  age: 0, alive: true, hitSet: new Set(), next: { x: 0, y: 0.2, z: 0 }, avgVel: { x: 0, y: 0, z: 0 }, deflected: false, tip: null, payload: 'firebomb',
});
/** Let world time pass; a level-up from a kill pauses the world until a card is picked. */
const waitFor = (w: World, seconds: number) => {
  const end = w.time + seconds;
  for (let f = 0; f < 5000 && w.time < end && w.outcome === 'none'; f++) {
    if (w.pendingChoice) w.resolveChoice(0);
    run(w, 1, { wait: true });
  }
};

describe('smartFire: whose fire burns whom', () => {
  it("the bomber's own firebomb hurts only the player", () => {
    const w = smart(makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 10.5, state: 'sleep' }]));
    w.player.x = 9.5; w.player.z = 11.6;
    breakBottle(w, bottle(w, 99), { x: 9.5, y: 0.2, z: 11 }, false);
    expect(w.player.hp).toBe(PLAYER.maxHp - FIREBOMB.burst);
    expect(w.stats.damageTaken['火瓶爆炸']).toBe(FIREBOMB.burst);
    const guard = w.enemies[0]!;
    waitFor(w, 2);
    expect(guard.hp).toBe(guard.maxHp);
    expect(guard.burnT ?? 0).toBe(0);
  });

  it('a bottle the player batted back burns the enemies it lands among; they keep burning', () => {
    const w = smart(makeWorld(undefined, [{ kind: 'guard', x: 5.5, z: 5.5, state: 'sleep' }, { kind: 'archer', x: 6.3, z: 5.5, state: 'sleep' }]));
    const [guard, archer] = w.enemies;
    w.drainEvents();
    breakBottle(w, bottle(w, 'player'), { x: 5.8, y: 0.2, z: 5.5 }, false);
    expect(archer!.alive).toBe(false);
    expect(guard!.hp).toBe(guard!.maxHp - FIREBOMB.burst);
    expect(guard!.burnT).toBe(FIREBOMB.burn);
    waitFor(w, FIREBOMB.burn + 0.6);
    expect(guard!.alive).toBe(false);
    const kills = w.drainEvents().filter((e) => e.type === 'redirectKill').map((e) => e.kind);
    expect(kills).toContain('guard');
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it("a bottle shot down by the player's arrow counts as the player's fire", () => {
    const w = smart(makeWorld(undefined, [{ kind: 'archer', x: 5.5, z: 5.5, state: 'sleep' }]));
    w.drainEvents();
    breakBottle(w, bottle(w, 99), { x: 5.5, y: 0.4, z: 5.5 }, true, true);
    expect(w.enemies[0]!.alive).toBe(false);
    expect(w.drainEvents().some((e) => e.type === 'redirectKill')).toBe(true);
    expect(w.areas.at(-1)?.byPlayer).toBe(true);
  });

  it("enemies step out of the player's fire and do not walk back in while it burns", () => {
    const w = smart(makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 9.5 }]));
    const guard = w.enemies[0]!;
    guard.state = 'alert';
    guard.lastKnown = { x: w.player.x, z: w.player.z };
    spawnArea(w, 'fire', 9.5, 9.5, { radius: 1.6, life: 4 }, { byPlayer: true });
    const fire = w.areas.at(-1)!;
    let outsideAfter = -1;
    for (let f = 0; f < 240; f++) {
      run(w, 1, { wait: true });
      const d = Math.hypot(guard.x - fire.x, guard.z - fire.z);
      if (outsideAfter < 0 && d > fire.radius) outsideAfter = w.time;
      if (outsideAfter >= 0 && w.areas.includes(fire)) expect(d).toBeGreaterThan(fire.radius - 0.05);
    }
    expect(outsideAfter).toBeGreaterThan(0);
    expect(outsideAfter).toBeLessThan(1.2);
  });

  it('the bomber lands its fire just behind the player when allies are on the player', () => {
    const w = smart(makeWorld(undefined, [{ kind: 'bomber', x: 9.5, z: 3.5 }, { kind: 'guard', x: 10.6, z: 10.5 }]));
    const [bomber, guard] = w.enemies;
    w.player.x = 9.5; w.player.z = 10.5;
    const t = bomberTarget(w, bomber!)!;
    expect(t.x).toBeLessThan(w.player.x - 2);
    expect(Math.hypot(t.x - w.player.x, t.z - w.player.z)).toBeCloseTo(ITEM_FX.area.fire.radius + 0.4, 5);
    expect(Math.hypot(t.x - guard!.x, t.z - guard!.z)).toBeGreaterThan(ITEM_FX.area.fire.radius + FIREBOMB.allyClear);
    guard!.x = 15.5;
    expect(bomberTarget(w, bomber!)).toEqual({ x: w.player.x, z: w.player.z });
  });

  it('without the rule (the campaign) fire behaves as before', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 10.5, state: 'sleep' }]);
    w.player.x = 15.5; w.player.z = 15.5;
    w.drainEvents();
    breakBottle(w, bottle(w, 'player'), { x: 9.5, y: 0.2, z: 10.5 }, false);
    const guard = w.enemies[0]!;
    expect(guard.hp).toBe(guard.maxHp);
    expect(w.areas.at(-1)?.byPlayer).toBeUndefined();
    waitFor(w, 1.2);
    expect(guard.hp).toBeLessThan(guard.maxHp);
    expect(guard.burnT ?? 0).toBe(0);
    const t = bomberTarget(w, guard!);
    expect(t).toEqual({ x: w.player.x, z: w.player.z });
    expect(w.drainEvents().some((e) => e.type === 'redirectKill')).toBe(false);
  });
});
