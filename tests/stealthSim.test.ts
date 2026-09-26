import { describe, expect, it } from 'vitest';
import { PERCEPTION, PLAYER, STEALTH } from '../src/config';
import { forwardFromYaw, yawFromDir } from '../src/core/math';
import type { EnemyKind } from '../src/gen/rooms';
import { Nav } from '../src/sim/nav';
import { emptyInput } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { OPEN_ROOM, makeWorld } from './helpers';

// 潛行模擬：一個「刺客」機器人試著在不被發現的情況下，從背後一個一個暗殺房間裡的敵人。
// 比較舊規則（任何方向、搜索中也能背刺；沒有腳步聲；屍體不會引起戒備）與新規則。
// 機器人讀得到精確狀態、路線是最短路，它不能代表真人；這裡看的是規則有沒有堵住「一路連殺」。

interface Scenario {
  name: string;
  enemies: Array<{ kind: EnemyKind; x: number; z: number; yaw: number; state: 'idle' | 'sleep' | 'patrol'; patrol?: Array<{ x: number; z: number }> }>;
}

const SCENARIOS: Scenario[] = [
  {
    name: '三個閒置盾衛背對入口，排成一排',
    enemies: [
      { kind: 'guard', x: 5.5, z: 6.5, yaw: 0, state: 'idle' },
      { kind: 'guard', x: 9.5, z: 6.5, yaw: 0, state: 'idle' },
      { kind: 'guard', x: 13.5, z: 6.5, yaw: 0, state: 'idle' },
    ],
  },
  {
    name: '三個睡著的盾衛擠在一起',
    enemies: [
      { kind: 'guard', x: 8.0, z: 5.5, yaw: 0, state: 'sleep' },
      { kind: 'guard', x: 11.0, z: 5.5, yaw: Math.PI, state: 'sleep' },
      { kind: 'guard', x: 9.5, z: 3.5, yaw: Math.PI / 2, state: 'sleep' },
    ],
  },
  {
    name: '兩個閒置盾衛＋一個睡著的突進者',
    enemies: [
      { kind: 'guard', x: 6.5, z: 7.5, yaw: 0, state: 'idle' },
      { kind: 'guard', x: 12.5, z: 5.5, yaw: 0, state: 'idle' },
      { kind: 'charger', x: 9.5, z: 3.5, yaw: 0, state: 'sleep' },
    ],
  },
];

interface Outcome {
  backstabKills: number;
  kills: number;
  total: number;
  damage: number;
  worldTime: number;
}

/**
 * 刺客。沒被發現時：
 * - direct：直接走向最近的敵人、到範圍內就砍（舊規則下從側面、正面偷襲也算背刺）。
 * - careful：繞到它背後 1.3 m、靠近時用潛行步，再從背後砍。
 * 被發現就正面打（有反擊時機就反擊）。
 */
