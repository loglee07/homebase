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
};

const ICONS = {
  coin: [
    "...kkkkkk...",
    "..khhhhggk..",
    ".khhgggggsk.",
    "khhggkkggssk",
    "khgggkkgggsk",
    "khgggkkgggsk",
    "khgggkkgggsk",
    "khgggkkgggsk",
    "kggggkkggssk",
    ".kgggggsssk.",
    "..kksssskk..",
    "....kkkk....",
  ],
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
  const rows = ICONS[name];
  const rects: React.ReactNode[] = [];
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const c = PALETTE[row[x]];
      if (c) rects.push(<rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill={c} />);
    }
  });
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 12 12" shapeRendering="crispEdges" aria-hidden="true" focusable="false">
      {rects}
    </svg>
  );
}
