import { describe, expect, it } from 'vitest';
import { CLASSES, ENEMIES, PLAYER, WEAPONS } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { CalibrationObserver, type CalibrationMilestone } from '../src/playtest/calibration';
import { createPublicPlaytestWorld, PUBLIC_BUILD_ID } from '../src/playtest/scenario';
import { Nav } from '../src/sim/nav';
import { emptyInput, type FrameInput, type GameEvent } from '../src/sim/types';

const DT = 1 / 60;
function driver(world = createPublicPlaytestWorld('calibration')) {
  const observer = new CalibrationObserver();
  const evidence: CalibrationMilestone[] = [];
  const independentCues = new Set<string>();
  const frame = (partial: Partial<FrameInput> = {}, injected: GameEvent[] = []) => {
    const input = { ...emptyInput(world.player.yaw, world.player.pitch), ...partial };
    const before = observer.beforeFrame(world);
    world.frame(DT, input);
    const events = [...world.drainEvents(), ...injected];
    const update = observer.observeFrame(world, input, before, events);
    evidence.push(...update.milestones);
    if (update.state.successes === 1 && !update.state.restartRecommended) independentCues.add(update.state.cue);
    return update;
  };
  return { world, observer, evidence, independentCues, frame };
}

/** Ordinary frame inputs only. Reads combat state to act deterministically; never
 * sets HP, phase, positions, learned flags, or injects a success event. */
function performCycles(d: ReturnType<typeof driver>, options: { dodge?: boolean; lookAway?: boolean; holdAttack?: boolean; freshPress?: boolean } = {}) {
  let attackCycle = -1;
  const phaseChanges: string[] = [];
  let lastPhase = '';
  for (let f = 0; f < 12000 && !d.observer.state.learned && !d.observer.state.restartRecommended; f++) {
    const w = d.world, p = w.player, e = w.enemies[0]!;
    let yaw = yawFromDir(e.x - p.x, e.z - p.z);
    // Genuine initial camera motion, then return to viewing the guard.
    if (f < 12) yaw += .2;
    if (options.lookAway) yaw += Math.PI;
    const input: Partial<FrameInput> = { yaw };
    const distance = Math.hypot(e.x - p.x, e.z - p.z);
    if (e.phase === 'none') input.moveZ = distance > 2.5 ? (options.lookAway ? -1 : 1) : 0;
    if ((e.phase === 'windup' && e.locked) || e.phase === 'active') input.moveZ = options.dodge === false ? 0 : (options.lookAway ? 1 : -1);
    if (e.phase === 'recovery' && !p.action) {
      input.moveZ = options.lookAway ? -1 : 1;
      if (distance <= 2.75 && attackCycle !== d.observer.state.cycle) {
        input.fire = true; input.firePressed = options.freshPress !== false; attackCycle = d.observer.state.cycle;
      }
    }
    if (p.action?.kind === 'melee') input.moveZ = p.action.fired ? (distance < 2.5 ? -1 : 0) : (distance > 2.1 ? 1 : 0);
    if (options.holdAttack) { input.fire = true; input.firePressed = f === 0; }
    d.frame(input);
    const phase = `${e.phase}/${d.observer.state.phase}/${d.observer.state.successes}`;
    if (phase !== lastPhase) { phaseChanges.push(`${f}:${phase} hp${p.hp}/${e.hp} d${distance.toFixed(2)}`); lastPhase = phase; }
  }
  return phaseChanges;
}

