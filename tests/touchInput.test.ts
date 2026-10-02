import { afterEach, describe, expect, it, vi } from 'vitest';
import { TouchInput } from '../src/input/touch';
import type { RawFrame } from '../src/input/input';
import { ENEMIES } from '../src/config';
import { emptyInput } from '../src/sim/types';
import { makeWorld, OPEN_ROOM } from './helpers';

const idle: RawFrame = {
  moveX: 0, moveZ: 0, lookDX: 0, lookDY: 0, keyYaw: 0, keyPitch: 0,
  fire: false, firePressed: false, selectSlot: null, shield: false, sneak: false,
  inventory: false, bottle: false, interact: false, potion: false, wait: false,
  map: false, escape: false, digit: null,
};
const inputs: TouchInput[] = [];

class ElementStub extends EventTarget {
  attributes = new Map<string, string>();
  captures = new Set<number>();
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  box = { left: 20, top: 30, width: 100, height: 100 };
  style = { setProperty: vi.fn() };
  constructor(role?: string) {
    super();
    if (role) this.attributes.set('data-touch', role);
  }
  closest(): ElementStub | null { return this.attributes.has('data-touch') ? this : this.parent?.closest() ?? null; }
  contains(element: ElementStub): boolean { return element === this || this.children.some((child) => child.contains(element)); }
  querySelectorAll(): ElementStub[] { return this.children.flatMap((child) => [child, ...child.querySelectorAll()]); }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  getBoundingClientRect() { return this.box; }
  setPointerCapture(id: number): void { this.captures.add(id); }
  hasPointerCapture(id: number): boolean { return this.captures.has(id); }
  releasePointerCapture(id: number): void { this.captures.delete(id); }
  append(child: ElementStub): void { this.children.push(child); child.parent = this; }
}

function setup() {
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', doc);
  const root = new ElementStub();
  const controls = new Map<string, ElementStub>();
  for (const role of ['move', 'look', 'fire', 'shield', 'interact', 'inventory', 'map', 'escape', 'wait', 'sneak', 'bottle', 'slot1', 'slot2', 'slot3', 'unknown']) {
    const element = new ElementStub(role);
    root.append(element);
    controls.set(role, element);
  }
  const native = new ElementStub();
  root.append(native);
  const state = { active: true };
  const onChange = vi.fn();
  const input = new TouchInput(root as unknown as HTMLElement, { active: () => state.active, onChange });
  input.attach();
  inputs.push(input);
  function emit(destination: EventTarget, type: string, target: EventTarget, properties: Record<string, unknown> = {}) {
    const event = Object.assign(new Event(type, { cancelable: true }), properties);
    Object.defineProperty(event, 'target', { value: target });
    destination.dispatchEvent(event);
    return event;
  }
  function pointer(type: string, role: string, id: number, x = 70, y = 80, pointerType = 'touch') {
    return emit(type === 'pointerdown' || type === 'lostpointercapture' ? root : win, type, controls.get(role) ?? native,
      { pointerId: id, clientX: x, clientY: y, pointerType, button: 0 });
  }
  return { root, controls, native, state, input, onChange, pointer, emit, win, doc };
}

afterEach(() => {
  for (const input of inputs.splice(0)) input.detach();
  vi.unstubAllGlobals();
});

