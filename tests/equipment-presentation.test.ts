import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_POTIONS, ALL_SCROLLS, TALENT_FX, UPGRADE } from '../src/config';
import { addItem, itemDesc, itemName } from '../src/sim/items';
import type { World } from '../src/sim/world';
import { armorPresentation, bowPresentation, compareArmors, compareWeapons, weaponPresentation } from '../src/ui/equipment';
import { renderInventory } from '../src/ui/inventory';
import { makeWorld, OPEN_ROOM } from './helpers';

function inventoryHtml(w: World) {
  const nodes = {
    'inv-gear': { innerHTML: '' },
    'inv-count': { textContent: '' },
    'inv-list': { innerHTML: '', querySelectorAll: () => [] },
  };
  vi.stubGlobal('document', { getElementById: (id: keyof typeof nodes) => nodes[id] });
  renderInventory(w, vi.fn());
  return { gear: nodes['inv-gear'].innerHTML, list: nodes['inv-list'].innerHTML, count: nodes['inv-count'].textContent };
}

afterEach(() => vi.unstubAllGlobals());

describe('equipment baseline presentation follows levels and each tradeoff', () => {
  it.each([
    ['longsword', 2, '主傷 6', '基礎 0.6 秒', '65%／55%／80%'],
    ['knife', 3, '主傷 6', '基礎 0.4 秒', '85%／80%／95%'],
    ['axe', 2, '主傷 11', '基礎 1 秒', '35%／20%／45%'],
    ['spear', 1, '主傷 5', '基礎 0.85 秒', '40%／25%／65%'],
  ] as const)('%s +%i displays upgraded damage, base timing and phase movement', (id, level, damage, timing, move) => {
    const stats = weaponPresentation(id, level);
    expect(stats.summary).toContain(damage);
    expect(stats.summary).toContain(timing);
    expect(stats.details).toContain(`移速保留 ${move}`);
  });

  it('keeps axe secondary half-damage and knife conditional surprise distinct from generic damage', () => {
    const axe = weaponPresentation('axe', 2), knife = weaponPresentation('knife', 2);
    expect(axe.summary).toContain('最多 2 敵，次敵 5.5 傷害（50%）');
    expect(axe.details).toContain('失衡 0.6 秒，次敵 0.3 秒');
    expect(knife.summary).toContain('主傷 5');
    expect(knife.summary).toContain('最多 1 敵 · 奇襲 ×2');
    expect(knife.details).toContain('未目擊你的閒置／巡邏敵人');
    expect(knife.details).toContain('睡著的敵人');
    expect(weaponPresentation('spear', 0).details).toContain('首個身體擋下刺擊');
  });

  it('shows the slower, less mobile commitment beside increased weapon damage', () => {
    const compare = compareWeapons('axe', 0, 'longsword', 2);
    expect(compare.summary).toContain('目前 長劍 +2');
    expect(compare.summary).toContain('主傷 +1');
    expect(compare.summary).toContain('距離 +0.1 m');
    expect(compare.summary).toContain('動作慢 0.4 秒');
    expect(compare.details).toContain('最多命中 1 → 2 敵');
    expect(compare.details).toContain('65%／55%／80% → 35%／20%／45%');
    expect(compare.summary).not.toMatch(/DPS|更好|更差|評分/);
  });

  it('compares levels even for the same weapon, without claiming a timing improvement', () => {
    const up = compareWeapons('knife', 3, 'knife', 1), down = compareWeapons('knife', 0, 'knife', 1);
    expect(up.summary).toContain('主傷 +2 · 距離 相同 · 動作時間相同');
    expect(down.summary).toContain('主傷 −1');
    expect(compareWeapons('knife', 0, 'axe', 0).summary).toContain('動作快 0.6 秒');
  });

  it('shows actual capped armor reduction and the effective cap for both armor kinds', () => {
    const mail = armorPresentation('mail', 5), leather = armorPresentation('leather', 2);
    expect(mail.summary).toContain('減傷 3／次（上限 3）');
    expect(mail.summary).toContain('已達減傷上限');
    expect(mail.summary).toContain('行走腳步半徑 6 m · 潛行移速 40%');
    expect(mail.details).toContain('減傷自 +1 達上限，不能再強化');
    expect(leather.details).toContain('減傷自 +2 達上限，不能再強化');
    expect(armorPresentation('leather', 0).details).toContain('強化至 +2 達減傷上限');
    expect(armorPresentation('cloth', 5).summary).toContain('減傷 0／次');
    expect(armorPresentation('cloth', 5).summary).toContain('布衣不能強化');
  });

  it('states armor gains and stealth costs, and reverses them for a quieter replacement', () => {
    const heavier = compareArmors('mail', 1, 'leather', 0);
    expect(heavier.summary).toContain('減傷 +2');
    expect(heavier.summary).toContain('腳步半徑增 2 m（更吵）');
    expect(heavier.summary).toContain('潛行慢 10 百分點');
    const quieter = compareArmors('leather', 0, 'mail', 1);
    expect(quieter.summary).toContain('減傷 −2');
    expect(quieter.summary).toContain('腳步半徑減 2 m（更安靜）');
    expect(quieter.summary).toContain('潛行快 10 百分點');
    expect(quieter.details).toContain('至少仍受 1');
  });

  it('does not invent armor gains above the cap and accounts for selected Lightstep on both sides', () => {
    const compare = compareArmors('mail', 5, 'leather', 2, TALENT_FX.lightstepSpeed);
    expect(compare.summary).toContain('減傷 相同');
    expect(compare.summary).toContain('潛行慢 15 百分點');
    expect(compare.details).toContain('75% → 60%（兩邊皆已計輕步）');
    expect(armorPresentation('mail', 5, TALENT_FX.lightstepSpeed).summary).toContain('潛行移速 60%');
    expect(armorPresentation('mail', 5, TALENT_FX.lightstepSpeed).details).toContain('已計輕步 ×1.5');
  });

  it('shows upgraded bow body/head damage and equipment baseline timing', () => {
    expect(bowPresentation(2).summary).toBe('身體 5 · 頭部 10 傷害 · 基礎 0.8 秒');
    expect(bowPresentation(5).summary).toContain('身體 8 · 頭部 16 傷害');
    expect(bowPresentation(2).details).toContain('0.12／0／0.68 世界秒');
    expect(bowPresentation(2).details).toContain('每級身體 +1、頭部 +2，最高 +5');
  });
});

