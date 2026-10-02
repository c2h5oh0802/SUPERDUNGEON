import { describe, expect, it } from 'vitest';
import { ENEMIES, PLAYER, TIPS } from '../src/config';
import { forwardFromYaw } from '../src/core/math';
import { damageEnemy, lullEnemy, staggerEnemy, updateEnemies, wardenCrownClosed } from '../src/sim/enemySys';
import { T } from '../src/sim/grid';
import { makeWorld, OPEN_ROOM } from './helpers';

const DT = 1 / 120;
function fixture(distance = 6, rows = OPEN_ROOM) {
  const w = makeWorld(rows, [{ kind: 'warden', x: 9.5, z: 7.5, yaw: Math.PI, boss: true }]);
  Object.assign(w.player, { x: 9.5, z: 7.5 + distance });
  const e = w.enemies[0]!;
  Object.assign(e, { state: 'alert', seesPlayer: true, awareness: 1, lastKnown: { x: w.player.x, z: w.player.z }, percT: 0 });
  return { w, e };
}
function ticks(w: ReturnType<typeof makeWorld>, seconds: number) {
  for (let k = 0; k < Math.ceil(seconds / DT - 1e-8); k++) updateEnemies(w, DT);
}
function until(w: ReturnType<typeof makeWorld>, predicate: () => boolean, max = 5) {
  for (let k = 0; k < max / DT; k++) { if (predicate()) return; updateEnemies(w, DT); }
  throw new Error('Expected phase was not reached');
}

