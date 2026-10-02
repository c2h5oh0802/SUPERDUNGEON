import { describe, expect, it } from 'vitest';
import { ACTIONS, ALL_SCROLLS, CLASS_KNOWLEDGE, type PlayerClass } from '../src/config';
import { addItem, identify, identifyTargets, isKnown, itemColor, itemDesc, itemName, looksFor, queueUse, stunPlayer } from '../src/sim/items';
import { Rng } from '../src/core/rng';
import { emptyInput } from '../src/sim/types';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { finishAction, makeWorld, run } from './helpers';

const scrolls = (w: ReturnType<typeof makeWorld>) => w.player.items.filter(it => it.id === 'scroll:identify').reduce((n, it) => n + it.count, 0);
function read(w: ReturnType<typeof makeWorld>) {
  queueUse(w, w.player.items.findIndex(it => it.id === 'scroll:identify'), 'use');
  w.frame(1 / 60, emptyInput()); finishAction(w);
}

describe('Identify is an ordinary unknown scroll until used or already learned', () => {
  it.each(['warrior', 'huntress'] as PlayerClass[])('%s has only its original starting knowledge', cls => {
    const w = makeWorld(undefined, [], cls);
    expect(w.player.known).toEqual(CLASS_KNOWLEDGE[cls]);
    expect(isKnown(w, 'scroll:identify')).toBe(false);
    expect(itemName(w, 'scroll:identify')).toMatch(/符文卷軸$/);
    expect(itemName(w, 'scroll:identify')).not.toContain('鑑定');
    expect(itemDesc(w, 'scroll:identify')).toBe(itemDesc(w, 'scroll:sleep'));
    expect(itemColor(w.level.seed, 'scroll:identify')).toBe(itemColor(w.level.seed, 'scroll:sleep'));
    expect(isKnown(w, 'scroll:upgrade')).toBe(true);
  });

  it('keeps all three old glyph mappings and uses their only unused fourth glyph', () => {
    expect(ALL_SCROLLS).toEqual(['teleport', 'mapping', 'sleep', 'identify']);
    for (let k = 0; k < 80; k++) for (const version of [1, 2] as const) {
      const seed = `IDENTIFY-UNKNOWN-${k}`, rng = new Rng(`${seed}#looks`);
      rng.shuffle([0, 1, 2, 3, 4]); const expected = rng.shuffle([0, 1, 2, 3]);
      const looks = looksFor(seed, version);
      expect(ALL_SCROLLS.map(id => looks.scroll[id])).toEqual(expected);
      expect(new Set(ALL_SCROLLS.map(id => looks.scroll[id])).size).toBe(4);
    }
  });

  it('first normal read reveals itself, then identifies only the one chosen other kind', () => {
    const w = makeWorld(); addItem(w, 'scroll:identify'); addItem(w, 'scroll:identify'); addItem(w, 'potion:fire'); addItem(w, 'potion:frost');
    expect(isKnown(w, 'scroll:identify')).toBe(false); read(w);
    expect(w.time).toBeCloseTo(ACTIONS.read.recovery, 8); expect(isKnown(w, 'scroll:identify')).toBe(true);
    expect(w.player.known.filter(id => id === 'scroll:identify')).toHaveLength(1);
    expect(identifyTargets(w).map(it => it.id)).toEqual(['potion:fire', 'potion:frost']);
    expect(w.pendingChoice?.kind).toBe('identify'); w.resolveChoice(0);
    expect(isKnown(w, 'potion:fire')).toBe(true); expect(isKnown(w, 'potion:frost')).toBe(false);
    expect(w.player.items.find(it => it.id === 'potion:fire')?.count).toBe(1); expect(scrolls(w)).toBe(1); expect(w.stats.itemsUsed).toBe(1);
  });

  it('unknown no-target trial reads and consumes, then known no-target read refuses', () => {
    const w = makeWorld(); addItem(w, 'scroll:identify'); addItem(w, 'scroll:identify');
    read(w); expect(isKnown(w, 'scroll:identify')).toBe(true); expect(scrolls(w)).toBe(1);
    expect(w.time).toBeCloseTo(ACTIONS.read.recovery, 8); expect(w.pendingChoice).toBeNull(); expect(w.stats.itemsUsed).toBe(1);
    read(w); expect(scrolls(w)).toBe(1); expect(w.player.action).toBeNull(); expect(w.stats.itemsUsed).toBe(1);
  });

  it('first-read cancel keeps its discovered knowledge but cannot refund that experiment', () => {
    const w = makeWorld(); addItem(w, 'scroll:identify'); addItem(w, 'scroll:identify'); addItem(w, 'potion:fire');
    read(w); w.cancelIdentifyChoice(); w.cancelIdentifyChoice();
    expect(isKnown(w, 'scroll:identify')).toBe(true); expect(isKnown(w, 'potion:fire')).toBe(false);
    expect(scrolls(w)).toBe(1); expect(w.stats.itemsUsed).toBe(1);
    read(w); w.cancelIdentifyChoice(); expect(scrolls(w)).toBe(1); expect(w.stats.itemsUsed).toBe(1);
  });
});


