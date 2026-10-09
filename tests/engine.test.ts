import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { Engine } from "@/hooks/useOneMoreRun";
import { BASE_SPEED, MAX_SPEED } from "@/lib/game-config";
import { MAX_LIVES, pickPower, SAVE_INVULN, SLOW_FACTOR, type PowerKind } from "@/lib/powerups";
import { fakeCanvas, installFakeDom } from "./helpers/fake-dom";

const STEP = 1 / 120;

/** The engine's private state, as the tests poke at it. */
interface Internals {
  phase: string;
  player: { x: number; y: number; vy: number; grounded: boolean; airJumps: number };
  obstacles: Record<string, unknown>[];
  coins: { x: number; y: number; taken: boolean }[];
  gifts: { x: number; y: number; kind: PowerKind; taken: boolean }[];
  powers: Record<"magnet" | "ghost" | "slow" | "wings", number>;
  lives: number;
  invuln: number;
  slowMul: number;
  speed: number;
  speedFactor: number;
  diff: number;
  coinCount: number;
  nextSpawn: number;
  update(dt: number): void;
  press(): void;
  spawnPattern(): number;
}

function startRun(): Internals {
  const engine = new Engine(fakeCanvas(), {
    onPhase() {},
    onMeta() {},
    onRunStart() {},
    onRunEnd() {},
  });
  engine.resize();
  const e = engine as unknown as Internals;
  e.press(); // ready → playing
  return e;
}

/** A run with no obstacles spawning, so a test controls exactly what is on the track. */
function emptyTrack(): Internals {
  const e = startRun();
  e.nextSpawn = Infinity;
  e.obstacles.length = 0;
  return e;
}

const run = (e: Internals, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) {
    e.update(STEP);
    if (e.phase !== "playing") return;
  }
};

beforeEach(() => installFakeDom());
afterEach(() => vi.unstubAllGlobals());

describe("gifts", () => {
  it("appear only mid-gap, at running height, clear of every obstacle", () => {
    const e = startRun();
    e.invuln = Infinity; // survive the whole simulation without playing
    const seen = new Set<object>();
    let worstClearance = Infinity;
    for (let t = 0; t < 200; t += STEP) {
      e.update(STEP);
      for (const g of e.gifts) {
        seen.add(g);
        expect(g.y).toBe(22);
        for (const o of e.obstacles as { x: number; w: number }[]) {
          const clearance = g.x < o.x ? o.x - g.x : g.x - (o.x + o.w);
          worstClearance = Math.min(worstClearance, clearance);
        }
      }
    }
    // first gift after 7–10 s, then one every 14–22 s
    expect(seen.size).toBeGreaterThanOrEqual(8);
    expect(seen.size).toBeLessThanOrEqual(14);
    expect(worstClearance).toBeGreaterThan(60);
  });

  it("never offers a second extra life while one is held", () => {
    const rolls = Array.from({ length: 2000 }, (_, i) =>
      pickPower(() => (i + 0.5) / 2000, (k) => (k === "life" ? 0 : 1)),
    );
    expect(rolls).not.toContain("life");
    expect(new Set(rolls).size).toBe(4);
    expect(MAX_LIVES).toBe(1);
  });
});

describe("power-ups", () => {
  it("GHOST passes through obstacles and never ends inside one", () => {
    const e = emptyTrack();
    // a long block right on top of the runner, and almost no ghost time left
    e.obstacles.push({ kind: "block", x: e.player.x - 10, w: 300, h: 60 });
    e.powers.ghost = 0.05;
    run(e, 0.3);
    expect(e.phase).toBe("playing");
    expect(e.powers.ghost).toBeGreaterThan(0); // held while still inside the block
    run(e, 1.2);
    expect(e.phase).toBe("playing");
    expect(e.powers.ghost).toBe(0); // released once clear
  });

  it("+1 LIFE absorbs exactly one hit", () => {
    const e = emptyTrack();
    e.lives = 1;
    e.obstacles.push({ kind: "spike", x: e.player.x + 5, w: 30, h: 36, n: 1 });
    run(e, STEP);
    expect(e.phase).toBe("playing");
    expect(e.lives).toBe(0);
    expect(e.invuln).toBeGreaterThan(SAVE_INVULN - 0.05);
    expect(e.player.vy).toBeGreaterThan(0); // bounced up

    run(e, SAVE_INVULN + 1); // invulnerability over, back on the ground
    expect(e.player.grounded).toBe(true);
    e.obstacles.push({ kind: "spike", x: e.player.x + 5, w: 30, h: 36, n: 1 });
    run(e, STEP);
    expect(e.phase).toBe("dead");
  });

  it("MAGNET pulls in coins the runner could not otherwise reach", () => {
    const withMagnet = emptyTrack();
    const without = emptyTrack();
    for (const e of [withMagnet, without]) {
      e.coins.push({ x: e.player.x + 120, y: 150, taken: false });
    }
    withMagnet.powers.magnet = 8;
    run(withMagnet, 1);
    run(without, 1);
    expect(withMagnet.coinCount).toBe(1);
    expect(without.coinCount).toBe(0);
  });

  it("TRIPLE JUMP adds one air jump, and only while active", () => {
    const e = emptyTrack();
    e.powers.wings = 10;
    e.press(); // ground jump
    expect(e.player.airJumps).toBe(2);
    run(e, 0.1);
    e.press();
    expect(e.player.airJumps).toBe(1);
    run(e, 0.1);
    e.press();
    expect(e.player.airJumps).toBe(0);

    const plain = emptyTrack();
    plain.press();
    expect(plain.player.airJumps).toBe(1);
    run(plain, 0.1);
    plain.press();
    run(plain, 0.1);
    const vy = plain.player.vy;
    plain.press(); // no third jump
    expect(plain.player.vy).toBe(vy);
  });

  it("SLOW-MO slows the world but keeps new patterns spaced for full speed", () => {
    const e = emptyTrack();
    e.powers.slow = 5;
    run(e, 1);
    const nominal = (BASE_SPEED + (MAX_SPEED - BASE_SPEED) * e.diff) * e.speedFactor;
    expect(e.speed / nominal).toBeGreaterThan(SLOW_FACTOR - 0.01);
    expect(e.speed / nominal).toBeLessThan(SLOW_FACTOR + 0.05);
    // the shortest gap the spawner allows at this difficulty, in seconds of travel
    const minGap = Math.max(0.62, 1.15 - e.diff * 0.5);
    for (let i = 0; i < 50; i++) {
      // ...measured at full (not slowed) speed, so it still holds once slow-mo ends
      expect(e.spawnPattern()).toBeGreaterThanOrEqual(minGap * nominal);
    }
    // those 50 patterns were all spawned at the same spot: clear them before running on
    e.obstacles.length = 0;
    e.coins.length = 0;
    e.gifts.length = 0;
    run(e, 5);
    expect(e.phase).toBe("playing");
    expect(e.slowMul).toBeGreaterThan(0.99); // eases back to full speed
  });
});
