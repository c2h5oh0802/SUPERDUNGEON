import { describe, expect, it } from 'vitest';
import { ACTIONS, ARMORS, ITEM_FX, TALENT_POOLS, WEAPONS, XP } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { damageEnemy } from '../src/sim/enemySys';
import { addItem, drinkPotion, isKnown, itemName, looksFor, queueUse, readScroll, shatterPotion } from '../src/sim/items';
import { gainXp } from '../src/sim/progress';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput, type FrameInput } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { OPEN_ROOM, makeWorld } from './helpers';

// 物品：未鑑定、喝／讀／丟、區域效果、卷軸、裝備與強化；經驗、等級、天賦；跨層保留。

const dt = 1 / 60;
const input = (w: World, patch: Partial<FrameInput> = {}): FrameInput => ({ ...emptyInput(w.player.yaw, w.player.pitch), ...patch });
const idle = (w: World, worldSeconds: number) => {
  const t0 = w.time;
  for (let k = 0; k < 20000 && w.time - t0 < worldSeconds; k++) w.frame(dt, input(w, { wait: true }));
};
const finish = (w: World) => {
  for (let k = 0; k < 2000 && (w.player.action || w.player.pendingUse); k++) w.frame(dt, input(w));
};

describe('未鑑定的藥水與卷軸', () => {
  it('外觀由種子決定：同一個種子永遠一樣；不同種子不同', () => {
    expect(looksFor('A1')).toEqual(looksFor('A1'));
    const diff = ['B1', 'C1', 'D1', 'E1'].some((s) => JSON.stringify(looksFor(s)) !== JSON.stringify(looksFor('A1')));
    expect(diff).toBe(true);
  });

  it('沒用過之前只看得到外觀；喝下去才揭曉', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    expect(isKnown(w, 'potion:haste')).toBe(false);
    expect(itemName(w, 'potion:haste')).toMatch(/藥水$/);
    expect(itemName(w, 'potion:haste')).not.toBe('迅捷藥水');
    addItem(w, 'potion:haste');
    queueUse(w, 0, 'use');
    finish(w);
    expect(isKnown(w, 'potion:haste')).toBe(true);
    expect(itemName(w, 'potion:haste')).toBe('迅捷藥水');
    expect(w.player.hasteT).toBeGreaterThan(0);
    expect(w.player.items.length).toBe(0);
    // 強化卷軸一開始就認得
    expect(isKnown(w, 'scroll:upgrade')).toBe(true);
  });

  it('同種藥水疊在同一格；背包滿了就撿不起來', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    expect(addItem(w, 'potion:fire')).toBe(true);
    expect(addItem(w, 'potion:fire')).toBe(true);
    expect(w.player.items).toEqual([{ id: 'potion:fire', count: 2, level: 0 }]);
    for (let k = 0; k < ITEM_FX.slots - 1; k++) addItem(w, 'weapon:axe');
    expect(w.player.items.length).toBe(ITEM_FX.slots);
    expect(addItem(w, 'armor:mail')).toBe(false);
    const p = w.addPickup('item', 1, w.player.x, 0.15, w.player.z - 0.4, null, 'armor:mail', 0);
    w.frame(dt, input(w));
    expect(p.taken).toBe(false);
  });

  it('走過去撿起地上的物品', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    const p = w.addPickup('item', 1, w.player.x, 0.15, w.player.z - 0.4, null, 'scroll:lure', 0);
    w.frame(dt, input(w));
    expect(p.taken).toBe(true);
    expect(w.player.items[0]!.id).toBe('scroll:lure');
  });
});

