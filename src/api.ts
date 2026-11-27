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

export interface AdapterInfo {
  version: string;
  protocol: string;
  protocol_number: string;
  transport: string;
  supported_pids: number[];
}

export type ConnectionTarget =
  | { kind: "serial"; port: string; baud_rate: number }
  | { kind: "tcp"; host: string; port: number }
  | { kind: "demo" };

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
  lastFrames: number;
  lastDurationS: number;
}

export interface LiveFrame {
  t_ms: number;
  values: Record<string, number>;
  dropped: string[];
  rate_hz: number;
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
}

export const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api = {
  appInfo: () => invoke<{ version: string }>("app_info"),
  listPorts: () => invoke<PortInfo[]>("list_ports"),
  pidCatalog: () => invoke<PidMeta[]>("pid_catalog"),
  describeDtc: (code: string, lang: string) => invoke<DtcInfo>("describe_dtc", { code, lang }),
  connect: (target: ConnectionTarget, config: ElmConfig, demoQuirky: boolean) =>
    invoke<ConnectResult>("connect", { request: { target, config, demoQuirky } }),
  retryVehicle: () => invoke<AdapterInfo>("retry_vehicle"),
  disconnect: () => invoke<void>("disconnect"),
  setLive: (keys: string[], polling: boolean) => invoke<void>("set_live", { keys, polling }),
  readDtcs: (lang: string) => invoke<DtcReport>("read_dtcs", { lang }),
  clearDtcs: () => invoke<void>("clear_dtcs"),
  readFreezeFrame: (lang: string) => invoke<FreezeFrame>("read_freeze_frame", { lang }),
  readReadiness: () => invoke<Readiness>("read_readiness"),
  readVehicleInfo: () => invoke<VehicleInfo>("read_vehicle_info"),
  sendRaw: (command: string, timeoutMs?: number) => invoke<string>("send_raw", { command, timeoutMs }),
  startRecording: () => invoke<RecordingStatus>("start_recording"),
  stopRecording: () => invoke<RecordingStatus>("stop_recording"),
  recordingStatus: () => invoke<RecordingStatus>("get_recording_status"),
  exportSession: (format: "csv" | "csv_br" | "json", path: string) =>
    invoke<void>("export_session", { format, path }),
  loadSession: (path: string) => invoke<Session>("load_session", { path }),
  saveFile: (path: string, data: number[]) => invoke<void>("save_file", { path, data }),
  saveText: (path: string, text: string) => invoke<void>("save_text", { path, text }),
};

export const events = {
  liveFrame: (f: (e: LiveFrame) => void): Promise<UnlistenFn> => listen<LiveFrame>("live-frame", (e) => f(e.payload)),
  findings: (f: (e: Finding[]) => void): Promise<UnlistenFn> => listen<Finding[]>("findings", (e) => f(e.payload)),
  log: (f: (e: LogEvent) => void): Promise<UnlistenFn> => listen<LogEvent>("elm-log", (e) => f(e.payload)),
  connectionLost: (f: (e: CmdError) => void): Promise<UnlistenFn> =>
    listen<CmdError>("connection-lost", (e) => f(e.payload)),
};
