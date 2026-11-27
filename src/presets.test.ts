import { describe, expect, it } from "vitest";
import { matchPreset, presetKeys } from "./presets";

describe("dashboard presets", () => {
  it("keeps only what the car supports, picking the first alternative", () => {
    const has = new Set(["speed", "rpm", "coolant_temp", "battery_voltage", "intake_map", "intake_temp"]);
    expect(presetKeys("daily", (k) => has.has(k))).toEqual(["speed", "rpm", "coolant_temp", "battery_voltage", "intake_map", "intake_temp"]);
    const maf = new Set([...has, "maf"]);
    expect(presetKeys("daily", (k) => maf.has(k))).toEqual(["speed", "rpm", "coolant_temp", "battery_voltage", "maf"]);
  });

  it("recognizes the active preset", () => {
    const all = () => true;
    expect(matchPreset(presetKeys("turbo", all), all)).toBe("turbo");
    expect(matchPreset(["rpm"], all)).toBeUndefined();
  });
});
