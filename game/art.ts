import type Phaser from "phaser";
import { makeTexture, mulberry32, type Painter } from "./pixel";
import { COLS, FOUNTAIN, ROWS, TILE, POND, POND_SPOTS, WORLD_H, WORLD_W, inPond, isPath, isPlaza, flowerSpots, BUSHES, type TreeKind } from "./layout";

const OUT = "#3a2a1f";
const WOOD = "#7a4a24";
const WOOD_D = "#5a3718";
const GLASS = "#8fd0f0";

// ---------- ground ----------
const GRASS = ["#6dbb4a", "#66b445", "#72c14f"];
const SAND = ["#e0c28f", "#d9ba85", "#e5c997"];

export function drawGround(scene: Phaser.Scene) {
  const rng = mulberry32(42);
  makeTexture(scene, "ground", WORLD_W, WORLD_H, (g) => {
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const x = c * TILE;
        const y = r * TILE;
        if (isPath(c, r)) {
          drawPathTile(g, c, r, x, y, rng);
        } else {
          g.r(x, y, TILE, TILE, GRASS[Math.floor(rng() * 3)]);
          for (let i = 0; i < 4; i++) {
            const px = x + Math.floor(rng() * 15);
            const py = y + Math.floor(rng() * 14);
            g.p(px, py, "#5aa43c");
            g.p(px + 1, py - 1, "#86d062");
          }
        }
      }
    }
    drawPond(g);
    // flowers in patches by the doors, pond and trail
    const colors = ["#ffffff", "#ff9ec4", "#ffd84a", "#9ec9ff", "#ff7b6b"];
    for (const { x, y, roll } of flowerSpots()) {
      const col = colors[Math.floor(roll * colors.length)];
      g.p(x, y, col);
      g.p(x + 1, y + 1, col);
      g.p(x + 1, y, "#ffd84a");
      g.p(x, y + 1, "#3f8f3a");
    }
  });
}

/** Seamless grass patch, tiled under and around the village by a tile sprite (see TownScene). */
export function drawGroundFill(scene: Phaser.Scene) {
  const rng = mulberry32(5);
  makeTexture(scene, "ground_fill", 64, 64, (g) => {
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        g.r(c * TILE, r * TILE, TILE, TILE, GRASS[Math.floor(rng() * 3)]);
        for (let i = 0; i < 4; i++) {
          const px = c * TILE + Math.floor(rng() * 15);
          const py = r * TILE + 1 + Math.floor(rng() * 14);
          g.p(px, py, "#5aa43c");
          g.p(px + 1, py - 1, "#86d062");
        }
      }
    }
  });
}

function drawPathTile(g: Painter, c: number, r: number, x: number, y: number, rng: () => number) {
  if (isPlaza(c, r)) {
    g.r(x, y, TILE, TILE, "#bdb6a6");
    g.r(x, y, 8, 8, "#c9c2b2");
    g.r(x + 8, y + 8, 8, 8, "#c9c2b2");
    g.r(x + 8, y, 1, 8, "#a39c8b");
    g.r(x, y + 8, 16, 1, "#a39c8b");
    g.r(x, y, 16, 1, "#a39c8b");
    g.r(x, y, 1, 16, "#a39c8b");
  } else {
    g.r(x, y, TILE, TILE, SAND[Math.floor(rng() * 3)]);
    for (let i = 0; i < 3; i++) g.p(x + Math.floor(rng() * 16), y + Math.floor(rng() * 16), "#c4a572");
    g.p(x + Math.floor(rng() * 16), y + Math.floor(rng() * 16), "#f0dcb0");
  }
  // soft grass-side edges
  const edge = (cond: boolean, ex: number, ey: number, ew: number, eh: number) => {
    if (cond) g.r(x + ex, y + ey, ew, eh, "#b99a68");
  };
  edge(!isPath(c, r - 1), 0, 0, 16, 1);
  edge(!isPath(c, r + 1), 0, 15, 16, 1);
  edge(!isPath(c - 1, r), 0, 0, 1, 16);
  edge(!isPath(c + 1, r), 15, 0, 1, 16);
}

