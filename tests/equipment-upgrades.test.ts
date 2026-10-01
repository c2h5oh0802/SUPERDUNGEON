import { describe, expect, it } from 'vitest';
import { ACTIONS, ALL_ARMORS, ALL_WEAPONS, ARMORS, ENEMIES, ITEM_FX, PROJECTILES, STEALTH, TALENT_FX, UPGRADE, WEAPONS, XP } from '../src/config';
import { armorFootstepRadius, armorReduction, armorSneakSpeedMul, bowDamage, weaponDamage } from '../src/sim/equipment';
import { addItem, applyUpgrade, itemDesc, queueUse, readScroll, stunPlayer, upgradeLabel, upgradeTargets } from '../src/sim/items';
import { weaponDamage as legacyWeaponDamage } from '../src/sim/playerSys';
import { gainXp, queueChoice } from '../src/sim/progress';
import { updatePickups } from '../src/sim/propSys';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput, type InvItem, type PendingChoice, type Projectile } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { finishAction, makeWorld, run } from './helpers';

const dt = 1 / 60;
const levels = [0, 1, 2, 3, 4, 5];
const weaponCases = ALL_WEAPONS.flatMap(id => levels.map(level => ({ id, level })));
const armorCases = ALL_ARMORS.flatMap(id => levels.map(level => ({ id, level })));
const bowCases = levels.flatMap(level => [false, true].map(head => ({ level, head })));
const input = (w: World) => emptyInput(w.player.yaw, w.player.pitch);
const scrollCount = (w: World) => w.player.items.filter(it => it.id === 'scroll:upgrade').reduce((sum, it) => sum + it.count, 0);
const recoverableScrolls = (w: World) => scrollCount(w) + w.pickups.filter(p => !p.taken && p.item === 'scroll:upgrade').reduce((sum, p) => sum + p.amount, 0);
const gearBag = (size: number): InvItem[] => Array.from({ length: size }, () => ({ id: 'weapon:axe', count: 1, level: 0 }));

function capEquipment(w: World): void {
  w.player.weapon.level = UPGRADE.maxLevel;
  w.player.armor = { id: 'mail', level: UPGRADE.maxLevel };
  w.player.bowLevel = UPGRADE.maxLevel;
}

function beginRead(w: World): void {
  expect(addItem(w, 'scroll:upgrade')).toBe(true);
  queueUse(w, w.player.items.findIndex(it => it.id === 'scroll:upgrade'), 'use');
  w.frame(dt, input(w));
  expect(w.player.action?.kind).toBe('read');
  expect(w.pendingChoice).toBeNull();
}

function completeRead(w: World): Extract<PendingChoice, { kind: 'upgrade' }> {
  beginRead(w);
  finishAction(w);
  const choice = w.pendingChoice;
  expect(choice?.kind).toBe('upgrade');
  if (choice?.kind !== 'upgrade') throw new Error('Completed upgrade read did not offer a choice');
  expect(choice).toMatchObject({ reservedScroll: true });
  return choice;
}

function queueReadBehindTalent(w: World): void {
  // Preserve an actual completed action's ownership token while modeling a
  // choice waiting behind a talent. Do not fabricate a refundable upgrade.
  const choice = completeRead(w);
  w.pendingChoice = null;
  gainXp(w, XP.levels[1]!);
  queueChoice(w, choice);
  expect(w.pendingChoice).toMatchObject({ kind: 'talent' });
}

