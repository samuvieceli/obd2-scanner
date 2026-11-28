// Documentation screen data: the project's own documents (README and
// docs/*.md) are bundled into the program at build time, so they open
// offline and always match the installed version.
//
// Pure logic, no DOM: list of documents, heading ids (same rule as GitHub,
// so the links inside the documents keep working) and where a link points.
import readme from "../README.md?raw";
import comoUsar from "../docs/COMO-USAR.md?raw";
import carros from "../docs/CARROS-BRASILEIROS.md?raw";
import diagramas from "../docs/DIAGRAMAS.md?raw";
import creditos from "../docs/CREDITOS.md?raw";
import arquitetura from "../docs/ARQUITETURA.md?raw";
import guia from "../docs/GUIA-INICIANTE.md?raw";
import regras from "../docs/REGRAS-DO-PROJETO.md?raw";

export const REPO_URL = "https://github.com/samuvieceli/obd2-scanner";

export interface Doc {
  /** Id used in the screen and in the locale texts (`docs.list.<id>`). */
  id: string;
  /** Path in the repository, used to resolve links and "open on GitHub". */
  file: string;
  text: string;
}

// The latest release notes ("What's new"), whatever version they are.
const notes = Object.entries(import.meta.glob<string>("../docs/release-notes/*.md", { query: "?raw", import: "default", eager: true }))
  .map(([path, text]) => ({ file: path.replace(/^\.\.\//, ""), text }))
  .sort((a, b) => compareVersions(b.file, a.file))[0];

/** In the order shown on the screen: for users first, for programmers last. */
export const DOCS: Doc[] = [
  { id: "howto", file: "docs/COMO-USAR.md", text: comoUsar },
  { id: "readme", file: "README.md", text: readme },
  ...(notes ? [{ id: "news", file: notes.file, text: notes.text }] : []),
  { id: "rules", file: "docs/REGRAS-DO-PROJETO.md", text: regras },
  { id: "brazil", file: "docs/CARROS-BRASILEIROS.md", text: carros },
  { id: "diagrams", file: "docs/DIAGRAMAS.md", text: diagramas },
  { id: "credits", file: "docs/CREDITOS.md", text: creditos },
  { id: "architecture", file: "docs/ARQUITETURA.md", text: arquitetura },
  { id: "beginner", file: "docs/GUIA-INICIANTE.md", text: guia },
];

export function docById(id: string): Doc | undefined {
  return DOCS.find((d) => d.id === id);
}

/** "docs/release-notes/v1.10.0.md" after "v1.9.2.md". */
export function compareVersions(a: string, b: string): number {
  const nums = (s: string) => (s.match(/\d+/g) ?? []).map(Number);
  const x = nums(a);
  const y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** GitHub's heading id: lower case, punctuation removed, spaces → "-". */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** Gives repeated headings "-1", "-2"... like GitHub does. */
export function slugger(): (text: string) => string {
  const seen = new Map<string, number>();
  return (text) => {
    const base = slugify(text);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n ? `${base}-${n}` : base;
  };
}

/** Markdown inline marks removed: what the heading shows on screen. */
export function plainText(md: string): string {
  return md
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(\*|_)(.+?)\1/g, "$2")
    .trim();
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

/** Headings of a document (code blocks skipped), with their ids. */
export function headings(md: string): Heading[] {
  const out: Heading[] = [];
  const id = slugger();
  let fence = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence;
    if (fence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const text = plainText(m[2]);
    out.push({ level: m[1].length, text, id: id(text) });
  }
  return out;
}

export type LinkTarget =
  | { kind: "anchor"; id: string }
  | { kind: "doc"; id: string; anchor?: string }
  | { kind: "external"; url: string };

/** Where a link inside the document `from` (a repository path) leads. */
export function resolveLink(href: string, from: string): LinkTarget {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "external", url: href };
  const [path, hash] = splitHash(href);
  const anchor = hash ? decodeURIComponent(hash) : undefined;
  if (!path) return { kind: "anchor", id: anchor ?? "" };
  const target = joinPath(from, path);
  const doc = DOCS.find((d) => d.file === target);
  if (doc) return doc.file === from ? { kind: "anchor", id: anchor ?? "" } : { kind: "doc", id: doc.id, anchor };
  return { kind: "external", url: `${REPO_URL}/blob/main/${target}${hash !== undefined ? `#${hash}` : ""}` };
}

function splitHash(href: string): [string, string | undefined] {
  const i = href.indexOf("#");
  return i < 0 ? [href, undefined] : [href.slice(0, i), href.slice(i + 1)];
}

/** `docs/A.md` + `../src/x.ts` → `src/x.ts`; a leading "/" is the repo root. */
export function joinPath(from: string, rel: string): string {
  const parts = rel.startsWith("/") ? [] : from.split("/").slice(0, -1);
  for (const p of rel.split("/")) {
    if (!p || p === ".") continue;
    if (p === "..") parts.pop();
    else parts.push(p);
  }
  return parts.join("/");
}

/** Sections of every document, for the global search. */
export function docSections(): { doc: Doc; heading: Heading }[] {
  return DOCS.flatMap((doc) => headings(doc.text).filter((x) => x.level >= 2 && x.level <= 3).map((heading) => ({ doc, heading })));
}
