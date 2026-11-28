import { describe, expect, it } from "vitest";
import { FUEL_IDS, FUELS, blend, equivalentFuel, flexProps, migrateFuel, regionFuels } from "./fuels";

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

  it("has the blends sold in the USA and in Europe", () => {
    expect(FUELS.us_regular.afr).toBeCloseTo(14.1, 1); // E10
    expect(FUELS.us_e85.afr).toBeCloseTo(10.5, 0);
    expect(FUELS.eu_e5.afr).toBeCloseTo(14.4, 1);
    expect(FUELS.eu_diesel.afr).toBeCloseTo(14.4, 1); // B7
    expect(FUELS.eu_lpg.density).toBeLessThan(600);
    for (const id of FUEL_IDS) {
      expect(FUELS[id].afr, id).toBeGreaterThan(8);
      expect(FUELS[id].afr, id).toBeLessThan(16);
    }
  });

  it("lists each region's fuels and moves a car to the same kind", () => {
    expect(regionFuels("br")).toEqual(["gasoline", "gasoline_premium", "ethanol", "diesel", "gasoline_pure"]);
    expect(equivalentFuel("gasoline", "us")).toBe("us_regular");
    expect(equivalentFuel("us_regular", "br")).toBe("gasoline");
    expect(equivalentFuel("us_midgrade", "eu")).toBe("eu_e10");
    expect(equivalentFuel("gasoline_pure", "eu")).toBe("eu_e5");
    expect(equivalentFuel("ethanol", "eu")).toBe("eu_e85");
    expect(equivalentFuel("eu_hvo", "us")).toBe("us_diesel");
    expect(equivalentFuel("auto", "us")).toBe("auto");
    // No LPG in Brazil: the car keeps it.
    expect(equivalentFuel("eu_lpg", "br")).toBe("eu_lpg");
  });

  it("flex outside Brazil mixes gasoline with anhydrous ethanol", () => {
    expect(flexProps(undefined, "us")).toEqual(FUELS.us_regular);
    expect(flexProps(75, "eu").afr).toBeCloseTo(FUELS.eu_e85.afr, 5);
    expect(migrateFuel("us_e15")).toBe("us_e15");
  });
});
