import { describe, expect, it } from 'vitest';
import { ENEMIES, ENEMIES as E, PERCEPTION, TRAP } from '../src/config';
import { becomeAlert } from '../src/sim/enemySys';
import { emptyInput } from '../src/sim/types';
import { makeWorld } from './helpers';

const DOOR_ROWS = [
  '##########',
  '#........#',
  '#........#',
  '#........#',
  '####DD####',
  '#........#',
  '#........#',
  '#...@....#',
  '##########',
];

describe('敵人 AI', () => {
  it('盾衛繞過石柱追到玩家身邊', () => {
    const rows = [
      '############',
      '#..........#',
      '#..........#',
      '#....o.....#',
      '#..........#',
      '#.....@....#',
      '############',
    ];
    const w = makeWorld(rows, [{ kind: 'guard', x: 5.5, z: 1.5, state: 'idle' }]);
    const g = w.enemies[0]!;
    becomeAlert(w, g);
    let minD = Infinity;
    for (let k = 0; k < 400; k++) {
      w.advance(1 / 60);
      minD = Math.min(minD, Math.hypot(g.x - w.player.x, g.z - w.player.z));
      // 不會穿過柱子
      const p = w.grid.pillars[0]!;
      expect(Math.hypot(g.x - p.x, g.z - p.z)).toBeGreaterThanOrEqual(p.r + g.radius - 1e-3);
    }
    expect(minD).toBeLessThan(ENEMIES.guard.attackRange + 0.5);
  });

  it('敵人會開門，但要停下花時間（並發出聲響）', () => {
    const w = makeWorld(DOOR_ROWS, [{ kind: 'guard', x: 4.5, z: 1.5, state: 'idle' }]);
    const g = w.enemies[0]!;
    becomeAlert(w, g);
    const door = w.grid.doors[0]!;
    let openedAt = -1;
    let reachedAt = -1;
    for (let k = 0; k < 600 && openedAt < 0; k++) {
      w.advance(1 / 60);
      if (reachedAt < 0 && g.doorWaitId === door.id) reachedAt = w.time;
      if (door.target === 1) openedAt = w.time;
    }
    expect(openedAt).toBeGreaterThan(0);
    expect(openedAt - reachedAt).toBeGreaterThanOrEqual(ENEMIES.doorOpenTime - 1 / 60 - 1e-6);
    expect(w.events.some((e) => e.type === 'door' && e.source === 'enemy')).toBe(true);
  });

  it('玩家關門時門口有人會被拒絕，不會夾人', () => {
    const w = makeWorld(DOOR_ROWS);
    const door = w.grid.doors[0]!;
    door.progress = 1;
    door.target = 1;
    w.player.x = 5.0;
    w.player.z = 4.5;
    w.frame(1 / 60, { ...emptyInput(0, 0), interact: true });
    expect(door.target).toBe(1);
    expect(w.events.some((e) => e.type === 'doorBlocked')).toBe(true);
  });

  it('單向門：只能從閂住的那一側拉開門閂', () => {
    const rows = DOOR_ROWS.map((r) => r.replace('DD', 'BB'));
    const north = makeWorld(rows);
    north.player.x = 5;
    north.player.z = 3.2;
    north.player.yaw = Math.PI; // 面向南（門）
    north.frame(1 / 60, { ...emptyInput(Math.PI, 0), interact: true });
    expect(north.grid.doors[0]!.barred).toBe(true);
    expect(north.events.some((e) => e.type === 'barred')).toBe(true);

    const south = makeWorld(rows);
    south.player.x = 5;
    south.player.z = 5.8;
    south.frame(1 / 60, { ...emptyInput(0, 0), interact: true });
    expect(south.grid.doors[0]!.barred).toBe(false);
    expect(south.grid.doors[0]!.target).toBe(1);
  });

  it('突進者沿鎖定方向衝刺，撞牆後暈眩並受雙倍傷害', () => {
    const w = makeWorld(undefined, [{ kind: 'charger', x: 9.5, z: 6.5, state: 'idle', yaw: 0 }]);
    const c = w.enemies[0]!;
    c.state = 'alert';
    c.phase = 'charge';
    c.phaseT = 0;
    c.lockedYaw = 0; // 朝北牆
    c.chargeDist = 0;
    for (let k = 0; k < 120 && c.phase === 'charge'; k++) w.advance(1 / 120);
    expect(c.phase).toBe('stun');
    expect(c.z).toBeLessThan(2.2);
    // 途中不轉彎：x 不變
    expect(c.x).toBeCloseTo(9.5, 6);
  });

  it('弩手失去視線後前往最後已知位置', () => {
    const rows = [
      '##############',
      '#............#',
      '#............#',
      '######..######',
      '#............#',
      '#............#',
      '##############',
    ];
    const w = makeWorld(rows, [{ kind: 'archer', x: 3.5, z: 1.5, state: 'idle' }]);
    w.player.x = 11.5;
    w.player.z = 5.5;
    const a = w.enemies[0]!;
    a.state = 'alert';
    a.lastKnown = { x: 7, z: 3.5 };
    const d0 = Math.hypot(a.x - 7, a.z - 3.5);
    w.advance(1.5);
    expect(a.seesPlayer).toBe(false);
    expect(Math.hypot(a.x - 7, a.z - 3.5)).toBeLessThan(d0 - 1);
    w.advance(PERCEPTION.loseTime + 1);
    expect(['search', 'alert']).toContain(a.state);
  });

  it('弩手瞄準時被命中會被打斷', () => {
    const w = makeWorld(undefined, [{ kind: 'archer', x: 9.5, z: 4.5, state: 'idle', yaw: Math.PI }]);
    const a = w.enemies[0]!;
    becomeAlert(w, a);
    for (let k = 0; k < 120 && a.phase !== 'aim'; k++) w.advance(1 / 120);
    expect(a.phase).toBe('aim');
    // 丟石頭
    w.player.tool = 'stone';
    w.player.desiredTool = 'stone';
    w.player.yaw = 0;
    const pitch = Math.atan2(1.2 - 1.55, 10);
    w.frame(1 / 60, { ...emptyInput(0, pitch), fire: true, firePressed: true });
    for (let k = 0; k < 120 && a.phase === 'aim'; k++) w.frame(1 / 60, { ...emptyInput(0, pitch), wait: true });
    expect(['stagger', 'none']).toContain(a.phase);
  });
});

