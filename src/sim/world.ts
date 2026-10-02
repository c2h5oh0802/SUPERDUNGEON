import { recordSensesEvent, expireSenses, type SoundCue } from './senses';
import { CLASSES, CLASS_KNOWLEDGE, ITEM_FX, ENEMIES, PLAYER, SMOKE, STEALTH, TIME, RENDER, type ArmorId, type ItemId, type PlayerClass, type TalentId, type WeaponId } from '../config';
import { updateHunger } from './hunger';
import { Rng } from '../core/rng';
import { armorFootstepRadius, armorReduction, armorSneakSpeedMul } from './equipment';
import { applyIdentification, cancelIdentification, refreshIdentifyChoice, applyUpgrade, refreshUpgradeChoice, dropLoot, lightstep, updateAreas, updateBuffs } from './items';
import { applyTalent, gainXp, killXp, talentOptions } from './progress';
import { segSphere, type V2, type V3 } from '../core/math';
import { clampRealDt, computeWorldDt, substeps } from '../core/time';
import type { LevelData } from '../gen/generator';
import { Grid } from './grid';
import { counterThreat, hunterEye, pushTarget, type CounterThreat, type HunterEye } from './classSys';
import { Nav } from './nav';
import { updateEnemies, onNoise, createEnemy, awakenDungeon, damageEnemy } from './enemySys';
import { movePlayer, startActions, updatePlayerAction, findInteractTarget } from './playerSys';
import { updateProjectiles } from './projectileSys';
import { updateDoors, updatePickups, updateSmokes, updateTraps } from './propSys';
import type {
  Area,
  Enemy,
  InvItem,
  PendingChoice,
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

export type Outcome = 'none' | 'win' | 'dead' | 'descend';

export interface WorldOptions {
  /** 職業（預設戰士）。 */
  cls?: PlayerClass;
  /** 從上一層帶下來的物資、生命與裝備成長。 */
  carry?: PlayerCarry;
  /** 從上一層累積下來的統計（時間、擊倒數等）。 */
  stats?: RunStats;
}

/** 跨層保留的玩家狀態。 */
export interface PlayerCarry {
  hp: number;
  maxHp: number;
  hunger: number;
  starvationT: number;
  arrows: number;
  stones: number;
  tipped: { paralysis: number; chill: number };
  tipKind: 'paralysis' | 'chill';
  bottles: number;
  weapon: { id: WeaponId; level: number };
  armor: { id: ArmorId; level: number };
  bowLevel: number;
  shieldLevel: number;
  items: InvItem[];
  known: ItemId[];
  xp: number;
  level: number;
  talents: TalentId[];
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
  /** Camera geometry only; not persistent run state. */
  viewFov: number = RENDER.fov;
  viewAspect = 16 / 9;
  readonly level: LevelData;
  readonly grid: Grid;
  readonly enav: Nav;
  readonly roamPoints: V2[];
  readonly player: Player;
  readonly enemies: Enemy[] = [];
  readonly projectiles: Projectile[] = [];
  readonly smokes: Smoke[] = [];
  readonly pickups: Pickup[] = [];
  readonly traps: Trap[] = [];
  readonly interactables: Interactable[] = [];
  /** 本幀事件（渲染、音效、介面讀取後清空）。 */
  events: GameEvent[] = [];
  senses: SoundCue[] = [];
  time = 0;
  realTime = 0;
  lastWorldDt = 0;
  lastRealDt = 0;
  outcome: Outcome = 'none';
  /** 致命一擊的來源（結算顯示用）。 */
  deathCause: string | null = null;
  heartTaken = false;
  awakened = false;
  encounterState: 'none' | 'dormant' | 'active' | 'resolved' = 'none';
  /** 有敵人發現了屍體：整層戒備。 */
  alarm = false;
  /** 等待玩家選擇（天賦、強化）：顯示選擇時世界暫停。 */
  pendingChoice: PendingChoice | null = null;
  readonly choiceQueue: PendingChoice[] = [];
  readonly areas: Area[] = [];
  /** 讀過地圖卷軸：整層都顯示。 */
  mapped = false;
  /** 掉落與傳送用的亂數（同種子、同一層固定）。 */
  readonly rng: Rng;
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
    healingFound: 0,
    healingUsed: 0,
    healingRestored: 0,
    healingWasted: 0,
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
    itemsUsed: 0,
  };
  readonly cue: ClassCue = { counter: null, push: -1, eye: [] };
  /** 最近一個結束的行動（實際花掉的世界時間與類型），供介面與驗證讀取。 */
  lastAction: { kind: string; spent: number; counter: boolean; countered: boolean; tip: string | null } | null = null;
  nextId = 1;
  private revealT = 0;
  /** 之前樓層累積的世界時間與真實時間。 */
  private baseWorldTime = 0;
  private baseRealTime = 0;

  constructor(level: LevelData, opts: WorldOptions = {}) {
    this.level = level;
    this.encounterState = level.encounter ? 'dormant' : 'none';
    this.grid = level.grid;
    this.enav = new Nav(this.grid, Math.max(ENEMIES.guard.radius, ENEMIES.archer.radius, ENEMIES.charger.radius));
    // 房間中心投影到既有導航格；入口不列入目的地，不改生成與可達性規則。
    this.roamPoints = level.rooms.filter((r) => r.role !== 'entrance').flatMap((r) => {
      const c = this.enav.nearestPassable(r.x0 + r.w / 2, r.z0 + r.h / 2);
      return c < 0 ? [] : [this.enav.center(c)];
    });
    this.explored = new Uint8Array(this.grid.w * this.grid.h);
    this.rng = new Rng(`${level.seed}#drops#${level.floor}`);
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
      hunger: 0,
      starvationT: 0,
      slots,
      weapon: { id: CLASSES[cls].weapon, level: 0 },
      armor: { id: 'cloth', level: 0 },
      bowLevel: 0,
      shieldLevel: 0,
      sneaking: false,
      items: [],
      known: [...CLASS_KNOWLEDGE[cls]],
      xp: 0,
      level: 1,
      talents: [],
      invisT: 0,
      hasteT: 0,
      comboT: 0,
      pendingUse: null,
      arrows: start.arrows,
      stones: start.stones,
      tipped: { paralysis: start.paralysis, chill: start.chill },
      tipKind: 'paralysis',
      bottles: start.bottles,
      tool: slots[0]!,
      desiredTool: slots[0]!,
      action: null,
      hasHeart: false,
      dead: false,
      lastMoveDist: 0,
    };
    if (opts.carry) {
      const c = opts.carry;
      const p = this.player;
      p.hp = c.hp;
      p.maxHp = c.maxHp;
      p.hunger = c.hunger ?? 0;
      p.starvationT = c.starvationT ?? 0;
      p.arrows = c.arrows;
      p.stones = c.stones;
      p.tipped = { ...c.tipped };
      p.tipKind = c.tipKind;
      p.bottles = c.bottles;
      p.weapon = { ...c.weapon };
      p.armor = { ...c.armor };
      p.bowLevel = c.bowLevel;
      p.shieldLevel = c.shieldLevel;
      p.items = c.items.map((it) => ({ ...it }));
      p.known = [...new Set([...CLASS_KNOWLEDGE[cls], ...c.known])];
      p.xp = c.xp;
      p.level = c.level;
      p.talents = c.talents.slice();
    }
    if (opts.stats) {
      Object.assign(this.stats, opts.stats, { damageTaken: { ...opts.stats.damageTaken } });
      this.baseWorldTime = opts.stats.worldTime;
      this.baseRealTime = opts.stats.realTime;
    }
    for (const e of level.enemies) this.enemies.push(createEnemy(this, e));
    for (const p of level.pickups) this.addPickup(p.kind, p.amount, p.x, 0.15, p.z, null, p.item, p.level);
    level.traps.forEach((t, k) => this.traps.push({ id: k, i: t.i, j: t.j, state: 'idle', t: 0, hitSet: new Set() }));
    for (const d of this.grid.doors) {
      if (d.arch) continue;
      this.interactables.push({ id: this.nextId++, kind: 'door', x: d.cx, z: d.cz, yaw: 0, used: false, ref: d.id, roomKey: '' });
    }
    level.chests.forEach((c, k) =>
      this.interactables.push({ id: this.nextId++, kind: 'chest', x: c.x, z: c.z, yaw: c.yaw, used: false, ref: k, roomKey: c.roomKey }),
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
    for (const room of level.specialRooms ?? []) if (room.fire) {
      const a = ITEM_FX.area.fire;
      this.areas.push({ id: this.nextId++, kind: 'fire', ...room.fire, radius: a.radius,
        age: 0, life: Infinity, tickT: 0, hitPlayer: false });
    }
    this.reveal();
  }

  emit(e: GameEvent): void {
    this.events.push(e);
    recordSensesEvent(this, e);
  }

  drainEvents(): GameEvent[] {
    const ev = this.events;
    this.events = [];
    return ev;
  }

  addPickup(kind: Pickup['kind'], amount: number, x: number, y: number, z: number, stuckDir: V3 | null, item?: ItemId, level?: number): Pickup {
    const p: Pickup = { id: this.nextId++, kind, amount, x, y, z, stuckDir, taken: false, item, level };
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
    if (this.outcome !== 'none' || this.pendingChoice !== null) {
      this.lastWorldDt = 0;
      return 0;
    }
    this.realTime += realDt;
    expireSenses(this);
    this.stats.realTime = this.baseRealTime + this.realTime;
    const p = this.player;
    p.yaw = input.yaw;
    p.pitch = input.pitch;
    startActions(this, input);
    p.sneaking = input.sneak && !p.dead;
    const dist = movePlayer(this, input, realDt);
    p.lastMoveDist = dist;
    updatePickups(this);
    this.footsteps(dist);
    const worldDt = computeWorldDt({
      realDt,
      // 潛行步：每公尺花比較多世界時間（安靜要付時間）
      moveDist: dist * (p.sneaking ? this.sneakTimeMul() : 1),
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

  private stepAcc = 0;

  /** 潛行步的每公尺世界時間倍率。 */
  sneakTimeMul(): number {
    return lightstep(this).time || STEALTH.sneakTimeMul;
  }

  /** 潛行步的速度倍率（鎖甲更慢、輕步更快）。 */
  sneakSpeedMul(): number {
    return armorSneakSpeedMul(this.player.armor.id, lightstep(this).speed);
  }

  /** 正常走動：每走一段距離發出腳步聲；潛行步不出聲。 */
  private footsteps(dist: number): void {
    const p = this.player;
    if (p.sneaking || dist <= 0 || p.dead) {
      this.stepAcc = p.sneaking ? 0 : this.stepAcc;
      return;
    }
    this.stepAcc += dist;
    if (this.stepAcc < STEALTH.footstepEvery) return;
    this.stepAcc -= STEALTH.footstepEvery;
    this.emitNoise(p.x, 0.1, p.z, armorFootstepRadius(p.armor.id), 'step');
  }

  /** 護甲減傷（至少受 1）。 */
  armorReduce(): number {
    const a = this.player.armor;
    return armorReduction(a.id, a.level);
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
      if (this.outcome !== 'none' || this.pendingChoice !== null) break;
      this.updateEncounter();
      this.time += dt;
      this.stats.worldTime = this.baseWorldTime + this.time;
      // 唯一飢餓入口：每個真正執行的世界子步；不吃 realDt、移動或行動倍率。
      if (!this.hungerPaused) updateHunger(this, dt);
      if (this.outcome !== 'none') break;
      updatePlayerAction(this, dt);
      updateProjectiles(this, dt);
      updateEnemies(this, dt);
      this.updateEncounter();
      updateDoors(this, dt);
      updateTraps(this, dt);
      updateSmokes(this, dt);
      updateAreas(this, dt, (e, dmg, src) => damageEnemy(this, e, dmg, { source: src, sneak: false, head: false, x: e.x, y: 0.5, z: e.z }));
      updateBuffs(this, dt);
      if (this.pendingChoice !== null) break;
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

  emitNoise(x: number, y: number, z: number, radius: number, source: string, emitterId?: number): void {
    this.emit({ type: 'noise', x, y, z, radius, source, id: emitterId });
    onNoise(this, x, y, z, radius, emitterId, source);
  }

  damagePlayer(amount: number, source: string, fromX: number, fromZ: number): void {
    const p = this.player;
    if (p.dead || this.outcome !== 'none') return;
    amount = Math.max(1, amount - this.armorReduce());
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

  get hungerPaused(): boolean {
    return this.encounterState === 'active' || this.encounterState === 'resolved';
  }

  get heartAvailable(): boolean {
    return !this.level.encounter || this.encounterState === 'resolved';
  }

  startEncounter(): void {
    if (this.encounterState !== 'dormant') return;
    this.encounterState = 'active';
    for (const e of this.enemies) if (e.boss && e.alive) {
      e.state = 'alert'; e.awareness = 1; e.percT = 0;
      // Engagement is not sight: only perception may acquire a new player position.
    }
    this.emit({ type: 'buff', kind: 'encounter', text: '守心者甦醒：本場戰鬥暫停飢餓消耗' });
  }

  updateEncounter(): void {
    if (!this.level.encounter || this.encounterState === 'resolved') return;
    const room = this.level.rooms.find((r) => r.key === this.level.encounter!.roomKey)!;
    const p = this.player;
    // Cross the inner threshold, rather than freezing the entire fifth floor.
    if (p.x > room.x0 + 1 && p.x < room.x0 + room.w - 1 &&
        p.z > room.z0 + 1 && p.z < room.z0 + room.h - 1) this.startEncounter();
    if (!this.enemies.some((e) => e.boss && e.alive)) {
      this.encounterState = 'resolved';
      this.emit({ type: 'buff', kind: 'encounter', text: '守心者已倒下：可以取走沉眠之心' });
    }
  }

  takeHeart(): void {
    if (!this.heartAvailable) return;
    this.heartTaken = true;
    this.player.hasHeart = true;
    this.emit({ type: 'heart' });
    // Retain legacy/practice awakening; arena victory has no escape phase.
    if (!this.level.encounter) awakenDungeon(this);
  }

  /** 帶到下一層的玩家狀態。 */
  carry(): PlayerCarry {
    const p = this.player;
    return {
      hp: p.hp,
      maxHp: p.maxHp,
      hunger: p.hunger,
      starvationT: p.starvationT,
      arrows: p.arrows,
      stones: p.stones,
      tipped: { ...p.tipped },
      tipKind: p.tipKind,
      bottles: p.bottles,
      weapon: { ...p.weapon },
      armor: { ...p.armor },
      bowLevel: p.bowLevel,
      shieldLevel: p.shieldLevel,
      items: p.items.map((it) => ({ ...it })),
      known: p.known.slice(),
      xp: p.xp,
      level: p.level,
      talents: p.talents.slice(),
    };
  }

  /** 敵人倒下：經驗與掉落。 */
  onKill(e: Enemy): void {
    dropLoot(this, e);
    gainXp(this, killXp(e));
  }

  /** 玩家在選擇畫面做了選擇。 */
  resolveChoice(index: number): void {
    const c = this.pendingChoice;
    if (!c) return;
    if (c.kind === 'talent') {
      const t = c.options[index];
      if (!t) return;
      applyTalent(this, t);
    } else if (c.kind === 'identify') {
      if (this.player.dead || this.outcome !== 'none') return;
      const target = c.options[index];
      if (c.settled || !target || !applyIdentification(this, target)) {
        if (refreshIdentifyChoice(this, c)) return;
      } else {
        c.reservedScroll = false;
        c.settled = true;
        c.options = [];
      }
    } else {
      const t = c.options[index];
      if (!t || !applyUpgrade(this, t)) {
        if (refreshUpgradeChoice(this, c)) return;
      } else c.reservedScroll = false; // the reserved investment is now on the item
    }
    this.advanceChoice();
  }

  /** Cancel only an identification offer, never a talent or equipment investment. */
  cancelIdentifyChoice(): void {
    const c = this.pendingChoice;
    if (c?.kind !== 'identify' || this.player.dead || this.outcome !== 'none') return;
    cancelIdentification(this, c);
    this.advanceChoice();
  }

  private advanceChoice(): void {
    this.pendingChoice = null;
    while (this.choiceQueue.length) {
      const next = this.choiceQueue.shift()!;
      if (next.kind === 'talent') {
        // A multi-level XP award can queue choices before prior choices are owned.
        // Re-evaluate at display time, preserving that level's deterministic shuffle.
        next.options = talentOptions(this.level.seed, this.player, next.level ?? this.player.level);
        if (!next.options.length) continue;
      } else if (next.kind === 'identify') {
        if (!refreshIdentifyChoice(this, next)) continue;
      } else if (!refreshUpgradeChoice(this, next)) continue;
      this.pendingChoice = next;
      break;
    }
  }

  statsCopy(): RunStats {
    return { ...this.stats, damageTaken: { ...this.stats.damageTaken } };
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
