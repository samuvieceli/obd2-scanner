// Trip analysis ("Viagem" screen): what one stretch of driving cost and why.
//
// Pure logic, no DOM and no storage. A trip log is a table: one row per
// second with the time, the fuel flow the trip computer calculated (L/h) and
// the car values needed for the analysis. `analyze` turns it into plain
// numbers (distance, fuel, economy), where the fuel went (stopped, city,
// road), economy per speed band, driving habits, warm-up and mixture, plus
// tips in plain language. The same log can come from a live trip or from a
// saved recording, so both are analysed the same way.

/** Car values a trip keeps, besides what the fuel calculation needs. */
export const JOURNEY_KEYS = ["speed", "rpm", "engine_load", "throttle", "coolant_temp", "stft_b1", "ltft_b1", "closed_loop_b1", "ethanol_percent"];

/** Fuel flow inputs, in the trip computer's order of preference (see calc.ts). */
const FLOW_INPUTS = [["fuel_rate"], ["maf"], ["rpm", "intake_map", "intake_temp"]];

/** Everything the adapter must read during a trip, among what the car has. */
export function journeyInputs(has: (key: string) => boolean): string[] {
  const out = JOURNEY_KEYS.filter(has);
  const flow = FLOW_INPUTS.find((set) => set.every(has)) ?? [];
  for (const k of flow) if (!out.includes(k)) out.push(k);
  return out;
}

/** One trip: `rows[i] = [seconds since start, L/h, ...values in `keys` order]`. */
export interface JourneyLog {
  keys: string[];
  rows: (number | null)[][];
}

/** Seconds between samples kept while recording a trip. */
export const SAMPLE_EVERY_S = 1;
/** A longer gap between two samples means no data (program closed, link lost). */
export const MAX_STEP_S = 5;
/** Engine counts as running from this RPM (same as the post-trip summary). */
export const RUNNING_RPM = 400;
/** At or below this speed the car is stopped. */
export const STOPPED_KMH = 3;
/** Up to this speed counts as city driving; above it, road. */
export const CITY_MAX_KMH = 60;
/** Width of the speed bands of the economy chart. */
export const BAND_KMH = 10;
/** The last band is open: this speed and above. */
export const TOP_BAND_KMH = 130;
/** Coolant below this: engine still cold, the computer adds fuel. */
export const WARM_C = 70;
/** Strong acceleration and braking, in m/s² (about 0.25 g and 0.35 g). */
export const HARD_ACCEL = 2.5;
export const HARD_BRAKE = -3.5;
/** Engine speed counted as "high" (diesel engines rev lower). */
export const HIGH_RPM = 3500;
export const HIGH_RPM_DIESEL = 3000;
/** Foot off the pedal with a gear engaged: the computer cuts the fuel. */
const COAST_MIN_KMH = 15;
const COAST_MIN_RPM = 1200;
const COAST_MAX_LOAD = 12;

export interface Bucket {
  timeS: number;
  distanceKm: number;
  fuelL: number;
  /** Only with enough distance and fuel for a meaningful number. */
  kmPerL?: number;
}

export interface SpeedBand extends Bucket {
  /** Lower limit of the band in km/h (the top band is open). */
  from: number;
  to: number | null;
}

export type TipLevel = "good" | "info" | "warn";

export interface Tip {
  id: string;
  level: TipLevel;
  params: Record<string, number>;
}

export interface JourneyAnalysis {
  /** Seconds with the engine running and data coming. */
  runningS: number;
  movingS: number;
  idleS: number;
  distanceKm: number;
  /** Undefined when the car gives nothing to calculate fuel from. */
  fuelL?: number;
  kmPerL?: number;
  avgMovingKmh?: number;
  maxSpeed?: number;
  maxRpm?: number;
  /** Where the fuel went. */
  idle: Bucket;
  city: Bucket;
  road: Bucket;
  /** Economy per speed band while moving, slowest first, only bands driven in. */
  bands: SpeedBand[];
  /** Band with the best economy among those with enough distance. */
  bestBand?: SpeedBand;
  hardAccels: number;
  hardBrakes: number;
  /** Share of running time at high engine speed (0–1). */
  highRpmShare?: number;
  /** Share of moving time slowing down in gear with the foot off (0–1). */
  coastShare?: number;
  /** Seconds the engine took to warm up (only when the trip started cold). */
  warmupS?: number;
  /** Driving with a cold engine. */
  cold: Bucket;
  coolantStart?: number;
  maxCoolant?: number;
  /** Average total fuel trim (short + long term) with a warm engine in closed loop. */
  trimAvg?: number;
  ltftAvg?: number;
  trimSamples: number;
  /** Economy compared with this car's usual average, in % (+ = better). */
  vsAverage?: number;
  tips: Tip[];
}

