import { describe, expect, it } from 'vitest';
import { DUNGEON, ENEMIES, ITEM_FX, PLAYER, SEARCH, TERRAIN } from '../src/config';
import { buildLevel, levelSignature, type LevelData } from '../src/gen/generator';
import { floorFeeling } from '../src/gen/generatorV2';
import { LAYOUTS, layoutsByRoleV2 } from '../src/gen/rooms';
import { generateLevel, validateLevel } from '../src/gen/validate';
import { landFromFall, revealAround, triggerTrapAt } from '../src/sim/dungeon';
import { T, TER } from '../src/sim/grid';
import { spawnArea } from '../src/sim/items';
import { Nav } from '../src/sim/nav';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { emptyInput, type Trap } from '../src/sim/types';
import { World } from '../src/sim/world';
import { finishAction, makeWorld, OPEN_ROOM, run } from './helpers';

const SEEDS = Array.from({ length: 300 }, (_, i) => `DV2-${i}`);

/** 在測試地圖上鋪一片地形。 */
function paint(w: World, i0: number, j0: number, i1: number, j1: number, t: number): void {
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) w.grid.setTerrain(i, j, t as 0);
}

function trapAt(w: World, i: number, j: number, kind: Trap['kind'], hidden = false): Trap {
  const t: Trap = { id: w.traps.length, i, j, state: 'idle', t: 0, hitSet: new Set(), kind, hidden, spent: false, noticeT: 0 };
  w.traps.push(t);
  return t;
}

