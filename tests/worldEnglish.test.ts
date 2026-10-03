import { describe, expect, it } from 'vitest';
import {
  ALL_ARMORS, ALL_CLASSES, ALL_POTIONS, ALL_SCROLLS, ALL_WEAPONS, classInfo,
  type ItemId,
} from '../src/config';
import { BOSS_TEST_PRESETS, bossTestLoadout, createBossTestWorld, type BossTestPreset } from '../src/dev/bossTest';
import { PRACTICE_TRIALS } from '../src/gen/practiceTrials';
import { LAYOUTS } from '../src/gen/rooms';
import { RUN_TEMPLATES, TEMPLATE_ARENA, TEMPLATE_PRACTICE } from '../src/gen/templates';
import { itemDesc, itemName, upgradeLabel } from '../src/sim/items';
import { World } from '../src/sim/world';
import { armorPresentation, bowPresentation, compareArmors, compareWeapons, weaponPresentation } from '../src/ui/equipment';
import { english } from '../src/ui/i18n';
import { identifyChoiceDescription, identifyChoiceMarkup, itemAppearance, itemCategoryLabel } from '../src/ui/inventoryPresentation';
import { worldEnglish } from '../src/ui/locales/world';
import { OPEN_ROOM, testLevel } from './helpers';

const han = /\p{Script=Han}/u;
const ITEMS: ItemId[] = [
  'food:ration', 'scroll:upgrade',
  ...ALL_WEAPONS.map((id): ItemId => `weapon:${id}`),
  ...ALL_ARMORS.map((id): ItemId => `armor:${id}`),
  ...ALL_POTIONS.map((id): ItemId => `potion:${id}`),
  ...ALL_SCROLLS.map((id): ItemId => `scroll:${id}`),
];
const IDENTIFIABLE: ItemId[] = [
  ...ALL_POTIONS.map((id): ItemId => `potion:${id}`),
  ...ALL_SCROLLS.map((id): ItemId => `scroll:${id}`),
];

/** Exercise composed production text, rather than only the catalog's source keys. */
function expectEnglish(value: unknown): void {
  if (typeof value === 'string') {
    if (han.test(value)) {
      const translated = english(value);
      expect(translated, value).not.toMatch(han);
      expect(english(`：${value}`), `class/detail prefix: ${value}`).not.toMatch(han);
      expect(translated.trim(), value).not.toBe('');
      expect(translated, value).not.toMatch(/\{\d+\}/);
    }
  } else if (Array.isArray(value)) value.forEach(expectEnglish);
  else if (value && typeof value === 'object') Object.values(value).forEach(expectEnglish);
}

function visibleRuns(markup: string): string[] {
  const text = Array.from(markup.matchAll(/>([^<]*)</g), m => m[1]!);
  const labels = Array.from(markup.matchAll(/\b(?:aria-label|title|alt)="([^"]*)"/g), m => m[1]!);
  return [...text, ...labels];
}

