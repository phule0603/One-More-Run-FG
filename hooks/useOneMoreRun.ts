"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import {
  airPose,
  BODY,
  CROUCH,
  drawFigure,
  drawHead,
  figureJoints,
  lerpPose,
  runPose,
  TUCK,
} from "@/lib/character";
import { BASE_SPEED, COIN_VALUE, MAX_SPEED, METERS_PER_UNIT, RAMP_TIME } from "@/lib/game-config";
import {
  drawGift,
  drawPowerIcon,
  FIRST_GIFT,
  GIFT_COLOR,
  GIFT_EVERY,
  MAGNET_RADIUS,
  MAX_LIVES,
  pickPower,
  POWERS,
  SAVE_INVULN,
  SLOW_FACTOR,
  type PowerKind,
} from "@/lib/powerups";

/* =============================================================================
 * Types
 * ========================================================================== */

export type Phase = "ready" | "playing" | "dead";

export interface RunResult {
  score: number;
  best: number;
  coins: number;
  distance: number;
  isNewBest: boolean;
  run: number;
  durationMs: number;
}

export interface GameOptions {
  onRunStart?: (run: number) => void;
  onRunEnd?: (result: RunResult) => void;
  /** While true, keyboard and tap input don't reach the game (e.g. a dialog is open). */
  inputBlockedRef?: RefObject<boolean>;
}

export interface GameHud {
  phase: Phase;
  result: RunResult | null;
  best: number;
  runs: number;
  muted: boolean;
  toggleMute: () => void;
  /** Draws the player as this image (null restores the neon cube); colors tint its particles. */
  setAvatar: (image: CanvasImageSource | null, colors?: string[]) => void;
}

interface EngineCallbacks {
  onPhase: (phase: Phase, result: RunResult | null) => void;
  onMeta: (best: number, runs: number, muted: boolean) => void;
  onRunStart: (run: number) => void;
  onRunEnd: (result: RunResult) => void;
}

interface Player {
  x: number;
  y: number; // height of the player's bottom edge above the ground
  vy: number; // positive = upwards
  grounded: boolean;
  coyote: number;
  buffer: number;
  airJumps: number;
  /** body rotation, used by the double-jump somersault */
  rot: number;
  flipT: number; // seconds into the current flip, -1 when not flipping
  flipFrom: number;
  flipTo: number;
  runPhase: number;
  squash: number;
  /** recent head positions (world space), drawn as ghosts during a flip */
  trail: { x: number; y: number }[];
}

type Obstacle =
  | { kind: "spike"; x: number; w: number; h: number; n: number }
  | { kind: "block"; x: number; w: number; h: number }
  | { kind: "laser"; x: number; w: number; bottom: number }
  | {
      kind: "saw";
      x: number;
      w: number;
      r: number;
      base: number;
      amp: number;
      freq: number;
      phase: number;
      cy: number;
      spin: number;
    };

interface Coin {
  x: number;
  y: number;
  taken: boolean;
  /** being pulled in by the magnet */
  magnet?: boolean;
}

interface Gift {
  x: number;
  y: number;
  kind: PowerKind;
  taken: boolean;
}

type TimedPower = Exclude<PowerKind, "life">;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  drag: number;
  gravity: number;
  square: boolean;
  scroll: boolean;
}

interface Ring {
  x: number;
  y: number;
  r: number;
  grow: number;
  life: number;
  max: number;
  color: string;
}

interface FloatText {
  x: number;
  y: number;
  text: string;
  life: number;
  max: number;
  color: string;
  size: number;
  vy: number;
  screen: boolean; // true = screen-space (centered banners), false = world-space
}

interface Building {
  x: number;
  w: number;
  h: number;
  windows: [number, number][];
}

interface SkylineLayer {
  factor: number;
  color: string;
  edgeAlpha: number;
  len: number;
  buildings: Building[];
}

type Vec = [number, number];

/* =============================================================================
 * Tuning
 * ========================================================================== */

const STEP = 1 / 120; // fixed physics timestep
const MAX_FRAME = 0.1; // clamp after tab switches / hitches
const MIN_VIEW_W = 640; // minimum virtual width (portrait phones)
const BASE_VIEW_H = 540; // reference virtual height

const GRAVITY = 2700;
const JUMP_V = 860; // ≈137 units high, ≈0.64s airtime
const DJUMP_V = 780;
const COYOTE = 0.09;
const BUFFER = 0.13;
const SIZE = 34;
const HIT_INSET = 4;
const STRIDE_LEN = 125; // world units per running stride
const MAX_STRIDE_HZ = 5.5;
const FLIP_TIME = 0.46; // seconds for the double-jump somersault
const C_SCARF = "#ff4d6d";

const REF_LOOKAHEAD = 772; // visible track ahead of the player on a 16:9 screen
const MIN_SPEED_FACTOR = 0.75;

const RETRY_LOCK = 0.3; // seconds after death before input restarts
const COIN_R = 10;
const MAX_PARTICLES = 800;

const KEY_BEST = "omr:best";
const KEY_BEST_DIST = "omr:bestDist";
const KEY_RUNS = "omr:runs";
const KEY_MUTED = "omr:muted";

const C_PLAYER = "#22d3ee";
const C_SPIKE = "#ff2d95";
const C_BLOCK = "#a855f7";
const C_LASER = "#ff2d55";
const C_SAW = "#fb923c";
const C_COIN = "#facc15";

/* =============================================================================
 * Helpers
 * ========================================================================== */

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const pick = <T,>(arr: readonly T[]): T => arr[(Math.random() * arr.length) | 0];

function storageGet(key: string, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

function storageSet(key: string, value: number) {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    /* storage unavailable (private mode) — keep playing without persistence */
  }
}

function rectOverlap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function circleRect(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number) {
  const nx = clamp(cx, x, x + w);
  const ny = clamp(cy, y, y + h);
  const dx = cx - nx;
  const dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

/** Separating-axis test for two convex polygons. */
function polysIntersect(a: Vec[], b: Vec[]) {
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const nx = y2 - y1;
      const ny = x1 - x2;
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      for (const [px, py] of a) {
        const p = px * nx + py * ny;
        if (p < minA) minA = p;
        if (p > maxA) maxA = p;
      }
      for (const [px, py] of b) {
        const p = px * nx + py * ny;
        if (p < minB) minB = p;
        if (p > maxB) maxB = p;
      }
      if (maxA <= minB || maxB <= minA) return false;
    }
  }
  return true;
}

/* =============================================================================
 * Sound (tiny WebAudio synth, no assets)
 * ========================================================================== */

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  unlock() {
    if (!this.ctx) {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  private tone(from: number, to: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    if (this.muted || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, vol: number) {
    if (this.muted || !this.ctx || !this.master) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(filter).connect(gain).connect(this.master);
    src.start();
  }

  jump() { this.tone(300, 620, 0.09, "square", 0.08); }
  doubleJump() { this.tone(520, 1040, 0.12, "square", 0.07); }
  coin() {
    this.tone(988, 988, 0.06, "triangle", 0.12);
    this.tone(1319, 1319, 0.12, "triangle", 0.12, 0.05);
  }
  level() {
    this.tone(523, 523, 0.08, "sawtooth", 0.05);
    this.tone(784, 784, 0.08, "sawtooth", 0.05, 0.08);
    this.tone(1047, 1047, 0.14, "sawtooth", 0.05, 0.16);
  }
  death() {
    this.noise(0.45, 0.5);
    this.tone(220, 40, 0.45, "sawtooth", 0.12);
  }
  start() { this.tone(440, 880, 0.1, "triangle", 0.08); }
  powerUp() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, f * 1.01, 0.09, "triangle", 0.09, i * 0.05));
  }
  shield() {
    this.noise(0.2, 0.25);
    this.tone(330, 990, 0.25, "sawtooth", 0.07);
  }
}

