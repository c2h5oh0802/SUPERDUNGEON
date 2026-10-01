import { describe, expect, it } from 'vitest';
import { CLASSES, ENEMIES, PERCEPTION, PLAYER, WEAPONS } from '../src/config';
import { actionTotal, fireProjectile } from '../src/sim/playerSys';
import { emptyInput, type Projectile } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { finishAction, makeWorld, run } from './helpers';

const dt = 1 / 60;

function swing(w: World): void {
  w.frame(dt, { ...emptyInput(w.player.yaw, w.player.pitch), fire: true, firePressed: true });
  finishAction(w);
}

function shoot(w: World, pitch = 0, yaw = w.player.yaw): void {
  w.player.tool = 'bow';
  w.player.desiredTool = 'bow';
  w.frame(dt, { ...emptyInput(yaw, pitch), fire: true, firePressed: true });
  finishAction(w);
  // 讓箭飛完
  for (let k = 0; k < 400 && w.projectiles.length; k++) w.frame(dt, { ...emptyInput(yaw, pitch), wait: true });
}

function inject(w: World, p: Partial<Projectile> & Pick<Projectile, 'kind' | 'pos' | 'vel'>): Projectile {
  const proj: Projectile = {
    id: w.nextId++,
    owner: 'player',
    radius: p.kind === 'bottle' ? 0.16 : 0.07,
    gravity: 0,
    age: 0,
    alive: true,

    hitSet: new Set(),
    next: { ...p.pos },
    avgVel: { ...p.vel },
    deflected: false,
    tip: null,
    payload: 'smoke',
    ...p,
  };
  w.projectiles.push(proj);
  return proj;
}

const hits = (w: World) => w.events.filter((e) => e.type === 'hitEnemy');

describe('劍', () => {
  it('一次揮擊對同一敵人最多命中一次；長劍奇襲不增加傷害', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13.0, state: 'sleep' }]);
    const e = w.enemies[0]!;
    e.hp = 100;
    swing(w);
    expect(hits(w).length).toBe(1);
    expect(e.hp).toBe(100 - 4);
  });

  it('已警戒的敵人只受基礎傷害', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 13.0, state: 'idle' }]);
    const e = w.enemies[0]!;
    e.hp = 100;
    e.state = 'alert';
    swing(w);
    expect(e.hp).toBe(96);
  });

  it('牆會擋住劍', () => {
    const rows = [
      '####################',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#..................#',
      '#........#.........#',
      '#........@.........#',
      '####################',
    ];
    const w = makeWorld(rows, [{ kind: 'guard', x: 9.5, z: 12.4, state: 'sleep' }]);
    w.player.z = 14.5;
    swing(w);
    expect(hits(w).length).toBe(0);
    expect(w.enemies[0]!.hp).toBe(ENEMIES.guard.hp);
  });

  it.each(['longsword', 'knife', 'spear', 'axe'] as const)('%s uses its full baseline melee timing without a Rune multiplier', (weapon) => {
    const w = makeWorld();
    w.player.weapon.id = weapon;
    const spec = WEAPONS[weapon];
    const base = spec.windup + spec.active + spec.recovery;
    expect(actionTotal(w, 'melee')).toBeCloseTo(base, 10);
    swing(w);
    expect(w.lastAction!.spent).toBeCloseTo(base, 8);
    expect(w.time).toBeCloseTo(base, 8);
  });
});

const WALL_ROWS = [
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '####################',
  '#..................#',
  '#..................#',
  '#..................#',
  '#..................#',
  '#........@.........#',
  '#..................#',
  '####################',
];

