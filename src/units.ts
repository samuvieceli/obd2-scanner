// Units of measurement shown on screen.
//
// Everything inside the program (backend, recordings, exports, alert limits,
// performance tests) stays in metric units, the units of the OBD-II standard.
// Conversion happens only when a value is displayed or typed by the user, so
// changing units never changes stored data.
import { prefs, savePrefs } from "./prefs";
import { emit } from "./store";

export interface UnitPrefs {
  speed: "km/h" | "mph";
  temp: "°C" | "°F";
  pressure: "kPa" | "bar" | "psi";
  distance: "km" | "mi";
  volume: "L" | "gal";
  consumption: "km/L" | "L/100km" | "mpg" | "mpg_uk";
  torque: "Nm" | "lb·ft";
}

export const UNIT_CHOICES: { [K in keyof UnitPrefs]: UnitPrefs[K][] } = {
  speed: ["km/h", "mph"],
  temp: ["°C", "°F"],
  pressure: ["kPa", "bar", "psi"],
  distance: ["km", "mi"],
  volume: ["L", "gal"],
  consumption: ["km/L", "L/100km", "mpg", "mpg_uk"],
  torque: ["Nm", "lb·ft"],
};

export const UNIT_PRESETS: Record<"br" | "eu" | "us" | "uk", UnitPrefs> = {
  br: { speed: "km/h", temp: "°C", pressure: "kPa", distance: "km", volume: "L", consumption: "km/L", torque: "Nm" },
  eu: { speed: "km/h", temp: "°C", pressure: "bar", distance: "km", volume: "L", consumption: "L/100km", torque: "Nm" },
  us: { speed: "mph", temp: "°F", pressure: "psi", distance: "mi", volume: "gal", consumption: "mpg", torque: "lb·ft" },
  uk: { speed: "mph", temp: "°C", pressure: "psi", distance: "mi", volume: "L", consumption: "mpg_uk", torque: "lb·ft" },
};

export function units(): UnitPrefs {
  return prefs().units;
}

export function saveUnits(change: Partial<UnitPrefs>) {
  savePrefs({ units: { ...units(), ...change } });
  emit("units");
}

/** Linear conversion `shown = value × k + offset`. */
interface Conv {
  unit: string;
  k: number;
  offset: number;
}

const SAME = (unit: string): Conv => ({ unit, k: 1, offset: 0 });

/** How a value in the metric `base` unit is shown with the chosen units. */
export function conversion(base: string): Conv {
  const u = units();
  switch (base) {
    case "km/h":
      return u.speed === "mph" ? { unit: "mph", k: 0.621371, offset: 0 } : SAME(base);
    case "°C":
      return u.temp === "°F" ? { unit: "°F", k: 1.8, offset: 32 } : SAME(base);
    case "kPa":
      if (u.pressure === "bar") return { unit: "bar", k: 0.01, offset: 0 };
      if (u.pressure === "psi") return { unit: "psi", k: 0.145038, offset: 0 };
      return SAME(base);
    case "km":
      return u.distance === "mi" ? { unit: "mi", k: 0.621371, offset: 0 } : SAME(base);
    case "L":
      return u.volume === "gal" ? { unit: "gal", k: 0.264172, offset: 0 } : SAME(base);
    case "L/h":
      return u.volume === "gal" ? { unit: "gal/h", k: 0.264172, offset: 0 } : SAME(base);
    case "Nm":
      return u.torque === "lb·ft" ? { unit: "lb·ft", k: 0.737562, offset: 0 } : SAME(base);
    default:
      return SAME(base);
  }
}

export function toDisplay(base: string, v: number): number {
  const c = conversion(base);
  return v * c.k + c.offset;
}

export function fromDisplay(base: string, v: number): number {
  const c = conversion(base);
  return (v - c.offset) / c.k;
}

export function displayUnit(base: string): string {
  return conversion(base).unit;
}

/** Extra decimals a converted unit needs (bar values are small numbers). */
export function extraDecimals(base: string): number {
  const unit = displayUnit(base);
  return unit === "bar" ? 2 : unit === "psi" || unit === "gal" || unit === "gal/h" ? 1 : 0;
}

/** Fuel economy from km/L to the chosen unit. Returns `[value, unit]`. */
export function consumption(kmPerL: number): [number, string] {
  switch (units().consumption) {
    case "L/100km":
      // Standing still (0 km/L) is shown as 0, not as infinity.
      return [kmPerL > 0 ? 100 / kmPerL : 0, "L/100 km"];
    case "mpg":
      return [kmPerL * 2.35215, "mpg"];
    case "mpg_uk":
      return [kmPerL * 2.82481, "mpg (UK)"];
    default:
      return [kmPerL, "km/L"];
  }
}
