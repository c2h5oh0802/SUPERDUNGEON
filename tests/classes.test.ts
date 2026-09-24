import { describe, expect, it } from 'vitest';
import { ACTIONS, CLASSES, ENEMIES, PLAYER, classInfo, type PlayerClass } from '../src/config';
import { yawFromDir } from '../src/core/math';
import { AIM_EYE_Y } from '../src/sim/aim';
import { emptyInput, type FrameInput, type Projectile } from '../src/sim/types';
import type { World } from '../src/sim/world';
import { OPEN_ROOM, makeWorld } from './helpers';

// 職業的規則特權：戰士（反擊斬、擊開）與獵手（疾射截擊）。
// 這些測試只用玩家輸入（開火、視角）驅動，敵人照自己的狀態機行動；
// 「注入」只用在需要精確擺放的飛行物（會在測試名稱中說明）。

const dt = 1 / 60;
const SWORD_TOTAL = ACTIONS.sword.windup + ACTIONS.sword.active + ACTIONS.sword.recovery;
const BOW_TOTAL = ACTIONS.crossbow.windup + ACTIONS.crossbow.active + ACTIONS.crossbow.recovery;
const QS = CLASSES.huntress.quickshot;
const QS_TOTAL = QS.windup + QS.active + QS.recovery;
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

/** 按一下左鍵並等行動結束；回傳這個行動花掉的世界時間。 */
function act(w: World, patch: Partial<FrameInput> = {}): number {
  const t0 = w.time;
  w.frame(dt, input(w, { fire: true, firePressed: true, ...patch }));
  for (let k = 0; k < 4000 && w.player.action; k++) w.frame(dt, input(w, patch.moveZ ? { moveZ: patch.moveZ } : {}));
  return w.time - t0;
}

function face(w: World, x: number, z: number, y = AIM_EYE_Y): void {
  const p = w.player;
  p.yaw = yawFromDir(x - p.x, z - p.z);
  p.pitch = Math.atan2(y - AIM_EYE_Y, Math.hypot(x - p.x, z - p.z));
}

