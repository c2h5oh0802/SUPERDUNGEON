import { describe, expect, it, vi } from 'vitest';
import { ENEMIES, WORLD } from '../src/config';
import { Rng } from '../src/core/rng';
import type { GenerateOptions, LevelData } from '../src/gen/generator';
import { createTrialLevel } from '../src/gen/practiceTrials';
import { generateLevel } from '../src/gen/validate';
import { T } from '../src/sim/grid';
import { Nav } from '../src/sim/nav';

// Captured before the conversion from tree 1cbc23fd8f9e260bbf54aee4a1b0846aedb3ed36.
// Each row covers all four exploration floors, including every RNG result and the
// exact level data (no rounding). `before` is [ground, perched, sanctum archers].
// Across 96 floors: 318 ground / 362 perched -> 422 ground / 258 perched, with
// 104 converted spawns, 38 unmirrored / 58 mirrored floors, and zero retries.
const BASELINES = [
  { seed: 'ARCHER-GEN-0', template: 'A', digest: '6be81980fc29a3056c6f740855df2bdc2c89e2ecaf972c63ad4cd2d990066e32', draws: 521, before: [13, 18, 6] },
  { seed: 'ARCHER-GEN-0', template: 'B', digest: '319427b01947b3ff21ca350296b3f53a6ce9edb9e7b2ce620fc21e903cdfb57e', draws: 514, before: [11, 16, 6] },
  { seed: 'ARCHER-GEN-1', template: 'A', digest: 'e3bd8409207b74b28fbd695a9daf5bfa21c62017e046be6ce38083388838a41a', draws: 526, before: [14, 16, 4] },
  { seed: 'ARCHER-GEN-1', template: 'B', digest: '24e893fa8e43c4fcbd186b569aa5ebfff65a4a5ea94689b108f8c1008f7a0279', draws: 517, before: [12, 15, 4] },
  { seed: 'ARCHER-GEN-2', template: 'A', digest: '790a5d25529375f685b7dc43bf4c9a40acbc76037eb637302fc01ab4529e8077', draws: 519, before: [17, 15, 4] },
  { seed: 'ARCHER-GEN-2', template: 'B', digest: '2cea3b43e2851ad57d9e4eaea4915c0491157a3df1132e838525f4ed570bdcba', draws: 512, before: [11, 15, 4] },
  { seed: 'ARCHER-GEN-3', template: 'A', digest: '4c7e6790f3261522f19c8220b67d8bd8dfb593a5b84bb937c247e10739957360', draws: 521, before: [17, 14, 2] },
  { seed: 'ARCHER-GEN-3', template: 'B', digest: 'f1f6d550c1b1b5db5c70545850e2265f4278a0a2fdf523b27cb25c49c8cdd1a7', draws: 517, before: [13, 12, 2] },
  { seed: 'ARCHER-GEN-4', template: 'A', digest: 'ca1ebfaabb6d28b726fa3975514efcbd70e266f7cffd8591c82cf57022b87298', draws: 523, before: [14, 15, 4] },
  { seed: 'ARCHER-GEN-4', template: 'B', digest: '7d0145398f481dc76c92c0c165dbc7bdd2111d10298edfe7ddbd626284793640', draws: 510, before: [12, 16, 4] },
  { seed: 'ARCHER-GEN-5', template: 'A', digest: 'b13688451c134eb902ac7ec0ac8ff3791f1bce9677b43ceb67b3c04ead2e692b', draws: 521, before: [16, 14, 4] },
  { seed: 'ARCHER-GEN-5', template: 'B', digest: '9ab1dd74e21549902ad32c5d8f206349b45660ba7fd758796b1c56c1ec2e7fee', draws: 520, before: [13, 15, 4] },
  { seed: 'ARCHER-GEN-6', template: 'A', digest: '6acdd3b852253710d84eb3bd09af6230a8ffab10b69cc460a414952804310f7d', draws: 523, before: [18, 12, 2] },
  { seed: 'ARCHER-GEN-6', template: 'B', digest: 'bfafcbafe0f3e4bdd3cbae82aff1006a134138ccfb267da2292df03234e427e7', draws: 513, before: [13, 13, 2] },
  { seed: 'ARCHER-GEN-7', template: 'A', digest: '54e5484b05b5f3afdeef439a5e21f99d4eee1add80fdb2aefabf4800622a2380', draws: 534, before: [13, 15, 4] },
  { seed: 'ARCHER-GEN-7', template: 'B', digest: '8549808f714870e97f12e96397a561d9ed395743b3eb2ee5511caf23329c2531', draws: 527, before: [11, 14, 4] },
  { seed: 'ARCHER-GEN-8', template: 'A', digest: 'cd1229b4606a08cf5eb17078e1f790df0f1dad432af2cea15ea4ad38298c1e01', draws: 526, before: [14, 18, 6] },
  { seed: 'ARCHER-GEN-8', template: 'B', digest: '87de66a4120b5c9c68b4bcff632a3efb74b97e629a3503fb434317df38db2dc4', draws: 524, before: [10, 16, 6] },
  { seed: 'ARCHER-GEN-9', template: 'A', digest: '3b691a1a55e89762facf50c282ed508442cef8a1e4e63723b0f91d7ec235c7a0', draws: 540, before: [14, 18, 8] },
  { seed: 'ARCHER-GEN-9', template: 'B', digest: '7b7fea6ed2489e8d85b304a88d3cb1d75d68795b9497768dcac0d399e96df529', draws: 532, before: [9, 20, 8] },
  { seed: 'ARCHER-GEN-10', template: 'A', digest: 'f2671bafe7e0ffc1748b2e384facf15cf1ddd89a57d96b84c3577dfbfcbc0672', draws: 513, before: [16, 13, 4] },
  { seed: 'ARCHER-GEN-10', template: 'B', digest: '171ca36191a18c9ff0775bccc21d29fcfa3b04a20467b5c65aa4bceafbd20425', draws: 511, before: [11, 13, 4] },
  { seed: 'ARCHER-GEN-11', template: 'A', digest: '1fc3f80e720fb8c18b4bcf5b2b91d25c2421ea83b95beb0b8b7c4dec5b1a7b8c', draws: 518, before: [15, 15, 4] },
  { seed: 'ARCHER-GEN-11', template: 'B', digest: 'ce4974d5f385ab3082794ec1899d7d532ed571ed5a4867ec434543e040ffd4e2', draws: 510, before: [11, 14, 4] },
] as const;

