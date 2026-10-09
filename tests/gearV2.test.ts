import { describe, expect, it } from 'vitest';
import { ENEMIES, GEAR, ITEM_FX, POTIONS_V2, SCROLLS_V2, STEALTH, TIPS, WEAPONS } from '../src/config';
import { Rng } from '../src/core/rng';
import { rollEquipment, rollItem } from '../src/gen/loot';
import { generateLevel } from '../src/gen/validate';
import { damageEnemy, updateEnemies } from '../src/sim/enemySys';
import {
  addItem, applyIdentification, drinkPotion, equipFromBag, gearName, identifyTargets, itemDesc, looksFor, queueUse,
  readScroll, shatterPotion, takeForAction, updateAreas,
} from '../src/sim/items';
import { actionTotal } from '../src/sim/playerSys';
import { createFloorWorld, newRun, nextFloor, parseRun, serializeRun } from '../src/sim/run';
import { TER } from '../src/sim/grid';
import { World } from '../src/sim/world';
import { english } from '../src/ui/i18n';
import { finishAction, makeWorld, OPEN_ROOM, run } from './helpers';

const han = /\p{Script=Han}/u;

describe('unknown equipment rolls', () => {
  it('v2 floors roll unknown gear from +0 to +2, never negative; curses are mild, never enchanted, and +0; F1 has no enchants', () => {
    const rng = new Rng('GEAR-ROLLS');
    const levels = new Set<number>();
    let cursed = 0, enchanted = 0, n = 0;
    for (let k = 0; k < 4000; k++) {
      const floor = 1 + (k % 4);
      const r = rollEquipment(rng, floor, 2);
      n++;
      expect(r.unknown).toBe(true);
      levels.add(r.level);
      expect(r.level).toBeGreaterThanOrEqual(0);
      expect(r.level).toBeLessThanOrEqual(2);
      if (r.curse) {
        cursed++;
        expect(r.ench).toBeUndefined();
        expect(r.level).toBe(0);
        expect(r.id.startsWith('weapon:') ? ['heavy'] : ['noisy', 'fragile']).toContain(r.curse);
      }
      if (r.ench) {
        enchanted++;
        expect(floor).toBeGreaterThan(1);
        expect(r.id.startsWith('weapon:') ? ['chill', 'impact', 'flame'] : ['silent', 'thorns', 'fireproof']).toContain(r.ench);
      }
      if (floor <= 2) expect(r.level).toBeLessThanOrEqual(1);
    }
    expect([...levels].sort()).toEqual([0, 1, 2]);
    expect(cursed / n).toBeGreaterThan(GEAR.curseChance - 0.04);
    expect(cursed / n).toBeLessThan(GEAR.curseChance + 0.04);
    expect(enchanted).toBeGreaterThan(0);
  });

  it('legacy pool keeps the old known +0/+1 equipment and the old consumable lists', () => {
    const rng = new Rng('LEGACY-ROLLS');
    for (let k = 0; k < 600; k++) {
      const r = rollItem(rng, 3);
      expect(r.unknown).toBeUndefined();
      expect(r.ench).toBeUndefined();
      expect(r.curse).toBeUndefined();
      expect(r.id).not.toMatch(/mindvision|terror|removecurse/);
    }
  });

  it('v2 floors place the new consumables and unknown gear; vault equipment is known, statue weapons are enchanted', () => {
    const seen = new Set<string>();
    let unknownGear = 0, vaultEnch = 0, statueWeapons = 0;
    for (let k = 0; k < 120; k++) for (let floor = 1; floor <= 4; floor++) {
      const l = generateLevel(`GEAR-${k}`, { floor });
      for (const p of l.pickups) if (p.item) {
        seen.add(p.item);
        if (p.gear?.unknown) unknownGear++;
      }
      for (const c of l.chests) for (const it of c.contents.items) {
        seen.add(it.id);
        if (it.unknown) unknownGear++;
      }
      for (const pd of l.pedestals ?? []) {
        if (!pd.item.startsWith('weapon:') && !pd.item.startsWith('armor:')) continue;
        const statue = (l.specialRooms ?? []).some((r) => r.kind === 'statue' && r.roomKey === pd.roomKey);
        if (statue) {
          statueWeapons++;
          expect(['chill', 'impact', 'flame']).toContain(pd.ench);
        } else if (pd.ench) vaultEnch++;
        expect(pd.level).toBeGreaterThanOrEqual(1);
      }
    }
    for (const id of ['potion:mindvision', 'scroll:terror', 'scroll:removecurse']) expect(seen).toContain(id);
    expect(unknownGear).toBeGreaterThan(100);
    expect(statueWeapons).toBeGreaterThan(20);
    expect(vaultEnch).toBeGreaterThan(5);
  }, 120000);
});

