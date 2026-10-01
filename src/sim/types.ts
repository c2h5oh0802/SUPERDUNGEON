import type { ArmorId, ItemId, PlayerClass, PotionId, TalentId, TipKind, Tool, WeaponId } from '../config';
import type { V2, V3 } from '../core/math';
import type { EnemyKind } from '../gen/rooms';
import type { PickupKind } from '../gen/generator';

export type { Tool, TipKind };
export type ActionKind = 'melee' | 'bow' | 'stone' | 'shield' | 'bottle' | 'potion' | 'eat' | 'door' | 'use' | 'read' | 'equip' | 'convert' | 'drop' | 'stunned';

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
  /** 戰士：這一劍是反擊斬（出手更快）。 */
  counter: boolean;
  /** 戰士：這一劍已成功反擊或擊開（跳過收招）。 */
  countered: boolean;
  /** 獵手：這一發是藥劑箭（null 表示一般箭）。 */
  tip: TipKind | null;
  /** 近戰：這一擊用的武器。 */
  weapon: WeaponId;
  /** 喝、讀、丟、裝備的物品（背包裡的那一格；null＝治療藥水或煙霧瓶）。 */
  item: ItemId | null;
}

/** 背包的一格：同種藥水、卷軸疊在一起；裝備各佔一格並帶強化等級。 */
export interface InvItem {
  id: ItemId;
  count: number;
  level: number;
}

/** 背包裡選的動作（由介面排入，下一幀開始行動）。 */
export interface PendingUse {
  index: number;
  mode: 'use' | 'throw' | 'convert' | 'drop' | 'dropAll';
  /** Runtime identity: queued actions must not target a replacement at the same index. */
  stack?: InvItem;
}

/** 選擇畫面：升級選天賦、強化卷軸選裝備。 */
export type UpgradeTarget = 'weapon' | 'armor' | 'bow' | 'shield';
export type PendingChoice = { kind: 'talent'; options: TalentId[]; level?: number } | { kind: 'upgrade'; options: UpgradeTarget[]; reservedScroll?: boolean };

/** 丟出的藥水碎開後留在地上的區域。 */
export interface Area {
  id: number;
  kind: 'fire' | 'frost' | 'gas';
  x: number;
  z: number;
  radius: number;
  age: number;
  life: number;
  tickT: number;
  hitPlayer: boolean;
}

export interface Player {
  cls: PlayerClass;
  x: number;
  z: number;
  yaw: number;
  pitch: number;
  vx: number;
  vz: number;
  hp: number;
  maxHp: number;
  /** 累積飢餓（世界秒）；只由實際世界時間增加。 */
  hunger: number;
  /** 飢餓傷害的未滿一跳世界時間，跨層／存檔保留。 */
  starvationT: number;
  /** 數字鍵 1、2、3 對應的工具（依職業）。 */
  slots: readonly Tool[];
  /** 裝備與強化等級。 */
  weapon: { id: WeaponId; level: number };
  armor: { id: ArmorId; level: number };
  bowLevel: number;
  shieldLevel: number;
  /** 按住 Shift：潛行步。 */
  sneaking: boolean;
  items: InvItem[];
  /** 已經認得的物品。 */
  known: ItemId[];
  xp: number;
  level: number;
  talents: TalentId[];
  /** 效果的剩餘世界秒：隱形、迅捷、連擊。 */
  invisT: number;
  hasteT: number;
  comboT: number;
  pendingUse: PendingUse | null;
  /** 一般箭（獵手）。 */
  arrows: number;
  /** 投擲石（戰士）。 */
  stones: number;
  /** 藥劑箭（獵手）。 */
  tipped: Record<TipKind, number>;
  tipKind: TipKind;
  bottles: number;
  tool: Tool;
  desiredTool: Tool;
  action: ActionState | null;
  hasHeart: boolean;
  dead: boolean;
  lastMoveDist: number;
}

export type EnemyState = 'sleep' | 'idle' | 'patrol' | 'investigate' | 'search' | 'alert';
export type AttackPhase = 'none' | 'windup' | 'active' | 'recovery' | 'aim' | 'reload' | 'charge' | 'stun' | 'stagger' | 'pushed';

