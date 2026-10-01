import { describe, expect, it } from 'vitest';
import { HUNGER, PLAYER, RUN, TALENT_FX, UPGRADE, XP } from '../src/config';
import { Rng } from '../src/core/rng';
import { rollEquipment } from '../src/gen/loot';
import { LAYOUTS } from '../src/gen/rooms';
import { RUN_TEMPLATES } from '../src/gen/templates';
import { generateLevel, validateLevel } from '../src/gen/validate';
import { addItem, queueUse, upgradeTargets } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { applyTalent, gainXp } from '../src/sim/progress';
import { updatePickups } from '../src/sim/propSys';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput, type UpgradeTarget } from '../src/sim/types';
import { finishAction, makeWorld, run } from './helpers';

const dt = 1 / 60;
const legacySave = () => {
  const r = newRun('LEGACY-RUNES', 'warrior');
  const w = createFloorWorld(r);
  gainXp(w, XP.levels[3]!);
  while (w.pendingChoice) w.resolveChoice(0);
  // Explicitly exercise the separate legitimate permanent HP talent.
  applyTalent(w, 'toughness');
  w.player.weapon.level = 3;
  w.player.armor = { id: 'mail', level: 2 };
  w.player.bowLevel = 1;
  w.player.hunger = HUNGER.starvingAt;
  w.player.starvationT = 7;
  addItem(w, 'food:ration');
  const current = nextFloor(r, w);
  const old = JSON.parse(serializeRun(current));
  old.carry.runes = ['pierce', 'swiftBlade', 'shadow', 'vigor'];
  old.carry.maxHp += 4;
  old.carry.hp = old.carry.maxHp;
  return { current, old };
};

describe('Legacy Rune saves are accepted without active progression', () => {
  it('removes identifiable vigor capacity, preserves level/toughness HP, equipment, food and Hunger, and is idempotent', () => {
    const { current, old } = legacySave();
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed).not.toBeNull();
    expect(parsed.carry).not.toHaveProperty('runes');
    expect(parsed.carry!.maxHp).toBe(PLAYER.maxHp + 3 * XP.hpPerLevel + TALENT_FX.toughnessHp);
    expect(parsed.carry!.hp).toBe(parsed.carry!.maxHp);
    expect(parsed.carry).toEqual({ ...current.carry, hp: current.carry!.maxHp });
    const resumed = createFloorWorld(parsed);
    expect(resumed.player).not.toHaveProperty('runes');
    expect(resumed.player.talents).toContain('toughness');
    const encoded = serializeRun(parsed);
    expect(encoded).not.toContain('runes');
    expect(encoded).not.toContain('vigor');
    expect(parseRun(encoded)).toEqual(parsed);
    expect(createFloorWorld(parseRun(encoded)!).player.maxHp).toBe(resumed.player.maxHp);
  });

  it.each([undefined, [], ['unknown-rune'], ['pierce', 'shadow', 'swiftBlade'], 'obsolete'])('ignores absent, unknown or obsolete Rune field %j without rejecting valid data', (runes) => {
    const { current } = legacySave();
    const old = JSON.parse(serializeRun(current));
    old.carry.runes = runes;
    expect(parseRun(JSON.stringify(old))).toEqual(current);
  });

  it('duplicate vigor IDs deduct once; historical healing is not retroactively subtracted', () => {
    const { old, current } = legacySave();
    old.carry.runes = ['vigor', 'vigor', 'future-rune'];
    old.carry.hp = 3;
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.carry!.hp).toBe(3);
    expect(parsed.carry!.maxHp).toBe(current.carry!.maxHp);
  });

  it('a stale vigor field cannot remove legitimate level or toughness HP', () => {
    const { current } = legacySave();
    const old = JSON.parse(serializeRun(current));
    old.carry.runes = ['vigor'];
    expect(parseRun(JSON.stringify(old))).toEqual(current);
  });
});

