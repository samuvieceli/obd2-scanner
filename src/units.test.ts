import { describe, expect, it } from "vitest";
import { changeLanguage, consumption, convertUnitsIn, displayUnit, fromDisplay, saveUnits, toDisplay, UNIT_PRESETS, units } from "./units";
import { getLang, langFor, pidText, setLang, t } from "./i18n";

describe("units", () => {
  it("leaves metric values untouched by default", () => {
    saveUnits(UNIT_PRESETS.br);
    expect(toDisplay("km/h", 100)).toBe(100);
    expect(displayUnit("°C")).toBe("°C");
    expect(consumption(12.5)).toEqual([12.5, "km/L"]);
  });

  it("converts to US units and back", () => {
    saveUnits(UNIT_PRESETS.us);
    expect(toDisplay("km/h", 100)).toBeCloseTo(62.14, 2);
    expect(toDisplay("°C", 100)).toBeCloseTo(212, 6);
    expect(toDisplay("kPa", 100)).toBeCloseTo(14.5, 1);
    expect(displayUnit("L/h")).toBe("gal/h");
    // Alert limits are typed in the shown unit and stored in metric.
    expect(fromDisplay("°C", 230)).toBeCloseTo(110, 6);
    expect(consumption(10)[0]).toBeCloseTo(23.52, 2);
  });

  it("supports bar and L/100 km", () => {
    saveUnits(UNIT_PRESETS.eu);
    expect(toDisplay("kPa", 250)).toBeCloseTo(2.5, 6);
    expect(consumption(12.5)).toEqual([8, "L/100 km"]);
    expect(displayUnit("Pa")).toBe("Pa");
  });
});

describe("units in texts", () => {
  it("converts literal values, ranges and placeholders", () => {
    setLang("en-US");
    saveUnits(UNIT_PRESETS.us);
    expect(convertUnitsIn("Coolant below 60 °C.")).toBe("Coolant below 140 °F.");
    expect(convertUnitsIn("Hold between 32 and 42 km/h for 2 s")).toBe("Hold between 20 and 26 mph for 2 s");
    expect(convertUnitsIn("85–105 °C when warm")).toBe("185–221 °F when warm");
    expect(convertUnitsIn("~101 kPa at sea level")).toBe("~14.6 psi at sea level");
    expect(convertUnitsIn("0.5–1.2 L/h at idle")).toBe("0.13–0.32 gal/h at idle");
    expect(convertUnitsIn("{value} °C after {n} min", { value: 105, n: 15 })).toBe("221 °F after {n} min");
    expect(convertUnitsIn("{km} km since", { km: "1,000" })).toBe("621 mi since");
    // Not a value with a unit: left alone.
    expect(convertUnitsIn("8 L/100 km and km/L")).toBe("8 L/100 km and km/L");
    expect(convertUnitsIn("1.0–2.0 L engines")).toBe("1.0–2.0 L engines");
  });

  it("reads Brazilian number formats", () => {
    setLang("pt-BR");
    saveUnits({ ...UNIT_PRESETS.br, pressure: "bar", distance: "mi" });
    expect(convertUnitsIn("~101 kPa ao nível do mar")).toBe("~1,01 bar ao nível do mar");
    expect(convertUnitsIn("entre 1.200 e 1.500 km")).toBe("entre 746 e 932 mi");
    expect(convertUnitsIn("abaixo de 60 °C")).toBe("abaixo de 60 °C");
  });

  it("is applied by t() except where units must stay metric", () => {
    setLang("en-US");
    saveUnits(UNIT_PRESETS.us);
    expect(t("warmup.coldHelp")).toContain("140 °F");
    expect(t("o2test.sinceClearKm", { km: 100 })).toBe("62 mi since the codes were cleared");
    expect(t("units.names.L/100km")).toBe("L/100 km");
    expect(t("perf.intro")).toContain("0–100");
    expect(pidText("coolant_temp").typical).toBe("185–221 °F when warm");
  });
});

describe("language and units", () => {
  it("switching language applies that language's units", () => {
    changeLanguage("en-US");
    expect(units()).toEqual(UNIT_PRESETS.us);
    changeLanguage("en-GB");
    expect(units()).toEqual(UNIT_PRESETS.eu);
    expect(getLang()).toBe("en-GB");
    changeLanguage("pt-BR");
    expect(units()).toEqual(UNIT_PRESETS.br);
  });

  it("picks a language from the system locale", () => {
    expect(langFor("pt-BR")).toBe("pt-BR");
    expect(langFor("pt-PT")).toBe("pt-BR");
    expect(langFor("en-US")).toBe("en-US");
    expect(langFor("en-GB")).toBe("en-GB");
    expect(langFor("de-DE")).toBe("en-GB");
  });
});