describe('touch joystick and pointer ownership', () => {
  it('uses a fixed center, radial deadzone and a clamped, normalized diagonal', () => {
    const { input, pointer, controls } = setup();
    pointer('pointerdown', 'move', 1, 75, 85);
    expect(input.consume()).toEqual(idle);
    pointer('pointermove', 'move', 1, 99.5, 80); // 59% radius -> 50% after the deadzone.
    expect(input.consume().moveX).toBeCloseTo(0.5);
    pointer('pointermove', 'move', 1, 170, -20);
    const frame = input.consume();
    expect(frame.moveX).toBeCloseTo(Math.SQRT1_2);
    expect(frame.moveZ).toBeCloseTo(Math.SQRT1_2);
    expect(Math.hypot(frame.moveX, frame.moveZ)).toBeCloseTo(1);
    const visual = controls.get('move')!.style.setProperty.mock.lastCall!;
    expect(visual[0]).toBe('--stick-y');
    expect(parseFloat(visual[1] as string)).toBeCloseTo(-50 * Math.SQRT1_2);
    pointer('pointerup', 'move', 1);
    expect(input.consume()).toEqual(idle);
    expect(controls.get('move')!.style.setProperty).toHaveBeenLastCalledWith('--stick-y', '0px');
  });

  it('keeps movement and fire-drag aiming independent with two thumbs', () => {
    const { input, pointer, controls } = setup();
    pointer('pointerdown', 'move', 1, 70, 30);
    pointer('pointerdown', 'fire', 2, 250, 100);
    pointer('pointermove', 'fire', 2, 266, 95);
    expect(input.consume()).toEqual({ ...idle, moveZ: 1, fire: true, firePressed: true, lookDX: 16, lookDY: -5 });
    expect(controls.get('move')!.captures.has(1)).toBe(true);
    expect(controls.get('fire')!.captures.has(2)).toBe(true);
    expect(controls.get('fire')!.getAttribute('aria-pressed')).toBe('true');
    expect(input.consume()).toEqual({ ...idle, moveZ: 1, fire: true });
    pointer('pointerup', 'fire', 2);
    expect(input.consume()).toEqual({ ...idle, moveZ: 1 });
  });

  it('allows just one movement owner and one aim owner without transferring on release', () => {
    const { input, pointer } = setup();
    pointer('pointerdown', 'move', 1, 70, 30);
    pointer('pointerdown', 'move', 2, 120, 80);
    pointer('pointermove', 'move', 2, 20, 80);
    pointer('pointerdown', 'look', 3);
    pointer('pointerdown', 'look', 4);
    pointer('pointerdown', 'fire', 5);
    pointer('pointermove', 'look', 4, 100, 100);
    pointer('pointermove', 'fire', 5, 200, 200);
    pointer('pointermove', 'look', 3, 80, 85);
    expect(input.consume()).toEqual({ ...idle, moveZ: 1, fire: true, firePressed: true, lookDX: 10, lookDY: 5 });
    pointer('pointerup', 'move', 1);
    pointer('pointerup', 'look', 3);
    pointer('pointermove', 'move', 2, 120, 80);
    pointer('pointermove', 'fire', 5, 300, 300);
    expect(input.consume()).toEqual({ ...idle, fire: true });
  });

  it('does not let a second look contact steal a fire contact’s aim', () => {
    const { input, pointer } = setup();
    pointer('pointerdown', 'fire', 1);
    pointer('pointerdown', 'look', 2);
    pointer('pointermove', 'look', 2, 300, 300);
    pointer('pointermove', 'fire', 1, 60, 90);
    expect(input.consume()).toEqual({ ...idle, fire: true, firePressed: true, lookDX: -10, lookDY: 10 });
  });
});

