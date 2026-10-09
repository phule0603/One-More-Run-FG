import { describe, expect, it } from "vitest";
import { createRunToken, TOKEN_TTL_MS, verifyRunToken } from "@/lib/leaderboard/token";

const SECRET = "s3cret";

describe("run tokens", () => {
  it("round-trips the issue time and a unique nonce", () => {
    const now = 1_700_000_000_000;
    const a = verifyRunToken(createRunToken(SECRET, now), SECRET, now + 1000);
    const b = verifyRunToken(createRunToken(SECRET, now), SECRET, now + 1000);
    expect(a).toMatchObject({ ok: true, iat: now });
    expect(b.ok && a.ok && a.nonce !== b.nonce).toBe(true);
  });

  it("rejects tampered or foreign tokens", () => {
    const token = createRunToken(SECRET);
    const [data, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ v: 1, iat: 0, n: "x" })).toString("base64url");
    expect(verifyRunToken(`${forged}.${mac}`, SECRET)).toEqual({ ok: false, error: "invalid_token" });
    expect(verifyRunToken(`${data}.${mac}x`, SECRET)).toEqual({ ok: false, error: "invalid_token" });
    expect(verifyRunToken(token, "other-secret")).toEqual({ ok: false, error: "invalid_token" });
    expect(verifyRunToken(`${token}.extra`, SECRET)).toEqual({ ok: false, error: "invalid_token" });
    expect(verifyRunToken(undefined, SECRET)).toEqual({ ok: false, error: "invalid_token" });
  });

  it("expires after the TTL and refuses tokens from the future", () => {
    const now = Date.now();
    expect(verifyRunToken(createRunToken(SECRET, now - TOKEN_TTL_MS - 1), SECRET, now)).toEqual({
      ok: false,
      error: "token_expired",
    });
    expect(verifyRunToken(createRunToken(SECRET, now + 60_000), SECRET, now)).toEqual({
      ok: false,
      error: "invalid_token",
    });
  });
});
