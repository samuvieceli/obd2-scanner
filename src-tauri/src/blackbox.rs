//! The black box ("caixa-preta") on the program side: the shared state the
//! worker feeds, the files of the automatic recordings and their commands.
//!
//! The logic (which minutes to keep, which codes are new) lives in
//! `obd_core::blackbox`; here the clips become JSON files in the
//! [`DIR`] folder of the program's data folder, the same format as a
//! recording saved by hand, so the replay, the charts and the report open
//! them as they are.
//!
//! Only the newest [`KEEP_FILES`] files (and at most [`KEEP_BYTES`]) are
//! kept; the oldest go first. Files the user pinned are kept apart from
//! that count and never deleted by it.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use obd_core::blackbox::{BlackBox, Clip};
use obd_core::session::{Event, Session};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{AppState, CmdError, CmdResult};

/// Folder of the automatic recordings, inside the program's data folder.
pub const DIR: &str = "gravacoes-automaticas";
/// List of pinned files (never deleted by the limit), inside [`DIR`].
const PINNED_FILE: &str = "fixadas.json";
pub const KEEP_FILES: usize = 30;
pub const KEEP_BYTES: u64 = 200 * 1024 * 1024;

/// Shared between the worker (feeds frames and faults) and the commands.
pub struct BlackBoxState {
    pub data: BlackBox,
    /// Clock of the frames: the worker's start (reset at each connection).
    pub clock: Instant,
    /// On unless the user turned it off in Settings.
    pub enabled: bool,
    /// Language of the code descriptions saved with a clip.
    pub lang: String,
    /// Where the files go; `None` = nowhere to save (folder missing).
    pub dir: Option<PathBuf>,
}

impl Default for BlackBoxState {
    fn default() -> Self {
        Self {
            data: BlackBox::new(),
            clock: Instant::now(),
            enabled: true,
            lang: "pt-BR".into(),
            dir: None,
        }
    }
}

impl BlackBoxState {
    /// Milliseconds on the clock of the frames.
    pub fn now_ms(&self) -> u64 {
        self.clock.elapsed().as_millis() as u64
    }

    /// Forgets everything kept (new connection), with a new clock.
    pub fn restart(&mut self, clock: Instant) {
        self.data = BlackBox::new();
        self.clock = clock;
    }
}

/// News for the UI (`blackbox` event).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BlackBoxNews {
    /// `fault` (collecting the minutes after it), `saved` or `save_failed`.
    pub state: &'static str,
    pub events: Vec<Event>,
    /// True when the faults were also marked in the user's own recording.
    pub in_recording: bool,
    /// File name, once saved.
    pub name: Option<String>,
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Turns a finished clip into a file, off the calling thread, and tells the UI.
pub fn save_clip(app: &AppHandle, clip: Clip, now_ms: u64, dir: Option<PathBuf>) {
    let app = app.clone();
    let mut template = crate::session_template(&app.state::<AppState>());
    template.started_at_unix_ms = unix_ms().saturating_sub(now_ms.saturating_sub(clip.start_ms));
    let events = clip.events.clone();
    let session = clip.into_session(template);
    std::thread::spawn(move || {
        let saved = dir
            .ok_or_else(|| std::io::Error::other("no data folder"))
            .and_then(|d| save(&d, &session).inspect(|_| prune(&d)));
        let news = match saved {
            Ok(path) => BlackBoxNews {
                state: "saved",
                events,
                in_recording: false,
                name: path.file_name().map(|n| n.to_string_lossy().into_owned()),
            },
            Err(_) => BlackBoxNews {
                state: "save_failed",
                events,
                in_recording: false,
                name: None,
            },
        };
        let _ = app.emit("blackbox", news);
    });
}

/// File name: start time and the first reason (`falha-1764355200000-P0301.json`).
fn file_name(s: &Session) -> String {
    let reason = s
        .events
        .first()
        .map(|e| {
            if e.code.is_empty() {
                e.kind.as_str()
            } else {
                e.code.as_str()
            }
        })
        .unwrap_or("auto");
    let reason: String = reason
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();
    format!("falha-{}-{reason}.json", s.started_at_unix_ms)
}

