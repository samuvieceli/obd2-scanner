//! Session recording shared between the worker (writer) and commands (reader).
//!
//! The recording lives in memory (fast to export and replay) and, as a safety
//! copy, is also written as it goes to [`BACKUP_FILE`] in the program's data
//! folder: one JSON line with the session details, then one line per frame
//! (a `{"mark":t_ms}` line per event the driver marks, an `{"event":{...}}`
//! line per fault the black box noticed, and a
//! `{"diagnostics":{...}}` line per diagnostic read saved with it), and an
//! `{"end":true}` line when it stops. Lines are buffered and written to
//! disk at least every [`FLUSH_EVERY`]. If the program or the computer stops
//! in the middle, the next start finds a file without the end line and
//! offers that recording again ([`Recorder::recover`]).

use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use obd_core::session::{Event, Frame, Session, Snapshot};

/// Adds the unit and range of the manufacturer parameters the recording
/// holds: they are not in the standard catalog copied at the start.
fn describe_maker_keys(s: &mut Session) {
    let mut keys: Vec<&str> = s
        .frames
        .iter()
        .flat_map(|f| f.values.keys())
        .filter(|k| k.starts_with(obd_core::maker::KEY_PREFIX))
        .collect();
    keys.sort_unstable();
    keys.dedup();
    let metas: Vec<_> = keys
        .into_iter()
        .filter(|k| !s.pids.iter().any(|p| p.key == *k))
        .filter_map(obd_core::maker::meta)
        .collect();
    s.pids.extend(metas);
}

/// Safety copy of the recording in progress, inside the data folder.
pub const BACKUP_FILE: &str = "gravacao-em-andamento.jsonl";
/// Longest time frames stay only in memory.
pub const FLUSH_EVERY: Duration = Duration::from_secs(60);
const END_LINE: &str = r#"{"end":true}"#;

struct Backup {
    file: BufWriter<File>,
    flushed: Instant,
}

#[derive(Default)]
pub struct Recorder {
    active: Option<(Instant, Session)>,
    /// Last finished (or recovered) recording, kept for export.
    pub last: Option<Session>,
    /// Folder of the safety copy; `None` = no copy (tests, folder missing).
    backup_dir: Option<PathBuf>,
    backup: Option<Backup>,
}

impl Recorder {
    /// Recorder with a safety copy in `dir` (created if needed).
    pub fn with_backup(dir: PathBuf) -> Self {
        Self {
            backup_dir: std::fs::create_dir_all(&dir).ok().map(|_| dir),
            ..Self::default()
        }
    }

    pub fn start(&mut self, template: Session) {
        let mut s = template;
        s.started_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.backup = self
            .backup_dir
            .as_deref()
            .and_then(|dir| open_backup(dir, &s));
        self.active = Some((Instant::now(), s));
    }

    pub fn is_recording(&self) -> bool {
        self.active.is_some()
    }

    /// Frames carry the worker clock; we re-base them on the recording start.
    pub fn push(&mut self, mut frame: Frame) {
        let Some((start, s)) = self.active.as_mut() else {
            return;
        };
        frame.t_ms = start.elapsed().as_millis() as u64;
        if let Some(b) = self.backup.as_mut() {
            let ok = serde_json::to_writer(&mut b.file, &frame).is_ok()
                && b.file.write_all(b"\n").is_ok()
                && (b.flushed.elapsed() < FLUSH_EVERY || flush(b).is_ok());
            if !ok {
                // Disk full or folder gone: keep recording in memory only.
                self.backup = None;
            }
        }
        s.frames.push(frame);
    }

