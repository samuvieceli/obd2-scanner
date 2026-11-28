// Trip computer (fuel use and distance), computed from live values.
//
// Fuel flow comes, in order of preference, from:
// 1. PID 5E (engine fuel rate, L/h) when the car reports it;
// 2. the MAF sensor (g/s of air) divided by the air/fuel ratio;
// 3. "speed-density" for cars with a MAP sensor and no MAF (very common in
//    Brazil): air mass = rpm × displacement × efficiency × pressure / (R × T).
// Ethanol content from PID 52 is used for flex cars when available.
import { emit, isSupported, on, pushCalculated, recentValues, state } from "./store";
import { prefs, profile, saveProfile } from "./prefs";
import { fuelProps as propsOf, type FuelProps } from "./fuels";
import { advanceFill, closeFill, detectMethod, loadFill, saveFill, startFill, type FillResult, type FillTracker } from "./refuel";
import { advance, loadMeters, resetMeter, saveMeters, type TripId, type TripMeters } from "./trips";

/** Air/fuel ratio and density of the fuel in the tank (see fuels.ts). */
function fuelProps(): FuelProps {
  return propsOf(profile().fuel, state.latest.ethanol_percent, prefs().fuelRegion);
}

/**
 * Air mass flow in g/s, before the pump calibration (refuel.ts): from the MAF
 * sensor, or estimated from MAP with a volumetric efficiency of 100%.
 */
function baseAir(v: Record<string, number>): { air: number; method: "maf" | "map" } | undefined {
  if (v.maf !== undefined) return { air: v.maf, method: "maf" };
  if (v.rpm === undefined || v.intake_map === undefined || v.intake_temp === undefined) return undefined;
  const p = profile();
  const tK = v.intake_temp + 273.15;
  const rho = (v.intake_map * 1000) / (287.05 * tK); // kg/m³
  const m3PerS = (v.rpm / 120) * (p.displacementL / 1000);
  return { air: rho * m3PerS * 1000, method: "map" };
}

/** The correction in use for a calculation: volumetric efficiency or MAF factor. */
export function correction(method: "maf" | "map"): number {
  const p = profile();
  return method === "map" ? p.volumetricEff : p.mafFactor;
}

/** Fuel flow in L/h before the correction, with the calculation used. */
function baseFlow(v: Record<string, number>): { lph: number; method: "maf" | "map" } | undefined {
  const b = baseAir(v);
  if (!b) return undefined;
  const { afr, density } = fuelProps();
  return { lph: ((b.air / afr) * 3600) / density, method: b.method };
}

/** Air mass flow in g/s from the MAF sensor or estimated from MAP. */
export function airFlow(v: Record<string, number>): number | undefined {
  const b = baseAir(v);
  return b && b.air * correction(b.method);
}

/** Fuel flow in L/h, or undefined when the needed values are missing. */
export function fuelFlow(v: Record<string, number>): number | undefined {
  if (v.fuel_rate !== undefined) return v.fuel_rate;
  const b = baseFlow(v);
  return b && b.lph * correction(b.method);
}

/** Instant economy in km/L: only when moving and burning fuel. */
function economy(lph: number | undefined, speed: number | undefined): number | undefined {
  return lph !== undefined && speed !== undefined && speed > 3 && lph > 0.05 ? speed / lph : undefined;
}

