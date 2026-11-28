//! Summary of a recording for the diagnostic report: minimum, average and
//! maximum of each parameter, the interpretation findings seen along the
//! whole trip, and a light copy of the main parameters for the charts.
//!
//! Everything comes from the recording alone, so the report can be made
//! again later from a saved file, with the car far away.

use std::collections::BTreeMap;

use serde::Serialize;

use crate::elm327::VehicleIdentity;
use crate::interpret::{Finding, Interpreter, Severity};
use crate::session::{Session, Snapshot};

/// Parameters drawn in the report, in this order of preference.
pub const CHART_KEYS: [&str; 9] = [
    "rpm",
    "speed",
    "coolant_temp",
    "engine_load",
    "stft_b1",
    "ltft_b1",
    "battery_voltage",
    "maf",
    "o2_b1s1",
];
/// Most charts in one report.
pub const MAX_CHARTS: usize = 6;
/// Time slices per chart; each keeps its lowest and highest value, so short
/// peaks still show.
const CHART_SLICES: usize = 300;
/// How often (recording time) the interpretation rules are checked, the
/// same pace as during live reading.
const EVALUATE_EVERY_MS: u64 = 1000;

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ParamStats {
    pub key: String,
    pub unit: String,
    pub min: f64,
    pub avg: f64,
    pub max: f64,
    /// Number of readings.
    pub count: usize,
}

/// A finding seen during the recording.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct TripFinding {
    pub id: String,
    /// Worst severity reached.
    pub severity: Severity,
    /// Values at the first moment the worst severity was reached.
    pub values: BTreeMap<String, f64>,
    /// First and last time it was seen, seconds since the start.
    pub first_s: f64,
    pub last_s: f64,
    /// Roughly how many seconds it was present.
    pub seconds: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ChartSeries {
    pub key: String,
    pub unit: String,
    /// Seconds since the start.
    pub t: Vec<f64>,
    pub v: Vec<f64>,
}

/// Everything the report needs from a recording (the frames themselves are
/// left out: a long recording would be heavy to hand to the screen).
#[derive(Debug, Clone, Serialize)]
pub struct RecordingReport {
    pub app_version: String,
    pub started_at_unix_ms: u64,
    pub adapter: String,
    pub protocol: String,
    pub vehicle: VehicleIdentity,
    pub duration_s: f64,
    pub frames: usize,
    pub marks: Vec<u64>,
    /// Faults the program noticed by itself (black box).
    pub events: Vec<crate::session::Event>,
    /// Saved by the black box around a fault.
    pub automatic: bool,
    pub diagnostics: Vec<Snapshot>,
    /// In catalog order.
    pub stats: Vec<ParamStats>,
    /// Most serious first, then by first appearance.
    pub findings: Vec<TripFinding>,
    pub charts: Vec<ChartSeries>,
}

impl RecordingReport {
    pub fn from_session(s: &Session) -> Self {
        let unit = |key: &str| {
            s.pids
                .iter()
                .find(|p| p.key == key)
                .map(|p| p.unit.clone())
                .unwrap_or_default()
        };
        let stats = stats(s)
            .into_iter()
            .map(|(key, (min, sum, max, count))| ParamStats {
                unit: unit(key),
                key: key.to_string(),
                min,
                avg: sum / count as f64,
                max,
                count,
            })
            .collect();
        let charts = CHART_KEYS
            .iter()
            .filter_map(|k| chart(s, k).map(|(t, v)| (k, t, v)))
            .take(MAX_CHARTS)
            .map(|(k, t, v)| ChartSeries {
                key: k.to_string(),
                unit: unit(k),
                t,
                v,
            })
            .collect();
        Self {
            app_version: s.app_version.clone(),
            started_at_unix_ms: s.started_at_unix_ms,
            adapter: s.adapter.clone(),
            protocol: s.protocol.clone(),
            vehicle: s.vehicle.clone(),
            duration_s: s.duration_s(),
            frames: s.frames.len(),
            marks: s.marks.clone(),
            events: s.events.clone(),
            automatic: s.automatic,
            diagnostics: s.diagnostics.clone(),
            stats,
            findings: trip_findings(s),
            charts,
        }
    }
}

