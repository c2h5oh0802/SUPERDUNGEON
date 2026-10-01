import { describe, expect, it, vi } from 'vitest';
import { PLAYER, STEALTH, TALENT_FX } from '../src/config';
import { forwardFromYaw } from '../src/core/math';
import { becomeAlert, updateEnemies } from '../src/sim/enemySys';
import { setDoor } from '../src/sim/propSys';
import { expireSenses, MAX_SOUND_CUES, soundSector } from '../src/sim/senses';
import type { GameEvent, GameEventType } from '../src/sim/types';
import { OPEN_ROOM, makeWorld, run } from './helpers';

const WALL_ROOM = OPEN_ROOM.map((row, z) => z === 10 ? '#'.repeat(row.length) : row);
const DOOR_ROOM = WALL_ROOM.map((row, z) => z === 10 ? '#########D##########' : row);

function hiddenWorld(state: 'idle' | 'sleep' = 'idle') {
  const w = makeWorld(WALL_ROOM, [{ kind: 'guard', x: 9.5, z: 8.5, state }], 'huntress');
  w.player.talents.push('senses');
  return w;
}

function sound(w: ReturnType<typeof hiddenWorld>, type: GameEventType = 'enemyWindup', extra: Partial<GameEvent> = {}): void {
  const e = w.enemies[0]!;
  w.emit({ type, id: e.id, x: e.x, y: e.y, z: e.z, ...extra });
}

