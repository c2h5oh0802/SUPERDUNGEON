export type FailureStage = 'startup' | 'loading' | 'runtime';
const messages: Record<FailureStage, [string, string]> = {
  startup: ['遊戲未能啟動', '遊戲程式或 WebGL 2 未能載入。請重新載入；若仍失敗，請使用支援 WebGL 2 的瀏覽器並確認硬體加速可用。'],
  loading: ['地城載入失敗', '這次地城未能建立，遊戲尚未開始。請重新載入再試一次。'],
  runtime: ['遊戲發生錯誤', '遊玩因技術問題中斷，並非正常死亡或完成。請重新載入再試一次。'],
};
/** Owned game errors only: an optional analytics failure must never open this screen. */
export function showGameFailure(stage: FailureStage): void {
  for (const el of document.querySelectorAll('.screen, #hud, #touch-controls, #touch-rotate')) el.classList.add('hidden');
  document.body.classList.remove('booting');
  document.getElementById('boot-status')?.remove();
  const screen = document.getElementById('screen-error');
  if (!screen) return;
  const title = document.getElementById('error-title');
  const detail = document.getElementById('error-detail');
  if (title) title.textContent = messages[stage][0];
  if (detail) detail.textContent = messages[stage][1];
  screen.dataset.failureStage = stage;
  screen.classList.remove('hidden');
  document.getElementById('error-reload')?.focus();
}