pub fn save(dir: &Path, s: &Session) -> std::io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(file_name(s));
    // Written beside it first, so a crash never leaves half a file.
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, s.to_json())?;
    std::fs::rename(&tmp, &path)?;
    Ok(path)
}

fn pinned(dir: &Path) -> BTreeSet<String> {
    std::fs::read_to_string(dir.join(PINNED_FILE))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn save_pinned(dir: &Path, names: &BTreeSet<String>) -> std::io::Result<()> {
    std::fs::write(
        dir.join(PINNED_FILE),
        serde_json::to_string(names).unwrap_or_else(|_| "[]".into()),
    )
}

/// The recording files, newest first, with their size.
fn files(dir: &Path) -> Vec<(String, u64)> {
    let mut out: Vec<(String, u64)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            (name.starts_with("falha-") && name.ends_with(".json"))
                .then(|| (name, e.metadata().map(|m| m.len()).unwrap_or(0)))
        })
        .collect();
    // The name holds the start time: a longer number is a later time.
    out.sort_by(|a, b| {
        let t = |n: &str| {
            n.trim_start_matches("falha-")
                .split('-')
                .next()
                .and_then(|t| t.parse::<u64>().ok())
                .unwrap_or(0)
        };
        t(&b.0).cmp(&t(&a.0)).then(b.0.cmp(&a.0))
    });
    out
}

/// Deletes the oldest files past the limits. Pinned files are never
/// deleted and do not count.
pub fn prune(dir: &Path) {
    let keep = pinned(dir);
    let (mut count, mut bytes) = (0usize, 0u64);
    for (name, size) in files(dir) {
        if keep.contains(&name) {
            continue;
        }
        count += 1;
        bytes += size;
        if count > KEEP_FILES || bytes > KEEP_BYTES {
            let _ = std::fs::remove_file(dir.join(&name));
        }
    }
}

/// One automatic recording, for the list on the Recordings screen.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoRecording {
    pub name: String,
    pub path: String,
    pub started_at_unix_ms: u64,
    pub duration_s: f64,
    pub events: Vec<Event>,
    pub vin: Option<String>,
    pub pinned: bool,
    pub bytes: u64,
}

pub fn list(dir: &Path) -> Vec<AutoRecording> {
    let keep = pinned(dir);
    files(dir)
        .into_iter()
        .filter_map(|(name, bytes)| {
            let path = dir.join(&name);
            let s = Session::from_json(&std::fs::read_to_string(&path).ok()?).ok()?;
            Some(AutoRecording {
                pinned: keep.contains(&name),
                path: path.to_string_lossy().into_owned(),
                started_at_unix_ms: s.started_at_unix_ms,
                duration_s: s.duration_s(),
                vin: s.vehicle.vin.clone(),
                events: s.events,
                name,
                bytes,
            })
        })
        .collect()
}

/// A file of the folder, refusing anything that is not one of its recordings.
fn file_in(dir: &Path, name: &str) -> CmdResult<PathBuf> {
    if !files(dir).iter().any(|(n, _)| n == name) {
        return Err(CmdError::other("not_found", name));
    }
    Ok(dir.join(name))
}

fn dir_of(state: &State<'_, AppState>) -> CmdResult<PathBuf> {
    state
        .blackbox
        .lock()
        .unwrap()
        .dir
        .clone()
        .ok_or_else(|| CmdError::other("io", "no data folder"))
}

/// Turns the black box on or off and sets the language of the saved codes.
/// Turning it off saves what was being collected and forgets the rest.
#[tauri::command]
pub fn set_blackbox(app: AppHandle, state: State<'_, AppState>, enabled: bool, lang: String) {
    let mut b = state.blackbox.lock().unwrap();
    b.lang = lang;
    if b.enabled && !enabled {
        let now = b.now_ms();
        let dir = b.dir.clone();
        let clip = b.data.finish();
        let clock = b.clock;
        b.restart(clock);
        if let Some(clip) = clip {
            save_clip(&app, clip, now, dir);
        }
    }
    b.enabled = enabled;
}

