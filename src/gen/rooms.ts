// 手工設計的房間遭遇佈局。每個佈局的四邊中央兩格保留給門／通道。
//
// 圖例：
//   #  牆            .  地板          o  石柱          =  矮牆（1.0 m）
//   P  高台（1.3 m） ^  尖刺踏板      s  補給點        C  寶箱
//   A  刻印祭壇      H  沉眠之心台座  X  出口階梯      @  出生點
//   R  補給台（練習） 1-9  敵人（見 enemies）          a-h  巡邏點

export type Face = 'N' | 'S' | 'E' | 'W';
export type EnemyKind = 'guard' | 'archer' | 'charger';
export type Role = 'entrance' | 'combat' | 'altar' | 'treasure' | 'heart' | 'shortcut' | 'practice';

export interface EnemyDef {
  m: string;
  kind: EnemyKind;
  state: 'sleep' | 'idle' | 'patrol';
  face: Face;
  /** 房間難度層級 ≥ tier 才會出現。 */
  tier: number;
  patrol?: string;
  perched?: boolean;
}

export interface RoomLayout {
  id: string;
  name: string;
  role: Role;
  rows: string[];
  enemies: EnemyDef[];
  spawnFace?: Face;
}

export const LAYOUTS: RoomLayout[] = [
  {
    id: 'entrance',
    name: '入口石階',
    role: 'entrance',
    spawnFace: 'E',
    rows: [
      '############',
      '#..........#',
      '#.o......o.#',
      '#..........#',
      '#XXX.......#',
      '#XXX..@....#',
      '#XXX.......#',
      '#..........#',
      '#.s........#',
      '#.o......o.#',
      '#..........#',
      '############',
    ],
    enemies: [],
  },
  {
    id: 'pillars',
    name: '柱廳',
    role: 'combat',
    rows: [
      '################',
      '#..............#',
      '#..o..o..o..o..#',
      '#..........a...#',
      '#......1.......#',
      '#..o..o..o..o..#',
      '#..............#',
      '#..............#',
      '#..o..o..o..o..#',
      '#...2..........#',
      '#...b.......s..#',
      '#..o..o..o..o..#',
      '#.............3#',
      '################',
    ],
    enemies: [
      { m: '1', kind: 'guard', state: 'patrol', face: 'S', tier: 1, patrol: 'ab' },
      { m: '2', kind: 'guard', state: 'sleep', face: 'E', tier: 2 },
      { m: '3', kind: 'archer', state: 'idle', face: 'W', tier: 3 },
    ],
  },
  {
    id: 'barracks',
    name: '守衛室',
    role: 'combat',
    rows: [
      '##############',
      '#............#',
      '#.1..........#',
      '#.====...===.#',
      '#....2.....3.#',
      '#............#',
      '#............#',
      '#.4..........#',
      '#.===....====#',
      '#..........s.#',
      '#............#',
      '##############',
    ],
    enemies: [
      { m: '1', kind: 'guard', state: 'sleep', face: 'S', tier: 1 },
      { m: '2', kind: 'guard', state: 'sleep', face: 'N', tier: 1 },
      { m: '3', kind: 'guard', state: 'sleep', face: 'W', tier: 2 },
      { m: '4', kind: 'archer', state: 'sleep', face: 'E', tier: 3 },
    ],
  },
  {
    id: 'range',
    name: '矮牆射擊廳',
    role: 'combat',
    rows: [
      '################',
      '#..............#',
      '#.PP........PP.#',
      '#.P1........P4.#',
      '#.........2....#',
      '#...===..===...#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#..===....===..#',
      '#......3.......#',
      '#..............#',
      '#.=====..=====.#',
      '#..............#',
      '#......s.......#',
      '################',
    ],
    enemies: [
      { m: '3', kind: 'guard', state: 'idle', face: 'S', tier: 1 },
      { m: '2', kind: 'archer', state: 'idle', face: 'S', tier: 2 },
      { m: '1', kind: 'archer', state: 'idle', face: 'S', tier: 3, perched: true },
      { m: '4', kind: 'archer', state: 'idle', face: 'S', tier: 4, perched: true },
    ],
  },
  {
    id: 'traps',
    name: '陷阱走廊',
    role: 'combat',
    rows: [
      '############',
      '#........3.#',
      '#..^....^..#',
      '#....1.....#',
      '#.^......^.#',
      '#..........#',
      '#...^..^...#',
      '#..........#',
      '#..........#',
      '#...^..^...#',
      '#..........#',
      '#.^......^.#',
      '#.....2....#',
      '#..^....^..#',
      '#......s...#',
      '############',
    ],
    enemies: [
      { m: '1', kind: 'guard', state: 'idle', face: 'S', tier: 1 },
      { m: '2', kind: 'charger', state: 'idle', face: 'N', tier: 2 },
      { m: '3', kind: 'archer', state: 'sleep', face: 'S', tier: 3 },
    ],
  },
  {
    id: 'cistern',
    name: '蓄水十字廳',
    role: 'combat',
    rows: [
      '##############',
      '#............#',
      '#.1..........#',
      '#...o....o...#',
      '#............#',
      '#.....==.....#',
      '#....====..2.#',
      '#....====....#',
      '#.....==.....#',
      '#............#',
      '#...o....o...#',
      '#..........3.#',
      '#.s..........#',
      '##############',
    ],
    enemies: [
      { m: '1', kind: 'guard', state: 'sleep', face: 'S', tier: 1 },
      { m: '2', kind: 'archer', state: 'idle', face: 'W', tier: 2 },
      { m: '3', kind: 'charger', state: 'idle', face: 'N', tier: 3 },
    ],
  },
  {
    id: 'altar-apse',
    name: '祭壇間',
    role: 'altar',
    rows: [
      '############',
      '#.A........#',
      '#..........#',
      '#.o......o.#',
      '#..........#',
      '#....1.....#',
      '#..........#',
      '#..........#',
      '#.o......o.#',
      '#.......2..#',
      '#.s........#',
      '############',
    ],
    enemies: [
      { m: '1', kind: 'guard', state: 'sleep', face: 'N', tier: 1 },
      { m: '2', kind: 'archer', state: 'sleep', face: 'N', tier: 3 },
    ],
  },
  {
    id: 'altar-rotunda',
    name: '圓柱祭堂',
    role: 'altar',
    rows: [
      '##############',
      '#............#',
      '#.o...a....o.#',
      '#............#',
      '#....o..o....#',
      '#............#',
      '#.....A......#',
      '#............#',
      '#............#',
      '#....o..o....#',
      '#.1..........#',
      '#......b...2.#',
      '#.o.....s..o.#',
      '##############',
    ],
    enemies: [
      { m: '1', kind: 'guard', state: 'patrol', face: 'N', tier: 1, patrol: 'ab' },
      { m: '2', kind: 'archer', state: 'idle', face: 'N', tier: 2 },
    ],
  },
  {
    id: 'vault',
    name: '寶庫',
    role: 'treasure',
    rows: [
      '##############',
      '#C..........A#',
      '#............#',
      '#..=......=..#',
      '#..=..1...=..#',
      '#..=......=..#',
      '#............#',
      '#............#',
      '#.2........3.#',
      '#..o......o..#',
      '#............#',
      '#.....s......#',
      '#............#',
      '##############',
    ],
    enemies: [
      { m: '1', kind: 'charger', state: 'idle', face: 'S', tier: 1 },
      { m: '2', kind: 'guard', state: 'sleep', face: 'E', tier: 1 },
      { m: '3', kind: 'archer', state: 'idle', face: 'W', tier: 1 },
    ],
  },
  {
    id: 'vault-gallery',
    name: '高台寶庫',
    role: 'treasure',
    rows: [
      '################',
      '#PP..........PP#',
      '#P1..........2P#',
      '#..............#',
      '#....C....A....#',
      '#..............#',
      '#..............#',
      '#..===....===..#',
      '#......3.......#',
      '#..............#',
      '#.s..........s.#',
      '################',
    ],
    enemies: [
      { m: '1', kind: 'archer', state: 'idle', face: 'S', tier: 1, perched: true },
      { m: '2', kind: 'archer', state: 'sleep', face: 'S', tier: 1, perched: true },
      { m: '3', kind: 'charger', state: 'idle', face: 'N', tier: 1 },
    ],
  },
  {
    id: 'sanctum',
    name: '沉眠聖所',
    role: 'heart',
    rows: [
      '################',
      '#PP..........PP#',
      '#P3..........4P#',
      '#..............#',
      '#....o....o....#',
      '#..............#',
      '#.......1......#',
      '#......H.......#',
      '#..............#',
      '#......2.......#',
      '#..............#',
      '#....o....o....#',
      '#..............#',
      '#..s........s..#',
      '#..............#',
      '################',
    ],
    enemies: [
      { m: '1', kind: 'guard', state: 'sleep', face: 'N', tier: 1 },
      { m: '2', kind: 'guard', state: 'sleep', face: 'S', tier: 1 },
      { m: '3', kind: 'archer', state: 'sleep', face: 'S', tier: 1, perched: true },
      { m: '4', kind: 'archer', state: 'sleep', face: 'S', tier: 1, perched: true },
    ],
  },
  {
    id: 'crypt',
    name: '沉眠墓室',
    role: 'heart',
    rows: [
      '##############',
      '#............#',
      '#.==......==.#',
      '#.....1......#',
      '#.==......==.#',
      '#............#',
      '#......H.....#',
      '#............#',
      '#.==......==.#',
      '#...2........#',
      '#.==......==.#',
      '#.........3..#',
      '#............#',
      '##############',
    ],
    enemies: [
      { m: '1', kind: 'charger', state: 'sleep', face: 'S', tier: 1 },
      { m: '2', kind: 'guard', state: 'sleep', face: 'E', tier: 1 },
      { m: '3', kind: 'archer', state: 'sleep', face: 'N', tier: 1 },
    ],
  },
  {
    id: 'bolt-room',
    name: '閂門小室',
    role: 'shortcut',
    rows: [
      '##########',
      '#........#',
      '#.o....o.#',
      '#........#',
      '#...1....#',
      '#........#',
      '#........#',
      '#.o....o.#',
      '#..s.....#',
      '##########',
    ],
    enemies: [{ m: '1', kind: 'guard', state: 'sleep', face: 'W', tier: 1 }],
  },
  {
    id: 'practice-yard',
    name: '練習場',
    role: 'practice',
    spawnFace: 'N',
    rows: [
      '################',
      '#..............#',
      '#.R............#',
      '#..............#',
      '#.....1........#',
      '#..............#',
      '#..............#',
      '#.@............#',
      '#..............#',
      '#..............#',
      '#....===.......#',
      '#..............#',
      '#.......2......#',
      '#..............#',
      '#..............#',
      '################',
    ],
    enemies: [
      { m: '1', kind: 'guard', state: 'sleep', face: 'N', tier: 1 },
      { m: '2', kind: 'guard', state: 'idle', face: 'E', tier: 1 },
    ],
  },
  {
    id: 'practice-range',
    name: '練習射擊場',
    role: 'practice',
    rows: [
      '################',
      '#..............#',
      '#..........PP..#',
      '#..........P1..#',
      '#..............#',
      '#..====..====..#',
      '#..............#',
      '#..............#',
      '#..............#',
      '#...^......^...#',
      '#..............#',
      '#......2.......#',
      '#..............#',
      '#..o...o...o...#',
      '#..............#',
      '################',
    ],
    enemies: [
      { m: '1', kind: 'archer', state: 'idle', face: 'S', tier: 1, perched: true },
      { m: '2', kind: 'charger', state: 'idle', face: 'W', tier: 1 },
    ],
  },
];

export function layoutsByRole(role: Role): RoomLayout[] {
  return LAYOUTS.filter((l) => l.role === role);
}

export function layoutById(id: string): RoomLayout {
  const l = LAYOUTS.find((x) => x.id === id);
  if (!l) throw new Error(`unknown layout ${id}`);
  return l;
}
