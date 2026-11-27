//! Tauri application: exposes the obd-core features to the user interface.
//!
//! Every `#[tauri::command]` below can be called from TypeScript with
//! `invoke("name", {...})` (see `src/api.ts`). Long operations run on a
//! blocking thread so the window never freezes.

mod recorder;
mod worker;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use obd_core::dtc::{describe, DtcInfo};
use obd_core::elm327::{AdapterInfo, Elm327, ElmConfig, LogDirection, VehicleIdentity};
use obd_core::pid::{self, PidMeta};
use obd_core::readiness::Readiness;
use obd_core::session::{CsvStyle, Session};
use obd_core::simulator::{Simulator, SimulatorOptions};
use obd_core::transport::tcp::TcpTransport;
use obd_core::transport::{ConnectionTarget, PortInfo, Transport, COMMON_BAUD_RATES};
use obd_core::vin::{decode_vin, VinInfo};
use obd_core::ObdError;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};

use recorder::Recorder;
use worker::Worker;

/// Error sent to the UI: a stable `code` (translated there) plus details.
#[derive(Debug, Serialize, Clone)]
pub struct CmdError {
    pub code: String,
    pub message: String,
}

impl From<ObdError> for CmdError {
    fn from(e: ObdError) -> Self {
        Self {
            code: e.code().into(),
            message: e.to_string(),
        }
    }
}

impl CmdError {
    fn other(code: &str, message: impl ToString) -> Self {
        Self {
            code: code.into(),
            message: message.to_string(),
        }
    }
}

type CmdResult<T> = Result<T, CmdError>;

#[derive(Default)]
struct AppState {
    worker: Mutex<Option<Worker>>,
    recorder: Arc<Mutex<Recorder>>,
    adapter: Mutex<Option<AdapterInfo>>,
    identity: Mutex<VehicleIdentity>,
}

/// Runs blocking work off the async runtime.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> CmdResult<T> + Send + 'static,
) -> CmdResult<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| CmdError::other("internal", e))?
}

/// Runs `f` on the connection worker.
async fn on_worker<T, F>(state: &State<'_, AppState>, f: F) -> CmdResult<T>
where
    T: Send + 'static,
    F: FnOnce(&mut Elm327) -> Result<T, ObdError> + Send + 'static,
{
    let tx = {
        let guard = state.worker.lock().unwrap();
        let w = guard.as_ref().ok_or(ObdError::NotConnected)?;
        // Hand the job over now; wait for the answer without holding the lock.
        let (tx, rx) = std::sync::mpsc::channel();
        let job_tx = tx.clone();
        let _ = w.call_async(move |elm| {
            let _ = job_tx.send(f(elm));
        });
        drop(tx);
        rx
    };
    blocking(move || {
        tx.recv_timeout(Duration::from_secs(90))
            .map_err(|_| CmdError::from(ObdError::Timeout))?
            .map_err(CmdError::from)
    })
    .await
}

#[derive(Serialize)]
struct AppInfo {
    version: String,
}

#[tauri::command]
fn app_info() -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
    }
}

#[tauri::command]
fn list_ports() -> Vec<PortInfo> {
    obd_core::transport::serial::list_ports()
}

#[tauri::command]
fn pid_catalog() -> Vec<PidMeta> {
    pid::catalog()
}

