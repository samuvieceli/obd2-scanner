// User preferences kept in the browser storage of the app window.
// Every read falls back to defaults, so a blocked or empty storage is fine.
//
// Global preferences (units, alert switches, reconnection) apply to every
// car. Everything that depends on the car (fuel, engine size, alert limits,
// VIN) lives in a vehicle profile; one profile is active at a time and is
// picked automatically when a connected car's VIN matches a profile.
import type { Prices } from "./cost";
import type { UnitPrefs } from "./units";
import { emit } from "./store";
import { t } from "./i18n";

import { migrateFuel, type FuelType } from "./fuels";
export type { FuelType };

export interface AlertRule {
  key: string;
  /** Alert when the value goes below this (null = no lower limit). Metric units. */
  below: number | null;
  /** Alert when the value goes above this (null = no upper limit). Metric units. */
  above: number | null;
  enabled: boolean;
}

export interface Profile {
  id: string;
  name: string;
  /** Vehicle identification number, learned on the first connection. */
  vin: string | null;
  fuel: FuelType;
  /** Engine displacement in liters, for cars without a MAF sensor. */
  displacementL: number;
  /** Volumetric efficiency (0-1) used with the displacement. */
  volumetricEff: number;
  alerts: AlertRule[];
}

export interface Prefs {
  alertsEnabled: boolean;
  alertSound: boolean;
  /** Reopen the connection by itself when it drops. */
  autoReconnect: boolean;
  units: UnitPrefs;
  profiles: Profile[];
  activeProfile: string;
  /** Price per litre at the pump, for the trip cost (null = not given). */
  fuelPrices: Prices;
}

export const DEFAULT_ALERTS: AlertRule[] = [
  { key: "coolant_temp", below: null, above: 110, enabled: true },
  { key: "battery_voltage", below: 11.8, above: 15.2, enabled: true },
  { key: "rpm", below: null, above: 6500, enabled: true },
  { key: "oil_temp", below: null, above: 130, enabled: true },
  { key: "intake_temp", below: null, above: 70, enabled: false },
  { key: "ltft_b1", below: -15, above: 15, enabled: true },
];

/** Id of the first profile (also given to results saved before profiles existed). */
export const FIRST_PROFILE = "default";

export function newProfile(name: string, id = `p${Date.now().toString(36)}`): Profile {
  return { id, name, vin: null, fuel: "auto", displacementL: 1.6, volumetricEff: 0.85, alerts: structuredClone(DEFAULT_ALERTS) };
}

const DEFAULT_UNITS: UnitPrefs = { speed: "km/h", temp: "°C", pressure: "kPa", distance: "km", volume: "L", consumption: "km/L", torque: "Nm" };

/** Preferences saved by versions without profiles kept the car data at the top level. */
type Stored = Partial<Prefs> & Partial<Omit<Profile, "id" | "name" | "vin">>;

function load(): Prefs {
  let stored: Stored = {};
  try {
    const v: unknown = JSON.parse(localStorage.getItem("prefs") ?? "{}");
    stored = v && typeof v === "object" ? (v as Stored) : {};
  } catch {
    stored = {};
  }
  let profiles = Array.isArray(stored.profiles) && stored.profiles.length ? stored.profiles : null;
  if (!profiles) {
    const first = newProfile(t("profiles.defaultName"), FIRST_PROFILE);
    if (stored.fuel) first.fuel = migrateFuel(stored.fuel);
    if (stored.displacementL) first.displacementL = stored.displacementL;
    if (stored.volumetricEff) first.volumetricEff = stored.volumetricEff;
    if (stored.alerts) first.alerts = stored.alerts;
    profiles = [first];
  }
  // Fill fields an older or damaged file lacks, so no screen meets "undefined".
  profiles = profiles.map((p, i) => {
    const base = newProfile(t("profiles.newName", { n: i + 1 }), p?.id || `p${i}`);
    const merged = { ...base, ...p };
    return { ...merged, fuel: migrateFuel(merged.fuel), alerts: Array.isArray(merged.alerts) ? merged.alerts : base.alerts };
  });
  const active = profiles.some((p) => p.id === stored.activeProfile) ? stored.activeProfile! : profiles[0].id;
  return {
    alertsEnabled: stored.alertsEnabled ?? true,
    alertSound: stored.alertSound ?? true,
    autoReconnect: stored.autoReconnect ?? true,
    units: { ...DEFAULT_UNITS, ...(stored.units ?? {}) },
    profiles,
    activeProfile: active,
    fuelPrices: stored.fuelPrices ?? {},
  };
}

let cache: Prefs | null = null;

export function prefs(): Prefs {
  cache ??= load();
  return cache;
}

export function savePrefs(change: Partial<Prefs>) {
  cache = { ...prefs(), ...change };
  try {
    localStorage.setItem("prefs", JSON.stringify(cache));
  } catch {
    /* not remembered, still applied for this session */
  }
}

/** The active vehicle profile. */
export function profile(): Profile {
  const p = prefs();
  return p.profiles.find((x) => x.id === p.activeProfile) ?? p.profiles[0];
}

export function saveProfile(change: Partial<Profile>, id = profile().id) {
  savePrefs({ profiles: prefs().profiles.map((p) => (p.id === id ? { ...p, ...change } : p)) });
}

/** Makes `id` the active profile and tells every screen. */
export function setActiveProfile(id: string) {
  if (id === prefs().activeProfile) return;
  savePrefs({ activeProfile: id });
  emit("profile");
}

/** What to tell the user after the connected car's VIN became known. */
export type VinMatch = { kind: "same" } | { kind: "switched"; profile: Profile } | { kind: "learned"; profile: Profile } | { kind: "other"; profile: Profile };

/** Picks the profile of the connected car by its VIN. */
export function matchVin(vin: string): VinMatch {
  const active = profile();
  if (active.vin === vin) return { kind: "same" };
  const owner = prefs().profiles.find((p) => p.vin === vin);
  if (owner) {
    setActiveProfile(owner.id);
    return { kind: "switched", profile: owner };
  }
  // First connection with this profile: assume it is this car.
  if (!active.vin) {
    saveProfile({ vin });
    return { kind: "learned", profile: active };
  }
  return { kind: "other", profile: active };
}
