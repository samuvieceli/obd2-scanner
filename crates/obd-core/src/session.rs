//! Recording of live data and export to CSV / JSON.

use std::collections::{BTreeMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::elm327::VehicleIdentity;
use crate::pid::PidMeta;

/// One polling cycle: every PID read in that cycle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Frame {
    /// Milliseconds since the start of the recording.
    pub t_ms: u64,
    pub values: Values,
}

/// The values of one frame, kept small because a long recording holds
/// hundreds of thousands of frames in memory. Frames almost always carry
/// the same parameters, so the sorted list of names (`["rpm", "speed"]`) is
/// shared by all of them and each frame keeps only its numbers: about 7
/// times less memory than a map per frame.
/// In files it is still a JSON object: `{"rpm": 812.5, "speed": 0}`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Values {
    keys: Arc<[&'static str]>,
    vals: Box<[f64]>,
}

/// Most distinct name lists kept for sharing; past it new lists are simply
/// not shared (only memory, never correctness, depends on this).
const MAX_SHARED_KEY_SETS: usize = 4096;

/// The one shared copy of a parameter name. Names come from the PID
/// catalog and from opened files, so the set stays small.
fn intern(name: &str) -> &'static str {
    static NAMES: OnceLock<Mutex<HashSet<&'static str>>> = OnceLock::new();
    let mut names = NAMES
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(n) = names.get(name) {
        return n;
    }
    let n: &'static str = Box::leak(name.to_owned().into_boxed_str());
    names.insert(n);
    n
}

/// The shared copy of a sorted list of names.
fn shared_keys(keys: Vec<&'static str>) -> Arc<[&'static str]> {
    static SETS: OnceLock<Mutex<HashSet<Arc<[&'static str]>>>> = OnceLock::new();
    let mut sets = SETS
        .get_or_init(Default::default)
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(k) = sets.get(keys.as_slice()) {
        return k.clone();
    }
    let k: Arc<[&'static str]> = keys.into();
    if sets.len() < MAX_SHARED_KEY_SETS {
        sets.insert(k.clone());
    }
    k
}

impl Values {
    pub fn get(&self, key: &str) -> Option<&f64> {
        self.keys.binary_search(&key).ok().map(|i| &self.vals[i])
    }

    pub fn keys(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.keys.iter().copied()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&'static str, &f64)> {
        self.keys.iter().copied().zip(self.vals.iter())
    }

    pub fn len(&self) -> usize {
        self.vals.len()
    }

    pub fn is_empty(&self) -> bool {
        self.vals.is_empty()
    }
}

impl<'a> IntoIterator for &'a Values {
    type Item = (&'static str, &'a f64);
    type IntoIter = std::iter::Zip<
        std::iter::Copied<std::slice::Iter<'a, &'static str>>,
        std::slice::Iter<'a, f64>,
    >;
    fn into_iter(self) -> Self::IntoIter {
        self.keys.iter().copied().zip(self.vals.iter())
    }
}

impl std::ops::Index<&str> for Values {
    type Output = f64;
    fn index(&self, key: &str) -> &f64 {
        self.get(key)
            .unwrap_or_else(|| panic!("no value for {key}"))
    }
}

impl<K: AsRef<str>> FromIterator<(K, f64)> for Values {
    fn from_iter<I: IntoIterator<Item = (K, f64)>>(iter: I) -> Self {
        // Sorted by name, one entry per name (the last one wins, as in a map).
        let map: BTreeMap<&'static str, f64> = iter
            .into_iter()
            .map(|(k, v)| (intern(k.as_ref()), v))
            .collect();
        let (keys, vals): (Vec<_>, Vec<_>) = map.into_iter().unzip();
        Values {
            keys: shared_keys(keys),
            vals: vals.into(),
        }
    }
}

impl<K: AsRef<str>, const N: usize> From<[(K, f64); N]> for Values {
    fn from(items: [(K, f64); N]) -> Self {
        items.into_iter().collect()
    }
}

impl Serialize for Values {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.collect_map(self.iter())
    }
}

impl<'de> Deserialize<'de> for Values {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(BTreeMap::<String, f64>::deserialize(d)?
            .into_iter()
            .collect())
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Session {
    /// Format version of the JSON file.
    pub format_version: u32,
    pub app_version: String,
    /// Start time, milliseconds since 1970-01-01 UTC.
    pub started_at_unix_ms: u64,
    pub adapter: String,
    pub protocol: String,
    pub vehicle: VehicleIdentity,
    pub pids: Vec<PidMeta>,
    pub frames: Vec<Frame>,
    /// Moments the driver marked during the recording (milliseconds since
    /// the start), e.g. "the engine stumbled here". Missing in older files.
    #[serde(default)]
    pub marks: Vec<u64>,
    /// Diagnostic reads saved with the recording: one at the start (vehicle,
    /// trouble codes, freeze frame, readiness, Mode 06) and one at the end
    /// (codes and readiness again). Missing in older files.
    #[serde(default)]
    pub diagnostics: Vec<Snapshot>,
    /// What happened at some marks, found by the program itself (a new
    /// trouble code, the check-engine light...). Missing in older files.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<Event>,
    /// True for a recording the black box saved by itself around a fault
    /// (see [`crate::blackbox`]), false for one the user started.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub automatic: bool,
}

/// Something the program noticed during a recording.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Event {
    /// Milliseconds since the start of the recording.
    pub t_ms: u64,
    /// `dtc_stored`, `dtc_pending`, `mil` (check-engine light turned on),
    /// `alert` (a value left the limits set by the user) or `manual` (the
    /// user asked to keep the last minutes).
    pub kind: String,
    /// The trouble code (`P0301`) or the parameter (`coolant_temp`); empty
    /// when there is none.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub code: String,
}

/// Diagnostic reads taken at one moment of a recording. Each part is kept
/// exactly as the program showed it (the shapes are in `src/api.ts`), so the
/// report can show it again later, even with the car far away. A part that
/// could not be read is left out.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct Snapshot {
    /// Milliseconds since the start of the recording (set by the recorder).
    #[serde(default)]
    pub t_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vehicle: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dtcs: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub freeze: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub readiness: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode06: Option<serde_json::Value>,
}

