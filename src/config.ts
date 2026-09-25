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
  /** 物資上限；起始數量見各職業的 CLASSES.*.start。 */
  maxArrows: 12,
  maxStones: 5,
  maxTipped: 2,
  maxBottles: 3,
  maxPotions: 3,
  potionHeal: 4,
  pickupRadius: 0.9,
  interactRange: 2.2,
} as const;

/** 行動時間（世界秒）。準備 → 作用 → 恢復。 */
export const ACTIONS = {
  sword: { windup: 0.15, active: 0.12, recovery: 0.33 },
  knife: { windup: 0.08, active: 0.1, recovery: 0.22 },
  bow: { windup: 0.12, active: 0, recovery: 0.68 },
  stone: { windup: 0.06, active: 0, recovery: 0.24 },
  shield: { windup: 0.05, active: 0.15, recovery: 0.2 },
  bottle: { windup: 0.12, active: 0, recovery: 0.28 },
  potion: { windup: 0.0, active: 0, recovery: 0.8 },
  door: { windup: 0.0, active: 0, recovery: 0.3 },
  use: { windup: 0.0, active: 0, recovery: 0.6 },
} as const;

/** 近戰武器：戰士的長劍、獵手的獵刀。 */
export const MELEE = {
  sword: { damage: 4, sneakMultiplier: 3, reach: 2.0, arcDeg: 100 },
  knife: { damage: 3, sneakMultiplier: 3, reach: 1.6, arcDeg: 90 },
} as const;

export const SWORD = MELEE.sword;

/** 藥劑箭：命中後改變敵人的時間軸（盾牌、角盔照樣擋）。 */
export const TIPS = {
  paralysis: { duration: 1.5 },
  chill: { duration: 4, timeScale: 0.5 },
} as const;

export type TipKind = keyof typeof TIPS;
export const ALL_TIPS: TipKind[] = ['paralysis', 'chill'];
export const TIP_NAMES: Record<TipKind, string> = { paralysis: '麻痺箭', chill: '冰寒箭' };

