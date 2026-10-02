# Mobile browser controls

Landscape-first mobile web adaptation of the published `cc32c950fddc8e592302db7d73365e88ca1d4206` tree. This is the same browser game and saved-run format, not a native Android/iOS app.

## Play

1. Open the existing game URL in a phone browser. A primary coarse pointer selects the touch introduction automatically; choose **開始觸控遊玩**.
2. Hold the phone landscape, choose a class, and enter a run or the existing fixed encounter trials.
3. Left thumb: fixed-center analog movement pad. Right thumb: drag the open right-hand area to look, or hold and drag **攻擊／射擊** to aim while attacking. The latter permits moving, aiming and attacking with two thumbs.
4. Tap the current class's weapon slots directly. The huntress's third slot selects a tipped arrow; tapping it again switches the existing paralysis/chill choice. The warrior additionally gets **推擊**.
5. **互動** performs the existing nearby-target action; its border lights when the target is usable. **煙霧** is one throw per press. **潛行** toggles quiet walking; **等待** advances normal time only while held.
6. **背包**, **地圖** and **暫停** have visible controls. Consumable use, equipment, potion throwing, conversion and drops remain in the backpack. Opening a screen clears held movement, attacks and sneak toggle. Bag selection alone costs no world time; choosing an action closes the bag and pays its existing action cost.
7. Turning portrait while playing pauses immediately. Turn landscape and tap **繼續**, or open the pause menu from the rotation notice to use settings/leave the run. Portrait bag and other menus remain scrollable.

Settings include a persistent **觸控操作** choice for hybrid devices and the existing view sensitivity, invert Y, FOV, sound, reduced-motion and pixel-ratio controls. Selecting keyboard/mouse from the introduction preserves the desktop path. Existing keyboard shortcuts still work in touch mode, but canvas mouse aiming/attacks require keyboard/mouse mode to avoid compatibility-event double firing.

### Attack commitment is unchanged

The bow is **press to start its fixed windup, then automatically fire**. Releasing does not cancel a started shot. Holding repeats after recovery. Dragging can adjust aim during windup, and projectile direction is still sampled at the existing firing instant. Stones and melee also retain their existing committed action timing. There is no release-to-fire charge mechanic, aim assist, spread, damage, range or enemy change.

## Implementation boundaries

- `src/input/touch.ts` translates owned touch/pen pointers into the existing `RawFrame`; `src/input/merge.ts` combines keyboard and touch frames without changing `FrameInput` or simulation files.
- A radial 18% movement deadzone remaps the remainder of the stick travel to 0–1. Actual collision-adjusted movement still determines world-time cost. Looking alone keeps the original idle slow-time rate.
- One movement pointer and one aiming pointer at a time; held attack may also own aiming. Pointer capture plus window release handling supports fingers leaving a button. Cancellation drops unconsumed edges. Clear, blur, hidden/pagehide, resize and menu transitions cannot revive old pointers.
- Touch start/resume/UI return never needs pointer lock. Gameplay touch handling is scoped to the control layer; native menu scrolling and buttons retain their normal browser input.
- Layout uses safe-area insets, dynamic viewport height, at least 44px gameplay button targets, compact HUD, short-landscape inventory columns, detail scrolling and visible map/rotation exits.
- Renderer remains the existing Three.js `WebGLRenderer`; no WebGPU/native rewrite or new service. Existing pixel-ratio cap and `?gfx=low` remain available. No real-phone performance result is asserted.
- Saves, seeded unidentified appearances, ten-slot capacity, legacy overflow, stacking, action costs, bosses and all other simulation rules are unchanged.

Pointer-capture/cancellation and scoped `touch-action` follow the [W3C Pointer Events specification](https://www.w3.org/TR/pointerevents4/).

## Verification

TypeScript, ESLint, all **926 tests across 47 files**, production build and whitespace checks pass. Independent review found no remaining implementation blocker; its focused verification covered 115 tests across five files. The full suite includes the previous 831 tests. New checks cover pointer ownership, analog deadzone, multiple contacts, fire-drag aiming, short presses, cancellation/capture loss, inactive-screen clearing, native-overlay boundaries, non-pointer button activation without duplicate touch clicks, keyboard compatibility, preference migration, control copy, and both classes' existing world-time/attack contracts.

`e2e/mobile-controls.mjs` uses Chromium CDP touch contacts rather than synthetic gameplay actions. It checks coarse-pointer startup, no pointer-lock requests, control reachability, movement/look/held fire, frozen inventory/map, actual inventory equip, interruption/resume and screenshots. Inventory fixtures and OS blur are explicitly injected and labeled. It is included in `npm run e2e`.

Browser execution in this cloud is blocked before navigation by Chromium's process socket `EPERM`, including an approved elevated retry. The separate cloud browser also cannot access the loopback preview. Therefore browser assertions, native layout rendering, real-phone FPS/heat and human comfort have **not** been verified.

## Phone review checklist

- Android Chrome and iPhone Safari: start/resume without a pointer-lock prompt; verify sound after tapping start
- Landscape 844×390 and smaller 667×375, with browser bars/notches: health, crosshair, boss telegraphs and all controls remain readable; no overlapping buttons
- Move + right drag; move + drag the attack button; cancel a contact, lift outside the pad and re-touch without jumping or stuck movement
- Both classes: melee/counter/shove, bow/stone, tip switching, smoke, interact, wait and sneak
- Hold a committed bow shot, release before firing: one arrow still completes; no unexpected second shot after release
- Open/close bag while touching move/fire; inspect and scroll, equip/drink/read/throw/convert/drop exactly once, and confirm no movement or attack leaks back out
- Map, talent/upgrade choice, pause and back: each has a reachable return or choice, freezes time and clears held touch state
- Rotate during an action, switch apps/lock screen, return and resume: the world remains paused and the committed action resumes normally
- Check warm-device sustained frame pacing; lower pixel-ratio quality or use `?gfx=low` if necessary. Emulation and unit tests do not establish phone performance
- Desktop mouse lock, fallback right-drag, keyboard movement, bag keyboard focus and existing save/continue still work
