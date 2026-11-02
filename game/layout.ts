import { mulberry32 } from "./pixel";

export const TILE = 16;
export const COLS = 30;
export const ROWS = 20;
export const WORLD_W = COLS * TILE; // 480
export const WORLD_H = ROWS * TILE; // 320

export interface Rect { x: number; y: number; w: number; h: number }
export type TreeKind = "oak" | "oak2" | "blossom" | "autumn" | "pine" | "birch";
/** Trunk collision width per kind (px). Oaks keep 8; the slimmer trunks of pines and birches get less. */
export const TRUNK_W: Record<TreeKind, number> = { oak: 8, oak2: 8, blossom: 8, autumn: 8, pine: 6, birch: 5 };
/** How far a canopy reaches above the trunk base: the taller birch needs more clearance from paths and doors. */
const CANOPY_UP: Record<TreeKind, number> = { oak: 30, oak2: 30, blossom: 30, autumn: 30, pine: 34, birch: 38 };

/** Path tiles as inclusive tile rects [c0, r0, c1, r1]. Each walk starts under its building so it meets the doorstep. */
const PATHS: [number, number, number, number][] = [
  [14, 5, 15, 8], // school walk: down from the door to the plaza
  [7, 8, 8, 10], [7, 11, 10, 12], // home walk: down from the door, then straight east into the plaza
  [22, 9, 23, 12], [19, 11, 21, 12], // bank walk: down from the door, then straight west into the plaza
  [14, 15, 15, 19], // south trail, out of the plaza and off the map
];
/**
 * The plaza is an ellipse, defined in pixels and independent of the tile grid: centered on the fountain's column line and the
 * middle of the plaza rows, a little wider (58px) than tall (44px). The four walks run to it along its axes (they are each 16px
 * wide, centered on an axis); the paving is clipped to it pixel by pixel (game/paving.ts).
 */
export const PLAZA = { x: 240, y: 192, rx: 58, ry: 44 };
const inRect = (c: number, r: number, [c0, r0, c1, r1]: number[]) => c >= c0 && c <= c1 && r >= r0 && r <= r1;
/** Whether a pixel is inside the plaza ellipse (tested at the pixel's center). */
export const inPlazaDisc = (px: number, py: number) => ((px + 0.5 - PLAZA.x) / PLAZA.rx) ** 2 + ((py + 0.5 - PLAZA.y) / PLAZA.ry) ** 2 <= 1;
/**
 * Where each walk's 16px paved band runs on into the plaza, from the walk's last tile to the ellipse, so the walks join it
 * with no gap however far the ellipse is from the old tile block.
 */
export const PLAZA_ARMS: Rect[] = [
  { x: 232, y: 120, w: 16, h: 76 }, // north (school walk)
  { x: 232, y: 188, w: 16, h: 76 }, // south (trail)
  { x: 164, y: 184, w: 80, h: 16 }, // west (home walk)
  { x: 236, y: 184, w: 80, h: 16 }, // east (bank walk)
];
/** The whole paved plaza shape at a pixel: the ellipse plus the arms of the walks running into it. */
export const inPlazaShape = (px: number, py: number) => inPlazaDisc(px, py) || PLAZA_ARMS.some((a) => px >= a.x && px < a.x + a.w && py >= a.y && py < a.y + a.h);
/** A tile counts as plaza when the ellipse covers any of it, so nothing is planted or built on paving. */
export const isPlaza = (c: number, r: number) => {
  const nx = Math.max(c * TILE, Math.min(PLAZA.x, (c + 1) * TILE)), ny = Math.max(r * TILE, Math.min(PLAZA.y, (r + 1) * TILE));
  return ((nx - PLAZA.x) / PLAZA.rx) ** 2 + ((ny - PLAZA.y) / PLAZA.ry) ** 2 < 1;
};
export const isPath = (c: number, r: number) => isPlaza(c, r) || PATHS.some((p) => inRect(c, r, p));

/**
 * The pond is authored on the tile grid (inclusive column span per row) so the shore art, the water tiles and the
 * collision all agree. It is a plain rounded oval, a touch fuller toward the bottom right.
 */
