import { ALL_RUNES, WORLD, type RuneId } from '../config';
import type { V2 } from '../core/math';
import { Rng } from '../core/rng';
import { Grid, T, type DoorState, type TileId } from '../sim/grid';
import { layoutById, layoutsByRole, type EnemyKind, type Face, type RoomLayout } from './rooms';
import { RUN_TEMPLATES, TEMPLATE_PRACTICE, type Template, type TemplateRoom } from './templates';

export interface EnemySpawn {
  kind: EnemyKind;
  x: number;
  z: number;
  y: number;
  yaw: number;
  state: 'sleep' | 'idle' | 'patrol';
  patrol: V2[];
  perched: boolean;
  roomKey: string;
}

/**
 * 地上的物資。生成只放中性的「彈藥袋」（ammo），撿到時依職業變成一般箭或投擲石，
 * 所以同一個種子兩個職業的關卡完全相同。arrows／stone 是射出去之後可以撿回的箭與石頭。
 */
export type PickupKind = 'ammo' | 'arrows' | 'stone' | 'bottle' | 'potion';

export interface PickupSpawn {
  kind: PickupKind;
  amount: number;
  x: number;
  z: number;
}

export interface PropSpawn {
  x: number;
  z: number;
  yaw: number;
  roomKey: string;
}

export interface ChestSpawn extends PropSpawn {
  contents: { ammo: number; bottles: number; potions: number };
}

export interface AltarSpawn extends PropSpawn {
  offer: [RuneId, RuneId];
}

export interface TorchSpawn {
  x: number;
  y: number;
  z: number;
  nx: number;
  nz: number;
}

export interface StairsSpawn {
  i0: number;
  j0: number;
  i1: number;
  j1: number;
  /** 階梯往上的方向 */
  rise: V2;
  /** 互動點（階梯前方） */
  front: V2;
}

export interface RoomInst {
  key: string;
  role: TemplateRoom['role'];
  tier: number;
  optional: boolean;
  layoutId: string;
  name: string;
  x0: number;
  z0: number;
  w: number;
  h: number;
}

export interface LevelData {
  seed: string;
  templateId: Template['id'];
  templateName: string;
  mirrored: boolean;
  attempt: number;
  grid: Grid;
  spawn: { x: number; z: number; yaw: number };
  rooms: RoomInst[];
  enemies: EnemySpawn[];
  pickups: PickupSpawn[];
  chests: ChestSpawn[];
  altars: AltarSpawn[];
  heart: PropSpawn | null;
  stairs: StairsSpawn | null;
  resupply: PropSpawn | null;
  traps: Array<{ i: number; j: number }>;
  torches: TorchSpawn[];
  practice: boolean;
}

const FACE_YAW: Record<Face, number> = { N: 0, S: Math.PI, E: -Math.PI / 2, W: Math.PI / 2 };

export const PILLAR_R = 0.42;
export const PROP_SIZES = {
  chest: { r: 0.5, h: 0.9 },
  altar: { r: 0.5, h: 1.1 },
  heart: { r: 0.55, h: 1.25 },
  resupply: { r: 0.5, h: 1.0 },
} as const;

interface DoorDraft {
  cells: Array<[number, number]>;
  axis: 'x' | 'z';
  arch: boolean;
  barred: boolean;
  barSide: -1 | 1;
}

interface Draft {
  w: number;
  h: number;
  tiles: TileId[];
  pillars: Array<{ x: number; z: number; r: number; h: number; kind: 'pillar' | 'prop' }>;
  doors: DoorDraft[];
  rooms: RoomInst[];
  enemies: EnemySpawn[];
  pickupSpots: Array<{ x: number; z: number }>;
  chests: ChestSpawn[];
  altars: AltarSpawn[];
  heart: PropSpawn | null;
  stairs: StairsSpawn | null;
  resupply: PropSpawn | null;
  traps: Array<{ i: number; j: number }>;
  torches: TorchSpawn[];
  spawn: { x: number; z: number; yaw: number } | null;
}

