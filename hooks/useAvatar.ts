"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AvatarError,
  createAvatar,
  loadImage,
  loadShareAvatar,
  loadStoredAvatar,
  makeThumb,
  storeAvatar,
  storeShareAvatar,
  type Avatar,
} from "@/lib/avatar";

const MESSAGES: Record<string, string> = {
  not_image: "That file isn't an image.",
  too_large: "That image is too large (max 20 MB).",
  unreadable: "Couldn't read that image — try a JPG or PNG.",
};

/** The player's photo: loaded from this device, replaced by upload, or reset; sharing is opt-in. */
export function useAvatar() {
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [share, setShareState] = useState(false);
  const [busy, setBusy] = useState(false);
  /** true once the photo saved on this device (if any) has been loaded */
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async (next: Avatar | null) => {
    const img = next ? await loadImage(next.dataUrl) : null;
    setAvatar(next);
    setImage(img);
  }, []);

  useEffect(() => {
    setShareState(loadShareAvatar());
    const stored = loadStoredAvatar();
    if (!stored) {
      setReady(true);
      return;
    }
    (async () => {
      // photos saved before leaderboard thumbnails existed get one now
      const withThumb = stored.thumb ? stored : { ...stored, thumb: await makeThumb(stored.dataUrl) };
      if (withThumb !== stored) storeAvatar(withThumb);
      await apply(withThumb);
    })()
      .catch(() => storeAvatar(null))
      .finally(() => setReady(true));
  }, [apply]);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const next = await createAvatar(file);
        await apply(next);
        if (!storeAvatar(next)) setError("Saved for this visit only — this browser won't store it.");
      } catch (err) {
        setError(MESSAGES[err instanceof AvatarError ? err.code : "unreadable"]);
      } finally {
        setBusy(false);
      }
    },
    [apply],
  );

  const reset = useCallback(() => {
    storeAvatar(null);
    setError(null);
    void apply(null);
  }, [apply]);

  const setShare = useCallback((next: boolean) => {
    storeShareAvatar(next);
    setShareState(next);
  }, []);

  return { avatar, image, share, setShare, ready, busy, error, upload, reset };
}
