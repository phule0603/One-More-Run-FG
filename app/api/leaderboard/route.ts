import {
  checkRun,
  isPlayerId,
  LEADERBOARD_SIZE,
  parseSubmitRequest,
  sanitizeName,
  type ApiError,
  type LeaderboardResponse,
  type RenameResponse,
  type SubmitResponse,
} from "@/lib/leaderboard/shared";
import { getLeaderboard } from "@/lib/leaderboard/store";
import { TOKEN_TTL_MS, verifyRunToken } from "@/lib/leaderboard/token";

const WINDOW_SEC = 600;
const SUBMIT_LIMIT = 30; // per IP per window
const RENAME_LIMIT = 10;
/** token is fetched a moment after the run starts, so allow for network latency */
const DURATION_GRACE_MS = 3_000;

const json = <T,>(body: T, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const fail = (error: ApiError, status: number) => json({ ok: false as const, error }, status);

function clientIp(req: Request) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

/** GET /api/leaderboard?limit=10&playerId=… — top scores, plus the caller's own rank. */
export async function GET(req: Request) {
  const lb = getLeaderboard();
  if (!lb) return json<LeaderboardResponse>({ enabled: false, entries: [], you: null });

  const params = new URL(req.url).searchParams;
  const limit = Math.min(50, Math.max(1, Math.floor(Number(params.get("limit"))) || LEADERBOARD_SIZE));
  const playerId = params.get("playerId");
  try {
    const [top, you] = await Promise.all([
      lb.store.top(limit),
      isPlayerId(playerId) ? lb.store.rankOf(playerId) : null,
    ]);
    return json<LeaderboardResponse>({
      enabled: true,
      entries: top.map((e, i) => ({
        rank: i + 1,
        name: e.name,
        score: e.score,
        distance: e.distance,
        coins: e.coins,
        at: e.at,
        you: e.playerId === playerId,
      })),
      you,
    });
  } catch (err) {
    console.error("[leaderboard] GET failed", err);
    return json<LeaderboardResponse>(
      { enabled: true, entries: [], you: null, error: "store_unavailable" },
      503,
    );
  }
}

/** POST /api/leaderboard — submit a run (kept only if it beats the player's best). */
export async function POST(req: Request) {
  const lb = getLeaderboard();
  if (!lb) return fail("disabled", 404);

  const body = parseSubmitRequest(await readJson(req));
  if (!body) return fail("bad_request", 400);
  if (!isPlayerId(body.playerId)) return fail("invalid_player", 400);
  const name = sanitizeName(body.name);
  if (!name) return fail("invalid_name", 400);
  if (checkRun(body)) return fail("implausible_run", 422);

  const token = verifyRunToken(body.token, lb.secret);
  if (!token.ok) return fail(token.error, 401);
  if (body.durationMs > Date.now() - token.iat + DURATION_GRACE_MS) {
    return fail("implausible_run", 422);
  }

  try {
    if (!(await lb.store.hit(`submit:${clientIp(req)}`, SUBMIT_LIMIT, WINDOW_SEC))) {
      return fail("rate_limited", 429);
    }
    if (!(await lb.store.claimNonce(token.nonce, Math.ceil(TOKEN_TTL_MS / 1000)))) {
      return fail("token_used", 409);
    }
    const result = await lb.store.submit({
      playerId: body.playerId,
      name,
      score: body.score,
      distance: body.distance,
      coins: body.coins,
      at: Date.now(),
    });
    return json<SubmitResponse>({ ok: true, ...result });
  } catch (err) {
    console.error("[leaderboard] POST failed", err);
    return fail("store_unavailable", 503);
  }
}

/** PATCH /api/leaderboard — change the display name of a player already on the board. */
export async function PATCH(req: Request) {
  const lb = getLeaderboard();
  if (!lb) return fail("disabled", 404);

  const body = (await readJson(req)) as { playerId?: unknown; name?: unknown } | null;
  if (!body || !isPlayerId(body.playerId)) return fail("invalid_player", 400);
  const name = sanitizeName(body.name);
  if (!name) return fail("invalid_name", 400);

  try {
    if (!(await lb.store.hit(`rename:${clientIp(req)}`, RENAME_LIMIT, WINDOW_SEC))) {
      return fail("rate_limited", 429);
    }
    const renamed = await lb.store.rename(body.playerId, name);
    return json<RenameResponse>({ ok: true, renamed });
  } catch (err) {
    console.error("[leaderboard] PATCH failed", err);
    return fail("store_unavailable", 503);
  }
}