function roomOrigin(_t: Template, r: TemplateRoom, layout: RoomLayout): { x0: number; z0: number } {
  const S = WORLD.slotSize;
  const W = layout.rows[0]!.length;
  const H = layout.rows.length;
  return { x0: 1 + r.col * S + (S - W) / 2, z0: 1 + r.row * S + (S - H) / 2 };
}

function stampRoom(d: Draft, t: Template, tr: TemplateRoom, layout: RoomLayout): void {
  const { x0, z0 } = roomOrigin(t, tr, layout);
  const W = layout.rows[0]!.length;
  const H = layout.rows.length;
  d.rooms.push({
    key: tr.key,
    role: tr.role,
    tier: tr.tier,
    optional: !!tr.optional,
    layoutId: layout.id,
    name: layout.name,
    x0,
    z0,
    w: W,
    h: H,
  });
  const markers = new Map<string, V2>();
  let stairsCells: Array<[number, number]> = [];
  for (let lj = 0; lj < H; lj++) {
    const row = layout.rows[lj]!;
    if (row.length !== W) throw new Error(`layout ${layout.id} row ${lj} width ${row.length} != ${W}`);
    for (let li = 0; li < W; li++) {
      const ch = row[li]!;
      const i = x0 + li;
      const j = z0 + lj;
      const cx = i + 0.5;
      const cz = j + 0.5;
      let tile: TileId = T.Floor;
      switch (ch) {
        case '#':
          tile = T.Wall;
          break;
        case '=':
          tile = T.Low;
          break;
        case 'P':
          tile = T.Platform;
          break;
        case 'X':
          tile = T.Stairs;
          stairsCells.push([i, j]);
          break;
        case 'o':
          d.pillars.push({ x: cx, z: cz, r: PILLAR_R, h: WORLD.wallHeight, kind: 'pillar' });
          break;
        case '^':
          d.traps.push({ i, j });
          break;
        case 's':
          d.pickupSpots.push({ x: cx, z: cz });
          break;
        case 'C':
          d.pillars.push({ x: cx, z: cz, ...PROP_SIZES.chest, kind: 'prop' });
          d.chests.push({
            x: cx,
            z: cz,
            yaw: faceInward(li, lj, W, H),
            roomKey: tr.key,
            contents: { ammo: 3, bottles: 1, potions: 1 },
          });
          break;
        case 'A':
          d.pillars.push({ x: cx, z: cz, ...PROP_SIZES.altar, kind: 'prop' });
          d.altars.push({ x: cx, z: cz, yaw: faceInward(li, lj, W, H), roomKey: tr.key, offer: ['pierce', 'vigor'] });
          break;
        case 'H':
          d.pillars.push({ x: cx, z: cz, ...PROP_SIZES.heart, kind: 'prop' });
          d.heart = { x: cx, z: cz, yaw: 0, roomKey: tr.key };
          break;
        case 'R':
          d.pillars.push({ x: cx, z: cz, ...PROP_SIZES.resupply, kind: 'prop' });
          d.resupply = { x: cx, z: cz, yaw: faceInward(li, lj, W, H), roomKey: tr.key };
          break;
        case '@':
          d.spawn = { x: cx, z: cz, yaw: FACE_YAW[layout.spawnFace ?? 'N'] };
          break;
        default:
          if (/[1-9a-h]/.test(ch)) markers.set(ch, { x: cx, z: cz });
          break;
      }
      d.tiles[j * d.w + i] = tile;
    }
  }
  if (stairsCells.length) {
    const is = stairsCells.map((c) => c[0]);
    const js = stairsCells.map((c) => c[1]);
    const i0 = Math.min(...is);
    const i1 = Math.max(...is);
    const j0 = Math.min(...js);
    const j1 = Math.max(...js);
    // 階梯朝向最近的房間外牆
    const roomCx = x0 + W / 2;
    const rise: V2 = (i0 + i1 + 1) / 2 < roomCx ? { x: -1, z: 0 } : { x: 1, z: 0 };
    const front: V2 = rise.x < 0 ? { x: i1 + 1.6, z: (j0 + j1 + 1) / 2 } : { x: i0 - 0.6, z: (j0 + j1 + 1) / 2 };
    d.stairs = { i0, j0, i1, j1, rise, front };
    stairsCells = [];
  }
  for (const e of layout.enemies) {
    if (e.tier > tr.tier) continue;
    const p = markers.get(e.m);
    if (!p) throw new Error(`layout ${layout.id} missing marker ${e.m}`);
    const perched = !!e.perched;
    if (perched) d.tiles[Math.floor(p.z) * d.w + Math.floor(p.x)] = T.Platform;
    const patrol: V2[] = [];
    if (e.patrol) {
      for (const ch of e.patrol) {
        const q = markers.get(ch);
        if (!q) throw new Error(`layout ${layout.id} missing patrol ${ch}`);
        patrol.push({ ...q });
      }
    }
    d.enemies.push({
      kind: e.kind,
      x: p.x,
      z: p.z,
      y: perched ? WORLD.platformHeight : 0,
      yaw: FACE_YAW[e.face],
      state: e.state,
      patrol,
      perched,
      roomKey: tr.key,
    });
  }
}

