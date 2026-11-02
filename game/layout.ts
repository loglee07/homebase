import { mulberry32 } from "./pixel";

export const TILE = 16;
export const COLS = 30;
export const ROWS = 20;
export const WORLD_W = COLS * TILE; // 480
export const WORLD_H = ROWS * TILE; // 320

export interface Rect { x: number; y: number; w: number; h: number }
export type TreeKind = "oak" | "oak2" | "blossom" | "autumn";

/** Path tiles as inclusive tile rects [c0, r0, c1, r1]. Each walk starts under its building so it meets the doorstep. */
const PATHS: [number, number, number, number][] = [
  [14, 5, 15, 6], // school walk: one tile of stem between the door and the plaza
  [7, 8, 8, 10], [7, 11, 10, 12], // home walk: down from the door, then straight east into the plaza
  [22, 9, 23, 12], [19, 11, 21, 12], // bank walk: down from the door, then straight west into the plaza
  [14, 16, 15, 19], // south trail, out of the plaza and off the map
  [16, 17, 21, 18], [22, 16, 23, 18], // kitchen walk: east off the trail, ending in a landing at the kitchen door
];
/** The plaza is a circle (tiles whose center is within PLAZA_RADIUS of the fountain's center, in tiles). */
const PLAZA_CENTER = { c: 15, r: 11.5 };
const PLAZA_RADIUS = 4.4;

const inRect = (c: number, r: number, [c0, r0, c1, r1]: number[]) => c >= c0 && c <= c1 && r >= r0 && r <= r1;
export const isPlaza = (c: number, r: number) => (c + 0.5 - PLAZA_CENTER.c) ** 2 + (r + 0.5 - PLAZA_CENTER.r) ** 2 <= PLAZA_RADIUS ** 2;
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
export const KITCHEN_CENTER_X = 368;
export const KITCHEN_BASE_Y = 272;

const sprite = (cx: number, base: number, w: number, h: number): Rect => ({ x: cx - w / 2, y: base - h, w, h });
export const HOME_FOOTPRINT: Record<1 | 2, Rect> = {
  1: sprite(HOME_CENTER_X, HOME_BASE_Y, 64, 56),
  2: sprite(HOME_CENTER_X, HOME_BASE_Y, 96, 72),
};
export const BANK_FOOTPRINT: Rect = sprite(BANK_CENTER_X, BANK_BASE_Y, 96, 72);
export const SCHOOL_FOOTPRINT: Rect = sprite(SCHOOL_CENTER_X, SCHOOL_BASE_Y, 96, 72);
export const KITCHEN_FOOTPRINT: Rect = sprite(KITCHEN_CENTER_X, KITCHEN_BASE_Y, 96, 72);

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
  kitchen: door(KITCHEN_CENTER_X, KITCHEN_BASE_Y),
} as const;

export const FOUNTAIN = { x: 240, y: 200 }; // sprite bottom-center, in the middle of the plaza
export const FOUNTAIN_BLOCK: Rect = { x: 222, y: 182, w: 36, h: 18 };
export const SPAWN = { x: 200, y: 192 };

export interface TreeSpec { x: number; y: number; kind: TreeKind }

/** Benches stand on open meadow, one by the pond and one by the trail, never on a path. */
const BENCH_SPOTS: [number, number][] = [[170, 254], [288, 262]];