describe('丟出的藥水', () => {
  it('丟向敵人：瓶子碎開，火焰持續燒傷裡面的敵人；藥水因此被認出來', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 9.5, yaw: 0, state: 'sleep' }], 'warrior');
    const g = w.enemies[0]!;
    addItem(w, 'potion:fire');
    // 略微朝下丟：瓶子在盾衛身上碎開
    w.player.pitch = -0.15;
    queueUse(w, 0, 'throw');
    for (let k = 0; k < 3000 && !w.areas.length; k++) w.frame(dt, input(w));
    expect(w.areas.length).toBe(1);
    expect(isKnown(w, 'potion:fire')).toBe(true);
    const a = w.areas[0]!;
    expect(Math.hypot(a.x - g.x, a.z - g.z)).toBeLessThan(a.radius);
    const hp0 = g.hp;
    idle(w, 2);
    expect(g.hp).toBeLessThan(hp0);
  });

  it('冰霜：裡面的敵人時間軸變慢；麻痺氣體：裡面的敵人時間軸暫停', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 6.5, yaw: 0, state: 'idle' }, { kind: 'guard', x: 4.5, z: 4.5, yaw: 0, state: 'idle' }], 'warrior');
    const [a, b] = w.enemies;
    shatterPotion(w, 'frost', a!.x, 0.2, a!.z);
    shatterPotion(w, 'gas', b!.x, 0.2, b!.z);
    idle(w, 0.2);
    expect(a!.slowT).toBeGreaterThan(0);
    expect(b!.paralyzeT).toBeGreaterThan(0);
  });

  it('喝下麻痺氣體：自己被麻痺（不能行動的一段時間，世界照常前進）', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    drinkPotion(w, 'gas');
    w.frame(dt, input(w));
    expect(w.player.action?.kind).toBe('stunned');
    const t0 = w.time;
    for (let k = 0; k < 2000 && w.player.action; k++) w.frame(dt, input(w, { fire: true, firePressed: true }));
    expect(w.time - t0).toBeGreaterThan(ITEM_FX.area.gas.playerStun - 0.1);
  });
});

describe('增益藥水', () => {
  it('隱形：面前的敵人看不到你；攻擊就現形', () => {
    const mk = () => makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 9.5, yaw: Math.PI, state: 'idle' }], 'warrior');
    const seen = mk();
    idle(seen, 2);
    expect(seen.enemies[0]!.state).toBe('alert');
    const inv = mk();
    drinkPotion(inv, 'invisibility');
    idle(inv, 2);
    expect(inv.enemies[0]!.state).not.toBe('alert');
    inv.frame(dt, input(inv, { fire: true, firePressed: true }));
    expect(inv.player.invisT).toBe(0);
  });

  it('迅捷：拉弓只花一半世界時間', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    w.frame(dt, input(w, { selectSlot: 2 }));
    drinkPotion(w, 'haste');
    const t0 = w.time;
    w.frame(dt, input(w, { fire: true, firePressed: true }));
    finish(w);
    const bow = ACTIONS.bow.windup + ACTIONS.bow.active + ACTIONS.bow.recovery;
    expect(w.time - t0).toBeCloseTo(bow * ITEM_FX.haste.timeMul, 1);
  });
});

describe('卷軸', () => {
  it('時停：這一層所有敵人暫停 3 秒；地圖：整層都揭開', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 6.5, yaw: 0, state: 'idle' }, { kind: 'archer', x: 3.5, z: 3.5, yaw: 0, state: 'idle' }], 'warrior');
    readScroll(w, 'timeStop');
    expect(w.enemies.every((e) => e.paralyzeT >= ITEM_FX.timeStop)).toBe(true);
    readScroll(w, 'mapping');
    expect(w.explored.every((v) => v === 1)).toBe(true);
    expect(isKnown(w, 'scroll:timeStop') && isKnown(w, 'scroll:mapping')).toBe(true);
  });

  it('傳送：移到遠離敵人的地方；誘敵：準星指的地方發出大聲響', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 12.5, yaw: 0, state: 'idle' }], 'warrior');
    readScroll(w, 'teleport');
    const g = w.enemies[0]!;
    expect(Math.hypot(w.player.x - g.x, w.player.z - g.z)).toBeGreaterThan(8);
    const l = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 3.5, yaw: Math.PI / 2, state: 'idle' }], 'warrior');
    l.player.yaw = 0;
    readScroll(l, 'lure');
    expect(l.enemies[0]!.state).toBe('search');
  });

  it('強化卷軸：選一件裝備強化（選擇時世界暫停），武器傷害 +1', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    readScroll(w, 'upgrade');
    expect(w.pendingChoice?.kind).toBe('upgrade');
    expect(w.pendingChoice?.options).toEqual(['weapon', 'shield']);
    const t0 = w.time;
    w.frame(dt, input(w, { moveZ: 1 }));
    expect(w.time).toBe(t0);
    w.resolveChoice(0);
    expect(w.player.weapon.level).toBe(1);
    expect(w.pendingChoice).toBeNull();
  });
});