/** 物件面向房間中心最近的方向（靠牆的物件朝內）。 */
function faceInward(li: number, lj: number, W: number, H: number): number {
  const dx = li + 0.5 - W / 2;
  const dz = lj + 0.5 - H / 2;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? FACE_YAW.W : FACE_YAW.E;
  return dz > 0 ? FACE_YAW.N : FACE_YAW.S;
}

function connect(
  d: Draft,
  t: Template,
  a: TemplateRoom,
  b: TemplateRoom,
  la: RoomLayout,
  lb: RoomLayout,
  type: 'door' | 'open' | 'oneway',
  barFrom: string | undefined,
): void {
  const oa = roomOrigin(t, a, la);
  const ob = roomOrigin(t, b, lb);
  const Wa = la.rows[0]!.length;
  const Ha = la.rows.length;
  const Wb = lb.rows[0]!.length;
  const Hb = lb.rows.length;
  // 讓 a 在左／上
  let A = { o: oa, W: Wa, H: Ha, r: a };
  let B = { o: ob, W: Wb, H: Hb, r: b };
  if (b.col < a.col || b.row < a.row) [A, B] = [B, A];
  const doorOnB = B.r.tier >= A.r.tier; // 門放在較深的房間邊界
  if (A.r.row === B.r.row) {
    // 水平連接：門在東／西牆上，沿 z 軸
    const zc = A.o.z0 + A.H / 2 - 1;
    const ax = A.o.x0 + A.W - 1;
    const bx = B.o.x0;
    for (let x = ax + 1; x < bx; x++) {
      d.tiles[zc * d.w + x] = T.Floor;
      d.tiles[(zc + 1) * d.w + x] = T.Floor;
    }
    const doorX = doorOnB ? bx : ax;
    const archX = doorOnB ? ax : bx;
    const barSide: -1 | 1 = type === 'oneway' ? (barFrom === B.r.key ? 1 : -1) : 1;
    d.doors.push({ cells: [[doorX, zc], [doorX, zc + 1]], axis: 'z', arch: type === 'open', barred: type === 'oneway', barSide });
    d.doors.push({ cells: [[archX, zc], [archX, zc + 1]], axis: 'z', arch: true, barred: false, barSide: 1 });
    corridorTorch(d, ax + 1, bx - 1, zc, 'h');
  } else {
    const xc = A.o.x0 + A.W / 2 - 1;
    const az = A.o.z0 + A.H - 1;
    const bz = B.o.z0;
    for (let z = az + 1; z < bz; z++) {
      d.tiles[z * d.w + xc] = T.Floor;
      d.tiles[z * d.w + xc + 1] = T.Floor;
    }
    const doorZ = doorOnB ? bz : az;
    const archZ = doorOnB ? az : bz;
    const barSide: -1 | 1 = type === 'oneway' ? (barFrom === B.r.key ? 1 : -1) : 1;
    d.doors.push({ cells: [[xc, doorZ], [xc + 1, doorZ]], axis: 'x', arch: type === 'open', barred: type === 'oneway', barSide });
    d.doors.push({ cells: [[xc, archZ], [xc + 1, archZ]], axis: 'x', arch: true, barred: false, barSide: 1 });
    corridorTorch(d, az + 1, bz - 1, xc, 'v');
  }
}