/* =============================================================================
 * Engine
 * ========================================================================== */

export class Engine {
  private ctx: CanvasRenderingContext2D;
  private bg: HTMLCanvasElement;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private time = 0;

  // viewport (virtual units)
  private dpr = 1;
  private scale = 1;
  private viewW = 960;
  private viewH = 540;
  private groundY = 420;

  // persistent meta
  private best = 0;
  private bestDist = 0;
  private runs = 0;

  // run state
  private phase: Phase = "ready";
  private player: Player;
  private obstacles: Obstacle[] = [];
  private coins: Coin[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];
  private texts: FloatText[] = [];
  private gifts: Gift[] = [];
  /** seconds left on each timed power-up */
  private powers: Record<TimedPower, number> = { magnet: 0, ghost: 0, slow: 0, wings: 0 };
  private lives = 0;
  private invuln = 0; // seconds of invulnerability after an extra life is used
  private giftTimer = 0; // seconds until the next gift may appear
  private slowMul = 1; // eases towards SLOW_FACTOR while slow-mo is active
  private runTime = 0;
  private speed = BASE_SPEED;
  private speedFactor = 1; // narrower screens show less track, so the world scrolls slower
  private diff = 0;
  private level = 1;
  private distance = 0;
  private coinCount = 0;
  private nextSpawn = 0;
  private scroll = 0;
  private deadTime = 0;
  private shake = 0;
  private flash = 0;
  private passedBest = false;

  // personalisation
  private avatar: CanvasImageSource | null = null;
  private avatarColors: string[] = [];

  // decorative
  private reducedMotion = false;
  private skyline: SkylineLayer[] = [];
  private groundGrad: CanvasGradient | null = null;

  readonly sfx = new Sfx();

  constructor(private canvas: HTMLCanvasElement, private cb: EngineCallbacks) {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("Canvas 2D context unavailable");
    this.ctx = ctx;
    this.bg = document.createElement("canvas");
    this.player = this.makePlayer();

    this.best = storageGet(KEY_BEST, 0);
    this.bestDist = storageGet(KEY_BEST_DIST, 0);
    this.runs = storageGet(KEY_RUNS, 0);
    this.sfx.muted = storageGet(KEY_MUTED, 0) === 1;
    this.cb.onMeta(this.best, this.runs, this.sfx.muted);
    this.reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    this.skyline = [
      this.makeSkyline(0.08, "#140a2e", 0.25, 60, 170),
      this.makeSkyline(0.22, "#0d0620", 0.5, 30, 110),
    ];
  }

  /* ---------------------------------------------------------------- lifecycle */

  start() {
    this.resize();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const cssW = Math.max(1, rect.width);
    const cssH = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.scale = Math.min(cssH / BASE_VIEW_H, cssW / MIN_VIEW_W);
    this.viewW = cssW / this.scale;
    this.viewH = cssH / this.scale;
    this.groundY = Math.min(this.viewH * 0.78, this.viewH / 2 + 160);
    this.speedFactor = clamp(
      (this.viewW - this.playerX() - SIZE) / REF_LOOKAHEAD,
      MIN_SPEED_FACTOR,
      1,
    );

    const pw = Math.round(cssW * this.dpr);
    const ph = Math.round(cssH * this.dpr);
    this.canvas.width = pw;
    this.canvas.height = ph;
    this.bg.width = pw;
    this.bg.height = ph;

    this.player.x = this.playerX();
    this.renderBackground();
    const k = this.dpr * this.scale;
    this.ctx.setTransform(k, 0, 0, k, 0, 0);
    this.groundGrad = this.ctx.createLinearGradient(0, this.groundY, 0, this.viewH);
    this.groundGrad.addColorStop(0, "#12052a");
    this.groundGrad.addColorStop(1, "#05010f");
  }

  setAvatar(image: CanvasImageSource | null, colors: string[] = []) {
    this.avatar = image;
    this.avatarColors = image ? colors.slice(0, 4) : [];
  }

  /** Particle colours for the player: the photo's palette, or the default cyan. */
  private get playerColors() {
    return this.avatarColors.length ? this.avatarColors : [C_PLAYER, "#a5f3fc"];
  }

  toggleMute() {
    this.sfx.muted = !this.sfx.muted;
    storageSet(KEY_MUTED, this.sfx.muted ? 1 : 0);
    this.cb.onMeta(this.best, this.runs, this.sfx.muted);
  }

  /* -------------------------------------------------------------------- input */

  press() {
    this.sfx.unlock();
    if (this.phase === "ready") {
      this.startRun();
      return;
    }
    if (this.phase === "dead") {
      if (this.deadTime >= RETRY_LOCK) this.startRun();
      return;
    }
    // Resolve the jump immediately for zero perceived latency; the buffer keeps
    // it alive for a few frames if the player is a hair early.
    this.player.buffer = BUFFER;
    this.tryJump();
  }

  /* ---------------------------------------------------------------- run state */

  private playerX() {
    return Math.min(180, this.viewW * 0.16);
  }

  private makePlayer(): Player {
    return {
      x: this.playerX(),
      y: 0,
      vy: 0,
      grounded: true,
      coyote: 0,
      buffer: 0,
      airJumps: 1,
      rot: 0,
      flipT: -1,
      flipFrom: 0,
      flipTo: 0,
      runPhase: 0,
      squash: 0,
      trail: [],
    };
  }

  private startRun() {
    this.player = this.makePlayer();
    this.obstacles.length = 0;
    this.coins.length = 0;
    this.particles.length = 0;
    this.rings.length = 0;
    this.texts.length = 0;
    this.gifts.length = 0;
    this.powers = { magnet: 0, ghost: 0, slow: 0, wings: 0 };
    this.lives = 0;
    this.invuln = 0;
    this.slowMul = 1;
    this.giftTimer = rand(FIRST_GIFT[0], FIRST_GIFT[1]);
    this.runTime = 0;
    this.speed = BASE_SPEED * this.speedFactor;
    this.diff = 0;
    this.level = 1;
    this.distance = 0;
    this.coinCount = 0;
    this.nextSpawn = this.viewW * 0.55;
    this.deadTime = 0;
    this.shake = 0;
    this.flash = 0;
    this.passedBest = this.bestDist <= 0;
    this.runs += 1;
    storageSet(KEY_RUNS, this.runs);
    this.phase = "playing";
    this.sfx.start();
    this.burst(this.player.x + SIZE / 2, SIZE / 2, 18, [this.playerColors[0], "#ffffff"], 120, 420, 0.5);
    this.cb.onPhase("playing", null);
    this.cb.onMeta(this.best, this.runs, this.sfx.muted);
    this.cb.onRunStart(this.runs);
  }

  private score() {
    return Math.floor(this.distance * METERS_PER_UNIT) + this.coinCount * COIN_VALUE;
  }

