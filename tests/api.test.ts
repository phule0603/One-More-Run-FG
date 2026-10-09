import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH, POST } from "@/app/api/leaderboard/route";
import { POST as issueToken } from "@/app/api/leaderboard/token/route";
import { COIN_VALUE } from "@/lib/game-config";
import type { LeaderboardResponse } from "@/lib/leaderboard/shared";
import { createFakeRedis } from "./fake-upstash";

const PLAYER_A = "a".repeat(32);
const PLAYER_B = "b".repeat(32);
const T0 = Date.UTC(2026, 9, 9, 12, 0, 0);

const resetBackends = () => {
  const g = globalThis as Record<string, unknown>;
  delete g.__omrMemory;
  delete g.__omrRedis;
};

async function token(): Promise<string> {
  const body = await (await issueToken()).json();
  return body.token;
}

function submit(body: Record<string, unknown>, ip = "203.0.113.1") {
  return POST(
    new Request("http://localhost/api/leaderboard", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    }),
  );
}

/** Issues a token, lets `elapsedMs` pass, then submits a run of `durationMs`. */
async function playAndSubmit(
  playerId: string,
  name: string,
  distance: number,
  coins: number,
  { durationMs = 55_000, elapsedMs = 60_000, ip }: { durationMs?: number; elapsedMs?: number; ip?: string } = {},
) {
  const t = await token();
  vi.setSystemTime(Date.now() + elapsedMs);
  return submit(
    { playerId, name, token: t, distance, coins, durationMs, score: distance + coins * COIN_VALUE },
    ip,
  );
}

async function board(playerId?: string): Promise<LeaderboardResponse> {
  const qs = playerId ? `?playerId=${playerId}` : "";
  return (await GET(new Request(`http://localhost/api/leaderboard${qs}`))).json();
}

beforeEach(() => {
  resetBackends();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetBackends();
});

describe("leaderboard API (memory store)", () => {
  it("accepts runs, ranks players and marks the caller", async () => {
    const a = await playAndSubmit(PLAYER_A, "  Lê  Phú ", 1500, 30);
    expect(await a.json()).toEqual({ ok: true, improved: true, best: 1800, rank: 1 });
    const b = await playAndSubmit(PLAYER_B, "Neo", 2000, 40);
    expect(await b.json()).toEqual({ ok: true, improved: true, best: 2400, rank: 1 });

    const res = await board(PLAYER_A);
    expect(res.enabled).toBe(true);
    expect(res.entries.map((e) => [e.rank, e.name, e.score, e.you])).toEqual([
      [1, "Neo", 2400, false],
      [2, "Lê Phú", 1800, true],
    ]);
    expect(res.you).toEqual({ rank: 2, score: 1800 });
    // player ids are secrets: never echoed back
    expect(JSON.stringify(res)).not.toContain(PLAYER_B);
  });

  it("keeps only a player's best score", async () => {
    await playAndSubmit(PLAYER_A, "A", 1500, 30);
    const worse = await playAndSubmit(PLAYER_A, "A", 100, 0);
    expect(await worse.json()).toEqual({ ok: true, improved: false, best: 1800, rank: 1 });
  });

  it("rejects a token that was already used", async () => {
    const t = await token();
    vi.setSystemTime(T0 + 20_000);
    const run = { playerId: PLAYER_A, name: "A", token: t, distance: 300, coins: 5, durationMs: 15_000, score: 350 };
    expect((await submit(run)).status).toBe(200);
    const replay = await submit(run);
    expect(replay.status).toBe(409);
    expect(await replay.json()).toEqual({ ok: false, error: "token_used" });
  });

  it("rejects runs longer than the time since the token was issued", async () => {
    const res = await playAndSubmit(PLAYER_A, "A", 300, 0, { durationMs: 60_000, elapsedMs: 10_000 });
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual({ ok: false, error: "implausible_run" });
  });

  it("validates input", async () => {
    const t = await token();
    const base = { playerId: PLAYER_A, name: "A", token: t, distance: 10, coins: 0, durationMs: 1000, score: 10 };
    const cases: [Record<string, unknown>, number, string][] = [
      [{ ...base, name: "🔥" }, 400, "invalid_name"],
      [{ ...base, playerId: "nope" }, 400, "invalid_player"],
      [{ ...base, score: 999_999 }, 422, "implausible_run"],
      [{ ...base, token: "forged.token" }, 401, "invalid_token"],
      [{ ...base, score: "10" }, 400, "bad_request"],
    ];
    for (const [body, status, error] of cases) {
      const res = await submit(body);
      expect([res.status, (await res.json()).error]).toEqual([status, error]);
    }
    const malformed = await POST(new Request("http://localhost/api/leaderboard", { method: "POST", body: "{" }));
    expect(malformed.status).toBe(400);
  });

  it("rate-limits submissions per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const res = await playAndSubmit(PLAYER_A, "A", 10 + i, 0, { durationMs: 1000, elapsedMs: 1000 });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    const otherIp = await playAndSubmit(PLAYER_B, "B", 10, 0, { durationMs: 1000, elapsedMs: 1000, ip: "198.51.100.7" });
    expect(otherIp.status).toBe(200);
  });

  it("renames players on the board", async () => {
    await playAndSubmit(PLAYER_A, "Old", 500, 0);
    const rename = (playerId: string, name: string) =>
      PATCH(new Request("http://localhost/api/leaderboard", { method: "PATCH", body: JSON.stringify({ playerId, name }) }));
    expect(await (await rename(PLAYER_A, "New Name")).json()).toEqual({ ok: true, renamed: true });
    expect(await (await rename(PLAYER_B, "Ghost")).json()).toEqual({ ok: true, renamed: false });
    expect((await rename(PLAYER_A, "")).status).toBe(400);
    expect((await board()).entries[0].name).toBe("New Name");
  });
});

describe("leaderboard API configuration", () => {
  it("is disabled in production without Redis credentials", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "");
    expect(await board()).toEqual({ enabled: false, entries: [], you: null });
    expect(await (await issueToken()).json()).toEqual({ enabled: false });
    const res = await submit({});
    expect([res.status, (await res.json()).error]).toEqual([404, "disabled"]);
  });

  it("uses Redis when Vercel/Upstash credentials are set", async () => {
    const fake = createFakeRedis("kv-token");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "kv-token");
    vi.stubGlobal("fetch", fake.fetch);

    const res = await playAndSubmit(PLAYER_A, "Redis Runner", 1200, 10);
    expect(await res.json()).toEqual({ ok: true, improved: true, best: 1300, rank: 1 });
    expect(fake.zsets.get("omr:lb")?.get(PLAYER_A)).toBe(1300);
    const top = await board(PLAYER_A);
    expect(top.entries[0]).toMatchObject({ name: "Redis Runner", score: 1300, distance: 1200, coins: 10, you: true });
  });

  it("reports an unreachable store as 503 instead of crashing", async () => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://down.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "t");
    vi.stubGlobal("fetch", async () => new Response("bad gateway", { status: 502 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await GET(new Request("http://localhost/api/leaderboard"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ enabled: true, error: "store_unavailable" });
  });
});
