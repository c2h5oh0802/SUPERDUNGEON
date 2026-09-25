import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/config';
import { ENCOUNTERS, runEncounter, type Result } from './balanceBots';

// 平衡模擬（純模擬層）：完美瞄準的兩職業機器人打同一組遭遇。
// 目標（見 docs/classes.md）：沒有一個職業在所有遭遇都零傷害又最快；獵手在盾衛與突進者上不能明顯比戰士安全。
// 這只是第一道檢查，真人試玩才是最終判斷。

const REACTIONS = [0, 0.2, 0.35];

function table(): Array<{ enc: string; react: number; w: Result; h: Result }> {
  const rows = [];
  for (const react of REACTIONS)
    for (const enc of ENCOUNTERS) rows.push({ enc: enc.name, react, w: runEncounter('warrior', enc, react), h: runEncounter('huntress', enc, react) });
  return rows;
}

const fmt = (r: Result) =>
  `${r.cleared ? '清除' : r.dead ? '死亡' : '未清除'} ${r.worldTime.toFixed(1)}s 傷${r.damage}` +
  (r.arrows || r.tipped ? ` 箭${r.arrows}+${r.tipped}` : '') +
  (r.stones ? ` 石${r.stones}` : '');

describe('平衡模擬：完美瞄準的兩個職業', () => {
  const rows = table();
  it('輸出結果表', () => {
    const lines = ['| 遭遇 | 反應延遲 | 戰士 | 獵手 |', '|---|---|---|---|'];
    for (const r of rows) lines.push(`| ${r.enc} | ${r.react}s | ${fmt(r.w)} | ${fmt(r.h)} |`);
    console.log(lines.join('\n'));
    expect(rows.length).toBe(ENCOUNTERS.length * REACTIONS.length);
  });

  it('沒有一個職業在所有遭遇都零傷害又最快', () => {
    for (const react of REACTIONS) {
      const rs = rows.filter((r) => r.react === react);
      const dominates = (me: 'w' | 'h', other: 'w' | 'h') =>
        rs.every((r) => r[me].cleared && r[me].damage === 0 && (!r[other].cleared || r[me].worldTime <= r[other].worldTime));
      expect(dominates('h', 'w')).toBe(false);
      expect(dominates('w', 'h')).toBe(false);
    }
  });

  it('獵手打盾衛、突進者不會明顯比戰士安全（有反應延遲時）', () => {
    for (const react of [0.2, 0.35])
      for (const enc of ['單一盾衛', '單一突進者', '兩個盾衛', '突進者＋盾衛']) {
        const r = rows.find((x) => x.enc === enc && x.react === react)!;
        const safer = r.h.cleared && r.h.damage < r.w.damage && r.h.worldTime < r.w.worldTime;
        expect(safer, `${enc}: 戰士 ${fmt(r.w)} / 獵手 ${fmt(r.h)}`).toBe(false);
      }
  });

  it('對照：關掉「盾衛舉盾」與「突進者角盔」時，獵手的結果（調整前 vs 調整後）', () => {
    const g = ENEMIES.guard as { raiseRange: number };
    const c = ENEMIES.charger as { helmet: boolean };
    const saved = { raise: g.raiseRange, helmet: c.helmet };
    const lines = ['| 遭遇 | 獵手（沒有舉盾與角盔） | 獵手（現在） | 戰士（現在） |', '|---|---|---|---|'];
    try {
      g.raiseRange = 0;
      c.helmet = false;
      for (const enc of ENCOUNTERS) {
        const before = runEncounter('huntress', enc, 0.2);
        const r = rows.find((x) => x.enc === enc.name && x.react === 0.2)!;
        lines.push(`| ${enc.name} | ${fmt(before)} | ${fmt(r.h)} | ${fmt(r.w)} |`);
        if (enc.name === '單一盾衛') expect(before.worldTime).toBeLessThan(r.h.worldTime);
      }
    } finally {
      g.raiseRange = saved.raise;
      c.helmet = saved.helmet;
    }
    console.log(lines.join('\n'));
  });
});
