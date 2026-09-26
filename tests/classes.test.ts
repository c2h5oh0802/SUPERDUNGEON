import { describe, expect, it } from 'vitest';
import { ACTIONS, CLASSES, ENEMIES, WEAPONS, PLAYER, PROJECTILES, SHIELD, TIPS, classInfo, type PlayerClass } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { generateLevel } from '../src/gen/validate';
import { AIM_EYE_Y } from '../src/sim/aim';
import { emptyInput, type FrameInput, type Projectile } from '../src/sim/types';
import { World } from '../src/sim/world';
import { OPEN_ROOM, makeWorld } from './helpers';

// 職業：明確的起始武器＋職業規則。
// 戰士：長劍（反擊斬、擊開）、投擲石、臂盾（盾推）。獵手：獵刀、獵弓、藥劑箭（麻痺、冰寒）、獵人之眼。
// 這些測試用玩家輸入（開火、視角、數字鍵）驅動，敵人照自己的狀態機行動；
// 「注入」只用在需要精確擺放的飛行物或狀態（會在測試名稱或註解中說明）。

const dt = 1 / 60;
const total = (a: { windup: number; active: number; recovery: number }) => a.windup + a.active + a.recovery;
const SWORD_TOTAL = total(WEAPONS.longsword);
const KNIFE_TOTAL = total(WEAPONS.knife);
const BOW_TOTAL = total(ACTIONS.bow);
const CS = CLASSES.warrior.counterSwing;

function input(w: World, patch: Partial<FrameInput> = {}): FrameInput {
  return { ...emptyInput(w.player.yaw, w.player.pitch), ...patch };
}

/** 閒置（慢動作）直到條件成立；回傳是否成立。 */
function idleUntil(w: World, cond: () => boolean, maxFrames = 20000): boolean {
  for (let k = 0; k < maxFrames; k++) {
    if (cond()) return true;
    w.frame(dt, input(w));
  }
  return cond();
}

/** 按一下左鍵（或其他輸入）並等行動結束；回傳這個行動花掉的世界時間。 */
function act(w: World, patch: Partial<FrameInput> = {}): number {
  const t0 = w.time;
  w.frame(dt, input(w, { fire: true, firePressed: true, ...patch }));
  for (let k = 0; k < 4000 && w.player.action; k++) w.frame(dt, input(w, patch.moveZ ? { moveZ: patch.moveZ } : {}));
  return w.time - t0;
}

/** 盾推（右鍵或 F）並等行動結束。 */
function push(w: World): number {
  const t0 = w.time;
  w.frame(dt, input(w, { shield: true }));
  for (let k = 0; k < 4000 && w.player.action; k++) w.frame(dt, input(w));
  return w.time - t0;
}

function face(w: World, x: number, z: number, y = AIM_EYE_Y): void {
  const p = w.player;
  p.yaw = yawFromDir(x - p.x, z - p.z);
  p.pitch = Math.atan2(y - AIM_EYE_Y, Math.hypot(x - p.x, z - p.z));
}

/** 按數字鍵選工具。 */
function slot(w: World, n: number): void {
  w.frame(dt, input(w, { selectSlot: n }));
}

/** 等所有投射物結束。 */
function settle(w: World): void {
  idleUntil(w, () => w.projectiles.length === 0 && !w.player.action, 6000);
}

function alertGuardAhead(cls: PlayerClass, dist = 1.8): World {
  const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 14.5 - dist, yaw: Math.PI, state: 'idle' }], cls);
  const g = w.enemies[0]!;
  g.state = 'alert';
  g.awareness = 1;
  return w;
}

function alertArcherAhead(cls: PlayerClass): World {
  const w = makeWorld(OPEN_ROOM, [{ kind: 'archer', x: 9.5, z: 4.5, yaw: Math.PI, state: 'idle' }], cls);
  const a = w.enemies[0]!;
  a.state = 'alert';
  a.awareness = 1;
  return w;
}

function alertChargerAhead(cls: PlayerClass, dist: number): World {
  const w = makeWorld(OPEN_ROOM, [{ kind: 'charger', x: 9.5, z: 14.5 - dist, yaw: Math.PI, state: 'idle' }], cls);
  const c = w.enemies[0]!;
  c.state = 'alert';
  c.awareness = 1;
  return w;
}

/** 注入：一個飛向玩家胸口的弩矢（由編號 999 的敵人射出）。 */
function injectBolt(w: World, from: { x: number; y: number; z: number }): Projectile {
  const to = { x: w.player.x, y: 1.25, z: w.player.z };
  const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const s = PROJECTILES.bolt.speed;
  const vel = { x: ((to.x - from.x) / d) * s, y: ((to.y - from.y) / d) * s, z: ((to.z - from.z) / d) * s };
  const b: Projectile = {
    id: w.nextId++,
    kind: 'bolt',
    owner: 999,
    pos: { ...from },
    vel,
    radius: PROJECTILES.bolt.radius,
    gravity: 0,
    age: 0,
    alive: true,
    pierceLeft: 0,
    hitSet: new Set(),
    next: { ...from },
    avgVel: { ...vel },
    deflected: false,
    tip: null,
    payload: 'smoke',
  };
  w.projectiles.push(b);
  return b;
}

