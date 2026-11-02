import Phaser from "phaser";
import type { TownBridge, InteractableId } from "./bridge";
import type { HomeTier } from "@/lib/milestones";
import { drawBuildings, drawGround, drawGroundFill, drawProps, type Dir } from "./art";
import {
  CF, COBBLE, FENCE_FRAME, OAK, PLAYER_ORIGIN_Y, addDecorFrames, drawLicensedFill, drawLicensedGround, licensedLoaded, playerFrame, probeLoaded,
  queueLicensed, queueProbe,
} from "./licensed";
import {
  BANK_CENTER_X, BANK_FOOTPRINT, SCHOOL_CENTER_X, SCHOOL_FOOTPRINT, BENCHES, BUILDING_BASE_Y, BUSHES, FENCES, FOUNTAIN, FOUNTAIN_BLOCK, HOME_CENTER_X,
  HOME_FOOTPRINT, INTERACT_ZONES, LAMPS, MAILBOX, ROCKS, SPAWN, TREES, WORLD_H, WORLD_W, buildPadTrees, pondBlocks, waterBlocks, type Rect, type TreeSpec,
} from "./layout";
import { EXT_H, EXT_W, PAD_X, PAD_Y, sameView, viewFor } from "./viewport";

/** texture key -> file in public/sprites */
const CUSTOM_SPRITES = [{ key: "home_1", file: "home_1" }, { key: "home_2", file: "home_2" }, { key: "bank", file: "bank" }, { key: "school", file: "school" }];
const SPEED = 62;
const WALK_FRAMES = [1, 0, 2, 0];