describe('equipment calculations, current descriptions, and effective upgrade limits', () => {
  it.each(weaponCases)('$id +$level matches the old export and actual melee damage', ({ id, level }) => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13, state: 'idle' }]);
    w.player.weapon = { id, level };
    const enemy = w.enemies[0]!;
    enemy.hp = enemy.maxHp = 100;
    enemy.state = 'alert';
    enemy.paralyzeT = 10;
    enemy.seesPlayer = true;
    const expected = WEAPONS[id].damage + WEAPONS[id].perLevel * level;
    expect(weaponDamage(id, level)).toBe(expected);
    expect(legacyWeaponDamage(id, level)).toBe(expected);
    expect(itemDesc(w, `weapon:${id}`, level)).toContain(`${expected} 基礎傷害`);
    expect(itemDesc(w, `weapon:${id}`)).toContain(`${WEAPONS[id].damage} 基礎傷害`);
    const preview = upgradeLabel(w, 'weapon');
    const upgradedDamage = expected + WEAPONS[id].perLevel;
    if (level < UPGRADE.maxLevel) {
      expect(preview.name).toContain(`+${level} → +${level + 1}`);
      expect(preview.text).toContain(`基礎傷害 ${expected} → ${upgradedDamage}`);
      if (id === 'knife') expect(preview.text).toContain(`奇襲 ${expected * 2} → ${upgradedDamage * 2}`);
      if (id === 'axe') expect(preview.text).toContain(`次敵 ${expected / 2} → ${upgradedDamage / 2}`);
    } else {
      expect(preview.text).toContain('已達強化上限');
      expect(preview.name).not.toContain('→');
      expect(preview.text).not.toContain('→');
    }
    w.frame(dt, { ...input(w), fire: true, firePressed: true });
    finishAction(w);
    expect(100 - enemy.hp).toBe(expected);
    expect(upgradeTargets(w).includes('weapon')).toBe(level < UPGRADE.maxLevel);
    const before = { ...w.player.weapon };
    expect(applyUpgrade(w, 'weapon')).toBe(level < UPGRADE.maxLevel);
    expect(w.player.weapon).toEqual({ ...before, level: level < UPGRADE.maxLevel ? level + 1 : level });
    enemy.hp = 100;
    w.frame(dt, { ...input(w), fire: true, firePressed: true });
    finishAction(w);
    expect(100 - enemy.hp).toBe(level < UPGRADE.maxLevel ? upgradedDamage : expected);
  });

  it.each(armorCases)('$id +$level offers only real mitigation and preserves the one-damage floor', ({ id, level }) => {
    const w = makeWorld();
    w.player.armor = { id, level };
    w.player.hp = w.player.maxHp = 100;
    const expected = Math.min(UPGRADE.armorMaxReduce, ARMORS[id].reduce + (id === 'cloth' ? 0 : level * UPGRADE.armorPerLevel));
    expect(armorReduction(id, level)).toBe(expected);
    expect(w.armorReduce()).toBe(expected);
    expect(itemDesc(w, `armor:${id}`, level)).toContain(`每次減傷 ${expected}`);
    w.damagePlayer(8, 'armor-test', 0, 0);
    expect(w.player.hp).toBe(100 - (8 - expected));
    w.damagePlayer(1, 'armor-test', 0, 0);
    expect(w.player.hp).toBe(100 - (8 - expected) - 1);
    const eligible = id !== 'cloth' && level < UPGRADE.maxLevel && expected < UPGRADE.armorMaxReduce;
    const preview = upgradeLabel(w, 'armor');
    expect(preview.text).toContain(`減傷上限 ${UPGRADE.armorMaxReduce}`);
    if (eligible) expect(preview.text).toContain(`每次減傷 ${expected} → ${expected + UPGRADE.armorPerLevel}`);
    else {
      expect(preview.text).toContain(id === 'cloth' ? '布衣不能強化' : '減傷已封頂');
      expect(preview.name).not.toContain('→');
      expect(preview.text).not.toContain('→');
    }
    expect(upgradeTargets(w).includes('armor')).toBe(eligible);
    expect(applyUpgrade(w, 'armor')).toBe(eligible);
    expect(w.player.armor).toEqual({ id, level: eligible ? level + 1 : level });
    expect(w.armorReduce()).toBe(expected + (eligible ? UPGRADE.armorPerLevel : 0));
    const hp = w.player.hp;
    w.damagePlayer(8, 'upgraded-armor-test', 0, 0);
    expect(hp - w.player.hp).toBe(8 - expected - (eligible ? UPGRADE.armorPerLevel : 0));
  });

  it.each(bowCases)('bow +$level head=$head uses the same baseline as an actual arrow hit', ({ level, head }) => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 12, yaw: 0, state: 'idle' }], 'huntress');
    w.player.bowLevel = level;
    const enemy = w.enemies[0]!;
    enemy.hp = enemy.maxHp = 100;
    enemy.state = 'alert';
    enemy.paralyzeT = 10;
    enemy.shieldUp = false;
    const expected = (head ? PROJECTILES.arrow.head : PROJECTILES.arrow.body) + level * (head ? UPGRADE.bowHead : UPGRADE.bowBody);
    expect(bowDamage(level, head)).toBe(expected);
    const preview = upgradeLabel(w, 'bow');
    if (level < UPGRADE.maxLevel) {
      const next = expected + (head ? UPGRADE.bowHead : UPGRADE.bowBody);
      expect(preview.text).toContain(`${head ? '頭部' : '基礎身體傷害'} ${expected} → ${next}`);
      expect(preview.name).toContain(`+${level} → +${level + 1}`);
    } else {
      expect(preview.text).toContain('已達強化上限');
      expect(preview.text).not.toContain('→');
    }
    const pos = { x: enemy.x, y: head ? ENEMIES.guard.headY : 0.7, z: enemy.z + 2 };
    const vel = { x: 0, y: 0, z: -PROJECTILES.arrow.speed };
    const arrow: Projectile = {
      id: w.nextId++, kind: 'arrow', owner: 'player', pos, vel, next: { ...pos }, avgVel: { ...vel },
      radius: PROJECTILES.arrow.radius, gravity: 0, age: 0, alive: true, hitSet: new Set(),
      deflected: false, tip: null, payload: 'smoke',
    };
    w.projectiles.push(arrow);
    w.advance(0.1);
    expect(100 - enemy.hp).toBe(expected);
    expect(w.events.find(event => event.type === 'hitEnemy')?.head).toBe(head);
    expect(upgradeTargets(w).includes('bow')).toBe(level < UPGRADE.maxLevel);
    expect(applyUpgrade(w, 'bow')).toBe(level < UPGRADE.maxLevel);
    expect(w.player.bowLevel).toBe(level < UPGRADE.maxLevel ? level + 1 : level);
    enemy.hp = 100;
    w.projectiles.push({
      ...arrow, id: w.nextId++, pos: { ...pos }, next: { ...pos }, vel: { ...vel }, avgVel: { ...vel },
      age: 0, alive: true, hitSet: new Set(),
    });
    w.advance(0.1);
    expect(100 - enemy.hp).toBe(expected + (level < UPGRADE.maxLevel ? (head ? UPGRADE.bowHead : UPGRADE.bowBody) : 0));
  });

  it.each(ALL_ARMORS)('%s movement helpers match actual footsteps and Lightstep composition', id => {
    const w = makeWorld(undefined, [], 'huntress');
    w.player.armor = { id, level: 5 };
    expect(armorFootstepRadius(id)).toBe(STEALTH.footstepRadius * ARMORS[id].stepMul);
    expect(armorSneakSpeedMul(id)).toBe(STEALTH.sneakSpeedMul * ARMORS[id].sneakSpeedMul);
    expect(w.sneakSpeedMul()).toBe(armorSneakSpeedMul(id));
    run(w, 40, { moveX: 1 });
    const steps = w.events.filter(event => event.type === 'noise' && event.source === 'step');
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.every(event => event.radius === armorFootstepRadius(id))).toBe(true);
    w.player.talents.push('lightstep');
    expect(w.sneakSpeedMul()).toBe(armorSneakSpeedMul(id, TALENT_FX.lightstepSpeed));
    expect(w.sneakSpeedMul()).toBe(STEALTH.sneakSpeedMul * ARMORS[id].sneakSpeedMul * TALENT_FX.lightstepSpeed);
  });

  it.each(levels)('warrior bow and historical shield +%i cannot be upgraded directly', level => {
    const w = makeWorld();
    w.player.bowLevel = level;
    w.player.shieldLevel = level;
    expect(upgradeTargets(w)).not.toContain('bow');
    expect(upgradeTargets(w)).not.toContain('shield');
    expect(applyUpgrade(w, 'bow')).toBe(false);
    expect(applyUpgrade(w, 'shield')).toBe(false);
    expect(upgradeLabel(w, 'bow').text).toContain('此職業無獵弓強化');
    expect(upgradeLabel(w, 'shield').text).toContain('不能投入強化卷軸');
    expect(w.player.bowLevel).toBe(level);
    expect(w.player.shieldLevel).toBe(level);
    expect(w.events.some(event => event.type === 'equip')).toBe(false);
  });
});

