import { describe, expect, it } from 'vitest';
import { counterThreat } from '../src/sim/classSys';
import { emptyInput } from '../src/sim/types';
import { kiteWorld } from './spearKiteBots';

/** Read the same Counter cue as the UI; all subsequent state changes use frame input. */
function timedCounter(dt:number, weapon:'spear'|'longsword', distance:number, guardHp?:number) {
  const w=kiteWorld('guard','warrior');
  w.player.weapon.id=weapon;
  w.player.z=w.enemies[0]!.z+distance;
  if(guardHp!==undefined) w.enemies[0]!.hp=w.enemies[0]!.maxHp=guardHp; // Explicit endurance fixture only.
  let attacks=0;
  for(let k=0;k<Math.ceil(30/dt)&&!w.player.dead&&w.enemies[0]!.alive;k++) {
    const fire=!w.player.action&&counterThreat(w)!==null;
    w.frame(dt,{...emptyInput(),fire,firePressed:fire,wait:true});
    attacks+=w.drainEvents().filter(e=>e.type==='swing').length;
  }
  return {weapon,distance,guardHp:guardHp??8,cleared:!w.enemies[0]!.alive,dead:w.player.dead,
    damage:Object.values(w.stats.damageTaken).reduce((a,b)=>a+b,0),attacks,counters:w.stats.counters,worldTime:w.time};
}

describe('Deliberate Counter timing survives movement and guardStep merge',()=>{
  it.each([1/30,1/60,1/120])('reading the cue clears ordinary and explicit prolonged guards at frame size %s',dt=>{
    for(const weapon of ['spear','longsword'] as const) for(const distance of [2.4,3]) for(const hp of [undefined,32]) {
      const r=timedCounter(dt,weapon,distance,hp);
      console.log('TIMED COUNTER',JSON.stringify({dt,...r}));
      expect(r.cleared).toBe(true);expect(r.dead).toBe(false);expect(r.damage).toBe(0);
      expect(r.counters).toBe((hp??8)/4);expect(r.attacks).toBe(r.counters);
    }
  });
});