    /// Marks this moment of the recording; returns the number of marks.
    pub fn mark(&mut self) -> Option<usize> {
        let (start, s) = self.active.as_mut()?;
        let t_ms = start.elapsed().as_millis() as u64;
        s.marks.push(t_ms);
        if let Some(b) = self.backup.as_mut() {
            // Marks are rare and precious: written to disk at once.
            if writeln!(b.file, r#"{{"mark":{t_ms}}}"#)
                .and_then(|_| flush(b))
                .is_err()
            {
                self.backup = None;
            }
        }
        Some(s.marks.len())
    }

    /// Marks a fault the program noticed by itself (a new trouble code, the
    /// check-engine light...) in the recording in progress. False when there
    /// is none.
    pub fn event(&mut self, kind: &str, code: &str) -> bool {
        let Some((start, s)) = self.active.as_mut() else {
            return false;
        };
        let event = Event {
            t_ms: start.elapsed().as_millis() as u64,
            kind: kind.to_string(),
            code: code.to_string(),
        };
        if let Some(b) = self.backup.as_mut()
            && (serde_json::to_writer(&mut b.file, &EventLine { event: &event }).is_err()
                || b.file.write_all(b"\n").and_then(|_| flush(b)).is_err())
        {
            self.backup = None;
        }
        s.marks.push(event.t_ms);
        s.events.push(event);
        true
    }

    /// Faults noticed in the recording in progress, or else in the last one.
    pub fn events(&self) -> &[Event] {
        self.active
            .as_ref()
            .map(|(_, s)| s)
            .or(self.last.as_ref())
            .map(|s| s.events.as_slice())
            .unwrap_or_default()
    }

    /// Saves diagnostic reads with the recording that started at
    /// `started_at_unix_ms`: the one in progress or, when the reads finished
    /// after it stopped, the last one. Returns false if that recording is
    /// gone (a newer one replaced it).
    pub fn attach(&mut self, started_at_unix_ms: u64, mut snap: Snapshot) -> bool {
        if let Some((start, s)) = self.active.as_mut()
            && s.started_at_unix_ms == started_at_unix_ms
        {
            snap.t_ms = start.elapsed().as_millis() as u64;
            if let Some(b) = self.backup.as_mut()
                && (serde_json::to_writer(&mut b.file, &DiagnosticsLine { diagnostics: &snap })
                    .is_err()
                    || b.file.write_all(b"\n").and_then(|_| flush(b)).is_err())
            {
                self.backup = None;
            }
            s.diagnostics.push(snap);
            return true;
        }
        match self.last.as_mut() {
            Some(s) if s.started_at_unix_ms == started_at_unix_ms => {
                snap.t_ms = s.frames.last().map(|f| f.t_ms).unwrap_or(0);
                s.diagnostics.push(snap);
                true
            }
            _ => false,
        }
    }

    /// Start time of the recording in progress, or else of the last one.
    pub fn started_at(&self) -> Option<u64> {
        self.active
            .as_ref()
            .map(|(_, s)| s)
            .or(self.last.as_ref())
            .map(|s| s.started_at_unix_ms)
    }

    pub fn mark_count(&self) -> usize {
        self.active
            .as_ref()
            .map(|(_, s)| s.marks.len())
            .unwrap_or(0)
    }

    pub fn stop(&mut self) -> Option<&Session> {
        if let Some((_, mut s)) = self.active.take() {
            describe_maker_keys(&mut s);
            if let Some(mut b) = self.backup.take() {
                let _ = writeln!(b.file, "{END_LINE}").and_then(|_| flush(&mut b));
            }
            self.last = Some(s);
        }
        self.last.as_ref()
    }

    pub fn frame_count(&self) -> usize {
        self.active
            .as_ref()
            .map(|(_, s)| s.frames.len())
            .unwrap_or(0)
    }

    /// Loads a recording that was interrupted (no end line) into `last`.
    /// Returns its number of frames, or `None` when there is nothing to recover.
    pub fn recover(&mut self) -> Option<usize> {
        let path = self.backup_dir.as_ref()?.join(BACKUP_FILE);
        let session = read_interrupted(&path)?;
        // Close the copy so the same recording is not offered again at the
        // next start.
        if let Ok(mut f) = std::fs::OpenOptions::new().append(true).open(&path) {
            let _ = writeln!(f, "\n{END_LINE}").and_then(|_| f.sync_data());
        }
        let frames = session.frames.len();
        self.last = Some(session);
        Some(frames)
    }
}

fn open_backup(dir: &Path, session: &Session) -> Option<Backup> {
    let mut file = BufWriter::new(File::create(dir.join(BACKUP_FILE)).ok()?);
    serde_json::to_writer(&mut file, session).ok()?;
    file.write_all(b"\n").ok()?;
    let mut b = Backup {
        file,
        flushed: Instant::now(),
    };
    flush(&mut b).ok()?;
    Some(b)
}

fn flush(b: &mut Backup) -> std::io::Result<()> {
    b.flushed = Instant::now();
    b.file.flush()?;
    b.file.get_ref().sync_data()
}

#[derive(serde::Deserialize)]
struct MarkLine {
    mark: u64,
}

#[derive(serde::Serialize)]
struct DiagnosticsLine<'a> {
    diagnostics: &'a Snapshot,
}

