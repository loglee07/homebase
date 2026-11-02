import type { HomeTier } from "@/lib/milestones";
import type { TownView } from "./viewport";

export type InteractableId = "bank" | "home" | "school";

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

  /** What the camera currently shows, for overlays that must stay attached to the map. */
  view: TownView | null = null;
  private viewListeners = new Set<(v: TownView) => void>();
  subscribeView(fn: (v: TownView) => void): () => void {
    this.viewListeners.add(fn);
    if (this.view) fn(this.view);
    return () => void this.viewListeners.delete(fn);
  }
  setView(v: TownView) {
    this.view = v;
    this.viewListeners.forEach((fn) => fn(v));
  }

  setHomeTier(tier: HomeTier, celebrate = false) {
    this.homeTier = tier;
    this.sceneHooks.homeTier?.(tier, celebrate);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.sceneHooks.paused?.(paused);
  }
}
