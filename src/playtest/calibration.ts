import { PLAYER, TIME } from '../config';
import { angleDiff, forwardFromYaw, type V2 } from '../core/math';
import { addItem } from '../sim/items';
import type { ActionState, FrameInput, GameEvent } from '../sim/types';
import type { World } from '../sim/world';

export type CalibrationMilestoneType = 'movement_seen' | 'look_seen' | 'stop_slow_seen'
  | 'counter_observed' | 'deflect_observed' | 'hurt_observed' | 'guard_defeated'
  | 'healing_used' | 'healing_skipped_resource_lost' | 'calibration_complete';
export interface CalibrationMilestone { type: CalibrationMilestoneType }
export interface CalibrationSnapshot {
  realTime: number;
  worldTime: number;
  player: { x: number; z: number; yaw: number; pitch: number; action: ActionState | null };
}
export interface CalibrationState {
  complete: boolean;
  moved: boolean;
  looked: boolean;
  slowObserved: boolean;
  guardDefeated: boolean;
  healingUsed: boolean;
  healingSkipped: boolean;
  phase: 'combat' | 'slow' | 'healing' | 'optional';
  cue: string;
}
export interface CalibrationUpdate {
  state: Readonly<CalibrationState>;
  milestones: CalibrationMilestone[];
}

/** Prefer the view direction, then fan out deterministically near walls/corners.
 * Check the actual player footprint along the whole approach, not only the
 * destination tile: a visible bottle must also be reachable by ordinary walking. */
function healingPickupPosition(world: World): V2 | null {
  const p = world.player;
  // Leaves 1.5 m of walking outside automatic pickup range, including enough
  // room for the normal movement deceleration after a moving finishing blow.
  const distance = PLAYER.pickupRadius + 1.5;
  const steps = Math.ceil(distance / .08);
  for (let i = 0; i < 16; i++) {
    const turn = Math.ceil(i / 2) * (i % 2 ? 1 : -1) * Math.PI / 8;
    const direction = forwardFromYaw(p.yaw + turn);
    const target = { x: p.x + direction.x * distance, z: p.z + direction.z * distance };
    let walkable = true;
    for (let step = 0; step <= steps; step++) {
      const t = step / steps;
      if (world.grid.circleBlocked(p.x + (target.x - p.x) * t, p.z + (target.z - p.z) * t, PLAYER.radius)) {
        walkable = false;
        break;
      }
    }
    if (walkable && world.grid.lineOfSight(
      { x: p.x, y: PLAYER.eyeHeight, z: p.z }, { ...target, y: .15 },
    )) return target;
  }
  // The open calibration arena always has a candidate. If its layout changes,
  // retry from a later position instead of granting an unreachable/instant item.
  return null;
}

/** Factual milestones, never a test of understanding or a prescribed combat sequence.
 * The same frame observer supplies bounded facts for the independent core attempt.
 * Only the disposable calibration gets authored supplies or progression. */
export class CalibrationObserver {
  private distance = 0;
  private lookAngle = 0;
  private slowDwell = 0;
  private healingSupplied = false;
  private readonly seen = new Set<CalibrationMilestoneType>();
  private readonly value: CalibrationState = {
    complete: false, moved: false, looked: false, slowObserved: false,
    guardDefeated: false, healingUsed: false, healingSkipped: false,
    phase: 'combat', cue: '停下會讓時間變慢；移動與行動會推進時間。觀察盾衛的預備動作，用自己的方式擊倒他。',
  };

  get state(): Readonly<CalibrationState> { return { ...this.value }; }

  beforeFrame(world: World): CalibrationSnapshot {
    const p = world.player;
    return { realTime: world.realTime, worldTime: world.time,
      player: { x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, action: p.action } };
  }

