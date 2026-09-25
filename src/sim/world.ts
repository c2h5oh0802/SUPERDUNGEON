import { CLASSES, ENEMIES, PLAYER, SMOKE, TIME, type PlayerClass, type RuneId } from '../config';
import { segSphere, type V3 } from '../core/math';
import { clampRealDt, computeWorldDt, substeps } from '../core/time';
import type { LevelData } from '../gen/generator';
import { Grid } from './grid';
import { counterThreat, hunterEye, pushTarget, type CounterThreat, type HunterEye } from './classSys';
import { Nav } from './nav';
import { updateEnemies, onNoise, createEnemy, awakenDungeon } from './enemySys';
import { movePlayer, startActions, updatePlayerAction, findInteractTarget } from './playerSys';
import { updateProjectiles } from './projectileSys';
import { updateDoors, updatePickups, updateSmokes, updateTraps } from './propSys';
import type {
  Enemy,
  FrameInput,
  GameEvent,
  Interactable,
  InteractTarget,
  Pickup,
  Player,
  Projectile,
  RunStats,
  Smoke,
  Trap,
} from './types';

export type Outcome = 'none' | 'win' | 'dead';

export interface WorldOptions {
  /** 職業（預設戰士）。 */
  cls?: PlayerClass;
}

/** 職業提示：每幀結束時計算，介面與開發工具讀取（不影響判定）。 */
export interface ClassCue {
  /** 戰士：現在揮劍＝反擊斬。 */
  counter: CounterThreat | null;
  /** 戰士：現在盾推會推到的敵人（-1 表示沒有）。 */
  push: number;
  /** 獵手：空中煙霧瓶的提前量與落點。 */
  eye: HunterEye[];
}

export class World {
  readonly level: LevelData;
  readonly grid: Grid;
  readonly enav: Nav;
  readonly player: Player;
  readonly enemies: Enemy[] = [];
  readonly projectiles: Projectile[] = [];
  readonly smokes: Smoke[] = [];
  readonly pickups: Pickup[] = [];
  readonly traps: Trap[] = [];
  readonly interactables: Interactable[] = [];
  /** 本幀事件（渲染、音效、介面讀取後清空）。 */
  events: GameEvent[] = [];
  time = 0;
  realTime = 0;
  lastWorldDt = 0;
  lastRealDt = 0;
  outcome: Outcome = 'none';
  /** 致命一擊的來源（結算顯示用）。 */
  deathCause: string | null = null;
  heartTaken = false;
  awakened = false;
  /** 開啟中的祭壇（介面顯示選擇時世界暫停）。 */
  pendingAltar: number | null = null;
  readonly explored: Uint8Array;
  interactTarget: InteractTarget | null = null;
  readonly stats: RunStats = {
    kills: 0,
    sneakKills: 0,
    backstabs: 0,
    shots: 0,
    shotHits: 0,
    airbursts: 0,
    bottlesThrown: 0,
    potionsUsed: 0,
    damageTaken: {},
    realTime: 0,
    worldTime: 0,
    chests: 0,
    counters: 0,
    deflects: 0,
    pushes: 0,
    blocks: 0,
    wallSlams: 0,
    tipHits: 0,
  };
  readonly cue: ClassCue = { counter: null, push: -1, eye: [] };
  /** 最近一個結束的行動（實際花掉的世界時間與類型），供介面與驗證讀取。 */
  lastAction: { kind: string; spent: number; counter: boolean; countered: boolean; tip: string | null } | null = null;
  nextId = 1;
  private revealT = 0;

