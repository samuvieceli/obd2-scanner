import { describe, expect, it } from "vitest";
import type { DtcInfo, DtcReport, Readiness, TestResult } from "./api";
import {
  IdleCollector,
  compareChecks,
  deleteCheck,
  evaluate,
  loadChecks,
  mergeFindings,
  missingKeyItems,
  normalizeVin,
  overall,
  saveCheck,
  type CheckData,
  type SavedCheck,
} from "./prepurchase";

const VIN = "9BWAB45UXRT000123";
const dtc = (code: string): DtcInfo => ({ code, description: "", system: "", generic: true, known: true, brand: null, translated: true });
const report = (stored: string[] = [], pending: string[] = [], permanent: string[] = []): DtcReport => ({
  stored: stored.map(dtc),
  pending: pending.map(dtc),
  permanent: permanent.map(dtc),
});
const ready = (incomplete: string[] = [], mil = false): Readiness => ({
  mil_on: mil,
  dtc_count: 0,
  compression_ignition: false,
  monitors: ["misfire", "fuel_system", "components", "catalyst", "evap_system", "o2_sensor", "o2_heater"].map((key) => ({
    key,
    state: incomplete.includes(key) ? "incomplete" : "complete",
  })).concat([{ key: "egr_vvt", state: "not_supported" }]) as Readiness["monitors"],
});

/** A healthy car where every read worked. */
function healthy(): CheckData {
  return {
    docVin: VIN,
    dashKm: 48_200,
    ecuVin: VIN,
    units: [
      { address: "7E8", role: "engine", vin: VIN },
      { address: "7E9", role: "transmission", vin: VIN },
    ],
    dtcs: report(),
    dtcsAfter: report(),
    readiness: ready(),
    counters: { distance_mil: 0, time_with_mil: 0, warmups_since_clear: 120, distance_since_clear: 9000, time_since_clear: 6000, odometer: 48_213 },
    restV: 12.6,
    crank: { volts: 10.4, samples: 6 },
    idleV: 14.1,
    idle: { seconds: 180, trimB1: 3, trimSamples: 100, maxCoolant: 90, findings: [] },
    mode06: [],
    drive: { seconds: 900, findings: [] },
  };
}

const light = (d: CheckData, id: string) => evaluate(d).find((i) => i.id === id)!;