function fingerprint(level: LevelData): string {
  return JSON.stringify({
    ...level,
    grid: {
      w: level.grid.w, h: level.grid.h,
      tiles: Array.from(level.grid.tiles), doorIndex: Array.from(level.grid.doorIndex),
      pillars: level.grid.pillars, doors: level.grid.doors,
    },
  });
}

async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
const ENEMY_NAV_R = Math.max(ENEMIES.guard.radius, ENEMIES.archer.radius, ENEMIES.charger.radius);

// Restore only the intended spawn change for an exact before/after comparison.
// All coordinates, states, patrols, enemy ordering, geometry, supplies, chest loot,
// torches, door states, room selection, attempt counts and RNG draws stay checked.
function beforeConversion(level: LevelData): LevelData {
  const room = level.rooms.find((r) => r.layoutId === 'sanctum');
  return {
    ...level,
    enemies: level.enemies.map((e) => e.kind === 'archer' && e.roomKey === room?.key
      ? { ...e, z: e.z - 1, y: WORLD.platformHeight, perched: true } : e),
  };
}

describe('campaign archer ground placement', () => {
  it.each(BASELINES)('$seed template $template preserves the full pre-change level and RNG stream', async ({ seed, template, digest, draws, before }) => {
    const rng = vi.spyOn(Rng.prototype, 'next');
    try {
      const levels: LevelData[] = [];
      const counts = [0, 0, 0];
      for (let floor = 1; floor <= 4; floor++) {
        const level = generateLevel(seed, { floor, template });
        levels.push(level);
        const nav = new Nav(level.grid, ENEMY_NAV_R);
        const seen = nav.flood(level.spawn.x, level.spawn.z, false);
        const archers = level.enemies.filter((e) => e.kind === 'archer');
        counts[0]! += archers.filter((e) => !e.perched).length;
        counts[1]! += archers.filter((e) => e.perched).length;
        const sentries = archers.filter((e) => level.rooms.find((r) => r.key === e.roomKey)?.layoutId === 'sentry-vault');
        expect(sentries).toHaveLength(2);
        expect(sentries.every((e) => e.perched && e.y === WORLD.platformHeight)).toBe(true);
        for (const e of archers) {
          const room = level.rooms.find((r) => r.key === e.roomKey)!;
          if (room.layoutId === 'sanctum') {
            counts[2]!++;
            expect(e.perched).toBe(false);
            expect(e.y).toBe(0);
            expect(e.z).toBe(room.z0 + 3.5);
            expect(level.grid.get(Math.floor(e.x), Math.floor(e.z))).toBe(T.Floor);
            expect(level.grid.get(Math.floor(e.x), Math.floor(e.z - 1))).toBe(T.Platform);
            expect(level.grid.circleBlocked(e.x, e.z, ENEMY_NAV_R)).toBe(false);
            expect(seen[nav.cellOf(e.x, e.z)]).toBe(1);
            // Reaching the room interior verifies the spawn can actually leave its
            // adjacent ledge, not merely snap to a different nearest nav cell.
            const path = nav.findPath(e.x, e.z, room.x0 + room.w / 2, room.z0 + 5.5);
            expect(path).not.toBeNull();
            expect(path!.length).toBeGreaterThan(0);
            let from = e;
            for (const to of path!) {
              expect(nav.lineWalkable(from.x, from.z, to.x, to.z)).toBe(true);
              from = { ...e, ...to };
            }
          } else if (e.perched) {
            expect(['range', 'sentry-vault']).toContain(room.layoutId);
            expect(e.y).toBe(WORLD.platformHeight);
          }
        }
      }
      expect(counts).toEqual([before[0] + before[2], before[1] - before[2], before[2]]);
      const results = rng.mock.results.map((result) => result.value as number);
      expect(results).toHaveLength(draws);
      expect(await hash({ levels: levels.map((level) => fingerprint(beforeConversion(level))), draws: results })).toBe(digest);
    } finally {
      rng.mockRestore();
    }
  });
});

