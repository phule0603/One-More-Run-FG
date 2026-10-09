"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RunResult } from "@/hooks/useOneMoreRun";
import {
  isPlayerId,
  LEADERBOARD_SIZE,
  sanitizeName,
  type ApiError,
  type LeaderboardEntry,
  type LeaderboardResponse,
  type RenameResponse,
  type SubmitResponse,
  type TokenResponse,
} from "@/lib/leaderboard/shared";

const KEY_PLAYER = "omr:playerId";
const KEY_NAME = "omr:name";
const KEY_LOCAL = "omr:localBoard";
const KEY_GLOBAL_BEST = "omr:globalBest";
const KEY_AVATAR_SENT = "omr:avatarSent";

export interface LocalEntry {
  name: string;
  score: number;
  distance: number;
  coins: number;
  at: number;
}

export interface GlobalBoard {
  /** null until the server has answered */
  enabled: boolean | null;
  entries: LeaderboardEntry[];
  you: { rank: number; score: number } | null;
  loading: boolean;
  error: boolean;
}

/** What happened to the score of a given run on the global board. */
export type SubmitStatus =
  | { run: number; state: "needs-name" }
  | { run: number; state: "saving" }
  | { run: number; state: "saved"; rank: number; improved: boolean }
  | { run: number; state: "error"; error: ApiError | "offline" }
  | { run: number; state: "local-only" };

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the game still works, it just won't remember */
  }
}

function newPlayerId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function readLocalBoard(): LocalEntry[] {
  try {
    const parsed = JSON.parse(read(KEY_LOCAL) ?? "[]") as LocalEntry[];
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e?.score === "number") : [];
  } catch {
    return [];
  }
}

