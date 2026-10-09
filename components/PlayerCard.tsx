"use client";

import { useEffect, useId, useRef, useState, type MouseEvent } from "react";
import { NAME_MAX_LENGTH } from "@/lib/leaderboard/shared";

interface PlayerCardProps {
  name: string;
  onSaveName: (name: string) => boolean;
  avatarUrl: string | null;
  avatarBusy: boolean;
  avatarError: string | null;
  onUpload: (file: File) => void;
  onResetAvatar: () => void;
}

/** Releases focus after a click so Space keeps controlling the game. */
const blurAfter = (fn: () => void) => (e: MouseEvent<HTMLButtonElement>) => {
  fn();
  e.currentTarget.blur();
};

/** The default head: the same glowing visor the runner wears in game. */
export function DefaultHead() {
  return (
    <span className="relative block h-full w-full bg-[#083344]">
      <span className="absolute left-[46%] top-[32%] h-[27%] w-[44%] rounded-full bg-neon-cyan shadow-[0_0_10px_rgba(34,211,238,0.9)]" />
      <span className="absolute left-[56%] top-[41%] h-[6%] w-[22%] bg-cyan-50" />
    </span>
  );
}

/** Name field: saves on Enter or when it loses focus. */
export function NameField({
  name,
  onSaveName,
  className = "",
}: {
  name: string;
  onSaveName: (name: string) => boolean;
  className?: string;
}) {
  const id = useId();
  const [draft, setDraft] = useState(name);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => setDraft(name), [name]);

  const save = () => {
    if (draft === name || (!draft.trim() && !name)) return;
    setInvalid(!onSaveName(draft));
  };

  return (
    <form
      className={`flex flex-col gap-1 ${className}`}
      onSubmit={(e) => {
        e.preventDefault();
        save();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      <label htmlFor={id} className="sr-only">
        Player name
      </label>
      <input
        id={id}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          setInvalid(false);
        }}
        onBlur={save}
        maxLength={NAME_MAX_LENGTH}
        placeholder="YOUR NAME"
        autoComplete="nickname"
        enterKeyHint="done"
        spellCheck={false}
        className="w-full rounded-md border border-cyan-400/40 bg-black/60 px-2.5 py-1.5 font-display text-sm font-semibold tracking-wider text-white placeholder:text-cyan-100/35 focus:border-cyan-300 focus:outline-none focus:ring-1 focus:ring-cyan-300"
      />
      {invalid && <span className="text-[11px] text-neon-pink">Use letters or numbers.</span>}
    </form>
  );
}

/** Start-screen card: photo character + player name. */
export default function PlayerCard({
  name,
  onSaveName,
  avatarUrl,
  avatarBusy,
  avatarError,
  onUpload,
  onResetAvatar,
}: PlayerCardProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const pickPhoto = () => fileRef.current?.click();

  return (
    <div
      data-ui
      className="pointer-events-auto flex w-full max-w-xs items-start gap-3 rounded-xl border border-cyan-400/25 bg-black/45 p-3 text-left backdrop-blur-sm"
    >
      <button
        type="button"
        onClick={blurAfter(pickPhoto)}
        aria-label="Upload a photo as your character"
        className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border-2 border-neon-cyan shadow-[0_0_16px_rgba(34,211,238,0.55)] transition hover:scale-105"
      >
        {avatarUrl ? (
          <img src={avatarUrl} alt="Your character" className="h-full w-full object-cover" />
        ) : (
          <DefaultHead />
        )}
        {avatarBusy && (
          <span className="absolute inset-0 grid place-items-center bg-black/60 text-xs text-cyan-100">…</span>
        )}
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <NameField name={name} onSaveName={onSaveName} />
        <div className="flex flex-wrap gap-2 text-[11px] font-bold tracking-widest">
          <button
            type="button"
            onClick={blurAfter(pickPhoto)}
            disabled={avatarBusy}
            className="rounded-md border border-neon-pink/50 px-2 py-1 text-neon-pink transition hover:bg-neon-pink/15 disabled:opacity-50"
          >
            📷 {avatarUrl ? "CHANGE" : "PHOTO"}
          </button>
          {avatarUrl && (
            <button
              type="button"
              onClick={blurAfter(onResetAvatar)}
              className="rounded-md border border-white/25 px-2 py-1 text-white/70 transition hover:bg-white/10"
            >
              ↺ DEFAULT
            </button>
          )}
        </div>
        {avatarError ? (
          <p className="text-[11px] text-neon-pink">{avatarError}</p>
        ) : (
          <p className="text-[10px] leading-snug text-cyan-100/45">Your photo stays on this device.</p>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onUpload(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
