import {
  ALL_ARMORS,
  ALL_CLASSES,
  ALL_POTIONS,
  ALL_SCROLLS,
  ALL_WEAPONS,
  ITEM_FX,
  HUNGER,
  PLAYER,
  RUN,
  TALENTS,
  TALENT_FX,
  UPGRADE,
  XP,
  type ArmorId,
  type ItemId,
  type PlayerClass,
  type TalentId,
  type WeaponId,
} from '../config';
import { generateLevel } from '../gen/validate';
import type { RunStats } from './types';
import { World, type PlayerCarry } from './world';

// 一局＝同一個種子的 RUN.floors 層。每層開頭的狀態（樓層、帶下來的物資、累積統計）就是存檔內容：
// 從存檔繼續＝用同一個種子重新生成那一層，再把物資帶進去。

export interface RunState {
  seed: string;
  cls: PlayerClass;
  /** 舊局保留五種藥水的既有外觀；新局使用六種藥水的完整排列。 */
  potionLooksVersion?: 1 | 2;
  /** 目前樓層（1 起算）。 */
  floor: number;
  /** 進入這一層時的玩家狀態（第 1 層為 null＝職業起始裝備）。 */
  carry: PlayerCarry | null;
  /** 進入這一層時的累積統計。 */
  stats: RunStats | null;
}

export function newRun(seed: string, cls: PlayerClass): RunState {
  return { seed, cls, potionLooksVersion: 2, floor: 1, carry: null, stats: null };
}

/** 生成這一層並建立世界。 */
export function createFloorWorld(run: RunState): World {
  const level = generateLevel(run.seed, { floor: run.floor });
  level.potionLooksVersion = run.potionLooksVersion ?? 2;
  return new World(level, { cls: run.cls, carry: run.carry ?? undefined, stats: run.stats ?? undefined });
}

/** 走下階梯之後的下一層狀態。 */
export function nextFloor(run: RunState, w: World): RunState {
  return { ...run, floor: Math.min(RUN.floors, run.floor + 1), carry: w.carry(), stats: w.statsCopy() };
}

// ---------- 存檔 ----------

const SAVE_VERSION = 2;
// Additive v2 marker: only migrated healing can occupy one extra bag slot.
const INVENTORY_VERSION = 1;
const LEGACY_MAX_POTIONS = 3;

const ITEM_IDS = new Set<string>([
  'food:ration',
  ...ALL_POTIONS.map((k) => `potion:${k}`),
  ...ALL_SCROLLS.map((k) => `scroll:${k}`),
  'scroll:upgrade', 'scroll:identify',
  // Accepted only as migration input; neither remains in the active pool.
  'scroll:timeStop', 'scroll:lure',
  ...ALL_WEAPONS.map((k) => `weapon:${k}`),
  ...ALL_ARMORS.map((k) => `armor:${k}`),
]);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function serializeRun(run: RunState): string {
  const carry = run.carry ? { ...run.carry } : null;
  // Do not reintroduce retired numeric stock even if an old runtime caller passed it.
  if (carry) Reflect.deleteProperty(carry, 'potions');
  return JSON.stringify({ v: SAVE_VERSION, chapter: 2, inventoryVersion: INVENTORY_VERSION, ...run,
    potionLooksVersion: run.potionLooksVersion ?? 2, carry });
}