describe('RemoteValidationV1 disposable fixtures', () => {
  it('uses one ordinary guard and the unmodified starting warrior kit', () => {
    const w = createPublicPlaytestWorld('calibration');
    expect(PUBLIC_BUILD_ID).toBe('RemoteValidationV1');
    expect(w.level.publicPlaytest).toBe('calibration');
    expect(w.level.practiceTrial).toBeUndefined();
    expect(w.enemies).toHaveLength(1);
    expect(w.enemies[0]!.hp).toBe(ENEMIES.guard.hp);
    expect(w.player.weapon).toEqual({ id: CLASSES.warrior.weapon, level: 0 });
    expect(w.player.items).toEqual([]);
    expect(w.player.talents).toEqual([]);
    expect(w.pickups).toEqual([]);
    expect(w.interactables).toEqual([]);
    expect(w.level.torches.length).toBeGreaterThan(0);
    expect(w.player.stones).toBe(CLASSES.warrior.start.stones);
    expect(ENEMIES.guard.hp).toBe(2 * WEAPONS.longsword.damage);
  });

  it('reuses shield-crossfire geometry without the demonstration kit or carry', () => {
    const a = createPublicPlaytestWorld('core'), b = createPublicPlaytestWorld('core');
    expect(a.level.publicPlaytest).toBe('core');
    expect(a.level.practiceTrial).toBe('shield-crossfire');
    expect(a.enemies.map(e => e.kind)).toEqual(['guard', 'archer']);
    expect(a.player.items).toEqual([]);
    expect(a.player.talents).toEqual([]);
    for (let f = 0; f < 100; f++) a.frame(DT, { ...emptyInput(a.player.yaw), wait: true });
    expect(a.time).toBeGreaterThan(1);
    expect(a.player.hunger).toBe(0);
    expect(a.player).not.toBe(b.player);
    a.player.hp = 1;
    expect(b.player.hp).toBe(b.player.maxHp);
  });
});

