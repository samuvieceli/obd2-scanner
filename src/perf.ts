// Performance tests (0–100, 100–0, 40–80, 80–120 km/h) with automatic
// detection of the real start and end of each run.
//
// Pure logic, no DOM: it receives speed samples `(t seconds, v km/h)` and
// returns finished results. The screen watches one test at a time, the one
// the driver picked; the detector itself can watch any list of tests.
//
// How "real" start/end is found:
// - Standing start (0–100): the car must be stopped (< 1 km/h) for at least
//   0.5 s. The start is the moment it begins to move: the first two moving
//   samples give the initial acceleration, extrapolated back to zero speed
//   (never before the last stopped sample). This excludes the driver's
//   reaction time.
// - Rolling start (40–80, 80–120): like a real overtaking, the car must
//   first cruise at a steady speed near the start speed (between 8 km/h below
//   and 2 km/h above it, varying at most 4 km/h for 2 s), and only then
//   accelerate hard ("the kick", at least 2 km/h per second). Speed only
//   passing through 40 or 80 during an acceleration that was already going
//   on does not count: the engine would already be in a lower gear, at high
//   RPM and, on turbo engines, with boost built up, which makes the time
//   unrealistically short. The start is the crossing of the start speed
//   (interpolated), or the kick itself when cruising at or just above it.
//   The start speed must be reached within 6 s of the kick.
// - Braking (100–0): the start is the crossing of 100 km/h going down while
//   decelerating; the end is the moment the car stops (0.5 km/h).
// - End: crossing of the target, interpolated between samples.
// A run is discarded if the car turns back (speed drops > 3 km/h during an
// acceleration, or rises > 3 km/h during braking), stops progressing for
// 3 s, or takes longer than `MAX_RUN_S`. Distance is integrated from speed (trapezoid rule).

export type PerfTestId = "0-100" | "100-0" | "40-80" | "80-120";

export interface PerfTestDef {
  id: PerfTestId;
  from: number;
  to: number;
}

export const PERF_TESTS: PerfTestDef[] = [
  { id: "0-100", from: 0, to: 100 },
  { id: "100-0", from: 100, to: 0 },
  { id: "40-80", from: 40, to: 80 },
  { id: "80-120", from: 80, to: 120 },
];

/** The test measured when none was chosen yet (or a saved one is unknown). */
export const DEFAULT_TEST: PerfTestId = "0-100";

/** The saved choice if it is a known test, otherwise the default. */
export function chosenTest(saved: string | undefined): PerfTestId {
  return PERF_TESTS.find((d) => d.id === saved)?.id ?? DEFAULT_TEST;
}

export interface PerfResult {
  test: PerfTestId;
  /** Elapsed time in seconds. */
  timeS: number;
  /** Distance covered during the run, in meters. */
  distanceM: number;
  /** Average acceleration (positive) or deceleration (negative), in g. */
  avgG: number;
  /** Samples per second during the run (more = more precise). */
  sampleHz: number;
  /** Wall-clock time when the run finished (ms since 1970). */
  at: number;
  /** Vehicle profile the run belongs to (missing in results saved before profiles). */
  profileId?: string;
}

export type PerfPhase = "waiting" | "ready" | "running";

export interface PerfStatus {
  test: PerfTestId;
  phase: PerfPhase;
  /** Seconds since the start of a running test. */
  elapsedS?: number;
}

const STOP_KMH = 0.5;
const STILL_KMH = 1;
const STILL_MIN_S = 0.5;
const TURN_BACK_KMH = 3;
const MAX_RUN_S = 60;
/** Minimum speed change (km/h per s, ≈0.06 g) to count as a real pull or stop. */
const MIN_SLOPE = 2;
/** A run whose speed stops progressing for this long (s) is abandoned. */
const STALL_S = 3;
/** Gaps longer than this (s) mean data was lost: abort running tests. */
const MAX_GAP_S = 2;
const G = 9.80665;
/** Rolling start: steady cruise needed before the kick (s). */
export const CRUISE_S = 2;
/** "Steady": the speed varies at most this much (km/h) during the cruise. */
const CRUISE_BAND_KMH = 4;
/** Cruise speed allowed below / above the start speed (km/h). */
export const CRUISE_BELOW_KMH = 8;
export const CRUISE_ABOVE_KMH = 2;
/** After the kick the start speed must be reached within this time (s). */
const KICK_MAX_S = 6;

