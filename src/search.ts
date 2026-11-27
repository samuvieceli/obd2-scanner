// Global search (Ctrl+F / Ctrl+K): ranking of screens, parameters, glossary
// terms and trouble codes for a typed query.
//
// Pure logic, no DOM. Accents and case are ignored ("rotacao" finds
// "Rotação"). Each word of the query must appear somewhere in the item;
// matches in the title count more than in the description, and a title that
// starts with the query comes first.

export type Kind = "screen" | "pid" | "term" | "monitor" | "dtc";

export interface Entry {
  kind: Kind;
  /** Stable id (route id, PID key, term text, code). */
  id: string;
  title: string;
  /** Short words also searched as part of the title (e.g. "RPM", "STFT"). */
  alias?: string;
  /** Longer text, searched with less weight. */
  detail?: string;
}

export function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** A full OBD2 trouble code such as P0301 or u0100. */
export function isDtcCode(q: string): boolean {
  return /^[PCBU][0-3][0-9A-F]{3}$/i.test(q.trim());
}

/** Score of an entry for the query; 0 means no match. */
export function score(query: string, e: Entry): number {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const head = normalize(`${e.title} ${e.alias ?? ""} ${e.id}`);
  const body = normalize(e.detail ?? "");
  let s = 0;
  for (const w of words) {
    const at = head.indexOf(w);
    // A word start counts more than a match inside a word.
    if (at >= 0) s += at === 0 || /[\s(/·-]/.test(head[at - 1]) ? 10 : 6;
    else if (body.includes(w)) s += 2;
    else return 0;
  }
  const title = normalize(e.title);
  const q = normalize(query);
  if (title === q || normalize(e.alias ?? "") === q) s += 20;
  else if (title.startsWith(q)) s += 8;
  // Screens first on equal score: they are what people look for most.
  if (e.kind === "screen") s += 3;
  return s;
}

/** The best matches, highest score first, at most `limit`. */
export function search(query: string, entries: Entry[], limit = 12): Entry[] {
  return entries
    .map((e, i) => ({ e, i, s: score(query, e) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.e);
}