describe('Keen Senses: event-driven, approximate sound memory', () => {
  it('silent nearby idle and sleeping enemies produce no cue or reveal', () => {
    for (const state of ['idle', 'sleep'] as const) {
      const w = hiddenWorld(state);
      run(w, 180, { wait: true });
      expect(w.senses).toEqual([]);
      expect(w.enemies[0]!.state).toBe(state);
      expect(w.drainEvents().some((e) => e.type === 'enemyStep')).toBe(false);
    }
  });

  it.each(['enemyStep', 'enemyWindup', 'enemyLock', 'enemyStrike', 'enemyFire'] as const)(
    '%s from an unseen nearby enemy produces only a direction and a 1.2-real-second expiry', (type) => {
      const w = hiddenWorld();
      w.realTime = 4;
      sound(w, type);
      expect(w.senses).toEqual([{ sector: 0, expiresAt: 5.2 }]);
      expect(Object.keys(w.senses[0]!).sort()).toEqual(['expiresAt', 'sector']);
    },
  );

  it('visible enemies produce no sound cue, even when their sounds are emitted', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 8.5 }], 'huntress');
    w.player.talents.push('senses');
    sound(w);
    expect(w.senses).toEqual([]);
  });

  it('reuses smoke-aware World.canSee rather than adding another perception model', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 8.5 }], 'huntress');
    w.player.talents.push('senses');
    w.smokes.push({ id: w.nextId++, x: 9.5, y: 1.2, z: 11.5, radius: 2, age: 1, air: false });
    const spy = vi.spyOn(w, 'canSee');
    sound(w);
    expect(spy).toHaveBeenCalledWith({ x: 9.5, y: PLAYER.eyeHeight, z: 14.5 },
      { x: 9.5, y: w.enemies[0]!.height - 0.2, z: 8.5 });
    expect(w.senses).toHaveLength(1);
  });

  it('includes exactly 12 m and rejects an enemy or sound origin beyond that limit', () => {
    const w = hiddenWorld();
    const e = w.enemies[0]!;
    e.z = w.player.z - TALENT_FX.sensesRange;
    sound(w);
    expect(w.senses).toHaveLength(1);
    w.senses = [];
    e.z -= 0.001;
    sound(w);
    expect(w.senses).toEqual([]);
    sound(w, 'enemyStep', { z: w.player.z - 1 });
    expect(w.senses).toEqual([]);
    e.z = 8.5;
    sound(w, 'enemyStep', { z: w.player.z - 12.001 });
    expect(w.senses).toEqual([]);
  });

  it('requires the Huntress talent, a living listener and an awake living emitter', () => {
    const w = hiddenWorld();
    w.player.talents = [];
    sound(w);
    expect(w.senses).toEqual([]);
    w.player.talents.push('senses');
    w.player.cls = 'warrior';
    sound(w);
    expect(w.senses).toEqual([]);
    w.player.cls = 'huntress';
    w.player.dead = true;
    sound(w);
    expect(w.senses).toEqual([]);
    w.player.dead = false;
    w.enemies[0]!.state = 'sleep';
    sound(w);
    expect(w.senses).toEqual([]);
    w.enemies[0]!.state = 'idle';
    w.enemies[0]!.alive = false;
    sound(w);
    expect(w.senses).toEqual([]);
  });

  it('does not treat state changes, generic noise, or player actions as enemy sounds', () => {
    const w = hiddenWorld();
    for (const type of ['suspicious', 'wakeUp', 'alert', 'hitEnemy', 'fire', 'swing', 'door', 'noise'] as const) {
      sound(w, type, { source: type === 'noise' ? 'impact' : 'enemy' });
    }
    sound(w, 'noise', { source: 'step' });
    sound(w, 'noise', { source: 'door', id: undefined });
    sound(w, 'noise', { source: 'shout', id: -999 });
    expect(w.senses).toEqual([]);
  });

  it('uses the existing attributed enemy door noise, without confusing door and enemy IDs', () => {
    for (const by of ['enemy', 'player'] as const) {
      const w = makeWorld(DOOR_ROOM, [{ kind: 'guard', x: 9.5, z: 8.5 }], 'huntress');
      w.player.talents.push('senses');
      const emitterId = by === 'enemy' ? w.enemies[0]!.id : undefined;
      expect(setDoor(w, 0, true, by, emitterId)).toBe(true);
      expect(w.senses).toHaveLength(by === 'enemy' ? 1 : 0);
      const noise = w.drainEvents().find((e) => e.type === 'noise' && e.source === 'door')!;
      expect(noise.id).toBe(emitterId);
    }
  });

  it('reuses an actual shout once, with no continuous alert-state refresh', () => {
    const w = hiddenWorld();
    becomeAlert(w, w.enemies[0]!);
    expect(w.senses).toHaveLength(1);
    const first = { ...w.senses[0]! };
    w.realTime = 0.5;
    becomeAlert(w, w.enemies[0]!);
    expect(w.senses).toEqual([first]);
    expect(w.drainEvents().filter((e) => e.type === 'noise' && e.source === 'shout')).toHaveLength(1);
  });

  it('expires by real time during slow-motion idle, with no hidden-enemy refresh', () => {
    const w = hiddenWorld();
    sound(w);
    run(w, 60);
    expect(w.senses).toHaveLength(1);
    run(w, 13);
    expect(w.realTime).toBeGreaterThan(TALENT_FX.sensesCueSeconds);
    expect(w.time).toBeLessThan(0.2);
    expect(w.senses).toEqual([]);
  });

  it('expires at the exact deadline and clears when the talent or listener is lost', () => {
    const w = hiddenWorld();
    sound(w);
    w.realTime = TALENT_FX.sensesCueSeconds;
    expireSenses(w);
    expect(w.senses).toEqual([]);
    sound(w);
    w.player.talents = [];
    expireSenses(w);
    expect(w.senses).toEqual([]);
    w.player.talents.push('senses');
    sound(w);
    w.player.dead = true;
    expireSenses(w);
    expect(w.senses).toEqual([]);
  });

  it('retains a snapshot instead of following subsequent enemy/player movement or health', () => {
    const w = hiddenWorld();
    sound(w);
    const snapshot = { ...w.senses[0]! };
    w.enemies[0]!.x += 3;
    w.enemies[0]!.hp = 1;
    w.player.yaw = Math.PI;
    w.player.x -= 2;
    w.realTime += 0.1;
    expireSenses(w);
    expect(w.senses).toEqual([snapshot]);
  });

  it('merges same-sector sounds and caps simultaneous cues, keeping the newest sectors', () => {
    const w = hiddenWorld();
    vi.spyOn(w, 'canSee').mockReturnValue(false);
    w.player.z = 9.5;
    for (let sector = 0; sector < 8; sector++) {
      const f = forwardFromYaw(sector * Math.PI / 4);
      w.enemies[0]!.x = w.player.x + f.x * 4;
      w.enemies[0]!.z = w.player.z + f.z * 4;
      w.realTime = sector * 0.1;
      sound(w);
      sound(w, 'enemyLock');
      expect(w.senses.length).toBeLessThanOrEqual(MAX_SOUND_CUES);
    }
    expect(w.senses.map((cue) => cue.sector)).toEqual([4, 5, 6, 7]);
    w.realTime = 0.9;
    sound(w);
    expect(w.senses).toHaveLength(4);
    expect(w.senses.at(-1)!.expiresAt).toBeCloseTo(2.1);
  });
});

