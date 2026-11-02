import type Phaser from "phaser";
import { grassRGB, type RGB } from "./grass";
import { pavingPixels } from "./paving";
import { COLS, ROWS, TILE, WORLD_H, WORLD_W, flowerSpots, isWater, tuftSpots } from "./layout";

/**
 * Optional third-party art: "Cute Fantasy Free" by Kenmi (non-commercial, no redistribution).
 * The PNGs live in a gitignored folder (see docs/assets.md). Everything here is skipped when
 * they are missing, and the scene falls back to the code-drawn art in `art.ts`.
 */
export const LICENSED_BASE = "/licensed/cute-fantasy";

const SHEETS = {
  grass: "Tiles/Grass_Middle.png",
  path: "Tiles/Path_Tile.png",
  water: "Tiles/Water_Tile.png",
  decor: "Outdoor decoration/Outdoor_Decor_Free.png",
  fences: "Outdoor decoration/Fences.png",
  oak: "Outdoor decoration/Oak_Tree_Small.png",
  player: "Player/Player.png",
} as const;

export const CF = {
  grass: "cf_grass",
  path: "cf_path",
  water: "cf_water",
  decor: "cf_decor",
  fences: "cf_fences",
  oak: "cf_oak",
  player: "cf_player",
} as const;

const url = (file: string) => `${LICENSED_BASE}/${encodeURI(file)}`;

/** Phase 1: a single small file, so a fresh clone without the pack costs one 404 instead of many. */
export function queueProbe(scene: Phaser.Scene) {
  scene.load.image(CF.grass, url(SHEETS.grass));
}

/** Phase 2: the rest of the pack. */
export function queueLicensed(scene: Phaser.Scene) {
  const l = scene.load;
  l.image(CF.path, url(SHEETS.path));
  l.image(CF.water, url(SHEETS.water));
  l.image(CF.decor, url(SHEETS.decor));
  l.spritesheet(CF.fences, url(SHEETS.fences), { frameWidth: 16, frameHeight: 16 });
  l.spritesheet(CF.oak, url(SHEETS.oak), { frameWidth: 32, frameHeight: 48 });
  l.spritesheet(CF.player, url(SHEETS.player), { frameWidth: 32, frameHeight: 32 });
}


export const probeLoaded = (scene: Phaser.Scene) => scene.textures.exists(CF.grass);
export const licensedLoaded = (scene: Phaser.Scene) => Object.values(CF).every((k) => scene.textures.exists(k));

/** Named crops of the loose-sprite decor sheet (x, y, w, h). */
const DECOR = {
  lamp: [68, 72, 10, 40],
  rockSmall: [18, 37, 10, 7],
  rockLarge: [32, 34, 15, 12],
  flowerBush: [0, 18, 15, 13],
  flowerWhite: [19, 20, 10, 8],
  flowerYellow: [33, 20, 13, 8],
  flowerPink: [4, 132, 7, 10],
  flowerGold: [20, 132, 7, 10],
  tuft: [2, 6, 10, 4],
  tuftSmall: [20, 6, 8, 4],
} as const;
export type DecorName = keyof typeof DECOR;

export function addDecorFrames(scene: Phaser.Scene) {
  const tex = scene.textures.get(CF.decor);
  for (const [name, [x, y, w, h]] of Object.entries(DECOR)) if (!tex.has(name)) tex.add(name, 0, x, y, w, h);
}

/**
 * Frame index in Fences.png (4x4 grid of 16px). Row 0: columns 1-3 are the left end, middle and right end of a horizontal rail;
 * column 0 holds the vertical rail (frame 4 is the straight piece); rows 1 and 3 of the grid block hold the corners.
 */
export const FENCE_FRAME = { tl: 5, tr: 7, l: 4, r: 4, bl: 13, b: 2, br: 15, bEndR: 3, bEndL: 1 } as const;

/** Oak_Tree_Small.png is three 32x48 frames: stump, tree with shadow, tree without. Origin y puts the trunk base on the layout point. */
export const OAK = {
  shaded: { frame: 1, originY: 31 / 48 },
  plain: { frame: 2, originY: 29 / 48 },
} as const;

/** Player.png is 6 columns x 10 rows of 32x32. Rows: idle down/right/up, then walk down/right/up. Left is right, flipped. */
export const PLAYER_ORIGIN_Y = 24 / 32;
export const PLAYER_COLS = 6;
const PLAYER_ROW = { idle: { down: 0, right: 1, up: 2 }, walk: { down: 3, right: 4, up: 5 } } as const;
export function playerFrame(dir: "down" | "up" | "left" | "right", moving: boolean, clockMs: number) {
  const row = PLAYER_ROW[moving ? "walk" : "idle"][dir === "left" ? "right" : dir];
  const step = moving ? 110 : 220;
  return row * PLAYER_COLS + (Math.floor(clockMs / step) % PLAYER_COLS);
}

// ---------- ground ----------
/**
 * Path_Tile.png and Water_Tile.png share one layout (16px tiles, 3 wide):
 * rows 0-2 are a 3x3 blob (corners, edges, center); rows 3-4 hold the four inner corners (named for the
 * side where grass shows through); row 5 is three decoration tiles.
 */
const BLOB: Record<string, [number, number]> = {
  tl: [0, 0], t: [1, 0], tr: [2, 0],
  l: [0, 1], c: [1, 1], r: [2, 1],
  bl: [0, 2], b: [1, 2], br: [2, 2],
  innerSE: [0, 3], innerSW: [1, 3], innerNE: [0, 4], innerNW: [1, 4],
};

