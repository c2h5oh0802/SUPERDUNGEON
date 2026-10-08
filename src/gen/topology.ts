import type { Rng } from '../core/rng';
import type { Template, TemplateEdge, TemplateRoom } from './templates';

// 程序化樓層結構（生成版本 2）：在格位上隨機長出房間樹，加上迴圈、單向捷徑與分岔死路的特殊房。
// 只產生既有的 Template 結構（格位、角色、層級、邊），房間的蓋印與通道沿用 generator 的做法。

/** 特殊房：都放在分岔死路，不在往下的主線上。 */
export type SpecialKind = 'embers' | 'sentries' | 'vault' | 'gauntlet' | 'stash' | 'guarded' | 'statue';

export interface TopologyConfig {
  cols: number;
  rows: number;
  /** 主線房間數（含入口與出口）。 */
  mainRooms: number;
  /** 入口到出口至少隔幾個房間。 */
  minExitDepth: number;
  loops: number;
  /** 其中一條迴圈改成從深處才能拉開的單向捷徑。 */
  shortcut: boolean;
  specials: SpecialKind[];
}

export interface GenTemplate extends Template {
  /** 特殊房的種類（房間 key → 種類）。 */
  specials: Map<string, SpecialKind>;
  /** 入口到每個房間的距離（房間數）。 */
  depth: Map<string, number>;
}

interface Node {
  key: string;
  col: number;
  row: number;
  depth: number;
}

const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** 長出一棵主線房間樹；失敗（太短或擠不下）就回傳 null，由呼叫端重試。 */
function growMain(rng: Rng, cfg: TopologyConfig): { nodes: Node[]; edges: Array<[string, string]> } | null {
  const { cols, rows } = cfg;
  const at = new Map<string, Node>();
  const id = (c: number, r: number) => `${c},${r}`;
  const border: Array<[number, number]> = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) border.push([c, r]);
  const [ec, er] = rng.pick(border);
  const entrance: Node = { key: 'E', col: ec, row: er, depth: 0 };
  const nodes: Node[] = [entrance];
  at.set(id(ec, er), entrance);
  const edges: Array<[string, string]> = [];
  let guard = 0;
  while (nodes.length < cfg.mainRooms && guard++ < 400) {
    // 偏好從較深的房間往外長，讓主線夠長；入口只接一個房間。
    const parents = nodes.filter((n) => !(n === entrance && nodes.length > 1));
    const weights = parents.map((n) => Math.pow(1 + n.depth, 1.3));
    let roll = rng.next() * weights.reduce((a, b) => a + b, 0);
    let parent = parents[0]!;
    for (let k = 0; k < parents.length; k++) {
      roll -= weights[k]!;
      if (roll <= 0) {
        parent = parents[k]!;
        break;
      }
    }
    const free = DIRS.map(([dc, dr]) => [parent.col + dc, parent.row + dr] as [number, number])
      .filter(([c, r]) => c >= 0 && r >= 0 && c < cols && r < rows && !at.has(id(c, r)));
    if (!free.length) continue;
    const [c, r] = rng.pick(free);
    const node: Node = { key: `R${nodes.length}`, col: c, row: r, depth: parent.depth + 1 };
    nodes.push(node);
    at.set(id(c, r), node);
    edges.push([parent.key, node.key]);
  }
  if (nodes.length < cfg.mainRooms) return null;
  const maxDepth = Math.max(...nodes.map((n) => n.depth));
  if (maxDepth < cfg.minExitDepth) return null;
  return { nodes, edges };
}

const adjacent = (a: { col: number; row: number }, b: { col: number; row: number }) =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;

