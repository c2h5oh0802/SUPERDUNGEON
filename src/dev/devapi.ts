import { PLAYER, type ItemId } from '../config';
import { addItem } from '../sim/items';
import { gainXp } from '../sim/progress';
import { activeLoopCount } from '../core/loop';
import { levelSignature } from '../gen/generator';
import { geometryCacheSize } from '../render/characters';
import { Nav } from '../sim/nav';
import type { World } from '../sim/world';
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
        template: w.level.templateId,
        mirrored: w.level.mirrored,
        floor: w.level.floor,
        goal: w.level.goal,
        run: app.run ? { floor: app.run.floor, seed: app.run.seed, cls: app.run.cls } : null,
        time: w.time,
        realTime: w.realTime,
        lastWorldDt: w.lastWorldDt,
        lastRealDt: w.lastRealDt,
        outcome: w.outcome,
        heartTaken: w.heartTaken,
        awakened: w.awakened,
        pendingAltar: w.pendingAltar,
        fallback: app.input.fallback,
        locked: app.input.locked,
        player: {
          cls: p.cls,
          x: p.x,
          z: p.z,
          yaw: p.yaw,
          pitch: p.pitch,
          hp: p.hp,
          maxHp: p.maxHp,
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
          bottles: p.bottles,
          potions: p.potions,
          tool: p.tool,
          desiredTool: p.desiredTool,
          action: p.action
            ? {
                kind: p.action.kind,
                t: p.action.t,
                total: p.action.windup + p.action.active + p.action.recovery,
                counter: p.action.counter,
                countered: p.action.countered,
                tip: p.action.tip,
                fired: p.action.fired,
              }
            : null,
          hasHeart: p.hasHeart,
          dead: p.dead,
          runes: p.runes.slice(),
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
          alive: e.alive,
          awareness: e.awareness,
          perched: e.perched,
          roomKey: e.roomKey,
          shieldUp: e.shieldUp,
          veteran: e.veteran,
          paralyzeT: e.paralyzeT,
          slowT: e.slowT,
          pushing: !!e.push,
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
        lastAction: w.lastAction ? { ...w.lastAction } : null,
        cueText: document.getElementById('cue')?.textContent ?? '',
        smokes: w.smokes.map((s) => ({ id: s.id, x: s.x, y: s.y, z: s.z, radius: s.radius, age: s.age, air: s.air })),
        pickups: w.pickups.filter((k) => !k.taken).map((k) => ({ id: k.id, kind: k.kind, amount: k.amount, x: k.x, y: k.y, z: k.z })),
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
        /** 生成結果的完整簽章（地形、門、敵人初始位置、補給、祭壇），用來比對同種子重試。 */
        signature: levelSignature(l),
        w: l.grid.w,
        h: l.grid.h,
        spawn: l.spawn,
        heart: l.heart,
        stairs: l.stairs,
        rooms: l.rooms,
        altars: l.altars.map((a) => ({ x: a.x, z: a.z, offer: a.offer })),
        chests: l.chests.map((c) => ({ x: c.x, z: c.z })),
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
      giveItem(id: ItemId, level = 0) {
        const w = app.world;
        return w ? addItem(w, id, level) : false;
      },
      /** 狀態注入：給經驗。 */
      giveXp(n: number) {
        const w = app.world;
        if (w) gainXp(w, n);
      },
    },
  };
  (window as unknown as { __sd: typeof api }).__sd = api;
}