/** 以正常輸入丟出煙霧瓶，等投擲行動結束（瓶子仍在空中）。 */
function throwBottle(w: World, pitch = 0.25): Projectile {
  w.player.pitch = pitch;
  w.frame(dt, input(w, { bottle: true }));
  for (let k = 0; k < 400 && w.player.action; k++) w.frame(dt, input(w));
  const b = w.projectiles.find((q) => q.kind === 'bottle');
  if (!b) throw new Error('bottle not airborne');
  return b;
}

describe('起始裝備：兩個職業拿的東西不同', () => {
  it('戰士：1 長劍、2 投擲石 ×3，沒有箭；獵手：1 獵刀、2 獵弓（8 支箭）、3 藥劑箭（麻痺 2、冰寒 2）', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    expect(w.player.slots).toEqual(['melee', 'stone']);
    expect(w.player.tool).toBe('melee');
    expect(w.player.weapon).toEqual({ id: 'longsword', level: 0 });
    expect([w.player.stones, w.player.arrows]).toEqual([3, 0]);
    const h = makeWorld(OPEN_ROOM, [], 'huntress');
    expect(h.player.slots).toEqual(['melee', 'bow', 'tipped']);
    expect(h.player.tool).toBe('melee');
    expect(h.player.weapon).toEqual({ id: 'knife', level: 0 });
    expect([h.player.arrows, h.player.stones, h.player.tipped.paralysis, h.player.tipped.chill]).toEqual([8, 0, 2, 2]);
    for (const x of [w, h]) expect([x.player.bottles, x.player.potions, x.player.hp]).toEqual([1, 1, PLAYER.maxHp]);
  });

  it('數字鍵依職業對應工具；戰士沒有第 3 格；獵手再按一次 3 切換麻痺／冰寒', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    slot(w, 2);
    expect(w.player.tool).toBe('stone');
    slot(w, 3);
    expect(w.player.tool).toBe('stone');
    const h = makeWorld(OPEN_ROOM, [], 'huntress');
    slot(h, 2);
    expect(h.player.tool).toBe('bow');
    slot(h, 3);
    expect([h.player.tool, h.player.tipKind]).toEqual(['tipped', 'paralysis']);
    slot(h, 3);
    expect(h.player.tipKind).toBe('chill');
    slot(h, 3);
    expect(h.player.tipKind).toBe('paralysis');
  });

  it('彈藥袋依職業轉換：戰士撿到投擲石、獵手撿到一般箭；戰士撿不起箭', () => {
    for (const cls of ['warrior', 'huntress'] as const) {
      const w = makeWorld(OPEN_ROOM, [], cls);
      const before = cls === 'warrior' ? w.player.stones : w.player.arrows;
      w.addPickup('ammo', 2, w.player.x, 0.15, w.player.z - 0.5, null);
      w.frame(dt, input(w));
      const after = cls === 'warrior' ? w.player.stones : w.player.arrows;
      expect(after - before).toBe(2);
    }
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    const arrows = w.addPickup('arrows', 1, w.player.x, 0.15, w.player.z - 0.5, null);
    w.frame(dt, input(w));
    expect(arrows.taken).toBe(false);
    expect(w.player.arrows).toBe(0);
  });

  it('同一個種子：兩個職業的關卡與地上物資完全相同（生成與職業無關）', () => {
    const level = () => generateLevel('CLASSSEED', {});
    const a = new World(level(), { cls: 'warrior' });
    const b = new World(level(), { cls: 'huntress' });
    const pick = (x: World) => x.pickups.map((k) => [k.kind, k.amount, k.x, k.z]);
    expect(pick(a)).toEqual(pick(b));
    expect(pick(a).length).toBeGreaterThan(0);
    expect(a.pickups.every((k) => k.kind !== 'arrows')).toBe(true);
    expect(a.enemies.map((e) => [e.kind, e.x, e.z])).toEqual(b.enemies.map((e) => [e.kind, e.x, e.z]));
  });

  it('投擲石有限：丟到牆上會落地、可以撿回；丟完就不能再丟', () => {
    const rows = OPEN_ROOM.map((r, j) => (j === 11 ? '#' + '#'.repeat(18) + '#' : r));
    const w = makeWorld(rows, [], 'warrior');
    slot(w, 2);
    w.player.yaw = 0;
    w.player.pitch = 0;
    for (let k = 0; k < 3; k++) {
      act(w);
      settle(w);
    }
    expect(w.player.stones).toBe(0);
    expect(w.pickups.filter((k) => k.kind === 'stone' && !k.taken).length).toBe(3);
    const t0 = w.time;
    w.frame(dt, input(w, { fire: true, firePressed: true }));
    expect(w.player.action).toBeNull();
    expect(w.events.some((e) => e.type === 'dryFire')).toBe(true);
    expect(w.time - t0).toBeLessThan(0.01);
    for (let k = 0; k < 300 && w.player.stones < 3; k++) w.frame(dt, input(w, { moveZ: 1 }));
    expect(w.player.stones).toBe(3);
  });
});

