// Documentation screen data: the project's own documents (README and
// docs/*.md) are bundled into the program at build time, so they open
// offline and always match the installed version. Each document exists in
// Portuguese (docs/) and in American English (docs/en/); the English (Europe)
// version is the American text with British spelling, with no extra files.
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
import enReadme from "../docs/en/README.md?raw";
import enComoUsar from "../docs/en/COMO-USAR.md?raw";
import enCarros from "../docs/en/CARROS-BRASILEIROS.md?raw";
import enDiagramas from "../docs/en/DIAGRAMAS.md?raw";
import enCreditos from "../docs/en/CREDITOS.md?raw";
import enArquitetura from "../docs/en/ARQUITETURA.md?raw";
import enGuia from "../docs/en/GUIA-INICIANTE.md?raw";
import enRegras from "../docs/en/REGRAS-DO-PROJETO.md?raw";
import type { Lang } from "./i18n";
import { british } from "./locales/en-GB";

export const REPO_URL = "https://github.com/samuvieceli/obd2-scanner";

export interface Doc {
  /** Id used in the screen and in the locale texts (`docs.list.<id>`). */
  id: string;
  /** Path in the repository, used to resolve links and "open on GitHub". */
  file: string;
  text: string;
}

// The latest release notes ("What's new"), whatever version they are. The
// file holds the Portuguese text, then "---" and the English text (the
// heading of each carries a flag); a file without flags is the same for all.
const notes = Object.entries(import.meta.glob<string>("../docs/release-notes/*.md", { query: "?raw", import: "default", eager: true }))
  .map(([path, text]) => ({ file: path.replace(/^\.\.\//, ""), text }))
  .sort((a, b) => compareVersions(b.file, a.file))[0];

/** The part of the release notes written in the given language. */
export function notesFor(text: string, lang: Lang): string {
  const parts = text.split(/\n---\s*\n(?=##[^\n]*\p{Regional_Indicator})/u);
  if (parts.length < 2) return text;
  return lang === "pt-BR" ? parts[0] : parts[1];
}

interface Source {
  id: string;
  /** Path in the repository of the Portuguese original. */
  pt: string;
  ptText: string;
  /** Path of the English copy and its text. */
  en: string;
  enText: string;
}

/** In the order shown on the screen: for users first, for programmers last. */
const SOURCES: Source[] = [
  { id: "howto", pt: "docs/COMO-USAR.md", ptText: comoUsar, en: "docs/en/COMO-USAR.md", enText: enComoUsar },
  { id: "readme", pt: "README.md", ptText: readme, en: "docs/en/README.md", enText: enReadme },
  ...(notes ? [{ id: "news", pt: notes.file, ptText: notes.text, en: notes.file, enText: notes.text }] : []),
  { id: "rules", pt: "docs/REGRAS-DO-PROJETO.md", ptText: regras, en: "docs/en/REGRAS-DO-PROJETO.md", enText: enRegras },
  { id: "brazil", pt: "docs/CARROS-BRASILEIROS.md", ptText: carros, en: "docs/en/CARROS-BRASILEIROS.md", enText: enCarros },
  { id: "diagrams", pt: "docs/DIAGRAMAS.md", ptText: diagramas, en: "docs/en/DIAGRAMAS.md", enText: enDiagramas },
  { id: "credits", pt: "docs/CREDITOS.md", ptText: creditos, en: "docs/en/CREDITOS.md", enText: enCreditos },
  { id: "architecture", pt: "docs/ARQUITETURA.md", ptText: arquitetura, en: "docs/en/ARQUITETURA.md", enText: enArquitetura },
  { id: "beginner", pt: "docs/GUIA-INICIANTE.md", ptText: guia, en: "docs/en/GUIA-INICIANTE.md", enText: enGuia },
];

/**
 * British spelling for a Markdown text: only the prose (and the quoted labels
 * of diagrams) is changed, never code blocks, inline code or link targets, so
 * file names and links keep working.
 */
export function britishMarkdown(md: string): string {
  let fence = false;
  let diagram = false;
  return md
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        diagram = !fence && /^\s*```mermaid/.test(line);
        fence = !fence;
        return line;
      }
      // Diagram labels are the quoted texts; names and arrows stay as they are.
      if (diagram) return line.replace(/"[^"]*"/g, (label) => british(label));
      if (fence) return line;
      return line
        .split(/(`[^`]*`|\]\([^)]*\)|<[^>]*>)/)
        .map((part, i) => (i % 2 ? part : british(part)))
        .join("");
    })
    .join("\n");
}

const cache = new Map<Lang, Doc[]>();

/** The documents in the given language (pt-BR, en-US or en-GB). */
export function docsFor(lang: Lang): Doc[] {
  let docs = cache.get(lang);
  if (!docs) {
    docs = SOURCES.map((s) => {
      if (lang === "pt-BR") return { id: s.id, file: s.pt, text: s.id === "news" ? notesFor(s.ptText, lang) : s.ptText };
      const text = s.id === "news" ? notesFor(s.enText, lang) : s.enText;
      return { id: s.id, file: s.en, text: lang === "en-GB" ? britishMarkdown(text) : text };
    });
    cache.set(lang, docs);
  }
  return docs;
}

export function docById(id: string, lang: Lang): Doc | undefined {
  return docsFor(lang).find((d) => d.id === id);
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
export function resolveLink(href: string, from: string, lang: Lang): LinkTarget {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "external", url: href };
  const [path, hash] = splitHash(href);
  const anchor = hash ? decodeURIComponent(hash) : undefined;
  if (!path) return { kind: "anchor", id: anchor ?? "" };
  const target = joinPath(from, path);
  const doc = docsFor(lang).find((d) => d.file === target);
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
export function docSections(lang: Lang): { doc: Doc; heading: Heading }[] {
  return docsFor(lang).flatMap((doc) => headings(doc.text).filter((x) => x.level >= 2 && x.level <= 3).map((heading) => ({ doc, heading })));
}
