// Small pixel-art icons drawn as SVG rectangles (crisp at any size, no image files). Each row is a string of palette keys;
// "." is transparent. Used by the header; keep them 12x12 so the set looks consistent.
const PALETTE: Record<string, string> = {
  k: "#3a2210", // outline
  g: "#f2c230", // gold
  h: "#fff2a8", // gold highlight
  s: "#c98a14", // gold shade
  w: "#fbf1d4", // cream
  t: "#d8c391", // cream shade
  b: "#4f7fb8", // blue
  y: "#e0a526", // brass
  r: "#b24a2e", // brick
  d: "#9a5f0c", // deep gold (coin emblem)
};

/** A round coin: dark outline, lit rim (bright top-left, shaded bottom-right), a groove, and a $ stamped on the face. */
function makeCoin(): string[] {
  const N = 14;
  const c = (N - 1) / 2;
  const dollar = ["..d..", ".dddd", "d.d..", ".ddd.", "..d.d", "dddd.", "..d.."];
  const rows: string[] = [];
  for (let y = 0; y < N; y++) {
    let row = "";
    for (let x = 0; x < N; x++) {
      const dx = x - c;
      const dy = y - c;
      const d = Math.hypot(dx, dy);
      const lit = dx + dy < 0;
      let ch = ".";
      if (d <= 6.9) ch = "k";
      if (d <= 6.0) ch = lit ? "h" : "s";
      if (d <= 5.0) ch = "s";
      if (d <= 4.4) ch = lit && dx + dy < -3 ? "h" : "g";
      const gx = x - 4;
      const gy = y - 3;
      if (d <= 4.4 && gx >= 0 && gx < 5 && gy >= 0 && gy < 7 && dollar[gy][gx] === "d") ch = "d";
      row += ch;
    }
    rows.push(row);
  }
  return rows;
}

const ICONS = {
  coin: makeCoin(),
  bank: [
    "....kkkk....",
    "..kkwwwwkk..",
    ".kwwwwwwwwk.",
    "kkkkkkkkkkkk",
    ".kwwkwwkwwk.",
    ".kwwkwwkwwk.",
    ".kwwkwwkwwk.",
    ".kwwkwwkwwk.",
    "kkkkkkkkkkkk",
    "kttttttttttk",
    "kkkkkkkkkkkk",
    "............",
  ],
  school: [
    "............",
    ".....kk.....",
    "...kkwwkk...",
    ".kkwwwwwwkk.",
    "kwwwwwwwwwwk",
    ".kkwwwwwwkk.",
    "..kbbbbbbk..",
    "..kbbbbbbkg.",
    "..kbbbbbbkg.",
    "...kkkkkk.gg",
    "............",
    "............",
  ],
  lock: [
    "....kkkk....",
    "...k....k...",
    "...k....k...",
    "...k....k...",
    "..kkkkkkkk..",
    "..kyyyyyyk..",
    "..kyyykyyk..",
    "..kyyykyyk..",
    "..kyyyyyyk..",
    "..kkkkkkkk..",
    "............",
    "............",
  ],
  calendar: [
    "............",
    ".kkkkkkkkkk.",
    ".krrrrrrrrk.",
    ".krrrrrrrrk.",
    ".kkkkkkkkkk.",
    ".kwwwwwwwwk.",
    ".kwkwkwkwwk.",
    ".kwwwwwwwwk.",
    ".kwkwkwkwwk.",
    ".kwwwwwwwwk.",
    ".kkkkkkkkkk.",
    "............",
  ],
  minus: [
    "............",
    "............",
    "............",
    "............",
    "............",
    "wwwwwwwwwwww",
    "wwwwwwwwwwww",
    "............",
    "............",
    "............",
    "............",
    "............",
  ],
  chevron: [
    "............",
    "............",
    "............",
    ".kk......kk.",
    "..kk....kk..",
    "...kk..kk...",
    "....kkkk....",
    ".....kk.....",
    "............",
    "............",
    "............",
    "............",
  ],
} as const;

export type PixelIconName = keyof typeof ICONS;

export function PixelIcon({ name, size = 24, className }: { name: PixelIconName; size?: number; className?: string }) {
  const rows: readonly string[] = ICONS[name];
  const rects: React.ReactNode[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PALETTE[row[x]];
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c} />);
    }
  });
  return (
    <svg className={className} width={size} height={size} viewBox={`0 0 ${rows[0].length} ${rows.length}`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rects}
    </svg>
  );
}
