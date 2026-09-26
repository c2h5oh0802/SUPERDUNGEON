import { describe, expect, it } from 'vitest';
import { CLASSES, PLAYER, RUN } from '../src/config';
import { levelSignature } from '../src/gen/generator';
import { generateLevel } from '../src/gen/validate';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';

// 逐層骨架：樓層生成、跨層保留、存檔與續玩。

describe('樓層生成', () => {
  it('同一個種子：每一層都固定；不同樓層是不同的地城', () => {
    for (let f = 1; f <= RUN.floors; f++) {
      expect(levelSignature(generateLevel('FLOORS', { floor: f }))).toBe(levelSignature(generateLevel('FLOORS', { floor: f })));
    }
    const sigs = new Set([1, 2, 3, 4].map((f) => levelSignature(generateLevel('FLOORS', { floor: f }))));
    expect(sigs.size).toBe(RUN.floors);
  });

  it('種子 1–40 的每一層都是合法地城；前幾層是往下的階梯，最底層是沉眠之心', () => {
    for (let k = 1; k <= 40; k++) {
      for (let f = 1; f <= RUN.floors; f++) {
        const l = generateLevel(`S${k}`, { floor: f });
        expect(l.floor).toBe(f);
        expect(l.goal).toBe(f < RUN.floors ? 'descend' : 'heart');
        expect(l.heart).not.toBeNull();
      }
    }
  }, 60000);

  it('越深越難：敵人平均數量與醒著的比例隨樓層增加；最底層的沉眠之心旁有守衛', () => {
    const avg = (f: number, pick: (n: number, awake: number) => number) => {
      let sum = 0;
      for (let k = 1; k <= 20; k++) {
        const l = generateLevel(`D${k}`, { floor: f });
        sum += pick(l.enemies.length, l.enemies.filter((e) => e.state !== 'sleep').length);
      }
      return sum / 20;
    };
    const counts = [1, 2, 3, 4].map((f) => avg(f, (n) => n));
    const awake = [1, 2, 3, 4].map((f) => avg(f, (n, a) => a / n));
    for (let f = 1; f < RUN.floors; f++) expect(counts[f]!).toBeGreaterThan(counts[f - 1]!);
    expect(awake[3]!).toBeGreaterThan(awake[0]!);
    for (let k = 1; k <= 10; k++) {
      const l = generateLevel(`G${k}`, { floor: RUN.floors });
      const h = l.heart!;
      const near = l.enemies.filter((e) => e.roomKey === h.roomKey && Math.hypot(e.x - h.x, e.z - h.z) <= 5.2);
      expect(near.length).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('跨層保留與存檔', () => {
  it('生命、物資、藥劑箭、刻印與統計帶到下一層', () => {
    const run = newRun('CARRY', 'huntress');
    const w = createFloorWorld(run);
    w.damagePlayer(3, '測試', w.player.x, w.player.z);
    w.player.arrows = 5;
    w.player.tipped.chill = 0;
    w.player.tipKind = 'chill';
    w.applyRune('vigor');
    w.stats.kills = 4;
    const next = nextFloor(run, w);
    const w2 = createFloorWorld(next);
    const p = w2.player;
    expect([p.hp, p.maxHp]).toEqual([PLAYER.maxHp - 3 + 4, PLAYER.maxHp + 4]);
    expect([p.arrows, p.tipped.paralysis, p.tipped.chill, p.tipKind]).toEqual([5, CLASSES.huntress.start.paralysis, 0, 'chill']);
    expect(p.runes).toEqual(['vigor']);
    expect(w2.stats.kills).toBe(4);
    expect(w2.stats.damageTaken['測試']).toBe(3);
    expect(w2.level.floor).toBe(2);
  });

  it('存檔來回一致；從存檔繼續得到同一層、同樣的物資', () => {
    const run = newRun('SAVE1', 'warrior');
    const w = createFloorWorld(run);
    w.player.stones = 1;
    const next = nextFloor(run, w);
    const back = parseRun(serializeRun(next))!;
    expect(back).toEqual(next);
    const a = createFloorWorld(next);
    const b = createFloorWorld(back);
    expect(levelSignature(a.level)).toBe(levelSignature(b.level));
    expect(b.player.stones).toBe(1);
  });

  it('壞掉或被竄改的存檔不會被接受', () => {
    const good = JSON.parse(serializeRun(nextFloor(newRun('BAD', 'warrior'), createFloorWorld(newRun('BAD', 'warrior')))));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 測試故意竄改任意欄位
    const bad = (patch: (o: Record<string, any>) => void) => {
      const o = structuredClone(good);
      patch(o);
      return parseRun(JSON.stringify(o));
    };
    expect(parseRun(null)).toBeNull();
    expect(parseRun('not json')).toBeNull();
    expect(bad((o) => (o.v = 99))).toBeNull();
    expect(bad((o) => (o.floor = 9))).toBeNull();
    expect(bad((o) => (o.cls = 'wizard'))).toBeNull();
    expect(bad((o) => (o.carry.hp = 999))).toBeNull();
    expect(bad((o) => (o.carry.arrows = -1))).toBeNull();
    expect(bad((o) => (o.carry.runes = ['hax']))).toBeNull();
    expect(bad((o) => (o.carry = null))).toBeNull();
    expect(parseRun(JSON.stringify(good))).not.toBeNull();
  });
});
