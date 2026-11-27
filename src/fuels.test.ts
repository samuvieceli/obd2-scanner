import { describe, expect, it } from "vitest";
import { FUELS, blend, flexProps, migrateFuel } from "./fuels";

describe("fuels", () => {
  it("has the known ratios of the Brazilian fuels", () => {
    expect(FUELS.gasoline_pure.afr).toBe(14.7);
    expect(FUELS.gasoline.afr).toBeCloseTo(12.8, 1); // E32
    expect(FUELS.gasoline_premium.afr).toBeCloseTo(13.2, 1); // E25
    expect(FUELS.ethanol.afr).toBeCloseTo(8.4, 1);
    expect(FUELS.diesel.afr).toBeCloseTo(14.2, 1); // B15
  });

  it("blends by mass and keeps the ends", () => {
    const a = { afr: 10, density: 1000, lhv: 40 };
    const b = { afr: 20, density: 1000, lhv: 20 };
    expect(blend(a, b, 0)).toEqual(a);
    expect(blend(a, b, 100).afr).toBe(20);
    expect(blend(a, b, 50).afr).toBe(15);
  });

  it("flex without the ethanol sensor assumes regular gasoline", () => {
    expect(flexProps(undefined)).toEqual(FUELS.gasoline);
    expect(flexProps(100).afr).toBeCloseTo(FUELS.ethanol.afr, 5);
  });

  it("migrates old profiles", () => {
    expect(migrateFuel("gasoline_e27")).toBe("gasoline");
    expect(migrateFuel("diesel")).toBe("diesel");
    expect(migrateFuel("bogus")).toBe("auto");
  });
});
