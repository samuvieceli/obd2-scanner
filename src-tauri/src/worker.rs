//! The connection worker: one thread owns the adapter.
//!
//! Serial ports and sockets must not be used from two places at once, so a
//! single background thread owns the [`Elm327`] driver. UI commands are sent
//! to it as closures through a channel and run between live-data reads, so
//! the screen stays responsive while data is being polled.
//!
//! The worker also keeps the link alive (see `obd_core::health`):
//! * a frozen or rebooted adapter is reset and reconfigured (`recover`);
//! * a lost link (Bluetooth out of range, cable pulled) is reopened with
//!   growing pauses, for up to 3 minutes, when automatic reconnection is on;
//! * while idle, a quiet `ATRV` every 10 s notices a dropped link early.
//!
//! Every change is announced to the UI with a `link-status` event.

use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use obd_core::ObdError;
use obd_core::elm327::{AdapterInfo, Elm327};
use obd_core::health::{self, Action, LinkHealth, Outcome};
use obd_core::interpret::Interpreter;
use obd_core::pid::{self, BATTERY_VOLTAGE_KEY};
use obd_core::session::Frame;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::CmdError;
use crate::recorder::Recorder;

/// Opens the same adapter again (same port, same settings).
pub type Reopen = Box<dyn FnMut() -> Result<Elm327, CmdError> + Send>;

type Job = Box<dyn FnOnce(&mut Elm327) + Send>;

enum Msg {
    Run(Job),
    SetLive(Vec<String>),
    Polling(bool),
    Stop,
}

pub struct Worker {
    tx: Sender<Msg>,
    handle: Option<JoinHandle<()>>,
}

/// Event sent to the UI after every polling cycle.
#[derive(Serialize, Clone)]
pub struct LiveFrame {
    pub t_ms: u64,
    pub values: HashMap<String, f64>,
    /// Parameters the vehicle stopped answering (removed from polling).
    pub dropped: Vec<String>,
    /// Polling cycles per second.
    pub rate_hz: f64,
}

/// Event sent to the UI when the state of the link changes.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LinkStatus {
    /// `recovering`, `recovered`, `vehicle_silent`, `reconnecting` or `reconnected`.
    pub state: &'static str,
    /// Reconnection attempt number (1-based), 0 otherwise.
    pub attempt: u32,
    /// Seconds until the next reconnection attempt.
    pub next_in_s: u64,
    pub adapter: Option<AdapterInfo>,
    pub error: Option<CmdError>,
}

const MAX_FAILURES: u32 = 3;
/// Idle "are you there?" interval.
const PING_EVERY: Duration = Duration::from_secs(10);
/// Pause after the car stopped answering (ignition off), before trying again.
const VEHICLE_SILENT_PAUSE: Duration = Duration::from_secs(5);

impl Worker {
    /// `reopen` enables automatic reconnection.
    pub fn spawn(
        elm: Elm327,
        app: AppHandle,
        recorder: Arc<Mutex<Recorder>>,
        reopen: Option<Reopen>,
    ) -> Self {
        let (tx, rx) = mpsc::channel::<Msg>();
        let handle = std::thread::Builder::new()
            .name("obd-worker".into())
            .spawn(move || {
                let mut link = Link {
                    elm,
                    app,
                    reopen,
                    health: LinkHealth::new(),
                    paused_until: None,
                    generation: 0,
                };
                run_loop(&mut link, &rx, &recorder)
            })
            .expect("spawn worker thread");
        Self {
            tx,
            handle: Some(handle),
        }
    }

    /// Queues `f` to run on the worker thread (between live-data reads).
    pub fn call_async<F>(&self, f: F) -> Result<(), ObdError>
    where
        F: FnOnce(&mut Elm327) + Send + 'static,
    {
        self.tx
            .send(Msg::Run(Box::new(f)))
            .map_err(|_| ObdError::NotConnected)
    }

    pub fn set_live(&self, keys: Vec<String>) {
        let _ = self.tx.send(Msg::SetLive(keys));
    }

    pub fn set_polling(&self, on: bool) {
        let _ = self.tx.send(Msg::Polling(on));
    }
}

impl Drop for Worker {
    fn drop(&mut self) {
        let _ = self.tx.send(Msg::Stop);
        if let Some(h) = self.handle.take() {
            let _ = h.join();
        }
    }
}