describe("pre-purchase check", () => {
  it("a healthy car is green (apart from what the car does not report)", () => {
    const items = evaluate(healthy());
    const notGreen = items.filter((i) => i.light !== "ok" && i.light !== "unknown");
    expect(notGreen).toEqual([]);
    expect(overall(items)).toBe("ok");
    // Mode 06 empty: those items are "not checked", not green.
    expect(light(healthy(), "misfire").light).toBe("unknown");
  });

  it("normalizes VINs typed with spaces, dashes or lower case", () => {
    expect(normalizeVin(" 9bw ab45u-xrt000123 ")).toBe(VIN);
    expect(normalizeVin("9BWAB45UXRT00012")).toBeNull();
    // I, O and Q are never used in a VIN.
    expect(normalizeVin("9BWAB45UXRT00012O")).toBeNull();
  });

  it("VIN: match, mismatch and what could not be compared", () => {
    expect(light(healthy(), "vin_match").light).toBe("ok");
    expect(light({ ...healthy(), docVin: "9BWAB45UXRT000999" }, "vin_match").light).toBe("bad");
    expect(light({ ...healthy(), docVin: undefined }, "vin_match").text).toBe("noDoc");
    expect(light({ ...healthy(), ecuVin: null }, "vin_match").text).toBe("noEcu");
  });

  it("a control unit with another car's VIN is a warning", () => {
    const d = healthy();
    d.units = [...d.units!, { address: "7EA", role: "other", vin: "9BWZZZ377VT004251" }];
    const i = light(d, "unit_vins");
    expect(i.light).toBe("warn");
    expect(i.codes).toEqual(["7EA: 9BWZZZ377VT004251"]);
    expect(light({ ...healthy(), units: [{ address: "7E8", role: "engine", vin: VIN }] }, "unit_vins").light).toBe("unknown");
    expect(light({ ...healthy(), units: undefined }, "unit_vins").text).toBe("notScanned");
  });

  it("odometer: compared with the dashboard only when the car reports it", () => {
    expect(light(healthy(), "odometer").light).toBe("ok");
    expect(light({ ...healthy(), dashKm: 28_000 }, "odometer").light).toBe("bad");
    const noOdo = healthy();
    delete noOdo.counters!.odometer;
    expect(light(noOdo, "odometer").text).toBe("notSupported");
    expect(light({ ...healthy(), dashKm: undefined }, "odometer").text).toBe("noDash");
  });

  it("codes cleared recently: any counter below its limit", () => {
    const d = healthy();
    expect(light(d, "recent_clear").light).toBe("ok");
    d.counters!.distance_since_clear = 40;
    expect(light(d, "recent_clear").light).toBe("warn");
    const w = healthy();
    w.counters!.warmups_since_clear = 3;
    expect(light(w, "recent_clear").light).toBe("warn");
    expect(light({ ...healthy(), counters: {} }, "recent_clear").light).toBe("unknown");
  });

  it("readiness: one unfinished self-test is common, two are a warning", () => {
    expect(light({ ...healthy(), readiness: ready(["evap_system"]) }, "readiness")).toMatchObject({ light: "ok", text: "one" });
    const two = light({ ...healthy(), readiness: ready(["evap_system", "catalyst"]) }, "readiness");
    expect(two.light).toBe("warn");
    expect(two.codes).toEqual(["catalyst", "evap_system"]);
  });

  it("distance with the check engine light on", () => {
    const d = healthy();
    d.counters!.distance_mil = 128;
    expect(light(d, "mil_distance")).toMatchObject({ light: "warn", values: { km: 128, hours: 0 } });
  });

  it("a permanent code without the stored code means it was erased, not repaired", () => {
    expect(light({ ...healthy(), dtcs: report([], [], ["P0420"]) }, "permanent")).toMatchObject({ light: "bad", text: "erased", codes: ["P0420"] });
    expect(light({ ...healthy(), dtcs: report(["P0420"], [], ["P0420"]) }, "permanent").light).toBe("warn");
  });

  it("stored, pending and new codes", () => {
    const d = { ...healthy(), dtcs: report(["P0301"], ["P0171"]), dtcsAfter: report(["P0301", "P0300"], ["P0171"]) };
    expect(light(d, "stored")).toMatchObject({ light: "bad", codes: ["P0301"] });
    expect(light(d, "pending").light).toBe("warn");
    expect(light(d, "new_codes")).toMatchObject({ light: "bad", codes: ["P0300"] });
    expect(light({ ...healthy(), dtcsAfter: report([], ["P0300"]) }, "new_codes").light).toBe("warn");
    expect(light({ ...healthy(), dtcsAfter: undefined }, "new_codes").light).toBe("unknown");
    expect(light({ ...healthy(), readiness: ready([], true) }, "stored").text).toBe("milOnly");
  });

  it("battery, cranking and charging follow the battery test", () => {
    expect(light({ ...healthy(), restV: 11.8 }, "battery_rest").light).toBe("bad");
    expect(light({ ...healthy(), restV: 12.6, engineWasRunning: true }, "battery_rest").light).toBe("unknown");
    expect(light({ ...healthy(), crank: { volts: 9.2, samples: 5 } }, "crank").light).toBe("bad");
    expect(light({ ...healthy(), crank: null }, "crank").text).toBe("missed");
    expect(light({ ...healthy(), idleV: 12.4 }, "charging")).toMatchObject({ light: "bad", text: "not_charging" });
  });

  it("fuel trims at idle: the bank furthest from zero decides", () => {
    const idle = (trimB1: number, trimB2?: number, trimSamples = 100) => ({ ...healthy(), idle: { seconds: 180, trimB1, trimB2, trimSamples, findings: [] } });
    expect(light(idle(14), "trims")).toMatchObject({ light: "warn", text: "lean" });
    expect(light(idle(2, -25), "trims")).toMatchObject({ light: "bad", text: "rich" });
    expect(light(idle(30, undefined, 5), "trims").text).toBe("notWarm");
  });

  it("Mode 06: misfire, catalyst and O2 hints", () => {
    const r = (mid: number, tid: number, value: number, min: number, max: number, group: string, index: number): TestResult => ({
      mid, tid, uas_id: 0x24, value, min, max, unit: "", scaled: true, passed: value >= min && value <= max, group, index, test: null,
    });
    const mode06 = [
      r(0xa2, 0x0b, 40, 0, 65535, "misfire_cyl", 1),
      r(0xa2, 0x0c, 41, 0, 65535, "misfire_cyl", 1),
      r(0xa3, 0x0b, 0, 0, 65535, "misfire_cyl", 2),
      r(0xa3, 0x0c, 0, 0, 65535, "misfire_cyl", 2),
      r(0x21, 0x80, 0.82, 0, 0.75, "catalyst", 1),
    ];
    const d = { ...healthy(), mode06 };
    expect(light(d, "misfire")).toMatchObject({ light: "warn", text: "misfire_cylinder", values: { cyl: 1 } });
    expect(light(d, "catalyst")).toMatchObject({ light: "warn", text: "catalyst_test_failed" });
    expect(light(d, "o2").light).toBe("unknown");
  });

  it("findings during idle and the test drive", () => {
    const d = healthy();
    d.drive = { seconds: 600, findings: [{ id: "coolant_hot", severity: "critical", values: { value: 116 } }, { id: "x", severity: "info", values: {} }] };
    const i = light(d, "drive_findings");
    expect(i.light).toBe("bad");
    expect(i.findings?.map((f) => f.id)).toEqual(["coolant_hot", "x"]);
    expect(light({ ...healthy(), drive: undefined }, "drive_findings").text).toBe("skipped");
    expect(overall(evaluate(d))).toBe("bad");
  });

  it("overall is the worst item and key items not checked are listed", () => {
    expect(overall([])).toBe("unknown");
    const items = evaluate({});
    expect(overall(items)).toBe("unknown");
    expect(missingKeyItems(items)).toEqual(["vin_match", "odometer", "recent_clear", "permanent", "stored"]);
  });

  it("merging findings keeps the strongest of each", () => {
    const merged = mergeFindings(
      [{ id: "a", severity: "warning", values: { v: 1 } }],
      [
        { id: "a", severity: "info", values: { v: 2 } },
        { id: "b", severity: "info", values: {} },
        { id: "a", severity: "critical", values: { v: 3 } },
      ],
    );
    expect(merged).toEqual([
      { id: "a", severity: "critical", values: { v: 3 } },
      { id: "b", severity: "info", values: {} },
    ]);
  });
});

