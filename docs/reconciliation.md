# SUPERDUNGEON 雲端整合報告

2026-10-01 · **Ready for Human Review** · 尚未提交或發布本次整合

## 版本與來源

- 共同基底：`69120d99003ac8e7412e68cc19c0f04ede859eee`
- 已發布 Combat Action Economy v1：`600e681a25566bf451866aec87a314c82b0a12c0`
- 本機上傳：`SUPERDUNGEON-local-20261001.zip`，SHA-256 `b6eff588bef8a24784329ce294f209174adf41347df5d2ec390811079cafd473`
- ZIP 88 個檔案；安全列目後解壓，沒有路徑跳脫、symlink、.git、依賴／build 目錄或環境設定／憑證檔；常見憑證字串檢查沒有命中（不是完整資安保證）。原 ZIP 與舊工作區均保留
- 本機版本相對共同基底：23 修改＋8 新增；與已發布版本有 11 個重疊檔案。這是兩組平行未整合工作，不是已發布 commit 把遠端已有的巡邏版本倒退
- 上傳內容沒有 AGENTS／override 或額外正式專案指令；依現有使用者範圍施工。依賴、lockfile、生成器、慢時間核心與存檔格式均未更改

## 恢復的本機功能

1. `World.roamPoints`：非入口房間的可站中心＋原巡邏點，醒著的地面敵人跨房活動；高台弩手保留崗位
2. `investigate`／`beginSearch`／`resumeWandering`：聲源／屍體／短暫目擊先調查事件位置，失去玩家後搜索最後已知位置，20 秒調查上限、12 秒搜索移動上限、8／16 秒局部搜索，結束清除舊記憶恢復巡邏
3. 睡眠近距離喚醒須 LOS；遮蔽中的玩家不會被遠程受擊、同伴碰撞或準備攻擊偷偷追蹤。友軍弩矢只提供命中事件位置，不暴露玩家
4. 敵人開門先付 0.6 世界秒並等待門動畫；切換狀態不跳過付款，再關門須重付；發聲敵人不調查自己的門聲／屍體呼喊
5. HUD 的調查 `?`、搜索 `…`、追擊 `!`，開發觀察 API，Windows E2E 路徑與即時重試取樣修正
6. 普通武器不再有通用背刺 ×3：長劍／重斧／長矛奇襲傷害等於基礎傷害，獵刀例外 ×2。睡眠不限方向；醒著的 idle／patrol 敵人須背後且 `!seesPlayer`；調查／搜索／追擊不能奇襲。存活主目標踉蹌 0.8 世界秒，立即放下盾牌

## 重疊處如何整合

| 規則 | 最終選擇 |
|---|---|
| 武器移速 | 採 Combat v1 分階段上限，取代本機整段固定 `moveMul`；不相乘，不保留無效參數 |
| 長矛時間 | 保留上傳 source 的準備 0.18／作用 0.12／收招 0.55，總共 0.85 秒；reach 2.8 不變 |
| 盾衛踏步 | 保留上傳 source：起手距離 2.4＋玩家半徑，舉劍不移動，作用期 6 m/s、最多 0.9 m，距離 ≤2.15 時不擠進；鎖定後不轉向；牆／門／角色仍阻擋 |
| 踏步＋推擊 | 滑行中不自主踏進，但原攻擊計時繼續；滑行完畢可在剩餘作用期踏進。因此淨位移可能小於外力的 1 m，不等於推擊被取消 |
| 奇襲＋Cleave | 保留本機傷害／資格與主目標 0.8 秒踉蹌；重斧次目標傷害與反應均減半（仍符合奇襲時為 0.4 秒，普通失衡 0.3 秒）。一般戰鬥聲可能先喚醒次敵使它失去奇襲資格 |
| 弩手 | 保留已觀察的 aimPoint，起手及鎖前檢查目前／已保存的射線；鎖定後即使玩家躲入煙霧或同伴踏進仍照原射線出手。保留空間鎖定提示音 |
| 盾牌／推擊 | 採 v1：固定臂盾停用、F／右鍵純位移推擊。Counter／Deflect 保留；舊盾投資欄位仍可載入但不生效 |
| 本機舊文檔 | `spear-kite-fix.md` 的 2.5 起手距離、3 m/s 舉劍踏步、0.4 矛收招已落後於 source；保留歷史紀錄並加醒目更正，不用舊文檔覆蓋較新程式 |

### 最終武器規則

