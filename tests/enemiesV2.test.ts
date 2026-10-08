import { describe, expect, it } from 'vitest';
import { ENCOUNTERS, ENEMIES, PLAYER, XP } from '../src/config';
import { generateLevel, validateLevel } from '../src/gen/validate';
import { breakBottle } from '../src/sim/projectileSys';
import { counterThreat, deflectBolts, hunterEye } from '../src/sim/classSys';
import { damageEnemy, lullEnemy, updateEnemies } from '../src/sim/enemySys';
import { emptyInput } from '../src/sim/types';
import { World } from '../src/sim/world';
import { finishAction, makeWorld, OPEN_ROOM, run } from './helpers';

const SEEDS = Array.from({ length: 100 }, (_, i) => `EV2-${i}`);

describe('enemy roster in generated floors', () => {
  it('floors introduce rats, bombers, sentries, mimics and statues by depth; key carriers replace ground keys', () => {
    const seen: Record<number, Set<string>> = { 1: new Set(), 2: new Set(), 3: new Set(), 4: new Set() };
    let carriers = 0;
    for (const seed of SEEDS) for (let floor = 1; floor <= 4; floor++) {
      const l = generateLevel(seed, { floor });
      expect(validateLevel(l).errors).toEqual([]);
      for (const e of l.enemies) seen[floor]!.add(e.kind);
      expect(l.enemies.filter((e) => e.kind === 'sentry').length).toBeLessThanOrEqual(ENCOUNTERS.maxSentries);
      expect(l.enemies.filter((e) => e.kind === 'mimic').length).toBeLessThanOrEqual(1);
      const c = l.enemies.filter((e) => e.carriesKey);
      if (floor >= 2) {
        expect(c.length + l.pickups.filter((p) => p.kind === 'key').length).toBe(1);
        carriers += c.length;
        for (const e of c) expect(['guard', 'charger']).toContain(e.kind);
      }
      // 石像大廳：台座加一尊石像
      if ((l.specialRooms ?? []).some((r) => r.kind === 'statue')) expect(l.enemies.some((e) => e.kind === 'statue')).toBe(true);
    }
    expect(seen[1]).toContain('rat');
    expect(seen[1]).not.toContain('bomber');
    expect(seen[1]).not.toContain('sentry');
    expect(seen[1]).not.toContain('statue');
    for (const f of [2, 3, 4]) for (const k of ['rat', 'bomber', 'sentry', 'statue']) expect(seen[f], `F${f} ${k}`).toContain(k);
    expect(seen[3]).toContain('mimic');
    expect(carriers).toBeGreaterThan(SEEDS.length * 3 * 0.8);
  }, 120000);
});

describe('rats', () => {
  it('bite lightly with a short, counterable windup and die to one hit', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'rat', x: 9.5, z: 13.2, yaw: Math.PI }]);
    const r = w.enemies[0]!;
    expect(r.hp).toBe(ENEMIES.rat.hp);
    w.player.yaw = 0;
    run(w, 1);
    r.state = 'alert';
    r.awareness = 1;
    r.seesPlayer = true;
    updateEnemies(w, 1 / 60);
    expect(r.phase).toBe('windup');
    // 鎖定在 0.15 秒，揮下在 0.3 秒：中間這段可以反擊斬
    for (let k = 0; k < 20; k++) updateEnemies(w, 1 / 120);
    expect(r.locked).toBe(true);
    expect(counterThreat(w)?.kind).toBe('rat');
    const hp = w.player.hp;
    for (let k = 0; k < 120; k++) updateEnemies(w, 1 / 120);
    expect(w.player.hp).toBe(hp - ENEMIES.rat.damage);
    damageEnemy(w, r, 4, { source: 'melee', sneak: false, head: false, x: r.x, y: 0.4, z: r.z });
    expect(r.alive).toBe(false);
    expect(w.player.xp).toBe(XP.kill.rat);
  });

  it('a low wall hides you from a rat but not from a standing guard', () => {
    const rows = OPEN_ROOM.slice();
    rows[10] = '#==================#';
    const w = makeWorld(rows, [{ kind: 'rat', x: 9.5, z: 8.5, yaw: Math.PI }, { kind: 'guard', x: 12.5, z: 8.5, yaw: Math.PI }]);
    w.player.z = 12.5;
    for (const e of w.enemies) e.percT = 0;
    w.advance(0.1);
    expect(w.enemies[0]!.seesPlayer).toBe(false);
    expect(w.enemies[1]!.seesPlayer).toBe(true);
  });
});

