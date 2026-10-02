import { ENEMIES, PLAYER, TIME } from '../config';
import { angleDiff } from '../core/math';
import { observesPoint } from '../sim/observation';
import type { ActionState, AttackPhase, FrameInput, GameEvent } from '../sim/types';
import type { World } from '../sim/world';

export type CalibrationMilestoneType = 'movement_seen' | 'look_seen' | 'windup_seen' | 'stop_slow_seen'
  | 'lock_seen' | 'dodge_seen' | 'attack_evaded' | 'recovery_hit' | 'calibration_cycle_failed'
  | 'calibration_restart_recommended' | 'calibration_learned';
export interface CalibrationMilestone {
  type: CalibrationMilestoneType;
  cycle: number;
  enemyId?: number;
  reason?: string;
}
export interface CalibrationSnapshot {
  realTime: number;
  worldTime: number;
  player: { x: number; z: number; yaw: number; pitch: number; hp: number; action: ActionState | null; actionThreatening: boolean };
  guard: null | {
    id: number; hp: number; alive: boolean; visible: boolean; distance: number; phase: AttackPhase;
    phaseT: number; locked: boolean; hitDone: boolean; paralyzed: boolean;
  };
}
export type CalibrationPhase = 'move-look' | 'approach' | 'observe' | 'dodge' | 'resolve' | 'hit-recovery'
  | 'repeat' | 'learned' | 'restart';
export interface CalibrationState {
  learned: boolean;
  successes: number;
  guided: boolean;
  restartRecommended: boolean;
  moved: boolean;
  looked: boolean;
  phase: CalibrationPhase;
  cue: string;
  cycle: number;
  feedback: string;
}
export interface CalibrationUpdate {
  state: Readonly<CalibrationState>;
  milestones: CalibrationMilestone[];
}
interface Cycle {
  id: number;
  enemyId: number;
  playerHp: number;
  enemyHp: number;
  windupSeen: boolean;
  slowDwell: number;
  slowed: boolean;
  locked: boolean;
  lockX: number;
  lockZ: number;
  displaced: boolean;
  activeSeen: boolean;
  resolved: boolean;
  recoveryAction: ActionState | null;
  failed: boolean;
  counted: boolean;
}

/**
 * Conservative behavioral evidence, not a claim to read understanding.
 * Call beforeFrame immediately before World.frame and observeFrame immediately
 * after, with only that frame's simulation events (before presentation drains them).
 * No test-only learned event, timer completion, HP refill, or combat override.
 */
export class CalibrationObserver {
  private distance = 0;
  private lookAngle = 0;
  private activeCycle: Cycle | null = null;
  private cycleNumber = 0;
  private feedbackUntil = 0;
  private lastRecoveryAction: ActionState | null = null;
  private readonly value: CalibrationState = {
    learned: false, successes: 0, guided: true, restartRecommended: false,
    moved: false, looked: false, phase: 'move-look', cue: '先放開按鍵，看正前方盾衛靠近、舉劍。', cycle: 0, feedback: '',
  };

  get state(): Readonly<CalibrationState> { return { ...this.value }; }

  beforeFrame(world: World): CalibrationSnapshot {
    const p = world.player;
    const guard = world.enemies.find(e => e.kind === 'guard');
    return {
      realTime: world.realTime, worldTime: world.time,
      player: { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, hp: p.hp, action: p.action,
        actionThreatening: p.action !== null && (p.action.kind !== 'melee' || p.action.t < p.action.windup + p.action.active) },
      guard: guard ? {
        id: guard.id, hp: guard.hp, alive: guard.alive, distance: Math.hypot(guard.x - p.x, guard.z - p.z),
        visible: guard.alive && observesPoint(world, { x: guard.x, y: guard.y + 1.15, z: guard.z }),
        phase: guard.phase, phaseT: guard.phaseT, locked: guard.locked,
        hitDone: guard.hitDone, paralyzed: guard.paralyzeT > 0,
      } : null,
    };
  }

