import { describe, expect, it } from 'vitest';
import { ACTIONS, HUNGER, ITEM_FX, TIME, XP, type ItemId } from '../src/config';
import { addItem, cancelIdentification, conversionKind, identify, identifyTargets, isKnown, itemName, knownHealingCount, queueUse, readScroll, refreshIdentifyChoice, stunPlayer } from '../src/sim/items';
import { gainXp, queueChoice } from '../src/sim/progress';
import { updatePickups } from '../src/sim/propSys';
import { emptyInput, type PendingChoice } from '../src/sim/types';
import { finishAction, makeWorld, run } from './helpers';

const identifyId: ItemId = 'scroll:identify';
const dt = 1 / 60;

describe('single-item identification scroll', () => {
  it('is a clearly named, always-known utility for both classes', () => {
    for (const cls of ['warrior', 'huntress'] as const) {
      const w = makeWorld(undefined, [], cls);
      expect(isKnown(w, identifyId)).toBe(true);
      expect(itemName(w, identifyId)).toBe('鑑定卷軸');
    }
  });

  it('reserves exactly one scroll, reads normally, then asks for a single target', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); addItem(w, identifyId); addItem(w, identifyId);
    queueUse(w, 1, 'use'); w.frame(dt, emptyInput());
    expect(w.player.action?.kind).toBe('read');
    expect(w.player.items.find(it => it.id === identifyId)?.count).toBe(1);
    finishAction(w);
    expect(w.pendingChoice?.kind).toBe('identify');
    expect(isKnown(w, 'potion:fire')).toBe(false);
  });

  it('refuses with no eligible target and spends no item or action time', () => {
    const w = makeWorld(); addItem(w, identifyId); addItem(w, 'potion:healing');
    queueUse(w, 0, 'use'); w.frame(dt, emptyInput());
    expect(w.player.action).toBeNull();
    expect(w.player.items.find(it => it.id === identifyId)?.count).toBe(1);
    expect(w.stats.itemsUsed).toBe(0);
  });

  it('keeps the chosen item intact and only reveals its kind', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); addItem(w, 'potion:fire'); addItem(w, 'potion:frost'); addItem(w, identifyId);
    const target = w.player.items[0]!;
    queueUse(w, 2, 'use'); w.frame(dt, emptyInput()); finishAction(w);
    w.resolveChoice(0);
    expect(isKnown(w, 'potion:fire')).toBe(true);
    expect(isKnown(w, 'potion:frost')).toBe(false);
    expect(w.player.items[0]).toBe(target);
    expect(target.count).toBe(2);
    expect(w.player.items.some(it => it.id === identifyId)).toBe(false);
  });
});


const countScrolls = (w: ReturnType<typeof makeWorld>) => w.player.items.filter(it => it.id === identifyId).reduce((n, it) => n + it.count, 0);
const recoverableScrolls = (w: ReturnType<typeof makeWorld>) => countScrolls(w) + w.pickups.filter(it => !it.taken && it.item === identifyId).reduce((n, it) => n + it.amount, 0);
function begin(w: ReturnType<typeof makeWorld>) {
  addItem(w, identifyId);
  queueUse(w, w.player.items.findIndex(it => it.id === identifyId), 'use');
  w.frame(dt, emptyInput());
  expect(w.player.action?.kind).toBe('read');
}
function complete(w: ReturnType<typeof makeWorld>): Extract<PendingChoice, { kind: 'identify' }> {
  begin(w); finishAction(w);
  const c = w.pendingChoice;
  if (c?.kind !== 'identify') throw new Error('Expected completed Identify offer');
  expect(c.reservedScroll).toBe(true);
  return c;
}

