import Phaser from "phaser";
import type { TownBridge } from "./bridge";
import { TownScene } from "./TownScene";

export function createGame(parent: HTMLElement, bridge: TownBridge): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: Math.max(1, parent.clientWidth),
    height: Math.max(1, parent.clientHeight),
    backgroundColor: "#3f7d3a",
    pixelArt: true,
    audio: { noAudio: true },
    roundPixels: true,
    // The canvas always fills its container; the scene picks a whole-number camera zoom (game/viewport.ts).
    scale: { mode: Phaser.Scale.RESIZE },
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 } } },
    scene: new TownScene(bridge),
  });
}

