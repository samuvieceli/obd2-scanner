// Typed bridge to the Rust backend (src-tauri/src/lib.rs).
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface CmdError {
  code: string;
  message: string;
}

export interface PortInfo {
  name: string;
  kind: "usb" | "bluetooth" | "pci" | "unknown";
  description: string;
}

export type Category = "engine" | "fuel" | "air" | "temperature" | "emissions" | "electrical" | "vehicle";

export interface PidMeta {
  pid: number;
  key: string;
  unit: string;
  min: number;
  max: number;
  category: Category;
}

/** Car model with manufacturer parameters (OBDb data, crates/obd-core/src/maker.rs). */
export interface MakerModel {
  id: string;
  make: string;
  model: string;
  params: number;
  /** Parameters confirmed on a real car in some model year. */
  verified: number;
}

/** A named raw value: `word` is on/off/yes/no, otherwise `en`/`pt` name it. */
export interface MakerState {
  raw: number;
  word?: "on" | "off" | "yes" | "no";
  en?: string;
  pt?: string;
}

/** One manufacturer parameter of the chosen model. */
export interface MakerParam {
  key: string;
  name: string;
  /** OBDb group: Engine, Transmission, Battery... */
  group: string;
  unit: string;
  min: number;
  max: number;
  /** Confirmed on a real car (in this model year, when known). */
  verified: boolean;
  states?: MakerState[];
}

export interface AdapterInfo {
  version: string;
  protocol: string;
  protocol_number: string;
  transport: string;
  supported_pids: number[];
  unsupported_at: string[];
  likely_clone: boolean;
}

export type ConnectionTarget =
  | { kind: "serial"; port: string; baud_rate: number }
  | { kind: "tcp"; host: string; port: number }
  | { kind: "ble"; id: string; name: string }
  | { kind: "demo" };

export interface BleDevice {
  id: string;
  name: string;
  rssi: number | null;
  likely_obd: boolean;
}

export interface ElmConfig {
  command_timeout_ms: number;
  reset_timeout_ms: number;
  search_timeout_ms: number;
  protocol: string;
  elm_timeout_hex: string;
  multi_pid: boolean;
}

export interface ConnectResult {
  adapter: AdapterInfo;
  vehicleError: CmdError | null;
}

export interface DtcInfo {
  code: string;
  description: string;
  system: string;
  generic: boolean;
  known: boolean;
  brand: string | null;
  translated: boolean;
}

export interface DtcReport {
  stored: DtcInfo[];
  pending: DtcInfo[];
  permanent: DtcInfo[];
}

export interface FreezeFrame {
  dtc: DtcInfo | null;
  values: { key: string; value: number }[];
}

export type MonitorState = "complete" | "incomplete" | "not_supported";

export interface TestResult {
  mid: number;
  tid: number;
  uas_id: number;
  value: number;
  min: number;
  max: number;
  unit: string;
  scaled: boolean;
  passed: boolean;
  group: string;
  index: number;
  test: string | null;
}

export interface Readiness {
  mil_on: boolean;
  dtc_count: number;
  compression_ignition: boolean;
  monitors: { key: string; state: MonitorState }[];
}

export interface VehicleIdentity {
  vin: string | null;
  calibration_id: string | null;
  ecu_name: string | null;
  /** PID 1C code (e.g. 29 = OBDBr-2), when the car answers it. */
  obd_standard?: number | null;
  /** PID 51 code (e.g. 9 = bifuel running gasoline), when the car answers it. */
  fuel_type?: number | null;
}

export interface VinInfo {
  vin: string;
  valid_format: boolean;
  check_digit_ok: boolean | null;
  wmi: string;
  region: string;
  country: string;
  manufacturer: string | null;
  model_year: number | null;
  plant_code: string;
  serial: string;
}

export interface VehicleInfo {
  adapter: AdapterInfo;
  identity: VehicleIdentity;
  vinInfo: VinInfo | null;
  batteryVoltage: number | null;
}

export interface RecordingStatus {
  recording: boolean;
  frames: number;
  /** Events marked in the recording in progress. */
  marks: number;
  lastFrames: number;
  lastDurationS: number;
  /** Identifies the recording in progress (or the last one). */
  startedAtUnixMs: number | null;
}

export interface LiveFrame {
  t_ms: number;
  values: Record<string, number>;
  dropped: string[];
  rate_hz: number;
}

export interface AdapterReport {
  claimed: string | null;
  real: string | null;
  probes: { version: string; command: string; result: "accepted" | "rejected" | "no_answer" }[];
  overclaims: boolean;
}

export interface EcuInfo {
  address: string;
  role: "engine" | "transmission" | "other";
  supported_pids: number;
  name: string | null;
  /** Chassis number stored in this unit (mode 09 PID 02), when it answers. */
  vin: string | null;
  ids: { key: string; value: string }[];
}

/** Change in the state of the link to the adapter (see worker.rs). */
export interface LinkStatus {
  state: "recovering" | "recovered" | "vehicle_silent" | "reconnecting" | "reconnected";
  attempt: number;
  nextInS: number;
  adapter: AdapterInfo | null;
  error: CmdError | null;
}

export type Severity = "ok" | "info" | "warning" | "critical";

export interface Finding {
  id: string;
  severity: Severity;
  values: Record<string, number>;
}

export interface LogEvent {
  dir: "tx" | "rx" | "info";
  text: string;
}

export interface Session {
  format_version: number;
  app_version: string;
  started_at_unix_ms: number;
  adapter: string;
  protocol: string;
  vehicle: VehicleIdentity;
  pids: PidMeta[];
  frames: { t_ms: number; values: Record<string, number> }[];
  /** Moments marked by the driver, ms since the start (missing in old files). */
  marks?: number[];
  /** Diagnostic reads saved with the recording (missing in old files). */
  diagnostics?: DiagnosticSnapshot[];
}