/// CSV flavour. Excel in Brazil expects `;` as separator and `,` as decimal mark.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CsvStyle {
    /// `,` separator, `.` decimal (international, Python, LibreOffice en-US...).
    Standard,
    /// `;` separator, `,` decimal (Excel pt-BR).
    ExcelBr,
}

impl Session {
    pub fn duration_s(&self) -> f64 {
        self.frames
            .last()
            .map(|f| f.t_ms as f64 / 1000.0)
            .unwrap_or(0.0)
    }

    /// Columns present in the frames, in catalog order.
    fn columns(&self) -> Vec<(String, String)> {
        let mut present: Vec<String> = Vec::new();
        for f in &self.frames {
            for k in f.values.keys() {
                if !present.iter().any(|p| p == k) {
                    present.push(k.to_string());
                }
            }
        }
        let mut cols: Vec<(String, String)> = self
            .pids
            .iter()
            .filter(|p| present.contains(&p.key))
            .map(|p| (p.key.clone(), p.unit.clone()))
            .collect();
        for k in present {
            if !cols.iter().any(|(c, _)| *c == k) {
                cols.push((k, String::new()));
            }
        }
        cols
    }

    /// Wide CSV: one row per cycle, one column per parameter. Empty cell = not read.
    pub fn to_csv(&self, style: CsvStyle) -> String {
        let (sep, dec) = match style {
            CsvStyle::Standard => (',', '.'),
            CsvStyle::ExcelBr => (';', ','),
        };
        let fmt = |v: f64| {
            let s = format!("{v}");
            if dec == ',' { s.replace('.', ",") } else { s }
        };
        let cols = self.columns();
        // A mark goes on the first row at or after its time.
        let marked: Vec<usize> = self
            .marks
            .iter()
            .map(|m| {
                self.frames
                    .iter()
                    .position(|f| f.t_ms >= *m)
                    .unwrap_or(self.frames.len().saturating_sub(1))
            })
            .collect();
        let mut out = String::new();
        out.push_str("time_s");
        for (key, unit) in &cols {
            out.push(sep);
            if unit.is_empty() {
                out.push_str(key);
            } else {
                out.push_str(&format!("{key} ({unit})"));
            }
        }
        if !self.marks.is_empty() {
            out.push(sep);
            out.push_str("mark");
        }
        out.push_str("\r\n");
        for (i, f) in self.frames.iter().enumerate() {
            out.push_str(&fmt(f.t_ms as f64 / 1000.0));
            for (key, _) in &cols {
                out.push(sep);
                if let Some(v) = f.values.get(key) {
                    out.push_str(&fmt(*v));
                }
            }
            if !self.marks.is_empty() {
                out.push(sep);
                let n = marked.iter().filter(|m| **m == i).count();
                if n > 0 {
                    out.push_str(&n.to_string());
                }
            }
            out.push_str("\r\n");
        }
        out
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }

