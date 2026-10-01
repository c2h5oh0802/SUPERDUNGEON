# 活的地下城 v1 — 實作、證據與人工測試

> 本文件是上傳版本的歷史交付紀錄。AI 與奇襲規則已保留；合併後重斧次目標的奇襲踉蹌減半為 0.4 秒，盾推由純位移推擊取代。下方本機瀏覽器通過紀錄不代表本次合併版已執行瀏覽器驗證。最新驗證見 [整合報告](reconciliation.md)。

狀態：**Ready for Human Review**。功能與自動化驗證完成；真人試玩未執行，尚無 Accepted／玩法通過的判定。

本輪範圍由使用者的「活的地下城 v1」需求決定。基底為 `69120d99003ac8e7412e68cc19c0f04ede859eee`；遠端預設分支是 `claude/wizardly-lamport-dlnz24`，使用者授權直接修改 main，因此以該 HEAD 建立本地 `main`。沒有 commit／push、外部發布、依賴版本變更或存檔遷移。

## 修改前的直接證據

- `enemySys.ts` 原有 `sleep / idle / patrol / search / alert`；聲音與失去玩家共用 `search`。
- `idle` 回出生崗位；`patrol` 跟生成的局部往返點。`LevelData.rooms` 和 0.5 m A* 導航已存在，無須改 generator。
- 視線中斷後原本已有最後已知位置與 4 秒記憶，但搜索只在抵達後計時；不可達目標可能永遠搜索。
- 睡眠近距離喚醒只看距離；遠程受擊與被推敵人的同伴碰撞會呼叫 `becomeAlert`，直接取得玩家座標。準備攻擊時也有不看 LOS 的追蹤方向。
- 長劍 4×3＝12、獵刀 3×3＝9，對第一層 8 HP 盾衛均可一擊擊倒。重斧與長矛原本 ×2。奇襲只用於近戰；箭與石頭未套奇襲倍率。XP 按擊倒敵人給付，原本就不因奇襲額外加成。
- 每層 HP +15%；老兵 HP ×1.5、倍率上限 ×2。存檔 v2 只包含每層開頭的玩家 carry／stats，敵人與門重新建立。
- 修改前 `npm test -- tests/ai.test.ts tests/stealth.test.ts`：20/20；基底 build 與瀏覽器 `LIVING1` 開局可執行，沒有瀏覽器錯誤。

## 狀態模型與因果

| 程式狀態 | 玩家理解 | 轉移 |
|---|---|---|
| `sleep` | 睡眠，Zz | 有效聲音或可見近距離停留 → investigate；近戰命中存活 → alert |
| `patrol` | 一般活動 | 聲音／屍體／短暫目擊 → investigate；察覺量表填滿 → alert |
| `investigate` | 前往事件位置，? | 看見並確認玩家 → alert；抵達 → search；20 世界秒仍未抵達 → patrol |
| `alert` | 已確認，追擊／戰鬥，! | 只在看見時更新 lastKnown；失去 LOS 4 世界秒後 → search，已開始的攻擊照原時間完成 |
| `search` | 搜索最後位置，… | 重新確認玩家 → alert；前往位置最多 12 世界秒，抵達後搜索 8 秒（整層戒備時 16 秒）→ patrol |
| `idle` | 固定崗位 | 高台弩手或沒有活動點的極小測試地圖保留；同樣可調查／追擊／有限搜索 |

搜索會查看固定事件位置附近約 2 m 的可達導航點並張望，局部路徑不超過 6 m；不讀取遮蔽中玩家的位置。結束後清除 target、lastKnown、searchGoal、搜索／巡邏計時與路徑。所有時間都由原有世界時間及敵人麻痺／冰寒時間軸推進。

## 活動、門與聲音

- 各非入口房間中心投影到既有可站導航格，和原有 patrol 點組成循環。敵人 ID 決定起始索引，不加入每幀亂數。地面 idle 轉為 patrol；睡眠保留到被喚醒。高台弩手保留高台。
- A* 沿用門可開、門閂不可通行、角色半徑擴張、分離與卡住換目標。活動點不可達會跳過；每段最多 60 世界秒，抵達停留 1.5 秒，避免永遠追逐壞目標。
- 敵人開門先支付原有 0.6 世界秒，再等待原有門動畫完全開啟；狀態切換不重置或跳過支付。成功開門清除已支付時間，之後重新關門須再次支付。
- 門聲／呼喊帶有發聲敵人 ID，自己不調查自己的事件；同位置的外來聲音仍有效。看到屍體仍喚起整層戒備，但不暴露玩家位置。
- 沿用既有 NOISE：隔牆有效半徑 ×0.5，睡眠再 ×0.6；Shift 無腳步聲。煙霧依原規則只阻擋視線，投射物不被刪除。
- 遠程受擊只能在真的可見時確認玩家；否則查看命中位置。同伴碰撞只提供事件位置。睡眠近距離喚醒需 LOS；敵人失去視線後的攻擊準備不再追蹤新的玩家朝向。

