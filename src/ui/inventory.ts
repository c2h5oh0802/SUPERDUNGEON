import { ACTIONS, ARMORS, HUNGER, ITEM_FX, PLAYER, TALENT_FX, TIP_NAMES, WEAPONS, type ArmorId, type WeaponId } from '../config';
import { categoryOf, conversionKind, conversionReason, isKnown, itemColor, itemDesc, itemName, lightstep, upgradeTargets } from '../sim/items';
import { HUNGER_NAMES, hungerState } from '../sim/hunger';
import { maxStones, maxTipped } from '../sim/progress';
import type { InvItem, PendingUse } from '../sim/types';
import type { World } from '../sim/world';
import { armorPresentation, bowPresentation, compareArmors, compareWeapons, weaponPresentation, type EquipmentPresentation } from './equipment';
import { inventoryArtUrl, itemAppearance, itemArt, itemCategoryLabel, type InventoryArt } from './inventoryPresentation';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const compactInventory = (): boolean => Boolean(document.body?.classList?.contains('touch-mode') || window.matchMedia?.('(max-width: 700px), (pointer: coarse)').matches);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const image = (art: InventoryArt, cls = '') => `<img class="inv-art ${cls}" src="${esc(inventoryArtUrl(art))}" alt="" draggable="false" width="512" height="512">`;
const details = (text: string, label: string): string => `<details class="equipment-details"><summary>${esc(label)}</summary><div>${esc(text)}</div></details>`;
const equipped = (slot: string, name: string, art: InventoryArt, stats: EquipmentPresentation): string => `<section class="equipped-item"><div class="equipped-visual">${image(art)}<span class="inv-slot-label">${slot}</span></div><div class="equipped-copy"><h4>${esc(name)}</h4><div class="equipment-stats">${esc(stats.summary)}</div>${details(stats.details, slot === '護甲' ? '防護與潛行細節' : '出手細節')}</div></section>`;

function stock(art: InventoryArt, name: string, count: number, capacity: number, key: string): string {
  return `<div class="inv-stock-item${count === 0 ? ' depleted' : ''}">${image(art)}<span>${name}<small>${key}</small></span><b>${count}<small> / ${capacity}</small></b></div>`;
}

function itemActions(w: World, it: InvItem, k: number): string {
  const p = w.player, c = categoryOf(it.id);
  const upgradeBlocked = it.id === 'scroll:upgrade' && upgradeTargets(w).length === 0;
  const upgradeReason = '目前沒有能提升效果的已裝備目標，卷軸已保留。可先換上仍能強化的裝備。';
  let acts = c === 'potion'
    ? `<button data-k="${k}" data-m="use"${it.id === 'potion:healing' && isKnown(w, it.id) && p.hp >= p.maxHp ? ' disabled' : ''}>喝</button><button data-k="${k}" data-m="throw">丟出</button>`
    : c === 'food' ? `<button data-k="${k}" data-m="use"${p.hunger <= 0 ? ' disabled' : ''}>${p.hunger <= 0 ? '已飽食' : '吃'}</button>`
      : c === 'scroll' ? `<button data-k="${k}" data-m="use"${upgradeBlocked ? ` disabled title="${upgradeReason}"` : ''}>讀</button>`
        : `<button data-k="${k}" data-m="use" aria-label="裝備${esc(itemName(w, it.id, it.level))}">裝備</button>`;
  const kind = conversionKind(w, it.id);
  let conversion = '';
  if (kind) {
    const reason = conversionReason(w, it.id), yieldCount = TALENT_FX.apothecaryYield, spec = ACTIONS.convert;
    const seconds = (spec.windup + spec.active + spec.recovery) * (p.hasteT > 0 ? ITEM_FX.haste.timeMul : 1);
    acts += `<button data-k="${k}" data-m="convert"${reason ? ` disabled title="${esc(reason)}"` : ''}>轉化為${TIP_NAMES[kind]} ×${yieldCount}</button>`;
    conversion = `<p class="inv-recipe">${esc(`藥劑師：開始時消耗 1 瓶${itemName(w, it.id)}，花 ${seconds} 世界秒，完成後獲得 ${yieldCount} 支${TIP_NAMES[kind]}。目前 ${p.tipped[kind]} / ${maxTipped(p)}；需要 ${yieldCount} 格空間。${reason ?? ''}`)}</p>`;
  }
  const drop = `<button data-k="${k}" data-m="drop" aria-label="放下${esc(itemName(w, it.id, it.level))} 1 個">${it.count > 1 ? '放下 1 個' : '放下'}</button>${it.count > 1 ? `<button data-k="${k}" data-m="dropAll">全部放下（${it.count}）</button>` : ''}`;
  const blocked = upgradeBlocked ? `<p class="equipment-blocked">${upgradeReason}</p>`
    : it.id === 'potion:healing' && isKnown(w, it.id) && p.hp >= p.maxHp ? '<p class="equipment-blocked">生命已滿，治療藥水已保留。</p>' : '';
  return `${conversion}${blocked}<div class="acts inv-use-actions">${acts}</div><div class="inv-drop-area"><span>完整留在腳邊</span><div class="acts inv-drop-actions">${drop}</div></div>`;
}