/** Short fingerprint of the avatar last sent to the server, so it is only re-sent when it changes. */
function avatarHash(avatar: string | null): string {
  if (avatar === null) return "none";
  let h = 0x811c9dc5;
  for (let i = 0; i < avatar.length; i++) h = Math.imul(h ^ avatar.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(16) + ":" + avatar.length;
}

async function requestToken(): Promise<string | null> {
  try {
    const res = await fetch("/api/leaderboard/token", { method: "POST" });
    const data = (await res.json()) as TokenResponse;
    return data.enabled ? data.token : null;
  } catch {
    return null;
  }
}

export function useLeaderboard() {
  const [name, setNameState] = useState("");
  const [local, setLocal] = useState<LocalEntry[]>([]);
  const [global, setGlobal] = useState<GlobalBoard>({
    enabled: null,
    entries: [],
    you: null,
    loading: false,
    error: false,
  });
  const [status, setStatus] = useState<SubmitStatus | null>(null);

  // refs mirror state for the engine callbacks, which outlive renders
  const playerIdRef = useRef("");
  const nameRef = useRef("");
  const enabledRef = useRef<boolean | null>(null);
  const globalBestRef = useRef(0);
  const tokensRef = useRef(new Map<number, Promise<string | null>>());
  const pendingRef = useRef<{ result: RunResult; token: Promise<string | null> } | null>(null);
  /** thumbnail the player chose to share; undefined until the photo has loaded */
  const avatarRef = useRef<string | null | undefined>(undefined);

  /** Brings the server's copy of the shared photo in line with the player's choice. */
  const syncAvatar = useCallback(() => {
    const avatar = avatarRef.current;
    if (avatar === undefined || enabledRef.current !== true || globalBestRef.current <= 0) return;
    const hash = avatarHash(avatar);
    if (hash === read(KEY_AVATAR_SENT)) return;
    void fetch("/api/leaderboard", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerId: playerIdRef.current, avatar }),
    })
      .then((res) => res.json() as Promise<RenameResponse>)
      .then((data) => {
        if (data.ok) write(KEY_AVATAR_SENT, hash);
      })
      .catch(() => {});
  }, []);

  const refresh = useCallback(async () => {
    setGlobal((g) => ({ ...g, loading: true }));
    try {
      const qs = new URLSearchParams({ limit: String(LEADERBOARD_SIZE), playerId: playerIdRef.current });
      const res = await fetch(`/api/leaderboard?${qs}`, { cache: "no-store" });
      const data = (await res.json()) as LeaderboardResponse;
      enabledRef.current = data.enabled;
      if (data.you && data.you.score > globalBestRef.current) {
        globalBestRef.current = data.you.score;
        write(KEY_GLOBAL_BEST, String(data.you.score));
      }
      setGlobal({ enabled: data.enabled, entries: data.entries, you: data.you, loading: false, error: !res.ok });
      syncAvatar();
    } catch {
      setGlobal((g) => ({ ...g, loading: false, error: true }));
    }
  }, [syncAvatar]);

  useEffect(() => {
    let id = read(KEY_PLAYER);
    if (!isPlayerId(id)) {
      id = newPlayerId();
      write(KEY_PLAYER, id);
    }
    playerIdRef.current = id;
    nameRef.current = sanitizeName(read(KEY_NAME)) ?? "";
    globalBestRef.current = Number(read(KEY_GLOBAL_BEST)) || 0;
    // hydrate from localStorage after mount (the page itself is prerendered)
    setNameState(nameRef.current);
    setLocal(readLocalBoard());
    void refresh();
  }, [refresh]);

  const submit = useCallback(
    async (result: RunResult, token: Promise<string | null>) => {
      const run = result.run;
      setStatus({ run, state: "saving" });
      const t = await token;
      if (!t) {
        setStatus({ run, state: "error", error: "offline" });
        return;
      }
      try {
        const res = await fetch("/api/leaderboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            playerId: playerIdRef.current,
            name: nameRef.current,
            token: t,
            score: result.score,
            distance: result.distance,
            coins: result.coins,
            durationMs: result.durationMs,
            avatar: avatarRef.current,
          }),
        });
        const data = (await res.json()) as SubmitResponse;
        if (!data.ok) {
          setStatus({ run, state: "error", error: data.error });
          return;
        }
        if (avatarRef.current !== undefined) write(KEY_AVATAR_SENT, avatarHash(avatarRef.current));
        if (data.best > globalBestRef.current) {
          globalBestRef.current = data.best;
          write(KEY_GLOBAL_BEST, String(data.best));
        }
        setStatus({ run, state: "saved", rank: data.rank, improved: data.improved });
        void refresh();
      } catch {
        setStatus({ run, state: "error", error: "offline" });
      }
    },
    [refresh],
  );

  /** Engine callback: ask the server to sign this run's start time. */
  const onRunStart = useCallback((run: number) => {
    if (enabledRef.current === false) return;
    const tokens = tokensRef.current;
    tokens.set(run, requestToken());
    for (const key of tokens.keys()) if (key < run - 2) tokens.delete(key);
  }, []);

  /** Engine callback: record the run locally and send personal bests to the global board. */
  const onRunEnd = useCallback(
    (result: RunResult) => {
      const token = tokensRef.current.get(result.run) ?? Promise.resolve(null);
      tokensRef.current.delete(result.run);
      if (result.score <= 0) return;

      setLocal((prev) => {
        const entry: LocalEntry = {
          name: nameRef.current,
          score: result.score,
          distance: result.distance,
          coins: result.coins,
          at: Date.now(),
        };
        const next = [...prev, entry].sort((a, b) => b.score - a.score).slice(0, LEADERBOARD_SIZE);
        write(KEY_LOCAL, JSON.stringify(next));
        return next;
      });

      if (enabledRef.current === false) {
        setStatus({ run: result.run, state: "local-only" });
        return;
      }
      if (result.score <= globalBestRef.current) return;
      if (!nameRef.current) {
        // keep the best unsent run until the player picks a name
        if (!pendingRef.current || result.score > pendingRef.current.result.score) {
          pendingRef.current = { result, token };
        }
        setStatus({ run: result.run, state: "needs-name" });
        return;
      }
      void submit(result, token);
    },
    [submit],
  );

  /** Saves the display name; returns false if it has no letters or digits. */
  const setName = useCallback(
    (raw: string) => {
      const clean = sanitizeName(raw);
      if (!clean) return false;
      const changed = clean !== nameRef.current;
      nameRef.current = clean;
      setNameState(clean);
      write(KEY_NAME, clean);
      // earlier runs recorded without a name take the new one
      setLocal((prev) => {
        const next = prev.map((e) => (e.name ? e : { ...e, name: clean }));
        write(KEY_LOCAL, JSON.stringify(next));
        return next;
      });

      const pending = pendingRef.current;
      if (pending) {
        pendingRef.current = null;
        if (pending.result.score > globalBestRef.current) void submit(pending.result, pending.token);
      } else if (changed && enabledRef.current && globalBestRef.current > 0) {
        void fetch("/api/leaderboard", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ playerId: playerIdRef.current, name: clean }),
        })
          .then((res) => res.json() as Promise<RenameResponse>)
          .then((data) => {
            if (data.ok && data.renamed) void refresh();
          })
          .catch(() => {});
      }
      return true;
    },
    [refresh, submit],
  );

  /** The thumbnail to show on the global board (null = don't share). */
  const setSharedAvatar = useCallback(
    (avatar: string | null) => {
      avatarRef.current = avatar;
      syncAvatar();
    },
    [syncAvatar],
  );

  return { name, setName, local, global, status, refresh, onRunStart, onRunEnd, setSharedAvatar };
}
