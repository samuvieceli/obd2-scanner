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
use obd_core::blackbox::FaultWatch;
use obd_core::elm327::{AdapterInfo, Elm327};
use obd_core::health::{self, Action, LinkHealth, Outcome};
use obd_core::interpret::Interpreter;
use obd_core::maker;
use obd_core::pid::{self, BATTERY_VOLTAGE_KEY};
use obd_core::session::{Frame, Snapshot};
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
                run_loop(&mut link, &rx, &recorder);
                // Connection closed: the minutes after a fault collected so
                // far are better than nothing.
                finish_blackbox(&link.app);
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
        ObdError::Io(_) | ObdError::Connection(_) | ObdError::Port(..) | ObdError::NotConnected
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
                // The adapter answered, so its failure count starts over.
                self.health.reset();
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

/// Grouped requests without an answer, in a row, before falling back to one
/// PID per request.
const MULTI_SILENT_LIMIT: u32 = 3;

/// Polling settings changed by UI messages.
struct Ctx {
    live: Vec<String>,
    polling: bool,
    failures: HashMap<String, u32>,
    multi_ok: bool,
    /// Grouped requests that got no answer in a row; one silence can be a
    /// glitch, so grouping is turned off only after a few.
    multi_silent: u32,
}

/// One request of a polling cycle: the PIDs asked (empty = adapter battery
/// voltage), or a manufacturer request, and the live keys it answers.
struct Group {
    pids: Vec<u8>,
    maker: Option<maker::RequestId>,
    keys: Vec<String>,
}

/// Splits the live keys into requests. Keys sharing a PID (or a
/// manufacturer request) are read together; unknown keys are skipped.
/// Manufacturer requests come last, so the adapter switches its addressing
/// to single control units once per cycle.
fn request_groups(live: &[String], multi: bool) -> Vec<Group> {
    let mut groups = Vec::new();
    let mut per_pid: Vec<(u8, Vec<String>)> = Vec::new();
    let mut per_request: Vec<Group> = Vec::new();
    for key in live {
        if key == BATTERY_VOLTAGE_KEY {
            groups.push(Group {
                pids: vec![],
                maker: None,
                keys: vec![key.clone()],
            });
        } else if let Some(id) = maker::request_of(key) {
            match per_request.iter_mut().find(|g| g.maker == Some(id)) {
                Some(g) => g.keys.push(key.clone()),
                None => per_request.push(Group {
                    pids: vec![],
                    maker: Some(id),
                    keys: vec![key.clone()],
                }),
            }
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
            maker: None,
            keys: chunk.iter().flat_map(|(_, k)| k.clone()).collect(),
        });
    }
    groups.extend(per_request);
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
    link.app
        .state::<crate::AppState>()
        .blackbox
        .lock()
        .unwrap()
        .restart(start);
    let mut checks = FaultChecks::new();
    let mut ctx = Ctx {
        live: Vec::new(),
        polling: false,
        failures: HashMap::new(),
        multi_ok: true,
        multi_silent: 0,
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
            tick_blackbox(&link.app);
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
            let result: Result<Vec<(String, f64)>, ObdError> = match (group.maker, &group.pids[..])
            {
                (Some(id), _) => maker::read(elm, id, &group.keys),
                (None, []) => elm
                    .battery_voltage()
                    .map(|v| vec![(BATTERY_VOLTAGE_KEY.to_string(), v)]),
                (None, [one]) => elm.read_pid_values(*one),
                (None, many) => match elm.read_pids_multi(many) {
                    // Car or adapter does not cope with grouped requests
                    // (refusal, silence or garbage): one PID per request for
                    // the rest of this session. Silence still counts for the
                    // health check below.
                    Err(e) if Outcome::of_error(&e) != Outcome::LinkLost => {
                        if Outcome::of_error(&e) == Outcome::Answered {
                            ctx.multi_ok = false;
                            continue;
                        }
                        ctx.multi_silent += 1;
                        if ctx.multi_silent >= MULTI_SILENT_LIMIT {
                            ctx.multi_ok = false;
                        }
                        Err(e)
                    }
                    r => {
                        if r.is_ok() {
                            ctx.multi_silent = 0;
                        }
                        r
                    }
                },
            };
            let generation = link.generation;
            // A manufacturer request to a unit this car does not have (wrong
            // model chosen) goes unanswered: that is the parameter's
            // failure, not a sign of a frozen adapter.
            let maker_silent = group.maker.is_some()
                && matches!(&result, Err(e) if Outcome::of_error(e) == Outcome::Suspicious);
            if !maker_silent && let Flow::Stop = link.observe(&result, rx, &mut ctx) {
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
                Err(e) if Outcome::of_error(&e) != Outcome::Answered && !maker_silent => {}
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
        let frame = Frame {
            t_ms,
            values: values.clone().into_iter().collect(),
        };
        if let Ok(mut r) = recorder.lock() {
            r.push(frame.clone());
        }
        let watching = feed_blackbox(&link.app, frame);
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
        if watching && let Flow::Stop = checks.run(link, rx, &mut ctx, recorder) {
            return;
        }
    }
}

