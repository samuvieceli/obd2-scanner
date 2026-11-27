//! Session recording shared between the worker (writer) and commands (reader).

use std::time::{Instant, SystemTime, UNIX_EPOCH};

use obd_core::session::{Frame, Session};

#[derive(Default)]
pub struct Recorder {
    active: Option<(Instant, Session)>,
    /// Last finished recording, kept for export.
    pub last: Option<Session>,
}

impl Recorder {
    pub fn start(&mut self, template: Session) {
        let mut s = template;
        s.started_at_unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        self.active = Some((Instant::now(), s));
    }

    pub fn is_recording(&self) -> bool {
        self.active.is_some()
    }

    /// Frames carry the worker clock; we re-base them on the recording start.
    pub fn push(&mut self, mut frame: Frame) {
        if let Some((start, s)) = self.active.as_mut() {
            frame.t_ms = start.elapsed().as_millis() as u64;
            s.frames.push(frame);
        }
    }

    pub fn stop(&mut self) -> Option<&Session> {
        if let Some((_, s)) = self.active.take() {
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
}