describe('dungeon v2 generation', () => {
  it('300 seeds × floors 1–4 validate with procedural rooms, specials, vaults and secrets', () => {
    let retries = 0;
    const layouts = new Set<string>();
    const feelings = new Set<string>();
    for (const seed of SEEDS) for (let floor = 1; floor <= 4; floor++) {
      const l = generateLevel(seed, { floor });
      expect(validateLevel(l).errors).toEqual([]);
      expect(l.gen).toBe(2);
      expect(l.templateId).toBe('gen');
      expect(l.goal).toBe('descend');
      retries += l.attempt;
      for (const r of l.rooms) layouts.add(r.layoutId);
      if (l.feeling) feelings.add(l.feeling);
      const kinds = (l.specialRooms ?? []).map((r) => r.kind);
      // 特殊房同層不重複（「密室多」可以有兩間秘密藏室）
      const unique = new Set(kinds.filter((k) => k !== 'stash'));
      expect(unique.size).toBe(kinds.filter((k) => k !== 'stash').length);
      if (floor === 1) {
        expect(l.feeling).toBeNull();
        expect(kinds).not.toContain('vault');
        expect(l.traps.every((t) => (t.kind ?? 'spikes') === 'spikes' && !t.hidden)).toBe(true);
      } else {
        expect(kinds).toContain('vault');
        expect(l.pedestals).toHaveLength(3);
        expect(l.grid.doors.filter((d) => d.locked)).toHaveLength(1);
        expect(l.pickups.filter((p) => p.kind === 'key')).toHaveLength(1);
      }
      expect(l.rooms.filter((r) => !r.optional)).toHaveLength(DUNGEON.mainRooms[floor - 1]!);
      // 秘密門只通往可選的秘密藏室
      const hidden = l.grid.doors.filter((d) => d.hidden).length;
      expect(hidden).toBe(kinds.filter((k) => k === 'stash').length);
    }
    expect(retries / (SEEDS.length * 4)).toBeLessThan(1);
    // 新版型真的會出現
    for (const id of ['reed-marsh', 'chasm-bridge', 'flooded-hall', 'locked-vault', 'secret-stash', 'trap-ring']) expect(layouts).toContain(id);
    expect(feelings).toEqual(new Set(['dark', 'flooded', 'overgrown', 'traps', 'secrets']));
  }, 120000);

  it('same seed rebuilds identically; floors and seeds differ', () => {
    const a = levelSignature(generateLevel('DV2-SAME', { floor: 2 }));
    expect(levelSignature(generateLevel('DV2-SAME', { floor: 2 }))).toBe(a);
    expect(levelSignature(generateLevel('DV2-SAME', { floor: 3 }))).not.toBe(a);
    expect(levelSignature(generateLevel('DV2-OTHER', { floor: 2 }))).not.toBe(a);
  });

  it('floor feelings are decided once per run and never repeat on consecutive floors', () => {
    for (const seed of SEEDS.slice(0, 120)) {
      expect(floorFeeling(seed, 1)).toBeNull();
      for (let f = 2; f <= 4; f++) {
        const prev = floorFeeling(seed, f - 1);
        const cur = floorFeeling(seed, f);
        if (prev && cur) expect(cur).not.toBe(prev);
        expect(floorFeeling(seed, f)).toBe(cur);
      }
    }
  });

  it('every v2 room layout keeps all four door approaches walkable', () => {
    const walk = new Set(['.', 's', '"', '~', '^', '@', ...'123456789abcdefgh']);
    const pool = [...new Set([...layoutsByRoleV2('combat'), ...layoutsByRoleV2('heart'), ...layoutsByRoleV2('entrance'), ...LAYOUTS.filter((l) => l.v2)])];
    for (const l of pool) {
      const H = l.rows.length;
      const W = l.rows[0]!.length;
      const cells = [[1, W / 2 - 1], [1, W / 2], [H - 2, W / 2 - 1], [H - 2, W / 2], [H / 2 - 1, 1], [H / 2, 1], [H / 2 - 1, W - 2], [H / 2, W - 2]];
      for (const [r, c] of cells) expect(walk.has(l.rows[r!]![c!]!), `${l.id} ${r},${c}`).toBe(true);
    }
  });

  it('the vault key is reachable without the vault, and the vault interior is not', () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const l = generateLevel(seed, { floor: 3 });
      const nav = new Nav(l.grid, PLAYER.radius);
      const seen = nav.flood(l.spawn.x, l.spawn.z, false);
      const key = l.pickups.find((p) => p.kind === 'key')!;
      expect(seen[nav.nearestPassable(key.x, key.z, 2)]).toBe(1);
      const vault = l.rooms.find((r) => r.layoutId === 'locked-vault')!;
      expect(seen[nav.nearestPassable(vault.x0 + vault.w / 2, vault.z0 + vault.h / 2, 2)]).toBe(0);
      const all = nav.flood(l.spawn.x, l.spawn.z, true);
      expect(all[nav.nearestPassable(vault.x0 + vault.w / 2, vault.z0 + vault.h / 2, 2)]).toBe(1);
    }
  });

  it('legacy runs keep the two fixed templates', () => {
    const l = generateLevel('LEGACY', { floor: 2, gen: 1 });
    expect(['A', 'B']).toContain(l.templateId);
    expect(l.gen).toBeUndefined();
    expect(buildLevel('LEGACY', 0, { floor: 2, template: 'A' }).templateId).toBe('A');
  });
});

