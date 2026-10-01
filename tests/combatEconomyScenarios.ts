import { ENEMIES, PLAYER, WEAPONS, type PlayerClass, type WeaponId } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { counterThreat } from '../src/sim/classSys';
import { emptyInput, type FrameInput } from '../src/sim/types';
import { makeWorld } from './helpers';

export type EconomyPolicy = 'held-retreat' | 'retreat-cycle' | 'stand-attack' | 'shield-repeat' | 'counter';
export interface EconomyScenario {
  name: string;
  weapon: WeaponId;
  encounter: 'single' | 'dual' | 'mixed' | 'restricted' | 'close-pair';
  policy: EconomyPolicy;
  cls?: PlayerClass;
  /** Optional explicit endurance stress fixture. Never used for normal balance conclusions. */
  stressHp?: number;
  maxWorld?: number;
  committedStart?: boolean;
}

const room = (width: number, height: number): string[] => Array.from({ length: height }, (_, z) =>
  z === 0 || z === height - 1 ? '#'.repeat(width) : '#' + '.'.repeat(width - 2) + '#');

export function runEconomyScenario(s: EconomyScenario) {
  const restricted = s.encounter === 'restricted';
  const px = 12.5;
  const pz = restricted ? 17.5 : 10.5;
  const near = s.encounter === 'close-pair' ? 1.5 : s.committedStart ? 1.6 : 2.8;
  const enemies = s.encounter === 'dual' || s.encounter === 'close-pair'
    ? [{ kind: 'guard' as const, x: px - 0.50, z: pz - near }, { kind: 'guard' as const, x: px + 0.50, z: pz - near }]
    : s.encounter === 'mixed'
      ? [{ kind: 'guard' as const, x: px, z: pz - near }, { kind: 'archer' as const, x: px - 3, z: pz - 6.5 }]
      : [{ kind: 'guard' as const, x: px, z: pz - near }];
  const w = makeWorld(room(25, restricted ? 22 : 75), enemies, s.cls ?? 'huntress');
  w.player.x = px;
  w.player.z = pz;
  w.player.yaw = 0;
  w.player.weapon = { id: s.weapon, level: 0 };
  w.player.tool = 'melee';
  w.player.desiredTool = 'melee';
  w.player.armor = { id: 'cloth', level: 0 };
  for (const e of w.enemies) {
    e.state = 'alert'; e.awareness = 1;
    e.lastKnown = { x: px, z: pz };
    e.yaw = yawFromDir(px - e.x, pz - e.z);
    if (s.stressHp !== undefined) e.hp = s.stressHp;
  }
  if (s.committedStart) {
    const e = w.enemies[0]!;
    e.phase = 'windup'; e.phaseT = ENEMIES.guard.trackUntil + 0.025;
    e.locked = true; e.lockedYaw = e.yaw;
  }
  w.drainEvents();
  const dt = 1 / 60;
  const actions = new Map<object, number>();
  const hitIds: Array<Set<number>> = [];
  const damageByAction: Array<number[]> = [];
  let attacks = 0, windups = 0, pushes = 0, committedPushCancels = 0, fullSpeedRetreatFrames = 0;
  let retreatAttackFrames = 0, retreatAttackDistance = 0, blockedRetreatFrames = 0, minGap = Infinity;
  let reason: 'clear' | 'dead' | 'choice' | 'world-limit' | 'real-limit' = 'real-limit';
  for (let frame = 0; frame < 60 * 60; frame++) {
    const living = w.enemies.filter(e => e.alive).sort((a, b) =>
      Math.hypot(a.x - w.player.x, a.z - w.player.z) - Math.hypot(b.x - w.player.x, b.z - w.player.z) || a.id - b.id);
    const e = living[0];
    if (!e) { reason = 'clear'; break; }
    if (w.player.dead) { reason = 'dead'; break; }
    if (w.pendingChoice) { reason = 'choice'; break; } // Never silently grant a talent to keep the bot running.
    if (w.time >= (s.maxWorld ?? 12)) { reason = 'world-limit'; break; }
    const gap = Math.hypot(e.x - w.player.x, e.z - w.player.z);
    minGap = Math.min(minGap, gap);
    const yaw = yawFromDir(e.x - w.player.x, e.z - w.player.z);
    const decision: Partial<FrameInput> = { yaw };
    if (s.policy === 'held-retreat') Object.assign(decision, { moveZ: -1, fire: true, firePressed: !w.player.action });
    else if (s.policy === 'retreat-cycle') {
      if (w.player.action) decision.moveZ = -1;
      else if (gap > WEAPONS[s.weapon].reach + e.radius - 0.50) decision.moveZ = 1;
      else Object.assign(decision, { moveZ: -1, fire: true, firePressed: true });
    } else if (s.policy === 'stand-attack') Object.assign(decision, { fire: true, firePressed: !w.player.action });
    else if (s.policy === 'shield-repeat') {
      if (!w.player.action && gap > 2) decision.moveZ = 1;
      else decision.shield = true;
    } else {
      // No hidden prediction: wait for the same committed-threat cue shown by the UI.
      if (!w.player.action && counterThreat(w)) Object.assign(decision, { fire: true, firePressed: true });
      else decision.wait = true;
    }
    const beforeAction = w.player.action;
    const beforeEnemies = new Map(w.enemies.map(x => [x.id, { phase: x.phase, locked: x.locked }]));
    w.frame(dt, { ...emptyInput(yaw, 0), ...decision });
    const action = beforeAction ?? w.player.action;
    let actionIndex = -1;
    if (action?.kind === 'melee') {
      if (!actions.has(action)) { actions.set(action, hitIds.length); hitIds.push(new Set()); damageByAction.push([]); }
      actionIndex = actions.get(action)!;
      if (decision.moveZ === -1) {
        retreatAttackFrames++;
        retreatAttackDistance += w.player.lastMoveDist;
        if (w.player.lastMoveDist >= PLAYER.moveSpeed * dt * 0.98) fullSpeedRetreatFrames++;
        if (w.player.lastMoveDist < PLAYER.moveSpeed * dt * 0.05) blockedRetreatFrames++;
      }
    }
    for (const ev of w.drainEvents()) {
      if (ev.type === 'swing') attacks++;
      if (ev.type === 'enemyWindup' && ev.kind === 'guard') windups++;
      if (ev.type === 'hitEnemy' && ev.source === 'melee' && actionIndex >= 0 && ev.id !== undefined) {
        hitIds[actionIndex]!.add(ev.id);
        damageByAction[actionIndex]!.push(ev.amount ?? 0);
      }
      if (ev.type === 'push' && ev.id !== undefined && ev.id >= 0) {
        pushes++;
        const before = beforeEnemies.get(ev.id);
        const after = w.enemies.find(x => x.id === ev.id);
        if (before && after && (before.phase === 'active' || (before.phase === 'windup' && before.locked)) &&
          after.phase !== before.phase && !after.locked) committedPushCancels++;
      }
    }
  }
  const round = (n: number) => Number(n.toFixed(6));
  return {
    name: s.name, weapon: s.weapon, cls: s.cls ?? 'huntress', policy: s.policy,
    stressHp: s.stressHp ?? null, reason,
    worldTime: round(w.time), realTime: round(w.realTime),
    damage: Object.values(w.stats.damageTaken).reduce((a, b) => a + b, 0),
    enemyHp: w.enemies.map(e => e.hp), kills: w.stats.kills,
    attacks, hitsPerAction: hitIds.map(ids => ids.size), damageByAction,
    guardWindups: windups, counters: w.stats.counters, pushes, committedPushCancels,
    retreatAttackFrames, fullSpeedRetreatFraction: round(fullSpeedRetreatFrames / (retreatAttackFrames || 1)),
    retreatAttackSpeed: round(retreatAttackDistance / (retreatAttackFrames * dt || 1)),
    blockedRetreatFrames, minGap: round(minGap),
    endPosition: [round(w.player.x), round(w.player.z)],
  };
}

