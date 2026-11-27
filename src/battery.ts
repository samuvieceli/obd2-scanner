// Guided battery and alternator test.
//
// Pure logic, no DOM: it receives voltage samples (and RPM in the last step)
// and moves through three steps on its own:
//
// 1. rest   – ignition on, engine off. Waits for 3 s of steady voltage and
//             keeps the median (one odd reading does not decide).
// 2. crank  – waits for the start. Cranking is a drop of more than 0.8 V
//             below the rest value; the lowest sample is the cranking voltage.
//             The step ends when the alternator is clearly charging
//             (≥ 13.0 V for 1 s) or 10 s after the dip.
// 3. charge – engine running: 5 s at idle, then 5 s at about 2000 rpm with
//             the headlights on (the driver adds the load; we cannot check it).
//
// Limits (plain 12 V lead-acid batteries; they are indications, not a load
// tester's verdict):
// - rest:   ≥ 12.4 V good, 12.0–12.4 low charge, < 12.0 discharged.
//           Above 12.9 V the battery still holds "surface charge" from the
//           last drive and looks better than it is.
// - crank:  ≥ 10.0 V good, 9.6–10.0 worn, < 9.6 weak (the classic 9.6 V
//           load-test limit).
// - charge: 13.2–14.8 V normal. Many recent cars manage the alternator
//           ("smart charging") and sit at 12.8–13.2 V on purpose when the
//           battery is full, so that range is only "attention". Below 12.8 V
//           the battery is being drained; above 15.2 V the regulator lets
//           through too much voltage.
//
// The adapter's own reading (ATRV) is used: it is taken at pin 16 of the
// socket, which is wired straight to the battery, works on every car and is
// the fastest request. Cheap clones can be off by 0.2–0.3 V.

export type BatteryStep = "rest" | "crank" | "charge" | "done";
export type Grade = "ok" | "warn" | "bad";

export interface Reading {
  volts: number;
  grade: Grade;
  /** Extra remark key (under `battery.notes`), if any. */
  note?: string;
}

export interface CrankReading extends Reading {
  /** Samples taken during the dip: few samples may miss the lowest point. */
  samples: number;
}

export interface BatteryResult {
  rest?: Reading;
  /** null = the start happened but its dip was not seen (see `crankMissed`). */
  crank?: CrankReading | null;
  /** Why the cranking voltage is missing: `missed`, `adapter_reset` or `skipped`. */
  crankMissed?: string;
  idle?: Reading;
  loaded?: Reading;
}

export interface BatteryStatus {
  step: BatteryStep;
  /** Sub-step of `charge`: waiting for idle or for ~2000 rpm. */
  charge?: "idle" | "loaded";
  /** 0..1 progress of the current measurement. */
  progress: number;
  /** The car is not where the step needs it (key under `battery.hold`). */
  hold?: string;
}

const REST_S = 3;
const REST_SPREAD = 0.2;
const CRANK_DROP = 0.8;
const RUNNING_V = 13.0;
const RUNNING_S = 1;
const CRANK_TIMEOUT_S = 10;
const CHARGE_S = 5;
const IDLE_RPM: [number, number] = [500, 1200];
const LOADED_RPM: [number, number] = [1700, 2600];

export function gradeRest(v: number): Reading {
  if (v > 12.9) return { volts: v, grade: "ok", note: "surface" };
  if (v >= 12.4) return { volts: v, grade: "ok" };
  if (v >= 12.0) return { volts: v, grade: "warn" };
  return { volts: v, grade: "bad" };
}

export function gradeCrank(v: number, samples: number): CrankReading {
  const grade: Grade = v >= 10.0 ? "ok" : v >= 9.6 ? "warn" : "bad";
  return { volts: v, grade, samples, note: samples < 3 ? "few_samples" : undefined };
}