describe('terrain', () => {
  it('deep reeds block sight in both directions; a thin edge does not', () => {
    const w = makeWorld();
    paint(w, 5, 5, 8, 8, TER.Reeds);
    const eye = (x: number, z: number) => ({ x, y: 1.55, z });
    expect(w.canSee(eye(2.5, 6.5), eye(12.5, 6.5))).toBe(false);
    expect(w.canSee(eye(12.5, 6.5), eye(6.5, 6.5))).toBe(false);
    // 只穿過一格草
    expect(w.canSee(eye(2.5, 9.5), eye(12.5, 8.6))).toBe(true);
    expect(w.grid.reedLength(2.5, 6.5, 12.5, 6.5)).toBeGreaterThanOrEqual(TERRAIN.reedBlock);
  });

  it('an enemy loses sight of a player standing deep in reeds', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 4.5, yaw: Math.PI }]);
    w.player.x = 9.5;
    w.player.z = 12.5;
    run(w, 30);
    const before = w.enemies[0]!.seesPlayer;
    paint(w, 7, 9, 12, 14, TER.Reeds);
    w.enemies[0]!.percT = 0;
    run(w, 10);
    expect(before).toBe(true);
    expect(w.enemies[0]!.seesPlayer).toBe(false);
  });

  it('walking tramples reeds but sneaking passes through them', () => {
    const w = makeWorld();
    paint(w, 9, 10, 9, 13, TER.Reeds);
    w.player.yaw = 0;
    run(w, 30, { moveZ: 1, sneak: true });
    expect(w.grid.terrainAt(9, 13)).toBe(TER.Reeds);
    run(w, 40, { moveZ: 1 });
    expect([w.grid.terrainAt(9, 12), w.grid.terrainAt(9, 11)]).toContain(TER.Flat);
  });

  it('fire spreads through reeds over world time and leaves ash; water stops it', () => {
    const w = makeWorld();
    paint(w, 3, 3, 8, 3, TER.Reeds);
    w.grid.setTerrain(9, 3, TER.Water);
    w.grid.setTerrain(10, 3, TER.Reeds);
    spawnArea(w, 'fire', 3.5, 3.5);
    w.advance(0.05);
    expect(w.burning.size).toBeGreaterThan(0);
    w.advance(TERRAIN.burnSpread * 8 + TERRAIN.burnLife + 1);
    for (let i = 3; i <= 8; i++) expect(w.grid.terrainAt(i, 3), `cell ${i}`).toBe(TER.Ash);
    expect(w.grid.terrainAt(10, 3)).toBe(TER.Reeds);
    // 火藥水落在水上只冒蒸氣
    const n = w.areas.length;
    spawnArea(w, 'fire', 9.5, 3.5);
    expect(w.areas.length).toBe(n);
  });

  it('walking in water makes louder footsteps; sneaking stays silent', () => {
    const steps = (water: boolean, sneak = false) => {
      const w = makeWorld();
      if (water) paint(w, 1, 1, 18, 18, TER.Water);
      w.player.yaw = 0;
      run(w, 40, { moveZ: 1, sneak });
      return w.drainEvents().filter((e) => e.type === 'noise' && (e.source === 'step' || e.source === 'splash')).map((e) => e.radius!);
    };
    const dry = steps(false);
    const wet = steps(true);
    expect(dry.length).toBeGreaterThan(0);
    expect(Math.max(...wet)).toBeCloseTo(Math.max(...dry) * TERRAIN.waterStepMul);
    expect(steps(true, true)).toEqual([]);
  });

  it('frost makes every step cost twice the world time', () => {
    const perMeter = (frost: boolean) => {
      const w = makeWorld();
      if (frost) w.areas.push({ id: 99, kind: 'frost', x: w.player.x, z: w.player.z - 2, radius: 10, age: 0, life: 99, tickT: 0, hitPlayer: false });
      w.player.yaw = 0;
      run(w, 20, { moveZ: 1 });
      const z0 = w.player.z;
      const t = run(w, 30, { moveZ: 1 });
      return t / (z0 - w.player.z);
    };
    expect(perMeter(true)).toBeCloseTo(perMeter(false) * 2, 1);
  });

  it('a player walking into a chasm falls to the next floor, landing hurt but alive', () => {
    const level = generateLevel('DV2-FALL', { floor: 1 });
    const chasm = (() => {
      for (let j = 0; j < level.grid.h; j++) for (let i = 0; i < level.grid.w; i++) if (level.grid.get(i, j) === T.Chasm) return { i, j };
      return null;
    })();
    const start = newRun('DV2-FALL', 'warrior');
    const w = createFloorWorld(start);
    if (chasm) {
      w.player.x = chasm.i + 0.5;
      w.player.z = chasm.j + 0.5;
    } else {
      w.grid.set(Math.floor(w.player.x), Math.floor(w.player.z) - 2, T.Chasm);
      w.player.z -= 2;
    }
    w.player.hp = 2;
    run(w, 2);
    expect(w.outcome).toBe('descend');
    expect(w.fell).toBe(true);
    const next = nextFloor(start, w);
    expect(next.arrival).toBe('fall');
    const back = parseRun(serializeRun(next))!;
    expect(back.arrival).toBe('fall');
    const a = createFloorWorld(back);
    const b = createFloorWorld(back);
    expect(a.player.hp).toBe(1);
    expect([a.player.x, a.player.z]).toEqual([b.player.x, b.player.z]);
    expect(Math.hypot(a.player.x - a.level.spawn.x, a.player.z - a.level.spawn.z)).toBeGreaterThan(1);
    expect(a.stats.damageTaken['墜落']).toBe(1);
    // 下一次走樓梯就不再算墜落
    const w2 = createFloorWorld(back);
    w2.outcome = 'descend';
    expect(nextFloor(back, w2).arrival).toBeUndefined();
  });

  it('landFromFall keeps a healthy player at full minus fall damage', () => {
    const w = createFloorWorld({ ...newRun('DV2-LAND', 'huntress'), floor: 2, carry: null, stats: null });
    landFromFall(w);
    expect(w.player.hp).toBe(PLAYER.maxHp - TERRAIN.fallDamage);
    expect(w.grid.get(Math.floor(w.player.x), Math.floor(w.player.z))).toBe(T.Floor);
  });

  it('an enemy shoved into a chasm falls: a kill with experience, no corpse left behind', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 11.5, yaw: 0 }]);
    for (let i = 7; i <= 12; i++) for (let j = 8; j <= 10; j++) w.grid.set(i, j, T.Chasm);
    const e = w.enemies[0]!;
    e.push = { dx: 0, dz: -1, left: 2 };
    w.advance(0.5);
    expect(e.alive).toBe(false);
    expect(e.fell).toBe(true);
    expect(w.stats.kills).toBe(1);
    expect(w.player.xp).toBeGreaterThan(0);
    expect(w.pickups.filter((p) => !p.taken && p.kind === 'item')).toHaveLength(0);
  });
});

