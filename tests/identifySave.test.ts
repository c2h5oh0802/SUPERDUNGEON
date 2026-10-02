import { describe, expect, it } from 'vitest';
import { ALL_CLASSES, CLASS_KNOWLEDGE, ITEM_FX, RUN, type PlayerClass } from '../src/config';
import { addItem, isKnown, looksFor } from '../src/sim/items';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { makeWorld } from './helpers';

function checkpoint(cls: PlayerClass = 'warrior', potionLooksVersion: 1 | 2 = 2) {
  const world = makeWorld(undefined, [], cls);
  world.player.items = [
    { id: 'scroll:identify', count: 3, level: 0 },
    { id: 'potion:gas', count: 4, level: 0 },
    { id: 'scroll:sleep', count: 2, level: 0 },
    { id: 'scroll:upgrade', count: 1, level: 0 },
    { id: 'food:ration', count: 2, level: 0 },
  ];
  world.player.known = [...CLASS_KNOWLEDGE[cls], 'potion:frost', 'scroll:sleep'];
  return nextFloor({ ...newRun('IDENTIFY-SAVE', cls), potionLooksVersion }, world);
}

// A literal pre-food / pre-healing-item v2 checkpoint, not generated using the
// current serializer. Retired scroll aliases and numeric healing remain input.
function legacyCheckpoint() {
  return {
    v: 2, seed: 'IDENTIFY-LEGACY', cls: 'huntress', floor: 4,
    carry: {
      hp: 10, maxHp: 12, arrows: 5, stones: 0,
      tipped: { paralysis: 1, chill: 2 }, tipKind: 'chill', bottles: 1,
      weapon: { id: 'knife', level: 1 }, armor: { id: 'cloth', level: 0 },
      bowLevel: 1, shieldLevel: 0, potions: 2,
      items: [
        { id: 'scroll:timeStop', count: 1, level: 0 },
        { id: 'scroll:lure', count: 1, level: 0 },
        { id: 'potion:frost', count: 3, level: 0 },
      ],
      known: ['potion:frost', 'scroll:timeStop', 'scroll:lure'],
      xp: 0, level: 1, talents: [],
    },
    stats: { worldTime: 15, realTime: 20, kills: 2, itemsUsed: 1 },
  };
}