function drawPond(g: Painter) {
  for (let y = POND.y0 - 2; y <= POND.y1 + 2; y++) {
    for (let x = POND.x0 - 2; x <= POND.x1 + 2; x++) {
      if (!inPond(x, y)) continue;
      const edge = !inPond(x - 1, y) || !inPond(x + 1, y) || !inPond(x, y - 1) || !inPond(x, y + 1);
      const near = !inPond(x - 3, y) || !inPond(x + 3, y) || !inPond(x, y - 3) || !inPond(x, y + 3);
      g.p(x, y, edge ? "#7b6a52" : near ? "#3f8fc9" : (x + y) % 7 === 0 ? "#7cc6ee" : "#58b0e4");
    }
  }
  // lily pads + shimmer
  for (const [x, y] of POND_SPOTS.slice(0, 3)) {
    g.ell(x, y, 3, 2, "#4b9a3c");
    g.p(x + 1, y, "#ff9ec4");
  }
  for (const [x, y] of POND_SPOTS) g.r(x - 8, y + 6, 4, 1, "#bfe7fb");
}

// ---------- props ----------
const TREE_COLORS: Record<TreeKind, [string, string, string]> = {
  oak: ["#2f7a35", "#3f9340", "#6cc25a"],
  oak2: ["#3a8a30", "#52a83c", "#86d062"],
  blossom: ["#d9709a", "#f19bbd", "#ffd0e0"],
  autumn: ["#c8681f", "#e48a2a", "#f7c25a"],
};

export function drawProps(scene: Phaser.Scene) {
  for (const kind of Object.keys(TREE_COLORS) as TreeKind[]) {
    const [dark, mid, light] = TREE_COLORS[kind];
    const rng = mulberry32(kind.length * 31);
    makeTexture(scene, `tree_${kind}`, 24, 32, (g) => {
      g.r(10, 20, 4, 12, WOOD);
      g.r(13, 20, 1, 12, WOOD_D);
      g.r(9, 30, 6, 2, WOOD);
      g.disc(12, 12, 10, dark);
      g.disc(11, 10, 9, mid);
      g.disc(9, 7, 5, light);
      for (let i = 0; i < 14; i++) {
        const a = rng() * Math.PI * 2;
        const d = rng() * 8;
        g.p(Math.round(12 + Math.cos(a) * d), Math.round(11 + Math.sin(a) * d), i % 2 ? light : dark);
      }
    }, OUT);
  }
  makeTexture(scene, "bush", 16, 10, (g) => {
    g.disc(5, 6, 4, "#2f7a35");
    g.disc(11, 6, 4, "#2f7a35");
    g.disc(8, 4, 4, "#3f9340");
    g.p(6, 3, "#ff9ec4"); g.p(10, 5, "#ffd84a"); g.p(8, 2, "#ffffff"); g.p(4, 6, "#ff9ec4"); g.p(12, 7, "#ffffff");
  }, OUT);
  makeTexture(scene, "lamp", 8, 24, (g) => {
    g.r(3, 8, 2, 16, "#4a4a55");
    g.r(1, 22, 6, 2, "#4a4a55");
    g.r(1, 2, 6, 7, "#ffe28a");
    g.r(2, 3, 4, 5, "#fff6c8");
    g.r(0, 1, 8, 2, "#4a4a55");
  }, OUT);
  makeTexture(scene, "bench", 20, 10, (g) => {
    g.r(1, 1, 18, 2, "#a8743a"); g.r(1, 4, 18, 2, "#8b5a2b");
    g.r(2, 6, 2, 4, WOOD_D); g.r(16, 6, 2, 4, WOOD_D);
    g.r(1, 1, 18, 1, "#c18a4a");
  }, OUT);
  makeTexture(scene, "mailbox", 8, 14, (g) => {
    g.r(3, 6, 2, 8, WOOD);
    g.r(0, 0, 8, 6, "#c0392b"); g.r(1, 1, 6, 1, "#e5604f");
    g.r(6, 1, 1, 3, "#ffd84a");
  }, OUT);
  makeTexture(scene, "fence", 16, 10, (g) => {
    g.r(0, 3, 16, 1, "#e9dcc0"); g.r(0, 6, 16, 1, "#e9dcc0");
    for (const x of [1, 6, 11]) { g.r(x, 1, 3, 9, "#f4ead2"); g.r(x, 1, 3, 1, "#fff8e6"); g.r(x + 2, 2, 1, 8, "#cdbf9f"); }
  }, OUT);
  makeTexture(scene, "rock", 10, 7, (g) => {
    g.ell(5, 4, 4, 2, "#8d8d96"); g.ell(4, 3, 3, 2, "#aaaab3"); g.p(3, 2, "#d0d0d8");
  }, OUT);
  makeTexture(scene, "puff", 6, 6, (g) => { g.disc(3, 3, 2, "rgba(255,255,255,0.8)"); });
  makeTexture(scene, "spark", 7, 7, (g) => {
    g.r(3, 0, 1, 7, "#ffe28a"); g.r(0, 3, 7, 1, "#ffe28a"); g.r(2, 2, 3, 3, "#fff6c8");
  });
  makeTexture(scene, "fountain", 32, 32, (g) => {
    g.ell(16, 23, 15, 8, "#8d8d96");
    g.ell(16, 22, 15, 8, "#c9c9d1");
    g.ell(16, 22, 12, 6, "#58b0e4");
    g.ell(16, 23, 9, 3, "#7cc6ee");
    g.r(14, 9, 4, 13, "#b0b0ba"); g.r(14, 9, 1, 13, "#d8d8e0");
    g.ell(16, 9, 6, 2, "#c9c9d1"); g.ell(16, 9, 4, 1, "#58b0e4");
    for (const [x, y] of [[16, 4], [16, 2], [14, 6], [18, 6], [12, 8], [20, 8], [11, 19], [21, 20]]) g.p(x, y, "#bfe7fb");
  }, OUT);
  void FOUNTAIN; void BUSHES;
}

