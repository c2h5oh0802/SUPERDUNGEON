import { describe, expect, it } from 'vitest';
import { ENEMY_DEATH_FALL_TIME } from '../src/config';
import { createPublicPlaytestWorld } from '../src/playtest/scenario';
import { EnemyVisual } from '../src/render/characters';
import { createSharedUniforms } from '../src/render/materials';
import { damageEnemy } from '../src/sim/enemySys';
import { emptyInput } from '../src/sim/types';
import { makeWorld, OPEN_ROOM } from './helpers';

// Real World and Three scene-graph poses; no rendered-pixel claim.
describe('public Core victory presentation only', () => {
  it('finishes the archer fall at real-time speed while metrics, projectiles and combat remain sealed', () => {
    const w = createPublicPlaytestWorld('core');
    for (const e of w.enemies) damageEnemy(w, e, 999, { source: 'melee', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    const archer = w.enemies.find(e => e.kind === 'archer')!;
    const visual = new EnemyVisual(archer, createSharedUniforms());
    w.outcome = 'win';
    const events = w.drainEvents();
    expect(events.filter(e => e.type === 'enemyDeath')).toHaveLength(2);
    // A hostile bolt would reach the player immediately if combat resumed.
    w.projectiles.push({ id: 900, kind: 'bolt', owner: archer.id, damage: 999,
      pos: { x: w.player.x, y: .9, z: w.player.z + .1 }, vel: { x: 0, y: 0, z: -40 },
      radius: .05, gravity: 0, age: 0, alive: true, hitSet: new Set(),
      next: { x: 0, y: 0, z: 0 }, avgVel: { x: 0, y: 0, z: 0 }, deflected: false, tip: null, payload: 'smoke' });
    const frozen = { stats: structuredClone(w.stats), time: w.time, realTime: w.realTime,
      hp: w.player.hp, x: w.player.x, z: w.player.z, projectiles: structuredClone(w.projectiles) };
    const input = { ...emptyInput(1.2, .3), moveZ: 1, fire: true, firePressed: true, potion: true, wait: true };
    try {
      visual.update(archer, 0);
      expect(visual.body.rotation.x).toBe(0);
      for (let f = 0; f < 18; f++) w.frame(1 / 60, input);
      visual.update(archer, 0);
      expect(archer.deathT).toBeCloseTo(ENEMY_DEATH_FALL_TIME / 2);
      expect(visual.body.rotation.x).toBeGreaterThan(0);
      expect(visual.body.rotation.x).toBeLessThan(1.45);
      for (let f = 0; f < 19; f++) w.frame(1 / 60, input);
      visual.update(archer, 0);
      expect(archer.deathT).toBeGreaterThan(ENEMY_DEATH_FALL_TIME);
      expect(visual.body.rotation.x).toBeCloseTo(1.45);
      for (let f = 0; f < 100; f++) w.frame(1 / 60, input);
      w.damagePlayer(999, 'bolt', w.player.x, w.player.z);
      expect(w.outcome).toBe('win'); expect(w.player.dead).toBe(false);
      expect(w.player.yaw).toBe(1.2); expect(w.player.pitch).toBe(.3);
      expect({ stats: w.stats, time: w.time, realTime: w.realTime,
        hp: w.player.hp, x: w.player.x, z: w.player.z, projectiles: w.projectiles }).toEqual(frozen);
      expect(w.drainEvents()).toEqual([]);
    } finally { visual.dispose(); }
  });

  it('leaves ordinary victories and public player-death behavior unchanged', () => {
    const ordinary = makeWorld(OPEN_ROOM, [{ kind: 'archer', x: 9.5, z: 6.5 }]);
    const deadCore = createPublicPlaytestWorld('core');
    const calibration = createPublicPlaytestWorld('calibration');
    for (const [w, outcome] of [[ordinary, 'win'], [deadCore, 'dead'], [calibration, 'win']] as const) {
      w.outcome = outcome;
      w.enemies[0]!.alive = false;
      const deathT = w.enemies[0]!.deathT, yaw = w.player.yaw;
      w.frame(.1, emptyInput(yaw + 1));
      expect(w.enemies[0]!.deathT).toBe(deathT);
      expect(w.player.yaw).toBe(yaw);
    }
  });
});
