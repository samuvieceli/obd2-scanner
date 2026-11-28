import { describe, expect, it } from "vitest";
import { DOCS, compareVersions, docSections, headings, joinPath, resolveLink, slugify } from "./docs";

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
    expect(resolveLink("#2-x", "docs/DIAGRAMAS.md")).toEqual({ kind: "anchor", id: "2-x" });
    expect(resolveLink("DIAGRAMAS.md", "docs/ARQUITETURA.md")).toEqual({ kind: "doc", id: "diagrams", anchor: undefined });
    expect(resolveLink("docs/COMO-USAR.md#1-primeiro", "README.md")).toEqual({ kind: "doc", id: "howto", anchor: "1-primeiro" });
    expect(resolveLink("../LICENSE", "docs/CREDITOS.md")).toEqual({ kind: "external", url: "https://github.com/samuvieceli/obd2-scanner/blob/main/LICENSE" });
    expect(resolveLink("https://example.org", "README.md")).toEqual({ kind: "external", url: "https://example.org" });
  });

  it("sorts release notes by version", () => {
    expect(compareVersions("v1.10.0.md", "v1.9.2.md")).toBeGreaterThan(0);
    expect(compareVersions("v1.0.0.md", "v1.0.0.md")).toBe(0);
  });

  it("bundles every document, and links between them point to real sections", () => {
    expect(DOCS.length).toBeGreaterThanOrEqual(8);
    for (const d of DOCS) expect(d.text.length, d.file).toBeGreaterThan(200);
    const ids = new Map(DOCS.map((d) => [d.id, new Set(headings(d.text).map((x) => x.id))]));
    for (const d of DOCS) {
      for (const m of d.text.matchAll(/\]\(([^)\s]+)\)/g)) {
        const to = resolveLink(m[1], d.file);
        if (to.kind === "anchor" && to.id) expect(ids.get(d.id)!.has(to.id), `${d.file} → ${m[1]}`).toBe(true);
        if (to.kind === "doc" && to.anchor) expect(ids.get(to.id)!.has(to.anchor), `${d.file} → ${m[1]}`).toBe(true);
      }
    }
  });

  it("lists sections for the global search", () => {
    const s = docSections();
    expect(s.some((x) => x.doc.id === "rules" && x.heading.text.startsWith("Parte 1"))).toBe(true);
    expect(s.every((x) => x.heading.level === 2 || x.heading.level === 3)).toBe(true);
  });
});
