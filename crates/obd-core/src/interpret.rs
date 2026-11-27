//! Plain-language interpretation of live data.
//!
//! Rules are deliberately conservative: they point to *possible* causes and
//! never replace a mechanic's diagnosis. Each finding carries a translation
//! key (`findings.<id>` in the UI) and the values used, so the text can say
//! "coolant at 108 °C".

use std::collections::{BTreeMap, HashMap, VecDeque};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Ok,
    Info,
    Warning,
    Critical,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Finding {
    pub id: String,
    pub severity: Severity,
    pub values: BTreeMap<String, f64>,
}

fn finding(id: &str, severity: Severity, values: &[(&str, f64)]) -> Finding {
    Finding {
        id: id.into(),
        severity,
        values: values
            .iter()
            .map(|(k, v)| (k.to_string(), (v * 10.0).round() / 10.0))
            .collect(),
    }
}

/// Keeps a short history of values to evaluate trends (e.g. O2 switching).
#[derive(Default)]
pub struct Interpreter {
    history: HashMap<String, VecDeque<(f64, f64)>>,
}

const WINDOW_S: f64 = 10.0;

impl Interpreter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a sample (`t` in seconds).
    pub fn push(&mut self, key: &str, t: f64, value: f64) {
        let h = self.history.entry(key.to_string()).or_default();
        h.push_back((t, value));
        while h.front().is_some_and(|(ts, _)| t - ts > WINDOW_S) {
            h.pop_front();
        }
    }

    fn latest(&self, key: &str) -> Option<f64> {
        self.history
            .get(key)
            .and_then(|h| h.back())
            .map(|(_, v)| *v)
    }

    fn span(&self, key: &str) -> Option<(f64, f64, f64)> {
        let h = self.history.get(key)?;
        let first = h.front()?.0;
        let last = h.back()?.0;
        let (mut lo, mut hi) = (f64::MAX, f64::MIN);
        for (_, v) in h {
            lo = lo.min(*v);
            hi = hi.max(*v);
        }
        Some((last - first, lo, hi))
    }

    /// Evaluates every rule with the latest values.
    pub fn evaluate(&self) -> Vec<Finding> {
        use Severity::*;
        let mut out = Vec::new();
        let rpm = self.latest("rpm");
        let running = rpm.is_some_and(|r| r > 400.0);
        let coolant = self.latest("coolant_temp");
        let warm = coolant.is_some_and(|c| c >= 75.0);

        if let Some(c) = coolant {
            if c >= 110.0 {
                out.push(finding("coolant_overheat", Critical, &[("value", c)]));
            } else if c >= 103.0 {
                out.push(finding("coolant_high", Warning, &[("value", c)]));
            } else if running && c < 70.0 && self.latest("run_time").is_some_and(|t| t > 900.0) {
                out.push(finding("coolant_low_thermostat", Warning, &[("value", c)]));
            } else if running && c < 70.0 {
                out.push(finding("engine_warming_up", Info, &[("value", c)]));
            } else if (75.0..103.0).contains(&c) {
                out.push(finding("coolant_ok", Ok, &[("value", c)]));
            }
        }

        for bank in ["b1", "b2"] {
            let (Some(s), Some(l)) = (
                self.latest(&format!("stft_{bank}")),
                self.latest(&format!("ltft_{bank}")),
            ) else {
                continue;
            };
            if !running || !warm {
                continue;
            }
            let total = s + l;
            let vals = [("stft", s), ("ltft", l), ("total", total)];
            let id = |what: &str| format!("mixture_{what}_{bank}");
            if total > 20.0 {
                out.push(finding(&id("very_lean"), Critical, &vals));
            } else if total > 10.0 {
                out.push(finding(&id("lean"), Warning, &vals));
            } else if total < -20.0 {
                out.push(finding(&id("very_rich"), Critical, &vals));
            } else if total < -10.0 {
                out.push(finding(&id("rich"), Warning, &vals));
            } else if bank == "b1" {
                out.push(finding("mixture_ok", Ok, &vals));
            }
        }

        let volts = self
            .latest("battery_voltage")
            .or_else(|| self.latest("module_voltage"));
        if let Some(v) = volts {
            if running {
                if v < 13.2 {
                    out.push(finding("charging_low", Warning, &[("value", v)]));
                } else if v > 14.9 {
                    out.push(finding("charging_high", Warning, &[("value", v)]));
                } else {
                    out.push(finding("charging_ok", Ok, &[("value", v)]));
                }
            } else if v < 12.2 {
                out.push(finding("battery_low", Warning, &[("value", v)]));
            } else {
                out.push(finding("battery_ok", Ok, &[("value", v)]));
            }
        }

        if let (Some(r), Some(sp), true) = (rpm, self.latest("speed"), warm) {
            if sp < 1.0 && self.latest("throttle").is_none_or(|t| t < 20.0) && r > 1150.0 {
                out.push(finding("idle_high", Info, &[("value", r)]));
            }
        }

        if let Some(iat) = self.latest("intake_temp") {
            if iat > 65.0 {
                out.push(finding("intake_hot", Warning, &[("value", iat)]));
            }
        }

        if let Some(cat) = self.latest("catalyst_temp_b1s1") {
            if cat > 900.0 {
                out.push(finding("catalyst_overheat", Critical, &[("value", cat)]));
            }
        }

        // Upstream O2 sensor should switch between lean (<0.3 V) and rich (>0.6 V).
        if let Some((dt, lo, hi)) = self.span("o2_b1s1") {
            if running && warm && dt >= 8.0 && hi - lo < 0.3 {
                out.push(finding(
                    "o2_not_switching",
                    Warning,
                    &[("min", lo), ("max", hi)],
                ));
            }
        }
        // Downstream sensor switching as much as the upstream one = tired catalyst.
        if let (Some((dt, lo1, hi1)), Some((_, lo2, hi2))) =
            (self.span("o2_b1s1"), self.span("o2_b1s2"))
        {
            if running && warm && dt >= 8.0 && hi1 - lo1 > 0.4 && (hi2 - lo2) > 0.7 * (hi1 - lo1) {
                out.push(finding(
                    "catalyst_efficiency_suspect",
                    Warning,
                    &[("up", hi1 - lo1), ("down", hi2 - lo2)],
                ));
            }
        }

        if let Some(f) = self.latest("fuel_level") {
            if f < 10.0 {
                out.push(finding("fuel_low", Info, &[("value", f)]));
            }
        }

        out.sort_by(|a, b| b.severity.cmp(&a.severity));
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eval(values: &[(&str, f64)]) -> Vec<String> {
        let mut i = Interpreter::new();
        for (k, v) in values {
            i.push(k, 0.0, *v);
        }
        i.evaluate().into_iter().map(|f| f.id).collect()
    }

    #[test]
    fn overheating_is_critical() {
        let mut i = Interpreter::new();
        i.push("coolant_temp", 0.0, 112.0);
        let f = i.evaluate();
        assert_eq!(f[0].id, "coolant_overheat");
        assert_eq!(f[0].severity, Severity::Critical);
    }

    #[test]
    fn lean_mixture() {
        let ids = eval(&[
            ("rpm", 800.0),
            ("coolant_temp", 90.0),
            ("stft_b1", 6.0),
            ("ltft_b1", 8.0),
        ]);
        assert!(ids.contains(&"mixture_lean_b1".to_string()));
    }

    #[test]
    fn charging_depends_on_engine_running() {
        assert!(eval(&[("rpm", 800.0), ("battery_voltage", 12.4)]).contains(&"charging_low".into()));
        assert!(eval(&[("rpm", 0.0), ("battery_voltage", 12.6)]).contains(&"battery_ok".into()));
        assert!(eval(&[("battery_voltage", 11.8)]).contains(&"battery_low".into()));
    }

    #[test]
    fn flat_o2_sensor() {
        let mut i = Interpreter::new();
        for n in 0..=10 {
            let t = n as f64;
            i.push("rpm", t, 800.0);
            i.push("coolant_temp", t, 90.0);
            i.push("o2_b1s1", t, 0.45);
        }
        assert!(i.evaluate().iter().any(|f| f.id == "o2_not_switching"));
    }
}