  constructor(level: LevelData, opts: WorldOptions = {}) {
    this.level = level;
    this.grid = level.grid;
    this.enav = new Nav(this.grid, Math.max(ENEMIES.guard.radius, ENEMIES.archer.radius, ENEMIES.charger.radius));
    this.explored = new Uint8Array(this.grid.w * this.grid.h);
    const cls = opts.cls ?? 'warrior';
    const start = CLASSES[cls].start;
    const slots = CLASSES[cls].slots;
    this.player = {
      cls,
      x: level.spawn.x,
      z: level.spawn.z,
      yaw: level.spawn.yaw,
      pitch: 0,
      vx: 0,
      vz: 0,
      hp: PLAYER.maxHp,
      maxHp: PLAYER.maxHp,
      slots,
      arrows: start.arrows,
      stones: start.stones,
      tipped: { paralysis: start.paralysis, chill: start.chill },
      tipKind: 'paralysis',
      bottles: start.bottles,
      potions: start.potions,
      tool: slots[0]!,
      desiredTool: slots[0]!,
      action: null,
      runes: [],
      hasHeart: false,
      dead: false,
      lastMoveDist: 0,
    };
    for (const e of level.enemies) this.enemies.push(createEnemy(this, e));
    for (const p of level.pickups) this.addPickup(p.kind, p.amount, p.x, 0.15, p.z, null);
    level.traps.forEach((t, k) => this.traps.push({ id: k, i: t.i, j: t.j, state: 'idle', t: 0, hitSet: new Set() }));
    for (const d of this.grid.doors) {
      if (d.arch) continue;
      this.interactables.push({ id: this.nextId++, kind: 'door', x: d.cx, z: d.cz, yaw: 0, used: false, ref: d.id, roomKey: '' });
    }
    level.chests.forEach((c, k) =>
      this.interactables.push({ id: this.nextId++, kind: 'chest', x: c.x, z: c.z, yaw: c.yaw, used: false, ref: k, roomKey: c.roomKey }),
    );
    level.altars.forEach((a, k) =>
      this.interactables.push({ id: this.nextId++, kind: 'altar', x: a.x, z: a.z, yaw: a.yaw, used: false, ref: k, roomKey: a.roomKey }),
    );
    if (level.heart)
      this.interactables.push({
        id: this.nextId++,
        kind: 'heart',
        x: level.heart.x,
        z: level.heart.z,
        yaw: 0,
        used: false,
        ref: 0,
        roomKey: level.heart.roomKey,
      });
    if (level.stairs)
      this.interactables.push({
        id: this.nextId++,
        kind: 'stairs',
        x: level.stairs.front.x,
        z: level.stairs.front.z,
        yaw: 0,
        used: false,
        ref: 0,
        roomKey: 'E',
      });
    if (level.resupply)
      this.interactables.push({
        id: this.nextId++,
        kind: 'resupply',
        x: level.resupply.x,
        z: level.resupply.z,
        yaw: level.resupply.yaw,
        used: false,
        ref: 0,
        roomKey: level.resupply.roomKey,
      });
    this.reveal();
  }

  emit(e: GameEvent): void {
    this.events.push(e);
  }

  drainEvents(): GameEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  hasRune(id: RuneId): boolean {
    return this.player.runes.includes(id);
  }

  addPickup(kind: Pickup['kind'], amount: number, x: number, y: number, z: number, stuckDir: V3 | null): Pickup {
    const p: Pickup = { id: this.nextId++, kind, amount, x, y, z, stuckDir, taken: false };
    this.pickups.push(p);
    return p;
  }

  /** 行動剩餘的世界時間。 */
  actionRemaining(): number {
    const a = this.player.action;
    if (!a) return 0;
    return Math.max(0, a.windup + a.active + a.recovery - a.t);
  }

  /**
   * 一幀：玩家以真實時間移動與觀察，再依時間規則推進世界。
   * 回傳本幀世界時間。
   */
  frame(frameDelta: number, input: FrameInput): number {
    const realDt = clampRealDt(frameDelta);
    this.lastRealDt = realDt;
    if (this.outcome !== 'none' || this.pendingAltar !== null) {
      this.lastWorldDt = 0;
      return 0;
    }
    this.realTime += realDt;
    this.stats.realTime = this.realTime;
    const p = this.player;
    p.yaw = input.yaw;
    p.pitch = input.pitch;
    startActions(this, input);
    const dist = movePlayer(this, input, realDt);
    p.lastMoveDist = dist;
    updatePickups(this);
    const worldDt = computeWorldDt({
      realDt,
      moveDist: dist,
      actionRemaining: this.actionRemaining(),
      waitHeld: input.wait,
    });
    this.advance(worldDt);
    this.lastWorldDt = worldDt;
    this.revealT -= realDt;
    if (this.revealT <= 0) {
      this.revealT = 0.2;
      this.reveal();
    }
    this.interactTarget = findInteractTarget(this);
    this.updateCue();
    return worldDt;
  }

  updateCue(): void {
    this.cue.counter = counterThreat(this);
    this.cue.push = pushTarget(this)?.id ?? -1;
    this.cue.eye = hunterEye(this);
  }

