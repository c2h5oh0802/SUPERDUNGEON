import { describe, expect, it } from 'vitest';
import { ACTIONS, TALENT_FX, WEAPONS, TALENT_POOLS, XP } from '../src/config';
import { T } from '../src/sim/grid';
import { applyHuntingMark, consumeHuntingMark } from '../src/sim/huntingMark';
import { startActions, fireProjectile, updatePlayerAction } from '../src/sim/playerSys';
import { updateProjectiles } from '../src/sim/projectileSys';
import { emptyInput } from '../src/sim/types';
import { applyTalent, gainXp } from '../src/sim/progress';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { makeWorld, OPEN_ROOM } from './helpers';

function setup(distance = 3) {
  const w = makeWorld(OPEN_ROOM, [{ kind: 'archer', x: 9.5, z: 14.5 - distance, state: 'idle' }], 'huntress');
  w.player.talents = ['mark'];
  w.enemies[0]!.hp = w.enemies[0]!.maxHp = 100;
  return w;
}
const fire = (w: ReturnType<typeof setup>) => startActions(w, { ...emptyInput(w.player.yaw, w.player.pitch), fire: true, firePressed: true });
function shoot(w: ReturnType<typeof setup>, tip: 'chill'|'paralysis'|null) {
  w.player.tool = w.player.desiredTool = tip ? 'tipped' : 'bow';
  if (tip) w.player.tipKind = tip;
  fire(w);
  const projectile = fireProjectile(w, 'bow');
  // Spawn is normal game geometry; advance only projectile for deterministic hit fixture.
  for (let i = 0; i < 50 && projectile.alive; i++) updateProjectiles(w, .01);
  w.player.action = null;
}

describe('Hunting Mark target-local cross-tool commitment', () => {
  it('normal arrow marks a living hit; repeated ordinary hits refresh rather than stack', () => {
    const w = setup(); shoot(w, null);
    expect(w.enemies[0]!.huntingMarkUntil).toBe(3);
    w.time = 1; shoot(w, null);
    expect(w.enemies[0]!.huntingMarkUntil).toBe(4);
  });
  it.each(['paralysis', 'chill'] as const)('%s does not apply or refresh a mark', tip => {
    const w = setup(); shoot(w, tip);
    expect(w.enemies[0]!.huntingMarkUntil ?? 0).toBe(0);
  });
  it('lethal normal arrow does not mark', () => {
    const w = setup(); w.enemies[0]!.hp = 1; shoot(w, null);
    expect(w.enemies[0]!.alive).toBe(false);
    expect(w.enemies[0]!.huntingMarkUntil ?? 0).toBe(0);
  });
  it('normal bow retains baseline windup and cannot consume mark', () => {
    const w = setup(); applyHuntingMark(w, w.enemies[0]!);
    w.player.tool = 'bow'; fire(w);
    expect(w.player.action!.windup).toBe(ACTIONS.bow.windup);
    expect(w.enemies[0]!.huntingMarkUntil).toBe(3);
  });
  it.each(['paralysis', 'chill'] as const)('%s commits target mark for windup only, even when later missing', tip => {
    const w = setup(); applyHuntingMark(w, w.enemies[0]!);
    w.player.tool = 'tipped'; w.player.tipKind = tip; fire(w);
    expect(w.player.action!.windup).toBeCloseTo(ACTIONS.bow.windup * .6);
    expect(w.player.action!.recovery).toBe(ACTIONS.bow.recovery);
    expect(w.enemies[0]!.huntingMarkUntil).toBe(0);
    w.player.yaw = Math.PI; updatePlayerAction(w, .8);
    expect(w.enemies[0]!.huntingMarkUntil).toBe(0);
    w.player.tool = 'tipped'; fire(w);
    expect(w.player.action!.windup).toBe(ACTIONS.bow.windup);
  });
  it('knife consumes only the first eligible target; miss after start is paid', () => {
    const w = setup(1.5); applyHuntingMark(w, w.enemies[0]!);
    w.player.tool = 'melee'; fire(w);
    expect(w.player.action!.windup).toBeCloseTo(WEAPONS.knife.windup * TALENT_FX.markWindupMul);
    expect(w.player.action!.active).toBe(WEAPONS.knife.active);
    expect(w.enemies[0]!.huntingMarkUntil).toBe(0);
    w.player.yaw = Math.PI; updatePlayerAction(w, 1);
    expect(w.enemies[0]!.hp).toBe(100);
  });
  it('cannot borrow a mark from another enemy behind the first unmarked body', () => {
    const w = setup();
    const rear = { ...w.enemies[0]!, id: 999, z: 9.5, huntingMarkUntil: 3 };
    w.enemies.push(rear);
    expect(consumeHuntingMark(w, 'tipped')).toBe(false);
    expect(rear.huntingMarkUntil).toBe(3);
  });
  it('mark expires by world time, and dead target has no usable mark', () => {
    const w = setup(); applyHuntingMark(w, w.enemies[0]!);
    w.realTime = 1000; expect(consumeHuntingMark(w, 'tipped')).toBe(true);
    applyHuntingMark(w, w.enemies[0]!); w.time = 3;
    expect(consumeHuntingMark(w, 'tipped')).toBe(false);
    applyHuntingMark(w, w.enemies[0]!); w.enemies[0]!.alive = false;
    expect(consumeHuntingMark(w, 'tipped')).toBe(false);
  });
  it('out of reach, aim away, wall and unavailable ammo do not consume', () => {
    const w = setup(); const e = w.enemies[0]!; applyHuntingMark(w, e);
    expect(consumeHuntingMark(w, 'melee')).toBe(false);
    w.player.yaw = Math.PI; expect(consumeHuntingMark(w, 'tipped')).toBe(false);
    w.player.yaw = 0; w.grid.set(9, 13, T.Wall);
    expect(consumeHuntingMark(w, 'tipped')).toBe(false);
    w.player.tool = 'tipped'; w.player.tipped.paralysis = 0; fire(w);
    expect(w.player.action).toBeNull(); expect(e.huntingMarkUntil).toBe(3);
  });
});

