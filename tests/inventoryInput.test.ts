import { afterEach, describe, expect, it, vi } from 'vitest';
import { Input, type InputHandlers, type RawFrame } from '../src/input/input';
import { ENEMIES } from '../src/config';
import { emptyInput } from '../src/sim/types';
import { makeWorld, OPEN_ROOM } from './helpers';

type Mode = 'playing' | 'map' | 'choice' | 'inventory' | 'paused';

const idleFrame: RawFrame = {
  moveX: 0,
  moveZ: 0,
  lookDX: 0,
  lookDY: 0,
  keyYaw: 0,
  keyPitch: 0,
  fire: false,
  firePressed: false,
  selectSlot: null,
  shield: false,
  sneak: false,
  inventory: false,
  bottle: false,
  interact: false,
  potion: false,
  wait: false,
  map: false,
  escape: false,
  digit: null,
};

const inputs: Input[] = [];

function setup(mode: Mode = 'inventory', inventoryAware = true) {
  const state = { mode };
  const win = new EventTarget();
  const doc = new EventTarget();
  const canvas = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  const handlers: InputHandlers = {
    capturing: () => state.mode !== 'paused',
    onFocusLost: vi.fn(),
    onLockChange: vi.fn(),
    onLockError: vi.fn(),
  };
  if (inventoryAware) handlers.inventoryOpen = () => state.mode === 'inventory';
  const input = new Input(canvas as unknown as HTMLCanvasElement, handlers);
  input.attach();
  inputs.push(input);

  function emit(target: EventTarget, type: string, properties: Record<string, unknown> = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), properties);
    target.dispatchEvent(event);
    return event;
  }

  return {
    state,
    input,
    handlers,
    key: (type: 'keydown' | 'keyup', code: string, repeat = false) => emit(win, type, { code, repeat }),
    wheel: () => emit(win, 'wheel'),
    down: (button: number) => emit(canvas, 'mousedown', { button }),
    up: (button: number) => emit(win, 'mouseup', { button }),
    move: (movementX: number, movementY: number) => emit(doc, 'mousemove', { movementX, movementY }),
    blur: () => emit(win, 'blur'),
  };
}

afterEach(() => {
  for (const input of inputs.splice(0)) input.detach();
  vi.unstubAllGlobals();
});