describe('bombers and firebombs', () => {
  function bomberWorld(cls: 'warrior' | 'huntress' = 'warrior') {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'bomber', x: 9.5, z: 5.5, yaw: Math.PI }], cls);
    const b = w.enemies[0]!;
    b.state = 'alert';
    b.awareness = 1;
    return { w, b };
  }

  it('wind up, lock the landing point, then lob a visible bottle that sets fire there', () => {
    const { w, b } = bomberWorld();
    for (let k = 0; k < 140; k++) w.advance(1 / 120);
    expect(b.phase === 'aim' || b.phase === 'reload').toBe(true);
    for (let k = 0; k < 120 && !w.projectiles.length; k++) w.advance(1 / 120);
    const bottle = w.projectiles.find((p) => p.kind === 'bottle')!;
    expect(bottle.payload).toBe('firebomb');
    expect(bottle.owner).toBe(b.id);
    w.player.x += 3; // 側移避開
    for (let k = 0; k < 240 && bottle.alive; k++) w.advance(1 / 120);
    expect(bottle.alive).toBe(false);
    const fire = w.areas.find((a) => a.kind === 'fire')!;
    expect(Math.hypot(fire.x - 9.5, fire.z - 14.5)).toBeLessThan(1.6);
    // 火瓶不是藥水：不會讓你認得火焰藥水
    expect(w.player.known).not.toContain('potion:fire');
  });

  it('the huntress sees a lead marker on the flying firebomb, and an airburst burns where it bursts', () => {
    const { w, b } = bomberWorld('huntress');
    w.player.tool = 'bow';
    w.player.desiredTool = 'bow';
    for (let k = 0; k < 400 && !w.projectiles.length; k++) w.advance(1 / 120);
    const bottle = w.projectiles[0]!;
    w.advance(0.05);
    expect(hunterEye(w).some((m) => m.id === bottle.id)).toBe(true);
    breakBottle(w, bottle, { x: b.x, y: 2, z: b.z + 0.5 }, true);
    expect(w.stats.airbursts).toBe(1);
    const hp = b.hp;
    w.advance(0.6);
    expect(b.hp).toBeLessThan(hp);
  });

  it('a warrior swing bats the firebomb back toward the crosshair', () => {
    const { w } = bomberWorld();
    for (let k = 0; k < 400 && !w.projectiles.length; k++) w.advance(1 / 120);
    const bottle = w.projectiles[0]!;
    // 讓瓶子飛到劍的範圍內
    for (let k = 0; k < 400 && Math.hypot(bottle.pos.x - w.player.x, bottle.pos.z - w.player.z) > 1.6; k++) w.advance(1 / 240);
    w.player.yaw = 0;
    w.frame(1 / 60, { ...emptyInput(0, 0.2), fire: true, firePressed: true });
    for (let k = 0; k < 20 && bottle.owner !== 'player'; k++) {
      deflectBolts(w);
      w.advance(1 / 240);
    }
    expect(bottle.owner).toBe('player');
    expect(bottle.vel.z).toBeLessThan(0);
  });

  it('a firebomb landing on water only steams', () => {
    const { w } = bomberWorld();
    w.grid.setTerrain(9, 14, 2);
    const bottle = { id: 99, kind: 'bottle' as const, owner: w.enemies[0]!.id, pos: { x: 9.5, y: 0.2, z: 14.5 }, vel: { x: 0, y: 0, z: 0 }, radius: 0.16, gravity: 6, age: 0, alive: true,
      hitSet: new Set<number>(), next: { x: 9.5, y: 0.2, z: 14.5 }, avgVel: { x: 0, y: 0, z: 0 }, deflected: false, tip: null, payload: 'firebomb' as const };
    breakBottle(w, bottle, bottle.pos, false);
    expect(w.areas.some((a) => a.kind === 'fire')).toBe(false);
  });
});

