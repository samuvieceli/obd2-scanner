import { describe, expect, it } from "vitest";
import { makerOffered, stateLabel } from "./maker";
import { setLang } from "./i18n";
import { state } from "./store";
import type { MakerParam } from "./api";

const param = (over: Partial<MakerParam>): MakerParam => ({
  key: "mfr_test",
  name: "Test",
  group: "Engine",
  unit: "",
  min: 0,
  max: 1,
  verified: true,
  ...over,
});

describe("manufacturer parameters", () => {
  it("names on/off values and mapped values in the chosen language", () => {
    state.maker = new Map([
      ["mfr_lamp", param({ key: "mfr_lamp", states: [{ raw: 0, word: "off" }, { raw: 1, word: "on" }] })],
      ["mfr_gear", param({ key: "mfr_gear", states: [{ raw: 14, en: "Neutral", pt: "N (neutro)" }] })],
      ["mfr_temp", param({ key: "mfr_temp", unit: "°C" })],
    ]);
    setLang("pt-BR");
    expect(stateLabel("mfr_lamp", 1)).toBe("ligado");
    expect(stateLabel("mfr_gear", 14)).toBe("N (neutro)");
    // A raw value without a name is shown as the number.
    expect(stateLabel("mfr_gear", 3)).toBe("3");
    // Ordinary numbers are left to the usual formatting.
    expect(stateLabel("mfr_temp", 90)).toBeNull();
    setLang("en-US");
    expect(stateLabel("mfr_gear", 14)).toBe("Neutral");
    expect(stateLabel("mfr_lamp", 0)).toBe("off");
  });

  it("offers experimental parameters only when asked", () => {
    expect(makerOffered(param({ verified: true }))).toBe(true);
    expect(makerOffered(param({ verified: false }))).toBe(false);
  });
});