/** Calculated parameters (calc.ts) for one set of car values. */
export function calcValues(v: Record<string, number>): Record<string, number | undefined> {
  const lph = fuelFlow(v);
  return { calc_fuel_flow: lph, calc_economy: economy(lph, v.speed) };
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

// --- Pump calibration ("Tanque cheio" / "Abasteci", see refuel.ts) ----------

let fillFor = "";
let fill: FillTracker | null = null;

/** The running pump calibration of the active profile, if any. */
export function fillTracker(): FillTracker | null {
  const id = profile().id;
  if (fillFor !== id) {
    if (fillFor) saveFill(fillFor, fill);
    fill = loadFill(id);
    fillFor = id;
  }
  return fill;
}

/** Whether this profile offers the pump calibration, and for which calculation. */
export function calibrationMethod(): "maf" | "map" | null {
  const m = profile().fuelMethod;
  return m === "maf" || m === "map" ? m : null;
}

/** "Tanque cheio": starts adding up the calculated litres. */
export function startFillTracker() {
  const method = calibrationMethod();
  if (!method) return;
  fillTracker();
  fill = startFill(method);
  persist();
  emit("trip");
}

export function cancelFill() {
  fillTracker();
  fill = null;
  persist();
  emit("trip");
}

/**
 * "Abasteci": compares the pump litres with the calculation, updates the
 * correction when the result is trustworthy and starts the next tank.
 */
export function finishFill(pumpL: number): FillResult | null {
  const f = fillTracker();
  if (!f) return null;
  const p = profile();
  const { result, correction: next } = closeFill(f, pumpL, correction(f.method), p.fills);
  const change: Partial<typeof p> = { fills: [...p.fills, result].slice(-20) };
  if (next !== undefined) {
    if (f.method === "map") change.volumetricEff = Math.round(next * 1000) / 1000;
    else change.mafFactor = Math.round(next * 1000) / 1000;
  }
  saveProfile(change);
  // The tank is full again: the next comparison starts here.
  fill = startFill(f.method);
  persist();
  emit("profile");
  return result;
}

/** Fills that shaped the current correction (0 = not calibrated yet). */
export function calibratedFills(method: "maf" | "map"): number {
  return profile().fills.filter((r) => r.used && r.method === method).length;
}

/** "Restaurar padrão": back to the default correction, forgetting the fills. */
export function resetCalibration(method: "maf" | "map") {
  const p = profile();
  saveProfile({ ...(method === "map" ? { volumetricEff: 0.85 } : { mafFactor: 1 }), fills: p.fills.filter((r) => r.method !== method) });
  emit("profile");
}

/** Learns which calculation the connected car allows (shown in its profile). */
function learnMethod() {
  if (state.connection !== "connected" || !state.adapter || state.playback) return;
  const method = detectMethod(isSupported);
  if (method && method !== profile().fuelMethod) {
    saveProfile({ fuelMethod: method });
    emit("profile");
  }
}

function persist() {
  if (tripMeters) saveMeters(metersFor, tripMeters);
  if (fillFor) saveFill(fillFor, fill);
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
  const base = v.fuel_rate === undefined ? baseFlow(v) : undefined;
  const lph = v.fuel_rate ?? (base && base.lph * correction(base.method));
  trip.lph = lph;
  trip.source = v.fuel_rate !== undefined ? "pid" : v.maf !== undefined ? "maf" : lph !== undefined ? "map" : null;
  const speed = v.speed;
  trip.kmpl = economy(lph, speed);
  // Kept like a car value so the Charts screen can draw it.
  pushCalculated(t, { calc_fuel_flow: lph, calc_economy: trip.kmpl });
  if (state.playback) {
    if (dt > 0 && dt < 5) {
      trip.timeS += dt;
      if (speed !== undefined) trip.distanceKm += (speed * dt) / 3600;
      if (lph !== undefined) trip.fuelL += (lph * dt) / 3600;
    }
  } else {
    advance(meters(), dt, speed, lph);
    const f = fillTracker();
    if (f) advanceFill(f, dt, speed, base && base.method === f.method ? base.lph : undefined);
    if (Date.now() - lastSave > SAVE_EVERY_MS) persist();
  }

  emit("trip");
}

export function initTrip() {
  on("frame", onFrame);
  on("connection", () => {
    learnMethod();
    if (state.connection !== "connected") {
      lastT = null;
      persist();
    }
  });
  on("profile", () => {
    learnMethod();
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
