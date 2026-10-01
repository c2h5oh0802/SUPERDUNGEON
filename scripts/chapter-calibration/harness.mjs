/** Deterministic chapter resource cost/exposure harness. See docs/chapter1-baselines/METHODOLOGY.md. */
import process from "node:process";
import console from "node:console";
import { writeFileSync } from "node:fs";
import { PLAYER, RUN, WEAPONS, HUNGER, ACTIONS, CLASSES } from "__SOURCE__/src/config";
import { yawFromDir } from "__SOURCE__/src/core/math";
import { createFloorWorld, newRun, nextFloor } from "__SOURCE__/src/sim/run";
import { Nav } from "__SOURCE__/src/sim/nav";
import { emptyInput } from "__SOURCE__/src/sim/types";
import { queueUse } from "__SOURCE__/src/sim/items";
const dt = 1 / 60;
const results = [];
let traveled = 0, healGuard = false, phase = "walk", eatEnabled = true, holdSneak = false;
let phaseTimes = {}, metrics = {};
const navCache = /* @__PURE__ */ new WeakMap();
const observedItems = /* @__PURE__ */ new WeakMap();
function observePickups(w) {
  const pending = w.pickups.filter((k) => k.kind === "item");
  observedItems.set(w, pending);
  const add2 = w.addPickup.bind(w);
  w.addPickup = (...args) => {
    const k = add2(...args);
    if (k.kind === "item") pending.push(k);
    return k;
  };
}
function navFor(w) {
  let nav = navCache.get(w);
  if (!nav) {
    nav = new Nav(w.grid, PLAYER.radius);
    navCache.set(w, nav);
  }
  return nav;
}
const stockKeys = ["arrows", "stones", "bottles", "potions", "paralysis", "chill"];
const consumable = (id) => /^(food|potion|scroll):/.test(id);
function inventory(w) {
  const p = w.player;
  const out = { arrows: p.arrows, stones: p.stones, bottles: p.bottles, potions: p.potions, paralysis: p.tipped.paralysis, chill: p.tipped.chill };
  for (const it of p.items) if (consumable(it.id)) out[it.id] = (out[it.id] || 0) + it.count;
  return out;
}
function add(into, key, n) {
  into[key] = (into[key] || 0) + n;
}
function frame(w, input = {}) {
  const inventoryAtEntry = inventory(w);
  while (w.pendingChoice) w.resolveChoice(0);
  if (healGuard) w.player.hp = w.player.maxHp;
  const ration = w.player.items.findIndex((i) => i.id === "food:ration");
  if (eatEnabled && !w.player.action && w.player.hunger >= HUNGER.hungryAt && ration >= 0) queueUse(w, ration, "use");
  const eating = w.player.action?.kind === "eat" || w.player.pendingUse;
  const out = eating ? {} : input;
  const x = w.player.x, z = w.player.z, t = w.time, h = w.player.hunger;
  const before = inventoryAtEntry, ground = observedItems.get(w);
  w.frame(dt, { ...emptyInput(w.player.yaw, 0), sneak: holdSneak, ...out });
  const elapsed = w.time - t;
  traveled += Math.hypot(w.player.x - x, w.player.z - z);
  phaseTimes[eating ? "eat" : phase] = (phaseTimes[eating ? "eat" : phase] || 0) + elapsed;
  metrics.maxHunger = Math.max(metrics.maxHunger, w.player.hunger);
  if (h >= HUNGER.starvingAt) metrics.starvingTime += elapsed;
  else if (h >= HUNGER.hungryAt) metrics.hungryTime += elapsed;
  const foundThis = {};
  for (let i = ground.length - 1; i >= 0; i--) {
    const k = ground[i];
    if (k.taken) {
      if (k.item && consumable(k.item)) add(foundThis, k.item, 1);
      ground.splice(i, 1);
    }
  }
  for (const ev of w.drainEvents()) {
    if (ev.type === "pickup" && stockKeys.includes(ev.kind ?? "")) add(foundThis, ev.kind, ev.amount ?? 0);
    if (ev.type === "eat") {
      metrics.foodUsed++;
      metrics.foodRestored += ev.amount ?? 0;
    }
    if (ev.type === "hungerState") metrics.transitions.push({ floor: w.level.floor, worldTime: +w.stats.worldTime.toFixed(3), state: ev.kind });
  }
  const after = inventory(w);
  for (const [key, n] of Object.entries(foundThis)) add(metrics.found, key, n);
  for (const key of /* @__PURE__ */ new Set([...Object.keys(before), ...Object.keys(after), ...Object.keys(foundThis)])) {
    const used = (before[key] || 0) + (foundThis[key] || 0) - (after[key] || 0);
    if (used > 0) add(metrics.used, key, used);
    else if (used < 0) add(metrics.granted, key, -used);
  }
}
const dist = (w, e) => Math.hypot(e.x - w.player.x, e.z - w.player.z);
function visible(w, e) {
  return w.canSee({ x: w.player.x, y: 1.4, z: w.player.z }, { x: e.x, y: e.y + 1.1, z: e.z });
}
function attackStep(w, e) {
  const p = w.player, d = dist(w, e), yaw = yawFromDir(e.x - p.x, e.z - p.z);
  const reach = WEAPONS[p.weapon.id].reach + e.radius - 0.1;
  if (p.hp <= Math.max(4, p.maxHp * 0.5) && p.potions > 0 && !p.action && !healGuard) {
    frame(w, { potion: true });
    return;
  }
  if (d <= reach && visible(w, e)) {
    frame(w, { yaw, selectSlot: 1, fire: !p.action, firePressed: !p.action });
    return;
  }
  const nav = navFor(w), path = nav.findPath(p.x, p.z, e.x, e.z);
  let wp = path?.[0];
  if (path && path.length > 1 && wp && Math.hypot(wp.x - p.x, wp.z - p.z) < 0.5) wp = path[1];
  const door = w.grid.doors.find((d2) => !d2.arch && !d2.barred && d2.progress < 0.999 && Math.hypot(d2.cx - p.x, d2.cz - p.z) < 1.6);
  if (door && !p.action) {
    frame(w, door.target === 0 ? { yaw: yawFromDir(door.cx - p.x, door.cz - p.z), interact: true } : { wait: true });
    return;
  }
  if (wp) frame(w, { yaw: yawFromDir(wp.x - p.x, wp.z - p.z), moveZ: 1 });
  else frame(w, { yaw, wait: true });
}
function fight(w, desiredKills, maxTime = 300) {
  const targetKills = w.stats.kills + desiredKills, start = w.time;
  const nav = navFor(w);
  let chosen;
  let lastSelect = -1;
  phase = "fight";
  let noProgress = 0, lastKills = w.stats.kills;
  for (let f = 0; f < 60 * 1200 && w.outcome === "none" && w.stats.kills < targetKills && w.time - start < maxTime; f++) {
    if (!chosen?.alive || f - lastSelect > 60) {
      const p = w.player;
      let alive = w.enemies.filter((e) => e.alive);
      alive.sort((a, b) => dist(w, a) - dist(w, b));
      chosen = alive.find((e) => dist(w, e) < 3 && visible(w, e)) || alive.map((e) => ({ e, d: nav.pathLength(p.x, p.z, e.x, e.z) })).sort((a, b) => a.d - b.d)[0]?.e;
      lastSelect = f;
    }
    if (!chosen) break;
    attackStep(w, chosen);
    if (w.stats.kills !== lastKills) {
      noProgress = 0;
      lastKills = w.stats.kills;
    } else noProgress++;
    if (noProgress > 60 * 60) {
      break;
    }
  }
  phase = "walk";
  return w.stats.kills >= targetKills;
}
function walk(w, tx, tz, combat = true, arrive = 0.55, maxFrames = 24e3) {
  const nav = navFor(w);
  let path = null;
  for (let f = 0; f < maxFrames; f++) {
    const p = w.player;
    if (dist(w, { x: tx, z: tz }) <= arrive) return true;
    if (w.outcome !== "none") return false;
    const close = combat ? w.enemies.filter((e) => e.alive && dist(w, e) < 2.2 && visible(w, e)).sort((a, b) => dist(w, a) - dist(w, b))[0] : void 0;
    if (close) {
      phase = "incidental_combat";
      attackStep(w, close);
      phase = "walk";
      continue;
    }
    if (f % 10 === 0 || !path) path = nav.findPath(p.x, p.z, tx, tz);
    if (!path?.length) return false;
    let wp = path[0];
    if (path.length > 1 && dist(w, wp) < 0.5) wp = path[1];
    const door = w.grid.doors.find((d) => !d.arch && !d.barred && d.progress < 0.999 && Math.hypot(d.cx - p.x, d.cz - p.z) < 1.6);
    if (door && !p.action) {
      if (door.target === 0) frame(w, { yaw: yawFromDir(door.cx - p.x, door.cz - p.z), interact: true });
      else frame(w, { wait: true });
      continue;
    }
    frame(w, { yaw: yawFromDir(wp.x - p.x, wp.z - p.z), moveZ: 1 });
  }
  return false;
}
function use(w, x, z) {
  phase = "interact";
  for (let k = 0; k < 200 && w.player.action; k++) frame(w, {});
  const yaw = yawFromDir(x - w.player.x, z - w.player.z);
  frame(w, { yaw });
  frame(w, { yaw, interact: true });
  for (let k = 0; k < 200 && w.player.action; k++) frame(w, { yaw });
  phase = "walk";
}
function pickupTotals(w) {
  const out = {};
  for (const k of w.pickups) if (!k.taken) {
    const id = k.kind === "item" ? k.item : k.kind;
    if (id) add(out, id, k.amount);
  }
  return out;
}
const round = (x) => +x.toFixed(3);
function run(seed, cls, policy, guard, food = true) {
  healGuard = guard;
  eatEnabled = food;
  holdSneak = policy === "long_shift";
  metrics = { foodUsed: 0, foodRestored: 0, maxHunger: 0, hungryTime: 0, starvingTime: 0, transitions: [], found: {}, used: {}, granted: {} };
  let run2 = newRun(seed, cls);
  const floors = [];
  traveled = 0;
  phaseTimes = {};
  phase = "walk";
  let totalEnemies = 0;
  let final;
  let initial = {};
  const traversalControl = ["direct", "long_shift", "wait60", "wait180"].includes(policy);
  for (let f = 1; f <= RUN.floors; f++) {
    const carried = final ? inventory(final) : {};
    const w = createFloorWorld(run2);
    observePickups(w);
    if (f === 1) initial = inventory(w);
    else for (const [key, value] of Object.entries(inventory(w))) {
      const gain = value - (carried[key] || 0);
      if (gain > 0) add(metrics.granted, key, gain);
    }
    const n = w.enemies.length;
    totalEnemies += n;
    const encounter = Boolean(w.level.encounter);
    const hungerAtStart = w.player.hunger, starvationHPAtStart = w.stats.damageTaken["\u98E2\u9913"] || 0, hungryAtStart = metrics.hungryTime, starvingAtStart = metrics.starvingTime;
    const d0 = traveled, k0 = w.stats.kills, ch0 = w.stats.chests;
    const found0 = { ...metrics.found }, used0 = { ...metrics.used }, foodUsed0 = metrics.foodUsed;
    const nav = navFor(w);
    let ok = true;
    if (traversalControl) w.enemies.length = 0;
    if (policy === "wait60" || policy === "wait180") {
      phase = "wait";
      for (let i = 0; i < 60 * (policy === "wait180" ? 180 : 60) && w.outcome === "none"; i++) frame(w, { wait: true });
      phase = "walk";
    }
    if (policy === "normal" || policy === "heavy") {
      const chests = w.level.chests.slice();
      for (let visit = 0; visit < (policy === "normal" ? 1 : 2) && chests.length && w.outcome === "none"; visit++) {
        chests.sort((a, b) => nav.pathLength(w.player.x, w.player.z, a.x, a.z) - nav.pathLength(w.player.x, w.player.z, b.x, b.z));
        const c = chests.shift();
        ok = walk(w, c.x - Math.sin(c.yaw) * 1.3, c.z - Math.cos(c.yaw) * 1.3) && ok;
        use(w, c.x, c.z);
      }
      const left = Math.max(0, Math.ceil(n * (policy === "normal" ? 0.3 : 0.7)) - (w.stats.kills - k0));
      if (left) ok = fight(w, left) && ok;
    }
    if (policy === "full_clear") {
      const rooms = w.level.rooms.slice();
      while (rooms.length && w.outcome === "none") {
        rooms.sort((a, b) => nav.pathLength(w.player.x, w.player.z, a.x0 + a.w / 2, a.z0 + a.h / 2) - nav.pathLength(w.player.x, w.player.z, b.x0 + b.w / 2, b.z0 + b.h / 2));
        const r = rooms.shift(), cell = nav.nearestPassable(r.x0 + r.w / 2, r.z0 + r.h / 2);
        if (cell >= 0) {
          const q = nav.center(cell);
          ok = walk(w, q.x, q.z) && ok;
        }
        for (const c of w.level.chests.filter((c2) => c2.roomKey === r.key)) {
          ok = walk(w, c.x - Math.sin(c.yaw) * 1.3, c.z - Math.cos(c.yaw) * 1.3) && ok;
          use(w, c.x, c.z);
        }
      }
      const left = w.enemies.filter((e) => e.alive).length;
      if (left) ok = fight(w, left) && ok;
    }
    if (encounter && !traversalControl) {
      const remaining = w.enemies.filter((e) => e.alive).length;
      if (remaining) ok = fight(w, remaining) && ok;
    }
    const h = w.level.heart;
    ok = walk(w, h.x, h.z + 1.3, !traversalControl, 0.4) && ok;
    use(w, h.x, h.z);
    final = w;
    const difference = (a, b) => Object.fromEntries(Object.entries(a).map(([key, n2]) => [key, n2 - (b[key] || 0)]));
    const floor = { floor: f, encounter, hungerAtStart: round(hungerAtStart), hungryTime: round(metrics.hungryTime - hungryAtStart), starvingTime: round(metrics.starvingTime - starvingAtStart), starvationHP: (w.stats.damageTaken["\u98E2\u9913"] || 0) - starvationHPAtStart, worldTime: round(w.time), distance: round(traveled - d0), kills: w.stats.kills - k0, enemies: n, alive: w.enemies.filter((e) => e.alive).length, chests: w.stats.chests - ch0, hp: w.player.hp, maxHp: w.player.maxHp, endHunger: round(w.player.hunger), foodUsed: metrics.foodUsed - foodUsed0, found: difference(metrics.found, found0), used: difference(metrics.used, used0), remaining: inventory(w), groundRemaining: pickupTotals(w), outcome: w.outcome, ok };
    floors.push(floor);
    if (w.outcome !== (f === RUN.floors ? "win" : "descend")) break;
    run2 = nextFloor(run2, w);
  }
  const summarizeSegment = (fs) => ({ floors: fs.map((f) => f.floor), worldTime: round(fs.reduce((n, f) => n + f.worldTime, 0)), startHunger: fs[0]?.hungerAtStart ?? null, endHunger: fs.at(-1)?.endHunger ?? null, foodFound: fs.reduce((n, f) => n + (f.found["food:ration"] || 0), 0), foodUsed: fs.reduce((n, f) => n + f.foodUsed, 0), starvationHP: fs.reduce((n, f) => n + f.starvationHP, 0), hungryTime: round(fs.reduce((n, f) => n + f.hungryTime, 0)), starvingTime: round(fs.reduce((n, f) => n + f.starvingTime, 0)) });
  const segments = { exploration: summarizeSegment(floors.filter((f) => !f.encounter)), arena: summarizeSegment(floors.filter((f) => f.encounter)) };
  const out = { seed, cls, policy, guard, expectedFloors: RUN.floors, segments, control: traversalControl ? "enemies removed; traps retained" : "live AI/combat", eatEnabled: food, foodFound: metrics.found["food:ration"] || 0, ...metrics, endHunger: round(final.player.hunger), starvationHP: final.stats.damageTaken["\u98E2\u9913"] || 0, foodRemaining: inventory(final)["food:ration"] || 0, initial, remaining: inventory(final), totalEnemies, worldTime: round(final.stats.worldTime), realTime: round(final.stats.realTime), distance: round(traveled), kills: final.stats.kills, damage: final.stats.damageTaken, phaseTimes, complete: floors.length === RUN.floors && floors.at(-1).outcome === "win", policyCompleted: floors.every((f) => f.ok), floors };
  results.push(out);
  console.log("RESULT " + JSON.stringify({ seed, cls, policy, guard, worldTime: out.worldTime, foodFound: out.foodFound, foodUsed: out.foodUsed, endHunger: out.endHunger, starvationHP: out.starvationHP, complete: out.complete }));
  writeFileSync(process.env.OUTPUT, JSON.stringify({ harnessVersion: "chapter-resource-cost-v1.3", source: process.env.SOURCE_REPO, configuration: { HUNGER, eatSeconds: ACTIONS.eat.recovery, starts: { warrior: CLASSES.warrior.start, huntress: CLASSES.huntress.start } }, results }, null, 2));
}
const seeds = (process.env.SEEDS || "FLOW1,FLOW2,LIVING1").split(",");
const classes = (process.env.CLASSES || "warrior,huntress").split(",");
const policies = (process.env.POLICIES || "direct,normal,heavy,full_clear,long_shift,wait60,wait180").split(",");
const guards = (process.env.GUARDS || "true").split(",").map((v) => v === "true");
for (const guard of guards) for (const cls of classes) for (const seed of seeds) for (const policy of policies) run(seed, cls, policy, guard, process.env.EAT !== "false");
