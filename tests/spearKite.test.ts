import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, TIME, WEAPONS, type WeaponId } from '../src/config';
import { actionMoveMultiplier, movePlayer, startActions } from '../src/sim/playerSys';
import { emptyInput } from '../src/sim/types';
import { finishAction, makeWorld, run } from './helpers';
import { kiteWorld, runKite, type KiteEncounter, type KitePolicy } from './spearKiteBots';

// Parameter ablation in the CURRENT merged AI, not a historical runtime.
// Legacy controls explicitly restore movement, timing and unlimited target damage.
function rules<T>(moveMul: number, attackRange: number, stepSpeed: number, fn: () => T, recovery = WEAPONS.spear.recovery): T {
  const guard = ENEMIES.guard as { attackRange: number; attackStepSpeed: number };
  const saved = { move: WEAPONS.spear.move, range: guard.attackRange, step: guard.attackStepSpeed, recovery: WEAPONS.spear.recovery };
  try { WEAPONS.spear.move = { windup: moveMul, active: moveMul, recovery: moveMul }; WEAPONS.spear.recovery = recovery; guard.attackRange = attackRange; guard.attackStepSpeed = stepSpeed; return fn(); }
  finally { WEAPONS.spear.move = saved.move; WEAPONS.spear.recovery = saved.recovery; guard.attackRange = saved.range; guard.attackStepSpeed = saved.step; }
}
const legacyRules = <T>(fn: () => T) => {
  const { maxTargets, secondaryDamage } = WEAPONS.spear;
  try { WEAPONS.spear.maxTargets = Number.MAX_SAFE_INTEGER; WEAPONS.spear.secondaryDamage = 1; return rules(1, 2, 0, fn, 0.4); }
  finally { WEAPONS.spear.maxTargets = maxTargets; WEAPONS.spear.secondaryDamage = secondaryDamage; }
};

const encounters: KiteEncounter[] = ['guard', 'twoGuards', 'guardArcher'];
const policies: KitePolicy[] = ['holdBack', 'distanceOnly', 'readAttack', 'readEncounter'];
const summary = ({ distances, ...r }: ReturnType<typeof runKite>) => ({ ...r, samples: distances.length });

