/** Isolated progression supply and bounded-input encounter controls; not a playtest. */
import process from 'node:process';
import console from 'node:console';
import { writeFileSync } from 'node:fs';
import { ACTIONS, CLASSES, RUN, TALENT_POOLS, WEAPONS, XP } from '__SOURCE__/src/config';
import { Rng } from '__SOURCE__/src/core/rng';
import { yawFromDir } from '__SOURCE__/src/core/math';
import { createFloorWorld, newRun, nextFloor } from '__SOURCE__/src/sim/run';
import { gainXp, killXp } from '__SOURCE__/src/sim/progress';
import { emptyInput } from '__SOURCE__/src/sim/types';
import { makeWorld, OPEN_ROOM } from '__SOURCE__/tests/helpers';

const round = n => +n.toFixed(4);
const seeds = (process.env.SEEDS || ['FLOW1', 'FLOW2', 'LIVING1', ...Array.from({ length: 17 }, (_, i) => `HUNTRESS-${String(i + 1).padStart(2, '0')}`)].join(',')).split(',');
function resolve(w, log = []) {
  let guard = 0;
  while (w.pendingChoice && guard++ < 30) {
    const c = w.pendingChoice;
    log.push({ level: w.player.level, options: [...c.options], ownedBefore: [...w.player.talents] });
    w.resolveChoice(0);
  }
  if (w.pendingChoice) throw new Error('Choice resolution did not terminate');
  return log;
}
function progression(seed, fraction) {
  let run = newRun(seed, 'huntress');
  const floors = [], choices = [], thresholds = [];
  for (let floor = 1; floor <= RUN.floors; floor++) {
    const w = createFloorWorld(run), generatedXp = w.enemies.reduce((n, e) => n + killXp(e), 0);
    const enemies = new Rng(`${seed}#xp-census#${floor}`).shuffle([...w.enemies]);
    // All arena enemies are counted; fractions apply only to exploration floors.
    const selected = enemies.slice(0, w.level.encounter ? enemies.length : Math.ceil(enemies.length * fraction));
    const before = w.player.xp;
    for (const e of selected) {
      const old = w.player.level;
      gainXp(w, killXp(e));
      if (w.player.level !== old) thresholds.push({ floor, level: w.player.level, xp: w.player.xp });
      resolve(w, choices);
    }
    floors.push({ floor, encounter: !!w.level.encounter, generatedEnemies: enemies.length, generatedXp, creditedKills: selected.length, creditedXp: w.player.xp - before,
      xp: w.player.xp, level: w.player.level, talents: [...w.player.talents], choices: choices.length });
    run = nextFloor(run, w);
  }
  const last = floors.at(-1);
  return { seed, fraction, generatedTotalXp: floors.reduce((n, f) => n + f.generatedXp, 0), xp: last.xp, level: last.level,
    talentChoices: choices.length, talents: last.talents, floors, thresholds };
}