/// "Save the last 2 minutes": `saved`, or `added` when a fault is being
/// recorded (the moment joins that recording).
#[tauri::command]
pub fn blackbox_save_now(app: AppHandle, state: State<'_, AppState>) -> CmdResult<&'static str> {
    let mut b = state.blackbox.lock().unwrap();
    if !b.enabled {
        return Err(CmdError::other("blackbox_off", "black box turned off"));
    }
    let now = b.now_ms();
    if b.data.is_capturing() {
        b.data.trigger(now, "manual", "");
        return Ok("added");
    }
    let clip = b
        .data
        .save_now(now)
        .ok_or_else(|| CmdError::other("blackbox_empty", "nothing read yet"))?;
    save_clip(&app, clip, now, b.dir.clone());
    Ok("saved")
}

/// A value left the limits set by the user (alerts used as a trigger).
/// Also marked in the user's recording. False when nothing was kept.
#[tauri::command]
pub fn blackbox_alert(state: State<'_, AppState>, key: String) -> bool {
    let started = {
        let mut b = state.blackbox.lock().unwrap();
        if !b.enabled || state.worker.lock().unwrap().is_none() {
            return false;
        }
        let now = b.now_ms();
        b.data.trigger(now, "alert", &key);
        true
    };
    state.recorder.lock().unwrap().event("alert", &key);
    started
}

#[tauri::command]
pub async fn list_auto_recordings(state: State<'_, AppState>) -> CmdResult<Vec<AutoRecording>> {
    let dir = dir_of(&state)?;
    crate::blocking(move || Ok(list(&dir))).await
}

#[tauri::command]
pub fn pin_auto_recording(state: State<'_, AppState>, name: String, pinned: bool) -> CmdResult<()> {
    let dir = dir_of(&state)?;
    file_in(&dir, &name)?;
    let mut names = self::pinned(&dir);
    if pinned {
        names.insert(name);
    } else {
        names.remove(&name);
    }
    save_pinned(&dir, &names).map_err(|e| CmdError::other("io", e))
}

#[tauri::command]
pub fn delete_auto_recording(state: State<'_, AppState>, name: String) -> CmdResult<()> {
    let dir = dir_of(&state)?;
    std::fs::remove_file(file_in(&dir, &name)?).map_err(|e| CmdError::other("io", e))?;
    let mut names = pinned(&dir);
    if names.remove(&name) {
        let _ = save_pinned(&dir, &names);
    }
    Ok(())
}

/// The folder, created if needed, to show it in the file manager.
#[tauri::command]
pub fn auto_recordings_dir(state: State<'_, AppState>) -> CmdResult<String> {
    let dir = dir_of(&state)?;
    std::fs::create_dir_all(&dir).map_err(|e| CmdError::other("io", e))?;
    Ok(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("obd2-bb-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn session(t: u64, code: &str) -> Session {
        Session {
            started_at_unix_ms: t,
            events: vec![Event {
                t_ms: 1000,
                kind: "dtc_stored".into(),
                code: code.into(),
            }],
            automatic: true,
            ..Session::default()
        }
    }

    #[test]
    fn saves_lists_and_keeps_the_newest_and_the_pinned() {
        let dir = folder("keep");
        for i in 0..KEEP_FILES as u64 + 5 {
            save(&dir, &session(1_000 + i, "P0301")).unwrap();
        }
        // The oldest one is pinned: it survives the limit.
        let oldest = file_name(&session(1_000, "P0301"));
        save_pinned(&dir, &BTreeSet::from([oldest.clone()])).unwrap();
        prune(&dir);
        let l = list(&dir);
        assert_eq!(l.len(), KEEP_FILES + 1);
        assert_eq!(l[0].started_at_unix_ms, 1_000 + KEEP_FILES as u64 + 4);
        assert_eq!(l[0].events[0].code, "P0301");
        assert!(l.iter().any(|r| r.name == oldest && r.pinned));
        assert!(!l.iter().any(|r| r.started_at_unix_ms == 1_001));
        // Only files of the folder can be touched.
        assert!(file_in(&dir, "../outro.json").is_err());
        assert!(file_in(&dir, &oldest).is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn file_name_is_safe() {
        let mut s = session(5, "../P0301");
        assert_eq!(file_name(&s), "falha-5-P0301.json");
        s.events[0].code.clear();
        s.events[0].kind = "mil".into();
        assert_eq!(file_name(&s), "falha-5-mil.json");
    }
}
