import { createHash, randomBytes } from "node:crypto";

/*
 * Leaderboard storage. Production uses Redis through Upstash's REST API (what the
 * Vercel Marketplace "Upstash for Redis" integration provisions); local
 * development falls back to an in-memory store so the game works without setup.
 */

export interface StoredEntry {
  playerId: string;
  name: string;
  score: number;
  distance: number;
  coins: number;
  at: number;
  /** shared thumbnail, if any (only filled in by `top`) */
  avatar?: string | null;
}

export interface SubmitResult {
  improved: boolean;
  best: number;
  rank: number;
}

export interface LeaderboardStore {
  readonly kind: "redis" | "memory";
  top(limit: number): Promise<StoredEntry[]>;
  rankOf(playerId: string): Promise<{ rank: number; score: number } | null>;
  /** Keeps each player's best score only; always refreshes the display name. */
  submit(entry: StoredEntry): Promise<SubmitResult>;
  /** Renames a player that is already on the board. */
  rename(playerId: string, name: string): Promise<boolean>;
  /** Sets (or with null removes) the shared thumbnail of a player. */
  setAvatar(playerId: string, avatar: string | null): Promise<void>;
  /** Burns a run-token nonce; false if it was already used. */
  claimNonce(nonce: string, ttlSec: number): Promise<boolean>;
  /** Fixed-window rate limit: true while under `limit` hits in the current window. */
  hit(key: string, limit: number, windowSec: number): Promise<boolean>;
}

/* ------------------------------------------------------------------ memory */

export class MemoryStore implements LeaderboardStore {
  readonly kind = "memory";
  private players = new Map<string, StoredEntry>();
  private avatars = new Map<string, string>();
  private nonces = new Map<string, number>();
  private hits = new Map<string, number>();

  constructor(private now: () => number = Date.now) {}

  private ranked() {
    return [...this.players.values()].sort((a, b) => b.score - a.score || a.at - b.at);
  }

  async top(limit: number) {
    return this.ranked()
      .slice(0, limit)
      .map((e) => ({ ...e, avatar: this.avatars.get(e.playerId) ?? null }));
  }

  async rankOf(playerId: string) {
    const list = this.ranked();
    const i = list.findIndex((e) => e.playerId === playerId);
    return i < 0 ? null : { rank: i + 1, score: list[i].score };
  }

  async submit(entry: StoredEntry) {
    const prev = this.players.get(entry.playerId);
    const improved = !prev || entry.score > prev.score;
    if (improved) this.players.set(entry.playerId, { ...entry });
    else prev.name = entry.name;
    const { rank, score } = (await this.rankOf(entry.playerId))!;
    return { improved, best: score, rank };
  }

  async rename(playerId: string, name: string) {
    const p = this.players.get(playerId);
    if (!p) return false;
    p.name = name;
    return true;
  }

  async setAvatar(playerId: string, avatar: string | null) {
    if (avatar) this.avatars.set(playerId, avatar);
    else this.avatars.delete(playerId);
  }

  async claimNonce(nonce: string, ttlSec: number) {
    const now = this.now();
    for (const [k, expires] of this.nonces) if (expires <= now) this.nonces.delete(k);
    if (this.nonces.has(nonce)) return false;
    this.nonces.set(nonce, now + ttlSec * 1000);
    return true;
  }

  async hit(key: string, limit: number, windowSec: number) {
    const k = `${key}:${Math.floor(this.now() / (windowSec * 1000))}`;
    if (this.hits.size > 10_000) this.hits.clear();
    const count = (this.hits.get(k) ?? 0) + 1;
    this.hits.set(k, count);
    return count <= limit;
  }
}

/* ------------------------------------------------------------------- redis */

type Command = (string | number)[];

function parseRun(raw: unknown): { distance: number; coins: number; at: number } {
  try {
    const r = JSON.parse(String(raw)) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return { distance: num(r.distance), coins: num(r.coins), at: num(r.at) };
  } catch {
    return { distance: 0, coins: 0, at: 0 };
  }
}

/**
 * Redis via the Upstash REST API (`POST {url}/pipeline` with a JSON array of
 * commands). Keys: `omr:lb` sorted set of best scores, `omr:names` and
 * `omr:runs` hashes keyed by player id.
 */
export class RedisRestStore implements LeaderboardStore {
  readonly kind = "redis";
  private readonly endpoint: string;

  constructor(
    url: string,
    private readonly token: string,
    private readonly prefix = "omr:",
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    this.endpoint = `${url.replace(/\/+$/, "")}/pipeline`;
  }

  private key(name: string) {
    return this.prefix + name;
  }

