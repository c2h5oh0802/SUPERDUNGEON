import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTIONS, ALL_POTIONS, ITEM_FX, PLAYER, TALENT_FX, type ItemId } from '../src/config';
import { addItem, conversionKind, conversionReason, isKnown, queueUse, stunPlayer, takeForAction } from '../src/sim/items';
import { maxTipped } from '../src/sim/progress';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { renderInventory } from '../src/ui/inventory';
import { finishAction, makeWorld, OPEN_ROOM, run } from './helpers';

const dt = 1 / 60;
const recipes = [
  ['potion:frost', 'chill', 'paralysis'],
  ['potion:gas', 'paralysis', 'chill'],
] as const;

function apothecary(): World {
  const w = makeWorld(OPEN_ROOM, [], 'huntress');
  w.player.talents.push('apothecary');
  w.player.known.push('potion:frost', 'potion:gas');
  w.player.tipped = { paralysis: 0, chill: 0 };
  return w;
}

function convert(w: World, id: ItemId, delta = dt): void {
  queueUse(w, w.player.items.findIndex((it) => it.id === id), 'convert');
  w.frame(delta, emptyInput());
  finishAction(w, delta);
}

function inventoryHtml(w: World): string {
  // Render the real UI without adding a browser/DOM dependency to pure tests.
  const nodes = {
    'inv-gear': { innerHTML: '' },
    'inv-count': { textContent: '' },
    'inv-list': { innerHTML: '', querySelectorAll: () => [] },
  };
  vi.stubGlobal('document', { getElementById: (id: keyof typeof nodes) => nodes[id] });
  renderInventory(w, vi.fn());
  return nodes['inv-list'].innerHTML;
}

afterEach(() => vi.unstubAllGlobals());

describe('Apothecary only converts known Frost/Gas for the Huntress', () => {
  it.each(recipes)('%s produces only %s', (id, kind, other) => {
    const w = apothecary();
    expect(maxTipped(w.player)).toBe(PLAYER.maxTipped + 1);
    expect(conversionKind(w, id)).toBe(kind);
    expect(conversionReason(w, id)).toBeNull();
    addItem(w, id); convert(w, id);
    expect(w.player.tipped[kind]).toBe(2);
    expect(w.player.tipped[other]).toBe(0);
    expect(w.areas).toHaveLength(0);
    expect(w.stats.itemsUsed).toBe(1);
    expect(w.stats.healingUsed).toBe(0);
    expect(w.events.some((e) => e.type === 'identify')).toBe(false);
  });

  it.each(['unknown', 'warrior', 'no-talent'] as const)('%s cannot reserve, consume or expose a conversion recipe', (restriction) => {
    const w = apothecary();
    if (restriction === 'unknown') w.player.known = [];
    if (restriction === 'warrior') w.player.cls = 'warrior';
    if (restriction === 'no-talent') w.player.talents = [];
    addItem(w, 'potion:frost');
    const before = [...w.player.known];
    expect(conversionKind(w, 'potion:frost')).toBeNull();
    queueUse(w, 0, 'convert');
    expect(w.player.pendingUse).toBeNull();
    expect(takeForAction(w, 0, 'convert')).toBeNull();
    w.frame(dt, emptyInput());
    expect(w.player.action).toBeNull();
    expect(w.player.items[0]?.count).toBe(1);
    expect(w.player.known).toEqual(before);
    expect(w.player.tipped).toEqual({ chill: 0, paralysis: 0 });
    expect(w.time).toBeCloseTo(dt * .1);
    expect(inventoryHtml(w)).not.toContain('data-m="convert"');
  });

  it('all unknown potion identities have identical generic refusal and unchanged ordinary inventory UI', () => {
    const reasons = new Set<string | null>();
    for (const potion of ALL_POTIONS) {
      const w = apothecary(), id: ItemId = `potion:${potion}`;
      w.player.known = []; addItem(w, id);
      reasons.add(conversionReason(w, id));
      const withTalent = inventoryHtml(w);
      w.player.talents = [];
      expect(inventoryHtml(w)).toBe(withTalent);
      expect(withTalent).not.toContain('轉化');
      expect(withTalent).not.toContain('藥劑師');
      expect(isKnown(w, id)).toBe(false);
    }
    expect(reasons.size).toBe(1);
  });

  it.each(['potion:fire', 'potion:healing', 'potion:invisibility', 'potion:haste', 'scroll:upgrade', 'food:ration', 'weapon:knife'] as const)('known wrong ingredient %s is retained', (id) => {
    const w = apothecary(); w.player.known.push(id); addItem(w, id);
    queueUse(w, 0, 'convert');
    expect(w.player.pendingUse).toBeNull();
    expect(takeForAction(w, 0, 'convert')).toBeNull();
    expect(w.player.items[0]?.id).toBe(id);
    expect(w.player.items[0]?.count).toBe(1);
    expect(inventoryHtml(w)).not.toContain('data-m="convert"');
  });
});

