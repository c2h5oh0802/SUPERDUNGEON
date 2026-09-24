import { describe, expect, it } from 'vitest';
import { PLAYER } from '../src/config';
import { buildLevel, levelSignature } from '../src/gen/generator';
import { generateLevel, validateLevel } from '../src/gen/validate';
import { T } from '../src/sim/grid';
import { Nav } from '../src/sim/nav';

const SEEDS = Array.from({ length: 200 }, (_, i) => `S${i + 1}`);

describe('地城生成', () => {
  it('種子 1–200 全部產生合法地城（擴張後可達、出生安全、陷阱可繞開）', () => {
    const templates = new Set<string>();
    const mirrors = new Set<boolean>();
    let retries = 0;
    for (const seed of SEEDS) {
      const l = generateLevel(seed);
      expect(validateLevel(l).ok).toBe(true);
      templates.add(l.templateId);
      mirrors.add(l.mirrored);
      retries += l.attempt;
    }
    expect(templates).toEqual(new Set(['A', 'B']));
    expect(mirrors.size).toBe(2);
    // 手工佈局應幾乎不需要重試
    expect(retries).toBeLessThan(20);
  });

  it('同種子重建出完全相同的初始內容；不同種子會不同', () => {
    const a = levelSignature(generateLevel('SAME1'));
    const b = levelSignature(generateLevel('SAME1'));
    const c = levelSignature(generateLevel('OTHER'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('兩個模板的路線安排真的不同（環線 vs 單向捷徑）', () => {
    const a = buildLevel('X', 0, { template: 'A' });
    const b = buildLevel('X', 0, { template: 'B' });
    expect(a.grid.doors.some((d) => d.barred)).toBe(false);
    expect(b.grid.doors.some((d) => d.barred)).toBe(true);
    expect(a.rooms.map((r) => r.key).sort()).not.toEqual(b.rooms.map((r) => r.key).sort());
  });

  it('模板 B：不經過單向門也能抵達沉眠之心，而捷徑在拉開門閂後連通', () => {
    const l = generateLevel('SHORT', { template: 'B' });
    const nav = new Nav(l.grid, PLAYER.radius);
    const barred = nav.flood(l.spawn.x, l.spawn.z, false);
    const heartCell = nav.nearestPassable(l.heart!.x + 1.2, l.heart!.z);
    expect(barred[heartCell]).toBe(1);
    const shortcut = l.grid.doors.find((d) => d.barred)!;
    // 門閂拉開前：從入口側走不到閂門小室
    const scRoom = l.rooms.find((r) => r.key === 'SC')!;
    const scCell = nav.nearestPassable(scRoom.x0 + scRoom.w / 2, scRoom.z0 + scRoom.h / 2 + 1.5);
    expect(barred[scCell]).toBe(1); // 經由沉眠之心房可以走到
    shortcut.barred = false;
    const open = nav.flood(l.spawn.x, l.spawn.z, false);
    expect(open[scCell]).toBe(1);
  });

  it('入口房沒有敵人、沒有寶物被放在自己才能開的門後', () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const l = generateLevel(seed);
      const e = l.rooms.find((r) => r.role === 'entrance')!;
      for (const en of l.enemies) {
        const inside = en.x >= e.x0 && en.x < e.x0 + e.w && en.z >= e.z0 && en.z < e.z0 + e.h;
        expect(inside).toBe(false);
      }
      expect(l.altars.length).toBe(2);
      expect(l.chests.length).toBeGreaterThanOrEqual(1);
      // 兩座祭壇的刻印互不重複，四個刻印都會出現
      const offered = l.altars.flatMap((a) => a.offer);
      expect(new Set(offered).size).toBe(4);
    }
  });

  it('練習場可生成且有補給台', () => {
    const l = generateLevel('PRACTICE', { practice: true });
    expect(l.resupply).not.toBeNull();
    expect(l.grid.get(Math.floor(l.spawn.x), Math.floor(l.spawn.z))).toBe(T.Floor);
  });
});
