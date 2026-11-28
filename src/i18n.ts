// Translation helper. Texts live in ./locales; add a language by creating a
// new file with the same keys, registering it in LANGS and giving it default
// units in unit-presets.ts (LANG_UNITS).
import ptBR, { type Messages } from "./locales/pt-BR";
import enUS from "./locales/en-US";
import enGB from "./locales/en-GB";

/** "en-GB" is shown as "English (Europe)": British spelling, metric units. */
export type Lang = "pt-BR" | "en-US" | "en-GB";
export const LANGS: { id: Lang; label: string; short: string; messages: Messages }[] = [
  { id: "pt-BR", label: "Português (Brasil)", short: "PT-BR", messages: ptBR },
  { id: "en-US", label: "English (US)", short: "EN-US", messages: enUS },
  { id: "en-GB", label: "English (Europe)", short: "EN-EU", messages: enGB },
];

export function isLang(v: unknown): v is Lang {
  return LANGS.some((l) => l.id === v);
}

/** Language for a system locale: Portuguese, American English, or English (Europe) for the rest. */
export function langFor(locale: string): Lang {
  const l = locale.toLowerCase();
  if (l.startsWith("pt")) return "pt-BR";
  // Only the US (and a bare "en") use miles and Fahrenheit; elsewhere metric fits better.
  if (l === "en" || l === "en-us") return "en-US";
  return "en-GB";
}

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (isLang(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  return langFor(navigator.language || "en-US");
}

let lang: Lang = initialLang();
const listeners = new Set<() => void>();

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang) {
  lang = l;
  try {
    localStorage.setItem("lang", l);
  } catch {
    /* ignore */
  }
  if (typeof document !== "undefined") document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

export function onLangChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function msgs(): Messages {
  return LANGS.find((x) => x.id === lang)!.messages;
}

export type Params = Record<string, string | number>;

/**
 * Rewrites a text before its `{params}` are filled in. units.ts installs one
 * that turns metric values written in the texts ("60 °C", "{km} km") into
 * the units chosen in Settings, so the texts can stay metric.
 */
type TextFilter = (text: string, params?: Params) => string;
let filter: TextFilter | null = null;

export function setTextFilter(f: TextFilter | null) {
  filter = f;
}

/** Texts that must keep the metric units they name (unit names, test names). */
const KEEP_UNITS = /^(units\.|perf\.intro$)/;

/** `t("connection.title")`, `t("common.saved", { path })`. Missing keys return the key. */
export function t(path: string, params?: Params): string {
  let node: unknown = msgs();
  for (const part of path.split(".")) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  let text = typeof node === "string" ? node : path;
  if (filter && !KEEP_UNITS.test(path)) text = filter(text, params);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      text = text.split(`{${k}}`).join(typeof v === "number" ? fmtNum(v) : v);
    }
  }
  return text;
}

export function fmtNum(v: number, decimals?: number): string {
  const d = decimals ?? (Number.isInteger(v) ? 0 : 1);
  return new Intl.NumberFormat(lang, { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);
}

export interface PidText {
  name: string;
  short: string;
  desc: string;
  typical: string;
}

export function pidText(key: string): PidText {
  const p = (msgs().pids as Record<string, PidText>)[key];
  if (!p) return { name: key, short: key, desc: "", typical: "" };
  // Typical values ("85–105 °C") follow the chosen units too.
  return filter ? { ...p, desc: filter(p.desc), typical: filter(p.typical) } : p;
}
