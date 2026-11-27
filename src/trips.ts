// Trip A and Trip B: two independent trip meters per car, like the ones on
// the instrument cluster. Each one can be started, paused and reset on its
// own and keeps its totals between sessions (saved per vehicle profile).
//
// Pure logic plus storage, no DOM. The live trip computer (trip.ts) feeds
// every reading to `advance`; only running meters add time, distance and
// fuel. Replayed recordings never touch them: a replay has its own
// temporary trip (see trip.ts).

export type TripId = "a" | "b";
export const TRIP_IDS: TripId[] = ["a", "b"];

export interface TripMeter {
  running: boolean;
  /** Seconds with live data while running. */
  timeS: number;
  distanceKm: number;
  fuelL: number;
  /** When it was last reset (ms since 1970). */
  since: number;
}

export type TripMeters = Record<TripId, TripMeter>;

export function newMeter(now = Date.now()): TripMeter {
  return { running: true, timeS: 0, distanceKm: 0, fuelL: 0, since: now };
}

/** Longest step counted (s): a longer gap means data was missing. */
export const MAX_STEP_S = 5;

/**
 * Adds one step of `dt` seconds at `speed` km/h and `lph` L/h (each may be
 * unknown) to every running meter.
 */
export function advance(meters: TripMeters, dt: number, speed?: number, lph?: number) {
  if (!(dt > 0 && dt < MAX_STEP_S)) return;
  for (const id of TRIP_IDS) {
    const m = meters[id];
    if (!m.running) continue;
    m.timeS += dt;
    if (speed !== undefined) m.distanceKm += (speed * dt) / 3600;
    if (lph !== undefined) m.fuelL += (lph * dt) / 3600;
  }
}

export function resetMeter(meters: TripMeters, id: TripId, now = Date.now()) {
  meters[id] = { ...newMeter(now), running: meters[id].running };
}

/** Average consumption in km/L, once there is enough to be meaningful. */
export function average(m: TripMeter): number | undefined {
  return m.fuelL > 0.001 && m.distanceKm > 0.1 ? m.distanceKm / m.fuelL : undefined;
}

/** Minimum counted time (s) before the average speed is shown. */
export const MIN_SPEED_TIME_S = 30;

/**
 * Average speed in km/h: distance divided by the counted time (time with the
 * engine running and data coming, so stops in traffic lower it, as on the
 * car's own trip computer).
 */
export function averageSpeed(m: Pick<TripMeter, "timeS" | "distanceKm">): number | undefined {
  return m.timeS >= MIN_SPEED_TIME_S ? m.distanceKm / (m.timeS / 3600) : undefined;
}

const key = (profileId: string) => `trips:${profileId}`;

function valid(m: unknown): m is TripMeter {
  const x = m as TripMeter;
  return !!x && typeof x.running === "boolean" && [x.timeS, x.distanceKm, x.fuelL, x.since].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0);
}

export function loadMeters(profileId: string, store: Pick<Storage, "getItem"> = localStorage): TripMeters {
  try {
    const raw = JSON.parse(store.getItem(key(profileId)) ?? "null") as Partial<TripMeters> | null;
    return { a: valid(raw?.a) ? raw.a : newMeter(), b: valid(raw?.b) ? raw.b : newMeter() };
  } catch {
    return { a: newMeter(), b: newMeter() };
  }
}

export function saveMeters(profileId: string, meters: TripMeters, store: Pick<Storage, "setItem"> = localStorage) {
  try {
    store.setItem(key(profileId), JSON.stringify(meters));
  } catch {
    /* kept for this session only */
  }
}
