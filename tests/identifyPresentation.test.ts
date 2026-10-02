import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALL_POTIONS, ALL_SCROLLS, POTIONS, SCROLLS, type ItemId } from '../src/config';
import { identify, identifyTargets, isKnown, itemColor, itemName, looksFor, readScroll } from '../src/sim/items';
import { queueChoice } from '../src/sim/progress';
import type { InvItem } from '../src/sim/types';
import { focusChoice, renderIdentifyChoice, renderInventory } from '../src/ui/inventory';
import { canPresentChoice, identifyChoiceDescription, identifyChoiceMarkup, inventoryArtUrl, itemAppearance, itemArt, itemCategoryLabel } from '../src/ui/inventoryPresentation';
import { makeWorld } from './helpers';

const item = (id: ItemId, count = 1): InvItem => ({ id, count, level: 0 });
const unknowns: ItemId[] = [...ALL_POTIONS.map((id): ItemId => `potion:${id}`), ...ALL_SCROLLS.map((id): ItemId => `scroll:${id}`)];
const effects = [...ALL_POTIONS.map(id => POTIONS[id].name), ...ALL_SCROLLS.map(id => SCROLLS[id].name)];
afterEach(() => vi.unstubAllGlobals());

describe('Identify choice presentation privacy', () => {
  it.each([1, 2] as const)('keeps text, thumbnails, alt, ARIA and DOM data appearance-only (v%i)', version => {
    for (const seed of ['TEST', 'IDENTIFY-UI', '<img src=x onerror="alert(1)">', ...Array.from({ length: 20 }, (_, k) => `PRIVATE-${k}`)]) {
      const w = makeWorld();
      w.level.seed = seed; w.level.potionLooksVersion = version;
      w.player.known = []; w.player.items = unknowns.map(id => item(id, 3));
      const options = identifyTargets(w);
      const html = identifyChoiceMarkup(w, options);
      for (const name of effects) expect(html).not.toContain(name);
      for (const id of unknowns) expect(html).not.toContain(id);
      for (const key of [...ALL_POTIONS, ...ALL_SCROLLS.filter(id => id !== 'identify')]) expect(html).not.toMatch(new RegExp(`(?:[:/\\-]|["'])${key}(?:[.\\-"'<:]|$)`));
      expect(html).not.toMatch(/data-item|data-effect|\btitle=|onerror=|javascript:/);
      expect([...html.matchAll(/data-idx="(\d+)"/g)].map(m => Number(m[1]))).toEqual(options.map((_, k) => k));
      for (const img of html.matchAll(/<img\b[^>]*>/g)) {
        expect(img[0]).toContain('alt=""');
        expect(img[0]).toMatch(/src="[^"<>]+\/(?:potion|scroll)-look-[a-z]+\.webp"/);
      }
      for (const it of options) expect(html).toContain(itemAppearance(w, it.id));
      expect(options.every(it => it.id !== 'scroll:identify')).toBe(true);
      expect(html).toContain('這一疊 ×3 · 物品完整保留');
      expect(html).toContain('取消鑑定，保留卷軸');
      expect(w.player.known).toEqual([]);
    }
  });

  it('does not leak an effect even if a displayed choice becomes stale/known', () => {
    const w = makeWorld(); w.player.known = [];
    const options = unknowns.map(id => item(id));
    const before = identifyChoiceMarkup(w, options);
    for (const option of options) identify(w, option.id);
    expect(identifyChoiceMarkup(w, options)).toBe(before);
  });

  it('uses a normal unknown seeded rune, with no identity-specific color or art before or after learning', () => {
    const seen = new Set<string>();
    for (const version of [1, 2] as const) for (let n = 0; n < 48; n++) {
      const w = makeWorld(); w.player.known = []; w.level.seed = `IDENTIFY-LOOK-${n}`; w.level.potionLooksVersion = version;
      const before = { art: itemArt(w, 'scroll:identify'), appearance: itemAppearance(w, 'scroll:identify'), color: itemColor(w.level.seed, 'scroll:identify', version) };
      expect(isKnown(w, 'scroll:identify')).toBe(false);
      expect(looksFor(w.level.seed, version).scroll.identify).toBeGreaterThanOrEqual(0);
      expect(itemCategoryLabel(w, 'scroll:identify')).toBe('卷軸 · 未辨識');
      expect(itemName(w, 'scroll:identify')).toBe(`${before.appearance}卷軸`);
      expect(before.color).toBe(itemColor(w.level.seed, 'scroll:sleep', version));
      expect(inventoryArtUrl(before.art)).toMatch(/\/scroll-look-[a-z]+\.webp$/);
      seen.add(before.art);
      identify(w, 'scroll:identify');
      expect(isKnown(w, 'scroll:identify')).toBe(true);
      expect(itemCategoryLabel(w, 'scroll:identify')).toBe('卷軸 · 已辨識');
      expect(itemName(w, 'scroll:identify')).toBe('鑑定卷軸');
      expect({ art: itemArt(w, 'scroll:identify'), appearance: itemAppearance(w, 'scroll:identify'), color: itemColor(w.level.seed, 'scroll:identify', version) }).toEqual(before);
      expect(itemArt(w, 'scroll:upgrade')).toBe('scroll-upgrade');
    }
    expect([...seen].sort()).toEqual(['scroll-look-ash', 'scroll-look-star', 'scroll-look-thorn', 'scroll-look-tide']);
  });

  it.each([false, true])('explains whether cancellation can return the scroll after a read (learned=%s)', learned => {
    const w = makeWorld();
    const markup = identifyChoiceMarkup(w, [item('potion:fire')], learned);
    const empty = identifyChoiceMarkup(w, [], learned);
    const description = identifyChoiceDescription(learned);
    for (const copy of [markup, empty, description]) {
      if (learned) {
        expect(copy).toContain('已使用');
        expect(copy).not.toContain('保留卷軸');
        expect(copy).not.toContain('保留鑑定卷軸');
      } else expect(copy).toContain('保留');
    }
    expect(description).toContain('同種類一起變已知');
    expect(description).toContain('其他種類不受影響');
    expect(empty).toContain('role="status"');
    expect(empty).not.toContain('data-idx');
    if (learned) expect(description).toContain('不退還卷軸');
  });

  it('renders a recoverable empty choice and an informative disabled inventory read when none qualify', () => {
    const w = makeWorld(); w.player.known = [...unknowns];
    w.player.items = [item('scroll:identify', 2), item('food:ration'), item('potion:fire'), item('scroll:upgrade')];
    const empty = identifyChoiceMarkup(w, identifyTargets(w));
    expect(empty).toContain('role="status"'); expect(empty).not.toContain('data-idx');
    expect(empty).toContain('btn-identify-cancel');
    const nodes: Record<string, { innerHTML: string; textContent: string; querySelectorAll: () => never[] }> = {};
    for (const id of ['inv-gear', 'inv-status', 'inv-count', 'inv-list']) nodes[id] = { innerHTML: '', textContent: '', querySelectorAll: () => [] };
    vi.stubGlobal('document', { getElementById: (id: string) => nodes[id] ?? null });
    renderInventory(w, vi.fn());
    expect(nodes['inv-list']!.innerHTML).toMatch(/data-k="0" data-m="use" disabled title="背包沒有未知的藥水或卷軸可鑑定；鑑定卷軸已保留。"/);
    expect(nodes['inv-list']!.innerHTML).not.toContain('scroll-identify.webp');
    expect(nodes['inv-list']!.innerHTML).toContain('scroll-look-');
    w.player.known = unknowns.filter(id => id !== 'scroll:identify');
    renderInventory(w, vi.fn());
    expect(nodes['inv-list']!.innerHTML).toContain('data-k="0" data-m="use">讀</button>');
    expect(nodes['inv-list']!.innerHTML).not.toContain('背包沒有未知的藥水或卷軸可鑑定');
  });
});