export function blobTile(has: (c: number, r: number) => boolean, c: number, r: number): [number, number] {
  const n = has(c, r - 1), s = has(c, r + 1), w = has(c - 1, r), e = has(c + 1, r);
  if (!n && !w) return BLOB.tl;
  if (!n && !e) return BLOB.tr;
  if (!s && !w) return BLOB.bl;
  if (!s && !e) return BLOB.br;
  if (!n) return BLOB.t;
  if (!s) return BLOB.b;
  if (!w) return BLOB.l;
  if (!e) return BLOB.r;
  if (!has(c + 1, r + 1)) return BLOB.innerSE;
  if (!has(c - 1, r + 1)) return BLOB.innerSW;
  if (!has(c + 1, r - 1)) return BLOB.innerNE;
  if (!has(c - 1, r - 1)) return BLOB.innerNW;
  return BLOB.c;
}

/**
 * The lawn: the pack grass tile's own base green, lightened and warmed slightly (a yellower, sunnier green), with our quiet
 * variation and sparse tufts (game/grass.ts) over it. Only the lawn is adjusted, never
 * the screen, so buildings and props keep their own colors.
 */
function grassBases(grass: CanvasImageSource): RGB[] {
  const src = document.createElement("canvas");
  src.width = TILE;
  src.height = TILE;
  const sctx = src.getContext("2d")!;
  sctx.drawImage(grass, 0, 0, TILE, TILE, 0, 0, TILE, TILE);
  const d = sctx.getImageData(0, 0, TILE, TILE).data;
  const count = new Map<number, number>();
  for (let i = 0; i < d.length; i += 4) {
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    count.set(k, (count.get(k) ?? 0) + 1);
  }
  const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0][0]; // the tile's main green
  return [[Math.min(255, (top >> 16) + 16), Math.min(255, ((top >> 8) & 255) + 12), Math.max(0, (top & 255) - 4)]];
}

/** One 16px lawn tile at world tile (c, r), as ImageData. `wrap` makes the pattern repeat every that many pixels. */
function lawnTile(ctx: CanvasRenderingContext2D, bases: RGB[], c: number, r: number, wrap = 0): ImageData {
  const out = ctx.createImageData(TILE, TILE);
  const base = bases[0];
  for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
    const [R, G, B] = grassRGB(c * TILE + x, r * TILE + y, base, wrap);
    const o = (y * TILE + x) * 4;
    out.data[o] = R; out.data[o + 1] = G; out.data[o + 2] = B; out.data[o + 3] = 255;
  }
  return out;
}

/** Seamless lawn patch for the extra terrain around the village. */
export function drawLicensedFill(scene: Phaser.Scene) {
  if (scene.textures.exists("ground_fill")) scene.textures.remove("ground_fill");
  const tex = scene.textures.createCanvas("ground_fill", 64, 64);
  if (!tex) throw new Error("could not create ground fill texture");
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const grass = scene.textures.get(CF.grass).getSourceImage() as CanvasImageSource;
  const bases = grassBases(grass);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) ctx.putImageData(lawnTile(ctx, bases, c, r, 64), c * TILE, r * TILE);
  tex.refresh();
}

export function drawLicensedGround(scene: Phaser.Scene) {
  if (scene.textures.exists("ground")) scene.textures.remove("ground");
  const tex = scene.textures.createCanvas("ground", WORLD_W, WORLD_H);
  if (!tex) throw new Error("could not create ground texture");
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const img = (key: string) => scene.textures.get(key).getSourceImage() as CanvasImageSource;
  const water = img(CF.water), decor = img(CF.decor);
  const bases = grassBases(img(CF.grass));
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isWater(c, r)) {
        // the pond's tiles carry the pack's own flat green around the bank: lay our lawn under them and keep only the water
        // and bank pixels, so no flat squares show around the pond
        ctx.putImageData(lawnTile(ctx, bases, c, r), c * TILE, r * TILE);
        const [tc, tr] = blobTile(isWater, c, r);
        const wt = document.createElement("canvas");
        wt.width = TILE;
        wt.height = TILE;
        const wx = wt.getContext("2d")!;
        wx.drawImage(water, tc * TILE, tr * TILE, TILE, TILE, 0, 0, TILE, TILE);
        const wd = wx.getImageData(0, 0, TILE, TILE);
        for (let i = 0; i < wd.data.length; i += 4) if (Math.abs(wd.data[i] - 62) + Math.abs(wd.data[i + 1] - 137) + Math.abs(wd.data[i + 2] - 72) < 12) wd.data[i + 3] = 0;
        wx.putImageData(wd, 0, 0);
        ctx.drawImage(wt, c * TILE, r * TILE);
      } else {
        ctx.putImageData(lawnTile(ctx, bases, c, r), c * TILE, r * TILE);
      }
    }
  }

  // paving over the lawn: our own stone and edge (game/paving.ts); the pack's path tiles are not used
  const pav = document.createElement("canvas");
  pav.width = WORLD_W;
  pav.height = WORLD_H;
  pav.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(pavingPixels()), WORLD_W, WORLD_H), 0, 0);
  ctx.drawImage(pav, 0, 0);

  // sparse grass tufts across the meadow
  for (const { x, y, small } of tuftSpots()) {
    const [sx, sy, w, h] = DECOR[small ? "tuftSmall" : "tuft"];
    ctx.drawImage(decor, sx, sy, w, h, x - (w >> 1), y - h, w, h);
  }
  // flowers and tufts in patches by the doors, pond and trail
  const spots: DecorName[] = ["tuft", "tuftSmall", "flowerWhite", "flowerYellow", "flowerPink", "flowerGold", "tuft"];
  for (const { x, y, roll } of flowerSpots()) {
    const [sx, sy, w, h] = DECOR[spots[Math.floor(roll * spots.length)]];
    ctx.drawImage(decor, sx, sy, w, h, x - (w >> 1), y - h, w, h);
  }
  tex.refresh();
}