#[derive(serde::Serialize)]
struct EventLine<'a> {
    event: &'a Event,
}

#[derive(serde::Deserialize)]
struct EventLineIn {
    event: Event,
}

#[derive(serde::Deserialize)]
struct DiagnosticsLineIn {
    diagnostics: Snapshot,
}

/// The session in a safety copy without its end line and with at least one
/// frame. A last line cut in half by the crash is skipped.
fn read_interrupted(path: &Path) -> Option<Session> {
    let mut lines = BufReader::new(File::open(path).ok()?).lines();
    let mut session: Session = serde_json::from_str(&lines.next()?.ok()?).ok()?;
    session.frames.clear();
    for line in lines {
        let line = line.ok()?;
        if line.trim() == END_LINE {
            return None;
        }
        if let Ok(frame) = serde_json::from_str::<Frame>(&line) {
            session.frames.push(frame);
        } else if let Ok(m) = serde_json::from_str::<MarkLine>(&line) {
            session.marks.push(m.mark);
        } else if let Ok(d) = serde_json::from_str::<DiagnosticsLineIn>(&line) {
            session.diagnostics.push(d.diagnostics);
        } else if let Ok(e) = serde_json::from_str::<EventLineIn>(&line) {
            session.marks.push(e.event.t_ms);
            session.events.push(e.event);
        }
    }
    (!session.frames.is_empty()).then_some(session)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("obd2-rec-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn frame(v: f64) -> Frame {
        Frame {
            t_ms: 0,
            values: [("rpm", v)].into(),
        }
    }

    #[test]
    fn interrupted_recording_is_recovered() {
        let dir = folder("crash");
        let mut r = Recorder::with_backup(dir.clone());
        r.start(Session {
            adapter: "Demo".into(),
            ..Default::default()
        });
        r.push(frame(800.0));
        assert_eq!(r.mark(), Some(1));
        assert!(r.event("dtc_stored", "P0301"));
        let started = r.started_at().unwrap();
        assert!(r.attach(
            started,
            Snapshot {
                dtcs: Some(serde_json::json!({"stored": []})),
                ..Default::default()
            }
        ));
        r.push(frame(900.0));
        // Crash: the buffer reaches the disk only when dropped here, which
        // stands for the periodic flush.
        drop(r);
        // A half-written last line is skipped.
        let mut f = std::fs::OpenOptions::new()
            .append(true)
            .open(dir.join(BACKUP_FILE))
            .unwrap();
        f.write_all(b"{\"t_ms\":12,\"val").unwrap();

        let mut next = Recorder::with_backup(dir.clone());
        assert_eq!(next.recover(), Some(2));
        let s = next.last.as_ref().unwrap();
        assert_eq!(s.adapter, "Demo");
        assert_eq!(s.frames[1].values["rpm"], 900.0);
        assert_eq!(s.marks.len(), 2);
        assert_eq!(s.events[0].code, "P0301");
        assert_eq!(s.diagnostics.len(), 1);
        assert!(s.diagnostics[0].dtcs.is_some());
        // Offered only once.
        assert_eq!(Recorder::with_backup(dir.clone()).recover(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn finished_recording_is_not_offered_again() {
        let dir = folder("done");
        let mut r = Recorder::with_backup(dir.clone());
        r.start(Session::default());
        r.push(frame(800.0));
        assert!(r.event("mil", ""));
        r.stop();
        assert_eq!(r.events().len(), 1);
        assert!(!r.event("mil", ""));
        assert_eq!(Recorder::with_backup(dir.clone()).recover(), None);
        // Reads that finish after the stop still join that recording...
        let started = r.started_at().unwrap();
        assert!(r.attach(started, Snapshot::default()));
        assert_eq!(r.last.as_ref().unwrap().diagnostics.len(), 1);
        // ...but never another one.
        assert!(!r.attach(started + 1, Snapshot::default()));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