describe('secrets and search', () => {
  function secretWorld(): World {
    const rows = OPEN_ROOM.slice();
    rows[5] = '#####DD#############';
    const w = makeWorld(rows);
    w.grid.doors[0]!.hidden = true;
    return w;
  }

  it('waiting searches: one world second reveals secrets within the radius and costs world time', () => {
    const w = secretWorld();
    w.player.x = 6;
    w.player.z = 5.5 + SEARCH.radius - 0.6;
    const t0 = w.time;
    run(w, 80, { wait: true });
    expect(w.grid.doors[0]!.hidden).toBe(false);
    expect(w.time - t0).toBeGreaterThan(SEARCH.waitTime * 0.8);
    const far = secretWorld();
    far.player.x = 6;
    far.player.z = 5.5 + SEARCH.radius + 2;
    run(far, 120, { wait: true });
    expect(far.grid.doors[0]!.hidden).toBe(true);
  });

  it('lingering close and facing a secret door notices it; facing away does not', () => {
    const facing = secretWorld();
    facing.player.x = 6;
    facing.player.z = 7;
    facing.player.yaw = 0;
    facing.advance(SEARCH.noticeTime + 0.1);
    expect(facing.grid.doors[0]!.hidden).toBe(false);
    const away = secretWorld();
    away.player.x = 6;
    away.player.z = 7;
    away.player.yaw = Math.PI;
    away.advance(SEARCH.noticeTime * 3);
    expect(away.grid.doors[0]!.hidden).toBe(true);
  });

  it('a hidden door cannot be targeted or pathed until found', () => {
    const w = secretWorld();
    w.player.x = 6;
    w.player.z = 7;
    w.player.yaw = 0;
    run(w, 1);
    expect(w.interactTarget?.kind).not.toBe('door');
    const nav = new Nav(w.grid, PLAYER.radius);
    expect(nav.passable(nav.cellOf(6, 5.5))).toBe(false);
    revealAround(w, 6, 7, 3);
    run(w, 1);
    expect(w.interactTarget?.kind).toBe('door');
    expect(nav.passable(nav.cellOf(6, 5.5))).toBe(true);
  });

  it('hidden traps are found by lingering, and stepping on one reveals and triggers it', () => {
    const w = makeWorld();
    const t = trapAt(w, 9, 12, 'alarm', true);
    w.player.yaw = 0;
    w.advance(SEARCH.noticeTime + 0.1);
    expect(t.hidden).toBe(false);
    const w2 = makeWorld();
    const t2 = trapAt(w2, 9, 13, 'alarm', true);
    w2.player.yaw = 0;
    run(w2, 40, { moveZ: 1 });
    expect(t2.hidden).toBe(false);
    expect(t2.spent).toBe(true);
  });
});