  private die() {
    if (this.phase !== "playing") return;
    this.phase = "dead";
    this.deadTime = 0;
    this.shake = this.reducedMotion ? 0.35 : 1;
    this.flash = this.reducedMotion ? 0.25 : 0.7;
    if (!this.sfx.muted) navigator.vibrate?.(70);

    const p = this.player;
    const cx = p.x + SIZE / 2;
    const cy = p.y + SIZE / 2;
    const shards = this.avatarColors.length ? [...this.avatarColors, "#ffffff"] : [C_PLAYER, "#ffffff", C_SPIKE];
    this.burst(cx, cy, 70, shards, 200, 950, 1.1, true);
    this.burst(cx, cy, 30, [C_COIN, "#ffffff"], 80, 420, 0.8);
    this.rings.push({ x: cx, y: cy, r: 8, grow: 900, life: 0.45, max: 0.45, color: "#ffffff" });
    this.rings.push({ x: cx, y: cy, r: 4, grow: 520, life: 0.6, max: 0.6, color: C_SPIKE });
    this.sfx.death();

    const score = this.score();
    const isNewBest = score > this.best;
    if (isNewBest) {
      this.best = score;
      storageSet(KEY_BEST, score);
    }
    if (this.distance > this.bestDist) {
      this.bestDist = this.distance;
      storageSet(KEY_BEST_DIST, Math.floor(this.distance));
    }
    const result: RunResult = {
      score,
      best: this.best,
      coins: this.coinCount,
      distance: Math.floor(this.distance * METERS_PER_UNIT),
      isNewBest,
      run: this.runs,
      durationMs: Math.round(this.runTime * 1000),
    };
    this.cb.onPhase("dead", result);
    this.cb.onMeta(this.best, this.runs, this.sfx.muted);
    this.cb.onRunEnd(result);
  }

  /* ------------------------------------------------------------------ physics */

  private tryJump() {
    const p = this.player;
    if (p.grounded || p.coyote > 0) {
      p.vy = JUMP_V;
      p.grounded = false;
      p.coyote = 0;
      p.buffer = 0;
      p.airJumps = this.airJumpsMax;
      p.squash = -0.6;
      this.burst(p.x + SIZE / 2, p.y, 12, this.playerColors, 60, 260, 0.35, false, true, -0.5);
      this.sfx.jump();
    } else if (p.airJumps > 0) {
      p.vy = DJUMP_V;
      p.airJumps -= 1;
      p.buffer = 0;
      p.squash = -0.5;
      // somersault: one full forward turn (chained onto a flip still in progress)
      p.flipFrom = p.rot;
      p.flipTo = (p.flipT >= 0 ? p.flipTo : 0) + Math.PI * 2;
      p.flipT = 0;
      const cx = p.x + SIZE / 2;
      this.rings.push({ x: cx, y: p.y, r: 6, grow: 260, life: 0.3, max: 0.3, color: C_PLAYER });
      this.burst(cx, p.y, 14, [this.playerColors[0], "#f0abfc"], 80, 300, 0.4, false, true, -0.9);
      this.sfx.doubleJump();
    }
  }

  private update(dt: number) {
    this.time += dt;

    if (this.phase === "playing") this.updatePlaying(dt);
    else if (this.phase === "ready") {
      this.scroll += BASE_SPEED * 0.55 * dt;
      this.player.trail.length = 0;
      this.player.runPhase += ((BASE_SPEED * 0.55) / STRIDE_LEN) * dt * Math.PI * 2;
    } else {
      this.deadTime += dt;
    }

    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.updateEffects(dt);
  }

  private updatePlaying(dt: number) {
    this.runTime += dt;
    this.diff = 1 - Math.exp(-this.runTime / RAMP_TIME);

    // power-up timers
    const ghostWasOn = this.powers.ghost > 0;
    for (const k of Object.keys(this.powers) as TimedPower[]) this.powers[k] = Math.max(0, this.powers[k] - dt);
    // ghost never ends inside an obstacle: it holds until the runner is clear
    if (ghostWasOn && this.powers.ghost === 0 && this.hitsObstacle()) this.powers.ghost = 0.02;
    if (this.powers.wings === 0 && this.player.airJumps > 1) this.player.airJumps = 1;
    this.invuln = Math.max(0, this.invuln - dt);
    this.giftTimer -= dt;
    const slowTarget = this.powers.slow > 0 ? SLOW_FACTOR : 1;
    this.slowMul += (slowTarget - this.slowMul) * Math.min(1, dt * 4);

    this.speed = (BASE_SPEED + (MAX_SPEED - BASE_SPEED) * this.diff) * this.speedFactor * this.slowMul;
    const lvl = 1 + Math.floor(this.diff * 10);
    if (lvl > this.level) {
      this.level = lvl;
      this.texts.push({
        x: this.viewW / 2, y: this.groundY * 0.55, text: `SPEED ${lvl}`,
        life: 1.1, max: 1.1, color: "#f0abfc", size: 42, vy: 30, screen: true,
      });
      this.sfx.level();
    }

    const dx = this.speed * dt;
    // distance is normalised to the 16:9 reference so scores are comparable on every screen
    this.distance += dx / this.speedFactor;
    this.scroll += dx;

    // world movement
    for (const o of this.obstacles) {
      o.x -= dx;
      if (o.kind === "saw") {
        o.cy = o.base + o.amp * Math.sin(o.phase + this.runTime * o.freq);
        o.spin += dt * 12;
      }
    }
    for (const c of this.coins) c.x -= dx;
    for (const g of this.gifts) g.x -= dx;
    for (const t of this.player.trail) t.x -= dx;
    this.obstacles = this.obstacles.filter((o) => o.x + o.w > -80);
    this.coins = this.coins.filter((c) => c.x > -40 && !c.taken);
    this.gifts = this.gifts.filter((g) => g.x > -40 && !g.taken);

    // spawning
    this.nextSpawn -= dx;
    if (this.nextSpawn <= 0) this.nextSpawn = this.spawnPattern();

    // player physics
    const p = this.player;
    p.buffer = Math.max(0, p.buffer - dt);
    p.coyote = Math.max(0, p.coyote - dt);
    p.squash *= Math.exp(-dt * 14);

    const wasGrounded = p.grounded;
    p.vy -= GRAVITY * dt;
    let ny = p.y + p.vy * dt;

    // landing surfaces: ground + block tops
    let floor = 0;
    const left = p.x + HIT_INSET;
    const right = p.x + SIZE - HIT_INSET;
    for (const o of this.obstacles) {
      if (o.kind !== "block") continue;
      if (right > o.x && left < o.x + o.w && p.y >= o.h - 2 && ny <= o.h) {
        floor = Math.max(floor, o.h);
      }
    }
    if (ny <= floor) {
      ny = floor;
      if (!wasGrounded && p.vy < -200) {
        p.squash = 0.8;
        this.burst(p.x + SIZE / 2, floor, 8, [this.playerColors[0]], 40, 180, 0.3, false, true, 0.2);
      }
      p.vy = 0;
      p.grounded = true;
      p.airJumps = this.airJumpsMax;
    } else {
      if (wasGrounded) p.coyote = COYOTE;
      p.grounded = false;
    }
    p.y = ny;

    if (p.buffer > 0 && (p.grounded || p.coyote > 0)) this.tryJump();

    if (p.flipT >= 0) {
      // a flip cut short by landing finishes as a quick roll
      p.flipT += p.grounded ? dt * 4 : dt;
      const k = Math.min(1, p.flipT / FLIP_TIME);
      const eased = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      p.rot = p.flipFrom + (p.flipTo - p.flipFrom) * eased;
      if (k >= 1) {
        p.rot = 0;
        p.flipT = -1;
      }
    }
    if (p.grounded) {
      p.runPhase += Math.min(this.speed / STRIDE_LEN, MAX_STRIDE_HZ) * dt * Math.PI * 2;
      if (Math.random() < dt * 30) {
        this.particles.push({
          x: p.x + SIZE / 2 - 4, y: p.y + 1, vx: -rand(40, 120), vy: rand(20, 90), life: 0.3, max: 0.3,
          size: rand(1.5, 3), color: this.playerColors[0], drag: 2, gravity: 300, square: true, scroll: true,
        });
      }
    }

    // collisions (ghost and post-save invulnerability pass through; an extra life takes the hit)
    if (this.powers.ghost <= 0 && this.invuln <= 0 && this.hitsObstacle()) {
      if (this.lives > 0) this.useLife();
      else {
        this.die();
        return;
      }
    }

    // coins (the magnet pulls nearby ones in)
    const pcx = p.x + SIZE / 2;
    const pcy = p.y + SIZE / 2;
    for (const c of this.coins) {
      if (c.taken) continue;
      if (this.powers.magnet > 0 || c.magnet) {
        const ddx = pcx - c.x;
        const ddy = pcy - c.y;
        const d = Math.hypot(ddx, ddy) || 1;
        if (c.magnet || d < MAGNET_RADIUS) {
          c.magnet = true;
          const pull = (650 + 900 * (1 - Math.min(d, MAGNET_RADIUS) / MAGNET_RADIUS)) * dt;
          c.x += (ddx / d) * Math.min(d, pull);
          c.y += (ddy / d) * Math.min(d, pull);
        }
      }
      if (circleRect(c.x, c.y, COIN_R + 4, p.x, p.y, SIZE, SIZE)) {
        c.taken = true;
        this.coinCount += 1;
        this.burst(c.x, c.y, 14, [C_COIN, "#fff7c2"], 60, 320, 0.45, false, true);
        this.rings.push({ x: c.x, y: c.y, r: 4, grow: 160, life: 0.25, max: 0.25, color: C_COIN });
        this.texts.push({
          x: c.x, y: c.y + 18, text: `+${COIN_VALUE}`, life: 0.6, max: 0.6,
          color: C_COIN, size: 16, vy: 70, screen: false,
        });
        this.sfx.coin();
      }
    }

    // gifts
    for (const g of this.gifts) {
      if (!g.taken && circleRect(g.x, g.y, 16, p.x, p.y, SIZE, SIZE)) {
        g.taken = true;
        this.activate(g.kind, g.x, g.y);
      }
    }

    // passing the previous best distance
    if (!this.passedBest && this.distance >= this.bestDist) {
      this.passedBest = true;
      this.texts.push({
        x: this.viewW / 2, y: this.groundY * 0.4, text: "NEW RECORD PACE!",
        life: 1.3, max: 1.3, color: C_COIN, size: 30, vy: 20, screen: true,
      });
      this.burst(p.x + SIZE / 2, p.y + SIZE / 2, 24, [C_COIN, "#ffffff"], 100, 400, 0.6);
    }
  }