function itemDescription(w: World, it: InvItem): string {
  const c = categoryOf(it.id), id = it.id.split(':')[1]!, speed = lightstep(w).speed;
  if (c !== 'weapon' && c !== 'armor') return `<p class="ds">${esc(itemDesc(w, it.id, it.level))}</p>`;
  const stats = c === 'weapon' ? weaponPresentation(id as WeaponId, it.level) : armorPresentation(id as ArmorId, it.level, speed);
  const comparison = c === 'weapon' ? compareWeapons(id as WeaponId, it.level, w.player.weapon.id, w.player.weapon.level)
    : compareArmors(id as ArmorId, it.level, w.player.armor.id, w.player.armor.level, speed);
  return `<p class="ds">${esc(stats.summary)}</p><div class="equipment-compare">${esc(comparison.summary)}</div>${details(`${stats.details}。${comparison.details}`, c === 'weapon' ? '出手、移速與命中取捨' : '防護與潛行細節')}`;
}

/** Visual selection is ephemeral; simulation and serialized inventory remain untouched. */
export function renderInventory(w: World, onAction: (index: number, mode: PendingUse['mode']) => void): void {
  const p = w.player, sneakSpeed = lightstep(w).speed;
  const dropSeconds = ACTIONS.drop.windup + ACTIONS.drop.active + ACTIONS.drop.recovery;
  const gear = [
    `<div class="inv-section-heading"><span>目前裝備</span><small>${p.cls === 'huntress' ? '獵手' : '戰士'} · 等級 ${p.level}</small></div>`,
    equipped('近戰', `${WEAPONS[p.weapon.id].name} +${p.weapon.level}`, `weapon-${p.weapon.id}`, weaponPresentation(p.weapon.id, p.weapon.level)),
    equipped('護甲', `${ARMORS[p.armor.id].name} +${p.armor.level}`, `armor-${p.armor.id}`, armorPresentation(p.armor.id, p.armor.level, sneakSpeed)),
    p.cls === 'huntress' ? equipped('獵弓', `獵弓 +${p.bowLevel}`, 'weapon-bow', bowPresentation(p.bowLevel)) : '',
    '<div class="inv-stock"><div class="inv-section-heading"><span>隨身物資</span><small>不占背包格</small></div>',
    stock('stock-smoke', '煙霧瓶', p.bottles, PLAYER.maxBottles, 'Q'),
    ...(p.cls === 'huntress' || p.arrows > 0 || p.tipped.chill > 0 || p.tipped.paralysis > 0 ? [
      stock('stock-arrow', '一般箭', p.arrows, PLAYER.maxArrows, '2'),
      stock('stock-arrow-chill', TIP_NAMES.chill, p.tipped.chill, maxTipped(p), '3 切換'),
      stock('stock-arrow-paralysis', TIP_NAMES.paralysis, p.tipped.paralysis, maxTipped(p), '3 切換'),
    ] : []),
    p.cls === 'warrior' || p.stones > 0 ? stock('stock-stone', '投擲石', p.stones, maxStones(p), p.cls === 'warrior' ? '2' : '') : '',
    '</div>',
    '<details class="equipment-details inv-rules"><summary>裝備數值與放下規則</summary><div class="equipment-baseline">傷害、時間為已計強化的裝備基準；未計臨時增益、奇襲、敵人弱點、狩獵標記或反擊。奇襲倍率另列；潛行移速含已選輕步。</div>',
    `<div class="equipment-baseline">放下物品會關閉背包並花 ${dropSeconds} 世界秒（迅捷時減半）。物品完整留在腳邊，走開再靠近可撿回；全部放下才能騰出堆疊格。下樓前請撿回想帶走的物品。</div></details>`,
  ];
  if (p.shieldLevel > 0 || p.talents.some((t) => t === 'heavyShield' || t === 'bulwark')) gear.push('<p class="equipment-baseline">舊版臂盾強化與盾牌天賦已停用；存檔資料保留。</p>');
  $('inv-gear')!.innerHTML = gear.join('');
  $('inv-count')!.textContent = `${p.items.length} / ${ITEM_FX.slots} 格`;
  const status = $('inv-status');
  if (status) status.innerHTML = `<span>生命 <b>${p.hp} / ${p.maxHp}</b></span><span>飢餓 <b>${HUNGER_NAMES[hungerState(p.hunger)]} · ${Math.floor(100 * p.hunger / HUNGER.starvingAt)}%</b>${w.hungerPaused ? '<small>首領戰暫停</small>' : ''}</span>`;
  const list = $('inv-list')!;
  const tiles = p.items.map((it, k) => `<button class="inv-row inv-tile${k === 0 ? ' selected' : ''}" data-select="${k}" aria-pressed="${k === 0}" aria-controls="inv-detail-${k}" aria-label="查看${esc(itemName(w, it.id, it.level))}，數量 ${it.count}"><span class="inv-tile-index">${String(k + 1).padStart(2, '0')}</span>${!isKnown(w, it.id) ? '<span class="inv-unknown" aria-hidden="true">?</span>' : ''}${image(itemArt(w, it.id))}<span class="inv-tile-label"><span class="swatch" aria-hidden="true" style="background:${hex(itemColor(w.level.seed, it.id, w.level.potionLooksVersion))}"></span><span>${esc(itemName(w, it.id))}</span></span><span class="inv-tile-quantity">${categoryOf(it.id) === 'weapon' || categoryOf(it.id) === 'armor' ? `+${it.level}` : `×${it.count}`}</span></button>`);
  for (let k = p.items.length; k < ITEM_FX.slots; k++) tiles.push(`<div class="inv-tile inv-empty-slot" aria-hidden="true"><span class="inv-tile-index">${String(k + 1).padStart(2, '0')}</span><span class="inv-empty-mark">＋</span></div>`);
  const overflow = p.items.length > ITEM_FX.slots ? '<p class="inv-overflow">舊存檔保留物品：超出容量的物品仍可使用或放下；背包上限維持 10 格。</p>' : '';
  const inspectors = p.items.map((it, k) => `<article class="inv-detail" id="inv-detail-${k}" data-detail="${k}"${k ? ' hidden' : ''}><div class="inv-section-heading"><span>物品檢視</span><small>${String(k + 1).padStart(2, '0')} / ${String(p.items.length).padStart(2, '0')}</small></div><div class="inv-inspect-visual">${image(itemArt(w, it.id))}<span class="inv-inspect-type">${esc(itemCategoryLabel(w, it.id))}</span></div><div class="inv-inspect-copy"><p class="inv-appearance">${esc(itemAppearance(w, it.id)) || '隨行裝備'}</p><h3>${esc(itemName(w, it.id, it.level))}<span>×${it.count}</span></h3>${itemDescription(w, it)}${itemActions(w, it, k)}<button class="inv-back-to-grid" data-return="${k}">返回背包格</button></div></article>`).join('');
  list.innerHTML = `<div class="inv-bag"><div class="inv-section-heading"><span>背包內容</span><small>每格一組物品</small></div><div class="inv-grid" aria-label="背包物品">${tiles.join('')}</div>${overflow}<p class="inv-bag-hint">選擇物品查看用途與操作<br>同種藥水、卷軸和乾糧會堆疊</p></div><div class="inv-inspector">${inspectors || '<div class="inv-inspect-empty"><span class="inv-empty-emblem">◇</span><h3>背包是空的</h3><p>地上的物品、寶箱、倒下的敵人都可能有東西。</p></div>'}</div>`;
  const stacks = [...p.items];
  for (const b of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-select]'))) {
    b.addEventListener('click', () => {
      const index = Number(b.dataset.select);
      for (const tile of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-select]'))) {
        const selected = Number(tile.dataset.select) === index;
        tile.classList.toggle('selected', selected); tile.setAttribute('aria-pressed', String(selected));
      }
      for (const detail of Array.from(list.querySelectorAll<HTMLElement>('[data-detail]'))) detail.hidden = Number(detail.dataset.detail) !== index;
      if (compactInventory()) {
        const detail = list.querySelector<HTMLElement>(`[data-detail="${index}"]`);
        detail?.scrollIntoView({ block: 'start' });
        const heading = detail?.querySelector<HTMLElement>('h3');
        heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true });
      }
    });
  }
  for (const b of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-return]'))) {
    b.addEventListener('click', () => {
      const tile = list.querySelector<HTMLButtonElement>(`button[data-select="${b.dataset.return}"]`);
      if (compactInventory()) tile?.scrollIntoView({ block: 'center' });
      tile?.focus({ preventScroll: compactInventory() });
    });
  }
  let dispatched = false;
  for (const b of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-k]'))) {
    b.addEventListener('click', () => {
      if (dispatched || b.disabled) return;
      const index = p.items.indexOf(stacks[Number(b.dataset.k)]!);
      if (index < 0) return;
      dispatched = true;
      onAction(index, b.dataset.m as PendingUse['mode']);
    });
  }
}

/** Called only after the inventory screen is visible. Native buttons retain normal keyboard behavior. */
export function focusInventory(): void {
  const screen = $('screen-inventory');
  if (!screen) return;
  (screen.querySelector<HTMLElement>('.inv-tile[data-select]') ?? $('btn-inv-close'))?.focus();
  screen.onkeydown = (e) => {
    if (e.code !== 'Tab') return;
    const targets = Array.from(screen.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [tabindex="0"]')).filter((el) => !el.closest('[hidden]') && el.getClientRects().length > 0);
    const first = targets[0], last = targets[targets.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
}
