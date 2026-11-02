import { mulberry32 } from "./pixel";

export const TILE = 16;
export const COLS = 30;
export const ROWS = 20;
export const WORLD_W = COLS * TILE; // 480
export const WORLD_H = ROWS * TILE; // 320

export interface Rect { x: number; y: number; w: number; h: number }
export type TreeKind = "oak" | "oak2" | "blossom" | "autumn";

/** Path tiles as inclusive tile rects [c0, r0, c1, r1]. */
const PATHS: [number, number, number, number][] = [
  [3, 10, 27, 11], // main street
  [6, 7, 7, 9], // home walk (starts under the building so it meets the doorstep)
  [22, 7, 23, 9], // bank walk (starts under the building so it meets the door)
  [14, 7, 15, 8], // school walk (meets the plaza below it)
  [12, 9, 17, 12], // plaza
  [14, 13, 15, 16], // south trail
];
const PLAZA: [number, number, number, number] = [12, 9, 17, 12];

const inRect = (c: number, r: number, [c0, r0, c1, r1]: number[]) => c >= c0 && c <= c1 && r >= r0 && r <= r1;
export const isPath = (c: number, r: number) => PATHS.some((p) => inRect(c, r, p));
export const isPlaza = (c: number, r: number) => inRect(c, r, PLAZA);

export const POND = { cx: 96, cy: 256, rx: 48, ry: 29 };
export const inPond = (x: number, y: number) =>
  ((x - POND.cx) / POND.rx) ** 2 + ((y - POND.cy) / POND.ry) ** 2 <= 1;

/** Tile-aligned pond for the tile-based art: every tile whose center is inside the ellipse. */
export const isWater = (c: number, r: number) => inPond(c * TILE + TILE / 2, r * TILE + TILE / 2);
export function waterBlocks(): Rect[] {
  const out: Rect[] = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) if (isWater(c, r)) out.push({ x: c * TILE, y: r * TILE, w: TILE, h: TILE });
  }
  return out;
}

/** Bottom of every building; the door faces the walk tile row below it. */
export const BUILDING_BASE_Y = 128;
export const HOME_CENTER_X = 112;
export const BANK_CENTER_X = 368;
export const SCHOOL_CENTER_X = 240;

export const HOME_FOOTPRINT: Record<1 | 2, Rect> = {
  1: { x: 80, y: 72, w: 64, h: 56 },
  2: { x: 64, y: 56, w: 96, h: 72 },
};
export const BANK_FOOTPRINT: Rect = { x: 320, y: 56, w: 96, h: 72 };
export const SCHOOL_FOOTPRINT: Rect = { x: 192, y: 56, w: 96, h: 72 };

export const INTERACT_ZONES = {
  home: { x: 96, y: 128, w: 32, h: 22 },
  bank: { x: 352, y: 128, w: 32, h: 22 },
  school: { x: 224, y: 128, w: 32, h: 22 },
} as const;

export const FOUNTAIN = { x: 240, y: 192 }; // sprite bottom-center
export const FOUNTAIN_BLOCK: Rect = { x: 226, y: 174, w: 28, h: 18 };
export const SPAWN = { x: 200, y: 182 };

export interface TreeSpec { x: number; y: number; kind: TreeKind }

function buildTrees(): TreeSpec[] {
  const rng = mulberry32(7);
  const kinds: TreeKind[] = ["oak", "oak2", "oak", "oak2", "autumn"];
  const pick = () => kinds[Math.floor(rng() * kinds.length)];
  const trees: TreeSpec[] = [];
  for (let x = 10; x < WORLD_W; x += 21) trees.push({ x, y: 24 + Math.floor(rng() * 4), kind: pick() });
  for (let y = 46; y < 300; y += 22) {
    trees.push({ x: 9, y: y + Math.floor(rng() * 3), kind: pick() });
    trees.push({ x: WORLD_W - 9, y: y + Math.floor(rng() * 3), kind: pick() });
  }
  for (let x = 20; x < WORLD_W; x += 22) trees.push({ x, y: 318, kind: pick() });
  const hand: TreeSpec[] = [
    { x: 42, y: 112, kind: "oak" }, { x: 56, y: 78, kind: "oak2" }, { x: 30, y: 146, kind: "oak2" },
    { x: 440, y: 112, kind: "oak" }, { x: 454, y: 80, kind: "autumn" }, { x: 436, y: 148, kind: "oak2" },
    { x: 176, y: 80, kind: "oak" }, { x: 176, y: 112, kind: "blossom" }, { x: 304, y: 100, kind: "oak2" },
    { x: 306, y: 70, kind: "oak" },
    { x: 344, y: 250, kind: "blossom" }, { x: 376, y: 250, kind: "blossom" }, { x: 408, y: 250, kind: "autumn" },
    { x: 360, y: 284, kind: "autumn" }, { x: 392, y: 284, kind: "blossom" }, { x: 428, y: 282, kind: "blossom" },
    { x: 192, y: 262, kind: "oak" }, { x: 290, y: 268, kind: "oak2" },
  ];
  return [...trees, ...hand];
}
export const TREES = buildTrees();

export interface PropSpec { x: number; y: number; solid?: Rect }
export const LAMPS: PropSpec[] = [
  { x: 180, y: 158 }, { x: 300, y: 208 }, { x: 340, y: 158 }, { x: 136, y: 158 },
].map((p) => ({ ...p, solid: { x: p.x - 3, y: p.y - 4, w: 6, h: 4 } }));
export const BENCHES: PropSpec[] = [
  { x: 206, y: 238 }, { x: 274, y: 238 },
].map((p) => ({ ...p, solid: { x: p.x - 9, y: p.y - 5, w: 18, h: 5 } }));
export const MAILBOX: PropSpec = { x: 88, y: 152, solid: { x: 85, y: 148, w: 6, h: 4 } };
export const FENCES: PropSpec[] = [72, 88, 136, 152].map((x) => ({ x, y: 142, solid: { x: x - 8, y: 138, w: 16, h: 4 } }));
export const ROCKS: PropSpec[] = [{ x: 410, y: 206 }, { x: 52, y: 206 }, { x: 156, y: 292 }];
export const BUSHES: PropSpec[] = [{ x: 62, y: 128 }, { x: 166, y: 128 }, { x: 322, y: 130 }, { x: 414, y: 130 }];

/** Pond tiles blocked for walking: any 8px cell center inside the ellipse. */
export function pondBlocks(): Rect[] {
  const out: Rect[] = [];
  for (let y = POND.cy - POND.ry; y < POND.cy + POND.ry; y += 8) {
    for (let x = POND.cx - POND.rx; x < POND.cx + POND.rx; x += 8) {
      if (inPond(x + 4, y + 4)) out.push({ x, y, w: 8, h: 8 });
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
