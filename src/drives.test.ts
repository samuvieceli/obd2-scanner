import { describe, expect, it } from "vitest";
import { compareByFuel, fuelGroup, monthlyTotals, usualKmPerL, type StoredDrive } from "./drives";

function drive(fuel: StoredDrive["fuel"], km: number, l: number, extra: Partial<StoredDrive> = {}): StoredDrive {
  return {
    endedAt: 0,
    runningS: 1000,
    movingS: 800,
    idleS: 200,
    distanceKm: km,
    fuelL: l,
    alerts: [],
    reason: "engine_off",
    profileId: "default",
    fuel,
    ...extra,
  };
}

describe("trip history", () => {
  it("groups flex drives by the ethanol the car reported", () => {
    expect(fuelGroup(drive("auto", 10, 1, { ethanolPercent: 30 }))).toBe("gasoline");
    expect(fuelGroup(drive("auto", 10, 1, { ethanolPercent: 95 }))).toBe("ethanol");
    expect(fuelGroup(drive("auto", 10, 1, { ethanolPercent: 55 }))).toBe("mixed");
    expect(fuelGroup(drive("auto", 10, 1))).toBe("other");
    expect(fuelGroup(drive("gasoline_premium", 10, 1))).toBe("gasoline");
    expect(fuelGroup(drive("diesel", 10, 1))).toBe("other");
    expect(fuelGroup(drive("us_e15", 10, 1))).toBe("gasoline");
    expect(fuelGroup(drive("eu_e85", 10, 1))).toBe("ethanol");
    expect(fuelGroup(drive("eu_lpg", 10, 1))).toBe("other");
  });

  it("averages by distance over fuel, long drives weighing more", () => {
    const stats = compareByFuel([
      drive("gasoline", 100, 8),
      drive("gasoline", 10, 2, { maxCoolant: 104 }),
      drive("ethanol", 50, 6, { idleS: 500 }),
    ]);
    expect(stats.map((s) => s.group)).toEqual(["gasoline", "ethanol"]);
    expect(stats[0].kmPerL).toBeCloseTo(11, 5);
    expect(stats[0].maxCoolant).toBe(104);
    expect(stats[1].kmPerL).toBeCloseTo(50 / 6, 5);
    expect(stats[1].idleShare).toBe(0.5);
  });

  it("gives no average for tiny drives", () => {
    expect(compareByFuel([drive("ethanol", 0.5, 0.01)])[0].kmPerL).toBeUndefined();
  });

  it("adds up each month, newest first, with the cost of the drives that have one", () => {
    const nov = new Date(2026, 10, 20).getTime();
    const oct = new Date(2026, 9, 5).getTime();
    const months = monthlyTotals([
      drive("gasoline", 10, 1, { endedAt: oct, cost: 6.3 }),
      drive("gasoline", 30, 2, { endedAt: nov, cost: 12.6 }),
      drive("gasoline", 20, 1, { endedAt: nov }),
    ]);
    expect(months.map((m) => m.month)).toEqual(["2026-11", "2026-10"]);
    expect(months[0]).toMatchObject({ drives: 2, distanceKm: 50, fuelL: 3, cost: 12.6, noCost: 1 });
    expect(months[0].kmPerL).toBeCloseTo(50 / 3);
    expect(months[1].cost).toBeCloseTo(6.3);
  });

  it("knows the usual economy only with enough history", () => {
    const few = [drive("gasoline", 10, 1), drive("gasoline", 10, 1)];
    expect(usualKmPerL(few, "gasoline")).toBeUndefined();
    const enough = [...few, drive("gasoline", 20, 1)];
    expect(usualKmPerL(enough, "gasoline")).toBeCloseTo(40 / 3);
    expect(usualKmPerL(enough, "ethanol")).toBeUndefined();
  });
});
