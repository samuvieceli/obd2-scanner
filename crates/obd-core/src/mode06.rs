//! Mode 06: on-board monitoring test results (SAE J1979, CAN format).
//!
//! The ECU runs self-tests on components (oxygen sensors, catalyst, EVAP,
//! misfire...) and keeps the last measured value together with the allowed
//! minimum and maximum. A value outside the limits usually becomes a DTC
//! later, so Mode 06 shows problems *before* the check engine light.
//!
//! Each answer record is 9 bytes:
//! `MID TID UASID VALUE(2) MIN(2) MAX(2)`.
//! MID = what is monitored, TID = which test, UASID = unit and scaling.

use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TestResult {
    /// On-board monitor ID (what is being tested).
    pub mid: u8,
    /// Test ID inside the monitor.
    pub tid: u8,
    /// Unit and scaling ID (SAE J1979 appendix E).
    pub uas_id: u8,
    pub value: f64,
    pub min: f64,
    pub max: f64,
    /// Unit symbol; empty when the value has no unit.
    pub unit: &'static str,
    /// `false` when the UASID is unknown and values are shown raw.
    pub scaled: bool,
    pub passed: bool,
    /// Monitor group and index for naming, see [`mid_group`].
    pub group: &'static str,
    pub index: u8,
    /// Standard test name key, see [`tid_key`]; `None` = manufacturer test.
    pub test: Option<&'static str>,
}

/// Unit and scaling (factor, offset, unit) for a UASID. `None` = unknown.
pub fn scaling(uas_id: u8) -> Option<(f64, f64, &'static str)> {
    let s = match uas_id {
        0x01 | 0x81 => (1.0, 0.0, ""),
        0x02 | 0x82 => (0.1, 0.0, ""),
        0x03 | 0x83 => (0.01, 0.0, ""),
        0x04 | 0x84 => (0.001, 0.0, ""),
        0x05 | 0x85 => (0.000_030_5, 0.0, ""),
        0x06 | 0x86 => (0.000_305, 0.0, ""),
        0x07 => (0.25, 0.0, "rpm"),
        0x08 => (0.01, 0.0, "km/h"),
        0x09 => (1.0, 0.0, "km/h"),
        0x0A | 0x8A => (0.122, 0.0, "mV"),
        0x0B | 0x8B => (0.001, 0.0, "V"),
        0x0C | 0x8C => (0.01, 0.0, "V"),
        0x0D | 0x8D => (0.003_906_25, 0.0, "mA"),
        0x0E | 0x8E => (0.001, 0.0, "A"),
        0x0F => (0.01, 0.0, "A"),
        0x10 | 0x90 => (1.0, 0.0, "ms"),
        0x11 => (100.0, 0.0, "ms"),
        0x12 => (1.0, 0.0, "s"),
        0x13 => (1.0, 0.0, "mΩ"),
        0x14 => (1.0, 0.0, "Ω"),
        0x15 => (1.0, 0.0, "kΩ"),
        0x16 => (0.1, -40.0, "°C"),
        0x96 => (0.1, 0.0, "°C"),
        0x17 => (0.01, 0.0, "kPa"),
        0x18 => (0.0117, 0.0, "kPa"),
        0x19 => (0.079, 0.0, "kPa"),
        0x1A => (1.0, 0.0, "kPa"),
        0x1B => (10.0, 0.0, "kPa"),
        0x1C | 0x9C => (0.01, 0.0, "°"),
        0x1D | 0x9D => (0.5, 0.0, "°"),
        0x1E => (0.000_030_5, 0.0, "λ"),
        0x1F => (0.05, 0.0, "A/F"),
        0x20 => (0.003_906_2, 0.0, ""),
        0x21 => (1.0, 0.0, "mHz"),
        0x22 => (1.0, 0.0, "Hz"),
        0x23 => (1.0, 0.0, "kHz"),
        0x24 => (1.0, 0.0, ""),
        0x25 => (1.0, 0.0, "km"),
        0x27 => (0.01, 0.0, "g/s"),
        0x28 | 0xA8 => (1.0, 0.0, "g/s"),
        0x29 | 0xA9 => (0.25, 0.0, "Pa/s"),
        0x2B => (1.0, 0.0, ""),
        0x2F | 0xAF => (0.01, 0.0, "%"),
        0x30 => (0.001_526, 0.0, "%"),
        0x31 => (0.001, 0.0, "L"),
        0xFD => (0.001, 0.0, "kPa"),
        0xFE => (0.25, 0.0, "Pa"),
        _ => return None,
    };
    Some(s)
}

fn convert(uas_id: u8, raw: u16) -> (f64, &'static str, bool) {
    let signed = uas_id >= 0x80;
    let n = if signed {
        raw as i16 as f64
    } else {
        raw as f64
    };
    match scaling(uas_id) {
        Some((factor, offset, unit)) => (n * factor + offset, unit, true),
        None => (n, "", false),
    }
}