function assassin(w: World, mode: 'direct' | 'careful'): Outcome {
  const sneakWhenClose = mode === 'careful';
  const nav = new Nav(w.grid, PLAYER.radius);
  const dt = 1 / 60;
  let backstabKills = 0;

  const swing = (yaw: number, sneak: boolean) => {
    const kills = w.stats.kills;
    const bs = w.stats.backstabs;
    w.frame(dt, { ...emptyInput(yaw, 0), fire: true, firePressed: true, sneak });
    for (let k = 0; k < 200 && w.player.action; k++) w.frame(dt, { ...emptyInput(w.player.yaw, 0), sneak });
    if (w.stats.kills > kills && w.stats.backstabs > bs) backstabKills++;
  };
  for (let f = 0; f < 60 * 300 && w.time < 90 && w.outcome === 'none'; f++) {
    const p = w.player;
    const alive = w.enemies.filter((e) => e.alive);
    if (!alive.length) break;
    const t = alive.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]!;
    const d = Math.hypot(t.x - p.x, t.z - p.z);
    const yawT = yawFromDir(t.x - p.x, t.z - p.z);
    const fighting = alive.some((e) => e.state === 'alert');
    if (fighting) {
      // 正面戰鬥：有反擊時機或在範圍內就揮，否則靠近
      if (w.cue.counter || (d < 2.3 && t.phase !== 'windup')) swing(yawT, false);
      else if (d > 2.0) w.frame(dt, { ...emptyInput(yawT, 0), moveZ: 1 });
      else w.frame(dt, { ...emptyInput(yawT, 0) });
      continue;
    }
    // direct：直接走過去；careful：走到它背後 1.3 m
    const back = forwardFromYaw(t.yaw);
    const bx = mode === 'direct' ? t.x + ((p.x - t.x) / (d || 1)) * 1.6 : t.x - back.x * 1.3;
    const bz = mode === 'direct' ? t.z + ((p.z - t.z) / (d || 1)) * 1.6 : t.z - back.z * 1.3;
    const near = Math.min(...alive.map((e) => Math.hypot(e.x - p.x, e.z - p.z)));
    const sneak = sneakWhenClose && near < STEALTH.footstepRadius + 2;
    if (Math.hypot(bx - p.x, bz - p.z) > 0.35 && d > 1.1) {
      const path = nav.findPath(p.x, p.z, bx, bz);
      const wp = path && path.length ? (path.length > 1 && Math.hypot(path[0]!.x - p.x, path[0]!.z - p.z) < 0.3 ? path[1]! : path[0]!) : { x: bx, z: bz };
      w.frame(dt, { ...emptyInput(yawFromDir(wp.x - p.x, wp.z - p.z), 0), moveZ: 1, sneak });
      continue;
    }
    if (p.action) {
      w.frame(dt, { ...emptyInput(p.yaw, 0), sneak });
      continue;
    }
    swing(yawT, sneak);
  }
  const damage = Object.values(w.stats.damageTaken).reduce((a, b) => a + b, 0);
  return { backstabKills, kills: w.stats.kills, total: w.enemies.length, damage, worldTime: w.time };
}

function run(sc: Scenario, oldRules: boolean, mode: 'direct' | 'careful'): Outcome {
  const S = STEALTH as unknown as Record<string, number | boolean>;
  const P = PERCEPTION as unknown as Record<string, number>;
  const saved = { ...S, searchFov: P.fovDeg };
  if (oldRules) {
    S.backArcDeg = 360;
    S.footstepRadius = 0;
    S.corpseSightRange = 0;
    S.searchFovDeg = PERCEPTION.fovDeg;
    S.searchFillMul = 0.8;
    S.searchBackstab = true;
  }
  try {
    const w = makeWorld(
      OPEN_ROOM,
      sc.enemies.map((e) => ({ ...e, patrol: e.patrol ?? [] })),
      'warrior',
    );
    return assassin(w, mode);
  } finally {
    Object.assign(S, saved);
  }
}

describe('潛行模擬：刺客機器人（舊規則 vs 新規則）', () => {
  const rows = SCENARIOS.map((sc) => ({
    sc,
    before: run(sc, true, 'direct'),
    after: run(sc, false, 'direct'),
    careful: run(sc, false, 'careful'),
  }));
  const fmt = (o: Outcome) => `背刺擊倒 ${o.backstabKills}/${o.total}，全部擊倒 ${o.kills}/${o.total}，受傷 ${o.damage}，${o.worldTime.toFixed(1)}s`;

  it('輸出結果表', () => {
    const lines = ['| 情境 | 舊規則：直接走過去砍 | 新規則：直接走過去砍 | 新規則：繞背＋潛行步 |', '|---|---|---|---|'];
    for (const r of rows) lines.push(`| ${r.sc.name} | ${fmt(r.before)} | ${fmt(r.after)} | ${fmt(r.careful)} |`);
    console.log(lines.join('\n'));
    expect(rows.length).toBe(SCENARIOS.length);
  });

  it('直接走過去砍：新規則下背刺擊倒比舊規則少、受的傷不比舊規則少；繞背潛行仍然拿得到背刺', () => {
    const sum = (k: 'before' | 'after' | 'careful', f: (o: Outcome) => number) => rows.reduce((a, r) => a + f(r[k]), 0);
    expect(sum('after', (o) => o.backstabKills)).toBeLessThan(sum('before', (o) => o.backstabKills));
    expect(sum('after', (o) => o.damage)).toBeGreaterThanOrEqual(sum('before', (o) => o.damage));
    expect(sum('careful', (o) => o.backstabKills)).toBeGreaterThan(sum('after', (o) => o.backstabKills));
  });
});