describe('裝備', () => {
  it('換上重斧：原本的長劍回到背包；重斧命中讓敵人失衡', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 12.6, yaw: Math.PI, state: 'idle' }], 'warrior');
    addItem(w, 'weapon:axe');
    queueUse(w, 0, 'use');
    finish(w);
    expect(w.player.weapon.id).toBe('axe');
    expect(w.player.items.map((i) => i.id)).toEqual(['weapon:longsword']);
    const g = w.enemies[0]!;
    g.state = 'alert';
    w.player.yaw = yawFromDir(g.x - w.player.x, g.z - w.player.z);
    w.frame(dt, input(w, { fire: true, firePressed: true }));
    finish(w);
    expect(g.hp).toBe(8 - WEAPONS.axe.damage);
    expect(g.phase).toBe('stagger');
  });

  it('護甲：每次受傷減少，但至少受 1', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    w.player.armor = { id: 'mail', level: 0 };
    w.damagePlayer(3, 't', 0, 0);
    expect(w.player.hp).toBe(10 - (3 - ARMORS.mail.reduce));
    w.damagePlayer(1, 't', 0, 0);
    expect(w.player.hp).toBe(10 - (3 - ARMORS.mail.reduce) - 1);
  });
});

describe('經驗、等級、天賦', () => {
  it('擊倒敵人得經驗；升級加生命；第 2 級選一個職業天賦（選擇時世界暫停）', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 6.5, yaw: 0, state: 'idle' }], 'huntress');
    damageEnemy(w, w.enemies[0]!, 99, { source: 'melee', sneak: false, head: false, x: 0, y: 0, z: 0 });
    expect(w.player.xp).toBe(XP.kill.guard);
    gainXp(w, XP.levels[1]! - w.player.xp);
    expect(w.player.level).toBe(2);
    expect(w.player.maxHp).toBe(10 + XP.hpPerLevel);
    expect(w.pendingChoice?.kind).toBe('talent');
    const opts = w.pendingChoice!.options as string[];
    expect(opts.length).toBe(2);
    expect(opts.every((o) => (TALENT_POOLS.huntress as string[]).includes(o))).toBe(true);
    w.resolveChoice(0);
    expect(w.player.talents).toEqual([opts[0]]);
  });

  it('老兵倒下一定掉東西', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 6.5, yaw: 0, state: 'idle', veteran: true }], 'warrior');
    damageEnemy(w, w.enemies[0]!, 99, { source: 'melee', sneak: false, head: false, x: 0, y: 0, z: 0 });
    expect(w.pickups.some((k) => k.kind === 'item')).toBe(true);
  });
});

describe('跨層保留與存檔', () => {
  it('背包、認得的物品、裝備、經驗與天賦都帶到下一層，存檔來回一致', () => {
    const run = newRun('ITEMS1', 'warrior');
    const w = createFloorWorld(run);
    addItem(w, 'potion:frost');
    addItem(w, 'weapon:spear', 1);
    w.player.known.push('potion:frost');
    w.player.armor = { id: 'leather', level: 1 };
    gainXp(w, 30);
    w.resolveChoice(0);
    const next = nextFloor(run, w);
    const back = parseRun(serializeRun(next))!;
    expect(back).toEqual(next);
    const w2 = createFloorWorld(back);
    expect(w2.player.items).toEqual(w.player.items);
    expect(w2.player.known).toEqual(['potion:frost']);
    expect(w2.player.armor).toEqual({ id: 'leather', level: 1 });
    expect([w2.player.xp, w2.player.level, w2.player.talents]).toEqual([w.player.xp, w.player.level, w.player.talents]);
    const bad = JSON.parse(serializeRun(next));
    bad.carry.items = [{ id: 'potion:nuke', count: 1, level: 0 }];
    expect(parseRun(JSON.stringify(bad))).toBeNull();
  });
});