/** Where a tree trunk may not stand: walkable ground, water, buildings, doors, the fountain and the spawn. */
function treeBlocked(x: number, y: number): boolean {
  const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
  if (isWater(c, r) || isWater(c, r - 1)) return true;
  // The canopy rises about 30px above the trunk and reaches 14px either side: it may never cover a path, the plaza or a door.
  const c0 = Math.floor((x - 14) / TILE), c1 = Math.floor((x + 14) / TILE), r0 = Math.floor((y - 30) / TILE), r1 = Math.floor((y + 3) / TILE);
  for (let rr = r0; rr <= r1; rr++) for (let cc = c0; cc <= c1; cc++) if (isPath(cc, rr)) return true;
  const hitsRect = (rc: Rect, m: number) => x + 14 > rc.x - m && x - 14 < rc.x + rc.w + m && y + 3 > rc.y - m && y - 30 < rc.y + rc.h + m;
  if (Object.values(INTERACT_ZONES).some((z) => hitsRect(z, 6))) return true;
  if (BENCH_SPOTS.some(([bx, by]) => hitsRect({ x: bx - 15, y: by - 8, w: 30, h: 8 }, 4))) return true;
  const near = (rc: Rect, m: number) => x > rc.x - m && x < rc.x + rc.w + m && y > rc.y - 6 - m && y < rc.y + rc.h + 24 + m;
  if (near(HOME_FOOTPRINT[2], 4) || near(BANK_FOOTPRINT, 4) || near(SCHOOL_FOOTPRINT, 4) || near(KITCHEN_FOOTPRINT, 4)) return true;
  return Math.hypot(x - SPAWN.x, y - SPAWN.y) < 24 || Math.hypot(x - FOUNTAIN.x, y - (FOUNTAIN.y - 16)) < 34;
}

/** The meadow: open ground around the buildings, pond and plaza. Everything outside it is forest. [cx, cy, rx, ry] */
const MEADOW: [number, number, number, number][] = [
  [240, 168, 190, 118],
  [240, 62, 120, 48],
  [76, 206, 78, 56],
  [384, 262, 88, 48],
  [372, 150, 100, 60],
];
const inMeadow = (x: number, y: number) => MEADOW.some(([cx, cy, rx, ry]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1);

/**
 * A dense forest that thins out into a meadow around the village: tightly packed beyond the meadow, a few lone trees and
 * small groves inside it. Seeded, so it never changes between visits.
 */
function buildTrees(): TreeSpec[] {
  const rng = mulberry32(7);
  const kinds: TreeKind[] = ["oak", "oak2", "oak", "oak2", "autumn", "oak2", "blossom"];
  const trees: TreeSpec[] = [];
  for (let y = 20; y <= 318; y += 17) {
    for (let x = 6; x <= WORLD_W - 6; x += 17) {
      const tx = x + Math.floor(rng() * 11) - 5, ty = y + Math.floor(rng() * 9) - 4;
      const kind = kinds[Math.floor(rng() * kinds.length)];
      const roll = rng();
      if (inMeadow(tx, ty) ? roll > 0.06 : roll < 0.12) continue; // lone meadow trees, and small clearings in the forest
      if (tx < 4 || tx > WORLD_W - 4 || treeBlocked(tx, ty)) continue;
      trees.push({ x: tx, y: ty, kind });
    }
  }
  return trees;
}
export const TREES = buildTrees();

export interface PropSpec { x: number; y: number; solid?: Rect }
const lamp = (x: number, y: number): PropSpec => ({ x, y, solid: { x: x - 3, y: y - 4, w: 6, h: 4 } });
/** Six lamps ring the plaza; two more stand either side of the trail where it leaves the village. */
export const LAMPS: PropSpec[] = [
  lamp(176, 147), lamp(304, 147), lamp(164, 184), lamp(316, 184), lamp(176, 221), lamp(304, 221),
  lamp(212, 310), lamp(268, 310),
];
/** Benches (the sprite faces the viewer, so they sit square to the village). */
export const BENCHES: PropSpec[] = BENCH_SPOTS.map(([x, y]) => ({ x, y, solid: { x: x - 13, y: y - 6, w: 26, h: 6 } }));
export const MAILBOX: PropSpec = { x: 86, y: 166, solid: { x: 83, y: 162, w: 6, h: 4 } };
/** A low fence across the front of the yard, with a gap for the walk. */
export const FENCES: PropSpec[] = [88, 104, 152, 168].map((x) => ({ x, y: 158, solid: { x: x - 8, y: 154, w: 16, h: 4 } }));
export const ROCKS: PropSpec[] = [
  { x: 396, y: 214 }, { x: 156, y: 282 }, { x: 36, y: 196 }, { x: 70, y: 76 }, { x: 440, y: 244 },
];
/** Bushes: pairs by each door and a loose ring just outside the plaza. */
export const BUSHES: PropSpec[] = [
  { x: 84, y: 150 }, { x: 172, y: 150 },
  { x: 206, y: 104 }, { x: 274, y: 104 },
  { x: 332, y: 164 }, { x: 404, y: 164 },
  { x: 334, y: 266 }, { x: 404, y: 280 },
  { x: 168, y: 150 }, { x: 312, y: 150 }, { x: 150, y: 214 }, { x: 330, y: 214 },
  { x: 188, y: 242 }, { x: 316, y: 236 }, { x: 136, y: 218 },
];

/** Where flowers grow: dense beds by the doors, around the plaza, along the trail and at the pond. [x, y, radius, count] */
const FLOWER_PATCHES: [number, number, number, number][] = [
  [88, 158, 16, 9], [172, 158, 14, 8], [212, 106, 14, 8], [268, 106, 14, 8], [334, 170, 14, 8], [402, 170, 14, 8],
  [334, 282, 14, 8], [402, 282, 14, 8],
  [170, 160, 12, 6], [310, 160, 12, 6], [154, 220, 12, 6], [326, 220, 12, 6], [190, 244, 12, 6], [290, 244, 12, 6],
  [200, 286, 12, 7], [284, 286, 12, 7], [150, 276, 14, 7], [40, 200, 14, 6], [440, 200, 14, 6],
];
export interface FlowerSpot { x: number; y: number; roll: number }
/** Deterministic flower positions: clustered in the patches plus a few strays, never on stone, water or a building. */
export function flowerSpots(): FlowerSpot[] {
  const rng = mulberry32(21);
  const out: FlowerSpot[] = [];
  const buildings = [HOME_FOOTPRINT[2], BANK_FOOTPRINT, SCHOOL_FOOTPRINT, KITCHEN_FOOTPRINT];
  const ok = (x: number, y: number) => {
    const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
    if (x < 12 || x > WORLD_W - 12 || y < 28 || y > WORLD_H - 12 || isPath(c, r) || isWater(c, r)) return false;
    return !buildings.some((b) => x > b.x - 2 && x < b.x + b.w + 2 && y > b.y && y < b.y + b.h + 2);
  };
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
    if (inMeadow(x, y) && ok(x, y)) {
      out.push({ x, y, roll: rng() });
      i++;
    }
  }
  return out;
}

