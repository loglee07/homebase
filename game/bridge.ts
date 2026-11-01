import type { HomeTier } from "@/lib/milestones";

export type InteractableId = "bank" | "home";

/** Plain handoff between React and the Phaser scene; no Phaser import so React can use it freely. */
export class TownBridge {
  homeTier: HomeTier = 1;
  paused = false;
  onInteract: (id: InteractableId) => void = () => {};
  onPrompt: (id: InteractableId | null) => void = () => {};

  setHandlers(h: { onInteract: (id: InteractableId) => void; onPrompt: (id: InteractableId | null) => void }) {
    this.onInteract = h.onInteract;
    this.onPrompt = h.onPrompt;
  }
  /** Registered by the scene. */
  sceneHooks: { homeTier?: (t: HomeTier, celebrate: boolean) => void; paused?: (p: boolean) => void } = {};

  setHomeTier(tier: HomeTier, celebrate = false) {
    this.homeTier = tier;
    this.sceneHooks.homeTier?.(tier, celebrate);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.sceneHooks.paused?.(paused);
  }
}
