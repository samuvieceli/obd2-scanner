//! "Caixa-preta" (black box): the last minutes of live data kept in memory,
//! saved by themselves when something goes wrong.
//!
//! Like an airplane's flight recorder, [`BlackBox`] always holds the last
//! [`PRE_MS`] of frames. When a fault shows up (see [`FaultWatch`]), it keeps
//! those frames and goes on collecting for [`POST_MS`] more; the result is a
//! [`Clip`] with the minutes before and after the fault. Another fault during
//! that time stretches the same clip, up to [`MAX_CLIP_MS`] in all, instead of
//! starting a new one.
//!
//! Nothing here talks to the adapter: the caller feeds frames and faults in,
//! with the times of its own clock (milliseconds), and saves the clips. All
//! the reads behind it are read-only (modes 01, 02, 03, 07).

use std::collections::{BTreeSet, VecDeque};

use crate::session::{Event, Frame, Session, Snapshot};

/// Time kept before a fault.
pub const PRE_MS: u64 = 120_000;
/// Time recorded after the last fault of a clip.
pub const POST_MS: u64 = 120_000;
/// Longest clip, however many faults come one after the other.
pub const MAX_CLIP_MS: u64 = 600_000;

/// Minutes around one or more faults, with times counted from its first frame.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Clip {
    /// Time of the first frame on the caller's clock.
    pub start_ms: u64,
    pub frames: Vec<Frame>,
    pub events: Vec<Event>,
    pub diagnostics: Vec<Snapshot>,
}

impl Clip {
    /// The clip as a recording, on top of `template` (adapter, vehicle,
    /// parameter catalog and start time). Each event is also a mark, so the
    /// charts and the replay show where it happened.
    pub fn into_session(self, template: Session) -> Session {
        Session {
            marks: self.events.iter().map(|e| e.t_ms).collect(),
            frames: self.frames,
            events: self.events,
            diagnostics: self.diagnostics,
            automatic: true,
            ..template
        }
    }
}

struct Capture {
    start_ms: u64,
    until_ms: u64,
    clip: Clip,
}

/// What [`BlackBox::trigger`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Triggered {
    /// A new clip started with the minutes before.
    Started,
    /// The clip being collected got this fault too.
    Added,
}

#[derive(Default)]
pub struct BlackBox {
    /// Last [`PRE_MS`] of frames, oldest first.
    recent: VecDeque<Frame>,
    capture: Option<Capture>,
}

