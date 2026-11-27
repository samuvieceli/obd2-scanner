import { describe, expect, it } from "vitest";
import { PerfDetector, type PerfResult } from "./perf";

/** Feeds a speed profile `v(t)` sampled at `hz` from `t0` to `t1` seconds. */
function drive(d: PerfDetector, v: (t: number) => number, t0: number, t1: number, hz = 5): PerfResult[] {
  const out: PerfResult[] = [];
  for (let t = t0; t <= t1 + 1e-9; t += 1 / hz) out.push(...d.push(Math.round(t * 1000) / 1000, v(t)));
  return out;
}

describe("PerfDetector", () => {
  it("times 0-100 from the moment the car moves, not when the test was armed", () => {
    const d = new PerfDetector();
    // Stopped 3 s, then 10 km/h per second from t = 3.1 → 100 km/h at t = 13.1.
    const v = (t: number) => (t < 3.1 ? 0 : Math.min(130, (t - 3.1) * 10));
    const r = drive(d, v, 0, 16, 5).filter((x) => x.test === "0-100");
    expect(r).toHaveLength(1);
    expect(r[0].timeS).toBeCloseTo(10, 0);
    expect(Math.abs(r[0].timeS - 10)).toBeLessThan(0.05);
    // Distance of a uniform 0→100 km/h in 10 s: 138.9 m.
    expect(r[0].distanceM).toBeGreaterThan(125);
    expect(r[0].distanceM).toBeLessThan(150);
    expect(r[0].avgG).toBeCloseTo(0.283, 2);
  });

  it("stays precise with a slow adapter (2 readings per second)", () => {
    const d = new PerfDetector();
    const v = (t: number) => (t < 2.3 ? 0 : Math.min(120, (t - 2.3) * 12));
    const r = drive(d, v, 0, 15, 2).filter((x) => x.test === "0-100");
    expect(r).toHaveLength(1);
    expect(Math.abs(r[0].timeS - 100 / 12)).toBeLessThan(0.1);
  });

  it("detects 40-80 and 80-120 in the same pull", () => {
    const d = new PerfDetector();
    // Cruise at 30, then accelerate 5 km/h per second.
    const v = (t: number) => (t < 2 ? 30 : 30 + (t - 2) * 5);
    const r = drive(d, v, 0, 22, 10);
    const by = Object.fromEntries(r.map((x) => [x.test, x.timeS]));
    expect(by["40-80"]).toBeCloseTo(8, 1);
    expect(by["80-120"]).toBeCloseTo(8, 1);
    expect(by["0-100"]).toBeUndefined();
  });

  it("does not start a rolling test when merely cruising across the limit", () => {
    const d = new PerfDetector();
    // Slowly drifting 39 → 41, then cruising: no 40-80 should complete or run.
    const v = (t: number) => (t < 4 ? 39 + t * 0.5 : 41);
    drive(d, v, 0, 10, 5);
    const s = d.status().find((x) => x.test === "40-80");
    expect(s?.phase).not.toBe("running");
  });

  it("measures 100-0 braking time and distance", () => {
    const d = new PerfDetector();
    // 110 km/h, then −36 km/h per second (≈1 g) → stops in about 3.06 s after 110.
    const v = (t: number) => (t < 2 ? 110 : Math.max(0, 110 - (t - 2) * 36));
    const r = drive(d, v, 0, 8, 10).filter((x) => x.test === "100-0");
    expect(r).toHaveLength(1);
    expect(r[0].timeS).toBeCloseTo(100 / 36, 1);
    // 100 km/h to 0 at 10 m/s²: v²/2a ≈ 38.6 m.
    expect(r[0].distanceM).toBeGreaterThan(35);
    expect(r[0].distanceM).toBeLessThan(42);
    expect(r[0].avgG).toBeLessThan(0);
  });

  it("discards an acceleration aborted by lifting off", () => {
    const d = new PerfDetector();
    const v = (t: number) => (t < 1 ? 0 : t < 5 ? (t - 1) * 15 : Math.max(0, 60 - (t - 5) * 10));
    const r = drive(d, v, 0, 12, 5);
    expect(r).toHaveLength(0);
    expect(d.status().find((x) => x.test === "0-100")?.phase).not.toBe("running");
  });

  it("aborts runs after a gap in the data", () => {
    const d = new PerfDetector();
    d.push(0, 0);
    d.push(1, 0);
    d.push(1.2, 5);
    expect(d.status().find((x) => x.test === "0-100")?.phase).toBe("running");
    d.push(5, 120); // 3.8 s without samples
    expect(d.status().find((x) => x.test === "0-100")?.phase).not.toBe("running");
  });

  it("is ready for 0-100 only after half a second stopped", () => {
    const d = new PerfDetector();
    d.push(0, 0);
    expect(d.status()[0].phase).toBe("waiting");
    d.push(0.6, 0);
    expect(d.status()[0].phase).toBe("ready");
  });
});