const POND_ROWS: Record<number, [number, number]> = {
  13: [3, 6],
  14: [2, 8],
  15: [2, 8],
  16: [3, 8],
  17: [4, 7],
};
export const isWater = (c: number, r: number) => {
  const span = POND_ROWS[r];
  return !!span && c >= span[0] && c <= span[1];
};
/** Pixel-level pond (code-drawn fallback): the water tiles, with their outer corners rounded off. */
export const inPond = (x: number, y: number) => {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  if (!isWater(c, r)) return false;
  const lx = x - c * TILE, ly = y - r * TILE;
  const cut = 5;
  if (!isWater(c, r - 1) && !isWater(c - 1, r) && lx + ly < cut) return false;
  if (!isWater(c, r - 1) && !isWater(c + 1, r) && TILE - 1 - lx + ly < cut) return false;
  if (!isWater(c, r + 1) && !isWater(c - 1, r) && lx + TILE - 1 - ly < cut) return false;
  if (!isWater(c, r + 1) && !isWater(c + 1, r) && TILE - 1 - lx + TILE - 1 - ly < cut) return false;
  return true;
};
/** Bounding box of the pond in pixels (for drawing). */
export const POND = { x0: 2 * TILE, y0: 13 * TILE, x1: 9 * TILE, y1: 18 * TILE };
/** A few water tile centers for lily pads and shimmer. */
export const POND_SPOTS: [number, number][] = [[60, 230], [92, 246], [118, 254], [84, 264]];

/** Water blocks for the tile art. Edges that face land are pulled in a few pixels so the player can walk right up to the shore. */
export const SHORE_INSET = 5;
export function waterBlocks(): Rect[] {
  const out: Rect[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!isWater(c, r)) continue;
      const l = isWater(c - 1, r) ? 0 : SHORE_INSET, rt = isWater(c + 1, r) ? 0 : SHORE_INSET;
      const t = isWater(c, r - 1) ? 0 : SHORE_INSET, bt = isWater(c, r + 1) ? 0 : SHORE_INSET;
      out.push({ x: c * TILE + l, y: r * TILE + t, w: TILE - l - rt, h: TILE - t - bt });
    }
  }
  return out;
}

/** Pond cells blocked for walking in the code-drawn art: any 8px cell center inside the drawn shape. */
export function pondBlocks(): Rect[] {
  const out: Rect[] = [];
  for (let y = POND.y0; y < POND.y1; y += 8) {
    for (let x = POND.x0; x < POND.x1; x += 8) {
      if (inPond(x + 4, y + 4)) out.push({ x, y, w: 8, h: 8 });
    }
  }
  return out;
}

/** Each building's center line is the center of its walk (two tiles wide), and its base y is a tile boundary, so the door lands exactly on the path.
 * Buildings are scattered around the plaza like a village: each has its own bottom edge (where the door is) and center line. */
export const HOME_CENTER_X = 128;
export const HOME_BASE_Y = 144;
export const SCHOOL_CENTER_X = 240;
export const SCHOOL_BASE_Y = 96;
export const BANK_CENTER_X = 368;
export const BANK_BASE_Y = 160;

const sprite = (cx: number, base: number, w: number, h: number): Rect => ({ x: cx - w / 2, y: base - h, w, h });
export const HOME_FOOTPRINT: Record<1 | 2, Rect> = {
  1: sprite(HOME_CENTER_X, HOME_BASE_Y, 64, 56),
  2: sprite(HOME_CENTER_X, HOME_BASE_Y, 96, 72),
};
export const BANK_FOOTPRINT: Rect = sprite(BANK_CENTER_X, BANK_BASE_Y, 96, 72);
export const SCHOOL_FOOTPRINT: Rect = sprite(SCHOOL_CENTER_X, SCHOOL_BASE_Y, 96, 72);

/**
 * What blocks the player is only a building's wall base: the roof and upper walls are scenery the player can walk behind
 * (the building is drawn over them), so there is no invisible wall behind it.
 */
export const BASE_HEIGHT = 24;
export const baseOf = (fp: Rect): Rect => ({ x: fp.x, y: fp.y + fp.h - BASE_HEIGHT, w: fp.w, h: BASE_HEIGHT });

const door = (cx: number, base: number): Rect => ({ x: cx - 16, y: base, w: 32, h: 22 });
export const INTERACT_ZONES = {
  home: door(HOME_CENTER_X, HOME_BASE_Y),
  bank: door(BANK_CENTER_X, BANK_BASE_Y),
  school: door(SCHOOL_CENTER_X, SCHOOL_BASE_Y),
} as const;

