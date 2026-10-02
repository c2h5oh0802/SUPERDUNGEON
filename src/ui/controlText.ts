/** Display-only substitutions; world targets, action timing, and saved data stay unchanged. */
export function controlText(text: string, touch: boolean): string {
  if (!touch) return text;
  return text
    .replace(/^E /, '互動：')
    .replaceAll('按 I 打開背包', '點「背包」')
    .replaceAll('按住 Shift 潛行步', '開啟「潛行」')
    .replaceAll('Shift 安靜慢走', '潛行可安靜慢走')
    .replaceAll('再按 3 切換', '再點藥劑箭切換')
    .replaceAll('就左鍵', '就點「射擊」')
    .replaceAll('右鍵或 F', '點「推擊」')
    .replaceAll('1 換劍', '點近戰武器')
    .replaceAll('按 E ', '點「互動」')
    .replaceAll('[E]', '互動')
    .replaceAll('（E）', '（互動）')
    .replaceAll('Esc', '暫停選單')
    .replaceAll('Tab', '地圖');
}
