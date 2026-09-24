// 所有可調參數集中於此。數值單位：公尺、世界秒（行動與 AI）、真實秒（輸入與介面）。

export const TIME = {
  /** 閒置時的世界流速（慢動作）。 */
  idleRate: 0.1,
  /** 全速行走時世界以正常速度前進；世界時間 = 實際水平位移 ÷ 此值。 */
  refMoveSpeed: 4.5,
  /** 單幀真實時間上限，避免長幀、切換分頁後的補算。 */
  maxRealDt: 0.1,
  /** 世界子步上限（受限子步）。 */
  maxSubstep: 1 / 120,
} as const;

export const WORLD = {
  cell: 1,
  wallHeight: 4.5,
  doorHeight: 3.0,
  lowWallHeight: 1.0,
  platformHeight: 1.3,
  slotSize: 18,
  gravity: 9.8,
} as const;

export const PLAYER = {
  radius: 0.35,
  eyeHeight: 1.6,
  height: 1.8,
  moveSpeed: 4.5,
  accel: 40,
  maxHp: 10,
  startArrows: 6,
  maxArrows: 10,
  startBottles: 1,
  maxBottles: 3,
  startPotions: 1,
  maxPotions: 3,
  potionHeal: 4,
  pickupRadius: 0.9,
  interactRange: 2.2,
} as const;

/** 行動時間（世界秒）。準備 → 作用 → 恢復。 */
export const ACTIONS = {
  sword: { windup: 0.15, active: 0.12, recovery: 0.33 },
  crossbow: { windup: 0.12, active: 0, recovery: 0.68 },
  stone: { windup: 0.06, active: 0, recovery: 0.24 },
  bottle: { windup: 0.12, active: 0, recovery: 0.28 },
  potion: { windup: 0.0, active: 0, recovery: 0.8 },
  door: { windup: 0.0, active: 0, recovery: 0.3 },
  use: { windup: 0.0, active: 0, recovery: 0.6 },
} as const;

export const SWORD = {
  damage: 4,
  sneakMultiplier: 3,
  reach: 2.0,
  arcDeg: 100,
} as const;

export const PROJECTILES = {
  arrow: { speed: 40, gravity: 3, radius: 0.05, body: 3, head: 6 },
  stone: { speed: 30, gravity: 6, radius: 0.07, body: 1, head: 2, noise: 8 },
  bottle: { speed: 9, gravity: 6, radius: 0.16, liftDeg: 14 },
  bolt: { speed: 18, gravity: 0, radius: 0.06, damage: 2 },
  maxLife: 6,
} as const;

export const SMOKE = {
  radius: 2.5,
  growTime: 0.4,
  life: 10,
  fadeTime: 1.5,
  insideSight: 1.5,
  noise: 6,
} as const;

export const NOISE = {
  combatHit: 8,
  door: 5,
  trap: 8,
  shout: 7,
  /** 被牆隔開（無直線視線）時噪音半徑的倍率。 */
  occludedFactor: 0.5,
  /** 睡眠中的敵人只對「半徑 × 此值」內的噪音醒來。 */
  sleepFactor: 0.6,
} as const;

export const PERCEPTION = {
  fovDeg: 110,
  range: 16,
  alertRange: 24,
  fillNear: 0.35,
  fillFar: 1.5,
  nearDist: 3,
  decay: 0.5,
  suspiciousRangeMul: 1.25,
  loseTime: 4,
  searchTime: 8,
  sleepWakeDist: 2,
  sleepWakeTime: 1,
  eyeHeight: 1.55,
  interval: 1 / 20,
  /** 地城甦醒後的強化 */
  awakenedRangeMul: 1.3,
  awakenedFillMul: 0.7,
  awakenedFovDeg: 150,
  awakenedCallDist: 30,
} as const;

export const ENEMIES = {
  guard: {
    hp: 8,
    radius: 0.45,
    height: 1.9,
    headY: 1.72,
    headR: 0.2,
    speed: 3.0,
    attackRange: 2.0,
    windup: 0.55,
    trackUntil: 0.35,
    active: 0.15,
    recovery: 0.6,
    damage: 3,
    reach: 2.3,
    arcDeg: 90,
    /** 被戰士反擊斬打斷後的失衡時間（盾牌放下、不能攻擊）。 */
    stagger: 1.0,
  },
  archer: {
    hp: 3,
    radius: 0.4,
    height: 1.85,
    headY: 1.68,
    headR: 0.19,
    speed: 2.8,
    minDist: 7,
    maxDist: 14,
    fireRange: 20,
    aim: 0.9,
    lockBefore: 0.25,
    reload: 1.6,
    stagger: 0.4,
  },
  charger: {
    hp: 10,
    radius: 0.5,
    height: 2.0,
    headY: 1.62,
    headR: 0.24,
    speed: 2.6,
    triggerDist: 9,
    windup: 0.8,
    lockBefore: 0.2,
    chargeSpeed: 10,
    chargeDist: 9,
    damage: 4,
    stun: 1.5,
    stunDamageMul: 2,
    recovery: 0.8,
    frontArmorMul: 0.5,
  },
  patrolSpeed: 1.4,
  searchSpeed: 1.8,
  doorOpenTime: 0.6,
  repathInterval: 0.5,
  deathFade: 4,
} as const;

export const TRAP = {
  warn: 0.5,
  spikes: 0.4,
  reset: 2.0,
  damage: 3,
} as const;

export const DOOR = {
  moveTime: 0.3,
  losBlockBelow: 0.6,
} as const;

export const RUNES = {
  pierce: { extra: 1 },
  swiftBlade: { timeMul: 0.7 },
  shadow: { detectMul: 1.6 },
  vigor: { maxHp: 4, heal: 4 },
} as const;

