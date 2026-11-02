"use client";

import { useEffect, useRef } from "react";
import type { TownBridge } from "@/game/bridge";
import { nameplatesFor } from "@/game/nameplates";
import { NAMEPLATE_GAP } from "@/game/nameplates";
import { toScreen, type TownView } from "@/game/viewport";

/**
 * Wooden nameplates above the buildings. The scene reports what the camera shows (zoom and scroll); each plaque is moved
 * straight in the DOM so it stays attached to its roof while the map scrolls, without re-rendering React every frame.
 * Purely decorative: ignores the pointer and focus.
 */
export function Nameplates({ bridge, homeTier }: { bridge: TownBridge; homeTier: 1 | 2 }) {
  const layer = useRef<HTMLDivElement>(null);
  const view = useRef<TownView | null>(null);
  const plates = nameplatesFor(homeTier);

  useEffect(() => {
    const place = () => {
      const el = layer.current;
      const v = view.current;
      if (!el || !v) return;
      el.style.display = "block";
      el.style.fontSize = `${Math.max(11, Math.min(26, v.zoom * 7.5))}px`;
      for (const p of nameplatesFor(homeTier)) {
        const node = el.querySelector<HTMLElement>(`[data-plaque="${p.id}"]`);
        if (!node) continue;
        const s = toScreen(v, p.x, p.roofY - NAMEPLATE_GAP);
        node.style.transform = `translate(${Math.round(s.x)}px, ${Math.round(s.y)}px)`;
      }
    };
    const off = bridge.subscribeView((v) => {
      view.current = v;
      place();
    });
    place();
    return off;
  }, [bridge, homeTier]);

  return (
    <div ref={layer} className="ft-nameplates" aria-hidden="true" style={{ display: "none" }}>
      {plates.map((p) => (
        <span key={p.id} className="ft-plaque-pos" data-plaque={p.id}>
          <span className="ft-plaque">{p.text}</span>
        </span>
      ))}
    </div>
  );
}