  /** Whether the runner's hitbox touches any obstacle right now. */
  private hitsObstacle(): boolean {
    const p = this.player;
    const hx = p.x + HIT_INSET;
    const hy = p.y + HIT_INSET;
    const hs = SIZE - HIT_INSET * 2;
    const playerPoly: Vec[] = [[hx, hy], [hx + hs, hy], [hx + hs, hy + hs], [hx, hy + hs]];
    for (const o of this.obstacles) {
      if (o.x > hx + hs + 4 || o.x + o.w < hx - 4) continue;
      let hit = false;
      switch (o.kind) {
        case "spike": {
          const sw = o.w / o.n;
          for (let i = 0; i < o.n && !hit; i++) {
            const bx = o.x + i * sw;
            hit = polysIntersect(playerPoly, [[bx + 2, 0], [bx + sw - 2, 0], [bx + sw / 2, o.h - 2]]);
          }
          break;
        }
        case "block":
          hit = rectOverlap(hx, hy, hs, hs, o.x, 0, o.w, o.h);
          break;
        case "laser":
          hit = rectOverlap(hx, hy, hs, hs, o.x, o.bottom, o.w, 10000);
          break;
        case "saw":
          hit = circleRect(o.x + o.r, o.cy, o.r - 3, hx, hy, hs, hs);
          break;
      }
      if (hit) return true;
    }
    return false;
  }

  private get airJumpsMax() {
    return this.powers.wings > 0 ? 2 : 1;
  }

  private activate(kind: PowerKind, x: number, y: number) {
    const spec = POWERS[kind];
    const p = this.player;
    if (kind === "life") this.lives = Math.min(MAX_LIVES, this.lives + 1);
    else this.powers[kind] = spec.duration;
    if (kind === "wings" && !p.grounded) p.airJumps = Math.min(2, p.airJumps + 1);
    this.burst(x, y, 22, [GIFT_COLOR, spec.color, "#ffffff"], 80, 380, 0.6, false, true);
    this.rings.push({ x, y, r: 6, grow: 260, life: 0.35, max: 0.35, color: GIFT_COLOR });
    this.texts.push({
      x: this.viewW / 2, y: this.groundY * 0.5, text: spec.label,
      life: 1, max: 1, color: spec.color, size: 30, vy: 24, screen: true,
    });
    this.sfx.powerUp();
  }

  /** The extra life takes the hit: bounce up and stay invulnerable for a moment. */
  private useLife() {
    const p = this.player;
    this.lives -= 1;
    this.invuln = SAVE_INVULN;
    p.vy = Math.max(p.vy, JUMP_V * 0.75);
    p.grounded = false;
    p.airJumps = this.airJumpsMax;
    this.shake = this.reducedMotion ? 0.15 : 0.4;
    const cx = p.x + SIZE / 2;
    const cy = p.y + SIZE / 2;
    this.burst(cx, cy, 30, [POWERS.life.color, "#fde047", "#ffffff"], 120, 520, 0.6);
    this.rings.push({ x: cx, y: cy, r: 10, grow: 420, life: 0.4, max: 0.4, color: "#fde047" });
    this.texts.push({
      x: this.viewW / 2, y: this.groundY * 0.5, text: "SAVED!",
      life: 1, max: 1, color: "#fde047", size: 34, vy: 24, screen: true,
    });
    this.sfx.shield();
  }

  private updateEffects(dt: number) {
    const worldDx = this.phase === "playing" ? this.speed * dt : 0;
    let w = 0;
    for (const pt of this.particles) {
      pt.life -= dt;
      if (pt.life <= 0) continue;
      const damp = Math.exp(-pt.drag * dt);
      pt.vx *= damp;
      pt.vy = pt.vy * damp - pt.gravity * dt;
      pt.x += pt.vx * dt - (pt.scroll ? worldDx : 0);
      pt.y += pt.vy * dt;
      if (pt.y < 0 && pt.gravity > 0) {
        pt.y = 0;
        pt.vy *= -0.35;
        pt.vx *= 0.7;
      }
      this.particles[w++] = pt;
    }
    this.particles.length = w;

    this.rings = this.rings.filter((r) => {
      r.life -= dt;
      r.r += r.grow * dt * (r.life / r.max);
      return r.life > 0;
    });
    this.texts = this.texts.filter((t) => {
      t.life -= dt;
      t.y += t.screen ? -t.vy * dt : t.vy * dt;
      return t.life > 0;
    });
  }

