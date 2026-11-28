import { describe, expect, it } from "vitest";
import { needsSafetyNotice, SAFETY_ITEMS, SAFETY_VERSION } from "./safety";
import ptBR from "./locales/pt-BR";
import enUS from "./locales/en-US";

describe("safety notice", () => {
  it("is shown until the current version is confirmed", () => {
    expect(needsSafetyNotice(null)).toBe(true);
    expect(needsSafetyNotice("")).toBe(true);
    expect(needsSafetyNotice("abc")).toBe(true);
    expect(needsSafetyNotice(String(SAFETY_VERSION - 1))).toBe(true);
    expect(needsSafetyNotice(String(SAFETY_VERSION))).toBe(false);
    expect(needsSafetyNotice(String(SAFETY_VERSION + 1))).toBe(false);
  });

  it("has every point translated", () => {
    for (const m of [ptBR, enUS]) {
      for (const id of SAFETY_ITEMS) {
        expect(m.safety.items[id].title.length).toBeGreaterThan(3);
        expect(m.safety.items[id].text.length).toBeGreaterThan(20);
      }
    }
  });
});
