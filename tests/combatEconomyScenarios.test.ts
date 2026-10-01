import { describe, expect, it } from 'vitest';
import { ECONOMY_SCENARIOS, runEconomyScenario } from './combatEconomyScenarios';

describe('Combat action economy deterministic observations', () => {
  it.each(ECONOMY_SCENARIOS)('$name has deterministic outcomes without forced player damage', scenario => {
    const result = runEconomyScenario(scenario);
    console.log(JSON.stringify(result));
    expect(runEconomyScenario(scenario)).toEqual(result);
    expect(result.worldTime).toBeGreaterThan(0);
    expect(result.attacks + result.pushes).toBeGreaterThan(0);
    expect(result.damage).toBeGreaterThanOrEqual(0); // Zero-damage skillful clears are valid.
    expect(result.reason).not.toBe('real-limit');
    expect(Math.max(0, ...result.hitsPerAction)).toBeLessThanOrEqual(scenario.weapon === 'axe' ? 2 : 1);
    if (scenario.weapon === 'spear') expect(result.fullSpeedRetreatFraction).toBe(0);
    if (scenario.policy === 'shield-repeat') expect(result.committedPushCancels).toBe(0);
    if (scenario.name === 'spear-restricted-endurance-stress') expect(result.blockedRetreatFrames).toBeGreaterThan(0);
  });
});
