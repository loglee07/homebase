# Art assets

## Licensed art (optional, not in this repo)

The town uses the **Cute Fantasy Free** pack by **Kenmi** when it is present locally:
https://kenmi-art.itch.io/cute-fantasy-rpg

License of the free version: non-commercial projects only, modifications allowed, **no redistribution or resale, even if modified**. This repo is public, so none of the pack's files, crops, edits or atlases are committed. `/public/licensed/` and `*.zip` are gitignored.

### Install locally
1. Download the free pack from the itch.io page above and unzip it.
2. Copy the contents so these files exist (names and folders exactly as in the pack):

```
public/licensed/cute-fantasy/
  Tiles/Grass_Middle.png
  Tiles/Path_Tile.png
  Tiles/Water_Tile.png
  Outdoor decoration/Outdoor_Decor_Free.png
  Outdoor decoration/Fences.png
  Outdoor decoration/Oak_Tree_Small.png
  Player/Player.png
```
3. Reload. No build step: files are served from `public/` and loaded at runtime.

### Fallback
If `Tiles/Grass_Middle.png` is missing, the scene skips the pack entirely and uses the code-drawn art in `game/art.ts` (the browser logs one 404 for that probe file). If the probe exists but any other required file fails to load, it also falls back. A fresh clone runs without the pack.

### How it is wired
`game/licensed.ts` holds the file list, sprite-sheet crops, the 16px autotile logic for path and water, and player frame math. `TownScene.create()` loads the probe in `preload()`, then loads the rest and calls `build()`. All pack-specific branches check `this.licensed`.

### What uses the pack
Grass, dirt path and pond tiles (autotiled), grass tufts and flowers, oak trees, lamp posts, rocks, flower bushes, rail fences, and the player (idle/walk, 4 directions; left is the right-facing row flipped).

## Placeholders to replace (still code-drawn)
Matching the pack means 16px tiles, soft dark outlines, and a top-down 3/4 view with the sprite's base on the ground line. Anchor = the point placed on the layout coordinate (`game/layout.ts`). Footprint = what blocks walking.

| Sprite | Source size | Anchor | Collision footprint | Notes |
|---|---|---|---|---|
| Cottage (home tier 1) | done: custom `public/sprites/home_1.png` (64x72) | bottom-center, x=112, y=128 | x80 y72 w64 h56 | Chimney smoke near (129,60) |
| Manor (home tier 2) | done: custom `public/sprites/home_2.png` (96x75) | bottom-center, x=112, y=128 | x64 y56 w96 h72 | Chimney smoke near (92,56); bush slots at (96,134) and (128,134) |
| Bank | done: custom `public/sprites/bank.png` (96x75) | bottom-center, x=368, y=128 | x320 y56 w96 h72 | The "BANK" sign is not legible at this size; the coin is |
| Fountain | 32x32, 2 frames | bottom-center, x=240, y=192 | x226 y174 w28 h18 | Frames swap every 450ms (water shimmer) |
| Bench | 20x10 | bottom-center | w18 h5 | Used at (206,238), (274,238) |
| Mailbox | 10x16 | bottom-center, (88,152) | x85 y148 w6 h4 | |
| Blossom tree | 32x48 frame, same layout as `Oak_Tree_Small.png` frame 1 | trunk base | w8 h5 at trunk base | Currently shows a plain oak |
| Autumn tree | 32x48 frame, same as above | trunk base | w8 h5 | Currently shows a plain oak |
| Path surface | done: custom `public/sprites/cobble.png` (48x48 seamless) | world-aligned tile | none | With the pack, path tiles keep the pack's bushy edges and only their dirt pixels become cobblestone (`drawLicensedGround`); without the pack the path stays dirt |
| Spark / smoke puff (optional) | 7x7 / 6x6 | center | none | Effects only |

Note on `home_1.png`: **temporary, high-detail asset.** It is nearest-sampled from AI-generated art (~7.6px blocks), so every pixel is a true source color with no blended edges, but it has ~2,700 colors versus the pack's roughly 10 per sprite. Its replacement should be designed natively for the existing 64x72 canvas (bottom-center anchor, same footprint) with a small palette. No further renderer changes or automatic palette reduction are planned.

Status: manor and bank sprites are likewise nearest-sampled from high-detail source art (same caveat as the cottage, to be replaced by native art). The manor tier was checked in the browser with the new sprite: door prompt reachable. Both door walks start under their building.

Source dimensions for buildings keep today's layout, so no layout changes are needed. The pack's own house is 96x128 and was not used (wrong scale for this layout and not a bank).
