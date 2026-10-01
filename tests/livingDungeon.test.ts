import { describe, expect, it } from 'vitest';
import { ENEMIES, PERCEPTION, STEALTH, WEAPONS, type WeaponId } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { generateLevel } from '../src/gen/validate';
import { becomeAlert, damageEnemy } from '../src/sim/enemySys';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput, type EnemyState } from '../src/sim/types';
import { World } from '../src/sim/world';
import { finishAction, makeWorld, testLevel } from './helpers';

const ROOMS = [
  '############',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#####DD#####',
  '#..........#',
  '#..........#',
  '#..........#',
  '#..........#',
  '#...@......#',
  '############',
];

function scenario(state: 'idle' | 'sleep' = 'idle') {
  const level = testLevel(ROOMS, [{ kind: 'guard', x: 3.5, z: 2.5, yaw: 0, state }]);
  level.rooms = [
    { key: 'A', role: 'combat', tier: 1, optional: false, layoutId: 'test', name: 'north', x0: 1, z0: 1, w: 10, h: 4 },
    { key: 'B', role: 'combat', tier: 1, optional: false, layoutId: 'test', name: 'south', x0: 1, z0: 6, w: 10, h: 5 },
  ];
  const w = new World(level);
  w.player.invisT = 1000; // 固定測試遮蔽，非真人流程證據。
  return w;
}

function until(w: World, state: EnemyState, max = 40) {
  for (let k = 0; k < max * 60 && w.enemies[0]!.state !== state; k++) w.advance(1 / 60);
  expect(w.enemies[0]!.state).toBe(state);
}

