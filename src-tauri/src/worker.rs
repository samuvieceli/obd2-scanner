//! The connection worker: one thread owns the adapter.
//!
//! Serial ports and sockets must not be used from two places at once, so a
//! single background thread owns the [`Elm327`] driver. UI commands are sent
//! to it as closures through a channel and run between live-data reads, so
//! the screen stays responsive while data is being polled.

use std::collections::HashMap;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use obd_core::elm327::Elm327;
use obd_core::interpret::Interpreter;
use obd_core::pid::{self, BATTERY_VOLTAGE_KEY};
use obd_core::session::Frame;
use obd_core::ObdError;
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::recorder::Recorder;

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

const MAX_FAILURES: u32 = 3;

impl Worker {
    pub fn spawn(mut elm: Elm327, app: AppHandle, recorder: Arc<Mutex<Recorder>>) -> Self {
        let (tx, rx) = mpsc::channel::<Msg>();
        let handle = std::thread::Builder::new()
            .name("obd-worker".into())
            .spawn(move || run_loop(&mut elm, &rx, &app, &recorder))
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
    matches!(e, ObdError::Io(_) | ObdError::Connection(_))
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
fn apply(
    msg: Msg,
    elm: &mut Elm327,
    live: &mut Vec<String>,
    polling: &mut bool,
    failures: &mut HashMap<String, u32>,
) -> bool {
    match msg {
        Msg::Run(job) => job(elm),
        Msg::SetLive(keys) => {
            *live = keys;
            failures.clear();
        }
        Msg::Polling(on) => *polling = on,
        Msg::Stop => return false,
    }
    true
}

fn run_loop(
    elm: &mut Elm327,
    rx: &Receiver<Msg>,
    app: &AppHandle,
    recorder: &Arc<Mutex<Recorder>>,
) {
    let start = Instant::now();
    let mut live: Vec<String> = Vec::new();
    let mut failures: HashMap<String, u32> = HashMap::new();
    let mut polling = false;
    let mut multi_ok = true;
    let mut interpreter = Interpreter::new();
    let mut last_findings = Instant::now() - Duration::from_secs(10);
    let mut last_cycle = Instant::now();

    loop {
        // Wait for work when idle, only peek while polling.
        let first = if polling && !live.is_empty() {
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
            if !apply(m, elm, &mut live, &mut polling, &mut failures) {
                return;
            }
            continue;
        }
        if !polling || live.is_empty() {
            continue;
        }

        // One polling cycle. Requests are groups of keys: one PID, the
        // battery voltage, or (fast mode on CAN) up to 6 PIDs at once.
        let mut values = HashMap::new();
        let mut dropped = Vec::new();
        let multi = multi_ok && elm.config.multi_pid && elm.info.is_can();
        for group in request_groups(&live, multi) {
            // Serve pending UI requests between reads.
            while let Ok(m) = rx.try_recv() {
                if !apply(m, elm, &mut live, &mut polling, &mut failures) {
                    return;
                }
            }
            if !polling {
                break;
            }
            let result: Result<Vec<(String, f64)>, ObdError> = match &group.pids[..] {
                [] => elm
                    .battery_voltage()
                    .map(|v| vec![(BATTERY_VOLTAGE_KEY.to_string(), v)]),
                [one] => elm.read_pid_values(*one),
                many => match elm.read_pids_multi(many) {
                    Err(e) if !is_fatal(&e) => {
                        // Car or adapter does not cope with grouped requests:
                        // switch to one PID per request for this connection.
                        multi_ok = false;
                        continue;
                    }
                    r => r,
                },
            };
            match result {
                Ok(got) => {
                    for key in &group.keys {
                        if let Some((_, v)) = got.iter().find(|(k, _)| k == key) {
                            failures.remove(key);
                            values.insert(key.clone(), *v);
                        } else {
                            count_failure(&mut failures, &mut dropped, key);
                        }
                    }
                }
                Err(e) if is_fatal(&e) => {
                    let _ = app.emit("connection-lost", crate::CmdError::from(e));
                    return;
                }
                Err(_) => {
                    for key in &group.keys {
                        count_failure(&mut failures, &mut dropped, key);
                    }
                }
            }
        }
        if !dropped.is_empty() {
            live.retain(|k| !dropped.contains(k));
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
        let _ = app.emit(
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
            let _ = app.emit("findings", interpreter.evaluate());
        }
    }
}