export const FOUNTAIN = { x: 240, y: 200 }; // sprite bottom-center, in the middle of the plaza
export const FOUNTAIN_BLOCK: Rect = { x: 222, y: 182, w: 36, h: 18 };
export const SPAWN = { x: 200, y: 192 };

export type TreeSize = "s" | "m" | "l";
export interface TreeSpec { x: number; y: number; kind: TreeKind; size?: TreeSize }
/** Size tiers keep trees within about 10% of normal: never tiny, never huge. Oaks scale by this; pines and birches have a sprite per tier. */
export const SIZE_SCALE: Record<TreeSize, number> = { s: 0.9, m: 1, l: 1.1 };

/** Benches stand on open meadow, one by the pond and one by the trail, never on a path. */
const BENCH_SPOTS: [number, number][] = [[170, 254], [288, 262]];

/** Where a tree trunk may not stand: walkable ground, water, buildings, doors, the fountain and the spawn. */
function treeBlocked(x: number, y: number, up = 30): boolean {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  if (isWater(c, r) || isWater(c, r - 1)) return true;
  // keep the shore walkable: no trunk within a tile of the water
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) if (isWater(c + dc, r + dr)) return true;
  // The canopy rises about 30px above the trunk and reaches 14px either side: it may never cover a path, the plaza or a door.
  const c0 = Math.floor((x - 14) / TILE), c1 = Math.floor((x + 14) / TILE), r0 = Math.floor((y - up) / TILE), r1 = Math.floor((y + 3) / TILE);
  for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (isPath(cc, rr)) return true;
  const hitsRect = (rc: Rect, m: number) => x + 14 > rc.x - m && x - 14 < rc.x + rc.w + m && y + 3 > rc.y - m && y - up < rc.y + rc.h + m;
  if (Object.values(INTERACT_ZONES).some((z) => hitsRect(z, 6))) return true;
  if (BENCH_SPOTS.some(([bx, by]) => hitsRect({ x: bx - 15, y: by - 8, w: 30, h: 8 }, 4))) return true;
  const near = (rc: Rect, m: number) => x > rc.x - m && x < rc.x + rc.w + m && y > rc.y - 6 - m && y < rc.y + rc.h + 24 + m;
  if (near(HOME_FOOTPRINT[2], 4) || near(BANK_FOOTPRINT, 4) || near(SCHOOL_FOOTPRINT, 4)) return true;
  return Math.hypot(x - SPAWN.x, y - SPAWN.y) < 24 || Math.hypot(x - FOUNTAIN.x, y - (FOUNTAIN.y - 16)) < 34;
}

/** A stable 0..1 hash of two integers, so the forest never changes between reloads, reloads or window sizes. */
export const hash01 = (a: number, b: number) => {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
/** Smooth value noise in 0..1 on a lattice of `cell` pixels: broad, coherent shapes rather than per-point jitter. */
function vnoise(x: number, y: number, cell: number, seed: number): number {
  const gx = x / cell, gy = y / cell, x0 = Math.floor(gx), y0 = Math.floor(gy);
  const fx = gx - x0, fy = gy - y0, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const h = (i: number, j: number) => hash01(x0 + i + seed * 131, y0 + j + seed * 71);
  const top = h(0, 0) + (h(1, 0) - h(0, 0)) * sx, bot = h(0, 1) + (h(1, 1) - h(0, 1)) * sx;
  return top + (bot - top) * sy;
}

/**
 * The town clearing is a union of soft ellipses (one per part of the village), blended and nudged by low-frequency noise, so
 * its edge bulges around the school, home, bank, pond and park and recedes between them instead of tracing a rectangle.
 * [cx, cy, rx, ry]
 */
const LOBES: [number, number, number, number][] = [
  [240, 170, 150, 108], // the plaza and the middle of the village
  [240, 60, 104, 64], // school, with room above it for its label
  [118, 112, 92, 76], // home, mailbox and yard
  [368, 122, 84, 70], // bank
  [426, 214, 40, 52], // east side
  [88, 250, 86, 64], // pond and its banks
  [372, 262, 82, 54], // park
  [240, 306, 46, 66], // the south trail, running on out of the village
];
const smin = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k) / 4;
};
/** Signed distance (px, roughly) to the clearing's edge: negative inside the clearing, positive in the forest. */
export function clearingDistance(x: number, y: number): number {
  let d = Infinity;
  for (const [cx, cy, rx, ry] of LOBES) {
    const e = Math.hypot((x - cx) / rx, (y - cy) / ry) - 1;
    d = d === Infinity ? e * Math.min(rx, ry) : smin(d, e * Math.min(rx, ry), 26);
  }
  return d + (vnoise(x, y, 70, 1) - 0.5) * 22 + (vnoise(x, y, 26, 2) - 0.5) * 7;
}

