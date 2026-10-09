/*
 * The runner: a chibi neon figure whose head is the player's photo.
 *
 * Coordinates are relative to the centre of the player's 34×34 physics box,
 * canvas-style (y grows downwards), so the ground is at y = +17. Limb angles are
 * radians from straight down; positive swings forward (towards +x, the running
 * direction). The figure is purely visual: collisions still use the box.
 */

export interface Pose {
  thighF: number;
  /** knee bend, folds the shin backwards (shin angle = thigh - knee) */
  kneeF: number;
  thighB: number;
  kneeB: number;
  armF: number;
  /** elbow bend, folds the forearm forwards (forearm angle = arm + elbow) */
  elbowF: number;
  armB: number;
  elbowB: number;
  /** forward tilt of the upper body around the hip */
  lean: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Joints {
  hip: Point;
  kneeF: Point;
  footF: Point;
  kneeB: Point;
  footB: Point;
  shoulder: Point;
  elbowF: Point;
  handF: Point;
  elbowB: Point;
  handB: Point;
  neck: Point;
  head: Point;
  lean: number;
}

export const BODY = {
  groundY: 17,
  hipY: 3,
  shoulderY: -6,
  headY: -15.5,
  headR: 10,
  thigh: 7,
  shin: 7,
  upperArm: 6,
  foreArm: 5.5,
} as const;

const KEYS: (keyof Pose)[] = ["thighF", "kneeF", "thighB", "kneeB", "armF", "elbowF", "armB", "elbowB", "lean"];

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = { ...a };
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/** Running stride; `phase` advances one full turn per stride. Arms swing against the legs. */
export function runPose(phase: number): Pose {
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  return {
    thighF: 0.75 * s,
    kneeF: 0.2 + 1.3 * Math.max(0, c), // the leg swinging forward lifts its foot
    thighB: -0.75 * s,
    kneeB: 0.2 + 1.3 * Math.max(0, -c),
    armF: -0.85 * s,
    elbowF: 1.2,
    armB: 0.85 * s,
    elbowB: 1.2,
    lean: 0.14,
  };
}

const RISE: Pose = { thighF: 1.25, kneeF: 1.7, thighB: -0.35, kneeB: 1.0, armF: 2.8, elbowF: 0.25, armB: 2.4, elbowB: 0.35, lean: 0.06 };
const APEX: Pose = { thighF: 1.0, kneeF: 1.5, thighB: 0.35, kneeB: 1.3, armF: 1.7, elbowF: 0.6, armB: 1.3, elbowB: 0.6, lean: 0.1 };
const FALL: Pose = { thighF: 0.45, kneeF: 0.5, thighB: -0.2, kneeB: 0.45, armF: 2.0, elbowF: 0.35, armB: -0.7, elbowB: 0.5, lean: 0.02 };

/** Jump: arms thrown up and a knee driven up on the way up, legs reaching down on the way down. */
export function airPose(rise: number): Pose {
  return rise >= 0 ? lerpPose(APEX, RISE, Math.min(1, rise)) : lerpPose(APEX, FALL, Math.min(1, -rise));
}

/** Somersault: knees to the chest, hands on the shins. */
export const TUCK: Pose = { thighF: 2.3, kneeF: 2.6, thighB: 2.1, kneeB: 2.5, armF: 1.2, elbowF: -0.8, armB: 1.0, elbowB: -0.7, lean: 0.25 };

/** Landing: deep knees, arms forward for balance. */
export const CROUCH: Pose = { thighF: 1.0, kneeF: 2.0, thighB: 0.5, kneeB: 1.7, armF: 0.7, elbowF: 0.9, armB: -0.5, elbowB: 0.8, lean: 0.3 };

const dir = (angle: number, len: number): Point => ({ x: Math.sin(angle) * len, y: Math.cos(angle) * len });
const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });

