import { describe, expect, it } from 'vitest';
import { ENEMIES, RUN, STEALTH, WEAPONS } from '../src/config';
import { generateLevel } from '../src/gen/validate';
import { damageEnemy } from '../src/sim/enemySys';
import { emptyInput, type FrameInput } from '../src/sim/types';
import { World } from '../src/sim/world';
import { OPEN_ROOM, makeWorld, testLevel } from './helpers';

// 潛行與難度：背刺的方向、搜索中不能背刺、腳步聲與潛行步、屍體與戒備、越深越硬、老兵。

const dt = 1 / 60;
const input = (w: World, patch: Partial<FrameInput> = {}): FrameInput => ({ ...emptyInput(w.player.yaw, w.player.pitch), ...patch });

function swing(w: World): number {
  const t0 = w.time;
  w.frame(dt, input(w, { fire: true, firePressed: true }));
  for (let k = 0; k < 400 && w.player.action; k++) w.frame(dt, input(w));
  return w.time - t0;
}

const hits = (w: World) => w.drainEvents().filter((e) => e.type === 'hitEnemy');

/** 玩家在 (9.5, 14.5) 面向 -z；盾衛在正前方 1.9 m。yaw 0＝盾衛也面向 -z（背對玩家）。 */
function guardAhead(yaw: number, state: 'idle' | 'sleep' | 'patrol' = 'idle'): World {
  return makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 12.6, yaw, state }], 'warrior');
}

describe('背刺規則', () => {
  it('從背後偷襲閒置的敵人：×3（第 1 層長劍一擊倒下盾衛）', () => {
    const w = guardAhead(0);
    swing(w);
    const h = hits(w);
    expect(h[0]!.sneak).toBe(true);
    expect(h[0]!.amount).toBe(WEAPONS.longsword.damage * 3);
    expect(w.enemies[0]!.alive).toBe(false);
  });

  it('從正面打閒置的敵人：沒有背刺加成，而且它立刻發現你', () => {
    const w = guardAhead(Math.PI);
    swing(w);
    const h = hits(w);
    expect(h[0]!.sneak).toBe(false);
    expect(h[0]!.amount).toBe(WEAPONS.longsword.damage);
    expect(w.enemies[0]!.state).toBe('alert');
  });

  it('睡著的敵人：任何方向都算背刺', () => {
    const w = guardAhead(Math.PI, 'sleep');
    swing(w);
    expect(hits(w)[0]!.sneak).toBe(true);
  });

  it('搜索中的敵人（被聲音引來）：從背後也不能背刺——不能一路連殺', () => {
    const w = guardAhead(0);
    const g = w.enemies[0]!;
    g.state = 'search';
    g.target = { x: g.x, z: g.z - 3 };
    swing(w);
    const h = hits(w);
    expect(h[0]!.sneak).toBe(false);
    expect(g.alive).toBe(true);
  });
});

describe('腳步聲與潛行步', () => {
  function walkUp(sneak: boolean): World {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 8.5, yaw: 0, state: 'idle' }], 'warrior');
    for (let k = 0; k < 3000 && w.player.z > 11; k++) w.frame(dt, input(w, { moveZ: 1, sneak }));
    for (let k = 0; k < 30; k++) w.frame(dt, input(w));
    return w;
  }

  it('正常走到閒置敵人背後 3 m：腳步聲讓它轉過來查看', () => {
    const w = walkUp(false);
    expect(w.enemies[0]!.state).not.toBe('idle');
  });

  it('按住 Shift 潛行步走同一段：沒有聲音，它不會察覺', () => {
    const w = walkUp(true);
    expect(w.enemies[0]!.state).toBe('idle');
  });

  it('潛行步每公尺花兩倍世界時間、速度減半', () => {
    const time = (sneak: boolean) => {
      const w = makeWorld(OPEN_ROOM, [], 'warrior');
      const z0 = w.player.z;
      const t0 = w.time;
      let real = 0;
      while (z0 - w.player.z < 3) {
        w.frame(dt, input(w, { moveZ: 1, sneak }));
        real += dt;
      }
      return { world: w.time - t0, real };
    };
    const n = time(false);
    const s = time(true);
    expect(s.world / n.world).toBeCloseTo(STEALTH.sneakTimeMul, 0);
    expect(s.real / n.real).toBeGreaterThan(1.7);
  });

  it('睡著的敵人：正常走過身邊 2 m 會被吵醒；潛行步不會', () => {
    for (const sneak of [false, true]) {
      const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 11.5, z: 11.5, yaw: 0, state: 'sleep' }], 'warrior');
      for (let k = 0; k < 3000 && w.player.z > 10.5; k++) w.frame(dt, input(w, { moveZ: 1, sneak }));
      expect(w.enemies[0]!.state === 'sleep', `sneak=${sneak}`).toBe(sneak);
    }
  });
});

