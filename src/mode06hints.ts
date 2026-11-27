// Plain-language hints from the computer's own test results (Mode 06).
//
// Pure logic, no DOM. The table of Mode 06 results is hard to read; these
// rules pick out the few patterns that are well known and safe to point at.
// Like the live interpretation, each hint is an indication with a check to
// make, never a verdict:
//
// - Misfire counters per cylinder (MID $A2–$AD): TID $0B is the average of
//   the last 10 driving cycles, TID $0C the current or last cycle. One
//   cylinder counting far more than the others points to that cylinder's
//   spark plug, coil or injector; several cylinders together point to
//   something they share (fuel, air leak, coil pack).
// - Catalyst (MID $21/$22): a failed test is the early version of code P0420
//   (P0430 bank 2). A pass very close to the upper limit means it is ageing.
//   Only limits starting at 0 are judged for "near the limit", because with
//   other limits we cannot tell which side is the bad one.
// - Front O2 sensor or its heater with a failed test.
import type { Finding, TestResult } from "./api";

/** Misfire counts that start to matter (average of 10 cycles / last cycle). */
export const MISFIRE_AVG = 5;
export const MISFIRE_RECENT = 10;
/** A cylinder stands out when it counts this many times the others' mean. */
export const STANDOUT = 3;
/** "Near the limit": within this share of the allowed range. */
export const NEAR_LIMIT = 0.1;

interface Counts {
  avg?: number;
  recent?: number;
}

const COUNT_UAS = 0x24;

function misfireHints(list: TestResult[]): Finding[] {
  const cyl = new Map<number, Counts>();
  for (const r of list) {
    if (r.group !== "misfire_cyl" || r.uas_id !== COUNT_UAS) continue;
    const c = cyl.get(r.index) ?? {};
    if (r.tid === 0x0b) c.avg = r.value;
    if (r.tid === 0x0c) c.recent = r.value;
    cyl.set(r.index, c);
  }
  if (cyl.size < 2) return [];
  const score = (c: Counts) => Math.max((c.avg ?? 0) / MISFIRE_AVG, (c.recent ?? 0) / MISFIRE_RECENT);
  const bad = [...cyl].filter(([, c]) => score(c) >= 1);
  if (!bad.length) return [];
  const values = (n: number, c: Counts) => ({ cyl: n, avg: c.avg ?? 0, recent: c.recent ?? 0 });
  if (bad.length === 1) {
    const [n, c] = bad[0];
    const others = [...cyl].filter(([k]) => k !== n).map(([, o]) => score(o));
    const mean = others.reduce((a, b) => a + b, 0) / others.length;
    if (score(c) >= STANDOUT * mean) return [{ id: "misfire_cylinder", severity: "warning", values: values(n, c) }];
  }
  // Several cylinders (or one barely ahead of the others).
  const count = [...cyl.values()].filter((c) => score(c) >= 0.5).length;
  return [{ id: "misfire_multiple", severity: "warning", values: { count } }];
}

function catalystHints(list: TestResult[]): Finding[] {
  const out: Finding[] = [];
  for (const bank of [1, 2]) {
    const tests = list.filter((r) => r.group === "catalyst" && r.index === bank && r.scaled);
    if (tests.some((r) => !r.passed)) {
      out.push({ id: `catalyst_test_failed_b${bank}`, severity: "warning", values: {} });
    } else if (tests.some((r) => r.min === 0 && r.max > 0 && (r.max - r.value) / r.max < NEAR_LIMIT)) {
      out.push({ id: `catalyst_near_limit_b${bank}`, severity: "info", values: {} });
    }
  }
  return out;
}

function o2Hints(list: TestResult[]): Finding[] {
  const out: Finding[] = [];
  for (const group of ["o2_sensor", "o2_heater"]) {
    const failed = new Set(list.filter((r) => r.group === group && r.scaled && !r.passed).map((r) => r.index));
    for (const index of [...failed].sort((a, b) => a - b)) {
      out.push({
        id: group === "o2_sensor" ? "o2_test_failed" : "o2_heater_test_failed",
        severity: "warning",
        values: { bank: Math.floor((index - 1) / 4) + 1, sensor: ((index - 1) % 4) + 1 },
      });
    }
  }
  return out;
}

/** Hints for a list of Mode 06 results, most important first. */
export function mode06Hints(list: TestResult[]): Finding[] {
  return [...misfireHints(list), ...catalystHints(list), ...o2Hints(list)];
}