  private async pipeline(commands: Command[]): Promise<unknown[]> {
    const res = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" },
      body: JSON.stringify(commands.map((c) => c.map(String))),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Redis REST request failed: HTTP ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: string }[];
    if (!Array.isArray(out) || out.length !== commands.length) {
      throw new Error("Redis REST request failed: malformed response");
    }
    return out.map((r) => {
      if (r.error) throw new Error(`Redis error: ${r.error}`);
      return r.result;
    });
  }

  async top(limit: number) {
    const [flat] = (await this.pipeline([
      ["ZREVRANGE", this.key("lb"), 0, limit - 1, "WITHSCORES"],
    ])) as [string[]];
    const ids: string[] = [];
    const scores: number[] = [];
    for (let i = 0; i + 1 < flat.length; i += 2) {
      ids.push(flat[i]);
      scores.push(Number(flat[i + 1]));
    }
    if (ids.length === 0) return [];
    const [names, runs, avatars] = (await this.pipeline([
      ["HMGET", this.key("names"), ...ids],
      ["HMGET", this.key("runs"), ...ids],
      ["HMGET", this.key("avatars"), ...ids],
    ])) as [(string | null)[], (string | null)[], (string | null)[]];
    return ids.map((playerId, i) => ({
      playerId,
      name: names[i] ?? "???",
      score: scores[i],
      ...parseRun(runs[i]),
      avatar: avatars[i] ?? null,
    }));
  }

  async rankOf(playerId: string) {
    const [score, rank] = await this.pipeline([
      ["ZSCORE", this.key("lb"), playerId],
      ["ZREVRANK", this.key("lb"), playerId],
    ]);
    if (score === null || rank === null) return null;
    return { rank: Number(rank) + 1, score: Number(score) };
  }

  async submit(entry: StoredEntry) {
    const [changed, , best, rank] = await this.pipeline([
      // GT: only ever raise a player's score; CH: report whether it changed
      ["ZADD", this.key("lb"), "GT", "CH", entry.score, entry.playerId],
      ["HSET", this.key("names"), entry.playerId, entry.name],
      ["ZSCORE", this.key("lb"), entry.playerId],
      ["ZREVRANK", this.key("lb"), entry.playerId],
    ]);
    const improved = Number(changed) === 1;
    if (improved) {
      const run = JSON.stringify({ distance: entry.distance, coins: entry.coins, at: entry.at });
      await this.pipeline([["HSET", this.key("runs"), entry.playerId, run]]);
    }
    return { improved, best: Number(best), rank: Number(rank) + 1 };
  }

  async rename(playerId: string, name: string) {
    const [score] = await this.pipeline([["ZSCORE", this.key("lb"), playerId]]);
    if (score === null) return false;
    await this.pipeline([["HSET", this.key("names"), playerId, name]]);
    return true;
  }

  async setAvatar(playerId: string, avatar: string | null) {
    await this.pipeline([
      avatar ? ["HSET", this.key("avatars"), playerId, avatar] : ["HDEL", this.key("avatars"), playerId],
    ]);
  }

  async claimNonce(nonce: string, ttlSec: number) {
    const [res] = await this.pipeline([["SET", this.key(`nonce:${nonce}`), 1, "NX", "EX", ttlSec]]);
    return res === "OK";
  }

  async hit(key: string, limit: number, windowSec: number) {
    const k = this.key(`rl:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`);
    const [count] = await this.pipeline([
      ["INCR", k],
      ["EXPIRE", k, windowSec * 2],
    ]);
    return Number(count) <= limit;
  }
}

/* ----------------------------------------------------------------- factory */

export interface LeaderboardBackend {
  store: LeaderboardStore;
  /** HMAC key for run tokens */
  secret: string;
}

const cache = globalThis as typeof globalThis & {
  __omrRedis?: { id: string; backend: LeaderboardBackend };
  __omrMemory?: LeaderboardBackend;
};

/**
 * The configured leaderboard, or null when it is disabled (production without
 * Redis credentials — the game then keeps scores on the device only).
 */
export function getLeaderboard(): LeaderboardBackend | null {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (url && token) {
    const id = `${url}|${token}`;
    if (cache.__omrRedis?.id !== id) {
      const secret =
        process.env.LEADERBOARD_SECRET ||
        createHash("sha256").update(`omr-run-token\0${token}`).digest("hex");
      cache.__omrRedis = { id, backend: { store: new RedisRestStore(url, token), secret } };
    }
    return cache.__omrRedis.backend;
  }
  if (process.env.NODE_ENV !== "production" || process.env.LEADERBOARD_STORE === "memory") {
    cache.__omrMemory ??= {
      store: new MemoryStore(),
      secret: process.env.LEADERBOARD_SECRET || randomBytes(32).toString("hex"),
    };
    return cache.__omrMemory;
  }
  return null;
}