function corridorTorch(d: Draft, from: number, to: number, lane: number, dir: 'h' | 'v'): void {
  const len = to - from + 1;
  if (len < 4) return;
  const mid = Math.floor((from + to) / 2);
  if (dir === 'h') d.torches.push({ x: mid + 0.5, y: 2.6, z: lane + 0.12, nx: 0, nz: 1 });
  else d.torches.push({ x: lane + 0.12, y: 2.6, z: mid + 0.5, nx: 1, nz: 0 });
}

function roomTorches(d: Draft, room: RoomInst, rng: Rng): void {
  const { x0, z0, w: W, h: H } = room;
  const isOpen = (i: number, j: number) => d.tiles[j * d.w + i] === T.Floor;
  const isWall = (i: number, j: number) => d.tiles[j * d.w + i] === T.Wall;
  const along = (n: number): number[] => {
    const a = Math.max(2, Math.floor(n / 2) - 4);
    const b = Math.min(n - 3, Math.ceil(n / 2) + 3);
    return a === b ? [a] : [a, b];
  };
  for (const li of along(W)) {
    // 北牆與南牆
    if (rng.chance(0.85) && isWall(x0 + li, z0) && isOpen(x0 + li, z0 + 1))
      d.torches.push({ x: x0 + li + 0.5, y: 2.7, z: z0 + 1.12, nx: 0, nz: 1 });
    if (rng.chance(0.85) && isWall(x0 + li, z0 + H - 1) && isOpen(x0 + li, z0 + H - 2))
      d.torches.push({ x: x0 + li + 0.5, y: 2.7, z: z0 + H - 1.12, nx: 0, nz: -1 });
  }
  for (const lj of along(H)) {
    if (rng.chance(0.85) && isWall(x0, z0 + lj) && isOpen(x0 + 1, z0 + lj))
      d.torches.push({ x: x0 + 1.12, y: 2.7, z: z0 + lj + 0.5, nx: 1, nz: 0 });
    if (rng.chance(0.85) && isWall(x0 + W - 1, z0 + lj) && isOpen(x0 + W - 2, z0 + lj))
      d.torches.push({ x: x0 + W - 1.12, y: 2.7, z: z0 + lj + 0.5, nx: -1, nz: 0 });
  }
}

function assignLayouts(t: Template, rng: Rng): Map<string, RoomLayout> {
  const out = new Map<string, RoomLayout>();
  const pools = new Map<string, RoomLayout[]>();
  for (const r of t.rooms) {
    if (r.layout) {
      out.set(r.key, layoutById(r.layout));
      continue;
    }
    let pool = pools.get(r.role);
    if (!pool || pool.length === 0) {
      pool = rng.shuffle(layoutsByRole(r.role).slice());
      pools.set(r.role, pool);
    }
    out.set(r.key, pool.pop()!);
  }
  return out;
}