fn is_fatal(e: &ObdError) -> bool {
    matches!(
        e,
        ObdError::Io(_) | ObdError::Connection(_) | ObdError::NotConnected
    )
}

/// The adapter plus everything needed to keep it reachable.
struct Link {
    elm: Elm327,
    app: AppHandle,
    reopen: Option<Reopen>,
    health: LinkHealth,
    /// No polling until then (the car stopped answering).
    paused_until: Option<Instant>,
    /// Counts recoveries and reconnections, so a polling cycle can tell
    /// that the adapter was reset under it.
    generation: u64,
}

/// Answer of [`Link::act`]: keep going or stop the worker.
enum Flow {
    Go,
    Stop,
}

impl Link {
    fn status(&self, state: &'static str) -> LinkStatus {
        LinkStatus {
            state,
            attempt: 0,
            next_in_s: 0,
            adapter: None,
            error: None,
        }
    }

    fn emit(&self, s: LinkStatus) {
        let _ = self.app.emit("link-status", s);
    }

    /// New adapter details for later commands (reports, recordings).
    fn publish_adapter(&self) {
        let state = self.app.state::<crate::AppState>();
        *state.adapter.lock().unwrap() = Some(self.elm.info.clone());
    }

    /// Records the outcome of a request and reacts to it.
    fn observe<T>(&mut self, r: &Result<T, ObdError>, rx: &Receiver<Msg>, ctx: &mut Ctx) -> Flow {
        let mut outcome = Outcome::of(r);
        if self.elm.link_lost() {
            outcome = Outcome::LinkLost;
        }
        let action = self.health.record(outcome);
        self.act(action, rx, ctx)
    }

    fn act(&mut self, action: Action, rx: &Receiver<Msg>, ctx: &mut Ctx) -> Flow {
        match action {
            Action::Continue => Flow::Go,
            Action::Recover => self.recover(rx, ctx),
            Action::Reconnect => self.reconnect(rx, ctx, None),
        }
    }

    /// Resets a frozen adapter; reconnects if it stays silent.
    fn recover(&mut self, rx: &Receiver<Msg>, ctx: &mut Ctx) -> Flow {
        self.generation += 1;
        self.emit(self.status("recovering"));
        match self.elm.recover() {
            Ok(()) => {
                self.health.reset();
                self.publish_adapter();
                self.emit(LinkStatus {
                    adapter: Some(self.elm.info.clone()),
                    ..self.status("recovered")
                });
                Flow::Go
            }
            Err(e) if is_fatal(&e) => self.reconnect(rx, ctx, Some(e.into())),
            Err(e) => {
                // The adapter is fine, the car is not answering (ignition off?).
                self.paused_until = Some(Instant::now() + VEHICLE_SILENT_PAUSE);
                self.emit(LinkStatus {
                    error: Some(e.into()),
                    ..self.status("vehicle_silent")
                });
                Flow::Go
            }
        }
    }

    /// Closes the port and opens it again, with growing pauses, until it
    /// works, the user disconnects or [`health::RECONNECT_GIVE_UP`] passes.
    fn reconnect(&mut self, rx: &Receiver<Msg>, ctx: &mut Ctx, cause: Option<CmdError>) -> Flow {
        let mut last =
            cause.unwrap_or_else(|| CmdError::from(ObdError::Connection("link lost".into())));
        self.generation += 1;
        self.elm.close();
        let Some(reopen) = self.reopen.as_mut() else {
            let _ = self.app.emit("connection-lost", last);
            return Flow::Stop;
        };
        let started = Instant::now();
        let mut attempt = 0;
        while started.elapsed() < health::RECONNECT_GIVE_UP {
            attempt += 1;
            let wait = health::reconnect_delay(attempt);
            let _ = self.app.emit(
                "link-status",
                LinkStatus {
                    state: "reconnecting",
                    attempt,
                    next_in_s: wait.as_secs(),
                    adapter: None,
                    error: Some(last.clone()),
                },
            );
            // Wait, still listening to the UI. Jobs are dropped: their
            // callers get "not connected" at once instead of waiting.
            let until = Instant::now() + wait;
            while let Some(left) = until.checked_duration_since(Instant::now()) {
                match rx.recv_timeout(left) {
                    Ok(Msg::Stop) | Err(RecvTimeoutError::Disconnected) => return Flow::Stop,
                    Ok(Msg::Run(job)) => drop(job),
                    Ok(Msg::SetLive(keys)) => {
                        ctx.live = keys;
                        ctx.failures.clear();
                    }
                    Ok(Msg::Polling(on)) => ctx.polling = on,
                    Err(RecvTimeoutError::Timeout) => break,
                }
            }
            match reopen() {
                Ok(elm) => {
                    self.elm = elm;
                    // Ignition may be off: the adapter link is what matters here.
                    let vehicle_error = self.elm.connect_vehicle().err().map(CmdError::from);
                    self.health.reset();
                    self.publish_adapter();
                    self.emit(LinkStatus {
                        attempt,
                        adapter: Some(self.elm.info.clone()),
                        error: vehicle_error,
                        ..self.status("reconnected")
                    });
                    return Flow::Go;
                }
                Err(e) => last = e,
            }
        }
        let _ = self.app.emit("connection-lost", last);
        Flow::Stop
    }
}