const isNum = (v: unknown, min: number, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;

/** 解析並檢查存檔；格式不對就回傳 null（不相信存檔內容）。 */
export function parseRun(text: string | null): RunState | null {
  if (!text) return null;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!o || o.v !== SAVE_VERSION || (o.chapter !== undefined && o.chapter !== 2)) return null;
  if (o.inventoryVersion !== undefined && o.inventoryVersion !== INVENTORY_VERSION) return null;
  if (o.potionLooksVersion !== undefined && o.potionLooksVersion !== 1 && o.potionLooksVersion !== 2) return null;
  const potionLooksVersion = o.potionLooksVersion === undefined ? 1 : o.potionLooksVersion;
  // Legacy floor-4 checkpoints keep their carry and resume exploration floor 4;
  // the new arena follows. Floor-start saves never contain a won/Heart-taken state.
  if (typeof o.seed !== 'string' || !o.seed || o.seed.length > 32) return null;
  if (!ALL_CLASSES.includes(o.cls as PlayerClass)) return null;
  if (!isNum(o.floor, 1, RUN.floors) || !Number.isInteger(o.floor)) return null;
  let carry: PlayerCarry | null = null;
  if (o.carry !== null) {
    const c = o.carry as Record<string, unknown>;
    const t = (c?.tipped ?? {}) as Record<string, unknown>;
    if (
      !c ||
      !isNum(c.maxHp, 1, 80) ||
      !isNum(c.hp, 1, c.maxHp as number) ||
      !isNum(c.arrows, 0, PLAYER.maxArrows) ||
      !isNum(c.stones, 0, PLAYER.maxStones + 3) ||
      !isNum(t.paralysis, 0, PLAYER.maxTipped + 1) ||
      !isNum(t.chill, 0, PLAYER.maxTipped + 1) ||
      (c.tipKind !== 'paralysis' && c.tipKind !== 'chill') ||
      !isNum(c.bottles, 0, PLAYER.maxBottles)
    )
      return null;
    const wp = (c.weapon ?? {}) as Record<string, unknown>;
    const ar = (c.armor ?? {}) as Record<string, unknown>;
    if (!ALL_WEAPONS.includes(wp.id as WeaponId) || !isInt(wp.level, 0, UPGRADE.maxLevel)) return null;
    if (!ALL_ARMORS.includes(ar.id as ArmorId) || !isInt(ar.level, 0, UPGRADE.maxLevel)) return null;
    if (!isInt(c.bowLevel, 0, UPGRADE.maxLevel) || !isInt(c.shieldLevel, 0, UPGRADE.maxLevel)) return null;
    const legacyPotions = c.potions === undefined ? 0 : c.potions;
    if (!isInt(legacyPotions, 0, LEGACY_MAX_POTIONS)) return null;
    if (!Array.isArray(c.items)) return null;
    const hasHealingOverflow = o.inventoryVersion === INVENTORY_VERSION && c.potions === undefined &&
      c.items.length === ITEM_FX.slots + 1 && c.items.some((it) => it?.id === 'potion:healing');
    if (c.items.length > ITEM_FX.slots && !hasHealingOverflow) return null;
    for (const it of c.items as Array<Record<string, unknown>>) {
      if (!it || !ITEM_IDS.has(it.id as string) || !isInt(it.count, 1, 99) || !isInt(it.level, 0, UPGRADE.maxLevel)) return null;
    }
    if (!Array.isArray(c.known) || !c.known.every((k) => ITEM_IDS.has(k as string))) return null;
    if (!isInt(c.xp, 0, 100000) || !isInt(c.level, 1, XP.levels.length)) return null;
    if (!Array.isArray(c.talents) || !c.talents.every((t) => (t as string) in TALENTS)) return null;
    // v2 的新增欄位是可選的；舊檔以飽食、沒有殘留傷害計時續玩。
    const hunger = c.hunger === undefined ? 0 : c.hunger;
    const starvationT = c.starvationT === undefined ? 0 : c.starvationT;
    if (!isNum(hunger, 0, HUNGER.starvingAt) || !isNum(starvationT, 0, HUNGER.damageEvery)) return null;
    if (starvationT >= HUNGER.damageEvery || (hunger < HUNGER.starvingAt && starvationT !== 0)) return null;
    // Legacy v2 stored Rune IDs alongside their effects. Ignore every ID (including
    // unknown ones); only the identifiable vigor HP increment needs migration.
    // Never subtract legitimate level/toughness growth or retroactively undo healing.
    const progressionHp = PLAYER.maxHp + (c.level - 1) * XP.hpPerLevel +
      (c.talents.includes('toughness') ? TALENT_FX.toughnessHp : 0);
    const legacyVigorHp = Array.isArray(c.runes) && c.runes.includes('vigor')
      ? Math.min(4, Math.max(0, (c.maxHp as number) - progressionHp)) : 0;
    const maxHp = (c.maxHp as number) - legacyVigorHp;
    carry = {
      hp: Math.min(c.hp as number, maxHp),
      maxHp,
      hunger,
      starvationT,
      arrows: c.arrows as number,
      stones: c.stones as number,
      tipped: { paralysis: t.paralysis as number, chill: t.chill as number },
      tipKind: c.tipKind,
      bottles: c.bottles as number,
      weapon: { id: wp.id as WeaponId, level: wp.level as number },
      armor: { id: ar.id as ArmorId, level: ar.level as number },
      bowLevel: c.bowLevel as number,
      shieldLevel: c.shieldLevel as number,
      items: migrateItems(c.items as Array<{ id: string; count: number; level: number }>, legacyPotions),
      known: [...new Set([...(c.known as string[]).filter((id) => id !== 'scroll:lure').map((id) => id === 'scroll:timeStop' ? 'scroll:sleep' : id),
        ...(legacyPotions > 0 ? ['potion:healing'] : [])])] as ItemId[],
      xp: c.xp as number,
      level: c.level as number,
      talents: (c.talents as TalentId[]).slice(),
    };
  }
  let stats: RunStats | null = null;
  if (o.stats !== null) {
    const s = o.stats as Record<string, unknown>;
    if (!s || typeof s !== 'object' || !isNum(s.worldTime, 0, 1e7) || !isNum(s.realTime, 0, 1e7)) return null;
    const dmg = (s.damageTaken ?? {}) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(dmg)) if (isNum(v, 0, 1e6)) out[k] = v;
    const num = (k: string) => (isNum(s[k], 0, 1e7) ? (s[k] as number) : 0);
    stats = {
      kills: num('kills'),
      sneakKills: num('sneakKills'),
      backstabs: num('backstabs'),
      shots: num('shots'),
      shotHits: num('shotHits'),
      airbursts: num('airbursts'),
      bottlesThrown: num('bottlesThrown'),
      potionsUsed: num('potionsUsed'),
      healingFound: num('healingFound'),
      healingUsed: num('healingUsed'),
      healingRestored: num('healingRestored'),
      healingWasted: num('healingWasted'),
      damageTaken: out,
      realTime: num('realTime'),
      worldTime: num('worldTime'),
      chests: num('chests'),
      counters: num('counters'),
      deflects: num('deflects'),
      pushes: num('pushes'),
      blocks: num('blocks'),
      wallSlams: num('wallSlams'),
      tipHits: num('tipHits'),
      itemsUsed: num('itemsUsed'),
    };
  }
  if (o.floor !== 1 && (!carry || !stats)) return null;
  return { seed: o.seed, cls: o.cls as PlayerClass, potionLooksVersion, floor: o.floor, carry, stats };
}