/// Decodes the records of one or more mode 06 answers (payload after `46`).
pub fn decode_records(payload: &[u8]) -> Vec<TestResult> {
    payload
        .chunks_exact(9)
        .map(|r| {
            let word = |i: usize| u16::from_be_bytes([r[i], r[i + 1]]);
            let (value, unit, scaled) = convert(r[2], word(3));
            let (min, _, _) = convert(r[2], word(5));
            let (max, _, _) = convert(r[2], word(7));
            let (group, index) = mid_group(r[0]);
            TestResult {
                group,
                index,
                test: tid_key(r[1]),
                mid: r[0],
                tid: r[1],
                uas_id: r[2],
                value,
                min,
                max,
                unit,
                scaled,
                passed: value >= min && value <= max,
            }
        })
        .collect()
}

/// Encodes a record (used by the simulator and tests).
pub fn encode_record(mid: u8, tid: u8, uas_id: u8, value: u16, min: u16, max: u16) -> [u8; 9] {
    let [v1, v2] = value.to_be_bytes();
    let [n1, n2] = min.to_be_bytes();
    let [x1, x2] = max.to_be_bytes();
    [mid, tid, uas_id, v1, v2, n1, n2, x1, x2]
}

/// Monitor group, used by the UI to name the monitor (`mode06.mid.<group>`).
/// Returns `(group, index)`; e.g. MID 0xA3 → ("misfire_cyl", 2).
pub fn mid_group(mid: u8) -> (&'static str, u8) {
    match mid {
        0x01..=0x10 => ("o2_sensor", mid),
        0x21..=0x24 => ("catalyst", mid - 0x20),
        0x31..=0x34 => ("egr", mid - 0x30),
        0x35..=0x38 => ("vvt", mid - 0x34),
        0x39 => ("evap_cap", 0),
        0x3A => ("evap_090", 0),
        0x3B => ("evap_040", 0),
        0x3C => ("evap_020", 0),
        0x3D => ("purge_flow", 0),
        0x41..=0x50 => ("o2_heater", mid - 0x40),
        0x61..=0x64 => ("heated_catalyst", mid - 0x60),
        0x71..=0x74 => ("secondary_air", mid - 0x70),
        0x81..=0x84 => ("fuel_system", mid - 0x80),
        0x85..=0x86 => ("boost", mid - 0x84),
        0x90..=0x91 => ("nox", mid - 0x8F),
        0x98..=0x99 => ("nox_cat", mid - 0x97),
        0xA1 => ("misfire_general", 0),
        0xA2..=0xAD => ("misfire_cyl", mid - 0xA1),
        0xB0..=0xB1 => ("pm_sensor", mid - 0xAF),
        0xB2..=0xB3 => ("pm_filter", mid - 0xB1),
        _ => ("other", 0),
    }
}

/// Names of standard test IDs (0x01-0x0C); others are manufacturer tests.
pub fn tid_key(tid: u8) -> Option<&'static str> {
    Some(match tid {
        0x01 => "rich_lean_threshold",
        0x02 => "lean_rich_threshold",
        0x03 => "low_switch_voltage",
        0x04 => "high_switch_voltage",
        0x05 => "rich_lean_time",
        0x06 => "lean_rich_time",
        0x07 => "min_voltage",
        0x08 => "max_voltage",
        0x09 => "transition_time",
        0x0A => "sensor_period",
        0x0B => "misfire_average",
        0x0C => "misfire_recent",
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_o2_record_in_volts() {
        // MID 01, TID 01, UASID 0x0A (0.122 mV), value 3690 → 450.2 mV
        let r = decode_records(&encode_record(0x01, 0x01, 0x0A, 3690, 2459, 4918));
        assert_eq!(r.len(), 1);
        assert!((r[0].value - 450.18).abs() < 0.01);
        assert_eq!(r[0].unit, "mV");
        assert!(r[0].passed);
    }

    #[test]
    fn signed_and_failed() {
        let rec = encode_record(0x21, 0x80, 0x81, (-5i16) as u16, 0, 100);
        let r = &decode_records(&rec)[0];
        assert_eq!(r.value, -5.0);
        assert!(!r.passed);
        assert_eq!(mid_group(0x21), ("catalyst", 1));
        assert_eq!(mid_group(0xA4), ("misfire_cyl", 3));
    }

    #[test]
    fn unknown_uasid_is_raw() {
        let r = &decode_records(&encode_record(0x01, 0x90, 0x7E, 12, 0, 20))[0];
        assert!(!r.scaled);
        assert_eq!(r.value, 12.0);
    }

    #[test]
    fn multiple_records() {
        let mut p = encode_record(0xA2, 0x0B, 0x24, 0, 0, 10).to_vec();
        p.extend(encode_record(0xA2, 0x0C, 0x24, 30, 0, 10));
        let r = decode_records(&p);
        assert_eq!(r.len(), 2);
        assert!(r[0].passed && !r[1].passed);
    }
}