export interface Enemy {
  /** Target-local temporary mark; absolute world time, not carried between floors. */
  huntingMarkUntil?: number;
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
  searchIdx: number;
  searchGoal: V2 | null;
  roamT: number;
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
  /** One fixed, local combat leg; never serialized into floor-start saves. */
  archerMove: { goal: V2; kind: 'angle' | 'retreat'; time: number; travel: number } | null;
  /** Standing/aiming window between bounded movement attempts. */
  archerMovePause: number;
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
  /** 失衡、踉蹌的持續時間（phase = 'stagger'）。 */
  staggerDur: number;
  /** 被盾推：剩餘滑行距離與方向。 */
  push: { dx: number; dz: number; left: number } | null;
  /** 麻痺：時間軸暫停的剩餘世界秒。 */
  paralyzeT: number;
  /** 冰寒：時間軸變慢的剩餘世界秒。 */
  slowT: number;
  /** 盾衛舉盾前進中（正面的頭也擋）。麻痺時維持定格前的狀態。 */
  shieldUp: boolean;
  /** 老兵：戴頭盔，背刺只 ×2、生命 ×1.5、發現速度 ×1.3。 */
  veteran: boolean;
  /** 屍體已經被其他敵人發現過（只觸發一次）。 */
  corpseFound: boolean;
  /** A committed attack resolves before Sleep is applied. */
  pendingSleep: boolean;
  boss: boolean;
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

  hitSet: Set<number>;
  /** 本子步的預定終點與平均速度（供同時空交會判定）。 */
  next: V3;
  avgVel: V3;
  /** 被戰士擊開的弩矢（改由玩家擁有）。 */
  deflected: boolean;
  /** 藥劑箭的藥劑（碰到東西就用掉）。 */
  tip: TipKind | null;
  /** 瓶子裡裝的東西：煙霧或藥水。 */
  payload: 'smoke' | PotionId;
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
  /** kind 為 item 時：哪一件物品與強化等級。 */
  item?: ItemId;
  level?: number;
  /** 背包滿時已經提醒過。 */
  warned?: boolean;
  /** A deliberate drop cannot be auto-picked until the player leaves its radius. */
  pickupBlockedUntilExit?: boolean;
  /** Re-acquisition is not new healing supply. */
  playerDropped?: boolean;
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

export type InteractKind = 'door' | 'chest' | 'heart' | 'stairs' | 'resupply';

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
  | 'enemyStep'
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
  | 'dropItem'
  | 'chest'
  | 'heart'
  | 'needHeart'
  | 'wake'
  | 'win'
  | 'descend'
  | 'corpseFound'
  | 'alarm'
  | 'levelUp'
  | 'identify'
  | 'shatter'
  | 'read'
  | 'equip'
  | 'area'
  | 'buff'
  | 'death'
  | 'alert'
  | 'suspicious'
  | 'wakeUp'
  | 'enemyWindup'
  | 'enemyStrike'
  | 'enemyLock'
  | 'enemyFire'
  | 'stun'
  | 'noise'
  | 'resupply'
  | 'toolSwitch'
  | 'hungerState'
  | 'eat'
  | 'fullInventory'
  | 'counter'
  | 'deflect'
  | 'push'
  | 'block'
  | 'bump'
  | 'tipHit'
  | 'helmet';

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
  /** Completed healing drinks; retained historical statistic name. */
  potionsUsed: number;
  healingFound: number;
  healingUsed: number;
  healingRestored: number;
  healingWasted: number;
  damageTaken: Record<string, number>;
  realTime: number;
  worldTime: number;
  chests: number;
  counters: number;
  deflects: number;
  pushes: number;
  blocks: number;
  wallSlams: number;
  tipHits: number;
  itemsUsed: number;
}

export interface FrameInput {
  /** 本地移動軸：x 右、z 前（-1..1） */
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  fire: boolean;
  firePressed: boolean;
  /** 數字鍵（1 起算）；對應的工具依職業而定。 */
  selectSlot: number | null;
  /** 臂盾：盾推（戰士）。 */
  shield: boolean;
  /** 按住 Shift：潛行步（安靜，但慢、每公尺花兩倍世界時間）。 */
  sneak: boolean;
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
  selectSlot: null,
  shield: false,
  sneak: false,
  bottle: false,
  interact: false,
  potion: false,
  wait: false,
});
