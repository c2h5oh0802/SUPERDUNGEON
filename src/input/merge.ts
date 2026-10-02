import type { RawFrame } from './input';

/** Touch drag uses CSS pixels; a shorter thumb sweep needs a little more travel. */
export const TOUCH_LOOK_SCALE = 2;

/** Keep keyboard support on hybrid devices without ever exceeding a full movement axis. */
export function mergeInput(keyboard: RawFrame, touch: RawFrame): RawFrame {
  const slot = touch.selectSlot ?? keyboard.selectSlot;
  return {
    moveX: Math.max(-1, Math.min(1, keyboard.moveX + touch.moveX)),
    moveZ: Math.max(-1, Math.min(1, keyboard.moveZ + touch.moveZ)),
    lookDX: keyboard.lookDX + touch.lookDX * TOUCH_LOOK_SCALE,
    lookDY: keyboard.lookDY + touch.lookDY * TOUCH_LOOK_SCALE,
    keyYaw: keyboard.keyYaw,
    keyPitch: keyboard.keyPitch,
    fire: keyboard.fire || touch.fire,
    firePressed: keyboard.firePressed || touch.firePressed,
    selectSlot: slot,
    digit: slot,
    shield: keyboard.shield || touch.shield,
    sneak: keyboard.sneak || touch.sneak,
    inventory: keyboard.inventory || touch.inventory,
    bottle: keyboard.bottle || touch.bottle,
    interact: keyboard.interact || touch.interact,
    potion: keyboard.potion || touch.potion,
    wait: keyboard.wait || touch.wait,
    map: keyboard.map || touch.map,
    escape: keyboard.escape || touch.escape,
  };
}
