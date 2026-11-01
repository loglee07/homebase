import type { Cents } from "./money";

export const HOME_UPGRADE_THRESHOLD_CENTS: Cents = 10_000_000; // $100,000.00
export const MILESTONE_STORAGE_KEY = "finance-town:milestones:v1";

export type HomeTier = 1 | 2;

export interface MilestoneState {
  version: 1;
  homeTier: HomeTier;
  homeUpgradedAt: string | null;
}

export const INITIAL_MILESTONES: MilestoneState = { version: 1, homeTier: 1, homeUpgradedAt: null };

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/**
 * Upgrades are one-way: net worth at or above the threshold sets tier 2;
 * a later decrease never lowers it.
 */
export function applyMilestones(
  state: MilestoneState,
  netWorthCents: Cents,
  now: () => string = () => new Date().toISOString(),
): { state: MilestoneState; upgraded: boolean } {
  if (state.homeTier >= 2 || netWorthCents < HOME_UPGRADE_THRESHOLD_CENTS) {
    return { state, upgraded: false };
  }
  return { state: { ...state, homeTier: 2, homeUpgradedAt: now() }, upgraded: true };
}

export function loadMilestones(storage: ReadableStorage | null | undefined): MilestoneState {
  try {
    const raw = storage?.getItem(MILESTONE_STORAGE_KEY);
    if (!raw) return INITIAL_MILESTONES;
    const parsed = JSON.parse(raw) as Partial<MilestoneState> | null;
    if (parsed?.version !== 1 || (parsed.homeTier !== 1 && parsed.homeTier !== 2)) return INITIAL_MILESTONES;
    return {
      version: 1,
      homeTier: parsed.homeTier,
      homeUpgradedAt: typeof parsed.homeUpgradedAt === "string" ? parsed.homeUpgradedAt : null,
    };
  } catch {
    return INITIAL_MILESTONES;
  }
}

export function saveMilestones(storage: WritableStorage | null | undefined, state: MilestoneState): void {
  try {
    storage?.setItem(MILESTONE_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage may be unavailable (private mode / quota); the upgrade still shows this session.
  }
}
