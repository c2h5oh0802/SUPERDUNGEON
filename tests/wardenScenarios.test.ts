import { describe, expect, it } from 'vitest';
import { runWardenScenario } from './wardenScenarios';

const policies = ['headspam', 'read-bow', 'counter-sword', 'recovery-knife'] as const;
describe('Warden actual-arena policy probes (not human balance proof)', () => {
  it('base sword, recovery bow and zero-ammo knife have deterministic no-consumable routes', () => {
    const results = policies.map(p => runWardenScenario(p));
    console.log('WARDEN BASELINE ' + JSON.stringify(results));
    const [spam, bow, sword, knife] = results;
    for (const r of [bow!, sword!, knife!]) { expect(r.cleared).toBe(true); expect(r.dead).toBe(false); expect(r.damage).toBe(0); }
    expect(spam!.damage).toBeGreaterThan(bow!.damage); expect(spam!.blockedHeads).toBeGreaterThan(0);
    expect(bow!.arrowsUsed).toBe(6); expect(bow!.attackKinds).toContain('rush');
    expect(sword!.counters).toBeGreaterThan(0); expect(sword!.deflects).toBeGreaterThan(0);
    expect(knife!.arrowsUsed).toBe(0);
    expect(runWardenScenario('read-bow')).toEqual(bow);
  });
  it.each([30, 120])('normal-frame routes remain viable at %i FPS', fps => {
    for (const policy of ['read-bow', 'counter-sword', 'recovery-knife'] as const) {
      const result = runWardenScenario(policy, fps);
      console.log('WARDEN FPS ' + JSON.stringify(result));
      expect(result.cleared).toBe(true); expect(result.dead).toBe(false);
    }
  });
  it('records mirror/reaction sensitivity without treating bots as human difficulty', () => {
    for (const seed of ['WARDEN-A', 'WARDEN-B']) for (const policy of policies) {
      const result = runWardenScenario(policy, 60, seed, .12);
      console.log('WARDEN REACTION ' + JSON.stringify(result));
      expect(Number.isFinite(result.worldTime)).toBe(true);
      if (policy !== 'headspam') { expect(result.cleared).toBe(true); expect(result.dead).toBe(false); }
    }
  });
});