/** Joint positions for a pose. When `grounded`, the body drops until the lowest foot is on the ground. */
export function figureJoints(pose: Pose, grounded: boolean): Joints {
  const hip = { x: 0, y: BODY.hipY };
  const kneeF = add(hip, dir(pose.thighF, BODY.thigh));
  const footF = add(kneeF, dir(pose.thighF - pose.kneeF, BODY.shin));
  const kneeB = add(hip, dir(pose.thighB, BODY.thigh));
  const footB = add(kneeB, dir(pose.thighB - pose.kneeB, BODY.shin));

  // upper body, built upright, then leaned forward around the hip
  const cos = Math.cos(pose.lean);
  const sin = Math.sin(pose.lean);
  const lean = (p: Point): Point => {
    const x = p.x - hip.x;
    const y = p.y - hip.y;
    return { x: hip.x + x * cos - y * sin, y: hip.y + x * sin + y * cos };
  };
  const shoulderUp = { x: 0, y: BODY.shoulderY };
  const elbowFUp = add(shoulderUp, dir(pose.armF, BODY.upperArm));
  const elbowBUp = add(shoulderUp, dir(pose.armB, BODY.upperArm));
  const joints: Joints = {
    hip,
    kneeF,
    footF,
    kneeB,
    footB,
    shoulder: lean(shoulderUp),
    elbowF: lean(elbowFUp),
    handF: lean(add(elbowFUp, dir(pose.armF + pose.elbowF, BODY.foreArm))),
    elbowB: lean(elbowBUp),
    handB: lean(add(elbowBUp, dir(pose.armB + pose.elbowB, BODY.foreArm))),
    neck: lean({ x: 0, y: BODY.shoulderY - 2 }),
    head: lean({ x: 0, y: BODY.headY }),
    lean: pose.lean,
  };

  if (grounded) {
    const drop = BODY.groundY - Math.max(footF.y, footB.y);
    for (const key of Object.keys(joints) as (keyof Joints)[]) {
      const p = joints[key];
      if (typeof p === "object") p.y += drop;
    }
  }
  return joints;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Draws the head (photo or neon visor) centred on the origin. */
export function drawHead(
  ctx: CanvasRenderingContext2D,
  avatar: CanvasImageSource | null,
  color: string,
  r: number = BODY.headR,
) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = "#083344";
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  if (avatar) {
    ctx.save();
    ctx.clip();
    ctx.drawImage(avatar, -r, -r, r * 2, r * 2);
    ctx.restore();
  } else {
    // default face: a glowing visor looking ahead
    ctx.shadowColor = color;
    ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    roundRect(ctx, -r * 0.1, -r * 0.38, r * 0.9, r * 0.56, r * 0.28);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#ecfeff";
    ctx.fillRect(r * 0.12, -r * 0.2, r * 0.45, r * 0.12);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.arc(0, 0, r - 1.1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

/** Draws the whole figure in the current transform (origin = physics box centre). */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  j: Joints,
  avatar: CanvasImageSource | null,
  color: string,
) {
  const poly = (...pts: Point[]) => {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // far-side limbs, dimmer for depth (relative to any alpha the caller set)
  const baseAlpha = ctx.globalAlpha;
  ctx.globalAlpha = baseAlpha * 0.5;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  poly(j.hip, j.kneeB, j.footB);
  poly(j.shoulder, j.elbowB, j.handB);
  ctx.stroke();
  ctx.globalAlpha = baseAlpha;

  // torso: neon-outlined capsule
  ctx.shadowColor = color;
  ctx.shadowBlur = 14;
  ctx.lineWidth = 10;
  ctx.beginPath();
  poly(j.shoulder, j.hip);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "#083344";
  ctx.lineWidth = 6;
  ctx.stroke();

  // near-side limbs
  ctx.shadowBlur = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 3.6;
  ctx.beginPath();
  poly(j.hip, j.kneeF, j.footF);
  poly(j.shoulder, j.elbowF, j.handF);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(j.head.x, j.head.y);
  ctx.rotate(j.lean * 0.5);
  drawHead(ctx, avatar, color);
  ctx.restore();
}
