/*
 * Turns an uploaded photo into the player's character, entirely in the browser:
 * centre-crop to a square, downscale to 128 px, keep it in localStorage. The
 * image never leaves the device.
 */

export const AVATAR_PX = 128;
/** Leaderboard thumbnails are tiny: a few KB, never the original photo. */
export const THUMB_PX = 48;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const STORAGE_KEY = "omr:avatar";
const TILE_BG = "#083344";

export interface Avatar {
  /** 128×128 JPEG data URL */
  dataUrl: string;
  /** a few vivid colours sampled from the photo, used for the particles */
  colors: string[];
  /** 48×48 JPEG data URL, the only version that may be shared on the leaderboard */
  thumb: string;
}

export type AvatarErrorCode = "not_image" | "too_large" | "unreadable";

export class AvatarError extends Error {
  constructor(readonly code: AvatarErrorCode) {
    super(code);
  }
}

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file);
      return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close() };
    } catch {
      /* fall back to <img>, which some browsers decode more formats with */
    }
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new AvatarError("unreadable");
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

function canvas2d(size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new AvatarError("unreadable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

export async function createAvatar(file: File): Promise<Avatar> {
  if (!file.type.startsWith("image/")) throw new AvatarError("not_image");
  if (file.size > MAX_FILE_BYTES) throw new AvatarError("too_large");

  const img = await decode(file);
  try {
    const side = Math.min(img.width, img.height);
    if (!side) throw new AvatarError("unreadable");
    const sx = (img.width - side) / 2;
    const sy = (img.height - side) / 2;

    const { canvas, ctx } = canvas2d(AVATAR_PX);
    ctx.fillStyle = TILE_BG; // transparent PNGs get the default tile colour
    ctx.fillRect(0, 0, AVATAR_PX, AVATAR_PX);
    if (side > AVATAR_PX * 4) {
      // two-step downscale avoids the aliasing of one huge reduction
      const mid = canvas2d(AVATAR_PX * 4);
      mid.ctx.drawImage(img.source, sx, sy, side, side, 0, 0, AVATAR_PX * 4, AVATAR_PX * 4);
      ctx.drawImage(mid.canvas, 0, 0, AVATAR_PX, AVATAR_PX);
    } else {
      ctx.drawImage(img.source, sx, sy, side, side, 0, 0, AVATAR_PX, AVATAR_PX);
    }

    const colors = palette(ctx.getImageData(0, 0, AVATAR_PX, AVATAR_PX).data);
    return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), colors, thumb: thumbnail(canvas) };
  } finally {
    img.release();
  }
}

function thumbnail(source: CanvasImageSource): string {
  const { canvas, ctx } = canvas2d(THUMB_PX);
  ctx.drawImage(source, 0, 0, THUMB_PX, THUMB_PX);
  return canvas.toDataURL("image/jpeg", 0.75);
}

/** Thumbnail for an avatar saved before thumbnails existed. */
export async function makeThumb(dataUrl: string): Promise<string> {
  return thumbnail(await loadImage(dataUrl));
}

/* --------------------------------------------------------------- palette */

type RGB = [number, number, number];

/** Up to three distinct colours, favouring vivid ones, pushed bright enough to glow. */
function palette(data: Uint8ClampedArray): string[] {
  const buckets = new Map<number, { r: number; g: number; b: number; n: number; weight: number }>();
  for (let i = 0; i < data.length; i += 12) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const bucket = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, weight: 0 };
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.n += 1;
    bucket.weight += 0.15 + saturation * (max / 255);
    buckets.set(key, bucket);
  }

  const picked: RGB[] = [];
  for (const b of [...buckets.values()].sort((x, y) => y.weight - x.weight)) {
    const c: RGB = [b.r / b.n, b.g / b.n, b.b / b.n];
    if (picked.every((p) => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) > 60)) picked.push(c);
    if (picked.length === 3) break;
  }
  return picked.map(neon);
}

function neon([r, g, b]: RGB): string {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  if (h < 0) h += 360;
  // keep greys grey (they become white sparks), make colours vivid and bright
  const grey = s < 0.12;
  s = grey ? s : Math.max(s, 0.7);
  const light = grey ? 0.85 : Math.min(0.75, Math.max(l, 0.58));

  const c = (1 - Math.abs(2 * light - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r1, g1, b1] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const hex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${hex(r1)}${hex(g1)}${hex(b1)}`;
}

/* --------------------------------------------------------------- storage */

export function loadStoredAvatar(): Avatar | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const a = JSON.parse(raw) as Partial<Avatar>;
    if (typeof a.dataUrl !== "string" || !a.dataUrl.startsWith("data:image/")) return null;
    const colors = Array.isArray(a.colors)
      ? a.colors.filter((c): c is string => typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c))
      : [];
    const thumb = typeof a.thumb === "string" && a.thumb.startsWith("data:image/jpeg") ? a.thumb : "";
    return { dataUrl: a.dataUrl, colors, thumb };
  } catch {
    return null;
  }
}

/** Returns false when the browser refused to store it (private mode, quota). */
export function storeAvatar(avatar: Avatar | null): boolean {
  try {
    if (avatar) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(avatar));
    else window.localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

const SHARE_KEY = "omr:shareAvatar";

/** Whether the player agreed to show their photo on the global leaderboard (off by default). */
export function loadShareAvatar(): boolean {
  try {
    return window.localStorage.getItem(SHARE_KEY) === "1";
  } catch {
    return false;
  }
}

export function storeShareAvatar(share: boolean) {
  try {
    window.localStorage.setItem(SHARE_KEY, share ? "1" : "0");
  } catch {
    /* not persisted: the choice still applies for this visit */
  }
}

export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}