describe('touch action semantics', () => {
  it('routes a new Boss Counter tap distinctly from an already-held attack contact', () => {
    for (const held of [false, true]) {
      const { input, pointer } = setup();
      const w = makeWorld(OPEN_ROOM, [{ kind: 'warden', x: 9.5, z: 12.5, yaw: Math.PI }]);
      const e = w.enemies[0]!;
      Object.assign(e, { state: 'alert', seesPlayer: true, awareness: 1, phase: 'windup', locked: true,
        lockedYaw: Math.PI, phaseT: ENEMIES.warden.cleaveWindup - ENEMIES.warden.cleaveLockBefore });
      e.warden!.attack = 'cleave';
      pointer('pointerdown', 'fire', 1);
      if (held) input.consume(); // The earlier contact edge has already been consumed.
      w.frame(1 / 60, { ...emptyInput(), ...input.consume() });
      pointer('pointerup', 'fire', 1);
      for (let i = 0; i < 12; i++) w.frame(1 / 60, { ...emptyInput(), ...input.consume() });
      expect(w.stats.counters).toBe(held ? 0 : 1);
    }
  });
  it('commits fire at press, repeats while held, and retains a short tap for one frame', () => {
    const { input, pointer } = setup();
    pointer('pointerdown', 'fire', 1);
    expect(input.consume()).toEqual({ ...idle, fire: true, firePressed: true });
    pointer('pointerdown', 'fire', 1); // A duplicate event cannot repeat the press edge.
    expect(input.consume()).toEqual({ ...idle, fire: true });
    pointer('pointerup', 'fire', 1);
    expect(input.consume()).toEqual(idle);
    pointer('pointerdown', 'fire', 1);
    pointer('pointerup', 'fire', 1);
    pointer('lostpointercapture', 'fire', 1); // The ordinary implicit release must not erase a tap.
    expect(input.consume()).toEqual({ ...idle, fire: true, firePressed: true });
    expect(input.consume()).toEqual(idle);
  });

  it.each(['shield', 'interact', 'inventory', 'map', 'escape', 'bottle'] as const)('%s is an edge, never repeated while held', (role) => {
    const { input, pointer, controls } = setup();
    pointer('pointerdown', role, 1);
    expect(input.consume()).toEqual({ ...idle, [role]: true });
    pointer('pointerdown', role, 1);
    expect(input.consume()).toEqual(idle);
    expect(controls.get(role)!.getAttribute('aria-pressed')).toBe('true');
    pointer('pointerup', role, 1);
    pointer('pointerdown', role, 1);
    pointer('pointerup', role, 1);
    expect(input.consume()).toEqual({ ...idle, [role]: true });
    expect(controls.get(role)!.getAttribute('aria-pressed')).toBe('false');
  });

  it.each([1, 2, 3])('maps slot %i to both existing slot fields', (slot) => {
    const { input, pointer } = setup();
    pointer('pointerdown', `slot${slot}`, 1);
    expect(input.consume()).toEqual({ ...idle, selectSlot: slot, digit: slot });
    expect(input.consume()).toEqual(idle);
  });

  it('preserves the app-owned selected-slot accessibility state', () => {
    const { input, pointer, controls } = setup();
    controls.get('slot1')!.setAttribute('aria-pressed', 'true');
    controls.get('slot2')!.setAttribute('aria-pressed', 'false');
    pointer('pointerdown', 'slot2', 1);
    expect(input.consume().selectSlot).toBe(2);
    pointer('pointerup', 'slot2', 1);
    pointer('pointerdown', 'fire', 2);
    input.clear();
    expect(controls.get('slot1')!.getAttribute('aria-pressed')).toBe('true');
    expect(controls.get('slot2')!.getAttribute('aria-pressed')).toBe('false');
  });

  it('holds wait and toggles sneak exactly once per fresh press', () => {
    const { input, pointer, controls } = setup();
    pointer('pointerdown', 'wait', 1);
    pointer('pointerdown', 'sneak', 2);
    expect(input.sneaking).toBe(true);
    expect(controls.get('sneak')!.getAttribute('aria-pressed')).toBe('true');
    expect(input.consume()).toEqual({ ...idle, wait: true, sneak: true });
    pointer('pointerdown', 'sneak', 2);
    expect(input.consume()).toEqual({ ...idle, wait: true, sneak: true });
    pointer('pointerup', 'wait', 1);
    pointer('pointerup', 'sneak', 2);
    expect(input.consume()).toEqual({ ...idle, sneak: true });
    pointer('pointerdown', 'sneak', 2);
    pointer('pointerup', 'sneak', 2);
    expect(input.sneaking).toBe(false);
    expect(input.consume()).toEqual(idle);
  });
});

