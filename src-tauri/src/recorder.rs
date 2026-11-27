//! Session recording shared between the worker (writer) and commands (reader).
//!
//! The recording lives in memory (fast to export and replay) and, as a safety
//! copy, is also written as it goes to [`BACKUP_FILE`] in the program's data
//! folder: one JSON line with the session details, then one line per frame,
//! and an `{"end":true}` line when it stops. Lines are buffered and written to
//! disk at least every [`FLUSH_EVERY`]. If the program or the computer stops
//! in the middle, the next start finds a file without the end line and
//! offers that recording again ([`Recorder::recover`]).

use std::fs::File;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use obd_core::session::{Frame, Session};

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

    pub fn stop(&mut self) -> Option<&Session> {
        if let Some((_, s)) = self.active.take() {
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
            values: [("rpm".to_string(), v)].into(),
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
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn finished_recording_is_not_offered_again() {
        let dir = folder("done");
        let mut r = Recorder::with_backup(dir.clone());
        r.start(Session::default());
        r.push(frame(800.0));
        r.stop();
        assert_eq!(Recorder::with_backup(dir.clone()).recover(), None);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
