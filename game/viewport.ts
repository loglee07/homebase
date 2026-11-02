// Viewport math for the responsive town. Pure: no Phaser, so it is tested directly.
// The canvas fills its container. The camera uses a whole-number zoom (crisp pixels, no stretching), and what it shows
// depends on the window: a small window follows the player inside the village, a big one shows extra terrain around it.
import { WORLD_H, WORLD_W } from "./layout";

/** Extra scenery drawn around the village on every side (world pixels). The player never walks there. */
export const PAD_X = 240;
export const PAD_Y = 160;
export const EXT_W = WORLD_W + PAD_X * 2;
export const EXT_H = WORLD_H + PAD_Y * 2;

/** One more zoom step for every this many CSS pixels of canvas width (zoom 2 from 800px, 3 from 1600px, ...). */
export const ZOOM_STEP_W = 800;
/** The zoom never goes so high that less than this much world height is visible. */
export const MIN_VIEW_H = 200;

/**
 * Whole-number zoom for a canvas of this size (CSS pixels): bigger windows get bigger pixels and extra terrain, smaller ones
 * follow the player. Never so low that the view would be wider or taller than the extended terrain, so the camera can never
 * show blank space.
 */
export function chooseZoom(width: number, height: number): number {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const byWidth = 1 + Math.floor(w / ZOOM_STEP_W);
  const byHeight = Math.floor(h / MIN_VIEW_H);
  return Math.max(1, Math.min(byWidth, byHeight), Math.ceil(w / EXT_W), Math.ceil(h / EXT_H));
}

export interface TownView {
  zoom: number;
  /** World coordinates of the top-left corner of what is on screen. Whole numbers. */
  left: number;
  top: number;
  /** Canvas size in CSS pixels. */
  width: number;
  height: number;
}

/** One axis: a view larger than the village is centered on it; a smaller one follows the player but stays inside the village. */
function axis(viewSize: number, world: number, focus: number): number {
  if (viewSize >= world) return Math.round(world / 2 - viewSize / 2);
  const center = Math.min(Math.max(focus, viewSize / 2), world - viewSize / 2);
  return Math.round(center - viewSize / 2);
}

export function viewFor(width: number, height: number, focusX: number, focusY: number): TownView {
  const zoom = chooseZoom(width, height);
  return { zoom, left: axis(width / zoom, WORLD_W, focusX), top: axis(height / zoom, WORLD_H, focusY), width, height };
}

/** Screen position (CSS pixels, relative to the canvas) of a world point. */
export const toScreen = (v: TownView, x: number, y: number) => ({ x: (x - v.left) * v.zoom, y: (y - v.top) * v.zoom });

export const sameView = (a: TownView | null, b: TownView) =>
  !!a && a.zoom === b.zoom && a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
