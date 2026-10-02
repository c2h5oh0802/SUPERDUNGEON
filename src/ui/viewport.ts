/** Match the canvas and overlays to the visible area, including browser chrome.
 * Keep normal browser zoom behavior: don't shrink the game again while pinching.
 */
export function gameViewport(win: Pick<Window, 'innerWidth' | 'innerHeight' | 'visualViewport'>, touch: boolean) {
  const vv = touch ? win.visualViewport : null;
  const visual = vv && Math.abs(vv.scale - 1) < 0.01 && vv.width > 0 && vv.height > 0;
  return {
    width: Math.max(1, visual ? Math.min(win.innerWidth, vv.width) : win.innerWidth),
    height: Math.max(1, visual ? Math.min(win.innerHeight, vv.height) : win.innerHeight),
    left: visual ? Math.max(0, vv.offsetLeft) : 0,
    top: visual ? Math.max(0, vv.offsetTop) : 0,
  };
}