// ---------- buildings ----------
function brickLines(g: Painter, x: number, y: number, w: number, h: number, line: string, step = 4) {
  for (let yy = 0; yy < h; yy += step) {
    g.r(x, y + yy, w, 1, line);
    for (let xx = (yy / step) % 2 ? 0 : step; xx < w; xx += step * 2) g.r(x + xx, y + yy, 1, step, line);
  }
}

function drawWindow(g: Painter, x: number, y: number, w: number, h: number, lit: boolean) {
  g.r(x - 1, y - 1, w + 2, h + 2, WOOD);
  g.r(x, y, w, h, lit ? "#ffe29a" : GLASS);
  g.r(x + Math.floor(w / 2), y, 1, h, WOOD);
  g.r(x, y + Math.floor(h / 2), w, 1, WOOD);
  if (!lit) { g.p(x + 1, y + 1, "#e6f7ff"); g.p(x + 2, y + 1, "#e6f7ff"); }
}

function flowerBox(g: Painter, x: number, y: number, w: number) {
  g.r(x, y, w, 3, WOOD);
  for (let i = 1; i < w; i += 3) {
    g.p(x + i, y - 1, i % 2 ? "#ff7b6b" : "#ffd84a");
    g.p(x + i, y - 2, "#3f9340");
  }
}