impl BlackBox {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a frame (its `t_ms` on the caller's clock). Returns the clip
    /// that this frame completes, if any.
    pub fn push(&mut self, frame: Frame) -> Option<Clip> {
        let now = frame.t_ms;
        if let Some(c) = self.capture.as_mut() {
            let mut f = frame.clone();
            f.t_ms = now.saturating_sub(c.start_ms);
            c.clip.frames.push(f);
        }
        self.recent.push_back(frame);
        while self.recent.front().is_some_and(|f| f.t_ms + PRE_MS < now) {
            self.recent.pop_front();
        }
        self.tick(now)
    }

    /// Ends the clip whose time is over, even if no frame came (reading
    /// paused). Returns it.
    pub fn tick(&mut self, now_ms: u64) -> Option<Clip> {
        if self.capture.as_ref().is_some_and(|c| now_ms >= c.until_ms) {
            return self.finish();
        }
        None
    }

    /// True while the minutes after a fault are being collected.
    pub fn is_capturing(&self) -> bool {
        self.capture.is_some()
    }

    /// A fault at `now_ms`: starts a clip with the minutes before it, or
    /// stretches the one being collected.
    pub fn trigger(&mut self, now_ms: u64, kind: &str, code: &str) -> Triggered {
        let result = match self.capture.as_mut() {
            Some(c) => {
                c.until_ms = c
                    .until_ms
                    .max(now_ms + POST_MS)
                    .min(c.start_ms + MAX_CLIP_MS);
                Triggered::Added
            }
            None => {
                let start_ms = self
                    .recent
                    .front()
                    .map(|f| f.t_ms)
                    .unwrap_or(now_ms)
                    .max(now_ms.saturating_sub(PRE_MS))
                    .min(now_ms);
                let frames = self
                    .recent
                    .iter()
                    .filter(|f| f.t_ms >= start_ms)
                    .map(|f| Frame {
                        t_ms: f.t_ms - start_ms,
                        values: f.values.clone(),
                    })
                    .collect();
                self.capture = Some(Capture {
                    start_ms,
                    until_ms: now_ms + POST_MS,
                    clip: Clip {
                        start_ms,
                        frames,
                        ..Clip::default()
                    },
                });
                Triggered::Started
            }
        };
        let c = self.capture.as_mut().expect("capture just set");
        c.clip.events.push(Event {
            t_ms: now_ms.saturating_sub(c.start_ms),
            kind: kind.to_string(),
            code: code.to_string(),
        });
        result
    }

    /// Diagnostic reads taken at `now_ms` (codes, freeze frame), kept with
    /// the clip being collected. Ignored when there is none.
    pub fn attach(&mut self, now_ms: u64, mut snap: Snapshot) {
        if let Some(c) = self.capture.as_mut() {
            snap.t_ms = now_ms.saturating_sub(c.start_ms);
            c.clip.diagnostics.push(snap);
        }
    }

    /// The last minutes right now, with a `manual` event at the end, for the
    /// "save the last 2 minutes" button. `None` when there is nothing yet or
    /// a clip is being collected (the button then adds to it instead).
    pub fn save_now(&mut self, now_ms: u64) -> Option<Clip> {
        if self.capture.is_some() || self.recent.is_empty() {
            return None;
        }
        self.trigger(now_ms, "manual", "");
        self.finish()
    }

    /// Ends the clip being collected now (connection closed): what was
    /// collected is better than nothing.
    pub fn finish(&mut self) -> Option<Clip> {
        self.capture.take().map(|c| c.clip)
    }
}

/// A fault [`FaultWatch`] noticed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fault {
    /// `dtc_stored`, `dtc_pending` or `mil`.
    pub kind: &'static str,
    pub code: String,
}

/// Tells new faults from the ones the car already had.
///
/// The car does not announce a fault: the program asks. A quick question
/// (mode 01 PID 01: check-engine light on? how many confirmed codes?) is
/// cheap and asked often; when its answer changes, the code lists (modes 03
/// and 07) say which code it is. Pending codes (mode 07) are read every now
/// and then too, because they often appear before the light turns on.
///
/// Codes the car had when the reading started are not faults: only codes
/// that appear afterwards are. Each code is reported once per connection,
/// so a pending code that comes and goes does not fill the disk.
#[derive(Debug, Default)]
pub struct FaultWatch {
    /// Codes present at the last read (`None` = not read yet).
    known: Option<BTreeSet<String>>,
    /// Codes already reported.
    reported: BTreeSet<String>,
    mil: Option<bool>,
    count: Option<u8>,
    /// The light turned on and no code explained it yet.
    mil_turned_on: bool,
}

impl FaultWatch {
    pub fn new() -> Self {
        Self::default()
    }

    /// Answer of mode 01 PID 01. Returns true when the code lists must be
    /// read: the first time, or when the light or the count changed.
    pub fn status(&mut self, mil_on: bool, dtc_count: u8) -> bool {
        let changed = self.mil != Some(mil_on) || self.count != Some(dtc_count);
        if self.mil == Some(false) && mil_on {
            self.mil_turned_on = true;
        }
        self.mil = Some(mil_on);
        self.count = Some(dtc_count);
        changed || self.known.is_none()
    }

    /// True until the codes the car already had are known.
    pub fn needs_baseline(&self) -> bool {
        self.known.is_none()
    }

    /// Pending codes alone (mode 07). Returns true when one is new and the
    /// full lists must be read (the stored ones may have changed too).
    pub fn pending_changed(&self, pending: &[String]) -> bool {
        match &self.known {
            None => true,
            Some(known) => pending.iter().any(|c| !known.contains(c)),
        }
    }

