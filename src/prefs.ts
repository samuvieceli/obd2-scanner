// User preferences kept in the browser storage of the app window.
// Every read falls back to defaults, so a blocked or empty storage is fine.

export type FuelType = "auto" | "gasoline_e27" | "ethanol" | "gasoline_pure" | "diesel";

export interface AlertRule {
  key: string;
  /** Alert when the value goes below this (null = no lower limit). */
  below: number | null;
  /** Alert when the value goes above this (null = no upper limit). */
  above: number | null;
  enabled: boolean;
}

export interface Prefs {
  fuel: FuelType;
  /** Engine displacement in liters, for cars without a MAF sensor. */
  displacementL: number;
  /** Volumetric efficiency (0-1) used with the displacement. */
  volumetricEff: number;
  alertsEnabled: boolean;
  alertSound: boolean;
  alerts: AlertRule[];
}

export const DEFAULT_ALERTS: AlertRule[] = [
  { key: "coolant_temp", below: null, above: 110, enabled: true },
  { key: "battery_voltage", below: 11.8, above: 15.2, enabled: true },
  { key: "rpm", below: null, above: 6500, enabled: true },
  { key: "oil_temp", below: null, above: 130, enabled: true },
  { key: "intake_temp", below: null, above: 70, enabled: false },
  { key: "ltft_b1", below: -15, above: 15, enabled: true },
];

const DEFAULTS: Prefs = {
  fuel: "auto",
  displacementL: 1.6,
  volumetricEff: 0.85,
  alertsEnabled: true,
  alertSound: true,
  alerts: DEFAULT_ALERTS,
};

let cache: Prefs | null = null;

export function prefs(): Prefs {
  if (cache) return cache;
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem("prefs") ?? "{}") as Partial<Prefs>;
  } catch {
    stored = {};
  }
  cache = { ...structuredClone(DEFAULTS), ...stored };
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
