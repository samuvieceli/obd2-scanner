//! Tauri application: exposes the obd-core features to the user interface.
//!
//! Every `#[tauri::command]` below can be called from TypeScript with
//! `invoke("name", {...})` (see `src/api.ts`). Long operations run on a
//! blocking thread so the window never freezes.

mod portable;
mod recorder;
mod worker;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use obd_core::ObdError;
use obd_core::dtc::{self, DtcInfo, DtcStats, brand_from_manufacturer, describe_for};
use obd_core::elm327::{AdapterInfo, Elm327, ElmConfig, LogDirection, VehicleIdentity};
use obd_core::pid::{self, PidMeta};
use obd_core::readiness::Readiness;
use obd_core::session::{CsvStyle, Session};
use obd_core::simulator::{Simulator, SimulatorOptions};
use obd_core::transport::tcp::TcpTransport;
use obd_core::transport::{COMMON_BAUD_RATES, ConnectionTarget, PortInfo, Transport};
use obd_core::vin::{self, VinInfo, decode_vin};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

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
    /// Frames of a recording recovered at start-up, shown once to the user.
    recovered: Mutex<Option<usize>>,
    /// The AT terminal sent a command that may have changed the adapter's
    /// setup (headers, protocol, reset...): set it up again on leaving.
    terminal_changed_setup: AtomicBool,
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
            .map_err(|e| {
                CmdError::from(match e {
                    // The job was dropped: the link is down and being reopened.
                    std::sync::mpsc::RecvTimeoutError::Disconnected => ObdError::NotConnected,
                    std::sync::mpsc::RecvTimeoutError::Timeout => ObdError::Timeout,
                })
            })?
            .map_err(CmdError::from)
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    /// Folder beside the program holding the data (portable version).
    portable_data: Option<String>,
}

/// Data folder of the portable version, decided once at start-up.
struct PortableData(Option<std::path::PathBuf>);

#[tauri::command]
fn app_info(portable: State<'_, PortableData>) -> AppInfo {
    AppInfo {
        version: env!("CARGO_PKG_VERSION").into(),
        portable_data: portable.0.as_ref().map(|p| p.display().to_string()),
    }
}

/// Keeps the screen on while reading, recording or showing the HUD. A sync
/// command runs on the main thread, which lives as long as the program: the
/// Windows request is tied to the thread that makes it.
#[tauri::command]
fn keep_awake(on: bool) {
    portable::keep_awake(on);
}

#[tauri::command]
fn list_ports() -> Vec<PortInfo> {
    obd_core::transport::serial::list_ports()
}

/// Scans for Bluetooth LE devices for a few seconds.
#[tauri::command]
async fn scan_ble(seconds: Option<u64>) -> CmdResult<Vec<obd_core::transport::ble::BleDevice>> {
    let secs = seconds.unwrap_or(5).clamp(2, 20);
    blocking(move || Ok(obd_core::transport::ble::scan(Duration::from_secs(secs))?)).await
}

#[tauri::command]
fn pid_catalog() -> Vec<PidMeta> {
    pid::catalog()
}

/// Size of the bundled databases, for the Documentation screen.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DataInfo {
    dtc: DtcStats,
    wmis: usize,
}

#[tauri::command]
fn data_info() -> DataInfo {
    DataInfo {
        dtc: dtc::stats(),
        wmis: vin::wmi_count(),
    }
}

#[tauri::command]
fn describe_dtc(state: State<'_, AppState>, code: String, lang: String) -> DtcInfo {
    let vin = state.identity.lock().unwrap().vin.clone();
    describe_for(&code, &lang, brand_of(vin.as_deref()))
}

/// Brand table for manufacturer-specific codes, found through the VIN.
fn brand_of(vin: Option<&str>) -> Option<&'static str> {
    let info = decode_vin(vin?, current_year());
    brand_from_manufacturer(info.manufacturer.as_deref()?)
}

