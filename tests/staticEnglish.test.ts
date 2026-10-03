import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { staticEnglish } from '../src/ui/locales/static';

const han = /\p{Script=Han}/u;
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

/** Keep DOM text-node boundaries; hidden UI counts, intentionally bilingual UI does not. */
function htmlRuns(source: string): string[] {
  const runs: string[] = [];
  const parents: { tag: string; excluded: boolean }[] = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  for (const match of source.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][^>]*>|[^<]+/gi)) {
    const token = match[0];
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const tag = /^<\/([a-z][\w-]*)/i.exec(token)![1]!.toLowerCase();
      const index = parents.map(parent => parent.tag).lastIndexOf(tag);
      if (index >= 0) parents.length = index;
      continue;
    }
    const parentExcluded = parents[parents.length - 1]?.excluded ?? false;
    if (token.startsWith('<')) {
      const tag = /^<([a-z][\w-]*)/i.exec(token)![1]!.toLowerCase();
      const excluded = parentExcluded || ['script', 'style', 'noscript'].includes(tag)
        || /\bdata-no-localize(?:\s|=|>)/i.test(token) || /\bid=["']boot-status["']/i.test(token);
      if (!excluded) {
        for (const attr of token.matchAll(/\b(?:title|aria-label|placeholder)=["']([^"']*)["']/g)) runs.push(attr[1]!.trim());
      }
      if (!voidTags.has(tag) && !/\/\s*>$/.test(token)) parents.push({ tag, excluded });
    } else if (!parentExcluded) runs.push(token.trim());
  }
  return [...new Set(runs.filter(Boolean))];
}

function sourceStrings(file: string): string[] {
  const path = new URL(file, import.meta.url);
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest);
  const strings: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node) && han.test(node.text)) strings.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return strings;
}

describe('English static UI coverage', () => {
  it('covers every Chinese DOM text run and visible attribute, including hidden screens', () => {
    const missing = htmlRuns(html).filter(text => han.test(text) && staticEnglish[text] === undefined);
    expect(missing).toEqual([]);
  });

  it.each(['../src/ui/fullscreen.ts', '../src/ui/controlText.ts', '../src/ui/failure.ts'])('covers display strings in %s', file => {
    const missing = sourceStrings(file).filter(text => staticEnglish[text] === undefined);
    expect(missing).toEqual([]);
  });

  it('excludes intentional bilingual selectors and the no-JavaScript bootstrap fallback', () => {
    const source = '<div id="boot-status">遊戲載入中<a title="重新載入">重新載入</a></div>'
      + '<label data-no-localize>語言<select aria-label="語言"><option>繁體中文</option></select></label>'
      + '<p title="遊戲畫面">開始試玩</p>';
    expect(htmlRuns(source)).toEqual(['遊戲畫面', '開始試玩']);
  });

  it('covers the landing privacy disclosure and interrupted-loading pause reason', () => {
    const main = sourceStrings('../src/main.ts');
    const messages = main.filter(text => text.startsWith('本試玩會把遊玩事件')
      || text === '這次試玩不傳送分析資料。' || text.startsWith('（載入期間已中斷'));
    expect(messages).toHaveLength(3);
    expect(messages.filter(text => staticEnglish[text] === undefined)).toEqual([]);
  });

  it('contains nonempty English values and no HTML-tag keys', () => {
    for (const [source, translated] of Object.entries(staticEnglish)) {
      expect(source, source).not.toMatch(/<\/?[a-z][^>]*>/i);
      expect(translated.trim(), source).not.toBe('');
      expect(translated, source).not.toMatch(han);
    }
  });

  it('keeps inline help wording readable across text-node boundaries', () => {
    const phrases = [
      ['第一章有', '4 個探索層＋1 個首領層', '。前四層找到', '往下的階梯', '並探索補給；第五層擊倒守心者後，取得', '沉眠之心', '通關。探索層不必殺光敵人。'],
      ['右下', '攻擊', '鍵可一邊按住、一邊拖曳瞄準，左手仍可移動。點一下開始一次攻擊；按住會在收招後接著出手。'],
      ['按住', '空白鍵／觸控「等待」', '讓時間正常流動（等巡邏走過、等煙霧散）。'],
      ['潛行', '點一下開啟，再點關閉；', '等待', '須按住。煙霧鍵每按一次投一瓶。靠近門、寶箱與階梯後點', '互動', '。'],
    ].map(parts => parts.map(part => staticEnglish[part]).join(''));
    expect(phrases[0]).toContain('claim The Slumbering Heart');
    expect(phrases[1]).toContain('bottom-right Attack button');
    expect(phrases[2]).toContain('Hold Space / the touch Wait button to let time flow');
    expect(phrases[3]).toContain('Sneak toggles');
    expect(phrases[3]).toContain('Wait must be held.');
    expect(phrases[3]).toContain('tap Interact.');
  });

  it('uses the agreed proper names consistently', () => {
    expect(staticEnglish['沉眠之心']).toBe('The Slumbering Heart');
    expect(staticEnglish['戰士']).toBe('Warrior');
    expect(staticEnglish['獵手']).toBe('Huntress');
    expect(staticEnglish['盾衛']).toBe('Shield Guard');
    expect(staticEnglish['弩手']).toBe('Crossbowman');
    expect(staticEnglish['突進者']).toBe('Charger');
    expect(staticEnglish['守心者']).toBe('Heart Warden');
  });
});
