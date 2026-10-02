import { describe, expect, it, vi } from 'vitest';
import { HEALING_POTION, PLAYER, WORLD } from '../src/config';
import { Rng } from '../src/core/rng';
import type { LevelData } from '../src/gen/generator';
import { generateLevel } from '../src/gen/validate';
import { addItem } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { createFloorWorld, newRun } from '../src/sim/run';

// Full generated-level SHA-256 and RNG-next counts captured before this change,
// from source matching 02e79d487731647a0370ab2b6aea7c15f46053b2. Both templates,
// mirrored/unmirrored floors, and a random Healing roll in the reduced chest
// are covered. Restore exactly the removed fixed bottle to compare to history.
const BEFORE = [
  ['FLOW1', 1, 123, 'a57e009b86a9a2fa834d21715979f30e6331d5864226cf6526f4fabe7f44f6ba'],
  ['FLOW1', 2, 128, '5d1a447fd765429305d0e49a4b7891ce4de617edc0287089d0d8b6002524dbed'],
  ['FLOW1', 3, 139, '98180247d7a944b69359ae95c8749c517bb3111fa2fc6c5b146ff47cb5ecfd3a'],
  ['FLOW1', 4, 142, '0afc183ed2f5431dc36aebbd5074625033dbd9d2f6793b9c2db164c8e32d54b1'],
  ['FLOW2', 1, 119, '21d547bfafb9d771b77e984deb1b73c352e216d14c36dbf59d19b81d0797b902'],
  ['FLOW2', 2, 123, '792e1c6f095c3ea8077bf95f450278af78fc6ef1d433df60e9a232f36edb2fd2'],
  ['FLOW2', 3, 137, '87c1e0e87ccc35e64d76d49a25604ebe5ff7f90d5e9333d6b85569e5757f6296'],
  ['FLOW2', 4, 143, '0412fd528f428a3a8bcc3ece53b6d73789a04cdd1ff7e20a0a84ae390a798c0b'],
  ['LIVING1', 1, 123, 'fb6b3f9be52f6f175db58929c4678803de270b89d9e639135b18045d8a107ffc'],
  ['LIVING1', 2, 127, 'aff35bed5c13634d591e5394a60b3afe6850f3d8bd68a40363c3650daf1b50bc'],
  ['LIVING1', 3, 139, '2af0a3afc579827f6302f1e29fa7c9be77d0f87b367ba21e50ec0ccedf06a347'],
  ['LIVING1', 4, 142, '485a0667c57ad3dd6c46b5ec83982b81df4f337b24ce58dba2b0cf38790c3456'],
  ['HEAL-BUDGET4', 2, 128, 'c1ffbd5bf77ea60f0d696f7e8a62bdefc7ab1e98687ff7891c12e1de7e140114'],
] as const;