    /// Both code lists (modes 03 and 07). Returns the new faults; the first
    /// call only learns the codes the car already had.
    pub fn codes(&mut self, stored: &[String], pending: &[String]) -> Vec<Fault> {
        let now: BTreeSet<String> = stored.iter().chain(pending).cloned().collect();
        let Some(known) = self.known.replace(now) else {
            self.mil_turned_on = false;
            return Vec::new();
        };
        let mut faults = Vec::new();
        for (list, kind) in [(stored, "dtc_stored"), (pending, "dtc_pending")] {
            for code in list {
                if !known.contains(code) && self.reported.insert(code.clone()) {
                    faults.push(Fault {
                        kind,
                        code: code.clone(),
                    });
                }
            }
        }
        if std::mem::take(&mut self.mil_turned_on) && faults.is_empty() {
            faults.push(Fault {
                kind: "mil",
                code: stored.first().cloned().unwrap_or_default(),
            });
        }
        faults
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(t_ms: u64) -> Frame {
        Frame {
            t_ms,
            values: [("rpm", t_ms as f64)].into(),
        }
    }

    /// Frames every 500 ms from `from` to `to` (inclusive), returning the
    /// clips they completed.
    fn feed(b: &mut BlackBox, from: u64, to: u64) -> Vec<Clip> {
        (from / 500..=to / 500)
            .filter_map(|i| b.push(frame(i * 500)))
            .collect()
    }

    fn s(codes: &[&str]) -> Vec<String> {
        codes.iter().map(|c| c.to_string()).collect()
    }

    #[test]
    fn clip_holds_two_minutes_before_and_after() {
        let mut b = BlackBox::new();
        assert!(feed(&mut b, 0, 300_000).is_empty());
        assert_eq!(
            b.trigger(300_000, "dtc_stored", "P0301"),
            Triggered::Started
        );
        let clips = feed(&mut b, 300_500, 500_000);
        assert_eq!(clips.len(), 1);
        let c = &clips[0];
        assert_eq!(c.start_ms, 180_000);
        assert_eq!(c.frames.first().unwrap().t_ms, 0);
        assert_eq!(c.frames.last().unwrap().t_ms, 240_000);
        // The values are the original ones: only the times are moved.
        assert_eq!(c.frames[0].values["rpm"], 180_000.0);
        assert_eq!(
            c.events,
            vec![Event {
                t_ms: 120_000,
                kind: "dtc_stored".into(),
                code: "P0301".into()
            }]
        );
        assert!(!b.is_capturing());
    }

    #[test]
    fn early_fault_keeps_what_there_is() {
        let mut b = BlackBox::new();
        feed(&mut b, 0, 30_000);
        b.trigger(30_000, "mil", "");
        let c = feed(&mut b, 30_500, 200_000).remove(0);
        assert_eq!(c.start_ms, 0);
        assert_eq!(c.events[0].t_ms, 30_000);
        assert_eq!(c.frames.last().unwrap().t_ms, 150_000);
    }

    #[test]
    fn second_fault_stretches_the_same_clip_up_to_the_limit() {
        let mut b = BlackBox::new();
        feed(&mut b, 0, 200_000);
        b.trigger(200_000, "dtc_pending", "P0171");
        feed(&mut b, 200_500, 300_000);
        assert_eq!(b.trigger(300_000, "dtc_stored", "P0171"), Triggered::Added);
        let clips = feed(&mut b, 300_500, 1_000_000);
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].frames.last().unwrap().t_ms, 340_000);
        assert_eq!(clips[0].events.len(), 2);
        assert_eq!(clips[0].events[1].t_ms, 220_000);

