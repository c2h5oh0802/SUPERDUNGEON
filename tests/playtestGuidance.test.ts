import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, WEAPONS } from '../src/config';
import { CalibrationObserver, type CalibrationMilestone } from '../src/playtest/calibration';
import { createPublicPlaytestWorld } from '../src/playtest/scenario';
import { emptyInput, type ActionState } from '../src/sim/types';

/** Ordinary input reachability, not a claim of human usability. The first cycle
 * follows the visible cue phases; the independent second cycle reads the same
 * enemy windup/strike/recovery poses without requesting another solution cue.
 * No camera wiggle, initial walk, injected events, or live-state mutations. */
function followBackwardLesson(fps: number, keepForwardUntilHit: boolean) {
  const world = createPublicPlaytestWorld('calibration');
  const observer = new CalibrationObserver();
  const evidence: CalibrationMilestone[] = [];
  const independentCues = new Set<string>();
  const firstSlowEvidence: { moved: boolean; looked: boolean }[] = [];
  const attackRange = WEAPONS.longsword.reach + ENEMIES.guard.radius;
  let pressedCycle = -1;
  let presses = 0;
  for (let f = 0; f < fps * 45 && !observer.state.learned && !observer.state.restartRecommended; f++) {
    const player = world.player, guard = world.enemies[0]!;
    const before = observer.beforeFrame(world);
    const gap = before.guard!.distance;
    const state = observer.state;
    const input = emptyInput(0, 0);
    const retreat = state.guided
      ? state.phase === 'dodge' || state.phase === 'resolve'
      : (guard.phase === 'windup' && guard.locked) || guard.phase === 'active';
    const punish = state.guided ? state.phase === 'hit-recovery' : guard.phase === 'recovery';
    if (retreat) input.moveZ = -1;
    if (punish && !player.action) {
      // The displayed instruction separates closing distance from clicking.
      input.moveZ = 1;
      if (gap <= attackRange && pressedCycle !== state.cycle) {
        input.fire = true;
        input.firePressed = true;
        input.moveZ = keepForwardUntilHit ? 1 : 0;
        pressedCycle = state.cycle;
        presses++;
      }
    }
    if (player.action?.kind === 'melee') {
      // Melee uses hitSet, never the projectile-only `fired` flag.
      input.moveZ = player.action.hitSet.has(guard.id)
        ? (gap < 2.6 ? -1 : 0)
        : (keepForwardUntilHit ? 1 : 0);
    }
    world.frame(1 / fps, input);
    const update = observer.observeFrame(world, input, before, world.drainEvents());
    evidence.push(...update.milestones);
    if (update.milestones.some(m => m.type === 'stop_slow_seen' && m.cycle === 1)) {
      firstSlowEvidence.push({ moved: update.state.moved, looked: update.state.looked });
    }
    if (update.state.successes === 1) independentCues.add(update.state.cue);
  }
  return { world, observer, evidence, independentCues, firstSlowEvidence, presses };
}

