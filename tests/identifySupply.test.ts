import { describe, expect, it, vi } from 'vitest';
import { ALL_CLASSES, ALL_POTIONS, ALL_SCROLLS, ENEMIES, HUNGER, IDENTIFY, ITEM_FX, PLAYER, RUN, type ItemId } from '../src/config';
import { Rng } from '../src/core/rng';
import { levelSignature, type LevelData } from '../src/gen/generator';
import { rollConsumable, rollScroll } from '../src/gen/loot';
import { generateLevel, validateLevel } from '../src/gen/validate';
import { addItem, looksFor } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { updatePickups } from '../src/sim/propSys';
import { createFloorWorld, newRun } from '../src/sim/run';
import { World } from '../src/sim/world';

// Captured before Identify on b5685c81. Only ordinary scroll IDs are normalized:
// their four-entry pool intentionally changes the result of the same one draw.
// Every geometry cell, non-scroll item, pickup position, enemy and supply remains
// part of the hash. The appended, marked guarantee is removed before comparison.
const BEFORE = [
  ['FLOW1', 1, 123, '6cb437cedf1002ae582c3e4e0156ce5f49abd2b92f7197115b5e3a1ac2dbe991'],
  ['FLOW1', 2, 128, 'a2819a295b0e1fe5f4eb1297e9feb093ae533dc325843f6496109b37cc80e73a'],
  ['FLOW1', 3, 139, '15343dedd0512efc1b207c00dc0c580296dbe35ce5b9fdfe2087764e69bc8eca'],
  ['FLOW1', 4, 142, 'c5b3f6285a2ae3e20428db8bc692f9276e92459c40696183cb09e6fa203f213f'],
  ['FLOW1', 5, 29, '2b06438c85c8596b972df7af701b482b40c8812001374e6e29654b82f97c2656'],
  ['FLOW2', 1, 119, '4c5764ffe1fed5c81cb901e95ad568c535caa924a3e892bffbec580ceecadd72'],
  ['FLOW2', 2, 123, '707da38ddeb2d7d412467d140bbb7e7e2885e6b3bd4c9ba352c17a7bf2ca7a6e'],
  ['FLOW2', 3, 137, 'c8436516784f95701d443d65d0616bf0377daaef9c4a8f708a73bd8c09a20fc6'],
  ['FLOW2', 4, 143, '88ede1d3329c6d27e234bdcbe014192c892afb3502ab62124d54c5224d258861'],
  ['FLOW2', 5, 29, '2e54c5fa10a073213824dfab35ace4e2aacba5d0432dc3ad26dcaf2a1c09a6b3'],
  ['LIVING1', 1, 123, 'f5ad539dcd83fcaba05b3d6fe18b8a64c473025aa43dcc088b2aa2e4fd5eee38'],
  ['LIVING1', 2, 127, '14a92fe00121f0ea4e9fd2f4309c410b8233e42b504426c5cb7b3a9efa3f3763'],
  ['LIVING1', 3, 139, 'f6d39dba00e8e9e96744735268cec42eda5c7c99597127ef4bcc57910912f682'],
  ['LIVING1', 4, 142, 'db3a277bff099de6d6ace70a397ec0ecd445a929136ed25e3faba683705bcff4'],
  ['LIVING1', 5, 29, '359b4133118c4a010b5c243bb9e2408035a33f8aecf34cbe05f350e8400242f4'],
] as const;

