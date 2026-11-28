// Pre-purchase check: what the car's computers say about a used car, turned
// into a traffic light (green, yellow, red) per item and for the whole car.
//
// Pure logic, no DOM. The screen (views/prepurchase.ts) gathers the reads in
// five steps and hands them over as one `CheckData`; `evaluate()` grades each
// item. Every grade is an indication with something to check or ask, never a
// verdict: OBD only sees part of the car (mostly the engine), and many cars
// do not answer every request, so an item the car did not answer is
// "not checked" instead of green.
//
// What gives away a car "prepared" for sale:
// - Codes cleared shortly before (PIDs 30, 31, 4E): few warm-ups, little
//   distance or little engine time since the last clearing. Disconnecting
//   the battery does the same, so it is a question for the seller, not proof.
// - Self-tests not finished (readiness, PID 01): they reset with the codes
//   and need days of normal driving to finish again.
// - Permanent codes (mode 0A): they survive clearing and disappear only when
//   the car itself sees the fault is gone. A permanent code with no stored
//   code is the classic sign of a fault erased but not repaired.
// - Distance with the check engine light on (PID 21).
// - VIN stored in the engine computer different from the document's, or
//   different between control units: a unit from another car.
// - Odometer (PID A6): only some recent cars report it; when they do, it is
//   compared with the dashboard.
//
// Thresholds: battery and charging follow the battery test (battery.ts);
// fuel trims follow the live interpretation (±10 % attention, ±20 % problem).
import type { DtcReport, Finding, Readiness, Severity, TestResult } from "./api";
import { gradeCharge, gradeCrank, gradeRest } from "./battery";
import { mode06Hints } from "./mode06hints";

export type Light = "ok" | "warn" | "bad" | "unknown";

export const SECTIONS = ["identity", "history", "codes", "electrical", "engine", "drive"] as const;
export type Section = (typeof SECTIONS)[number];

export interface CheckItem {
  id: string;
  section: Section;
  light: Light;
  /** Text key under `prepurchase.items.<id>` (defaults to the light). */
  text: string;
  values: Record<string, number | string>;
  /** Trouble codes, monitors or units that explain the item. */
  codes?: string[];
  /** Automatic interpretation findings behind the item (idle, test drive). */
  findings?: Finding[];
}

/** A control unit found by the ECU scan, with the VIN it stores. */
export interface UnitVin {
  address: string;
  role: string;
  vin: string | null;
}

export interface CheckData {
  /** VIN typed from the document or the chassis. */
  docVin?: string;
  /** Distance shown on the dashboard, typed by the user (km). */
  dashKm?: number;
  /** VIN answered by the engine computer (mode 09). */
  ecuVin?: string | null;
  /** Control units and their VINs (CAN cars; undefined = scan not done). */
  units?: UnitVin[];
  /** Codes read with the engine off. */
  dtcs?: DtcReport;
  /** Codes read again after idling or after the test drive. */
  dtcsAfter?: DtcReport;
  readiness?: Readiness;
  /** Counters read once: distance_mil, time_with_mil, warmups_since_clear,
   *  distance_since_clear, time_since_clear, odometer. */
  counters?: Record<string, number>;
  /** Battery voltage with the engine off (V). */
  restV?: number;
  /** The engine was running when the "engine off" reads were taken. */
  engineWasRunning?: boolean;
  /** Lowest voltage while cranking; null = start not seen. */
  crank?: { volts: number; samples: number } | null;
  /** Voltage at idle with the engine running (V). */
  idleV?: number;
  idle?: IdleData;
  mode06?: TestResult[];
  drive?: DriveData;
}

export interface IdleData {
  seconds: number;
  /** Mean of short + long term fuel trim per bank, closed loop only (%). */
  trimB1?: number;
  trimB2?: number;
  /** Closed-loop samples behind the trim means. */
  trimSamples: number;
  maxCoolant?: number;
  /** Strongest live findings seen during the idle. */
  findings: Finding[];
}

export interface DriveData {
  seconds: number;
  findings: Finding[];
  maxCoolant?: number;
}

// ---------------------------------------------------------------------------
// Thresholds

