import { describe, expect, it } from 'vitest';
import { controlText } from '../src/ui/controlText';

describe('touch hints keep their gameplay meaning without requiring keyboard keys', () => {
  it.each([
    ['E 打開寶箱', '互動：打開寶箱'],
    ['按 I 打開背包（世界暫停）', '點「背包」（世界暫停）'],
    ['按住 Shift 潛行步就不會出聲', '開啟「潛行」就不會出聲'],
    ['再按 3 切換', '再點藥劑箭切換'],
    ['出現「放箭」就左鍵', '出現「放箭」就點「射擊」'],
    ['右鍵或 F 近身推退 1 m', '點「推擊」 近身推退 1 m'],
    ['按 E 取走沉眠之心', '點「互動」取走沉眠之心'],
    ['Esc 可重置；Tab 地圖', '暫停選單 可重置；地圖 地圖'],
    ['靜止時世界以慢動作流動', '靜止時世界以慢動作流動'],
  ])('%s', (source, expected) => {
    expect(controlText(source, true)).toBe(expected);
    expect(controlText(source, false)).toBe(source);
  });
});