describe('弓與投射物', () => {
  it('箭被牆擋住，不穿過薄牆（長幀＋最高速），並留下可撿回的箭', () => {
    const w = makeWorld(WALL_ROWS, [{ kind: 'archer', x: 9.5, z: 6.5, state: 'sleep' }], 'huntress');
    const arrows = w.player.arrows;
    w.player.tool = 'bow';
    w.player.desiredTool = 'bow';
    w.frame(dt, { ...emptyInput(0, 0), fire: true, firePressed: true });
    // 長幀：每幀 0.1 秒世界時間
    for (let k = 0; k < 60; k++) w.frame(0.25, { ...emptyInput(0, 0), wait: true });
    expect(w.enemies[0]!.hp).toBe(ENEMIES.archer.hp);
    const stuck = w.pickups.find((p) => p.kind === 'arrows')!;
    expect(stuck).toBeTruthy();
    expect(stuck.z).toBeGreaterThanOrEqual(10 - 1e-6);
    expect(w.player.arrows).toBe(arrows - 1);
    // 走過去撿回
    for (let k = 0; k < 200 && w.player.arrows < arrows; k++) w.frame(dt, { ...emptyInput(0, 0), moveZ: 1 });
    expect(w.player.arrows).toBe(arrows);
  });

  it('貼牆射擊時，箭不會從牆的另一側生成', () => {
    const w = makeWorld(WALL_ROWS, [], 'huntress');
    w.player.z = 10 + PLAYER.radius + 0.01;
    const p = fireProjectile(w, 'bow');
    expect(p.pos.z).toBeGreaterThanOrEqual(10);
  });

  it('頭部命中有固定加成；盾衛正面擋住射向身體的箭', () => {
    // 正面身體：被盾擋
    const w1 = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 8.5, state: 'idle', yaw: Math.PI }], 'huntress');
    shoot(w1, Math.atan2(1.1 - 1.55, 6));
    expect(w1.enemies[0]!.hp).toBe(ENEMIES.guard.hp);
    expect(w1.events.some((e) => e.type === 'shield')).toBe(true);
    // 正面頭部：命中 6
    const w2 = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 8.5, state: 'idle', yaw: Math.PI }], 'huntress');
    shoot(w2, Math.atan2(ENEMIES.guard.headY - 1.55, 6));
    expect(w2.enemies[0]!.hp).toBe(ENEMIES.guard.hp - 6);
    // 背面身體：命中 3
    const w3 = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 8.5, state: 'idle', yaw: 0 }], 'huntress');
    shoot(w3, Math.atan2(1.1 - 1.55, 6));
    expect(w3.enemies[0]!.hp).toBe(ENEMIES.guard.hp - 3);
  });

  it.each(['bow', 'stone'] as const)('%s has no bonus penetration and stops at the first enemy', (kind) => {
    const w = makeWorld(undefined, [
      { kind: 'charger', x: 9.5, z: 10.5, state: 'sleep' },
      { kind: 'charger', x: 9.5, z: 7.5, state: 'sleep' },
    ], 'huntress');
    w.player.pitch = Math.atan2(1.1 - 1.55, 4);
    const projectile = fireProjectile(w, kind);
    expect(projectile).not.toHaveProperty('pierceLeft');
    for (let k = 0; k < 120 && projectile.alive; k++) w.advance(dt);
    expect(w.enemies[0]!.hp).toBeLessThan(ENEMIES.charger.hp);
    expect(w.enemies[1]!.hp).toBe(ENEMIES.charger.hp);
    expect(projectile.alive).toBe(false);
  });

  it('煙霧阻斷視線，但不會刪除已射出的箭', () => {
    const w = makeWorld(undefined, [{ kind: 'archer', x: 9.5, z: 6.5, state: 'idle', yaw: 0 }], 'huntress');
    w.smokes.push({ id: 999, x: 9.5, y: 1.2, z: 10.5, age: 1, radius: 2.5, air: false });
    const eye = { x: 9.5, y: 1.55, z: 14.5 };
    expect(w.canSee(eye, { x: 9.5, y: 1.5, z: 6.5 })).toBe(false);
    expect(w.grid.lineOfSight(eye, { x: 9.5, y: 1.5, z: 6.5 })).toBe(true);
    shoot(w, Math.atan2(1.2 - 1.55, 8));
    expect(w.enemies[0]!.alive).toBe(false);
  });
});