/** Less than this since the last clearing counts as "recent". */
export const RECENT_KM = 300;
export const RECENT_WARMUPS = 10;
export const RECENT_MINUTES = 480;
/** Unfinished self-tests that start to matter (one is common). */
export const INCOMPLETE_WARN = 2;
/** Fuel trim (short + long term) limits at idle, %. */
export const TRIM_WARN = 10;
export const TRIM_BAD = 20;
/** Closed-loop samples needed before judging the trims. */
export const TRIM_MIN_SAMPLES = 20;
/** Odometer vs dashboard: allowed difference (km, or share of the distance). */
export const ODO_TOLERANCE_KM = 50;
export const ODO_TOLERANCE_SHARE = 0.02;

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/** VIN in upper case without spaces or dashes; null when it cannot be one. */
export function normalizeVin(text: string): string | null {
  const v = text.toUpperCase().replace(/[\s-]/g, "");
  return VIN_RE.test(v) ? v : null;
}

// ---------------------------------------------------------------------------
// Items

const item = (id: string, section: Section, light: Light, values: CheckItem["values"] = {}, text: string = light, codes?: string[]): CheckItem => ({
  id,
  section,
  light,
  text,
  values,
  ...(codes?.length ? { codes } : {}),
});

function vinMatch(d: CheckData): CheckItem {
  const doc = d.docVin ? normalizeVin(d.docVin) : null;
  const ecu = d.ecuVin ? normalizeVin(d.ecuVin) : null;
  if (!doc) return item("vin_match", "identity", "unknown", ecu ? { ecu } : {}, "noDoc");
  if (!ecu) return item("vin_match", "identity", "unknown", { doc }, "noEcu");
  return doc === ecu ? item("vin_match", "identity", "ok", { vin: ecu }) : item("vin_match", "identity", "bad", { doc, ecu });
}

function unitVins(d: CheckData): CheckItem {
  if (!d.units) return item("unit_vins", "identity", "unknown", {}, "notScanned");
  const withVin = d.units.filter((u) => u.vin);
  if (withVin.length < 2) return item("unit_vins", "identity", "unknown", { units: d.units.length }, "few");
  const reference = (d.ecuVin && normalizeVin(d.ecuVin)) ?? (withVin.find((u) => u.role === "engine") ?? withVin[0]).vin;
  const odd = withVin.filter((u) => u.vin !== reference);
  return odd.length
    ? item("unit_vins", "identity", "warn", { n: odd.length, total: withVin.length }, "warn", odd.map((u) => `${u.address}: ${u.vin}`))
    : item("unit_vins", "identity", "ok", { total: withVin.length });
}

function odometer(d: CheckData): CheckItem {
  const odo = d.counters?.odometer;
  if (odo === undefined) return item("odometer", "identity", "unknown", {}, "notSupported");
  if (d.dashKm === undefined) return item("odometer", "identity", "unknown", { odo: Math.round(odo) }, "noDash");
  const diff = Math.abs(odo - d.dashKm);
  const allowed = Math.max(ODO_TOLERANCE_KM, d.dashKm * ODO_TOLERANCE_SHARE);
  const values = { odo: Math.round(odo), dash: Math.round(d.dashKm), diff: Math.round(diff) };
  return diff <= allowed ? item("odometer", "identity", "ok", values) : item("odometer", "identity", "bad", values);
}

function recentClear(d: CheckData): CheckItem {
  const c = d.counters ?? {};
  const km = c.distance_since_clear;
  const warmups = c.warmups_since_clear;
  const minutes = c.time_since_clear;
  if (km === undefined && warmups === undefined && minutes === undefined) return item("recent_clear", "history", "unknown", {}, "notSupported");
  // A counter the car does not report shows as "—" in the text.
  const values: CheckItem["values"] = {
    km: km === undefined ? "—" : Math.round(km),
    warmups: warmups === undefined ? "—" : Math.round(warmups),
    hours: minutes === undefined ? "—" : Math.round(minutes / 6) / 10,
  };
  const recent = (km !== undefined && km < RECENT_KM) || (warmups !== undefined && warmups < RECENT_WARMUPS) || (minutes !== undefined && minutes < RECENT_MINUTES);
  return item("recent_clear", "history", recent ? "warn" : "ok", values);
}