describe('horn sentries', () => {
  it('a finished horn alerts the floor and pulls nearby enemies, including sleepers, to you', () => {
    const w = makeWorld(OPEN_ROOM, [
      { kind: 'sentry', x: 9.5, z: 6.5, yaw: Math.PI },
      { kind: 'guard', x: 3.5, z: 3.5, state: 'sleep' },
      { kind: 'guard', x: 16.5, z: 3.5, state: 'idle', yaw: 0 },
    ]);
    const s = w.enemies[0]!;
    s.state = 'alert';
    s.awareness = 1;
    w.advance(ENEMIES.sentry.hornWindup + 0.2);
    expect(s.hornUsed).toBe(true);
    expect(w.alarm).toBe(true);
    expect(w.enemies[1]!.state).not.toBe('sleep');
    expect(w.enemies[2]!.state).not.toBe('idle');
  });

  it('any hit before the horn finishes interrupts it', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'sentry', x: 9.5, z: 6.5, yaw: Math.PI }]);
    const s = w.enemies[0]!;
    s.state = 'alert';
    s.awareness = 1;
    w.advance(ENEMIES.sentry.hornWindup * 0.7);
    expect(s.phase).toBe('windup');
    damageEnemy(w, s, 1, { source: 'stone', sneak: false, head: false, x: s.x, y: 1, z: s.z });
    expect(s.phase).toBe('stagger');
    w.advance(ENEMIES.sentry.hornWindup * 0.5);
    expect(s.hornUsed).toBeFalsy();
    expect(w.alarm).toBe(false);
  });
});

describe('mimics', () => {
  function mimicWorld() {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'mimic', x: 9.5, z: 11.5, yaw: 0, loot: { ammo: 2, bottles: 0, items: [{ id: 'scroll:upgrade', level: 0 }] } }]);
    return { w, m: w.enemies[0]! };
  }

  it('look like a chest: no perception, no noise reaction, no sleep icon, and open like one', () => {
    const { w, m } = mimicWorld();
    expect(m.disguised).toBe(true);
    expect(m.state).toBe('sleep');
    w.emitNoise(m.x, 1, m.z, 20, 'test');
    expect(m.disguised).toBe(true);
    w.player.x = 9.5;
    w.player.z = 13.2;
    w.player.yaw = 0;
    run(w, 1);
    expect(w.interactTarget?.kind).toBe('mimic');
    run(w, 1, { interact: true });
    finishAction(w);
    expect(m.disguised).toBeFalsy();
    expect(m.state).toBe('alert');
  });

  it('wake when the player lingers right next to them, and spit out their loot on death', () => {
    const { w, m } = mimicWorld();
    w.player.x = 9.5;
    w.player.z = 12.6;
    w.advance(ENEMIES.mimic.wakeTime + 0.2);
    expect(m.disguised).toBeFalsy();
    damageEnemy(w, m, 99, { source: 'melee', sneak: false, head: false, x: m.x, y: 0.5, z: m.z });
    expect(w.pickups.some((p) => p.item === 'scroll:upgrade')).toBe(true);
    expect(w.pickups.some((p) => p.kind === 'ammo')).toBe(true);
  });

  it('cannot be put to sleep while disguised', () => {
    const { m } = mimicWorld();
    lullEnemy(m);
    expect(m.disguised).toBe(true);
  });
});

