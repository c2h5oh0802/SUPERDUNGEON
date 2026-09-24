import type { RuneId } from '../config';
import type { V2, V3 } from '../core/math';
import type { EnemyKind } from '../gen/rooms';
import type { PickupKind } from '../gen/generator';

export type Tool = 'sword' | 'crossbow' | 'stone';
export type ActionKind = 'sword' | 'crossbow' | 'stone' | 'bottle' | 'potion' | 'door' | 'use';

export interface ActionState {
  kind: ActionKind;
  windup: number;
  active: number;
  recovery: number;
  t: number;
  fired: boolean;
  lockedYaw: number;
  hitSet: Set<number>;
  targetId: number;
}

export interface Player {
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  arrows: number;
  bottles: number;
  potions: number;
  tool: Tool;
  desiredTool: Tool;
  action: ActionState | null;
  runes: RuneId[];
  hasHeart: boolean;
  dead: boolean;
  lastMoveDist: number;
}

export type EnemyState = 'sleep' | 'idle' | 'patrol' | 'search' | 'alert';
export type AttackPhase = 'none' | 'windup' | 'active' | 'recovery' | 'aim' | 'reload' | 'charge' | 'stun' | 'stagger';

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  z: number;
  y: number;
  yaw: number;
  radius: number;
  height: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  deathT: number;
  state: EnemyState;
  awareness: number;
  suspicious: boolean;
  awakened: boolean;
  perched: boolean;
  post: { x: number; z: number; yaw: number };
  patrol: V2[];
  patrolIdx: number;
  patrolWait: number;
  target: V2 | null;
  lastKnown: V2 | null;
  loseT: number;
  searchT: number;
  sleepProxT: number;
  percT: number;
  seesPlayer: boolean;
  phase: AttackPhase;
  phaseT: number;
  lockedYaw: number;
  locked: boolean;
  hitDone: boolean;
  chargeDist: number;
  aimPoint: V3 | null;
  path: V2[] | null;
  pathT: number;
  pathGoal: V2 | null;
  doorWaitT: number;
  doorWaitId: number;
  lodged: number;
  hurtT: number;
  roomKey: string;
  moving: boolean;
  walkPhase: number;
  stuckT: number;
  lastX: number;
  lastZ: number;
}

export type ProjectileKind = 'arrow' | 'stone' | 'bottle' | 'bolt';

export interface Projectile {
  id: number;
  kind: ProjectileKind;
  owner: 'player' | number;
  pos: V3;
  vel: V3;
  radius: number;
  gravity: number;
  age: number;
  alive: boolean;
  pierceLeft: number;
  hitSet: Set<number>;
  /** 本子步的預定終點與平均速度（供同時空交會判定）。 */
  next: V3;
  avgVel: V3;
}

export interface Smoke {
  id: number;
  x: number;
  y: number;
  z: number;
  age: number;
  radius: number;
  air: boolean;
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  amount: number;
  x: number;
  y: number;
  z: number;
  /** 插在牆上的箭：方向 */
  stuckDir: V3 | null;
  taken: boolean;
}

export interface Trap {
  id: number;
  i: number;
  j: number;
  state: 'idle' | 'armed' | 'spikes' | 'reset';
  t: number;
  hitSet: Set<number>;
}

export type InteractKind = 'door' | 'chest' | 'altar' | 'heart' | 'stairs' | 'resupply';

export interface Interactable {
  id: number;
  kind: InteractKind;
  x: number;
  z: number;
  yaw: number;
  used: boolean;
  /** 門的 id、寶箱 index 等 */
  ref: number;
  roomKey: string;
}

export interface InteractTarget {
  id: number;
  kind: InteractKind;
  label: string;
  enabled: boolean;
}

export type GameEventType =
  | 'swing'
  | 'fire'
  | 'dryFire'
  | 'throw'
  | 'drink'
  | 'hitEnemy'
  | 'shield'
  | 'hitWall'
  | 'enemyDeath'
  | 'playerHurt'
  | 'bottleBreak'
  | 'smoke'
  | 'door'
  | 'doorBlocked'
  | 'barred'
  | 'unbar'
  | 'trapArm'
  | 'trapSpike'
  | 'pickup'
  | 'chest'
  | 'altarOpen'
  | 'rune'
  | 'heart'
  | 'needHeart'
  | 'wake'
  | 'win'
  | 'death'
  | 'alert'
  | 'suspicious'
  | 'wakeUp'
  | 'enemyWindup'
  | 'enemyStrike'
  | 'enemyFire'
  | 'stun'
  | 'noise'
  | 'resupply'
  | 'toolSwitch'
  | 'fullInventory';

export interface GameEvent {
  type: GameEventType;
  x?: number;
  y?: number;
  z?: number;
  id?: number;
  kind?: string;
  amount?: number;
  head?: boolean;
  sneak?: boolean;
  air?: boolean;
  open?: boolean;
  source?: string;
  radius?: number;
  text?: string;
}

export interface RunStats {
  kills: number;
  sneakKills: number;
  backstabs: number;
  shots: number;
  shotHits: number;
  airbursts: number;
  bottlesThrown: number;
  potionsUsed: number;
  damageTaken: Record<string, number>;
  realTime: number;
  worldTime: number;
  chests: number;
}

export interface FrameInput {
  /** 本地移動軸：x 右、z 前（-1..1） */
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  firePressed: boolean;
  selectTool: Tool | null;
  bottle: boolean;
  interact: boolean;
  potion: boolean;
  wait: boolean;
}

export const emptyInput = (yaw = 0, pitch = 0): FrameInput => ({
  moveX: 0,
  moveZ: 0,
  yaw,
  pitch,
  fire: false,
  firePressed: false,
  selectTool: null,
  bottle: false,
  interact: false,
  potion: false,
  wait: false,
});