function readiness(d: CheckData): CheckItem {
  const r = d.readiness;
  if (!r) return item("readiness", "history", "unknown", {}, "notRead");
  const supported = r.monitors.filter((m) => m.state !== "not_supported");
  const incomplete = supported.filter((m) => m.state === "incomplete").map((m) => m.key);
  const values = { n: incomplete.length, total: supported.length };
  if (!incomplete.length) return item("readiness", "history", "ok", values);
  if (incomplete.length < INCOMPLETE_WARN) return item("readiness", "history", "ok", values, "one", incomplete);
  return item("readiness", "history", "warn", values, "warn", incomplete);
}

function milDistance(d: CheckData): CheckItem {
  const km = d.counters?.distance_mil;
  const minutes = d.counters?.time_with_mil;
  if (km === undefined && minutes === undefined) return item("mil_distance", "history", "unknown", {}, "notSupported");
  const values: CheckItem["values"] = {
    km: km === undefined ? "—" : Math.round(km),
    hours: minutes === undefined ? "—" : Math.round(minutes / 6) / 10,
  };
  return (km ?? 0) > 0 || (minutes ?? 0) > 0 ? item("mil_distance", "history", "warn", values) : item("mil_distance", "history", "ok", values);
}

const codesOf = (list: { code: string }[]) => [...new Set(list.map((c) => c.code))];

function permanent(d: CheckData): CheckItem {
  if (!d.dtcs) return item("permanent", "history", "unknown", {}, "notRead");
  const perm = codesOf(d.dtcs.permanent);
  if (!perm.length) return item("permanent", "history", "ok");
  const stored = new Set(codesOf(d.dtcs.stored));
  // Permanent codes not among the stored ones: erased but not repaired.
  const erased = perm.filter((c) => !stored.has(c));
  return erased.length
    ? item("permanent", "history", "bad", { n: erased.length }, "erased", erased)
    : item("permanent", "history", "warn", { n: perm.length }, "warn", perm);
}

function storedCodes(d: CheckData): CheckItem {
  if (!d.dtcs) return item("stored", "codes", "unknown", {}, "notRead");
  const stored = codesOf(d.dtcs.stored);
  if (stored.length) return item("stored", "codes", "bad", { n: stored.length }, "bad", stored);
  // Light on without a generic code: usually a carmaker's own code.
  if (d.readiness?.mil_on) return item("stored", "codes", "warn", {}, "milOnly");
  return item("stored", "codes", "ok");
}

function pendingCodes(d: CheckData): CheckItem {
  if (!d.dtcs) return item("pending", "codes", "unknown", {}, "notRead");
  const pending = codesOf(d.dtcs.pending);
  return pending.length ? item("pending", "codes", "warn", { n: pending.length }, "warn", pending) : item("pending", "codes", "ok");
}

function newCodes(d: CheckData): CheckItem {
  if (!d.dtcs || !d.dtcsAfter) return item("new_codes", "codes", "unknown", {}, "notRead");
  const before = new Set([...d.dtcs.stored, ...d.dtcs.pending, ...d.dtcs.permanent].map((c) => c.code));
  const stored = codesOf(d.dtcsAfter.stored).filter((c) => !before.has(c));
  const other = codesOf([...d.dtcsAfter.pending, ...d.dtcsAfter.permanent]).filter((c) => !before.has(c) && !stored.includes(c));
  if (stored.length) return item("new_codes", "codes", "bad", { n: stored.length + other.length }, "bad", [...stored, ...other]);
  if (other.length) return item("new_codes", "codes", "warn", { n: other.length }, "warn", other);
  return item("new_codes", "codes", "ok");
}

const fromGrade = (g: "ok" | "warn" | "bad"): Light => g;
const volts = (v: number) => Math.round(v * 100) / 100;

function batteryRest(d: CheckData): CheckItem {
  if (d.restV === undefined) return item("battery_rest", "electrical", "unknown", {}, "notRead");
  if (d.engineWasRunning) return item("battery_rest", "electrical", "unknown", { v: volts(d.restV) }, "engineRunning");
  const r = gradeRest(d.restV);
  return item("battery_rest", "electrical", fromGrade(r.grade), { v: volts(d.restV) }, r.note === "surface" ? "surface" : r.grade);
}

function crank(d: CheckData): CheckItem {
  if (d.crank === undefined) return item("crank", "electrical", "unknown", {}, "notRead");
  if (d.crank === null) return item("crank", "electrical", "unknown", {}, "missed");
  const r = gradeCrank(d.crank.volts, d.crank.samples);
  return item("crank", "electrical", fromGrade(r.grade), { v: volts(d.crank.volts) });
}

