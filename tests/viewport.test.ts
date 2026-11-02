import { describe, expect, it } from "vitest";
import { EXT_H, EXT_W, PAD_X, PAD_Y, chooseZoom, toScreen, viewFor } from "@/game/viewport";
import { WORLD_H, WORLD_W, buildPadTrees, TREES } from "@/game/layout";

describe("zoom", () => {
  it("is a whole number, at least 1", () => {
    for (const [w, h] of [[320, 240], [900, 470], [1440, 800], [2560, 1000], [3840, 1600], [5000, 300]]) {
      const z = chooseZoom(w, h);
      expect(Number.isInteger(z), `${w}x${h}`).toBe(true);
      expect(z).toBeGreaterThanOrEqual(1);
    }
  });
  it("picks sensible steps for common windows", () => {
    expect(chooseZoom(700, 450)).toBe(1);
    expect(chooseZoom(900, 492)).toBe(2);
    expect(chooseZoom(1440, 840)).toBe(2);
    expect(chooseZoom(1920, 960)).toBe(3);
    expect(chooseZoom(1920, 500)).toBe(2); // short windows do not zoom past what shows the village's height
    expect(chooseZoom(2560, 1000)).toBe(4);
  });
  it("never shows more than the extended terrain, at any size", () => {
    for (let w = 200; w <= 6000; w += 137) {
      for (let h = 200; h <= 3000; h += 151) {
        const z = chooseZoom(w, h);
        expect(w / z, `${w}x${h}`).toBeLessThanOrEqual(EXT_W);
        expect(h / z, `${w}x${h}`).toBeLessThanOrEqual(EXT_H);
      }
    }
  });
});

describe("camera view", () => {
  it("centers the village when the window shows more than it, and stays inside the extra terrain", () => {
    const v = viewFor(1440, 800, 10, 30); // zoom 2: 720x400 of world
    expect(v.zoom).toBe(2);
    expect(v.left).toBe(Math.round(WORLD_W / 2 - 360));
    expect(v.top).toBe(Math.round(WORLD_H / 2 - 200));
    expect(v.left).toBeGreaterThanOrEqual(-PAD_X);
    expect(v.top).toBeGreaterThanOrEqual(-PAD_Y);
    expect(v.left + 720).toBeLessThanOrEqual(WORLD_W + PAD_X);
  });
  it("follows the player inside the village when the window is small, and never leaves it", () => {
    const small = (x: number, y: number) => viewFor(300, 200, x, y); // zoom 1, 300x200 of world
    expect(small(0, 0)).toMatchObject({ left: 0, top: 0 });
    expect(small(WORLD_W, WORLD_H)).toMatchObject({ left: WORLD_W - 300, top: WORLD_H - 200 });
    const mid = small(240, 160);
    expect(mid.left).toBe(90);
    expect(mid.top).toBe(60);
  });
  it("keeps every building reachable: each door can be centered or scrolled into view", () => {
    for (const x of [96, 240, 352]) {
      const v = viewFor(300, 200, x + 16, 140);
      const s = toScreen(v, x + 16, 140);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(300 * v.zoom);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(200 * v.zoom);
    }
  });
  it("uses whole-number scroll positions", () => {
    const v = viewFor(1001, 733, 123.4, 99.9);
    expect(Number.isInteger(v.left) && Number.isInteger(v.top)).toBe(true);
  });
});

describe("extra terrain scenery", () => {
  it("fills the pad (no clear edge) without touching the village or the existing tree ring", () => {
    const pad = buildPadTrees(PAD_X, PAD_Y);
    expect(pad.length).toBeGreaterThan(300);
    for (const t of pad) {
      const inside = t.x > -3 && t.x < WORLD_W + 3 && t.y > 12 && t.y < WORLD_H + 6;
      expect(inside).toBe(false);
    }
    expect(pad.some((t) => t.x < -PAD_X + 40)).toBe(true);
    expect(pad.some((t) => t.x > WORLD_W + PAD_X - 40)).toBe(true);
    expect(pad.some((t) => t.y < -PAD_Y + 40)).toBe(true);
    expect(pad.some((t) => t.y > WORLD_H + PAD_Y - 40)).toBe(true);
    expect(TREES.length).toBeGreaterThan(0);
  });
});
