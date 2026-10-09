import {
  ALL_ARMORS, ALL_POTIONS, ALL_SCROLLS, ALL_WEAPONS, ARMOR_CURSES, ARMOR_GLYPHS, GEAR, POTIONS_V2, SCROLLS_V2,
  WEAPON_CURSES, WEAPON_ENCHANTS, type ItemId,
} from '../config';
import type { Rng } from '../core/rng';
import type { GearProps } from '../sim/types';

// 掉落表：生成器（地上、寶箱）與敵人掉落共用。與職業無關，同一個種子兩個職業拿到的一樣。
// pool 1＝舊版（生成版本 1 與舊存檔的亂數不變）；pool 2＝生成版本 2：多了新消耗品，
// 裝備是未知的（等級 +0～+2，可能有附魔或詛咒）。

export type LootPool = 1 | 2;

export interface LootRoll extends GearProps {
  id: ItemId;
  level: number;
}

export function rollPotion(rng: Rng, source: 'floor' | 'enemy' = 'floor', pool: LootPool = 1): LootRoll {
  const all = pool === 2 ? POTIONS_V2 : ALL_POTIONS;
  const list = source === 'enemy' ? all.filter((id) => id !== 'healing') : all;
  return { id: `potion:${rng.pick(list)}`, level: 0 };
}

export function rollScroll(rng: Rng, pool: LootPool = 1): LootRoll {
  return { id: `scroll:${rng.pick(pool === 2 ? SCROLLS_V2 : ALL_SCROLLS)}`, level: 0 };
}

/** 隨機一種附魔或刻紋（依武器或護甲）。 */
export function rollEnchant(rng: Rng, id: ItemId): GearProps['ench'] {
  return id.startsWith('weapon:') ? rng.pick(WEAPON_ENCHANTS) : rng.pick(ARMOR_GLYPHS);
}

/** 裝備：舊版越深越可能已經強化過；生成版本 2 是未知的裝備。 */
export function rollEquipment(rng: Rng, floor: number, pool: LootPool = 1): LootRoll {
  const armors = ALL_ARMORS.filter((a) => a !== 'cloth');
  const pick = rng.int(0, ALL_WEAPONS.length + armors.length - 1);
  const id: ItemId = pick < ALL_WEAPONS.length ? `weapon:${ALL_WEAPONS[pick]!}` : `armor:${armors[pick - ALL_WEAPONS.length]!}`;
  if (pool === 1) {
    const level = floor >= 3 && rng.chance(0.5) ? 1 : 0;
    return { id, level };
  }
  const fi = Math.max(0, Math.min(3, floor - 1));
  if (rng.chance(GEAR.curseChance)) {
    const curse = rng.pick(id.startsWith('weapon:') ? WEAPON_CURSES : ARMOR_CURSES);
    // 以前這裡擲 −1 或 +0；照樣擲一次，同一個種子的其他結果才不會變（進行中的存檔也一樣）。
    rng.chance(0.5);
    return { id, level: 0, curse, unknown: true };
  }
  const weights = GEAR.levelWeights[fi >= 2 ? 1 : 0]!;
  let roll = rng.next();
  let k = 0;
  for (; k < weights.length - 1; k++) {
    roll -= weights[k]!;
    if (roll < 0) break;
  }
  const out: LootRoll = { id, level: k, unknown: true };
  if (rng.chance(GEAR.enchantChance[fi] ?? 0)) out.ench = rollEnchant(rng, id);
  return out;
}

export function rollConsumable(rng: Rng, source: 'floor' | 'enemy' = 'floor', pool: LootPool = 1): LootRoll {
  return rng.chance(0.6) ? rollPotion(rng, source, pool) : rollScroll(rng, pool);
}

export function rollItem(rng: Rng, floor: number, source: 'floor' | 'enemy' = 'floor', pool: LootPool = 1): LootRoll {
  return rng.chance(0.7) ? rollConsumable(rng, source, pool) : rollEquipment(rng, floor, pool);
}