describe('時間規則：兩個職業的行動都照常支付世界時間', () => {
  it('長劍、獵刀、獵弓、藥劑箭、投擲石、盾推都花完整的行動時間；沒有零成本的行動', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    expect(act(w)).toBeCloseTo(SWORD_TOTAL, 2);
    slot(w, 2);
    expect(act(w)).toBeCloseTo(total(ACTIONS.stone), 2);
    expect(push(w)).toBeCloseTo(total(ACTIONS.shield), 2);
    const h = makeWorld(OPEN_ROOM, [], 'huntress');
    expect(act(h)).toBeCloseTo(KNIFE_TOTAL, 2);
    slot(h, 2);
    expect(act(h)).toBeCloseTo(BOW_TOTAL, 2);
    slot(h, 3);
    expect(act(h)).toBeCloseTo(BOW_TOTAL, 2);
    expect(h.player.tipped.paralysis).toBe(1);
    // 獵手沒有臂盾：按右鍵／F 不做任何事、不花時間
    const t0 = h.time;
    h.frame(dt, input(h, { shield: true }));
    expect(h.player.action).toBeNull();
    expect(h.time - t0).toBeLessThan(0.01);
  });

  it('邊走邊射：移動與行動取最大值、不加總，世界速率 ≤ 1', () => {
    const h = makeWorld(OPEN_ROOM, [], 'huntress');
    slot(h, 2);
    h.frame(dt, input(h, { fire: true, firePressed: true, moveX: 1 }));
    for (let k = 0; k < 200 && h.player.action; k++) {
      const wdt = h.frame(dt, input(h, { moveX: 1 }));
      expect(wdt).toBeLessThanOrEqual(dt + 1e-9);
    }
  });
});

describe('戰士：反擊斬', () => {
  it('盾衛鎖定後反擊：攻擊被打斷、失衡、盾牌放下；追擊一劍在失衡中擊倒', () => {
    const w = alertGuardAhead('warrior');
    const g = w.enemies[0]!;
    idleUntil(w, () => g.phase === 'windup' && g.locked);
    act(w);
    expect(g.phase).toBe('stagger');
    expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.events.some((e) => e.type === 'counter')).toBe(true);
    // 失衡中：正面射身體的箭不會被盾擋
    expect(g.alive).toBe(true);
    const stagger0 = g.phaseT;
    expect(stagger0).toBeLessThan(ENEMIES.guard.stagger);
    act(w);
    expect(g.alive).toBe(false);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('盾衛在「打得到我、但一般揮劍搆不到它」的距離（2.6 m）鎖定：反擊斬踏半步仍然來得及', () => {
    // 注入：盾衛在 2.6 m 處、已鎖定的舉劍中（實際遊玩時，舉劍開始後雙方位置變動就會出現這個距離）
    const w = alertGuardAhead('warrior', 2.6);
    const g = w.enemies[0]!;
    g.phase = 'windup';
    g.phaseT = ENEMIES.guard.trackUntil + 0.01;
    g.locked = true;
    g.lockedYaw = g.yaw;
    w.updateCue();
    const d = Math.hypot(g.x - w.player.x, g.z - w.player.z);
    expect(d).toBeGreaterThan(2.45);
    expect(d).toBeLessThanOrEqual(ENEMIES.guard.reach + PLAYER.radius);
    expect(w.cue.counter?.kind).toBe('guard');
    act(w);
    expect(w.stats.counters).toBe(1);
    expect(g.phase).toBe('stagger');
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('太早出手（盾衛還在追蹤、尚未鎖定）：只是普通傷害，盾衛照樣揮下', () => {
    const w = alertGuardAhead('warrior');
    const g = w.enemies[0]!;
    idleUntil(w, () => g.phase === 'windup');
    expect(g.locked).toBe(false);
    expect(w.cue.counter).toBeNull();
    act(w);
    expect(w.stats.counters).toBe(0);
    idleUntil(w, () => g.phase === 'recovery' || w.player.hp < PLAYER.maxHp, 20000);
    expect(w.player.hp).toBe(PLAYER.maxHp - ENEMIES.guard.damage);
  });

  it('獵手在同一時機揮獵刀：不會打斷（沒有這個特權），被盾衛打中', () => {
    const w = alertGuardAhead('huntress');
    const g = w.enemies[0]!;
    idleUntil(w, () => g.phase === 'windup' && g.locked);
    expect(w.cue.counter).toBeNull();
    const spent = act(w);
    expect(spent).toBeCloseTo(KNIFE_TOTAL, 2);
    expect(w.stats.counters).toBe(0);
    expect(w.player.hp).toBe(PLAYER.maxHp - ENEMIES.guard.damage);
  });

  it('背對威脅時不會出現反擊（提示出現＝現在按下去有效）', () => {
    const w = alertGuardAhead('warrior');
    const g = w.enemies[0]!;
    idleUntil(w, () => g.phase === 'windup' && g.locked);
    w.player.yaw += Math.PI;
    w.updateCue();
    expect(w.cue.counter).toBeNull();
  });

  it('突進者衝鋒中，站在衝鋒線上反擊：衝鋒停下並暈眩，戰士不受傷', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'charger', x: 9.5, z: 7.5, yaw: Math.PI, state: 'idle' }], 'warrior');
    const c = w.enemies[0]!;
    c.state = 'alert';
    c.awareness = 1;
    expect(idleUntil(w, () => w.cue.counter?.kind === 'charger' && c.phase === 'charge')).toBe(true);
    act(w);
    expect(c.phase).toBe('stun');
    expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.stats.counters).toBe(1);
    // 反擊斬踏半步、可能在一般揮劍搆不到的距離擋下它：走近再追擊，暈眩中受雙倍傷害
    const p = w.player;
    for (let k = 0; k < 600 && Math.hypot(c.x - p.x, c.z - p.z) > 2.0; k++) w.frame(dt, input(w, { moveZ: 1 }));
    act(w);
    const hits = w.events.filter((e) => e.type === 'hitEnemy');
    expect(hits.map((e) => e.amount)).toEqual([4, 8]);
    expect(c.alive).toBe(false);
  });

  it('獵手站在同一條衝鋒線上揮獵刀：擋不住衝鋒', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'charger', x: 9.5, z: 7.5, yaw: Math.PI, state: 'idle' }], 'huntress');
    const c = w.enemies[0]!;
    c.state = 'alert';
    c.awareness = 1;
    idleUntil(w, () => c.phase === 'charge' && Math.hypot(c.x - w.player.x, c.z - w.player.z) < 2.6);
    act(w);
    expect(w.player.hp).toBe(PLAYER.maxHp - ENEMIES.charger.damage);
  });
});

