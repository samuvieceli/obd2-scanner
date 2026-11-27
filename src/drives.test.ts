import { describe, expect, it } from "vitest";
import { compareByFuel, fuelGroup, type StoredDrive } from "./drives";

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
});
