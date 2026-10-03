import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Input } from '../src/input/input';
import type { World } from '../src/sim/world';

const captured = vi.hoisted(() => ({
  world: null as World | null,
  frames: [] as Array<(dt: number) => void>,
  lockBanner: vi.fn<(visible: boolean) => void>(),
}));

vi.mock('../src/dev/devapi', () => ({ installDevApi: vi.fn() }));
vi.mock('../src/playtest/telemetry', async importOriginal => ({
  ...await importOriginal<typeof import('../src/playtest/telemetry')>(),
  createBrowserPlaytestTelemetry: () => ({
    configured: false, status: 'disabled', landing: vi.fn(), start: vi.fn(), stage: vi.fn(),
    progression: vi.fn(), event: vi.fn(), retry: vi.fn(), feedback: vi.fn(),
    visibility: vi.fn(), pagehide: vi.fn(), dispose: vi.fn(),
  }),
}));
vi.mock('../src/render/renderer', () => ({ GameRenderer: class {
  shared = { uSlow: { value: 0 } };
  render = vi.fn(); onEvents = vi.fn(); resize = vi.fn(); setOptions = vi.fn();
  setWorld(world: World) { captured.world = world; }
  clearWorld() { captured.world = null; }
} }));
vi.mock('../src/ui/hud', () => ({ Hud: class {
  update = vi.fn(); onEvents = vi.fn(); setTouchMode = vi.fn();
  show = vi.fn(); reset = vi.fn(); hint = vi.fn();
  setLockBanner(visible: boolean) {
    captured.lockBanner(visible);
    document.getElementById('lock-banner')!.classList.toggle('hidden', !visible);
  }
} }));
vi.mock('../src/audio/sfx', () => ({ Sfx: class {
  setSlow = vi.fn(); setListener = vi.fn(); onEvents = vi.fn(); unlock = vi.fn();
  ui = vi.fn(); setVolumes = vi.fn(); resume = vi.fn(); suspend = vi.fn();
} }));
vi.mock('../src/core/loop', () => ({ Loop: class {
  start(frame: (dt: number) => void) { captured.frames.push(frame); }
  resetClock = vi.fn();
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

class ElementStub extends EventTarget {
  classes = new Set<string>();
  attributes = new Map<string, string>();
  classList = {
    toggle: (name: string, force?: boolean) => {
      const visible = force ?? !this.classes.has(name);
      if (visible) this.classes.add(name); else this.classes.delete(name);
      return visible;
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

type LockOutcome = 'async-success' | 'sync-success' | 'reject' | 'error' | 'timeout';

/** Real App + real Input, with the browser's pointer-lock ownership and events.
 * Only presentation/audio/touch/animation are stubbed. No DOM or Input handler
 * is replaced by a direct call to an App lifecycle method. */
async function setup() {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers();
  captured.world = null; captured.frames = [];
  const nodes = new Map<string, ElementStub>();
  const node = (id: string) => {
    let element = nodes.get(id);
    if (!element) { element = new ElementStub(); nodes.set(id, element); }
    return element;
  };
  node('lock-banner').classList.add('hidden');
  const canvas = node('game');
  const doc = Object.assign(new EventTarget(), {
    body: new ElementStub(), documentElement: {}, visibilityState: 'visible',
    pointerLockElement: null as ElementStub | null,
    fullscreenElement: null, fullscreenEnabled: false,
    getElementById: node, querySelectorAll: () => [],
    exitPointerLock: vi.fn(),
  });
  const outcomes: LockOutcome[] = [];
  let inClick = false;
  const lockDuringClick: boolean[] = [];
  const lockChange = (owner: ElementStub | null) => {
    doc.pointerLockElement = owner;
    doc.dispatchEvent(new Event('pointerlockchange'));
  };
  const requestPointerLock = vi.fn(() => {
    lockDuringClick.push(inClick);
    const outcome = outcomes.shift() ?? 'async-success';
    if (outcome === 'reject') return Promise.reject(new Error('Pointer lock cooldown'));
    if (outcome === 'sync-success') lockChange(canvas);
    else if (outcome === 'async-success') queueMicrotask(() => lockChange(canvas));
    else if (outcome === 'error') queueMicrotask(() => doc.dispatchEvent(new Event('pointerlockerror')));
    return Promise.resolve();
  });
  Object.assign(canvas, { requestPointerLock });
  doc.exitPointerLock.mockImplementation(() => lockChange(null));
  const storage = new Map<string, string>();
  const win = Object.assign(new EventTarget(), {
    innerWidth: 1024, innerHeight: 768, matchMedia: () => ({ matches: false }),
    setTimeout: globalThis.setTimeout,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, value); },
      removeItem: (key: string) => { storage.delete(key); },
    },
  });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc);
  vi.stubGlobal('location', { search: '?playtest=1' });
  const { Input: RealInput } = await import('../src/input/input');
  const inputs: Input[] = [];
  const attach = RealInput.prototype.attach;
  vi.spyOn(RealInput.prototype, 'attach').mockImplementation(function (this: Input) {
    inputs.push(this);
    return attach.call(this);
  });
  await import('../src/main');
  const input = inputs[0];
  expect(input).toBeInstanceOf(RealInput);
  expect(captured.frames).toHaveLength(1);
  const click = (id: string, outcome?: LockOutcome) => {
    if (outcome) outcomes.push(outcome);
    inClick = true;
    try { node(id).click(); } finally { inClick = false; }
  };
  const key = (code: string, type = 'keydown') => win.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { code, repeat: false }));
  const mouse = (target: EventTarget, type: string, button = 0) => target.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), { button }));
  const frame = (dt = 1 / 60) => captured.frames[0]!(dt);
  const shown = (id: string) => !node(id).classes.has('hidden');
  const world = () => { expect(captured.world).not.toBeNull(); return captured.world!; };
  return { node, doc, win, canvas, input: input!, click, key, mouse, frame, shown, world, lockChange, requestPointerLock, lockDuringClick };
}
type Harness = Awaited<ReturnType<typeof setup>>;
const load = () => vi.advanceTimersByTimeAsync(35);
async function start(h: Harness, outcome: LockOutcome = 'async-success') {
  h.click('btn-playtest-start', outcome);
  await load();
  expect(h.shown('screen-loading')).toBe(false);
  expect(h.world().level.publicPlaytest).toBe('calibration');
}
function expectLocked(h: Harness) {
  expect(h.doc.pointerLockElement).toBe(h.canvas);
  expect(h.input.locked).toBe(true);
  expect(h.input.fallback).toBe(false);
  expect(h.shown('lock-banner')).toBe(false);
  expect(h.shown('screen-pause')).toBe(false);
}
function escape(h: Harness) {
  h.key('Escape'); h.frame(); h.key('Escape', 'keyup');
  expect(h.shown('screen-pause')).toBe(true);
  expect(h.doc.pointerLockElement).toBeNull();
}
function finish(h: Harness) {
  h.world().outcome = 'dead';
  for (let i = 0; i < 110; i++) h.frame(.02);
  expect(h.shown('screen-results')).toBe(true);
  expect(h.doc.pointerLockElement).toBeNull();
}

