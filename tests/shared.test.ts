import { describe, expect, it } from "vitest";
import { COIN_VALUE } from "@/lib/game-config";
import {
  checkRun,
  isPlayerId,
  maxMetersForDuration,
  NAME_MAX_LENGTH,
  parseSubmitRequest,
  sanitizeName,
} from "@/lib/leaderboard/shared";

describe("sanitizeName", () => {
  it("keeps Vietnamese names intact and NFC-normalised", () => {
    expect(sanitizeName("Lê Phú")).toBe("Lê Phú");
    // decomposed input (e + combining circumflex + combining tilde) becomes precomposed "ễ"
    expect(sanitizeName("Nguyễn")).toBe("Nguyễn");
  });

  it("strips disallowed characters and collapses whitespace", () => {
    expect(sanitizeName("  neo<script>  \n\t runner 🚀 ")).toBe("neoscript runner");
    expect(sanitizeName("a_b-c.d")).toBe("a_b-c.d");
  });

  it(`caps names at ${NAME_MAX_LENGTH} characters`, () => {
    expect(sanitizeName("x".repeat(40))).toHaveLength(NAME_MAX_LENGTH);
  });

  it("rejects names without a letter or digit", () => {
    expect(sanitizeName("")).toBeNull();
    expect(sanitizeName("   ")).toBeNull();
    expect(sanitizeName("🔥🔥")).toBeNull();
    expect(sanitizeName("._-")).toBeNull();
    expect(sanitizeName(42)).toBeNull();
  });
});

describe("isPlayerId", () => {
  it("accepts 32 lowercase hex chars only", () => {
    expect(isPlayerId("0123456789abcdef0123456789abcdef")).toBe(true);
    expect(isPlayerId("0123456789ABCDEF0123456789ABCDEF")).toBe(false);
    expect(isPlayerId("short")).toBe(false);
    expect(isPlayerId(null)).toBe(false);
  });
});

describe("maxMetersForDuration", () => {
  it("starts at base speed and approaches max speed", () => {
    expect(maxMetersForDuration(0)).toBe(0);
    // first second ≈ 380 units/s → ~32 m
    expect(maxMetersForDuration(1000)).toBeGreaterThan(31);
    expect(maxMetersForDuration(1000)).toBeLessThan(34);
    const late = maxMetersForDuration(601_000) - maxMetersForDuration(600_000);
    expect(late).toBeCloseTo(940 / 12, 0);
  });
});

describe("checkRun", () => {
  const run = (distance: number, coins: number, durationMs: number) => ({
    distance,
    coins,
    durationMs,
    score: distance + coins * COIN_VALUE,
  });

  it("accepts plausible runs", () => {
    expect(checkRun(run(0, 0, 0))).toBeNull();
    expect(checkRun(run(300, 12, 12_000))).toBeNull();
    // the search bot reached ~12,000 m with ~240 coins in 200 s
    expect(checkRun(run(12_200, 240, 200_000))).toBeNull();
  });

  it("rejects scores that don't add up", () => {
    expect(checkRun({ ...run(300, 12, 12_000), score: 999 })).toBe("implausible_run");
  });

  it("rejects distances faster than the speed curve allows", () => {
    expect(checkRun(run(5_000, 0, 10_000))).toBe("implausible_run");
  });

  it("rejects too many coins", () => {
    expect(checkRun(run(100, 500, 60_000))).toBe("implausible_run");
  });

  it("rejects non-integers, negatives and absurd durations", () => {
    expect(checkRun(run(10.5, 0, 5_000))).toBe("implausible_run");
    expect(checkRun(run(-1, 0, 5_000))).toBe("implausible_run");
    expect(checkRun(run(10, 0, 7 * 3600_000))).toBe("implausible_run");
  });
});

describe("parseSubmitRequest", () => {
  it("requires every field with the right type", () => {
    const ok = {
      playerId: "p",
      name: "n",
      token: "t",
      score: 1,
      distance: 1,
      coins: 0,
      durationMs: 10,
    };
    expect(parseSubmitRequest(ok)).toEqual(ok);
    expect(parseSubmitRequest({ ...ok, score: "1" })).toBeNull();
    expect(parseSubmitRequest({ ...ok, token: undefined })).toBeNull();
    expect(parseSubmitRequest(null)).toBeNull();
    expect(parseSubmitRequest("x")).toBeNull();
  });
});