export function drawBuildings(scene: Phaser.Scene) {
  // Tier 1: cozy cottage 64x62
  makeTexture(scene, "home_1", 64, 62, (g) => {
    g.r(46, 2, 8, 18, "#a8523a"); brickLines(g, 46, 2, 8, 18, "#7e3a28", 3); g.r(44, 0, 12, 3, "#7c7468");
    for (let y = 0; y < 12; y++) { const inset = (11 - y) * 2; g.r(inset, y + 4, 64 - inset * 2, 1, y % 4 === 3 ? "#8e3322" : "#b5472f"); }
    g.r(0, 16, 64, 12, "#b5472f");
    for (let y = 4; y < 28; y += 4) {
      const lo = y < 16 ? (11 - (y - 4)) * 2 : 0;
      g.r(lo, y + 3, 64 - lo * 2, 1, "#8e3322");
      for (let x = (y / 4) % 2 ? 3 : 0; x < 64; x += 6) if (x > lo && x < 64 - lo) g.r(x, y, 1, 3, "#8e3322");
    }
    g.r(0, 27, 64, 1, "#6e2818");
    g.r(5, 28, 54, 2, "#a88a5c");
    g.r(5, 30, 54, 26, "#ead7ac");
    for (let x = 9; x < 59; x += 4) g.r(x, 30, 1, 26, "#d2bb88");
    g.r(5, 54, 54, 8, "#9b9488"); brickLines(g, 5, 54, 54, 8, "#7c7468", 4);
    g.r(24, 60, 16, 2, "#b0a898");
    g.r(26, 40, 12, 20, WOOD); g.r(27, 41, 4, 8, WOOD_D); g.r(33, 41, 4, 8, WOOD_D);
    g.r(27, 51, 4, 8, WOOD_D); g.r(33, 51, 4, 8, WOOD_D); g.p(35, 52, "#f2c14e");
    drawWindow(g, 11, 36, 10, 10, false); drawWindow(g, 43, 36, 10, 10, false);
    g.r(8, 35, 2, 12, "#4c8f3a"); g.r(22, 35, 2, 12, "#4c8f3a"); g.r(40, 35, 2, 12, "#4c8f3a"); g.r(54, 35, 2, 12, "#4c8f3a");
    flowerBox(g, 10, 48, 12); flowerBox(g, 42, 48, 12);
  }, OUT);

  // Tier 2: manor 96x78
  makeTexture(scene, "home_2", 96, 78, (g) => {
    for (const cx of [20, 68]) { g.r(cx, 3, 9, 20, "#b05a42"); brickLines(g, cx, 3, 9, 20, "#7e3a28", 3); g.r(cx - 1, 1, 11, 3, "#8a8274"); }
    for (let y = 0; y < 14; y++) { const inset = (13 - y) * 3; g.r(inset, y + 4, 96 - inset * 2, 1, y % 4 === 3 ? "#3b5578" : "#4f6f9a"); }
    g.r(0, 18, 96, 18, "#4f6f9a");
    for (let y = 4; y < 36; y += 4) {
      const lo = y < 18 ? (13 - (y - 4)) * 3 : 0;
      const l = Math.max(0, lo);
      g.r(l, y + 3, 96 - l * 2, 1, "#3b5578");
      for (let x = (y / 4) % 2 ? 4 : 0; x < 96; x += 8) if (x > l && x < 96 - l) g.r(x, y, 1, 3, "#3b5578");
    }
    g.r(0, 35, 96, 1, "#2c4160");
    // dormer
    g.r(38, 22, 20, 14, "#f1e3c0");
    for (let i = 0; i < 8; i++) g.r(37 + i, 15 + i, 22 - i * 2, 1, "#6b8bb8");
    for (let i = 0; i < 8; i++) g.p(37 + i, 15 + i, "#2c4160");
    drawWindow(g, 43, 25, 10, 9, true);
    // timber upper floor
    g.r(5, 36, 86, 2, "#9a7a4e");
    g.r(5, 38, 86, 18, "#f1e3c0");
    for (const x of [5, 30, 64, 89]) g.r(x, 38, 2, 18, WOOD);
    g.r(5, 46, 86, 1, WOOD);
    drawWindow(g, 12, 41, 10, 10, true); drawWindow(g, 74, 41, 10, 10, true);
    drawWindow(g, 35, 42, 8, 8, true); drawWindow(g, 53, 42, 8, 8, true);
    // stone lower floor
    g.r(5, 56, 86, 20, "#b3a995"); brickLines(g, 5, 56, 86, 20, "#8d8472", 5);
    g.r(5, 74, 86, 4, "#8d8472");
    drawWindow(g, 11, 60, 12, 10, false); drawWindow(g, 73, 60, 12, 10, false);
    g.r(8, 59, 2, 12, "#3f7d4a"); g.r(24, 59, 2, 12, "#3f7d4a"); g.r(70, 59, 2, 12, "#3f7d4a"); g.r(86, 59, 2, 12, "#3f7d4a");
    flowerBox(g, 11, 71, 12); flowerBox(g, 73, 71, 12);
    // door + awning
    g.r(34, 52, 28, 4, "#3f7d4a"); for (let x = 34; x < 62; x += 4) g.r(x, 55, 2, 2, "#e9dcc0");
    g.r(36, 56, 2, 20, "#e9dcc0"); g.r(58, 56, 2, 20, "#e9dcc0");
    g.r(40, 57, 16, 19, WOOD); g.r(41, 58, 6, 8, WOOD_D); g.r(49, 58, 6, 8, WOOD_D);
    g.r(41, 68, 6, 7, WOOD_D); g.r(49, 68, 6, 7, WOOD_D); g.p(47, 66, "#f2c14e"); g.p(48, 66, "#f2c14e");
    g.r(32, 76, 32, 2, "#c9c0aa");
  }, OUT);

  // Bank 96x78
  makeTexture(scene, "bank", 96, 78, (g) => {
    for (let y = 0; y < 18; y++) {
      const half = Math.floor((y + 1) * 2.3);
      g.r(48 - half, y, half * 2, 1, "#ddd5c0");
      g.p(48 - half, y, "#a79e88"); g.p(47 + half, y, "#a79e88");
    }
    g.r(6, 17, 84, 1, "#a79e88");
    g.disc(48, 10, 5, "#c99a1e"); g.disc(48, 10, 4, "#f0c53a"); g.disc(48, 10, 2, "#f9dd7a");
    g.r(48, 7, 1, 7, "#b8860b");
    g.r(2, 18, 92, 4, "#c4bba5"); g.r(0, 22, 96, 3, "#a79e88");
    g.r(4, 25, 88, 49, "#dfd7c2");
    brickLines(g, 4, 25, 88, 49, "#cbc2ab", 7);
    for (const x of [6, 20, 70, 84]) {
      g.r(x, 25, 6, 50, "#f1ebdb"); g.r(x + 4, 25, 2, 50, "#cbc2ab"); g.r(x - 1, 25, 8, 3, "#c4bba5"); g.r(x - 1, 72, 8, 3, "#c4bba5");
    }
    // plaque + BANK
    g.r(30, 27, 36, 14, "#5c3d22"); g.r(31, 28, 34, 12, "#7a5230");
    const font: Record<string, string[]> = {
      B: ["11.", "1.1", "11.", "1.1", "11."], A: [".1.", "1.1", "111", "1.1", "1.1"],
      N: ["1.1", "111", "111", "111", "1.1"], K: ["1.1", "1.1", "11.", "1.1", "1.1"],
    };
    "BANK".split("").forEach((ch, i) => {
      font[ch].forEach((row, ry) => row.split("").forEach((v, rx) => {
        if (v === "1") g.r(36 + i * 8 + rx * 2, 30 + ry * 2, 2, 2, "#f6d36a");
      }));
    });
    // door
    g.r(37, 44, 22, 30, "#5c3d22");
    g.r(38, 45, 20, 29, WOOD); g.r(47, 45, 2, 29, "#5c3d22");
    for (let i = 0; i < 4; i++) g.r(38 + i, 45 + (i === 0 ? 2 : i === 1 ? 1 : 0), 20 - i * 0, 1, WOOD);
    g.r(40, 48, 6, 10, "#8b5a2b"); g.r(50, 48, 6, 10, "#8b5a2b");
    g.r(40, 61, 6, 11, "#8b5a2b"); g.r(50, 61, 6, 11, "#8b5a2b");
    g.p(45, 60, "#f6d36a"); g.p(50, 60, "#f6d36a");
    g.r(38, 43, 20, 2, "#c99a1e");
    // windows
    for (const wx of [28, 60]) {
      g.r(wx, 47, 8, 14, "#5c3d22"); g.r(wx + 1, 48, 6, 12, GLASS);
      for (const bx of [2, 4, 6]) g.r(wx + bx - 1, 48, 1, 12, "#5c3d22");
    }
    g.r(12, 74, 72, 2, "#c9c0aa"); g.r(8, 76, 80, 2, "#b3aa94");
  }, OUT);

  // School 96x78: temporary code-drawn art (blue-roofed brick schoolhouse, bell tower, book sign). No text.
  makeTexture(scene, "school", 96, 78, (g) => {
    const BRICK = "#b5553a", BRICK_D = "#8f3f2a", ROOF = "#3b5a8c", ROOF_L = "#4a6ea6", ROOF_D = "#2a416a", TRIM = "#f1e3c0", STONE = "#8d8472";
    // bell tower
    g.p(48, 0, "#e0a526"); g.r(47, 1, 3, 2, "#e0a526");
    for (let i = 0; i < 7; i++) g.r(48 - (2 + i * 2), 3 + i, (2 + i * 2) * 2 + 1, 1, i % 3 === 0 ? ROOF_L : ROOF);
    g.r(36, 10, 25, 1, ROOF_D); g.r(41, 11, 15, 12, TRIM); g.r(43, 12, 11, 10, "#3a2a1f");
    g.disc(48, 16, 3, "#e0a526"); g.r(46, 19, 5, 2, "#c99a1e"); g.r(41, 11, 2, 12, WOOD); g.r(54, 11, 2, 12, WOOD);
    // main hip roof
    for (let y = 22; y < 40; y++) {
      const inset = Math.max(0, Math.floor((28 - y) * 0.5));
      g.r(inset, y, 96 - inset * 2, 1, y % 4 === 0 ? ROOF_D : y % 4 === 2 ? ROOF_L : ROOF);
      for (let x = (y % 8 < 4 ? 4 : 0) + inset; x < 96 - inset; x += 8) g.p(x, y, ROOF_D);
    }
    g.r(0, 40, 96, 2, WOOD); g.r(0, 42, 96, 1, WOOD_D);
    // entrance gable (timber and plaster)
    for (let y = 0; y < 16; y++) {
      const half = 3 + y;
      g.r(48 - half, 26 + y, half * 2, 1, y < 2 ? WOOD : TRIM);
      g.p(48 - half, 26 + y, WOOD); g.p(47 + half, 26 + y, WOOD);
    }
    g.r(30, 41, 36, 2, WOOD);
    for (let i = 0; i < 12; i++) { g.p(36 + i, 26 + 4 - Math.floor(i / 3), ROOF_D); }
    g.r(46, 30, 4, 11, WOOD); g.r(36, 37, 24, 1, WOOD);
    // book sign
    g.r(38, 33, 20, 8, "#7a5a1e"); g.r(39, 34, 18, 6, "#5c3d22");
    g.r(40, 35, 7, 4, "#fffaf0"); g.r(49, 35, 7, 4, "#fffaf0"); g.r(47, 34, 2, 6, "#5c3d22");
    for (const y of [36, 38]) { g.r(41, y, 5, 1, "#c4bba5"); g.r(50, y, 5, 1, "#c4bba5"); }
    // brick walls
    g.r(4, 43, 88, 28, BRICK); brickLines(g, 4, 43, 88, 28, BRICK_D, 5);
    g.r(4, 65, 88, 6, STONE); for (let x = 4; x < 92; x += 10) g.r(x, 66, 1, 5, "#6e6656");
    // windows (cream frames, blue glass)
    for (const wx of [10, 23, 64, 77]) {
      g.r(wx - 1, 48, 12, 16, TRIM); g.r(wx + 1, 50, 8, 12, "#2a5fa8"); g.r(wx + 1, 50, 8, 12, GLASS);
      g.r(wx + 4, 50, 2, 12, "#5c3d22"); g.r(wx + 1, 55, 8, 1, "#5c3d22"); g.p(wx + 2, 51, "#ffffff"); g.p(wx + 7, 57, "#ffffff");
    }
    // entrance pillars, double door, lanterns
    g.r(31, 43, 4, 23, TRIM); g.r(61, 43, 4, 23, TRIM); g.r(31, 43, 4, 2, STONE); g.r(61, 43, 4, 2, STONE);
    g.r(37, 46, 22, 20, "#3a2a1f"); g.r(38, 47, 20, 19, WOOD); g.r(47, 47, 2, 19, "#3a2a1f");
    g.r(40, 49, 6, 7, WOOD_D); g.r(50, 49, 6, 7, WOOD_D); g.r(40, 58, 6, 7, WOOD_D); g.r(50, 58, 6, 7, WOOD_D);
    g.p(45, 58, "#f6d36a"); g.p(50, 58, "#f6d36a"); g.r(37, 45, 22, 2, TRIM);
    for (const lx of [28, 66]) { g.r(lx, 50, 3, 5, "#3a2a1f"); g.r(lx, 51, 3, 3, "#f6c24a"); g.p(lx + 1, 52, "#fff1b0"); }
    // steps
    g.r(33, 66, 30, 2, "#c9c0aa"); g.r(31, 68, 34, 2, "#b3aa94"); g.r(29, 70, 38, 2, "#a79e88");
    g.r(4, 71, 88, 2, "#8d8472");
  }, OUT);

  // player frames
  drawPlayer(scene);
}