| 武器 | 傷害／射程 | 準備／作用／收招移速 | 每次行動目標 |
|---|---|---|---|
| 獵刀 | 3／1.6 m，奇襲 6 | 85／80／95% | 1 |
| 長劍 | 4／2.0 m | 65／55／80% | 1 |
| 長矛 | 4／2.8 m | 40／25／65% | 首個有效身體，1 |
| 重斧 | 7／2.1 m | 35／20／45% | 最多 2，次敵半傷／半反應 |

- 移速限制含各方向、放鍵慣性、潛行相乘，以及開始行動時捕捉的武器；切換工具不能規避
- 時間規則仍為 idle 0.1×、距離推時間、移動與行動取 max 而非相加
- 推擊：0.4 世界秒、60% 移速、90°、身體間距 0.8 m 內一敵、推 1 m、無傷害／防禦／自動打斷。實際撞牆／同伴才失衡；陷阱／衝鋒互動保留
- 敵方弩矢：牆／敵人／玩家沿線第一實體決定碰撞；友傷基礎 2（頭部不翻倍）並停止。無玩家射擊命中信用、穿透或可回收彈藥；正常 XP／掉落僅一次
- Counter 與真正命中使用相同目標限制；不承諾隔著前方身體反擊後方敌人。保留舊盾存檔與空升級選單防卡死

## 真實快照 before／after

用完全相同的 `combatEconomyScenarios.ts` 在原上傳 source 與整合 source 執行，沒有把參數模擬冒充完整歷史版本。每邊 15 個情境；完整資料在 `reconciliation-baselines/uploaded-local.jsonl` 與 `merged.jsonl`。下表為「傷害／世界秒／揮擊數」。所有初始場景／裝備是明示 fixture；後續使用正常 frame input，完美瞄準與固定政策不是真人能力。

| 相同政策 | 上傳版本 | 整合版本 |
|---|---|---|
| 長矛單盾衛，距離循環 | 0／1.311／2，清場 | 0／1.323／2，清場 |
| 長矛雙盾衛，距離循環 | 0／1.287／2，清場 | 3／3.362／4，清場 |
| 長矛雙盾衛，持續後退 | 0／5.283／7，清場 | 0／9.533／12，清場 |
| 長矛盾衛＋弩手，距離循環 | 4／3.848／3，清場 | 4／6.087／4，清場 |
| 長劍近距雙敵，站樁攻擊 | 6／0.750／2，清場 | 9／1.950／4，清場 |
| 重斧近距雙敵，2 秒觀察窗 | 0／1.350／2，清場 | 3／2.017／2，擊倒 1、另 1 HP，時間到 |
| 同一已鎖定盾衛，反覆盾推／推擊 | 0 傷、12 秒未擊倒，觀察到取消 1 次 | 12 傷、4.137 秒死亡，取消 0 次 |
| 同一已鎖定盾衛，讀提示 Counter | 0／1.483／2，清場 | 0／1.483／2，清場 |

邊界與反例必須一起讀：
- 單普通敵人無傷仍合法；雙敵持續後退在這條開放長走廊也仍可無傷，但需 12 次揮擊。不能聲稱所有低判斷循環已消失
- 明示注入 100 HP 的單敵長期探針，在整合版距離循環 20 秒仍 0 傷、敵人剩 24 HP；同政策受限退路探針死亡，混合探針受到弩矢傷害。這是風險／策略範圍證據，不能當成 universal safety 已被證明排除
- 舊本機重斧測試政策會在自己舉斧途中因敵人舉劍而後退，60fps 時起手結束已離開有效射程（2.58 > 2.55），最後死亡。保留原政策結果為 observation；改成完成自己已開始的起手再撤退，四武器於 30／60／120fps 都能無傷擊倒普通盾衛。沒有為測試改武器或敵人數值
- 戰士舊盲目連刺政策對 32 HP 探針不再碰巧反擊，兩種初距皆失敗；讀真正 Counter cue 的 24 組武器／距離／HP／fps 組合均 0 傷成功（普通 2 次、32 HP 8 次反擊）。不要求盲目政策必勝或必定受傷

## 本次實際驗證