describe('names and English', () => {
  it('unknown gear hides everything; known gear shows level, enchant and curse', () => {
    expect(gearName('weapon:longsword', 1, { unknown: true, ench: 'flame' })).toBe('未知的長劍');
    expect(gearName('weapon:longsword', -1, { curse: 'heavy' })).toBe('長劍 −1〔沉重的詛咒〕');
    expect(gearName('armor:leather', 2, { ench: 'thorns' })).toBe('皮甲 +2〔荊棘〕');
    expect(english('未知的長劍')).toBe('Unknown Longsword');
    expect(english('長劍 −1〔沉重的詛咒〕')).toBe('Longsword −1 [Heavy Curse]');
    expect(english('皮甲 +2〔荊棘〕')).not.toMatch(han);
    const w = makeWorld();
    for (const text of [
      itemDesc(w, 'weapon:axe', 0, { unknown: true }),
      itemDesc(w, 'weapon:knife', 1, { ench: 'chill' }),
      itemDesc(w, 'armor:mail', -1, { curse: 'noisy' }),
      itemDesc(w, 'armor:leather', 1, { ench: 'fireproof' }),
    ]) expect(english(text), text).not.toMatch(han);
  });
});

describe('equipping unknown and cursed gear', () => {
  it('equipping reveals the item; a cursed slot refuses every swap until an upgrade scroll lifts the curse (+1)', () => {
    const w = makeWorld();
    addItem(w, 'weapon:axe', -1, { unknown: true, curse: 'heavy' });
    addItem(w, 'weapon:spear', 1, { unknown: true });
    queueUse(w, 0, 'use');
    run(w, 1);
    finishAction(w);
    expect(w.player.weapon).toEqual({ id: 'axe', level: -1, curse: 'heavy' });
    expect(w.events.some((e) => e.type === 'identify' && e.text?.includes('沉重的詛咒'))).toBe(true);
    expect(w.events.some((e) => e.type === 'curse')).toBe(true);
    // 換不下來：介面與行動都拒絕
    const spear = w.player.items.findIndex((it) => it.id === 'weapon:spear');
    queueUse(w, spear, 'use');
    expect(w.player.pendingUse).toBeNull();
    expect(takeForAction(w, spear, 'use')).toBeNull();
    equipFromBag(w, 'weapon:spear', 1, { unknown: true });
    expect(w.player.weapon.id).toBe('axe');
    // 強化卷軸：解除詛咒並 +1
    readScroll(w, 'upgrade');
    expect(w.pendingChoice?.kind).toBe('upgrade');
    w.resolveChoice((w.pendingChoice as { options: string[] }).options.indexOf('weapon'));
    expect(w.player.weapon).toEqual({ id: 'axe', level: 0 });
    queueUse(w, w.player.items.findIndex((it) => it.id === 'weapon:spear'), 'use');
    run(w, 1);
    finishAction(w);
    expect(w.player.weapon.id).toBe('spear');
    expect(w.player.items.find((it) => it.id === 'weapon:axe')).toMatchObject({ level: 0 });
  });

  it('a remove-curse scroll lifts curses on worn and carried gear; the identify scroll reveals unknown gear', () => {
    const w = makeWorld();
    w.player.armor = { id: 'mail', level: 0, curse: 'fragile' };
    addItem(w, 'armor:leather', -1, { curse: 'noisy' });
    readScroll(w, 'removecurse');
    expect(w.player.armor.curse).toBeUndefined();
    expect(w.player.items[0]!.curse).toBeUndefined();
    addItem(w, 'weapon:knife', 2, { unknown: true, ench: 'impact' });
    const target = w.player.items.find((it) => it.unknown)!;
    expect(identifyTargets(w)).toContain(target);
    expect(applyIdentification(w, target)).toBe(true);
    expect(target.unknown).toBeUndefined();
    expect(target).toMatchObject({ id: 'weapon:knife', level: 2, ench: 'impact' });
  });

  it('dropping and re-picking keeps the gear traits', () => {
    const w = makeWorld();
    addItem(w, 'armor:leather', 1, { unknown: true, ench: 'silent' });
    queueUse(w, 0, 'drop');
    run(w, 1);
    finishAction(w);
    const pk = w.pickups.find((p) => p.item === 'armor:leather')!;
    expect(pk.gear).toEqual({ unknown: true, ench: 'silent' });
    w.player.x += 3;
    run(w, 2);
    w.player.x -= 3;
    run(w, 30);
    expect(w.player.items[0]).toMatchObject({ id: 'armor:leather', level: 1, unknown: true, ench: 'silent' });
  });
});