        // Faults that never stop: the clip still ends at the limit.
        let mut b = BlackBox::new();
        feed(&mut b, 0, 200_000);
        let mut clips = Vec::new();
        for t in (200_000..2_000_000).step_by(60_000) {
            b.trigger(t, "alert", "coolant_temp");
            clips.extend(feed(&mut b, t + 500, t + 60_000));
        }
        assert!(clips.len() >= 2);
        assert!(
            clips
                .iter()
                .all(|c| c.frames.last().unwrap().t_ms <= MAX_CLIP_MS)
        );
    }

    #[test]
    fn clip_ends_without_frames_and_on_finish() {
        let mut b = BlackBox::new();
        feed(&mut b, 0, 10_000);
        b.trigger(10_000, "mil", "");
        assert!(b.tick(100_000).is_none());
        assert!(b.tick(130_000).is_some());
        feed(&mut b, 130_000, 140_000);
        b.trigger(140_000, "mil", "");
        assert!(b.finish().is_some());
        assert!(b.finish().is_none());
    }

    #[test]
    fn save_now_gives_the_last_minutes() {
        let mut b = BlackBox::new();
        assert!(b.save_now(0).is_none());
        feed(&mut b, 0, 400_000);
        let c = b.save_now(400_000).unwrap();
        assert_eq!(c.frames.len(), 241);
        assert_eq!(c.events[0].kind, "manual");
        assert!(!b.is_capturing());
        // During a clip, the button adds to it instead.
        b.trigger(400_000, "mil", "");
        assert!(b.save_now(401_000).is_none());
    }

    #[test]
    fn attached_reads_and_session() {
        let mut b = BlackBox::new();
        feed(&mut b, 0, 200_000);
        b.trigger(200_000, "dtc_stored", "P0301");
        b.attach(201_000, Snapshot::default());
        let c = b.finish().unwrap();
        assert_eq!(c.diagnostics[0].t_ms, 121_000);
        let s = c.into_session(Session {
            adapter: "ELM327 v1.5".into(),
            ..Session::default()
        });
        assert!(s.automatic);
        assert_eq!(s.adapter, "ELM327 v1.5");
        assert_eq!(s.marks, vec![120_000]);
        let back = Session::from_json(&s.to_json()).unwrap();
        assert_eq!(back.events, s.events);
        assert!(back.automatic);
    }

    #[test]
    fn old_codes_are_not_faults() {
        let mut w = FaultWatch::new();
        assert!(w.needs_baseline());
        assert!(w.status(true, 1));
        assert!(w.codes(&s(&["P0420"]), &s(&["P0171"])).is_empty());
        assert!(!w.needs_baseline());
        // Same answer: nothing to read.
        assert!(!w.status(true, 1));
        assert!(!w.pending_changed(&s(&["P0171"])));
    }

    #[test]
    fn new_codes_are_reported_once() {
        let mut w = FaultWatch::new();
        w.status(false, 0);
        w.codes(&[], &[]);
        assert!(w.pending_changed(&s(&["P0301"])));
        let f = w.codes(&[], &s(&["P0301"]));
        assert_eq!(
            f,
            vec![Fault {
                kind: "dtc_pending",
                code: "P0301".into()
            }]
        );
        // It goes away and comes back: not reported again.
        w.codes(&[], &[]);
        assert!(w.codes(&[], &s(&["P0301"])).is_empty());
        // Confirmed later, with the light: the light is the news.
        assert!(w.status(true, 1));
        let f = w.codes(&s(&["P0301"]), &[]);
        assert_eq!(
            f,
            vec![Fault {
                kind: "mil",
                code: "P0301".into()
            }]
        );
        // A different stored code is.
        let f = w.codes(&s(&["P0301", "P0302"]), &[]);
        assert_eq!(
            f,
            vec![Fault {
                kind: "dtc_stored",
                code: "P0302".into()
            }]
        );
    }

    #[test]
    fn light_turning_on_without_a_new_code() {
        let mut w = FaultWatch::new();
        w.status(false, 1);
        w.codes(&s(&["P0420"]), &[]);
        w.status(true, 1);
        assert_eq!(w.codes(&s(&["P0420"]), &[])[0].kind, "mil");
        // Already on when the reading started: not a fault.
        let mut w = FaultWatch::new();
        w.status(true, 1);
        assert!(w.codes(&s(&["P0420"]), &[]).is_empty());
    }
}