describe('屍體與戒備', () => {
  it('看到同伴的屍體：前往查看、大喊，整層進入戒備（視野更廣、發現更快）', () => {
    const w = makeWorld(
      OPEN_ROOM,
      [
        { kind: 'guard', x: 9.5, z: 10.5, yaw: 0, state: 'idle' },
        { kind: 'guard', x: 4.5, z: 10.5, yaw: -Math.PI / 2, state: 'idle' },
        { kind: 'archer', x: 15.5, z: 3.5, yaw: 0, state: 'idle' },
      ],
      'warrior',
    );
    const [a, b, c] = w.enemies;
    damageEnemy(w, a!, 99, { source: 'test', sneak: true, head: false, x: a!.x, y: 1, z: a!.z });
    for (let k = 0; k < 20; k++) w.frame(dt, input(w));
    const ev = w.drainEvents();
    expect(ev.some((e) => e.type === 'corpseFound')).toBe(true);
    expect(ev.some((e) => e.type === 'alarm')).toBe(true);
    expect(w.alarm).toBe(true);
    expect(b!.state).toBe('search');
    expect(c!.awakened).toBe(true);
    expect(a!.corpseFound).toBe(true);
  });
});

describe('越深越硬', () => {
  it('敵人生命每層 +15%；老兵再 ×1.5，背刺只 ×2', () => {
    const at = (floor: number, veteran = false) => {
      const l = testLevel(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 12.6, yaw: 0, state: 'idle', veteran }]);
      l.floor = floor;
      return new World(l, { cls: 'warrior' });
    };
    for (let f = 1; f <= 4; f++) expect(at(f).enemies[0]!.hp).toBe(Math.round(ENEMIES.guard.hp * (1 + RUN.hpPerFloor * (f - 1))));
    const v = at(3, true);
    expect(v.enemies[0]!.hp).toBe(Math.round(ENEMIES.guard.hp * 1.3 * RUN.veteranHpMul));
    swing(v);
    expect(hits(v)[0]!.amount).toBe(WEAPONS.longsword.damage * RUN.veteranSneakMul);
    expect(v.enemies[0]!.alive).toBe(true);
  });

  it('生成：第 3、4 層有老兵；第 2 層起有閒置敵人改成巡邏', () => {
    let vets = 0;
    let patrols2 = 0;
    for (let k = 1; k <= 10; k++) {
      vets += generateOnce(`V${k}`, 4).filter((e) => e.veteran).length;
      patrols2 += generateOnce(`V${k}`, 2).filter((e) => e.state === 'patrol').length - generateOnce(`V${k}`, 1).filter((e) => e.state === 'patrol').length;
    }
    expect(vets).toBe(10 * RUN.veterans[3]!);
    expect(patrols2).toBeGreaterThan(0);
  });
});

function generateOnce(seed: string, floor: number) {
  return generateLevel(seed, { floor }).enemies;
}
