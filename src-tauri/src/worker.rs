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

        // One polling cycle.
        let mut values = HashMap::new();
        let mut dropped = Vec::new();
        for key in live.clone() {
            // Serve pending UI requests between reads.
            while let Ok(m) = rx.try_recv() {
                if !apply(m, elm, &mut live, &mut polling, &mut failures) {
                    return;
                }
            }
            if !polling {
                break;
            }
            let result = if key == BATTERY_VOLTAGE_KEY {
                elm.battery_voltage()
            } else if let Some(def) = pid::find_by_key(&key) {
                elm.read_pid(def.pid).map(|v| v.value)
            } else {
                continue;
            };
            match result {
                Ok(v) => {
                    failures.remove(&key);
                    values.insert(key.clone(), v);
                }
                Err(e) if is_fatal(&e) => {
                    let _ = app.emit("connection-lost", crate::CmdError::from(e));
                    return;
                }
                Err(_) => {
                    let n = failures.entry(key.clone()).or_insert(0);
                    *n += 1;
                    if *n >= MAX_FAILURES {
                        dropped.push(key.clone());
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