describe('煙霧瓶與空爆', () => {
  it('路徑交叉但時間不同：不命中', () => {
    const w = makeWorld();
    inject(w, { kind: 'bottle', pos: { x: 3, y: 2, z: 5 }, vel: { x: 4, y: 0, z: 0 } });
    inject(w, { kind: 'stone', pos: { x: 7, y: 2, z: 1.2 }, vel: { x: 0, y: 0, z: 10 } });
    for (let k = 0; k < 2000 && w.projectiles.length; k++) w.advance(1 / 120);
    expect(w.stats.airbursts).toBe(0);
    expect(w.smokes.length).toBe(1);
    expect(w.smokes[0]!.air).toBe(false);
  });

  it('同時同位：空中擊破，瓶子只破一次、煙霧只生成一次', () => {
    const w = makeWorld();
    inject(w, { kind: 'bottle', pos: { x: 3, y: 2, z: 5 }, vel: { x: 4, y: 0, z: 0 } });
    inject(w, { kind: 'stone', pos: { x: 7, y: 2, z: 1 }, vel: { x: 0, y: 0, z: 4 } });
    inject(w, { kind: 'stone', pos: { x: 7, y: 2, z: 0.9 }, vel: { x: 0, y: 0, z: 4.1 } });
    for (let k = 0; k < 400 && w.projectiles.length; k++) w.advance(1 / 120);
    expect(w.stats.airbursts).toBe(1);
    expect(w.smokes.length).toBe(1);
    expect(w.events.filter((e) => e.type === 'bottleBreak').length).toBe(1);
    const s = w.smokes[0]!;
    expect(Math.hypot(s.x - 7, s.z - 5)).toBeLessThan(0.4);
    expect(s.y).toBeCloseTo(2, 1);
  });

  it('投瓶打空：瓶子照常落地生效', () => {
    const w = makeWorld();
    w.frame(dt, { ...emptyInput(0, 0), bottle: true });
    for (let k = 0; k < 600 && (w.player.action || w.projectiles.length); k++) w.frame(dt, { ...emptyInput(0, 0), wait: true });
    expect(w.smokes.length).toBe(1);
    expect(w.smokes[0]!.air).toBe(false);
    expect(w.player.bottles).toBe(CLASSES.warrior.start.bottles - 1);
  });

  it('以正常動作鏈（投瓶 → 投石）可以在空中擊破瓶子：窗口真實存在', () => {
    // 不注入狀態：只用玩家輸入；瞄準時讀取瓶子位置（等同玩家看著瓶子）
    const w = makeWorld();
    w.player.pitch = 0.25;
    w.frame(dt, { ...emptyInput(0, 0.25), bottle: true });
    // 投瓶恢復期間不可出手
    while (w.player.action) w.frame(dt, emptyInput(0, 0.25));
    const bottle = w.projectiles.find((p) => p.kind === 'bottle');
    expect(bottle).toBeTruthy();
    expect(bottle!.pos.y).toBeGreaterThan(0.5);
    w.player.tool = 'stone';
    w.player.desiredTool = 'stone';
    // 慢動作中對準瓶子（略為預判）後出手
    const b = bottle!;
    const lead = 0.18;
    const tx = b.pos.x + b.vel.x * lead;
    const ty = b.pos.y + b.vel.y * lead - 0.5 * 6 * lead * lead;
    const tz = b.pos.z + b.vel.z * lead;
    const ex = w.player.x;
    const ey = PLAYER.eyeHeight - 0.05;
    const ez = w.player.z;
    const yaw = Math.atan2(-(tx - ex), -(tz - ez));
    const pitch = Math.atan2(ty - ey, Math.hypot(tx - ex, tz - ez));
    w.frame(dt, { ...emptyInput(yaw, pitch), fire: true, firePressed: true });
    for (let k = 0; k < 600 && (w.player.action || w.projectiles.length); k++) w.frame(dt, emptyInput(yaw, pitch));
    expect(w.stats.airbursts).toBe(1);
    expect(w.smokes.length).toBe(1);
  });
});

