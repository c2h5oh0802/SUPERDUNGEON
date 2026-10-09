import { PLAYER, TALENTS, type TalentId, type ItemId } from '../config';
import { T, TER } from '../sim/grid';
import { revealAround } from '../sim/dungeon';
import { hungerState } from '../sim/hunger';
import { addItem } from '../sim/items';
import { damageEnemy, wardenCrownClosed } from '../sim/enemySys';
import { applyTalent, gainXp } from '../sim/progress';
import { activeLoopCount } from '../core/loop';
import { levelSignature } from '../gen/generator';
import { geometryCacheSize } from '../render/characters';
import { Nav } from '../sim/nav';
import type { World } from '../sim/world';
import type { GearProps } from '../sim/types';
import type { App } from '../main';

// 開發模式（網址加 ?dev=1）：讀取時間、玩家、敵人、種子與關鍵事件，供自動化測試使用。
// 讀取類 API 不改變遊戲狀態；debug.* 是狀態注入，只用來定位問題，測試報告中需標示。

export function installDevApi(app: App): void {
  let navFor: World | null = null;
  let nav: Nav | null = null;
  const getNav = (w: World) => {
    if (navFor !== w || !nav) {
      nav = new Nav(w.grid, PLAYER.radius);
      navFor = w;
    }
    return nav;
  };
  const api = {
    state() {
      const w = app.world;
      if (!w) return { mode: app.mode, world: null };
      const p = w.player;
      return {
        mode: app.mode,
        seed: app.seed,
        practice: app.practice,
        bossTest: app.bossTestActive ? { preset: app.bossTestPreset } : null,
        practiceTrial: w.level.practiceTrial ?? null,
        template: w.level.templateId,
        mirrored: w.level.mirrored,
        floor: w.level.floor,
        goal: w.level.goal,
        encounterState: w.encounterState,
        hungerPaused: w.hungerPaused,
        heartAvailable: w.heartAvailable,
        specialRooms: w.level.specialRooms,
        run: app.run ? { floor: app.run.floor, seed: app.run.seed, cls: app.run.cls } : null,
        time: w.time,
        realTime: w.realTime,
        lastWorldDt: w.lastWorldDt,
        lastRealDt: w.lastRealDt,
        outcome: w.outcome,
        heartTaken: w.heartTaken,
        awakened: w.awakened,
        fallback: app.input.fallback,
        locked: app.input.locked,
        touchMode: app.touchMode,
        timeUse: { ...w.timeUse },
        waves: { spawned: w.wavesSpawned, left: w.wavesLeft },
        machines: w.machines.map((m) => ({ id: m.id, kind: m.kind, x: m.x, z: m.z, phase: m.phase, charge: m.charge, cycle: m.cycle })),
        recording: app.replayRec ? { frames: app.replayRec.frames.length, combatStart: app.replayRec.combatStart, tainted: app.replayRec.tainted } : null,
        replay: app.replay ? { from: app.replay.player.from, to: app.replay.player.to, time: app.replay.player.world.time, done: app.replay.player.done, diverged: app.replay.player.diverged } : null,
        player: {
          cls: p.cls,
          x: p.x,
          z: p.z,
          yaw: p.yaw,
          pitch: p.pitch,
          hp: p.hp,
          maxHp: p.maxHp,
          hunger: p.hunger,
          hungerState: hungerState(p.hunger),
          starvationT: p.starvationT,
          eyeY: app.renderer.camera.position.y,
          hitHeight: PLAYER.height,
          arrows: p.arrows,
          stones: p.stones,
          tipped: { ...p.tipped },
          tipKind: p.tipKind,
          slots: p.slots.slice(),
          weapon: { ...p.weapon },
          armor: { ...p.armor },
          bowLevel: p.bowLevel,
          shieldLevel: p.shieldLevel,
          items: p.items.map((i) => ({ ...i })),
          known: p.known.slice(),
          xp: p.xp,
          level: p.level,
          talents: p.talents.slice(),
          sneaking: p.sneaking,
          invisT: p.invisT,
          pendingUse: p.pendingUse ? { ...p.pendingUse } : null,
          hasteT: p.hasteT,
          mindT: p.mindT ?? 0,
          bottles: p.bottles,
          tool: p.tool,
          desiredTool: p.desiredTool,
          action: p.action
            ? {
                kind: p.action.kind,
                t: p.action.t,
                windup: p.action.windup,
                active: p.action.active,
                recovery: p.action.recovery,
                total: p.action.windup + p.action.active + p.action.recovery,
                counter: p.action.counter,
                countered: p.action.countered,
                tip: p.action.tip,
                fired: p.action.fired,
              }
            : null,
          hasHeart: p.hasHeart,
          dead: p.dead,
        },
        enemies: w.enemies.map((e) => ({
          id: e.id,
          kind: e.kind,
          x: e.x,
          z: e.z,
          y: e.y,
          yaw: e.yaw,
          state: e.state,
          phase: e.phase,
          phaseT: e.phaseT,
          locked: e.locked,
          lockedYaw: e.lockedYaw,
          hp: e.hp,
          maxHp: e.maxHp,
          alive: e.alive,
          awareness: e.awareness,
          seesPlayer: e.seesPlayer,
          lastKnown: e.lastKnown ? { ...e.lastKnown } : null,
          target: e.target ? { ...e.target } : null,
          searchT: e.searchT,
          moving: e.moving,
          patrolIdx: e.patrolIdx,
          doorWaitT: e.doorWaitT,
          doorWaitId: e.doorWaitId,
          perched: e.perched,
          roomKey: e.roomKey,
          shieldUp: e.shieldUp,
          veteran: e.veteran,
          boss: e.boss,
          warden: e.warden ? { ...e.warden } : null,
          crownClosed: wardenCrownClosed(e),
          aimPoint: e.aimPoint ? { ...e.aimPoint } : null,
          pendingSleep: e.pendingSleep,
          huntingMarkRemaining: e.alive ? Math.max(0, (e.huntingMarkUntil ?? 0) - w.time) : 0,
          paralyzeT: e.paralyzeT,
          slowT: e.slowT,
          pushing: !!e.push,
          carriesKey: !!e.carriesKey,
          elite: e.elite ?? null,
          disguised: !!e.disguised,
          dormant: !!e.dormant,
          hornUsed: !!e.hornUsed,
        })),
        projectiles: w.projectiles.map((q) => ({
          id: q.id,
          kind: q.kind,
          owner: q.owner,
          x: q.pos.x,
          y: q.pos.y,
          z: q.pos.z,
          vx: q.vel.x,
          vy: q.vel.y,
          vz: q.vel.z,
          gravity: q.gravity,
          deflected: q.deflected,
          tip: q.tip,
        })),
        /** 職業提示（與畫面上的「反擊」「盾推」提示、獵人之眼標記同一個判定）。 */
        cue: { counter: w.cue.counter, push: w.cue.push, eye: w.cue.eye.map((e) => ({ ...e })) },
        soundCues: w.senses.map(c => ({ ...c })),
        lastAction: w.lastAction ? { ...w.lastAction } : null,
        cueText: document.getElementById('cue')?.textContent ?? '',
        smokes: w.smokes.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, radius: s.radius, age: s.age, air: s.air })),
        pickups: w.pickups.filter((k) => !k.taken).map((k) => ({ id: k.id, kind: k.kind, item: k.item, amount: k.amount, x: k.x, y: k.y, z: k.z })),
        interactables: w.interactables.map((i) => ({ id: i.id, kind: i.kind, x: i.x, z: i.z, used: i.used, ref: i.ref })),
        doors: w.grid.doors.map((d) => ({ id: d.id, cx: d.cx, cz: d.cz, progress: d.progress, target: d.target, barred: d.barred, arch: d.arch, axis: d.axis })),
        interactTarget: w.interactTarget,
        pendingChoice: w.pendingChoice ? { ...w.pendingChoice } : null,
        alarm: w.alarm,
        areas: w.areas.map((a) => ({ kind: a.kind, x: a.x, z: a.z, radius: a.radius, age: a.age })),
        stats: { ...w.stats, damageTaken: { ...w.stats.damageTaken } },
      };
    },
    level() {
      const w = app.world;
      if (!w) return null;
      const l = w.level;
      return {
        seed: l.seed,
        template: l.templateId,
        /** 生成結果的完整簽章（地形、門、敵人初始位置、補給），用來比對同種子重試。 */
        signature: levelSignature(l),
        w: l.grid.w,
        h: l.grid.h,
        spawn: l.spawn,
        heart: l.heart,
        stairs: l.stairs,
        rooms: l.rooms,
        chests: l.chests.map((c) => ({ x: c.x, z: c.z })),
      };
    },
    /** 生成版本 2 的地城資訊：地形、秘密門、上鎖門、陷阱、寶庫（只讀）。 */
    dungeon() {
      const w = app.world;
      if (!w) return null;
      const g = w.grid;
      const cells: Record<'reeds' | 'flat' | 'water' | 'chasm', Array<[number, number]>> = { reeds: [], flat: [], water: [], chasm: [] };
      for (let j = 0; j < g.h; j++) for (let i = 0; i < g.w; i++) {
        const t = g.terrainAt(i, j);
        if (t === TER.Reeds) cells.reeds.push([i, j]);
        else if (t === TER.Flat) cells.flat.push([i, j]);
        else if (t === TER.Water) cells.water.push([i, j]);
        if (g.get(i, j) === T.Chasm) cells.chasm.push([i, j]);
      }
      return {
        gen: w.level.gen ?? 1,
        feeling: w.level.feeling ?? null,
        keys: w.keys,
        reinforcements: w.reinforcements,
        alarm: w.alarm,
        fell: w.fell,
        cells,
        doors: g.doors.filter((d) => d.hidden !== undefined || d.locked !== undefined)
          .map((d) => ({ id: d.id, cx: d.cx, cz: d.cz, axis: d.axis, hidden: !!d.hidden, locked: !!d.locked, progress: d.progress })),
        traps: w.traps.map((t) => ({ id: t.id, i: t.i, j: t.j, kind: t.kind, hidden: t.hidden, spent: t.spent, state: t.state })),
        pedestals: w.interactables.filter((it) => it.kind === 'pedestal').map((it) => ({ id: it.id, x: it.x, z: it.z, used: it.used, roomKey: it.roomKey, item: w.level.pedestals?.[it.ref]?.item })),
        specialRooms: w.level.specialRooms ?? [],
        keyPickups: w.pickups.filter((k) => k.kind === 'key' && !k.taken).map((k) => ({ x: k.x, z: k.z })),
      };
    },
    /** 自動化輔助：以玩家半徑的導航格求路徑（只讀，不移動角色）。 */
    pathTo(x: number, z: number, ignoreBars = false) {
      const w = app.world;
      if (!w) return null;
      return getNav(w).findPath(w.player.x, w.player.z, x, z, ignoreBars);
    },
    lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
      const w = app.world;
      return w ? w.canSee({ x: ax, y: ay, z: az }, { x: bx, y: by, z: bz }) : false;
    },
    events() {
      return app.devEvents.slice();
    },
    loops: () => activeLoopCount(),
    perf() {
      const p = { ...app.perf };
      app.perf.frames = 0;
      app.perf.simMs = 0;
      app.perf.renderMs = 0;
      app.perf.hudMs = 0;
      const n = Math.max(1, p.frames);
      return { frames: p.frames, simMs: p.simMs / n, renderMs: p.renderMs / n, hudMs: p.hudMs / n };
    },
    renderInfo: () => ({ ...app.renderer.info(), sceneCalls: app.renderer.lastCalls, geometryCache: geometryCacheSize(), bakeMs: app.renderer.lastBakeMs, vertices: app.renderer.lastVertexCount }),
    listeners: () => app.input.listenerCount,
    inputState: () => ({ held: app.input.heldKeys(), locked: app.input.locked, fallback: app.input.fallback, mode: app.mode }),
    audio: () => ({ active: app.sfx.active }),
    /** 狀態注入（僅供除錯定位，不可作為正常流程證據）。 */
    debug: {
      /** 聚焦 AI 測試：狀態注入，不是玩家輸入或真人流程證據。 */
      defeatGuardians() {
        const w = app.world;
        if (!w?.level.encounter) return;
        for (const e of w.enemies) if (e.boss && e.alive)
          damageEnemy(w, e, e.hp, { source: 'debug', sneak: false, head: false, x: e.x, y: e.y, z: e.z });
      },
      /** 狀態注入：直接擊倒一名敵人（照常掉落鑰匙、寶物與經驗）。 */
      defeatEnemy(id: number) {
        const w = app.world;
        const e = w?.enemies.find((x) => x.id === id && x.alive);
        if (!w || !e) return false;
        damageEnemy(w, e, e.hp + 99, { source: 'debug', sneak: false, head: false, x: e.x, y: e.y, z: e.z });
        return !e.alive;
      },
      setInvisible(seconds: number) {
        if (app.world) app.world.player.invisT = Math.max(0, seconds);
      },
      advance(seconds: number) {
        if (app.world) app.world.advance(Math.max(0, Math.min(seconds, 120)));
      },
      noise(x: number, z: number, radius: number) {
        app.world?.emitNoise(x, 1, z, radius, 'debug');
      },
      smoke(x: number, z: number) {
        const w = app.world;
        if (w) w.smokes.push({ id: w.nextId++, x, y: 1, z, age: 1, radius: 4, air: false });
      },
      /** 狀態注入：立刻走下這一層（測試用）。 */
      descend() {
        const w = app.world;
        if (w && w.level.goal === 'descend' && w.outcome === 'none') w.outcome = 'descend';
      },
      /** 狀態注入：揭開整層的秘密門與隱藏陷阱。 */
      revealAll() {
        const w = app.world;
        if (!w) return 0;
        return revealAround(w, w.player.x, w.player.z, 9999);
      },
      teleport(x: number, z: number) {
        const w = app.world;
        if (!w) return;
        w.player.x = x;
        w.player.z = z;
      },
      setView(yaw: number, pitch: number) {
        app.setView(yaw, pitch);
      },
      /** 效能實驗：隱藏某類物件。 */
      hide(what: 'enemies' | 'level' | 'props' | 'none') {
        app.renderer.debugHide(what);
      },
      setHp(hp: number) {
        const w = app.world;
        if (w) w.player.hp = hp;
      },
      /** 狀態注入：放一件物品進背包。 */
      giveItem(id: ItemId, level = 0, gear?: GearProps) {
        const w = app.world;
        return w ? addItem(w, id, level, gear) : false;
      },
      /** Focused talent fixtures only, not natural progression evidence. */
      giveTalent(t: TalentId) {
        if (app.world && Object.hasOwn(TALENTS, t)) applyTalent(app.world, t);
      },
      /** 狀態注入：給經驗。 */
      giveXp(n: number) {
        const w = app.world;
        if (w) gainXp(w, n);
      },
      /** Start the prototype replay now with what has been recorded (not a world change). */
      replayNow() {
        return app.replayNow();
      },
    },
  };
  // Any other debug call changes the world outside recorded input: a replay
  // would then show a different fight, so it is switched off for this world.
  const debug = api.debug as Record<string, unknown>;
  for (const [name, fn] of Object.entries(debug)) {
    if (typeof fn !== 'function' || ['setView', 'hide', 'replayNow'].includes(name)) continue;
    debug[name] = (...args: unknown[]) => {
      if (app.replayRec) app.replayRec.tainted = true;
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  (window as unknown as { __sd: typeof api }).__sd = api;
}