/// Running (min, sum, max, count) of one parameter.
type Totals = (f64, f64, f64, usize);
/// (seconds, value).
type Point = (f64, f64);

/// Totals per parameter, in catalog order (unknown names last).
fn stats(s: &Session) -> Vec<(&'static str, Totals)> {
    let mut acc: BTreeMap<&'static str, Totals> = BTreeMap::new();
    for f in &s.frames {
        for (k, v) in &f.values {
            if !v.is_finite() {
                continue;
            }
            let e = acc.entry(k).or_insert((*v, 0.0, *v, 0));
            e.0 = e.0.min(*v);
            e.1 += v;
            e.2 = e.2.max(*v);
            e.3 += 1;
        }
    }
    let order = |k: &str| s.pids.iter().position(|p| p.key == k).unwrap_or(usize::MAX);
    let mut out: Vec<_> = acc.into_iter().collect();
    out.sort_by_key(|(k, _)| order(k));
    out
}

/// Lowest and highest value of each time slice, in time order.
fn chart(s: &Session, key: &str) -> Option<(Vec<f64>, Vec<f64>)> {
    let points: Vec<Point> = s
        .frames
        .iter()
        .filter_map(|f| {
            f.values
                .get(key)
                .filter(|v| v.is_finite())
                .map(|v| (f.t_ms as f64 / 1000.0, *v))
        })
        .collect();
    if points.len() < 2 {
        return None;
    }
    let (t0, t1) = (points[0].0, points[points.len() - 1].0);
    let span = (t1 - t0).max(1e-9);
    let mut slices: Vec<Option<(Point, Point)>> = vec![None; CHART_SLICES];
    for p in points {
        let i = (((p.0 - t0) / span) * CHART_SLICES as f64) as usize;
        let slot = &mut slices[i.min(CHART_SLICES - 1)];
        *slot = Some(match *slot {
            None => (p, p),
            Some((lo, hi)) => (
                if p.1 < lo.1 { p } else { lo },
                if p.1 > hi.1 { p } else { hi },
            ),
        });
    }
    let mut t = Vec::new();
    let mut v = Vec::new();
    for (lo, hi) in slices.into_iter().flatten() {
        let pair = if lo.0 <= hi.0 { [lo, hi] } else { [hi, lo] };
        for (i, p) in pair.iter().enumerate() {
            if i == 1 && pair[0] == pair[1] {
                break;
            }
            t.push(p.0);
            v.push(p.1);
        }
    }
    Some((t, v))
}

