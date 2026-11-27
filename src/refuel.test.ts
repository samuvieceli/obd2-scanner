import { describe, expect, it } from "vitest";
import { advanceFill, closeFill, detectMethod, loadFill, saveFill, startFill, type FillResult } from "./refuel";

/** Drives `km` at 60 km/h burning `baseLph` (at a correction of 1). */
function drive(km: number, baseLph: number | undefined, method: "maf" | "map" = "map") {
  const f = startFill(method, 0);
  for (let i = 0; i < km * 60; i++) advanceFill(f, 1, 60, baseLph);
  return f;
}

function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
}

describe("fuel calculation method", () => {
  it("prefers fuel rate, then MAF, then MAP", () => {
    const has = (keys: string[]) => (k: string) => keys.includes(k);
    expect(detectMethod(has(["fuel_rate", "maf"]))).toBe("pid");
    expect(detectMethod(has(["maf", "rpm", "intake_map", "intake_temp"]))).toBe("maf");
    expect(detectMethod(has(["rpm", "intake_map", "intake_temp"]))).toBe("map");
    expect(detectMethod(has(["rpm", "intake_map"]))).toBeNull();
  });
});

describe("pump calibration", () => {
  it("adds up distance and base litres", () => {
    const f = drive(100, 6); // 100 km at 60 km/h = 100 min at 6 L/h = 10 L
    expect(f.distanceKm).toBeCloseTo(100, 6);
    expect(f.baseL).toBeCloseTo(10, 6);
    expect(f.missingS).toBe(0);
  });

  it("sets the volumetric efficiency from pump and calculated litres", () => {
    const f = drive(300, 6); // 30 L at 100%
    // The pump gave 24 L: the engine fills 80% of the cylinder.
    const { result, correction } = closeFill(f, 24, 0.85, [], 1);
    expect(result.used).toBe(true);
    expect(result.calcL).toBeCloseTo(25.5, 6);
    expect(result.estimate).toBeCloseTo(0.8, 6);
    expect(correction).toBeCloseTo(0.8, 6);
  });

  it("averages with earlier fills, weighted by distance", () => {
    const old: FillResult[] = [
      { at: 0, method: "map", distanceKm: 100, pumpL: 0, calcL: 0, estimate: 0.9, used: true },
      { at: 0, method: "map", distanceKm: 100, pumpL: 0, calcL: 0, estimate: 0.6, used: false, reason: "outOfRange" },
      { at: 0, method: "maf", distanceKm: 100, pumpL: 0, calcL: 0, estimate: 1.2, used: true },
    ];
    const { correction } = closeFill(drive(300, 6), 24, 0.85, old);
    // (0.9 × 100 + 0.8 × 300) / 400; the discarded and MAF fills are left out.
    expect(correction).toBeCloseTo(0.825, 6);
  });

  it("keeps only the last fills", () => {
    const old: FillResult[] = Array.from({ length: 10 }, () => ({ at: 0, method: "map", distanceKm: 100, pumpL: 0, calcL: 0, estimate: 1.1, used: true }));
    const { correction } = closeFill(drive(100, 6), 8, 0.85, old);
    // Four old fills at 1.1 plus this one at 0.8, all 100 km.
    expect(correction).toBeCloseTo(1.04, 6);
  });

  it("ignores short trips", () => {
    const r = closeFill(drive(30, 6), 2.5, 0.85, []);
    expect(r.result).toMatchObject({ used: false, reason: "short" });
    expect(r.correction).toBeUndefined();
  });

  it("ignores trips with missing readings", () => {
    const f = drive(200, 6);
    for (let i = 0; i < 2000; i++) advanceFill(f, 1, 60, undefined);
    expect(closeFill(f, 15, 0.85, []).result.reason).toBe("gaps");
  });

  it("refuses results outside the sane range", () => {
    // Pump says 40 L for 20 L at 100%: 200%, so part of the way was not read.
    expect(closeFill(drive(200, 6), 40, 0.85, []).result.reason).toBe("outOfRange");
    // A MAF factor of 95% is fine, 60% is not.
    expect(closeFill(drive(200, 6, "maf"), 19, 1, []).correction).toBeCloseTo(0.95, 6);
    expect(closeFill(drive(200, 6, "maf"), 12, 1, []).result.reason).toBe("outOfRange");
  });

  it("is saved per profile and survives bad data", () => {
    const store = memory();
    const f = drive(10, 6);
    saveFill("car", f, store);
    expect(loadFill("car", store)).toEqual(f);
    expect(loadFill("other", store)).toBeNull();
    saveFill("car", null, store);
    expect(loadFill("car", store)).toBeNull();
    store.setItem("fill:car", "{\"method\":\"x\"}");
    expect(loadFill("car", store)).toBeNull();
  });
});
