//! Plain-language interpretation of live data.
//!
//! Every rule points to a *possible* cause and a check to make; none replaces
//! a mechanic's diagnosis. Each finding carries a translation key
//! (`findings.<id>` in the UI) and the values used, so the text can say
//! "coolant at 108 °C".
//!
//! How false alarms are kept away:
//!
//! - **Only what the car reports, and only fresh.** A rule runs only when its
//!   parameters are being read right now. A value not updated for
//!   [`STALE_S`] seconds (the parameter left the dashboard, the link dropped)
//!   no longer counts.
//! - **Right conditions.** Mixture and oxygen sensor rules need a warm engine
//!   in closed loop (when the car reports it) and no fuel cut-off while
//!   slowing down; idle rules need a warm engine, stopped car and closed
//!   throttle; charging rules wait a little after the engine starts.
//! - **Confirmation in time (debounce).** A reading must hold for several
//!   seconds (see each rule) before it becomes a finding: a single odd sample
//!   never does.
//! - **Hysteresis.** A finding clears only after the value goes back past a
//!   slightly lower limit, so it does not blink when the reading hovers
//!   around the threshold.
//! - **Hold.** Mixture, idle and catalyst findings are kept while the engine
//!   runs but their conditions are briefly not met (accelerating, braking):
//!   the last valid verdict stays on screen instead of vanishing.

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

/// History kept per parameter, in seconds.
const WINDOW_S: f64 = 60.0;
/// A value older than this (compared with the newest sample) is ignored.
pub const STALE_S: f64 = 5.0;
/// Above this the engine runs; below [`STOPPED_RPM`] it has stopped.
const RUNNING_RPM: f64 = 400.0;
const STOPPED_RPM: f64 = 300.0;
/// Engine warm enough for mixture and oxygen sensor rules.
const WARM_C: f64 = 75.0;
/// Engine fully warm (idle and catalyst rules).
const HOT_C: f64 = 80.0;
/// Deceleration fuel cut-off: very low load at a speed the engine never idles at.
const DFCO_LOAD: f64 = 15.0;
const DFCO_RPM: f64 = 1400.0;
/// Classic battery load-test limit while cranking.
const CRANK_MIN_V: f64 = 9.6;

/// Statistics of a parameter over a recent period.
#[derive(Debug, Clone, Copy)]
struct Stats {
    /// Time between the first and last sample in the period.
    dt: f64,
    min: f64,
    max: f64,
    mean: f64,
}

/// Keeps a short history of values and the state needed by the rules.
#[derive(Default)]
pub struct Interpreter {
    history: HashMap<String, VecDeque<(f64, f64)>>,
    /// Newest sample time.
    now: f64,
    /// Findings of the previous evaluation (hysteresis and hold).
    prev: Vec<Finding>,
    /// When the engine started (or when we first saw it running).
    running_since: Option<f64>,
    /// Highest coolant temperature since the engine started.
    warm_peak: f64,
    /// Voltage samples while the engine was not running (last seconds).
    pre_start: VecDeque<(f64, f64)>,
    /// Lowest voltage seen during the last start we watched.
    crank_min: Option<f64>,
}