describe('戰士：擊開弩矢', () => {
  it('沒有揮劍：弩矢正常造成傷害（兩個職業都一樣）', () => {
    for (const cls of ['warrior', 'huntress'] as const) {
      const w = alertArcherAhead(cls);
      idleUntil(w, () => w.player.hp < PLAYER.maxHp, 40000);
      expect(w.player.hp).toBe(PLAYER.maxHp - 2);
    }
  });

  it('時機正確：弩矢被打回去、改由玩家擁有，擊倒射手，自己不受傷，也不耗投擲石', () => {
    const w = alertArcherAhead('warrior');
    const a = w.enemies[0]!;
    face(w, a.x, a.z, 1.4);
    expect(idleUntil(w, () => w.cue.counter?.kind === 'bolt', 40000)).toBe(true);
    const bolt = w.projectiles.find((q) => q.kind === 'bolt')!;
    act(w);
    expect(bolt.owner).toBe('player');
    expect(bolt.deflected).toBe(true);
    expect(w.stats.deflects).toBe(1);
    idleUntil(w, () => !a.alive || w.projectiles.length === 0, 4000);
    expect(a.alive).toBe(false);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.player.stones).toBe(CLASSES.warrior.start.stones);
  });

  it('時機錯誤（弩矢還很遠就揮完）：沒有擊開，照樣中箭', () => {
    const w = alertArcherAhead('warrior');
    const a = w.enemies[0]!;
    face(w, a.x, a.z, 1.4);
    idleUntil(w, () => w.projectiles.some((q) => q.kind === 'bolt'), 40000);
    const bolt = w.projectiles.find((q) => q.kind === 'bolt')!;
    expect(Math.hypot(bolt.pos.x - w.player.x, bolt.pos.z - w.player.z)).toBeGreaterThan(CLASSES.warrior.boltReadyMax + 1);
    expect(w.cue.counter).toBeNull();
    act(w);
    idleUntil(w, () => w.projectiles.length === 0, 4000);
    expect(w.stats.deflects).toBe(0);
    expect(w.player.hp).toBe(PLAYER.maxHp - 2);
  });

  it('獵手在正確時機揮獵刀：刀穿過弩矢，照樣中箭', () => {
    const w = alertArcherAhead('huntress');
    const a = w.enemies[0]!;
    face(w, a.x, a.z, 1.4);
    idleUntil(w, () => {
      const b = w.projectiles.find((q) => q.kind === 'bolt');
      return !!b && Math.hypot(b.pos.x - w.player.x, b.pos.z - w.player.z) < 3.5;
    }, 40000);
    act(w);
    idleUntil(w, () => w.projectiles.length === 0, 4000);
    expect(w.stats.deflects).toBe(0);
    expect(w.player.hp).toBe(PLAYER.maxHp - 2);
  });

  it('被擊開的弩矢仍遵守碰撞：打到牆就停、正面打盾衛身體會被盾擋', () => {
    // 準星對著牆：弩矢撞牆，沒有人受傷（注入：從左前方飛來的弩矢）
    const rows = OPEN_ROOM.map((r, j) => (j === 11 ? '#' + '#'.repeat(18) + '#' : r));
    const w = makeWorld(rows, [], 'warrior');
    w.player.yaw = 0;
    w.player.pitch = 0;
    injectBolt(w, { x: 7.5, y: 1.3, z: 12.4 });
    idleUntil(w, () => w.cue.counter?.kind === 'bolt', 2000);
    act(w);
    expect(w.stats.deflects).toBe(1);
    idleUntil(w, () => w.projectiles.length === 0, 2000);
    expect(w.events.some((e) => e.type === 'hitWall' && e.kind === 'bolt')).toBe(true);
    expect(w.player.hp).toBe(PLAYER.maxHp);

    // 準星對著盾衛的身體（正面）：被盾擋下
    const g = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 8.5, yaw: Math.PI, state: 'idle' }], 'warrior');
    const guard = g.enemies[0]!;
    guard.state = 'alert';
    guard.awareness = 1;
    face(g, guard.x, guard.z, 1.2);
    injectBolt(g, { x: 11.2, y: 1.3, z: 11.5 });
    idleUntil(g, () => g.cue.counter?.kind === 'bolt', 2000);
    face(g, guard.x, guard.z, 1.2);
    act(g);
    expect(g.stats.deflects).toBe(1);
    idleUntil(g, () => g.projectiles.length === 0, 2000);
    expect(g.events.some((e) => e.type === 'shield')).toBe(true);
    expect(guard.hp).toBe(ENEMIES.guard.hp);
  });
});