describe('Identify saves and floor carry', () => {
  it.each(ALL_CLASSES)('%s retains quantities and type knowledge through every floor in both appearance versions', (cls) => {
    for (const version of [1, 2] as const) {
      let current = checkpoint(cls, version);
      const items = structuredClone(current.carry!.items), known = [...current.carry!.known];
      const looks = structuredClone(looksFor(current.seed, version));
      while (true) {
        const encoded = serializeRun(current), raw = JSON.parse(encoded);
        expect(raw).toMatchObject({ v: 2, chapter: 2, inventoryVersion: 1, potionLooksVersion: version });
        expect(raw).toHaveProperty('identifyKnowledgeVersion', 1);
        const parsed = parseRun(encoded)!;
        expect(parsed).toEqual(current);
        const world = createFloorWorld(parsed);
        expect(world.player.items).toEqual(items);
        expect(world.player.known).toEqual(known);
        expect(isKnown(world, 'scroll:identify')).toBe(false);
        expect(looksFor(parsed.seed, world.level.potionLooksVersion)).toEqual(looks);
        expect(parsed.carry).not.toHaveProperty('guaranteedIdentify');
        expect(parsed.carry!.items.every((item) => !('guaranteedIdentify' in item))).toBe(true);
        if (parsed.floor === RUN.floors) break;
        current = nextFloor(parsed, world);
      }
    }
  });

  it('retains explicit Identify knowledge while current unlearned ownership stays unknown', () => {
    const save = checkpoint();
    save.carry!.known.push('scroll:identify');
    expect(parseRun(serializeRun(save))).toEqual(save);
    const withoutKnown = checkpoint();
    expect(withoutKnown.carry!.known).not.toContain('scroll:identify');
    expect(isKnown(createFloorWorld(parseRun(serializeRun(withoutKnown))!), 'scroll:identify')).toBe(false);
  });

  it('keeps all old migrations, version markers and cosmetics without synthesizing Identify', () => {
    const parsed = parseRun(JSON.stringify(legacyCheckpoint()))!;
    expect(parsed).not.toBeNull();
    expect(parsed).toMatchObject({ floor: 4, cls: 'huntress', potionLooksVersion: 1 });
    expect(parsed.carry!.items).toEqual([
      { id: 'scroll:sleep', count: 1, level: 0 },
      { id: 'potion:frost', count: 3, level: 0 },
      { id: 'potion:healing', count: 2, level: 0 },
    ]);
    expect(parsed.carry!.known).toEqual(['potion:frost', 'scroll:sleep', 'potion:healing']);
    expect(parsed.carry).toMatchObject({ hunger: 0, starvationT: 0 });
    expect(parsed.carry).not.toHaveProperty('potions');
    const resumed = createFloorWorld(parsed);
    expect(resumed.player.items).toEqual(parsed.carry!.items);
    expect(resumed.level.potionLooksVersion).toBe(1);
    expect(isKnown(resumed, 'scroll:identify')).toBe(false);
    const next = parseRun(serializeRun(nextFloor(parsed, resumed)))!;
    expect(next.floor).toBe(5);
    expect(next.carry!.items).toEqual(parsed.carry!.items);
    expect(next.potionLooksVersion).toBe(1);
    expect(JSON.parse(serializeRun(parsed))).toMatchObject({ v: 2, chapter: 2, inventoryVersion: 1, potionLooksVersion: 1 });
  });

  it('accepts Identify additively in legacy v2 input without triggering another migration', () => {
    const old = legacyCheckpoint();
    old.carry.items.push({ id: 'scroll:identify', count: 2, level: 0 });
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.carry!.items.filter((item) => item.id === 'scroll:identify')).toEqual([{ id: 'scroll:identify', count: 2, level: 0 }]);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
    expect(parseRun(serializeRun(parsed))!.carry!.items.filter((item) => item.id === 'potion:healing')).toEqual([{ id: 'potion:healing', count: 2, level: 0 }]);
  });

  it('preserves saturated Identify stacks without granting extra inventory capacity', () => {
    const saved = checkpoint();
    saved.carry!.items = Array.from({ length: ITEM_FX.slots }, () => ({ id: 'scroll:identify', count: 99, level: 0 }));
    expect(parseRun(serializeRun(saved))).toEqual(saved);
    const world = createFloorWorld(saved);
    expect(addItem(world, 'scroll:identify')).toBe(false);
    saved.carry!.items.push({ id: 'scroll:identify', count: 1, level: 0 });
    expect(parseRun(serializeRun(saved))).toBeNull();
  });

  it.each(['scroll:identification', 'scroll:Identify', 'scroll:identify:extra', 'scroll:madeUp', 'potion:identify', 'scroll:'])('still rejects invalid inventory and knowledge ID %s', (id) => {
    const itemSave = JSON.parse(serializeRun(checkpoint()));
    itemSave.carry.items[0].id = id;
    expect(parseRun(JSON.stringify(itemSave))).toBeNull();
    const knownSave = JSON.parse(serializeRun(checkpoint()));
    knownSave.carry.known.push(id);
    expect(parseRun(JSON.stringify(knownSave))).toBeNull();
  });

  it.each([{ count: 0 }, { count: -1 }, { count: 100 }, { count: .5 }, { count: '1' }, { level: -1 }, { level: 100 }, { level: .5 }])('rejects malformed Identify stack %j', (patch) => {
    const saved = JSON.parse(serializeRun(checkpoint()));
    Object.assign(saved.carry.items[0], patch);
    expect(parseRun(JSON.stringify(saved))).toBeNull();
  });
});