/// Polling settings changed by UI messages.
struct Ctx {
    live: Vec<String>,
    polling: bool,
    failures: HashMap<String, u32>,
    multi_ok: bool,
}

/// One request of a polling cycle: the PIDs asked (empty = adapter battery
/// voltage) and the live keys it answers.
struct Group {
    pids: Vec<u8>,
    keys: Vec<String>,
}

/// Splits the live keys into requests. Keys sharing a PID are read together;
/// unknown keys are skipped.
fn request_groups(live: &[String], multi: bool) -> Vec<Group> {
    let mut groups = Vec::new();
    let mut per_pid: Vec<(u8, Vec<String>)> = Vec::new();
    for key in live {
        if key == BATTERY_VOLTAGE_KEY {
            groups.push(Group {
                pids: vec![],
                keys: vec![key.clone()],
            });
        } else if let Some(def) = pid::find_by_key(key) {
            match per_pid.iter_mut().find(|(p, _)| *p == def.pid) {
                Some((_, keys)) => keys.push(key.clone()),
                None => per_pid.push((def.pid, vec![key.clone()])),
            }
        }
    }
    let size = if multi { 6 } else { 1 };
    for chunk in per_pid.chunks(size) {
        groups.push(Group {
            pids: chunk.iter().map(|(p, _)| *p).collect(),
            keys: chunk.iter().flat_map(|(_, k)| k.clone()).collect(),
        });
    }
    groups
}

fn count_failure(failures: &mut HashMap<String, u32>, dropped: &mut Vec<String>, key: &str) {
    let n = failures.entry(key.to_string()).or_insert(0);
    *n += 1;
    if *n >= MAX_FAILURES && !dropped.iter().any(|d| d == key) {
        dropped.push(key.to_string());
    }
}

/// Applies one message; returns false when the worker must stop.
fn apply(msg: Msg, link: &mut Link, rx: &Receiver<Msg>, ctx: &mut Ctx) -> bool {
    match msg {
        Msg::Run(job) => {
            job(&mut link.elm);
            // A command from a screen may be the first to notice a lost link.
            if link.elm.link_lost() {
                return matches!(link.act(Action::Reconnect, rx, ctx), Flow::Go);
            }
        }
        Msg::SetLive(keys) => {
            ctx.live = keys;
            ctx.failures.clear();
        }
        Msg::Polling(on) => ctx.polling = on,
        Msg::Stop => return false,
    }
    true
}

