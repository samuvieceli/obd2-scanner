import { describe, expect, it } from "vitest";
import { analyze, economySeries, journeyInputs, logFromFrames, seriesOf, type JourneyLog } from "./journey";

const KEYS = ["speed", "rpm", "engine_load", "throttle", "coolant_temp", "stft_b1", "ltft_b1", "closed_loop_b1"];

type Sample = Partial<Record<(typeof KEYS)[number], number>> & { lph?: number };

/** A log from one sample per second. */
function log(samples: Sample[]): JourneyLog {
  return { keys: KEYS, rows: samples.map((s, i) => [i, s.lph ?? null, ...KEYS.map((k) => s[k] ?? null)]) };
}

const repeat = (n: number, s: Sample): Sample[] => Array.from({ length: n }, () => ({ ...s }));
const warm = { coolant_temp: 90, closed_loop_b1: 1, stft_b1: 1, ltft_b1: 2 };
const idle = (n: number) => repeat(n, { speed: 0, rpm: 800, engine_load: 25, throttle: 12, lph: 0.8, ...warm });
const cruise = (n: number, speed: number, lph: number) => repeat(n, { speed, rpm: speed * 25, engine_load: 40, throttle: 20, lph, ...warm });

describe("trip analysis", () => {
  it("reads what the analysis needs and the best fuel calculation the car allows", () => {
    const has = (k: string) => ["speed", "rpm", "maf", "intake_map", "intake_temp", "coolant_temp"].includes(k);
    expect(journeyInputs(has)).toEqual(["speed", "rpm", "coolant_temp", "maf"]);
    const mapOnly = (k: string) => ["speed", "rpm", "intake_map", "intake_temp"].includes(k);
    expect(journeyInputs(mapOnly)).toEqual(["speed", "rpm", "intake_map", "intake_temp"]);
  });

  it("adds up distance, fuel and economy, split by stopped, city and road", () => {
    // 10 min stopped, 30 min at 40 km/h (20 km), 30 min at 100 km/h (50 km).
    const a = analyze(log([...idle(600), ...cruise(1800, 40, 2.5), ...cruise(1800, 100, 5)]));
    expect(a.distanceKm).toBeCloseTo(70, 0);
    expect(a.idle.timeS).toBeCloseTo(600, -1);
    expect(a.city.distanceKm).toBeCloseTo(20, 0);
    expect(a.road.distanceKm).toBeCloseTo(50, 0);
    // 0.133 L stopped + 1.25 L city + 2.5 L road.
    expect(a.fuelL).toBeCloseTo(3.88, 1);
    expect(a.city.kmPerL).toBeCloseTo(16, 0);
    expect(a.road.kmPerL).toBeCloseTo(20, 0);
    expect(a.kmPerL).toBeCloseTo(70 / 3.88, 0);
    expect(a.avgMovingKmh).toBeCloseTo(70, 0);
    expect(a.bands.map((b) => b.from)).toEqual([40, 100]);
    expect(a.bestBand?.from).toBe(100);
  });

  it("leaves gaps out (program closed, link lost)", () => {
    const l = log(cruise(600, 60, 3));
    // A 2-hour hole in the middle.
    for (let i = 300; i < l.rows.length; i++) l.rows[i][0] = (l.rows[i][0] as number) + 7200;
    const a = analyze(l);
    expect(a.runningS).toBeCloseTo(598, 0);
    expect(a.distanceKm).toBeCloseTo(10, 0);
  });

  it("shows no fuel numbers when the car gives nothing to calculate them from", () => {
    const a = analyze(log(cruise(300, 60, NaN).map((s) => ({ ...s, lph: undefined }))));
    expect(a.fuelL).toBeUndefined();
    expect(a.kmPerL).toBeUndefined();
    expect(a.distanceKm).toBeCloseTo(5, 0);
  });

  it("points at long idling and at fast road driving", () => {
    const a = analyze(log([...idle(900), ...cruise(1200, 90, 4.5), ...cruise(1200, 120, 8)]));
    const ids = a.tips.map((t) => t.id);
    expect(ids).toContain("idle");
    expect(ids).toContain("fast");
    const fast = a.tips.find((t) => t.id === "fast")!;
    // 20 km/L at 90 against 15 km/L at 120: 25% worse.
    expect(fast.params.pct).toBe(25);
  });

  it("counts hard accelerations and braking once per manoeuvre", () => {
    const s: Sample[] = [...cruise(5, 20, 2)];
    for (const v of [32, 44, 56]) s.push({ ...cruise(1, v, 6)[0] }); // +12 km/h per second
    s.push(...cruise(10, 56, 3));
    for (const v of [40, 24]) s.push({ ...cruise(1, v, 0.5)[0] }); // −16 km/h per second
    s.push(...cruise(5, 24, 2));
    const a = analyze(log(s));
    expect(a.hardAccels).toBe(1);
    expect(a.hardBrakes).toBe(1);
  });

  it("measures the time slowing down in gear and at high engine speed", () => {
    const coast = repeat(120, { speed: 60, rpm: 2000, engine_load: 5, throttle: 12, lph: 0.6, ...warm });
    const revs = repeat(120, { speed: 80, rpm: 4200, engine_load: 70, throttle: 60, lph: 9, ...warm });
    const a = analyze(log([...idle(30), ...cruise(360, 60, 3), ...coast, ...revs]));
    expect(a.coastShare).toBeCloseTo(120 / 600, 1);
    expect(a.highRpmShare).toBeCloseTo(120 / 630, 1);
    expect(a.tips.map((t) => t.id)).toEqual(expect.arrayContaining(["coasting", "highRpm"]));
  });

  it("follows the warm-up and the fuel used with a cold engine", () => {
    const s: Sample[] = [];
    for (let i = 0; i < 900; i++) s.push({ speed: 40, rpm: 1800, engine_load: 35, lph: 3, coolant_temp: 25 + i / 15, closed_loop_b1: 0 });
    s.push(...cruise(600, 40, 2));
    const a = analyze(log(s));
    expect(a.coolantStart).toBe(25);
    // 70 °C after (70 − 25) × 15 = 675 s.
    expect(a.warmupS).toBeCloseTo(675, -1);
    expect(a.cold.timeS).toBeCloseTo(675, -1);
    expect(a.tips.map((t) => t.id)).toContain("cold");
  });

  it("flags a lean mixture only with a warm engine in closed loop", () => {
    const lean = repeat(300, { speed: 60, rpm: 2000, engine_load: 40, lph: 3, coolant_temp: 90, closed_loop_b1: 1, stft_b1: 8, ltft_b1: 9 });
    // Open loop samples with wild trims are ignored.
    const open = repeat(300, { speed: 60, rpm: 2000, engine_load: 40, lph: 3, coolant_temp: 90, closed_loop_b1: 0, stft_b1: -20, ltft_b1: 0 });
    const a = analyze(log([...lean, ...open]));
    expect(a.trimAvg).toBeCloseTo(17, 0);
    expect(a.tips.find((t) => t.id === "mixtureLean")?.level).toBe("info");
    expect(analyze(log(cruise(300, 60, 3))).trimAvg).toBeCloseTo(3, 0);
  });

  it("compares with the car's usual economy", () => {
    const a = analyze(log(cruise(1800, 80, 4)), { avgKmPerL: 16 });
    // 20 km/L against 16: 25% better.
    expect(a.vsAverage).toBeCloseTo(25, 0);
    expect(a.tips[0].id).toBe("betterThanUsual");
  });

  it("gives economy minute by minute and thins long series keeping peaks", () => {
    const l = log(cruise(600, 60, 3));
    const e = economySeries(l);
    expect(e.v.length).toBeGreaterThanOrEqual(9);
    expect(e.v[0]).toBeCloseTo(20, 0);
    const big = log([...cruise(3000, 50, 3), { ...cruise(1, 150, 3)[0] }, ...cruise(3000, 50, 3)]);
    const s = seriesOf(big, "speed", 200);
    expect(s.v.length).toBeLessThanOrEqual(200);
    expect(Math.max(...s.v)).toBe(150);
  });

  it("turns recording frames into one sample per second, keeping values that came in other frames", () => {
    const frames = [];
    for (let i = 0; i < 40; i++) {
      // Two frames per second; speed and rpm come in alternate frames.
      frames.push({ t_ms: 10_000 + i * 500, values: i % 2 ? { rpm: 2000, maf: 10 } : { speed: 50 } });
    }
    const l = logFromFrames(frames, (v) => (v.maf !== undefined ? v.maf * 0.3 : undefined));
    expect(l.keys).toEqual(["speed", "rpm", "maf"]);
    expect(l.rows.length).toBe(20);
    expect(l.rows[0][0]).toBe(0);
    expect(l.rows[5]).toEqual([5, 3, 50, 2000, 10]);
  });
});