const encounters = [
  { name: 'guard', enemies: [{ kind: 'guard', x: 9.5, z: 6.5 }] },
  { name: 'charger', enemies: [{ kind: 'charger', x: 9.5, z: 6.5 }] },
  { name: 'archer', enemies: [{ kind: 'archer', x: 9.5, z: 5.5 }] },
  { name: 'guard_archer', enemies: [{ kind: 'guard', x: 9.5, z: 6.5 }, { kind: 'archer', x: 6.5, z: 4.5 }] },
  { name: 'two_guards', enemies: [{ kind: 'guard', x: 8, z: 6.5 }, { kind: 'guard', x: 11, z: 6.5 }] },
  { name: 'charger_guard', enemies: [{ kind: 'charger', x: 9.5, z: 5.5 }, { kind: 'guard', x: 12.5, z: 6.5 }] },
];
function encounter(enc, policy, errorDeg) {
  const w = makeWorld(OPEN_ROOM, enc.enemies, 'huntress');
  for (const e of w.enemies) { e.state = 'alert'; e.awareness = 1; e.yaw = yawFromDir(w.player.x - e.x, w.player.z - e.z); }
  // Explicit common fixture allowance, not a claim about actual starting supply.
  w.player.items.push({ id: 'potion:healing', count: 1, level: 0 });
  w.player.known.push('potion:healing');
  const actions = { normal: 0, paralysis: 0, chill: 0, melee: 0, potion: 0 }, damageByTool = {}, actionSeconds = {};
  const shotsAtTarget = new Map();
  const dt = 1 / 60, reaction = 0.2;
  let nextDecision = 0, decisions = 0, held = {}, lastAction = null, targetId = null, choicesSkipped = 0;
  const distance = e => Math.hypot(e.x - w.player.x, e.z - w.player.z);
  for (let frame = 0; frame < 60 * 180 && w.time < 45 && !w.player.dead && w.enemies.some(e => e.alive); frame++) {
    // Base-kit control: advance level metadata but never acquire a talent.
    if (w.pendingChoice) { choicesSkipped++; w.pendingChoice = null; w.choiceQueue.length = 0; }
    let out = { ...held, fire: false, firePressed: false, selectSlot: null, potion: false };
    if (w.realTime + 1e-9 >= nextDecision) {
      nextDecision = w.realTime + reaction; decisions++;
      const p = w.player;
      const target = w.enemies.filter(e => e.alive).sort((a, b) => distance(a) - distance(b))[0];
      const d = distance(target); targetId = target.id;
      const error = errorDeg * Math.PI / 180;
      const yaw = yawFromDir(target.x - p.x, target.z - p.z) + Math.sin(decisions * 1.73) * error;
      const pitch = Math.atan2(target.y + 1.1 - 1.6, d) + Math.cos(decisions * 1.17) * error * 0.5;
      out = { yaw, pitch, moveZ: 0, moveX: 0, wait: true };
      if (!p.action && p.hp <= p.maxHp * 0.55 && p.items.some(it => it.id === 'potion:healing')) out.potion = true;
      else {
        const canMelee = d <= WEAPONS[p.weapon.id].reach + target.radius - 0.1;
        const opened = (shotsAtTarget.get(target.id) || 0) >= 1;
        let tool = policy === 'mixed' && canMelee ? 'melee' : 'bow';
        let tip = null;
        if (policy === 'mixed' && opened && !canMelee) {
          if (target.kind === 'charger' && p.tipped.chill > 0 && target.slowT <= 0) tip = 'chill';
          else if (target.kind !== 'charger' && p.tipped.paralysis > 0 && target.paralyzeT <= 0) tip = 'paralysis';
          if (tip) tool = 'tipped';
        }
        if (tool === 'bow' && p.arrows <= 0) tool = 'melee';
        if (tool === 'melee' && !canMelee) out.moveZ = 1;
        if (policy === 'mixed' && tool === 'bow' && opened && d > 2) out.moveZ = 1;
        // A deliberately simple constant strafe against archers, not perfect bolt prediction.
        if (target.kind === 'archer' && d > 3) out.moveX = decisions % 20 < 10 ? 0.45 : -0.45;
        if (!p.action) {
          if (p.desiredTool !== tool) out.selectSlot = tool === 'melee' ? 1 : tool === 'bow' ? 2 : 3;
          else if (tip && p.tipKind !== tip) out.selectSlot = 3;
          else if (tool !== 'melee' || canMelee) { out.fire = true; out.firePressed = true; }
        }
      }
      held = { ...out };
    }
    const old = w.player.action;
    w.frame(dt, { ...emptyInput(w.player.yaw, w.player.pitch), ...out });
    const current = w.player.action;
    if (current && current !== old) {
      const key = current.kind === 'bow' ? current.tip || 'normal' : current.kind;
      if (key in actions) actions[key]++;
      actionSeconds[key] = (actionSeconds[key] || 0) + current.windup + current.active + current.recovery;
    }
    for (const event of w.drainEvents()) {
      if (event.type === 'fire' && event.kind === 'arrow') shotsAtTarget.set(targetId, (shotsAtTarget.get(targetId) || 0) + 1);
      if (event.type === 'hitEnemy') damageByTool[event.source] = (damageByTool[event.source] || 0) + event.amount;
    }
    lastAction = w.lastAction || lastAction;
  }
  const p = w.player;
  return { encounter: enc.name, composition: enc.enemies.map(e => e.kind), policy, errorDeg, reactionRealSeconds: reaction,
    cleared: w.enemies.every(e => !e.alive), dead: p.dead, worldTime: round(w.time), realTime: round(w.realTime), hp: round(p.hp), maxHp: p.maxHp,
    damageTaken: Object.values(w.stats.damageTaken).reduce((n, v) => n + v, 0), damageBySource: w.stats.damageTaken,
    actions, actionSeconds: Object.fromEntries(Object.entries(actionSeconds).map(([k, v]) => [k, round(v)])), shotsReleased: w.stats.shots, shotHits: w.stats.shotHits,
    tipHits: w.stats.tipHits, healingUsed: w.stats.healingUsed, healingRestored: w.stats.healingRestored, healingWasted: w.stats.healingWasted,
    damageByTool, ammoRemaining: { arrows: p.arrows, ...p.tipped }, healingRemaining: p.items.filter(i => i.id === 'potion:healing').reduce((n, i) => n + i.count, 0),
    enemyHp: w.enemies.map(e => ({ kind: e.kind, hp: e.hp, alive: e.alive })), choicesSkipped, lastAction };
}

function exhaustion(bulk) {
  const w = makeWorld(OPEN_ROOM, [], 'huntress'), log = [];
  if (bulk) { gainXp(w, XP.levels.at(-1)); resolve(w, log); }
  else for (const xp of XP.levels.slice(1)) { gainXp(w, xp - w.player.xp); resolve(w, log); }
  return { bulk, level: w.player.level, xp: w.player.xp, talents: [...w.player.talents], choiceCount: log.length, log,
    pending: w.pendingChoice, queue: w.choiceQueue.length };
}
const result = { version: 1, source: process.env.SOURCE_REPO, config: { XP, huntressPool: TALENT_POOLS.huntress, huntressStart: CLASSES.huntress.start,
  bow: ACTIONS.bow, knife: WEAPONS.knife },
  progression: seeds.flatMap(seed => [0.3, 0.7, 1].map(fraction => progression(seed, fraction))),
  exhaustion: [exhaustion(false), exhaustion(true)],
  encounters: encounters.flatMap(enc => ['ranged', 'mixed'].flatMap(policy => [1.5, 4].map(error => encounter(enc, policy, error)))) };
writeFileSync(process.env.OUTPUT, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ progressionRows: result.progression.length, encounterRows: result.encounters.length,
  exhaustion: result.exhaustion.map(({ bulk, level, talents, choiceCount }) => ({ bulk, level, talents, choiceCount })) }, null, 2));
