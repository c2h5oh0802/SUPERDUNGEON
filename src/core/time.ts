import { TIME } from '../config';

export interface TimeDemand {
  /** 本幀真實時間（已夾限）。 */
  realDt: number;
  /** 本幀碰撞後的實際水平位移。 */
  moveDist: number;
  /** 進行中行動剩餘的世界時間（沒有行動時為 0）。 */
  actionRemaining: number;
  /** 是否按住等待。 */
  waitHeld: boolean;
}

export interface TimeRules {
  idleRate: number;
  refMoveSpeed: number;
}

export const DEFAULT_TIME_RULES: TimeRules = {
  idleRate: TIME.idleRate,
  refMoveSpeed: TIME.refMoveSpeed,
};

/**
 * 單一時間規則：各需求取最大值、不加總，且永遠不超過正常速度。
 * - 閒置：idleRate × realDt（慢動作基礎流逝）
 * - 移動：實際位移 ÷ 參考移速（轉頭、頂牆沒有位移就沒有成本）
 * - 行動：以正常速度播放剩餘的行動時間
 * - 等待：正常速度
 */
export function computeWorldDt(d: TimeDemand, rules: TimeRules = DEFAULT_TIME_RULES): number {
  const realDt = Math.max(0, d.realDt);
  const idle = rules.idleRate * realDt;
  const move = d.moveDist / rules.refMoveSpeed;
  const action = d.actionRemaining > 0 ? Math.min(realDt, d.actionRemaining) : 0;
  const wait = d.waitHeld ? realDt : 0;
  return Math.min(Math.max(idle, move, action, wait), realDt);
}

export function clampRealDt(frameDelta: number): number {
  if (!Number.isFinite(frameDelta) || frameDelta <= 0) return 0;
  return Math.min(frameDelta, TIME.maxRealDt);
}

/** 將 worldDt 切成不超過 maxSubstep 的等長子步。 */
export function substeps(worldDt: number, maxStep: number = TIME.maxSubstep): { n: number; dt: number } {
  if (worldDt <= 0) return { n: 0, dt: 0 };
  const n = Math.max(1, Math.ceil(worldDt / maxStep - 1e-9));
  return { n, dt: worldDt / n };
}