/// Gives a frame to the black box (when it is on) and saves the clip it
/// completes. Returns whether the black box is on.
fn feed_blackbox(app: &AppHandle, frame: Frame) -> bool {
    let state = app.state::<crate::AppState>();
    let mut b = state.blackbox.lock().unwrap();
    if !b.enabled {
        return false;
    }
    let now = frame.t_ms;
    if let Some(clip) = b.data.push(frame) {
        crate::blackbox::save_clip(app, clip, now, b.dir.clone());
    }
    true
}

/// Ends a clip whose time is over while no frames come (reading paused).
fn tick_blackbox(app: &AppHandle) {
    let state = app.state::<crate::AppState>();
    let mut b = state.blackbox.lock().unwrap();
    let now = b.now_ms();
    if let Some(clip) = b.data.tick(now) {
        crate::blackbox::save_clip(app, clip, now, b.dir.clone());
    }
}

fn finish_blackbox(app: &AppHandle) {
    let state = app.state::<crate::AppState>();
    let mut b = state.blackbox.lock().unwrap();
    let now = b.now_ms();
    if let Some(clip) = b.data.finish() {
        crate::blackbox::save_clip(app, clip, now, b.dir.clone());
    }
}

/// Quick "check-engine light on? how many codes?" question (mode 01 PID 01).
const STATUS_EVERY: Duration = Duration::from_secs(5);
/// Pending codes (mode 07), which often show up before the light.
const PENDING_EVERY: Duration = Duration::from_secs(30);
/// Pending codes again after the car did not answer them.
const PENDING_SLOW: Duration = Duration::from_secs(60);
/// Refusals in a row before a question is not asked again (car without it).
const CHECK_GIVE_UP: u32 = 3;

/// Looks for new faults between polling cycles, for the black box. Reads
/// only (modes 01, 02, 03, 07, 0A): nothing is written to the car.
struct FaultChecks {
    watch: FaultWatch,
    next_status: Instant,
    next_pending: Instant,
    status_refused: u32,
    pending_refused: u32,
}

/// Result of one question: the answer, or `None` (refused, or the link is
/// being checked). `Err` = stop the worker.
type Asked<T> = Result<Option<T>, ()>;

impl FaultChecks {
    fn new() -> Self {
        Self {
            watch: FaultWatch::new(),
            next_status: Instant::now(),
            next_pending: Instant::now() + PENDING_EVERY,
            status_refused: 0,
            pending_refused: 0,
        }
    }

    /// Asks the car through the health check, so a lost link is still noticed.
    fn ask<T>(
        link: &mut Link,
        rx: &Receiver<Msg>,
        ctx: &mut Ctx,
        refused: &mut u32,
        f: impl FnOnce(&mut obd_core::elm327::Elm327) -> Result<T, ObdError>,
    ) -> Asked<T> {
        let generation = link.generation;
        let r = f(&mut link.elm);
        if let Flow::Stop = link.observe(&r, rx, ctx) {
            return Err(());
        }
        if link.generation != generation {
            return Ok(None);
        }
        match r {
            Ok(v) => {
                *refused = 0;
                Ok(Some(v))
            }
            Err(e) => {
                if Outcome::of_error(&e) == Outcome::Answered {
                    *refused += 1;
                }
                Ok(None)
            }
        }
    }

