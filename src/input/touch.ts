import type { RawFrame } from './input';

const ROLES = [
  'move', 'look', 'fire', 'shield', 'interact', 'inventory', 'map', 'escape',
  'wait', 'sneak', 'bottle', 'slot1', 'slot2', 'slot3',
] as const;
type Role = (typeof ROLES)[number];
const DEADZONE = 0.18;

export interface TouchInputHandlers {
  /** Only gameplay controls are active; native menu controls remain untouched. */
  active(): boolean;
  onChange?(): void;
}

interface PointerOwner {
  id: number;
  role: Role;
  element: HTMLElement;
  aiming: boolean;
  x: number;
  y: number;
  centerX: number;
  centerY: number;
  radius: number;
  dx: number;
  dy: number;
}

/** Touch/pen adapter for the existing simulation input, independent of mouse input. */
export class TouchInput {
  private pointers = new Map<number, PointerOwner>();
  // Keep released presses until consume() so a short tap survives a slow frame.
  private edges = new Map<PointerOwner | MouseEvent, Role>();
  private look = new Set<PointerOwner>();
  private removeListeners: Array<() => void> = [];
  private moveX = 0;
  private moveZ = 0;
  private sneak = false;

  constructor(private root: HTMLElement, private h: TouchInputHandlers) {}

  /** Pending toggles are visible immediately, but can still be cancelled before consumption. */
  get sneaking(): boolean {
    let result = this.sneak;
    for (const role of this.edges.values()) if (role === 'sneak') result = !result;
    return result;
  }