async function fingerprint(level: LevelData): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(level, (_, value) =>
    value instanceof Map ? [...value.entries()] : value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function totalHealing(level: LevelData): number {
  return level.pickups.filter((p) => p.item === 'potion:healing').reduce((n, p) => n + p.amount, 0) +
    level.chests.reduce((n, c) => n + c.contents.items.filter((item) => item.id === 'potion:healing').length, 0);
}

// Historical fingerprints predate Identify. Replay only its expanded loot pool
// with the same single RNG draw; current-pool behavior is covered separately in
// identifySupply.test.ts, including full non-scroll hashes and exact draw counts.
function replayLegacyScrollPool() {
  const pick = Rng.prototype.pick;
  return vi.spyOn(Rng.prototype, 'pick').mockImplementation(function <T>(this: Rng, pool: readonly T[]): T {
    const legacy = pool.length === 4 && pool.join(',') === 'teleport,mapping,sleep,identify' ? pool.slice(0, 3) : pool;
    return pick.call(this, legacy) as T;
  });
}

describe('provisional chapter healing supply v2', () => {
  it.each(BEFORE)('%s F%i changes only the intended fixed bottle; RNG calls stay %i', async (seed, floor, calls, hash) => {
    const next = vi.spyOn(Rng.prototype, 'next');
    const scrolls = replayLegacyScrollPool();
    try {
      const level = generateLevel(seed, { floor });
      // Ignore only the separately tested, appended fixed Identify opportunity.
      level.pickups = level.pickups.filter((p) => !p.guaranteedIdentify);
      expect(next).toHaveBeenCalledTimes(calls);
      if (floor >= 2 && floor <= 4) {
        expect(level.chests[1]!.contents.items).toHaveLength(1);
        level.chests[1]!.contents.items.unshift({ id: 'potion:healing', level: 0 });
      }
      // These historical hashes predate ground-mobile sanctum archers. Undo only
      // their tested one-metre landing delta, keeping the original resource proof.
      const sanctum = level.rooms.find((r) => r.layoutId === 'sanctum');
      for (const e of level.enemies.filter((e) => e.kind === 'archer' && e.roomKey === sanctum?.key)) {
        expect(e).toMatchObject({ z: sanctum!.z0 + 3.5, y: 0, perched: false });
        e.z -= 1;
        e.y = WORLD.platformHeight;
        e.perched = true;
      }
      expect(await fingerprint(level)).toBe(hash);
    } finally {
      scrolls.mockRestore();
      next.mockRestore();
    }
  });

  // Only F5's former two-guardian fixture is replaced. Its supply budget is
  // still empty and its RNG count stays 29; all F1–4 historical proofs above stay.
  it.each([
    ['FLOW1', '2b06438c85c8596b972df7af701b482b40c8812001374e6e29654b82f97c2656'],
    ['FLOW2', '2e54c5fa10a073213824dfab35ace4e2aacba5d0432dc3ad26dcaf2a1c09a6b3'],
    ['LIVING1', '359b4133118c4a010b5c243bb9e2408035a33f8aecf34cbe05f350e8400242f4'],
  ])('%s F5 has the explicit single-Warden baseline and zero supplies', async (seed, hash) => {
    const next = vi.spyOn(Rng.prototype, 'next');
    try {
      const level = generateLevel(seed, { floor: 5 });
      expect(next).toHaveBeenCalledTimes(29);
      expect(level.enemies).toHaveLength(1);
      expect(level.enemies[0]).toMatchObject({ kind: 'warden', boss: true });
      expect(level.pickups).toEqual([]); expect(level.chests).toEqual([]);
      expect(totalHealing(level)).toBe(0);
      expect(await fingerprint(level)).toBe(hash);
    } finally {
      next.mockRestore();
    }
  });

  it.each(['A', 'B'] as const)('template %s guarantees 3/2/2/2 accessible opportunities plus an empty arena', (template) => {
    const mirrors = new Set<boolean>();
    for (let k = 0; k < 12; k++) {
      let reliable = 0, food = 0, upgrades = 0;
      for (let floor = 1; floor <= 5; floor++) {
        const level = generateLevel(`HEAL-SUPPLY${k}`, { floor, template });
        if (floor === 5) {
          expect(level.chests).toEqual([]); expect(level.pickups).toEqual([]);
          continue;
        }
        mirrors.add(level.mirrored);
        expect(level.chests).toHaveLength(2);
        const fixedCount = floor === 1 ? 2 : 1;
        let floorReliable = 0;
        for (const [index, chest] of level.chests.entries()) {
          expect(chest.contents.ammo).toBe(3); expect(chest.contents.bottles).toBe(1);
          // One random item remains in *every* chest, including sentry vaults.
          expect(chest.contents.items).toHaveLength(index < fixedCount ? 2 : 1);
          if (index < fixedCount) {
            expect(chest.contents.items[0]).toEqual({ id: 'potion:healing', level: 0 });
            floorReliable++;
          }
        }
        const retained = level.chests[0]!;
        expect(level.rooms.find((r) => r.key === retained.roomKey)?.layoutId).toBe('ember-cache');
        const nav = new Nav(level.grid, PLAYER.radius);
        const seen = nav.flood(level.spawn.x, level.spawn.z, false);
        const reachableWithin = (x: number, z: number, radius: number) => seen.some((reachable, cell) => {
          if (!reachable) return false;
          const point = nav.center(cell);
          return Math.hypot(point.x - x, point.z - z) <= radius;
        });
        expect(reachableWithin(retained.x, retained.z, PLAYER.interactRange)).toBe(true);
        // The fourth planned pickup is fixed; random Healing must not satisfy
        // this assertion in place of an accidentally removed loose guarantee.
        const loose = level.pickups[3]!;
        expect(loose).toMatchObject({ kind: 'item', item: 'potion:healing', amount: 1, level: 0 });
        expect(reachableWithin(loose.x, loose.z, PLAYER.pickupRadius)).toBe(true);
        floorReliable++;
        expect(floorReliable).toBe(floor === 1 ? 3 : 2);
        reliable += floorReliable;
        food += level.pickups.filter((p) => p.item === 'food:ration').reduce((n, p) => n + p.amount, 0);
        upgrades += level.pickups.filter((p) => p.item === 'scroll:upgrade').reduce((n, p) => n + p.amount, 0);
      }
      expect(reliable).toBe(9); expect(food).toBe(6); expect(upgrades).toBe(4);
    }
    expect(mirrors.size).toBe(2);
  }, 30000);

  it('retains random Healing even in the chest whose fixed bottle was removed', () => {
    const level = generateLevel('HEAL-BUDGET4', { floor: 2 });
    expect(level.chests[1]!.contents.items).toEqual([{ id: 'potion:healing', level: 0 }]);
  });

  it.each([['FLOW1', 13], ['FLOW2', 11], ['LIVING1', 11]] as const)('%s total including random rolls is %i, exactly three fewer', (seed, expected) => {
    const total = Array.from({ length: 5 }, (_, k) => totalHealing(generateLevel(seed, { floor: k + 1 })))
      .reduce((sum, count) => sum + count, 0);
    expect(total).toBe(expected);
  });

  it('preserves practice generation and its RNG calls', async () => {
    const next = vi.spyOn(Rng.prototype, 'next');
    try {
      const level = generateLevel('HEAL-PRACTICE', { practice: true });
      expect(next).toHaveBeenCalledTimes(28);
      expect(await fingerprint(level)).toBe('3af27d14635aafea54ae00236b7647ceb9dbf491a657b5169b5976306cf89a9e');
    } finally {
      next.mockRestore();
    }
  });

  it.each(['warrior', 'huntress'] as const)('%s still starts without Healing; the 50%% heal and ordinary 99-stack remain', (cls) => {
    const world = createFloorWorld(newRun('HEAL-SUPPLY-START', cls));
    expect(world.player.items).toEqual([]);
    expect(HEALING_POTION.fraction).toBe(0.5);
    for (let k = 0; k < 99; k++) expect(addItem(world, 'potion:healing')).toBe(true);
    expect(world.player.items).toEqual([{ id: 'potion:healing', count: 99, level: 0 }]);
    expect(addItem(world, 'potion:healing')).toBe(true);
    expect(world.player.items.map((item) => item.count)).toEqual([99, 1]);
  });
});
