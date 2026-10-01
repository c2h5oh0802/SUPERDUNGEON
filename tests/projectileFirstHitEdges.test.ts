import { describe, expect, it } from 'vitest';
import { PLAYER, PROJECTILES } from '../src/config';
import { segmentCylinder } from '../src/sim/characterHit';
import { updateProjectiles } from '../src/sim/projectileSys';
import { killXp } from '../src/sim/progress';
import type { Projectile } from '../src/sim/types';
import { makeWorld } from './helpers';

const bolt = (w: ReturnType<typeof makeWorld>, owner = 999, y = 1.2): void => {
  const pos = { x: 9.5, y, z: 10 };
  const vel = { x: 0, y: 0, z: 18 };
  const p: Projectile = { id:w.nextId++, kind:'bolt', owner, pos, vel, radius:PROJECTILES.bolt.radius, gravity:0, age:0, alive:true, hitSet:new Set(), next:{...pos}, avgVel:{...vel}, deflected:false, tip:null, payload:'smoke' };
  w.projectiles.push(p);
};

describe('Exact first-contact geometry', () => {
  it('clips a cylinder side, cap, tangent, starting inside, and no-hit height', () => {
    expect(segmentCylinder({x:0,y:1,z:0},{x:10,y:1,z:0},5,0,.5,0,2)).toBeCloseTo(.45,12);
    expect(segmentCylinder({x:5,y:3,z:0},{x:5,y:-1,z:0},5,0,.5,0,2)).toBeCloseTo(.25,12);
    expect(segmentCylinder({x:0,y:1,z:.5},{x:10,y:1,z:.5},5,0,.5,0,2)).toBeCloseTo(.5,12);
    expect(segmentCylinder({x:5,y:1,z:0},{x:10,y:1,z:0},5,0,.5,0,2)).toBe(0);
    expect(segmentCylinder({x:0,y:3,z:0},{x:10,y:3,z:0},5,0,.5,0,2)).toBe(-1);
  });
  it.each([false,true])('resolves sub-8cm contacts independently of actor array order (reverse=%s)', reverse => {
    // Deliberately overlapping stationary collision proxies to isolate TOI ordering.
    // Full encounter fixtures use normal non-overlapping actors instead.
    const w=makeWorld(undefined,[{kind:'guard',x:9.5,z:11.01,state:'idle'},{kind:'guard',x:9.5,z:11.03,state:'idle'}]);
    const [near,far]=w.enemies;
    if(reverse) w.enemies.reverse();
    bolt(w); updateProjectiles(w,.4); // A single long sweep, independent of engine substeps.
    expect(near!.hp).toBe(near!.maxHp-PROJECTILES.bolt.damage);
    expect(far!.hp).toBe(far!.maxHp);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.projectiles).toHaveLength(0);
  });
  it('ignores the shooter but still collides with the first other body', () => {
    const w=makeWorld(undefined,[{kind:'archer',x:9.5,z:10,state:'idle'},{kind:'guard',x:9.5,z:12,state:'idle'}]);
    const [shooter,target]=w.enemies;
    bolt(w,shooter!.id); updateProjectiles(w,.4);
    expect(shooter!.hp).toBe(shooter!.maxHp);
    expect(target!.hp).toBe(target!.maxHp-PROJECTILES.bolt.damage);
  });
  it('uses the same base damage for a friendly head contact and awards a friendly kill only once', () => {
    const w=makeWorld(undefined,[{kind:'guard',x:9.5,z:12,state:'idle'}]);
    const e=w.enemies[0]!; e.hp=PROJECTILES.bolt.damage; e.lodged=2; e.veteran=true;
    bolt(w,999,1.85); updateProjectiles(w,.4);
    expect(e.alive).toBe(false);
    expect(w.events.filter(ev=>ev.type==='hitEnemy')).toEqual(expect.arrayContaining([expect.objectContaining({id:e.id,amount:PROJECTILES.bolt.damage,source:'friendlyBolt'})]));
    expect(w.stats.kills).toBe(1);
    expect(w.stats.shotHits).toBe(0);
    expect(w.player.xp).toBe(killXp(e));
    expect(w.pickups.filter(p=>p.kind==='item')).toHaveLength(1);
    expect(w.pickups.find(p=>p.kind==='arrows')?.amount).toBe(2);
    const pickups=JSON.stringify(w.pickups);
    const xp=w.player.xp;
    bolt(w); updateProjectiles(w,.4);
    expect(w.stats.kills).toBe(1);
    expect(w.player.xp).toBe(xp);
    expect(JSON.stringify(w.pickups)).toBe(pickups);
    expect(w.events.filter(ev=>ev.type==='enemyDeath' && ev.id===e.id)).toHaveLength(1);
  });
});