impl Interpreter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Adds a sample (`t` in seconds).
    pub fn push(&mut self, key: &str, t: f64, value: f64) {
        self.now = self.now.max(t);
        let h = self.history.entry(key.to_string()).or_default();
        h.push_back((t, value));
        while h.front().is_some_and(|(ts, _)| t - ts > WINDOW_S) {
            h.pop_front();
        }
        match key {
            "rpm" => self.on_rpm(t, value),
            "battery_voltage" | "module_voltage" if self.running_since.is_none() => {
                self.pre_start.push_back((t, value));
                while self.pre_start.front().is_some_and(|(ts, _)| t - ts > 5.0) {
                    self.pre_start.pop_front();
                }
            }
            "coolant_temp" if self.running_since.is_some() => {
                self.warm_peak = self.warm_peak.max(value);
            }
            _ => {}
        }
    }

    fn on_rpm(&mut self, t: f64, rpm: f64) {
        let was_running = self.running_since.is_some();
        if rpm >= RUNNING_RPM && !was_running {
            self.running_since = Some(t);
            // We only know the cranking voltage if we saw the engine stopped
            // just before (not when reading starts with the engine running).
            let saw_stopped = self.history.get("rpm").is_some_and(|h| {
                h.iter()
                    .rev()
                    .nth(1)
                    .is_some_and(|(ts, r)| *r < RUNNING_RPM && t - ts <= STALE_S)
            });
            self.crank_min = if saw_stopped {
                self.pre_start
                    .iter()
                    .filter(|(ts, _)| t - ts <= 5.0)
                    .map(|(_, v)| *v)
                    .reduce(f64::min)
            } else {
                None
            };
            self.pre_start.clear();
        } else if rpm < STOPPED_RPM && was_running {
            self.running_since = None;
            self.warm_peak = 0.0;
            self.crank_min = None;
        }
    }

    /// Latest value, if fresh.
    fn latest(&self, key: &str) -> Option<f64> {
        self.history
            .get(key)
            .and_then(|h| h.back())
            .filter(|(t, _)| self.now - t <= STALE_S)
            .map(|(_, v)| *v)
    }

    fn samples(&self, key: &str, secs: f64) -> Vec<(f64, f64)> {
        if self.latest(key).is_none() {
            return Vec::new();
        }
        let from = self.now - secs;
        self.history
            .get(key)
            .map(|h| h.iter().filter(|(t, _)| *t >= from).copied().collect())
            .unwrap_or_default()
    }

    /// Statistics over the last `secs` seconds (fresh parameters only).
    fn window(&self, key: &str, secs: f64) -> Option<Stats> {
        let s = self.samples(key, secs);
        let (first, last) = (s.first()?.0, s.last()?.0);
        let (mut min, mut max, mut sum) = (f64::MAX, f64::MIN, 0.0);
        for (_, v) in &s {
            min = min.min(*v);
            max = max.max(*v);
            sum += v;
        }
        Some(Stats {
            dt: last - first,
            min,
            max,
            mean: sum / s.len() as f64,
        })
    }

    /// `true` when every sample of the last `secs` seconds satisfies `pred`,
    /// the samples cover that period and none is missing for long.
    fn sustained(&self, key: &str, secs: f64, pred: impl Fn(f64) -> bool) -> bool {
        let Some(h) = self.history.get(key) else {
            return false;
        };
        if self.latest(key).is_none() {
            return false;
        }
        let from = self.now - secs;
        // Include the sample just before the period, so a slow polling rate
        // still covers it.
        let start = h.iter().rposition(|(t, _)| *t < from).unwrap_or(0);
        let s: Vec<_> = h.iter().skip(start).copied().collect();
        if s.len() < 2 || s[0].0 > from + secs * 0.1 {
            return false;
        }
        s.windows(2).all(|w| w[1].0 - w[0].0 <= STALE_S) && s.iter().all(|(_, v)| pred(*v))
    }

    fn was(&self, id: &str) -> bool {
        self.prev.iter().any(|f| f.id == id)
    }

    /// Hysteresis: `enter` turns a finding on, `stay` keeps it on.
    fn hyst(&self, id: &str, enter: bool, stay: bool) -> bool {
        if self.was(id) { stay } else { enter }
    }

    /// Keeps the previous findings matching `pred` (see "Hold" above).
    fn hold(&self, out: &mut Vec<Finding>, pred: impl Fn(&str) -> bool) {
        for f in &self.prev {
            if pred(&f.id) && !out.iter().any(|o| o.id == f.id) {
                out.push(f.clone());
            }
        }
    }

    fn running(&self) -> bool {
        self.running_since.is_some() && self.latest("rpm").is_some()
    }

    fn engine_off(&self) -> bool {
        self.latest("rpm").is_some_and(|r| r < 50.0)
    }

    /// Seconds since the engine started (PID "run time" when available).
    fn running_for(&self) -> f64 {
        if !self.running() {
            return 0.0;
        }
        let own = self.now - self.running_since.unwrap_or(self.now);
        self.latest("run_time").map_or(own, |rt| rt.max(own))
    }

    /// Fuel cut-off while slowing down at any time in the last `secs`
    /// seconds. Conservative: the lowest load and highest RPM of the period
    /// are compared, so doubtful periods are simply not evaluated.
    fn fuel_cut(&self, secs: f64) -> bool {
        let load = self
            .window("engine_load", secs)
            .is_some_and(|l| l.min < DFCO_LOAD);
        let rpm = self.window("rpm", secs).is_some_and(|r| r.max > DFCO_RPM);
        load && rpm
    }

    /// Closed loop for the last `secs` seconds; `true` when the car does not
    /// report the loop state (the warm-engine condition is used instead).
    fn closed_loop(&self, secs: f64) -> bool {
        if self.latest("closed_loop_b1").is_none() {
            return true;
        }
        self.sustained("closed_loop_b1", secs, |v| v >= 0.5)
    }

    fn coolant(&self) -> Option<f64> {
        self.latest("coolant_temp")
    }

    /// Warm idle: engine hot, car stopped and throttle closed for 10 s.
    fn idling(&self) -> bool {
        self.running()
            && self.running_for() >= 30.0
            && self.coolant().is_some_and(|c| c >= HOT_C)
            && self.sustained("speed", 10.0, |v| v < 1.0)
            && (self.latest("throttle").is_none() || self.sustained("throttle", 10.0, |v| v < 25.0))
    }

    /// Evaluates every rule with the latest values.
    pub fn evaluate(&mut self) -> Vec<Finding> {
        let mut out = Vec::new();
        self.coolant_rules(&mut out);
        self.mixture_rules(&mut out);
        self.voltage_rules(&mut out);
        self.idle_rules(&mut out);
        self.air_rules(&mut out);
        self.exhaust_rules(&mut out);
        if let Some(f) = self.latest("fuel_level")
            && f < 10.0
        {
            out.push(finding("fuel_low", Severity::Info, &[("value", f)]));
        }
        out.sort_by_key(|f| std::cmp::Reverse(f.severity));
        self.prev = out.clone();
        out
    }

    fn coolant_rules(&self, out: &mut Vec<Finding>) {
        use Severity::*;
        let Some(c) = self.coolant() else {
            return;
        };
        let running = self.running();
        // -40 °C is what an open circuit (unplugged sensor, broken wire) reads.
        if running && self.sustained("coolant_temp", 5.0, |v| v <= -39.0) {
            out.push(finding("coolant_sensor_open", Warning, &[("value", c)]));
            return;
        }
        // The engine is never much colder than the outside air.
        if let Some(a) = self.latest("ambient_temp")
            && running
            && self.sustained("coolant_temp", 10.0, |v| v < a - 10.0)
        {
            out.push(finding(
                "coolant_sensor_implausible",
                Warning,
                &[("value", c), ("ambient", a)],
            ));
        }
        let overheat = self.hyst(
            "coolant_overheat",
            self.sustained("coolant_temp", 5.0, |v| v >= 115.0),
            c >= 112.0,
        );
        let high = self.hyst(
            "coolant_high",
            self.sustained("coolant_temp", 10.0, |v| v >= 108.0),
            c >= 105.0,
        );
        // Stuck-open thermostat: never warms up, or cools down while driving
        // (the radiator gets the coolant all the time).
        let not_warming = running
            && self.running_for() >= 900.0
            && self.hyst(
                "coolant_low_thermostat",
                self.sustained("coolant_temp", 30.0, |v| v < 70.0),
                c < 75.0,
            );
        let drops = running
            && self.warm_peak >= 85.0
            && self.hyst(
                "coolant_drops_driving",
                self.sustained("speed", 45.0, |v| v > 40.0)
                    && self.sustained("coolant_temp", 30.0, |v| v < 75.0),
                c < 80.0,
            );
        if overheat {
            out.push(finding("coolant_overheat", Critical, &[("value", c)]));
        } else if high {
            out.push(finding("coolant_high", Warning, &[("value", c)]));
        } else if drops {
            out.push(finding(
                "coolant_drops_driving",
                Warning,
                &[("value", c), ("peak", self.warm_peak)],
            ));
        } else if not_warming {
            out.push(finding("coolant_low_thermostat", Warning, &[("value", c)]));
        } else if running && c < WARM_C {
            out.push(finding("engine_warming_up", Info, &[("value", c)]));
        } else if c >= WARM_C {
            out.push(finding("coolant_ok", Ok, &[("value", c)]));
        }
    }

    /// Fuel trims: the short-term trim averaged over 10 s plus the long-term
    /// trim, in closed loop with a warm engine.
    fn mixture_rules(&self, out: &mut Vec<Finding>) {
        use Severity::*;
        let steady = self.running()
            && self.running_for() >= 60.0
            && self.coolant().is_some_and(|c| c >= WARM_C)
            && self.closed_loop(5.0)
            && !self.fuel_cut(10.0)
            && self.latest("engine_load").is_none_or(|l| l < 80.0);
        for bank in ["b1", "b2"] {
            let mixture = |id: &str| {
                id.starts_with("mixture_")
                    && (id.ends_with(bank) || (bank == "b1" && id == "mixture_ok"))
            };
            let (Some(s), Some(l)) = (
                self.window(&format!("stft_{bank}"), 10.0),
                self.latest(&format!("ltft_{bank}")),
            ) else {
                continue;
            };
            if !steady || s.dt < 8.0 {
                if self.running() {
                    self.hold(out, mixture);
                }
                continue;
            }
            let total = s.mean + l;
            let vals = [("stft", s.mean), ("ltft", l), ("total", total)];
            let id = |what: &str| format!("mixture_{what}_{bank}");
            if self.hyst(&id("very_lean"), total > 20.0, total > 17.0) {
                out.push(finding(&id("very_lean"), Warning, &vals));
            } else if self.hyst(&id("lean"), total > 10.0, total > 8.0) {
                out.push(finding(&id("lean"), Info, &vals));
            } else if self.hyst(&id("very_rich"), total < -20.0, total < -17.0) {
                out.push(finding(&id("very_rich"), Warning, &vals));
            } else if self.hyst(&id("rich"), total < -10.0, total < -8.0) {
                out.push(finding(&id("rich"), Info, &vals));
            } else if bank == "b1" {
                out.push(finding("mixture_ok", Ok, &vals));
            }
        }
    }

    fn voltage_rules(&self, out: &mut Vec<Finding>) {
        use Severity::*;
        let key = ["battery_voltage", "module_voltage"]
            .into_iter()
            .find(|k| self.latest(k).is_some());
        let Some(key) = key else {
            return;
        };
        let v = self.latest(key).unwrap_or_default();
        if self.running() {
            if let Some(m) = self.crank_min
                && m < CRANK_MIN_V
            {
                out.push(finding("cranking_voltage_low", Warning, &[("value", m)]));
            }
            // The alternator needs a moment after the start.
            if self.running_for() < 20.0 {
                return;
            }
            if self.hyst(
                "charging_high",
                self.sustained(key, 10.0, |x| x > 15.0),
                v > 14.8,
            ) {
                out.push(finding("charging_high", Warning, &[("value", v)]));
            } else if self.hyst(
                "charging_low",
                self.sustained(key, 20.0, |x| x < 12.6),
                v < 12.9,
            ) {
                out.push(finding("charging_low", Warning, &[("value", v)]));
            } else if self.sustained(key, 30.0, |x| x < 13.2) {
                // Many recent cars lower the alternator voltage on purpose
                // ("smart charging") when the battery is full.
                out.push(finding("charging_smart", Info, &[("value", v)]));
            } else if v >= 13.2 {
                out.push(finding("charging_ok", Ok, &[("value", v)]));
            }
        } else if self.engine_off() {
            if self.hyst(
                "battery_low",
                self.sustained(key, 5.0, |x| x < 12.0),
                v < 12.2,
            ) {
                out.push(finding("battery_low", Warning, &[("value", v)]));
            } else if v < 12.4 {
                out.push(finding("battery_partial", Info, &[("value", v)]));
            } else {
                out.push(finding("battery_ok", Ok, &[("value", v)]));
            }
        }
    }

    fn idle_rules(&self, out: &mut Vec<Finding>) {
        use Severity::*;
        let held = |id: &str| id.starts_with("idle_");
        if !self.idling() {
            if self.running() {
                self.hold(out, held);
            }
            return;
        }
        let Some(rpm) = self.latest("rpm") else {
            return;
        };
        if self.hyst(
            "idle_high",
            self.sustained("rpm", 10.0, |r| r > 1150.0),
            rpm > 1050.0,
        ) {
            out.push(finding("idle_high", Info, &[("value", rpm)]));
        }
        // Irregular idle: the RPM keeps jumping, sample after sample. A single
        // step (A/C compressor, cooling fan) does not count.
        let s = self.samples("rpm", 15.0);
        if s.len() >= 8 && s[s.len() - 1].0 - s[0].0 >= 12.0 {
            let jumps = s
                .windows(2)
                .filter(|w| (w[1].1 - w[0].1).abs() > 80.0)
                .count();
            let (lo, hi) = s.iter().fold((f64::MAX, f64::MIN), |(lo, hi), (_, v)| {
                (lo.min(*v), hi.max(*v))
            });
            if hi - lo > 250.0 && jumps * 2 >= s.len() - 1 {
                out.push(finding("idle_unstable", Info, &[("min", lo), ("max", hi)]));
            }
        }
        // Weak vacuum at idle (manifold pressure close to the outside one).
        if let Some(map) = self.window("intake_map", 15.0) {
            let baro = self.latest("baro_pressure").unwrap_or(101.0);
            if self.hyst(
                "idle_vacuum_low",
                map.dt >= 12.0 && self.sustained("intake_map", 15.0, |m| m > 0.7 * baro),
                map.mean > 0.65 * baro,
            ) {
                out.push(finding(
                    "idle_vacuum_low",
                    Info,
                    &[("value", map.mean), ("baro", baro)],
                ));
            }
        }
    }

    fn air_rules(&self, out: &mut Vec<Finding>) {
        use Severity::*;
        let running = self.running();
        let ambient = self.latest("ambient_temp");
        // With the engine stopped and the ignition on, the manifold is at
        // outside pressure: both sensors must agree.
        if let (Some(map), Some(baro)) = (self.latest("intake_map"), self.latest("baro_pressure"))
            && self.engine_off()
            && self.sustained("intake_map", 5.0, |m| (m - baro).abs() > 10.0)
        {
            out.push(finding(
                "map_baro_mismatch",
                Warning,
                &[("map", map), ("baro", baro)],
            ));
        }
        // Air meter reading (almost) nothing with the engine running.
        if let Some(maf) = self.latest("maf")
            && running
            && self.running_for() >= 10.0
            && self.sustained("rpm", 5.0, |r| r > 600.0)
            && self.sustained("maf", 5.0, |m| m < 0.5)
        {
            out.push(finding("maf_no_signal", Warning, &[("value", maf)]));
        }
        let Some(iat) = self.latest("intake_temp") else {
            return;
        };
        if running && self.sustained("intake_temp", 5.0, |v| v <= -39.0) {
            out.push(finding("intake_sensor_open", Warning, &[("value", iat)]));
            return;
        }
        if let Some(a) = ambient
            && running
            && self.sustained("intake_temp", 10.0, |v| v < a - 15.0)
        {
            out.push(finding(
                "intake_sensor_implausible",
                Info,
                &[("value", iat), ("ambient", a)],
            ));
        }
        // Hot intake air is normal when stopped (heat soak); not while driving.
        let (enter, stay) = match ambient {
            Some(a) => (a + 30.0, a + 25.0),
            None => (65.0, 60.0),
        };
        if running
            && self.sustained("speed", 30.0, |v| v > 40.0)
            && self.hyst(
                "intake_hot",
                self.sustained("intake_temp", 30.0, |v| v > enter),
                iat > stay,
            )
        {
            out.push(finding("intake_hot", Info, &[("value", iat)]));
        }
    }

    fn exhaust_rules(&self, out: &mut Vec<Finding>) {
        use Severity::*;
        if let Some(cat) = self.latest("catalyst_temp_b1s1")
            && self.hyst(
                "catalyst_overheat",
                self.sustained("catalyst_temp_b1s1", 5.0, |v| v > 900.0),
                cat > 880.0,
            )
        {
            out.push(finding("catalyst_overheat", Warning, &[("value", cat)]));
        }
        let running = self.running();
        let warm = self.coolant().is_some_and(|c| c >= WARM_C);
        // Cars with a wideband front sensor: its 0x14 voltage may not switch.
        let wideband = ["lambda_b1s1", "wb_lambda_s1"]
            .iter()
            .any(|k| self.latest(k).is_some());
        let base = running && warm && !wideband && self.closed_loop(10.0);
        // Upstream O2 sensor should switch between lean (<0.3 V) and rich
        // (>0.6 V). Not during fuel cut (it reads lean on purpose).
        if let Some(up) = self.window("o2_b1s1", 10.0)
            && base
            && !self.fuel_cut(10.0)
            && up.dt >= 8.0
            && up.max - up.min < 0.3
        {
            out.push(finding(
                "o2_not_switching",
                Warning,
                &[("min", up.min), ("max", up.max)],
            ));
        }
        // Downstream sensor switching almost as often as the upstream one =
        // the catalyst no longer stores oxygen. Only at steady speed with a
        // hot catalyst: speed changes and fuel cuts move both sensors.
        let steady = base
            && self.running_for() >= 300.0
            && self.coolant().is_some_and(|c| c >= HOT_C)
            && !self.fuel_cut(20.0)
            && self
                .window("rpm", 20.0)
                .is_some_and(|r| r.max - r.min < 500.0);
        let crossings = |key: &str| {
            let s = self.samples(key, 20.0);
            let n = s
                .windows(2)
                .filter(|w| (w[0].1 - 0.45) * (w[1].1 - 0.45) < 0.0)
                .count();
            (
                n,
                s.last().map_or(0.0, |l| l.0) - s.first().map_or(0.0, |f| f.0),
            )
        };
        if steady
            && let (Some(_), Some(down)) =
                (self.window("o2_b1s1", 20.0), self.window("o2_b1s2", 20.0))
        {
            let ((up_n, dt), (down_n, _)) = (crossings("o2_b1s1"), crossings("o2_b1s2"));
            if dt >= 15.0
                && up_n >= 6
                && down.max - down.min > 0.4
                && down_n as f64 >= 0.7 * up_n as f64
            {
                out.push(finding(
                    "catalyst_efficiency_suspect",
                    Warning,
                    &[("up", up_n as f64), ("down", down_n as f64)],
                ));
            }
        } else if running {
            self.hold(out, |id| id == "catalyst_efficiency_suspect");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Feeds the same values once per second from `from` for `secs` seconds,
    /// evaluating every second like the app does, and returns the last result.
    fn feed(i: &mut Interpreter, from: u32, secs: u32, values: &[(&str, f64)]) -> Vec<Finding> {
        let mut last = Vec::new();
        for n in from..from + secs {
            for (k, v) in values {
                i.push(k, n as f64, *v);
            }
            last = i.evaluate();
        }
        last
    }

    fn ids(f: &[Finding]) -> Vec<&str> {
        f.iter().map(|f| f.id.as_str()).collect()
    }

    fn has(f: &[Finding], id: &str) -> bool {
        f.iter().any(|f| f.id == id)
    }

    /// Warm engine at idle, closed loop, after a long run.
    const WARM_IDLE: [(&str, f64); 6] = [
        ("rpm", 800.0),
        ("coolant_temp", 90.0),
        ("run_time", 1200.0),
        ("speed", 0.0),
        ("engine_load", 25.0),
        ("closed_loop_b1", 1.0),
    ];

    fn with(
        base: &[(&'static str, f64)],
        extra: &[(&'static str, f64)],
    ) -> Vec<(&'static str, f64)> {
        let mut v: Vec<_> = base
            .iter()
            .filter(|(k, _)| !extra.iter().any(|(e, _)| e == k))
            .copied()
            .collect();
        v.extend_from_slice(extra);
        v
    }

    // --- general behaviour ---------------------------------------------

    #[test]
    fn stale_values_are_ignored() {
        let mut i = Interpreter::new();
        feed(&mut i, 0, 10, &[("coolant_temp", 120.0)]);
        // Coolant leaves the dashboard; only RPM keeps coming.
        let f = feed(&mut i, 10, 10, &[("rpm", 800.0)]);
        assert!(
            !f.iter().any(|f| f.id.starts_with("coolant")),
            "{:?}",
            ids(&f)
        );
    }

    #[test]
    fn a_single_sample_is_not_enough() {
        let mut i = Interpreter::new();
        i.push("coolant_temp", 0.0, 120.0);
        assert!(!has(&i.evaluate(), "coolant_overheat"));
    }

    // --- coolant ---------------------------------------------------------

    #[test]
    fn overheating_needs_five_seconds_and_has_hysteresis() {
        let mut i = Interpreter::new();
        let f = feed(&mut i, 0, 3, &[("coolant_temp", 117.0)]);
        assert!(!has(&f, "coolant_overheat"));
        let f = feed(&mut i, 3, 4, &[("coolant_temp", 117.0)]);
        assert_eq!(f[0].id, "coolant_overheat");
        assert_eq!(f[0].severity, Severity::Critical);
        // Hovering just below the limit keeps it on...
        assert!(has(
            &feed(&mut i, 7, 2, &[("coolant_temp", 113.0)]),
            "coolant_overheat"
        ));
        // ...a clear drop turns it off.
        assert!(!has(
            &feed(&mut i, 9, 1, &[("coolant_temp", 109.0)]),
            "coolant_overheat"
        ));
    }

    #[test]
    fn hot_but_normal_engine_is_not_flagged() {
        // Many cars run at 100–105 °C in traffic before the fan starts.
        let mut i = Interpreter::new();
        let f = feed(&mut i, 0, 30, &with(&WARM_IDLE, &[("coolant_temp", 104.0)]));
        assert!(has(&f, "coolant_ok"));
        assert!(!has(&f, "coolant_high"));
        let f = feed(
            &mut i,
            30,
            12,
            &with(&WARM_IDLE, &[("coolant_temp", 109.0)]),
        );
        assert!(has(&f, "coolant_high"));
    }

    #[test]
    fn thermostat_stuck_open_after_long_run() {
        let mut i = Interpreter::new();
        let f = feed(&mut i, 0, 40, &with(&WARM_IDLE, &[("coolant_temp", 60.0)]));
        assert!(has(&f, "coolant_low_thermostat"));
        // Just started: warming up is normal.
        let mut i = Interpreter::new();
        let f = feed(
            &mut i,
            0,
            40,
            &with(&WARM_IDLE, &[("coolant_temp", 60.0), ("run_time", 300.0)]),
        );
        assert_eq!(ids(&f), ["engine_warming_up"]);
    }

    #[test]
    fn coolant_dropping_while_driving() {
        let driving = with(
            &WARM_IDLE,
            &[("speed", 90.0), ("rpm", 2500.0), ("engine_load", 40.0)],
        );
        let mut i = Interpreter::new();
        feed(&mut i, 0, 20, &with(&driving, &[("coolant_temp", 90.0)]));
        let f = feed(&mut i, 20, 50, &with(&driving, &[("coolant_temp", 70.0)]));
        assert!(has(&f, "coolant_drops_driving"), "{:?}", ids(&f));
        // Same temperatures while stopped in traffic: not this rule.
        let mut i = Interpreter::new();
        feed(&mut i, 0, 20, &WARM_IDLE);
        let f = feed(&mut i, 20, 50, &with(&WARM_IDLE, &[("coolant_temp", 74.0)]));
        assert!(!has(&f, "coolant_drops_driving"));
    }

    #[test]
    fn coolant_sensor_faults() {
        let mut i = Interpreter::new();
        let f = feed(&mut i, 0, 8, &with(&WARM_IDLE, &[("coolant_temp", -40.0)]));
        assert_eq!(ids(&f), ["coolant_sensor_open"]);

        let mut i = Interpreter::new();
        let f = feed(
            &mut i,
            0,
            15,
            &with(&WARM_IDLE, &[("coolant_temp", 5.0), ("ambient_temp", 25.0)]),
        );
        assert!(has(&f, "coolant_sensor_implausible"));
        // Cold start on a cold morning: engine as cold as the air.
        let mut i = Interpreter::new();
        let f = feed(
            &mut i,
            0,
            15,
            &with(
                &WARM_IDLE,
                &[("coolant_temp", 12.0), ("ambient_temp", 14.0)],
            ),
        );
        assert!(!has(&f, "coolant_sensor_implausible"));
    }

    // --- mixture -------------------------------------------------------------

    #[test]
    fn lean_mixture_after_ten_seconds_in_closed_loop() {
        let lean = with(&WARM_IDLE, &[("stft_b1", 6.0), ("ltft_b1", 8.0)]);
        let mut i = Interpreter::new();
        assert!(!has(&feed(&mut i, 0, 5, &lean), "mixture_lean_b1"));
        let f = feed(&mut i, 5, 6, &lean);
        let m = f.iter().find(|f| f.id == "mixture_lean_b1").expect("lean");
        assert_eq!(m.severity, Severity::Info);
        assert_eq!(m.values["total"], 14.0);
    }

    #[test]
    fn mixture_hysteresis_and_ok() {
        let mut i = Interpreter::new();
        assert!(has(
            &feed(
                &mut i,
                0,
                12,
                &with(&WARM_IDLE, &[("stft_b1", 4.0), ("ltft_b1", 8.0)])
            ),
            "mixture_lean_b1"
        ));
        // Total 9 %: still lean (clears below 8 %).
        assert!(has(
            &feed(
                &mut i,
                12,
                12,
                &with(&WARM_IDLE, &[("stft_b1", 1.0), ("ltft_b1", 8.0)])
            ),
            "mixture_lean_b1"
        ));
        let f = feed(
            &mut i,
            24,
            12,
            &with(&WARM_IDLE, &[("stft_b1", 0.0), ("ltft_b1", 3.0)]),
        );
        assert_eq!(ids(&f), ["coolant_ok", "mixture_ok"]);
    }

    #[test]
    fn mixture_ignored_when_conditions_are_wrong() {
        let lean = with(&WARM_IDLE, &[("stft_b1", 15.0), ("ltft_b1", 15.0)]);
        // Open loop (cold start enrichment, full throttle).
        let mut i = Interpreter::new();
        assert!(
            !feed(&mut i, 0, 15, &with(&lean, &[("closed_loop_b1", 0.0)]))
                .iter()
                .any(|f| f.id.starts_with("mixture"))
        );
        // Cold engine.
        let mut i = Interpreter::new();
        assert!(
            !feed(&mut i, 0, 15, &with(&lean, &[("coolant_temp", 50.0)]))
                .iter()
                .any(|f| f.id.starts_with("mixture"))
        );
        // Fuel cut while slowing down.
        let mut i = Interpreter::new();
        let cut = with(
            &lean,
            &[("rpm", 2200.0), ("engine_load", 5.0), ("speed", 60.0)],
        );
        assert!(
            !feed(&mut i, 0, 15, &cut)
                .iter()
                .any(|f| f.id.starts_with("mixture"))
        );
        // Just started.
        let mut i = Interpreter::new();
        assert!(
            !feed(&mut i, 0, 15, &with(&lean, &[("run_time", 20.0)]))
                .iter()
                .any(|f| f.id.starts_with("mixture"))
        );
    }

    #[test]
    fn mixture_verdict_is_held_during_a_brief_fuel_cut() {
        let lean = with(&WARM_IDLE, &[("stft_b1", 6.0), ("ltft_b1", 8.0)]);
        let mut i = Interpreter::new();
        assert!(has(&feed(&mut i, 0, 12, &lean), "mixture_lean_b1"));
        let cut = with(
            &lean,
            &[("rpm", 2200.0), ("engine_load", 5.0), ("speed", 60.0)],
        );
        assert!(has(&feed(&mut i, 12, 3, &cut), "mixture_lean_b1"));
    }

    #[test]
    fn very_rich_second_bank() {
        let mut i = Interpreter::new();
        let f = feed(
            &mut i,
            0,
            12,
            &with(&WARM_IDLE, &[("stft_b2", -10.0), ("ltft_b2", -15.0)]),
        );
        let m = f
            .iter()
            .find(|f| f.id == "mixture_very_rich_b2")
            .expect("rich");
        assert_eq!(m.severity, Severity::Warning);
    }

    // --- battery and charging ------------------------------------------

    #[test]
    fn charging_rules() {
        let mut i = Interpreter::new();
        assert!(has(
            &feed(
                &mut i,
                0,
                30,
                &with(&WARM_IDLE, &[("battery_voltage", 12.3)])
            ),
            "charging_low"
        ));
        let mut i = Interpreter::new();
        let f = feed(
            &mut i,
            0,
            40,
            &with(&WARM_IDLE, &[("battery_voltage", 12.9)]),
        );
        assert!(has(&f, "charging_smart") && !has(&f, "charging_low"));
        let mut i = Interpreter::new();
        assert!(has(
            &feed(
                &mut i,
                0,
                30,
                &with(&WARM_IDLE, &[("battery_voltage", 15.3)])
            ),
            "charging_high"
        ));
        let mut i = Interpreter::new();
        assert!(has(
            &feed(
                &mut i,
                0,
                30,
                &with(&WARM_IDLE, &[("battery_voltage", 14.2)])
            ),
            "charging_ok"
        ));
    }

    #[test]
    fn no_charging_verdict_right_after_start() {
        let mut i = Interpreter::new();
        feed(&mut i, 0, 3, &[("rpm", 0.0), ("battery_voltage", 12.5)]);
        let f = feed(&mut i, 3, 10, &[("rpm", 900.0), ("battery_voltage", 12.2)]);
        assert!(
            !f.iter().any(|f| f.id.starts_with("charging")),
            "{:?}",
            ids(&f)
        );
    }

    #[test]
    fn battery_with_engine_off() {
        let off = |v: f64| [("rpm", 0.0), ("battery_voltage", v)];
        let mut i = Interpreter::new();
        assert!(has(&feed(&mut i, 0, 8, &off(11.8)), "battery_low"));
        let mut i = Interpreter::new();
        assert!(has(&feed(&mut i, 0, 8, &off(12.3)), "battery_partial"));
        let mut i = Interpreter::new();
        assert!(has(&feed(&mut i, 0, 8, &off(12.6)), "battery_ok"));
        // Without RPM we cannot tell whether the engine runs: no verdict.
        let mut i = Interpreter::new();
        assert!(feed(&mut i, 0, 8, &[("battery_voltage", 11.8)]).is_empty());
    }

    #[test]
    fn cranking_voltage() {
        let start = |dip: f64| {
            let mut i = Interpreter::new();
            feed(&mut i, 0, 3, &[("rpm", 0.0), ("battery_voltage", 12.5)]);
            feed(&mut i, 3, 1, &[("rpm", 200.0), ("battery_voltage", dip)]);
            feed(&mut i, 4, 5, &[("rpm", 900.0), ("battery_voltage", 14.1)])
        };
        let f = start(9.1);
        assert_eq!(
            f.iter()
                .find(|f| f.id == "cranking_voltage_low")
                .unwrap()
                .values["value"],
            9.1
        );
        assert!(!has(&start(10.4), "cranking_voltage_low"));
        // Reading started with the engine already running: no claim.
        let mut i = Interpreter::new();
        i.push("battery_voltage", 0.0, 9.0);
        assert!(!has(
            &feed(&mut i, 1, 5, &[("rpm", 900.0), ("battery_voltage", 14.1)]),
            "cranking_voltage_low"
        ));
    }

    // --- idle ------------------------------------------------------------------

    #[test]
    fn high_idle_only_when_stopped_and_warm() {
        let mut i = Interpreter::new();
        assert!(has(
            &feed(&mut i, 0, 12, &with(&WARM_IDLE, &[("rpm", 1250.0)])),
            "idle_high"
        ));
        let mut i = Interpreter::new();
        assert!(!has(
            &feed(
                &mut i,
                0,
                12,
                &with(&WARM_IDLE, &[("rpm", 1250.0), ("speed", 50.0)])
            ),
            "idle_high"
        ));
        let mut i = Interpreter::new();
        assert!(!has(
            &feed(
                &mut i,
                0,
                12,
                &with(&WARM_IDLE, &[("rpm", 1250.0), ("coolant_temp", 40.0)])
            ),
            "idle_high"
        ));
    }

    #[test]
    fn unstable_idle() {
        let mut i = Interpreter::new();
        feed(&mut i, 0, 10, &WARM_IDLE);
        for n in 10..30 {
            let rpm = if n % 2 == 0 { 650.0 } else { 950.0 };
            for (k, v) in with(&WARM_IDLE, &[("rpm", rpm)]) {
                i.push(k, n as f64, v);
            }
        }
        assert!(has(&i.evaluate(), "idle_unstable"));
        // One step (A/C compressor kicks in) is normal.
        let mut i = Interpreter::new();
        feed(&mut i, 0, 20, &WARM_IDLE);
        let f = feed(&mut i, 20, 8, &with(&WARM_IDLE, &[("rpm", 1050.0)]));
        assert!(!has(&f, "idle_unstable"));
    }

    #[test]
    fn weak_idle_vacuum() {
        let mut i = Interpreter::new();
        let f = feed(
            &mut i,
            0,
            20,
            &with(&WARM_IDLE, &[("intake_map", 75.0), ("baro_pressure", 95.0)]),
        );
        assert!(has(&f, "idle_vacuum_low"));
        let mut i = Interpreter::new();
        let f = feed(
            &mut i,
            0,
            20,
            &with(&WARM_IDLE, &[("intake_map", 35.0), ("baro_pressure", 95.0)]),
        );
        assert!(!has(&f, "idle_vacuum_low"));
    }

    // --- air sensors ---------------------------------------------------------

    #[test]
    fn map_vs_baro_with_engine_off() {
        let mut i = Interpreter::new();
        assert!(has(
            &feed(
                &mut i,
                0,
                8,
                &[("rpm", 0.0), ("intake_map", 80.0), ("baro_pressure", 95.0)]
            ),
            "map_baro_mismatch"
        ));
        let mut i = Interpreter::new();
        assert!(!has(
            &feed(
                &mut i,
                0,
                8,
                &[("rpm", 0.0), ("intake_map", 93.0), ("baro_pressure", 95.0)]
            ),
            "map_baro_mismatch"
        ));
        // Engine running: manifold vacuum is normal.
        let mut i = Interpreter::new();
        assert!(!has(
            &feed(
                &mut i,
                0,
                8,
                &with(&WARM_IDLE, &[("intake_map", 35.0), ("baro_pressure", 95.0)])
            ),
            "map_baro_mismatch"
        ));
    }

    #[test]
    fn maf_without_signal() {
        let mut i = Interpreter::new();
        assert!(has(
            &feed(&mut i, 0, 15, &with(&WARM_IDLE, &[("maf", 0.1)])),
            "maf_no_signal"
        ));
        let mut i = Interpreter::new();
        assert!(!has(
            &feed(&mut i, 0, 15, &with(&WARM_IDLE, &[("maf", 3.2)])),
            "maf_no_signal"
        ));
    }

    #[test]
    fn intake_air_temperature() {
        let driving = with(
            &WARM_IDLE,
            &[("speed", 80.0), ("rpm", 2500.0), ("engine_load", 40.0)],
        );
        let mut i = Interpreter::new();
        assert!(has(
            &feed(
                &mut i,
                0,
                35,
                &with(&driving, &[("intake_temp", 70.0), ("ambient_temp", 28.0)])
            ),
            "intake_hot"
        ));
        // Stopped in traffic: heat soak is normal.
        let mut i = Interpreter::new();
        assert!(!has(
            &feed(
                &mut i,
                0,
                35,
                &with(&WARM_IDLE, &[("intake_temp", 70.0), ("ambient_temp", 28.0)])
            ),
            "intake_hot"
        ));
        // Sensor reading far below the outside air.
        let mut i = Interpreter::new();
        assert!(has(
            &feed(
                &mut i,
                0,
                15,
                &with(&WARM_IDLE, &[("intake_temp", 5.0), ("ambient_temp", 28.0)])
            ),
            "intake_sensor_implausible"
        ));
        let mut i = Interpreter::new();
        assert!(has(
            &feed(&mut i, 0, 8, &with(&WARM_IDLE, &[("intake_temp", -40.0)])),
            "intake_sensor_open"
        ));
    }

    // --- exhaust ---------------------------------------------------------------

    #[test]
    fn flat_o2_sensor() {
        let mut i = Interpreter::new();
        assert!(has(
            &feed(&mut i, 0, 11, &with(&WARM_IDLE, &[("o2_b1s1", 0.45)])),
            "o2_not_switching"
        ));
    }

    #[test]
    fn lean_o2_during_fuel_cut_is_normal() {
        let mut i = Interpreter::new();
        let cut = with(
            &WARM_IDLE,
            &[("rpm", 2200.0), ("engine_load", 5.0), ("o2_b1s1", 0.08)],
        );
        assert!(!has(&feed(&mut i, 0, 11, &cut), "o2_not_switching"));
        // Open loop: the computer is not using the sensor.
        let mut i = Interpreter::new();
        let open = with(&WARM_IDLE, &[("closed_loop_b1", 0.0), ("o2_b1s1", 0.8)]);
        assert!(!has(&feed(&mut i, 0, 11, &open), "o2_not_switching"));
    }

    fn cruise_with_o2(down_switches: bool) -> Vec<Finding> {
        let cruise = with(
            &WARM_IDLE,
            &[("rpm", 2400.0), ("speed", 90.0), ("engine_load", 40.0)],
        );
        let mut i = Interpreter::new();
        feed(&mut i, 0, 10, &cruise);
        for n in 10..35 {
            let up = if n % 2 == 0 { 0.1 } else { 0.8 };
            let down = if down_switches { up } else { 0.65 };
            for (k, v) in with(&cruise, &[("o2_b1s1", up), ("o2_b1s2", down)]) {
                i.push(k, n as f64, v);
            }
        }
        i.evaluate()
    }

    #[test]
    fn tired_catalyst() {
        assert!(has(&cruise_with_o2(true), "catalyst_efficiency_suspect"));
        assert!(!has(&cruise_with_o2(false), "catalyst_efficiency_suspect"));
    }

    #[test]
    fn catalyst_temperature() {
        let mut i = Interpreter::new();
        assert!(!has(
            &feed(&mut i, 0, 3, &[("catalyst_temp_b1s1", 950.0)]),
            "catalyst_overheat"
        ));
        assert!(has(
            &feed(&mut i, 3, 4, &[("catalyst_temp_b1s1", 950.0)]),
            "catalyst_overheat"
        ));
    }
}