describe('upgrade scroll action and choice ownership', () => {
  it('reserves at action start, finishes in normal world time, and pauses time and hunger during choices', () => {
    const w = makeWorld();
    beginRead(w);
    expect(scrollCount(w)).toBe(0);
    expect(w.player.weapon.level).toBe(0);
    expect(w.stats.itemsUsed).toBe(0);
    finishAction(w);
    expect(w.time).toBeCloseTo(ACTIONS.read.recovery, 8);
    expect(w.player.hunger).toBeCloseTo(w.time, 8);
    expect(w.pendingChoice).toMatchObject({ kind: 'upgrade', options: ['weapon'], reservedScroll: true });
    gainXp(w, XP.levels[1]!);
    const before = { time: w.time, hunger: w.player.hunger, x: w.player.x };
    run(w, 120, { wait: true, moveX: 1 });
    expect({ time: w.time, hunger: w.player.hunger, x: w.player.x }).toEqual(before);
    w.resolveChoice(0);
    expect(w.player.weapon.level).toBe(1);
    expect(w.pendingChoice?.kind).toBe('talent');
    expect(recoverableScrolls(w)).toBe(0);
    run(w, 60, { wait: true });
    expect(w.time).toBe(before.time);
    w.resolveChoice(0);
    expect(w.pendingChoice).toBeNull();
    expect(w.player.talents).toHaveLength(1);
    w.resolveChoice(0);
    expect(w.player.weapon.level).toBe(1);
    expect(recoverableScrolls(w)).toBe(0);
    expect(w.stats.itemsUsed).toBe(1);
  });

  it('keeps a scroll in the bag if all targets become invalid before its action begins', () => {
    const w = makeWorld(undefined, [], 'huntress');
    addItem(w, 'scroll:upgrade');
    queueUse(w, 0, 'use');
    capEquipment(w);
    w.frame(dt, input(w));
    expect(scrollCount(w)).toBe(1);
    expect(w.player.action).toBeNull();
    expect(w.pendingChoice).toBeNull();
    expect(w.stats.itemsUsed).toBe(0);
  });

  it('does not refund or apply an interrupted normal read', () => {
    const w = makeWorld();
    beginRead(w);
    capEquipment(w);
    stunPlayer(w, 0.1);
    finishAction(w);
    expect(recoverableScrolls(w)).toBe(0);
    expect(w.pendingChoice).toBeNull();
    expect(w.stats.itemsUsed).toBe(0);
    expect(w.player.weapon.level).toBe(UPGRADE.maxLevel);
  });

  it.each([false, true])('recovers exactly one reserved scroll if no targets remain at completion (full bag=%s)', fullBag => {
    const w = makeWorld(undefined, [], 'huntress');
    beginRead(w);
    capEquipment(w);
    if (fullBag) w.player.items = gearBag(ITEM_FX.slots);
    finishAction(w);
    expect(w.pendingChoice).toBeNull();
    expect(recoverableScrolls(w)).toBe(1);
    expect(scrollCount(w)).toBe(fullBag ? 0 : 1);
    if (fullBag) {
      const pickup = w.pickups.find(p => p.item === 'scroll:upgrade')!;
      expect(pickup).toMatchObject({ amount: 1, taken: false, level: 0 });
      w.player.items.pop();
      updatePickups(w);
      expect(pickup.taken).toBe(true);
      expect(scrollCount(w)).toBe(1);
    }
    run(w, 60, { wait: true });
    w.resolveChoice(0);
    expect(recoverableScrolls(w)).toBe(1);
  });

  it('rejects a stale selected target and rebuilds the remaining valid choices without losing the scroll', () => {
    const w = makeWorld(undefined, [], 'huntress');
    w.player.armor = { id: 'mail', level: 0 };
    const choice = completeRead(w);
    const armorIndex = choice.options.indexOf('armor');
    expect(armorIndex).toBeGreaterThanOrEqual(0);
    w.player.armor.level = 1;
    w.resolveChoice(armorIndex);
    expect(w.player.armor.level).toBe(1);
    expect(w.pendingChoice).toMatchObject({ kind: 'upgrade', options: ['weapon', 'bow'], reservedScroll: true });
    expect(recoverableScrolls(w)).toBe(0);
    w.resolveChoice(0);
    expect(w.player.weapon.level).toBe(1);
    expect(w.pendingChoice).toBeNull();
    expect(recoverableScrolls(w)).toBe(0);
  });

  it('an out-of-range selection retains a valid pending upgrade and its reservation', () => {
    const w = makeWorld();
    completeRead(w);
    w.resolveChoice(99);
    expect(w.pendingChoice).toMatchObject({ kind: 'upgrade', options: ['weapon'], reservedScroll: true });
    expect(w.player.weapon.level).toBe(0);
    expect(recoverableScrolls(w)).toBe(0);
    w.resolveChoice(0);
    expect(w.player.weapon.level).toBe(1);
    expect(recoverableScrolls(w)).toBe(0);
  });

  it.each([-1, 99])('an invalid index %i still releases an exhausted upgrade and advances a queued talent', index => {
    const w = makeWorld();
    completeRead(w);
    gainXp(w, XP.levels[1]!);
    capEquipment(w);
    w.resolveChoice(index);
    expect(w.pendingChoice?.kind).toBe('talent');
    expect(recoverableScrolls(w)).toBe(1);
    expect(w.player.weapon.level).toBe(UPGRADE.maxLevel);
    w.resolveChoice(0);
    expect(w.player.talents).toHaveLength(1);
    expect(recoverableScrolls(w)).toBe(1);
  });

  it.each([false, true])('stale selection recovers once and advances a queued talent (full bag=%s)', fullBag => {
    const w = makeWorld(undefined, [], 'huntress');
    completeRead(w);
    gainXp(w, XP.levels[1]!);
    capEquipment(w);
    if (fullBag) w.player.items = gearBag(ITEM_FX.slots);
    else addItem(w, 'scroll:upgrade');
    const expectedCount = fullBag ? 1 : 2;
    w.resolveChoice(0);
    expect(w.pendingChoice?.kind).toBe('talent');
    expect(recoverableScrolls(w)).toBe(expectedCount);
    expect(w.player.weapon.level).toBe(UPGRADE.maxLevel);
    const time = w.time, hunger = w.player.hunger;
    run(w, 30, { wait: true });
    expect(w.time).toBe(time);
    expect(w.player.hunger).toBe(hunger);
    w.resolveChoice(0);
    w.resolveChoice(0);
    expect(w.pendingChoice).toBeNull();
    expect(w.player.talents).toHaveLength(1);
    expect(recoverableScrolls(w)).toBe(expectedCount);
  });

  it('refreshes a queued upgrade when it reaches the front', () => {
    const w = makeWorld(undefined, [], 'huntress');
    w.player.armor = { id: 'mail', level: 0 };
    queueReadBehindTalent(w);
    w.player.armor.level = 1;
    w.player.bowLevel = UPGRADE.maxLevel;
    w.resolveChoice(0);
    expect(w.pendingChoice).toMatchObject({ kind: 'upgrade', options: ['weapon'], reservedScroll: true });
    w.resolveChoice(0);
    expect(w.player.weapon.level).toBe(1);
    expect(w.pendingChoice).toBeNull();
    expect(recoverableScrolls(w)).toBe(0);
  });

  it('skips an exhausted queued upgrade, restores its scroll once, and continues to the next talent', () => {
    const w = makeWorld(undefined, [], 'huntress');
    queueReadBehindTalent(w);
    gainXp(w, XP.levels[3]! - w.player.xp);
    capEquipment(w);
    w.resolveChoice(0);
    expect(w.pendingChoice?.kind).toBe('talent');
    expect(recoverableScrolls(w)).toBe(1);
    w.resolveChoice(0);
    w.resolveChoice(0);
    expect(w.pendingChoice).toBeNull();
    expect(w.player.talents).toHaveLength(2);
    expect(new Set(w.player.talents).size).toBe(2);
    expect(recoverableScrolls(w)).toBe(1);
  });

  it('direct legacy readScroll choices never invent a refundable inventory scroll', () => {
    const w = makeWorld();
    readScroll(w, 'upgrade');
    capEquipment(w);
    w.resolveChoice(0);
    w.resolveChoice(0);
    expect(w.pendingChoice).toBeNull();
    expect(recoverableScrolls(w)).toBe(0);
    readScroll(w, 'upgrade');
    expect(w.pendingChoice).toBeNull();
    expect(recoverableScrolls(w)).toBe(0);
  });

  it('a detached completed choice cannot refund a scroll that already purchased an upgrade', () => {
    const w = makeWorld();
    const completed = completeRead(w);
    w.resolveChoice(0);
    expect(w.player.weapon.level).toBe(1);
    expect(completed).toMatchObject({ reservedScroll: false });
    capEquipment(w);
    queueChoice(w, completed);
    w.resolveChoice(0);
    expect(w.pendingChoice).toBeNull();
    expect(recoverableScrolls(w)).toBe(0);
    expect(w.stats.itemsUsed).toBe(1);
  });
});