export interface AnalyzeOptions {
  /** This car's usual km/L with the same fuel (trip history), if known. */
  avgKmPerL?: number;
  diesel?: boolean;
}

const emptyBucket = (): Bucket => ({ timeS: 0, distanceKm: 0, fuelL: 0 });

/** km/L of a bucket, only with at least 0.5 km and 0.02 L behind it. */
function economyOf(b: Bucket, minKm = 0.5) {
  b.kmPerL = b.distanceKm >= minKm && b.fuelL >= 0.02 ? b.distanceKm / b.fuelL : undefined;
}

/** Reads row `r` of a log as a value map (missing values left out). */
export function rowValues(log: JourneyLog, r: (number | null)[]): Record<string, number> {
  const v: Record<string, number> = {};
  log.keys.forEach((k, i) => {
    const x = r[i + 2];
    if (x !== null && x !== undefined && Number.isFinite(x)) v[k] = x;
  });
  return v;
}

const percentile = (xs: number[], p: number) => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
};

export function analyze(log: JourneyLog, opts: AnalyzeOptions = {}): JourneyAnalysis {
  const rows = log.rows;
  const vals = rows.map((r) => rowValues(log, r));
  const lphAt = (i: number) => {
    const x = rows[i][1];
    return x === null || x === undefined || !Number.isFinite(x) ? undefined : Math.max(0, x);
  };
  const hasFuel = rows.some((_, i) => lphAt(i) !== undefined);

  // Throttle position with the foot off: the lowest values seen while stopped.
  const idleThrottle = percentile(
    vals.filter((v) => (v.speed ?? 0) <= STOPPED_KMH && v.throttle !== undefined).map((v) => v.throttle),
    0.1,
  );

  const a: JourneyAnalysis = {
    runningS: 0,
    movingS: 0,
    idleS: 0,
    distanceKm: 0,
    fuelL: hasFuel ? 0 : undefined,
    idle: emptyBucket(),
    city: emptyBucket(),
    road: emptyBucket(),
    bands: [],
    hardAccels: 0,
    hardBrakes: 0,
    cold: emptyBucket(),
    trimSamples: 0,
    tips: [],
  };
  const bands = new Map<number, SpeedBand>();
  const highRpm = opts.diesel ? HIGH_RPM_DIESEL : HIGH_RPM;
  let highS = 0;
  let rpmKnownS = 0;
  let coastS = 0;
  let coastKnownS = 0;
  let inAccel = false;
  let inBrake = false;
  let firstRunT: number | undefined;
  let trimSum = 0;
  let ltftSum = 0;
  let ltftN = 0;

  for (let i = 0; i < rows.length; i++) {
    const v = vals[i];
    const lph = lphAt(i);
    if (a.coolantStart === undefined && v.coolant_temp !== undefined) a.coolantStart = v.coolant_temp;
    if (v.coolant_temp !== undefined) a.maxCoolant = Math.max(a.maxCoolant ?? -Infinity, v.coolant_temp);
    const running = v.rpm !== undefined ? v.rpm >= RUNNING_RPM : lph !== undefined && lph > 0.05;
    if (running && firstRunT === undefined) firstRunT = rows[i][0] ?? 0;
    if (
      running &&
      a.warmupS === undefined &&
      a.coolantStart !== undefined &&
      a.coolantStart < WARM_C &&
      v.coolant_temp !== undefined &&
      v.coolant_temp >= WARM_C
    )
      a.warmupS = (rows[i][0] ?? 0) - (firstRunT ?? 0);

    if (i === 0) continue;
    const dt = (rows[i][0] ?? 0) - (rows[i - 1][0] ?? 0);
    if (!(dt > 0 && dt <= MAX_STEP_S)) {
      inAccel = inBrake = false;
      continue;
    }
    const speed = v.speed;
    const km = speed !== undefined ? (speed * dt) / 3600 : 0;
    const fuel = running && lph !== undefined ? (lph * dt) / 3600 : 0;
    a.distanceKm += km;
    if (a.fuelL !== undefined) a.fuelL += fuel;
    if (speed !== undefined) a.maxSpeed = Math.max(a.maxSpeed ?? 0, speed);
    if (v.rpm !== undefined) a.maxRpm = Math.max(a.maxRpm ?? 0, v.rpm);

    if (running) {
      a.runningS += dt;
      if (v.rpm !== undefined) {
        rpmKnownS += dt;
        if (v.rpm >= highRpm) highS += dt;
      }
      if (v.coolant_temp !== undefined && v.coolant_temp < WARM_C) add(a.cold, dt, km, fuel);
    }

    if (speed !== undefined) {
      const moving = speed > STOPPED_KMH;
      if (moving) a.movingS += dt;
      else if (running) a.idleS += dt;
      if (running || moving) add(!moving ? a.idle : speed <= CITY_MAX_KMH ? a.city : a.road, dt, km, fuel);
      if (moving) {
        const from = Math.min(TOP_BAND_KMH, Math.floor(speed / BAND_KMH) * BAND_KMH);
        let b = bands.get(from);
        if (!b) bands.set(from, (b = { from, to: from >= TOP_BAND_KMH ? null : from + BAND_KMH, ...emptyBucket() }));
        add(b, dt, km, fuel);
      }
      // Acceleration from the speed change, counted once per manoeuvre.
      const prev = vals[i - 1].speed;
      if (prev !== undefined) {
        const acc = (speed - prev) / 3.6 / dt;
        if (acc >= HARD_ACCEL && !inAccel) a.hardAccels++;
        if (acc <= HARD_BRAKE && !inBrake) a.hardBrakes++;
        inAccel = acc >= HARD_ACCEL;
        inBrake = acc <= HARD_BRAKE;
      }
      // Slowing down in gear without the pedal (fuel cut-off).
      const footOff =
        v.engine_load !== undefined
          ? v.engine_load <= COAST_MAX_LOAD
          : v.throttle !== undefined && idleThrottle !== undefined
            ? v.throttle <= idleThrottle + 2
            : undefined;
      if (moving && footOff !== undefined && v.rpm !== undefined) {
        coastKnownS += dt;
        if (footOff && speed >= COAST_MIN_KMH && v.rpm >= COAST_MIN_RPM) coastS += dt;
      }
    }

    // Mixture: warm engine, closed loop (or unknown loop state), not coasting.
    const closed = v.closed_loop_b1 === undefined ? (v.coolant_temp ?? 0) >= WARM_C : v.closed_loop_b1 === 1;
    const coasting = v.engine_load !== undefined && v.engine_load < 10 && (v.rpm ?? 0) > 1400;
    if (running && closed && !coasting && (v.coolant_temp ?? WARM_C) >= WARM_C && v.stft_b1 !== undefined) {
      trimSum += v.stft_b1 + (v.ltft_b1 ?? 0);
      a.trimSamples++;
      if (v.ltft_b1 !== undefined) {
        ltftSum += v.ltft_b1;
        ltftN++;
      }
    }
  }

  for (const b of [a.idle, a.city, a.road, a.cold]) economyOf(b);
  a.bands = [...bands.values()].sort((x, y) => x.from - y.from);
  for (const b of a.bands) economyOf(b);
  a.bestBand = a.bands
    .filter((b) => b.kmPerL !== undefined && b.distanceKm >= Math.max(1, a.distanceKm * 0.05))
    .reduce<SpeedBand | undefined>((best, b) => (!best || b.kmPerL! > best.kmPerL! ? b : best), undefined);
  if (a.fuelL !== undefined && a.distanceKm >= 1 && a.fuelL >= 0.05) a.kmPerL = a.distanceKm / a.fuelL;
  if (a.movingS > 10) a.avgMovingKmh = (a.distanceKm / a.movingS) * 3600;
  if (rpmKnownS > 60) a.highRpmShare = highS / rpmKnownS;
  if (coastKnownS > 60 && a.movingS > 60) a.coastShare = coastS / a.movingS;
  if (a.trimSamples >= 30) {
    a.trimAvg = trimSum / a.trimSamples;
    if (ltftN >= 30) a.ltftAvg = ltftSum / ltftN;
  }
  if (a.kmPerL !== undefined && opts.avgKmPerL && a.distanceKm >= 3) a.vsAverage = (a.kmPerL / opts.avgKmPerL - 1) * 100;
  a.tips = tipsFor(a);
  return a;
}

