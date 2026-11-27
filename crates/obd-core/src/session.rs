//! Recording of live data and export to CSV / JSON.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::elm327::VehicleIdentity;
use crate::pid::PidMeta;

/// One polling cycle: every PID read in that cycle.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Frame {
    /// Milliseconds since the start of the recording.
    pub t_ms: u64,
    pub values: BTreeMap<String, f64>,
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
                if !present.contains(k) {
                    present.push(k.clone());
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
            if dec == ',' {
                s.replace('.', ",")
            } else {
                s
            }
        };
        let cols = self.columns();
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
        out.push_str("\r\n");
        for f in &self.frames {
            out.push_str(&fmt(f.t_ms as f64 / 1000.0));
            for (key, _) in &cols {
                out.push(sep);
                if let Some(v) = f.values.get(key) {
                    out.push_str(&fmt(*v));
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
            values: [("rpm".into(), 812.5), ("speed".into(), 0.0)].into(),
        });
        s.frames.push(Frame {
            t_ms: 1250,
            values: [("rpm".into(), 1500.0)].into(),
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
        let s = sample();
        let back = Session::from_json(&s.to_json()).unwrap();
        assert_eq!(back.frames, s.frames);
    }
}
