import { ACTIONS, ARMORS, ITEM_FX, TALENT_FX, TIP_NAMES, WEAPONS } from '../config';
import { categoryOf, conversionKind, conversionReason, isKnown, itemColor, itemDesc, itemName } from '../sim/items';
import { maxTipped } from '../sim/progress';
import type { PendingUse } from '../sim/types';
import type { World } from '../sim/world';

// 背包畫面：列出目前的裝備與背包內容，每一格提供可以做的事（喝、讀、丟出、裝備）。

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function renderInventory(w: World, onAction: (index: number, mode: PendingUse['mode']) => void): void {
  const p = w.player;
  const wp = WEAPONS[p.weapon.id];
  const gear = [
    `<span>武器：<b>${esc(wp.name)}${p.weapon.level ? ` +${p.weapon.level}` : ''}</b></span>`,
    `<span>護甲：<b>${esc(ARMORS[p.armor.id].name)}${p.armor.level ? ` +${p.armor.level}` : ''}</b></span>`,
    p.cls === 'huntress' ? `<span>獵弓：<b>+${p.bowLevel}</b></span>` : '',
    `<span>等級：<b>${p.level}</b></span>`,
  ];
  if (p.shieldLevel > 0 || p.talents.some((t) => t === 'heavyShield' || t === 'bulwark')) gear.push('<span>舊版臂盾強化與盾牌天賦已停用；存檔資料保留。</span>');
  $('inv-gear').innerHTML = gear.join('');
  $('inv-count').textContent = `${p.items.length} / 10 格`;
  const list = $('inv-list');
  if (!p.items.length) {
    list.innerHTML = '<p class="inv-empty">背包是空的。地上的物品、寶箱、倒下的敵人都可能有東西。</p>';
    return;
  }
  list.innerHTML = p.items
    .map((it, k) => {
      const c = categoryOf(it.id);
      let acts =
        c === 'potion'
          ? `<button data-k="${k}" data-m="use"${it.id === 'potion:healing' && isKnown(w, it.id) && p.hp >= p.maxHp ? ' disabled' : ''}>喝</button><button data-k="${k}" data-m="throw">丟出</button>`
          : c === 'food'
            ? `<button data-k="${k}" data-m="use"${p.hunger <= 0 ? ' disabled' : ''}>${p.hunger <= 0 ? '已飽食' : '吃'}</button>`
          : c === 'scroll'
            ? `<button data-k="${k}" data-m="use">讀</button>`
            : `<button data-k="${k}" data-m="use">裝備</button>`;
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
      return `<div class="inv-row"><span class="swatch" style="background:${hex(itemColor(w.level.seed, it.id, w.level.potionLooksVersion))}"></span><div><div class="nm">${esc(itemName(w, it.id, it.level))}${count}</div><div class="ds">${esc(itemDesc(w, it.id))}</div>${conversion}</div><div class="acts">${acts}</div></div>`;
    })
    .join('');
  for (const b of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-k]')))
    b.addEventListener('click', () => onAction(Number(b.dataset.k), b.dataset.m as PendingUse['mode']));
}
