import { describe, expect, it } from "vitest";
import { calcInputs, isCalc } from "./calc";

const has = (keys: string[]) => (k: string) => keys.includes(k);

describe("calculated parameters", () => {
  it("prefers the fuel rate PID, then MAF, then MAP", () => {
    expect(calcInputs("calc_fuel_flow", has(["fuel_rate", "maf"]))).toEqual(["fuel_rate"]);
    expect(calcInputs("calc_fuel_flow", has(["maf", "intake_map"]))).toEqual(["maf"]);
    expect(calcInputs("calc_fuel_flow", has(["rpm", "intake_map", "intake_temp"]))).toEqual(["rpm", "intake_map", "intake_temp"]);
  });
  it("is unavailable without the inputs", () => {
    expect(calcInputs("calc_fuel_flow", has(["rpm", "intake_map"]))).toBeNull();
    expect(calcInputs("calc_economy", has(["maf"]))).toBeNull();
    expect(calcInputs("calc_economy", has(["maf", "speed"]))).toEqual(["maf", "speed"]);
  });
  it("tells calculated keys apart", () => {
    expect(isCalc("calc_economy")).toBe(true);
    expect(isCalc("rpm")).toBe(false);
  });
});
