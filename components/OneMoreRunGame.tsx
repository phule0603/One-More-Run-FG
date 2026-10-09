"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import LeaderboardDialog from "@/components/LeaderboardDialog";
import PlayerCard, { NameField } from "@/components/PlayerCard";
import { useAvatar } from "@/hooks/useAvatar";
import { useLeaderboard, type SubmitStatus } from "@/hooks/useLeaderboard";
import { useOneMoreRun } from "@/hooks/useOneMoreRun";

const blurAfter = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
  fn();
  // drop focus so Space keeps jumping instead of re-activating the button
  e.currentTarget.blur();
};

const ERROR_TEXT: Record<string, string> = {
  offline: "COULDN'T REACH THE LEADERBOARD — SCORE KEPT ON THIS DEVICE",
  rate_limited: "TOO MANY SUBMISSIONS — TRY AGAIN IN A FEW MINUTES",
  store_unavailable: "LEADERBOARD IS DOWN — SCORE KEPT ON THIS DEVICE",
};

function SubmitLine({
  status,
  name,
  onSaveName,
}: {
  status: SubmitStatus;
  name: string;
  onSaveName: (name: string) => boolean;
}) {
  switch (status.state) {
    case "needs-name":
      return (
        <div data-ui className="pointer-events-auto mt-2 flex w-64 flex-col items-center gap-1.5">
          <p className="text-xs font-bold tracking-[0.2em] text-neon-yellow">ENTER A NAME TO JOIN THE GLOBAL BOARD</p>
          <NameField name={name} onSaveName={onSaveName} className="w-full" />
        </div>
      );
    case "saving":
      return <p className="mt-2 animate-pulse text-xs tracking-[0.2em] text-cyan-100/70">SAVING SCORE…</p>;
    case "saved":
      return (
        <p className="neon-text mt-2 text-sm font-bold tracking-[0.2em] text-neon-yellow">
          {status.rank === 1 ? "🏆 #1 IN THE WORLD!" : `🌐 GLOBAL RANK #${status.rank.toLocaleString("en-US")}`}
        </p>
      );
    case "local-only":
      return <p className="mt-2 text-xs tracking-[0.2em] text-cyan-100/60">SCORE SAVED ON THIS DEVICE</p>;
    case "error":
      return (
        <p className="mt-2 max-w-xs text-xs tracking-[0.15em] text-neon-pink">
          {ERROR_TEXT[status.error] ?? `SCORE NOT ACCEPTED (${status.error.toUpperCase()})`}
        </p>
      );
  }
}

export default function OneMoreRunGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputBlockedRef = useRef(false);
  const [boardOpen, setBoardOpen] = useState(false);

  const lb = useLeaderboard();
  const avatar = useAvatar();
  const { phase, result, best, runs, muted, toggleMute, setAvatar } = useOneMoreRun(canvasRef, {
    onRunStart: lb.onRunStart,
    onRunEnd: lb.onRunEnd,
    inputBlockedRef,
  });

  useEffect(() => {
    setAvatar(avatar.image, avatar.avatar?.colors);
  }, [avatar.image, avatar.avatar, setAvatar]);

  useEffect(() => {
    inputBlockedRef.current = boardOpen;
  }, [boardOpen]);

  const openBoard = useCallback(() => setBoardOpen(true), []);
  const closeBoard = useCallback(() => setBoardOpen(false), []);
  const status = result && lb.status?.run === result.run ? lb.status : null;
  const menu = phase !== "playing";

  return (
    <div className="relative h-full w-full touch-none select-none font-mono">
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="Tam Thái Tử game canvas" />

      <div data-ui className="absolute right-3 top-3 z-20 flex gap-2">
        {menu && (
          <button
            type="button"
            onClick={blurAfter(openBoard)}
            aria-label="Open leaderboard"
            className="flex h-10 w-10 items-center justify-center rounded-md border border-neon-yellow/40 bg-black/40 text-lg backdrop-blur-sm transition hover:border-neon-yellow"
          >
            🏆
          </button>
        )}
        <button
          type="button"
          onClick={blurAfter(toggleMute)}
          aria-label={muted ? "Unmute sound" : "Mute sound"}
          className="flex h-10 w-10 items-center justify-center rounded-md border border-cyan-400/40 bg-black/40 text-lg text-cyan-300 backdrop-blur-sm transition hover:border-cyan-300 hover:text-white"
        >
          {muted ? "🔇" : "🔊"}
        </button>
      </div>

      {phase === "ready" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-4 pb-[10vh] text-center portrait:pb-[22vh] short:gap-2 short:pb-[4vh]!">
          <h1 lang="vi" className="neon-text font-display text-4xl font-bold italic tracking-normal text-neon-cyan sm:text-7xl short:text-4xl!">
            TAM THÁI <span className="text-neon-pink">TỬ</span>
          </h1>
          <p className="max-w-md text-xs uppercase tracking-[0.25em] text-cyan-100/70 sm:text-sm short:hidden">
            Tap · Click · Space to jump — tap again mid-air to double jump
          </p>
          <PlayerCard
            name={lb.name}
            onSaveName={lb.setName}
            avatarUrl={avatar.avatar?.dataUrl ?? null}
            avatarBusy={avatar.busy}
            avatarError={avatar.error}
            onUpload={avatar.upload}
            onResetAvatar={avatar.reset}
          />
          {best > 0 && (
            <p className="text-sm tracking-widest text-neon-yellow">
              BEST {best} · {runs} {runs === 1 ? "RUN" : "RUNS"}
            </p>
          )}
          <p className="animate-blink mt-2 text-sm font-bold tracking-[0.15em] text-white sm:text-lg sm:tracking-[0.3em] short:mt-0">
            TAP / PRESS SPACE TO START
          </p>
        </div>
      )}

      {phase === "dead" && result && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4 pb-[12vh] portrait:pb-[28vh] short:pb-0!">
          <div className="flex flex-col items-center gap-2 text-center animate-[fadeIn_0.2s_ease-out] short:gap-1">
            <p
              className={`neon-text text-2xl font-black tracking-[0.3em] sm:text-3xl short:text-xl! ${
                result.isNewBest ? "text-neon-yellow" : "text-neon-pink"
              }`}
            >
              {result.isNewBest ? "NEW BEST!" : "GAME OVER"}
            </p>
            <p className="neon-text text-7xl font-black text-white sm:text-8xl short:text-5xl!">{result.score}</p>
            <div className="flex gap-6 text-sm tracking-widest text-cyan-100/80">
              <span>BEST {result.best}</span>
              <span className="text-neon-yellow">◆ {result.coins}</span>
              <span>{result.distance}M</span>
            </div>
            <p className="text-xs tracking-widest text-white/40">
              {lb.name && <span className="font-display font-semibold">{lb.name.toUpperCase()} · </span>}
              RUN #{result.run}
            </p>
            {status && <SubmitLine status={status} name={lb.name} onSaveName={lb.setName} />}
            <p className="animate-blink mt-5 text-sm font-bold tracking-[0.15em] text-neon-cyan sm:text-lg sm:tracking-[0.3em] short:mt-1">
              TAP / PRESS SPACE TO RETRY
            </p>
          </div>
        </div>
      )}

      <LeaderboardDialog
        open={boardOpen}
        onClose={closeBoard}
        global={lb.global}
        local={lb.local}
        playerName={lb.name}
        onRefresh={lb.refresh}
      />
    </div>
  );
}