describe('Retained growth and generated rooms', () => {
  it.each(['weapon', 'armor', 'bow'] as const)('upgrade pickup → bag → %s choice → maximum level → floor/save roundtrip remains intact', (target: UpgradeTarget) => {
    const w = makeWorld(undefined, [], 'huntress');
    w.player.armor = { id: 'mail', level: UPGRADE.maxLevel - 1 };
    w.player.weapon.level = UPGRADE.maxLevel - 1;
    w.player.bowLevel = UPGRADE.maxLevel - 1;
    w.player.hunger = HUNGER.starvingAt; w.player.starvationT = 2;
    const pickup = w.addPickup('item', 1, w.player.x, .15, w.player.z, null, 'scroll:upgrade');
    updatePickups(w);
    expect(pickup.taken).toBe(true);
    expect(w.player.items[0]?.id).toBe('scroll:upgrade');
    queueUse(w, 0, 'use');
    w.frame(dt, emptyInput()); finishAction(w);
    expect(w.player.items).toHaveLength(0);
    expect(w.pendingChoice?.kind).toBe('upgrade');
    expect(w.pendingChoice?.options).toEqual(['weapon', 'armor', 'bow']);
    const before = [w.time, w.player.hunger, w.player.starvationT];
    run(w, 300, { wait: true });
    expect([w.time, w.player.hunger, w.player.starvationT]).toEqual(before);
    w.resolveChoice(99);
    expect(w.pendingChoice).not.toBeNull();
    w.resolveChoice((w.pendingChoice!.options as UpgradeTarget[]).indexOf(target));
    expect(w.pendingChoice).toBeNull();
    expect(upgradeTargets(w)).not.toContain(target);
    const next = nextFloor(newRun('UPGRADE-KEPT', 'huntress'), w);
    const saved = parseRun(serializeRun(next))!;
    expect(saved).toEqual(next);
    const resumed = createFloorWorld(saved);
    expect([resumed.player.weapon, resumed.player.armor, resumed.player.bowLevel]).toEqual([w.player.weapon, w.player.armor, w.player.bowLevel]);
    expect(target === 'weapon' ? resumed.player.weapon.level : target === 'armor' ? resumed.player.armor.level : resumed.player.bowLevel).toBe(UPGRADE.maxLevel);
  });

  it('XP/level HP, queued talents and upgrade choices keep pausing the same Hunger clock', () => {
    const w = makeWorld();
    w.player.hp = 5; w.player.hunger = HUNGER.starvingAt; w.player.starvationT = 3;
    gainXp(w, XP.levels[3]!);
    expect([w.player.level, w.player.maxHp, w.player.hp]).toEqual([4, PLAYER.maxHp + 3 * XP.hpPerLevel, 5 + 3 * XP.hpPerLevel]);
    expect(w.pendingChoice?.kind).toBe('talent');
    expect(w.choiceQueue).toHaveLength(1);
    const before = [w.time, w.player.hunger, w.player.starvationT];
    run(w, 180, { wait: true });
    expect([w.time, w.player.hunger, w.player.starvationT]).toEqual(before);
    w.resolveChoice(0);
    expect(w.pendingChoice?.kind).toBe('talent');
    run(w, 180, { wait: true });
    expect([w.time, w.player.hunger, w.player.starvationT]).toEqual(before);
    w.resolveChoice(0);
    expect(w.pendingChoice).toBeNull();
    expect(w.player.talents.length).toBeGreaterThan(0);
  });

  it('preserves every topology slot, makes former altar layouts reusable combat rooms, and keeps normal loot/food counts', () => {
    const variants = LAYOUTS.filter((l) => ['apse', 'rotunda'].includes(l.id));
    expect(variants).toHaveLength(2);
    expect(variants.every((l) => l.role === 'combat' && l.enemies.length > 0 && !l.rows.join('').includes('A'))).toBe(true);
    for (const template of RUN_TEMPLATES) {
      for (let seed = 0; seed < 8; seed++) for (let floor = 1; floor <= RUN.floors; floor++) {
        const l = generateLevel(`NO-RUNES-${seed}`, { template: template.id as 'A' | 'B', floor });
        expect(validateLevel(l)).toEqual({ ok: true, errors: [] });
        expect(l.rooms.map((r) => r.key)).toEqual(template.rooms.map((r) => r.key));
        expect(l.rooms).toHaveLength(9);
        const nav = new Nav(l.grid, PLAYER.radius), seen = nav.flood(l.spawn.x, l.spawn.z, false);
        for (const room of l.rooms) {
          const cell = nav.nearestPassable(room.x0 + room.w / 2, room.z0 + room.h / 2);
          expect(cell).toBeGreaterThanOrEqual(0);
          expect(seen[cell], `${template.id}/${seed}/${floor}/${room.key}`).toBe(1);
        }
        expect(l).not.toHaveProperty('altars');
        expect(l.pickups.filter((p) => p.item === 'scroll:upgrade')).toHaveLength(1);
        expect(l.pickups.filter((p) => p.item === 'food:ration')).toHaveLength(HUNGER.foodPerFloor[floor - 1]!);
        expect(l.chests).toHaveLength(1);
      }
    }
  }, 30000);

  it('deeper natural equipment loot still includes upgraded gear without changing its table', () => {
    const shallow = Array.from({ length: 100 }, (_, k) => rollEquipment(new Rng(`GEAR${k}`), 1));
    const deep = Array.from({ length: 100 }, (_, k) => rollEquipment(new Rng(`GEAR${k}`), 4));
    expect(shallow.every((item) => item.level === 0)).toBe(true);
    expect(deep.some((item) => item.level === 1)).toBe(true);
    expect(deep.every((item) => item.level === 0 || item.level === 1)).toBe(true);
  });
});