    pub fn from_json(text: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pid::find_by_key;

    fn sample() -> Session {
        let mut s = Session {
            format_version: 1,
            pids: vec![
                find_by_key("rpm").unwrap().meta(),
                find_by_key("speed").unwrap().meta(),
            ],
            ..Default::default()
        };
        s.frames.push(Frame {
            t_ms: 0,
            values: [("rpm", 812.5), ("speed", 0.0)].into(),
        });
        s.frames.push(Frame {
            t_ms: 1250,
            values: [("rpm", 1500.0)].into(),
        });
        s
    }

    #[test]
    fn csv_standard() {
        let csv = sample().to_csv(CsvStyle::Standard);
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines[0], "time_s,rpm (rpm),speed (km/h)");
        assert_eq!(lines[1], "0,812.5,0");
        assert_eq!(lines[2], "1.25,1500,");
    }

    #[test]
    fn csv_excel_br() {
        let csv = sample().to_csv(CsvStyle::ExcelBr);
        assert!(csv.contains("1,25;1500;"));
        assert!(csv.contains("0;812,5;0"));
    }

    #[test]
    fn json_roundtrip() {
        let mut s = sample();
        s.marks.push(900);
        s.diagnostics.push(Snapshot {
            t_ms: 10,
            dtcs: Some(serde_json::json!({"stored": [{"code": "P0171"}]})),
            ..Default::default()
        });
        let back = Session::from_json(&s.to_json()).unwrap();
        assert_eq!(back.frames, s.frames);
        assert_eq!(back.marks, vec![900]);
        assert_eq!(back.diagnostics, s.diagnostics);
        // Files from older versions have no marks.
        let old = r#"{"format_version":1,"app_version":"","started_at_unix_ms":0,"adapter":"","protocol":"","vehicle":{},"pids":[],"frames":[]}"#;
        let old = Session::from_json(old).unwrap();
        assert!(old.marks.is_empty() && old.diagnostics.is_empty());
    }

    #[test]
    fn csv_marks_column() {
        let mut s = sample();
        s.marks.push(900);
        let csv = s.to_csv(CsvStyle::Standard);
        let lines: Vec<&str> = csv.lines().collect();
        assert_eq!(lines[0], "time_s,rpm (rpm),speed (km/h),mark");
        assert_eq!(lines[1], "0,812.5,0,");
        assert_eq!(lines[2], "1.25,1500,,1");
    }

    #[test]
    fn values_keep_the_json_object_format() {
        let f = Frame {
            t_ms: 5,
            values: [("speed", 3.0), ("rpm", 800.0)].into(),
        };
        let json = serde_json::to_string(&f).unwrap();
        // Sorted by name, as a map always was.
        assert_eq!(json, r#"{"t_ms":5,"values":{"rpm":800.0,"speed":3.0}}"#);
        let back: Frame = serde_json::from_str(&json).unwrap();
        assert_eq!(back, f);
        assert_eq!(back.values["rpm"], 800.0);
        assert_eq!(back.values.get("maf"), None);
        // A repeated name keeps the last value, like a map.
        let v: Values = [("rpm", 1.0), ("rpm", 2.0)].into();
        assert_eq!((v.len(), v["rpm"]), (1, 2.0));
    }

    #[test]
    fn frames_with_the_same_parameters_share_one_list_of_names() {
        let a: Values = [("rpm", 1.0), ("speed", 2.0)].into();
        let b: Values = [("speed", 5.0), ("rpm", 4.0)].into();
        assert!(Arc::ptr_eq(&a.keys, &b.keys));
        assert_eq!(
            b.iter().collect::<Vec<_>>(),
            vec![("rpm", &4.0), ("speed", &5.0)]
        );
    }
}