export function gradeCharge(v: number): Reading {
  if (v > 15.2) return { volts: v, grade: "bad", note: "overcharge" };
  if (v > 14.8) return { volts: v, grade: "warn", note: "high" };
  if (v >= 13.2) return { volts: v, grade: "ok" };
  if (v >= 12.8) return { volts: v, grade: "warn", note: "smart" };
  return { volts: v, grade: "bad", note: "not_charging" };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export class BatteryTest {
  step: BatteryStep = "rest";
  charge: "idle" | "loaded" = "idle";
  result: BatteryResult = {};
  /** Samples of the measurement in progress: [t, volts]. */
  private window: [number, number][] = [];
  private dip: number[] = [];
  private dipEndT: number | undefined;
  private runningSince: number | undefined;
  private resetDuringCrank = false;
  private hold: string | undefined;

  /** Feeds one sample. `rpm` is only needed in the charge step. */
  push(t: number, volts: number, rpm?: number) {
    this.hold = undefined;
    if (this.step === "rest") this.pushRest(t, volts, rpm);
    else if (this.step === "crank") this.pushCrank(t, volts);
    else if (this.step === "charge") this.pushCharge(t, volts, rpm);
  }

  /** The adapter restarted (typical during cranking: its supply dips too). */
  adapterReset() {
    if (this.step === "crank") this.resetDuringCrank = true;
  }

  /** Goes to the next step without a measurement for this one. */
  skip() {
    if (this.step === "rest") this.step = "crank";
    else if (this.step === "crank") this.endCrank(true);
    else if (this.step === "charge") this.step = "done";
    this.window = [];
  }

  status(): BatteryStatus {
    const need = this.step === "rest" ? REST_S : CHARGE_S;
    const span = this.window.length ? this.window[this.window.length - 1][0] - this.window[0][0] : 0;
    const progress = this.step === "crank" || this.step === "done" ? 0 : Math.min(1, span / need);
    return { step: this.step, charge: this.step === "charge" ? this.charge : undefined, progress, hold: this.hold };
  }

  private pushRest(t: number, v: number, rpm?: number) {
    if (rpm !== undefined && rpm > 0) {
      this.hold = "engine_running";
      this.window = [];
      return;
    }
    // Engine already running: the alternator voltage is not a rest value.
    if (v >= RUNNING_V) {
      this.hold = "engine_running";
      this.window = [];
      return;
    }
    this.window.push([t, v]);
    const vs = this.window.map((w) => w[1]);
    if (Math.max(...vs) - Math.min(...vs) > REST_SPREAD) {
      // Not steady yet (a fan, the fuel pump priming…): start over from here.
      this.window = [[t, v]];
      return;
    }
    if (t - this.window[0][0] >= REST_S) {
      this.result.rest = gradeRest(median(vs));
      this.window = [];
      this.step = "crank";
    }
  }

  private pushCrank(t: number, v: number) {
    const rest = this.result.rest?.volts ?? 12.6;
    if (v < rest - CRANK_DROP) {
      this.dip.push(v);
      this.dipEndT = t;
    }
    if (v >= RUNNING_V) {
      this.runningSince ??= t;
      if (t - this.runningSince >= RUNNING_S) this.endCrank(false);
    } else {
      this.runningSince = undefined;
    }
    if (this.dipEndT !== undefined && this.step === "crank" && t - this.dipEndT >= CRANK_TIMEOUT_S) this.endCrank(false);
  }

  private endCrank(skipped: boolean) {
    if (this.dip.length) {
      this.result.crank = gradeCrank(Math.min(...this.dip), this.dip.length);
    } else {
      this.result.crank = null;
      this.result.crankMissed = skipped ? "skipped" : this.resetDuringCrank ? "adapter_reset" : "missed";
    }
    this.step = "charge";
    this.charge = "idle";
    this.window = [];
  }

  private pushCharge(t: number, v: number, rpm?: number) {
    const [lo, hi] = this.charge === "idle" ? IDLE_RPM : LOADED_RPM;
    if (rpm === undefined || rpm < lo || rpm > hi) {
      this.hold = rpm === undefined || rpm < 300 ? "engine_off" : this.charge === "idle" ? "not_idle" : "rpm_range";
      this.window = [];
      return;
    }
    this.window.push([t, v]);
    if (t - this.window[0][0] < CHARGE_S) return;
    const reading = gradeCharge(median(this.window.map((w) => w[1])));
    this.window = [];
    if (this.charge === "idle") {
      this.result.idle = reading;
      this.charge = "loaded";
    } else {
      this.result.loaded = reading;
      this.step = "done";
    }
  }
}

/** Worst grade of the results (for the summary line). */
export function overall(r: BatteryResult): Grade | undefined {
  const grades = [r.rest, r.crank ?? undefined, r.idle, r.loaded].filter((x): x is Reading => !!x).map((x) => x.grade);
  if (!grades.length) return undefined;
  return grades.includes("bad") ? "bad" : grades.includes("warn") ? "warn" : "ok";
}
