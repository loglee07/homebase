import { describe, expect, it } from "vitest";
import {
  BENCHES, BUSHES, FENCES, YARD, COLS, FOUNTAIN_BLOCK, HOME_FOOTPRINT, INTERACT_ZONES, baseOf, LAMPS, ROWS, SPAWN, TILE, WORLD_H, WORLD_W, flowerSpots, inPond,
  LAWN_TREES, CLEARING_MARGIN, clearingDistance, BANK_FOOTPRINT, SCHOOL_FOOTPRINT, tuftSpots, shrubSpots, MIN_TREE_GAP, buildPadTrees, SIZE_SCALE, TREES, TRUNK_W, isPath, isPlaza, inPlazaDisc, inPlazaShape, PLAZA, PLAZA_ARMS, isWater, pondBlocks, villageSolids, waterBlocks, type Rect,
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

  it("has no Kitchen: no spur, door, interaction or hidden collision where it stood", () => {
    expect(Object.keys(INTERACT_ZONES).sort()).toEqual(["bank", "home", "school"]);
    for (const [c, r] of [[16, 17], [20, 18], [22, 16], [23, 17]]) expect(isPath(c, r), `${c},${r}`).toBe(false); // the old spur
    // the old plot (x 320..416, y 200..272) has no building-sized solid: only trees and props, which are small
    const plot = { x: 320, y: 200, w: 96, h: 72 };
    for (const b of villageSolids(true)) {
      const inside = b.x >= plot.x && b.y >= plot.y && b.x + b.w <= plot.x + plot.w && b.y + b.h <= plot.y + plot.h;
      if (inside) expect(b.w * b.h, "only small scenery stands there").toBeLessThan(200);
    }
  });

  it("keeps oaks dominant, pines in broad stands and birches rare", () => {
    const all = [...TREES, ...buildPadTrees(300, 210)];
    const count = (k: string) => all.filter((t) => t.kind === k).length;
    const oaks = count("oak") + count("oak2");
    expect(oaks / all.length).toBeGreaterThan(0.5);
    expect(count("pine") / all.length).toBeGreaterThan(0.08);
    expect(count("pine") / all.length).toBeLessThan(0.35);
    expect(count("birch") / all.length).toBeLessThan(0.06);
    expect(count("birch")).toBeGreaterThanOrEqual(6);
    // no birch rows: single-link groups of birches within 28px never exceed three trees
    const bs = all.filter((t) => t.kind === "birch");
    const seen = new Set<number>();
    bs.forEach((b, i) => {
      if (seen.has(i)) return;
      const stack = [i], group: number[] = [];
      seen.add(i);
      while (stack.length) {
        const a = stack.pop() as number;
        group.push(a);
        bs.forEach((o, j) => { if (!seen.has(j) && Math.hypot(bs[a].x - o.x, bs[a].y - o.y) <= 28) { seen.add(j); stack.push(j); } });
      }
      expect(group.length, `birch cluster near ${b.x},${b.y}`).toBeLessThanOrEqual(3);
    });
    // pines come in stands: a pine's nearest woodland neighbours are mostly pines too
    const pines = all.filter((t) => t.kind === "pine");
    let same = 0;
    for (const p of pines) {
      const near = all.filter((t) => t !== p && Math.hypot(t.x - p.x, t.y - p.y) < 26);
      same += near.filter((t) => t.kind === "pine").length / Math.max(1, near.length);
    }
    expect(same / pines.length).toBeGreaterThan(0.5);
  });
  it("shapes the clearing organically, with every part of the village inside it and no trunk in it", () => {
    const D = clearingDistance;
    const keyPoints: [number, number][] = [
      [SPAWN.x, SPAWN.y], [FOUNTAIN_BLOCK.x, FOUNTAIN_BLOCK.y], [88, 250], [60, 232], [120, 270], [112, 46], [240, 38], [368, 80], [24, 232],
      [430, 214], [372, 262], [304, 221], [240, 318], [240, 340], [86, 166], [404, 280],
      ...Object.values(INTERACT_ZONES).flatMap((z): [number, number][] => [[z.x, z.y + 20], [z.x + z.w, z.y + 20]]),
      ...[HOME_FOOTPRINT[2], BANK_FOOTPRINT, SCHOOL_FOOTPRINT].flatMap((f): [number, number][] => [[f.x, f.y + f.h], [f.x + f.w, f.y + f.h], [f.x + f.w / 2, f.y - 10]]),
    ];
    for (const [x, y] of keyPoints) expect(D(x, y), `${x},${y} is in the clearing`).toBeLessThan(-4);
    for (const t of [...TREES.filter((t) => !LAWN_TREES.includes(t)), ...buildPadTrees(300, 210)]) expect(D(t.x, t.y), `${t.kind} ${t.x},${t.y} stands in the clearing`).toBeGreaterThanOrEqual(CLEARING_MARGIN);
    // the village's corners are woodland, not lawn
    for (const [x, y] of [[8, 14], [472, 14], [8, 316], [472, 316]]) expect(D(x, y), `corner ${x},${y}`).toBeGreaterThan(0);
  });
  it("scatters a few lone trees on the lawn, clear of walks, props and the woodland", () => {
    expect(LAWN_TREES.length).toBeGreaterThanOrEqual(4);
    expect(LAWN_TREES.length).toBeLessThanOrEqual(8);
    for (const t of LAWN_TREES) {
      expect(clearingDistance(t.x, t.y), `${t.x},${t.y} is on the lawn`).toBeLessThan(-10);
      for (const o of [...BUSHES, ...BENCHES, ...LAMPS]) expect(Math.hypot(o.x - t.x, o.y - t.y)).toBeGreaterThan(18);
    }
  });
  it("has an inner edge that curves and recedes unevenly, never a straight border", () => {
    const edgeAlong = (axis: "left" | "right" | "top" | "bottom", t: number) => {
      for (let u = -120; u <= 260; u += 1) {
        const [x, y] = axis === "left" ? [u, t] : axis === "right" ? [WORLD_W - u, t] : axis === "top" ? [t, u] : [t, WORLD_H - u];
        if (clearingDistance(x, y) < 0) return u;
      }
      return 260;
    };
    for (const axis of ["left", "right", "top", "bottom"] as const) {
      const span = axis === "left" || axis === "right" ? [24, 304] : [24, 456];
      const edge: number[] = [];
      for (let t = span[0]; t <= span[1]; t += 8) edge.push(edgeAlong(axis, t));
      expect(Math.max(...edge) - Math.min(...edge), `${axis} edge range`).toBeGreaterThanOrEqual(22);
      // no long straight run: within any 8 consecutive samples (64px) the edge moves
      for (let i = 0; i + 8 < edge.length; i++) expect(Math.max(...edge.slice(i, i + 8)) - Math.min(...edge.slice(i, i + 8)), `${axis} straight run at ${i}`).toBeGreaterThanOrEqual(2);
    }
  });
  it("covers the woodland without holes, out past the visible edge", () => {
    const all = [...TREES, ...buildPadTrees(300, 210)];
    for (let y = -150; y <= WORLD_H + 150; y += 6) for (let x = -250; x <= WORLD_W + 250; x += 6) {
      if (clearingDistance(x, y) < 14) continue;
      const near = Math.min(...all.map((t) => Math.hypot(t.x - x, (t.y - 8) - y)));
      expect(near, `hole in the woodland at ${x},${y}`).toBeLessThanOrEqual(24);
    }
    expect(all.some((t) => t.x < -270 && t.y > 100 && t.y < 200)).toBe(true);
    expect(all.some((t) => t.x > WORLD_W + 270)).toBe(true);
    expect(all.some((t) => t.y < -170)).toBe(true);
    expect(all.some((t) => t.y > WORLD_H + 170)).toBe(true);
  });
  it("builds the same woodland every time and at every window size", () => {
    const small = buildPadTrees(120, 80), big = buildPadTrees(240, 160);
    const key = (t: { x: number; y: number; kind: string; size?: string }) => `${t.x},${t.y},${t.kind},${t.size}`;
    expect(buildPadTrees(240, 160).map(key)).toEqual(big.map(key));
    const bigKeys = new Set(big.map(key));
    for (const t of small) expect(bigKeys.has(key(t)), `${key(t)} missing from the larger window`).toBe(true);
    expect(big.length).toBeGreaterThan(small.length);
  });
  it("never packs two trunks closer than the minimum gap, in the village or the decorative forest", () => {
    const all = [...TREES, ...buildPadTrees(300, 210)];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      if (Math.abs(all[i].y - all[j].y) < MIN_TREE_GAP) expect(Math.hypot(all[i].x - all[j].x, all[i].y - all[j].y), `${all[i].x},${all[i].y} vs ${all[j].x},${all[j].y}`).toBeGreaterThanOrEqual(MIN_TREE_GAP);
    }
  });
  it("scatters sparse decor tufts away from paving and water", () => {
    const tufts = tuftSpots();
    expect(tufts.length).toBeGreaterThan(20);
    expect(tufts.length).toBeLessThan(60);
    for (const t of tufts) expect(isPath(Math.floor(t.x / TILE), Math.floor(t.y / TILE)) || isWater(Math.floor(t.x / TILE), Math.floor(t.y / TILE))).toBe(false);
  });
  it("places a few compact shrubs by trees, walls, benches and the shore, clear of walks, water and each other", () => {
    const spots = shrubSpots();
    expect(spots.length).toBeGreaterThan(8);
    for (const w of ["tree", "wall", "seat", "shore"] as const) expect(spots.filter((s) => s.where === w).length, w).toBeGreaterThan(0);
    for (const s of spots) {
      expect(isPath(Math.floor(s.x / TILE), Math.floor(s.y / TILE)), `shrub ${s.x},${s.y} on paving`).toBe(false);
      expect(isWater(Math.floor(s.x / TILE), Math.floor((s.y - 2) / TILE)), `shrub ${s.x},${s.y} in water`).toBe(false);
    }
    for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) expect(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y)).toBeGreaterThanOrEqual(16);
    expect(spots.filter((s) => s.where === "shore").length).toBeLessThanOrEqual(5); // most of the pond stays open
  });
  it("varies sizes within a modest range, all three tiers in use", () => {
    expect(SIZE_SCALE).toEqual({ s: 0.9, m: 1, l: 1.1 });
    const sizes = new Set(TREES.map((t) => t.size));
    expect([...sizes].sort()).toEqual(["l", "m", "s"]);
    for (const k of ["oak", "pine", "birch"]) expect(new Set(TREES.filter((t) => t.kind === k || (k === "oak" && t.kind === "oak2")).map((t) => t.size)).size, k).toBeGreaterThan(1);
  });
  it("gives each kind a trunk collision sized to its trunk", () => {
    expect(TRUNK_W.birch).toBeLessThan(TRUNK_W.oak);
    expect(TRUNK_W.pine).toBeLessThanOrEqual(TRUNK_W.oak);
    for (const t of TREES) {
      const b = villageSolids(true).find((r) => r.x === t.x - TRUNK_W[t.kind] / 2 && r.y === t.y - 5 && r.w === TRUNK_W[t.kind]);
      expect(b, `${t.kind} ${t.x},${t.y}`).toBeTruthy();
    }
  });

  it("makes the plaza an ellipse a little wider than tall, centered on the fountain, independent of the tile grid, with every walk running into it", () => {
    expect(PLAZA).toEqual({ x: 240, y: 192, rx: 58, ry: 44 });
    expect(PLAZA.rx).toBeGreaterThan(PLAZA.ry);
    expect(PLAZA.rx / PLAZA.ry).toBeLessThan(1.4); // a little wider, not a lozenge
    expect(PLAZA.rx).toBeLessThan(64); // smaller than the 8x8 block it replaced
    let n = 0;
    for (let y = 100; y < 290; y++) for (let x = 150; x < 330; x++) {
      const inside = inPlazaDisc(x, y);
      if (inside) n++;
      expect(inPlazaDisc(479 - x, y), `${x},${y}`).toBe(inside);
      expect(inPlazaDisc(x, 383 - y), `${x},${y}`).toBe(inside);
    }
    expect(Math.abs(n - Math.PI * 58 * 44)).toBeLessThan(160);
    // the silhouette moves a pixel or two at a time: per row the left edge never jumps more than 6px, and per column the top edge likewise
    let prev = -1;
    for (let y = 148; y < 192; y++) {
      let x = 150;
      while (!inPlazaDisc(x, y)) x++;
      if (prev >= 0) expect(Math.abs(x - prev), `row ${y}`).toBeLessThanOrEqual(6);
      prev = x;
    }
    // the ellipse is inside the old 8x8 block's footprint, and the middle row and column of tiles are plaza
    for (const [c, r] of [[11, 11], [18, 12], [14, 9], [15, 14], [12, 10], [17, 13]]) expect(isPlaza(c, r), `${c},${r} is plaza`).toBe(true);
    for (const [c, r] of [[11, 8], [18, 8], [11, 15], [18, 15], [10, 11], [14, 8], [14, 15], [19, 11]]) expect(isPlaza(c, r), `${c},${r} is outside the ellipse`).toBe(false);
    // generous room around the fountain: well over two tiles of paving beside its block
    expect(FOUNTAIN_BLOCK.x - (PLAZA.x - PLAZA.rx)).toBeGreaterThanOrEqual(36);
    expect(PLAZA.x + PLAZA.rx - (FOUNTAIN_BLOCK.x + FOUNTAIN_BLOCK.w)).toBeGreaterThanOrEqual(36);
    // every walk reaches the ellipse: its arm overlaps both the walk's last tile and the ellipse, 16px wide and on an axis
    for (const [c, r] of [[14, 8], [15, 8], [10, 11], [10, 12], [19, 11], [19, 12], [14, 15], [15, 15]]) expect(isPath(c, r) && !isPlaza(c, r), `${c},${r} is a walk cell`).toBe(true);
    for (const a of PLAZA_ARMS) {
      const horizontal = a.w > a.h;
      expect(horizontal ? a.h : a.w).toBe(16);
      expect(horizontal ? a.y + 8 : a.x + 8).toBe(horizontal ? PLAZA.y : PLAZA.x);
    }
    for (const [x, y] of [[240, 128], [240, 136], [240, 256], [240, 248], [172, 192], [180, 192], [308, 192], [300, 192]]) expect(inPlazaShape(x, y), `${x},${y} is paved between a walk and the ellipse`).toBe(true);
    expect(inPlazaShape(240, 118)).toBe(false);
    expect(inPlazaShape(200, 136)).toBe(false); // the shape's corners are grass
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
      for (const x of [b.x - 15, b.x, b.x + 15]) {
        for (const y of [b.y, b.y - 8]) {
          const c = Math.floor(x / TILE), r = Math.floor(y / TILE);
          expect((isPath(c, r) && !isPlaza(c, r)) || inPlazaDisc(x, y), `bench at ${b.x},${b.y} sits on a path`).toBe(false);
        }
      }
    }
    for (const p of LAMPS.slice(0, 6)) {
      expect(isWater(Math.floor(p.x / TILE), Math.floor(p.y / TILE))).toBe(false);
      const dx = p.x - 240, dy = p.y - 184;
      expect(Math.hypot(dx, dy)).toBeGreaterThan(35);
      expect(Math.hypot(dx, dy)).toBeLessThan(100);
    }
  });

  it("keeps trees off paths and water", () => {
    for (const t of TREES) {
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

describe("yard fence", () => {
  it("runs two side fences from the house walls to a front rail, open at the walk columns, with nothing behind the house", () => {
    const fp = HOME_FOOTPRINT[1];
    expect(YARD.c0 * TILE).toBeLessThan(fp.x);
    expect((YARD.c1 + 1) * TILE).toBeGreaterThan(fp.x + fp.w);
    expect(YARD.r0 * TILE).toBeGreaterThan(fp.y); // the sides start on the wall, not above the house
    expect(Math.min(...FENCES.map((f) => f.y))).toBeGreaterThan(fp.y);
    const key = (c: number, r: number) => `${c},${r}`;
    const have = new Set(FENCES.map((f) => key(Math.floor(f.x / TILE), Math.floor(f.y / TILE))));
    for (let c = YARD.c0; c <= YARD.c1; c++) expect(have.has(key(c, YARD.r1))).toBe(!YARD.gap.includes(c));
    for (let r = YARD.r0; r <= YARD.r1; r++) {
      expect(have.has(key(YARD.c0, r))).toBe(true);
      expect(have.has(key(YARD.c1, r))).toBe(true);
    }
    for (let c = YARD.c0 + 1; c < YARD.c1; c++) for (let r = 0; r < YARD.r1; r++) expect(have.has(key(c, r))).toBe(false);
  });

  it("leaves the door walk open and keeps lamps, bushes and the mailbox off the fence", () => {
    for (const c of YARD.gap) for (let r = YARD.r1 - 1; r <= YARD.r1 + 1; r++) expect(FENCES.some((f) => Math.floor(f.x / TILE) === c && Math.floor((f.y) / TILE) === r)).toBe(false);
    for (const o of [...LAMPS, ...BUSHES]) for (const f of FENCES) expect(Math.hypot(o.x - f.x, o.y - (f.y - 4))).toBeGreaterThan(7);
  });

  it("has no gap in its collision: every point along the side runs, the return rails and the front rails is blocked", () => {
    const solids = FENCES.flatMap((f) => f.solids);
    const blocked = (x: number, y: number) => solids.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    const sideX = [YARD.c0 * TILE + 8, YARD.c1 * TILE + 8];
    for (const x of sideX) for (let y = YARD.r0 * TILE; y < YARD.r1 * TILE + 12; y++) expect(blocked(x, y), `side ${x},${y}`).toBe(true);
    const topY = YARD.r0 * TILE + 10, frontY = YARD.r1 * TILE + 10;
    for (let x = sideX[0]; x < YARD.c0 * TILE + 16; x++) expect(blocked(x, topY), `return rail ${x}`).toBe(true);
    for (let x = YARD.c1 * TILE; x <= sideX[1]; x++) expect(blocked(x, topY), `return rail ${x}`).toBe(true);
    const gapStart = YARD.gap[0] * TILE, gapEnd = (YARD.gap[YARD.gap.length - 1] + 1) * TILE;
    for (let x = sideX[0]; x < gapStart - 8 + 2; x++) expect(blocked(x, frontY), `front ${x}`).toBe(true);
    for (let x = gapEnd + 8 - 2; x <= sideX[1]; x++) expect(blocked(x, frontY), `front ${x}`).toBe(true);
    for (let x = gapStart + 2; x < gapEnd - 2; x++) expect(blocked(x, frontY), `walk ${x}`).toBe(false); // the door walk stays open
  });
});
