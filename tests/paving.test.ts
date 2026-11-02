import { describe, expect, it } from "vitest";
import { PAVING_PALETTE, PAVING_ROWS, PAVING_SIZE } from "@/game/pavingData";
import { PATH_MASKS } from "@/game/pathMasks";
import { FRINGE, RIM, maskName, pavingAt, pavingLayer, pavingMask, pavingPixels } from "@/game/paving";
import { COLS, ROWS, TILE, WORLD_H, WORLD_W, isPath } from "@/game/layout";

const diff = (a: number[], b: number[]) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);

describe("paving texture", () => {
  it("is a square, palette-indexed tile with a small palette", () => {
    expect(PAVING_ROWS).toHaveLength(PAVING_SIZE);
    for (const r of PAVING_ROWS) expect(r).toHaveLength(PAVING_SIZE);
    expect(PAVING_PALETTE.length).toBeLessThanOrEqual(24);
  });
  it("repeats without a seam: the wrap is no rougher than the stonework's own neighbouring pixels", () => {
    const N = PAVING_SIZE;
    let wrapX = 0, wrapY = 0, inX = 0, inY = 0;
    for (let i = 0; i < N; i++) {
      wrapX += diff(pavingAt(N - 1, i), pavingAt(N, i));
      wrapY += diff(pavingAt(i, N - 1), pavingAt(i, N));
      for (let j = 0; j < N - 1; j++) { inX += diff(pavingAt(j, i), pavingAt(j + 1, i)); inY += diff(pavingAt(i, j), pavingAt(i, j + 1)); }
    }
    expect(wrapX / N).toBeLessThanOrEqual((inX / (N * (N - 1))) * 1.5);
    expect(wrapY / N).toBeLessThanOrEqual((inY / (N * (N - 1))) * 1.5);
  });
  it("uses a light, low-key stone grey with no hue swings", () => {
    expect(Math.max(...PAVING_PALETTE.map(([r, g, b]) => (r + g + b) / 3))).toBeGreaterThan(170);
    for (const [r, g, b] of PAVING_PALETTE) expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(30);
  });
});


