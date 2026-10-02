import { ALL_ARMORS, ALL_POTIONS, ALL_SCROLLS, ALL_WEAPONS, type ItemId } from '../config';
import type { Rng } from '../core/rng';

// Keep always-known Identify separate from the unknown-scroll appearance pool.
const SCROLL_LOOT = [...ALL_SCROLLS, 'identify'] as const;

// 掉落表：生成器（地上、寶箱）與敵人掉落共用。與職業無關，同一個種子兩個職業拿到的一樣。

export interface LootRoll {
  id: ItemId;
  level: number;
}

export function rollPotion(rng: Rng, source: 'floor' | 'enemy' = 'floor'): LootRoll {
  const pool = source === 'enemy' ? ALL_POTIONS.filter((id) => id !== 'healing') : ALL_POTIONS;
  return { id: `potion:${rng.pick(pool)}`, level: 0 };
}

export function rollScroll(rng: Rng): LootRoll {
  return { id: `scroll:${rng.pick(SCROLL_LOOT)}`, level: 0 };
}

/** 裝備：越深越可能已經強化過。 */
export function rollEquipment(rng: Rng, floor: number): LootRoll {
  const armors = ALL_ARMORS.filter((a) => a !== 'cloth');
  const pick = rng.int(0, ALL_WEAPONS.length + armors.length - 1);
  const id: ItemId = pick < ALL_WEAPONS.length ? `weapon:${ALL_WEAPONS[pick]!}` : `armor:${armors[pick - ALL_WEAPONS.length]!}`;
  const level = floor >= 3 && rng.chance(0.5) ? 1 : 0;
  return { id, level };
}

export function rollConsumable(rng: Rng, source: 'floor' | 'enemy' = 'floor'): LootRoll {
  return rng.chance(0.6) ? rollPotion(rng, source) : rollScroll(rng);
}

export function rollItem(rng: Rng, floor: number, source: 'floor' | 'enemy' = 'floor'): LootRoll {
  return rng.chance(0.7) ? rollConsumable(rng, source) : rollEquipment(rng, floor);
}
