import { describe, expect, it } from "vitest";
import { consumption, displayUnit, fromDisplay, saveUnits, toDisplay, UNIT_PRESETS } from "./units";

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
