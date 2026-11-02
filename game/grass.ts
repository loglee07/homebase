// The lawn texture: one quiet base green with soft, low-contrast variation (smooth blotches a few shades apart, no tile
// patches) and sparse, deliberately grouped tufts: a cluster of two to four short blades (dark root, body, lit tip) in about
// one cell in nine, so most of the lawn is clear. Everything is whole logical pixels, a pure function of the pixel's
// position, so the village and the fill around it agree; with `wrap` it repeats seamlessly every `wrap` pixels (a multiple of
// 16, for the small fill tile). No blur, no overlay, no color filter.
import { hash01 } from "./layout";

export type RGB = [number, number, number];
const CELL = 16;
const NOISE = 16; // lattice spacing of the soft variation (divides the 64px fill tile)
const TUFT_CHANCE = 0.11;
const clamp = (v: number) => Math.max(0, Math.min(255, v));
const shade = (c: RGB, d: number): RGB => [clamp(c[0] + d), clamp(c[1] + d * 1.1), clamp(c[2] + d * 0.7)];

/** Smooth value noise in [0, 1), wrapping every `period` lattice steps when given. */
function vnoise(x: number, y: number, period: number): number {
  const gx = Math.floor(x / NOISE), gy = Math.floor(y / NOISE);
  const fx = x / NOISE - gx, fy = y / NOISE - gy;
  const m = (v: number) => (period ? ((v % period) + period) % period : v);
  const v = (i: number, j: number) => hash01(m(i) * 31 + 7, m(j) * 17 + 3);
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const top = v(gx, gy) * (1 - sx) + v(gx + 1, gy) * sx, bot = v(gx, gy + 1) * (1 - sx) + v(gx + 1, gy + 1) * sx;
  return top * (1 - sy) + bot * sy;
}

// A tuft's blades: [dx, dy of the root from the cluster anchor, height]. Three layouts, picked per cluster.
const TUFTS: [number, number, number][][] = [
  [[-2, 0, 3], [0, 1, 2], [2, 0, 3]],
  [[-1, 0, 2], [1, 1, 3]],
  [[-2, 1, 2], [0, 0, 3], [2, 1, 2], [3, 0, 2]],
];

/** The tuft shade at a pixel, or null when no blade stands there. Each cluster sits well inside its own cell. */
function tuft(x: number, y: number, wrap: number): number | null {
  const cells = wrap ? wrap / CELL : 0;
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  const ix = cells ? ((cx % cells) + cells) % cells : cx, iy = cells ? ((cy % cells) + cells) % cells : cy;
  if (hash01(ix * 7 + 3, iy * 13 + 5) >= TUFT_CHANCE) return null;
  const ax = 5 + Math.floor(hash01(ix * 5 + 1, iy * 3 + 9) * 6), ay = 7 + Math.floor(hash01(ix * 11 + 2, iy * 7 + 4) * 5);
  const lx = x - cx * CELL - ax, ly = y - cy * CELL - ay;
  for (const [dx, dy, h] of TUFTS[Math.floor(hash01(ix * 3 + 8, iy * 5 + 6) * TUFTS.length)]) {
    if (lx !== dx) continue;
    const k = dy - ly; // pixels above the root
    if (k < 0 || k >= h) continue;
    return k === 0 ? -12 : k === h - 1 ? 12 : 3;
  }
  return null;
}

/** The lawn color at a pixel, given the area's base green. */
export function grassRGB(x: number, y: number, base: RGB, wrap = 0): RGB {
  const t = tuft(x, y, wrap);
  if (t !== null) return shade(base, t);
  const n = vnoise(x, y, wrap ? wrap / NOISE : 0);
  return n > 0.66 ? shade(base, 3) : n < 0.34 ? shade(base, -3) : base;
}