function add(b: Bucket, dt: number, km: number, fuel: number) {
  b.timeS += dt;
  b.distanceKm += km;
  b.fuelL += fuel;
}

/** Bands at or above `from` km/h (or below `to`), joined into one. */
function joined(bands: SpeedBand[], from: number, to: number): Bucket {
  const b = emptyBucket();
  for (const x of bands) if (x.from >= from && x.from < to) add(b, x.timeS, x.distanceKm, x.fuelL);
  economyOf(b, 2);
  return b;
}

const round = (x: number, d = 0) => Math.round(x * 10 ** d) / 10 ** d;

/**
 * Plain-language tips, most useful first. Each one names a fact of this trip
 * and, when there is one, what to do about it. Thresholds are deliberately
 * loose: a tip should point at something real, not at noise.
 */
export function tipsFor(a: JourneyAnalysis): Tip[] {
  const tips: Tip[] = [];
  const fuel = a.fuelL ?? 0;

  if (a.vsAverage !== undefined && Math.abs(a.vsAverage) >= 10)
    tips.push({ id: a.vsAverage > 0 ? "betterThanUsual" : "worseThanUsual", level: a.vsAverage > 0 ? "good" : "info", params: { pct: round(Math.abs(a.vsAverage)) } });

  // Idling: fuel burnt without moving.
  if (a.idle.timeS >= 180 && fuel > 0 && (a.idle.fuelL / fuel >= 0.08 || (a.idle.timeS >= 300 && a.idle.timeS / a.runningS >= 0.15)))
    tips.push({
      id: "idle",
      level: "info",
      params: { min: round(a.idle.timeS / 60), timePct: round((a.idle.timeS / a.runningS) * 100), pct: round((a.idle.fuelL / fuel) * 100) },
    });

  // Fast road driving against moderate road speeds.
  const fast = joined(a.bands, 110, Infinity);
  const steady = joined(a.bands, 80, 100);
  if (fast.kmPerL !== undefined && steady.kmPerL !== undefined && fast.kmPerL < steady.kmPerL * 0.88)
    tips.push({ id: "fast", level: "info", params: { kmh: 110, pct: round((1 - fast.kmPerL / steady.kmPerL) * 100) } });

  if (a.bestBand && a.bands.filter((b) => b.kmPerL !== undefined).length >= 3)
    tips.push({ id: "bestBand", level: "good", params: { from: a.bestBand.from, to: a.bestBand.to ?? a.bestBand.from + BAND_KMH } });

  const per100 = a.distanceKm >= 5 ? ((a.hardAccels + a.hardBrakes) / a.distanceKm) * 100 : 0;
  if (a.hardAccels + a.hardBrakes >= 5 && per100 >= 15)
    tips.push({ id: "hardDriving", level: "info", params: { accels: a.hardAccels, brakes: a.hardBrakes } });

  if (a.highRpmShare !== undefined && a.highRpmShare >= 0.1)
    tips.push({ id: "highRpm", level: "info", params: { pct: round(a.highRpmShare * 100) } });

  if (a.coastShare !== undefined && a.coastShare >= 0.08)
    tips.push({ id: "coasting", level: "good", params: { pct: round(a.coastShare * 100) } });

  if (a.cold.timeS >= 180 && fuel > 0 && a.cold.fuelL / fuel >= 0.15)
    tips.push({ id: "cold", level: "info", params: { min: round(a.cold.timeS / 60), pct: round((a.cold.fuelL / fuel) * 100) } });

  if (a.trimAvg !== undefined && Math.abs(a.trimAvg) > 10)
    tips.push({
      id: a.trimAvg > 0 ? "mixtureLean" : "mixtureRich",
      level: Math.abs(a.trimAvg) > 20 ? "warn" : "info",
      params: { pct: round(Math.abs(a.trimAvg)) },
    });

  if (a.maxCoolant !== undefined && a.maxCoolant >= 108) tips.push({ id: "hot", level: "warn", params: { c: round(a.maxCoolant) } });

  return tips;
}

