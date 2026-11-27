// Post-trip summary: what happened between engine start and engine stop.
//
// Pure logic, no DOM. It is fed every live frame (time step + values) and
// keeps totals for the current drive: time moving and time stopped with the
// engine running (idle), distance, fuel, peaks, and which alerts fired. When
// the engine stops (RPM below 400 for a few seconds) or the connection ends,
// `finish()` returns the summary if the drive was long enough to matter.

/** Engine counts as running above this RPM. */
export const RUNNING_RPM = 400;
/** Moving above this speed (km/h); below it the car is stopped. */
export const MOVING_KMH = 3;
/** Seconds the engine must stay below RUNNING_RPM to count as stopped. */
export const STOP_HOLD_S = 3;
/** A drive shorter than this (seconds of running engine) is not summarized. */
export const MIN_DRIVE_S = 120;

export interface DriveSummary {
  /** Wall-clock time the drive ended (ms since 1970). */
  endedAt: number;
  runningS: number;
  movingS: number;
  idleS: number;
  distanceKm: number;
  fuelL: number;
  /** Mean speed while moving. */
  avgMovingKmh?: number;
  maxSpeed?: number;
  maxRpm?: number;
  maxCoolant?: number;
  /** Lowest battery voltage with the engine running (alternator charging). */
  minBatteryRunning?: number;
  /** Parameter keys whose alert fired during the drive, in order. */
  alerts: string[];
  /** Why the drive ended. */
  reason: "engine_off" | "disconnected";
}

const max = (a: number | undefined, b: number | undefined) => (b === undefined ? a : a === undefined ? b : Math.max(a, b));
const min = (a: number | undefined, b: number | undefined) => (b === undefined ? a : a === undefined ? b : Math.min(a, b));

export class Drive {
  private s = Drive.empty();
  private stoppedFor = 0;
  /** The engine was seen running in this drive. */
  started = false;

  private static empty() {
    return {
      runningS: 0,
      movingS: 0,
      idleS: 0,
      distanceKm: 0,
      fuelL: 0,
      maxSpeed: undefined as number | undefined,
      maxRpm: undefined as number | undefined,
      maxCoolant: undefined as number | undefined,
      minBatteryRunning: undefined as number | undefined,
      alerts: [] as string[],
    };
  }

  reset() {
    this.s = Drive.empty();
    this.stoppedFor = 0;
    this.started = false;
  }

  /** An alert fired for `key` (counted once per drive). */
  noteAlert(key: string) {
    if (this.started && !this.s.alerts.includes(key)) this.s.alerts.push(key);
  }

  /**
   * Adds one frame. `dt` is the time since the previous frame in seconds
   * (0 for the first one), `lph` the fuel flow when known. Returns the
   * summary when this frame shows the engine has stopped.
   */
  push(dt: number, v: Record<string, number>, lph?: number, now = Date.now()): DriveSummary | undefined {
    const rpm = v.rpm;
    const running = rpm !== undefined && rpm >= RUNNING_RPM;
    const step = dt > 0 && dt < 5 ? dt : 0;
    if (!running) {
      if (!this.started) return undefined;
      if (rpm !== undefined) this.stoppedFor += step;
      if (this.stoppedFor >= STOP_HOLD_S) return this.finish("engine_off", now);
      return undefined;
    }
    this.started = true;
    this.stoppedFor = 0;
    const s = this.s;
    s.runningS += step;
    const speed = v.speed;
    if (speed !== undefined && speed > MOVING_KMH) s.movingS += step;
    else if (speed !== undefined) s.idleS += step;
    if (speed !== undefined) s.distanceKm += (speed * step) / 3600;
    if (lph !== undefined) s.fuelL += (lph * step) / 3600;
    s.maxSpeed = max(s.maxSpeed, speed);
    s.maxRpm = max(s.maxRpm, rpm);
    s.maxCoolant = max(s.maxCoolant, v.coolant_temp);
    // Skip the first seconds: the voltage settles after the start.
    if (s.runningS > 10) s.minBatteryRunning = min(s.minBatteryRunning, v.battery_voltage);
    return undefined;
  }

  /** Ends the drive; returns the summary when it was long enough. */
  finish(reason: DriveSummary["reason"], now = Date.now()): DriveSummary | undefined {
    const s = this.s;
    const out: DriveSummary | undefined =
      this.started && s.runningS >= MIN_DRIVE_S
        ? {
            ...s,
            alerts: [...s.alerts],
            endedAt: now,
            reason,
            avgMovingKmh: s.movingS > 10 ? (s.distanceKm / s.movingS) * 3600 : undefined,
          }
        : undefined;
    this.reset();
    return out;
  }
}
