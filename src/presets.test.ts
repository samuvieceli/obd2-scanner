import { describe, expect, it } from "vitest";
import { matchPreset, presetAfterClick, presetKeys } from "./presets";

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

  it("full shows everything supported, and a second click goes back to it", () => {
    const has = new Set(["speed", "rpm", "coolant_temp"]);
    const all = ["speed", "rpm", "maf", "coolant_temp"];
    expect(presetKeys("full", (k) => has.has(k), all)).toEqual(["speed", "rpm", "coolant_temp"]);
    expect(matchPreset(["rpm", "speed", "coolant_temp"], (k) => has.has(k), all)).toBe("full");
    expect(matchPreset([], () => false, all)).toBeUndefined();
    expect(presetAfterClick("turbo", "turbo")).toBe("full");
    expect(presetAfterClick("turbo", "daily")).toBe("turbo");
    expect(presetAfterClick("full", "full")).toBe("full");
  });
});
