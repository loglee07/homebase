import type Phaser from "phaser";

export interface Painter {
  /** Filled rect. */
  r(x: number, y: number, w: number, h: number, color: string): void;
  /** Single pixel. */
  p(x: number, y: number, color: string): void;
  /** Filled disc. */
  disc(cx: number, cy: number, radius: number, color: string): void;
  /** Filled ellipse. */
  ell(cx: number, cy: number, rx: number, ry: number, color: string): void;
}

/**
 * Draws pixel art into a canvas texture. All art is procedural: no external assets.
 * With `outline`, the texture grows by 1px per side and gets a dark outline.
 */
export function makeTexture(
  scene: Phaser.Scene,
  key: string,
  w: number,
  h: number,
  draw: (g: Painter) => void,
  outline?: string,
) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const pad = outline ? 1 : 0;
  const tex = scene.textures.createCanvas(key, w + pad * 2, h + pad * 2);
  if (!tex) throw new Error(`could not create texture ${key}`);
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  const fill = (x: number, y: number, rw: number, rh: number, color: string) => {
    ctx.fillStyle = color;
    ctx.fillRect(x + pad, y + pad, rw, rh);
  };
  const g: Painter = {
    r: fill,
    p: (x, y, c) => fill(x, y, 1, 1, c),
    disc(cx, cy, radius, color) {
      for (let y = -radius; y <= radius; y++) {
        const half = Math.floor(Math.sqrt(radius * radius - y * y) + 0.5);
        fill(cx - half, cy + y, half * 2 + 1, 1, color);
      }
    },
    ell(cx, cy, rx, ry, color) {
      for (let y = -ry; y <= ry; y++) {
        const half = Math.floor(rx * Math.sqrt(1 - (y * y) / (ry * ry + 0.0001)) + 0.5);
        fill(cx - half, cy + y, half * 2 + 1, 1, color);
      }
    },
  };
  draw(g);
  if (outline) {
    const W = w + 2;
    const H = h + 2;
    const img = ctx.getImageData(0, 0, W, H);
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : img.data[(y * W + x) * 4 + 3]);
    ctx.fillStyle = outline;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (a(x, y) < 128 && (a(x - 1, y) > 128 || a(x + 1, y) > 128 || a(x, y - 1) > 128 || a(x, y + 1) > 128)) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }
  tex.refresh();
}

export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