describe('trap kinds', () => {
  const step = (kind: Trap['kind']) => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 4.5, state: 'sleep' }]);
    const t = trapAt(w, Math.floor(w.player.x), Math.floor(w.player.z), kind);
    w.advance(1 / 60);
    return { w, t };
  };

  it('alarm makes a loud noise that wakes distant sleepers; it fires once', () => {
    const { w, t } = step('alarm');
    expect(w.drainEvents().some((e) => e.type === 'noise' && e.source === 'alarm' && e.radius! >= 20)).toBe(true);
    expect(w.enemies[0]!.state).not.toBe('sleep');
    w.advance(3);
    expect(w.drainEvents().some((e) => e.type === 'trapTrigger')).toBe(false);
    expect(t.spent).toBe(true);
  });

  it('fire, frost and gas traps make their areas; gas stuns the player', () => {
    expect(step('fire').w.areas.some((a) => a.kind === 'fire')).toBe(true);
    expect(step('frost').w.areas.some((a) => a.kind === 'frost')).toBe(true);
    const gas = step('gas').w;
    gas.advance(0.05);
    expect(gas.player.action?.kind).toBe('stunned');
  });

  it('a dart trap shoots a bolt from the nearest wall that hits the player', () => {
    const w = makeWorld();
    w.player.x = 2.5;
    w.player.z = 9.5;
    trapAt(w, 2, 9, 'dart');
    w.advance(1 / 60);
    expect(w.projectiles.some((p) => p.kind === 'bolt' && p.source === '飛鏢陷阱')).toBe(true);
    const hp = w.player.hp;
    w.advance(1);
    expect(w.player.hp).toBe(hp - 2);
  });

  it('a teleport trap moves the player far away', () => {
    const level = generateLevel('DV2-TELE', { floor: 1 });
    const w = new World(level);
    const x = w.player.x;
    const z = w.player.z;
    trapAt(w, Math.floor(x), Math.floor(z), 'teleport');
    w.advance(1 / 60);
    expect(Math.hypot(w.player.x - x, w.player.z - z)).toBeGreaterThan(6);
  });

  it('enemies trigger traps too; a thrown stone landing on one sets it off', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 5.5, z: 5.5 }]);
    const t = trapAt(w, 5, 5, 'fire');
    w.advance(1 / 60);
    expect(t.spent).toBe(true);
    const w2 = makeWorld();
    const t2 = trapAt(w2, 4, 4, 'frost', true);
    triggerTrapAt(w2, 4.5, 4.5);
    expect(t2.spent).toBe(true);
    expect(t2.hidden).toBe(false);
    expect(w2.areas.some((a) => a.kind === 'frost')).toBe(true);
  });
});