describe('curse and glyph effects on the time rules', () => {
  it('heavy: melee windup ×1.4, counter swings included', () => {
    const w = makeWorld();
    w.player.weapon = { id: 'longsword', level: 0 };
    const base = actionTotal(w, 'melee');
    w.player.weapon.curse = 'heavy';
    expect(actionTotal(w, 'melee') - base).toBeCloseTo(WEAPONS.longsword.windup * (GEAR.heavyWindupMul - 1), 6);
  });

  it('noisy: louder footsteps, and sneaking is no longer silent; silent halves the radius', () => {
    const steps = (setup: (w: World) => void, sneak: boolean) => {
      const w = makeWorld();
      setup(w);
      run(w, 120, { moveZ: 1, sneak });
      return w.events.filter((e) => e.type === 'noise' && (e.source === 'step' || e.source === 'splash')).map((e) => e.radius!);
    };
    const plain = steps(() => {}, false);
    expect(plain.length).toBeGreaterThan(0);
    expect(steps(() => {}, true)).toEqual([]);
    const loud = steps((w) => { w.player.armor = { id: 'leather', level: 0, curse: 'noisy' }; }, false);
    expect(loud[0]).toBeCloseTo(plain[0]! * GEAR.noisyMul, 6);
    const sneakNoisy = steps((w) => { w.player.armor = { id: 'leather', level: 0, curse: 'noisy' }; }, true);
    expect(sneakNoisy.length).toBeGreaterThan(0);
    expect(sneakNoisy[0]).toBeCloseTo(STEALTH.footstepRadius, 6);
    const quiet = steps((w) => { w.player.armor = { id: 'leather', level: 0, ench: 'silent' }; }, false);
    expect(quiet[0]).toBeCloseTo(plain[0]! * GEAR.silentMul, 6);
  });

  it('fragile: one extra damage per hit (not hunger); fireproof: no fire damage', () => {
    const w = makeWorld();
    w.player.armor = { id: 'leather', level: 0, curse: 'fragile' };
    const hp = w.player.hp;
    w.damagePlayer(3, '測試', 0, 0);
    expect(hp - w.player.hp).toBe(3 - 1 + GEAR.fragileExtra);
    const w2 = makeWorld();
    w2.player.armor = { id: 'leather', level: 0, ench: 'fireproof' };
    w2.areas.push({ id: 99, kind: 'fire', x: w2.player.x, z: w2.player.z, radius: 2, age: 0, life: 5, tickT: 0, hitPlayer: false });
    const hp2 = w2.player.hp;
    updateAreas(w2, 2, () => {});
    expect(w2.player.hp).toBe(hp2);
  });

  it('thorns: an enemy that lands a melee hit stumbles', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 13.0, yaw: 0 }]);
    w.player.armor = { id: 'leather', level: 0, ench: 'thorns' };
    const g = w.enemies[0]!;
    g.state = 'alert';
    g.awareness = 1;
    g.seesPlayer = true;
    g.yaw = Math.PI;
    for (let k = 0; k < 240 && g.phase !== 'stagger'; k++) updateEnemies(w, 1 / 120);
    expect(w.player.hp).toBeLessThan(w.player.maxHp);
    expect(g.phase).toBe('stagger');
  });
});