interface Run {
  startT: number;
  /** Extreme speed reached so far (max for accel, min for braking). */
  extreme: number;
  /** When `extreme` last improved. */
  progressT: number;
  distanceM: number;
  samples: number;
  /** Standing start only: last stopped sample time and first moving sample. */
  launch?: { stillT: number; t: number; v: number };
}

/** Time when speed crosses `level` between two samples (linear interpolation). */
function crossing(t0: number, v0: number, t1: number, v1: number, level: number): number {
  if (v1 === v0) return t1;
  return t0 + ((level - v0) / (v1 - v0)) * (t1 - t0);
}

export class PerfDetector {
  private last: { t: number; v: number } | null = null;
  private stillSince: number | null = null;
  /** Speed trend of the previous step (km/h per s), to tell accelerating from cruising. */
  private trend = 0;
  private runs = new Map<PerfTestId, Run>();
  /** Recent samples, to check the steady cruise before a rolling start. */
  private recent: { t: number; v: number }[] = [];
  /** Rolling tests: hard acceleration after a cruise, start speed not reached yet. */
  private kicks = new Map<PerfTestId, { t: number; v: number }>();

  constructor(private readonly tests: PerfTestDef[] = PERF_TESTS) {}

  reset() {
    this.last = null;
    this.stillSince = null;
    this.trend = 0;
    this.runs.clear();
    this.recent = [];
    this.kicks.clear();
  }

  /** Steady cruise near the start speed of `def` during the `CRUISE_S` seconds before `t`. */
  private cruising(def: PerfTestDef, t: number): boolean {
    const s = this.recent.filter((x) => x.t <= t && x.t >= t - CRUISE_S - 1e-9);
    if (s.length < 2 || s[0].t > t - CRUISE_S * 0.9) return false;
    const vs = s.map((x) => x.v);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    return hi - lo <= CRUISE_BAND_KMH && lo >= def.from - CRUISE_BELOW_KMH && hi <= def.from + CRUISE_ABOVE_KMH;
  }

  status(): PerfStatus[] {
    return this.tests.map((def) => {
      const run = this.runs.get(def.id);
      if (run && this.last) return { test: def.id, phase: "running", elapsedS: this.last.t - run.startT };
      return { test: def.id, phase: this.isReady(def) ? "ready" : "waiting" };
    });
  }

  /** "Ready" = the next movement in the right direction will start the test. */
  private isReady(def: PerfTestDef): boolean {
    if (!this.last) return false;
    const v = this.last.v;
    if (def.from === 0) return this.stillSince !== null && this.last.t - this.stillSince >= STILL_MIN_S;
    if (def.to < def.from) return v > def.from;
    return this.cruising(def, this.last.t);
  }

