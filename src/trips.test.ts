import { describe, expect, it } from "vitest";
import { advance, average, loadMeters, newMeter, resetMeter, saveMeters, type TripMeters } from "./trips";

const fresh = (): TripMeters => ({ a: newMeter(0), b: newMeter(0) });

/** In-memory replacement for localStorage. */
function memory() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
}

describe("Trip A and Trip B", () => {
  it("count distance, fuel and time while running", () => {
    const m = fresh();
    // One hour in 1 s steps at 60 km/h using 6 L/h.
    for (let i = 0; i < 3600; i++) advance(m, 1, 60, 6);
    expect(m.a.distanceKm).toBeCloseTo(60, 6);
    expect(m.a.fuelL).toBeCloseTo(6, 6);
    expect(m.a.timeS).toBe(3600);
    expect(average(m.a)).toBeCloseTo(10, 6);
    expect(m.b).toEqual(m.a);
  });

  it("are independent: pausing or resetting one leaves the other alone", () => {
    const m = fresh();
    advance(m, 1, 36, 3);
    m.b.running = false;
    advance(m, 1, 36, 3);
    expect(m.a.distanceKm).toBeCloseTo(0.02, 6);
    expect(m.b.distanceKm).toBeCloseTo(0.01, 6);
    resetMeter(m, "a", 123);
    expect(m.a).toEqual({ running: true, timeS: 0, distanceKm: 0, fuelL: 0, since: 123 });
    expect(m.b.distanceKm).toBeCloseTo(0.01, 6);
    // Reset keeps the paused state of the meter.
    resetMeter(m, "b", 5);
    expect(m.b.running).toBe(false);
    m.b.running = true;
    advance(m, 1, 36, 3);
    expect(m.b.distanceKm).toBeCloseTo(0.01, 6);
  });

  it("ignore gaps in the data and missing values", () => {
    const m = fresh();
    advance(m, 30, 100, 10); // 30 s without readings: not counted
    advance(m, 0, 100, 10);
    expect(m.a.timeS).toBe(0);
    advance(m, 1, undefined, 2);
    expect(m.a.distanceKm).toBe(0);
    expect(m.a.fuelL).toBeCloseTo(2 / 3600, 9);
    expect(average(m.a)).toBeUndefined();
  });

  it("are saved per vehicle profile", () => {
    const store = memory();
    const m = fresh();
    advance(m, 1, 72, 6);
    m.b.running = false;
    saveMeters("car1", m, store);
    expect(loadMeters("car1", store)).toEqual(m);
    // Another car starts from zero.
    expect(loadMeters("car2", store).a.distanceKm).toBe(0);
  });

  it("recover from damaged saved data", () => {
    const store = memory();
    store.setItem("trips:car1", '{"a":{"running":true,"timeS":-1},"b":"x"}');
    const m = loadMeters("car1", store);
    expect(m.a.timeS).toBe(0);
    expect(m.b.running).toBe(true);
    store.setItem("trips:car1", "not json");
    expect(loadMeters("car1", store).a.distanceKm).toBe(0);
  });
});