afterEach(() => {
  vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('pointer lock across real App restart/resume input events', () => {
  it.each(['reject', 'error', 'timeout'] as const)('recovers from %s during paused restart on the next Resume gesture', async failure => {
    const h = await setup();
    await start(h);
    expectLocked(h);
    // Esc can be consumed by the browser itself without reaching keydown.
    h.lockChange(null);
    expect(h.shown('screen-pause')).toBe(true);
    const previousWorld = h.world();
    h.click('btn-restart', failure);
    await vi.advanceTimersByTimeAsync(failure === 'timeout' ? 935 : 35);
    expect(h.world()).not.toBe(previousWorld);
    expect(h.input.fallback).toBe(true);
    expect(h.shown('lock-banner')).toBe(true);
    expect(h.shown('screen-loading')).toBe(false);
    escape(h);
    h.click('btn-resume', 'async-success');
    // The native request must run within the click, before any promise/timer.
    expect(h.requestPointerLock).toHaveBeenCalledTimes(3);
    expect(h.lockDuringClick).toEqual([true, true, true]);
    await load();
    expectLocked(h);
  });

  it.each(['async-success', 'sync-success'] as const)('keeps pointer lock through two results retries with %s events', async timing => {
    const h = await setup();
    await start(h);
    for (let retry = 0; retry < 2; retry++) {
      const previousWorld = h.world();
      finish(h);
      h.click('btn-retry', timing);
      await load();
      expect(h.world()).not.toBe(previousWorld);
      expect(h.shown('screen-results')).toBe(false);
      expectLocked(h);
    }
    expect(h.requestPointerLock).toHaveBeenCalledTimes(3);
    expect(h.lockDuringClick).toEqual([true, true, true]);
  });

  it('handles a synchronous first lock event after leaving the landing screen', async () => {
    const h = await setup();
    await start(h, 'sync-success');
    expectLocked(h);
    expect(h.doc.exitPointerLock).not.toHaveBeenCalled();
  });

  it('offers an explicit fallback relock gesture that does not attack', async () => {
    const h = await setup();
    await start(h, 'reject');
    expect(h.input.fallback).toBe(true);
    expect(h.shown('lock-banner')).toBe(true);
    h.mouse(h.node('btn-relock'), 'mousedown');
    h.click('btn-relock', 'async-success');
    h.mouse(h.win, 'mouseup');
    expect(h.requestPointerLock).toHaveBeenCalledTimes(2);
    expect(h.lockDuringClick).toEqual([true, true]);
    await load();
    expectLocked(h);
    expect(h.input.consume()).toMatchObject({ fire: false, firePressed: false });
    h.frame();
    expect(h.world().player.action).toBeNull();
    expect(h.shown('lock-fail')).toBe(false);
  });

  it('clears held movement, mouse buttons, and look deltas on blur before resuming', async () => {
    const h = await setup();
    await start(h);
    h.key('KeyW'); h.key('ShiftLeft');
    h.mouse(h.canvas, 'mousedown');
    h.doc.dispatchEvent(Object.assign(new Event('mousemove'), { movementX: 12, movementY: 5 }));
    expect(h.input.heldKeys()).toContain('KeyW');
    h.win.dispatchEvent(new Event('blur'));
    expect(h.shown('screen-pause')).toBe(true);
    expect(h.input.heldKeys()).toEqual([]);
    h.click('btn-resume', 'async-success');
    await load();
    expectLocked(h);
    expect(h.input.consume()).toMatchObject({ moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, fire: false, firePressed: false, sneak: false });
    const { x, z } = h.world().player;
    h.frame();
    expect(h.world().player.x).toBe(x);
    expect(h.world().player.z).toBe(z);
    expect(h.world().player.action).toBeNull();
  });

  it('pauses victory fall and Results countdown on real visibility events, retaining pointer lock on resume', async () => {
    const h = await setup(); await start(h);
    const w = h.world();
    // Isolate terminal presentation from the separately tested native doorway route.
    w.publicPlaytestCoreStart = Object.freeze({ realTime: w.realTime, damage: 0, kills: 0 });
    for (const e of w.enemies) e.alive = false;
    h.frame();
    for (let f = 0; f < 12; f++) h.frame();
    expectLocked(h);
    const corpseTime = w.enemies[0]!.deathT;
    h.doc.visibilityState = 'hidden'; h.doc.dispatchEvent(new Event('visibilitychange'));
    expect(h.shown('screen-pause')).toBe(true);
    expect(h.doc.pointerLockElement).toBeNull();
    for (let f = 0; f < 100; f++) h.frame(30);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(w.enemies[0]!.deathT).toBe(corpseTime);
    expect(h.shown('screen-results')).toBe(false);
    h.doc.visibilityState = 'visible'; h.doc.dispatchEvent(new Event('visibilitychange'));
    h.click('btn-resume'); await load();
    expectLocked(h);
    for (let f = 0; f < 90; f++) h.frame();
    expect(h.shown('screen-results')).toBe(false);
    for (let f = 0; f < 30; f++) h.frame();
    expect(h.shown('screen-results')).toBe(true);
    expect(h.doc.pointerLockElement).toBeNull();
  });

  it('rechecks browser ownership when the cached locked flag is stale at Resume', async () => {
    const h = await setup();
    await start(h);
    // The browser has released ownership but its change event has not arrived.
    h.doc.pointerLockElement = null;
    expect(h.input.locked).toBe(true);
    h.win.dispatchEvent(new Event('blur'));
    expect(h.shown('screen-pause')).toBe(true);
    h.click('btn-resume', 'async-success');
    expect(h.requestPointerLock).toHaveBeenCalledTimes(2);
    await load();
    expectLocked(h);
  });
});
