// Application state shared by all screens, with a tiny publish/subscribe.
import { calcInputs, isCalc } from "./calc";
import { journeyInputs } from "./journey";
import type {
  AdapterInfo,
  CmdError,
  DtcReport,
  EcuInfo,
  Finding,
  FreezeFrame,
  LinkStatus,
  LiveFrame,
  LogEvent,
  PidMeta,
  Readiness,
  RecordingStatus,
  Session,
  TestResult,
  VehicleInfo,
} from "./api";

export type Topic = "connection" | "frame" | "findings" | "log" | "recording" | "live-keys" | "session" | "playback" | "trip" | "seek" | "alerts" | "profile" | "link" | "units" | "dtcs" | "journey";

export interface Series {
  t: number[];
  v: number[];
}

const MAX_POINTS = 6000;
const MAX_LOG = 1500;

export const DEFAULT_KEYS = [
  "rpm",
  "speed",
  "coolant_temp",
  "engine_load",
  "throttle",
  "stft_b1",
  "ltft_b1",
  "maf",
  "intake_temp",
  "o2_b1s1",
  "o2_b1s2",
  "battery_voltage",
];

function loadKeys(name = "liveKeys"): string[] | null {
  try {
    const v = localStorage.getItem(name);
    return v ? (JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}

export const state = {
  connection: "disconnected" as "disconnected" | "connecting" | "connected",
  adapter: null as AdapterInfo | null,
  vehicleError: null as CmdError | null,
  /** Recovery or reconnection in progress, null when the link is fine. */
  link: null as LinkStatus | null,
  catalog: [] as PidMeta[],
  liveKeys: loadKeys() ?? [...DEFAULT_KEYS],
  /** Parameters chosen on the Charts screen; null = follow the dashboard. */
  chartKeys: loadKeys("chartKeys"),
  polling: false,
  /** The user pressed "Pause reading": opening the Live dashboard or the HUD
   *  does not start reading again until "Resume reading" (reset on connect). */
  readingPaused: false,
  rateHz: 0,
  latest: {} as Record<string, number>,
  /** Time of the last live frame, in seconds. */
  lastFrameT: undefined as number | undefined,
  minmax: {} as Record<string, [number, number]>,
  history: new Map<string, Series>(),
  findings: [] as Finding[],
  recording: { recording: false, frames: 0, marks: 0, lastFrames: 0, lastDurationS: 0, startedAtUnixMs: null } as RecordingStatus,
  logs: [] as { t: number; dir: LogEvent["dir"]; text: string }[],
  // Cached diagnostic reads, used by the report.
  dtcs: null as DtcReport | null,
  freeze: null as FreezeFrame | null,
  readiness: null as Readiness | null,
  mode06: null as TestResult[] | null,
  vehicle: null as VehicleInfo | null,
  ecus: null as EcuInfo[] | null,
  /** A recording opened from disk, shown on the Charts screen. */
  viewSession: null as { name: string; session: Session } | null,
  /** A recording being replayed as if it were live (see playback.ts). */
  playback: null as import("./playback").Playback | null,
  appVersion: "",
  /** Data folder beside the program (portable version), or null. */
  portableData: null as string | null,
  /** Frames of a recording recovered at start-up (interrupted last time). */
  recoveredFrames: null as number | null,
  /** Parameters the car stopped answering in the newest live frame. */
  lastDropped: [] as string[],
  /** A trip of the "Viagem" screen is being recorded (see journey-live.ts). */
  journeyActive: false,
  /** Demo only: the virtual engine is stopped (ATSIMOFF). */
  demoEngineOff: false,
};

const subs = new Map<Topic, Set<() => void>>();

export function on(topic: Topic, f: () => void): () => void {
  if (!subs.has(topic)) subs.set(topic, new Set());
  subs.get(topic)!.add(f);
  return () => subs.get(topic)!.delete(f);
}

export function emit(topic: Topic) {
  subs.get(topic)?.forEach((f) => {
    try {
      f();
    } catch (e) {
      console.error(e);
    }
  });
}

export function meta(key: string): PidMeta | undefined {
  return state.catalog.find((p) => p.key === key);
}

/** Keys the connected vehicle supports (battery voltage is read from the adapter). */
export function isSupported(key: string): boolean {
  if (state.playback) return state.playback.keys.includes(key);
  if (key === "battery_voltage") return true;
  const m = meta(key);
  return !!m && !!state.adapter && state.adapter.supported_pids.includes(m.pid);
}

/** True when live values are available: a connection or a replayed recording. */
export function hasLiveSource(): boolean {
  return state.connection === "connected" || !!state.playback;
}

/** Keys shown on the dashboard and HUD right now. */
export function displayKeys(): string[] {
  return state.playback ? state.playback.keys : state.liveKeys.filter(isSupported);
}

export function setLiveKeys(keys: string[]) {
  state.liveKeys = keys;
  try {
    localStorage.setItem("liveKeys", JSON.stringify(keys));
  } catch {
    /* ignore */
  }
  emit("live-keys");
}

/** Keeps the chart choice and makes sure those parameters are read too. */
export function setChartKeys(keys: string[] | null) {
  state.chartKeys = keys;
  try {
    if (keys) localStorage.setItem("chartKeys", JSON.stringify(keys));
    else localStorage.removeItem("chartKeys");
  } catch {
    /* ignore */
  }
}

/**
 * Everything the adapter must read: the dashboard parameters plus those
 * chosen only for the charts (for a calculated value, the ones it needs)
 * and, during a trip of the "Viagem" screen, what its analysis needs.
 */
export function readKeys(): string[] {
  const out = [...state.liveKeys];
  for (const k of state.chartKeys ?? []) {
    const add = isCalc(k) ? (calcInputs(k, isSupported) ?? []) : isSupported(k) ? [k] : [];
    for (const a of add) if (!out.includes(a)) out.push(a);
  }
  if (state.journeyActive) for (const a of journeyInputs(isSupported)) if (!out.includes(a)) out.push(a);
  return out;
}

/** Adds values computed by the app (see calc.ts) to the history at time `t` (s). */
export function pushCalculated(t: number, values: Record<string, number | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || !Number.isFinite(v)) continue;
    addPoint(k, t, v);
  }
}

