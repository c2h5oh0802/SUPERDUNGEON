import { describe, expect, it } from 'vitest';
import { ALL_WEAPONS, ENEMIES, PLAYER, TALENT_FX, XP } from '../src/config';
import { runWardenPressureScenario } from './wardenPressureScenarios';

describe('Warden held-input pressure regressions (real arena/frame inputs)', () => {
  it('plain held attack does not silently receive Counter skill rewards', () => {
    const result = runWardenPressureScenario({ policy: 'walk-hold', stopDistance: 2.8 });
    expect(result.fixture.bossHp).toBe(ENEMIES.warden.hp);
    expect(result.presses).toBe(1);
    expect(result.counters).toBe(0);
  });

  it('blind starting sword cannot outperform deliberate reading by ending the fight before meaningful pressure', () => {
    const blind = runWardenPressureScenario({ policy: 'walk-hold' });
    const deliberate = runWardenPressureScenario({ policy: 'read-counter', reaction: .12 });
    console.log('WARDEN PRESSURE COMPARISON ' + JSON.stringify({ blind, deliberate }));
    expect(deliberate.cleared).toBe(true);
    expect(deliberate.dead).toBe(false);
    expect(deliberate.invalidPressEdges).toBe(0);
    expect(deliberate.presses).toBeGreaterThan(1);
    expect(deliberate.releases).toBeGreaterThan(0);
    expect(blind.cleared).toBe(false);
    expect(blind.damage).toBeGreaterThan(deliberate.damage);
  });

  it.each(ALL_WEAPONS)('holding %s is not a renewable Counter engine', weapon => {
    for (const policy of ['walk-hold', 'stationary-hold'] as const) {
      const result = runWardenPressureScenario({ policy, weapon });
      expect(result.counters).toBe(0);
      expect(result.dead).toBe(true);
      expect(result.strikes + result.shots).toBeGreaterThan(0);
      expect(result.presses).toBe(1);
      expect(result.blockedByChoice).toBe(false);
      expect(result.worldTime).toBeLessThanOrEqual(result.maxWorldTime + 1 / result.fps);
    }
  });
});

describe('Warden readable no-consumable routes with actual input edges', () => {
  it.each([30, 60, 120])('supports measured reaction delays at %i FPS', fps => {
    for (const reaction of [0, .12, .2]) for (const policy of ['read-counter', 'read-knife'] as const) {
      const result = runWardenPressureScenario({ policy, fps, reaction });
      expect(result.cleared, JSON.stringify(result)).toBe(true);
      expect(result.dead).toBe(false);
      expect(result.blockedByChoice).toBe(false);
      expect(result.fixture.ammunition).toBe(0);
      expect(result.fixture.consumables).toBe(0);
      expect(result.presses).toBeGreaterThan(1);
      expect(result.releases).toBeGreaterThanOrEqual(result.presses - 1);
      expect(result.invalidPressEdges).toBe(0);
      if (policy === 'read-counter') expect(result.counters).toBeGreaterThan(0);
      expect(result.phaseTwoAt).not.toBeNull();
      expect(result.attackKinds['cleave-followup']).toBeGreaterThan(0);
      // Zero damage is a possible earned result, never an acceptance requirement.
    }
  });

  it('discloses progression instead of accidentally carrying practice HP into campaign fixtures', () => {
    const split = runWardenPressureScenario({ policy: 'walk-hold', build: 'four-scroll-split' });
    const offense = runWardenPressureScenario({ policy: 'walk-hold', build: 'four-scroll-offense' });
    expect(split.fixture.weapon).toEqual({ id: 'longsword', level: 2 });
    expect(split.fixture.armor).toEqual({ id: 'leather', level: 2 });
    expect(offense.fixture.weapon).toEqual({ id: 'longsword', level: 4 });
    expect(split.fixture.level).toBe(5);
    expect(offense.fixture.level).toBe(5);
    expect(split.fixture.playerMaxHp).toBe(PLAYER.maxHp + 4 * XP.hpPerLevel);
    const full = runWardenPressureScenario({ policy: 'walk-hold', build: 'full-clear-split', talents: ['toughness', 'combo'] });
    expect(full.fixture.level).toBe(9);
    expect(full.fixture.playerMaxHp).toBe(PLAYER.maxHp + 8 * XP.hpPerLevel + TALENT_FX.toughnessHp);
    expect(full.fixture.talents).toEqual(['toughness', 'combo']);
  });

  it.each(['four-scroll-split', 'four-scroll-offense'] as const)('%s retains a health-cost advantage for deliberate reading', build => {
    const deliberate = runWardenPressureScenario({ policy: 'read-counter', build, reaction: .2 });
    expect(deliberate.cleared).toBe(true);
    for (const policy of ['walk-hold', 'stationary-hold'] as const) {
      const blind = runWardenPressureScenario({ policy, build });
      expect(blind.counters).toBe(0);
      expect(blind.damage).toBeGreaterThan(deliberate.damage);
      expect(blind.damage).toBeGreaterThanOrEqual(blind.fixture.playerMaxHp / 2);
      expect(blind.phaseTwoAt).not.toBeNull();
    }
  });

  it('does not reward the old sword/spear near-range dead zone', () => {
    for (const weapon of ['longsword', 'spear'] as const) for (const startDistance of [2.7, 3.2]) {
      const result = runWardenPressureScenario({ policy: 'stationary-hold', weapon, startDistance });
      expect(result.dead).toBe(true);
      expect(result.counters).toBe(0);
      expect(result.attackKinds.cleave).toBeGreaterThan(0);
      expect(result.strikes).toBeGreaterThan(0);
    }
  });

  it('is deterministic and terminates even when neither combatant has won', () => {
    const options = { policy: 'read-counter', maxWorldTime: 1, maxRealTime: 2 } as const;
    const result = runWardenPressureScenario(options);
    expect(result).toEqual(runWardenPressureScenario(options));
    expect(result.timedOut).toBe(true);
    expect(result.worldTime).toBeLessThanOrEqual(options.maxWorldTime + 1 / result.fps);
    expect(result.realTime).toBeLessThanOrEqual(options.maxRealTime);
  });
});