function mirrorDraft(d: Draft): void {
  const W = d.w;
  const tiles = d.tiles.slice();
  for (let j = 0; j < d.h; j++) for (let i = 0; i < W; i++) d.tiles[j * W + i] = tiles[j * W + (W - 1 - i)]!;
  const mx = (x: number) => W - x;
  const mi = (i: number) => W - 1 - i;
  for (const p of d.pillars) p.x = mx(p.x);
  for (const door of d.doors) {
    door.cells = door.cells.map(([i, j]) => [mi(i), j] as [number, number]);
    if (door.axis === 'z') door.barSide = (door.barSide === 1 ? -1 : 1) as -1 | 1;
  }
  for (const r of d.rooms) r.x0 = W - (r.x0 + r.w);
  for (const e of d.enemies) {
    e.x = mx(e.x);
    e.yaw = -e.yaw;
    for (const p of e.patrol) p.x = mx(p.x);
  }
  for (const s of d.pickupSpots) s.x = mx(s.x);
  for (const c of d.chests) {
    c.x = mx(c.x);
    c.yaw = -c.yaw;
  }
  for (const a of d.altars) {
    a.x = mx(a.x);
    a.yaw = -a.yaw;
  }
  if (d.heart) d.heart.x = mx(d.heart.x);
  if (d.resupply) {
    d.resupply.x = mx(d.resupply.x);
    d.resupply.yaw = -d.resupply.yaw;
  }
  for (const t of d.traps) t.i = mi(t.i);
  for (const t of d.torches) {
    t.x = mx(t.x);
    t.nx = -t.nx;
  }
  if (d.spawn) {
    d.spawn.x = mx(d.spawn.x);
    d.spawn.yaw = -d.spawn.yaw;
  }
  if (d.stairs) {
    const s = d.stairs;
    const i0 = mi(s.i1);
    const i1 = mi(s.i0);
    s.i0 = i0;
    s.i1 = i1;
    s.rise = { x: -s.rise.x, z: s.rise.z };
    s.front = { x: mx(s.front.x), z: s.front.z };
  }
}

function fillWalls(d: Draft): void {
  const { w, h, tiles } = d;
  const isSpace = (t: TileId) => t !== T.Void && t !== T.Wall;
  const out = tiles.slice();
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      if (tiles[j * w + i] !== T.Void) continue;
      let near = false;
      for (let dj = -1; dj <= 1 && !near; dj++) {
        for (let di = -1; di <= 1; di++) {
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= w || nj >= h) continue;
          if (isSpace(tiles[nj * w + ni]!)) {
            near = true;
            break;
          }
        }
      }
      if (near) out[j * w + i] = T.Wall;
    }
  }
  d.tiles = out;
}

function placePickups(d: Draft, rng: Rng): PickupSpawn[] {
  const spots = rng.shuffle(d.pickupSpots.slice());
  const plan: Array<{ kind: PickupKind; amount: number }> = [
    { kind: 'potion', amount: 1 },
    { kind: 'ammo', amount: 3 },
    { kind: 'bottle', amount: 1 },
    { kind: 'ammo', amount: 3 },
    { kind: 'potion', amount: 1 },
    { kind: 'ammo', amount: 2 },
    { kind: 'bottle', amount: 1 },
    { kind: 'ammo', amount: 2 },
  ];
  const out: PickupSpawn[] = [];
  for (let k = 0; k < spots.length && k < plan.length; k++) {
    const s = spots[k]!;
    out.push({ ...plan[k]!, x: s.x, z: s.z });
  }
  return out;
}

export interface GenerateOptions {
  practice?: boolean;
  /** 強制模板（測試用） */
  template?: 'A' | 'B';
}

