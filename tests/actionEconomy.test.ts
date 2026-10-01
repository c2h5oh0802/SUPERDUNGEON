import { describe, expect, it } from 'vitest';
import { ALL_WEAPONS, PLAYER, PROJECTILES, WEAPONS } from '../src/config';
import { counterThreat } from '../src/sim/classSys';
import { emptyInput, type Projectile } from '../src/sim/types';
import { makeWorld, finishAction } from './helpers';

export const injectBolt = (w: ReturnType<typeof makeWorld>, z = 10, owner = 999): Projectile => {
  const b: Projectile = { id: w.nextId++, kind: 'bolt', owner, pos: {x: 9.5, y: 1.2, z}, vel: {x: 0,y: 0,z: 18}, radius: PROJECTILES.bolt.radius, gravity: 0, age: 0, alive: true, pierceLeft: 0, hitSet: new Set(), next: {x:9.5,y:1.2,z}, avgVel: {x:0,y:0,z:18}, deflected:false, tip:null, payload:'smoke' };
  w.projectiles.push(b); return b;
};

describe('Combat Action Economy v1 contracts', () => {
  it.each(ALL_WEAPONS)('%s: attacks have a movement commitment, without freezing', (weapon) => {
    const w = makeWorld(); w.player.z=10; w.player.weapon.id = weapon; w.player.vz = PLAYER.moveSpeed;
    const start = w.player.z;
    w.frame(1/60, {...emptyInput(), moveZ:-1, fire:true});
    while(w.player.action) w.frame(1/60, {...emptyInput(), moveZ:-1});
    const travel = w.player.z-start;
    console.log('MOVEMENT', JSON.stringify({weapon, travel, worldTime:w.time, fullSpeedTravel: PLAYER.moveSpeed*w.time}));
    expect(travel).toBeGreaterThan(0);
    expect(travel).toBeLessThan(PLAYER.moveSpeed*w.time*0.99);
  });
  it.each(ALL_WEAPONS)('%s: one primary target; only axe cleaves once for half damage', (weapon) => {
    const w = makeWorld(undefined, [
      {kind:'guard', x:9.1,z:13,state:'idle'},
      {kind:'guard', x:9.9,z:13,state:'idle'},
      {kind:'guard', x:9.5,z:12.0,state:'idle'},
    ], 'huntress');
    w.player.weapon.id=weapon;
    for (const e of w.enemies) { e.hp=100; e.paralyzeT=10; e.state='alert'; e.state='alert'; }
    w.frame(1/60, {...emptyInput(),fire:true}); finishAction(w);
    const hits=w.events.filter(e=>e.type==='hitEnemy');
    console.log('TARGETS', JSON.stringify({weapon,hits:hits.map(e=>({id:e.id,damage:e.amount}))}));
    expect(hits).toHaveLength(weapon==='axe'?2:1);
    expect(hits[0]!.amount).toBe(WEAPONS[weapon].damage);
    if(weapon==='axe') expect(hits[1]!.amount).toBe(WEAPONS.axe.damage*0.5);
  });
  it('bolt hits the front guard, stops and leaves the player untouched', () => {
    const w=makeWorld(undefined,[{kind:'guard',x:9.5,z:12,state:'idle'}]);
    const e=w.enemies[0]!; e.paralyzeT=10; e.state='alert';
    injectBolt(w); w.advance(0.4);
    console.log('CORRIDOR',JSON.stringify({enemyDamage:e.maxHp-e.hp,playerDamage:PLAYER.maxHp-w.player.hp,bolts:w.projectiles.length}));
    expect(e.hp).toBe(e.maxHp-PROJECTILES.bolt.damage); expect(w.player.hp).toBe(PLAYER.maxHp); expect(w.projectiles).toHaveLength(0);
  });
  it('shove preserves a committed guard attack and grants no frontal defense', () => {
    const w=makeWorld(undefined,[{kind:'guard',x:9.5,z:13.0,yaw:Math.PI,state:'idle'}]);
    const g=w.enemies[0]!; g.state='alert'; g.phase='windup'; g.phaseT=0.4; g.locked=true; g.lockedYaw=Math.PI; g.seesPlayer=true;
    w.frame(0.06,{...emptyInput(),shield:true});
    console.log('SHOVE',JSON.stringify({phase:g.phase,phaseT:g.phaseT,locked:g.locked,pushing:!!g.push}));
    expect(g.phase).toBe('windup'); expect(g.phaseT).toBeGreaterThan(0.4); expect(g.locked).toBe(true);
  });
});

describe('Movement and Counter eligibility regressions', () => {
  it.each(ALL_WEAPONS)('%s applies each phase cap, including release-key momentum and selected-tool changes', weapon => {
    const w=makeWorld(); w.player.weapon.id=weapon;
    w.frame(1/60,{...emptyInput(),fire:true});
    const a=w.player.action!, m=WEAPONS[weapon].move;
    for (const [t, cap] of [[0,m.windup],[a.windup+.001,m.active],[a.windup+a.active+.001,m.recovery]]) {
      a.t=t!; w.player.vx=PLAYER.moveSpeed;
      w.frame(.001,{...emptyInput(), selectSlot:2});
      expect(Math.hypot(w.player.vx,w.player.vz)).toBeLessThanOrEqual(PLAYER.moveSpeed*cap!+1e-9);
      expect(w.player.action).toBe(a);
    }
  });
});

 it('Counter cue does not promise a rear attack through the primary body', () => {
  const w=makeWorld(undefined,[{kind:'guard',x:9.5,z:13.25},{kind:'guard',x:9.5,z:12.2}]);
  const [front,rear]=w.enemies; front!.paralyzeT=2;
  rear!.state='alert'; rear!.phase='windup'; rear!.locked=true; rear!.phaseT=.38; rear!.yaw=Math.PI; rear!.lockedYaw=Math.PI;
  expect(counterThreat(w)).toBeNull();
  w.frame(1/60,{...emptyInput(),fire:true}); expect(w.player.action?.counter).toBe(false);
 });
