// Units of measurement shown on screen.
//
// Everything inside the program (backend, recordings, exports, alert limits,
// performance tests) stays in metric units, the units of the OBD-II standard.
// Conversion happens only when a value is displayed or typed by the user, so
// changing units never changes stored data.
import { fmtNum, getLang, setLang, setTextFilter, type Lang, type Params } from "./i18n";
import { prefs, savePrefs } from "./prefs";
import { emit } from "./store";
import { LANG_UNITS, UNIT_PRESETS } from "./unit-presets";

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

export { UNIT_PRESETS } from "./unit-presets";

export function units(): UnitPrefs {
  return prefs().units;
}

export function saveUnits(change: Partial<UnitPrefs>) {
  savePrefs({ units: { ...units(), ...change } });
  emit("units");
}

/**
 * Switches the language and applies that language's usual units
 * (pt-BR: km/h, °C, km/L; en-US: mph, °F, mpg; en-GB: km/h, °C, L/100 km).
 * A unit the user had changed by hand is replaced too: picking a language is
 * read as "show it the way people there are used to". Each unit can still be
 * adjusted afterwards in Settings. Every screen is redrawn at once.
 */
export function changeLanguage(lang: Lang) {
  savePrefs({ units: { ...UNIT_PRESETS[LANG_UNITS[lang]] } });
  setLang(lang);
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
  // Economy is not linear in L/100 km: use the same rule as the trip computer.
  if (base === "km/L") return consumption(v)[0];
  const c = conversion(base);
  return v * c.k + c.offset;
}

export function fromDisplay(base: string, v: number): number {
  if (base === "km/L") {
    const k = consumption(1)[0];
    return units().consumption === "L/100km" ? (v > 0 ? 100 / v : 0) : v / k;
  }
  const c = conversion(base);
  return (v - c.offset) / c.k;
}

export function displayUnit(base: string): string {
  if (base === "km/L") return consumption(1)[1];
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

// ---------------------------------------------------------------------------
// Metric values written inside texts ("abaixo de 60 °C", "{km} km",
// "entre 32 e 42 km/h", "~101 kPa") shown in the chosen units.

/** Units the texts are written in that have a non-metric choice. */
const TEXT_UNITS = "°C|km/h|kPa|km|L/h";
const NUM = String.raw`-?\d[\d.,]*`;
const TOKEN = String.raw`(${NUM}|\{\w+\})`;
const RANGE_SEP = String.raw`\s*(?:–|\s(?:a|e|to|and)\s)\s*`;
const IN_TEXT = new RegExp(String.raw`(?<![\w/.,])${TOKEN}(?:(${RANGE_SEP})${TOKEN})?\s?(${TEXT_UNITS})(?![\w/])`, "g");

/** Number written in the current language ("1.234,5" in pt-BR, "1,234.5" in English). */
function parseLocal(s: string): number {
  const plain = getLang() === "pt-BR" ? s.replaceAll(".", "").replace(",", ".") : s.replaceAll(",", "");
  return Number(plain);
}

function decimalsOf(s: string): number {
  const sep = getLang() === "pt-BR" ? "," : ".";
  const i = s.lastIndexOf(sep);
  return i < 0 ? 0 : s.length - i - 1;
}

/**
 * Converts metric values inside a text template to the chosen units. Literal
 * numbers and `{placeholders}` right before a unit are both handled; a
 * converted placeholder is written out, so `params` fills only the rest.
 */
export function convertUnitsIn(text: string, params?: Params): string {
  if (!/°C|km|kPa|L\/h/.test(text)) return text;
  return text.replace(IN_TEXT, (match, a: string, sep: string | undefined, b: string | undefined, base: string) => {
    if (displayUnit(base) === base) return match;
    const convert = (token: string): string | null => {
      let raw: string | number | undefined = token;
      const ph = /^\{(\w+)\}$/.exec(token);
      if (ph) raw = params?.[ph[1]];
      if (raw === undefined) return null;
      const v = typeof raw === "number" ? raw : parseLocal(raw);
      if (!Number.isFinite(v)) return null;
      const d = (typeof raw === "number" ? (Number.isInteger(raw) ? 0 : 1) : decimalsOf(raw)) + extraDecimals(base);
      return fmtNum(toDisplay(base, v), d);
    };
    const first = convert(a);
    const second = b === undefined ? "" : convert(b);
    if (first === null || second === null) return match;
    return `${first}${b === undefined ? "" : `${sep}${second}`} ${displayUnit(base)}`;
  });
}

setTextFilter(convertUnitsIn);