describe("idle collector", () => {
  it("averages the trims only in closed loop with the engine running", () => {
    const c = new IdleCollector();
    c.push(0, { rpm: 0, stft1: 50, ltft1: 50 });
    expect(c.running).toBe(false);
    c.push(1, { rpm: 800, coolant: 40, stft1: 20, ltft1: 20, closedLoop: 0 });
    for (let t = 2; t < 12; t++) c.push(t, { rpm: 800, coolant: 88, stft1: 4, ltft1: 6, closedLoop: 1 });
    const r = c.result(11);
    expect(r.seconds).toBe(10);
    expect(r.trimB1).toBe(10);
    expect(r.trimB2).toBeUndefined();
    expect(r.trimSamples).toBe(10);
    expect(r.maxCoolant).toBe(88);
  });

  it("without closed-loop information it waits for a warm engine", () => {
    const c = new IdleCollector();
    c.push(0, { rpm: 800, coolant: 50, stft1: 10, ltft1: 10 });
    c.push(1, { rpm: 800, coolant: 85, stft1: 1, ltft1: 1 });
    expect(c.result(1).trimB1).toBe(2);
  });
});

describe("saved checks", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };
  const check = (id: string, light: SavedCheck["light"], items = evaluate(healthy())): SavedCheck => ({ id, at: 1, name: id, light, items });

  it("saves, replaces, deletes and compares", () => {
    const store = memory();
    saveCheck(check("a", "ok"), store);
    saveCheck(check("b", "bad", evaluate({ ...healthy(), dtcs: report(["P0301"]) })), store);
    saveCheck(check("a", "warn"), store);
    expect(loadChecks(store).map((c) => [c.id, c.light])).toEqual([
      ["b", "bad"],
      ["a", "warn"],
    ]);
    const rows = compareChecks(loadChecks(store));
    expect(rows.find((r) => r.id === "stored")?.lights).toEqual(["bad", "ok"]);
    deleteCheck("b", store);
    expect(loadChecks(store).map((c) => c.id)).toEqual(["a"]);
  });

  it("broken storage gives an empty list", () => {
    expect(loadChecks({ getItem: () => "{oops" })).toEqual([]);
  });
});
