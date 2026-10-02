import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App } from '../src/main';

const captured = vi.hoisted(() => ({ app: null as App | null }));
vi.mock('../src/dev/devapi', () => ({ installDevApi: (app: App) => { captured.app = app; } }));
vi.mock('../src/render/renderer', () => ({ GameRenderer: class {
  resize = vi.fn(); setOptions = vi.fn(); setWorld = vi.fn(); clearWorld = vi.fn();
} }));
vi.mock('../src/ui/hud', () => ({ Hud: class {
  setTouchMode = vi.fn(); show = vi.fn(); reset = vi.fn(); setLockBanner = vi.fn(); hint = vi.fn();
} }));
vi.mock('../src/audio/sfx', () => ({ Sfx: class {
  unlock = vi.fn(); ui = vi.fn(); setVolumes = vi.fn(); resume = vi.fn(); suspend = vi.fn();
} }));
vi.mock('../src/core/loop', () => ({ Loop: class { start = vi.fn(); resetClock = vi.fn(); } }));
vi.mock('../src/input/input', () => ({ Input: class {
  attach = vi.fn(); clear = vi.fn(); exitLock = vi.fn(); requestLock = vi.fn(async () => true);
  locked = false; fallback = false;
} }));
vi.mock('../src/input/touch', () => ({ TouchInput: class { attach = vi.fn(); clear = vi.fn(); } }));

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
async function setup(touch = true, supported = true) {
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
    fullscreenElement: null as unknown, fullscreenEnabled: supported,
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
  const win = Object.assign(new EventTarget(), {
    innerWidth: 844, innerHeight: 390, visualViewport,
    matchMedia: () => ({ matches: touch }),
    localStorage: { getItem: () => null, setItem: vi.fn() },
    setTimeout: globalThis.setTimeout,
  });
  vi.stubGlobal('window', win); vi.stubGlobal('document', doc); vi.stubGlobal('location', { search: '?dev=1' });
  await import('../src/main');
  return { app: captured.app!, node, doc, win, change };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('App fullscreen integration (render/audio/input stubs, real world generation)', () => {
  it('touch start retains the direct click gesture, enters game and never requests pointer lock', async () => {
    const { app, doc, node } = await setup();
    node('btn-practice').click();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1); // before timers or await
    expect(app.mode).toBe('loading');
    expect(app.input.requestLock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(35);
    expect(app.mode).toBe('playing');
  });
  it('intro tap enters fullscreen; starting afterward does not request it twice', async () => {
    const { app, doc, node } = await setup();
    node('btn-mobile-continue').click();
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    node('btn-practice').click();
    await vi.advanceTimersByTimeAsync(35);
    expect(app.mode).toBe('playing');
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
  });
  it.each(['unsupported', 'rejected'] as const)('does not block gameplay when %s', async kind => {
    const { app, doc, node } = await setup(true, kind !== 'unsupported');
    if (kind === 'rejected') doc.documentElement.requestFullscreen.mockRejectedValue(new Error('browser blocked'));
    node('btn-practice').click();
    await vi.advanceTimersByTimeAsync(35);
    expect(app.mode).toBe('playing');
    expect(app.input.requestLock).not.toHaveBeenCalled();
    expect(node('full-pause').textContent).toContain('全螢幕');
  });
  it('clears both input adapters and pauses on browser exit, resume does not trap the player in fullscreen', async () => {
    const { app, doc, node, change } = await setup();
    node('btn-practice').click(); await vi.advanceTimersByTimeAsync(35);
    vi.mocked(app.input.clear).mockClear(); vi.mocked(app.touch.clear).mockClear();
    change(false);
    expect(app.mode).toBe('paused');
    expect(app.input.clear).toHaveBeenCalled(); expect(app.touch.clear).toHaveBeenCalled();
    node('btn-resume').click();
    expect(app.mode).toBe('playing');
    expect(doc.documentElement.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(node('full-pause').textContent).toBe('全螢幕');
  });
  it('remembers fullscreen exit during loading until the new world can pause', async () => {
    const { app, node, change } = await setup();
    node('btn-practice').click();
    expect(app.mode).toBe('loading');
    change(false);
    await vi.advanceTimersByTimeAsync(35);
    expect(app.mode).toBe('paused');
    node('btn-resume').click(); expect(app.mode).toBe('playing');
  });
  it.each(['inventory', 'choice', 'map'] as const)('keeps %s frozen on exit', async mode => {
    const { app, node, change } = await setup();
    node('btn-practice').click(); await vi.advanceTimersByTimeAsync(35);
    app.mode = mode;
    change(false);
    expect(app.mode).toBe(mode === 'map' ? 'paused' : mode);
  });
  it('does not fullscreen desktop or automatic new worlds', async () => {
    let fixture = await setup(false);
    fixture.node('btn-practice').click();
    expect(fixture.doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(fixture.app.input.requestLock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(35);
    fixture = await setup(true);
    fixture.app.startRun('PRACTICE', true, false);
    await vi.advanceTimersByTimeAsync(35);
    expect(fixture.doc.documentElement.requestFullscreen).not.toHaveBeenCalled();
    expect(fixture.app.mode).toBe('playing');
  });
  it('resizes rendering and all overlay variables on visual changes; portrait pauses and can resume after rotation', async () => {
    const { app, node, doc, win } = await setup();
    expect(app.renderer.resize).toHaveBeenLastCalledWith(844, 320);
    node('btn-practice').click(); await vi.advanceTimersByTimeAsync(35);
    win.visualViewport.height = 280;
    win.visualViewport.offsetTop = 10;
    win.visualViewport.dispatchEvent(new Event('resize'));
    expect(app.renderer.resize).toHaveBeenLastCalledWith(844, 280);
    expect(doc.body.style.setProperty).toHaveBeenCalledWith('--view-top', '10px');
    Object.assign(win, { innerWidth: 390, innerHeight: 844 });
    Object.assign(win.visualViewport, { width: 390, height: 844, offsetTop: 0 });
    win.dispatchEvent(new Event('resize'));
    expect(app.mode).toBe('paused'); expect(node('touch-rotate').classes.has('hidden')).toBe(false);
    Object.assign(win, { innerWidth: 844, innerHeight: 390 });
    Object.assign(win.visualViewport, { width: 844, height: 390 });
    win.dispatchEvent(new Event('resize'));
    expect(node('touch-rotate').classes.has('hidden')).toBe(true);
    node('btn-resume').click(); expect(app.mode).toBe('playing');
  });
  it('still pauses fullscreen exit after switching back to keyboard fallback', async () => {
    const { app, node, change } = await setup();
    node('btn-practice').click(); await vi.advanceTimersByTimeAsync(35);
    app.touchMode = false; app.input.fallback = true;
    change(false);
    expect(app.mode).toBe('paused');
  });
});