/// VIN known from an earlier read, or read now (cheap, once per connection).
fn ensure_vin(elm: &mut Elm327, known: Option<String>) -> Option<String> {
    known.or_else(|| elm.read_vehicle_identity().vin)
}

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ConnectRequest {
    target: ConnectionTarget,
    #[serde(default)]
    config: ElmConfig,
    /// Demo only: imitate a quirky clone adapter.
    #[serde(default)]
    demo_quirky: bool,
    /// Reopen the connection by itself when it drops.
    #[serde(default)]
    auto_reconnect: bool,
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
        ConnectionTarget::Ble { id, name } => {
            let t = obd_core::transport::ble::BleTransport::open(id, name)?;
            Ok(setup(Box::new(t))?)
        }
        ConnectionTarget::Serial { port, baud_rate } => {
            let log = |rate: u32| {
                let _ = app.emit(
                    "elm-log",
                    LogEvent {
                        dir: LogDirection::Info,
                        text: format!("{port} @ {rate}"),
                    },
                );
            };
            let retryable = |e: &ObdError| {
                matches!(
                    e,
                    ObdError::Timeout | ObdError::UnknownCommand | ObdError::Parse(_)
                )
            };
            if *baud_rate != 0 {
                log(*baud_rate);
                let t = obd_core::transport::serial::SerialTransport::open(port, *baud_rate)?;
                return Ok(setup(Box::new(t))?);
            }
            // One opening: the quick speed probe runs on the same port.
            let (t, found) = obd_core::transport::serial::open_auto(port, &COMMON_BAUD_RATES)?;
            log(found.unwrap_or(COMMON_BAUD_RATES[0]));
            let mut last = match setup(Box::new(t)) {
                Ok(elm) => return Ok(elm),
                Err(e) if retryable(&e) => e,
                Err(e) => return Err(e.into()),
            };
            // No quick answer: a full ATZ at every other speed, but only on a
            // cable. On Bluetooth the speed does not matter, and reopening
            // just reconnects the radio for nothing.
            if found.is_some() || obd_core::transport::serial::is_bluetooth(port) {
                return Err(last.into());
            }
            for &rate in &COMMON_BAUD_RATES[1..] {
                log(rate);
                let t = obd_core::transport::serial::SerialTransport::open(port, rate)?;
                match setup(Box::new(t)) {
                    Ok(elm) => return Ok(elm),
                    Err(e) if retryable(&e) => last = e,
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
    // Forget the previous car and adapter now, so a failed attempt does not
    // leave them labelling the next recording.
    *state.adapter.lock().unwrap() = None;
    *state.identity.lock().unwrap() = VehicleIdentity::default();
    state.terminal_changed_setup.store(false, Ordering::Relaxed);

    let app2 = app.clone();
    let req = request.clone();
    let (elm, vehicle_error) = blocking(move || {
        let mut elm = open_adapter(&req, &app2)?;
        let vehicle_error = elm.connect_vehicle().err().map(CmdError::from);
        Ok((elm, vehicle_error))
    })
    .await?;
    let adapter = elm.info.clone();
    let reopen = request
        .auto_reconnect
        .then(|| reopener(request, &adapter, app.clone()));
    *state.adapter.lock().unwrap() = Some(adapter.clone());
    *state.identity.lock().unwrap() = VehicleIdentity::default();
    *state.worker.lock().unwrap() = Some(Worker::spawn(elm, app, state.recorder.clone(), reopen));
    Ok(ConnectResult {
        adapter,
        vehicle_error,
    })
}

/// Opens the same adapter again for automatic reconnection. A serial port
/// found by trying several speeds is reopened directly at the speed that
/// worked, and the protocol found is reused (no slow search).
fn reopener(mut req: ConnectRequest, found: &AdapterInfo, app: AppHandle) -> worker::Reopen {
    if let ConnectionTarget::Serial { baud_rate, .. } = &mut req.target
        && *baud_rate == 0
        && let Some(rate) = found
            .transport
            .rsplit_once('@')
            .and_then(|(_, r)| r.trim().parse().ok())
    {
        *baud_rate = rate;
    }
    let known = found.protocol_number.trim_start_matches('A');
    if !known.is_empty() {
        req.config.protocol = known.to_string();
    }
    // A USB adapter unplugged and plugged back may get another COM number:
    // remember what identifies it, and look for it there when the old port
    // fails.
    let usb = match &req.target {
        ConnectionTarget::Serial { port, .. } => obd_core::transport::serial::usb_identity(port),
        _ => None,
    };
    Box::new(move || {
        let first = open_adapter(&req, &app);
        let (Err(_), Some(id), ConnectionTarget::Serial { port, .. }) =
            (&first, &usb, &mut req.target)
        else {
            return first;
        };
        match obd_core::transport::serial::find_usb_port(id) {
            Some(moved) if !moved.eq_ignore_ascii_case(port) => {
                *port = moved;
                open_adapter(&req, &app)
            }
            _ => first,
        }
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
    *state.identity.lock().unwrap() = VehicleIdentity::default();
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
    let known_vin = state.identity.lock().unwrap().vin.clone();
    on_worker(&state, move |elm| {
        let vin = ensure_vin(elm, known_vin);
        let brand = brand_of(vin.as_deref());
        let d = |list: Vec<obd_core::dtc::Dtc>| {
            list.iter()
                .map(|c| describe_for(&c.0, &lang, brand))
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
    let known_vin = state.identity.lock().unwrap().vin.clone();
    on_worker(&state, move |elm| {
        let brand = brand_of(ensure_vin(elm, known_vin).as_deref());
        let dtc = match elm.read_freeze_frame_dtc() {
            Ok(d) => d.map(|d| describe_for(&d.0, &lang, brand)),
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

/// Mode 06 on-board test results.
#[tauri::command]
async fn read_mode06(state: State<'_, AppState>) -> CmdResult<Vec<obd_core::mode06::TestResult>> {
    on_worker(&state, |elm| elm.read_mode06()).await
}

/// Tries AT commands of each ELM327 version to find the adapter's real level.
#[tauri::command]
async fn test_adapter(
    state: State<'_, AppState>,
) -> CmdResult<obd_core::adapter_test::AdapterReport> {
    let report = on_worker(&state, obd_core::adapter_test::test_adapter).await?;
    Ok(report)
}

/// Lists the control units that answer OBD requests, with their identity.
#[tauri::command]
async fn scan_ecus(state: State<'_, AppState>) -> CmdResult<Vec<obd_core::ecu_scan::EcuInfo>> {
    on_worker(&state, obd_core::ecu_scan::scan_ecus).await
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
    // Read-only: commands that would write to the car or the adapter never
    // leave the program (see obd_core::safety).
    obd_core::safety::check_terminal_command(&command)
        .map_err(|b| CmdError::other(b.code(), command.trim()))?;
    if obd_core::safety::changes_adapter_setup(&command) {
        state.terminal_changed_setup.store(true, Ordering::Relaxed);
    }
    let command = obd_core::safety::normalize(&command);
    let t = Duration::from_millis(timeout_ms.unwrap_or(5_000).clamp(100, 60_000));
    on_worker(&state, move |elm| elm.raw_command(&command, t))
        .await
        .map(|raw| {
            raw.replace('\0', "")
                .replace('\r', "\n")
                .trim_end_matches(['>', '\n'])
                .trim()
                .to_string()
        })
}

/// Leaving the AT terminal: if a command there may have changed the
/// adapter's setup, set it up again the way the program expects (same
/// protocol, no slow search). Returns whether anything was done.
#[tauri::command]
async fn restore_adapter(state: State<'_, AppState>) -> CmdResult<bool> {
    if !state.terminal_changed_setup.swap(false, Ordering::Relaxed) {
        return Ok(false);
    }
    on_worker(&state, |elm| elm.reconfigure()).await?;
    Ok(true)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecordingStatus {
    recording: bool,
    frames: usize,
    /// Events marked in the recording in progress.
    marks: usize,
    last_frames: usize,
    last_duration_s: f64,
    /// Identifies the recording in progress (or the last one) when saving
    /// diagnostic reads with it.
    started_at_unix_ms: Option<u64>,
}

fn recording_status(r: &Recorder) -> RecordingStatus {
    RecordingStatus {
        recording: r.is_recording(),
        frames: r.frame_count(),
        marks: r.mark_count(),
        last_frames: r.last.as_ref().map(|s| s.frames.len()).unwrap_or(0),
        last_duration_s: r.last.as_ref().map(|s| s.duration_s()).unwrap_or(0.0),
        started_at_unix_ms: r.started_at(),
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

/// Marks this moment of the recording (the driver felt a problem).
#[tauri::command]
fn add_mark(state: State<'_, AppState>) -> CmdResult<RecordingStatus> {
    let mut r = state.recorder.lock().unwrap();
    r.mark()
        .ok_or_else(|| CmdError::other("not_recording", "no recording in progress"))?;
    Ok(recording_status(&r))
}

#[tauri::command]
fn stop_recording(state: State<'_, AppState>) -> RecordingStatus {
    let mut r = state.recorder.lock().unwrap();
    r.stop();
    recording_status(&r)
}

/// Saves diagnostic reads (vehicle, codes, readiness, Mode 06) with the
/// recording that started at `started_at`. False when it no longer exists.
#[tauri::command]
fn add_recording_diagnostics(
    state: State<'_, AppState>,
    started_at: u64,
    snapshot: obd_core::session::Snapshot,
) -> bool {
    state.recorder.lock().unwrap().attach(started_at, snapshot)
}

/// Summary for the diagnostic report: of the recording saved at `path`, or
/// of the last recording when `path` is empty.
#[tauri::command]
async fn recording_report(
    state: State<'_, AppState>,
    path: Option<String>,
) -> CmdResult<obd_core::report::RecordingReport> {
    let last = match path {
        Some(_) => None,
        None => Some(
            state
                .recorder
                .lock()
                .unwrap()
                .last
                .clone()
                .ok_or_else(|| CmdError::other("no_recording", "nothing recorded yet"))?,
        ),
    };
    blocking(move || {
        let session = match (last, path) {
            (Some(s), _) => s,
            (None, path) => read_session(&path.unwrap_or_default())?,
        };
        Ok(obd_core::report::RecordingReport::from_session(&session))
    })
    .await
}

/// Frames of a recording interrupted last time (program closed or crashed
/// while recording), now available for export. Answers only once.
#[tauri::command]
fn recovered_recording(state: State<'_, AppState>) -> Option<usize> {
    state.recovered.lock().unwrap().take()
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
    blocking(move || read_session(&path)).await
}

fn read_session(path: &str) -> CmdResult<Session> {
    let text = std::fs::read_to_string(path).map_err(|e| CmdError::other("io", e))?;
    Session::from_json(&text).map_err(|e| CmdError::other("parse", e))
}

/// Interprets a window of recorded frames (used while replaying a recording,
/// when there is no live worker computing findings).
#[tauri::command]
fn interpret_frames(frames: Vec<obd_core::session::Frame>) -> Vec<obd_core::interpret::Finding> {
    let mut interpreter = obd_core::interpret::Interpreter::new();
    for f in &frames {
        let t = f.t_ms as f64 / 1000.0;
        for (k, v) in &f.values {
            interpreter.push(k, t, *v);
        }
    }
    interpreter.evaluate()
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
    if portable::webview_missing() {
        portable::alert("OBD2 Scanner", portable::WEBVIEW_MISSING);
        return;
    }
    let portable_data = portable::data_dir();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .manage(PortableData(portable_data.clone()))
        // The main window is created here rather than from tauri.conf.json
        // ("create": false) so the portable version can keep its data beside
        // the program.
        .setup(move |app| {
            let config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .ok_or("no window in tauri.conf.json")?;
            // Safety copy of recordings: in the portable folder or the
            // program's data folder in the user's Windows profile.
            let data_dir = match &portable_data {
                Some(dir) => Some(dir.clone()),
                None => app.path().app_local_data_dir().ok(),
            };
            if let Some(dir) = data_dir {
                let state = app.state::<AppState>();
                let mut recorder = Recorder::with_backup(dir);
                *state.recovered.lock().unwrap() = recorder.recover();
                *state.recorder.lock().unwrap() = recorder;
            }
            let mut window = tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?;
            if let Some(dir) = portable_data {
                window = window.data_directory(dir);
            }
            window.build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            keep_awake,
            list_ports,
            scan_ble,
            pid_catalog,
            data_info,
            describe_dtc,
            connect,
            retry_vehicle,
            disconnect,
            set_live,
            read_dtcs,
            clear_dtcs,
            read_freeze_frame,
            read_readiness,
            read_mode06,
            test_adapter,
            scan_ecus,
            read_vehicle_info,
            send_raw,
            restore_adapter,
            start_recording,
            stop_recording,
            add_mark,
            add_recording_diagnostics,
            recording_report,
            get_recording_status,
            recovered_recording,
            export_session,
            load_session,
            interpret_frames,
            save_file,
            save_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running the application");
}