describe('vault, key and pedestals', () => {
  function vaultWorld(): { w: World; level: LevelData } {
    const level = generateLevel('DV2-VAULT', { floor: 2 });
    return { w: new World(level, { cls: 'warrior' }), level };
  }

  it('the locked door refuses without the key and opens with it, consuming the key', () => {
    const { w } = vaultWorld();
    const door = w.grid.doors.find((d) => d.locked)!;
    const it = w.interactables.find((i) => i.kind === 'door' && i.ref === door.id)!;
    w.enemies.splice(0);
    const off = door.axis === 'x' ? [0, 1.4] : [1.4, 0];
    for (const sign of [1, -1]) {
      w.player.x = door.cx + off[0]! * sign;
      w.player.z = door.cz + off[1]! * sign;
      if (!w.grid.circleBlocked(w.player.x, w.player.z, PLAYER.radius)) break;
    }
    w.player.yaw = Math.atan2(-(door.cx - w.player.x), -(door.cz - w.player.z));
    run(w, 1);
    expect(w.interactTarget?.id).toBe(it.id);
    expect(w.interactTarget?.enabled).toBe(false);
    w.keys = 1;
    run(w, 1, { interact: true });
    finishAction(w);
    expect(door.locked).toBe(false);
    expect(w.keys).toBe(0);
    expect(door.target).toBe(1);
  });

  it('picking up the key adds it for this floor only', () => {
    const { w } = vaultWorld();
    const key = w.pickups.find((p) => p.kind === 'key')!;
    w.player.x = key.x;
    w.player.z = key.z;
    run(w, 1);
    expect(w.keys).toBe(1);
    expect(w.carry()).not.toHaveProperty('keys');
  });

  it('taking one pedestal treasure sinks the other two and identifies it', () => {
    const { w, level } = vaultWorld();
    const pedestals = w.interactables.filter((i) => i.kind === 'pedestal');
    expect(pedestals).toHaveLength(3);
    const pick = pedestals.find((p) => level.pedestals![p.ref]!.item === 'potion:healing')!;
    w.enemies.splice(0);
    w.player.x = pick.x;
    w.player.z = pick.z + 1.2;
    w.player.yaw = 0;
    run(w, 1);
    expect(w.interactTarget?.id).toBe(pick.id);
    run(w, 1, { interact: true });
    finishAction(w);
    expect(pedestals.every((p) => p.used)).toBe(true);
    expect(w.chosenPedestals.has(pick.id)).toBe(true);
    expect(w.player.items.some((it) => it.id === 'potion:healing')).toBe(true);
    expect(w.player.known).toContain('potion:healing');
    run(w, 1, { interact: true });
    expect(w.player.items.filter((it) => it.id === 'potion:healing').reduce((n, it) => n + it.count, 0)).toBe(1);
  });
});

describe('floor feelings', () => {
  it('darkness shortens enemy sight', () => {
    let dark: LevelData | null = null;
    for (const seed of SEEDS) {
      for (let f = 2; f <= 4 && !dark; f++) if (floorFeeling(seed, f) === 'dark') dark = generateLevel(seed, { floor: f });
      if (dark) break;
    }
    expect(dark).not.toBeNull();
    const w = new World(dark!);
    expect(w.sightMul).toBeLessThan(1);
    expect(dark!.torches).toHaveLength(0);
  });

  it('every special room supplies loot and ordinary chests keep the fixed healing budget', () => {
    for (const seed of SEEDS.slice(0, 40)) for (let floor = 1; floor <= 4; floor++) {
      const l = generateLevel(seed, { floor });
      const healing = l.chests.filter((c) => c.contents.items[0]?.id === 'potion:healing' &&
        !(l.specialRooms ?? []).some((s) => s.kind === 'stash' && s.roomKey === c.roomKey)).length;
      const loose = l.pickups.filter((p) => p.item === 'potion:healing').length;
      // 固定預算：第 1 層 3、第 2–4 層 2（寶箱優先，不足的放在地上）
      expect(healing + loose).toBeGreaterThanOrEqual(floor === 1 ? 3 : 2);
    }
  });
});

describe('enemy dormancy and the item area budget remain intact', () => {
  it('fire areas on enemies still tick the existing damage', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 5.5, z: 5.5 }]);
    spawnArea(w, 'fire', 5.5, 5.5);
    const hp = w.enemies[0]!.hp;
    w.advance(ITEM_FX.area.fire.tick + 0.01);
    expect(w.enemies[0]!.hp).toBe(hp - ITEM_FX.area.fire.damage);
    expect(ENEMIES.guard.hp).toBeGreaterThan(0);
    expect(emptyInput().wait).toBe(false);
  });
});
