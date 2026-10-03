import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { controlText } from '../src/ui/controlText';
import { ENGLISH, english } from '../src/ui/i18n';
import { DEFAULT_SETTINGS, SettingsStore } from '../src/ui/settings';
const han = /\p{Script=Han}/u;

afterEach(() => vi.unstubAllGlobals());
describe('display-only language selection', () => {
  it('defaults new and old settings to English, independent of browser language', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => '{"sensitivity":1.2}', setItem: vi.fn() }, navigator: { language: 'zh-TW' } });
    expect(DEFAULT_SETTINGS.language).toBe('en');
    expect(new SettingsStore().load().language).toBe('en');
  });
  it('persists only in settings and validates unsupported values', () => {
    const stored = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => stored.get(k), setItem: (k: string, v: string) => stored.set(k, v) } });
    const store = new SettingsStore();
    store.update({ language: 'zh-Hant' });
    expect(new SettingsStore().load().language).toBe('zh-Hant');
    expect([...stored.keys()]).toEqual(['superdungeon.settings.v1']);
    stored.set('superdungeon.settings.v1', '{"language":"other"}');
    expect(new SettingsStore().load().language).toBe('en');
  });
  it('keeps the selected language for the visit when storage is blocked', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } });
    const store = new SettingsStore();
    store.load();
    expect(store.persistent).toBe(false);
    store.update({ language: 'zh-Hant' });
    expect(store.value.language).toBe('zh-Hant');
    expect(store.persistent).toBe(false);
  });
  it('does not modify analytics tokens or source values', () => {
    for (const token of ['arrow_deflect', 'core_unassisted', 'potion:healing', 'PLAYTEST-CORE', 'warrior']) expect(english(token)).toBe(token);
  });
  it('translates punctuation and preserves inline spacing', () => {
    expect(english('。')).toBe('.');
    expect(english('目前裝備')).toBe('Equipped Gear');
  });
});

describe('dynamic English presentation coverage', () => {
  it.each(['../src/main.ts', '../src/ui/hud.ts', '../src/playtest/calibration.ts'])('covers visible literals/templates from %s', file => {
    const path = new URL(file, import.meta.url);
    const ast = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const sources = new Set<string>();
    function visit(node: ts.Node): void {
      let value: string | undefined;
      if (ts.isStringLiteralLike(node)) value = node.text;
      else if (ts.isTemplateExpression(node)) value = node.head.text + node.templateSpans.map((span, i) => `{${i}}${span.literal.text}`).join('');
      if (value && han.test(value)) {
        for (const part of value.split(/<[^>]*>/)) if (han.test(part)) sources.add(part.trim());
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    const missing = [...sources].filter(s => ENGLISH[s] === undefined && han.test(english(s.replace(/\{\d+\}/g, '2'))));
    expect(missing).toEqual([]);
  });
  it('handles actual composed calibration cues, pause metrics and nested class names', () => {
    const samples = [
      '練習以半血開始（5/10）；這裡受傷最低保留 1 生命。\n停下會讓時間變慢；移動與行動會推進時間。觀察盾衛的預備動作，用自己的方式擊倒他。',
      '治療已完成。走到前方的門，按E開門後直接走進去。進門後不再保留 1 點生命。未知藥水可以留著。',
      '戰士 · 種子 DEMO · 第 1 / 5 層 （視窗失去焦點）',
      '操作校準 （載入期間已中斷，請按繼續）',
      '戰士 · 種子 DEMO · 第 1 / 5 層 （視窗失去焦點） · 自由遊玩，不存檔',
      '核心遭遇 · 重試以滿血與初始戰士配裝開始，不保留本次物品',
      '升到第 2 級！最大生命 +1',
      '藥劑箭：麻痺（再按 3 切換）',
      '戰士 · 種子 DEMO · 地城「環形中庭（鏡像）」 · 自由遊玩結束（不影響已完成的核心測試）',
    ];
    for (const s of samples) expect(english(s), s).not.toMatch(han);
  });
  it('separates class names from result actions naturally', () => {
    expect(english('換成獵手重打 Boss')).toBe('Retry boss as Huntress');
    expect(english('換成戰士（同種子）')).toBe('Switch to Warrior (same seed)');
    expect(english('換成獵手重置練習')).toBe('Restart practice as Huntress');
  });
  it('translates touch-adjusted hints while keeping touch instructions', () => {
    const original = '撿到物品了：按 I 打開背包（世界暫停），可以使用、裝備或放下物品。';
    const translated = english(controlText(original, true));
    expect(translated).not.toMatch(han);
    expect(translated).toContain('Tap Inventory');
    expect(translated).not.toContain('Press I');
  });
});