/** Diagnostic reads taken at one moment of a recording; a part that could
 * not be read is missing. */
export interface DiagnosticSnapshot {
  /** Milliseconds since the start of the recording (set by the program). */
  t_ms?: number;
  vehicle?: VehicleInfo;
  dtcs?: DtcReport;
  freeze?: FreezeFrame;
  readiness?: Readiness;
  mode06?: TestResult[];
}

/** Summary of a recording for the diagnostic report (crates/obd-core/src/report.rs). */
export interface RecordingReport {
  app_version: string;
  started_at_unix_ms: number;
  adapter: string;
  protocol: string;
  vehicle: VehicleIdentity;
  duration_s: number;
  frames: number;
  marks: number[];
  diagnostics: DiagnosticSnapshot[];
  stats: { key: string; unit: string; min: number; avg: number; max: number; count: number }[];
  findings: { id: string; severity: Severity; values: Record<string, number>; first_s: number; last_s: number; seconds: number }[];
  charts: { key: string; unit: string; t: number[]; v: number[] }[];
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/** Size of the bundled databases (Documentation screen). */
export interface DataInfo {
  dtc: { codes: number; translatedPt: number; brands: [string, number][] };
  wmis: number;
}

export const api = {
  keepAwake: (on: boolean) => invoke<void>("keep_awake", { on }),
  recoveredRecording: () => invoke<number | null>("recovered_recording"),
  appInfo: () => invoke<{ version: string; portableData: string | null }>("app_info"),
  listPorts: () => invoke<PortInfo[]>("list_ports"),
  scanBle: (seconds?: number) => invoke<BleDevice[]>("scan_ble", { seconds }),
  pidCatalog: () => invoke<PidMeta[]>("pid_catalog"),
  makerModels: () => invoke<MakerModel[]>("maker_models"),
  makerParams: (model: string, year: number | null, lang: string) => invoke<MakerParam[]>("maker_params", { model, year, lang }),
  dataInfo: () => invoke<DataInfo>("data_info"),
  describeDtc: (code: string, lang: string) => invoke<DtcInfo>("describe_dtc", { code, lang }),
  connect: (target: ConnectionTarget, config: ElmConfig, demoQuirky: boolean, autoReconnect: boolean) =>
    invoke<ConnectResult>("connect", { request: { target, config, demoQuirky, autoReconnect } }),
  retryVehicle: () => invoke<AdapterInfo>("retry_vehicle"),
  disconnect: () => invoke<void>("disconnect"),
  setLive: (keys: string[], polling: boolean) => invoke<void>("set_live", { keys, polling }),
  readDtcs: (lang: string) => invoke<DtcReport>("read_dtcs", { lang }),
  clearDtcs: () => invoke<void>("clear_dtcs"),
  readFreezeFrame: (lang: string) => invoke<FreezeFrame>("read_freeze_frame", { lang }),
  readReadiness: () => invoke<Readiness>("read_readiness"),
  readMode06: () => invoke<TestResult[]>("read_mode06"),
  /** Reads these parameters once; those the car lacks are left out. */
  readPids: (keys: string[]) => invoke<Record<string, number>>("read_pids", { keys }),
  testAdapter: () => invoke<AdapterReport>("test_adapter"),
  scanEcus: () => invoke<EcuInfo[]>("scan_ecus"),
  readVehicleInfo: () => invoke<VehicleInfo>("read_vehicle_info"),
  sendRaw: (command: string, timeoutMs?: number) => invoke<string>("send_raw", { command, timeoutMs }),
  /** Sets the adapter up again if the AT terminal changed it; true when it did. */
  restoreAdapter: () => invoke<boolean>("restore_adapter"),
  startRecording: () => invoke<RecordingStatus>("start_recording"),
  stopRecording: () => invoke<RecordingStatus>("stop_recording"),
  addMark: () => invoke<RecordingStatus>("add_mark"),
  addRecordingDiagnostics: (startedAt: number, snapshot: DiagnosticSnapshot) =>
    invoke<boolean>("add_recording_diagnostics", { startedAt, snapshot }),
  /** Report of the recording saved at `path`, or of the last recording. */
  recordingReport: (path?: string) => invoke<RecordingReport>("recording_report", { path: path ?? null }),
  recordingStatus: () => invoke<RecordingStatus>("get_recording_status"),
  exportSession: (format: "csv" | "csv_br" | "json", path: string) =>
    invoke<void>("export_session", { format, path }),
  loadSession: (path: string) => invoke<Session>("load_session", { path }),
  interpretFrames: (frames: Session["frames"]) => invoke<Finding[]>("interpret_frames", { frames }),
  saveFile: (path: string, data: number[]) => invoke<void>("save_file", { path, data }),
  saveText: (path: string, text: string) => invoke<void>("save_text", { path, text }),
};

export const events = {
  liveFrame: (f: (e: LiveFrame) => void): Promise<UnlistenFn> => listen<LiveFrame>("live-frame", (e) => f(e.payload)),
  findings: (f: (e: Finding[]) => void): Promise<UnlistenFn> => listen<Finding[]>("findings", (e) => f(e.payload)),
  log: (f: (e: LogEvent) => void): Promise<UnlistenFn> => listen<LogEvent>("elm-log", (e) => f(e.payload)),
  linkStatus: (f: (e: LinkStatus) => void): Promise<UnlistenFn> => listen<LinkStatus>("link-status", (e) => f(e.payload)),
  connectionLost: (f: (e: CmdError) => void): Promise<UnlistenFn> =>
    listen<CmdError>("connection-lost", (e) => f(e.payload)),
};
