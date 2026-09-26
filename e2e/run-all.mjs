// 依序執行瀏覽器端腳本（需要先啟動 npm run dev 或 npm run preview，並設定 BASE_URL）。
import { spawnSync } from 'node:child_process';

const scripts = ['browser.mjs', 'airburst.mjs', 'retry.mjs', 'classes.mjs', 'floors.mjs'];
let failed = 0;
for (const s of scripts) {
  console.log(`\n=== ${s} ===`);
  const r = spawnSync(process.execPath, [new URL(`./${s}`, import.meta.url).pathname], { stdio: 'inherit', env: process.env });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} 個腳本失敗` : '\n全部通過');
process.exit(failed ? 1 : 0);