describe('spear kite: reproducible before/after and causal ablation', () => {
  it('pre-fix distance-only loop clears one and two ordinary guards with no windup or damage', () => {
    legacyRules(() => {
      for (const enc of ['guard', 'twoGuards'] as const) {
        const r = runKite(enc, 'distanceOnly');
        expect(r.cleared).toBe(true);
        expect(r.damage).toBe(0);
        expect(r.windups).toBe(0);
        expect(r.minDistance).toBeGreaterThan(ENEMIES.guard.reach + PLAYER.radius);
        expect(r.attacks).toBe(enc === 'guard' ? 2 : 3);
      }
    });
  });

  it('literal always-back input escapes reach instead of completing an empty long lane', () => {
    const r = legacyRules(() => runKite('guard', 'holdBack'));
    expect(r.cleared).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.hits).toBe(1);
    expect(r.maxDistance).toBeGreaterThan(WEAPONS.spear.reach * 2);
  });

  it('movement commitment alone still leaves the short encounter safe', () => {
    const r = rules(0.55, 2, 0, () => runKite('guard', 'distanceOnly'), 0.4);
    expect(r.cleared).toBe(true);
    expect(r.damage).toBe(0);
    expect(r.windups).toBe(0);
  });

  it.each(['guard', 'twoGuards'] as const)('blind distance loop cannot keep permanent safety in the 32 HP prolonged probe: %s', enc => {
    // Ordinary two-hit kills may remain flawless. This injected HP fixture
    // tests repeated spacing, rather than requiring damage before every kill.
    const r = runKite(enc, 'distanceOnly', 'huntress', 1 / 60, 32);
    expect(r.windups).toBeGreaterThan(0);
    expect(r.minDistance).toBeLessThan(ENEMIES.guard.reach + PLAYER.radius);
    expect(r.damage).toBeGreaterThan(0);
  });

  it.each(['guard', 'twoGuards'] as const)('reading windup, releasing fire and recovering spacing can remain flawless: %s', enc => {
    const r = runKite(enc, 'readAttack');
    expect(r.cleared).toBe(true);
    expect(r.dead).toBe(false);
    expect(r.damage).toBe(0);
    expect(r.windups).toBeGreaterThan(0);
  });

  it('ranged pressure defeats the same line-only policy before and after (not a newly solved claim)', () => {
    for (const r of [legacyRules(() => runKite('guardArcher', 'distanceOnly')), runKite('guardArcher', 'distanceOnly')]) {
      expect(r.dead).toBe(true);
      expect(r.cleared).toBe(false);
      expect(r.damage).toBeGreaterThan(0);
      expect(r.hits).toBeGreaterThanOrEqual(2); // spear still disposes of the melee target
    }
  });

  it('spear remains useful in a mixed encounter when the bot reads ranged lock, strafes and advances', () => {
    const r = runKite('guardArcher', 'readEncounter');
    console.log('MIXED ADAPTIVE', JSON.stringify(summary(r)));
    expect(r.cleared).toBe(true);
    expect(r.dead).toBe(false);
  });

  it('current 50–70% movement sweep measures the sustained spacing trade', () => {
    const rows = [0.5, 0.55, 0.6, 0.65, 0.7].map(mul => ({ mul,
      blind: rules(mul, ENEMIES.guard.attackRange, ENEMIES.guard.attackStepSpeed, () => runKite('guard', 'distanceOnly', 'huntress', 1 / 60, 32)),
      read: rules(mul, ENEMIES.guard.attackRange, ENEMIES.guard.attackStepSpeed, () => runKite('guard', 'readAttack', 'huntress', 1 / 60, 32)) }));
    expect(rows.find(r => r.mul === 0.55)!.blind.damage).toBeGreaterThan(0);
    expect(rows.find(r => r.mul === 0.55)!.read.damage).toBe(0);
    expect(rows.find(r => r.mul === 0.55)!.read.cleared).toBe(true);
    console.log('TUNING (32 HP injected prolonged probe)', JSON.stringify(rows.map(r => ({ mul: r.mul, blind: summary(r.blind), read: summary(r.read) }))));
  });

  it.each([1 / 30, 1 / 60, 1 / 120])('outcomes survive frame size %s', dt => {
    expect(runKite('guard', 'distanceOnly', 'huntress', dt, 32).damage).toBeGreaterThan(0);
    const expert = runKite('guard', 'readAttack', 'huntress', dt);
    expect(expert.cleared).toBe(true);
    expect(expert.damage).toBe(0);
  });

  it('repeat is deterministic and records spacing, elapsed world time and attack count', () => {
    expect(runKite('twoGuards', 'readAttack')).toEqual(runKite('twoGuards', 'readAttack'));
    const before = legacyRules(() => encounters.map(enc => runKite(enc, 'distanceOnly')));
    const after = encounters.flatMap(enc => policies.map(policy => runKite(enc, policy)));
    console.log('KITE LEGACY-PARAMETER ABLATION', JSON.stringify(before));
    console.log('KITE AFTER', JSON.stringify(after.map(summary)));
    console.log('KITE SPACING AFTER', JSON.stringify(after.filter(r => r.policy === 'distanceOnly').map(r => ({ encounter: r.encounter, distances: r.distances }))));
  });

  it('records blind warrior loops without requiring accidental Counter success', () => {
    for (const distance of [2.4, 3]) {
      const r = runKite('guard', 'distanceOnly', 'warrior', 1 / 60, 32, distance);
      console.log('BLIND WARRIOR (observation)', JSON.stringify({ distance, ...summary(r) }));
      expect(r).toEqual(runKite('guard', 'distanceOnly', 'warrior', 1 / 60, 32, distance));
      expect(r.windups).toBeGreaterThan(0);
      expect(r.hits).toBeGreaterThan(0);
      // Deliberate cue timing has dedicated tests; a blind loop need not counter or clear.
    }
  });
});