#[tauri::command]
fn describe_dtc(code: String, lang: String) -> DtcInfo {
    describe(&code, &lang)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConnectRequest {
    target: ConnectionTarget,
    #[serde(default)]
    config: ElmConfig,
    /// Demo only: imitate a quirky clone adapter.
    #[serde(default)]
    demo_quirky: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ConnectResult {
    adapter: AdapterInfo,
    /// The adapter answered but the car did not (ignition off, wrong protocol...).
    vehicle_error: Option<CmdError>,
}

#[derive(Serialize, Clone)]
struct LogEvent {
    dir: LogDirection,
    text: String,
}

fn make_logger(app: &AppHandle) -> obd_core::elm327::Logger {
    let app = app.clone();
    Box::new(move |dir, text| {
        let _ = app.emit(
            "elm-log",
            LogEvent {
                dir,
                text: text.to_string(),
            },
        );
    })
}

/// Opens the transport and configures the adapter (trying several baud rates
/// on serial ports when `baud_rate` is 0).
fn open_adapter(req: &ConnectRequest, app: &AppHandle) -> CmdResult<Elm327> {
    let setup = |t: Box<dyn Transport>| -> Result<Elm327, ObdError> {
        let mut elm = Elm327::new(t, req.config.clone());
        elm.set_logger(make_logger(app));
        elm.setup_adapter()?;
        Ok(elm)
    };
    match &req.target {
        ConnectionTarget::Demo => {
            let sim = Simulator::new(SimulatorOptions {
                latency_ms: 25,
                quirky: req.demo_quirky,
                time_scale: 1.0,
            });
            Ok(setup(Box::new(sim))?)
        }
        ConnectionTarget::Tcp { host, port } => {
            let t = TcpTransport::connect(host, *port, Duration::from_secs(5))?;
            Ok(setup(Box::new(t))?)
        }
        ConnectionTarget::Serial { port, baud_rate } => {
            let rates: Vec<u32> = if *baud_rate == 0 {
                COMMON_BAUD_RATES.to_vec()
            } else {
                vec![*baud_rate]
            };
            let mut last = ObdError::Timeout;
            for rate in rates {
                let _ = app.emit(
                    "elm-log",
                    LogEvent {
                        dir: LogDirection::Info,
                        text: format!("{port} @ {rate}"),
                    },
                );
                let t = obd_core::transport::serial::SerialTransport::open(port, rate)?;
                match setup(Box::new(t)) {
                    Ok(elm) => return Ok(elm),
                    Err(
                        e @ (ObdError::Timeout | ObdError::UnknownCommand | ObdError::Parse(_)),
                    ) => last = e,
                    Err(e) => return Err(e.into()),
                }
            }
            Err(last.into())
        }
    }
}

#[tauri::command]
async fn connect(
    app: AppHandle,
    state: State<'_, AppState>,
    request: ConnectRequest,
) -> CmdResult<ConnectResult> {
    // Close a previous connection first.
    let old = state.worker.lock().unwrap().take();
    drop(old);

    let app2 = app.clone();
    let (elm, vehicle_error) = blocking(move || {
        let mut elm = open_adapter(&request, &app2)?;
        let vehicle_error = elm.connect_vehicle().err().map(CmdError::from);
        Ok((elm, vehicle_error))
    })
    .await?;
    let adapter = elm.info.clone();
    *state.adapter.lock().unwrap() = Some(adapter.clone());
    *state.identity.lock().unwrap() = VehicleIdentity::default();
    *state.worker.lock().unwrap() = Some(Worker::spawn(elm, app, state.recorder.clone()));
    Ok(ConnectResult {
        adapter,
        vehicle_error,
    })
}

/// Tries to reach the vehicle again (e.g. after turning the ignition on).
#[tauri::command]
async fn retry_vehicle(state: State<'_, AppState>) -> CmdResult<AdapterInfo> {
    let info = on_worker(&state, |elm| elm.connect_vehicle().cloned()).await?;
    *state.adapter.lock().unwrap() = Some(info.clone());
    Ok(info)
}

#[tauri::command]
async fn disconnect(state: State<'_, AppState>) -> CmdResult<()> {
    let old = state.worker.lock().unwrap().take();
    *state.adapter.lock().unwrap() = None;
    blocking(move || {
        drop(old);
        Ok(())
    })
    .await
}

#[tauri::command]
fn set_live(state: State<'_, AppState>, keys: Vec<String>, polling: bool) -> CmdResult<()> {
    let guard = state.worker.lock().unwrap();
    let w = guard.as_ref().ok_or(ObdError::NotConnected)?;
    w.set_live(keys);
    w.set_polling(polling);
    Ok(())
}

#[derive(Serialize)]
struct DtcReport {
    stored: Vec<DtcInfo>,
    pending: Vec<DtcInfo>,
    permanent: Vec<DtcInfo>,
}

#[tauri::command]
async fn read_dtcs(state: State<'_, AppState>, lang: String) -> CmdResult<DtcReport> {
    on_worker(&state, move |elm| {
        let d = |list: Vec<obd_core::dtc::Dtc>| {
            list.iter()
                .map(|c| describe(&c.0, &lang))
                .collect::<Vec<_>>()
        };
        Ok(DtcReport {
            stored: d(elm.read_stored_dtcs()?),
            pending: d(elm.read_pending_dtcs()?),
            permanent: d(elm.read_permanent_dtcs()?),
        })
    })
    .await
}

#[tauri::command]
async fn clear_dtcs(state: State<'_, AppState>) -> CmdResult<()> {
    on_worker(&state, |elm| elm.clear_dtcs()).await
}

#[derive(Serialize)]
struct FreezeValue {
    key: String,
    value: f64,
}

#[derive(Serialize)]
struct FreezeFrame {
    dtc: Option<DtcInfo>,
    values: Vec<FreezeValue>,
}

const FREEZE_PIDS: [u8; 12] = [
    0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F, 0x11,
];

#[tauri::command]
async fn read_freeze_frame(state: State<'_, AppState>, lang: String) -> CmdResult<FreezeFrame> {
    on_worker(&state, move |elm| {
        let dtc = match elm.read_freeze_frame_dtc() {
            Ok(d) => d.map(|d| describe(&d.0, &lang)),
            Err(ObdError::NoData) => None,
            Err(e) => return Err(e),
        };
        let mut values = Vec::new();
        if dtc.is_some() {
            for p in FREEZE_PIDS {
                if let (Ok(v), Some(def)) = (elm.read_freeze_frame_pid(p), pid::find(p)) {
                    values.push(FreezeValue {
                        key: def.key.into(),
                        value: v.value,
                    });
                }
            }
        }
        Ok(FreezeFrame { dtc, values })
    })
    .await
}

#[tauri::command]
async fn read_readiness(state: State<'_, AppState>) -> CmdResult<Readiness> {
    on_worker(&state, |elm| elm.read_readiness()).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct VehicleInfo {
    adapter: AdapterInfo,
    identity: VehicleIdentity,
    vin_info: Option<VinInfo>,
    battery_voltage: Option<f64>,
}

fn current_year() -> u16 {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    (1970 + secs / 31_556_952) as u16
}

#[tauri::command]
async fn read_vehicle_info(state: State<'_, AppState>) -> CmdResult<VehicleInfo> {
    let (adapter, identity, voltage) = on_worker(&state, |elm| {
        let identity = elm.read_vehicle_identity();
        Ok((elm.info.clone(), identity, elm.battery_voltage().ok()))
    })
    .await?;
    *state.identity.lock().unwrap() = identity.clone();
    let vin_info = identity
        .vin
        .as_deref()
        .map(|v| decode_vin(v, current_year()));
    Ok(VehicleInfo {
        adapter,
        identity,
        vin_info,
        battery_voltage: voltage,
    })
}

/// AT terminal: sends any text and returns the raw answer.
#[tauri::command]
async fn send_raw(
    state: State<'_, AppState>,
    command: String,
    timeout_ms: Option<u64>,
) -> CmdResult<String> {
    let t = Duration::from_millis(timeout_ms.unwrap_or(5_000).clamp(100, 60_000));
    on_worker(&state, move |elm| elm.raw_command(command.trim(), t))
        .await
        .map(|raw| {
            raw.replace('\0', "")
                .replace('\r', "\n")
                .trim_end_matches(['>', '\n'])
                .trim()
                .to_string()
        })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatus {
    recording: bool,
    frames: usize,
    last_frames: usize,
    last_duration_s: f64,
}

fn recording_status(r: &Recorder) -> RecordingStatus {
    RecordingStatus {
        recording: r.is_recording(),
        frames: r.frame_count(),
        last_frames: r.last.as_ref().map(|s| s.frames.len()).unwrap_or(0),
        last_duration_s: r.last.as_ref().map(|s| s.duration_s()).unwrap_or(0.0),
    }
}

#[tauri::command]
fn start_recording(state: State<'_, AppState>) -> RecordingStatus {
    let adapter = state.adapter.lock().unwrap().clone().unwrap_or_default();
    let template = Session {
        format_version: 1,
        app_version: env!("CARGO_PKG_VERSION").into(),
        adapter: format!("{} ({})", adapter.version, adapter.transport),
        protocol: adapter.protocol,
        vehicle: state.identity.lock().unwrap().clone(),
        pids: pid::catalog(),
        ..Default::default()
    };
    let mut r = state.recorder.lock().unwrap();
    r.start(template);
    recording_status(&r)
}

#[tauri::command]
fn stop_recording(state: State<'_, AppState>) -> RecordingStatus {
    let mut r = state.recorder.lock().unwrap();
    r.stop();
    recording_status(&r)
}

#[tauri::command]
fn get_recording_status(state: State<'_, AppState>) -> RecordingStatus {
    recording_status(&state.recorder.lock().unwrap())
}

/// Saves the last recording. `format`: `csv`, `csv_br` or `json`.
#[tauri::command]
async fn export_session(state: State<'_, AppState>, format: String, path: String) -> CmdResult<()> {
    let session = state
        .recorder
        .lock()
        .unwrap()
        .last
        .clone()
        .ok_or_else(|| CmdError::other("no_recording", "nothing recorded yet"))?;
    blocking(move || {
        let text = match format.as_str() {
            "csv" => session.to_csv(CsvStyle::Standard),
            // UTF-8 BOM so Excel shows accents and units (°C) correctly.
            "csv_br" => format!("\u{FEFF}{}", session.to_csv(CsvStyle::ExcelBr)),
            "json" => session.to_json(),
            other => return Err(CmdError::other("format", format!("unknown format {other}"))),
        };
        std::fs::write(&path, text).map_err(|e| CmdError::other("io", e))
    })
    .await
}

/// Opens a recording saved as JSON so it can be viewed again.
#[tauri::command]
async fn load_session(path: String) -> CmdResult<Session> {
    blocking(move || {
        let text = std::fs::read_to_string(&path).map_err(|e| CmdError::other("io", e))?;
        Session::from_json(&text).map_err(|e| CmdError::other("parse", e))
    })
    .await
}

/// Saves bytes produced by the UI (PNG charts, reports).
#[tauri::command]
async fn save_file(path: String, data: Vec<u8>) -> CmdResult<()> {
    blocking(move || std::fs::write(&path, data).map_err(|e| CmdError::other("io", e))).await
}

/// Saves text produced by the UI (HTML report).
#[tauri::command]
async fn save_text(path: String, text: String) -> CmdResult<()> {
    blocking(move || std::fs::write(&path, text).map_err(|e| CmdError::other("io", e))).await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_ports,
            pid_catalog,
            describe_dtc,
            connect,
            retry_vehicle,
            disconnect,
            set_live,
            read_dtcs,
            clear_dtcs,
            read_freeze_frame,
            read_readiness,
            read_vehicle_info,
            send_raw,
            start_recording,
            stop_recording,
            get_recording_status,
            export_session,
            load_session,
            save_file,
            save_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
