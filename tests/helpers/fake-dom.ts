import { vi } from "vitest";

/** A 2D context that accepts every call and does nothing (the engine only draws). */
function fakeContext() {
  const target: Record<string | symbol, unknown> = {};
  return new Proxy(target, {
    get(t, key) {
      if (!(key in t)) {
        t[key] =
          key === "createLinearGradient" || key === "createRadialGradient"
            ? () => ({ addColorStop() {} })
            : () => {};
      }
      return t[key];
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
}

export function fakeCanvas(width = 1280, height = 720) {
  return {
    width: 0,
    height: 0,
    getContext: () => fakeContext(),
    getBoundingClientRect: () => ({ width, height }),
  } as unknown as HTMLCanvasElement;
}

/** Just enough of `window` / `document` for the engine to run headless. */
export function installFakeDom() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    devicePixelRatio: 1,
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
    },
  });
  vi.stubGlobal("document", { createElement: () => fakeCanvas(1, 1) });
}