/** Trunks never stand closer than this to the clearing's edge (their canopies still overhang it a little). */
export const CLEARING_MARGIN = 4;
/** No two trunks closer than this (px): canopies overlap, trunks never pile up. */
export const MIN_TREE_GAP = 16;
/** The woodland is generated this far past the village on every side, so it always reaches past the visible edge. */
export const FOREST_PAD_X = 300;
export const FOREST_PAD_Y = 210;
const inVillage = (x: number, y: number) => x > -3 && x < WORLD_W + 3 && y > 12 && y < WORLD_H + 6;

/**
 * One woodland for the whole map, built from one rule: staggered rows of trunks (20px across, 14px between rows, odd rows
 * shifted) so canopies overlap in depth and leave no holes, kept only outside the clearing. Oaks dominate; pines gather in
 * broad stands (a second noise field); birches appear as a few small clusters. Positions are seeded and independent of the
 * window, so every reload and every size show the same trees.
 */
function buildForest(): TreeSpec[] {
  const rng = mulberry32(61);
  const kept: { x: number; y: number; d: number }[] = [];
  let row = 0;
  for (let y = -FOREST_PAD_Y; y <= WORLD_H + FOREST_PAD_Y; y += 14, row++) {
    for (let x = -FOREST_PAD_X + (row % 2 ? 10 : 0); x <= WORLD_W + FOREST_PAD_X; x += 20) {
      const tx = x + Math.floor(rng() * 7) - 3, ty = y + Math.floor(rng() * 5) - 2;
      const d = clearingDistance(tx, ty);
      if (d < CLEARING_MARGIN || (inVillage(tx, ty) && treeBlocked(tx, ty))) continue;
      if (kept.some((k) => Math.abs(k.y - ty) < MIN_TREE_GAP && Math.hypot(k.x - tx, k.y - ty) < MIN_TREE_GAP)) continue;
      kept.push({ x: tx, y: ty, d });
    }
  }
  // birch clusters: one per few broad cells, never in a row, a seed and up to two close neighbours
  const birch = new Set<number>();
  const seeds: { x: number; y: number }[] = [];
  for (let cy = -2; cy < 12; cy++) for (let cx = -3; cx < 16; cx++) {
    if (hash01(cx + 11, cy + 29) > 0.2) continue;
    const mx = cx * 80 + 40, my = cy * 80 + 40;
    let best = -1, bd = 1e9;
    kept.forEach((k, i) => {
      const dd = Math.hypot(k.x - mx, k.y - my);
      if (k.d > 8 && dd < bd) { best = i; bd = dd; }
    });
    if (best < 0 || seeds.some((s) => Math.hypot(s.x - kept[best].x, s.y - kept[best].y) < 90)) continue;
    seeds.push(kept[best]);
    birch.add(best);
    kept.map((k, i) => ({ i, dd: Math.hypot(k.x - kept[best].x, k.y - kept[best].y) }))
      .filter((o) => o.i !== best && o.dd <= 26).sort((a, b) => a.dd - b.dd).slice(0, 1 + (hash01(cx, cy) < 0.5 ? 1 : 0)).forEach((o) => birch.add(o.i));
  }
  return kept.map((k, i) => {
    const r = hash01(Math.round(k.x) + 3, Math.round(k.y) + 5);
    const pine = k.d > 14 && vnoise(k.x, k.y, 64, 5) > 0.66;
    const kind: TreeKind = birch.has(i) ? "birch" : pine ? "pine" : r < 0.05 ? "blossom" : r < 0.1 ? "autumn" : r < 0.55 ? "oak" : "oak2";
    return { x: k.x, y: k.y, kind, size: sizeFor(k, kind) };
  });
}
/** Stable size tier. A large tree needs the extra clearance a bigger canopy takes, else it stays medium. */
function sizeFor(t: { x: number; y: number }, kind: TreeKind): TreeSize {
  const r = hash01(Math.round(t.x) + 7, Math.round(t.y) + 13);
  const size: TreeSize = r < 0.3 ? "s" : r < 0.7 ? "m" : "l";
  return size === "l" && inVillage(t.x, t.y) && treeBlocked(t.x, t.y, CANOPY_UP[kind] + 6) ? "m" : size;
}
const FOREST = buildForest();
/** The trees inside the village (they have trunk collisions). */
/** A few lone trees on the lawn itself, hand-placed in open corners well away from walks, doors, the pond and the woodland. */
const LAWN_TREE_SPOTS: [number, number, TreeKind][] = [
  [42, 160, "oak"], [446, 168, "oak2"], [418, 244, "oak"], [326, 286, "oak2"], [196, 280, "pine"], [300, 62, "oak"], [176, 48, "oak2"],
];
export const LAWN_TREES: TreeSpec[] = LAWN_TREE_SPOTS
  .filter(([x, y, k]) => !treeBlocked(x, y, CANOPY_UP[k] + 6) && FOREST.every((t) => Math.hypot(t.x - x, t.y - y) >= 24))
  .map(([x, y, kind]) => ({ x, y, kind, size: sizeFor({ x, y }, kind) }));
