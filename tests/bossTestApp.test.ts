import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBossTestWorld } from '../src/dev/bossTest';
import { newRun, serializeRun } from '../src/sim/run';
import { emptyInput } from '../src/sim/types';
import type { App } from '../src/main';

const captured = vi.hoisted(() => ({ app: null as App | null }));
vi.mock('../src/dev/devapi', () => ({ installDevApi: (app: App) => { captured.app = app; } }));
vi.mock('../src/render/renderer', () => ({ GameRenderer: class {
  shared = { uSlow: { value: 0 } }; render = vi.fn(); onEvents = vi.fn();
  resize = vi.fn(); setOptions = vi.fn(); setWorld = vi.fn(); clearWorld = vi.fn();
} }));
vi.mock('../src/ui/hud', () => ({ Hud: class {
  update = vi.fn(); onEvents = vi.fn();
  setTouchMode = vi.fn(); show = vi.fn(); reset = vi.fn(); setLockBanner = vi.fn(); hint = vi.fn();
} }));
vi.mock('../src/audio/sfx', () => ({ Sfx: class {
  setSlow = vi.fn(); setListener = vi.fn(); onEvents = vi.fn();
  unlock = vi.fn(); ui = vi.fn(); setVolumes = vi.fn(); resume = vi.fn(); suspend = vi.fn();
} }));
vi.mock('../src/core/loop', () => ({ Loop: class { start = vi.fn(); resetClock = vi.fn(); } }));
vi.mock('../src/input/input', () => ({ Input: class {
  consume = () => ({ moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, keyYaw: 0, keyPitch: 0, fire: false, firePressed: false, selectSlot: null, shield: false, sneak: false, inventory: false, bottle: false, interact: false, potion: false, wait: false, map: false, escape: false, digit: null });
  attach = vi.fn(); clear = vi.fn(); exitLock = vi.fn(); requestLock = vi.fn(async () => true);
  locked = false; fallback = false;
} }));
vi.mock('../src/input/touch', () => ({ TouchInput: class { attach = vi.fn(); clear = vi.fn(); consume = () => ({ moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, keyYaw: 0, keyPitch: 0, fire: false, firePressed: false, selectSlot: null, shield: false, sneak: false, inventory: false, bottle: false, interact: false, potion: false, wait: false, map: false, escape: false, digit: null }); } }));

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
  style = { setProperty: vi.fn(), removeProperty: vi.fn() };
  value = ''; textContent = ''; innerHTML = ''; className = ''; disabled = false; checked = false;
  focus = vi.fn();
  querySelector = () => new ElementStub();
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  click() { this.dispatchEvent(new Event('click')); }
}
async function setup(search = '?dev=1&boss=1', touch = false) {
  vi.resetModules();
  vi.useFakeTimers();
  const nodes = new Map<string, ElementStub>();
  const node = (id: string) => {
    let value = nodes.get(id);
    if (!value) { value = new ElementStub(); nodes.set(id, value); }
    return value;
  };
  const doc = Object.assign(new EventTarget(), {
    body: new ElementStub(), documentElement: { requestFullscreen: vi.fn<() => Promise<void>>() },
    fullscreenElement: null as unknown, fullscreenEnabled: true,
    exitFullscreen: vi.fn<() => Promise<void>>(),
    getElementById: node,
    querySelectorAll: (selector: string) => selector === '[data-fullscreen]' ? [node('full-menu'), node('full-pause')]
      : selector === '[data-fullscreen-note]' ? [node('note-menu'), node('note-pause')] : [],
  });
  const change = (active: boolean) => {
    doc.fullscreenElement = active ? doc.documentElement : null;
    doc.dispatchEvent(new Event('fullscreenchange'));
  };
  doc.documentElement.requestFullscreen.mockImplementation(async () => { change(true); });
  doc.exitFullscreen.mockImplementation(async () => { change(false); });
  const visualViewport = Object.assign(new EventTarget(), { width: 844, height: 320, offsetTop: 0, offsetLeft: 0, scale: 1 });
  const saved = serializeRun(newRun('BOSS-SAVE-SENTINEL', 'huntress'));
  const storage = new Map([['superdungeon.run.v1', saved]]);
  const localStorage = {
    getItem: vi.fn((key: string) => storage.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { storage.set(key, value); }),
    removeItem: vi.fn((key: string) => { storage.delete(key); }),
  };
  const win = Object.assign(new EventTarget(), {
    innerWidth: 844, innerHeight: 390, visualViewport,
    matchMedia: () => ({ matches: touch }),
    localStorage,
    setTimeout: globalThis.setTimeout,
  });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('location', { search });
  const { App } = await import('../src/main');
  const app = search.includes('dev') ? captured.app! : new App();
  return { app, node, doc, win, change, storage, saved, localStorage };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });


const tickLoad = () => vi.advanceTimersByTimeAsync(35);
const hooks = (app: App) => app as unknown as {
  frame(dt: number): void; onLockChange(locked: boolean): void; showResults(): void; saveRun(run: null): void;
  startFloor(run: ReturnType<typeof newRun>, fromGesture: boolean): void;
};
function expectNoCampaignStorage(storage: Awaited<ReturnType<typeof setup>>['localStorage']) {
  for (const operation of [storage.getItem, storage.setItem, storage.removeItem])
    expect(operation.mock.calls.filter(call => call[0] === 'superdungeon.run.v1')).toEqual([]);
}

describe('developer Boss App boundaries (CPU DOM/input/render stubs, real world)', () => {
  it('cold deep link never reads/writes/deletes campaign data through the entire test session', async () => {
    const { app, node, localStorage, storage, saved } = await setup();
    expect(app.bossTestActive).toBe(true);
    expect(node('screen-boss-test').classes.has('hidden')).toBe(false);
    expectNoCampaignStorage(localStorage);
    for (const id of ['btn-continue', 'btn-start', 'btn-new']) node(id).click();
    hooks(app).startFloor(newRun('FORBIDDEN', 'warrior'), false);
    hooks(app).saveRun(null);
    expect(app.world).toBeNull(); expect(app.run).toBeNull();
    node('boss-test-preset').value = 'split'; node('boss-test-preset').dispatchEvent(new Event('change'));
    expect(node('boss-test-loadout').textContent).toContain('Lv5');
    for (const cls of ['warrior', 'huntress'] as const) {
      node('boss-test-class').value = cls; node('boss-test-class').dispatchEvent(new Event('change'));
      node('btn-boss-test-start').click(); await tickLoad();
      expect(app.world!.carry()).toEqual(createBossTestWorld(cls, 'split').carry());
      expect(app.practice).toBe(true); expect(app.run).toBeNull();
      expect(app.world!.level.floor).toBe(5); expect(app.world!.enemies[0]!.hp).toBe(80);
      app.pause('');
      expect(node('btn-restart').textContent).toContain('立即重打 Boss');
      expect(node('boss-test-pause-loadout').textContent).toContain('已知治療 ×2');
      node('btn-restart').click(); await tickLoad();
      for (const outcome of ['dead', 'win'] as const) {
        app.world!.outcome = outcome; hooks(app).showResults();
        expect(node('btn-new').classes.has('hidden')).toBe(true);
        node('btn-retry').click(); await tickLoad();
        expect(app.world!.outcome).toBe('none');
      }
      app.pause(''); node('btn-boss-test-options').click();
    }
    expectNoCampaignStorage(localStorage);
    expect(storage.get('superdungeon.run.v1')).toBe(saved);
    node('btn-boss-test-exit').click();
    expect(app.bossTestActive).toBe(false);
    expect(node('btn-continue').classes.has('hidden')).toBe(false);
    node('btn-continue').click(); await tickLoad();
    expect(app.world!.player.cls).toBe('huntress'); expect(app.world!.level.floor).toBe(1);
    expect(app.world!.level.practice).toBe(false);
    expect(app.world!.player.items).toEqual([]); expect(app.world!.player.known).not.toContain('potion:healing');
    expect(storage.get('superdungeon.run.v1')).toBe(saved);
  });

  it('requires dev entitlement; boss parameter alone has no effect on normal entry', async () => {
    const { app, node, localStorage } = await setup('?boss=1');
    expect(app.bossTestActive).toBe(false);
    expect(node('btn-boss-test').classes.has('hidden')).toBe(true);
    expect(node('btn-continue').classes.has('hidden')).toBe(false);
    node('btn-boss-test').click(); node('btn-boss-test-start').click();
    expect(app.world).toBeNull(); expect(app.bossTestActive).toBe(false);
    expect(localStorage.getItem.mock.calls.some(c => c[0] === 'superdungeon.run.v1')).toBe(true);
    node('btn-start').click(); await tickLoad();
    expect(app.world!.level.floor).toBe(1); expect(app.practice).toBe(false);
  });

  it.each([false, true])('retry and class swap rebuild all state, touch=%s', async touch => {
    const { app, node, localStorage } = await setup('?dev=1&boss=1', touch);
    node('btn-boss-test-start').click(); await tickLoad();
    const old = app.world!;
    old.player.hp = 1; old.player.hunger = 180; old.player.invisT = 3;
    old.player.items.push({ id: 'scroll:identify', count: 1, level: 0 });
    old.frame(1 / 60, { ...emptyInput(), fire: true, firePressed: true });
    old.enemies[0]!.hp = 2; old.enemies[0]!.paralyzeT = 5;
    old.enemies[0]!.warden!.braced = true;
    old.time = 99; old.stats.damageTaken.boss = 9; old.outcome = 'dead';
    app.devEvents.push({ t: 99, type: 'stale' });
    app.pause(''); node('btn-restart').click(); await tickLoad();
    expect(app.world).not.toBe(old);
    expect(app.world!.carry()).toEqual(createBossTestWorld('warrior', 'starting').carry());
    expect(app.world!.projectiles).toEqual([]); expect(app.world!.areas).toEqual([]);
    expect(app.world!.smokes).toEqual([]); expect(app.world!.player.action).toBeNull();
    expect(app.world!.time).toBe(0); expect(app.world!.stats.damageTaken).toEqual({});
    expect(app.world!.enemies[0]!.paralyzeT).toBe(0); expect(app.world!.enemies[0]!.warden!.braced).toBe(false);
    expect(app.devEvents).toEqual([]); expect(app.world!.encounterState).toBe('dormant');
    app.pause(''); node('btn-boss-test-swap').click(); await tickLoad();
    expect(app.world!.player.cls).toBe('huntress');
    expect(app.world!.carry()).toEqual(createBossTestWorld('huntress', 'starting').carry());
    expectNoCampaignStorage(localStorage);
    if (touch) expect(app.input.requestLock).not.toHaveBeenCalled();
  });

  it('double starts and exit/options before a build cannot resurrect obsolete worlds', async () => {
    const { app, node } = await setup();
    node('btn-boss-test-start').click(); node('btn-boss-test-start').click(); await tickLoad();
    expect(app.renderer.setWorld).toHaveBeenCalledTimes(1);
    app.pause(''); node('btn-restart').click(); node('btn-boss-test-options').click(); await tickLoad();
    expect(app.world).toBeNull(); expect(app.mode).toBe('menu');
    expect(node('screen-boss-test').classes.has('hidden')).toBe(false);
    node('btn-boss-test-start').click(); node('btn-boss-test-exit').click(); await tickLoad();
    expect(app.world).toBeNull(); expect(app.mode).toBe('menu'); expect(app.bossTestActive).toBe(false);
  });

  it('late pointer-lock completion cannot resume after exit or displace a newer retry', async () => {
    const { app, node } = await setup();
    let resolve!: (ok: boolean) => void;
    vi.mocked(app.input.requestLock).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    node('btn-boss-test-start').click(); await tickLoad();
    expect(app.mode).toBe('loading');
    node('btn-boss-test-exit').click();
    vi.mocked(app.input.exitLock).mockClear();
    hooks(app).onLockChange(true);
    expect(app.input.exitLock).toHaveBeenCalledTimes(1);
    resolve(true); await Promise.resolve();
    expect(app.world).toBeNull(); expect(app.mode).toBe('menu');
    node('btn-boss-test').click();
    vi.mocked(app.input.requestLock).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    node('btn-boss-test-start').click(); await tickLoad();
    const old = app.world;
    node('btn-boss-test-swap').click(); resolve(true); await Promise.resolve();
    expect(app.mode).toBe('loading'); await tickLoad();
    expect(app.world).not.toBe(old); expect(app.world!.player.cls).toBe('huntress'); expect(app.mode).toBe('playing');
  });

  it('Boss deaths keep results while ordinary practice still auto-restarts', async () => {
    const { app, node, localStorage } = await setup();
    node('btn-boss-test-start').click(); await tickLoad();
    app.world!.outcome = 'dead';
    for (let i = 0; i < 100; i++) hooks(app).frame(.02);
    expect(app.mode).toBe('results'); expect(node('res-title').textContent).toBe('你倒下了');
    expectNoCampaignStorage(localStorage);
    node('btn-menu').click(); node('btn-practice').click(); await tickLoad();
    app.world!.outcome = 'dead';
    for (let i = 0; i < 100; i++) hooks(app).frame(.02);
    expect(app.mode).toBe('loading'); await tickLoad();
    expect(app.mode).toBe('playing'); expect(app.world!.outcome).toBe('none'); expect(app.bossTestActive).toBe(false);
  });
});
