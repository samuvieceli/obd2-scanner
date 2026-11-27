// Trip computer (fuel use and distance), computed from live values.
//
// Fuel flow comes, in order of preference, from:
// 1. PID 5E (engine fuel rate, L/h) when the car reports it;
// 2. the MAF sensor (g/s of air) divided by the air/fuel ratio;
// 3. "speed-density" for cars with a MAP sensor and no MAF (very common in
//    Brazil): air mass = rpm × displacement × efficiency × pressure / (R × T).
// Ethanol content from PID 52 is used for flex cars when available.
import { emit, on, recentValues, state } from "./store";
import { profile } from "./prefs";
import { FUELS, flexProps, type FuelProps } from "./fuels";
import { advance, loadMeters, resetMeter, saveMeters, type TripId, type TripMeters } from "./trips";

/** Air/fuel ratio and density of the fuel in the tank (see fuels.ts). */
function fuelProps(): FuelProps {
  const p = profile();
  return p.fuel === "auto" ? flexProps(state.latest.ethanol_percent) : FUELS[p.fuel];
}

/** Air mass flow in g/s from the MAF sensor or estimated from MAP. */
export function airFlow(v: Record<string, number>): number | undefined {
  if (v.maf !== undefined) return v.maf;
  if (v.rpm === undefined || v.intake_map === undefined || v.intake_temp === undefined) return undefined;
  const p = profile();
  const tK = v.intake_temp + 273.15;
  const rho = (v.intake_map * 1000) / (287.05 * tK); // kg/m³
  const m3PerS = (v.rpm / 120) * (p.displacementL / 1000) * p.volumetricEff;
  return rho * m3PerS * 1000;
}

/** Fuel flow in L/h, or undefined when the needed values are missing. */
export function fuelFlow(v: Record<string, number>): number | undefined {
  if (v.fuel_rate !== undefined) return v.fuel_rate;
  const air = airFlow(v);
  if (air === undefined) return undefined;
  const { afr, density } = fuelProps();
  return ((air / afr) * 3600) / density;
}

export interface Trip {
  /** Seconds of live data in this trip. */
  timeS: number;
  distanceKm: number;
  fuelL: number;
  /** Instant values. */
  lph?: number;
  kmpl?: number;
  source: "pid" | "maf" | "map" | null;
}

/**
 * Instant values, plus the totals of a replayed recording (a replay never
 * touches Trip A/B: those count only real driving).
 */
export const trip: Trip = { timeS: 0, distanceKm: 0, fuelL: 0, source: null };

let lastT: number | null = null;

// --- Trip A / Trip B (saved per vehicle profile) -----------------------------

let metersFor = "";
let tripMeters: TripMeters | null = null;
let lastSave = 0;
const SAVE_EVERY_MS = 10_000;

/** Trip A and B of the active vehicle profile. */
export function meters(): TripMeters {
  const id = profile().id;
  if (!tripMeters || metersFor !== id) {
    if (tripMeters) saveMeters(metersFor, tripMeters);
    tripMeters = loadMeters(id);
    metersFor = id;
  }
  return tripMeters;
}

function persist() {
  if (tripMeters) saveMeters(metersFor, tripMeters);
  lastSave = Date.now();
}

export function setTripRunning(id: TripId, running: boolean) {
  meters()[id].running = running;
  persist();
  emit("trip");
}

export function resetTripMeter(id: TripId) {
  resetMeter(meters(), id);
  persist();
  emit("trip");
}

export function resetTrip() {
  trip.timeS = 0;
  trip.distanceKm = 0;
  trip.fuelL = 0;
  trip.lph = undefined;
  trip.kmpl = undefined;
  trip.source = null;
  lastT = null;
  emit("trip");
}

function onFrame() {
  // Only values still being read: no phantom distance or fuel from a speed
  // or air flow that stopped updating.
  const v = recentValues();
  const t = state.lastFrameT;
  if (t === undefined) return;
  const dt = lastT === null ? 0 : t - lastT;
  lastT = t;
  const lph = fuelFlow(v);
  trip.lph = lph;
  trip.source = v.fuel_rate !== undefined ? "pid" : v.maf !== undefined ? "maf" : lph !== undefined ? "map" : null;
  const speed = v.speed;
  trip.kmpl = lph !== undefined && speed !== undefined && speed > 3 && lph > 0.05 ? speed / lph : undefined;
  if (state.playback) {
    if (dt > 0 && dt < 5) {
      trip.timeS += dt;
      if (speed !== undefined) trip.distanceKm += (speed * dt) / 3600;
      if (lph !== undefined) trip.fuelL += (lph * dt) / 3600;
    }
  } else {
    advance(meters(), dt, speed, lph);
    if (Date.now() - lastSave > SAVE_EVERY_MS) persist();
  }

  emit("trip");
}

export function initTrip() {
  on("frame", onFrame);
  on("connection", () => {
    if (state.connection !== "connected") {
      lastT = null;
      persist();
    }
  });
  on("profile", () => {
    persist();
    lastT = null;
    emit("trip");
  });
  window.addEventListener("beforeunload", persist);
  // Jumping in a replay re-sends the frames from the start: count them once.
  on("seek", resetTrip);
  // A new recording replay starts a new trip. Going back to live data must
  // not count the time of the replay into Trip A/B either.
  let replaying = false;
  on("playback", () => {
    if (!!state.playback !== replaying) {
      replaying = !!state.playback;
      resetTrip();
    }
  });
}
