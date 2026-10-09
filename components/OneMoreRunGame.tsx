"use client";

import { useRef } from "react";
import { useOneMoreRun } from "@/hooks/useOneMoreRun";

export default function OneMoreRunGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { phase, result, best, runs, muted, toggleMute } = useOneMoreRun(canvasRef);

  return (
    <div className="relative h-full w-full touch-none select-none font-mono">
      <canvas ref={canvasRef} className="block h-full w-full" aria-label="One More Run game canvas" />

      <button
        type="button"
        data-ui
        onClick={(e) => {
          toggleMute();
          // drop focus so Space keeps jumping instead of re-toggling the button
          e.currentTarget.blur();
        }}
        aria-label={muted ? "Unmute sound" : "Mute sound"}
        className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-md border border-cyan-400/40 bg-black/40 text-lg text-cyan-300 backdrop-blur-sm transition hover:border-cyan-300 hover:text-white"
      >
        {muted ? "🔇" : "🔊"}
      </button>

      {phase === "ready" && (
        <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 px-4 pb-[12vh] portrait:pb-[28vh] text-center">
          <h1 className="neon-text text-5xl font-black italic tracking-tight text-neon-cyan sm:text-7xl">
            ONE MORE <span className="text-neon-pink">RUN</span>
          </h1>
          <p className="max-w-md text-xs uppercase tracking-[0.25em] text-cyan-100/70 sm:text-sm">
            Tap · Click · Space to jump — tap again mid-air to double jump
          </p>
          {best > 0 && (
            <p className="text-sm tracking-widest text-neon-yellow">
              BEST {best} · {runs} {runs === 1 ? "RUN" : "RUNS"}
            </p>
          )}
          <p className="animate-blink mt-6 text-sm font-bold tracking-[0.15em] text-white sm:text-lg sm:tracking-[0.3em]">
            TAP / PRESS SPACE TO START
          </p>
        </div>
      )}

      {phase === "dead" && result && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-4 pb-[12vh] portrait:pb-[28vh]">
          <div className="flex flex-col items-center gap-2 text-center animate-[fadeIn_0.2s_ease-out]">
            <p
              className={`neon-text text-2xl font-black tracking-[0.3em] sm:text-3xl ${
                result.isNewBest ? "text-neon-yellow" : "text-neon-pink"
              }`}
            >
              {result.isNewBest ? "NEW BEST!" : "GAME OVER"}
            </p>
            <p className="neon-text text-7xl font-black text-white sm:text-8xl">{result.score}</p>
            <div className="flex gap-6 text-sm tracking-widest text-cyan-100/80">
              <span>BEST {result.best}</span>
              <span className="text-neon-yellow">◆ {result.coins}</span>
              <span>{result.distance}M</span>
            </div>
            <p className="text-xs tracking-widest text-white/40">RUN #{result.run}</p>
            <p className="animate-blink mt-6 text-sm font-bold tracking-[0.15em] text-neon-cyan sm:text-lg sm:tracking-[0.3em]">
              TAP / PRESS SPACE TO RETRY
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