/**
 * Scenery around the village for big windows: a loose forest in the extra terrain (see game/viewport.ts), outside the tree
 * ring that already borders the village. Decorative only: the player is confined to the village, so it has no collision.
 */
export function buildPadTrees(padX: number, padY: number): TreeSpec[] {
  const rng = mulberry32(99);
  const kinds: TreeKind[] = ["oak", "oak2", "oak", "oak2", "autumn", "blossom"];
  const out: TreeSpec[] = [];
  for (let y = -padY + 8; y <= WORLD_H + padY + 24; y += 22) {
    for (let x = -padX; x <= WORLD_W + padX; x += 21) {
      const tx = x + Math.floor(rng() * 9) - 4;
      const ty = y + Math.floor(rng() * 7) - 3;
      const kind = kinds[Math.floor(rng() * kinds.length)];
      if (rng() < 0.22) continue; // clearings so the forest is not a wall
      const inVillage = tx > -3 && tx < WORLD_W + 3 && ty > 12 && ty < WORLD_H + 6;
      if (!inVillage) out.push({ x: tx, y: ty, kind });
    }
  }
  return out;
}

/** Everything that blocks the player except the home (which changes with its tier): trees, props, fountain, buildings, water. */
export function villageSolids(tiles: boolean): Rect[] {
  return [
    ...TREES.map((t) => ({ x: t.x - 4, y: t.y - 5, w: 8, h: 5 })),
    ...[...LAMPS, ...BENCHES, MAILBOX, ...FENCES].flatMap((p) => (p.solid ? [p.solid] : [])),
    FOUNTAIN_BLOCK,
    baseOf(BANK_FOOTPRINT),
    baseOf(SCHOOL_FOOTPRINT),
    baseOf(KITCHEN_FOOTPRINT),
    ...(tiles ? waterBlocks() : pondBlocks()),
  ];
}