function charging(d: CheckData): CheckItem {
  if (d.idleV === undefined) return item("charging", "electrical", "unknown", {}, "notRead");
  const r = gradeCharge(d.idleV);
  return item("charging", "electrical", fromGrade(r.grade), { v: volts(d.idleV) }, r.note ?? r.grade);
}

function trims(d: CheckData): CheckItem {
  const idle = d.idle;
  if (!idle) return item("trims", "engine", "unknown", {}, "notRead");
  const banks = [idle.trimB1, idle.trimB2].filter((v): v is number => v !== undefined);
  if (!banks.length || idle.trimSamples < TRIM_MIN_SAMPLES) return item("trims", "engine", "unknown", {}, "notWarm");
  // The bank furthest from zero decides.
  const worst = banks.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  const values = { pct: Math.round(worst * 10) / 10 };
  const size = Math.abs(worst);
  if (size <= TRIM_WARN) return item("trims", "engine", "ok", values);
  const side = worst > 0 ? "lean" : "rich";
  return item("trims", "engine", size > TRIM_BAD ? "bad" : "warn", values, side);
}

/** Mode 06 hints for one subject: misfire, catalyst or O2 sensors. */
function mode06Item(d: CheckData, id: "misfire" | "catalyst" | "o2", groups: string[], prefix: string): CheckItem {
  const list = d.mode06;
  if (!list?.length || !list.some((r) => groups.includes(r.group))) return item(id, "engine", "unknown", {}, "notSupported");
  const hints = mode06Hints(list).filter((f) => f.id.startsWith(prefix));
  if (!hints.length) return item(id, "engine", "ok");
  const light: Light = hints.some((f) => f.severity === "warning" || f.severity === "critical") ? "warn" : "ok";
  const first = hints[0];
  return item(id, "engine", light, { ...first.values }, first.id.replace(/_b[12]$/, ""), hints.map((f) => f.id));
}

export const severityLight = (s: Severity): Light => (s === "critical" ? "bad" : s === "warning" ? "warn" : "ok");

function findingsItem(id: "idle_findings" | "drive_findings", section: Section, run: { findings: Finding[] } | undefined, skipped: string): CheckItem {
  if (!run) return item(id, section, "unknown", {}, skipped);
  const relevant = run.findings.filter((f) => f.severity !== "ok");
  if (!relevant.length) return item(id, section, "ok");
  const light = worst(relevant.map((f) => severityLight(f.severity)));
  return { ...item(id, section, light, { n: relevant.length }, light === "ok" ? "info" : light), findings: relevant };
}

/** Every item, in the order shown and printed. */
export function evaluate(d: CheckData): CheckItem[] {
  return [
    vinMatch(d),
    unitVins(d),
    odometer(d),
    recentClear(d),
    readiness(d),
    milDistance(d),
    permanent(d),
    storedCodes(d),
    pendingCodes(d),
    newCodes(d),
    batteryRest(d),
    crank(d),
    charging(d),
    trims(d),
    mode06Item(d, "misfire", ["misfire_cyl"], "misfire"),
    mode06Item(d, "catalyst", ["catalyst"], "catalyst"),
    mode06Item(d, "o2", ["o2_sensor", "o2_heater"], "o2"),
    findingsItem("idle_findings", "engine", d.idle, "notRead"),
    findingsItem("drive_findings", "drive", d.drive, "skipped"),
  ];
}

const RANK: Record<Light, number> = { unknown: 0, ok: 1, warn: 2, bad: 3 };

export function worst(lights: Light[]): Light {
  return lights.reduce<Light>((a, b) => (RANK[b] > RANK[a] ? b : a), "unknown");
}

/** The car's light: the worst item; "unknown" when nothing could be checked. */
export function overall(items: CheckItem[]): Light {
  return worst(items.map((i) => i.light));
}

/** Items that matter most and could not be checked (said in the summary). */
export const KEY_ITEMS = ["vin_match", "odometer", "recent_clear", "stored", "permanent"];

export function missingKeyItems(items: CheckItem[]): string[] {
  return items.filter((i) => KEY_ITEMS.includes(i.id) && i.light === "unknown").map((i) => i.id);
}

