import { describe, expect, it } from "vitest";
import { grassRGB, type RGB } from "../game/grass";

const BASE: RGB = [78, 149, 68];
const lum = (c: RGB) => (c[0] + c[1] + c[2]) / 3;
const N = 256;

describe("lawn texture", () => {
  const px = (x: number, y: number) => grassRGB(x, y, BASE);
  it("is a pure function of the pixel", () => {
    for (let i = 0; i < 50; i++) expect(px(i * 7, i * 3)).toEqual(px(i * 7, i * 3));
  });
  it("is quiet: nearly all pixels sit within a few shades of the base, no per-pixel speckle", () => {
    let near = 0, tuft = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.abs(lum(px(x, y)) - lum(BASE));
      if (d <= 4) near++;
      else tuft++;
    }
    expect(near / (N * N)).toBeGreaterThan(0.93);
    expect(tuft / (N * N)).toBeGreaterThan(0.002); // but tufts do exist
    // soft variation changes slowly: horizontal neighbours rarely differ outside tufts
    let flips = 0;
    for (let y = 0; y < N; y++) for (let x = 1; x < N; x++) if (lum(px(x, y)) !== lum(px(x - 1, y)) && Math.abs(lum(px(x, y)) - lum(BASE)) <= 4 && Math.abs(lum(px(x - 1, y)) - lum(BASE)) <= 4) flips++;
    expect(flips / (N * N)).toBeLessThan(0.08);
  });
  it("groups tufts: they sit in clusters of at least two blades and leave most of the lawn clear", () => {
    const cells = new Map<string, number>();
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (Math.abs(lum(px(x, y)) - lum(BASE)) > 8) cells.set(`${x >> 4},${y >> 4}`, (cells.get(`${x >> 4},${y >> 4}`) ?? 0) + 1);
    }
    const occupied = cells.size, total = (N / 16) ** 2;
    expect(occupied / total).toBeGreaterThan(0.04);
    expect(occupied / total).toBeLessThan(0.2);
    for (const n of cells.values()) expect(n).toBeGreaterThanOrEqual(3);
  });
  it("draws a blade as a dark root under a lit tip", () => {
    let tips = 0;
    for (let y = 2; y < N; y++) for (let x = 0; x < N; x++) {
      if (lum(px(x, y)) - lum(BASE) > 10) {
        tips++;
        expect(lum(px(x, y + 1)) <= lum(BASE) + 4).toBe(true); // the pixel below the tip is body or root, never another tip
      }
    }
    expect(tips).toBeGreaterThan(20);
  });
  it("repeats seamlessly when wrapped", () => {
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      expect(grassRGB(x + 64, y, BASE, 64)).toEqual(grassRGB(x, y, BASE, 64));
      expect(grassRGB(x, y + 128, BASE, 64)).toEqual(grassRGB(x, y, BASE, 64));
    }
  });
});