/** 依設定產生一層的結構。同一個 rng 狀態結果固定。 */
export function buildTopology(rng: Rng, cfg: TopologyConfig): GenTemplate {
  for (let attempt = 0; attempt < 60; attempt++) {
    const grown = growMain(rng, cfg);
    if (!grown) continue;
    const { nodes, edges } = grown;
    const byKey = new Map(nodes.map((n) => [n.key, n]));
    const maxDepth = Math.max(...nodes.map((n) => n.depth));
    const deepest = nodes.filter((n) => n.depth === maxDepth);
    const exit = rng.pick(deepest);
    const linked = new Set(edges.map(([a, b]) => [a, b].sort().join('|')));
    const tEdges: TemplateEdge[] = edges.map(([a, b]) => ({ a, b, type: rng.chance(0.35) ? 'open' : 'door' }));

    // 迴圈：連起兩個相鄰、還沒連通的主線房間（不含入口）；深度差越大越像捷徑。
    const pairs: Array<[Node, Node]> = [];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i]!;
      const b = nodes[j]!;
      if (a.key === 'E' || b.key === 'E' || !adjacent(a, b) || linked.has([a.key, b.key].sort().join('|'))) continue;
      pairs.push([a, b]);
    }
    rng.shuffle(pairs);
    pairs.sort((p, q) => Math.abs(q[0].depth - q[1].depth) - Math.abs(p[0].depth - p[1].depth));
    let shortcutUsed = !cfg.shortcut;
    for (const [a, b] of pairs.slice(0, cfg.loops)) {
      const gap = Math.abs(a.depth - b.depth);
      if (!shortcutUsed && gap >= 2) {
        const deep = a.depth > b.depth ? a : b;
        tEdges.push({ a: a.key, b: b.key, type: 'oneway', barFrom: deep.key });
        shortcutUsed = true;
      } else tEdges.push({ a: a.key, b: b.key, type: 'door' });
      linked.add([a.key, b.key].sort().join('|'));
    }

    // 特殊房：接在非入口、非出口的主線房間旁邊的空格位，各只有一條通道。
    const taken = new Set(nodes.map((n) => `${n.col},${n.row}`));
    const specials = new Map<string, SpecialKind>();
    const specialNodes: Array<Node & { kind: SpecialKind; parent: string }> = [];
    let ok = true;
    for (const kind of cfg.specials) {
      const options: Array<{ parent: Node; col: number; row: number }> = [];
      for (const n of nodes) {
        if (n.key === 'E' || n === exit) continue;
        for (const [dc, dr] of DIRS) {
          const c = n.col + dc;
          const r = n.row + dr;
          if (c < 0 || r < 0 || c >= cfg.cols || r >= cfg.rows || taken.has(`${c},${r}`)) continue;
          options.push({ parent: n, col: c, row: r });
        }
      }
      if (!options.length) {
        ok = false;
        break;
      }
      // 上鎖寶庫偏好接在較深的房間；其他特殊房平均分布。
      const deep = options.filter((o) => o.parent.depth >= Math.ceil(maxDepth / 2));
      const pick = rng.pick(kind === 'vault' && deep.length ? deep : options);
      const key = `S${specialNodes.length + 1}`;
      const node = { key, col: pick.col, row: pick.row, depth: pick.parent.depth + 1, kind, parent: pick.parent.key };
      specialNodes.push(node);
      specials.set(key, kind);
      taken.add(`${pick.col},${pick.row}`);
      const type: TemplateEdge['type'] = kind === 'vault' ? 'locked' : kind === 'stash' ? 'secret' : 'door';
      tEdges.push({ a: pick.parent.key, b: key, type, doorOn: kind === 'stash' ? pick.parent.key : key });
    }
    if (!ok) continue;

    // 層級：入口 0；主線依深度 1–3；出口 4；特殊房比相接的房間深一級。
    const tierOf = (n: Node) => (n.key === 'E' ? 0 : n === exit ? 4 : Math.min(3, 1 + Math.floor((3 * (n.depth - 1)) / Math.max(1, maxDepth - 1))));
    // 房間順序：依深度排列，讓「第一個探索房」緊鄰入口、最後一個最深。
    const ordered = nodes.slice().sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key, 'en'));
    const rooms: TemplateRoom[] = ordered.map((n) => ({
      key: n.key,
      col: n.col,
      row: n.row,
      role: n.key === 'E' ? 'entrance' : n === exit ? 'heart' : 'combat',
      tier: tierOf(n),
    }));
    for (const s of specialNodes) {
      const parentTier = tierOf(byKey.get(s.parent)!);
      rooms.push({ key: s.key, col: s.col, row: s.row, role: s.kind === 'guarded' || s.kind === 'sentries' || s.kind === 'vault' || s.kind === 'statue' ? 'treasure' : 'combat', tier: Math.min(4, parentTier + 1), optional: true });
    }
    const depth = new Map<string, number>([...nodes, ...specialNodes].map((n) => [n.key, n.depth]));
    return { id: 'gen', name: '地城深處', cols: cfg.cols, rows: cfg.rows, rooms, edges: tEdges, specials, depth };
  }
  throw new Error('無法產生樓層結構');
}
