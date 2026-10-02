// 依序執行瀏覽器端腳本（需要先啟動 npm run dev 或 npm run preview，並設定 BASE_URL）。
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = ['browser.mjs', 'airburst.mjs', 'retry.mjs', 'classes.mjs', 'floors.mjs', 'items.mjs', 'living-dungeon.mjs', 'melee-movement.mjs', 'combat-economy.mjs', 'hunger.mjs', 'chapter-resources.mjs', 'healing.mjs', 'practice-trials.mjs', 'equipment-upgrades.mjs', 'inventory-drop.mjs', 'inventory-presentation.mjs', 'identify-scroll.mjs', 'warden.mjs', 'mobile-controls.mjs', 'fullscreen.mjs'];
let failed = 0;
for (const s of scripts) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [fileURLToPath(new URL(`./${s}`, import.meta.url))], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} 個腳本失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