export const TREES: TreeSpec[] = [...FOREST.filter((t) => inVillage(t.x, t.y)), ...LAWN_TREES];


export interface PropSpec { x: number; y: number; solid?: Rect }
const lamp = (x: number, y: number): PropSpec => ({ x, y, solid: { x: x - 3, y: y - 4, w: 6, h: 4 } });
/** Six lamps ring the plaza; two more stand either side of the trail where it leaves the village. */
export const LAMPS: PropSpec[] = [
  lamp(198, 147), lamp(282, 147), lamp(164, 184), lamp(316, 184), lamp(176, 221), lamp(304, 221),
  lamp(212, 310), lamp(268, 310),
];
/** Benches (the sprite faces the viewer, so they sit square to the village). */
export const BENCHES: PropSpec[] = BENCH_SPOTS.map(([x, y]) => ({ x, y, solid: { x: x - 13, y: y - 6, w: 26, h: 6 } }));
export const MAILBOX: PropSpec = { x: 86, y: 166, solid: { x: 83, y: 162, w: 6, h: 4 } };
/**
 * The home's front-yard fence: two side runs that start at the house walls and run forward to a front rail on row 9, open on the
 * two walk columns (7-8) so the door stays reachable. The top of each side turns in with a short rail to the wall; there is no
 * fence behind the house. Each piece is one tile; `part` picks the sprite and `solids` the collision (post, rails and corners
 * overlap so the line has no gap).
 */
export const YARD = { c0: 5, c1: 10, r0: 7, r1: 9, gap: [7, 8] as readonly number[] };
export type FencePart = "tl" | "tr" | "l" | "r" | "bl" | "b" | "br" | "bEndL" | "bEndR";
export interface FencePiece { x: number; y: number; part: FencePart; solids: Rect[] }
export const FENCES: FencePiece[] = (() => {
  const out: FencePiece[] = [];
  const { c0, c1, r0, r1, gap } = YARD;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (r !== r1 && c !== c0 && c !== c1) continue;
      if (r === r1 && gap.includes(c)) continue;
      const left = c === c0, right = c === c1;
      let part: FencePart;
      if (r === r1) part = left ? "bl" : right ? "br" : c === gap[0] - 1 ? "bEndR" : c === gap[gap.length - 1] + 1 ? "bEndL" : "b";
      else if (r === r0) part = left ? "tl" : "tr";
      else part = left ? "l" : "r";
      const x = c * TILE + TILE / 2, tileTop = r * TILE;
      const post: Rect = { x: x - 2, y: tileTop, w: 4, h: TILE };
      const railR: Rect = { x: x - 2, y: tileTop + 8, w: 10, h: 4 }; // post to the tile's right edge
      const railL: Rect = { x: x - 8, y: tileTop + 8, w: 10, h: 4 };
      const solids: Rect[] =
        part === "l" || part === "r" ? [post]
        : part === "tl" || part === "bl" ? [post, railR]
        : part === "tr" || part === "br" ? [post, railL]
        : part === "bEndL" ? [post, railR]
        : part === "bEndR" ? [post, railL]
        : [{ x: x - 8, y: tileTop + 8, w: TILE, h: 4 }];
      out.push({ x, y: tileTop + 12, part, solids });
    }
  }
  return out;
})();
export const ROCKS: PropSpec[] = [
  { x: 396, y: 214 }, { x: 156, y: 282 }, { x: 36, y: 196 }, { x: 70, y: 76 }, { x: 440, y: 244 },
];
/** Bushes: pairs by each door and a loose ring just outside the plaza. */
export const BUSHES: PropSpec[] = [
  { x: 102, y: 141 }, { x: 154, y: 141 },
  { x: 206, y: 104 }, { x: 274, y: 104 },
  { x: 332, y: 164 }, { x: 404, y: 164 },
  { x: 334, y: 266 }, { x: 404, y: 280 },
  { x: 196, y: 130 }, { x: 312, y: 150 }, { x: 150, y: 214 }, { x: 330, y: 214 },
  { x: 188, y: 242 }, { x: 316, y: 236 }, { x: 136, y: 218 },
];

