// Application state shared by all screens, with a tiny publish/subscribe.
import type {
  AdapterInfo,
  CmdError,
  DtcReport,
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

export type Topic = "connection" | "frame" | "findings" | "log" | "recording" | "live-keys" | "session" | "playback" | "trip" | "alerts" | "profile" | "link";

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

function loadKeys(): string[] | null {
  try {
    const v = localStorage.getItem("liveKeys");
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
  polling: false,
  rateHz: 0,
  latest: {} as Record<string, number>,
  /** Time of the last live frame, in seconds. */
  lastFrameT: undefined as number | undefined,
  minmax: {} as Record<string, [number, number]>,
  history: new Map<string, Series>(),
  findings: [] as Finding[],
  recording: { recording: false, frames: 0, lastFrames: 0, lastDurationS: 0 } as RecordingStatus,
  logs: [] as { t: number; dir: LogEvent["dir"]; text: string }[],
  // Cached diagnostic reads, used by the report.
  dtcs: null as DtcReport | null,
  freeze: null as FreezeFrame | null,
  readiness: null as Readiness | null,
  mode06: null as TestResult[] | null,
  vehicle: null as VehicleInfo | null,
  /** A recording opened from disk, shown on the Charts screen. */
  viewSession: null as { name: string; session: Session } | null,
  /** A recording being replayed as if it were live (see playback.ts). */
  playback: null as import("./playback").Playback | null,
  appVersion: "",
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

export function pushFrame(f: LiveFrame) {
  const t = f.t_ms / 1000;
  state.lastFrameT = t;
  for (const [k, v] of Object.entries(f.values)) {
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
  state.rateHz = f.rate_hz;
  emit("frame");
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
}