/** Strongest finding per id (newest values), to collect them over a run. */
export function mergeFindings(into: Finding[], more: Finding[]): Finding[] {
  const out = [...into];
  for (const f of more) {
    const i = out.findIndex((x) => x.id === f.id);
    if (i < 0) out.push(f);
    else if (RANK[severityLight(f.severity)] >= RANK[severityLight(out[i].severity)]) out[i] = f;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Idle: fuel trims averaged over the closed-loop samples

export class IdleCollector {
  private start: number | undefined;
  private b1: number[] = [];
  private b2: number[] = [];
  maxCoolant: number | undefined;
  findings: Finding[] = [];

  /** One live frame (t in seconds). `closedLoop` undefined = car does not say. */
  push(t: number, v: { rpm?: number; coolant?: number; stft1?: number; ltft1?: number; stft2?: number; ltft2?: number; closedLoop?: number }) {
    if (v.rpm === undefined || v.rpm < 400) return;
    this.start ??= t;
    if (v.coolant !== undefined) this.maxCoolant = Math.max(this.maxCoolant ?? -Infinity, v.coolant);
    // Open loop (cold engine) ignores the oxygen sensor: trims mean nothing.
    if (v.closedLoop !== undefined && v.closedLoop < 0.5) return;
    if (v.closedLoop === undefined && (v.coolant === undefined || v.coolant < 70)) return;
    if (v.stft1 !== undefined && v.ltft1 !== undefined) this.b1.push(v.stft1 + v.ltft1);
    if (v.stft2 !== undefined && v.ltft2 !== undefined) this.b2.push(v.stft2 + v.ltft2);
  }

  addFindings(list: Finding[]) {
    this.findings = mergeFindings(this.findings, list);
  }

  /** Seconds of running engine seen so far. */
  elapsed(t: number | undefined): number {
    return this.start === undefined || t === undefined ? 0 : t - this.start;
  }

  get running(): boolean {
    return this.start !== undefined;
  }

  result(t: number | undefined): IdleData {
    const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);
    return {
      seconds: Math.round(this.elapsed(t)),
      trimB1: mean(this.b1),
      trimB2: mean(this.b2),
      trimSamples: Math.max(this.b1.length, this.b2.length),
      maxCoolant: this.maxCoolant,
      findings: this.findings,
    };
  }
}

// ---------------------------------------------------------------------------
// History of checks, so several cars can be compared

export interface SavedCheck {
  id: string;
  /** When the check was finished (ms since 1970). */
  at: number;
  /** Name the user gave the car ("Onix prata do anúncio"). */
  name: string;
  vin?: string;
  dashKm?: number;
  light: Light;
  items: CheckItem[];
  /** Trouble code descriptions as read, by code (for the report). */
  dtcText?: Record<string, string>;
}

export const MAX_CHECKS = 30;
const KEY = "prepurchaseChecks";

export function loadChecks(store: Pick<Storage, "getItem"> = localStorage): SavedCheck[] {
  try {
    const v: unknown = JSON.parse(store.getItem(KEY) ?? "[]");
    return Array.isArray(v) ? (v as SavedCheck[]) : [];
  } catch {
    return [];
  }
}

function writeChecks(list: SavedCheck[], store: Pick<Storage, "setItem">) {
  try {
    store.setItem(KEY, JSON.stringify(list.slice(-MAX_CHECKS)));
  } catch {
    /* storage full or blocked: kept for this session only */
  }
}

/** Adds or replaces (same id) a check; the newest MAX_CHECKS are kept. */
export function saveCheck(c: SavedCheck, store: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  writeChecks([...loadChecks(store).filter((x) => x.id !== c.id), c], store);
}

export function deleteCheck(id: string, store: Pick<Storage, "getItem" | "setItem"> = localStorage) {
  writeChecks(loadChecks(store).filter((x) => x.id !== id), store);
}

/** Rows of the side-by-side comparison: each item id with its light per check. */
export function compareChecks(checks: SavedCheck[]): { id: string; lights: Light[] }[] {
  const ids: string[] = [];
  for (const c of checks) for (const i of c.items) if (!ids.includes(i.id)) ids.push(i.id);
  return ids.map((id) => ({ id, lights: checks.map((c) => c.items.find((i) => i.id === id)?.light ?? "unknown") }));
}