describe('Huntress talent pool and legacy save', () => {
  it('offers four meaningful talents, safely skips further choices after exhaustion', () => {
    const w = setup(); w.player.talents = [];
    expect(TALENT_POOLS.huntress).toEqual(['mark', 'apothecary', 'senses', 'lightstep']);
    for (let level = 2; level <= XP.levels.length; level++) {
      gainXp(w, XP.levels[level - 1]! - w.player.xp);
      if (w.pendingChoice) { expect(w.pendingChoice.options).not.toContain('toughness'); w.resolveChoice(0); }
    }
    expect(w.player.talents).toHaveLength(4); expect(w.pendingChoice).toBeNull();
    expect(TALENT_POOLS.warrior).toContain('toughness');
  });
  it('bulk XP revalidates queued offers and never wastes a choice on owned talents', () => {
    const w = setup(); w.player.talents = []; gainXp(w, 270);
    while (w.pendingChoice) {
      expect(w.pendingChoice.options.every(t => !w.player.talents.includes(t as 'mark'))).toBe(true);
      w.resolveChoice(0);
    }
    expect(w.player.talents).toHaveLength(4); expect(w.choiceQueue).toHaveLength(0);
  });
  it('legacy-owned Huntress Toughness stays owned and retains max HP; temporary marks are not saved', () => {
    const r = newRun('HUNTRESS-LEGACY', 'huntress'); const w = createFloorWorld(r);
    applyTalent(w, 'toughness'); w.player.talents.push('mark');
    if (w.enemies[0]) applyHuntingMark(w, w.enemies[0]);
    const next = nextFloor(r, w); const json = serializeRun(next); const loaded = parseRun(json)!;
    expect(loaded).not.toBeNull(); const floor = createFloorWorld(loaded);
    expect(floor.player.talents).toContain('toughness'); expect(floor.player.maxHp).toBe(14);
    expect(json).not.toContain('huntingMark'); expect(json).not.toContain('markT');
    expect(floor.enemies.every(e => !e.huntingMarkUntil)).toBe(true);
  });
});