describe('weapon enchants change the enemy state', () => {
  function hitWith(ench: 'chill' | 'impact' | 'flame', rows = OPEN_ROOM, z = 12.6) {
    const w = makeWorld(rows, [{ kind: 'guard', x: 9.5, z, yaw: 0 }]);
    w.player.weapon = { id: 'longsword', level: 0, ench };
    w.player.yaw = 0;
    const g = w.enemies[0]!;
    g.state = 'alert';
    run(w, 1, { fire: true, firePressed: true });
    for (let k = 0; k < 40 && w.player.action; k++) run(w, 1);
    return { w, g };
  }

  it('chill slows the enemy timeline for 1.5 s', () => {
    const { g } = hitWith('chill');
    expect(g.slowT).toBeGreaterThan(GEAR.chillDuration - 0.5);
    expect(TIPS.chill.timeScale).toBeLessThan(1);
  });

  it('impact pushes the enemy 1 m; into a wall it staggers', () => {
    const { g } = hitWith('impact');
    expect(12.6 - g.z).toBeGreaterThan(GEAR.impactDist * 0.8);
    const rows = OPEN_ROOM.slice();
    rows[11] = '####################';
    const near = hitWith('impact', rows, 12.6);
    expect(near.g.phase).toBe('stagger');
    expect(near.w.stats.wallSlams).toBe(1);
  });

  it('flame lights a small fire that ignites reeds', () => {
    const { w } = hitWith('flame');
    const fire = w.areas.find((a) => a.kind === 'fire')!;
    expect(fire.radius).toBe(GEAR.flame.radius);
    const w2 = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 12.6, yaw: 0 }]);
    for (let j = 11; j <= 14; j++) for (let i = 8; i <= 11; i++) w2.grid.setTerrain(i, j, TER.Reeds);
    w2.player.weapon = { id: 'longsword', level: 5, ench: 'flame' };
    w2.player.yaw = 0;
    run(w2, 1, { fire: true, firePressed: true });
    for (let k = 0; k < 40 && w2.player.action; k++) run(w2, 1);
    w2.advance(1);
    let ash = 0;
    for (let j = 11; j <= 14; j++) for (let i = 8; i <= 11; i++) if (w2.grid.terrainAt(i, j) === TER.Ash) ash++;
    expect(w2.burning.size + ash).toBeGreaterThan(0);
  });
});

describe('new consumables', () => {
  it('mind vision lasts 20 world seconds; thrown, it only shatters', () => {
    const w = makeWorld();
    drinkPotion(w, 'mindvision');
    expect(w.player.mindT).toBe(ITEM_FX.mindvision.duration);
    w.advance(5);
    expect(w.player.mindT).toBeCloseTo(ITEM_FX.mindvision.duration - 5, 3);
    shatterPotion(w, 'mindvision', w.player.x, 0.2, w.player.z - 2);
    expect(w.areas).toEqual([]);
  });

  it('terror makes nearby enemies flee for 5 s, then they fight again; bosses, statues and disguised mimics are immune', () => {
    const w = makeWorld(OPEN_ROOM, [
      { kind: 'guard', x: 9.5, z: 11.5, yaw: Math.PI },
      { kind: 'guard', x: 9.5, z: 2.5, yaw: Math.PI },
      { kind: 'statue', x: 6.5, z: 13.5 },
      { kind: 'mimic', x: 12.5, z: 13.5 },
    ]);
    readScroll(w, 'terror');
    const [near, far, statue, mimic] = w.enemies;
    expect(near!.fearT).toBe(ITEM_FX.terror.duration);
    expect(far!.fearT ?? 0).toBe(0);
    expect(statue!.fearT ?? 0).toBe(0);
    expect(mimic!.fearT ?? 0).toBe(0);
    const d0 = Math.hypot(near!.x - w.player.x, near!.z - w.player.z);
    w.player.invisT = 0;
    w.advance(2);
    expect(Math.hypot(near!.x - w.player.x, near!.z - w.player.z)).toBeGreaterThan(d0 + 1.5);
    w.advance(ITEM_FX.terror.duration);
    expect(near!.fearT).toBe(0);
    expect(near!.state).toBe('alert');
  });

  it('a locked attack still lands before the enemy flees', () => {
    const w = makeWorld(OPEN_ROOM, [{ kind: 'guard', x: 9.5, z: 13.0, yaw: Math.PI }]);
    const g = w.enemies[0]!;
    g.state = 'alert';
    g.awareness = 1;
    g.seesPlayer = true;
    for (let k = 0; k < 240 && !g.locked; k++) updateEnemies(w, 1 / 120);
    expect(g.locked).toBe(true);
    readScroll(w, 'terror');
    const hp = w.player.hp;
    for (let k = 0; k < 120; k++) updateEnemies(w, 1 / 120);
    expect(w.player.hp).toBeLessThan(hp);
    expect(ENEMIES.guard.damage).toBeGreaterThan(0);
  });
});