  /** 以受限子步推進世界時間。 */
  advance(worldDt: number): void {
    const { n, dt } = substeps(worldDt, TIME.maxSubstep);
    for (let s = 0; s < n; s++) {
      if (this.outcome !== 'none') break;
      this.time += dt;
      this.stats.worldTime = this.time;
      updatePlayerAction(this, dt);
      updateProjectiles(this, dt);
      updateEnemies(this, dt);
      updateDoors(this, dt);
      updateTraps(this, dt);
      updateSmokes(this, dt);
      if (this.pendingAltar !== null) break;
    }
  }

  // ---------- 查詢 ----------

  /** 視線：地形＋煙霧。近距離（煙中可見距離內）不受煙霧影響。 */
  canSee(a: V3, b: V3): boolean {
    if (!this.grid.lineOfSight(a, b)) return false;
    return !this.smokeBlocks(a, b);
  }

  smokeBlocks(a: V3, b: V3): boolean {
    const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    if (d <= SMOKE.insideSight) return false;
    for (const s of this.smokes) {
      if (s.radius <= 0.05) continue;
      if (segSphere(a, b, s, s.radius) >= 0) return true;
      // 終點在煙霧內也算遮蔽
      const dx = b.x - s.x;
      const dy = b.y - s.y;
      const dz = b.z - s.z;
      if (dx * dx + dy * dy + dz * dz < s.radius * s.radius) return true;
    }
    return false;
  }

  emitNoise(x: number, y: number, z: number, radius: number, source: string): void {
    this.emit({ type: 'noise', x, y, z, radius, source });
    onNoise(this, x, y, z, radius);
  }

  damagePlayer(amount: number, source: string, fromX: number, fromZ: number): void {
    const p = this.player;
    if (p.dead || this.outcome !== 'none') return;
    p.hp -= amount;
    this.stats.damageTaken[source] = (this.stats.damageTaken[source] ?? 0) + amount;
    this.emit({ type: 'playerHurt', amount, x: fromX, z: fromZ, source });
    if (p.hp <= 0) {
      p.hp = 0;
      p.dead = true;
      this.outcome = 'dead';
      this.deathCause = source;
      this.emit({ type: 'death', source });
    }
  }

  takeHeart(): void {
    this.heartTaken = true;
    this.player.hasHeart = true;
    this.emit({ type: 'heart' });
    awakenDungeon(this);
  }

  chooseRune(rune: RuneId): void {
    if (this.pendingAltar === null) return;
    const it = this.interactables.find((i) => i.id === this.pendingAltar);
    this.pendingAltar = null;
    if (!it) return;
    const altar = this.level.altars[it.ref]!;
    if (!altar.offer.includes(rune)) return;
    it.used = true;
    this.applyRune(rune);
  }

  applyRune(rune: RuneId): void {
    if (this.player.runes.includes(rune)) return;
    this.player.runes.push(rune);
    if (rune === 'vigor') {
      this.player.maxHp += 4;
      this.player.hp = Math.min(this.player.maxHp, this.player.hp + 4);
    }
    this.emit({ type: 'rune', kind: rune });
  }

  /** 以 2D 射線扇形揭露地圖。 */
  reveal(): void {
    const g = this.grid;
    const px = this.player.x;
    const pz = this.player.z;
    const rays = 144;
    const maxD = 26;
    for (let r = 0; r < rays; r++) {
      const ang = (r / rays) * Math.PI * 2;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      let i = Math.floor(px);
      let j = Math.floor(pz);
      const stepI = dx > 0 ? 1 : -1;
      const stepJ = dz > 0 ? 1 : -1;
      const tDX = Math.abs(1 / dx);
      const tDZ = Math.abs(1 / dz);
      let tMX = dx > 0 ? (i + 1 - px) * tDX : (px - i) * tDX;
      let tMZ = dz > 0 ? (j + 1 - pz) * tDZ : (pz - j) * tDZ;
      for (let k = 0; k < 80; k++) {
        if (!g.inBounds(i, j)) break;
        this.explored[j * g.w + i] = 1;
        if (g.sightBlocked2D(i, j)) break;
        if (Math.min(tMX, tMZ) > maxD) break;
        if (tMX < tMZ) {
          i += stepI;
          tMX += tDX;
        } else {
          j += stepJ;
          tMZ += tDZ;
        }
      }
    }
  }

  isExplored(i: number, j: number): boolean {
    if (!this.grid.inBounds(i, j)) return false;
    return this.explored[j * this.grid.w + i] === 1;
  }
}