describe('Apothecary capacity is validated before taking a whole bottle', () => {
  it.each(recipes)('%s refuses at one free slot or full, admits exactly two free slots', (id, kind) => {
    for (const stock of [maxTipped(apothecary().player) - 1, maxTipped(apothecary().player)]) {
      const w = apothecary(); w.player.tipped[kind] = stock; addItem(w, id);
      const before = { ...w.player.tipped };
      expect(conversionKind(w, id)).toBe(kind);
      expect(conversionReason(w, id)).toContain('空間不足');
      queueUse(w, 0, 'convert');
      expect(w.player.pendingUse).toBeNull();
      expect(takeForAction(w, 0, 'convert')).toBeNull();
      expect(w.player.items[0]?.count).toBe(1);
      expect(w.player.tipped).toEqual(before);
      expect(w.stats.itemsUsed).toBe(0);
      expect(w.events.some((e) => e.text?.includes('空間不足'))).toBe(true);
      const html = inventoryHtml(w);
      expect(html).toContain('data-m="convert" disabled');
      expect(html).toContain('空間不足');
      expect(html).toContain(`目前 ${stock} / ${maxTipped(w.player)}`);
    }
    const w = apothecary(); w.player.tipped[kind] = 1; addItem(w, id); convert(w, id);
    expect(w.player.tipped[kind]).toBe(maxTipped(w.player));
    expect(w.player.items).toEqual([]);
  });

  it('revalidates capacity, class, knowledge and talent if state changes after queuing', () => {
    for (const change of ['capacity', 'class', 'knowledge', 'talent', 'removed'] as const) {
      const w = apothecary(); addItem(w, 'potion:frost'); queueUse(w, 0, 'convert');
      if (change === 'capacity') w.player.tipped.chill = 2;
      if (change === 'class') w.player.cls = 'warrior';
      if (change === 'knowledge') w.player.known = [];
      if (change === 'talent') w.player.talents = [];
      if (change === 'removed') w.player.items = [];
      w.frame(dt, emptyInput());
      expect(w.player.action).toBeNull();
      expect(w.player.pendingUse).toBeNull();
      expect(w.player.items[0]?.count).toBe(change === 'removed' ? undefined : 1);
      expect(w.stats.itemsUsed).toBe(0);
    }
  });
});

