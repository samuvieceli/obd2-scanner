import { describe, expect, it } from "vitest";
import { britishMarkdown, compareVersions, docSections, docsFor, headings, joinPath, notesFor, resolveLink, slugify } from "./docs";
import type { Lang } from "./i18n";

const LANG_IDS: Lang[] = ["pt-BR", "en-US", "en-GB"];

describe("documentation", () => {
  it("makes heading ids like GitHub", () => {
    expect(slugify("1. Visão geral")).toBe("1-visão-geral");
    expect(slugify("5. Saúde da conexão: travamento e reconexão")).toBe("5-saúde-da-conexão-travamento-e-reconexão");
    expect(slugify("Gravação e relatório")).toBe("gravação-e-relatório");
  });

  it("reads headings, skipping code blocks and inline marks", () => {
    const md = "# Title\n\n## A `code` and **bold**\n```\n## not a heading\n```\n## A code and bold\n";
    expect(headings(md)).toEqual([
      { level: 1, text: "Title", id: "title" },
      { level: 2, text: "A code and bold", id: "a-code-and-bold" },
      { level: 2, text: "A code and bold", id: "a-code-and-bold-1" },
    ]);
  });

  it("resolves links", () => {
    expect(joinPath("docs/A.md", "../src/x.ts")).toBe("src/x.ts");
    expect(resolveLink("#2-x", "docs/DIAGRAMAS.md", "pt-BR")).toEqual({ kind: "anchor", id: "2-x" });
    expect(resolveLink("DIAGRAMAS.md", "docs/ARQUITETURA.md", "pt-BR")).toEqual({ kind: "doc", id: "diagrams", anchor: undefined });
    expect(resolveLink("docs/COMO-USAR.md#1-primeiro", "README.md", "pt-BR")).toEqual({ kind: "doc", id: "howto", anchor: "1-primeiro" });
    expect(resolveLink("../LICENSE", "docs/CREDITOS.md", "pt-BR")).toEqual({ kind: "external", url: "https://github.com/samuvieceli/obd2-scanner/blob/main/LICENSE" });
    expect(resolveLink("https://example.org", "README.md", "pt-BR")).toEqual({ kind: "external", url: "https://example.org" });
  });

  it("sorts release notes by version", () => {
    expect(compareVersions("v1.10.0.md", "v1.9.2.md")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0.md", "v1.0.0.md")).toBe(0);
  });

  it.each(LANG_IDS)("bundles every document in %s, and links between them point to real sections", (lang) => {
    const docs = docsFor(lang);
    expect(docs.length).toBeGreaterThanOrEqual(8);
    for (const d of docs) expect(d.text.length, d.file).toBeGreaterThan(200);
    const ids = new Map(docs.map((d) => [d.id, new Set(headings(d.text).map((x) => x.id))]));
    for (const d of docs) {
      for (const m of d.text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const to = resolveLink(m[1], d.file, lang);
        if (to.kind === "anchor" && to.id) expect(ids.get(d.id)!.has(to.id), `${d.file} → ${m[1]}`).toBe(true);
        if (to.kind === "doc" && to.anchor) expect(ids.get(to.id)!.has(to.anchor), `${d.file} → ${m[1]}`).toBe(true);
      }
    }
  });

  it("has the same structure in Portuguese and English: sections, diagrams, tables, code blocks", () => {
    const shape = (md: string) => ({
      h: headings(md).map((x) => x.level),
      mermaid: (md.match(/^```mermaid/gm) ?? []).length,
      fences: (md.match(/^```/gm) ?? []).length,
      tables: (md.match(/^\| ?-{3}/gm) ?? []).length,
      rows: (md.match(/^\|/gm) ?? []).length,
    });
    const pt = docsFor("pt-BR");
    for (const en of docsFor("en-US")) {
      const ptDoc = pt.find((d) => d.id === en.id)!;
      if (en.id === "news") continue;
      expect(shape(en.text), en.file).toEqual(shape(ptDoc.text));
    }
  });

  it("does not leave Portuguese text in the English documents or American spelling in English (Europe)", () => {
    for (const d of docsFor("en-US")) {
      expect(d.text, d.file).not.toMatch(/\b(você|não|também|código|motor desligado)\b/i);
      expect(d.text.replace(/`litre`/g, ""), d.file).not.toMatch(/\b(litres?|colours?|refuell(?:ing|ed)|windscreen)\b/);
    }
    for (const d of docsFor("en-GB")) {
      expect(d.text.replace(/```[\s\S]*?```|`[^`]*`/g, ""), d.file).not.toMatch(/\b(liters?|colors?|refueling|refueled|windshield)\b/);
    }
  });

  it("writes British spelling only outside code, links and diagrams", () => {
    const md = "Fill the tank with gasoline in `gasoline.rs` ([gasoline](gasoline.md)).\n```\ngasoline\n```\n";
    expect(britishMarkdown(md)).toBe("Fill the tank with petrol in `gasoline.rs` ([petrol](gasoline.md)).\n```\ngasoline\n```\n");
    expect(britishMarkdown('```mermaid\nflowchart LR\n  gasoline["Fill with gasoline"] --> x\n```\n')).toBe('```mermaid\nflowchart LR\n  gasoline["Fill with petrol"] --> x\n```\n');
  });

  it("shows the release notes in the language of the program", () => {
    const text = "## OBD2 Scanner 1.0 🇧🇷\n\nOlá\n\n---\n\n## OBD2 Scanner 1.0 🇺🇸\n\nHello\n";
    expect(notesFor(text, "pt-BR")).toContain("Olá");
    expect(notesFor(text, "pt-BR")).not.toContain("Hello");
    expect(notesFor(text, "en-GB")).toContain("Hello");
    expect(notesFor(text, "en-US")).not.toContain("Olá");
    expect(notesFor("no flags", "en-US")).toBe("no flags");
    for (const lang of LANG_IDS) expect(docsFor(lang).find((d) => d.id === "news")?.text.length).toBeGreaterThan(200);
  });

  it("lists sections for the global search", () => {
    const s = docSections("pt-BR");
    expect(s.some((x) => x.doc.id === "rules" && x.heading.text.startsWith("Parte 1"))).toBe(true);
    expect(s.every((x) => x.heading.level === 2 || x.heading.level === 3)).toBe(true);
    expect(docSections("en-US").some((x) => x.doc.id === "rules" && x.heading.text.startsWith("Part 1"))).toBe(true);
  });
});