describe('sound direction quantization', () => {
  it('quantizes every bearing into only eight sectors, without leaking angle or distance', () => {
    const seen = new Set<number>();
    for (let degree = 0; degree < 360; degree++) {
      const direction = forwardFromYaw(degree * Math.PI / 180);
      const sector = soundSector(direction.x, direction.z, 0);
      seen.add(sector);
      expect(Number.isInteger(sector)).toBe(true);
      expect(soundSector(direction.x * 11, direction.z * 11, 0)).toBe(sector);
    }
    expect([...seen].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('uses the player facing at the event and wraps the rear seam correctly', () => {
    expect(soundSector(0, -4, 0)).toBe(0);
    expect(soundSector(-4, 0, 0)).toBe(2);
    expect(soundSector(0, 4, 0)).toBe(4);
    expect(soundSector(4, 0, 0)).toBe(6);
    expect(soundSector(-4, 0, Math.PI / 2)).toBe(0);
    expect(soundSector(-0.01, 4, 0)).toBe(4);
    expect(soundSector(0.01, 4, 0)).toBe(4);
    expect(soundSector(0, -4, Math.PI * 2)).toBe(0);
  });
});

describe('enemy footsteps use actual movement', () => {
  it('emits bounded steps only after traveling a full stride and never alerts another enemy', () => {
    const w = makeWorld(WALL_ROOM, [
      { kind: 'guard', x: 4.5, z: 8.5, state: 'patrol', patrol: [{ x: 14.5, z: 8.5 }] },
      { kind: 'guard', x: 8.5, z: 6.5, state: 'sleep' },
    ], 'huntress');
    w.player.talents.push('senses');
    const e = w.enemies[0]!;
    let distance = 0;
    let steps = 0;
    for (let tick = 0; tick < 240; tick++) {
      const x = e.x, z = e.z;
      updateEnemies(w, 1 / 60);
      distance += Math.hypot(e.x - x, e.z - z);
      const events = w.drainEvents();
      steps += events.filter((event) => event.type === 'enemyStep').length;
      expect(steps).toBeLessThanOrEqual(Math.floor((distance + 1e-9) / STEALTH.footstepEvery));
      expect(events.filter((event) => event.type === 'noise')).toEqual([]);
    }
    expect(steps).toBe(Math.floor(distance / STEALTH.footstepEvery));
    expect(steps).toBeGreaterThan(3);
    expect(w.enemies[1]!.state).toBe('sleep');
    expect(w.senses.length).toBeGreaterThan(0);
    expect(w.senses.length).toBeLessThanOrEqual(MAX_SOUND_CUES);
  });

  it('turning, stationary attack preparation, paralysis, and blocked paths produce no steps', () => {
    for (const mode of ['turn', 'windup', 'paralyze', 'blocked'] as const) {
      const w = hiddenWorld();
      const e = w.enemies[0]!;
      if (mode === 'turn') e.yaw = Math.PI;
      if (mode === 'windup') {
        e.state = 'alert'; e.phase = 'windup'; e.locked = true; e.phaseT = -10;
      }
      if (mode === 'paralyze') {
        e.paralyzeT = 10; e.state = 'patrol'; e.patrol = [{ x: 14.5, z: 8.5 }];
      }
      if (mode === 'blocked') {
        e.state = 'patrol'; e.patrol = [{ x: 9.5, z: 14.5 }];
      }
      for (let tick = 0; tick < 60; tick++) updateEnemies(w, 1 / 60);
      expect(w.drainEvents().filter((event) => event.type === 'enemyStep'), mode).toEqual([]);
      expect(w.senses, mode).toEqual([]);
    }
  });
});