- 原上傳版：`npm run typecheck`、`npm run lint`、`npm test`（197/197、14 檔）、`npm run build` 全通過
- 整合版：`npm run typecheck`、`npm run lint`、`npm test`（256/256、20 檔）、`npm run build` 全通過。Vite 49 modules，bundle `index-JMhPBrLn.js`
- 29 項原 livingDungeon 回歸完整保留；13 項跨功能整合測試包含奇襲／有限目標、推擊中的實際盾衛踏步、友軍踏入弩手射線、保存瞄準線的鎖前檢查與煙霧前後鎖定
- 獨立 reviewer 聚焦驗證 175 項（12 檔）通過；一項舊盲目戰士政策斷言改成 observation 後，長矛與主動 Counter 30/30 通過；沒有剩餘可行動 source 缺陷
- 初次整合 235/240 通過、5 項失敗：推擊淨位移精確值與舊政策假設。另新測試 fixture 直接呼叫推擊卻沒建立 action，已改用真實輸入；全部重跑後通過
- E2E 合併保留 living-dungeon／melee-movement，並登記 combat-economy；移速檢查改為逐階段，dev API 增加 windup／active／recovery 作觀察
- 相關所有 E2E `node --check` 通過只代表語法，不代表瀏覽器行為
- `BROWSER_PATH=/usr/bin/chromium node e2e/living-dungeon.mjs` 在 Chromium 啟動即失敗：`socket() failed: Operation not permitted`，沒有執行任何 browser assertion。其他相關 E2E 未實跑；歷史本機瀏覽器通過紀錄不能挪作本次證據
- `git diff --check`、完整補丁對 exact 600e681 的套用驗證通過；未更改依賴／存檔格式／時間核心
- 本次沒有 commit／push／redeploy，線上仍為之前的 600e681；發布需另行確認

## 最短人工檢查

`npm ci` → `npm run dev` → 一般「開始冒險」，固定種子 `LIVING1`。需要定點配置可用 `?dev=1&gfx=low` 的既有 debug；這是可選 fixture，不代表正常完整通關。

1. 等醒著的地面敵人離開原房、投石引發 `?`、切斷視線後看 `…` 搜索，再恢復巡邏；觀察門和躲藏因果
2. 背後奇襲盾衛：長劍 4 傷、獵刀 6 傷，存活並踉蹌，不能再看到固定背刺 ×3
3. 四武器各打一隻，再試雙敵、狹路與弩手混合；刀／劍／矛只中一敵，斧第二敵半傷；長矛保留最遠距離與 0.85 秒承諾
4. 盾衛舉劍站定、鎖向、揮下踏進；比較及時側移／Counter 與 F 推擊。推擊不自動取消攻擊，不擋箭；牆／同伴撞擊應清楚可讀
5. 鎖前讓同伴擋住弩手，確認不射；鎖後誘導同伴踏入射線、或躲煙霧，弩矢仍沿原方向，第一身體承受友傷。聽背後弩手的起手／鎖定／發射音

只真人能驗收手感、移速是否僵硬、長矛距離幻想、重斧價值、巡邏煩躁度、友傷是否過密與聲音可讀性。沒有 Hunger／stamina／隨機命中／新敵人或時間重寫；自動化通過不等於體驗或最終平衡通過。

## 本次修改檔案（相對 600e681）

共 40 檔：

- `README.md`
- `docs/classes.md`
- `docs/combat-action-economy.md`
- `docs/living-dungeon-v1.md`
- `docs/reconciliation-baselines/merged.jsonl`
- `docs/reconciliation-baselines/uploaded-local.jsonl`
- `docs/reconciliation.md`
- `docs/spear-kite-fix.md`
- `docs/stealth-and-loot.md`
- `docs/vertical-slice.md`
- `e2e/classes.mjs`
- `e2e/lib.mjs`
- `e2e/living-dungeon.mjs`
- `e2e/melee-movement.mjs`
- `e2e/retry.mjs`
- `e2e/run-all.mjs`
- `index.html`
- `src/config.ts`
- `src/dev/devapi.ts`
- `src/render/characters.ts`
- `src/sim/enemySys.ts`
- `src/sim/playerSys.ts`
- `src/sim/propSys.ts`
- `src/sim/types.ts`
- `src/sim/world.ts`
- `src/ui/hud.ts`
- `tests/ai.test.ts`
- `tests/archerLineOfFire.test.ts`
- `tests/classes.test.ts`
- `tests/combat.test.ts`
- `tests/counterTimingFairness.test.ts`
- `tests/gen.test.ts`
- `tests/items.test.ts`
- `tests/livingDungeon.test.ts`
- `tests/meleeFairness.test.ts`
- `tests/reconciliation.test.ts`
- `tests/spearKite.test.ts`
- `tests/spearKiteBots.ts`
- `tests/stealth.test.ts`
- `tests/stealthSim.test.ts`
