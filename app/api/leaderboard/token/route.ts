import type { TokenResponse } from "@/lib/leaderboard/shared";
import { getLeaderboard } from "@/lib/leaderboard/store";
import { createRunToken } from "@/lib/leaderboard/token";

/** POST /api/leaderboard/token — called when a run starts; the signed start time is checked on submit. */
export async function POST() {
  const lb = getLeaderboard();
  const body: TokenResponse = lb
    ? { enabled: true, token: createRunToken(lb.secret) }
    : { enabled: false };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