describe('戰士：臂盾・盾推', () => {
  it('盾衛舉劍中被推：推退 2 m、攻擊被打斷，戰士不受傷；空地上不會失衡', () => {
    const w = alertGuardAhead('warrior');
    const g = w.enemies[0]!;
    idleUntil(w, () => g.phase === 'windup');
    expect(w.cue.push).toBe(g.id);
    const z0 = g.z;
    // 記錄滑行中最遠的位置（滑完之後它會再走回來）
    let minZ = g.z;
    w.frame(dt, input(w, { shield: true }));
    for (let k = 0; k < 600 && (w.player.action || g.push); k++) {
      w.frame(dt, input(w));
      minZ = Math.min(minZ, g.z);
    }
    expect(w.lastAction?.spent).toBeCloseTo(total(ACTIONS.shield), 2);
    expect(z0 - minZ).toBeCloseTo(SHIELD.pushDist, 1);
    expect(g.phase).not.toBe('windup');
    expect(g.phase).not.toBe('stagger');
    expect(w.stats.pushes).toBe(1);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('背後是牆：撞牆失衡 1 秒、盾牌放下（投擲石正面打身體也打得到）', () => {
    const rows = OPEN_ROOM.map((r, j) => (j === 10 ? '#' + '#'.repeat(18) + '#' : r));
    const w = makeWorld(rows, [{ kind: 'guard', x: 9.5, z: 12.2, yaw: Math.PI, state: 'idle' }], 'warrior');
    const g = w.enemies[0]!;
    g.state = 'alert';
    g.awareness = 1;
    w.player.z = 13.9;
    w.player.yaw = 0;
    push(w);
    expect(g.phase).toBe('stagger');
    expect(g.staggerDur).toBe(SHIELD.wallStagger);
    expect(w.stats.wallSlams).toBe(1);
    expect(w.events.some((e) => e.type === 'bump' && e.kind === 'wall') || w.stats.wallSlams === 1).toBe(true);
    slot(w, 2);
    face(w, g.x, g.z, 1.1);
    act(w);
    settle(w);
    expect(g.hp).toBe(ENEMIES.guard.hp - PROJECTILES.stone.body);
  });

  it('推到同伴身上：兩個都踉蹌 0.5 秒', () => {
    const w = makeWorld(
      OPEN_ROOM,
      [
        { kind: 'guard', x: 9.5, z: 12.7, yaw: Math.PI, state: 'idle' },
        { kind: 'guard', x: 9.5, z: 10.4, yaw: Math.PI, state: 'idle' },
      ],
      'warrior',
    );
    const [a, b] = w.enemies;
    w.player.yaw = 0;
    push(w);
    expect(a!.phase).toBe('stagger');
    expect(b!.phase).toBe('stagger');
    expect(a!.staggerDur).toBe(SHIELD.bumpStumble);
    expect(b!.state).toBe('alert');
  });

  it('推上陷阱：陷阱觸發；背後有牆時撞牆失衡、留在踏板上被尖刺打中（注入：在推退路線上放一塊尖刺踏板）', () => {
    const rows = OPEN_ROOM.map((r, j) => (j === 9 ? '#' + '#'.repeat(18) + '#' : r));
    const w = makeWorld(rows, [{ kind: 'guard', x: 9.5, z: 12.4, yaw: Math.PI, state: 'idle' }], 'warrior');
    const g = w.enemies[0]!;
    g.state = 'alert';
    g.awareness = 1;
    w.traps.push({ id: 0, i: 9, j: 10, state: 'idle', t: 0, hitSet: new Set() });
    w.player.yaw = 0;
    push(w);
    expect(g.phase).toBe('stagger');
    expect(w.traps[0]!.state).not.toBe('idle');
    idleUntil(w, () => g.hp < ENEMIES.guard.hp, 3000);
    expect(g.hp).toBe(ENEMIES.guard.hp - 3);
  });

  it('突進者的衝撞也會撞傷擋在衝鋒線上的同伴', () => {
    const w = makeWorld(
      OPEN_ROOM,
      [
        { kind: 'charger', x: 9.5, z: 6.5, yaw: Math.PI, state: 'idle' },
        { kind: 'guard', x: 9.5, z: 11.0, yaw: 0, state: 'idle' },
      ],
      'warrior',
    );
    const [c, g] = w.enemies;
    c!.state = 'alert';
    c!.awareness = 1;
    idleUntil(w, () => g!.hp < ENEMIES.guard.hp || w.player.hp < PLAYER.maxHp, 20000);
    expect(g!.hp).toBe(ENEMIES.guard.hp - ENEMIES.charger.allyDamage);
    expect(w.player.hp).toBe(PLAYER.maxHp);
  });

  it('衝鋒中的突進者推不動：臂盾擋下衝撞（0 傷害），戰士被推退 1 m，突進者收招但不暈眩', () => {
    const w = alertChargerAhead('warrior', 7);
    const c = w.enemies[0]!;
    idleUntil(w, () => c.phase === 'charge' && Math.hypot(c.x - w.player.x, c.z - w.player.z) < 1.9);
    expect(w.cue.push).toBe(-1);
    const z0 = w.player.z;
    push(w);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.stats.blocks).toBe(1);
    expect(c.phase).not.toBe('stun');
    expect(w.player.z - z0).toBeGreaterThan(SHIELD.chargeRecoil * 0.8);
  });

  it('擋弩矢：正面來的被擋下；背後來的照樣中箭（注入弩矢）', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    w.player.yaw = 0;
    injectBolt(w, { x: 9.5, y: 1.3, z: 12.0 });
    idleUntil(w, () => Math.hypot(w.projectiles[0]!.pos.z - w.player.z) < 1.6, 2000);
    push(w);
    settle(w);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    expect(w.stats.blocks).toBe(1);
    const b = makeWorld(OPEN_ROOM, [], 'warrior');
    b.player.yaw = Math.PI;
    injectBolt(b, { x: 9.5, y: 1.3, z: 12.0 });
    idleUntil(b, () => Math.hypot(b.projectiles[0]!.pos.z - b.player.z) < 1.6, 2000);
    push(b);
    settle(b);
    expect(b.player.hp).toBe(PLAYER.maxHp - PROJECTILES.bolt.damage);
  });
});