describe('identification owns one reservation and one explicit target', () => {
  it('offers unknown bag consumables only, never equipment, fixed tools, known items or floor loot', () => {
    const w = makeWorld();
    for (const id of ['weapon:knife', 'armor:mail', 'food:ration', 'scroll:upgrade', 'scroll:identify', 'potion:healing', 'potion:fire', 'scroll:sleep'] as const) addItem(w, id);
    w.addPickup('item', 1, w.player.x + 4, .15, w.player.z, null, 'potion:frost');
    expect(identifyTargets(w).map(it => it.id)).toEqual(['potion:fire', 'scroll:sleep']);
  });

  it('identifies the selected scroll kind without reading or consuming its effect', () => {
    const w = makeWorld(); addItem(w, 'scroll:mapping'); addItem(w, 'scroll:sleep');
    complete(w); const before = w.explored.slice(); w.resolveChoice(0);
    expect(isKnown(w, 'scroll:mapping')).toBe(true); expect(isKnown(w, 'scroll:sleep')).toBe(false);
    expect(w.player.items.map(it => [it.id, it.count])).toEqual([['scroll:mapping', 1], ['scroll:sleep', 1]]);
    expect(w.mapped).toBe(false); expect(w.explored).toEqual(before);
    expect(w.stats.itemsUsed).toBe(1);
  });

  it('knowledge also covers a second stack of the same kind, but no other unknown kind', () => {
    const w = makeWorld();
    w.player.items = [{ id: 'potion:fire', count: 99, level: 0 }, { id: 'potion:fire', count: 4, level: 0 }, { id: 'potion:frost', count: 2, level: 0 }];
    const before = structuredClone(w.player.items); complete(w); w.resolveChoice(1);
    expect(w.player.items).toEqual(before);
    expect(w.player.known.filter(id => id === 'potion:fire')).toHaveLength(1);
    expect(identifyTargets(w).map(it => it.id)).toEqual(['potion:frost']);
  });

  it('revalidates no-target refusal at action start without trusting an earlier queued offer', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); addItem(w, identifyId); queueUse(w, 1, 'use');
    identify(w, 'potion:fire'); w.frame(dt, emptyInput());
    expect(countScrolls(w)).toBe(1); expect(w.player.action).toBeNull(); expect(w.stats.itemsUsed).toBe(0);
  });

  it('never reads the replacement at a reused queued inventory index', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); addItem(w, identifyId); queueUse(w, 1, 'use');
    w.player.items[1] = { id: 'scroll:mapping', count: 2, level: 0 };
    w.frame(dt, emptyInput());
    expect(w.player.action).toBeNull(); expect(w.player.items[1]!.count).toBe(2); expect(w.mapped).toBe(false);
  });

  it.each([false, true])('returns an exhausted completed reservation once (full bag=%s)', full => {
    const w = makeWorld(); addItem(w, 'potion:fire'); begin(w); identify(w, 'potion:fire');
    if (full) w.player.items = Array.from({ length: ITEM_FX.slots }, () => ({ id: 'weapon:axe', count: 1, level: 0 }));
    finishAction(w);
    expect(w.pendingChoice).toBeNull(); expect(recoverableScrolls(w)).toBe(1); expect(w.stats.itemsUsed).toBe(0);
    w.resolveChoice(0); w.cancelIdentifyChoice(); run(w, 60, { wait: true });
    expect(recoverableScrolls(w)).toBe(1);
    if (full) { expect(countScrolls(w)).toBe(0); w.player.items.pop(); updatePickups(w); expect(countScrolls(w)).toBe(1); }
  });

  it('rejects a replaced selected stack and refreshes, without identifying the new occupant', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); addItem(w, 'potion:frost');
    const c = complete(w), old = c.options[0];
    w.player.items[0] = { id: 'potion:gas', count: 1, level: 0 };
    w.resolveChoice(0);
    expect(w.pendingChoice).toBe(c); expect(c.options).not.toContain(old);
    expect(isKnown(w, 'potion:gas')).toBe(false); expect(isKnown(w, 'potion:fire')).toBe(false);
    expect(recoverableScrolls(w)).toBe(0); expect(w.stats.itemsUsed).toBe(1);
    w.resolveChoice(1); expect(isKnown(w, 'potion:frost')).toBe(true); expect(isKnown(w, 'potion:gas')).toBe(false);
  });

  it('keeps object identity when bag order changes', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); addItem(w, 'potion:frost'); complete(w);
    w.player.items.reverse(); w.resolveChoice(0);
    expect(isKnown(w, 'potion:fire')).toBe(true); expect(isKnown(w, 'potion:frost')).toBe(false);
  });

  it.each([-1, 99, .5, NaN])('invalid index %s retains a valid offer and cannot invent scrolls', index => {
    const w = makeWorld(); addItem(w, 'potion:fire'); const c = complete(w); w.resolveChoice(index);
    expect(w.pendingChoice).toBe(c); expect(isKnown(w, 'potion:fire')).toBe(false); expect(recoverableScrolls(w)).toBe(0);
    w.resolveChoice(0); expect(w.pendingChoice).toBeNull(); expect(w.stats.itemsUsed).toBe(1);
  });

  it.each([false, true])('cancel returns only the reserved copy even at max stack/full bag (full=%s)', full => {
    const w = makeWorld(); addItem(w, 'potion:fire'); const c = complete(w);
    w.player.items = [{ id: identifyId, count: 99, level: 0 }, ...Array.from({ length: full ? ITEM_FX.slots - 1 : 0 }, () => ({ id: 'weapon:axe' as const, count: 1, level: 0 }))];
    const time = w.time, hunger = w.player.hunger;
    w.cancelIdentifyChoice(); w.cancelIdentifyChoice(); cancelIdentification(w, c); refreshIdentifyChoice(w, c);
    expect(recoverableScrolls(w)).toBe(100); expect(countScrolls(w)).toBe(full ? 99 : 100);
    expect(w.player.items.every(it => it.count <= 99)).toBe(true);
    expect(w.time).toBe(time); expect(w.player.hunger).toBe(hunger); expect(w.stats.itemsUsed).toBe(0);
    expect(c.settled).toBe(true); expect(c.reservedScroll).toBe(false);
  });

  it('a completed or canceled detached choice cannot identify again or refund again', () => {
    for (const cancel of [false, true]) {
      const w = makeWorld(); addItem(w, 'potion:fire'); addItem(w, 'potion:frost'); const c = complete(w);
      if (cancel) w.cancelIdentifyChoice(); else w.resolveChoice(0);
      const expected = recoverableScrolls(w), stats = w.stats.itemsUsed;
      queueChoice(w, c); w.resolveChoice(0); cancelIdentification(w, c);
      expect(w.pendingChoice).toBeNull(); expect(isKnown(w, 'potion:frost')).toBe(false);
      expect(recoverableScrolls(w)).toBe(expected); expect(w.stats.itemsUsed).toBe(stats);
    }
  });

  it('refreshes queued offers, returns an exhausted one, and does not skip a later talent', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); const c = complete(w); w.pendingChoice = null;
    gainXp(w, XP.levels[1]!); queueChoice(w, c); gainXp(w, XP.levels[3]! - w.player.xp);
    identify(w, 'potion:fire'); w.resolveChoice(0);
    expect((w.pendingChoice as PendingChoice | null)?.kind).toBe('talent'); expect(recoverableScrolls(w)).toBe(1); expect(w.stats.itemsUsed).toBe(0);
    w.resolveChoice(0); expect(w.pendingChoice).toBeNull(); expect(w.player.talents).toHaveLength(2);
  });

  it('cancel advances a queued talent, but cannot cancel talents or upgrades', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); complete(w); gainXp(w, XP.levels[1]!);
    w.cancelIdentifyChoice(); const talent = w.pendingChoice; w.cancelIdentifyChoice();
    expect(w.pendingChoice).toBe(talent); expect(talent?.kind).toBe('talent'); expect(recoverableScrolls(w)).toBe(1);
    w.resolveChoice(0); readScroll(w, 'upgrade'); const upgrade = w.pendingChoice; w.cancelIdentifyChoice(); expect(w.pendingChoice).toBe(upgrade);
  });

  it('direct helper calls cannot invent a refundable scroll', () => {
    const w = makeWorld(); readScroll(w, 'identify'); expect(w.pendingChoice).toBeNull();
    addItem(w, 'potion:fire'); readScroll(w, 'identify'); w.cancelIdentifyChoice(); w.cancelIdentifyChoice();
    expect(recoverableScrolls(w)).toBe(0); expect(w.stats.itemsUsed).toBe(0);
  });
});

