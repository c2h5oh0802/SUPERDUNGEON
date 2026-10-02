import { ALL_WEAPONS, ENEMIES, PLAYER, WEAPONS, type PlayerClass, type TalentId, type WeaponId } from '../src/config';
import { forwardFromYaw, yawFromDir } from '../src/core/math';
import { generateLevel } from '../src/gen/validate';
import { counterThreat } from '../src/sim/classSys';
import { applyTalent, gainXp } from '../src/sim/progress';
import { emptyInput, type AttackPhase, type FrameInput } from '../src/sim/types';
import { World } from '../src/sim/world';

export type PressurePolicy = 'walk-hold' | 'stationary-hold' | 'read-counter' | 'read-knife';
export type PressureBuild = 'starting' | 'four-scroll-split' | 'four-scroll-offense' | 'full-clear-split' | 'full-clear-offense';
export interface PressureOptions {
  policy: PressurePolicy;
  build?: PressureBuild;
  weapon?: WeaponId;
  cls?: PlayerClass;
  fps?: number;
  seed?: string;
  reaction?: number;
  startDistance?: number;
  stopDistance?: number;
  attackDelay?: number;
  maxWorldTime?: number;
  maxRealTime?: number;
  trace?: boolean;
  talents?: TalentId[];
  recoveryHits?: 1 | 2;
  dodgeMargin?: number;
}
interface Observation {
  realTime: number;
  x: number;
  z: number;
  radius: number;
  phase: AttackPhase;
  phaseT: number;
  staggerDuration: number;
  attack: string | null;
  locked: boolean;
  lockedYaw: number;
  counter: boolean;
  bolts: Array<{ x: number; z: number; vx: number; vz: number; radius: number }>;
}
const rounded = (n: number) => Number(n.toFixed(4));

/**
 * Actual floor-five arena; declared entry/build fixtures, then World.frame only.
 * No runtime teleport, healing, invulnerability, damage injection, forced boss
 * state, projectile injection, consumable or ammunition use. Levelled fixtures
 * use 70 XP (level five) or 220 XP (level nine), four scroll-equivalent upgrades
 * and no talent bonuses unless the caller explicitly requests disclosed talents.
 * Pending level-up selections are cleared ONLY during fixture setup.
 *
 * Blind bots inspect distance only, never tells, attacks, phases or HP. Stationary
 * hold also fixes yaw. Reading bots consume boss/counter-cue/projectile snapshots
 * at least `reaction` real seconds old. They know their own current action and
 * position and the arena geometry, and aim exactly: these are diagnostic bots,
 * not a claim of human difficulty or input/cue usability. Every skill attack is
 * a real rising fire edge followed by at least one released frame.
 */