export const ECONOMY_SCENARIOS: EconomyScenario[] = [
  ...(['single', 'dual', 'mixed', 'restricted'] as const).flatMap(encounter =>
    (['held-retreat', 'retreat-cycle'] as const).map(policy => ({ name: `spear-${encounter}-${policy}`, weapon: 'spear' as const, encounter, policy }))),
  { name: 'sword-close-pair', weapon: 'longsword', encounter: 'close-pair', policy: 'stand-attack', maxWorld: 2 },
  { name: 'axe-close-pair', weapon: 'axe', encounter: 'close-pair', policy: 'stand-attack', maxWorld: 2 },
  { name: 'shield-same-committed-guard', weapon: 'longsword', encounter: 'single', policy: 'shield-repeat', cls: 'warrior', committedStart: true },
  { name: 'counter-same-committed-guard', weapon: 'longsword', encounter: 'single', policy: 'counter', cls: 'warrior', committedStart: true },
  ...(['mixed', 'restricted'] as const).map(encounter => ({ name: `spear-${encounter}-endurance-stress`, weapon: 'spear' as const, encounter, policy: 'retreat-cycle' as const, stressHp: 100, maxWorld: 20 })),
  { name: 'spear-high-hp-endurance-stress', weapon: 'spear', encounter: 'single', policy: 'retreat-cycle', stressHp: 100, maxWorld: 20 },
];
