/*
 * Power-ups ("gifts"). They only ever help the runner, never change how the
 * score is computed (so the leaderboard check stays valid), and are placed in
 * the gap between obstacle patterns at running height, so grabbing one never
 * forces a risky jump.
 */

export type PowerKind = "magnet" | "ghost" | "life" | "slow" | "wings";

export interface PowerSpec {
  label: string;
  /** seconds; 0 = instant / until used */
  duration: number;
  /** relative spawn weight */
  weight: number;
  color: string;
}

export const POWERS: Record<PowerKind, PowerSpec> = {
  magnet: { label: "MAGNET", duration: 8, weight: 3, color: "#fca5a5" },
  ghost: { label: "GHOST", duration: 4, weight: 1.6, color: "#c4b5fd" },
  life: { label: "+1 LIFE", duration: 0, weight: 1.4, color: "#fb7185" },
  slow: { label: "SLOW-MO", duration: 5, weight: 2, color: "#7dd3fc" },
  wings: { label: "TRIPLE JUMP", duration: 10, weight: 2, color: "#f0abfc" },
};

export const POWER_KINDS = Object.keys(POWERS) as PowerKind[];

/** Gift frame colour: green reads as "good" next to the warm/purple hazards. */
export const GIFT_COLOR = "#34d399";

export const MAGNET_RADIUS = 170;
export const SLOW_FACTOR = 0.65;
export const MAX_LIVES = 1;
export const SAVE_INVULN = 1.5; // seconds of invulnerability after a life is used
export const FIRST_GIFT = [7, 10] as const; // seconds into a run
export const GIFT_EVERY = [14, 22] as const; // seconds between gifts

/** Weighted pick; kinds with zero weight (e.g. a second life) are skipped. */
export function pickPower(random: () => number, weightOf: (k: PowerKind) => number = (k) => POWERS[k].weight): PowerKind {
  const total = POWER_KINDS.reduce((s, k) => s + weightOf(k), 0);
  let roll = random() * total;
  for (const k of POWER_KINDS) {
    roll -= weightOf(k);
    if (roll < 0) return k;
  }
  return "magnet";
}

/** Small neon icon for a power, centred on the origin, about `s` units across. */
export function drawPowerIcon(ctx: CanvasRenderingContext2D, kind: PowerKind, s: number) {
  const c = POWERS[kind].color;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = c;
  ctx.fillStyle = c;
  ctx.lineWidth = s * 0.14;
  switch (kind) {
    case "magnet": {
      ctx.beginPath();
      ctx.arc(0, -s * 0.05, s * 0.3, Math.PI, 0, true);
      ctx.moveTo(-s * 0.3, -s * 0.05);
      ctx.lineTo(-s * 0.3, -s * 0.38);
      ctx.moveTo(s * 0.3, -s * 0.05);
      ctx.lineTo(s * 0.3, -s * 0.38);
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-s * 0.38, -s * 0.48, s * 0.16, s * 0.14);
      ctx.fillRect(s * 0.22, -s * 0.48, s * 0.16, s * 0.14);
      break;
    }
    case "ghost": {
      const w = s * 0.36;
      ctx.beginPath();
      ctx.arc(0, -s * 0.08, w, Math.PI, 0);
      ctx.lineTo(w, s * 0.38);
      for (let i = 0; i < 3; i++) {
        const x = w - ((i + 0.5) * 2 * w) / 3;
        ctx.quadraticCurveTo(x, s * 0.2, x - w / 3, s * 0.38);
      }
      ctx.closePath();
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#1e1b4b";
      ctx.beginPath();
      ctx.arc(-s * 0.12, -s * 0.06, s * 0.07, 0, Math.PI * 2);
      ctx.arc(s * 0.14, -s * 0.06, s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case "life": {
      const r = s * 0.2;
      ctx.beginPath();
      ctx.moveTo(0, s * 0.38);
      ctx.bezierCurveTo(-s * 0.55, 0, -r, -s * 0.42, 0, -s * 0.15);
      ctx.bezierCurveTo(r, -s * 0.42, s * 0.55, 0, 0, s * 0.38);
      ctx.fill();
      break;
    }
    case "slow": {
      const w = s * 0.28;
      const h = s * 0.4;
      ctx.beginPath();
      ctx.moveTo(-w, -h);
      ctx.lineTo(w, -h);
      ctx.lineTo(-w, h);
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-w * 0.55, h * 0.75);
      ctx.lineTo(w * 0.55, h * 0.75);
      ctx.lineTo(0, h * 0.2);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "wings": {
      for (const side of [-1, 1]) {
        ctx.save();
        ctx.scale(side, 1);
        ctx.beginPath();
        ctx.moveTo(s * 0.04, s * 0.12);
        ctx.quadraticCurveTo(s * 0.18, -s * 0.42, s * 0.48, -s * 0.3);
        ctx.quadraticCurveTo(s * 0.34, -s * 0.12, s * 0.42, -s * 0.02);
        ctx.quadraticCurveTo(s * 0.28, 0, s * 0.34, s * 0.14);
        ctx.quadraticCurveTo(s * 0.18, s * 0.14, s * 0.04, s * 0.12);
        ctx.fill();
        ctx.restore();
      }
      break;
    }
  }
  ctx.restore();
}

/** A gift: a glowing green capsule with the power's icon, centred on the origin. */
export function drawGift(ctx: CanvasRenderingContext2D, kind: PowerKind, r: number, t: number) {
  ctx.save();
  ctx.shadowColor = GIFT_COLOR;
  ctx.shadowBlur = 18;
  ctx.fillStyle = "rgba(6,40,30,0.85)";
  ctx.strokeStyle = GIFT_COLOR;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6 + Math.sin(t * 2) * 0.08;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowBlur = 0;
  drawPowerIcon(ctx, kind, r * 1.25);
  ctx.restore();
}