export function runWardenPressureScenario(options: PressureOptions) {
  const policy = options.policy, build = options.build ?? 'starting';
  const cls = options.cls ?? (policy === 'read-knife' ? 'huntress' : 'warrior');
  const weapon = options.weapon ?? (policy === 'read-knife' ? 'knife' : 'longsword');
  const fps = options.fps ?? 60, seed = options.seed ?? 'WARDEN-REVIEW';
  const reaction = options.reaction ?? 0, recoveryHits = options.recoveryHits ?? 1;
  const dodgeMargin = options.dodgeMargin ?? .5;
  const startDistance = options.startDistance ?? (policy === 'stationary-hold' ? 2 : 6);
  const stopDistance = options.stopDistance ?? 1.2, attackDelay = options.attackDelay ?? 0;
  const maxWorldTime = options.maxWorldTime ?? 120, maxRealTime = options.maxRealTime ?? 300;
  if (fps <= 0 || reaction < 0 || maxWorldTime <= 0 || maxRealTime <= 0) throw Error('Invalid scenario bounds');
  const world = new World(generateLevel(seed, { floor: 5 }), { cls });
  const p = world.player, boss = world.enemies.find(e => e.kind === 'warden')!;
  p.x = boss.x; p.z = boss.z + startDistance; p.yaw = yawFromDir(boss.x - p.x, boss.z - p.z);
  p.items = []; p.tipped = { paralysis: 0, chill: 0 }; p.bottles = 0; p.stones = 0; p.arrows = 0;
  p.weapon = { id: weapon, level: build === 'starting' ? 0 : build.endsWith('split') ? 2 : 4 };
  if (build !== 'starting') {
    gainXp(world, build.startsWith('full-clear') ? 220 : 70);
    world.pendingChoice = null; world.choiceQueue.length = 0;
    if (build.endsWith('split')) p.armor = { id: 'leather', level: 2 };
  }
  for (const talent of options.talents ?? []) applyTalent(world, talent);
  p.tool = p.desiredTool = 'melee';
  world.updateEncounter(); world.drainEvents();
  const fixture = { floor: world.level.floor, cls, weapon: { ...p.weapon }, armor: { ...p.armor },
    xp: p.xp, level: p.level, playerHp: p.hp, playerMaxHp: p.maxHp, bossHp: boss.hp,
    talents: [...p.talents], startDistance, stopDistance, fixedYaw: policy === 'stationary-hold', ammunition: 0, consumables: 0 };
  const initialYaw = p.yaw;
  const move = (yaw: number, dx: number, dz: number) => {
    const len = Math.hypot(dx, dz) || 1, f = forwardFromYaw(yaw);
    return { moveX: (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / len, moveZ: (dx * f.x + dz * f.z) / len };
  };
  const clearance = (dx: number, dz: number) => {
    const len = Math.hypot(dx, dz) || 1;
    let free = 0;
    for (let n = .2; n <= 2.6; n += .2) {
      if (world.grid.circleBlocked(p.x + dx / len * n, p.z + dz / len * n, PLAYER.radius)) break;
      free = n;
    }
    return free;
  };
  const snapshot = (): Observation => ({ realTime: world.realTime, x: boss.x, z: boss.z, radius: boss.radius,
    phase: boss.phase, phaseT: boss.phaseT, staggerDuration: boss.staggerDur, attack: boss.warden!.attack, locked: boss.locked, lockedYaw: boss.lockedYaw,
    counter: counterThreat(world) !== null,
    bolts: world.projectiles.filter(b => b.alive && b.kind === 'bolt' && b.owner !== 'player')
      .map(b => ({ x: b.pos.x, z: b.pos.z, vx: b.vel.x, vz: b.vel.z, radius: b.radius })) });
  const observations: Observation[] = [];
  let observed: Observation | undefined;
  let observationCursor = 0, priorFire = false, presses = 0, releases = 0, invalidPressEdges = 0;
  let phaseTwoAt: number | null = null, firstResolvedAt: number | null = null, firstHurtAt: number | null = null;
  let lastObservedPhase = '', recoveryAttacks = 0, minDistance = startDistance;
  let dodgeDirection: { x: number; z: number } | null = null;
  let windups = 0, locks = 0, strikes = 0, shots = 0, hits = 0, actions = 0;
  const attackKinds: Record<string, number> = {}, resolvedKinds: Record<string, number> = {};
  const trace: Array<{ time: number; realTime: number; type: string; source?: string; distance: number; bossHp: number; playerHp: number }> = [];
  for (let frame = 0; frame < Math.ceil(fps * maxRealTime) && world.time < maxWorldTime && !p.dead && boss.alive; frame++) {
    if (world.pendingChoice || world.outcome !== 'none') break;
    observations.push(snapshot());
    while (observationCursor < observations.length && observations[observationCursor]!.realTime <= world.realTime - reaction + 1e-9) {
      observed = observations[observationCursor++]!;
    }
    const blind = policy === 'walk-hold' || policy === 'stationary-hold';
    const dx = (blind ? boss.x : observed?.x ?? boss.x) - p.x;
    const dz = (blind ? boss.z : observed?.z ?? boss.z) - p.z;
    const distance = Math.hypot(dx, dz);
    const yaw = policy === 'stationary-hold' ? initialYaw : yawFromDir(dx, dz);
    const out: FrameInput = emptyInput(yaw, 0);
    if (blind) {
      out.fire = world.realTime + 1e-9 >= attackDelay;
      if (policy === 'walk-hold' && distance > stopDistance) out.moveZ = 1;
    } else if (observed) {
      const open = observed.phase === 'recovery' || observed.phase === 'stagger';
      const state = `${observed.phase}/${observed.attack}`;
      if (state !== lastObservedPhase) { if (open) recoveryAttacks = 0; lastObservedPhase = state; }
      const projectile = observed.bolts.find(b => {
        const speed = Math.hypot(b.vx, b.vz) || 1, rx = p.x - b.x, rz = p.z - b.z;
        return (rx * b.vx + rz * b.vz) / speed > 0 &&
          Math.abs(rx * b.vz - rz * b.vx) / speed < PLAYER.radius + b.radius + .35;
      });
      if (!observed.locked && !projectile && observed.phase !== 'charge') dodgeDirection = null;
      let dodge: { x: number; z: number } | null = null;
      if (observed.attack === 'cleave' && (observed.locked || observed.phase === 'active' ||
          (policy === 'read-knife' && observed.phase === 'windup')) && distance < ENEMIES.warden.cleaveReach + PLAYER.radius + dodgeMargin) {
        dodge = { x: -dx, z: -dz };
      }
      if ((observed.attack === 'rush' && (observed.locked || observed.phase === 'charge')) ||
          (observed.attack === 'lance' && observed.locked) || projectile) {
        const f = projectile ? { x: projectile.vx, z: projectile.vz } : forwardFromYaw(observed.lockedYaw);
        const left = { x: -f.z, z: f.x }, right = { x: f.z, z: -f.x };
        dodgeDirection ??= clearance(left.x, left.z) >= clearance(right.x, right.z) ? left : right;
        dodge = dodgeDirection;
      }
      if (policy === 'read-counter' && observed.counter && !p.action && !priorFire) out.fire = true;
      else if (dodge) Object.assign(out, move(yaw, dodge.x, dodge.z));
      else if (policy === 'read-knife' && observed.attack === 'cleave' &&
          (observed.phase === 'windup' || observed.phase === 'active')) out.wait = true;
      else {
        const reach = WEAPONS[p.weapon.id].reach + observed.radius - .15;
        const wp = WEAPONS[p.weapon.id];
        const openingDuration = observed.phase === 'stagger' ? observed.staggerDuration :
          observed.attack === 'lance' ? ENEMIES.warden.lanceRecovery :
          observed.attack === 'rush' ? ENEMIES.warden.rushRecovery : ENEMIES.warden.cleaveRecovery;
        // Optional extra punish requires the ENTIRE additional attack to fit in
        // known recovery, with a conservative real-time observation-delay margin.
        const spareOpening = openingDuration - observed.phaseT - reaction;
        const canPunish = recoveryAttacks === 0 || (recoveryAttacks < recoveryHits &&
          spareOpening >= wp.windup + wp.active + wp.recovery + 1 / fps);
        if (open && canPunish && distance <= reach && !p.action && !priorFire) out.fire = true;
        else if (!p.action && distance > (open ? reach - .1 : 2.2)) Object.assign(out, move(yaw, dx, dz));
        else out.wait = true;
      }
    } else out.wait = true;
    // A held button never emits repeated press edges. Every skill attack must
    // release even when a successful Counter removes recovery on the same frame.
    out.firePressed = out.fire && !priorFire;
    if (out.firePressed) presses++;
    if (!out.fire && priorFire) releases++;
    if (out.firePressed && priorFire) invalidPressEdges++;
    priorFire = out.fire;
    const priorAction = p.action;
    world.frame(1 / fps, out);
    if (!priorAction && p.action?.kind === 'melee') {
      actions++;
      if (observed?.phase === 'recovery' || observed?.phase === 'stagger') recoveryAttacks++;
    }
    minDistance = Math.min(minDistance, Math.hypot(boss.x - p.x, boss.z - p.z));
    if (boss.warden!.phaseTwo && phaseTwoAt === null) phaseTwoAt = rounded(world.time);
    for (const event of world.drainEvents()) {
      if (event.type === 'enemyWindup') { windups++; if (event.source) attackKinds[event.source] = (attackKinds[event.source] ?? 0) + 1; }
      if (event.type === 'enemyLock') locks++;
      if (event.type === 'enemyStrike') strikes++;
      if (event.type === 'enemyFire') shots++;
      if (event.type === 'hitEnemy') hits++;
      if (event.type === 'enemyStrike' || event.type === 'enemyFire') {
        firstResolvedAt ??= rounded(world.time);
        if (event.source) resolvedKinds[event.source] = (resolvedKinds[event.source] ?? 0) + 1;
      }
      if (event.type === 'playerHurt') firstHurtAt ??= rounded(world.time);
      if (options.trace && ['enemyWindup', 'enemyLock', 'enemyStrike', 'enemyFire', 'counter', 'deflect', 'playerHurt', 'hitEnemy'].includes(event.type)) {
        trace.push({ time: rounded(world.time), realTime: rounded(world.realTime), type: event.type, source: event.source,
          distance: rounded(Math.hypot(boss.x - p.x, boss.z - p.z)), bossHp: boss.hp, playerHp: p.hp });
      }
    }
  }
  return { policy, build, fps, seed, reaction, recoveryHits, dodgeMargin, attackDelay, maxWorldTime, maxRealTime, fixture,
    cleared: !boss.alive, dead: p.dead, timedOut: boss.alive && !p.dead && !world.pendingChoice && world.outcome === 'none',
    blockedByChoice: world.pendingChoice !== null && boss.alive,
    playerHp: p.hp, bossHp: boss.hp, damage: Object.values(world.stats.damageTaken).reduce((a, b) => a + b, 0),
    damageBySource: { ...world.stats.damageTaken }, worldTime: rounded(world.time), realTime: rounded(world.realTime),
    counters: world.stats.counters, deflects: world.stats.deflects, presses, releases, invalidPressEdges,
    actions, windups, locks, strikes, shots, hits, attackKinds, resolvedKinds, phaseTwoAt, firstResolvedAt, firstHurtAt,
    minDistance: rounded(minDistance), finalDistance: rounded(Math.hypot(boss.x - p.x, boss.z - p.z)), trace };
}

/** Broad diagnostic data; this matrix deliberately has no universal win/damage assertion. */
export function wardenPressureMatrix() {
  const results: ReturnType<typeof runWardenPressureScenario>[] = [];
  for (const fps of [30, 60, 120]) {
    for (const build of ['starting', 'four-scroll-split', 'four-scroll-offense'] as const) {
      for (const weapon of ALL_WEAPONS) for (const policy of ['walk-hold', 'stationary-hold'] as const) {
        results.push(runWardenPressureScenario({ policy, weapon, build, fps }));
      }
      for (const reaction of [0, .12, .2]) for (const policy of ['read-counter', 'read-knife'] as const) {
        results.push(runWardenPressureScenario({ policy, build, fps, reaction }));
      }
    }
    for (const distance of [2.7, 3.2]) for (const weapon of ['longsword', 'spear'] as const) {
      results.push(runWardenPressureScenario({ policy: 'stationary-hold', weapon, fps, startDistance: distance }));
    }
  }
  return results;
}
