"use client";

import { useEffect, useRef } from "react";
import { createGame } from "@/game/createGame";
import type { TownBridge } from "@/game/bridge";

export default function TownGame({ bridge }: { bridge: TownBridge }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = ref.current;
    if (!parent) return;
    const game = createGame(parent, bridge);
    return () => {
      // Phaser destroys on the next frame; clear now so a StrictMode remount never shows two canvases.
      game.destroy(true);
      parent.replaceChildren();
    };
  }, [bridge]);
  return <div ref={ref} className="ft-canvas" aria-label="Finance Town map. Move with WASD or arrow keys." role="application" />;
}