## 奇襲先手

睡眠不限方向；未目擊玩家的 idle／patrol 敵人須從背後 120° 內命中。調查、搜索、追擊都不提供奇襲。存活敵人進入正常戰鬥，且踉蹌 0.8 世界秒、立即放下盾牌。

| 武器 | 基礎傷害 | 奇襲傷害 | 第一層盾衛剩餘 HP |
|---|---:|---:|---:|
| 長劍 | 4 | 4 | 4 |
| 獵刀 | 3 | 6（×2） | 2 |
| 重斧 | 7 | 7 | 1 |
| 長矛 | 4 | 4 | 4 |

保留既有武器強化、連擊、突進者撞牆弱點、老兵上限與 XP；因此低 HP 弩手、強化武器或既有 combo 仍可能一擊擊倒。目標是消除普通武器的通用 ×3，而不是保證所有敵人永不被一擊擊倒。舊的 backstabs／sneakKills 統計名稱保留，避免存檔格式變更。HUD／操作說明／職業說明已改為奇襲先手，不再固定顯示「背刺 ×3」。

## 驗證紀錄

最終工作區與打包版驗證：

| 實際命令 | 結果 |
|---|---|
| `npm ci --ignore-scripts` | 鎖定依賴安裝成功；未更改 package／lockfile |
| `npm test -- tests/ai.test.ts tests/stealth.test.ts`（修改前） | 20/20 通過 |
| `npm test -- tests/livingDungeon.test.ts tests/ai.test.ts tests/stealth.test.ts tests/combat.test.ts tests/stealthSim.test.ts tests/items.test.ts` | 聚焦階段執行；修正規格斷言與跨房抵達時間後通過 |
| `npm test -- tests/livingDungeon.test.ts` | 最終 29/29 通過，含同設定重複完整狀態循環及四層 45 世界秒跨房／不穿牆模擬 |
| `npm test -- tests/livingDungeon.test.ts tests/stealthSim.test.ts` | 中間版 28/28 通過；當時 AI 專項為 26 項，之後再加到 29 |
| `npm run typecheck` | 通過 |
| `npm run lint` | 通過；最終 E2E 腳本修改後再執行亦通過 |
| `npm test` | 最終 12 檔、164/164 通過 |
| `npm run build` | 通過；47 模組，最終 JS `index-DYzgGxAH.js`，約 725 kB（gzip 約 207 kB） |
| `node e2e/living-dungeon.mjs` | 開發版 AI 整合 9 項通過 |
| `BASE_URL=http://127.0.0.1:4173/ npm run e2e` | 最終打包版 7 個腳本全部 exit 0：browser 37/37、airburst OK、retry 所有檢查通過、classes 30/30、floors 17/17、items 15/15、living-dungeon 9 項通過 |
| `git diff --check` | 通過；最終 diff 已 review，沒有 generator／時間核心／Loot 重構或無關格式化 |

Windows 執行 E2E 的環境設定：`$env:BASE_URL='http://127.0.0.1:4173/'`；`$env:PLAYWRIGHT_BROWSERS_PATH` 指向本次 `work/playwright`。測試瀏覽器由 `npx playwright install chromium` 下載至該任務目錄；沒有全域安裝。開發與打包預覽以 `npm run dev`／Vite preview（127.0.0.1、5173／4173）啟動。

早期失敗與處理：舊 ×3／共用 search 斷言按新規則更新；測試走完跨房與門動畫需 8 秒而非 6 秒；一次 airburst 被施工熱更新中斷；retry 過晚取樣把 0.517 秒誤判成未重置；舊盾推腳本的靜態站位假設被活動 AI 打破；200 種子測試超過預設 5 秒。各項已取得具體證據並修正驗證設定，最終以穩定的打包版重跑全部 E2E，均通過。沒有剩餘失敗或未執行的必要自動化驗證；未執行真人試玩、真實 GPU 效能或完整正常輸入四層通關測試。

交付 outputs 的 `verification/tests-final.log`、`verification/e2e-release.log` 為最終證據；`e2e-all.log`／`e2e-final.log` 為早期失敗紀錄，不應當成最終版本結果。`living-search.png` 是使用狀態注入的瀏覽器搜索畫面，已目視確認敵人與 … 提示。