describe('Rune-free baseline', () => {
  it('new players and floor carry contain no active Rune state or application API', () => {
    const w = makeWorld();
    expect(w.player).not.toHaveProperty('runes');
    expect(w.carry()).not.toHaveProperty('runes');
    expect(w).not.toHaveProperty('pendingAltar');
    expect(w).not.toHaveProperty('hasRune');
    expect(w).not.toHaveProperty('applyRune');
    expect(w).not.toHaveProperty('chooseRune');
    expect(w.player.maxHp).toBe(PLAYER.maxHp);
  });

  it('perception uses baseline fill time with no shadow modifier', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 4.5, state: 'idle', yaw: Math.PI }]);
    const e = w.enemies[0]!;
    const distance = Math.hypot(e.x - w.player.x, e.z - w.player.z);
    const fill = PERCEPTION.fillNear + (PERCEPTION.fillFar - PERCEPTION.fillNear) *
      ((distance - PERCEPTION.nearDist) / (PERCEPTION.range - PERCEPTION.nearDist));
    // Perception samples at configured intervals. The stationary guard sees the player.
    w.advance(PERCEPTION.interval);
    expect(e.awareness).toBeCloseTo(PERCEPTION.interval / fill, 7);
  });
});

describe('感知', () => {
  it('發現量表依世界時間累積：慢動作下真實時間要長 10 倍', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 4.5, state: 'idle', yaw: Math.PI }]);
    run(w, 30); // 0.5 秒真實時間 → 0.05 秒世界時間
    expect(w.enemies[0]!.state).not.toBe('alert');
    const d = 10;
    const fill = PERCEPTION.fillNear + (PERCEPTION.fillFar - PERCEPTION.fillNear) * ((d - PERCEPTION.nearDist) / (PERCEPTION.range - PERCEPTION.nearDist));
    w.advance(fill + 0.1);
    expect(w.enemies[0]!.state).toBe('alert');
  });

  it('煙霧阻止發現', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 9.5, z: 8.5, state: 'idle', yaw: Math.PI }]);
    w.smokes.push({ id: 999, x: 9.5, y: 1.2, z: 11.5, age: 1, radius: 2.5, air: false });
    // 讓煙霧不過期
    for (let k = 0; k < 20; k++) {
      w.smokes[0]!.age = 1;
      w.advance(0.1);
    }
    expect(w.enemies[0]!.state).toBe('idle');
    expect(w.enemies[0]!.awareness).toBe(0);
  });

  it('睡眠中的敵人被近處噪音吵醒，遠處則不會', () => {
    const w = makeWorld(undefined, [
      { kind: 'guard', x: 4.5, z: 4.5, state: 'sleep' },
      { kind: 'guard', x: 15.5, z: 4.5, state: 'sleep' },
    ]);
    w.emitNoise(6.5, 1, 4.5, 8, 'stone');
    expect(w.enemies[0]!.state).toBe('investigate');
    expect(w.enemies[1]!.state).toBe('sleep');
  });

  it('投石落點的聲響把未察覺的敵人引過去', () => {
    const w = makeWorld(undefined, [{ kind: 'guard', x: 4.5, z: 3.5, state: 'idle', yaw: 0 }]);
    w.player.tool = 'stone';
    w.player.desiredTool = 'stone';
    w.frame(dt, { ...emptyInput(0, 0), fire: true, firePressed: true });
    for (let k = 0; k < 400 && (w.player.action || w.projectiles.length); k++) w.frame(dt, { ...emptyInput(0, 0), wait: true });
    const e = w.enemies[0]!;
    expect(e.state).toBe('investigate');
    expect(Math.hypot(e.target!.x - 9.6, e.target!.z - 1)).toBeLessThan(1.2);
  });

  it('取走沉眠之心後地城甦醒：沒有敵人還在睡', () => {
    const w = makeWorld(undefined, [
      { kind: 'guard', x: 4.5, z: 4.5, state: 'sleep' },
      { kind: 'archer', x: 15.5, z: 4.5, state: 'sleep' },
    ]);
    w.takeHeart();
    expect(w.enemies.every((e) => e.state !== 'sleep')).toBe(true);
    expect(w.enemies.every((e) => e.awakened)).toBe(true);
  });
});
