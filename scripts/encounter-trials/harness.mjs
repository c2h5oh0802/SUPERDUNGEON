import process from 'node:process';
import console from 'node:console';
import { writeFileSync } from 'node:fs';
import { createTrialWorld } from '__SOURCE__/src/sim/practiceTrials';
import { emptyInput } from '__SOURCE__/src/sim/types';
import { queueUse } from '__SOURCE__/src/sim/items';
import { yawFromDir } from '__SOURCE__/src/core/math';
import { archerLineClear } from '__SOURCE__/src/sim/enemySys';
import { Nav } from '__SOURCE__/src/sim/nav';
import { ENEMIES, PLAYER, WEAPONS } from '__SOURCE__/src/config';
const round = n => +n.toFixed(4);
const commonRoute = [[10.8, 20], [10.8, 14.5]];
const policies = [
  { trial: 'charger-window', name: 'knife-open-north', route: [...commonRoute, [14.5, 8]], style: 'knife', priority: 'charger' },
  { trial: 'charger-window', name: 'ordinary-open-north', route: [...commonRoute, [14.5, 8]], style: 'ranged', priority: 'charger' },
  { trial: 'cluster-bypass', name: 'ordinary-lure-pocket', route: [[13.6, 19], [13.6, 14.5], [13.6, 19], [9.7, 19.5]], style: 'ranged' },
  { trial: 'cluster-bypass', name: 'ordinary-archer-first', route: [[13.6, 19], [13.6, 15.5]], style: 'ranged', priority: 'archer' },
  { trial: 'cluster-bypass', name: 'tipped-archer-first', route: [[13.6, 19], [13.6, 15.5]], style: 'tipped', priority: 'archer' },
  { trial: 'shield-crossfire', name: 'ordinary-bait', route: commonRoute, style: 'ranged' },
  { trial: 'shield-crossfire', name: 'tipped-bait', route: commonRoute, style: 'tipped' },
  { trial: 'charger-window', name: 'ordinary-west', route: [...commonRoute, [14.5, 13.8]], style: 'ranged' },
  { trial: 'charger-window', name: 'knife-west', route: [...commonRoute, [14.5, 13.8]], style: 'knife' },
  { trial: 'charger-window', name: 'knife-east', route: [...commonRoute, [19, 14.8]], style: 'knife' },
  { trial: 'cluster-bypass', name: 'ordinary-lane', route: [[13.6, 19], [13.6, 15.5]], style: 'ranged' },
  { trial: 'cluster-bypass', name: 'gas-lane', route: [[13.6, 19], [13.6, 15.5]], style: 'gas' },
  { trial: 'cluster-bypass', name: 'frost-lane', route: [[13.6, 19], [13.6, 15.5]], style: 'frost' },
  { trial: 'cluster-bypass', name: 'tipped-lane', route: [[13.6, 19], [13.6, 15.5]], style: 'tipped' },
  { trial: 'cluster-bypass', name: 'noncombat-west-loop', route: [[5.5, 20], [5.5, 4.5], [11.1, 4.5]], style: 'bypass' },
];
function run(policy, errorDeg, reaction) {
  const w = createTrialWorld(policy.trial, 'huntress');
  const nav = new Nav(w.grid, PLAYER.radius);
  const initial = { hp: w.player.hp, arrows: w.player.arrows, tipped: { ...w.player.tipped }, items: w.player.items.map(i=>({...i})), enemies: w.enemies.map(e => ({ id:e.id, kind:e.kind, x:e.x, z:e.z, hp:e.hp })) };
  let waypoint = 0, nextDecision = 0, decisions = 0, held = emptyInput(), bottleUsed = false;
  let distanceMoved = 0, exposure = 0, exposureMelee = 0, exposureBow = 0, stunExposure = 0, anyStunTime = 0;
  let firingLane=0, firingLaneMelee=0, firingLaneStun=0, aimSeconds=0, lockedAimSeconds=0, maxControlled=0;
  const controlSeconds={};
  let maxEnemiesAware = 0, checkpoints = [], lastSnapshot = -1, choices = [], targetId = null;
  const actions = {}, events = {}, eventLog = [], damageByTool = {}, damageByEnemy = {};
  const dt = 1 / 60, dist = e => Math.hypot(e.x - w.player.x, e.z - w.player.z);
  const visible = e => w.grid.lineOfSight({x:w.player.x,y:1.55,z:w.player.z}, {x:e.x,y:e.y+1.3,z:e.z});
  const move = (out, dx, dz, speed = 1) => { const n = Math.hypot(dx,dz)||1; out.moveX = (dx*Math.cos(out.yaw)-dz*Math.sin(out.yaw))/n*speed; out.moveZ = (-dx*Math.sin(out.yaw)-dz*Math.cos(out.yaw))/n*speed; };
  const navigate = (out, x, z) => { const q=nav.findPath(w.player.x,w.player.z,x,z)?.[0]; if(q) move(out,q.x-w.player.x,q.z-w.player.z,Math.min(1,Math.hypot(q.x-w.player.x,q.z-w.player.z)/(4.5*reaction))); };
  const goalDone = () => policy.trial === 'cluster-bypass' ? w.stats.chests > 0 : w.enemies.every(e => !e.alive);
  for (let frame=0; frame<90*60 && w.time<60 && !w.player.dead && !goalDone(); frame++) {
    if (w.pendingChoice) { choices.push({time:round(w.time),options:w.pendingChoice.options,chosen:w.pendingChoice.options[0]}); w.resolveChoice(0); }
    let out = { ...held, fire:false, firePressed:false, selectSlot:null, interact:false };
    if (w.realTime+1e-9 >= nextDecision) {
      nextDecision=w.realTime+reaction; decisions++;
      const p=w.player;
      out={...emptyInput(p.yaw,p.pitch),wait:true};
      while (waypoint<policy.route.length && Math.hypot(policy.route[waypoint][0]-p.x,policy.route[waypoint][1]-p.z)<.45) waypoint++;
      const live=w.enemies.filter(e=>e.alive), inSight=live.filter(visible);
      const target=inSight.sort((a,b)=>(policy.priority ? (a.kind===policy.priority?-100:0)-(b.kind===policy.priority?-100:0) : 0)+dist(a)-dist(b))[0];
      const e=target || live[0]; targetId=e?.id ?? null;
      if (waypoint<policy.route.length) {
        const [x,z]=policy.route[waypoint]; out.yaw=yawFromDir(x-p.x,z-p.z); move(out,x-p.x,z-p.z,Math.min(1,Math.hypot(x-p.x,z-p.z)/(4.5*reaction)));
      } else if (policy.style==='bypass' || !live.length) {
        const chest=w.interactables.find(i=>i.kind==='chest');
        if (chest) { out.yaw=yawFromDir(chest.x-p.x,chest.z-p.z); if(Math.hypot(chest.x-p.x,chest.z-p.z)<1.9) out.interact=true; else navigate(out,chest.x,chest.z); }
      } else if (e) {
        const d=dist(e), error=errorDeg*Math.PI/180;
        const head=e.kind==='guard' || (e.kind==='charger' && ['stun','recovery'].includes(e.phase));
        out.yaw=yawFromDir(e.x-p.x,e.z-p.z)+Math.sin(decisions*1.73)*error;
        out.pitch=Math.atan2(e.y+(head?ENEMIES[e.kind].headY:1.1)-1.55,d)+Math.cos(decisions*1.17)*error*.5;
        if (!target) { if(e.kind==='archer')navigate(out,e.x,e.z); else move(out,e.x-p.x,e.z-p.z); }
        else {
          if (e.kind==='guard') {
            // Approach to induce a committed swing; backpedal after it begins.
            if (e.phase==='windup' || e.phase==='active') { out.moveZ=-1; out.moveX=.6; }
            else if (d>2.6) out.moveZ=1;
            else out.moveX=.8;
          } else if(e.kind==='charger') {
            if(e.phase==='windup' || e.phase==='charge') out.moveX=1;
            else if(d<3) out.moveZ=-.6;
          } else out.moveX=Math.floor(w.realTime/2)%2 ? -.4 : .4;
          let tool='bow',tip=null;
          if(policy.style==='knife' && e.kind==='charger' && ['stun','recovery'].includes(e.phase)) {
            tool='melee'; if(d>WEAPONS[p.weapon.id].reach+e.radius-.15) out.moveZ=1;
          }
          if(policy.style==='tipped' && e.kind!=='archer') {
            if(p.tipped.paralysis>0 && e.paralyzeT<=0) tip='paralysis';
            else if(p.tipped.chill>0 && e.slowT<=0) tip='chill';
            if(tip)tool='tipped';
          }
          if(!p.action) {
            if(['gas','frost'].includes(policy.style) && !bottleUsed && d<7) {
              const index=p.items.findIndex(i=>i.id===`potion:${policy.style}`);
              if(index>=0) { out.pitch=-.16; queueUse(w,index,'throw'); bottleUsed=true; }
            } else if(p.desiredTool!==tool) out.selectSlot=tool==='melee'?1:tool==='bow'?2:3;
            else if(tip && p.tipKind!==tip)out.selectSlot=3;
            else if(tool!=='melee' || d<WEAPONS[p.weapon.id].reach+e.radius-.1) {
              // Don't knowingly shoot raised frontal guard shields. Head opens in swing/recovery.
              if(e.kind!=='guard' || !e.shieldUp) { out.fire=true; out.firePressed=true; }
            }
          }
        }
      }
      held={...out};
    }
    const oldAction=w.player.action, oldT=w.time, oldX=w.player.x,oldZ=w.player.z;
    const archerExposed=w.enemies.some(e=>e.alive && e.kind==='archer' && visible(e));
    const stun=w.enemies.some(e=>e.alive && e.kind==='charger' && e.phase==='stun');
    const archers=w.enemies.filter(e=>e.alive && e.kind==='archer');
    const clear=archers.some(e=>archerLineClear(w,e));
    const aiming=archers.some(e=>e.phase==='aim'), locked=archers.some(e=>e.phase==='aim' && e.locked);
    const controlled=w.enemies.filter(e=>e.alive&&(e.paralyzeT>0||e.slowT>0));
    w.frame(dt,out);
    const elapsed=w.time-oldT;
    if(clear){firingLane+=elapsed;if(oldAction?.kind==='melee')firingLaneMelee+=elapsed;if(stun)firingLaneStun+=elapsed;}
    if(aiming)aimSeconds+=elapsed;if(locked)lockedAimSeconds+=elapsed;
    maxControlled=Math.max(maxControlled,controlled.length);
    for(const e of controlled)controlSeconds[e.id]=(controlSeconds[e.id]||0)+elapsed;
    if(archerExposed) { exposure+=elapsed; if(oldAction?.kind==='melee')exposureMelee+=elapsed; if(oldAction?.kind==='bow')exposureBow+=elapsed; }
    if(stun){anyStunTime+=elapsed;if(archerExposed)stunExposure+=elapsed;}
    distanceMoved+=Math.hypot(w.player.x-oldX,w.player.z-oldZ);
    maxEnemiesAware=Math.max(maxEnemiesAware,w.enemies.filter(e=>e.alive && e.state==='alert').length);
    if(w.player.action && w.player.action!==oldAction) {const k=w.player.action.kind==='bow'?w.player.action.tip||'normal-arrow':w.player.action.kind;actions[k]=(actions[k]||0)+1;}
    for(const e of w.drainEvents()) {
      events[e.type]=(events[e.type]||0)+1;
      if(e.type==='hitEnemy'){damageByTool[e.source]=(damageByTool[e.source]||0)+e.amount;damageByEnemy[e.id]=(damageByEnemy[e.id]||0)+e.amount;}
      if(['hitEnemy','playerHurt','enemyDeath','stun','throw','tipHit','shield','helmet','area','enemyFire','chest'].includes(e.type))eventLog.push({t:round(w.time),...e,player:{x:round(w.player.x),z:round(w.player.z)},targetId});
    }
    if(Math.floor(w.time/2)>lastSnapshot) { lastSnapshot=Math.floor(w.time/2);checkpoints.push({t:round(w.time),x:round(w.player.x),z:round(w.player.z),waypoint,hp:w.player.hp,enemies:w.enemies.filter(e=>e.alive).map(e=>({id:e.id,x:round(e.x),z:round(e.z),hp:e.hp,state:e.state,phase:e.phase,shield:e.shieldUp}))}); }
  }
  const p=w.player;
  return {trial:policy.trial,policy:policy.name,style:policy.style,priority:policy.priority||'nearest',route:policy.route,fixtureSeed:w.level.seed,errorDeg,reactionRealSeconds:reaction,initial,success:goalDone(),cleared:w.enemies.every(e=>!e.alive),dead:p.dead,stop:goalDone()?'goal':p.dead?'death':'timeout',worldTime:round(w.time),realTime:round(w.realTime),hp:p.hp,maxHp:p.maxHp,damageTaken:Object.values(w.stats.damageTaken).reduce((a,b)=>a+b,0),damageBySource:w.stats.damageTaken,control:{maxSimultaneousEnemies:maxControlled,enemyWorldSeconds:Object.fromEntries(Object.entries(controlSeconds).map(([k,v])=>[k,round(v)]))},exposure:{archerFiringLaneClear:round(firingLane),firingLaneDuringMelee:round(firingLaneMelee),firingLaneDuringChargerStun:round(firingLaneStun),archerAim:round(aimSeconds),archerLockedAim:round(lockedAimSeconds),archerLOS:round(exposure),duringMelee:round(exposureMelee),duringBow:round(exposureBow),chargerStunTotal:round(anyStunTime),archerLOSDuringChargerStun:round(stunExposure)},distanceMoved:round(distanceMoved),maxEnemiesAware,actions,events,stats:w.stats,damageByTool,damageByEnemy,ammoRemaining:{arrows:p.arrows,...p.tipped},itemsRemaining:p.items,waypointsCompleted:waypoint,final:{x:round(p.x),z:round(p.z)},enemyHp:w.enemies.map(e=>({id:e.id,kind:e.kind,hp:e.hp,alive:e.alive})),choices,eventLog,checkpoints};
}
const rows=policies.flatMap(p=>[[1.5,.2],[4,.3]].map(([err,reaction])=>run(p,err,reaction)));
writeFileSync(process.env.OUTPUT,JSON.stringify({batch:process.env.BATCH,description:'Preserves v2 guard/charger movement while using engine Nav only for approaching an occluded archer or the final chest, fixing noncombat obstacle stalls. Adds actual archerLineClear opportunity, aim-state exposure, per-enemy control duration, and hit-event logs. Previous exploratory failures are preserved.',rows},null,2)+'\n');
console.log(rows.map(r=>`${r.trial} ${r.policy} err=${r.errorDeg} ${r.stop} t=${r.worldTime} dmg=${r.damageTaken} kills=${r.stats.kills} shots=${r.stats.shots} exposed=${r.exposure.archerLOS}`).join('\n'));
