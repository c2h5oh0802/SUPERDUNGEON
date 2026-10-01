# Huntress Progression v2 — Ready for Human Review

2026-10-01。實際起始遠端 HEAD：`4156c4a5b121f307b9fb2d9a6118147d872b128b`，分支 `claude/wizardly-lamport-dlnz24`。在獨立、初始乾淨的雲端副本實作，保留既有工作樹；未使用使用者電腦。未找到額外 Repository AGENTS／override／CONTRIBUTING 指示。當前 Three.js 0.180.0、TypeScript 5.9.3、Vite 7.3.6／Vitest 3.2.7 架構沿用。

## 確認的根因與範圍

舊標記是 `player.markT`，任何箭命中都可能讓下一次普通拉弓變快；藥劑師在 `onFloorStart` 免費補兩種箭；敏銳感官直接把牆後敵人加入 HUD 可見集合，連狀態圖示也可出現。三條路徑都已移除／替換。

本輪改成工具切換、資源取捨與有限資訊。沒有更改獵刀、弓傷害／爆頭／一般箭供給或回收、基礎控制箭、盾衛遠程舉盾、突進者頭盔、獵人之眼、職業初始藥水知識、同種子生成、Chapter 4+1、Healing／Food／Hunger、Upgrade／XP 的基本責任。

## 最終四項天賦

### 狩獵標記（保留 ID `mark`）

- 一般獵弓箭成功造成命中且敵人存活：該敵人標記 3 世界秒；再命中只刷新。
- 藥劑箭不建立標記；普通箭不消耗，也沒有加速／傷害加成。
- 對該目標開始近戰或麻痺／冰寒箭：準備時間乘 0.6，立即消耗；之後轉向、目標跑開、落空或動作中斷均不退回。
- 近戰按目前武器、角度、距離的第一個可碰到身體；藥劑箭按準星射線的第一個實體與地形遮擋選目標，不會跳過前排去借用後排標記。
- active／recovery／damage 不變；與既有 Haste 正常相乘。
- 以敵人的短期世界時間截止值保存，死亡目標不可使用，不寫入跨層／存檔。◇ 僅在敵人實際可見時顯示。
- 實際時間收益很保守：獵刀總動作 0.400→0.368 秒；藥劑箭 0.800→0.752 秒。這是 windup 減40%，不是整個動作減40%。是否值得換工具需真人判斷。

### 藥劑師（保留 ID `apothecary`）

容量各 +1，現為每種 3 支；移除所有跨層自動補充。

| 代價 | 完成產出 |
|---|---|
| 1 瓶已鑑定冰霜 | 2 支冰寒箭 |
| 1 瓶已鑑定麻痺氣體 | 2 支麻痺箭 |

只限獵手＋該天賦，且目標箭種至少空出 2 支容量。2/3 不可調製，1/3 可調製成3/3。其他藥水與未知瓶不顯示配方，模擬層也拒絕；未知身份不因按鈕或錯誤內容洩漏。

背包選「調製藥劑箭」→返回世界→正常 committed action：開始扣一瓶、0.6 世界秒完成時給兩支。中斷沿用一般消耗品的已保留即消耗政策，沒有特殊退款。不另扣 Hunger；Haste 下顯示及支付正常0.3秒。完整產量不偷偷裁切：現有一般拾取不會補藥劑箭，補給台又是另一個不可重疊動作，所以開始容量檢查後，容量不會在動作期間被正常拾取占走。

瓶子保留 AoE slow／滅火或區域麻痺，與兩發精準箭形成真正取捨。`itemsUsed` 在完成時計1；不是喝藥，因此不算 Healing／飲用次數。

### 敏銳感官（保留 ID `senses`）

只重用真正的敵人聲音事件：實際移動距離產生腳步、帶來源ID的開門／呼喊，以及已有聲音的準備／鎖定／攻擊／射擊。新增腳步採固定步距與小型空間音效，僅作呈現，不廣播 AI 噪音或叫醒其他敵人。

12m 內且被地形／煙遮蔽時，記錄事件當刻相對玩家的八方向快照，最多4個不同方向，重複同方向合併；約1.2真實秒淡出。快照只含方向與過期時間，不含敵人ID、座標、距離、HP或狀態；玩家轉向後不追蹤、更不能用轉頭精確定位。CSS 也在暫停時淡出，避免舊提示永久留著。

靜止無聲、睡眠、已死亡、範圍外或可見敵人都不產生特殊牆後提示。沒有持續輪廓、投影點或精確壁後圖示。實際可見敵人仍走原本呈現。

### 輕步（保留 ID `lightstep`）

原設定完全保留：潛行步速度×1.5、同距離世界時間倍率2→1.33，仍是安靜站立慢走，沒有隱形／蹲低／hitbox改變；Hunger 自然反映實際時間。

## 舊存檔與池耗盡

mark／apothecary／senses 原ID載入新行為，lightstep不變。舊獵手已有 `toughness` 原樣保留，HP不扣、天賦不替換；僅從新獵手選項中排除，戰士仍有堅韌。

20個種子的全章敵人XP供給為242–274，完整擊殺可達Lv9–10；本次樣本在探索層4結束時已Lv9並取得四項。Lv10第5次原定選擇因池耗盡而安全略過，仍獲原本升級HP。不新增湊數天賦。額外修復一次大量XP跨多級時的舊問題：排隊選單顯示時依原等級種子重新排除已持有選項，避免重複給已選天賦或留下空選單。這是局部防護，未改XP曲線。

## 驗證與模擬證據

