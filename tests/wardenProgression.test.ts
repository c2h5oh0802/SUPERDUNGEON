import { describe, expect, it, vi } from 'vitest';
import { CLASSES, CLASS_KNOWLEDGE, ENEMIES, HUNGER, PLAYER, RUN } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { levelSignature } from '../src/gen/generator';
import { createTrialLevel, PRACTICE_TRIALS, trialForSeed } from '../src/gen/practiceTrials';
import { generateLevel, validateLevel } from '../src/gen/validate';
import { damageEnemy } from '../src/sim/enemySys';
import { addItem } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { findInteractTarget } from '../src/sim/playerSys';
import { createTrialWorld } from '../src/sim/practiceTrials';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput } from '../src/sim/types';
import { World } from '../src/sim/world';
import { finishAction } from './helpers';

function defeat(w: World): void {
  const e = w.enemies[0]!;
  damageEnemy(w, e, e.hp, { source: 'melee', sneak: false, head: false, x: e.x, y: 1, z: e.z });
  while (w.pendingChoice) w.resolveChoice(0);
}

function faceHeart(w: World): void {
  const h = w.level.heart!;
  w.player.x = h.x; w.player.z = h.z + 1.3;
  w.player.yaw = yawFromDir(h.x - w.player.x, h.z - w.player.z);
}

describe('single Warden final-floor contract', () => {
  it('has fixed 32 HP, a reachable arena/Heart and zero supplies across seeds and mirrors', () => {
    const mirrors = new Set<boolean>();
    for (let k = 0; k < 16; k++) {
      const l = generateLevel(`WARDEN-ARENA-${k}`, { floor: RUN.floors });
      const w = new World(l), e = w.enemies[0]!;
      mirrors.add(l.mirrored);
      expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
      expect(l.templateId).toBe('arena'); expect(l.goal).toBe('heart');
      expect(l.enemies).toHaveLength(1);
      expect(e).toMatchObject({ kind: 'warden', hp: 32, maxHp: 32, boss: true, veteran: false, state: 'idle', patrol: [] });
      expect(e.warden).toEqual({ attack: null, phaseTwo: false, rangedCount: 0 });
      expect(l.pickups).toEqual([]); expect(l.chests).toEqual([]); expect(l.traps).toEqual([]);
      expect(l.resupply).toBeNull(); expect(l.specialRooms).toEqual([]);
      expect(w.encounterState).toBe('dormant'); expect(w.heartAvailable).toBe(false);
      const nav = new Nav(l.grid, PLAYER.radius), seen = nav.flood(l.spawn.x, l.spawn.z, false);
      expect(seen[nav.nearestPassable(e.x, e.z)]).toBe(1);
      const h = l.heart!;
      expect(seen.some((reachable, cell) => reachable && Math.hypot(nav.center(cell).x - h.x, nav.center(cell).z - h.z) <= PLAYER.interactRange)).toBe(true);
    }
    expect(mirrors.size).toBe(2); expect(ENEMIES.warden.hp).toBe(32);
  });

  it.each(['warrior', 'huntress'] as const)('%s F5 save preserves carry but retries a fresh complete boss after runtime damage/phases/status/death', cls => {
    const run = newRun('WARDEN-SAVE5', cls);
    const before = createFloorWorld({ ...run, floor: 4 });
    before.player.hp = 7; before.player.weapon.level = 2;
    before.player.hunger = HUNGER.starvingAt; before.player.starvationT = 3;
    before.player.arrows = 0; before.player.stones = 0; before.player.bottles = 0;
    before.player.tipped = { paralysis: 0, chill: 0 };
    addItem(before, 'food:ration'); addItem(before, 'potion:healing');
    before.stats.kills = 11; before.stats.damageTaken['測試'] = 5;
    const checkpoint = nextFloor({ ...run, floor: 4 }, before);
    const encoded = serializeRun(checkpoint), parsed = parseRun(encoded)!;
    expect(parsed.floor).toBe(5); expect(parsed.carry).toEqual(before.carry());
    const active = createFloorWorld(parsed), boss = active.enemies[0]!;
    const signature = levelSignature(active.level);
    active.startEncounter();
    Object.assign(boss, { hp: 9, phase: 'charge', phaseT: .3, locked: true, paralyzeT: 2, slowT: 4, pendingSleep: true });
    Object.assign(boss.warden!, { attack: 'rush', phaseTwo: true, rangedCount: 5 });
    boss.aimPoint = { x: active.player.x, y: 1.2, z: active.player.z };
    active.player.hp = 1; active.player.items.length = 0; active.time = 33;
    for (const afterKill of [false, true]) {
      if (afterKill) defeat(active);
      const retry = createFloorWorld(parseRun(encoded)!);
      expect(levelSignature(retry.level)).toBe(signature);
      expect(retry.carry()).toEqual(before.carry()); expect(retry.stats).toEqual(checkpoint.stats);
      expect(retry.enemies).toHaveLength(1);
      expect(retry.enemies[0]).toMatchObject({
        kind: 'warden', hp: 32, maxHp: 32, alive: true, state: 'idle', phase: 'none', phaseT: 0,
        locked: false, paralyzeT: 0, slowT: 0, pendingSleep: false, aimPoint: null, lastKnown: null, target: null,
        warden: { attack: null, phaseTwo: false, rangedCount: 0 },
      });
      expect(retry.encounterState).toBe('dormant'); expect(retry.outcome).toBe('none');
      expect(retry.heartTaken).toBe(false); expect(retry.heartAvailable).toBe(false); expect(retry.time).toBe(0);
    }
    expect(serializeRun(parsed)).toBe(encoded);
    expect(encoded).not.toMatch(/phaseTwo|rangedCount|aimPoint|paralyzeT|encounterState|heartTaken/);
  });

  it('awards exactly 9 XP once, with no random loot or loot RNG draw', () => {
    const w = new World(generateLevel('WARDEN-REWARD', { floor: 5 }));
    const next = vi.spyOn(w.rng, 'next');
    defeat(w); defeat(w);
    expect(w.stats.kills).toBe(1); expect(w.player.xp).toBe(9);
    expect(w.pickups).toEqual([]); expect(next).not.toHaveBeenCalled();
    expect(w.encounterState).toBe('resolved'); expect(w.outcome).toBe('none');
    next.mockRestore();
  });
});