/** Where flowers grow: dense beds by the doors, around the plaza, along the trail and at the pond. [x, y, radius, count] */
const FLOWER_PATCHES: [number, number, number, number][] = [
  [88, 158, 16, 9], [172, 158, 14, 8], [212, 106, 14, 8], [268, 106, 14, 8], [334, 170, 14, 8], [402, 170, 14, 8],
  [334, 282, 14, 8], [402, 282, 14, 8],
  [170, 160, 12, 6], [310, 160, 12, 6], [154, 220, 12, 6], [326, 220, 12, 6], [190, 244, 12, 6], [290, 244, 12, 6],
  [200, 286, 12, 7], [284, 286, 12, 7], [150, 276, 14, 7], [40, 200, 14, 6], [440, 200, 14, 6],
];
/** Ground a flower, tuft or shrub may stand on: not stone, water, a building or the edge. */
function openGround(x: number, y: number): boolean {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  if (x < 12 || x > WORLD_W - 12 || y < 28 || y > WORLD_H - 12 || isPath(c, r) || isWater(c, r) || clearingDistance(x, y) > -6) return false;
  return ![HOME_FOOTPRINT[2], BANK_FOOTPRINT, SCHOOL_FOOTPRINT].some((b) => x > b.x - 2 && x < b.x + b.w + 2 && y > b.y && y < b.y + b.h + 2);
}

const SHORE_TUFTS: [number, number, boolean][] = [
  [27, 222, false], [25, 238, true], [29, 256, false], [38, 205, true], [60, 205, false], [92, 206, true],
  [48, 293, true], [78, 296, false], [104, 294, true], [128, 292, false],
];

/** A sparse scatter of small grass tufts over the meadow, never on paving or water and never crowded. */
export function tuftSpots(): { x: number; y: number; small: boolean }[] {
  const rng = mulberry32(33);
  const out: { x: number; y: number; small: boolean }[] = [];
  // a little shoreline growth first: low tufts on the west, north and south banks, with the east bank left bare
  for (const [x, y, small] of SHORE_TUFTS) if (openGround(x, y)) out.push({ x, y, small });
  for (let tries = 0; tries < 900 && out.length < 44; tries++) {
    const x = 12 + Math.floor(rng() * (WORLD_W - 24)), y = 28 + Math.floor(rng() * (WORLD_H - 40));
    if (!openGround(x, y) || out.some((o) => Math.hypot(o.x - x, o.y - y) < 22)) continue;
    out.push({ x, y, small: rng() < 0.5 });
  }
  return out;
}

export interface FlowerSpot { x: number; y: number; roll: number }
/** Deterministic flower positions: clustered in the patches plus a few strays, never on stone, water or a building. */
export function flowerSpots(): FlowerSpot[] {
  const rng = mulberry32(21);
  const out: FlowerSpot[] = [];
  const ok = openGround;
  for (const [px, py, pr, n] of FLOWER_PATCHES) {
    for (let i = 0, tries = 0; i < n && tries < 40; tries++) {
      const a = rng() * Math.PI * 2, d = Math.sqrt(rng()) * pr;
      const x = Math.round(px + Math.cos(a) * d), y = Math.round(py + Math.sin(a) * d * 0.7);
      if (ok(x, y)) {
        out.push({ x, y, roll: rng() });
        i++;
      }
    }
  }
  for (let i = 0, tries = 0; i < 16 && tries < 120; tries++) {
    const x = 12 + Math.floor(rng() * (WORLD_W - 24)), y = 28 + Math.floor(rng() * (WORLD_H - 40));
    if (clearingDistance(x, y) < -14 && ok(x, y)) {
      out.push({ x, y, roll: rng() });
      i++;
    }
  }
  return out;
}

