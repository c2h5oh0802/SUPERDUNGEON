import { queueUse } from './items';
import type { FrameInput, PendingUse } from './types';
import type { World } from './world';

/** UI actions that change a world between frames (the bag, choice cards). */
export type ReplayOp =
  | { kind: 'use'; index: number; mode: PendingUse['mode'] }
  | { kind: 'choose'; index: number }
  | { kind: 'cancelIdentify' };

interface RecordedFrame {
  dt: number;
  input: FrameInput;
  /** Applied before this frame, in order. */
  ops: ReplayOp[];
  /** World time after this frame. */
  time: number;
  /** Periodic state check: a replay that drifts stops instead of showing a different fight. */
  print: string | null;
}

const PRINT_EVERY = 30;

/**
 * Playback pacing: the whole record, from entering the room to the last enemy
 * falling, at a steady `speed` world seconds per real second. Nothing is cut
 * and nothing slows down.
 */
export const REPLAY = { speed: 3 } as const;

function fingerprint(w: World): string {
  const p = w.player;
  let s = `${w.time}|${p.x}|${p.z}|${p.hp}`;
  for (const e of w.enemies) s += `|${e.alive ? 1 : 0}:${e.hp}:${e.x}:${e.z}`;
  return s;
}

export function applyReplayOp(w: World, op: ReplayOp): void {
  if (op.kind === 'use') queueUse(w, op.index, op.mode);
  else if (op.kind === 'choose') w.resolveChoice(op.index);
  else w.cancelIdentifyChoice();
}

/**
 * Records everything that changes a world: each frame's input and the UI actions
 * between frames. The simulation is deterministic, so a fresh copy of the same
 * world fed the same record reproduces the same fight.
 */
export class ReplayRecorder {
  readonly frames: RecordedFrame[] = [];
  private pending: ReplayOp[] = [];
  /** World time when an enemy first started hunting the player. */
  combatStart: number | null = null;
  /** Something outside recorded input changed the world (developer tools): no replay. */
  tainted = false;

  op(op: ReplayOp): void {
    this.pending.push(op);
  }

  /** Call right after w.frame(dt, input), before its events are drained. */
  frame(w: World, dt: number, input: FrameInput): void {
    const n = this.frames.length;
    this.frames.push({ dt, input: { ...input }, ops: this.pending, time: w.time, print: n % PRINT_EVERY === 0 ? fingerprint(w) : null });
    this.pending = [];
    if (this.combatStart === null && w.enemies.some((e) => e.alive && e.state === 'alert')) this.combatStart = w.time;
  }

  get endTime(): number {
    return this.frames.at(-1)?.time ?? 0;
  }
}

/** The fight is over and its record is trustworthy: time to show the replay. */
export function fightCleared(w: World, rec: ReplayRecorder | null): boolean {
  return !!rec && !rec.tainted && w.outcome === 'none' && w.enemies.length > 0 && w.wavesLeft === 0 && w.enemies.every((e) => !e.alive);
}

/**
 * Plays a recorded stretch back by re-simulating a fresh world. Playback follows
 * world time at a steady REPLAY.speed, so the time the player spent stopped to
 * think disappears and the whole fight runs quick.
 */
export class ReplayPlayer {
  readonly world: World;
  private next = 0;
  private clock: number;
  diverged = false;

  constructor(make: () => World, private rec: ReplayRecorder, readonly from: number, readonly to: number) {
    this.world = make();
    this.clock = from;
  }

  /** Fast-forward (no presentation) towards `from`; true once ready to play. */
  prepare(budget: number): boolean {
    for (let n = 0; n < budget && !this.diverged && this.next < this.rec.frames.length && this.rec.frames[this.next]!.time < this.from; n++) this.step();
    this.world.drainEvents();
    return this.diverged || this.next >= this.rec.frames.length || this.rec.frames[this.next]!.time >= this.from;
  }

  /** Advance by real seconds; returns the world seconds simulated. */
  advance(realDt: number, maxSteps = 600): number {
    const before = this.world.time;
    this.clock += realDt * REPLAY.speed;
    for (let n = 0; n < maxSteps && !this.done && this.rec.frames[this.next]!.time <= this.clock; n++) this.step();
    return this.world.time - before;
  }

  get done(): boolean {
    return this.diverged || this.next >= this.rec.frames.length || this.world.time >= this.to;
  }

  private step(): void {
    const r = this.rec.frames[this.next]!;
    for (const op of r.ops) applyReplayOp(this.world, op);
    this.world.frame(r.dt, r.input);
    if (r.print !== null && fingerprint(this.world) !== r.print) this.diverged = true;
    this.next++;
  }
}