function addPoint(k: string, t: number, v: number) {
  state.latest[k] = v;
  const mm = state.minmax[k];
  state.minmax[k] = mm ? [Math.min(mm[0], v), Math.max(mm[1], v)] : [v, v];
  let s = state.history.get(k);
  if (!s) {
    s = { t: [], v: [] };
    state.history.set(k, s);
  }
  s.t.push(t);
  s.v.push(v);
  if (s.t.length > MAX_POINTS) {
    s.t.splice(0, s.t.length - MAX_POINTS);
    s.v.splice(0, s.v.length - MAX_POINTS);
  }
}

export function pushFrame(f: LiveFrame) {
  const t = f.t_ms / 1000;
  state.lastFrameT = t;
  for (const [k, v] of Object.entries(f.values)) addPoint(k, t, v);
  state.rateHz = f.rate_hz;
  state.lastDropped = f.dropped;
  emit("frame");
}

/**
 * Latest values that are still being read: those that came within `maxAgeS`
 * seconds of the latest frame. A value that stopped being read (a guided
 * test or the precise mode reads only a few, or the car stopped answering
 * it) is left out instead of repeating its last reading forever.
 */
export function recentValues(maxAgeS = 3): Record<string, number> {
  const out: Record<string, number> = {};
  const now = state.lastFrameT;
  if (now === undefined) return out;
  for (const [k, s] of state.history) {
    const n = s.t.length;
    if (n && s.t[n - 1] >= now - maxAgeS) out[k] = s.v[n - 1];
  }
  return out;
}

/** Value of `key` only if it came in the latest frame (not an old reading). */
export function freshValue(key: string): number | undefined {
  const s = state.history.get(key);
  if (!s || !s.t.length || s.t[s.t.length - 1] !== state.lastFrameT) return undefined;
  return s.v[s.v.length - 1];
}

export function pushLog(e: LogEvent) {
  state.logs.push({ t: Date.now(), dir: e.dir, text: e.text });
  if (state.logs.length > MAX_LOG) state.logs.splice(0, state.logs.length - MAX_LOG);
  emit("log");
}

export function resetLiveData() {
  state.latest = {};
  state.lastFrameT = undefined;
  state.minmax = {};
  state.history.clear();
  state.findings = [];
  state.dtcs = null;
  state.freeze = null;
  state.readiness = null;
  state.mode06 = null;
  state.vehicle = null;
  state.ecus = null;
}
