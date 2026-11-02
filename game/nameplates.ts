// Floating nameplates over buildings. Pure data, shared by the React overlay: add a building here and it gets a plaque.
// The overlay maps world coordinates to the screen with the camera view (see viewport.ts).
// Plaques are DOM, not canvas, so the lettering stays crisp at any window size. They never take part in the scene:
// no collision, no pointer events, no keyboard focus.
import { BANK_BASE_Y, BANK_CENTER_X, HOME_BASE_Y, HOME_CENTER_X, SCHOOL_BASE_Y, SCHOOL_CENTER_X } from "./layout";

export interface Nameplate {
  id: string;
  text: string;
  /** World x of the plaque's center (the building's center line). */
  x: number;
  /** World y of the building's highest opaque pixel: the cottage ridge, the manor ridge, the bank roof, the school bell tower. */
  roofY: number;
}

/** Empty world pixels between the art and the bottom of the plaque. */
export const NAMEPLATE_GAP = 4;

/**
 * Sprites are bottom-anchored at their base y + 1, so the roof is that minus the sprite height (the art is trimmed to its
 * opaque bounds): cottage 72 tall, manor/bank/school 75. If a sprite is replaced, update its height here.
 */
const roofOf = (baseY: number, spriteHeight: number) => baseY + 1 - spriteHeight;

export const NAMEPLATES = {
  home: (tier: 1 | 2): Nameplate => ({ id: "home", text: "Home", x: HOME_CENTER_X, roofY: roofOf(HOME_BASE_Y, tier === 2 ? 75 : 72) }),
  bank: { id: "bank", text: "Bank", x: BANK_CENTER_X, roofY: roofOf(BANK_BASE_Y, 75) } satisfies Nameplate,
  school: { id: "school", text: "School", x: SCHOOL_CENTER_X, roofY: roofOf(SCHOOL_BASE_Y, 75) } satisfies Nameplate,
};

export const nameplatesFor = (homeTier: 1 | 2): Nameplate[] => [NAMEPLATES.home(homeTier), NAMEPLATES.bank, NAMEPLATES.school];