describe('touch cancellation and lifecycle', () => {
  it.each(['pointercancel', 'lostpointercapture'])('%s discards pending actions and look while preserving other fingers', (cancel) => {
    const { input, pointer, controls } = setup();
    pointer('pointerdown', 'move', 1, 70, 30);
    pointer('pointerdown', 'fire', 2);
    pointer('pointermove', 'fire', 2, 100, 90);
    pointer(cancel, 'fire', 2);
    expect(controls.get('fire')!.captures.size).toBe(0);
    expect(input.consume()).toEqual({ ...idle, moveZ: 1 });
    pointer(cancel, 'move', 1);
    expect(input.consume()).toEqual(idle);
    pointer('pointermove', 'move', 1, 70, 30);
    expect(input.consume()).toEqual(idle);
  });

  it.each(['shield', 'interact', 'inventory', 'map', 'escape', 'bottle', 'slot1', 'slot2', 'slot3', 'sneak', 'wait'])('cancellation removes the unconsumed %s press', (role) => {
    const { input, pointer } = setup();
    pointer('pointerdown', role, 1);
    pointer('pointercancel', role, 1);
    expect(input.sneaking).toBe(false);
    expect(input.consume()).toEqual(idle);
  });

  it('cancels only the affected pending edge, even when another finger uses the same role', () => {
    const { input, pointer } = setup();
    pointer('pointerdown', 'interact', 1);
    pointer('pointerdown', 'interact', 2);
    pointer('pointercancel', 'interact', 2);
    expect(input.consume()).toEqual({ ...idle, interact: true });
  });

  it.each(['clear', 'blur', 'pagehide', 'resize', 'hidden', 'inactive', 'detach', 'reattach'])('%s clears owners, captures, movement, deltas and toggles', (transition) => {
    const { input, pointer, controls, win, doc, state } = setup();
    pointer('pointerdown', 'move', 1, 70, 30);
    pointer('pointerdown', 'fire', 2);
    pointer('pointermove', 'fire', 2, 100, 90);
    pointer('pointerdown', 'sneak', 3);
    if (transition === 'clear') input.clear();
    else if (transition === 'detach') input.detach();
    else if (transition === 'reattach') input.attach();
    else if (transition === 'inactive') state.active = false;
    else if (transition === 'hidden') {
      doc.visibilityState = 'hidden';
      doc.dispatchEvent(new Event('visibilitychange'));
    } else win.dispatchEvent(new Event(transition));
    expect(input.consume()).toEqual(idle);
    expect(input.sneaking).toBe(false);
    expect(controls.get('fire')!.captures.size).toBe(0);
    expect(controls.get('move')!.captures.size).toBe(0);
    expect(controls.get('sneak')!.getAttribute('aria-pressed')).toBe('false');
    state.active = true;
    pointer('pointermove', 'move', 1, 70, 30);
    pointer('pointermove', 'fire', 2, 200, 100);
    pointer('pointerup', 'fire', 2);
    expect(input.consume()).toEqual(idle);
  });

  it('does not repeatedly query or refresh the DOM while inactive and already clear', () => {
    const { input, state, root, onChange } = setup();
    const query = vi.spyOn(root, 'querySelectorAll');
    state.active = false;
    for (let frame = 0; frame < 60; frame++) expect(input.consume()).toEqual(idle);
    input.clear();
    expect(query).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not multiply listeners when reattached or accept input after detaching', () => {
    const { input, pointer, onChange } = setup();
    input.attach();
    input.attach();
    onChange.mockClear();
    pointer('pointerdown', 'sneak', 1);
    expect(onChange).toHaveBeenCalledOnce();
    expect(input.consume().sneak).toBe(true);
    input.detach();
    onChange.mockClear();
    expect(pointer('pointerdown', 'fire', 2).defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(input.consume()).toEqual(idle);
  });
});

describe('touch event boundaries', () => {
  it('accepts pen contacts and ignores mouse, unknown roles and foreign pointers', () => {
    const { input, pointer } = setup();
    expect(pointer('pointerdown', 'fire', 1, 70, 80, 'mouse').defaultPrevented).toBe(false);
    expect(pointer('pointerdown', 'unknown', 2).defaultPrevented).toBe(false);
    expect(pointer('pointermove', 'move', 999, 0, 0).defaultPrevented).toBe(false);
    expect(input.consume()).toEqual(idle);
    expect(pointer('pointerdown', 'fire', 3, 70, 80, 'pen').defaultPrevented).toBe(true);
    pointer('pointermove', 'fire', 3, 80, 83, 'pen');
    expect(input.consume()).toEqual({ ...idle, fire: true, firePressed: true, lookDX: 10, lookDY: 3 });
    pointer('pointermove', 'fire', 3, 200, 200, 'mouse');
    pointer('pointerup', 'fire', 3, 200, 200, 'mouse');
    expect(input.consume()).toEqual({ ...idle, fire: true });
  });

  it('ignores inactive presses and preserves native controls even inside the overlay root', () => {
    const { input, pointer, state, emit, root, native, controls } = setup();
    state.active = false;
    expect(pointer('pointerdown', 'fire', 1).defaultPrevented).toBe(false);
    expect(emit(root, 'pointerdown', native, { pointerId: 2, pointerType: 'touch' }).defaultPrevented).toBe(false);
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
      expect(emit(root, type, native).defaultPrevented).toBe(false);
      expect(emit(root, type, controls.get('unknown')!).defaultPrevented).toBe(false);
      expect(emit(root, type, controls.get('fire')!).defaultPrevented).toBe(true);
    }
    state.active = true;
    expect(input.consume()).toEqual(idle);
  });

  it('resolves nested control labels while rejecting controls outside the root', () => {
    const { input, emit, root, controls } = setup();
    const label = new ElementStub();
    controls.get('fire')!.append(label);
    emit(root, 'pointerdown', label, { pointerId: 1, pointerType: 'touch', clientX: 70, clientY: 80 });
    expect(input.consume()).toEqual({ ...idle, fire: true, firePressed: true });
    input.clear();
    const foreign = new ElementStub('fire');
    expect(emit(root, 'pointerdown', foreign, { pointerId: 2, pointerType: 'touch' }).defaultPrevented).toBe(false);
    expect(input.consume()).toEqual(idle);
  });

  it('still releases controls when pointer capture is unavailable', () => {
    const { input, pointer, controls } = setup();
    controls.get('fire')!.setPointerCapture = () => { throw new Error('No capture'); };
    pointer('pointerdown', 'fire', 1);
    expect(input.consume().fire).toBe(true);
    pointer('pointerup', 'native', 1);
    expect(input.consume()).toEqual(idle);
  });
});