describe('public core ordinary-input reachability', () => {
  it('can clear both original shield-crossfire enemies with the native warrior sword', () => {
    // State-informed deterministic bot, not evidence of human usability or fun.
    // The only mutations are World.frame with ordinary movement/look/attack input.
    const w = createPublicPlaytestWorld('core');
    const nav = new Nav(w.grid, PLAYER.radius);
    const hitSources: string[] = [];
    const defeated: string[] = [];
    for (let f = 0; f < 60 * 60 && !w.player.dead && w.enemies.some(e => e.alive); f++) {
      const p = w.player;
      const target = w.enemies.filter(e => e.alive).sort((a, b) =>
        Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]!;
      const gap = Math.hypot(target.x - p.x, target.z - p.z);
      const yaw = yawFromDir(target.x - p.x, target.z - p.z);
      const input = emptyInput(yaw);
      const path = nav.findPath(p.x, p.z, target.x, target.z);
      const waypoint = path?.find(point => Math.hypot(point.x - p.x, point.z - p.z) > .12);
      if (waypoint && gap > 1.65) {
        const dx = waypoint.x - p.x, dz = waypoint.z - p.z;
        const length = Math.hypot(dx, dz);
        input.moveX = (dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length;
        input.moveZ = (-dx * Math.sin(yaw) - dz * Math.cos(yaw)) / length;
      }
      if (!p.action && gap <= 2.3) { input.fire = true; input.firePressed = true; }
      w.frame(DT, input);
      for (const event of w.drainEvents()) {
        if (event.type === 'hitEnemy') hitSources.push(event.source ?? 'unknown');
        if (event.type === 'enemyDeath') defeated.push(event.kind ?? 'unknown');
      }
    }
    const metrics = { realSeconds: Number(w.realTime.toFixed(3)), worldSeconds: Number(w.time.toFixed(3)),
      damage: Object.values(w.stats.damageTaken).reduce((total, amount) => total + amount, 0),
      hp: w.player.hp, kills: w.stats.kills, defeated, hitSources,
      position: [Number(w.player.x.toFixed(2)), Number(w.player.z.toFixed(2))] };
    console.info('RemoteValidationV1 core state-informed bot:', JSON.stringify(metrics));
    expect(w.player.dead, JSON.stringify(metrics)).toBe(false);
    expect(w.stats.kills, JSON.stringify(metrics)).toBe(2);
    expect(defeated).toEqual(['guard', 'archer']);
    expect(hitSources).toEqual(['melee', 'melee', 'melee']);
    expect(w.player.weapon).toEqual({ id: CLASSES.warrior.weapon, level: 0 });
    expect(w.player.items).toEqual([]);
    expect(w.player.talents).toEqual([]);
    expect(w.player.xp).toBe(0);
    expect(w.player.hunger).toBe(0);
    expect(w.player.stones).toBe(CLASSES.warrior.start.stones);
  });
});

describe('calibration evidence from real World frames', () => {
  it('accepts two separate visible slow-observe, committed dodge, full resolution, recovery-hit cycles, including lethal hit', () => {
    const d = driver();
    const phases = performCycles(d);
    expect(d.observer.state.learned, JSON.stringify({ phases, evidence: d.evidence }, null, 2)).toBe(true);
    expect(d.observer.state.successes).toBe(2);
    expect(d.observer.state.guided).toBe(false);
    expect(d.observer.state.restartRecommended).toBe(false);
    expect(d.world.enemies[0]!.alive).toBe(false);
    expect(d.world.enemies[0]!.phase).toBe('none');
    expect(d.world.player.hp).toBe(d.world.player.maxHp);
    expect(d.world.player.hunger).toBe(0);
    expect(d.world.player.xp).toBe(0);
    expect(d.world.pickups).toEqual([]);
    expect([...d.independentCues]).toEqual(['再獨立完成一次。這次不提供解法提示。']);
    expect(d.evidence.filter(e => e.type === 'recovery_hit').map(e => e.cycle)).toEqual([1, 2]);
    expect(d.evidence.filter(e => e.type === 'stop_slow_seen')).toHaveLength(2);
    expect(d.evidence.filter(e => e.type === 'dodge_seen')).toHaveLength(2);
    expect(d.evidence.filter(e => e.type === 'attack_evaded').map(e => e.cycle)).toEqual([1, 2]);
    expect(d.evidence.filter(e => e.type === 'calibration_learned')).toHaveLength(1);
  });

  it('does not learn from elapsed time or invented semantic events', () => {
    const d = driver();
    for (let f = 0; f < 3600 && !d.world.player.dead; f++) d.frame({ wait: true }, [{ type: 'learned' } as unknown as GameEvent]);
    expect(d.observer.state.learned).toBe(false);
    expect(d.observer.state.successes).toBe(0);
    expect(d.observer.state.moved).toBe(false);
    expect(d.observer.state.looked).toBe(false);
    expect(d.evidence.some(e => e.type === 'recovery_hit')).toBe(false);
  });

  it('does not accept holding attack and asks for a real restart if the guard is killed early', () => {
    const d = driver();
    performCycles(d, { holdAttack: true });
    expect(d.observer.state.learned).toBe(false);
    expect(d.observer.state.successes).toBe(0);
    expect(d.world.enemies[0]!.alive).toBe(false);
    expect(d.observer.state.restartRecommended).toBe(true);
    expect(d.evidence.some(e => e.type === 'calibration_restart_recommended')).toBe(true);
  });

  it('requires a fresh attack press during recovery, not a held attack level', () => {
    const d = driver();
    performCycles(d, { freshPress: false });
    expect(d.world.enemies[0]!.alive).toBe(false);
    expect(d.world.player.hp).toBe(d.world.player.maxHp);
    expect(d.observer.state.successes).toBe(0);
    expect(d.observer.state.learned).toBe(false);
    expect(d.observer.state.restartRecommended).toBe(true);
  });

  it('rejects an actual counter interruption rather than crediting it as a dodge', () => {
    const d = driver();
    const w = d.world, guard = w.enemies[0]!;
    for (let f = 0; f < 2000 && !guard.locked; f++) {
      const yaw = yawFromDir(guard.x - w.player.x, guard.z - w.player.z) + (f < 12 ? .2 : 0);
      d.frame({ yaw, moveZ: guard.phase === 'none' ? 1 : 0 });
    }
    expect(guard.locked).toBe(true);
    d.frame({ fire: true, firePressed: true });
    for (let f = 0; f < 30; f++) d.frame();
    expect(w.stats.counters).toBe(1);
    expect(guard.phase).toBe('stagger');
    expect(d.observer.state.successes).toBe(0);
    expect(d.observer.state.learned).toBe(false);
    expect(d.evidence.some(e => e.type === 'calibration_cycle_failed')).toBe(true);
  });

  it('rejects a cycle that takes damage instead of evading the whole active phase', () => {
    const d = driver();
    performCycles(d, { dodge: false });
    expect(d.world.player.hp).toBeLessThan(d.world.player.maxHp);
    expect(d.observer.state.learned).toBe(false);
    expect(d.observer.state.successes).toBe(0);
    expect(d.evidence.some(e => e.type === 'calibration_cycle_failed' && e.reason === 'hurt-or-blocked')).toBe(true);
  });

  it('does not accept an off-camera threat even when the world attack phases continue', () => {
    const d = driver();
    performCycles(d, { lookAway: true });
    expect(d.observer.state.learned).toBe(false);
    expect(d.observer.state.successes).toBe(0);
    expect(d.evidence.some(e => e.type === 'stop_slow_seen')).toBe(false);
    expect(d.evidence.some(e => e.type === 'windup_seen')).toBe(false);
  });
});