export class TownScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Sprite;
  private shadow!: Phaser.GameObjects.Image;
  private blockers!: Phaser.Physics.Arcade.StaticGroup;
  private houseBlockers!: Phaser.Physics.Arcade.StaticGroup;
  private home!: Phaser.GameObjects.Image;
  private homeDecor: Phaser.GameObjects.Image[] = [];
  private fountain!: Phaser.GameObjects.Image;
  private keys!: Record<"up" | "down" | "left" | "right" | "w" | "a" | "s" | "d" | "e", Phaser.Input.Keyboard.Key>;
  private dir: Dir = "down";
  private walkClock = 0;
  private idleClock = 0;
  private licensed = false;
  private shutDown = false;
  private prompt: InteractableId | null = null;
  private tier: HomeTier = 1;

  constructor(private readonly bridge: TownBridge) {
    super("town");
  }

  preload() {
    queueProbe(this);
    for (const k of CUSTOM_SPRITES) this.load.image(`custom_${k.key}`, `/sprites/${k.file}.png`);
    this.load.image(COBBLE, "/sprites/cobble.png");
  }

  create() {
    // Licensed art is optional: load it only if the probe file exists, else build with the code-drawn art.
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => (this.shutDown = true));
    if (!probeLoaded(this)) return this.build();
    queueLicensed(this);
    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      if (this.shutDown) return;
      this.licensed = licensedLoaded(this);
      if (this.licensed) addDecorFrames(this);
      this.build();
    });
    this.load.start();
  }

  private build() {
    drawProps(this);
    drawBuildings(this);
    // custom sprites replace the code-drawn placeholders (our own art, committed under public/sprites)
    for (const { key } of CUSTOM_SPRITES) {
      if (!this.textures.exists(`custom_${key}`)) continue;
      this.textures.remove(key);
      this.textures.renameTexture(`custom_${key}`, key);
    }
    const solids: Rect[] = [];
    const blockedForFlowers = (x: number, y: number) =>
      (x > 56 && x < 168 && y > 40 && y < 150) || (x > 312 && x < 424 && y > 40 && y < 150) || (x > 184 && x < 296 && y > 40 && y < 150) || (x > 216 && x < 264 && y > 150 && y < 200);
    (this.licensed ? drawLicensedGround : drawGround)(this, blockedForFlowers);
    // Extra terrain for big windows: grass tiled under and around the village, then a loose forest. All decoration.
    (this.licensed ? drawLicensedFill : drawGroundFill)(this);
    this.add.tileSprite(-PAD_X, -PAD_Y, EXT_W, EXT_H, "ground_fill").setOrigin(0, 0).setDepth(-1);
    this.add.image(0, 0, "ground").setOrigin(0, 0).setDepth(0);
    for (const t of buildPadTrees(PAD_X, PAD_Y)) this.addTree(t);

    this.blockers = this.physics.add.staticGroup();
    this.houseBlockers = this.physics.add.staticGroup();

    for (const t of TREES) {
      this.addTree(t);
      solids.push({ x: t.x - 4, y: t.y - 5, w: 8, h: 5 });
    }
    for (const p of [...LAMPS, ...BENCHES, MAILBOX, ...FENCES]) if (p.solid) solids.push(p.solid);
    for (const l of LAMPS) {
      if (this.licensed) this.add.image(l.x, l.y + 1, CF.decor, "lamp").setOrigin(0.5, 1).setDepth(l.y);
      else this.add.image(l.x, l.y + 1, "lamp").setOrigin(0.5, 1).setDepth(l.y);
    }
    for (const b of BENCHES) this.add.image(b.x, b.y + 1, "bench").setOrigin(0.5, 1).setDepth(b.y);
    this.add.image(MAILBOX.x, MAILBOX.y + 1, "mailbox").setOrigin(0.5, 1).setDepth(MAILBOX.y);
    FENCES.forEach((f, i) => {
      if (this.licensed) {
        this.add.image(f.x, f.y + 1, CF.fences, i % 2 ? FENCE_FRAME.right : FENCE_FRAME.left).setOrigin(0.5, 13 / 16).setDepth(f.y);
      } else {
        this.add.image(f.x, f.y + 1, "fence").setOrigin(0.5, 1).setDepth(f.y);
      }
    });
    ROCKS.forEach((r, i) => {
      if (this.licensed) this.add.image(r.x, r.y, CF.decor, i % 2 ? "rockSmall" : "rockLarge").setOrigin(0.5, 1).setDepth(r.y);
      else this.add.image(r.x, r.y, "rock").setOrigin(0.5, 1).setDepth(r.y);
    });
    for (const b of BUSHES) this.bush(b.x, b.y);

    this.fountain = this.add.image(FOUNTAIN.x, FOUNTAIN.y + 1, "fountain_0").setOrigin(0.5, 1).setDepth(FOUNTAIN.y);
    solids.push(FOUNTAIN_BLOCK);
    this.time.addEvent({ delay: 450, loop: true, callback: () => this.fountain.setTexture(this.fountain.texture.key === "fountain_0" ? "fountain_1" : "fountain_0") });

    this.add.image(BANK_CENTER_X, BUILDING_BASE_Y + 1, "bank").setOrigin(0.5, 1).setDepth(BUILDING_BASE_Y);
    solids.push(BANK_FOOTPRINT);
    this.add.image(SCHOOL_CENTER_X, BUILDING_BASE_Y + 1, "school").setOrigin(0.5, 1).setDepth(BUILDING_BASE_Y);
    solids.push(SCHOOL_FOOTPRINT);
    solids.push(...(this.licensed ? waterBlocks() : pondBlocks()));
    for (const s of solids) this.addBlock(this.blockers, s);

    this.home = this.add.image(HOME_CENTER_X, BUILDING_BASE_Y + 1, "home_1").setOrigin(0.5, 1).setDepth(BUILDING_BASE_Y);

    // player
    // the pack's player frames carry their own shadow
    this.shadow = this.add.image(SPAWN.x, SPAWN.y, "shadow").setOrigin(0.5, 0.5).setVisible(!this.licensed);
    this.player = this.licensed
      ? this.physics.add.sprite(SPAWN.x, SPAWN.y, CF.player, 0).setOrigin(0.5, PLAYER_ORIGIN_Y)
      : this.physics.add.sprite(SPAWN.x, SPAWN.y, "player_down_0").setOrigin(0.5, 1);
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    body.setSize(8, 5);
    body.setOffset((this.player.width - 8) / 2, this.player.height * this.player.originY - 5);
    this.physics.world.setBounds(10, 30, WORLD_W - 20, WORLD_H - 36);
    // The canvas fills the window (RESIZE). The camera zooms in whole steps and follows the player inside the village.
    this.cameras.main.setBackgroundColor("#3f7d3a");
    const onResize = () => this.updateCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.scale.off(Phaser.Scale.Events.RESIZE, onResize));
    body.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.blockers);
    this.physics.add.collider(this.player, this.houseBlockers);

    const kb = this.input.keyboard!;
    this.keys = kb.addKeys("UP,DOWN,LEFT,RIGHT,W,A,S,D,E", true) as typeof this.keys;
    // addKeys keys by name; normalise to lowercase for lookup
    const k = this.keys as unknown as Record<string, Phaser.Input.Keyboard.Key>;
    this.keys = {
      up: k.UP, down: k.DOWN, left: k.LEFT, right: k.RIGHT, w: k.W, a: k.A, s: k.S, d: k.D, e: k.E,
    };

    this.applyHomeTier(this.bridge.homeTier, false);
    this.bridge.sceneHooks.homeTier = (t, celebrate) => this.applyHomeTier(t, celebrate);
    this.bridge.sceneHooks.paused = (p) => this.applyPaused(p);
    this.applyPaused(this.bridge.paused);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.bridge.sceneHooks = {};
    });

    // chimney smoke
    this.time.addEvent({ delay: 900, loop: true, callback: () => this.puff() });
  }

  private addTree(t: TreeSpec) {
    if (this.licensed) {
      const oak = t.kind === "oak2" || t.kind === "blossom" ? OAK.shaded : OAK.plain;
      this.add.image(t.x, t.y + 1, CF.oak, oak.frame).setOrigin(0.5, oak.originY).setDepth(t.y);
    } else {
      this.add.image(t.x, t.y + 1, `tree_${t.kind}`).setOrigin(0.5, 1).setDepth(t.y);
    }
  }

  private bush(x: number, y: number) {
    const img = this.licensed ? this.add.image(x, y, CF.decor, "flowerBush") : this.add.image(x, y, "bush");
    return img.setOrigin(0.5, 1).setDepth(y);
  }

  private addBlock(group: Phaser.Physics.Arcade.StaticGroup, r: Rect) {
    const rect = this.add.rectangle(r.x + r.w / 2, r.y + r.h / 2, r.w, r.h).setVisible(false);
    this.physics.add.existing(rect, true);
    group.add(rect);
  }

  private applyHomeTier(tier: HomeTier, celebrate: boolean) {
    this.tier = tier;
    this.home.setTexture(`home_${tier}`);
    this.houseBlockers.clear(true, true);
    const fp = HOME_FOOTPRINT[tier];
    this.addBlock(this.houseBlockers, fp);
    this.homeDecor.forEach((d) => d.destroy());
    this.homeDecor = [];
    if (tier === 2) {
      for (const [x, y] of [[96, 134], [128, 134]]) {
        this.homeDecor.push(this.bush(x, y));
      }
    }
    // never leave the player inside the new footprint
    const b = this.player?.body as Phaser.Physics.Arcade.Body | undefined;
    if (b && Phaser.Geom.Rectangle.Overlaps(new Phaser.Geom.Rectangle(fp.x, fp.y, fp.w, fp.h), new Phaser.Geom.Rectangle(b.x, b.y, b.width, b.height))) {
      this.player.setPosition(HOME_CENTER_X, BUILDING_BASE_Y + 24);
    }
    if (celebrate) this.celebrate();
  }

  private celebrate() {
    this.cameras.main.flash(350, 255, 244, 200);
    const cx = HOME_CENTER_X;
    for (let i = 0; i < 18; i++) {
      const s = this.add.image(cx + Phaser.Math.Between(-40, 40), BUILDING_BASE_Y - Phaser.Math.Between(10, 70), "spark").setDepth(500).setAlpha(0);
      this.tweens.add({
        targets: s, alpha: { from: 1, to: 0 }, y: s.y - Phaser.Math.Between(10, 28), scale: { from: 0.6, to: 1.3 },
        delay: i * 55, duration: 900, onComplete: () => s.destroy(),
      });
    }
  }

  private puff() {
    const pos = this.tier === 2 ? { x: 92, y: 56 } : { x: 129, y: 60 };
    const p = this.add.image(pos.x, pos.y, "puff").setDepth(BUILDING_BASE_Y + 1).setAlpha(0.8);
    this.tweens.add({ targets: p, y: p.y - 22, x: p.x + 8, alpha: 0, scale: 1.8, duration: 2400, onComplete: () => p.destroy() });
  }

  private lastView: ReturnType<typeof viewFor> | null = null;
  /** Zoom and scroll for the current canvas size and player position. Tells React so labels stay attached to the map. */
  private updateCamera() {
    if (!this.player) return;
    const cam = this.cameras.main;
    const { width, height } = this.scale.gameSize;
    const v = viewFor(width, height, this.player.x, this.player.y - 4);
    if (sameView(this.lastView, v)) return;
    this.lastView = v;
    cam.setZoom(v.zoom);
    cam.centerOn(v.left + width / v.zoom / 2, v.top + height / v.zoom / 2);
    this.bridge.setView(v);
  }

  private applyPaused(paused: boolean) {
    const kb = this.input.keyboard;
    if (!kb) return;
    if (paused) {
      kb.disableGlobalCapture();
      kb.resetKeys();
      this.player?.setVelocity(0, 0);
      this.setPrompt(null);
    } else {
      kb.enableGlobalCapture();
    }
  }

  private setPrompt(id: InteractableId | null) {
    if (id === this.prompt) return;
    this.prompt = id;
    this.bridge.onPrompt(id);
  }

  update(_t: number, delta: number) {
    if (!this.player) return;
    const paused = this.bridge.paused;
    const k = this.keys;
    let vx = 0;
    let vy = 0;
    if (!paused) {
      if (k.left.isDown || k.a.isDown) vx -= 1;
      if (k.right.isDown || k.d.isDown) vx += 1;
      if (k.up.isDown || k.w.isDown) vy -= 1;
      if (k.down.isDown || k.s.isDown) vy += 1;
    }
    const moving = vx !== 0 || vy !== 0;
    if (moving) {
      const len = Math.hypot(vx, vy);
      this.player.setVelocity((vx / len) * SPEED, (vy / len) * SPEED);
      this.dir = vy !== 0 && Math.abs(vy) >= Math.abs(vx) ? (vy < 0 ? "up" : "down") : vx < 0 ? "left" : "right";
      this.walkClock += delta;
      this.idleClock = 0;
    } else {
      this.player.setVelocity(0, 0);
      this.walkClock = 0;
      this.idleClock += delta;
    }
    if (this.licensed) {
      this.player.setFrame(playerFrame(this.dir, moving, moving ? this.walkClock : this.idleClock));
      this.player.setFlipX(this.dir === "left");
    } else {
      const frame = moving ? WALK_FRAMES[Math.floor(this.walkClock / 130) % WALK_FRAMES.length] : 0;
      this.player.setTexture(`player_${this.dir}_${frame}`);
    }
    this.player.setDepth(this.player.y);
    this.updateCamera();
    this.shadow.setPosition(this.player.x, this.player.y - 2).setDepth(this.player.y - 0.5);

    if (paused) return;
    const b = this.player.body as Phaser.Physics.Arcade.Body;
    const cx = b.x + b.width / 2;
    const cy = b.y + b.height / 2;
    let near: InteractableId | null = null;
    for (const id of Object.keys(INTERACT_ZONES) as InteractableId[]) {
      const z = INTERACT_ZONES[id];
      if (cx >= z.x && cx <= z.x + z.w && cy >= z.y && cy <= z.y + z.h) near = id;
    }
    this.setPrompt(near);
    if (near && Phaser.Input.Keyboard.JustDown(k.e)) this.bridge.onInteract(near);
  }
}