describe('keyboard and assistive-technology button activation', () => {
  it.each(['shield', 'interact', 'inventory', 'map', 'escape', 'bottle', 'wait'] as const)('activates %s for one frame without creating a held pointer', (role) => {
    const { input, emit, root, controls } = setup();
    const element = controls.get(role)!;
    expect(emit(root, 'click', element, { detail: 0 }).defaultPrevented).toBe(true);
    expect(input.consume()).toEqual({ ...idle, [role]: true });
    expect(input.consume()).toEqual(idle);
    expect(element.captures.size).toBe(0);
    expect(element.getAttribute('aria-pressed')).toBe('false');
  });

  it('fires once for a non-pointer activation and never starts repeating fire', () => {
    const { input, emit, root, controls } = setup();
    emit(root, 'click', controls.get('fire')!, { detail: 0, pointerType: '' });
    expect(input.consume()).toEqual({ ...idle, fire: true, firePressed: true });
    expect(input.consume()).toEqual(idle);
    expect(controls.get('fire')!.captures.size).toBe(0);
  });

  it.each([1, 2, 3])('activates slot %i with the same one-shot semantics', (slot) => {
    const { input, emit, root, controls } = setup();
    emit(root, 'click', controls.get(`slot${slot}`)!, { detail: 0 });
    expect(input.consume()).toEqual({ ...idle, digit: slot, selectSlot: slot });
    expect(input.consume()).toEqual(idle);
  });

  it('toggles sneak once per activation and clears pending activation at UI transitions', () => {
    const { input, emit, root, controls } = setup();
    emit(root, 'click', controls.get('sneak')!, { detail: 0 });
    expect(input.sneaking).toBe(true);
    expect(input.consume()).toEqual({ ...idle, sneak: true });
    expect(input.consume()).toEqual({ ...idle, sneak: true });
    emit(root, 'click', controls.get('sneak')!, { detail: 0 });
    expect(input.consume()).toEqual(idle);
    emit(root, 'click', controls.get('fire')!, { detail: 0 });
    input.clear();
    expect(input.consume()).toEqual(idle);
  });

  it('does not duplicate the action for a normal touch compatibility click', () => {
    const { input, emit, root, controls, pointer } = setup();
    pointer('pointerdown', 'fire', 1);
    pointer('pointerup', 'fire', 1);
    expect(input.consume()).toEqual({ ...idle, fire: true, firePressed: true });
    emit(root, 'click', controls.get('fire')!, { detail: 1, pointerType: 'touch' });
    expect(input.consume()).toEqual(idle);
    emit(root, 'click', controls.get('fire')!, { detail: 1 });
    expect(input.consume()).toEqual(idle);
  });

  it.each(['mouse', 'touch', 'pen'])('rejects pointer-origin %s clicks even with detail zero', (pointerType) => {
    const { input, emit, root, controls } = setup();
    emit(root, 'click', controls.get('fire')!, { detail: 0, pointerType });
    expect(input.consume()).toEqual(idle);
  });

  it('ignores inactive, move and look activation without affecting native UI controls', () => {
    const { input, emit, root, controls, state, native } = setup();
    for (const role of ['move', 'look']) emit(root, 'click', controls.get(role)!, { detail: 0 });
    expect(input.consume()).toEqual(idle);
    state.active = false;
    for (const role of ['fire', 'wait', 'sneak', 'inventory']) emit(root, 'click', controls.get(role)!, { detail: 0 });
    expect(emit(root, 'click', native, { detail: 0 }).defaultPrevented).toBe(false);
    state.active = true;
    expect(input.consume()).toEqual(idle);
  });
});
