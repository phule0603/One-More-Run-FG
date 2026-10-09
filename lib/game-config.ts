/**
 * Gameplay constants shared by the client engine and the server-side score
 * validation. Changing any of these changes what the leaderboard accepts.
 */

/** World speed (units/s) at the start of a run, on a 16:9 screen. */
export const BASE_SPEED = 380;
/** Speed the run asymptotically ramps up to. */
export const MAX_SPEED = 940;
/** Seconds for ~63% of the speed ramp. */
export const RAMP_TIME = 75;

/** Score: 1 point per metre (12 world units) plus a bonus per coin. */
export const METERS_PER_UNIT = 1 / 12;
export const COIN_VALUE = 10;