/**
 * Economy minute by minute, for a chart: km/L of each window of `windowS`
 * seconds with at least 0.2 km driven. `t` is the middle of the window.
 */
export function economySeries(log: JourneyLog, windowS = 60): { t: number[]; v: number[] } {
  const iSpeed = log.keys.indexOf("speed") + 2;
  const out = { t: [] as number[], v: [] as number[] };
  if (iSpeed < 2) return out;
  let start = log.rows[0]?.[0] ?? 0;
  let km = 0;
  let l = 0;
  for (let i = 1; i < log.rows.length; i++) {
    const r = log.rows[i];
    const t = r[0] ?? 0;
    const dt = t - (log.rows[i - 1][0] ?? 0);
    if (dt > 0 && dt <= MAX_STEP_S) {
      km += ((r[iSpeed] ?? 0) * dt) / 3600;
      l += ((r[1] ?? 0) * dt) / 3600;
    }
    if (t - start >= windowS) {
      if (km >= 0.2 && l > 0.005) {
        out.t.push((start + t) / 2);
        out.v.push(km / l);
      }
      start = t;
      km = l = 0;
    }
  }
  return out;
}

/** One column of a log as a series, at most `max` points (keeping peaks). */
export function seriesOf(log: JourneyLog, key: string, max = 600): { t: number[]; v: number[] } {
  const idx = key === "lph" ? 1 : log.keys.indexOf(key) + 2;
  const out = { t: [] as number[], v: [] as number[] };
  if (idx < 1) return out;
  const pts = log.rows.filter((r) => r[idx] !== null && r[idx] !== undefined).map((r) => [r[0] ?? 0, r[idx] as number]);
  if (pts.length <= max) {
    for (const [t, v] of pts) {
      out.t.push(t);
      out.v.push(v);
    }
    return out;
  }
  // Min and max of each slice, in time order, so peaks survive.
  const per = Math.ceil(pts.length / (max / 2));
  for (let i = 0; i < pts.length; i += per) {
    const slice = pts.slice(i, i + per);
    let lo = slice[0];
    let hi = slice[0];
    for (const p of slice) {
      if (p[1] < lo[1]) lo = p;
      if (p[1] > hi[1]) hi = p;
    }
    for (const p of lo[0] <= hi[0] ? [lo, hi] : [hi, lo]) {
      if (out.t[out.t.length - 1] === p[0]) continue;
      out.t.push(p[0]);
      out.v.push(p[1]);
    }
  }
  return out;
}