  attach(): void {
    this.detach();
    const on = (target: EventTarget, type: string, listener: (event: Event) => void) => {
      target.addEventListener(type, listener, { passive: false });
      this.removeListeners.push(() => target.removeEventListener(type, listener));
    };
    on(this.root, 'pointerdown', (e) => this.down(e as PointerEvent));
    // Captured events bubble here; window also releases input if capture is unavailable.
    on(window, 'pointermove', (e) => this.move(e as PointerEvent));
    on(window, 'pointerup', (e) => this.up(e as PointerEvent, false));
    on(window, 'pointercancel', (e) => this.up(e as PointerEvent, true));
    on(this.root, 'lostpointercapture', (e) => this.up(e as PointerEvent, true));
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu']) {
      on(this.root, type, (e) => {
        const control = this.control(e.target);
        if (!control) return;
        this.suppress(e);
        if (type === 'click') this.click(e as MouseEvent, control.role);
      });
    }
    on(window, 'blur', () => this.clear());
    on(window, 'pagehide', () => this.clear());
    on(window, 'resize', () => this.clear());
    on(document, 'visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.clear();
    });
    this.refresh();
  }

  detach(): void {
    for (const remove of this.removeListeners.splice(0)) remove();
    this.clear();
  }

  /** UI transitions must clear before hiding controls or returning to gameplay. */
  clear(): void {
    const owners = [...this.pointers.values()];
    const changed = owners.length > 0 || this.edges.size > 0 || this.look.size > 0 || this.sneak || this.moveX !== 0 || this.moveZ !== 0;
    if (!changed) return;
    // Delete first: releasing capture can synchronously send lostpointercapture.
    this.pointers.clear();
    this.edges.clear();
    this.look.clear();
    this.moveX = this.moveZ = 0;
    this.sneak = false;
    for (const owner of owners) this.releaseCapture(owner);
    this.refresh();
    this.h.onChange?.();
  }

  consume(): RawFrame {
    if (!this.h.active()) this.clear();
    const pressed = new Set(this.edges.values());
    const held = new Set([...this.pointers.values()].map((owner) => owner.role));
    let dx = 0;
    let dy = 0;
    for (const owner of this.look) {
      dx += owner.dx;
      dy += owner.dy;
      owner.dx = owner.dy = 0;
    }
    const digit = pressed.has('slot1') ? 1 : pressed.has('slot2') ? 2 : pressed.has('slot3') ? 3 : null;
    this.sneak = this.sneaking;
    const frame: RawFrame = {
      moveX: this.moveX,
      moveZ: this.moveZ,
      lookDX: dx,
      lookDY: dy,
      keyYaw: 0,
      keyPitch: 0,
      fire: held.has('fire') || pressed.has('fire'),
      firePressed: pressed.has('fire'),
      selectSlot: digit,
      shield: pressed.has('shield'),
      sneak: this.sneak,
      inventory: pressed.has('inventory'),
      bottle: pressed.has('bottle'),
      interact: pressed.has('interact'),
      potion: false,
      wait: held.has('wait') || pressed.has('wait'),
      map: pressed.has('map'),
      escape: pressed.has('escape'),
      digit,
    };
    this.edges.clear();
    this.look.clear();
    return frame;
  }

  private control(target: EventTarget | null): { element: HTMLElement; role: Role } | null {
    const element = (target as HTMLElement | null)?.closest?.<HTMLElement>('[data-touch]');
    if (!element || !this.root.contains(element)) return null;
    const role = element.getAttribute('data-touch') as Role;
    return ROLES.includes(role) ? { element, role } : null;
  }

  private suppress(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  private click(event: MouseEvent, role: Role): void {
    // Keyboard/assistive-technology activation has no pointer and detail === 0.
    // Pointer clicks are already handled on down; accepting them would double fire.
    if (event.detail !== 0 || (event as PointerEvent).pointerType) return;
    if (!this.h.active()) {
      this.clear();
      return;
    }
    if (role === 'move' || role === 'look') return;
    this.edges.set(event, role);
    this.refresh();
    this.h.onChange?.();
  }

  private down(event: PointerEvent): void {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (!this.h.active()) {
      this.clear();
      return;
    }
    const control = this.control(event.target);
    if (!control) return;
    this.suppress(event);
    if (this.pointers.has(event.pointerId)) return;
    const owners = [...this.pointers.values()];
    const aiming = owners.some((owner) => owner.aiming);
    if (control.role === 'move' && owners.some((owner) => owner.role === 'move')) return;
    if (control.role === 'look' && aiming) return;
    const box = control.element.getBoundingClientRect();
    const owner: PointerOwner = {
      id: event.pointerId,
      ...control,
      aiming: !aiming && (control.role === 'look' || control.role === 'fire'),
      x: event.clientX,
      y: event.clientY,
      centerX: box.left + box.width / 2,
      centerY: box.top + box.height / 2,
      radius: Math.max(1, box.width / 2),
      dx: 0,
      dy: 0,
    };
    this.pointers.set(owner.id, owner);
    if (owner.role === 'move') this.updateStick(owner, event);
    else if (owner.role !== 'look' && owner.role !== 'wait') this.edges.set(owner, owner.role);
    try {
      owner.element.setPointerCapture(owner.id);
    } catch {
      // Window move/up/cancel listeners still clean up if capture is unavailable.
    }
    this.refresh();
    this.h.onChange?.();
  }

  private move(event: PointerEvent): void {
    if (!this.h.active()) {
      this.clear();
      return;
    }
    const owner = this.pointers.get(event.pointerId);
    if (!owner || (event.pointerType !== 'touch' && event.pointerType !== 'pen')) return;
    this.suppress(event);
    if (owner.role === 'move') this.updateStick(owner, event);
    if (owner.aiming) {
      owner.dx += event.clientX - owner.x;
      owner.dy += event.clientY - owner.y;
      this.look.add(owner);
    }
    owner.x = event.clientX;
    owner.y = event.clientY;
    this.h.onChange?.();
  }

  private up(event: PointerEvent, cancelled: boolean): void {
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen') return;
    if (!this.h.active()) {
      this.clear();
      return;
    }
    const owner = this.pointers.get(event.pointerId);
    if (!owner) return;
    this.suppress(event);
    this.pointers.delete(owner.id);
    if (cancelled) {
      this.edges.delete(owner);
      this.look.delete(owner);
    }
    if (owner.role === 'move') this.moveX = this.moveZ = 0;
    this.releaseCapture(owner);
    this.refresh();
    this.h.onChange?.();
  }

  private updateStick(owner: PointerOwner, event: PointerEvent): void {
    const x = event.clientX - owner.centerX;
    const y = event.clientY - owner.centerY;
    const length = Math.hypot(x, y);
    const magnitude = Math.min(1, length / owner.radius);
    const strength = Math.max(0, (magnitude - DEADZONE) / (1 - DEADZONE));
    this.moveX = (length ? (x / length) * strength : 0) || 0;
    this.moveZ = (length ? (-y / length) * strength : 0) || 0;
    const scale = length ? Math.min(1, owner.radius / length) : 0;
    owner.element.style.setProperty('--stick-x', `${x * scale}px`);
    owner.element.style.setProperty('--stick-y', `${y * scale}px`);
  }

  private releaseCapture(owner: PointerOwner): void {
    try {
      if (owner.element.hasPointerCapture(owner.id)) owner.element.releasePointerCapture(owner.id);
    } catch {
      // The browser may already have cancelled or released this pointer.
    }
  }

  private refresh(): void {
    const held = new Set([...this.pointers.values()].map((owner) => owner.role));
    for (const element of this.root.querySelectorAll<HTMLElement>('[data-touch]')) {
      const role = element.getAttribute('data-touch') as Role;
      if (!ROLES.includes(role)) continue;
      if (role === 'move') {
        if (!held.has('move')) {
          element.style.setProperty('--stick-x', '0px');
          element.style.setProperty('--stick-y', '0px');
        }
      } else if (role !== 'look' && !role.startsWith('slot')) {
        // Slot aria-pressed belongs to the selected-tool UI, not pointer ownership.
        element.setAttribute('aria-pressed', String(role === 'sneak' ? this.sneaking : held.has(role)));
      }
    }
  }
}
