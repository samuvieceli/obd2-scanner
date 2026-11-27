// Calibration of the calculated consumption at the pump ("ajuste pelo
// abastecimento"). Pure logic plus storage, no DOM.
//
// How it works: the driver fills the tank until the nozzle clicks and presses
// "Tanque cheio". From then on the trip computer adds up the litres it
// calculates. At the next full fill the driver types the litres the pump
// showed; the ratio between the two corrects the calculation:
//
// - car with only a MAP sensor (speed-density): the correction is the
//   volumetric efficiency itself, the one number the formula guesses;
// - car with a MAF sensor: a general correction factor, for a dirty or aged
//   MAF sensor (offered under "Avançado" in the vehicle profile).
//
// Cars that report the fuel rate (PID 5E) are not calibrated: that value
// comes from the engine computer itself.
//
// The tracker counts "base" litres: the litres the formula gives with a
// correction of 1 (100%). So changing the correction by hand in the middle
// of a tank does not spoil the comparison.

/** Which calculation the car allows, in order of precision. */
export type FuelMethod = "pid" | "maf" | "map";

/** The calculation a car with these parameters uses (same order as trip.ts). */
export function detectMethod(has: (key: string) => boolean): FuelMethod | null {
  if (has("fuel_rate")) return "pid";
  if (has("maf")) return "maf";
  if (has("rpm") && has("intake_map") && has("intake_temp")) return "map";
  return null;
}

/** Litres added up since "Tanque cheio". */
export interface FillTracker {
  /** When the tank was filled (ms since 1970). */
  since: number;
  /** The calculation being calibrated. */
  method: "maf" | "map";
  /** Seconds with live data. */
  timeS: number;
  distanceKm: number;
  /** Litres at a correction of 1 (see the file header). */
  baseL: number;
  /** Seconds with the engine read but no fuel flow from `method` (data gaps). */
  missingS: number;
}

export function startFill(method: "maf" | "map", now = Date.now()): FillTracker {
  return { since: now, method, timeS: 0, distanceKm: 0, baseL: 0, missingS: 0 };
}

/** Longest step counted (s), as in trips.ts. */
const MAX_STEP_S = 5;

/**
 * Adds one step: `baseLph` is the fuel flow at a correction of 1, or
 * undefined when the calculation being calibrated had no data.
 */
export function advanceFill(f: FillTracker, dt: number, speed: number | undefined, baseLph: number | undefined) {
  if (!(dt > 0 && dt < MAX_STEP_S)) return;
  f.timeS += dt;
  if (speed !== undefined) f.distanceKm += (speed * dt) / 3600;
  if (baseLph !== undefined) f.baseL += (baseLph * dt) / 3600;
  else f.missingS += dt;
}

/** Below these, the comparison is too short to trust. */
export const MIN_KM = 50;
export const MIN_CALC_L = 3;
/** More than this share of time without fuel data: the result is discarded. */
export const MAX_MISSING = 0.05;
/** Accepted range of the correction, per method. */
export const LIMITS: Record<"maf" | "map", [number, number]> = { map: [0.5, 1.2], maf: [0.7, 1.3] };
/** Fills averaged into the correction. */
export const HISTORY = 5;

export type FillReason = "short" | "gaps" | "outOfRange";

/** One fill compared with the calculation, kept in the vehicle profile. */
export interface FillResult {
  at: number;
  method: "maf" | "map";
  distanceKm: number;
  pumpL: number;
  /** What the program had calculated, with the correction in use then. */
  calcL: number;
  /** Correction this fill alone suggests. */
  estimate: number;
  /** False when discarded; `reason` says why. */
  used: boolean;
  reason?: FillReason;
}

/**
 * Closes a tank: compares the pump litres with the calculation and returns
 * the result plus the new correction (undefined when the fill is discarded).
 * The new correction is the distance-weighted average of the last accepted
 * fills of the same method, so one odd tank does not spoil it.
 */
export function closeFill(
  f: FillTracker,
  pumpL: number,
  current: number,
  history: FillResult[],
  now = Date.now(),
): { result: FillResult; correction: number | undefined } {
  const calcL = f.baseL * current;
  const estimate = f.baseL > 0 ? pumpL / f.baseL : 0;
  const [lo, hi] = LIMITS[f.method];
  const reason: FillReason | undefined =
    f.distanceKm < MIN_KM || calcL < MIN_CALC_L
      ? "short"
      : f.timeS > 0 && f.missingS / f.timeS > MAX_MISSING
        ? "gaps"
        : estimate < lo || estimate > hi
          ? "outOfRange"
          : undefined;
  const result: FillResult = { at: now, method: f.method, distanceKm: f.distanceKm, pumpL, calcL, estimate, used: !reason, ...(reason ? { reason } : {}) };
  if (reason) return { result, correction: undefined };
  const used = [...history.filter((r) => r.used && r.method === f.method), result].slice(-HISTORY);
  const km = used.reduce((s, r) => s + r.distanceKm, 0);
  const correction = used.reduce((s, r) => s + r.estimate * r.distanceKm, 0) / km;
  return { result, correction: Math.min(hi, Math.max(lo, correction)) };
}

// --- storage (one tracker per vehicle profile) --------------------------------

const key = (profileId: string) => `fill:${profileId}`;

function valid(x: unknown): x is FillTracker {
  const f = x as FillTracker;
  return (
    !!f &&
    (f.method === "maf" || f.method === "map") &&
    [f.since, f.timeS, f.distanceKm, f.baseL, f.missingS].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0)
  );
}

export function loadFill(profileId: string, store: Pick<Storage, "getItem"> = localStorage): FillTracker | null {
  try {
    const raw: unknown = JSON.parse(store.getItem(key(profileId)) ?? "null");
    return valid(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function saveFill(profileId: string, f: FillTracker | null, store: Pick<Storage, "setItem" | "removeItem"> = localStorage) {
  try {
    if (f) store.setItem(key(profileId), JSON.stringify(f));
    else store.removeItem(key(profileId));
  } catch {
    /* kept for this session only */
  }
}
