"use client";

import { useEffect, useRef, useState } from "react";
import { DefaultHead } from "@/components/PlayerCard";
import type { GlobalBoard, LocalEntry } from "@/hooks/useLeaderboard";

interface LeaderboardDialogProps {
  open: boolean;
  onClose: () => void;
  global: GlobalBoard;
  local: LocalEntry[];
  playerName: string;
  /** this device's photo thumbnail, shown on the THIS DEVICE tab */
  localAvatar: string | null;
  onRefresh: () => void;
}

interface Row {
  key: string;
  rank: number;
  name: string;
  score: number;
  detail: string;
  avatar: string | null;
  you: boolean;
}

const MEDALS = ["🥇", "🥈", "🥉"];
const fmt = (n: number) => n.toLocaleString("en-US");

function Rows({ rows }: { rows: Row[] }) {
  return (
    <ol className="flex flex-col gap-1">
      {rows.map((r) => (
        <li
          key={r.key}
          className={`grid grid-cols-[2.25rem_2rem_1fr_auto] items-center gap-2 rounded-md px-2 py-1.5 ${
            r.you ? "bg-cyan-400/15 text-white ring-1 ring-cyan-300/50" : "text-cyan-50/90"
          }`}
        >
          <span className="text-center text-sm font-bold tabular-nums">{MEDALS[r.rank - 1] ?? r.rank}</span>
          <span className="h-8 w-8 overflow-hidden rounded-full border border-cyan-400/50">
            {r.avatar ? <img src={r.avatar} alt="" className="h-full w-full object-cover" /> : <DefaultHead />}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-display text-sm font-bold">{r.name}</span>
            <span className="block text-[10px] tracking-wider text-cyan-100/45">{r.detail}</span>
          </span>
          <span className="text-base font-black tabular-nums text-neon-yellow">{fmt(r.score)}</span>
        </li>
      ))}
    </ol>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-6 text-center text-sm leading-relaxed text-cyan-100/60">{children}</p>;
}

export default function LeaderboardDialog({
  open,
  onClose,
  global,
  local,
  playerName,
  localAvatar,
  onRefresh,
}: LeaderboardDialogProps) {
  const [tab, setTab] = useState<"global" | "local">("global");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    onRefresh();
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, onRefresh]);

  if (!open) return null;

  const globalRows: Row[] = global.entries.map((e) => ({
    key: `g${e.rank}`,
    rank: e.rank,
    name: e.name,
    score: e.score,
    detail: `${fmt(e.distance)} M · ◆ ${e.coins}`,
    avatar: e.avatar,
    you: e.you,
  }));
  const localRows: Row[] = local.map((e, i) => ({
    key: `l${i}`,
    rank: i + 1,
    name: e.name || playerName || "YOU",
    score: e.score,
    detail: `${fmt(e.distance)} M · ◆ ${e.coins} · ${new Date(e.at).toLocaleDateString()}`,
    avatar: localAvatar,
    you: false,
  }));
  const youOutsideTop = global.you && !global.entries.some((e) => e.you) ? global.you : null;

  const tabClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-xs font-bold tracking-[0.2em] transition ${
      active ? "bg-neon-cyan text-black" : "text-cyan-100/70 hover:bg-white/10"
    }`;

  return (
    <div
      data-ui
      role="dialog"
      aria-modal="true"
      aria-labelledby="leaderboard-title"
      className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm animate-[fadeIn_0.15s_ease-out]"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-full w-full max-w-md flex-col gap-3 rounded-xl border border-cyan-400/30 bg-[#0b0420]/95 p-4 shadow-[0_0_48px_rgba(34,211,238,0.18)]">
        <div className="flex items-center justify-between">
          <h2 id="leaderboard-title" className="neon-text text-lg font-black tracking-[0.25em] text-neon-cyan">
            🏆 LEADERBOARD
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close leaderboard"
            className="grid h-8 w-8 place-items-center rounded-md border border-white/20 text-white/70 hover:bg-white/10"
          >
            ✕
          </button>
        </div>

        <div role="tablist" className="flex gap-1 rounded-lg bg-white/5 p-1">
          <button type="button" role="tab" aria-selected={tab === "global"} className={tabClass(tab === "global")} onClick={() => setTab("global")}>
            GLOBAL
          </button>
          <button type="button" role="tab" aria-selected={tab === "local"} className={tabClass(tab === "local")} onClick={() => setTab("local")}>
            THIS DEVICE
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {tab === "local" ? (
            localRows.length ? <Rows rows={localRows} /> : <Note>No runs yet on this device — go set a score!</Note>
          ) : global.enabled === false ? (
            <Note>
              The global leaderboard isn&apos;t switched on for this site yet.
              <br />
              Your scores are kept on this device.
            </Note>
          ) : global.error && !globalRows.length ? (
            <Note>
              Couldn&apos;t reach the leaderboard.{" "}
              <button type="button" onClick={onRefresh} className="font-bold text-neon-cyan underline">
                Try again
              </button>
            </Note>
          ) : globalRows.length ? (
            <Rows rows={globalRows} />
          ) : (
            <Note>{global.loading || global.enabled === null ? "Loading…" : "No scores yet — be the first!"}</Note>
          )}
        </div>

        {tab === "global" && youOutsideTop && (
          <p className="border-t border-white/10 pt-2 text-center text-xs tracking-widest text-cyan-100/70">
            YOU: <span className="font-bold text-white">#{fmt(youOutsideTop.rank)}</span> ·{" "}
            <span className="font-bold text-neon-yellow">{fmt(youOutsideTop.score)}</span>
          </p>
        )}
      </div>
    </div>
  );
}
