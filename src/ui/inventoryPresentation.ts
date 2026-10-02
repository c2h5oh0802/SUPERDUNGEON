import { POTION_LOOKS, SCROLL_LOOKS, type ArmorId, type ItemId, type PotionId, type ScrollId, type WeaponId } from '../config';
import { categoryOf, isKnown, looksFor } from '../sim/items';
import type { World } from '../sim/world';
import type { InvItem, PendingChoice } from '../sim/types';

/** Original, effect-neutral art names. Unknown identity never enters the asset URL. */
export const INVENTORY_ART = [
  'weapon-longsword', 'weapon-knife', 'weapon-axe', 'weapon-spear', 'weapon-bow',
  'armor-cloth', 'armor-leather', 'armor-mail', 'ration',
  'potion-look-red', 'potion-look-blue', 'potion-look-green', 'potion-look-violet', 'potion-look-amber', 'potion-look-silver',
  'scroll-look-ash', 'scroll-look-tide', 'scroll-look-thorn', 'scroll-look-star', 'scroll-upgrade', 'scroll-identify',
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

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A read and a lethal hit can complete in one substep; terminal outcomes own the screen. */
export function canPresentChoice(w: World, expected: PendingChoice | null = w.pendingChoice): boolean {
  return expected !== null && w.pendingChoice === expected && !w.player.dead && w.outcome === 'none';
}

/** Disclosure is only shown after the read has resolved and opened its choice. */
export function identifyChoiceDescription(learnedScroll = false): string {
  const reading = learnedScroll ? '你已認出鑑定卷軸，這張已使用；取消／Esc 只放棄額外鑑定，不退還卷軸。' : '取消／Esc 保留卷軸。';
  return `只選一疊，選中的物品不會消耗。本局同種類一起變已知，其他種類不受影響。世界與飢餓暫停。按數字鍵或點選；${reading}`;
}

/** Appearance-only even for stale options; first discovery is already spent. */
export function identifyChoiceMarkup(w: World, options: readonly InvItem[], learnedScroll = false): string {
  const cards = options.map((it, k) => {
    const name = `${itemAppearance(w, it.id)} · 未知${categoryOf(it.id) === 'potion' ? '藥水' : '卷軸'}`;
    const key = k < 10 ? `<kbd aria-hidden="true">${(k + 1) % 10}</kbd>` : '';
    return `<button class="choice-card identify-card" data-idx="${k}" aria-label="鑑定${esc(name)}，數量 ${it.count}">${key}<img class="identify-art" src="${esc(inventoryArtUrl(itemArt(w, it.id)))}" alt="" draggable="false" width="512" height="512"><div class="identify-copy"><h3>${esc(name)}</h3><p>這一疊 ×${it.count} · 物品完整保留</p></div></button>`;
  });
  if (!cards.length) cards.push(`<p class="identify-empty" role="status">背包沒有可鑑定的未知藥水或卷軸。${learnedScroll ? '已認出鑑定卷軸，這張已使用。' : '取消後保留鑑定卷軸。'}</p>`);
  cards.push(`<div class="identify-cancel-row"><button id="btn-identify-cancel">${learnedScroll ? '放棄額外鑑定，卷軸已使用' : '取消鑑定，保留卷軸'} <kbd>Esc</kbd></button></div>`);
  return cards.join('');
}

export function itemCategoryLabel(w: World, id: ItemId): string {
  const category = categoryOf(id);
  const label = { weapon: '近戰武器', armor: '護甲', food: '食物', potion: '藥水', scroll: '卷軸' }[category];
  return (category === 'potion' || category === 'scroll') ? `${label} · ${isKnown(w, id) ? '已辨識' : '未辨識'}` : label;
}
