import type Phaser from "phaser";
import { makeTexture } from "./pixel";

/**
 * Ground shadows. One light, from the upper left, so every shadow is pushed a little down and to the right of what casts it.
 * They are flat, hard-edged shapes in one muted dark green, drawn translucent so they darken grass and cobblestone alike,
 * and sit on the ground layer (depth 0.5) beneath every object and character.
 * Sprites that already carry a shadow (the licensed pack's shaded trees and player) get none from here.
 */
export const SHADOW_COLOR = "#1c3324";
export const SHADOW_ALPHA = 0.3;
export const SHADOW_DEPTH = 0.5;
/** How far a shadow is pushed from its object's base: right, and (a little) down. */
export const SHADOW_DX = 3;

const ellKey = (rx: number, ry: number) => `sh_ell_${rx}_${ry}`;
function ellTexture(scene: Phaser.Scene, rx: number, ry: number) {
  const key = ellKey(rx, ry);
  if (!scene.textures.exists(key)) makeTexture(scene, key, rx * 2 + 1, ry * 2 + 1, (g) => g.ell(rx, ry, rx, ry, SHADOW_COLOR));
  return key;
}

/** A small contact shadow under something's base: bench, lamp, mailbox, fountain, tree trunk, the player. */
export function addContactShadow(scene: Phaser.Scene, x: number, y: number, rx: number, ry: number, alpha = SHADOW_ALPHA) {
  return scene.add.image(x + SHADOW_DX * (rx > 6 ? 1 : 0.5), y, ellTexture(scene, rx, ry)).setOrigin(0.5, 0.5).setAlpha(alpha).setDepth(SHADOW_DEPTH);
}

/**
 * A building's shadow, cast from its own silhouette. Every opaque pixel of the sprite is projected onto the ground: the higher
 * it is above the base, the further right (and slightly forward) its shadow lands. So the shadow follows the real outline,
 * eaves and all, instead of being a shape sized to the image, and it extends past the sprite with room to spare: the texture
 * is wider than the sprite on the right and a few rows taller than the foundation, so nothing is clipped by its bounds.
 */
const LEFT = 4; // empty columns left of the sprite in the shadow texture
const RIGHT = 16; // empty columns right of it: room for the longest cast
const ABOVE = 5; // rows above the sprite's bottom row
const BELOW = 6; // rows below it
const REACH_X = 0.14; // sideways cast per pixel of height
const REACH_Y = 0.05; // forward cast per pixel of height

function buildingTexture(scene: Phaser.Scene, spriteKey: string) {
  const key = `sh_bld_${spriteKey}`;
  if (scene.textures.exists(key)) return key;
  const src = scene.textures.get(spriteKey).getSourceImage() as CanvasImageSource & { width: number; height: number };
  const sw = src.width, sh = src.height;
  const probe = document.createElement("canvas");
  probe.width = sw;
  probe.height = sh;
  const pctx = probe.getContext("2d")!;
  pctx.drawImage(src, 0, 0);
  const px = pctx.getImageData(0, 0, sw, sh).data;
  const W = LEFT + sw + RIGHT, H = ABOVE + 1 + BELOW;
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < sh; y++) {
    const height = sh - 1 - y;
    for (let x = 0; x < sw; x++) {
      if (px[(y * sw + x) * 4 + 3] < 128) continue;
      const tx = LEFT + x + Math.round(height * REACH_X);
      const front = Math.round(height * REACH_Y);
      // the ground behind the wall's lower right (visible beside the wall), and in front of the foundation
      const top = x > sw * 0.5 ? -3 : -1;
      for (let k = top; k <= front; k++) {
        const ty = ABOVE + k;
        if (ty >= 0 && ty < H && tx < W) mask[ty * W + tx] = 1;
      }
    }
  }
  makeTexture(scene, key, W, H, (g) => {
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) g.p(x, y, SHADOW_COLOR);
  });
  return key;
}
/** `spriteKey` is the building's texture, `baseY` its bottom edge and `cx` its center line. */
export function addBuildingShadow(scene: Phaser.Scene, spriteKey: string, cx: number, baseY: number) {
  const tex = scene.textures.get(spriteKey).getSourceImage() as { width: number };
  return scene.add
    .image(cx - tex.width / 2 - LEFT, baseY + 1 - ABOVE, buildingTexture(scene, spriteKey))
    .setOrigin(0, 0)
    .setAlpha(SHADOW_ALPHA)
    .setDepth(SHADOW_DEPTH);
}