describe('活的地下城 v1', () => {
  it.each(['sleep', 'idle'] as const)('%s：聲音只提供事件位置，抵達後搜索並恢復活動', (state) => {
    const w = scenario(state);
    const e = w.enemies[0]!;
    w.emitNoise(6, 1, 2.5, 8, 'stone');
    expect(e.state).toBe('investigate');
    expect(e.target).toEqual({ x: 6, z: 2.5 });
    expect(e.lastKnown).toBeNull();
    w.player.x = 9;
    w.player.z = 9;
    w.advance(0.2);
    expect(e.target).toEqual({ x: 6, z: 2.5 });
    until(w, 'search');
    until(w, 'patrol');
    expect(e.target).toBeNull();
    expect(e.lastKnown).toBeNull();
  });

  it('調查時看到玩家才進入追擊；重新發現也能從搜索回追擊', () => {
    const w = scenario();
    const e = w.enemies[0]!;
    w.emitNoise(6, 1, 2.5, 8, 'stone');
    w.player.invisT = 0;
    w.player.x = 6;
    w.player.z = 2.5;
    e.yaw = yawFromDir(6 - e.x, 2.5 - e.z);
    until(w, 'alert', 3);
    expect(e.lastKnown).toEqual({ x: 6, z: 2.5 });
    w.player.invisT = 1000;
    until(w, 'search', 6);
    w.player.x = e.x + 2;
    w.player.z = e.z;
    w.player.invisT = 0;
    e.yaw = yawFromDir(2, 0);
    until(w, 'alert', 3);
    expect(e.lastKnown).toEqual({ x: w.player.x, z: w.player.z });
  });

  it('跨牆移動不更新最後已知位置；前往該位置後進行有限搜索', () => {
    const w = scenario();
    const e = w.enemies[0]!;
    w.player.x = 7;
    w.player.z = 2.5;
    w.player.invisT = 0;
    e.yaw = yawFromDir(w.player.x - e.x, w.player.z - e.z);
    until(w, 'alert', 3);
    const memory = { ...e.lastKnown! };
    w.player.x = 2;
    w.player.z = 9;
    w.advance(0.2);
    expect(e.seesPlayer).toBe(false);
    expect(e.lastKnown).toEqual(memory);
    until(w, 'search', 6);
    expect(e.target).toEqual(memory);
    w.advance(1);
    expect(e.lastKnown).toEqual(memory);
    expect(e.state).toBe('search');
    until(w, 'patrol');
  });

  it('煙霧切 LOS 後不再更新玩家位置，可以脫離追擊', () => {
    const w = scenario();
    const e = w.enemies[0]!;
    w.player.x = 7;
    w.player.z = 2.5;
    w.player.invisT = 0;
    becomeAlert(w, e);
    w.smokes.push({ id: w.nextId++, x: 5, y: 1, z: 2.5, age: 1, radius: 4, air: false });
    w.advance(0.1);
    expect(e.seesPlayer).toBe(false);
    w.player.x = 9;
    until(w, 'search', 6);
    expect(e.lastKnown).toEqual({ x: 7, z: 2.5 });
    w.player.x = 2;
    w.player.z = 9;
    until(w, 'patrol');
  });

  it.each(['wall', 'door'])('睡眠近距離偵測不能穿 %s 喚醒', (obstacle) => {
    const middle = obstacle === 'door' ? '#...D@.#' : '#...#@.#';
    const w = makeWorld(['########', '#......#', '#...#..#', middle, '#...#..#', '########'],
      [{ kind: 'guard', x: 3.5, z: 3.5, state: 'sleep' }]);
    w.player.x = 5.3; // 相距 1.8 m，確實在睡眠近距離偵測半徑內。
    w.advance(PERCEPTION.sleepWakeTime + 0.5);
    expect(w.enemies[0]!.state).toBe('sleep');
    expect(w.enemies[0]!.lastKnown).toBeNull();
  });

  it('隔牆聲音沿用半徑衰減，煙霧不另改聲音規則', () => {
    const w = scenario();
    const e = w.enemies[0]!;
    w.emitNoise(3.5, 1, 8, 8, 'stone');
    expect(e.state).toBe('patrol'); // 5.5 m，大於隔牆後的 4 m。
    w.emitNoise(3.5, 1, 8, 12, 'stone');
    expect(e.state).toBe('investigate');
    expect(e.target).toEqual({ x: 3.5, z: 8 });
    expect(e.lastKnown).toBeNull();
  });

  it('遠程受擊不能憑空確認牆後玩家', () => {
    const w = scenario('sleep');
    const e = w.enemies[0]!;
    damageEnemy(w, e, 1, { source: 'arrow', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    expect(e.state).toBe('investigate');
    expect(e.lastKnown).toBeNull();
    expect(e.target).toEqual({ x: e.x, z: e.z });
  });

  it('短暫目擊後只去調查當時位置，不追蹤遮蔽中的玩家', () => {
    const w = scenario();
    const e = w.enemies[0]!;
    e.state = 'idle';
    w.player.invisT = 0;
    w.player.x = 9;
    w.player.z = 2.5;
    e.yaw = yawFromDir(w.player.x - e.x, w.player.z - e.z);
    w.advance(0.06);
    expect(e.awareness).toBeGreaterThan(0);
    expect(e.state).not.toBe('alert');
    w.player.x = 2;
    w.player.z = 9;
    w.advance(0.06);
    expect(e.state).toBe('investigate');
    expect(e.target).toEqual({ x: 9, z: 2.5 });
    expect(e.lastKnown).toBeNull();
  });

  it('盾推撞到同伴只提供碰撞位置，不替同伴確認玩家', () => {
    const w = makeWorld(undefined, [
      { kind: 'guard', x: 3, z: 3, state: 'idle' },
      { kind: 'guard', x: 4, z: 3, state: 'sleep' },
    ]);
    w.player.invisT = 1000;
    w.enemies[0]!.push = { dx: 1, dz: 0, left: 2 };
    w.advance(0.1);
    expect(w.enemies[1]!.state).not.toBe('alert');
    expect(w.enemies[1]!.lastKnown).toBeNull();
    expect(w.events.some((ev) => ev.type === 'bump' && ev.kind === 'ally')).toBe(true);
  });

  it.each(['investigate', 'search'] as const)('%s：不可達的目標也必須結束', (state) => {
    const w = scenario();
    const e = w.enemies[0]!;
    w.grid.doors[0]!.barred = true;
    e.state = state;
    e.target = { x: 6, z: 9 };
    until(w, 'patrol', PERCEPTION.investigateTime + PERCEPTION.searchTravelTime + 1);
    expect(e.z).toBeLessThan(5);
  });

  it.each(['patrol', 'investigate', 'search', 'alert'] as const)('%s：開門先支付完整時間，打開前不可穿門', (state) => {
    const w = scenario();
    const e = w.enemies[0]!;
    e.x = 6;
    e.z = 4.4;
    e.state = state;
    e.patrol = [{ x: 6, z: 8 }];
    e.patrolIdx = 0;
    e.target = { x: 6, z: 8 };
    e.lastKnown = { x: 6, z: 8 };
    const d = w.grid.doors[0]!;
    let started = -1;
    for (let k = 0; k < 300 && d.target === 0; k++) {
      w.advance(1 / 60);
      if (e.doorWaitId >= 0 && started < 0) started = w.time;
      if (d.progress < 0.999) expect(e.z).toBeLessThanOrEqual(5 - e.radius + 1e-6);
    }
    expect(d.target).toBe(1);
    expect(w.time - started).toBeGreaterThanOrEqual(ENEMIES.doorOpenTime - 1 / 60 - 1e-6);
    w.advance(3);
    expect(e.z).toBeGreaterThan(6);
  });

  it('狀態切換保留正在支付的門時間；重新關閉須重新支付', () => {
    const w = scenario();
    const e = w.enemies[0]!;
    e.x = 6;
    e.z = 4.4;
    e.patrol = [{ x: 6, z: 8 }];
    e.patrolIdx = 0;
    w.advance(0.3);
    const paid = e.doorWaitT;
    expect(paid).toBeGreaterThan(0);
    w.emitNoise(6, 1, 8, 20, 'stone');
    w.advance(0.1);
    expect(w.grid.doors[0]!.target).toBe(0);
    expect(e.doorWaitT).toBeGreaterThan(paid);
    w.advance(1);
    expect(w.grid.doors[0]!.target).toBe(1);
    expect(e.target).toEqual({ x: 6, z: 8 }); // 不被自己開門的聲音取代。
    w.emitNoise(6, 1, 5.5, 8, 'stone');
    expect(e.target).toEqual({ x: 6, z: 5.5 }); // 同一門口的外來聲音仍有效。
    e.target = { x: 6, z: 8 };
    w.advance(4);
    expect(e.doorWaitId).toBe(-1);
    expect(e.doorWaitT).toBe(0);
    e.x = 6; e.z = 4.4; e.path = null;
    e.state = 'investigate'; e.target = { x: 6, z: 8 };
    const d = w.grid.doors[0]!;
    d.target = 0; d.progress = 0;
    w.advance(0.3);
    expect(d.target).toBe(0);
    w.advance(0.4);
    expect(d.target).toBe(1);
  });

  it('沒有玩家接觸時跨房活動；同設定得到相同位置與完整狀態循環', () => {
    const simulate = () => {
      const w = scenario();
      const e = w.enemies[0]!;
    w.advance(8);
      expect(e.z).toBeGreaterThan(6);
      const route = [e.x, e.z];
      w.emitNoise(3, 1, 8, 8, 'stone');
      expect(e.state).toBe('investigate');
      until(w, 'search');
      w.player.x = e.x + 2;
      w.player.z = e.z;
      w.player.invisT = 0;
      e.yaw = yawFromDir(2, 0);
      until(w, 'alert');
      w.player.x = 2;
      w.player.z = 2;
      until(w, 'search');
      until(w, 'patrol');
      return [...route, e.x, e.z, w.time];
    };
    expect(simulate()).toEqual(simulate());
  });

  it('實際生成的四層都有跨房目的地；高台弩手維持原位', () => {
    for (const floor of [1, 2, 3, 4]) {
      const w = new World(generateLevel('LIVING1', { floor }));
      expect(w.roamPoints.length).toBeGreaterThan(1);
      for (const e of w.enemies) {
        if (e.perched) { expect(e.patrol).toEqual([]); continue; }
        expect(e.patrol.some((p) => Math.hypot(p.x - e.post.x, p.z - e.post.z) > 8)).toBe(true);
        if (e.state !== 'sleep') expect(e.state).toBe('patrol');
      }
    }
  });

  it('實際四層模擬：無玩家接觸也能跨房，活動中的敵人不穿牆', () => {
    for (const floor of [1, 2, 3, 4]) {
      const w = new World(generateLevel('LIVING1', { floor }));
      w.player.invisT = 1000;
      const active = w.enemies.filter((e) => !e.perched && e.state === 'patrol');
      const roomAt = (x: number, z: number) => w.level.rooms.find((r) => x >= r.x0 && x < r.x0 + r.w && z >= r.z0 && z < r.z0 + r.h)?.key;
      const initial = new Map(active.map((e) => [e.id, roomAt(e.x, e.z)]));
      const crossed = new Set<number>();
      for (let k = 0; k < 45 * 10; k++) {
        w.advance(0.1);
        for (const e of active) {
          if (!e.alive) continue;
          expect(w.grid.circleBlocked(e.x, e.z, e.radius)).toBe(false);
          const room = roomAt(e.x, e.z);
          if (room && room !== initial.get(e.id)) crossed.add(e.id);
        }
      }
      expect(crossed.size, `floor ${floor}`).toBeGreaterThan(0);
    }
  }, 60000);

  it('樓層／載入／死亡後重試重新建立 AI transient state，存檔格式不變', () => {
    const run = newRun('LIVING1', 'warrior');
    const w = createFloorWorld(run);
    for (const e of w.enemies) {
      e.state = 'search'; e.target = { x: 1, z: 1 }; e.lastKnown = { x: 2, z: 2 };
      e.searchT = 7; e.doorWaitId = 2; e.doorWaitT = 0.5; e.searchGoal = { x: 3, z: 3 };
    }
    const next = nextFloor(run, w);
    w.damagePlayer(999, 'fixture', w.player.x, w.player.z);
    expect(w.outcome).toBe('dead');
    for (const fresh of [createFloorWorld(run), createFloorWorld(next), createFloorWorld(parseRun(serializeRun(next))!)]) {
      for (const e of fresh.enemies) {
        expect(['sleep', 'idle', 'patrol']).toContain(e.state);
        expect(e.target).toBeNull(); expect(e.lastKnown).toBeNull(); expect(e.searchGoal).toBeNull();
        expect(e.searchT).toBe(0); expect(e.doorWaitT).toBe(0); expect(e.doorWaitId).toBe(-1);
      }
    }
  });
});

describe('奇襲先手', () => {
  it.each(['longsword', 'knife', 'axe', 'spear'] as WeaponId[])('%s：第一層盾衛保留正常戰鬥機會，給可靠踉蹌', (weapon) => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13.1, state: 'sleep' }]);
    w.player.weapon = { id: weapon, level: 0 };
    w.frame(1 / 60, { ...emptyInput(), fire: true, firePressed: true });
    for (let k = 0; k < 100 && !w.events.some((ev) => ev.type === 'hitEnemy'); k++) w.frame(1 / 60, emptyInput());
    const e = w.enemies[0]!;
    expect(e.hp).toBe(ENEMIES.guard.hp - WEAPONS[weapon].damage * WEAPONS[weapon].sneakMultiplier);
    expect(e.alive).toBe(true);
    expect(e.state).toBe('alert');
    expect(e.phase).toBe('stagger');
    expect(e.staggerDur).toBeGreaterThanOrEqual(STEALTH.surpriseStagger);
    finishAction(w);
  });

  it.each(['investigate', 'search', 'alert'] as const)('%s 不再取得奇襲傷害或先手踉蹌', (state) => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13.1, state: 'idle' }]);
    w.player.weapon.id = 'knife';
    const e = w.enemies[0]!;
    e.state = state; e.target = { x: e.x, z: e.z - 1 }; e.yaw = 0;
    w.frame(1 / 60, { ...emptyInput(), fire: true, firePressed: true });
    finishAction(w);
    const hit = w.events.find((ev) => ev.type === 'hitEnemy')!;
    expect(hit.sneak).toBe(false);
    expect(hit.amount).toBe(WEAPONS.knife.damage);
    expect(e.staggerDur).toBe(0);
  });
});
