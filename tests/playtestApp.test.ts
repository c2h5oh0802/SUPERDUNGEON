import { afterEach, describe, expect, it, vi } from 'vitest';
import { angleDiff, yawFromDir } from '../src/core/math';
import type { InputHandlers, RawFrame } from '../src/input/input';
import { createPublicPlaytestWorld, type PlaytestStage } from '../src/playtest/scenario';
import type { PlaytestEventName, PlaytestFun, PlaytestIssue } from '../src/playtest/telemetry';
import { newRun, serializeRun } from '../src/sim/run';
import { emptyInput } from '../src/sim/types';
import type { World } from '../src/sim/world';

const captured = vi.hoisted(() => ({
  world: null as World | null,
  raw: {} as Partial<RawFrame>,
  handlers: null as InputHandlers | null,
  frames: [] as Array<(dt: number) => void>,
  installDevApi: vi.fn(),
  setWorld: vi.fn<(w: World) => void>(),
  clearWorld: vi.fn(),
  requestLock: vi.fn<() => Promise<boolean>>(),
  exitLock: vi.fn(),
  hint: vi.fn(),
  configured: false,
  factory: vi.fn(),
  telemetry: {
    landing: vi.fn(), start: vi.fn(), stage: vi.fn<(stage: PlaytestStage) => void>(),
    progression: vi.fn<(status: 'start' | 'complete' | 'fail', stage: PlaytestStage, score?: number) => void>(),
    event: vi.fn<(name: PlaytestEventName, value?: number) => void>(), retry: vi.fn(),
    feedback: vi.fn<(fun?: PlaytestFun, issue?: PlaytestIssue) => void>(),
    visibility: vi.fn<(hidden: boolean) => void>(), pagehide: vi.fn(), dispose: vi.fn(),
  },
}));
vi.mock('../src/dev/devapi', () => ({ installDevApi: captured.installDevApi }));
vi.mock('../src/playtest/telemetry', async importOriginal => ({
  ...await importOriginal<typeof import('../src/playtest/telemetry')>(),
  createBrowserPlaytestTelemetry: (options: unknown) => {
    captured.factory(options);
    return { ...captured.telemetry, configured: captured.configured, status: captured.configured ? 'ready' : 'disabled' };
  },
}));
vi.mock('../src/render/renderer', () => ({ GameRenderer: class {
  shared = { uSlow: { value: 0 } }; render = vi.fn(); onEvents = vi.fn();
  resize = vi.fn(); setOptions = vi.fn();
  setWorld(w: World) { captured.world = w; captured.setWorld(w); }
  clearWorld() { captured.world = null; captured.clearWorld(); }
} }));
vi.mock('../src/ui/hud', () => ({ Hud: class {
  update = vi.fn(); onEvents = vi.fn(); setTouchMode = vi.fn();
  show = vi.fn(); reset = vi.fn(); setLockBanner = vi.fn(); hint = captured.hint;
} }));
vi.mock('../src/audio/sfx', () => ({ Sfx: class {
  setSlow = vi.fn(); setListener = vi.fn(); onEvents = vi.fn(); unlock = vi.fn();
  ui = vi.fn(); setVolumes = vi.fn(); resume = vi.fn(); suspend = vi.fn();
} }));
vi.mock('../src/core/loop', () => ({ Loop: class {
  start(cb: (dt: number) => void) { captured.frames.push(cb); }
  resetClock = vi.fn();
} }));
vi.mock('../src/input/input', () => ({ Input: class {
  constructor(_canvas: unknown, handlers: InputHandlers) { captured.handlers = handlers; }
  consume = () => ({
    moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, keyYaw: 0, keyPitch: 0,
    fire: false, firePressed: false, selectSlot: null, shield: false, sneak: false,
    inventory: false, bottle: false, interact: false, potion: false, wait: false,
    map: false, escape: false, digit: null, ...captured.raw,
  });
  attach = vi.fn(); clear = vi.fn(() => { captured.raw = {}; });
  exitLock = captured.exitLock; requestLock = captured.requestLock;
  locked = false; fallback = false; lockEverWorked = false;
} }));
vi.mock('../src/input/touch', () => ({ TouchInput: class {
  attach = vi.fn(); clear = vi.fn();
  consume = () => ({
    moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, keyYaw: 0, keyPitch: 0,
    fire: false, firePressed: false, selectSlot: null, shield: false, sneak: false,
    inventory: false, bottle: false, interact: false, potion: false, wait: false,
    map: false, escape: false, digit: null,
  });
} }));

