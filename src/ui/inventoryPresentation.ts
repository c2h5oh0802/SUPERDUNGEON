import { POTION_LOOKS, SCROLL_LOOKS, type ArmorId, type ItemId, type PotionId, type ScrollId, type WeaponId } from '../config';
import { categoryOf, isKnown, looksFor } from '../sim/items';
import type { World } from '../sim/world';

/** Original, effect-neutral art names. Unknown identity never enters the asset URL. */
export const INVENTORY_ART = [
  'weapon-longsword', 'weapon-knife', 'weapon-axe', 'weapon-spear', 'weapon-bow',
  'armor-cloth', 'armor-leather', 'armor-mail', 'ration',
  'potion-look-red', 'potion-look-blue', 'potion-look-green', 'potion-look-violet', 'potion-look-amber', 'potion-look-silver',
  'scroll-look-ash', 'scroll-look-tide', 'scroll-look-thorn', 'scroll-look-star', 'scroll-upgrade',
  'stock-smoke', 'stock-stone', 'stock-arrow', 'stock-arrow-chill', 'stock-arrow-paralysis',
] as const;
export type InventoryArt = typeof INVENTORY_ART[number];
const BOTTLES = INVENTORY_ART.slice(9, 15) as readonly InventoryArt[];
const SCROLLS = INVENTORY_ART.slice(15, 19) as readonly InventoryArt[];

export function inventoryArtUrl(art: InventoryArt): string {
  // Vite rewrites this finite asset glob with the configured relative base.
  return new URL(`../assets/inventory/${art}.webp`, import.meta.url).href;
}

export function itemArt(w: World, id: ItemId): InventoryArt {
  const category = categoryOf(id), key = id.split(':')[1]!;
  if (category === 'weapon') return `weapon-${key as WeaponId}`;
  if (category === 'armor') return `armor-${key as ArmorId}`;
  if (category === 'food') return 'ration';
  if (id === 'scroll:upgrade') return 'scroll-upgrade';
  const looks = looksFor(w.level.seed, w.level.potionLooksVersion);
  return category === 'potion' ? BOTTLES[looks.potion[key as PotionId]]! : SCROLLS[looks.scroll[key as ScrollId]]!;
}

export function itemAppearance(w: World, id: ItemId): string {
  const category = categoryOf(id), key = id.split(':')[1]!;
  if (category === 'potion') return `${POTION_LOOKS[looksFor(w.level.seed, w.level.potionLooksVersion).potion[key as PotionId]]!.name}瓶身`;
  if (category === 'scroll' && id !== 'scroll:upgrade') return `${SCROLL_LOOKS[looksFor(w.level.seed, w.level.potionLooksVersion).scroll[key as ScrollId]]!}符文`;
  return '';
}

export function itemCategoryLabel(w: World, id: ItemId): string {
  const category = categoryOf(id);
  const label = { weapon: '近戰武器', armor: '護甲', food: '食物', potion: '藥水', scroll: '卷軸' }[category];
  return (category === 'potion' || category === 'scroll') ? `${label} · ${isKnown(w, id) ? '已辨識' : '未辨識'}` : label;
}