/** 戰士的臂盾：盾推。 */
export const SHIELD = {
  /** 作用期間擋下這個角度內（正面）的攻擊與飛行物。 */
  arcDeg: 120,
  /** 推得到的距離：玩家與敵人身體之間的空隙。 */
  pushReach: 1.8,
  pushDist: 2,
  /** 被推的敵人滑行速度（世界 m/s）。 */
  pushSpeed: 8,
  /** 撞牆失衡（盾牌放下）。 */
  wallStagger: 1.0,
  /** 撞到同伴：兩個都踉蹌。 */
  bumpStumble: 0.5,
  /** 擋下衝鋒中的突進者時，戰士被推退的距離。 */
  chargeRecoil: 1.0,
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
    /** 看到玩家拿著遠程武器、在這個距離內：舉盾前進，正面的頭與身體都擋。 */
    raiseRange: 12,
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
    /** 察覺玩家後低頭，角盔擋住正面的頭（暈眩、收招時露出）。 */
    helmet: true,
    /** 撞到同伴時，同伴受到的傷害與踉蹌時間。 */
    allyDamage: 4,
    allyStumble: 0.5,
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
const total = (a: { windup: number; active: number; recovery: number }) => a.windup + a.active + a.recovery;

/** 刻印說明由上方數值生成，確保文字與效果一致。 */
export function runeInfo(id: RuneId): RuneInfo {
  switch (id) {
    case 'pierce':
      return {
        id,
        name: '穿甲刻印',
        text: `箭與投擲石可穿透 ${RUNES.pierce.extra} 名敵人，後方敵人仍受全額傷害。`,
      };
    case 'swiftBlade': {
      const sw = total(ACTIONS.sword);
      const kn = total(ACTIONS.knife);
      const m = RUNES.swiftBlade.timeMul;
      return {
        id,
        name: '疾刃刻印',
        text: `近戰行動時間 ×${m}：長劍 ${fmt(sw)} → ${fmt(sw * m)} 秒、獵刀 ${fmt(kn)} → ${fmt(kn * m)} 秒。`,
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

// ---------- 職業：明確的起始武器，加上一條職業規則 ----------

export type Tool = 'sword' | 'knife' | 'bow' | 'tipped' | 'stone';
export const TOOL_NAMES: Record<Tool, string> = { sword: '長劍', knife: '獵刀', bow: '獵弓', tipped: '藥劑箭', stone: '投擲石' };

export interface Loadout {
  arrows: number;
  stones: number;
  paralysis: number;
  chill: number;
  bottles: number;
  potions: number;
}

export const CLASSES = {
  warrior: {
    /** 數字鍵 1、2 對應的工具；臂盾是右鍵或 F。 */
    slots: ['sword', 'stone'] as readonly Tool[],
    start: { arrows: 0, stones: 3, paralysis: 0, chill: 0, bottles: 1, potions: 1 } as Loadout,
    /** 反擊斬：威脅已鎖定、就在眼前時揮劍，出手更快。 */
    counterSwing: { windup: 0.05, active: 0.12, recovery: 0.23 },
    /** 反擊斬往前踏半步：劍的範圍加長，蓋過盾衛揮擊的範圍（盾衛 2.3 + 玩家半徑 0.35）。 */
    counterLunge: 0.3,
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
    /** 數字鍵 1、2、3 對應的工具；再按一次 3 切換藥劑箭種類。 */
    slots: ['knife', 'bow', 'tipped'] as readonly Tool[],
    start: { arrows: 8, stones: 0, paralysis: 2, chill: 2, bottles: 1, potions: 1 } as Loadout,
    /** 獵人之眼：落點與提前量最多預測多久（世界秒）。 */
    eyeMaxT: 3,
  },
} as const;

export type PlayerClass = keyof typeof CLASSES;
export const ALL_CLASSES: PlayerClass[] = ['warrior', 'huntress'];

export interface ClassInfo {
  id: PlayerClass;
  name: string;
  promise: string;
  /** 一句話定位。 */
  summary: string;
  /** 起始裝備（按鍵、名稱、數值與用途）。 */
  loadout: Array<{ key: string; name: string; text: string }>;
  /** 兩個職業都有的物資。 */
  common: string;
  /** 職業規則：觸發條件與結果。 */
  abilities: Array<{ name: string; text: string }>;
  strengths: string;
  weaknesses: string;
  moments: string[];
}

/** 職業說明由上方數值生成，確保文字與效果一致。 */
export function classInfo(id: PlayerClass): ClassInfo {
  const cfg = CLASSES[id];
  const st = cfg.start;
  const common = `共通：煙霧瓶 ${st.bottles}（Q）、藥水 ${st.potions}（H，回復 ${PLAYER.potionHeal}）、生命 ${PLAYER.maxHp}。`;
  if (id === 'warrior') {
    const w = CLASSES.warrior;
    const sw = MELEE.sword;
    const cs = w.counterSwing;
    const sh = ACTIONS.shield;
    const stone = PROJECTILES.stone;
    return {
      id,
      name: '戰士',
      promise: '敵人已經出手了，我走進他的攻擊節奏裡。',
      summary: '近戰職業。讀懂敵人的出手時機，用長劍打斷，用臂盾推開。',
      loadout: [
        {
          key: '1',
          name: '長劍',
          text: `${sw.damage} 傷害、${fmt(total(ACTIONS.sword))} 秒；對背後或未察覺的敵人 ×${sw.sneakMultiplier}。`,
        },
        {
          key: '右鍵／F',
          name: '臂盾',
          text: `盾推 ${fmt(total(sh))} 秒：作用的 ${fmt(sh.active)} 秒內擋下正面 ${SHIELD.arcDeg}° 的攻擊與弩矢，並把身前 ${SHIELD.pushReach} m 內的一名敵人推退 ${SHIELD.pushDist} m。`,
        },
        {
          key: '2',
          name: '投擲石',
          text: `${st.stones} 顆（上限 ${PLAYER.maxStones}）：${fmt(total(ACTIONS.stone))} 秒，身體 ${stone.body}、頭部 ${stone.head} 傷害，能打斷弩手瞄準；落地後可以撿回。`,
        },
      ],
      common,
      abilities: [
        {
          name: '反擊斬',
          text: `敵人的攻擊已鎖定、就在眼前時揮劍：出手 ${fmt(ACTIONS.sword.windup)} → ${fmt(cs.windup)} 秒，並往前踏半步（範圍 +${fmt(w.counterLunge)} m）。命中會打斷攻擊：盾衛失衡 ${fmt(ENEMIES.guard.stagger)} 秒（盾牌放下），突進者暈眩 ${fmt(ENEMIES.charger.stun)} 秒。`,
        },
        {
          name: '擊開',
          text: `揮劍時碰到飛來的弩矢，會把它朝準星方向打回去（身體 ${w.deflectBody}、頭部 ${w.deflectHead} 傷害）。`,
        },
        {
          name: '收招',
          text: `反擊或擊開成功時，這一劍不用收招（一般揮劍 ${fmt(total(ACTIONS.sword))} 秒，其中收招 ${fmt(ACTIONS.sword.recovery)} 秒）。`,
        },
        {
          name: '盾推的結果',
          text: `撞牆：失衡 ${fmt(SHIELD.wallStagger)} 秒、盾牌放下。撞到同伴：兩個都踉蹌 ${fmt(SHIELD.bumpStumble)} 秒。推上陷阱會觸發；推進突進者的衝鋒線會被撞。衝鋒中的突進者推不動：擋下衝撞、你被推退 ${fmt(SHIELD.chargeRecoil)} m，它不會暈眩（暈眩只給反擊斬）。`,
        },
      ],
      strengths: '擅長：盾衛、突進者等近戰敵人；敵人背後有牆的時候。',
      weaknesses: '弱點：沒有遠程主武器，投擲石很少；對付遠處的弩手要靠擊開或逼近。',
      moments: [
        '盾衛舉劍鎖定 → 走進去反擊斬，它失衡、盾牌放下 → 再補一劍。',
        '盾衛背後就是牆 → 盾推，它撞牆失衡。',
        '弩矢飛到眼前 → 揮劍，把它打回弩手身上。',
      ],
    };
  }
  const kn = MELEE.knife;
  const arrow = PROJECTILES.arrow;
  return {
    id,
    name: '獵手',
    promise: '我讓敵人的時間慢下來、停下來。',
    summary: '遠程職業。用獵弓射弱點，用藥劑箭改變敵人的出手節奏。',
    loadout: [
      {
        key: '1',
        name: '獵刀',
        text: `${kn.damage} 傷害、${fmt(total(ACTIONS.knife))} 秒；對背後或未察覺的敵人 ×${kn.sneakMultiplier}（${kn.damage * kn.sneakMultiplier}，可以一擊背刺盾衛）。`,
      },
      {
        key: '2',
        name: '獵弓',
        text: `一般箭 ${st.arrows} 支（上限 ${PLAYER.maxArrows}）：${fmt(total(ACTIONS.bow))} 秒，身體 ${arrow.body}、頭部 ${arrow.head} 傷害；箭插在牆上或掉在地上，可以撿回。`,
      },
      {
        key: '3',
        name: '藥劑箭',
        text: `${TIP_NAMES.paralysis} ${st.paralysis}、${TIP_NAMES.chill} ${st.chill}（再按一次 3 切換）。照一般箭造成傷害，再附加效果；藥劑碰到東西就用掉，箭身可以撿回當一般箭。`,
      },
    ],
    common,
    abilities: [
      {
        name: TIP_NAMES.paralysis,
        text: `命中後，敵人的時間軸暫停 ${fmt(TIPS.paralysis.duration)} 秒：舉劍、瞄準、衝鋒全部定格，已鎖定的攻擊也停在原地。`,
      },
      {
        name: TIP_NAMES.chill,
        text: `命中後 ${fmt(TIPS.chill.duration)} 秒內，敵人的時間軸以 ${TIPS.chill.timeScale} 倍速進行：舉劍與瞄準變兩倍長，衝鋒變一半快。`,
      },
      {
        name: '獵人之眼',
        text: '拿著弓時，空中的煙霧瓶旁出現提前量標記：瞄準標記射擊，箭就會在空中擊破它；地上的圓圈是它的落點。敵人沒有標記，射移動中的敵人要自己抓提前量。',
      },
    ],
    strengths: '擅長：遠處的弩手；讓舉劍中、衝鋒中的敵人慢下來或停下來。',
    weaknesses: `弱點：近戰弱，藥劑箭很少。盾衛看到你拿著遠程武器（${ENEMIES.guard.raiseRange} m 內）會舉盾前進，只有舉劍與收招時露出頭；突進者的角盔擋住正面的頭，撞牆暈眩時才露出。`,
    moments: [
      '突進者低頭衝來 → 一支冰寒箭，衝鋒變成一半速度 → 輕鬆側移，讓它撞牆暈眩。',
      '盾衛舉劍鎖定 → 麻痺箭射中頭部，它定格在舉劍的姿勢 → 再補一箭。',
      '丟出煙霧瓶 → 對準標記一箭射爆，擋住弩手的視線。',
    ],
  };
}

export const RENDER = {
  maxPixelRatio: 1.5,
  fov: 75,
  fogColor: 0x141226,
  fogDensity: 0.045,
} as const;