  observeFrame(world: World, input: FrameInput, before: CalibrationSnapshot, events: readonly GameEvent[]): CalibrationUpdate {
    const milestones: CalibrationMilestone[] = [];
    const emit = (type: CalibrationMilestoneType, reason?: string) => milestones.push({
      type, cycle: this.cycleNumber, enemyId: before.guard?.id, ...(reason ? { reason } : {}),
    });
    const after = this.beforeFrame(world);
    const realDt = after.realTime - before.realTime;
    if (after.realTime >= this.feedbackUntil) this.value.feedback = '';
    const worldDt = after.worldTime - before.worldTime;
    if (this.value.learned || this.value.restartRecommended || realDt <= 0) return { state: this.state, milestones };
    const distance = Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z);
    if (Math.hypot(input.moveX, input.moveZ) > .05) this.distance += distance;
    this.lookAngle += Math.hypot(angleDiff(after.player.yaw, before.player.yaw), after.player.pitch - before.player.pitch);
    if (!this.value.moved && this.distance >= .3) { this.value.moved = true; emit('movement_seen'); }
    if (!this.value.looked && this.lookAngle >= .12) { this.value.looked = true; emit('look_seen'); }
    const a = after.guard, b = before.guard;
    if (!a || !b || a.id !== b.id) return { state: this.state, milestones };
    const began = a.alive && a.phase === 'windup' && (b.phase !== 'windup' || a.phaseT < b.phaseT);
    if (began) {
      this.activeCycle = {
        id: ++this.cycleNumber, enemyId: a.id, playerHp: before.player.hp, enemyHp: b.hp,
        windupSeen: false, slowDwell: 0, slowed: false, locked: false,
        lockX: after.player.x, lockZ: after.player.z, displaced: false,
        activeSeen: false, resolved: false, recoveryAction: null, failed: false, counted: false,
      };
      this.value.cycle = this.cycleNumber;
    }
    const c = this.activeCycle;
    if (c && !c.failed && !c.counted) {
      const fail = (reason: string) => {
        c.failed = true;
        const reasons: Record<string, string> = {
          'hurt-or-blocked': '這次挨到了：要繼續退到整劍揮完。',
          'attack-interrupted': '這次打斷了攻擊：先練避開，再打收招。',
          'action-before-recovery': '出手太早：等劍完全揮完再攻擊。',
          'damage-before-recovery': '出手太早：等劍完全揮完再攻擊。',
          'incomplete-observe-dodge': '這次未完成觀察與避開，下一劍再試。',
          'recovery-window-missed': '這次回身太晚：避完立刻靠近打一下。',
        };
        this.value.feedback = reasons[reason] ?? '這次未計入，下一劍再試。';
        this.feedbackUntil = after.realTime + 3;
        emit('calibration_cycle_failed', reason);
      };
      const hurtOrBlocked = after.player.hp < c.playerHp || events.some(e => e.type === 'playerHurt' || e.type === 'block');
      const interruption = events.some(e => (e.id === c.enemyId && ['counter', 'push', 'stun', 'tipHit'].includes(e.type)))
        || a.paralyzed || ['stun', 'stagger', 'pushed'].includes(a.phase);
      if (hurtOrBlocked) fail('hurt-or-blocked');
      else if (interruption) fail('attack-interrupted');
      else if (!c.resolved && (input.fire || input.shield || input.bottle || input.potion
        || (before.player.actionThreatening && before.player.action !== this.lastRecoveryAction)
        || (after.player.actionThreatening && after.player.action !== this.lastRecoveryAction))) fail('action-before-recovery');
      else if (!c.resolved && a.hp < c.enemyHp) fail('damage-before-recovery');
      if (!c.failed) {
        const visibleWindup = a.alive && a.visible && a.phase === 'windup';
        if (visibleWindup && !c.windupSeen) { c.windupSeen = true; emit('windup_seen'); }
        // Genuine stationary, action-free slow time while the threat is on screen.
        // A held movement key against a wall, a paused menu, or waiting does not count.
        const stopped = Math.hypot(input.moveX, input.moveZ) < .01 && distance < .005
          && !input.wait && !input.fire && !input.shield && !before.player.action && !after.player.action;
        // Facing the already-centered guard is valid observation; no hidden
        // requirement to wiggle the camera or walk into sword range first.
        if (visibleWindup && stopped
          && worldDt > 0 && worldDt / realDt <= TIME.idleRate + .025) c.slowDwell += realDt;
        else if (!c.slowed) c.slowDwell = 0;
        if (!c.slowed && c.slowDwell >= .3) { c.slowed = true; emit('stop_slow_seen'); }
        // Evidence must start inside this committed sword's possible reach,
        // including its native forward step; standing far away is not a dodge.
        const threatened = a.distance <= ENEMIES.guard.reach + PLAYER.radius
          + ENEMIES.guard.attackStepSpeed * ENEMIES.guard.active;
        if (!c.locked && visibleWindup && !b.locked && a.locked && threatened && c.windupSeen && c.slowed) {
          c.locked = true; c.lockX = after.player.x; c.lockZ = after.player.z; emit('lock_seen');
        }
        if (c.locked && b.locked && (b.phase === 'windup' || b.phase === 'active')
          && Math.hypot(input.moveX, input.moveZ) > .05 && distance > .001
          && Math.hypot(after.player.x - c.lockX, after.player.z - c.lockZ) >= .5) {
          if (!c.displaced) emit('dodge_seen');
          c.displaced = true;
        }
        if (a.phase === 'active' && a.alive) c.activeSeen = true;
        if (b.phase === 'active' && a.phase === 'recovery' && a.alive) {
          if (c.windupSeen && c.slowed && c.locked && c.displaced && c.activeSeen && !a.hitDone) {
            c.resolved = true;
            emit('attack_evaded');
          }
          else fail('incomplete-observe-dodge');
        }
        // A fresh real melee action must begin after the full active phase ended.
        if (c.resolved && b.phase === 'recovery' && !before.player.action && input.fire && input.firePressed
          && after.player.action?.kind === 'melee' && !after.player.action.counter) c.recoveryAction = after.player.action;
        const sameMeleeAction = c.recoveryAction !== null
          && (before.player.action === c.recoveryAction || after.player.action === c.recoveryAction);
        // Snapshot is essential: a lethal hit resets the target's live phase to none.
        // Reject a frame that could cross the end of recovery; this is conservative.
        const whollyInRecovery = b.phase === 'recovery' && b.phaseT + worldDt < ENEMIES.guard.recovery + 1e-6;
        const recoveryHit = c.resolved && sameMeleeAction && whollyInRecovery && b.visible
          && a.hp < b.hp && events.some(e => e.type === 'hitEnemy' && e.id === a.id && e.source === 'melee' && (e.amount ?? 0) > 0);
        if (recoveryHit) {
          c.counted = true;
          this.value.successes++;
          this.lastRecoveryAction = c.recoveryAction;
          this.value.guided = false;
          this.value.feedback = `命中！放開攻擊、往後退開。完成 ${this.value.successes}/2。`;
          this.feedbackUntil = after.realTime + 3;
          emit('recovery_hit');
          if (this.value.successes === 2) { this.value.learned = true; emit('calibration_learned'); }
        } else if (c.resolved && a.alive && b.phase === 'recovery' && a.phase !== 'recovery') fail('recovery-window-missed');
      }
    }
    if (!this.value.learned && (!a.alive || world.player.dead)) {
      this.value.restartRecommended = true;
      emit('calibration_restart_recommended', !a.alive ? 'guard-defeated-before-two-cycles' : 'player-defeated');
    }
    this.updateCue(after);
    return { state: this.state, milestones };
  }

  private updateCue(after: CalibrationSnapshot): void {
    const s = this.value, c = this.activeCycle;
    if (s.learned) { s.phase = 'learned'; s.cue = '已完成兩次觀察、避開與收招命中。'; }
    else if (s.restartRecommended) { s.phase = 'restart'; s.cue = '盾衛或角色已倒下。重新試一次；不用離開試玩。'; }
    else if (!s.guided) { s.phase = 'repeat'; s.cue = '再獨立完成一次：停下觀察 → 避開整劍 → 收招時命中。'; }
    else if (c?.failed && after.guard?.phase !== 'none') {
      s.phase = 'resolve';
      s.cue = after.guard?.phase === 'recovery'
        ? '先放開攻擊，等他下一次舉劍再試。'
        : '繼續退開，先躲完這一劍；下一劍再試。';
    }
    else if (!c || c.failed || c.counted || after.guard?.phase === 'none') {
      s.phase = after.guard && after.guard.distance > 3.2 ? 'approach' : 'move-look';
      s.cue = s.phase === 'approach' ? '往前小步靠近盾衛；先別攻擊。' : '先放開按鍵，看正前方盾衛靠近、舉劍。';
    }
    else if (!c.slowed) { s.phase = 'observe'; s.cue = '放開移動與攻擊，看著他舉劍；停下會讓時間變慢。'; }
    else if (!c.locked) { s.phase = 'observe'; s.cue = '繼續停著看；等這裡出現「後退」。'; }
    else if (!c.displaced) { s.phase = 'dodge'; s.cue = '現在往後退！繼續退到他整劍揮完，先別攻擊。'; }
    else if (!c.resolved) { s.phase = 'resolve'; s.cue = '繼續往後退，還沒揮完；先別往前，也別攻擊。'; }
    else { s.phase = 'hit-recovery'; s.cue = '躲開了！立刻往前靠近，攻擊一下，再放開。'; }
  }
}
