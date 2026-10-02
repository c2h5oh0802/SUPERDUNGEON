import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ALL_ARMORS, ALL_POTIONS, ALL_SCROLLS, ALL_WEAPONS, ITEM_FX, POTIONS, POTION_LOOKS, SCROLLS, SCROLL_LOOKS,
  type ItemId,
} from '../src/config';
import { identify, itemColor, itemName, looksFor } from '../src/sim/items';
import { newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import type { InvItem, PendingUse } from '../src/sim/types';
import { World } from '../src/sim/world';
import { focusInventory, renderInventory } from '../src/ui/inventory';
import { INVENTORY_ART, inventoryArtUrl, itemAppearance, itemArt, itemCategoryLabel } from '../src/ui/inventoryPresentation';
import { makeWorld, testLevel, OPEN_ROOM } from './helpers';

const EXPECTED_ART = [
  'weapon-longsword', 'weapon-knife', 'weapon-axe', 'weapon-spear', 'weapon-bow',
  'armor-cloth', 'armor-leather', 'armor-mail', 'ration',
  'potion-look-red', 'potion-look-blue', 'potion-look-green', 'potion-look-violet', 'potion-look-amber', 'potion-look-silver',
  'scroll-look-ash', 'scroll-look-tide', 'scroll-look-thorn', 'scroll-look-star', 'scroll-upgrade', 'scroll-identify',
  'stock-smoke', 'stock-stone', 'stock-arrow', 'stock-arrow-chill', 'stock-arrow-paralysis',
] as const;
const POTION_ART = EXPECTED_ART.slice(9, 15);
const SCROLL_ART = EXPECTED_ART.slice(15, 19);
const ALL_ITEMS: ItemId[] = [
  ...ALL_WEAPONS.map((id): ItemId => `weapon:${id}`),
  ...ALL_ARMORS.map((id): ItemId => `armor:${id}`),
  'food:ration', ...ALL_POTIONS.map((id): ItemId => `potion:${id}`),
  ...ALL_SCROLLS.map((id): ItemId => `scroll:${id}`), 'scroll:upgrade',
];
const UNKNOWN_ITEMS: ItemId[] = [
  ...ALL_POTIONS.map((id): ItemId => `potion:${id}`), ...ALL_SCROLLS.map((id): ItemId => `scroll:${id}`),
];
const EFFECT_NAMES = [...ALL_POTIONS.map(id => POTIONS[id].name), ...ALL_SCROLLS.map(id => SCROLLS[id].name)];
const EFFECT_KEYS = [...ALL_POTIONS, ...ALL_SCROLLS];
const matchCount = (html: string, pattern: RegExp) => [...html.matchAll(pattern)].length;
const artSources = (html: string) => [...html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)].map(m => m[1]);
const item = (id: ItemId, count = 1, level = 0): InvItem => ({ id, count, level });

/** Minimal Node DOM seam: records real renderer markup and attached handlers.
 * Layout, native keys, image decoding, and actual focus are browser-test concerns. */
