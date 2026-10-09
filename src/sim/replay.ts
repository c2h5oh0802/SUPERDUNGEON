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
  /** Something threatening or decisive is going on (otherwise the highlight skims it). */
  active: boolean;
}

const PRINT_EVERY = 30;

/**
 * Highlight pacing, in world seconds per real second: twice normal speed; slow
 * motion around decisive moments (kills, deflects, counters, air bursts, hits,
 * near misses); quick through stretches where nothing threatens. The window is
 * trimmed so the whole replay takes about `cap` real seconds.
 */
export const REPLAY = { base: 2, slow: 0.3, fast: 4, before: 0.3, after: 0.25, nearMiss: 0.8, cap: 12 } as const;

const MOMENTS = new Set(['enemyDeath', 'redirectKill', 'deflect', 'counter', 'playerHurt']);
const CALM = new Set(['none', 'reload', 'recovery']);

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
  /** World times of decisive moments, in order. */
  readonly moments: number[] = [];
  private nearMissed = new Set<number>();

  op(op: ReplayOp): void {
    this.pending.push(op);
  }

  /** Call right after w.frame(dt, input), before its events are drained. */
  frame(w: World, dt: number, input: FrameInput): void {
    const n = this.frames.length;
    const p = w.player;
    let moment = w.events.some((e) => MOMENTS.has(e.type) || (e.type === 'bottleBreak' && e.air));
    let hostile = false;
    for (const q of w.projectiles) {
      if (!q.alive || q.owner === 'player') continue;
      hostile = true;
      if (!this.nearMissed.has(q.id) && Math.hypot(q.pos.x - p.x, q.pos.z - p.z) < REPLAY.nearMiss) {
        this.nearMissed.add(q.id);
        moment = true;
      }
    }
    const active = hostile || p.action !== null || w.enemies.some((e) => e.alive && !CALM.has(e.phase));
    if (moment && this.moments.at(-1) !== w.time) this.moments.push(w.time);
    this.frames.push({ dt, input: { ...input }, ops: this.pending, time: w.time, print: n % PRINT_EVERY === 0 ? fingerprint(w) : null, active });
    this.pending = [];
    if (this.combatStart === null && w.enemies.some((e) => e.alive && e.state === 'alert')) this.combatStart = w.time;
  }

  get endTime(): number {
    return this.frames.at(-1)?.time ?? 0;
  }

  /** Playback speed (world seconds per real second) at world time t, given that frame's activity. */
  speedAt(t: number, active: boolean): number {
    for (const m of this.moments) if (t >= m - REPLAY.before && t <= m + REPLAY.after) return REPLAY.slow;
    return active ? REPLAY.base : REPLAY.fast;
  }

  /**
   * The stretch worth watching: from just before the fight to the end, trimmed
   * from the start so it plays in about `cap` real seconds at highlight pacing.
   */
  window(cap: number = REPLAY.cap): { from: number; to: number } {
    const to = this.endTime;
    let from = Math.max(0, (this.combatStart ?? 0) - 1);
    let real = 0;
    for (let k = this.frames.length - 1; k > 0; k--) {
      const f = this.frames[k]!, prev = this.frames[k - 1]!;
      if (prev.time < from) break;
      real += (f.time - prev.time) / this.speedAt(f.time, f.active);
      if (real > cap) {
        from = f.time;
        break;
      }
    }
    return { from, to };
  }
}

/** The fight is over and its record is trustworthy: time to show the replay. */
export function fightCleared(w: World, rec: ReplayRecorder | null): boolean {
  return !!rec && !rec.tainted && w.outcome === 'none' && w.enemies.length > 0 && w.wavesLeft === 0 && w.enemies.every((e) => !e.alive);
}

/**
 * Plays a recorded stretch back by re-simulating a fresh world. Playback follows
 * world time at highlight pacing, so the time the player spent stopped to think
 * disappears, the action runs quick and the decisive moments slow down.
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
    let left = realDt;
    let n = 0;
    // Small slices so a change of pace takes effect where it belongs.
    while (left > 1e-9 && !this.done && n < maxSteps) {
      const slice = Math.min(left, 1 / 240);
      left -= slice;
      const f = this.rec.frames[this.next]!;
      this.clock += slice * this.rec.speedAt(this.clock, f.active);
      for (; n < maxSteps && !this.done && this.rec.frames[this.next]!.time <= this.clock; n++) this.step();
    }
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
