// Fuel trim map: the average total correction (short term + long term fuel
// trim) the engine computer applies, split by engine speed and load.
//
// Pure logic, no DOM. A single trim number jumps around all the time; the map
// shows *where* the correction happens, which is what points to the cause:
//
// - lean (positive) only at idle/low load, normal with load → air entering
//   after the air meter (vacuum hose, intake gasket, oil breather). The leak
//   is a big share of the little air used at idle and a small share at load.
//   On engines that measure air by manifold pressure (MAP, most Brazilian
//   flex engines) a leak shows less in the trims.
// - lean only at high load → not enough fuel when much is needed (weak pump,
//   clogged filter, dirty injectors).
// - lean everywhere → many causes: a flex engine still learning a new
//   ethanol/gasoline mix after refuelling, poor fuel, dirty air sensor (MAF),
//   low fuel pressure, exhaust leak before the sensor.
// - rich only at idle → purge (canister) valve stuck open, dripping injector.
// - rich everywhere → leaking injectors, high fuel pressure, fuel in the oil.
//
// Only closed-loop samples count: in open loop (cold engine, full throttle,
// slowing down) the computer is not correcting and the trims mean nothing.
// When the car does not report the loop state, a warm engine (≥ 70 °C) is
// used instead.

import type { Grade } from "./battery";

/** Upper limits of the RPM columns and load rows (the last one is open). */
export const RPM_BINS = [1300, 2500];
export const LOAD_BINS = [30, 60];
/** Samples a cell needs before its average is trusted. */
export const MIN_SAMPLES = 10;
const WARM_C = 70;
/**
 * Foot off the pedal with a gear engaged: the engine computer cuts the fuel
 * (deceleration fuel cut-off). Load drops to almost nothing at a speed the
 * engine never idles at, and some computers still report closed loop for a
 * sample or two while the trims freeze or drop. Such samples are left out.
 */
const DFCO_RPM = 1400;
const DFCO_LOAD = 10;
/** Samples ignored right after open loop ends (trims are still settling). */
const SETTLE_SAMPLES = 2;

export interface TrimSample {
  rpm?: number;
  load?: number;
  stft?: number;
  ltft?: number;
  /** 1 closed loop, 0 open loop, undefined unknown. */
  closedLoop?: number;
  coolant?: number;
}

export interface Cell {
  n: number;
  sum: number;
}

export type Pattern = "ok" | "lean_idle" | "lean_load" | "lean_all" | "rich_idle" | "rich_all" | "mixed" | "not_enough";

export function bin(value: number, limits: number[]): number {
  let i = 0;
  while (i < limits.length && value >= limits[i]) i++;
  return i;
}

export function gradeTrim(total: number): Grade {
  const a = Math.abs(total);
  return a <= 10 ? "ok" : a <= 20 ? "warn" : "bad";
}

export class TrimMap {
  /** cells[load row][rpm column]; row 0 = low load. */
  cells: Cell[][] = Array.from({ length: LOAD_BINS.length + 1 }, () => Array.from({ length: RPM_BINS.length + 1 }, () => ({ n: 0, sum: 0 })));
  used = 0;
  skipped = 0;
  /** The car reports the loop state (better filtering). */
  knowsLoop = false;
  private settle = 0;

  push(s: TrimSample) {
    if (s.rpm === undefined || s.load === undefined || s.stft === undefined || s.ltft === undefined) return;
    if (s.rpm < 400) return; // engine off
    if (s.closedLoop !== undefined) this.knowsLoop = true;
    const closed = s.closedLoop !== undefined ? s.closedLoop >= 1 : s.coolant === undefined || s.coolant >= WARM_C;
    const fuelCut = s.rpm >= DFCO_RPM && s.load < DFCO_LOAD;
    if (!closed || fuelCut) {
      this.settle = SETTLE_SAMPLES;
      this.skipped++;
      return;
    }
    if (this.settle > 0) {
      this.settle--;
      this.skipped++;
      return;
    }
    const c = this.cells[bin(s.load, LOAD_BINS)][bin(s.rpm, RPM_BINS)];
    c.n++;
    c.sum += s.stft + s.ltft;
    this.used++;
  }

  mean(row: number, col: number): number | undefined {
    const c = this.cells[row][col];
    return c.n >= MIN_SAMPLES ? c.sum / c.n : undefined;
  }

  pattern(): Pattern {
    const vals: { row: number; col: number; v: number }[] = [];
    this.cells.forEach((r, row) =>
      r.forEach((_c, col) => {
        const v = this.mean(row, col);
        if (v !== undefined) vals.push({ row, col, v });
      }),
    );
    if (vals.length < 2) return "not_enough";
    const idle = this.mean(0, 0);
    // Cells with clearly more air than idle (the in-between ones are left out).
    const loaded = vals.filter((x) => x.row + x.col >= 2);
    const avg = (xs: { v: number }[]) => xs.reduce((a, x) => a + x.v, 0) / xs.length;
    const all = vals.map((x) => x.v);
    if (all.every((v) => Math.abs(v) <= 10)) return "ok";
    const spread = Math.max(...all) - Math.min(...all);
    if (all.every((v) => v > 10) && spread < 8) return "lean_all";
    if (all.every((v) => v < -10) && spread < 8) return "rich_all";
    if (idle !== undefined && loaded.length) {
      const load = avg(loaded);
      if (idle > 10 && load <= idle - 8) return "lean_idle";
      if (idle < -10 && load >= idle + 8) return "rich_idle";
      const high = vals.filter((x) => x.row === LOAD_BINS.length);
      if (high.length && avg(high) > 10 && idle < 8 && avg(high) - idle >= 8) return "lean_load";
    } else if (idle === undefined && !loaded.length) {
      return "not_enough";
    }
    if (all.every((v) => v > 10)) return "lean_all";
    if (all.every((v) => v < -10)) return "rich_all";
    return "mixed";
  }
}