describe("paving shape and edge", () => {
  const p = pavingPixels();
  const a = (x: number, y: number) => (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H ? 0 : p[(y * WORLD_W + x) * 4 + 3]);
  const is = (x: number, y: number, c: number[]) => p[(y * WORLD_W + x) * 4] === c[0] && p[(y * WORLD_W + x) * 4 + 1] === c[1] && p[(y * WORLD_W + x) * 4 + 2] === c[2];

  it("has a mask for every tile shape the autotiler can pick", () => {
    for (const k of ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br", "innerSE", "innerSW", "innerNE", "innerNW"]) expect(PATH_MASKS[k], k).toHaveLength(16);
    const has = (c: number, r: number) => isPath(c, r);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (has(c, r)) expect(PATH_MASKS[maskName(has, c, r)]).toBeTruthy();
  });
  it("never blends: every pixel is fully clear or fully opaque", () => {
    for (let i = 0; i < WORLD_W * WORLD_H; i++) expect([0, 255]).toContain(p[i * 4 + 3]);
  });
  it("paves only on or beside path cells, and covers the middle of every path cell the shape reaches", () => {
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      if (!a(x, y)) continue;
      const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
      const near = [-1, 0, 1].some((dc) => [-1, 0, 1].some((dr) => isPath(c + dc, r + dr)));
      expect(near, `${x},${y} is far from any path`).toBe(true);
    }
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (isPath(c, r) && [-1, 0, 1].every((dc) => [-1, 0, 1].every((dr) => isPath(c + dc, r + dr)))) expect(a(c * TILE + 8, r * TILE + 8), `interior ${c},${r}`).toBe(255);
    }
  });
  const fringe = (x: number, y: number) => a(x, y) > 0 && FRINGE.some((f) => is(x, y, f));
  it("covers the outermost stones with grass clumps along a good part of the edge, never all of it", () => {
    let stone = 0, rim = 0, grass = 0;
    for (let y = 0; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
      if (!a(x, y)) continue;
      if (fringe(x, y)) grass++;
      else if (is(x, y, RIM)) rim++;
      else stone++;
    }
    expect(rim).toBeGreaterThan(100); // the contact edge is still there where no clump covers it
    expect(grass).toBeGreaterThan(rim * 0.8);
    expect(stone).toBeGreaterThan(grass * 2);
  });
  it("draws the grass over a boundary it does not change: the stone shape is the mask, the layer only adds green inside and just beside it", () => {
    const has = (c: number, r: number) => r === 3 || r === 4;
    const mask = pavingMask(has, 12, 8);
    const layer = pavingLayer(has, 12, 8);
    const W = 12 * TILE, H = 8 * TILE;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const solid = layer[(y * W + x) * 4 + 3] > 0;
      const green = solid && FRINGE.some((c) => layer[(y * W + x) * 4] === c[0] && layer[(y * W + x) * 4 + 1] === c[1] && layer[(y * W + x) * 4 + 2] === c[2]);
      if (mask[y * W + x]) expect(solid).toBe(true);
      else if (solid) {
        expect(green).toBe(true); // outside the stone only grass is drawn
        let near = false;
        for (let d = -6; d <= 6; d++) if (mask[Math.max(0, Math.min(H - 1, y + d)) * W + x] || mask[y * W + Math.max(0, Math.min(W - 1, x + d))]) near = true;
        expect(near).toBe(true);
      }
    }
  });
  it("varies the coverage along a straight edge: bare stretches, full stretches, several depths and widths", () => {
    const has = (c: number, r: number) => r === 3 || r === 4;
    const mask = pavingMask(has, 40, 8);
    const layer = pavingLayer(has, 40, 8);
    const W = 40 * TILE;
    const f = (x: number, y: number) => layer[(y * W + x) * 4 + 3] > 0 && FRINGE.some((c) => layer[(y * W + x) * 4] === c[0] && layer[(y * W + x) * 4 + 1] === c[1] && layer[(y * W + x) * 4 + 2] === c[2]);
    const depths: number[] = [];
    for (let x = TILE; x < 39 * TILE; x++) {
      let top = 0;
      while (!mask[top * W + x]) top++;
      let d = 0;
      while (mask[(top + d) * W + x] && f(x, top + d)) d++; // green pixels covering the stone, from the edge inward
      depths.push(d);
    }
    expect(new Set(depths).size).toBeGreaterThanOrEqual(3); // varied overlap depth
    // leaves are thin, so a column counts as covered when a leaf stands within two pixels of it
    const covered = depths.map((_, i) => depths.slice(Math.max(0, i - 2), i + 3).some((d) => d > 0));
    let bare = 0, longestBare = 0, full = 0, longestFull = 0;
    for (const c of covered) {
      bare = c ? 0 : bare + 1; longestBare = Math.max(longestBare, bare);
      full = c ? full + 1 : 0; longestFull = Math.max(longestFull, full);
    }
    expect(longestBare).toBeGreaterThanOrEqual(3); // a stretch with the stone showing
    expect(longestFull).toBeGreaterThanOrEqual(8); // and a fuller one
    expect(covered.filter(Boolean).length / covered.length).toBeGreaterThan(0.4);
    expect(covered.filter(Boolean).length / covered.length).toBeLessThan(0.97);
    // no strict period: the clump pattern does not repeat every n pixels
    for (const n of [4, 6, 8, 12, 16]) {
      let same = 0;
      for (let i = n; i < depths.length; i++) if (depths[i] === depths[i - n]) same++;
      expect(same / (depths.length - n)).toBeLessThan(0.9);
    }
  });
  it("draws a smooth, rounded boundary: no tooth on every repeated segment, ends and corners rounded", () => {
    // a straight 2-tile path: along its long edges the outline moves by at most one pixel across a whole tile run
    const has = (c: number, r: number) => r === 3 || r === 4;
    const mask = pavingMask(has, 12, 8);
    const W = 12 * TILE;
    const top = (x: number) => { for (let y = 0; y < 8 * TILE; y++) if (mask[y * W + x]) return y; return -1; };
    const tops = Array.from({ length: 8 * TILE }, (_, i) => top(2 * TILE + i));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
    let flips = 0;
    for (let i = 1; i < tops.length; i++) if (tops[i] !== tops[i - 1]) flips++;
    expect(flips).toBeLessThanOrEqual(2);
  });
});

describe("hand-drawn grass clumps", () => {
  it("are a small set of cohesive sprites in the lawn palette, five rows tall, drawn with a dark root, mid body and lit tip", async () => {
    const { CLUMPS, SMALL_CLUMPS } = await import("@/game/grassClumps");
    expect(CLUMPS.length).toBeGreaterThanOrEqual(5);
    expect(CLUMPS.length).toBeLessThanOrEqual(10);
    const widths = new Set<number>();
    for (const rows of CLUMPS) {
      expect(rows).toHaveLength(5);
      for (const r of rows) { expect(r).toMatch(/^[.dml]+$/); expect(r.length).toBe(rows[0].length); }
      widths.add(rows[0].length);
      const all = rows.join("");
      expect(all).toContain("d");
      expect(all).toContain("m");
      expect(all).toContain("l");
    }
    expect(widths.size).toBeGreaterThanOrEqual(4); // varied widths
    for (const i of SMALL_CLUMPS) expect(CLUMPS[i]).toBeDefined();
  });
});
