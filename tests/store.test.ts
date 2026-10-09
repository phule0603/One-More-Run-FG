import { describe, expect, it } from "vitest";
import { MemoryStore, RedisRestStore, type LeaderboardStore } from "@/lib/leaderboard/store";
import { createFakeRedis } from "./fake-upstash";

const id = (n: number) => n.toString(16).padStart(32, "0");
const entry = (n: number, score: number, name = `P${n}`) => ({
  playerId: id(n),
  name,
  score,
  distance: score,
  coins: 0,
  at: 1000 + n,
});

const backends: [string, () => LeaderboardStore][] = [
  ["MemoryStore", () => new MemoryStore()],
  [
    "RedisRestStore",
    () => new RedisRestStore("https://fake.upstash.io/", "test-token", "omr:", createFakeRedis().fetch),
  ],
];

describe.each(backends)("%s", (_, make) => {
  it("ranks players by their best score", async () => {
    const store = make();
    await store.submit(entry(1, 100));
    await store.submit(entry(2, 300));
    await store.submit(entry(3, 200));
    const top = await store.top(10);
    expect(top.map((e) => [e.name, e.score])).toEqual([
      ["P2", 300],
      ["P3", 200],
      ["P1", 100],
    ]);
    expect(top[0]).toMatchObject({ playerId: id(2), distance: 300, coins: 0, at: 1002 });
    expect(await store.top(2)).toHaveLength(2);
    expect(await store.rankOf(id(3))).toEqual({ rank: 2, score: 200 });
    expect(await store.rankOf(id(9))).toBeNull();
  });

  it("keeps the best score but always takes the latest name", async () => {
    const store = make();
    expect(await store.submit(entry(1, 500))).toEqual({ improved: true, best: 500, rank: 1 });
    expect(await store.submit(entry(1, 200, "Renamed"))).toEqual({
      improved: false,
      best: 500,
      rank: 1,
    });
    const [top] = await store.top(1);
    expect(top).toMatchObject({ name: "Renamed", score: 500, distance: 500 });
    expect(await store.submit(entry(1, 800))).toEqual({ improved: true, best: 800, rank: 1 });
  });

  it("renames only players already on the board", async () => {
    const store = make();
    await store.submit(entry(1, 50));
    expect(await store.rename(id(1), "Neo")).toBe(true);
    expect(await store.rename(id(2), "Ghost")).toBe(false);
    expect((await store.top(5)).map((e) => e.name)).toEqual(["Neo"]);
  });

  it("stores, lists and removes shared avatars", async () => {
    const store = make();
    await store.submit(entry(1, 100));
    await store.submit(entry(2, 50));
    await store.setAvatar(id(1), "data:image/jpeg;base64,AAAA");
    expect((await store.top(5)).map((e) => e.avatar)).toEqual(["data:image/jpeg;base64,AAAA", null]);
    await store.setAvatar(id(1), null);
    expect((await store.top(5)).map((e) => e.avatar)).toEqual([null, null]);
  });

  it("burns each nonce once", async () => {
    const store = make();
    expect(await store.claimNonce("abc", 60)).toBe(true);
    expect(await store.claimNonce("abc", 60)).toBe(false);
    expect(await store.claimNonce("def", 60)).toBe(true);
  });

  it("rate-limits per key", async () => {
    const store = make();
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await store.hit("ip:1", 3, 600));
    expect(results).toEqual([true, true, true, false]);
    expect(await store.hit("ip:2", 3, 600)).toBe(true);
  });
});

describe("RedisRestStore protocol", () => {
  it("sends authenticated pipelines and surfaces Redis errors", async () => {
    const fake = createFakeRedis("right");
    const bad = new RedisRestStore("https://x.upstash.io", "wrong", "omr:", fake.fetch);
    await expect(bad.top(10)).rejects.toThrow(/HTTP 401/);

    const good = new RedisRestStore("https://x.upstash.io", "right", "omr:", fake.fetch);
    await good.submit(entry(1, 10));
    expect(fake.commands.map((c) => c[0])).toEqual(["ZADD", "HSET", "ZSCORE", "ZREVRANK", "HSET"]);
    expect(fake.commands[0]).toEqual(["ZADD", "omr:lb", "GT", "CH", "10", id(1)]);

    const broken = new RedisRestStore("https://x.upstash.io", "right", "omr:", (async () =>
      Response.json([{ error: "WRONGTYPE" }])) as typeof fetch);
    await expect(broken.claimNonce("n", 10)).rejects.toThrow(/WRONGTYPE/);
  });
});