async function nonScrollFingerprint(level: LevelData): Promise<string> {
  const before = { ...level, pickups: level.pickups.filter((p) => !p.guaranteedIdentify) };
  const json = JSON.stringify(before, (_, value) => value instanceof Map ? [...value.entries()] :
    typeof value === 'string' && /^scroll:(teleport|mapping|sleep|identify)$/.test(value) ? '<random-scroll>' : value);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

describe('Identify supply preserves existing generation', () => {
  it.each(BEFORE)('%s F%i preserves every non-scroll object and all %i RNG calls', async (seed, floor, calls, hash) => {
    const next = vi.spyOn(Rng.prototype, 'next');
    try {
      const level = generateLevel(seed, { floor });
      expect(next).toHaveBeenCalledTimes(calls);
      expect(level.pickups.filter((p) => p.guaranteedIdentify)).toHaveLength(IDENTIFY.guaranteedPerFloor[floor - 1]);
      expect(await nonScrollFingerprint(level)).toBe(hash);
    } finally {
      next.mockRestore();
    }
  });

  it('uses one draw for a separate four-entry scroll pool without adding Identify to appearance IDs', () => {
    expect(ALL_SCROLLS).toEqual(['teleport', 'mapping', 'sleep', 'identify']);
    const rng = new Rng('IDENTIFY-ROLL');
    const next = vi.spyOn(rng, 'next');
    try {
      for (const [draw, id] of [[0, 'teleport'], [.24999, 'teleport'], [.25, 'mapping'], [.5, 'sleep'], [.75, 'identify'], [.99999, 'identify']] as const) {
        next.mockReset().mockReturnValue(draw);
        expect(rollScroll(rng)).toEqual({ id: `scroll:${id}`, level: 0 });
        expect(next).toHaveBeenCalledTimes(1);
      }
      next.mockReset().mockReturnValueOnce(.8).mockReturnValueOnce(.9);
      expect(rollConsumable(rng, 'enemy')).toEqual({ id: 'scroll:identify', level: 0 });
      expect(next).toHaveBeenCalledTimes(2);
      next.mockReset().mockReturnValueOnce(.5).mockReturnValueOnce(.99999);
      expect(rollConsumable(rng, 'enemy').id).toBe('potion:haste');
      expect(next).toHaveBeenCalledTimes(2);
    } finally {
      next.mockRestore();
    }
  });

  it.each(['A', 'B'] as const)('%s: 40 seeds retain fixed healing, food and Upgrade budgets with a safe F1 guarantee', (template) => {
    const mirrors = new Set<boolean>();
    const randomScrolls = new Set<ItemId>();
    for (let k = 0; k < 40; k++) {
      let upgrades = 0, food = 0, fixedHealing = 0, identify = 0;
      for (let floor = 1; floor <= RUN.floors; floor++) {
        const level = generateLevel(`IDENTIFY-SUPPLY${k}`, { floor, template });
        expect(validateLevel(level), `${template} ${k} F${floor}`).toEqual({ ok: true, errors: [] });
        mirrors.add(level.mirrored);
        const fixed = level.pickups.filter((p) => p.guaranteedIdentify);
        expect(fixed).toHaveLength(IDENTIFY.guaranteedPerFloor[floor - 1]);
        identify += fixed.length;
        const rations = level.pickups.filter((p) => p.item === 'food:ration');
        expect(rations).toHaveLength(HUNGER.foodPerFloor[floor - 1]);
        food += rations.length;
        upgrades += level.pickups.filter((p) => p.item === 'scroll:upgrade').length;
        for (const p of level.pickups) if (p.item?.startsWith('scroll:') && !p.guaranteedIdentify && p.item !== 'scroll:upgrade') randomScrolls.add(p.item);
        for (const c of level.chests) for (const item of c.contents.items) if (item.id.startsWith('scroll:')) randomScrolls.add(item.id);
        if (floor === RUN.floors) {
          expect(level.pickups).toEqual([]);
          expect(level.chests).toEqual([]);
          continue;
        }
        expect(level.pickups[3]).toMatchObject({ item: 'potion:healing', amount: 1 });
        fixedHealing++;
        for (const [index, chest] of level.chests.entries()) {
          const healing = floor === 1 || index === 0;
          expect(chest.contents.items).toHaveLength(healing ? 2 : 1);
          if (healing) {
            expect(chest.contents.items[0]).toEqual({ id: 'potion:healing', level: 0 });
            fixedHealing++;
          }
        }
        for (const p of fixed) {
          expect(p).toMatchObject({ kind: 'item', item: 'scroll:identify', amount: 1, level: 0 });
          expect(level.pickups.at(-1)).toBe(p);
          expect(level.rooms.some((r) => !r.optional && r.role === 'combat' && p.x > r.x0 && p.x < r.x0 + r.w && p.z > r.z0 && p.z < r.z0 + r.h)).toBe(true);
          expect(Math.hypot(p.x - level.spawn.x, p.z - level.spawn.z)).toBeGreaterThan(PLAYER.pickupRadius);
          expect(level.pickups.every((other) => other === p || Math.hypot(other.x - p.x, other.z - p.z) >= 1)).toBe(true);
          expect(level.enemies.every((e) => Math.hypot(e.x - p.x, e.z - p.z) >= PLAYER.radius + ENEMIES[e.kind].radius)).toBe(true);
          const nav = new Nav(level.grid, PLAYER.radius);
          // Block every optional room entirely, preserving barred-door rules.
          for (let cell = 0; cell < nav.open.length; cell++) {
            const q = nav.center(cell);
            if (level.rooms.some((r) => r.optional && q.x >= r.x0 && q.x <= r.x0 + r.w && q.z >= r.z0 && q.z <= r.z0 + r.h)) nav.open[cell] = 0;
          }
          expect(nav.flood(level.spawn.x, level.spawn.z, false)[nav.nearestPassable(p.x, p.z)]).toBe(1);
        }
      }
      expect({ upgrades, food, fixedHealing, identify }).toEqual({ upgrades: 4, food: 6, fixedHealing: 9, identify: 1 });
    }
    expect(mirrors).toEqual(new Set([false, true]));
    expect(randomScrolls).toEqual(new Set(['scroll:teleport', 'scroll:mapping', 'scroll:sleep', 'scroll:identify']));
  }, 30000);

  it.each(ALL_CLASSES)('%s picks up Identify normally, never on spawn, and a full bag cannot lose it', (cls) => {
    const world = createFloorWorld(newRun('IDENTIFY-PICKUP', cls));
    expect(world.player.items.some((i) => i.id === 'scroll:identify')).toBe(false);
    updatePickups(world);
    expect(world.player.items.some((i) => i.id === 'scroll:identify')).toBe(false);
    const supply = world.level.pickups.find((p) => p.guaranteedIdentify)!;
    const pickup = world.pickups.find((p) => p.item === 'scroll:identify' && p.x === supply.x && p.z === supply.z)!;
    world.player.items = [];
    for (let k = 0; k < ITEM_FX.slots; k++) expect(addItem(world, 'weapon:axe')).toBe(true);
    world.player.x = supply.x; world.player.z = supply.z;
    updatePickups(world);
    expect(pickup.taken).toBe(false);
    world.player.items.pop();
    updatePickups(world);
    expect(pickup.taken).toBe(true);
    expect(world.player.items.find((i) => i.id === 'scroll:identify')).toEqual({ id: 'scroll:identify', count: 1, level: 0 });
    const practice = new World(generateLevel('IDENTIFY-PRACTICE', { practice: true }), { cls });
    expect(practice.pickups.some((p) => p.item === 'scroll:identify')).toBe(false);
    expect(practice.player.items.some((i) => i.id === 'scroll:identify')).toBe(false);
  });

  it('validates fixed count separately from random scrolls and rejects unsafe fixed placement', () => {
    const level = generateLevel('IDENTIFY-VALIDATE');
    const supply = level.pickups.find((p) => p.guaranteedIdentify)!;
    level.pickups = level.pickups.filter((p) => !p.guaranteedIdentify);
    level.pickups.push({ ...supply, guaranteedIdentify: undefined });
    expect(validateLevel(level).errors).toContain('鑑定卷軸保底數量錯誤');
    level.pickups[level.pickups.length - 1] = supply;
    const original = { ...supply };
    Object.assign(supply, level.spawn);
    expect(validateLevel(level).errors).toContain('鑑定卷軸保底位置不安全');
    Object.assign(supply, original);
    const optional = level.rooms.find((r) => r.optional)!;
    supply.x = optional.x0 + optional.w / 2; supply.z = optional.z0 + optional.h / 2;
    expect(validateLevel(level).errors).toContain('鑑定卷軸保底不在可達主線');
    Object.assign(supply, original);
    const other = level.pickups[0]!;
    supply.x = other.x; supply.z = other.z;
    expect(validateLevel(level).errors).toContain('鑑定卷軸保底位置不安全');
    Object.assign(supply, original);
    const enemy = level.enemies[0]!;
    enemy.x = supply.x; enemy.z = supply.z;
    expect(validateLevel(level).errors).toContain('鑑定卷軸保底位置不安全');
  });

  it.each([1, 2] as const)('appearance version %i: both classes receive identical seeded levels across all floors', (version) => {
    for (let k = 0; k < 8; k++) for (let floor = 1; floor <= RUN.floors; floor++) {
      const seed = `IDENTIFY-CLASS${k}`;
      const worlds = ALL_CLASSES.map((cls) => createFloorWorld({ ...newRun(seed, cls), floor, potionLooksVersion: version }));
      expect(levelSignature(worlds[0]!.level)).toBe(levelSignature(worlds[1]!.level));
      expect(worlds[0]!.level.potionLooksVersion).toBe(version);
      expect(worlds[1]!.level.potionLooksVersion).toBe(version);
    }
  }, 30000);
});

const LOOKS_BEFORE = [
  ['FLOW1', 1, [3, 0, 1, 2, 4, 5], [2, 1, 0]],
  ['FLOW1', 2, [4, 0, 1, 3, 2, 5], [2, 1, 0]],
  ['FLOW2', 1, [3, 1, 2, 0, 4, 5], [1, 3, 0]],
  ['FLOW2', 2, [0, 5, 4, 2, 3, 1], [1, 3, 0]],
  ['LIVING1', 1, [2, 1, 0, 4, 3, 5], [1, 3, 0]],
  ['LIVING1', 2, [5, 4, 1, 2, 0, 3], [1, 3, 0]],
] as const;

it.each(LOOKS_BEFORE)('%s appearance version %i retains every historical potion and glyph mapping', (seed, version, potions, scrolls) => {
  const looks = looksFor(seed, version);
  expect(ALL_POTIONS.map((id) => looks.potion[id])).toEqual(potions);
  expect(ALL_SCROLLS.slice(0, 3).map((id) => looks.scroll[id])).toEqual(scrolls);
  expect(Object.keys(looks.scroll)).toEqual(['teleport', 'mapping', 'sleep', 'identify']);
  expect(looks.scroll.identify).toBe([0, 1, 2, 3].find(slot => !(scrolls as readonly number[]).includes(slot)));
});
