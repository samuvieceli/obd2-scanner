import { describe, expect, it } from "vitest";
import { hydratedShare, tripCost } from "./cost";

describe("trip cost", () => {
  const prices = { gasoline: 6.0, ethanol: 4.0, diesel: 6.5 };

  it("charges the fuel in use and compares with the other by energy", () => {
    const r = tripCost(10, "gasoline", undefined, prices);
    expect(r.cost).toBeCloseTo(60, 5);
    expect(r.asGasoline).toBeCloseTo(60, 5);
    // ~70% of the energy per litre: 10 L of E32 ≈ 14.3 L of ethanol.
    expect(r.breakEven).toBeGreaterThan(0.68);
    expect(r.breakEven).toBeLessThan(0.72);
    expect(r.asEthanol!).toBeCloseTo((10 / r.breakEven) * 4, 5);
  });

  it("flex tank: mixes the prices by the reported ethanol share", () => {
    expect(hydratedShare(32)).toBe(0);
    expect(hydratedShare(95)).toBe(1);
    expect(tripCost(10, "auto", 95, prices).cost).toBeCloseTo(40, 5);
    expect(tripCost(10, "auto", undefined, prices).cost).toBeCloseTo(60, 5);
  });

  it("no price, no cost; diesel has no flex comparison", () => {
    expect(tripCost(10, "ethanol", undefined, {}).cost).toBeUndefined();
    const d = tripCost(10, "diesel", undefined, prices);
    expect(d.cost).toBeCloseTo(65, 5);
    expect(d.asEthanol).toBeUndefined();
  });
});