describe('backward calibration guidance', () => {
  it('starts with the ordinary guard directly ahead at three meters', () => {
    const world = createPublicPlaytestWorld('calibration');
    const guard = world.enemies[0]!;
    expect(world.player.x).toBe(guard.x);
    expect(world.player.z - guard.z).toBeCloseTo(3);
    expect(world.player.yaw).toBe(0);
    expect(guard.yaw).toBe(Math.PI);
  });

  for (const fps of [30, 60, 120]) {
    for (const keepForwardUntilHit of [false, true]) {
      it(`completes both backward cycles at ${fps} fps with forward ${keepForwardUntilHit ? 'held until hit' : 'released on click'}`, () => {
        const d = followBackwardLesson(fps, keepForwardUntilHit);
        const diagnostic = JSON.stringify({ state: d.observer.state, evidence: d.evidence });
        expect(d.observer.state.learned, diagnostic).toBe(true);
        expect(d.observer.state.successes).toBe(2);
        expect(d.observer.state.restartRecommended).toBe(false);
        expect(d.world.player.hp).toBe(d.world.player.maxHp);
        expect(d.world.player.yaw).toBe(0);
        expect(d.world.player.pitch).toBe(0);
        expect(d.observer.state.looked).toBe(false);
        expect(d.observer.state.moved).toBe(true);
        expect(d.firstSlowEvidence).toEqual([{ moved: false, looked: false }]);
        expect(d.world.enemies[0]!.alive).toBe(false);
        expect(d.presses).toBe(2);
        expect(d.evidence.filter(m => m.type === 'calibration_cycle_failed')).toEqual([]);
        expect(d.evidence.filter(m => m.type === 'recovery_hit').map(m => m.cycle)).toEqual([1, 2]);
        expect(d.evidence.filter(m => m.type === 'attack_evaded').map(m => m.cycle)).toEqual([1, 2]);
        expect(d.evidence.findIndex(m => m.type === 'stop_slow_seen'))
          .toBeLessThan(d.evidence.findIndex(m => m.type === 'movement_seen'));
        expect(d.independentCues.size).toBe(1);
        expect([...d.independentCues][0]).toContain('再獨立完成一次');
      });
    }
  }

  it('allows a credited late-hit active tail, but still requires genuine evidence for the next cycle', () => {
    const world = createPublicPlaytestWorld('calibration');
    const observer = new CalibrationObserver();
    const evidence: CalibrationMilestone[] = [];
    let creditedAction: ActionState | null = null;
    let creditedRecoveryAge = 0;
    let overlappingActiveFrames = 0;
    let pressed = false;
    for (let f = 0; f < 3000; f++) {
      const player = world.player, guard = world.enemies[0]!;
      const before = observer.beforeFrame(world), gap = before.guard!.distance;
      const input = emptyInput(0, 0);
      if ((guard.phase === 'windup' && guard.locked) || guard.phase === 'active') input.moveZ = -1;
      if (guard.phase === 'recovery' && observer.state.cycle === 1 && !player.action) {
        if (gap > 2.4) input.moveZ = 1;
        else if (!pressed && guard.phaseT >= .42) {
          input.fire = true;
          input.firePressed = true;
          pressed = true;
        }
      }
      if (player.action?.kind === 'melee') {
        input.moveZ = player.action.hitSet.has(guard.id) && gap < 2.6 ? -1 : 0;
      }
      world.frame(1 / 60, input);
      const update = observer.observeFrame(world, input, before, world.drainEvents());
      evidence.push(...update.milestones);
      if (update.milestones.some(m => m.type === 'recovery_hit')) {
        creditedAction = player.action;
        creditedRecoveryAge = guard.phaseT;
      }
      if (observer.state.cycle === 2 && guard.phase === 'windup'
        && player.action !== null && player.action === creditedAction
        && player.action.t < player.action.windup + player.action.active) {
        overlappingActiveFrames++;
        expect(update.state.successes).toBe(1);
        expect(update.milestones.some(m => m.type === 'calibration_cycle_failed')).toBe(false);
      }
      if (observer.state.cycle === 2 && guard.phase === 'recovery') break;
    }
    expect(creditedAction).not.toBeNull();
    expect(creditedRecoveryAge).toBeGreaterThan(.5);
    expect(creditedRecoveryAge).toBeLessThan(ENEMIES.guard.recovery);
    expect(overlappingActiveFrames).toBeGreaterThan(0);
    expect(world.player.hp).toBe(world.player.maxHp);
    expect(observer.state.successes).toBe(1);
    expect(observer.state.learned).toBe(false);
    expect(observer.state.restartRecommended).toBe(false);
    expect(evidence.some(m => m.reason === 'action-before-recovery')).toBe(false);
    // Carryover alone must not supply the next cycle's missing observation.
    expect(evidence.filter(m => m.type === 'stop_slow_seen').map(m => m.cycle)).toEqual([1]);
    expect(evidence.filter(m => m.type === 'recovery_hit').map(m => m.cycle)).toEqual([1]);
    expect(evidence.filter(m => m.type === 'calibration_cycle_failed')).toEqual([
      expect.objectContaining({ cycle: 2, reason: 'incomplete-observe-dodge' }),
    ]);
  });

  it('rejects retreat already outside the committed threat, even after reapproaching during locked windup', () => {
    const world = createPublicPlaytestWorld('calibration');
    const observer = new CalibrationObserver();
    const evidence: CalibrationMilestone[] = [];
    const threatReach = ENEMIES.guard.reach + PLAYER.radius
      + ENEMIES.guard.attackStepSpeed * ENEMIES.guard.active;
    let slowSeen = false, earlyRetreatDone = false, returned = false;
    let commitmentDistance = 0, returnedInsideLockedWindup = false;
    for (let f = 0; f < 2000; f++) {
      const guard = world.enemies[0]!;
      const before = observer.beforeFrame(world), gap = before.guard!.distance;
      const input = emptyInput(0, 0);
      if (slowSeen && !guard.locked) {
        if (gap < 3.7 && !earlyRetreatDone) input.moveZ = -1;
        else earlyRetreatDone = true;
      }
      if (guard.locked && guard.phase === 'windup' && !returned) {
        if (gap > 3.5) input.moveZ = 1;
        else returned = true;
      }
      if (returned || guard.phase === 'active') input.moveZ = -1;
      world.frame(1 / 60, input);
      const update = observer.observeFrame(world, input, before, world.drainEvents());
      evidence.push(...update.milestones);
      if (update.milestones.some(m => m.type === 'stop_slow_seen')) slowSeen = true;
      const after = observer.beforeFrame(world);
      if (!before.guard!.locked && guard.locked) commitmentDistance = after.guard!.distance;
      if (guard.locked && guard.phase === 'windup' && after.guard!.distance <= threatReach) {
        returnedInsideLockedWindup = true;
      }
      if (guard.phase === 'recovery') break;
    }
    expect(commitmentDistance).toBeGreaterThan(threatReach);
    expect(returnedInsideLockedWindup).toBe(true);
    expect(world.player.hp).toBe(world.player.maxHp);
    expect(evidence.some(m => m.type === 'windup_seen')).toBe(true);
    expect(evidence.some(m => m.type === 'stop_slow_seen')).toBe(true);
    expect(evidence.filter(m => ['lock_seen', 'dodge_seen', 'attack_evaded', 'recovery_hit'].includes(m.type))).toEqual([]);
    expect(evidence.filter(m => m.type === 'calibration_cycle_failed')).toEqual([
      expect.objectContaining({ cycle: 1, reason: 'incomplete-observe-dodge' }),
    ]);
    expect(observer.state.successes).toBe(0);
    expect(observer.state.learned).toBe(false);
  });
});