  private burst(
    x: number, y: number, count: number, colors: string[], minV: number, maxV: number,
    life: number, squares = false, scroll = false, biasY = 0,
  ) {
    for (let i = 0; i < count && this.particles.length < MAX_PARTICLES; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = rand(minV, maxV);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v + biasY * v,
        life: life * rand(0.6, 1),
        max: life,
        size: squares ? rand(3, 7) : rand(1.5, 3.5),
        color: pick(colors),
        drag: squares ? 1.6 : 3,
        gravity: squares ? 1400 : 500,
        square: squares,
        scroll,
      });
    }
  }

  /* ----------------------------------------------------------------- spawning */

  /** Spawns one obstacle pattern off-screen and returns the distance until the next one. */
  private spawnPattern(): number {
    const d = this.diff;
    // nominal speed: patterns spawned during slow-mo must still be spaced for full speed
    const v = this.speed / this.slowMul;
    const x0 = this.viewW + 60;
    const airSpan = v * ((2 * JUMP_V) / GRAVITY); // horizontal length of a single jump

    const patterns: [number, () => number][] = [
      [3, () => {
        const n = 1 + Math.floor(Math.random() * (1 + Math.min(2, d * 3)));
        const w = 30 * n;
        this.obstacles.push({ kind: "spike", x: x0, w, h: 36, n });
        if (Math.random() < 0.6) this.coinArc(x0 + w / 2, airSpan * 0.7, 105);
        return w;
      }],
      [2.2, () => {
        const w = rand(44, 74);
        const h = rand(50, 95 + d * 80);
        this.obstacles.push({ kind: "block", x: x0, w, h });
        if (Math.random() < 0.7) this.coins.push({ x: x0 + w / 2, y: h + 30, taken: false });
        return w;
      }],
      [d > 0.1 ? 1.4 : 0, () => {
        const w = rand(100, 180 + d * 160);
        this.obstacles.push({ kind: "laser", x: x0, w, bottom: 56 });
        const n = Math.max(2, Math.floor(w / 42));
        for (let i = 0; i < n; i++) {
          this.coins.push({ x: x0 + 20 + (i * (w - 40)) / (n - 1), y: 17, taken: false });
        }
        return w;
      }],
      [d > 0.22 ? 1.3 : 0, () => {
        const r = 24;
        this.obstacles.push({
          kind: "saw", x: x0, w: r * 2, r, base: 92, amp: 56,
          freq: 2.4 + d * 1.5, phase: rand(0, Math.PI * 2), cy: 92, spin: 0,
        });
        return r * 2;
      }],
      [d > 0.3 ? 1 : 0, () => {
        // Stairs: contiguous steps, each 45 higher. A step is longer than one hop
        // (≈0.58s of travel), so a jump from anywhere on a step lands on the next one
        // before the following face — a "tap, tap, tap" rhythm, not a pixel-perfect test.
        const heights = d > 0.6 ? [45, 90, 135, 180] : [45, 90, 135];
        const w = v * 0.8;
        heights.forEach((h, i) => {
          this.obstacles.push({ kind: "block", x: x0 + i * w, w, h });
        });
        const top = heights.length - 1;
        this.coins.push({ x: x0 + top * w + w * 0.6, y: heights[top] + 17, taken: false });
        // extra room so jumping off the top step lands before the next pattern
        return heights.length * w + v * 0.35;
      }],
      [d > 0.45 ? 1.2 : 0, () => {
        this.obstacles.push({ kind: "spike", x: x0, w: 60, h: 36, n: 2 });
        const bx = x0 + 60 + v * 0.85;
        const h = rand(60, 95);
        this.obstacles.push({ kind: "block", x: bx, w: 50, h });
        this.coinArc(x0 + 30, airSpan * 0.7, 105);
        return bx - x0 + 50;
      }],
      [0.6, () => {
        const n = 6;
        const wave = Math.random() < 0.5;
        for (let i = 0; i < n; i++) {
          this.coins.push({
            x: x0 + i * 38,
            y: wave ? 30 + Math.sin((i / (n - 1)) * Math.PI) * 70 : 17,
            taken: false,
          });
        }
        return n * 38;
      }],
    ];

    const total = patterns.reduce((s, [wgt]) => s + wgt, 0);
    let roll = Math.random() * total;
    let width = 0;
    for (const [wgt, fn] of patterns) {
      roll -= wgt;
      if (roll <= 0 && wgt > 0) {
        width = fn();
        break;
      }
    }

    const gapTime = Math.max(0.62, 1.15 - d * 0.5) + Math.random() * (0.55 - d * 0.25);
    const gap = gapTime * v;
    // a gift sits in the middle of the gap at running height: grabbing it never needs a risky jump
    if (this.giftTimer <= 0 && gap > 180) {
      const kind = pickPower(Math.random, (k) =>
        k === "life" && this.lives >= MAX_LIVES ? 0 : POWERS[k].weight,
      );
      this.gifts.push({ x: x0 + width + gap / 2, y: 22, kind, taken: false });
      this.giftTimer = rand(GIFT_EVERY[0], GIFT_EVERY[1]);
    }
    return width + gap;
  }

  private coinArc(cx: number, span: number, peak: number) {
    const n = 5;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      this.coins.push({ x: cx + (t - 0.5) * span, y: 22 + peak * 4 * t * (1 - t), taken: false });
    }
  }

  /* --------------------------------------------------------------- main loop */

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, MAX_FRAME);
    this.last = now;
    this.acc += dt;
    let steps = 0;
    while (this.acc >= STEP && steps < 12) {
      this.update(STEP);
      this.acc -= STEP;
      steps++;
    }
    if (steps === 12) this.acc = 0;
    this.render();
  };

  /* ---------------------------------------------------------------- rendering */

  private get hue() {
    return 190 + this.diff * 130;
  }

  private sy(yUp: number) {
    return this.groundY - yUp;
  }

  private makeSkyline(factor: number, color: string, edgeAlpha: number, minH: number, maxH: number): SkylineLayer {
    const buildings: Building[] = [];
    let x = 0;
    const len = 1800;
    while (x < len) {
      const w = rand(40, 110);
      const h = rand(minH, maxH);
      const windows: [number, number][] = [];
      for (let wy = 12; wy < h - 8; wy += 14) {
        for (let wx = 8; wx < w - 8; wx += 12) {
          if (Math.random() < 0.12) windows.push([wx, wy]);
        }
      }
      buildings.push({ x, w, h, windows });
      x += w + rand(4, 24);
    }
    return { factor, color, edgeAlpha, len: x, buildings };
  }

  /** Static sky, sun and stars, rendered once per resize. */
  private renderBackground() {
    const g = this.bg.getContext("2d");
    if (!g) return;
    const k = this.dpr * this.scale;
    g.setTransform(k, 0, 0, k, 0, 0);
    const W = this.viewW;
    const G = this.groundY;

    const sky = g.createLinearGradient(0, 0, 0, G);
    sky.addColorStop(0, "#05010f");
    sky.addColorStop(0.6, "#1a0633");
    sky.addColorStop(1, "#3b0a4f");
    g.fillStyle = sky;
    g.fillRect(0, 0, W, this.viewH);

    for (let i = 0; i < Math.floor((W * G) / 2600); i++) {
      g.fillStyle = `rgba(255,255,255,${rand(0.15, 0.8).toFixed(2)})`;
      const s = Math.random() < 0.1 ? 2 : 1;
      g.fillRect(Math.random() * W, Math.random() * G * 0.85, s, s);
    }

    // synthwave sun
    const r = Math.min(150, W * 0.18);
    const cx = W * 0.68;
    const cy = G - 40;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.clip();
    const sun = g.createLinearGradient(0, cy - r, 0, cy + r);
    sun.addColorStop(0, "#fde047");
    sun.addColorStop(0.5, "#fb7185");
    sun.addColorStop(1, "#c026d3");
    g.fillStyle = sun;
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
    g.fillStyle = "#1a0633";
    for (let i = 0; i < 7; i++) {
      const y = cy + (i / 7) * r;
      g.fillRect(cx - r, y, r * 2, 2 + i * 1.4);
    }
    g.restore();
    const glow = g.createRadialGradient(cx, cy, r * 0.8, cx, cy, r * 2.2);
    glow.addColorStop(0, "rgba(251,113,133,0.25)");
    glow.addColorStop(1, "rgba(251,113,133,0)");
    g.fillStyle = glow;
    g.fillRect(cx - r * 2.2, cy - r * 2.2, r * 4.4, r * 4.4);
  }

  private render() {
    const ctx = this.ctx;
    const W = this.viewW;
    const H = this.viewH;
    const k = this.dpr * this.scale;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.bg, 0, 0);
    ctx.setTransform(k, 0, 0, k, 0, 0);

    ctx.save();
    if (this.shake > 0) {
      const s = this.shake * this.shake * 22;
      ctx.translate(rand(-s, s), rand(-s, s));
    }

    this.drawSkyline(ctx);
    this.drawGround(ctx);
    this.drawBestMarker(ctx);
    this.drawCoins(ctx);
    this.drawGifts(ctx);
    this.drawObstacles(ctx);
    if (this.phase !== "dead") this.drawPlayer(ctx);
    this.drawEffects(ctx);
    ctx.restore();

    const slowAmount = (1 - this.slowMul) / (1 - SLOW_FACTOR);
    if (slowAmount > 0.01) {
      ctx.fillStyle = `rgba(125,211,252,${0.08 * slowAmount})`;
      ctx.fillRect(0, 0, W, H);
    }

    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.6})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.phase === "dead") {
      ctx.fillStyle = `rgba(5,1,15,${Math.min(0.55, this.deadTime * 1.6)})`;
      ctx.fillRect(0, 0, W, H);
    }
    if (this.phase === "playing") this.drawHud(ctx);
  }

  private drawSkyline(ctx: CanvasRenderingContext2D) {
    const G = this.groundY;
    const hue = this.hue;
    for (const layer of this.skyline) {
      const off = (this.scroll * layer.factor) % layer.len;
      for (let rep = -1; rep <= Math.ceil(this.viewW / layer.len) + 1; rep++) {
        const base = rep * layer.len - off;
        for (const b of layer.buildings) {
          const x = base + b.x;
          if (x + b.w < 0 || x > this.viewW) continue;
          ctx.fillStyle = layer.color;
          ctx.fillRect(x, G - b.h, b.w, b.h);
          ctx.fillStyle = `hsla(${hue},100%,65%,${layer.edgeAlpha})`;
          ctx.fillRect(x, G - b.h, b.w, 1.5);
          ctx.fillStyle = `hsla(${hue + 40},100%,70%,${layer.edgeAlpha * 0.9})`;
          for (const [wx, wy] of b.windows) ctx.fillRect(x + wx, G - b.h + wy, 4, 5);
        }
      }
    }
  }

  private drawGround(ctx: CanvasRenderingContext2D) {
    const W = this.viewW;
    const H = this.viewH;
    const G = this.groundY;
    const hue = this.hue;

    if (this.groundGrad) ctx.fillStyle = this.groundGrad;
    ctx.fillRect(0, G, W, H - G);

    ctx.strokeStyle = `hsla(${hue},100%,60%,0.28)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    const vp = W * 0.5;
    const spacing = 70;
    const off = this.scroll % spacing;
    for (let x = -spacing * 10 - off; x < W + spacing * 10; x += spacing) {
      ctx.moveTo(x, G);
      ctx.lineTo(vp + (x - vp) * 3.5, H);
    }
    const depth = H - G;
    for (let i = 1; i <= 9; i++) {
      const t = i / 9;
      const y = G + depth * t * t;
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
    }
    ctx.stroke();

    ctx.save();
    ctx.shadowColor = `hsl(${hue},100%,60%)`;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = `hsl(${hue},100%,70%)`;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, G + 1);
    ctx.lineTo(W, G + 1);
    ctx.stroke();
    ctx.restore();
  }

  private drawBestMarker(ctx: CanvasRenderingContext2D) {
    if (this.bestDist <= 0 || this.phase === "ready") return;
    const x = this.player.x + SIZE / 2 + (this.bestDist - this.distance) * this.speedFactor;
    if (x < -20 || x > this.viewW + 20) return;
    const G = this.groundY;
    ctx.save();
    ctx.strokeStyle = "rgba(250,204,21,0.7)";
    ctx.setLineDash([6, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, G);
    ctx.lineTo(x, G - 230);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = C_COIN;
    ctx.font = "700 13px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText("BEST", x, G - 238);
    ctx.restore();
  }

  private drawGifts(ctx: CanvasRenderingContext2D) {
    for (const g of this.gifts) {
      if (g.taken || g.x < -30 || g.x > this.viewW + 30) continue;
      ctx.save();
      ctx.translate(g.x, this.sy(g.y + Math.sin(this.time * 4 + g.x * 0.03) * 3));
      drawGift(ctx, g.kind, 13, this.time);
      ctx.restore();
    }
  }

  /** Neon wings on the runner's back while TRIPLE JUMP is active. */
  private drawWings(ctx: CanvasRenderingContext2D, at: { x: number; y: number }, flap: number) {
    ctx.save();
    ctx.translate(at.x - 3, at.y + 1);
    ctx.scale(1.5, 1.5);
    ctx.fillStyle = POWERS.wings.color;
    ctx.shadowColor = POWERS.wings.color;
    ctx.shadowBlur = 10;
    ctx.globalAlpha *= 0.85;
    // flap 0 = raised up-and-back, 1 = swept down to horizontal
    const rot = 0.35 - flap * 0.9;
    for (const [angle, size] of [[rot, 1], [rot - 0.4, 0.8]]) {
      ctx.save();
      ctx.rotate(angle);
      ctx.scale(size, size);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(-6, -14, -20, -16);
      ctx.quadraticCurveTo(-14, -9, -17, -6);
      ctx.quadraticCurveTo(-10, -4, -12, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  private drawCoins(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.shadowColor = C_COIN;
    ctx.shadowBlur = 12;
    for (const c of this.coins) {
      if (c.taken || c.x < -20 || c.x > this.viewW + 20) continue;
      const bob = Math.sin(this.time * 5 + c.x * 0.05) * 3;
      const sx = Math.max(0.2, Math.abs(Math.cos(this.time * 4 + c.x * 0.02)));
      const x = c.x;
      const y = this.sy(c.y + bob);
      ctx.fillStyle = C_COIN;
      ctx.beginPath();
      ctx.moveTo(x, y - COIN_R);
      ctx.lineTo(x + COIN_R * 0.75 * sx, y);
      ctx.lineTo(x, y + COIN_R);
      ctx.lineTo(x - COIN_R * 0.75 * sx, y);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#fff7c2";
      ctx.fillRect(x - 1.5 * sx, y - 4, 3 * sx, 8);
    }
    ctx.restore();
  }

  private drawObstacles(ctx: CanvasRenderingContext2D) {
    const G = this.groundY;
    for (const o of this.obstacles) {
      if (o.x > this.viewW + 20 || o.x + o.w < -20) continue;
      ctx.save();
      switch (o.kind) {
        case "spike": {
          const sw = o.w / o.n;
          ctx.shadowColor = C_SPIKE;
          ctx.shadowBlur = 16;
          ctx.fillStyle = "rgba(255,45,149,0.18)";
          ctx.strokeStyle = C_SPIKE;
          ctx.lineWidth = 2.5;
          ctx.lineJoin = "round";
          ctx.beginPath();
          for (let i = 0; i < o.n; i++) {
            const bx = o.x + i * sw;
            ctx.moveTo(bx, G);
            ctx.lineTo(bx + sw / 2, G - o.h);
            ctx.lineTo(bx + sw, G);
          }
          ctx.fill();
          ctx.stroke();
          break;
        }
        case "block": {
          const y = G - o.h;
          ctx.fillStyle = "rgba(168,85,247,0.16)";
          ctx.fillRect(o.x, y, o.w, o.h);
          ctx.shadowColor = C_BLOCK;
          ctx.shadowBlur = 16;
          ctx.strokeStyle = C_BLOCK;
          ctx.lineWidth = 2.5;
          ctx.strokeRect(o.x + 1, y + 1, o.w - 2, o.h - 1);
          ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(216,180,254,0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let ly = y + 14; ly < G - 4; ly += 14) {
            ctx.moveTo(o.x + 6, ly);
            ctx.lineTo(o.x + o.w - 6, ly);
          }
          ctx.stroke();
          ctx.fillStyle = "#f5d0fe";
          ctx.fillRect(o.x, y - 1, o.w, 3);
          break;
        }
        case "laser": {
          const bottom = G - o.bottom;
          const flicker = 0.75 + Math.sin(this.time * 40) * 0.15 + Math.random() * 0.1;
          ctx.fillStyle = `rgba(255,45,85,${0.1 * flicker})`;
          ctx.fillRect(o.x, 0, o.w, bottom);
          ctx.strokeStyle = "rgba(255,45,85,0.25)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          for (let lx = o.x + 10; lx < o.x + o.w; lx += 16) {
            ctx.moveTo(lx, 0);
            ctx.lineTo(lx, bottom);
          }
          ctx.stroke();
          ctx.shadowColor = C_LASER;
          ctx.shadowBlur = 22;
          ctx.fillStyle = C_LASER;
          ctx.globalAlpha = flicker;
          ctx.fillRect(o.x - 4, bottom - 5, o.w + 8, 6);
          ctx.fillStyle = "#ffe4e6";
          ctx.fillRect(o.x - 4, bottom - 3, o.w + 8, 2);
          ctx.globalAlpha = 1;
          ctx.fillStyle = "#2a0710";
          ctx.fillRect(o.x - 8, bottom - 12, 8, 14);
          ctx.fillRect(o.x + o.w, bottom - 12, 8, 14);
          break;
        }
        case "saw": {
          const cx = o.x + o.r;
          ctx.strokeStyle = "rgba(251,146,60,0.3)";
          ctx.setLineDash([4, 6]);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, this.sy(o.base - o.amp - o.r));
          ctx.lineTo(cx, this.sy(o.base + o.amp + o.r));
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.translate(cx, this.sy(o.cy));
          ctx.rotate(-o.spin);
          ctx.shadowColor = C_SAW;
          ctx.shadowBlur = 18;
          ctx.fillStyle = "rgba(251,146,60,0.2)";
          ctx.strokeStyle = C_SAW;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          const teeth = 10;
          for (let i = 0; i < teeth * 2; i++) {
            const a = (i / (teeth * 2)) * Math.PI * 2;
            const rr = i % 2 === 0 ? o.r : o.r * 0.72;
            if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
            else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
          }
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#fed7aa";
          ctx.beginPath();
          ctx.arc(0, 0, 4, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
      }
      ctx.restore();
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D) {
    const p = this.player;
    const half = SIZE / 2;
    const avatar = this.avatar;
    const grounded = p.grounded || this.phase === "ready";
    const flipping = p.flipT >= 0;

    // pose: stride on the ground, jump arc in the air, tucked while flipping, crouch on landing
    let pose = grounded ? runPose(p.runPhase) : airPose(p.vy / JUMP_V);
    if (flipping) {
      const k = Math.min(1, p.flipT / FLIP_TIME);
      pose = lerpPose(pose, TUCK, Math.min(1, k / 0.2, (1 - k) / 0.2));
    }
    if (p.squash > 0) pose = lerpPose(pose, CROUCH, Math.min(1, p.squash / 0.8) * 0.85);
    const j = figureJoints(pose, grounded && !flipping);

    // body transform: box centre, somersault around the figure's middle, squash from the feet
    const cx = p.x + half;
    const cy = this.sy(p.y) - half;
    const pivotY = -4;
    // light squash only: the crouch pose carries the landing, and faces shouldn't warp
    const sq = flipping ? 0 : p.squash;
    const sx = 1 + sq * 0.06;
    const syScale = 1 - sq * 0.06;
    const cosR = Math.cos(p.rot);
    const sinR = Math.sin(p.rot);
    const toScreen = (x: number, y: number) => {
      const lx = x * sx;
      const ly = BODY.groundY + (y - BODY.groundY) * syScale - pivotY;
      return { x: cx + lx * cosR - ly * sinR, y: cy + pivotY + lx * sinR + ly * cosR };
    };
    const head = toScreen(j.head.x, j.head.y);
    const neck = toScreen(j.neck.x, j.neck.y);

    // ghost heads streaming behind a somersault
    if (this.phase === "playing") {
      p.trail.push({ x: head.x, y: this.groundY - head.y });
      if (p.trail.length > 6) p.trail.shift();
    }
    if (flipping) {
      p.trail.forEach((t, i) => {
        const a = (i + 1) / (p.trail.length + 1);
        ctx.save();
        ctx.globalAlpha = a * 0.25;
        ctx.translate(t.x, this.sy(t.y));
        drawHead(ctx, avatar, C_PLAYER, BODY.headR * (0.6 + a * 0.4));
        ctx.restore();
      });
    }

    const ghost = this.powers.ghost > 0;
    const color = ghost ? POWERS.ghost.color : C_PLAYER;
    let alpha = 1;
    if (ghost) alpha = this.powers.ghost < 1 && Math.floor(this.time * 10) % 2 ? 0.25 : 0.55;
    else if (this.invuln > 0) alpha = Math.floor(this.time * 14) % 2 ? 0.35 : 1;

    if (this.powers.magnet > 0 && this.phase === "playing") {
      ctx.save();
      ctx.strokeStyle = POWERS.magnet.color;
      ctx.globalAlpha = 0.35 + Math.sin(this.time * 8) * 0.1;
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = -this.time * 40;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(cx, cy - 4, 46, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    // scarf: drawn in world space so it always streams behind, even upside down
    const droop = grounded ? 0.45 : 0.45 + p.vy * 0.0022;
    const flutter = this.time * (10 + this.speed / 90);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = C_SCARF;
    ctx.shadowColor = C_SCARF;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(neck.x, neck.y);
    for (let i = 1; i <= 7; i++) {
      ctx.lineTo(neck.x - i * 4.3, neck.y + i * droop + Math.sin(flutter - i * 0.9) * (0.3 + i * 0.35));
    }
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy + pivotY);
    ctx.rotate(p.rot);
    ctx.translate(0, -pivotY);
    ctx.translate(0, BODY.groundY);
    ctx.scale(sx, syScale);
    ctx.translate(0, -BODY.groundY);
    if (this.powers.wings > 0) this.drawWings(ctx, j.shoulder, p.grounded ? 0.3 : 0.5 + Math.sin(this.time * 14) * 0.5);
    drawFigure(ctx, j, avatar, color);
    ctx.restore();
    ctx.restore();

    if (this.lives > 0) {
      // the extra life: a golden ring circling the runner
      ctx.save();
      ctx.translate(cx, cy + 2);
      ctx.rotate(-0.15);
      ctx.strokeStyle = "#fde047";
      ctx.shadowColor = "#fde047";
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 22, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      const a = this.time * 5;
      ctx.fillStyle = "#fff7c2";
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 22, Math.sin(a) * 7, 2.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    if (!p.grounded && p.airJumps > 0 && this.phase === "playing") {
      // one dot per air jump left
      ctx.save();
      ctx.fillStyle = "rgba(240,171,252,0.8)";
      ctx.beginPath();
      for (let i = 0; i < p.airJumps; i++) {
        ctx.moveTo(p.x + half + (i - (p.airJumps - 1) / 2) * 7 + 2.5, this.sy(p.y) + 8);
        ctx.arc(p.x + half + (i - (p.airJumps - 1) / 2) * 7, this.sy(p.y) + 8, 2.5, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.restore();
    }
  }

  private drawEffects(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const pt of this.particles) {
      const a = Math.max(0, pt.life / pt.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = pt.color;
      const s = pt.size * (pt.square ? 1 : 0.5 + a * 0.5);
      ctx.fillRect(pt.x - s / 2, this.sy(pt.y) - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    for (const r of this.rings) {
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = r.life / r.max;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(r.x, this.sy(r.y), r.r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.textAlign = "center";
    for (const t of this.texts) {
      const a = Math.min(1, (t.life / t.max) * 2);
      ctx.globalAlpha = a;
      ctx.font = `800 ${t.size}px ui-monospace, Menlo, monospace`;
      ctx.shadowColor = t.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = t.color;
      const y = t.screen ? t.y : this.sy(t.y);
      ctx.fillText(t.text, t.x, y);
    }
    ctx.restore();
  }

  private drawHud(ctx: CanvasRenderingContext2D) {
    const W = this.viewW;
    const top = Math.max(18, this.groundY - 470);
    ctx.save();
    ctx.translate(0, top - 18);
    ctx.textBaseline = "top";
    ctx.shadowColor = C_PLAYER;
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#ecfeff";
    ctx.font = "800 40px ui-monospace, Menlo, monospace";
    ctx.textAlign = "left";
    ctx.fillText(String(this.score()), 22, 18);

    ctx.shadowBlur = 0;
    ctx.font = "600 13px ui-monospace, Menlo, monospace";
    ctx.fillStyle = "rgba(236,254,255,0.6)";
    ctx.fillText(`BEST ${Math.max(this.best, this.score())}`, 24, 64);
    ctx.fillStyle = C_COIN;
    ctx.fillText(`◆ ${this.coinCount}`, 24, 84);

    // active power-ups: icon + time left
    let row = 0;
    const show = (kind: PowerKind, left: number | null, text = "") => {
      const y = 116 + row * 22;
      ctx.save();
      ctx.translate(31, y);
      drawPowerIcon(ctx, kind, 16);
      ctx.restore();
      if (left === null) {
        ctx.fillStyle = POWERS[kind].color;
        ctx.fillText(text, 46, y - 7);
      } else {
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(46, y - 2, 64, 4);
        ctx.fillStyle = POWERS[kind].color;
        ctx.fillRect(46, y - 2, 64 * left, 4);
      }
      row++;
    };
    if (this.lives > 0) show("life", null, `x${this.lives}`);
    for (const k of Object.keys(this.powers) as TimedPower[]) {
      if (this.powers[k] > 0) show(k, Math.min(1, this.powers[k] / POWERS[k].duration));
    }

    // speed meter
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(236,254,255,0.6)";
    ctx.fillText(`SPEED ${this.level}`, W - 70, 26);
    const bw = 120;
    const bx = W - 70 - bw;
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fillRect(bx, 46, bw, 4);
    ctx.fillStyle = `hsl(${this.hue},100%,65%)`;
    ctx.fillRect(bx, 46, bw * this.diff, 4);
    ctx.restore();
  }
}

/* =============================================================================
 * React hook
 * ========================================================================== */

export function useOneMoreRun(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  options: GameOptions = {},
): GameHud {
  const engineRef = useRef<Engine | null>(null);
  const optionsRef = useRef(options);
  const avatarRef = useRef<{ image: CanvasImageSource | null; colors: string[] }>({
    image: null,
    colors: [],
  });
  const [phase, setPhase] = useState<Phase>("ready");
  const [result, setResult] = useState<RunResult | null>(null);
  const [best, setBest] = useState(0);
  const [runs, setRuns] = useState(0);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, {
      onPhase: (ph, res) => {
        setPhase(ph);
        setResult(res);
      },
      onMeta: (b, r, m) => {
        setBest(b);
        setRuns(r);
        setMuted(m);
      },
      onRunStart: (run) => optionsRef.current.onRunStart?.(run),
      onRunEnd: (res) => optionsRef.current.onRunEnd?.(res),
    });
    engineRef.current = engine;
    engine.setAvatar(avatarRef.current.image, avatarRef.current.colors);
    engine.start();

    const blocked = () => optionsRef.current.inputBlockedRef?.current === true;
    const isUi = (target: EventTarget | null) =>
      target instanceof Element && target.closest("[data-ui]") !== null;
    const isEditable = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
    const isControl = (target: EventTarget | null) =>
      target instanceof Element && target.closest("button, a, [role='button']") !== null;

    const onPointerDown = (e: PointerEvent) => {
      if (blocked() || isUi(e.target)) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // tapping the game commits a half-typed name (preventDefault below would keep focus)
      const active = document.activeElement;
      if (isEditable(active)) (active as HTMLElement).blur();
      e.preventDefault();
      engine.press();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      // typing a name or using a dialog must never jump / restart / mute
      if (blocked() || isEditable(e.target)) return;
      if (e.code === "KeyM") {
        engine.toggleMute();
        return;
      }
      if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW" || e.code === "Enter") {
        // a focused button handles its own Space / Enter
        if ((e.code === "Space" || e.code === "Enter") && isControl(e.target)) return;
        e.preventDefault();
        if (!e.repeat) engine.press();
      }
    };
    const onPointerUp = () => engine.sfx.unlock();
    const onContextMenu = (e: Event) => e.preventDefault();
    const onResize = () => engine.resize();

    const ro = new ResizeObserver(onResize);
    ro.observe(canvas);
    window.addEventListener("pointerdown", onPointerDown, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("orientationchange", onResize);

    return () => {
      engine.destroy();
      ro.disconnect();
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("orientationchange", onResize);
      engineRef.current = null;
    };
  }, [canvasRef]);

  useEffect(() => {
    optionsRef.current = options;
  });

  const toggleMute = useCallback(() => engineRef.current?.toggleMute(), []);
  const setAvatar = useCallback((image: CanvasImageSource | null, colors: string[] = []) => {
    avatarRef.current = { image, colors };
    engineRef.current?.setAvatar(image, colors);
  }, []);

  return { phase, result, best, runs, muted, toggleMute, setAvatar };
}
