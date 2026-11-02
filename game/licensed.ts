import type Phaser from "phaser";
import { COLS, ROWS, TILE, WORLD_H, WORLD_W, isPath, isWater } from "./layout";
import { mulberry32 } from "./pixel";

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

/** Our own cobblestone tile (public/sprites/cobble.png, 48x48, seamless); optional, dirt is used without it. */
export const COBBLE = "custom_cobble";
const COBBLE_SIZE = 48;

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

/** Frame index in Fences.png (4x4 grid of 16px): row 0, columns 1-3 are the left end, middle and right end of a rail. */
export const FENCE_FRAME = { left: 1, mid: 2, right: 3 } as const;

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

/** Seamless pack-grass patch for the extra terrain around the village. */
export function drawLicensedFill(scene: Phaser.Scene) {
  if (scene.textures.exists("ground_fill")) scene.textures.remove("ground_fill");
  const tex = scene.textures.createCanvas("ground_fill", 64, 64);
  if (!tex) throw new Error("could not create ground fill texture");
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const grass = scene.textures.get(CF.grass).getSourceImage() as CanvasImageSource;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) ctx.drawImage(grass, 0, 0, TILE, TILE, c * TILE, r * TILE, TILE, TILE);
  tex.refresh();
}

export function drawLicensedGround(scene: Phaser.Scene, blocked: (x: number, y: number) => boolean) {
  if (scene.textures.exists("ground")) scene.textures.remove("ground");
  const tex = scene.textures.createCanvas("ground", WORLD_W, WORLD_H);
  if (!tex) throw new Error("could not create ground texture");
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const img = (key: string) => scene.textures.get(key).getSourceImage() as CanvasImageSource;
  const grass = img(CF.grass), path = img(CF.path), water = img(CF.water), decor = img(CF.decor);
  const rng = mulberry32(42);
  const pixels = (src: CanvasImageSource, w: number, h: number) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d")!;
    cx.drawImage(src, 0, 0);
    return cx.getImageData(0, 0, w, h).data;
  };
  // Path tiles keep the pack's bushy outline and shape; only their dirt-colored pixels become cobblestone.
  const cobble = scene.textures.exists(COBBLE) ? pixels(img(COBBLE), COBBLE_SIZE, COBBLE_SIZE) : null;
  const pathPx = cobble ? pixels(path, 48, 96) : null;
  const nearDirt = (r: number, g: number, b: number) =>
    [[228, 166, 114], [184, 111, 80]].some(([R, G, B]) => Math.abs(r - R) + Math.abs(g - G) + Math.abs(b - B) < 45);
  const cobbleTile = (tc: number, tr: number, c: number, r: number) => {
    const out = ctx.createImageData(TILE, TILE);
    for (let py = 0; py < TILE; py++) {
      for (let px = 0; px < TILE; px++) {
        const si = ((tr * TILE + py) * 48 + tc * TILE + px) * 4;
        const o = (py * TILE + px) * 4;
        const useCobble = nearDirt(pathPx![si], pathPx![si + 1], pathPx![si + 2]);
        const ci = ((((r * TILE + py) % COBBLE_SIZE) * COBBLE_SIZE) + ((c * TILE + px) % COBBLE_SIZE)) * 4;
        const from = useCobble ? cobble! : pathPx!;
        const fi = useCobble ? ci : si;
        out.data[o] = from[fi];
        out.data[o + 1] = from[fi + 1];
        out.data[o + 2] = from[fi + 2];
        out.data[o + 3] = 255;
      }
    }
    ctx.putImageData(out, c * TILE, r * TILE);
  };

  const tile = (src: CanvasImageSource, tc: number, tr: number, c: number, r: number) =>
    ctx.drawImage(src, tc * TILE, tr * TILE, TILE, TILE, c * TILE, r * TILE, TILE, TILE);

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isPath(c, r)) {
        const [tc, tr] = blobTile(isPath, c, r);
        if (cobble) cobbleTile(tc, tr, c, r);
        // an occasional pebble tile on open dirt path (sheet row 5)
        else if (tc === 1 && tr === 1 && rng() < 0.12) tile(path, Math.floor(rng() * 3), 5, c, r);
        else tile(path, tc, tr, c, r);
      } else if (isWater(c, r)) {
        const [tc, tr] = blobTile(isWater, c, r);
        tile(water, tc, tr, c, r);
      } else {
        tile(grass, 0, 0, c, r);
      }
    }
  }

  // loose grass tufts and flowers on open grass
  const spots: DecorName[] = ["tuft", "tuftSmall", "flowerWhite", "flowerYellow", "flowerPink", "flowerGold", "tuft"];
  for (let i = 0; i < 90; i++) {
    const x = 12 + Math.floor(rng() * (WORLD_W - 24));
    const y = 28 + Math.floor(rng() * (WORLD_H - 40));
    const name = spots[Math.floor(rng() * spots.length)];
    if (isPath(Math.floor(x / TILE), Math.floor(y / TILE)) || isWater(Math.floor(x / TILE), Math.floor(y / TILE)) || blocked(x, y)) continue;
    const [sx, sy, w, h] = DECOR[name];
    ctx.drawImage(decor, sx, sy, w, h, x - (w >> 1), y - h, w, h);
  }
  tex.refresh();
}