E2E 的 AI 專項使用 debug 隱形、傳送、噪音、煙霧與世界時間推進；樓層 E2E 使用傳送到目標；職業 E2E 的盾推測試在暫停中注入玩家初始站位，再以正常 F／移動驗證，射擊場也沿用原有站位注入。這些不是正常輸入完整通關或真人玩法證據。死亡重試與物品 E2E 保留原有輸入流程（升級測試原本就注入 XP）。

## 最短人工測試入口

`npm ci` → `npm run dev` → 開啟 `http://127.0.0.1:5173/` → 主選單「操作練習」，選戰士。正式四層可固定種子 `LIVING1`。

1. 留在入口觀察，按 Space 推進時間，確認左側醒著的盾衛會離開原房間；試著等它走開再通過。
2. 用 2 選投石，對另一個可達位置丟石；觀察 ? 前往聲源。Shift 可避開自己的腳步聲，並非必須操作。
3. 走入敵人視野，確認量表填滿 → ! → 原有戰鬥。用轉角、E 關門或 Q 煙霧切斷 LOS。
4. 留在遮蔽後，用 Space 等待；觀察它先到最後位置、出現 … 並查看附近，最後恢復活動。再出現應能重新引起追擊。
5. 重置練習，從背後先攻醒著且未目擊你的盾衛，或攻擊睡著的盾衛。長劍只造成 4 傷，敵人踉蹌後仍有戰鬥機會。換獵手以獵刀比較 6 傷先手。

先安靜玩，再回顧：路線是否因敵人位置而改變、等待是否值得、搜索因果是否清楚、是否仍想逐房清場、背後攻擊是否缺提示、Shift 是否變成強制最優解、奇襲是否有價值且保留戰鬥特色。記錄操作行為、玩家自己的感受與提出的改法，分開記錄；此輪沒有真人結果或 Human Verdict。

## 假設、限制與修改範圍

- 假設醒著的地面敵人適合活動，高台弩手維持崗位；房間中心循環足以提供 v1 位置變化，未設計職責／領地／個人日程。
- 未改 generator、房間內容、四層結構、時間核心、Loot／XP／天賦、存檔版本或 Shift。沒有 Hunger、甦醒度、Boss、新敵人／職業／裝備系統。
- 主要風險仍是第一人稱下從背後接敵的資訊量、巡邏是否增加煩躁、搜索可讀性、奇襲窗口與 Shift 的實際取捨。數值是可調第一版；軟體渲染 E2E 不證明真實 GPU 效能。
- 原有 200 種子生成測試在瀏覽器與模擬同時執行時超過預設 5 秒；只為該批量正確性測試設 30 秒上限，保留所有種子與斷言。
- Windows E2E 路徑改用 fileURLToPath；重試驗證改為進入遊戲當下取樣，避免把 IPC／截圖後經過的時間當成未重置。
- 本輪沒有驗證 Hunger，也不能由自動化結果宣稱真人玩法體驗已通過。

修改檔案：`src/sim/{enemySys,playerSys,propSys,types,world}.ts`、`src/config.ts`、`src/dev/devapi.ts`、`src/render/characters.ts`、`src/ui/hud.ts`、`index.html`；`tests/{livingDungeon,stealth,stealthSim,combat,items,gen}.test.ts`；`e2e/{living-dungeon,classes,lib,retry,run-all}.mjs`；`README.md`、`docs/{living-dungeon-v1,stealth-and-loot,vertical-slice}.md`。

實作方法使用 playable-prototype 0.2。體驗假設是「敵人的位置與知道多少，讓玩家選路／誘敵／脫離／接戰有價值」；關鍵風險是活動與搜索可能只是不可理解的干擾。測試條件由使用者需求與現有程式建立：必須有能等候通過的路線、聲源／視線區別、可切斷 LOS 的遮蔽與仍可用的正面作戰。未做外部先例掃描，因這些前提已明確，外部資料不改本輪範圍；未使用第二模型或 subagents。

Project Match：本地 SUPERDUNGEON package／HEAD 與啟動的 `LIVING1`／practice dev API 相符。Node 24.14.1、Three.js 0.180.0、TypeScript 5.9.3、Vite 7.3.6、Playwright 1.56.1／Chromium 141.0.7390.37。以檔案修改、tsc／Vite、Playwright 啟動／停止、dev API／畫面／錯誤記錄與 Vitest 構成控制及驗證；無即時引擎 MCP 工作階段。
