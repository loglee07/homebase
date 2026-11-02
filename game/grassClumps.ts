// Hand-drawn grass tufts for the cobblestone edge, drawn upright the way grass stands, whichever side of the stone they are on.
// Each sprite is five rows: the tips at the top, two or three uneven leaves (some two pixels wide at the foot, narrowing to one at
// the tip), a small connected mid-green base, and a single dark root pixel at the bottom. d = dark root, m = mid, l = lit tip,
// . = nothing. Same palette as the lawn (FRINGE in paving.ts). Placement, mirroring and overlap are chosen in paving.ts.
export const CLUMP_H = 5;

export const CLUMPS: string[][] = [
  // three leaves, the left one two pixels wide at the foot
  [".l....",
   ".m..l.",
   ".mm.m.",
   "mmmmm.",
   "..d..."],
  // two leaves, one leaning right
  ["l....",
   "m..l.",
   "mm.m.",
   "mmmm.",
   ".d..."],
  // three leaves of different heights
  ["..l...l",
   "..m.l.m",
   ".mm.m.m",
   "mmmmmmm",
   "...d..."],
  // small, two leaves
  ["....",
   "l...",
   "m.l.",
   "mmm.",
   ".d.."],
  // a single tapering leaf
  [".l.",
   ".m.",
   "mm.",
   "mmm",
   ".d."],
  // two leaves apart, one tall
  ["l....",
   "m..l.",
   "m..m.",
   "mmmm.",
   "..d.."],
];

/** Sprites small enough to stand alone in a bare stretch. */
export const SMALL_CLUMPS = [3, 4];