function useTool(w: World, tool: 'sword' | 'crossbow' | 'stone'): void {
  w.frame(dt, input(w, { selectTool: tool }));
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

/** 注入：一個飛向玩家胸口的弩矢（由編號 999 的敵人射出）。 */
function injectBolt(w: World, from: { x: number; y: number; z: number }): Projectile {
  const to = { x: w.player.x, y: 1.25, z: w.player.z };
  const d = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
  const s = 18;
  const vel = { x: ((to.x - from.x) / d) * s, y: ((to.y - from.y) / d) * s, z: ((to.z - from.z) / d) * s };
  const b: Projectile = {
    id: w.nextId++,
    kind: 'bolt',
    owner: 999,
    pos: { ...from },
    vel,
    radius: 0.06,
    gravity: 0,
    age: 0,
    alive: true,
    pierceLeft: 0,
    hitSet: new Set(),
    next: { ...from },
    avgVel: { ...vel },
    interceptId: -1,
    deflected: false,
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

describe('職業：時間特權只在預期條件下出現', () => {
  it('兩個職業的一般揮劍與射擊都照常支付世界時間', () => {
    for (const cls of ['warrior', 'huntress'] as const) {
      const w = makeWorld(OPEN_ROOM, [], cls);
      expect(act(w)).toBeCloseTo(SWORD_TOTAL, 2);
      useTool(w, 'crossbow');
      expect(act(w)).toBeCloseTo(BOW_TOTAL, 2);
      expect(w.stats.counters + w.stats.quickshots).toBe(0);
    }
  });

  it('獵手：準星對準自己丟出的瓶子才是疾射；偏離、或換成戰士，都是一般射擊', () => {
    // 對準瓶子 → 疾射
    const h = makeWorld(OPEN_ROOM, [], 'huntress');
    useTool(h, 'crossbow');
    const b = throwBottle(h);
    face(h, b.pos.x, b.pos.z, b.pos.y);
    expect(h.cue.quickTarget).toBe(b.id);
    expect(act(h)).toBeCloseTo(QS_TOTAL, 2);
    expect(h.stats.quickshots).toBe(1);
    // 準星偏 15° → 一般射擊
    const h2 = makeWorld(OPEN_ROOM, [], 'huntress');
    useTool(h2, 'crossbow');
    const b2 = throwBottle(h2);
    face(h2, b2.pos.x, b2.pos.z, b2.pos.y);
    h2.player.yaw += (15 * Math.PI) / 180;
    h2.updateCue();
    expect(h2.cue.quickTarget).toBe(-1);
    expect(act(h2)).toBeCloseTo(BOW_TOTAL, 2);
    // 戰士同樣的情況 → 沒有疾射
    const wr = makeWorld(OPEN_ROOM, [], 'warrior');
    useTool(wr, 'crossbow');
    const b3 = throwBottle(wr);
    face(wr, b3.pos.x, b3.pos.z, b3.pos.y);
    expect(act(wr)).toBeCloseTo(BOW_TOTAL, 2);
    expect(wr.stats.quickshots).toBe(0);
  });

  it('疾射不會連鎖：目標只能截擊一次，之後的射擊回到一般時間；石頭與自己的箭都不是目標', () => {
    const h = makeWorld(OPEN_ROOM, [], 'huntress');
    useTool(h, 'crossbow');
    const b = throwBottle(h);
    face(h, b.pos.x, b.pos.z, b.pos.y);
    expect(act(h)).toBeCloseTo(QS_TOTAL, 2);
    expect(h.stats.airbursts).toBe(1);
    // 瓶子已破：同一個方向再射 → 一般射擊
    h.updateCue();
    expect(h.cue.quickTarget).toBe(-1);
    expect(act(h)).toBeCloseTo(BOW_TOTAL, 2);
    // 丟出去的石頭不是目標
    useTool(h, 'stone');
    h.player.pitch = 0.2;
    h.frame(dt, input(h, { fire: true, firePressed: true }));
    for (let k = 0; k < 3 && h.player.action; k++) h.frame(dt, input(h));
    const stone = h.projectiles.find((q) => q.kind === 'stone');
    expect(stone).toBeTruthy();
    face(h, stone!.pos.x, stone!.pos.z, stone!.pos.y);
    h.updateCue();
    expect(h.cue.quickTarget).toBe(-1);
    // 自己剛射出的箭也不是目標
    for (let k = 0; k < 400 && h.player.action; k++) h.frame(dt, input(h));
    useTool(h, 'crossbow');
    h.frame(dt, input(h, { fire: true, firePressed: true }));
    for (let k = 0; k < 400 && h.player.action; k++) h.frame(dt, input(h));
    const arrow = h.projectiles.find((q) => q.kind === 'arrow');
    if (arrow) {
      face(h, arrow.pos.x, arrow.pos.z, arrow.pos.y);
      h.updateCue();
      expect(h.cue.quickTarget).toBe(-1);
    }
    expect(h.stats.quickshots).toBe(1);
  });

  it('邊走邊疾射：移動與行動仍取最大值、不加總，世界速率 ≤ 1', () => {
    const h = makeWorld(OPEN_ROOM, [], 'huntress');
    useTool(h, 'crossbow');
    const b = throwBottle(h);
    face(h, b.pos.x, b.pos.z, b.pos.y);
    const t0 = h.time;
    let maxRate = 0;
    h.frame(dt, input(h, { fire: true, firePressed: true, moveX: 1 }));
    maxRate = Math.max(maxRate, h.lastWorldDt / h.lastRealDt);
    let frames = 1;
    while (h.player.action && frames < 100) {
      h.frame(dt, input(h, { moveX: 1 }));
      maxRate = Math.max(maxRate, h.lastWorldDt / h.lastRealDt);
      frames++;
    }
    expect(maxRate).toBeLessThanOrEqual(1 + 1e-9);
    // 行動本身只花疾射的時間（邊走邊射也不會多付）
    expect(h.time - t0).toBeCloseTo(QS_TOTAL, 1);
    expect(h.stats.quickshots).toBe(1);
  });

  it('戰士：沒有鎖定的威脅時是一般揮劍；反擊斬成功時不用收招', () => {
    const w = alertGuardAhead('warrior');
    const g = w.enemies[0]!;
    expect(w.cue.counter).toBeNull();
    expect(idleUntil(w, () => g.phase === 'windup' && g.locked)).toBe(true);
    expect(w.cue.counter?.kind).toBe('guard');
    const spent = act(w);
    expect(w.stats.counters).toBe(1);
    // 反擊斬 = 出手 + 作用（跳過收招）
    expect(spent).toBeLessThan(CS.windup + CS.active + 0.02);
    expect(spent).toBeGreaterThan(CS.windup);
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

  it('獵手在同一時機揮劍：不會打斷（沒有這個特權），被盾衛打中', () => {
    const w = alertGuardAhead('huntress');
    const g = w.enemies[0]!;
    idleUntil(w, () => g.phase === 'windup' && g.locked);
    expect(w.cue.counter).toBeNull();
    const spent = act(w);
    expect(spent).toBeCloseTo(SWORD_TOTAL, 2);
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
    // 暈眩中追擊受雙倍傷害
    act(w);
    const hits = w.events.filter((e) => e.type === 'hitEnemy');
    expect(hits.map((e) => e.amount)).toEqual([4, 8]);
    expect(c.alive).toBe(false);
  });

  it('獵手站在同一條衝鋒線上揮劍：擋不住衝鋒', () => {
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

  it('時機正確：弩矢被打回去、改由玩家擁有，擊倒射手，自己不受傷，也不耗弩箭', () => {
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
    expect(w.player.arrows).toBe(PLAYER.startArrows);
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

  it('獵手在正確時機揮劍：劍穿過弩矢，照樣中箭', () => {
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

describe('獵手：疾射截擊與空爆', () => {
  it('選擇在較晚的位置引爆、或垂直差 2°：獵手的疾射修正到交會點而空爆，戰士（無修正）打空', () => {
    // 實測：剛丟出時正對瓶子中心，沒有修正也打得中（箭沿著瓶子的路線追上去），
    // 真正困難的是「等瓶子飛到想要的位置再引爆」與垂直方向的角度精度。
    const trial = (cls: PlayerClass, waitFrames: number, dPitchDeg: number): number => {
      const w = makeWorld(OPEN_ROOM, [], cls);
      useTool(w, 'crossbow');
      throwBottle(w);
      for (let k = 0; k < waitFrames; k++) w.frame(dt, input(w));
      const b = w.projectiles.find((q) => q.kind === 'bottle')!;
      expect(b).toBeTruthy();
      face(w, b.pos.x, b.pos.z, b.pos.y);
      w.player.pitch += (dPitchDeg * Math.PI) / 180;
      act(w);
      idleUntil(w, () => w.projectiles.length === 0, 6000);
      expect(w.smokes.length).toBe(1);
      return w.stats.airbursts;
    };
    // 等 5 秒真實時間（0.5 秒世界時間，瓶子已在下降段）再對準中心
    expect(trial('huntress', 300, 0)).toBe(1);
    expect(trial('warrior', 300, 0)).toBe(0);
    // 剛丟出、垂直差 2°
    expect(trial('huntress', 0, 2)).toBe(1);
    expect(trial('warrior', 0, 2)).toBe(0);
  });

  it('修正有限度：超出射程、準星偏太多、被牆擋住都不會修正（一般射擊，打不中）', () => {
    // 超出射程：注入一個 23 m 外、往上飛的瓶子
    const far = makeWorld(OPEN_ROOM, [], 'huntress');
    useTool(far, 'crossbow');
    far.player.x = 1.5;
    far.player.z = 18.5;
    const bottle: Projectile = {
      id: far.nextId++,
      kind: 'bottle',
      owner: 'player',
      pos: { x: 17.5, y: 2.5, z: 2.5 },
      vel: { x: 0.5, y: 1, z: 0.5 },
      radius: 0.16,
      gravity: 6,
      age: 0,
      alive: true,
      pierceLeft: 0,
      hitSet: new Set(),
      next: { x: 17.5, y: 2.5, z: 2.5 },
      avgVel: { x: 0.5, y: 1, z: 0.5 },
      interceptId: -1,
      deflected: false,
    };
    far.projectiles.push(bottle);
    face(far, bottle.pos.x, bottle.pos.z, bottle.pos.y);
    far.updateCue();
    expect(Math.hypot(bottle.pos.x - far.player.x, bottle.pos.z - far.player.z)).toBeGreaterThan(CLASSES.huntress.assistRange);
    expect(far.cue.quickTarget).toBe(-1);
    expect(act(far)).toBeCloseTo(BOW_TOTAL, 2);

    // 準星偏 10°
    const off = makeWorld(OPEN_ROOM, [], 'huntress');
    useTool(off, 'crossbow');
    const b2 = throwBottle(off);
    face(off, b2.pos.x, b2.pos.z, b2.pos.y);
    off.player.pitch += (10 * Math.PI) / 180;
    act(off);
    idleUntil(off, () => off.projectiles.length === 0, 6000);
    expect(off.stats.quickshots).toBe(0);
    expect(off.stats.airbursts).toBe(0);

    // 牆後的瓶子（注入：牆的另一側）
    const rows = OPEN_ROOM.map((r, j) => (j === 10 ? '#' + '#'.repeat(18) + '#' : r));
    const wall = makeWorld(rows, [], 'huntress');
    useTool(wall, 'crossbow');
    const hidden = { ...bottle, id: wall.nextId++, pos: { x: 9.5, y: 1.8, z: 8.5 }, next: { x: 9.5, y: 1.8, z: 8.5 }, vel: { x: 0, y: 0.5, z: 0 }, avgVel: { x: 0, y: 0.5, z: 0 }, hitSet: new Set<number>() };
    wall.projectiles.push(hidden);
    face(wall, hidden.pos.x, hidden.pos.z, hidden.pos.y);
    wall.updateCue();
    expect(wall.cue.quickTarget).toBe(-1);
  });

  it('疾射的箭仍會被牆擋下：目標在牆後交會時不會空爆', () => {
    // 注入：一支已指定截擊目標的箭，交會點被牆隔開
    const rows = OPEN_ROOM.map((r, j) => (j === 10 ? '#' + '#'.repeat(18) + '#' : r));
    const w = makeWorld(rows, [], 'huntress');
    const bottle: Projectile = {
      id: w.nextId++,
      kind: 'bottle',
      owner: 'player',
      pos: { x: 9.5, y: 2, z: 8.5 },
      vel: { x: 0, y: 0, z: 0 },
      radius: 0.16,
      gravity: 0,
      age: 0,
      alive: true,
      pierceLeft: 0,
      hitSet: new Set(),
      next: { x: 9.5, y: 2, z: 8.5 },
      avgVel: { x: 0, y: 0, z: 0 },
      interceptId: -1,
      deflected: false,
    };
    w.projectiles.push(bottle);
    const arrow: Projectile = {
      ...bottle,
      id: w.nextId++,
      kind: 'arrow',
      pos: { x: 9.5, y: 2, z: 13 },
      vel: { x: 0, y: 0, z: -40 },
      next: { x: 9.5, y: 2, z: 13 },
      avgVel: { x: 0, y: 0, z: -40 },
      radius: 0.05,
      interceptId: bottle.id,
      hitSet: new Set(),
    };
    w.projectiles.push(arrow);
    for (let k = 0; k < 60; k++) w.advance(1 / 120);
    expect(arrow.alive).toBe(false);
    expect(w.stats.airbursts).toBe(0);
    expect(w.events.some((e) => e.type === 'hitWall' && e.kind === 'arrow')).toBe(true);
  });

  it('截擊弩矢：獵手對準飛來的弩矢射擊，弩矢被擊落、自己不受傷；戰士同樣瞄準則照樣中箭', () => {
    for (const cls of ['huntress', 'warrior'] as const) {
      const w = alertArcherAhead(cls);
      const a = w.enemies[0]!;
      useTool(w, 'crossbow');
      face(w, a.x, a.z, 1.4);
      idleUntil(w, () => {
        const b = w.projectiles.find((q) => q.kind === 'bolt');
        return !!b && Math.hypot(b.pos.x - w.player.x, b.pos.z - w.player.z) < 8;
      }, 40000);
      const bolt = w.projectiles.find((q) => q.kind === 'bolt')!;
      face(w, bolt.pos.x, bolt.pos.z, bolt.pos.y);
      act(w);
      idleUntil(w, () => !w.projectiles.some((q) => q.kind === 'bolt'), 4000);
      if (cls === 'huntress') {
        expect(w.stats.intercepts).toBe(1);
        expect(w.player.hp).toBe(PLAYER.maxHp);
      } else {
        expect(w.stats.intercepts).toBe(0);
        expect(w.player.hp).toBe(PLAYER.maxHp - 2);
      }
    }
  });
});

describe('職業說明', () => {
  it('說明文字由數值生成，與效果一致', () => {
    const w = classInfo('warrior');
    const h = classInfo('huntress');
    expect(w.name).toBe('戰士');
    expect(h.name).toBe('獵手');
    const wt = w.abilities.map((x) => x.text).join(' ');
    const ht = h.abilities.map((x) => x.text).join(' ');
    expect(wt).toContain(String(CS.windup));
    expect(wt).toContain(String(ENEMIES.guard.stagger));
    expect(ht).toContain(String(Math.round(QS_TOTAL * 100) / 100));
    expect(ht).toContain(`${CLASSES.huntress.assistConeDeg}°`);
    expect(ht).toContain(`${CLASSES.huntress.assistRange} m`);
  });
});
