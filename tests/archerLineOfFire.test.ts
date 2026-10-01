import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, PROJECTILES, TALENT_POOLS } from '../src/config';
import { archerLineClear, updateEnemies } from '../src/sim/enemySys';
import { updateProjectiles } from '../src/sim/projectileSys';
import { T } from '../src/sim/grid';
import { upgradeTargets } from '../src/sim/items';
import { makeWorld } from './helpers';
import type { Projectile } from '../src/sim/types';

function corridor(blocked = true) {
  const w = makeWorld(undefined, [
    { kind: 'archer', x: 9.5, z: 3.5, yaw: Math.PI, perched: true },
    { kind: 'guard', x: blocked ? 9.5 : 12, z: 10, yaw: Math.PI },
  ]);
  const [a, g] = w.enemies;
  a!.state = 'alert'; a!.seesPlayer = true; a!.awareness = 1;
  a!.lastKnown = { x: w.player.x, z: w.player.z };
  g!.paralyzeT = 20;
  return { w, a: a!, g: g! };
}
const tickAI = (w: ReturnType<typeof makeWorld>, sec: number) => { for (let t = 0; t < sec - 1e-9; t += 1/120) updateEnemies(w, 1/120); };

describe('Archer commitment and physical first hit', () => {
  it('does not begin aiming through a clear ally blocker; resumes once clear', () => {
    const { w, a, g } = corridor();
    expect(archerLineClear(w, a)).toBe(false); tickAI(w, 1.2);
    expect(a.phase).toBe('none'); expect(w.projectiles).toHaveLength(0);
    expect(w.events.filter(e=>e.type==='enemyWindup' && e.id===a.id)).toHaveLength(0);
    g.x = 12; tickAI(w, 0.05); expect(a.phase).toBe('aim');
  });
  it.each([0.2, ENEMIES.archer.aim - ENEMIES.archer.lockBefore - 0.004])('cancels ally-blocked pre-lock aim, including lock-crossing tick (t=%s)', phaseT => {
    const { w, a, g } = corridor(false); tickAI(w, .02);
    a.phaseT = phaseT; g.x = 9.5; updateEnemies(w, 1/120);
    expect(a.phase).toBe('none'); expect(a.locked).toBe(false);
    expect(w.events.some(e=>e.type==='enemyLock')).toBe(false);
  });
  it('locks once, then fires unchanged when an ally enters the line and player moves', () => {
    const { w, a, g } = corridor(false); tickAI(w, .68);
    expect(a.locked).toBe(true); const aim = { ...a.aimPoint! };
    g.x = 9.5; w.player.x = 12;
    tickAI(w, .3); expect(a.phase).toBe('reload'); expect(w.projectiles).toHaveLength(1);
    expect(w.events.filter(e=>e.type==='enemyLock')).toHaveLength(1);
    const bolt = w.projectiles[0]!;
    expect(bolt.vel.x).toBeCloseTo(0, 8);
    expect(aim.x).toBe(9.5);
    updateProjectiles(w, .7);
    expect(g.hp).toBe(g.maxHp-PROJECTILES.bolt.damage); expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.projectiles).toHaveLength(0);
  });
  it('unblocked bolt hits the player; a wall stops it first', () => {
    for (const wall of [false, true]) {
      const { w, a } = corridor(false); tickAI(w, 1);
      expect(w.projectiles).toHaveLength(1);
      if (wall) w.grid.set(9, 12, T.Wall);
      updateProjectiles(w, 1);
      expect(w.player.hp).toBe(PLAYER.maxHp - (wall ? 0 : PROJECTILES.bolt.damage));
      expect(w.projectiles).toHaveLength(0); expect(a.phase).toBe('reload');
    }
  });
  it('hostile friendly hit provokes investigation without magically revealing player position', () => {
    const {w, a, g}=corridor(false); g.state='sleep'; g.paralyzeT=0;
    const pos={x:9.5,y:1.2,z:8}; g.x=9.5;
    const b: Projectile={id:w.nextId++,kind:'bolt',owner:a.id,pos,vel:{x:0,y:0,z:18},radius:.06,gravity:0,age:0,alive:true,pierceLeft:0,hitSet:new Set(),next:{...pos},avgVel:{x:0,y:0,z:18},deflected:false,tip:null,payload:'smoke'};
    w.projectiles.push(b); updateProjectiles(w,.3);
    expect(g.state).toBe('investigate'); expect(g.lastKnown).toBeNull(); expect(w.stats.shotHits).toBe(0);
  });
  it('shield upgrades/talents are unavailable while legacy save fields remain inert', () => {
    const {w}=corridor(); w.player.shieldLevel=5; w.player.talents=['bulwark','heavyShield'];
    expect(upgradeTargets(w)).not.toContain('shield');
    expect(TALENT_POOLS.warrior).not.toContain('bulwark'); expect(TALENT_POOLS.warrior).not.toContain('heavyShield');
  });
});
