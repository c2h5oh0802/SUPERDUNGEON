import { describe, expect, it } from 'vitest';
import { CLASSES, ENEMIES, PROJECTILES, SHOVE, TIPS, WEAPONS, type PlayerClass } from '../src/config';
import { applyCounter, attackCommitted, counterThreat, deflectBolts, pushTarget } from '../src/sim/classSys';
import { wardenCrownClosed } from '../src/sim/enemySys';
import { startActions, updatePlayerAction } from '../src/sim/playerSys';
import { updateProjectiles } from '../src/sim/projectileSys';
import { emptyInput, type Projectile } from '../src/sim/types';
import { makeWorld, OPEN_ROOM } from './helpers';

const S = ENEMIES.warden;
type Move = 'cleave' | 'lance' | 'rush';

/** Explicit phase fixtures isolate the player-facing combat contracts. */
function setup(cls: PlayerClass = 'warrior', distance = 2.4) {
  const w = makeWorld(OPEN_ROOM, [{ kind: 'warden', x: 9.5, z: 14.5 - distance, yaw: Math.PI, state: 'idle', boss: true }], cls);
  const e = w.enemies[0]!;
  e.state = 'alert'; e.awareness = 1; e.seesPlayer = true;
  return { w, e };
}

function committed(move: Move, distance = 2.4) {
  const pair = setup('warrior', distance);
  const { e } = pair;
  e.warden!.attack = move;
  e.phase = move === 'lance' ? 'aim' : 'windup';
  e.phaseT = move === 'lance' ? S.lanceAim - S.lanceLockBefore : move === 'rush' ? S.rushWindup - S.rushLockBefore : S.cleaveWindup - S.cleaveLockBefore;
  e.locked = true; e.lockedYaw = e.yaw;
  e.aimPoint = { x: pair.w.player.x, y: 1.3, z: pair.w.player.z };
  return pair;
}

function shot(w: ReturnType<typeof setup>['w'], patch: Partial<Projectile> = {}) {
  const pos = { x: w.enemies[0]?.x ?? w.player.x, y: 1.1, z: (w.enemies[0]?.z ?? w.player.z) + 2 };
  const vel = { x: 0, y: 0, z: -40 };
  const p: Projectile = {
    id: w.nextId++, kind: 'arrow', owner: 'player', pos, vel, radius: PROJECTILES.arrow.radius,
    gravity: 0, age: 0, alive: true, hitSet: new Set(), next: { ...pos }, avgVel: { ...vel },
    deflected: false, tip: null, payload: 'smoke', ...patch,
  };
  w.projectiles.push(p);
  return p;
}