/** Retired lure is discarded, not compensated with a stronger resource. Sleep aliases
 * merge without losing quantities, preserving >99 as a second valid legacy stack.
 * Numeric healing stock is moved into the bag after normal item migration. A full
 * old bag may retain one extra healing stack until enough items have been used. */
function migrateItems(items: Array<{ id: string; count: number; level: number }>, legacyPotions: number): PlayerCarry['items'] {
  const out: PlayerCarry['items'] = [];
  for (const it of items) {
    if (it.id === 'scroll:lure') continue;
    const id = (it.id === 'scroll:timeStop' ? 'scroll:sleep' : it.id) as ItemId;
    let count = it.count;
    if (id === 'scroll:sleep') {
      const stack = out.find((s) => s.id === id && s.count < 99);
      if (stack) { const added = Math.min(count, 99 - stack.count); stack.count += added; count -= added; }
    }
    if (count) out.push({ id, count, level: it.level });
  }
  let healingLeft = legacyPotions;
  for (const stack of out) {
    if (stack.id !== 'potion:healing' || healingLeft === 0) continue;
    const added = Math.min(healingLeft, 99 - stack.count);
    stack.count += added;
    healingLeft -= added;
  }
  if (healingLeft > 0) out.push({ id: 'potion:healing', count: healingLeft, level: 0 });
  return out;
}