describe('獵手：藥劑箭（改變敵人的時間軸）', () => {
  it('麻痺箭射中舉劍中盾衛的頭：定格 1.5 秒（已鎖定的揮擊停住），之後照原本的時間軸揮下', () => {
    const w = alertGuardAhead('huntress');
    const g = w.enemies[0]!;
    slot(w, 2);
    slot(w, 3);
    expect(w.player.tipKind).toBe('paralysis');
    idleUntil(w, () => g.phase === 'windup' && g.locked);
    face(w, g.x, g.z, g.y + ENEMIES.guard.headY);
    w.frame(dt, input(w, { fire: true, firePressed: true }));
    idleUntil(w, () => g.paralyzeT > 0, 400);
    expect(g.paralyzeT).toBeGreaterThan(TIPS.paralysis.duration - 0.1);
    expect(g.hp).toBe(ENEMIES.guard.hp - PROJECTILES.arrow.head);
    expect(w.player.tipped.paralysis).toBe(1);
    const frozenT = g.phaseT;
    const t0 = w.time;
    idleUntil(w, () => w.time - t0 >= TIPS.paralysis.duration - 0.1, 20000);
    expect(g.phase).toBe('windup');
    expect(g.phaseT).toBeCloseTo(frozenT, 5);
    expect(w.player.hp).toBe(PLAYER.maxHp);
    idleUntil(w, () => w.player.hp < PLAYER.maxHp, 20000);
    expect(w.time - t0).toBeGreaterThan(TIPS.paralysis.duration);
  });

  it('正面射盾衛的身體：被盾擋下，藥劑用掉、不會麻痺；箭身落地可撿回', () => {
    const w = alertGuardAhead('huntress', 6);
    const g = w.enemies[0]!;
    slot(w, 2);
    slot(w, 3);
    face(w, g.x, g.z, 1.0);
    act(w);
    settle(w);
    expect(g.paralyzeT).toBe(0);
    expect(w.player.tipped.paralysis).toBe(1);
    expect(w.events.some((e) => e.type === 'shield') || w.pickups.some((k) => k.kind === 'arrows')).toBe(true);
    expect(w.pickups.some((k) => k.kind === 'arrows' && !k.taken)).toBe(true);
  });

  it('麻痺箭射中衝鋒中的突進者：衝鋒停住 1.5 秒，之後繼續衝', () => {
    const w = alertChargerAhead('huntress', 9);
    const c = w.enemies[0]!;
    slot(w, 2);
    slot(w, 3);
    idleUntil(w, () => c.phase === 'charge');
    face(w, c.x, c.z, 1.0);
    w.frame(dt, input(w, { fire: true, firePressed: true }));
    idleUntil(w, () => c.paralyzeT > 0 || w.player.hp < PLAYER.maxHp, 600);
    expect(c.paralyzeT).toBeGreaterThan(0);
    const z0 = c.z;
    const t0 = w.time;
    idleUntil(w, () => w.time - t0 >= 1.0, 20000);
    expect(c.z).toBeCloseTo(z0, 5);
    expect(c.phase).toBe('charge');
  });

  it('冰寒箭：突進者的蓄勢花兩倍世界時間、衝鋒只有一半快', () => {
    const w = alertChargerAhead('huntress', 11);
    const c = w.enemies[0]!;
    slot(w, 2);
    slot(w, 3);
    slot(w, 3);
    expect(w.player.tipKind).toBe('chill');
    face(w, c.x, c.z, 1.0);
    act(w);
    idleUntil(w, () => c.slowT > 0, 600);
    expect(c.slowT).toBeGreaterThan(TIPS.chill.duration - 1);
    idleUntil(w, () => c.phase === 'windup');
    const t0 = w.time;
    idleUntil(w, () => c.phase === 'charge');
    expect(c.slowT).toBeGreaterThan(0);
    expect(w.time - t0).toBeCloseTo(ENEMIES.charger.windup / TIPS.chill.timeScale, 1);
    const z0 = c.z;
    const t1 = w.time;
    idleUntil(w, () => w.time - t1 >= 0.2);
    const speed = (c.z - z0) / (w.time - t1);
    expect(speed).toBeCloseTo(ENEMIES.charger.chargeSpeed * TIPS.chill.timeScale, 0);
  });

  it('藥劑箭射空打到牆：藥劑灑掉，箭身變成一般箭可以撿回', () => {
    const rows = OPEN_ROOM.map((r, j) => (j === 11 ? '#' + '#'.repeat(18) + '#' : r));
    const w = makeWorld(rows, [], 'huntress');
    slot(w, 2);
    slot(w, 3);
    w.player.yaw = 0;
    w.player.pitch = 0;
    act(w);
    settle(w);
    expect(w.player.tipped.paralysis).toBe(1);
    const shaft = w.pickups.find((k) => k.kind === 'arrows' && !k.taken);
    expect(shaft).toBeTruthy();
    const arrows = w.player.arrows;
    for (let k = 0; k < 300 && w.player.arrows === arrows; k++) w.frame(dt, input(w, { moveZ: 1 }));
    expect(w.player.arrows).toBe(arrows + 1);
  });
});