/// Replays the recording through the interpretation rules, checking them
/// every second of recording time as live reading does, and keeps every
/// finding seen along the way.
pub fn trip_findings(s: &Session) -> Vec<TripFinding> {
    let mut interpreter = Interpreter::new();
    let mut seen: Vec<TripFinding> = Vec::new();
    let mut next_eval = EVALUATE_EVERY_MS;
    let collect = |found: Vec<Finding>, t_s: f64, seen: &mut Vec<TripFinding>| {
        for f in found.into_iter().filter(|f| f.severity > Severity::Ok) {
            match seen.iter_mut().find(|x| x.id == f.id) {
                Some(x) => {
                    x.last_s = t_s;
                    x.seconds += 1;
                    if f.severity > x.severity {
                        x.severity = f.severity;
                        x.values = f.values;
                    }
                }
                None => seen.push(TripFinding {
                    id: f.id,
                    severity: f.severity,
                    values: f.values,
                    first_s: t_s,
                    last_s: t_s,
                    seconds: 1,
                }),
            }
        }
    };
    for f in &s.frames {
        if f.t_ms >= next_eval {
            collect(interpreter.evaluate(), next_eval as f64 / 1000.0, &mut seen);
            next_eval = (f.t_ms / EVALUATE_EVERY_MS + 1) * EVALUATE_EVERY_MS;
        }
        let t = f.t_ms as f64 / 1000.0;
        for (k, v) in &f.values {
            interpreter.push(k, t, *v);
        }
    }
    if !s.frames.is_empty() {
        collect(interpreter.evaluate(), s.duration_s(), &mut seen);
    }
    // Stable sort: same severity keeps the order of first appearance.
    seen.sort_by_key(|f| std::cmp::Reverse(f.severity));
    seen
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pid::find_by_key;
    use crate::session::Frame;

    fn session(frames: Vec<Frame>) -> Session {
        Session {
            pids: ["rpm", "speed", "coolant_temp"]
                .iter()
                .map(|k| find_by_key(k).unwrap().meta())
                .collect(),
            frames,
            ..Default::default()
        }
    }

    #[test]
    fn min_average_and_max_per_parameter() {
        let s = session(vec![
            Frame {
                t_ms: 0,
                values: [("speed", 0.0), ("rpm", 800.0)].into(),
            },
            Frame {
                t_ms: 500,
                values: [("rpm", 1200.0)].into(),
            },
            Frame {
                t_ms: 1000,
                values: [("rpm", 1000.0), ("speed", 30.0)].into(),
            },
        ]);
        let r = RecordingReport::from_session(&s);
        // Catalog order: rpm before speed.
        assert_eq!(r.stats[0].key, "rpm");
        assert_eq!(r.stats[0].unit, "rpm");
        assert_eq!(
            (r.stats[0].min, r.stats[0].avg, r.stats[0].max),
            (800.0, 1000.0, 1200.0)
        );
        assert_eq!(r.stats[0].count, 3);
        assert_eq!(
            (r.stats[1].min, r.stats[1].max, r.stats[1].count),
            (0.0, 30.0, 2)
        );
        assert_eq!(r.frames, 3);
        assert_eq!(r.duration_s, 1.0);
        // Charts follow the preference order and skip what was not recorded.
        let keys: Vec<_> = r.charts.iter().map(|c| c.key.as_str()).collect();
        assert_eq!(keys, ["rpm", "speed"]);
    }

    #[test]
    fn long_charts_are_thinned_but_keep_peaks() {
        let frames = (0..10_000u64)
            .map(|i| Frame {
                t_ms: i * 100,
                values: [("rpm", if i == 5_000 { 6500.0 } else { 800.0 })].into(),
            })
            .collect();
        let r = RecordingReport::from_session(&session(frames));
        let c = &r.charts[0];
        assert!(c.t.len() <= 2 * CHART_SLICES);
        assert!(c.v.contains(&6500.0));
        assert!(c.t.windows(2).all(|w| w[0] <= w[1]));
    }

    #[test]
    fn findings_cover_the_whole_trip() {
        // Engine overheating for a while in the middle, then back to normal:
        // the live screen would no longer show it at the end, the report does.
        let mut frames = Vec::new();
        for i in 0..300u64 {
            let temp = if (100..160).contains(&i) { 118.0 } else { 90.0 };
            frames.push(Frame {
                t_ms: i * 1000,
                values: [("rpm", 900.0), ("coolant_temp", temp), ("speed", 0.0)].into(),
            });
        }
        let s = session(frames);
        let found = trip_findings(&s);
        let hot = found
            .iter()
            .find(|f| f.id.starts_with("coolant"))
            .expect("overheating finding");
        assert!(hot.severity >= Severity::Warning);
        assert!(hot.first_s >= 100.0 && hot.last_s < 200.0);
        assert!(hot.seconds >= 30);
        // Worst first.
        assert!(found.windows(2).all(|w| w[0].severity >= w[1].severity));
    }

    #[test]
    fn empty_recording() {
        let r = RecordingReport::from_session(&Session::default());
        assert!(r.stats.is_empty() && r.findings.is_empty() && r.charts.is_empty());
    }
}
