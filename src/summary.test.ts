import { describe, expect, it } from "vitest";
import { Drive, MIN_DRIVE_S } from "./summary";

function drive(d: Drive, seconds: number, v: Record<string, number>, lph?: number) {
  let out;
  for (let i = 0; i < seconds; i++) out = d.push(1, v, lph, 1000) ?? out;
  return out;
}

describe("post-trip summary", () => {
  it("adds moving and idle time, distance, fuel and peaks", () => {
    const d = new Drive();
    d.push(0, { rpm: 800, speed: 0 });
    drive(d, 60, { rpm: 800, speed: 0, coolant_temp: 70, battery_voltage: 14.2 }, 0.6);
    drive(d, 120, { rpm: 2500, speed: 60, coolant_temp: 92, battery_voltage: 13.9 }, 6);
    d.noteAlert("coolant_temp");
    d.noteAlert("coolant_temp");
    expect(drive(d, 2, { rpm: 0, speed: 0 })).toBeUndefined();
    const s = drive(d, 2, { rpm: 0, speed: 0 })!;
    expect(s.reason).toBe("engine_off");
    expect(s.runningS).toBe(180);
    expect(s.idleS).toBe(60);
    expect(s.movingS).toBe(120);
    expect(s.distanceKm).toBeCloseTo(2, 5);
    expect(s.fuelL).toBeCloseTo(0.01 + 0.2, 5);
    expect(s.avgMovingKmh).toBeCloseTo(60, 5);
    expect(s.maxRpm).toBe(2500);
    expect(s.maxCoolant).toBe(92);
    expect(s.minBatteryRunning).toBe(13.9);
    expect(s.alerts).toEqual(["coolant_temp"]);
    expect(s.endedAt).toBe(1000);
  });

  it("skips short drives and engine-off frames before the start", () => {
    const d = new Drive();
    expect(drive(d, 10, { rpm: 0 })).toBeUndefined();
    expect(d.started).toBe(false);
    drive(d, MIN_DRIVE_S - 10, { rpm: 800, speed: 0 });
    expect(drive(d, 5, { rpm: 0 })).toBeUndefined();
    expect(d.started).toBe(false);
  });

  it("ignores gaps and missing RPM, and ends on disconnect", () => {
    const d = new Drive();
    drive(d, 150, { rpm: 900, speed: 0 });
    d.push(30, { rpm: 900, speed: 0 }); // gap: not counted
    drive(d, 10, { speed: 0 }); // no RPM answer: not a stop
    const s = d.finish("disconnected")!;
    expect(s.runningS).toBe(150);
    expect(s.reason).toBe("disconnected");
    expect(s.avgMovingKmh).toBeUndefined();
    expect(d.finish("disconnected")).toBeUndefined();
  });
});
