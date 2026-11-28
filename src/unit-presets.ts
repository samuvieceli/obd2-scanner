// Ready-made unit sets, and which one each language uses by default.
// Kept apart from units.ts so preferences and translations can use them
// without importing the conversion code.
import type { Lang } from "./i18n";
import type { UnitPrefs } from "./units";

export type UnitPreset = "br" | "eu" | "us" | "uk";

export const UNIT_PRESETS: Record<UnitPreset, UnitPrefs> = {
  br: { speed: "km/h", temp: "°C", pressure: "kPa", distance: "km", volume: "L", consumption: "km/L", torque: "Nm" },
  eu: { speed: "km/h", temp: "°C", pressure: "bar", distance: "km", volume: "L", consumption: "L/100km", torque: "Nm" },
  us: { speed: "mph", temp: "°F", pressure: "psi", distance: "mi", volume: "gal", consumption: "mpg", torque: "lb·ft" },
  uk: { speed: "mph", temp: "°C", pressure: "psi", distance: "mi", volume: "L", consumption: "mpg_uk", torque: "lb·ft" },
};

/** Units applied when the user picks a language (they can still change each one). */
export const LANG_UNITS: Record<Lang, UnitPreset> = {
  "pt-BR": "br",
  "en-US": "us",
  "en-GB": "eu",
};