  /** Feeds one speed sample; returns the runs that finished with it. */
  push(t: number, v: number): PerfResult[] {
    const prev = this.last;
    this.last = { t, v };
    const done: PerfResult[] = [];
    if (!prev || t <= prev.t) {
      // First sample, or time went back (a replayed recording was rewound).
      this.runs.clear();
      this.kicks.clear();
      this.recent = [{ t, v }];
      this.stillSince = v < STILL_KMH ? t : null;
      return done;
    }
    const dt = t - prev.t;
    if (dt > MAX_GAP_S) {
      this.runs.clear();
      this.kicks.clear();
      this.recent = [{ t, v }];
      this.stillSince = v < STILL_KMH ? t : null;
      this.trend = 0;
      return done;
    }
    const stillLongEnough = this.stillSince !== null && prev.t - this.stillSince >= STILL_MIN_S;
    const slope = (v - prev.v) / dt;
    const stepM = ((prev.v + v) / 2 / 3.6) * dt;

    for (const def of this.tests) {
      const run = this.runs.get(def.id);
      const braking = def.to < def.from;
      if (run) {
        run.distanceM += stepM;
        run.samples++;
        // Standing start, second moving sample: now the initial acceleration
        // is known, so extrapolate back to the instant speed was zero.
        if (run.launch && run.samples === 2 && v > run.launch.v) {
          const a = (v - run.launch.v) / (t - run.launch.t);
          const t0 = run.launch.t - run.launch.v / a;
          const startT = Math.min(run.launch.t, Math.max(run.launch.stillT, t0));
          run.distanceM += ((run.launch.v / 2 / 3.6) * (run.startT - startT));
          run.startT = startT;
          run.launch = undefined;
        }
        if (braking ? v < run.extreme : v > run.extreme) {
          run.extreme = v;
          run.progressT = t;
        }
        const reached = braking ? v <= Math.max(def.to, STOP_KMH) : v >= def.to;
        if (reached) {
          const level = braking ? Math.max(def.to, STOP_KMH) : def.to;
          const endT = crossing(prev.t, prev.v, t, v, level);
          // Remove the part of the last step after the end point.
          const over = ((t - endT) * ((level + v) / 2)) / 3.6;
          const timeS = endT - run.startT;
          const dv = (def.to - def.from) / 3.6;
          done.push({
            test: def.id,
            timeS,
            distanceM: Math.max(0, run.distanceM - over),
            avgG: timeS > 0 ? dv / timeS / G : 0,
            sampleHz: timeS > 0 ? run.samples / timeS : 0,
            at: Date.now(),
          });
          this.runs.delete(def.id);
        } else {
          const turnedBack = braking ? v > run.extreme + TURN_BACK_KMH : v < run.extreme - TURN_BACK_KMH;
          const stalled = t - run.progressT > STALL_S;
          if (turnedBack || stalled || t - run.startT > MAX_RUN_S || (!braking && def.from === 0 && v < STILL_KMH)) {
            this.runs.delete(def.id);
          }
        }
        continue;
      }

      // Not running: look for a start between `prev` and this sample.
      if (def.from === 0) {
        if (stillLongEnough && prev.v < STILL_KMH && v >= STILL_KMH) {
          const startT = crossing(prev.t, prev.v, t, v, STOP_KMH);
          this.runs.set(def.id, {
            startT,
            extreme: v,
            progressT: t,
            distanceM: ((v + STOP_KMH) / 2 / 3.6) * (t - startT),
            samples: 1,
            launch: { stillT: prev.t, t, v },
          });
        }
      } else if (braking) {
        if (prev.v > def.from && v <= def.from && slope <= -MIN_SLOPE && this.trend <= 0) {
          const startT = crossing(prev.t, prev.v, t, v, def.from);
          this.runs.set(def.id, { startT, extreme: v, progressT: t, distanceM: ((def.from + v) / 2 / 3.6) * (t - startT), samples: 1 });
        }
      } else {
        let kick = this.kicks.get(def.id);
        if (!kick && slope >= MIN_SLOPE && this.cruising(def, prev.t)) {
          kick = { t: prev.t, v: prev.v };
          this.kicks.set(def.id, kick);
        }
        if (!kick) continue;
        if (v < prev.v - 1 || t - kick.t > KICK_MAX_S) {
          // Lifted off, or never got there: wait for a new cruise.
          this.kicks.delete(def.id);
        } else if (kick.v >= def.from) {
          // Cruising at (or just above) the start speed: the kick is the start.
          this.kicks.delete(def.id);
          this.runs.set(def.id, { startT: kick.t, extreme: v, progressT: t, distanceM: stepM, samples: 1 });
        } else if (prev.v < def.from && v >= def.from) {
          this.kicks.delete(def.id);
          const startT = crossing(prev.t, prev.v, t, v, def.from);
          this.runs.set(def.id, { startT, extreme: v, progressT: t, distanceM: ((def.from + v) / 2 / 3.6) * (t - startT), samples: 1 });
        }
      }
    }

    this.trend = slope;
    this.recent.push({ t, v });
    while (this.recent.length && this.recent[0].t < t - CRUISE_S - 1) this.recent.shift();
    if (v < STILL_KMH) this.stillSince ??= t;
    else this.stillSince = null;
    return done;
  }
}
