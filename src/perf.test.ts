import { describe, expect, it } from "vitest";
import { DEFAULT_TEST, PERF_TESTS, PerfDetector, chosenTest, type PerfResult } from "./perf";

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

  it("times 40-80 after a steady cruise and a kick", () => {
    const d = new PerfDetector();
    // Cruise at 35 km/h for 3 s, then 5 km/h per second → 40 at t = 4, 80 at t = 12.
    const v = (t: number) => (t < 3 ? 35 : 35 + (t - 3) * 5);
    const r = drive(d, v, 0, 14, 10).filter((x) => x.test === "40-80");
    expect(r).toHaveLength(1);
    expect(r[0].timeS).toBeCloseTo(8, 1);
  });

  it("starts at the kick when cruising right at the start speed", () => {
    const d = new PerfDetector();
    const v = (t: number) => (t < 3 ? 40 : 40 + (t - 3) * 5);
    const r = drive(d, v, 0, 13, 10).filter((x) => x.test === "40-80");
    expect(r).toHaveLength(1);
    expect(r[0].timeS).toBeCloseTo(8, 1);
  });

  it("ignores speeds passed through during an acceleration already going on", () => {
    // Samuel's point: from a lower speed, at 80 the car is already in a low
    // gear with the turbo spooled, so that 80-120 is not a real overtaking.
    const d = new PerfDetector();
    const v = (t: number) => (t < 2 ? 35 : 35 + (t - 2) * 5);
    const r = drive(d, v, 0, 22, 10);
    expect(r.map((x) => x.test)).toEqual(["40-80"]);
    // Cruising far below the start speed does not count either.
    const d2 = new PerfDetector();
    expect(drive(d2, (t) => (t < 3 ? 20 : 20 + (t - 3) * 5), 0, 18, 10).filter((x) => x.test === "40-80")).toHaveLength(0);
  });

  it("needs a steady cruise, not a wavering speed", () => {
    const d = new PerfDetector();
    // Speed swinging ±4 km/h around 36 before the kick.
    const v = (t: number) => (t < 3 ? 36 + 4 * Math.sin(t * 6) : 36 + (t - 3) * 5);
    expect(drive(d, v, 0, 14, 10).filter((x) => x.test === "40-80")).toHaveLength(0);
  });

  it("works with a slow adapter (2 readings per second)", () => {
    const d = new PerfDetector();
    const v = (t: number) => (t < 4 ? 76 : 76 + (t - 4) * 4);
    const r = drive(d, v, 0, 20, 2).filter((x) => x.test === "80-120");
    expect(r).toHaveLength(1);
    expect(Math.abs(r[0].timeS - 10)).toBeLessThan(0.3);
  });

  it("drops the kick when the driver lifts off before the start speed", () => {
    const d = new PerfDetector();
    const v = (t: number) => (t < 3 ? 34 : t < 4 ? 34 + (t - 3) * 4 : t < 6 ? 38 - (t - 4) * 2 : 34 + (t - 6) * 0.1);
    drive(d, v, 0, 10, 10);
    expect(d.status().find((x) => x.test === "40-80")?.phase).not.toBe("running");
  });

  it("only watches the chosen tests", () => {
    const d = new PerfDetector(PERF_TESTS.filter((x) => x.id === "0-100"));
    const v = (t: number) => (t < 3 ? 35 : 35 + (t - 3) * 5);
    expect(drive(d, v, 0, 14, 10)).toHaveLength(0);
    expect(d.status().map((x) => x.test)).toEqual(["0-100"]);
  });

  it("one test at a time: a 0-100 pull is ignored while 40-80 is the chosen test", () => {
    const d = new PerfDetector(PERF_TESTS.filter((x) => x.id === "40-80"));
    const v = (t: number) => (t < 2 ? 0 : Math.min(130, (t - 2) * 10));
    expect(drive(d, v, 0, 16, 10)).toHaveLength(0);
  });

  it("keeps the chosen test, falling back to 0-100", () => {
    expect(chosenTest("80-120")).toBe("80-120");
    expect(chosenTest(undefined)).toBe(DEFAULT_TEST);
    expect(chosenTest("0-200")).toBe("0-100");
  });

  it("is ready for a rolling test only while cruising near its start speed", () => {
    const d = new PerfDetector();
    drive(d, () => 37, 0, 3, 5);
    expect(d.status().find((x) => x.test === "40-80")?.phase).toBe("ready");
    expect(d.status().find((x) => x.test === "80-120")?.phase).toBe("waiting");
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