describe('saves and appearances', () => {
  it('new runs use appearance version 3: seven potions and six scrolls shuffled together; old versions keep the old looks', () => {
    for (let k = 0; k < 30; k++) {
      const l3 = looksFor(`LOOK3-${k}`, 3);
      expect(new Set(POTIONS_V2.map((id) => l3.potion[id])).size).toBe(7);
      expect(new Set(SCROLLS_V2.map((id) => l3.scroll[id])).size).toBe(6);
      const l2 = looksFor(`LOOK3-${k}`, 2);
      expect(l2.potion.mindvision).toBe(6);
      expect([l2.scroll.terror, l2.scroll.removecurse]).toEqual([4, 5]);
    }
    const mv = new Set<number>();
    for (let k = 0; k < 60; k++) mv.add(looksFor(`MV-${k}`, 3).potion.mindvision);
    expect(mv.size).toBeGreaterThan(3);
  });

  it('gear traits, −1 levels, mind vision and new items survive a save round trip', () => {
    const run0 = newRun('GEAR-SAVE', 'warrior');
    const w = createFloorWorld(run0);
    w.player.weapon = { id: 'axe', level: -1, curse: 'heavy' };
    w.player.armor = { id: 'leather', level: 2, ench: 'thorns' };
    addItem(w, 'weapon:spear', 1, { unknown: true, ench: 'flame' });
    addItem(w, 'potion:mindvision');
    addItem(w, 'scroll:removecurse');
    const next = nextFloor(run0, w);
    const back = parseRun(serializeRun(next))!;
    expect(back).not.toBeNull();
    expect(back.carry!.weapon).toEqual({ id: 'axe', level: -1, curse: 'heavy' });
    expect(back.carry!.armor).toEqual({ id: 'leather', level: 2, ench: 'thorns' });
    expect(back.carry!.items.find((it) => it.id === 'weapon:spear')).toEqual({ id: 'weapon:spear', count: 1, level: 1, unknown: true, ench: 'flame' });
    const w2 = createFloorWorld(back);
    expect(w2.player.weapon.curse).toBe('heavy');
  });

  it('rejects impossible gear traits', () => {
    const run0 = newRun('GEAR-BAD', 'warrior');
    const w = createFloorWorld(run0);
    const good = JSON.parse(serializeRun(nextFloor(run0, w)));
    type Carry = { weapon: Record<string, unknown>; armor: Record<string, unknown>; items: unknown[] };
    const bad = (mut: (o: { carry: Carry }) => void) => {
      const o = structuredClone(good);
      mut(o);
      return parseRun(JSON.stringify(o));
    };
    expect(bad(() => {})).not.toBeNull();
    expect(bad((o) => { o.carry.weapon.ench = 'thorns'; })).toBeNull();
    expect(bad((o) => { o.carry.armor.curse = 'heavy'; })).toBeNull();
    expect(bad((o) => { o.carry.weapon.unknown = true; })).toBeNull();
    expect(bad((o) => { o.carry.items = [{ id: 'potion:healing', count: 1, level: 0, ench: 'flame' }]; })).toBeNull();
    expect(bad((o) => { o.carry.items = [{ id: 'scroll:terror', count: 1, level: -1 }]; })).toBeNull();
    expect(bad((o) => { o.carry.items = [{ id: 'weapon:axe', count: 1, level: -2 }]; })).toBeNull();
    expect(bad((o) => { o.carry.items = [{ id: 'weapon:axe', count: 1, level: -1, curse: 'heavy', unknown: true }]; })).not.toBeNull();
  });
});

describe('enemy drops on v2 floors use the new pool', () => {
  it('veterans can drop unknown gear', () => {
    const w = new World(generateLevel('GEAR-DROP', { floor: 3 }));
    let unknown = 0;
    for (let k = 0; k < 200; k++) {
      const e = w.enemies[0]!;
      e.alive = true;
      e.hp = 1;
      e.veteran = true;
      damageEnemy(w, e, 5, { source: 'melee', sneak: false, head: false, x: e.x, y: 1, z: e.z });
    }
    for (const p of w.pickups) if (p.gear?.unknown) unknown++;
    expect(unknown).toBeGreaterThan(10);
  });
});
