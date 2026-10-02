import { describe, expect, it } from 'vitest';
import { CLASS_KNOWLEDGE, XP } from '../src/config';
import { BOSS_TEST_SEED, bossTestLoadout, createBossTestWorld } from '../src/dev/bossTest';
import { levelSignature } from '../src/gen/generator';
import { generateLevel } from '../src/gen/validate';
import { armorReduction } from '../src/sim/equipment';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { createFloorWorld, newRun, parseRun, serializeRun } from '../src/sim/run';

describe.each(['warrior', 'huntress'] as const)('Boss test %s fixtures', cls => {
  it('starter is exactly the existing trial with actual arena and no extra stock', () => {
    const w = createBossTestWorld(cls, 'starting'), trial = createTrialWorld('heart-warden', cls);
    expect(w.carry()).toEqual(trial.carry()); expect(w.statsCopy()).toEqual(trial.statsCopy());
    expect(w.enemies).toEqual(trial.enemies);
    expect(levelSignature(w.level)).toBe(levelSignature(trial.level));
    expect(w.level.grid.tiles).toEqual(generateLevel(BOSS_TEST_SEED, { floor: 5 }).grid.tiles);
    expect(w.enemies).toHaveLength(1); expect(w.enemies[0]!.hp).toBe(80);
    expect(w.player.known).toEqual(CLASS_KNOWLEDGE[cls]);
    expect(w.player.items).toEqual([]); expect(w.player.talents).toEqual([]);
    expect(w.level.resupply).toBeNull(); expect(w.pickups).toEqual([]);
  });
  it('split explicitly grants exactly four upgrades, Lv5 and finite known healing', () => {
    const w = createBossTestWorld(cls, 'split'), p = w.player;
    expect(p.level).toBe(5); expect(p.xp).toBe(XP.levels[4]); expect(p.hp).toBe(p.maxHp);
    expect(p.maxHp).toBe(18); expect(p.talents).toEqual([]);
    expect(p.armor).toEqual({ id: 'leather', level: 2 }); expect(armorReduction(p.armor.id, p.armor.level)).toBe(3);
    expect(p.weapon.level + p.bowLevel + p.armor.level).toBe(4);
    expect(p.weapon.level).toBe(cls === 'warrior' ? 2 : 0);
    expect(p.bowLevel).toBe(cls === 'huntress' ? 2 : 0);
    expect(p.items).toEqual([{ id: 'potion:healing', count: 2, level: 0 }]);
    expect(p.known).toContain('potion:healing'); expect(p.known).not.toContain('scroll:identify');
    expect(w.pendingChoice).toBeNull(); expect(w.choiceQueue).toEqual([]); expect(w.events).toEqual([]);
    expect(bossTestLoadout(w)).toContain('HP 18/18'); expect(bossTestLoadout(w)).toContain('已知治療 ×2');
    p.items = []; p.arrows = 0; p.bottles = 0;
    w.advance(2);
    expect(p.items).toEqual([]); expect(p.arrows).toBe(0); expect(p.bottles).toBe(0);
    expect(createBossTestWorld(cls, 'split').carry()).not.toEqual(w.carry());
  });
  it('fixtures cannot leak knowledge, gear or RNG changes into campaigns', () => {
    const save = serializeRun(newRun('TEST-ISOLATION', cls));
    const before = createFloorWorld(parseRun(save)!);
    createBossTestWorld(cls, 'split'); createBossTestWorld(cls, 'starting');
    const after = createFloorWorld(parseRun(save)!);
    expect(after.carry()).toEqual(before.carry());
    expect(levelSignature(after.level)).toBe(levelSignature(before.level));
    expect(serializeRun(parseRun(save)!)).toBe(save);
  });
});
