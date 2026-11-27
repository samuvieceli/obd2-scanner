// Translation helper. Texts live in ./locales; add a language by creating a
// new file with the same keys and registering it in LANGS.
import ptBR, { type Messages } from "./locales/pt-BR";
import enUS from "./locales/en-US";

export type Lang = "pt-BR" | "en-US";
export const LANGS: { id: Lang; label: string; messages: Messages }[] = [
  { id: "pt-BR", label: "Português (Brasil)", messages: ptBR },
  { id: "en-US", label: "English (US)", messages: enUS },
];

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "pt-BR" || saved === "en-US") return saved;
  } catch {
    /* storage unavailable */
  }
  return navigator.language.toLowerCase().startsWith("pt") ? "pt-BR" : "en-US";
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
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

export function onLangChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function msgs(): Messages {
  return LANGS.find((x) => x.id === lang)!.messages;
}

/** `t("connection.title")`, `t("common.saved", { path })`. Missing keys return the key. */
export function t(path: string, params?: Record<string, string | number>): string {
  let node: unknown = msgs();
  for (const part of path.split(".")) {
    if (node && typeof node === "object" && part in (node as object)) {
      node = (node as Record<string, unknown>)[part];
    } else {
      return path;
    }
  }
  let text = typeof node === "string" ? node : path;
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
  return p ?? { name: key, short: key, desc: "", typical: "" };
}
