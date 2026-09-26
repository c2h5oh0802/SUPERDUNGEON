import { ARMORS, WEAPONS } from '../config';
import { categoryOf, itemColor, itemDesc, itemName } from '../sim/items';
import type { World } from '../sim/world';

// 背包畫面：列出目前的裝備與背包內容，每一格提供可以做的事（喝、讀、丟出、裝備）。

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export function renderInventory(w: World, onAction: (index: number, mode: 'use' | 'throw') => void): void {
  const p = w.player;
  const wp = WEAPONS[p.weapon.id];
  const gear = [
    `<span>武器：<b>${esc(wp.name)}${p.weapon.level ? ` +${p.weapon.level}` : ''}</b></span>`,
    `<span>護甲：<b>${esc(ARMORS[p.armor.id].name)}${p.armor.level ? ` +${p.armor.level}` : ''}</b></span>`,
    p.cls === 'huntress' ? `<span>獵弓：<b>+${p.bowLevel}</b></span>` : `<span>臂盾：<b>+${p.shieldLevel}</b></span>`,
    `<span>等級：<b>${p.level}</b></span>`,
  ];
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
      const acts =
        c === 'potion'
          ? `<button data-k="${k}" data-m="use">喝</button><button data-k="${k}" data-m="throw">丟出</button>`
          : c === 'scroll'
            ? `<button data-k="${k}" data-m="use">讀</button>`
            : `<button data-k="${k}" data-m="use">裝備</button>`;
      const count = it.count > 1 ? ` ×${it.count}` : '';
      return `<div class="inv-row"><span class="swatch" style="background:${hex(itemColor(w.level.seed, it.id))}"></span><div><div class="nm">${esc(itemName(w, it.id, it.level))}${count}</div><div class="ds">${esc(itemDesc(w, it.id))}</div></div><div class="acts">${acts}</div></div>`;
    })
    .join('');
  for (const b of Array.from(list.querySelectorAll<HTMLButtonElement>('button[data-k]')))
    b.addEventListener('click', () => onAction(Number(b.dataset.k), b.dataset.m as 'use' | 'throw'));
}