/** CPU-only UI/input/render harness, matching the existing Boss App tests. */
class ElementStub extends EventTarget {
  attributes = new Map<string, string>();
  classes = new Set<string>();
  classList = {
    toggle: (name: string, force?: boolean) => {
      const present = force ?? !this.classes.has(name);
      if (present) this.classes.add(name); else this.classes.delete(name);
      return present;
    },
    add: (name: string) => { this.classes.add(name); },
    remove: (name: string) => { this.classes.delete(name); },
  };
  style = { setProperty: vi.fn(), removeProperty: vi.fn(), opacity: '' };
  value = ''; textContent = ''; innerHTML = ''; className = ''; disabled = false; checked = false;
  focus = vi.fn();
  querySelector = () => new ElementStub();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  click() { this.dispatchEvent(new Event('click')); }
}

const CAMPAIGN_KEY = 'superdungeon.run.v1';
const DT = 1 / 60;
async function setup(search = '?playtest=1&dev=1&boss=1', touch = false, configured = false) {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  captured.frames = []; captured.world = null; captured.raw = {}; captured.handlers = null;
  captured.configured = configured;
  captured.requestLock.mockReset().mockResolvedValue(true);
  const nodes = new Map<string, ElementStub>();
  const node = (id: string) => {
    let el = nodes.get(id);
    if (!el) { el = new ElementStub(); nodes.set(id, el); }
    return el;
  };
  const doc = Object.assign(new EventTarget(), {
    body: new ElementStub(), documentElement: { requestFullscreen: vi.fn<() => Promise<void>>() },
    fullscreenElement: null as unknown, fullscreenEnabled: true, visibilityState: 'visible',
    exitFullscreen: vi.fn<() => Promise<void>>(), getElementById: node,
    querySelectorAll: (selector: string) => selector === '[data-fullscreen]' ? [node('full-menu'), node('full-pause')]
      : selector === '[data-fullscreen-note]' ? [node('note-menu'), node('note-pause')] : [],
  });
  doc.documentElement.requestFullscreen.mockImplementation(async () => {
    doc.fullscreenElement = doc.documentElement;
    doc.dispatchEvent(new Event('fullscreenchange'));
  });
  doc.exitFullscreen.mockImplementation(async () => {
    doc.fullscreenElement = null;
    doc.dispatchEvent(new Event('fullscreenchange'));
  });
  const visualViewport = Object.assign(new EventTarget(), { width: 844, height: 320, offsetTop: 0, offsetLeft: 0, scale: 1 });
  const saved = serializeRun(newRun('PUBLIC-SAVE-SENTINEL', 'huntress'));
  const storage = new Map([[CAMPAIGN_KEY, saved]]);
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn((key: string) => { storage.delete(key); }),
  };
  const win = Object.assign(new EventTarget(), {
    innerWidth: 844, innerHeight: 390, visualViewport,
    matchMedia: () => ({ matches: touch }), localStorage, setTimeout: globalThis.setTimeout,
  });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('location', { search });
  // Import creates the real App exactly once. Capturing its Loop callback avoids
  // constructing a second App or depending on an exposed development API.
  await import('../src/main');
  expect(captured.frames).toHaveLength(1);
  const frame = (raw: Partial<RawFrame> = {}, dt = DT) => {
    captured.raw = raw;
    captured.frames[0]!(dt);
    captured.raw = {};
  };
  const world = () => { expect(captured.world).not.toBeNull(); return captured.world!; };
  const shown = (id: string) => !node(id).classes.has('hidden');
  return { node, doc, win, storage, saved, localStorage, frame, world, shown };
}
type Harness = Awaited<ReturnType<typeof setup>>;
const tickLoad = () => vi.advanceTimersByTimeAsync(35);
const eventCount = (name: PlaytestEventName) => captured.telemetry.event.mock.calls.filter(([event]) => event === name).length;
function expectNoCampaignStorage(h: Harness) {
  for (const operation of [h.localStorage.getItem, h.localStorage.setItem, h.localStorage.removeItem])
    expect(operation.mock.calls.filter(call => call[0] === CAMPAIGN_KEY)).toEqual([]);
  expect(h.storage.get(CAMPAIGN_KEY)).toBe(h.saved);
}
async function start(h: Harness) {
  h.node('btn-playtest-start').click();
  await tickLoad();
  expect(h.world().level.publicPlaytest).toBe('calibration');
  expect(captured.handlers!.playing!()).toBe(true);
}