describe('inventory equipment rendering preserves ordinary actions and unknown identities', () => {
  it('renders upgraded equipped and bag stats with same-slot comparison, without mutating the world', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    w.player.weapon = { id: 'longsword', level: 2 };
    w.player.armor = { id: 'mail', level: 5 };
    w.player.bowLevel = 2;
    w.player.talents.push('lightstep');
    w.player.hasteT = 20;
    w.player.comboT = 2;
    addItem(w, 'weapon:axe', 3);
    addItem(w, 'armor:leather', 2);
    const before = JSON.stringify(w.player);
    const html = inventoryHtml(w);
    expect(html.gear).toContain('長劍 +2');
    expect(html.gear).toContain('主傷 6');
    expect(html.gear).toContain('鎖甲 +5');
    expect(html.gear).toContain('減傷 3／次');
    expect(html.gear).toContain('潛行移速 60%');
    expect(html.gear).toContain('身體 5 · 頭部 10 傷害 · 基礎 0.8 秒');
    expect(html.gear).toContain('未計臨時增益');
    expect(html.list).toContain('重斧 +3');
    expect(html.list).toContain('主傷 13');
    expect(html.list).toContain('目前 長劍 +2：主傷 +7');
    expect(html.list).toContain('目前 鎖甲 +5：減傷 相同');
    expect(html.list).toContain('data-k="0" data-m="use" aria-label="裝備重斧 +3"');
    expect(html.list).toContain('<details class="equipment-details">');
    expect(html.count).toBe('2 / 10 格');
    expect(JSON.stringify(w.player)).toBe(before);
  });

  it('does not show a bow for a warrior or hide current gear when the bag is empty', () => {
    const html = inventoryHtml(makeWorld(OPEN_ROOM, [], 'warrior'));
    expect(html.gear).toContain('主傷 4');
    expect(html.gear).toContain('布衣不能強化');
    expect(html.gear).not.toContain('獵弓');
    expect(html.list).toContain('背包是空的');
  });

  it.each(ALL_POTIONS)('unknown %s keeps the same generic description and drink/throw choices', (id) => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    w.player.known = [];
    w.player.talents.push('apothecary');
    addItem(w, `potion:${id}`);
    const html = inventoryHtml(w).list;
    expect(html).toContain(itemName(w, `potion:${id}`));
    expect(html).toContain(itemDesc(w, `potion:${id}`));
    expect(html).toContain('data-m="use">喝');
    expect(html).toContain('data-m="throw">丟出');
    expect(html).not.toMatch(/equipment-compare|equipment-details|轉化|藥劑師|disabled/);
    expect(w.player.known).toEqual([]);
  });

  it.each(ALL_SCROLLS)('unknown %s keeps its read choice and no effect preview', (id) => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    w.player.known = [];
    addItem(w, `scroll:${id}`);
    const html = inventoryHtml(w).list;
    expect(html).toContain('未知的卷軸：可用鑑定卷軸辨識，或讀了才知道效果。');
    expect(html).toContain('data-m="use">讀');
    expect(html).not.toMatch(/equipment-compare|equipment-details|disabled/);
    expect(w.player.known).toEqual([]);
  });

  it('disables reading when only ineffective capped targets remain, retaining the scroll and showing why', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    w.player.weapon.level = UPGRADE.maxLevel;
    w.player.armor = { id: 'mail', level: 1 };
    w.player.bowLevel = UPGRADE.maxLevel;
    addItem(w, 'scroll:upgrade');
    const html = inventoryHtml(w).list;
    expect(html).toContain('data-m="use" disabled');
    expect(html).toContain('沒有能提升效果的已裝備目標');
    expect(html).toContain('卷軸已保留');
    expect(w.player.items).toEqual([{ id: 'scroll:upgrade', count: 1, level: 0 }]);
    w.player.armor = { id: 'leather', level: 1 };
    expect(inventoryHtml(w).list).toContain('data-m="use">讀');
  });
});