/**
 * The woodland beyond the village, for big windows (see game/viewport.ts): the same forest as TREES, continued outward.
 * Decorative only: the player is confined to the village, so it has no collision.
 */
export function buildPadTrees(padX: number, padY: number): TreeSpec[] {
  return FOREST.filter((t) => !inVillage(t.x, t.y) && t.x > -padX - 40 && t.x < WORLD_W + padX + 40 && t.y > -padY - 40 && t.y < WORLD_H + padY + 40);
}

/** Everything that blocks the player except the home (which changes with its tier): trees, props, fountain, buildings, water. */
export function villageSolids(tiles: boolean): Rect[] {
  return [
    ...TREES.map((t) => ({ x: t.x - TRUNK_W[t.kind] / 2, y: t.y - 5, w: TRUNK_W[t.kind], h: 5 })),
    ...[...LAMPS, ...BENCHES, MAILBOX].flatMap((p) => (p.solid ? [p.solid] : [])),
    ...FENCES.flatMap((f) => f.solids),
    FOUNTAIN_BLOCK,
    baseOf(BANK_FOOTPRINT),
    baseOf(SCHOOL_FOOTPRINT),
    ...(tiles ? waterBlocks() : pondBlocks()),
  ];
}

/**
 * Compact shrubs (no collision): by the foot of some trees, at the sides of each building's foundation, either side of
 * the benches, and a few on the pond's west, north and south banks. Never on paving or water, and never beside a door
 * or the walks (a tile of clearance), so entrances and labels stay clear. The pack has one shrub (the flowering bush).
 */
export function shrubSpots(): { x: number; y: number; where: "tree" | "wall" | "seat" | "shore" }[] {
  type Spot = { x: number; y: number; where: "tree" | "wall" | "seat" | "shore" };
  const want: Spot[] = [];
  for (const t of TREES) {
    if ((t.kind !== "oak" && t.kind !== "oak2") || hash01(t.x + 3, t.y + 11) > 0.2 || clearingDistance(t.x, t.y) > 14) continue;
    // step from the trunk toward the clearing, so the shrub sits at the foot of a front-row tree on the open side
    const gx = clearingDistance(t.x + 3, t.y) - clearingDistance(t.x - 3, t.y), gy = clearingDistance(t.x, t.y + 3) - clearingDistance(t.x, t.y - 3);
    const n = Math.hypot(gx, gy) || 1;
    want.push({ x: Math.round(t.x - (gx / n) * 14), y: Math.round(t.y - (gy / n) * 14), where: "tree" });
  }
  for (const f of [HOME_FOOTPRINT[2], BANK_FOOTPRINT, SCHOOL_FOOTPRINT]) {
    want.push({ x: f.x - 5, y: f.y + f.h + 1, where: "wall" }, { x: f.x + f.w + 6, y: f.y + f.h + 1, where: "wall" });
  }
  for (const [bx, by] of BENCH_SPOTS) want.push({ x: bx - 20, y: by, where: "seat" }, { x: bx + 20, y: by, where: "seat" });
  for (const [x, y] of [[30, 244], [52, 206], [96, 206], [70, 297], [120, 294]]) want.push({ x, y, where: "shore" });
  const out: Spot[] = [];
  for (const w of want) {
    const c = Math.floor(w.x / TILE), r = Math.floor(w.y / TILE);
    const nearWalk = [-1, 0, 1].some((dc) => [-1, 0, 1].some((dr) => isPath(c + dc, r + dr) || isPath(c + dc, r - 1 + dr)));
    const nearSolid = [...LAMPS, ...ROCKS].some((o) => Math.hypot(o.x - w.x, o.y - w.y) < 12) || FENCES.some((f) => Math.hypot(f.x - w.x, f.y - 4 - w.y) < 10);
    const crowded = [...BUSHES, ...out].some((o) => Math.hypot(o.x - w.x, o.y - w.y) < 16);
    const wet = [-5, 0, 5].some((d) => isWater(Math.floor((w.x + d) / TILE), Math.floor((w.y - 2) / TILE)));
    if (!openGround(w.x, w.y) || (nearWalk && w.where !== "wall" && w.where !== "seat") || nearSolid || crowded || wet) continue;
    out.push(w);
  }
  return out;
}