/** 單次嘗試（未驗證）。 */
export function buildLevel(seed: string, attempt: number, opts: GenerateOptions = {}): LevelData {
  const rng = new Rng(`${seed}#${attempt}`);
  let t: Template;
  if (opts.practice) t = TEMPLATE_PRACTICE;
  else if (opts.template) t = RUN_TEMPLATES.find((x) => x.id === opts.template)!;
  else t = rng.pick(RUN_TEMPLATES);
  const mirrored = opts.practice ? false : rng.chance(0.5);
  const S = WORLD.slotSize;
  const w = t.cols * S + 2;
  const h = t.rows * S + 2;
  const d: Draft = {
    w,
    h,
    tiles: new Array<TileId>(w * h).fill(T.Void),
    pillars: [],
    doors: [],
    rooms: [],
    enemies: [],
    pickupSpots: [],
    chests: [],
    altars: [],
    heart: null,
    stairs: null,
    resupply: null,
    traps: [],
    torches: [],
    spawn: null,
  };
  const layouts = assignLayouts(t, rng);
  for (const r of t.rooms) stampRoom(d, t, r, layouts.get(r.key)!);
  for (const e of t.edges) {
    const a = t.rooms.find((r) => r.key === e.a)!;
    const b = t.rooms.find((r) => r.key === e.b)!;
    connect(d, t, a, b, layouts.get(a.key)!, layouts.get(b.key)!, e.type, e.barFrom);
  }
  fillWalls(d);
  for (const room of d.rooms) roomTorches(d, room, rng);

  // 祭壇刻印配對：打亂四個刻印，依房間層級由淺到深分配兩組
  const runes = rng.shuffle(ALL_RUNES.slice());
  const tierOf = (key: string) => d.rooms.find((r) => r.key === key)!.tier;
  d.altars.sort((p, q) => tierOf(p.roomKey) - tierOf(q.roomKey));
  d.altars.forEach((a, k) => {
    a.offer = [runes[(k * 2) % 4]!, runes[(k * 2 + 1) % 4]!];
  });

  const pickups = opts.practice ? [] : placePickups(d, rng);
  if (mirrored) {
    mirrorDraft(d);
    for (const p of pickups) p.x = w - p.x;
  }

  const grid = new Grid(w, h);
  for (let k = 0; k < d.tiles.length; k++) grid.tiles[k] = d.tiles[k]!;
  for (const p of d.pillars) grid.addPillar(p);
  d.doors.forEach((dd, id) => {
    const cx = (dd.cells[0]![0] + dd.cells[1]![0]) / 2 + 0.5;
    const cz = (dd.cells[0]![1] + dd.cells[1]![1]) / 2 + 0.5;
    const door: DoorState = {
      id,
      cells: dd.cells,
      axis: dd.axis,
      progress: dd.arch ? 1 : 0,
      target: dd.arch ? 1 : 0,
      barred: dd.barred,
      barSide: dd.barSide,
      arch: dd.arch,
      cx,
      cz,
    };
    grid.addDoor(door);
  });

  if (!d.spawn) throw new Error('no spawn');
  return {
    seed,
    templateId: t.id,
    templateName: t.name,
    mirrored,
    attempt,
    grid,
    spawn: d.spawn,
    rooms: d.rooms,
    enemies: d.enemies,
    pickups,
    chests: d.chests,
    altars: d.altars,
    heart: d.heart,
    stairs: d.stairs,
    resupply: d.resupply,
    traps: d.traps,
    torches: d.torches,
    practice: !!opts.practice,
  };
}

/** 回傳可序列化的佈局摘要，用於「同種子一致」比較。 */
export function levelSignature(l: LevelData): string {
  const r = (n: number) => Math.round(n * 1000) / 1000;
  return JSON.stringify({
    t: l.templateId,
    m: l.mirrored,
    tiles: Array.from(l.grid.tiles).join(''),
    doors: l.grid.doors.map((d) => [d.cells, d.arch, d.barred]),
    pillars: l.grid.pillars.map((p) => [r(p.x), r(p.z)]),
    enemies: l.enemies.map((e) => [e.kind, r(e.x), r(e.z), r(e.yaw), e.state]),
    pickups: l.pickups.map((p) => [p.kind, p.amount, r(p.x), r(p.z)]),
    altars: l.altars.map((a) => a.offer),
    rooms: l.rooms.map((x) => x.layoutId),
  });
}
