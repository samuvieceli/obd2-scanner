// Guided oxygen sensor (lambda) and catalytic converter check.
//
// Pure logic, no DOM. It gets samples of RPM, coolant temperature, the
// upstream sensor (before the converter) and the downstream one (after it),
// and judges a 20 s window held at 2000–3000 rpm with a warm engine.
//
// How it reads the sensors:
// - A normal ("narrowband") upstream sensor swings between lean (~0.1 V) and
//   rich (~0.9 V) as the engine computer corrects the mixture. We count how
//   often it crosses the middle, with a dead band (below 0.35 V → above
//   0.55 V) so noise does not count. At 2000–3000 rpm a healthy sensor
//   crosses many times in 10 s; at idle even good sensors can be slow, which
//   is why the test is held at higher rpm.
// - A good converter stores oxygen and evens the gas out, so the downstream
//   sensor stays fairly steady. A worn one lets the swings through: the
//   downstream sensor starts to copy the upstream one. We compare crossings
//   and swing size (amplitude) of the two instead of a fixed voltage band:
//   the steady downstream level differs from car to car.
// - Many recent engines use a "wideband" upstream sensor, read as lambda
//   (≈ 1.00) instead of volts. It does not switch, so only the downstream
//   sensor is judged.
//
// The sensor's real response time (tens of milliseconds) is far below what an
// ELM327 can sample, so a "slow sensor" result is only a hint. The engine
// computer's own tests (Mode 06) and the catalyst readiness monitor are more
// reliable and are shown beside this result.

import type { Grade } from "./battery";

export type O2Phase = "warmup" | "hold" | "measuring" | "done";

export interface O2Sample {
  rpm?: number;
  coolant?: number;
  pre?: number;
  post?: number;
}

export interface Trace {
  /** Mid-point crossings per 10 s (narrowband only). */
  crossPer10s: number;
  /** Swing size: 95th minus 5th percentile. */
  amp: number;
  mean: number;
}

export interface Verdict {
  grade: Grade;
  /** Text key under `o2test.verdicts`. */
  id: string;
}

export interface O2Result {
  pre: Trace;
  post?: Trace;
  sensor?: Verdict;
  catalyst?: Verdict;
  /** Samples per second of each sensor during the window. */
  rateHz: number;
  lowRate: boolean;
}

export const WARM_C = 80;
export const RPM_RANGE: [number, number] = [2000, 3000];
export const WINDOW_S = 20;
const LO = 0.35;
const HI = 0.55;
const LOW_RATE_HZ = 4;

function percentile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/** Crossings and swing of one sensor over `seconds`. */
export function trace(values: number[], seconds: number, narrow: boolean): Trace {
  const sorted = [...values].sort((a, b) => a - b);
  let crossings = 0;
  let side: "lo" | "hi" | undefined;
  if (narrow) {
    for (const v of values) {
      const now = v < LO ? "lo" : v > HI ? "hi" : side;
      if (side && now !== side) crossings++;
      side = now;
    }
  }
  return {
    crossPer10s: seconds > 0 ? (crossings * 10) / seconds : 0,
    amp: values.length ? percentile(sorted, 0.95) - percentile(sorted, 0.05) : 0,
    mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0,
  };
}

export function judge(pre: Trace, post: Trace | undefined, wide: boolean, rateHz: number): Pick<O2Result, "sensor" | "catalyst"> {
  const lowRate = rateHz < LOW_RATE_HZ;
  let sensor: Verdict | undefined;
  if (!wide) {
    if (pre.amp < 0.3) {
      sensor = { grade: "bad", id: pre.mean < 0.3 ? "pre_stuck_lean" : pre.mean > 0.6 ? "pre_stuck_rich" : "pre_stuck_mid" };
    } else if (pre.crossPer10s < 4) {
      // Too few readings can hide fast switching.
      sensor = lowRate ? { grade: "warn", id: "pre_unclear_rate" } : { grade: "warn", id: "pre_slow" };
    } else {
      sensor = { grade: "ok", id: "pre_ok" };
    }
  }
  if (!post) return { sensor };
  let catalyst: Verdict;
  if (sensor?.grade === "bad") {
    catalyst = { grade: "warn", id: "cat_unknown" };
  } else if (post.amp < 0.25) {
    catalyst = post.mean < 0.2 ? { grade: "warn", id: "post_low" } : { grade: "ok", id: "cat_ok" };
  } else if (wide ? post.crossPer10s >= 3 && post.amp >= 0.4 : post.crossPer10s >= 0.6 * pre.crossPer10s && post.amp >= 0.4) {
    catalyst = { grade: "bad", id: "cat_weak" };
  } else {
    catalyst = { grade: "warn", id: "cat_unclear" };
  }
  return { sensor, catalyst };
}

export class O2Test {
  phase: O2Phase = "warmup";
  result: O2Result | undefined;
  private win: { t: number; pre?: number; post?: number }[] = [];

  /** `wide`: the upstream sensor is a wideband one (lambda, not volts). */
  constructor(readonly wide: boolean, readonly hasPost: boolean) {}

  push(t: number, s: O2Sample) {
    if (this.phase === "done") return;
    if (s.coolant !== undefined && s.coolant < WARM_C) {
      this.phase = "warmup";
      this.win = [];
      return;
    }
    if (s.rpm === undefined) return;
    if (s.rpm < RPM_RANGE[0] || s.rpm > RPM_RANGE[1]) {
      this.phase = "hold";
      this.win = [];
      return;
    }
    this.phase = "measuring";
    this.win.push({ t, pre: s.pre, post: s.post });
    if (t - this.win[0].t >= WINDOW_S) this.finish();
  }

  /** 0..1 progress of the measuring window. */
  progress(): number {
    if (this.phase === "done") return 1;
    if (this.win.length < 2) return 0;
    return Math.min(1, (this.win[this.win.length - 1].t - this.win[0].t) / WINDOW_S);
  }

  private finish() {
    const secs = this.win[this.win.length - 1].t - this.win[0].t;
    const pres = this.win.map((w) => w.pre).filter((v): v is number => v !== undefined);
    const posts = this.win.map((w) => w.post).filter((v): v is number => v !== undefined);
    const rateHz = pres.length / secs;
    const pre = trace(pres, secs, !this.wide);
    const post = this.hasPost && posts.length ? trace(posts, secs, true) : undefined;
    this.result = { pre, post, rateHz, lowRate: rateHz < LOW_RATE_HZ, ...judge(pre, post, this.wide, rateHz) };
    this.phase = "done";
    this.win = [];
  }
}