export type RuneId = keyof typeof RUNES;

export interface RuneInfo {
  id: RuneId;
  name: string;
  text: string;
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** 刻印說明由上方數值生成，確保文字與效果一致。 */
export function runeInfo(id: RuneId): RuneInfo {
  switch (id) {
    case 'pierce':
      return {
        id,
        name: '穿甲刻印',
        text: `弩箭可穿透 ${RUNES.pierce.extra} 名敵人，後方敵人仍受全額傷害。`,
      };
    case 'swiftBlade': {
      const base = ACTIONS.sword.windup + ACTIONS.sword.active + ACTIONS.sword.recovery;
      return {
        id,
        name: '疾刃刻印',
        text: `揮劍行動時間 ${fmt(base)} → ${fmt(base * RUNES.swiftBlade.timeMul)} 秒（準備、作用、恢復等比縮短）。`,
      };
    }
    case 'shadow':
      return {
        id,
        name: '影行刻印',
        text: `敵人發現你所需的時間 +${Math.round((RUNES.shadow.detectMul - 1) * 100)}%。`,
      };
    case 'vigor':
      return {
        id,
        name: '堅韌刻印',
        text: `最大生命 +${RUNES.vigor.maxHp}，並立即回復 ${RUNES.vigor.heal} 點生命。`,
      };
  }
}

export const ALL_RUNES: RuneId[] = ['pierce', 'swiftBlade', 'shadow', 'vigor'];

// ---------- 職業：相同裝備與資源，差別只在「規則特權」 ----------

export const CLASSES = {
  warrior: {
    /** 反擊斬：威脅已鎖定、就在眼前時揮劍，出手更快。 */
    counterSwing: { windup: 0.05, active: 0.12, recovery: 0.23 },
    /** 近戰威脅（盾衛鎖定、突進者鎖定或衝鋒中）在這個距離內才算「就在眼前」。 */
    counterRange: 3.2,
    /** 突進者衝鋒中：太近時已經來不及出手。 */
    counterMinChargeDist: 1.3,
    /** 弩矢在這個距離區間內、且會從身邊 boltPassDist 內經過，才算來得及擊開。 */
    boltReadyMax: 5.0,
    boltReadyMin: 1.2,
    boltPassDist: 2.0,
    /** 擊開：揮劍作用期間，劍的範圍再加這個餘量內的弩矢會被打回去。 */
    deflectMargin: 0.3,
    deflectSpeed: 30,
    deflectBody: 3,
    deflectHead: 6,
  },
  huntress: {
    /** 疾射：準星對準空中的飛行物時，射擊幾乎不花世界時間。 */
    quickshot: { windup: 0.02, active: 0, recovery: 0.08 },
    /** 準星與飛行物的夾角在這個角度內才會修正（度）。 */
    assistConeDeg: 6,
    assistRange: 22,
    /** 疾射箭對「指定目標」的交會半徑（一般箭對瓶子是 0.21 m）。 */
    interceptRadius: 0.35,
  },
} as const;

export type PlayerClass = keyof typeof CLASSES;
export const ALL_CLASSES: PlayerClass[] = ['warrior', 'huntress'];

export interface ClassInfo {
  id: PlayerClass;
  name: string;
  promise: string;
  abilities: Array<{ name: string; text: string }>;
}

/** 職業說明由上方數值生成，確保文字與效果一致。 */
export function classInfo(id: PlayerClass): ClassInfo {
  const sw = ACTIONS.sword;
  const swTotal = sw.windup + sw.active + sw.recovery;
  const cb = ACTIONS.crossbow;
  const cbTotal = cb.windup + cb.active + cb.recovery;
  if (id === 'warrior') {
    const w = CLASSES.warrior;
    const cs = w.counterSwing;
    return {
      id,
      name: '戰士',
      promise: '敵人已經出手了，但我仍然能走進他的攻擊節奏裡反擊。',
      abilities: [
        {
          name: '反擊斬',
          text: `敵人的攻擊已鎖定、就在眼前時揮劍：出手 ${fmt(sw.windup)} → ${fmt(cs.windup)} 秒。命中會打斷攻擊：盾衛失衡 ${fmt(ENEMIES.guard.stagger)} 秒（盾牌放下），突進者暈眩 ${fmt(ENEMIES.charger.stun)} 秒。`,
        },
        {
          name: '擊開',
          text: `揮劍時碰到飛來的弩矢，會把它朝準星方向打回去（身體 ${w.deflectBody}、頭部 ${w.deflectHead} 傷害，不耗弩箭）。`,
        },
        {
          name: '收招',
          text: `反擊或擊開成功時，這一劍不用收招（一般揮劍 ${fmt(swTotal)} 秒，其中收招 ${fmt(sw.recovery)} 秒）。`,
        },
      ],
    };
  }
  const h = CLASSES.huntress;
  const qs = h.quickshot;
  return {
    id,
    name: '獵手',
    promise: '東西都已經飛出去了，但我仍然可以改變結果。',
    abilities: [
      {
        name: '疾射',
        text: `拿著弩、準星對準空中的飛行物（自己丟出的煙霧瓶、敵人的弩矢）${h.assistConeDeg}° 內：射擊只花 ${fmt(qs.windup + qs.active + qs.recovery)} 秒（一般 ${fmt(cbTotal)} 秒）。`,
      },
      {
        name: '截擊',
        text: `疾射的箭會修正到與目標交會（${h.assistRange} m 內、不穿牆）：打中煙霧瓶就在空中炸開，打中弩矢就把它擊落，箭繼續往前飛。`,
      },
    ],
  };
}

export const RENDER = {
  maxPixelRatio: 1.5,
  fov: 75,
  fogColor: 0x141226,
  fogDensity: 0.045,
} as const;