describe('equipment levels remain attached to physical items', () => {
  it.each(['weapon', 'armor'] as const)('%s swapping restores the same upgraded item without transferring its level', target => {
    const w = makeWorld();
    if (target === 'weapon') {
      w.player.weapon = { id: 'spear', level: 4 };
      addItem(w, 'weapon:axe', 1);
    } else {
      w.player.armor = { id: 'leather', level: 1 };
      addItem(w, 'armor:mail', 0);
    }
    expect(applyUpgrade(w, target)).toBe(true);
    const original = { ...w.player[target] };
    queueUse(w, 0, 'use');
    w.frame(dt, input(w));
    finishAction(w);
    expect(w.player[target].level).toBe(target === 'weapon' ? 1 : 0);
    expect(w.player.items).toContainEqual({ id: `${target}:${original.id}`, level: original.level, count: 1 });
    queueUse(w, 0, 'use');
    w.frame(dt, input(w));
    finishAction(w);
    expect(w.player[target]).toEqual(original);
  });

  it.each(['weapon', 'armor'] as const)('full legacy Healing overflow keeps swapped %s recoverable at its historical level', target => {
    const w = makeWorld();
    w.player.items = Array.from({ length: ITEM_FX.slots }, () => ({ id: target === 'weapon' ? 'weapon:axe' : 'armor:leather', count: 1, level: 0 }));
    w.player.items.push({ id: 'potion:healing', count: 3, level: 0 });
    if (target === 'weapon') w.player.weapon = { id: 'spear', level: 5 };
    else w.player.armor = { id: 'mail', level: 5 };
    const original = { ...w.player[target] };
    queueUse(w, 0, 'use');
    w.frame(dt, input(w));
    finishAction(w);
    const pickup = w.pickups.find(p => p.item === `${target}:${original.id}`)!;
    expect(pickup).toMatchObject({ taken: false, level: original.level });
    expect(w.player.items.find(it => it.id === 'potion:healing')?.count).toBe(3);
    w.player.items.splice(0, 1);
    updatePickups(w);
    expect(pickup.taken).toBe(true);
    expect(w.player.items).toContainEqual({ id: `${target}:${original.id}`, level: original.level, count: 1 });
    expect(w.player.items.find(it => it.id === 'potion:healing')?.count).toBe(3);
  });

  it('does not migrate away historical armor or shield levels while preserving Healing save migration', () => {
    const initial = newRun('EQUIPMENT-HISTORY', 'warrior');
    const w = createFloorWorld(initial);
    w.player.armor = { id: 'mail', level: 5 };
    w.player.shieldLevel = 5;
    w.player.items = [{ id: 'armor:leather', count: 1, level: 5 }, { id: 'weapon:axe', count: 1, level: 4 }];
    const old = JSON.parse(serializeRun(nextFloor(initial, w)));
    delete old.inventoryVersion;
    old.carry.potions = 2;
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed).not.toBeNull();
    expect(parsed.carry).toMatchObject({ armor: { id: 'mail', level: 5 }, shieldLevel: 5 });
    expect(parsed.carry!.items).toEqual([...w.player.items, { id: 'potion:healing', count: 2, level: 0 }]);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
    const restored = createFloorWorld(parsed);
    expect(restored.player.armor.level).toBe(5);
    expect(restored.armorReduce()).toBe(UPGRADE.armorMaxReduce);
    expect(upgradeTargets(restored)).not.toContain('armor');
    expect(upgradeTargets(restored)).not.toContain('shield');
  });
});