    fn run(
        &mut self,
        link: &mut Link,
        rx: &Receiver<Msg>,
        ctx: &mut Ctx,
        recorder: &Arc<Mutex<Recorder>>,
    ) -> Flow {
        let now = Instant::now();
        let mut read_lists = false;
        if self.status_refused < CHECK_GIVE_UP && now >= self.next_status {
            self.next_status = now + STATUS_EVERY;
            match Self::ask(link, rx, ctx, &mut self.status_refused, |e| {
                e.read_readiness()
            }) {
                Err(()) => return Flow::Stop,
                Ok(Some(r)) => read_lists |= self.watch.status(r.mil_on, r.dtc_count),
                Ok(None) => {}
            }
        }
        // Without the quick question, the lists themselves are the check.
        let no_status = self.status_refused >= CHECK_GIVE_UP;
        if self.watch.needs_baseline() && no_status {
            read_lists = true;
        }
        if !read_lists
            && !self.watch.needs_baseline()
            && self.pending_refused < CHECK_GIVE_UP
            && now >= self.next_pending
        {
            self.next_pending = now + PENDING_EVERY;
            match Self::ask(link, rx, ctx, &mut self.pending_refused, |e| {
                e.read_pending_dtcs()
            }) {
                Err(()) => return Flow::Stop,
                Ok(Some(list)) => {
                    let codes: Vec<String> = list.into_iter().map(|d| d.0).collect();
                    read_lists = self.watch.pending_changed(&codes) || no_status;
                }
                Ok(None) => self.next_pending = now + PENDING_SLOW,
            }
        }
        if !read_lists {
            return Flow::Go;
        }
        let mut refused = 0;
        let stored = match Self::ask(link, rx, ctx, &mut refused, |e| e.read_stored_dtcs()) {
            Err(()) => return Flow::Stop,
            Ok(Some(l)) => l,
            Ok(None) => return Flow::Go,
        };
        let pending = if self.pending_refused >= CHECK_GIVE_UP {
            Vec::new()
        } else {
            match Self::ask(link, rx, ctx, &mut self.pending_refused, |e| {
                e.read_pending_dtcs()
            }) {
                Err(()) => return Flow::Stop,
                Ok(Some(l)) => l,
                Ok(None) => return Flow::Go,
            }
        };
        let codes = |l: &[obd_core::dtc::Dtc]| l.iter().map(|d| d.0.clone()).collect::<Vec<_>>();
        let faults = self.watch.codes(&codes(&stored), &codes(&pending));
        if faults.is_empty() {
            return Flow::Go;
        }

        // A fault: keep the codes (with their descriptions) and the car's
        // own freeze frame with the minutes around it.
        let app = link.app.clone();
        let state = app.state::<crate::AppState>();
        let lang = state.blackbox.lock().unwrap().lang.clone();
        let brand = crate::brand_of(state.identity.lock().unwrap().vin.as_deref());
        let permanent = link.elm.read_permanent_dtcs().unwrap_or_default();
        let confirmed = faults.iter().any(|f| f.kind != "dtc_pending");
        let freeze = if confirmed {
            crate::freeze_frame(&mut link.elm, &lang, brand).ok()
        } else {
            None
        };
        let snap = Snapshot {
            dtcs: serde_json::to_value(crate::describe_codes(
                &stored, &pending, &permanent, &lang, brand,
            ))
            .ok(),
            freeze: freeze.and_then(|f| serde_json::to_value(f).ok()),
            ..Snapshot::default()
        };
        let events = {
            let mut b = state.blackbox.lock().unwrap();
            let now = b.now_ms();
            for f in &faults {
                b.data.trigger(now, f.kind, &f.code);
            }
            b.data.attach(now, snap.clone());
            faults
                .iter()
                .map(|f| obd_core::session::Event {
                    t_ms: now,
                    kind: f.kind.into(),
                    code: f.code.clone(),
                })
                .collect()
        };
        let in_recording = {
            let mut r = recorder.lock().unwrap();
            let marked = faults.iter().all(|f| r.event(f.kind, &f.code));
            if marked && let Some(started) = r.started_at() {
                r.attach(started, snap);
            }
            marked
        };
        let _ = app.emit(
            "blackbox",
            crate::blackbox::BlackBoxNews {
                state: "fault",
                events,
                in_recording,
                name: None,
            },
        );
        Flow::Go
    }
}