describe('first-read knowledge remains a paid experiment', () => {
  it('unknown reading interruption loses the reserved scroll without revealing it', () => {
    const w = makeWorld(); addItem(w, 'scroll:identify'); addItem(w, 'potion:fire');
    queueUse(w, 0, 'use'); w.frame(1 / 60, emptyInput()); stunPlayer(w, .1); finishAction(w);
    expect(scrolls(w)).toBe(0); expect(isKnown(w, 'scroll:identify')).toBe(false);
    expect(w.pendingChoice).toBeNull(); expect(w.stats.itemsUsed).toBe(0);
  });

  it('first read pauses world and Hunger at its real choice, then stale exhaustion still stays spent', () => {
    const w = makeWorld(); addItem(w, 'scroll:identify'); addItem(w, 'potion:fire'); read(w);
    const choice = w.pendingChoice, time = w.time, hunger = w.player.hunger;
    expect(choice).toMatchObject({ kind: 'identify', learnedScroll: true });
    run(w, 120, { wait: true }); expect(w.time).toBe(time); expect(w.player.hunger).toBe(hunger);
    identify(w, 'potion:fire'); w.resolveChoice(0);
    expect(w.pendingChoice).toBeNull(); expect(scrolls(w)).toBe(0); expect(w.stats.itemsUsed).toBe(1);
    w.pendingChoice = choice; w.resolveChoice(0); w.cancelIdentifyChoice();
    expect(scrolls(w)).toBe(0); expect(w.stats.itemsUsed).toBe(1);
  });

  it('a target learned during the first read does not make the self-discovery refundable', () => {
    const w = makeWorld(); addItem(w, 'scroll:identify'); addItem(w, 'potion:fire');
    queueUse(w, 0, 'use'); w.frame(1 / 60, emptyInput()); identify(w, 'potion:fire'); finishAction(w);
    expect(w.pendingChoice).toBeNull(); expect(scrolls(w)).toBe(0); expect(w.stats.itemsUsed).toBe(1);
    expect(isKnown(w, 'scroll:identify')).toBe(true);
  });

  it('pre-existing explicit knowledge uses the old safe cancel contract', () => {
    const w = makeWorld(); w.player.known.push('scroll:identify'); addItem(w, 'scroll:identify'); addItem(w, 'potion:fire');
    read(w); expect(w.pendingChoice).toMatchObject({ learnedScroll: false }); w.cancelIdentifyChoice();
    expect(scrolls(w)).toBe(1); expect(w.stats.itemsUsed).toBe(0); expect(isKnown(w, 'potion:fire')).toBe(false);
  });
});

describe('knowledge migration distinguishes old fixed-known ownership from new unknown ownership', () => {
  const checkpoint = (cls: PlayerClass = 'warrior') => {
    const w = makeWorld(undefined, [], cls); addItem(w, 'scroll:identify'); addItem(w, 'potion:fire');
    return nextFloor(newRun('IDENTIFY-MIGRATION', cls), w);
  };

  it.each(['warrior', 'huntress'] as PlayerClass[])('%s new unknown stack stays unknown across save and floor boundaries', cls => {
    let saved = checkpoint(cls);
    for (let floor = 2; floor <= 5; floor++) {
      const raw = serializeRun(saved); expect(JSON.parse(raw)).toHaveProperty('identifyKnowledgeVersion', 1);
      const parsed = parseRun(raw)!; const w = createFloorWorld(parsed);
      expect(isKnown(w, 'scroll:identify')).toBe(false); expect(scrolls(w)).toBe(1); expect(parsed).toEqual(saved);
      saved = nextFloor(parsed, w);
    }
  });

  it('unmarked prior-release ownership preserves the name the player already saw, without extra items', () => {
    const old = JSON.parse(serializeRun(checkpoint())); delete old.identifyKnowledgeVersion;
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.carry!.items).toEqual(old.carry.items);
    expect(parsed.carry!.known).toEqual([...old.carry.known, 'scroll:identify']);
    expect(isKnown(createFloorWorld(parsed), 'scroll:identify')).toBe(true);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
  });

  it('an older unmarked save without ownership gains no guessed knowledge', () => {
    const old = JSON.parse(serializeRun(checkpoint())); delete old.identifyKnowledgeVersion;
    old.carry.items = old.carry.items.filter((it: { id: string }) => it.id !== 'scroll:identify');
    const parsed = parseRun(JSON.stringify(old))!;
    expect(parsed.carry!.known).toEqual(old.carry.known); expect(isKnown(createFloorWorld(parsed), 'scroll:identify')).toBe(false);
  });

  it.each([false, true])('explicit known identity survives without a remaining copy (legacy=%s)', legacy => {
    const raw = JSON.parse(serializeRun(checkpoint()));
    raw.carry.items = []; raw.carry.known.push('scroll:identify'); if (legacy) delete raw.identifyKnowledgeVersion;
    const parsed = parseRun(JSON.stringify(raw))!;
    expect(parsed.carry!.known).toEqual(raw.carry.known); expect(isKnown(createFloorWorld(parsed), 'scroll:identify')).toBe(true);
    expect(parseRun(serializeRun(parsed))).toEqual(parsed);
  });

  it.each([0, 2, '1', null])('rejects unsupported knowledge marker %s without guessing', marker => {
    const raw = JSON.parse(serializeRun(checkpoint())); raw.identifyKnowledgeVersion = marker;
    expect(parseRun(JSON.stringify(raw))).toBeNull();
  });
});