/** Average of one column (e.g. the ethanol % of a flex car), if it was read. */
export function averageOf(log: JourneyLog, key: string): number | undefined {
  const idx = log.keys.indexOf(key) + 2;
  if (idx < 2) return undefined;
  let s = 0;
  let n = 0;
  for (const r of log.rows) {
    const x = r[idx];
    if (x !== null && x !== undefined && Number.isFinite(x)) {
      s += x;
      n++;
    }
  }
  return n ? s / n : undefined;
}

/** Turns recording frames into a trip log (fuel flow from `flow`). */
export function logFromFrames(
  frames: { t_ms: number; values: Record<string, number> }[],
  flow: (v: Record<string, number>) => number | undefined,
): JourneyLog {
  const present = new Set<string>();
  for (const f of frames) for (const k of Object.keys(f.values)) present.add(k);
  const keys = journeyInputs((k) => present.has(k));
  const rows: (number | null)[][] = [];
  // Newest value of each parameter and when it came: a frame may carry only
  // some of them. Values older than 3 s count as missing, like live.
  const seen = new Map<string, [number, number]>();
  let last = -Infinity;
  for (const f of frames) {
    const t = f.t_ms / 1000;
    for (const [k, v] of Object.entries(f.values)) seen.set(k, [t, v]);
    // One sample per second, like a live trip.
    if (t - last < SAMPLE_EVERY_S * 0.95) continue;
    last = t;
    const v: Record<string, number> = {};
    for (const [k, [at, x]] of seen) if (t - at <= 3) v[k] = x;
    rows.push([t, flow(v) ?? null, ...keys.map((k) => v[k] ?? null)]);
  }
  const t0 = rows[0]?.[0] ?? 0;
  for (const r of rows) r[0] = (r[0] ?? 0) - t0;
  return { keys, rows };
}

// --- Stage 2: cutting parts out, comparing two trips ----------------------

/** A part of a trip left out of the analysis, in seconds since the start. */
export type Cut = [from: number, to: number];

/** The log without the rows inside any cut (the gap is then skipped like missing data). */
export function applyCuts(log: JourneyLog, cuts: Cut[] | undefined): JourneyLog {
  if (!cuts?.length) return log;
  const inCut = (t: number) => cuts.some(([a, b]) => t >= a && t <= b);
  return { keys: log.keys, rows: log.rows.filter((r) => !inCut(r[0] ?? 0)) };
}

/** Cuts that keep only `from`–`to` of a trip lasting `end` seconds. */
export function keepOnly(from: number, to: number, end: number): Cut[] {
  const out: Cut[] = [];
  if (from > 0) out.push([0, from - 0.001]);
  if (to < end) out.push([to + 0.001, end]);
  return out;
}

