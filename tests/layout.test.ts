import { describe, expect, it } from "vitest";
import {
  BENCHES, BUSHES, COLS, FOUNTAIN_BLOCK, HOME_FOOTPRINT, INTERACT_ZONES, baseOf, LAMPS, ROWS, SPAWN, TILE, TREES, WORLD_H, WORLD_W, flowerSpots, inPond,
  isPath, isPlaza, isWater, pondBlocks, villageSolids, waterBlocks, type Rect,
} from "@/game/layout";

const STEP = 2;
const BODY = { w: 8, h: 5 }; // the player's collision box (see TownScene)
const BOUNDS = { x: 10, y: 30, w: WORLD_W - 20, h: WORLD_H - 36 };
const hit = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** Reachable positions of the player's body center, from the spawn, on a 2px grid. */
function reach(solids: Rect[]) {
  const cols = Math.floor(BOUNDS.w / STEP), rows = Math.floor(BOUNDS.h / STEP);
  const free = (gx: number, gy: number) => {
    const box = { x: BOUNDS.x + gx * STEP - BODY.w / 2, y: BOUNDS.y + gy * STEP - BODY.h / 2, w: BODY.w, h: BODY.h };
    return gx >= 0 && gy >= 0 && gx < cols && gy < rows && box.x >= BOUNDS.x && box.x + box.w <= BOUNDS.x + BOUNDS.w && box.y >= BOUNDS.y && !solids.some((s) => hit(box, s));
  };
  const seen = new Set<number>();
  const start: [number, number] = [Math.round((SPAWN.x - BOUNDS.x) / STEP), Math.round((SPAWN.y - BOUNDS.y) / STEP)];
  const stack = [start];
  seen.add(start[1] * cols + start[0]);
  while (stack.length) {
    const [x, y] = stack.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, k = ny * cols + nx;
      if (!seen.has(k) && free(nx, ny)) {
        seen.add(k);
        stack.push([nx, ny]);
      }
    }
  }
  return (px: number, py: number) => seen.has(Math.round((py - BOUNDS.y) / STEP) * cols + Math.round((px - BOUNDS.x) / STEP));
}

