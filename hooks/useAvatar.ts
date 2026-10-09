"use client";

import { useCallback, useEffect, useState } from "react";
import { AvatarError, createAvatar, loadImage, loadStoredAvatar, storeAvatar, type Avatar } from "@/lib/avatar";

const MESSAGES: Record<string, string> = {
  not_image: "That file isn't an image.",
  too_large: "That image is too large (max 20 MB).",
  unreadable: "Couldn't read that image — try a JPG or PNG.",
};

/** The player's photo character: loaded from this device, replaced by upload, or reset. */
export function useAvatar() {
  const [avatar, setAvatar] = useState<Avatar | null>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback(async (next: Avatar | null) => {
    const img = next ? await loadImage(next.dataUrl) : null;
    setAvatar(next);
    setImage(img);
  }, []);

  useEffect(() => {
    const stored = loadStoredAvatar();
    if (stored) apply(stored).catch(() => storeAvatar(null));
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

  return { avatar, image, busy, error, upload, reset };
}