export type Better = "higher" | "lower" | null;

export interface CompareRow {
  id: string;
  a?: number;
  b?: number;
  /** Which way is better, to colour the difference (null = neither). */
  better: Better;
  /** How the numbers are shown: km/L, km, L, %, s, count, km/h, °C, R$. */
  kind: "economy" | "km" | "L" | "share" | "time" | "count" | "speed" | "trim" | "money";
}

const share = (part: number, whole: number | undefined) => (whole ? part / whole : undefined);

/** The numbers worth comparing between two trips, side by side. */
export function compare(a: JourneyAnalysis, b: JourneyAnalysis, costA?: number, costB?: number): CompareRow[] {
  const per100 = (x: JourneyAnalysis) => (x.distanceKm >= 5 ? ((x.hardAccels + x.hardBrakes) / x.distanceKm) * 100 : undefined);
  const rows: CompareRow[] = [
    { id: "distance", a: a.distanceKm, b: b.distanceKm, better: null, kind: "km" },
    { id: "running", a: a.runningS, b: b.runningS, better: null, kind: "time" },
    { id: "fuel", a: a.fuelL, b: b.fuelL, better: null, kind: "L" },
    { id: "economy", a: a.kmPerL, b: b.kmPerL, better: "higher", kind: "economy" },
    { id: "cost", a: costA, b: costB, better: null, kind: "money" },
    { id: "costPerKm", a: costA !== undefined && a.distanceKm >= 1 ? costA / a.distanceKm : undefined, b: costB !== undefined && b.distanceKm >= 1 ? costB / b.distanceKm : undefined, better: "lower", kind: "money" },
    { id: "avgSpeed", a: a.avgMovingKmh, b: b.avgMovingKmh, better: null, kind: "speed" },
    { id: "idleTime", a: share(a.idle.timeS, a.runningS), b: share(b.idle.timeS, b.runningS), better: "lower", kind: "share" },
    { id: "cityEconomy", a: a.city.kmPerL, b: b.city.kmPerL, better: "higher", kind: "economy" },
    { id: "roadEconomy", a: a.road.kmPerL, b: b.road.kmPerL, better: "higher", kind: "economy" },
    { id: "hardPer100", a: per100(a), b: per100(b), better: "lower", kind: "count" },
    { id: "highRpm", a: a.highRpmShare, b: b.highRpmShare, better: "lower", kind: "share" },
    { id: "coast", a: a.coastShare, b: b.coastShare, better: "higher", kind: "share" },
    { id: "coldFuel", a: share(a.cold.fuelL, a.fuelL), b: share(b.cold.fuelL, b.fuelL), better: "lower", kind: "share" },
    { id: "trim", a: a.trimAvg, b: b.trimAvg, better: null, kind: "trim" },
  ];
  return rows.filter((r) => r.a !== undefined || r.b !== undefined);
}

/** Difference of b against a in % (undefined when either is missing or a is 0). */
export function diffPct(r: CompareRow): number | undefined {
  return r.a !== undefined && r.b !== undefined && Math.abs(r.a) > 1e-9 ? (r.b / r.a - 1) * 100 : undefined;
}

/** Which trip did better in a row ("a", "b" or null when about even or not comparable). */
export function winner(r: CompareRow): "a" | "b" | null {
  if (!r.better || r.a === undefined || r.b === undefined) return null;
  // Shares (0–1) must differ by 2 points; other numbers by 3%.
  const even = r.kind === "share" ? Math.abs(r.b - r.a) < 0.02 : Math.abs(diffPct(r) ?? 0) < 3 || Math.abs(r.a) < 1e-9;
  if (even) return null;
  return (r.b > r.a) === (r.better === "higher") ? "b" : "a";
}

/**
 * How much better the winner is, in %, for rows where a percentage reads
 * naturally (economy, cost per km): "20% more km per litre", "30% cheaper".
 */
export function advantage(r: CompareRow): number | undefined {
  if (!winner(r) || (r.kind !== "economy" && r.kind !== "money") || r.a === undefined || r.b === undefined) return undefined;
  const hi = Math.max(r.a, r.b);
  const lo = Math.min(r.a, r.b);
  if (lo <= 0) return undefined;
  return r.better === "higher" ? (hi / lo - 1) * 100 : (1 - lo / hi) * 100;
}
