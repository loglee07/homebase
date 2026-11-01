import { describe, expect, it } from "vitest";
import {
  HOME_UPGRADE_THRESHOLD_CENTS as T,
  INITIAL_MILESTONES,
  MILESTONE_STORAGE_KEY,
  applyMilestones,
  loadMilestones,
  saveMilestones,
} from "@/lib/milestones";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = { ...initial };
  return {
    data,
    getItem: (k: string) => data[k] ?? null,
    setItem: (k: string, v: string) => void (data[k] = v),
  };
}

const at = () => "2026-11-01T00:00:00.000Z";

describe("home upgrade milestone", () => {
  it("does not upgrade below the threshold", () => {
    const r = applyMilestones(INITIAL_MILESTONES, T - 1, at);
    expect(r.upgraded).toBe(false);
    expect(r.state.homeTier).toBe(1);
  });

  it("upgrades at exactly the threshold and records when", () => {
    const r = applyMilestones(INITIAL_MILESTONES, T, at);
    expect(r.upgraded).toBe(true);
    expect(r.state).toEqual({ version: 1, homeTier: 2, homeUpgradedAt: at() });
  });

  it("never downgrades after net worth drops", () => {
    const up = applyMilestones(INITIAL_MILESTONES, T + 1, at).state;
    const later = applyMilestones(up, 0, at);
    expect(later.upgraded).toBe(false);
    expect(later.state.homeTier).toBe(2);
  });

  it("does not re-fire when already upgraded", () => {
    const up = applyMilestones(INITIAL_MILESTONES, T, at).state;
    expect(applyMilestones(up, T * 2, at).upgraded).toBe(false);
  });
});

describe("milestone persistence", () => {
  it("round-trips through storage (survives reload)", () => {
    const store = memoryStorage();
    const up = applyMilestones(INITIAL_MILESTONES, T, at).state;
    saveMilestones(store, up);
    const reloaded = loadMilestones(store);
    expect(reloaded.homeTier).toBe(2);
    // net worth back below threshold after reload: still upgraded
    expect(applyMilestones(reloaded, 1, at).state.homeTier).toBe(2);
  });

  it("falls back to initial for missing, corrupt, or unknown data", () => {
    expect(loadMilestones(memoryStorage())).toEqual(INITIAL_MILESTONES);
    expect(loadMilestones(memoryStorage({ [MILESTONE_STORAGE_KEY]: "{nope" }))).toEqual(INITIAL_MILESTONES);
    expect(loadMilestones(memoryStorage({ [MILESTONE_STORAGE_KEY]: '{"version":1,"homeTier":9}' }))).toEqual(INITIAL_MILESTONES);
    expect(loadMilestones(null)).toEqual(INITIAL_MILESTONES);
  });

  it("tolerates throwing storage", () => {
    const boom = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(loadMilestones(boom)).toEqual(INITIAL_MILESTONES);
    expect(() => saveMilestones(boom, INITIAL_MILESTONES)).not.toThrow();
  });
});