/** Feed actual raw movement/mouse/button input through App -> World -> observer.
 * The controller only reads combat state; no HP, position, phase, observer,
 * milestone or learned-state injection can make this transition succeed. */
function playCalibration(h: Harness, stopAfterFirst = false) {
  const calibrationWorld = h.world();
  const initialHits = eventCount('recovery_hit_equivalent');
  let firedThisCycle = false;
  let previousPhase = calibrationWorld.enemies[0]!.phase;
  const independentCues = new Set<string>();
  for (let f = 0; f < 12000 && captured.handlers!.playing!(); f++) {
    const p = calibrationWorld.player, enemy = calibrationWorld.enemies[0]!;
    if (enemy.phase === 'windup' && previousPhase !== 'windup') firedThisCycle = false;
    previousPhase = enemy.phase;
    const yaw = yawFromDir(enemy.x - p.x, enemy.z - p.z) + (f < 12 ? .2 : 0);
    const distance = Math.hypot(enemy.x - p.x, enemy.z - p.z);
    const input: Partial<RawFrame> = { lookDX: -angleDiff(yaw, p.yaw) / .0022 };
    if (enemy.phase === 'none') input.moveZ = distance > 3.2 ? 1 : 0;
    if ((enemy.phase === 'windup' && enemy.locked) || enemy.phase === 'active') input.moveZ = -1;
    if (enemy.phase === 'recovery' && !p.action) {
      input.moveZ = 1;
      if (distance <= 2.45 && !firedThisCycle) {
        input.fire = true; input.firePressed = true; firedThisCycle = true;
      }
    }
    if (p.action?.kind === 'melee') input.moveZ = p.action.hitSet.has(enemy.id) ? (distance < 2.6 ? -1 : 0) : (distance > 2.1 ? 1 : 0);
    h.frame(input);
    if (eventCount('recovery_hit_equivalent') === initialHits + 1) independentCues.add(h.node('playtest-cue').textContent);
    if (stopAfterFirst && eventCount('recovery_hit_equivalent') > initialHits) break;
  }
  return { calibrationWorld, independentCues };
}
async function completeCalibration(h: Harness) {
  const { calibrationWorld, independentCues } = playCalibration(h);
  expect(eventCount('core_loop_learned')).toBe(1);
  expect(captured.telemetry.progression).toHaveBeenCalledWith('complete', 'calibration', calibrationWorld.realTime);
  expect(h.shown('screen-loading')).toBe(true);
  await tickLoad();
  expect(h.world()).not.toBe(calibrationWorld);
  expect(h.world().level.publicPlaytest).toBe('core');
  return { calibrationWorld, independentCues };
}
function finish(h: Harness, outcome: 'dead' | 'win' = 'dead') {
  h.world().outcome = outcome;
  for (let f = 0; f < 110; f++) h.frame({}, .02);
  expect(h.shown('screen-results')).toBe(true);
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('public playtest App flow (real App, World, calibration; CPU presentation stubs)', () => {
  it('isolates campaign storage across landing, start, learned calibration, core, results, retry and return', async () => {
    const h = await setup();
    expect(captured.installDevApi).not.toHaveBeenCalled();
    expect(captured.factory).toHaveBeenCalledExactlyOnceWith({ source: 'direct', device: 'desktop' });
    expect(captured.telemetry.landing).toHaveBeenCalledTimes(1);
    expect(h.shown('screen-playtest')).toBe(true);
    expect(h.shown('screen-menu')).toBe(false);
    expect(h.shown('btn-boss-test')).toBe(false);
    expect(h.node('playtest-privacy').textContent).toContain('不傳送分析資料');
    expectNoCampaignStorage(h);
    for (const id of ['btn-continue', 'btn-start', 'btn-new', 'btn-practice', 'btn-trials', 'btn-boss-test', 'btn-boss-test-start']) h.node(id).click();
    expect(captured.world).toBeNull();
    expect(h.shown('screen-playtest')).toBe(true);
    await start(h);
    expectNoCampaignStorage(h);
    await completeCalibration(h);
    expectNoCampaignStorage(h);
    h.frame({ inventory: true, map: true });
    expect(captured.handlers!.playing!()).toBe(true);
    finish(h);
    expectNoCampaignStorage(h);
    h.node('btn-retry').click(); await tickLoad();
    expect(h.world().level.publicPlaytest).toBe('core');
    expectNoCampaignStorage(h);
    h.frame({ escape: true }); h.node('btn-quit').click(); await tickLoad();
    expect(captured.world).toBeNull();
    expect(h.shown('screen-playtest')).toBe(true);
    expect(captured.installDevApi).not.toHaveBeenCalled();
    expectNoCampaignStorage(h);
  });

  it('transitions only after two real slow-observe/dodge/recovery-hit cycles and removes second-cycle solution guidance', async () => {
    const h = await setup('?playtest=1&src=discord');
    await start(h);
    const { calibrationWorld, independentCues } = await completeCalibration(h);
    for (const name of ['attack_seen', 'slow_time_observed', 'attack_committed', 'evade_equivalent', 'recovery_hit_equivalent'] as const)
      expect(eventCount(name), name).toBe(2);
    for (const name of ['first_move', 'first_look', 'core_loop_learned', 'core_start'] as const)
      expect(eventCount(name), name).toBe(1);
    expect([...independentCues].every(cue => cue.includes('練習 1/2') && cue.includes('再獨立完成一次'))).toBe(true);
    expect([...independentCues].some(cue => cue.includes('現在攻擊'))).toBe(false);
    expect(calibrationWorld.player.hp).toBe(calibrationWorld.player.maxHp);
    expect(calibrationWorld.enemies[0]!.alive).toBe(false);
    expect(h.world().carry()).toEqual(createPublicPlaytestWorld('core').carry());
    expect(h.node('playtest-cue').textContent).toBe('');
    expect(captured.hint).not.toHaveBeenCalled();
    expect(captured.requestLock).toHaveBeenCalledTimes(1);
    expect(captured.telemetry.stage.mock.calls).toEqual([['calibration'], ['core']]);
    expectNoCampaignStorage(h);
  });

  it('retry discards first-cycle learning so the replacement calibration still requires two complete cycles', async () => {
    const h = await setup(); await start(h);
    const { calibrationWorld } = playCalibration(h, true);
    expect(eventCount('recovery_hit_equivalent')).toBe(1);
    expect(eventCount('core_loop_learned')).toBe(0);
    expect(h.node('playtest-cue').textContent).toContain('再獨立完成一次');
    h.frame({ escape: true }); h.node('btn-restart').click(); await tickLoad();
    expect(h.world()).not.toBe(calibrationWorld);
    expect(h.node('playtest-cue').textContent).toContain('先放開按鍵');
    expect(h.world().carry()).toEqual(createPublicPlaytestWorld('calibration').carry());
    await completeCalibration(h);
    expect(eventCount('recovery_hit_equivalent')).toBe(3);
    expect(eventCount('slow_time_observed')).toBe(3);
    expect(eventCount('core_loop_learned')).toBe(1);
    expect(captured.telemetry.retry).toHaveBeenCalledTimes(1);
    expect(captured.telemetry.stage.mock.calls).toEqual([['calibration'], ['calibration'], ['core']]);
    expectNoCampaignStorage(h);
  });

  it.each([false, true])('death remains on results until explicit retry, which rebuilds all state (touch=%s)', async touch => {
    const h = await setup('?playtest=1', touch);
    await start(h);
    const old = h.world();
    old.player.hp = 1; old.player.hunger = 180; old.player.invisT = 3;
    old.player.items.push({ id: 'scroll:identify', count: 1, level: 0 });
    old.frame(DT, { ...emptyInput(), fire: true, firePressed: true });
    old.enemies[0]!.hp = 2; old.enemies[0]!.paralyzeT = 5;
    old.time = 99; old.stats.damageTaken.guard = 9;
    finish(h);
    expect(h.node('res-title').textContent).toBe('你倒下了');
    expect(eventCount('player_death')).toBe(1);
    expect(captured.telemetry.progression).toHaveBeenCalledWith('fail', 'calibration', old.realTime);
    expect(captured.telemetry.event).toHaveBeenCalledWith('damage', 9);
    expect(captured.setWorld).toHaveBeenCalledTimes(1);
    for (let f = 0; f < 300; f++) h.frame({}, .02);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.world()).toBe(old);
    expect(h.world().outcome).toBe('dead');
    expect(h.shown('screen-results')).toBe(true);
    expect(eventCount('player_death')).toBe(1);
    expect(captured.setWorld).toHaveBeenCalledTimes(1);
    for (const id of ['btn-new', 'btn-swap', 'btn-boss-test-result-options']) expect(h.shown(id)).toBe(false);
    h.node('playtest-fun').value = 'slow_time'; h.node('playtest-issue').value = 'controls';
    h.node('btn-playtest-feedback').click();
    h.node('btn-retry').click(); h.node('btn-retry').click(); await tickLoad();
    const fresh = h.world(), reference = createPublicPlaytestWorld('calibration');
    expect(fresh).not.toBe(old);
    expect(fresh.carry()).toEqual(reference.carry());
    expect(fresh.player).toEqual(reference.player);
    expect(fresh.enemies).toEqual(reference.enemies);
    expect(fresh.projectiles).toEqual([]); expect(fresh.areas).toEqual([]); expect(fresh.smokes).toEqual([]);
    expect(fresh.time).toBe(0); expect(fresh.realTime).toBe(0); expect(fresh.stats.damageTaken).toEqual({});
    expect(fresh.outcome).toBe('none'); expect(fresh.pendingChoice).toBeNull();
    expect(h.node('playtest-fun').value).toBe(''); expect(h.node('playtest-issue').value).toBe('');
    expect(h.node('playtest-feedback-status').textContent).toBe('');
    expect(h.node('btn-playtest-feedback').disabled).toBe(false);
    expect(captured.telemetry.retry).toHaveBeenCalledTimes(1);
    expect(captured.setWorld).toHaveBeenCalledTimes(2);
    expectNoCampaignStorage(h);
    if (touch) expect(captured.requestLock).not.toHaveBeenCalled();
  });

  it.each([
    ['', '', 0], ['slow_time', '', 1], ['', 'controls', 1], ['dodge_counter', 'hard', 1], ['position', 'performance', 1], ['none', 'none', 1],
    ['', 'unclear', 1], ['', 'easy', 1], ['', 'slow', 1],
  ])('keeps feedback optional and sends valid choices at most once (%s, %s)', async (fun, issue, calls) => {
    const h = await setup('?playtest=1', false, true);
    expect(h.node('playtest-privacy').textContent).toContain('GameAnalytics');
    h.node('playtest-fun').value = fun; h.node('playtest-issue').value = issue;
    h.node('btn-playtest-feedback').click();
    expect(captured.telemetry.feedback).not.toHaveBeenCalled();
    await start(h); finish(h);
    h.node('playtest-fun').value = fun; h.node('playtest-issue').value = issue;
    h.node('btn-playtest-feedback').click(); h.node('btn-playtest-feedback').click();
    expect(captured.telemetry.feedback).toHaveBeenCalledTimes(calls);
    if (calls) {
      expect(captured.telemetry.feedback).toHaveBeenCalledWith(fun || undefined, issue || undefined);
      expect(h.node('btn-playtest-feedback').disabled).toBe(true);
      expect(h.node('playtest-feedback-status').textContent).toContain('不保證成功');
    }
    h.node('btn-menu').click();
    expect(h.shown('screen-playtest')).toBe(true);
    expect(eventCount('voluntary_quit')).toBe(0);
    expectNoCampaignStorage(h);
  });

  it('coalesces duplicate starts and cancels stale timer/lock completions when returning to landing', async () => {
    const h = await setup();
    h.node('btn-playtest-start').click(); h.node('btn-playtest-start').click();
    await tickLoad();
    expect(captured.setWorld).toHaveBeenCalledTimes(1);
    expect(captured.telemetry.start).toHaveBeenCalledTimes(1);
    h.frame({ escape: true }); h.node('btn-restart').click(); h.node('btn-quit').click(); await tickLoad();
    expect(captured.world).toBeNull(); expect(h.shown('screen-playtest')).toBe(true);
    expect(captured.setWorld).toHaveBeenCalledTimes(1);
    let resolve!: (ok: boolean) => void;
    captured.requestLock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    h.node('btn-playtest-start').click(); await tickLoad();
    expect(h.shown('screen-loading')).toBe(true);
    h.node('btn-quit').click();
    captured.exitLock.mockClear();
    captured.handlers!.onLockChange(true);
    expect(captured.exitLock).toHaveBeenCalledTimes(1);
    h.node('btn-playtest-start').click(); await tickLoad();
    const fresh = h.world();
    resolve(false); await Promise.resolve();
    expect(h.world()).toBe(fresh); expect(captured.handlers!.playing!()).toBe(true);
    expect(h.shown('screen-playtest')).toBe(false);
    expectNoCampaignStorage(h);
  });

  it('records each core fallback hint kind once without leaking calibration/trial solutions', async () => {
    const h = await setup(); await start(h); await completeCalibration(h);
    const w = h.world();
    // Advance only the fallback clock. Real World frames still produce activity
    // and damage events; enemy AI is held harmless for this UI timer boundary.
    for (const e of w.enemies) e.paralyzeT = 999;
    w.realTime = 22.1; h.frame(); h.frame();
    expect(eventCount('hint_inactivity')).toBe(1);
    expect(h.node('playtest-cue').textContent).toContain('有點卡住');
    w.realTime = 35.1; h.frame(); h.frame();
    expect(eventCount('hint_no_attack')).toBe(1);
    expect(h.node('playtest-cue').textContent).toContain('左鍵可以出手');
    for (let i = 0; i < 3; i++) { w.damagePlayer(1, 'guard', w.player.x + 1, w.player.z); h.frame(); }
    h.frame();
    expect(eventCount('hint_repeated_damage')).toBe(1);
    expect(h.node('playtest-cue').textContent).toContain('先停下來觀察');
    expect(captured.hint).not.toHaveBeenCalled();
    expect(h.node('playtest-cue').textContent).not.toMatch(/鎖定|收招|反擊|側移|弩矢/);
    h.frame({ escape: true }); h.node('btn-restart').click(); await tickLoad();
    expect(h.node('playtest-cue').textContent).toBe('');
    for (const e of h.world().enemies) e.paralyzeT = 999;
    h.world().realTime = 22.1; h.frame();
    expect(eventCount('hint_inactivity')).toBe(2);
  });

  it('logs core completion once and does not turn a finished result into abandonment', async () => {
    const h = await setup(); await start(h); await completeCalibration(h);
    for (const enemy of h.world().enemies) enemy.alive = false;
    h.frame();
    expect(h.world().outcome).toBe('win');
    finish(h, 'win');
    expect(h.node('res-title').textContent).toBe('遭遇完成');
    expect(eventCount('core_complete')).toBe(1);
    expect(captured.telemetry.progression).toHaveBeenCalledWith('complete', 'core', h.world().realTime);
    h.win.dispatchEvent(new Event('pagehide')); h.win.dispatchEvent(new Event('blur'));
    h.node('btn-menu').click();
    expect(captured.telemetry.landing).toHaveBeenCalledTimes(2);
    expect(eventCount('voluntary_quit')).toBe(0);
    expect(captured.telemetry.pagehide).not.toHaveBeenCalled();
    expect(eventCount('blur')).toBe(0);
    // Returning to landing starts a new funnel visit, with no active-stage quit.
    h.win.dispatchEvent(new Event('pagehide'));
    expect(captured.telemetry.pagehide).toHaveBeenCalledTimes(1);
    expect(eventCount('voluntary_quit')).toBe(0);
    expectNoCampaignStorage(h);
  });

  it('forwards focus, visibility and pagehide as uncertainty signals without treating them as voluntary quit', async () => {
    const h = await setup();
    // Landing exits are part of the funnel too; the adapter owns deduplication.
    h.win.dispatchEvent(new Event('pagehide')); h.win.dispatchEvent(new Event('blur'));
    h.doc.visibilityState = 'hidden'; h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(captured.telemetry.pagehide).toHaveBeenCalledTimes(1);
    expect(captured.telemetry.visibility.mock.calls).toEqual([[true], [true]]);
    h.doc.visibilityState = 'visible'; h.doc.dispatchEvent(new Event('visibilitychange'));
    h.win.dispatchEvent(new Event('focus'));
    expect(captured.telemetry.visibility.mock.calls.slice(-2)).toEqual([[false], [false]]);
    await start(h);
    h.win.dispatchEvent(new Event('blur')); h.win.dispatchEvent(new Event('pagehide'));
    expect(captured.telemetry.visibility).toHaveBeenLastCalledWith(true);
    expect(captured.telemetry.pagehide).toHaveBeenCalledTimes(2);
    expect(eventCount('voluntary_quit')).toBe(0);
    finish(h);
    captured.telemetry.visibility.mockClear(); captured.telemetry.pagehide.mockClear();
    h.win.dispatchEvent(new Event('focus')); h.win.dispatchEvent(new Event('blur'));
    h.doc.dispatchEvent(new Event('visibilitychange')); h.win.dispatchEvent(new Event('pagehide'));
    expect(captured.telemetry.visibility).not.toHaveBeenCalled();
    expect(captured.telemetry.pagehide).not.toHaveBeenCalled();
  });

  it.each(['', '?boss=1', '?playtest=0'])('leaves ordinary menu/campaign entry independent of public telemetry (%s)', async search => {
    const h = await setup(search);
    expect(captured.factory).not.toHaveBeenCalled();
    expect(captured.telemetry.landing).not.toHaveBeenCalled();
    expect(captured.installDevApi).not.toHaveBeenCalled();
    expect(h.shown('screen-menu')).toBe(true);
    expect(h.shown('screen-playtest')).toBe(false);
    expect(h.shown('btn-continue')).toBe(true);
    expect(h.localStorage.getItem).toHaveBeenCalledWith(CAMPAIGN_KEY);
    h.node('btn-continue').click(); await tickLoad();
    expect(h.world().level.publicPlaytest).toBeUndefined();
    expect(h.world().level.practice).toBe(false);
    expect(h.world().player.cls).toBe('huntress');
    expect(captured.factory).not.toHaveBeenCalled();
    expect(h.storage.get(CAMPAIGN_KEY)).toBe(h.saved);
  });

  it('suppresses generic solution hints in the real HUD while preserving ordinary-world hints', async () => {
    const h = await setup();
    const { Hud } = await vi.importActual<typeof import('../src/ui/hud')>('../src/ui/hud');
    const hud = new Hud();
    for (const stage of ['calibration', 'core'] as const) {
      const w = createPublicPlaytestWorld(stage);
      hud.reset();
      hud.onEvents([{ type: 'enemyWindup', kind: 'guard' }, { type: 'enemyWindup', kind: 'archer' }], w);
      hud.hint('generic-solution', '鎖定後側移，收招時攻擊');
      expect(h.node('hint').textContent).toBe('');
    }
    const ordinary = createPublicPlaytestWorld('calibration');
    delete ordinary.level.publicPlaytest;
    hud.reset(); hud.resetHints();
    hud.onEvents([{ type: 'enemyWindup', kind: 'guard' }], ordinary);
    expect(h.node('hint').textContent).toContain('盾衛舉劍');
  });
});