describe('inventory uses native HTML input without queuing gameplay', () => {
  it('routes gameplay mouse-down and held input to the same explicit Boss Counter contract as touch', () => {
    for (const held of [false, true]) {
      const { input, down, up } = setup('playing');
      const w = makeWorld(OPEN_ROOM, [{ kind: 'warden', x: 9.5, z: 12.5, yaw: Math.PI }]);
      const e = w.enemies[0]!;
      Object.assign(e, { state: 'alert', seesPlayer: true, awareness: 1, phase: 'windup', locked: true,
        lockedYaw: Math.PI, phaseT: ENEMIES.warden.cleaveWindup - ENEMIES.warden.cleaveLockBefore });
      e.warden!.attack = 'cleave';
      down(0);
      if (held) input.consume();
      w.frame(1 / 60, { ...emptyInput(), ...input.consume() });
      up(0);
      for (let i = 0; i < 12; i++) w.frame(1 / 60, { ...emptyInput(), ...input.consume() });
      expect(w.stats.counters).toBe(held ? 0 : 1);
    }
  });
  it.each(['Tab', 'Space', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])(
    'leaves %s keydown, repeat, and keyup defaults intact',
    (code) => {
      const { input, key } = setup();
      expect(key('keydown', code).defaultPrevented).toBe(false);
      expect(key('keydown', code, true).defaultPrevented).toBe(false);
      expect(input.heldKeys()).toEqual([]);
      expect(input.consume()).toEqual(idleFrame);
      expect(key('keyup', code).defaultPrevented).toBe(false);
      expect(input.consume()).toEqual(idleFrame);
    },
  );

  it('does not queue any gameplay actions while the inventory is open', () => {
    const { input, state, key } = setup();
    const codes = [
      'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyH', 'KeyF', 'KeyM',
      'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Digit3', 'Space', 'Tab',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
    ];
    for (const code of codes) expect(key('keydown', code).defaultPrevented).toBe(false);
    expect(input.heldKeys()).toEqual([]);
    // Close before consuming: ignored menu inputs cannot become next-frame gameplay.
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
    for (const code of codes) key('keydown', code, true);
    expect(input.consume()).toEqual(idleFrame);
    for (const code of codes) key('keyup', code);
    key('keydown', 'KeyW');
    expect(input.consume()).toEqual({ ...idleFrame, moveZ: 1 });
  });

  it.each([
    ['KeyI', 'inventory'],
    ['Escape', 'escape'],
  ] as const)('routes only a fresh %s press to the close action', (code, field) => {
    const { input, key } = setup();
    expect(key('keydown', code).defaultPrevented).toBe(true);
    expect(input.heldKeys()).toEqual([]);
    expect(input.consume()).toEqual({ ...idleFrame, [field]: true });
    expect(key('keydown', code, true).defaultPrevented).toBe(true);
    expect(input.consume()).toEqual(idleFrame);
    expect(key('keyup', code).defaultPrevented).toBe(false);
    key('keydown', code);
    expect(input.consume()).toEqual({ ...idleFrame, [field]: true });
  });

  it('lets wheel scrolling through and ignores canvas fire, shield, and look input', () => {
    const { input, state, wheel, down, up, move } = setup();
    expect(wheel().defaultPrevented).toBe(false);
    expect(down(0).defaultPrevented).toBe(false);
    expect(down(2).defaultPrevented).toBe(false);
    move(12, 7);
    input.locked = true; // Pointer-lock release may arrive after the overlay opens.
    expect(down(2).defaultPrevented).toBe(false);
    move(10, -3);
    expect(input.consume()).toEqual(idleFrame);
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
    up(0);
    up(2);
    expect(input.consume()).toEqual(idleFrame);
  });

  it('clears input at UI transitions without resurrecting held or repeated keys', () => {
    const { input, state, key, down, move } = setup('playing');
    key('keydown', 'KeyW');
    key('keydown', 'Space');
    down(0);
    down(2);
    move(20, 10);
    input.clear(); // releaseForUi()
    state.mode = 'inventory';
    expect(input.consume()).toEqual(idleFrame);
    key('keydown', 'KeyW', true);
    key('keydown', 'Space', true);
    key('keydown', 'Escape');
    input.clear(); // enterPlaying()
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
    key('keydown', 'KeyW', true);
    key('keydown', 'Space', true);
    expect(input.consume()).toEqual(idleFrame);
    key('keyup', 'KeyW');
    key('keyup', 'Space');
    key('keydown', 'Space');
    expect(input.consume()).toEqual({ ...idleFrame, wait: true });
  });

  it('releases pre-existing held keys on inventory keyup without blocking the UI', () => {
    const { input, state, key } = setup('playing');
    key('keydown', 'KeyW');
    input.consume();
    state.mode = 'inventory';
    expect(key('keyup', 'KeyW').defaultPrevented).toBe(false);
    expect(input.heldKeys()).toEqual([]);
    expect(input.consume()).toEqual(idleFrame);
  });
});