function inventoryDom(w: World, onAction = vi.fn<(index: number, mode: PendingUse['mode']) => void>(), compact = false) {
  type Listener = () => void;
  class Element {
    readonly attrs: Record<string, string>;
    readonly dataset: Record<string, string>;
    readonly listeners: Record<string, Listener[]> = {};
    readonly classes: Set<string>;
    readonly heading = { setAttribute: vi.fn(), focus: vi.fn() };
    readonly scrollIntoView = vi.fn();
    readonly focus = vi.fn();
    querySelector(selector: string) { return selector === 'h3' ? this.heading : null; }
    hidden: boolean;
    disabled: boolean;
    constructor(tag: string) {
      this.attrs = Object.fromEntries([...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
      this.dataset = Object.fromEntries(Object.entries(this.attrs).filter(([k]) => k.startsWith('data-')).map(([k, v]) => [k.slice(5), v]));
      this.classes = new Set((this.attrs.class ?? '').split(' '));
      this.hidden = /\shidden(?:\s|>)/.test(tag);
      this.disabled = /\sdisabled(?:\s|>)/.test(tag);
    }
    classList = { toggle: (name: string, force: boolean) => { if (force) this.classes.add(name); else this.classes.delete(name); } };
    setAttribute(name: string, value: string) { this.attrs[name] = value; }
    addEventListener(name: string, handler: Listener) { (this.listeners[name] ??= []).push(handler); }
    click() { for (const handler of this.listeners.click ?? []) handler(); }
  }
  let buttons: Element[] = [], articles: Element[] = [], listHtml = '';
  const nodes = {
    'inv-gear': { innerHTML: '' },
    'inv-status': { innerHTML: '' },
    'inv-count': { textContent: '' },
    'inv-list': {
      get innerHTML() { return listHtml; },
      set innerHTML(value: string) {
        listHtml = value;
        buttons = [...value.matchAll(/<button\b[^>]*>/g)].map(m => new Element(m[0]));
        articles = [...value.matchAll(/<article\b[^>]*>/g)].map(m => new Element(m[0]));
      },
      querySelector(selector: string) {
        const index = /"(\d+)"/.exec(selector)?.[1];
        if (selector.startsWith('[data-detail=')) return articles.find(a => a.dataset.detail === index);
        if (selector.startsWith('button[data-select=')) return buttons.find(b => b.dataset.select === index);
        return null;
      },
      querySelectorAll(selector: string) {
        if (selector === 'button[data-select]') return buttons.filter(b => 'select' in b.dataset);
        if (selector === 'button[data-k]') return buttons.filter(b => 'k' in b.dataset);
        if (selector === 'button[data-return]') return buttons.filter(b => 'return' in b.dataset);
        if (selector === '[data-detail]') return articles;
        throw new Error(`Unhandled renderer selector: ${selector}`);
      },
    },
  };
  vi.stubGlobal('window', { matchMedia: () => ({ matches: compact }) });
  vi.stubGlobal('document', { getElementById: (id: keyof typeof nodes) => nodes[id] ?? null });
  renderInventory(w, onAction);
  return {
    list: listHtml, gear: nodes['inv-gear'].innerHTML, status: nodes['inv-status'].innerHTML,
    count: nodes['inv-count'].textContent, onAction, articles,
    tiles: buttons.filter(b => 'select' in b.dataset),
    actions: buttons.filter(b => 'k' in b.dataset),
    returns: buttons.filter(b => 'return' in b.dataset),
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('inventory art catalog and every supported item', () => {
  it('has the explicit 26 unique WebP assets and 19 supported item identities', () => {
    expect(ALL_ITEMS).toHaveLength(19);
    expect(INVENTORY_ART).toEqual(EXPECTED_ART);
    expect(new Set(INVENTORY_ART).size).toBe(26);
    for (const art of INVENTORY_ART) {
      const url = inventoryArtUrl(art);
      expect(url).toMatch(new RegExp(`/assets/inventory/${art}\\.webp$`));
      expect(url).not.toMatch(/undefined|\.svg|data:|javascript:/);
    }
  });

  it('ships exactly the 26 catalog WebP assets in the Vite asset graph', () => {
    const assets = import.meta.glob<string>('../src/assets/inventory/*.webp', { eager: true, query: '?url', import: 'default' });
    expect(Object.keys(assets).sort()).toEqual(EXPECTED_ART.map(name => `../src/assets/inventory/${name}.webp`).sort());
    for (const art of INVENTORY_ART) expect(assets[`../src/assets/inventory/${art}.webp`]).toMatch(new RegExp(`${art}\\.webp$`));
  });

  it.each(ALL_ITEMS)('%s has complete, category-appropriate art, appearance and knowledge label', id => {
    const w = makeWorld();
    w.player.known = [];
    const category = id.split(':')[0];
    expect(INVENTORY_ART).toContain(itemArt(w, id));
    if (category === 'weapon' || category === 'armor') {
      expect(itemArt(w, id)).toBe(id.replace(':', '-'));
      expect(itemAppearance(w, id)).toBe('');
      expect(itemCategoryLabel(w, id)).toBe(category === 'weapon' ? '近戰武器' : '護甲');
    } else if (category === 'food') {
      expect(itemArt(w, id)).toBe('ration');
      expect(itemAppearance(w, id)).toBe('');
      expect(itemCategoryLabel(w, id)).toBe('食物');
    } else if (id === 'scroll:upgrade') {
      expect(itemArt(w, id)).toBe(id.replace(':', '-'));
      expect(itemAppearance(w, id)).toBe('');
      expect(itemCategoryLabel(w, id)).toBe('卷軸 · 已辨識');
    } else {
      expect(itemCategoryLabel(w, id)).toBe(`${category === 'potion' ? '藥水' : '卷軸'} · 未辨識`);
      expect(itemAppearance(w, id)).toMatch(category === 'potion' ? /瓶身$/ : /符文$/);
      identify(w, id);
      expect(itemCategoryLabel(w, id)).toBe(`${category === 'potion' ? '藥水' : '卷軸'} · 已辨識`);
    }
  });

  it.each([1, 2] as const)('maps seed appearance version %i deterministically, without changing art on identification', version => {
    const seen = new Set<string>();
    for (let n = 0; n < 48; n++) {
      const w = makeWorld();
      w.level.seed = `INVENTORY-LOOKS-${n}`;
      w.level.potionLooksVersion = version;
      w.player.known = [];
      const looks = looksFor(w.level.seed, version);
      const potionArts = ALL_POTIONS.map(id => itemArt(w, `potion:${id}`));
      expect(new Set(potionArts).size).toBe(6);
      for (const id of ALL_POTIONS) {
        const fullId: ItemId = `potion:${id}`;
        expect(itemArt(w, fullId)).toBe(POTION_ART[looks.potion[id]]);
        expect(itemAppearance(w, fullId)).toBe(`${POTION_LOOKS[looks.potion[id]]!.name}瓶身`);
        expect(itemColor(w.level.seed, fullId, version)).toBe(POTION_LOOKS[looks.potion[id]]!.color);
      }
      for (const id of ALL_SCROLLS) {
        expect(itemArt(w, `scroll:${id}`)).toBe(SCROLL_ART[looks.scroll[id]]);
        expect(itemAppearance(w, `scroll:${id}`)).toBe(`${SCROLL_LOOKS[looks.scroll[id]]!}符文`);
      }
      for (const id of UNKNOWN_ITEMS) {
        const before = { art: itemArt(w, id), appearance: itemAppearance(w, id), color: itemColor(w.level.seed, id, version) };
        seen.add(before.art);
        identify(w, id);
        expect({ art: itemArt(w, id), appearance: itemAppearance(w, id), color: itemColor(w.level.seed, id, version) }).toEqual(before);
        const continuation = makeWorld();
        continuation.level.seed = w.level.seed;
        continuation.level.potionLooksVersion = version;
        expect(itemArt(continuation, id)).toBe(before.art);
      }
      if (version === 1) expect(itemArt(w, 'potion:healing')).toBe('potion-look-silver');
    }
    expect([...seen].sort()).toEqual([...POTION_ART, ...SCROLL_ART].sort());
  });
});

describe('unknown inventory markup preserves the identification boundary', () => {
  it.each([1, 2] as const)('keeps all text, filenames, alt/title/ARIA/data attributes effect-neutral in version %i', version => {
    const seeds = ['TEST', 'INVENTORY-PRIVATE', '<img src=x onerror="alert(1)">', ...Array.from({ length: 16 }, (_, n) => `UNKNOWN-${n}`)];
    for (const seed of seeds) {
      const w = makeWorld(OPEN_ROOM, [], 'huntress');
      w.level.seed = seed;
      w.level.potionLooksVersion = version;
      w.player.known = [];
      w.player.talents.push('apothecary');
      w.player.items = UNKNOWN_ITEMS.map(id => item(id, 2));
      const html = inventoryDom(w).list;
      // File-URL test roots may contain task names; only the asset path is player-facing.
      const publicMarkup = html.replace(/src="[^"]*\/assets\/inventory\//g, 'src="/assets/inventory/');
      for (const name of EFFECT_NAMES) expect(html).not.toContain(name);
      for (const key of EFFECT_KEYS) expect(publicMarkup).not.toMatch(new RegExp(`(?:[:/\\-]|["'])${key}(?:[.\\-"'<:]|$)`));
      expect(html).not.toMatch(/data-item|data-effect|potion:|scroll:|\btitle=|轉化|藥劑師|<script|onerror=|javascript:/);
      expect(matchCount(html, /class="inv-unknown"/g)).toBe(UNKNOWN_ITEMS.length);
      expect(matchCount(html, /data-m="throw"/g)).toBe(6);
      expect(matchCount(html, /data-m="use"/g)).toBe(UNKNOWN_ITEMS.length);
      for (const tag of html.matchAll(/<img\b[^>]*>/g)) {
        expect(tag[0]).toContain('alt=""');
        expect(tag[0]).toContain('draggable="false"');
        expect(tag[0]).toMatch(/src="[^"<>]+\/(?:potion|scroll)-look-[a-z]+\.webp"/);
      }
      expect(w.player.known).toEqual([]);
    }
  });

  it.each([1, 2] as const)('never reveals or disables an unknown Identify with no other unknown bag items (v%i)', version => {
    for (const cls of ['warrior', 'huntress'] as const) {
      const w = makeWorld(OPEN_ROOM, [], cls);
      w.level.potionLooksVersion = version;
      w.player.items = [item('scroll:identify', 2), item('food:ration')];
      expect(w.player.known).not.toContain('scroll:identify');
      const before = inventoryDom(w);
      const read = before.actions.find(a => a.dataset.k === '0' && a.dataset.m === 'use')!;
      expect(read.disabled).toBe(false);
      expect(before.actions.filter(a => a.dataset.k === '0').map(a => a.dataset.m)).toEqual(['use', 'drop', 'dropAll']);
      expect(before.list).not.toMatch(/鑑定卷軸|scroll.identify|背包沒有未知|卷軸已保留|取消鑑定|data-item|data-effect|\btitle=/);
      expect(before.list).toContain('卷軸 · 未辨識');
      expect(before.list).toContain(`${itemAppearance(w, 'scroll:identify')}卷軸`);
      expect(before.tiles[0]!.attrs['aria-label']).toBe(`查看${itemName(w, 'scroll:identify')}，數量 2`);
      expect(artSources(before.list).filter(src => src!.includes('/scroll-'))).toHaveLength(2);
      for (const src of artSources(before.list).filter(src => src!.includes('/scroll-'))) expect(src).toMatch(/\/scroll-look-[a-z]+\.webp$/);
      read.click(); read.click();
      expect(before.onAction).toHaveBeenCalledExactlyOnceWith(0, 'use');
      // Once knowledge is explicit, the same appearance may show the real action guard.
      identify(w, 'scroll:identify');
      const after = inventoryDom(w);
      expect(artSources(after.list)).toEqual(artSources(before.list));
      expect(after.actions.find(a => a.dataset.k === '0' && a.dataset.m === 'use')!.disabled).toBe(true);
      expect(after.list).toContain('背包沒有未知的藥水或卷軸可鑑定；鑑定卷軸已保留。');
      expect(after.tiles[0]!.attrs['aria-label']).toBe('查看鑑定卷軸，數量 2');
    }
  });

  it.each(UNKNOWN_ITEMS)('%s keeps identical tile and inspector image URLs after identification', id => {
    const w = makeWorld();
    w.player.known = [];
    w.player.items = [item(id, 2)];
    const before = inventoryDom(w).list;
    const appearance = itemAppearance(w, id);
    identify(w, id);
    const after = inventoryDom(w).list;
    expect(artSources(after)).toEqual(artSources(before));
    expect(before).toContain('未辨識');
    expect(after).toContain('已辨識');
    expect(before).toContain(appearance);
    expect(after).toContain(appearance);
    expect(after).toContain(itemName(w, id));
    expect(after).not.toContain('class="inv-unknown"');
  });
});

describe('grid, equipped stock, stack and action contracts', () => {
  it.each(['warrior', 'huntress'] as const)('renders current %s gear and separate stock with an empty ten-slot bag', cls => {
    const w = makeWorld(OPEN_ROOM, [], cls);
    w.player.items = [];
    const html = inventoryDom(w);
    expect(html.count).toBe('0 / 10 格');
    expect(html.tiles).toHaveLength(0);
    expect(html.actions).toHaveLength(0);
    expect(matchCount(html.list, /class="inv-tile inv-empty-slot"/g)).toBe(ITEM_FX.slots);
    expect(html.list).toContain('背包是空的');
    expect(html.gear).toContain(`weapon-${w.player.weapon.id}.webp`);
    expect(html.gear).toContain(`armor-${w.player.armor.id}.webp`);
    expect(html.gear).toContain('stock-smoke.webp');
    expect(html.gear).toContain('不占背包格');
    expect(html.status).toContain(`生命 <b>${w.player.hp} / ${w.player.maxHp}</b>`);
    expect(html.status).toContain('飢餓');
    if (cls === 'huntress') {
      for (const art of ['weapon-bow', 'stock-arrow', 'stock-arrow-chill', 'stock-arrow-paralysis']) expect(html.gear).toContain(`${art}.webp`);
    } else {
      expect(html.gear).not.toContain('weapon-bow.webp');
      expect(html.gear).toContain('stock-stone.webp');
    }
  });

  it.each([0, 1, 6, 10])('renders %i occupied entries plus only enough placeholders to reach ten', size => {
    const w = makeWorld();
    w.player.items = Array.from({ length: size }, (_, k) => item('weapon:axe', 1, k % 6));
    const html = inventoryDom(w);
    expect(html.tiles).toHaveLength(size);
    expect(html.articles).toHaveLength(size);
    expect(matchCount(html.list, /class="inv-tile inv-empty-slot"/g)).toBe(10 - size);
    expect(html.tiles.map(t => t.dataset.select)).toEqual(Array.from({ length: size }, (_, k) => String(k)));
    expect(html.count).toBe(`${size} / 10 格`);
    expect(html.list).not.toContain('class="inv-overflow"');
    expect(html.articles.filter(a => !a.hidden)).toHaveLength(size ? 1 : 0);
  });

  it('preserves an actual legacy-migrated eleventh stack and its action index', () => {
    const original = makeWorld(OPEN_ROOM, [], 'huntress');
    original.player.items = Array.from({ length: 10 }, (_, k) => item('weapon:spear', 1, k % 6));
    const saved = JSON.parse(serializeRun(nextFloor(newRun('INVENTORY-LEGACY', 'huntress'), original)));
    delete saved.inventoryVersion;
    delete saved.potionLooksVersion;
    saved.carry.potions = 3;
    const parsed = parseRun(JSON.stringify(saved));
    expect(parsed).not.toBeNull();
    const w = new World(testLevel(OPEN_ROOM), { cls: parsed!.cls, carry: parsed!.carry! });
    const before = JSON.stringify(w.player);
    const html = inventoryDom(w);
    expect(html.count).toBe('11 / 10 格');
    expect(html.tiles).toHaveLength(11);
    expect(html.list).not.toContain('inv-empty-slot');
    expect(html.list).toContain('舊存檔保留物品');
    html.tiles[10]!.click();
    expect(html.articles[10]!.hidden).toBe(false);
    html.actions.find(a => a.dataset.k === '10' && a.dataset.m === 'dropAll')!.click();
    expect(html.onAction).toHaveBeenCalledExactlyOnceWith(10, 'dropAll');
    expect(JSON.stringify(w.player)).toBe(before);
  });

  it('shows stack 99 and distinct same-kind upgrade levels without merging action targets', () => {
    const w = makeWorld();
    w.player.items = [item('potion:fire', 99), item('weapon:axe', 1, 1), item('weapon:axe', 1, 5), item('armor:mail', 1, 2)];
    const html = inventoryDom(w);
    expect(html.list).toContain('×99');
    expect(html.list).toContain('全部放下（99）');
    expect(html.list).toContain('重斧 +1');
    expect(html.list).toContain('重斧 +5');
    expect(html.list).toContain('鎖甲 +2');
    expect(html.list).toContain('查看重斧 +5，數量 1');
    expect(html.actions.filter(a => a.dataset.m === 'dropAll')).toHaveLength(1);
    expect(html.actions.filter(a => a.dataset.k === '0').map(a => a.dataset.m)).toEqual(['use', 'throw', 'drop', 'dropAll']);
    expect(html.actions.filter(a => a.dataset.k === '2').map(a => a.dataset.m)).toEqual(['use', 'drop']);
    html.tiles[2]!.click();
    html.actions.find(a => a.dataset.k === '2' && a.dataset.m === 'use')!.click();
    expect(html.onAction).toHaveBeenCalledExactlyOnceWith(2, 'use');
  });

  it('selection updates exactly one inspector and ARIA state, with no simulation change or dispatched action', () => {
    const w = makeWorld();
    w.player.items = [item('potion:fire', 2), item('armor:leather', 1, 2), item('scroll:mapping')];
    const snapshot = () => JSON.stringify({ player: w.player, time: w.time, realTime: w.realTime, stats: w.stats, pickups: w.pickups });
    const before = snapshot();
    const html = inventoryDom(w);
    const refs = [...w.player.items];
    for (const index of [2, 1, 1, 0, 2]) {
      html.tiles[index]!.click();
      expect(html.articles.map(a => a.hidden)).toEqual([0, 1, 2].map(k => k !== index));
      expect(html.tiles.map(t => t.attrs['aria-pressed'])).toEqual([0, 1, 2].map(k => String(k === index)));
      expect(html.tiles.map(t => t.classes.has('selected'))).toEqual([0, 1, 2].map(k => k === index));
      expect(html.tiles[index]!.attrs['aria-controls']).toBe(`inv-detail-${index}`);
      expect(snapshot()).toBe(before);
      expect(html.onAction).not.toHaveBeenCalled();
    }
    expect(w.player.items.every((entry, index) => entry === refs[index])).toBe(true);
    expect(inventoryDom(w).list).toBe(html.list); // Rerender is deterministic and ephemeral selection resets.
  });

  it('narrow selection focuses its inspector and the return control restores that slot without an action', () => {
    const w = makeWorld();
    w.player.items = [item('weapon:axe'), item('potion:fire', 2)];
    const before = JSON.stringify(w.player);
    const html = inventoryDom(w, vi.fn(), true);
    html.tiles[1]!.click();
    expect(html.articles[1]!.scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'start' });
    expect(html.articles[1]!.heading.setAttribute).toHaveBeenCalledExactlyOnceWith('tabindex', '-1');
    expect(html.articles[1]!.heading.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    html.returns[1]!.click();
    expect(html.tiles[1]!.focus).toHaveBeenCalledOnce();
    expect(html.tiles[0]!.focus).not.toHaveBeenCalled();
    expect(html.onAction).not.toHaveBeenCalled();
    expect(JSON.stringify(w.player)).toBe(before);
  });

  it('resolves action indices by stack identity and dispatches only once even after rapid repeated clicks', () => {
    const w = makeWorld();
    w.player.items = [item('weapon:axe', 1, 1), item('weapon:axe', 1, 5)];
    const html = inventoryDom(w);
    const oldSecond = html.actions.find(a => a.dataset.k === '1' && a.dataset.m === 'use')!;
    w.player.items.reverse();
    oldSecond.click(); oldSecond.click();
    html.actions.find(a => a.dataset.k === '0' && a.dataset.m === 'drop')!.click();
    expect(html.onAction).toHaveBeenCalledExactlyOnceWith(0, 'use');
  });

  it('ignores stale removed stacks and disabled controls without spending the one-action dispatch', () => {
    const w = makeWorld();
    w.player.known = ['potion:healing'];
    w.player.items = [item('potion:healing'), item('weapon:axe', 1, 3)];
    const html = inventoryDom(w);
    const healing = html.actions.find(a => a.dataset.k === '0' && a.dataset.m === 'use')!;
    expect(healing.disabled).toBe(true);
    healing.click();
    const staleDrop = html.actions.find(a => a.dataset.k === '0' && a.dataset.m === 'drop')!;
    w.player.items.shift();
    staleDrop.click();
    expect(html.onAction).not.toHaveBeenCalled();
    html.actions.find(a => a.dataset.k === '1' && a.dataset.m === 'use')!.click();
    expect(html.onAction).toHaveBeenCalledExactlyOnceWith(0, 'use');
  });
});


describe('inventory dialog focus boundaries', () => {
  it.each([false, true])('focuses the first slot or empty-bag close and wraps only at visible boundaries (empty=%s)', empty => {
    type Target = { closest: () => object | null; getClientRects: () => object[]; focus: () => void };
    let active: Target | null = null;
    const target = (hidden = false, rendered = true): Target => {
      const element: Target = {
        closest: () => hidden ? {} : null,
        getClientRects: () => rendered ? [{}] : [],
        focus: vi.fn(() => { active = element; }),
      };
      return element;
    };
    const first = target(), slot = target(), close = target(), hidden = target(true), cssHidden = target(false, false);
    const screen: {
      querySelector: () => Target | null;
      querySelectorAll: () => Target[];
      onkeydown: ((event: { code: string; shiftKey: boolean; preventDefault: () => void }) => void) | null;
    } = {
      querySelector: () => empty ? null : slot,
      querySelectorAll: () => [hidden, first, ...(empty ? [] : [slot]), close, cssHidden],
      onkeydown: null,
    };
    vi.stubGlobal('document', {
      getElementById: (id: string) => id === 'screen-inventory' ? screen : id === 'btn-inv-close' ? close : null,
      get activeElement() { return active; },
    });
    focusInventory();
    expect(active).toBe(empty ? close : slot);
    const key = (code: string, shiftKey = false) => {
      const event = { code, shiftKey, preventDefault: vi.fn() };
      screen.onkeydown!(event);
      return event;
    };
    close.focus();
    expect(key('Tab').preventDefault).toHaveBeenCalledOnce();
    expect(active).toBe(first);
    expect(key('Tab', true).preventDefault).toHaveBeenCalledOnce();
    expect(active).toBe(close);
    first.focus();
    expect(key('Tab').preventDefault).not.toHaveBeenCalled();
    expect(key('Space').preventDefault).not.toHaveBeenCalled();
    expect(key('Enter').preventDefault).not.toHaveBeenCalled();
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(cssHidden.focus).not.toHaveBeenCalled();
  });
});
