import type { Role } from './rooms';

// 手工拓撲模板：房間放在 4×3 的格位上，相鄰格位之間以通道相連。
// 種子決定使用哪個模板、是否鏡像、每個房間的佈局與內容。

export type EdgeType = 'door' | 'open' | 'oneway';

export interface TemplateRoom {
  key: string;
  col: number;
  row: number;
  role: Role;
  tier: number;
  /** 可選支線（不在主線上） */
  optional?: boolean;
  /** 固定佈局（練習用） */
  layout?: string;
}

export interface TemplateEdge {
  a: string;
  b: string;
  type: EdgeType;
  /** oneway：可以拉開門閂的一側（房間 key）。 */
  barFrom?: string;
}

export interface Template {
  id: 'A' | 'B' | 'practice';
  name: string;
  cols: number;
  rows: number;
  rooms: TemplateRoom[];
  edges: TemplateEdge[];
}

/**
 * A「環形中庭」：入口 → 前廳分出南北兩條路，在沉眠之心處會合（可繞行的環）。
 *   [Al]-[N1]-[N2]
 *         |    |
 *   [E ]-[R1] [H ]
 *         |    |
 *        [S1]-[S2]-[Ch]
 */
export const TEMPLATE_A: Template = {
  id: 'A',
  name: '環形中庭',
  cols: 4,
  rows: 3,
  rooms: [
    { key: 'E', col: 0, row: 1, role: 'entrance', tier: 0 },
    { key: 'R1', col: 1, row: 1, role: 'combat', tier: 1 },
    { key: 'N1', col: 1, row: 0, role: 'combat', tier: 2 },
    { key: 'N2', col: 2, row: 0, role: 'combat', tier: 3 },
    { key: 'S1', col: 1, row: 2, role: 'combat', tier: 2 },
    { key: 'S2', col: 2, row: 2, role: 'combat', tier: 3 },
    { key: 'H', col: 2, row: 1, role: 'heart', tier: 4 },
    { key: 'Al', col: 0, row: 0, role: 'altar', tier: 2, optional: true },
    { key: 'Ch', col: 3, row: 2, role: 'treasure', tier: 4, optional: true },
  ],
  edges: [
    { a: 'E', b: 'R1', type: 'door' },
    { a: 'R1', b: 'N1', type: 'door' },
    { a: 'N1', b: 'N2', type: 'open' },
    { a: 'N2', b: 'H', type: 'door' },
    { a: 'R1', b: 'S1', type: 'door' },
    { a: 'S1', b: 'S2', type: 'open' },
    { a: 'S2', b: 'H', type: 'door' },
    { a: 'N1', b: 'Al', type: 'door' },
    { a: 'S2', b: 'Ch', type: 'door' },
  ],
};

/**
 * B「分岔長廊」：一條主線蜿蜒到深處，北側是危險支線；
 * 沉眠之心旁的閂門小室可從內側拉開門閂，成為回程捷徑。
 *        [D1]-[D2]
 *         |
 *   [E ]-[R1]-[R2]-[R3]
 *         ‖         |
 *        [SC]-[H ]-[R4]
 */
export const TEMPLATE_B: Template = {
  id: 'B',
  name: '分岔長廊',
  cols: 4,
  rows: 3,
  rooms: [
    { key: 'E', col: 0, row: 1, role: 'entrance', tier: 0 },
    { key: 'R1', col: 1, row: 1, role: 'combat', tier: 1 },
    { key: 'R2', col: 2, row: 1, role: 'altar', tier: 2 },
    { key: 'R3', col: 3, row: 1, role: 'combat', tier: 2 },
    { key: 'R4', col: 3, row: 2, role: 'combat', tier: 3 },
    { key: 'H', col: 2, row: 2, role: 'heart', tier: 4 },
    { key: 'SC', col: 1, row: 2, role: 'shortcut', tier: 2 },
    { key: 'D1', col: 1, row: 0, role: 'combat', tier: 3, optional: true },
    { key: 'D2', col: 2, row: 0, role: 'treasure', tier: 4, optional: true },
  ],
  edges: [
    { a: 'E', b: 'R1', type: 'door' },
    { a: 'R1', b: 'R2', type: 'door' },
    { a: 'R2', b: 'R3', type: 'open' },
    { a: 'R3', b: 'R4', type: 'door' },
    { a: 'R4', b: 'H', type: 'door' },
    { a: 'H', b: 'SC', type: 'door' },
    { a: 'SC', b: 'R1', type: 'oneway', barFrom: 'SC' },
    { a: 'R1', b: 'D1', type: 'door' },
    { a: 'D1', b: 'D2', type: 'door' },
  ],
};

export const TEMPLATE_PRACTICE: Template = {
  id: 'practice',
  name: '練習場',
  cols: 2,
  rows: 1,
  rooms: [
    { key: 'P1', col: 0, row: 0, role: 'practice', tier: 1, layout: 'practice-yard' },
    { key: 'P2', col: 1, row: 0, role: 'practice', tier: 1, layout: 'practice-range' },
  ],
  edges: [{ a: 'P1', b: 'P2', type: 'door' }],
};

export const RUN_TEMPLATES: Template[] = [TEMPLATE_A, TEMPLATE_B];
