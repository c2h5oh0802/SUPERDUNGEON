import { ACTIONS, ARMORS, ITEM_FX, TALENT_FX, TIP_NAMES, WEAPONS, type ArmorId, type WeaponId } from '../config';
import { categoryOf, conversionKind, conversionReason, isKnown, itemColor, itemDesc, itemName, lightstep, upgradeTargets } from '../sim/items';
import { maxTipped } from '../sim/progress';
import type { PendingUse } from '../sim/types';
import type { World } from '../sim/world';
import { armorPresentation, bowPresentation, compareArmors, compareWeapons, weaponPresentation, type EquipmentPresentation } from './equipment';

// 背包畫面：列出目前的裝備與背包內容，每一格提供可以做的事（喝、讀、丟出、裝備）。

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const details = (text: string, label: string): string => `<details class="equipment-details"><summary>${esc(label)}</summary><div>${esc(text)}</div></details>`;
const equipped = (slot: string, name: string, stats: EquipmentPresentation): string => `<div class="equipped-item"><span>${slot}：<b>${esc(name)}</b></span><div class="equipment-stats">${esc(stats.summary)}</div>${details(stats.details, slot === '護甲' ? '防護與潛行細節' : '出手細節')}</div>`;

export function renderInventory(w: World, onAction: (index: number, mode: PendingUse['mode']) => void): void {
  const p = w.player;
  const wp = WEAPONS[p.weapon.id];
  const sneakSpeed = lightstep(w).speed;
  const gear = [
    `<div class="inv-equipment-heading">目前裝備 <span>角色等級 ${p.level}</span></div>`,
    equipped('武器', `${wp.name} +${p.weapon.level}`, weaponPresentation(p.weapon.id, p.weapon.level)),
    equipped('護甲', `${ARMORS[p.armor.id].name} +${p.armor.level}`, armorPresentation(p.armor.id, p.armor.level, sneakSpeed)),
    p.cls === 'huntress' ? equipped('獵弓', `+${p.bowLevel}`, bowPresentation(p.bowLevel)) : '',
    '<div class="equipment-baseline">傷害、時間為已計強化的裝備基準；未計臨時增益、奇襲、敵人弱點、狩獵標記或反擊。奇襲倍率另列；潛行移速含已選輕步。</div>',
  ];
  if (p.shieldLevel > 0 || p.talents.some((t) => t === 'heavyShield' || t === 'bulwark')) gear.push('<span>舊版臂盾強化與盾牌天賦已停用；存檔資料保留。</span>');
  $('inv-gear').innerHTML = gear.join('');
  $('inv-count').textContent = `${p.items.length} / ${ITEM_FX.slots} 格`;
  const list = $('inv-list');
  if (!p.items.length) {
    list.innerHTML = '<p class="inv-empty">背包是空的。地上的物品、寶箱、倒下的敵人都可能有東西。</p>';
    return;
  }
  list.innerHTML = p.items
    .map((it, k) => {
      const c = categoryOf(it.id);
      const upgradeBlocked = it.id === 'scroll:upgrade' && upgradeTargets(w).length === 0;
      const upgradeReason = '目前沒有能提升效果的已裝備目標，卷軸已保留。可先換上仍能強化的裝備。';
      let acts =
        c === 'potion'
          ? `<button data-k="${k}" data-m="use"${it.id === 'potion:healing' && isKnown(w, it.id) && p.hp >= p.maxHp ? ' disabled' : ''}>喝</button><button data-k="${k}" data-m="throw">丟出</button>`
          : c === 'food'
            ? `<button data-k="${k}" data-m="use"${p.hunger <= 0 ? ' disabled' : ''}>${p.hunger <= 0 ? '已飽食' : '吃'}</button>`
          : c === 'scroll'
            ? `<button data-k="${k}" data-m="use"${upgradeBlocked ? ` disabled title="${upgradeReason}"` : ''}>讀</button>`
            : `<button data-k="${k}" data-m="use" aria-label="裝備${esc(itemName(w, it.id, it.level))}">裝備</button>`;
      // Unknown bottles keep exactly the ordinary drink/throw presentation.
      const kind = conversionKind(w, it.id);
      let conversion = '';
      if (kind) {
        const reason = conversionReason(w, it.id);
        const yieldCount = TALENT_FX.apothecaryYield;
        const spec = ACTIONS.convert;
        const seconds = (spec.windup + spec.active + spec.recovery) * (p.hasteT > 0 ? ITEM_FX.haste.timeMul : 1);
        acts += `<button data-k="${k}" data-m="convert"${reason ? ` disabled title="${esc(reason)}"` : ''}>轉化為${TIP_NAMES[kind]} ×${yieldCount}</button>`;
        conversion = `<div class="ds">${esc(`藥劑師：開始時消耗 1 瓶${itemName(w, it.id)}，花 ${seconds} 世界秒，完成後獲得 ${yieldCount} 支${TIP_NAMES[kind]}。目前 ${p.tipped[kind]} / ${maxTipped(p)}；需要 ${yieldCount} 格空間。${reason ?? ''}`)}</div>`;
      }
      const count = it.count > 1 ? ` ×${it.count}` : '';
      let description: string;
      if (c === 'weapon' || c === 'armor') {
        const id = it.id.split(':')[1]!;
        const stats = c === 'weapon'
          ? weaponPresentation(id as WeaponId, it.level)
          : armorPresentation(id as ArmorId, it.level, sneakSpeed);
        const comparison = c === 'weapon'
          ? compareWeapons(id as WeaponId, it.level, p.weapon.id, p.weapon.level)
          : compareArmors(id as ArmorId, it.level, p.armor.id, p.armor.level, sneakSpeed);
        description = `<div class="ds">${esc(stats.summary)}</div><div class="equipment-compare">${esc(comparison.summary)}</div>${details(`${stats.details}。${comparison.details}`, c === 'weapon' ? '出手、移速與命中取捨' : '防護與潛行細節')}`;
      } else description = `<div class="ds">${esc(itemDesc(w, it.id, it.level))}</div>`;
      if (upgradeBlocked) description += `<div class="ds equipment-blocked">${upgradeReason}</div>`;
      return `<div class="inv-row"><span class="swatch" style="background:${hex(itemColor(w.level.seed, it.id, w.level.potionLooksVersion))}"></span><div class="inv-item-body"><div class="nm">${esc(itemName(w, it.id, it.level))}${count}</div>${description}${conversion}</div><div class="acts">${acts}</div></div>`;
    })
    .join('');
  for (const b of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-k]')))
    b.addEventListener('click', () => onAction(Number(b.dataset.k), b.dataset.m as PendingUse['mode']));
}
