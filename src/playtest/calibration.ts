import { ENEMIES, TIME } from '../config';
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
    id: number; hp: number; alive: boolean; visible: boolean; phase: AttackPhase;
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
  private readonly value: CalibrationState = {
    learned: false, successes: 0, guided: true, restartRecommended: false,
    moved: false, looked: false, phase: 'move-look', cue: 'WASD 移動，移動滑鼠轉頭看看。', cycle: 0,
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
        id: guard.id, hp: guard.hp, alive: guard.alive,
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
      const fail = (reason: string) => { c.failed = true; emit('calibration_cycle_failed', reason); };
      const hurtOrBlocked = after.player.hp < c.playerHp || events.some(e => e.type === 'playerHurt' || e.type === 'block');
      const interruption = events.some(e => (e.id === c.enemyId && ['counter', 'push', 'stun', 'tipHit'].includes(e.type)))
        || a.paralyzed || ['stun', 'stagger', 'pushed'].includes(a.phase);
      if (hurtOrBlocked) fail('hurt-or-blocked');
      else if (interruption) fail('attack-interrupted');
      else if (!c.resolved && (input.fire || input.shield || input.bottle || input.potion || before.player.actionThreatening || after.player.actionThreatening)) fail('action-before-recovery');
      else if (!c.resolved && a.hp < c.enemyHp) fail('damage-before-recovery');
      if (!c.failed) {
        const visibleWindup = a.alive && a.visible && a.phase === 'windup';
        if (visibleWindup && !c.windupSeen) { c.windupSeen = true; emit('windup_seen'); }
        // Genuine stationary, action-free slow time while the threat is on screen.
        // A held movement key against a wall, a paused menu, or waiting does not count.
        const stopped = Math.hypot(input.moveX, input.moveZ) < .01 && distance < .005
          && !input.wait && !input.fire && !input.shield && !before.player.action && !after.player.action;
        if (visibleWindup && this.value.moved && this.value.looked && stopped
          && worldDt > 0 && worldDt / realDt <= TIME.idleRate + .025) c.slowDwell += realDt;
        else if (!c.slowed) c.slowDwell = 0;
        if (!c.slowed && c.slowDwell >= .3) { c.slowed = true; emit('stop_slow_seen'); }
        if (!c.locked && visibleWindup && a.locked && c.windupSeen && c.slowed) {
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
          this.value.guided = false;
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
    else if (s.restartRecommended) { s.phase = 'restart'; s.cue = '這次尚未完成兩次有效循環。請重新校準，再試一次。'; }
    else if (!s.guided) { s.phase = 'repeat'; s.cue = '再獨立完成一次。這次不提供解法提示。'; }
    else if (!s.moved || !s.looked) { s.phase = 'move-look'; s.cue = 'WASD 移動，移動滑鼠轉頭看看。'; }
    else if (!c || c.failed || c.counted || after.guard?.phase === 'none') { s.phase = 'approach'; s.cue = '面向盾衛，靠近到他開始舉劍。'; }
    else if (!c.slowed) { s.phase = 'observe'; s.cue = '放開移動與攻擊，面向盾衛；停下時，世界會慢下來。'; }
    else if (!c.locked) { s.phase = 'observe'; s.cue = '保持觀察，等他的劍與攻擊方向不再追著你。'; }
    else if (!c.displaced) { s.phase = 'dodge'; s.cue = '方向已鎖定。現在移開，避開這一劍；先不要攻擊。'; }
    else if (!c.resolved) { s.phase = 'resolve'; s.cue = '先讓這一劍完全揮完，保持在攻擊範圍外。'; }
    else { s.phase = 'hit-recovery'; s.cue = '他正在收招。靠近，按一下攻擊，命中後放開。'; }
  }
}
