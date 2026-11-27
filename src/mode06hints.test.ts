import { describe, expect, it } from "vitest";
import type { TestResult } from "./api";
import { mode06Hints } from "./mode06hints";

function r(mid: number, tid: number, value: number, min = 0, max = 65535, uas_id = 0x24): TestResult {
  const misfire = mid >= 0xa2 && mid <= 0xad;
  const group = misfire ? "misfire_cyl" : mid >= 0x21 && mid <= 0x24 ? "catalyst" : mid <= 0x10 ? "o2_sensor" : mid >= 0x41 && mid <= 0x50 ? "o2_heater" : "other";
  const index = misfire ? mid - 0xa1 : group === "catalyst" ? mid - 0x20 : group === "o2_heater" ? mid - 0x40 : mid;
  return { mid, tid, uas_id, value, min, max, unit: "", scaled: true, passed: value >= min && value <= max, group, index, test: null };
}

/** Misfire counters (average, recent) for cylinders 1..n. */
const cylinders = (counts: [number, number][]) => counts.flatMap(([avg, recent], i) => [r(0xa2 + i, 0x0b, avg), r(0xa2 + i, 0x0c, recent)]);
const ids = (l: TestResult[]) => mode06Hints(l).map((f) => f.id);

describe("misfire counters", () => {
  it("points to the one cylinder that stands out", () => {
    const f = mode06Hints(cylinders([[0, 0], [4, 41], [0, 1], [0, 0]]));
    expect(f).toEqual([{ id: "misfire_cylinder", severity: "warning", values: { cyl: 2, avg: 4, recent: 41 } }]);
  });

  it("several cylinders together", () => {
    const f = mode06Hints(cylinders([[8, 20], [7, 15], [0, 2], [6, 12]]));
    expect(f[0]).toMatchObject({ id: "misfire_multiple", values: { count: 3 } });
  });

  it("small counts are normal", () => {
    expect(ids(cylinders([[1, 3], [0, 2], [2, 4], [0, 0]]))).toEqual([]);
  });

  it("needs at least two cylinders to compare and ignores the general counter", () => {
    expect(ids(cylinders([[20, 50]]))).toEqual([]);
    expect(ids([r(0xa1, 0x0b, 30), r(0xa1, 0x0c, 80)])).toEqual([]);
  });
});

describe("catalyst", () => {
  it("failed test", () => {
    expect(ids([r(0x21, 0x80, 210, 0, 192, 0x20)])).toEqual(["catalyst_test_failed_b1"]);
  });

  it("near the upper limit", () => {
    expect(ids([r(0x22, 0x80, 185, 0, 192, 0x20)])).toEqual(["catalyst_near_limit_b2"]);
  });

  it("comfortable pass, or limits not starting at zero", () => {
    expect(ids([r(0x21, 0x80, 150, 0, 192, 0x20)])).toEqual([]);
    expect(ids([r(0x21, 0x80, 99, 50, 100, 0x20)])).toEqual([]);
  });
});

describe("O2 sensors", () => {
  it("failed sensor and heater tests name bank and sensor", () => {
    const f = mode06Hints([r(0x02, 0x07, 400, 0, 300, 0x0a), r(0x02, 0x08, 900, 0, 300, 0x0a), r(0x46, 0x81, 80, 0, 60, 0x10)]);
    expect(f).toEqual([
      { id: "o2_test_failed", severity: "warning", values: { bank: 1, sensor: 2 } },
      { id: "o2_heater_test_failed", severity: "warning", values: { bank: 2, sensor: 2 } },
    ]);
  });

  it("unscaled (manufacturer) values are not judged", () => {
    expect(ids([{ ...r(0x01, 0x90, 99, 0, 20, 0x7e), scaled: false }])).toEqual([]);
  });
});