describe('敵人的窗口：遠程傷害要看時機（慢動作下瞄準本身沒有難度）', () => {
  it('盾衛看到獵手拿著弓（12 m 內）就舉盾：正面頭部也射不進；拿獵刀時不舉', () => {
    const w = alertGuardAhead('huntress', 8);
    const g = w.enemies[0]!;
    idleUntil(w, () => g.seesPlayer, 200);
    w.frame(dt, input(w));
    expect(g.shieldUp).toBe(false);
    slot(w, 2);
    idleUntil(w, () => g.shieldUp, 200);
    expect(g.shieldUp).toBe(true);
    face(w, g.x, g.z, g.y + ENEMIES.guard.headY);
    act(w);
    settle(w);
    expect(g.hp).toBe(ENEMIES.guard.hp);
    expect(w.events.some((e) => e.type === 'shield') || w.stats.shotHits === 0).toBe(true);
  });

  it('盾衛舉劍時放下盾：這時射頭打得到', () => {
    const w = alertGuardAhead('huntress', 3);
    const g = w.enemies[0]!;
    slot(w, 2);
    idleUntil(w, () => g.phase === 'windup');
    expect(g.shieldUp).toBe(false);
    face(w, g.x, g.z, g.y + ENEMIES.guard.headY);
    w.frame(dt, input(w, { fire: true, firePressed: true }));
    idleUntil(w, () => g.hp < ENEMIES.guard.hp || w.projectiles.length === 0 && !w.player.action, 600);
    expect(g.hp).toBe(ENEMIES.guard.hp - PROJECTILES.arrow.head);
  });

  it('戰士拿長劍：盾衛不舉盾；戰士拿投擲石：一樣會舉盾', () => {
    const w = alertGuardAhead('warrior', 8);
    const g = w.enemies[0]!;
    idleUntil(w, () => g.seesPlayer, 200);
    w.frame(dt, input(w));
    expect(g.shieldUp).toBe(false);
    slot(w, 2);
    idleUntil(w, () => g.shieldUp, 200);
    expect(g.shieldUp).toBe(true);
  });

  it('突進者的角盔：察覺後正面頭部射不進；暈眩時露出、受雙倍傷害（注入：暈眩狀態）', () => {
    const w = alertChargerAhead('huntress', 12);
    const c = w.enemies[0]!;
    slot(w, 2);
    face(w, c.x, c.z, c.y + ENEMIES.charger.headY);
    act(w);
    settle(w);
    expect(c.hp).toBe(ENEMIES.charger.hp);
    expect(w.events.some((e) => e.type === 'helmet') || w.stats.shotHits === 0).toBe(true);
    const s = alertChargerAhead('huntress', 6);
    const sc = s.enemies[0]!;
    sc.phase = 'stun';
    sc.phaseT = 0;
    slot(s, 2);
    face(s, sc.x, sc.z, sc.y + ENEMIES.charger.headY);
    s.frame(dt, input(s, { fire: true, firePressed: true }));
    idleUntil(s, () => !sc.alive || (s.projectiles.length === 0 && !s.player.action), 600);
    expect(sc.alive).toBe(false);
  });
});

