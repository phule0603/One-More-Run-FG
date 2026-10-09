import { describe, expect, it } from "vitest";
import {
  airPose,
  BODY,
  CROUCH,
  figureJoints,
  lerpPose,
  runPose,
  TUCK,
  type Point,
} from "@/lib/character";

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

describe("runner figure", () => {
  it("keeps a foot on the ground through the whole stride", () => {
    for (let i = 0; i < 24; i++) {
      const j = figureJoints(runPose((i / 24) * Math.PI * 2), true);
      expect(Math.max(j.footF.y, j.footB.y)).toBeCloseTo(BODY.groundY, 6);
    }
  });

  it("drops the body into a crouch on landing", () => {
    const standing = figureJoints(runPose(0), true);
    const crouched = figureJoints(CROUCH, true);
    expect(crouched.hip.y).toBeGreaterThan(standing.hip.y + 3);
    expect(Math.max(crouched.footF.y, crouched.footB.y)).toBeCloseTo(BODY.groundY, 6);
  });

  it("keeps limb lengths in every pose", () => {
    for (const pose of [runPose(1), airPose(1), airPose(0), airPose(-1), TUCK, CROUCH]) {
      const j = figureJoints(pose, false);
      expect(dist(j.hip, j.kneeF)).toBeCloseTo(BODY.thigh, 6);
      expect(dist(j.kneeB, j.footB)).toBeCloseTo(BODY.shin, 6);
      expect(dist(j.shoulder, j.elbowF)).toBeCloseTo(BODY.upperArm, 6);
      expect(dist(j.elbowB, j.handB)).toBeCloseTo(BODY.foreArm, 6);
    }
  });

  it("tucks the knees up for the somersault", () => {
    const tuck = figureJoints(TUCK, false);
    // knees come up above the hip, feet pulled in close
    expect(tuck.kneeF.y).toBeLessThan(tuck.hip.y);
    expect(dist(tuck.hip, tuck.footF)).toBeLessThan(BODY.thigh);
  });

  it("throws the arms up at take-off and reaches the legs down when falling", () => {
    const rise = figureJoints(airPose(1), false);
    const fall = figureJoints(airPose(-1), false);
    expect(rise.handF.y).toBeLessThan(rise.shoulder.y);
    expect(fall.footF.y).toBeGreaterThan(rise.footF.y);
  });

  it("interpolates poses linearly", () => {
    const mid = lerpPose(TUCK, CROUCH, 0.5);
    expect(mid.thighF).toBeCloseTo((TUCK.thighF + CROUCH.thighF) / 2, 9);
    expect(mid.lean).toBeCloseTo((TUCK.lean + CROUCH.lean) / 2, 9);
  });
});
