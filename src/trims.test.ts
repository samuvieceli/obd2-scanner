import { describe, expect, it } from "vitest";
import { TrimMap, bin, gradeTrim, type TrimSample } from "./trims";

function fill(m: TrimMap, rpm: number, load: number, total: number, n = 20, extra: Partial<TrimSample> = {}) {
  for (let i = 0; i < n; i++) m.push({ rpm, load, stft: total - 5, ltft: 5, closedLoop: 1, ...extra });
}

describe("fuel trim map", () => {
  it("bins values", () => {
    expect(bin(800, [1300, 2500])).toBe(0);
    expect(bin(1300, [1300, 2500])).toBe(1);
    expect(bin(4000, [1300, 2500])).toBe(2);
    expect(gradeTrim(-12)).toBe("warn");
  });

  it("ignores open loop and unknown cells until enough samples", () => {
    const m = new TrimMap();
    fill(m, 800, 20, 25, 20, { closedLoop: 0 });
    expect(m.used).toBe(0);
    fill(m, 800, 20, 5, 5);
    expect(m.mean(0, 0)).toBeUndefined();
    expect(m.pattern()).toBe("not_enough");
  });

  it("leaves out fuel cut-off and the samples right after it", () => {
    const m = new TrimMap();
    // Coasting in gear: closed loop still reported, trims dropping.
    fill(m, 2200, 4, -25, 5);
    expect(m.used).toBe(0);
    // Back on the pedal: two samples to settle, then counted.
    fill(m, 2200, 40, 2, 12);
    expect(m.used).toBe(10);
  });

  it("falls back on coolant temperature without loop status", () => {
    const m = new TrimMap();
    for (let i = 0; i < 20; i++) m.push({ rpm: 800, load: 20, stft: 3, ltft: 2, coolant: 50 });
    expect(m.used).toBe(0);
    for (let i = 0; i < 20; i++) m.push({ rpm: 800, load: 20, stft: 3, ltft: 2, coolant: 85 });
    expect(m.mean(0, 0)).toBe(5);
    expect(m.knowsLoop).toBe(false);
  });

  it("recognizes the patterns", () => {
    const leak = new TrimMap();
    fill(leak, 800, 20, 19);
    fill(leak, 800, 45, 18);
    fill(leak, 2000, 45, 5);
    fill(leak, 3000, 70, 2);
    expect(leak.pattern()).toBe("lean_idle");

    const pump = new TrimMap();
    fill(pump, 800, 20, 2);
    fill(pump, 2000, 45, 6);
    fill(pump, 3000, 70, 21);
    expect(pump.pattern()).toBe("lean_load");

    const all = new TrimMap();
    fill(all, 800, 20, 17);
    fill(all, 3000, 70, 19);
    expect(all.pattern()).toBe("lean_all");

    const purge = new TrimMap();
    fill(purge, 800, 20, -16);
    fill(purge, 2000, 45, -2);
    expect(purge.pattern()).toBe("rich_idle");

    const ok = new TrimMap();
    fill(ok, 800, 20, 3);
    fill(ok, 2000, 45, -4);
    expect(ok.pattern()).toBe("ok");
  });
});