describe('gameplay, map, and choice routing remain unchanged', () => {
  it.each(['playing', 'map', 'choice'] as const)('preserves keyboard capture and actions in %s', (mode) => {
    const { input, key, wheel } = setup(mode);
    for (const code of ['KeyW', 'KeyD', 'ArrowLeft', 'ArrowUp', 'ShiftLeft', 'Space', 'Tab', 'Digit2', 'KeyF', 'KeyQ', 'KeyE', 'KeyH', 'KeyI', 'Escape']) {
      expect(key('keydown', code).defaultPrevented).toBe(true);
    }
    expect(wheel().defaultPrevented).toBe(true);
    expect(input.consume()).toEqual({
      ...idleFrame,
      moveX: 1, moveZ: 1, keyYaw: 1, keyPitch: 1, sneak: true, wait: true,
      map: true, selectSlot: 2, digit: 2, shield: true, bottle: true,
      interact: true, potion: true, inventory: true, escape: true,
    });
    key('keydown', 'Digit2', true);
    key('keydown', 'KeyI', true);
    expect(input.consume()).toEqual({
      ...idleFrame, moveX: 1, moveZ: 1, keyYaw: 1, keyPitch: 1, sneak: true, wait: true,
    });
    for (const code of input.heldKeys()) {
      expect(key('keyup', code).defaultPrevented).toBe(code !== 'Escape');
    }
    expect(input.consume()).toEqual(idleFrame);
    expect(key('keydown', 'Enter').defaultPrevented).toBe(false);
  });

  it('retains short clicks, held fire, fallback dragging, locked shield, and spike filtering', () => {
    const { input, down, up, move } = setup('playing');
    expect(down(0).defaultPrevented).toBe(true);
    up(0);
    expect(input.consume()).toEqual({ ...idleFrame, fire: true, firePressed: true });
    expect(input.consume()).toEqual(idleFrame);
    down(0);
    input.consume();
    expect(input.consume()).toEqual({ ...idleFrame, fire: true });
    up(0);
    expect(down(2).defaultPrevented).toBe(true);
    move(8, -4);
    move(281, 0);
    expect(input.consume()).toEqual({ ...idleFrame, lookDX: 8, lookDY: -4 });
    up(2);
    move(3, 3);
    expect(input.consume()).toEqual(idleFrame);
    input.locked = true;
    down(2);
    move(-6, 2);
    expect(input.consume()).toEqual({ ...idleFrame, shield: true, lookDX: -6, lookDY: 2 });
    expect(input.consume()).toEqual(idleFrame);
  });

  it('leaves uncaptured overlays native without queuing keys or latent fire', () => {
    const { input, state, key, wheel, down } = setup('paused');
    for (const code of ['Space', 'Tab', 'KeyW', 'KeyI', 'Escape']) {
      expect(key('keydown', code).defaultPrevented).toBe(false);
      expect(key('keyup', code).defaultPrevented).toBe(false);
    }
    expect(wheel().defaultPrevented).toBe(false);
    expect(down(0).defaultPrevented).toBe(false);
    expect(down(2).defaultPrevented).toBe(false);
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
  });

  it('keeps the new inventory handler optional for existing consumers', () => {
    const { input, key, wheel } = setup('playing', false);
    expect(key('keydown', 'Space').defaultPrevented).toBe(true);
    expect(wheel().defaultPrevented).toBe(true);
    expect(input.consume()).toEqual({ ...idleFrame, wait: true });
  });

  it('clears all pending input on blur and removes routing when detached', () => {
    const { input, handlers, key, wheel, down, blur } = setup('playing');
    key('keydown', 'KeyW');
    down(0);
    blur();
    expect(handlers.onFocusLost).toHaveBeenCalledOnce();
    expect(input.consume()).toEqual(idleFrame);
    input.detach();
    expect(key('keydown', 'KeyW').defaultPrevented).toBe(false);
    expect(wheel().defaultPrevented).toBe(false);
    expect(down(0).defaultPrevented).toBe(false);
    expect(input.consume()).toEqual(idleFrame);
    expect(input.listenerCount).toBe(0);
  });
});

describe('touch mode and app pointer scope', () => {
  it('ignores compatibility mouse fire and look in touch mode but keeps real keyboard movement', async () => {
    const { input, handlers, down, move, key } = setup('playing');
    handlers.touchMode = () => true;
    input.locked = true;
    down(0);
    down(2);
    move(20, 10);
    key('keydown', 'KeyW');
    expect(input.consume()).toEqual({ ...idleFrame, moveZ: 1 });
    expect(await input.requestLock()).toBe(false);
    handlers.touchMode = () => false;
    down(0);
    move(20, 10);
    expect(input.consume()).toEqual({ ...idleFrame, moveZ: 1, fire: true, firePressed: true, lookDX: 20, lookDY: 10 });
  });

  it('never queues canvas attacks from map or choice when app supplies playing scope', () => {
    const { input, handlers, state, down, move, key } = setup('map');
    handlers.playing = () => state.mode === 'playing';
    input.locked = true;
    down(0); down(2); move(5, 5);
    expect(input.consume()).toEqual(idleFrame);
    key('keydown', 'Tab');
    expect(input.consume().map).toBe(true);
    state.mode = 'choice';
    down(0); key('keydown', 'Digit2');
    expect(input.consume()).toEqual({ ...idleFrame, selectSlot: 2, digit: 2 });
    state.mode = 'playing';
    expect(input.consume()).toEqual(idleFrame);
  });
});