describe('Conversion is a paid, committed normal action', () => {
  it('reserves once at start, yields only after the full 0.6 world seconds and advances Hunger', () => {
    const w = apothecary(); addItem(w, 'potion:frost'); addItem(w, 'potion:frost');
    queueUse(w, 0, 'convert'); queueUse(w, 0, 'convert');
    expect(w.time).toBe(0); expect(w.player.items[0]?.count).toBe(2);
    w.frame(dt, emptyInput());
    expect(w.player.action?.kind).toBe('convert');
    expect(w.player.action?.item).toBe('potion:frost');
    expect(w.player.items[0]?.count).toBe(1);
    expect(w.player.tipped.chill).toBe(0);
    expect(w.stats.itemsUsed).toBe(0);
    run(w, 34);
    expect(w.time).toBeCloseTo(35 / 60);
    expect(w.player.tipped.chill).toBe(0);
    expect(w.player.action?.kind).toBe('convert');
    w.frame(dt, emptyInput());
    expect(w.player.action).toBeNull();
    expect(w.player.tipped.chill).toBe(2);
    expect(w.lastAction?.spent).toBeCloseTo(.6, 9);
    expect(w.player.hunger).toBeCloseTo(.6, 9);
    run(w, 60);
    expect(w.player.items[0]?.count).toBe(1);
    expect(w.player.tipped.chill).toBe(2);
    expect(w.stats.itemsUsed).toBe(1);
  });

  it.each([1 / 30, 1 / 60, 1 / 120])('uses the same action/Hunger clock at frame delta %f', (delta) => {
    const w = apothecary(); addItem(w, 'potion:gas'); convert(w, 'potion:gas', delta);
    expect(w.time).toBeCloseTo(ACTIONS.convert.windup, 8);
    expect(w.player.hunger).toBeCloseTo(w.time, 8);
    expect(w.player.tipped.paralysis).toBe(TALENT_FX.apothecaryYield);
  });

  it('retains the normal Haste modifier rather than adding another clock', () => {
    const w = apothecary(); w.player.hasteT = 5; addItem(w, 'potion:gas');
    expect(inventoryHtml(w)).toContain('0.3 世界秒');
    convert(w, 'potion:gas');
    expect(w.lastAction?.spent).toBeCloseTo(.6 * ITEM_FX.haste.timeMul, 8);
    expect(w.player.hunger).toBeCloseTo(w.time, 8);
  });

  it('does not overlap fire/interaction or cancel when switching equipment, and allows movement', () => {
    const w = apothecary(); addItem(w, 'potion:frost'); queueUse(w, 0, 'convert');
    w.frame(dt, emptyInput()); const z = w.player.z;
    w.frame(dt, { ...emptyInput(), fire: true, interact: true, bottle: true, selectSlot: 2, moveZ: 1 });
    expect(w.player.action?.kind).toBe('convert');
    expect(w.player.z).toBeLessThan(z);
    expect(w.projectiles).toHaveLength(0);
    expect(w.player.tipped.chill).toBe(0);
    finishAction(w);
    expect(w.player.tipped.chill).toBe(2);
    expect(w.player.tool).toBe('bow');
  });

  it.each(['stun', 'death'] as const)('%s interruption keeps the normal consumed-item/no-completion semantics', (interrupt) => {
    const w = apothecary(); addItem(w, 'potion:gas'); addItem(w, 'potion:gas');
    queueUse(w, 0, 'convert'); w.frame(dt, emptyInput());
    if (interrupt === 'stun') { stunPlayer(w, .1); finishAction(w); }
    else w.damagePlayer(100, '測試', w.player.x, w.player.z);
    run(w, 120);
    expect(w.player.items[0]?.count).toBe(1);
    expect(w.player.tipped.paralysis).toBe(0);
    expect(w.stats.itemsUsed).toBe(0);
    expect(w.events.some((e) => e.text?.includes('轉化完成'))).toBe(false);
  });

  it('a paused talent choice freezes the in-progress conversion and Hunger', () => {
    const w = apothecary(); addItem(w, 'potion:frost'); queueUse(w, 0, 'convert'); w.frame(dt, emptyInput());
    const before = [w.time, w.player.hunger, w.player.action!.t];
    w.pendingChoice = { kind: 'talent', options: ['toughness'] }; run(w, 60);
    expect([w.time, w.player.hunger, w.player.action!.t]).toEqual(before);
    expect(w.player.tipped.chill).toBe(0);
    w.resolveChoice(0); finishAction(w);
    expect(w.player.tipped.chill).toBe(2);
  });

  it('explains consumption, completion, time and current capacity on eligible inventory rows', () => {
    const w = apothecary(); addItem(w, 'potion:frost');
    const html = inventoryHtml(w);
    expect(html).toContain('data-m="convert"');
    expect(html).not.toContain('data-m="convert" disabled');
    expect(html).toContain('開始時消耗 1 瓶');
    expect(html).toContain('0.6 世界秒');
    expect(html).toContain('完成後獲得 2 支冰寒箭');
    expect(html).toContain('目前 0 / 3');
  });
});

describe('Conversion supply survives floors and saves without passive refill', () => {
  it('preserves both arrow amounts and remaining bottles through all four boundaries and reloads', () => {
    let state = newRun('APOTHECARY-CARRY', 'huntress'), w = createFloorWorld(state);
    w.player.talents.push('apothecary'); w.player.known.push('potion:frost', 'potion:gas');
    w.player.tipped = { paralysis: 0, chill: 1 };
    addItem(w, 'potion:frost'); addItem(w, 'potion:gas'); addItem(w, 'potion:gas');
    convert(w, 'potion:frost'); convert(w, 'potion:gas');
    expect(w.player.tipped).toEqual({ paralysis: 2, chill: 3 });
    const items = structuredClone(w.player.items), hunger = w.player.hunger;
    for (let floor = 2; floor <= 5; floor++) {
      state = nextFloor(state, w);
      const saved = parseRun(serializeRun(state));
      expect(saved).not.toBeNull();
      w = createFloorWorld(saved!);
      expect(w.level.floor).toBe(floor);
      expect(w.player.tipped).toEqual({ paralysis: 2, chill: 3 });
      expect(w.player.items).toEqual(items);
      expect(w.player.hunger).toBe(hunger);
      expect(w.stats.itemsUsed).toBe(2);
      expect(w.player.known).toContain('potion:gas');
      expect(w.player.talents).toContain('apothecary');
    }
  });
});