fn run_loop(link: &mut Link, rx: &Receiver<Msg>, recorder: &Arc<Mutex<Recorder>>) {
    let start = Instant::now();
    let mut ctx = Ctx {
        live: Vec::new(),
        polling: false,
        failures: HashMap::new(),
        multi_ok: true,
    };
    let mut interpreter = Interpreter::new();
    let mut last_findings = Instant::now() - Duration::from_secs(10);
    let mut last_cycle = Instant::now();
    let mut last_traffic = Instant::now();

    loop {
        let paused = link.paused_until.is_some_and(|t| Instant::now() < t);
        let active = ctx.polling && !ctx.live.is_empty() && !paused;
        // Wait for work when idle, only peek while polling.
        let first = if active {
            match rx.try_recv() {
                Ok(m) => Some(m),
                Err(TryRecvError::Empty) => None,
                Err(TryRecvError::Disconnected) => return,
            }
        } else {
            match rx.recv_timeout(Duration::from_millis(250)) {
                Ok(m) => Some(m),
                Err(RecvTimeoutError::Timeout) => None,
                Err(RecvTimeoutError::Disconnected) => return,
            }
        };
        if let Some(m) = first {
            last_traffic = Instant::now();
            if !apply(m, link, rx, &mut ctx) {
                return;
            }
            continue;
        }
        if !active {
            if last_traffic.elapsed() >= PING_EVERY {
                last_traffic = Instant::now();
                let r = link.elm.ping();
                if let Flow::Stop = link.observe(&r, rx, &mut ctx) {
                    return;
                }
            }
            continue;
        }
        last_traffic = Instant::now();

        // One polling cycle. Requests are groups of keys: one PID, the
        // battery voltage, or (fast mode on CAN) up to 6 PIDs at once.
        let mut values = HashMap::new();
        let mut dropped = Vec::new();
        let multi = ctx.multi_ok && link.elm.config.multi_pid && link.elm.info.is_can();
        for group in request_groups(&ctx.live, multi) {
            // Serve pending UI requests between reads.
            while let Ok(m) = rx.try_recv() {
                if !apply(m, link, rx, &mut ctx) {
                    return;
                }
            }
            if !ctx.polling {
                break;
            }
            let elm = &mut link.elm;
            let result: Result<Vec<(String, f64)>, ObdError> = match &group.pids[..] {
                [] => elm
                    .battery_voltage()
                    .map(|v| vec![(BATTERY_VOLTAGE_KEY.to_string(), v)]),
                [one] => elm.read_pid_values(*one),
                many => match elm.read_pids_multi(many) {
                    // Car or adapter does not cope with grouped requests
                    // (refusal, silence or garbage): one PID per request for
                    // the rest of this session. Silence still counts for the
                    // health check below.
                    Err(e) if Outcome::of_error(&e) != Outcome::LinkLost => {
                        ctx.multi_ok = false;
                        if Outcome::of_error(&e) == Outcome::Answered {
                            continue;
                        }
                        Err(e)
                    }
                    r => r,
                },
            };
            let generation = link.generation;
            if let Flow::Stop = link.observe(&result, rx, &mut ctx) {
                return;
            }
            // After a recovery or a reconnection, start a fresh cycle.
            if link.generation != generation {
                break;
            }
            match result {
                Ok(got) => {
                    for key in &group.keys {
                        if let Some((_, v)) = got.iter().find(|(k, _)| k == key) {
                            ctx.failures.remove(key);
                            values.insert(key.clone(), *v);
                        } else {
                            count_failure(&mut ctx.failures, &mut dropped, key);
                        }
                    }
                }
                // Silence and link problems are the health check's business:
                // do not blame the parameters for them.
                Err(e) if Outcome::of_error(&e) != Outcome::Answered => {}
                Err(_) => {
                    for key in &group.keys {
                        count_failure(&mut ctx.failures, &mut dropped, key);
                    }
                }
            }
        }
        if !dropped.is_empty() {
            ctx.live.retain(|k| !dropped.contains(k));
        }
        if values.is_empty() && dropped.is_empty() {
            continue;
        }
        let t_ms = start.elapsed().as_millis() as u64;
        let t_s = t_ms as f64 / 1000.0;
        for (k, v) in &values {
            interpreter.push(k, t_s, *v);
        }
        let rate_hz = 1.0 / last_cycle.elapsed().as_secs_f64().max(0.001);
        last_cycle = Instant::now();
        if let Ok(mut r) = recorder.lock() {
            r.push(Frame {
                t_ms,
                values: values.clone().into_iter().collect(),
            });
        }
        let _ = link.app.emit(
            "live-frame",
            LiveFrame {
                t_ms,
                values,
                dropped,
                rate_hz: (rate_hz * 10.0).round() / 10.0,
            },
        );
        if last_findings.elapsed() >= Duration::from_secs(1) {
            last_findings = Instant::now();
            let _ = link.app.emit("findings", interpreter.evaluate());
        }
    }
}