describe("village layout", () => {
  for (const tiles of [true, false]) {
    for (const tier of [1, 2] as const) {
      it(`keeps every path, door and the pond's surroundings reachable (${tiles ? "pack art" : "code-drawn art"}, home tier ${tier})`, () => {
        const solids = [...villageSolids(tiles), baseOf(HOME_FOOTPRINT[tier])];
        const reached = reach(solids);
        expect(reached(SPAWN.x, SPAWN.y)).toBe(true);
        for (const z of Object.values(INTERACT_ZONES)) expect(reached(z.x + z.w / 2, z.y + z.h / 2), `door at ${z.x}`).toBe(true);
        const stranded: string[] = [];
        for (let r = 0; r < ROWS; r++) {
          for (let c = 0; c < COLS; c++) {
            const cx = c * TILE + 8, cy = r * TILE + 8;
            const covered = solids.some((s) => hit({ x: cx, y: cy, w: 1, h: 1 }, s));
            const anyReached = [2, 6, 10, 14].some((ox) => [2, 6, 10, 14].some((oy) => reached(c * TILE + ox, r * TILE + oy)));
            if (isPath(c, r) && !covered && !anyReached) stranded.push(`${c},${r}`);
          }
        }
        // a path cell can sit under a prop or a building, but no open one is cut off from the rest
        expect(stranded, stranded.join(" ")).toEqual([]);
      });
    }
  }

  it("can walk all the way round the plaza and the fountain", () => {
    const reached = reach([...villageSolids(true), baseOf(HOME_FOOTPRINT[2])]);
    const f = FOUNTAIN_BLOCK;
    for (const [x, y] of [[f.x - 12, f.y + 8], [f.x + f.w + 12, f.y + 8], [f.x + 14, f.y - 12], [f.x + 14, f.y + f.h + 10]]) expect(reached(x, y), `${x},${y}`).toBe(true);
  });

  it("lets the player walk behind every building and blocks only its wall base", () => {
    const reached = reach([...villageSolids(true), baseOf(HOME_FOOTPRINT[1])]);
    for (const [x, y] of [[128, 104], [240, 62], [368, 118]]) expect(reached(x, y), `behind ${x}`).toBe(true);
    for (const [x, y] of [[128, 136], [240, 90], [368, 150]]) expect(reached(x, y), `in the wall at ${x}`).toBe(false);
  });

  it("blocks the whole fountain basin", () => {
    const reached = reach([...villageSolids(true), baseOf(HOME_FOOTPRINT[2])]);
    for (const [x, y] of [[240, 192], [230, 186], [250, 186], [240, 197]]) expect(reached(x, y), `${x},${y}`).toBe(false);
  });

  it("lets the player stand close to the water", () => {
    const water = waterBlocks();
    const reached = reach([...villageSolids(true), baseOf(HOME_FOOTPRINT[2])]);
    // a tile row's top edge is y=208 above column 6; the player's feet get within a few pixels of it
    expect(water.some((w) => w.x === 5 * TILE && w.y === 13 * TILE + 5)).toBe(true);
    expect(reached(88, 205)).toBe(true);
  });

  it("leaves the shore walkable and the water blocked", () => {
    const solids = [...villageSolids(true), baseOf(HOME_FOOTPRINT[2])];
    const reached = reach(solids);
    for (const [x, y] of [[24, 232], [152, 232], [88, 198], [88, 296]]) expect(reached(x, y), `${x},${y}`).toBe(true);
    expect(reached(88, 232)).toBe(false);
    expect(waterBlocks().length).toBeGreaterThan(20);
  });

  it("keeps the pond one irregular body of water with clean joins", () => {
    const cells: [number, number][] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (isWater(c, r)) cells.push([c, r]);
    const key = (c: number, r: number) => `${c},${r}`;
    const set = new Set(cells.map(([c, r]) => key(c, r)));
    // connected
    const seen = new Set([key(...cells[0])]);
    const stack = [cells[0]];
    while (stack.length) {
      const [c, r] = stack.pop()!;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = key(c + dc, r + dr);
        if (set.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push([c + dc, r + dr]);
        }
      }
    }
    expect(seen.size).toBe(cells.length);
    // no one-tile-wide spurs: every water tile touches a neighbor on both axes except the rounded ends
    for (const [c, r] of cells) {
      const h = Number(isWater(c - 1, r)) + Number(isWater(c + 1, r));
      const v = Number(isWater(c, r - 1)) + Number(isWater(c, r + 1));
      expect(h + v, key(c, r)).toBeGreaterThanOrEqual(2);
    }
    // the pond is no ellipse: its rows are not symmetric
    const spans = [13, 14, 15, 16, 17].map((r) => cells.filter(([, rr]) => rr === r).length);
    expect(spans.join()).not.toBe([...spans].reverse().join());
    // the drawn shape and the tiles agree
    expect(inPond(88, 232)).toBe(true);
    expect(inPond(10, 10)).toBe(false);
    expect(pondBlocks().length).toBeGreaterThan(20);
  });

  it("builds a round plaza around the fountain that every path joins", () => {
    expect(isPlaza(15, 11)).toBe(true);
    expect(isPlaza(11, 7)).toBe(false);
    expect(isPlaza(19, 15)).toBe(false);
    // symmetric about the fountain
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) expect(isPlaza(c, r), `${c},${r}`).toBe(isPlaza(29 - c, r));
    const w = (r: number) => Array.from({ length: COLS }, (_, c) => c).filter((c) => isPlaza(c, r)).length;
    expect(w(11)).toBeGreaterThan(w(7));
    for (const [c, r] of [[14, 5], [10, 11], [19, 11], [14, 16], [16, 17]]) expect(isPath(c, r) && !isPlaza(c, r), `${c},${r} is a path cell`).toBe(true);
    for (const [c, r] of [[14, 7], [11, 11], [18, 12], [14, 15]]) expect(isPlaza(c, r), `${c},${r} is plaza`).toBe(true);
  });

  it("gives every door a path that reaches the spot where the player stands to use it", () => {
    for (const [id, z] of Object.entries(INTERACT_ZONES)) {
      const cx = z.x + z.w / 2, cy = z.y + 8;
      expect(isPath(Math.floor(cx / TILE), Math.floor(cy / TILE)) || isPath(Math.floor((cx - 8) / TILE), Math.floor(cy / TILE)), `${id} door has a path`).toBe(true);
    }
  });

  it("centers every door on its path", () => {
    // each walk is two tiles wide at its door, so the door's center line is a tile boundary
    for (const [id, z] of Object.entries(INTERACT_ZONES)) {
      const cx = z.x + z.w / 2;
      expect(cx % TILE, `${id} center ${cx}`).toBe(0);
      expect(isPath(cx / TILE - 1, Math.floor((z.y + 8) / TILE)) && isPath(cx / TILE, Math.floor((z.y + 8) / TILE)), `${id} path under the door`).toBe(true);
      expect(z.y % TILE, `${id} base on a tile edge`).toBe(0);
    }
  });

  it("keeps tree canopies off every path, the plaza and the doors", () => {
    for (const t of TREES) {
      for (let y = t.y - 30; y <= t.y + 3; y += 4) {
        for (const x of [t.x - 14, t.x, t.x + 14]) {
          expect(isPath(Math.floor(x / TILE), Math.floor(y / TILE)), `tree ${t.x},${t.y} covers path at ${x},${y}`).toBe(false);
        }
      }
    }
  });

  it("keeps benches off the paths and lamps ringing the plaza, none in the water or on a path they would block", () => {
    for (const b of BENCHES) {
      for (const x of [b.x - 15, b.x, b.x + 15]) expect(isPath(Math.floor(x / TILE), Math.floor(b.y / TILE)) || isPath(Math.floor(x / TILE), Math.floor((b.y - 8) / TILE)), `bench at ${b.x},${b.y} sits on a path`).toBe(false);
    }
    for (const p of LAMPS.slice(0, 6)) {
      expect(isWater(Math.floor(p.x / TILE), Math.floor(p.y / TILE))).toBe(false);
      const dx = p.x - 240, dy = p.y - 184;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(35);
      expect(Math.hypot(dx, dy)).toBeLessThan(100);
    }
  });

  it("varies the tree border: uneven spacing, a second row, and clearings", () => {
    const top = TREES.filter((t) => t.y < 46).sort((a, b) => a.x - b.x);
    const gaps = top.slice(1).map((t, i) => t.x - top[i].x);
    expect(new Set(gaps).size).toBeGreaterThan(6);
    expect(Math.max(...gaps)).toBeGreaterThanOrEqual(40); // a clearing
    expect(new Set(top.map((t) => t.y)).size).toBeGreaterThan(5); // not one straight row
    for (const t of TREES) {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(WORLD_W);
      expect(isPath(Math.floor(t.x / TILE), Math.floor(t.y / TILE)), `tree ${t.x},${t.y} on a path`).toBe(false);
      expect(isWater(Math.floor(t.x / TILE), Math.floor(t.y / TILE)), `tree ${t.x},${t.y} in water`).toBe(false);
    }
  });

  it("groups flowers and bushes near doors, not evenly", () => {
    const spots = flowerSpots();
    expect(spots.length).toBeGreaterThan(40);
    for (const s of spots) {
      expect(isPath(Math.floor(s.x / TILE), Math.floor(s.y / TILE))).toBe(false);
      expect(isWater(Math.floor(s.x / TILE), Math.floor(s.y / TILE))).toBe(false);
    }
    const nearDoor = spots.filter((s) => Object.values(INTERACT_ZONES).some((z) => Math.hypot(s.x - (z.x + z.w / 2), s.y - z.y) < 95));
    expect(nearDoor.length / spots.length).toBeGreaterThan(0.4);
    for (const b of BUSHES) expect(isPath(Math.floor(b.x / TILE), Math.floor(b.y / TILE))).toBe(false);
  });
});