describe('Warden Warrior counterplay', () => {
  it.each(['cleave', 'lance', 'rush'] as const)('%s is committed only after direction lock, and Counter opens one ordinary-damage stagger', move => {
    const { w, e } = committed(move);
    e.locked = false;
    expect(attackCommitted(e)).toBe(false);
    expect(counterThreat(w)).toBeNull();
    e.locked = true;
    expect(counterThreat(w)).toEqual({ kind: 'warden', id: e.id });
    const hp = e.hp;
    startActions(w, { ...emptyInput(), fire: true, firePressed: true });
    expect(w.player.action?.wardenCounter).toBe(true);
    expect(applyCounter(w, e)).toBe(true);
    expect(e.phase).toBe('stagger');
    expect(e.staggerDur).toBe(1.1);
    expect(e.phaseT).toBe(0);
    expect(e.warden!.attack).toBeNull();
    expect(e.locked).toBe(false);
    expect(e.aimPoint).toBeNull();
    expect(wardenCrownClosed(e)).toBe(false);
    expect(e.hp).toBe(hp);
    expect(applyCounter(w, e)).toBe(false);
    expect(w.stats.counters).toBe(1);
    expect(w.events).toContainEqual(expect.objectContaining({ type: 'counter', kind: 'warden', id: e.id }));
  });

  it.each([1 / 30, 1 / 60, 1 / 120])('pressing the cue interrupts each tell before damage or a lance release at frame size %s', dt => {
    for (const move of ['cleave', 'lance', 'rush'] as const) {
      const { w, e } = committed(move);
      const hp = e.hp, playerHp = w.player.hp;
      expect(counterThreat(w)?.kind).toBe('warden');
      w.frame(dt, { ...emptyInput(), fire: true, firePressed: true, wait: true });
      for (let i = 0; i < 60 && w.player.action; i++) w.frame(dt, { ...emptyInput(), wait: true });
      expect(w.stats.counters).toBe(1);
      expect(e.hp).toBe(hp - WEAPONS.longsword.damage);
      expect(w.player.hp).toBe(playerHp);
      expect(e.phase).toBe('stagger');
      expect(w.projectiles).toHaveLength(0);
    }
  });

  it.each(['cleave', 'lance', 'rush'] as const)('does not offer a late %s cue when the fast swing cannot arrive in time', move => {
    const { w, e } = committed(move);
    e.phaseT = (move === 'lance' ? S.lanceAim : move === 'rush' ? S.rushWindup : S.cleaveWindup) - .03;
    expect(counterThreat(w)).toBeNull();
  });

  it.each([1 / 30, 1 / 60, 1 / 120])('the live rush cue produces a safe counter at frame size %s', dt => {
    const { w, e } = committed('rush', 3);
    e.phase = 'charge'; e.phaseT = 0; e.chargeDist = 0;
    const playerHp = w.player.hp;
    expect(counterThreat(w)).toEqual({ kind: 'warden', id: e.id });
    w.frame(dt, { ...emptyInput(), fire: true, firePressed: true, wait: true });
    for (let i = 0; i < 60 && w.player.action; i++) w.frame(dt, { ...emptyInput(), wait: true });
    expect(w.stats.counters).toBe(1);
    expect(w.player.hp).toBe(playerHp);
    expect(e.phase).toBe('stagger');
  });

  it.each([2.4, 3])('does not promise a Counter when the rush will finish before the sword connects at %s m', distance => {
    const { w, e } = committed('rush', distance);
    e.phase = 'charge'; e.phaseT = 0; e.chargeDist = S.rushDist - .1;
    expect(counterThreat(w)).toBeNull();
    w.frame(1 / 60, { ...emptyInput(), fire: true, firePressed: true, wait: true });
    expect(w.player.action?.counter).toBe(false);
    for (let i = 0; i < 60 && w.player.action; i++) w.frame(1 / 60, { ...emptyInput(), wait: true });
    expect(w.stats.counters).toBe(0);
    expect(e.phase).toBe('recovery');
  });

  it.each(['pillar', 'body'] as const)('does not promise a Counter before an imminent rush stop on a %s', obstacle => {
    const { w, e } = committed('rush', 2.4);
    e.phase = 'charge'; e.phaseT = 0; e.chargeDist = 0;
    expect(counterThreat(w)).toEqual({ kind: 'warden', id: e.id });
    // Both obstacles miss the player's sight line, and the boss remains the nearest melee target.
    if (obstacle === 'pillar') w.grid.addPillar({ x: e.x + .75, z: e.z + .3, r: .3, h: 4.5, kind: 'pillar' });
    else w.enemies.push({ ...e, id: w.nextId++, kind: 'guard', boss: false, warden: null,
      x: e.x + .94, z: e.z + .2, radius: ENEMIES.guard.radius, state: 'idle', phase: 'none', locked: false });
    expect(counterThreat(w)).toBeNull();
    w.frame(1 / 60, { ...emptyInput(), fire: true, firePressed: true, wait: true });
    expect(w.player.action?.counter).toBe(false);
    for (let i = 0; i < 60 && w.player.action; i++) w.frame(1 / 60, { ...emptyInput(), wait: true });
    expect(w.stats.counters).toBe(0);
  });

  it('accounts for finite paralysis and chill when predicting the remaining rush window', () => {
    const { w, e } = committed('rush', 2.4);
    e.phase = 'charge'; e.phaseT = 0; e.chargeDist = S.rushDist - .3;
    expect(counterThreat(w)).toBeNull();
    e.slowT = 1;
    expect(counterThreat(w)).toEqual({ kind: 'warden', id: e.id });
    e.slowT = 0; e.paralyzeT = 1; e.chargeDist = S.rushDist - .1;
    expect(counterThreat(w)).toEqual({ kind: 'warden', id: e.id });
    // A distant paralyzed body will not enter reach during this swing.
    e.z = w.player.z - 3;
    expect(counterThreat(w)).toBeNull();
  });

  it('does not advertise active-cleave, too-close rush, off-line rush, or Huntress counters', () => {
    const { w, e } = committed('cleave');
    e.phase = 'active';
    expect(attackCommitted(e)).toBe(false);
    expect(counterThreat(w)).toBeNull();
    e.warden!.attack = 'rush'; e.phase = 'charge'; e.z = w.player.z - 1;
    expect(counterThreat(w)).toBeNull();
    e.z = w.player.z - 2.4; e.lockedYaw = Math.PI / 2;
    expect(counterThreat(w)).toBeNull();
    e.lockedYaw = Math.PI; w.player.cls = 'huntress';
    expect(counterThreat(w)).toBeNull();
    expect(applyCounter(w, e)).toBe(false);
  });

  it('shove only displaces a locked tell and never selects a live rush', () => {
    const { w, e } = committed('cleave', 1.5);
    const phaseT = e.phaseT, hp = e.hp;
    expect(pushTarget(w)).toBe(e);
    startActions(w, { ...emptyInput(), shield: true });
    updatePlayerAction(w, .05);
    expect(e.push?.left).toBe(SHOVE.pushDist);
    expect(e.phase).toBe('windup');
    expect(e.phaseT).toBe(phaseT);
    expect(e.locked).toBe(true);
    expect(e.hp).toBe(hp);
    e.push = null; e.warden!.attack = 'rush'; e.phase = 'charge';
    expect(pushTarget(w)).toBeNull();
  });
});

