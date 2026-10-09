/*
 * A tiny in-memory stand-in for the Upstash Redis REST API, implementing exactly
 * the commands the leaderboard store uses, with Redis semantics. Used by the unit
 * tests (as a fetch implementation) and by end-to-end tests (as an HTTP server).
 */

type Reply = string | number | null | Reply[];

export function createFakeRedis(token = "test-token") {
  const zsets = new Map<string, Map<string, number>>();
  const hashes = new Map<string, Map<string, string>>();
  const strings = new Map<string, { value: string; expiresAt?: number }>();
  const commands: string[][] = [];

  const zset = (key: string) => {
    if (!zsets.has(key)) zsets.set(key, new Map());
    return zsets.get(key)!;
  };
  const hash = (key: string) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key)!;
  };
  const liveString = (key: string) => {
    const s = strings.get(key);
    if (s?.expiresAt !== undefined && s.expiresAt <= Date.now()) {
      strings.delete(key);
      return undefined;
    }
    return s;
  };
  // ZREVRANGE order: score descending, ties by member descending (as Redis does)
  const revSorted = (key: string) =>
    [...zset(key).entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0));

  function exec(cmd: string[]): Reply {
    commands.push(cmd);
    const [rawName, ...args] = cmd;
    switch (rawName.toUpperCase()) {
      case "ZADD": {
        const [key, ...rest] = args;
        const flags = new Set<string>();
        while (rest.length && ["NX", "XX", "GT", "LT", "CH"].includes(rest[0].toUpperCase())) {
          flags.add(rest.shift()!.toUpperCase());
        }
        const set = zset(key);
        let added = 0;
        let changed = 0;
        for (let i = 0; i + 1 < rest.length; i += 2) {
          const score = Number(rest[i]);
          const member = rest[i + 1];
          const prev = set.get(member);
          if (prev === undefined) {
            if (flags.has("XX")) continue;
            set.set(member, score);
            added++;
          } else {
            if (flags.has("NX")) continue;
            if (flags.has("GT") && !(score > prev)) continue;
            if (flags.has("LT") && !(score < prev)) continue;
            if (score !== prev) {
              set.set(member, score);
              changed++;
            }
          }
        }
        return flags.has("CH") ? added + changed : added;
      }
      case "ZREVRANGE": {
        const [key, start, stop, withScores] = args;
        const list = revSorted(key);
        const end = Number(stop) < 0 ? list.length + Number(stop) : Number(stop);
        const slice = list.slice(Number(start), end + 1);
        return withScores?.toUpperCase() === "WITHSCORES"
          ? slice.flatMap(([m, s]) => [m, String(s)])
          : slice.map(([m]) => m);
      }
      case "ZSCORE": {
        const score = zset(args[0]).get(args[1]);
        return score === undefined ? null : String(score);
      }
      case "ZREVRANK": {
        const i = revSorted(args[0]).findIndex(([m]) => m === args[1]);
        return i < 0 ? null : i;
      }
      case "HSET": {
        const [key, ...pairs] = args;
        const h = hash(key);
        let created = 0;
        for (let i = 0; i + 1 < pairs.length; i += 2) {
          if (!h.has(pairs[i])) created++;
          h.set(pairs[i], pairs[i + 1]);
        }
        return created;
      }
      case "HMGET": {
        const [key, ...fields] = args;
        const h = hash(key);
        return fields.map((f) => h.get(f) ?? null);
      }
      case "SET": {
        const [key, value, ...opts] = args;
        const upper = opts.map((o) => o.toUpperCase());
        if (upper.includes("NX") && liveString(key)) return null;
        const ex = upper.indexOf("EX");
        strings.set(key, {
          value,
          expiresAt: ex >= 0 ? Date.now() + Number(opts[ex + 1]) * 1000 : undefined,
        });
        return "OK";
      }
      case "INCR": {
        const next = Number(liveString(args[0])?.value ?? 0) + 1;
        strings.set(args[0], { ...strings.get(args[0]), value: String(next) });
        return next;
      }
      case "EXPIRE": {
        const s = liveString(args[0]);
        if (!s) return 0;
        s.expiresAt = Date.now() + Number(args[1]) * 1000;
        return 1;
      }
      default:
        throw new Error(`ERR unknown command '${rawName}'`);
    }
  }

  /** Handles one HTTP request body the way Upstash's /pipeline endpoint does. */
  function handlePipeline(auth: string | null, body: unknown): { status: number; json: unknown } {
    if (auth !== `Bearer ${token}`) return { status: 401, json: { error: "Unauthorized" } };
    if (!Array.isArray(body)) return { status: 400, json: { error: "ERR invalid body" } };
    return {
      status: 200,
      json: body.map((cmd: string[]) => {
        try {
          return { result: exec(cmd.map(String)) };
        } catch (err) {
          return { error: (err as Error).message };
        }
      }),
    };
  }

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.endsWith("/pipeline")) return new Response("not found", { status: 404 });
    const headers = new Headers(init?.headers);
    const { status, json } = handlePipeline(
      headers.get("authorization"),
      JSON.parse(String(init?.body)),
    );
    return Response.json(json, { status });
  }) as typeof fetch;

  return { exec, handlePipeline, fetch: fetchImpl, commands, zsets, hashes };
}
