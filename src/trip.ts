// Trip computer and performance timer, computed from live values.
//
// Fuel flow comes, in order of preference, from:
// 1. PID 5E (engine fuel rate, L/h) when the car reports it;
// 2. the MAF sensor (g/s of air) divided by the air/fuel ratio;
// 3. "speed-density" for cars with a MAP sensor and no MAF (very common in
//    Brazil): air mass = rpm × displacement × efficiency × pressure / (R × T).
// Ethanol content from PID 52 is used for flex cars when available.
import { emit, on, state } from "./store";
import { prefs, type FuelType } from "./prefs";

/** Stoichiometric air/fuel ratio and density (g/L) of each fuel. */
const FUELS: Record<Exclude<FuelType, "auto">, { afr: number; density: number }> = {
  gasoline_pure: { afr: 14.7, density: 745 },
  gasoline_e27: { afr: 13.2, density: 754 },
  ethanol: { afr: 8.4, density: 809 },
  diesel: { afr: 14.5, density: 832 },
};

/** Air/fuel ratio and density, interpolated by ethanol share for flex cars. */
function fuelProps(): { afr: number; density: number } {
  const p = prefs();
  if (p.fuel !== "auto") return FUELS[p.fuel];
  const e = state.latest.ethanol_percent;
  if (e === undefined) return FUELS.gasoline_e27;
  const f = Math.max(0, Math.min(1, e / 100));
  const g = FUELS.gasoline_pure;
  const et = FUELS.ethanol;
  return { afr: g.afr + (et.afr - g.afr) * f, density: g.density + (et.density - g.density) * f };
}

/** Air mass flow in g/s from the MAF sensor or estimated from MAP. */
export function airFlow(v: Record<string, number>): number | undefined {
  if (v.maf !== undefined) return v.maf;
  if (v.rpm === undefined || v.intake_map === undefined || v.intake_temp === undefined) return undefined;
  const p = prefs();
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

export interface Run {
  /** Target speed in km/h. */
  target: number;
  state: "armed" | "running" | "done";
  startT?: number;
  resultS?: number;
}

export const trip: Trip = { timeS: 0, distanceKm: 0, fuelL: 0, source: null };
export const run: Run = { target: 100, state: "done" };

let lastT: number | null = null;
let lastSpeed: number | null = null;

export function resetTrip() {
  trip.timeS = 0;
  trip.distanceKm = 0;
  trip.fuelL = 0;
  lastT = null;
  emit("trip");
}

/** Arms the 0-to-target timer: it starts when the car leaves standstill. */
export function armRun(target: number) {
  run.target = target;
  run.state = "armed";
  run.startT = undefined;
  run.resultS = undefined;
  emit("trip");
}

function onFrame() {
  const v = state.latest;
  const t = state.lastFrameT;
  if (t === undefined) return;
  const dt = lastT === null ? 0 : t - lastT;
  lastT = t;
  const lph = fuelFlow(v);
  trip.lph = lph;
  trip.source = v.fuel_rate !== undefined ? "pid" : v.maf !== undefined ? "maf" : lph !== undefined ? "map" : null;
  const speed = v.speed;
  trip.kmpl = lph !== undefined && speed !== undefined && speed > 3 && lph > 0.05 ? speed / lph : undefined;
  if (dt > 0 && dt < 5) {
    trip.timeS += dt;
    if (speed !== undefined) trip.distanceKm += (speed * dt) / 3600;
    if (lph !== undefined) trip.fuelL += (lph * dt) / 3600;
  }

  // Performance run: linear interpolation between frames for better timing.
  if (speed !== undefined) {
    if (run.state === "armed" && lastSpeed !== null && lastSpeed < 1 && speed >= 1) {
      run.state = "running";
      run.startT = t - (dt * (speed - 1)) / Math.max(speed - lastSpeed, 0.001);
    } else if (run.state === "running" && run.startT !== undefined) {
      if (speed >= run.target && lastSpeed !== null) {
        const frac = (run.target - lastSpeed) / Math.max(speed - lastSpeed, 0.001);
        run.resultS = t - dt + dt * frac - run.startT;
        run.state = "done";
      } else if (speed < 1) {
        run.state = "armed"; // stopped again: wait for a new start
      }
    }
    lastSpeed = speed;
  }
  emit("trip");
}

export function initTrip() {
  on("frame", onFrame);
  on("connection", () => {
    if (state.connection !== "connected") lastT = null;
  });
  // A new recording replay starts a new trip.
  let replaying = false;
  on("playback", () => {
    if (!!state.playback !== replaying) {
      replaying = !!state.playback;
      resetTrip();
    }
  });
}
