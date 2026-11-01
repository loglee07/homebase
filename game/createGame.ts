import Phaser from "phaser";
import type { TownBridge } from "./bridge";
import { TownScene } from "./TownScene";
import { WORLD_H, WORLD_W } from "./layout";

export function createGame(parent: HTMLElement, bridge: TownBridge): Phaser.Game {
  return new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: WORLD_W,
    height: WORLD_H,
    backgroundColor: "#3f7d3a",
    pixelArt: true,
    audio: { noAudio: true },
    roundPixels: true,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    physics: { default: "arcade", arcade: { gravity: { x: 0, y: 0 } } },
    scene: new TownScene(bridge),
  });
}