describe('Heart Warden committed attack state machine', () => {
  it('lance telegraphs, locks a point and yaw, fires once at old point, then fully recovers', () => {
    const { w, e } = fixture();
    until(w, () => e.phase === 'aim' && e.locked);
    const aim = { ...e.aimPoint! }, yaw = e.lockedYaw;
    expect(e.phaseT).toBeCloseTo(ENEMIES.warden.lanceAim - ENEMIES.warden.lanceLockBefore, 2);
    w.player.x += 3; w.player.invisT = 10;
    ticks(w, .2);
    expect(e.aimPoint).toEqual(aim); expect(e.yaw).toBe(yaw);
    until(w, () => e.phase === 'recovery');
    expect(w.projectiles).toHaveLength(1); expect(w.projectiles[0]!.damage).toBe(4);
    const q = w.projectiles[0]!;
    expect(q.vel.x).toBeCloseTo(0); expect(q.vel.z).toBeGreaterThan(0);
    expect(wardenCrownClosed(e)).toBe(false);
    ticks(w, ENEMIES.warden.lanceRecovery - .02);
    expect(e.phase).toBe('recovery'); expect(w.projectiles).toHaveLength(1);
    expect(w.events.filter(x => x.type === 'enemyLock')).toHaveLength(1);
  });

  it('pre-lock invisibility/blocked sight pays recovery without acquiring hidden coordinates', () => {
    for (const conceal of ['invisible', 'smoke']) {
      const { w, e } = fixture(); ticks(w, .2);
      const known = { ...e.lastKnown! };
      w.player.x += 4; e.percT = 1;
      if (conceal === 'invisible') w.player.invisT = 20;
      else w.smokes.push({ id: 900, x: 10.5, y: 1.2, z: 10.5, radius: 4, age: 0, air: false });
      ticks(w, DT);
      expect(e.phase).toBe('recovery'); expect(e.aimPoint).toBeNull(); expect(e.lastKnown).toEqual(known);
      expect(w.projectiles).toHaveLength(0);
    }
  });

  it('hidden relocation cannot change pursuit of the same last-known position', () => {
    const left = fixture(), right = fixture();
    for (const pair of [left, right]) {
      pair.w.player.invisT = 20;
      pair.e.lastKnown = { x: 13.5, z: 7.5 }; pair.e.seesPlayer = false;
    }
    left.w.player.x = 3; right.w.player.x = 17;
    ticks(left.w, 4); ticks(right.w, 4);
    expect(left.e.x).toBeCloseTo(right.e.x, 8); expect(left.e.z).toBeCloseTo(right.e.z, 8);
    expect(left.e.state).toBe('alert'); expect(right.e.state).toBe('alert');
    expect(left.w.projectiles).toHaveLength(0); expect(right.w.projectiles).toHaveLength(0);
  });

  it('cleave holds position, hits only its locked wedge once, and can be side-dodged', () => {
    for (const dodge of [false, true]) {
      const { w, e } = fixture(2.2), start = { x: 9.5, z: 7.5 };
      until(w, () => e.locked);
      expect(e.warden!.attack).toBe('cleave');
      if (dodge) { w.player.x = e.x + 2.2; w.player.z = e.z; }
      ticks(w, .6);
      expect(w.player.hp).toBe(PLAYER.maxHp - (dodge ? 0 : ENEMIES.warden.cleaveDamage));
      expect({ x: e.x, z: e.z }).toEqual(start); expect(e.phase).toBe('recovery');
    }
  });

  it('never strikes through a wall introduced after cleave commitment', () => {
    const { w, e } = fixture(2.2); until(w, () => e.locked);
    w.grid.set(9, 8, T.Wall);
    ticks(w, .6); expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('phase two waits for attack and complete recovery, then adds a bounded nonhoming rush', () => {
    const { w, e } = fixture(); until(w, () => e.locked);
    damageEnemy(w, e, e.maxHp * ENEMIES.warden.phaseThreshold, { source: 'arrow', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    expect(e.warden!.phaseTwo).toBe(false); expect(e.warden!.attack).toBe('lance');
    until(w, () => e.phase === 'recovery');
    ticks(w, ENEMIES.warden.lanceRecovery - .02);
    expect(e.warden!.phaseTwo).toBe(false); expect(e.phase).toBe('recovery');
    until(w, () => e.warden!.attack === 'rush' && e.locked);
    const start = { x: e.x, z: e.z }, yaw = e.lockedYaw;
    w.player.x += 3;
    until(w, () => e.phase === 'recovery');
    expect(e.yaw).toBe(yaw);
    expect(Math.hypot(e.x - start.x, e.z - start.z)).toBeCloseTo(ENEMIES.warden.rushDist, 5);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.events.filter(x => x.type === 'buff' && x.text?.includes('裂冠'))).toHaveLength(1);
    // A player still inside the new close-pressure band is approached. Move to
    // real ranged distance to isolate the alternating ranged selection rule.
    w.player.x = e.x + 6; w.player.z = e.z;
    until(w, () => e.phase === 'aim'); expect(e.warden!.attack).toBe('lance');
  });

  it('rush colliding with a closed door stops outside geometry and exposes the crown', () => {
    const rows = OPEN_ROOM.map((r, z) => z === 10 ? r.slice(0, 9) + 'D' + r.slice(10) : r);
    const { w, e } = fixture(6, rows), door = w.grid.doors[0]!;
    door.progress = 1; door.target = 1; e.hp = 16;
    until(w, () => e.locked); door.progress = 0; door.target = 0;
    w.player.x += 4;
    until(w, () => e.phase === 'stagger');
    expect(e.staggerDur).toBe(ENEMIES.warden.wallStagger);
    expect(w.grid.circleBlocked(e.x, e.z, e.radius)).toBe(false);
    expect(wardenCrownClosed(e)).toBe(false); expect(door.target).toBe(0);
  });

  it('paralysis freezes commitment; chill scales its clock; Sleep immunity does not cancel it', () => {
    const { w, e } = fixture(); until(w, () => e.locked);
    const snapshot = { t: e.phaseT, aim: { ...e.aimPoint! }, yaw: e.lockedYaw };
    e.paralyzeT = .5; ticks(w, .4); lullEnemy(e);
    expect(e.phaseT).toBe(snapshot.t); expect(e.aimPoint).toEqual(snapshot.aim); expect(e.pendingSleep).toBe(false);
    e.paralyzeT = 0; e.slowT = 4;
    ticks(w, .2); expect(e.phaseT - snapshot.t).toBeCloseTo(.2 * TIPS.chill.timeScale, 7);
    expect(e.lockedYaw).toBe(snapshot.yaw);
    until(w, () => e.phase === 'recovery'); expect(w.projectiles).toHaveLength(1);
  });

  it('explicit stagger cancels target and gives an exposed interval; ordinary damage does not interrupt', () => {
    const { w, e } = fixture(); until(w, () => e.locked);
    damageEnemy(w, e, 3, { source: 'arrow', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    expect(e.locked).toBe(true);
    staggerEnemy(e, 1.1);
    expect(e.aimPoint).toBeNull(); expect(e.warden!.attack).toBeNull(); expect(wardenCrownClosed(e)).toBe(false);
    ticks(w, 1); expect(e.phase).toBe('stagger'); expect(w.projectiles).toHaveLength(0);
  });

  it('death cancels the outstanding telegraph without firing a last shot', () => {
    const { w, e } = fixture(); until(w, () => e.locked);
    damageEnemy(w, e, 100, { source: 'melee', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    ticks(w, 2); expect(e.alive).toBe(false); expect(e.aimPoint).toBeNull(); expect(e.locked).toBe(false);
    expect(w.projectiles).toHaveLength(0);
  });

  it.each([30, 60, 120])('rush is bounded and committed at %i FPS through the world substep pipeline', (fps) => {
    const { w, e } = fixture(); e.hp = e.maxHp * ENEMIES.warden.phaseThreshold;
    let dodged = false;
    for (let k = 0; k < fps * 4; k++) {
      if (!dodged && e.locked && e.warden!.attack === 'rush') {
        dodged = true;
        const f = forwardFromYaw(e.lockedYaw); w.player.x = e.x - f.z * 3; w.player.z = e.z + f.x * 3;
      }
      w.advance(1 / fps);
      expect(e.chargeDist).toBeLessThanOrEqual(ENEMIES.warden.rushDist + 1e-8);
      expect(w.grid.circleBlocked(e.x, e.z, e.radius - 1e-7)).toBe(false);
      if (dodged && (e.phase === 'recovery' || e.phase === 'stagger')) break;
    }
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });
});