- 修改前：`npm test`，374 tests／25 files 全過。
- 修改後：`npm run typecheck`、`npm run lint`、`npm test`、`npm run build`、`git diff --check` 通過；436 tests／28 files（新增Mark/legacy/choice 14、Apothecary27、Senses21）。
- `node --check e2e/huntress-progression.mjs` 通過。
- 固定20種子×3種擊殺供給比例＝60列XP帳本：30%＋全部首領敵人為80–98XP、Lv5、2天賦；70%為170–207XP、Lv7–8、3–4天賦；全清為242–274XP、Lv9–10、4天賦。這是資源供給上界／暴露比例，不是完整走圖存活測試。
- 24個固定基礎裝備遭遇採1.5°／4°採樣瞄準誤差、200ms決策間隔；修改前後輸出逐列完全相同：12通過、12死亡，合計75普通箭、16麻痺箭、2冰寒箭、24近戰、12完成治療。死亡也保留，不拿完美機器人代替真人。
- 不同敵人擊殺、傷害、時間、箭數、HP／治療等詳細紀錄與重現命令見 [基準說明](huntress-baselines/ASSESSMENT.md)、[前後比較](huntress-baselines/comparison.json)。場景腳本不是策略最佳化器，沒有證明普通弓不存在主導解法，也沒有證明天賦自然讓人換工具。
- 本地Vite以 `npm run dev -- --host 127.0.0.1 --port 5197` 正常啟動，HTTP200含main入口。`--host 0.0.0.0` 因環境網卡列舉 `uv_interface_addresses` 失敗，使用localhost恢復。
- 已實際嘗試 `BROWSER_PATH=/usr/bin/chromium node e2e/{huntress-progression,classes,items,floors,chapter-resources,playthrough}.mjs`；全都在Chromium啟動前遇到 `socket() failed: Operation not permitted`，沒有進入UI斷言。新流程以正確localhost再試仍同樣阻礙。瀏覽器視覺／操作／聲音／手感未驗證，不能標示Accepted。

## 最短人工路線

正式入口：<https://superdungeon.vercel.app/>。以獵手跑完整Chapter1，先看主選單四天賦描述；可用同種子重試比較。

1. 標記：普通箭命中未死敵人，看到◇後用刀／麻痺／冰寒接招；比較繼續普通箭與刻意打空的代價。
2. 藥劑師：取得並辨識冰霜／麻痺瓶。先在2/3箭確認不准浪費，再消耗一箭至1/3、從背包調製，看扣瓶→世界動作→3/3。下一次考慮保留瓶的範圍／滅火用途。
3. 感官：在轉角聽巡邏、門聲與弩手準備，檢查短暫粗略方向；停下無聲敵人不能持續透牆標記。轉頭不應變成精準追蹤。
4. 輕步：同一段路比較沒選／有選的速度、安靜與Hunger成本。獵人之眼照舊測煙霧瓶空爆。
5. 完整章節記錄：普通箭是不是自動答案？兩種控制箭解不同問題嗎？有沒有主動切刀、保留瓶或轉箭？天賦是否真的改變行為？若仍大多等待→射弱點，先記是哪種敵人組合沒有要求其他回答，不先砍弓數字。

## 取捨、假設與風險

- 感官是聲音事件快照，不是單RGB／位置追蹤；轉頭後舊快照仍代表當刻方向，需真人確認可讀性與HUD噪音。
- 標記加速幅度有意只作用windup，總動作節省很小，可能被忽略；此輪遵守指定0.6，不預先加傷害或縮recovery。
- 藥劑師拿掉免費補給是否讓控制箭太少，以及AoE瓶／兩支箭哪個幾乎總較好，仍需實際整章測試。
- 深度全清能取得四項後，不再有新的獵手天賦選擇；這是接受四項池的最小安全行為，不等於長期build已完成。
- 舊存檔保留堅韌，因此舊局與新局可能有不同已取得HP；這是明確的相容政策。
- 自動化不能證明好玩、聲音可讀、操作舒服或普通弓平衡。本輪沒有調整基礎弓輸出、Healing／Hunger／Food／Upgrade，也沒有重加Rune。

“The Huntress base combat kit was intentionally preserved. This change targets progression quality: tool switching, information play, and consumable tradeoffs rather than increasing bow output.”

## 修改檔案

- `README.md`
- `docs/classes.md`
- `docs/huntress-baselines/ASSESSMENT.md`
- `docs/huntress-baselines/METHODOLOGY.md`
- `docs/huntress-baselines/after.json`
- `docs/huntress-baselines/after.json.source-sha256.json`
- `docs/huntress-baselines/before.json`
- `docs/huntress-baselines/before.json.source-sha256.json`
- `docs/huntress-baselines/comparison.json`
- `docs/huntress-baselines/focused-tests.txt`
- `docs/huntress-baselines/tooling-sha256.json`
- `docs/huntress-baselines/validation.txt`
- `docs/huntress-progression-v2.md`
- `docs/stealth-and-loot.md`
- `e2e/huntress-progression.mjs`
- `scripts/huntress-calibration/compare-results.mjs`
- `scripts/huntress-calibration/harness.mjs`
- `scripts/huntress-calibration/run-calibration.mjs`
- `src/audio/sfx.ts`
- `src/config.ts`
- `src/dev/devapi.ts`
- `src/sim/enemySys.ts`
- `src/sim/huntingMark.ts`
- `src/sim/items.ts`
- `src/sim/playerSys.ts`
- `src/sim/progress.ts`
- `src/sim/projectileSys.ts`
- `src/sim/senses.ts`
- `src/sim/types.ts`
- `src/sim/world.ts`
- `src/ui/hud.ts`
- `src/ui/inventory.ts`
- `src/ui/style.css`
- `tests/apothecary.test.ts`
- `tests/huntingMark.test.ts`
- `tests/senses.test.ts`