// ---------- player ----------
export type Dir = "down" | "up" | "left" | "right";

function drawPlayer(scene: Phaser.Scene) {
  const skin = "#f2c9a0", hair = "#6b3f1f", hairL = "#8b5a2b", shirt = "#3a7ca5", shirtD = "#2d6385", pants = "#4a4e69", boot = "#3a2a1f", hat = "#d9a441";
  (["down", "up", "left", "right"] as Dir[]).forEach((dir) => {
    for (let f = 0; f < 3; f++) {
      makeTexture(scene, `player_${dir}_${f}`, 16, 22, (g) => {
        const side = dir === "left" || dir === "right";
        const flip = dir === "left";
        const X = (x: number, w = 1) => (flip ? 16 - x - w : x);
        // legs
        const lift = (leg: 0 | 1) => (f === 1 && leg === 0) || (f === 2 && leg === 1) ? 1 : 0;
        if (side) {
          const sw = f === 0 ? 0 : f === 1 ? -2 : 2;
          g.r(X(6 + sw, 3), 15, 3, 5 - lift(0), pants); g.r(X(7 - sw, 3), 15, 3, 5 - lift(1), pants);
          g.r(X(6 + sw, 3), 19 - lift(0), 3, 2, boot); g.r(X(7 - sw, 3), 19 - lift(1), 3, 2, boot);
        } else {
          g.r(5, 15, 3, 5 - lift(0), pants); g.r(8, 15, 3, 5 - lift(1), pants);
          g.r(5, 19 - lift(0), 3, 2, boot); g.r(8, 19 - lift(1), 3, 2, boot);
        }
        // torso
        g.r(4, 9, 8, 7, shirt); g.r(4, 14, 8, 1, shirtD); g.r(4, 14, 8, 1, "#8b5a2b");
        if (side) { g.r(X(6, 4), 10, 4, 5, shirtD); g.r(X(7, 2), 11, 2, 3, skin); } else {
          g.r(3, 10, 1, 5, shirtD); g.r(12, 10, 1, 5, shirtD); g.r(3, 14, 1, 1, skin); g.r(12, 14, 1, 1, skin);
        }
        // head
        g.r(4, 3, 8, 7, skin);
        if (dir === "down") { g.p(6, 6, "#2a1a10"); g.p(9, 6, "#2a1a10"); g.p(6, 8, "#e8a88a"); g.p(9, 8, "#e8a88a"); }
        if (dir === "left" || dir === "right") { g.p(X(5), 6, "#2a1a10"); g.r(X(10, 2), 3, 2, 6, hair); }
        if (dir === "up") g.r(4, 3, 8, 7, hair);
        // hair + straw hat
        g.r(3, 2, 10, 2, hair); g.r(3, 4, 1, 3, hair); g.r(12, 4, 1, 3, hair);
        if (dir === "up") { g.r(3, 2, 10, 8, hair); g.r(5, 4, 3, 1, hairL); }
        g.r(1, 1, 14, 2, hat); g.r(4, -0, 8, 2, hat); g.r(4, 1, 8, 1, "#c4562b");
      }, OUT);
    }
  });
}