describe('陷阱', () => {
  it('敵人踩到踏板：預警 → 尖刺 → 受傷；玩家也會觸發', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 6.5, z: 6.5, state: 'idle' }]);
    w.traps.push({ id: 0, i: 6, j: 6, state: 'idle', t: 0, hitSet: new Set() });
    w.advance(1 / 120);
    expect(w.traps[0]!.state).toBe('armed');
    w.advance(TRAP.warn + 0.05);
    expect(w.enemies[0]!.hp).toBe(E.guard.hp - TRAP.damage);
    // 玩家
    const w2 = makeWorld();
    w2.traps.push({ id: 0, i: Math.floor(w2.player.x), j: Math.floor(w2.player.z), state: 'idle', t: 0, hitSet: new Set() });
    w2.advance(TRAP.warn + 0.1);
    expect(w2.player.hp).toBe(w2.player.maxHp - TRAP.damage);
  });
});

describe('可讀性與公平性', () => {
  function guardScenario(reactFrames: number, backFrames: number): number {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 12.4, state: 'idle', yaw: Math.PI }]);
    const g = w.enemies[0]!;
    becomeAlert(w, g);
    const dt = 1 / 60;
    for (let k = 0; g.phase !== 'windup' && k < 3000; k++) w.frame(dt, emptyInput(0, 0));
    for (let i = 0; i < reactFrames; i++) w.frame(dt, emptyInput(0, 0));
    for (let i = 0; i < backFrames; i++) w.frame(dt, { ...emptyInput(0, 0), moveZ: -1 });
    for (let i = 0; i < 60; i++) w.frame(dt, { ...emptyInput(0, 0), wait: true });
    return w.player.hp;
  }

  it('盾衛舉劍後，慢動作中 2 秒內往後退 1/6 秒就能躲開；站著不動會被打中', () => {
    expect(guardScenario(120, 0)).toBe(7);
    expect(guardScenario(120, 10)).toBe(10);
    expect(guardScenario(200, 10)).toBe(10);
  });
});