describe('isolated Heart Warden practice', () => {
  it('is an explicit menu trial built from the exact real floor-5 layout', () => {
    expect(PRACTICE_TRIALS.filter(t => t.id === 'heart-warden')).toHaveLength(1);
    expect(trialForSeed('TRIAL-WARDEN')?.id).toBe('heart-warden');
    const level = createTrialLevel('heart-warden');
    const actual = generateLevel('TRIAL-WARDEN', { floor: 5 });
    expect(level).toEqual({ ...actual, practice: true, practiceTrial: 'heart-warden', templateName: '守心者試煉' });
    expect(validateLevel(level)).toEqual({ ok: true, errors: [] });
    expect(level.heart).not.toBeNull(); expect(level.encounter).toBeDefined();
    expect(generateLevel('TRIAL-WARDEN').practiceTrial).toBeUndefined();
  });

  it.each(['warrior', 'huntress'] as const)('%s gets only its starting kit and can enter the encounter with all consumables/ammo depleted', cls => {
    const save = serializeRun(newRun('KEEP-CAMPAIGN', cls));
    const w = createTrialWorld('heart-warden', cls), p = w.player, start = CLASSES[cls].start;
    expect(p.items).toEqual([]); expect(p.talents).toEqual([]); expect(p.known).toEqual(CLASS_KNOWLEDGE[cls]);
    expect(p.weapon).toEqual({ id: CLASSES[cls].weapon, level: 0 });
    expect([p.arrows, p.stones, p.bottles, p.tipped.paralysis, p.tipped.chill]).toEqual([start.arrows, start.stones, start.bottles, start.paralysis, start.chill]);
    p.arrows = 0; p.stones = 0; p.bottles = 0; p.tipped = { paralysis: 0, chill: 0 };
    faceHeart(w); w.updateEncounter();
    expect(w.encounterState).toBe('active'); expect(w.outcome).toBe('none');
    expect(w.enemies[0]!.hp).toBe(32); expect(w.heartAvailable).toBe(false);
    expect(serializeRun(parseRun(save)!)).toBe(save);
    expect(createFloorWorld(parseRun(save)!).carry()).toEqual(createFloorWorld(newRun('KEEP-CAMPAIGN', cls)).carry());
  });

  it.each(['warrior', 'huntress'] as const)('%s reset restores boss, starting kit, time and Heart gate without retaining prior outcome', cls => {
    const first = createTrialWorld('heart-warden', cls), signature = levelSignature(first.level);
    first.enemies[0]!.warden!.phaseTwo = true; first.enemies[0]!.paralyzeT = 5;
    first.player.hp = 1; first.player.arrows = 0; addItem(first, 'potion:gas'); first.player.known.push('potion:gas');
    defeat(first); faceHeart(first);
    first.frame(1 / 60, { ...emptyInput(first.player.yaw), interact: true }); finishAction(first);
    expect(first.outcome).toBe('win');
    const reset = createTrialWorld('heart-warden', cls);
    expect(levelSignature(reset.level)).toBe(signature); expect(reset.enemies).toHaveLength(1);
    expect(reset.enemies[0]).toMatchObject({ hp: 32, maxHp: 32, alive: true, paralyzeT: 0, phase: 'none', warden: { attack: null, phaseTwo: false, rangedCount: 0 } });
    expect(reset.player.hp).toBe(PLAYER.maxHp); expect(reset.player.items).toEqual([]);
    expect(reset.player.arrows).toBe(CLASSES[cls].start.arrows); expect(reset.player.talents).toEqual([]);
    expect(reset.player.known).toEqual(CLASS_KNOWLEDGE[cls]);
    expect(reset.player.hunger).toBe(0); expect(reset.time).toBe(0);
    expect(reset.encounterState).toBe('dormant'); expect(reset.heartTaken).toBe(false); expect(reset.outcome).toBe('none');
  });

  it('blocks early Heart interaction and requires a real post-defeat E action rather than a no-Heart practice shortcut', () => {
    const w = createTrialWorld('heart-warden', 'warrior');
    faceHeart(w); w.updateEncounter();
    expect(findInteractTarget(w)).toMatchObject({ kind: 'heart', enabled: false });
    w.takeHeart();
    w.frame(1 / 60, { ...emptyInput(w.player.yaw), interact: true }); finishAction(w);
    expect(w.outcome).toBe('none'); expect(w.heartTaken).toBe(false);
    expect(w.interactables.find(i => i.kind === 'heart')!.used).toBe(false);
    defeat(w); w.advance(1);
    expect(w.outcome).toBe('none'); expect(w.heartTaken).toBe(false);
    expect(findInteractTarget(w)).toMatchObject({ kind: 'heart', enabled: true });
    w.frame(1 / 60, { ...emptyInput(w.player.yaw), interact: true }); finishAction(w);
    expect(w.outcome).toBe('win'); expect(w.heartTaken).toBe(true); expect(w.awakened).toBe(false);
    const end = [w.time, w.player.hunger, w.player.hp]; w.advance(10);
    expect([w.time, w.player.hunger, w.player.hp]).toEqual(end);
  });

  it('keeps hunger running in the antechamber, freezes encounter hunger before starvation, and resets to dormant', () => {
    const w = createTrialWorld('heart-warden', 'huntress');
    w.player.hunger = 150; w.advance(1);
    expect(w.player.hunger).toBeCloseTo(151); expect(w.hungerPaused).toBe(false);
    w.player.hunger = HUNGER.starvingAt; w.player.starvationT = HUNGER.damageEvery - .001;
    faceHeart(w); w.enemies[0]!.paralyzeT = 10; const hp = w.player.hp;
    w.advance(1);
    expect(w.hungerPaused).toBe(true); expect(w.player.hunger).toBe(HUNGER.starvingAt);
    expect(w.player.starvationT).toBe(HUNGER.damageEvery - .001); expect(w.player.hp).toBe(hp);
    defeat(w); w.advance(1); expect(w.player.starvationT).toBe(HUNGER.damageEvery - .001);
    const reset = createTrialWorld('heart-warden', 'huntress');
    expect(reset.hungerPaused).toBe(false); reset.advance(1); expect(reset.player.hunger).toBeCloseTo(1);
  });
});