describe('獵手：獵人之眼（只給資訊，不改彈道；只看空中的煙霧瓶）', () => {
  function descending(): { w: World; b: Projectile } {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    w.player.yaw = 0;
    slot(w, 2);
    const b = throwBottle(w, 0.25);
    idleUntil(w, () => b.vel.y < -1.5, 2000);
    return { w, b };
  }

  it('照提前量標記射擊：瓶子在空中炸開；同一時刻直接瞄準瓶子：打空（對照組）', () => {
    const { w } = descending();
    const eye = w.cue.eye[0]!;
    expect(eye.aim).not.toBeNull();
    w.player.yaw = eye.aim!.yaw;
    w.player.pitch = eye.aim!.pitch;
    w.frame(dt, input(w, { fire: true, firePressed: true }));
    settle(w);
    expect(w.smokes.length).toBe(1);
    expect(w.smokes[0]!.air).toBe(true);

    const c = descending();
    face(c.w, c.b.pos.x, c.b.pos.z, c.b.pos.y);
    c.w.frame(dt, input(c.w, { fire: true, firePressed: true }));
    settle(c.w);
    expect(c.w.smokes.length).toBe(1);
    expect(c.w.smokes[0]!.air).toBe(false);
  });

  it('落點圈：預測的落點就是瓶子實際落地的位置', () => {
    const w = makeWorld(OPEN_ROOM, [], 'huntress');
    w.player.yaw = 0;
    slot(w, 2);
    throwBottle(w, 0.25);
    const land = w.cue.eye[0]!.landing!;
    expect(land).toBeTruthy();
    settle(w);
    const s = w.smokes[0]!;
    expect(Math.hypot(s.x - land.x, s.z - land.z)).toBeLessThan(0.3);
  });

  it('只有獵手拿著弓時才有；敵人（包括衝鋒中的突進者）不會有標記', () => {
    const w = makeWorld(OPEN_ROOM, [], 'warrior');
    throwBottle(w);
    expect(w.cue.eye).toEqual([]);
    const k = makeWorld(OPEN_ROOM, [], 'huntress');
    throwBottle(k);
    expect(k.cue.eye).toEqual([]);
    const c = alertChargerAhead('huntress', 9);
    slot(c, 2);
    idleUntil(c, () => c.enemies[0]!.phase === 'charge');
    expect(c.cue.eye).toEqual([]);
  });
});

describe('職業說明', () => {
  it('說明文字由數值生成，與效果一致', () => {
    const wi = classInfo('warrior');
    expect(wi.loadout.map((l) => l.name)).toEqual(['長劍', '臂盾', '投擲石']);
    expect(wi.loadout[0]!.text).toContain(`${WEAPONS.longsword.damage} 傷害`);
    expect(wi.loadout[1]!.text).toContain(`推退 ${SHIELD.pushDist} m`);
    expect(wi.loadout[2]!.text).toContain(`${CLASSES.warrior.start.stones} 顆`);
    expect(wi.abilities.map((a) => a.name)).toContain('反擊斬');
    const hi = classInfo('huntress');
    expect(hi.loadout.map((l) => l.name)).toEqual(['獵刀', '獵弓', '藥劑箭']);
    expect(hi.loadout[1]!.text).toContain(`一般箭 ${CLASSES.huntress.start.arrows} 支`);
    expect(hi.abilities[0]!.text).toContain(`${TIPS.paralysis.duration} 秒`);
    expect(hi.weaknesses).toContain(`${ENEMIES.guard.raiseRange} m`);
    for (const i of [wi, hi]) {
      expect(i.moments.length).toBeGreaterThan(0);
      expect(i.summary.length).toBeGreaterThan(0);
    }
    expect(CS.windup).toBeLessThan(WEAPONS.longsword.windup);
  });
});