const UNTOUCHED: Array<{ seed: string; opts: GenerateOptions; digest: string }> = [
  { seed: 'ARCHER-GEN-0', opts: { practice: true }, digest: 'fc288be4b968dfab0207bb60cdbce8f96f27bb4490b88633ac87dd43a69dc531' },
  { seed: 'ARCHER-GEN-1', opts: { practice: true }, digest: '7c180e9afef5e6717a52caea1299182715749f9074121af74da109a97e7d25cb' },
  { seed: 'ARCHER-GEN-0', opts: { floor: 5 }, digest: '7e51c714a5beda71f30abd29c10c4b3f919b66b8bd38ad6aabd4a7527613985c' },
  { seed: 'ARCHER-GEN-1', opts: { floor: 5 }, digest: '0185071bd3b596ec922f1440d012037160cde1fb392f4d1754c6a73542104d58' },
];

describe('authored practice and final arena stay unchanged', () => {
  it.each(UNTOUCHED)('$seed $opts keeps exact authored generation and RNG results', async ({ seed, opts, digest }) => {
    const rng = vi.spyOn(Rng.prototype, 'next');
    try {
      const level = generateLevel(seed, opts);
      const results = rng.mock.results.map((result) => result.value as number);
      expect(await hash({ level: fingerprint(level), draws: results })).toBe(digest);
      if (opts.practice) expect(level.enemies.filter((e) => e.kind === 'archer').every((e) => e.perched)).toBe(true);
    } finally {
      rng.mockRestore();
    }
  });

  it.each([
  { id: 'shield-crossfire', digest: '6f7f7fafc9dbf0d272ba9f602d6e48a7ded9a593727787aa12a46470a0d51648' },
  { id: 'charger-window', digest: 'f63595b3dd687b2888d724aba62739d5d7ba6619582a2322fb2ed2f6a3f97d04' },
  { id: 'cluster-bypass', digest: 'd902f0170513b415aec842ccbd8ead7b88b293f2829b5ac106a58edd6e214768' },
  ] as const)('$id keeps its fixed trial geometry and perched archer', async ({ id, digest }) => {
    const level = createTrialLevel(id);
    expect(await hash(fingerprint(level))).toBe(digest);
    expect(level.enemies.filter((e) => e.kind === 'archer').every((e) => e.perched)).toBe(true);
  });
});