describe('Warden crown and Huntress counterplay', () => {
  it.each(['none', 'windup', 'aim', 'active', 'charge'] as const)('closed crown bounces frontal heads during %s and returns recoverable ammo', phase => {
    for (const kind of ['arrow', 'stone'] as const) {
      const { w, e } = setup('huntress');
      w.player.talents = ['mark']; e.phase = phase;
      const hp = e.hp;
      shot(w, { kind, pos: { x: e.x, y: S.headY, z: e.z + 2 }, radius: PROJECTILES[kind].radius });
      updateProjectiles(w, .1);
      expect(e.hp).toBe(hp);
      expect(e.huntingMarkUntil ?? 0).toBe(0);
      expect(e.lodged).toBe(0);
      expect(w.stats.shotHits).toBe(0);
      expect(w.pickups.filter(p => p.kind === (kind === 'arrow' ? 'arrows' : 'stone'))).toHaveLength(1);
      expect(w.events).toContainEqual(expect.objectContaining({ type: 'helmet', kind: 'warden', source: kind, head: true }));
    }
  });

  it.each(['recovery', 'stagger'] as const)('%s exposes frontal heads without a damage multiplier', phase => {
    const { w, e } = setup('huntress'); e.phase = phase;
    const hp = e.hp;
    shot(w, { pos: { x: e.x, y: S.headY, z: e.z + 2 } });
    updateProjectiles(w, .1);
    expect(e.hp).toBe(hp - PROJECTILES.arrow.head);
    expect(e.lodged).toBe(1);
    expect(w.events.some(event => event.type === 'helmet')).toBe(false);
  });

  it('closed crown leaves the body and flanking head shots vulnerable', () => {
    const { w, e } = setup('huntress'); e.phase = 'aim';
    const hp = e.hp;
    shot(w); updateProjectiles(w, .1);
    expect(e.hp).toBe(hp - PROJECTILES.arrow.body);
    shot(w, { pos: { x: e.x + 2, y: S.headY, z: e.z }, vel: { x: -40, y: 0, z: 0 } });
    updateProjectiles(w, .1);
    expect(e.hp).toBe(hp - PROJECTILES.arrow.body - PROJECTILES.arrow.head);
  });

  it.each(['paralysis', 'chill'] as const)('%s applies and refreshes normally on the body, without changing Hunting Mark', tip => {
    const { w, e } = committed('lance');
    w.player.cls = 'huntress'; w.player.talents = ['mark'];
    shot(w); updateProjectiles(w, .1);
    const mark = e.huntingMarkUntil;
    expect(mark).toBe(3);
    expect(e.phase).toBe('aim');
    e.paralyzeT = .1; e.slowT = .1;
    shot(w, { tip }); updateProjectiles(w, .1);
    expect(tip === 'paralysis' ? e.paralyzeT : e.slowT).toBe(TIPS[tip].duration);
    expect(e.huntingMarkUntil).toBe(mark);
    expect(e.phase).toBe('aim');
    expect(w.stats.tipHits).toBe(1);
  });

  it('a tipped crown bounce cannot apply status or create a mark', () => {
    const { w, e } = setup('huntress');
    w.player.talents = ['mark']; e.phase = 'aim';
    shot(w, { pos: { x: e.x, y: S.headY, z: e.z + 2 }, tip: 'paralysis' });
    updateProjectiles(w, .1);
    expect(e.paralyzeT).toBe(0);
    expect(e.huntingMarkUntil ?? 0).toBe(0);
    expect(w.stats.tipHits).toBe(0);
    expect(w.pickups.filter(p => p.kind === 'arrows')).toHaveLength(1);
  });
});