describe('English world and item presentation', () => {
  it('preserves every numbered placeholder and contains only text keys and English values', () => {
    for (const [source, translated] of Object.entries(worldEnglish)) {
      const placeholders = (text: string) => Array.from(text.matchAll(/\{\d+\}/g), m => m[0]).sort();
      expect(placeholders(translated), source).toEqual(placeholders(source));
      expect(source, source).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(translated, source).not.toMatch(han);
      expect(translated.trim(), source).not.toBe('');
    }
  });

  it.each(ALL_CLASSES)('translates all actual %s class descriptions and talents', cls => {
    expectEnglish(classInfo(cls));
  });

  it.each(ALL_CLASSES)('translates known and unidentified %s inventory content at multiple upgrade levels', cls => {
    const w = new World(testLevel(OPEN_ROOM), { cls });
    for (const known of [false, true]) {
      w.player.known = known ? [...IDENTIFIABLE] : [];
      for (const id of ITEMS) {
        for (const level of [0, 2, 5]) {
          expectEnglish(itemName(w, id, level));
          expectEnglish(itemDesc(w, id, level));
        }
        expectEnglish(itemAppearance(w, id));
        expectEnglish(itemCategoryLabel(w, id));
      }
    }
  });

  it('translates actual weapon summaries, comparisons, and joined inspector details', () => {
    for (const level of [0, 1, 5]) {
      for (const id of ALL_WEAPONS) {
        const stats = weaponPresentation(id, level);
        expectEnglish(stats);
        for (const current of ALL_WEAPONS) {
          const comparison = compareWeapons(id, level, current, 0);
          expectEnglish(comparison);
          expectEnglish(`${stats.details}。${comparison.details}`);
        }
      }
      expectEnglish(bowPresentation(level));
    }
  });

  it('translates armor caps, all comparison directions, and Lightstep modifiers', () => {
    for (const level of [0, 1, 5]) {
      for (const id of ALL_ARMORS) {
        for (const speed of [1, 1.5]) {
          const stats = armorPresentation(id, level, speed);
          expectEnglish(stats);
          for (const current of ALL_ARMORS) {
            const comparison = compareArmors(id, level, current, 0, speed);
            expectEnglish(comparison);
            expectEnglish(`${stats.details}。${comparison.details}`);
          }
        }
      }
    }
  });

  it.each(ALL_CLASSES)('translates %s upgrade choices, including capped and legacy targets', cls => {
    const w = new World(testLevel(OPEN_ROOM), { cls });
    for (const level of [0, 1, 5]) {
      w.player.bowLevel = level;
      for (const id of ALL_WEAPONS) {
        w.player.weapon = { id, level };
        expectEnglish(upgradeLabel(w, 'weapon'));
      }
      for (const id of ALL_ARMORS) {
        w.player.armor = { id, level };
        expectEnglish(upgradeLabel(w, 'armor'));
      }
      expectEnglish(upgradeLabel(w, 'bow'));
      expectEnglish(upgradeLabel(w, 'shield'));
    }
  });

  it('translates identification card text and accessible labels without revealing unknown identities', () => {
    const w = new World(testLevel(OPEN_ROOM), { cls: 'huntress' });
    w.player.known = [];
    const options = IDENTIFIABLE.map(id => ({ id, level: 0, count: 3 }));
    for (const learned of [false, true]) {
      expectEnglish(identifyChoiceDescription(learned));
      expectEnglish(visibleRuns(identifyChoiceMarkup(w, options, learned)));
      expectEnglish(visibleRuns(identifyChoiceMarkup(w, [], learned)));
    }
    expect(english(`${itemAppearance(w, 'potion:healing')} · 未知藥水`)).toMatch(/ Bottle · Unknown Potion$/);
  });

  it('translates room names, map names, trial objectives and hints', () => {
    expectEnglish(LAYOUTS.map(room => room.name));
    expectEnglish([...RUN_TEMPLATES, TEMPLATE_ARENA, TEMPLATE_PRACTICE].map(template => template.name));
    for (const trial of PRACTICE_TRIALS) expectEnglish([trial.name, trial.objective, trial.hint]);
  });

  it('translates actual boss test loadouts for both classes and every preset', () => {
    expectEnglish(BOSS_TEST_PRESETS);
    for (const cls of ALL_CLASSES) {
      for (const preset of Object.keys(BOSS_TEST_PRESETS) as BossTestPreset[]) {
        expectEnglish(bossTestLoadout(createBossTestWorld(cls, preset)));
      }
    }
  });

  it('uses natural English for representative dynamic output', () => {
    expect(english(weaponPresentation('knife', 1).summary))
      .toBe('Primary damage 4 · Reach 1.6 m · Base time 0.4 s · Max targets: 1 · Ambush ×2');
    expect(english(compareWeapons('axe', 0, 'longsword', 0).summary))
      .toBe('Compared with equipped Longsword +0: primary damage +3 · Reach +0.1 m · Action slower by 0.4 s');
    expect(english('赤紅符文卷軸')).toBe('Crimson Rune Scroll');
    expect(english('轉化完成：麻痺箭 +2（2 / 4）')).toBe('Conversion complete: Paralysis Arrow +2 (2 / 4)');
    expect(english('E 走下階梯（第 3 層）')).toBe('E Descend Stairs (Floor 3)');
  });
});
