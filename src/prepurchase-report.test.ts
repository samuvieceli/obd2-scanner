import { describe, expect, it } from "vitest";
import { evaluate, overall, type SavedCheck } from "./prepurchase";
import { buildPrepurchaseHtml } from "./views/prepurchase-report";

describe("pre-purchase report", () => {
  it("shows the light, the items and escapes what the user typed", () => {
    const items = evaluate({ dtcs: { stored: [], pending: [], permanent: [{ code: "P0420", description: "Catalisador", system: "", generic: true, known: true, brand: null, translated: true }] } });
    const check: SavedCheck = { id: "1", at: 0, name: "<b>Gol</b>", light: overall(items), items, dtcText: { P0420: "Catalisador" } };
    const html = buildPrepurchaseHtml(check, "1.0.0");
    expect(html).toContain("&lt;b&gt;Gol&lt;/b&gt;");
    expect(html).not.toContain("<b>Gol</b>");
    expect(html).toContain("P0420 — Catalisador");
    expect(html).not.toMatch(/prepurchase\.items\./);
  });
});
