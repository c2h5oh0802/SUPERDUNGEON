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


## 手機全螢幕與網址列（2026-10-02）

- 重新整理後，點「開始觸控遊玩」會在該次點擊內嘗試全螢幕。若直接從主選單開始／繼續／重試，也會在第一次觸控遊玩手勢中嘗試。
- 主選單上方與暫停選單都有「全螢幕／退出全螢幕」。退出後不會因「繼續」、換層或重置自動再次全螢幕；想再次進入時請點按鈕。
- 全螢幕包含整個頁面，HUD、背包和選單都保留。退出時清除鍵鼠與觸控按住狀態，正在遊玩的世界會暫停；載入途中退出也會在載入完成後停在暫停畫面。
- 使用標準 Fullscreen API 與 `navigationUI: 'hide'`。Android Chrome 可嘗試；是否准許隱藏網址列仍由瀏覽器決定。部分內嵌瀏覽器／WebView 不支援，會顯示提示並繼續一般模式，不會卡住遊戲。沒有鎖定螢幕方向、PWA 安裝或原生 App。
- 非全螢幕也讓畫布、HUD、控制與選單共用可見視窗尺寸；保留 `100vh`／`100dvh` 回退、安全邊界與選單捲動。觸控模式在未縮放時回應 VisualViewport 高度和位移，避免網址列或鍵盤縮小可見區域時裁切。捏合縮放時保留正常瀏覽器縮放。

### 本輪驗證

- 26 個新增測試：支援／不支援／權限封鎖、拒絕／同步錯誤／取消、重複點擊、真實狀態標籤、外部退出、載入途中退出、繼續、背包／地圖／選擇畫面、鍵鼠模式、非手勢重置、旋轉、可見視窗尺寸與安全邊界樣式契約。
- App 整合測試使用真實世界生成，渲染、音效與輸入適配器是替身；不代表真機測試。既有觸控輸入清除測試繼續執行。
- `node e2e/fullscreen.mjs` 增加真實瀏覽器按鈕路徑與 667×280 短視窗、圖層對齊、支援／不支援、退出及旋轉檢查。此雲端的預設 Playwright 瀏覽器缺失，系統 Chromium 在開頁前因 process socket EPERM 中止；瀏覽器腳本未通過執行，不能當成 Android 驗收。
- 真機檢查：Android Chrome 重新整理 → 橫放 → 開始觸控遊玩 → 確認網址列收起、頂部 HUD 可見 → 兩手移動／攻擊 → 瀏覽器返回退出 → 確認暫停且無殘留輸入 → 繼續一般模式 → 暫停選單再次全螢幕。另檢查直立旋轉、瀏海／手勢安全區、短螢幕選單捲動與內嵌瀏覽器回退。

API 與版面依據：
- [Fullscreen 標準](https://fullscreen.spec.whatwg.org/)：瞬時使用者啟用、非同步結果與外部退出事件
- [Chrome：動態 viewport 單位](https://web.dev/blog/viewport-units)：`dvh` 配合動態工具列，鍵盤與縮放需分別處理
- [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport)：可見區域尺寸與位移事件
- [WebKit 安全邊界](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)：`viewport-fit=cover` 與四邊安全區