  observeFrame(world: World, input: FrameInput, before: CalibrationSnapshot, events: readonly GameEvent[]): CalibrationUpdate {
    const milestones: CalibrationMilestone[] = [];
    const emit = (type: CalibrationMilestoneType) => {
      if (!this.seen.has(type)) { this.seen.add(type); milestones.push({ type }); }
    };
    const after = this.beforeFrame(world);
    const realDt = after.realTime - before.realTime;
    if (realDt <= 0) return { state: this.state, milestones };
    const worldDt = after.worldTime - before.worldTime;
    const distance = Math.hypot(after.player.x - before.player.x, after.player.z - before.player.z);
    if (Math.hypot(input.moveX, input.moveZ) > .05) this.distance += distance;
    this.lookAngle += Math.hypot(angleDiff(after.player.yaw, before.player.yaw), after.player.pitch - before.player.pitch);
    if (!this.value.moved && this.distance >= .3) { this.value.moved = true; emit('movement_seen'); }
    if (!this.value.looked && this.lookAngle >= .12) { this.value.looked = true; emit('look_seen'); }
    const stopped = Math.hypot(input.moveX, input.moveZ) < .01 && distance < .005
      && !input.wait && !input.fire && !input.shield && !before.player.action && !after.player.action;
    if (!this.value.slowObserved) {
      this.slowDwell = stopped && worldDt > 0 && worldDt / realDt <= TIME.idleRate + .025
        ? this.slowDwell + realDt : 0;
      if (this.slowDwell >= .3) { this.value.slowObserved = true; emit('stop_slow_seen'); }
    }
    for (const [event, milestone] of [['counter', 'counter_observed'], ['deflect', 'deflect_observed'], ['playerHurt', 'hurt_observed']] as const)
      if (events.some(e => e.type === event)) emit(milestone);
    if (world.level.publicPlaytest !== 'calibration' || this.value.complete) return { state: this.state, milestones };

    const guard = world.enemies.find(e => e.kind === 'guard');
    if (guard && !guard.alive && !this.value.guardDefeated) {
      this.value.guardDefeated = true;
      emit('guard_defeated');
    }
    if (!this.value.guardDefeated) this.value.phase = 'combat';
    else if (!this.value.slowObserved) this.value.phase = 'slow';
    else {
      this.value.phase = 'healing';
      if (!this.healingSupplied) {
        // Exactly one ordinary pickup; it enters the bag through updatePickups.
        // The wound was authored at spawn, never added after the fight.
        const position = healingPickupPosition(world);
        if (position) {
          world.addPickup('item', 1, position.x, .15, position.z, null, 'potion:healing', 0);
          this.healingSupplied = true;
        }
      } else if (world.stats.healingUsed > 0) {
        this.value.healingUsed = true;
        emit('healing_used');
        this.finish(world, emit);
      } else {
        const available = world.player.items.some(i => i.id === 'potion:healing' && i.count > 0)
          || world.pickups.some(p => p.item === 'potion:healing' && !p.taken)
          || world.player.action?.item === 'potion:healing';
        // An intact dropped item can be picked up normally. A thrown/otherwise
        // spent bottle must not trap the player or generate unlimited supplies.
        if (!available) {
          this.value.healingSkipped = true;
          emit('healing_skipped_resource_lost');
          this.finish(world, emit);
        }
      }
    }
    this.value.cue = this.value.phase === 'combat'
      ? '停下會讓時間變慢；移動與行動會推進時間。觀察盾衛的預備動作，用自己的方式擊倒他。'
      : this.value.phase === 'slow'
      ? '盾衛已倒下。放開移動與行動，試試停下後時間變慢。'
      : this.value.phase === 'healing'
      ? '戰鬥結束，附近地上有一瓶治療藥水。走過去撿起後可從背包使用，或用補血快捷鍵。'
      : '未知藥水與卷軸可透過使用或鑑定得知效果；這次可直接進入核心遭遇。';
    return { state: this.state, milestones };
  }

  private finish(world: World, emit: (type: CalibrationMilestoneType) => void): void {
    this.value.complete = true;
    this.value.phase = 'optional';
    // One real unknown consumable, displayed by the ordinary inventory.
    // No identification action, knowledge mutation or use is required to leave.
    addItem(world, 'potion:haste');
    emit('calibration_complete');
  }
}