describe('identification timing, interruption and existing knowledge benefits', () => {
  it.each([30, 60, 120])('normal read costs 0.6 world seconds at %i FPS; choice freezes world and hunger', fps => {
    const w = makeWorld(); addItem(w, 'potion:fire'); addItem(w, identifyId); queueUse(w, 1, 'use');
    w.frame(1 / fps, emptyInput()); finishAction(w, 1 / fps);
    expect(w.time).toBeCloseTo(ACTIONS.read.recovery, 8); expect(w.player.hunger).toBeCloseTo(w.time, 8);
    w.player.hunger = HUNGER.starvingAt; w.player.starvationT = HUNGER.damageEvery - .01;
    const hp = w.player.hp, t = w.time, real = w.realTime, remainder = w.player.starvationT;
    run(w, 600, { wait: true, fire: true, moveZ: 1 }, 1 / fps);
    expect(w.time).toBe(t); expect(w.realTime).toBe(real); expect(w.player.hunger).toBe(HUNGER.starvingAt);
    expect(w.player.starvationT).toBe(remainder); expect(w.player.hp).toBe(hp);
    w.cancelIdentifyChoice(); expect(w.time).toBe(t); expect(w.stats.itemsUsed).toBe(0);
  });

  it('uses the existing haste rule without changing the read or hunger clocks', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); w.player.hasteT = 8; begin(w); finishAction(w);
    expect(w.pendingChoice?.kind).toBe('identify'); expect(w.time).toBeCloseTo(ACTIONS.read.recovery * ITEM_FX.haste.timeMul, 8);
    expect(w.player.hunger).toBeCloseTo(w.time, 8);
  });

  it('read completion stops remaining frame substeps rather than charging paused time', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); begin(w);
    w.player.action!.t = ACTIONS.read.recovery - TIME.maxSubstep;
    const time = w.time, hunger = w.player.hunger; w.frame(.1, { ...emptyInput(), wait: true });
    expect(w.pendingChoice?.kind).toBe('identify'); expect(w.time - time).toBeCloseTo(TIME.maxSubstep, 8);
    expect(w.player.hunger - hunger).toBeCloseTo(w.time - time, 8);
  });

  it('stun interruption spends the reservation, without knowledge, choice or refund', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); begin(w); stunPlayer(w, .1); finishAction(w);
    expect(w.pendingChoice).toBeNull(); expect(isKnown(w, 'potion:fire')).toBe(false);
    expect(recoverableScrolls(w)).toBe(0); expect(w.stats.itemsUsed).toBe(0);
  });

  it.each(['reading', 'choice'] as const)('death during %s blocks later knowledge and refunds', stage => {
    const w = makeWorld(); addItem(w, 'potion:fire'); begin(w); if (stage === 'choice') finishAction(w);
    w.damagePlayer(100, 'test', 0, 0); run(w, 120, { wait: true }); w.resolveChoice(0); w.cancelIdentifyChoice();
    expect(w.player.dead).toBe(true); expect(isKnown(w, 'potion:fire')).toBe(false); expect(recoverableScrolls(w)).toBe(0);
  });

  it('read completion then lethal projectile in the same substep cannot grant knowledge or refund', () => {
    const w = makeWorld(); addItem(w, 'potion:fire'); begin(w);
    w.player.action!.t = ACTIONS.read.recovery - TIME.maxSubstep;
    const pos = { x: w.player.x, y: 1, z: w.player.z + .4 }, vel = { x: 0, y: 0, z: -20 };
    w.projectiles.push({ id: w.nextId++, kind: 'bolt', owner: -1, damage: 100, source: 'read-completion-test',
      pos, vel, radius: .05, gravity: 0, age: 0, alive: true, hitSet: new Set(), next: { ...pos }, avgVel: { ...vel }, deflected: false, tip: null, payload: 'smoke' });
    w.advance(TIME.maxSubstep);
    expect(w.pendingChoice?.kind).toBe('identify'); expect(w.outcome).toBe('dead');
    w.resolveChoice(0); w.cancelIdentifyChoice();
    expect(isKnown(w, 'potion:fire')).toBe(false); expect(recoverableScrolls(w)).toBe(0);
    expect(w.events.some(e => e.type === 'read' && e.kind === 'identify')).toBe(true);
    expect(w.events.some(e => e.type === 'death')).toBe(true);
  });

  it('identified healing becomes eligible for H without drinking the target', () => {
    const w = makeWorld(undefined, [], 'huntress'); addItem(w, 'potion:healing'); w.player.hp = 1;
    expect(knownHealingCount(w)).toBe(0); complete(w); w.resolveChoice(0);
    expect(knownHealingCount(w)).toBe(1); expect(w.player.hp).toBe(1);
    w.frame(dt, { ...emptyInput(), potion: true }); finishAction(w);
    expect(w.player.hp).toBe(6); expect(knownHealingCount(w)).toBe(0); expect(w.stats.itemsUsed).toBe(2);
  });

  it('identified potion enables only its existing apothecary recipe, with no granted arrows', () => {
    const w = makeWorld(undefined, [], 'huntress'); w.player.talents.push('apothecary'); addItem(w, 'potion:frost'); addItem(w, 'potion:gas');
    const tipped = { ...w.player.tipped }; expect(conversionKind(w, 'potion:frost')).toBeNull(); complete(w); w.resolveChoice(0);
    expect(conversionKind(w, 'potion:frost')).toBe('chill'); expect(conversionKind(w, 'potion:gas')).toBeNull(); expect(w.player.tipped).toEqual(tipped);
  });
});