describe('Identify choice buttons and native keyboard access', () => {
  it('rejects a stale old choice after selection advances to a queued talent', () => {
    const w = makeWorld(); w.player.items = [item('potion:fire')];
    readScroll(w, 'identify');
    const old = w.pendingChoice;
    queueChoice(w, { kind: 'talent', options: ['toughness'], level: 2 });
    expect(canPresentChoice(w, old)).toBe(true);
    w.resolveChoice(0);
    expect(w.pendingChoice?.kind).toBe('talent');
    expect(canPresentChoice(w, old)).toBe(false);
    expect(canPresentChoice(w)).toBe(true);
    expect(w.player.talents).toEqual([]);
  });

  it.each(['dead', 'win', 'descend'] as const)('never presents a choice over terminal %s results, including stale callbacks', outcome => {
    const w = makeWorld(); w.player.items = [item('potion:fire')];
    readScroll(w, 'identify');
    const old = w.pendingChoice;
    w.outcome = outcome;
    expect(canPresentChoice(w)).toBe(false); expect(canPresentChoice(w, old)).toBe(false);
    w.outcome = 'none'; w.player.dead = true;
    expect(canPresentChoice(w)).toBe(false);
  });

  it.each([['choose', false], ['cancel', false], ['choose', true], ['cancel', true]] as const)('dispatches exactly once after %s, including stale repeated button callbacks (learned=%s)', (action, learned) => {
    type Button = { dataset: { idx: string }; addEventListener: (event: string, callback: () => void) => void; click: () => void };
    const button = (idx: number): Button => {
      let fn = () => {};
      return { dataset: { idx: String(idx) }, addEventListener: (_, callback) => { fn = callback; }, click: () => fn() };
    };
    const cards = [button(0), button(1)], cancel = button(-1), box = { innerHTML: '', querySelectorAll: () => cards };
    vi.stubGlobal('document', { getElementById: (id: string) => id === 'choice-cards' ? box : id === 'btn-identify-cancel' ? cancel : null });
    const choose = vi.fn(), onCancel = vi.fn();
    renderIdentifyChoice(makeWorld(), [item('potion:fire'), item('scroll:sleep')], choose, onCancel, learned);
    expect(box.innerHTML).toContain(learned ? '卷軸已使用' : '保留卷軸');
    if (action === 'choose') cards[1]!.click(); else cancel.click();
    cancel.click(); cards[0]!.click(); cards[1]!.click();
    expect(choose).toHaveBeenCalledTimes(action === 'choose' ? 1 : 0);
    if (action === 'choose') expect(choose).toHaveBeenCalledWith(1);
    expect(onCancel).toHaveBeenCalledTimes(action === 'cancel' ? 1 : 0);
  });

  function choiceDom(empty = false) {
    type Target = { focus: () => void; getClientRects: () => object[] };
    let active: Target | null = null;
    const target = (): Target => {
      const t: Target = { focus: () => { active = t; }, getClientRects: () => [{}] }; return t;
    };
    const first = target(), cancel = target();
    const attrs: Record<string, string> = {};
    const screen = { setAttribute: (k: string, v: string) => { attrs[k] = v; }, querySelector: () => empty ? null : first,
      querySelectorAll: () => empty ? [cancel] : [first, cancel],
      onkeydown: null as ((e: KeyboardEvent) => void) | null, onkeyup: null as ((e: KeyboardEvent) => void) | null };
    vi.stubGlobal('document', { getElementById: (id: string) => id === 'screen-choice' ? screen : id === 'btn-identify-cancel' ? cancel : null, get activeElement() { return active; } });
    const key = (code: string, repeat = false, shiftKey = false) => {
      const e = { code, repeat, shiftKey, preventDefault: vi.fn(), stopPropagation: vi.fn() };
      screen.onkeydown!(e as unknown as KeyboardEvent); return e;
    };
    return { first, cancel, attrs, screen, key, active: () => active };
  }

  it('supports every numeric slot, ignores repeats/out-of-range, and only cancels when explicitly enabled', () => {
    const d = choiceDom(), choose = vi.fn(), cancel = vi.fn();
    focusChoice(10, choose, cancel);
    expect(d.active()).toBe(d.first);
    expect(d.attrs).toMatchObject({ role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'choice-title', 'aria-describedby': 'choice-sub' });
    for (let k = 1; k <= 10; k++) d.key(`Digit${k % 10}`);
    expect(choose.mock.calls.map(args => args[0])).toEqual(Array.from({ length: 10 }, (_, k) => k));
    d.key('Digit1', true); expect(choose).toHaveBeenCalledTimes(10);
    d.key('Numpad4'); expect(choose).toHaveBeenLastCalledWith(3);
    d.key('Escape', true); expect(cancel).not.toHaveBeenCalled();
    d.key('Escape'); expect(cancel).toHaveBeenCalledOnce();
    choose.mockClear(); cancel.mockClear();
    focusChoice(3, choose);
    d.key('Digit4'); d.key('Digit0'); d.key('Escape');
    expect(choose).not.toHaveBeenCalled(); expect(cancel).not.toHaveBeenCalled();
  });

  it('preserves Enter/Space and Tab navigation while containing keyboard events in the paused dialog', () => {
    const d = choiceDom(), choose = vi.fn();
    focusChoice(2, choose);
    for (const code of ['Space', 'Enter', 'KeyW', 'KeyQ', 'KeyI']) {
      const e = d.key(code); expect(e.stopPropagation).toHaveBeenCalledOnce(); expect(e.preventDefault).not.toHaveBeenCalled();
    }
    // A newly focused button in a queued choice must not activate from the old held key.
    for (const code of ['Space', 'Enter']) expect(d.key(code, true).preventDefault).toHaveBeenCalledOnce();
    expect(choose).not.toHaveBeenCalled();
    d.cancel.focus(); expect(d.key('Tab').preventDefault).toHaveBeenCalledOnce(); expect(d.active()).toBe(d.first);
    expect(d.key('Tab', false, true).preventDefault).toHaveBeenCalledOnce(); expect(d.active()).toBe(d.cancel);
    const e = { stopPropagation: vi.fn() }; d.screen.onkeyup!(e as unknown as KeyboardEvent); expect(e.stopPropagation).toHaveBeenCalledOnce();
  });

  it('focuses cancellation when a defensive empty target list is displayed', () => {
    const d = choiceDom(true); focusChoice(0, vi.fn(), vi.fn()); expect(d.active()).toBe(d.cancel);
  });
});