describe('Warden lance uses ordinary bolt collision and Deflect', () => {
  it.each([1 / 60, 2])('expires at the advertised range before resolving a hit beyond it with a %s-second step', dt => {
    const rows = Array.from({ length: 28 }, (_, i) => i === 0 || i === 27 ? '#'.repeat(20) : '#..................#');
    const w = makeWorld(rows, [], 'huntress');
    w.player.x = 9.5; w.player.z = 19.6;
    const hp = w.player.hp;
    const p = shot(w, { kind: 'bolt', owner: 999, damage: S.damage, source: '守心者的心槍', lifetime: S.lanceRange / S.lanceSpeed,
      pos: { x: 9.5, y: 1.3, z: 3 }, vel: { x: 0, y: 0, z: S.lanceSpeed }, radius: S.lanceRadius });
    for (let t = 0; t < 2 && p.alive; t += dt) updateProjectiles(w, dt);
    expect(p.alive).toBe(false);
    expect(p.pos.z).toBeCloseTo(3 + S.lanceRange, 8);
    expect(w.player.hp).toBe(hp);
    expect(w.projectiles).toHaveLength(0);
  });

  it.each([.0189, .07, .095, .097])('does not promise Deflect when a capped lance expires before contact (%s s left)', remaining => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    shot(w, { kind: 'bolt', owner: 999, lifetime: S.lanceRange / S.lanceSpeed,
      age: S.lanceRange / S.lanceSpeed - remaining,
      pos: { x: w.player.x, y: 1.3, z: w.player.z - 4 }, vel: { x: 0, y: 0, z: S.lanceSpeed }, radius: S.lanceRadius });
    expect(counterThreat(w)).toBeNull();
  });

  it('does not promise a capped-lance Deflect outside the current weapon/haste active window', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    w.player.weapon.id = 'knife';
    shot(w, { kind: 'bolt', owner: 999, lifetime: S.lanceRange / S.lanceSpeed,
      pos: { x: w.player.x, y: 1.3, z: w.player.z - 5 }, vel: { x: 0, y: 0, z: S.lanceSpeed }, radius: S.lanceRadius });
    expect(counterThreat(w)).toBeNull();
    w.player.weapon.id = 'longsword'; w.player.hasteT = 10;
    expect(counterThreat(w)).toBeNull();
  });

  it('does not change ordinary projectiles final-frame collision before legacy expiry', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    w.player.z = 3;
    const hp = w.player.hp;
    shot(w, { kind: 'bolt', owner: 999, age: PROJECTILES.maxLife - .01,
      pos: { x: w.player.x, y: 1.3, z: 1 }, vel: { x: 0, y: 0, z: 18 } });
    updateProjectiles(w, .2);
    expect(w.player.hp).toBe(hp - PROJECTILES.bolt.damage);
  });

  it('still hits an ordinary target before the advertised range ends', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    const hp = w.player.hp;
    shot(w, { kind: 'bolt', owner: 999, damage: S.damage, source: '守心者的心槍', lifetime: S.lanceRange / S.lanceSpeed,
      pos: { x: w.player.x, y: 1.3, z: 3 }, vel: { x: 0, y: 0, z: S.lanceSpeed }, radius: S.lanceRadius });
    updateProjectiles(w, 2);
    expect(w.player.hp).toBe(hp - Math.max(1, S.damage - w.armorReduce()));
  });

  it.each(['dead', 'removed'] as const)('retains damage and player-facing cause after its owner is %s', ownerState => {
    const { w, e } = setup('huntress', 6);
    w.player.armor = { id: 'cloth', level: 0 };
    const hp = w.player.hp;
    shot(w, { kind: 'bolt', owner: e.id, damage: S.damage, source: '守心者的心矛',
      pos: { x: w.player.x, y: 1.3, z: w.player.z - 2 }, vel: { x: 0, y: 0, z: S.lanceSpeed } });
    e.alive = false;
    if (ownerState === 'removed') w.enemies.splice(0);
    updateProjectiles(w, .2);
    expect(w.player.hp).toBe(hp - S.damage);
    expect(w.stats.damageTaken['守心者的心矛']).toBe(S.damage);
  });

  it('uses the override on the first friendly body without player shot credit', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 11.5, state: 'idle' }]);
    const e = w.enemies[0]!, hp = e.hp;
    shot(w, { kind: 'bolt', owner: 999, damage: S.damage, source: '守心者的心矛' });
    updateProjectiles(w, .1);
    expect(e.hp).toBe(hp - S.damage);
    expect(w.stats.shotHits).toBe(0);
    expect(w.events).toContainEqual(expect.objectContaining({ type: 'hitEnemy', source: 'friendlyBolt', amount: S.damage }));
  });

  it('Deflect clears hostile overrides and returns an ordinary player bolt', () => {
    const { w, e } = setup('warrior', 3); e.phase = 'recovery';
    const hp = e.hp;
    const p = shot(w, { kind: 'bolt', owner: e.id, damage: 99, source: '守心者的心矛', lifetime: .01,
      pos: { x: w.player.x, y: 1.3, z: w.player.z - 1 }, vel: { x: 0, y: 0, z: S.lanceSpeed } });
    startActions(w, { ...emptyInput(), fire: true, firePressed: true });
    expect(deflectBolts(w)).toBe(1);
    expect(p.owner).toBe('player');
    expect(p.damage).toBeUndefined();
    expect(p.source).toBeUndefined();
    expect(p.lifetime).toBeUndefined();
    updateProjectiles(w, .2);
    expect(e.hp).toBe(hp - CLASSES.warrior.deflectBody);
    expect(w.stats.deflects).toBe(1);
    expect(w.events).toContainEqual(expect.objectContaining({ type: 'hitEnemy', source: 'deflect', amount: CLASSES.warrior.deflectBody }));
  });

  it.each([1 / 30, 1 / 60, 1 / 120])('the incoming lance cue deflects through normal frame input at %s', dt => {
    const { w, e } = setup('warrior', 4); e.phase = 'recovery';
    const hp = w.player.hp;
    const p = shot(w, { kind: 'bolt', owner: e.id, damage: S.damage, source: '守心者的心槍', lifetime: S.lanceRange / S.lanceSpeed,
      pos: { x: w.player.x, y: 1.3, z: w.player.z - 1.5 }, vel: { x: 0, y: 0, z: S.lanceSpeed } });
    expect(counterThreat(w)).toEqual({ kind: 'bolt', id: p.id });
    w.frame(dt, { ...emptyInput(), fire: true, firePressed: true, wait: true });
    for (let i = 0; i < 60 && w.player.action; i++) w.frame(dt, { ...emptyInput(), wait: true });
    expect(w.stats.deflects).toBe(1);
    expect(w.player.hp).toBe(hp);
    expect(p.owner).toBe('player');
    expect(p.damage).toBeUndefined();
    expect(w.lastAction?.countered).toBe(true);
  });
});
