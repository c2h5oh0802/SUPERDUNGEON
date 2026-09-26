import { describe, expect, it } from 'vitest';
import { PLAYER, RUN } from '../src/config';
import { createFloorWorld, newRun, nextFloor } from '../src/sim/run';
import { angleDiff, yawFromDir } from '../src/core/math';
import { generateLevel } from '../src/gen/validate';
import { Nav } from '../src/sim/nav';
import { emptyInput, type FrameInput } from '../src/sim/types';
import { World } from '../src/sim/world';

const dt = 1 / 60;

/** 以正常輸入（移動、轉向、E）沿導航路徑走到目標；遇到關閉的門就開門。 */
function walkTo(w: World, tx: number, tz: number, arrive = 0.9, maxFrames = 20000): boolean {
  const nav = new Nav(w.grid, PLAYER.radius);
  let yaw = w.player.yaw;
  for (let f = 0; f < maxFrames; f++) {
    const p = w.player;
    if (Math.hypot(tx - p.x, tz - p.z) <= arrive) return true;
    if (w.outcome !== 'none') return false;
    const path = f % 10 === 0 || !walkTo.cache ? nav.findPath(p.x, p.z, tx, tz) : walkTo.cache;
    walkTo.cache = path;
    if (!path || !path.length) return false;
    let wp = path[0]!;
    if (path.length > 1 && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.5) wp = path[1]!;
    yaw = yawFromDir(wp.x - p.x, wp.z - p.z);
    const input: FrameInput = { ...emptyInput(yaw, 0), moveZ: 1 };
    // 前方有關閉的門：停下開門
    const door = w.grid.doors.find((d) => !d.arch && !d.barred && d.progress < 0.999 && Math.hypot(d.cx - p.x, d.cz - p.z) < 1.6);
    if (door && !p.action) {
      if (door.target === 0) {
        const faceDoor = yawFromDir(door.cx - p.x, door.cz - p.z);
        w.frame(dt, { ...emptyInput(faceDoor, 0), interact: true });
      } else w.frame(dt, { ...emptyInput(yaw, 0), wait: true });
      continue;
    }
    if (Math.abs(angleDiff(yaw, p.yaw)) > 2) input.moveZ = 0.3;
    w.frame(dt, input);
  }
  return false;
}
walkTo.cache = null as ReturnType<Nav['findPath']>;

function interactWith(w: World, x: number, z: number): void {
  const p = w.player;
  for (let k = 0; k < 200 && w.player.action; k++) w.frame(dt, emptyInput(p.yaw, 0));
  const yaw = yawFromDir(x - p.x, z - p.z);
  w.frame(dt, emptyInput(yaw, 0));
  w.frame(dt, { ...emptyInput(yaw, 0), interact: true });
  for (let k = 0; k < 200 && w.player.action; k++) w.frame(dt, emptyInput(yaw, 0));
}

describe('完整流程（模擬層，移除敵人以單獨驗證路線、門、樓層與勝利條件）', () => {
  for (const [seed, cls] of [
    ['FLOW1', 'warrior'],
    ['FLOW2', 'huntress'],
    ['FLOW3', 'warrior'],
    ['FLOW4', 'huntress'],
  ] as const) {
    it(`種子 ${seed}（${cls}）：第 1 層 → 往下的階梯 → … → 第 ${RUN.floors} 層取得沉眠之心 → 通關`, () => {
      let run = newRun(seed, cls);
      let prevTime = 0;
      for (let f = 1; f <= RUN.floors; f++) {
        const w = createFloorWorld(run);
        expect(w.level.floor).toBe(f);
        expect(w.player.cls).toBe(cls);
        expect(w.level.goal).toBe(f < RUN.floors ? 'descend' : 'heart');
        if (f === 2) expect(w.player.hp).toBe(PLAYER.maxHp - 2);
        expect(w.stats.worldTime).toBeCloseTo(prevTime, 6);
        w.enemies.length = 0;
        // 來時的階梯不能用
        const s = w.level.stairs!;
        expect(walkTo(w, s.front.x, s.front.z, 0.6)).toBe(true);
        interactWith(w, s.front.x + s.rise.x * 1.5, s.front.z + s.rise.z * 1.5);
        expect(w.outcome).toBe('none');
        if (f === 1) w.damagePlayer(2, '測試', w.player.x, w.player.z);
        const h = w.level.heart!;
        expect(walkTo(w, h.x, h.z + 1.3, 0.4)).toBe(true);
        interactWith(w, h.x, h.z);
        if (f < RUN.floors) {
          expect(w.outcome).toBe('descend');
          expect(w.heartTaken).toBe(false);
          prevTime = w.stats.worldTime;
          run = nextFloor(run, w);
          expect(run.floor).toBe(f + 1);
        } else {
          expect(w.heartTaken).toBe(true);
          expect(w.outcome).toBe('win');
        }
      }
    });
  }

  it('刻印祭壇：互動後暫停等待選擇，選擇後生效且祭壇用掉', () => {
    const l = generateLevel('FLOW1');
    const w = new World(l);
    w.enemies.length = 0;
    const a = l.altars[0]!;
    expect(walkTo(w, a.x - Math.sin(a.yaw) * 1.3, a.z - Math.cos(a.yaw) * 1.3, 0.5)).toBe(true);
    interactWith(w, a.x, a.z);
    expect(w.pendingAltar).not.toBeNull();
    // 暫停中世界不前進
    const t0 = w.time;
    w.frame(dt, { ...emptyInput(), moveZ: 1 });
    expect(w.time).toBe(t0);
    w.chooseRune(a.offer[0]);
    expect(w.player.runes).toContain(a.offer[0]);
    expect(w.pendingAltar).toBeNull();
    const it = w.interactables.find((i) => i.kind === 'altar' && i.ref === 0)!;
    expect(it.used).toBe(true);
  });

  it('死亡：生命歸零 → outcome 為 dead，世界停止', () => {
    const l = generateLevel('FLOW1');
    const w = new World(l);
    w.damagePlayer(100, '測試', w.player.x, w.player.z);
    expect(w.outcome).toBe('dead');
    const t0 = w.time;
    w.frame(dt, { ...emptyInput(), wait: true });
    expect(w.time).toBe(t0);
  });
});

describe('結算資訊', () => {
  it('記錄致命一擊的來源', () => {
    const w = new World(generateLevel('FLOW1'));
    w.damagePlayer(3, '盾衛的劍', w.player.x, w.player.z);
    w.damagePlayer(99, '突進者的衝撞', w.player.x, w.player.z);
    expect(w.deathCause).toBe('突進者的衝撞');
    expect(w.stats.damageTaken['盾衛的劍']).toBe(3);
  });
});