describe('weapon-specific movement commitment and real geometry', () => {
  it.each(['knife', 'longsword', 'spear', 'axe'] as WeaponId[])('%s: all action phases cap real movement; idle remains full speed', id => {
    const w = makeWorld();
    w.player.weapon.id = id;
    const spec = WEAPONS[id];
    startActions(w, { ...emptyInput(), fire: true });
    for (const t of [0, spec.windup + 0.01, spec.windup + spec.active + 0.01]) {
      w.player.action!.t = t;
      w.player.vx = PLAYER.moveSpeed;
      w.player.vz = 0;
      const moved = movePlayer(w, { ...emptyInput(), moveX: 1 }, 1 / 60);
      expect(moved).toBeCloseTo(PLAYER.moveSpeed * actionMoveMultiplier(w) / 60, 6);
      expect(moved).toBeGreaterThan(0);
    }
    w.player.action = null;
    w.player.vx = PLAYER.moveSpeed;
    expect(movePlayer(w, { ...emptyInput(), moveX: 1 }, 1 / 60)).toBeCloseTo(PLAYER.moveSpeed / 60, 6);
  });

  it('letting go, diagonal input and switching desired tool do not bypass a captured melee weapon', () => {
    const w = makeWorld();
    w.player.weapon.id = 'spear';
    startActions(w, { ...emptyInput(), fire: true });
    w.player.weapon.id = 'knife'; // injection: even an external equipment mutation cannot change the current action
    w.player.desiredTool = 'bow';
    for (const input of [emptyInput(), { ...emptyInput(), moveX: 1, moveZ: -1 }]) {
      w.player.vx = 4.5;
      w.player.vz = 4.5;
      movePlayer(w, input, 1 / 60);
      expect(Math.hypot(w.player.vx, w.player.vz)).toBeLessThanOrEqual(PLAYER.moveSpeed * actionMoveMultiplier(w) + 1e-9);
    }
  });

  it('action time still dominates reduced movement; sneaking composes and recovery releases the cap', () => {
    const w = makeWorld();
    w.player.weapon.id = 'spear';
    const before = w.time;
    w.frame(1 / 60, { ...emptyInput(), fire: true, moveZ: -1, sneak: true });
    expect(w.lastWorldDt).toBeCloseTo(1 / 60, 8);
    expect(Math.hypot(w.player.vx, w.player.vz)).toBeLessThanOrEqual(PLAYER.moveSpeed * actionMoveMultiplier(w) * w.sneakSpeedMul());
    finishAction(w);
    expect(w.time - before).toBeCloseTo(0.85, 5);
    run(w, 20, { moveZ: -1 });
    expect(Math.hypot(w.player.vx, w.player.vz)).toBeCloseTo(PLAYER.moveSpeed, 5);
    expect(TIME.refMoveSpeed).toBe(4.5);
  });

  it('spear alone connects from 3 m; no random miss or close-range damage penalty added', () => {
    for (const id of ['knife', 'longsword', 'axe', 'spear'] as WeaponId[]) {
      const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 11.5, yaw: Math.PI }], 'huntress');
      w.player.weapon.id = id;
      const e = w.enemies[0]!;
      e.state = 'alert';
      e.paralyzeT = 10;
      w.frame(1 / 60, { ...emptyInput(), fire: true });
      finishAction(w);
      expect(e.hp).toBe(ENEMIES.guard.hp - (id === 'spear' ? WEAPONS.spear.damage : 0));
    }
    const close = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13.3 }], 'huntress');
    close.enemies[0]!.state = 'alert';
    close.player.weapon.id = 'spear';
    close.enemies[0]!.paralyzeT = 10;
    close.frame(1 / 60, { ...emptyInput(), fire: true });
    finishAction(close);
    expect(close.enemies[0]!.hp).toBe(ENEMIES.guard.hp - WEAPONS.spear.damage);
  });

  it('guard lock freezes direction during actual movement; correct side-step can dodge', () => {
    const w = kiteWorld('guard');
    const g = w.enemies[0]!;
    // Inject a precise already-locked threat at 3.4 m. Standing in this same
    // fixture is hit; moving sideways must change the actual hit geometry.
    w.player.z = 10.4;
    Object.assign(g, { phase: 'windup', phaseT: 0.36, locked: true, lockedYaw: Math.PI });
    const locked = g.lockedYaw;
    const x = g.x;
    for (let k = 0; k < 24; k++) w.frame(1 / 60, { ...emptyInput(), moveX: 1 });
    expect(g.lockedYaw).toBe(locked);
    expect(g.yaw).toBe(locked);
    expect(g.x).toBeCloseTo(x, 6);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    const still = kiteWorld('guard');
    still.player.z = 10.4;
    Object.assign(still.enemies[0]!, { phase: 'windup', phaseT: 0.36, locked: true, lockedYaw: Math.PI });
    run(still, 24, { wait: true });
    expect(still.player.hp).toBeLessThan(PLAYER.maxHp);
  });

  it.each(['#', 'D'])('a committed guard cannot step through a wall or closed door: %s', barrier => {
    const rows = ['########', '#......#', '#......#', `#..${barrier}...#`, '#......#', '#..@...#', '#......#', '########'];
    const w = makeWorld(rows, [{ kind: 'guard', x: 3.5, z: 2.5, yaw: Math.PI }]);
    const g = w.enemies[0]!;
    Object.assign(g, { state: 'alert', phase: 'windup', phaseT: 0.36, locked: true, lockedYaw: Math.PI });
    w.advance(0.5);
    expect(g.z).toBeLessThanOrEqual(3 - g.radius + 1e-9);
    expect(w.grid.circleBlocked(g.x, g.z, g.radius)).toBe(false);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    if (barrier === 'D') expect(w.grid.doors[0]!.target).toBe(0);
  });

  it('paralysis freezes the step, and only the declared attack phases advance', () => {
    const w = kiteWorld('guard');
    const g = w.enemies[0]!;
    Object.assign(g, { phase: 'windup', paralyzeT: 1, phaseT: 0.36, locked: true, lockedYaw: Math.PI });
    const z = g.z;
    w.advance(0.5);
    expect(g.z).toBe(z);
    g.paralyzeT = 0;
    g.phase = 'recovery';
    g.phaseT = 0;
    w.advance(0.3);
    expect(g.z).toBe(z);
  });

  it('guard windup holds position, followed by at most one 0.9 m active step', () => {
    const w = kiteWorld('guard');
    w.player.z = 12;
    const g = w.enemies[0]!;
    Object.assign(g, { phase: 'windup', phaseT: 0, locked: false });
    const z = g.z;
    w.advance(ENEMIES.guard.windup - 0.01);
    expect(g.z).toBe(z);
    w.advance(0.3);
    expect(g.z - z).toBeGreaterThan(0.8);
    expect(g.z - z).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(g.phase).toBe('recovery');
  });
});
