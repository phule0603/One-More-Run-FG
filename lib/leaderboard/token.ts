import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/*
 * Run tokens: the server signs the moment a run starts. A score submission must
 * carry one, can't claim a run longer than the time since it was issued, and can
 * use it only once (the nonce is burned in the store).
 */

export const TOKEN_TTL_MS = 3 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5_000;

interface TokenPayload {
  v: 1;
  iat: number;
  n: string;
}

export type VerifiedToken =
  | { ok: true; iat: number; nonce: string }
  | { ok: false; error: "invalid_token" | "token_expired" };

const sign = (data: string, secret: string) =>
  createHmac("sha256", secret).update(data).digest("base64url");

export function createRunToken(secret: string, now = Date.now()): string {
  const payload: TokenPayload = { v: 1, iat: now, n: randomBytes(12).toString("base64url") };
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${sign(data, secret)}`;
}

export function verifyRunToken(token: unknown, secret: string, now = Date.now()): VerifiedToken {
  if (typeof token !== "string" || token.length > 512) return { ok: false, error: "invalid_token" };
  const [data, mac, extra] = token.split(".");
  if (!data || !mac || extra !== undefined) return { ok: false, error: "invalid_token" };

  const expected = Buffer.from(sign(data, secret));
  const given = Buffer.from(mac);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, error: "invalid_token" };
  }

  let payload: Partial<TokenPayload>;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: "invalid_token" };
  }
  if (payload.v !== 1 || typeof payload.iat !== "number" || typeof payload.n !== "string") {
    return { ok: false, error: "invalid_token" };
  }
  if (payload.iat > now + CLOCK_SKEW_MS) return { ok: false, error: "invalid_token" };
  if (now - payload.iat > TOKEN_TTL_MS) return { ok: false, error: "token_expired" };
  return { ok: true, iat: payload.iat, nonce: payload.n };
}
