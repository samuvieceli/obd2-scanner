import { describe, expect, it } from "vitest";
import { BatteryTest, gradeCharge, gradeRest, overall } from "./battery";

/** Feeds `volts` every `dt` seconds from `t0`; returns the next time. */
function feed(b: BatteryTest, t0: number, n: number, dt: number, volts: (i: number) => number, rpm?: number): number {
  for (let i = 0; i < n; i++) b.push(t0 + i * dt, volts(i), rpm);
  return t0 + n * dt;
}

describe("battery test", () => {
  it("runs the three steps of a healthy car", () => {
    const b = new BatteryTest();
    let t = feed(b, 0, 40, 0.1, () => 12.55);
    expect(b.step).toBe("crank");
    expect(b.result.rest).toMatchObject({ grade: "ok" });
    // Cranking: 1 s at ~10.4 V, then the alternator takes over.
    t = feed(b, t, 10, 0.1, (i) => 10.3 + i * 0.02);
    t = feed(b, t, 15, 0.1, () => 14.1);
    expect(b.step).toBe("charge");
    expect(b.result.crank).toMatchObject({ grade: "ok", volts: 10.3 });
    t = feed(b, t, 60, 0.1, () => 14.2, 800);
    expect(b.status().charge).toBe("loaded");
    // Waits while the rpm is not near 2000.
    t = feed(b, t, 20, 0.1, () => 14.2, 1200);
    expect(b.status().hold).toBe("rpm_range");
    feed(b, t, 60, 0.1, () => 13.9, 2000);
    expect(b.step).toBe("done");
    expect(overall(b.result)).toBe("ok");
  });

  it("starts the rest measurement over when the voltage moves", () => {
    const b = new BatteryTest();
    const t = feed(b, 0, 20, 0.1, (i) => (i < 10 ? 12.6 : 12.2));
    expect(b.step).toBe("rest");
    feed(b, t, 31, 0.1, () => 12.2);
    expect(b.result.rest).toMatchObject({ grade: "warn" });
  });

  it("refuses a rest value with the engine running", () => {
    const b = new BatteryTest();
    feed(b, 0, 50, 0.1, () => 14.1);
    expect(b.step).toBe("rest");
    expect(b.status().hold).toBe("engine_running");
  });

  it("says when the start was not seen", () => {
    const b = new BatteryTest();
    let t = feed(b, 0, 40, 0.1, () => 12.5);
    b.adapterReset();
    t = feed(b, t + 3, 20, 0.1, () => 14.0);
    expect(b.step).toBe("charge");
    expect(b.result.crank).toBeNull();
    expect(b.result.crankMissed).toBe("adapter_reset");
  });

  it("grades charging with smart alternators in mind", () => {
    expect(gradeCharge(13.0)).toMatchObject({ grade: "warn", note: "smart" });
    expect(gradeCharge(12.5).grade).toBe("bad");
    expect(gradeCharge(15.5).grade).toBe("bad");
    expect(gradeRest(13.1).note).toBe("surface");
  });
});