describe('statue guardians', () => {
  it('stay dormant until the pedestal treasure is taken, then fight; immune to ambush and sleep', () => {
    const level = (() => {
      for (const seed of SEEDS) for (let f = 2; f <= 4; f++) {
        const l = generateLevel(seed, { floor: f });
        if ((l.specialRooms ?? []).some((r) => r.kind === 'statue')) return l;
      }
      throw new Error('no statue hall');
    })();
    const w = new World(level);
    const st = w.enemies.find((e) => e.kind === 'statue')!;
    expect(st.dormant).toBe(true);
    w.advance(3);
    expect(st.x).toBe(level.enemies.find((e) => e.kind === 'statue')!.x);
    const ped = w.interactables.find((i) => i.kind === 'pedestal' && i.roomKey === st.roomKey)!;
    w.enemies.forEach((e) => { if (e !== st) e.alive = false; });
    w.player.x = ped.x;
    w.player.z = ped.z + 1.2;
    w.player.yaw = 0;
    run(w, 1);
    expect(w.interactTarget?.id).toBe(ped.id);
    run(w, 1, { interact: true });
    finishAction(w);
    expect(st.dormant).toBeFalsy();
    expect(st.state).toBe('alert');
    lullEnemy(st);
    expect(st.state).toBe('alert');
  });

  it('a hit wakes a dormant statue, and a sleeping-state ambush grants no bonus', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'statue', x: 9.5, z: 12.4, yaw: Math.PI }]);
    const st = w.enemies[0]!;
    w.player.yaw = 0;
    run(w, 1, { fire: true, firePressed: true });
    finishAction(w);
    expect(st.dormant).toBeFalsy();
    expect(w.stats.backstabs).toBe(0);
    expect(st.maxHp - st.hp).toBeLessThanOrEqual(4);
  });
});

describe('elite key carriers and reinforcements', () => {
  it('a killed key carrier drops the vault key; an armored elite takes 1 less damage', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 9.5, carriesKey: true, veteran: true, elite: 'armored' }]);
    const e = w.enemies[0]!;
    const hp = e.hp;
    damageEnemy(w, e, 3, { source: 'melee', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    expect(e.hp).toBe(hp - 2);
    damageEnemy(w, e, 99, { source: 'melee', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    expect(w.pickups.some((p) => p.kind === 'key' && !p.taken)).toBe(true);
  });

  it('a horn elite raises the alarm the moment it notices you', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 9.5, yaw: Math.PI, elite: 'horn' }, { kind: 'guard', x: 3.5, z: 3.5, state: 'sleep' }]);
    w.player.z = 13.5;
    w.advance(3);
    expect(w.enemies[0]!.state).toBe('alert');
    expect(w.alarm).toBe(true);
    expect(w.enemies[1]!.state).not.toBe('sleep');
  });

  it('lingering on a floor brings reinforcements down the stairs, capped per floor, never in your face', () => {
    const level = generateLevel('EV2-REIN', { floor: 2 });
    const w = new World(level);
    const n0 = w.enemies.length;
    w.player.invisT = 9999;
    // 站在入口：增援延後
    w.advance(ENCOUNTERS.reinforce.after + 1);
    expect(w.reinforcements).toBe(0);
    const far = level.rooms.find((r) => r.role === 'heart')!;
    w.player.x = far.x0 + far.w / 2;
    w.player.z = far.z0 + far.h / 2;
    w.enemies.forEach((e) => { e.alive = false; });
    w.advance(6);
    expect(w.reinforcements).toBe(1);
    expect(w.enemies.length).toBeGreaterThan(n0);
    // 從入口進來，第一站往玩家所在的區域
    const fresh = w.enemies.slice(n0);
    for (const e of fresh) {
      expect(Math.hypot(e.post.x - level.spawn.x, e.post.z - level.spawn.z)).toBeLessThan(1.5);
      const first = e.patrol[e.patrolIdx]!;
      const nearest = Math.min(...e.patrol.map((q) => Math.hypot(q.x - w.player.x, q.z - w.player.z)));
      expect(Math.hypot(first.x - w.player.x, first.z - w.player.z)).toBeCloseTo(nearest, 5);
    }
    w.advance(ENCOUNTERS.reinforce.every * 6);
    expect(w.reinforcements).toBe(ENCOUNTERS.reinforce.max);
  });

  it('legacy floors never reinforce', () => {
    const w = new World(generateLevel('EV2-LEG', { floor: 2, gen: 1 }));
    w.player.x += 0;
    w.advance(ENCOUNTERS.reinforce.after + ENCOUNTERS.reinforce.every * 2);
    expect(w.reinforcements).toBe(0);
    expect(PLAYER.maxHp).toBeGreaterThan(0);
  });
});
