import { describe, expect, it } from 'vitest';
import { ACTIONS, PLAYER, TIME } from '../src/config';
import { clampRealDt, computeWorldDt, substeps } from '../src/core/time';
import { emptyInput } from '../src/sim/types';
import { finishAction, makeWorld, run } from './helpers';

const dt = 1 / 60;

describe('時間規則', () => {
  it('閒置時世界以 0.1× 慢動作流動', () => {
    const w = makeWorld();
    const wt = run(w, 60);
    expect(wt).toBeCloseTo(TIME.idleRate * 1, 6);
  });

  it('轉頭與瞄準不額外花時間', () => {
    const w = makeWorld();
    let total = 0;
    for (let k = 0; k < 60; k++) total += w.frame(dt, { ...emptyInput(k * 0.2, Math.sin(k) * 0.5) });
    expect(total).toBeCloseTo(TIME.idleRate, 6);
  });

  it('移動依碰撞後實際路程計費：全速行走＝正常速度', () => {
    const w = makeWorld();
    const x0 = w.player.x;
    const z0 = w.player.z;
    const wt = run(w, 60, { moveZ: 1 });
    const dist = Math.hypot(w.player.x - x0, w.player.z - z0);
    expect(dist).toBeGreaterThan(3.5);
    expect(wt).toBeCloseTo(dist / TIME.refMoveSpeed, 5);
    expect(wt).toBeLessThanOrEqual(1 + 1e-9);
  });

  it('分段微移與連續行走的移動成本一致（差異只有停頓期間的慢動作流逝）', () => {
    const a = makeWorld();
    const ax0 = a.player.z;
    const continuous = run(a, 30, { moveZ: 1 });
    const distA = Math.abs(a.player.z - ax0);

    const b = makeWorld();
    const bz0 = b.player.z;
    let segmented = 0;
    let pauseReal = 0;
    let moved = 0;
    while (moved < distA - 1e-3) {
      segmented += run(b, 3, { moveZ: 1 });
      moved = Math.abs(b.player.z - bz0);
      if (moved >= distA) break;
      segmented += run(b, 10);
      pauseReal += 10 * dt;
      moved = Math.abs(b.player.z - bz0);
    }
    const distB = Math.abs(b.player.z - bz0);
    const costA = continuous - 0; // 連續行走期間移動需求一直大於閒置
    const moveCostB = distB / TIME.refMoveSpeed;
    // 分段總時間 = 移動成本 + 停頓期間的閒置流逝（上限）
    expect(segmented).toBeGreaterThanOrEqual(moveCostB - 1e-6);
    expect(segmented).toBeLessThanOrEqual(moveCostB + TIME.idleRate * (pauseReal + 30 * 3 * dt) + 1e-6);
    // 同樣路程下，移動成本相同
    expect(costA / distA).toBeCloseTo(1 / TIME.refMoveSpeed, 5);
    expect(moveCostB / distB).toBeCloseTo(1 / TIME.refMoveSpeed, 5);
  });

  it('斜向移動不會更快', () => {
    const w = makeWorld();
    const x0 = w.player.x;
    const z0 = w.player.z;
    run(w, 60, { moveX: 1, moveZ: 1 });
    const dist = Math.hypot(w.player.x - x0, w.player.z - z0);
    expect(dist).toBeLessThanOrEqual(PLAYER.moveSpeed * 1 + 1e-6);
  });

  it('頂著牆走沒有實際位移，就只剩慢動作流逝', () => {
    const w = makeWorld();
    // 走到北牆
    run(w, 240, { moveZ: 1 });
    const before = w.player.z;
    const wt = run(w, 60, { moveZ: 1 });
    expect(Math.abs(w.player.z - before)).toBeLessThan(1e-3);
    expect(wt).toBeCloseTo(TIME.idleRate, 3);
  });

  it('攻擊以行動時間推進世界：揮劍＝0.6 秒', () => {
    const w = makeWorld();
    const t0 = w.time;
    w.frame(dt, { ...emptyInput(), fire: true, firePressed: true });
    finishAction(w);
    const sword = ACTIONS.sword.windup + ACTIONS.sword.active + ACTIONS.sword.recovery;
    expect(w.time - t0).toBeGreaterThanOrEqual(sword - 1e-9);
    expect(w.time - t0).toBeLessThan(sword + TIME.idleRate * dt + 1e-9);
  });

  it('邊走邊打取最大值、不加總；世界速率永遠 ≤ 1', () => {
    const w = makeWorld();
    const t0 = w.time;
    let real = 0;
    w.frame(dt, { ...emptyInput(), fire: true, firePressed: true, moveX: 1 });
    real += dt;
    while (w.player.action) {
      const wt = w.frame(dt, { ...emptyInput(), moveX: 1 });
      real += dt;
      expect(wt).toBeLessThanOrEqual(dt + 1e-12);
    }
    const sword = ACTIONS.sword.windup + ACTIONS.sword.active + ACTIONS.sword.recovery;
    expect(w.time - t0).toBeLessThan(sword + 2 * dt);
    expect(w.time - t0).toBeLessThanOrEqual(real + 1e-9);
  });

  it('換工具與連點都不能取消或重啟行動', () => {
    const w = makeWorld();
    w.player.tool = 'crossbow';
    w.player.desiredTool = 'crossbow';
    const arrows = w.player.arrows;
    w.frame(dt, { ...emptyInput(), fire: true, firePressed: true });
    const a = w.player.action!;
    expect(a.kind).toBe('crossbow');
    let lastT = a.t;
    let k = 0;
    while (w.player.action === a && k++ < 200) {
      w.frame(dt, { ...emptyInput(), fire: true, firePressed: true, selectTool: k % 2 ? 'sword' : 'stone' });
      if (w.player.action === a) {
        expect(a.t).toBeGreaterThanOrEqual(lastT);
        lastT = a.t;
        expect(w.player.tool).toBe('crossbow');
      }
    }
    // 這個行動只射出一支箭，並完整跑完行動時間；結束後才換成最後選的工具
    expect(arrows - w.player.arrows).toBe(1);
    expect(a.t).toBeGreaterThanOrEqual(a.windup + a.recovery - 1e-9);
    expect(w.player.tool).not.toBe('crossbow');
  });

  it('長幀被夾限，不會一次補算；子步有上限', () => {
    expect(clampRealDt(5)).toBe(TIME.maxRealDt);
    expect(clampRealDt(-1)).toBe(0);
    expect(clampRealDt(NaN)).toBe(0);
    const w = makeWorld();
    const wt = w.frame(5, { ...emptyInput(), wait: true });
    expect(wt).toBeCloseTo(TIME.maxRealDt, 9);
    const s = substeps(TIME.maxRealDt);
    expect(s.n).toBeLessThanOrEqual(Math.ceil(TIME.maxRealDt / TIME.maxSubstep));
    expect(s.dt).toBeLessThanOrEqual(TIME.maxSubstep + 1e-12);
  });

  it('等待時世界以正常速度前進', () => {
    const w = makeWorld();
    expect(run(w, 60, { wait: true })).toBeCloseTo(1, 6);
  });

  it('時間需求取最大值的純函式', () => {
    expect(computeWorldDt({ realDt: 0.02, moveDist: 0, actionRemaining: 0, waitHeld: false })).toBeCloseTo(0.002, 12);
    expect(computeWorldDt({ realDt: 0.02, moveDist: 0.09, actionRemaining: 0.5, waitHeld: false })).toBeCloseTo(0.02, 12);
    expect(computeWorldDt({ realDt: 0.02, moveDist: 0.045, actionRemaining: 0, waitHeld: false })).toBeCloseTo(0.01, 12);
    expect(computeWorldDt({ realDt: 0.02, moveDist: 0, actionRemaining: 0.005, waitHeld: false })).toBeCloseTo(0.005, 12);
    expect(computeWorldDt({ realDt: 0.02, moveDist: 10, actionRemaining: 0, waitHeld: false })).toBeCloseTo(0.02, 12);
  });
});
